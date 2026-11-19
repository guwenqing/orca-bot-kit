// `obk health` names a session with no open tab whose mailbox holds unread
// letters (#841, R1).
//
// From Orca 1.4.262, Orca deletes the mailbox (a Run) of a session whose tab is
// not open, with every letter in it, a day after its last write (#820). R1, as
// the owner signed it:
//
//   `obk health` MUST name each session with no open tab whose mailbox holds
//   unread letters. It MUST say how many letters wait (at least that many) and
//   the earliest time Orca may delete them: 24 hours after the newest letter.
//   It MUST NOT read a subject or a body.
//
//   The kit MAY give these words on every Orca version, and name Orca 1.4.262
//   in them, so that it does not have to read the version of Orca.
//
// What is pinned:
//
//   - "No open tab": the book names a mailbox for the session, and Orca's tab
//     listing does not list the tab the book names for it: a paused session
//     (pause closes its tab), a session of a paused bot, and a session whose
//     tab is gone. A paused session whose tab Orca still lists has an open tab
//     (test/health-mail-unannounced.test.js, pin 5, holds that).
//   - For each such session whose Run Orca still has, and whose mailbox holds
//     at least one unread letter (`read: 0`) among the newest 100: one finding,
//     kind `mail`, `bot` the bot, `where` the Run id as the book writes it, and
//     `says` naming the session, that it has no open tab, "at least <n> unread
//     letter(s)" (n the unread letters among the newest 100), Orca 1.4.262,
//     that Orca can delete the mailbox from the newest letter's `created_at`
//     plus exactly 24 hours, as `toISOString` writes it, unless the session
//     starts first, and the start command.
//   - The newest letter is the newest of all the letters read, read or unread.
//   - The start command, `<cli>` the kit's own CLI and `<bots>` the bots
//     folder: `<cli> up --bots <bots> --bot <bot> --session <session>`, or
//     `<cli> unpause --bots <bots> --bot <bot> --session <session>` for a
//     paused session, `<cli> unpause --bots <bots> --bot <bot>` for a session
//     of a paused bot, and both, the bot's first, joined by ", then ".
//   - Nothing of this kind when every letter is read, when the mailbox is
//     empty, when the tab is open, or when Orca has no such Run (then only the
//     missing-Run finding of test/health-mailbox-gone.test.js).
//   - Health only reads: no mail taken, no Run made or bound, nothing sent or
//     typed, no tab made, no file changed.
//   - No subject and no body shows in either report, and the plain report says
//     what the JSON says.
//
// Each case that says "nothing" has a session beside it that is named. The
// letters' times are fixed literals, so the time 24 hours on is a worked
// example and not a sum the test shares with the code. Each mailbox's letters
// are newest last both by `sequence` and by `created_at`, so "the newest" is
// the same letter either way. The wording is the kit's; the facts are pinned
// loosely, with the kit's CLI and the bots folder in either spelling a shell
// reads as one word (helpers/cli.js, spellingsOf). Everything runs through the
// CLI on a sandboxed bots folder against the fake Orca, whose `inbox` holds
// what `orchestration inbox --terminal run:<id>` answers for a Run.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import {
  assertOrcaCallsAllowed,
  bookIn,
  bookOf,
  createSandbox,
  orcaCallsOf,
  orcaCommand,
  orcaFlag,
  sessionIn,
  skipOrcaFake,
  snapshot,
  spellingsOf,
} from './helpers/cli.js';
import { modelOrca, ORCA_MODELS } from './helpers/orca-versions.js';
import { orcaDeletesRun } from './helpers/run-deleted.js';

/** The kinds a finding can be. */
const KINDS = ['orca', 'config', 'skill', 'session', 'leftover', 'mail'];

const MINUTE = 60_000;

// ---------------------------------------------------------------- the fleet

/** A bots folder with Bot Father up in Orca. */
async function seeded(box) {
  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(result.code, 0, result.stderr);
  return box.path('bots');
}

