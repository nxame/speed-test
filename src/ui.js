import readline from 'node:readline';
import tty from 'node:tty';
import { sparkline } from './sparkline.js';
import { toFixedNumber } from './stats.js';

const COLORS = {
  cyan: '\u001b[36m',
  purple: '\u001b[35m',
  green: '\u001b[32m',
  dim: '\u001b[2m',
  reset: '\u001b[0m'
};

function colorize(enabled, color, text) {
  if (!enabled) return text;
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

function padLine(text, width) {
  const clean = text.replace(/\u001b\[[0-9;]*m/g, '');
  const padding = Math.max(0, width - clean.length);
  return `${text}${' '.repeat(padding)}`;
}

function buildBox(lines, width) {
  const top = `┌${'─'.repeat(width - 2)}┐`;
  const bottom = `└${'─'.repeat(width - 2)}┘`;
  const body = lines.map((line) => `│${padLine(line, width - 2)}│`);
  return [top, ...body, bottom];
}

export function createUi({ ansi, emoji, force }) {
  const isTTY = tty.isatty(process.stdout.fd);
  const enabled = force || isTTY;
  let hidden = false;

  function hideCursor() {
    if (enabled && !hidden) {
      process.stdout.write('\u001b[?25l');
      hidden = true;
    }
  }

  function showCursor() {
    if (enabled && hidden) {
      process.stdout.write('\u001b[?25h');
      hidden = false;
    }
  }

  function render(state) {
    if (!enabled) return;
    const width = Math.min(process.stdout.columns || 80, 78);
    const lines = [];
    lines.push(
      padLine(
        `${colorize(ansi, 'dim', 'net-speed')} ${colorize(ansi, 'cyan', '>')} ${state.serverLabel}`,
        width - 2
      )
    );
    lines.push('');

    if (state.downloadEnabled) {
      const label = emoji ? '⬇ DOWNLOAD SPEED' : 'DOWNLOAD SPEED';
      lines.push(colorize(ansi, 'cyan', label));
      lines.push(` ${toFixedNumber(state.downloadMbps ?? 0, 1)} Mbps`);
      lines.push(` ${sparkline(state.downloadSamples, width - 4)}`);
      lines.push('');
    }

    lines.push(colorize(ansi, 'purple', emoji ? '📶 PING LATENCY' : 'PING LATENCY'));
    lines.push(
      ` ${toFixedNumber(state.pingMedian ?? 0, 1)} ms   jitter ${toFixedNumber(
        state.pingJitter ?? 0,
        1
      )} ms   loss ${toFixedNumber(state.pingLoss ?? 0, 1)}%`
    );
    lines.push(` ${sparkline(state.pingSamples, width - 4)}`);
    lines.push('');

    if (state.uploadEnabled) {
      const label = emoji ? '⬆ UPLOAD SPEED' : 'UPLOAD SPEED';
      lines.push(colorize(ansi, 'green', label));
      lines.push(` ${toFixedNumber(state.uploadMbps ?? 0, 1)} Mbps`);
      lines.push(` ${sparkline(state.uploadSamples, width - 4)}`);
    }

    const box = buildBox(lines, width);
    hideCursor();
    readline.cursorTo(process.stdout, 0, 0);
    readline.clearScreenDown(process.stdout);
    process.stdout.write(`${box.join('\n')}\n`);
  }

  function finish() {
    showCursor();
  }

  return {
    enabled,
    render,
    finish,
    supportsUi: enabled
  };
}

export function renderPlainProgress(text) {
  process.stdout.write(`\r${text.padEnd(process.stdout.columns || 80, ' ')}`);
}

export function endPlainProgress() {
  process.stdout.write('\n');
}
