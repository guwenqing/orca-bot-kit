// `obk usage --bots <path> [--bot <bot>] [--session <name>] [--since <iso>]`:
// per bot and per session, the harness conversations on record and what they
// used. It is the countable half of finops: how many calls, how many tokens of
// which kind, at which models and efforts, between which two moments, and how
// many times the conversation was compacted. What any of that costs is a
// skill's to say, and a price it cannot find is a price it says it cannot find
// (ADR 0016); nothing here prices anything.
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
import { chmod, mkdir, readFile, stat, symlink, utimes, writeFile } from 'node:fs/promises';
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

/** Run the command against the one bots folder most of these tests have. */
const usage = (box, ...rest) => usageIn(box, 'bots', ...rest);

/** Run the command against a named bots folder and answer what it said as JSON. */
async function usageIn(box, folder, ...rest) {
  const result = await box.run(['usage', '--bots', folder, ...rest, '--json']);
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

// --until closes the window (issue #169). A grooming run fixes the end of its
// window before it reads and hands that moment on as the next run's start, so
// the window is half-open: at or after --since, and before --until. Two runs
// that meet at one moment then count every call once between them.

/** The daily session's conversations, over the window the flags name. */
const dailyOver = async (box, ...window) =>
  conversationsOf(sessionOf(entryOf(await usage(box, ...window), 'api-bot'), 'daily'));

test('U13 a call exactly at --since is counted and one exactly at --until is not', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [
      claudeCall({ when: at(9, 59), request: 'req-1', message: 'msg-1', input: 1000, output: 1000 }),
      claudeCall({ when: at(10, 0), request: 'req-2', message: 'msg-2', input: 20, output: 2 }),
      claudeCall({ when: at(10, 30), request: 'req-3', message: 'msg-3', input: 300, output: 30 }),
      claudeCall({ when: at(11, 0), request: 'req-4', message: 'msg-4', input: 4000, output: 400 }),
      claudeCall({ when: at(11, 30), request: 'req-5', message: 'msg-5', input: 50000, output: 5000 }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const conversation = conversationOf(await dailyOver(box, '--since', at(10), '--until', at(11)), 'conv-a');

  assert.equal(conversation.calls, 2, 'the 10:00 and the 10:30 calls, and neither the 11:00 one nor any outside');
  assert.equal(tokensOf(conversation).input, 320);
  assert.equal(tokensOf(conversation).output, 32);
  assert.equal(Date.parse(conversation.first), Date.parse(at(10)), 'the first counted call is the one at --since');
  assert.equal(Date.parse(conversation.last), Date.parse(at(10, 30)), 'the last is the one before --until');
});

test('U13 --until alone counts everything before it', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(8),
    lines: [
      claudeCall({ when: at(8, 5), request: 'req-1', message: 'msg-1', input: 1000, output: 30 }),
      claudeCall({ when: at(10, 0), request: 'req-2', message: 'msg-2', input: 42, output: 13 }),
      claudeCall({ when: at(11, 0), request: 'req-3', message: 'msg-3', input: 7, output: 5 }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const conversation = conversationOf(await dailyOver(box, '--until', at(11)), 'conv-a');

  assert.equal(conversation.calls, 2, 'everything before 11:00, however early');
  assert.equal(tokensOf(conversation).input, 1042);
  assert.equal(tokensOf(conversation).output, 43);
  assert.equal(Date.parse(conversation.last), Date.parse(at(10)));
});

test('U13 Claude Code: two windows that meet at a moment add up to the one window, every call once', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-long',
    started: at(9),
    lines: [
      claudeCall({ when: at(9, 0), request: 'req-1', message: 'msg-1', input: 100, cacheRead: 10, output: 1 }),
      claudeCall({ when: at(10, 59), request: 'req-2', message: 'msg-2', input: 200, cacheRead: 20, output: 2 }),
      claudeCall({ when: at(11, 0), request: 'req-3', message: 'msg-3', input: 400, cacheRead: 40, output: 4 }),
      claudeCall({ when: at(12, 0), request: 'req-4', message: 'msg-4', input: 800, cacheRead: 80, output: 8 }),
    ],
  });
  await plant(box, 'claude', home, {
    id: 'conv-early',
    started: at(9, 30),
    lines: [claudeCall({ when: at(9, 30), request: 'req-5', message: 'msg-5', input: 16, output: 16 })],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-long', 'conv-early') });

  const before = await dailyOver(box, '--since', at(9), '--until', at(11));
  const after = await dailyOver(box, '--since', at(11), '--until', at(13));
  const whole = await dailyOver(box, '--since', at(9), '--until', at(13));

  assert.deepEqual(idsOf(before), ['conv-early', 'conv-long']);
  assert.deepEqual(idsOf(after), ['conv-long'], 'a conversation with no calls in the window is left out');
  assert.deepEqual(idsOf(whole), ['conv-early', 'conv-long']);

  const early = conversationOf(before, 'conv-long');
  const late = conversationOf(after, 'conv-long');
  const all = conversationOf(whole, 'conv-long');
  assert.equal(early.calls, 2, 'the 09:00 and 10:59 calls');
  assert.equal(late.calls, 2, 'the 11:00 call and the 12:00 one');
  assert.equal(all.calls, 4);
  assert.equal(tokensOf(early).input, 300);
  assert.equal(tokensOf(late).input, 1200);
  assert.equal(tokensOf(all).input, 1500);
  assert.equal(tokensOf(early).cache_read + tokensOf(late).cache_read, tokensOf(all).cache_read);
  assert.equal(tokensOf(early).output + tokensOf(late).output, tokensOf(all).output);
  assert.equal(Date.parse(early.last), Date.parse(at(10, 59)));
  assert.equal(Date.parse(late.first), Date.parse(at(11)), 'the boundary call opens the later window');
});

test('U13 Codex: two windows that meet at a moment add up to the one window, across a conversation spanning it', async (t) => {
  // The later window opens mid conversation, so its first call is measured
  // against a running total written before the window; the earlier window ends
  // mid conversation, and must not take the boundary call, nor the repeat of it.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'codex' });
  await plant(box, 'codex', home, {
    id: 'conv-c',
    started: at(8, 30),
    lines: [
      codexTurn({ when: at(8, 30) }),
      codexCall({
        when: at(9, 0),
        last: { input: 1000, cached: 0, output: 100 },
        total: { input: 1000, cached: 0, output: 100 },
      }),
      codexCall({
        when: at(10, 0),
        last: { input: 2000, cached: 800, output: 200 },
        total: { input: 3000, cached: 800, output: 300 },
      }),
      codexCall({
        when: at(11, 0),
        last: { input: 500, cached: 300, output: 50 },
        total: { input: 3500, cached: 1100, output: 350 },
      }),
      codexCall({
        when: at(11, 1),
        last: { input: 500, cached: 300, output: 50 },
        total: { input: 3500, cached: 1100, output: 350 },
      }),
      codexCall({
        when: at(12, 0),
        last: { input: 400, cached: 100, output: 40 },
        total: { input: 3900, cached: 1200, output: 390 },
      }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-c') });

  const early = conversationOf(await dailyOver(box, '--since', at(9), '--until', at(11)), 'conv-c');
  const late = conversationOf(await dailyOver(box, '--since', at(11), '--until', at(13)), 'conv-c');
  const all = conversationOf(await dailyOver(box, '--since', at(9), '--until', at(13)), 'conv-c');

  assert.equal(early.calls, 2, 'the 09:00 and 10:00 calls');
  assert.equal(tokensOf(early).input, 2200, '1,000 and then 2,000 less its 800 cached');
  assert.equal(tokensOf(early).cache_read, 800);
  assert.equal(tokensOf(early).output, 300);

  assert.equal(late.calls, 2, 'the 11:00 call, written down twice, and the 12:00 one');
  assert.equal(tokensOf(late).input, 500, '200 and 300: what each added, less what of it was cached');
  assert.equal(tokensOf(late).cache_read, 400);
  assert.equal(tokensOf(late).output, 90);
  assert.equal(Date.parse(late.first), Date.parse(at(11)));

  assert.equal(all.calls, 4);
  assert.equal(tokensOf(all).input, 2700);
  assert.equal(tokensOf(all).cache_read, 1200);
  assert.equal(tokensOf(all).output, 390);
});

test('U13 Claude Code compactions follow the same window as the calls', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [
      claudeCompaction(at(9, 30)),
      claudeCompaction(at(10, 0)),
      claudeCall({ when: at(10, 15), request: 'req-1', message: 'msg-1', input: 1, output: 1 }),
      claudeCompaction(at(10, 30)),
      claudeCompaction(at(11, 0)),
      claudeCall({ when: at(11, 15), request: 'req-2', message: 'msg-2', input: 1, output: 1 }),
      claudeCompaction(at(11, 30)),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const early = conversationOf(await dailyOver(box, '--since', at(10), '--until', at(11)), 'conv-a');
  const late = conversationOf(await dailyOver(box, '--since', at(11), '--until', at(12)), 'conv-a');

  assert.equal(early.compactions, 2, 'the one at 10:00 and the one at 10:30; not the one at 11:00');
  assert.equal(late.compactions, 2, 'the one at 11:00 and the one at 11:30');
});

test('U13 Codex compactions follow the same window as the calls', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'codex' });
  await plant(box, 'codex', home, {
    id: 'conv-c',
    started: at(9),
    lines: [
      codexTurn({ when: at(9) }),
      codexCompaction(at(9, 30)),
      codexCompaction(at(10, 0)),
      codexCall({ when: at(10, 15), last: { input: 10, output: 1 }, total: { input: 10, output: 1 } }),
      codexCompaction(at(10, 30)),
      codexCompaction(at(11, 0)),
      codexCall({ when: at(11, 15), last: { input: 10, output: 1 }, total: { input: 20, output: 2 } }),
      codexCompaction(at(11, 30)),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-c') });

  const early = conversationOf(await dailyOver(box, '--since', at(10), '--until', at(11)), 'conv-c');
  const late = conversationOf(await dailyOver(box, '--since', at(11), '--until', at(12)), 'conv-c');

  assert.equal(early.compactions, 2, 'the one at 10:00 and the one at 10:30; not the one at 11:00');
  assert.equal(late.compactions, 2, 'the one at 11:00 and the one at 11:30');
});

test('U13 an --until that is not a moment is refused and names what it got', async (t) => {
  const box = await createSandbox(t);
  await fleet(box, { harness: 'claude' });

  const result = await box.run(['usage', '--bots', 'bots', '--until', 'teatime']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('--until'), `the refusal should name --until, got: ${result.stderr}`);
  assert.ok(result.stderr.includes('teatime'), `and what it was given, got: ${result.stderr}`);
});

test('U13 an --until earlier than --since is refused', async (t) => {
  const box = await createSandbox(t);
  await fleet(box, { harness: 'claude' });

  const result = await box.run(['usage', '--bots', 'bots', '--since', at(11), '--until', at(10)]);

  assertCleanFailure(result);
  assert.ok(
    result.stderr.includes('--until') && result.stderr.includes('--since'),
    `the refusal should name both ends, got: ${result.stderr}`,
  );
});

test('U13 Claude Code: a call still being written at a window\'s end is counted once, and its tokens land where they were written', async (t) => {
  // Claude Code writes one call down again as it grows, the later record the
  // finished one (tech notes, section 2: 16 output tokens, then 301, under a
  // second apart). A run whose window ends between the two records sees only
  // the first. The call was made in that window, so that run counts the call;
  // the growth written after it belongs to the next run. Runs that meet at a
  // moment then add up to the whole window, in calls and in every kind of
  // token: nothing twice, and nothing lost. The transcript grows between the
  // two runs, as it does live.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  const early = claudeCall({
    when: '2026-09-20T09:29:21.187Z', request: 'req-1', message: 'msg-1', input: 2, cacheRead: 5000, output: 16,
  });
  const finished = claudeCall({
    when: '2026-09-20T09:29:21.936Z', request: 'req-1', message: 'msg-1', input: 2, cacheRead: 5000, output: 301,
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });
  const end = '2026-09-20T09:29:21.500Z';

  await plant(box, 'claude', home, { id: 'conv-a', started: at(9), lines: [early] });
  const first = conversationOf(await dailyOver(box, '--since', at(9), '--until', end), 'conv-a');

  await plant(box, 'claude', home, { id: 'conv-a', started: at(9), lines: [early, finished] });
  const second = conversationOf(await dailyOver(box, '--since', end, '--until', at(10)), 'conv-a');
  const whole = conversationOf(await dailyOver(box, '--since', at(9), '--until', at(10)), 'conv-a');

  assert.equal(first.calls, 1, 'the first run counts the call, made inside its window');
  assert.equal(tokensOf(first).output, 16, 'at what it had reached when that run read');
  assert.equal(tokensOf(first).cache_read, 5000);

  assert.equal(second.calls, 0, 'the second run does not count the call again: it was made before its window');
  assert.equal(tokensOf(second).output, 285, 'but the 285 written in its window are its to report');
  assert.equal(tokensOf(second).cache_read, 0, 'and the cache reads, already reported, are not reported again');
  assert.equal(tokensOf(second).input, 0);

  assert.equal(whole.calls, 1);
  assert.equal(tokensOf(whole).output, 301, 'with the whole transcript there, its finished figures');
  assert.equal(tokensOf(whole).cache_read, 5000);

  assert.equal(first.calls + second.calls, whole.calls, 'the two runs add up to the whole window in calls');
  for (const kind of ['input', 'output', 'cache_read', 'cache_write', 'reasoning']) {
    assert.equal(
      tokensOf(first)[kind] + tokensOf(second)[kind],
      tokensOf(whole)[kind],
      `and in ${kind}: first ${JSON.stringify(first)}, second ${JSON.stringify(second)}, whole ${JSON.stringify(whole)}`,
    );
  }
});

test('U13 the help lists --until', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['--help']);

  assert.equal(result.code, 0);
  assert.ok(result.stdout.includes('--until'), `usage should mention --until, got: ${result.stdout}`);
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

// ---------------------------------------------------------------- round two
//
// What the review found, all of it measured against real transcripts on this
// machine rather than argued. Three of the five findings are about what a
// figure means, and each one had a plausible rule behind it that real data
// breaks.

/** The per-model split of one conversation's usage. */
function byModelIn(conversation) {
  const listed = conversation.by_model;
  assert.ok(
    Array.isArray(listed),
    `a conversation should split its usage by the model that spent it, got: ${JSON.stringify(conversation)}`,
  );
  return listed;
}

/** The one entry about one model. */
function modelOf(conversation, model) {
  const found = byModelIn(conversation).filter((one) => one.model === model);
  assert.equal(found.length, 1, `one entry should be about ${model}, got: ${JSON.stringify(conversation.by_model)}`);
  return found[0];
}

test('U9 Claude Code: a call written down twice is kept as the later record, not the first', async (t) => {
  // Finding A. The pair can be written twice with the usage still rising, and
  // the finalized record is the later one. Measured: 4,736 repeated pairs
  // across 137 transcripts carried identical usage and exactly one did not,
  // which is why keeping the first passes a fixture that repeats itself and
  // undercounts in life. The two lines below are that one case, as it was
  // found.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [
      claudeCall({
        when: '2026-09-20T09:29:21.187Z', request: 'req-1', message: 'msg-1',
        input: 2, cacheRead: 126586, cacheWrite: 2984, output: 16,
      }),
      claudeCall({
        when: '2026-09-20T09:29:21.936Z', request: 'req-1', message: 'msg-1',
        input: 2, cacheRead: 126586, cacheWrite: 2984, output: 301,
      }),
      claudeCall({ when: at(9, 40), request: 'req-2', message: 'msg-2', input: 5, cacheRead: 100, output: 7 }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const conversation = conversationOf(
    conversationsOf(sessionOf(entryOf(await usage(box), 'api-bot'), 'daily')),
    'conv-a',
  );

  assert.equal(conversation.calls, 2, 'three lines, two calls');
  const tokens = tokensOf(conversation);
  assert.equal(tokens.output, 308, '301 from the finalized record plus 7; not 23 from the first, nor 324 from both');
  assert.equal(tokens.input, 7, 'the fields that did not move are still counted once');
  assert.equal(tokens.cache_read, 126686);
  assert.equal(tokens.cache_write, 2984);
});

test('U9 Claude Code: a call written down twice keeps one moment, not two', async (t) => {
  // The pair is one call, so whichever of the two times is kept, it is the only
  // one the conversation has. Which of them it is the requirement does not say.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [
      claudeCall({ when: '2026-09-20T09:29:21.187Z', request: 'req-1', message: 'msg-1', input: 2, output: 16 }),
      claudeCall({ when: '2026-09-20T09:29:21.936Z', request: 'req-1', message: 'msg-1', input: 2, output: 301 }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const conversation = conversationOf(
    conversationsOf(sessionOf(entryOf(await usage(box), 'api-bot'), 'daily')),
    'conv-a',
  );

  assert.equal(conversation.calls, 1);
  assert.equal(conversation.first, conversation.last, `one call has one moment, got: ${JSON.stringify(conversation)}`);
});

test('U10 Codex: an event that repeats the one before it is not a second call', async (t) => {
  // Finding B, first half. Two adjacent events carry an identical positive
  // `last_token_usage` while the running total does not move: 128 such pairs in
  // 250 rollouts here. Summing the per-call figures counts that call twice.
  // These are the reviewer's measured numbers: one call of 7,260 uncached input,
  // 190,336 cache reads and 811 output, which summing reports as two calls of
  // 14,520, 380,672 and 1,622.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'codex' });
  const spent = { input: 197596, cached: 190336, output: 811 };
  await plant(box, 'codex', home, {
    id: 'conv-c',
    started: at(9),
    lines: [
      codexTurn({ when: at(9) }),
      codexCall({ when: at(9, 1), last: spent, total: spent }),
      codexCall({ when: at(9, 2), last: spent, total: spent }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-c') });

  const conversation = conversationOf(
    conversationsOf(sessionOf(entryOf(await usage(box), 'api-bot'), 'daily')),
    'conv-c',
  );

  assert.equal(conversation.calls, 1, 'the running total did not move, so nothing was spent twice');
  const tokens = tokensOf(conversation);
  assert.equal(tokens.input, 7260, '197,596 less the 190,336 cached, counted once and not twice');
  assert.equal(tokens.cache_read, 190336, 'and not 380,672');
  assert.equal(tokens.output, 811, 'and not 1,622');
});

test('U10 Codex: a running total that resets starts a new window, and nothing before it is lost', async (t) => {
  // Finding B, second half. The running total drops back mid-conversation and
  // starts again: 26 such resets in 250 rollouts. Taking the final
  // `total_token_usage` then reports only the last window — one real
  // conversation spent 2,854,977 and its final cumulative said 1,489,245.
  //
  // Worked by hand: the four calls are the differences 1000/0/50, 2000/500/100,
  // then the reset, whose own figures are 400/100/20, then 600/200/30. Uncached
  // input is 1000 + 1500 + 300 + 400.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'codex' });
  await plant(box, 'codex', home, {
    id: 'conv-c',
    started: at(9),
    lines: [
      codexTurn({ when: at(9) }),
      codexCall({
        when: at(9, 1),
        last: { input: 1000, cached: 0, output: 50 },
        total: { input: 1000, cached: 0, output: 50 },
      }),
      codexCall({
        when: at(9, 2),
        last: { input: 2000, cached: 500, output: 100 },
        total: { input: 3000, cached: 500, output: 150 },
      }),
      // The reset: the total drops below what it was.
      codexCall({
        when: at(9, 3),
        last: { input: 400, cached: 100, output: 20 },
        total: { input: 400, cached: 100, output: 20 },
      }),
      codexCall({
        when: at(9, 4),
        last: { input: 600, cached: 200, output: 30 },
        total: { input: 1000, cached: 300, output: 50 },
      }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-c') });

  const conversation = conversationOf(
    conversationsOf(sessionOf(entryOf(await usage(box), 'api-bot'), 'daily')),
    'conv-c',
  );

  assert.equal(conversation.calls, 4, 'the reset is a call of its own, not a gap');
  const tokens = tokensOf(conversation);
  assert.equal(tokens.input, 3200, 'both windows; the final cumulative alone would say 700');
  assert.equal(tokens.cache_read, 800, 'and not 300');
  assert.equal(tokens.output, 200, 'and not 50');
});

test('U10 Codex: --since counts a call by what it added, not by the whole total behind it', async (t) => {
  // Finding B, and the case worth the most: a window that opens mid
  // conversation. The difference only means anything against the event before,
  // so the events outside the window still have to be walked. An implementation
  // that starts counting at the boundary reads the third event's running total
  // as its usage and charges the morning to one call.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'codex' });
  await plant(box, 'codex', home, {
    id: 'conv-c',
    started: at(8),
    lines: [
      codexTurn({ when: at(8) }),
      codexCall({
        when: at(8, 0),
        last: { input: 1000, cached: 0, output: 100 },
        total: { input: 1000, cached: 0, output: 100 },
      }),
      codexCall({
        when: at(9, 0),
        last: { input: 2000, cached: 800, output: 200 },
        total: { input: 3000, cached: 800, output: 300 },
      }),
      codexCall({
        when: at(11, 0),
        last: { input: 500, cached: 300, output: 50 },
        total: { input: 3500, cached: 1100, output: 350 },
      }),
      // And a repeat of it, inside the window, so that the two wrong roads part
      // company here rather than agreeing by luck.
      codexCall({
        when: at(11, 1),
        last: { input: 500, cached: 300, output: 50 },
        total: { input: 3500, cached: 1100, output: 350 },
      }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-c') });

  const conversation = conversationOf(
    conversationsOf(sessionOf(entryOf(await usage(box, '--since', at(10)), 'api-bot'), 'daily')),
    'conv-c',
  );

  assert.equal(conversation.calls, 1, 'one call in the window, written down twice');
  const tokens = tokensOf(conversation);
  assert.equal(
    tokens.input,
    200,
    '500 added less the 300 of it that was cached: not 400 from summing the two records, '
    + 'and not the 2,400 of running total sitting behind them',
  );
  assert.equal(tokens.cache_read, 300, 'and not 600, and not 1,100');
  assert.equal(tokens.output, 50, 'and not 100, and not 350');
});

test('U11 Claude Code: the tokens stay attributable to the model that spent them', async (t) => {
  // Finding C. One total beside a set of model names cannot be priced: put 100
  // input tokens on one model and 900 on another, swap the quantities, and the
  // report does not move, though the money does.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [
      claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', model: 'claude-opus-5', input: 100, output: 10 }),
      claudeCall({ when: at(9, 2), request: 'req-2', message: 'msg-2', model: 'claude-sonnet-5', input: 900, cacheRead: 40, output: 90 }),
      claudeCall({ when: at(9, 3), request: 'req-3', message: 'msg-3', model: 'claude-opus-5', input: 5, output: 1 }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const conversation = conversationOf(
    conversationsOf(sessionOf(entryOf(await usage(box), 'api-bot'), 'daily')),
    'conv-a',
  );

  const opus = modelOf(conversation, 'claude-opus-5');
  const sonnet = modelOf(conversation, 'claude-sonnet-5');
  assert.equal(opus.calls, 2);
  assert.equal(tokensOf(opus).input, 105, 'the expensive model spent 105, and swapping the two would say 900');
  assert.equal(tokensOf(opus).output, 11);
  assert.equal(sonnet.calls, 1);
  assert.equal(tokensOf(sonnet).input, 900);
  assert.equal(tokensOf(sonnet).cache_read, 40);
  assert.equal(tokensOf(sonnet).output, 90);
  assert.equal(tokensOf(conversation).input, 1005, 'and the conversation total is still the sum of them');
});

test('U11 Codex: the tokens stay attributable to the model that spent them', async (t) => {
  // A Codex call belongs to the model the conversation was set to when it was
  // made, which is the most recent turn_context before it.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'codex' });
  await plant(box, 'codex', home, {
    id: 'conv-c',
    started: at(9),
    lines: [
      codexTurn({ when: at(9), model: 'gpt-6-astra' }),
      codexCall({
        when: at(9, 1),
        last: { input: 100, cached: 0, output: 10 },
        total: { input: 100, cached: 0, output: 10 },
      }),
      codexTurn({ when: at(9, 2), model: 'gpt-6-mini' }),
      codexCall({
        when: at(9, 3),
        last: { input: 900, cached: 0, output: 90 },
        total: { input: 1000, cached: 0, output: 100 },
      }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-c') });

  const conversation = conversationOf(
    conversationsOf(sessionOf(entryOf(await usage(box), 'api-bot'), 'daily')),
    'conv-c',
  );

  assert.equal(tokensOf(modelOf(conversation, 'gpt-6-astra')).input, 100);
  assert.equal(tokensOf(modelOf(conversation, 'gpt-6-astra')).output, 10);
  assert.equal(tokensOf(modelOf(conversation, 'gpt-6-mini')).input, 900, 'swapping the two would say 100');
  assert.equal(tokensOf(modelOf(conversation, 'gpt-6-mini')).output, 90);
  assert.equal(modelOf(conversation, 'gpt-6-mini').calls, 1);
});

test('U12 a bots folder reached through a symlink is the same fleet', async (t) => {
  // Finding E. The bot home is what says which folder a harness filed its
  // transcripts under, so a spelling of it that is not the canonical one finds
  // nothing at all: same fleet, same conversations on disk, an empty report.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 640, cacheRead: 55, output: 21 })],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });
  await symlink(bots, box.path('another-way-in'));

  const direct = await usage(box);
  const throughLink = await usageIn(box, 'another-way-in');

  const conversationsFor = (answer) => conversationsOf(sessionOf(entryOf(answer, 'api-bot'), 'daily'));
  assert.equal(tokensOf(conversationOf(conversationsFor(direct), 'conv-a')).input, 640, 'the canonical way in works');
  assert.deepEqual(
    idsOf(conversationsFor(throughLink)),
    ['conv-a'],
    'and the symlink is the same fleet, not an empty one',
  );
  assert.deepEqual(
    tokensOf(conversationOf(conversationsFor(throughLink), 'conv-a')),
    tokensOf(conversationOf(conversationsFor(direct), 'conv-a')),
    'down to the figures',
  );
  assert.equal(throughLink.bots, bots, 'and bots comes back as the folder itself, not the way in');
});

// ------------------------------------------------ what it could not count
//
// Issue #275. A usage figure that quietly leaves things out reads as complete.
// Four things can be left out: a transcript that cannot be read, a line that is
// not a JSON object, a usage record whose figures are not all there, and a
// record with no time that can be placed in a window. Each is left out of the
// totals and named, per session and for the bot's unclaimed transcripts, in
// `not_counted` and `unclaimed_not_counted`.

/** Nothing left out, in the answer's words. */
const NOTHING_LEFT_OUT = {
  unreadable_transcripts: 0,
  broken_lines: 0,
  records_without_numbers: 0,
  records_without_time: 0,
};

/** What was left out, of the four kinds, with every kind not named at 0. */
const leftOut = (some) => ({ ...NOTHING_LEFT_OUT, ...some });

/** What a session, or a bot's unclaimed transcripts, say they left out: the four kinds and only those. */
function leftOutOf(owner, field = 'not_counted') {
  const said = owner[field];
  assert.ok(
    said !== null && typeof said === 'object',
    `it should say what it left out in ${field}, got: ${JSON.stringify(owner)}`,
  );
  return Object.fromEntries(Object.keys(NOTHING_LEFT_OUT).map((kind) => [kind, said[kind]]));
}

/**
 * Put lines into a planted transcript as they are, after its first `after`
 * lines: a string as the text it is, anything else as JSON. What a torn write
 * or a garbled record leaves, which `plant` cannot, since it writes JSON. The
 * file keeps the time it had.
 */
async function slipIn(file, after, ...lines) {
  const { atime, mtime } = await stat(file);
  const had = (await readFile(file, 'utf8')).split('\n');
  had.splice(after, 0, ...lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))));
  await writeFile(file, had.join('\n'));
  await utimes(file, atime, mtime);
}

/** A Claude Code call with some of its figures replaced; `undefined` takes one out. */
const claudeCallAnd = (call, figures) => {
  const record = claudeCall(call);
  Object.assign(record.message.usage, figures);
  return record;
};

/** A Codex call with some figures of its running total replaced; `undefined` takes one out. */
const codexCallAnd = (call, figures) => {
  const record = codexCall(call);
  Object.assign(record.payload.info.total_token_usage, figures);
  return record;
};

/** A Codex call with some figures of its own per-call usage replaced; `undefined` takes one out. */
const codexCallAndLast = (call, figures) => {
  const record = codexCall(call);
  Object.assign(record.payload.info.last_token_usage, figures);
  return record;
};

/** What Codex writes when it has only rate limits to report: not a usage record. */
const codexRateLimits = (when) => ({
  timestamp: when,
  type: 'event_msg',
  payload: { type: 'token_count', info: null, rate_limits: { primary: { used_percent: 12.5, window_minutes: 300 } } },
});

/** A Claude Code transcript line that cannot be a JSON object: a write torn off mid record. */
const TORN = '{"type":"assistant","timestamp":"2026-09-20T09:20:00.000Z","requestId":"req-torn","message":{"id":"msg-torn","usage":{"input_tokens":7000';

/** Root reads a file whatever its permissions, so a transcript cannot be made unreadable to it. */
const UNREADABLE_NEEDS_A_USER = process.getuid?.() === 0
  && 'runs as root, which reads a file whatever its permissions, so no transcript can be made unreadable';

/** The lines of a plain report that say something was not counted. */
const notCountedLines = (stdout) => stdout.split('\n').filter((line) => /not counted/i.test(line));

test('U14 an unreadable transcript, a broken line and an undated record are each reported and left out of the totals', { skip: UNREADABLE_NEEDS_A_USER }, async (t) => {
  // The issue's first acceptance case. Today the locked transcript gives no
  // lines, the torn line is skipped and the undated call counts as inside the
  // window, and none of it is said.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  const locked = await plant(box, 'claude', home, {
    id: 'conv-locked',
    started: at(9),
    lines: [claudeCall({ when: at(9, 1), request: 'req-L', message: 'msg-L', input: 9000, output: 900 })],
  });
  await chmod(locked, 0o000);
  const file = await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [
      claudeCall({ when: at(9, 10), request: 'req-1', message: 'msg-1', input: 12, cacheRead: 340, cacheWrite: 56, output: 78 }),
      claudeCall({ when: undefined, request: 'req-2', message: 'msg-2', input: 5000, cacheRead: 5000, cacheWrite: 5000, output: 5000 }),
    ],
  });
  await slipIn(file, 2, TORN);
  await bookSays(bots, 'api-bot', { daily: ran('conv-a', 'conv-locked') });

  const entry = entryOf(await usage(box), 'api-bot');
  const session = sessionOf(entry, 'daily');

  assert.deepEqual(
    leftOutOf(session),
    leftOut({ unreadable_transcripts: 1, broken_lines: 1, records_without_time: 1 }),
    'each of the three is named, once',
  );
  assert.deepEqual(idsOf(conversationsOf(session)), ['conv-a'], 'the locked transcript counted nothing, so it has no row');
  const conversation = conversationOf(conversationsOf(session), 'conv-a');
  assert.equal(conversation.calls, 1, 'the undated call is not counted as inside the window');
  assert.equal(tokensOf(conversation).input, 12, 'the totals are the one good call and nothing else');
  assert.equal(tokensOf(conversation).cache_read, 340);
  assert.equal(tokensOf(conversation).cache_write, 56);
  assert.equal(tokensOf(conversation).output, 78);
  assert.deepEqual(leftOutOf(entry, 'unclaimed_not_counted'), NOTHING_LEFT_OUT, 'and none of it is laid at the unclaimed door');
});

test('U14 a clean fleet reports nothing left out, on every session and bot, and the totals it always had', async (t) => {
  // The issue's second acceptance case. The fixture carries what real
  // transcripts carry that is not a gap: a summary line and a person talking
  // (no usage), a blank line, a call written down twice, a Codex turn_context
  // with no time, a rate-limit note with `info: null`, and a Codex record with
  // no cache_write_input_tokens, which Codex does not write. None of them may
  // show up as something left out.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude', sessions: ['daily', 'review'] });
  const madeCodex = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'codex-bot', '--harness', 'codex']);
  assert.equal(madeCodex.code, 0, madeCodex.stderr);
  const addedCodex = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'codex-bot', '--name', 'daily']);
  assert.equal(addedCodex.code, 0, addedCodex.stderr);

  const repeated = claudeCall({
    when: at(9, 1), request: 'req-1', message: 'msg-1', input: 2, cacheRead: 13460, cacheWrite: 200, output: 500,
  });
  const claudeFile = await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [
      { type: 'summary', summary: 'Usage report for the day', leafUuid: 'leaf-1' },
      claudeSaid(at(9), 'how much did we use?'),
      repeated,
      repeated,
      claudeCall({ when: at(9, 5), request: 'req-2', message: 'msg-2', input: 7, cacheRead: 20000, output: 300 }),
      claudeCompaction(at(9, 6)),
    ],
  });
  await slipIn(claudeFile, 3, '');

  const noCacheWrite = { cache_write_input_tokens: undefined };
  const second = codexCall({
    when: at(9, 4),
    last: { input: 2000, cached: 900, output: 100, reasoning: 40 },
    total: { input: 3000, cached: 900, output: 150, reasoning: 60 },
  });
  Object.assign(second.payload.info.last_token_usage, noCacheWrite);
  Object.assign(second.payload.info.total_token_usage, noCacheWrite);
  await plant(box, 'codex', botHomeOf(bots, 'codex-bot'), {
    id: 'conv-c',
    started: at(9),
    lines: [
      codexTurn({ when: undefined }),
      codexCall({
        when: at(9, 1),
        last: { input: 1000, cached: 0, output: 50, reasoning: 20 },
        total: { input: 1000, cached: 0, output: 50, reasoning: 20 },
      }),
      codexRateLimits(at(9, 2)),
      second,
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });
  await bookSays(bots, 'codex-bot', { daily: ran('conv-c') });

  const answer = await usage(box);

  assert.deepEqual(answer.usage.map((entry) => entry.bot).sort(), ['api-bot', 'bot-father', 'codex-bot']);
  for (const entry of answer.usage) {
    assert.deepEqual(leftOutOf(entry, 'unclaimed_not_counted'), NOTHING_LEFT_OUT, `${entry.bot}'s unclaimed`);
    assert.ok((entry.sessions ?? []).length > 0, `${entry.bot} should have its sessions, got: ${JSON.stringify(entry)}`);
    for (const session of entry.sessions) {
      assert.deepEqual(leftOutOf(session), NOTHING_LEFT_OUT, `${entry.bot} ${session.name}, run or not`);
    }
  }

  const claude = conversationOf(conversationsOf(sessionOf(entryOf(answer, 'api-bot'), 'daily')), 'conv-a');
  assert.equal(claude.calls, 2);
  assert.equal(claude.compactions, 1);
  assert.equal(tokensOf(claude).input, 9);
  assert.equal(tokensOf(claude).cache_read, 33460);
  assert.equal(tokensOf(claude).cache_write, 200);
  assert.equal(tokensOf(claude).output, 800);

  const codex = conversationOf(conversationsOf(sessionOf(entryOf(answer, 'codex-bot'), 'daily')), 'conv-c');
  assert.equal(codex.calls, 2, 'the rate-limit note is not a call');
  assert.equal(tokensOf(codex).input, 2100, '3,000 less the 900 cached');
  assert.equal(tokensOf(codex).cache_read, 900);
  assert.equal(tokensOf(codex).output, 150);
  assert.equal(tokensOf(codex).reasoning, 60);
});

test('U14 Claude Code: an unreadable transcript is the session\'s when the book names it, and the bot\'s unclaimed when not', { skip: UNREADABLE_NEEDS_A_USER }, async (t) => {
  // Claude Code files a transcript by folder and name, so one that cannot be
  // read is still known to be there, and whose it is follows the book.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  for (const id of ['conv-mine', 'conv-nobodys']) {
    const file = await plant(box, 'claude', home, {
      id,
      started: at(9),
      lines: [claudeCall({ when: at(9, 1), request: `req-${id}`, message: `msg-${id}`, input: 800, output: 80 })],
    });
    await chmod(file, 0o000);
  }
  await plant(box, 'claude', home, {
    id: 'conv-ok',
    started: at(9),
    lines: [claudeCall({ when: at(9, 2), request: 'req-ok', message: 'msg-ok', input: 3, output: 4 })],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-ok', 'conv-mine') });

  const entry = entryOf(await usage(box), 'api-bot');
  const session = sessionOf(entry, 'daily');

  assert.deepEqual(leftOutOf(session), leftOut({ unreadable_transcripts: 1 }), 'the one the book names for daily');
  assert.deepEqual(leftOutOf(entry, 'unclaimed_not_counted'), leftOut({ unreadable_transcripts: 1 }), 'the one nobody names');
  assert.deepEqual(idsOf(conversationsOf(session)), ['conv-ok'], 'neither has a row, having counted nothing');
  assert.deepEqual(entry.unclaimed ?? [], []);
  assert.equal(tokensOf(conversationOf(conversationsOf(session), 'conv-ok')).input, 3, 'and the readable one counts as it did');
});

test('U14 Claude Code: an unreadable transcript is reported whatever the window', { skip: UNREADABLE_NEEDS_A_USER }, async (t) => {
  // Whether anything in it fell inside the window cannot be known without
  // reading it. A window that opens after the file was last written must not
  // make it disappear, nor one that closes before it began.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  const file = await plant(box, 'claude', home, {
    id: 'conv-locked',
    started: at(9),
    lines: [claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 800, output: 80 })],
  });
  await chmod(file, 0o000);
  await bookSays(bots, 'api-bot', { daily: ran('conv-locked') });

  const later = sessionOf(entryOf(await usage(box, '--since', at(12), '--until', at(13)), 'api-bot'), 'daily');
  const earlier = sessionOf(entryOf(await usage(box, '--until', at(8)), 'api-bot'), 'daily');

  assert.deepEqual(leftOutOf(later), leftOut({ unreadable_transcripts: 1 }), 'a window after it');
  assert.deepEqual(leftOutOf(earlier), leftOut({ unreadable_transcripts: 1 }), 'a window before it');
});

test('U14 Claude Code: every non-blank line that is not a JSON object is a broken line, and the good lines still count', async (t) => {
  // `null`, a list and a string are all JSON, and none of them is a record.
  // A blank line is not a broken one.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  const file = await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 3, cacheRead: 30, output: 4 })],
  });
  await slipIn(file, 2, 'not json at all', TORN, '', '[1, 2]', '"a string"', 'null');
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const session = sessionOf(entryOf(await usage(box), 'api-bot'), 'daily');

  assert.deepEqual(leftOutOf(session), leftOut({ broken_lines: 5 }), 'five broken lines; the blank one is not');
  const conversation = conversationOf(conversationsOf(session), 'conv-a');
  assert.equal(conversation.calls, 1);
  assert.equal(tokensOf(conversation).input, 3);
  assert.equal(tokensOf(conversation).cache_read, 30);
  assert.equal(tokensOf(conversation).output, 4);
});

test('U14 Codex: a broken line in a rollout is reported under the session that owns the rollout', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'codex' });
  const file = await plant(box, 'codex', home, {
    id: 'conv-c',
    started: at(9),
    lines: [
      codexTurn({ when: at(9) }),
      codexCall({ when: at(9, 1), last: { input: 10, output: 1 }, total: { input: 10, output: 1 } }),
    ],
  });
  await slipIn(file, 2, '{"timestamp":"2026-09-20T09:00:30.000Z","type":"event_msg","payload":{"type":"token_co');
  await bookSays(bots, 'api-bot', { daily: ran('conv-c') });

  const entry = entryOf(await usage(box), 'api-bot');
  const session = sessionOf(entry, 'daily');

  assert.deepEqual(leftOutOf(session), leftOut({ broken_lines: 1 }));
  assert.deepEqual(leftOutOf(entry, 'unclaimed_not_counted'), NOTHING_LEFT_OUT);
  assert.equal(conversationOf(conversationsOf(session), 'conv-c').calls, 1, 'and the good call is still counted');
});

test('U14 a broken line is reported whatever the window, since it has no time to read', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  const file = await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 3, output: 4 })],
  });
  await slipIn(file, 2, TORN);
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const session = sessionOf(entryOf(await usage(box, '--since', at(12)), 'api-bot'), 'daily');

  assert.deepEqual(conversationsOf(session), [], 'the one good call is before the window');
  assert.deepEqual(leftOutOf(session), leftOut({ broken_lines: 1 }), 'and the broken line is still named');
});

