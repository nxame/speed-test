#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const base = ['node', './src/cli.js'];
const defaultArgs = ['--json', '--size', '1', '--trials', '1', '--samples', '2', '--timeout', '5000'];

function report(label) {
  const check = '\u001b[32m\u2713\u001b[0m';
  console.log(`${check} ${label}`);
}

function run(args, { expectCode = 0, json = false, label } = {}) {
  const result = spawnSync(base[0], [...base.slice(1), ...args], {
    encoding: 'utf8',
    timeout: 30000
  });

  if (result.error && result.error.code === 'ETIMEDOUT') {
    console.error(`Timed out: ${args.join(' ')}`);
    process.exit(1);
  }

  if (result.status !== expectCode) {
    console.error(`Expected exit ${expectCode} for ${args.join(' ')}, got ${result.status}`);
    if (result.stdout) console.error(`stdout:\n${result.stdout}`);
    if (result.stderr) console.error(`stderr:\n${result.stderr}`);
    process.exit(1);
  }

  if (!json) {
    if (label) report(label);
    return null;
  }
  try {
    const payload = JSON.parse(result.stdout);
    return payload;
  } catch (err) {
    console.error(`Invalid JSON for ${args.join(' ')}`);
    if (result.stdout) console.error(`stdout:\n${result.stdout}`);
    if (result.stderr) console.error(`stderr:\n${result.stderr}`);
    process.exit(1);
  }
}

function ensureOnline(payload) {
  if (!payload) return;
  if (payload.errors && payload.errors.includes('Offline')) {
    console.error('Offline: cannot run CLI matrix tests.');
    process.exit(1);
  }
}

function expectNull(label, value) {
  if (value !== null) {
    console.error(`Expected ${label} to be null.`);
    process.exit(1);
  }
}

function expectNotNull(label, value) {
  if (value === null || value === undefined) {
    console.error(`Expected ${label} to be present.`);
    process.exit(1);
  }
}

const defaultResult = run(defaultArgs, { json: true, label: 'net-speed (default)' });
ensureOnline(defaultResult);
expectNotNull('metrics.download_mbps', defaultResult.metrics.download_mbps);
expectNotNull('metrics.upload_mbps', defaultResult.metrics.upload_mbps);
expectNotNull('metrics.latency_idle_ms', defaultResult.metrics.latency_idle_ms);
expectNotNull('metrics.latency_loaded_ms', defaultResult.metrics.latency_loaded_ms);
report('net-speed (default) metrics');

const downloadOnly = run([...defaultArgs, '--d'], { json: true, label: 'net-speed --d' });
ensureOnline(downloadOnly);
expectNotNull('metrics.download_mbps', downloadOnly.metrics.download_mbps);
expectNull('metrics.upload_mbps', downloadOnly.metrics.upload_mbps);
expectNotNull('metrics.latency_idle_ms', downloadOnly.metrics.latency_idle_ms);
expectNotNull('metrics.latency_loaded_ms', downloadOnly.metrics.latency_loaded_ms);
report('net-speed --d metrics');

const uploadOnly = run([...defaultArgs, '--u'], { json: true, label: 'net-speed --u' });
ensureOnline(uploadOnly);
expectNull('metrics.download_mbps', uploadOnly.metrics.download_mbps);
expectNotNull('metrics.upload_mbps', uploadOnly.metrics.upload_mbps);
expectNotNull('metrics.latency_idle_ms', uploadOnly.metrics.latency_idle_ms);
expectNull('metrics.latency_loaded_ms', uploadOnly.metrics.latency_loaded_ms);
report('net-speed --u metrics');

const pingOnly = run(['--json', '--ping-only', '--samples', '2', '--timeout', '5000'], { json: true, label: 'net-speed --ping-only' });
ensureOnline(pingOnly);
expectNull('metrics.download_mbps', pingOnly.metrics.download_mbps);
expectNull('metrics.upload_mbps', pingOnly.metrics.upload_mbps);
expectNotNull('metrics.latency_idle_ms', pingOnly.metrics.latency_idle_ms);
expectNull('metrics.latency_loaded_ms', pingOnly.metrics.latency_loaded_ms);
report('net-speed --ping-only metrics');

run(['--no-ui', '--d', '--size', '1', '--trials', '1', '--samples', '2', '--timeout', '5000'], { label: 'net-speed --no-ui --d' });
run(['--no-ansi', '--json', '--size', '1', '--trials', '1', '--samples', '2', '--timeout', '5000'], { label: 'net-speed --no-ansi --json' });
run(['--json', '--concurrency', '1', '--size', '1', '--trials', '1', '--samples', '2', '--timeout', '5000'], { label: 'net-speed --concurrency 1' });
run(['--unknown'], { expectCode: 1, label: 'net-speed --unknown (expected failure)' });

console.log('CLI matrix tests passed.');
