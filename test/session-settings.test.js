// `obk health` says whether each running session runs on its bot's current
// rules and settings (#271, with #272 folded into it).
//
// Two halves, both read off records the kit does not write:
//
//   Settings. For each session the book has an entry for and that is not
//   paused, health compares the four settings bot.yaml asks for — model,
//   effort, context, approval — with what the harness's own record of the
//   session's current conversation says it really used. Each one is `match`,
//   `mismatch` (with both values), `not-asked-for` (bot.yaml leaves it out; never
//   a mismatch, and approval is never this, because a session that names none
//   is asked for `auto`), or `unknown` (asked for, and no record says). Unknown
//   is never a match, and it is not a finding either.
//
//   Rules. Whenever the kit starts a harness in a session's tab it notes, under
//   `rules` in the session's book entry, a stamp of the bot's AGENTS.md as it
//   was then. Health says `current`, `older` (AGENTS.md has changed since) or
//   `unknown` (no stamp), and an older one is a finding that names the restart
//   that would bring the session up to date.
//
// Where each harness writes what it used was measured on this machine (tech
// notes, sections 2 and 3). Claude Code: `message.model` and `effort` on
// `assistant` lines, `permissionMode` on `user` and `permission-mode` lines, and
// nothing at all about the context window. Codex: `turn_context` carries the
// model, the effort and the three approval words; `token_count` carries the
// context window at 95% of what it was given, rounded down.
//
// Every transcript is planted in the sandbox's own home, the way
// test/health.test.js (H27) and test/usage.test.js plant them. Nothing here
// reads the real `~/.claude` or `~/.codex`, and everything runs against the
// fake Orca.

import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import {
  bookOf,
  botHomeOf,
  createSandbox,
  recordSession,
  sessionIn,
  skipOrcaFake,
  snapshot,
} from './helpers/cli.js';
import { agentsOf, agentsIn } from './helpers/rules.js';
import { botYamlOf, commonSkill } from './helpers/skills.js';

/** The kinds a finding can be. */
const KINDS = ['orca', 'config', 'skill', 'session', 'leftover'];

/** The four settings, and the states each can be in. */
const SETTINGS = ['model', 'effort', 'context', 'approval'];
const STATES = ['match', 'mismatch', 'not-asked-for', 'unknown'];
const RULE_STATES = ['current', 'older', 'unknown'];

// ---------------------------------------------------------------- the fleet

/** A bots folder with Bot Father up in Orca. */
async function seeded(box) {
  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(result.code, 0, result.stderr);
  return box.path('bots');
}

/**
 * One more bot with its sessions, written but not yet opened in Orca. Each
 * session is `[name, ...flags]`, the flags as `session add` takes them.
 */
async function botWritten(box, name, { harness = 'claude', sessions = [['daily']] } = {}) {
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', name, '--harness', harness]);
  assert.equal(made.code, 0, made.stderr);
  for (const [session, ...settings] of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', name, '--name', session, ...settings]);
    assert.equal(added.code, 0, added.stderr);
  }
  return botHomeOf(box.path('bots'), name);
}

/** Open a bot in Orca: `obk up`, which is when the kit starts a harness in each session's tab. */
async function opened(box, name) {
  const result = await box.run(['up', '--bots', 'bots', '--bot', name]);
  assert.equal(result.code, 0, result.stderr);
}

/** One more bot, written and opened. */
async function botUp(box, name, options) {
  const home = await botWritten(box, name, options);
  await opened(box, name);
  return home;
}

/** Run one more `obk` command that has to work for the test to mean anything. */
async function obk(box, ...args) {
  const result = await box.run([...args]);
  assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stderr}${result.stdout}`);
  return result;
}

/** Change what one bot's book says about its sessions, as a person editing it by hand would. */
async function editBook(bots, bot, change) {
  const file = bookOf(bots, bot);
  const book = parse(await readFile(file, 'utf8'));
  change(book.sessions);
  await writeFile(file, stringify(book));
}

/** Change one bot's `bot.yaml`, which is the user's file and theirs to edit. */
async function editBotYaml(bots, bot, change) {
  const file = botYamlOf(bots, bot);
  const doc = parse(await readFile(file, 'utf8')) ?? {};
  await writeFile(file, stringify(change(doc) ?? doc));
}

// ------------------------------------------------- what a harness writes down

/** A moment on the day these conversations are set, as both harnesses write one. */
const onTheDay = (hour, minute = 0) =>
  `2026-09-20T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;

/** The ids a conversation is known by in these tests: shaped the way both harnesses shape them. */
const conv = (n) => `0199b2c0-${String(n).padStart(4, '0')}-4444-8888-cccccccccccc`;

/** One Claude Code API call, as an `assistant` line of its transcript. An effort left out is a line that carries none, as a Haiku line does. */
const claudeReply = (when, { model, effort } = {}) => ({
  type: 'assistant',
  timestamp: when,
  requestId: `req_${when}`,
  ...(effort === undefined ? {} : { effort }),
  message: {
    id: `msg_${when}`,
    role: 'assistant',
    model,
    usage: { input_tokens: 2, cache_read_input_tokens: 100, cache_creation_input_tokens: 0, output_tokens: 10 },
  },
});

/** Something the person said, which carries the permission mode the session was in. */
const claudeSaid = (when, permissionMode) => ({
  type: 'user',
  timestamp: when,
  ...(permissionMode === undefined ? {} : { permissionMode }),
  message: { role: 'user', content: 'Carry on with the queue.' },
});

/**
 * A change of permission mode, a line of its own. As Claude Code writes it, it
 * carries no timestamp; the conversation's id is put on it where it is planted.
 */
const claudeModeChanged = (permissionMode) => ({ type: 'permission-mode', permissionMode });

/** What Codex was set to for the turns that follow it. */
const codexTurn = (when, {
  model = 'gpt-6-sol', effort = 'high', approval = 'on-request', reviewer = 'auto_review', sandbox = 'workspace-write',
} = {}) => ({
  timestamp: when,
  type: 'turn_context',
  payload: {
    model,
    effort,
    approval_policy: approval,
    approvals_reviewer: reviewer,
    sandbox_policy: { type: sandbox },
  },
});

/** A Codex token count, carrying the context window it reports, or none (`info: null`). */
const codexTokens = (when, window) => ({
  timestamp: when,
  type: 'event_msg',
  payload: {
    type: 'token_count',
    info: window === null ? null : {
      last_token_usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 15 },
      total_token_usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 15 },
      model_context_window: window,
    },
  },
});

