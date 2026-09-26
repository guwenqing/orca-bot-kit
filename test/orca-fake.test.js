// The fake Orca every sandbox runs. Nothing else in `npm test` means anything
// if this lies: a fake that says yes to everything turns every assertion about
// Orca into a test of nothing, and a fake that can be bypassed lets a CI run —
// or a developer's machine — reach the real Orca.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { createSandbox, fakeProgram } from './helpers/cli.js';

/** Call the fake Orca the way the kit would. */
function ask(box, args) {
  const done = spawnSync(box.orca.cli, args, { cwd: box.cwd, env: box.env, encoding: 'utf8' });
  assert.equal(done.error, undefined, `the fake Orca should be runnable: ${done.error?.message}`);
  return done;
}

/** The JSON the fake answered with. */
function answer(done) {
  assert.equal(done.stderr, '', `the fake should not have complained: ${done.stderr}`);
  return JSON.parse(done.stdout);
}

test('OBK_ORCA names a runnable fake inside the sandbox', async (t) => {
  const box = await createSandbox(t);

  assert.equal(box.env.OBK_ORCA, box.orca.cli);
  assert.ok(box.orca.cli.startsWith(`${box.root}${path.sep}`), `${box.orca.cli} should be inside the sandbox`);
  assert.ok(statSync(box.orca.cli).mode & 0o111, 'the fake should be executable');
  assert.notEqual(box.env.OBK_ORCA, '/Applications/Orca.app/Contents/Resources/bin/orca');
});

test('the fake says Orca is up, and can be told to say it is not', async (t) => {
  const box = await createSandbox(t);

  const up = answer(ask(box, ['status', '--json']));
  assert.equal(up.ok, true);
  assert.equal(up.result.runtime.reachable, true);

  await box.orca.set({ reachable: false });

  assert.equal(answer(ask(box, ['status', '--json'])).result.runtime.reachable, false);
});

test('the fake refuses a tab in a folder Orca has not registered', async (t) => {
  // The live rule this whole slice rests on: a git-kind registration of a
  // folder inside a git repo has no worktree, and this is what Orca says then.
  const box = await createSandbox(t);
  const home = box.path('bots', 'bots', 'bot-father');

  const refused = answer(ask(box, ['terminal', 'create', '--worktree', `path:${home}`, '--title', 'Daily', '--json']));

  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, 'selector_not_found');
  assert.deepEqual(await box.orca.terminals(), []);
});

test('the fake registers a folder as git, and takes the correction', async (t) => {
  const box = await createSandbox(t);
  const home = box.path('bots', 'bots', 'bot-father');

  const added = answer(ask(box, ['repo', 'add', '--path', home, '--json']));
  assert.equal(added.ok, true);
  assert.equal(added.result.repo.kind, 'git', 'Orca calls a folder inside a git repo a git repo');

  const listed = answer(ask(box, ['project', 'setups', '--json']));
  assert.deepEqual(listed.result.setups.map((setup) => setup.path), [home]);

  const fixed = answer(ask(box, [
    'project', 'setup-update', '--setup', added.result.repo.id,
    '--kind', 'folder', '--display-name', 'Bot Father', '--json',
  ]));
  assert.equal(fixed.result.result.setup.kind, 'folder');
  assert.equal(fixed.result.result.setup.displayName, 'Bot Father');

  const created = answer(ask(box, [
    'terminal', 'create', '--worktree', `path:${home}`, '--title', 'Bot Father daily', '--json',
  ]));
  assert.equal(created.ok, true);
  assert.equal(created.result.terminal.worktreePath, home);

  const tabs = answer(ask(box, ['terminal', 'list', '--worktree', `path:${home}`, '--json']));
  assert.deepEqual(tabs.result.terminals.map((terminal) => terminal.tabId), [created.result.terminal.tabId]);
  // What was typed into a tab is the fake's own bookkeeping. Orca reports no
  // such thing, which is why a tab cannot be recognised by what it runs.
  assert.equal('typed' in tabs.result.terminals[0], false);
});

test('the fake refuses a tab created with a bare harness name on it', async (t) => {
  // Proven live, three times for each harness: Orca gives up waiting for the
  // handle, and the tab it leaves behind never shows up in `terminal list`.
  const box = await createSandbox(t);
  const home = box.path('bots', 'bots', 'bot-father');
  answer(ask(box, ['repo', 'add', '--path', home, '--json']));
  const setup = (await box.orca.setups())[0];
  answer(ask(box, ['project', 'setup-update', '--setup', setup.id, '--kind', 'folder', '--json']));

  for (const harness of ['claude', 'codex']) {
    const refused = answer(ask(box, [
      'terminal', 'create', '--worktree', `path:${home}`, '--title', 'Daily', '--command', harness, '--json',
    ]));
    assert.equal(refused.ok, false);
    assert.equal(refused.error.code, 'runtime_error');
    assert.match(refused.error.message, /Timed out waiting for terminal handle/);
  }
  assert.deepEqual(await box.orca.terminals(), [], 'the orphan tab is not one Orca will list');
});

