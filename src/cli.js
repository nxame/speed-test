#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

  const { downloadEnabled, uploadEnabled } = normalizeMode(args);
  const noColor = Boolean(process.env.NO_COLOR) || args.noAnsi;
  const isTTY = tty.isatty(process.stdout.fd);
  const useUi = !args.noUi && !args.json && (isTTY || args.forceUi);
  const ui = createUi({ ansi: !noColor, emoji: args.emoji, force: args.forceUi });
  const progressEnabled = !args.json && !useUi;

  const errors = [];
  let exitCode = 0;

  const sizeDownloadMb = args.size ?? 25;
  const sizeUploadMb = args.size ?? 10;

  const serverLabel = args.server ? new URL(args.server).host : 'speed.cloudflare.com';
  const state = {
    serverLabel,
    downloadEnabled,
    uploadEnabled,
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

  const pingPromise = runPing({
    host: args.pingHost,
    count: args.samples,
    timeoutMs: args.timeout
  });
  if (progressEnabled && args.pingOnly) {
    renderPlainProgress('Running ping test...');
  }

  let loadedPingPromise = null;
  if (downloadEnabled) {
    loadedPingPromise = runPing({
      host: args.pingHost,
      count: args.samples,
      timeoutMs: args.timeout
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
        onProgress: (bytes, elapsed) => {
          const mbps = formatMbps(bytes, elapsed);
          state.downloadSamples.push(mbps);
          state.downloadMbps = mbps;
          if (useUi) ui.render(state);
          if (progressEnabled) renderPlainProgress(`Download ${toFixedNumber(mbps, 1)} Mbps`);
        }
      });
    } catch (err) {
      errors.push(`Download failed: ${err.message}`);
    }
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
        onProgress: (bytes, elapsed) => {
          const mbps = formatMbps(bytes, elapsed);
          state.uploadSamples.push(mbps);
          state.uploadMbps = mbps;
          if (useUi) ui.render(state);
          if (progressEnabled) renderPlainProgress(`Upload ${toFixedNumber(mbps, 1)} Mbps`);
        }
      });
    } catch (err) {
      errors.push(`Upload failed: ${err.message}`);
    }
  }

  const pingIdle = await pingPromise;
  state.pingSamples = pingIdle.samples;
  state.pingMedian = pingIdle.median;
  state.pingJitter = pingIdle.jitter;
  state.pingLoss = pingIdle.lossPct;

  if (useUi) ui.render(state);
  if (progressEnabled) endPlainProgress();
  if (useUi) ui.finish();

  let pingLoaded = null;
  if (loadedPingPromise) {
    pingLoaded = await loadedPingPromise;
  }

  if (!downloadResult && !uploadResult) {
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

  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(2);
});
