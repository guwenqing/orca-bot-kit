// The gate for the steps of a system test that make a throwaway tab real in
// the owner's Orca window: `namedThisRun(file)` and `atNight(at)` in
// test/helpers/night-gate.js. Since #676, a bring-up (`obk init`, `obk up`,
// `obk restart`, `obk unpause`, `obk temp make`) makes the tab it opens real.
// So a test gates every step from its first bring-up on (#687).
//
// The owner's rule (2026-10-17): such a step runs only in a run that names its
// file, between midnight and 6 am local time. The runner says which files a
// run named in OBK_SYSTEM_NAMED, one absolute path per line, and the empty
// string for a run of them all (scripts/test-system.js).
//
// Run here on real files in a throwaway folder; nothing here talks to Orca.

import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { atNight, gateClosed, namedThisRun } from './helpers/night-gate.js';

/** The repo root as night-gate.js sees it: two folders up from test/helpers/night-gate.js. */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Set OBK_SYSTEM_NAMED to `value` (undefined takes it out) until the test ends, and put it back as it was after. */
function namedAs(t, value) {
  const had = Object.hasOwn(process.env, 'OBK_SYSTEM_NAMED');
  const was = process.env.OBK_SYSTEM_NAMED;
  if (value === undefined) delete process.env.OBK_SYSTEM_NAMED;
  else process.env.OBK_SYSTEM_NAMED = value;
  t.after(() => {
    if (had) process.env.OBK_SYSTEM_NAMED = was;
    else delete process.env.OBK_SYSTEM_NAMED;
  });
}

/** A throwaway folder with two test files in it, `a.test.js` and `b.test.js`, removed when the test ends. */
async function twoFiles(t) {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-night-gate-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const a = path.join(dir, 'a.test.js');
  const b = path.join(dir, 'b.test.js');
  await writeFile(a, '');
  await writeFile(b, '');
  return { dir, a, b };
}

// ------------------------------------------------------------- namedThisRun

test('a run that names the file, alone or among others, names it', async (t) => {
  const { a, b } = await twoFiles(t);
  namedAs(t, a);
  assert.equal(namedThisRun(a), true, 'the file alone');
  process.env.OBK_SYSTEM_NAMED = `${b}\n${a}\n`;
  assert.equal(namedThisRun(a), true, 'the file among others, with a last newline');
});

test('a run that names only another file does not name this one', async (t) => {
  const { a, b } = await twoFiles(t);
  namedAs(t, b);
  assert.equal(namedThisRun(a), false);
});

test('an empty or missing OBK_SYSTEM_NAMED names no file', async (t) => {
  const { a } = await twoFiles(t);
  namedAs(t, '');
  assert.equal(namedThisRun(a), false, 'the empty string: a run of them all');
  process.env.OBK_SYSTEM_NAMED = '\n\n';
  assert.equal(namedThisRun(a), false, 'only empty lines');
  delete process.env.OBK_SYSTEM_NAMED;
  assert.equal(namedThisRun(a), false, 'no OBK_SYSTEM_NAMED at all');
});

test('the file is matched by its real path: a link to it in the list counts, and so does a link given as the file', async (t) => {
  const { dir, a, b } = await twoFiles(t);
  const link = path.join(dir, 'link.test.js');
  await symlink(a, link);
  namedAs(t, link);
  assert.equal(namedThisRun(a), true, 'the list names a link to the file');
  process.env.OBK_SYSTEM_NAMED = a;
  assert.equal(namedThisRun(link), true, 'the file is given as a link, the list names its real path');
  process.env.OBK_SYSTEM_NAMED = link;
  assert.equal(namedThisRun(b), false, 'a link to another file does not name this one');
});

test('a path in the list that does not exist is compared as written, and does not throw', async (t) => {
  const { dir, a } = await twoFiles(t);
  const gone = path.join(dir, 'gone.test.js');
  namedAs(t, `${gone}\n${a}`);
  assert.equal(namedThisRun(a), true, 'the file after a path that does not exist');
  assert.equal(namedThisRun(gone), true, 'a file that does not exist, named as written');
  process.env.OBK_SYSTEM_NAMED = gone;
  assert.equal(namedThisRun(a), false, 'only a path that does not exist');
});

// ------------------------------------------------------------- atNight

test('night is the local hours 0 to 5: from 00:00 to 05:59, and not 06:00 or 23:59', () => {
  const at = (hours, minutes) => new Date(2026, 9, 18, hours, minutes);
  assert.equal(atNight(at(0, 0)), true, '00:00');
  assert.equal(atNight(at(5, 59)), true, '05:59');
  assert.equal(atNight(at(6, 0)), false, '06:00');
  assert.equal(atNight(at(23, 59)), false, '23:59');
});

// ------------------------------------------------------------- gateClosed
//
// gateClosed(file, at) is the whole gate (#689): undefined when the run names
// the file and `at` is at night, and otherwise the reason the test skipped.
// The file here is a path in this repo's test/system/ that does not exist:
// namedThisRun only compares paths, and nothing here loads a system test.

/** A system test file of this repo, by its absolute path, that nothing loads. */
const PROBE = path.join(repoRoot, 'test', 'system', 'night-gate-probe.test.js');

/** The command that runs PROBE alone: the path is relative to the repo root. */
const PROBE_COMMAND = 'npm run test:system -- --yes test/system/night-gate-probe.test.js';

