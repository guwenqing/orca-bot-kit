import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import test from 'node:test';

import { assertCleanFailure, createSandbox, packageVersion } from './helpers/cli.js';

test('--version prints the package version and nothing else', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['--version']);

  assert.equal(result.code, 0);
  assert.equal(result.stdout, `${await packageVersion()}\n`);
  assert.equal(result.stderr, '');
});

test('--help prints usage on stdout and mentions every command and flag', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['--help']);

  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
  for (const word of ['init', 'up', '--bots', '--harness', 'claude', 'codex']) {
    assert.ok(result.stdout.includes(word), `usage should mention ${word}, got: ${result.stdout}`);
  }
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
  const help = await box.run(['--help']);

  assertCleanFailure(result);
  // The same usage --help prints, only on the other stream: an error that is
  // not the usage leaves a person who typed `obk` with nothing to go on.
  assert.equal(result.stderr, help.stdout);
});

test('an unknown command prints an error on stderr and exits 1', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['wibble']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('wibble'), `should name the command, got: ${result.stderr}`);
});

test('an unknown command does not fall through to init', async (t) => {
  // Otherwise a missing unknown-command guard hides behind the --bots checks.
  const box = await createSandbox(t);

  const result = await box.run(['wibble', '--bots', 'bots']);

  assertCleanFailure(result);
  assert.deepEqual(await readdir(box.cwd), []);
});

/**
 * The block of the usage that a command's line starts: from `  obk <command> `
 * up to the next command's line. Undefined when the usage has no such line.
 */
function usageBlock(usage, command) {
  const lines = usage.split('\n');
  const at = lines.findIndex((line) => line.startsWith(`  obk ${command} `) || line === `  obk ${command}`);
  if (at < 0) return undefined;
  const next = lines.findIndex((line, index) => index > at && line.startsWith('  obk '));
  return lines.slice(at, next < 0 ? undefined : next).join('\n');
}

test('--help lists the permission commands, --role-cap under bot change, and no permission flag under the ordinary commands (#527)', async (t) => {
  const box = await createSandbox(t);

  const { stdout: usage } = await box.run(['--help']);

  for (const command of ['permission allow', 'permission disallow', 'permission approval']) {
    assert.notEqual(usageBlock(usage, command), undefined, `usage should list obk ${command}, got:\n${usage}`);
  }
  const change = usageBlock(usage, 'bot change');
  assert.notEqual(change, undefined, 'usage still lists obk bot change');
  assert.ok(change.includes('--role-cap'), `bot change should list --role-cap, got:\n${change}`);
  for (const flag of ['--allow', '--disallow']) {
    assert.ok(!change.includes(flag), `bot change should no longer list ${flag}, got:\n${change}`);
  }
  for (const command of ['session add', 'session change']) {
    const block = usageBlock(usage, command);
    assert.notEqual(block, undefined, `usage still lists obk ${command}`);
    assert.ok(!block.includes('--approval'), `${command} should no longer list --approval, got:\n${block}`);
  }
});