/** Where a harness keeps the conversation `id` for the folder `home`. */
const transcriptOf = (box, harness, home, id, started) => (harness === 'codex'
  ? path.join(
    box.home, '.codex', 'sessions', ...started.slice(0, 10).split('-'),
    `rollout-${started.replaceAll(':', '-').replace(/\..*$/, '')}-${id}.jsonl`,
  )
  : path.join(box.home, '.claude', 'projects', home.replaceAll(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`));

/**
 * Plant a conversation where its harness keeps it, for the folder `home`: its
 * first line as the harness writes it, then `lines`. Claude Code writes the
 * conversation's id on every line, and so every Claude line here gets it.
 * `text` in place of lines writes exactly that, which is how a file nothing can
 * parse is planted.
 */
async function plantConversation(box, harness, home, id, { lines = [], text, started = onTheDay(8) } = {}) {
  const file = transcriptOf(box, harness, home, id, started);
  const first = harness === 'codex'
    ? { timestamp: started, type: 'session_meta', payload: { id, cwd: home, timestamp: started } }
    : { type: 'system', sessionId: id, cwd: home, timestamp: started };
  const rest = harness === 'codex' ? lines : lines.map((line) => ({ sessionId: id, ...line }));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text ?? `${[first, ...rest].map((line) => JSON.stringify(line)).join('\n')}\n`);
  return file;
}

/**
 * When the kit last started the sessions these tests plant conversations for:
 * the start of the day, before every line the conversations carry. Only what a
 * record says from the moment the kit last started the session counts, and
 * `up` writes the real clock's time, which is days after these lines.
 */
const LAUNCHED = onTheDay(8);

/**
 * A session running a conversation since the kit started it at LAUNCHED: the
 * harness's record of it planted, and the book naming it as the session's
 * conversation now, the way the kit's hook would have written it.
 */
async function talking(box, bots, bot, session, harness, id, lines) {
  await plantConversation(box, harness, botHomeOf(bots, bot), id, { lines });
  await editBook(bots, bot, (sessions) => { sessions[session].session = id; sessions[session].launched = LAUNCHED; });
}

// ------------------------------------------------------------- what it answers

/** Run the health check. */
const health = (box, ...rest) => box.run(['health', '--bots', 'bots', ...rest]);

/**
 * Run the health check for JSON and hold it to its shape: findings as today,
 * a `sessions` list whose every entry says every setting and the rules in one
 * of the words the requirement gives, and the exit code the findings call for.
 */
async function found(box, ...rest) {
  const result = await health(box, ...rest, '--json');
  assert.equal(result.stderr, '', `a health run reports on stdout, and put this on stderr: ${result.stderr}`);
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  assert.ok(Array.isArray(answer.found), `the answer should carry a list of findings, got: ${result.stdout}`);
  for (const finding of answer.found) {
    assert.ok(KINDS.includes(finding.kind), `a finding's kind is one of ${KINDS.join(', ')}, got: ${JSON.stringify(finding)}`);
    assert.ok(typeof finding.where === 'string' && finding.where.trim() !== '', `a finding says what it is about, got: ${JSON.stringify(finding)}`);
    assert.ok(typeof finding.says === 'string' && finding.says.trim() !== '', `a finding says something, got: ${JSON.stringify(finding)}`);
  }
  assert.ok(Array.isArray(answer.sessions), `the answer should carry a list of sessions, got: ${result.stdout}`);
  for (const entry of answer.sessions) {
    const shown = JSON.stringify(entry);
    assert.equal(typeof entry.bot, 'string', `every entry names its bot, got: ${shown}`);
    assert.equal(typeof entry.session, 'string', `and its session, got: ${shown}`);
    assert.ok(['claude', 'codex'].includes(entry.harness), `and its harness, got: ${shown}`);
    assert.ok(entry.conversation === null || typeof entry.conversation === 'string', `and its conversation or null, got: ${shown}`);
    for (const setting of SETTINGS) {
      assert.ok(STATES.includes(entry.settings?.[setting]?.state), `${setting} is one of ${STATES.join(', ')}, got: ${shown}`);
    }
    assert.ok(RULE_STATES.includes(entry.rules?.state), `the rules are one of ${RULE_STATES.join(', ')}, got: ${shown}`);
  }
  assert.equal(
    result.code,
    answer.found.length === 0 ? 0 : 1,
    `${answer.found.length} findings should exit ${answer.found.length === 0 ? 0 : 1}, got ${result.code}`,
  );
  return answer;
}

/** The one entry of `sessions` about one session of one bot. */
function entryOf(answer, bot, session) {
  const entries = answer.sessions.filter((one) => one.bot === bot && one.session === session);
  assert.equal(entries.length, 1, `one entry should be about ${bot} ${session}, got: ${JSON.stringify(answer.sessions, null, 2)}`);
  return entries[0];
}

/** Whether `sessions` holds anything about one session of one bot. */
const hasEntry = (answer, bot, session) => answer.sessions.some((one) => one.bot === bot && one.session === session);

/** The findings of one kind, or about one bot, or both. */
const of = (answer, { kind, bot } = {}) => answer.found.filter((one) => (
  (kind === undefined || one.kind === kind) && (bot === undefined || one.bot === bot)
));

/** Everything one finding puts in front of a reader. */
const wordsOf = (finding) => `${finding.where} ${finding.says}`;

/** The findings that name `what` anywhere a reader would see it. */
const naming = (findings, what) => findings.filter((one) => wordsOf(one).includes(what));

/** Whether `word` is in `text` as a word of its own, not inside another. */
const hasWord = (text, word) => new RegExp(`(^|[^A-Za-z0-9_-])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9_-])`).test(text);

/** One setting of one entry is exactly this: its state, and the values it carries. */
function assertSetting(entry, setting, expected, why) {
  assert.deepEqual(
    entry.settings[setting],
    expected,
    `${entry.bot} ${entry.session} ${setting}: ${why}, got: ${JSON.stringify(entry.settings[setting])}`,
  );
}

/**
 * A Codex approval as observed: the state and configured value exactly, and an
 * observed string carrying the three words the record said.
 */
function assertCodexApproval(entry, { state, configured }, words, why) {
  const got = entry.settings.approval;
  const shown = JSON.stringify(got);
  assert.equal(got.state, state, `${entry.session} approval: ${why}, got: ${shown}`);
  assert.equal(got.configured, configured, `${entry.session} approval is asked for as ${configured}, got: ${shown}`);
  assert.equal(typeof got.observed, 'string', `${entry.session} approval should say what the record said, got: ${shown}`);
  for (const word of words) {
    assert.ok(got.observed.includes(word), `${entry.session} approval observed should carry ${word}, got: ${shown}`);
  }
}

// ---------------------------------------------------------------------------
// S1 — a Claude session whose model differs from bot.yaml.
// ---------------------------------------------------------------------------

test('S1 a Claude transcript whose model differs from bot.yaml is a mismatch with both values, and one finding naming them', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['daily', '--model', 'opus', '--effort', 'high']] });
  await talking(box, bots, 'api-bot', 'daily', 'claude', conv(1), [
    claudeSaid(onTheDay(9), 'auto'),
    claudeReply(onTheDay(9, 1), { model: 'claude-sonnet-5', effort: 'high' }),
  ]);

  const answer = await found(box);

  const entry = entryOf(answer, 'api-bot', 'daily');
  assert.equal(entry.harness, 'claude');
  assert.equal(entry.conversation, conv(1), 'the conversation is the one the book names now');
  assertSetting(entry, 'model', { state: 'mismatch', configured: 'opus', observed: 'claude-sonnet-5' }, 'opus was asked for and sonnet ran');
  assertSetting(entry, 'effort', { state: 'match', configured: 'high', observed: 'high' }, 'high asked for, high ran');
  assertSetting(entry, 'context', { state: 'not-asked-for' }, 'no context asked for, and Claude records none');
  assertSetting(entry, 'approval', { state: 'match', configured: 'auto', observed: 'auto' }, 'a session that names no level is asked for auto');

  const mine = of(answer, { kind: 'session', bot: 'api-bot' });
  assert.equal(mine.length, 1, `one finding for the one session with a mismatch, got: ${JSON.stringify(mine, null, 2)}`);
  const says = mine[0].says;
  for (const word of ['daily', 'model', 'opus', 'claude-sonnet-5']) {
    assert.ok(says.includes(word), `the finding should name ${word}, got: ${says}`);
  }
  for (const matched of ['effort', 'approval']) {
    assert.ok(!hasWord(says, matched), `${matched} matched, so the finding names no ${matched}, got: ${says}`);
  }
  assert.deepEqual(of(answer, { kind: 'session', bot: 'bot-father' }), [], 'nothing about Bot Father, which asked for nothing it did not get');
});

// ---------------------------------------------------------------------------
// S2 — a Codex session whose effort, context and approval differ.
// ---------------------------------------------------------------------------

test('S2 a Codex rollout whose effort, context and approval differ is a mismatch for each, with both values, in one finding', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', {
    harness: 'codex',
    sessions: [['daily', '--model', 'gpt-6-sol', '--effort', 'high', '--context', '200000', '--approval', 'ask']],
  });
  // The user's own Codex defaults leaked into an `ask` session: the reviewer is
  // not the user and the sandbox is wide open.
  await talking(box, bots, 'api-bot', 'daily', 'codex', conv(1), [
    codexTurn(onTheDay(9), { model: 'gpt-6-sol', effort: 'medium', approval: 'on-request', reviewer: 'auto_review', sandbox: 'danger-full-access' }),
    codexTokens(onTheDay(9, 1), 258400),
  ]);

  const answer = await found(box);

  const entry = entryOf(answer, 'api-bot', 'daily');
  assert.equal(entry.harness, 'codex');
  assert.equal(entry.conversation, conv(1));
  assertSetting(entry, 'model', { state: 'match', configured: 'gpt-6-sol', observed: 'gpt-6-sol' }, 'the model it asked for ran');
  assertSetting(entry, 'effort', { state: 'mismatch', configured: 'high', observed: 'medium' }, 'high asked for, medium ran');
  assertSetting(entry, 'context', { state: 'mismatch', configured: '200000', observed: '258400' }, '200000 would show as 190000');
  assertCodexApproval(entry, { state: 'mismatch', configured: 'ask' }, ['on-request', 'auto_review', 'danger-full-access'], 'ask wants the user as reviewer');

  const mine = of(answer, { kind: 'session', bot: 'api-bot' });
  assert.equal(mine.length, 1, `one finding for the session, however many settings differ, got: ${JSON.stringify(mine, null, 2)}`);
  const says = mine[0].says;
  for (const word of ['daily', 'effort', 'high', 'medium', 'context', '200000', '258400', 'approval', 'danger-full-access']) {
    assert.ok(says.includes(word), `the finding should name ${word}, got: ${says}`);
  }
  assert.ok(hasWord(says, 'ask'), `the finding should name the level asked for, ask, got: ${says}`);
  assert.ok(!says.includes('gpt-6-sol'), `the model matched, so the finding does not name it, got: ${says}`);
});

// ---------------------------------------------------------------------------
// S3 — no readable record is unknown, never a match, and no finding.
// ---------------------------------------------------------------------------

for (const harness of ['claude', 'codex']) {
  for (const [label, arrange] of [
    ['no conversation in the book', async () => null],
    ['a conversation id with no file for it', async (box, bots) => {
      await editBook(bots, 'api-bot', (sessions) => { sessions.daily.session = conv(7); });
      return conv(7);
    }],
    ['a file nothing can parse', async (box, bots) => {
      await plantConversation(box, harness, botHomeOf(bots, 'api-bot'), conv(7), { text: 'this is { not json\n\u0000\u0001 at all\n' });
      await editBook(bots, 'api-bot', (sessions) => { sessions.daily.session = conv(7); });
      return conv(7);
    }],
  ]) {
    test(`S3 ${harness}: ${label} is unknown for every setting asked for, never a match, and no finding`, async (t) => {
      const box = await createSandbox(t);
      const bots = await seeded(box);
      // Context on Claude rides on the model, so it is asked for with one.
      const settings = harness === 'codex'
        ? ['--model', 'gpt-6-sol', '--effort', 'high', '--context', '200000', '--approval', 'ask']
        : ['--model', 'opus', '--effort', 'high', '--approval', 'ask'];
      await botUp(box, 'api-bot', { harness, sessions: [['daily', ...settings]] });
      const conversation = await arrange(box, bots);

      const answer = await found(box);

      const entry = entryOf(answer, 'api-bot', 'daily');
      assert.equal(entry.conversation, conversation, 'the conversation is the book\'s, or null when it names none');
      assertSetting(entry, 'model', { state: 'unknown', configured: harness === 'codex' ? 'gpt-6-sol' : 'opus' }, 'no record says what ran');
      assertSetting(entry, 'effort', { state: 'unknown', configured: 'high' }, 'no record says what ran');
      assertSetting(
        entry,
        'context',
        harness === 'codex' ? { state: 'unknown', configured: '200000' } : { state: 'not-asked-for' },
        'no record says what ran',
      );
      assertSetting(entry, 'approval', { state: 'unknown', configured: 'ask' }, 'no record says what ran');
      assert.deepEqual(of(answer, { kind: 'session', bot: 'api-bot' }), [], 'unknown is not a finding');
    });
  }
}

test('S3 a record that does not carry a setting leaves that one unknown, and says the ones it carries', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['daily', '--model', 'opus', '--effort', 'high', '--approval', 'ask']] });
  // The person spoke, and no reply has been written yet: a mode, and no model.
  await talking(box, bots, 'api-bot', 'daily', 'claude', conv(1), [claudeSaid(onTheDay(9), 'default')]);

  const answer = await found(box);

  const entry = entryOf(answer, 'api-bot', 'daily');
  assertSetting(entry, 'model', { state: 'unknown', configured: 'opus' }, 'no assistant line, so no model on record');
  assertSetting(entry, 'effort', { state: 'unknown', configured: 'high' }, 'no assistant line, so no effort on record');
  assertSetting(entry, 'approval', { state: 'match', configured: 'ask', observed: 'default' }, 'ask is launched as manual and recorded as default');
  assert.deepEqual(of(answer, { kind: 'session', bot: 'api-bot' }), [], 'unknown and match make no finding');
});

