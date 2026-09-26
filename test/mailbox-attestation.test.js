// A session's mailbox is made and bound from inside its own tab (issue #317).
//
// A mailbox is an Orca Run, and Orca binds a Run to one coordinator terminal:
// the only one it tells about the Run's mail, and the only one that may read
// it. Orca 1.4.210 attests every process in a tab as that tab (measured live on
// 2026-09-25): a process in a tab may bind a Run to its own terminal, and a
// `--from` or `--terminal` naming any other terminal is refused
// `consumer_fenced`, with nothing done. So the `obk` that opens a session's tab
// can no longer bind that tab's mailbox, whether it runs in Bot Father's tab,
// a reviewer's tab, or a tab of the user's own.
//
// What the kit does instead, and what these tests hold it to:
//
//   - The launch line typed into a new tab starts with a step of the kit's own,
//     `<cli> session mailbox --bots <bots> --bot <bot> --session <name>;`, which
//     that tab's shell runs before the harness. It makes the session's mailbox
//     from inside the tab when the book has none, and binds the one the book
//     has when it has one. Joined by `;`, so the harness starts either way.
//   - `up`, `init`, `restart` and `unpause` make no Run call of their own, so
//     they work from inside any tab.
//   - When Orca refuses, the step says so in Orca's words and says what it left.
//   - `message check` of a session, from inside another tab, reads nothing and
//     binds nothing, and says so.
//
// The fake Orca keeps 1.4.210's rule, and runs the step of a launch line the
// way the tab's shell would, as that tab (helpers/fake-orca.js, `holdSteps`).
// Where a test needs to see the step on its own, it holds it and runs what was
// typed itself, in the tab's environment. Out of scope: getting past Orca's
// attestation, which the kit must not try.

