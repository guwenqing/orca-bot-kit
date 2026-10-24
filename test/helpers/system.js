// The `test` every system test takes, instead of node:test's own.
//
// Loading a node:test file runs it, so a system test loaded by hand — with
// `node --test`, `node -e "import(...)"`, or an editor's runner — would drive
// the real Orca without the announce, the `--yes` and the accounting that
// `scripts/test-system.js` wraps around it (#328). Only that script sets
// OBK_SYSTEM_TESTS, so without it every system test skips and says how to run
// it. This file imports node built-ins and helpers/night-gate.js only: the
// runner's own tests copy them into a throwaway repo.
//
// **The night gate** (#689). Since #676, each bring-up of a bot makes its tabs
// real in the owner's Orca window, and nearly every system test brings one up.
// The owner's rule (2026-10-17): such a test runs only in a run that names its
// file, between midnight and 6 am local time. So every test on this helper is
// gated, with no step of its own: when it starts, it runs only when
// `gateClosed` (helpers/night-gate.js) finds the gate open, and otherwise it
// opens nothing and is reported as skipped, with why. Its file is the one
// `node --test` started, process.argv[1]. A test that does not touch Orca
// takes its `test` from helpers/system-no-orca.js instead, and
// test/repo-guards.test.js checks which helper each file takes. A test that
// starts at night cannot run past 6 am: scripts/test-system.js caps the limit
// of a run that starts at night, so that the run ends by then.

import nodeTest from 'node:test';

import { gateClosed } from './night-gate.js';

const skip = process.env.OBK_SYSTEM_TESTS === '1'
  ? false
  : 'a system test drives the real Orca; run it with: npm run test:system -- --yes <file>';

export default function test(name, fn) {
  return nodeTest(name, { skip }, async (t) => {
    const closed = gateClosed(process.argv[1]);
    if (closed !== undefined) {
      t.skip(closed);
      return undefined;
    }
    return fn(t);
  });
}
