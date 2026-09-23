// `obk session change --bots <path> --bot <bot> --session <name> [settings]`:
// new settings for a session a bot already has, without opening `bot.yaml`
// (PRD 3.2, 6.4).
//
// Each setting given replaces the one the session had; a setting not given is
// left as it is; a setting given empty (`--model=`) is taken away, which is the
// harness's own default. `--extra-arg` given at all is the whole new list. A
// session has a prompt or a prompt file, never both, so giving one drops the
// other.
//
// What comes out is judged by the rules `session add` judges a new session by:
// what `session add` would refuse is refused here, and nothing is written.
//
// It writes `bot.yaml` and nothing else. A running session takes the change
// the next time it starts, and the answer says so and names `obk restart`;
// this command itself never touches Orca.

import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import {
  assertCleanFailure,
  assertKeptWhatTheyWrote,
  assertNoTrailingSpace,
  botHomeOf,
  createSandbox,
  skipGit,
  snapshot,
} from './helpers/cli.js';
import { botYamlOf } from './helpers/skills.js';

const BOT = 'api-bot';

/** A bots folder with one bot, and its daily session made with the settings given. */
async function withSession(box, { harness = 'claude', settings = [] } = {}) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', harness]);
  assert.equal(made.code, 0, made.stderr);
  const bots = box.path('bots');
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily', ...settings]);
  assert.equal(added.code, 0, added.stderr);
  return bots;
}

const change = (box, ...rest) =>
  box.run(['session', 'change', '--bots', 'bots', '--bot', BOT, '--session', 'daily', ...rest]);

/** The one session called `name` in the bot's bot.yaml, as it is written now. */
async function sessionOf(bots, name = 'daily') {
  const sessions = parse(await readFile(botYamlOf(bots, BOT), 'utf8')).sessions ?? [];
  const found = sessions.filter((session) => session?.name === name);
  assert.equal(found.length, 1, `one session should be called ${name}, got: ${JSON.stringify(sessions)}`);
  return found[0];
}

/** Write a prompt file into the bot home, where `--prompt-file` names it from. */
async function promptFile(bots, rel, text) {
  const file = path.join(botHomeOf(bots, BOT), rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

test('SC1 a setting given replaces the one the session had, and the others are left as they were', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSession(box, {
    settings: ['--model', 'sonnet', '--effort', 'high', '--approval', 'ask', '--work-dir', 'work/api'],
  });
  const calls = (await box.orca.calls()).length;

  const result = await change(box, '--model', 'opus');

  assert.equal(result.code, 0, result.stderr);
  const session = await sessionOf(bots);
  assert.deepEqual(
    Object.keys(session).sort(),
    ['approval', 'effort', 'model', 'name', 'work_dir'],
    `nothing added, nothing lost, got: ${JSON.stringify(session)}`,
  );
  assert.equal(session.model, 'opus', 'the one that was given');
  assert.equal(session.effort, 'high');
  assert.equal(session.approval, 'ask');
  assert.equal(session.work_dir, 'work/api');
  assert.equal((await box.orca.calls()).length, calls, 'session change does not talk to Orca at all');
});

test('SC1 several settings in one call are all written', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSession(box, { settings: ['--model', 'sonnet'] });

  const result = await change(box, '--effort', 'low', '--approval', 'dangerously-skip', '--work-dir', 'work/web');

  assert.equal(result.code, 0, result.stderr);
  const session = await sessionOf(bots);
  assert.equal(session.model, 'sonnet', 'not given, so kept');
  assert.equal(session.effort, 'low');
  assert.equal(session.approval, 'dangerously-skip', 'asked for in those words, so written');
  assert.equal(session.work_dir, 'work/web');
});

test('SC2 a setting given empty is taken away, which is the harness\'s own default', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSession(box, { settings: ['--model', 'sonnet', '--effort', 'high'] });

  const result = await change(box, '--effort=');

  assert.equal(result.code, 0, result.stderr);
  const session = await sessionOf(bots);
  assert.equal('effort' in session, false, `an empty value takes the setting away, got: ${JSON.stringify(session)}`);
  assert.equal(session.model, 'sonnet', 'and only that one');
});

test('SC3 --extra-arg given is the whole new list, not an addition to the old one', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSession(box, { settings: ['--extra-arg=--verbose', '--extra-arg=--debug'] });

  const result = await change(box, '--extra-arg=--search', '--extra-arg=--quiet');

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual((await sessionOf(bots)).extra_args, ['--search', '--quiet']);
});

test('SC4 a prompt given drops the prompt file the session had', async (t) => {
  const box = await createSandbox(t);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude'])).code, 0);
  const bots = box.path('bots');
  await promptFile(bots, 'duty.md', 'The long duty.\n');
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily', '--prompt-file', 'duty.md']);
  assert.equal(added.code, 0, added.stderr);

  const result = await change(box, '--prompt', 'The short duty.');

  assert.equal(result.code, 0, result.stderr);
  const session = await sessionOf(bots);
  assert.equal(session.prompt.trim(), 'The short duty.');
  assert.equal('prompt_file' in session, false, `one duty per session, got: ${JSON.stringify(session)}`);
});