test('S3 a context asked for on Claude is always unknown, because Claude Code records none', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['daily', '--model', 'sonnet', '--context', '1m']] });
  // What a `sonnet[1m]` session really writes: the model id with nothing about the window.
  await talking(box, bots, 'api-bot', 'daily', 'claude', conv(1), [
    claudeSaid(onTheDay(9), 'auto'),
    claudeReply(onTheDay(9, 1), { model: 'claude-sonnet-5', effort: 'high' }),
  ]);

  const answer = await found(box);

  const entry = entryOf(answer, 'api-bot', 'daily');
  assertSetting(entry, 'model', { state: 'match', configured: 'sonnet', observed: 'claude-sonnet-5' }, 'sonnet is one of the parts of claude-sonnet-5');
  assertSetting(entry, 'context', { state: 'unknown', configured: '1m' }, 'nothing in the transcript shows the window');
  assert.deepEqual(of(answer, { kind: 'session', bot: 'api-bot' }), [], 'unknown is not a finding');
});

// ---------------------------------------------------------------------------
// S4 — a setting left out of bot.yaml is not asked for.
// ---------------------------------------------------------------------------

for (const [label, arrange] of [
  ['missing from bot.yaml', async () => {}],
  ['written in bot.yaml as an empty string', async (bots) => {
    await editBotYaml(bots, 'api-bot', (doc) => {
      doc.sessions = doc.sessions.map((one) => (one.name === 'daily' ? { ...one, model: '', effort: '' } : one));
    });
  }],
]) {
  test(`S4 Claude: a model and effort ${label} are not asked for whatever the record says; approval left out is judged as auto`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await botWritten(box, 'api-bot', { sessions: [['daily']] });
    await arrange(bots);
    await opened(box, 'api-bot');
    await talking(box, bots, 'api-bot', 'daily', 'claude', conv(1), [
      claudeSaid(onTheDay(9), 'default'),
      claudeReply(onTheDay(9, 1), { model: 'claude-opus-5-5', effort: 'high' }),
    ]);

    const answer = await found(box);

    const entry = entryOf(answer, 'api-bot', 'daily');
    assertSetting(entry, 'model', { state: 'not-asked-for', observed: 'claude-opus-5-5' }, 'the session names no model');
    assertSetting(entry, 'effort', { state: 'not-asked-for', observed: 'high' }, 'the session names no effort');
    assertSetting(entry, 'context', { state: 'not-asked-for' }, 'the session names no context');
    // The kit put --permission-mode auto on the launch line, and the record says
    // the session is in manual mode: the one setting that is never "not asked for".
    assertSetting(entry, 'approval', { state: 'mismatch', configured: 'auto', observed: 'default' }, 'no level named is auto');

    const mine = of(answer, { kind: 'session', bot: 'api-bot' });
    assert.equal(mine.length, 1, `one finding, for the approval, got: ${JSON.stringify(mine, null, 2)}`);
    assert.ok(mine[0].says.includes('approval') && mine[0].says.includes('default'), `it names the approval and what ran, got: ${mine[0].says}`);
    assert.ok(!mine[0].says.includes('claude-opus-5-5'), `a model not asked for is never a mismatch, got: ${mine[0].says}`);
  });
}

test('S4 Codex: a model, effort and context left out are not asked for whatever the rollout says; approval left out is judged as auto', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { harness: 'codex', sessions: [['daily']] });
  await talking(box, bots, 'api-bot', 'daily', 'codex', conv(1), [
    codexTurn(onTheDay(9), { model: 'gpt-6-astra', effort: 'medium', approval: 'on-request', reviewer: 'auto_review', sandbox: 'workspace-write' }),
    codexTokens(onTheDay(9, 1), 258400),
  ]);

  const answer = await found(box);

  const entry = entryOf(answer, 'api-bot', 'daily');
  assertSetting(entry, 'model', { state: 'not-asked-for', observed: 'gpt-6-astra' }, 'the session names no model');
  assertSetting(entry, 'effort', { state: 'not-asked-for', observed: 'medium' }, 'the session names no effort');
  assertSetting(entry, 'context', { state: 'not-asked-for', observed: '258400' }, 'the session names no context');
  assertCodexApproval(entry, { state: 'match', configured: 'auto' }, ['on-request', 'auto_review', 'workspace-write'], 'no level named is auto, and this is auto');
  assert.deepEqual(of(answer, { kind: 'session', bot: 'api-bot' }), [], 'nothing asked for differs');
});

// ---------------------------------------------------------------------------
// S5 — what matches and what does not: a table of sessions in one bot.
// ---------------------------------------------------------------------------

/**
 * One bot whose every session is one case: its flags, what its conversation
 * says, and what health should say about the one setting the case is about.
 */
async function table(t, harness, cases) {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { harness, sessions: cases.map(({ name, flags }) => [name, ...flags]) });
  for (const [n, { name, lines }] of cases.entries()) {
    await talking(box, bots, 'api-bot', name, harness, conv(100 + n), lines);
  }
  return found(box);
}

/** A Claude reply with the approval stated first, so that only the model or effort is in question. */
const claudeRan = (reply) => [claudeSaid(onTheDay(9), 'auto'), claudeReply(onTheDay(9, 1), reply)];

test('S5 Claude models: an alias matches an id it is one part of, and a model with a dash must be the id exactly', async (t) => {
  const cases = [
    { name: 'alias-sonnet', flags: ['--model', 'sonnet'], lines: claudeRan({ model: 'claude-sonnet-5', effort: 'high' }), state: 'match', observed: 'claude-sonnet-5' },
    { name: 'alias-opus', flags: ['--model', 'opus'], lines: claudeRan({ model: 'claude-opus-5-5', effort: 'high' }), state: 'match', observed: 'claude-opus-5-5' },
    { name: 'alias-haiku', flags: ['--model', 'haiku'], lines: claudeRan({ model: 'claude-haiku-4-5-20251001' }), state: 'match', observed: 'claude-haiku-4-5-20251001' },
    { name: 'wrong-alias', flags: ['--model', 'opus'], lines: claudeRan({ model: 'claude-sonnet-5', effort: 'high' }), state: 'mismatch', observed: 'claude-sonnet-5' },
    // A part, not a piece of one: `son` is inside `sonnet` and is no part of the id.
    { name: 'part-of-a-part', flags: ['--model', 'son'], lines: claudeRan({ model: 'claude-sonnet-5', effort: 'high' }), state: 'mismatch', observed: 'claude-sonnet-5' },
    { name: 'exact', flags: ['--model', 'claude-opus-5-5'], lines: claudeRan({ model: 'claude-opus-5-5', effort: 'high' }), state: 'match', observed: 'claude-opus-5-5' },
    { name: 'exact-prefix', flags: ['--model', 'claude-opus-5'], lines: claudeRan({ model: 'claude-opus-5-5', effort: 'high' }), state: 'mismatch', observed: 'claude-opus-5-5' },
    // A `<synthetic>` line is Claude Code's own, not a model that ran.
    {
      name: 'synthetic-last',
      flags: ['--model', 'opus'],
      lines: [...claudeRan({ model: 'claude-opus-5-5', effort: 'high' }), claudeReply(onTheDay(9, 5), { model: '<synthetic>' })],
      state: 'match',
      observed: 'claude-opus-5-5',
    },
  ];

  const answer = await table(t, 'claude', cases);

  for (const { name, flags, state, observed } of cases) {
    assertSetting(entryOf(answer, 'api-bot', name), 'model', { state, configured: flags[1], observed }, `${flags[1]} against ${observed}`);
  }
  const mine = of(answer, { kind: 'session', bot: 'api-bot' });
  for (const { name, state } of cases) {
    assert.equal(
      mine.filter((one) => hasWord(one.says, name)).length,
      state === 'mismatch' ? 1 : 0,
      `${name} is a ${state}, got: ${JSON.stringify(mine, null, 2)}`,
    );
  }
});

test('S5 Codex models: an alias matches a part of the id, and a model with a dash must be the id exactly', async (t) => {
  const cases = [
    { name: 'exact', flags: ['--model', 'gpt-6-sol'], observed: 'gpt-6-sol', state: 'match' },
    { name: 'alias', flags: ['--model', 'sol'], observed: 'gpt-6-sol', state: 'match' },
    { name: 'exact-prefix', flags: ['--model', 'gpt-6'], observed: 'gpt-6-sol', state: 'mismatch' },
    { name: 'other', flags: ['--model', 'gpt-6-astra'], observed: 'gpt-6-sol', state: 'mismatch' },
  ].map((one) => ({ ...one, lines: [codexTurn(onTheDay(9), { model: one.observed })] }));

  const answer = await table(t, 'codex', cases);

  for (const { name, flags, state, observed } of cases) {
    assertSetting(entryOf(answer, 'api-bot', name), 'model', { state, configured: flags[1], observed }, `${flags[1]} against ${observed}`);
  }
});

test('S5 effort must be equal, and on Claude it is read off the last reply that carries one', async (t) => {
  const cases = [
    { name: 'same', flags: ['--effort', 'high'], lines: claudeRan({ model: 'claude-opus-5-5', effort: 'high' }), state: 'match', observed: 'high' },
    // `high` is inside `xhigh`, and they are not the same effort.
    { name: 'inside-another', flags: ['--effort', 'high'], lines: claudeRan({ model: 'claude-opus-5-5', effort: 'xhigh' }), state: 'mismatch', observed: 'xhigh' },
    { name: 'lower', flags: ['--effort', 'max'], lines: claudeRan({ model: 'claude-opus-5-5', effort: 'medium' }), state: 'mismatch', observed: 'medium' },
    // A Haiku reply carries no effort; the last one that does still says it.
    {
      name: 'haiku-after',
      flags: ['--effort', 'high'],
      lines: [...claudeRan({ model: 'claude-opus-5-5', effort: 'high' }), claudeReply(onTheDay(9, 5), { model: 'claude-haiku-4-5-20251001' })],
      state: 'match',
      observed: 'high',
    },
  ];

  const answer = await table(t, 'claude', cases);

  for (const { name, flags, state, observed } of cases) {
    assertSetting(entryOf(answer, 'api-bot', name), 'effort', { state, configured: flags[1], observed }, `${flags[1]} against ${observed}`);
  }
});

