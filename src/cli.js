#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns/promises';
import net from 'node:net';
import tty from 'node:tty';
import { parseArgs, validateArgs, normalizeMode } from './args.js';
import { runPing } from './ping.js';
import { runDownloadTrials, runUploadTrials } from './http.js';
import { createUi, renderPlainProgress, endPlainProgress } from './ui.js';
import { summarize, toFixedNumber, mean, median, jitter } from './stats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

function printHelp() {
  console.log(`net-speed ${pkg.version}

Usage: net-speed [options]

Options:
  --d, --download-only   Run ping + download only
  --u, --upload-only     Run ping + upload only
  --ping-only            Run ping only
  --json                 JSON output
  --no-ui, --t, --text   Plain text output
  --no-ansi              Disable ANSI colors
  --emoji                Enable emojis
  --server <url>         Override base server URL
  --ping-host <host>     Ping target (default 1.1.1.1)
  --samples <n>          Ping samples (default 20)
  --trials <n>           Throughput trials (default 3, max 10)
  --size <mb>            Transfer size per trial
  --concurrency <n>      Parallel download streams (default 2)
  --timeout <ms>         Request timeout (default 15000)
  --verbose              Verbose logging
  --help                 Show help
  --version              Show version
`);
}

function formatMbps(bytes, durationMs) {
  if (!bytes || !durationMs) return 0;
  return (bytes * 8) / (durationMs / 1000) / 1e6;
}

