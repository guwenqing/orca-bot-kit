// The `--bots` path itself may be a link: people keep the folder on another
// volume and link to it. What counts is what the link points at. A directory is
// seeded through the link, in the real folder; anything else is refused, and a
// refusal writes nothing anywhere — not even the folder the link names.

import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { assertCleanFailure, assertSeededBotsFolder, createSandbox, git, skipOrcaFake, snapshot } from './helpers/cli.js';

/** A refusal: exit 1, a message naming the path, and no system error leaked into it. */
function assertRefused(result, names) {
  assertCleanFailure(result);
  assert.ok(result.stderr.includes(names), `stderr should name ${names}, got: ${result.stderr}`);
  // A system error passed through tells the person the errno, not what to do.
  assert.ok(
    !/\b(?:ENOENT|ENOTDIR|EEXIST|EACCES|EISDIR|EPERM|ELOOP)\b/.test(result.stderr),
    `should explain the refusal, not leak a system error: ${result.stderr}`,
  );
}

test('init --bots a link to a directory seeds the directory the link points at', async (t) => {
  const box = await createSandbox(t);
  const real = path.join(box.root, 'elsewhere', 'real-bots');
  await mkdir(real, { recursive: true });
  await symlink(real, box.path('linked-bots'));

  const result = await box.run(['init', '--bots', 'linked-bots', '--harness', 'claude']);

  assert.equal(result.code, 0);
  await assertSeededBotsFolder(real, 'claude');
  assert.ok((await lstat(box.path('linked-bots'))).isSymbolicLink(), 'the link should still be a link');
  // The link was followed, not replaced or worked around.
  assert.deepEqual(await readdir(box.cwd), ['linked-bots'], 'nothing was created beside the link');
});

test('init --bots a relative link to a directory seeds through the link', async (t) => {
  const box = await createSandbox(t);
  const real = path.join(box.root, 'elsewhere', 'real-bots');
  await mkdir(real, { recursive: true });
  await symlink(path.join('..', 'elsewhere', 'real-bots'), box.path('linked-bots'));

  const result = await box.run(['init', '--bots', 'linked-bots', '--harness', 'claude']);

  assert.equal(result.code, 0);
  await assertSeededBotsFolder(real, 'claude');
  assert.deepEqual(await readdir(box.cwd), ['linked-bots'], 'nothing was created beside the link');
});

test('init --bots a chain of links seeds the directory at the end of it', async (t) => {
  const box = await createSandbox(t);
  const real = path.join(box.root, 'elsewhere', 'real-bots');
  await mkdir(real, { recursive: true });
  await symlink(real, box.path('middle'));
  await symlink(box.path('middle'), box.path('linked-bots'));

  const result = await box.run(['init', '--bots', 'linked-bots', '--harness', 'claude']);

  assert.equal(result.code, 0);
  await assertSeededBotsFolder(real, 'claude');
});

test("the repository is made in the real folder, and is that folder's own", async (t) => {
  const box = await createSandbox(t);
  // Inside another repository: a `git init` that lands anywhere but the real
  // folder leaves the bots folder owned by `outer`.
  const outer = path.join(box.root, 'outer');
  await mkdir(outer);
  assert.equal((await git(['init', '--quiet'], outer)).code, 0);
  const real = path.join(outer, 'real-bots');
  await mkdir(real);
  await symlink(real, box.path('linked-bots'));

  assert.equal((await box.run(['init', '--bots', 'linked-bots', '--harness', 'claude'])).code, 0);

  assert.ok((await lstat(path.join(real, '.git'))).isDirectory(), '.git belongs in the real folder');
  const toplevel = await git(['rev-parse', '--show-toplevel'], real);
  assert.equal(toplevel.code, 0);
  assert.equal(toplevel.stdout.trim(), real);
  assert.deepEqual(await readdir(box.cwd), ['linked-bots'], 'no repository beside the link');
});

test("a link to a directory that already holds the user's files keeps them", async (t) => {
  const box = await createSandbox(t);
  const real = path.join(box.root, 'elsewhere', 'real-bots');
  await mkdir(real, { recursive: true });
  await writeFile(path.join(real, 'notes.md'), 'mine\n');
  await symlink(real, box.path('linked-bots'));

  const result = await box.run(['init', '--bots', 'linked-bots', '--harness', 'claude']);

  assert.equal(result.code, 0);
  await assertSeededBotsFolder(real, 'claude');
  assert.equal(await readFile(path.join(real, 'notes.md'), 'utf8'), 'mine\n');
});

test('a second init through the same link changes nothing', async (t) => {
  const box = await createSandbox(t);
  const real = path.join(box.root, 'elsewhere', 'real-bots');
  await mkdir(real, { recursive: true });
  await symlink(real, box.path('linked-bots'));
  assert.equal((await box.run(['init', '--bots', 'linked-bots', '--harness', 'claude'])).code, 0);

  const edited = 'rules:\n  - my-rule\nskills: []\n';
  await writeFile(path.join(real, 'defaults.yaml'), edited);
  const before = await snapshot(real);

  const second = await box.run(['init', '--bots', 'linked-bots', '--harness', 'claude']);

  assert.equal(second.code, 0);
  assert.deepEqual(await snapshot(real), before);
  assert.equal(await readFile(path.join(real, 'defaults.yaml'), 'utf8'), edited);
});

test('a link pointing nowhere is refused and nothing is written', async (t) => {
  const box = await createSandbox(t);
  // The target is inside the sandbox, so a seeding run that followed the link
  // anyway would leave its folder behind for the snapshot to find.
  await symlink(path.join(box.root, 'gone'), box.path('linked-bots'));
  // The fake Orca's own record of being asked is not a write to the user's disk.
  const before = await snapshot(box.root, skipOrcaFake);

  const result = await box.run(['init', '--bots', 'linked-bots', '--harness', 'claude']);

  assertRefused(result, 'linked-bots');
  assert.deepEqual(await snapshot(box.root, skipOrcaFake), before, 'a refusal writes nothing at all');
});

test('a link to a regular file is refused and the file is left alone', async (t) => {
  const box = await createSandbox(t);
  const target = path.join(box.root, 'notes.md');
  await writeFile(target, 'mine\n');
  await symlink(target, box.path('linked-bots'));
  // The fake Orca's own record of being asked is not a write to the user's disk.
  const before = await snapshot(box.root, skipOrcaFake);

  const result = await box.run(['init', '--bots', 'linked-bots', '--harness', 'claude']);

  assertRefused(result, 'linked-bots');
  assert.equal(await readFile(target, 'utf8'), 'mine\n');
  assert.deepEqual(await snapshot(box.root, skipOrcaFake), before, 'a refusal writes nothing at all');
});

test('Orca is given the real folder, not the link', async (t) => {
  // Orca does not resolve links: the same folder registered once by its link
  // and once by its real path becomes two projects, each with its own tabs
  // (tech notes, section 1). So the kit hands it one canonical path.
  const box = await createSandbox(t);
  const real = path.join(box.root, 'elsewhere', 'real-bots');
  await mkdir(real, { recursive: true });
  await symlink(real, box.path('linked-bots'));

  assert.equal((await box.run(['init', '--bots', 'linked-bots', '--harness', 'claude'])).code, 0);

  const home = path.join(real, 'bots', 'bot-father');
  assert.deepEqual((await box.orca.setups()).map((setup) => setup.path), [home]);
  assert.deepEqual((await box.orca.terminals()).map((terminal) => terminal.worktreePath), [home, home]);
});