test('S5 Codex effort must be equal', async (t) => {
  const cases = [
    { name: 'same', flags: ['--effort', 'high'], observed: 'high', state: 'match' },
    { name: 'inside-another', flags: ['--effort', 'high'], observed: 'xhigh', state: 'mismatch' },
    { name: 'lower', flags: ['--effort', 'high'], observed: 'low', state: 'mismatch' },
  ].map((one) => ({ ...one, lines: [codexTurn(onTheDay(9), { effort: one.observed })] }));

  const answer = await table(t, 'codex', cases);

  for (const { name, flags, state, observed } of cases) {
    assertSetting(entryOf(answer, 'api-bot', name), 'effort', { state, configured: flags[1], observed }, `${flags[1]} against ${observed}`);
  }
});

test('S5 Codex context matches what Codex reports for it, 95% rounded down, and nothing else', async (t) => {
  const cases = [
    { name: 'round', flags: ['--context', '200000'], observed: 190000, state: 'match' },
    { name: 'rounded-down', flags: ['--context', '123456'], observed: 117283, state: 'match' },
    { name: 'one-over', flags: ['--context', '123456'], observed: 117284, state: 'mismatch' },
    { name: 'one-under', flags: ['--context', '200000'], observed: 189999, state: 'mismatch' },
    // The number asked for, taken as it stands, is not what Codex reports for it.
    { name: 'as-given', flags: ['--context', '200000'], observed: 200000, state: 'mismatch' },
    { name: 'its-own', flags: ['--context', '200000'], observed: 258400, state: 'mismatch' },
  ].map((one) => ({ ...one, lines: [codexTurn(onTheDay(9)), codexTokens(onTheDay(9, 1), one.observed)] }));

  const answer = await table(t, 'codex', cases);

  for (const { name, flags, state, observed } of cases) {
    assertSetting(
      entryOf(answer, 'api-bot', name),
      'context',
      { state, configured: flags[1], observed: String(observed) },
      `${flags[1]} against a reported ${observed}`,
    );
  }
});

test('S5 Claude approval: each level matches the mode it launches, and any other mode is a mismatch', async (t) => {
  const cases = [
    { name: 'auto', flags: ['--approval', 'auto'], mode: 'auto', configured: 'auto', state: 'match' },
    { name: 'left-out', flags: [], mode: 'auto', configured: 'auto', state: 'match' },
    { name: 'ask', flags: ['--approval', 'ask'], mode: 'default', configured: 'ask', state: 'match' },
    { name: 'skip', flags: ['--approval', 'dangerously-skip'], mode: 'bypassPermissions', configured: 'dangerously-skip', state: 'match' },
    { name: 'auto-as-ask', flags: ['--approval', 'auto'], mode: 'default', configured: 'auto', state: 'mismatch' },
    { name: 'ask-as-auto', flags: ['--approval', 'ask'], mode: 'auto', configured: 'ask', state: 'mismatch' },
    { name: 'ask-as-skip', flags: ['--approval', 'ask'], mode: 'bypassPermissions', configured: 'ask', state: 'mismatch' },
    { name: 'auto-accept-edits', flags: ['--approval', 'auto'], mode: 'acceptEdits', configured: 'auto', state: 'mismatch' },
    { name: 'ask-plan', flags: ['--approval', 'ask'], mode: 'plan', configured: 'ask', state: 'mismatch' },
    { name: 'skip-accept-edits', flags: ['--approval', 'dangerously-skip'], mode: 'acceptEdits', configured: 'dangerously-skip', state: 'mismatch' },
    // Read off a line of its own as well as off what the person said.
    { name: 'mode-line', flags: ['--approval', 'ask'], mode: 'default', configured: 'ask', state: 'match', own: true },
  ].map((one) => ({
    ...one,
    lines: one.own
      ? [claudeSaid(onTheDay(9)), claudeModeChanged(one.mode), claudeReply(onTheDay(9, 2), { model: 'claude-opus-5-5', effort: 'high' })]
      : [claudeSaid(onTheDay(9), one.mode), claudeReply(onTheDay(9, 1), { model: 'claude-opus-5-5', effort: 'high' })],
  }));

  const answer = await table(t, 'claude', cases);

  for (const { name, mode, configured, state } of cases) {
    assertSetting(entryOf(answer, 'api-bot', name), 'approval', { state, configured, observed: mode }, `${configured} against ${mode}`);
  }
});

test('S5 Codex approval: each level matches the words it launches, judged only on the words that level decides', async (t) => {
  const cases = [
    { name: 'auto', flags: ['--approval', 'auto'], configured: 'auto', said: ['on-request', 'auto_review', 'workspace-write'], state: 'match' },
    { name: 'left-out', flags: [], configured: 'auto', said: ['on-request', 'auto_review', 'workspace-write'], state: 'match' },
    { name: 'ask', flags: ['--approval', 'ask'], configured: 'ask', said: ['on-request', 'user', 'workspace-write'], state: 'match' },
    // The sandbox is not judged for ask.
    { name: 'ask-any-sandbox', flags: ['--approval', 'ask'], configured: 'ask', said: ['on-request', 'user', 'danger-full-access'], state: 'match' },
    { name: 'skip', flags: ['--approval', 'dangerously-skip'], configured: 'dangerously-skip', said: ['never', 'user', 'danger-full-access'], state: 'match' },
    // The reviewer is not judged for dangerously-skip.
    { name: 'skip-any-reviewer', flags: ['--approval', 'dangerously-skip'], configured: 'dangerously-skip', said: ['never', 'auto_review', 'danger-full-access'], state: 'match' },
    // The user's own defaults leaked in.
    { name: 'ask-leaked', flags: ['--approval', 'ask'], configured: 'ask', said: ['on-request', 'auto_review', 'danger-full-access'], state: 'mismatch' },
    { name: 'auto-wide-sandbox', flags: ['--approval', 'auto'], configured: 'auto', said: ['on-request', 'auto_review', 'danger-full-access'], state: 'mismatch' },
    { name: 'auto-user-reviews', flags: ['--approval', 'auto'], configured: 'auto', said: ['on-request', 'user', 'workspace-write'], state: 'mismatch' },
    { name: 'auto-never', flags: ['--approval', 'auto'], configured: 'auto', said: ['never', 'auto_review', 'workspace-write'], state: 'mismatch' },
    { name: 'ask-never', flags: ['--approval', 'ask'], configured: 'ask', said: ['never', 'user', 'workspace-write'], state: 'mismatch' },
    { name: 'skip-sandboxed', flags: ['--approval', 'dangerously-skip'], configured: 'dangerously-skip', said: ['never', 'user', 'workspace-write'], state: 'mismatch' },
    { name: 'skip-asks', flags: ['--approval', 'dangerously-skip'], configured: 'dangerously-skip', said: ['on-request', 'user', 'danger-full-access'], state: 'mismatch' },
  ].map((one) => ({
    ...one,
    lines: [codexTurn(onTheDay(9), { approval: one.said[0], reviewer: one.said[1], sandbox: one.said[2] })],
  }));

  const answer = await table(t, 'codex', cases);

  for (const { name, configured, said, state } of cases) {
    assertCodexApproval(entryOf(answer, 'api-bot', name), { state, configured }, said, `${configured} against ${said.join(' + ')}`);
  }
});

// ---------------------------------------------------------------------------
// S6 — the latest record wins.
// ---------------------------------------------------------------------------

test('S6 the latest record wins, on each harness and for each setting', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', {
    sessions: [
      ['daily', '--model', 'opus', '--effort', 'xhigh', '--approval', 'auto'],
      ['nightly', '--harness', 'codex', '--model', 'gpt-6-sol', '--effort', 'xhigh', '--context', '123456', '--approval', 'auto'],
    ],
  });
  await talking(box, bots, 'api-bot', 'daily', 'claude', conv(1), [
    claudeSaid(onTheDay(9), 'auto'),
    claudeReply(onTheDay(9, 1), { model: 'claude-sonnet-5', effort: 'high' }),
    claudeModeChanged('default'),
    claudeReply(onTheDay(9, 3), { model: 'claude-opus-5-5', effort: 'xhigh' }),
    // A later line of another type, carrying no model, effort or mode, changes none of them.
    { type: 'system', subtype: 'compact_boundary', timestamp: onTheDay(9, 4), compactMetadata: { trigger: 'auto', preTokens: 120000, postTokens: 20000 } },
  ]);
  await talking(box, bots, 'api-bot', 'nightly', 'codex', conv(2), [
    codexTurn(onTheDay(10), { model: 'gpt-6-astra', effort: 'high', approval: 'never', reviewer: 'user', sandbox: 'danger-full-access' }),
    codexTokens(onTheDay(10, 1), 190000),
    codexTurn(onTheDay(10, 2), { model: 'gpt-6-sol', effort: 'xhigh', approval: 'on-request', reviewer: 'auto_review', sandbox: 'workspace-write' }),
    codexTokens(onTheDay(10, 3), 117283),
    // A count with no info says nothing about the window.
    codexTokens(onTheDay(10, 4), null),
  ]);

  const answer = await found(box);

  const daily = entryOf(answer, 'api-bot', 'daily');
  assertSetting(daily, 'model', { state: 'match', configured: 'opus', observed: 'claude-opus-5-5' }, 'the last reply ran opus');
  assertSetting(daily, 'effort', { state: 'match', configured: 'xhigh', observed: 'xhigh' }, 'the last reply ran xhigh');
  assertSetting(daily, 'approval', { state: 'mismatch', configured: 'auto', observed: 'default' }, 'the mode changed to default after the session started');

  const nightly = entryOf(answer, 'api-bot', 'nightly');
  assertSetting(nightly, 'model', { state: 'match', configured: 'gpt-6-sol', observed: 'gpt-6-sol' }, 'the last turn ran gpt-6-sol');
  assertSetting(nightly, 'effort', { state: 'match', configured: 'xhigh', observed: 'xhigh' }, 'the last turn ran xhigh');
  assertSetting(nightly, 'context', { state: 'match', configured: '123456', observed: '117283' }, 'the last count with info says 117283');
  assertCodexApproval(nightly, { state: 'match', configured: 'auto' }, ['on-request', 'auto_review', 'workspace-write'], 'the last turn ran auto');
});

