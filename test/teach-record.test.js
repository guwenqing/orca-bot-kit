// Which of Claude Code's records of the Teach form's choice a new Orca tab may
// write, and one string that tells their `autoModeEnvSetup` apart without
// holding any of it (#738): test/helpers/teach-record.js.
//
// Two live system tests (test/system/mail-interrupt.test.js and
// test/system/messaging.test.js) answer Claude Code's "Teach auto mode about
// your environment?" form with Esc in their own throwaway tab, then check that
// `autoModeEnvSetup` is as it was before. Until #738 they read only
// `~/.claude.json`. Where Orca has a Claude account, Orca starts a new tab with
// CLAUDE_CONFIG_DIR at a profile's home, and Claude Code writes
// `<that home>/.claude.json` instead. Orca writes that home into
// `<orca data>/claude-profiles/selected-host` (sometimes with a line end), writes
// the file empty when it routes no profile, and removes it when it has no
// accounts (src/orca.js `selectedClaudeProfile`).
//
// So:
//
//   F1  no selected-host: only `<home>/.claude.json`;
//   F2  an empty selected-host, or one that holds only a line end: only the home file;
//   F3  an absolute profile home, with or without one line end: both files, home first;
//   F4  a relative path: only the home file;
//   F5  the profile's file is the home file by its real path (a link to it, a
//       profile home that is a link to the home, the home itself): listed once;
//       a separate file with the same text is still listed;
//   F6  the defaults: with no `orcaData`, OBK_ORCA_DATA, and else
//       `<home>/Library/Application Support/orca`;
//   F7  it reads only: it makes no file and no folder;
//   S1  autoModeState: `absent`, `unreadable` (a missing file, a file that is
//       not JSON), each file named by its path;
//   S2  a change of autoModeEnvSetup in either file changes the string; this is
//       the bug of #738 when it is the profile file;
//   S3  other keys, and the layout of the text, change nothing; the same
//       contents give the same string;
//   S4  no value leaks: a sentinel in autoModeEnvSetup, in another key's value
//       or name, and in text that is not JSON, is nowhere in the string.
//
// Run on real files in throwaway folders. Every call names `home` and
// `orcaData` (or OBK_ORCA_DATA) inside those folders: nothing here reads or
// writes the real `~/.claude.json`, the real Orca data folder or a real profile.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { autoModeState, teachRecordFiles } from './helpers/teach-record.js';

/**
 * A throwaway folder, removed when the test ends, with a `home` and an Orca
 * data folder `orca` in it (the `claude-profiles` folder made, but no
 * selected-host), and `profile`, a profile home, not yet made.
 */
async function sandbox(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-teach-record-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const orcaData = path.join(root, 'orca');
  const profile = path.join(orcaData, 'claude-profiles', 'p1', 'home');
  await mkdir(home, { recursive: true });
  await mkdir(path.join(orcaData, 'claude-profiles'), { recursive: true });
  return {
    root,
    home,
    orcaData,
    profile,
    homeFile: path.join(home, '.claude.json'),
    profileFile: path.join(profile, '.claude.json'),
    selected: path.join(orcaData, 'claude-profiles', 'selected-host'),
  };
}

/** Write `object` as JSON to `file`, its folder made first. */
async function writeJson(file, object, space = 2) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(object, null, space));
}

/** Set OBK_ORCA_DATA to `value` (undefined takes it out) until the test ends, and put it back as it was after. */
function orcaDataEnvAs(t, value) {
  const had = Object.hasOwn(process.env, 'OBK_ORCA_DATA');
  const was = process.env.OBK_ORCA_DATA;
  if (value === undefined) delete process.env.OBK_ORCA_DATA;
  else process.env.OBK_ORCA_DATA = value;
  t.after(() => {
    if (had) process.env.OBK_ORCA_DATA = was;
    else delete process.env.OBK_ORCA_DATA;
  });
}

