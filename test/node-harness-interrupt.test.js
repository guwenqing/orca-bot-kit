// A harness the kit launched counts as the harness whatever its process is
// called (#261), and since #555 that decides where `obk message send
// --interrupt` sends its one Escape.
//
// The kit's gate for keys into a session's tab (#232) passes a tab only when
// the process leading the tab's foreground group is the agent Orca names
// there, `claude` or `codex`. A harness installed through npm runs as `node`.
// The rule (architect's ruling on #261, 2026-09-28): when the process in front
// is not named as the agent, the kit reads its environment and its parent with
// `ps`, and counts it as the harness it launched only when both hold:
//
//   - its environment carries this tab's `ORCA_TAB_ID=<tab id>`, as a whole
//     word;
//   - it carries `OBK_TAB_SHELL=<n>` with n its own parent's pid: the tab's
//     shell started it on the kit's launch line.
//
// Anything else is "cannot tell", and no key goes in: an environment or parent
// `ps` cannot read, a `ps` that is not permitted to start, no mark (a tab Orca
// restored by itself), a mark naming another tab, and a mark on a process
// whose parent is not the shell. `less` run from the shell after the harness
// quit carries no mark.
//
// Fleet mail types nothing into a tab since #555; the one key it may send is
// the Escape of `--interrupt`, into a busy receiver whose tab holds its
// harness. So each mail test below sends with `--interrupt` to a busy
// receiver (Orca's tui-idle wait times out): the Escape goes where the gate
// passes the tab, and nothing goes where it does not, while the letter is
// posted either way. N5 is the skills reload, through the same gate.
//
// The fake `ps` (helpers/fake-ps.js) puts `node` in front with `foreground:
// 'node-harness'` (the shell's child, carrying the launch line's variables) and
// `'node-child'` (a `node` the harness started), and says what the front
// carries with `environment`. Each test below sets them on the receiver's tab
// alone.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  createSandbox,
  orcaApp,
  sentInto,
  sessionIn,
} from './helpers/cli.js';
import { CLAUDE_TEACH_AUTO } from './helpers/screens.js';
import { addSkills, answerOf, botYamlOf, entryOf, kitSkill, assertLinked } from './helpers/skills.js';

// ------------------------------------------------------------- the fleet

/**
 * A Codex bot `writer` that sends and a Claude bot `reader` that receives, each
 * with a `daily` session, both up, nothing typed since, and every tab busy by
 * Orca's tui-idle wait. The writer is Codex because mail between two Claude
 * sessions of one approval class goes by Claude's own messaging.
 */
async function fleetIn(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  for (const [bot, harness] of [['writer', 'codex'], ['reader', 'claude']]) {
    assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness])).code, 0);
    assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', 'daily'])).code, 0);
  }
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  await box.orca.set({ waitIdle: 'busy' });
  return box.path('bots');
}

/** The receiver's tab, as Orca holds it. */
async function readerTab(box, bots) {
  const { tab } = await sessionIn(bots, 'reader', 'daily');
  const terminal = (await box.orca.terminals()).find((one) => one.tabId === tab);
  assert.ok(terminal, `the premise: Orca has the reader's tab ${tab}`);
  return terminal;
}

/** Give the receiver's tab alone what a test says: `foreground`, `environment`, `screen`. */
async function steerReader(box, bots, changes) {
  const { tabId } = await readerTab(box, bots);
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((one) => (one.tabId === tabId ? { ...one, ...changes } : one)),
  });
}

/** Send one letter from the writer to the reader with --interrupt, plain, and answer what it printed. */
async function send(box) {
  const result = await box.run([
    'message', 'send', '--bots', 'bots', '--to', 'reader', '--from', 'writer/daily',
    '--subject', 'the staging host', '--text', 'It is down again.', '--interrupt',
  ]);
  assert.equal(result.code, 0, `the letter went whatever became of the interrupt: ${result.stdout}${result.stderr}`);
  assert.equal((await box.orca.messages()).length, 1, 'the letter is in the mailbox');
  return result.stdout + result.stderr;
}

/** What was sent into every tab of the whole fleet, after the launch line each one got. */
async function sentSinceLaunch(box) {
  const after = {};
  for (const terminal of await box.orca.terminals()) after[terminal.tabId] = (terminal.typed ?? []).slice(1);
  return after;
}

