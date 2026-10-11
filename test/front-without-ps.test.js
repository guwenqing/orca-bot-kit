// When `ps` cannot read a tab, the kit asks Orca's runtime who is in front of
// it (#298).
//
// Mail sent from a Codex session never told the receiver. Before it types
// into a session's tab, the kit asks who holds the tab's terminal (ADR 0034):
// the pane pid from `orca diagnostics memory`, then `ps`. Inside Codex's `workspace-write` sandbox, the kit's `auto` level,
// /bin/ps does not start at all: `Operation not permitted`, exit 126, on every
// pid, the caller's own included (seen live, codex-cli 0.156.1). So the gate
// said it could not tell, and typed nothing, for every receiver. The skills
// reload, `obk health`, `obk restart` and `obk up` read a tab's front the same
// way.
//
// So when `ps` cannot read the tab (the pane, or the process in front of it),
// the kit asks Orca's runtime, through Orca's own runtime client out of the
// installed app, run by Orca's binary as plain Node, as the window call does
// (test/orca-window.test.js): `terminal.inspectProcess` on the tab's handle.
// What it answers, seen live on Orca 1.4.212 but for the harness and the
// failures, which were read in Orca's code:
//
//   verdict live, processName a name        that program is in front
//   verdict live, processName null,         that program is in front
//     foregroundProcess a name
//   verdict live, both null, no children    the shell is in front
//   anything else                           the kit cannot tell
//
// "Anything else" is another verdict, a quitting harness (no foreground
// process but children still there), fields missing or of the wrong type, an
// envelope that is not ok, no client, a call that rejects, never settles or
// hangs. Cannot tell keeps what #232 decided: nothing is typed, and the kit
// says it could not tell. The rest of the gate is as ADR 0034 has it: only the
// harness Orca names in `agentIdentity` is typed into, never a tab with a
// question on it, and the shell in front is no harness, plainly. Where `ps`
// reads the tab nothing changes, and Orca's runtime is not asked at all.
//
// Since #555 fleet mail types nothing into a tab. The one key it may send is
// the Escape of `obk message send --interrupt`, into a busy receiver whose tab
// passes the gate. So the mail tests here send with --interrupt to receivers
// that are busy by Orca's tui-idle wait. Where the gate passes the tab, one
// Escape goes in. Where it does not, nothing goes in, and the letter is still
// posted.
//
// The fake `ps` (helpers/fake-ps.js) is made to not start with `ps:
// 'not-permitted'`; the fake app's runtime client (`orcaApp` in
// helpers/cli.js) answers `terminal.inspectProcess` from the same world, or
// with what a test gives one terminal as `inspect`. The runtime's answers in
// the tests below are written out by hand from the shapes above.

import assert from 'node:assert/strict';
import { chmod, writeFile } from 'node:fs/promises';
import test from 'node:test';

import {
  assertCleanFailure,
  createSandbox,
  orcaApp,
  orcaCallsOf,
  orcaFlag,
  sentInto,
  sessionIn,
  spellingsOf,
} from './helpers/cli.js';
import { CODEX_UPDATE_OFFER } from './helpers/screens.js';
import { addSkills, answerOf, assertLinked, botYamlOf, entryOf, kitSkill } from './helpers/skills.js';

// --------------------------------------------------- what the runtime says

/** The `process` Orca's runtime answers, verdict `live`: `foregroundProcess`, `processName`, `hasChildProcesses`. */
const live = (foregroundProcess, processName, hasChildProcesses) => ({
  foregroundProcess,
  hasChildProcesses,
  foregroundProcessEvidence: { verdict: 'live', processName, fence: { generation: 1 } },
});

/** A shell at its prompt, as seen live. */
const SHELL = live(null, null, false);
/** Codex recognised by Orca, as read in Orca's code. */
const CODEX = live('codex', 'codex', true);
/** Codex named only as the foreground process. */
const CODEX_UNNAMED = live('codex', null, true);
/** `less` after the harness quit, as seen live. */
const LESS = live('less', null, true);
/** A `node` program, as seen live. */
const NODE = live('node', null, true);
/** Claude Code recognised by Orca, where a Codex tab was expected. */
const CLAUDE = live('claude', 'claude', true);

/** The envelope every runtime call answers with, around one `process`. */
const envelope = (front, extra = {}) => ({ id: 'rpc_9', ok: true, result: { process: front }, _meta: { durationMs: 1 }, ...extra });

/** The kit could not tell whether a harness is in the tab (#232). */
const COULD_NOT_TELL = /tell/i;

/** What a plain answer says of a tab with only a shell in front. */
const NO_HARNESS = /shell|not up|harness/i;

// ------------------------------------------------------------- the fleet

/**
 * A Claude bot that writes and a Codex bot that reads, both up, nothing typed
 * since, and every tab busy by Orca's tui-idle wait.
 */
