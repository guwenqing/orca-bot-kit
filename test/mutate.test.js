// `scripts/mutate.js` runs the mutation check on what this branch changed.
//
// Every test gets its own throwaway git repo shaped like this one — a `main`
// branch, a copy of the script under `scripts/`, and a branch off main — and
// runs the script there. `stryker` on PATH is a fake that only logs the
// arguments it was given, so no test ever starts a real mutation run.

import assert from 'node:assert/strict';
import { copyFile, cp, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';

import { assertCleanFailure, createSandbox, fakeProgram, git, node, repoRoot } from './helpers/cli.js';

const scriptEntry = path.join(repoRoot, 'scripts', 'mutate.js');

/** Run git and fail the test loudly if the fixture itself is broken. */
async function gitOk(args, cwd) {
  const result = await git(args, cwd);
  assert.equal(result.code, 0, `fixture: git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

/** Stage everything in `repo` and commit it, whatever the machine's git identity is. */
async function commitAll(repo, message) {
  await gitOk(['add', '-A'], repo);
  await gitOk([
    '-c', 'user.name=Test', '-c', 'user.email=test@example.com',
    'commit', '--no-gpg-sign', '-q', '-m', message,
  ], repo);
}

async function write(dir, rel, text) {
  const file = path.join(dir, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

/**
 * The repo every test starts from: a `main` branch holding the script and a
 * few files to change, and a `feature` branch off it with nothing changed yet.
 * Built once and copied per test, because spawning git is the slow part here.
 */
async function createBaseRepo() {
  const repo = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-mutate-base-')));

  // This repo's own git config may default to any branch name, so name main here.
  await gitOk(['init', '-q', '-b', 'main'], repo);

  await mkdir(path.join(repo, 'scripts'));
  await copyFile(scriptEntry, path.join(repo, 'scripts', 'mutate.js'));
  await write(repo, 'scripts/tool.js', 'export const tool = 1;\n');
  await write(repo, 'src/one.js', 'export const one = 1;\n');
  await write(repo, 'src/two.js', 'export const two = 2;\n');
  await write(repo, 'src/data.json', '{"n": 1}\n');
  await write(repo, 'test/one.test.js', '// a test\n');
  await write(repo, 'docs/notes.md', 'notes\n');
  await write(repo, 'package.json', '{"name": "fixture", "type": "module"}\n');

  await commitAll(repo, 'base');
  await gitOk(['checkout', '-q', '-b', 'feature'], repo);
  return repo;
}

const baseRepo = await createBaseRepo();
after(() => rm(baseRepo, { recursive: true, force: true }));

/** The arguments of each call to a fake program, when the rest of the call does not matter. */
const argsOf = (calls) => calls.map((call) => call.args);

/** Whether a path is there at all. */
async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * A fresh copy of the base repo, with a fake `stryker` first on PATH.
 * `stryker` is passed on to the fake: how it exits and what it prints.
 * Returns the repo path, the fake, and the ways to change and run it.
 */
async function createRepoOnBranch(t, { stryker: strykerOptions = {} } = {}) {
  const box = await createSandbox(t);
  const stryker = await fakeProgram(box, 'stryker', strykerOptions);
  const repo = path.join(box.root, 'repo');
  await cp(baseRepo, repo, { recursive: true });

  // An environment with no program at all on PATH, for proving what the script
  // says when one it needs is missing.
  const emptyBin = path.join(box.root, 'empty-bin');
  await mkdir(emptyBin);

  return {
    repo,
    stryker,
    /** The environment the script is run with: the sandbox's bin first on PATH. */
    env: box.env,
    /** The same environment, with nothing on PATH. */
    envWithoutPrograms: { ...box.env, PATH: emptyBin },
    /** Change a file in the working tree. */
    edit: (rel, text) => write(repo, rel, text),
    /** Stage everything and commit it. */
    commit: (message) => commitAll(repo, message),
    git: (args) => gitOk(args, repo),
    /** Run `node scripts/mutate.js <args>` from the repo (or `options.cwd`, with `options.env`). */
    run: (args = [], options = {}) => node(
      [path.join(repo, 'scripts', 'mutate.js'), ...args],
      { cwd: options.cwd ?? repo, env: options.env ?? box.env },
    ),
    /** The sandbox directory outside the repo, for running from elsewhere. */
    outside: box.cwd,
  };
}

// Each test owns a throwaway repo, so they can all run at the same time.
describe('mutate', { concurrency: true }, () => {
  test('the mutation check is wired up as `npm run mutate`', async () => {
    const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));

    assert.match(pkg.scripts.mutate ?? '', /scripts\/mutate\.js/);
  });

  test('a file changed by a commit on the branch is mutated', async (t) => {
    const fixture = await createRepoOnBranch(t);
    await fixture.edit('src/one.js', 'export const one = 11;\n');
    await fixture.commit('change one');

    const result = await fixture.run();

    assert.equal(result.code, 0);
    assert.deepEqual(argsOf(await fixture.stryker.calls()), [['run', '--mutate', 'src/one.js']]);
  });

  test('a file changed in the working tree but not committed is mutated', async (t) => {
    const fixture = await createRepoOnBranch(t);
    await fixture.edit('src/two.js', 'export const two = 22;\n');

    await fixture.run();

    assert.deepEqual(argsOf(await fixture.stryker.calls()), [['run', '--mutate', 'src/two.js']]);
  });

  test('a new untracked file is mutated', async (t) => {
    const fixture = await createRepoOnBranch(t);
    await fixture.edit('src/new.js', 'export const fresh = 3;\n');

    await fixture.run();

    assert.deepEqual(argsOf(await fixture.stryker.calls()), [['run', '--mutate', 'src/new.js']]);
  });

  test('only JavaScript under the repo\'s own src/ and scripts/ is mutated', async (t) => {
    const fixture = await createRepoOnBranch(t);
    await fixture.edit('scripts/tool.js', 'export const tool = 2;\n');
    await fixture.edit('src/data.json', '{"n": 2}\n');
    await fixture.edit('test/one.test.js', '// a changed test\n');
    await fixture.edit('docs/notes.md', 'more notes\n');
    await fixture.edit('package.json', '{"name": "fixture", "type": "module", "version": "0.0.1"}\n');
    // src/ and scripts/ are the ones at the top of the repo, not any folder so named.
    await fixture.edit('test/src/deep.js', 'export const deep = 1;\n');
    await fixture.edit('docs/scripts/sample.js', 'export const sample = 1;\n');
    await fixture.commit('change everything else too');

    await fixture.run();

    assert.deepEqual(argsOf(await fixture.stryker.calls()), [['run', '--mutate', 'scripts/tool.js']]);
  });

  test('a file deleted on the branch is not mutated', async (t) => {
    const fixture = await createRepoOnBranch(t);
    await fixture.git(['rm', '-q', 'src/two.js']);
    await fixture.edit('src/one.js', 'export const one = 11;\n');
    await fixture.commit('drop two, change one');

    await fixture.run();

    assert.deepEqual(argsOf(await fixture.stryker.calls()), [['run', '--mutate', 'src/one.js']]);
  });

  test('a file renamed on the branch is mutated under its new name only', async (t) => {
    const fixture = await createRepoOnBranch(t);
    await fixture.git(['mv', 'src/two.js', 'src/renamed.js']);
    await fixture.commit('rename two');

    await fixture.run();

    assert.deepEqual(argsOf(await fixture.stryker.calls()), [['run', '--mutate', 'src/renamed.js']]);
  });

  test('a file changed on main after the branch started is not mutated', async (t) => {
    const fixture = await createRepoOnBranch(t);
    await fixture.git(['checkout', '-q', 'main']);
    await fixture.edit('src/two.js', 'export const two = 22;\n');
    await fixture.commit('main moves on');
    await fixture.git(['checkout', '-q', 'feature']);
    await fixture.edit('src/one.js', 'export const one = 11;\n');
    await fixture.commit('change one');

    await fixture.run();

    assert.deepEqual(argsOf(await fixture.stryker.calls()), [['run', '--mutate', 'src/one.js']]);
  });

  test('the targets are one sorted comma-separated list with no duplicates', async (t) => {
    const fixture = await createRepoOnBranch(t);
    await fixture.edit('src/two.js', 'export const two = 22;\n');
    await fixture.commit('change two');
    await fixture.edit('src/two.js', 'export const two = 222;\n');
    await fixture.git(['add', 'src/two.js']);
    await fixture.edit('src/two.js', 'export const two = 2222;\n');
    await fixture.edit('src/three.js', 'export const three = 3;\n');
    await fixture.edit('scripts/tool.js', 'export const tool = 2;\n');

    await fixture.run();

    assert.deepEqual(
      argsOf(await fixture.stryker.calls()),
      [['run', '--mutate', 'scripts/tool.js,src/three.js,src/two.js']],
    );
  });

  test('nothing relevant changed: it says so, exits 0 and does not run stryker', async (t) => {
    const fixture = await createRepoOnBranch(t);
    await fixture.edit('docs/notes.md', 'more notes\n');
    await fixture.commit('docs only');

    const result = await fixture.run();

    assert.equal(result.code, 0);
    assert.match(result.stdout, /nothing/i);
    assert.deepEqual(argsOf(await fixture.stryker.calls()), []);
  });

  test('arguments replace the changed files as the targets', async (t) => {
    const fixture = await createRepoOnBranch(t);
    await fixture.edit('src/one.js', 'export const one = 11;\n');

    await fixture.run(['src/two.js']);

    assert.deepEqual(argsOf(await fixture.stryker.calls()), [['run', '--mutate', 'src/two.js']]);
  });

  test('several arguments are passed through in the order given', async (t) => {
    const fixture = await createRepoOnBranch(t);

    await fixture.run(['src/**/*.js', 'scripts/tool.js']);

    assert.deepEqual(
      argsOf(await fixture.stryker.calls()),
      [['run', '--mutate', 'src/**/*.js,scripts/tool.js']],
    );
  });

  test('the exit code is stryker\'s exit code', async (t) => {
    const fixture = await createRepoOnBranch(t, { stryker: { exitCode: 3 } });
    await fixture.edit('src/one.js', 'export const one = 11;\n');

    const result = await fixture.run();

    assert.equal(result.code, 3);
  });

  test('it works on the repo the script lives in, whatever the working directory', async (t) => {
    const fixture = await createRepoOnBranch(t);
    await fixture.edit('src/one.js', 'export const one = 11;\n');

    await fixture.run([], { cwd: fixture.outside });

    assert.deepEqual(argsOf(await fixture.stryker.calls()), [['run', '--mutate', 'src/one.js']]);
  });

  test('stryker is run in the repo, whatever the working directory', async (t) => {
    // Anywhere else it would read someone else's config, or none at all.
    const fixture = await createRepoOnBranch(t);
    await fixture.edit('src/one.js', 'export const one = 11;\n');

    await fixture.run([], { cwd: fixture.outside });

    const calls = await fixture.stryker.calls();
    assert.deepEqual(calls.map((call) => call.cwd), [fixture.repo]);
  });

  test('stryker is given a cache file for the suite runs to share', async (t) => {
    // The suite runs once per mutant, each in a process of its own; that file
    // is the only way one run can tell the next what it learned. Stryker runs
    // them from a sandbox copy of the repo, where a relative path would name
    // another file, or none at all.
    const fixture = await createRepoOnBranch(t);
    await fixture.edit('src/one.js', 'export const one = 11;\n');

    await fixture.run();

    const [call] = await fixture.stryker.calls();
    const cache = call.env.OBK_MUTATION_CACHE;
    assert.ok(cache, 'stryker should be given OBK_MUTATION_CACHE');
    assert.ok(path.isAbsolute(cache), `the cache path should be absolute, got: ${cache}`);
  });

  test('the cache file is not left behind when the run is over', async (t) => {
    // It is scratch for one run, and nothing reads it afterwards.
    const fixture = await createRepoOnBranch(t, {
      stryker: { createsFileNamedBy: 'OBK_MUTATION_CACHE' },
    });
    await fixture.edit('src/one.js', 'export const one = 11;\n');

    await fixture.run();

    const [call] = await fixture.stryker.calls();
    const cache = call.env.OBK_MUTATION_CACHE;
    // Without a path there is no file to find, and the check would say nothing.
    assert.ok(cache, 'stryker should be given OBK_MUTATION_CACHE');
    assert.equal(await exists(cache), false, `${cache} was left behind`);
  });

  test('stryker\'s report reaches the developer on both streams', async (t) => {
    const fixture = await createRepoOnBranch(t, {
      stryker: { stdout: 'mutation score 100%\n', stderr: 'a warning from stryker\n' },
    });
    await fixture.edit('src/one.js', 'export const one = 11;\n');

    const result = await fixture.run();

    assert.match(result.stdout, /mutation score 100%/);
    assert.match(result.stderr, /a warning from stryker/);
  });

  test('without a main branch it fails cleanly and does not run stryker', async (t) => {
    const fixture = await createRepoOnBranch(t);
    await fixture.edit('src/one.js', 'export const one = 11;\n');
    await fixture.git(['branch', '-D', 'main']);

    const result = await fixture.run();

    assertCleanFailure(result);
    assert.deepEqual(argsOf(await fixture.stryker.calls()), []);
  });

  test('when git fails, the message names the command and repeats what git said', async (t) => {
    const fixture = await createRepoOnBranch(t);
    await fixture.git(['branch', '-D', 'main']);

    const result = await fixture.run();

    assert.match(result.stderr, /merge-base main HEAD/);
    assert.match(result.stderr, /fatal/);
    // git's complaint ends in a newline of its own: one line out, not two.
    assert.match(result.stderr, /^[^\n]+\n$/);
  });

  test('with no git to run, the message says why git did not run', async (t) => {
    const fixture = await createRepoOnBranch(t);
    await fixture.edit('src/one.js', 'export const one = 11;\n');

    const result = await fixture.run([], { env: fixture.envWithoutPrograms });

    assertCleanFailure(result);
    assert.match(result.stderr, /ENOENT/);
    assert.deepEqual(argsOf(await fixture.stryker.calls()), []);
  });

  test('with no stryker to run, the message says how to run the check properly', async (t) => {
    // Named targets, so the run reaches stryker without needing git.
    const fixture = await createRepoOnBranch(t);

    const result = await fixture.run(['src/one.js'], { env: fixture.envWithoutPrograms });

    assertCleanFailure(result);
    assert.match(result.stderr, /npm run mutate/);
  });

  test('outside a git repository it fails cleanly and does not run stryker', async (t) => {
    const box = await createSandbox(t);
    const stryker = await fakeProgram(box, 'stryker');
    const loose = path.join(box.cwd, 'scripts', 'mutate.js');
    await mkdir(path.dirname(loose), { recursive: true });
    await copyFile(scriptEntry, loose);

    const result = await node([loose], { cwd: box.cwd, env: box.env });

    assertCleanFailure(result);
    assert.deepEqual(argsOf(await stryker.calls()), []);
  });
});
