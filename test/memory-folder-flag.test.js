// The launch line names the physical memory folder (#722).
//
// A Claude Code session started under an Orca Claude profile has
// `CLAUDE_CONFIG_DIR=<orca data>/claude-profiles/<id>/home`, and in that folder
// `projects` is a symbolic link to `~/.claude/projects`. Claude Code names its
// memory folder through that link, and a write there stops on a permission
// dialog that only a person can answer. Given the physical folder, the dialog
// does not come. It is the same folder, so no memory is lost.
//
// So the kit's launch line for Claude Code carries one more argument pair,
// `--settings <json>`, where the JSON is an object with exactly one key:
//
//   autoMemoryDirectory: <real path of <profile home>/projects>/<slug>/memory
//
// `<slug>` is the project root with every character that is not an ASCII letter
// or digit changed to `-`. The project root is the real path of the top of the
// git repository that holds the bot folder; for a linked git worktree, the main
// repository's top folder; with no repository, the real path of the bot folder.
// A linked worktree of a shared git folder not named `.git`, and a `.git` that is
// a symbolic link, leave the root not sure, and then nothing is added.
//
// What is held here, and the tests that hold each part:
//
//   M1   the pair, its value, and every other word as it is today
//   M2   one shell word, in a path with spaces and shell characters
//   M3   the slug, and the NFC form of a root stored in NFD
//   M4   the real path of `projects`
//   M5   the project root, and git that cannot answer
//   M6   the slug's limit: 200 adds it, 201 does not
//   M7   condition 1: `selected-host` holds a profile home
//   M8   condition 2: `<profile home>/projects` is a symbolic link
//   M9   condition 3: no `autoMemoryDirectory` key in the four settings files,
//        the project root's `.claude/settings.local.json` among them
//   M10  condition 3: what does not count as having the key
//   M11  condition 5: the session's own `extra_args`
//   M12  Orca's data folder, and that the kit's own environment names no profile
//   M13  Claude Code only: never on a Codex or a Pi line
//   M14  each way the kit starts a session: resume, restart, unpause, temp make
//   M15  the kit writes no file for this
//   M16  a session with memory off stays off, and the JSON holds no other key
//
// Condition 4 is M6. `--settings` stays refused as a user's extra argument:
// test/extra-arg-scope.test.js holds that for `session add` (XS11),
// `session change` (XS14) and `temp make` (XS18), so it is not repeated here.
// test/core-is-core.test.js holds that no new command or setting came in.
//
// A negative case here has its positive beside it: the same sandbox brings up a
// control session first, which has the pair, then one thing is changed, and the
// next session is brought up (`controlThenCase`). So an empty result cannot be a
// kit that never adds the pair, or a fixture that never had one to add.
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
  sessionIn,
  sh,
  snapshot,
  tokenless,
  tokenlessWord,
  typedInto,
} from './helpers/cli.js';
import { fakePi } from './helpers/pi.js';

const BOT = 'api-bot';
const KEY = 'autoMemoryDirectory';
const AS_ROOT = process.getuid?.() === 0 ? 'root reads a file of mode 000, so it cannot be made unreadable here' : undefined;

/** The names no line of the kit's may carry for this, in any case (the kit refuses `--settings` from a user for what else it can carry). */
const NEVER_ON_THE_LINE = ['autoMemoryEnabled', 'CLAUDE_CODE_DISABLE_AUTO_MEMORY'];

/** Orca's data folder in a sandbox: where Orca keeps it, under the sandbox's home. */
const orcaDataOf = (box) => path.join(box.home, 'Library', 'Application Support', 'orca');

/** The real folder a profile's `projects` link leads to, unless a test says another. */
const defaultProjectsOf = (box) => path.join(box.home, '.claude', 'projects');

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

/** The slug as the requirement says: every character that is not an ASCII letter or digit changed to `-`. */
const slugOf = (root) => root.replaceAll(/[^A-Za-z0-9]/g, '-');

/** Where the value must lead: the real `projects` folder, the slug of the project root, and `memory`. */
const memoryDirOf = (projects, root) => path.join(projects, slugOf(root), 'memory');

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
async function fleetIn(box, { bots = 'bots', harness = 'claude', sessions = ['daily'] } = {}) {
  await ok(box, ['init', '--bots', bots, '--harness', 'claude']);
  await ok(box, ['bot', 'create', '--bots', bots, '--name', BOT, '--harness', harness]);
  for (const session of sessions) {
    const [name, ...flags] = [session].flat();
    await ok(box, ['session', 'add', '--bots', bots, '--bot', BOT, '--name', name, ...flags]);
  }
}