async function fleetIn(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  for (const [bot, harness] of [['writer', 'claude'], ['coder', 'codex']]) {
    assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness])).code, 0);
    assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', 'daily'])).code, 0);
  }
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  await box.orca.set({ waitIdle: 'busy' });
  return box.path('bots');
}

/** From here on `ps` does not start, for any pid, as inside Codex's sandbox. */
const sandboxPs = (box) => box.orca.set({ ps: 'not-permitted' });

/**
 * The fleet up, then run from Codex's sandbox: `ps` does not start, and Orca's
 * app with its runtime client (`options`, see `orcaApp`) is the Orca the kit
 * runs.
 */
async function sandboxedFleet(t, options = {}) {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const app = await orcaApp(box, options);
  await sandboxPs(box);
  return { box, bots, app };
}

/** The tab one session lives in, as the book has it, and Orca's own record of it. */
async function tabOf(box, bots, bot, session = 'daily') {
  const { tab } = await sessionIn(bots, bot, session);
  const terminal = (await box.orca.terminals()).find((one) => one.tabId === tab);
  assert.ok(terminal, `the premise: Orca has ${bot} ${session}'s tab ${tab}`);
  return terminal;
}

/** Change one tab of the fake Orca's world, by its tab id, and leave the rest. */
async function changeTab(box, tabId, changes) {
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((one) => (one.tabId === tabId ? { ...one, ...changes } : one)),
  });
}

/** What the runtime answers for the reader's tab alone: `{ process }`, `{ resolves }` or `{ rejects }`. */
async function runtimeSaysForReader(box, bots, inspect) {
  await changeTab(box, (await tabOf(box, bots, 'coder')).tabId, { inspect });
}

/**
 * Send one urgent letter to `to` with --interrupt, plain, and answer what it
 * printed. The letter goes whatever became of the interrupt.
 */
async function send(box, { to = 'coder', from = 'writer/daily', env } = {}) {
  const result = await box.run([
    'message', 'send', '--bots', 'bots', '--to', to, '--from', from,
    '--subject', 'the staging host', '--text', 'It is down again.', '--interrupt',
  ], env === undefined ? {} : { env });
  assert.equal(result.code, 0, `the letter went whatever became of the interrupt: ${result.stdout}${result.stderr}`);
  return `${result.stdout}${result.stderr}`;
}

/** Each `terminal send` into every tab since its launch line, by tab id. */
async function sentSinceLaunch(box) {
  const after = {};
  for (const terminal of await box.orca.terminals()) after[terminal.tabId] = sentInto(terminal).slice(1);
  return after;
}

/** One Escape, with no Enter, into `tabId` and no other tab; and the kit could tell. */
async function assertEscapedOnly(box, tabId, said) {
  const sent = await sentSinceLaunch(box);
  assert.deepEqual(
    sent[tabId].map((one) => ({ text: one.text, enter: one.enter })),
    [{ text: '\x1b', enter: false }],
    `one Escape into the receiver's tab, got: ${JSON.stringify(sent[tabId])}`,
  );
  for (const [tab, keys] of Object.entries(sent)) {
    if (tab !== tabId) assert.deepEqual(keys, [], `nothing may go into ${tab}: it is not the receiver's`);
  }
  assert.doesNotMatch(said, /could not tell|cannot tell/i, `the kit could tell, got: ${said}`);
}

/** Nothing at all went into any tab after its launch line, and the letter is in the mailbox. */
async function assertUntyped(box, what) {
  assert.equal((await box.orca.messages()).length, 1, `${what}: the letter is in the mailbox`);
  assert.deepEqual(Object.values(await sentSinceLaunch(box)).flat(), [], `${what}: and nothing went into any tab`);
}

/** No Escape because the kit could not tell: nothing sent, and the output says so. */
async function assertCouldNotTell(box, said, what) {
  assert.match(said, COULD_NOT_TELL, `${what}: the output says the kit could not tell, got: ${said}`);
  await assertUntyped(box, what);
}

/** No Escape because only a shell is in front: nothing sent, said plainly, and not "cannot tell". */
async function assertNoHarness(box, said, what) {
  assert.match(said, NO_HARNESS, `${what}: the output says no harness is there, got: ${said}`);
  assert.doesNotMatch(said, /could not tell|cannot tell/i, `${what}: the kit knows there is no harness there, got: ${said}`);
  await assertUntyped(box, what);
}

// ---------------------------------------------------------------------------
// F1 — ps does not start; the runtime names the harness Orca names: the Escape goes.
// ---------------------------------------------------------------------------

test('F1 from Codex\'s sandbox, where ps does not start, a busy Codex receiver the runtime finds in front of its tab gets the Escape of --interrupt', async (t) => {
  // The issue itself: a Codex session writes to another, and the receiver's
  // Codex is at work in its tab.
  const { box, bots } = await sandboxedFleet(t);
  const reader = await tabOf(box, bots, 'coder');
  assert.equal(reader.agentIdentity, 'codex', 'the premise: Orca names codex in the receiver\'s tab');

  const said = await send(box);

  await assertEscapedOnly(box, reader.tabId, said);
});

