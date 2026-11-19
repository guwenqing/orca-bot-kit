// `obk message check` in a session's own tab replaces a mailbox Run that Orca
// deleted (issue #820).
//
// From Orca 1.4.262, Orca deletes a Run, and every letter in it, when the Run
// has had no write for 24 hours and no party is live: for a kit session, its
// tab is not open (read in Orca's source at tag v1.4.263). After that,
// `run-show`, `run-use`, `check` and `send` on the id are refused
// `run_not_found`, as for a Run that this Orca never had (#508). A session
// whose Run was deleted while its tab was closed comes back with a book that
// names a Run that is gone, and until #820 its every check failed.
//
// What these tests pin (R-C of #820):
//
//   1. In the session's own live tab (ORCA_TERMINAL_HANDLE is the handle of the
//      tab the book names, and ORCA_TAB_ID is that tab), a check that is not a
//      `--peek`, for a Run that Orca does not have (`run-use` refused, and
//      `run-show` refused `run_not_found`), makes a new Run in this tab, bound
//      to this tab, and writes its id into the book as the session's
//      `mailbox`. Only that key changes.
//   2. It answers with no letters and exit 0. Its plain output names both ids,
//      both causes (Orca 1.4.262 and later deleted it; the book was written
//      for another Orca, as on another machine), and that the letters that
//      waited in the old Run are gone. `--json` carries `mailbox`, the new id,
//      and `replaced`, the old one.
//   3. A letter sent after that, to the address `obk message to` now names, is
//      read by the next check.
//   4. to 7. In every other case nothing is made (no `run-create` reaches
//      Orca) and the book is not changed: a `--peek`; a `run-show` that answers
//      the Run, is refused with another code, or does not answer; a `run-use`
//      that does not answer; a check from another tab or from outside Orca;
//      and a session with no live tab. A `--peek` and a session with no live
//      tab say that the mailbox is gone, with both causes.
//
// The wording is the kit's. What is pinned is the ids, the exit code, the
// book, the Orca calls, and a few facts the words must carry: "1.4.262", "another
// machine" or "another Orca", and that the letters are gone, lost or deleted.
//
// Everything runs through the CLI on a sandboxed bots folder against the fake
// Orca. helpers/run-deleted.js deletes a Run there as Orca 1.4.262 does: the
// Run, and the letters filed under it. Each check in coder's tab has that tab's
// ORCA_TERMINAL_HANDLE and ORCA_TAB_ID and what the kit's launch line gives
// the harness it starts (#408). Three tests wait out the check's twenty-second
// limit on one Orca call, as the hang tests in mailbox-run-gone.test.js do.

import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';
import { stringify } from 'yaml';

import {
  bookIn,
  bookOf,
  createSandbox,
  launchLineEnv,
  orcaCallsOf,
  orcaFlag,
  sessionIn,
  spellingsOf,
} from './helpers/cli.js';
import { assertNamesBothCauses, assertSaysLettersGone, assertSaysNothingGone, orcaDeletesRun } from './helpers/run-deleted.js';

// ---------------------------------------------------------------------------
// The fleet, and running a check as a tab
// ---------------------------------------------------------------------------

/**
 * The environment of a command that a session's harness runs inside
 * `terminal`: the tab's own ORCA_TERMINAL_HANDLE and ORCA_TAB_ID, as Orca sets
 * them in every pane, and what the kit's launch line gives the harness.
 */
const inTab = (box, terminal) => ({
  ...box.env,
  ORCA_TERMINAL_HANDLE: terminal.handle,
  ORCA_TAB_ID: terminal.tabId,
  ...launchLineEnv(box),
});

/** Run `obk <args>` inside `terminal`, or from a plain shell outside Orca when it is null. */
const obkFrom = (box, terminal, args) => box.run(args, terminal === null ? {} : { env: inTab(box, terminal) });

/** The same, and insist it worked. */
async function obkIn(box, terminal, args) {
  const result = await obkFrom(box, terminal, args);
  assert.equal(result.code, 0, `obk ${args.join(' ')} should have worked:\n${result.stdout}${result.stderr}`);
  return result;
}