/** Change OBK_SYSTEM_NAMED after namedAs has saved it (undefined takes it out). */
function renamed(value) {
  if (value === undefined) delete process.env.OBK_SYSTEM_NAMED;
  else process.env.OBK_SYSTEM_NAMED = value;
}

/** 2026-10-22 at this local time. */
const on = (hours, minutes, seconds = 0, ms = 0) => new Date(2026, 9, 22, hours, minutes, seconds, ms);

test('gateClosed: a named file at night is open (undefined), from 00:00 to 05:59:59.999', (t) => {
  namedAs(t, PROBE);
  for (const at of [on(0, 0), on(3, 17), on(5, 59), on(5, 59, 59, 999)]) {
    assert.equal(gateClosed(PROBE, at), undefined, `named, at ${at.toString()}`);
  }
});

test('gateClosed: a named file by day gets a reason, at 06:00, 14:05 and 23:59', (t) => {
  namedAs(t, PROBE);
  for (const at of [on(6, 0), on(14, 5), on(23, 59)]) {
    const reason = gateClosed(PROBE, at);
    assert.equal(typeof reason, 'string', `named, at ${at.toString()}: a reason, got ${JSON.stringify(reason)}`);
    assert.notEqual(reason.trim(), '', `named, at ${at.toString()}: the reason should say something`);
  }
});

test('gateClosed: at night a file the run does not name gets a reason: another file named, a run of them all, no OBK_SYSTEM_NAMED', async (t) => {
  const { a } = await twoFiles(t);
  namedAs(t, a);
  for (const named of [a, '', undefined]) {
    renamed(named);
    const reason = gateClosed(PROBE, on(3, 0));
    assert.equal(typeof reason, 'string', `OBK_SYSTEM_NAMED=${JSON.stringify(named)} at 03:00: a reason, got ${JSON.stringify(reason)}`);
  }
});

test('gateClosed: the file is matched by its real path, as namedThisRun matches it', async (t) => {
  const { dir, a } = await twoFiles(t);
  const link = path.join(dir, 'link.test.js');
  await symlink(a, link);
  namedAs(t, link);
  assert.equal(gateClosed(a, on(2, 0)), undefined, 'the list names a link to the file');
});

test('gateClosed: the reason names the local time of `at` as HH:MM, zero-padded', (t) => {
  namedAs(t, PROBE);
  assert.ok(gateClosed(PROBE, on(6, 0)).includes('06:00'), `at 06:00: ${gateClosed(PROBE, on(6, 0))}`);
  assert.ok(gateClosed(PROBE, on(9, 3)).includes('09:03'), `at 09:03: ${gateClosed(PROBE, on(9, 3))}`);
  assert.ok(gateClosed(PROBE, on(23, 59)).includes('23:59'), `at 23:59: ${gateClosed(PROBE, on(23, 59))}`);
  renamed('');
  assert.ok(gateClosed(PROBE, on(4, 7)).includes('04:07'), `unnamed at 04:07: ${gateClosed(PROBE, on(4, 7))}`);
});

test('gateClosed: the reason gives the command that runs the file, by its path from the repo root', (t) => {
  namedAs(t, PROBE);
  for (const [named, at] of [[PROBE, on(14, 5)], ['', on(3, 0)], ['', on(14, 5)]]) {
    renamed(named);
    const reason = gateClosed(PROBE, at);
    assert.ok(reason.includes(PROBE_COMMAND), `OBK_SYSTEM_NAMED=${JSON.stringify(named)} at ${at.toString()}: the reason should give \`${PROBE_COMMAND}\`, got: ${reason}`);
    assert.ok(!reason.includes(repoRoot), `the path should be relative to the repo root, got: ${reason}`);
  }
  const nested = path.join(repoRoot, 'test', 'system', 'group', 'probe.test.js');
  renamed('');
  assert.ok(
    gateClosed(nested, on(3, 0)).includes('npm run test:system -- --yes test/system/group/probe.test.js'),
    `a file a folder down: ${gateClosed(nested, on(3, 0))}`,
  );
});

test('gateClosed: the reason says the test opened nothing in Orca', (t) => {
  namedAs(t, PROBE);
  for (const [named, at] of [[PROBE, on(14, 5)], ['', on(3, 0)]]) {
    renamed(named);
    const reason = gateClosed(PROBE, at);
    assert.match(reason, /Orca/, `it should name Orca, got: ${reason}`);
    assert.match(reason, /\bnothing\b/i, `it should say nothing was opened, got: ${reason}`);
  }
});

test('gateClosed: the reason says whether the run names the file: by day, named and not named give different reasons at the same time', (t) => {
  namedAs(t, PROBE);
  const named = gateClosed(PROBE, on(14, 5));
  renamed('');
  const unnamed = gateClosed(PROBE, on(14, 5));
  assert.equal(typeof named, 'string');
  assert.equal(typeof unnamed, 'string');
  assert.notEqual(named, unnamed, `the two reasons should differ in what they say of the name, got the same: ${named}`);
});

test('gateClosed: with no `at` it reads the clock now; a run that does not name the file gets a reason at any hour', (t) => {
  namedAs(t, '');
  assert.equal(typeof gateClosed(PROBE), 'string', 'not named: a reason whatever the hour');
  renamed(PROBE);
  const before = atNight();
  const open = gateClosed(PROBE) === undefined;
  const after = atNight();
  // Only when the hour did not change across the call (not at 00:00 or 06:00 exactly).
  if (before === after) assert.equal(open, before, `named: open exactly when it is night now (atNight() is ${before})`);
});
