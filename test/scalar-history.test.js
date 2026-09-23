// A book edited by hand, with one old conversation typed as a plain string
// (#173; the README says the book may be edited by hand).
//
// The kit writes a session's history as a list of `{ session, ended, at }`.
// A person who writes one id down by hand will as often write
//
//     history: old-conv-1
//
// and that is to be read as what it says: one earlier conversation, called
// old-conv-1. Not an entry per character, and not a crash, in any command that
// reads the history.
//
// Each test has the list form beside it as the contrast, where one helps: what
// the kit writes itself keeps behaving as it does today.

import assert from 'node:assert/strict';
import { mkdir, readFile, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import {
  bookOf,
  botHomeOf,
  createSandbox,
  recordSession,
  sessionIn,
} from './helpers/cli.js';

/** What a person types for one old conversation, and what the kit writes for one. */
const SCALAR = 'old-conv-1';
const LISTED = [{ session: 'old-conv-1', ended: 'clear', at: '2026-09-20T08:30:00.000Z' }];

/**
 * api-bot (claude, session daily) brought up, its conversation `conv-now` in
 * the book, and its history then set to `history` by hand.
 */
async function withHistory(box, history) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily'])).code, 0);
  const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);
  assert.equal(up.code, 0, up.stderr);
  const bots = box.path('bots');
  const tab = (await sessionIn(bots, 'api-bot', 'daily')).tab;
  const recorded = await recordSession(box, { bots, bot: 'api-bot', tab, session: 'conv-now' });
  assert.equal(recorded.code, 0, recorded.stderr);

  const file = bookOf(bots, 'api-bot');
  const book = parse(await readFile(file, 'utf8'));
  book.sessions.daily.history = history;
  await writeFile(file, stringify(book));
  if (history === SCALAR) {
    assert.match(await readFile(file, 'utf8'), /history: old-conv-1\n/, 'the book holds the id as a plain string');
  }
  return { bots, tab };
}

/** The ids an answer's history holds, whether it gives them as strings or as entries. */
const idsIn = (history) => (history ?? []).map((was) => (typeof was === 'string' ? was : was?.session));