/** `obk message check` for coder/daily. */
const CHECK = ['message', 'check', '--bots', 'bots', '--bot', 'coder', '--session', 'daily'];

/** A conversation id, shaped the way both harnesses shape one. */
const conv = (n) => `0199b2c0-${String(n).padStart(4, '0')}-4444-8888-cccccccccccc`;

/** The fake Orca's terminal for one session's tab, as the book names it. */
async function tabOf(box, bots, bot = 'coder', session = 'daily') {
  const { tab } = await sessionIn(bots, bot, session);
  const terminal = (await box.orca.terminals()).find((entry) => entry.tabId === tab);
  assert.ok(terminal !== undefined, `the book says ${bot}/${session} lives in ${tab}, and Orca has no such tab`);
  return terminal;
}

/** The subject of the letter that waited in the old Run when Orca deleted it. */
const WAITED = 'the letter that waited in the old mailbox';

/** A letter from Bot Father's session to coder/daily, sent from a plain shell. */
const mail = (box, subject) => obkIn(box, null, [
  'message', 'send', '--bots', 'bots', '--to', 'coder/daily', '--from', 'bot-father/daily',
  '--subject', subject, '--text', 'Please look at the staging host.',
]);

/**
 * coder, a Codex bot, brought up from a plain shell, its mailbox step run in
 * its tab, and a letter sent to it and left unread. The session's entry is
 * given the other keys a book that has been lived in has (a conversation, an
 * older one in its history), and the book a `retired:` entry with a mailbox of
 * its own, so the tests can see they are left alone.
 *
 * Returns the bots folder, coder's tab, and its Run's id.
 */
async function coderWithALetter(box) {
  await obkIn(box, null, ['init', '--bots', 'bots', '--harness', 'claude']);
  const bots = box.path('bots');
  await obkIn(box, null, ['bot', 'create', '--bots', 'bots', '--name', 'coder', '--harness', 'codex']);
  await obkIn(box, null, ['session', 'add', '--bots', 'bots', '--bot', 'coder', '--name', 'daily']);
  await obkIn(box, null, ['up', '--bots', 'bots', '--bot', 'coder']);
  const coder = await tabOf(box, bots);

  const book = await bookIn(bots, 'coder');
  const stale = book.sessions.daily.mailbox;
  assert.ok(typeof stale === 'string' && stale !== '', `the premise: coder's step gave it a mailbox, got: ${JSON.stringify(book.sessions.daily)}`);
  book.sessions.daily.session = conv(2);
  book.sessions.daily.history = [{ session: conv(1) }];
  book.retired = [{
    name: 'night',
    tab: 'tab_closed_long_ago',
    mailbox: 'run_of_a_retired_session',
    session: conv(9),
    retired: '2026-09-30T08:00:00.000Z',
  }];
  await writeFile(bookOf(bots, 'coder'), stringify(book));

  await mail(box, WAITED);
  assert.ok(
    (await box.orca.messages()).some((message) => message.to === `run:${stale}` && message.subject === WAITED),
    'the premise: a letter waits in the Run before Orca deletes it',
  );
  return { bots, coder, stale };
}

/**
 * coderWithALetter, and then its Run deleted by Orca, the letter with it, while
 * its tab is still open: the book names a Run that is gone, as it does when
 * the tab was closed for the day and opened again.
 *
 * Returns the bots folder, coder's tab, the deleted Run's id, and the book as
 * it is now, parsed.
 */
async function runDeletedByOrca(box) {
  const { bots, coder, stale } = await coderWithALetter(box);
  await orcaDeletesRun(box, stale);
  return { bots, coder, stale, book: await bookIn(bots, 'coder') };
}

// ---------------------------------------------------------------------------
// Reading what happened
// ---------------------------------------------------------------------------

/** Orca's record of one Run, or undefined. */
const runIn = async (box, id) => (await box.orca.runs()).find((run) => run.id === id);