test('F1 from Codex\'s sandbox, a busy Claude receiver the runtime finds in front of its tab gets it too', async (t) => {
  const { box, bots } = await sandboxedFleet(t);
  const writer = await tabOf(box, bots, 'writer');

  const said = await send(box, { to: 'writer', from: 'coder/daily' });

  await assertEscapedOnly(box, writer.tabId, said);
});

test('F1 a harness the runtime gives only as the foreground process, with no processName, gets the Escape when it is the one Orca names', async (t) => {
  // The second road: verdict live, processName null, foregroundProcess the
  // program. The program is the agent Orca names, so the Escape goes in.
  const { box, bots } = await sandboxedFleet(t);
  await runtimeSaysForReader(box, bots, { process: CODEX_UNNAMED });

  const said = await send(box);

  await assertEscapedOnly(box, (await tabOf(box, bots, 'coder')).tabId, said);
});

test('F1 a busy harness the runtime finds in front gets the Escape, as one ps finds does (#232)', async (t) => {
  // Orca's wait times out on a harness at work just as on a shell: the runtime
  // tells them apart.
  const { box, bots } = await sandboxedFleet(t);

  const said = await send(box);

  await assertEscapedOnly(box, (await tabOf(box, bots, 'coder')).tabId, said);
});

test('F1 a ps that cannot be started at all, not only one that exits 126, is a ps that cannot read the tab', async (t) => {
  // The kit may meet the sandbox as a process that will not spawn rather than
  // one that exits: here the file OBK_PS names has no exec bit.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await orcaApp(box);
  const noExec = box.path('ps-no-exec');
  await writeFile(noExec, '#!/bin/sh\necho "this ps must never run" >&2\nexit 70\n');
  await chmod(noExec, 0o644);

  const said = await send(box, { env: { ...box.env, OBK_PS: noExec } });

  await assertEscapedOnly(box, (await tabOf(box, bots, 'coder')).tabId, said);
});

// ---------------------------------------------------------------------------
// F2 — how the runtime is asked.
// ---------------------------------------------------------------------------

test('F2 the runtime is asked terminal.inspectProcess on the receiver\'s own handle, through Orca\'s client with its default profile', async (t) => {
  const { box, bots, app } = await sandboxedFleet(t);
  const reader = await tabOf(box, bots, 'coder');
  const from = (await app.calls()).length;

  await send(box);

  const calls = (await app.calls()).slice(from);
  assert.notEqual(calls.length, 0, 'the runtime should have been asked');
  assert.deepEqual(
    calls,
    calls.map(() => ({ method: 'terminal.inspectProcess', params: { terminal: reader.handle } })),
    `every call is terminal.inspectProcess on the receiver's handle, ${reader.handle}, and nothing else, got: ${JSON.stringify(calls)}`,
  );
  const clients = (await app.clients()).slice(from);
  for (const client of clients) {
    assert.equal(client.profileIsUndefined, true, `the client is made with no profile, which is Orca's default one, got: ${JSON.stringify(client)}`);
    assert.ok(
      Number.isFinite(client.timeoutMs) && client.timeoutMs > 0,
      `and with a wait of some milliseconds, got: ${JSON.stringify(client)}`,
    );
  }
});

test('F2 the client runs as plain Node, without the NODE_OPTIONS or NODE_REPL_EXTERNAL_MODULE of the kit\'s own run', async (t) => {
  const { box, bots, app } = await sandboxedFleet(t);
  const loaded = (await app.loads()).length;

  const said = await send(box, {
    env: { ...box.env, NODE_OPTIONS: '--no-deprecation', NODE_REPL_EXTERNAL_MODULE: box.path('no-such-repl.js') },
  });

  const loads = (await app.loads()).slice(loaded);
  assert.notEqual(loads.length, 0, 'the client was loaded');
  for (const load of loads) assert.deepEqual(load.env, { ELECTRON_RUN_AS_NODE: '1' });
  await assertEscapedOnly(box, (await tabOf(box, bots, 'coder')).tabId, said);
});

// ---------------------------------------------------------------------------
// F3 — the runtime says the shell is in front: no harness, plainly.
// ---------------------------------------------------------------------------

test('F3 a receiver whose shell the runtime finds in front gets no Escape, and the output says no harness is there, not that the kit could not tell', async (t) => {
  // The harness quit; `agentIdentity` still names it. A key sent here goes
  // to zsh. It is the plain case of a tab with no harness, not "cannot tell".
  const { box, bots } = await sandboxedFleet(t);
  await runtimeSaysForReader(box, bots, { process: SHELL });
  assert.equal((await tabOf(box, bots, 'coder')).agentIdentity, 'codex', 'the premise: Orca still names codex');

  const said = await send(box);

  await assertNoHarness(box, said, 'the shell in front');
});

// ---------------------------------------------------------------------------
// F4 — a program in front that is not the harness Orca names: nothing typed.
// ---------------------------------------------------------------------------

