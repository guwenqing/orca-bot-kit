// Is a harness running in this tab? (#232)
//
// Two commands ask it. `message send` asks before it types the one line that
// tells a session its mail is there, and `up` asks after it types a launch
// line, to report whether the harness came up. `restart` and `unpause` ask it
// through `up`.
//
// What Orca says is not the answer, and was measured not to be on Orca 1.4.209
// with Claude Code 2.1.281 and Codex 0.156.1. A `tui-idle` wait times out for
// a harness that is busy exactly as it does for a plain shell, so a timeout is
// not "no harness". A shell that Codex quit to answers the same wait ok and
// satisfied, so an ok is not "a harness" either. And the tab's `agentIdentity`
// is stale — still `codex` more than 70 s after Codex quit — and late, up to
// ~5 s after the launch line. What held every time is who is in front of the
// tab's terminal: the shell, or a program. The kit reads that from the pane's
// pid in `orca diagnostics memory` and `ps`, both faked here.
//
// So a busy session is told its mail is there, which is PRD 6.9's "queued, not
// interrupting": a busy harness takes a typed line as its next turn. A tab with
// its shell in front is not up. A tab whose front cannot be read is neither:
// the kit cannot tell, it types nothing, and it does not say "not up". And in
// every case the message is in the mailbox and the send succeeded.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  createSandbox,
  recordSession,
  sessionIn,
  tabsOfBot,
  typedInto,
} from './helpers/cli.js';

// ------------------------------------------------------------ message send

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

/** Send one message from the writer to the reader. */
const send = (box) => box.run([
  'message', 'send', '--bots', 'bots', '--to', 'coder', '--from', 'writer/daily',
  '--subject', 'the staging host', '--text', 'It is down again.',
]);

/** What was typed into every tab of the whole fleet, after the launch line each one got. */
async function typedSinceLaunch(box) {
  const after = {};
  for (const terminal of await box.orca.terminals()) {
    after[terminal.tabId] = typedInto(terminal).slice(1);
  }
  return after;
}

/** The reader's tab, as Orca holds it. */
async function readerTab(box, bots) {
  const { tab } = await sessionIn(bots, 'coder', 'daily');
  return (await box.orca.terminals()).find((terminal) => terminal.tabId === tab);
}

/** The line a send prints about the receiver's tab: what the kit told it, or why it did not. */
const TOLD = /its tab was told to look/;
const NOT_UP = /not up/;
const COULD_NOT_TELL = /it is queued, and its tab could not be told to look: .*harness/i;

/** The message went, and nothing at all was typed into any tab after its launch line. */
async function assertWaitsUntyped(box, result) {
  assert.equal(result.code, 0, `the message went; only the nudge did not: ${result.stdout}${result.stderr}`);
  assert.equal((await box.orca.messages()).length, 1, 'the message is in the mailbox');
  assert.deepEqual(Object.values(await typedSinceLaunch(box)).flat(), [], 'and nothing was typed anywhere');
}

test('a busy harness is told its mail is there, and the run says it was told', async (t) => {
  // The case the issue is about. Orca's wait runs out of time on a harness
  // that is working, just as it does on a shell; the harness is in front of
  // its tab all the same, and a line typed now is its next turn.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await box.orca.set({ waitIdle: 'busy' });

  const result = await send(box);

  assert.equal(result.code, 0, result.stderr);
  const typed = await typedSinceLaunch(box);
  const reader = (await readerTab(box, bots)).tabId;
  assert.equal(typed[reader].length, 1, `one line into the receiver's tab, got: ${JSON.stringify(typed[reader])}`);
  assert.match(typed[reader][0], /message check/, `the nudge, got: ${typed[reader][0]}`);
  for (const [tab, lines] of Object.entries(typed)) {
    if (tab !== reader) assert.deepEqual(lines, [], `nothing may be typed into ${tab}: it is not the receiver's`);
  }
  assert.match(result.stdout, TOLD, `the run should say the tab was told, got: ${result.stdout}`);
  assert.doesNotMatch(result.stdout, NOT_UP);
});

test('a harness under a shell with no login above it is a harness, and is told', async (t) => {
  // Only a `login` pane makes its child the shell. Where the pane is the shell
  // itself, its child in front is the harness it started.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await box.orca.set({ waitIdle: 'busy', foreground: 'bare-harness' });

  const result = await send(box);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(typedInto(await readerTab(box, bots)).slice(1).length, 1, 'the receiver was told');
  assert.match(result.stdout, TOLD, `got: ${result.stdout}`);
});

