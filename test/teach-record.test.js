// Which of Claude Code's records of the Teach form's choice a live session may
// write, and one string that tells their `autoModeEnvSetup` apart without
// holding any of it (#738): test/helpers/teach-record.js.
//
// Two live system tests (test/system/mail-interrupt.test.js and
// test/system/messaging.test.js) answer Claude Code's "Teach auto mode about
// your environment?" form with Esc in their own throwaway tab, then check that
// `autoModeEnvSetup` is as it was before. Until #738 they read only
// `~/.claude.json`. But a session writes `<its config dir>/.claude.json`, and
// its config dir may be an Orca profile's home, a folder the user named in
// CLAUDE_CONFIG_DIR that Orca restores (ORCA_CLAUDE_USER_CONFIG_DIR), or one
// set in the pane by hand. Orca's `selected-host` cannot tell which (the review
// of PR #744). Claude Code's own registry of live sessions can:
// `<config dir>/sessions/<pid>.json`, a JSON object with the session's `cwd`.
// Each live test's session runs in a throwaway bot folder of its own, so the
// dir whose registry lists that folder is the session's config dir.
//
//   S1  autoModeState: `absent`, `unreadable` (a missing file, a file that is
//       not JSON), each file named by its path;
//   S2  a change of autoModeEnvSetup in either file changes the string; this is
//       the bug of #738 when it is the profile file;
//   S3  other keys, and the layout of the text, change nothing; the same
//       contents give the same string;
//   S4  no value leaks: a sentinel in autoModeEnvSetup, in another key's value
//       or name, and in text that is not JSON, is nowhere in the string;
//   R1  sessionRecordFiles: a session in `<home>/.claude`'s registry gives
//       `<home>/.claude.json` and `<home>/.claude/.claude.json`, in that order;
//   R2  a session in a profile's registry gives that profile's `.claude.json`
//       alone, whatever `selected-host` says or if it is not there;
//   R3  a session in the registry of the folder `env.ORCA_CLAUDE_USER_CONFIG_DIR`
//       or `env.CLAUDE_CONFIG_DIR` names gives `<that folder>/.claude.json`;
//   R4  an env value that is relative is not looked at; a folder already looked
//       at by its real path gives no second entry;
//   R5  every dir that lists the session, in the order: home, profiles by name,
//       CLAUDE_CONFIG_DIR, ORCA_CLAUDE_USER_CONFIG_DIR;
//   R6  `cwd` and an entry's `cwd` match by real path, a link included; a
//       sibling, a parent or a child folder does not match;
//   R7  entries that are not JSON or have no `cwd` are skipped; no match gives
//       `{ why }`, which names `cwd` and the folders looked at and holds no text
//       of any file;
//   R8  the defaults: `orcaData` from OBK_ORCA_DATA (empty counts as unset), else
//       under `<home>`; `env` from process.env;
//   R9  paths in `files` are built from the folder as given, not real paths;
//   R10 it reads only: it makes no file and no folder.
//
// Run on real files in throwaway folders. Every call names `home` and
// `orcaData` (or OBK_ORCA_DATA) and `env` (or the two variables in process.env)
// inside those folders: nothing here reads or writes the real `~/.claude`,
// `~/.claude.json`, the real Orca data folder or a real profile. The pids in
// the registry entries are above macOS's highest pid (99998), so no entry names
// a real process.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Imported as a namespace, so the autoModeState tests still run where the
// helper has no sessionRecordFiles yet: each R test then fails on its own.
import * as teachRecord from './helpers/teach-record.js';

const { autoModeState } = teachRecord;
const sessionRecordFiles = (...args) => teachRecord.sessionRecordFiles(...args);

/**
 * A throwaway folder, removed when the test ends, with a `home` and an Orca
 * data folder `orca` in it (the `claude-profiles` folder made, but no
 * selected-host), and `profile`, a profile home, not yet made. `bot` is a
 * throwaway bot folder, made: the folder a session works in.
 */
