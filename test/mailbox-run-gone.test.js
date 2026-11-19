// A session whose book names a mailbox Run this Orca does not have gets a new
// one from its mailbox step, and only then (issue #508).
//
// A fleet moved to a new machine keeps its bots folder, and with it each
// book's `mailbox:`, an Orca Run. The Runs live in the old machine's Orca, so
// the new Orca has none of them. The launch line's first step, `obk session
// mailbox`, binds the book's Run with `run-use`, Orca refuses, and the step
// fails "unchanged" on every start, for ever: the kit makes a Run only for a
// session whose book names none.
//
// Orca 1.4.223 refuses `run-use` in one set of words for a Run it does not
// have and for a legacy, inspect-only Run it does have (read in its bundle;
// helpers/fake-orca.js models both). Only `run-show` tells them apart: it
// refuses the first with `run_not_found` and answers the second. So what these
// tests pin is:
//
//   1. Replace only on "not found". The book names a Run, `run-use` is
//      refused, and `run-show` is refused with `run_not_found`: the step makes
//      a Run in this tab, writes it into the book as the session's `mailbox`,
//      and answers `change: 'replaced'`, `mailbox` the new id and `replaced`
//      the old one. Its plain line names both ids. In every other case nothing
//      is made, the book is not changed, and the step fails as it did before:
//      `run-use` timed out ("may now be bound"); `run-show` answered the Run
//      (a legacy Run); `run-show` timed out or was refused with another code
//      ("unchanged").
//   2. Safe with two at once. The new Run is written under the book's lock,
//      and only while the book still names the stale Run and this tab. When
//      another writer replaced it first, the book keeps theirs, the step binds
//      that one to this tab and answers `change: 'bound'`, and its own new Run
//      is left unused. When the book moved to another tab, nothing is written
//      and the step fails naming the Run it made, as the made-Run path does.
//   3. History stays. Only the session's `mailbox` changes: its other keys and
//      the book's `retired:` entries are as they were.
//
// Since #820 a Run can also be missing because Orca deleted it: from 1.4.262
// Orca deletes a Run, with its letters, a day after its last write when no tab
// of it is open. So the plain line of a replaced mailbox names both causes and
// says that the letters that waited in the old Run are gone.
//
// The wording is the kit's; what is pinned is the ids, the exit code and the
// book, and for #820 a few facts the line must carry (helpers/run-deleted.js).
// Mail sent to the old Runs is out of scope. Each step runs as coder's
// own tab, with that tab's ORCA_TERMINAL_HANDLE and ORCA_TAB_ID, against the
// fake Orca. Two tests wait out the step's twenty-second limit on one Orca
// call, as the hang tests in mailbox-attestation.test.js do.

import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';
import { stringify } from 'yaml';

import {
  bookIn,
  bookOf,
  botHomeOf,
  createSandbox,
  orcaCallsOf,
  orcaFlag,
  sessionIn,
  sh,
  shellWord,
} from './helpers/cli.js';
import { assertNamesBothCauses, assertSaysLettersGone } from './helpers/run-deleted.js';

// ---------------------------------------------------------------------------
// The fleet, and running the step as a tab
// ---------------------------------------------------------------------------

/** The environment of a command run inside `terminal`, as Orca sets it in every pane. */
const inTab = (box, terminal) => ({ ...box.env, ORCA_TERMINAL_HANDLE: terminal.handle, ORCA_TAB_ID: terminal.tabId });

/** Run `obk <args>` inside `terminal`, or from a plain shell outside Orca when it is null. */
const obkFrom = (box, terminal, args) => box.run(args, terminal === null ? {} : { env: inTab(box, terminal) });

/** The same, and insist it worked. */
async function obkIn(box, terminal, args) {
  const result = await obkFrom(box, terminal, args);
  assert.equal(result.code, 0, `obk ${args.join(' ')} should have worked:\n${result.stdout}${result.stderr}`);
  return result;
}

/** `obk session mailbox` for coder/daily. */
const MAILBOX = ['session', 'mailbox', '--bots', 'bots', '--bot', 'coder', '--session', 'daily'];

/** A conversation id, shaped the way both harnesses shape one. */
const conv = (n) => `0199b2c0-${String(n).padStart(4, '0')}-4444-8888-cccccccccccc`;