/** Run one more `obk` command that has to work for the test to mean anything. */
async function obk(box, args) {
  const result = await box.run(args);
  assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stderr}${result.stdout}`);
  return result;
}

/** One more bot on `harness`, with these sessions, brought up in Orca by the kit. */
async function botUp(box, name, { harness = 'claude', sessions = ['daily'] } = {}) {
  await obk(box, ['bot', 'create', '--bots', 'bots', '--name', name, '--harness', harness]);
  for (const session of sessions) await obk(box, ['session', 'add', '--bots', 'bots', '--bot', name, '--name', session]);
  await obk(box, ['up', '--bots', 'bots', '--bot', name]);
}

/** A conversation id, shaped the way both harnesses shape one. */
const conv = (n) => `0199b2c0-${String(n).padStart(4, '0')}-4444-8888-cccccccccccc`;

/** Give every session of a bot a conversation in the book, so that a pause will take it. */
async function conversationsFor(bots, bot) {
  const file = bookOf(bots, bot);
  const book = parse(await readFile(file, 'utf8'));
  for (const [n, name] of Object.keys(book.sessions).entries()) book.sessions[name].session = conv(70 + n);
  await writeFile(file, stringify(book));
}

/** The mailbox the book names for one session. */
async function mailboxOf(bots, bot, session) {
  const { mailbox } = (await sessionIn(bots, bot, session)) ?? {};
  assert.ok(typeof mailbox === 'string' && /^run_/.test(mailbox), `the premise: the book names a mailbox for ${bot} ${session}, got: ${mailbox}`);
  return mailbox;
}

/** The Orca tab the book names for one session, as the fake Orca lists it, or undefined. */
async function listedTab(box, bots, bot, session) {
  const { tab } = (await sessionIn(bots, bot, session)) ?? {};
  return (await box.orca.terminals()).find((one) => one.tabId === tab);
}

/** Take sessions' tabs out of Orca's listing: their tabs are gone. The book still names them. */
async function tabsGone(box, bots, bot, ...sessions) {
  const handles = [];
  for (const session of sessions) {
    const terminal = await listedTab(box, bots, bot, session);
    assert.ok(terminal !== undefined, `the premise: Orca lists ${bot} ${session}'s tab before it goes`);
    handles.push(terminal.handle);
  }
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => !handles.includes(one.handle)) });
}

/** Each way the kit may spell `<cli> <verb> --bots <bots> --bot <bot>`. */
const commandsOf = (box, bots, verb, bot) => spellingsOf(box.cli)
  .flatMap((cli) => spellingsOf(bots).map((folder) => `${cli} ${verb} --bots ${folder} --bot ${bot}`));

/** The start command of a session that is not paused, its bot not paused. */
const upOf = (box, bots, bot, session) => commandsOf(box, bots, 'up', bot).map((one) => `${one} --session ${session}`);

/** The start command of a paused session. */
const unpauseOf = (box, bots, bot, session) => commandsOf(box, bots, 'unpause', bot).map((one) => `${one} --session ${session}`);

/** The start command of a session of a paused bot. */
const botUnpauseOf = (box, bots, bot) => commandsOf(box, bots, 'unpause', bot);

/** The start command of a paused session of a paused bot: both, the bot's first. */
const bothUnpausesOf = (box, bots, bot, session) => spellingsOf(box.cli).flatMap((cli) => spellingsOf(bots).map((folder) => {
  const unpause = `${cli} unpause --bots ${folder} --bot ${bot}`;
  return `${unpause}, then ${unpause} --session ${session}`;
}));

// ------------------------------------------------------------- the letters

let sequence = 0;

/** The subject and body of every letter, unless a test gives its own. */
const SUBJECT = 'zq-subject-bilberry-6620';
const BODY = 'zq-body-cloudberry-1957';

