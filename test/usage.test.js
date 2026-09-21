// `obk usage --bots <path> [--bot <bot>] [--session <name>] [--since <iso>]`:
// per bot and per session, the harness conversations on record and what they
// used. It is the countable half of finops: how many calls, how many tokens of
// which kind, at which models and efforts, between which two moments, and how
// many times the conversation was compacted. What any of that costs is a
// skill's to say, and a price it cannot find is a price it says it cannot find
// (ADR 0006); nothing here prices anything.
//
// It reads the harnesses' own transcripts and the kit's book. It writes
// nothing, changes nothing, never calls Orca, and ends in 0.
//
// Which conversation belongs to which session is the book's to say and is never
// guessed: a session's conversations are the one the book names for it now and
// the ones in its history. A conversation in the bot's folder that no session
// claims is reported under the bot as unclaimed, with its usage, so that its
// cost is visible rather than quietly dropped.
//
// The three things a plausible implementation gets wrong, all three measured
// live on this machine and written down in the tech notes (sections 2 and 3):
//
//   1. Codex's `total_token_usage` is the running total for the conversation.
//      Summing it double counts: one conversation that used 80,565 tokens came
//      to 200,901 that way. `last_token_usage` is the per-call figure.
//   2. The two harnesses do not mean the same thing by `input_tokens`. On
//      Claude Code it excludes the cache reads; on Codex the cached tokens are
//      inside it. A report that takes each one as it stands compares unlike
//      things, and prices Codex's cached tokens at full rate.
//   3. Claude Code writes the same call down more than once, so calls are
//      counted once per `requestId` and `message.id` pair.
//
// Every transcript here is planted in the sandbox's own home directory, where
// each harness keeps its records. Nothing reads the real `~/.claude` or
// `~/.codex`.

