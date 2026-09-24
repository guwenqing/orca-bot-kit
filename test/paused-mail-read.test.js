// Reading a session's mail while its tab is down does not move its mailbox to
// the reader's tab (issue #249).
//
// A session's mailbox is an Orca Run, bound to one coordinator terminal, and
// that terminal is the only place Orca writes its own notice when mail arrives
// (ADR 0018, tech notes section 1). #228 bound each Run to its session's own
// tab, and made a check of a session whose tab is live read as that tab. A
// session whose tab is down (paused with `obk pause`, or its tab closed) was
// still read the old way: the check bound the Run to whatever terminal typed
// it. Read from Bot Father's tab, that hands Bot Father the session's notices
// and leaves Bot Father's own Run with no coordinator, since one terminal holds
// one Run. From a plain shell Orca refuses the bind outright.
//
// What Orca 1.4.209 does, measured live and kept by the fake (see
// helpers/fake-orca.js): closing a tab leaves its handle on the Run as
// `coordinator_handle`, and `check --run R --terminal H` reads and acks as H
// whenever H is R's coordinator, closed or not, without binding anything. A
// live tab that holds no Run, or another Run, is fenced out, and so is a closed
// handle once the Run has been bound to a new tab.
//
// Out of scope: sessions whose tab is live (#228), and Orca's own notice rule.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertOrcaCallsAllowed,
  createSandbox,
  recordSession,
  sessionIn,
} from './helpers/cli.js';

/**
 * A tab of the user's own, in a project that is not the fleet's, shaped the way
 * `terminal create` answers. It holds no Run.
 */
async function ownTab(box) {
  const own = {
    handle: 'term_own',
    tabId: 'tab_own',
    paneKey: 'tab_own:leaf_own',
    ptyId: 'repo_own::/Users/someone/elsewhere@@000000ff',
    leafId: 'leaf_own',
    worktreeId: 'repo_own::/Users/someone/elsewhere',
    worktreePath: '/Users/someone/elsewhere',
    title: 'my own work',
    agentIdentity: null,
    typed: [],
  };
  await box.orca.set({ terminals: [...await box.orca.terminals(), own] });
  return own;
}

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

/** The fake Orca's terminal for one session's tab, as the book names it. */
async function tabOf(box, bots, bot, session = 'daily') {
  const { tab } = await sessionIn(bots, bot, session);
  const terminal = (await box.orca.terminals()).find((entry) => entry.tabId === tab);
  assert.ok(terminal !== undefined, `the book says ${bot}/${session} lives in ${tab}, and Orca has no such tab`);
  return terminal;
}

/** Orca's record of the Run that is one session's mailbox. */
async function mailboxOf(box, bots, bot, session = 'daily') {
  const { mailbox } = await sessionIn(bots, bot, session);
  assert.ok(typeof mailbox === 'string' && mailbox !== '', `${bot}/${session} should have a mailbox, got: ${mailbox}`);
  const run = (await box.orca.runs()).find((entry) => entry.id === mailbox);
  assert.ok(run !== undefined, `the book names ${mailbox} for ${bot}/${session}, and Orca never made it`);
  return run;
}

/** Orca's own notices in a terminal, now: never the kit's lines. */
const noticesIn = async (box, handle) => (await box.orca.terminals()).find((entry) => entry.handle === handle).notices ?? [];

/** Mail from Bot Father's session to `to`, sent from inside `terminal`. */
const mail = (box, terminal, to, subject) => obkIn(box, terminal, [
  'message', 'send', '--bots', 'bots', '--to', to, '--from', 'bot-father/daily',
  '--subject', subject, '--text', 'Please look at the staging host.',
]);

/** `obk message check` of coder's mail by name. */
const checkCoder = (flags = []) => ['message', 'check', '--bots', 'bots', '--bot', 'coder', '--session', 'daily', ...flags];

/**
 * A fleet brought up from Bot Father's tab, with coder running a conversation
 * the book knows and then paused from Bot Father's tab: coder's tab is closed,
 * and its Run still names that closed tab as its coordinator, as Orca leaves it.
 */