/**
 * One letter in a Run's mailbox, as `orchestration inbox` answers it, every
 * column Orca 1.4.225 gave (seen live, 2026-10-17), as in
 * test/health-mail-unannounced.test.js. `at` is its `created_at`, a time as
 * Orca writes it: whole seconds, then Z.
 */
function letter(run, { at, read = 0, subject = SUBJECT, body = BODY }) {
  sequence += 1;
  return {
    body,
    created_at: at,
    delivered_at: null,
    delivery_contract: null,
    from_handle: 'term_sender',
    id: `msg_tab_${sequence}`,
    payload: null,
    pointer_enter_pending: 0,
    pointer_process_incarnation: null,
    pointer_pty_id: null,
    priority: 'normal',
    read,
    run_id: run,
    sender_pane_key: null,
    sequence,
    subject,
    thread_id: null,
    to_handle: `run:${run}`,
    type: 'status',
  };
}

/** Put letters into a Run's mailbox, beside any it holds. Give them oldest first. */
async function mailTo(box, run, ...letters) {
  const inbox = (await box.orca.state()).inbox ?? {};
  await box.orca.set({ inbox: { ...inbox, [run]: [...(inbox[run] ?? []), ...letters] } });
  return letters;
}

/** A letter written as Orca writes a time, `n` minutes after `from`, an ISO time. */
const minutesAfter = (from, n) => new Date(Date.parse(from) + n * MINUTE).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** A letter newer than an hour, unread: one the #630 finding does not take for a session with an open tab. */
const fresh = (run) => letter(run, { at: minutesAfter(new Date().toISOString(), -10) });

// ------------------------------------------------------------- the answer

/** Run the health check. */
const health = (box, ...rest) => box.run(['health', '--bots', 'bots', ...rest]);

/**
 * Run the health check for JSON, and hold it to the shape every finding has and
 * to the exit code: 0 when it found nothing, 1 when it found something.
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

/** Every run of whitespace as one space, so an indented or re-wrapped sentence still reads the same. */
const flat = (text) => text.replace(/\s+/g, ' ').trim();

/** That the session has no open tab. */
const NO_OPEN_TAB_WORDS = /\bno open tab\b|\btab is not open\b|\bno tab (is )?open\b|\bnot have an open tab\b|\bhas no tab\b/i;

/** Whether `text` gives one of `starts` as a command of its own: nothing of a word or a `--session` runs on after it. */
const givesStart = (text, starts) => starts.some((command) => {
  for (let at = text.indexOf(command); at >= 0; at = text.indexOf(command, at + 1)) {
    const rest = text.slice(at + command.length);
    if (!/^[A-Za-z0-9_-]/.test(rest) && !/^\s*--session\b/.test(rest)) return true;
  }
  return false;
});

/**
 * The one finding about `run`, a session with no open tab whose mail is unread,
 * and every fact R1 asks of it: kind `mail`, the bot, the Run as `where`, the
 * session named, no open tab, "at least <count> unread letter(s)", Orca
 * 1.4.262, that Orca can delete the mailbox from `deletes` (the newest
 * letter's created_at and 24 hours, as toISOString writes it) unless the
 * session starts first, and one of `starts`.
 */
function assertNamedNoOpenTab(answer, { bot, session, run, count, deletes, starts }) {
  const mine = answer.found.filter((one) => one.kind === 'mail' && one.where === run);
  assert.equal(mine.length, 1, `one finding of kind mail, where ${run}, about ${bot} ${session}'s unread mail with no open tab, got: ${JSON.stringify(answer.found, null, 2)}`);
  const [finding] = mine;
  const { says } = finding;
  assert.equal(finding.bot, bot, `about ${bot}, got: ${JSON.stringify(finding)}`);
  assert.ok(hasWord(says, session), `it names the session ${session}, got: ${says}`);
  assert.match(says, NO_OPEN_TAB_WORDS, `it says the session has no open tab, got: ${says}`);
  assert.match(says, new RegExp(`\\bat least ${count} unread letters?\\b`, 'i'), `it says at least ${count} unread letter(s), got: ${says}`);
  assert.match(says, /\bOrca 1\.4\.262\b/, `it names Orca 1.4.262, got: ${says}`);
  assert.ok(/\bdelet/i.test(says) && /\bmailbox\b/i.test(says), `it says Orca can delete the mailbox, got: ${says}`);
  assert.ok(says.includes(deletes), `from ${deletes}, the newest letter's created_at and 24 hours, got: ${says}`);
  assert.match(says, /\bunless\b.{0,80}\bstart/i, `unless the session starts first, got: ${says}`);
  assert.ok(givesStart(says, starts), `and the command that starts it, one of:\n${starts.join('\n')}\ngot: ${says}`);
  return finding;
}

