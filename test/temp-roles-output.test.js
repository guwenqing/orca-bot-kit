// Roles for temporary sessions (#465), the parts of a make from a role other
// than its settings (those are in temp-roles.test.js):
//
//   R2  With --role, the session is named `<role>-<name>`, unless --name
//       already begins with `<role>-`, when it is used as given. A --name that
//       begins with another of the bot's roles and a hyphen is refused, and
//       nothing is written: a name never says the wrong role.
//   R6  The role's prompt_file, when it has one, is the start prompt when
//       neither --prompt nor --prompt-file is given: the session's entry gets
//       `prompt_file` as the role gives it. One given wins. With neither and
//       no role prompt file, the make is refused as it is today.
//   R7  The book records `temporary: { maker, made, role, option }`, role and
//       option by name.
//   R8  The output says which option was used and its purpose, the role's
//       other options, and for each setting what was used and where it came
//       from. --json gains `role` (with --role only) and `chosen` (always),
//       each setting `{ value, from }`, `from` one of flag, role, maker,
//       harness default, and no value for a harness default; `settings` is
//       still there. The plain lines' wording is not pinned: only that the
//       names and values appear.
//
// The fleet is in helpers/temp-roles.js. Every run is in the sandbox
// (helpers/cli.js): its own HOME, a fake Orca, and fake harnesses on its own
// PATH. Nothing here reaches the real Orca, a real harness, or anything
// outside the sandbox.

import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  assertRefused,
  botHomeOf,
  createSandbox,
  fakeProgram,
  orcaCallsOf,
  sessionIn,
  typedInto,
} from './helpers/cli.js';
import {
  answerIn,
  argvOf,
  BOT,
  chosenIn,
  entryIn,
  fleet,
  liveTab,
  made,
  make,
  REVIEW_DUTY,
  TASK,
  world,
} from './helpers/temp-roles.js';

// ------------------------------------------------------- R2 the name

test('R2 with --role the session is <role>-<name>, unless the name already begins with <role>-', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);
  const home = botHomeOf(bots, BOT);

  for (const [role, name, expected] of [
    ['reviewer', '465', 'reviewer-465'],
    ['reviewer', 'reviewer-466', 'reviewer-466'],
    ['developer', '467', 'developer-467'],
    ['developer', 'developer-468', 'developer-468'],
  ]) {
    const result = await made(box, planner, ['--role', role, '--name', name, '--prompt', TASK, '--json']);

    assert.equal(answerIn(result).session, expected, `--role ${role} --name ${name} makes ${expected}, got: ${result.stdout}`);
    const entry = await entryIn(bots, expected);
    assert.ok(entry, `bot.yaml holds ${expected}`);
    assert.equal(path.resolve(home, entry.work_dir), path.join(home, 'work', expected), `its work dir is work/${expected}`);
    assert.equal((await sessionIn(bots, BOT, expected))?.temporary?.maker, 'planner', `the book holds ${expected}`);
  }
  for (const wrong of ['465', 'reviewer-reviewer-466', '467', 'developer-developer-468']) {
    assert.equal(await entryIn(bots, wrong), undefined, `there is no ${wrong}`);
  }
});

test('R2 with --role, a name that begins with another of the bot\'s roles and a hyphen is refused with the reason, and nothing is written', async (t) => {
  // A name never says the wrong role.
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);

  for (const [role, name, other] of [['reviewer', 'developer-465', 'developer'], ['developer', 'reviewer-465', 'reviewer']]) {
    const before = await world(box, bots);
    const from = (await box.orca.calls()).length;

    const result = await make(box, planner, ['--role', role, '--name', name, '--prompt', TASK]);

    assertRefused(result, other);
    assert.deepEqual(await world(box, bots), before, `--role ${role} --name ${name}: bot.yaml, the book and Orca are as they were`);
    assert.deepEqual(orcaCallsOf((await box.orca.calls()).slice(from), 'terminal create'), [], 'no tab was opened');
  }

  // The prefix is the role's name and a hyphen: developers-1 is not a developer's name.
  await made(box, planner, ['--role', 'reviewer', '--name', 'developers-1', '--prompt', TASK]);
  assert.ok(await entryIn(bots, 'reviewer-developers-1'), 'a name that only starts with the same letters is a name like any other');
  await made(box, planner, ['--role', 'reviewer', '--name', '465', '--prompt', TASK]);
  assert.ok(await entryIn(bots, 'reviewer-465'), 'and the same make with a plain name works');
});

// ------------------------------------------------------- R6 the prompt file

