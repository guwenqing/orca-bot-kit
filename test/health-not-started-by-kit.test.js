// `obk health` names a session the kit's launch line did not start (#318).
//
// After a machine restart or an Orca update, Orca resumes every tab's harness
// by itself, as a bare `claude --resume <id>` or `codex resume <id>`. Such a
// harness runs on its own defaults and whatever Orca added, not on what
// bot.yaml asks for: on 2026-09-25 that left two Codex reviewers asking for no
// approval with full disk access, and health blamed a bot.yaml change. The
// Claude sessions matched only because the user's defaults happened to.
//
// So for each session whose tab is live with its own harness in front (health's
// `running: yes`), health reads the environment of the process in front, with
// `<OBK_PS> -E -ww -o command= -p <pid>` (tech notes, section 1). The kit's
// launch line puts OBK_TAB_SHELL there. Its absence, in an environment that
// carries ORCA_TAB_ID=<that tab's id>, is a harness the kit did not start, and
// that session gets one finding of kind `session`: the bot, the session, that
// the kit did not start it, and the restart that puts it back on bot.yaml.
// That holds when every setting health can see happens to match, and when some
// do not the same finding says so, with that cause, instead of a second one
// that blames a bot.yaml change.
//
// A session the kit started keeps today's behaviour: no such finding, and a
// settings mismatch keeps today's finding. An environment that cannot be read,
// or carries no ORCA_TAB_ID for that tab, is "cannot tell": nothing new. So is
// every session that is not `running: yes`: another program in front, the
// shell in front, a paused session, a tab that is gone.
//
// The wording is the implementer's. What is pinned is the kind, the bot, the
// session and the command: the kit's own CLI, as every command the kit prints
// is (#220), running `restart` with the bots folder, the bot and the session.
// The two K3 tests, where the words are all there is to tell the new finding
// from today's settings finding, also read the cause loosely. Everything runs
// against the fake Orca and the fake `ps` (helpers/fake-ps.js says what each
// `environment` a tab can be given means).

import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import {
  bookOf,
  botHomeOf,
  createSandbox,
  orcaCommand,
  sessionIn,
  shellWord,
  skipOrcaFake,
  snapshot,
  spellingsOf,
} from './helpers/cli.js';
import { PS_ENVIRONMENT, PS_READ } from './helpers/fake-ps.js';

/** The kinds a finding can be. */
const KINDS = ['orca', 'config', 'skill', 'session', 'leftover'];

// ---------------------------------------------------------------- the fleet

/** A bots folder with Bot Father up in Orca. */
async function seeded(box) {
  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(result.code, 0, result.stderr);
  return box.path('bots');
}

/** Run one more `obk` command that has to work for the test to mean anything. */
async function obk(box, ...args) {
  const result = await box.run([...args]);
  assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stderr}${result.stdout}`);
  return result;
}

/**
 * One more bot on `harness`, brought up in Orca by the kit. Each session is a
 * name, or `[name, ...flags]` with the flags as `session add` takes them.
 */
async function botUp(box, name, { harness = 'claude', sessions = ['daily'] } = {}) {
  await obk(box, 'bot', 'create', '--bots', 'bots', '--name', name, '--harness', harness);
  for (const session of sessions) {
    const [named, ...flags] = [session].flat();
    await obk(box, 'session', 'add', '--bots', 'bots', '--bot', name, '--name', named, ...flags);
  }
  await obk(box, 'up', '--bots', 'bots', '--bot', name);
}

/** Change what one bot's book says about its sessions, as a person editing it by hand would. */
async function editBook(bots, bot, change) {
  const file = bookOf(bots, bot);
  const book = parse(await readFile(file, 'utf8'));
  change(book.sessions);
  await writeFile(file, stringify(book));
}

/** The ids a conversation is known by in these tests: shaped the way both harnesses shape them. */
const conv = (n) => `0199b2c0-${String(n).padStart(4, '0')}-4444-8888-cccccccccccc`;

/** Give every named session of a bot a conversation in the book, so that restart will resume it. */
async function conversationsFor(bots, bot, names) {
  await editBook(bots, bot, (sessions) => {
    for (const [n, name] of names.entries()) sessions[name].session = conv(50 + n);
  });
}

/** Change one terminal of the fake Orca's, the one a session's tab is. */
async function changeTab(box, bots, bot, session, change) {
  const { tab } = await sessionIn(bots, bot, session);
  const terminals = await box.orca.terminals();
  assert.ok(terminals.some((one) => one.tabId === tab), `the premise: Orca has ${bot} ${session}'s tab ${tab}`);
  await box.orca.set({ terminals: terminals.map((one) => (one.tabId === tab ? { ...one, ...change } : one)) });
}

