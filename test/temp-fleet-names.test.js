// A fleet in a throwaway folder shows in Orca under the same names as any other
// fleet (#652). Until #652, a bots folder under the system temp folder got
// projects marked with the first folder under it (#401). That mark existed for
// the kit's own system tests and live checks, so it left the kit's core with
// them: "Core is core and test is test." Now every fleet's project is called
// by the bot's display name alone, under the temp folder or not, and tab titles
// are the same everywhere.
//
// The tests of the mark alone went with it (which folder it named, a TMPDIR
// that is a link, a fleet named through a link, a folder beside the temp
// folder). What stays checks the plain names.
//
// Each sandbox gives the kit a temp folder of its own, `box.tmp`, beside the
// sandbox's working directory (helpers/cli.js); a throwaway fleet is made
// under it.

import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  botHomeOf,
  createSandbox,
  orcaCallsOf,
  orcaFlag,
  TAB_TITLES,
  tabsOfBot,
} from './helpers/cli.js';

/** The folder the owner saw in Orca's sidebar, under the temp folder. */
const LIVE = 'obk250-live.ePjgqK';

/** Seed a bots folder at `bots`, which brings Bot Father up. */
async function init(box, bots, options) {
  const result = await box.run(['init', '--bots', bots, '--harness', 'claude'], options);
  assert.equal(result.code, 0, result.stderr);
}

/** Make a bot with one `daily` session in `bots`. */
async function makeBot(box, bots, name) {
  const made = await box.run(['bot', 'create', '--bots', bots, '--name', name, '--harness', 'claude']);
  assert.equal(made.code, 0, made.stderr);
  const added = await box.run(['session', 'add', '--bots', bots, '--bot', name, '--name', 'daily']);
  assert.equal(added.code, 0, added.stderr);
}

/** The display name of the one project Orca holds for `home`. */
async function projectNameAt(box, home) {
  const setups = (await box.orca.setups()).filter((setup) => setup.path === home);
  assert.equal(setups.length, 1, `Orca should hold one project for ${home}, got ${JSON.stringify(await box.orca.setups())}`);
  assert.equal(setups[0].kind, 'folder');
  return setups[0].displayName;
}

test('a fleet under the temp folder: Bot Father\'s project is called Bot Father, with no mark', async (t) => {
  const box = await createSandbox(t);
  const bots = path.join(box.tmp, LIVE, 'bots');
  await mkdir(bots, { recursive: true });

  await init(box, bots);

  assert.equal(await projectNameAt(box, botHomeOf(bots)), 'Bot Father');
});

test('a fleet under the temp folder: another bot\'s project is called by its display name, with no mark', async (t) => {
  const box = await createSandbox(t);
  const bots = path.join(box.tmp, LIVE, 'bots');
  await mkdir(bots, { recursive: true });
  await init(box, bots);
  await makeBot(box, bots, 'api-bot');

  const result = await box.run(['up', '--bots', bots, '--bot', 'api-bot']);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(await projectNameAt(box, botHomeOf(bots, 'api-bot')), 'Api Bot');
});

test('a fleet under the temp folder keeps its tab titles as they are', async (t) => {
  const box = await createSandbox(t);
  const bots = path.join(box.tmp, LIVE, 'bots');
  await mkdir(bots, { recursive: true });
  await init(box, bots);
  await makeBot(box, bots, 'api-bot');

  const result = await box.run(['up', '--bots', bots]);

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(
    (await tabsOfBot(box, bots, 'bot-father')).map((tab) => tab.title).sort(),
    ['Bot Father daily', 'Bot Father ops'],
  );
  assert.deepEqual((await tabsOfBot(box, bots, 'api-bot')).map((tab) => tab.title), ['Api Bot daily']);
});

test('a fleet outside the temp folder keeps exactly today\'s project names and tab titles', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  await init(box, bots);
  await makeBot(box, bots, 'api-bot');

  const result = await box.run(['up', '--bots', bots]);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(await projectNameAt(box, botHomeOf(bots)), 'Bot Father');
  assert.equal(await projectNameAt(box, botHomeOf(bots, 'api-bot')), 'Api Bot');
  assert.deepEqual(
    (await tabsOfBot(box, bots, 'bot-father')).map((tab) => tab.title).sort(),
    [TAB_TITLES.daily, TAB_TITLES.ops].sort(),
  );
  assert.deepEqual((await tabsOfBot(box, bots, 'api-bot')).map((tab) => tab.title), ['Api Bot daily']);
});

/** Orca holding `home` as a git-kind project, the way `repo add` leaves a folder inside a git repo. */
const gitProjectAt = (home) => ({
  id: 'setup_existing',
  projectId: 'proj_existing',
  hostId: 'host_local',
  repoId: 'setup_existing',
  path: home,
  displayName: 'bot-father',
  kind: 'git',
  setupState: 'ready',
  setupMethod: 'repo-add',
});

test('a git-kind project in a fleet under the temp folder is turned into a folder one called Bot Father, the name the kit makes', async (t) => {
  // What the kit names the project when it makes it, in a fleet of the same shape.
  const made = await createSandbox(t);
  const madeBots = path.join(made.tmp, LIVE, 'bots');
  await mkdir(madeBots, { recursive: true });
  await init(made, madeBots);
  const madeName = await projectNameAt(made, botHomeOf(madeBots));
  assert.equal(madeName, 'Bot Father', 'the name the kit makes has no mark');

  const box = await createSandbox(t);
  const bots = path.join(box.tmp, LIVE, 'bots');
  await mkdir(bots, { recursive: true });
  await box.orca.set({ setups: [gitProjectAt(botHomeOf(bots))] });

  await init(box, bots);

  const calls = await box.orca.calls();
  assert.deepEqual(orcaCallsOf(calls, 'repo add'), [], 'the project Orca had is the one that is turned');
  const updates = orcaCallsOf(calls, 'project setup-update');
  assert.equal(updates.length, 1, JSON.stringify(updates));
  assert.equal(orcaFlag(updates[0], '--setup'), 'setup_existing');
  assert.equal(orcaFlag(updates[0], '--kind'), 'folder');
  assert.equal(orcaFlag(updates[0], '--display-name'), 'Bot Father', 'no mark');
  assert.equal(orcaFlag(updates[0], '--display-name'), madeName, 'turning a project names it as making one does');
  assert.equal(await projectNameAt(box, botHomeOf(bots)), madeName);
});
