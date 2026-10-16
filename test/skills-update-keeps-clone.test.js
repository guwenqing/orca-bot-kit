// `obk skills update` on a source whose repository the user changed, when the
// replacement does not work out (issue #568).
//
// `update` is the command that may replace a clone whose origin is not the
// repository `skills.yaml` names now. A replacement can fail in two places: the
// new repository cannot be cloned at all, or it clones and has no such ref. In
// either case the clone the user already had is the only working copy of the
// source on the machine, and the user may keep files of their own in it. A
// failed update must leave that clone exactly as it was: its origin, its
// commit, and every file in it, the untracked ones included.
//
// A successful replacement is pinned in skills-fetch.test.js ('update takes the
// source from the repository the file names now'), and is not repeated here.
// Everything is read back from the disk and from git itself, not from the
// kit's report.

import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createSandbox, skipGit, snapshot } from './helpers/cli.js';
import {
  answerOf,
  cloneOf,
  commitIn,
  originUrlOf,
  putSkills,
  repoAt,
  shaIn,
  sourceEntryIn,
  sourceIn,
  sourcesDirOf,
  sourcesTextIn,
  sourcesYaml,
  tagIn,
  writeSources,
} from './helpers/sources.js';

/** What the source is called in skills.yaml and in the clone directory. */
const SOURCE = 'someones-skills';

/** The skill the first repository ships. */
const SKILL = 'their-skill';

/** The ref the user pins, in the old repository and in the new entry alike. */
const REF = 'v1.0.0';

/** A file the user keeps in the clone, which git does not track. */
const LOCAL = 'my-notes.md';
const LOCAL_TEXT = 'Notes I keep beside their skills. Nobody else has a copy.\n';

/** A bots folder `init` made, with Bot Father in it. */
async function seeded(box) {
  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(result.code, 0, result.stderr);
  return box.path('bots');
}

/** `obk skills fetch` / `obk skills update`, with whatever else the test wants to say. */
const fetch = (box, ...rest) => box.run(['skills', 'fetch', '--bots', 'bots', ...rest]);
const update = (box, ...rest) => box.run(['skills', 'update', '--bots', 'bots', ...rest]);

/**
 * The state every test here starts from: a source cloned from one repository
 * at `v1.0.0`, with a file of the user's own in the clone that git does not
 * track. Answers what a later check compares against, all read from the disk.
 */
async function clonedWithALocalFile(box) {
  const bots = await seeded(box);
  const dir = await repoAt(path.join(box.root, 'their-repo'));
  await putSkills(dir, { [SKILL]: 'The version the user pinned.' });
  const first = await commitIn(dir, 'the first version');
  await tagIn(dir, REF);
  await writeSources(bots, sourcesYaml({ name: SOURCE, repo: dir, ref: REF }));
  const fetched = await fetch(box);
  assert.equal(fetched.code, 0, `the first fetch should have gone through, got: ${fetched.stderr}${fetched.stdout}`);
  const clone = cloneOf(bots, SOURCE);
  assert.equal(await shaIn(clone), first, 'set-up: the clone is at the pinned commit');
  await writeFile(path.join(clone, LOCAL), LOCAL_TEXT);
  return { bots, dir, first, clone, files: await snapshot(clone, skipGit) };
}

/** The old clone, still in place and unchanged: where it came from, its commit and every file in it. */
async function assertOldCloneKept(start, what) {
  const { bots, dir, first, clone, files } = start;
  assert.deepEqual(
    await readdir(sourcesDirOf(bots)).catch(() => []),
    [SOURCE],
    `${what}: the source's clone is still the one thing beside the bots folder, and nothing else is left there`,
  );
  assert.equal(await originUrlOf(clone), dir, `${what}: the clone is still taken from the old repository`);
  assert.equal(await shaIn(clone), first, `${what}: the clone is still at the commit it was at`);
  assert.equal(
    await readFile(path.join(clone, LOCAL), 'utf8'),
    LOCAL_TEXT,
    `${what}: the user's own file is still in the clone, with what they wrote in it`,
  );
  assert.deepEqual(await snapshot(clone, skipGit), files, `${what}: no file in the clone changed, came or went`);
}

/** The run failed for this source, and said so: exit code 1 and a trouble entry that names it. */
function assertFailedFor(result) {
  assert.equal(result.code, 1, `a source that could not be replaced ends the run in 1, got: ${result.stderr}${result.stdout}`);
  const entry = sourceIn(answerOf(result), SOURCE);
  assert.equal(typeof entry.trouble, 'string', `it should say what went wrong, got: ${JSON.stringify(entry)}`);
  assert.ok(entry.trouble.includes(SOURCE), `and name the source, got: ${entry.trouble}`);
}