/** The fake Orca's terminal for coder/daily's tab, as the book names it. */
async function tabOf(box, bots) {
  const { tab } = await sessionIn(bots, 'coder', 'daily');
  const terminal = (await box.orca.terminals()).find((entry) => entry.tabId === tab);
  assert.ok(terminal !== undefined, `the book says coder/daily lives in ${tab}, and Orca has no such tab`);
  return terminal;
}

/**
 * coder brought up from a plain shell, its step run in its tab, and then moved
 * to a machine whose Orca never made its Run: the book still names the Run,
 * and Orca has no Run of that id. The session's entry is given the other keys
 * a book that has been lived in has (a conversation, an older one in its
 * history), and the book a `retired:` entry with a mailbox of its own, so the
 * tests can see they are left alone.
 *
 * Returns the bots folder, coder's tab, the stale Run's id, and the book as it
 * is now, parsed.
 */
async function movedToANewMachine(box) {
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
    tab: 'tab_from_the_old_mac',
    mailbox: 'run_retired_on_the_old_mac',
    session: conv(9),
    retired: '2026-09-30T08:00:00.000Z',
  }];
  await writeFile(bookOf(bots, 'coder'), stringify(book));

  await box.orca.set({ runs: (await box.orca.runs()).filter((run) => run.id !== stale) });
  return { bots, coder, stale, book: await bookIn(bots, 'coder') };
}

/** Orca's record of one Run, or undefined. */
const runIn = async (box, id) => (await box.orca.runs()).find((run) => run.id === id);

/** The Orca calls made since call number `from`. */
const callsSince = async (box, from) => (await box.orca.calls()).slice(from);

/** How the calls look in a failure message: who asked, and what. */
const shown = (calls) => JSON.stringify(calls.map((call) => `${call.caller ?? 'a plain shell'}: ${call.args.join(' ')}`));

/** A failure a caller can act on: a non-zero exit, something said, no crash, and the names asked about. */
function assertFailedPlainly(result, ...named) {
  const said = result.stdout + result.stderr;
  assert.ok(result.code !== 0 && result.code !== null, `this should have failed, got exit ${result.code}:\n${said}`);
  assert.notEqual(said.trim(), '', 'a failure with nothing said is no use to anybody');
  assert.ok(!/^\s+at /m.test(said), `expected a message, got a crash:\n${said}`);
  for (const word of named) assert.ok(said.includes(word), `it should name ${word}, got:\n${said}`);
}

/** What `session mailbox --json` answered, insisting it worked. */
function answerOf(result) {
  assert.equal(result.code, 0, `the step should have worked:\n${result.stdout}${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON, got: ${result.stdout} (${error.message})`);
  }
}

/**
 * Assert the step left everything as it was: no Run made, the book as it was
 * word for word, and Orca's Runs as they were.
 */
async function assertNothingChanged(box, bots, { book, runs, from }) {
  const since = await callsSince(box, from);
  assert.deepEqual(orcaCallsOf(since, 'orchestration run-create'), [], `no Run is made, got: ${shown(since)}`);
  assert.deepEqual(await bookIn(bots, 'coder'), book, 'and the book is as it was');
  assert.deepEqual(await box.orca.runs(), runs, 'and so are Orca\'s Runs');
}

/** How long the fake takes to answer a call that is meant never to be answered in time: far past the step's own limit. */
const HANG_MS = 60_000;

// ---------------------------------------------------------------------------
// 1. Replace only on "not found"
// ---------------------------------------------------------------------------