/** Every path under `dir`, relative to it, sorted: what is there, to compare before and after. */
async function treeOf(dir) {
  const entries = await readdir(dir, { recursive: true });
  return entries.sort();
}

// ------------------------------------------------------------ teachRecordFiles

test('F1 no selected-host (Orca has no accounts): only the home file', async (t) => {
  const box = await sandbox(t);
  await writeJson(box.homeFile, { numStartups: 1 });
  await writeJson(box.profileFile, { numStartups: 2 });
  assert.deepEqual(teachRecordFiles({ home: box.home, orcaData: box.orcaData }), [box.homeFile]);
});

test('F1 no claude-profiles folder at all: only the home file', async (t) => {
  const box = await sandbox(t);
  await rm(path.join(box.orcaData, 'claude-profiles'), { recursive: true });
  assert.deepEqual(teachRecordFiles({ home: box.home, orcaData: box.orcaData }), [box.homeFile]);
});

test('F2 an empty selected-host (Orca routes no profile): only the home file', async (t) => {
  const box = await sandbox(t);
  await writeJson(box.profileFile, { numStartups: 2 });
  await writeFile(box.selected, '');
  assert.deepEqual(teachRecordFiles({ home: box.home, orcaData: box.orcaData }), [box.homeFile]);
});

test('F2 a selected-host that holds only a line end: only the home file', async (t) => {
  const box = await sandbox(t);
  await writeJson(box.profileFile, { numStartups: 2 });
  await writeFile(box.selected, '\n');
  assert.deepEqual(teachRecordFiles({ home: box.home, orcaData: box.orcaData }), [box.homeFile]);
});

for (const [label, text] of [['no line end', (p) => p], ['one line end', (p) => `${p}\n`]]) {
  test(`F3 selected-host names an absolute profile home, ${label}: both files, the home file first`, async (t) => {
    const box = await sandbox(t);
    await writeJson(box.homeFile, { numStartups: 1 });
    await writeJson(box.profileFile, { numStartups: 2 });
    await writeFile(box.selected, text(box.profile));
    assert.deepEqual(teachRecordFiles({ home: box.home, orcaData: box.orcaData }), [box.homeFile, box.profileFile]);
  });
}

test('F3 the profile home names a file that is not there yet: it is still listed, as the tab may write it', async (t) => {
  const box = await sandbox(t);
  await writeJson(box.homeFile, { numStartups: 1 });
  await mkdir(box.profile, { recursive: true });
  await writeFile(box.selected, box.profile);
  assert.deepEqual(teachRecordFiles({ home: box.home, orcaData: box.orcaData }), [box.homeFile, box.profileFile]);
});

test('F3 neither file is there yet: both are still listed, the home file first', async (t) => {
  const box = await sandbox(t);
  await writeFile(box.selected, `${box.profile}\n`);
  assert.deepEqual(teachRecordFiles({ home: box.home, orcaData: box.orcaData }), [box.homeFile, box.profileFile]);
});

for (const relative of ['claude-profiles/p1/home', 'p1/home\n', './home']) {
  test(`F4 a relative path in selected-host (${JSON.stringify(relative)}): only the home file`, async (t) => {
    const box = await sandbox(t);
    await writeJson(box.homeFile, { numStartups: 1 });
    await writeJson(box.profileFile, { numStartups: 2 });
    await writeFile(box.selected, relative);
    assert.deepEqual(teachRecordFiles({ home: box.home, orcaData: box.orcaData }), [box.homeFile]);
  });
}

test('F5 the profile\'s .claude.json is a symbolic link to the home file: the file is listed once', async (t) => {
  const box = await sandbox(t);
  await writeJson(box.homeFile, { numStartups: 1 });
  await mkdir(box.profile, { recursive: true });
  await symlink(box.homeFile, box.profileFile);
  await writeFile(box.selected, `${box.profile}\n`);
  assert.deepEqual(teachRecordFiles({ home: box.home, orcaData: box.orcaData }), [box.homeFile]);
});