/** The Orca calls made since call number `from`. */
const callsSince = async (box, from) => (await box.orca.calls()).slice(from);

/** How the calls look in a failure message: who asked, and what. */
const shown = (calls) => JSON.stringify(calls.map((call) => `${call.caller ?? 'a plain shell'}: ${call.args.join(' ')}`));

/** Everything a command said, on either stream. */
const saidBy = (result) => result.stdout + result.stderr;

/** Every run of whitespace as one space, so a re-wrapped sentence still reads the same. */
const flat = (text) => text.replace(/\s+/g, ' ');

/** What `message check --json` answered, insisting it worked. */
function answerOf(result) {
  assert.equal(result.code, 0, `the check should have worked:\n${saidBy(result)}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON, got: ${result.stdout} (${error.message})`);
  }
}

/** Something said, and no crash. */
function assertNoCrash(result) {
  const said = saidBy(result);
  assert.notEqual(said.trim(), '', 'a command that says nothing is no use to anybody');
  assert.ok(!/^\s+at /m.test(said), `expected a message, got a crash:\n${said}`);
}

/** A failure a caller can act on: a non-zero exit, something said, and no crash. */
function assertFailedPlainly(result) {
  assert.ok(result.code !== 0 && result.code !== null, `this should have failed, got exit ${result.code}:\n${saidBy(result)}`);
  assertNoCrash(result);
}

/**
 * Assert the check left everything as it was: no Run made, the book as it was
 * word for word, and Orca's Runs as they were.
 */
async function assertNothingChanged(box, bots, { book, runs, from }) {
  const since = await callsSince(box, from);
  assert.deepEqual(orcaCallsOf(since, 'orchestration run-create'), [], `no Run is made, got: ${shown(since)}`);
  assert.deepEqual(await bookIn(bots, 'coder'), book, 'and the book is as it was');
  assert.deepEqual(await box.orca.runs(), runs, 'and so are Orca\'s Runs');
}

/** Whether `said` gives `<cli> <verb> ` in one of the spellings a shell reads as one word. */
const givesAny = (box, said, verb) => spellingsOf(box.cli).some((cli) => said.includes(`${cli} ${verb} `));

/** How long the fake takes to answer a call that is meant never to be answered in time: far past the check's own limit. */
const HANG_MS = 60_000;

// ---------------------------------------------------------------------------
// R-C1 to R-C3: in its own tab, a check replaces a Run Orca deleted
// ---------------------------------------------------------------------------

test('#820 R-C1: a check in the session\'s own tab makes a new Run there, bound to the tab, and writes it into the book as its mailbox', async (t) => {
  const box = await createSandbox(t);
  const { bots, coder, stale } = await runDeletedByOrca(box);
  const runs = (await box.orca.runs()).length;
  const from = (await box.orca.calls()).length;

  const answer = answerOf(await obkFrom(box, coder, [...CHECK, '--json']));

  const now = (await sessionIn(bots, 'coder', 'daily')).mailbox;
  assert.notEqual(now, stale, `the book names a new mailbox, got: ${now}`);
  assert.equal(answer.mailbox, now, `and the answer names the one the book now names, got: ${JSON.stringify(answer)}`);
  const made = await runIn(box, now);
  assert.ok(made !== undefined, `Orca has the new Run ${now}, got: ${JSON.stringify(await box.orca.runs())}`);
  assert.equal(made.coordinator_handle, coder.handle, 'bound to the session\'s own tab');
  assert.equal((await box.orca.runs()).length, runs + 1, 'one Run made');
  const since = await callsSince(box, from);
  const creates = orcaCallsOf(since, 'orchestration run-create');
  assert.equal(creates.length, 1, `one run-create reached Orca, got: ${shown(since)}`);
  assert.equal(creates[0].caller, coder.handle, `made from inside the session's own tab, got: ${shown(since)}`);
  const shows = since.findIndex((call) => orcaCallsOf([call], 'orchestration run-show').length === 1 && orcaFlag(call, '--id') === stale);
  assert.ok(shows >= 0, `Orca was asked whether it has ${stale}, got: ${shown(since)}`);
  assert.ok(shows < since.indexOf(creates[0]), `before the new one was made, got: ${shown(since)}`);
});

