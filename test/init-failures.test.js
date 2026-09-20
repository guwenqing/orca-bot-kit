import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import test from 'node:test';

import { assertCleanFailure, createSandbox } from './helpers/cli.js';

test('init without --bots fails and creates nothing', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['init', '--harness', 'claude']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('--bots'), `should name --bots, got: ${result.stderr}`);
  assert.deepEqual(await readdir(box.cwd), []);
});

test('init --bots with an empty value fails and creates nothing', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['init', '--bots', '', '--harness', 'claude']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('--bots'), `should name --bots, got: ${result.stderr}`);
  assert.deepEqual(await readdir(box.cwd), []);
});

test('init --bots with nothing after it fails and creates nothing', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['init', '--harness', 'claude', '--bots']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('--bots'), `should name --bots, got: ${result.stderr}`);
  assert.deepEqual(await readdir(box.cwd), []);
});

test('init --bots with a value that is only whitespace fails and creates nothing', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['init', '--bots', '   ', '--harness', 'claude']);

  assertCleanFailure(result);
  assert.deepEqual(await readdir(box.cwd), []);
});

test('init with an extra argument fails, names it, and creates nothing', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['init', 'stray', '--bots', 'bots', '--harness', 'claude']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('stray'), `should name the argument, got: ${result.stderr}`);
  assert.deepEqual(await readdir(box.cwd), []);
});

test('init --bots on an existing regular file fails and leaves the file alone', async (t) => {
  const box = await createSandbox(t);
  const target = box.path('bots');
  await writeFile(target, 'not a folder\n');

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes(target), `should name the path, got: ${result.stderr}`);
  assert.equal(await readFile(target, 'utf8'), 'not a folder\n');
  assert.deepEqual(await readdir(box.cwd), ['bots']);
});