test('the fake waits, and remembers what was typed into a tab', async (t) => {
  const box = await createSandbox(t);
  const home = box.path('bots', 'bots', 'bot-father');
  answer(ask(box, ['repo', 'add', '--path', home, '--json']));
  const setup = (await box.orca.setups())[0];
  answer(ask(box, ['project', 'setup-update', '--setup', setup.id, '--kind', 'folder', '--json']));
  const made = answer(ask(box, ['terminal', 'create', '--worktree', `path:${home}`, '--title', 'Daily', '--json']));
  const handle = made.result.terminal.handle;

  const idle = answer(ask(box, ['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '10000', '--json']));
  assert.equal(idle.result.wait.satisfied, true);

  const sent = answer(ask(box, ['terminal', 'send', '--terminal', handle, '--text', 'claude', '--enter', '--json']));
  assert.equal(sent.result.accepted, true);
  assert.deepEqual((await box.orca.terminals())[0].typed, [{ text: 'claude', enter: true }]);

  // A shell that is busy with a question of its own is not idle, and Orca says
  // so by refusing: seen live, twice, at 3s and at 8s, on a tab held by the
  // oh-my-zsh update question.
  await box.orca.set({ waitIdle: false });
  const busy = ask(box, ['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '10000', '--json']);
  assert.equal(busy.status, 1, 'a wait that runs out of time exits 1');
  const refusal = JSON.parse(busy.stdout);
  assert.equal(refusal.ok, false);
  assert.equal(refusal.error.code, 'timeout');
  assert.equal(refusal.error.message, 'timeout');

  const nowhere = answer(ask(box, ['terminal', 'send', '--terminal', 'term_gone', '--text', 'claude', '--enter', '--json']));
  assert.equal(nowhere.ok, false, 'there is nothing to type into a tab that is gone');
});

test('the fake can hold a TUI on one look and none on the next', async (t) => {
  // A harness that starts, prints what it cannot do and exits: the tab has a
  // TUI in it for a moment and a shell prompt after that. One look cannot tell
  // it from a harness that is up and working, which is the whole reason a
  // second look exists, so the fake has to be able to say it.
  const box = await createSandbox(t);
  const home = box.path('bots', 'bots', 'bot-father');
  answer(ask(box, ['repo', 'add', '--path', home, '--json']));
  const setup = (await box.orca.setups())[0];
  answer(ask(box, ['project', 'setup-update', '--setup', setup.id, '--kind', 'folder', '--json']));
  const made = answer(ask(box, ['terminal', 'create', '--worktree', `path:${home}`, '--title', 'Daily', '--json']));
  const handle = made.result.terminal.handle;
  const look = () => ask(box, ['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '10000', '--json']);

  await box.orca.set({ waitIdle: [true, false] });

  const first = answer(look());
  assert.equal(first.ok, true, 'the harness was up when the first look came');
  assert.equal(first.result.wait.satisfied, true);

  for (const again of [look(), look()]) {
    assert.equal(again.status, 1, 'and gone for every look after, the list\'s last answer standing');
    assert.equal(JSON.parse(again.stdout).error.code, 'timeout');
  }
});

/** A folder project with one tab in it, and the handle and pty id Orca gave the tab. */
function oneTab(box) {
  const home = box.path('bots', 'bots', 'bot-father');
  const added = answer(ask(box, ['repo', 'add', '--path', home, '--json']));
  answer(ask(box, ['project', 'setup-update', '--setup', added.result.repo.id, '--kind', 'folder', '--json']));
  const made = answer(ask(box, ['terminal', 'create', '--worktree', `path:${home}`, '--title', 'Daily', '--json']));
  return { handle: made.result.terminal.handle, ptyId: made.result.terminal.ptyId };
}

/** Run the fake ps the way the kit may: one pid, four columns. */
function ps(box, pid) {
  return spawnSync(box.ps.cli, ['-o', 'pid=,ppid=,tpgid=,comm=', '-p', String(pid)], { env: box.env, encoding: 'utf8' });
}

/** One ps line as numbers and a name: the name last, and it may hold spaces. */
function psLine(done) {
  assert.equal(done.status, 0, `ps should have found it: ${done.stderr}`);
  const [pid, ppid, tpgid, ...comm] = done.stdout.trim().split(/\s+/);
  return { pid: Number(pid), ppid: Number(ppid), tpgid: Number(tpgid), comm: comm.join(' ') };
}

test('the fake tab holds a login, a shell and a harness, in the shape seen live', async (t) => {
  // Measured on Orca 1.4.209 with Claude Code 2.1.281 (#232): the pane's pid is
  // /usr/bin/login, the shell is its child, the harness the shell's child, and
  // every one of them names whoever is in front. A fake that got this wrong
  // would pass a kit that reads the wrong process.
  const box = await createSandbox(t);
  const { handle, ptyId } = oneTab(box);
  answer(ask(box, ['terminal', 'send', '--terminal', handle, '--text', 'OBK_TAB_SHELL=$$ claude -n a.b', '--enter', '--json']));

  const memory = answer(ask(box, ['diagnostics', 'memory', '--json']));
  assert.deepEqual(
    Object.keys(memory.result).sort(),
    ['app', 'collectedAt', 'host', 'processMemoryMetric', 'totalCpu', 'totalMemory', 'worktrees'],
  );
  const panes = memory.result.worktrees.flatMap((worktree) => worktree.sessions);
  const pane = panes.find((one) => one.sessionId === ptyId);
  assert.ok(pane, `the tab's pty id should name a pane, got: ${JSON.stringify(panes)}`);

  const login = psLine(ps(box, pane.pid));
  assert.equal(login.comm, '/usr/bin/login');
  const harness = psLine(ps(box, login.tpgid));
  assert.equal(harness.comm, 'claude', 'the harness is in front');
  const shell = psLine(ps(box, harness.ppid));
  assert.equal(shell.comm, '-/bin/zsh');
  assert.equal(shell.ppid, pane.pid, 'and the shell is the pane\'s child');

  // The harness quits: the shell is in front, and Orca still names the agent.
  await box.orca.set({ waitIdle: 'quit' });
  const back = psLine(ps(box, pane.pid));
  assert.equal(psLine(ps(box, back.tpgid)).comm, '-/bin/zsh');
  assert.equal(answer(ask(box, ['terminal', 'show', '--terminal', handle, '--json'])).result.terminal.agentIdentity, 'claude');
});

test('the fake ps reads one pid and does nothing else', async (t) => {
  const box = await createSandbox(t);

  const missing = ps(box, 99999);
  assert.equal(missing.status, 1, 'a pid that is not there');
  assert.notEqual(missing.stderr, '');

  for (const argv of [['-Ao', 'pid=,ppid=,comm='], ['-o', 'pid=,ppid=,tpgid=,comm=', '-p', '-1'], ['-e']]) {
    const refused = spawnSync(box.ps.cli, argv, { env: box.env, encoding: 'utf8' });
    assert.equal(refused.status, 70, `${argv.join(' ')} is not a read of one pid`);
  }
  assert.equal((await box.ps.calls()).length, 4, 'and every call is on the record, the refused ones too');
});

test('the fake times out on a busy harness, and answers ok for a shell a harness quit to', async (t) => {
  const box = await createSandbox(t);
  const { handle } = oneTab(box);
  const look = () => ask(box, ['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '10000', '--json']);

  await box.orca.set({ waitIdle: 'busy' });
  const busy = look();
  assert.equal(busy.status, 1);
  assert.equal(JSON.parse(busy.stdout).error.code, 'timeout');

  await box.orca.set({ waitIdle: 'quit' });
  const quit = answer(look());
  assert.equal(quit.ok, true);
  assert.equal(quit.result.wait.satisfied, true);
});

test('the fake answers human text when the caller forgets --json', async (t) => {
  const box = await createSandbox(t);

  const done = ask(box, ['status']);

  assert.equal(done.status, 0);
  assert.throws(() => JSON.parse(done.stdout), 'without --json there is nothing to parse');
});

test('the fake can be made to fail, to crash and to talk nonsense', async (t) => {
  const box = await createSandbox(t);

  await box.orca.set({ fail: { 'project setups': { code: 'locked', message: 'the store is locked' } } });
  const refused = ask(box, ['project', 'setups', '--json']);
  assert.equal(refused.status, 1);
  assert.equal(JSON.parse(refused.stdout).error.message, 'the store is locked');

  await box.orca.set({ fail: {}, crash: { command: 'status', exitCode: 3, stderr: 'boom\n' } });
  const crashed = ask(box, ['status', '--json']);
  assert.equal(crashed.status, 3);
  assert.equal(crashed.stdout, '');

  await box.orca.set({ crash: null, garbage: { command: 'status', text: 'starting up\n' } });
  const nonsense = ask(box, ['status', '--json']);
  assert.equal(nonsense.status, 0);
  assert.equal(nonsense.stdout, 'starting up\n');
});

test('the fake can be slow to answer one command, and then answers it as it would have', async (t) => {
  const box = await createSandbox(t);
  await box.orca.set({ hang: { command: 'status', ms: 1500 } });

  const started = Date.now();
  const slow = answer(ask(box, ['status', '--json']));
  const took = Date.now() - started;

  assert.ok(took >= 1500, `the call should have waited, took ${took} ms`);
  assert.equal(slow.ok, true, 'and then answered as ever');
  assert.equal(slow.result.runtime.reachable, true);
});

test('the fake records every call, in order, with what it was asked', async (t) => {
  const box = await createSandbox(t);

  ask(box, ['status', '--json']);
  ask(box, ['project', 'setups', '--json']);

  assert.deepEqual(await box.orca.calls(), [
    { args: ['status', '--json'], cwd: box.cwd },
    { args: ['project', 'setups', '--json'], cwd: box.cwd },
  ]);
});

// The mailbox's binding rules, as Orca 1.4.209 was seen to keep them (issue
// #228), and as 1.4.210 narrowed them (#317): a caller in a tab may act as that
// tab and no other. A fake that bound Runs loosely would pass a kit that sends
// a fleet's notices into the wrong tab, or one that Orca now refuses outright.

/** Two live tabs of the fake's own, A and B, and a way to call Orca from inside either or from neither. */
async function twoTabs(box) {
  const tab = (name) => ({ handle: `term_${name}`, tabId: `tab_${name}`, worktreePath: box.cwd, title: name, typed: [] });
  await box.orca.set({ terminals: [tab('a'), tab('b')] });
  const from = (handle) => (args) => {
    const env = handle === undefined ? box.env : { ...box.env, ORCA_TERMINAL_HANDLE: handle };
    const done = spawnSync(box.orca.cli, [...args, '--json'], { cwd: box.cwd, env, encoding: 'utf8' });
    return JSON.parse(done.stdout);
  };
  return { inA: from('term_a'), inB: from('term_b'), outside: from(undefined) };
}

/** Orca's record of one Run, as `run-show` answers it. */
const shown = (call, id) => call(['orchestration', 'run-show', '--id', id]).result.run;

test('the fake binds a Run to the caller\'s own terminal, or, from outside Orca, to the one --from names', async (t) => {
  const box = await createSandbox(t);
  const { inA, inB, outside } = await twoTabs(box);

  const mine = inA(['orchestration', 'run-create', '--objective', 'mine']).result.run.id;
  assert.equal(shown(inA, mine).coordinator_handle, 'term_a', 'no --from: the caller\'s own terminal');

  const named = inB(['orchestration', 'run-create', '--objective', 'named', '--from', 'term_b']).result.run.id;
  assert.equal(shown(inA, named).coordinator_handle, 'term_b', '--from its own handle: the caller\'s own terminal too');

  const theirs = outside(['orchestration', 'run-create', '--objective', 'theirs', '--from', 'term_a']).result.run.id;
  assert.equal(shown(inA, theirs).coordinator_handle, 'term_a', '--from outside Orca: that terminal');
  assert.equal(shown(inA, named).coordinator_handle, 'term_b', 'and B keeps what it had');
});

test('one terminal holds one Run: binding it to a second leaves the first with no coordinator', async (t) => {
  const box = await createSandbox(t);
  const { inA, inB } = await twoTabs(box);
  const first = inA(['orchestration', 'run-create', '--objective', 'first']).result.run.id;
  const second = inB(['orchestration', 'run-create', '--objective', 'second']).result.run.id;

  inA(['orchestration', 'run-use', '--id', second]);

  assert.equal(shown(inA, second).coordinator_handle, 'term_a');
  assert.equal(shown(inA, first).coordinator_handle, null, 'A let go of the first Run, and nobody took it');
});

test('the fake refuses to bind a Run to no terminal, or to a handle with no live pane', async (t) => {
  const box = await createSandbox(t);
  const { inA, outside } = await twoTabs(box);
  const run = inA(['orchestration', 'run-create', '--objective', 'held']).result.run.id;

  assert.equal(outside(['orchestration', 'run-create', '--objective', 'x']).error?.code, 'no_active_sender_terminal');
  assert.equal(outside(['orchestration', 'run-use', '--id', run]).error?.code, 'no_active_sender_terminal');
  assert.equal(outside(['orchestration', 'run-use', '--id', run, '--from', 'term_gone']).error?.code, 'stable_pane_required');
  assert.equal(
    outside(['orchestration', 'run-create', '--objective', 'y', '--from', 'term_b']).ok,
    true,
    'from outside Orca, naming a live terminal is how it is done (1.4.209; not measured on 1.4.210)',
  );
  assert.equal(shown(inA, run).coordinator_handle, 'term_a', 'and nothing refused moved anything');
});

test('on 1.4.210 a tab acts as itself and no other: naming another terminal is refused and changes nothing', async (t) => {
  // Measured live on 2026-09-25 (#317). The refusal is Orca's own, word for
  // word but for the request id, and it says nothing was done. Reading as a
  // closed tab is refused the same way, and naming the caller's own handle, or
  // none, goes through; so do `run-show` and `send`, from any tab.
  const box = await createSandbox(t);
  const { inA, inB, outside } = await twoTabs(box);
  const held = inB(['orchestration', 'run-create', '--objective', 'held']).result.run.id;
  outside(['orchestration', 'send', '--to', `run:${held}`, '--subject', 'for b']);
  const before = await box.orca.state();

  const refused = [
    inA(['orchestration', 'run-create', '--objective', 'x', '--from', 'term_b']),
    inA(['orchestration', 'run-use', '--id', held, '--from', 'term_b']),
    inA(['orchestration', 'check', '--run', held, '--terminal', 'term_b']),
    inA(['orchestration', 'check', '--run', held, '--terminal', 'term_b', '--peek']),
  ];

  for (const answer of refused) {
    assert.equal(answer.ok, false, `this should have been refused, got: ${JSON.stringify(answer)}`);
    assert.equal(answer.error.code, 'consumer_fenced');
    assert.match(
      answer.error.message,
      /^This terminal is attested as term_a and cannot act as term_b\. Orchestration mutation request ID: [0-9a-f-]{36}\.$/,
    );
    assert.deepEqual(answer.error.data, { effectsApplied: false });
  }
  const after = await box.orca.state();
  assert.deepEqual(after.runs, before.runs, 'no Run was made, and none moved');
  assert.equal(after.nextId, before.nextId, 'not even an id was spent');
  assert.deepEqual(after.messages, before.messages, 'no mail was read');
  assert.deepEqual(after.deliveries ?? [], before.deliveries ?? [], 'and no batch was handed out');

  outside(['terminal', 'close', '--terminal', 'term_b', '--tab']);
  const closed = inA(['orchestration', 'check', '--run', held, '--terminal', 'term_b', '--peek']).error;
  assert.equal(closed?.code, 'consumer_fenced', 'reading as a closed tab is refused the same way');
  assert.match(closed?.message ?? '', /^This terminal is attested as term_a and cannot act as term_b\./);

  assert.equal(inA(['orchestration', 'run-show', '--id', held]).ok, true, 'run-show works from any tab');
  assert.equal(inA(['orchestration', 'send', '--to', `run:${held}`, '--subject', 'from a']).ok, true, 'and so does send');
  assert.equal(inA(['orchestration', 'run-use', '--id', held, '--from', 'term_a']).ok, true, 'naming its own handle goes through');
  assert.equal(shown(inA, held).coordinator_handle, 'term_a', 'and a new tab takes the Run over from the closed one');
  assert.equal(inA(['orchestration', 'check', '--run', held, '--terminal', 'term_a', '--peek']).ok, true);
  assert.equal(inA(['orchestration', 'check', '--run', held, '--peek']).ok, true, 'and so does naming none');
});

test('the fake writes down which terminal each call came from, and nothing for a plain shell', async (t) => {
  const box = await createSandbox(t);
  const { inA, inB, outside } = await twoTabs(box);

  inA(['status']);
  outside(['status']);
  inB(['status']);

  assert.deepEqual((await box.orca.calls()).map((call) => call.caller), ['term_a', undefined, 'term_b']);
});

test('the fake runs the mailbox step a launch line starts with, as the tab it was typed into, and never the harness', async (t) => {
  // The tab's own shell runs what the kit types into it (#317). The fake runs
  // the step in front of the harness and nothing else: the harness is a real
  // program. What the step runs as is the tab's terminal, not the terminal of
  // whoever typed the line, whose Orca variables and OBK_CLI stay behind.
  const box = await createSandbox(t);
  await twoTabs(box);
  const step = await fakeProgram(box, 'stepper', { stdout: 'made it\n', exitCode: 3 });
  const harness = await fakeProgram(box, 'claude', {});
  const typer = {
    ...box.env,
    ORCA_TERMINAL_HANDLE: 'term_a',
    ORCA_TAB_ID: 'tab_a',
    ORCA_SOMETHING_ELSE: 'of tab a',
    OBK_CLI: '/elsewhere/bin/obk',
  };
  const type = (text) => JSON.parse(spawnSync(
    box.orca.cli,
    ['terminal', 'send', '--terminal', 'term_b', '--text', text, '--enter', '--json'],
    { cwd: box.cwd, env: typer, encoding: 'utf8' },
  ).stdout);
  const line = 'stepper session mailbox --bots here --bot coder --session daily; OBK_TAB_SHELL=$$ OBK_CLI=obk claude -n coder.daily';

  assert.equal(type(line).ok, true);

  const calls = await step.calls();
  assert.equal(calls.length, 1, 'the step is run once');
  assert.deepEqual(calls[0].args, ['session', 'mailbox', '--bots', 'here', '--bot', 'coder', '--session', 'daily']);
  assert.equal(calls[0].env.ORCA_TERMINAL_HANDLE, 'term_b', 'as the tab it was typed into');
  assert.equal(calls[0].env.ORCA_TAB_ID, 'tab_b');
  assert.equal(calls[0].env.ORCA_SOMETHING_ELSE, undefined, 'with none of the typer\'s Orca variables');
  assert.equal(calls[0].env.OBK_CLI, undefined, 'nor the CLI a tab of the typer\'s was launched with');
  assert.deepEqual(await harness.calls(), [], 'the harness is never run');
  assert.deepEqual(
    (await box.orca.steps()).map(({ handle, tabId, step: ran, status, stdout }) => ({ handle, tabId, ran, status, stdout })),
    [{ handle: 'term_b', tabId: 'tab_b', ran: 'stepper session mailbox --bots here --bot coder --session daily', status: 3, stdout: 'made it\n' }],
    'and what it did is written down',
  );

  // Nothing else that is typed is run: a line with no step, and a step that is not the mailbox's.
  type('OBK_TAB_SHELL=$$ OBK_CLI=obk claude -n coder.daily');
  type('stepper something else; OBK_TAB_SHELL=$$ OBK_CLI=obk claude -n coder.daily');
  type('Fleet mail from a/b: hello. Read it with  stepper message check --bots here');
  // And a shell that has not got to the step yet has not run it.
  await box.orca.set({ holdSteps: true });
  type(line);

  assert.equal((await step.calls()).length, 1, 'still the one run');
  assert.equal((await box.orca.steps()).length, 1);
  assert.equal(
    (await box.orca.terminals()).find((terminal) => terminal.handle === 'term_b').typed.length,
    5,
    'though every line was typed in',
  );
});

test('the fake tells a Run\'s coordinator about its mail, and nobody else', async (t) => {
  const box = await createSandbox(t);
  const { inA, inB, outside } = await twoTabs(box);
  const toA = inA(['orchestration', 'run-create', '--objective', 'a']).result.run.id;
  const loose = inB(['orchestration', 'run-create', '--objective', 'loose']).result.run.id;
  inB(['orchestration', 'run-use', '--id', toA]);

  outside(['orchestration', 'send', '--to', `run:${toA}`, '--subject', 'hello']);
  outside(['orchestration', 'send', '--to', `run:${loose}`, '--subject', 'nobody hears this']);

  const notices = Object.fromEntries((await box.orca.terminals()).map((terminal) => [terminal.handle, terminal.notices ?? []]));
  assert.deepEqual(notices, {
    term_a: [],
    term_b: [`You have 1 orchestration message. Run \`orca orchestration check --run ${toA}\``],
  });
});

test('a terminal bound to one Run is fenced out of reading another', async (t) => {
  const box = await createSandbox(t);
  const { inA, inB } = await twoTabs(box);
  const toA = inA(['orchestration', 'run-create', '--objective', 'a']).result.run.id;
  inB(['orchestration', 'run-create', '--objective', 'b']);

  assert.equal(inB(['orchestration', 'check', '--run', toA]).error?.code, 'consumer_fenced');
  assert.equal(inA(['orchestration', 'check', '--run', toA]).ok, true);
});

test('check --terminal reads and acks as that terminal from outside Orca, and from another tab 1.4.210 refuses it', async (t) => {
  // Seen live on 1.4.209: the fence is judged against the terminal named, not
  // against the caller, so a caller could read a Run through the terminal that
  // holds it, and neither binding moved. On 1.4.210 a caller in another tab is
  // refused that (#317); from outside Orca the fake still allows it, which was
  // not measured on 1.4.210.
  const box = await createSandbox(t);
  const { inA, inB, outside } = await twoTabs(box);
  const toA = inA(['orchestration', 'run-create', '--objective', 'a']).result.run.id;
  const toB = inB(['orchestration', 'run-create', '--objective', 'b']).result.run.id;
  outside(['orchestration', 'send', '--to', `run:${toB}`, '--subject', 'for b']);

  assert.equal(inA(['orchestration', 'check', '--run', toB]).error?.code, 'consumer_fenced', 'as itself, A is fenced out');
  assert.equal(
    inB(['orchestration', 'check', '--run', toB, '--terminal', 'term_a']).error?.code,
    'consumer_fenced',
    'and naming A is fenced out from B',
  );
  assert.equal(
    inA(['orchestration', 'check', '--run', toB, '--terminal', 'term_b', '--peek']).error?.code,
    'consumer_fenced',
    'and so is A naming B: a tab reads as itself only',
  );
  const peeked = outside(['orchestration', 'check', '--run', toB, '--terminal', 'term_b', '--peek']).result;
  assert.deepEqual(peeked.messages.map((message) => message.subject), ['for b'], 'as B, a plain shell reads B\'s mail');
  const read = outside(['orchestration', 'check', '--run', toB, '--terminal', 'term_b']).result;
  outside(['orchestration', 'check', '--run', toB, '--terminal', 'term_b', '--ack', read.deliveryId]);

  assert.deepEqual((await box.orca.messages()).map((message) => message.acked), [true], 'and acks it as B');
  assert.equal(shown(inA, toA).coordinator_handle, 'term_a', 'A still holds its own Run');
  assert.equal(shown(inA, toB).coordinator_handle, 'term_b', 'and B still holds its own');
});

test('a read binds nothing: only the Run\'s coordinator reads it, even after its tab is closed', async (t) => {
  // Seen live on 1.4.209 (#249): a closed tab stays its Run's coordinator and
  // reading as its handle works. A live tab holding no Run is fenced, a handle
  // Orca never issued has no stable pane, and once the Run is bound to a new
  // tab the closed handle is fenced out too.
  const box = await createSandbox(t);
  const { inA, inB, outside } = await twoTabs(box);
  const toB = inB(['orchestration', 'run-create', '--objective', 'b']).result.run.id;
  outside(['orchestration', 'send', '--to', `run:${toB}`, '--subject', 'for b']);
  outside(['terminal', 'close', '--terminal', 'term_b', '--tab']);

  const peeked = outside(['orchestration', 'check', '--run', toB, '--terminal', 'term_b', '--peek']).result;
  assert.deepEqual(peeked.messages.map((message) => message.subject), ['for b'], 'as the closed coordinator, it reads');
  const read = outside(['orchestration', 'check', '--run', toB, '--terminal', 'term_b']).result;
  outside(['orchestration', 'check', '--run', toB, '--terminal', 'term_b', '--ack', read.deliveryId]);
  assert.deepEqual((await box.orca.messages()).map((message) => message.acked), [true], 'and acks');
  assert.equal(shown(inA, toB).coordinator_handle, 'term_b', 'and the Run still names the closed tab');

  const unbound = inA(['orchestration', 'check', '--run', toB]).error;
  assert.equal(unbound?.code, 'consumer_fenced', 'a live tab that holds no Run is fenced');
  assert.equal(unbound?.message, `This coordinator terminal is no longer bound to Run ${toB}.`);
  assert.equal(
    outside(['orchestration', 'check', '--run', toB, '--terminal', 'term_never']).error?.code,
    'stable_pane_required',
    'a handle Orca never issued has no stable pane',
  );

  inA(['orchestration', 'run-use', '--id', toB]);
  const moved = outside(['orchestration', 'check', '--run', toB, '--terminal', 'term_b', '--peek']).error;
  assert.equal(moved?.code, 'consumer_fenced', 'once the Run is bound to a new tab the closed handle is fenced');
  assert.equal(moved?.message, `This coordinator terminal is no longer bound to Run ${toB}.`);
});

test('the sandbox does not hand the kit the Orca tab the suite itself runs in', async (t) => {
  // Run from inside Orca, the suite has a real ORCA_TERMINAL_HANDLE and the
  // rest. None of them is a terminal in the fake's world.
  const was = process.env.ORCA_TERMINAL_HANDLE;
  process.env.ORCA_TERMINAL_HANDLE = 'term_the_suites_own';
  t.after(() => {
    if (was === undefined) delete process.env.ORCA_TERMINAL_HANDLE;
    else process.env.ORCA_TERMINAL_HANDLE = was;
  });

  const box = await createSandbox(t);

  assert.deepEqual(Object.keys(box.env).filter((name) => name.startsWith('ORCA_')), []);
});

test('the fake hands a Run\'s mail over a batch at a time, replayed until acked, as Orca 1.4.209 does', async (t) => {
  // Read in Orca's bundle and seen live in #299: a plain read replays the one
  // outstanding delivery even after newer mail came in, `--ack` takes exactly
  // that delivery and answers with the next batch, and a peek lists every
  // unread message whatever batch it is in.
  const box = await createSandbox(t);
  const { inA, outside } = await twoTabs(box);
  const run = inA(['orchestration', 'run-create', '--objective', 'a']).result.run.id;
  const subjects = (answer) => answer.messages.map((message) => message.subject);
  outside(['orchestration', 'send', '--to', `run:${run}`, '--subject', 'older']);

  const first = inA(['orchestration', 'check', '--run', run]).result;
  assert.deepEqual(subjects(first), ['older']);
  assert.match(first.deliveryId, /^delivery_/, 'a delivery has an id of its own, not a message\'s');
  assert.equal(first.count, 1);
  assert.equal(first.runId, run);

  outside(['orchestration', 'send', '--to', `run:${run}`, '--subject', 'newer']);
  const again = inA(['orchestration', 'check', '--run', run]).result;
  assert.deepEqual(subjects(again), ['older'], 'the outstanding batch is replayed, and the newer mail waits behind it');
  assert.equal(again.deliveryId, first.deliveryId);
  assert.equal(again.replayed, true);

  const peeked = inA(['orchestration', 'check', '--run', run, '--peek']).result;
  assert.deepEqual(subjects(peeked), ['older', 'newer'], 'a peek shows every unread message');
  assert.equal(peeked.count, 2);
  assert.equal(peeked.deliveryId, undefined, 'and names no delivery');

  const [older] = await box.orca.messages();
  assert.equal(
    inA(['orchestration', 'check', '--run', run, '--ack', older.id]).error?.code,
    'stale_delivery',
    'a message id is not a delivery id',
  );

  const next = inA(['orchestration', 'check', '--run', run, '--ack', first.deliveryId]).result;
  assert.equal(next.acknowledged, first.deliveryId);
  assert.deepEqual(subjects(next), ['newer'], 'the ack answers with the next batch');
  assert.notEqual(next.deliveryId, first.deliveryId);
  assert.deepEqual((await box.orca.messages()).map((message) => message.acked), [true, false], 'only the acked batch is read');

  const last = inA(['orchestration', 'check', '--run', run, '--ack', next.deliveryId]).result;
  assert.equal(last.acknowledged, next.deliveryId);
  assert.equal(last.deliveryId, null, 'nothing is left');
  assert.equal(last.count, 0);
  assert.deepEqual(last.messages, []);
  assert.deepEqual((await box.orca.messages()).map((message) => message.acked), [true, true]);
});

test('the fake puts at most 50 messages in a batch, and shows at most 100 in a peek', async (t) => {
  const box = await createSandbox(t);
  const { inA } = await twoTabs(box);
  const run = inA(['orchestration', 'run-create', '--objective', 'a']).result.run.id;
  await box.orca.set({
    messages: Array.from({ length: 120 }, (_, i) => ({
      id: `msg_seeded_${i + 1}`, to: `run:${run}`, from: null, subject: `note ${i + 1}`, body: '',
      type: 'status', priority: 'normal', threadId: null, at: '2026-09-24T12:00:00.000Z', acked: false,
    })),
  });

  const peeked = inA(['orchestration', 'check', '--run', run, '--peek']).result;
  const read = inA(['orchestration', 'check', '--run', run]).result;
  const next = inA(['orchestration', 'check', '--run', run, '--ack', read.deliveryId]).result;

  assert.equal(peeked.count, 100);
  assert.equal(read.count, 50);
  assert.equal(read.messages.at(-1).subject, 'note 50', 'the oldest 50');
  assert.equal(next.count, 50);
  assert.equal(next.messages[0].subject, 'note 51', 'and the next 50 after them');
});

test('the fake can refuse a handle as stale for a while, and hand it out anew at the next listing', async (t) => {
  // Seen live on 1.4.209 (#294): `terminal wait` refused a handle `terminal
  // list` had just given with `terminal_handle_stale`, and minutes later the
  // same handle worked. A fake that can only fail for ever cannot show a kit
  // that tries again.
  const box = await createSandbox(t);
  const home = box.path('bots', 'bots', 'bot-father');
  answer(ask(box, ['repo', 'add', '--path', home, '--json']));
  const setup = (await box.orca.setups())[0];
  answer(ask(box, ['project', 'setup-update', '--setup', setup.id, '--kind', 'folder', '--json']));
  const handle = answer(ask(box, ['terminal', 'create', '--worktree', `path:${home}`, '--title', 'Daily', '--json'])).result.terminal.handle;
  const wait = (on) => ask(box, ['terminal', 'wait', '--terminal', on, '--for', 'tui-idle', '--timeout-ms', '2000', '--json']);
  const list = () => answer(ask(box, ['terminal', 'list', '--worktree', `path:${home}`, '--json'])).result.terminals;

  await box.orca.set({ fail: { 'terminal wait': { code: 'terminal_handle_stale', message: 'terminal_handle_stale', after: 1, times: 1 } } });
  assert.equal(JSON.parse(wait(handle).stdout).ok, true, 'the first call goes through');
  const stale = JSON.parse(wait(handle).stdout);
  assert.deepEqual([stale.ok, stale.error.code], [false, 'terminal_handle_stale'], 'the next one is refused');
  assert.equal(JSON.parse(wait(handle).stdout).ok, true, 'and the one after it goes through again');

  // The same refusal, with the listing after it handing the tab out anew.
  await box.orca.set({ fail: { 'terminal wait': { code: 'terminal_handle_stale', message: 'terminal_handle_stale' } }, reissue: { [handle]: 'term_90' } });
  assert.deepEqual(list().map((terminal) => terminal.handle), [handle], 'nothing is re-issued before a refusal');
  assert.equal(JSON.parse(wait(handle).stdout).error.code, 'terminal_handle_stale');
  assert.deepEqual(list().map((terminal) => terminal.handle), ['term_90'], 'the listing after the refusal hands out the new handle');
  await box.orca.set({ fail: {} });
  assert.equal(JSON.parse(wait('term_90').stdout).ok, true, 'which works');
  assert.equal(JSON.parse(wait(handle).stdout).error.code, 'terminal_not_found', 'and the old one names nothing any more');
});
