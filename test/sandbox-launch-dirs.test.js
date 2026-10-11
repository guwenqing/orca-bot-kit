// A Codex session can write the kit's own folders for its bot, and only those
// (#534).
//
// A Codex session at the kit's default approval level runs in Codex's
// `workspace-write` sandbox: it may write in its cwd, the bot home, and in any
// folder its launch line names with `--add-dir`, and nowhere else. The kit
// writes three things beside the bots folder for a session: long message
// bodies in `<bots>.messages`, start prompts in `<bots>.prompts` and SQLite
// lock files in `<bots>.locks`. So every Codex launch line, fresh and resume,
// names that session's own bot's folder in each of the three, one `--add-dir`
// each: `<bots>.messages/<bot>`, `<bots>.prompts/<bot>`, `<bots>.locks/<bot>`.
// Never another bot's folder, and never the whole `<bots>.messages`, which
// would let any Codex bot change any other bot's mail. A Claude launch line
// gets none of them. The three folders are on disk before the line is typed:
// Codex is given a writable root that does not exist, and the session's first
// send would make it from inside the sandbox, which it cannot.
//
// Where the three `--add-dir` go on the line is the kit's business and is not
// pinned here: the line is run through a shell against a fake `codex`, and the
// arguments it got are read, as test/session-resume.test.js does.
//
// Every run is in the sandbox (helpers/cli.js): its own HOME, a fake Orca and a
// fake `codex` on its own PATH.

import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  botHomeOf,
  conversationOnRecord,
  createSandbox,
  fakeProgram,
  harnessPartOf,
  kitDirsOf,
  kitLaunchMark,
  recordSession,
  sessionIn,
  sh,
  tabsOfBot,
  typedInto,
} from './helpers/cli.js';

/** The three whole folders, which no launch line may name. */
const wholeDirsOf = (bots) => [`${bots}.messages`, `${bots}.prompts`, `${bots}.locks`];

const isDirectory = (file) => stat(file).then((found) => found.isDirectory(), () => false);

/** `obk`, which must work. */
async function ok(box, args, options) {
  const result = await box.run(args, options);
  assert.equal(result.code, 0, `obk ${args.join(' ')}:\n${result.stdout}${result.stderr}`);
  return result;
}

/** A bots folder with `bots` = [[name, harness, sessions = [[name, ...settings]]]], nothing brought up. */
async function written(box, bots) {
  await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);
  for (const [bot, harness, sessions = [['daily']]] of bots) {
    await ok(box, ['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness]);
    for (const [session, ...settings] of sessions) {
      await ok(box, ['session', 'add', '--bots', 'bots', '--bot', bot, '--name', session, ...settings]);
    }
  }
  return box.path('bots');
}

/** Bring one bot up, and give back the line typed first into one session's tab. */
async function launchOf(box, bots, bot, session = 'daily') {
  await ok(box, ['up', '--bots', 'bots', '--bot', bot]);
  const tab = (await sessionIn(bots, bot, session))?.tab;
  const terminal = (await tabsOfBot(box, bots, bot)).find((one) => one.tabId === tab);
  assert.ok(terminal, `${bot}/${session} should have a tab after up`);
  const typed = typedInto(terminal);
  assert.ok(typed.length >= 1, `the launch line should have been typed into ${bot}/${session}'s tab, got: ${JSON.stringify(typed)}`);
  return typed[0];
}

/**
 * The arguments a shell running the harness part of `line` hands the fake
 * harness: what Codex itself would get. Only the harness part is run, so the
 * line's mailbox step does nothing here.
 */
async function argvOf(box, line, fake) {
  const before = (await fake.calls()).length;
  const ran = await sh(harnessPartOf(line), { cwd: box.cwd, env: box.env });
  assert.equal(ran.code, 0, `the line should run: ${line}\n${ran.stderr}`);
  const calls = await fake.calls();
  assert.equal(calls.length, before + 1, `the line should start the harness once: ${line}`);
  return calls.at(-1).args;
}

/** Every folder the arguments give with `--add-dir`, in order: one value after each flag. */
function addDirsIn(argv) {
  const found = [];
  argv.forEach((word, at) => {
    if (word === '--add-dir') found.push(argv[at + 1]);
    else if (word.startsWith('--add-dir=')) found.push(word.slice('--add-dir='.length));
  });
  return found;
}

/** The line gives Codex exactly `expected` with `--add-dir`, each once, and none of the whole kit folders. */
function assertAddDirs(argv, expected, bots, what) {
  const dirs = addDirsIn(argv);
  assert.deepEqual([...dirs].sort(), [...expected].sort(), `${what}: --add-dir should name exactly ${JSON.stringify(expected)}, got: ${JSON.stringify(argv)}`);
  for (const whole of wholeDirsOf(bots)) {
    assert.ok(!dirs.includes(whole), `${what}: never the whole ${whole}, got: ${JSON.stringify(argv)}`);
  }
}

test('SL1 a fresh Codex launch line gives Codex its own bot\'s messages, prompts and locks folders, one --add-dir each, and nothing else', async (t) => {
  const box = await createSandbox(t);
  const codex = await fakeProgram(box, 'codex', {});
  const bots = await written(box, [['api-bot', 'codex']]);

  const argv = await argvOf(box, await launchOf(box, bots, 'api-bot'), codex);

  assertAddDirs(argv, kitDirsOf(bots, 'api-bot'), bots, 'a fresh Codex session');
});

test('SL2 a Codex session with a work dir outside the bot home gets that --add-dir and the three of its own bot', async (t) => {
  const box = await createSandbox(t);
  const codex = await fakeProgram(box, 'codex', {});
  const outside = path.join(box.root, 'clones', 'api');
  const bots = await written(box, [['api-bot', 'codex', [['daily', '--work-dir', outside]]]]);

  const argv = await argvOf(box, await launchOf(box, bots, 'api-bot'), codex);

  assertAddDirs(argv, [outside, ...kitDirsOf(bots, 'api-bot')], bots, 'a Codex session with a work dir outside');
});

test('SL3 a resumed Codex launch line carries the same three --add-dir as a fresh one', async (t) => {
  // An existing session picks the folders up at its next start (#534,
  // boundary 4), and a start that resumes is the usual one.
  const box = await createSandbox(t);
  const codex = await fakeProgram(box, 'codex', {});
  const bots = await written(box, [['api-bot', 'codex', [['daily', '--prompt', 'Keep the queue moving.']]]]);
  await launchOf(box, bots, 'api-bot');
  const first = await sessionIn(bots, 'api-bot', 'daily');
  await recordSession(box, { bots, bot: 'api-bot', tab: first.tab, session: 'sess-1', source: 'startup' });
  await conversationOnRecord(box, { harness: 'codex', cwd: botHomeOf(bots, 'api-bot'), id: 'sess-1' });
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.tabId !== first.tab) });

  const line = await launchOf(box, bots, 'api-bot');
  const argv = await argvOf(box, line, codex);

  assert.equal(argv[0], 'resume', `the premise: this start resumes, got: ${JSON.stringify(argv)}`);
  assert.ok(argv.includes('sess-1'), `the premise: it resumes sess-1, got: ${JSON.stringify(argv)}`);
  assertAddDirs(argv, kitDirsOf(bots, 'api-bot'), bots, 'a resumed Codex session');
});