/** The kit could not tell whether a harness is in the tab (#232). */
const COULD_NOT_TELL = /tell/i;

/** One Escape, with no Enter, into the reader's tab and no other. */
async function assertEscapedOnly(box, bots, said) {
  const reader = (await readerTab(box, bots)).tabId;
  const sent = await sentSinceLaunch(box);
  assert.deepEqual(sent[reader].map((entry) => ({ text: entry.text, enter: entry.enter })), [{ text: '\x1b', enter: false }], `one Escape into the reader's tab, got: ${JSON.stringify(sent[reader])}`);
  for (const [tab, keys] of Object.entries(sent)) {
    if (tab !== reader) assert.deepEqual(keys, [], `nothing may go into ${tab}: it is not the reader's`);
  }
  assert.doesNotMatch(said, /could not tell|cannot tell/i, `the kit could tell, got: ${said}`);
}

/** No Escape, because the kit could not tell: nothing sent anywhere, and nobody is called not up. */
async function assertCouldNotTell(box, said, what) {
  assert.deepEqual(Object.values(await sentSinceLaunch(box)).flat(), [], `${what}: nothing went into any tab`);
  assert.match(said, COULD_NOT_TELL, `${what}: the output says the kit could not tell, got: ${said}`);
  assert.doesNotMatch(said, /not up/, `${what}: the kit does not know that, got: ${said}`);
}

// ------------------------------------------------ what ps shows, as premise

/**
 * What the fake `ps` shows in front of the reader's tab, read the way the
 * rule reads it: the front's pid, parent and name, and the words of its
 * environment. So each test can say its setup is the one it means.
 */
async function frontOfReader(box, bots) {
  const { ptyId, tabId } = await readerTab(box, bots);
  const memory = JSON.parse(spawnSync(box.orca.cli, ['diagnostics', 'memory', '--json'], { env: box.env, encoding: 'utf8' }).stdout);
  const pane = memory.result.worktrees.flatMap((worktree) => worktree.sessions).find((one) => one.sessionId === ptyId);
  const read = (pid) => {
    const done = spawnSync(box.ps.cli, ['-o', 'pid=,ppid=,tpgid=,comm=', '-p', String(pid)], { env: box.env, encoding: 'utf8' });
    assert.equal(done.status, 0, done.stderr);
    const [one, ppid, tpgid, ...comm] = done.stdout.trim().split(/\s+/);
    return { pid: Number(one), ppid: Number(ppid), tpgid: Number(tpgid), comm: comm.join(' ') };
  };
  const front = read(read(pane.pid).tpgid);
  const environment = spawnSync(box.ps.cli, ['-E', '-ww', '-o', 'command=', '-p', String(front.pid)], { env: box.env, encoding: 'utf8' });
  return { ...front, tabId, words: environment.status === 0 ? environment.stdout.trim().split(' ') : undefined };
}

// ---------------------------------------------------------------------------
// N1 — a `node` harness the kit's launch line started: counted as the harness.
// ---------------------------------------------------------------------------

test('N1 a busy harness running as node, started by the kit\'s launch line in its tab, gets the one Escape of --interrupt', async (t) => {
  // The issue itself: Claude Code installed through npm, so `node` leads the
  // tab's foreground group, while Orca names `claude` in the tab.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await steerReader(box, bots, { foreground: 'node-harness' });
  assert.equal((await readerTab(box, bots)).agentIdentity, 'claude', 'the premise: Orca names claude in the reader\'s tab');
  const front = await frontOfReader(box, bots);
  assert.equal(front.comm, 'node', 'the premise: node is in front');
  assert.ok(front.words.includes(`ORCA_TAB_ID=${front.tabId}`), `the premise: it carries the tab's id, got: ${front.words.join(' ')}`);
  assert.ok(front.words.includes(`OBK_TAB_SHELL=${front.ppid}`), `the premise: and the mark, naming its parent, got: ${front.words.join(' ')}`);

  const said = await send(box);

  await assertEscapedOnly(box, bots, said);
});

// ---------------------------------------------------------------------------
// N2 — a front that is not the harness the kit launched: nothing typed.
// ---------------------------------------------------------------------------

