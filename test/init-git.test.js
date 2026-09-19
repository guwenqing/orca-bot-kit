// `init` depends on git. When git cannot do its part, the CLI must say so and
// leave the folder alone — never report a bots folder as ready without a
// repository in it.
//
// These two cases need a PATH the shared fixture does not build, so this file
// spawns the CLI itself. Everything else still goes through the fixture.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { assertCleanFailure, createSandbox, snapshot } from './helpers/cli.js';

/** Run `obk` as usual, but on a PATH of our own. spawnSync's shape, adapted. */
function runOnPath(box, args, PATH) {
  const done = spawnSync('obk', args, { cwd: box.cwd, encoding: 'utf8', env: { ...box.env, PATH } });
  assert.equal(done.error, undefined, 'obk itself should still be runnable');
  return { code: done.status, stdout: done.stdout, stderr: done.stderr };
}

test('init reports a git it cannot run, instead of claiming success', async (t) => {
  const box = await createSandbox(t);
  // The fixture's bin keeps `obk` reachable; node's own directory keeps the
  // shebang working. Neither holds a git, so git cannot be spawned at all.
  const withoutGit = [
    box.env.PATH.split(path.delimiter)[0],
    path.dirname(process.execPath),
  ].join(path.delimiter);
  assert.notEqual(
    spawnSync('git', ['--version'], { env: { ...box.env, PATH: withoutGit } }).error,
    undefined,
    'this test is pointless if git is still reachable',
  );

  const result = runOnPath(box, ['init', '--bots', 'bots'], withoutGit);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('git'), `should name git, got: ${result.stderr}`);
});

test('init reports a folder git cannot make a repository in, and writes nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  await mkdir(bots);
  await chmod(bots, 0o555); // git init cannot write its .git here
  const before = await snapshot(bots);

  const result = await box.run(['init', '--bots', 'bots']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes(bots), `should name the folder, got: ${result.stderr}`);
  assert.deepEqual(await snapshot(bots), before);

  await chmod(bots, 0o755); // so the fixture can clear the sandbox away
});
