// The nudge: the one line typed into the receiver's tab saying mail is waiting.
//
// It exists because of a live check (tech notes, section 1): a message put in
// an Orca mailbox never reaches the harness sitting in the tab. A message
// addressed to a running Claude session's tab left its screen untouched. The
// mailbox is pull-only, so something has to tell a session to look, and the one
// thing that does carry is a line typed into the tab — a busy Claude Code tab
// takes it as a queued message and finishes what it is doing first, and Codex
// takes it as the next turn. That is PRD 6.9's "queued, not interrupting".
//
// What it must never do is type into a tab that is not the receiver's. The book
// holds one tab id per session and that is the only tab the kit may touch; the
// ops tab is not in the book, and a tab the user opened is nobody's business.
//
// And a nudge that does not happen is not a message that did not go. The
// message is in the mailbox either way, so a tab with no harness in it, a tab
// Orca no longer lists and a send Orca refuses all end the same way: the mail
// is waiting, and the run says so.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSandbox,
  orcaCallsOf,
  orcaFlag,
  sessionIn,
  typedInto,
} from './helpers/cli.js';

/** A Claude bot that writes and a Codex bot that reads, both up, nothing typed since. */
async function fleetIn(box, { sessions = ['daily'] } = {}) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  for (const [bot, harness] of [['writer', 'claude'], ['coder', 'codex']]) {
    assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness])).code, 0);
    for (const session of bot === 'coder' ? sessions : ['daily']) {
      assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', session])).code, 0);
    }
  }
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  return box.path('bots');
}

/** Send one message from the writer to the reader. */
const send = (box, args = []) => box.run([
  'message', 'send', '--bots', 'bots', '--to', 'coder', '--from', 'writer/daily',
  '--subject', 'the staging host', '--text', 'It is down again.', ...args,
]);

/** What was typed into every tab of the whole fleet, after the launch line each one got. */
async function typedSinceLaunch(box) {
  const after = {};
  for (const terminal of await box.orca.terminals()) {
    after[terminal.tabId] = typedInto(terminal).slice(1);
  }
  return after;
}

/** The tab one session lives in, as the book has it. */
const tabOf = async (bots, bot, session = 'daily') => (await sessionIn(bots, bot, session)).tab;

test('the receiver\'s tab is told mail is waiting: one line, and only that tab', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);

  const result = await send(box);

  assert.equal(result.code, 0, result.stderr);
  const typed = await typedSinceLaunch(box);
  const reader = await tabOf(bots, 'coder');
  assert.equal(typed[reader].length, 1, `one line into the receiver's tab, got: ${JSON.stringify(typed[reader])}`);
  for (const [tab, lines] of Object.entries(typed)) {
    if (tab === reader) continue;
    assert.deepEqual(lines, [], `nothing may be typed into ${tab}: it is not the receiver's`);
  }
});

test('the line says who wrote, what about, and how to read it', async (t) => {
  // A nudge the receiving bot cannot act on is noise: it has to be able to go
  // and read the mail without asking anybody what the command is.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);

  await send(box);

  const reader = await tabOf(bots, 'coder');
  const [line] = typedInto((await box.orca.terminals()).find((terminal) => terminal.tabId === reader)).slice(1);
  assert.ok(line.includes('writer'), `the sender, got: ${line}`);
  assert.ok(line.includes('the staging host'), `the subject, got: ${line}`);
  assert.ok(line.includes('obk message check'), `and how to read it, got: ${line}`);
  assert.ok(!line.includes('\n'), `one line, got: ${JSON.stringify(line)}`);
});

test('the line is sent off, not left sitting in the tab', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);

  await send(box);

  const reader = await tabOf(bots, 'coder');
  const terminal = (await box.orca.terminals()).find((entry) => entry.tabId === reader);
  assert.deepEqual(terminal.typed.slice(1).map((entry) => entry.enter), [true]);
});

test('the message is queued before the tab is told about it', async (t) => {
  // The other way round is a session told to go and read mail that is not
  // there yet.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);

  await send(box);

  const calls = await box.orca.calls();
  const reader = await tabOf(bots, 'coder');
  const handle = (await box.orca.terminals()).find((entry) => entry.tabId === reader).handle;
  const queued = calls.findIndex((call) => call.args[0] === 'orchestration' && call.args[1] === 'send');
  // The last one: the tab was typed into once already, when `up` started the
  // harness in it.
  const typed = calls.findLastIndex((call) => call.args[0] === 'terminal' && call.args[1] === 'send' && orcaFlag(call, '--terminal') === handle);
  assert.ok(queued >= 0, 'the message should have been queued');
  assert.ok(typed > queued, `the tab is told afterwards, got: ${JSON.stringify(calls.map((call) => call.args))}`);
});

test('a tab with no harness in it is not typed into, and the run says the mail is waiting', async (t) => {
  // Orca refuses the wait with `timeout` when there is no TUI in the tab: a
  // plain shell prompt, or a harness that died. There is nobody to read a line.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await box.orca.set({ waitIdle: false });

  const result = await send(box);

  assert.equal(result.code, 0, `the message went; only the nudge did not: ${result.stderr}`);
  assert.equal((await box.orca.messages()).length, 1, 'the message is in the mailbox');
  assert.deepEqual(Object.values(await typedSinceLaunch(box)).flat(), [], 'and nothing was typed anywhere');
  assert.match(result.stdout + result.stderr, /wait/i, `the run should say the mail is waiting, got: ${result.stdout}`);
});