/** No finding about `run` that is the no-open-tab one: none of kind mail about it, nor one naming 1.4.262 about it. */
function assertNoNoOpenTabFor(answer, run, why) {
  const about = answer.found.filter((one) => (one.kind === 'mail' && (one.where === run || hasWord(wordsOf(one), run)))
    || (hasWord(wordsOf(one), run) && NO_OPEN_TAB_WORDS.test(one.says) && /1\.4\.262/.test(one.says) && /\bunread\b/i.test(one.says)));
  assert.deepEqual(about, [], `${why}: no finding about ${run}'s unread mail, got: ${JSON.stringify(answer.found, null, 2)}`);
}

// ---------------------------------------------------------------------------
// The finding, for each way a tab is not open
// ---------------------------------------------------------------------------

test('#841 R1 "obk health MUST name each session with no open tab whose mailbox holds unread letters": a session whose tab is gone, with how many and the time 24 hours after the newest letter', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: ['daily', 'review'] });
  await tabsGone(box, bots, 'api-bot', 'daily');
  const daily = await mailboxOf(bots, 'api-bot', 'daily');
  const review = await mailboxOf(bots, 'api-bot', 'review');
  // Three unread and one read, the newest of them unread.
  await mailTo(
    box,
    daily,
    letter(daily, { at: '2026-11-18T08:15:00Z', read: 1 }),
    letter(daily, { at: '2026-11-18T09:30:00Z' }),
    letter(daily, { at: '2026-11-19T14:02:00Z' }),
    letter(daily, { at: '2026-11-19T21:48:00Z' }),
  );
  // Review's tab is open: a fresh unread letter there is not the no-open-tab case.
  await mailTo(box, review, fresh(review));

  const answer = await found(box);

  const finding = assertNamedNoOpenTab(answer, {
    bot: 'api-bot', session: 'daily', run: daily, count: 3, deletes: '2026-11-20T21:48:00.000Z', starts: upOf(box, bots, 'api-bot', 'daily'),
  });
  assert.doesNotMatch(finding.says, /\bat least 4\b/, `the read letter is not counted, got: ${finding.says}`);
  for (const older of ['2026-11-19T08:15:00.000Z', '2026-11-19T09:30:00.000Z', '2026-11-20T14:02:00.000Z']) {
    assert.ok(!finding.says.includes(older), `the time is from the newest letter, not ${older}, got: ${finding.says}`);
  }
  assertNoNoOpenTabFor(answer, review, 'review\'s tab is open');
});

test('#841 R1 "the earliest time Orca may delete them: 24 hours after the newest letter": the newest letter is read and an older one unread, and the time is from the newest', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot');
  await tabsGone(box, bots, 'api-bot', 'daily');
  const daily = await mailboxOf(bots, 'api-bot', 'daily');
  await mailTo(
    box,
    daily,
    letter(daily, { at: '2026-11-17T06:40:00Z' }),
    letter(daily, { at: '2026-11-18T23:05:30Z', read: 1 }),
  );

  const answer = await found(box);

  const finding = assertNamedNoOpenTab(answer, {
    bot: 'api-bot', session: 'daily', run: daily, count: 1, deletes: '2026-11-19T23:05:30.000Z', starts: upOf(box, bots, 'api-bot', 'daily'),
  });
  assert.ok(!finding.says.includes('2026-11-18T06:40:00.000Z'), `not 24 hours after the unread letter, got: ${finding.says}`);
});

