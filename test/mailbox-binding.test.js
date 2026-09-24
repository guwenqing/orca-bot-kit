// A session's mailbox is bound to that session's own tab, and to no other
// (issue #228).
//
// A mailbox is an Orca Run, and Orca binds every Run to one coordinator
// terminal. That terminal is the only place Orca writes its own notice when
// mail arrives: "You have N orchestration message. Run `orca orchestration
// check --run <id>`". Proved live on Orca 1.4.209:
//
//   - `run-create` and `run-use` bind the caller's own terminal, or the one
//     `--from <handle>` names instead, leaving the caller's own binding alone.
//   - One terminal holds one Run. Binding it to a second Run leaves the first
//     with no coordinator, and a Run with no coordinator gives no notice at all.
//   - A caller with no Orca terminal that names none is refused.
//
// The kit used to make each Run from whatever terminal ran `obk up`, so the
// Run's coordinator was that terminal, often Bot Father's tab, and the notices
// for a whole fleet's mail landed there. Only the addressed session should be
// told about its mail. The kit's own nudge line, typed into the session's tab,
// goes on as it did.
//
// The fake Orca keeps each Run's coordinator and each terminal's notices (see
// helpers/fake-orca.js). "Tab A" below is a terminal in that world, and a run
// of `obk` "in" it carries its `ORCA_TERMINAL_HANDLE` and `ORCA_TAB_ID`, the
// way Orca sets them in every pane.

import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';
import { stringify } from 'yaml';

import {
  assertOrcaCallsAllowed,
  bookIn,
  bookOf,
  createSandbox,
  recordSession,
  sessionIn,
  typedInto,
} from './helpers/cli.js';

/**
 * A tab of the user's own, in a project that is not the fleet's: the tab they
 * happened to run `obk` from. It is shaped the way `terminal create` answers,
 * so nothing about it tells the kit it was put there by a test.
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

/** Run `obk <args>` inside `terminal`, or from a plain shell outside Orca when it is null, and insist it worked. */
async function obkIn(box, terminal, args) {
  const result = await box.run(args, terminal === null ? {} : { env: inTab(box, terminal) });
  assert.equal(result.code, 0, `obk ${args.join(' ')} should have worked:\n${result.stdout}${result.stderr}`);
  return result;
}

/** A bots folder, made from inside `terminal`: Bot Father is brought up by `init`. */
async function initIn(box, terminal) {
  await obkIn(box, terminal, ['init', '--bots', 'bots', '--harness', 'claude']);
  return box.path('bots');
}

