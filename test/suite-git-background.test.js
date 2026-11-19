// The suite's own git calls start no background git work (#526).
//
// After a commit, git starts `git maintenance run --auto --detach`. That
// process goes to the background, and it can repack the repository after the
// commit has returned. A local `git clone` of that repository, made at the same
// moment, then copies files git is writing or removing, and fails: "hardlink
// different from source" failed the 0.25.4 publish run. The fix is that the
// helpers in test/helpers/ start no git work that goes on after their call has
// returned.
//
// Waiting for the clone to fail is a race: it failed 2 runs in 20. So these
// tests look at what git itself records instead. Each test runs the helpers in
// a child process with GIT_TRACE2_EVENT set, and every git process then writes
// its events into one file. Two of those events show a process that went to the
// background, and both are written whatever the timing:
//
//   - `git maintenance run --detach` enters the trace2 region "detach" just
//     before it forks into the background;
//   - a process that forks and lets its parent half exit writes its `exit`
//     event twice: once from each half.
//
// And so the tests do not depend on whether this git has work to do after a
// small commit, most of them use a repository whose own config makes the
// auto-maintenance repack it on every commit. The control at the top shows
// that this config really does that.
//
// A test that caused background work waits for it to end, so that no git
// process of a test still runs when its folder is removed.
//
// The kit's own git calls (src/) are not the subject, and
// nothing here asserts on them.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { node, repoRoot } from './helpers/cli.js';

const cliHelpers = pathToFileURL(path.join(repoRoot, 'test', 'helpers', 'cli.js')).href;
const sourceHelpers = pathToFileURL(path.join(repoRoot, 'test', 'helpers', 'sources.js')).href;

const HELPERS_TIMEOUT_MS = 60_000;
/** How long git's background work, when there is some, may take to end. */
const AT_REST_TIMEOUT_MS = 60_000;

/** About as many files as the commit before the clone that failed in the issue. */
const FILES = 300;

/**
 * A repository config that makes `git maintenance run --auto` repack the
 * repository on every commit: the geometric strategy, and its repack task
 * forced by a negative `auto` (see `git help git-config`). Nothing in it says
 * where the maintenance runs, so git's default, the background, holds.
 */
const REPACK_ON_EVERY_COMMIT = '[maintenance]\n\tstrategy = geometric\n[maintenance "geometric-repack"]\n\tauto = -1\n';

/**
 * A throwaway folder for one test, gone when it ends. Before it goes, wait for
 * git's work in it to end, also when the test failed before its own wait: a
 * detached maintenance must not be left to run in a folder that is removed.
 * The wait does not throw here, so the test's own failure stays the one shown.
 */
async function scratch(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-gitbg-')));
  t.after(async () => {
    const repos = [path.join(root, 'source'), path.join(root, 'clone')];
    try {
      await untilGitAtRest(path.join(root, 'trace2.json'), repos);
    } catch (error) {
      t.diagnostic(`cleanup: ${error.message}`);
    }
    await rm(root, { recursive: true, force: true });
  });
  const home = path.join(root, 'home');
  await mkdir(home);
  return { root, home, trace: path.join(root, 'trace2.json') };
}

/**
 * The environment a developer's shell hands the suite, with a home of the
 * test's own and none of git's config or trace variables in it, and git's
 * event trace sent to `trace`.
 */
function tracedEnv(home, trace) {
  const rest = Object.fromEntries(Object.entries(process.env).filter(([name]) => (
    name !== 'NODE_TEST_CONTEXT' && name !== 'XDG_CONFIG_HOME' && !name.startsWith('GIT_')
  )));
  return { ...rest, HOME: home, GIT_TRACE2_EVENT: trace };
}

/** A git that reads no config at all and traces nothing, for the control and for reading back. */
function plainGit(args, cwd, home, extra = {}) {
  const done = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...extra },
  });
  assert.equal(done.status, 0, `git ${args.join(' ')} in ${cwd} should work: ${done.stderr}`);
  return done.stdout.trim();
}

/** Every file under a repository's .git, with its size and time, sorted. */
async function gitDirState(repo) {
  const gitDir = path.join(repo, '.git');
  const entries = await readdir(gitDir, { recursive: true, withFileTypes: true });
  const lines = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    const info = await stat(file);
    lines.push(`${path.relative(gitDir, file)} ${info.size} ${info.mtimeMs}`);
  }
  return lines.sort();
}

/**
 * Run the helpers in a child with git's event trace on. The child makes a repo
 * with `repoAt`, gives it `config` as its own, writes FILES files and commits
 * them the way `how` says. With `clone`, it then clones the repo through
 * `gitOk`. Right after the last helper call returns, it records the state of
 * the source's .git. Answers the child's result.
 */
