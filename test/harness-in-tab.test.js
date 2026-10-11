// Is a harness running in this tab? (#232)
//
// Two commands ask it. `message send --interrupt` asks before it sends the one
// Escape into a busy receiver's tab. `up` asks after it types a launch line, to
// report whether the harness came up. `restart` and `unpause` ask it through
// `up`.
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
// Since #555 fleet mail types nothing into a tab but that Escape. So the mail
// tests here send with --interrupt to a receiver that is busy by Orca's wait,
// unless a test sets its own wait. A busy harness in front gets one Escape. A
// tab with its shell in front is not up, and gets nothing. A tab whose front
// cannot be read is neither: the kit cannot tell, it sends nothing, and it does
// not say "not up". In every case the letter is in the mailbox and the send
// succeeded.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  createSandbox,
  orcaCallsOf,
  orcaCommand,
  recordSession,
  sentInto,
  sessionIn,
  tabsOfBot,
  typedInto,
} from './helpers/cli.js';

// ------------------------------------------------------------ message send

/** A Claude bot that writes and a Codex bot that reads, both up, nothing typed since, every tab busy by Orca's wait. */
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

/** Send one message from the writer to the reader, with --interrupt, and give back the plain output. */
async function send(box) {
  const result = await box.run([
    'message', 'send', '--bots', 'bots', '--to', 'coder', '--from', 'writer/daily',
    '--subject', 'the staging host', '--text', 'It is down again.', '--interrupt',
  ]);
  assert.equal(result.code, 0, `the letter went whatever became of the interrupt: ${result.stdout}${result.stderr}`);
  return `${result.stdout}${result.stderr}`;
}

/** Each `terminal send` into every tab since its launch line, by tab id. */
async function sentSinceLaunch(box) {
  const after = {};
  for (const terminal of await box.orca.terminals()) after[terminal.tabId] = sentInto(terminal).slice(1);
  return after;
}

/** The reader's tab, as Orca holds it. */
async function readerTab(box, bots) {
  const { tab } = await sessionIn(bots, 'coder', 'daily');
  return (await box.orca.terminals()).find((terminal) => terminal.tabId === tab);
}

const NOT_UP = /not up/i;
const COULD_NOT_TELL = /tell/i;
/** What a plain answer says of a tab with only a shell in front. */
const NO_HARNESS = /shell|not up|harness/i;

/** One Escape, with no Enter, into the reader's tab and no other tab. */
async function assertEscapedOnly(box, bots, said) {
  const sent = await sentSinceLaunch(box);
  const reader = (await readerTab(box, bots)).tabId;
  assert.deepEqual(
    sent[reader].map((one) => ({ text: one.text, enter: one.enter })),
    [{ text: '\x1b', enter: false }],
    `one Escape into the receiver's tab, got: ${JSON.stringify(sent[reader])}`,
  );
  for (const [tab, keys] of Object.entries(sent)) {
    if (tab !== reader) assert.deepEqual(keys, [], `nothing may go into ${tab}: it is not the receiver's`);
  }
  assert.doesNotMatch(said, NOT_UP, `the harness is up, got: ${said}`);
}

/** The letter is in the mailbox, and nothing went into any tab after its launch line. */
async function assertUntyped(box) {
  assert.equal((await box.orca.messages()).length, 1, 'the letter is in the mailbox');
  assert.deepEqual(Object.values(await sentSinceLaunch(box)).flat(), [], 'and nothing went into any tab');
}

/** Nothing sent because the kit could not tell, said so, and nobody called not up. */
async function assertCouldNotTell(box, said) {
  await assertUntyped(box);
  assert.match(said, COULD_NOT_TELL, `the output says the kit could not tell, got: ${said}`);
  assert.doesNotMatch(said, NOT_UP, `the kit does not know that, got: ${said}`);
}

test('a busy harness gets the one Escape of --interrupt, and the letter is in the mailbox', async (t) => {
  // The case #232 is about. Orca's wait runs out of time on a harness that is
  // working, just as it does on a shell; the harness is in front of its tab
  // all the same, so the Escape goes in.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);

  const said = await send(box);

  assert.equal((await box.orca.messages()).length, 1, 'the letter is in the mailbox');
  await assertEscapedOnly(box, bots, said);
});

