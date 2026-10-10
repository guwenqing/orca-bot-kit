// A session's start-prompt file is in its own bot's folder of `<bots>.prompts`
// (#534).
//
// `up` and `temp make` write a start prompt that is long or has more than one
// line to a file beside the bots folder, and the launch line hands the harness
// that file. `temp make` runs inside the maker's sandbox, and a Codex session
// may write only in its own bot's folders (test/sandbox-launch-dirs.test.js).
// So the file is `<bots>.prompts/<bot>/<session>.txt`, which `promptPath`
// (src/up.js) answers.
//
// Before #534 the file was `<bots>.prompts/<bot>.<session>.txt`, and fleets
// have such files. Retiring a session, a temporary one or a whole bot removes
// its file in the new place and one left in the old flat place. `obk health`
// names a start-prompt file no session answers to as a leftover, in both
// places, and says nothing about a live session's own file, nor about the
// per-bot folders themselves, which the kit makes for every Codex session.
//
// Every run is in the sandbox (helpers/cli.js): its own HOME and a fake Orca.

import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { promptPath } from '../src/up.js';
import { createSandbox, kitLaunchMark, promptFileOf, sessionIn, tabsOfBot, typedInto } from './helpers/cli.js';

/** A duty long enough that the kit hands it to the harness from a file. */
const LONG_DUTY = 'Watch the queue and say what you see. '.repeat(10).trim();

/** A task long enough that a temporary session's start prompt goes through a file. */
const LONG_TASK = 'Read the open pull request and write down what it changes. '.repeat(10).trim();

/** Where #534 puts one session's start-prompt file. */
const newPlace = promptFileOf;

/** Where the kit put it before #534. */
const oldPlace = (bots, bot, session) => path.join(`${bots}.prompts`, `${bot}.${session}.txt`);

const exists = (file) => stat(file).then(() => true, () => false);

/** `obk`, which must work. */
async function ok(box, args, options) {
  const result = await box.run(args, options);
  assert.equal(result.code, 0, `obk ${args.join(' ')}:\n${result.stdout}${result.stderr}`);
  return result;
}