test('R6 with no prompt given, the role\'s prompt file is the start prompt, written into the entry as the role gives it', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);

  await made(box, planner, ['--role', 'reviewer', '--name', 'reviewer-1']);

  const entry = await entryIn(bots, 'reviewer-1');
  assert.equal(entry?.prompt_file, 'reviewer.md', `the role's prompt file, as it gives it, got: ${JSON.stringify(entry)}`);
  assert.equal('prompt' in entry, false, `and no prompt beside it, got: ${JSON.stringify(entry)}`);
  const [line] = typedInto(await liveTab(box, bots, 'reviewer-1'));
  const fake = await fakeProgram(box, 'codex', {});
  const prompt = (await argvOf(box, line, fake)).at(-1);
  assert.ok(prompt.startsWith(REVIEW_DUTY), `the file's text is the start prompt, got: ${JSON.stringify(prompt)}`);
});

test('R6 a --prompt or --prompt-file given wins over the role\'s prompt file', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);
  const file = path.join(botHomeOf(bots, BOT), 'tasks', 'review-467.md');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, 'Review PR 467 only.\n');

  await made(box, planner, ['--role', 'reviewer', '--name', 'reviewer-1', '--prompt', TASK]);
  await made(box, planner, ['--role', 'reviewer', '--name', 'reviewer-2', '--prompt-file', file]);

  const one = await entryIn(bots, 'reviewer-1');
  assert.equal(one?.prompt, TASK, `--prompt is the start prompt, got: ${JSON.stringify(one)}`);
  assert.equal('prompt_file' in one, false, `and the role's file is not, got: ${JSON.stringify(one)}`);
  // #758: how the kit keeps --prompt-file's text is not pinned, only that it
  // is the start prompt, and the role's file is not.
  const [line] = typedInto(await liveTab(box, bots, 'reviewer-2'));
  const fake = await fakeProgram(box, 'codex', {});
  const prompt = (await argvOf(box, line, fake)).at(-1);
  assert.ok(prompt.startsWith('Review PR 467 only.\n\n'), `--prompt-file's text is the start prompt, got: ${JSON.stringify(prompt)}`);
  assert.ok(!prompt.includes(REVIEW_DUTY), `and the role's file is not, got: ${JSON.stringify(prompt)}`);
});

test('R6 with no prompt given and no prompt file in the role, the make is refused and nothing is written', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);
  const before = await world(box, bots);
  const from = (await box.orca.calls()).length;

  const result = await make(box, planner, ['--role', 'developer', '--name', 'developer-1']);

  assertRefused(result);
  assert.deepEqual(await world(box, bots), before, 'bot.yaml, the book and Orca are as they were');
  assert.deepEqual(orcaCallsOf((await box.orca.calls()).slice(from), 'terminal create'), [], 'no tab was opened');
  await made(box, planner, ['--role', 'developer', '--name', 'developer-1', '--prompt', TASK]);
  assert.ok(await entryIn(bots, 'developer-1'), 'the same make with a prompt works');
});

// ------------------------------------------------------- R7 the book

test('R7 the book records the role and the option by name, the default option\'s name when none was named', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);

  await made(box, planner, ['--role', 'reviewer:light', '--name', 'reviewer-1', '--prompt', TASK]);
  await made(box, planner, ['--role', 'reviewer', '--name', 'reviewer-2', '--prompt', TASK]);

  const one = (await sessionIn(bots, BOT, 'reviewer-1'))?.temporary;
  assert.deepEqual(Object.keys(one ?? {}).sort(), ['made', 'maker', 'option', 'role'], `got: ${JSON.stringify(one)}`);
  assert.deepEqual({ maker: one.maker, role: one.role, option: one.option }, { maker: 'planner', role: 'reviewer', option: 'light' });
  const two = (await sessionIn(bots, BOT, 'reviewer-2'))?.temporary;
  assert.deepEqual({ role: two?.role, option: two?.option }, { role: 'reviewer', option: 'deep' }, `got: ${JSON.stringify(two)}`);
});

// ------------------------------------------------------- R8 what it says

/** The reviewer role as --json gives it back, with `option` the one used. */
const reviewerAnswer = (option, purpose) => ({
  name: 'reviewer',
  option,
  for: purpose,
  options: [
    { name: 'deep', for: 'most reviews', default: true },
    { name: 'light', for: 'small diffs', default: false },
  ],
});

