// When `ps` cannot read a tab, the kit asks Orca's runtime who is in front of
// it (#298).
//
// Mail sent from a Codex session never told the receiver. Before it types the
// one line that says mail is waiting, the kit asks who holds the tab's
// terminal (ADR 0023): the pane pid from `orca diagnostics memory`, then
// `ps`. Inside Codex's `workspace-write` sandbox, the kit's `auto` level,
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
// says it could not tell. The rest of the gate is as ADR 0023 has it: only the
// harness Orca names in `agentIdentity` is typed into, never a tab with a
// question on it, and the shell in front is no harness, plainly. Where `ps`
// reads the tab nothing changes, and Orca's runtime is not asked at all.
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
  typedInto,
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

/** The words of the sentence the kit gives when it cannot tell (#232). */
const COULD_NOT_TELL = /could not tell whether a harness is running in it/;

// ------------------------------------------------------------- the fleet

/** A Claude bot that writes and a Codex bot that reads, both up, nothing typed since. */
async function fleetIn(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  for (const [bot, harness] of [['writer', 'claude'], ['coder', 'codex']]) {
    assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness])).code, 0);
    assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', 'daily'])).code, 0);
  }
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  return box.path('bots');
}

/** From here on `ps` does not start, for any pid, as inside Codex's sandbox. */
const sandboxPs = (box) => box.orca.set({ ps: 'not-permitted' });

/**
 * The fleet up, then run from Codex's sandbox: `ps` does not start, and Orca's
 * app with its runtime client (`client`, see `orcaApp`) is the Orca the kit
 * runs.
 */
