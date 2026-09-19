import assert from 'node:assert/strict';
import test from 'node:test';

import { assertCleanFailure, createSandbox, packageVersion } from './helpers/cli.js';

test('--version prints the package version and nothing else', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['--version']);

  assert.equal(result.code, 0);
  assert.equal(result.stdout, `${await packageVersion()}\n`);
  assert.equal(result.stderr, '');
});

test('--help prints usage on stdout and mentions init', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['--help']);

  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
  assert.ok(result.stdout.includes('init'), `usage should mention init, got: ${result.stdout}`);
});

test('-h prints the same usage as --help', async (t) => {
  const box = await createSandbox(t);

  const short = await box.run(['-h']);
  const long = await box.run(['--help']);

  assert.equal(short.code, 0);
  assert.equal(short.stdout, long.stdout);
  assert.equal(short.stderr, '');
});

test('no arguments prints usage on stderr and exits 1', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run([]);

  assertCleanFailure(result);
});

test('an unknown command prints an error on stderr and exits 1', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['wibble']);

  assertCleanFailure(result);
});