for (const [label, state] of [
  ['a shell at its prompt, which Orca times out on', { waitIdle: false }],
  ['a shell Orca calls idle', { waitIdle: true, foreground: 'shell' }],
  ['a pane that is its own shell, at its prompt', { waitIdle: true, foreground: 'bare-shell' }],
]) {
  test(`${label} is not up: nothing is typed, and the run says so`, async (t) => {
    // Whatever Orca's wait said, the shell is in front of the tab and there is
    // nobody there to read a line.
    const box = await createSandbox(t);
    await fleetIn(box);
    await box.orca.set(state);

    const result = await send(box);

    await assertWaitsUntyped(box, result);
    assert.match(result.stdout, NOT_UP, `the run should say the session is not up, got: ${result.stdout}`);
  });
}

test('a Codex tab whose Codex quit is not up, though Orca still calls it codex', async (t) => {
  // Seen live: after Codex quit to the shell, the tab's `agentIdentity` still
  // said `codex` more than 70 s later, and Orca's wait found the shell ok and
  // idle. Only the shell in front says what is there. A line typed here goes
  // to zsh as a command.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await box.orca.set({ waitIdle: 'quit' });
  assert.equal((await readerTab(box, bots)).agentIdentity, 'codex', 'the fake should still name the agent that quit');

  const result = await send(box);

  await assertWaitsUntyped(box, result);
  assert.match(result.stdout, NOT_UP, `got: ${result.stdout}`);
});

// A program in front that is not the agent Orca names. Seen live on Orca
// 1.4.209 with Codex 0.156.1 (PR #260): Codex quit with /quit, then `less
// /etc/hosts` in the same tab; for 20 s `agentIdentity` still said `codex`,
// `less` led the foreground group and `tui-idle` was ok and satisfied. A nudge
// typed there goes into `less`. The harness the kit launched is its own group
// leader and its comm is the agent's name, so only a front process whose comm
// is the agent Orca names is told; anything else, the kit cannot tell.
for (const [label, foreground] of [
  ['`less` in front of a tab where Orca still names the Codex that quit', 'program'],
  ['`claude` in front of a tab Orca names codex', 'other-harness'],
]) {
  test(`${label}: nothing is typed, and the kit cannot tell whether it is up`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    await box.orca.set({ waitIdle: true, foreground });
    assert.equal((await readerTab(box, bots)).agentIdentity, 'codex', 'Orca should still name codex in the reader\'s tab');

    const result = await send(box);

    await assertWaitsUntyped(box, result);
    assert.doesNotMatch(result.stdout + result.stderr, NOT_UP, `the kit does not know that, got: ${result.stdout}`);
    assert.match(
      result.stdout,
      COULD_NOT_TELL,
      `the run should say the mail is queued and the kit could not tell whether a harness is running, got: ${result.stdout}`,
    );
  });
}

// A program in front and no `agentIdentity`: the kit cannot tell whether it is
// a harness. It may be an editor, a pager, a build, and a line typed there goes
// into that program; or it may be a harness Orca has not named yet, since the
// identity comes 0.5–6 s after a launch and a Codex session just resumed may
// carry none until its first prompt. So nothing is typed, and nobody is called
// "not up": only a tab with no harness in it is that (architect, PR #260).
for (const [label, waitIdle] of [
  ['a program Orca calls idle', true],
  ['a busy program, as a harness just started is before Orca names it', 'busy'],
]) {
  test(`${label}, with no agentIdentity, is not typed into, and the kit cannot tell whether it is up`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    const reader = (await readerTab(box, bots)).tabId;
    await box.orca.set({
      waitIdle,
      terminals: (await box.orca.terminals()).map((terminal) => (terminal.tabId === reader ? { ...terminal, agentIdentity: null } : terminal)),
    });

    const result = await send(box);

    await assertWaitsUntyped(box, result);
    assert.doesNotMatch(result.stdout + result.stderr, NOT_UP, `the kit does not know that, got: ${result.stdout}`);
    assert.match(
      result.stdout,
      COULD_NOT_TELL,
      `the run should say the mail is queued and the kit could not tell whether a harness is running, got: ${result.stdout}`,
    );
  });
}

// Every road on which who is in front cannot be read. Orca says the tab is idle
// and names its agent on each of them, so a kit that fell back on Orca's word
// would type; the architect's rule is that it does not.
for (const [label, state] of [
  ['Orca\'s diagnostics give no pid for the tab', { foreground: 'no-pid' }],
  ['ps cannot read the pane\'s pid', { foreground: 'ps-fails' }],
  ['ps answers with something that is not a ps line', { foreground: 'garbage' }],
  ['the pane has no terminal in front of it', { foreground: 'no-tpgid' }],
  ['the process in front is gone before it can be read', { foreground: 'gone' }],
  ['Orca refuses its diagnostics', { fail: { 'diagnostics memory': { code: 'runtime_error', message: 'diagnostics unavailable' } } }],
  ['Orca\'s diagnostics are not JSON', { garbage: { command: 'diagnostics memory', text: 'memory: lots\n' } }],
]) {
  test(`when ${label}, the kit cannot tell: nothing is typed, the mail waits, and nobody is called not up`, async (t) => {
    const box = await createSandbox(t);
    await fleetIn(box);
    await box.orca.set({ waitIdle: true, ...state });

    const result = await send(box);

    await assertWaitsUntyped(box, result);
    assert.doesNotMatch(result.stdout + result.stderr, NOT_UP, `the kit does not know that, got: ${result.stdout}`);
    assert.match(
      result.stdout,
      COULD_NOT_TELL,
      `the run should say the mail is queued and the kit could not tell whether a harness is running, got: ${result.stdout}`,
    );
  });
}