import assert from 'node:assert/strict';
import { mkdir, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { stringify } from 'yaml';

import {
  assertCleanFailure,
  bookOf,
  botHomeOf,
  createSandbox,
  skipOrcaFake,
  snapshot,
} from './helpers/cli.js';

/** A moment on the day these tests are set, as both harnesses write one. */
const at = (hour, minute = 0) =>
  `2026-09-20T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;

const CLAUDE_MODEL = 'claude-opus-5';
const CODEX_MODEL = 'gpt-6-astra';

// ---------------------------------------------------------------- the fleet

/** A bots folder with one bot in it, its sessions written, and nothing opened in Orca. */
async function fleet(box, { harness = 'claude', sessions = ['daily'] } = {}) {
  const init = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(init.code, 0, init.stderr);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', harness]);
  assert.equal(made.code, 0, made.stderr);
  for (const name of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', name]);
    assert.equal(added.code, 0, added.stderr);
  }
  const bots = box.path('bots');
  return { bots, home: botHomeOf(bots, 'api-bot') };
}

/**
 * The book of one bot, written as the kit writes it: per session the tab, the
 * conversation it is in now, and the ones it was in before. Written here rather
 * than earned through a run, because what this command reads is what the book
 * says, and the book saying it is the whole of the setup.
 */
const bookSays = (bots, bot, sessions) =>
  writeFile(bookOf(bots, bot), stringify({ orca: { project: 'proj-1', setup: 'setup-1' }, sessions }));

/** A session entry of the book: the conversation it is in, and the ones before it. */
const ran = (session, ...before) => ({
  tab: `tab-${session}`,
  launched: at(8),
  session,
  ...(before.length === 0 ? {} : { history: before.map((old) => ({ session: old, ended: 'clear', at: at(8, 30) })) }),
});

// ------------------------------------------------- what a harness writes down

/** One Claude Code API call, as an `assistant` line of its transcript. */
const claudeCall = ({
  when, request, message, model = CLAUDE_MODEL, effort = 'high',
  input = 0, cacheRead = 0, cacheWrite = 0, output = 0,
}) => ({
  type: 'assistant',
  timestamp: when,
  requestId: request,
  effort,
  message: {
    id: message,
    model,
    usage: {
      input_tokens: input,
      cache_read_input_tokens: cacheRead,
      cache_creation_input_tokens: cacheWrite,
      output_tokens: output,
    },
  },
});

/** Claude Code's compaction marker: the two fields, not the words. */
const claudeCompaction = (when) => ({
  type: 'system',
  subtype: 'compact_boundary',
  timestamp: when,
  compactMetadata: { trigger: 'auto', preTokens: 120000, postTokens: 20000 },
});

/** Something a person said in the conversation, which is not usage of any kind. */
const claudeSaid = (when, text) => ({ type: 'user', timestamp: when, message: { role: 'user', content: text } });

/** A Codex usage record: cached tokens inside the input, reasoning inside the output. */
const codexTokens = ({ input = 0, cached = 0, cacheWrite = 0, output = 0, reasoning = 0 }) => ({
  input_tokens: input,
  cached_input_tokens: cached,
  cache_write_input_tokens: cacheWrite,
  output_tokens: output,
  reasoning_output_tokens: reasoning,
  total_tokens: input + output,
});

/** One Codex API call: what it used, and the running total for the conversation after it. */
const codexCall = ({ when, last, total }) => ({
  timestamp: when,
  type: 'event_msg',
  payload: {
    type: 'token_count',
    info: { last_token_usage: codexTokens(last), total_token_usage: codexTokens(total), model_context_window: 190000 },
  },
});

/** What Codex was set to for the turns that follow it. */
const codexTurn = ({ when, model = CODEX_MODEL, effort = 'high' }) => ({
  timestamp: when,
  type: 'turn_context',
  payload: { model, effort, approval_policy: 'on-request' },
});

/** Codex's compaction marker: a record of its own. */
const codexCompaction = (when) => ({ timestamp: when, type: 'compacted', payload: {} });

/**
 * Plant a conversation where its harness keeps it, inside the sandbox's home.
 *
 * Claude Code files one transcript per conversation under a folder named after
 * the working directory, every character that is not a letter or a digit turned
 * into a dash. Codex files one rollout per conversation under the day it
 * started, and the rollout's first line says which folder it ran in. Both
 * measured on this machine and written down in the tech notes.
 *
 * The file's own time is set to its last line, the way a file written as the
 * conversation runs would have it.
 */
async function plant(box, harness, home, { id, started, lines }) {
  const file = harness === 'codex'
    ? path.join(
      box.home, '.codex', 'sessions', ...started.slice(0, 10).split('-'),
      `rollout-${started.replaceAll(':', '-').replace(/\..*$/, '')}-${id}.jsonl`,
    )
    : path.join(box.home, '.claude', 'projects', home.replaceAll(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);

  const first = harness === 'codex'
    ? { timestamp: started, type: 'session_meta', payload: { id, cwd: home, timestamp: started } }
    : { type: 'system', sessionId: id, cwd: home, timestamp: started };

  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, [first, ...lines].map((line) => JSON.stringify(line)).join('\n') + '\n');

  const stamps = [started, ...lines.map((line) => line.timestamp).filter((stamp) => typeof stamp === 'string')];
  const touched = new Date(Math.max(...stamps.map((stamp) => Date.parse(stamp))));
  await utimes(file, touched, touched);
  return file;
}

// ------------------------------------------------------------- what it answers

/** Run the command and answer what it said as JSON. */
async function usage(box, ...rest) {
  const result = await box.run(['usage', '--bots', 'bots', ...rest, '--json']);
  assert.equal(result.code, 0, `usage reports and never fails: ${result.stderr}`);
  assert.equal(result.stderr, '');
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  assert.ok(Array.isArray(answer.usage), `the answer should carry a list of bots, got: ${result.stdout}`);
  return answer;
}

/** The one entry about one bot. */
function entryOf(answer, bot) {
  const found = answer.usage.filter((entry) => entry.bot === bot);
  assert.equal(found.length, 1, `one entry should be about ${bot}, got: ${JSON.stringify(answer.usage)}`);
  return found[0];
}

/** The one entry about one of a bot's sessions. */
function sessionOf(entry, name) {
  const found = (entry.sessions ?? []).filter((session) => session.name === name);
  assert.equal(found.length, 1, `${entry.bot} should say one thing about ${name}, got: ${JSON.stringify(entry.sessions)}`);
  return found[0];
}

/** The one entry about one conversation, out of a session's list or a bot's unclaimed one. */
function conversationOf(list, id) {
  const found = (list ?? []).filter((one) => one.id === id);
  assert.equal(found.length, 1, `one entry should be about ${id}, got: ${JSON.stringify(list)}`);
  return found[0];
}

/** The ids a list of conversations holds, in no particular order. */
const idsOf = (list) => (list ?? []).map((one) => one.id).sort();

/** What one conversation used, by kind. */
function tokensOf(conversation) {
  const tokens = conversation.tokens;
  assert.ok(
    tokens !== null && typeof tokens === 'object',
    `a conversation should say what it used, got: ${JSON.stringify(conversation)}`,
  );
  return tokens;
}

/** A session's conversations, straight from the answer. */
const conversationsOf = (session) => {
  assert.ok(
    Array.isArray(session.conversations),
    `a session should carry its conversations as a list, got: ${JSON.stringify(session)}`,
  );
  return session.conversations;
};

// ------------------------------------------------------------------ the tests

test('U1 Claude Code: a call written down twice is counted once, per requestId and message id', async (t) => {
  // Trap three. The same call appears again in the transcript; counting the
  // lines gives three calls and 46,920 cache reads instead of two and 33,460.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  const repeated = claudeCall({
    when: at(9, 1), request: 'req-1', message: 'msg-1', input: 2, cacheRead: 13460, cacheWrite: 200, output: 500,
  });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [
      repeated,
      repeated,
      claudeCall({ when: at(9, 5), request: 'req-2', message: 'msg-2', input: 7, cacheRead: 20000, output: 300 }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const conversation = conversationOf(conversationsOf(sessionOf(entryOf(await usage(box), 'api-bot'), 'daily')), 'conv-a');

  assert.equal(conversation.calls, 2, 'two calls, though three lines carry usage');
  const tokens = tokensOf(conversation);
  assert.equal(tokens.input, 9, '2 + 7, each counted once');
  assert.equal(tokens.cache_read, 33460, '13,460 + 20,000, and not 46,920');
  assert.equal(tokens.cache_write, 200);
  assert.equal(tokens.output, 800, '500 + 300');
});

test('U1 Claude Code: input is the uncached input, beside the cache reads and the cache writes', async (t) => {
  // The line the tech notes took from a real transcript: `input_tokens: 2`
  // beside `cache_read_input_tokens: 13460`. The two are separate figures here,
  // and neither is inside the other.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [claudeCall({
      when: at(9, 1), request: 'req-1', message: 'msg-1', input: 2, cacheRead: 13460, cacheWrite: 1024, output: 77,
    })],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const tokens = tokensOf(conversationOf(
    conversationsOf(sessionOf(entryOf(await usage(box), 'api-bot'), 'daily')),
    'conv-a',
  ));

  assert.equal(tokens.input, 2, 'what the harness wrote down, which already excludes the cache reads');
  assert.equal(tokens.cache_read, 13460);
  assert.equal(tokens.cache_write, 1024);
  assert.equal(tokens.output, 77);
});

test('U1 Codex: usage is summed from last_token_usage, never from the cumulative total', async (t) => {
  // Trap one, and the one worth more than any other test here. The running
  // total after the third call is 7,000 input and 350 output; summing the three
  // totals gives 11,000 and 550, which is the conversation counted three times
  // over. Uncached input is then 7,000 - 3,900 = 3,100, and the wrong road ends
  // at 11,000 - 4,800 = 6,200.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'codex' });
  await plant(box, 'codex', home, {
    id: 'conv-c',
    started: at(9),
    lines: [
      codexTurn({ when: at(9) }),
      codexCall({
        when: at(9, 1),
        last: { input: 1000, cached: 0, output: 50, reasoning: 20 },
        total: { input: 1000, cached: 0, output: 50, reasoning: 20 },
      }),
      codexCall({
        when: at(9, 4),
        last: { input: 2000, cached: 900, output: 100, reasoning: 40 },
        total: { input: 3000, cached: 900, output: 150, reasoning: 60 },
      }),
      codexCall({
        when: at(9, 9),
        last: { input: 4000, cached: 3000, output: 200, reasoning: 80 },
        total: { input: 7000, cached: 3900, output: 350, reasoning: 140 },
      }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-c') });

  const conversation = conversationOf(
    conversationsOf(sessionOf(entryOf(await usage(box), 'api-bot'), 'daily')),
    'conv-c',
  );

  assert.equal(conversation.calls, 3);
  const tokens = tokensOf(conversation);
  assert.equal(tokens.input, 3100, '7,000 input less 3,900 cached; summing the running totals would give 6,200');
  assert.equal(tokens.cache_read, 3900, 'and not 4,800');
  assert.equal(tokens.output, 350, 'and not 550');
  assert.equal(tokens.reasoning, 140, 'which sits inside the output, as the harness writes it');
});

test('U1 Codex: cached tokens come out of the input, and the cache writes are reported beside it', async (t) => {
  // The record the tech notes took live: input 21,265, cached 20,992, output 39,
  // and 21,265 + 39 = 21,304 exactly. Uncached input is 273.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'codex' });
  await plant(box, 'codex', home, {
    id: 'conv-c',
    started: at(9),
    lines: [
      codexTurn({ when: at(9) }),
      codexCall({
        when: at(9, 1),
        last: { input: 21265, cached: 20992, cacheWrite: 512, output: 39, reasoning: 8 },
        total: { input: 21265, cached: 20992, cacheWrite: 512, output: 39, reasoning: 8 },
      }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-c') });

  const tokens = tokensOf(conversationOf(
    conversationsOf(sessionOf(entryOf(await usage(box), 'api-bot'), 'daily')),
    'conv-c',
  ));

  assert.equal(tokens.input, 273, '21,265 less the 20,992 that were cached');
  assert.equal(tokens.cache_read, 20992);
  assert.equal(tokens.cache_write, 512);
  assert.equal(tokens.output, 39);
  assert.equal(tokens.reasoning, 8);
});

test('U1 the same real usage on either harness is reported as the same figures', async (t) => {
  // Trap two, put where it bites: two conversations that really used the same
  // thing — 500 uncached input tokens on top of 9,500 read from the cache — and
  // the harnesses write that down differently. Taking each `input_tokens` as it
  // stands makes the Codex one twenty times the Claude one.
  const box = await createSandbox(t);
  const { bots } = await fleet(box, { harness: 'claude', sessions: ['daily'] });
  const madeCodex = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'codex-bot', '--harness', 'codex']);
  assert.equal(madeCodex.code, 0, madeCodex.stderr);
  const addedCodex = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'codex-bot', '--name', 'daily']);
  assert.equal(addedCodex.code, 0, addedCodex.stderr);

  await plant(box, 'claude', botHomeOf(bots, 'api-bot'), {
    id: 'conv-a',
    started: at(9),
    lines: [claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 500, cacheRead: 9500, output: 100 })],
  });
  await plant(box, 'codex', botHomeOf(bots, 'codex-bot'), {
    id: 'conv-c',
    started: at(9),
    lines: [
      codexTurn({ when: at(9) }),
      codexCall({
        when: at(9, 1),
        last: { input: 10000, cached: 9500, output: 100 },
        total: { input: 10000, cached: 9500, output: 100 },
      }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });
  await bookSays(bots, 'codex-bot', { daily: ran('conv-c') });

  const answer = await usage(box);
  const claude = tokensOf(conversationOf(
    conversationsOf(sessionOf(entryOf(answer, 'api-bot'), 'daily')),
    'conv-a',
  ));
  const codex = tokensOf(conversationOf(
    conversationsOf(sessionOf(entryOf(answer, 'codex-bot'), 'daily')),
    'conv-c',
  ));

  assert.equal(claude.input, 500);
  assert.equal(codex.input, 500, 'the Codex figure is 10,000 less the 9,500 that were cached, not 10,000');
  assert.equal(codex.cache_read, 9500);
  assert.deepEqual(codex, claude, 'the same usage, in the same unit, whichever harness it ran on');
});

test('U2 a conversation says when its first and its last counted call were', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [
      claudeCall({ when: at(9, 12), request: 'req-1', message: 'msg-1', input: 5, output: 5 }),
      claudeCall({ when: at(10, 30), request: 'req-2', message: 'msg-2', input: 5, output: 5 }),
      claudeCall({ when: at(9, 40), request: 'req-3', message: 'msg-3', input: 5, output: 5 }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const conversation = conversationOf(
    conversationsOf(sessionOf(entryOf(await usage(box), 'api-bot'), 'daily')),
    'conv-a',
  );

  assert.equal(Date.parse(conversation.first), Date.parse(at(9, 12)), `got: ${conversation.first}`);
  assert.equal(Date.parse(conversation.last), Date.parse(at(10, 30)), `got: ${conversation.last}`);
});

test('U2 the models and the efforts a Claude conversation ran at are all reported', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [
      claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', model: 'claude-opus-5', effort: 'high', input: 1, output: 1 }),
      claudeCall({ when: at(9, 5), request: 'req-2', message: 'msg-2', model: 'claude-sonnet-5', effort: 'low', input: 1, output: 1 }),
      claudeCall({ when: at(9, 7), request: 'req-3', message: 'msg-3', model: 'claude-sonnet-5', effort: 'low', input: 1, output: 1 }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const conversation = conversationOf(
    conversationsOf(sessionOf(entryOf(await usage(box), 'api-bot'), 'daily')),
    'conv-a',
  );

  assert.deepEqual([...conversation.models].sort(), ['claude-opus-5', 'claude-sonnet-5'], 'each model once');
  assert.deepEqual([...conversation.efforts].sort(), ['high', 'low']);
});

test('U2 the models and the efforts a Codex conversation ran at are all reported', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'codex' });
  await plant(box, 'codex', home, {
    id: 'conv-c',
    started: at(9),
    lines: [
      codexTurn({ when: at(9), model: 'gpt-6-astra', effort: 'high' }),
      codexCall({ when: at(9, 1), last: { input: 10, output: 1 }, total: { input: 10, output: 1 } }),
      codexTurn({ when: at(9, 3), model: 'gpt-6-mini', effort: 'low' }),
      codexCall({ when: at(9, 4), last: { input: 10, output: 1 }, total: { input: 20, output: 2 } }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-c') });

  const conversation = conversationOf(
    conversationsOf(sessionOf(entryOf(await usage(box), 'api-bot'), 'daily')),
    'conv-c',
  );

  assert.deepEqual([...conversation.models].sort(), ['gpt-6-astra', 'gpt-6-mini']);
  assert.deepEqual([...conversation.efforts].sort(), ['high', 'low']);
});

test('U3 Claude Code compactions are counted by the marker, not by the word', async (t) => {
  // The tech notes measured this: of fifteen transcripts holding the string,
  // thirteen were only conversations talking about compaction. The two fields
  // are what a marker is.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [
      claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 1, output: 1 }),
      claudeCompaction(at(9, 2)),
      claudeSaid(at(9, 3), 'what does subtype compact_boundary in compactMetadata mean?'),
      claudeCall({ when: at(9, 4), request: 'req-2', message: 'msg-2', input: 1, output: 1 }),
      claudeCompaction(at(9, 6)),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const conversation = conversationOf(
    conversationsOf(sessionOf(entryOf(await usage(box), 'api-bot'), 'daily')),
    'conv-a',
  );

  assert.equal(conversation.compactions, 2, 'two markers; the line that merely says the words is not one');
  assert.equal(conversation.calls, 2, 'and neither a marker nor a person talking is a call');
});

test('U3 Codex compactions are counted, and a conversation with none says none', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'codex', sessions: ['daily', 'review'] });
  await plant(box, 'codex', home, {
    id: 'conv-c',
    started: at(9),
    lines: [
      codexTurn({ when: at(9) }),
      codexCall({ when: at(9, 1), last: { input: 10, output: 1 }, total: { input: 10, output: 1 } }),
      codexCompaction(at(9, 2)),
      codexCompaction(at(9, 8)),
    ],
  });
  await plant(box, 'codex', home, {
    id: 'conv-d',
    started: at(10),
    lines: [
      codexTurn({ when: at(10) }),
      codexCall({ when: at(10, 1), last: { input: 10, output: 1 }, total: { input: 10, output: 1 } }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-c'), review: ran('conv-d') });

  const entry = entryOf(await usage(box), 'api-bot');

  assert.equal(
    conversationOf(conversationsOf(sessionOf(entry, 'daily')), 'conv-c').compactions,
    2,
  );
  assert.equal(
    conversationOf(conversationsOf(sessionOf(entry, 'review')), 'conv-d').compactions,
    0,
    'none is a number, not a missing figure',
  );
});

test('U4 a session\'s conversations are the one the book names now and the ones in its history', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  for (const id of ['conv-old', 'conv-older', 'conv-now']) {
    await plant(box, 'claude', home, {
      id,
      started: at(9),
      lines: [claudeCall({ when: at(9, 1), request: `req-${id}`, message: `msg-${id}`, input: 3, output: 4 })],
    });
  }
  await bookSays(bots, 'api-bot', { daily: ran('conv-now', 'conv-older', 'conv-old') });

  const session = sessionOf(entryOf(await usage(box), 'api-bot'), 'daily');

  assert.deepEqual(idsOf(conversationsOf(session)), ['conv-now', 'conv-old', 'conv-older']);
  assert.equal(tokensOf(conversationOf(conversationsOf(session), 'conv-old')).input, 3, 'each one counted in its own right');
});

test('U4 a conversation of the bot\'s folder that no session claims is reported under the bot, with its usage', async (t) => {
  // Its cost is real. Dropping it because nothing says whose it was would make
  // the day's figures quietly short.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-now',
    started: at(9),
    lines: [claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 3, output: 4 })],
  });
  await plant(box, 'claude', home, {
    id: 'conv-nobodys',
    started: at(11),
    lines: [claudeCall({ when: at(11, 1), request: 'req-9', message: 'msg-9', input: 640, cacheRead: 55, output: 21 })],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-now') });

  const entry = entryOf(await usage(box), 'api-bot');

  assert.deepEqual(idsOf(conversationsOf(sessionOf(entry, 'daily'))), ['conv-now'], 'the session keeps only what the book gave it');
  assert.deepEqual(idsOf(entry.unclaimed), ['conv-nobodys'], 'and the other one is the bot\'s, unclaimed');
  const tokens = tokensOf(conversationOf(entry.unclaimed, 'conv-nobodys'));
  assert.equal(tokens.input, 640, 'reported with what it used, not merely named');
  assert.equal(tokens.cache_read, 55);
  assert.equal(tokens.output, 21);
});

test('U4 a conversation any session of the bot ever had is never unclaimed', async (t) => {
  // The other half of the pair above: what is in one session's history belongs
  // to that session, and must not be counted a second time under the bot.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude', sessions: ['daily', 'review'] });
  for (const id of ['conv-a', 'conv-b', 'conv-c']) {
    await plant(box, 'claude', home, {
      id,
      started: at(9),
      lines: [claudeCall({ when: at(9, 1), request: `req-${id}`, message: `msg-${id}`, input: 1, output: 1 })],
    });
  }
  await bookSays(bots, 'api-bot', { daily: ran('conv-a', 'conv-b'), review: ran('conv-c') });

  const entry = entryOf(await usage(box), 'api-bot');

  assert.deepEqual(idsOf(conversationsOf(sessionOf(entry, 'daily'))), ['conv-a', 'conv-b']);
  assert.deepEqual(idsOf(conversationsOf(sessionOf(entry, 'review'))), ['conv-c']);
  assert.deepEqual(entry.unclaimed ?? [], [], 'every conversation on record has an owner, so nothing is unclaimed');
});

test('U5 --since counts the calls made since that moment and leaves the earlier ones out', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [
      claudeCall({ when: at(9, 0), request: 'req-1', message: 'msg-1', input: 100, cacheRead: 7, output: 11 }),
      claudeCall({ when: at(11, 0), request: 'req-2', message: 'msg-2', input: 25, cacheRead: 3, output: 4 }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const conversation = conversationOf(
    conversationsOf(sessionOf(entryOf(await usage(box, '--since', at(10)), 'api-bot'), 'daily')),
    'conv-a',
  );

  assert.equal(conversation.calls, 1);
  assert.equal(tokensOf(conversation).input, 25, 'only the call inside the window');
  assert.equal(tokensOf(conversation).cache_read, 3);
  assert.equal(tokensOf(conversation).output, 4);
  assert.equal(Date.parse(conversation.first), Date.parse(at(11)), 'and the first counted call is that one');
});

test('U5 --since is about the calls, so a conversation that began before it still counts', async (t) => {
  // "What has happened since the last grooming" is a question about calls. A
  // filter on when a conversation began drops a long-running one entirely, and
  // with it everything it has spent all morning.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-long',
    started: at(8),
    lines: [
      claudeCall({ when: at(8, 5), request: 'req-1', message: 'msg-1', input: 1000, output: 1000 }),
      claudeCall({ when: at(11, 0), request: 'req-2', message: 'msg-2', input: 42, output: 13 }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-long') });

  const conversation = conversationOf(
    conversationsOf(sessionOf(entryOf(await usage(box, '--since', at(10)), 'api-bot'), 'daily')),
    'conv-long',
  );

  assert.equal(conversation.calls, 1, 'the conversation began at 08:00 and is still reported');
  assert.equal(tokensOf(conversation).input, 42);
  assert.equal(tokensOf(conversation).output, 13);
});

test('U5 --since leaves out a conversation with no calls in the window', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-quiet',
    started: at(8),
    lines: [claudeCall({ when: at(8, 5), request: 'req-1', message: 'msg-1', input: 1000, output: 1000 })],
  });
  await plant(box, 'claude', home, {
    id: 'conv-busy',
    started: at(11),
    lines: [claudeCall({ when: at(11, 5), request: 'req-2', message: 'msg-2', input: 9, output: 9 })],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-busy', 'conv-quiet') });

  const session = sessionOf(entryOf(await usage(box, '--since', at(10)), 'api-bot'), 'daily');

  assert.deepEqual(idsOf(conversationsOf(session)), ['conv-busy'], 'the quiet one is left out, not reported as zero');
});

test('U5 without --since everything on record is counted', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(8),
    lines: [
      claudeCall({ when: at(8, 5), request: 'req-1', message: 'msg-1', input: 1000, output: 30 }),
      claudeCall({ when: at(11, 0), request: 'req-2', message: 'msg-2', input: 42, output: 13 }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const conversation = conversationOf(
    conversationsOf(sessionOf(entryOf(await usage(box), 'api-bot'), 'daily')),
    'conv-a',
  );

  assert.equal(conversation.calls, 2);
  assert.equal(tokensOf(conversation).input, 1042);
  assert.equal(tokensOf(conversation).output, 43);
});

test('U6 --bot reports the one bot named and no other', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await fleet(box, { harness: 'claude' });

  const answer = await usage(box, '--bot', 'api-bot');

  assert.deepEqual(answer.usage.map((entry) => entry.bot), ['api-bot']);
  assert.equal(bots, box.path('bots'));
});

test('U6 --session reports the one session named and no other', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude', sessions: ['daily', 'review'] });
  await plant(box, 'claude', home, {
    id: 'conv-r',
    started: at(9),
    lines: [claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 6, output: 2 })],
  });
  await plant(box, 'claude', home, {
    id: 'conv-d',
    started: at(9),
    lines: [claudeCall({ when: at(9, 1), request: 'req-2', message: 'msg-2', input: 6, output: 2 })],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-d'), review: ran('conv-r') });

  const entry = entryOf(await usage(box, '--bot', 'api-bot', '--session', 'review'), 'api-bot');

  assert.deepEqual((entry.sessions ?? []).map((session) => session.name), ['review']);
  assert.deepEqual(idsOf(conversationsOf(sessionOf(entry, 'review'))), ['conv-r']);
});

test('U6 a session that has never run is reported with no conversations, not left out', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude', sessions: ['daily', 'review'] });
  await plant(box, 'claude', home, {
    id: 'conv-d',
    started: at(9),
    lines: [claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 6, output: 2 })],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-d') });

  const entry = entryOf(await usage(box), 'api-bot');

  assert.deepEqual((entry.sessions ?? []).map((session) => session.name), ['daily', 'review']);
  assert.deepEqual(conversationsOf(sessionOf(entry, 'review')), [], 'it is there, with nothing on record');
  assert.deepEqual(idsOf(conversationsOf(sessionOf(entry, 'daily'))), ['conv-d']);
});

test('U7 a bot that is not there is refused, and the bots there are named', async (t) => {
  const box = await createSandbox(t);
  await fleet(box, { harness: 'claude' });

  const result = await box.run(['usage', '--bots', 'bots', '--bot', 'no-such-bot']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('no-such-bot'), `the refusal should name what was asked for, got: ${result.stderr}`);
  for (const there of ['api-bot', 'bot-father']) {
    assert.ok(result.stderr.includes(there), `and say which bots there are, got: ${result.stderr}`);
  }
});

test('U7 usage without --bots is refused and says so', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['usage']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('--bots'), `should name --bots, got: ${result.stderr}`);
});

test('U8 it reads and nothing else: nothing on disk moves and Orca is asked nothing', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 5, output: 5 })],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });
  const before = await snapshot(box.root, skipOrcaFake);
  const calls = (await box.orca.calls()).length;

  const result = await box.run(['usage', '--bots', 'bots']);

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await snapshot(box.root, skipOrcaFake), before, 'a usage report changes nothing, anywhere');
  assert.equal((await box.orca.calls()).length, calls, 'and it does not talk to Orca');
});

test('U8 an Orca that is down is nothing to it', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 5, output: 5 })],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });
  await box.orca.set({ reachable: false });

  const answer = await usage(box);

  assert.deepEqual(idsOf(conversationsOf(sessionOf(entryOf(answer, 'api-bot'), 'daily'))), ['conv-a']);
});

test('U8 --json answers with bots as the resolved absolute path', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await fleet(box, { harness: 'claude' });

  const answer = await usage(box);

  assert.equal(answer.bots, bots, '--bots was given as a relative path and comes back resolved');
  assert.equal(path.isAbsolute(answer.bots), true);
});

test('U8 the plain report names the facts the answer carries', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-mine',
    started: at(9),
    lines: [claudeCall({
      when: at(9, 1), request: 'req-1', message: 'msg-1', model: 'claude-opus-5', effort: 'high',
      input: 507, cacheRead: 907, output: 311,
    })],
  });
  await plant(box, 'claude', home, {
    id: 'conv-nobodys',
    started: at(11),
    lines: [claudeCall({ when: at(11, 1), request: 'req-9', message: 'msg-9', input: 13, output: 17 })],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-mine') });

  const result = await box.run(['usage', '--bots', 'bots']);

  assert.equal(result.code, 0, result.stderr);
  for (const fact of ['api-bot', 'daily', 'conv-mine', 'conv-nobodys', 'claude-opus-5', 'high', '507', '907', '311']) {
    assert.ok(result.stdout.includes(fact), `the report should name ${fact}, got:\n${result.stdout}`);
  }
  assert.ok(!result.stdout.includes('undefined'), `nothing should be undefined, got:\n${result.stdout}`);
});

test('U6 every bot in the folder is reported, and the plain report names them all', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 5, output: 5 })],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const plain = await box.run(['usage', '--bots', 'bots']);
  const asJson = await box.run(['usage', '--bots', 'bots', '--json']);

  assert.equal(plain.code, 0, plain.stderr);
  assert.equal(asJson.code, 0, asJson.stderr);
  assert.equal(
    JSON.parse(asJson.stdout).usage.length,
    2,
    `both bots are in the answer, got: ${asJson.stdout}`,
  );
  for (const fact of ['api-bot', 'bot-father', 'conv-a']) {
    assert.ok(plain.stdout.includes(fact), `the plain report should name ${fact} too, got:\n${plain.stdout}`);
  }
});
