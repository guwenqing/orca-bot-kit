// The fake Orca every sandbox runs. Nothing else in `npm test` means anything
// if this lies: a fake that says yes to everything turns every assertion about
// Orca into a test of nothing, and a fake that can be bypassed lets a CI run —
// or a developer's machine — reach the real Orca.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { createSandbox, fakeProgram } from './helpers/cli.js';
import { CLAUDE_IDLE, CODEX_IDLE, CODEX_NEW_MENU, CODEX_UPDATE_OFFER, questionOn } from './helpers/screens.js';

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
  // Where Orca 1.4.214 puts it: under `send`, beside the prompt's receipt (#394).
  assert.equal(sent.result.send.accepted, true);
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

test('the fake ps reads one process\'s environment the way macOS prints it, and in no other shape', async (t) => {
  // Measured on Orca 1.4.210 (#318, tech notes section 1): `ps -E -ww -o
  // command= -p <pid>` prints the command and its arguments, then every
  // variable as a NAME=value word. A harness the kit's launch line started
  // carries OBK_TAB_SHELL, the pid of the shell it ran in; one Orca resumed by
  // itself carries Orca's variables and none of the kit's. A fake that got
  // this wrong would pass a kit that reads the wrong process or the wrong word.
  const box = await createSandbox(t);
  const { handle, ptyId } = oneTab(box);
  answer(ask(box, ['terminal', 'send', '--terminal', handle, '--text', 'OBK_TAB_SHELL=$$ OBK_CLI=/x/obk claude -n a.b', '--enter', '--json']));
  const { tabId } = (await box.orca.terminals()).find((one) => one.handle === handle);
  const panes = answer(ask(box, ['diagnostics', 'memory', '--json'])).result.worktrees.flatMap((worktree) => worktree.sessions);
  const login = psLine(ps(box, panes.find((one) => one.sessionId === ptyId).pid));
  const harness = psLine(ps(box, login.tpgid));
  const environment = (pid) => spawnSync(box.ps.cli, ['-E', '-ww', '-o', 'command=', '-p', String(pid)], { env: box.env, encoding: 'utf8' });
  const wordsOf = (pid) => {
    const done = environment(pid);
    assert.equal(done.status, 0, done.stderr);
    return done.stdout.trim().split(' ');
  };
  const kits = (words) => words.filter((word) => word.startsWith('OBK_'));

  const launched = wordsOf(harness.pid);
  assert.deepEqual(launched.slice(0, 3), ['claude', '-n', 'a.b'], `the command comes first, got: ${launched.join(' ')}`);
  assert.ok(launched.includes(`ORCA_TAB_ID=${tabId}`), `then Orca's variables, got: ${launched.join(' ')}`);
  assert.deepEqual(kits(launched), [`OBK_TAB_SHELL=${harness.ppid}`, 'OBK_CLI=/x/obk'], 'and the launch line\'s, the shell\'s own pid among them');
  const shell = wordsOf(harness.ppid);
  assert.ok(shell.includes(`ORCA_TAB_ID=${tabId}`), `the tab's shell carries Orca's variables, got: ${shell.join(' ')}`);
  assert.deepEqual(kits(shell), [], 'and none of the kit\'s, which the line gave the harness alone');

  const retab = async (word) => {
    const terminals = await box.orca.terminals();
    await box.orca.set({ terminals: terminals.map((one) => (one.handle === handle ? { ...one, environment: word } : one)) });
  };

  await retab('orca');
  const resumed = wordsOf(harness.pid);
  assert.deepEqual(resumed.slice(0, 2), ['claude', '--resume'], `Orca's own resume, got: ${resumed.join(' ')}`);
  assert.ok(resumed.includes(`ORCA_TAB_ID=${tabId}`), `with Orca's variables, got: ${resumed.join(' ')}`);
  assert.deepEqual(kits(resumed), [], 'and none of the kit\'s');

  await retab('other-tab');
  const elsewhere = wordsOf(harness.pid).filter((word) => word.startsWith('ORCA_TAB_ID='));
  assert.equal(elsewhere.length, 1);
  assert.notEqual(elsewhere[0], `ORCA_TAB_ID=${tabId}`, 'another tab\'s id');
  assert.ok(elsewhere[0].startsWith(`ORCA_TAB_ID=${tabId}`), 'which begins with this one\'s, so only a whole word tells them apart');

  await retab('no-tab-id');
  assert.deepEqual(wordsOf(harness.pid).filter((word) => word.includes('=')), [], 'no variables at all');

  await retab('ps-fails');
  const failed = environment(harness.pid);
  assert.equal(failed.status, 1, 'an environment that cannot be read');
  assert.notEqual(failed.stderr, '');

  for (const argv of [['-E', '-o', 'command=', '-p', String(harness.pid)], ['-E', '-ww', '-o', 'command=', '-p', '-1'], ['-Eww', '-o', 'command=', '-p', String(harness.pid)]]) {
    const refused = spawnSync(box.ps.cli, argv, { env: box.env, encoding: 'utf8' });
    assert.equal(refused.status, 70, `${argv.join(' ')} is not the one environment read the kit may make`);
  }
});