/** The one line the kit typed into a session's tab, as the fake Orca received it. */
async function lineOf(box, bots, name, bot = BOT) {
  const entry = await sessionIn(bots, bot, name);
  assert.equal(typeof entry?.tab, 'string', `the book should hold a tab for ${bot}/${name}, got: ${JSON.stringify(entry)}`);
  const terminal = (await box.orca.terminals()).find((one) => one.tabId === entry.tab);
  assert.ok(terminal, `Orca should have ${bot}/${name}'s tab ${entry.tab}`);
  const typed = typedInto(terminal);
  assert.equal(typed.length, 1, `one line per new session tab, got: ${JSON.stringify(typed)}`);
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

/** The argv with the pair taken out, and the token of the name written the way `bareLaunch` writes it. */
function withoutPair(argv) {
  const at = argv.indexOf('--settings');
  const left = at < 0 ? [...argv] : [...argv.slice(0, at), ...argv.slice(at + 2)];
  return left.map((word, index) => (left[index - 1] === '-n' ? tokenlessWord(word) : word));
}

/** The arguments of today's line for a session with nothing set: after the pid, the CLI and the harness word. */
const todaysArgv = (box, name, { bots, bot = BOT } = {}) =>
  harnessPartOf(bareLaunch(box, 'claude', bot, name, { bots })).split(' ').slice(3);

/**
 * The line carries the pair with this value, and nothing else has moved: with
 * the pair taken out, the argv is today's for a session with nothing set.
 */
async function assertCarries(box, line, expected, name, { bots, bot } = {}) {
  const argv = await argvOf(box, line);
  assert.equal(memoryDirIn(argv), expected, `the value of ${KEY} on: ${line}`);
  assert.deepEqual(withoutPair(argv), todaysArgv(box, name, { bots, bot }), 'with the pair taken out, every word is as it is today');
}

/** The line is exactly today's, and the run said nothing about any of this. */
function assertTodaysLine(box, { result, line }, name, { bots } = {}) {
  assert.equal(tokenless(line), bareLaunch(box, 'claude', BOT, name, { bots }), 'the launch line is exactly what it is today');
  const said = `${result.stdout}${result.stderr}`;
  assert.doesNotMatch(said, /autoMemory|selected-host|claude-profiles|memory folder/i, `no message about this, got:\n${said}`);
}

/**
 * The shape of every negative case. A control session is brought up first and
 * has the pair. Then `change` changes one thing, and the next session is
 * brought up in the same sandbox, in the same folder: its line is today's, with
 * no error and no message. `change` is given the profile and the bot's home.
 */
async function controlThenCase(t, change) {
  const box = await createSandbox(t);
  const profile = await profileIn(box);
  await fleetIn(box, { sessions: ['control', 'daily'] });
  const bots = box.path('bots');
  const { line: control } = await upSession(box, 'control');
  await assertCarries(box, control, memoryDirOf(profile.projects, bots), 'control');

  const home = botHomeOf(bots, BOT);
  await change({ box, profile, home, files: settingsFilesOf(home, profile, bots) });

  const brought = await upSession(box, 'daily');
  assertTodaysLine(box, brought, 'daily');
  return { box, profile, home, bots };
}

/** The positive of `controlThenCase`: the change does not stop the pair. */
async function caseStillCarries(t, change) {
  const box = await createSandbox(t);
  const profile = await profileIn(box);
  await fleetIn(box);
  const bots = box.path('bots');
  const home = botHomeOf(bots, BOT);
  await change({ box, profile, home, files: settingsFilesOf(home, profile, bots) });
  const { line } = await upSession(box, 'daily');
  await assertCarries(box, line, memoryDirOf(profile.projects, bots), 'daily');
}

/**
 * The four settings files condition 3 names. `root` is the project root, which
 * in the usual sandbox is the bots folder: `init` makes it a repository. Claude
 * Code 2.1.317 reads local settings from the top of the git repository, and
 * merges the bot folder's own under that (its docs, "where Claude Code keeps the
 * local file in a git repository"), so a key there is the user's own folder.
 */
const settingsFilesOf = (home, profile, root) => ({
  bot: path.join(home, '.claude', 'settings.json'),
  local: path.join(home, '.claude', 'settings.local.json'),
  profile: path.join(profile.home, 'settings.json'),
  root: path.join(root, '.claude', 'settings.local.json'),
});

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

describe('the launch line names the physical memory folder (#722)', { concurrency: 8 }, () => {
  // ---------------------------------------------------------------- M1 the pair

  test('M1 a new Claude session under a linked profile gets the pair: the real projects folder, the slug of the repository top, memory; every other word is today\'s', async (t) => {
    const box = await createSandbox(t);
    const profile = await profileIn(box);
    await fleetIn(box);
    const bots = box.path('bots');

    const { line } = await upSession(box, 'daily');

    // Written out from the requirement, not through the test's own helper.
    const expected = `${defaultProjectsOf(box)}/${bots.replaceAll(/[^A-Za-z0-9]/g, '-')}/memory`;
    assert.equal(memoryDirOf(profile.projects, bots), expected, 'the premise: the helper says what the requirement says');
    await assertCarries(box, line, expected, 'daily');
    assert.ok(!expected.includes(profile.home), `the value goes around the link, not through the profile: ${expected}`);
  });

  test('M1 the pair goes before the prompt separator, so a session with settings and a prompt still has its prompt as the last word', async (t) => {
    const box = await createSandbox(t);
    const profile = await profileIn(box);
    const prompt = 'Read your AGENTS.md.';
    await fleetIn(box, { sessions: [['daily', '--model', 'opus', '--effort', 'high', '--extra-arg=--verbose', '--prompt', prompt]] });

    const { line } = await upSession(box, 'daily');

    const argv = await argvOf(box, line);
    assert.equal(memoryDirIn(argv), memoryDirOf(profile.projects, box.path('bots')));
    assert.deepEqual(argv.slice(-2), ['--', prompt], `the prompt is last, after --, got: ${JSON.stringify(argv)}`);
    assert.deepEqual(
      withoutPair(argv),
      [...todaysArgv(box, 'daily'), '--model', 'opus', '--effort', 'high', '--verbose', '--', prompt],
      'the session\'s own settings are as they are today',
    );
  });

  test('M1 a long prompt that goes through a file keeps the pair before the separator', async (t) => {
    const box = await createSandbox(t);
    const profile = await profileIn(box);
    const prompt = `First line of a long prompt.\n${'And so on. '.repeat(30)}`;
    await fleetIn(box, { sessions: [['daily', `--prompt=${prompt}`]] });

    const { line } = await upSession(box, 'daily');

    const argv = await argvOf(box, line);
    assert.equal(memoryDirIn(argv), memoryDirOf(profile.projects, box.path('bots')));
    assert.equal(argv.at(-1).trim(), prompt.trim(), 'the prompt arrives whole');
  });

  // ------------------------------------------------------------- M2 one word

  const SHELLS = [['sh', '/bin/sh', ['-c']], ['zsh', '/bin/zsh', ['-f', '-c']]];
  for (const [name, shell, flags] of SHELLS) {
    test(`M2 in ${name}, the JSON is one shell word in a path with spaces, quotes, a dollar and a backquote, and reaches the harness as written`, { skip: existsSync(shell) ? undefined : `no ${shell} here` }, async (t) => {
      const box = await createSandbox(t);
      const projects = path.join(box.home, 'it\'s "my" $HOME `date` folder', 'projects');
      const profile = await profileIn(box, { projects });
      await fleetIn(box);

      const { line } = await upSession(box, 'daily');

      const fake = await fakeProgram(box, 'claude', {});
      const ran = spawnSync(shell, [...flags, line], { cwd: box.cwd, env: box.env, encoding: 'utf8' });
      assert.equal(ran.status, 0, `the line should run in ${name}: ${line}\n${ran.stderr}`);
      const calls = await fake.calls();
      assert.equal(calls.length, 1, `the line should start the harness once in ${name}: ${line}`);
      assert.equal(memoryDirIn(calls[0].args), memoryDirOf(profile.projects, box.path('bots')));
    });
  }

  // --------------------------------------------------------------- M3 the slug

  test('M3 the slug: each character that is not an ASCII letter or digit is one -, and letters keep their case', async (t) => {
    const box = await createSandbox(t);
    const profile = await profileIn(box);
    const name = 'My Bots_文.Z1';
    await fleetIn(box, { bots: name });
    const bots = box.path(name);

    const { line } = await upSession(box, 'daily', { bots: name, realBots: bots });

    const argv = await argvOf(box, line);
    // By hand: `/` `-`, `My`, space `-`, `Bots`, `_` `-`, `文` `-`, `.` `-`, `Z1`.
    const tail = '-My-Bots---Z1';
    assert.equal(memoryDirIn(argv), path.join(profile.projects, `${slugOf(box.cwd)}${tail}`, 'memory'));
  });

  // Claude Code holds its project root in NFC, so the slug is that of the NFC
  // form: `e` + U+0301 is one character there, and gives one `-`, not two.
  const NFD_NAME = 'cafe\u0301';
  for (const [label, withRepo] of [['in a repository', true], ['with no repository', false]]) {
    test(`M3 a project root stored in NFD form, ${label}: the slug is that of the NFC form`, async (t) => {
      const box = await createSandbox(t);
      const profile = await profileIn(box);
      await fleetIn(box, { bots: NFD_NAME });
      const stored = await readdir(box.cwd);
      if (!stored.includes(NFD_NAME)) {
        t.skip(`this filesystem does not keep the NFD form of a name: it holds ${JSON.stringify(stored)}`);
        return;
      }
      const bots = box.path(NFD_NAME);
      if (!withRepo) await rm(path.join(bots, '.git'), { recursive: true });

      const { line } = await upSession(box, 'daily', { bots: NFD_NAME, realBots: bots });

      // By hand: `/` `-`, `caf`, `é` `-`, and with no repository the bot folder's own `/bots/api-bot`.
      const tail = withRepo ? '-caf-' : '-caf--bots-api-bot';
      assert.equal(memoryDirIn(await argvOf(box, line)), path.join(profile.projects, `${slugOf(box.cwd)}${tail}`, 'memory'));
    });
  }

  // -------------------------------------------------- M4 the real path of projects

  const LINKS = [
    ['a link to a link gives the final real path', async (box, real, link) => {
      const middle = path.join(box.root, 'middle-link');
      await symlink(real, middle);
      await symlink(middle, link);
    }],
    ['a relative link gives the real path', async (box, real, link) => {
      await symlink(path.relative(path.dirname(link), real), link);
    }],
    ['a link through a linked folder gives the real path', async (box, real, link) => {
      const linkedParent = path.join(box.root, 'linked-parent');
      await symlink(path.dirname(real), linkedParent);
      await symlink(path.join(linkedParent, path.basename(real)), link);
    }],
  ];
  for (const [label, makeLink] of LINKS) {
    test(`M4 ${label}`, async (t) => {
      const box = await createSandbox(t);
      const real = path.join(box.root, 'somewhere', 'real-projects');
      await mkdir(real, { recursive: true });
      const profile = await profileIn(box);
      await rm(profile.link);
      await makeLink(box, real, profile.link);
      await fleetIn(box);

      const { line } = await upSession(box, 'daily');

      await assertCarries(box, line, path.join(real, slugOf(box.path('bots')), 'memory'), 'daily');
    });
  }

  // -------------------------------------------------------- M5 the project root

  test('M5 a bots folder given through a link: the project root is its real path', async (t) => {
    const box = await createSandbox(t);
    const profile = await profileIn(box);
    const real = path.join(box.root, 'elsewhere', 'real-bots');
    await mkdir(real, { recursive: true });
    await symlink(real, box.path('linked-bots'));
    await fleetIn(box, { bots: 'linked-bots' });

    const { line } = await upSession(box, 'daily', { bots: 'linked-bots', realBots: real });

    assert.equal(memoryDirIn(await argvOf(box, line)), memoryDirOf(profile.projects, real));
  });

  test('M5 a linked git worktree: the project root is the main repository\'s top folder, not the worktree', async (t) => {
    const box = await createSandbox(t);
    const profile = await profileIn(box);
    const main = path.join(box.root, 'main repo');
    await repoWithCommit(main);
    const worktree = path.join(box.root, 'a-worktree');
    const added = await git(['worktree', 'add', '--quiet', worktree], main);
    assert.equal(added.code, 0, added.stderr);
    await fleetIn(box, { bots: worktree });

    const { line } = await upSession(box, 'daily', { bots: worktree, realBots: worktree });

    assert.equal(memoryDirIn(await argvOf(box, line)), memoryDirOf(profile.projects, main));
  });

  test('M5 a repository around the bots folder: the project root is that repository\'s top, and not the bots folder', async (t) => {
    const box = await createSandbox(t);
    const profile = await profileIn(box);
    const outer = path.join(box.root, 'outer');
    const bots = path.join(outer, 'fleet', 'bots');
    await mkdir(path.dirname(bots), { recursive: true });
    await fleetIn(box, { bots });
    await rm(path.join(bots, '.git'), { recursive: true });
    await repoWithCommit(outer);

    const { line } = await upSession(box, 'daily', { bots, realBots: bots });

    assert.equal(memoryDirIn(await argvOf(box, line)), memoryDirOf(profile.projects, outer));
  });

  test('M5 a bot folder that is a repository of its own: the project root is the bot folder', async (t) => {
    const box = await createSandbox(t);
    const profile = await profileIn(box);
    await fleetIn(box);
    const bots = box.path('bots');
    const home = botHomeOf(bots, BOT);
    assert.equal((await git(['init', '--quiet'], home)).code, 0);

    const { line } = await upSession(box, 'daily');

    assert.equal(memoryDirIn(await argvOf(box, line)), memoryDirOf(profile.projects, home));
  });

  test('M5 no repository: the project root is the real path of the bot folder', async (t) => {
    const box = await createSandbox(t);
    const profile = await profileIn(box);
    await fleetIn(box);
    const bots = box.path('bots');
    await rm(path.join(bots, '.git'), { recursive: true });
    assert.notEqual((await git(['rev-parse', '--show-toplevel'], bots)).code, 0, 'the premise: no repository holds the bots folder');

    const { line } = await upSession(box, 'daily');

    assert.equal(memoryDirIn(await argvOf(box, line)), memoryDirOf(profile.projects, botHomeOf(bots, BOT)));
  });

  test('M5 no repository and a bots folder given through a link: the real path of the bot folder', async (t) => {
    const box = await createSandbox(t);
    const profile = await profileIn(box);
    const real = path.join(box.root, 'elsewhere', 'real-bots');
    await mkdir(real, { recursive: true });
    await symlink(real, box.path('linked-bots'));
    await fleetIn(box, { bots: 'linked-bots' });
    await rm(path.join(real, '.git'), { recursive: true });

    const { line } = await upSession(box, 'daily', { bots: 'linked-bots', realBots: real });

    assert.equal(memoryDirIn(await argvOf(box, line)), memoryDirOf(profile.projects, botHomeOf(real, BOT)));
  });

  test('M5 no repository and a bot folder that is itself a link: the real path of the bot folder', async (t) => {
    const box = await createSandbox(t);
    const profile = await profileIn(box);
    await fleetIn(box);
    const bots = box.path('bots');
    await rm(path.join(bots, '.git'), { recursive: true });
    const home = botHomeOf(bots, BOT);
    const real = path.join(box.root, 'elsewhere', BOT);
    await mkdir(path.dirname(real), { recursive: true });
    await rename(home, real);
    await symlink(real, home);

    const { line } = await upSession(box, 'daily');

    assert.equal(memoryDirIn(await argvOf(box, line)), memoryDirOf(profile.projects, real));
  });

  // A repository whose git folder is kept elsewhere: the working folder is the
  // project root, though that git folder is named `.git` and has a parent.
  for (const [where, inner] of [['at', []], ['inside', ['fleet-bots']]]) {
    test(`M5 a repository made with --separate-git-dir, the bots folder ${where} its top: the project root is its top, not the folder that holds the git folder`, async (t) => {
      const box = await createSandbox(t);
      const profile = await profileIn(box);
      const fleet = path.join(box.root, 'fleet');
      await mkdir(path.join(box.root, 'metadata'));
      const made = await git(['init', '--quiet', '--separate-git-dir', path.join(box.root, 'metadata', '.git'), fleet], box.root);
      assert.equal(made.code, 0, made.stderr);
      const bots = path.join(fleet, ...inner);
      await mkdir(bots, { recursive: true });
      await fleetIn(box, { bots });
      if (inner.length > 0) await rm(path.join(bots, '.git'), { recursive: true });

      const { line } = await upSession(box, 'daily', { bots, realBots: bots });

      await assertCarries(box, line, memoryDirOf(profile.projects, fleet), 'daily', { bots });
    });
  }

  // A linked worktree whose shared git folder is not named `.git` has no main
  // working folder to name, so the kit is not sure of the root. The control is
  // a fleet in an ordinary repository, under the same profile.
  test('M5 a linked worktree of a bare repository: the kit is not sure of the root, and nothing is added', async (t) => {
    const box = await createSandbox(t);
    const profile = await profileIn(box);
    await fleetIn(box, { bots: 'plain-bots', sessions: ['control'] });
    const { line: control } = await upSession(box, 'control', { bots: 'plain-bots', realBots: box.path('plain-bots') });
    assert.equal(memoryDirIn(await argvOf(box, control)), memoryDirOf(profile.projects, box.path('plain-bots')), 'the control has the pair');

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

    const brought = await upSession(box, 'daily', { bots, realBots: bots });

    assertTodaysLine(box, brought, 'daily', { bots });
  });

  // Git follows a `.git` that is a symbolic link, but what Claude Code makes of
  // such a root is not known, so the kit is not sure of it.
  for (const [named, parts] of [['another name', ['elsewhere', 'real.git']], ['the name .git', ['elsewhere', '.git']]]) {
    test(`M5 a .git at the project root that is a symbolic link to a git folder of ${named}: the kit is not sure of the root, and nothing is added`, async (t) => {
      await controlThenCase(t, async ({ box }) => {
        const entry = box.path('bots', '.git');
        const real = path.join(box.root, ...parts);
        await mkdir(path.dirname(real), { recursive: true });
        await rename(entry, real);
        await symlink(real, entry);
        assert.equal((await git(['rev-parse', '--git-common-dir'], box.path('bots'))).code, 0, 'the premise: git follows the link');
      });
    });
  }

  // A `.git` entry at the bot folder or above it, and git cannot answer there:
  // the kit cannot be sure of the project root, so it adds nothing. No `.git`
  // entry at all is the no-repository case above, which gets the pair.
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
    test(`M5 ${label}: git cannot answer, and nothing is added`, async (t) => {
      await controlThenCase(t, async (world) => {
        await change(world);
        assert.notEqual((await git(['rev-parse', '--show-toplevel'], world.home)).code, 0, 'the premise: git cannot answer at the bot folder');
      });
    });
  }

  test('M5 a session\'s work dir that is a repository of its own changes nothing: the project root is what holds the bot folder', async (t) => {
    const box = await createSandbox(t);
    const profile = await profileIn(box);
    await fleetIn(box, { sessions: [['daily', '--work-dir', 'work/api']] });
    const bots = box.path('bots');
    const workDir = path.join(botHomeOf(bots, BOT), 'work', 'api');
    await mkdir(workDir, { recursive: true });
    assert.equal((await git(['init', '--quiet'], workDir)).code, 0);

    const { line } = await upSession(box, 'daily');

    assert.equal(memoryDirIn(await argvOf(box, line)), memoryDirOf(profile.projects, bots));
  });

  // ------------------------------------------------------- M6 the slug's limit

  /**
   * A bots folder whose real path, and so its slug, has `length` characters.
   * The bot folder's own path is longer, so a kit that measures that fails at
   * 200 as well.
   */
  async function botsOfLength(t, length) {
    const box = await createSandbox(t);
    const filler = length - box.cwd.length - 1;
    assert.ok(filler > 0 && filler <= 255, `the premise: a folder name of ${filler} characters can be made`);
    const name = 'x'.repeat(filler);
    const bots = box.path(name);
    assert.equal(slugOf(bots).length, length, 'the premise: the slug has the length the test says');
    const profile = await profileIn(box);
    await fleetIn(box, { bots: name });
    return { box, profile, name, bots };
  }

  test('M6 a slug of exactly 200 characters adds the pair', async (t) => {
    const { box, profile, name, bots } = await botsOfLength(t, 200);

    const { line } = await upSession(box, 'daily', { bots: name, realBots: bots });

    assert.equal(memoryDirIn(await argvOf(box, line)), memoryDirOf(profile.projects, bots));
  });

  test('M6 a slug of 201 characters adds nothing, and the line is today\'s', async (t) => {
    const { box, name, bots } = await botsOfLength(t, 201);

    const brought = await upSession(box, 'daily', { bots: name, realBots: bots });

    assertTodaysLine(box, brought, 'daily', { bots });
  });

  // ---------------------------------------------------- M7 selected-host

  const NO_PROFILE = [
    ['is not there (Orca has no accounts)', ({ profile }) => rm(profile.selected)],
    ['is empty (Orca routes no profile)', ({ profile }) => writeFile(profile.selected, '')],
    ['holds only a line end', ({ profile }) => writeFile(profile.selected, '\n')],
    ['cannot be read: it is a folder', async ({ profile }) => {
      await rm(profile.selected);
      await mkdir(profile.selected);
    }],
    ['names a home that is not there', ({ box, profile }) => writeFile(profile.selected, path.join(box.root, 'no-such-profile', 'home'))],
  ];
  for (const [label, change] of NO_PROFILE) {
    test(`M7 selected-host ${label}: nothing is added`, async (t) => {
      await controlThenCase(t, change);
    });
  }

  test('M7 selected-host cannot be read: mode 000, nothing is added', { skip: AS_ROOT }, async (t) => {
    await controlThenCase(t, ({ profile }) => chmod(profile.selected, 0o000));
  });

  test('M7 selected-host ends in a line end: the path is still the profile home', async (t) => {
    await caseStillCarries(t, ({ profile }) => writeFile(profile.selected, `${profile.home}\n`));
  });

  // ---------------------------------------------------- M8 projects is a link

  const NOT_A_LINK = [
    ['is a real folder', async ({ profile }) => {
      await rm(profile.link);
      await mkdir(profile.link);
    }],
    ['is not there', ({ profile }) => rm(profile.link)],
    ['is a link that leads nowhere', async ({ box, profile }) => {
      await rm(profile.link);
      await symlink(path.join(box.root, 'no-such-folder'), profile.link);
    }],
    ['is a link to a link that leads nowhere', async ({ box, profile }) => {
      const middle = path.join(box.root, 'middle-link');
      await symlink(path.join(box.root, 'no-such-folder'), middle);
      await rm(profile.link);
      await symlink(middle, profile.link);
    }],
    ['is a link to itself', async ({ profile }) => {
      await rm(profile.link);
      await symlink(profile.link, profile.link);
    }],
  ];
  for (const [label, change] of NOT_A_LINK) {
    test(`M8 <profile home>/projects ${label}: nothing is added`, async (t) => {
      await controlThenCase(t, change);
    });
  }

  // ---------------------------------------------------- M9 the settings files

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
  // today `up` stops with an error when it cannot read or parse that file, and
  // no line is typed (seen on this branch before the flag: "is not readable as
  // JSON", EISDIR, EACCES). That is today's behaviour and stays. So those cases
  // of the bot's own file cannot reach a launch line, and are not cases here.
  const STOPS_THE_BRING_UP_TODAY = new Set(['cannot be parsed', 'is empty, and so cannot be parsed', 'cannot be read: it is a folder', 'cannot be read: mode 000']);
  for (const where of ['bot', 'local', 'profile', 'root']) {
    for (const [label, change, options] of HAVING_THE_KEY) {
      if (where === 'bot' && STOPS_THE_BRING_UP_TODAY.has(label)) continue;
      test(`M9 the ${where} settings file ${label}: nothing is added`, options ?? {}, async (t) => {
        const { home } = await controlThenCase(t, ({ files }) => change(files[where]));
        // A hand-written key is still there after the bring-up.
        if (where === 'bot' && label.startsWith('holds the key')) {
          const after = JSON.parse(await readFile(path.join(home, '.claude', 'settings.json'), 'utf8'));
          assert.ok(Object.hasOwn(after, KEY), `the user's ${KEY} stays in .claude/settings.json, got: ${JSON.stringify(after)}`);
        }
      });
    }
  }

  // ---------------------------------------------- M10 what does not count

  const NOT_HAVING_THE_KEY = [
    ['holds other keys', (file) => addTo(file, { model: 'opus', theme: 'dark' })],
    ['holds the key\'s name only deeper down', (file) => addTo(file, { nested: { [KEY]: '/somewhere' } })],
    ['holds the key\'s name only as a value', (file) => addTo(file, { note: KEY })],
  ];
  for (const where of ['bot', 'local', 'profile', 'root']) {
    for (const [label, change] of NOT_HAVING_THE_KEY) {
      test(`M10 the ${where} settings file ${label}: the pair is added`, async (t) => {
        await caseStillCarries(t, ({ files }) => change(files[where]));
      });
    }
  }

  test('M10 the key in a settings file that is none of the four does not count: the sandbox\'s own ~/.claude/settings.json', async (t) => {
    await caseStillCarries(t, ({ box }) => addTo(path.join(box.home, '.claude', 'settings.json'), { [KEY]: '/somewhere' }));
  });

  // Valid JSON that is not an object has no key, so it does not count (the
  // architect's ruling on #722). In the bot's own .claude/settings.json it stops
  // the bring-up with "is not readable as JSON", as an unparsable file does, so
  // that file is not a case here (STOPS_THE_BRING_UP_TODAY above).
  const NOT_AN_OBJECT = [['null', 'null'], ['an array', '[]'], ['a number', '42'], ['a string', '"text"']];
  for (const where of ['local', 'profile', 'root']) {
    for (const [label, text] of NOT_AN_OBJECT) {
      test(`M10 the ${where} settings file holds ${label}: it has no key, and the pair is added`, async (t) => {
        await caseStillCarries(t, async ({ files }) => {
          await mkdir(path.dirname(files[where]), { recursive: true });
          await writeFile(files[where], text);
        });
      });
    }
  }

  // ------------------------- M9, M10 the project root's file, by where the root is

  // In each of these, the control proves the project root: its pair names it. The
  // project root's settings.json is not on the list: Claude Code reads project
  // settings from the bot folder alone. Nor is a local file that is neither the
  // project root's nor the bot folder's.
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

  /** A sandbox laid out by `lay`, its control brought up, with the pair that names the project root. */
  async function controlAt(t, lay) {
    const box = await createSandbox(t);
    const profile = await profileIn(box);
    const { bots, root, notListed } = await lay(box);
    const { line } = await upSession(box, 'control', { bots, realBots: bots });
    const expected = memoryDirOf(profile.projects, root);
    assert.equal(memoryDirIn(await argvOf(box, line)), expected, 'the control has the pair, and it names the project root');
    return { box, bots, root, notListed, expected, local: path.join(root, '.claude', 'settings.local.json') };
  }

  /** The next session of that sandbox: the pair is there, or nothing of it. */
  async function nextOf(box, bots, expected) {
    const brought = await upSession(box, 'daily', { bots, realBots: bots });
    if (expected === undefined) assertTodaysLine(box, brought, 'daily', { bots });
    else await assertCarries(box, brought.line, expected, 'daily', { bots });
  }

  for (const [where, lay] of ROOTS) {
    test(`M9 ${where}: the key in the project root's settings.local.json: nothing is added`, async (t) => {
      const { box, bots, local } = await controlAt(t, lay);
      await addTo(local, { [KEY]: '/somewhere/of/my/own' });
      await nextOf(box, bots);
    });

    test(`M9 ${where}: the project root's settings.local.json cannot be parsed: nothing is added`, async (t) => {
      const { box, bots, local } = await controlAt(t, lay);
      await mkdir(path.dirname(local), { recursive: true });
      await writeFile(local, '{ not json');
      await nextOf(box, bots);
    });

    test(`M9 ${where}: the project root's settings.local.json cannot be read: nothing is added`, { skip: AS_ROOT }, async (t) => {
      const { box, bots, local } = await controlAt(t, lay);
      await mkdir(path.dirname(local), { recursive: true });
      await writeFile(local, '{}\n');
      await chmod(local, 0o000);
      await nextOf(box, bots);
    });

    test(`M10 ${where}: the project root's settings.local.json holds other keys: the pair is added`, async (t) => {
      const { box, bots, expected, local } = await controlAt(t, lay);
      await addTo(local, { model: 'opus' });
      await nextOf(box, bots, expected);
    });

    test(`M10 ${where}: the project root's settings.local.json holds valid JSON that is not an object: the pair is added`, async (t) => {
      const { box, bots, expected, local } = await controlAt(t, lay);
      await mkdir(path.dirname(local), { recursive: true });
      await writeFile(local, '[]');
      await nextOf(box, bots, expected);
    });

    test(`M10 ${where}: the key in a local file that is not the project root's: the pair is added`, async (t) => {
      const { box, bots, expected, notListed } = await controlAt(t, lay);
      for (const file of notListed) await addTo(file, { [KEY]: '/somewhere/of/my/own' });
      await nextOf(box, bots, expected);
    });
  }

  // Where the bot folder is itself the project root, this settings.json is the
  // bot's own, which is on the list, so those two layouts are not cases here.
  for (const [where, lay] of [...ROOTS.slice(0, 2), ['a bots folder that is the repository', async (box) => {
    const bots = box.path('bots');
    await fleetIn(box, { sessions: ['control', 'daily'] });
    return { bots, root: bots, notListed: [] };
  }]]) {
    test(`M10 ${where}: the key in the project root's settings.json does not count: the pair is added`, async (t) => {
      const { box, bots, root, expected } = await controlAt(t, lay);
      await addTo(path.join(root, '.claude', 'settings.json'), { [KEY]: '/somewhere/of/my/own' });
      await nextOf(box, bots, expected);
    });
  }

  // ---------------------------------------------- M11 the session's extra_args

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
    test(`M11 extra_args holds the user's own --settings, as ${label}: nothing is added, and theirs goes as written`, async (t) => {
      const box = await createSandbox(t);
      const profile = await profileIn(box);
      await fleetIn(box, { sessions: ['control', 'daily'] });
      const bots = box.path('bots');
      const { line: control } = await upSession(box, 'control');
      await assertCarries(box, control, memoryDirOf(profile.projects, bots), 'control');
      await handEdit(botHomeOf(bots, BOT), 'daily', extra);

      const { line } = await upSession(box, 'daily');

      assert.ok(!line.includes(KEY), `the user's hand edit wins, got: ${line}`);
      const argv = await argvOf(box, line);
      assert.deepEqual(
        argv.map((word, index) => (argv[index - 1] === '-n' ? tokenlessWord(word) : word)),
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
    test(`M11 extra_args holds ${label}: the pair is added`, async (t) => {
      const box = await createSandbox(t);
      const profile = await profileIn(box);
      await fleetIn(box);
      const bots = box.path('bots');
      await handEdit(botHomeOf(bots, BOT), 'daily', extra);

      const { line } = await upSession(box, 'daily');

      assert.equal(memoryDirIn(await argvOf(box, line)), memoryDirOf(profile.projects, bots));
    });
  }

  // ------------------------------------------------- M12 Orca's data folder

  test('M12 OBK_ORCA_DATA set: the selected-host there is read, not the one in the default folder', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box, { projects: path.join(box.root, 'default-projects') });
    const lean = await profileIn(box, {
      data: path.join(box.home, 'Library', 'Application Support', 'orca-lean'),
      projects: path.join(box.root, 'lean-projects'),
    });
    box.env.OBK_ORCA_DATA = lean.data;
    await fleetIn(box);

    const { line } = await upSession(box, 'daily');

    assert.equal(memoryDirIn(await argvOf(box, line)), memoryDirOf(lean.projects, box.path('bots')));
  });

  test('M12 OBK_ORCA_DATA set to a folder with no selected-host: nothing is added, whatever the default folder holds', async (t) => {
    const box = await createSandbox(t);
    const profile = await profileIn(box);
    await fleetIn(box, { sessions: ['control', 'daily'] });
    const { line: control } = await upSession(box, 'control');
    assert.equal(memoryDirIn(await argvOf(box, control)), memoryDirOf(profile.projects, box.path('bots')), 'the control, with OBK_ORCA_DATA unset');

    const lean = path.join(box.home, 'Library', 'Application Support', 'orca-lean');
    await mkdir(lean, { recursive: true });
    box.env.OBK_ORCA_DATA = lean;
    const brought = await upSession(box, 'daily');

    assertTodaysLine(box, brought, 'daily');
  });

  test('M12 OBK_ORCA_DATA empty: the default folder is read', async (t) => {
    const box = await createSandbox(t);
    const profile = await profileIn(box);
    box.env.OBK_ORCA_DATA = '';
    await fleetIn(box);

    const { line } = await upSession(box, 'daily');

    assert.equal(memoryDirIn(await argvOf(box, line)), memoryDirOf(profile.projects, box.path('bots')));
  });

  test('M12 the kit\'s own CLAUDE_CONFIG_DIR names no profile for this: the value follows selected-host', async (t) => {
    const box = await createSandbox(t);
    const selected = await profileIn(box, { projects: path.join(box.root, 'selected-projects') });
    const other = await profileIn(box, { name: 'profile-two', projects: path.join(box.root, 'other-projects'), select: false });
    box.env.CLAUDE_CONFIG_DIR = other.home;
    await fleetIn(box);

    const { line } = await upSession(box, 'daily');

    assert.equal(memoryDirIn(await argvOf(box, line)), memoryDirOf(selected.projects, box.path('bots')));
  });

  test('M12 with no selected-host, the kit\'s own CLAUDE_CONFIG_DIR does not stand in for it: nothing is added', async (t) => {
    await controlThenCase(t, async ({ box, profile }) => {
      box.env.CLAUDE_CONFIG_DIR = profile.home;
      await rm(profile.selected);
    });
  });

  // ------------------------------------------------- M13 Claude Code only

  test('M13 a Codex session\'s line never carries it; a Claude session of the same bot does', async (t) => {
    const box = await createSandbox(t);
    const profile = await profileIn(box);
    await fleetIn(box, { harness: 'codex', sessions: ['daily', ['lead', '--harness', 'claude']] });
    const bots = box.path('bots');

    const { line } = await upSession(box, 'daily');
    const { line: lead } = await upSession(box, 'lead');

    assert.equal(line, bareLaunch(box, 'codex', BOT, 'daily'), 'the Codex line is exactly today\'s');
    assert.equal(memoryDirIn(await argvOf(box, lead)), memoryDirOf(profile.projects, bots), 'the control: the Claude session of that bot has the pair');
  });

  test('M13 a Codex session of a Claude bot is judged by its own harness: no pair', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);
    await fleetIn(box, { sessions: [['review', '--harness', 'codex']] });

    const { line } = await upSession(box, 'review');

    assert.equal(line, bareLaunch(box, 'codex', BOT, 'review'), 'the Codex line is exactly today\'s');
  });

  test('M13 a Pi session\'s line never carries it; a Claude session of the same bot does', async (t) => {
    const box = await createSandbox(t);
    const profile = await profileIn(box);
    await fakePi(box);
    await fleetIn(box, { sessions: [['pilot', '--harness', 'pi'], 'lead'] });

    const { line } = await upSession(box, 'pilot');
    const { line: lead } = await upSession(box, 'lead');

    assert.match(line, / pi --no-approve /, `the premise: this is a Pi line, got: ${line}`);
    assert.ok(!line.includes('--settings') && !line.includes(KEY), `a Pi line never carries it, got: ${line}`);
    assert.equal(memoryDirIn(await argvOf(box, lead)), memoryDirOf(profile.projects, box.path('bots')), 'the control: the Claude session of that bot has the pair');
  });

  // ------------------------------------------- M14 each way a session is started

  test('M14 a resume by up: the line has --resume and the pair', async (t) => {
    const box = await createSandbox(t);
    const profile = await profileIn(box);
    await fleetIn(box);
    const bots = box.path('bots');
    await upSession(box, 'daily');
    const id = await reported(box, bots, 'daily');
    const { tab } = await sessionIn(bots, BOT, 'daily');
    await box.orca.set({ terminals: (await box.orca.terminals()).filter((terminal) => terminal.tabId !== tab) });

    const { line } = await upSession(box, 'daily');

    await assertResumeCarries(box, line, memoryDirOf(profile.projects, bots), id);
  });

  test('M14 obk restart: the new tab\'s line has --resume and the pair', async (t) => {
    const box = await createSandbox(t);
    const profile = await profileIn(box);
    await fleetIn(box);
    const bots = box.path('bots');
    await upSession(box, 'daily');
    const id = await reported(box, bots, 'daily');

    await ok(box, ['restart', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);

    await assertResumeCarries(box, await lineOf(box, bots, 'daily'), memoryDirOf(profile.projects, bots), id);
  });

  test('M14 obk unpause: the new tab\'s line has --resume and the pair', async (t) => {
    const box = await createSandbox(t);
    const profile = await profileIn(box);
    await fleetIn(box);
    const bots = box.path('bots');
    await upSession(box, 'daily');
    const id = await reported(box, bots, 'daily');
    await ok(box, ['pause', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);

    await ok(box, ['unpause', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);

    await assertResumeCarries(box, await lineOf(box, bots, 'daily'), memoryDirOf(profile.projects, bots), id);
  });

  /** A session of the bot brought up, and the environment of a command run inside its tab. */
  async function makerIn(box, bots, name) {
    await upSession(box, name);
    const { tab } = await sessionIn(bots, BOT, name);
    const terminal = (await box.orca.terminals()).find((one) => one.tabId === tab);
    return { ...box.env, ORCA_TERMINAL_HANDLE: terminal.handle, ORCA_TAB_ID: terminal.tabId, ...kitLaunchMark(box, terminal) };
  }

  test('M14 obk temp make: a Claude temporary session\'s line has the pair; a Codex one made by the same maker has none', async (t) => {
    const box = await createSandbox(t);
    const profile = await profileIn(box);
    await fleetIn(box, { sessions: ['lead'] });
    const bots = box.path('bots');
    const env = await makerIn(box, bots, 'lead');

    await ok(box, ['temp', 'make', '--bots', 'bots', '--name', 'scout', '--prompt', 'Read the pull request.'], { env });
    await ok(box, ['temp', 'make', '--bots', 'bots', '--name', 'scout-codex', '--harness', 'codex', '--prompt', 'Read the pull request.'], { env });

    const argv = await argvOf(box, await lineOf(box, bots, 'scout'));
    assert.equal(memoryDirIn(argv), memoryDirOf(profile.projects, bots));
    assert.equal(argv.at(-2), '--', `the task is still last, after --, got: ${JSON.stringify(argv)}`);
    assert.ok(argv.at(-1).startsWith('Read the pull request.'), `the task is still last, got: ${JSON.stringify(argv)}`);
    const codex = await lineOf(box, bots, 'scout-codex');
    assert.ok(!codex.includes('--settings') && !codex.includes(KEY), `a Codex temporary session has none, got: ${codex}`);
  });

  test('M14 each start looks again: a profile selected after the first start is on the restart\'s line', async (t) => {
    const box = await createSandbox(t);
    await fleetIn(box);
    const bots = box.path('bots');
    const first = await upSession(box, 'daily');
    assertTodaysLine(box, first, 'daily');
    const id = await reported(box, bots, 'daily');
    const profile = await profileIn(box);

    await ok(box, ['restart', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);

    await assertResumeCarries(box, await lineOf(box, bots, 'daily'), memoryDirOf(profile.projects, bots), id);
  });

  test('M14 each start looks again: a profile gone after the first start is not on the restart\'s line', async (t) => {
    const box = await createSandbox(t);
    const profile = await profileIn(box);
    await fleetIn(box);
    const bots = box.path('bots');
    const { line: first } = await upSession(box, 'daily');
    assert.equal(memoryDirIn(await argvOf(box, first)), memoryDirOf(profile.projects, bots), 'the first start has the pair');
    await reported(box, bots, 'daily');
    await rm(profile.selected);

    await ok(box, ['restart', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);

    const line = await lineOf(box, bots, 'daily');
    assert.ok(line.includes('--resume'), `the premise: a resume, got: ${line}`);
    assert.ok(!line.includes('--settings') && !line.includes(KEY), `nothing is kept from the first start, got: ${line}`);
  });

  // ----------------------------------------------- M15 the kit writes no file

  test('M15 bringing a session up with the pair writes no file for it: the bot\'s .claude folder, the profile folder, selected-host and the real projects folder are as they were', async (t) => {
    const box = await createSandbox(t);
    await fleetIn(box, { sessions: ['control', 'daily'] });
    const bots = box.path('bots');
    const home = botHomeOf(bots, BOT);
    // With no profile, as the kit leaves the folder today.
    await upSession(box, 'control');
    const profile = await profileIn(box);
    const before = {
      bot: await snapshot(path.join(home, '.claude')),
      profiles: await snapshot(path.join(profile.data, 'claude-profiles')),
      projects: await snapshot(profile.projects),
      selected: await readFile(profile.selected, 'utf8'),
    };

    const { line } = await upSession(box, 'daily');

    assert.equal(memoryDirIn(await argvOf(box, line)), memoryDirOf(profile.projects, bots), 'the premise: this start had the pair');
    assert.deepEqual(await snapshot(path.join(home, '.claude')), before.bot, 'the bot\'s .claude folder is as it was');
    assert.ok(!existsSync(path.join(home, '.claude', 'settings.local.json')), 'no settings.local.json in the bot folder');
    assert.ok(!existsSync(path.join(bots, '.claude', 'settings.local.json')), 'no settings.local.json in the bots folder');
    const settings = await readFile(path.join(home, '.claude', 'settings.json'), 'utf8');
    assert.ok(!settings.includes(KEY), `no ${KEY} in the bot's .claude/settings.json, got: ${settings}`);
    assert.deepEqual(await snapshot(path.join(profile.data, 'claude-profiles')), before.profiles, 'the profile folder is as it was');
    assert.equal(await readFile(profile.selected, 'utf8'), before.selected, 'selected-host is as it was');
    assert.deepEqual(await snapshot(profile.projects), before.projects, 'the memory folder is not made: the kit only names it');
  });

  test('M15 a user\'s own settings files are not changed: local and profile byte for byte, and the bot\'s keeps its key', async (t) => {
    const box = await createSandbox(t);
    const profile = await profileIn(box);
    await fleetIn(box);
    const bots = box.path('bots');
    const home = botHomeOf(bots, BOT);
    const files = settingsFilesOf(home, profile, bots);
    const localText = '{\n    "model": "mine",   "permissions": {}\n}\n';
    const profileText = '{ "theme": "dark" }';
    await writeFile(files.local, localText);
    await writeFile(files.profile, profileText);
    await addTo(files.bot, { model: 'mine' });

    const { line } = await upSession(box, 'daily');

    assert.equal(memoryDirIn(await argvOf(box, line)), memoryDirOf(profile.projects, bots), 'the premise: this start had the pair');
    assert.equal(await readFile(files.local, 'utf8'), localText);
    assert.equal(await readFile(files.profile, 'utf8'), profileText);
    const after = JSON.parse(await readFile(files.bot, 'utf8'));
    assert.equal(after.model, 'mine');
    assert.ok(!Object.hasOwn(after, KEY), `no ${KEY} in the bot's .claude/settings.json, got: ${JSON.stringify(after)}`);
  });

  // ------------------------------------------- M16 memory off stays off

  const MEMORY_OFF = [
    ['bot', 'autoMemoryEnabled: false', { autoMemoryEnabled: false }],
    ['local', 'autoMemoryEnabled: false', { autoMemoryEnabled: false }],
    ['profile', 'autoMemoryEnabled: false', { autoMemoryEnabled: false }],
    ['profile', 'CLAUDE_CODE_DISABLE_AUTO_MEMORY in env', { env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' } }],
  ];
  for (const [where, label, keys] of MEMORY_OFF) {
    test(`M16 the ${where} settings file says ${label}: the session gets only the pair, and the kit turns nothing on or off`, async (t) => {
      const box = await createSandbox(t);
      const profile = await profileIn(box);
      await fleetIn(box);
      const bots = box.path('bots');
      const home = botHomeOf(bots, BOT);
      const file = settingsFilesOf(home, profile, bots)[where];
      await addTo(file, keys);
      const text = await readFile(file, 'utf8');

      const { line } = await upSession(box, 'daily');

      // memoryDirIn holds the JSON to the one key: not autoMemoryEnabled, not env.
      await assertCarries(box, line, memoryDirOf(profile.projects, bots), 'daily');
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
});