// ---------------------------------------------------------------------------
// S11 — only what the record says since the kit last started the session.
//
// `obk restart` resumes the same conversation, so its transcript still holds
// the lines the process before it wrote, and those say what that process ran
// with. The book's `launched` is when the kit last started the session: the
// first line whose timestamp is at or after it, and every line after that one
// (a Claude `permission-mode` line has no timestamp), is what counts. Nothing
// at or after it is no record at all. An entry with no `launched`, a book
// edited by hand, counts the whole record.
// ---------------------------------------------------------------------------

/** When the kit last started the sessions in these tests: noon, with the conversation begun at eleven. */
const RESTARTED = onTheDay(12);

/**
 * A session resumed at RESTARTED in a conversation begun before it: the record
 * planted, the book naming it, and `launched` set to `launched`, or taken out
 * of the entry when that is null.
 */
async function resumed(box, bots, session, harness, id, lines, launched = RESTARTED) {
  await plantConversation(box, harness, botHomeOf(bots, 'api-bot'), id, { lines, started: onTheDay(11) });
  await editBook(bots, 'api-bot', (sessions) => {
    sessions[session].session = id;
    if (launched === null) delete sessions[session].launched;
    else sessions[session].launched = launched;
  });
}

/** What the process before the restart wrote: the person in auto mode, and a reply at high effort. */
const beforeTheRestart = [
  claudeSaid(onTheDay(11, 0), 'auto'),
  claudeReply(onTheDay(11, 1), { model: 'claude-opus-5-5', effort: 'high' }),
];

test('S11 Claude: a record wholly before the kit last started the session says nothing; a reply at that moment does', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', {
    sessions: [
      ['before-only', '--model', 'opus', '--effort', 'xhigh'],
      ['bare', '--effort', 'xhigh'],
      ['reply-at-launch', '--model', 'opus', '--effort', 'xhigh'],
    ],
  });
  await resumed(box, bots, 'before-only', 'claude', conv(1), beforeTheRestart);
  await resumed(box, bots, 'bare', 'claude', conv(2), beforeTheRestart);
  // At the moment itself, not after it: the first line that counts.
  await resumed(box, bots, 'reply-at-launch', 'claude', conv(3), [
    ...beforeTheRestart,
    claudeReply(RESTARTED, { model: 'claude-opus-5-5', effort: 'xhigh' }),
  ]);

  const answer = await found(box);

  const before = entryOf(answer, 'api-bot', 'before-only');
  assertSetting(before, 'model', { state: 'unknown', configured: 'opus' }, 'what ran before the restart is not what runs now');
  assertSetting(before, 'effort', { state: 'unknown', configured: 'xhigh' }, 'the high was the process before');
  assertSetting(before, 'approval', { state: 'unknown', configured: 'auto' }, 'the mode was said before the restart');
  assertSetting(before, 'context', { state: 'not-asked-for' }, 'not asked for');

  assertSetting(entryOf(answer, 'api-bot', 'bare'), 'model', { state: 'not-asked-for' }, 'not asked for, and nothing on record since the start');

  const at = entryOf(answer, 'api-bot', 'reply-at-launch');
  assertSetting(at, 'model', { state: 'match', configured: 'opus', observed: 'claude-opus-5-5' }, 'the reply at the start counts');
  assertSetting(at, 'effort', { state: 'match', configured: 'xhigh', observed: 'xhigh' }, 'the reply at the start ran xhigh');
  assertSetting(at, 'approval', { state: 'unknown', configured: 'auto' }, 'the only mode on record was said before the start');

  assert.deepEqual(of(answer, { kind: 'session', bot: 'api-bot' }), [], `unknown and match make no finding, got: ${JSON.stringify(answer.found, null, 2)}`);
});

test('S11 Claude: an effort changed in bot.yaml shows as a mismatch until a reply since the start runs it', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['lowered', '--effort', 'xhigh'], ['no-effort-since', '--effort', 'xhigh']] });
  // Before the start the process ran xhigh; since it, high.
  await resumed(box, bots, 'lowered', 'claude', conv(1), [
    claudeSaid(onTheDay(11, 0), 'auto'),
    claudeReply(onTheDay(11, 1), { model: 'claude-opus-5-5', effort: 'xhigh' }),
    claudeSaid(onTheDay(12, 5), 'auto'),
    claudeReply(onTheDay(12, 6), { model: 'claude-opus-5-5', effort: 'high' }),
  ]);
  // Since the start only a reply with no effort on it: the xhigh before it is not what runs now.
  await resumed(box, bots, 'no-effort-since', 'claude', conv(2), [
    claudeSaid(onTheDay(11, 0), 'auto'),
    claudeReply(onTheDay(11, 1), { model: 'claude-opus-5-5', effort: 'xhigh' }),
    claudeSaid(onTheDay(12, 5), 'auto'),
    claudeReply(onTheDay(12, 6), { model: 'claude-haiku-4-5-20251001' }),
  ]);

  const answer = await found(box);

  assertSetting(entryOf(answer, 'api-bot', 'lowered'), 'effort', { state: 'mismatch', configured: 'xhigh', observed: 'high' }, 'the reply since the start ran high');
  assertSetting(entryOf(answer, 'api-bot', 'no-effort-since'), 'effort', { state: 'unknown', configured: 'xhigh' }, 'no reply since the start carries an effort');
  const mine = of(answer, { kind: 'session', bot: 'api-bot' });
  assert.equal(mine.length, 1, `one finding, for the session that ran high, got: ${JSON.stringify(mine, null, 2)}`);
  assert.ok(hasWord(mine[0].says, 'lowered') && mine[0].says.includes('xhigh') && hasWord(mine[0].says, 'high'), `it names the session and both efforts, got: ${mine[0].says}`);
});

test('S11 Claude: a permission-mode line with no timestamp counts after the first line since the start, and not before it', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['mode-after', '--approval', 'ask'], ['mode-before', '--approval', 'ask']] });
  await resumed(box, bots, 'mode-after', 'claude', conv(1), [
    claudeReply(onTheDay(11, 1), { model: 'claude-opus-5-5', effort: 'high' }),
    claudeSaid(RESTARTED),
    claudeModeChanged('default'),
  ]);
  await resumed(box, bots, 'mode-before', 'claude', conv(2), [
    claudeModeChanged('default'),
    claudeReply(onTheDay(11, 1), { model: 'claude-opus-5-5', effort: 'high' }),
    claudeSaid(onTheDay(12, 5)),
    claudeReply(onTheDay(12, 6), { model: 'claude-opus-5-5', effort: 'high' }),
  ]);

  const answer = await found(box);

  assertSetting(entryOf(answer, 'api-bot', 'mode-after'), 'approval', { state: 'match', configured: 'ask', observed: 'default' }, 'the mode line follows the first line since the start');
  assertSetting(entryOf(answer, 'api-bot', 'mode-before'), 'approval', { state: 'unknown', configured: 'ask' }, 'the mode line comes before any line since the start');
});

test('S11 Codex: only turns and counts since the kit last started the session count', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const settings = ['--model', 'gpt-6-sol', '--effort', 'xhigh', '--context', '200000'];
  await botUp(box, 'api-bot', { harness: 'codex', sessions: [['before-only', ...settings], ['since', ...settings], ['changed', ...settings]] });
  const earlier = [codexTurn(onTheDay(11, 0), { effort: 'xhigh' }), codexTokens(onTheDay(11, 1), 190000)];
  await resumed(box, bots, 'before-only', 'codex', conv(1), earlier);
  await resumed(box, bots, 'since', 'codex', conv(2), [...earlier, codexTurn(onTheDay(12, 5), { effort: 'xhigh' }), codexTokens(onTheDay(12, 6), 190000)]);
  await resumed(box, bots, 'changed', 'codex', conv(3), [...earlier, codexTurn(onTheDay(12, 5), { effort: 'high' })]);

  const answer = await found(box);

  const before = entryOf(answer, 'api-bot', 'before-only');
  assertSetting(before, 'model', { state: 'unknown', configured: 'gpt-6-sol' }, 'the turn was the process before');
  assertSetting(before, 'effort', { state: 'unknown', configured: 'xhigh' }, 'the turn was the process before');
  assertSetting(before, 'context', { state: 'unknown', configured: '200000' }, 'the count was the process before');
  assertSetting(before, 'approval', { state: 'unknown', configured: 'auto' }, 'the turn was the process before');

  const since = entryOf(answer, 'api-bot', 'since');
  assertSetting(since, 'model', { state: 'match', configured: 'gpt-6-sol', observed: 'gpt-6-sol' }, 'a turn since the start');
  assertSetting(since, 'effort', { state: 'match', configured: 'xhigh', observed: 'xhigh' }, 'a turn since the start');
  assertSetting(since, 'context', { state: 'match', configured: '200000', observed: '190000' }, 'a count since the start');
  assertCodexApproval(since, { state: 'match', configured: 'auto' }, ['on-request', 'auto_review', 'workspace-write'], 'a turn since the start');

  const changed = entryOf(answer, 'api-bot', 'changed');
  assertSetting(changed, 'effort', { state: 'mismatch', configured: 'xhigh', observed: 'high' }, 'the turn since the start ran high');
  assertSetting(changed, 'context', { state: 'unknown', configured: '200000' }, 'no count since the start');

  const mine = of(answer, { kind: 'session', bot: 'api-bot' });
  assert.equal(mine.length, 1, `one finding, for changed, got: ${JSON.stringify(mine, null, 2)}`);
  assert.ok(hasWord(mine[0].says, 'changed'), `the finding is changed's, got: ${mine[0].says}`);
});