async function sandboxedFleet(t, { client } = {}) {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const app = await orcaApp(box, client === undefined ? {} : { client });
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

/** Send one message to `to`, `--json`, and read the answer. The message goes whatever became of the nudge. */
async function send(box, { to = 'coder', from = 'writer/daily', env } = {}) {
  const result = await box.run([
    'message', 'send', '--bots', 'bots', '--to', to, '--from', from,
    '--subject', 'the staging host', '--text', 'It is down again.', '--json',
  ], env === undefined ? {} : { env });
  assert.equal(result.code, 0, `the message went whatever became of the nudge: ${result.stdout}${result.stderr}`);
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  assert.equal(answer.sent, true, `the message is sent whatever became of the nudge, got: ${result.stdout}`);
  return answer;
}

/** What was typed into every tab of the whole fleet, after the launch line each one got. */
async function typedSinceLaunch(box) {
  const after = {};
  for (const terminal of await box.orca.terminals()) {
    after[terminal.tabId] = typedInto(terminal).slice(1);
  }
  return after;
}

/** One nudge, into `tabId` and no other tab: the line that says how to read the mail. */
async function assertNudgedOnly(box, tabId, answer) {
  assert.equal(answer.nudged, true, `the tab should have been told, got: ${JSON.stringify(answer)}`);
  assert.equal('nudgeTrouble' in answer, false, `nothing went wrong with the nudge, got: ${JSON.stringify(answer)}`);
  const typed = await typedSinceLaunch(box);
  assert.equal(typed[tabId].length, 1, `one line into the receiver's tab, got: ${JSON.stringify(typed[tabId])}`);
  assert.ok(
    spellingsOf(box.cli).some((cli) => typed[tabId][0].includes(`${cli} message check --bots `)),
    `the nudge, which says how to read the mail, got: ${typed[tabId][0]}`,
  );
  for (const [tab, lines] of Object.entries(typed)) {
    if (tab !== tabId) assert.deepEqual(lines, [], `nothing may be typed into ${tab}: it is not the receiver's`);
  }
}

/** Nothing at all was typed into any tab after its launch line, and the message is in the mailbox. */
async function assertUntyped(box, what) {
  assert.equal((await box.orca.messages()).length, 1, `${what}: the message is in the mailbox`);
  assert.deepEqual(Object.values(await typedSinceLaunch(box)).flat(), [], `${what}: and nothing was typed into any tab`);
}

/** Not nudged because the kit could not tell: nothing typed, and the sentence that says so. */
async function assertCouldNotTell(box, answer, what) {
  assert.equal(answer.nudged, false, `${what}: got ${JSON.stringify(answer)}`);
  assert.equal(typeof answer.nudgeTrouble, 'string', `${what}: a sentence saying the kit could not tell, got ${JSON.stringify(answer)}`);
  assert.match(answer.nudgeTrouble, COULD_NOT_TELL, `${what}: got ${JSON.stringify(answer)}`);
  await assertUntyped(box, what);
}

// ---------------------------------------------------------------------------
// F1 — ps does not start; the runtime names the harness Orca names: nudged.
// ---------------------------------------------------------------------------

test('F1 from Codex\'s sandbox, where ps does not start, a Codex receiver the runtime finds in front of its tab is told its mail is there', async (t) => {
  // The issue itself: a Codex session writes to another, and the receiver's
  // Codex is idle in its tab.
  const { box, bots } = await sandboxedFleet(t);
  const reader = await tabOf(box, bots, 'coder');
  assert.equal(reader.agentIdentity, 'codex', 'the premise: Orca names codex in the receiver\'s tab');

  const answer = await send(box);

  await assertNudgedOnly(box, reader.tabId, answer);
});

test('F1 from Codex\'s sandbox, a Claude receiver the runtime finds in front of its tab is told too', async (t) => {
  const { box, bots } = await sandboxedFleet(t);
  const writer = await tabOf(box, bots, 'writer');

  const answer = await send(box, { to: 'writer', from: 'coder/daily' });

  await assertNudgedOnly(box, writer.tabId, answer);
});

test('F1 a harness the runtime gives only as the foreground process, with no processName, is told when it is the one Orca names', async (t) => {
  // The second road: verdict live, processName null, foregroundProcess the
  // program. The program is the agent Orca names, so it is typed into.
  const { box, bots } = await sandboxedFleet(t);
  await runtimeSaysForReader(box, bots, { process: CODEX_UNNAMED });

  const answer = await send(box);

  await assertNudgedOnly(box, (await tabOf(box, bots, 'coder')).tabId, answer);
});

test('F1 a busy harness the runtime finds in front is told, as one ps finds is (#232)', async (t) => {
  // Orca's wait times out on a harness at work just as on a shell; a busy
  // harness takes a typed line as its next turn.
  const { box, bots } = await sandboxedFleet(t);
  await box.orca.set({ waitIdle: 'busy' });

  const answer = await send(box);

  await assertNudgedOnly(box, (await tabOf(box, bots, 'coder')).tabId, answer);
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

  const answer = await send(box, { env: { ...box.env, OBK_PS: noExec } });

  await assertNudgedOnly(box, (await tabOf(box, bots, 'coder')).tabId, answer);
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

  const answer = await send(box, {
    env: { ...box.env, NODE_OPTIONS: '--no-deprecation', NODE_REPL_EXTERNAL_MODULE: box.path('no-such-repl.js') },
  });

  const loads = (await app.loads()).slice(loaded);
  assert.notEqual(loads.length, 0, 'the client was loaded');
  for (const load of loads) assert.deepEqual(load.env, { ELECTRON_RUN_AS_NODE: '1' });
  await assertNudgedOnly(box, (await tabOf(box, bots, 'coder')).tabId, answer);
});

// ---------------------------------------------------------------------------
// F3 — the runtime says the shell is in front: no harness, plainly.
// ---------------------------------------------------------------------------

test('F3 a receiver whose shell the runtime finds in front is not up: nothing is typed, and it is not a trouble', async (t) => {
  // The harness quit; `agentIdentity` still names it. A line typed here goes
  // to zsh as a command. It is the plain "not nudged" of a tab with no
  // harness, not "cannot tell".
  const { box, bots } = await sandboxedFleet(t);
  await runtimeSaysForReader(box, bots, { process: SHELL });
  assert.equal((await tabOf(box, bots, 'coder')).agentIdentity, 'codex', 'the premise: Orca still names codex');

  const answer = await send(box);

  assert.equal(answer.nudged, false, `got: ${JSON.stringify(answer)}`);
  assert.equal('nudgeTrouble' in answer, false, `the kit knows there is no harness there, got: ${JSON.stringify(answer)}`);
  assert.equal('blocked' in answer, false, `and nothing is waiting to be answered, got: ${JSON.stringify(answer)}`);
  await assertUntyped(box, 'the shell in front');
});

test('F3 the plain run says the receiver is not up, as it does when ps finds the shell', async (t) => {
  const { box, bots } = await sandboxedFleet(t);
  await runtimeSaysForReader(box, bots, { process: SHELL });

  const result = await box.run([
    'message', 'send', '--bots', 'bots', '--to', 'coder', '--from', 'writer/daily',
    '--subject', 'the staging host', '--text', 'It is down again.',
  ]);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /not up/, `got: ${result.stdout}`);
  assert.doesNotMatch(result.stdout, COULD_NOT_TELL, `got: ${result.stdout}`);
  await assertUntyped(box, 'the shell in front');
});

