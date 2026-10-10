// The one way a system test removes its throwaway Orca projects (#536):
// `deleteOwnProject(setup, bots)` in test/helpers/own-project.js.
//
// It removes a project through the kit's own `deleteProject` (src/orca.js,
// #528), so it goes on both Orcas a system run can meet: the next release,
// whose guard refuses a plain delete of a project with saved workspace details
// unless `--force` is given (stablyai/orca#27172), and 1.4.223, which refuses
// `--force` as an unknown flag. And it force-deletes only the run's own
// projects: the project must sit strictly inside the test's throwaway bots
// folder, `<real temp folder>/obk-system-<name>-…`, or it sends nothing and
// fails with an AssertionError.
//
// Run here against the fake Orca only (test/helpers/fake-orca.js): OBK_ORCA
// names the sandbox's fake while a test runs. The bots folders are real ones
// under the real temp folder, because the run's-own check reads that folder.

import assert, { AssertionError } from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, rmdir, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createSandbox, orcaCallsOf, repoRoot } from './helpers/cli.js';
import { deleteOwnProject } from './helpers/own-project.js';

/**
 * A sandbox whose fake Orca is the one `deleteProject` talks to: OBK_ORCA names
 * it until the test ends, and is put back as it was after.
 */
async function fakeOrcaFor(t) {
  const box = await createSandbox(t);
  const had = Object.hasOwn(process.env, 'OBK_ORCA');
  const was = process.env.OBK_ORCA;
  process.env.OBK_ORCA = box.orca.cli;
  t.after(() => {
    if (had) process.env.OBK_ORCA = was;
    else delete process.env.OBK_ORCA;
  });
  return box;
}

/** A throwaway folder made the way a system test makes its bots folder, removed when the test ends. */
async function folderIn(t, parent, prefix) {
  const made = await realpath(await mkdtemp(path.join(parent, prefix)));
  t.after(() => rm(made, { recursive: true, force: true }));
  return made;
}

/** A system test's throwaway bots folder: `<real temp folder>/obk-system-<name>-…`. */
const throwawayBots = (t) => folderIn(t, os.tmpdir(), 'obk-system-own-project-');

/** Register `home` as an Orca project, as some other process would, and give back its setup as `project setups` lists it. */
async function projectAt(box, home) {
  const done = spawnSync(box.orca.cli, ['repo', 'add', '--path', home, '--json'], { cwd: box.cwd, env: box.env, encoding: 'utf8' });
  assert.equal(done.error, undefined, `the fake Orca should be runnable: ${done.error?.message}`);
  assert.equal(JSON.parse(done.stdout).ok, true, `the fake should have registered ${home}: ${done.stdout}`);
  const setup = (await box.orca.setups()).find((one) => one.path === home);
  assert.ok(setup !== undefined, `the fake should list a project at ${home}`);
  return setup;
}

/** The ids of the projects Orca lists now. */
const listedIds = async (box) => (await box.orca.setups()).map((one) => one.id);

/** Every `project setup-delete` the fake was sent, as the arguments it got. */
const deletesSent = async (box) => orcaCallsOf(await box.orca.calls(), 'project setup-delete').map((call) => call.args);

// ------------------------------------------------------------- the run's own project goes, on both Orcas

test('on the guarded Orca release, the run\'s own project goes, sent once with --force, and no other project is touched', async (t) => {
  const box = await fakeOrcaFor(t);
  const bots = await throwawayBots(t);
  const owner = await projectAt(box, '/Users/owner/work/app');
  const mine = await projectAt(box, path.join(bots, 'bots', 'bot-father'));
  const other = await projectAt(box, path.join(bots, 'bots', 'coder'));
  // The guard of stablyai/orca#27172: a plain delete of a project with saved
  // workspace details is refused, as a throwaway project always has them.
  await box.orca.set({ deleteGuard: {} });

  await deleteOwnProject(mine, bots);

  assert.deepEqual(await listedIds(box), [owner.id, other.id], 'only the project named goes');
  assert.deepEqual(
    await deletesSent(box),
    [['project', 'setup-delete', '--setup', mine.id, '--force', '--json']],
    'one delete, with --force, of that project alone',
  );
});

test('on Orca 1.4.223, which does not know --force, the run\'s own project goes by the plain delete after the refusal', async (t) => {
  const box = await fakeOrcaFor(t);
  const bots = await throwawayBots(t);
  const owner = await projectAt(box, '/Users/owner/work/app');
  const mine = await projectAt(box, path.join(bots, 'bots', 'bot-father'));
  await box.orca.set({ forceUnknown: true });

  await deleteOwnProject(mine, bots);

  assert.deepEqual(await listedIds(box), [owner.id], 'the project is gone, and the owner\'s is still there');
  assert.deepEqual(await deletesSent(box), [
    ['project', 'setup-delete', '--setup', mine.id, '--force', '--json'],
    ['project', 'setup-delete', '--setup', mine.id, '--json'],
  ], 'first with --force, refused as an unknown flag, then the plain delete');
});

