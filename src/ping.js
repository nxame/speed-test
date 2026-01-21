import { spawn } from 'node:child_process';
import { jitter, mean, median } from './stats.js';

function buildPingArgs({ host, count, timeoutMs }) {
  const platform = process.platform;
  if (platform === 'win32') {
    return ['-n', String(count), '-w', String(timeoutMs), host];
  }
  if (platform === 'darwin') {
    return ['-c', String(count), '-W', String(timeoutMs), host];
  }
  const timeoutSec = Math.ceil(timeoutMs / 1000);
  return ['-c', String(count), '-W', String(timeoutSec), host];
}

function parsePingOutput(output, count) {
  const rtts = [];
  const regex = /time[=<]?\s*([\d.]+)\s*ms/gi;
  let match;
  while ((match = regex.exec(output)) !== null) {
    rtts.push(Number(match[1]));
  }

  let lossPct = null;
  const lossMatch = output.match(/(\d+(?:\.\d+)?)%\s*packet loss/i);
  if (lossMatch) {
    lossPct = Number(lossMatch[1]);
  }

  const winMatch = output.match(/Sent = (\d+),\s*Received = (\d+),\s*Lost = (\d+)/i);
  if (winMatch) {
    const sent = Number(winMatch[1]);
    const lost = Number(winMatch[3]);
    lossPct = sent > 0 ? (lost / sent) * 100 : null;
  }

  if (lossPct === null) {
    const lost = Math.max(0, count - rtts.length);
    lossPct = count > 0 ? (lost / count) * 100 : null;
  }

  return {
    samples: rtts,
    lossPct,
    median: median(rtts),
    mean: mean(rtts),
    jitter: jitter(rtts)
  };
}

export function runPing({ host, count, timeoutMs, signal }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'));
      return;
    }
    const args = buildPingArgs({ host, count, timeoutMs });
    const proc = spawn('ping', args, { windowsHide: true });
    let settled = false;
    let stdout = '';
    let stderr = '';

    const onAbort = () => {
      if (settled) return;
      settled = true;
      proc.kill();
      reject(new Error('Aborted'));
    };

    if (signal) {
      signal.addEventListener('abort', onAbort);
    }

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(err);
    });

    proc.on('close', () => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      const combined = `${stdout}\n${stderr}`;
      resolve(parsePingOutput(combined, count));
    });
  });
}
