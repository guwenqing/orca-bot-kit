import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import { createSandbox, git, skipGit, snapshot } from './helpers/cli.js';

async function readYaml(file) {
  return parse(await readFile(file, 'utf8'));
}

/** Everything the contract says `init` must leave at <path>. */
async function assertSeededBotsFolder(bots) {
  assert.ok((await lstat(bots)).isDirectory(), `${bots} should be a directory`);
  assert.ok((await lstat(path.join(bots, '.git'))).isDirectory(), '.git should be a directory');

  const defaults = await readYaml(path.join(bots, 'defaults.yaml'));
  assert.deepEqual(defaults, { rules: [], skills: [] });

  const skills = await readYaml(path.join(bots, 'skills.yaml'));
  assert.deepEqual(skills, { sources: [] });

  assert.deepEqual(await readdir(path.join(bots, 'rules')), ['.gitkeep']);
  assert.deepEqual(await readdir(path.join(bots, 'skills')), ['.gitkeep']);

  const botFather = await readYaml(path.join(bots, 'bots', 'bot-father', 'bot.yaml'));
  assert.deepEqual(
    Object.keys(botFather).sort(),
    ['charter', 'name', 'rules', 'sessions', 'skills'],
  );
  assert.equal(botFather.name, 'bot-father');
  assert.equal(typeof botFather.charter, 'string');
  assert.notEqual(botFather.charter.trim(), '');
  assert.ok(Array.isArray(botFather.rules), 'bot.yaml rules should be a list');
  assert.ok(Array.isArray(botFather.skills), 'bot.yaml skills should be a list');
  assert.ok(Array.isArray(botFather.sessions), 'bot.yaml sessions should be a list');
}

test('init --bots <relative path> seeds the bots folder', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['init', '--bots', 'bots']);

  assert.equal(result.code, 0);
  assert.notEqual(result.stdout.trim(), '');
  await assertSeededBotsFolder(box.path('bots'));
});

test('init --bots <absolute path> seeds the bots folder outside the working directory', async (t) => {
  const box = await createSandbox(t);
  const bots = path.join(box.root, 'elsewhere', 'bots');

  const result = await box.run(['init', '--bots', bots]);

  assert.equal(result.code, 0);
  await assertSeededBotsFolder(bots);
});

test('init creates missing parent directories', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['init', '--bots', 'a/b/c/bots']);

  assert.equal(result.code, 0);
  await assertSeededBotsFolder(box.path('a', 'b', 'c', 'bots'));
});

test('init makes the bots folder its own git repo with no commit and an empty index', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');

  assert.equal((await box.run(['init', '--bots', 'bots'])).code, 0);

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
  const box = await createSandbox(t);

  assert.equal((await box.run(['init', '--bots', 'bots'])).code, 0);

  const tree = await snapshot(box.path('bots'), skipGit);
  for (const [rel, kind] of Object.entries(tree)) {
    assert.ok(!rel.endsWith('.js'), `no .js file expected, found ${rel}`);
    assert.notEqual(path.basename(rel), 'package.json', `no package.json expected, found ${rel}`);
    assert.notEqual(path.basename(rel), 'node_modules', `no node_modules expected, found ${rel}`);
    assert.ok(!kind.startsWith('symlink:'), `no symlink expected, found ${rel}`);
  }
});

test('init writes nothing outside the bots folder', async (t) => {
  const box = await createSandbox(t);
  const skipTarget = (rel) => rel === 'cwd/bots' || rel.startsWith('cwd/bots/');

  const before = await snapshot(box.root, skipTarget);
  assert.equal((await box.run(['init', '--bots', 'bots'])).code, 0);
  const after = await snapshot(box.root, skipTarget);

  assert.deepEqual(after, before);
});

test('init never runs orca', async (t) => {
  const box = await createSandbox(t);

  assert.equal((await box.run(['init', '--bots', 'bots'])).code, 0);

  assert.deepEqual(await box.orcaCalls(), []);
});

test('the fake orca on PATH does record calls', async (t) => {
  // Guards the test above: an empty orca log must mean "not called", not "not wired up".
  const box = await createSandbox(t);

  spawnSync('orca', ['session', 'list'], { cwd: box.cwd, env: box.env });

  assert.deepEqual(await box.orcaCalls(), ['session list']);
});
