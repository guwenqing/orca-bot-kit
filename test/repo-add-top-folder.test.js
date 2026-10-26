// A bot's Orca project is at the bot's home, on an Orca that registers a git
// repo's top folder (#712).
//
// Orca 1.4.240 changed `orca repo add --path <folder>`: for a folder inside a
// git repo it registers the repo's top folder, not the folder it was given.
// A bot home is always inside the bots folder, which `obk init` makes a git
// repo. So `init`, and `up` of a new bot, registered the bots folder itself,
// and then found no worktree at the bot home (`selector_not_found`).
//
// The contract, from the issue:
//
//   C1  On that Orca, `init` and `up` of a new bot leave exactly one Orca
//       project for the bot: at the bot home, kind `folder`, the bot's title.
//       Nothing at the bots folder or anywhere else. The run succeeds.
//   C2  After a run, the bot home holds no `.git` the kit made, whether the
//       run succeeded or Orca refused or failed a call.
//   C3  A `.git` that was in the bot home before the run (the user's own) is
//       not removed or changed, on success or on failure.
//   C4  A run killed while `repo add` is in progress leaves what it leaves.
//       The next run removes a `.git` the dead run made in the bot home, and
//       ends with one folder project at the bot home. A user's own `.git`
//       still stays.
//   C5  An Orca that registers the folder as given (before 1.4.240) works as
//       before.
//
// How it is tested: the fake Orca registers the top folder by default, as
// Orca 1.4.240 does; `repoAddAsGiven: true` makes it the older Orca. Its
// `hold` keeps one `repo add` in progress until the test lets it go, so the
// test can kill `obk` there (helpers/fake-orca.js).

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { botHomeOf, createSandbox, git, orcaCallsOf, orcaFlag, snapshot } from './helpers/cli.js';

const BOT = 'api-bot';

/** Each Orca project, as what a reader checks: where, what kind, what title. */
const projectsIn = async (box) => (await box.orca.setups())
  .map(({ path: at, kind, displayName }) => ({ path: at, kind, displayName }));