test('#841 R1 "obk health MUST name each session with no open tab": a paused session is named with its unpause, beside an open-tab sibling that is not', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: ['daily', 'review'] });
  await conversationsFor(bots, 'api-bot');
  await obk(box, ['pause', '--bots', 'bots', '--bot', 'api-bot', '--session', 'daily']);
  assert.equal(await listedTab(box, bots, 'api-bot', 'daily'), undefined, 'the premise: the pause closed daily\'s tab');
  const daily = await mailboxOf(bots, 'api-bot', 'daily');
  const review = await mailboxOf(bots, 'api-bot', 'review');
  await mailTo(box, daily, letter(daily, { at: '2026-11-19T03:00:00Z' }), letter(daily, { at: '2026-11-19T04:30:00Z' }));
  await mailTo(box, review, fresh(review));

  const answer = await found(box);

  assertNamedNoOpenTab(answer, {
    bot: 'api-bot', session: 'daily', run: daily, count: 2, deletes: '2026-11-20T04:30:00.000Z', starts: unpauseOf(box, bots, 'api-bot', 'daily'),
  });
  assertNoNoOpenTabFor(answer, review, 'review\'s tab is open');
});

test('#841 R1 "obk health MUST name each session with no open tab": a session of a paused bot is named with the bot\'s unpause, with no --session', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot');
  await conversationsFor(bots, 'api-bot');
  await obk(box, ['pause', '--bots', 'bots', '--bot', 'api-bot']);
  assert.equal(await listedTab(box, bots, 'api-bot', 'daily'), undefined, 'the premise: the pause closed daily\'s tab');
  const daily = await mailboxOf(bots, 'api-bot', 'daily');
  const botFather = await mailboxOf(bots, 'bot-father', 'daily');
  await mailTo(box, daily, letter(daily, { at: '2026-11-19T12:00:00Z' }));
  await mailTo(box, botFather, fresh(botFather));

  const answer = await found(box);

  assertNamedNoOpenTab(answer, {
    bot: 'api-bot', session: 'daily', run: daily, count: 1, deletes: '2026-11-20T12:00:00.000Z', starts: botUnpauseOf(box, bots, 'api-bot'),
  });
  assertNoNoOpenTabFor(answer, botFather, 'Bot Father\'s tab is open');
});

test('#841 R1 "obk health MUST name each session with no open tab": a paused session of a paused bot is named with the bot\'s unpause, then the session\'s', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: ['daily', 'review'] });
  await conversationsFor(bots, 'api-bot');
  await obk(box, ['pause', '--bots', 'bots', '--bot', 'api-bot', '--session', 'daily']);
  await obk(box, ['pause', '--bots', 'bots', '--bot', 'api-bot']);
  const daily = await mailboxOf(bots, 'api-bot', 'daily');
  await mailTo(box, daily, letter(daily, { at: '2026-11-19T00:00:00Z' }));

  const answer = await found(box);

  assertNamedNoOpenTab(answer, {
    bot: 'api-bot', session: 'daily', run: daily, count: 1, deletes: '2026-11-20T00:00:00.000Z', starts: bothUnpausesOf(box, bots, 'api-bot', 'daily'),
  });
});

test('#841 R1 "obk health MUST name each session with no open tab": a Codex session whose tab is gone is named too', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'coder', { harness: 'codex' });
  await tabsGone(box, bots, 'coder', 'daily');
  const daily = await mailboxOf(bots, 'coder', 'daily');
  await mailTo(box, daily, letter(daily, { at: '2026-11-19T17:45:00Z' }));

  const answer = await found(box);

  assertNamedNoOpenTab(answer, {
    bot: 'coder', session: 'daily', run: daily, count: 1, deletes: '2026-11-20T17:45:00.000Z', starts: upOf(box, bots, 'coder', 'daily'),
  });
});