test('#508 1: a mailbox this Orca does not have is replaced: a Run made in this tab, written into the book, and the answer says replaced with both ids', async (t) => {
  const box = await createSandbox(t);
  const { bots, coder, stale } = await movedToANewMachine(box);
  const runs = (await box.orca.runs()).length;
  const from = (await box.orca.calls()).length;

  const answer = answerOf(await obkFrom(box, coder, [...MAILBOX, '--json']));

  assert.equal(answer.change, 'replaced', `the step says it replaced the mailbox, got: ${JSON.stringify(answer)}`);
  assert.equal(answer.replaced, stale, `and names the one this Orca does not have, got: ${JSON.stringify(answer)}`);
  assert.equal(answer.bot, 'coder');
  assert.equal(answer.session, 'daily');
  assert.notEqual(answer.mailbox, stale, 'the new mailbox is a new Run');
  const made = await runIn(box, answer.mailbox);
  assert.ok(made !== undefined, `Orca has the new Run ${answer.mailbox}, got: ${JSON.stringify(await box.orca.runs())}`);
  assert.equal(made.coordinator_handle, coder.handle, 'bound to the session\'s own tab');
  assert.equal((await sessionIn(bots, 'coder', 'daily')).mailbox, answer.mailbox, 'and the book names it');
  assert.equal((await box.orca.runs()).length, runs + 1, 'one Run made');
  const since = await callsSince(box, from);
  const shows = orcaCallsOf(since, 'orchestration run-show').filter((call) => orcaFlag(call, '--id') === stale);
  assert.ok(shows.length > 0, `Orca was asked whether it has ${stale} before a new one was made, got: ${shown(since)}`);
  assert.deepEqual(
    since.filter((call) => call.args[0] === 'orchestration' && call.caller !== coder.handle),
    [],
    `every Run call was made from inside the tab itself, got: ${shown(since)}`,
  );
});

test('#508 1: the plain line of a replaced mailbox names both Runs and says this Orca does not have the old one', async (t) => {
  const box = await createSandbox(t);
  const { bots, coder, stale } = await movedToANewMachine(box);

  const result = await obkFrom(box, coder, MAILBOX);

  assert.equal(result.code, 0, `the step should have worked:\n${result.stdout}${result.stderr}`);
  const now = (await sessionIn(bots, 'coder', 'daily')).mailbox;
  assert.notEqual(now, stale, `the book names a new mailbox, got: ${now}`);
  assert.ok(result.stdout.includes(now), `the line names the new mailbox ${now}, got:\n${result.stdout}`);
  assert.ok(result.stdout.includes(stale), `and the old one ${stale}, got:\n${result.stdout}`);
  assert.match(result.stdout, /Orca/, `and says it is Orca that does not have it, got:\n${result.stdout}`);
  assert.match(result.stdout, /\bnot\b|unknown|missing/i, `that Orca does not have the old one, got:\n${result.stdout}`);
});

test('#820 R-M: the plain line of a replaced mailbox names both ids, both causes, Orca 1.4.262 deleted it or the book was written for another Orca, and that its letters are gone', async (t) => {
  const box = await createSandbox(t);
  const { bots, coder, stale } = await movedToANewMachine(box);

  const result = await obkFrom(box, coder, MAILBOX);

  assert.equal(result.code, 0, `the step should have worked:\n${result.stdout}${result.stderr}`);
  const now = (await sessionIn(bots, 'coder', 'daily')).mailbox;
  assert.notEqual(now, stale, `the book names a new mailbox, got: ${now}`);
  assert.ok(result.stdout.includes(now), `the line names the new mailbox ${now}, got:\n${result.stdout}`);
  assert.ok(result.stdout.includes(stale), `and the old one ${stale}, got:\n${result.stdout}`);
  assertNamesBothCauses(result.stdout);
  assertSaysLettersGone(result.stdout);
});

test('#508 1: a legacy Run Orca keeps but will not bind is left unchanged: the step fails as before, makes nothing, and writes nothing', async (t) => {
  // run-use refuses it in the same words as a Run that is gone; run-show
  // answers it. The Run is there, so it is not replaced.
  const box = await createSandbox(t);
  const { bots, coder, stale, book } = await movedToANewMachine(box);
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

  const result = await obkFrom(box, coder, MAILBOX);

  assertFailedPlainly(result, 'coder/daily', stale);
  assert.match(result.stderr, /unchanged|as it was/i, `it says the mailbox is unchanged, got: ${result.stderr}`);
  await assertNothingChanged(box, bots, { book, runs, from });
});

