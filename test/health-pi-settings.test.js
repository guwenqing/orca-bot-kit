// `obk health` reads a Pi session's settings from Pi's own record (#660, H1).
//
// For a running Pi session (its tab live, `pi` in front), the `sessions` entry
// says what Pi ran, from Pi's record of the conversation the book holds. Only
// the lines since the kit last started the session count: the book's
// `launched` time, as for the other harnesses. Pi's record is one JSON line
// each (tech notes, section 6):
//
//   {"type":"session","version":3,"id":"<id>","timestamp":"<ISO>","cwd":"<folder>"}
//   {"type":"model_change","timestamp":"<ISO>","provider":"openai","modelId":"gpt-6-luna"}
//   {"type":"thinking_level_change","timestamp":"<ISO>","thinkingLevel":"low"}
//   {"type":"message","timestamp":"<ISO>","message":{"role":"assistant","provider":"openai","model":"gpt-6-luna","thinkingLevel":"low",...}}
//
// What is pinned:
//
//   - The model: look at the lines since the start, from the newest back,
//     and skip an assistant reply whose `api` is "pi-virtual" (a failed
//     routing, which Pi skips too). The first line that names a model
//     decides. A `model_change` decides alone: `<provider>/<modelId>`. An
//     assistant reply names V, its own `<provider>/<model>`; C is the last
//     `model_change` before it in the whole record, before the start too.
//       a. No C, or C is V: V alone.
//       b. C proven physical (anywhere in the record, a reply with an `api`
//          other than "pi-virtual" names it): V alone. On resume with
//          --model, Pi writes no new model_change, so an old physical one
//          can stand before replies on a new model.
//       c. Otherwise open: a mismatch for both V and C is `mismatch`,
//          anything else `unknown`; observed is V. C may be a virtual model
//          (a router, such as `router/auto`) that Pi follows, its replies
//          naming the physical model it routed to (Pi 1.3.0,
//          getBranchSelection). But on resume Pi falls back to the physical
//          model that answered last when the virtual model is no longer
//          registered (Pi's docs/virtual-models.md), and the record cannot
//          show that. So a `pi.virtual-model-state` line, or a failed
//          routing, proves nothing either way.
//   - The thinking level the same way. A `thinking_level_change` decides
//     alone. A reply names L; T is the last `thinking_level_change` before it
//     in the whole record. No T, or T is L: L alone. The reply's model came
//     out as a or b: L alone. Otherwise open: a mismatch for both L and T is
//     `mismatch`, anything else `unknown`; observed is L.
//   - bot.yaml's model is a Pi model pattern: `openai/gpt-6-luna` or
//     `gpt-6-luna`, maybe with a trailing `:<thinking level>` (off, minimal,
//     low, medium, high, xhigh, max) that is not part of the model. A `:8b`
//     is no thinking level, and stays part of the model. Without regard to
//     case, and without that suffix, it is `match` when it equals
//     `<provider>/<id>` or `<id>`; `unknown` when Pi could resolve it
//     fuzzily (the id holds the whole pattern, or the pattern is `p/rest`
//     with provider `p` and an id that holds `rest`); otherwise `mismatch`.
//     For a choice that decides alone, observed is that choice.
//   - Known limits, not tested: a virtual model always shows `unknown`
//     beside a reply on its physical model, since the record cannot show its
//     router is still registered. A reply proves C physical, but an
//     extension can later register a virtual model with the same id, which
//     then holds. Pi also matches a model's display name, which the record
//     does not hold, so such a pattern shows as a mismatch.
//   - A setting the session does not ask for is `not-asked-for`, with what
//     was observed. No record line since the start is `unknown`. Approval is
//     always `unknown`, configured `dangerously-skip`: Pi writes nothing about
//     it. Context is `not-asked-for`: Pi has none.
//   - A mismatch on a running Pi session gives one `session` finding, as on
//     the other harnesses: it names the session, each setting that differs,
//     what was asked and what runs. A session whose shell is in front is not
//     running, and its settings give no finding.
//
// The wording is the implementer's. Every run is in the sandbox
// (helpers/cli.js), with a fake `pi` on PATH (helpers/pi.js). Pi's records are
// planted under the sandbox's HOME. Nothing here reaches the real `pi`, the
// real ~/.pi or the real Orca.