for (const [label, launched] of [['no launched', null], ['a launched that is not a date', 'yesterday']]) {
  test(`S11 a book entry with ${label} counts nothing in the record, on both harnesses`, async (t) => {
    // No start time, no evidence: with nothing to say where the process now
    // running began, no line of the record can be said to be about it.
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await botUp(box, 'api-bot', { sessions: [['daily', '--effort', 'xhigh'], ['nightly', '--harness', 'codex', '--effort', 'xhigh']] });
    await resumed(box, bots, 'daily', 'claude', conv(1), beforeTheRestart, launched);
    await resumed(box, bots, 'nightly', 'codex', conv(2), [codexTurn(onTheDay(11, 0), { effort: 'high' }), codexTokens(onTheDay(11, 1), 258400)], launched);
    assert.equal(
      (await sessionIn(bots, 'api-bot', 'daily')).launched,
      launched ?? undefined,
      'the premise: the entry says what this case is about',
    );

    const answer = await found(box);

    for (const session of ['daily', 'nightly']) {
      const entry = entryOf(answer, 'api-bot', session);
      assertSetting(entry, 'model', { state: 'not-asked-for' }, 'not asked for, and no line of the record counts');
      assertSetting(entry, 'effort', { state: 'unknown', configured: 'xhigh' }, 'the high on record cannot be placed after the start');
      assertSetting(entry, 'context', { state: 'not-asked-for' }, 'not asked for, and no line of the record counts');
      assertSetting(entry, 'approval', { state: 'unknown', configured: 'auto' }, 'the mode on record cannot be placed after the start');
      assert.deepEqual(entry.rules, { state: 'current' }, 'the rules go by the stamp, not by launched');
    }
    assert.deepEqual(of(answer, { kind: 'session', bot: 'api-bot' }), [], `no mismatch without evidence, got: ${JSON.stringify(answer.found, null, 2)}`);
  });
}

// ---------------------------------------------------------------------------
// S7 — the rules a session was started on.
// ---------------------------------------------------------------------------

test('S7 a session up leaves a rules stamp in its book entry, and its rules are current', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['daily'], ['nightly', '--harness', 'codex']] });

  for (const session of ['daily', 'nightly']) {
    const entry = await sessionIn(bots, 'api-bot', session);
    assert.ok(entry?.rules !== undefined && entry.rules !== null && entry.rules !== '', `up should note a rules stamp in ${session}'s book entry, got: ${JSON.stringify(entry)}`);
  }

  const answer = await found(box);

  for (const session of ['daily', 'nightly']) {
    assert.deepEqual(entryOf(answer, 'api-bot', session).rules, { state: 'current' }, `${session} started on the AGENTS.md there is now`);
  }
  assert.deepEqual(answer.found, [], `nothing is wrong with a fleet just brought up, got: ${JSON.stringify(answer.found, null, 2)}`);
});

/** Give every named session of a bot a conversation in the book, so that restart and pause will take it. */
const conversationsFor = (bots, bot, names) => editBook(bots, bot, (sessions) => {
  for (const [n, name] of names.entries()) sessions[name].session = conv(50 + n);
});

/** The two ways a bot's AGENTS.md is changed from its charter. */
const CHARTER_CHANGES = [
  ['obk bot change --charter', (box) => obk(box, 'bot', 'change', '--bots', 'bots', '--bot', 'api-bot', '--charter', 'Api Bot owns the billing API now, and asks before every release.')],
  ['a charter edit in bot.yaml and obk rules build', async (box, bots) => {
    await editBotYaml(bots, 'api-bot', (doc) => { doc.charter = 'Api Bot owns the billing API now, and asks before every release.'; });
    await obk(box, 'rules', 'build', '--bots', 'bots', '--bot', 'api-bot');
  }],
];

/** The findings that say a session is on older rules: about the bot's AGENTS.md, naming the session. */
const olderFindings = (answer, bots, bot) => of(answer, { kind: 'session', bot }).filter((one) => one.where === agentsOf(bots, bot));

for (const [label, change] of CHARTER_CHANGES) {
  test(`S7 after ${label}, every running session of that bot is on older rules, with the restart for it, and no other bot is`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await botUp(box, 'api-bot', { sessions: [['daily'], ['nightly', '--harness', 'codex']] });
    await botUp(box, 'web-bot');
    const was = await agentsIn(bots, 'api-bot');

    await change(box, bots);
    assert.notEqual(await agentsIn(bots, 'api-bot'), was, 'the premise: the charter change rebuilt AGENTS.md');
    // Another up finds both tabs live and starts nothing, so nothing is restamped.
    await opened(box, 'api-bot');

    const answer = await found(box);

    const older = olderFindings(answer, bots, 'api-bot');
    for (const session of ['daily', 'nightly']) {
      assert.deepEqual(entryOf(answer, 'api-bot', session).rules, { state: 'older' }, `${session} started before AGENTS.md changed`);
      const mine = older.filter((one) => one.says.includes(`--session ${session}`));
      assert.equal(mine.length, 1, `one finding for ${session}, with its restart, got: ${JSON.stringify(older, null, 2)}`);
      assert.ok(hasWord(mine[0].says, session), `it names the session, got: ${mine[0].says}`);
      assert.match(mine[0].says, /\brestart\b/, `it says what would bring it up to date, got: ${mine[0].says}`);
      assert.ok(mine[0].says.includes('--bot api-bot'), `the restart names the bot, got: ${mine[0].says}`);
    }
    assert.equal(older.length, 2, `one finding per session, got: ${JSON.stringify(older, null, 2)}`);

    assert.deepEqual(entryOf(answer, 'web-bot', 'daily').rules, { state: 'current' }, 'web-bot\'s AGENTS.md did not change');
    assert.deepEqual(naming(answer.found, agentsOf(bots, 'web-bot')), [], 'nothing about web-bot\'s rules');
    assert.deepEqual(of(answer, { bot: 'web-bot' }), [], 'nothing about web-bot at all');
  });
}

test('S7 obk restart brings a session back onto the current rules: one session, then the whole bot', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['daily'], ['nightly', '--harness', 'codex']] });
  await conversationsFor(bots, 'api-bot', ['daily', 'nightly']);
  await CHARTER_CHANGES[0][1](box, bots);

  const before = await found(box);
  assert.equal(olderFindings(before, bots, 'api-bot').length, 2, `the premise: both sessions are on older rules, got: ${JSON.stringify(before.found, null, 2)}`);

  await obk(box, 'restart', '--bots', 'bots', '--bot', 'api-bot', '--session', 'daily');
  const one = await found(box);

  assert.deepEqual(entryOf(one, 'api-bot', 'daily').rules, { state: 'current' }, 'daily was started again on the AGENTS.md there is now');
  assert.deepEqual(entryOf(one, 'api-bot', 'nightly').rules, { state: 'older' }, 'nightly was not restarted');
  const left = olderFindings(one, bots, 'api-bot');
  assert.equal(left.length, 1, `only nightly is left on older rules, got: ${JSON.stringify(left, null, 2)}`);
  assert.ok(left[0].says.includes('--session nightly'), `and the finding is nightly's, got: ${left[0].says}`);

  await obk(box, 'restart', '--bots', 'bots', '--bot', 'api-bot');
  const all = await found(box);

  for (const session of ['daily', 'nightly']) {
    assert.deepEqual(entryOf(all, 'api-bot', session).rules, { state: 'current' }, `${session} is on the current rules after the restart`);
  }
  assert.deepEqual(olderFindings(all, bots, 'api-bot'), [], 'the finding is gone');
});

test('S7 obk unpause starts a session on the current rules, beside one still running on the older', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['daily'], ['nightly']] });
  await conversationsFor(bots, 'api-bot', ['daily', 'nightly']);
  await obk(box, 'pause', '--bots', 'bots', '--bot', 'api-bot', '--session', 'daily');
  await CHARTER_CHANGES[0][1](box, bots);
  await obk(box, 'unpause', '--bots', 'bots', '--bot', 'api-bot', '--session', 'daily');

  const answer = await found(box);

  assert.deepEqual(entryOf(answer, 'api-bot', 'daily').rules, { state: 'current' }, 'daily came back up after the change');
  assert.deepEqual(entryOf(answer, 'api-bot', 'nightly').rules, { state: 'older' }, 'nightly ran on through it');
  const older = olderFindings(answer, bots, 'api-bot');
  assert.equal(older.length, 1, `one finding, for nightly, got: ${JSON.stringify(older, null, 2)}`);
  assert.ok(older[0].says.includes('--session nightly'), `the finding is nightly's, got: ${older[0].says}`);
});

test('S7 a skill added to a bot changes no rules, and makes no session older', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['daily'], ['nightly', '--harness', 'codex']] });
  const was = await agentsIn(bots, 'api-bot');
  await commonSkill(bots, 'my-skill');

  await obk(box, 'skills', 'add', '--bots', 'bots', '--bot', 'api-bot', '--skill', 'my-skill');
  await obk(box, 'skills', 'build', '--bots', 'bots', '--bot', 'api-bot');
  assert.equal(await agentsIn(bots, 'api-bot'), was, 'the premise: a skill does not change AGENTS.md');

  const answer = await found(box);

  for (const session of ['daily', 'nightly']) {
    assert.deepEqual(entryOf(answer, 'api-bot', session).rules, { state: 'current' }, `${session} reaches the skill without a restart`);
  }
  assert.deepEqual(olderFindings(answer, bots, 'api-bot'), [], 'no session is on older rules');
});

test('S7 a book entry without a rules stamp is unknown and no finding, beside a stamped one that is older', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['daily'], ['nightly']] });
  // A session started by an older kit, or a book edited by hand.
  await editBook(bots, 'api-bot', (sessions) => { delete sessions.daily.rules; });
  await CHARTER_CHANGES[0][1](box, bots);

  const answer = await found(box);

  assert.deepEqual(entryOf(answer, 'api-bot', 'daily').rules, { state: 'unknown' }, 'no stamp, so nothing to compare');
  assert.deepEqual(entryOf(answer, 'api-bot', 'nightly').rules, { state: 'older' }, 'the stamped one changed');
  const older = olderFindings(answer, bots, 'api-bot');
  assert.equal(older.length, 1, `one finding, for nightly alone, got: ${JSON.stringify(older, null, 2)}`);
  assert.ok(older[0].says.includes('--session nightly'), `the finding is nightly's, got: ${older[0].says}`);
  assert.deepEqual(naming(of(answer, { bot: 'api-bot' }), '--session daily'), [], 'unknown is not a finding');
});

// ---------------------------------------------------------------------------
// S10 — a /clear on Claude Code reads AGENTS.md again; a new Codex conversation
// is not known to.
//
// Seen on this machine's records: a Claude conversation begun by /clear loaded
// AGENTS.md text added after the process started. So when the kit's hook hears
// of a Claude session with `source: "clear"`, it stamps the rules as they are
// then. Whether Codex re-reads AGENTS.md on its `/new` is not verified, so a
// new Codex conversation (a new id, with `source: "startup"`) stamps nothing.
// The hook is run the way a harness runs it, from the session's own tab.
// ---------------------------------------------------------------------------