/** A Claude Code conversation planted where the harness files it for `home`, with one call in it. */
async function plantClaude(box, home, id) {
  const file = path.join(box.home, '.claude', 'projects', home.replaceAll(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  const when = '2026-09-20T09:01:00.000Z';
  const lines = [
    { type: 'system', sessionId: id, cwd: home, timestamp: '2026-09-20T09:00:00.000Z' },
    {
      type: 'assistant',
      timestamp: when,
      requestId: `req-${id}`,
      effort: 'high',
      message: {
        id: `msg-${id}`,
        model: 'claude-opus-5',
        usage: { input_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 4 },
      },
    },
  ];
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
  await utimes(file, new Date(when), new Date(when));
}

/** A command's `--json` answer, with a clean exit and nothing on stderr. */
function answerOf(result) {
  assert.equal(result.stderr, '', `nothing on stderr, got: ${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
}

// ------------------------------------------------------------------ roster

for (const [label, history] of [['typed as a plain string', SCALAR], ['written as the kit writes it', LISTED]]) {
  test(`SH1 roster --json reports the one earlier conversation when history is ${label}`, async (t) => {
    const box = await createSandbox(t);
    await withHistory(box, history);

    const result = await box.run(['roster', '--bots', 'bots', '--bot', 'api-bot', '--json']);

    assert.equal(result.code, 0, result.stderr);
    const [entry] = answerOf(result).roster;
    const daily = entry.sessions.find((one) => one.name === 'daily');
    assert.equal(daily.book.session, 'conv-now');
    assert.deepEqual(idsIn(daily.book.history), ['old-conv-1'], `one earlier conversation, got: ${JSON.stringify(daily.book.history)}`);
  });
}

test('SH1 the plain roster runs on a hand-typed history and names the old conversation', async (t) => {
  const box = await createSandbox(t);
  await withHistory(box, SCALAR);

  const result = await box.run(['roster', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.ok(result.stdout.includes('old-conv-1'), `the report should name old-conv-1, got:\n${result.stdout}`);
  assert.ok(!result.stdout.includes('undefined'), `nothing should be undefined, got:\n${result.stdout}`);
});

// ------------------------------------------------------------------ usage

test('SH2 usage counts a hand-typed old conversation as the session\'s, not as unclaimed', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await withHistory(box, SCALAR);
  const home = botHomeOf(bots, 'api-bot');
  for (const id of ['old-conv-1', 'conv-now', 'conv-nobodys']) await plantClaude(box, home, id);

  const result = await box.run(['usage', '--bots', 'bots', '--bot', 'api-bot', '--json']);

  assert.equal(result.code, 0, result.stderr);
  const entry = answerOf(result).usage.find((one) => one.bot === 'api-bot');
  const daily = entry.sessions.find((one) => one.name === 'daily');
  assert.deepEqual(
    daily.conversations.map((one) => one.id).sort(),
    ['conv-now', 'old-conv-1'],
    'the conversation it is in, and the one typed into its history',
  );
  assert.deepEqual((entry.unclaimed ?? []).map((one) => one.id), ['conv-nobodys'], 'only the one no session names is unclaimed');
});

// ------------------------------------------------------------------ the hook

test('SH3 a new conversation reported by the hook puts the current one after the hand-typed one', async (t) => {
  const box = await createSandbox(t);
  const { bots, tab } = await withHistory(box, SCALAR);

  const recorded = await recordSession(box, { bots, bot: 'api-bot', tab, session: 'conv-next', source: 'clear' });

  assert.equal(recorded.code, 0, recorded.stderr);
  const entry = await sessionIn(bots, 'api-bot', 'daily');
  assert.equal(entry.session, 'conv-next');
  assert.deepEqual(idsIn(entry.history), ['old-conv-1', 'conv-now'], `in that order, got: ${JSON.stringify(entry.history)}`);
});

test('SH3 the same with a history the kit wrote itself, as today', async (t) => {
  const box = await createSandbox(t);
  const { bots, tab } = await withHistory(box, LISTED);

  const recorded = await recordSession(box, { bots, bot: 'api-bot', tab, session: 'conv-next', source: 'clear' });

  assert.equal(recorded.code, 0, recorded.stderr);
  const entry = await sessionIn(bots, 'api-bot', 'daily');
  assert.deepEqual(idsIn(entry.history), ['old-conv-1', 'conv-now']);
  assert.deepEqual(entry.history[0], LISTED[0], 'the entry the kit wrote is kept as it was');
});

// ------------------------------------------------------------------ health

test('SH4 health does not call a hand-typed old conversation unnamed, and still reports one the book never names', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await withHistory(box, SCALAR);
  const home = botHomeOf(bots, 'api-bot');
  for (const id of ['old-conv-1', 'conv-now', 'conv-nobodys']) await plantClaude(box, home, id);

  const result = await box.run(['health', '--bots', 'bots', '--bot', 'api-bot', '--json']);

  const { found } = answerOf(result);
  const words = found.map((one) => `${one.where} ${one.says}`).join('\n');
  assert.ok(!words.includes('old-conv-1'), `old-conv-1 is in the book, got:\n${words}`);
  assert.ok(words.includes('conv-nobodys'), `the contrast: a conversation the book never names is still reported, got:\n${words}`);
});

// ------------------------------------------------------------------ the same family

/**
 * The other ways a person writes a history by hand, each with the earlier
 * conversations it means. YAML reads `12345` as a number; the id is still the
 * text they typed.
 */
const HAND_EDITS = [
  ['an empty string', '', []],
  ['a number', 12345, ['12345']],
  ['one entry without the list around it', { session: 'old-conv-1' }, ['old-conv-1']],
];

for (const [label, history, meant] of HAND_EDITS) {
  test(`SH5 roster and usage read a history written as ${label}, and neither crashes`, async (t) => {
    const box = await createSandbox(t);
    const { bots } = await withHistory(box, history);
    const home = botHomeOf(bots, 'api-bot');
    for (const id of ['conv-now', ...meant]) await plantClaude(box, home, id);

    const roster = await box.run(['roster', '--bots', 'bots', '--bot', 'api-bot', '--json']);
    const usage = await box.run(['usage', '--bots', 'bots', '--bot', 'api-bot', '--json']);

    assert.equal(roster.code, 0, roster.stderr);
    const daily = answerOf(roster).roster[0].sessions.find((one) => one.name === 'daily');
    assert.deepEqual(idsIn(daily.book.history).map(String), meant, `roster, got: ${JSON.stringify(daily.book.history)}`);

    assert.equal(usage.code, 0, usage.stderr);
    const entry = answerOf(usage).usage.find((one) => one.bot === 'api-bot');
    const conversations = entry.sessions.find((one) => one.name === 'daily').conversations.map((one) => one.id);
    assert.deepEqual(conversations.sort(), ['conv-now', ...meant].sort(), 'usage gives the session what its history means');
    assert.deepEqual(entry.unclaimed ?? [], [], 'and nothing is left over as unclaimed');
  });
}
