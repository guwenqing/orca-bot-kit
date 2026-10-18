// The gate for a system test step that makes a throwaway tab turn real in the
// owner's Orca window (#561, #634): `namedThisRun(file)` and `atNight(at)` in
// test/helpers/night-gate.js.
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

import { atNight, namedThisRun } from './helpers/night-gate.js';

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
