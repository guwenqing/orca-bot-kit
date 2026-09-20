// Bot Father's folder as Orca sees it: one workspace, of kind `folder`, called
// `Bot Father`. Kind matters — a git-kind registration of a folder inside a git
// repo has no worktree at all, and every `terminal create` on it then fails
// with `selector_not_found` (proven on Orca 1.4.205).

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertOrcaCallsAllowed,
  createSandbox,
  orcaCallsOf,
  orcaFlag,
  orcaFlags,
} from './helpers/cli.js';

/** Where Bot Father lives inside a bots folder: the workspace the kit registers. */
const botHomeIn = (box) => box.path('bots', 'bots', 'bot-father');

/** The one workspace Orca ends up with for `path`, and nothing beside it. */
async function theSetupAt(box, target) {
  const setups = await box.orca.setups();
  const mine = setups.filter((setup) => setup.path === target);
  assert.equal(mine.length, 1, `Orca should hold one workspace for ${target}, got ${JSON.stringify(setups)}`);
  return mine[0];
}

test('init registers Bot Father\'s folder as a folder workspace called Bot Father', async (t) => {
  const box = await createSandbox(t);
  const botHome = botHomeIn(box);

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assert.equal(result.code, 0, result.stderr);
  const setup = await theSetupAt(box, botHome);
  assert.equal(setup.kind, 'folder');
  assert.equal(setup.displayName, 'Bot Father');

  const added = orcaCallsOf(await box.orca.calls(), 'repo add');
  assert.equal(added.length, 1, 'the folder should be registered once');
  assert.equal(orcaFlag(added[0], '--path'), botHome);
  assert.deepEqual(orcaFlags(added[0]), ['--json', '--path']);
});

test('the workspace is the bot home, not the bots folder around it', async (t) => {
  const box = await createSandbox(t);

  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);

  assert.deepEqual(
    (await box.orca.setups()).map((setup) => setup.path),
    [botHomeIn(box)],
    'only Bot Father\'s own folder belongs to Orca',
  );
});

test('a workspace Orca already holds as a git repo is corrected, not duplicated', async (t) => {
  const box = await createSandbox(t);
  const botHome = botHomeIn(box);
  await box.orca.set({
    setups: [{
      id: 'setup_existing',
      projectId: 'proj_existing',
      hostId: 'host_local',
      repoId: 'setup_existing',
      path: botHome,
      displayName: 'bot-father',
      kind: 'git',
      setupState: 'ready',
      setupMethod: 'repo-add',
    }],
  });

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assert.equal(result.code, 0, result.stderr);
  const setup = await theSetupAt(box, botHome);
  assert.equal(setup.id, 'setup_existing', 'the workspace Orca had should be the one that was fixed');
  assert.equal(setup.kind, 'folder');
  assert.equal(setup.displayName, 'Bot Father');

  const calls = await box.orca.calls();
  assert.deepEqual(orcaCallsOf(calls, 'repo add'), [], 'a workspace that is there must not be added again');
  const updates = orcaCallsOf(calls, 'project setup-update');
  assert.equal(updates.length, 1, 'the workspace should be corrected once');
  assert.equal(orcaFlag(updates[0], '--setup'), 'setup_existing');
  assert.equal(orcaFlag(updates[0], '--kind'), 'folder');
  assert.equal(orcaFlag(updates[0], '--display-name'), 'Bot Father');
  assertOrcaCallsAllowed(calls);
});

test('a workspace that is already right is left exactly as it is', async (t) => {
  const box = await createSandbox(t);
  const botHome = botHomeIn(box);
  const setup = {
    id: 'setup_ready',
    projectId: 'proj_ready',
    hostId: 'host_local',
    repoId: 'setup_ready',
    path: botHome,
    displayName: 'Bot Father',
    kind: 'folder',
    setupState: 'ready',
    setupMethod: 'existing-folder',
  };
  await box.orca.set({ setups: [setup] });

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await box.orca.setups(), [setup], 'nothing about the workspace should change');
  const calls = await box.orca.calls();
  assert.deepEqual(orcaCallsOf(calls, 'repo add'), []);
  assert.deepEqual(orcaCallsOf(calls, 'project setup-update'), []);
});

test('the same workspace is not registered twice by a second run', async (t) => {
  const box = await createSandbox(t);
  const botHome = botHomeIn(box);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);

  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);

  const setup = await theSetupAt(box, botHome);
  assert.equal(setup.kind, 'folder');
  assert.equal(setup.displayName, 'Bot Father');
});