/** Whether `home` has a `.git` entry of any kind: a folder, a file or a link. */
function hasGitEntry(home) {
  try {
    lstatSync(path.join(home, '.git'));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function ok(box, args) {
  const result = await box.run(args);
  assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return result;
}

/** An Orca that registers the folder it is given, as Orca did before 1.4.240. */
const olderOrca = (box) => box.orca.set({ repoAddAsGiven: true });

/** An Orca that registers the git repo's top folder, as Orca 1.4.240 does. */
const currentOrca = (box) => box.orca.set({ repoAddAsGiven: false });

const initArgs = ['init', '--bots', 'bots', '--harness', 'claude'];

/**
 * A bots folder made by `init` on the older Orca, so that Bot Father's project
 * is at its home already, and a new bot, `api-bot`, with one session, not up.
 * Then Orca is the current one. `up` makes api-bot's project.
 */
async function fleetWithNewBot(box) {
  await olderOrca(box);
  await ok(box, initArgs);
  await ok(box, ['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  await ok(box, ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily']);
  await currentOrca(box);
  return {
    bots: box.path('bots'),
    home: botHomeOf(box.path('bots'), BOT),
    fatherHome: botHomeOf(box.path('bots')),
  };
}

/** The user's own repository in `home`: `git init`, and a commit when `commit` is true. */
async function usersOwnRepo(home, { commit }) {
  await mkdir(home, { recursive: true });
  const made = await git(['init', '--quiet'], home);
  assert.equal(made.code, 0, made.stderr);
  if (commit) {
    await writeFile(path.join(home, 'mine.txt'), 'the user\'s own file\n');
    for (const args of [
      ['add', 'mine.txt'],
      ['-c', 'user.name=User', '-c', 'user.email=user@example.com', 'commit', '--quiet', '-m', 'mine'],
    ]) {
      const done = await git(args, home);
      assert.equal(done.code, 0, done.stderr);
    }
  }
}

/** What a user's repository in `home` is: every file of its `.git`, and its HEAD. */
async function repoState(home) {
  const head = await git(['rev-parse', '--verify', '--quiet', 'HEAD'], home);
  return { files: await snapshot(path.join(home, '.git')), head: head.stdout.trim() };
}

// ------------------------------------------------------------------ C1

test('C1 init on an Orca that registers the git top folder leaves one folder project, at Bot Father\'s home, called Bot Father', async (t) => {
  const box = await createSandbox(t);
  const home = botHomeOf(box.path('bots'));

  const result = await box.run(initArgs);

  assert.deepEqual(
    await projectsIn(box),
    [{ path: home, kind: 'folder', displayName: 'Bot Father' }],
    'one project, at the bot home: none at the bots folder or anywhere else',
  );
  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
});

test('C1 up of a new bot on an Orca that registers the git top folder leaves one folder project, at its home, with its title', async (t) => {
  const box = await createSandbox(t);
  const { home, fatherHome } = await fleetWithNewBot(box);

  const result = await box.run(['up', '--bots', 'bots']);

  assert.deepEqual(
    await projectsIn(box),
    [
      { path: fatherHome, kind: 'folder', displayName: 'Bot Father' },
      { path: home, kind: 'folder', displayName: 'Api Bot' },
    ],
    'Bot Father\'s project as it was, and one for api-bot at its home: none at the bots folder',
  );
  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.ok(
    (await box.orca.terminals()).some((terminal) => terminal.worktreePath === home),
    'api-bot\'s session has a tab at its home',
  );
});

// ------------------------------------------------------------------ C2

test('C2 after init has registered Bot Father\'s home, the home holds no .git', async (t) => {
  const box = await createSandbox(t);
  const home = botHomeOf(box.path('bots'));

  const result = await box.run(initArgs);

  // The premise: the run did register the bot home.
  assert.deepEqual((await projectsIn(box)).map((project) => project.path), [home], `${result.stderr}`);
  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.equal(hasGitEntry(home), false, 'no .git is left in the bot home');
});

test('C2 after up has registered a new bot\'s home, the home holds no .git', async (t) => {
  const box = await createSandbox(t);
  const { home } = await fleetWithNewBot(box);

  const result = await box.run(['up', '--bots', 'bots']);

  assert.ok((await projectsIn(box)).some((project) => project.path === home), `the premise: api-bot's home is registered (${result.stderr})`);
  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.equal(hasGitEntry(home), false, 'no .git is left in the bot home');
});

/** Ways an Orca call can fail, set on the fake Orca for `command`. */
const FAILURES = {
  refused: (command) => ({ fail: { [command]: { code: 'runtime_error', message: 'Orca said no' } } }),
  crashed: (command) => ({ crash: { command, exitCode: 1, stderr: 'orca: something went wrong\n' } }),
  'answered nonsense': (command) => ({ garbage: { command, text: 'not json at all\n' } }),
};

for (const [how, failure] of Object.entries(FAILURES)) {
  test(`C2 when repo add is ${how}, up leaves no .git in the new bot's home`, async (t) => {
    const box = await createSandbox(t);
    const { home } = await fleetWithNewBot(box);
    await box.orca.set(failure('repo add'));
    const from = (await box.orca.calls()).length;

    const result = await box.run(['up', '--bots', 'bots']);

    const added = orcaCallsOf((await box.orca.calls()).slice(from), 'repo add');
    assert.deepEqual(added.map((call) => orcaFlag(call, '--path')), [home], 'the premise: the run asked Orca to register the bot home');
    assert.notEqual(result.code, 0, 'the run fails, as before');
    assert.equal(hasGitEntry(home), false, 'no .git is left in the bot home');
  });
}

test('C2 when project setup-update is refused after repo add, up leaves no .git in the new bot\'s home', async (t) => {
  const box = await createSandbox(t);
  const { home } = await fleetWithNewBot(box);
  await box.orca.set(FAILURES.refused('project setup-update'));
  const from = (await box.orca.calls()).length;

  const result = await box.run(['up', '--bots', 'bots']);

  assert.equal(orcaCallsOf((await box.orca.calls()).slice(from), 'repo add').length, 1, 'the premise: repo add was made');
  assert.notEqual(result.code, 0, 'the run fails, as before');
  assert.equal(hasGitEntry(home), false, 'no .git is left in the bot home');
});

test('C2 when repo add is refused, init leaves no .git in Bot Father\'s home', async (t) => {
  const box = await createSandbox(t);
  const home = botHomeOf(box.path('bots'));
  await box.orca.set(FAILURES.refused('repo add'));

  const result = await box.run(initArgs);

  assert.equal(orcaCallsOf(await box.orca.calls(), 'repo add').length, 1, 'the premise: repo add was made');
  assert.notEqual(result.code, 0, 'the run fails, as before');
  assert.equal(hasGitEntry(home), false, 'no .git is left in the bot home');
});

// ------------------------------------------------------------------ C3

for (const commit of [false, true]) {
  const theirs = commit ? 'a repository of their own with a commit' : 'an empty repository of their own';

  test(`C3 up leaves ${theirs} in a new bot's home as it was, and registers the home`, async (t) => {
    const box = await createSandbox(t);
    const { home } = await fleetWithNewBot(box);
    await usersOwnRepo(home, { commit });
    const before = await repoState(home);

    const result = await box.run(['up', '--bots', 'bots']);

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    assert.deepEqual(await repoState(home), before, 'the user\'s .git is as it was');
    assert.deepEqual(
      (await projectsIn(box)).filter((project) => project.path === home),
      [{ path: home, kind: 'folder', displayName: 'Api Bot' }],
    );
  });

  test(`C3 when repo add is refused, up leaves ${theirs} in a new bot's home as it was`, async (t) => {
    const box = await createSandbox(t);
    const { home } = await fleetWithNewBot(box);
    await usersOwnRepo(home, { commit });
    const before = await repoState(home);
    await box.orca.set(FAILURES.refused('repo add'));

    const result = await box.run(['up', '--bots', 'bots']);

    assert.notEqual(result.code, 0, 'the run fails, as before');
    assert.deepEqual(await repoState(home), before, 'the user\'s .git is as it was');
  });
}

test('C3 init leaves a repository of the user\'s own in Bot Father\'s home as it was', async (t) => {
  const box = await createSandbox(t);
  const home = botHomeOf(box.path('bots'));
  await usersOwnRepo(home, { commit: true });
  const before = await repoState(home);

  const result = await box.run(initArgs);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.deepEqual(await repoState(home), before, 'the user\'s .git is as it was');
  assert.deepEqual(await projectsIn(box), [{ path: home, kind: 'folder', displayName: 'Bot Father' }]);
});

// ------------------------------------------------------------------ C4

/** Wait for `file` to be there, for at most `ms`. */
async function waitForFile(file, ms, what) {
  const until = Date.now() + ms;
  while (!existsSync(file)) {
    assert.ok(Date.now() < until, `${what}: nothing at ${file} after ${ms} ms`);
    await sleep(20);
  }
}

/**
 * Run `obk <args>` and kill it, SIGKILL, while its next `repo add` is in
 * progress. Then let that call go: `then` 'answer' carries it out, as Orca does
 * for a caller that is gone; 'drop' ends it with nothing done. Returns once
 * the call has ended too.
 */
async function killDuringRepoAdd(t, box, args, then) {
  const gate = path.join(box.root, `repo-add-gate-${then}`);
  const from = orcaCallsOf(await box.orca.calls(), 'repo add').length;
  await box.orca.set({ hold: { command: 'repo add', gate, from, then, ms: 20_000 } });

  const child = spawn('obk', args, { cwd: box.cwd, env: box.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let said = '';
  child.stdout.on('data', (chunk) => { said += chunk; });
  child.stderr.on('data', (chunk) => { said += chunk; });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  t.after(async () => {
    // Whatever happened above, nothing this test started outlives it.
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    // The sandbox may be gone by now; the hold then ends by itself, within its `ms`.
    await writeFile(`${gate}.go`, '').catch(() => {});
  });

  await Promise.race([
    waitForFile(`${gate}.held`, 30_000, `obk ${args[0]} never reached repo add (it said: ${said})`),
    exited.then(({ code, signal }) => assert.fail(`obk ${args[0]} ended (${code ?? signal}) before repo add: ${said}`)),
  ]);
  assert.ok(child.kill('SIGKILL'), 'obk was killed');
  assert.equal((await exited).signal, 'SIGKILL');

  await writeFile(`${gate}.go`, '');
  await waitForFile(`${gate}.done`, 30_000, 'the held repo add never ended');
  await box.orca.set({ hold: null });
}

for (const then of ['answer', 'drop']) {
  const orcaDid = then === 'answer' ? 'Orca carried out the call' : 'the call never reached Orca';

  test(`C4 up killed during repo add (${orcaDid}): the next up leaves no .git and one folder project at the bot home`, async (t) => {
    const box = await createSandbox(t);
    const { home, fatherHome } = await fleetWithNewBot(box);
    await killDuringRepoAdd(t, box, ['up', '--bots', 'bots'], then);

    const result = await box.run(['up', '--bots', 'bots']);

    assert.deepEqual(
      await projectsIn(box),
      [
        { path: fatherHome, kind: 'folder', displayName: 'Bot Father' },
        { path: home, kind: 'folder', displayName: 'Api Bot' },
      ],
      'one project for api-bot, at its home: none at the bots folder',
    );
    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    assert.equal(hasGitEntry(home), false, 'the .git the killed run left is gone');
  });
}

test('C4 init killed during repo add: the next init leaves no .git and one folder project at Bot Father\'s home', async (t) => {
  const box = await createSandbox(t);
  const home = botHomeOf(box.path('bots'));
  await killDuringRepoAdd(t, box, initArgs, 'drop');

  const result = await box.run(initArgs);

  assert.deepEqual(await projectsIn(box), [{ path: home, kind: 'folder', displayName: 'Bot Father' }]);
  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.equal(hasGitEntry(home), false, 'the .git the killed run left is gone');
});

test('C4 C3 up killed during repo add, then up again, leaves the user\'s own .git in the bot home as it was', async (t) => {
  const box = await createSandbox(t);
  const { home } = await fleetWithNewBot(box);
  await usersOwnRepo(home, { commit: true });
  const before = await repoState(home);
  await killDuringRepoAdd(t, box, ['up', '--bots', 'bots'], 'answer');

  const result = await box.run(['up', '--bots', 'bots']);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.deepEqual(await repoState(home), before, 'the user\'s .git is as it was');
  assert.deepEqual(
    (await projectsIn(box)).filter((project) => project.path === home),
    [{ path: home, kind: 'folder', displayName: 'Api Bot' }],
  );
});

// ------------------------------------------------------------------ C5

test('C5 init on an Orca that registers the folder as given leaves one folder project at Bot Father\'s home, and no .git there', async (t) => {
  const box = await createSandbox(t);
  const home = botHomeOf(box.path('bots'));
  await olderOrca(box);

  const result = await box.run(initArgs);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.deepEqual(await projectsIn(box), [{ path: home, kind: 'folder', displayName: 'Bot Father' }]);
  assert.equal(hasGitEntry(home), false);
});

test('C5 up of a new bot on an Orca that registers the folder as given leaves one folder project at its home, and no .git there', async (t) => {
  const box = await createSandbox(t);
  const { home, fatherHome } = await fleetWithNewBot(box);
  await olderOrca(box);

  const result = await box.run(['up', '--bots', 'bots']);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.deepEqual(await projectsIn(box), [
    { path: fatherHome, kind: 'folder', displayName: 'Bot Father' },
    { path: home, kind: 'folder', displayName: 'Api Bot' },
  ]);
  assert.equal(hasGitEntry(home), false);
});
