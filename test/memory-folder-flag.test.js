// The launch line names the bot's own memory folder (#722, #752).
//
// Claude Code keys its memory folder by the top of the git repository, so every
// bot of a bots repo shared one folder, and a note of one bot steered all of
// them (#752). Under an Orca profile, Claude Code also names that folder
// through the profile's `projects` link, and a write there stops on a dialog
// that only a person can answer (#722). So the kit's launch line for Claude
// Code carries one more argument pair, `--settings <json>`, where the JSON is an
// object with exactly one key (ADR 0056):
//
//   autoMemoryDirectory: <real path of the bot folder>/claude-memory
//
// The real path: links on the way to the bot folder are resolved, and nothing
// else changes in the text (no NFC step, no slug). Every session of a bot gets
// the same value, temporary sessions too, whatever its work dir. Two bots get
// two values, and Bot Father gets its own. The repository, the Orca profile and
// the length of the path do not change it.
//
// What is held here, and the tests that hold each part:
//
//   M1   the pair, its value, and every other word as it is today; every
//        session of a bot gets the same value; two bots get two; Bot Father
//        gets its own
//   M2   one shell word, in a path with spaces and shell characters
//   M3   the text of the value: the real path as it is, no slug, no NFC step
//   M4   links on the way to the bot folder are resolved
//   M5   the repository does not matter: a bots repo, a bot that is a repo of
//        its own, a linked worktree (a bare repository's too), no repository,
//        a `.git` link, a `.git` that git cannot read
//   M6   no length limit
//   M7   the Orca profile does not matter for the value
//   M8   a hand-set key: the bot's `.claude/settings.json` and
//        `.claude/settings.local.json`, the repository root's
//        `.claude/settings.local.json`, the selected profile's `settings.json`,
//        or `~/.claude/settings.json` with no profile selected
//   M9   what does not count as a hand-set key
//   M10  the session's own `extra_args`; the report of `up` and `restart`
//        names `--settings` under the tab of such a session
//   M11  something that is not a plain folder at `<bot folder>/claude-memory`:
//        the session is refused (test/memory-folder-made.test.js, F9); a plain
//        folder of the user's own gets the pair
//   M12  Claude Code only: never on a Codex or a Pi line
//   M13  each way the kit starts a session: resume, restart, unpause, temp make
//   M14  the JSON holds only this key, and a session with memory off stays off
//   M15  the kit changes no settings file, no profile and no `projects` folder
//
// test/memory-folder-made.test.js holds the folder and its `.gitignore`, which
// the kit makes, and that it moves no note. test/health-memory-folder.test.js
// holds what `obk health` says about it. `--settings` stays refused as a user's
// extra argument: test/extra-arg-scope.test.js holds that for `session add`
// (XS11), `session change` (XS14) and `temp make` (XS18), so it is not repeated
// here. test/core-is-core.test.js holds that no new command or setting came in.
//
// A negative case here has its positive beside it: the same sandbox brings up a
// control session first, which has the pair, then one thing is changed, and the
// next session is brought up (`controlThenCase`). So an empty result cannot be a
// kit that never adds the pair, or a fixture that never had one to add. A case
// that must not move the value has the same shape (`controlThenStill`): the
// control's value, one change, and the next session's value is the same.
//
// Every run is in a sandbox (helpers/cli.js): its own HOME, a fake Orca, and a
// fake harness on its own PATH, which writes down the argv a real harness would
// be handed. Nothing here reads the real Orca's data, a real profile or a real
// harness. A line is read at the level a user sees: the text the fake Orca
// received, run through a real shell.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { parse, stringify } from 'yaml';

import {
  bareLaunch,
  botHomeOf,
  conversationOnRecord,
  createSandbox,
  fakeProgram,
  git,
  harnessPartOf,
  kitLaunchMark,
  recordSession,
  restartLineOf,
  sessionIn,
  sh,
  snapshot,
  SYSTEM,
  SYSTEM_FLAG,
  systemlessArgv,
  tokenless,
  tokenlessWord,
  typedInto,
  unpauseLineOf,
} from './helpers/cli.js';
import { fakePi } from './helpers/pi.js';

const BOT = 'api-bot';
const KEY = 'autoMemoryDirectory';
const FOLDER = 'claude-memory';
const AS_ROOT = process.getuid?.() === 0 ? 'root reads a file of mode 000, so it cannot be made unreadable here' : undefined;

/** The names no line of the kit's may carry for this, in any case (the kit refuses `--settings` from a user for what else it can carry). */
const NEVER_ON_THE_LINE = ['autoMemoryEnabled', 'CLAUDE_CODE_DISABLE_AUTO_MEMORY'];

/** Orca's data folder in a sandbox: where Orca keeps it, under the sandbox's home. */
const orcaDataOf = (box) => path.join(box.home, 'Library', 'Application Support', 'orca');

/** The real folder a profile's `projects` link leads to, unless a test says another. */
const defaultProjectsOf = (box) => path.join(box.home, '.claude', 'projects');

/** The user's own settings file under the sandbox's HOME. */
const userSettingsOf = (box) => path.join(box.home, '.claude', 'settings.json');

const selectedHostIn = (data) => path.join(data, 'claude-profiles', 'selected-host');

/**
 * A Claude profile as Orca keeps one: a home folder in which `projects` is a
 * symbolic link to the real folder. `select` writes its home into
 * `selected-host`, as Orca does when it routes a new tab to that profile.
 */
async function profileIn(box, { data = orcaDataOf(box), name = 'profile-one', projects = defaultProjectsOf(box), select = true } = {}) {
  const home = path.join(data, 'claude-profiles', name, 'home');
  await mkdir(home, { recursive: true });
  await mkdir(projects, { recursive: true });
  const link = path.join(home, 'projects');
  await symlink(projects, link);
  const selected = selectedHostIn(data);
  if (select) await writeFile(selected, home);
  return { data, home, projects, link, selected };
}

/** Where the value must lead: the real bot folder, then `claude-memory`. The caller gives the real path. */
const ownOf = (realHome) => path.join(realHome, FOLDER);

/** A run of `obk` that must go through. */
async function ok(box, args, options) {
  const result = await box.run(args, options);
  assert.equal(result.code, 0, `obk ${args.join(' ')} should have gone through:\n${result.stdout}${result.stderr}`);
  return result;
}

/**
 * Bot Father, a bot on `harness`, and the sessions named on it. Each session is
 * `name` or `[name, ...flags of session add]`. Nothing is brought up but Bot
 * Father, which `init` opens, so a test can change things first.
 */
async function fleetIn(box, { bots = 'bots', harness = 'claude', sessions = ['daily'], bot = BOT, init = true } = {}) {
  if (init) await ok(box, ['init', '--bots', bots, '--harness', 'claude']);
  await ok(box, ['bot', 'create', '--bots', bots, '--name', bot, '--harness', harness]);
  for (const session of sessions) {
    const [name, ...flags] = [session].flat();
    await ok(box, ['session', 'add', '--bots', bots, '--bot', bot, '--name', name, ...flags]);
  }
}

/**
 * The one line the kit typed into a session's tab, as the fake Orca received
 * it. With `restarted`, the tab is one `obk restart` opened after it closed the
 * session's live tab and resumed the conversation: since #726 the restart line
 * (helpers/cli.js restartLineOf) follows the launch line there, and nothing else.
 * With `unpaused`, the tab is one `obk unpause` opened after it took the pause
 * off and resumed the conversation: since #732 the unpause line
 * (helpers/cli.js unpauseLineOf) follows the launch line there, and nothing else.
 */
async function lineOf(box, bots, name, bot = BOT, { restarted = false, unpaused = false } = {}) {
  const entry = await sessionIn(bots, bot, name);
  assert.equal(typeof entry?.tab, 'string', `the book should hold a tab for ${bot}/${name}, got: ${JSON.stringify(entry)}`);
  const terminal = (await box.orca.terminals()).find((one) => one.tabId === entry.tab);
  assert.ok(terminal, `Orca should have ${bot}/${name}'s tab ${entry.tab}`);
  const typed = typedInto(terminal);
  const after = restarted ? [restartLineOf(box.cli, bots)] : unpaused ? [unpauseLineOf(box.cli, bots)] : [];
  assert.deepEqual(typed.slice(1), after, `one line per new session tab, and after a restart's resume the restart line alone (after an unpause's resume, the unpause line alone), got: ${JSON.stringify(typed)}`);
  return typed[0];
}

/** Bring one session up and give back the run and the line typed into its tab. */
async function upSession(box, name, { bots = 'bots', realBots = box.path('bots'), bot = BOT } = {}) {
  const result = await ok(box, ['up', '--bots', bots, '--bot', bot, '--session', name]);
  return { result, line: await lineOf(box, realBots, name, bot) };
}

/** The arguments a real shell hands the harness when it runs `line`. */
async function argvOf(box, line, harness = 'claude') {
  const fake = await fakeProgram(box, harness, {});
  const from = (await fake.calls()).length;
  const ran = await sh(line, { cwd: box.cwd, env: box.env });
  assert.equal(ran.code, 0, `the line should run: ${line}\n${ran.stderr}`);
  const calls = (await fake.calls()).slice(from);
  assert.equal(calls.length, 1, `the line should start the harness once, and only once: ${line}`);
  return calls[0].args;
}