async function checkOnline({ host, timeoutMs }) {
  try {
    await dns.lookup(host);
  } catch (err) {
    return { online: false, reason: `DNS lookup failed for ${host}` };
  }

  const timeout = Math.min(Math.max(1000, Math.floor(timeoutMs / 5)), 3000);
  try {
    await new Promise((resolve, reject) => {
      const socket = net.connect({ host, port: 443 });
      const timer = setTimeout(() => {
        socket.destroy(new Error('Timeout'));
      }, timeout);

      socket.once('connect', () => {
        clearTimeout(timer);
        socket.end();
        resolve();
      });
      socket.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    return { online: true };
  } catch (err) {
    return { online: false, reason: `Network check failed (${err.message})` };
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error) {
    console.error(parsed.error);
    process.exit(1);
  }

  const args = parsed.args;
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  if (args.version) {
    console.log(pkg.version);
    process.exit(0);
  }

  const validationErrors = validateArgs(args);
  if (validationErrors.length) {
    validationErrors.forEach((err) => console.error(err));
    process.exit(1);
  }

  const noColor = Boolean(process.env.NO_COLOR) || args.noAnsi;
  const serverHost = args.server ? new URL(args.server).hostname : 'speed.cloudflare.com';
  const buildOfflineResponse = () => ({
    version: pkg.version,
    timestamp: new Date().toISOString(),
    server: null,
    ping_host: args.pingHost,
    samples: args.samples,
    trials: args.trials,
    metrics: {
      download_mbps: null,
      upload_mbps: null,
      latency_idle_ms: null,
      latency_loaded_ms: null
    },
    errors: ['Offline']
  });
  const emitOffline = (hasUi) => {
    if (args.json) {
      console.log(JSON.stringify(buildOfflineResponse(), null, 2));
      return;
    }
    if (hasUi) return;
    const offlineEmoji = args.emoji ? '🔴 ' : '';
    const offlineText = `${offlineEmoji}Offline`;
    if (noColor) {
      console.log(offlineText);
    } else {
      console.log(`\u001b[31m${offlineText}\u001b[0m`);
    }
  };

  const onlineTarget = args.pingOnly ? args.pingHost : serverHost;
  const onlineCheck = await checkOnline({ host: onlineTarget, timeoutMs: args.timeout });
  if (!onlineCheck.online) {
    emitOffline(false);
    process.exitCode = 4;
    return;
  }

  const { downloadEnabled, uploadEnabled } = normalizeMode(args);
  const isTTY = tty.isatty(process.stdout.fd);
  const useUi = !args.noUi && !args.json && (isTTY || args.forceUi);
  const ui = createUi({ ansi: !noColor, emoji: args.emoji, force: args.forceUi });
  const progressEnabled = !args.json && !useUi;
  const abortController = new AbortController();
  const { signal } = abortController;

  const errors = [];
  let exitCode = 0;

  const sizeDownloadMb = args.size ?? 25;
  const sizeUploadMb = args.size ?? 10;

  const serverLabel = args.server ? new URL(args.server).host : 'speed.cloudflare.com';
  const state = {
    serverLabel,
    downloadEnabled,
    uploadEnabled,
    networkOnline: true,
    downloadSamples: [],
    uploadSamples: [],
    pingSamples: [],
    pingMedian: null,
    pingJitter: null,
    pingLoss: null,
    downloadMbps: null,
    uploadMbps: null
  };

  if (useUi) {
    ui.render(state);
  }

  let offlineReported = false;
  let monitorTimer = null;
  let monitorRunning = false;
  const monitorHost = args.pingOnly ? args.pingHost : serverHost;
  let pingPromise = null;
  let loadedPingPromise = null;
  const finishOffline = () => {
    if (monitorTimer) clearInterval(monitorTimer);
    if (progressEnabled) endPlainProgress();
    if (useUi) ui.finish();
    if (pingPromise) pingPromise.catch(() => {});
    if (loadedPingPromise) loadedPingPromise.catch(() => {});
    emitOffline(useUi);
    process.exitCode = 4;
  };
  if (downloadEnabled || uploadEnabled || args.pingOnly) {
    monitorTimer = setInterval(async () => {
      if (monitorRunning || offlineReported) return;
      monitorRunning = true;
      try {
        const status = await checkOnline({ host: monitorHost, timeoutMs: args.timeout });
        if (!status.online) {
          offlineReported = true;
          state.networkOnline = false;
          errors.push('Offline');
          abortController.abort();
          if (useUi) ui.render(state);
        }
      } finally {
        monitorRunning = false;
      }
    }, 1500);
  }

  pingPromise = runPing({
    host: args.pingHost,
    count: args.samples,
    timeoutMs: args.timeout,
    signal
  });
  if (progressEnabled && args.pingOnly) {
    renderPlainProgress('Running ping test...');
  }

  if (downloadEnabled) {
    loadedPingPromise = runPing({
      host: args.pingHost,
      count: args.samples,
      timeoutMs: args.timeout,
      signal
    });
  }

  let downloadResult = null;
  let uploadResult = null;

  if (downloadEnabled) {
    if (progressEnabled) renderPlainProgress('Running download test...');
    try {
      downloadResult = await runDownloadTrials({
        trials: args.trials,
        sizeBytes: Math.round(sizeDownloadMb * 1024 * 1024),
        concurrency: args.concurrency,
        timeoutMs: args.timeout,
        retries: 2,
        overrideServer: args.server,
        verbose: args.verbose,
        signal,
        onProgress: (bytes, elapsed) => {
          const mbps = formatMbps(bytes, elapsed);
          state.downloadSamples.push(mbps);
          state.downloadMbps = mbps;
          if (useUi) ui.render(state);
          if (progressEnabled) renderPlainProgress(`Download ${toFixedNumber(mbps, 1)} Mbps`);
        }
      });
    } catch (err) {
      if (!offlineReported && !signal.aborted) {
        errors.push(`Download failed: ${err.message}`);
      }
    }
  }

  if (offlineReported || signal.aborted) {
    finishOffline();
    return;
  }

  if (uploadEnabled) {
    if (progressEnabled) renderPlainProgress('Running upload test...');
    try {
      uploadResult = await runUploadTrials({
        trials: args.trials,
        sizeBytes: Math.round(sizeUploadMb * 1024 * 1024),
        timeoutMs: args.timeout,
        retries: 2,
        overrideServer: args.server,
        verbose: args.verbose,
        signal,
        onProgress: (bytes, elapsed) => {
          const mbps = formatMbps(bytes, elapsed);
          state.uploadSamples.push(mbps);
          state.uploadMbps = mbps;
          if (useUi) ui.render(state);
          if (progressEnabled) renderPlainProgress(`Upload ${toFixedNumber(mbps, 1)} Mbps`);
        }
      });
    } catch (err) {
      if (!offlineReported && !signal.aborted) {
        errors.push(`Upload failed: ${err.message}`);
      }
    }
  }

  if (offlineReported || signal.aborted) {
    finishOffline();
    return;
  }

  let pingIdle = null;
  try {
    pingIdle = await pingPromise;
  } catch (err) {
    if (offlineReported || signal.aborted) {
      finishOffline();
      return;
    }
    errors.push(`Ping failed: ${err.message}`);
    pingIdle = {
      samples: [],
      median: null,
      mean: null,
      jitter: null,
      lossPct: null
    };
  }
  state.pingSamples = pingIdle.samples;
  state.pingMedian = pingIdle.median;
  state.pingJitter = pingIdle.jitter;
  state.pingLoss = pingIdle.lossPct;

  if (useUi) ui.render(state);
  if (progressEnabled) endPlainProgress();
  if (useUi) ui.finish();
  if (monitorTimer) clearInterval(monitorTimer);

  let pingLoaded = null;
  if (loadedPingPromise) {
    try {
      pingLoaded = await loadedPingPromise;
    } catch (err) {
      if (offlineReported || signal.aborted) {
        finishOffline();
        return;
      }
      errors.push(`Loaded ping failed: ${err.message}`);
    }
  }

  if (args.pingOnly) {
    exitCode = 0;
  } else if (!downloadResult && !uploadResult) {
    exitCode = 2;
  } else if ((downloadEnabled && !downloadResult) || (uploadEnabled && !uploadResult)) {
    exitCode = 3;
  }

  const downloadTrials = downloadResult
    ? downloadResult.trials.map((trial) => formatMbps(trial.bytes, trial.duration))
    : null;
  const uploadTrials = uploadResult
    ? uploadResult.trials.map((trial) => formatMbps(trial.bytes, trial.duration))
    : null;

  const response = {
    version: pkg.version,
    timestamp: new Date().toISOString(),
    server: args.server ? new URL(args.server).host : 'speed.cloudflare.com',
    ping_host: args.pingHost,
    samples: args.samples,
    trials: args.trials,
    metrics: {
      download_mbps: downloadTrials
        ? {
            median: median(downloadTrials),
            mean: mean(downloadTrials),
            p95: downloadTrials.length >= 5 ? summarize(downloadTrials, { includeP95: true }).p95 : null,
            trials: downloadTrials
          }
        : null,
      upload_mbps: uploadTrials
        ? {
            median: median(uploadTrials),
            mean: mean(uploadTrials),
            p95: uploadTrials.length >= 5 ? summarize(uploadTrials, { includeP95: true }).p95 : null,
            trials: uploadTrials
          }
        : null,
      latency_idle_ms: {
        median: pingIdle.median,
        mean: pingIdle.mean,
        jitter: pingIdle.jitter,
        loss_pct: pingIdle.lossPct,
        samples: pingIdle.samples
      },
      latency_loaded_ms: pingLoaded
        ? {
            median: pingLoaded.median,
            mean: pingLoaded.mean,
            jitter: pingLoaded.jitter,
            loss_pct: pingLoaded.lossPct,
            samples: pingLoaded.samples
          }
        : null
    },
    errors
  };

  if (args.json) {
    console.log(JSON.stringify(response, null, 2));
  } else if (!useUi) {
    console.log(`Server: ${response.server}`);
    console.log(`Ping: ${toFixedNumber(pingIdle.median, 1)} ms (jitter ${toFixedNumber(pingIdle.jitter, 1)} ms, loss ${toFixedNumber(pingIdle.lossPct, 1)}%)`);
    if (downloadTrials) {
      console.log(`Download: ${toFixedNumber(median(downloadTrials), 1)} Mbps`);
    }
    if (uploadTrials) {
      console.log(`Upload: ${toFixedNumber(median(uploadTrials), 1)} Mbps`);
    }
    if (errors.length) {
      console.log(`Errors: ${errors.join('; ')}`);
    }
  }

  process.exitCode = exitCode;
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 2;
});