test('update to a repository that cannot be cloned keeps the old clone and the user\'s files in it', async (t) => {
  // The case the issue reports: the user changed the address to one that does
  // not work, and the update failed after the clone they had was gone.
  const box = await createSandbox(t);
  const start = await clonedWithALocalFile(box);
  const nowhere = path.join(box.root, 'no-repo-here');
  await writeSources(start.bots, sourcesYaml({ name: SOURCE, repo: nowhere, ref: REF }));
  const file = await sourcesTextIn(start.bots);

  const result = await update(box, '--json');

  assertFailedFor(result);
  await assertOldCloneKept(start, 'after an update whose new repository could not be cloned');
  assert.equal(await sourcesTextIn(start.bots), file, 'and nothing is written into the user\'s file');
});

test('update to a repository that has no such ref keeps the old clone and the user\'s files in it', async (t) => {
  // The other place a replacement can fail: the new repository clones, and the
  // ref the user pinned is not in it. The old repository has `v1.0.0`; this
  // one has commits and no tag at all.
  const box = await createSandbox(t);
  const start = await clonedWithALocalFile(box);
  const other = await repoAt(path.join(box.root, 'other-repo'));
  await putSkills(other, { [SKILL]: 'A fork that never tagged a release.' });
  await commitIn(other, 'the fork\'s only version');
  await writeSources(start.bots, sourcesYaml({ name: SOURCE, repo: other, ref: REF }));
  const file = await sourcesTextIn(start.bots);

  const result = await update(box, '--json');

  assertFailedFor(result);
  await assertOldCloneKept(start, `after an update whose new repository has no ${REF}`);
  assert.equal(await sourcesTextIn(start.bots), file, 'and nothing is written into the user\'s file');
});

test('a successful update to a new repository leaves only that source\'s clone beside the bots folder', async (t) => {
  // Keeping the old clone until the replacement works must not turn into
  // keeping it for good. A copy of the old repository left in a second folder
  // is a stale source nobody listed, which `health` reports as a leftover.
  // Whether the user's own file goes with the old clone on success is not
  // what issue #568 asks about, so it is not pinned either way.
  const box = await createSandbox(t);
  const start = await clonedWithALocalFile(box);
  const other = await repoAt(path.join(box.root, 'other-repo'));
  await putSkills(other, { [SKILL]: 'The fork, which tagged its own release.' });
  const forked = await commitIn(other, 'the fork\'s release');
  await tagIn(other, REF);
  assert.notEqual(forked, start.first, 'the two repositories must not share a commit, or this proves nothing');
  await writeSources(start.bots, sourcesYaml({ name: SOURCE, repo: other, ref: REF }));

  const result = await update(box, '--json');

  assert.equal(result.code, 0, `the replacement works, got: ${result.stderr}${result.stdout}`);
  assert.equal(await originUrlOf(start.clone), other, 'set-up: the clone is now taken from the new repository');
  assert.equal(await shaIn(start.clone), forked);
  assert.deepEqual(
    await readdir(sourcesDirOf(start.bots)),
    [SOURCE],
    'the source\'s own clone is the one thing beside the bots folder: the old one is not kept in a second folder',
  );
});

test('after a failed update, putting the old repository back finds the old clone there as it was', async (t) => {
  // The way back from a typo in the address. The clone that survived is still
  // the source as far as the kit is concerned, not something it fetches again:
  // a fresh clone would be at the same commit and still lose the user's file.
  const box = await createSandbox(t);
  const start = await clonedWithALocalFile(box);
  await writeSources(start.bots, sourcesYaml({ name: SOURCE, repo: path.join(box.root, 'no-repo-here'), ref: REF }));
  assertFailedFor(await update(box, '--json'));
  await writeSources(start.bots, sourcesYaml({ name: SOURCE, repo: start.dir, ref: REF, sha: start.first }));

  const result = await fetch(box, '--json');

  assert.equal(result.code, 0, `the old entry back in place is nothing to fix, got: ${result.stderr}${result.stdout}`);
  const entry = sourceIn(answerOf(result), SOURCE);
  assert.equal(entry.state, 'there', `the old clone is the source, left as it is, got: ${JSON.stringify(entry)}`);
  assert.equal(entry.sha, start.first);
  await assertOldCloneKept(start, 'after the old repository was put back');
  assert.equal((await sourceEntryIn(start.bots, SOURCE)).sha, start.first);
});
