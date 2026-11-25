// A booked conversation that runs a second time, in a tab no session owns (#862).
//
// Each booked session of a bot runs its conversation in the one Orca tab its
// book names (`sessions.<name>.tab`, `sessions.<name>.session`). When `up` or
// `restart` opened a new tab for a session because its old one was gone, Orca
// can later bring the old tab back by itself and run `claude --resume <the same
// conversation>` there, with none of the kit's launch line. Then the
// conversation runs in two tabs, and the owner can talk to the wrong copy
// without knowing (seen on 2026-11-24). The kit's SessionStart hook still runs
// in such a tab, because it is in the bot folder's project settings. Until
// #862 it said nothing there.
//
// What the hook does now, as the brief gives it:
//
//   H1  ORCA_TAB_ID is a tab T0 that no session of the bot's book names, and
//       the event's session_id is the conversation C the book holds now for a
//       session S, whose tab is T1. The hook prints one JSON line,
//       `{"hookSpecificOutput":{"hookEventName":<the event's>,"additionalContext":<text>}}`,
//       and the text names `<bot>/<S>`, C, T0 and T1, each as a word of its own.
//   H2  The book is not changed at all, and the hook makes no Orca call.
//   H3  The text does not hand the copy S's duty: not S's start prompt, and not
//       the bot's main units.
//   H4  The same where the process-table check cannot place the harness: with
//       ps broken, with no OBK_TAB_SHELL (a tab Orca brought back by itself),
//       and with no harness chain at all.
//   H5  Contrasts: nothing printed, the book as it was, for an id no session
//       holds now (never seen, or only in a session's history), and for no
//       ORCA_TAB_ID, an empty one, or no session_id. In T1 itself, C is
//       answered as today: the main units alone.
//   H6  The hook reads only the named bot's book: C booked to bot A, the hook
//       run for bot B in a tab B's book does not name, prints nothing.
//   H7  (the architect, 2026-11-25) The same warning for the conversation of a
//       retired session R (the book's top-level `retired` list): it names
//       `<bot>/<R>`, C, T0 and R's tab TR, and says the session is retired;
//       with TR = T0 too. An id only in a retired entry's history gets nothing.
//
// The wording beyond those names is not pinned. Every quiet case here stands
// beside a warning given in the same sandbox, so that a hook that never says
// anything cannot pass. Everything runs in the sandbox (helpers/cli.js), with
// its own HOME and the fake Orca.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  bookIn,
  bookOf,
  createSandbox,
  hooksIn,
  kitHooksIn,
  recordSession,
  sessionIn,
  sessionStart,
  throughATab,
} from './helpers/cli.js';
import { refusingPs, withoutPs } from './helpers/no-ps.js';
import { mainUnitsText } from './helpers/rules.js';

const BOT = 'api-bot';
const PROMPT = 'Read your AGENTS.md and keep the harbour ledger.';
const REVIEW_PROMPT = 'Review each pull request of the harbour ledger.';

/** The conversation the book holds now for daily, and the one daily had before it. */
const C = '0199b2c0-0862-4444-8888-cccccccccc01';
const C_OLD = '0199b2c0-0862-4444-8888-cccccccccc00';
/** The conversation of the other live session, review. */
const C_REVIEW = '0199b2c0-0862-4444-8888-ccccccccccr1';

/** A tab no session of the bot's book names: the old tab Orca brought back. */
const T0 = 'tab_restored_by_orca';

/**
 * A bots folder with api-bot on Claude Code and two sessions, review and daily,
 * each with a start prompt, brought up. daily reported C_OLD, then cleared to C,
 * so its book entry holds C with C_OLD in its history; review holds C_REVIEW.
 */