/**
 * Say what the process in front of one session's tab carries in its
 * environment, in the words helpers/fake-ps.js takes: 'orca' is a harness Orca
 * resumed by itself; left alone, it is what the kit's launch line gave it.
 */
const environmentOf = (box, bots, bot, session, environment) => changeTab(box, bots, bot, session, { environment });

/** Put `front` in front of one session's tab alone. */
const frontOf = (box, bots, bot, session, front) => changeTab(box, bots, bot, session, { foreground: front });

// ------------------------------------------------- what a harness writes down

/** A moment on the day these conversations are set, as both harnesses write one. */
const onTheDay = (hour, minute = 0) =>
  `2026-09-20T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;

/** When the kit last started the sessions these tests plant conversations for: before every line they carry. */
const LAUNCHED = onTheDay(8);

/**
 * A session running conversation `id` since the kit started it at LAUNCHED:
 * the harness's own record of it planted where the harness keeps it, with
 * `lines` after its first, and the book naming it, as the kit's hook would
 * have. The same shapes test/session-settings.test.js plants.
 */
async function talking(box, bots, bot, session, harness, id, lines) {
  const home = botHomeOf(bots, bot);
  const file = harness === 'codex'
    ? path.join(box.home, '.codex', 'sessions', ...LAUNCHED.slice(0, 10).split('-'), `rollout-${LAUNCHED.replaceAll(':', '-').replace(/\..*$/, '')}-${id}.jsonl`)
    : path.join(box.home, '.claude', 'projects', home.replaceAll(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  const first = harness === 'codex'
    ? { timestamp: LAUNCHED, type: 'session_meta', payload: { id, cwd: home, timestamp: LAUNCHED } }
    : { type: 'system', sessionId: id, cwd: home, timestamp: LAUNCHED };
  const rest = harness === 'codex' ? lines : lines.map((line) => ({ sessionId: id, ...line }));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${[first, ...rest].map((line) => JSON.stringify(line)).join('\n')}\n`);
  await editBook(bots, bot, (sessions) => { sessions[session].session = id; sessions[session].launched = LAUNCHED; });
}

/** Something the person said to Claude Code, carrying the permission mode the session was in. */
const claudeSaid = (when, permissionMode) => ({
  type: 'user',
  timestamp: when,
  permissionMode,
  message: { role: 'user', content: 'Carry on with the queue.' },
});

/** One Claude Code reply, carrying the model and effort it ran on. */
const claudeReply = (when, { model, effort }) => ({
  type: 'assistant',
  timestamp: when,
  requestId: `req_${when}`,
  effort,
  message: {
    id: `msg_${when}`,
    role: 'assistant',
    model,
    usage: { input_tokens: 2, cache_read_input_tokens: 100, cache_creation_input_tokens: 0, output_tokens: 10 },
  },
});

/** What Codex was set to for the turns that follow it. */
const codexTurn = (when, { approval, reviewer, sandbox }) => ({
  timestamp: when,
  type: 'turn_context',
  payload: {
    model: 'gpt-6-sol',
    effort: 'high',
    approval_policy: approval,
    approvals_reviewer: reviewer,
    sandbox_policy: { type: sandbox },
  },
});

// ------------------------------------------------------------- what it answers

/** Run the health check. */
const health = (box, ...rest) => box.run(['health', '--bots', 'bots', ...rest]);

