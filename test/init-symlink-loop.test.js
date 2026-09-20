// Links that point at each other have no end: the kit cannot look at what is
// there, and the system says so as ELOOP and the name of a call the user never
// made. That is not an answer anybody can act on. `init` says which path is the
// loop and that it is one, and refuses without writing anything.

import assert from 'node:assert/strict';
import { rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { assertCleanFailure, createSandbox, skipOrcaFake, snapshot } from './helpers/cli.js';

/** Two links pointing at each other: following either one comes back to it. */
async function symlinkLoop(first, second) {
  await symlink(second, first);
  await symlink(first, second);
}

/** A refusal over a loop: exit 1, the path named, the word loop, and no errno leaked. */
function assertLoopRefused(result, loop) {
  assertCleanFailure(result);
  assert.ok(result.stderr.includes(loop), `stderr should name ${loop}, got: ${result.stderr}`);
  assert.match(result.stderr, /loop/i, `the reader should be told it is a loop, got: ${result.stderr}`);

  // The whole point of the issue: none of what the system said gets through.
  for (const noise of [/\bELOOP\b/, /too many symbolic links/i, /stat '/]) {
    assert.ok(!noise.test(result.stderr), `should not leak the system error (${noise}): ${result.stderr}`);
  }

  // The two neighbouring refusals, neither of which is true of a loop: the
  // links are all there, and nothing of the wrong kind is sitting in the way.
  assert.ok(!/points nowhere/i.test(result.stderr), `a loop is not a link to nowhere: ${result.stderr}`);
  assert.ok(!/in the way/i.test(result.stderr), `a loop is not something in the way: ${result.stderr}`);
}

test('a --bots path that is a symlink loop is refused as a loop, and nothing is written', async (t) => {
  const box = await createSandbox(t);
  await symlinkLoop(box.path('loop-a'), box.path('loop-b'));
  // The fake Orca's own record of being asked is not a write to the user's disk.
  const before = await snapshot(box.root, skipOrcaFake);

  const result = await box.run(['init', '--bots', 'loop-a', '--harness', 'claude']);

  assertLoopRefused(result, box.path('loop-a'));
  assert.deepEqual(await snapshot(box.root, skipOrcaFake), before, 'a refusal writes nothing at all');
});

test('a path that fails for another reason is not called a symlink loop', async (t) => {
  // A loop message that is printed whatever went wrong tells the user nothing.
  // A path underneath a regular file is the other way a look at a path fails
  // outright; what that message should say instead is not this issue's business.
  const box = await createSandbox(t);
  await writeFile(box.path('notes.md'), 'mine\n');

  const result = await box.run(['init', '--bots', 'notes.md/sub', '--harness', 'claude']);

  assertCleanFailure(result);
  assert.ok(!/loop/i.test(result.stderr), `nothing here runs in a circle: ${result.stderr}`);
});

test('a symlink loop inside a seeded bots folder is refused as a loop, and nothing is changed', async (t) => {
  // The loop is not at the path the user names but at one of the entries `init`
  // looks at inside it, on a folder it seeded itself and would otherwise walk
  // straight through.
  const box = await createSandbox(t);
  const bots = box.path('bots');
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);

  const inside = path.join(bots, 'bots');
  await rm(inside, { recursive: true });
  await symlinkLoop(inside, path.join(bots, 'loop-b'));
  const before = await snapshot(box.root, skipOrcaFake);

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assertLoopRefused(result, inside);
  assert.deepEqual(await snapshot(box.root, skipOrcaFake), before, 'a refusal writes nothing at all');
});
