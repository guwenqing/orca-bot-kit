// The live system tests' reading of Claude Code's registry of running
// sessions (#866): test/helpers/live-claude-registry.js.
//
// Claude Code keeps one `<pid>.json` file for each running session in
// `<config dir>/sessions`, and a `<pid>.<hex>.key` file beside it. The config
// dir is `$CLAUDE_CONFIG_DIR` when that is set and not empty, else
// `~/.claude`. Orca can start Claude Code with CLAUDE_CONFIG_DIR set to a
// profile folder of its own, and then `~/.claude/sessions` stays empty. So the
// helper reads both folders:
//
//   claudeRegistries({ home, configDir } = {})      the folders to read
//   claudeRegistryEntries({ home, configDir } = {}) every entry in them, with `at`
//
// Every home and config dir here is a throwaway folder under os.tmpdir(); the
// real ~/.claude is never read or written. A test that leaves `home` or
// `configDir` to its default sets HOME or CLAUDE_CONFIG_DIR for its own run
// and puts them back after, so nothing hangs on the runner's own values.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { claudeRegistries, claudeRegistryEntries } from './helpers/live-claude-registry.js';

/**
 * A throwaway folder, removed when the test ends. Answers its path as
 * mkdtemp gave it, which on macOS goes through the /var link, so its real
 * path is not the same string.
 */