test('#508 1: when run-show is refused with another code, the mailbox is left unchanged: the step fails as before, makes nothing, and writes nothing', async (t) => {
  // The Run really is gone, but Orca did not say so: a busy Orca is not proof.
  const box = await createSandbox(t);
  const { bots, coder, stale, book } = await movedToANewMachine(box);
  await box.orca.set({
    fail: { 'orchestration run-show': { code: 'runtime_error', message: 'the orchestration runtime is restarting; try again in a moment' } },
  });
  const runs = await box.orca.runs();
  const from = (await box.orca.calls()).length;

  const result = await obkFrom(box, coder, MAILBOX);

  assertFailedPlainly(result, 'coder/daily', stale);
  assert.match(result.stderr, /unchanged|as it was/i, `it says the mailbox is unchanged, got: ${result.stderr}`);
  await assertNothingChanged(box, bots, { book, runs, from });
});

test('#508 1: when run-show does not answer, the mailbox is left unchanged: the step gives up, makes nothing, and writes nothing', async (t) => {
  // run-use was refused, so the Run is not bound here; whether it is gone,
  // Orca never said. This waits out the step's limit on the run-show.
  const box = await createSandbox(t);
  const { bots, coder, stale, book } = await movedToANewMachine(box);
  await box.orca.set({ hang: { command: 'orchestration run-show', ms: HANG_MS } });
  const runs = await box.orca.runs();
  const from = (await box.orca.calls()).length;

  const started = Date.now();
  const result = await obkFrom(box, coder, MAILBOX);
  const took = Date.now() - started;

  assert.ok(took < HANG_MS, `the step gave up before Orca answered, after ${took} ms`);
  assertFailedPlainly(result, 'coder/daily', stale);
  assert.match(result.stderr, /unchanged|as it was/i, `it says the mailbox is unchanged, got: ${result.stderr}`);
  await assertNothingChanged(box, bots, { book, runs, from });
});

test('#508 1: when run-use does not answer, nothing is replaced: the step gives up saying the mailbox may be bound, makes nothing, and writes nothing', async (t) => {
  // An Orca that did not answer may have done it, so the step cannot know
  // the Run is gone. This waits out the step's limit on the run-use.
  const box = await createSandbox(t);
  const { bots, coder, stale, book } = await movedToANewMachine(box);
  await box.orca.set({ hang: { command: 'orchestration run-use', ms: HANG_MS } });
  const runs = await box.orca.runs();
  const from = (await box.orca.calls()).length;

  const started = Date.now();
  const result = await obkFrom(box, coder, MAILBOX);
  const took = Date.now() - started;

  assert.ok(took < HANG_MS, `the step gave up before Orca answered, after ${took} ms`);
  assertFailedPlainly(result, 'coder/daily', stale);
  const said = result.stdout + result.stderr;
  assert.match(said, /\bmay\b.{0,80}\bbound\b|\bbound\b.{0,80}\bmay\b/is, `it says the mailbox may be bound, as before, got:\n${said}`);
  await assertNothingChanged(box, bots, { book, runs, from });
});

// ---------------------------------------------------------------------------
// 2. Safe with two at once
// ---------------------------------------------------------------------------

/**
 * Run `argv` in the middle of the next `orchestration run-create`, before Orca
 * answers it: another writer that lands while the step holds what it read.
 */
async function writerDuringRunCreate(box, argv) {
  await box.orca.set({
    runDuring: {
      command: 'orchestration run-create',
      on: orcaCallsOf(await box.orca.calls(), 'orchestration run-create').length + 1,
      argv,
    },
  });
}

/**
 * A command that replaces `from` with `to` in coder's book, as another writer
 * does without the step's turn. It fails if the book did not hold `from`, so a
 * test cannot pass on a write that never happened.
 */
const replaceInBook = (bots, from, to) => [process.execPath, '-e', [
  "const fs = require('fs');",
  `const file = ${JSON.stringify(bookOf(bots, 'coder'))};`,
  "const was = fs.readFileSync(file, 'utf8');",
  `const now = was.replace(${JSON.stringify(from)}, ${JSON.stringify(to)});`,
  'if (now === was) process.exit(3);',
  'fs.writeFileSync(file, now);',
].join(' ')];

/** Assert the other writer really ran in the middle of the step's run-create. */
async function assertRanDuring(box) {
  const ran = await box.orca.ranDuring();
  assert.equal(ran.length, 1, `the other writer should have run in the middle of the step's run-create, got: ${JSON.stringify(ran)}`);
  assert.equal(ran[0].status, 0, `and its write should have worked: ${ran[0].stdout}${ran[0].stderr}`);
}

