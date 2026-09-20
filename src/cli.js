#!/usr/bin/env node

// `obk` — the Orca Bot Kit command line. Bot Father's skills call it; a person
// can too. It writes files and reports what it did; it never commits.
//
// The caller is normally an LLM running a setup step, so every command says
// plainly what it made and what still wants looking at, and `--json` gives it
// the same facts to act on.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { initBots } from './init.js';
import { orcaTrouble } from './orca.js';
import { bringUp } from './up.js';

const USAGE = `obk — Orca Bot Kit.

Usage:
  obk init --bots <path> --harness claude|codex
                            Create your bots folder: a git repo holding your
                            bots' configuration, with Bot Father in it, and
                            open Bot Father in Orca.
  obk up --bots <path>      Open whatever Bot Father is missing in Orca.
                            It only ever adds; it never closes a tab.
  obk --version             Print the kit's version.
  obk --help                Print this text.

Both commands are safe to run again: they add what is missing and nothing else.
Add --json to either for the same answer as JSON.
`;

const HARNESSES = ['claude', 'codex'];

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
      harness: { type: 'string' },
      json: { type: 'boolean' },
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
  if (command !== 'init' && command !== 'up') {
    throw new Error(`there is no "${command}" command. Run obk --help to see what there is.`);
  }

  if (values.bots === undefined) {
    throw new Error(`${command} needs --bots <path>: where your bots folder is.`);
  }
  if (values.bots.trim() === '') {
    throw new Error('--bots needs a path.');
  }
  const harness = command === 'init' ? harnessFor(values.harness) : undefined;

  // Asked before anything is written, so an Orca that is down leaves the disk
  // exactly as it was and the caller can simply run the command again.
  const trouble = orcaTrouble();
  if (trouble !== undefined) throw new Error(trouble);

  const seeded = command === 'init' ? initBots(values.bots, harness) : { bots: path.resolve(values.bots), created: [] };
  const tabs = bringUp(seeded.bots);

  process.stdout.write(values.json
    ? `${JSON.stringify({ bots: seeded.bots, created: seeded.created, tabs }, null, 2)}\n`
    : report(seeded, tabs));
  return 0;
}

function harnessFor(harness) {
  if (harness === undefined) {
    throw new Error(`init needs --harness ${HARNESSES.join('|')}: which harness Bot Father runs on.`);
  }
  if (!HARNESSES.includes(harness)) {
    throw new Error(`--harness is ${HARNESSES.join(' or ')}, and got: ${harness}`);
  }
  return harness;
}

/** The same facts as `--json`, as lines, for a person reading along. */
function report({ bots, created }, tabs) {
  const lines = created.map((entry) => `created  ${entry}`);

  for (const tab of tabs) {
    lines.push(`${tab.created ? 'opened ' : 'found  '} ${tab.title}  tab ${tab.tabId}  terminal ${tab.terminal}`);
  }

  const busy = tabs.filter((tab) => tab.created && tab.name !== null && !tab.harnessTyped);
  for (const tab of busy) {
    lines.push(
      `         ${tab.title} was busy, so nothing was typed into it. Look at it with:`
      + `\n           orca terminal read --terminal ${tab.terminal} --screen`,
    );
  }

  lines.push(`Bot Father is up in Orca. Your bots folder: ${bots}`);
  return `${lines.join('\n')}\n`;
}

try {
  process.exitCode = run(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`obk: ${error.message}\n`);
  process.exitCode = 1;
}