import assert from 'node:assert/strict';
import { chmod, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import {
  assertOrcaCallsAllowed,
  bareLaunch,
  bookIn,
  bookOf,
  botHomeOf,
  CODEX_NETWORK,
  createSandbox,
  fakeProgram,
  orcaCallsOf,
  orcaFlag,
  recordSession,
  sessionIn,
  sh,
  shellWord,
  tokenless,
  typedInto,
} from './helpers/cli.js';

/**
 * A tab of the user's own, in a project that is not the fleet's: the tab they
 * happened to run `obk` from. Shaped the way `terminal create` answers.
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
  assert.equal(result.code, 0, `obk ${args.join(' ')} should have worked${terminal === null ? '' : ` in ${terminal.title}`}:\n${result.stdout}${result.stderr}`);
  return result;
}

/** A bots folder made from inside `terminal`: `init` brings Bot Father up. */
async function initIn(box, terminal) {
  await obkIn(box, terminal, ['init', '--bots', 'bots', '--harness', 'claude']);
  return box.path('bots');
}

/** A bot and its sessions in the book, none of them brought up yet. */
async function addBot(box, terminal, bot, harness, sessions = [['daily']]) {
  await obkIn(box, terminal, ['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness]);
  for (const [session, ...settings] of sessions) {
    await obkIn(box, terminal, ['session', 'add', '--bots', 'bots', '--bot', bot, '--name', session, ...settings]);
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

/** Assert one session's mailbox is coordinated by that session's own tab. */
async function assertBoundToItsOwnTab(box, bots, bot, session = 'daily') {
  const run = await mailboxOf(box, bots, bot, session);
  const own = await tabOf(box, bots, bot, session);
  assert.equal(
    run.coordinator_handle,
    own.handle,
    `${bot}/${session}'s mailbox ${run.id} should be bound to its own tab ${own.handle} (${own.title}), got ${run.coordinator_handle}`,
  );
}

/** The calls that make or bind a Run, since call number `from`. */
const runCallsSince = async (box, from = 0) => (await box.orca.calls())
  .slice(from)
  .filter((call) => ['orchestration run-create', 'orchestration run-use'].includes(call.args.slice(0, 2).join(' ')));

/** How the calls look in a failure message: who asked, and what. */
const shown = (calls) => JSON.stringify(calls.map((call) => `${call.caller ?? 'a plain shell'}: ${call.args.join(' ')}`));

/** Point the fake at the book's Run for one session and change what Orca says about it. */
async function setCoordinator(box, mailbox, handle) {
  const state = await box.orca.state();
  await box.orca.set({ runs: state.runs.map((run) => (run.id === mailbox ? { ...run, coordinator_handle: handle } : run)) });
}

/** Take a session's tab away, as a user closing it does: the Run is left naming the tab that is gone. */
async function closeTab(box, terminal) {
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((entry) => entry.handle !== terminal.handle) });
}

/** Mail from Bot Father's session to `to`, sent from a plain shell. */
const mail = (box, to, subject) => obkIn(box, null, [
  'message', 'send', '--bots', 'bots', '--to', to, '--from', 'bot-father/daily',
  '--subject', subject, '--text', 'Please look at the staging host.',
]);

/** Orca's own refusal of a Run call, the way the fake gives one. */
const REFUSAL = 'the orchestration runtime is restarting; try again in a moment';

/** A failure a caller can act on: a non-zero exit, something said, no crash, and the names asked about. */
function assertFailedPlainly(result, ...named) {
  assert.ok(result.code !== 0 && result.code !== null, `this should have failed, got exit ${result.code}:\n${result.stdout}${result.stderr}`);
  const said = result.stdout + result.stderr;
  assert.notEqual(said.trim(), '', 'a failure with nothing said is no use to anybody');
  assert.ok(!/^\s+at /m.test(said), `expected a message, got a crash:\n${said}`);
  for (const word of named) assert.ok(said.includes(word), `it should name ${word}, got:\n${said}`);
}

/**
 * The line typed into a tab, run by that tab's shell: the whole of it, the
 * harness included, with a fake harness on PATH writing down what it got.
 */
async function runTypedLine(box, terminal, harness) {
  const fake = await fakeProgram(box, harness, {});
  const [typed] = terminal.typed;
  assert.ok(typed !== undefined, `${terminal.title} should have had a launch line typed into it`);
  const ran = await sh(typed.text, { cwd: box.cwd, env: inTab(box, terminal) });
  return { ran, harness: await fake.calls(), typed: typed.text };
}

// ---------------------------------------------------------------------------
// The launch line
// ---------------------------------------------------------------------------

test('#317: the launch line starts with the session\'s mailbox step, each word one shell word, then the harness as before', async (t) => {
  // A bots folder whose path has a space in it: the step names it, and it has
  // to reach the kit as one word, the way every other word of the kit's does.
  const box = await createSandbox(t);
  await obkIn(box, null, ['init', '--bots', 'my bots', '--harness', 'claude']);
  const bots = box.path('my bots');
  await obkIn(box, null, ['bot', 'create', '--bots', bots, '--name', 'coder', '--harness', 'codex']);
  await obkIn(box, null, ['session', 'add', '--bots', bots, '--bot', 'coder', '--name', 'daily']);

  await obkIn(box, null, ['up', '--bots', bots, '--bot', 'coder']);

  assert.deepEqual(
    typedInto(await tabOf(box, bots, 'bot-father')).map(tokenless),
    [bareLaunch(box, 'claude', 'bot-father', 'daily', { bots })],
    'Bot Father\'s line, brought up by init',
  );
  assert.deepEqual(typedInto(await tabOf(box, bots, 'coder')), [bareLaunch(box, 'codex', 'coder', 'daily', { bots })]);
  // And the step the tab ran found that folder: the mailbox is in its book.
  await assertBoundToItsOwnTab(box, bots, 'coder');
  await assertBoundToItsOwnTab(box, bots, 'bot-father');
});

test('#317: the line typed into a new tab, run by that tab\'s shell, gives the session its mailbox there and then starts the harness', async (t) => {
  // The step held, so nothing but the line itself, run as the tab, can make
  // the mailbox: this is the line doing what it says.
  const box = await createSandbox(t);
  const bots = await initIn(box, null);
  await addBot(box, null, 'coder', 'codex');
  await box.orca.set({ holdSteps: true });
  await obkIn(box, null, ['up', '--bots', 'bots', '--bot', 'coder']);
  const coder = await tabOf(box, bots, 'coder');
  assert.equal(
    (await sessionIn(bots, 'coder', 'daily')).mailbox,
    undefined,
    'up should leave the mailbox to the step in the tab, and the step has not run yet',
  );
  const runs = (await box.orca.runs()).length;

  const { ran, harness } = await runTypedLine(box, coder, 'codex');

  assert.equal(ran.code, 0, ran.stderr);
  await assertBoundToItsOwnTab(box, bots, 'coder');
  assert.equal((await box.orca.runs()).length, runs + 1, 'one Run, for this session');
  assert.equal(harness.length, 1, 'and then the harness is started, once');
  assert.deepEqual(harness[0].args, ['--approve-for-me', ...CODEX_NETWORK.split(' ')], 'with the arguments it always had');
});

test('#317: when Orca refuses the mailbox, the line still starts the harness, and the tab shows Orca\'s words', async (t) => {
  // `;` and not `&&`: a session with no mailbox yet is still a session to run.
  const box = await createSandbox(t);
  const bots = await initIn(box, null);
  await addBot(box, null, 'coder', 'codex');
  await box.orca.set({ holdSteps: true });
  await obkIn(box, null, ['up', '--bots', 'bots', '--bot', 'coder']);
  const coder = await tabOf(box, bots, 'coder');
  const runs = (await box.orca.runs()).length;
  await box.orca.set({ fail: { 'orchestration run-create': { code: 'runtime_error', message: REFUSAL } } });

  const { ran, harness } = await runTypedLine(box, coder, 'codex');

  assert.equal(harness.length, 1, `the harness is started even so, got: ${ran.stdout}${ran.stderr}`);
  assert.ok(ran.stderr.includes(REFUSAL), `and Orca's own words are on the tab's screen, got: ${ran.stderr}`);
  assert.equal((await sessionIn(bots, 'coder', 'daily')).mailbox, undefined, 'the book names no mailbox that was never made');
  assert.equal((await box.orca.runs()).length, runs, 'and there is no Run');
});

// ---------------------------------------------------------------------------
// up, init, restart and unpause make no Run call of their own
// ---------------------------------------------------------------------------

/** Every way the kit brings a session up in a new tab, run from inside `from`, which the setup returns. */
const BRING_UPS = [
  ['init, from a tab of the user\'s own', async (box) => {
    const own = await ownTab(box);
    return { from: own, args: ['init', '--bots', 'bots', '--harness', 'claude'] };
  }],
  ['up, from Bot Father\'s tab', async (box) => {
    const bots = await initIn(box, null);
    await addBot(box, null, 'coder', 'codex', [['daily'], ['night']]);
    return { from: await tabOf(box, bots, 'bot-father'), args: ['up', '--bots', 'bots', '--bot', 'coder'] };
  }],
  ['restart, from Bot Father\'s tab', async (box) => {
    const bots = await initIn(box, null);
    await addBot(box, null, 'coder', 'codex');
    await obkIn(box, null, ['up', '--bots', 'bots', '--bot', 'coder']);
    const hooked = await recordSession(box, { bots, bot: 'coder', tab: (await tabOf(box, bots, 'coder')).tabId, session: 'sess-1' });
    assert.equal(hooked.code, 0, hooked.stderr);
    return { from: await tabOf(box, bots, 'bot-father'), args: ['restart', '--bots', 'bots', '--bot', 'coder'] };
  }],
  ['unpause, from Bot Father\'s tab', async (box) => {
    const bots = await initIn(box, null);
    await addBot(box, null, 'coder', 'codex');
    await obkIn(box, null, ['up', '--bots', 'bots', '--bot', 'coder']);
    const hooked = await recordSession(box, { bots, bot: 'coder', tab: (await tabOf(box, bots, 'coder')).tabId, session: 'sess-1' });
    assert.equal(hooked.code, 0, hooked.stderr);
    await obkIn(box, null, ['pause', '--bots', 'bots', '--bot', 'coder']);
    return { from: await tabOf(box, bots, 'bot-father'), args: ['unpause', '--bots', 'bots', '--bot', 'coder'] };
  }],
];

for (const [how, setUp] of BRING_UPS) {
  test(`#317: ${how} works, and makes no Run call of its own`, async (t) => {
    // The step in each new tab is held, so every Run call in the log after
    // this point would be the command's own. On 1.4.210 a Run call made from
    // here for another tab is refused; one made with the caller's Orca
    // variables cleared gets past the fence, which the kit must not do.
    const box = await createSandbox(t);
    const { from, args } = await setUp(box);
    await box.orca.set({ holdSteps: true });
    const before = (await box.orca.calls()).length;
    const there = new Set((await box.orca.terminals()).map((terminal) => terminal.handle));

    await obkIn(box, from, args);

    const opened = (await box.orca.terminals()).filter((terminal) => !there.has(terminal.handle) && (terminal.typed ?? []).length > 0);
    assert.ok(opened.length > 0, 'the command did open a tab and type a launch line into it');
    const own = await runCallsSince(box, before);
    assert.deepEqual(own, [], `the command itself makes no Run and binds none, got: ${shown(own)}`);
  });
}

test('#317: a fleet brought up from Bot Father\'s tab has each mailbox made in, and bound to, its own tab', async (t) => {
  // The fleet's daily way, end to end, with each tab's shell running its step.
  // Every Run call came from the tab the Run is for: none from the tab `up`
  // and `init` ran in, and none from a shell with no terminal.
  const box = await createSandbox(t);
  const own = await ownTab(box);
  const bots = await initIn(box, own);
  const a = await tabOf(box, bots, 'bot-father');
  await addBot(box, a, 'writer', 'claude');
  await addBot(box, a, 'coder', 'codex', [['daily'], ['night']]);
  const from = (await box.orca.calls()).length;

  await obkIn(box, a, ['up', '--bots', 'bots']);

  const sessions = [['bot-father', 'daily'], ['writer', 'daily'], ['coder', 'daily'], ['coder', 'night']];
  for (const [bot, session] of sessions) await assertBoundToItsOwnTab(box, bots, bot, session);
  const tabsOfSessions = [];
  for (const [bot, session] of sessions) tabsOfSessions.push((await tabOf(box, bots, bot, session)).handle);
  const all = await runCallsSince(box);
  assert.ok(all.length > 0, 'somebody made the mailboxes');
  assert.deepEqual(
    all.filter((call) => !tabsOfSessions.includes(call.caller)),
    [],
    `every Run call was made from a session's own tab, got: ${shown(all)}`,
  );
  for (const handle of tabsOfSessions) {
    const made = orcaCallsOf(all, 'orchestration run-create').filter((call) => call.caller === handle);
    assert.equal(made.length, 1, `the tab ${handle} made its session's one mailbox, got: ${shown(all)}`);
  }
  assert.deepEqual(
    (await runCallsSince(box, from)).filter((call) => call.caller === a.handle || call.caller === own.handle),
    [],
    'and neither tab a command was typed in made one',
  );
  assert.deepEqual(
    (await box.orca.runs()).filter((run) => [a.handle, own.handle].includes(run.coordinator_handle)).map((run) => run.id),
    [(await sessionIn(bots, 'bot-father', 'daily')).mailbox],
    'Bot Father\'s tab coordinates its own mailbox and no other, and the user\'s tab none',
  );
});

/** A session brought back into a new tab, from Bot Father's tab, each way the kit does it. */
const BRING_BACKS = [
  ['restart', async (box, fleet) => {
    await obkIn(box, fleet.a, ['restart', '--bots', 'bots', '--bot', 'coder']);
  }],
  ['pause and unpause', async (box, fleet) => {
    await obkIn(box, fleet.a, ['pause', '--bots', 'bots', '--bot', 'coder']);
    await obkIn(box, fleet.a, ['unpause', '--bots', 'bots', '--bot', 'coder']);
  }],
  ['up after its tab was closed', async (box, fleet) => {
    await closeTab(box, fleet.old);
    await obkIn(box, fleet.a, ['up', '--bots', 'bots', '--bot', 'coder']);
  }],
];

for (const [how, bringBack] of BRING_BACKS) {
  test(`#317: a session brought back by ${how}, from another tab, keeps its mailbox and has it bound in its new tab`, async (t) => {
    // The issue's second check. A Run cannot be deleted, so the session keeps
    // the one it has for ever, and the new tab binds that one to itself.
    const box = await createSandbox(t);
    const own = await ownTab(box);
    const bots = await initIn(box, own);
    const a = await tabOf(box, bots, 'bot-father');
    await addBot(box, a, 'coder', 'codex');
    await obkIn(box, a, ['up', '--bots', 'bots', '--bot', 'coder']);
    const old = await tabOf(box, bots, 'coder');
    const hooked = await recordSession(box, { bots, bot: 'coder', tab: old.tabId, session: 'sess-1' });
    assert.equal(hooked.code, 0, hooked.stderr);
    const { mailbox } = await sessionIn(bots, 'coder', 'daily');
    const runs = (await box.orca.runs()).length;
    const from = (await box.orca.calls()).length;

    await bringBack(box, { a, old });

    const now = await tabOf(box, bots, 'coder');
    assert.notEqual(now.handle, old.handle, 'the session should be in a new tab');
    assert.equal((await sessionIn(bots, 'coder', 'daily')).mailbox, mailbox, 'it keeps the mailbox it had');
    assert.equal((await box.orca.runs()).length, runs, 'and no second Run is made for it');
    await assertBoundToItsOwnTab(box, bots, 'coder');
    await assertBoundToItsOwnTab(box, bots, 'bot-father');
    const since = await runCallsSince(box, from);
    assert.deepEqual(orcaCallsOf(since, 'orchestration run-create'), [], `nothing asked for a new Run, got: ${shown(since)}`);
    assert.ok(
      orcaCallsOf(since, 'orchestration run-use').some((call) => call.caller === now.handle),
      `the new tab bound it to itself, got: ${shown(since)}`,
    );
  });
}

for (const [where, runFrom] of [['a plain shell', () => null], ['Bot Father\'s tab', (fleet) => fleet.a]]) {
  test(`#317: a session already running with no mailbox in its book gets none from up in ${where}, and up asks Orca for no Run`, async (t) => {
    // A book written before mailboxes, or by hand. `up` types nothing into a
    // tab that is already running, so there is no step to run there, and
    // `up` cannot make a mailbox for that tab itself.
    const box = await createSandbox(t);
    const bots = await initIn(box, null);
    const a = await tabOf(box, bots, 'bot-father');
    await addBot(box, null, 'coder', 'codex');
    await obkIn(box, null, ['up', '--bots', 'bots', '--bot', 'coder']);
    const book = await bookIn(bots, 'coder');
    delete book.sessions.daily.mailbox;
    await writeFile(bookOf(bots, 'coder'), stringify(book));
    const runs = (await box.orca.runs()).length;
    const tabs = (await box.orca.terminals()).length;
    const from = (await box.orca.calls()).length;

    await obkIn(box, runFrom({ a }), ['up', '--bots', 'bots', '--bot', 'coder']);

    assert.equal((await box.orca.terminals()).length, tabs, 'the session was running already: no tab is opened for it');
    assert.equal((await sessionIn(bots, 'coder', 'daily')).mailbox, undefined, 'and it is given no mailbox by this up');
    const since = await runCallsSince(box, from);
    assert.deepEqual(since, [], `up asks Orca for no Run and binds none, got: ${shown(since)}`);
    assert.equal((await box.orca.runs()).length, runs);
  });
}

test('#317: a session with no mailbox in its book gets one the next time the kit launches it', async (t) => {
  const box = await createSandbox(t);
  const bots = await initIn(box, null);
  const a = await tabOf(box, bots, 'bot-father');
  await addBot(box, null, 'coder', 'codex');
  await obkIn(box, null, ['up', '--bots', 'bots', '--bot', 'coder']);
  const book = await bookIn(bots, 'coder');
  delete book.sessions.daily.mailbox;
  await writeFile(bookOf(bots, 'coder'), stringify(book));
  await closeTab(box, await tabOf(box, bots, 'coder'));
  const runs = (await box.orca.runs()).length;

  await obkIn(box, a, ['up', '--bots', 'bots', '--bot', 'coder']);

  await assertBoundToItsOwnTab(box, bots, 'coder');
  assert.equal((await box.orca.runs()).length, runs + 1, 'one new Run, for the session that had none');
});

// ---------------------------------------------------------------------------
// obk session mailbox, run in the session's own tab
// ---------------------------------------------------------------------------

/** `obk session mailbox` for coder/daily. */
const MAILBOX = ['session', 'mailbox', '--bots', 'bots', '--bot', 'coder', '--session', 'daily'];

/** coder brought up from a plain shell, its step held: a tab, and no mailbox yet. */
async function coderWithNoMailbox(box) {
  const bots = await initIn(box, null);
  await addBot(box, null, 'coder', 'codex');
  await box.orca.set({ holdSteps: true });
  await obkIn(box, null, ['up', '--bots', 'bots', '--bot', 'coder']);
  assert.equal(
    (await sessionIn(bots, 'coder', 'daily')).mailbox,
    undefined,
    'up should leave the mailbox to the step in the tab, and the step has not run yet',
  );
  return { bots, coder: await tabOf(box, bots, 'coder') };
}

/** coder brought up from a plain shell, its step run in its tab: a tab, and a mailbox bound there. */
async function coderWithMailbox(box) {
  const bots = await initIn(box, null);
  await addBot(box, null, 'coder', 'codex');
  await obkIn(box, null, ['up', '--bots', 'bots', '--bot', 'coder']);
  const coder = await tabOf(box, bots, 'coder');
  const { mailbox } = await sessionIn(bots, 'coder', 'daily');
  assert.ok(typeof mailbox === 'string', `coder's step should have given it a mailbox, got: ${mailbox}`);
  return { bots, coder, mailbox };
}

test('#317: session mailbox in the session\'s own tab, with none in the book, makes one bound to that tab and writes it down', async (t) => {
  const box = await createSandbox(t);
  const { bots, coder } = await coderWithNoMailbox(box);
  const runs = (await box.orca.runs()).length;
  const from = (await box.orca.calls()).length;

  const result = await obkIn(box, coder, MAILBOX);

  assert.equal(result.code, 0);
  await assertBoundToItsOwnTab(box, bots, 'coder');
  assert.equal((await box.orca.runs()).length, runs + 1, 'one Run made');
  const since = await runCallsSince(box, from);
  assert.deepEqual(
    since.filter((call) => call.caller !== coder.handle),
    [],
    `made from inside the tab itself, got: ${shown(since)}`,
  );
});

test('#317: session mailbox in the session\'s own tab, with one in the book, binds that Run there and makes no new one', async (t) => {
  // The mailbox the book holds is bound to no tab, as one taken off its tab
  // is: the command has to bind it, not make another.
  const box = await createSandbox(t);
  const { bots, coder, mailbox } = await coderWithMailbox(box);
  await setCoordinator(box, mailbox, null);
  const runs = (await box.orca.runs()).length;
  const from = (await box.orca.calls()).length;

  await obkIn(box, coder, MAILBOX);

  assert.equal((await sessionIn(bots, 'coder', 'daily')).mailbox, mailbox, 'the book still names the same mailbox');
  await assertBoundToItsOwnTab(box, bots, 'coder');
  assert.equal((await box.orca.runs()).length, runs, 'and no Run is made');
  const since = await runCallsSince(box, from);
  assert.deepEqual(orcaCallsOf(since, 'orchestration run-create'), [], `nothing asked for one, got: ${shown(since)}`);
});

test('#317: two session mailbox runs at the same moment leave the session with the mailbox written first, bound to its tab', async (t) => {
  // The step reads the book, asks Orca for a Run and writes it down, and the
  // Orca call is made outside the book's lock, where nothing slow happens.
  // What must not happen is the later writer putting its Run over the one
  // already in the book: a session whose mailbox is replaced no longer reads
  // the mailbox the fleet has been writing to, and a Run cannot be deleted.
  // Both run in the session's own tab, and one terminal holds one Run, so the
  // one the book keeps still has to end up bound there. (This race was `up`'s
  // before #317; session-address.test.js says where it went.)
  //
  // The overlap is arranged rather than hoped for: the fake runs the second
  // to completion in the middle of the first one's `run-create`.
  const box = await createSandbox(t);
  const { bots, coder } = await coderWithNoMailbox(box);
  const runsBefore = (await box.orca.runs()).length;
  await box.orca.set({
    runDuring: {
      command: 'orchestration run-create',
      on: orcaCallsOf(await box.orca.calls(), 'orchestration run-create').length + 1,
      // The second one, and then the book as it left it: what the first must not undo.
      argv: [
        '/bin/sh', '-c',
        `${shellWord(box.cli)} session mailbox --bots ${shellWord(bots)} --bot coder --session daily > /dev/null && cat ${shellWord(bookOf(bots, 'coder'))}`,
      ],
      env: { ORCA_TERMINAL_HANDLE: coder.handle, ORCA_TAB_ID: coder.tabId },
    },
  });

  const first = await obkFrom(box, coder, MAILBOX);

  assert.equal(first.code, 0, first.stderr);
  const ran = await box.orca.ranDuring();
  assert.equal(ran.length, 1, `the second should have gone through the middle of the first, got: ${JSON.stringify(ran)}`);
  assert.equal(ran[0].status, 0, `and it should not have failed: ${ran[0].stderr}`);
  const wonIt = (parse(ran[0].stdout) ?? {}).sessions?.daily?.mailbox;
  assert.ok(typeof wonIt === 'string', `the second should have written a mailbox, got: ${ran[0].stdout}`);
  assert.equal((await sessionIn(bots, 'coder', 'daily')).mailbox, wonIt, 'the book keeps the mailbox written first');
  assert.equal((await box.orca.runs()).length, runsBefore + 2, 'both did ask Orca for one, which is what makes this worth guarding');
  await assertBoundToItsOwnTab(box, bots, 'coder');
});

test('#317: when Orca will not make the mailbox, session mailbox fails in Orca\'s words, says none was made, and writes none down', async (t) => {
  const box = await createSandbox(t);
  const { bots, coder } = await coderWithNoMailbox(box);
  const entry = await sessionIn(bots, 'coder', 'daily');
  const runs = (await box.orca.runs()).length;
  await box.orca.set({ fail: { 'orchestration run-create': { code: 'runtime_error', message: REFUSAL } } });

  const result = await obkFrom(box, coder, MAILBOX);

  assertFailedPlainly(result);
  assert.ok(result.stderr.includes(REFUSAL), `Orca's own words, on stderr, got: ${result.stderr}`);
  assert.match(result.stderr, /no mailbox|not made/i, `and it says no mailbox was made, got: ${result.stderr}`);
  const after = await sessionIn(bots, 'coder', 'daily');
  assert.equal(after.mailbox, undefined, `the book names no mailbox, got: ${JSON.stringify(after)}`);
  for (const [key, value] of Object.entries(entry)) {
    assert.deepEqual(after[key], value, `and the rest of coder's entry is as it was: ${key}`);
  }
  assert.equal((await box.orca.runs()).length, runs, 'and Orca has no Run for it');
});

test('#317: when Orca will not bind the mailbox the book holds, session mailbox fails in Orca\'s words, says it is unchanged, and makes no other', async (t) => {
  const box = await createSandbox(t);
  const { bots, coder, mailbox } = await coderWithMailbox(box);
  await setCoordinator(box, mailbox, null);
  const runs = (await box.orca.runs()).length;
  const from = (await box.orca.calls()).length;
  await box.orca.set({ fail: { 'orchestration run-use': { code: 'runtime_error', message: REFUSAL } } });

  const result = await obkFrom(box, coder, MAILBOX);

  assertFailedPlainly(result);
  assert.ok(result.stderr.includes(REFUSAL), `Orca's own words, on stderr, got: ${result.stderr}`);
  assert.ok(result.stderr.includes(mailbox), `it names the mailbox, got: ${result.stderr}`);
  assert.match(result.stderr, /unchanged|as it was/i, `and says it is unchanged, got: ${result.stderr}`);
  assert.equal((await sessionIn(bots, 'coder', 'daily')).mailbox, mailbox, 'the book still names the mailbox it had');
  assert.equal((await box.orca.runs()).length, runs, 'and no second Run was made in its place');
  const since = await runCallsSince(box, from);
  assert.deepEqual(orcaCallsOf(since, 'orchestration run-create'), [], `nothing asked for one, got: ${shown(since)}`);
});

test('#317: a Codex session whose sandbox switch is off gets no mailbox from session mailbox, and it does not fail', async (t) => {
  // It could never read a mailbox, and a Run cannot be deleted. Its launch
  // line has no step (session-address.test.js); run by hand, the command
  // leaves it as it is.
  const box = await createSandbox(t);
  const bots = await initIn(box, null);
  await addBot(box, null, 'coder', 'codex', [['daily', '--extra-arg=-c', '--extra-arg=sandbox_workspace_write.network_access=false']]);
  await obkIn(box, null, ['up', '--bots', 'bots', '--bot', 'coder']);
  const coder = await tabOf(box, bots, 'coder');
  const runs = (await box.orca.runs()).length;
  const from = (await box.orca.calls()).length;

  await obkIn(box, coder, MAILBOX);

  assert.equal((await sessionIn(bots, 'coder', 'daily')).mailbox, undefined, 'the book names no mailbox');
  assert.equal((await box.orca.runs()).length, runs, 'and Orca made none');
  const since = await runCallsSince(box, from);
  assert.deepEqual(since, [], `nor was it asked to, got: ${shown(since)}`);
});

test('#317 review: when the book cannot be written after Orca made the Run, session mailbox fails, names that Run and the session, and the book names none', async (t) => {
  // Orca has made the Run and bound it to this tab, and a Run cannot be taken
  // back, but the book, where the fleet reads the session's address, could not
  // be written. What is left to do is say which Run that is. The bot's folder
  // is made read-only while Orca is making the Run, so the write after it fails.
  const box = await createSandbox(t);
  const { bots, coder } = await coderWithNoMailbox(box);
  const home = botHomeOf(bots, 'coder');
  const before = new Set((await box.orca.runs()).map((run) => run.id));
  await box.orca.set({
    runDuring: {
      command: 'orchestration run-create',
      on: orcaCallsOf(await box.orca.calls(), 'orchestration run-create').length + 1,
      argv: ['/bin/chmod', '555', home],
    },
  });

  let result;
  try {
    result = await obkFrom(box, coder, MAILBOX);
  } finally {
    await chmod(home, 0o755);
  }

  assert.equal((await box.orca.ranDuring()).length, 1, 'the folder was made read-only while the Run was being made');
  const made = (await box.orca.runs()).filter((run) => !before.has(run.id));
  assert.equal(made.length, 1, `Orca made the one Run, got: ${JSON.stringify(made)}`);
  assertFailedPlainly(result, 'coder/daily', made[0].id);
  assert.match(result.stdout + result.stderr, /EACCES|permission denied/i, 'and gives the error underneath');
  assert.equal((await sessionIn(bots, 'coder', 'daily')).mailbox, undefined, 'the book names no mailbox');
});

// ---------------------------------------------------------------------------
// obk session mailbox anywhere but the tab the book names (review of PR #320)
// ---------------------------------------------------------------------------

/** Where `session mailbox` for coder/daily can be typed that is not coder's own tab. */
const ELSEWHERE = [
  ['Bot Father\'s tab', (box, bots) => tabOf(box, bots, 'bot-father')],
  ['a tab of the user\'s own', (box) => ownTab(box)],
  ['a plain shell', async () => null],
];

for (const [where, placeOf] of ELSEWHERE) {
  test(`#317 review: session mailbox from ${where}, for a session with no mailbox, makes none and fails, naming the session`, async (t) => {
    // Only the tab the book names gets the session's mailbox: made from
    // anywhere else it would be bound to the wrong tab, or to none. The same
    // command in coder's own tab afterwards shows it was the place that was
    // refused, not the command.
    const box = await createSandbox(t);
    const { bots, coder } = await coderWithNoMailbox(box);
    const place = await placeOf(box, bots);
    const runs = (await box.orca.runs()).length;
    const from = (await box.orca.calls()).length;

    const result = await obkFrom(box, place, MAILBOX);

    assertFailedPlainly(result, 'coder/daily');
    const since = await runCallsSince(box, from);
    assert.deepEqual(since, [], `it asks Orca for no Run and binds none, got: ${shown(since)}`);
    assert.equal((await box.orca.runs()).length, runs, 'no Run is made');
    assert.equal((await sessionIn(bots, 'coder', 'daily')).mailbox, undefined, 'and the book names none');

    await obkIn(box, coder, MAILBOX);
    await assertBoundToItsOwnTab(box, bots, 'coder');
  });

  test(`#317 review: session mailbox from ${where}, for a session with a mailbox, binds nothing and fails, naming the session`, async (t) => {
    // The session's Run is bound to no tab, so a bind from here would show.
    const box = await createSandbox(t);
    const { bots, coder, mailbox } = await coderWithMailbox(box);
    await setCoordinator(box, mailbox, null);
    const place = await placeOf(box, bots);
    const from = (await box.orca.calls()).length;

    const result = await obkFrom(box, place, MAILBOX);

    assertFailedPlainly(result, 'coder/daily');
    const since = await runCallsSince(box, from);
    assert.deepEqual(since, [], `it asks Orca for no Run and binds none, got: ${shown(since)}`);
    assert.equal((await mailboxOf(box, bots, 'coder')).coordinator_handle, null, 'coder\'s mailbox is still bound to nothing');
    await assertBoundToItsOwnTab(box, bots, 'bot-father');

    await obkIn(box, coder, MAILBOX);
    await assertBoundToItsOwnTab(box, bots, 'coder');
  });
}

/** Run the mailbox step a tab's launch line starts with, the way that tab's shell runs it: as that tab. */
async function runStepIn(box, terminal) {
  const text = terminal.typed?.[0]?.text ?? '';
  const at = text.indexOf('; OBK_TAB_SHELL=');
  assert.ok(at > 0, `${terminal.title} should have had a launch line with a mailbox step typed into it, got: ${text}`);
  return sh(text.slice(0, at), { cwd: box.cwd, env: inTab(box, terminal) });
}

for (const [order, bookFirst] of [['the tab the book names runs its step first', true], ['the other tab runs its step first', false]]) {
  test(`#317 review: two tabs for one session from two ups at once: only the one the book names gets the mailbox (${order})`, async (t) => {
    // The review's reproduction. Two runs of `up` at the same moment each open
    // a tab for coder/daily and type its launch line, and the book ends up
    // naming one of the two. Each tab's shell runs its step when it gets to it,
    // in either order. Before, the second step to run bound the Run to its own
    // tab, so the book could name one tab while the mailbox was bound to the
    // other. Whatever the order, the mailbox is bound to the tab the book
    // names, and the other tab makes no Run and binds none.
    //
    // The overlap is arranged: the fake runs the second `up` to completion in
    // the middle of the first one's `terminal create`, with both steps held.
    const box = await createSandbox(t);
    const bots = await initIn(box, null);
    await addBot(box, null, 'coder', 'codex');
    await box.orca.set({
      holdSteps: true,
      runDuring: {
        command: 'terminal create',
        on: orcaCallsOf(await box.orca.calls(), 'terminal create').length + 1,
        argv: ['/bin/sh', '-c', `${shellWord(box.cli)} up --bots ${shellWord(bots)} --bot coder > /dev/null`],
      },
    });
    await obkIn(box, null, ['up', '--bots', 'bots', '--bot', 'coder']);
    const ran = await box.orca.ranDuring();
    assert.equal(ran.length, 1, `the second up should have gone through the middle of the first, got: ${JSON.stringify(ran)}`);
    assert.equal(ran[0].status, 0, `and it should not have failed: ${ran[0].stderr}`);
    const named = await tabOf(box, bots, 'coder');
    const others = (await box.orca.terminals())
      .filter((terminal) => terminal.worktreePath === named.worktreePath && terminal.handle !== named.handle);
    assert.equal(others.length, 1, `two tabs for coder/daily, one of them the book's, got: ${JSON.stringify(others)}`);
    const [stray] = others;
    const runs = (await box.orca.runs()).length;

    const steps = {};
    for (const terminal of bookFirst ? [named, stray] : [stray, named]) {
      const from = (await box.orca.calls()).length;
      steps[terminal.handle] = { ran: await runStepIn(box, terminal), calls: await runCallsSince(box, from) };
    }

    const lost = steps[stray.handle];
    assert.notEqual(lost.ran.code, 0, `the step in the tab the book does not name fails, got: ${lost.ran.stdout}${lost.ran.stderr}`);
    assert.ok(`${lost.ran.stdout}${lost.ran.stderr}`.includes('coder/daily'), `and names the session, got: ${lost.ran.stdout}${lost.ran.stderr}`);
    assert.deepEqual(lost.calls, [], `and asks Orca for no Run and binds none, got: ${shown(lost.calls)}`);
    assert.equal(steps[named.handle].ran.code, 0, `the step in the tab the book names works: ${steps[named.handle].ran.stderr}`);
    await assertBoundToItsOwnTab(box, bots, 'coder');
    assert.equal((await box.orca.runs()).length, runs + 1, 'one Run, for the one session');
    assert.deepEqual(
      (await box.orca.runs()).filter((run) => run.coordinator_handle === stray.handle).map((run) => run.id),
      [],
      'and none is bound to the tab the book does not name',
    );
  });
}

// ---------------------------------------------------------------------------
// The book moves while the step is asking Orca, and an Orca that does not
// answer (reviews of 472edad)
// ---------------------------------------------------------------------------

/** A second tab in a bot's Orca project, as a second `up` at the same moment opens one: nothing typed into it yet. */
async function anotherTab(box, bots, bot) {
  const made = await sh(
    `${shellWord(box.orca.cli)} terminal create --worktree ${shellWord(`path:${botHomeOf(bots, bot)}`)} --title 'Coder daily' --json`,
    { cwd: box.cwd, env: box.env },
  );
  assert.equal(made.code, 0, `the fake should have made the tab: ${made.stdout}${made.stderr}`);
  return JSON.parse(made.stdout).result.terminal;
}

/**
 * A command that moves coder/daily's tab in the book from one tab id to
 * another, the way another run of `up` writes the tab it has just opened. It
 * fails if the book did not name `from`, so a test cannot pass on a move that
 * never happened.
 */
const moveTab = (bots, from, to) => [process.execPath, '-e', [
  "const fs = require('fs');",
  `const file = ${JSON.stringify(bookOf(bots, 'coder'))};`,
  "const was = fs.readFileSync(file, 'utf8');",
  `const now = was.replace(${JSON.stringify(`tab: ${from}\n`)}, ${JSON.stringify(`tab: ${to}\n`)});`,
  'if (now === was) process.exit(3);',
  'fs.writeFileSync(file, now);',
].join(' ')].map(shellWord).join(' ');

test('#317 review: a session mailbox that made a Run while the book moved to another tab writes nothing, names that Run, and leaves the book\'s Run bound where it is', async (t) => {
  // The review's reproduced race. Tab A's step finds the book naming A and no
  // mailbox, and asks Orca for a Run. Meanwhile another run of `up` writes its
  // own tab B into the book, and B's step makes its Run and writes it first.
  // When A comes to write, the book no longer names A. A writes nothing and
  // binds nothing more, rather than take B's Run for itself: the book's Run
  // stays bound to the tab the book names, and A says which Run of its own it
  // left unused.
  //
  // The overlap is arranged: the fake moves the book to B and runs B's step,
  // as B, in the middle of A's `run-create`.
  const box = await createSandbox(t);
  const { bots, coder: a } = await coderWithNoMailbox(box);
  const b = await anotherTab(box, bots, 'coder');
  const before = new Set((await box.orca.runs()).map((run) => run.id));
  const stepOfB = [box.cli, 'session', 'mailbox', '--bots', bots, '--bot', 'coder', '--session', 'daily'].map(shellWord).join(' ');
  await box.orca.set({
    runDuring: {
      command: 'orchestration run-create',
      on: orcaCallsOf(await box.orca.calls(), 'orchestration run-create').length + 1,
      argv: ['/bin/sh', '-c', `${moveTab(bots, a.tabId, b.tabId)} && ${stepOfB}`],
      env: { ORCA_TERMINAL_HANDLE: b.handle, ORCA_TAB_ID: b.tabId },
    },
  });
  const from = (await box.orca.calls()).length;

  const result = await obkFrom(box, a, MAILBOX);

  const ran = await box.orca.ranDuring();
  assert.equal(ran.length, 1, `the book should have moved in the middle of A's step, got: ${JSON.stringify(ran)}`);
  assert.equal(ran[0].status, 0, `and B's step should have worked: ${ran[0].stdout}${ran[0].stderr}`);
  const daily = await sessionIn(bots, 'coder', 'daily');
  assert.equal(daily.tab, b.tabId, 'the book names B, as the other run left it');
  const runs = await box.orca.runs();
  const kept = runs.find((run) => run.id === daily.mailbox);
  assert.ok(kept !== undefined && !before.has(kept.id), `the book holds the Run B's step made: ${JSON.stringify(daily)}`);
  assert.equal(kept.coordinator_handle, b.handle, 'and it is still bound to B, the tab the book names');
  const unused = runs.filter((run) => !before.has(run.id) && run.id !== kept.id);
  assert.equal(unused.length, 1, `A made one Run of its own, got: ${JSON.stringify(unused)}`);
  assertFailedPlainly(result, 'coder/daily', unused[0].id);
  // A's own `run-create` bound that Run to A, so "nothing was bound" would be
  // false: what A says is that its Run is bound here and left unused.
  const said = result.stdout + result.stderr;
  assert.equal(unused[0].coordinator_handle, a.handle, 'A\'s own Run is bound to A, which is what the step has to say');
  assert.doesNotMatch(said, /nothing was (written down or )?bound/i, `it must not say nothing was bound, got:\n${said}`);
  assert.match(said, /bound to this tab/i, `it says the Run it made is bound to this tab, got:\n${said}`);
  const byA = (await runCallsSince(box, from)).filter((call) => call.caller === a.handle);
  assert.deepEqual(orcaCallsOf(byA, 'orchestration run-use'), [], `A binds nothing more, got: ${shown(byA)}`);
});

/** How long the fake takes to answer a call that is meant never to be answered in time: far past the step's own limit. */
const HANG_MS = 60_000;

test('#317 review: when Orca does not answer the step, the step gives up and fails naming the session, and the line still starts the harness', async (t) => {
  // The step sits in front of the harness on the launch line, so it must end,
  // whatever Orca does: each Orca call it makes is given twenty seconds. There
  // is nothing to shorten that by, so this test waits it out. Here Orca takes a
  // minute to answer the `run-create` of a new session's mailbox.
  const box = await createSandbox(t);
  const { bots, coder } = await coderWithNoMailbox(box);
  const harness = await fakeProgram(box, 'codex', {});
  await box.orca.set({ hang: { command: 'orchestration run-create', ms: HANG_MS } });
  const text = coder.typed[0]?.text ?? '';
  const at = text.indexOf('; OBK_TAB_SHELL=');
  assert.ok(at > 0, `the launch line should start with the mailbox step, got: ${text}`);
  // The typed line, run by the tab's shell, with one thing put between its two
  // halves: the step's own exit code, which the harness after it never sees.
  const line = `${text.slice(0, at)}; echo "step exited $?" >&2${text.slice(at)}`;

  const started = Date.now();
  const ran = await sh(line, { cwd: box.cwd, env: inTab(box, coder) });
  const took = Date.now() - started;

  const exited = /step exited (\d+)/.exec(ran.stderr)?.[1];
  assert.ok(exited !== undefined && exited !== '0', `the step failed, got: ${ran.stderr}`);
  assert.ok(took < HANG_MS, `having given up before Orca answered, after ${took} ms`);
  assert.ok(ran.stderr.includes('coder/daily'), `it names the session, got: ${ran.stderr}`);
  assert.ok(!/^\s+at /m.test(ran.stderr), `plainly, not a crash, got: ${ran.stderr}`);
  // Orca may have made a Run after the step stopped waiting; the step cannot
  // know, so it says that any such Run is left unused.
  assert.match(ran.stderr, /unused/i, `and that any Run Orca made is left unused, got: ${ran.stderr}`);
  assert.equal((await harness.calls()).length, 1, 'and then the harness starts');
  assert.equal((await sessionIn(bots, 'coder', 'daily')).mailbox, undefined, 'the book names no mailbox that was never made');
});

test('#317 review: when Orca binds the mailbox and then does not answer, the step fails naming it, and does not claim it is unchanged', async (t) => {
  // Orca did the `run-use` and never said so. The step gives up after twenty
  // seconds knowing nothing of what happened: the mailbox may now be bound to
  // this tab, or may still be where it was. So it must not say it is
  // unchanged, which is what it rightly says when Orca answered no (the
  // refusal test above). This one waits the twenty seconds out too.
  const box = await createSandbox(t);
  const { coder, mailbox } = await coderWithMailbox(box);
  await setCoordinator(box, mailbox, null);
  await box.orca.set({ hang: { command: 'orchestration run-use', ms: HANG_MS, applied: true } });

  const started = Date.now();
  const result = await obkFrom(box, coder, MAILBOX);
  const took = Date.now() - started;

  const said = result.stdout + result.stderr;
  assert.equal(
    (await box.orca.runs()).find((run) => run.id === mailbox).coordinator_handle,
    coder.handle,
    'Orca did bind it, which is the case this test is about',
  );
  assertFailedPlainly(result, 'coder/daily', mailbox);
  assert.ok(took < HANG_MS, `having given up before Orca answered, after ${took} ms`);
  assert.doesNotMatch(said, /unchanged|as it was/i, `it does not claim what it cannot know, got:\n${said}`);
  assert.match(said, /\bmay\b.{0,80}\bbound\b|\bbound\b.{0,80}\bmay\b/is, `it says the mailbox may be bound here, got:\n${said}`);
});

// ---------------------------------------------------------------------------
// obk message check, from the session's own tab and from another
// ---------------------------------------------------------------------------

test('#317: message check in the session\'s own tab binds its mailbox to that tab and reads it', async (t) => {
  // What already held, and must still: the tab the mailbox belongs to reads it.
  // The Run is bound to no tab first, so the check has something to bind.
  const box = await createSandbox(t);
  const { bots, coder, mailbox } = await coderWithMailbox(box);
  await setCoordinator(box, mailbox, null);
  await mail(box, 'coder', 'the staging host');

  const read = await obkIn(box, coder, ['message', 'check', '--bots', 'bots', '--bot', 'coder', '--session', 'daily']);

  assert.ok(read.stdout.includes('the staging host'), `it reads coder's mail, got: ${read.stdout}`);
  assert.deepEqual((await box.orca.messages()).map((message) => message.acked), [true], 'and takes it');
  await assertBoundToItsOwnTab(box, bots, 'coder');
});

const OTHER_TABS = [
  ['Bot Father\'s tab', (fleet) => fleet.a],
  ['a tab of the user\'s own', (fleet) => fleet.own],
];
const WAYS = [['a check', []], ['a peek', ['--peek']]];

for (const [where, readerOf] of OTHER_TABS) {
  for (const [how, flags] of WAYS) {
    test(`#317: ${how} of a session's mail from ${where} reads nothing, binds nothing, and says so`, async (t) => {
      // Orca 1.4.210 lets a tab read as itself and no other, and binding the
      // session's mailbox to this tab would take it off the session's own.
      const box = await createSandbox(t);
      const own = await ownTab(box);
      const bots = await initIn(box, null);
      const a = await tabOf(box, bots, 'bot-father');
      await addBot(box, null, 'coder', 'codex');
      await obkIn(box, null, ['up', '--bots', 'bots', '--bot', 'coder']);
      await mail(box, 'coder', 'the staging host');
      const reader = readerOf({ a, own });
      const from = (await box.orca.calls()).length;

      const result = await obkFrom(box, reader, ['message', 'check', '--bots', 'bots', '--bot', 'coder', '--session', 'daily', ...flags]);

      assertFailedPlainly(result, 'coder/daily');
      assert.ok(!result.stdout.includes('the staging host'), `nothing is read, got: ${result.stdout}`);
      const asked = (await box.orca.calls()).slice(from)
        .filter((call) => ['orchestration run-use', 'orchestration check'].includes(call.args.slice(0, 2).join(' ')));
      assert.deepEqual(asked, [], `no binding and no read was asked of Orca, got: ${shown(asked)}`);
      assert.deepEqual((await box.orca.messages()).map((message) => message.acked), [false], 'the mail is still waiting');
      await assertBoundToItsOwnTab(box, bots, 'coder');
      await assertBoundToItsOwnTab(box, bots, 'bot-father');
    });
  }
}

test('#317: every Orca call across all of this is an allowed one, and none made in a tab names another terminal', async (t) => {
  // The kit's own list of commands, `--json` on every call, and the one close
  // there is: restart's, of the session's old tab by its handle, never a
  // project's tabs (restart.test.js holds restart to the rest of that). What
  // #317 adds: a Run call made inside a tab names no terminal but its own —
  // counting the calls Orca refused, which the log keeps, so a kit that tried
  // and went on past the refusal is caught too.
  const box = await createSandbox(t);
  const own = await ownTab(box);
  const bots = await initIn(box, own);
  const a = await tabOf(box, bots, 'bot-father');
  await addBot(box, a, 'coder', 'codex');
  await obkIn(box, a, ['up', '--bots', 'bots', '--bot', 'coder']);
  const old = await tabOf(box, bots, 'coder');
  const hooked = await recordSession(box, { bots, bot: 'coder', tab: old.tabId, session: 'sess-1' });
  assert.equal(hooked.code, 0, hooked.stderr);
  await obkIn(box, a, ['restart', '--bots', 'bots', '--bot', 'coder']);
  await obkIn(box, await tabOf(box, bots, 'coder'), MAILBOX);
  await mail(box, 'coder', 'hello');
  await obkFrom(box, a, ['message', 'check', '--bots', 'bots', '--bot', 'coder', '--session', 'daily']);
  await obkIn(box, await tabOf(box, bots, 'coder'), ['message', 'check', '--bots', 'bots']);

  const calls = await box.orca.calls();
  const closes = orcaCallsOf(calls, 'terminal close');
  assert.equal(closes.length, 1, `restart closes the session's old tab, and nothing else is closed, got: ${shown(closes)}`);
  assert.equal(orcaFlag(closes[0], '--terminal'), old.handle, `by its handle, got: ${shown(closes)}`);
  assert.ok(closes[0].args.includes('--tab'), `the whole tab, got: ${shown(closes)}`);
  assert.ok(
    !closes[0].args.includes('--all') && orcaFlag(closes[0], '--worktree') === undefined,
    `never a project's tabs, got: ${shown(closes)}`,
  );
  assertOrcaCallsAllowed(calls.filter((call) => call !== closes[0]));

  const naming = { 'orchestration run-create': '--from', 'orchestration run-use': '--from', 'orchestration check': '--terminal' };
  const asOthers = calls.filter((call) => {
    const flagged = naming[call.args.slice(0, 2).join(' ')];
    if (flagged === undefined || call.caller === undefined) return false;
    const named = orcaFlag(call, flagged);
    return named !== undefined && named !== call.caller;
  });
  assert.deepEqual(asOthers, [], `a call made inside a tab names no terminal but its own, got: ${shown(asOthers)}`);
});