test('#508 2: when another writer replaced the stale mailbox first, the book keeps theirs, this tab is bound to it, and this step\'s Run is left unused', async (t) => {
  const box = await createSandbox(t);
  const { bots, coder, stale } = await movedToANewMachine(box);
  const theirs = 'run_the_other_writers';
  await box.orca.set({
    runs: [...await box.orca.runs(), {
      id: theirs,
      objective: 'obk coder/daily',
      coordinator_handle: null,
      consumer_generation: 0,
      legacy: false,
      created_at: '2026-10-09T12:00:00.000Z',
      updated_at: '2026-10-09T12:00:00.000Z',
    }],
  });
  await writerDuringRunCreate(box, replaceInBook(bots, `mailbox: ${stale}\n`, `mailbox: ${theirs}\n`));
  const before = new Set((await box.orca.runs()).map((run) => run.id));

  const result = await obkFrom(box, coder, [...MAILBOX, '--json']);

  const answer = answerOf(result);
  await assertRanDuring(box);
  assert.equal(answer.change, 'bound', `the step bound the other writer's Run, got: ${JSON.stringify(answer)}`);
  assert.equal(answer.mailbox, theirs, `and names it, got: ${JSON.stringify(answer)}`);
  assert.equal((await sessionIn(bots, 'coder', 'daily')).mailbox, theirs, 'the book keeps the other writer\'s Run');
  assert.equal((await runIn(box, theirs)).coordinator_handle, coder.handle, 'and it is bound to this tab');
  const made = (await box.orca.runs()).filter((run) => !before.has(run.id));
  assert.equal(made.length, 1, `the step made one Run of its own, got: ${JSON.stringify(made)}`);
  assert.notEqual(made[0].coordinator_handle, coder.handle, 'which is left unused: this tab holds the book\'s Run, not it');
});

test('#508 2: when the book moved to another tab while the step replaced the mailbox, nothing is written and the step fails naming the Run it made', async (t) => {
  const box = await createSandbox(t);
  const { bots, coder, stale } = await movedToANewMachine(box);
  const made = await sh(
    `${shellWord(box.orca.cli)} terminal create --worktree ${shellWord(`path:${botHomeOf(bots, 'coder')}`)} --title 'Coder daily' --json`,
    { cwd: box.cwd, env: box.env },
  );
  assert.equal(made.code, 0, `the fake should have made the tab: ${made.stdout}${made.stderr}`);
  const b = JSON.parse(made.stdout).result.terminal;
  await writerDuringRunCreate(box, replaceInBook(bots, `tab: ${coder.tabId}\n`, `tab: ${b.tabId}\n`));
  const before = new Set((await box.orca.runs()).map((run) => run.id));

  const result = await obkFrom(box, coder, MAILBOX);

  await assertRanDuring(box);
  const mine = (await box.orca.runs()).filter((run) => !before.has(run.id));
  assert.equal(mine.length, 1, `the step made one Run, got: ${JSON.stringify(mine)}`);
  assertFailedPlainly(result, 'coder/daily', mine[0].id);
  const daily = await sessionIn(bots, 'coder', 'daily');
  assert.equal(daily.tab, b.tabId, 'the book names the other tab, as the other writer left it');
  assert.equal(daily.mailbox, stale, 'and nothing was written over its mailbox');
});

// ---------------------------------------------------------------------------
// 3. History stays
// ---------------------------------------------------------------------------

test('#508 3: replacing the mailbox changes only the session\'s mailbox: its other keys and the retired entries are as they were', async (t) => {
  const box = await createSandbox(t);
  const { bots, coder, stale, book } = await movedToANewMachine(box);

  const answer = answerOf(await obkFrom(box, coder, [...MAILBOX, '--json']));

  assert.equal(answer.change, 'replaced', `the premise: the mailbox was replaced, got: ${JSON.stringify(answer)}`);
  const after = await bookIn(bots, 'coder');
  assert.notEqual(after.sessions.daily.mailbox, stale, 'the mailbox is the new one');
  assert.deepEqual(after.retired, book.retired, 'the retired entries are as they were, their mailbox included');
  const expected = structuredClone(book);
  expected.sessions.daily.mailbox = after.sessions.daily.mailbox;
  assert.deepEqual(after, expected, 'and nothing else in the book changed');
});