import assert from 'node:assert/strict';
import { readFile, utimes, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import { bookOf, botHomeOf, createSandbox, sessionIn } from './helpers/cli.js';
import { fakePi, PI_MODELS, piSessionOnRecord } from './helpers/pi.js';

/** The kinds a finding can be. */
const KINDS = ['orca', 'config', 'skill', 'session', 'leftover', 'process', 'mail'];
const STATES = ['match', 'mismatch', 'not-asked-for', 'unknown'];
const SETTINGS = ['model', 'effort', 'context', 'approval'];

const BOT = 'pier';

/** The models the fake Pi lists here: its own, and the ones these cases name. */
const MODELS = [...PI_MODELS, 'openai/gpt-6-luna', 'anthropic/gpt-6-luna', 'router/auto', 'openrouter/anthropic/claude-opus-5-5'];

// ---------------------------------------------------------------- the fleet

/** Run one more `obk` command that has to work for the test to mean anything. */
async function obk(box, ...args) {
  const result = await box.run([...args]);
  assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return result;
}

/**
 * A bots folder with Bot Father, and one Pi bot whose sessions are each
 * `[name, ...flags]`, the flags as `session add` takes them, all brought up.
 */
async function piBotUp(box, sessions) {
  await fakePi(box, { models: MODELS });
  await obk(box, 'init', '--bots', 'bots', '--harness', 'claude');
  await obk(box, 'bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'pi');
  for (const [name, ...flags] of sessions) {
    await obk(box, 'session', 'add', '--bots', 'bots', '--bot', BOT, '--name', name, ...flags);
  }
  await obk(box, 'up', '--bots', 'bots', '--bot', BOT);
  return box.path('bots');
}

/** Change what one bot's book says about its sessions, as a person editing it by hand would. */
async function editBook(bots, bot, change) {
  const file = bookOf(bots, bot);
  const book = parse(await readFile(file, 'utf8'));
  change(book.sessions);
  await writeFile(file, stringify(book));
}

/** Put a shell in front of one session's tab alone, in the fake Orca's world: Pi quit. */
async function shellInFront(box, bots, session) {
  const { tab } = await sessionIn(bots, BOT, session);
  const terminals = await box.orca.terminals();
  assert.ok(terminals.some((one) => one.tabId === tab), `the premise: Orca has ${session}'s tab ${tab}`);
  await box.orca.set({ terminals: terminals.map((one) => (one.tabId === tab ? { ...one, foreground: 'shell' } : one)) });
}

// ------------------------------------------------------------- Pi's record

/** A moment on the day these records are set. */
const onTheDay = (hour, minute = 0) =>
  `2026-10-19T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;

/** When the kit last started each session here: before every line the records carry, unless a case says so. */
const LAUNCHED = onTheDay(8);

/** A conversation id, as the kit chooses one for Pi. */
const conv = (n) => `0199c0de-${String(n).padStart(4, '0')}-4444-8888-cccccccccccc`;

let lineNo = 0;
const nextId = () => {
  lineNo += 1;
  return `e${lineNo}`;
};

/** Pi changed its model: `{"type":"model_change","provider","modelId"}`. */
const modelChange = (when, provider, modelId) => ({ type: 'model_change', id: nextId(), parentId: null, timestamp: when, provider, modelId });

/** Pi changed its thinking level: `{"type":"thinking_level_change","thinkingLevel"}`. */
const thinkingChange = (when, thinkingLevel) => ({ type: 'thinking_level_change', id: nextId(), parentId: null, timestamp: when, thinkingLevel });

/** Something the user said. It names no model and no level. */
const userSaid = (when) => ({
  type: 'message',
  id: nextId(),
  parentId: null,
  timestamp: when,
  message: { role: 'user', content: [{ type: 'text', text: 'Carry on with the queue.' }], timestamp: Date.parse(when) },
});

/**
 * One answer of Pi's: an assistant message with the provider and the model it
 * ran on, and the thinking level when `thinkingLevel` is given. One left out
 * is a message that names none. Its `api` is a real provider's unless a case
 * says otherwise, so a reply proves the model it names is physical.
 */
const piAnswered = (when, { provider, model, thinkingLevel, api = 'openai-responses', stopReason = 'stop' }) => ({
  type: 'message',
  id: nextId(),
  parentId: null,
  timestamp: when,
  message: {
    role: 'assistant',
    content: [{ type: 'text', text: 'OK' }],
    api,
    provider,
    model,
    ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
    usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12 },
    stopReason,
    timestamp: Date.parse(when),
  },
});

/** A failed routing of a virtual model: Pi writes it as a reply with api "pi-virtual", naming the virtual model. */
const routingFailed = (when, provider, model) => piAnswered(when, { provider, model, api: 'pi-virtual', stopReason: 'error' });

/** Pi's own note of a virtual model's state: the model was virtual once. Whether Pi still has it now, the record cannot show. */
const virtualState = (when, provider, modelId) => ({
  type: 'custom',
  id: nextId(),
  parentId: null,
  timestamp: when,
  customType: 'pi.virtual-model-state',
  data: { provider, modelId },
});

/**
 * One session running conversation `id` since the kit started it at
 * `launched`: Pi's record for `id` planted in the bot folder's Pi store, begun
 * at `begun` with `lines` and last changed at its last line, and the book
 * naming `id` as the session's conversation, launched at `launched`.
 */
async function talking(box, bots, session, id, lines, { begun = LAUNCHED, launched = LAUNCHED } = {}) {
  const file = await piSessionOnRecord({ home: box.home, cwd: botHomeOf(bots, BOT), id, at: new Date(begun), lines });
  // Pi writes the file turn by turn, so it was last changed at its last line.
  const last = new Date(Math.max(Date.parse(begun), ...lines.map((line) => Date.parse(line.timestamp))));
  await utimes(file, last, last);
  await editBook(bots, BOT, (sessions) => {
    sessions[session].session = id;
    sessions[session].launched = launched;
  });
}

/** The lines of a Pi session that ran `provider/model` at `level`, after the kit started it. */
const ran = (provider, model, level) => [
  modelChange(onTheDay(9), provider, model),
  thinkingChange(onTheDay(9), level),
  userSaid(onTheDay(9, 1)),
  piAnswered(onTheDay(9, 2), { provider, model, thinkingLevel: level }),
];

// ------------------------------------------------------------- what it answers

/**
 * Run the health check for JSON and hold it to its shape: findings of the
 * kinds there are, a `sessions` list whose every entry says every setting in
 * one of the four states, and the exit code the findings call for.
 */
async function found(box) {
  const result = await box.run(['health', '--bots', 'bots', '--json']);
  assert.equal(result.stderr, '', `a health run reports on stdout, and put this on stderr: ${result.stderr}`);
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  for (const finding of answer.found) {
    assert.ok(KINDS.includes(finding.kind), `a finding's kind is one of ${KINDS.join(', ')}, got: ${JSON.stringify(finding)}`);
  }
  for (const entry of answer.sessions) {
    for (const setting of SETTINGS) {
      assert.ok(STATES.includes(entry.settings?.[setting]?.state), `${setting} is one of ${STATES.join(', ')}, got: ${JSON.stringify(entry)}`);
    }
  }
  assert.equal(result.code, answer.found.length === 0 ? 0 : 1, `${answer.found.length} findings, exit ${result.code}`);
  return answer;
}