test('the fake ps puts node in front as the kit\'s harness or as the harness\'s child, and gives the kit\'s mark to neither less nor another harness (#261)', async (t) => {
  // The mark is the launch line's `OBK_TAB_SHELL=$$`, set for the harness
  // alone: a harness running as `node` carries it with its parent, the shell;
  // a program the harness started carries it too, with a parent that is not
  // that shell; `less` from the shell carries none. A fake that got this wrong
  // would pass a kit that types into whatever carries the word.
  const box = await createSandbox(t);
  const { handle, ptyId } = oneTab(box);
  answer(ask(box, ['terminal', 'send', '--terminal', handle, '--text', 'OBK_TAB_SHELL=$$ OBK_CLI=/x/obk claude -n a.b', '--enter', '--json']));
  const { tabId } = (await box.orca.terminals()).find((one) => one.handle === handle);
  const panes = answer(ask(box, ['diagnostics', 'memory', '--json'])).result.worktrees.flatMap((worktree) => worktree.sessions);
  const panePid = panes.find((one) => one.sessionId === ptyId).pid;
  const retab = async (changes) => {
    const terminals = await box.orca.terminals();
    await box.orca.set({ terminals: terminals.map((one) => (one.handle === handle ? { ...one, ...changes } : one)) });
  };
  const front = () => {
    const found = psLine(ps(box, psLine(ps(box, panePid)).tpgid));
    const done = spawnSync(box.ps.cli, ['-E', '-ww', '-o', 'command=', '-p', String(found.pid)], { env: box.env, encoding: 'utf8' });
    assert.equal(done.status, 0, done.stderr);
    return { ...found, words: done.stdout.trim().split(' ') };
  };
  const shellPid = psLine(ps(box, panePid)).pid + 1;
  assert.equal(psLine(ps(box, shellPid)).comm, '-/bin/zsh', 'the premise: the tab\'s shell');

  await retab({ foreground: 'node-harness' });
  const harness = front();
  assert.equal(harness.comm, 'node');
  assert.equal(harness.ppid, shellPid, 'the shell started it');
  assert.equal(harness.words[0], 'node', `the command is node's, got: ${harness.words.join(' ')}`);
  assert.deepEqual(harness.words.slice(2, 4), ['-n', 'a.b'], `with the launch line's arguments behind its script, got: ${harness.words.join(' ')}`);
  assert.ok(harness.words.includes(`ORCA_TAB_ID=${tabId}`));
  assert.ok(harness.words.includes(`OBK_TAB_SHELL=${shellPid}`), `the mark, naming its parent, got: ${harness.words.join(' ')}`);

  await retab({ foreground: 'node-harness', environment: 'launched-other-tab' });
  const elsewhere = front();
  assert.ok(elsewhere.words.includes(`OBK_TAB_SHELL=${shellPid}`), 'the mark still names its parent');
  assert.deepEqual(elsewhere.words.filter((word) => word.startsWith('ORCA_TAB_ID=')), [`ORCA_TAB_ID=${tabId}0`], 'and the tab is another, whose id begins with this one\'s');

  await retab({ foreground: 'node-harness', environment: 'orca' });
  assert.deepEqual(front().words.filter((word) => word.startsWith('OBK_')), [], 'Orca resumed it: none of the kit\'s');

  await retab({ foreground: 'node-child', environment: undefined });
  const child = front();
  assert.equal(child.comm, 'node');
  assert.equal(psLine(ps(box, child.ppid)).comm, 'claude', 'the harness started it');
  assert.equal(psLine(ps(box, child.ppid)).ppid, shellPid, 'and the shell started the harness');
  assert.ok(child.words.includes(`OBK_TAB_SHELL=${shellPid}`), `it carries the harness's mark, got: ${child.words.join(' ')}`);
  assert.ok(child.words.includes(`ORCA_TAB_ID=${tabId}`));

  for (const [foreground, comm] of [['program', 'less'], ['other-harness', 'codex']]) {
    await retab({ foreground });
    const other = front();
    assert.equal(other.comm, comm);
    assert.equal(other.ppid, shellPid, `${comm} is the shell's child`);
    assert.ok(other.words.includes(`ORCA_TAB_ID=${tabId}`));
    assert.deepEqual(other.words.filter((word) => word.startsWith('OBK_')), [], `${comm}, typed at the shell, carries none of the kit's`);
  }
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

// What a tab shows (#329). Orca's `tui-idle` answered ok and satisfied, with no
// `blockedReason`, on Codex's update offer, so the screen itself is the only
// place a harness's own question can be seen. A fake that could not show one
// could not test a kit that looks.

test('the fake shows a tab\'s screen as Orca 1.4.212 renders it, an idle one with no question unless told otherwise', async (t) => {
  const box = await createSandbox(t);
  const { handle } = oneTab(box);

  const read = answer(ask(box, ['terminal', 'read', '--terminal', handle, '--screen', '--json']));

  assert.equal(read.ok, true);
  assert.deepEqual(Object.keys(read.result.terminal).sort(), [
    'handle', 'latestCursor', 'limited', 'nextCursor', 'oldestCursor', 'returnedLineCount', 'source', 'status', 'tail', 'truncated',
  ], 'every key the live answer carried, and no other');
  assert.equal(read.result.terminal.handle, handle);
  assert.equal(read.result.terminal.status, 'running');
  assert.equal(read.result.terminal.source, 'screen');
  assert.deepEqual(read.result.terminal.tail, CLAUDE_IDLE, 'a tab nobody gave a screen shows an idle one');
  assert.equal(questionOn(read.result.terminal.tail), undefined, 'and it asks nothing');
  assert.equal(read.result.terminal.returnedLineCount, CLAUDE_IDLE.length);
});

test('the fake shows each harness\'s own idle screen, by the launch line typed into the tab', async (t) => {
  const box = await createSandbox(t);
  const { handle: codex } = oneTab(box);
  const claude = answer(ask(box, ['terminal', 'create', '--worktree', `path:${box.path('bots', 'bots', 'bot-father')}`, '--title', 'Other', '--json'])).result.terminal.handle;
  answer(ask(box, ['terminal', 'send', '--terminal', codex, '--text', 'OBK_TAB_SHELL=$$ codex --approve-for-me', '--enter', '--json']));
  answer(ask(box, ['terminal', 'send', '--terminal', claude, '--text', 'OBK_TAB_SHELL=$$ claude -n a.b', '--enter', '--json']));
  const read = (on) => answer(ask(box, ['terminal', 'read', '--terminal', on, '--screen', '--json'])).result.terminal.tail;

  assert.deepEqual(read(codex), CODEX_IDLE, 'Codex\'s idle input line, with its status rows under it');
  assert.deepEqual(read(claude), CLAUDE_IDLE);
});

test('the fake shows the screen a test gives every tab, or one tab, and nowhere but terminal read', async (t) => {
  const box = await createSandbox(t);
  const { handle } = oneTab(box);
  const other = answer(ask(box, ['terminal', 'create', '--worktree', `path:${box.path('bots', 'bots', 'bot-father')}`, '--title', 'Other', '--json'])).result.terminal.handle;
  const read = (on) => answer(ask(box, ['terminal', 'read', '--terminal', on, '--screen', '--json'])).result.terminal;

  await box.orca.set({ screen: CODEX_UPDATE_OFFER });
  assert.deepEqual(read(handle).tail, CODEX_UPDATE_OFFER, 'the screen every tab shows');
  assert.deepEqual(read(other).tail, CODEX_UPDATE_OFFER);
  assert.equal(read(handle).returnedLineCount, CODEX_UPDATE_OFFER.length, 'trailing rows included');

  await box.orca.set({
    terminals: (await box.orca.terminals()).map((terminal) => (terminal.handle === handle ? { ...terminal, screen: CODEX_NEW_MENU } : terminal)),
  });
  assert.deepEqual(read(handle).tail, CODEX_NEW_MENU, 'a tab\'s own screen wins');
  assert.deepEqual(read(other).tail, CODEX_UPDATE_OFFER, 'and the other tab still shows the one every tab does');

  // Orca reports a tab's screen through `terminal read` alone.
  const listed = answer(ask(box, ['terminal', 'list', '--json'])).result.terminals.find((terminal) => terminal.handle === handle);
  const shown = answer(ask(box, ['terminal', 'show', '--terminal', handle, '--json'])).result.terminal;
  for (const [what, reported] of [['list', listed], ['show', shown]]) {
    assert.equal('screen' in reported, false, `terminal ${what} carries no screen`);
    assert.equal('screenSource' in reported, false, `terminal ${what} carries no screenSource`);
  }
});

test('the fake says when it could not render a screen, and answers from the stream when none was asked for', async (t) => {
  const box = await createSandbox(t);
  const { handle } = oneTab(box);
  const read = (...more) => answer(ask(box, ['terminal', 'read', '--terminal', handle, ...more, '--json'])).result.terminal;

  assert.equal(read().source, 'stream', 'without --screen, accumulated output');

  await box.orca.set({ screenSource: 'screen-unavailable' });
  const unavailable = read('--screen');
  assert.equal(unavailable.source, 'screen-unavailable', 'a screen asked for and none rendered');
  assert.deepEqual(unavailable.tail, CLAUDE_IDLE, 'with rows all the same, which a kit that ignored source would believe');

  await box.orca.set({
    screenSource: 'screen',
    terminals: (await box.orca.terminals()).map((terminal) => ({ ...terminal, screenSource: 'screen-unavailable' })),
  });
  assert.equal(read('--screen').source, 'screen-unavailable', 'a tab\'s own source wins');
});

test('the fake answers a watched send with Orca\'s receipt: a turn start by default, or none and Orca\'s warning', async (t) => {
  // The two answers Orca 1.4.214 gave live to `--text --enter --wait-submit`
  // (#394): an idle harness's line started a turn; a busy one's did not, and
  // Orca said so in a warning naming the request id.
  const box = await createSandbox(t);
  const { handle } = oneTab(box);
  const other = answer(ask(box, ['terminal', 'create', '--worktree', `path:${box.path('bots', 'bots', 'bot-father')}`, '--title', 'Other', '--json'])).result.terminal.handle;
  answer(ask(box, ['terminal', 'send', '--terminal', handle, '--text', 'OBK_TAB_SHELL=$$ codex --approve-for-me', '--enter', '--json']));
  const watched = (on) => answer(ask(box, ['terminal', 'send', '--terminal', on, '--text', 'mail', '--enter', '--wait-submit', '5', '--json']));

  const seen = watched(handle);
  assert.equal(seen.ok, true);
  assert.equal(seen.result.send.handle, handle);
  assert.equal(seen.result.send.accepted, true);
  assert.deepEqual(seen.result.send.prompt.stages, ['input_accepted', 'turn_started'], 'a turn start, unless told otherwise');
  assert.equal(seen.result.send.prompt.provider, 'codex', 'the harness the launch line started');
  assert.equal(seen.result.mutation.requestId, seen.result.send.prompt.requestId);
  assert.equal('warnings' in seen.result, false, 'and nothing to warn about');

  await box.orca.set({
    terminals: (await box.orca.terminals()).map((terminal) => (terminal.handle === handle ? { ...terminal, submit: 'unseen' } : terminal)),
  });
  const unseen = watched(handle);
  assert.deepEqual(unseen.result.send.prompt.stages, ['input_accepted'], 'no turn start in the tab told so');
  assert.equal(unseen.result.warnings.length, 1);
  assert.match(unseen.result.warnings[0], /^input was accepted but no turn start was observed, so the Enter may have been swallowed\./);
  assert.ok(
    unseen.result.warnings[0].includes(`--retry-request ${unseen.result.send.prompt.requestId} --wait-submit <seconds>`),
    `Orca names the request id to confirm it with, got: ${unseen.result.warnings[0]}`,
  );
  assert.deepEqual(watched(other).result.send.prompt.stages, ['input_accepted', 'turn_started'], 'and the other tab as before');

  await box.orca.set({ submit: 'unseen' });
  assert.deepEqual(watched(other).result.send.prompt.stages, ['input_accepted'], 'every tab, when set for all');

  // A send nobody asked Orca to watch: accepted, and nothing seen after that.
  const blind = answer(ask(box, ['terminal', 'send', '--terminal', other, '--text', 'mail', '--enter', '--json']));
  await box.orca.set({ submit: 'turn-started' });
  const blindSeen = answer(ask(box, ['terminal', 'send', '--terminal', other, '--text', 'mail', '--enter', '--json']));
  assert.deepEqual(blind.result.send.prompt.stages, ['input_accepted']);
  assert.deepEqual(blindSeen.result.send.prompt.stages, ['input_accepted'], 'not even where a watched line would start a turn');

  // Each send is typed and written down with what it asked Orca for; Orca
  // never lists what a test set.
  const typed = (await box.orca.terminals()).find((terminal) => terminal.handle === handle).typed;
  assert.deepEqual(typed.slice(1), [
    { text: 'mail', enter: true, waitSubmit: '5' },
    { text: 'mail', enter: true, waitSubmit: '5' },
  ]);
  const listed = answer(ask(box, ['terminal', 'list', '--json'])).result.terminals.find((terminal) => terminal.handle === handle);
  const shown = answer(ask(box, ['terminal', 'show', '--terminal', handle, '--json'])).result.terminal;
  assert.equal('submit' in listed, false, 'terminal list carries no submit');
  assert.equal('submit' in shown, false, 'terminal show carries no submit');
});

test('the fake answers a watched line into a busy harness as live Orca does: no turn start, and Orca\'s warning, unless a test says otherwise', async (t) => {
  // Seen live (#402; Orca 1.4.214, Claude Code 2.1.283, Codex 0.157.1): a line
  // typed into a harness busy mid-turn is queued, and Orca's receipt, even
  // after a 60 s wait, is input_accepted alone with its warning. Only an idle
  // harness's receipt shows turn_started.
  const box = await createSandbox(t);
  const { handle } = oneTab(box);
  answer(ask(box, ['terminal', 'send', '--terminal', handle, '--text', 'OBK_TAB_SHELL=$$ codex --approve-for-me', '--enter', '--json']));
  const watched = () => answer(ask(box, ['terminal', 'send', '--terminal', handle, '--text', 'mail', '--enter', '--wait-submit', '5', '--json']));

  await box.orca.set({ waitIdle: true });
  const idle = watched();
  assert.deepEqual(idle.result.send.prompt.stages, ['input_accepted', 'turn_started'], 'an idle harness starts a turn');
  assert.equal('warnings' in idle.result, false, 'and there is nothing to warn about');

  await box.orca.set({ waitIdle: 'busy' });
  const busy = watched();
  assert.deepEqual(busy.result.send.prompt.stages, ['input_accepted'], 'a busy harness shows no turn start');
  assert.equal(busy.result.send.prompt.observation, 'supported', 'Orca watched it');
  assert.equal(busy.result.warnings.length, 1);
  assert.match(busy.result.warnings[0], /^input was accepted but no turn start was observed, so the Enter may have been swallowed\./);
  assert.ok(
    busy.result.warnings[0].includes(`--retry-request ${busy.result.send.prompt.requestId} --wait-submit <seconds>`),
    `Orca names the request id to confirm it with, got: ${busy.result.warnings[0]}`,
  );

  // A `submit` a test sets still wins, for one tab or for all.
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((terminal) => (terminal.handle === handle ? { ...terminal, submit: 'turn-started' } : terminal)),
  });
  assert.deepEqual(watched().result.send.prompt.stages, ['input_accepted', 'turn_started'], 'a tab told turn-started, busy or not');
  await box.orca.set({
    terminals: (await box.orca.terminals()).map(({ submit: _submit, ...terminal }) => terminal),
    submit: 'turn-started',
  });
  assert.deepEqual(watched().result.send.prompt.stages, ['input_accepted', 'turn_started'], 'every tab told turn-started, busy or not');
  await box.orca.set({ submit: 'unsupported' });
  assert.equal(watched().result.send.prompt.observation, 'unsupported', 'and any other word a test sets');
});

