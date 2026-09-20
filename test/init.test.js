import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { assertSeededBotsFolder, createSandbox, git, skipGit, skipOrcaFake, snapshot } from './helpers/cli.js';

test('init --bots <relative path> seeds the bots folder', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assert.equal(result.code, 0);
  assert.notEqual(result.stdout.trim(), '');
  await assertSeededBotsFolder(box.path('bots'), 'claude');
});

test('init --bots <absolute path> seeds the bots folder outside the working directory', async (t) => {
  const box = await createSandbox(t);
  const bots = path.join(box.root, 'elsewhere', 'bots');

  const result = await box.run(['init', '--bots', bots, '--harness', 'claude']);

  assert.equal(result.code, 0);
  await assertSeededBotsFolder(bots, 'claude');
});

test('init creates missing parent directories', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['init', '--bots', 'a/b/c/bots', '--harness', 'claude']);

  assert.equal(result.code, 0);
  await assertSeededBotsFolder(box.path('a', 'b', 'c', 'bots'), 'claude');
});

test('init seeds the .gitkeep files empty', async (t) => {
  const box = await createSandbox(t);

  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);

  // A .gitkeep only holds the folder open; anything in it is content the user
  // did not ask for, in a folder meant to start empty.
  for (const dir of ['rules', 'skills']) {
    assert.equal(await readFile(box.path('bots', dir, '.gitkeep'), 'utf8'), '');
  }
});

test('init makes the bots folder its own git repo with no commit and an empty index', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');

  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);

  // The repo is rooted at the bots folder itself, not at some parent.
  const gitDir = await git(['rev-parse', '--git-dir'], bots);
  assert.equal(gitDir.code, 0);
  assert.equal(gitDir.stdout.trim(), '.git');

  const head = await git(['rev-parse', 'HEAD'], bots);
  assert.notEqual(head.code, 0, 'the repo should have no commit');

  const anyCommit = await git(['rev-list', '--all', '--max-count=1'], bots);
  assert.equal(anyCommit.stdout.trim(), '');

  const staged = await git(['ls-files'], bots);
  assert.equal(staged.code, 0);
  assert.equal(staged.stdout, '', 'nothing should be staged');
});

test('init puts no kit code in the bots folder', async (t) => {
  const box = await createSandbox(t);

  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);

  const tree = await snapshot(box.path('bots'), skipGit);
  for (const [rel, kind] of Object.entries(tree)) {
    assert.ok(!rel.endsWith('.js'), `no .js file expected, found ${rel}`);
    assert.notEqual(path.basename(rel), 'package.json', `no package.json expected, found ${rel}`);
    assert.notEqual(path.basename(rel), 'node_modules', `no node_modules expected, found ${rel}`);
    assert.ok(!kind.startsWith('symlink:'), `no symlink expected, found ${rel}`);
  }
});

test('init writes nothing outside the bots folder', async (t) => {
  const box = await createSandbox(t);
  // What the fake Orca remembers is Orca's own state, not a write to the user's disk.
  const skipTarget = (rel) => rel === 'cwd/bots' || rel.startsWith('cwd/bots/') || skipOrcaFake(rel);

  const before = await snapshot(box.root, skipTarget);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const after = await snapshot(box.root, skipTarget);

  assert.deepEqual(after, before);
});

test('init asks the Orca that OBK_ORCA names, not the one on PATH', async (t) => {
  // OBK_ORCA is how the kit resolves the CLI (the rule scripts/test-system.js
  // already follows). With a useless `orca` first on PATH, a kit that looked
  // there instead could not finish.
  const box = await createSandbox(t);
  const badBin = path.join(box.root, 'bad-bin');
  await mkdir(badBin);
  await writeFile(path.join(badBin, 'orca'), '#!/bin/sh\necho "no orca here" >&2\nexit 127\n');
  await chmod(path.join(badBin, 'orca'), 0o755);

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude'], {
    env: { ...box.env, PATH: `${badBin}${path.delimiter}${box.env.PATH}` },
  });

  assert.equal(result.code, 0, `init should have used OBK_ORCA, got: ${result.stderr}`);
  assert.ok((await box.orca.calls()).length > 0, 'the fake OBK_ORCA names should have been called');
});

test('the fake orca records what it was asked', async (t) => {
  // Guards every assertion about Orca calls: an empty call log must mean "not
  // called", not "not wired up".
  const box = await createSandbox(t);

  spawnSync('orca', ['status', '--json'], { cwd: box.cwd, env: box.env });

  assert.deepEqual(await box.orca.calls(), [{ args: ['status', '--json'], cwd: box.cwd }]);
});
