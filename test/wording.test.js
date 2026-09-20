// Two rules about the word "worktree", and one about git.
//
// Orca's CLI and UI call every workspace a "worktree". `obk` must not: the
// owner reads its output, and seeing "worktree" told him the kit had made a git
// worktree of his bots repo. In everything `obk` prints it is an "Orca project"
// or a "folder workspace". The word may appear only inside the `path:<...>`
// selector the kit hands Orca on the command line.
//
// And the rule underneath the wording: the kit makes no git worktree, ever, and
// leaves no bot folder registered as a git-kind repo.

import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createSandbox, git, orcaCommand } from './helpers/cli.js';

/** Nothing a person reads may carry Orca's word for a workspace. */
function assertNoWorktreeWord(label, text) {
  assert.ok(
    !/worktree/i.test(text),
    `${label} says "worktree"; obk says "Orca project" or "folder workspace": ${text}`,
  );
}

test('the usage and the help say nothing about worktrees', async (t) => {
  const box = await createSandbox(t);

  const help = await box.run(['--help']);
  const bare = await box.run([]);

  assertNoWorktreeWord('--help', help.stdout);
  assertNoWorktreeWord('the usage on stderr', bare.stderr);
});

test('a run that does the work says nothing about worktrees', async (t) => {
  const box = await createSandbox(t);

  const init = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  const up = await box.run(['up', '--bots', 'bots']);
  const asJson = await box.run(['up', '--bots', 'bots', '--json']);

  assert.equal(init.code, 0, init.stderr);
  assertNoWorktreeWord('init', init.stdout + init.stderr);
  assertNoWorktreeWord('up', up.stdout + up.stderr);
  assertNoWorktreeWord('up --json', asJson.stdout + asJson.stderr);
});

test('the messages of a run that fails say nothing about worktrees', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  await mkdir(bots, { recursive: true });
  await writeFile(path.join(bots, 'notes.md'), 'mine\n');

  const noHarness = await box.run(['init', '--bots', 'bots']);
  const neverInited = await box.run(['up', '--bots', 'bots']);
  await box.orca.set({ fail: { 'repo add': { code: 'runtime_error', message: 'Not a valid git repository' } } });
  const orcaRefused = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  await box.orca.set({ fail: {}, reachable: false });
  const orcaDown = await box.run(['up', '--bots', 'bots']);

  for (const [label, result] of [
    ['a missing --harness', noHarness],
    ['up on a folder init never made', neverInited],
    ['an Orca call that failed', orcaRefused],
    ['Orca being out', orcaDown],
  ]) {
    assert.equal(result.code, 1, `${label} should have failed`);
    assertNoWorktreeWord(label, result.stdout + result.stderr);
  }
});

test('the only worktree the kit ever names is the one in the Orca selector', async (t) => {
  const box = await createSandbox(t);

  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);

  for (const call of await box.orca.calls()) {
    // `orca worktree create` is never called; the flag `--worktree path:<p>` is
    // how Orca is told which workspace, and that is all.
    assert.notEqual(orcaCommand(call).split(' ')[0], 'worktree', `orca ${call.args.join(' ')}`);
    for (const arg of call.args) {
      if (arg === '--worktree' || arg.startsWith('path:')) continue;
      assert.ok(!/worktree/i.test(arg), `orca ${call.args.join(' ')}: "worktree" belongs to the selector alone`);
    }
  }
});

test('the bots repo has no git worktree but its own', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');

  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);

  const listed = await git(['worktree', 'list', '--porcelain'], bots);
  assert.equal(listed.code, 0, listed.stderr);
  const roots = listed.stdout.split('\n').filter((line) => line.startsWith('worktree '));
  assert.deepEqual(roots, [`worktree ${bots}`], 'the repo itself, and nothing added beside it');
});

test('Bot Father is left registered as a folder, never as a git repo', async (t) => {
  const box = await createSandbox(t);

  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);

  assert.deepEqual(
    (await box.orca.setups()).map((setup) => setup.kind),
    ['folder'],
    'a git-kind registration of a folder inside a git repo has no workspace to open a tab in',
  );
});