test('the fake answers a line Orca did not watch with the receipt Orca builds itself, and Orca\'s words', async (t) => {
  // Seen live (#394): a Claude tab where the kit's line raced Orca's own
  // notice, and an Orca host too old to keep receipts. Orca watched nothing,
  // with or without --wait-submit.
  const box = await createSandbox(t);
  const { handle } = oneTab(box);
  for (const [submit, provider, warning] of [
    ['unsupported', 'unsupported', 'input was accepted, but this provider cannot report delivery. Inspect the terminal before retrying.'],
    ['old-host', 'old-host', 'this host predates durable prompt receipts. Update Orca on the execution host, and inspect the terminal before retrying an ambiguous send.'],
  ]) {
    await box.orca.set({ submit });
    for (const watch of [['--wait-submit', '5'], []]) {
      const sent = answer(ask(box, ['terminal', 'send', '--terminal', handle, '--text', 'mail', '--enter', ...watch, '--json']));
      const { prompt } = sent.result.send;
      assert.equal(sent.result.send.accepted, true);
      assert.deepEqual(prompt.stages, ['input_accepted'], `${submit}: no turn start`);
      assert.equal(prompt.provider, provider);
      assert.equal(prompt.observation, 'unsupported', `${submit}: Orca did not watch`);
      assert.equal(prompt.baselineWorkingSequence, 0);
      assert.deepEqual(sent.result.warnings, [warning], `${submit}: in Orca's words`);
    }
  }
});