async function booked(box) {
  const ok = async (args) => {
    const result = await box.run(args);
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
    return result;
  };
  await ok(['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  await ok(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'review', '--prompt', REVIEW_PROMPT]);
  await ok(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily', '--prompt', PROMPT]);
  const up = await ok(['up', '--bots', 'bots', '--bot', BOT, '--json']);
  const bots = box.path('bots');
  const tabs = Object.fromEntries(JSON.parse(up.stdout).tabs.map((entry) => [entry.name, entry.tabId]));

  for (const [tab, session, source] of [[tabs.daily, C_OLD, 'startup'], [tabs.daily, C, 'clear'], [tabs.review, C_REVIEW, 'startup']]) {
    const ran = await recordSession(box, { bots, bot: BOT, tab, session, source });
    assert.equal(ran.code, 0, ran.stderr);
  }
  const daily = await sessionIn(bots, BOT, 'daily');
  assert.equal(daily.session, C, `the premise: the book holds C for daily, got: ${JSON.stringify(daily)}`);
  assert.equal(daily.tab, tabs.daily, 'the premise: daily\'s booked tab is T1');
  assert.deepEqual(daily.history.map((old) => old.session), [C_OLD], 'the premise: C_OLD is only in daily\'s history');
  assert.equal((await sessionIn(bots, BOT, 'review')).session, C_REVIEW, 'the premise: review holds its own conversation');
  const named = Object.values((await bookIn(bots, BOT)).sessions).map((entry) => entry.tab);
  assert.ok(!named.includes(T0), `the premise: no session of the book names ${T0}, got: ${JSON.stringify(named)}`);
  return { bots, t1: tabs.daily, review: tabs.review };
}

const bookText = (bots, bot = BOT) => readFile(bookOf(bots, bot), 'utf8');
const callCount = async (box) => (await box.orca.calls()).length;

/** `text` holds `word` as a word of its own: not as a part of a longer id or name. */
function assertWord(text, word, what) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(
    text,
    new RegExp(`(?:^|[^A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`),
    `the warning names ${what} ${word} as a word of its own, got:\n${text}`,
  );
}

/** The text of the one JSON line the hook printed, about `event`. */
function warningOf(result, event = 'SessionStart') {
  assert.equal(result.code, 0, `the hook never fails the session it runs in: ${result.stderr}`);
  assert.equal(result.stderr, '', `nothing on the user's screen, got: ${result.stderr}`);
  assert.notEqual(result.stdout, '', 'the conversation runs in a tab its session does not own, and the hook printed nothing');
  assert.ok(result.stdout.endsWith('\n') && !result.stdout.slice(0, -1).includes('\n'), `the answer is exactly one line, got: ${JSON.stringify(result.stdout)}`);
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    assert.fail(`the hook's answer must be the JSON the harness reads, got: ${result.stdout} (${error.message})`);
  }
  assert.deepEqual(Object.keys(answer), ['hookSpecificOutput'], `the envelope and nothing else, got: ${result.stdout}`);
  assert.deepEqual(Object.keys(answer.hookSpecificOutput).sort(), ['additionalContext', 'hookEventName'], `got: ${result.stdout}`);
  assert.equal(answer.hookSpecificOutput.hookEventName, event, 'the answer is about the event it was sent');
  const text = answer.hookSpecificOutput.additionalContext;
  assert.equal(typeof text, 'string', `got: ${result.stdout}`);
  return text;
}

/** H1: the warning names daily as api-bot/daily, C, T0 and T1, and not the other session. */
function assertWarnsOfDaily(text, t1) {
  assertWord(text, `${BOT}/daily`, 'the session');
  assertWord(text, C, 'the conversation');
  assertWord(text, T0, 'the tab it runs in now');
  assertWord(text, t1, 'the session\'s own tab');
  assert.ok(!text.includes(`${BOT}/review`) && !text.includes(C_REVIEW), `the warning is about daily, not review, got:\n${text}`);
}

/** H3: the copy is not handed daily's duty: not its start prompt, and none of the main units. */
async function assertNoDuty(text, bots) {
  assert.ok(!text.includes(PROMPT), `the copy must not be handed daily's start prompt, got:\n${text}`);
  const main = await mainUnitsText(bots, BOT);
  assert.ok(!text.includes(main), `the copy must not be handed the bot's main units, got:\n${text}`);
  for (const section of main.split(/\n\n(?=## )/)) {
    assert.ok(!text.includes(section), `the copy must not be handed the main unit ${section.split('\n')[0]}, got:\n${text}`);
  }
}

/** A run that said nothing and did nothing. */
function assertQuiet(result, what) {
  assert.equal(result.code, 0, `${what}: the hook never fails: ${result.stderr}`);
  assert.equal(result.stdout, '', `${what}: nothing to say, so nothing printed, got: ${result.stdout}`);
  assert.equal(result.stderr, '', `${what}: and nothing on the user's screen, got: ${result.stderr}`);
}

/** The kit's own hook command line, as the bot's hook file holds it. */
async function hookCommandOf(bots) {
  const found = kitHooksIn(await hooksIn(bots, BOT, 'claude'));
  assert.equal(found.length, 1, `one hook command should be installed, got: ${JSON.stringify(found)}`);
  return found[0];
}

/**
 * The positive half each quiet case stands beside: in the same sandbox, C
 * resumed in T0 is warned of, and the book stays as it was.
 */
async function assertCopyWarned(box, bots, t1) {
  const before = await bookText(bots);
  const ran = await recordSession(box, { bots, bot: BOT, tab: T0, line: null, session: C, source: 'resume' });
  assertWarnsOfDaily(warningOf(ran), t1);
  assert.equal(await bookText(bots), before, 'and the book is as it was');
}

// ---------------------------------------------------------------- H1, H2, H3
//
// Each test runs its cases in one sandbox, one after another: every case
// leaves the book as it was, and each case checks that it did.

test('H1 C in a tab no session names: one JSON line, about the event sent, names api-bot/daily, C, T0 and T1', async (t) => {
  const box = await createSandbox(t);
  const { bots, t1 } = await booked(box);

  for (const [source, event] of [['resume', 'SessionStart'], ['startup', 'SessionStart'], ['resume', 'SessionResumed']]) {
    const ran = await recordSession(box, { bots, bot: BOT, tab: T0, line: null, session: C, source, event });
    assertWarnsOfDaily(warningOf(ran, event), t1);
  }
});

test('H2 C in a tab no session names: the book is not changed at all, and no Orca call is made', async (t) => {
  const box = await createSandbox(t);
  const { bots, t1 } = await booked(box);

  for (const source of ['resume', 'startup']) {
    const before = await bookText(bots);
    const calls = await callCount(box);

    const ran = await recordSession(box, { bots, bot: BOT, tab: T0, line: null, session: C, source });

    assertWarnsOfDaily(warningOf(ran), t1);
    assert.equal(await bookText(bots), before, `on ${source}: the book is not changed at all, byte for byte`);
    assert.equal(await callCount(box), calls, `on ${source}: the hook makes no Orca call`);
  }
});

test('H3 C in a tab no session names: the copy is not handed daily\'s start prompt or the main units', async (t) => {
  const box = await createSandbox(t);
  const { bots, t1 } = await booked(box);

  for (const source of ['resume', 'startup']) {
    const ran = await recordSession(box, { bots, bot: BOT, tab: T0, line: null, session: C, source });

    const text = warningOf(ran);
    assertWarnsOfDaily(text, t1);
    await assertNoDuty(text, bots);
  }
});

// ---------------------------------------------------------------- H4

/** Each way the kit's process-table check cannot place the harness, with how to run the hook so. */
const UNPLACED = {
  'ps refused': async (box, bots) => recordSession(box, {
    bots, bot: BOT, tab: T0, line: null, session: C, source: 'resume', env: await refusingPs(box, { name: 'ps-refused' }),
  }),
  'ps lists no process': async (box, bots) => recordSession(box, {
    bots, bot: BOT, tab: T0, line: null, session: C, source: 'resume', env: await refusingPs(box, { stderr: '', code: 0, name: 'ps-empty' }),
  }),
  'no ps on PATH': async (box, bots) => recordSession(box, { bots, bot: BOT, tab: T0, line: null, session: C, source: 'resume', env: await withoutPs(box) }),
  'no harness chain at all': (box, bots) => recordSession(box, { bots, bot: BOT, tab: T0, raw: true, session: C, source: 'resume' }),
  'a tab Orca brought back: no OBK_TAB_SHELL, the tab\'s own ancestry': async (box, bots) => throughATab(box, await hookCommandOf(bots), {
    tab: T0, stdin: sessionStart({ session: C, source: 'resume' }),
  }),
  'no OBK_TAB_SHELL, on startup': async (box, bots) => throughATab(box, await hookCommandOf(bots), {
    tab: T0, stdin: sessionStart({ session: C, source: 'startup' }),
  }),
  'no OBK_TAB_SHELL, and no login above the shell': async (box, bots) => throughATab(box, await hookCommandOf(bots), {
    tab: T0, stdin: sessionStart({ session: C, source: 'resume' }), shape: 'no-login',
  }),
  'no OBK_TAB_SHELL, and no shell between login and the harness': async (box, bots) => throughATab(box, await hookCommandOf(bots), {
    tab: T0, stdin: sessionStart({ session: C, source: 'resume' }), shape: 'no-shell',
  }),
  'no OBK_TAB_SHELL, and ps refused': async (box, bots) => throughATab(box, await hookCommandOf(bots), {
    tab: T0, stdin: sessionStart({ session: C, source: 'resume' }), env: await refusingPs(box, { name: 'ps-refused-tab' }),
  }),
};

test('H4 C in a tab no session names, where the kit cannot place the harness: the warning is given, with no duty, and the book is as it was', async (t) => {
  const box = await createSandbox(t);
  const { bots, t1 } = await booked(box);

  for (const [label, run] of Object.entries(UNPLACED)) {
    const before = await bookText(bots);
    const calls = await callCount(box);

    const ran = await run(box, bots);

    assert.notEqual(ran.stdout, '', `${label}: the hook should warn of the copy, and it printed nothing`);
    const text = warningOf(ran);
    assertWarnsOfDaily(text, t1);
    await assertNoDuty(text, bots);
    assert.equal(await bookText(bots), before, `${label}: the book is not changed at all`);
    assert.equal(await callCount(box), calls, `${label}: the hook makes no Orca call`);
  }
});

// ---------------------------------------------------------------- H5

test('H5 in T0, an id no session holds now, or no tab id, or no session id: nothing is printed and the book is as it was, beside a warning for C in T0', async (t) => {
  const box = await createSandbox(t);
  const { bots, t1 } = await booked(box);
  const before = await bookText(bots);
  const calls = await callCount(box);

  for (const [label, call] of [
    ['an id no session has ever held', { tab: T0, line: null, session: '0199b2c0-0862-4444-8888-cccccccccc99', source: 'resume' }],
    ['an id only in daily\'s history (an old one), on resume', { tab: T0, line: null, session: C_OLD, source: 'resume' }],
    ['an id only in daily\'s history, on startup', { tab: T0, line: null, session: C_OLD, source: 'startup' }],
    ['no ORCA_TAB_ID', { line: null, session: C, source: 'resume' }],
    ['an empty ORCA_TAB_ID', { tab: '', line: null, session: C, source: 'resume' }],
    ['no session_id in the event', { tab: T0, line: null, stdin: `${JSON.stringify({ hook_event_name: 'SessionStart', source: 'resume', cwd: '/nowhere' })}\n` }],
  ]) {
    const ran = await recordSession(box, { bots, bot: BOT, ...call });
    assertQuiet(ran, label);
    assert.equal(await bookText(bots), before, `${label}: the book is as it was`);
  }
  assert.equal(await callCount(box), calls, 'no Orca call');

  await assertCopyWarned(box, bots, t1);
});

test('H5 C in its own booked tab T1 is answered as today, the main units alone, beside a warning for C in T0', async (t) => {
  // The case that holds today: the book's own conversation come back in its
  // own tab is a resume, and a Claude Code session gets its main units.
  const box = await createSandbox(t);
  const { bots, t1 } = await booked(box);
  const before = await bookText(bots);
  const main = await mainUnitsText(bots, BOT);

  for (const source of ['resume', 'startup']) {
    const ran = await recordSession(box, { bots, bot: BOT, tab: t1, session: C, source });

    assert.equal(ran.code, 0, ran.stderr);
    assert.equal(ran.stderr, '', ran.stderr);
    const text = JSON.parse(ran.stdout).hookSpecificOutput.additionalContext;
    assert.equal(text, main, `on ${source} in its own tab, C gets the main units alone, as today, got:\n${text}`);
    assert.ok(!text.includes(T0), `T0 is not in play in T1, got:\n${text}`);
    assert.equal(await bookText(bots), before, `on ${source}: the book is as it was`);
  }

  await assertCopyWarned(box, bots, t1);
});

// ---------------------------------------------------------------- H6

test('H6 C is booked to bot A; the hook run for bot B in a tab B does not name prints nothing, beside the warning for A', async (t) => {
  const box = await createSandbox(t);
  const { bots, t1 } = await booked(box);
  for (const args of [
    ['bot', 'create', '--bots', 'bots', '--name', 'web-bot', '--harness', 'claude'],
    ['session', 'add', '--bots', 'bots', '--bot', 'web-bot', '--name', 'daily', '--prompt', 'Keep the web pages up.'],
    ['up', '--bots', 'bots', '--bot', 'web-bot'],
  ]) {
    const result = await box.run(args);
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  }
  const theirs = Object.values((await bookIn(bots, 'web-bot')).sessions ?? {}).map((entry) => entry.tab);
  assert.ok(theirs.length === 1 && !theirs.includes(T0), `the premise: web-bot's book does not name ${T0}, got: ${JSON.stringify(theirs)}`);
  const books = { a: await bookText(bots), b: await bookText(bots, 'web-bot') };
  const calls = await callCount(box);

  for (const source of ['resume', 'startup']) {
    const ran = await recordSession(box, { bots, bot: 'web-bot', tab: T0, line: null, session: C, source });
    assertQuiet(ran, `bot B on ${source}`);
  }

  assert.equal(await bookText(bots), books.a, 'bot A\'s book is as it was');
  assert.equal(await bookText(bots, 'web-bot'), books.b, 'bot B\'s book is as it was');
  assert.equal(await callCount(box), calls, 'no Orca call');

  await assertCopyWarned(box, bots, t1);
});

// ---------------------------------------------------------------- H7

/**
 * booked(), with a third session, old, that reported RC_OLD and then cleared
 * to RC, and was then retired: its entry moved to the book's `retired` list,
 * holding its tab TR, RC, and RC_OLD in its history.
 */
const RC = '0199b2c0-0862-4444-8888-ccccccccccd1';
const RC_OLD = '0199b2c0-0862-4444-8888-ccccccccccd0';

async function withRetired(box) {
  const fleet = await booked(box);
  const { bots } = fleet;
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'old', '--prompt', 'Keep the old ledger.']);
  assert.equal(added.code, 0, added.stderr);
  const up = await box.run(['up', '--bots', 'bots', '--bot', BOT]);
  assert.equal(up.code, 0, up.stderr);
  const tr = (await sessionIn(bots, BOT, 'old'))?.tab;
  assert.equal(typeof tr, 'string', 'the premise: old has a tab');
  for (const [session, source] of [[RC_OLD, 'startup'], [RC, 'clear']]) {
    const ran = await recordSession(box, { bots, bot: BOT, tab: tr, session, source });
    assert.equal(ran.code, 0, ran.stderr);
  }
  const retired = await box.run(['retire', '--bots', 'bots', '--bot', BOT, '--session', 'old']);
  assert.equal(retired.code, 0, `the retirement this test stands on did not happen: ${retired.stdout}${retired.stderr}`);

  const book = await bookIn(bots, BOT);
  assert.equal(book.sessions.old, undefined, 'the premise: old is off the live sessions');
  const entry = (book.retired ?? []).find((one) => one?.name === 'old');
  assert.ok(entry, `the premise: old is in the retired list, got: ${JSON.stringify(book.retired)}`);
  assert.equal(entry.tab, tr, 'the premise: the retired entry keeps its tab TR');
  assert.equal(entry.session, RC, 'the premise: the retired entry keeps its conversation RC');
  assert.deepEqual((entry.history ?? []).map((old) => old.session), [RC_OLD], 'the premise: RC_OLD is only in the retired entry\'s history');
  const named = Object.values(book.sessions).map((one) => one.tab);
  assert.ok(!named.includes(T0) && !named.includes(tr), `the premise: no live session names T0 or TR, got: ${JSON.stringify(named)}`);
  return { ...fleet, tr };
}

/** H7: the warning names api-bot/old, RC, the tab it runs in and TR, and says old is retired. */
function assertWarnsOfRetired(text, { tab, tr }) {
  assertWord(text, `${BOT}/old`, 'the retired session');
  assertWord(text, RC, 'the retired session\'s conversation');
  assertWord(text, tab, 'the tab it runs in now');
  assertWord(text, tr, 'the retired session\'s tab');
  assert.match(text, /\bretired\b/i, `the warning says the session is retired, got:\n${text}`);
}

test('H7 a retired session\'s conversation, in a tab T0 that is not its own: the warning names api-bot/old, RC, T0 and TR, and says retired', async (t) => {
  const box = await createSandbox(t);
  const { bots, tr } = await withRetired(box);
  assert.notEqual(tr, T0, 'the premise: TR is not T0');

  for (const source of ['resume', 'startup']) {
    const before = await bookText(bots);
    const calls = await callCount(box);

    const ran = await recordSession(box, { bots, bot: BOT, tab: T0, line: null, session: RC, source });

    assertWarnsOfRetired(warningOf(ran), { tab: T0, tr });
    assert.equal(await bookText(bots), before, `on ${source}: the book is not changed at all`);
    assert.equal(await callCount(box), calls, `on ${source}: the hook makes no Orca call`);
  }
});

test('H7 a retired session\'s conversation in its own old tab TR, come back: the warning names api-bot/old, RC and TR, and says retired', async (t) => {
  const box = await createSandbox(t);
  const { bots, tr } = await withRetired(box);
  const before = await bookText(bots);
  const calls = await callCount(box);

  const ran = await recordSession(box, { bots, bot: BOT, tab: tr, line: null, session: RC, source: 'resume' });

  assertWarnsOfRetired(warningOf(ran), { tab: tr, tr });
  assert.equal(await bookText(bots), before, 'the book is not changed at all');
  assert.equal(await callCount(box), calls, 'the hook makes no Orca call');
});

test('H7 an id only in a retired entry\'s history, in T0 or in TR: nothing is printed, beside the warning for the retired entry\'s own id', async (t) => {
  const box = await createSandbox(t);
  const { bots, tr } = await withRetired(box);
  const before = await bookText(bots);

  for (const [label, tab] of [['in T0', T0], ['in its own old tab TR', tr]]) {
    const ran = await recordSession(box, { bots, bot: BOT, tab, line: null, session: RC_OLD, source: 'resume' });
    assertQuiet(ran, `an old id of a retired session, ${label}`);
    assert.equal(await bookText(bots), before, `${label}: the book is as it was`);
  }

  const warned = await recordSession(box, { bots, bot: BOT, tab: T0, line: null, session: RC, source: 'resume' });
  assertWarnsOfRetired(warningOf(warned), { tab: T0, tr });
  assert.equal(await bookText(bots), before, 'and the book is still as it was');
});
