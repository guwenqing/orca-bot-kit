// `obk up --bots <path>` brings Bot Father back in Orca after a restart. It
// creates only what is missing, it never closes a tab, and it writes none of
// the seed files: a folder `init` never made is an error, not something `up`
// quietly fixes.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  assertCleanFailure,
  bareLaunch,
  createSandbox,
  git,
  skipGit,
  snapshot,
  TAB_TITLES,
  typedInto,
} from './helpers/cli.js';

const botHomeIn = (box) => box.path('bots', 'bots', 'bot-father');

test('up on a folder that is not there fails and creates nothing', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['up', '--bots', 'bots']);

  assertCleanFailure(result);
  assert.match(result.stderr, /obk init/, `should send the user to init, got: ${result.stderr}`);
  assert.deepEqual(await readdir(box.cwd), [], 'up seeds nothing, not even the folder');
  assert.deepEqual(await box.orca.terminals(), []);
});

test('up on a folder init never made fails and seeds nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  await mkdir(bots, { recursive: true });
  await writeFile(path.join(bots, 'notes.md'), 'mine\n');
  const before = await snapshot(bots);

  const result = await box.run(['up', '--bots', 'bots']);

  assertCleanFailure(result);
  assert.match(result.stderr, /obk init/, `should send the user to init, got: ${result.stderr}`);
  assert.deepEqual(await snapshot(bots), before, 'the folder must be left as it was found');
  assert.deepEqual(await box.orca.terminals(), []);
});

test('up on a bots folder with no Bot Father in it fails', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  await rm(botHomeIn(box), { recursive: true });
  const before = await snapshot(bots, skipGit);

  const result = await box.run(['up', '--bots', 'bots']);

  assertCleanFailure(result);
  assert.deepEqual(await snapshot(bots, skipGit), before);
});

test('up without --bots fails and creates nothing', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['up']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('--bots'), `should name --bots, got: ${result.stderr}`);
  assert.deepEqual(await readdir(box.cwd), []);
});

test('up with an extra argument fails and names it', async (t) => {
  const box = await createSandbox(t);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);

  const result = await box.run(['up', 'stray', '--bots', 'bots']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('stray'), `should name the argument, got: ${result.stderr}`);
});

test('up brings back a workspace and tabs that are gone, and says so', async (t) => {
  const box = await createSandbox(t);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'codex'])).code, 0);

  // Orca forgot everything — a fresh install, or a profile that was cleared.
  await box.orca.set({ setups: [], terminals: [] });

  const result = await box.run(['up', '--bots', 'bots']);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.notEqual(result.stdout.trim(), '', 'up should say what it did');

  const setups = await box.orca.setups();
  assert.equal(setups.length, 1);
  assert.equal(setups[0].path, botHomeIn(box));
  assert.equal(setups[0].kind, 'folder');
  assert.equal(setups[0].displayName, 'Bot Father');

  const terminals = await box.orca.terminals();
  assert.equal(terminals.length, 2);
  assert.deepEqual(terminals.map((terminal) => terminal.title).sort(), [TAB_TITLES.daily, TAB_TITLES.ops].sort());
  const daily = terminals.find((terminal) => terminal.title === TAB_TITLES.daily);
  const ops = terminals.find((terminal) => terminal.title === TAB_TITLES.ops);
  assert.deepEqual(
    typedInto(daily),
    [bareLaunch(box, 'codex')],
    'the daily tab runs the harness bot.yaml names, at the approval level the session takes',
  );
  assert.deepEqual(typedInto(ops), [], 'the ops tab runs nothing');
});

test('up writes none of the seed files', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);

  // Seeding is `init`'s job alone. Whether `up` refuses a folder in this state
  // or gets on with its work, what it must not do is write the file back.
  await rm(path.join(bots, 'defaults.yaml'));
  await rm(path.join(bots, 'skills.yaml'));

  await box.run(['up', '--bots', 'bots']);

  assert.equal(existsSync(path.join(bots, 'defaults.yaml')), false, 'up must not seed defaults.yaml');
  assert.equal(existsSync(path.join(bots, 'skills.yaml')), false, 'up must not seed skills.yaml');
});

test('up makes no git repository of its own', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  await mkdir(bots, { recursive: true });

  const result = await box.run(['up', '--bots', 'bots']);

  assertCleanFailure(result);
  assert.notEqual((await git(['rev-parse', '--git-dir'], bots)).code, 0, 'up must not run git init');
});

test('up takes an absolute path as well', async (t) => {
  const box = await createSandbox(t);
  const bots = path.join(box.root, 'elsewhere', 'bots');
  assert.equal((await box.run(['init', '--bots', bots, '--harness', 'claude'])).code, 0);
  await box.orca.set({ terminals: [] });

  const result = await box.run(['up', '--bots', bots]);

  assert.equal(result.code, 0, result.stderr);
  const terminals = await box.orca.terminals();
  assert.equal(terminals.length, 2);
  assert.equal(terminals[0].worktreePath, path.join(bots, 'bots', 'bot-father'));
});
