import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { assertSeededBotsFolder, createSandbox, git, repoRoot, skipGit, skipOrcaFake, snapshot } from './helpers/cli.js';

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
  // The kit's code and skills stay in the installed package (ADR 0004), and a
  // link is how they would get in, so what a link points at is the check
  // rather than whether there is one. A bot's own `CLAUDE.md` -> `AGENTS.md`
  // (PRD 6.6) points at the file next to it and carries nothing of the kit's.
  //
  // A bot that carries a kit skill is given an absolute link into the installed
  // package, which is ADR 0004 working rather than kit code in the repo (PRD
  // 6.7, test/skills-build.test.js, which pins that the link is absolute).
  // `init` used to seed no skill at all, so every link it made was relative and
  // the rule below could be flat. It now seeds Bot Father with the kit's two
  // management skills, because a Bot Father with no management skill cannot be
  // asked to fix itself. So a link onto the kit's own shelf is let through, and
  // that is the only exception: it is still kept out of the bots folder's own
  // tree, anything else absolute is still refused, and every other link is held
  // to the old rule of being relative and pointing inside.
  const box = await createSandbox(t);

  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);

  const bots = box.path('bots');
  // Where the kit's own skills live inside the installed package: the one place
  // outside the bots folder that a link inside it may land.
  const shelf = path.join(repoRoot, 'skills');
  const tree = await snapshot(bots, skipGit);
  for (const [rel, kind] of Object.entries(tree)) {
    assert.ok(!rel.endsWith('.js'), `no .js file expected, found ${rel}`);
    assert.notEqual(path.basename(rel), 'package.json', `no package.json expected, found ${rel}`);
    assert.notEqual(path.basename(rel), 'node_modules', `no node_modules expected, found ${rel}`);
    if (!kind.startsWith('symlink:')) continue;

    const target = kind.slice('symlink:'.length);
    const points = path.resolve(path.dirname(path.join(bots, rel)), target);
    if (points.startsWith(`${shelf}${path.sep}`)) continue;

    assert.ok(
      !path.isAbsolute(target),
      `the bots folder is a git repo the user may clone, so a link in it should be relative unless it is onto the kit's shelf, found ${rel} -> ${target}`,
    );
    assert.ok(
      points === bots || points.startsWith(`${bots}${path.sep}`),
      `a link in the bots folder should point inside it, found ${rel} -> ${target}`,
    );
  }
});

test('init writes nothing outside the bots folder but what the kit keeps beside it', async (t) => {
  // The point of this one is where the kit is *not* allowed to write: not the home
  // directory, not the working directory, not a folder of its own somewhere else
  // on the machine. What it keeps for itself goes beside the bots folder, named
  // after it — the start prompt it hands a session, and where it says a writer
  // holds the book (PRD 6.3) — so that it is out of the user's repo and their git
  // status while staying somewhere they can see it and delete it.
  const box = await createSandbox(t);
  // What the fake Orca remembers is Orca's own state, not a write to the user's disk.
  const skipTarget = (rel) => rel === 'cwd/bots' || rel.startsWith('cwd/bots/') || skipOrcaFake(rel);

  const before = await snapshot(box.root, skipTarget);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const after = await snapshot(box.root, skipTarget);

  assert.deepEqual(
    Object.keys(before).filter((rel) => !(rel in after)),
    [],
    'nothing outside the bots folder may be taken away',
  );
  assert.deepEqual(
    Object.keys(after).filter((rel) => after[rel] !== before[rel] && !rel.startsWith('cwd/bots.')),
    [],
    'and nothing may be written outside it except beside it',
  );
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
