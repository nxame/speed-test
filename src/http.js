import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { performance } from 'node:perf_hooks';

const DEFAULT_DOWNLOAD = [
  {
    name: 'cloudflare',
    base: 'https://speed.cloudflare.com',
    type: 'query',
    path: '/__down',
    param: 'bytes'
  },
  {
    name: 'hetzner',
    base: 'https://speed.hetzner.de',
    type: 'range',
    path: '/1GB.bin'
  },
  {
    name: 'ovh',
    base: 'https://proof.ovh.net',
    type: 'range',
    path: '/files/1Gb.dat'
  }
];

const DEFAULT_UPLOAD = [
  {
    name: 'cloudflare',
    base: 'https://speed.cloudflare.com',
    path: '/__up'
  },
  {
    name: 'postman',
    base: 'https://postman-echo.com',
    path: '/post'
  },
  {
    name: 'httpbin',
    base: 'https://httpbin.org',
    path: '/post'
  }
];

function getClient(url) {
  return url.protocol === 'https:' ? https : http;
}

function buildDownloadUrl(definition, sizeBytes) {
  const base = new URL(definition.base);
  if (definition.type === 'query') {
    const url = new URL(definition.path, base);
    url.searchParams.set(definition.param, String(sizeBytes));
    return { url, range: null };
  }
  const url = new URL(definition.path, base);
  const end = Math.max(0, sizeBytes - 1);
  return { url, range: `bytes=0-${end}` };
}

function buildUploadUrl(definition) {
  const base = new URL(definition.base);
  return new URL(definition.path, base);
}

function createUploadStream(sizeBytes, chunkSize = 64 * 1024) {
  let sent = 0;
  return new Readable({
    read() {
      if (sent >= sizeBytes) {
        this.push(null);
        return;
      }
      const remaining = sizeBytes - sent;
      const currentSize = Math.min(chunkSize, remaining);
      sent += currentSize;
      this.push(Buffer.alloc(currentSize));
    }
  });
}

async function withRetries(fn, retries) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function requestDownload({ url, range, sizeBytes, timeoutMs, onProgress }) {
  return new Promise((resolve, reject) => {
    const client = getClient(url);
    const headers = {};
    if (range) headers.Range = range;

    const start = performance.now();
    let measuring = false;
    let measuredBytes = 0;
    let totalBytes = 0;

    const req = client.request(
      url,
      {
        method: 'GET',
        headers
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          res.resume();
          return;
        }

        res.on('data', (chunk) => {
          totalBytes += chunk.length;
          const elapsed = performance.now() - start;
          if (!measuring && elapsed >= 200) {
            measuring = true;
          }
          if (measuring) {
            measuredBytes += chunk.length;
            if (onProgress) {
              onProgress(measuredBytes, elapsed);
            }
          }
          if (totalBytes >= sizeBytes) {
            res.destroy();
          }
        });

        res.on('end', () => {
          const duration = performance.now() - start;
          resolve({ bytes: measuredBytes, duration });
        });
      }
    );

    req.on('error', (err) => reject(err));
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Request timeout'));
    });
    req.end();
  });
}

function requestUpload({ url, sizeBytes, timeoutMs, onProgress }) {
  return new Promise((resolve, reject) => {
    const client = getClient(url);
    const start = performance.now();
    let sent = 0;
    const stream = createUploadStream(sizeBytes);

    const req = client.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': sizeBytes
        }
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          const duration = performance.now() - start;
          resolve({ bytes: sent, duration });
        });
      }
    );

    req.on('error', (err) => reject(err));
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Request timeout'));
    });

    stream.on('data', (chunk) => {
      sent += chunk.length;
      const elapsed = performance.now() - start;
      if (onProgress) onProgress(sent, elapsed);
    });

    stream.pipe(req);
  });
}

export async function runDownloadTrials({
  trials,
  sizeBytes,
  concurrency,
  timeoutMs,
  retries,
  onProgress,
  overrideServer,
  verbose
}) {
  const candidates = overrideServer
    ? [{ name: 'custom', base: overrideServer, type: 'query', path: '/__down', param: 'bytes' }]
    : DEFAULT_DOWNLOAD;

  let lastError = null;
  for (const candidate of candidates) {
    const trialResults = [];
    const { url, range } = buildDownloadUrl(candidate, Math.ceil(sizeBytes / concurrency));
    const totalSize = sizeBytes;

    try {
      for (let i = 0; i < trials; i += 1) {
        const result = await withRetries(async () => {
          const perStreamBytes = Math.ceil(totalSize / concurrency);
          const streams = [];
          for (let s = 0; s < concurrency; s += 1) {
            streams.push(
              requestDownload({
                url,
                range,
                sizeBytes: perStreamBytes,
                timeoutMs,
                onProgress: onProgress ? (bytes, elapsed) => onProgress(bytes, elapsed, i) : null
              })
            );
          }
          const responses = await Promise.all(streams);
          const bytes = responses.reduce((acc, item) => acc + item.bytes, 0);
          const duration = Math.max(...responses.map((item) => item.duration));
          return { bytes, duration };
        }, retries);
        trialResults.push(result);
      }
      return { server: candidate, trials: trialResults };
    } catch (err) {
      lastError = err;
      if (verbose) {
        console.error(`Download endpoint failed (${candidate.base}): ${err.message}`);
      }
    }
  }

  throw lastError || new Error('No download endpoints available');
}

export async function runUploadTrials({
  trials,
  sizeBytes,
  timeoutMs,
  retries,
  onProgress,
  overrideServer,
  verbose
}) {
  const candidates = overrideServer
    ? [{ name: 'custom', base: overrideServer, path: '/__up' }]
    : DEFAULT_UPLOAD;

  let lastError = null;
  for (const candidate of candidates) {
    const trialResults = [];
    const url = buildUploadUrl(candidate);

    try {
      for (let i = 0; i < trials; i += 1) {
        const result = await withRetries(() =>
          requestUpload({
            url,
            sizeBytes,
            timeoutMs,
            onProgress: onProgress ? (bytes, elapsed) => onProgress(bytes, elapsed, i) : null
          }), retries);
        trialResults.push(result);
      }
      return { server: candidate, trials: trialResults };
    } catch (err) {
      lastError = err;
      if (verbose) {
        console.error(`Upload endpoint failed (${candidate.base}): ${err.message}`);
      }
    }
  }

  throw lastError || new Error('No upload endpoints available');
}