test('SL4 in a fleet of two Codex bots each launch line names its own bot\'s folders and never the other bot\'s', async (t) => {
  const box = await createSandbox(t);
  const codex = await fakeProgram(box, 'codex', {});
  const bots = await written(box, [['api-bot', 'codex'], ['web-bot', 'codex', [['daily'], ['nightly']]]]);

  const api = await argvOf(box, await launchOf(box, bots, 'api-bot'), codex);
  const webDaily = await argvOf(box, await launchOf(box, bots, 'web-bot', 'daily'), codex);
  // Up again finds both of web-bot's tabs open and starts nothing new.
  const webNightly = await argvOf(box, await launchOf(box, bots, 'web-bot', 'nightly'), codex);

  assertAddDirs(api, kitDirsOf(bots, 'api-bot'), bots, 'api-bot/daily');
  assertAddDirs(webDaily, kitDirsOf(bots, 'web-bot'), bots, 'web-bot/daily');
  assertAddDirs(webNightly, kitDirsOf(bots, 'web-bot'), bots, 'web-bot/nightly');
  for (const dir of kitDirsOf(bots, 'web-bot')) assert.ok(!addDirsIn(api).includes(dir), `api-bot is never given ${dir}`);
  for (const dir of kitDirsOf(bots, 'api-bot')) assert.ok(!addDirsIn(webDaily).includes(dir), `web-bot is never given ${dir}`);
});

test('SL5 a Claude launch line names none of the kit\'s folders and carries no --add-dir', async (t) => {
  const box = await createSandbox(t);
  const bots = await written(box, [['api-bot', 'claude', [['daily', '--prompt', 'Keep the queue moving.']]]]);

  const line = await launchOf(box, bots, 'api-bot');

  assert.ok(!line.includes('--add-dir'), `Claude gets no --add-dir, got: ${line}`);
  for (const dir of kitDirsOf(bots, 'api-bot')) assert.ok(!line.includes(dir), `Claude's line does not name ${dir}, got: ${line}`);
});

test('SL6 the three folders of a Codex session\'s bot are on disk before its launch line is typed', async (t) => {
  // Orca refuses the line the kit types, so the run stops at the moment the
  // session would have started (as test/work-dir.test.js does for a work dir).
  const box = await createSandbox(t);
  const bots = await written(box, [['api-bot', 'codex']]);
  for (const dir of kitDirsOf(bots, 'api-bot')) {
    assert.equal(await isDirectory(dir), false, `the premise: ${dir} is not there before up`);
  }
  await box.orca.set({ fail: { 'terminal send': { code: 'runtime_error', message: 'the tab would not take it' } } });

  const result = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  assert.notEqual(result.code, 0, `the premise: the launch line was refused, got:\n${result.stdout}${result.stderr}`);
  for (const dir of kitDirsOf(bots, 'api-bot')) {
    assert.equal(await isDirectory(dir), true, `${dir} is made before the session is started, not after`);
  }
});

test('SL7 a temporary session a Codex session makes is launched with its own bot\'s three folders', async (t) => {
  // A temp of a Codex session runs in the same sandbox, and makes temps and
  // sends mail of its own.
  const box = await createSandbox(t);
  const codex = await fakeProgram(box, 'codex', {});
  const bots = await written(box, [['api-bot', 'codex']]);
  await launchOf(box, bots, 'api-bot');
  const maker = (await tabsOfBot(box, bots, 'api-bot'))[0];
  const env = { ...box.env, ORCA_TERMINAL_HANDLE: maker.handle, ORCA_TAB_ID: maker.tabId, ...kitLaunchMark(box, maker) };

  await ok(box, ['temp', 'make', '--bots', 'bots', '--name', 'scout', '--prompt', 'Read the open pull request.'], { env });

  const tab = (await sessionIn(bots, 'api-bot', 'scout'))?.tab;
  const terminal = (await tabsOfBot(box, bots, 'api-bot')).find((one) => one.tabId === tab);
  assert.ok(terminal, 'the premise: scout has a tab');
  assertAddDirs(await argvOf(box, typedInto(terminal)[0], codex), kitDirsOf(bots, 'api-bot'), bots, 'api-bot/scout, a temporary session');
});