test('F5 the profile home is a symbolic link to the home: the file is listed once', async (t) => {
  const box = await sandbox(t);
  await writeJson(box.homeFile, { numStartups: 1 });
  await mkdir(path.dirname(box.profile), { recursive: true });
  await symlink(box.home, box.profile);
  await writeFile(box.selected, box.profile);
  assert.deepEqual(teachRecordFiles({ home: box.home, orcaData: box.orcaData }), [box.homeFile]);
});

test('F5 selected-host names the home itself: the file is listed once', async (t) => {
  const box = await sandbox(t);
  await writeJson(box.homeFile, { numStartups: 1 });
  await writeFile(box.selected, box.home);
  assert.deepEqual(teachRecordFiles({ home: box.home, orcaData: box.orcaData }), [box.homeFile]);
});

test('F5 a separate profile file with the same text as the home file is still listed: same text is not the same file', async (t) => {
  const box = await sandbox(t);
  await writeJson(box.homeFile, { numStartups: 1, autoModeEnvSetup: { seen: true } });
  await writeJson(box.profileFile, { numStartups: 1, autoModeEnvSetup: { seen: true } });
  await writeFile(box.selected, box.profile);
  assert.deepEqual(teachRecordFiles({ home: box.home, orcaData: box.orcaData }), [box.homeFile, box.profileFile]);
});

test('F6 with no orcaData, OBK_ORCA_DATA names the Orca data folder', async (t) => {
  const box = await sandbox(t);
  await writeJson(box.profileFile, { numStartups: 2 });
  await writeFile(box.selected, box.profile);
  // A selected-host at the default place under this home names another profile; it must not be read.
  const otherData = path.join(box.home, 'Library', 'Application Support', 'orca');
  const otherProfile = path.join(box.root, 'other-profile');
  await mkdir(path.join(otherData, 'claude-profiles'), { recursive: true });
  await writeFile(path.join(otherData, 'claude-profiles', 'selected-host'), otherProfile);
  orcaDataEnvAs(t, box.orcaData);
  assert.deepEqual(teachRecordFiles({ home: box.home }), [box.homeFile, box.profileFile]);
});

test('F6 with no orcaData and no OBK_ORCA_DATA, the Orca data folder is <home>/Library/Application Support/orca', async (t) => {
  const box = await sandbox(t);
  const defaultData = path.join(box.home, 'Library', 'Application Support', 'orca');
  const profile = path.join(box.root, 'default-profile');
  await mkdir(path.join(defaultData, 'claude-profiles'), { recursive: true });
  await writeFile(path.join(defaultData, 'claude-profiles', 'selected-host'), `${profile}\n`);
  orcaDataEnvAs(t, undefined);
  assert.deepEqual(teachRecordFiles({ home: box.home }), [box.homeFile, path.join(profile, '.claude.json')]);
});

test('F6 an empty OBK_ORCA_DATA counts as unset: the default folder under the home is read', async (t) => {
  const box = await sandbox(t);
  const defaultData = path.join(box.home, 'Library', 'Application Support', 'orca');
  const profile = path.join(box.root, 'default-profile');
  await mkdir(path.join(defaultData, 'claude-profiles'), { recursive: true });
  await writeFile(path.join(defaultData, 'claude-profiles', 'selected-host'), profile);
  orcaDataEnvAs(t, '');
  assert.deepEqual(teachRecordFiles({ home: box.home }), [box.homeFile, path.join(profile, '.claude.json')]);
});

test('F7 it reads only: no file or folder is made, not the missing home file, the profile home or its file', async (t) => {
  const box = await sandbox(t);
  // The profile home does not exist, and the home has no .claude.json.
  await writeFile(box.selected, `${box.profile}\n`);
  const before = await treeOf(box.root);
  assert.deepEqual(teachRecordFiles({ home: box.home, orcaData: box.orcaData }), [box.homeFile, box.profileFile]);
  assert.deepEqual(await treeOf(box.root), before, 'the throwaway folder holds what it held');
});

// --------------------------------------------------------------- autoModeState