for (const [label, front] of [
  ['`less`, after the Codex Orca still names quit', LESS],
  ['a `node` program', NODE],
  ['Claude Code, in a tab Orca names codex', CLAUDE],
]) {
  test(`F4 ${label} in front, as the runtime says, gets no Escape, and the kit cannot tell whether a harness is up`, async (t) => {
    const { box, bots } = await sandboxedFleet(t);
    await runtimeSaysForReader(box, bots, { process: front });

    const said = await send(box);

    await assertCouldNotTell(box, said, label);
  });
}

test('F4 Codex in front as the runtime says, in a tab where Orca names no agent, gets no Escape', async (t) => {
  // Only the harness Orca names gets a key (ADR 0034). With no name the kit
  // cannot tell a harness a few seconds into its launch from anything else.
  const { box, bots } = await sandboxedFleet(t);
  await changeTab(box, (await tabOf(box, bots, 'coder')).tabId, { agentIdentity: null, inspect: { process: CODEX } });

  const said = await send(box);

  await assertCouldNotTell(box, said, 'no agentIdentity');
});

// ---------------------------------------------------------------------------
// F5 — answers the kit cannot read as a front: cannot tell.
// ---------------------------------------------------------------------------

// Each of these carries, where it can, a name that would get the Escape were
// the rest of the answer ignored.
const UNREADABLE_ANSWERS = [
  ['verdict unverifiable, with a reason', {
    process: {
      foregroundProcess: 'codex',
      hasChildProcesses: true,
      foregroundProcessEvidence: { verdict: 'unverifiable', processName: 'codex', reason: 'the pane was replaced while it was read', fence: { generation: 1 } },
    },
  }],
  ['verdict exited', {
    process: {
      foregroundProcess: 'codex',
      hasChildProcesses: true,
      foregroundProcessEvidence: { verdict: 'exited', processName: 'codex', fence: { generation: 1 } },
    },
  }],
  ['no verdict at all', {
    process: { foregroundProcess: 'codex', hasChildProcesses: true, foregroundProcessEvidence: { processName: 'codex', fence: { generation: 1 } } },
  }],
  ['no evidence at all', { process: { foregroundProcess: 'codex', hasChildProcesses: true } }],
  ['a harness quitting: no foreground process, children still there', { process: live(null, null, true) }],
  ['no word on children, and no foreground process', {
    process: { foregroundProcess: null, foregroundProcessEvidence: { verdict: 'live', processName: null, fence: { generation: 1 } } },
  }],
  // A falsy number where a boolean or a name belongs reads as "no" or "none"
  // to a loose check, and so as the shell; a missing processName as null.
  ['children given as a number', { process: live(null, null, 0) }],
  ['a processName that is a number', { process: live('codex', 0, true) }],
  ['no processName at all, and codex as the foreground process', {
    process: { foregroundProcess: 'codex', hasChildProcesses: true, foregroundProcessEvidence: { verdict: 'live', fence: { generation: 1 } } },
  }],
  ['a foregroundProcess that is a number', { process: live(0, null, false) }],
  ['an envelope that is not ok', { resolves: envelope(CODEX, { ok: false }) }],
  ['an envelope with no result', { resolves: { id: 'rpc_9', ok: true, _meta: { durationMs: 1 } } }],
  ['a result with no process', { resolves: { id: 'rpc_9', ok: true, result: {}, _meta: { durationMs: 1 } } }],
  ['an answer that is not an envelope', { resolves: 'codex' }],
  ['a call that rejects, as for a handle Orca no longer knows', { rejects: 'Terminal not found' }],
];

for (const [label, inspect] of UNREADABLE_ANSWERS) {
  test(`F5 when the runtime answers ${label}, the kit cannot tell: no Escape, and it says so`, async (t) => {
    const { box, bots } = await sandboxedFleet(t);
    await runtimeSaysForReader(box, bots, inspect);

    const said = await send(box);

    await assertCouldNotTell(box, said, label);
  });
}

// ---------------------------------------------------------------------------
// F6 — a runtime client out of reach, or one that misbehaves: cannot tell.
// ---------------------------------------------------------------------------

for (const [label, client] of [
  ['there is no client file', 'missing'],
  ['the client file has no RuntimeClient export', 'no-export'],
  ['every call rejects with method_not_found', 'method-not-found'],
  ['the call never settles, and nothing holds the client process', 'never-settles'],
]) {
  test(`F6 when ${label}, the kit cannot tell: no Escape, and it says so`, async (t) => {
    const { box } = await sandboxedFleet(t, { client });

    const said = await send(box);

    await assertCouldNotTell(box, said, label);
  });
}

test('F6 with no Orca app at all, only a CLI, the kit cannot tell: no Escape, and it says so', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);
  await sandboxPs(box);

  const said = await send(box);

  await assertCouldNotTell(box, said, 'no app');
});