async function runHelpers({ root, home, trace }, { config = '', how = 'commitIn', clone = false }) {
  const script = `
    import { appendFile, readdir, stat, writeFile } from 'node:fs/promises';
    import path from 'node:path';
    import { git } from ${JSON.stringify(cliHelpers)};
    import { commitIn, gitOk, repoAt } from ${JSON.stringify(sourceHelpers)};
    const root = ${JSON.stringify(root)};
    const dir = path.join(root, 'source');
    await repoAt(dir);
    await appendFile(path.join(dir, '.git', 'config'), ${JSON.stringify(config)});
    for (let i = 0; i < ${FILES}; i += 1) await writeFile(path.join(dir, 'file-' + i + '.md'), 'file ' + i + '\\n');
    let sha;
    if (${JSON.stringify(how)} === 'commitIn') {
      sha = await commitIn(dir, 'many files');
    } else {
      await gitOk(['add', '-A'], dir);
      const made = await git(['-c', 'user.name=A Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'many files'], dir);
      if (made.code !== 0) throw new Error('git commit through git() failed: ' + made.stderr);
      sha = await gitOk(['rev-parse', 'HEAD'], dir);
    }
    if (${JSON.stringify(clone)}) await gitOk(['clone', dir, path.join(root, 'clone')], root);
    // The source as it is the moment the last helper call has returned.
    const gitDir = path.join(dir, '.git');
    const state = [];
    for (const entry of await readdir(gitDir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = path.join(entry.parentPath, entry.name);
      const info = await stat(file);
      state.push(path.relative(gitDir, file) + ' ' + info.size + ' ' + info.mtimeMs);
    }
    process.stdout.write(JSON.stringify({ sha, state: state.sort() }));
  `;
  const result = await node(['--input-type=module', '-e', script], {
    cwd: repoRoot, env: tracedEnv(home, trace), timeout: HELPERS_TIMEOUT_MS,
  });
  assert.equal(result.signal, null, `the helpers should finish, not be killed: ${result.stderr}`);
  assert.equal(result.code, 0, `the helpers should work: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

/** The trace's events. A line still being written by a running git is left out. */
async function traceEvents(trace) {
  const text = existsSync(trace) ? await readFile(trace, 'utf8') : '';
  const events = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { /* a line not finished yet */ }
  }
  return events;
}

/** What the trace says about each git process, by its trace2 session id. */
function processes(events) {
  const bySid = new Map();
  for (const event of events) {
    if (!bySid.has(event.sid)) {
      // A child's session id is its parent's, a slash, and its own.
      const parent = event.sid.includes('/') ? event.sid.slice(0, event.sid.lastIndexOf('/')) : null;
      bySid.set(event.sid, { parent, argv: [], starts: 0, exits: 0, failed: false, children: 0, childExits: 0, detached: false });
    }
    const proc = bySid.get(event.sid);
    if (event.event === 'start') { proc.starts += 1; proc.argv = event.argv; }
    if (event.event === 'exit') { proc.exits += 1; if (event.code !== 0) proc.failed = true; }
    if (event.event === 'child_start') proc.children += 1;
    if (event.event === 'child_exit') proc.childExits += 1;
    if (event.event === 'region_enter' && event.label === 'detach') proc.detached = true;
  }
  return bySid;
}

/**
 * Wait until no git process the helpers started still runs: every process in
 * the trace has exited, a process that detached has exited from both halves,
 * every child was waited for, and no repository is locked for maintenance.
 * A test that caused background work leaves none running behind it this way.
 *
 * A git that fails stops without waiting for its children, and a child it
 * leaves (the upload-pack of a failed clone) may write no exit at all. Neither
 * is waited for: they are not background work, and they write nothing.
 */
async function untilGitAtRest(trace, repos) {
  const deadline = Date.now() + AT_REST_TIMEOUT_MS;
  for (;;) {
    const bySid = processes(await traceEvents(trace));
    const parentFailed = (proc) => Boolean(proc.parent && bySid.get(proc.parent)?.failed);
    const running = [...bySid.values()].filter((proc) => (proc.detached
      ? proc.exits < 2
      : (proc.exits === 0 && !parentFailed(proc)) || (proc.childExits < proc.children && !proc.failed)));
    const locked = repos.filter((repo) => existsSync(path.join(repo, '.git', 'objects', 'maintenance.lock')));
    if (running.length === 0 && locked.length === 0) return;
    if (Date.now() > deadline) {
      assert.fail(`git's work did not end within ${AT_REST_TIMEOUT_MS} ms: ${running.map((proc) => proc.argv.join(' ')).join('; ')} ${locked.join(' ')}`);
    }
    await delay(50);
  }
}