test('the fake writes down a re-issued send by the request id it carries', async (t) => {
  const box = await createSandbox(t);
  const { handle } = oneTab(box);

  const again = answer(ask(box, ['terminal', 'send', '--terminal', handle, '--text', 'mail', '--enter', '--retry-request', 'req-1', '--wait-submit', '5', '--json']));

  assert.equal(again.result.send.prompt.requestId, 'req-1', 'the same request, as Orca keeps it');
  assert.deepEqual((await box.orca.terminals())[0].typed, [{ text: 'mail', enter: true, waitSubmit: '5', retryRequest: 'req-1' }]);
});

test('the fake refuses to read a tab it does not have, and can be told to refuse any read', async (t) => {
  const box = await createSandbox(t);
  const { handle } = oneTab(box);

  const nowhere = ask(box, ['terminal', 'read', '--terminal', 'term_gone', '--screen', '--json']);
  assert.equal(nowhere.status, 1);
  assert.equal(JSON.parse(nowhere.stdout).error.code, 'terminal_not_found');

  await box.orca.set({ fail: { 'terminal read': { code: 'runtime_error', message: 'the renderer did not answer' } } });
  const refused = ask(box, ['terminal', 'read', '--terminal', handle, '--screen', '--json']);
  assert.equal(refused.status, 1);
  assert.deepEqual(
    [JSON.parse(refused.stdout).ok, JSON.parse(refused.stdout).error.message],
    [false, 'the renderer did not answer'],
  );
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

test('a screen the fake puts up at a send can draw late: it answers that many reads, then moves on by itself (#391)', async (t) => {
  const box = await createSandbox(t);
  await twoTabs(box);
  const early = ['❯ /clear'];
  const late = ['  /clear  Start a new session', '❯ /clear'];
  const next = ['❯'];
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((terminal) => (terminal.handle === 'term_a'
      ? { ...terminal, nextScreens: [{ screen: early, then: late, reads: 2 }, next] }
      : terminal)),
  });
  const read = (on) => answer(ask(box, ['terminal', 'read', '--terminal', on, '--screen', '--json'])).result.terminal.tail;

  answer(ask(box, ['terminal', 'send', '--terminal', 'term_a', '--text', 'r', '--json']));
  const listed = answer(ask(box, ['terminal', 'list', '--json'])).result.terminals.find((one) => one.handle === 'term_a');
  assert.equal('thenScreen' in listed || 'readsBeforeThen' in listed, false, 'Orca never lists the screen to come');
  assert.deepEqual(read('term_b'), CLAUDE_IDLE, 'a read of another tab uses none of its reads');
  assert.deepEqual([read('term_a'), read('term_a')], [early, early], 'the first two reads find the screen as it was put up');
  assert.deepEqual([read('term_a'), read('term_a')], [late, late], 'every read after them finds it drawn');
  answer(ask(box, ['terminal', 'send', '--terminal', 'term_a', '--text', '\r', '--json']));
  assert.deepEqual(read('term_a'), next, 'and a send moves it on as ever');
});

test('a screen the fake puts up at a send can carry what tui-idle finds in that tab, until a screen that says nothing takes it away (#391)', async (t) => {
  // An open slash popup that stops Orca's tui-idle answering ok, worked out
  // on live run 3 of #391: the screen and the answer move on together.
  const box = await createSandbox(t);
  await twoTabs(box);
  const popup = ['› /new  start a new chat during a conversation', '', '› /'];
  const closed = ['› Ask Codex to do anything'];
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((terminal) => (terminal.handle === 'term_a'
      ? { ...terminal, nextScreens: [{ screen: popup, tuiIdle: 'busy' }, { screen: closed }] }
      : terminal)),
  });
  const wait = (on) => JSON.parse(ask(box, ['terminal', 'wait', '--terminal', on, '--for', 'tui-idle', '--json']).stdout);
  const read = (on) => answer(ask(box, ['terminal', 'read', '--terminal', on, '--screen', '--json'])).result.terminal.tail;

  assert.equal(wait('term_a').ok, true, 'idle before any key');
  answer(ask(box, ['terminal', 'send', '--terminal', 'term_a', '--text', '/', '--json']));
  assert.deepEqual(read('term_a'), popup, 'the first key puts up the popup');
  assert.equal(wait('term_a').error?.code, 'timeout', 'and tui-idle no longer answers ok there');
  assert.equal(wait('term_b').ok, true, 'while the other tab answers as ever');
  answer(ask(box, ['terminal', 'send', '--terminal', 'term_a', '--text', '\x7f', '--json']));
  assert.deepEqual(read('term_a'), closed, 'the next key closes it');
  assert.equal(wait('term_a').ok, true, 'and tui-idle answers ok again');
  const listed = answer(ask(box, ['terminal', 'list', '--json'])).result.terminals.find((one) => one.handle === 'term_a');
  assert.equal('tuiIdle' in listed, false, 'Orca never lists it');
});