test('a project directly in the bots folder is the run\'s own too', async (t) => {
  const box = await fakeOrcaFor(t);
  const bots = await throwawayBots(t);
  const mine = await projectAt(box, path.join(bots, 'bots'));
  await box.orca.set({ deleteGuard: {} });

  await deleteOwnProject(mine, bots);

  assert.deepEqual(await listedIds(box), []);
});

// ------------------------------------------------------------- any other refusal fails, and the project stays

test('when Orca refuses the delete for any other reason, it throws with Orca\'s words, and the project stays', async (t) => {
  const box = await fakeOrcaFor(t);
  const bots = await throwawayBots(t);
  const mine = await projectAt(box, path.join(bots, 'bots', 'bot-father'));
  await box.orca.set({
    deleteGuard: {},
    fail: { 'project setup-delete': { code: 'runtime_error', message: 'Orca could not reach its project store' } },
  });

  await assert.rejects(
    async () => deleteOwnProject(mine, bots),
    /Orca could not reach its project store/,
    'a refused delete is a failure the teardown sees, with why',
  );

  assert.deepEqual(await listedIds(box), [mine.id], 'the project is still there');
  assert.ok((await deletesSent(box)).length > 0, 'the premise: the delete was sent and refused, not skipped');
});

test('a refusal on the guarded Orca with --force sent is not taken for 1.4.223\'s unknown flag: no plain delete follows, and it throws', async (t) => {
  // Only "Unknown flag --force" means an Orca that does not know the flag. Any
  // other invalid_argument is a refusal like the rest.
  const box = await fakeOrcaFor(t);
  const bots = await throwawayBots(t);
  const mine = await projectAt(box, path.join(bots, 'bots', 'bot-father'));
  await box.orca.set({
    fail: { 'project setup-delete': { code: 'invalid_argument', message: 'The setup id is not valid', times: 1 } },
  });

  await assert.rejects(async () => deleteOwnProject(mine, bots), /The setup id is not valid/);

  assert.deepEqual(await listedIds(box), [mine.id], 'the project is still there');
  assert.deepEqual(await deletesSent(box), [['project', 'setup-delete', '--setup', mine.id, '--force', '--json']], 'one delete, and no plain one after it');
});

// ------------------------------------------------------------- a project that is not the run's own is never sent

/**
 * Each way a project is not the run's own, with the bots folder it is checked
 * against: `bots` and the project's `home`, made by `build` from a throwaway
 * bots folder of the run's own shape (`ours`) and the test.
 */
const NOT_OURS = [
  ['the project is the bots folder itself', async (t, ours) => ({ bots: ours, home: ours })],
  ['the project is in a sibling folder whose name starts with the bots folder\'s', async (t, ours) => ({ bots: ours, home: path.join(`${ours}-x`, 'bots', 'bot-father') })],
  ['the project path leaves the bots folder through ..', async (t, ours) => ({ bots: ours, home: `${ours}/bots/../../owner-project` })],
  ['the project path leaves the bots folder through .. and comes back beside it', async (t, ours) => ({ bots: ours, home: `${ours}/../${path.basename(ours)}-x/bots` })],
  ['the project is the owner\'s, outside the temp folder', async (t, ours) => ({ bots: ours, home: '/Users/owner/work/app' })],
  ['the project is the temp folder itself', async (t, ours) => ({ bots: ours, home: path.dirname(ours) })],
  ['the bots folder\'s name does not start with obk-system-', async (t) => {
    const bots = await folderIn(t, os.tmpdir(), 'obk-other-own-project-');
    return { bots, home: path.join(bots, 'bots', 'bot-father') };
  }],
  ['the bots folder\'s name only contains obk-system-', async (t) => {
    const bots = await folderIn(t, os.tmpdir(), 'x-obk-system-own-project-');
    return { bots, home: path.join(bots, 'bots', 'bot-father') };
  }],
  ['the bots folder is not directly in the temp folder, though named like one', async (t, ours) => {
    const bots = await folderIn(t, ours, 'obk-system-nested-');
    return { bots, home: path.join(bots, 'bots', 'bot-father') };
  }],
  ['the bots folder is the temp folder itself', async (t) => {
    const tmp = await realpath(os.tmpdir());
    return { bots: tmp, home: path.join(tmp, 'obk-system-anything', 'bots') };
  }],
];

