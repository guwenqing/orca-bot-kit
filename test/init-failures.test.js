import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import test from 'node:test';

import { assertCleanFailure, createSandbox } from './helpers/cli.js';

test('init without --bots fails and creates nothing', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['init']);

  assertCleanFailure(result);
  assert.deepEqual(await readdir(box.cwd), []);
});

test('init --bots with an empty value fails and creates nothing', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['init', '--bots', '']);

  assertCleanFailure(result);
  assert.deepEqual(await readdir(box.cwd), []);
});

test('init --bots with nothing after it fails and creates nothing', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['init', '--bots']);

  assertCleanFailure(result);
  assert.deepEqual(await readdir(box.cwd), []);
});

test('init --bots on an existing regular file fails and leaves the file alone', async (t) => {
  const box = await createSandbox(t);
  const target = box.path('bots');
  await writeFile(target, 'not a folder\n');

  const result = await box.run(['init', '--bots', 'bots']);

  assertCleanFailure(result);
  assert.equal(await readFile(target, 'utf8'), 'not a folder\n');
  assert.deepEqual(await readdir(box.cwd), ['bots']);
});