// --------------------------------------------------------------------- up

const PROMPT = 'Read your AGENTS.md and reply in one line with what this bot owns.';

/** A bots folder holding one Codex bot, `tab-bot`, with one session and a start prompt. */
async function withSession(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'tab-bot', '--harness', 'codex'])).code, 0);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'tab-bot', '--name', 'daily', '--prompt', PROMPT]);
  assert.equal(added.code, 0, added.stderr);
  return box.path('bots');
}

/** Bring the one bot up and give back what it answered, and what was typed into its tab. */
async function upJson(box, bots) {
  const result = await box.run(['up', '--bots', 'bots', '--bot', 'tab-bot', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const answer = JSON.parse(result.stdout);
  assert.equal(answer.tabs.length, 1, `one tab should have been reported, got: ${result.stdout}`);
  const tabs = await tabsOfBot(box, bots, 'tab-bot');
  assert.equal(tabs.length, 1);
  return { entry: answer.tabs[0], typed: typedInto(tabs[0]) };
}

test('a fresh session busy on its start prompt is reported started, with the prompt sent', async (t) => {
  // What every session with a start prompt does the moment it comes up: it
  // gets to work on the prompt, and Orca's wait times out on both looks. Its
  // `agentIdentity` may not be there yet either, so `up` does not ask for it.
  const box = await createSandbox(t);
  const bots = await withSession(box);
  await box.orca.set({ waitIdle: 'busy', agentIdentity: null });

  const { entry, typed } = await upJson(box, bots);

  assert.equal(entry.harnessStarted, true, 'a harness in front of its tab is a harness that started');
  assert.equal(entry.promptSent, true, 'and it is working on the prompt it was given');
  assert.equal('blockedReason' in entry, false, 'nothing is waiting to be answered');
  assert.equal(typed.length, 1, `the launch line and nothing after it, got: ${JSON.stringify(typed)}`);
});

test('the plain report of a busy harness reads as a started one, not as one that never came up', async (t) => {
  const report = async (state) => {
    const box = await createSandbox(t);
    await withSession(box);
    await box.orca.set(state);
    const result = await box.run(['up', '--bots', 'bots', '--bot', 'tab-bot']);
    assert.equal(result.code, 0, result.stderr);
    return result.stdout.split(box.root).join('<root>');
  };

  const busy = await report({ waitIdle: 'busy', agentIdentity: null });
  const idle = await report({ waitIdle: true });
  const never = await report({ waitIdle: false });

  assert.equal(busy, idle, 'a harness at work on its prompt came up just as an idle one did');
  assert.notEqual(busy, never, 'and it must not read like a tab that was left at its shell');
});

for (const [label, waitIdle] of [
  ['Orca answered ok both times', [true, 'quit']],
  ['the first look found a busy harness', ['busy', false]],
]) {
  test(`a tab back at its shell on the second look is not started, though ${label}`, async (t) => {
    // A harness that came up and quit. The second look is what catches it, and
    // on it the shell is in front whatever Orca's wait answered.
    const box = await createSandbox(t);
    const bots = await withSession(box);
    await box.orca.set({ waitIdle });

    const { entry, typed } = await upJson(box, bots);

    assert.equal(entry.harnessStarted, false, 'a harness that is gone is not a harness that started');
    assert.equal(entry.promptSent, false, 'and it took the prompt with it');
    assert.equal(typed.length, 1, `nothing is typed after the launch line, got: ${JSON.stringify(typed)}`);
  });
}

test('a harness Orca says is waiting on a question is started, whoever the kit finds in front', async (t) => {
  // `blockedReason` is Orca seeing a harness's own screen, so it counts on its
  // own; the caller is handed the reason to act on.
  const box = await createSandbox(t);
  const bots = await withSession(box);
  await box.orca.set({ waitIdle: 'blocked', foreground: 'shell' });

  const { entry, typed } = await upJson(box, bots);

  assert.equal(entry.harnessStarted, true);
  assert.equal(entry.blockedReason, 'agent-interactive-prompt');
  assert.equal(typed.length, 1, `nothing is typed after the launch line, got: ${JSON.stringify(typed)}`);
});

// When who is in front cannot be read, `up` reports what Orca itself said: an
// ok wait, or an `agentIdentity`, counts as up. It is a report only: `up` types
// nothing more whatever it decides.
for (const [label, state, started] of [
  ['an ok wait counts', { foreground: 'ps-fails', waitIdle: true, agentIdentity: null }, true],
  ['an agentIdentity counts, though the wait timed out', { foreground: 'ps-fails', waitIdle: 'busy' }, true],
  ['a timed-out wait and no agentIdentity is not started', { foreground: 'ps-fails', waitIdle: false, agentIdentity: null }, false],
  ['Orca refusing its diagnostics does not stop the run', {
    fail: { 'diagnostics memory': { code: 'runtime_error', message: 'diagnostics unavailable' } },
    waitIdle: true,
    agentIdentity: null,
  }, true],
]) {
  test(`up falls back on Orca's own answers when the front of the tab cannot be read: ${label}`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withSession(box);
    await box.orca.set(state);

    const { entry, typed } = await upJson(box, bots);

    assert.equal(entry.harnessStarted, started);
    assert.equal(entry.promptSent, started);
    assert.equal(typed.length, 1, `nothing is typed after the launch line, got: ${JSON.stringify(typed)}`);
  });
}

// ------------------------------------------------- restart and unpause, through up

/** A bot brought up, with the conversation its session runs known to the book. */
async function running(box) {
  const bots = await withSession(box);
  const up = await box.run(['up', '--bots', 'bots', '--bot', 'tab-bot']);
  assert.equal(up.code, 0, up.stderr);
  const { tab } = await sessionIn(bots, 'tab-bot', 'daily');
  const recorded = await recordSession(box, { bots, bot: 'tab-bot', tab, session: 'sess-daily' });
  assert.equal(recorded.code, 0, recorded.stderr);
  return bots;
}

/** The entry for the session's tab in a `--json` answer that brought it up again. */
function reopened(result) {
  assert.equal(result.code, 0, result.stderr);
  const found = JSON.parse(result.stdout).tabs.filter((entry) => entry.name === 'daily' && entry.created === true);
  assert.equal(found.length, 1, `the session's new tab should be reported, got: ${result.stdout}`);
  return found[0];
}

test('restart reports a harness busy in its new tab as started', async (t) => {
  const box = await createSandbox(t);
  await running(box);
  await box.orca.set({ waitIdle: 'busy', agentIdentity: null });

  const entry = reopened(await box.run(['restart', '--bots', 'bots', '--bot', 'tab-bot', '--json']));

  assert.equal(entry.harnessStarted, true);
});

test('unpause reports a harness busy in its new tab as started', async (t) => {
  const box = await createSandbox(t);
  await running(box);
  assert.equal((await box.run(['pause', '--bots', 'bots', '--bot', 'tab-bot'])).code, 0);
  await box.orca.set({ waitIdle: 'busy', agentIdentity: null });

  const entry = reopened(await box.run(['unpause', '--bots', 'bots', '--bot', 'tab-bot', '--json']));

  assert.equal(entry.harnessStarted, true);
});

// ------------------------------------------------------------------ ps

test('the kit only reads ps, one pid at a time, and reads the receiver\'s own pane', async (t) => {
  // On 2026-09-20 a cleanup here force-killed every process of the owner's
  // account through a pid taken from `ps` (AGENTS.md). The kit reads `ps` and
  // does nothing else with it: one argv shape, a positive pid on the end.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await box.orca.set({ waitIdle: 'busy' });
  const reader = await readerTab(box, bots);
  const before = (await box.ps.calls()).length;

  const result = await send(box);
  assert.equal(result.code, 0, result.stderr);

  // Every read the kit made, `up`'s included.
  const calls = await box.ps.calls();
  assert.notEqual(calls.length, 0, 'the kit should have asked ps who is in front of the tab');
  for (const call of calls) {
    assert.deepEqual(call.args.slice(0, 3), ['-o', 'pid=,ppid=,tpgid=,comm=', '-p'], `ps ${call.args.join(' ')}`);
    assert.equal(call.args.length, 4, `ps ${call.args.join(' ')}: one pid per call`);
    assert.match(call.args[3], /^[1-9]\d*$/, `ps ${call.args.join(' ')}: a pid, and a positive one`);
  }

  // And this send read the pane Orca gives the reader's tab.
  const memory = JSON.parse(spawnSync(box.orca.cli, ['diagnostics', 'memory', '--json'], { env: box.env, encoding: 'utf8' }).stdout);
  const pane = memory.result.worktrees.flatMap((worktree) => worktree.sessions).find((one) => one.sessionId === reader.ptyId);
  assert.ok(
    calls.slice(before).some((call) => call.args[3] === String(pane.pid)),
    `the send should read the receiver's own pane, pid ${pane.pid}, got: ${JSON.stringify(calls.slice(before).map((call) => call.args))}`,
  );
});
