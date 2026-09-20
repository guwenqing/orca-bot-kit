// The fake Orca every sandbox runs. Nothing else in `npm test` means anything
// if this lies: a fake that says yes to everything turns every assertion about
// Orca into a test of nothing, and a fake that can be bypassed lets a CI run —
// or a developer's machine — reach the real Orca.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { createSandbox } from './helpers/cli.js';

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

test('the fake records every call, in order, with what it was asked', async (t) => {
  const box = await createSandbox(t);

  ask(box, ['status', '--json']);
  ask(box, ['project', 'setups', '--json']);

  assert.deepEqual(await box.orca.calls(), [
    { args: ['status', '--json'], cwd: box.cwd },
    { args: ['project', 'setups', '--json'], cwd: box.cwd },
  ]);
});