// ---------------------------------------------------------------------------
// The count: at least, among the newest 100
// ---------------------------------------------------------------------------

test('#841 R1 "it MUST say how many letters wait (at least that many)": 150 unread letters are named as at least 100, with the time from the newest', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot');
  await tabsGone(box, bots, 'api-bot', 'daily');
  const daily = await mailboxOf(bots, 'api-bot', 'daily');
  // One a minute, oldest first, the newest at 2026-11-19T10:00:00Z.
  await mailTo(box, daily, ...Array.from({ length: 150 }, (_, n) => letter(daily, { at: minutesAfter('2026-11-19T10:00:00Z', n - 149) })));

  const answer = await found(box);

  const finding = assertNamedNoOpenTab(answer, {
    bot: 'api-bot', session: 'daily', run: daily, count: 100, deletes: '2026-11-20T10:00:00.000Z', starts: upOf(box, bots, 'api-bot', 'daily'),
  });
  assert.ok(!hasWord(finding.says, '150'), `not 150: the read holds the newest 100, got: ${finding.says}`);
});

// ---------------------------------------------------------------------------
// Nothing of this kind
// ---------------------------------------------------------------------------

test('#841 R1 "whose mailbox holds unread letters": a session with no open tab whose letters are all read is not named, nor one whose mailbox is empty; a sibling with an unread one is', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: ['daily', 'review', 'night'] });
  await tabsGone(box, bots, 'api-bot', 'daily', 'review', 'night');
  const daily = await mailboxOf(bots, 'api-bot', 'daily');
  const review = await mailboxOf(bots, 'api-bot', 'review');
  const night = await mailboxOf(bots, 'api-bot', 'night');
  await mailTo(box, daily, letter(daily, { at: '2026-11-19T05:00:00Z', read: 1 }), letter(daily, { at: '2026-11-19T06:00:00Z', read: 1 }));
  await mailTo(box, review, letter(review, { at: '2026-11-19T07:00:00Z' }));

  const answer = await found(box);

  assertNamedNoOpenTab(answer, {
    bot: 'api-bot', session: 'review', run: review, count: 1, deletes: '2026-11-20T07:00:00.000Z', starts: upOf(box, bots, 'api-bot', 'review'),
  });
  assertNoNoOpenTabFor(answer, daily, 'every letter of daily\'s is read');
  assertNoNoOpenTabFor(answer, night, 'night\'s mailbox is empty');
});

test('#841 R1 "each session with no open tab": a session whose tab Orca lists, with unread letters, gets no no-open-tab finding; its sibling with no tab is named', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: ['daily', 'review'] });
  await tabsGone(box, bots, 'api-bot', 'review');
  const daily = await mailboxOf(bots, 'api-bot', 'daily');
  const review = await mailboxOf(bots, 'api-bot', 'review');
  await mailTo(box, daily, fresh(daily), fresh(daily));
  await mailTo(box, review, letter(review, { at: '2026-11-19T19:19:00Z' }));

  const answer = await found(box);

  assertNamedNoOpenTab(answer, {
    bot: 'api-bot', session: 'review', run: review, count: 1, deletes: '2026-11-20T19:19:00.000Z', starts: upOf(box, bots, 'api-bot', 'review'),
  });
  assertNoNoOpenTabFor(answer, daily, 'daily\'s tab is open');
  for (const finding of answer.found.filter((one) => hasWord(wordsOf(one), 'daily') && one.bot === 'api-bot')) {
    assert.ok(!finding.says.includes('1.4.262'), `nothing about daily names Orca 1.4.262, got: ${JSON.stringify(finding)}`);
  }
});

