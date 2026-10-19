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
//   - The model: look at the lines since the start, from the newest back.
//     The first line that names a model decides. A `model_change` decides
//     alone: `<provider>/<modelId>`. An assistant reply gives two choices:
//     its own `<provider>/<model>`, or the model of the last `model_change`
//     before it in the whole record, before the start too. The second stands
//     for a virtual model (a router, such as `router/auto`): Pi follows that
//     selection, and its replies name the physical model it routed to (Pi
//     1.3.0, getBranchSelection). The thinking level works the same way, with
//     `thinking_level_change` lines and a reply's `thinkingLevel`.
//   - bot.yaml's model is a Pi model pattern: `openai/gpt-6-luna` or
//     `gpt-6-luna`, maybe with a trailing `:<thinking level>` (off, minimal,
//     low, medium, high, xhigh, max) that is not part of the model. A `:8b`
//     is no thinking level, and stays part of the model. Without regard to
//     case, and without that suffix, it is `match` when it equals
//     `<provider>/<model>` or `<model>` of a choice; otherwise `unknown` when
//     Pi could resolve it fuzzily to a choice (with `p/rest`, the provider is
//     `p` and the model id holds `rest`; with no slash, the model id holds
//     all of it); otherwise `mismatch`. `observed` is the choice that
//     matched, or, when none did, the deciding line's own value.
//   - The effort matches when it equals a choice, otherwise it is a mismatch.
//   - A known limit, not tested: Pi also matches a model's display name,
//     which the record does not hold, so such a pattern shows as a mismatch.
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
const MODELS = [...PI_MODELS, 'openai/gpt-6-luna', 'anthropic/gpt-6-luna', 'router/auto'];

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
 * is a message that names none.
 */
const piAnswered = (when, { provider, model, thinkingLevel }) => ({
  type: 'message',
  id: nextId(),
  parentId: null,
  timestamp: when,
  message: {
    role: 'assistant',
    content: [{ type: 'text', text: 'OK' }],
    api: 'openai-responses',
    provider,
    model,
    ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
    usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12 },
    stopReason: 'stop',
    timestamp: Date.parse(when),
  },
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

test('H1 a model_change or thinking_level_change after the last reply decides alone; a reply after a change gives what bot.yaml asks for when it ran it; a reply that names no level changes nothing', async (t) => {
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

  assertSeen(entryOf(answer, 'answer-last'), 'model', { state: 'match', observed: 'openai/gpt-6-luna' }, 'the answer after the model_change says what ran');
  assertSeen(entryOf(answer, 'answer-last'), 'effort', { state: 'match', observed: 'high' }, 'the answer after the thinking_level_change says the level');
  assertSeen(entryOf(answer, 'change-last'), 'model', { state: 'mismatch', observed: 'openai/gpt-6.1-sol' }, 'the model_change after the answer says what runs now');
  assertSeen(entryOf(answer, 'change-last'), 'effort', { state: 'mismatch', observed: 'medium' }, 'the thinking_level_change after the answer says the level now');
  assertSeen(entryOf(answer, 'no-level'), 'model', { state: 'match', observed: 'openai/gpt-6-luna' }, 'the last answer names the model');
  assertSeen(entryOf(answer, 'no-level'), 'effort', { state: 'match', observed: 'low' }, 'an answer that names no level leaves the level as it was');
});

test('H1 a virtual model: a reply routed to another model still matches the model_change before it, since the start or before it; it must be the last model_change before the reply, and a change after the reply decides alone', async (t) => {
  const box = await createSandbox(t);
  const bots = await piBotUp(box, [
    ['virtual', '--model', 'router/auto', '--effort', 'low'],
    ['virtual-old', '--model', 'router/auto', '--effort', 'low'],
    ['routed-elsewhere', '--model', 'anthropic/claude-opus-5-5', '--effort', 'medium'],
    ['switched-since', '--model', 'router/auto'],
    ['changed-after', '--model', 'router/auto'],
  ]);
  const routed = (when) => piAnswered(when, { provider: 'openai', model: 'gpt-6-luna', thinkingLevel: 'high' });
  // The reviewer's case: Pi follows router/auto at low, and its reply names
  // the model it routed to, at the level it ran.
  const virtual = [modelChange(onTheDay(9), 'router', 'auto'), thinkingChange(onTheDay(9), 'low'), userSaid(onTheDay(9, 1)), routed(onTheDay(9, 5))];
  await talking(box, bots, 'virtual', conv(1), virtual);
  // The selection was made before the kit last started the session; since
  // the start there are only replies.
  await talking(box, bots, 'virtual-old', conv(2), [
    modelChange(onTheDay(7, 30), 'router', 'auto'),
    thinkingChange(onTheDay(7, 30), 'low'),
    userSaid(onTheDay(9)),
    routed(onTheDay(9, 1)),
  ], { begun: onTheDay(7) });
  // bot.yaml asks for neither choice: the reply's own values are shown.
  await talking(box, bots, 'routed-elsewhere', conv(3), virtual);
  // router/auto was the selection once, but the last model_change before the reply is another.
  await talking(box, bots, 'switched-since', conv(4), [
    modelChange(onTheDay(7, 30), 'router', 'auto'),
    modelChange(onTheDay(9), 'openai', 'gpt-6.1-sol'),
    userSaid(onTheDay(9, 1)),
    routed(onTheDay(9, 5)),
  ], { begun: onTheDay(7) });
  await talking(box, bots, 'changed-after', conv(5), [...virtual, modelChange(onTheDay(9, 10), 'openai', 'gpt-6.1-sol')]);

  const answer = await found(box);

  assertSeen(entryOf(answer, 'virtual'), 'model', { state: 'match', observed: 'router/auto' }, 'the reply follows the router/auto selection before it');
  assertSeen(entryOf(answer, 'virtual'), 'effort', { state: 'match', observed: 'low' }, 'the reply follows the low selection before it');
  assert.deepEqual(sessionFindings(answer, 'virtual'), [], `virtual runs what bot.yaml asks for, got: ${JSON.stringify(answer.found, null, 2)}`);
  assertSeen(entryOf(answer, 'virtual-old'), 'model', { state: 'match', observed: 'router/auto' }, 'the selection before the start still stands behind the replies since');
  assertSeen(entryOf(answer, 'virtual-old'), 'effort', { state: 'match', observed: 'low' }, 'the level selected before the start still stands behind the replies since');
  assert.deepEqual(sessionFindings(answer, 'virtual-old'), [], `virtual-old runs what bot.yaml asks for, got: ${JSON.stringify(answer.found, null, 2)}`);
  assertSeen(entryOf(answer, 'routed-elsewhere'), 'model', { state: 'mismatch', observed: 'openai/gpt-6-luna' }, 'neither choice matches, so the reply\'s own model shows');
  assertSeen(entryOf(answer, 'routed-elsewhere'), 'effort', { state: 'mismatch', observed: 'high' }, 'neither choice matches, so the reply\'s own level shows');
  assertSeen(entryOf(answer, 'switched-since'), 'model', { state: 'mismatch', observed: 'openai/gpt-6-luna' }, 'the last model_change before the reply is openai/gpt-6.1-sol, not router/auto');
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
