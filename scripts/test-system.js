#!/usr/bin/env node

// The system tests: `npm run test:system -- --yes`. They drive the real `obk`
// against the real Orca on this machine, so no CI runner can run them; that is
// why they are a command of their own and not part of `npm test`.
//
// Orca has to be up for them to mean anything. When it is not, that is a skip
// and not a failure: say so and succeed, rather than report a broken kit.
//
// And nobody drives someone's working machine by accident. These tests make
// Orca projects, open tabs in them, start real harnesses and close the tabs
// they made, on the machine the command was typed on. So the command says what
// it is about to drive before it drives any of it, and then does nothing unless
// it was asked in as many words. A run that was not confirmed did not run the
// tests, and does not answer as though it had.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This file lives in <repo>/scripts/, and the tests are always its own repo's,
// whatever directory the command was called from.
const repo = path.resolve(fileURLToPath(import.meta.url), '../..');
const systemTests = path.join(repo, 'test', 'system');

// The Orca CLI that works for a normal user: `/usr/local/bin/orca` is a
// root-only symlink on this machine (tech notes, section 1). OBK_ORCA overrides
// it, for a machine that keeps Orca somewhere else.
const ORCA = '/Applications/Orca.app/Contents/Resources/bin/orca';

/**
 * Whether Orca is up with its runtime reachable — the only state in which a
 * system test means anything. That the CLI answered is not enough: the
 * root-only symlink prints an error and still exits 0, so the answer counts
 * only when it is the JSON that says a runtime is there.
 */
function orcaIsReady() {
  const asked = spawnSync(process.env.OBK_ORCA || ORCA, ['status', '--json']);
  if (asked.error || asked.status !== 0) return false;

  let status;
  try {
    status = JSON.parse(asked.stdout);
  } catch {
    return false;
  }
  // `null` is valid JSON with nothing to say, and so is anything else that
  // does not carry a runtime that calls itself reachable.
  return status !== null && status.ok === true && status.result?.runtime?.reachable === true;
}

/**
 * The system test files, named one by one. `node --test` with nothing to run
 * goes hunting through the whole tree instead, which would drag the ordinary
 * suite into a run meant for these.
 *
 * Subfolders count. Grouping system tests by feature is the obvious next step,
 * and `npm test` does not match them either, so a file one folder deeper would
 * be run by nobody while both commands still reported success.
 */
function testFiles() {
  if (!existsSync(systemTests)) return [];
  return readdirSync(systemTests, { recursive: true })
    .filter((name) => name.endsWith('.test.js'))
    .map((name) => path.join(systemTests, name));
}

/**
 * Which Orca this run would ask, and how it came to be that one. A developer
 * reading a skip needs to know which Orca was asked before they can tell
 * whether the skip is right.
 */
function orcaCli() {
  const named = process.env.OBK_ORCA;
  return named
    ? { path: named, from: 'OBK_ORCA names it' }
    : { path: ORCA, from: 'the built-in default; OBK_ORCA names another' };
}

/** The word that says the developer meant it. */
const CONFIRM = '--yes';

const asked = () => process.argv.slice(2).includes(CONFIRM);

/**
 * What this run is about to drive, said before it drives any of it: whose
 * machine, which Orca, and which files. Printed whatever happens next, because
 * it is as much use to somebody reading a skip as to somebody about to be
 * driven over.
 */
function announce(cli, files) {
  const lines = [
    `The system tests drive this machine: ${os.userInfo().username}@${os.hostname()}.`,
    `Orca: ${cli.path}  (${cli.from})`,
    files.length === 0
      ? `No system test files: ${systemTests} holds none.`
      : `${files.length} system test file${files.length === 1 ? '' : 's'}:`,
    ...files.map((file) => `  ${path.relative(repo, file)}`),
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

/**
 * What those files do to the machine, in the words somebody needs before they
 * say yes. It is not a warning to be clicked through: every line of it is
 * something the run leaves on the machine it was typed on.
 */
function whatItDoes() {
  process.stdout.write([
    '',
    'They will, on this machine and in this Orca:',
    '  make Orca projects and open tabs in them,',
    '  start real Claude Code and Codex sessions in those tabs,',
    '  close the tabs they opened, and remove the projects and folders they made,',
    '  and leave one orchestration Run per session behind, which Orca offers no way to delete.',
    'They touch only what they create. Nothing else in your Orca is theirs.',
    '',
    '',
  ].join('\n'));
}

function run() {
  const cli = orcaCli();

  if (!orcaIsReady()) {
    announce(cli, testFiles());
    process.stdout.write(
      '\nIts runtime is not reachable, so the system tests were skipped and nothing ran.\n'
      + 'Start Orca, or point OBK_ORCA at its CLI, and ask for them again.\n',
    );
    return 0;
  }

  const files = testFiles();
  if (files.length === 0) {
    // Nothing to drive is nothing to confirm, so this is not the unconfirmed
    // case below: there is no question to have answered.
    process.stdout.write(`There are no system test files yet: ${systemTests} holds none.\n`);
    return 0;
  }

  announce(cli, files);
  whatItDoes();

  if (!asked()) {
    process.stdout.write(
      `Nothing was driven. The command on its own does not run them.\n`
      + `To run them, having read the above:  npm run test:system -- ${CONFIRM}\n`,
    );
    // Not 0: a run that did not run the system tests must not be mistaken for
    // one that ran them and found nothing wrong.
    return 2;
  }

  const result = spawnSync(process.execPath, ['--test', ...files], { cwd: repo, stdio: 'inherit' });
  // The test runner answers 0 or 1, and a run killed by a signal answers
  // nothing at all. Anything but a clean 0 means the system tests did not pass.
  return result.status === 0 ? 0 : 1;
}

process.exitCode = run();