test('SC4 a prompt file given drops the prompt the session had', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSession(box, { settings: ['--prompt', 'The short duty.'] });
  await promptFile(bots, 'duty.md', 'The long duty.\n');

  const result = await change(box, '--prompt-file', 'duty.md');

  assert.equal(result.code, 0, result.stderr);
  const session = await sessionOf(bots);
  assert.equal(session.prompt_file, 'duty.md');
  assert.equal('prompt' in session, false, `one duty per session, got: ${JSON.stringify(session)}`);
});

test('SC5 a Codex context of 200000 is written as a number, as session add writes it', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSession(box, { harness: 'codex' });

  const result = await change(box, '--context', '200000');

  assert.equal(result.code, 0, result.stderr);
  const { context } = await sessionOf(bots);
  assert.equal(context, 200000, `a whole number, not the string, got: ${JSON.stringify(context)}`);
});

test('SC6 everything else in bot.yaml, the other sessions included, still says what the user wrote', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSession(box);
  const mine = `# my own notes about this bot
name: api-bot
harness: claude
charter: |
  Mine, and unchanged.
notes: keep me            # a key the kit knows nothing about
rules: []
skills: []
sessions:
  - name: mine            # my session, leave it be
    approval: ask
    model: opus
  - name: daily
    approval: auto
    model: sonnet
`;
  await writeFile(botYamlOf(bots, BOT), mine);

  const result = await change(box, '--model', 'haiku');

  assert.equal(result.code, 0, result.stderr);
  const after = await readFile(botYamlOf(bots, BOT), 'utf8');
  assertKeptWhatTheyWrote(mine, after, { changed: ['sessions'] });
  assertNoTrailingSpace(after);
  assert.deepEqual(parse(after).sessions, [
    { name: 'mine', approval: 'ask', model: 'opus' },
    { name: 'daily', approval: 'auto', model: 'haiku' },
  ]);
});

for (const [label, harness, settings, args, named] of [
  ['an approval level the kit does not know', 'claude', [], ['--approval', 'sometimes'], 'sometimes'],
  ['a prompt file that is not there', 'claude', [], ['--prompt-file', 'no-such-duty.md'], 'no-such-duty.md'],
  // The change on its own is fine; what it leaves behind is not: on Claude a
  // context rides on the model, and this takes the model away from under it.
  ['a change that leaves a Claude context with no model', 'claude', ['--model', 'sonnet', '--context', '1m'], ['--model='], '--model'],
  ['a Codex context that is not a number', 'codex', [], ['--context', '1m'], '1m'],
]) {
  test(`SC7 ${label} is refused as session add refuses it, and nothing is written`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withSession(box, { harness, settings });
    const before = await snapshot(bots, skipGit);

    const result = await change(box, ...args);

    assertCleanFailure(result);
    assert.ok(result.stderr.includes(named), `the refusal should name ${named}, got: ${result.stderr}`);
    assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
  });
}

for (const [label, args, named] of [
  ['a bot that is not there', ['session', 'change', '--bots', 'bots', '--bot', 'ghost-bot', '--session', 'daily', '--model', 'opus'], 'ghost-bot'],
  ['a session the bot does not have', ['session', 'change', '--bots', 'bots', '--bot', BOT, '--session', 'ghost', '--model', 'opus'], 'ghost'],
  ['nothing to change', ['session', 'change', '--bots', 'bots', '--bot', BOT, '--session', 'daily'], null],
  // A session keeps its harness: its book and its conversations belong to it.
  ['a new harness', ['session', 'change', '--bots', 'bots', '--bot', BOT, '--session', 'daily', '--harness', 'codex'], 'harness'],
]) {
  test(`SC8 ${label} is refused, and nothing is written`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withSession(box, { settings: ['--model', 'sonnet'] });
    const before = await snapshot(bots, skipGit);
    const calls = (await box.orca.calls()).length;

    const result = await box.run(args);

    assertCleanFailure(result);
    if (named !== null) assert.ok(result.stderr.includes(named), `the refusal should name ${named}, got: ${result.stderr}`);
    assert.deepEqual(await snapshot(bots, skipGit), before);
    assert.equal((await box.orca.calls()).length, calls);
    // The same bot and session with something to change goes through, so the
    // refusal above was about this call and not a command that is not there.
    const changed = await change(box, '--model', 'opus');
    assert.equal(changed.code, 0, `a call with a setting in it should go through: ${changed.stderr}`);
  });
}

test('SC9 it says what it changed and that a running session takes it when it next starts, naming obk restart', async (t) => {
  const box = await createSandbox(t);
  await withSession(box, { settings: ['--model', 'sonnet'] });

  const plain = await change(box, '--model', 'opus');

  assert.equal(plain.code, 0, plain.stderr);
  for (const fact of [BOT, 'daily', 'opus', 'obk restart']) {
    assert.ok(plain.stdout.includes(fact), `the report should say ${fact}, got: ${plain.stdout}`);
  }
  assert.ok(!plain.stdout.includes('undefined'), `nothing should be undefined, got: ${plain.stdout}`);
});

test('SC9 --json answers the same facts as JSON and nothing else', async (t) => {
  const box = await createSandbox(t);
  await withSession(box, { settings: ['--model', 'sonnet'] });

  const result = await change(box, '--model', 'opus', '--json');

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  const facts = JSON.stringify(answer);
  for (const fact of [BOT, 'daily', 'opus', 'obk restart']) {
    assert.ok(facts.includes(fact), `the answer should carry ${fact}, got: ${facts}`);
  }
});