// ---------------------------------------------------------------------------
// F4 — a program in front that is not the harness Orca names: nothing typed.
// ---------------------------------------------------------------------------

for (const [label, front] of [
  ['`less`, after the Codex Orca still names quit', LESS],
  ['a `node` program', NODE],
  ['Claude Code, in a tab Orca names codex', CLAUDE],
]) {
  test(`F4 ${label} in front, as the runtime says, is not typed into, and the kit cannot tell whether a harness is up`, async (t) => {
    const { box, bots } = await sandboxedFleet(t);
    await runtimeSaysForReader(box, bots, { process: front });

    const answer = await send(box);

    await assertCouldNotTell(box, answer, label);
  });
}

test('F4 Codex in front as the runtime says, in a tab where Orca names no agent, is not typed into', async (t) => {
  // Only the harness Orca names is typed into (ADR 0023). With no name the kit
  // cannot tell a harness a few seconds into its launch from anything else.
  const { box, bots } = await sandboxedFleet(t);
  await changeTab(box, (await tabOf(box, bots, 'coder')).tabId, { agentIdentity: null, inspect: { process: CODEX } });

  const answer = await send(box);

  await assertCouldNotTell(box, answer, 'no agentIdentity');
});

// ---------------------------------------------------------------------------
// F5 — answers the kit cannot read as a front: cannot tell.
// ---------------------------------------------------------------------------

// Each of these carries, where it can, a name that would be typed into were
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
  test(`F5 when the runtime answers ${label}, the kit cannot tell: nothing is typed, and it says so`, async (t) => {
    const { box, bots } = await sandboxedFleet(t);
    await runtimeSaysForReader(box, bots, inspect);

    const answer = await send(box);

    await assertCouldNotTell(box, answer, label);
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
  test(`F6 when ${label}, the kit cannot tell: nothing is typed, and it says so`, async (t) => {
    const { box } = await sandboxedFleet(t, { client });

    const answer = await send(box);

    await assertCouldNotTell(box, answer, label);
  });
}

test('F6 with no Orca app at all, only a CLI, the kit cannot tell: nothing is typed, and it says so', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);
  await sandboxPs(box);

  const answer = await send(box);

  await assertCouldNotTell(box, answer, 'no app');
});

test('F6 with the Orca executable missing from the app, the kit cannot tell: nothing is typed, and it says so', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);
  await orcaApp(box, { executable: false });
  await sandboxPs(box);

  const answer = await send(box);

  await assertCouldNotTell(box, answer, 'no executable');
});

test('F6 a client that hangs holds the send up a few seconds at most, and the kit cannot tell', async (t) => {
  // The window call's client is given 3 s; this one likewise. The fake hangs
  // for CLIENT_HANG_MS, far past any wait the kit should make.
  const timed = async (client) => {
    const { box } = await sandboxedFleet(t, { client });
    const started = Date.now();
    const answer = await send(box);
    return { box, answer, took: Date.now() - started };
  };
  const works = await timed('answers');
  assert.equal(works.answer.nudged, true, `the premise: a working client gets the nudge through, got: ${JSON.stringify(works.answer)}`);

  const hung = await timed('hangs');

  await assertCouldNotTell(hung.box, hung.answer, 'a hung client');
  assert.ok(
    hung.took - works.took < 8000,
    `a client that hangs held the send ${hung.took} ms against ${works.took} ms for a working one`,
  );
});

// ---------------------------------------------------------------------------
// F7 — where ps reads the tab, nothing changes and the runtime is not asked.
// ---------------------------------------------------------------------------

test('F7 where ps finds the harness in front, the receiver is told and Orca\'s runtime is neither loaded nor called, whatever it would say', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const app = await orcaApp(box);
  // The runtime would say the shell: a kit that asked it would not type.
  await runtimeSaysForReader(box, bots, { process: SHELL });
  const loaded = (await app.loads()).length;
  const called = (await app.calls()).length;

  const answer = await send(box);

  await assertNudgedOnly(box, (await tabOf(box, bots, 'coder')).tabId, answer);
  assert.deepEqual((await app.loads()).slice(loaded), [], 'the runtime client was not loaded');
  assert.deepEqual((await app.calls()).slice(called), [], 'and not called');
});

