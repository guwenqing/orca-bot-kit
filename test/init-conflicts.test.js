// `init` must refuse a folder it cannot make usable, instead of reporting
// success. A refusal writes nothing at all, so the user's conflicting data
// survives and the folder is left exactly as it was found.

import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { assertCleanFailure, assertSeededBotsFolder, createSandbox, git, snapshot } from './helpers/cli.js';

/** A refusal: exit 1, a message on stderr naming what is in the way, and an untouched folder. */
async function assertRefused(result, bots, before, names) {
  assertCleanFailure(result);
  assert.ok(
    result.stderr.includes(names),
    `stderr should name ${names}, got: ${result.stderr}`,
  );
  // A system error passed through tells the person the errno, not what to do.
  assert.ok(
    !/\b(?:ENOENT|ENOTDIR|EEXIST|EACCES|EISDIR|EPERM)\b/.test(result.stderr),
    `should explain the refusal, not leak a system error: ${result.stderr}`,
  );
  assert.deepEqual(await snapshot(bots), before, 'the bots folder should be untouched');
}

test('a .git that is not a repository is refused', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bad-git');
  await mkdir(path.join(bots, '.git'), { recursive: true });
  const before = await snapshot(bots);

  const result = await box.run(['init', '--bots', 'bad-git', '--harness', 'claude']);

  await assertRefused(result, bots, before, 'bad-git');
});

test('a .git that resolves to a parent repository is refused', async (t) => {
  const box = await createSandbox(t);
  const outer = box.path('outer');
  await mkdir(outer, { recursive: true });
  assert.equal((await git(['init', '--quiet'], outer)).code, 0);
  const bots = path.join(outer, 'nested-bots');
  await mkdir(path.join(bots, '.git'), { recursive: true });
  const before = await snapshot(bots);

  const result = await box.run(['init', '--bots', 'outer/nested-bots', '--harness', 'claude']);

  // git would walk up to `outer` here, so the folder is not a repo of its own.
  await assertRefused(result, bots, before, 'nested-bots');
});

test('a .git that is not a repository is refused from inside the folder', async (t) => {
  // `obk init --bots .` from inside the folder you mean is an ordinary thing to
  // do, and it is where a comparison against a resolved empty path comes out true.
  const box = await createSandbox(t);
  const bots = box.path('bad-git');
  await mkdir(path.join(bots, '.git'), { recursive: true });
  const before = await snapshot(bots);

  const result = await box.run(['init', '--bots', '.', '--harness', 'claude'], { cwd: bots });

  await assertRefused(result, bots, before, 'bad-git');
});

test('init leaves files it did not create alone', async (t) => {
  // The bots folder is the user's. Short names are the interesting case: they
  // are what a layout path decomposes into if it is taken apart wrongly.
  const box = await createSandbox(t);
  const bots = box.path('bots');
  await mkdir(bots, { recursive: true });
  const mine = { d: 'mine: d\n', r: 'mine: r\n', s: 'mine: s\n', 'notes.md': 'mine\n' };
  for (const [name, contents] of Object.entries(mine)) {
    await writeFile(path.join(bots, name), contents);
  }

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assert.equal(result.code, 0);
  await assertSeededBotsFolder(bots, 'claude');
  for (const [name, contents] of Object.entries(mine)) {
    assert.equal(await readFile(path.join(bots, name), 'utf8'), contents, `${name} was touched`);
  }
});

test('a seeded file that is already a directory is refused', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bad-seed');
  await mkdir(path.join(bots, 'defaults.yaml'), { recursive: true });
  await writeFile(path.join(bots, 'defaults.yaml', 'mine.txt'), 'the user put this here\n');
  const before = await snapshot(bots);

  const result = await box.run(['init', '--bots', 'bad-seed', '--harness', 'claude']);

  await assertRefused(result, bots, before, 'defaults.yaml');
  assert.ok(
    /\b(?:file|folder|directory)\b/.test(result.stderr),
    `should say what init needs there, got: ${result.stderr}`,
  );
  // Nothing was seeded around the conflict: the check runs before any writing.
  assert.deepEqual(Object.keys(before).sort(), ['defaults.yaml', 'defaults.yaml/mine.txt']);
});

test('a seeded directory that is already a regular file is refused', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  await mkdir(bots, { recursive: true });
  await writeFile(path.join(bots, 'rules'), 'not a directory\n');
  const before = await snapshot(bots);

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  await assertRefused(result, bots, before, 'rules');
  assert.ok(
    /\b(?:file|folder|directory)\b/.test(result.stderr),
    `should say what init needs there, got: ${result.stderr}`,
  );
});

test('a .gitkeep that is already a directory is refused', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  await mkdir(path.join(bots, 'rules', '.gitkeep'), { recursive: true });
  const before = await snapshot(bots);

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  await assertRefused(result, bots, before, '.gitkeep');
});

test('the bots directory being a regular file is refused', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  await mkdir(bots, { recursive: true });
  await writeFile(path.join(bots, 'bots'), 'not a directory\n');
  const before = await snapshot(bots);

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  await assertRefused(result, bots, before, 'bots');
});

test('a bot directory that is already a regular file is refused', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  await mkdir(path.join(bots, 'bots'), { recursive: true });
  await writeFile(path.join(bots, 'bots', 'bot-father'), 'not a directory\n');
  const before = await snapshot(bots);

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  await assertRefused(result, bots, before, 'bot-father');
});

test('a bot.yaml that is already a directory is refused, and nothing earlier is seeded', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  // The last entry of the layout: everything else would have been written first.
  await mkdir(path.join(bots, 'bots', 'bot-father', 'bot.yaml'), { recursive: true });
  const before = await snapshot(bots);

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  await assertRefused(result, bots, before, 'bot.yaml');
});

test('a symlink pointing nowhere is refused', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  await mkdir(bots, { recursive: true });
  await symlink(path.join(bots, 'gone.yaml'), path.join(bots, 'skills.yaml'));
  const before = await snapshot(bots);

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  await assertRefused(result, bots, before, 'skills.yaml');
});

test('a symlink to a regular file is accepted and left alone', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  await mkdir(bots, { recursive: true });
  const target = box.path('my-defaults.yaml');
  await writeFile(target, 'rules: [mine]\nskills: []\n');
  await symlink(target, path.join(bots, 'defaults.yaml'));

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assert.equal(result.code, 0);
  assert.ok((await lstat(path.join(bots, 'defaults.yaml'))).isSymbolicLink());
  assert.equal(await readFile(target, 'utf8'), 'rules: [mine]\nskills: []\n');
  assert.ok((await lstat(path.join(bots, 'skills.yaml'))).isFile());
  assert.ok((await lstat(path.join(bots, 'bots', 'bot-father', 'bot.yaml'))).isFile());
});

test('a bots folder inside another repository still gets its own repository', async (t) => {
  const box = await createSandbox(t);
  const outer = box.path('outer');
  await mkdir(outer, { recursive: true });
  assert.equal((await git(['init', '--quiet'], outer)).code, 0);
  const bots = path.join(outer, 'inner-bots');

  const result = await box.run(['init', '--bots', 'outer/inner-bots', '--harness', 'claude']);

  assert.equal(result.code, 0);
  const toplevel = await git(['rev-parse', '--show-toplevel'], bots);
  assert.equal(toplevel.code, 0);
  assert.equal(toplevel.stdout.trim(), bots);
  assert.ok((await lstat(path.join(bots, 'defaults.yaml'))).isFile());
});
