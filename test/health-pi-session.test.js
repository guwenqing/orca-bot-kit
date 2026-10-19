// `obk health` and a Pi session's tab (#660: the baseline, H5 and H6).
//
// A live probe on 2026-10-19 showed what health already does right for a Pi
// session. These tests pin it, so the Pi work of #660 does not undo it:
//
//   - a tab Orca no longer has gives the finding that names the tab id;
//   - a tab with only the shell in front gives the "not running" finding,
//     with the kit's own restart for that session;
//   - a healthy idle Pi gives no finding, and a bot with only Pi sessions gets
//     no hook finding and no permission-rule finding (the kit has neither in
//     Pi).
//
// H5. The `mail` finding (a running session with unread mail that Orca has not
//     told it of, older than an hour, its harness idle; see
//     test/health-mail-unannounced.test.js) comes for a Pi session as for the
//     others, when its Pi tab is idle: Orca's agent `pi`, `pi` in front. A
//     busy Pi tab gets none.
//
// H6. `ps -E` of a real Pi process shows only `pi`, with no environment, so
//     health cannot tell a Pi the kit started from one Orca restored. A
//     running Pi session whose process words are only `pi` gets no "was not
//     started by the kit" finding.
//
// The baseline and H6 are descriptions of what the kit does today (they pass
// on the code before #660), kept as guards. Every run is in the sandbox
// (helpers/cli.js), against the fake Orca and the fake `ps` (helpers/fake-ps.js
// gives a Pi tab command `pi`), with a fake `pi` on PATH (helpers/pi.js).
// Nothing here reaches the real `pi`, the real ~/.pi or the real Orca.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSandbox, sessionIn, shellWord, spellingsOf } from './helpers/cli.js';
import { fakePi } from './helpers/pi.js';

const KINDS = ['orca', 'config', 'skill', 'session', 'leftover', 'process', 'mail'];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// ---------------------------------------------------------------- the fleet

/** Run one more `obk` command that has to work for the test to mean anything. */
async function obk(box, ...args) {
  const result = await box.run([...args]);
  assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return result;
}

/** A bots folder with Bot Father up in Orca, and the fake `pi` on PATH. */
async function seeded(box) {
  await fakePi(box);
  await obk(box, 'init', '--bots', 'bots', '--harness', 'claude');
  return box.path('bots');
}

/** One more bot on `harness`, with the sessions named, brought up in Orca. */
async function botUp(box, name, { harness = 'pi', sessions = ['daily'] } = {}) {
  await obk(box, 'bot', 'create', '--bots', 'bots', '--name', name, '--harness', harness);
  for (const session of sessions) await obk(box, 'session', 'add', '--bots', 'bots', '--bot', name, '--name', session);
  await obk(box, 'up', '--bots', 'bots', '--bot', name);
}

/** Change one session's tab in the fake Orca's world. */
async function changeTab(box, bots, bot, session, change) {
  const { tab } = await sessionIn(bots, bot, session);
  const terminals = await box.orca.terminals();
  assert.ok(terminals.some((one) => one.tabId === tab), `the premise: Orca has ${bot} ${session}'s tab ${tab}`);
  await box.orca.set({ terminals: terminals.map((one) => (one.tabId === tab ? { ...one, ...change } : one)) });
}

/** The mailbox the book names for one session. */
async function mailboxOf(bots, bot, session) {
  const { mailbox } = (await sessionIn(bots, bot, session)) ?? {};
  assert.ok(typeof mailbox === 'string' && /^run_/.test(mailbox), `the premise: the book names a mailbox for ${bot} ${session}, got: ${mailbox}`);
  return mailbox;
}

// ------------------------------------------------------------- the letters

let sequence = 0;

/** A time as Orca writes it: whole seconds, then Z. */
const stamp = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** One letter in a Run's mailbox, as `orchestration inbox` answers it (the shape test/health-mail-unannounced.test.js uses). */
function letter(run, { age }) {
  sequence += 1;
  const at = Date.now() - age;
  return {
    body: 'zq-body-pi-0660',
    created_at: stamp(at),
    delivered_at: null,
    delivery_contract: null,
    from_handle: 'term_sender',
    id: `msg_pi_${sequence}`,
    payload: null,
    pointer_enter_pending: 0,
    pointer_process_incarnation: null,
    pointer_pty_id: null,
    priority: 'normal',
    read: 0,
    run_id: run,
    sender_pane_key: null,
    sequence,
    subject: 'zq-subject-pi-0660',
    thread_id: null,
    to_handle: `run:${run}`,
    type: 'status',
  };
}