/** The harness's options: everything before the prompt separator. */
function flagsOf(argv) {
  const at = argv.indexOf('--');
  return at < 0 ? argv : argv.slice(0, at);
}

const isSettingsWord = (word) => word === '--settings' || word.startsWith('--settings=');

/**
 * What the pair says, read from the harness's argv: exactly one `--settings`,
 * the next word JSON, an object with exactly the one key. Gives back the value.
 */
function memoryDirIn(argv) {
  const flags = flagsOf(argv);
  const said = flags.filter(isSettingsWord);
  assert.deepEqual(said, ['--settings'], `the options should hold one --settings as a word of its own, got: ${JSON.stringify(argv)}`);
  const json = flags[flags.indexOf('--settings') + 1];
  assert.equal(typeof json, 'string', `--settings should have a value, got: ${JSON.stringify(argv)}`);
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    assert.fail(`the word after --settings should be JSON, got ${json}: ${error.message}`);
  }
  assert.ok(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed), `the JSON should be an object, got: ${json}`);
  assert.deepEqual(
    Object.keys(parsed),
    [KEY],
    `the JSON holds ${KEY} and no other key, not autoMemoryEnabled, not env, nothing: the kit refuses --settings from a user for what else it can carry. Got: ${json}`,
  );
  assert.equal(typeof parsed[KEY], 'string', `the value should be a path, got: ${json}`);
  return parsed[KEY];
}

/** The argv with the pair taken out, and the token of the name and the appended system text's path written the way `bareLaunch` writes them. */
function withoutPair(argv) {
  const at = argv.indexOf('--settings');
  const left = at < 0 ? [...argv] : [...argv.slice(0, at), ...argv.slice(at + 2)];
  // The appended system text's path (#768) as `bareLaunch` writes it.
  return systemlessArgv(left.map((word, index) => (left[index - 1] === '-n' ? tokenlessWord(word) : word)));
}

/** The arguments of today's line for a session with nothing set: after the pid, the CLI and the harness word. */
const todaysArgv = (box, name, { bots, bot = BOT } = {}) =>
  harnessPartOf(bareLaunch(box, 'claude', bot, name, { bots, memory: false })).split(' ').slice(3);

/**
 * The line carries the pair with this value, and nothing else has moved: with
 * the pair taken out, the argv is today's for a session with nothing set.
 */
async function assertCarries(box, line, expected, name, { bots, bot } = {}) {
  const argv = await argvOf(box, line);
  assert.equal(memoryDirIn(argv), expected, `the value of ${KEY} on: ${line}`);
  assert.deepEqual(withoutPair(argv), todaysArgv(box, name, { bots, bot }), 'with the pair taken out, every word is as it is today');
}

/**
 * The line is exactly today's, and the run said nothing about any of this, as
 * it says nothing today for a folder a user named.
 */
function assertTodaysLine(box, { result, line }, name, { bots } = {}) {
  assert.equal(tokenless(line), bareLaunch(box, 'claude', BOT, name, { bots, memory: false }), 'the launch line is exactly what it is today');
  const said = `${result.stdout}${result.stderr}`;
  assert.doesNotMatch(said, /autoMemory|selected-host|claude-profiles|memory folder/i, `no message about this, got:\n${said}`);
}

/**
 * The settings files where a user names a folder by hand. `root` is the
 * repository root, which in the usual sandbox is the bots folder: `init` makes
 * it a repository. `user` is `~/.claude/settings.json`, which counts only when
 * no profile is selected.
 */
const settingsFilesOf = (box, home, profile, root) => ({
  bot: path.join(home, '.claude', 'settings.json'),
  local: path.join(home, '.claude', 'settings.local.json'),
  profile: profile === undefined ? undefined : path.join(profile.home, 'settings.json'),
  root: path.join(root, '.claude', 'settings.local.json'),
  user: userSettingsOf(box),
});

/**
 * The shape of every negative case. A control session is brought up first and
 * has the pair. Then `change` changes one thing, and the next session is
 * brought up in the same sandbox, in the same folder: its line is today's, with
 * no error. `change` is given the profile and the bot's home. With
 * `profile: false`, Orca has no profile at all in the sandbox.
 */
async function controlThenCase(t, change, { profile: withProfile = true } = {}) {
  const box = await createSandbox(t);
  const profile = withProfile ? await profileIn(box) : undefined;
  await fleetIn(box, { sessions: ['control', 'daily'] });
  const bots = box.path('bots');
  const home = botHomeOf(bots, BOT);
  const { line: control } = await upSession(box, 'control');
  await assertCarries(box, control, ownOf(home), 'control');

  await change({ box, profile, home, bots, files: settingsFilesOf(box, home, profile, bots) });

  const brought = await upSession(box, 'daily');
  assertTodaysLine(box, brought, 'daily');
  return { box, profile, home, bots };
}

/**
 * A change that does not move the pair, in the shape of `controlThenCase`: the
 * control is brought up first, then `change` changes one thing, and the next
 * session of the same sandbox carries the same value as the control.
 */
async function controlThenStill(t, change, { profile: withProfile = true } = {}) {
  const box = await createSandbox(t);
  const profile = withProfile ? await profileIn(box) : undefined;
  await fleetIn(box, { sessions: ['control', 'daily'] });
  const bots = box.path('bots');
  const home = botHomeOf(bots, BOT);
  const { line: control } = await upSession(box, 'control');
  await assertCarries(box, control, ownOf(home), 'control');

  await change({ box, profile, home, bots, files: settingsFilesOf(box, home, profile, bots) });

  const { line } = await upSession(box, 'daily');
  await assertCarries(box, line, ownOf(home), 'daily');
  return { box, profile, home, bots };
}

