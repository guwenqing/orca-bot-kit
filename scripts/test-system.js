#!/usr/bin/env node

// The system tests: `npm run test:system`. They drive the real `obk` against
// the real Orca on this machine, so no CI runner can run them; that is why they
// are a command of their own and not part of `npm test`.
//
// Orca has to be up for them to mean anything. When it is not, that is a skip
// and not a failure: say so and succeed, rather than report a broken kit.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
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
 */
function testFiles() {
  if (!existsSync(systemTests)) return [];
  return readdirSync(systemTests)
    .filter((name) => name.endsWith('.test.js'))
    .map((name) => path.join(systemTests, name));
}

function run() {
  if (!orcaIsReady()) {
    process.stdout.write(
      'Orca is not answering, so the system tests were skipped.\n'
      + 'Start Orca, or point OBK_ORCA at its CLI, and ask for them again.\n',
    );
    return 0;
  }

  const files = testFiles();
  if (files.length === 0) {
    process.stdout.write(`There are no system test files yet: ${systemTests} holds none.\n`);
    return 0;
  }

  const result = spawnSync(process.execPath, ['--test', ...files], { cwd: repo, stdio: 'inherit' });
  // The test runner answers 0 or 1, and a run killed by a signal answers
  // nothing at all. Anything but a clean 0 means the system tests did not pass.
  return result.status === 0 ? 0 : 1;
}

process.exitCode = run();