/** The one entry of `sessions` about one session of the Pi bot. */
function entryOf(answer, session) {
  const entries = answer.sessions.filter((one) => one.bot === BOT && one.session === session);
  assert.equal(entries.length, 1, `one entry should be about ${BOT} ${session}, got: ${JSON.stringify(answer.sessions, null, 2)}`);
  return entries[0];
}

/** Everything one finding puts in front of a reader. */
const wordsOf = (finding) => `${finding.where} ${finding.says}`;

/** Whether `word` is in `text` as a word of its own, not inside another. */
const hasWord = (text, word) => new RegExp(`(^|[^A-Za-z0-9_-])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9_-])`).test(text);

/** The `session` findings about one session of the Pi bot. */
const sessionFindings = (answer, session) => answer.found.filter((one) => one.kind === 'session' && one.bot === BOT && hasWord(wordsOf(one), session));

/** One setting of one entry is exactly this. */
function assertSetting(entry, setting, expected, why) {
  assert.deepEqual(entry.settings[setting], expected, `${entry.session} ${setting}: ${why}, got: ${JSON.stringify(entry.settings[setting])}`);
}

/** One setting's state and what was observed, whatever it says was configured. */
function assertSeen(entry, setting, { state, observed }, why) {
  const got = entry.settings[setting];
  assert.deepEqual({ state: got.state, observed: got.observed }, { state, observed }, `${entry.session} ${setting}: ${why}, got: ${JSON.stringify(got)}`);
}

// ---------------------------------------------------------------------------
// The whole entry of a session that runs what bot.yaml asks for.
// ---------------------------------------------------------------------------

test('H1 a running Pi session on the model and level bot.yaml asks for: model and effort match, as Pi recorded them; context not asked for; approval unknown at dangerously-skip; no finding', async (t) => {
  const box = await createSandbox(t);
  const bots = await piBotUp(box, [['daily', '--model', 'openai/gpt-6-luna', '--effort', 'low']]);
  await talking(box, bots, 'daily', conv(1), ran('openai', 'gpt-6-luna', 'low'));

  const answer = await found(box);

  const entry = entryOf(answer, 'daily');
  assert.equal(entry.harness, 'pi', `the entry names the harness, got: ${JSON.stringify(entry)}`);
  assert.equal(entry.running, 'yes', `pi is in front of its tab, got: ${JSON.stringify(entry)}`);
  assert.equal(entry.conversation, conv(1), 'the conversation is the one the book holds');
  assertSetting(entry, 'model', { state: 'match', configured: 'openai/gpt-6-luna', observed: 'openai/gpt-6-luna' }, 'the model asked for ran');
  assertSetting(entry, 'effort', { state: 'match', configured: 'low', observed: 'low' }, 'low asked for, low ran');
  assertSetting(entry, 'context', { state: 'not-asked-for' }, 'Pi has no context setting');
  assertSetting(entry, 'approval', { state: 'unknown', configured: 'dangerously-skip' }, 'Pi writes nothing about approval');
  assert.deepEqual(answer.found.filter((one) => one.bot === BOT), [], `nothing is wrong with the Pi bot, got: ${JSON.stringify(answer.found, null, 2)}`);
});

// ---------------------------------------------------------------------------
// Which models match: one bot, one session per case, one health run.
// ---------------------------------------------------------------------------