/** Give a bot a new charter in bot.yaml and build its rules, which rewrites its AGENTS.md. */
async function newCharter(box, bots, charter) {
  const was = await agentsIn(bots, 'api-bot');
  await editBotYaml(bots, 'api-bot', (doc) => { doc.charter = charter; });
  await obk(box, 'rules', 'build', '--bots', 'bots', '--bot', 'api-bot');
  assert.notEqual(await agentsIn(bots, 'api-bot'), was, 'the premise: the new charter rewrote AGENTS.md');
}

/** Report a session starting a conversation, through the kit's hook, from the session's own tab. */
async function hookHears(box, bots, session, id, source) {
  const entry = await sessionIn(bots, 'api-bot', session);
  await recordSession(box, { bots, bot: 'api-bot', tab: entry.tab, session: id, source });
  assert.equal((await sessionIn(bots, 'api-bot', session)).session, id, `the premise: the book took ${id} as ${session}'s conversation`);
}

test('S10 a Claude session cleared after the rules changed is current and no finding; one not cleared stays older, and its finding offers /clear and the restart', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['daily'], ['review']] });
  await hookHears(box, bots, 'daily', conv(1), 'startup');
  await hookHears(box, bots, 'review', conv(2), 'startup');
  await newCharter(box, bots, 'Api Bot owns the billing API now, and asks before every release.');

  await hookHears(box, bots, 'daily', conv(3), 'clear');
  const answer = await found(box);

  assert.deepEqual(entryOf(answer, 'api-bot', 'daily').rules, { state: 'current' }, 'the clear read the AGENTS.md there is now');
  assert.deepEqual(entryOf(answer, 'api-bot', 'review').rules, { state: 'older' }, 'review was not cleared');
  const older = olderFindings(answer, bots, 'api-bot');
  assert.deepEqual(older.filter((one) => one.says.includes('--session daily')), [], 'nothing about daily\'s rules');
  assert.equal(older.length, 1, `one finding, for review, got: ${JSON.stringify(older, null, 2)}`);
  const says = older[0].says;
  assert.ok(hasWord(says, 'review'), `it names the session, got: ${says}`);
  assert.ok(says.includes('/clear'), `a Claude session is brought up to date by /clear, so the finding offers it, got: ${says}`);
  assert.match(says, /\brestart\b/, `and the restart, got: ${says}`);
  assert.ok(says.includes('--bot api-bot') && says.includes('--session review'), `the restart names the bot and the session, got: ${says}`);

  // The stamp is of AGENTS.md as it was at the clear, not a mark that the
  // session is up to date for good: the next change leaves it older again.
  await newCharter(box, bots, 'Api Bot owns the billing API and the invoices, and asks before every release.');
  const later = await found(box);

  assert.deepEqual(entryOf(later, 'api-bot', 'daily').rules, { state: 'older' }, 'AGENTS.md changed again after the clear');
  assert.equal(
    olderFindings(later, bots, 'api-bot').filter((one) => one.says.includes('--session daily')).length,
    1,
    `and daily's finding is back, got: ${JSON.stringify(later.found, null, 2)}`,
  );
});

test('S10 a new Codex conversation after the rules changed stays older, and its finding offers the restart and not /new or /clear', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['nightly', '--harness', 'codex']] });
  await hookHears(box, bots, 'nightly', conv(1), 'startup');
  await newCharter(box, bots, 'Api Bot owns the billing API now, and asks before every release.');

  // Codex's /new: a new conversation id, which the hook hears as a startup.
  await hookHears(box, bots, 'nightly', conv(2), 'startup');
  const answer = await found(box);

  assert.deepEqual(entryOf(answer, 'api-bot', 'nightly').rules, { state: 'older' }, 'nothing says Codex read AGENTS.md again');
  const older = olderFindings(answer, bots, 'api-bot');
  assert.equal(older.length, 1, `one finding, for nightly, got: ${JSON.stringify(older, null, 2)}`);
  const says = older[0].says;
  assert.ok(hasWord(says, 'nightly'), `it names the session, got: ${says}`);
  assert.match(says, /\brestart\b/, `it offers the restart, got: ${says}`);
  assert.ok(says.includes('--bot api-bot') && says.includes('--session nightly'), `the restart names the bot and the session, got: ${says}`);
  assert.ok(!says.includes('/new'), `a new Codex conversation is not known to read the rules, so it is not offered, got: ${says}`);
  assert.ok(!says.includes('/clear'), `nor is /clear, got: ${says}`);
});

// ---------------------------------------------------------------------------
// S8 — which sessions are covered, and in what order.
// ---------------------------------------------------------------------------

test('S8 a paused session, a paused bot and a session the book has no entry for get no entry, and no finding', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['daily', '--model', 'opus'], ['nightly', '--model', 'opus']] });
  await botUp(box, 'web-bot', { sessions: [['daily', '--model', 'opus']] });
  // Both of api-bot's sessions ran sonnet where opus was asked for: a mismatch
  // either way, so what makes the difference is the pause.
  for (const [n, session] of ['daily', 'nightly'].entries()) {
    await talking(box, bots, 'api-bot', session, 'claude', conv(1 + n), claudeRan({ model: 'claude-sonnet-5', effort: 'high' }));
  }
  await talking(box, bots, 'web-bot', 'daily', 'claude', conv(3), claudeRan({ model: 'claude-sonnet-5', effort: 'high' }));
  await obk(box, 'pause', '--bots', 'bots', '--bot', 'api-bot', '--session', 'daily');
  await obk(box, 'pause', '--bots', 'bots', '--bot', 'web-bot');
  await obk(box, 'session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'later', '--model', 'opus');
  assert.equal(await sessionIn(bots, 'api-bot', 'later'), undefined, 'the premise: the book has no entry for a session never brought up');

  const answer = await found(box);

  assert.equal(entryOf(answer, 'api-bot', 'nightly').settings.model.state, 'mismatch', 'the session running is judged');
  assert.equal(hasEntry(answer, 'api-bot', 'daily'), false, 'a paused session is left out');
  assert.equal(hasEntry(answer, 'web-bot', 'daily'), false, 'a session of a paused bot is left out');
  assert.equal(hasEntry(answer, 'api-bot', 'later'), false, 'a session the book has no entry for is left out');

  const mine = of(answer, { kind: 'session', bot: 'api-bot' });
  assert.equal(mine.filter((one) => one.says.includes('nightly')).length, 1, `the running session's mismatch is a finding, got: ${JSON.stringify(mine, null, 2)}`);
  assert.deepEqual(mine.filter((one) => hasWord(one.says, 'daily')), [], 'the paused one is not');
  assert.deepEqual(of(answer, { kind: 'session', bot: 'web-bot' }), [], 'nor is the paused bot\'s');
});

test('S8 a session whose tab Orca no longer has gets no entry and no settings or rules finding, only the missing tab', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['daily', '--model', 'opus'], ['review', '--model', 'opus']] });
  // Both ran sonnet where opus was asked for, and both started before the
  // charter changed: all that differs between them is whether the tab is there.
  await talking(box, bots, 'api-bot', 'daily', 'claude', conv(1), claudeRan({ model: 'claude-sonnet-5', effort: 'high' }));
  await talking(box, bots, 'api-bot', 'review', 'claude', conv(2), claudeRan({ model: 'claude-sonnet-5', effort: 'high' }));
  await CHARTER_CHANGES[0][1](box, bots);
  const gone = (await sessionIn(bots, 'api-bot', 'review')).tab;
  const terminals = await box.orca.terminals();
  assert.ok(terminals.some((one) => one.tabId === gone), `the premise: Orca had review's tab ${gone}`);
  await box.orca.set({ terminals: terminals.filter((one) => one.tabId !== gone) });

  const answer = await found(box);

  const daily = entryOf(answer, 'api-bot', 'daily');
  assert.equal(daily.settings.model.state, 'mismatch', 'the running session is judged');
  assert.deepEqual(daily.rules, { state: 'older' }, 'and its rules too');
  const mine = of(answer, { kind: 'session', bot: 'api-bot' });
  assert.equal(
    mine.filter((one) => hasWord(one.says, 'daily')).length,
    2,
    `daily has its mismatch and its older rules, got: ${JSON.stringify(mine, null, 2)}`,
  );

  assert.equal(hasEntry(answer, 'api-bot', 'review'), false, 'a session whose tab is gone is not running, and gets no entry');
  const aboutReview = mine.filter((one) => hasWord(wordsOf(one), 'review'));
  assert.equal(aboutReview.length, 1, `review gets the one finding about its missing tab, got: ${JSON.stringify(aboutReview, null, 2)}`);
  assert.ok(wordsOf(aboutReview[0]).includes(gone), `and that finding names the tab, got: ${JSON.stringify(aboutReview[0])}`);
  assert.notEqual(aboutReview[0].where, agentsOf(bots, 'api-bot'), 'it is not the older-rules finding');
  assert.ok(!aboutReview[0].says.includes('claude-sonnet-5'), `nor the mismatch, got: ${aboutReview[0].says}`);
});

// A tab can stay open after its harness has quit to the tab's shell (seen
// live, test/harness-in-tab.test.js). Health asks who is in front of a live
// tab the way the kit does before it types into one: Orca's pane pid, then
// `ps`. The fakes answer for it, and a terminal's own `foreground` sets it for
// that tab alone.

/** Put `front` in front of one session's tab alone, in the fake Orca's world. */
async function frontOf(box, bots, session, front) {
  const { tab } = await sessionIn(bots, 'api-bot', session);
  const terminals = await box.orca.terminals();
  assert.ok(terminals.some((one) => one.tabId === tab), `the premise: Orca has ${session}'s tab ${tab}`);
  await box.orca.set({ terminals: terminals.map((one) => (one.tabId === tab ? { ...one, foreground: front } : one)) });
}

/** A bot whose sessions each ran sonnet where opus was asked for, and started before its charter changed. */
async function behindOnBoth(box, sessions) {
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: sessions.map((name) => [name, '--model', 'opus']) });
  for (const [n, name] of sessions.entries()) {
    await talking(box, bots, 'api-bot', name, 'claude', conv(1 + n), claudeRan({ model: 'claude-sonnet-5', effort: 'high' }));
  }
  await CHARTER_CHANGES[0][1](box, bots);
  return bots;
}