test('F6 with the Orca executable missing from the app, the kit cannot tell: no Escape, and it says so', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);
  await orcaApp(box, { executable: false });
  await sandboxPs(box);

  const said = await send(box);

  await assertCouldNotTell(box, said, 'no executable');
});

test('F6 a client that hangs holds the send up a few seconds at most, and the kit cannot tell', async (t) => {
  // The window call's client is given 3 s; this one likewise. The fake hangs
  // for a few seconds, 8, then ends by itself and writes down that it did: a
  // kit that waited on it that long finds the note there when the send is
  // done. Not a timing of the send, which a loaded machine stretches (#381):
  // load can only start the client later, and so end its hang later still.
  const works = await sandboxedFleet(t);
  const worked = await send(works.box);
  await assertEscapedOnly(works.box, (await tabOf(works.box, works.bots, 'coder')).tabId, worked);

  const hung = await sandboxedFleet(t, { client: 'hangs', hangMs: 8000 });
  const said = await send(hung.box);

  await assertCouldNotTell(hung.box, said, 'a hung client');
  assert.deepEqual(await hung.app.ended(), [], 'the kit stopped waiting on the client before its 8 s were up');
});

// ---------------------------------------------------------------------------
// F7 — where ps reads the tab, nothing changes and the runtime is not asked.
// ---------------------------------------------------------------------------

test('F7 where ps finds the harness in front, the receiver gets the Escape and Orca\'s runtime is neither loaded nor called, whatever it would say', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const app = await orcaApp(box);
  // The runtime would say the shell: a kit that asked it would send nothing.
  await runtimeSaysForReader(box, bots, { process: SHELL });
  const loaded = (await app.loads()).length;
  const called = (await app.calls()).length;

  const said = await send(box);

  await assertEscapedOnly(box, (await tabOf(box, bots, 'coder')).tabId, said);
  assert.deepEqual((await app.loads()).slice(loaded), [], 'the runtime client was not loaded');
  assert.deepEqual((await app.calls()).slice(called), [], 'and not called');
});

test('F7 where ps finds the shell in front, no Escape goes and Orca\'s runtime is neither loaded nor called, whatever it would say', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const app = await orcaApp(box);
  // The runtime would say Codex: a kit that asked it would send the Escape.
  await changeTab(box, (await tabOf(box, bots, 'coder')).tabId, { foreground: 'shell', inspect: { process: CODEX } });
  const loaded = (await app.loads()).length;
  const called = (await app.calls()).length;

  const said = await send(box);

  await assertNoHarness(box, said, 'ps finds the shell');
  assert.deepEqual((await app.loads()).slice(loaded), [], 'the runtime client was not loaded');
  assert.deepEqual((await app.calls()).slice(called), [], 'and not called');
});

test('F7 where ps finds `less` in front of a Codex tab, no Escape goes and Orca\'s runtime is not asked, whatever it would say', async (t) => {
  // ps read the tab: what it found stands, though it is "cannot tell".
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const app = await orcaApp(box);
  await changeTab(box, (await tabOf(box, bots, 'coder')).tabId, { foreground: 'program', inspect: { process: CODEX } });
  const loaded = (await app.loads()).length;
  const called = (await app.calls()).length;

  const said = await send(box);

  await assertCouldNotTell(box, said, 'ps finds less');
  assert.deepEqual((await app.loads()).slice(loaded), [], 'the runtime client was not loaded');
  assert.deepEqual((await app.calls()).slice(called), [], 'and not called');
});

// ---------------------------------------------------------------------------
// F8 — ps fails on the pane alone, or on the process in front: the runtime.
// ---------------------------------------------------------------------------

for (const [label, foreground] of [
  ['ps cannot read the pane\'s pid', 'ps-fails'],
  ['the process in front is gone before ps can read it', 'gone'],
]) {
  test(`F8 when ${label}, outside any sandbox, the runtime is asked, and a harness it finds gets the Escape`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    const app = await orcaApp(box);
    const reader = await tabOf(box, bots, 'coder');
    await changeTab(box, reader.tabId, { foreground, inspect: { process: CODEX } });
    const called = (await app.calls()).length;

    const said = await send(box);

    await assertEscapedOnly(box, reader.tabId, said);
    assert.ok(
      (await app.calls()).slice(called).some((call) => call.method === 'terminal.inspectProcess' && call.params?.terminal === reader.handle),
      `the runtime was asked about the receiver's tab, got: ${JSON.stringify(await app.calls())}`,
    );
  });

  test(`F8 when ${label}, and the runtime finds the shell, no Escape goes, plainly`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    await orcaApp(box);
    await changeTab(box, (await tabOf(box, bots, 'coder')).tabId, { foreground, inspect: { process: SHELL } });

    const said = await send(box);

    await assertNoHarness(box, said, label);
  });
}

// ---------------------------------------------------------------------------
// F9 — a question on the tab still stops the Escape.
// ---------------------------------------------------------------------------