/**
 * Run the health check for JSON and hold it to its shape: findings of the
 * kinds there are, each saying where and what, a list of sessions, and the exit
 * code the findings call for (1 when there is one, 0 when there is none).
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
  assert.equal(
    result.code,
    answer.found.length === 0 ? 0 : 1,
    `${answer.found.length} findings should exit ${answer.found.length === 0 ? 0 : 1}, got ${result.code}`,
  );
  return answer;
}

/** Everything one finding puts in front of a reader. */
const wordsOf = (finding) => `${finding.where} ${finding.says}`;

/** Whether `word` is in `text` as a word of its own, not inside another. */
const hasWord = (text, word) => new RegExp(`(^|[^A-Za-z0-9_-])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9_-])`).test(text);

/** The findings about one session of one bot: the bot's own, naming the session. */
const about = (answer, bot, session) => answer.found.filter((one) => one.bot === bot && hasWord(wordsOf(one), session));

/** The one entry of `sessions` about one session of one bot, or undefined. */
const entryOf = (answer, bot, session) => answer.sessions.find((one) => one.bot === bot && one.session === session);

/** Every run of whitespace as one space, so an indented or re-wrapped sentence still reads the same. */
const flat = (text) => text.replace(/\s+/g, ' ').trim();

/** Whether `says` carries the kit's own CLI running `verb`. */
const commandIn = (says, box, verb) => spellingsOf(box.cli).some((cli) => says.includes(`${cli} ${verb} `));