test('#820 R-C1: replacing the mailbox changes only the session\'s mailbox: its other keys and the retired entries are as they were', async (t) => {
  const box = await createSandbox(t);
  const { bots, coder, stale, book } = await runDeletedByOrca(box);

  await obkFrom(box, coder, CHECK);

  const after = await bookIn(bots, 'coder');
  assert.notEqual(after.sessions.daily.mailbox, stale, `the premise: the mailbox was replaced, got: ${JSON.stringify(after.sessions.daily)}`);
  assert.deepEqual(after.retired, book.retired, 'the retired entries are as they were, their mailbox included');
  const expected = structuredClone(book);
  expected.sessions.daily.mailbox = after.sessions.daily.mailbox;
  assert.deepEqual(after, expected, 'and nothing else in the book changed');
});

test('#820 R-C2: the --json answer carries the new mailbox and the replaced one, and no letters: the one that waited went with the old Run', async (t) => {
  const box = await createSandbox(t);
  const { bots, coder, stale } = await runDeletedByOrca(box);

  const answer = answerOf(await obkFrom(box, coder, [...CHECK, '--json']));

  assert.equal(answer.replaced, stale, `the answer names the Run it replaced, got: ${JSON.stringify(answer)}`);
  assert.equal(answer.mailbox, (await sessionIn(bots, 'coder', 'daily')).mailbox, `and the new one, got: ${JSON.stringify(answer)}`);
  assert.notEqual(answer.mailbox, stale, `which is not the old one, got: ${JSON.stringify(answer)}`);
  assert.equal(answer.bot, 'coder');
  assert.equal(answer.session, 'daily');
  assert.deepEqual(answer.messages, [], `it answers no letters, got: ${JSON.stringify(answer)}`);
  assert.equal(answer.trouble, undefined, `and no trouble, got: ${JSON.stringify(answer)}`);
});

test('#820 R-C2: the plain output names the old and the new mailbox, both causes, and that the letters that waited are gone, and exits 0', async (t) => {
  const box = await createSandbox(t);
  const { bots, coder, stale } = await runDeletedByOrca(box);

  const result = await obkFrom(box, coder, CHECK);

  assert.equal(result.code, 0, `the check should have worked:\n${saidBy(result)}`);
  assertNoCrash(result);
  const now = (await sessionIn(bots, 'coder', 'daily')).mailbox;
  assert.notEqual(now, stale, `the premise: the book names a new mailbox, got: ${now}`);
  const said = saidBy(result);
  assert.ok(said.includes(now), `it names the new mailbox ${now}, got:\n${said}`);
  assert.ok(said.includes(stale), `and the old one ${stale}, got:\n${said}`);
  assertNamesBothCauses(said);
  assertSaysLettersGone(said);
  assert.ok(!said.includes(WAITED), `and it hands over no letter of the old Run, got:\n${said}`);
});

test('#820 R-C3: after the check replaced the mailbox, message to names the new one, and a letter sent there is read by the next check', async (t) => {
  const box = await createSandbox(t);
  const { bots, coder, stale } = await runDeletedByOrca(box);
  await obkFrom(box, coder, CHECK);
  const now = (await sessionIn(bots, 'coder', 'daily')).mailbox;
  assert.notEqual(now, stale, `the premise: the check replaced the mailbox, got: ${now}`);

  const road = await obkIn(box, null, ['message', 'to', '--bots', 'bots', '--to', 'coder/daily', '--from', 'bot-father/daily', '--json']);
  const after = 'a letter to the new mailbox';
  await mail(box, after);
  const next = await obkFrom(box, coder, CHECK);

  assert.equal(JSON.parse(road.stdout).address, `run:${now}`, `message to names the new mailbox, got: ${road.stdout}`);
  assert.equal(next.code, 0, `the next check should have worked:\n${saidBy(next)}`);
  assert.ok(next.stdout.includes(after), `and it reads the letter sent there, got:\n${saidBy(next)}`);
  assert.ok(!next.stdout.includes(WAITED), `and not the one Orca deleted, got:\n${saidBy(next)}`);
  assert.deepEqual(
    (await box.orca.messages()).filter((message) => !message.acked).map((message) => message.subject),
    [],
    'nothing is left waiting',
  );
});