/** Put letters into a Run's mailbox, beside any it holds. */
async function mailTo(box, run, ...letters) {
  const inbox = (await box.orca.state()).inbox ?? {};
  await box.orca.set({ inbox: { ...inbox, [run]: [...(inbox[run] ?? []), ...letters] } });
}

// ------------------------------------------------------------- what it answers

/** Run the health check for JSON, and hold it to the shape every finding has and to the exit code. */
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
    assert.ok(typeof finding.where === 'string' && finding.where.trim() !== '', `a finding says what it is about, got: ${JSON.stringify(finding)}`);
    assert.ok(typeof finding.says === 'string' && finding.says.trim() !== '', `a finding says something, got: ${JSON.stringify(finding)}`);
  }
  assert.ok(Array.isArray(answer.sessions), `the answer should carry a list of sessions, got: ${result.stdout}`);
  assert.equal(result.code, answer.found.length === 0 ? 0 : 1, `${answer.found.length} findings, exit ${result.code}`);
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

/** Words that call a session not running, as test/health-shell-in-front.test.js reads them. */
const NOT_RUNNING = /\b(?:not|isn't|is no longer|no longer)\s+running\b|\bdown\b/i;

/** Words that say the kit did not start a session, as test/health-not-started-by-kit.test.js reads them, and more loosely. */
const NOT_BY_THE_KIT = /launch line|not (?:been )?(?:started|launched) by (?:the kit|obk)|(?:the kit|obk) (?:did not|didn't) (?:start|launch)|Orca (?:brought|resumed|restored|relaunched|started)/i;

/** Whether `says` carries the kit's own CLI running `restart` for one session, with the bots folder. */
function givesRestart(says, box, bots, bot, session) {
  return spellingsOf(box.cli).some((cli) => says.includes(`${cli} restart `))
    && spellingsOf(bots).some((word) => says.includes(`--bots ${word}`))
    && says.includes(`--bot ${bot}`)
    && hasWord(says, `--session ${session}`);
}

// ---------------------------------------------------------------------------
// The baseline: what health already does right for a Pi session.
// ---------------------------------------------------------------------------

test('baseline: a healthy idle Pi bot, never past its first turn, gets no finding at all: no hook, no permission rule; its entry says pi, running', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  await botUp(box, 'pier', { sessions: ['daily', 'review'] });

  const answer = await found(box);

  assert.deepEqual(answer.found, [], `a fleet the kit made and opened itself has nothing wrong with it, got: ${JSON.stringify(answer.found, null, 2)}`);
  for (const session of ['daily', 'review']) {
    const entry = entryOf(answer, 'pier', session);
    assert.equal(entry?.harness, 'pi', `the entry names the harness, got: ${JSON.stringify(entry)}`);
    assert.equal(entry?.running, 'yes', `pi is in front of its tab, got: ${JSON.stringify(entry)}`);
  }
});

test('baseline: a Pi session whose tab Orca no longer has gets the finding that names the tab, and no entry; its sibling is running', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'pier', { sessions: ['daily', 'review'] });
  const gone = (await sessionIn(bots, 'pier', 'review')).tab;
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.tabId !== gone) });

  const answer = await found(box);

  const mine = about(answer, 'pier', 'review');
  assert.equal(mine.length, 1, `one finding about review, whose tab is gone, got: ${JSON.stringify(answer.found, null, 2)}`);
  assert.equal(mine[0].kind, 'session', `it is about a session, got: ${JSON.stringify(mine[0])}`);
  assert.ok(wordsOf(mine[0]).includes(gone), `it names the tab id the book holds, ${gone}, got: ${JSON.stringify(mine[0])}`);
  assert.equal(entryOf(answer, 'pier', 'review'), undefined, 'a session whose tab is gone gets no entry');
  assert.equal(entryOf(answer, 'pier', 'daily')?.running, 'yes', 'daily still runs');
  assert.deepEqual(about(answer, 'pier', 'daily'), [], 'and nothing is said about it');
});

