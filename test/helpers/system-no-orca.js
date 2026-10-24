// The `test` for a system test that does not touch Orca, instead of
// test/helpers/system.js (#689). Such a test runs at any hour, named or not:
// it can make no tab real in the owner's Orca window. Loaded by hand, it
// skips as every system test does (#328).
//
// To make sure it does not touch Orca, this file points OBK_ORCA at a path that
// does not exist, when it is imported: the kit and the tests take their Orca
// CLI from OBK_ORCA, so an Orca call fails at once. And test/repo-guards.test.js
// fails a file on this helper that shows a sign of Orca or the kit.

import nodeTest from 'node:test';

/** Where OBK_ORCA points in a test on this helper: a path no normal user can make. */
export const NO_ORCA = '/obk-system-no-orca/orca';

process.env.OBK_ORCA = NO_ORCA;

const skip = process.env.OBK_SYSTEM_TESTS === '1'
  ? false
  : 'a system test drives the real Orca; run it with: npm run test:system -- --yes <file>';

export default function test(name, fn) {
  return nodeTest(name, { skip }, fn);
}