async function sandbox(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-teach-record-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const orcaData = path.join(root, 'orca');
  const profile = path.join(orcaData, 'claude-profiles', 'p1', 'home');
  const bot = path.join(root, 'bots', 'kit-dev');
  await mkdir(home, { recursive: true });
  await mkdir(path.join(orcaData, 'claude-profiles'), { recursive: true });
  await mkdir(bot, { recursive: true });
  return {
    root,
    home,
    orcaData,
    profile,
    bot,
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

/** Set the variable `name` to `value` (undefined takes it out) until the test ends, and put it back as it was after. */
function envAs(t, name, value) {
  const had = Object.hasOwn(process.env, name);
  const was = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  t.after(() => {
    if (had) process.env[name] = was;
    else delete process.env[name];
  });
}

/** Every path under `dir`, relative to it, sorted: what is there, to compare before and after. */
async function treeOf(dir) {
  const entries = await readdir(dir, { recursive: true });
  return entries.sort();
}

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

// ---------------------------------------------------------- sessionRecordFiles

/** The next pid for a registry entry: above macOS's highest pid, so it names no real process. */
let nextPid = 99999901;

/**
 * List a live session working in `cwd` in the registry of `configDir`:
 * `<configDir>/sessions/<pid>.json`, as Claude Code writes it. Gives the file.
 */
async function register(configDir, cwd, extra = {}) {
  const pid = nextPid++;
  const file = path.join(configDir, 'sessions', `${pid}.json`);
  await writeJson(file, { pid, sessionId: `0000-${pid}`, cwd, startedAt: 1762700000000, ...extra });
  return file;
}

/** A profile home `<orcaData>/claude-profiles/<name>/home`, made. */
async function profileHome(box, name) {
  const dir = path.join(box.orcaData, 'claude-profiles', name, 'home');
  await mkdir(dir, { recursive: true });
  return dir;
}

/** The home's two records, as R1 names them. */
const homeRecords = (home) => [path.join(home, '.claude.json'), path.join(home, '.claude', '.claude.json')];

/** Assert `answer` is `{ files }` with exactly `files`. */
function assertFiles(answer, files) {
  assert.equal(typeof answer, 'object', `an object, got: ${JSON.stringify(answer)}`);
  assert.deepEqual(answer.files, files, `the files, got: ${JSON.stringify(answer)}`);
  assert.equal(answer.why, undefined, 'no why beside the files');
}

/** Assert `answer` is `{ why }`, a sentence with no files, and give the sentence. */
function assertWhy(answer) {
  assert.equal(typeof answer, 'object', `an object, got: ${JSON.stringify(answer)}`);
  assert.equal(answer.files, undefined, `no files, got: ${JSON.stringify(answer)}`);
  assert.equal(typeof answer.why, 'string', `a why, got: ${JSON.stringify(answer)}`);
  assert.ok(answer.why.length > 0, 'the why is not empty');
  return answer.why;
}

test('R1 the session is in <home>/.claude\'s registry: <home>/.claude.json and <home>/.claude/.claude.json, in that order', async (t) => {
  const box = await sandbox(t);
  await register(path.join(box.home, '.claude'), box.bot);
  assertFiles(sessionRecordFiles(box.bot, { home: box.home, orcaData: box.orcaData, env: {} }), homeRecords(box.home));
});

test('R1 the home records are given whether or not the files are there', async (t) => {
  const box = await sandbox(t);
  await register(path.join(box.home, '.claude'), box.bot);
  await writeJson(box.homeFile, { numStartups: 1 });
  assertFiles(sessionRecordFiles(box.bot, { home: box.home, orcaData: box.orcaData, env: {} }), homeRecords(box.home));
});

for (const [label, selected] of [
  ['selected-host names another profile', (box) => path.join(box.orcaData, 'claude-profiles', 'alpha', 'home')],
  ['selected-host names that same profile, with a line end', (box) => `${path.join(box.orcaData, 'claude-profiles', 'beta', 'home')}\n`],
  ['no selected-host', undefined],
  ['an empty selected-host', () => ''],
]) {
  test(`R2 the session is in a profile's registry, ${label}: that profile's .claude.json alone`, async (t) => {
    const box = await sandbox(t);
    await profileHome(box, 'alpha');
    const beta = await profileHome(box, 'beta');
    await register(path.join(box.orcaData, 'claude-profiles', 'alpha', 'home'), path.join(box.root, 'bots', 'other-bot'));
    await register(beta, box.bot);
    if (selected !== undefined) await writeFile(box.selected, selected(box));
    assertFiles(sessionRecordFiles(box.bot, { home: box.home, orcaData: box.orcaData, env: {} }), [path.join(beta, '.claude.json')]);
  });
}

test('R2 the home\'s own registry lists another folder only: the home records are not given', async (t) => {
  const box = await sandbox(t);
  await register(path.join(box.home, '.claude'), path.join(box.root, 'bots', 'other-bot'));
  const alpha = await profileHome(box, 'alpha');
  await register(alpha, box.bot);
  assertFiles(sessionRecordFiles(box.bot, { home: box.home, orcaData: box.orcaData, env: {} }), [path.join(alpha, '.claude.json')]);
});

test('R2 no claude-profiles folder, and no Orca data folder at all: the home registry still answers', async (t) => {
  const box = await sandbox(t);
  await rm(box.orcaData, { recursive: true });
  await register(path.join(box.home, '.claude'), box.bot);
  assertFiles(sessionRecordFiles(box.bot, { home: box.home, orcaData: box.orcaData, env: {} }), homeRecords(box.home));
});

test('R2 a profile folder with no home, and a profile home with no sessions folder, are passed over', async (t) => {
  const box = await sandbox(t);
  await mkdir(path.join(box.orcaData, 'claude-profiles', 'alpha'), { recursive: true });
  await profileHome(box, 'beta');
  const gamma = await profileHome(box, 'gamma');
  await register(gamma, box.bot);
  assertFiles(sessionRecordFiles(box.bot, { home: box.home, orcaData: box.orcaData, env: {} }), [path.join(gamma, '.claude.json')]);
});

for (const name of ['ORCA_CLAUDE_USER_CONFIG_DIR', 'CLAUDE_CONFIG_DIR']) {
  test(`R3 the session is in the registry of the folder env.${name} names, with no selected-host: <that folder>/.claude.json alone`, async (t) => {
    const box = await sandbox(t);
    const custom = path.join(box.root, 'my-claude-config');
    await profileHome(box, 'alpha');
    await register(custom, box.bot);
    assertFiles(
      sessionRecordFiles(box.bot, { home: box.home, orcaData: box.orcaData, env: { [name]: custom } }),
      [path.join(custom, '.claude.json')],
    );
  });
}

test('R3 the folder an env value names is looked at only through that value: with no env, the same registry gives no match', async (t) => {
  const box = await sandbox(t);
  const custom = path.join(box.root, 'my-claude-config');
  await register(custom, box.bot);
  assertWhy(sessionRecordFiles(box.bot, { home: box.home, orcaData: box.orcaData, env: {} }));
});

test('R3 each env value is looked at on its own: only the one whose registry lists the session is given', async (t) => {
  const box = await sandbox(t);
  const first = path.join(box.root, 'pane-config');
  const second = path.join(box.root, 'user-config');
  await register(first, path.join(box.root, 'bots', 'other-bot'));
  await register(second, box.bot);
  assertFiles(
    sessionRecordFiles(box.bot, { home: box.home, orcaData: box.orcaData, env: { CLAUDE_CONFIG_DIR: first, ORCA_CLAUDE_USER_CONFIG_DIR: second } }),
    [path.join(second, '.claude.json')],
  );
});

for (const name of ['ORCA_CLAUDE_USER_CONFIG_DIR', 'CLAUDE_CONFIG_DIR']) {
  test(`R4 a relative env.${name} is not looked at, even where it leads to a registry that lists the session`, async (t) => {
    const box = await sandbox(t);
    const custom = path.join(box.root, 'my-claude-config');
    await register(custom, box.bot);
    // Relative to this process's folder, the value leads to `custom`.
    const relative = path.relative(process.cwd(), custom);
    assert.equal(path.isAbsolute(relative), false);
    assertWhy(sessionRecordFiles(box.bot, { home: box.home, orcaData: box.orcaData, env: { [name]: relative } }));
  });
}

test('R4 env values that name <home>/.claude, by its path or a link to it: the home records once each', async (t) => {
  const box = await sandbox(t);
  const claudeDir = path.join(box.home, '.claude');
  await register(claudeDir, box.bot);
  const link = path.join(box.root, 'link-to-home-claude');
  await symlink(claudeDir, link);
  assertFiles(
    sessionRecordFiles(box.bot, { home: box.home, orcaData: box.orcaData, env: { CLAUDE_CONFIG_DIR: claudeDir, ORCA_CLAUDE_USER_CONFIG_DIR: link } }),
    homeRecords(box.home),
  );
});

test('R4 an env value that names a profile home through a link: that profile\'s record once, by the profile\'s own path', async (t) => {
  const box = await sandbox(t);
  const alpha = await profileHome(box, 'alpha');
  await register(alpha, box.bot);
  const link = path.join(box.root, 'link-to-alpha');
  await symlink(alpha, link);
  assertFiles(
    sessionRecordFiles(box.bot, { home: box.home, orcaData: box.orcaData, env: { CLAUDE_CONFIG_DIR: link } }),
    [path.join(alpha, '.claude.json')],
  );
});

test('R4 both env values name the same folder: its record once', async (t) => {
  const box = await sandbox(t);
  const custom = path.join(box.root, 'my-claude-config');
  await register(custom, box.bot);
  assertFiles(
    sessionRecordFiles(box.bot, { home: box.home, orcaData: box.orcaData, env: { CLAUDE_CONFIG_DIR: custom, ORCA_CLAUDE_USER_CONFIG_DIR: custom } }),
    [path.join(custom, '.claude.json')],
  );
});

test('R5 every dir that lists the session is given, in order: home, profiles by name, CLAUDE_CONFIG_DIR, ORCA_CLAUDE_USER_CONFIG_DIR', async (t) => {
  const box = await sandbox(t);
  // Made, and listed, in an order other than the answer's.
  const userDir = path.join(box.root, 'user-config');
  const paneDir = path.join(box.root, 'pane-config');
  await register(userDir, box.bot);
  await register(paneDir, box.bot);
  const beta = await profileHome(box, 'beta');
  const alpha = await profileHome(box, 'alpha');
  await register(beta, box.bot);
  await register(alpha, box.bot);
  await register(path.join(box.home, '.claude'), box.bot);
  assertFiles(
    sessionRecordFiles(box.bot, { home: box.home, orcaData: box.orcaData, env: { ORCA_CLAUDE_USER_CONFIG_DIR: userDir, CLAUDE_CONFIG_DIR: paneDir } }),
    [
      ...homeRecords(box.home),
      path.join(alpha, '.claude.json'),
      path.join(beta, '.claude.json'),
      path.join(paneDir, '.claude.json'),
      path.join(userDir, '.claude.json'),
    ],
  );
});

test('R5 two profiles list the session, and the home does not: both, by name', async (t) => {
  const box = await sandbox(t);
  const zulu = await profileHome(box, 'zulu');
  const alpha = await profileHome(box, 'alpha');
  await register(zulu, box.bot);
  await register(alpha, box.bot);
  assertFiles(
    sessionRecordFiles(box.bot, { home: box.home, orcaData: box.orcaData, env: {} }),
    [path.join(alpha, '.claude.json'), path.join(zulu, '.claude.json')],
  );
});

test('R6 cwd given through a symbolic link to the session\'s folder: still a match', async (t) => {
  const box = await sandbox(t);
  const alpha = await profileHome(box, 'alpha');
  await register(alpha, box.bot);
  const link = path.join(box.root, 'link-to-bot');
  await symlink(box.bot, link);
  assertFiles(sessionRecordFiles(link, { home: box.home, orcaData: box.orcaData, env: {} }), [path.join(alpha, '.claude.json')]);
});

test('R6 the entry\'s cwd is a symbolic link to the folder: still a match', async (t) => {
  const box = await sandbox(t);
  const alpha = await profileHome(box, 'alpha');
  const link = path.join(box.root, 'link-to-bot');
  await symlink(box.bot, link);
  await register(alpha, link);
  assertFiles(sessionRecordFiles(box.bot, { home: box.home, orcaData: box.orcaData, env: {} }), [path.join(alpha, '.claude.json')]);
});

for (const [label, other] of [
  ['a sibling with a longer name', (bot) => `${bot}-2`],
  ['a sibling whose name is the start of its name', (bot) => bot.slice(0, -1)],
  ['its parent', (bot) => path.dirname(bot)],
  ['a folder inside it', (bot) => path.join(bot, 'src')],
]) {
  test(`R6 the registry lists only ${label}: no match`, async (t) => {
    const box = await sandbox(t);
    const otherDir = other(box.bot);
    await mkdir(otherDir, { recursive: true });
    const alpha = await profileHome(box, 'alpha');
    await register(alpha, otherDir);
    await register(path.join(box.home, '.claude'), otherDir);
    assertWhy(sessionRecordFiles(box.bot, { home: box.home, orcaData: box.orcaData, env: {} }));
  });
}

test('R6 a registry with many entries matches on any one of them', async (t) => {
  const box = await sandbox(t);
  const alpha = await profileHome(box, 'alpha');
  await register(alpha, path.join(box.root, 'bots', 'one'));
  await register(alpha, box.bot);
  await register(alpha, path.join(box.root, 'bots', 'two'));
  assertFiles(sessionRecordFiles(box.bot, { home: box.home, orcaData: box.orcaData, env: {} }), [path.join(alpha, '.claude.json')]);
});

test('R7 entries that are not JSON, have no cwd, or are not an object are skipped, and a good entry beside them still matches', async (t) => {
  const box = await sandbox(t);
  const alpha = await profileHome(box, 'alpha');
  const sessions = path.join(alpha, 'sessions');
  await mkdir(sessions, { recursive: true });
  await writeFile(path.join(sessions, '99999801.json'), '{ not json');
  await writeFile(path.join(sessions, '99999802.json'), '');
  await writeJson(path.join(sessions, '99999803.json'), { pid: 99999803, sessionId: 'x' });
  await writeJson(path.join(sessions, '99999804.json'), [box.bot]);
  await writeJson(path.join(sessions, '99999805.json'), null);
  await writeJson(path.join(sessions, '99999806.json'), { pid: 99999806, cwd: 42 });
  await register(alpha, box.bot);
  assertFiles(sessionRecordFiles(box.bot, { home: box.home, orcaData: box.orcaData, env: {} }), [path.join(alpha, '.claude.json')]);
});

test('R7 a registry of bad entries only, and an empty registry: no match, and a why', async (t) => {
  const box = await sandbox(t);
  const alpha = await profileHome(box, 'alpha');
  await mkdir(path.join(alpha, 'sessions'), { recursive: true });
  await writeFile(path.join(alpha, 'sessions', '99999801.json'), `{"cwd": ${JSON.stringify(box.bot)}`);
  await writeJson(path.join(alpha, 'sessions', '99999802.json'), { pid: 99999802 });
  await mkdir(path.join(box.home, '.claude', 'sessions'), { recursive: true });
  assertWhy(sessionRecordFiles(box.bot, { home: box.home, orcaData: box.orcaData, env: {} }));
});

test('R7 no match anywhere: why names cwd and each folder looked at', async (t) => {
  const box = await sandbox(t);
  const alpha = await profileHome(box, 'alpha');
  const beta = await profileHome(box, 'beta');
  const pane = path.join(box.root, 'pane-config');
  const user = path.join(box.root, 'user-config');
  await register(alpha, path.join(box.root, 'bots', 'other-bot'));
  await register(user, path.join(box.root, 'bots', 'other-bot'));
  const why = assertWhy(sessionRecordFiles(box.bot, {
    home: box.home, orcaData: box.orcaData, env: { CLAUDE_CONFIG_DIR: pane, ORCA_CLAUDE_USER_CONFIG_DIR: user },
  }));
  for (const named of [box.bot, path.join(box.home, '.claude'), alpha, beta, pane, user]) {
    assert.ok(why.includes(named), `why names ${named}, got: ${why}`);
  }
});

test('R7 why holds no text of any registry entry or any .claude.json', async (t) => {
  const box = await sandbox(t);
  const alpha = await profileHome(box, 'alpha');
  const custom = path.join(box.root, 'my-claude-config');
  const sentinelCwd = path.join(box.root, SENTINEL);
  await mkdir(sentinelCwd, { recursive: true });
  for (const dir of [path.join(box.home, '.claude'), alpha, custom]) {
    await register(dir, sentinelCwd, { sessionId: SENTINEL, note: SENTINEL_NUMBER });
    await writeFile(path.join(dir, 'sessions', '99999800.json'), `${SENTINEL} not json`);
    await writeJson(path.join(dir, 'sessions', '99999799.json'), { [SENTINEL]: 1, pid: 99999799 });
    await writeJson(path.join(dir, '.claude.json'), { autoModeEnvSetup: { note: SENTINEL }, other: SENTINEL });
  }
  await writeJson(box.homeFile, { autoModeEnvSetup: SENTINEL, other: SENTINEL_NUMBER });
  await writeFile(box.selected, path.join(box.root, SENTINEL, 'home'));
  const why = assertWhy(sessionRecordFiles(box.bot, { home: box.home, orcaData: box.orcaData, env: { CLAUDE_CONFIG_DIR: custom } }));
  assert.ok(why.includes(box.bot), `why names cwd, got: ${why}`);
  assertNoLeak(why);
});

test('R8 with no orcaData, OBK_ORCA_DATA names the Orca data folder, and the default one under the home is not read', async (t) => {
  const box = await sandbox(t);
  const alpha = await profileHome(box, 'alpha');
  await register(alpha, box.bot);
  const decoy = path.join(box.home, 'Library', 'Application Support', 'orca', 'claude-profiles', 'decoy', 'home');
  await register(decoy, box.bot);
  envAs(t, 'OBK_ORCA_DATA', box.orcaData);
  assertFiles(sessionRecordFiles(box.bot, { home: box.home, env: {} }), [path.join(alpha, '.claude.json')]);
});

for (const [label, value] of [['no OBK_ORCA_DATA', undefined], ['an empty OBK_ORCA_DATA, which counts as unset', '']]) {
  test(`R8 with no orcaData and ${label}, the Orca data folder is <home>/Library/Application Support/orca`, async (t) => {
    const box = await sandbox(t);
    const fallback = path.join(box.home, 'Library', 'Application Support', 'orca', 'claude-profiles', 'alpha', 'home');
    await register(fallback, box.bot);
    envAs(t, 'OBK_ORCA_DATA', value);
    assertFiles(sessionRecordFiles(box.bot, { home: box.home, env: {} }), [path.join(fallback, '.claude.json')]);
  });
}

test('R8 with no env, CLAUDE_CONFIG_DIR and ORCA_CLAUDE_USER_CONFIG_DIR come from process.env', async (t) => {
  const box = await sandbox(t);
  const pane = path.join(box.root, 'pane-config');
  const user = path.join(box.root, 'user-config');
  await register(pane, box.bot);
  await register(user, box.bot);
  envAs(t, 'CLAUDE_CONFIG_DIR', pane);
  envAs(t, 'ORCA_CLAUDE_USER_CONFIG_DIR', user);
  assertFiles(
    sessionRecordFiles(box.bot, { home: box.home, orcaData: box.orcaData }),
    [path.join(pane, '.claude.json'), path.join(user, '.claude.json')],
  );
});

test('R8 a given env is used in place of process.env: process.env\'s values are not looked at', async (t) => {
  const box = await sandbox(t);
  const pane = path.join(box.root, 'pane-config');
  await register(pane, box.bot);
  envAs(t, 'CLAUDE_CONFIG_DIR', pane);
  envAs(t, 'ORCA_CLAUDE_USER_CONFIG_DIR', pane);
  assertWhy(sessionRecordFiles(box.bot, { home: box.home, orcaData: box.orcaData, env: {} }));
});

test('R9 paths are built from the folders as given, not their real paths: a home through a link, an env value through a link', async (t) => {
  const box = await sandbox(t);
  const homeLink = path.join(box.root, 'home-link');
  await symlink(box.home, homeLink);
  const custom = path.join(box.root, 'my-claude-config');
  const customLink = path.join(box.root, 'custom-link');
  await register(path.join(box.home, '.claude'), box.bot);
  await register(custom, box.bot);
  await symlink(custom, customLink);
  assertFiles(
    sessionRecordFiles(box.bot, { home: homeLink, orcaData: box.orcaData, env: { CLAUDE_CONFIG_DIR: customLink } }),
    [...homeRecords(homeLink), path.join(customLink, '.claude.json')],
  );
});

test('R10 it reads only: the folder tree is the same after a match and after no match', async (t) => {
  const box = await sandbox(t);
  const alpha = await profileHome(box, 'alpha');
  const custom = path.join(box.root, 'my-claude-config');
  await register(path.join(box.home, '.claude'), box.bot);
  await register(alpha, box.bot);
  await register(custom, box.bot);
  // None of the .claude.json files is there.
  const before = await treeOf(box.root);
  const options = { home: box.home, orcaData: box.orcaData, env: { CLAUDE_CONFIG_DIR: custom, ORCA_CLAUDE_USER_CONFIG_DIR: path.join(box.root, 'not-there') } };
  assertFiles(sessionRecordFiles(box.bot, options), [...homeRecords(box.home), path.join(alpha, '.claude.json'), path.join(custom, '.claude.json')]);
  assertWhy(sessionRecordFiles(path.join(box.root, 'bots'), options));
  assert.deepEqual(await treeOf(box.root), before, 'the throwaway folder holds what it held');
});