async function scratch(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obk-live-registry-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

/** Make `dir` (and the folders above it) and write each `{ name: text }` into it. */
async function folderWith(dir, files = {}) {
  await mkdir(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(dir, name), text);
  return dir;
}

/** One registry entry as Claude Code writes it (seen live, #700), for pid `pid`. */
const entry = (pid, extra = {}) => ({
  pid,
  sessionId: `session-${pid}`,
  cwd: `/work/${pid}`,
  name: `kit-dev.daily.${pid}`,
  messagingSocketPath: `/tmp/cc-socks/${pid}.sock`,
  status: 'idle',
  ...extra,
});

/** The file of an entry: `{ '<pid>.json': text }`. */
const fileOf = (one) => ({ [`${one.pid}.json`]: JSON.stringify(one) });

/** Entries in pid order: the helper promises no order inside a folder. */
const byPid = (entries) => [...entries].sort((a, b) => a.pid - b.pid);

/** Set an environment variable (undefined takes it out) until the test ends, then put it back. */
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

/** Every file and folder under `dir`, with each file's text and each entry's mtime, to show that nothing changed. */
async function treeOf(dir) {
  const out = {};
  for (const name of (await readdir(dir, { recursive: true })).sort()) {
    const full = path.join(dir, name);
    const info = await stat(full);
    out[name] = info.isFile() ? { text: await readFile(full, 'utf8'), mtime: info.mtimeMs } : { folder: true, mtime: info.mtimeMs };
  }
  return out;
}

// ------------------------------------------------------------- claudeRegistries

test('#866: with no config dir (left out, or the empty string), the only folder is <home>/.claude/sessions, as its real path', async (t) => {
  const root = await scratch(t);
  const home = path.join(root, 'home');
  await folderWith(path.join(home, '.claude', 'sessions'));
  const real = await realpath(path.join(home, '.claude', 'sessions'));
  envAs(t, 'CLAUDE_CONFIG_DIR', undefined);

  assert.deepEqual(claudeRegistries({ home }), [real], 'CLAUDE_CONFIG_DIR not set and configDir left out');
  assert.deepEqual(claudeRegistries({ home, configDir: '' }), [real], 'configDir is the empty string');
  envAs(t, 'CLAUDE_CONFIG_DIR', '');
  assert.deepEqual(claudeRegistries({ home }), [real], 'CLAUDE_CONFIG_DIR is the empty string and configDir left out');
});

test('#866: with a config dir of its own, the folders are <home>/.claude/sessions first and <configDir>/sessions second', async (t) => {
  const root = await scratch(t);
  const home = path.join(root, 'home');
  const profile = path.join(root, 'orca-profile');
  await folderWith(path.join(home, '.claude', 'sessions'));
  await folderWith(path.join(profile, 'sessions'));

  assert.deepEqual(claudeRegistries({ home, configDir: profile }), [
    await realpath(path.join(home, '.claude', 'sessions')),
    await realpath(path.join(profile, 'sessions')),
  ]);
});

test('#866: configDir defaults to CLAUDE_CONFIG_DIR and home to the home folder (HOME)', async (t) => {
  const root = await scratch(t);
  const home = path.join(root, 'home');
  const profile = path.join(root, 'orca-profile');
  await folderWith(path.join(home, '.claude', 'sessions'));
  await folderWith(path.join(profile, 'sessions'));
  envAs(t, 'HOME', home);
  envAs(t, 'CLAUDE_CONFIG_DIR', profile);

  assert.deepEqual(claudeRegistries(), [
    await realpath(path.join(home, '.claude', 'sessions')),
    await realpath(path.join(profile, 'sessions')),
  ]);
});

test('#866: a folder that is not there is given as its resolved path, not its real one, and is still listed', async (t) => {
  const root = await scratch(t);
  const home = path.join(root, 'home');
  const profile = path.join(root, 'orca-profile');

  const folders = claudeRegistries({ home, configDir: profile });

  assert.deepEqual(folders, [path.join(home, '.claude', 'sessions'), path.join(profile, 'sessions')]);
  for (const folder of folders) assert.ok(path.isAbsolute(folder), `each folder is an absolute path, got ${folder}`);
});

test('#866: a config dir that is <home>/.claude, by its own path or through a link, gives one folder', async (t) => {
  const root = await scratch(t);
  const home = path.join(root, 'home');
  await folderWith(path.join(home, '.claude', 'sessions'));
  const link = path.join(root, 'link-to-claude');
  await symlink(path.join(home, '.claude'), link);
  const real = await realpath(path.join(home, '.claude', 'sessions'));

  assert.deepEqual(claudeRegistries({ home, configDir: path.join(home, '.claude') }), [real], 'configDir is <home>/.claude');
  assert.deepEqual(claudeRegistries({ home, configDir: link }), [real], 'configDir is a link to <home>/.claude');
});

// ------------------------------------------------------------- claudeRegistryEntries

test('#866, the bug: an entry only in the config dir\'s registry is found, with no ~/.claude at all', async (t) => {
  const root = await scratch(t);
  const home = path.join(root, 'home');
  await mkdir(home);
  const profile = path.join(root, 'orca-profile');
  const only = entry(65837);
  await folderWith(path.join(profile, 'sessions'), fileOf(only));

  const entries = claudeRegistryEntries({ home, configDir: profile });

  assert.deepEqual(entries, [{ ...only, at: await realpath(path.join(profile, 'sessions')) }]);
});

test('#866: entries in both registries are all given, each with the folder it is in as `at`', async (t) => {
  const root = await scratch(t);
  const home = path.join(root, 'home');
  const profile = path.join(root, 'orca-profile');
  const inHome = [entry(101), entry(102)];
  const inProfile = entry(203, { status: 'busy' });
  await folderWith(path.join(home, '.claude', 'sessions'), { ...fileOf(inHome[0]), ...fileOf(inHome[1]) });
  await folderWith(path.join(profile, 'sessions'), fileOf(inProfile));
  const homeFolder = await realpath(path.join(home, '.claude', 'sessions'));
  const profileFolder = await realpath(path.join(profile, 'sessions'));

  const entries = claudeRegistryEntries({ home, configDir: profile });

  assert.deepEqual(byPid(entries), [
    { ...inHome[0], at: homeFolder },
    { ...inHome[1], at: homeFolder },
    { ...inProfile, at: profileFolder },
  ]);
});

test('#866: with no config dir, only the home registry is read', async (t) => {
  const root = await scratch(t);
  const home = path.join(root, 'home');
  const inHome = entry(301);
  await folderWith(path.join(home, '.claude', 'sessions'), fileOf(inHome));
  envAs(t, 'CLAUDE_CONFIG_DIR', undefined);

  const expected = [{ ...inHome, at: await realpath(path.join(home, '.claude', 'sessions')) }];
  assert.deepEqual(claudeRegistryEntries({ home }), expected, 'configDir left out, CLAUDE_CONFIG_DIR not set');
  assert.deepEqual(claudeRegistryEntries({ home, configDir: '' }), expected, 'configDir is the empty string');
});

test('#866: a config dir that is <home>/.claude, by its own path or through a link, gives each entry once', async (t) => {
  const root = await scratch(t);
  const home = path.join(root, 'home');
  const one = entry(401);
  const two = entry(402);
  await folderWith(path.join(home, '.claude', 'sessions'), { ...fileOf(one), ...fileOf(two) });
  const link = path.join(root, 'link-to-claude');
  await symlink(path.join(home, '.claude'), link);
  const folder = await realpath(path.join(home, '.claude', 'sessions'));
  const expected = [{ ...one, at: folder }, { ...two, at: folder }];

  assert.deepEqual(byPid(claudeRegistryEntries({ home, configDir: path.join(home, '.claude') })), expected, 'configDir is <home>/.claude');
  assert.deepEqual(byPid(claudeRegistryEntries({ home, configDir: link })), expected, 'configDir is a link to <home>/.claude');
});

test('#866: a .key file, a half-written .json and a .json that is not an object are left out; the good entry beside them is given', async (t) => {
  const root = await scratch(t);
  const home = path.join(root, 'home');
  const profile = path.join(root, 'orca-profile');
  const good = entry(501);
  await folderWith(path.join(profile, 'sessions'), {
    ...fileOf(good),
    '501.3fa9c0de.key': 'not json at all',
    '502.json': '{"pid": 502, "sessionId": "sess',
    '503.json': 'null',
    '504.json': '42',
    '505.json': '"a string"',
    'notes.txt': JSON.stringify(entry(506)),
  });

  const entries = claudeRegistryEntries({ home, configDir: profile });

  assert.deepEqual(entries, [{ ...good, at: await realpath(path.join(profile, 'sessions')) }]);
});

test('#866: folders that are not there give no entries and no error', async (t) => {
  const root = await scratch(t);
  const home = path.join(root, 'no-home-here');
  const profile = path.join(root, 'no-profile-here');

  assert.deepEqual(claudeRegistryEntries({ home, configDir: profile }), []);
});

test('#866: reading the registries writes nothing in either folder', async (t) => {
  const root = await scratch(t);
  const home = path.join(root, 'home');
  const profile = path.join(root, 'orca-profile');
  await folderWith(path.join(home, '.claude', 'sessions'), { ...fileOf(entry(601)), '601.ab12.key': 'k' });
  await folderWith(path.join(profile, 'sessions'), { ...fileOf(entry(602)), '603.json': '{"half' });
  const before = await treeOf(root);

  claudeRegistries({ home, configDir: profile });
  const entries = claudeRegistryEntries({ home, configDir: profile });

  assert.equal(entries.length, 2, `the premise: both entries were read, got ${JSON.stringify(entries)}`);
  assert.deepEqual(await treeOf(root), before, 'nothing under the home or the config dir changed');
});