test('a tab\'s input line text is read as its draft beside the screen, put up and taken away with the screens a send moves on to, and listed nowhere (#510)', async (t) => {
  // Orca 1.4.223 answers Claude Code 2.1.296's input line text as `draft`,
  // and leaves the key out when the line is empty (seen live, #510).
  const box = await createSandbox(t);
  await twoTabs(box);
  const bare = ['─'.repeat(20), '❯', '─'.repeat(20)];
  const menu = ['  ❯ /compact  Free up context', ...bare];
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((terminal) => (terminal.handle === 'term_a'
      ? { ...terminal, screen: bare, draft: 'hello', nextScreens: [{ screen: menu, draft: '/compact' }, bare, { screen: menu, draft: '/c' }, { screen: bare }] }
      : terminal)),
  });
  const read = (on, more = ['--screen']) => answer(ask(box, ['terminal', 'read', '--terminal', on, ...more, '--json'])).result.terminal;
  const send = (text) => answer(ask(box, ['terminal', 'send', '--terminal', 'term_a', '--text', text, '--json']));

  assert.deepEqual([read('term_a').tail, read('term_a').draft], [bare, 'hello'], 'the tab\'s own draft, beside its rows');
  assert.equal(read('term_a', []).draft, 'hello', 'a read of the stream gives it too');
  assert.equal('draft' in read('term_b'), false, 'a tab with nothing in its line has no draft key');
  const listed = answer(ask(box, ['terminal', 'list', '--json'])).result.terminals.find((one) => one.handle === 'term_a');
  const showed = answer(ask(box, ['terminal', 'show', '--terminal', 'term_a', '--json'])).result.terminal;
  for (const [what, entry] of [['list', listed], ['show', showed]]) {
    assert.equal('draft' in entry, false, `Orca shows a draft only through read, not in ${what}`);
  }
  send('/');
  assert.deepEqual([read('term_a').tail, read('term_a').draft], [menu, '/compact'], 'a screen with a draft puts up both');
  send('c');
  assert.deepEqual(read('term_a').tail, bare, 'rows alone are the next screen');
  assert.equal('draft' in read('term_a'), false, 'and take the draft away');
  send('o');
  assert.equal(read('term_a').draft, '/c', 'an entry\'s draft is the draft from then on');
  send('m');
  assert.equal('draft' in read('term_a'), false, 'and an entry with none takes it away');
});

test('the fake can be slow to answer one command only once another has been called, counting from when it was told (#391)', async (t) => {
  // A screen that reads at once until a key is sent, and hangs after.
  const box = await createSandbox(t);
  await twoTabs(box);
  answer(ask(box, ['terminal', 'send', '--terminal', 'term_a', '--text', 'before', '--json']));
  await box.orca.set({ hang: { command: 'terminal read', ms: 5000, since: 'terminal send', sinceFrom: 1 } });
  const timedRead = () => {
    const started = Date.now();
    const read = answer(ask(box, ['terminal', 'read', '--terminal', 'term_a', '--screen', '--json']));
    return { took: Date.now() - started, read };
  };

  const quick = timedRead();
  assert.ok(quick.took < 5000, `a send made before the hang was set does not count, took ${quick.took} ms`);
  answer(ask(box, ['terminal', 'send', '--terminal', 'term_a', '--text', 'after', '--json']));
  const slow = timedRead();
  assert.ok(slow.took >= 5000, `once a send is made, the read waits, took ${slow.took} ms`);
  assert.equal(slow.read.ok, true, 'and then answers as ever');
  const status = Date.now();
  answer(ask(box, ['status', '--json']));
  assert.ok(Date.now() - status < 5000, 'and another command is not held');
});

test('the fake can hold back one answer of a command among prompt ones: the nth, counting from when it was told (#391)', async (t) => {
  const box = await createSandbox(t);
  await twoTabs(box);
  answer(ask(box, ['terminal', 'read', '--terminal', 'term_a', '--screen', '--json']));
  await box.orca.set({ hang: { command: 'terminal read', ms: 5000, after: 1, times: 1, from: 1 } });
  const took = () => {
    const started = Date.now();
    assert.equal(answer(ask(box, ['terminal', 'read', '--terminal', 'term_a', '--screen', '--json'])).ok, true);
    return Date.now() - started;
  };

  const [first, second, third] = [took(), took(), took()];
  assert.ok(first < 5000, `the first read since it was told is not held, took ${first} ms`);
  assert.ok(second >= 5000, `the second is, took ${second} ms`);
  assert.ok(third < 5000, `and the third is not, took ${third} ms`);
});