test('S1 a file with no autoModeEnvSetup key reads absent, and names the file by its path', async (t) => {
  const box = await sandbox(t);
  await writeJson(box.homeFile, { numStartups: 1 });
  const state = autoModeState([box.homeFile]);
  assert.equal(typeof state, 'string');
  assert.ok(state.includes(box.homeFile), `the file's path is named, got: ${state}`);
  assert.match(state, /absent/);
  assert.doesNotMatch(state, /unreadable/);
});

test('S1 a file with autoModeEnvSetup reads neither absent nor unreadable, and differs from the same file without it', async (t) => {
  const box = await sandbox(t);
  await writeJson(box.homeFile, { numStartups: 1 });
  const without = autoModeState([box.homeFile]);
  await writeJson(box.homeFile, { numStartups: 1, autoModeEnvSetup: { seen: true } });
  const withIt = autoModeState([box.homeFile]);
  assert.ok(withIt.includes(box.homeFile), `the file's path is named, got: ${withIt}`);
  assert.doesNotMatch(withIt, /absent/);
  assert.doesNotMatch(withIt, /unreadable/);
  assert.notEqual(withIt, without);
});

test('S1 autoModeEnvSetup that is null is a value, not absent', async (t) => {
  const box = await sandbox(t);
  await writeJson(box.homeFile, { numStartups: 1 });
  const without = autoModeState([box.homeFile]);
  await writeJson(box.homeFile, { numStartups: 1, autoModeEnvSetup: null });
  const asNull = autoModeState([box.homeFile]);
  assert.doesNotMatch(asNull, /absent/);
  assert.notEqual(asNull, without);
});

