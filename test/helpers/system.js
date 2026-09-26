// The `test` every system test takes, instead of node:test's own.
//
// Loading a node:test file runs it, so a system test loaded by hand — with
// `node --test`, `node -e "import(...)"`, or an editor's runner — would drive
// the real Orca without the announce, the `--yes` and the accounting that
// `scripts/test-system.js` wraps around it (#328). Only that script sets
// OBK_SYSTEM_TESTS, so without it every system test skips and says how to run
// it. This file imports node built-ins only: the runner's own tests copy it
// into a throwaway repo.

import nodeTest from 'node:test';

const skip = process.env.OBK_SYSTEM_TESTS === '1'
  ? false
  : 'a system test drives the real Orca; run it with: npm run test:system -- --yes <file>';

export default function test(name, fn) {
  return nodeTest(name, { skip }, fn);
}
