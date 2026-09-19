#!/usr/bin/env node

// `obk` — the Orca Bot Kit command line. Bot Father's skills call it; a person
// can too. It writes files and reports what it did; it never commits.

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { initBots } from './init.js';

const USAGE = `obk — Orca Bot Kit.

Usage:
  obk init --bots <path>    Create your bots folder: a git repo holding your
                            bots' configuration, with Bot Father in it.
                            Safe to run again; it only adds what is missing.
  obk --version             Print the kit's version.
  obk --help                Print this text.
`;

function version() {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  return pkg.version;
}

function run(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      bots: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean' },
    },
  });

  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (values.version) {
    process.stdout.write(`${version()}\n`);
    return 0;
  }

  const [command, ...extra] = positionals;
  if (command === undefined) {
    process.stderr.write(USAGE);
    return 1;
  }
  if (extra.length > 0) {
    throw new Error(`${command} takes no other arguments, and got: ${extra.join(' ')}`);
  }
  if (command !== 'init') {
    throw new Error(`there is no "${command}" command. Run obk --help to see what there is.`);
  }

  if (values.bots === undefined) {
    throw new Error('init needs --bots <path>: where to create your bots folder.');
  }
  if (values.bots.trim() === '') {
    throw new Error('--bots needs a path.');
  }

  const { bots, created } = initBots(values.bots);
  for (const entry of created) {
    process.stdout.write(`created  ${entry}\n`);
  }
  process.stdout.write(
    created.length === 0
      ? `Your bots folder was already complete: ${bots}\n`
      : `Your bots folder is ready: ${bots}\n`,
  );
  return 0;
}

try {
  process.exitCode = run(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`obk: ${error.message}\n`);
  process.exitCode = 1;
}