test('F9 a harness the runtime finds, with Orca\'s blockedReason on its tab, gets no Escape, and the output names Orca\'s reason', async (t) => {
  const { box } = await sandboxedFleet(t);
  await box.orca.set({ waitIdle: 'blocked' });

  const said = await send(box);

  assert.ok(said.includes('agent-interactive-prompt'), `Orca's reason, got: ${said}`);
  await assertUntyped(box, 'blocked');
});

test('F9 a Codex the runtime finds, on its update offer, gets no Escape: the kit\'s own screen reading still stands', async (t) => {
  // A return typed into that screen took "Update now" (#329), and an Escape
  // answers it too.
  const { box, bots } = await sandboxedFleet(t);
  await changeTab(box, (await tabOf(box, bots, 'coder')).tabId, { screen: CODEX_UPDATE_OFFER });

  const said = await send(box);

  assert.ok(said.includes('question-on-screen'), `the question on its screen, got: ${said}`);
  await assertUntyped(box, 'the update offer');
});

// ---------------------------------------------------------------------------
// F10 — the skills reload reads the tab the same way.
// ---------------------------------------------------------------------------

/** One of the kit's own skills, for a list to change. */
const KIT_SKILL = 'obk-tdd';

/** Claude Code's own command for picking up skills changed on disk. */
const RELOAD = '/reload-skills';

/** Bot Father, and `api-bot` with a Claude session and a Codex one, up, then run from Codex's sandbox. */
async function sandboxedSkillsFleet(t) {
  const box = await createSandbox(t);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude'])).code, 0);
  for (const [session, harness] of [['daily', 'claude'], ['reviewer', 'codex']]) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', session, '--harness', harness]);
    assert.equal(added.code, 0, added.stderr);
  }
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  await orcaApp(box);
  await sandboxPs(box);
  const bots = box.path('bots');
  await addSkills(botYamlOf(bots, 'api-bot'), `kit:${KIT_SKILL}`);
  return { box, bots };
}

/** `obk skills build --json`, and api-bot's session entries in its answer. */
async function built(box) {
  const result = await box.run(['skills', 'build', '--bots', 'bots', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const entry = entryOf(answerOf(result), 'api-bot');
  assert.ok(Array.isArray(entry.sessions), `api-bot's links changed, so its entry lists its sessions, got: ${JSON.stringify(entry)}`);
  return entry.sessions;
}

test('F10 from Codex\'s sandbox, a skills build reloads the Claude session the runtime finds in front, and the Codex one takes it next turn', async (t) => {
  const { box, bots } = await sandboxedSkillsFleet(t);

  const sessions = await built(box);

  assert.deepEqual(
    sessions.map((entry) => [entry.session, entry.state]),
    [['daily', 'reloaded'], ['reviewer', 'next-turn']],
    `got: ${JSON.stringify(sessions)}`,
  );
  const own = (await sessionIn(bots, 'api-bot', 'daily')).tab;
  for (const [tab, lines] of Object.entries(await sentSinceLaunch(box))) {
    assert.deepEqual(lines, tab === own ? [{ text: RELOAD, enter: true }] : [], `what was typed into ${tab}`);
  }
  await assertLinked(bots, 'api-bot', KIT_SKILL, await kitSkill(KIT_SKILL));
});

test('F10 from Codex\'s sandbox, sessions whose shell the runtime finds in front are reported not up, and nothing is typed', async (t) => {
  const { box } = await sandboxedSkillsFleet(t);
  await box.orca.set({ foreground: 'shell' });

  const sessions = await built(box);

  assert.deepEqual(
    sessions.map((entry) => [entry.session, entry.state]),
    [['daily', 'not-up'], ['reviewer', 'not-up']],
    `got: ${JSON.stringify(sessions)}`,
  );
  assert.deepEqual(Object.values(await sentSinceLaunch(box)).flat(), []);
});

test('F10 from Codex\'s sandbox, a runtime answer the kit cannot read leaves the sessions unknown, with why, and nothing is typed', async (t) => {
  const { box, bots } = await sandboxedSkillsFleet(t);
  const unverifiable = {
    process: {
      foregroundProcess: 'claude',
      hasChildProcesses: true,
      foregroundProcessEvidence: { verdict: 'unverifiable', processName: 'claude', reason: 'the pane was replaced while it was read', fence: { generation: 1 } },
    },
  };
  const daily = (await sessionIn(bots, 'api-bot', 'daily')).tab;
  const reviewer = (await sessionIn(bots, 'api-bot', 'reviewer')).tab;
  await changeTab(box, daily, { inspect: unverifiable });
  await changeTab(box, reviewer, { inspect: unverifiable });

  const sessions = await built(box);

  assert.deepEqual(sessions.map((entry) => [entry.session, entry.state]), [['daily', 'unknown'], ['reviewer', 'unknown']]);
  for (const entry of sessions) {
    assert.equal(typeof entry.trouble, 'string', `why ${entry.session} was not told, got: ${JSON.stringify(entry)}`);
    assert.notEqual(entry.trouble.trim(), '');
  }
  assert.deepEqual(Object.values(await sentSinceLaunch(box)).flat(), []);
});

// ---------------------------------------------------------------------------
// F11 — obk health reads the tab the same way.
// ---------------------------------------------------------------------------

/** Words that call a session not running (test/health-shell-in-front.test.js). */
const NOT_RUNNING = /\b(?:not|isn't|is no longer|no longer)\s+running\b|\bdown\b/i;

/** Whether `word` is in `text` as a word of its own. */
const hasWord = (text, word) => new RegExp(`(^|[^A-Za-z0-9_-])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9_-])`).test(text);

/** The findings of a health answer about one session of api-bot. */
const findingsAbout = (answer, session) => answer.found.filter((one) => one.bot === 'api-bot' && hasWord(`${one.where} ${one.says}`, session));

test('F11 from Codex\'s sandbox, health reads each tab through the runtime: harness running, shell down with its restart, unreadable unknown', async (t) => {
  const box = await createSandbox(t);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'codex'])).code, 0);
  for (const session of ['daily', 'review', 'nightly']) {
    assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', session])).code, 0);
  }
  assert.equal((await box.run(['up', '--bots', 'bots', '--bot', 'api-bot'])).code, 0);
  const bots = box.path('bots');
  await orcaApp(box);
  await sandboxPs(box);
  // daily: Codex in front, which the runtime finds from the fake's world.
  await changeTab(box, (await sessionIn(bots, 'api-bot', 'review')).tab, { foreground: 'shell' });
  await changeTab(box, (await sessionIn(bots, 'api-bot', 'nightly')).tab, { inspect: { process: live(null, null, true) } });

  const result = await box.run(['health', '--bots', 'bots', '--json']);

  assert.equal(result.stderr, '', `health reports on stdout, got: ${result.stderr}`);
  const answer = JSON.parse(result.stdout);
  const running = (session) => answer.sessions.find((one) => one.bot === 'api-bot' && one.session === session)?.running;
  assert.equal(running('daily'), 'yes', `daily's Codex is in front, got: ${JSON.stringify(answer.sessions, null, 2)}`);
  assert.equal(running('nightly'), 'unknown', `nothing says whether nightly's harness is there, got: ${JSON.stringify(answer.sessions, null, 2)}`);

  const review = findingsAbout(answer, 'review');
  assert.equal(review.length, 1, `one finding about review, whose shell is in front, got: ${JSON.stringify(answer.found, null, 2)}`);
  assert.match(review[0].says, NOT_RUNNING, `it says review is not running, got: ${review[0].says}`);
  assert.ok(
    spellingsOf(box.cli).some((cli) => review[0].says.includes(`${cli} restart `)) && hasWord(review[0].says, '--session review'),
    `with the restart that brings it back, got: ${review[0].says}`,
  );
  for (const session of ['daily', 'nightly']) {
    for (const one of findingsAbout(answer, session)) {
      assert.doesNotMatch(one.says, /\brestart\b/, `${session} is not known to be down, got: ${JSON.stringify(one)}`);
    }
  }
  assert.equal(result.code, 1, 'a finding makes health exit 1');
});