// ---------------------------------------------------------------------------
// R-C4 to R-C6: in every other case, nothing is made
// ---------------------------------------------------------------------------

test('#820 R-C4: a --peek in its own tab makes nothing and writes nothing, and says the mailbox is gone, why, and what makes a new one', async (t) => {
  const box = await createSandbox(t);
  const { bots, coder, stale, book } = await runDeletedByOrca(box);
  const runs = await box.orca.runs();
  const from = (await box.orca.calls()).length;

  const result = await obkFrom(box, coder, [...CHECK, '--peek']);

  await assertNothingChanged(box, bots, { book, runs, from });
  assertNoCrash(result);
  const said = saidBy(result);
  assert.ok(said.includes(stale), `it names the mailbox that is gone, ${stale}, got:\n${said}`);
  assertNamesBothCauses(said);
  assert.match(flat(said), /\bnew\b/i, `and says a new one is made, got:\n${said}`);
  assert.match(flat(said), /\bcheck\b/i, `by the next check in its own tab, got:\n${said}`);
  assert.match(flat(said), /\bstart/i, `or by its next start, got:\n${said}`);
});

test('#820 R-C5: a legacy Run that run-show still answers is not replaced: the check fails, makes nothing and writes nothing', async (t) => {
  // run-use refuses it in the same words as a Run that is gone; run-show
  // answers it. The Run is there, so it is not replaced.
  const box = await createSandbox(t);
  const { bots, coder, stale, book } = await runDeletedByOrca(box);
  await box.orca.set({
    runs: [...await box.orca.runs(), {
      id: stale,
      objective: 'obk coder/daily',
      coordinator_handle: null,
      consumer_generation: 0,
      legacy: 1,
      created_at: '2026-09-01T12:00:00.000Z',
      updated_at: '2026-09-01T12:00:00.000Z',
    }],
  });
  const runs = await box.orca.runs();
  const from = (await box.orca.calls()).length;

  const result = await obkFrom(box, coder, CHECK);

  assertFailedPlainly(result);
  await assertNothingChanged(box, bots, { book, runs, from });
});

test('#820 R-C5: when run-show is refused with another code, nothing is replaced: the check fails, makes nothing and writes nothing', async (t) => {
  // The Run really is gone, but Orca did not say so: a busy Orca is not proof.
  const box = await createSandbox(t);
  const { bots, coder, book } = await runDeletedByOrca(box);
  await box.orca.set({
    fail: { 'orchestration run-show': { code: 'runtime_error', message: 'the orchestration runtime is restarting; try again in a moment' } },
  });
  const runs = await box.orca.runs();
  const from = (await box.orca.calls()).length;

  const result = await obkFrom(box, coder, CHECK);

  assertFailedPlainly(result);
  await assertNothingChanged(box, bots, { book, runs, from });
});

test('#820 R-C5: when run-show does not answer, nothing is replaced: the check gives up, makes nothing and writes nothing', async (t) => {
  // Whether the Run is gone, Orca never said. This waits out the check's
  // limit on the run-show.
  const box = await createSandbox(t);
  const { bots, coder, book } = await runDeletedByOrca(box);
  await box.orca.set({ hang: { command: 'orchestration run-show', ms: HANG_MS } });
  const runs = await box.orca.runs();
  const from = (await box.orca.calls()).length;

  const started = Date.now();
  const result = await obkFrom(box, coder, CHECK);
  const took = Date.now() - started;

  assert.ok(took < HANG_MS, `the check gave up before Orca answered, after ${took} ms`);
  assertFailedPlainly(result);
  await assertNothingChanged(box, bots, { book, runs, from });
});

