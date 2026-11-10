// A session's mailbox on Orca 1.4.255 and on Orca 1.4.245 (#729).
//
// Orca 1.4.246 prints a short answer for each orchestration command unless
// `--full` is given: `run-create` answers `{ runId, objective }`, with no
// `run`, and `run-show` gives no `coordinator_handle`. The kit read `.run.id`,
// so on the owner's 1.4.255 a new session got no mailbox ("Cannot read
// properties of undefined (reading 'id')"). Orca 1.4.245 and older know no
// `--full` but on `inbox`, and refuse it with nothing done. The fake models
// both (helpers/fake-orca.js, `orcaVersion`; helpers/orca-versions.js).
//
// What is pinned, on each of the two:
//
//   1. `obk up` of a session with no mailbox makes one: the book gets its
//      `mailbox`, a Run Orca has, bound to the session's own tab, and Orca
//      took exactly one `run-create` from that tab. `obk session mailbox`
//      run in the session's tab does the same.
//   2. A session that has its mailbox keeps it through `obk restart` and
//      through `obk up` of a session whose tab is gone: the same Run in the
//      book, bound to the new tab, and no `run-create`. A book that names a
//      Run this Orca does not have gets a new one in the step (#508), with
//      one `run-create`.
//   6. `obk message check` of a paused session, from a plain shell, reads its
//      mail as the closed tab its mailbox is bound to (Orca's `run-show`
//      `coordinator_handle`), and moves nothing.
//
// Each fleet is made on the fake as it always answered, and the Orca under
// test is put in place just before the command the test is about: mailboxes
// made before an Orca update, as on the owner's machine.

import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';
import { stringify } from 'yaml';

import {
  assertOrcaCallsAllowed,
  bookIn,
  bookOf,
  createSandbox,
  mailboxStep,
  recordSession,
  sessionIn,
  sh,
} from './helpers/cli.js';
import { modelOrca, ORCA_MODELS, shownCalls, takenCallsOf } from './helpers/orca-versions.js';

/** Run `obk <args>` from a plain shell and insist it worked. */
async function ok(box, args, options) {
  const result = await box.run(args, options);
  assert.equal(result.code, 0, `obk ${args.join(' ')} should have worked:\n${result.stdout}${result.stderr}`);
  return result;
}

/** Bot Father up, and coder, a Codex bot with one session, daily, not brought up yet. */
async function fleet(box) {
  await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);
  const bots = box.path('bots');
  await ok(box, ['bot', 'create', '--bots', bots, '--name', 'coder', '--harness', 'codex']);
  await ok(box, ['session', 'add', '--bots', bots, '--bot', 'coder', '--name', 'daily']);
  return bots;
}

/** The fake Orca's terminal for one session's tab, as the book names it. */
async function tabOf(box, bots, bot, session = 'daily') {
  const { tab } = await sessionIn(bots, bot, session);
  const terminal = (await box.orca.terminals()).find((entry) => entry.tabId === tab);
  assert.ok(terminal !== undefined, `the book says ${bot}/${session} lives in ${tab}, and Orca has no such tab`);
  return terminal;
}

/** Orca's record of the Run the book names as one session's mailbox. */
async function mailboxOf(box, bots, bot, session = 'daily') {
  const { mailbox } = await sessionIn(bots, bot, session);
  assert.ok(typeof mailbox === 'string' && mailbox !== '', `${bot}/${session} should have a mailbox in its book, got: ${mailbox}`);
  const run = (await box.orca.runs()).find((entry) => entry.id === mailbox);
  assert.ok(run !== undefined, `the book names ${mailbox} for ${bot}/${session}, and Orca never made it`);
  return run;
}

/** Take a session's mailbox out of its book, as a session made on a broken Orca is left. */
async function forgetMailbox(bots, bot, session) {
  const book = await bookIn(bots, bot);
  delete book.sessions[session].mailbox;
  await writeFile(bookOf(bots, bot), stringify(book));
}

/** The calls made since the first `from` of them. */
const callsSince = async (box, from) => (await box.orca.calls()).slice(from);

/** The steps the fake ran in a tab, from its launch line. */
const stepsIn = async (box, handle) => (await box.orca.steps()).filter((step) => step.handle === handle);

/** The environment of a command run inside `terminal`, as Orca sets it in every pane. */
const inTab = (box, terminal) => ({ ...box.env, ORCA_TERMINAL_HANDLE: terminal.handle, ORCA_TAB_ID: terminal.tabId });