test('the fake can do what a command asks and then hold its answer back', async (t) => {
  // The case a caller that gives up on Orca cannot see into: the Run is made,
  // and nobody is told so.
  const box = await createSandbox(t);
  await twoTabs(box);
  await box.orca.set({ hang: { command: 'orchestration run-create', ms: 10_000, applied: true } });

  const cut = spawnSync(box.orca.cli, ['orchestration', 'run-create', '--objective', 'quiet', '--json'], {
    cwd: box.cwd,
    env: { ...box.env, ORCA_TERMINAL_HANDLE: 'term_a' },
    encoding: 'utf8',
    timeout: 1000,
  });

  assert.equal(cut.error?.code, 'ETIMEDOUT', 'the caller gave up waiting');
  assert.equal(cut.stdout, '', 'with no answer');
  assert.deepEqual(
    (await box.orca.runs()).map((run) => [run.objective, run.coordinator_handle]),
    [['quiet', 'term_a']],
    'and the Run was made, and bound, all the same',
  );
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

test('the fake writes down when each call reached it, in the same order, apart from the calls themselves (#391)', async (t) => {
  const box = await createSandbox(t);

  const before = Date.now();
  ask(box, ['status', '--json']);
  await new Promise((resolve) => { setTimeout(resolve, 300); });
  ask(box, ['project', 'setups', '--json']);
  const after = Date.now();

  const clock = await box.orca.clock();
  assert.deepEqual(clock.map((one) => one.args), (await box.orca.calls()).map((one) => one.args), 'one entry per call, in the order of the calls');
  assert.ok(clock[0].at >= before && clock[1].at <= after, `each time is when the call was made: ${JSON.stringify(clock)}`);
  assert.ok(clock[1].at - clock[0].at >= 300, `and the two are as far apart as the calls were: ${JSON.stringify(clock)}`);
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

test('#508: a Run the fake does not have, and a legacy one, are refused by run-use in one set of Orca 1.4.223\'s words, and only run-show tells them apart', async (t) => {
  // Read in Orca 1.4.223's bundle (out/main/index.js), not seen live: run-show
  // refuses a Run that is not in Orca's database and answers a legacy one;
  // run-use refuses both with the same code and the same words. The kit's step
  // has only run-show to tell a Run gone with the old machine from one that is
  // still there, so a fake that bound the legacy Run, or said "not found" the
  // same way for both commands, would let a kit through that the real Orca
  // stops.
  const box = await createSandbox(t);
  const { inA } = await twoTabs(box);
  const legacy = { id: 'run_legacy', objective: 'old', coordinator_handle: null, consumer_generation: 0, legacy: 1, created_at: 'x', updated_at: 'x' };
  await box.orca.set({ runs: [legacy] });

  const gone = inA(['orchestration', 'run-show', '--id', 'run_gone']);
  assert.equal(gone.ok, false);
  assert.equal(gone.error.code, 'run_not_found');
  assert.equal(gone.error.message, 'Run run_gone was not found.');

  const shownLegacy = inA(['orchestration', 'run-show', '--id', 'run_legacy']);
  assert.equal(shownLegacy.ok, true, `run-show answers a legacy Run, got: ${JSON.stringify(shownLegacy)}`);
  assert.equal(shownLegacy.result.run.legacy, 1, 'with its legacy field as it is');

  for (const id of ['run_gone', 'run_legacy']) {
    const used = inA(['orchestration', 'run-use', '--id', id]);
    assert.equal(used.ok, false, `run-use refuses ${id}, got: ${JSON.stringify(used)}`);
    assert.equal(used.error.code, 'run_not_found');
    assert.match(used.error.message, new RegExp(`^Run ${id} was not found or is inspect-only\\. Orchestration mutation request ID: [0-9a-f-]{36}\\.$`));
  }
  assert.deepEqual(await box.orca.runs(), [legacy], 'nothing was made, and the legacy Run was bound to nobody');
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

test('the fake can refuse one tab\'s close with --tab, keep listing it, and close it without --tab', async (t) => {
  // Seen live on 1.4.214 after a machine restart (#405): `terminal close
  // --terminal <h> --tab` refused `tab_not_found` for a tab `terminal list`
  // still listed, and the same close without `--tab` worked.
  const box = await createSandbox(t);
  const home = box.path('bots', 'bots', 'bot-father');
  answer(ask(box, ['repo', 'add', '--path', home, '--json']));
  const setup = (await box.orca.setups())[0];
  answer(ask(box, ['project', 'setup-update', '--setup', setup.id, '--kind', 'folder', '--json']));
  const create = () => answer(ask(box, ['terminal', 'create', '--worktree', `path:${home}`, '--title', 'Daily', '--json'])).result.terminal;
  const stuck = create();
  const other = create();
  const list = () => answer(ask(box, ['terminal', 'list', '--worktree', `path:${home}`, '--json'])).result.terminals;
  const close = (handle, ...rest) => ask(box, ['terminal', 'close', '--terminal', handle, ...rest, '--json']);

  await box.orca.set({
    terminals: (await box.orca.terminals()).map((one) => (one.handle === stuck.handle
      ? { ...one, refuseClose: { tab: { code: 'runtime_error', message: 'tab_not_found' } } }
      : one)),
  });

  const refused = close(stuck.handle, '--tab');
  assert.equal(refused.status, 1);
  assert.deepEqual(
    [JSON.parse(refused.stdout).ok, JSON.parse(refused.stdout).error.code, JSON.parse(refused.stdout).error.message],
    [false, 'runtime_error', 'tab_not_found'],
    'the close with --tab is refused in the words the test gave',
  );
  const listed = list();
  assert.deepEqual(listed.map((one) => one.handle), [stuck.handle, other.handle], 'and the tab is still listed');
  assert.equal(listed[0].tabId, stuck.tabId, 'by its own tab id');
  assert.equal('refuseClose' in listed[0], false, 'Orca never lists what the test told it');

  assert.equal(JSON.parse(close(other.handle, '--tab').stdout).ok, true, 'another tab closes with --tab as ever');
  const plain = JSON.parse(close(stuck.handle).stdout);
  assert.equal(plain.ok, true, 'the close without --tab goes through');
  assert.equal(plain.result.close.handle, stuck.handle);
  assert.deepEqual(list(), [], 'and the tab is gone');

  // Both forms refused: nothing closes.
  const again = create();
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((one) => ({
      ...one,
      refuseClose: { tab: { code: 'tab_not_found', message: 'no such tab' }, pane: { code: 'runtime_error', message: 'the pane will not close' } },
    })),
  });
  assert.equal(JSON.parse(close(again.handle, '--tab').stdout).error.code, 'tab_not_found');
  assert.equal(JSON.parse(close(again.handle).stdout).error.message, 'the pane will not close');
  assert.deepEqual(list().map((one) => one.handle), [again.handle], 'a tab whose closes were both refused is still there');
});

test('the fake can move one tab\'s screen on at the next key sent into it, and at no other send', async (t) => {
  // A question on screen that goes once a key answers it (#238's trust-hooks):
  // the kit reads the screen again after sending, and has to see it change.
  const box = await createSandbox(t);
  await twoTabs(box);
  const before = ['  a question', '› 1. yes'];
  const moved = ['  the answer was taken'];
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((terminal) => (terminal.handle === 'term_a' ? { ...terminal, screen: before, screenAfterSend: moved } : terminal)),
  });
  const read = (on) => answer(ask(box, ['terminal', 'read', '--terminal', on, '--screen', '--json'])).result.terminal.tail;

  assert.deepEqual(read('term_a'), before, 'until a key is sent, the screen it has');
  answer(ask(box, ['terminal', 'send', '--terminal', 'term_b', '--text', 'x', '--json']));
  assert.deepEqual(read('term_a'), before, 'a key sent into another tab moves nothing here');
  answer(ask(box, ['terminal', 'send', '--terminal', 'term_a', '--text', '\r', '--json']));
  assert.deepEqual(read('term_a'), moved, 'the next key sent into it moves it on');
  answer(ask(box, ['terminal', 'send', '--terminal', 'term_a', '--text', 'y', '--json']));
  assert.deepEqual(read('term_a'), moved, 'and it stays there');

  const listed = answer(ask(box, ['terminal', 'list', '--json'])).result.terminals.find((one) => one.handle === 'term_a');
  const showed = answer(ask(box, ['terminal', 'show', '--terminal', 'term_a', '--json'])).result.terminal;
  for (const [what, entry] of [['list', listed], ['show', showed]]) {
    assert.equal('screenAfterSend' in entry, false, `Orca shows a screen only through read, not in ${what}`);
  }
});

test('the fake can move one tab\'s screen on at each of the next keys sent into it, in order, and then no more (#391)', async (t) => {
  // A command typed, checked on screen, entered and its menu answered: the
  // screen moves on at every send, and the kit reads it between them.
  const box = await createSandbox(t);
  await twoTabs(box);
  const before = ['› Ask Codex to do anything'];
  const typed = ['› /new', '  /new  start a new chat'];
  const menu = ['  Where should the new conversation run?', '› 1. Current checkout', '  2. New worktree'];
  const fresh = ['› Ask Codex to do anything', '  a new conversation'];
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((terminal) => (terminal.handle === 'term_a' ? { ...terminal, screen: before, nextScreens: [typed, menu, fresh] } : terminal)),
  });
  const read = (on) => answer(ask(box, ['terminal', 'read', '--terminal', on, '--screen', '--json'])).result.terminal.tail;

  assert.deepEqual(read('term_a'), before, 'until a key is sent, the screen it has');
  answer(ask(box, ['terminal', 'send', '--terminal', 'term_b', '--text', 'x', '--json']));
  assert.deepEqual(read('term_a'), before, 'a key sent into another tab moves nothing here');
  answer(ask(box, ['terminal', 'send', '--terminal', 'term_a', '--text', '/new', '--json']));
  assert.deepEqual(read('term_a'), typed, 'the first key sent into it puts up the first screen');
  assert.deepEqual(read('term_a'), typed, 'and a second read without a send shows the same');
  answer(ask(box, ['terminal', 'send', '--terminal', 'term_a', '--text', '\r', '--json']));
  assert.deepEqual(read('term_a'), menu, 'the second key, the second screen');
  answer(ask(box, ['terminal', 'send', '--terminal', 'term_a', '--text', '\r', '--json']));
  assert.deepEqual(read('term_a'), fresh, 'the third key, the third');
  answer(ask(box, ['terminal', 'send', '--terminal', 'term_a', '--text', 'y', '--json']));
  assert.deepEqual(read('term_a'), fresh, 'and once the list has run out, it stays there');
  assert.deepEqual(read('term_b'), CLAUDE_IDLE, 'the other tab kept its own screen throughout');

  const listed = answer(ask(box, ['terminal', 'list', '--json'])).result.terminals.find((one) => one.handle === 'term_a');
  const showed = answer(ask(box, ['terminal', 'show', '--terminal', 'term_a', '--json'])).result.terminal;
  for (const [what, entry] of [['list', listed], ['show', showed]]) {
    assert.equal('nextScreens' in entry, false, `Orca shows a screen only through read, not in ${what}`);
  }
});