/** Add keys to a settings file, keeping what the kit wrote there. */
async function addTo(file, keys) {
  let held = {};
  try {
    held = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify({ ...held, ...keys }, null, 2)}\n`);
}

/** Change one session's `extra_args` in bot.yaml, the way a user editing that file by hand does. */
async function handEdit(home, name, extra) {
  const file = path.join(home, 'bot.yaml');
  const written = parse(await readFile(file, 'utf8'));
  written.sessions = written.sessions.map((session) => (session.name === name ? { ...session, extra_args: extra } : session));
  await writeFile(file, stringify(written));
}

/** A repository with one commit, so that a worktree can be made from it. */
async function repoWithCommit(dir) {
  await mkdir(dir, { recursive: true });
  assert.equal((await git(['init', '--quiet'], dir)).code, 0);
  const made = await git(['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '--allow-empty', '-m', 'first'], dir);
  assert.equal(made.code, 0, made.stderr);
}

/** Tell the book which conversation a session runs, as the kit's hook does, and leave it on Claude Code's own record. */
async function reported(box, bots, name) {
  const entry = await sessionIn(bots, BOT, name);
  const id = `conversation-of-${name}`;
  const ran = await recordSession(box, { bots, bot: BOT, tab: entry.tab, session: id, source: 'startup' });
  assert.equal(ran.code, 0, ran.stderr);
  await conversationOnRecord(box, { harness: 'claude', cwd: botHomeOf(bots, BOT), id });
  return id;
}

/** The value, and that the line resumes `id`: the words of a resume beside the pair. */
async function assertResumeCarries(box, line, expected, id) {
  const argv = await argvOf(box, line);
  assert.equal(memoryDirIn(argv), expected, `the value of ${KEY} on: ${line}`);
  assert.equal(argv[argv.indexOf('--resume') + 1], id, `the line resumes ${id}, got: ${line}`);
}

describe('the launch line names the bot\'s own memory folder (#722, #752)', { concurrency: 8 }, () => {
  // ---------------------------------------------------------------- M1 the pair

  test('M1 a new Claude session gets the pair: the real bot folder, then claude-memory; every other word is today\'s', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);
    await fleetIn(box);
    const bots = box.path('bots');

    const { line } = await upSession(box, 'daily');

    // Written out from the requirement, not through the test's own helper.
    const expected = `${bots}/bots/api-bot/claude-memory`;
    assert.equal(ownOf(botHomeOf(bots, BOT)), expected, 'the premise: the helper says what the requirement says');
    await assertCarries(box, line, expected, 'daily');
  });

  test('M1 every session of a bot gets the same value: a session with a work dir and settings of its own too', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);
    await fleetIn(box, { sessions: ['daily', ['review', '--model', 'opus', '--work-dir', 'work/review']] });
    const bots = box.path('bots');
    await mkdir(path.join(botHomeOf(bots, BOT), 'work', 'review'), { recursive: true });

    const { line: daily } = await upSession(box, 'daily');
    const { line: review } = await upSession(box, 'review');

    const expected = ownOf(botHomeOf(bots, BOT));
    assert.equal(memoryDirIn(await argvOf(box, daily)), expected);
    assert.equal(memoryDirIn(await argvOf(box, review)), expected, 'a session with a work dir of its own still gets its bot\'s folder, not one of the work dir');
  });

  test('M1 two bots of one bots repo get two values, each in its own bot folder', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);
    await fleetIn(box);
    await fleetIn(box, { bot: 'web-bot', init: false });
    const bots = box.path('bots');

    const { line: api } = await upSession(box, 'daily');
    const { line: web } = await upSession(box, 'daily', { bot: 'web-bot' });

    const apiValue = memoryDirIn(await argvOf(box, api));
    const webValue = memoryDirIn(await argvOf(box, web));
    assert.equal(apiValue, ownOf(botHomeOf(bots, BOT)));
    assert.equal(webValue, ownOf(botHomeOf(bots, 'web-bot')));
    assert.notEqual(apiValue, webValue, 'two bots never share a folder');
  });

  test('M1 Bot Father, which init brings up, gets its own value', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);
    await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);
    const bots = box.path('bots');

    const line = await lineOf(box, bots, 'daily', 'bot-father');

    assert.equal(memoryDirIn(await argvOf(box, line)), `${bots}/bots/bot-father/claude-memory`);
  });

  test('M1 the pair goes before the prompt separator, so a session with settings and a prompt still has its prompt as the last word', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);
    const prompt = 'Read your AGENTS.md.';
    await fleetIn(box, { sessions: [['daily', '--model', 'opus', '--effort', 'high', '--extra-arg=--verbose', '--prompt', prompt]] });

    const { line } = await upSession(box, 'daily');

    const argv = await argvOf(box, line);
    assert.equal(memoryDirIn(argv), ownOf(botHomeOf(box.path('bots'), BOT)));
    assert.deepEqual(argv.slice(-2), ['--', prompt], `the prompt is last, after --, got: ${JSON.stringify(argv)}`);
    // The appended system text's pair (#768) comes after the kit's settings, before the user's extra arguments.
    const system = [SYSTEM_FLAG, SYSTEM];
    assert.deepEqual(
      withoutPair(argv),
      [...todaysArgv(box, 'daily').filter((word) => !system.includes(word)), '--model', 'opus', '--effort', 'high', ...system, '--verbose', '--', prompt],
      'the session\'s own settings are as they are today',
    );
  });

  test('M1 a long prompt that goes through a file keeps the pair before the separator', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);
    const prompt = `First line of a long prompt.\n${'And so on. '.repeat(30)}`;
    await fleetIn(box, { sessions: [['daily', `--prompt=${prompt}`]] });

    const { line } = await upSession(box, 'daily');

    const argv = await argvOf(box, line);
    assert.equal(memoryDirIn(argv), ownOf(botHomeOf(box.path('bots'), BOT)));
    assert.equal(argv.at(-1).trim(), prompt.trim(), 'the prompt arrives whole');
  });

  // ------------------------------------------------------------- M2 one word

  const SHELLS = [['sh', '/bin/sh', ['-c']], ['zsh', '/bin/zsh', ['-f', '-c']]];
  for (const [name, shell, flags] of SHELLS) {
    test(`M2 in ${name}, the JSON is one shell word in a path with spaces, quotes, a dollar and a backquote, and reaches the harness as written`, { skip: existsSync(shell) ? undefined : `no ${shell} here` }, async (t) => {
      const box = await createSandbox(t);
      await profileIn(box);
      const bots = path.join(box.root, 'it\'s "my" $HOME `date` folder', 'bots');
      await mkdir(path.dirname(bots), { recursive: true });
      await fleetIn(box, { bots });

      const { line } = await upSession(box, 'daily', { bots, realBots: bots });

      const fake = await fakeProgram(box, 'claude', {});
      const ran = spawnSync(shell, [...flags, line], { cwd: box.cwd, env: box.env, encoding: 'utf8' });
      assert.equal(ran.status, 0, `the line should run in ${name}: ${line}\n${ran.stderr}`);
      const calls = await fake.calls();
      assert.equal(calls.length, 1, `the line should start the harness once in ${name}: ${line}`);
      assert.equal(memoryDirIn(calls[0].args), ownOf(botHomeOf(bots, BOT)));
    });
  }

  // -------------------------------------------------------- M3 the text itself

  test('M3 the value is the path as it is: spaces, an underscore, a dot, a letter outside ASCII and capitals stay; nothing is a slug', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);
    const name = 'My Bots_文.Z1';
    await fleetIn(box, { bots: name });
    const bots = box.path(name);

    const { line } = await upSession(box, 'daily', { bots: name, realBots: bots });

    assert.equal(memoryDirIn(await argvOf(box, line)), `${box.cwd}/My Bots_文.Z1/bots/api-bot/claude-memory`);
  });

  // The value is the real path, and no NFC step: a folder stored in NFD form
  // keeps that form in the value, `e` and U+0301 as two characters.
  const NFD_NAME = 'café';
  for (const [label, withRepo] of [['in a repository', true], ['with no repository', false]]) {
    test(`M3 a bots folder stored in NFD form, ${label}: the value keeps the NFD form`, async (t) => {
      const box = await createSandbox(t);
      await profileIn(box);
      await fleetIn(box, { bots: NFD_NAME });
      const stored = await readdir(box.cwd);
      if (!stored.includes(NFD_NAME)) {
        t.skip(`this filesystem does not keep the NFD form of a name: it holds ${JSON.stringify(stored)}`);
        return;
      }
      const bots = box.path(NFD_NAME);
      if (!withRepo) await rm(path.join(bots, '.git'), { recursive: true });

      const { line } = await upSession(box, 'daily', { bots: NFD_NAME, realBots: bots });

      const value = memoryDirIn(await argvOf(box, line));
      assert.equal(value, `${box.cwd}/café/bots/api-bot/claude-memory`);
      assert.notEqual(value, value.normalize('NFC'), 'the premise: the NFC form is another text');
    });
  }

  // ----------------------------------------------- M4 links on the way resolved

  test('M4 a bots folder given through a link: the real path of the bot folder', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);
    const real = path.join(box.root, 'elsewhere', 'real-bots');
    await mkdir(real, { recursive: true });
    await symlink(real, box.path('linked-bots'));
    await fleetIn(box, { bots: 'linked-bots' });

    const { line } = await upSession(box, 'daily', { bots: 'linked-bots', realBots: real });

    assert.equal(memoryDirIn(await argvOf(box, line)), ownOf(botHomeOf(real, BOT)));
  });

  test('M4 a bots folder under a parent folder given through a relative link: the real path', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);
    const realParent = path.join(box.root, 'elsewhere', 'real-parent');
    await mkdir(realParent, { recursive: true });
    await symlink(path.relative(box.cwd, realParent), box.path('linked-parent'));
    const given = box.path('linked-parent', 'bots');
    await mkdir(given);
    await fleetIn(box, { bots: given });
    const real = path.join(realParent, 'bots');

    const { line } = await upSession(box, 'daily', { bots: given, realBots: real });

    assert.equal(memoryDirIn(await argvOf(box, line)), ownOf(botHomeOf(real, BOT)));
  });

  test('M4 a bots folder given through a link to a link: the final real path', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);
    const real = path.join(box.root, 'elsewhere', 'real-bots');
    await mkdir(real, { recursive: true });
    await symlink(real, path.join(box.root, 'middle-link'));
    await symlink(path.join(box.root, 'middle-link'), box.path('linked-bots'));
    await fleetIn(box, { bots: 'linked-bots' });

    const { line } = await upSession(box, 'daily', { bots: 'linked-bots', realBots: real });

    assert.equal(memoryDirIn(await argvOf(box, line)), ownOf(botHomeOf(real, BOT)));
  });

  // In a repository, the link leads to a folder inside the same repository.
  for (const [label, withRepo] of [['in a repository', true], ['with no repository', false]]) {
    test(`M4 a bot folder that is itself a link, ${label}: the real path of the bot folder`, async (t) => {
      const box = await createSandbox(t);
      await profileIn(box);
      await fleetIn(box);
      const bots = box.path('bots');
      if (!withRepo) await rm(path.join(bots, '.git'), { recursive: true });
      const home = botHomeOf(bots, BOT);
      const real = withRepo ? path.join(bots, 'moved', BOT) : path.join(box.root, 'elsewhere', BOT);
      await mkdir(path.dirname(real), { recursive: true });
      await rename(home, real);
      await symlink(real, home);

      const { line } = await upSession(box, 'daily');

      assert.equal(memoryDirIn(await argvOf(box, line)), ownOf(real));
    });
  }

  // ---------------------------------------- M5 the repository does not matter

  test('M5 a bots folder that is the repository: the bot folder, not the repository\'s top', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);
    await fleetIn(box);
    const bots = box.path('bots');
    assert.equal((await git(['rev-parse', '--show-toplevel'], botHomeOf(bots, BOT))).stdout.trim(), bots, 'the premise: the bots folder is the repository\'s top');

    const { line } = await upSession(box, 'daily');

    assert.equal(memoryDirIn(await argvOf(box, line)), ownOf(botHomeOf(bots, BOT)));
  });

  test('M5 a linked git worktree: the bot folder in the worktree, not the main repository', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);
    const main = path.join(box.root, 'main repo');
    await repoWithCommit(main);
    const worktree = path.join(box.root, 'a-worktree');
    const added = await git(['worktree', 'add', '--quiet', worktree], main);
    assert.equal(added.code, 0, added.stderr);
    await fleetIn(box, { bots: worktree });

    const { line } = await upSession(box, 'daily', { bots: worktree, realBots: worktree });

    assert.equal(memoryDirIn(await argvOf(box, line)), ownOf(botHomeOf(worktree, BOT)));
  });

  test('M5 a linked worktree of a bare repository: the bot folder', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);
    const seed = path.join(box.root, 'seed');
    await repoWithCommit(seed);
    const store = path.join(box.root, 'store.git');
    const cloned = await git(['clone', '--quiet', '--bare', seed, store], box.root);
    assert.equal(cloned.code, 0, cloned.stderr);
    const bots = path.join(box.root, 'a-worktree');
    const added = await git(['worktree', 'add', '--quiet', bots], store);
    assert.equal(added.code, 0, added.stderr);
    await fleetIn(box, { bots });
    const shared = await git(['rev-parse', '--git-common-dir'], bots);
    assert.equal(path.basename(shared.stdout.trim()), 'store.git', 'the premise: the shared git folder is not named .git');

    const { line } = await upSession(box, 'daily', { bots, realBots: bots });

    await assertCarries(box, line, ownOf(botHomeOf(bots, BOT)), 'daily', { bots });
  });

  test('M5 a repository around the bots folder: the bot folder, not that repository\'s top', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);
    const outer = path.join(box.root, 'outer');
    const bots = path.join(outer, 'fleet', 'bots');
    await mkdir(path.dirname(bots), { recursive: true });
    await fleetIn(box, { bots });
    await rm(path.join(bots, '.git'), { recursive: true });
    await repoWithCommit(outer);

    const { line } = await upSession(box, 'daily', { bots, realBots: bots });

    assert.equal(memoryDirIn(await argvOf(box, line)), ownOf(botHomeOf(bots, BOT)));
  });

  test('M5 a bot folder that is a repository of its own: the bot folder', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);
    await fleetIn(box);
    const home = botHomeOf(box.path('bots'), BOT);
    assert.equal((await git(['init', '--quiet'], home)).code, 0);

    const { line } = await upSession(box, 'daily');

    assert.equal(memoryDirIn(await argvOf(box, line)), ownOf(home));
  });

  test('M5 no repository: the real path of the bot folder', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);
    await fleetIn(box);
    const bots = box.path('bots');
    await rm(path.join(bots, '.git'), { recursive: true });
    assert.notEqual((await git(['rev-parse', '--show-toplevel'], bots)).code, 0, 'the premise: no repository holds the bots folder');

    const { line } = await upSession(box, 'daily');

    assert.equal(memoryDirIn(await argvOf(box, line)), ownOf(botHomeOf(bots, BOT)));
  });

  for (const [where, inner] of [['at', []], ['inside', ['fleet-bots']]]) {
    test(`M5 a repository made with --separate-git-dir, the bots folder ${where} its top: the bot folder`, async (t) => {
      const box = await createSandbox(t);
      await profileIn(box);
      const fleet = path.join(box.root, 'fleet');
      await mkdir(path.join(box.root, 'metadata'));
      const made = await git(['init', '--quiet', '--separate-git-dir', path.join(box.root, 'metadata', '.git'), fleet], box.root);
      assert.equal(made.code, 0, made.stderr);
      const bots = path.join(fleet, ...inner);
      await mkdir(bots, { recursive: true });
      await fleetIn(box, { bots });
      if (inner.length > 0) await rm(path.join(bots, '.git'), { recursive: true });

      const { line } = await upSession(box, 'daily', { bots, realBots: bots });

      await assertCarries(box, line, ownOf(botHomeOf(bots, BOT)), 'daily', { bots });
    });
  }

  for (const [named, parts] of [['another name', ['elsewhere', 'real.git']], ['the name .git', ['elsewhere', '.git']]]) {
    test(`M5 a .git at the bots folder that is a symbolic link to a git folder of ${named}: the bot folder`, async (t) => {
      await controlThenStill(t, async ({ box }) => {
        const entry = box.path('bots', '.git');
        const real = path.join(box.root, ...parts);
        await mkdir(path.dirname(real), { recursive: true });
        await rename(entry, real);
        await symlink(real, entry);
        assert.equal((await git(['rev-parse', '--git-common-dir'], box.path('bots'))).code, 0, 'the premise: git follows the link');
      });
    });
  }

  // A `.git` entry at the bot folder or above it, and git cannot answer there.
  const GARBAGE = 'this is not a git file\n';
  const GIT_CANNOT_ANSWER = [
    ['a .git file with garbage text at the bot folder, under a good repository', ({ home }) => writeFile(path.join(home, '.git'), GARBAGE)],
    ['a .git file with garbage text at the bots folder', async ({ box }) => {
      await rm(box.path('bots', '.git'), { recursive: true });
      await writeFile(box.path('bots', '.git'), GARBAGE);
    }],
    ['a .git file with garbage text above the bots folder', async ({ box }) => {
      await rm(box.path('bots', '.git'), { recursive: true });
      await writeFile(path.join(box.cwd, '.git'), GARBAGE);
    }],
    ['an empty .git folder at the bots folder', async ({ box }) => {
      await rm(box.path('bots', '.git'), { recursive: true });
      await mkdir(box.path('bots', '.git'));
    }],
  ];
  for (const [label, change] of GIT_CANNOT_ANSWER) {
    test(`M5 ${label}: git cannot answer, and the pair names the bot folder`, async (t) => {
      await controlThenStill(t, async (world) => {
        await change(world);
        assert.notEqual((await git(['rev-parse', '--show-toplevel'], world.home)).code, 0, 'the premise: git cannot answer at the bot folder');
      });
    });
  }

  test('M5 a session\'s work dir that is a repository of its own changes nothing: the bot folder, not the work dir', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);
    await fleetIn(box, { sessions: [['daily', '--work-dir', 'work/api']] });
    const home = botHomeOf(box.path('bots'), BOT);
    const workDir = path.join(home, 'work', 'api');
    await mkdir(workDir, { recursive: true });
    assert.equal((await git(['init', '--quiet'], workDir)).code, 0);

    const { line } = await upSession(box, 'daily');

    assert.equal(memoryDirIn(await argvOf(box, line)), ownOf(home));
  });

  // ------------------------------------------------------- M6 no length limit

  for (const length of [201, 400]) {
    test(`M6 a bot folder whose real path has ${length} characters still gets the pair`, async (t) => {
      const box = await createSandbox(t);
      await profileIn(box);
      const tail = `/bots/${BOT}`.length;
      let rest = length - box.cwd.length - tail;
      const parts = [];
      while (rest > 0) {
        const piece = Math.min(rest - 1, 200);
        assert.ok(piece > 0, `the premise: a path of ${length} characters can be made here`);
        parts.push('x'.repeat(piece));
        rest -= piece + 1;
      }
      const bots = box.path(...parts);
      await mkdir(path.dirname(bots), { recursive: true });
      await fleetIn(box, { bots });
      const home = botHomeOf(bots, BOT);
      assert.equal(home.length, length, 'the premise: the bot folder has the length the test says');

      const { line } = await upSession(box, 'daily', { bots, realBots: bots });

      await assertCarries(box, line, ownOf(home), 'daily', { bots });
    });
  }

  // ------------------------------------------- M7 the profile does not matter

  test('M7 with no Orca profile at all: the pair names the bot folder', async (t) => {
    const box = await createSandbox(t);
    await fleetIn(box);
    assert.ok(!existsSync(path.join(orcaDataOf(box), 'claude-profiles')), 'the premise: Orca has no profiles here');

    const { line } = await upSession(box, 'daily');

    await assertCarries(box, line, ownOf(botHomeOf(box.path('bots'), BOT)), 'daily');
  });

  const PROFILE_CHANGES = [
    ['selected-host is not there', ({ profile }) => rm(profile.selected)],
    ['selected-host is empty', ({ profile }) => writeFile(profile.selected, '')],
    ['selected-host is a folder', async ({ profile }) => {
      await rm(profile.selected);
      await mkdir(profile.selected);
    }],
    ['selected-host names a home that is not there', ({ box, profile }) => writeFile(profile.selected, path.join(box.root, 'no-such-profile', 'home'))],
    ['selected-host cannot be read: mode 000', ({ profile }) => chmod(profile.selected, 0o000), { skip: AS_ROOT }],
    ['the profile\'s projects is a real folder', async ({ profile }) => {
      await rm(profile.link);
      await mkdir(profile.link);
    }],
    ['the profile\'s projects is not there', ({ profile }) => rm(profile.link)],
    ['the profile\'s projects is a link that leads nowhere', async ({ box, profile }) => {
      await rm(profile.link);
      await symlink(path.join(box.root, 'no-such-folder'), profile.link);
    }],
    ['the profile\'s projects is a link to itself', async ({ profile }) => {
      await rm(profile.link);
      await symlink(profile.link, profile.link);
    }],
    ['Orca\'s data folder is gone', ({ profile }) => rm(profile.data, { recursive: true })],
    ['OBK_ORCA_DATA names a folder with no selected-host', async ({ box }) => {
      const lean = path.join(box.home, 'Library', 'Application Support', 'orca-lean');
      await mkdir(lean, { recursive: true });
      box.env.OBK_ORCA_DATA = lean;
    }],
    ['OBK_ORCA_DATA names another profile', async ({ box }) => {
      const lean = await profileIn(box, { data: path.join(box.home, 'Library', 'Application Support', 'orca-lean'), projects: path.join(box.root, 'lean-projects') });
      box.env.OBK_ORCA_DATA = lean.data;
    }],
    ['the kit\'s own CLAUDE_CONFIG_DIR names another profile', async ({ box }) => {
      const other = await profileIn(box, { name: 'profile-two', projects: path.join(box.root, 'other-projects'), select: false });
      box.env.CLAUDE_CONFIG_DIR = other.home;
    }],
    ['another profile is selected', async ({ box }) => {
      await profileIn(box, { name: 'profile-two', projects: path.join(box.root, 'other-projects') });
    }],
  ];
  for (const [label, change, options] of PROFILE_CHANGES) {
    test(`M7 ${label}: the value is the same`, options ?? {}, async (t) => {
      await controlThenStill(t, change);
    });
  }

  test('M7 a profile selected after a start with none: the value is the same', async (t) => {
    await controlThenStill(t, ({ box }) => profileIn(box), { profile: false });
  });

  // --------------------------------------------------- M8 a hand-set key

  const HAVING_THE_KEY = [
    ['holds the key with a path', (file) => addTo(file, { [KEY]: '/somewhere/of/my/own' })],
    ['holds the key with null', (file) => addTo(file, { [KEY]: null })],
    ['holds the key with an empty string', (file) => addTo(file, { [KEY]: '' })],
    ['cannot be parsed', (file) => mkdir(path.dirname(file), { recursive: true }).then(() => writeFile(file, '{ not json'))],
    ['is empty, and so cannot be parsed', (file) => mkdir(path.dirname(file), { recursive: true }).then(() => writeFile(file, ''))],
    ['cannot be read: it is a folder', async (file) => {
      await rm(file, { force: true });
      await mkdir(file, { recursive: true });
    }],
    ['cannot be read: mode 000', async (file) => {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, '{}\n');
      await chmod(file, 0o000);
    }, { skip: AS_ROOT }],
  ];
  // The kit writes its session hook into the bot's .claude/settings.json, so
  // `up` stops with an error when it cannot read or parse that file, and no line
  // is typed ("is not readable as JSON", EISDIR, EACCES). That stays. So those
  // cases of the bot's own file cannot reach a launch line, and are not cases.
  const STOPS_THE_BRING_UP_TODAY = new Set(['cannot be parsed', 'is empty, and so cannot be parsed', 'cannot be read: it is a folder', 'cannot be read: mode 000']);
  for (const where of ['bot', 'local', 'profile', 'root']) {
    for (const [label, change, options] of HAVING_THE_KEY) {
      if (where === 'bot' && STOPS_THE_BRING_UP_TODAY.has(label)) continue;
      test(`M8 the ${where} settings file ${label}: nothing is added`, options ?? {}, async (t) => {
        const { home } = await controlThenCase(t, ({ files }) => change(files[where]));
        // A hand-written key is still there after the bring-up.
        if (where === 'bot' && label.startsWith('holds the key')) {
          const after = JSON.parse(await readFile(path.join(home, '.claude', 'settings.json'), 'utf8'));
          assert.ok(Object.hasOwn(after, KEY), `the user's ${KEY} stays in .claude/settings.json, got: ${JSON.stringify(after)}`);
        }
      });
    }
  }

  // With no profile selected, the user level is ~/.claude/settings.json.
  for (const [label, change, options] of HAVING_THE_KEY) {
    test(`M8 no profile, and ~/.claude/settings.json ${label}: nothing is added`, options ?? {}, async (t) => {
      await controlThenCase(t, ({ files }) => change(files.user), { profile: false });
    });
  }

  const NO_LONGER_SELECTED = [
    ['selected-host is taken away', ({ profile }) => rm(profile.selected)],
    ['selected-host is emptied', ({ profile }) => writeFile(profile.selected, '')],
  ];
  for (const [label, unselect] of NO_LONGER_SELECTED) {
    test(`M8 ${label}, and ~/.claude/settings.json holds the key: nothing is added`, async (t) => {
      await controlThenCase(t, async (world) => {
        await unselect(world);
        await addTo(world.files.user, { [KEY]: '/somewhere/of/my/own' });
      });
    });
  }

  test('M8 OBK_ORCA_DATA names a selected profile whose settings.json holds the key: nothing is added', async (t) => {
    await controlThenCase(t, async ({ box }) => {
      const lean = await profileIn(box, { data: path.join(box.home, 'Library', 'Application Support', 'orca-lean'), projects: path.join(box.root, 'lean-projects') });
      box.env.OBK_ORCA_DATA = lean.data;
      await addTo(path.join(lean.home, 'settings.json'), { [KEY]: '/somewhere/of/my/own' });
    });
  });

  // ---------------------------------------------- M9 what does not count

  const NOT_HAVING_THE_KEY = [
    ['holds other keys', (file) => addTo(file, { model: 'opus', theme: 'dark' })],
    ['holds the key\'s name only deeper down', (file) => addTo(file, { nested: { [KEY]: '/somewhere' } })],
    ['holds the key\'s name only as a value', (file) => addTo(file, { note: KEY })],
  ];
  for (const where of ['bot', 'local', 'profile', 'root']) {
    for (const [label, change] of NOT_HAVING_THE_KEY) {
      test(`M9 the ${where} settings file ${label}: the pair is added`, async (t) => {
        await controlThenStill(t, ({ files }) => change(files[where]));
      });
    }
  }
  for (const [label, change] of NOT_HAVING_THE_KEY) {
    test(`M9 no profile, and ~/.claude/settings.json ${label}: the pair is added`, async (t) => {
      await controlThenStill(t, ({ files }) => change(files.user), { profile: false });
    });
  }

  // Valid JSON that is not an object has no key, so it does not count. In the
  // bot's own .claude/settings.json it stops the bring-up, as an unparsable file
  // does, so that file is not a case here.
  const NOT_AN_OBJECT = [['null', 'null'], ['an array', '[]'], ['a number', '42'], ['a string', '"text"']];
  for (const where of ['local', 'profile', 'root']) {
    for (const [label, text] of NOT_AN_OBJECT) {
      test(`M9 the ${where} settings file holds ${label}: it has no key, and the pair is added`, async (t) => {
        await controlThenStill(t, async ({ files }) => {
          await mkdir(path.dirname(files[where]), { recursive: true });
          await writeFile(files[where], text);
        });
      });
    }
  }

  test('M9 with a profile selected, the key in ~/.claude/settings.json does not count: the pair is added', async (t) => {
    await controlThenStill(t, ({ files }) => addTo(files.user, { [KEY]: '/somewhere/of/my/own' }));
  });

  test('M9 with a profile selected, ~/.claude/settings.json that cannot be parsed does not count: the pair is added', async (t) => {
    await controlThenStill(t, async ({ files }) => {
      await mkdir(path.dirname(files.user), { recursive: true });
      await writeFile(files.user, '{ not json');
    });
  });

  test('M9 the key in a profile that is not selected does not count: the pair is added', async (t) => {
    await controlThenStill(t, async ({ box }) => {
      const other = await profileIn(box, { name: 'profile-two', projects: path.join(box.root, 'other-projects'), select: false });
      await addTo(path.join(other.home, 'settings.json'), { [KEY]: '/somewhere/of/my/own' });
    });
  });

  test('M9 OBK_ORCA_DATA names another Orca data folder: the key in the default folder\'s selected profile does not count', async (t) => {
    await controlThenStill(t, async ({ box, profile }) => {
      const lean = await profileIn(box, { data: path.join(box.home, 'Library', 'Application Support', 'orca-lean'), projects: path.join(box.root, 'lean-projects') });
      box.env.OBK_ORCA_DATA = lean.data;
      await addTo(path.join(profile.home, 'settings.json'), { [KEY]: '/somewhere/of/my/own' });
    });
  });

  // ------------------------- M8, M9 the repository root's file, by where the root is

  // In each of these, the control proves the line has the pair before the
  // change. The repository root's settings.json is not on the list: Claude Code
  // reads project settings from the bot folder alone. Nor is a local file that
  // is neither the repository root's nor the bot folder's.
  const ROOTS = [
    ['a linked worktree', async (box) => {
      const main = path.join(box.root, 'main repo');
      await repoWithCommit(main);
      const bots = path.join(box.root, 'a-worktree');
      const added = await git(['worktree', 'add', '--quiet', bots], main);
      assert.equal(added.code, 0, added.stderr);
      await fleetIn(box, { bots, sessions: ['control', 'daily'] });
      return { bots, root: main, notListed: [path.join(bots, '.claude', 'settings.local.json')] };
    }],
    ['a repository around the bots folder', async (box) => {
      const outer = path.join(box.root, 'outer');
      const bots = path.join(outer, 'fleet', 'bots');
      await mkdir(path.dirname(bots), { recursive: true });
      await fleetIn(box, { bots, sessions: ['control', 'daily'] });
      await rm(path.join(bots, '.git'), { recursive: true });
      await repoWithCommit(outer);
      return { bots, root: outer, notListed: [path.join(bots, '.claude', 'settings.local.json'), path.join(outer, 'fleet', '.claude', 'settings.local.json')] };
    }],
    ['a bot folder that is a repository of its own', async (box) => {
      const bots = box.path('bots');
      await fleetIn(box, { sessions: ['control', 'daily'] });
      const home = botHomeOf(bots, BOT);
      assert.equal((await git(['init', '--quiet'], home)).code, 0);
      return { bots, root: home, notListed: [path.join(bots, '.claude', 'settings.local.json')] };
    }],
    ['no repository', async (box) => {
      const bots = box.path('bots');
      await fleetIn(box, { sessions: ['control', 'daily'] });
      await rm(path.join(bots, '.git'), { recursive: true });
      return { bots, root: botHomeOf(bots, BOT), notListed: [path.join(bots, '.claude', 'settings.local.json')] };
    }],
  ];

  /** A sandbox laid out by `lay`, its control brought up, with the pair. */
  async function controlAt(t, lay) {
    const box = await createSandbox(t);
    await profileIn(box);
    const { bots, root, notListed } = await lay(box);
    const { line } = await upSession(box, 'control', { bots, realBots: bots });
    const expected = ownOf(botHomeOf(bots, BOT));
    assert.equal(memoryDirIn(await argvOf(box, line)), expected, 'the control has the pair');
    return { box, bots, root, notListed, expected, local: path.join(root, '.claude', 'settings.local.json') };
  }

  /** The next session of that sandbox: the pair is there, or nothing of it. */
  async function nextOf(box, bots, expected) {
    const brought = await upSession(box, 'daily', { bots, realBots: bots });
    if (expected === undefined) assertTodaysLine(box, brought, 'daily', { bots });
    else await assertCarries(box, brought.line, expected, 'daily', { bots });
  }

  for (const [where, lay] of ROOTS) {
    test(`M8 ${where}: the key in the repository root's settings.local.json: nothing is added`, async (t) => {
      const { box, bots, local } = await controlAt(t, lay);
      await addTo(local, { [KEY]: '/somewhere/of/my/own' });
      await nextOf(box, bots);
    });

    test(`M8 ${where}: the repository root's settings.local.json cannot be parsed: nothing is added`, async (t) => {
      const { box, bots, local } = await controlAt(t, lay);
      await mkdir(path.dirname(local), { recursive: true });
      await writeFile(local, '{ not json');
      await nextOf(box, bots);
    });

    test(`M8 ${where}: the repository root's settings.local.json cannot be read: nothing is added`, { skip: AS_ROOT }, async (t) => {
      const { box, bots, local } = await controlAt(t, lay);
      await mkdir(path.dirname(local), { recursive: true });
      await writeFile(local, '{}\n');
      await chmod(local, 0o000);
      await nextOf(box, bots);
    });

    test(`M9 ${where}: the repository root's settings.local.json holds other keys: the pair is added`, async (t) => {
      const { box, bots, expected, local } = await controlAt(t, lay);
      await addTo(local, { model: 'opus' });
      await nextOf(box, bots, expected);
    });

    test(`M9 ${where}: the key in a local file that is not the repository root's: the pair is added`, async (t) => {
      const { box, bots, expected, notListed } = await controlAt(t, lay);
      for (const file of notListed) await addTo(file, { [KEY]: '/somewhere/of/my/own' });
      await nextOf(box, bots, expected);
    });
  }

  // Where the bot folder is itself the repository root, this settings.json is
  // the bot's own, which is on the list, so those two layouts are not cases.
  for (const [where, lay] of [...ROOTS.slice(0, 2), ['a bots folder that is the repository', async (box) => {
    const bots = box.path('bots');
    await fleetIn(box, { sessions: ['control', 'daily'] });
    return { bots, root: bots, notListed: [] };
  }]]) {
    test(`M9 ${where}: the key in the repository root's settings.json does not count: the pair is added`, async (t) => {
      const { box, bots, root, expected } = await controlAt(t, lay);
      await addTo(path.join(root, '.claude', 'settings.json'), { [KEY]: '/somewhere/of/my/own' });
      await nextOf(box, bots, expected);
    });
  }

  // When the kit is not sure of the repository root, it does not look at a
  // root's settings.local.json at all. Here the bots folder is the top that git
  // would name, and the key there does not stop the pair.
  const ROOT_NOT_SURE = [
    ['a .git at the bots folder that is a symbolic link', async ({ box }) => {
      const entry = box.path('bots', '.git');
      const real = path.join(box.root, 'elsewhere', '.git');
      await mkdir(path.dirname(real), { recursive: true });
      await rename(entry, real);
      await symlink(real, entry);
    }],
    ['a .git file with garbage text at the bots folder', async ({ box }) => {
      await rm(box.path('bots', '.git'), { recursive: true });
      await writeFile(box.path('bots', '.git'), GARBAGE);
    }],
    ['an empty .git folder at the bots folder', async ({ box }) => {
      await rm(box.path('bots', '.git'), { recursive: true });
      await mkdir(box.path('bots', '.git'));
    }],
  ];
  for (const [label, change] of ROOT_NOT_SURE) {
    test(`M9 ${label}: the kit is not sure of the root, so the key in the bots folder's settings.local.json is not looked at, and the pair is added`, async (t) => {
      await controlThenStill(t, async (world) => {
        await change(world);
        await addTo(path.join(world.bots, '.claude', 'settings.local.json'), { [KEY]: '/somewhere/of/my/own' });
      });
    });
  }

  test('M9 a linked worktree of a bare repository: the kit is not sure of the root, so the key in the worktree\'s settings.local.json is not looked at, and the pair is added', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);
    const seed = path.join(box.root, 'seed');
    await repoWithCommit(seed);
    const store = path.join(box.root, 'store.git');
    assert.equal((await git(['clone', '--quiet', '--bare', seed, store], box.root)).code, 0);
    const bots = path.join(box.root, 'a-worktree');
    assert.equal((await git(['worktree', 'add', '--quiet', bots], store)).code, 0);
    await fleetIn(box, { bots, sessions: ['control', 'daily'] });
    const { line: control } = await upSession(box, 'control', { bots, realBots: bots });
    const expected = ownOf(botHomeOf(bots, BOT));
    assert.equal(memoryDirIn(await argvOf(box, control)), expected, 'the control has the pair');

    await addTo(path.join(bots, '.claude', 'settings.local.json'), { [KEY]: '/somewhere/of/my/own' });

    await nextOf(box, bots, expected);
  });

  // ---------------------------------------------- M10 the session's extra_args

  const USERS_OWN = [
    ['a list, --settings and its value', ['--settings', '/srv/mine.json'], ['--settings', '/srv/mine.json']],
    ['a list, --settings=value', ['--settings=/srv/mine.json'], ['--settings=/srv/mine.json']],
    ['a list, after another argument', ['--verbose', '--settings', '{}'], ['--verbose', '--settings', '{}']],
    ['a string, --settings and its value', '--settings /srv/mine.json', ['--settings', '/srv/mine.json']],
    ['a string, --settings=value', '--settings=/srv/mine.json', ['--settings=/srv/mine.json']],
    ['a string, after another argument', '--verbose --settings=/srv/mine.json', ['--verbose', '--settings=/srv/mine.json']],
    ['a string, the flag in quotes', "'--settings' /srv/mine.json", ['--settings', '/srv/mine.json']],
    ['a string, the whole word in quotes', "'--settings=/srv/my file.json'", ['--settings=/srv/my file.json']],
  ];
  for (const [label, extra, words] of USERS_OWN) {
    test(`M10 extra_args holds the user's own --settings, as ${label}: nothing is added, and theirs goes as written`, async (t) => {
      const box = await createSandbox(t);
      await profileIn(box);
      await fleetIn(box, { sessions: ['control', 'daily'] });
      const bots = box.path('bots');
      const home = botHomeOf(bots, BOT);
      const { line: control } = await upSession(box, 'control');
      await assertCarries(box, control, ownOf(home), 'control');
      await handEdit(home, 'daily', extra);

      const { line } = await upSession(box, 'daily');

      assert.ok(!line.includes(KEY), `the user's hand edit wins, got: ${line}`);
      const argv = await argvOf(box, line);
      assert.deepEqual(
        // The appended system text's path (#768) as `bareLaunch` writes it.
        systemlessArgv(argv.map((word, index) => (argv[index - 1] === '-n' ? tokenlessWord(word) : word))),
        [...todaysArgv(box, 'daily'), ...words],
        'the line is today\'s, with the user\'s words and nothing of the kit\'s',
      );
    });
  }

  const NOT_THE_USERS_OWN = [
    ['an empty list', []],
    ['an empty string', ''],
    ['another flag, in a list', ['--verbose']],
    ['another flag, in a string', '--verbose'],
    ['a flag whose name starts the same, in a list', ['--settings-file', '/srv/x']],
    ['a flag whose name starts the same, in a string', '--settings-file /srv/x'],
    ['one quoted word that merely says it, in a string', "--append-system-prompt '/tmp/a --settings b'"],
  ];
  for (const [label, extra] of NOT_THE_USERS_OWN) {
    test(`M10 extra_args holds ${label}: the pair is added`, async (t) => {
      const box = await createSandbox(t);
      await profileIn(box);
      await fleetIn(box);
      const home = botHomeOf(box.path('bots'), BOT);
      await handEdit(home, 'daily', extra);

      const { line } = await upSession(box, 'daily');

      assert.equal(memoryDirIn(await argvOf(box, line)), ownOf(home));
    });
  }

  test('M10 another session of the bot with its own --settings does not stop this one: the pair is added', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);
    await fleetIn(box, { sessions: ['daily', 'other'] });
    const home = botHomeOf(box.path('bots'), BOT);
    await handEdit(home, 'other', ['--settings', '/srv/mine.json']);

    const { line } = await upSession(box, 'daily');

    assert.equal(memoryDirIn(await argvOf(box, line)), ownOf(home));
  });

  // The kit names no folder for a session with its own `--settings`, and its
  // report says so (the architect's ruling of 2026-11-14 on #752): under that
  // session's tab line, a line names `--settings`. The wording is not held.

  /**
   * The lines of a plain report under the tab line of tab `tabId`: from the
   * line that names `tab <tabId>` to the next line that does not start with
   * a space. Gives back the lines under it, the tab line not among them.
   */
  function underTab(stdout, tabId) {
    const lines = stdout.split('\n');
    const at = lines.findIndex((line) => !/^\s/.test(line) && line.includes(`tab ${tabId}`));
    assert.ok(at >= 0, `the report should have a line for tab ${tabId}, got:\n${stdout}`);
    const under = [];
    for (const line of lines.slice(at + 1)) {
      if (!/^\s/.test(line)) break;
      under.push(line);
    }
    return under;
  }

  const SAYS_SETTINGS = [
    ['a list, --settings and its value', ['--settings', '/srv/mine.json']],
    ['a string, --settings=value', '--verbose --settings=/srv/mine.json'],
  ];
  for (const [label, extra] of SAYS_SETTINGS) {
    test(`M10 the report of up says it: under the tab of a session whose extra_args hold --settings, as ${label}, a line names --settings; under its sibling's tab, none`, async (t) => {
      const box = await createSandbox(t);
      await profileIn(box);
      await fleetIn(box, { sessions: ['daily', 'keeper'] });
      const bots = box.path('bots');
      await handEdit(botHomeOf(bots, BOT), 'keeper', extra);

      const { stdout } = await ok(box, ['up', '--bots', 'bots', '--bot', BOT]);

      const keeper = underTab(stdout, (await sessionIn(bots, BOT, 'keeper')).tab);
      const daily = underTab(stdout, (await sessionIn(bots, BOT, 'daily')).tab);
      assert.ok(keeper.some((line) => line.includes('--settings')), `a line under keeper's tab names --settings, got:\n${stdout}`);
      assert.deepEqual(daily.filter((line) => line.includes('--settings')), [], `nothing under daily's tab names --settings, got:\n${stdout}`);
    });
  }

  test('M10 the report of restart says it: under the new tab of a session whose extra_args hold --settings, a line names --settings', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);
    await fleetIn(box, { sessions: ['keeper'] });
    const bots = box.path('bots');
    await handEdit(botHomeOf(bots, BOT), 'keeper', ['--settings', '/srv/mine.json']);
    await upSession(box, 'keeper');
    await reported(box, bots, 'keeper');

    const { stdout } = await ok(box, ['restart', '--bots', 'bots', '--bot', BOT, '--session', 'keeper']);

    const under = underTab(stdout, (await sessionIn(bots, BOT, 'keeper')).tab);
    assert.ok(under.some((line) => line.includes('--settings')), `a line under keeper's new tab names --settings, got:\n${stdout}`);
  });

  test('M10 the report of restart for a session with no --settings of its own names none under its tab', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);
    await fleetIn(box);
    const bots = box.path('bots');
    await upSession(box, 'daily');
    await reported(box, bots, 'daily');

    const { stdout } = await ok(box, ['restart', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);

    const under = underTab(stdout, (await sessionIn(bots, BOT, 'daily')).tab);
    assert.deepEqual(under.filter((line) => line.includes('--settings')), [], `nothing under daily's tab names --settings, got:\n${stdout}`);
  });

  // ----------------------------------- M11 not a plain folder at claude-memory

  /** Replace what the control's start left at `<home>/claude-memory` with `put`. */
  const atTheFolder = (put) => async (world) => {
    const at = ownOf(world.home);
    await rm(at, { recursive: true, force: true });
    await put(at, world);
  };

  const NOT_A_FOLDER = [
    ['a file', (at) => writeFile(at, 'my own notes\n')],
    ['an empty file', (at) => writeFile(at, '')],
    ['a link to a folder outside the bot folder', async (at, { box }) => {
      const target = path.join(box.root, 'elsewhere', 'notes');
      await mkdir(target, { recursive: true });
      await symlink(target, at);
    }],
    ['a relative link to a folder inside the bot folder', async (at, { home }) => {
      await mkdir(path.join(home, 'notes'), { recursive: true });
      await symlink('notes', at);
    }],
    ['a link to a file', async (at, { box }) => {
      const target = path.join(box.root, 'elsewhere', 'notes.md');
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, 'notes\n');
      await symlink(target, at);
    }],
    ['a link that leads nowhere', (at, { box }) => symlink(path.join(box.root, 'no-such-folder'), at)],
    ['a link to itself', (at) => symlink(at, at)],
  ];
  /**
   * The shape of a refused case: a control session is brought up first and
   * has the pair. Then `change` changes one thing, and `up` of the next
   * session refuses it: it exits 1, its report has `refused    <bot>
   * <session>  not started: <why>` with the why naming the path, and no line
   * is typed for it, so no line without the pair either.
   */
  async function controlThenRefused(t, change) {
    const box = await createSandbox(t);
    const profile = await profileIn(box);
    await fleetIn(box, { sessions: ['control', 'daily'] });
    const bots = box.path('bots');
    const home = botHomeOf(bots, BOT);
    const { line: control } = await upSession(box, 'control');
    await assertCarries(box, control, ownOf(home), 'control');
    await change({ box, profile, home, bots, files: settingsFilesOf(box, home, profile, bots) });

    const result = await box.run(['up', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);

    assert.equal(result.code, 1, `up should exit 1 when it refused a session, got exit ${result.code}:\n${result.stdout}${result.stderr}`);
    const lines = result.stdout.split('\n');
    const at = lines.findIndex((line) => { const words = line.trim().split(/\s+/); return line.startsWith('refused') && words[1] === BOT && words[2] === 'daily'; });
    assert.ok(at >= 0, `the report should have "refused    ${BOT} daily  not started: …", got:\n${result.stdout}`);
    const block = [lines[at]];
    for (const next of lines.slice(at + 1)) {
      if (!/^\s/.test(next) || next.trim() === '') break;
      block.push(next);
    }
    assert.ok(block.join('\n').includes('not started') && block.join('\n').includes(ownOf(home)), `the refused line says "not started" and names ${ownOf(home)}, got:\n${block.join('\n')}`);
    assert.equal((await sessionIn(bots, BOT, 'daily'))?.tab, undefined, 'the book holds no tab for daily');
    for (const terminal of await box.orca.terminals()) {
      for (const text of typedInto(terminal)) assert.ok(!text.includes(`--bot ${BOT} --session daily`), `no line is typed for daily, got in ${terminal.handle}: ${text}`);
    }
  }

  for (const [label, put] of NOT_A_FOLDER) {
    test(`M11 ${label} at <bot folder>/claude-memory: the session is refused, so no line is typed without the pair`, async (t) => {
      await controlThenRefused(t, atTheFolder(put));
    });
  }

  const A_PLAIN_FOLDER = [
    ['an empty folder of the user\'s own', (at) => mkdir(at)],
    ['a folder of the user\'s own with notes and no .gitignore', async (at) => {
      await mkdir(at);
      await writeFile(path.join(at, 'MEMORY.md'), '- [A note](a-note.md)\n');
    }],
  ];
  for (const [label, put] of A_PLAIN_FOLDER) {
    test(`M11 ${label} at <bot folder>/claude-memory: the pair is added`, async (t) => {
      await controlThenStill(t, atTheFolder(put));
    });
  }

  // ------------------------------------------------- M12 Claude Code only

  test('M12 a Codex session\'s line never carries it; a Claude session of the same bot does', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);
    await fleetIn(box, { harness: 'codex', sessions: ['daily', ['lead', '--harness', 'claude']] });
    const bots = box.path('bots');

    const { line } = await upSession(box, 'daily');
    const { line: lead } = await upSession(box, 'lead');

    assert.equal(line, bareLaunch(box, 'codex', BOT, 'daily'), 'the Codex line is exactly today\'s');
    assert.equal(memoryDirIn(await argvOf(box, lead)), ownOf(botHomeOf(bots, BOT)), 'the control: the Claude session of that bot has the pair');
  });

  test('M12 a Codex session of a Claude bot is judged by its own harness: no pair', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);
    await fleetIn(box, { sessions: [['review', '--harness', 'codex']] });

    const { line } = await upSession(box, 'review');

    assert.equal(line, bareLaunch(box, 'codex', BOT, 'review'), 'the Codex line is exactly today\'s');
  });

  test('M12 a Pi session\'s line never carries it; a Claude session of the same bot does', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);
    await fakePi(box);
    await fleetIn(box, { sessions: [['pilot', '--harness', 'pi'], 'lead'] });

    const { line } = await upSession(box, 'pilot');
    const { line: lead } = await upSession(box, 'lead');

    assert.match(line, / pi --no-approve /, `the premise: this is a Pi line, got: ${line}`);
    assert.ok(!line.includes('--settings') && !line.includes(KEY), `a Pi line never carries it, got: ${line}`);
    assert.equal(memoryDirIn(await argvOf(box, lead)), ownOf(botHomeOf(box.path('bots'), BOT)), 'the control: the Claude session of that bot has the pair');
  });

  // ------------------------------------------- M13 each way a session is started

  test('M13 a resume by up: the line has --resume and the pair', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);
    await fleetIn(box);
    const bots = box.path('bots');
    await upSession(box, 'daily');
    const id = await reported(box, bots, 'daily');
    const { tab } = await sessionIn(bots, BOT, 'daily');
    await box.orca.set({ terminals: (await box.orca.terminals()).filter((terminal) => terminal.tabId !== tab) });

    const { line } = await upSession(box, 'daily');

    await assertResumeCarries(box, line, ownOf(botHomeOf(bots, BOT)), id);
  });

  test('M13 obk restart: the new tab\'s line has --resume and the pair', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);
    await fleetIn(box);
    const bots = box.path('bots');
    await upSession(box, 'daily');
    const id = await reported(box, bots, 'daily');

    await ok(box, ['restart', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);

    await assertResumeCarries(box, await lineOf(box, bots, 'daily', BOT, { restarted: true }), ownOf(botHomeOf(bots, BOT)), id);
  });

  test('M13 obk unpause: the new tab\'s line has --resume and the pair', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);
    await fleetIn(box);
    const bots = box.path('bots');
    await upSession(box, 'daily');
    const id = await reported(box, bots, 'daily');
    await ok(box, ['pause', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);

    await ok(box, ['unpause', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);

    await assertResumeCarries(box, await lineOf(box, bots, 'daily', BOT, { unpaused: true }), ownOf(botHomeOf(bots, BOT)), id);
  });

  /** A session of the bot brought up, and the environment of a command run inside its tab. */
  async function makerIn(box, bots, name) {
    await upSession(box, name);
    const { tab } = await sessionIn(bots, BOT, name);
    const terminal = (await box.orca.terminals()).find((one) => one.tabId === tab);
    return { ...box.env, ORCA_TERMINAL_HANDLE: terminal.handle, ORCA_TAB_ID: terminal.tabId, ...kitLaunchMark(box, terminal) };
  }

  test('M13 obk temp make: a Claude temporary session\'s line has its bot\'s value, the maker\'s own; a Codex one made by the same maker has none', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);
    await fleetIn(box, { sessions: ['lead'] });
    const bots = box.path('bots');
    const env = await makerIn(box, bots, 'lead');
    const lead = memoryDirIn(await argvOf(box, await lineOf(box, bots, 'lead')));

    await ok(box, ['temp', 'make', '--bots', 'bots', '--name', 'scout', '--prompt', 'Read the pull request.'], { env });
    await ok(box, ['temp', 'make', '--bots', 'bots', '--name', 'scout-codex', '--harness', 'codex', '--prompt', 'Read the pull request.'], { env });

    const argv = await argvOf(box, await lineOf(box, bots, 'scout'));
    assert.equal(memoryDirIn(argv), ownOf(botHomeOf(bots, BOT)));
    assert.equal(memoryDirIn(argv), lead, 'the temporary session shares its maker\'s folder');
    assert.equal(argv.at(-2), '--', `the task is still last, after --, got: ${JSON.stringify(argv)}`);
    assert.ok(argv.at(-1).startsWith('Read the pull request.'), `the task is still last, got: ${JSON.stringify(argv)}`);
    const codex = await lineOf(box, bots, 'scout-codex');
    assert.ok(!codex.includes('--settings') && !codex.includes(KEY), `a Codex temporary session has none, got: ${codex}`);
  });

  test('M13 each start looks again: a key named by hand after the first start keeps it off the restart\'s line', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);
    await fleetIn(box);
    const bots = box.path('bots');
    const home = botHomeOf(bots, BOT);
    const { line: first } = await upSession(box, 'daily');
    assert.equal(memoryDirIn(await argvOf(box, first)), ownOf(home), 'the first start has the pair');
    await reported(box, bots, 'daily');
    await addTo(path.join(home, '.claude', 'settings.local.json'), { [KEY]: '/somewhere/of/my/own' });

    await ok(box, ['restart', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);

    const line = await lineOf(box, bots, 'daily', BOT, { restarted: true });
    assert.ok(line.includes('--resume'), `the premise: a resume, got: ${line}`);
    assert.ok(!line.includes('--settings') && !line.includes(KEY), `nothing is kept from the first start, got: ${line}`);
  });

  test('M13 each start looks again: a key named by hand and then taken away puts the pair back on the restart\'s line', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);
    await fleetIn(box);
    const bots = box.path('bots');
    const home = botHomeOf(bots, BOT);
    const local = path.join(home, '.claude', 'settings.local.json');
    await addTo(local, { [KEY]: '/somewhere/of/my/own' });
    const first = await upSession(box, 'daily');
    assertTodaysLine(box, first, 'daily');
    const id = await reported(box, bots, 'daily');
    await rm(local);

    await ok(box, ['restart', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);

    await assertResumeCarries(box, await lineOf(box, bots, 'daily', BOT, { restarted: true }), ownOf(home), id);
  });

  // ----------------------------------------- M14 the JSON, and memory off stays off

  const MEMORY_OFF = [
    ['bot', 'autoMemoryEnabled: false', { autoMemoryEnabled: false }],
    ['local', 'autoMemoryEnabled: false', { autoMemoryEnabled: false }],
    ['profile', 'autoMemoryEnabled: false', { autoMemoryEnabled: false }],
    ['profile', 'CLAUDE_CODE_DISABLE_AUTO_MEMORY in env', { env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' } }],
  ];
  for (const [where, label, keys] of MEMORY_OFF) {
    test(`M14 the ${where} settings file says ${label}: the session gets only the pair, and the kit turns nothing on or off`, async (t) => {
      const box = await createSandbox(t);
      const profile = await profileIn(box);
      await fleetIn(box);
      const bots = box.path('bots');
      const home = botHomeOf(bots, BOT);
      const file = settingsFilesOf(box, home, profile, bots)[where];
      await addTo(file, keys);
      const text = await readFile(file, 'utf8');

      const { line } = await upSession(box, 'daily');

      // memoryDirIn holds the JSON to the one key: not autoMemoryEnabled, not env.
      await assertCarries(box, line, ownOf(home), 'daily');
      for (const name of NEVER_ON_THE_LINE) {
        assert.ok(!line.includes(name), `the kit never adds ${name} to the line, got: ${line}`);
      }
      if (where !== 'bot') {
        assert.equal(await readFile(file, 'utf8'), text, 'the file is as it was');
      } else {
        const after = JSON.parse(await readFile(file, 'utf8'));
        for (const [key, value] of Object.entries(keys)) assert.deepEqual(after[key], value, `the session's own ${key} stays`);
      }
    });
  }

  // ------------------------------- M15 no settings file, profile or projects changed

  test('M15 bringing a session up with the pair changes no settings file: the bot\'s .claude folder, the profile folder, selected-host and the real projects folder are as they were', async (t) => {
    const box = await createSandbox(t);
    const profile = await profileIn(box);
    await mkdir(path.join(profile.projects, 'some-project', 'memory'), { recursive: true });
    await writeFile(path.join(profile.projects, 'some-project', 'memory', 'MEMORY.md'), '- a note\n');
    await fleetIn(box, { sessions: ['control', 'daily'] });
    const bots = box.path('bots');
    const home = botHomeOf(bots, BOT);
    await upSession(box, 'control');
    const before = {
      bot: await snapshot(path.join(home, '.claude')),
      profiles: await snapshot(path.join(profile.data, 'claude-profiles')),
      projects: await snapshot(profile.projects),
      selected: await readFile(profile.selected, 'utf8'),
    };

    const { line } = await upSession(box, 'daily');

    assert.equal(memoryDirIn(await argvOf(box, line)), ownOf(home), 'the premise: this start had the pair');
    assert.deepEqual(await snapshot(path.join(home, '.claude')), before.bot, 'the bot\'s .claude folder is as it was');
    assert.ok(!existsSync(path.join(home, '.claude', 'settings.local.json')), 'no settings.local.json in the bot folder');
    assert.ok(!existsSync(path.join(bots, '.claude', 'settings.local.json')), 'no settings.local.json in the bots folder');
    const settings = await readFile(path.join(home, '.claude', 'settings.json'), 'utf8');
    assert.ok(!settings.includes(KEY), `no ${KEY} in the bot's .claude/settings.json, got: ${settings}`);
    assert.deepEqual(await snapshot(path.join(profile.data, 'claude-profiles')), before.profiles, 'the profile folder is as it was');
    assert.equal(await readFile(profile.selected, 'utf8'), before.selected, 'selected-host is as it was');
    assert.deepEqual(await snapshot(profile.projects), before.projects, 'the real projects folder is as it was');
  });

  test('M15 a user\'s own settings files are not changed: local, profile and the user\'s own byte for byte, and the bot\'s keeps its key', async (t) => {
    const box = await createSandbox(t);
    const profile = await profileIn(box);
    await fleetIn(box);
    const bots = box.path('bots');
    const home = botHomeOf(bots, BOT);
    const files = settingsFilesOf(box, home, profile, bots);
    const localText = '{\n    "model": "mine",   "permissions": {}\n}\n';
    const profileText = '{ "theme": "dark" }';
    const userText = '{ "theme": "light" }\n';
    await writeFile(files.local, localText);
    await writeFile(files.profile, profileText);
    await mkdir(path.dirname(files.user), { recursive: true });
    await writeFile(files.user, userText);
    await addTo(files.bot, { model: 'mine' });

    const { line } = await upSession(box, 'daily');

    assert.equal(memoryDirIn(await argvOf(box, line)), ownOf(home), 'the premise: this start had the pair');
    assert.equal(await readFile(files.local, 'utf8'), localText);
    assert.equal(await readFile(files.profile, 'utf8'), profileText);
    assert.equal(await readFile(files.user, 'utf8'), userText);
    const after = JSON.parse(await readFile(files.bot, 'utf8'));
    assert.equal(after.model, 'mine');
    assert.ok(!Object.hasOwn(after, KEY), `no ${KEY} in the bot's .claude/settings.json, got: ${JSON.stringify(after)}`);
  });
});
