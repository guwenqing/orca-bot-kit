// A bots folder seeded by the previous slice has a `bot.yaml` with no harness
// and no sessions, and `init` used to skip a file that was already there — so
// the folder came out with no daily session and no later `up` could give it
// one. `init` now completes such a file instead of walking past it.
//
// Completing is not rewriting. Only the missing keys are added; the user's own
// keys, values, comments and ordering all survive, and a `sessions` list that
// already holds something is left completely alone — those sessions are the
// user's, and `up` brings up what is there.
//
// A file it cannot make sense of is refused rather than guessed at.

import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import {
  assertCleanFailure,
  bookOf,
  botFatherTabs,
  createSandbox,
  snapshot,
  TAB_TITLES,
  typedInto,
} from './helpers/cli.js';

/** `bot.yaml` exactly as the slice before this one wrote it: no harness, no sessions. */
const PREVIOUS_SLICE = `# Bot Father runs the fleet. Ask it for changes rather than editing this file.

name: bot-father
charter: |
  Bot Father owns the fleet.
rules: []
skills: []
sessions: []
`;

/**
 * A bots folder as the slice before this one left it: the seed files and a git
 * repo, a `bot.yaml` that knows nothing about harnesses or sessions, no book,
 * and nothing of it in Orca.
 */
async function seededByThePreviousSlice(box, contents = PREVIOUS_SLICE) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  await writeFile(botFile(box), contents);
  await rm(bookOf(box.path('bots')));
  await box.orca.set({ setups: [], terminals: [] });
  return botFile(box);
}

const botFile = (box) => box.path('bots', 'bots', 'bot-father', 'bot.yaml');

/** The name of each session in a bot.yaml, whether written as a string or a mapping. */
const sessionNames = (parsed) => (parsed.sessions ?? []).map((session) => (
  typeof session === 'string' ? session : session?.name
));

/**
 * A file's lines, with runs of whitespace collapsed and blanks dropped: what
 * each line says, without caring how it was spaced out.
 */
const lines = (text) => text.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter((line) => line !== '');

/** The top-level keys of a YAML mapping, in the order they are written. */
const keyOrder = (text) => text
  .split('\n')
  .map((line) => /^([A-Za-z_][\w-]*):/.exec(line)?.[1])
  .filter((key) => key !== undefined);

test('a bots folder from the previous slice gets its harness and its daily session', async (t) => {
  const box = await createSandbox(t);
  const file = await seededByThePreviousSlice(box);

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assert.equal(result.code, 0, result.stderr);
  const parsed = parse(await readFile(file, 'utf8'));
  assert.equal(parsed.harness, 'claude', 'the harness the caller chose is written down');
  assert.deepEqual(sessionNames(parsed), ['daily']);

  // And the whole point of it: Bot Father is really there afterwards.
  const { inBook, leftovers, terminals } = await botFatherTabs(box, box.path('bots'));
  assert.equal(terminals.length, 2, `a daily tab and a plain one, got ${JSON.stringify(terminals)}`);
  assert.equal(inBook.length, 1);
  assert.equal(inBook[0].title, TAB_TITLES.daily);
  assert.deepEqual(typedInto(inBook[0]), ['claude']);
  assert.equal(leftovers.length, 1);
});

test('a folder completed by init needs nothing more from up', async (t) => {
  const box = await createSandbox(t);
  await seededByThePreviousSlice(box);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'codex'])).code, 0);
  const after = await box.orca.terminals();

  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);

  assert.deepEqual(await box.orca.terminals(), after, 'the second run has nothing left to do');
});

test('completing a bot.yaml touches nothing else in it', async (t) => {
  const box = await createSandbox(t);
  const mine = `# my own notes about this bot
name: bot-father
charter: |
  Mine, and unchanged.
notes: keep me            # a key the kit knows nothing about
rules: [my-rule]
skills: []
`;
  const file = await seededByThePreviousSlice(box, mine);

  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'codex'])).code, 0);

  const after = await readFile(file, 'utf8');
  for (const comment of ['# my own notes about this bot', '# a key the kit knows nothing about']) {
    assert.ok(after.includes(comment), `the comment "${comment}" should have survived: ${after}`);
  }
  const parsed = parse(after);
  assert.equal(parsed.notes, 'keep me', 'a key the kit knows nothing about keeps its value');
  assert.equal(parsed.charter, 'Mine, and unchanged.\n');
  assert.deepEqual(parsed.rules, ['my-rule']);
  assert.equal(parsed.harness, 'codex');
  assert.deepEqual(sessionNames(parsed), ['daily']);

  // The keys that were there keep the order the user put them in.
  const before = keyOrder(mine);
  assert.deepEqual(keyOrder(after).filter((key) => before.includes(key)), before);
});