test('N2 `less` run from the shell after the harness quit, with Orca still naming claude, gets no Escape (#232)', async (t) => {
  // #232's case. `less` is the shell's child, as the harness was, but the
  // launch line gave its variables to the harness alone.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await steerReader(box, bots, { foreground: 'program' });
  assert.equal((await readerTab(box, bots)).agentIdentity, 'claude', 'the premise: Orca still names claude');
  const front = await frontOfReader(box, bots);
  assert.equal(front.comm, 'less', 'the premise: less is in front');
  assert.ok(front.words.includes(`ORCA_TAB_ID=${front.tabId}`), `the premise: it carries the tab's id, got: ${front.words.join(' ')}`);
  assert.equal(front.words.some((word) => word.startsWith('OBK_TAB_SHELL=')), false, `the premise: and no mark, got: ${front.words.join(' ')}`);

  const said = await send(box);

  await assertCouldNotTell(box, said, 'less in front');
});

test('N2 a node harness Orca restored by itself, with none of the launch line in its environment, gets no Escape', async (t) => {
  // The architect's note on #261: Orca resumes the harness with a bare
  // `claude --resume`, so the tab carries no mark. By name alone the kit cannot
  // tell `node` from any other program.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await steerReader(box, bots, { foreground: 'node-harness', environment: 'orca' });
  const front = await frontOfReader(box, bots);
  assert.equal(front.comm, 'node', 'the premise: node is in front');
  assert.ok(front.words.includes(`ORCA_TAB_ID=${front.tabId}`), `the premise: it carries the tab's id, got: ${front.words.join(' ')}`);
  assert.equal(front.words.some((word) => word.startsWith('OBK_TAB_SHELL=')), false, `the premise: and no mark, got: ${front.words.join(' ')}`);

  const said = await send(box);

  await assertCouldNotTell(box, said, 'a restored node harness');
});

test('N2 a node front whose mark names another tab, whose id begins with this one\'s, gets no Escape', async (t) => {
  // Only a whole word tells the two ids apart.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await steerReader(box, bots, { foreground: 'node-harness', environment: 'launched-other-tab' });
  const front = await frontOfReader(box, bots);
  assert.equal(front.comm, 'node', 'the premise: node is in front');
  assert.equal(front.words.includes(`ORCA_TAB_ID=${front.tabId}`), false, `the premise: not this tab's id, got: ${front.words.join(' ')}`);
  assert.ok(front.words.some((word) => word.startsWith(`ORCA_TAB_ID=${front.tabId}`)), `the premise: another that begins with it, got: ${front.words.join(' ')}`);
  assert.ok(front.words.includes(`OBK_TAB_SHELL=${front.ppid}`), `the premise: and the mark, naming its parent, got: ${front.words.join(' ')}`);

  const said = await send(box);

  await assertCouldNotTell(box, said, 'a mark naming another tab');
});

test('N2 a node program the harness started, carrying the mark with the shell\'s pid, gets no Escape: its parent is the harness', async (t) => {
  // A program the harness starts inherits OBK_TAB_SHELL, but its parent is the
  // harness, not the shell the mark names.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await steerReader(box, bots, { foreground: 'node-child' });
  const front = await frontOfReader(box, bots);
  assert.equal(front.comm, 'node', 'the premise: node is in front');
  assert.ok(front.words.includes(`ORCA_TAB_ID=${front.tabId}`), `the premise: it carries the tab's id, got: ${front.words.join(' ')}`);
  const marks = front.words.filter((word) => word.startsWith('OBK_TAB_SHELL='));
  assert.equal(marks.length, 1, `the premise: it carries the mark, got: ${front.words.join(' ')}`);
  assert.notEqual(marks[0], `OBK_TAB_SHELL=${front.ppid}`, `the premise: naming a pid that is not its parent, got: ${marks[0]} with parent ${front.ppid}`);

  const said = await send(box);

  await assertCouldNotTell(box, said, 'a node program the harness started');
});

// ---------------------------------------------------------------------------
// N3 — what the rule needs cannot be read: cannot tell.
// ---------------------------------------------------------------------------

for (const [label, environment] of [
  ['ps cannot read the node front\'s environment', 'ps-fails'],
  ['ps gives the node front\'s command and no variables at all', 'no-tab-id'],
]) {
  test(`N3 when ${label}, the kit cannot tell: no Escape`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    await steerReader(box, bots, { foreground: 'node-harness', environment });

    const said = await send(box);

    await assertCouldNotTell(box, said, label);
  });
}