test('F7 where ps finds the shell in front, nothing is typed and Orca\'s runtime is neither loaded nor called, whatever it would say', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const app = await orcaApp(box);
  // The runtime would say Codex: a kit that asked it would type.
  await changeTab(box, (await tabOf(box, bots, 'coder')).tabId, { foreground: 'shell', inspect: { process: CODEX } });
  const loaded = (await app.loads()).length;
  const called = (await app.calls()).length;

  const answer = await send(box);

  assert.equal(answer.nudged, false, `got: ${JSON.stringify(answer)}`);
  assert.equal('nudgeTrouble' in answer, false, `the shell in front is no harness, plainly, got: ${JSON.stringify(answer)}`);
  await assertUntyped(box, 'ps finds the shell');
  assert.deepEqual((await app.loads()).slice(loaded), [], 'the runtime client was not loaded');
  assert.deepEqual((await app.calls()).slice(called), [], 'and not called');
});

test('F7 where ps finds `less` in front of a Codex tab, nothing is typed and Orca\'s runtime is not asked, whatever it would say', async (t) => {
  // ps read the tab: what it found stands, though it is "cannot tell".
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const app = await orcaApp(box);
  await changeTab(box, (await tabOf(box, bots, 'coder')).tabId, { foreground: 'program', inspect: { process: CODEX } });
  const loaded = (await app.loads()).length;
  const called = (await app.calls()).length;

  const answer = await send(box);

  await assertCouldNotTell(box, answer, 'ps finds less');
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
  test(`F8 when ${label}, outside any sandbox, the runtime is asked, and a harness it finds is told`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    const app = await orcaApp(box);
    const reader = await tabOf(box, bots, 'coder');
    await changeTab(box, reader.tabId, { foreground, inspect: { process: CODEX } });
    const called = (await app.calls()).length;

    const answer = await send(box);

    await assertNudgedOnly(box, reader.tabId, answer);
    assert.ok(
      (await app.calls()).slice(called).some((call) => call.method === 'terminal.inspectProcess' && call.params?.terminal === reader.handle),
      `the runtime was asked about the receiver's tab, got: ${JSON.stringify(await app.calls())}`,
    );
  });

  test(`F8 when ${label}, and the runtime finds the shell, nothing is typed, plainly`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    await orcaApp(box);
    await changeTab(box, (await tabOf(box, bots, 'coder')).tabId, { foreground, inspect: { process: SHELL } });

    const answer = await send(box);

    assert.equal(answer.nudged, false, `got: ${JSON.stringify(answer)}`);
    assert.equal('nudgeTrouble' in answer, false, `the runtime says there is no harness, got: ${JSON.stringify(answer)}`);
    await assertUntyped(box, label);
  });
}

// ---------------------------------------------------------------------------
// F9 — a question on the tab still stops the nudge.
// ---------------------------------------------------------------------------

test('F9 a harness the runtime finds, with Orca\'s blockedReason on its tab, is not typed into, and the answer says it is blocked', async (t) => {
  const { box } = await sandboxedFleet(t);
  await box.orca.set({ waitIdle: 'blocked' });

  const answer = await send(box);

  assert.equal(answer.nudged, false, `got: ${JSON.stringify(answer)}`);
  assert.equal(answer.blocked, 'agent-interactive-prompt', `Orca's reason, got: ${JSON.stringify(answer)}`);
  await assertUntyped(box, 'blocked');
});

test('F9 a Codex the runtime finds, on its update offer, is not typed into: the kit\'s own screen reading still stands', async (t) => {
  // Orca calls that screen idle with no reason, and a return typed into it
  // took "Update now" (#329).
  const { box, bots } = await sandboxedFleet(t);
  await changeTab(box, (await tabOf(box, bots, 'coder')).tabId, { screen: CODEX_UPDATE_OFFER });

  const answer = await send(box);

  assert.equal(answer.nudged, false, `got: ${JSON.stringify(answer)}`);
  assert.equal(answer.blocked, 'question-on-screen', `the question on its screen, got: ${JSON.stringify(answer)}`);
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

/** Each `terminal send` into every tab since its launch line, by tab id. */
async function sentSinceLaunch(box) {
  const after = {};
  for (const terminal of await box.orca.terminals()) after[terminal.tabId] = sentInto(terminal).slice(1);
  return after;
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