test('H1 Pi model patterns: with or without the provider, a trailing thinking level, and in any case, match; a part of the name Pi could resolve to is unknown; another provider or model is a mismatch', async (t) => {
  const cases = [
    { name: 'full', model: 'openai/gpt-6-luna', ran: ['openai', 'gpt-6-luna'], state: 'match' },
    { name: 'bare', model: 'gpt-6-luna', ran: ['openai', 'gpt-6-luna'], state: 'match' },
    { name: 'levelled', model: 'openai/gpt-6-luna:high', ran: ['openai', 'gpt-6-luna'], state: 'match' },
    { name: 'bare-off', model: 'gpt-6-luna:off', ran: ['openai', 'gpt-6-luna'], state: 'match' },
    // Pi matches a model reference without regard to case.
    { name: 'upper-full', model: 'OpenAI/GPT-6-LUNA', ran: ['openai', 'gpt-6-luna'], state: 'match' },
    { name: 'upper-bare', model: 'GPT-6-Luna', ran: ['openai', 'gpt-6-luna'], state: 'match' },
    // `:8b` is no thinking level: it is part of the model's own name.
    { name: 'own-colon', model: 'ollama/llama3:8b', ran: ['ollama', 'llama3:8b'], state: 'match' },
    // Pi could resolve these fuzzily to what ran, or to another model: the
    // kit cannot see Pi's catalog, so it cannot tell.
    { name: 'cut-colon', model: 'ollama/llama3', ran: ['ollama', 'llama3:8b'], state: 'unknown' },
    { name: 'prefix', model: 'openai/gpt-6', ran: ['openai', 'gpt-6-luna'], state: 'unknown' },
    { name: 'bare-part', model: 'luna', ran: ['openai', 'gpt-6-luna'], state: 'unknown' },
    { name: 'other-provider', model: 'anthropic/gpt-6-luna', ran: ['openai', 'gpt-6-luna'], state: 'mismatch' },
    { name: 'other-model', model: 'gpt-6-luna', ran: ['openai', 'gpt-6.1-sol'], state: 'mismatch' },
    // A model id with a slash in it: the bare id matches, and a part of it is unknown.
    { name: 'nested-full', model: 'openrouter/anthropic/claude-opus-5-5', ran: ['openrouter', 'anthropic/claude-opus-5-5'], state: 'match' },
    { name: 'nested-id', model: 'anthropic/claude-opus-5-5', ran: ['openrouter', 'anthropic/claude-opus-5-5'], state: 'match' },
    { name: 'nested-part', model: 'anthropic/claude-opus', ran: ['openrouter', 'anthropic/claude-opus-5-5'], state: 'unknown' },
  ];
  const box = await createSandbox(t);
  const bots = await piBotUp(box, cases.map(({ name, model }) => [name, '--model', model]));
  for (const [n, { name, ran: [provider, model] }] of cases.entries()) {
    await talking(box, bots, name, conv(10 + n), [modelChange(onTheDay(9), provider, model), userSaid(onTheDay(9, 1))]);
  }

  const answer = await found(box);

  for (const { name, model, ran: [provider, ranModel], state } of cases) {
    assertSeen(entryOf(answer, name), 'model', { state, observed: `${provider}/${ranModel}` }, `bot.yaml asks for ${model} and Pi ran ${provider}/${ranModel}`);
  }
  for (const { name } of cases.filter((one) => one.state !== 'mismatch')) {
    assert.deepEqual(sessionFindings(answer, name), [], `${name} is a match or unknown, and neither is a finding, got: ${JSON.stringify(answer.found, null, 2)}`);
  }
  for (const { name } of cases.filter((one) => one.state === 'mismatch')) {
    assert.equal(sessionFindings(answer, name).length, 1, `${name} is a mismatch, and gets its finding, got: ${JSON.stringify(answer.found, null, 2)}`);
  }
});

test('H1 an assistant message names the model too: its provider and model', async (t) => {
  const box = await createSandbox(t);
  const bots = await piBotUp(box, [['daily', '--model', 'gpt-6-luna'], ['nightly', '--model', 'gpt-6-luna']]);
  // No model_change line at all: the answers alone say what ran.
  await talking(box, bots, 'daily', conv(1), [userSaid(onTheDay(9)), piAnswered(onTheDay(9, 1), { provider: 'openai', model: 'gpt-6-luna' })]);
  await talking(box, bots, 'nightly', conv(2), [userSaid(onTheDay(9)), piAnswered(onTheDay(9, 1), { provider: 'openai', model: 'gpt-6.1-sol' })]);

  const answer = await found(box);

  assertSeen(entryOf(answer, 'daily'), 'model', { state: 'match', observed: 'openai/gpt-6-luna' }, 'the answer ran the model asked for');
  assertSeen(entryOf(answer, 'nightly'), 'model', { state: 'mismatch', observed: 'openai/gpt-6.1-sol' }, 'the answer ran another model');
});

// ---------------------------------------------------------------------------
// Effort is Pi's thinking level.
// ---------------------------------------------------------------------------

test('H1 effort matches Pi\'s thinking level only when they are equal, from a thinking_level_change or an assistant message', async (t) => {
  const box = await createSandbox(t);
  const bots = await piBotUp(box, [
    ['same', '--effort', 'high'],
    ['lower', '--effort', 'high'],
    ['by-answer', '--effort', 'medium'],
    ['answer-differs', '--effort', 'medium'],
  ]);
  await talking(box, bots, 'same', conv(1), [thinkingChange(onTheDay(9), 'high'), userSaid(onTheDay(9, 1))]);
  await talking(box, bots, 'lower', conv(2), [thinkingChange(onTheDay(9), 'low'), userSaid(onTheDay(9, 1))]);
  await talking(box, bots, 'by-answer', conv(3), [userSaid(onTheDay(9)), piAnswered(onTheDay(9, 1), { provider: 'openai', model: 'gpt-6-luna', thinkingLevel: 'medium' })]);
  await talking(box, bots, 'answer-differs', conv(4), [userSaid(onTheDay(9)), piAnswered(onTheDay(9, 1), { provider: 'openai', model: 'gpt-6-luna', thinkingLevel: 'xhigh' })]);

  const answer = await found(box);

  assertSetting(entryOf(answer, 'same'), 'effort', { state: 'match', configured: 'high', observed: 'high' }, 'high asked for, high ran');
  assertSetting(entryOf(answer, 'lower'), 'effort', { state: 'mismatch', configured: 'high', observed: 'low' }, 'high asked for, low ran');
  assertSetting(entryOf(answer, 'by-answer'), 'effort', { state: 'match', configured: 'medium', observed: 'medium' }, 'the answer ran at medium');
  assertSetting(entryOf(answer, 'answer-differs'), 'effort', { state: 'mismatch', configured: 'medium', observed: 'xhigh' }, 'the answer ran at xhigh');
});

// ---------------------------------------------------------------------------
// Not asked for, and unknown.
// ---------------------------------------------------------------------------