test('N3 when ps is not permitted to start, as in Codex\'s sandbox, and Orca\'s runtime says node is in front, the kit cannot tell', async (t) => {
  // The runtime gives the front's name and no pid, so there is no environment
  // to read (#298, #408).
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await orcaApp(box);
  await steerReader(box, bots, { foreground: 'node-harness' });
  await box.orca.set({ ps: 'not-permitted' });

  const said = await send(box);

  await assertCouldNotTell(box, said, 'ps not permitted');
});

// ---------------------------------------------------------------------------
// N4 — what #261 leaves as it was.
// ---------------------------------------------------------------------------

test('N4 a harness named as the agent Orca names gets the Escape as before, with no mark in its environment', async (t) => {
  // A native `claude` Orca restored by itself carries none of the launch line,
  // and its name is enough, as under #232.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await steerReader(box, bots, { foreground: 'harness', environment: 'orca' });
  const front = await frontOfReader(box, bots);
  assert.equal(front.comm, 'claude', 'the premise: claude is in front');
  assert.equal(front.words.some((word) => word.startsWith('OBK_TAB_SHELL=')), false, `the premise: with no mark, got: ${front.words.join(' ')}`);

  const said = await send(box);

  await assertEscapedOnly(box, bots, said);
});

test('N4 a harness named as the agent whose environment cannot be read gets the Escape as before', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await steerReader(box, bots, { foreground: 'harness', environment: 'ps-fails' });

  const said = await send(box);

  await assertEscapedOnly(box, bots, said);
});

for (const [label, changes, state] of [
  ['a question on its screen', { screen: CLAUDE_TEACH_AUTO }, {}],
  ['Orca\'s blocked reason', {}, { waitIdle: 'blocked' }],
]) {
  test(`N4 a node harness the kit launched, with ${label}, gets no Escape`, async (t) => {
    // An Escape would answer the question.
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    await box.orca.set(state);
    await steerReader(box, bots, { foreground: 'node-harness', ...changes });

    await send(box);

    assert.deepEqual(Object.values(await sentSinceLaunch(box)).flat(), [], 'nothing went into any tab');
  });
}

test('N4 the shell in front of the reader\'s tab gets no Escape: no harness is there', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await steerReader(box, bots, { foreground: 'shell' });

  const said = await send(box);

  assert.match(said, /shell|not up|harness/i, `the output says no harness is in the tab, got: ${said}`);
  assert.deepEqual(Object.values(await sentSinceLaunch(box)).flat(), [], 'nothing went into any tab');
});

// ---------------------------------------------------------------------------
// N5 — the skills reload goes through the same gate.
// ---------------------------------------------------------------------------

/** One bot, `api-bot`, with one Claude session `daily`, up. */
async function oneBotUp(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily'])).code, 0);
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  return box.path('bots');
}

for (const [label, foreground, state, typed] of [
  ['a node harness the kit launched is typed /reload-skills', 'node-harness', 'reloaded', [{ text: '/reload-skills', enter: true }]],
  ['`less` in front, from the shell after the harness quit, is not typed into', 'program', 'unknown', []],
]) {
  test(`N5 skills build: ${label}`, async (t) => {
    const box = await createSandbox(t);
    const bots = await oneBotUp(box);
    const { tab } = await sessionIn(bots, 'api-bot', 'daily');
    await box.orca.set({
      terminals: (await box.orca.terminals()).map((one) => (one.tabId === tab ? { ...one, foreground } : one)),
    });
    await addSkills(botYamlOf(bots, 'api-bot'), 'kit:obk-tdd');

    const result = await box.run(['skills', 'build', '--bots', 'bots', '--json']);

    assert.equal(result.code, 0, result.stderr);
    await assertLinked(bots, 'api-bot', 'obk-tdd', await kitSkill('obk-tdd'));
    const sessions = entryOf(answerOf(result), 'api-bot').sessions;
    assert.deepEqual(sessions.map((entry) => [entry.session, entry.state]), [['daily', state]], `got: ${JSON.stringify(sessions)}`);
    for (const terminal of await box.orca.terminals()) {
      assert.deepEqual(sentInto(terminal).slice(1), terminal.tabId === tab ? typed : [], `what was typed into ${terminal.tabId}`);
    }
  });
}