/** The git processes in the trace that went to the background, by their command line. */
function backgroundProcesses(events) {
  return [...processes(events).values()]
    .filter((proc) => proc.detached || proc.exits > 1)
    .map((proc) => proc.argv.slice(1).join(' '));
}

/** The commands git ran, by name, as the trace records them. */
const commandsIn = (events) => events.filter((event) => event.event === 'cmd_name').map((event) => event.name);

// The control: with git's own defaults for where maintenance runs, the config
// above makes a commit repack the repository. Run here in the foreground, so
// the repack is done when the commit returns and nothing is left running. A
// test below that passes does so because the helpers start no such work, not
// because this git ignores the config.
test('a repository whose own config asks for it is repacked by the maintenance a commit starts', async (t) => {
  const box = await scratch(t);
  const dir = path.join(box.root, 'source');
  await mkdir(dir);
  plainGit(['init', '--initial-branch=main'], dir, box.home);
  await appendFile(path.join(dir, '.git', 'config'), REPACK_ON_EVERY_COMMIT);
  for (let i = 0; i < FILES; i += 1) await writeFile(path.join(dir, `file-${i}.md`), `file ${i}\n`);
  plainGit(['add', '-A'], dir, box.home);

  plainGit(['-c', 'user.name=A Test', '-c', 'user.email=test@example.invalid', '-c', 'maintenance.autoDetach=false',
    'commit', '-m', 'many files'], dir, box.home);

  const packs = (await readdir(path.join(dir, '.git', 'objects', 'pack'))).filter((name) => name.endsWith('.pack'));
  assert.ok(packs.length > 0, 'the maintenance should have written a pack');
  const loose = (await readdir(path.join(dir, '.git', 'objects'))).filter((name) => /^[0-9a-f]{2}$/.test(name));
  assert.deepEqual(loose, [], 'the maintenance should have packed the loose objects');
});

// Criterion 1: a commit through the helpers, either way they make one, in a
// repository with no config of its own and in one that asks for a repack on
// every commit, starts no git process that goes on in the background.
const COMMITS = [
  { how: 'commitIn', through: 'commitIn' },
  { how: 'git', through: 'git() with commit' },
];
const REPOS = [
  { config: '', kind: 'a repository with no git config of its own' },
  { config: REPACK_ON_EVERY_COMMIT, kind: 'a repository whose own config asks for a repack on every commit' },
];

for (const commit of COMMITS) {
  for (const repo of REPOS) {
    test(`a commit through ${commit.through} in ${repo.kind} starts no git work in the background`, async (t) => {
      const box = await scratch(t);
      const source = path.join(box.root, 'source');

      await runHelpers(box, { config: repo.config, how: commit.how });
      await untilGitAtRest(box.trace, [source]);

      const events = await traceEvents(box.trace);
      // The trace saw the commit, so an empty list below means something.
      assert.ok(commandsIn(events).includes('commit'), `the trace should record the commit: ${commandsIn(events).join(', ')}`);
      assert.deepEqual(backgroundProcesses(events), [], 'no git process the commit started should go to the background');
    });
  }
}

// Criterion 2: the run that failed in the issue, a commit and then a local
// clone of the same repository, both through the helpers. Nothing git started
// for them goes on after they return, so nothing writes into the source while
// a clone could be copying it, and the source is the same afterwards as at the
// moment the clone returned.
test('after a commit and a local clone through the helpers, git writes nothing more into the source', async (t) => {
  const box = await scratch(t);
  const source = path.join(box.root, 'source');
  const clone = path.join(box.root, 'clone');

  const said = await runHelpers(box, { config: REPACK_ON_EVERY_COMMIT, how: 'commitIn', clone: true });
  await untilGitAtRest(box.trace, [source, clone]);

  const events = await traceEvents(box.trace);
  assert.ok(commandsIn(events).includes('commit') && commandsIn(events).includes('clone'),
    `the trace should record the commit and the clone: ${commandsIn(events).join(', ')}`);
  assert.deepEqual(backgroundProcesses(events), [], 'no git process the helpers started should go to the background');
  assert.deepEqual(await gitDirState(source), said.state, 'the source should not change after the helpers returned');
  assert.equal(plainGit(['rev-parse', 'HEAD'], clone, box.home), said.sha, 'the clone should hold the commit');
});