test('H1 a Pi session that names no model and no effort: both not-asked-for, with what Pi ran; no finding', async (t) => {
  const box = await createSandbox(t);
  const bots = await piBotUp(box, [['daily']]);
  await talking(box, bots, 'daily', conv(1), ran('openai', 'gpt-6.1-sol', 'minimal'));

  const answer = await found(box);

  const entry = entryOf(answer, 'daily');
  assertSetting(entry, 'model', { state: 'not-asked-for', observed: 'openai/gpt-6.1-sol' }, 'the session names no model');
  assertSetting(entry, 'effort', { state: 'not-asked-for', observed: 'minimal' }, 'the session names no effort');
  assertSetting(entry, 'approval', { state: 'unknown', configured: 'dangerously-skip' }, 'Pi writes nothing about approval');
  assert.deepEqual(sessionFindings(answer, 'daily'), [], `nothing asked for differs, got: ${JSON.stringify(answer.found, null, 2)}`);
});

test('H1 no record of the book\'s conversation, or one with no line since its header: model and effort unknown, never taken from another conversation\'s record; no settings finding', async (t) => {
  const box = await createSandbox(t);
  const bots = await piBotUp(box, [
    ['nofile', '--model', 'openai/gpt-6-luna', '--effort', 'low'],
    ['header', '--model', 'openai/gpt-6-luna', '--effort', 'low'],
  ]);
  await editBook(bots, BOT, (sessions) => {
    sessions.nofile.session = conv(1);
    sessions.nofile.launched = LAUNCHED;
  });
  await talking(box, bots, 'header', conv(2), []);
  // Another conversation in the same folder, which the book does not hold,
  // ran another model at another level after the start. It is not either
  // session's record.
  await piSessionOnRecord({ home: box.home, cwd: botHomeOf(bots, BOT), id: conv(3), at: new Date(LAUNCHED), lines: ran('openai', 'gpt-6.1-sol', 'high') });

  const answer = await found(box);

  for (const session of ['nofile', 'header']) {
    const entry = entryOf(answer, session);
    assertSetting(entry, 'model', { state: 'unknown', configured: 'openai/gpt-6-luna' }, 'no line since the start names a model');
    assertSetting(entry, 'effort', { state: 'unknown', configured: 'low' }, 'no line since the start names a level');
    assertSetting(entry, 'approval', { state: 'unknown', configured: 'dangerously-skip' }, 'Pi writes nothing about approval');
    assert.deepEqual(
      sessionFindings(answer, session).filter((one) => one.says.includes('gpt-6.1-sol')),
      [],
      `unknown is no mismatch, got: ${JSON.stringify(answer.found, null, 2)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// The latest line wins, and only lines since the start count.
// ---------------------------------------------------------------------------

test('H1 a model_change or thinking_level_change after the last reply decides alone; a reply on another model than the unproven model_change before it is undecided; a reply that names no level leaves the level to the thinking_level_change', async (t) => {
  const box = await createSandbox(t);
  const bots = await piBotUp(box, [
    ['answer-last', '--model', 'gpt-6-luna', '--effort', 'high'],
    ['change-last', '--model', 'gpt-6-luna', '--effort', 'high'],
    ['no-level', '--model', 'gpt-6-luna', '--effort', 'low'],
  ]);
  await talking(box, bots, 'answer-last', conv(1), [
    modelChange(onTheDay(9), 'openai', 'gpt-6.1-sol'),
    thinkingChange(onTheDay(9), 'low'),
    userSaid(onTheDay(9, 1)),
    piAnswered(onTheDay(9, 5), { provider: 'openai', model: 'gpt-6-luna', thinkingLevel: 'high' }),
  ]);
  await talking(box, bots, 'change-last', conv(2), [
    userSaid(onTheDay(9)),
    piAnswered(onTheDay(9, 1), { provider: 'openai', model: 'gpt-6-luna', thinkingLevel: 'high' }),
    modelChange(onTheDay(9, 5), 'openai', 'gpt-6.1-sol'),
    thinkingChange(onTheDay(9, 5), 'medium'),
  ]);
  // The last answer names a model and no level: the level stays the one
  // the thinking_level_change gave.
  await talking(box, bots, 'no-level', conv(3), [
    modelChange(onTheDay(9), 'openai', 'gpt-6.1-sol'),
    thinkingChange(onTheDay(9), 'low'),
    userSaid(onTheDay(9, 1)),
    piAnswered(onTheDay(9, 5), { provider: 'openai', model: 'gpt-6-luna' }),
  ]);

  const answer = await found(box);

  // Nothing in the record says whether openai/gpt-6.1-sol is virtual (Pi
  // followed it) or physical (Pi was resumed on another model): undecided.
  assertSeen(entryOf(answer, 'answer-last'), 'model', { state: 'unknown', observed: 'openai/gpt-6-luna' }, 'the reply matches, the model_change before it does not, and neither is proven');
  assertSeen(entryOf(answer, 'answer-last'), 'effort', { state: 'unknown', observed: 'high' }, 'the reply\'s model is undecided, so its level is too');
  assertSeen(entryOf(answer, 'change-last'), 'model', { state: 'mismatch', observed: 'openai/gpt-6.1-sol' }, 'the model_change after the answer says what runs now');
  assertSeen(entryOf(answer, 'change-last'), 'effort', { state: 'mismatch', observed: 'medium' }, 'the thinking_level_change after the answer says the level now');
  assertSeen(entryOf(answer, 'no-level'), 'model', { state: 'unknown', observed: 'openai/gpt-6-luna' }, 'the reply matches, the unproven model_change before it does not');
  assertSeen(entryOf(answer, 'no-level'), 'effort', { state: 'match', observed: 'low' }, 'an answer that names no level leaves the level as it was');
});

test('H1 a model_change that may be stale: unproven, a reply on another model is unknown; proven physical by an earlier reply, the reply decides alone, as after the kit\'s own restart on another model', async (t) => {
  const box = await createSandbox(t);
  const bots = await piBotUp(box, [
    ['sol-unproven', '--model', 'openai/gpt-6-luna', '--effort', 'low'],
    ['sol-proven', '--model', 'openai/gpt-6-luna', '--effort', 'low'],
    ['sol-asked', '--model', 'openai/gpt-6.1-sol', '--effort', 'high'],
  ]);
  const old = { begun: onTheDay(7) };
  // Since the start, Pi runs openai/gpt-6.1-sol at high. On resume with
  // --model and --thinking, Pi writes no new model_change or
  // thinking_level_change, so the old ones still stand before the reply.
  const since = [userSaid(onTheDay(9)), piAnswered(onTheDay(9, 1), { provider: 'openai', model: 'gpt-6.1-sol', thinkingLevel: 'high' })];
  await talking(box, bots, 'sol-unproven', conv(1), [
    modelChange(onTheDay(7, 30), 'openai', 'gpt-6-luna'),
    thinkingChange(onTheDay(7, 30), 'low'),
    ...since,
  ], old);
  // The same, with a reply on luna before the start: luna is physical.
  await talking(box, bots, 'sol-proven', conv(2), [
    modelChange(onTheDay(7, 30), 'openai', 'gpt-6-luna'),
    thinkingChange(onTheDay(7, 30), 'low'),
    userSaid(onTheDay(7, 31)),
    piAnswered(onTheDay(7, 32), { provider: 'openai', model: 'gpt-6-luna', thinkingLevel: 'low' }),
    ...since,
  ], old);
  // The kit restarted the session on sol at high: the old turns ran on luna.
  await talking(box, bots, 'sol-asked', conv(3), [
    userSaid(onTheDay(7, 1)),
    piAnswered(onTheDay(7, 2), { provider: 'openai', model: 'gpt-6-luna', thinkingLevel: 'low' }),
    modelChange(onTheDay(7, 10), 'openai', 'gpt-6-luna'),
    thinkingChange(onTheDay(7, 10), 'low'),
    ...since,
  ], old);

  const answer = await found(box);

  assertSeen(entryOf(answer, 'sol-unproven'), 'model', { state: 'unknown', observed: 'openai/gpt-6.1-sol' }, 'luna may be a virtual selection or a stale one, and sol is not luna');
  assertSeen(entryOf(answer, 'sol-unproven'), 'effort', { state: 'unknown', observed: 'high' }, 'the reply\'s model is undecided, so its level is too');
  assert.deepEqual(sessionFindings(answer, 'sol-unproven'), [], `unknown is no finding, got: ${JSON.stringify(answer.found, null, 2)}`);
  assertSeen(entryOf(answer, 'sol-proven'), 'model', { state: 'mismatch', observed: 'openai/gpt-6.1-sol' }, 'luna is proven physical, so the reply on sol decides alone');
  assertSeen(entryOf(answer, 'sol-proven'), 'effort', { state: 'mismatch', observed: 'high' }, 'the reply\'s model is physical, so its level decides alone');
  assert.equal(sessionFindings(answer, 'sol-proven').length, 1, `the mismatch is a finding, got: ${JSON.stringify(answer.found, null, 2)}`);
  assertSeen(entryOf(answer, 'sol-asked'), 'model', { state: 'match', observed: 'openai/gpt-6.1-sol' }, 'luna is proven physical, and the reply runs sol as asked');
  assertSeen(entryOf(answer, 'sol-asked'), 'effort', { state: 'match', observed: 'high' }, 'the reply runs high as asked');
  assert.deepEqual(sessionFindings(answer, 'sol-asked'), [], `sol-asked runs what bot.yaml asks for, got: ${JSON.stringify(answer.found, null, 2)}`);
});

test('H1 a virtual model: a reply on another model than the router/auto change before it is open, whatever Pi\'s virtual-model-state line or a failed routing says; a failed routing is skipped; the last model_change before the reply counts; a change after the reply decides alone; neither choice matching is a mismatch', async (t) => {
  const box = await createSandbox(t);
  const bots = await piBotUp(box, [
    ['auto-noted', '--model', 'router/auto', '--effort', 'low'],
    ['auto-noted-old', '--model', 'router/auto'],
    ['luna-noted', '--model', 'openai/gpt-6-luna'],
    ['auto-bare', '--model', 'router/auto', '--effort', 'low'],
    ['auto-bare-old', '--model', 'router/auto'],
    ['auto-failed', '--model', 'router/auto'],
    ['luna-failed', '--model', 'openai/gpt-6-luna'],
    ['auto-resumed', '--model', 'router/auto'],
    ['luna-resumed', '--model', 'openai/gpt-6-luna'],
    ['opus-resumed', '--model', 'anthropic/claude-opus-5-5'],
    ['opus-asked', '--model', 'anthropic/claude-opus-5-5', '--effort', 'medium'],
    ['auto-switched', '--model', 'router/auto'],
    ['changed-after', '--model', 'router/auto'],
  ]);
  const old = { begun: onTheDay(7) };
  const routed = (when) => piAnswered(when, { provider: 'openai', model: 'gpt-6-luna', thinkingLevel: 'high' });
  // Pi selects router/auto at low; its reply names the model it ran on, at
  // the level of the request. Whether Pi still follows router/auto, or fell
  // back to that model, the record cannot show.
  const selected = [modelChange(onTheDay(9), 'router', 'auto'), thinkingChange(onTheDay(9), 'low'), userSaid(onTheDay(9, 1)), routed(onTheDay(9, 5))];
  // Pi's note that router/auto was virtual once: it proves nothing about now.
  const noted = virtualState(onTheDay(9), 'router', 'auto');
  await talking(box, bots, 'auto-noted', conv(1), [noted, ...selected]);
  await talking(box, bots, 'auto-noted-old', conv(2), [
    modelChange(onTheDay(7, 30), 'router', 'auto'),
    virtualState(onTheDay(7, 30), 'router', 'auto'),
    userSaid(onTheDay(9)),
    routed(onTheDay(9, 1)),
  ], old);
  await talking(box, bots, 'luna-noted', conv(3), [noted, ...selected]);
  await talking(box, bots, 'auto-bare', conv(4), selected);
  await talking(box, bots, 'auto-bare-old', conv(5), [
    modelChange(onTheDay(7, 30), 'router', 'auto'),
    userSaid(onTheDay(9)),
    routed(onTheDay(9, 1)),
  ], old);
  // A physical reply, then a failed routing naming router/auto, which Pi
  // skips: the physical reply decides, against the change before it.
  const failed = [...selected, userSaid(onTheDay(9, 6)), routingFailed(onTheDay(9, 7), 'router', 'auto')];
  await talking(box, bots, 'auto-failed', conv(6), failed);
  await talking(box, bots, 'luna-failed', conv(7), failed);
  // The reviewer's case: router/auto selected and noted before the start,
  // then physical replies on luna, one before the start and one since.
  const resumed = [
    modelChange(onTheDay(7, 30), 'router', 'auto'),
    virtualState(onTheDay(7, 30), 'router', 'auto'),
    userSaid(onTheDay(7, 31)),
    piAnswered(onTheDay(7, 32), { provider: 'openai', model: 'gpt-6-luna' }),
    userSaid(onTheDay(9)),
    piAnswered(onTheDay(9, 1), { provider: 'openai', model: 'gpt-6-luna' }),
  ];
  await talking(box, bots, 'auto-resumed', conv(8), resumed, old);
  await talking(box, bots, 'luna-resumed', conv(9), resumed, old);
  await talking(box, bots, 'opus-resumed', conv(10), resumed, old);
  await talking(box, bots, 'opus-asked', conv(11), selected);
  // router/auto was the selection once, but the last model_change before the reply is another.
  await talking(box, bots, 'auto-switched', conv(12), [
    modelChange(onTheDay(7, 30), 'router', 'auto'),
    modelChange(onTheDay(9), 'openai', 'gpt-6.1-sol'),
    userSaid(onTheDay(9, 1)),
    routed(onTheDay(9, 5)),
  ], old);
  await talking(box, bots, 'changed-after', conv(13), [noted, ...selected, modelChange(onTheDay(9, 10), 'openai', 'gpt-6.1-sol')]);

  const answer = await found(box);
  const all = JSON.stringify(answer.found, null, 2);
  const luna = 'openai/gpt-6-luna';

  assertSeen(entryOf(answer, 'auto-noted'), 'model', { state: 'unknown', observed: luna }, 'router/auto matches the change, luna the reply, and nothing proves the change physical');
  assertSeen(entryOf(answer, 'auto-noted'), 'effort', { state: 'unknown', observed: 'high' }, 'the reply\'s model is open, so its level is too: low against a reply at high');
  assert.deepEqual(sessionFindings(answer, 'auto-noted'), [], `unknown is no finding, got: ${all}`);
  assertSeen(entryOf(answer, 'auto-noted-old'), 'model', { state: 'unknown', observed: luna }, 'the note before the start proves nothing about now');
  assertSeen(entryOf(answer, 'luna-noted'), 'model', { state: 'unknown', observed: luna }, 'luna matches the reply, and the change is open');
  assert.deepEqual(sessionFindings(answer, 'luna-noted'), [], `unknown is no finding, got: ${all}`);
  assertSeen(entryOf(answer, 'auto-bare'), 'model', { state: 'unknown', observed: luna }, 'nothing proves router/auto physical');
  assertSeen(entryOf(answer, 'auto-bare'), 'effort', { state: 'unknown', observed: 'high' }, 'the reply\'s model is open, so its level is too');
  assertSeen(entryOf(answer, 'auto-bare-old'), 'model', { state: 'unknown', observed: luna }, 'the change before the start is open too');
  assertSeen(entryOf(answer, 'auto-failed'), 'model', { state: 'unknown', observed: luna }, 'the failed routing is skipped; the luna reply before it is open against router/auto');
  assertSeen(entryOf(answer, 'luna-failed'), 'model', { state: 'unknown', observed: luna }, 'the failed routing is skipped; luna matches the reply, and the change is open');
  assertSeen(entryOf(answer, 'auto-resumed'), 'model', { state: 'unknown', observed: luna }, 'Pi may follow router/auto, or have fallen back to luna');
  assertSeen(entryOf(answer, 'luna-resumed'), 'model', { state: 'unknown', observed: luna }, 'the same record, asked for luna: still open');
  assertSeen(entryOf(answer, 'opus-resumed'), 'model', { state: 'mismatch', observed: luna }, 'bot.yaml asks for neither router/auto nor luna');
  assert.equal(sessionFindings(answer, 'opus-resumed').length, 1, `the mismatch is a finding, got: ${all}`);
  assertSeen(entryOf(answer, 'opus-asked'), 'model', { state: 'mismatch', observed: luna }, 'bot.yaml asks for neither choice: the reply\'s own model shows');
  assertSeen(entryOf(answer, 'opus-asked'), 'effort', { state: 'mismatch', observed: 'high' }, 'bot.yaml asks for neither level: the reply\'s own level shows');
  assertSeen(entryOf(answer, 'auto-switched'), 'model', { state: 'mismatch', observed: luna }, 'the last model_change before the reply is openai/gpt-6.1-sol, not router/auto');
  assertSeen(entryOf(answer, 'changed-after'), 'model', { state: 'mismatch', observed: 'openai/gpt-6.1-sol' }, 'the model_change after the reply decides alone');
});

test('H1 only lines since the kit last started the session count: lines before the book\'s launched time say nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = await piBotUp(box, [
    ['old-only', '--model', 'openai/gpt-6-luna', '--effort', 'low'],
    ['old-then-new', '--model', 'openai/gpt-6-luna', '--effort', 'low'],
    ['old-level', '--model', 'openai/gpt-6-luna', '--effort', 'low'],
  ]);
  // Each conversation began before the kit last started its session, and
  // ran another model at another level then.
  const before = [modelChange(onTheDay(7, 30), 'openai', 'gpt-6.1-sol'), thinkingChange(onTheDay(7, 30), 'high'), userSaid(onTheDay(7, 31))];
  await talking(box, bots, 'old-only', conv(1), before, { begun: onTheDay(7) });
  await talking(box, bots, 'old-then-new', conv(2), [...before, ...ran('openai', 'gpt-6-luna', 'low')], { begun: onTheDay(7) });
  await talking(box, bots, 'old-level', conv(3), [...before, modelChange(onTheDay(9), 'openai', 'gpt-6-luna'), userSaid(onTheDay(9, 1))], { begun: onTheDay(7) });

  const answer = await found(box);

  const oldOnly = entryOf(answer, 'old-only');
  assertSetting(oldOnly, 'model', { state: 'unknown', configured: 'openai/gpt-6-luna' }, 'every line that names a model is from before the start');
  assertSetting(oldOnly, 'effort', { state: 'unknown', configured: 'low' }, 'every line that names a level is from before the start');
  assertSeen(entryOf(answer, 'old-then-new'), 'model', { state: 'match', observed: 'openai/gpt-6-luna' }, 'the lines since the start ran the model asked for');
  assertSeen(entryOf(answer, 'old-then-new'), 'effort', { state: 'match', observed: 'low' }, 'the lines since the start ran the level asked for');
  assertSeen(entryOf(answer, 'old-level'), 'model', { state: 'match', observed: 'openai/gpt-6-luna' }, 'a model_change since the start');
  assertSetting(entryOf(answer, 'old-level'), 'effort', { state: 'unknown', configured: 'low' }, 'the only thinking level is from before the start');
  assert.deepEqual(
    answer.found.filter((one) => one.bot === BOT && one.says.includes('gpt-6.1-sol')),
    [],
    `what ran before the start is no mismatch, got: ${JSON.stringify(answer.found, null, 2)}`,
  );
});

// ---------------------------------------------------------------------------
// The finding.
// ---------------------------------------------------------------------------

test('H1 a running Pi session on another model or level than bot.yaml asks for gets one session finding naming each that differs, both values; one that matches, or whose shell is in front, gets none', async (t) => {
  const box = await createSandbox(t);
  const bots = await piBotUp(box, [
    ['drift', '--model', 'openai/gpt-6-luna', '--effort', 'low'],
    ['askew', '--model', 'openai/gpt-6-luna', '--effort', 'high'],
    ['steady', '--model', 'openai/gpt-6-luna', '--effort', 'low'],
    ['halted', '--model', 'openai/gpt-6-luna', '--effort', 'low'],
  ]);
  await talking(box, bots, 'drift', conv(1), ran('openai', 'gpt-6.1-sol', 'low'));
  await talking(box, bots, 'askew', conv(2), ran('openai', 'gpt-6.1-sol', 'minimal'));
  await talking(box, bots, 'steady', conv(3), ran('openai', 'gpt-6-luna', 'low'));
  await talking(box, bots, 'halted', conv(4), ran('openai', 'gpt-6.1-sol', 'minimal'));
  await shellInFront(box, bots, 'halted');

  const answer = await found(box);

  const drift = sessionFindings(answer, 'drift');
  assert.equal(drift.length, 1, `one finding for drift, got: ${JSON.stringify(answer.found, null, 2)}`);
  for (const word of ['model', 'openai/gpt-6-luna', 'openai/gpt-6.1-sol']) {
    assert.ok(drift[0].says.includes(word), `the finding should name ${word}, got: ${drift[0].says}`);
  }
  assert.ok(!hasWord(drift[0].says, 'effort'), `the effort matched, so the finding names no effort, got: ${drift[0].says}`);
  assert.doesNotMatch(drift[0].says, /hook/i, `the kit has no hook in Pi, got: ${drift[0].says}`);

  const askew = sessionFindings(answer, 'askew');
  assert.equal(askew.length, 1, `one finding for askew, however many settings differ, got: ${JSON.stringify(answer.found, null, 2)}`);
  for (const word of ['model', 'openai/gpt-6-luna', 'openai/gpt-6.1-sol', 'effort', 'high', 'minimal']) {
    assert.ok(askew[0].says.includes(word), `the finding should name ${word}, got: ${askew[0].says}`);
  }

  assert.deepEqual(sessionFindings(answer, 'steady'), [], 'steady runs what bot.yaml asks for');
  assert.deepEqual(
    sessionFindings(answer, 'halted').filter((one) => one.says.includes('gpt-6.1-sol') || one.says.includes('minimal')),
    [],
    `Pi quit in that tab, so nothing runs those settings now, got: ${JSON.stringify(answer.found, null, 2)}`,
  );
});