for (const [why, build] of NOT_OURS) {
  for (const orca of [{ deleteGuard: {} }, { forceUnknown: true }]) {
    test(`not the run's own, so nothing is sent and it fails with an AssertionError: ${why} (${Object.keys(orca)[0]})`, async (t) => {
      const box = await fakeOrcaFor(t);
      const ours = await throwawayBots(t);
      const { bots, home } = await build(t, ours);
      const theirs = await projectAt(box, home);
      await box.orca.set(orca);

      await assert.rejects(async () => deleteOwnProject(theirs, bots), AssertionError);

      assert.deepEqual(await deletesSent(box), [], 'no setup-delete at all, with --force or without');
      assert.deepEqual(await listedIds(box), [theirs.id], 'the project is still there');
    });
  }
}

// ------------------------------------------------------------- a throwaway bots folder in <repo>/local-data

// A system test whose sessions run in Codex's sandbox cannot keep its bots
// folder in the temp folder: the sandbox lets every session write /tmp and
// $TMPDIR, so a test of what the sandbox refuses would show nothing there
// (test/system/codex-sandbox-writes.test.js, #534). Its bots folder is
// `<repo>/local-data/obk-system-<name>-…` instead, which .gitignore keeps out
// of git, and its projects go through the same helper, with the same rule:
// strictly inside a folder named obk-system-, directly in that folder.

/**
 * A folder made in the checkout's own `local-data/`, which is made for it when
 * it is not there; both removed when the test ends, `local-data/` only when
 * this made it and it is empty.
 */
async function localDataFolder(t, prefix) {
  const parent = path.join(await realpath(repoRoot), 'local-data');
  const made = await mkdir(parent, { recursive: true });
  const folder = await realpath(await mkdtemp(path.join(parent, prefix)));
  t.after(async () => {
    await rm(folder, { recursive: true, force: true });
    if (made !== undefined) await rmdir(parent).catch(() => {});
  });
  return folder;
}

test('a project inside the run\'s own bots folder in <repo>/local-data goes, sent with --force, and no other project is touched', async (t) => {
  const box = await fakeOrcaFor(t);
  const bots = await localDataFolder(t, 'obk-system-own-project-');
  const owner = await projectAt(box, '/Users/owner/work/app');
  const mine = await projectAt(box, path.join(bots, 'bots', 'bot-father'));
  await box.orca.set({ deleteGuard: {} });

  await deleteOwnProject(mine, bots);

  assert.deepEqual(await listedIds(box), [owner.id], 'only the project named goes');
  assert.deepEqual(await deletesSent(box), [['project', 'setup-delete', '--setup', mine.id, '--force', '--json']]);
});

for (const [why, build] of [
  ['a bots folder in <repo>/local-data whose name does not start with obk-system-', async (t) => {
    const bots = await localDataFolder(t, 'obk-other-own-project-');
    return { bots, home: path.join(bots, 'bots', 'bot-father') };
  }],
  ['a bots folder named like one but not directly in <repo>/local-data', async (t) => {
    const outer = await localDataFolder(t, 'obk-system-outer-');
    const bots = await folderIn(t, outer, 'obk-system-nested-');
    return { bots, home: path.join(bots, 'bots', 'bot-father') };
  }],
  ['the project is in <repo>/local-data beside the bots folder, not inside it', async (t) => {
    const bots = await localDataFolder(t, 'obk-system-own-project-');
    return { bots, home: path.join(path.dirname(bots), 'owner-project') };
  }],
]) {
  test(`not the run's own, so nothing is sent and it fails with an AssertionError: ${why}`, async (t) => {
    const box = await fakeOrcaFor(t);
    const { bots, home } = await build(t);
    const theirs = await projectAt(box, home);
    await box.orca.set({ deleteGuard: {} });

    await assert.rejects(async () => deleteOwnProject(theirs, bots), AssertionError);

    assert.deepEqual(await deletesSent(box), [], 'no setup-delete at all');
    assert.deepEqual(await listedIds(box), [theirs.id], 'the project is still there');
  });
}

// ------------------------------------------------------------- a bots folder that is a link to somewhere else

// The review of PR #552: the bots folder is checked by its name, so a link
// called `obk-system-…` in the temp folder or in `<repo>/local-data`, leading
// to a folder anywhere else, passed the check, and a project in the folder it
// leads to was force-deleted. A bots folder is the run's own only when it is
// its own real path.

/** A link at `<parent>/<prefix>…` to a throwaway folder elsewhere, removed when the test ends. */
async function linkIn(t, parent, prefix) {
  const target = await folderIn(t, os.tmpdir(), 'obk-elsewhere-');
  const link = path.join(parent, `${prefix}${process.pid}-${Date.now()}`);
  await symlink(target, link);
  t.after(() => rm(link, { force: true }));
  return link;
}