/** Words that call a session not running, as test/health-shell-in-front.test.js reads them. */
const NOT_RUNNING = /\b(?:not|isn't|is no longer|no longer)\s+running\b|\bdown\b/i;

/**
 * Words that say the kit did not start the session, read loosely: the launch
 * line, the kit or obk not having started it, or Orca having brought it back.
 * Only the K3 tests, which have nothing else to tell the new finding from
 * today's settings finding by, read them.
 */
const NOT_BY_THE_KIT = /launch line|not (?:been )?(?:started|launched) by (?:the kit|obk)|(?:the kit|obk) (?:did not|didn't) (?:start|launch)|Orca (?:brought|resumed|restored|relaunched|started)/i;

/** Words that give a change to bot.yaml as the reason a session runs on something else. */
const BOT_YAML_CHANGED = /bot\.yaml (?:was |has been )?changed|changed (?:in )?bot\.yaml/i;

/**
 * Hold `says` to carrying the restart that puts one session back on bot.yaml:
 * the kit's own CLI running `restart`, with the bots folder, the bot and the
 * session.
 */
function assertRestartIn(says, box, bots, bot, session) {
  assert.ok(commandIn(says, box, 'restart'), `the command is the kit's own CLI, ${shellWord(box.cli)}, running restart, got: ${says}`);
  assert.ok(
    spellingsOf(bots).some((word) => says.includes(`--bots ${word}`)),
    `the restart names the bots folder, ${shellWord(bots)}, got: ${says}`,
  );
  assert.ok(says.includes(`--bot ${bot}`), `the restart names the bot, got: ${says}`);
  assert.ok(hasWord(says, `--session ${session}`), `the restart names the session, got: ${says}`);
}

/**
 * The one finding that names a session the kit did not start: kind `session`,
 * the bot and the session named, and the restart that puts it back. Returns
 * what it says.
 */
function assertNamedNotStartedByKit(answer, box, bots, bot, session) {
  const entry = entryOf(answer, bot, session);
  assert.equal(entry?.running, 'yes', `the premise: ${bot} ${session}'s harness is in front, got: ${JSON.stringify(answer.sessions, null, 2)}`);
  const mine = about(answer, bot, session);
  assert.equal(mine.length, 1, `one finding about ${bot} ${session}, which Orca resumed by itself, got: ${JSON.stringify(answer.found, null, 2)}`);
  const [finding] = mine;
  assert.equal(finding.kind, 'session', `it is a finding about a session, got: ${JSON.stringify(finding)}`);
  assert.ok(hasWord(finding.says, session), `it names the session, got: ${finding.says}`);
  assert.ok(finding.says.includes(bot), `and the bot, got: ${finding.says}`);
  assertRestartIn(finding.says, box, bots, bot, session);
  return finding;
}

/** The plain run says what the JSON said about `finding`: kind and where on one line, and the same words. */
function assertPlainSays(plain, finding) {
  assert.equal(plain.code, 1, `the plain run finds the same, got: ${plain.stdout}${plain.stderr}`);
  assert.equal(plain.stderr, '');
  assert.ok(
    plain.stdout.split('\n').some((line) => line.includes(finding.kind) && line.includes(finding.where)),
    `one plain line holds the finding's kind and where, got:\n${plain.stdout}`,
  );
  assert.ok(flat(plain.stdout).includes(flat(finding.says)), `and the plain lines say what the JSON says, got:\n${plain.stdout}`);
}

// ---------------------------------------------------------------------------
// K1 — a session Orca resumed by itself is named, with its restart.
// ---------------------------------------------------------------------------

for (const harness of ['claude', 'codex']) {
  test(`K1 ${harness}: a session Orca resumed by itself is named with the restart that puts it on bot.yaml, and a sibling the kit started gets nothing`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await botUp(box, 'api-bot', { harness, sessions: ['daily', 'review'] });
    await conversationsFor(bots, 'api-bot', ['daily', 'review']);
    await environmentOf(box, bots, 'api-bot', 'daily', 'orca');

    const answer = await found(box);
    const plain = await health(box);

    const finding = assertNamedNotStartedByKit(answer, box, bots, 'api-bot', 'daily');
    assertPlainSays(plain, finding);

    // The contrast: the kit started review and Bot Father's daily, their
    // harnesses in front just the same, and nothing is said about either.
    assert.equal(entryOf(answer, 'api-bot', 'review')?.running, 'yes', 'the premise: review\'s harness is in front');
    assert.deepEqual(about(answer, 'api-bot', 'review'), [], 'the kit started review, so there is nothing to say about it');
    assert.deepEqual(about(answer, 'bot-father', 'daily'), [], 'nor about Bot Father\'s daily, which the kit started too');
    assert.equal(answer.found.length, 1, `daily's is the only finding in this fleet, got: ${JSON.stringify(answer.found, null, 2)}`);
  });
}

test('K1 two sessions Orca resumed are each named, each with its own restart', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: ['daily', 'review', 'nightly'] });
  await botUp(box, 'web-bot', { harness: 'codex' });
  await conversationsFor(bots, 'api-bot', ['daily', 'review', 'nightly']);
  await environmentOf(box, bots, 'api-bot', 'daily', 'orca');
  await environmentOf(box, bots, 'web-bot', 'daily', 'orca');

  const answer = await found(box);

  assertNamedNotStartedByKit(answer, box, bots, 'api-bot', 'daily');
  assertNamedNotStartedByKit(answer, box, bots, 'web-bot', 'daily');
  for (const session of ['review', 'nightly']) {
    assert.deepEqual(about(answer, 'api-bot', session), [], `the kit started ${session}`);
  }
});

// ---------------------------------------------------------------------------
// K2 — named even when every setting health can see matches.
// ---------------------------------------------------------------------------

test('K2 a Claude session Orca resumed is named even when every setting health can see matches bot.yaml', async (t) => {
  // The Claude side of 2026-09-25: the user's own defaults happened to be what
  // bot.yaml asks for, so nothing looked wrong, and the session was still not
  // on bot.yaml's word.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['daily', '--model', 'opus', '--effort', 'high']] });
  await talking(box, bots, 'api-bot', 'daily', 'claude', conv(1), [
    claudeSaid(onTheDay(9), 'auto'),
    claudeReply(onTheDay(9, 1), { model: 'claude-opus-5-5', effort: 'high' }),
  ]);
  await environmentOf(box, bots, 'api-bot', 'daily', 'orca');

  const answer = await found(box);

  const entry = entryOf(answer, 'api-bot', 'daily');
  for (const setting of ['model', 'effort', 'approval']) {
    assert.equal(entry?.settings?.[setting]?.state, 'match', `the premise: ${setting} matches bot.yaml, got: ${JSON.stringify(entry)}`);
  }
  assertNamedNotStartedByKit(answer, box, bots, 'api-bot', 'daily');
});