test('baseline: a Pi session whose tab has only its shell in front is called not running, with the kit\'s own restart for it; its sibling is not', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'pier', { sessions: ['daily', 'review'] });
  await changeTab(box, bots, 'pier', 'review', { foreground: 'shell' });

  const answer = await found(box);

  const mine = about(answer, 'pier', 'review');
  assert.equal(mine.length, 1, `one finding about review, whose Pi quit, got: ${JSON.stringify(answer.found, null, 2)}`);
  assert.match(mine[0].says, NOT_RUNNING, `it says the session is not running, got: ${mine[0].says}`);
  assert.ok(givesRestart(mine[0].says, box, bots, 'pier', 'review'), `it gives ${shellWord(box.cli)} restart --bots ${shellWord(bots)} --bot pier --session review, got: ${mine[0].says}`);
  assert.notEqual(entryOf(answer, 'pier', 'review')?.running, 'yes', 'a session with its shell in front is not said to be running');
  assert.deepEqual(about(answer, 'pier', 'daily'), [], 'daily\'s Pi is in front, so nothing is said about it');
});

// ---------------------------------------------------------------------------
// H5 — mail that waits for an idle Pi session.
// ---------------------------------------------------------------------------

test('H5 an idle Pi session with letters Orca has not told it of, older than an hour, gets the mail finding with its restart; a busy Pi sibling with the same letters does not', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'pier', { sessions: ['daily', 'review'] });
  const daily = await mailboxOf(bots, 'pier', 'daily');
  const review = await mailboxOf(bots, 'pier', 'review');
  await mailTo(box, daily, letter(daily, { age: 2 * HOUR }), letter(daily, { age: 3 * HOUR }));
  await mailTo(box, review, letter(review, { age: 2 * HOUR }), letter(review, { age: 3 * HOUR }));
  // review's Pi is at work: Orca's tui-idle wait times out.
  await changeTab(box, bots, 'pier', 'review', { tuiIdle: 'busy' });

  const answer = await found(box);

  const mail = answer.found.filter((one) => one.kind === 'mail');
  const mine = mail.filter((one) => one.where === daily);
  assert.equal(mine.length, 1, `one mail finding, where ${daily}, about daily's waiting letters, got: ${JSON.stringify(answer.found, null, 2)}`);
  const [finding] = mine;
  assert.equal(finding.bot, 'pier', `about pier, got: ${JSON.stringify(finding)}`);
  assert.ok(hasWord(finding.says, 'daily'), `it names the session, got: ${finding.says}`);
  assert.ok(hasWord(finding.says, '2'), `it says 2 letters wait, got: ${finding.says}`);
  assert.ok(givesRestart(finding.says, box, bots, 'pier', 'daily'), `the fix is the kit's own restart of daily, got: ${finding.says}`);
  assert.match(finding.says, /idle/i, `it says the session's harness is idle now, got: ${finding.says}`);
  assert.deepEqual(
    mail.filter((one) => one.where === review || hasWord(wordsOf(one), review)),
    [],
    `review's Pi is busy, and Orca waits for idle to give its notice, got: ${JSON.stringify(answer.found, null, 2)}`,
  );
});

// ---------------------------------------------------------------------------
// H6 — a Pi process shows only `pi`.
// ---------------------------------------------------------------------------

test('H6 a running Pi session whose process shows only the word pi gets no "not started by the kit" finding; a Claude session Orca resumed by itself beside it does', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'pier');
  await botUp(box, 'api-bot', { harness: 'claude' });
  // `no-tab-id` is `ps -E` giving the command alone and no variables: for a
  // Pi tab, the word `pi` and nothing else (helpers/fake-ps.js), as a real
  // Pi process shows (tech notes, section 6).
  await changeTab(box, bots, 'pier', 'daily', { environment: 'no-tab-id' });
  // The contrast: a Claude session Orca resumed by itself, which health can tell.
  await changeTab(box, bots, 'api-bot', 'daily', { environment: 'orca' });

  const answer = await found(box);

  assert.equal(entryOf(answer, 'pier', 'daily')?.running, 'yes', 'the premise: pi is in front of pier\'s tab');
  assert.deepEqual(about(answer, 'pier', 'daily'), [], `health cannot tell who started a Pi process, so it says nothing, got: ${JSON.stringify(answer.found, null, 2)}`);
  assert.deepEqual(answer.found.filter((one) => one.bot === 'pier' && NOT_BY_THE_KIT.test(one.says)), [], 'no finding about pier says the kit did not start it');
  const claude = about(answer, 'api-bot', 'daily');
  assert.equal(claude.length, 1, `the Claude session Orca resumed is named, got: ${JSON.stringify(answer.found, null, 2)}`);
  assert.ok(givesRestart(claude[0].says, box, bots, 'api-bot', 'daily'), `with its restart, got: ${claude[0].says}`);
});
