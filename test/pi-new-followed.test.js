// Pi slice 6 (#662): the book follows a `/new` typed in a Pi tab.
//
// Pi has no hooks; it has extensions. The kit ships one, src/pi-record.js. On
// each session_start it runs the kit's own `session record` (the cli.js beside
// it, with the same Node), as the Claude Code and Codex hooks do, with Pi's id
// and reason on stdin. The record writes the new id into the book, puts the
// old one into the session's history, and answers with the session's start
// prompt when the conversation is new to the tab. The extension hands that
// text to Pi with `pi.sendMessage`, and starts no turn.
//
//   E   the extension, run by a fake Pi (helpers/pi-extension.js) in a
//       sandbox, under a process chain the kit's record believes: what the
//       book holds after, and what the extension sent to Pi
//   (X, every Pi launch line carries `--extension <the kit's src/pi-record.js>`,
//       is in test/pi-extension-line.test.js)
//   C   `obk session clear` on a Pi session still types nothing, and now says
//       to use `/new`, which the book follows
//
// What is pinned is what can be seen: the book, the calls of sendMessage, how
// the handler settled. Not pinned: the customType, the exact stdin, or the
// time the extension waits. Each case where nothing may happen has a control
// beside it, the same /new done right, which the book follows.
//
// Every run is in the sandbox (helpers/cli.js), with a fake `pi` on its PATH
// (helpers/pi.js) and its own HOME. Nothing here reaches the real `pi`, the
// real ~/.pi or the real Orca.

import assert from 'node:assert/strict';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  bookOf,
  botHomeOf,
  createSandbox,
  orcaCallsOf,
  sessionIn,
  tabsOfBot,
} from './helpers/cli.js';
import { fakePi } from './helpers/pi.js';
import { runPiExtension, sentText } from './helpers/pi-extension.js';
import { inTab } from './helpers/temp-roles.js';

const BOT = 'pi-bot';
const PROMPT = 'Read your AGENTS.md and keep the queue moving.';
const TASK = 'Read the open pull request and write down what it changes.';
const NEW_ID = 'b0b0b0b0-1111-4222-8333-444455556666';

/** `obk <args>` that must work. */
async function ok(box, args, options) {
  const result = await box.run(args, options);
  assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return result;
}

/**
 * A bots folder with a Pi bot and its long-lived Pi session daily, brought
 * up: the book holds daily's tab and the id the kit gave it.
 */