// ---------------------------------------------------------------------------
// Many callers at once (#438)
// ---------------------------------------------------------------------------

/** Call the fake Orca without waiting for it, as a second `up` does: `{ code, stdout, stderr }`. */
function askAtOnce(box, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(box.orca.cli, args, { cwd: box.cwd, env: box.env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('#438 twenty callers that save at once each read the world whole and answer JSON', async (t) => {
  // Every call reads state.json whole when it starts, and one that changes the
  // world writes it back. Two `up`s at once make such calls side by side, and a
  // call that read the file while another was part way through writing it got
  // half of it, could not parse it, and answered nothing (#438). A world of a
  // few thousand projects makes each write long enough to be caught in.
  const box = await createSandbox(t);
  await box.orca.set({
    setups: Array.from({ length: 3000 }, (_, n) => ({
      id: `repo_seed_${n}`, projectId: `proj_seed_${n}`, hostId: 'host_local', repoId: `repo_seed_${n}`,
      path: `/seed/project-${n}`, displayName: `project-${n}`, kind: 'folder', setupState: 'ready', setupMethod: 'repo-add',
    })),
    nextId: 5000,
  });

  const answers = await Promise.all(Array.from({ length: 20 }, (_, n) => askAtOnce(box, ['repo', 'add', '--path', `/new/project-${n}`, '--json'])));

  const broken = answers.flatMap((done, n) => {
    try {
      if (JSON.parse(done.stdout).ok === true) return [];
    } catch {
      // Not JSON: said below.
    }
    return [`caller ${n}: exit ${done.code}, stdout ${JSON.stringify(done.stdout.slice(0, 200))}, stderr ${JSON.stringify(done.stderr.slice(0, 300))}`];
  });
  assert.deepEqual(broken, [], 'every caller answered JSON, having read the world whole');
});

test('the fake plays a receiver\'s turn after its mail: at the chosen look its tab goes busy and its record gains the turn, once (#509)', async (t) => {
  const box = await createSandbox(t);
  const { inA, outside } = await twoTabs(box);
  const toA = inA(['orchestration', 'run-create', '--objective', 'a']).result.run.id;
  const claude = path.join(box.home, 'claude.jsonl');
  const codex = path.join(box.home, 'codex.jsonl');
  writeFileSync(claude, '{"type":"system"}\n');
  writeFileSync(codex, '{"type":"session_meta"}\n');
  const terminals = await box.orca.terminals();
  await box.orca.set({
    terminals: terminals.map((one) => (one.handle === 'term_a'
      ? { ...one, afterMail: { waits: 2, busy: true, record: { file: claude, harness: 'claude' } } }
      : { ...one, afterMail: { waits: 1, busy: false, text: 'Other work.', record: { file: codex, harness: 'codex' } } })),
  });
  const wait = (handle) => outside(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '100']);

  assert.equal(wait('term_a').ok, true, 'before any mail, nothing happens');
  outside(['orchestration', 'send', '--to', `run:${toA}`, '--subject', 'hello']);
  assert.equal(wait('term_a').ok, true, 'the first look after the mail finds the tab as it was');
  assert.equal(readFileSync(claude, 'utf8').split('\n').filter(Boolean).length, 1, 'and its record as it was');
  assert.equal(wait('term_a').error?.code, 'timeout', 'the second finds a turn under way');
  assert.equal(wait('term_a').error?.code, 'timeout', 'and so does every one after it');
  const lines = readFileSync(claude, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(lines.length, 2, `one turn written, once: ${JSON.stringify(lines)}`);
  assert.equal(lines[1].type, 'user');
  assert.equal(lines[1].message.content, `You have 1 orchestration message. Run \`orca orchestration check --run ${toA}\``, 'Orca\'s notice, as it typed it into the tab');
  assert.ok(Date.now() - Date.parse(lines[1].timestamp) < 60_000, `stamped when written: ${lines[1].timestamp}`);

  // term_b coordinates no Run that got mail, so it is never armed.
  assert.equal(wait('term_b').ok, true);
  assert.equal(readFileSync(codex, 'utf8').split('\n').filter(Boolean).length, 1, 'no mail to term_b, so nothing in its record');
  assert.equal(JSON.stringify(answer(ask(box, ['terminal', 'list', '--json'])).result.terminals).includes('afterMail'), false, 'Orca never lists it');
});

test('the fake writes a Codex receiver\'s turn in a rollout\'s own shape, and writes nothing where a folder stands in the record\'s place (#509)', async (t) => {
  const box = await createSandbox(t);
  const { inA, outside } = await twoTabs(box);
  const toA = inA(['orchestration', 'run-create', '--objective', 'a']).result.run.id;
  const codex = path.join(box.home, 'codex.jsonl');
  writeFileSync(codex, '{"type":"session_meta"}\n');
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((one) => (one.handle === 'term_a'
      ? { ...one, afterMail: { waits: 1, text: 'Other work.', record: { file: codex, harness: 'codex' } } }
      : one)),
  });

  outside(['orchestration', 'send', '--to', `run:${toA}`, '--subject', 'hello']);
  const look = outside(['terminal', 'wait', '--terminal', 'term_a', '--for', 'tui-idle', '--timeout-ms', '100']);

  assert.equal(look.ok, true, 'busy left out: the tab answers as before');
  const [, turn] = readFileSync(codex, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.deepEqual(turn.payload, { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Other work.' }] });
  assert.equal(turn.type, 'response_item');

  const folder = path.join(box.home, 'a-folder.jsonl');
  mkdirSync(folder);
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((one) => (one.handle === 'term_a'
      ? { ...one, afterMail: { waits: 1, busy: true, record: { file: folder, harness: 'claude' } } }
      : one)),
  });
  outside(['orchestration', 'send', '--to', `run:${toA}`, '--subject', 'again']);
  const busy = outside(['terminal', 'wait', '--terminal', 'term_a', '--for', 'tui-idle', '--timeout-ms', '100']);
  assert.equal(busy.error?.code, 'timeout', 'the turn still starts');
  assert.ok(statSync(folder).isDirectory(), 'and the folder is left as it was');
});

test('the fake ends a receiver\'s turn after busyFor more looks: busy, then idle again (#509)', async (t) => {
  const box = await createSandbox(t);
  const { inA, outside } = await twoTabs(box);
  const toA = inA(['orchestration', 'run-create', '--objective', 'a']).result.run.id;
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((one) => (one.handle === 'term_a' ? { ...one, afterMail: { waits: 2, busy: true, busyFor: 1, text: null } } : one)),
  });
  const look = () => outside(['terminal', 'wait', '--terminal', 'term_a', '--for', 'tui-idle', '--timeout-ms', '100']);

  outside(['orchestration', 'send', '--to', `run:${toA}`, '--subject', 'hello']);
  const answers = [look(), look(), look(), look(), look()].map((one) => (one.ok ? 'idle' : one.error?.code));

  assert.deepEqual(answers, ['idle', 'timeout', 'timeout', 'idle', 'idle'], 'as before, the turn at the second look, one more busy look, then idle for good');
});