test('#820 R-C5: when run-use does not answer, nothing is replaced: the check gives up, makes nothing and writes nothing', async (t) => {
  // An Orca that did not answer may have bound the Run, so the check cannot
  // know it is gone. This waits out the check's limit on the run-use.
  const box = await createSandbox(t);
  const { bots, coder, book } = await runDeletedByOrca(box);
  await box.orca.set({ hang: { command: 'orchestration run-use', ms: HANG_MS } });
  const runs = await box.orca.runs();
  const from = (await box.orca.calls()).length;

  const started = Date.now();
  const result = await obkFrom(box, coder, CHECK);
  const took = Date.now() - started;

  assert.ok(took < HANG_MS, `the check gave up before Orca answered, after ${took} ms`);
  assertFailedPlainly(result);
  await assertNothingChanged(box, bots, { book, runs, from });
});

test('#820 R-C6: a check of the session from another tab makes nothing and writes nothing', async (t) => {
  // Bot Father's own tab, with its own handle: Orca lets a tab make and bind
  // a Run for itself only, and this tab is not coder/daily's.
  const box = await createSandbox(t);
  const { bots, book } = await runDeletedByOrca(box);
  const other = await tabOf(box, bots, 'bot-father', 'daily');
  const runs = await box.orca.runs();
  const from = (await box.orca.calls()).length;

  const result = await obkFrom(box, other, CHECK);

  assertFailedPlainly(result);
  await assertNothingChanged(box, bots, { book, runs, from });
});

test('#820 R-C6: a check of the session from a plain shell outside Orca makes nothing and writes nothing', async (t) => {
  const box = await createSandbox(t);
  const { bots, book } = await runDeletedByOrca(box);
  const runs = await box.orca.runs();
  const from = (await box.orca.calls()).length;

  const result = await obkFrom(box, null, CHECK);

  assertFailedPlainly(result);
  await assertNothingChanged(box, bots, { book, runs, from });
});

// ---------------------------------------------------------------------------
// R-C7: a session with no live tab
// ---------------------------------------------------------------------------

test('#820 R-C7: a paused session whose Run Orca deleted: the check fails, makes nothing, and says the mailbox and its letters are gone, why, and that unpause makes a new one', async (t) => {
  // Paused, the session has no tab, which is when Orca deletes its Run. The
  // check runs from a plain shell, as a check of a paused session does.
  const box = await createSandbox(t);
  const { bots, coder, stale } = await coderWithALetter(box);
  await obkIn(box, null, ['pause', '--bots', 'bots', '--bot', 'coder', '--session', 'daily']);
  assert.ok(!(await box.orca.terminals()).some((entry) => entry.handle === coder.handle), 'the premise: pause closed its tab');
  await orcaDeletesRun(box, stale);
  const book = await bookIn(bots, 'coder');
  const runs = await box.orca.runs();
  const from = (await box.orca.calls()).length;

  const result = await obkFrom(box, null, CHECK);

  assertFailedPlainly(result);
  await assertNothingChanged(box, bots, { book, runs, from });
  const said = saidBy(result);
  assert.ok(said.includes(stale), `it names the mailbox that is gone, ${stale}, got:\n${said}`);
  assertNamesBothCauses(said);
  assertSaysLettersGone(said);
  assert.ok(givesAny(box, said, 'unpause'), `and that its next start, ${box.cli} unpause …, makes a new one, got:\n${said}`);
});

test('#820 R-C7: a session whose tab is gone from Orca and whose Run Orca deleted: the check fails, makes nothing, and says the mailbox and its letters are gone, why, and that up makes a new one', async (t) => {
  const box = await createSandbox(t);
  const { bots, coder, stale, book } = await runDeletedByOrca(box);
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((entry) => entry.handle !== coder.handle) });
  const runs = await box.orca.runs();
  const from = (await box.orca.calls()).length;

  const result = await obkFrom(box, null, CHECK);

  assertFailedPlainly(result);
  await assertNothingChanged(box, bots, { book, runs, from });
  const said = saidBy(result);
  assert.ok(said.includes(stale), `it names the mailbox that is gone, ${stale}, got:\n${said}`);
  assertNamesBothCauses(said);
  assertSaysLettersGone(said);
  assert.ok(givesAny(box, said, 'up'), `and that its next start, ${box.cli} up …, makes a new one, got:\n${said}`);
});