// ---------------------------------------------------------------------------
// K3 — one session, one finding: a mismatch is said in it, with that cause.
// ---------------------------------------------------------------------------

test('K3 a Codex session Orca resumed on the user\'s own defaults gets one finding with the mismatch and that cause; a sibling the kit started keeps today\'s', async (t) => {
  // The Codex side of 2026-09-25: bot.yaml asks for auto, and the restored
  // reviewers ran with no approval and full disk access. Health said so, and
  // offered "bot.yaml changed after it started" as the reason. The kit-started
  // sibling has the same record, so the two findings differ only in the cause.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { harness: 'codex', sessions: ['daily', 'review'] });
  const leaked = [codexTurn(onTheDay(9), { approval: 'never', reviewer: 'user', sandbox: 'danger-full-access' })];
  await talking(box, bots, 'api-bot', 'daily', 'codex', conv(1), leaked);
  await talking(box, bots, 'api-bot', 'review', 'codex', conv(2), leaked);
  await environmentOf(box, bots, 'api-bot', 'daily', 'orca');

  const answer = await found(box);

  for (const session of ['daily', 'review']) {
    const entry = entryOf(answer, 'api-bot', session);
    assert.equal(entry?.settings?.approval?.state, 'mismatch', `the premise: ${session} runs on another approval, got: ${JSON.stringify(entry)}`);
  }

  const { says } = assertNamedNotStartedByKit(answer, box, bots, 'api-bot', 'daily');
  assert.ok(hasWord(says, 'approval'), `the one finding says the approval differs, got: ${says}`);
  for (const word of ['auto', 'never', 'danger-full-access']) {
    assert.ok(hasWord(says, word), `and names the drift, ${word} among it, got: ${says}`);
  }
  assert.match(says, NOT_BY_THE_KIT, `and gives as the reason that the kit's launch line did not start it, got: ${says}`);
  assert.doesNotMatch(says, BOT_YAML_CHANGED, `and not a change to bot.yaml, got: ${says}`);

  const review = about(answer, 'api-bot', 'review');
  assert.equal(review.length, 1, `the kit started review, and its mismatch keeps its one finding, got: ${JSON.stringify(review, null, 2)}`);
  assert.ok(hasWord(review[0].says, 'approval'), `which names the approval, got: ${review[0].says}`);
  assertRestartIn(review[0].says, box, bots, 'api-bot', 'review');
  assert.doesNotMatch(review[0].says, NOT_BY_THE_KIT, `and does not say the kit did not start it, got: ${review[0].says}`);
});

test('K3 a Claude session Orca resumed whose effort drifted from high to xhigh gets one finding with the drift, its restart and that cause; a sibling the kit started keeps today\'s', async (t) => {
  // The other drift seen after the restore of 2026-09-25: bot.yaml asks for
  // high, and the harness Orca resumed ran on the user's own xhigh. Everything
  // else it asks for matches.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['daily', '--effort', 'high'], ['review', '--effort', 'high']] });
  const drifted = [
    claudeSaid(onTheDay(9), 'auto'),
    claudeReply(onTheDay(9, 1), { model: 'claude-opus-5-5', effort: 'xhigh' }),
  ];
  await talking(box, bots, 'api-bot', 'daily', 'claude', conv(1), drifted);
  await talking(box, bots, 'api-bot', 'review', 'claude', conv(2), drifted);
  await environmentOf(box, bots, 'api-bot', 'daily', 'orca');

  const answer = await found(box);

  for (const session of ['daily', 'review']) {
    const entry = entryOf(answer, 'api-bot', session);
    assert.deepEqual(
      entry?.settings?.effort,
      { state: 'mismatch', configured: 'high', observed: 'xhigh' },
      `the premise: ${session} asks for high and ran on xhigh, got: ${JSON.stringify(entry)}`,
    );
    assert.equal(entry.settings.approval.state, 'match', `the premise: ${session}'s approval matches, got: ${JSON.stringify(entry)}`);
  }

  const { says } = assertNamedNotStartedByKit(answer, box, bots, 'api-bot', 'daily');
  for (const word of ['effort', 'high', 'xhigh']) {
    assert.ok(hasWord(says, word), `the one finding names the drift, ${word} among it, got: ${says}`);
  }
  assert.match(says, NOT_BY_THE_KIT, `and gives as the reason that the kit's launch line did not start it, got: ${says}`);
  assert.doesNotMatch(says, BOT_YAML_CHANGED, `and not a change to bot.yaml, got: ${says}`);

  const review = about(answer, 'api-bot', 'review');
  assert.equal(review.length, 1, `the kit started review, and its drift keeps its one finding, got: ${JSON.stringify(review, null, 2)}`);
  assert.ok(hasWord(review[0].says, 'xhigh'), `which names what ran, got: ${review[0].says}`);
  assertRestartIn(review[0].says, box, bots, 'api-bot', 'review');
  assert.doesNotMatch(review[0].says, NOT_BY_THE_KIT, `and does not say the kit did not start it, got: ${review[0].says}`);
});