/**
 * The checkout's `local-data/`, made when it is not there, and what removes it
 * again when this made it and it is empty: for the test to register after
 * whatever it puts in there.
 */
async function localDataParent() {
  const parent = path.join(await realpath(repoRoot), 'local-data');
  const made = await mkdir(parent, { recursive: true });
  return { parent, tidy: () => (made === undefined ? undefined : rmdir(parent).catch(() => {})) };
}

for (const [where, parentOf] of [
  ['the temp folder', async () => ({ parent: await realpath(os.tmpdir()), tidy: () => {} })],
  ['<repo>/local-data', localDataParent],
]) {
  test(`not the run's own, so nothing is sent and it fails with an AssertionError: a bots folder in ${where} that is a link to a folder elsewhere`, async (t) => {
    const box = await fakeOrcaFor(t);
    const { parent, tidy } = await parentOf();
    const bots = await linkIn(t, parent, 'obk-system-link-');
    t.after(tidy);
    const theirs = await projectAt(box, path.join(bots, 'bots', 'bot-father'));
    await box.orca.set({ deleteGuard: {} });

    await assert.rejects(async () => deleteOwnProject(theirs, bots), AssertionError);

    assert.deepEqual(await deletesSent(box), [], 'no setup-delete at all');
    assert.deepEqual(await listedIds(box), [theirs.id], 'the project is still there');
  });
}

// ------------------------------------------------------------- a project path that leads out through a link

// The review of PR #552, again: the project's path was checked as text, so a
// link inside the bots folder (`<bots>/linked` to a folder elsewhere) made a
// project beneath it look like the run's own. The project is the run's only
// when its real path lies strictly inside the bots folder's real path.
//
// A project path that is not on disk any more (its folder removed) is read by
// its nearest part that is: that part's real path, with the rest as written.
// A part that is not there cannot be a link, so this lets nothing out, and a
// teardown whose folder went first still removes its own project.

for (const [where, parentOf] of [
  ['the temp folder', async () => ({ parent: await realpath(os.tmpdir()), tidy: () => {} })],
  ['<repo>/local-data', localDataParent],
]) {
  test(`not the run's own, so nothing is sent and it fails with an AssertionError: a project in a bots folder in ${where} beneath a link to a folder elsewhere`, async (t) => {
    const box = await fakeOrcaFor(t);
    const { parent, tidy } = await parentOf();
    const bots = await folderIn(t, parent, 'obk-system-own-project-');
    t.after(tidy);
    const elsewhere = await folderIn(t, os.tmpdir(), 'obk-elsewhere-');
    await mkdir(path.join(elsewhere, 'app'));
    await symlink(elsewhere, path.join(bots, 'linked'));
    const theirs = await projectAt(box, path.join(bots, 'linked', 'app'));
    await box.orca.set({ deleteGuard: {} });

    await assert.rejects(async () => deleteOwnProject(theirs, bots), AssertionError);

    assert.deepEqual(await deletesSent(box), [], 'no setup-delete at all');
    assert.deepEqual(await listedIds(box), [theirs.id], 'the project is still there');
  });

  test(`not the run's own, so nothing is sent and it fails with an AssertionError: a project in a bots folder in ${where}, gone from disk, beneath a link to a folder elsewhere`, async (t) => {
    const box = await fakeOrcaFor(t);
    const { parent, tidy } = await parentOf();
    const bots = await folderIn(t, parent, 'obk-system-own-project-');
    t.after(tidy);
    const elsewhere = await folderIn(t, os.tmpdir(), 'obk-elsewhere-');
    await symlink(elsewhere, path.join(bots, 'linked'));
    const theirs = await projectAt(box, path.join(bots, 'linked', 'gone', 'app'));
    await box.orca.set({ deleteGuard: {} });

    await assert.rejects(async () => deleteOwnProject(theirs, bots), AssertionError);

    assert.deepEqual(await deletesSent(box), [], 'no setup-delete at all');
  });

  test(`a project in a bots folder in ${where} whose own folder is gone from disk is still the run's own, and goes`, async (t) => {
    const box = await fakeOrcaFor(t);
    const { parent, tidy } = await parentOf();
    const bots = await folderIn(t, parent, 'obk-system-own-project-');
    t.after(tidy);
    await mkdir(path.join(bots, 'bots'));
    const mine = await projectAt(box, path.join(bots, 'bots', 'gone-bot'));
    await box.orca.set({ deleteGuard: {} });

    await deleteOwnProject(mine, bots);

    assert.deepEqual(await listedIds(box), [], 'the project is gone from Orca');
  });
}