/** Each way the kit may spell `<cli> unpause --bots <bots> --bot <bot>`, in the spellings a shell reads as one word. */
const unpausesOf = (box, bots, bot) => spellingsOf(box.cli)
  .flatMap((cli) => spellingsOf(bots).map((folder) => `${cli} unpause --bots ${folder} --bot ${bot}`));

test('#820 R-C7: a paused bot whose Run Orca deleted: the check fails, makes nothing, and names the bot\'s unpause, with no --session', async (t) => {
  // `obk pause --bot` pauses the whole bot; what brings it back is the bot's
  // unpause, as health names it for a paused bot (health-mailbox-gone.test.js).
  const box = await createSandbox(t);
  const { bots, coder, stale } = await coderWithALetter(box);
  await obkIn(box, null, ['pause', '--bots', 'bots', '--bot', 'coder']);
  assert.ok(!(await box.orca.terminals()).some((entry) => entry.handle === coder.handle), 'the premise: pause closed its tab');
  await orcaDeletesRun(box, stale);
  const book = await bookIn(bots, 'coder');
  const runs = await box.orca.runs();
  const from = (await box.orca.calls()).length;

  const result = await obkFrom(box, null, CHECK);

  assertFailedPlainly(result);
  await assertNothingChanged(box, bots, { book, runs, from });
  const said = saidBy(result);
  assert.ok(said.includes(stale), `it names the mailbox that is gone, ${stale}, got:\n${said}`);
  assertNamesBothCauses(said);
  assertSaysLettersGone(said);
  const theBot = unpausesOf(box, bots, 'coder').some((command) => {
    for (let at = said.indexOf(command); at >= 0; at = said.indexOf(command, at + 1)) {
      if (!said.slice(at + command.length).trimStart().startsWith('--session')) return true;
    }
    return false;
  });
  assert.ok(theBot, `it names the bot's unpause, ${box.cli} unpause --bots ${bots} --bot coder, with no --session, got:\n${said}`);
});

/** The ways Orca does not say a Run is gone: refused with another code, or no answer in time. */
const NOT_SAID = [
  ['run-show is refused with another code', { fail: { 'orchestration run-show': { code: 'runtime_error', message: 'the orchestration runtime is restarting; try again in a moment' } } }],
  ['run-show does not answer', { hang: { command: 'orchestration run-show', ms: HANG_MS } }],
];

for (const [how, misbehaves] of NOT_SAID) {
  test(`#820 R-C7: a paused session whose Run Orca still has, when ${how}: the check fails, makes nothing, and does not say the mailbox or its letters are gone`, async (t) => {
    // Orca did not say the Run is gone, and it is not: its letter still waits.
    // A "gone" here would tell the user mail was lost when it was not.
    const box = await createSandbox(t);
    const { bots, coder, stale } = await coderWithALetter(box);
    await obkIn(box, null, ['pause', '--bots', 'bots', '--bot', 'coder', '--session', 'daily']);
    assert.ok(!(await box.orca.terminals()).some((entry) => entry.handle === coder.handle), 'the premise: pause closed its tab');
    assert.ok((await runIn(box, stale)) !== undefined, `the premise: Orca still has ${stale}`);
    await box.orca.set(misbehaves);
    const book = await bookIn(bots, 'coder');
    const runs = await box.orca.runs();
    const from = (await box.orca.calls()).length;

    const result = await obkFrom(box, null, CHECK);

    assertFailedPlainly(result);
    await assertNothingChanged(box, bots, { book, runs, from });
    assertSaysNothingGone(saidBy(result));
    assert.deepEqual(
      (await box.orca.messages()).filter((message) => message.to === `run:${stale}` && !message.acked).map((message) => message.subject),
      [WAITED],
      'and the letter still waits in the Run, unread',
    );
  });
}