for (const version of ORCA_MODELS) {
  test(`#729 1 on Orca ${version}: up of a session with no mailbox makes one, bound to its own tab, with one run-create`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    const from = (await box.orca.calls()).length;
    await modelOrca(box, version);

    const up = await ok(box, ['up', '--bots', 'bots', '--bot', 'coder', '--json']);

    const coder = await tabOf(box, bots, 'coder');
    const steps = await stepsIn(box, coder.handle);
    assert.equal(steps.length, 1, `the launch line's mailbox step ran in coder's tab, got: ${JSON.stringify(steps)}`);
    assert.equal(steps[0].status, 0, `and worked, got:\n${steps[0].stdout}${steps[0].stderr}`);
    const run = await mailboxOf(box, bots, 'coder');
    assert.equal(run.coordinator_handle, coder.handle, `the new mailbox is bound to coder's own tab, got ${run.coordinator_handle}`);
    const entry = JSON.parse(up.stdout).tabs.find((tab) => tab.bot === 'coder' && tab.name === 'daily');
    assert.notEqual(entry?.noMailbox, true, `up does not say coder/daily came up without a mailbox, got: ${up.stdout}`);
    const calls = await callsSince(box, from);
    const made = takenCallsOf(version, calls, 'orchestration run-create').filter((call) => call.caller === coder.handle);
    assert.equal(made.length, 1, `Orca made exactly one Run for coder/daily, got:\n${shownCalls(made)}`);
    assertOrcaCallsAllowed(calls);
  });

  test(`#729 1 on Orca ${version}: session mailbox in the session's own tab makes the mailbox its book lacks, with one run-create`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await ok(box, ['up', '--bots', 'bots', '--bot', 'coder']);
    const coder = await tabOf(box, bots, 'coder');
    const before = new Set((await box.orca.runs()).map((run) => run.id));
    await forgetMailbox(bots, 'coder', 'daily');
    const from = (await box.orca.calls()).length;
    await modelOrca(box, version);

    const ran = await sh(mailboxStep(box, { bot: 'coder', session: 'daily' }), { cwd: box.cwd, env: inTab(box, coder) });

    assert.equal(ran.code, 0, `the step works:\n${ran.stdout}${ran.stderr}`);
    const run = await mailboxOf(box, bots, 'coder');
    assert.ok(!before.has(run.id), `the book names a new Run, got ${run.id}`);
    assert.equal(run.coordinator_handle, coder.handle, 'bound to coder\'s own tab');
    const made = takenCallsOf(version, await callsSince(box, from), 'orchestration run-create');
    assert.equal(made.length, 1, `Orca made exactly one Run, got:\n${shownCalls(made)}`);
  });

  test(`#729 2 on Orca ${version}: restart keeps the session's mailbox, bound to the new tab, and makes none`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await ok(box, ['up', '--bots', 'bots', '--bot', 'coder']);
    const old = await tabOf(box, bots, 'coder');
    const hooked = await recordSession(box, { bots, bot: 'coder', tab: old.tabId, session: 'sess-1' });
    assert.equal(hooked.code, 0, hooked.stderr);
    const { mailbox } = await sessionIn(bots, 'coder', 'daily');
    const from = (await box.orca.calls()).length;
    await modelOrca(box, version);

    await ok(box, ['restart', '--bots', 'bots', '--bot', 'coder', '--session', 'daily']);

    const now = await tabOf(box, bots, 'coder');
    assert.notEqual(now.handle, old.handle, 'the premise: restart opened a new tab');
    const steps = await stepsIn(box, now.handle);
    assert.equal(steps.length, 1, `the mailbox step ran in the new tab, got: ${JSON.stringify(steps)}`);
    assert.equal(steps[0].status, 0, `and worked, got:\n${steps[0].stdout}${steps[0].stderr}`);
    assert.equal((await sessionIn(bots, 'coder', 'daily')).mailbox, mailbox, 'the book keeps the mailbox it had');
    assert.equal((await mailboxOf(box, bots, 'coder')).coordinator_handle, now.handle, 'and it is bound to the new tab');
    // A restart closes the old tab, so the rule that a mail command closes
    // none does not apply here.
    assert.deepEqual(takenCallsOf(version, await callsSince(box, from), 'orchestration run-create'), [], 'no new Run was made');
  });

  test(`#729 2 on Orca ${version}: up of a session whose tab is gone keeps its mailbox, bound to the new tab`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await ok(box, ['up', '--bots', 'bots', '--bot', 'coder']);
    const old = await tabOf(box, bots, 'coder');
    const { mailbox } = await sessionIn(bots, 'coder', 'daily');
    // The tab is gone, as after it was closed by hand; Orca keeps its handle as
    // the Run's coordinator.
    const state = await box.orca.state();
    await box.orca.set({
      terminals: state.terminals.filter((terminal) => terminal.handle !== old.handle),
      closedHandles: [...(state.closedHandles ?? []), old.handle],
    });
    const from = (await box.orca.calls()).length;
    await modelOrca(box, version);

    await ok(box, ['up', '--bots', 'bots', '--bot', 'coder']);

    const now = await tabOf(box, bots, 'coder');
    assert.notEqual(now.handle, old.handle, 'the premise: up opened a new tab');
    const steps = await stepsIn(box, now.handle);
    assert.equal(steps.length, 1, `the mailbox step ran in the new tab, got: ${JSON.stringify(steps)}`);
    assert.equal(steps[0].status, 0, `and worked, got:\n${steps[0].stdout}${steps[0].stderr}`);
    assert.equal((await sessionIn(bots, 'coder', 'daily')).mailbox, mailbox, 'the book keeps the mailbox it had');
    assert.equal((await mailboxOf(box, bots, 'coder')).coordinator_handle, now.handle, 'and it is bound to the new tab');
    assert.deepEqual(takenCallsOf(version, await callsSince(box, from), 'orchestration run-create'), [], 'no new Run was made');
  });

  test(`#729 2 on Orca ${version}: a book that names a Run this Orca does not have gets a new mailbox in the session's tab, with one run-create`, async (t) => {
    // The step asks Orca whether the Run is there (`run-show`) and replaces
    // it when Orca has none (#508): on each Orca that answer has to be read.
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await ok(box, ['up', '--bots', 'bots', '--bot', 'coder']);
    const coder = await tabOf(box, bots, 'coder');
    const { mailbox: gone } = await sessionIn(bots, 'coder', 'daily');
    await box.orca.set({ runs: (await box.orca.runs()).filter((run) => run.id !== gone) });
    const from = (await box.orca.calls()).length;
    await modelOrca(box, version);

    const ran = await sh(mailboxStep(box, { bot: 'coder', session: 'daily' }), { cwd: box.cwd, env: inTab(box, coder) });

    assert.equal(ran.code, 0, `the step works:\n${ran.stdout}${ran.stderr}`);
    const run = await mailboxOf(box, bots, 'coder');
    assert.notEqual(run.id, gone, 'the book names a new Run in place of the one Orca does not have');
    assert.equal(run.coordinator_handle, coder.handle, 'bound to coder\'s own tab');
    const made = takenCallsOf(version, await callsSince(box, from), 'orchestration run-create');
    assert.equal(made.length, 1, `Orca made exactly one Run, got:\n${shownCalls(made)}`);
  });

  test(`#729 6 on Orca ${version}: a paused session's mail is read from a plain shell as the closed tab its mailbox is bound to`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await ok(box, ['up', '--bots', 'bots', '--bot', 'coder']);
    const old = await tabOf(box, bots, 'coder');
    // A pause closes a tab only when the book can bring its conversation back.
    const hooked = await recordSession(box, { bots, bot: 'coder', tab: old.tabId, session: 'sess-1' });
    assert.equal(hooked.code, 0, hooked.stderr);
    await ok(box, ['pause', '--bots', 'bots', '--bot', 'coder']);
    assert.ok(
      !(await box.orca.terminals()).some((terminal) => terminal.handle === old.handle),
      'the premise: the pause closed coder\'s tab',
    );
    await ok(box, [
      'message', 'send', '--bots', 'bots', '--to', 'coder', '--from', 'bot-father/daily',
      '--subject', 'while you were away', '--text', 'Please look at the staging host.',
    ]);
    await modelOrca(box, version);

    const read = await ok(box, ['message', 'check', '--bots', 'bots', '--bot', 'coder', '--session', 'daily']);

    assert.ok(read.stdout.includes('while you were away'), `the check reads coder's mail, got: ${read.stdout}`);
    assert.ok(read.stdout.includes('bot-father/daily'), `and says who sent it, got: ${read.stdout}`);
    assert.deepEqual((await box.orca.messages()).map((message) => message.acked), [true], 'the mail was taken');
    assert.equal((await mailboxOf(box, bots, 'coder')).coordinator_handle, old.handle, 'and coder\'s mailbox is bound where it was');
  });
}