/** A bot and its sessions in the book, none of them brought up yet. */
async function addBot(box, terminal, bot, harness, sessions = ['daily']) {
  await obkIn(box, terminal, ['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness]);
  for (const session of sessions) {
    await obkIn(box, terminal, ['session', 'add', '--bots', 'bots', '--bot', bot, '--name', session]);
  }
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

/** What the kit typed into a session's tab after the launch line `up` gave it. */
const typedSinceLaunch = (terminal) => typedInto(terminal).slice(1);

/** Assert one session's mailbox is coordinated by that session's own tab. */
async function assertBoundToItsOwnTab(box, bots, bot, session = 'daily') {
  const run = await mailboxOf(box, bots, bot, session);
  const own = await tabOf(box, bots, bot, session);
  assert.equal(
    run.coordinator_handle,
    own.handle,
    `${bot}/${session}'s mailbox ${run.id} should be bound to its own tab ${own.handle} (${own.title}), `
      + `got ${run.coordinator_handle}`,
  );
}

/** Mail from Bot Father's session to `to`, sent from inside `terminal`. */
const mail = (box, terminal, to, subject) => obkIn(box, terminal, [
  'message', 'send', '--bots', 'bots', '--to', to, '--from', 'bot-father/daily',
  '--subject', subject, '--text', 'Please look at the staging host.',
]);

test('#228 check 1: a session brought up from tab A is told about its mail, and tab A is not', async (t) => {
  // The issue's first check. Tab A is the user's own, outside the fleet; the
  // session has never checked its mail, so nothing but `up` has bound its Run.
  const box = await createSandbox(t);
  const a = await ownTab(box);
  const bots = await initIn(box, a);
  await addBot(box, a, 'coder', 'codex');
  await obkIn(box, a, ['up', '--bots', 'bots', '--bot', 'coder']);

  await mail(box, a, 'coder', 'the staging host');

  const coder = await tabOf(box, bots, 'coder');
  const { mailbox } = await sessionIn(bots, 'coder', 'daily');
  assert.deepEqual(await noticesIn(box, a.handle), [], 'tab A ran `obk up` and is nobody\'s mailbox: Orca must tell it nothing');
  const told = await noticesIn(box, coder.handle);
  assert.equal(told.length, 1, `Orca's notice belongs in the session's own tab, got: ${JSON.stringify(told)}`);
  assert.ok(told[0].includes(mailbox), `and it names the session's own mailbox ${mailbox}, got: ${told[0]}`);
  const nudged = typedSinceLaunch(coder);
  assert.equal(nudged.length, 1, `and the kit's own line goes on as it did, got: ${JSON.stringify(nudged)}`);
  assert.ok(nudged[0].includes('obk message check'), `the kit's line, not Orca's, got: ${nudged[0]}`);
});

test('#228 check 2: two sessions brought up in one run from tab A are each told about their own mail only', async (t) => {
  // One `up`, two Runs. Made from one terminal the second takes that terminal
  // off the first, so the first is left with no coordinator at all and its
  // mail gives no notice anywhere, while the second's lands in tab A.
  const box = await createSandbox(t);
  const a = await ownTab(box);
  const bots = await initIn(box, a);
  await addBot(box, a, 'coder', 'codex', ['daily', 'night']);
  await obkIn(box, a, ['up', '--bots', 'bots', '--bot', 'coder']);

  await mail(box, a, 'coder/daily', 'for the day');
  await mail(box, a, 'coder/night', 'for the night');

  assert.deepEqual(await noticesIn(box, a.handle), [], 'tab A must be told about neither');
  for (const session of ['daily', 'night']) {
    const own = await tabOf(box, bots, 'coder', session);
    const { mailbox } = await sessionIn(bots, 'coder', session);
    const told = await noticesIn(box, own.handle);
    assert.equal(told.length, 1, `coder/${session} gets one notice, for its own mail only, got: ${JSON.stringify(told)}`);
    assert.ok(told[0].includes(mailbox), `naming its own mailbox ${mailbox}, got: ${told[0]}`);
    assert.equal(typedSinceLaunch(own).length, 1, `and one line from the kit, got: ${JSON.stringify(typedSinceLaunch(own))}`);
  }
});

test('#228 check 3: a session that brings another up from its own tab keeps its own mailbox bound there', async (t) => {
  // Tab A is Bot Father's own session tab, which is where a fleet is usually
  // brought up from. One terminal holds one Run, so a Run the kit made there,
  // even for a moment, would take tab A off Bot Father's own mailbox.
  const box = await createSandbox(t);
  const bots = await initIn(box, await ownTab(box));
  const a = await tabOf(box, bots, 'bot-father');
  await addBot(box, a, 'coder', 'codex');

  await obkIn(box, a, ['up', '--bots', 'bots', '--bot', 'coder']);

  await assertBoundToItsOwnTab(box, bots, 'bot-father');
  await assertBoundToItsOwnTab(box, bots, 'coder');
});

test('#228 check 3: and that session still sends and checks its own mail from its own tab', async (t) => {
  const box = await createSandbox(t);
  const bots = await initIn(box, await ownTab(box));
  const a = await tabOf(box, bots, 'bot-father');
  await addBot(box, a, 'coder', 'codex');
  await obkIn(box, a, ['up', '--bots', 'bots', '--bot', 'coder']);
  const { mailbox } = await sessionIn(bots, 'bot-father', 'daily');

  // Mail for Bot Father, from the session it just brought up.
  await obkIn(box, null, [
    'message', 'send', '--bots', 'bots', '--to', 'bot-father', '--from', 'coder/daily',
    '--subject', 'up and running', '--text', 'The coder is ready.',
  ]);
  const told = await noticesIn(box, a.handle);
  assert.equal(told.length, 1, `Bot Father's own mail is told in its own tab, got: ${JSON.stringify(told)}`);
  assert.ok(told[0].includes(mailbox), `naming its own mailbox ${mailbox}, got: ${told[0]}`);

  // It reads it from its own tab, naming nobody, and writes back the same way.
  const read = await obkIn(box, a, ['message', 'check', '--bots', 'bots']);
  assert.ok(read.stdout.includes('up and running'), `it reads its own mail, got: ${read.stdout}`);
  await obkIn(box, a, ['message', 'send', '--bots', 'bots', '--to', 'coder', '--subject', 'thanks', '--text', 'Noted.']);
  const sent = (await box.orca.messages()).find((message) => message.subject === 'thanks');
  assert.equal(sent.from, `run:${mailbox}`, `and it writes from its own mailbox, got: ${JSON.stringify(sent)}`);

  await assertBoundToItsOwnTab(box, bots, 'bot-father');
  await assertBoundToItsOwnTab(box, bots, 'coder');
});

test('#228 check 4: no Run of another session names tab A as its coordinator, across a whole fleet', async (t) => {
  // A fleet brought up from Bot Father's tab: two bots on both harnesses, one
  // of them with two sessions. Every mailbox in every book is coordinated by
  // the tab the same book names for that session, and tab A coordinates its
  // own session's Run and nothing else.
  const box = await createSandbox(t);
  const bots = await initIn(box, await ownTab(box));
  const a = await tabOf(box, bots, 'bot-father');
  await addBot(box, a, 'writer', 'claude');
  await addBot(box, a, 'coder', 'codex', ['daily', 'night']);

  await obkIn(box, a, ['up', '--bots', 'bots']);

  const sessions = [['bot-father', 'daily'], ['writer', 'daily'], ['coder', 'daily'], ['coder', 'night']];
  for (const [bot, session] of sessions) await assertBoundToItsOwnTab(box, bots, bot, session);
  const own = (await sessionIn(bots, 'bot-father', 'daily')).mailbox;
  assert.deepEqual(
    (await box.orca.runs()).filter((run) => run.coordinator_handle === a.handle).map((run) => run.id),
    [own],
    'tab A coordinates Bot Father\'s own mailbox and no other',
  );
});

test('#228 check 4: a session checked by name from tab A keeps its mailbox bound to its own tab', async (t) => {
  // A check binds before it reads. Run from a tab that is not the session's,
  // binding the caller would hand that tab the session's mailbox, and every
  // notice after it. Whether such a check reads the mail is not this test's
  // business; where the Run is bound afterwards is.
  //
  // The session reads once from its own tab first, so its Run is bound there
  // whatever `up` did, and only the check from tab A can move it.
  const box = await createSandbox(t);
  const a = await ownTab(box);
  const bots = await initIn(box, a);
  await addBot(box, a, 'coder', 'codex');
  await obkIn(box, a, ['up', '--bots', 'bots', '--bot', 'coder']);
  await obkIn(box, await tabOf(box, bots, 'coder'), ['message', 'check', '--bots', 'bots']);
  await assertBoundToItsOwnTab(box, bots, 'coder');
  await mail(box, a, 'coder', 'the staging host');

  await box.run(['message', 'check', '--bots', 'bots', '--bot', 'coder', '--session', 'daily'], { env: inTab(box, a) });

  await assertBoundToItsOwnTab(box, bots, 'coder');
});

test('#228 check 4: Bot Father reads another session\'s mail by name from its own tab, and neither mailbox moves', async (t) => {
  // Bot Father's tab holds Bot Father's own Run, so reading coder's Run as
  // itself is fenced, and binding it to coder's Run would take it off its
  // own. Orca 1.4.209 reads as the terminal `check --terminal` names, which
  // is how this can work and leave both bindings where they are.
  //
  // Coder reads once from its own tab first, so its Run is bound there
  // whatever `up` did, and only the check from Bot Father's tab can move it.
  const box = await createSandbox(t);
  const bots = await initIn(box, await ownTab(box));
  const a = await tabOf(box, bots, 'bot-father');
  await addBot(box, a, 'coder', 'codex');
  await obkIn(box, a, ['up', '--bots', 'bots', '--bot', 'coder']);
  await obkIn(box, await tabOf(box, bots, 'coder'), ['message', 'check', '--bots', 'bots']);
  await assertBoundToItsOwnTab(box, bots, 'coder');
  await mail(box, a, 'coder', 'the staging host');

  const read = await obkIn(box, a, ['message', 'check', '--bots', 'bots', '--bot', 'coder', '--session', 'daily']);

  assert.ok(read.stdout.includes('the staging host'), `the check reads coder's mail, got: ${read.stdout}`);
  assert.deepEqual((await box.orca.messages()).map((message) => message.acked), [true], 'and takes it');
  await assertBoundToItsOwnTab(box, bots, 'coder');
  await assertBoundToItsOwnTab(box, bots, 'bot-father');
});

test('#228: a session already running with no mailbox is given one at the next up, bound to its own tab', async (t) => {
  // A book written before mailboxes existed, or by hand: the tab is live and
  // in the book, the mailbox is not. This `up` opens no tab and types no launch
  // line; it has to find the session's terminal among the ones Orca already has.
  const box = await createSandbox(t);
  const a = await ownTab(box);
  const bots = await initIn(box, a);
  await addBot(box, a, 'coder', 'codex');
  await obkIn(box, a, ['up', '--bots', 'bots', '--bot', 'coder']);
  const book = await bookIn(bots, 'coder');
  delete book.sessions.daily.mailbox;
  await writeFile(bookOf(bots, 'coder'), stringify(book));
  const tabs = (await box.orca.terminals()).length;

  await obkIn(box, a, ['up', '--bots', 'bots', '--bot', 'coder']);

  assert.equal((await box.orca.terminals()).length, tabs, 'the session was running already: no tab is opened for it');
  await assertBoundToItsOwnTab(box, bots, 'coder');
});

test('#228: up from a plain shell with no Orca terminal binds each Run to its session\'s tab', async (t) => {
  // No `ORCA_TERMINAL_HANDLE` at all: a terminal outside Orca, or a script.
  // Orca 1.4.209 refuses a Run made from there unless it is told which
  // terminal to bind, and the only right answer is the session's own.
  const box = await createSandbox(t);
  const bots = await initIn(box, await ownTab(box));
  await addBot(box, null, 'coder', 'codex', ['daily', 'night']);

  await obkIn(box, null, ['up', '--bots', 'bots', '--bot', 'coder']);

  await assertBoundToItsOwnTab(box, bots, 'coder', 'daily');
  await assertBoundToItsOwnTab(box, bots, 'coder', 'night');
});

test('#228: init from a plain shell gives Bot Father a mailbox bound to its own tab', async (t) => {
  // `init` brings Bot Father up, and that is an `up` like any other: the first
  // one a new user ever runs, and often from a terminal outside Orca.
  const box = await createSandbox(t);

  const bots = await initIn(box, null);

  await assertBoundToItsOwnTab(box, bots, 'bot-father');
});

// A session that already has a mailbox and is given a new tab: by `restart`,
// which closes its tab and brings it up again, or by `up` after its tab was
// closed. The mailbox is the same Run, kept for ever (a Run cannot be
// deleted), so it has to follow the session into the new tab. Left where it
// was, it is coordinated by a tab that is gone, and Orca's notice for the
// session's mail goes nowhere, or anywhere but its tab. Whether Orca clears a
// closed tab's binding was not measured, so the closed-tab road is run both
// ways: the dead handle left on the Run, and the Run left with none.

/** Up from Bot Father's tab: the fleet a restart or a reopen starts from. */
async function coderUpFromBotFather(box) {
  const own = await ownTab(box);
  const bots = await initIn(box, own);
  const a = await tabOf(box, bots, 'bot-father');
  await addBot(box, a, 'coder', 'codex');
  await obkIn(box, a, ['up', '--bots', 'bots', '--bot', 'coder']);
  const old = await tabOf(box, bots, 'coder');
  const { mailbox } = await sessionIn(bots, 'coder', 'daily');
  return { own, bots, a, old, mailbox, runs: (await box.orca.runs()).length };
}

/** Assert the session's mailbox moved to its new tab, and nothing else moved or was made. */
async function assertFollowedToTheNewTab(box, { bots, old, mailbox, runs }, caller, ownRun) {
  const now = await tabOf(box, bots, 'coder');
  assert.notEqual(now.handle, old.handle, 'the session should be in a new tab');
  assert.equal((await sessionIn(bots, 'coder', 'daily')).mailbox, mailbox, 'it keeps the mailbox it had');
  assert.equal((await box.orca.runs()).length, runs, 'and no new Run is made for it');
  await assertBoundToItsOwnTab(box, bots, 'coder');
  assert.deepEqual(
    (await box.orca.runs()).filter((run) => run.coordinator_handle === caller.handle).map((run) => run.id),
    ownRun === undefined ? [] : [ownRun],
    `the tab the command ran in (${caller.title}) coordinates its own Run, if it has one, and no other`,
  );

  // Mail for the session afterwards is told in the new tab and nowhere else.
  await mail(box, caller, 'coder', 'after the new tab');
  const told = await noticesIn(box, now.handle);
  assert.equal(told.length, 1, `the new tab is told about the session's mail, got: ${JSON.stringify(told)}`);
  assert.ok(told[0].includes(mailbox), `naming its mailbox ${mailbox}, got: ${told[0]}`);
  for (const terminal of await box.orca.terminals()) {
    if (terminal.handle === now.handle) continue;
    assert.deepEqual(terminal.notices ?? [], [], `${terminal.title} must not be told about coder's mail`);
  }
}

test('#228 review: restart from Bot Father\'s tab binds the session\'s mailbox to its new tab', async (t) => {
  const box = await createSandbox(t);
  const fleet = await coderUpFromBotFather(box);
  // Restart closes a tab only when it can bring the conversation back.
  const hooked = await recordSession(box, { bots: fleet.bots, bot: 'coder', tab: fleet.old.tabId, session: 'sess-1' });
  assert.equal(hooked.code, 0, hooked.stderr);

  await obkIn(box, fleet.a, ['restart', '--bots', 'bots', '--bot', 'coder']);

  const botFather = (await sessionIn(fleet.bots, 'bot-father', 'daily')).mailbox;
  await assertFollowedToTheNewTab(box, fleet, fleet.a, botFather);
  await assertBoundToItsOwnTab(box, fleet.bots, 'bot-father');
});

for (const [closed, leftOnTheRun] of [
  ['the closed tab\'s handle left on the Run', (handle) => handle],
  ['the Run left with no coordinator', () => null],
]) {
  test(`#228 review: up from a tab of the user's own reopens a closed session tab and binds its mailbox there (${closed})`, async (t) => {
    const box = await createSandbox(t);
    const fleet = await coderUpFromBotFather(box);
    // The user closed the session's tab. What Orca does to the Run's binding
    // then was not measured; both answers are given here.
    const state = await box.orca.state();
    await box.orca.set({
      terminals: state.terminals.filter((terminal) => terminal.handle !== fleet.old.handle),
      runs: state.runs.map((run) => (run.id === fleet.mailbox
        ? { ...run, coordinator_handle: leftOnTheRun(fleet.old.handle) }
        : run)),
    });

    await obkIn(box, fleet.own, ['up', '--bots', 'bots', '--bot', 'coder']);

    await assertFollowedToTheNewTab(box, fleet, fleet.own, undefined);
    await assertBoundToItsOwnTab(box, fleet.bots, 'bot-father');
  });
}

test('#228: every Orca call a fleet brought up from tab A makes is one of the allowed ones', async (t) => {
  const box = await createSandbox(t);
  const bots = await initIn(box, await ownTab(box));
  const a = await tabOf(box, bots, 'bot-father');
  await addBot(box, a, 'coder', 'codex', ['daily', 'night']);
  await obkIn(box, a, ['up', '--bots', 'bots']);
  await mail(box, a, 'coder/night', 'hello');
  await obkIn(box, a, ['message', 'check', '--bots', 'bots']);

  assertOrcaCallsAllowed(await box.orca.calls());
});