test('S1 a missing file reads unreadable, with its error code', async (t) => {
  const box = await sandbox(t);
  const state = autoModeState([box.homeFile]);
  assert.ok(state.includes(box.homeFile), `the file's path is named, got: ${state}`);
  assert.match(state, /unreadable \(/);
  assert.match(state, /ENOENT/);
  assert.doesNotMatch(state, /absent/);
});

for (const [label, text] of [['broken JSON', '{"numStartups": 1, '], ['an empty file', ''], ['plain text', 'not json at all']]) {
  test(`S1 a file that is not JSON (${label}) reads unreadable`, async (t) => {
    const box = await sandbox(t);
    await writeFile(box.homeFile, text);
    const state = autoModeState([box.homeFile]);
    assert.ok(state.includes(box.homeFile), `the file's path is named, got: ${state}`);
    assert.match(state, /unreadable \(/);
    assert.doesNotMatch(state, /absent/);
  });
}

test('S1 two files: each is named by its path, with its own state', async (t) => {
  const box = await sandbox(t);
  await writeJson(box.homeFile, { numStartups: 1 });
  await mkdir(box.profile, { recursive: true });
  await writeFile(box.profileFile, '{ not json');
  const state = autoModeState([box.homeFile, box.profileFile]);
  assert.ok(state.includes(box.homeFile), `the home file is named, got: ${state}`);
  assert.ok(state.includes(box.profileFile), `the profile file is named, got: ${state}`);
  assert.match(state, /absent/);
  assert.match(state, /unreadable/);
});

test('S1 an object value gives its key names', async (t) => {
  const box = await sandbox(t);
  await writeJson(box.homeFile, { autoModeEnvSetup: { dismissedAt: 5, choiceKind: 'skip' } });
  const state = autoModeState([box.homeFile]);
  assert.match(state, /dismissedAt/);
  assert.match(state, /choiceKind/);
});

test('S2 a change of autoModeEnvSetup in the profile file alone changes the string (the bug of #738)', async (t) => {
  const box = await sandbox(t);
  await writeJson(box.homeFile, { numStartups: 1, autoModeEnvSetup: { seen: true } });
  await writeJson(box.profileFile, { numStartups: 2 });
  const files = [box.homeFile, box.profileFile];
  const before = autoModeState(files);
  await writeJson(box.profileFile, { numStartups: 2, autoModeEnvSetup: { seen: true } });
  const taught = autoModeState(files);
  assert.notEqual(taught, before, 'absent to a value in the profile file');
  await writeJson(box.profileFile, { numStartups: 2, autoModeEnvSetup: { seen: false } });
  assert.notEqual(autoModeState(files), taught, 'one value to another in the profile file');
});

test('S2 a change of autoModeEnvSetup in the home file alone changes the string', async (t) => {
  const box = await sandbox(t);
  await writeJson(box.homeFile, { numStartups: 1, autoModeEnvSetup: { seen: true } });
  await writeJson(box.profileFile, { numStartups: 2, autoModeEnvSetup: { seen: true } });
  const files = [box.homeFile, box.profileFile];
  const before = autoModeState(files);
  await writeJson(box.homeFile, { numStartups: 1, autoModeEnvSetup: { seen: false } });
  assert.notEqual(autoModeState(files), before);
});

test('S2 a value with the same key names but another value deep inside gives another string', async (t) => {
  const box = await sandbox(t);
  await writeJson(box.homeFile, { autoModeEnvSetup: { outer: { inner: 1 }, kind: 'a' } });
  const before = autoModeState([box.homeFile]);
  await writeJson(box.homeFile, { autoModeEnvSetup: { outer: { inner: 2 }, kind: 'a' } });
  assert.notEqual(autoModeState([box.homeFile]), before, 'a nested number');
  const second = autoModeState([box.homeFile]);
  await writeJson(box.homeFile, { autoModeEnvSetup: { outer: { inner: 2 }, kind: 'b' } });
  assert.notEqual(autoModeState([box.homeFile]), second, 'a string at the top level of the value');
});

test('S2 values that are not objects are told apart: two strings, two numbers, true and false', async (t) => {
  const box = await sandbox(t);
  const stateOf = async (value) => {
    await writeJson(box.homeFile, { autoModeEnvSetup: value });
    return autoModeState([box.homeFile]);
  };
  assert.notEqual(await stateOf('on'), await stateOf('off'));
  assert.notEqual(await stateOf(1), await stateOf(2));
  assert.notEqual(await stateOf(true), await stateOf(false));
});

test('S2 the two files\' values swapped give another string: each state stays with its file', async (t) => {
  const box = await sandbox(t);
  const files = [box.homeFile, box.profileFile];
  await writeJson(box.homeFile, { autoModeEnvSetup: { seen: true } });
  await writeJson(box.profileFile, { autoModeEnvSetup: { seen: false } });
  const before = autoModeState(files);
  await writeJson(box.homeFile, { autoModeEnvSetup: { seen: false } });
  await writeJson(box.profileFile, { autoModeEnvSetup: { seen: true } });
  assert.notEqual(autoModeState(files), before);
});

test('S3 a change only in another key, in either file, changes nothing', async (t) => {
  const box = await sandbox(t);
  const files = [box.homeFile, box.profileFile];
  await writeJson(box.homeFile, { numStartups: 1, projects: { '/a': { trust: true } }, autoModeEnvSetup: { seen: true } });
  await writeJson(box.profileFile, { numStartups: 2, tipsHistory: { x: 1 } });
  const before = autoModeState(files);
  await writeJson(box.homeFile, { numStartups: 9, projects: { '/a': { trust: false }, '/b': {} }, autoModeEnvSetup: { seen: true } });
  await writeJson(box.profileFile, { numStartups: 7, tipsHistory: { x: 2, y: 3 }, newKey: 'added' });
  assert.equal(autoModeState(files), before);
});

test('S3 the same value laid out differently in the file changes nothing: the value is hashed, not the text', async (t) => {
  const box = await sandbox(t);
  await writeJson(box.homeFile, { numStartups: 1, autoModeEnvSetup: { seen: true, kind: 'skip' } }, 2);
  const before = autoModeState([box.homeFile]);
  await writeJson(box.homeFile, { numStartups: 1, autoModeEnvSetup: { seen: true, kind: 'skip' } }, 0);
  assert.equal(autoModeState([box.homeFile]), before);
});

test('S3 the same contents give the same string, read twice and after a change and back', async (t) => {
  const box = await sandbox(t);
  const files = [box.homeFile, box.profileFile];
  await writeJson(box.homeFile, { autoModeEnvSetup: { seen: true } });
  await writeJson(box.profileFile, { autoModeEnvSetup: { kind: 'skip' } });
  const first = autoModeState(files);
  assert.equal(autoModeState(files), first, 'read twice');
  await writeJson(box.profileFile, { autoModeEnvSetup: { kind: 'other' } });
  await writeJson(box.profileFile, { autoModeEnvSetup: { kind: 'skip' } });
  assert.equal(autoModeState(files), first, 'changed and put back');
});

// ------------------------------------------------------------------- no leaks

// No hex digit and no letter a temp folder's name could hold, so a hash or a
// path cannot hold it by chance. '@@' alone is enough to show a leak of its start.
const SENTINEL = '@@leak-Wolverine-7731@@';
const SENTINEL_NUMBER = 73319931377;

/** Assert that `state` holds no part of the sentinels a reader could spot. */
function assertNoLeak(state) {
  assert.ok(!state.includes(SENTINEL), `the sentinel leaked: ${state}`);
  assert.ok(!state.includes('@@'), `the start or end of the sentinel leaked: ${state}`);
  assert.ok(!state.includes('Wolverine'), `a piece of the sentinel leaked: ${state}`);
  assert.ok(!state.includes(String(SENTINEL_NUMBER)), `the number leaked: ${state}`);
}

test('S4 a value inside autoModeEnvSetup never shows: a string, a nested string, a number', async (t) => {
  const box = await sandbox(t);
  await writeJson(box.homeFile, {
    autoModeEnvSetup: { note: SENTINEL, nested: { deep: SENTINEL, list: [SENTINEL] }, count: SENTINEL_NUMBER },
  });
  const state = autoModeState([box.homeFile]);
  assertNoLeak(state);
  assert.match(state, /note/, 'key names of autoModeEnvSetup may show; the top ones do here');
});

test('S4 autoModeEnvSetup that is a plain string or a number never shows', async (t) => {
  const box = await sandbox(t);
  await writeJson(box.homeFile, { autoModeEnvSetup: SENTINEL });
  assertNoLeak(autoModeState([box.homeFile]));
  await writeJson(box.homeFile, { autoModeEnvSetup: SENTINEL_NUMBER });
  assertNoLeak(autoModeState([box.homeFile]));
});

test('S4 another key\'s value or name never shows, with autoModeEnvSetup there and without it', async (t) => {
  const box = await sandbox(t);
  const files = [box.homeFile, box.profileFile];
  await writeJson(box.homeFile, { secretish: SENTINEL, [SENTINEL]: 1, autoModeEnvSetup: { seen: true } });
  await writeJson(box.profileFile, { other: { deep: SENTINEL }, [`${SENTINEL}-key`]: SENTINEL_NUMBER });
  assertNoLeak(autoModeState(files));
});

for (const [label, text] of [
  ['text that starts with it', `${SENTINEL} and more`],
  ['broken JSON with it in a value', `{"autoModeEnvSetup": "${SENTINEL}", oops}`],
  ['broken JSON with it as a bare value', `{"autoModeEnvSetup": ${SENTINEL}}`],
  ['broken JSON with it near the error', `{"numStartups": 1, ${SENTINEL}`],
  ['JSON cut short after it', `{"autoModeEnvSetup": {"k": "${SENTINEL}`],
]) {
  test(`S4 a file that is not JSON never shows its text (${label})`, async (t) => {
    const box = await sandbox(t);
    await writeFile(box.homeFile, text);
    const state = autoModeState([box.homeFile]);
    assert.match(state, /unreadable/);
    assertNoLeak(state);
  });
}