async function piFleet(box) {
  await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(box, ['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'pi']);
  await ok(box, ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily', '--prompt', PROMPT]);
  await ok(box, ['up', '--bots', 'bots', '--bot', BOT]);
  const bots = box.path('bots');
  const home = await realpath(botHomeOf(bots, BOT));
  const daily = await sessionIn(bots, BOT, 'daily');
  assert.equal(typeof daily?.tab, 'string', `the up should have given daily a tab, got: ${JSON.stringify(daily)}`);
  assert.equal(typeof daily?.session, 'string', `and an id, got: ${JSON.stringify(daily)}`);
  return { bots, home, tab: daily.tab, id: daily.session };
}

/** The Orca terminal that holds `session`'s tab. */
async function terminalOf(box, bots, session) {
  const tab = (await sessionIn(bots, BOT, session))?.tab;
  const terminal = (await tabsOfBot(box, bots, BOT)).find((one) => one.tabId === tab);
  assert.ok(terminal, `${session} should have a tab in Orca, got the book's ${tab}`);
  return terminal;
}

/** The book's bytes, to show that nothing was written. */
const bookText = (bots) => readFile(bookOf(bots, BOT), 'utf8');

/** The handler settled well: loaded, registered, resolved in time, nothing unhandled. */
function assertCalm(report) {
  const said = JSON.stringify({ ...report, run: undefined });
  assert.equal(report.loadError, undefined, `Pi should load the extension, got:\n${report.loadError}`);
  assert.equal(report.factoryError, undefined, `its default export should take Pi's API, got:\n${report.factoryError}`);
  assert.ok(report.registered.includes('session_start'), `it should register a session_start handler, got: ${said}`);
  assert.equal(report.outcome, 'resolved', `the handler should resolve, got ${report.outcome}: ${report.error ?? said}`);
  assert.deepEqual(report.unhandled, [], 'and leave nothing unhandled in Pi\'s process');
}

/** Nothing was sent to Pi, during the handler or after it. */
function assertSentNothing(report) {
  assert.deepEqual(report.sent, [], `nothing should be sent to Pi, got: ${JSON.stringify(report.sent)}`);
  assert.deepEqual(report.sentLate, [], `not even after the handler resolved, got: ${JSON.stringify(report.sentLate)}`);
}

/** One sendMessage, made before the handler resolved, with `check` true of its text, shown, and no turn started. */
function assertSentOnce(report, check, what) {
  assert.equal(report.sent.length, 1, `one message to Pi before the handler resolved, got: ${JSON.stringify(report.sent)}`);
  assert.deepEqual(report.sentLate, [], `and none after, got: ${JSON.stringify(report.sentLate)}`);
  const [args] = report.sent;
  const text = sentText(args);
  assert.ok(typeof text === 'string' && check(text), `the message should carry ${what}, got: ${JSON.stringify(args)}`);
  const message = args[0];
  assert.equal(typeof message.customType, 'string', `Pi needs a customType, got: ${JSON.stringify(args)}`);
  assert.notEqual(message.customType, '', `got: ${JSON.stringify(args)}`);
  assert.equal(message.display, true, `the message is shown, got: ${JSON.stringify(args)}`);
  for (const part of args) {
    assert.ok(!(part !== null && typeof part === 'object' && part.triggerTurn), `no turn is started, got: ${JSON.stringify(args)}`);
  }
}

/** The session's history holds `id`. */
function assertInHistory(entry, id) {
  assert.ok(
    (entry.history ?? []).some((old) => old?.session === id),
    `the old id ${id} should be in the session's history, got: ${JSON.stringify(entry)}`,
  );
}

/**
 * The control beside a case where nothing may happen: the same run, done
 * right (the bot home, the session's tab, the real CLI, an id), leaves the
 * book holding `id` and sends the start prompt once. So a quiet result above
 * it is the case's, not an extension that never does anything.
 */
async function assertFollows(box, { bots, home, tab, id = NEW_ID }) {
  const before = (await sessionIn(bots, BOT, 'daily'))?.session;
  const report = await runPiExtension(box, { cwd: home, sessionId: id, reason: 'new', tab });
  assertCalm(report);
  const daily = await sessionIn(bots, BOT, 'daily');
  assert.equal(daily.session, id, `the control: the same /new done right should be followed, got: ${JSON.stringify(daily)}`);
  assertInHistory(daily, before);
  assertSentOnce(report, (text) => text === PROMPT, 'the start prompt');
}

// ================================================================= E the extension

test('E1 a /new in a long-lived Pi session (cwd the bot home): the book holds the new id, the old one is in history, and Pi is given the start prompt once', async (t) => {
  const box = await createSandbox(t);
  await fakePi(box);
  const { bots, home, tab, id } = await piFleet(box);

  const report = await runPiExtension(box, { cwd: home, sessionId: NEW_ID, reason: 'new', tab });

  assertCalm(report);
  const daily = await sessionIn(bots, BOT, 'daily');
  assert.equal(daily.session, NEW_ID, `the book should follow the /new, got: ${JSON.stringify(daily)}`);
  assert.equal(daily.tab, tab, 'the tab is still the key');
  assertInHistory(daily, id);
  assertSentOnce(report, (text) => text === PROMPT, `the start prompt ${JSON.stringify(PROMPT)}`);
});

test('E2 a startup with the id the book already holds changes nothing and sends nothing', async (t) => {
  const box = await createSandbox(t);
  await fakePi(box);
  const { bots, home, tab, id } = await piFleet(box);
  const before = await bookText(bots);

  const report = await runPiExtension(box, { cwd: home, sessionId: id, reason: 'startup', tab });

  assertCalm(report);
  assert.equal(await bookText(bots), before, 'the book is as it was');
  assertSentNothing(report);
  await assertFollows(box, { bots, home, tab });
});

test('E3 a cwd that is no bot of a bots folder changes nothing and sends nothing', async (t) => {
  const box = await createSandbox(t);
  await fakePi(box);
  const { bots, home, tab } = await piFleet(box);
  const before = await bookText(bots);
  const elsewhere = path.join(box.root, 'elsewhere', 'project');
  const stranger = path.join(bots, 'bots', 'no-such-bot');
  await mkdir(elsewhere, { recursive: true });
  await mkdir(stranger, { recursive: true });

  for (const cwd of [elsewhere, stranger, box.root]) {
    const report = await runPiExtension(box, { cwd, sessionId: NEW_ID, reason: 'new', tab });

    assertCalm(report);
    assert.equal(await bookText(bots), before, `the book is as it was, for cwd ${cwd}`);
    assertSentNothing(report);
  }
  await assertFollows(box, { bots, home, tab });
});

test('E4 a tab that no session owns changes nothing and sends nothing', async (t) => {
  const box = await createSandbox(t);
  await fakePi(box);
  const { bots, home, tab } = await piFleet(box);
  const before = await bookText(bots);

  const report = await runPiExtension(box, { cwd: home, sessionId: NEW_ID, reason: 'new', tab: 'term-nobody-owns-this' });

  assertCalm(report);
  assert.equal(await bookText(bots), before, 'the book is as it was');
  assertSentNothing(report);
  await assertFollows(box, { bots, home, tab });
});

test('E5 a /new in a temporary Pi session, with cwd the bot home and with cwd its work dir below it: the book follows each', async (t) => {
  const box = await createSandbox(t);
  await fakePi(box);
  const { bots, home, id: dailyId } = await piFleet(box);
  const daily = await terminalOf(box, bots, 'daily');
  await ok(box, ['temp', 'make', '--bots', 'bots', '--name', 'helper', '--prompt', TASK], { env: inTab(box, daily) });
  const helper = await sessionIn(bots, BOT, 'helper');
  assert.ok(helper?.temporary, `helper should be in the book as temporary, got: ${JSON.stringify(helper)}`);
  assert.equal(typeof helper?.tab, 'string', `with a tab, got: ${JSON.stringify(helper)}`);
  assert.equal(typeof helper?.session, 'string', `and an id, got: ${JSON.stringify(helper)}`);
  const workDir = path.join(home, 'work', 'helper');
  await mkdir(workDir, { recursive: true });

  const steps = [
    ['the bot home', home, 'c0c0c0c0-1111-4222-8333-444455556666'],
    ['its work dir', await realpath(workDir), 'd0d0d0d0-1111-4222-8333-444455556666'],
  ];
  let old = helper.session;
  for (const [where, cwd, id] of steps) {
    const report = await runPiExtension(box, { cwd, sessionId: id, reason: 'new', tab: helper.tab });

    assertCalm(report);
    const now = await sessionIn(bots, BOT, 'helper');
    assert.equal(now.session, id, `with cwd ${where}, the book should follow the /new, got: ${JSON.stringify(now)}`);
    assertInHistory(now, old);
    assertSentOnce(report, (text) => text.includes(TASK), `the temporary session's task ${JSON.stringify(TASK)}`);
    assert.ok(!sentText(report.sent[0]).includes(PROMPT), 'and not its maker\'s prompt');
    old = id;
  }
  assert.equal((await sessionIn(bots, BOT, 'daily'))?.session, dailyId, 'the maker\'s id is not touched');
});

test('E6 a long-lived Pi session with cwd a folder below the bot home: the book follows the /new', async (t) => {
  const box = await createSandbox(t);
  await fakePi(box);
  const { bots, home, tab, id } = await piFleet(box);
  const below = path.join(home, 'work', 'daily', 'repo');
  await mkdir(below, { recursive: true });

  const report = await runPiExtension(box, { cwd: await realpath(below), sessionId: NEW_ID, reason: 'new', tab });

  assertCalm(report);
  const daily = await sessionIn(bots, BOT, 'daily');
  assert.equal(daily.session, NEW_ID, `got: ${JSON.stringify(daily)}`);
  assertInHistory(daily, id);
  assertSentOnce(report, (text) => text === PROMPT, 'the start prompt');
});

test('E7 a kit CLI that never answers: the handler gives up, resolves, and sends nothing', async (t) => {
  const box = await createSandbox(t);
  await fakePi(box);
  const { bots, home, tab } = await piFleet(box);
  const before = await bookText(bots);

  const report = await runPiExtension(box, { cwd: home, sessionId: NEW_ID, reason: 'new', tab, cli: 'hangs', limitMs: 40_000 });

  assertCalm(report);
  assert.ok(report.ms < 30_000, `it should give up after about 10 s, it took ${report.ms} ms`);
  assert.equal(await bookText(bots), before, 'the book is as it was');
  assertSentNothing(report);
  await assertFollows(box, { bots, home, tab });
});

for (const [cli, what] of [
  ['garbage', 'answers with text that is no JSON'],
  ['empty-json', 'answers with JSON that carries no start prompt'],
  ['fails', 'fails with exit 1'],
]) {
  test(`E8 a kit CLI that ${what}: the handler resolves and sends nothing`, async (t) => {
    const box = await createSandbox(t);
    await fakePi(box);
    const { bots, home, tab } = await piFleet(box);

    const report = await runPiExtension(box, { cwd: home, sessionId: NEW_ID, reason: 'new', tab, cli });

    assertCalm(report);
    assertSentNothing(report);
    await assertFollows(box, { bots, home, tab });
  });
}

test('E9 a sendMessage that throws: the handler still resolves, and the book still follows', async (t) => {
  const box = await createSandbox(t);
  await fakePi(box);
  const { bots, home, tab } = await piFleet(box);

  const report = await runPiExtension(box, { cwd: home, sessionId: NEW_ID, reason: 'new', tab, sendThrows: true });

  assertCalm(report);
  assert.equal((await sessionIn(bots, BOT, 'daily'))?.session, NEW_ID);
  assert.equal(report.sent.length, 1, `it tried to send once, got: ${JSON.stringify(report.sent)}`);
});

test('E10 a Pi that cannot say its session id: the handler resolves, changes nothing and sends nothing', async (t) => {
  const box = await createSandbox(t);
  await fakePi(box);
  const { bots, home, tab } = await piFleet(box);
  const before = await bookText(bots);

  const report = await runPiExtension(box, { cwd: home, sessionId: NEW_ID, reason: 'new', tab, idThrows: true });

  assertCalm(report);
  assert.equal(await bookText(bots), before, 'the book is as it was');
  assertSentNothing(report);
  await assertFollows(box, { bots, home, tab });
});

// ================================================================= C session clear

test('C1 session clear on a Pi session refuses, types nothing, and says to use /new, which the book follows', async (t) => {
  const box = await createSandbox(t);
  await fakePi(box);
  await piFleet(box);
  const sends = orcaCallsOf(await box.orca.calls(), 'terminal send').length;

  const result = await box.run(['session', 'clear', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);

  assert.notEqual(result.code, 0, `this should have been refused, got:\n${result.stdout}${result.stderr}`);
  const said = result.stdout + result.stderr;
  assert.ok(!/^\s+at /m.test(said), `expected a message, got a crash:\n${said}`);
  assert.equal(orcaCallsOf(await box.orca.calls(), 'terminal send').length, sends, 'nothing was typed into any tab');
  assert.ok(said.includes('/new'), `the refusal should name /new, got:\n${said}`);
  assert.ok(!/later slice/i.test(said), `and no longer say a later slice adds it, got:\n${said}`);
});