test('U14 Claude Code: a usage record with a figure missing or not a number is left out whole and reported', async (t) => {
  // No partial counting: the good figures of a broken record are not added,
  // nor its model, nor its moment. Today a missing figure becomes 0 and the
  // rest of the record is counted.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  const broken = { model: 'claude-sonnet-5', input: 1000, cacheRead: 2000, cacheWrite: 3000, output: 4000 };
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [
      claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 5, cacheRead: 60, cacheWrite: 70, output: 7 }),
      claudeCallAnd({ when: at(9, 2), request: 'req-2', message: 'msg-2', ...broken }, { output_tokens: undefined }),
      claudeCallAnd({ when: at(9, 3), request: 'req-3', message: 'msg-3', ...broken }, { input_tokens: '400' }),
      claudeCallAnd({ when: at(9, 4), request: 'req-4', message: 'msg-4', ...broken }, { cache_creation_input_tokens: null }),
      claudeCallAnd({ when: at(9, 5), request: 'req-5', message: 'msg-5', ...broken }, { cache_read_input_tokens: undefined }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const session = sessionOf(entryOf(await usage(box), 'api-bot'), 'daily');

  assert.deepEqual(leftOutOf(session), leftOut({ records_without_numbers: 4 }));
  const conversation = conversationOf(conversationsOf(session), 'conv-a');
  assert.equal(conversation.calls, 1);
  assert.equal(tokensOf(conversation).input, 5, 'not 2,005: the broken ones\' good figures are not added either');
  assert.equal(tokensOf(conversation).cache_read, 60);
  assert.equal(tokensOf(conversation).cache_write, 70);
  assert.equal(tokensOf(conversation).output, 7);
  assert.deepEqual([...conversation.models], ['claude-opus-5'], 'only the model of what was counted');
  assert.equal(Date.parse(conversation.last), Date.parse(at(9, 1)), `the last counted call, got: ${conversation.last}`);
});