test('a harness under a shell with no login above it is a harness, and gets the Escape', async (t) => {
  // Only a `login` pane makes its child the shell. Where the pane is the shell
  // itself, its child in front is the harness it started.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await box.orca.set({ waitIdle: 'busy', foreground: 'bare-harness' });

  const said = await send(box);

  await assertEscapedOnly(box, bots, said);
});

for (const [label, state] of [
  ['a shell at its prompt, which Orca times out on', { waitIdle: false }],
  ['a shell in front, where Orca\'s wait times out as on a busy harness', { waitIdle: 'busy', foreground: 'shell' }],
  ['a pane that is its own shell, at its prompt', { waitIdle: 'busy', foreground: 'bare-shell' }],
]) {
  test(`${label} is not up: nothing is sent, and the run says so`, async (t) => {
    // Whatever Orca's wait said, the shell is in front of the tab and there is
    // nobody there to read a key. Only a busy wait makes the kit look at all
    // (an idle receiver gets no Escape), so the wait times out here.
    const box = await createSandbox(t);
    await fleetIn(box);
    await box.orca.set(state);

    const said = await send(box);

    await assertUntyped(box);
    assert.match(said, NO_HARNESS, `the run should say no harness is there, got: ${said}`);
  });
}

test('a Codex tab whose Codex quit is not up, though Orca still calls it codex', async (t) => {
  // Seen live: after Codex quit to the shell, the tab's `agentIdentity` still
  // said `codex` more than 70 s later, and Orca's wait found the shell ok and
  // idle. Only the shell in front says what is there. A key sent here goes
  // to zsh. The wait times out here, so the kit looks.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await box.orca.set({ waitIdle: 'busy', foreground: 'shell' });
  assert.equal((await readerTab(box, bots)).agentIdentity, 'codex', 'the fake should still name the agent that quit');

  const said = await send(box);

  await assertUntyped(box);
  assert.match(said, NO_HARNESS, `got: ${said}`);
});

// A program in front that is not the agent Orca names. Seen live on Orca
// 1.4.209 with Codex 0.156.1 (PR #260): Codex quit with /quit, then `less
// /etc/hosts` in the same tab; for 20 s `agentIdentity` still said `codex`,
// `less` led the foreground group and `tui-idle` was ok and satisfied. A key
// sent there goes into `less`. The harness the kit launched is its own group
// leader and its comm is the agent's name, so only a front process whose comm
// is the agent Orca names gets the key; anything else, the kit cannot tell.
for (const [label, foreground] of [
  ['`less` in front of a tab where Orca still names the Codex that quit', 'program'],
  ['`claude` in front of a tab Orca names codex', 'other-harness'],
]) {
  test(`${label}: nothing is sent, and the kit cannot tell whether it is up`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    await box.orca.set({ waitIdle: 'busy', foreground });
    assert.equal((await readerTab(box, bots)).agentIdentity, 'codex', 'Orca should still name codex in the reader\'s tab');

    const said = await send(box);

    await assertCouldNotTell(box, said);
  });
}

// A program in front and no `agentIdentity`: the kit cannot tell whether it is
// a harness. It may be an editor, a pager, a build, and a key sent there goes
// into that program; or it may be a harness Orca has not named yet, since the
// identity comes 0.5–6 s after a launch and a Codex session just resumed may
// carry none until its first prompt. So nothing is sent, and nobody is called
// "not up": only a tab with no harness in it is that (architect, PR #260).
for (const label of [
  'a busy program, as a harness just started is before Orca names it',
]) {
  test(`${label}, with no agentIdentity, gets nothing, and the kit cannot tell whether it is up`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    const reader = (await readerTab(box, bots)).tabId;
    await box.orca.set({
      terminals: (await box.orca.terminals()).map((terminal) => (terminal.tabId === reader ? { ...terminal, agentIdentity: null } : terminal)),
    });

    const said = await send(box);

    await assertCouldNotTell(box, said);
  });
}