test('#841 R1 "whose Run Orca still has": a session with no open tab whose Run Orca deleted gets only the missing-Run finding, while a sibling whose Run Orca has is named', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: ['daily', 'review'] });
  await tabsGone(box, bots, 'api-bot', 'daily', 'review');
  const daily = await mailboxOf(bots, 'api-bot', 'daily');
  const review = await mailboxOf(bots, 'api-bot', 'review');
  await mailTo(box, daily, letter(daily, { at: '2026-11-18T01:00:00Z' }));
  await mailTo(box, review, letter(review, { at: '2026-11-19T02:00:00Z' }));
  await orcaDeletesRun(box, daily);

  const answer = await found(box);

  assertNamedNoOpenTab(answer, {
    bot: 'api-bot', session: 'review', run: review, count: 1, deletes: '2026-11-20T02:00:00.000Z', starts: upOf(box, bots, 'api-bot', 'review'),
  });
  assertNoNoOpenTabFor(answer, daily, 'Orca has no Run for daily');
  const gone = answer.found.filter((one) => hasWord(wordsOf(one), daily));
  assert.deepEqual(gone.map((one) => one.kind), ['session'], `daily's Run is named once, by the missing-Run finding of kind session, got: ${JSON.stringify(answer.found, null, 2)}`);
});

// ---------------------------------------------------------------------------
// Only reads, and shows no subject or body
// ---------------------------------------------------------------------------

test('#841 R1 "obk health MUST name ...": health names the session and changes nothing: no file, no tab, no Run, no letter, and no read that takes mail', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: ['daily', 'review'] });
  await conversationsFor(bots, 'api-bot');
  await obk(box, ['pause', '--bots', 'bots', '--bot', 'api-bot', '--session', 'daily']);
  await tabsGone(box, bots, 'api-bot', 'review');
  const daily = await mailboxOf(bots, 'api-bot', 'daily');
  const review = await mailboxOf(bots, 'api-bot', 'review');
  await mailTo(box, daily, letter(daily, { at: '2026-11-19T11:11:00Z' }));
  await mailTo(box, review, letter(review, { at: '2026-11-19T12:12:00Z' }));
  const before = await snapshot(box.root, skipOrcaFake);
  const state = await box.orca.state();
  const asked = (await box.orca.calls()).length;

  const answer = await found(box);
  await health(box);

  assertNamedNoOpenTab(answer, {
    bot: 'api-bot', session: 'daily', run: daily, count: 1, deletes: '2026-11-20T11:11:00.000Z', starts: unpauseOf(box, bots, 'api-bot', 'daily'),
  });
  assertNamedNoOpenTab(answer, {
    bot: 'api-bot', session: 'review', run: review, count: 1, deletes: '2026-11-20T12:12:00.000Z', starts: upOf(box, bots, 'api-bot', 'review'),
  });
  const after = await box.orca.state();
  assert.deepEqual(await snapshot(box.root, skipOrcaFake), before, 'every file and every link is as it was');
  assert.deepEqual(after.inbox, state.inbox, 'every letter is as it was: none read, none rung');
  assert.deepEqual(after.runs, state.runs, 'no Run made, bound or changed');
  assert.deepEqual(after.messages, state.messages, 'no letter sent or acknowledged');
  assert.deepEqual(after.deliveries, state.deliveries, 'no delivery handed over');
  assert.deepEqual(
    after.terminals.map((one) => ({ handle: one.handle, tabId: one.tabId, title: one.title, typed: one.typed })),
    state.terminals.map((one) => ({ handle: one.handle, tabId: one.tabId, title: one.title, typed: one.typed })),
    'no tab opened, closed, retitled or typed into',
  );
  const calls = (await box.orca.calls()).slice(asked);
  assertOrcaCallsAllowed(calls);
  const forbidden = calls.filter((call) => ['orchestration check', 'orchestration run-use', 'orchestration run-create', 'orchestration send', 'orchestration reply', 'terminal send', 'terminal create'].includes(orcaCommand(call)));
  assert.deepEqual(forbidden.map((call) => call.args), [], 'health takes no mail, binds or makes no Run, sends nothing, types nothing and makes no tab');
  const reads = orcaCallsOf(calls, 'orchestration inbox').map((call) => orcaFlag(call, '--terminal'));
  assert.ok(reads.includes(`run:${daily}`) && reads.includes(`run:${review}`), `health read both mailboxes as run:<id>, got: ${JSON.stringify(reads)}`);
  const books = [await bookIn(bots, 'bot-father'), await bookIn(bots, 'api-bot')];
  const mailboxes = books.flatMap((book) => Object.values(book.sessions ?? {}).map((entry) => `run:${entry.mailbox}`));
  for (const read of reads) assert.ok(mailboxes.includes(read), `each read names a mailbox a book names, as run:<id>, got: ${read}`);
});