// ---------------------------------------------------------------------------
// K4 — an environment that cannot be read is "cannot tell": nothing new.
// ---------------------------------------------------------------------------

for (const [environment, label] of [
  ['ps-fails', 'cannot be read'],
  ['no-tab-id', 'carries no ORCA_TAB_ID'],
  ['other-tab', 'carries another tab\'s ORCA_TAB_ID'],
]) {
  test(`K4 a session whose harness's environment ${label} gets nothing new, beside a sibling Orca resumed, which is named`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await botUp(box, 'api-bot', { sessions: ['daily', 'review'] });
    await conversationsFor(bots, 'api-bot', ['daily', 'review']);
    await environmentOf(box, bots, 'api-bot', 'daily', environment);
    await environmentOf(box, bots, 'api-bot', 'review', 'orca');

    const answer = await found(box);

    assertNamedNotStartedByKit(answer, box, bots, 'api-bot', 'review');
    assert.equal(entryOf(answer, 'api-bot', 'daily')?.running, 'yes', 'the premise: daily\'s harness is in front');
    assert.deepEqual(about(answer, 'api-bot', 'daily'), [], `nothing says who started daily, so nothing is said about it, got: ${JSON.stringify(answer.found, null, 2)}`);
  });
}

// ---------------------------------------------------------------------------
// K5 — a session that is not running: yes gets nothing new.
// ---------------------------------------------------------------------------

for (const front of ['program', 'other-harness']) {
  test(`K5 a session with ${front} in front of its tab gets nothing new, whatever that program carries, beside a sibling Orca resumed, which is named`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await botUp(box, 'api-bot', { sessions: ['daily', 'review'] });
    await conversationsFor(bots, 'api-bot', ['daily', 'review']);
    await frontOf(box, bots, 'api-bot', 'daily', front);
    await environmentOf(box, bots, 'api-bot', 'daily', 'orca');
    await environmentOf(box, bots, 'api-bot', 'review', 'orca');

    const answer = await found(box);

    assertNamedNotStartedByKit(answer, box, bots, 'api-bot', 'review');
    assert.equal(entryOf(answer, 'api-bot', 'daily')?.running, 'unknown', 'the premise: what is in front of daily is not its harness');
    assert.deepEqual(about(answer, 'api-bot', 'daily'), [], `got: ${JSON.stringify(answer.found, null, 2)}`);
  });
}