// Every road on which who is in front cannot be read. Orca names the tab's
// agent and its wait times out on each of them, so a kit that fell back on
// Orca's word would send the key; the architect's rule is that it does not.
for (const [label, state] of [
  ['Orca\'s diagnostics give no pid for the tab', { foreground: 'no-pid' }],
  ['ps cannot read the pane\'s pid', { foreground: 'ps-fails' }],
  ['ps answers with something that is not a ps line', { foreground: 'garbage' }],
  ['the pane has no terminal in front of it', { foreground: 'no-tpgid' }],
  ['the process in front is gone before it can be read', { foreground: 'gone' }],
  ['Orca refuses its diagnostics', { fail: { 'diagnostics memory': { code: 'runtime_error', message: 'diagnostics unavailable' } } }],
  ['Orca\'s diagnostics are not JSON', { garbage: { command: 'diagnostics memory', text: 'memory: lots\n' } }],
]) {
  test(`when ${label}, the kit cannot tell: nothing is sent, the letter is in the mailbox, and nobody is called not up`, async (t) => {
    const box = await createSandbox(t);
    await fleetIn(box);
    await box.orca.set(state);

    const said = await send(box);

    await assertCouldNotTell(box, said);
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

test('a fresh session busy on its start prompt is reported started, with the prompt not confirmed', async (t) => {
  // What every session with a start prompt does the moment it comes up: it
  // gets to work on the prompt, and Orca's wait times out on both looks. Its
  // `agentIdentity` may not be there yet either, so `up` does not ask for it.
  const box = await createSandbox(t);
  const bots = await withSession(box);
  await box.orca.set({ waitIdle: 'busy', agentIdentity: null });

  const { entry, typed } = await upJson(box, bots);

  assert.equal(entry.harnessStarted, true, 'a harness in front of its tab is a harness that started');
  assert.equal(entry.promptReceived, false, 'busy is not received: no record the book names holds the prompt (#274)');
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
    assert.equal(entry.promptReceived, false, 'and it took the prompt with it');
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
//
// Orca refuses its diagnostics here only once the launch line is typed: the
// kit needs the pane pid to see that the new tab's shell is ready for the line
// at all, and without it types nothing (#498, test/shell-ready-causes.test.js).
for (const [label, state, started] of [
  ['an ok wait counts', { foreground: 'ps-fails', waitIdle: true, agentIdentity: null }, true],
  ['an agentIdentity counts, though the wait timed out', { foreground: 'ps-fails', waitIdle: 'busy' }, true],
  ['a timed-out wait and no agentIdentity is not started', { foreground: 'ps-fails', waitIdle: false, agentIdentity: null }, false],
  ['Orca refusing its diagnostics once the line is typed does not stop the run', async (box) => ({
    fail: {
      'diagnostics memory': {
        code: 'runtime_error',
        message: 'diagnostics unavailable',
        since: 'terminal send',
        sinceFrom: orcaCallsOf(await box.orca.calls(), 'terminal send').length,
      },
    },
    waitIdle: true,
    agentIdentity: null,
  }), true],
]) {
  test(`up falls back on Orca's own answers when the front of the tab cannot be read: ${label}`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withSession(box);
    await box.orca.set(typeof state === 'function' ? await state(box) : state);

    const { entry, typed } = await upJson(box, bots);

    assert.equal(entry.harnessStarted, started);
    assert.equal(entry.promptReceived, false, 'whatever the look found, no record holds the prompt (#274)');
    assert.equal(typed.length, 1, `nothing is typed after the launch line, got: ${JSON.stringify(typed)}`);
    if (typeof state === 'function') {
      // The refusal was met: the kit asked for the diagnostics after it typed.
      const asked = (await box.orca.calls()).map(orcaCommand);
      assert.ok(asked.lastIndexOf('diagnostics memory') > asked.lastIndexOf('terminal send'), 'the diagnostics were asked for, and refused, after the line was typed');
    }
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
  const reader = await readerTab(box, bots);
  const before = (await box.ps.calls()).length;

  await send(box);

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