// ---------------------------------------------------------------------------
// F12 — obk restart reads the tab the same way.
// ---------------------------------------------------------------------------

/** api-bot on Codex with one session, `daily`, up and with no conversation in the book, then run from Codex's sandbox. */
async function sandboxedRestartFleet(t) {
  const box = await createSandbox(t);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'codex'])).code, 0);
  assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily'])).code, 0);
  assert.equal((await box.run(['up', '--bots', 'bots', '--bot', 'api-bot'])).code, 0);
  const bots = box.path('bots');
  assert.equal((await sessionIn(bots, 'api-bot', 'daily')).session, undefined, 'the premise: the book names no conversation');
  await orcaApp(box);
  await sandboxPs(box);
  return { box, bots };
}

test('F12 from Codex\'s sandbox, restart of a tab whose shell the runtime finds in front, with no conversation, closes it and starts the session fresh', async (t) => {
  const { box, bots } = await sandboxedRestartFleet(t);
  const before = await tabOf(box, bots, 'api-bot');
  await changeTab(box, before.tabId, { foreground: 'shell' });
  const from = (await box.orca.calls()).length;

  const result = await box.run(['restart', '--bots', 'bots', '--bot', 'api-bot', '--session', 'daily']);

  assert.equal(result.code, 0, `restart should bring daily back: ${result.stderr}${result.stdout}`);
  const calls = (await box.orca.calls()).slice(from);
  assert.deepEqual(orcaCallsOf(calls, 'terminal close').map((call) => orcaFlag(call, '--terminal')), [before.handle], 'daily\'s tab, once, by its handle');
  assert.equal(orcaCallsOf(calls, 'terminal create').length, 1, 'and one tab opened in its place');
  assert.notEqual((await sessionIn(bots, 'api-bot', 'daily')).tab, before.tabId, 'the book follows daily to its new tab');
});