// #528: the two Orcas `project setup-delete` meets. Both are read in Orca's
// code, not seen live: the guard in its next release (commit cb69d52455,
// stablyai/orca#27172, in no tag yet), and the flag check of 1.4.223's CLI.

/** A fake Orca with one project at `home`, a folder one, as the kit leaves it. */
function oneProject(box, name) {
  const home = box.path('bots', 'bots', name);
  answer(ask(box, ['repo', 'add', '--path', home, '--json']));
  const setup = answer(ask(box, ['project', 'setups', '--json'])).result.setups.find((one) => one.path === home);
  answer(ask(box, ['project', 'setup-update', '--setup', setup.id, '--kind', 'folder', '--json']));
  return { home, setup };
}

const GUARD_TAIL = 'Removing it detaches those terminals from Orca and deletes the saved workspace details. Re-run with --force to remove it anyway.';

test('#528 the fake guards setup-delete as Orca\'s next release does: a plain delete refused in Orca\'s words and changing nothing, a forced one carried out', async (t) => {
  const box = await createSandbox(t);
  const saved = oneProject(box, 'saved-bot');
  const open = oneProject(box, 'open-bot');
  const bare = oneProject(box, 'bare-bot');
  const forced = oneProject(box, 'forced-bot');
  answer(ask(box, ['terminal', 'create', '--worktree', `path:${open.home}`, '--title', 'Daily', '--json']));
  answer(ask(box, ['terminal', 'create', '--worktree', `path:${open.home}`, '--title', 'Review', '--json']));
  const del = (setup, ...rest) => ask(box, ['project', 'setup-delete', '--setup', setup.id, ...rest, '--json']);
  const listed = async () => (await box.orca.setups()).map((one) => one.id);

  await box.orca.set({ deleteGuard: {} });
  const before = await box.orca.state();
  const refused = del(saved.setup);
  assert.equal(refused.status, 1);
  assert.deepEqual(JSON.parse(refused.stdout).error, {
    code: 'runtime_error',
    message: `This project has saved details for 1 workspace. ${GUARD_TAIL}`,
    data: {},
  }, 'a project with a workspace has saved details for it, unless the test says otherwise');
  assert.deepEqual(await box.orca.state(), before, 'a refused delete changes nothing');

  await box.orca.set({ deleteGuard: { workspaces: 2, terminals: 1 } });
  assert.equal(
    JSON.parse(del(open.setup).stdout).error.message,
    `This project has 3 terminals still open and saved details for 2 workspaces. ${GUARD_TAIL}`,
    'the two tabs in the fake\'s world at its path, and one more Orca counts open',
  );
  await box.orca.set({ deleteGuard: { workspaces: 0, terminals: 1 } });
  assert.equal(
    JSON.parse(del(saved.setup).stdout).error.message,
    `This project has 1 terminal still open. ${GUARD_TAIL}`,
    'live terminals alone are enough',
  );
  assert.deepEqual(await listed(), [saved.setup.id, open.setup.id, bare.setup.id, forced.setup.id], 'still nothing removed');

  await box.orca.set({ deleteGuard: { workspaces: 0 } });
  assert.equal(JSON.parse(del(bare.setup).stdout).ok, true, 'nothing open and nothing saved: the plain delete goes ahead');
  await box.orca.set({ deleteGuard: { workspaces: 3, terminals: 2 } });
  const went = JSON.parse(del(forced.setup, '--force').stdout);
  assert.equal(went.ok, true, '--force checks nothing');
  assert.equal(went.result.deleted.setupId, forced.setup.id);
  assert.deepEqual(await listed(), [saved.setup.id, open.setup.id], 'and each delete that went ahead took its project off the list');
});

test('#528 the fake refuses --force on setup-delete as Orca 1.4.223\'s CLI does, before it looks for the setup, and deletes without it', async (t) => {
  const box = await createSandbox(t);
  const { setup } = oneProject(box, 'api-bot');
  const del = (id, ...rest) => ask(box, ['project', 'setup-delete', '--setup', id, ...rest, '--json']);
  const unknown = { code: 'invalid_argument', message: 'Unknown flag --force for command: project setup-delete', data: {} };

  await box.orca.set({ forceUnknown: true });
  const before = await box.orca.state();
  const refused = del(setup.id, '--force');
  assert.equal(refused.status, 1);
  assert.deepEqual(JSON.parse(refused.stdout).error, unknown);
  assert.deepEqual(await box.orca.state(), before, 'a refused delete changes nothing');
  assert.deepEqual(JSON.parse(del('repo_nowhere', '--force').stdout).error, unknown, 'the flag is checked before any setup is looked for');

  const went = JSON.parse(del(setup.id).stdout);
  assert.equal(went.ok, true, 'the same delete without --force goes ahead');
  assert.deepEqual(await box.orca.setups(), []);
});

test('#528 with neither key the fake takes setup-delete with --force and without it alike', async (t) => {
  const box = await createSandbox(t);
  const plain = oneProject(box, 'plain-bot');
  const forced = oneProject(box, 'forced-bot');

  assert.equal(JSON.parse(ask(box, ['project', 'setup-delete', '--setup', plain.setup.id, '--json']).stdout).ok, true);
  assert.equal(JSON.parse(ask(box, ['project', 'setup-delete', '--setup', forced.setup.id, '--force', '--json']).stdout).ok, true);
  assert.deepEqual(await box.orca.setups(), []);
});