test('U14 Claude Code: a call written down twice with one broken copy is counted once from its good copy', async (t) => {
  // The later copy is normally the one kept (U9), so the trap is a broken
  // later copy taking the call with it, or being counted as zeros over it.
  // The other call has its broken copy first.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [
      claudeCall({
        when: '2026-09-20T09:29:21.187Z', request: 'req-1', message: 'msg-1', input: 2, cacheRead: 5000, cacheWrite: 30, output: 16,
      }),
      claudeCallAnd(
        { when: '2026-09-20T09:29:21.936Z', request: 'req-1', message: 'msg-1', input: 2, cacheRead: 5000, cacheWrite: 30 },
        { output_tokens: undefined },
      ),
      claudeCallAnd(
        { when: '2026-09-20T09:40:00.000Z', request: 'req-2', message: 'msg-2', input: 5, output: 9 },
        { input_tokens: 'five' },
      ),
      claudeCall({ when: '2026-09-20T09:40:01.000Z', request: 'req-2', message: 'msg-2', input: 5, output: 7 }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const session = sessionOf(entryOf(await usage(box), 'api-bot'), 'daily');

  assert.deepEqual(leftOutOf(session), leftOut({ records_without_numbers: 2 }), 'each broken copy is named');
  const conversation = conversationOf(conversationsOf(session), 'conv-a');
  assert.equal(conversation.calls, 2, 'and each call is still counted, once');
  const tokens = tokensOf(conversation);
  assert.equal(tokens.output, 23, '16 from the good copy of the first call, 7 from the second');
  assert.equal(tokens.input, 7);
  assert.equal(tokens.cache_read, 5000);
  assert.equal(tokens.cache_write, 30);
});

test('U14 Codex: after a token_count with its running total incomplete, the next whole one is not counted, and the one after it is measured by its rise', async (t) => {
  // After B the running total is unknown, so C, the next event with a whole
  // total, cannot be measured: whether it is a new call or B written again
  // is not guessed. It is not counted, though its own figure (400 in, 100
  // cached, 20 out) is whole, and it is named. The total resumes from C's,
  // and D is measured by its rise as usual: 600 in, 200 cached, 30 out,
  // though its own figure says otherwise. Uncached input is 1,000 + 400.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'codex' });
  await plant(box, 'codex', home, {
    id: 'conv-c',
    started: at(9),
    lines: [
      codexTurn({ when: at(9) }),
      codexCall({
        when: at(9, 1),
        last: { input: 1000, cached: 0, output: 50 },
        total: { input: 1000, cached: 0, output: 50 },
      }),
      codexCallAnd({
        when: at(9, 2),
        last: { input: 2000, cached: 500, output: 100 },
        total: { input: 3000, cached: 500, output: 150 },
      }, { output_tokens: undefined }),
      codexCall({
        when: at(9, 3),
        last: { input: 400, cached: 100, output: 20 },
        total: { input: 3400, cached: 600, output: 170 },
      }),
      codexCall({
        when: at(9, 4),
        last: { input: 50, cached: 0, output: 5 },
        total: { input: 4000, cached: 800, output: 200 },
      }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-c') });

  const session = sessionOf(entryOf(await usage(box), 'api-bot'), 'daily');

  assert.deepEqual(leftOutOf(session), leftOut({ records_without_numbers: 2 }), 'B and C');
  const conversation = conversationOf(conversationsOf(session), 'conv-c');
  assert.equal(conversation.calls, 2, 'A and D');
  assert.equal(tokensOf(conversation).input, 1400, '1,000, then D\'s rise of 400; not C\'s own 300 as well');
  assert.equal(tokensOf(conversation).cache_read, 200);
  assert.equal(tokensOf(conversation).output, 80, '50 + 30');
});

test('U14 Codex: a running total that falls, on an event whose own figure is incomplete, is not a call, and the total resumes from it', async (t) => {
  // On a fall the call is the event's own last_token_usage, and B's lacks its
  // output. B is then a record without numbers, not a call with 0 output. C
  // is its rise from B's total, 300 in, 50 cached, 30 out; resuming from A's
  // instead would read C as a fall too and take its own figure.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'codex' });
  await plant(box, 'codex', home, {
    id: 'conv-c',
    started: at(9),
    lines: [
      codexTurn({ when: at(9) }),
      codexCall({
        when: at(9, 1),
        last: { input: 1000, cached: 0, output: 100 },
        total: { input: 1000, cached: 0, output: 100 },
      }),
      codexCallAndLast({
        when: at(9, 2),
        last: { input: 100, cached: 0, output: 10 },
        total: { input: 100, cached: 0, output: 10 },
      }, { output_tokens: undefined }),
      codexCall({
        when: at(9, 3),
        last: { input: 7, cached: 0, output: 1 },
        total: { input: 400, cached: 50, output: 40 },
      }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-c') });

  const session = sessionOf(entryOf(await usage(box), 'api-bot'), 'daily');

  assert.deepEqual(leftOutOf(session), leftOut({ records_without_numbers: 1 }));
  const conversation = conversationOf(conversationsOf(session), 'conv-c');
  assert.equal(conversation.calls, 2, 'A and C; B is not a call');
  assert.equal(tokensOf(conversation).input, 1250, '1,000, then C\'s rise of 300 less its 50 cached');
  assert.equal(tokensOf(conversation).cache_read, 50);
  assert.equal(tokensOf(conversation).output, 130);
});

test('U14 Codex: a figure that is not a number, or a lone last_token_usage with one missing, is a record without numbers', async (t) => {
  // A string that reads as a number is still not one. With no running total,
  // `last_token_usage` is the figure, and its gap is a gap. After them the
  // running total is unknown, so the last event, the first with a whole total
  // again, is not counted either.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'codex' });
  await plant(box, 'codex', home, {
    id: 'conv-c',
    started: at(9),
    lines: [
      codexTurn({ when: at(9) }),
      codexCall({
        when: at(9, 1),
        last: { input: 1000, cached: 0, output: 50 },
        total: { input: 1000, cached: 0, output: 50 },
      }),
      codexCallAnd({
        when: at(9, 2),
        last: { input: 1000, cached: 0, output: 10 },
        total: { input: 2000, cached: 0, output: 60 },
      }, { input_tokens: '2000' }),
      {
        timestamp: at(9, 3),
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { last_token_usage: { ...codexTokens({ input: 600, output: 30 }), output_tokens: undefined }, model_context_window: 190000 },
        },
      },
      codexCallAnd({
        when: at(9, 4),
        last: { input: 100, cached: 0, output: 5 },
        total: { input: 2100, cached: 0, output: 65 },
      }, { total_tokens: null }),
      codexCall({
        when: at(9, 5),
        last: { input: 1000, cached: 500, output: 85 },
        total: { input: 3000, cached: 500, output: 150 },
      }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-c') });

  const session = sessionOf(entryOf(await usage(box), 'api-bot'), 'daily');

  assert.deepEqual(leftOutOf(session), leftOut({ records_without_numbers: 4 }), 'the three broken ones, and the last');
  const conversation = conversationOf(conversationsOf(session), 'conv-c');
  assert.equal(conversation.calls, 1, 'the first alone');
  assert.equal(tokensOf(conversation).input, 1000);
  assert.equal(tokensOf(conversation).cache_read, 0);
  assert.equal(tokensOf(conversation).output, 50);
});

test('U14 Claude Code: a record without numbers is reported only when its own time is in the window', async (t) => {
  // The window is half open, as for the calls: at or after --since, before
  // --until. Broken records at 09:59, 10:00, 10:30 and 11:00; the window
  // 10:00 to 11:00 holds two of them.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  const brokenAt = (when, n) => claudeCallAnd(
    { when, request: `req-b${n}`, message: `msg-b${n}`, input: 100, output: 100 },
    { output_tokens: undefined },
  );
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [
      brokenAt(at(9, 59), 1),
      brokenAt(at(10, 0), 2),
      claudeCall({ when: at(10, 15), request: 'req-1', message: 'msg-1', input: 3, output: 4 }),
      brokenAt(at(10, 30), 3),
      brokenAt(at(11, 0), 4),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const windowed = sessionOf(entryOf(await usage(box, '--since', at(10), '--until', at(11)), 'api-bot'), 'daily');
  const whole = sessionOf(entryOf(await usage(box), 'api-bot'), 'daily');

  assert.deepEqual(leftOutOf(windowed), leftOut({ records_without_numbers: 2 }), 'the 10:00 and the 10:30 ones');
  assert.deepEqual(leftOutOf(whole), leftOut({ records_without_numbers: 4 }), 'with no window, every dated one is inside');
  assert.equal(conversationOf(conversationsOf(windowed), 'conv-a').calls, 1);
});

test('U14 Codex: after a broken running total, the next whole one is not counted even when it looks like a new call', async (t) => {
  // The reviewer's first probe. A at 09:00: 1,000 in, 100 out. B at 09:30,
  // its total broken, its own figure 200/20. C at 11:00: its own figure 300
  // in, 200 cached, 30 out, and a total 1,500/150 that moved past B's. C looks
  // like a new call, but with the total unknown before it, it is not counted
  // in any window, and B's usage is counted nowhere either.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'codex' });
  await plant(box, 'codex', home, {
    id: 'conv-c',
    started: at(9),
    lines: [
      codexTurn({ when: at(9) }),
      codexCall({
        when: at(9, 0),
        last: { input: 1000, cached: 0, output: 100 },
        total: { input: 1000, cached: 0, output: 100 },
      }),
      codexCallAnd({
        when: at(9, 30),
        last: { input: 200, cached: 100, output: 20 },
        total: { input: 1200, cached: 100, output: 120 },
      }, { output_tokens: undefined }),
      codexCall({
        when: at(11, 0),
        last: { input: 300, cached: 200, output: 30 },
        total: { input: 1500, cached: 300, output: 150 },
      }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-c') });

  const late = sessionOf(entryOf(await usage(box, '--since', at(10)), 'api-bot'), 'daily');
  const whole = sessionOf(entryOf(await usage(box), 'api-bot'), 'daily');

  assert.deepEqual(conversationsOf(late), [], 'from 10:00 nothing is counted: not C, and not B\'s usage');
  assert.deepEqual(leftOutOf(late), leftOut({ records_without_numbers: 1 }), 'C, and not B, which is before 10:00');

  const all = conversationOf(conversationsOf(whole), 'conv-c');
  assert.equal(all.calls, 1, 'A alone');
  assert.equal(tokensOf(all).input, 1000);
  assert.equal(tokensOf(all).cache_read, 0);
  assert.equal(tokensOf(all).output, 100);
  assert.deepEqual(leftOutOf(whole), leftOut({ records_without_numbers: 2 }), 'B and C');
});

/** A Codex event whose running total lacks its output: its own figure may be whole, its total is not. */
const codexBrokenTotal = ({ when, last, total }) => codexCallAnd({ when, last, total }, { output_tokens: undefined });

test('U14 Codex: after a broken running total, the next whole one is not counted even when it looks like a repeat, in any window', async (t) => {
  // The reviewer's second probe. B's total is broken, but what is left of it
  // stands where C's total does, and the own figures are the same: C looks
  // like B written down again. It is not counted either way, and it is named
  // only in a window that holds its own moment.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'codex' });
  await plant(box, 'codex', home, {
    id: 'conv-c',
    started: at(9),
    lines: [
      codexTurn({ when: at(9) }),
      codexCall({ when: at(9, 0), last: { input: 1000, output: 100 }, total: { input: 1000, output: 100 } }),
      codexBrokenTotal({ when: at(9, 30), last: { input: 200, output: 20 }, total: { input: 1200, output: 120 } }),
      codexCall({ when: at(11, 0), last: { input: 200, output: 20 }, total: { input: 1200, output: 120 } }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-c') });

  const late = sessionOf(entryOf(await usage(box, '--since', at(10)), 'api-bot'), 'daily');
  const whole = sessionOf(entryOf(await usage(box), 'api-bot'), 'daily');
  const early = sessionOf(entryOf(await usage(box, '--until', at(10)), 'api-bot'), 'daily');
  const both = sessionOf(entryOf(await usage(box, '--since', at(9, 15)), 'api-bot'), 'daily');

  assert.deepEqual(conversationsOf(late), [], 'from 10:00 nothing is counted');
  assert.deepEqual(leftOutOf(late), leftOut({ records_without_numbers: 1 }), 'C');

  const all = conversationOf(conversationsOf(whole), 'conv-c');
  assert.equal(all.calls, 1, 'A alone');
  assert.equal(tokensOf(all).input, 1000);
  assert.equal(tokensOf(all).output, 100);
  assert.deepEqual(leftOutOf(whole), leftOut({ records_without_numbers: 2 }), 'B and C');

  const first = conversationOf(conversationsOf(early), 'conv-c');
  assert.equal(first.calls, 1, 'A');
  assert.equal(tokensOf(first).input, 1000);
  assert.deepEqual(leftOutOf(early), leftOut({ records_without_numbers: 1 }), 'B; C is after 10:00');

  assert.deepEqual(conversationsOf(both), [], 'from 09:15, with B and C both inside, still nothing is counted');
  assert.deepEqual(leftOutOf(both), leftOut({ records_without_numbers: 2 }), 'B and C');
});

test('U14 Codex: after a broken running total, the next whole one is not counted even when its total moved past the broken one\'s', async (t) => {
  // The reviewer's third probe. B's total is broken, but its input (1,200)
  // and its total_tokens (1,320) are there, and C's stand higher (1,400 and
  // 1,540), with the same own figure: C looks like a second call the size of
  // B's. It is still not counted.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'codex' });
  await plant(box, 'codex', home, {
    id: 'conv-c',
    started: at(9),
    lines: [
      codexTurn({ when: at(9) }),
      codexCall({ when: at(9, 0), last: { input: 1000, output: 100 }, total: { input: 1000, output: 100 } }),
      codexBrokenTotal({ when: at(9, 30), last: { input: 200, output: 20 }, total: { input: 1200, output: 120 } }),
      codexCall({ when: at(11, 0), last: { input: 200, output: 20 }, total: { input: 1400, output: 140 } }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-c') });

  const late = sessionOf(entryOf(await usage(box, '--since', at(10)), 'api-bot'), 'daily');
  const whole = sessionOf(entryOf(await usage(box), 'api-bot'), 'daily');

  assert.deepEqual(conversationsOf(late), [], 'from 10:00 nothing is counted');
  assert.deepEqual(leftOutOf(late), leftOut({ records_without_numbers: 1 }), 'C');
  const all = conversationOf(conversationsOf(whole), 'conv-c');
  assert.equal(all.calls, 1, 'A alone');
  assert.equal(tokensOf(all).input, 1000);
  assert.equal(tokensOf(all).output, 100);
  assert.deepEqual(leftOutOf(whole), leftOut({ records_without_numbers: 2 }), 'B and C');
});

test('U14 Codex: after an undated broken running total, the next whole one is not counted, and the undated one is named as without time', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'codex' });
  await plant(box, 'codex', home, {
    id: 'conv-c',
    started: at(9),
    lines: [
      codexTurn({ when: at(9) }),
      codexCall({ when: at(9, 0), last: { input: 1000, output: 100 }, total: { input: 1000, output: 100 } }),
      codexBrokenTotal({ when: undefined, last: { input: 200, output: 20 }, total: { input: 1200, output: 120 } }),
      codexCall({ when: at(11, 0), last: { input: 200, output: 20 }, total: { input: 1200, output: 120 } }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-c') });

  const whole = sessionOf(entryOf(await usage(box), 'api-bot'), 'daily');
  const early = sessionOf(entryOf(await usage(box, '--until', at(10)), 'api-bot'), 'daily');

  const all = conversationOf(conversationsOf(whole), 'conv-c');
  assert.equal(all.calls, 1, 'A alone');
  assert.equal(tokensOf(all).input, 1000);
  assert.equal(tokensOf(all).output, 100);
  assert.deepEqual(leftOutOf(whole), leftOut({ records_without_numbers: 1, records_without_time: 1 }), 'C, and B');
  assert.deepEqual(leftOutOf(early), leftOut({ records_without_time: 1 }), 'before 10:00 only B, C being outside');
});

test('U14 Codex: an undated next whole one after a broken running total is not counted and is named as without time, and the one after it is its rise', async (t) => {
  // C has a whole total and no time. It is not counted, and it is named as
  // without time in every window. The total still resumes from C's: D at
  // 09:40 rose 300/30 above it, whatever D's own figure says.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'codex' });
  await plant(box, 'codex', home, {
    id: 'conv-c',
    started: at(9),
    lines: [
      codexTurn({ when: at(9) }),
      codexCall({ when: at(9, 0), last: { input: 1000, output: 100 }, total: { input: 1000, output: 100 } }),
      codexBrokenTotal({ when: at(9, 30), last: { input: 200, output: 20 }, total: { input: 1200, output: 120 } }),
      codexCall({ when: undefined, last: { input: 200, output: 20 }, total: { input: 1200, output: 120 } }),
      codexCall({ when: at(9, 40), last: { input: 50, output: 5 }, total: { input: 1500, output: 150 } }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-c') });

  const whole = sessionOf(entryOf(await usage(box), 'api-bot'), 'daily');
  const late = sessionOf(entryOf(await usage(box, '--since', at(9, 35)), 'api-bot'), 'daily');

  const all = conversationOf(conversationsOf(whole), 'conv-c');
  assert.equal(all.calls, 2, 'A and D');
  assert.equal(tokensOf(all).input, 1300, '1,000, and D\'s rise of 300');
  assert.equal(tokensOf(all).output, 130);
  assert.deepEqual(leftOutOf(whole), leftOut({ records_without_numbers: 1, records_without_time: 1 }), 'B, and C');

  const after = conversationOf(conversationsOf(late), 'conv-c');
  assert.equal(after.calls, 1, 'D');
  assert.equal(tokensOf(after).input, 300);
  assert.equal(tokensOf(after).output, 30);
  assert.deepEqual(leftOutOf(late), leftOut({ records_without_time: 1 }), 'C, whatever the window; B is before it');
});

test('U14 Codex: several broken running totals in a row make one next whole one that is not counted', async (t) => {
  // B1 at 09:20 and B2 at 09:40 both have broken totals; C at 11:00 is the
  // first whole total after them. Each of the three is named when its own
  // moment is in the window, once, and none of them is counted.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'codex' });
  await plant(box, 'codex', home, {
    id: 'conv-c',
    started: at(9),
    lines: [
      codexTurn({ when: at(9) }),
      codexCall({ when: at(9, 0), last: { input: 1000, output: 100 }, total: { input: 1000, output: 100 } }),
      codexBrokenTotal({ when: at(9, 20), last: { input: 200, output: 20 }, total: { input: 1200, output: 120 } }),
      codexBrokenTotal({ when: at(9, 40), last: { input: 200, output: 20 }, total: { input: 1200, output: 120 } }),
      codexCall({ when: at(11, 0), last: { input: 200, output: 20 }, total: { input: 1200, output: 120 } }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-c') });

  const split = sessionOf(entryOf(await usage(box, '--since', at(9, 30)), 'api-bot'), 'daily');
  const inside = sessionOf(entryOf(await usage(box, '--since', at(9, 10)), 'api-bot'), 'daily');
  const whole = sessionOf(entryOf(await usage(box), 'api-bot'), 'daily');

  assert.deepEqual(conversationsOf(split), [], 'from 09:30 nothing is counted');
  assert.deepEqual(leftOutOf(split), leftOut({ records_without_numbers: 2 }), 'B2, and C');

  assert.deepEqual(conversationsOf(inside), [], 'from 09:10, with all three inside, nothing is counted either');
  assert.deepEqual(leftOutOf(inside), leftOut({ records_without_numbers: 3 }), 'B1, B2 and C, once each');

  const all = conversationOf(conversationsOf(whole), 'conv-c');
  assert.equal(all.calls, 1, 'A alone');
  assert.equal(tokensOf(all).input, 1000);
  assert.equal(tokensOf(all).output, 100);
  assert.deepEqual(leftOutOf(whole), leftOut({ records_without_numbers: 3 }), 'B1, B2 and C');
});

test('U14 Claude Code: a call whose copy last written before the window is broken is not counted in that window, and is reported there', async (t) => {
  // One call written down three times, the middle copy broken. What it grew
  // inside a window that opens after the broken copy cannot be measured, so
  // that window counts none of it and names one record without numbers.
  // Measuring from the older good copy would charge the window with growth
  // made before it. A window that opens before the broken copy measures from
  // the good copy before it, as a broken copy inside the window always has.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [
      claudeCall({ when: at(9, 0), request: 'req-1', message: 'msg-1', input: 2, cacheRead: 500, output: 10 }),
      claudeCallAnd(
        { when: at(9, 30), request: 'req-1', message: 'msg-1', input: 2, cacheRead: 500 },
        { output_tokens: undefined },
      ),
      claudeCall({ when: at(11, 0), request: 'req-1', message: 'msg-1', input: 2, cacheRead: 500, output: 30 }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const after = sessionOf(entryOf(await usage(box, '--since', at(10)), 'api-bot'), 'daily');
  const before = sessionOf(entryOf(await usage(box, '--since', at(9, 15)), 'api-bot'), 'daily');
  const whole = sessionOf(entryOf(await usage(box), 'api-bot'), 'daily');

  assert.deepEqual(conversationsOf(after), [], 'from 10:00 nothing of the call is counted, not the 20 it grew since 09:00');
  assert.deepEqual(leftOutOf(after), leftOut({ records_without_numbers: 1 }), 'and it is named once in that window');

  assert.deepEqual(leftOutOf(before), leftOut({ records_without_numbers: 1 }), 'from 09:15 the broken copy is inside');
  const grown = conversationOf(conversationsOf(before), 'conv-a');
  assert.equal(grown.calls, 0, 'the call was made before 09:15');
  assert.equal(tokensOf(grown).output, 20, 'and grew 20 after it, measured from the good 09:00 copy');

  assert.deepEqual(leftOutOf(whole), leftOut({ records_without_numbers: 1 }));
  const all = conversationOf(conversationsOf(whole), 'conv-a');
  assert.equal(all.calls, 1);
  assert.equal(tokensOf(all).output, 30, 'the last copy written');
  assert.equal(tokensOf(all).cache_read, 500);
});

test('U14 Claude Code: an undated call or compaction is never counted and always reported, whatever the window', async (t) => {
  // Today a record with no timestamp counts as inside any window. A timestamp
  // that is not a moment is no better than none.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  const file = await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [
      claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 11, output: 13 }),
      claudeCompaction(at(9, 2)),
      claudeCall({ when: undefined, request: 'req-2', message: 'msg-2', input: 500, output: 500 }),
      claudeCompaction(undefined),
    ],
  });
  await slipIn(file, 3, claudeCall({ when: 'teatime', request: 'req-3', message: 'msg-3', input: 700, output: 700 }));
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const whole = sessionOf(entryOf(await usage(box), 'api-bot'), 'daily');
  const around = sessionOf(entryOf(await usage(box, '--since', at(9), '--until', at(10)), 'api-bot'), 'daily');
  const after = sessionOf(entryOf(await usage(box, '--since', at(12)), 'api-bot'), 'daily');

  for (const [name, session] of [['no window', whole], ['09:00 to 10:00', around]]) {
    const conversation = conversationOf(conversationsOf(session), 'conv-a');
    assert.equal(conversation.calls, 1, `${name}: only the dated call`);
    assert.equal(conversation.compactions, 1, `${name}: only the dated marker`);
    assert.equal(tokensOf(conversation).input, 11, `${name}: not 1,211`);
    assert.equal(tokensOf(conversation).output, 13, name);
    assert.deepEqual(leftOutOf(session), leftOut({ records_without_time: 3 }), `${name}: two calls and a marker`);
  }
  assert.deepEqual(conversationsOf(after), [], 'nothing dated is after 12:00');
  assert.deepEqual(leftOutOf(after), leftOut({ records_without_time: 3 }), 'and the undated three are still named');
});

test('U14 Codex: an undated token_count or compaction is never counted and is reported; an undated turn_context is not a gap', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'codex' });
  await plant(box, 'codex', home, {
    id: 'conv-c',
    started: at(9),
    lines: [
      codexTurn({ when: undefined }),
      codexCall({
        when: at(9, 1),
        last: { input: 1000, cached: 0, output: 50 },
        total: { input: 1000, cached: 0, output: 50 },
      }),
      codexCompaction(at(9, 2)),
      codexCall({
        when: undefined,
        last: { input: 500, cached: 0, output: 5 },
        total: { input: 1500, cached: 0, output: 55 },
      }),
      codexCompaction(undefined),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-c') });

  const session = sessionOf(entryOf(await usage(box), 'api-bot'), 'daily');

  assert.deepEqual(leftOutOf(session), leftOut({ records_without_time: 2 }), 'the call and the marker, not the turn_context');
  const conversation = conversationOf(conversationsOf(session), 'conv-c');
  assert.equal(conversation.calls, 1);
  assert.equal(conversation.compactions, 1);
  assert.equal(tokensOf(conversation).input, 1000, 'not 1,500');
  assert.equal(tokensOf(conversation).output, 50);
});

test('U14 a record with neither a time nor its numbers is reported once, as without time', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  const madeCodex = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'codex-bot', '--harness', 'codex']);
  assert.equal(madeCodex.code, 0, madeCodex.stderr);
  const addedCodex = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'codex-bot', '--name', 'daily']);
  assert.equal(addedCodex.code, 0, addedCodex.stderr);
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [
      claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 3, output: 4 }),
      claudeCallAnd({ when: undefined, request: 'req-2', message: 'msg-2', input: 9 }, { output_tokens: undefined }),
    ],
  });
  await plant(box, 'codex', botHomeOf(bots, 'codex-bot'), {
    id: 'conv-c',
    started: at(9),
    lines: [
      codexTurn({ when: at(9) }),
      codexCall({ when: at(9, 1), last: { input: 10, output: 1 }, total: { input: 10, output: 1 } }),
      codexCallAnd({ when: undefined, last: { input: 10, output: 1 }, total: { input: 20, output: 2 } }, { output_tokens: undefined }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });
  await bookSays(bots, 'codex-bot', { daily: ran('conv-c') });

  const answer = await usage(box);

  assert.deepEqual(leftOutOf(sessionOf(entryOf(answer, 'api-bot'), 'daily')), leftOut({ records_without_time: 1 }), 'Claude Code');
  assert.deepEqual(leftOutOf(sessionOf(entryOf(answer, 'codex-bot'), 'daily')), leftOut({ records_without_time: 1 }), 'Codex');
});

test('U14 a conversation whose every record was left out has no row, and its gaps are still reported', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 3, output: 4 })],
  });
  const file = await plant(box, 'claude', home, {
    id: 'conv-empty',
    started: at(9),
    lines: [
      claudeCall({ when: undefined, request: 'req-2', message: 'msg-2', input: 50, output: 50 }),
      claudeCallAnd({ when: at(9, 5), request: 'req-3', message: 'msg-3', input: 60 }, { cache_read_input_tokens: undefined }),
    ],
  });
  await slipIn(file, 1, TORN);
  await bookSays(bots, 'api-bot', { daily: ran('conv-a', 'conv-empty') });

  const session = sessionOf(entryOf(await usage(box), 'api-bot'), 'daily');

  assert.deepEqual(idsOf(conversationsOf(session)), ['conv-a'], 'a conversation that counted nothing is not listed');
  assert.deepEqual(
    leftOutOf(session),
    leftOut({ broken_lines: 1, records_without_numbers: 1, records_without_time: 1 }),
    'but what it left out is',
  );
});

test('U14 --session reports that session\'s own gaps, not the bot\'s', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude', sessions: ['daily', 'review'] });
  const daily = await plant(box, 'claude', home, {
    id: 'conv-d',
    started: at(9),
    lines: [claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 3, output: 4 })],
  });
  await slipIn(daily, 2, TORN, 'garbage');
  await plant(box, 'claude', home, {
    id: 'conv-r',
    started: at(9),
    lines: [
      claudeCall({ when: at(9, 1), request: 'req-2', message: 'msg-2', input: 3, output: 4 }),
      claudeCall({ when: undefined, request: 'req-3', message: 'msg-3', input: 3, output: 4 }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-d'), review: ran('conv-r') });

  const all = entryOf(await usage(box), 'api-bot');
  const one = entryOf(await usage(box, '--bot', 'api-bot', '--session', 'review'), 'api-bot');

  assert.deepEqual(leftOutOf(sessionOf(all, 'daily')), leftOut({ broken_lines: 2 }), 'daily has its own');
  assert.deepEqual((one.sessions ?? []).map((session) => session.name), ['review']);
  assert.deepEqual(leftOutOf(sessionOf(one, 'review')), leftOut({ records_without_time: 1 }), 'review\'s alone, not daily\'s added in');
});

test('U14 gaps in a transcript no session claims are reported as the bot\'s unclaimed, and under no session', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  const mine = await plant(box, 'claude', home, {
    id: 'conv-mine',
    started: at(9),
    lines: [claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 3, output: 4 })],
  });
  await slipIn(mine, 2, TORN);
  await plant(box, 'claude', home, {
    id: 'conv-nobodys',
    started: at(10),
    lines: [
      claudeCall({ when: at(10, 1), request: 'req-2', message: 'msg-2', input: 640, output: 21 }),
      claudeCall({ when: undefined, request: 'req-3', message: 'msg-3', input: 1000, output: 1000 }),
      claudeCallAnd({ when: at(10, 2), request: 'req-4', message: 'msg-4', input: 1000 }, { output_tokens: undefined }),
      claudeCallAnd({ when: at(10, 3), request: 'req-5', message: 'msg-5', input: 1000 }, { input_tokens: null }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-mine') });

  const entry = entryOf(await usage(box), 'api-bot');

  assert.deepEqual(
    leftOutOf(entry, 'unclaimed_not_counted'),
    leftOut({ records_without_numbers: 2, records_without_time: 1 }),
  );
  assert.deepEqual(leftOutOf(sessionOf(entry, 'daily')), leftOut({ broken_lines: 1 }), 'daily keeps only its own');
  const nobodys = conversationOf(entry.unclaimed, 'conv-nobodys');
  assert.equal(nobodys.calls, 1);
  assert.equal(tokensOf(nobodys).input, 640, 'the unclaimed totals cover only what was counted');
  assert.equal(tokensOf(nobodys).output, 21);
});

test('U14 the plain report names what a session left out, each count with its kind, on a not counted line', async (t) => {
  // Three broken lines, four records without numbers, five without time: the
  // counts differ so that each one can only be the count it is.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  const file = await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [
      claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 3, output: 4 }),
      ...[1, 2, 3, 4].map((n) => claudeCallAnd(
        { when: at(9, 10 + n), request: `req-n${n}`, message: `msg-n${n}`, input: 9 },
        { output_tokens: undefined },
      )),
      ...[1, 2, 3, 4, 5].map((n) => claudeCall({ when: undefined, request: `req-t${n}`, message: `msg-t${n}`, input: 9 })),
    ],
  });
  await slipIn(file, 2, TORN, 'garbage', '[]');
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const result = await box.run(['usage', '--bots', 'bots']);

  assert.equal(result.code, 0, result.stderr);
  const lines = notCountedLines(result.stdout);
  assert.equal(lines.length, 1, `one line should say what daily did not count, got:\n${result.stdout}`);
  const [line] = lines;
  for (const [count, kind] of [[3, /broken/i], [4, /number/i], [5, /time/i]]) {
    assert.match(line, new RegExp(`\\b${count}\\b`), `the line should give the count ${count}, got: ${line}`);
    assert.match(line, kind, `and name its kind, ${kind}, got: ${line}`);
  }
});

test('U14 the plain report names what the bot\'s unclaimed transcripts left out', { skip: UNREADABLE_NEEDS_A_USER }, async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 3, output: 4 })],
  });
  for (const id of ['conv-x', 'conv-y']) {
    const file = await plant(box, 'claude', home, {
      id,
      started: at(9),
      lines: [claudeCall({ when: at(9, 2), request: `req-${id}`, message: `msg-${id}`, input: 3, output: 4 })],
    });
    await chmod(file, 0o000);
  }
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const result = await box.run(['usage', '--bots', 'bots']);

  assert.equal(result.code, 0, result.stderr);
  const lines = notCountedLines(result.stdout);
  assert.equal(lines.length, 1, `one line should say what the unclaimed transcripts did not count, got:\n${result.stdout}`);
  assert.match(lines[0], /\b2\b/, `two transcripts, got: ${lines[0]}`);
  assert.match(lines[0], /unreadable/i, `that could not be read, got: ${lines[0]}`);
});

test('U14 a clean plain report says nothing about what was not counted', async (t) => {
  // The pair of the two above: the same report, with nothing left out.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 3, output: 4 })],
  });
  await plant(box, 'claude', home, {
    id: 'conv-nobodys',
    started: at(9),
    lines: [claudeCall({ when: at(9, 2), request: 'req-2', message: 'msg-2', input: 3, output: 4 })],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const result = await box.run(['usage', '--bots', 'bots']);

  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout.includes('conv-a') && result.stdout.includes('conv-nobodys'), `the report is there, got:\n${result.stdout}`);
  assert.deepEqual(notCountedLines(result.stdout), [], `nothing was left out, got:\n${result.stdout}`);
});