async function pausedCoder(box) {
  const own = await ownTab(box);
  await obkIn(box, own, ['init', '--bots', 'bots', '--harness', 'claude']);
  const bots = box.path('bots');
  const a = await tabOf(box, bots, 'bot-father');
  await obkIn(box, a, ['bot', 'create', '--bots', 'bots', '--name', 'coder', '--harness', 'codex']);
  await obkIn(box, a, ['session', 'add', '--bots', 'bots', '--bot', 'coder', '--name', 'daily']);
  await obkIn(box, a, ['up', '--bots', 'bots', '--bot', 'coder']);
  const old = await tabOf(box, bots, 'coder');
  // A pause closes a tab only when the book can bring its conversation back.
  const hooked = await recordSession(box, { bots, bot: 'coder', tab: old.tabId, session: 'sess-1' });
  assert.equal(hooked.code, 0, hooked.stderr);
  assert.equal((await mailboxOf(box, bots, 'coder')).coordinator_handle, old.handle, 'coder\'s Run starts in its own tab');
  assert.equal((await mailboxOf(box, bots, 'bot-father')).coordinator_handle, a.handle, 'and Bot Father\'s in its own');

  await obkIn(box, a, ['pause', '--bots', 'bots', '--bot', 'coder']);

  assert.ok(
    !(await box.orca.terminals()).some((terminal) => terminal.handle === old.handle),
    'the pause this test stands on should have closed coder\'s tab',
  );
  assert.equal(
    (await mailboxOf(box, bots, 'coder')).coordinator_handle,
    old.handle,
    'a closed tab stays its Run\'s coordinator',
  );
  const botFather = (await sessionIn(bots, 'bot-father', 'daily')).mailbox;
  return { own, bots, a, old, mailbox: (await sessionIn(bots, 'coder', 'daily')).mailbox, botFather };
}

/**
 * Assert the read moved nothing: coder's Run is coordinated by what it was
 * before (`coordinator`), Bot Father's by its own tab, and the reader's tab
 * coordinates its own Run, if it has one, and no other.
 */
