const BOOL_FLAGS = new Set([
  '--d',
  '--download-only',
  '--u',
  '--upload-only',
  '--ping-only',
  '--json',
  '--no-ui',
  '--t',
  '--text',
  '--txt',
  '--no-ansi',
  '--emoji',
  '--verbose',
  '--help',
  '--version',
  '--force-ui'
]);

const VALUE_FLAGS = new Set([
  '--server',
  '--ping-host',
  '--samples',
  '--trials',
  '--size',
  '--concurrency',
  '--timeout'
]);

export function parseArgs(argv) {
  const args = {
    downloadOnly: false,
    uploadOnly: false,
    pingOnly: false,
    json: false,
    noUi: false,
    noAnsi: false,
    emoji: false,
    verbose: false,
    help: false,
    version: false,
    forceUi: false,
    server: null,
    pingHost: '1.1.1.1',
    samples: 20,
    trials: 3,
    size: null,
    concurrency: 2,
    timeout: 15000
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (BOOL_FLAGS.has(arg)) {
      switch (arg) {
        case '--d':
        case '--download-only':
          args.downloadOnly = true;
          break;
        case '--u':
        case '--upload-only':
          args.uploadOnly = true;
          break;
        case '--ping-only':
          args.pingOnly = true;
          break;
        case '--json':
          args.json = true;
          break;
        case '--no-ui':
        case '--t':
        case '--text':
        case '--txt':
          args.noUi = true;
          break;
        case '--no-ansi':
          args.noAnsi = true;
          break;
        case '--emoji':
          args.emoji = true;
          break;
        case '--verbose':
          args.verbose = true;
          break;
        case '--help':
          args.help = true;
          break;
        case '--version':
          args.version = true;
          break;
        case '--force-ui':
          args.forceUi = true;
          break;
        default:
          break;
      }
      continue;
    }

    if (VALUE_FLAGS.has(arg)) {
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) {
        return { error: `Missing value for ${arg}` };
      }
      i += 1;
      switch (arg) {
        case '--server':
          args.server = next;
          break;
        case '--ping-host':
          args.pingHost = next;
          break;
        case '--samples':
          args.samples = Number(next);
          break;
        case '--trials':
          args.trials = Number(next);
          break;
        case '--size':
          args.size = Number(next);
          break;
        case '--concurrency':
          args.concurrency = Number(next);
          break;
        case '--timeout':
          args.timeout = Number(next);
          break;
        default:
          break;
      }
      continue;
    }

    return { error: `Unknown flag ${arg}` };
  }

  return { args };
}

export function validateArgs(args) {
  const errors = [];
  if (!Number.isInteger(args.samples) || args.samples < 1) {
    errors.push('Samples must be >= 1.');
  }
  if (!Number.isInteger(args.trials) || args.trials < 1 || args.trials > 10) {
    errors.push('Trials must be between 1 and 10.');
  }
  if (args.size !== null && (!Number.isFinite(args.size) || args.size <= 0)) {
    errors.push('Size must be a positive number.');
  }
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1 || args.concurrency > 8) {
    errors.push('Concurrency must be between 1 and 8.');
  }
  if (!Number.isInteger(args.timeout) || args.timeout < 1000) {
    errors.push('Timeout must be >= 1000ms.');
  }

  if (args.downloadOnly && args.uploadOnly) {
    errors.push('Choose either download-only or upload-only, not both.');
  }

  return errors;
}

export function normalizeMode(args) {
  const downloadEnabled = !args.uploadOnly && !args.pingOnly;
  const uploadEnabled = !args.downloadOnly && !args.pingOnly;
  return { downloadEnabled, uploadEnabled };
}