test('a tab with a question of its own is not typed into', async (t) => {
  // A TUI that is up with something of its own to answer is a tab whose next
  // return answers that question rather than one that queues a line. Orca says
  // so with `blockedReason`, and what a line typed onto such a screen does was
  // proved the hard way in slice 03: a second send into a Claude tab landed on
  // the folder-trust list, confirmed its default, `No, exit`, and the harness
  // quit back to the shell.
  //
  // The hint does not catch everything — Claude Code's trust screen answers
  // `satisfied: true` with no reason at all, and nothing the CLI can ask tells
  // that screen from a ready one (tech notes, section 1). It is still the only
  // signal there is, and a message that waits costs nothing: the mailbox keeps
  // it, and the run says so.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await box.orca.set({ waitIdle: 'blocked' });

  const result = await send(box);

  assert.equal(result.code, 0, result.stderr);
  assert.equal((await box.orca.messages()).length, 1, 'the message is in the mailbox');
  assert.deepEqual(Object.values(await typedSinceLaunch(box)).flat(), [], 'and nothing was typed into a tab that is mid-question');
  assert.match(result.stdout + result.stderr, /wait/i, `the run should say the mail is waiting, got: ${result.stdout}`);
});

test('a session whose tab Orca no longer lists is not typed into either', async (t) => {
  // The user closed it. The book still holds the tab id, and nothing is there.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const reader = await tabOf(bots, 'coder');
  await box.orca.set({
    terminals: (await box.orca.terminals()).filter((terminal) => terminal.tabId !== reader),
  });

  const result = await send(box);

  assert.equal(result.code, 0, result.stderr);
  assert.equal((await box.orca.messages()).length, 1, 'the message is in the mailbox, waiting for it to come back');
  assert.deepEqual(Object.values(await typedSinceLaunch(box)).flat(), [], 'and nothing was typed into anybody else\'s tab');
  assert.match(result.stdout + result.stderr, /wait/i, `the run should say so, got: ${result.stdout}`);
});

test('a session that has never been up is refused before anything is typed', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);
  assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', 'coder', '--name', 'night'])).code, 0);

  const result = await box.run([
    'message', 'send', '--bots', 'bots', '--to', 'coder/night', '--from', 'writer/daily',
    '--subject', 'hello', '--text', 'anyone there?',
  ]);

  assert.equal(result.code, 1);
  assert.deepEqual(Object.values(await typedSinceLaunch(box)).flat(), []);
});

test('the nudge goes to the session that was written to, not to the bot\'s other sessions', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box, { sessions: ['daily', 'night'] });

  const result = await box.run([
    'message', 'send', '--bots', 'bots', '--to', 'coder/night', '--from', 'writer/daily',
    '--subject', 'for the night shift', '--text', 'only you',
  ]);

  assert.equal(result.code, 0, result.stderr);
  const typed = await typedSinceLaunch(box);
  assert.equal(typed[await tabOf(bots, 'coder', 'night')].length, 1);
  assert.deepEqual(typed[await tabOf(bots, 'coder', 'daily')], [], 'the other session was not written to');
});

test('a nudge Orca refuses does not lose the message', async (t) => {
  // The message is queued before the tab is told, so a `terminal send` that
  // fails is a nudge that did not happen and not a message that did not go. A
  // run that failed here would read as "it was not sent", and the sender would
  // send it again.
  const box = await createSandbox(t);
  await fleetIn(box);
  await box.orca.set({ fail: { 'terminal send': { code: 'agent_prompt_blocked', message: 'orca would not take the line' } } });

  const result = await send(box);

  assert.equal((await box.orca.messages()).length, 1, 'the message is in the mailbox whatever Orca said about the tab');
  assert.notEqual((result.stdout + result.stderr).trim(), '', 'and the run says what happened');
  assert.ok(
    !/^\s+at /m.test(result.stdout + result.stderr),
    `a refused nudge is reported, not thrown: ${result.stdout}${result.stderr}`,
  );
});

test('nothing is typed into a tab the book does not hold, whatever else happens', async (t) => {
  // Bot Father's ops tab is the tab the kit keeps nothing about. It is the one
  // tab in the fleet's own workspaces that no session owns, and it must be as
  // untouched after a fleet's worth of messages as before them.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const bookedTabs = new Set([
    await tabOf(bots, 'coder'),
    await tabOf(bots, 'writer'),
    await tabOf(bots, 'bot-father'),
  ]);

  await send(box);
  await send(box);

  const typed = await typedSinceLaunch(box);
  for (const terminal of await box.orca.terminals()) {
    if (bookedTabs.has(terminal.tabId)) continue;
    assert.deepEqual(typed[terminal.tabId], [], `${terminal.title} is not in the book and must never be typed into`);
  }
  assert.deepEqual(
    orcaCallsOf(await box.orca.calls(), 'terminal send').filter((call) => call.args.includes('--interrupt')),
    [],
    'and no nudge ever interrupts what a session is doing',
  );
});
