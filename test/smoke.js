#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const base = ['node', './src/cli.js'];

function run(args, { expectCode = 0 } = {}) {
  const result = spawnSync(base[0], [...base.slice(1), ...args], {
    encoding: 'utf8'
  });
  if (result.status !== expectCode) {
    console.error(`Expected exit ${expectCode} for ${args.join(' ')}, got ${result.status}`);
    process.exit(1);
  }
}

run(['--version']);
run(['--help']);
run(['--samples', '5', '--ping-only']);
run(['--trials', '2', '--d']);
run(['--unknown'], { expectCode: 1 });

console.log('Smoke tests passed.');