test('R8 --json names the role and option used, the role\'s options, and each setting with where it came from', async (t) => {
  // reviewer:light from planner: light's harness, model and effort, a context
  // left to Codex (planner's 1m is Claude's), planner's approval.
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);

  const result = await made(box, planner, ['--role', 'reviewer:light', '--name', 'reviewer-1', '--prompt', TASK, '--json']);

  const answer = answerIn(result);
  assert.deepEqual(answer.role, reviewerAnswer('light', 'small diffs'), `got: ${result.stdout}`);
  assert.deepEqual(chosenIn(answer), {
    harness: { value: 'codex', from: 'role' },
    model: { value: 'gpt-6.1-mini', from: 'role' },
    effort: { value: 'medium', from: 'role' },
    context: { from: 'harness default' },
    approval: { value: 'ask', from: 'maker' },
  }, `got: ${result.stdout}`);
  assert.deepEqual(answer.settings, await entryIn(bots, 'reviewer-1'), 'settings is still the entry as written to bot.yaml');
});

test('R8 --json: a gap filled from the maker, a flag, and an option that names no harness are each named as such', async (t) => {
  // developer:standard from nightly, on nightly's Codex (standard names no
  // harness; nightly's own harness is its bot's), with --effort given.
  // standard gives no context, so nightly's fills it.
  const box = await createSandbox(t);
  const { nightly } = await fleet(box);

  const result = await made(box, nightly, ['--role', 'developer:standard', '--name', 'developer-1', '--prompt', TASK, '--effort', 'low', '--json']);

  const answer = answerIn(result);
  assert.deepEqual(answer.role, {
    name: 'developer',
    option: 'standard',
    for: 'most issues',
    options: [
      { name: 'standard', for: 'most issues', default: true },
      { name: 'deep', for: 'hard causes, wide changes', default: false },
    ],
  }, `got: ${result.stdout}`);
  assert.deepEqual(chosenIn(answer), {
    harness: { value: 'codex', from: 'maker' },
    model: { value: 'claude-opus-5-5', from: 'role' },
    effort: { value: 'low', from: 'flag' },
    context: { value: '200000', from: 'maker' },
    approval: { value: 'auto', from: 'maker' },
  }, `got: ${result.stdout}`);
});

test('R8 --json without --role has no role, and still says where each setting came from', async (t) => {
  const box = await createSandbox(t);
  const { planner } = await fleet(box);

  const result = await made(box, planner, ['--name', 'scout', '--prompt', TASK, '--harness', 'codex', '--effort', 'high', '--json']);

  const answer = answerIn(result);
  assert.equal('role' in answer, false, `no role was asked for, got: ${result.stdout}`);
  assert.deepEqual(chosenIn(answer), {
    harness: { value: 'codex', from: 'flag' },
    model: { from: 'harness default' },
    effort: { value: 'high', from: 'flag' },
    context: { from: 'harness default' },
    approval: { value: 'ask', from: 'maker' },
  }, `got: ${result.stdout}`);
  assert.ok(answer.settings && answer.settings.name === 'scout', `settings is still there, got: ${result.stdout}`);
});

test('R8 --json without --role, on the maker\'s harness: every setting is the maker\'s', async (t) => {
  const box = await createSandbox(t);
  const { nightly } = await fleet(box);

  const result = await made(box, nightly, ['--name', 'sweeper', '--prompt', TASK, '--json']);

  assert.deepEqual(chosenIn(answerIn(result)), {
    harness: { value: 'codex', from: 'maker' },
    model: { value: 'gpt-6-sol', from: 'maker' },
    effort: { value: 'low', from: 'maker' },
    context: { value: '200000', from: 'maker' },
    approval: { value: 'auto', from: 'maker' },
  }, `nightly's own, its harness its bot's, got: ${result.stdout}`);
});

test('R8 the plain output names the option used and its purpose, the other options, and each setting\'s value and source', async (t) => {
  const box = await createSandbox(t);
  const { planner } = await fleet(box);

  const result = await made(box, planner, ['--role', 'reviewer:light', '--name', 'reviewer-1', '--prompt', TASK]);

  const said = result.stdout;
  for (const what of [
    /\blight\b/, /small diffs/, // the option used and its purpose
    /\bdeep\b/, /most reviews/, // the role's other option, with its purpose
    /\bcodex\b/, /gpt-6\.1-mini/, /\bmedium\b/, /\bask\b/, // what each setting got
  ]) {
    assert.match(said, what, `the output should name ${what}, got:\n${said}`);
  }
  for (const source of [/\brole\b/, /\bmaker\b/, /harness default/]) {
    assert.match(said, source, `the output should say where the settings came from, got:\n${said}`);
  }
});