test('K5 a paused session, a gone tab and a tab with its shell in front get nothing new, beside a sibling Orca resumed, which is named', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const sessions = ['daily', 'review', 'nightly', 'weekly'];
  await botUp(box, 'api-bot', { sessions });
  await conversationsFor(bots, 'api-bot', sessions);
  for (const session of sessions) await environmentOf(box, bots, 'api-bot', session, 'orca');
  await obk(box, 'pause', '--bots', 'bots', '--bot', 'api-bot', '--session', 'daily');
  const gone = (await sessionIn(bots, 'api-bot', 'review')).tab;
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.tabId !== gone) });
  await frontOf(box, bots, 'api-bot', 'nightly', 'shell');

  const answer = await found(box);

  assertNamedNotStartedByKit(answer, box, bots, 'api-bot', 'weekly');

  assert.deepEqual(about(answer, 'api-bot', 'daily'), [], 'a paused session is not reported at all');

  const review = about(answer, 'api-bot', 'review');
  assert.equal(review.length, 1, `the gone tab keeps its one finding, and gets no second, got: ${JSON.stringify(review, null, 2)}`);
  assert.ok(wordsOf(review[0]).includes(gone), `and that finding names the tab, got: ${JSON.stringify(review[0])}`);

  const nightly = about(answer, 'api-bot', 'nightly');
  assert.equal(nightly.length, 1, `the shell in front keeps its one finding, and gets no second, got: ${JSON.stringify(nightly, null, 2)}`);
  assert.match(nightly[0].says, NOT_RUNNING, `and that finding is the one that says it is not running, got: ${nightly[0].says}`);
});

// ---------------------------------------------------------------------------
// K6 — the restart it names puts the session back, and health only reads.
// ---------------------------------------------------------------------------

test('K6 after the restart the finding names, the kit\'s launch line runs the session and the finding is gone', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { harness: 'codex', sessions: ['daily'] });
  await conversationsFor(bots, 'api-bot', ['daily']);
  await environmentOf(box, bots, 'api-bot', 'daily', 'orca');

  assertNamedNotStartedByKit(await found(box), box, bots, 'api-bot', 'daily');

  await obk(box, 'restart', '--bots', 'bots', '--bot', 'api-bot', '--session', 'daily');
  const after = await found(box);

  assert.equal(entryOf(after, 'api-bot', 'daily')?.running, 'yes', `daily runs in its new tab, got: ${JSON.stringify(after.sessions, null, 2)}`);
  assert.deepEqual(after.found, [], `nothing is left to report, got: ${JSON.stringify(after.found, null, 2)}`);
});

test('K6 health reads a session Orca resumed and changes nothing: no file, no tab, and ps asked only to read', async (t) => {
  // ps is a reader for the kit and never a road to a kill (AGENTS.md,
  // 2026-09-20): every call is one of its two reads, of one positive pid.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: ['daily', 'review'] });
  await conversationsFor(bots, 'api-bot', ['daily', 'review']);
  await environmentOf(box, bots, 'api-bot', 'daily', 'orca');

  const before = await snapshot(box.root, skipOrcaFake);
  const setups = await box.orca.setups();
  const terminals = await box.orca.terminals();
  const asked = (await box.orca.calls()).length;
  const read = (await box.ps.calls()).length;

  const answer = await found(box);

  assertNamedNotStartedByKit(answer, box, bots, 'api-bot', 'daily');
  assert.deepEqual(await snapshot(box.root, skipOrcaFake), before, 'every file and every link is as it was');
  assert.deepEqual(await box.orca.setups(), setups, 'no Orca project made, changed or taken away');
  assert.deepEqual(await box.orca.terminals(), terminals, 'no tab opened, closed, retitled or typed into: health does not restart it');
  assert.deepEqual(
    [...new Set((await box.orca.calls()).slice(asked).map(orcaCommand))].sort(),
    ['diagnostics memory', 'project setups', 'status', 'terminal list', 'terminal show'],
    'the only things health asks Orca are the ones that tell it something',
  );
  for (const { args } of (await box.ps.calls()).slice(read)) {
    const shape = [PS_READ, PS_ENVIRONMENT].find((one) => one.every((word, at) => args[at] === word));
    assert.ok(shape !== undefined && args.length === shape.length + 1, `ps ${args.join(' ')}: one of the two reads the kit may make`);
    assert.match(args.at(-1), /^[1-9]\d*$/, `ps ${args.join(' ')}: of one positive pid`);
  }
});