for (const shell of ['shell', 'bare-shell']) {
  test(`S8 a session whose tab has its ${shell} in front is not running: no entry and no settings or rules finding, beside a sibling whose harness is`, async (t) => {
    const box = await createSandbox(t);
    const bots = await behindOnBoth(box, ['daily', 'review']);
    await frontOf(box, bots, 'review', shell);

    const answer = await found(box);

    const daily = entryOf(answer, 'api-bot', 'daily');
    assert.equal(daily.running, 'yes', 'the harness is in front of daily\'s tab');
    assert.equal(daily.settings.model.state, 'mismatch', 'the running session is judged');
    assert.deepEqual(daily.rules, { state: 'older' }, 'and its rules too');
    const mine = of(answer, { kind: 'session', bot: 'api-bot' });
    assert.equal(
      mine.filter((one) => hasWord(one.says, 'daily')).length,
      2,
      `daily keeps its mismatch and its older rules, got: ${JSON.stringify(mine, null, 2)}`,
    );

    assert.equal(hasEntry(answer, 'api-bot', 'review'), false, 'the harness in review\'s tab quit, so it is not running');
    const aboutReview = mine.filter((one) => hasWord(wordsOf(one), 'review'));
    assert.deepEqual(
      aboutReview.filter((one) => one.where === agentsOf(bots, 'api-bot') || one.says.includes('claude-sonnet-5')),
      [],
      `no mismatch and no older rules for review, got: ${JSON.stringify(aboutReview, null, 2)}`,
    );
  });
}

test('S8 every entry of a session whose harness is in front says running: yes, on both harnesses', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['daily'], ['nightly', '--harness', 'codex']] });

  const answer = await found(box);

  assert.ok(answer.sessions.length >= 3, `Bot Father's daily and api-bot's two, got: ${JSON.stringify(answer.sessions, null, 2)}`);
  for (const entry of answer.sessions) {
    assert.equal(entry.running, 'yes', `${entry.bot} ${entry.session} has its harness in front, got: ${JSON.stringify(entry)}`);
  }
});

for (const front of ['no-pid', 'ps-fails', 'garbage']) {
  test(`S8 a tab whose front cannot be read (${front}) keeps its entry as running: unknown, with its settings and rules, and no finding for them`, async (t) => {
    const box = await createSandbox(t);
    const bots = await behindOnBoth(box, ['daily']);
    await frontOf(box, bots, 'daily', front);

    const answer = await found(box);
    const plain = await health(box);

    const daily = entryOf(answer, 'api-bot', 'daily');
    assert.equal(daily.running, 'unknown', 'nothing says whether the harness is there');
    assertSetting(daily, 'model', { state: 'mismatch', configured: 'opus', observed: 'claude-sonnet-5' }, 'the record is still read and shown');
    assert.deepEqual(daily.rules, { state: 'older' }, 'the stamp is still compared and shown');
    assert.deepEqual(
      of(answer, { kind: 'session', bot: 'api-bot' }),
      [],
      `nothing shows those settings or rules are in use, so neither is a finding, got: ${JSON.stringify(answer.found, null, 2)}`,
    );

    // The plain lines say it cannot tell, and never call daily running.
    const text = plain.stdout;
    assert.match(
      text,
      /\b(cannot|can't|could not|couldn't|unable to)\b[^\n]*\b(tell|say|see|know|read)\b/i,
      `the plain lines should say the kit cannot tell whether the harness is running, got:\n${text}`,
    );
    for (const line of text.split('\n').filter((one) => hasWord(one, 'daily') && /\brunning\b/i.test(one))) {
      assert.match(line, /\b(whether|cannot|can't|could not|couldn't|unknown|unable)\b/i, `a line about daily must not call it running, got: ${line}`);
    }
  });
}

test('S8 the entries come in bot name order, then in the order of each bot\'s sessions in bot.yaml', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  // Made in the other order from their names, and sessions out of name order.
  await botUp(box, 'web-bot', { sessions: [['zeta'], ['alpha']] });
  await botUp(box, 'api-bot', { sessions: [['nightly'], ['daily'], ['review', '--harness', 'codex']] });

  const answer = await found(box);

  assert.deepEqual(
    answer.sessions.filter((one) => one.bot !== 'bot-father').map((one) => `${one.bot}/${one.session}`),
    ['api-bot/nightly', 'api-bot/daily', 'api-bot/review', 'web-bot/zeta', 'web-bot/alpha'],
    'by bot name, then as bot.yaml lists them',
  );
  const names = [...new Set(answer.sessions.map((one) => one.bot))];
  assert.deepEqual(names, [...names].sort(), 'the bots in name order, Bot Father among them');
  assert.ok(await sessionIn(bots, 'api-bot', 'review'), 'the premise: every session here is in the book');
});

// ---------------------------------------------------------------------------
// S9 — a clean fleet, the plain lines, and a health run writes nothing.
// ---------------------------------------------------------------------------

test('S9 sessions all match, not asked for, unknown and current make no finding, and health exits 0', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', {
    sessions: [
      ['daily', '--model', 'sonnet', '--effort', 'high'],
      ['nightly', '--harness', 'codex'],
      ['review', '--model', 'opus', '--approval', 'ask'],
    ],
  });
  await talking(box, bots, 'api-bot', 'daily', 'claude', conv(1), claudeRan({ model: 'claude-sonnet-5', effort: 'high' }));
  await talking(box, bots, 'api-bot', 'nightly', 'codex', conv(2), [codexTurn(onTheDay(9), { model: 'gpt-6-astra' }), codexTokens(onTheDay(9, 1), 258400)]);
  // review has no conversation in the book at all: unknown.

  const answer = await found(box);

  assert.deepEqual(
    SETTINGS.map((setting) => entryOf(answer, 'api-bot', 'daily').settings[setting].state),
    ['match', 'match', 'not-asked-for', 'match'],
    'the premise: daily matches where it asked',
  );
  assert.deepEqual(
    SETTINGS.map((setting) => entryOf(answer, 'api-bot', 'nightly').settings[setting].state),
    ['not-asked-for', 'not-asked-for', 'not-asked-for', 'match'],
    'the premise: nightly asked for nothing but auto',
  );
  assert.deepEqual(
    SETTINGS.map((setting) => entryOf(answer, 'api-bot', 'review').settings[setting].state),
    ['unknown', 'not-asked-for', 'not-asked-for', 'unknown'],
    'the premise: review has no record',
  );
  assert.deepEqual(answer.found, [], `nothing is wrong, got: ${JSON.stringify(answer.found, null, 2)}`);
});

test('S9 the plain lines name each session\'s bot, session, and every state with its values', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', {
    sessions: [['daily', '--model', 'opus', '--effort', 'high'], ['nightly', '--model', 'haiku', '--effort', 'medium']],
  });
  await talking(box, bots, 'api-bot', 'daily', 'claude', conv(1), [
    claudeSaid(onTheDay(9), 'bypassPermissions'),
    claudeReply(onTheDay(9, 1), { model: 'claude-sonnet-5', effort: 'xhigh' }),
  ]);
  // nightly has no conversation in the book: every setting it asked for is unknown.

  const answer = await found(box);
  const plain = await health(box);

  assert.equal(plain.code, 1, 'the same run, so the same answer');
  assert.equal(plain.stderr, '');
  const text = plain.stdout;
  for (const entry of answer.sessions) {
    assert.ok(text.includes(entry.bot) && text.includes(entry.session), `the plain lines name ${entry.bot} ${entry.session}, got:\n${text}`);
  }
  for (const word of ['api-bot', 'daily', 'nightly', 'opus', 'claude-sonnet-5', 'high', 'xhigh', 'bypassPermissions', 'haiku', 'medium']) {
    assert.ok(text.includes(word), `the plain lines should carry ${word}, got:\n${text}`);
  }
  assert.match(text, /\bmismatch\b/i, `a mismatch is said, got:\n${text}`);
  assert.match(text, /\bunknown\b/i, `an unknown is said, got:\n${text}`);
  assert.match(text, /\bnot[- ]asked[- ]for\b/i, `a setting not asked for is said, got:\n${text}`);
});

test('S9 health writes nothing: the book, bot.yaml, AGENTS.md and every other file are byte for byte the same', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', {
    sessions: [['daily', '--model', 'opus'], ['nightly', '--harness', 'codex', '--effort', 'high'], ['review']],
  });
  await conversationsFor(bots, 'api-bot', ['daily', 'nightly', 'review']);
  // A mismatch on each harness, a session with no record, an older stamp and a
  // missing one: every state a health run might be tempted to write back.
  await plantConversation(box, 'claude', botHomeOf(bots, 'api-bot'), conv(50), { lines: claudeRan({ model: 'claude-sonnet-5', effort: 'high' }) });
  await plantConversation(box, 'codex', botHomeOf(bots, 'api-bot'), conv(51), { lines: [codexTurn(onTheDay(9), { effort: 'low' })] });
  await editBook(bots, 'api-bot', (sessions) => {
    delete sessions.review.rules;
    for (const one of Object.values(sessions)) one.launched = LAUNCHED;
  });
  await CHARTER_CHANGES[0][1](box, bots);

  const before = await snapshot(box.root, skipOrcaFake);
  const book = await readFile(bookOf(bots, 'api-bot'), 'utf8');
  const botYaml = await readFile(botYamlOf(bots, 'api-bot'), 'utf8');
  const agents = await agentsIn(bots, 'api-bot');
  const terminals = await box.orca.terminals();

  const answer = await found(box);
  const plain = await health(box);

  assert.ok(of(answer, { kind: 'session', bot: 'api-bot' }).length >= 4, `the fleet should be in trouble, or this proves nothing, got: ${JSON.stringify(answer.found, null, 2)}`);
  assert.equal(plain.code, 1, plain.stderr);
  assert.equal(await readFile(bookOf(bots, 'api-bot'), 'utf8'), book, 'the book is as it was');
  assert.equal(await readFile(botYamlOf(bots, 'api-bot'), 'utf8'), botYaml, 'bot.yaml is as it was');
  assert.equal(await agentsIn(bots, 'api-bot'), agents, 'AGENTS.md is as it was');
  assert.deepEqual(await snapshot(box.root, skipOrcaFake), before, 'every file and link, the transcripts included, is as it was');
  assert.deepEqual(await box.orca.terminals(), terminals, 'no tab opened, closed or typed into');
});