test('F12 from Codex\'s sandbox, restart of a tab whose Codex the runtime finds in front, with no conversation, is refused and closes nothing', async (t) => {
  // That tab may hold the conversation.
  const { box, bots } = await sandboxedRestartFleet(t);
  const terminals = await box.orca.terminals();
  const book = await sessionIn(bots, 'api-bot', 'daily');
  const from = (await box.orca.calls()).length;

  const result = await box.run(['restart', '--bots', 'bots', '--bot', 'api-bot', '--session', 'daily']);

  assertCleanFailure(result);
  assert.deepEqual(orcaCallsOf((await box.orca.calls()).slice(from), 'terminal close'), [], 'nothing closed');
  assert.deepEqual(await box.orca.terminals(), terminals, 'every tab as it was');
  assert.deepEqual(await sessionIn(bots, 'api-bot', 'daily'), book, 'and the book unchanged');
});

// ---------------------------------------------------------------------------
// F13 — obk up reads the tab it started the same way.
// ---------------------------------------------------------------------------

/** A bots folder with `tab-bot` on Codex and one session, not yet up, run from Codex's sandbox. */
async function sandboxedUp(t, state) {
  const box = await createSandbox(t);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'tab-bot', '--harness', 'codex'])).code, 0);
  assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', 'tab-bot', '--name', 'daily'])).code, 0);
  await orcaApp(box);
  await sandboxPs(box);
  await box.orca.set(state);
  const result = await box.run(['up', '--bots', 'bots', '--bot', 'tab-bot', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const tabs = JSON.parse(result.stdout).tabs;
  assert.equal(tabs.length, 1, `one tab reported, got: ${result.stdout}`);
  return tabs[0];
}

test('F13 from Codex\'s sandbox, a harness the runtime finds busy in its new tab is reported started, though Orca\'s wait timed out and names no agent', async (t) => {
  // What ps would have said (test/harness-in-tab.test.js); without ps, Orca's
  // own answers alone would call it not started.
  const entry = await sandboxedUp(t, { waitIdle: 'busy', agentIdentity: null });

  assert.equal(entry.harnessStarted, true, `got: ${JSON.stringify(entry)}`);
});

test('F13 from Codex\'s sandbox, a new tab whose shell the runtime finds in front is reported not started, though Orca\'s wait was ok', async (t) => {
  // A harness that came up and quit: ps would have found the shell.
  const entry = await sandboxedUp(t, { waitIdle: true, foreground: 'shell' });

  assert.equal(entry.harnessStarted, false, `got: ${JSON.stringify(entry)}`);
});

// ---------------------------------------------------------------------------
// F14 — an Orca slow to start, as on a busy machine, answers all the same (#384).
// ---------------------------------------------------------------------------

// The kit gives Orca's runtime client a few seconds, 3. Timed live beside the
// full unit suite, the real client took at most 721 ms to answer. Here the
// fake app's binary sleeps 1 s before its Node starts, which leaves the fake's
// own Node start the rest: the runtime's answer still decides, as on a quiet
// machine, and the kit does not fall back to "cannot tell". Each test also
// reads from the fake that every client the kit started ended by itself with
// the answer printed, at least 1 s after its binary started: a slow-down that
// did nothing does not pass.

/** One second: past the slowest real client measured (#384). */
const SLOW_START_MS = 1000;

/** Each client started since `from` exits printed the runtime's answer, no sooner than SLOW_START_MS after its binary started. */
async function assertAnsweredSlowly(app, from) {
  const exits = (await app.exits()).slice(from);
  assert.notEqual(exits.length, 0, 'the runtime client ran and ended by itself');
  for (const exit of exits) {
    assert.equal(exit.code, 0, `each client printed the runtime's answer and was not killed, got: ${JSON.stringify(exits)}`);
    assert.ok(
      exit.sinceStartMs >= SLOW_START_MS,
      `each answered at least ${SLOW_START_MS} ms after its binary started: the start was slowed, got: ${JSON.stringify(exits)}`,
    );
  }
}

test('F14 with Orca 1 s slow to start, from Codex\'s sandbox a busy Codex receiver the runtime finds in front still gets the Escape', async (t) => {
  const { box, bots, app } = await sandboxedFleet(t, { startDelayMs: SLOW_START_MS });
  const from = (await app.exits()).length;

  const said = await send(box);

  await assertEscapedOnly(box, (await tabOf(box, bots, 'coder')).tabId, said);
  await assertAnsweredSlowly(app, from);
});

test('F14 with Orca 1 s slow to start, a receiver whose shell the runtime finds in front is still found to have no harness, and gets no Escape', async (t) => {
  const { box, bots, app } = await sandboxedFleet(t, { startDelayMs: SLOW_START_MS });
  await runtimeSaysForReader(box, bots, { process: SHELL });
  const from = (await app.exits()).length;

  const said = await send(box);

  await assertNoHarness(box, said, 'the shell in front');
  await assertAnsweredSlowly(app, from);
});