test('#841 R1 "It MUST NOT read a subject or a body": neither report shows a letter\'s subject or body, and the plain report says what the JSON says', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot');
  await tabsGone(box, bots, 'api-bot', 'daily');
  const daily = await mailboxOf(bots, 'api-bot', 'daily');
  await mailTo(
    box,
    daily,
    letter(daily, { at: '2026-11-19T08:00:00Z', subject: 'zq-subject-lingonberry-4471', body: 'zq-body-huckleberry-8023' }),
    letter(daily, { at: '2026-11-19T09:00:00Z', read: 1, subject: 'zq-subject-salal-3306', body: 'zq-body-sallow-7719' }),
  );

  const json = await health(box, '--json');
  const plain = await health(box);

  const finding = assertNamedNoOpenTab(JSON.parse(json.stdout), {
    bot: 'api-bot', session: 'daily', run: daily, count: 1, deletes: '2026-11-20T09:00:00.000Z', starts: upOf(box, bots, 'api-bot', 'daily'),
  });
  for (const [name, result] of [['--json', json], ['plain', plain]]) {
    const all = `${result.stdout}${result.stderr}`;
    for (const secret of ['zq-subject-lingonberry-4471', 'zq-body-huckleberry-8023', 'zq-subject-salal-3306', 'zq-body-sallow-7719', 'lingonberry', 'huckleberry']) {
      assert.ok(!all.includes(secret), `the ${name} report shows no subject or body, and shows ${secret}:\n${all}`);
    }
  }
  assert.equal(plain.code, 1, `the plain run finds the same, got: ${plain.stdout}${plain.stderr}`);
  assert.equal(plain.stderr, '');
  assert.ok(
    plain.stdout.split('\n').some((line) => line.includes(finding.kind) && line.includes(finding.where)),
    `one plain line holds the finding's kind and where, got:\n${plain.stdout}`,
  );
  assert.ok(flat(plain.stdout).includes(flat(finding.says)), `and the plain lines say what the JSON says, got:\n${plain.stdout}`);
});

// ---------------------------------------------------------------------------
// Every Orca version (#729)
// ---------------------------------------------------------------------------

for (const version of ORCA_MODELS) {
  test(`#841 R1 "The kit MAY give these words on every Orca version": on Orca ${version}, a session with no open tab and an unread letter is named, and one with only read letters is not`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await botUp(box, 'api-bot', { sessions: ['daily', 'review'] });
    await tabsGone(box, bots, 'api-bot', 'daily', 'review');
    const daily = await mailboxOf(bots, 'api-bot', 'daily');
    const review = await mailboxOf(bots, 'api-bot', 'review');
    await mailTo(box, daily, letter(daily, { at: '2026-11-19T13:00:00Z', read: 1 }), letter(daily, { at: '2026-11-19T15:30:00Z' }));
    await mailTo(box, review, letter(review, { at: '2026-11-19T16:00:00Z', read: 1 }));
    await modelOrca(box, version);

    const answer = await found(box);

    assertNamedNoOpenTab(answer, {
      bot: 'api-bot', session: 'daily', run: daily, count: 1, deletes: '2026-11-20T15:30:00.000Z', starts: upOf(box, bots, 'api-bot', 'daily'),
    });
    assertNoNoOpenTabFor(answer, review, 'every letter of review\'s is read');
  });
}