/** A bots folder with `api-bot` on `harness` and the sessions given, `[name, ...settings]` each, brought up. */
async function botUp(box, sessions, harness = 'codex', bot = 'api-bot', { init = true } = {}) {
  if (init) await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(box, ['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness]);
  for (const [name, ...settings] of sessions) {
    await ok(box, ['session', 'add', '--bots', 'bots', '--bot', bot, '--name', name, ...settings]);
  }
  await ok(box, ['up', '--bots', 'bots', '--bot', bot]);
  return box.path('bots');
}

/** The environment of a command run in one session's tab, the kit's launch mark with it. */
async function inTabOf(box, bots, bot, session) {
  const tab = (await sessionIn(bots, bot, session))?.tab;
  const terminal = (await tabsOfBot(box, bots, bot)).find((one) => one.tabId === tab);
  assert.ok(terminal, `the premise: ${bot}/${session} has a tab`);
  return { ...box.env, ORCA_TERMINAL_HANDLE: terminal.handle, ORCA_TAB_ID: terminal.tabId, ...kitLaunchMark(box, terminal) };
}

/** Plant a start-prompt file where an older kit or a gone session left it. */
async function plant(file, text = 'A duty from before.\n') {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

// ---------------------------------------------------------------- where it is

test('SP1 promptPath answers <bots>.prompts/<bot>/<session>.txt', () => {
  const bots = path.join(path.sep, 'tmp', 'fleet', 'bots');
  assert.equal(promptPath(bots, 'api-bot', 'daily'), path.join(`${bots}.prompts`, 'api-bot', 'daily.txt'));
  assert.equal(promptPath(bots, 'web-bot', 'nightly'), path.join(`${bots}.prompts`, 'web-bot', 'nightly.txt'));
});

test('SP2 up writes a long start prompt to <bots>.prompts/<bot>/<session>.txt, hands that file to the harness, and writes nothing in the old flat place', async (t) => {
  const box = await createSandbox(t);
  await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(box, ['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'codex']);
  await ok(box, ['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily', '--prompt', LONG_DUTY]);
  const bots = box.path('bots');

  const answer = JSON.parse((await ok(box, ['up', '--bots', 'bots', '--bot', 'api-bot', '--json'])).stdout);

  const file = newPlace(bots, 'api-bot', 'daily');
  assert.equal(answer.tabs?.[0]?.promptFile, file, `the answer names the file the session was handed, got: ${JSON.stringify(answer.tabs)}`);
  assert.equal(await readFile(file, 'utf8'), LONG_DUTY, 'the file holds the duty word for word');
  assert.equal(await exists(oldPlace(bots, 'api-bot', 'daily')), false, 'nothing is written in the old flat place');
  const line = typedInto((await tabsOfBot(box, bots, 'api-bot'))[0])[0];
  assert.ok(line.includes(file), `the launch line hands the harness that file, got: ${line}`);
});

test('SP3 temp make from a Codex session writes a long task to <bots>.prompts/<bot>/<temp>.txt', async (t) => {
  const box = await createSandbox(t);
  const bots = await botUp(box, [['daily']]);

  await ok(box, ['temp', 'make', '--bots', 'bots', '--name', 'scout', '--prompt', LONG_TASK], { env: await inTabOf(box, bots, 'api-bot', 'daily') });

  const file = newPlace(bots, 'api-bot', 'scout');
  assert.ok((await readFile(file, 'utf8')).includes(LONG_TASK), `the task is in ${file}`);
  assert.equal(await exists(oldPlace(bots, 'api-bot', 'scout')), false, 'nothing is written in the old flat place');
});

// ---------------------------------------------------------------- retiring

test('SP4 retiring a session removes its start-prompt file, and one left in the old flat place', async (t) => {
  const box = await createSandbox(t);
  const bots = await botUp(box, [['daily', '--prompt', LONG_DUTY], ['review']]);
  const file = newPlace(bots, 'api-bot', 'daily');
  assert.equal(await exists(file), true, `the premise: up left ${file}`);
  await plant(oldPlace(bots, 'api-bot', 'daily'));

  await ok(box, ['retire', '--bots', 'bots', '--bot', 'api-bot', '--session', 'daily']);

  assert.equal(await exists(file), false, `${file} goes with the session`);
  assert.equal(await exists(oldPlace(bots, 'api-bot', 'daily')), false, `${oldPlace(bots, 'api-bot', 'daily')}, from before #534, goes too`);
});

test('SP5 temp retire removes the temporary session\'s start-prompt file, and one left in the old flat place', async (t) => {
  const box = await createSandbox(t);
  const bots = await botUp(box, [['daily']]);
  const env = await inTabOf(box, bots, 'api-bot', 'daily');
  await ok(box, ['temp', 'make', '--bots', 'bots', '--name', 'scout', '--prompt', LONG_TASK], { env });
  const file = newPlace(bots, 'api-bot', 'scout');
  assert.equal(await exists(file), true, `the premise: temp make left ${file}`);
  await plant(oldPlace(bots, 'api-bot', 'scout'));

  await ok(box, ['temp', 'retire', '--bots', 'bots', '--name', 'scout'], { env });

  assert.equal(await exists(file), false, `${file} goes with the temporary session`);
  assert.equal(await exists(oldPlace(bots, 'api-bot', 'scout')), false, `${oldPlace(bots, 'api-bot', 'scout')}, from before #534, goes too`);
});

test('SP6 retiring a whole bot removes its sessions\' start-prompt files, in the new place and the old flat one', async (t) => {
  const box = await createSandbox(t);
  const bots = await botUp(box, [['daily', '--prompt', LONG_DUTY]]);
  const file = newPlace(bots, 'api-bot', 'daily');
  assert.equal(await exists(file), true, `the premise: up left ${file}`);
  await plant(oldPlace(bots, 'api-bot', 'daily'));

  await ok(box, ['retire', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(await exists(file), false, `${file} goes with the bot`);
  assert.equal(await exists(oldPlace(bots, 'api-bot', 'daily')), false, `${oldPlace(bots, 'api-bot', 'daily')}, from before #534, goes too`);
});

// ---------------------------------------------------------------- health

/** `obk health --json`, and its findings. */
async function findings(box) {
  const result = await box.run(['health', '--bots', 'bots', '--json']);
  assert.equal(result.stderr, '', `health reports on stdout: ${result.stderr}`);
  return JSON.parse(result.stdout).found;
}

const wordsOf = (finding) => `${finding.where} ${finding.says}`;

/** The leftover findings that are about exactly `file`. */
const leftoversAbout = (found, file) => found.filter((one) => one.kind === 'leftover' && one.where === file);

test('SP7 health names a start-prompt file no session answers to, in a bot\'s folder of <bots>.prompts and in the old flat place, as a leftover', async (t) => {
  const box = await createSandbox(t);
  const bots = await botUp(box, [['daily', '--prompt', LONG_DUTY]]);
  const leftovers = [
    newPlace(bots, 'api-bot', 'gone'),
    newPlace(bots, 'ghost-bot', 'daily'),
    oldPlace(bots, 'api-bot', 'gone'),
  ];
  for (const file of leftovers) await plant(file);

  const found = await findings(box);

  for (const file of leftovers) {
    assert.equal(leftoversAbout(found, file).length, 1, `one leftover finding names ${file}, got: ${JSON.stringify(found, null, 2)}`);
  }
});

test('SP8 health says nothing of a live session\'s own start-prompt file, nor of the per-bot folders in <bots>.prompts', async (t) => {
  const box = await createSandbox(t);
  await botUp(box, [['daily', '--prompt', LONG_DUTY]]);
  // A Codex bot whose one session has a short duty: its folder in
  // <bots>.prompts is there for its launch line, and empty.
  const bots = await botUp(box, [['daily', '--prompt', 'Keep the queue moving.']], 'codex', 'web-bot', { init: false });
  const live = newPlace(bots, 'api-bot', 'daily');
  assert.equal(await exists(live), true, `the premise: up left ${live}`);

  const found = await findings(box);

  for (const quiet of [live, path.join(`${bots}.prompts`, 'api-bot'), path.join(`${bots}.prompts`, 'web-bot')]) {
    assert.deepEqual(
      found.filter((one) => one.where === quiet || wordsOf(one).includes(`${quiet} `) || wordsOf(one).endsWith(quiet)),
      [],
      `nothing names ${quiet}, got: ${JSON.stringify(found, null, 2)}`,
    );
  }
});