test('a bot.yaml with no sessions key at all gets the daily session', async (t) => {
  const box = await createSandbox(t);
  const file = await seededByThePreviousSlice(box, 'name: bot-father\ncharter: mine\nrules: []\nskills: []\n');

  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);

  const parsed = parse(await readFile(file, 'utf8'));
  assert.deepEqual(sessionNames(parsed), ['daily']);
  assert.equal((await botFatherTabs(box, box.path('bots'))).inBook.length, 1);
});

test('a bot.yaml that already has sessions is left completely alone', async (t) => {
  const box = await createSandbox(t);
  const mine = 'name: bot-father\ncharter: mine\nrules: []\nskills: []\nsessions:\n  - name: mine\n';
  const file = await seededByThePreviousSlice(box, mine);

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assert.equal(result.code, 0, result.stderr);
  // The harness has to go in somewhere, so the file is not byte-identical.
  // What must hold is that every line the user wrote is still there, saying
  // what it said, in the order they wrote it. Only the spacing may be reflowed.
  const after = await readFile(file, 'utf8');
  const before = lines(mine);
  assert.deepEqual(
    lines(after).filter((line) => before.includes(line)),
    before,
    `the user's own lines should be untouched: ${after}`,
  );
  const parsed = parse(after);
  assert.deepEqual(sessionNames(parsed), ['mine'], 'the user\'s sessions are the user\'s');
  assert.equal(parsed.harness, 'claude');

  // And `up` brings up what is written there, not a daily session of its own.
  const { inBook, terminals } = await botFatherTabs(box, box.path('bots'));
  assert.equal(inBook.length, 1);
  assert.equal(terminals.length, 2);
  assert.deepEqual(typedInto(inBook[0]), ['claude']);
  assert.ok(!inBook[0].title.includes('daily'), `the session is the user's, got: ${inBook[0].title}`);
});

for (const [label, contents] of [
  ['a list', '- one\n- two\n'],
  ['a line of text', 'just some text\n'],
  ['a number', '42\n'],
]) {
  test(`a bot.yaml that is ${label} is refused, and nothing is written`, async (t) => {
    const box = await createSandbox(t);
    const file = await seededByThePreviousSlice(box, contents);
    const before = await snapshot(box.path('bots'));

    const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

    assertCleanFailure(result);
    assert.ok(result.stderr.includes('bot.yaml'), `should name the file, got: ${result.stderr}`);
    assert.equal(await readFile(file, 'utf8'), contents, 'the file must not be touched');
    assert.deepEqual(await snapshot(box.path('bots')), before, 'and nothing else either');
    assert.deepEqual(await box.orca.terminals(), [], 'and no tab is opened');
  });
}

test('a bot.yaml whose sessions is not a list is refused', async (t) => {
  const box = await createSandbox(t);
  const contents = 'name: bot-father\ncharter: mine\nrules: []\nskills: []\nsessions: daily\n';
  const file = await seededByThePreviousSlice(box, contents);

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('sessions'), `should say what is wrong, got: ${result.stderr}`);
  assert.equal(await readFile(file, 'utf8'), contents, 'the file must not be touched');
  assert.deepEqual(await box.orca.terminals(), []);
});

test('a bot.yaml naming the other harness is still refused, and nothing is completed', async (t) => {
  const box = await createSandbox(t);
  const contents = 'name: bot-father\nharness: codex\ncharter: mine\nrules: []\nskills: []\nsessions: []\n';
  const file = await seededByThePreviousSlice(box, contents);

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assertCleanFailure(result);
  assert.equal(await readFile(file, 'utf8'), contents, 'a refusal completes nothing');
  assert.deepEqual(await box.orca.terminals(), []);
});

test('the report tells a file that was completed from one that was created', async (t) => {
  const box = await createSandbox(t);
  const fresh = await box.run(['init', '--bots', 'fresh', '--harness', 'claude', '--json']);
  assert.equal(fresh.code, 0, fresh.stderr);
  const first = JSON.parse(fresh.stdout);
  assert.deepEqual(first.completed, [], 'a first init completes nothing: it writes the file itself');
  assert.ok(first.created.includes('bots/bot-father/bot.yaml'), `should have created it: ${fresh.stdout}`);

  await seededByThePreviousSlice(box);
  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude', '--json']);

  assert.equal(result.code, 0, result.stderr);
  const answer = JSON.parse(result.stdout);
  assert.deepEqual(answer.completed, ['bots/bot-father/bot.yaml'], `should say what it completed: ${result.stdout}`);
  assert.ok(
    !answer.created.includes('bots/bot-father/bot.yaml'),
    `a file that was already there was not created: ${result.stdout}`,
  );
});

test('the plain report names the file it completed', async (t) => {
  const box = await createSandbox(t);
  await seededByThePreviousSlice(box);

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assert.equal(result.code, 0, result.stderr);
  assert.ok(
    result.stdout.includes(path.join('bots', 'bot-father', 'bot.yaml')),
    `should name the file it completed, got: ${result.stdout}`,
  );
});