async function assertNothingMoved(box, fleet, reader, coordinator) {
  const coder = await mailboxOf(box, fleet.bots, 'coder');
  assert.equal(
    coder.coordinator_handle,
    coordinator,
    `coder's mailbox ${coder.id} should be coordinated by ${coordinator} as before the read, `
      + `got ${coder.coordinator_handle}${reader === null ? '' : ` (the reader's tab is ${reader.handle})`}`,
  );
  const botFather = await mailboxOf(box, fleet.bots, 'bot-father');
  assert.equal(
    botFather.coordinator_handle,
    fleet.a.handle,
    `Bot Father's own mailbox ${botFather.id} should still be coordinated by its tab ${fleet.a.handle}, `
      + `got ${botFather.coordinator_handle}`,
  );
  if (reader === null) return;
  const own = reader.handle === fleet.a.handle ? [fleet.botFather] : [];
  assert.deepEqual(
    (await box.orca.runs()).filter((run) => run.coordinator_handle === reader.handle).map((run) => run.id),
    own,
    `the reader's tab (${reader.title}) coordinates its own Run, if it has one, and no other`,
  );
}

/** Who reads coder's mail: Bot Father's tab, a tab of the user's own that holds no Run, or a plain shell. */
const botFathers = ['from Bot Father\'s tab', (fleet) => fleet.a];
const users = ['from a tab of the user\'s own that holds no Run', (fleet) => fleet.own];
const shell = ['from a plain shell with no Orca terminal', () => null];
const readers = [botFathers, users, shell];

const ways = [
  ['a plain check', [], true],
  ['a peek', ['--peek'], false],
];

// Checks 1 and 2 of the issue: the read works, and moves nothing. Each is run
// as a plain check, which takes the mail, and as a peek, which leaves it.
for (const [where, readerOf] of readers) {
  for (const [how, flags, takes] of ways) {
    test(`#249 checks 1-2: ${how} of a paused session's mail ${where} reads it and moves no mailbox`, async (t) => {
      const box = await createSandbox(t);
      const fleet = await pausedCoder(box);
      const reader = readerOf(fleet);
      await mail(box, fleet.a, 'coder', 'while you were away');

      const read = await obkIn(box, reader, checkCoder(flags));

      assert.ok(read.stdout.includes('while you were away'), `the check reads coder's mail, got: ${read.stdout}`);
      assert.deepEqual(
        (await box.orca.messages()).map((message) => message.acked),
        [takes],
        takes ? 'a plain check takes the mail' : 'a peek leaves the mail where it was',
      );
      await assertNothingMoved(box, fleet, reader, fleet.old.handle);
    });
  }
}

// Check 3: when the session is back, its mailbox is in its new tab, and the
// reader's tab hears nothing about the session's mail.
for (const [where, readerOf] of [botFathers, shell]) {
  test(`#249 check 3: after a read ${where}, unpause binds the session's mailbox to its new tab and only it is told`, async (t) => {
    const box = await createSandbox(t);
    const fleet = await pausedCoder(box);
    const reader = readerOf(fleet);
    await mail(box, fleet.a, 'coder', 'while you were away');
    await obkIn(box, reader, checkCoder());

    await obkIn(box, fleet.a, ['unpause', '--bots', 'bots', '--bot', 'coder']);

    const now = await tabOf(box, fleet.bots, 'coder');
    assert.notEqual(now.handle, fleet.old.handle, 'the session should be in a new tab');
    assert.equal((await sessionIn(fleet.bots, 'coder', 'daily')).mailbox, fleet.mailbox, 'it keeps the mailbox it had');
    assert.equal(
      (await mailboxOf(box, fleet.bots, 'coder')).coordinator_handle,
      now.handle,
      'coder\'s mailbox is coordinated by its own new tab',
    );
    assert.equal(
      (await mailboxOf(box, fleet.bots, 'bot-father')).coordinator_handle,
      fleet.a.handle,
      'and Bot Father\'s is still coordinated by Bot Father\'s tab',
    );

    await mail(box, fleet.a, 'coder', 'now that you are back');

    const told = await noticesIn(box, now.handle);
    assert.equal(told.length, 1, `the new tab is told about coder's mail, got: ${JSON.stringify(told)}`);
    assert.ok(told[0].includes(fleet.mailbox), `naming coder's mailbox ${fleet.mailbox}, got: ${told[0]}`);
    for (const terminal of await box.orca.terminals()) {
      if (terminal.handle === now.handle) continue;
      assert.deepEqual(terminal.notices ?? [], [], `${terminal.title} must not be told about coder's mail`);
    }
  });
}

// Check 4: a Run nobody coordinates. It happens when the tab that coordinated
// it was bound to another Run. Orca has no reader to read it as, and a check
// must not make one by binding a tab to it. Whether the mail can be read then
// is not asked; if it is not, the check must not say nothing is waiting.
for (const [where, readerOf] of [botFathers, shell]) {
  test(`#249 check 4: a paused session whose mailbox has no coordinator, checked ${where}, is given none`, async (t) => {
    const box = await createSandbox(t);
    const fleet = await pausedCoder(box);
    const reader = readerOf(fleet);
    const state = await box.orca.state();
    await box.orca.set({
      runs: state.runs.map((run) => (run.id === fleet.mailbox ? { ...run, coordinator_handle: null } : run)),
    });
    await mail(box, fleet.a, 'coder', 'nobody is listening');

    const result = await obkFrom(box, reader, checkCoder());

    await assertNothingMoved(box, fleet, reader, null);
    const shown = result.stdout.includes('nobody is listening');
    const [message] = await box.orca.messages();
    if (!shown) {
      assert.equal(message.acked, false, 'mail the check did not show is still waiting, not taken');
      assert.ok(
        result.code !== 0 || !/nothing is waiting/i.test(result.stdout),
        `the mail is waiting, so the check must not say nothing is, got (exit ${result.code}): ${result.stdout}${result.stderr}`,
      );
    }
  });
}

test('#249 check 5: every Orca call a read of a paused session\'s mail makes is one of the allowed ones', async (t) => {
  const box = await createSandbox(t);
  const fleet = await pausedCoder(box);
  await mail(box, fleet.a, 'coder', 'first');
  await mail(box, fleet.a, 'coder', 'second');
  const from = (await box.orca.calls()).length;

  // Every road a read can take, whether or not it works: the pause before it
  // closed a tab, which is the pause's business and not the check's.
  await obkFrom(box, fleet.a, checkCoder(['--peek']));
  await obkFrom(box, fleet.a, checkCoder());
  await obkFrom(box, fleet.own, checkCoder());
  await obkFrom(box, null, checkCoder(['--peek']));
  await obkFrom(box, null, checkCoder());

  const calls = (await box.orca.calls()).slice(from);
  assert.ok(calls.length > 0, 'the checks should have asked Orca something');
  assertOrcaCallsAllowed(calls);
});
