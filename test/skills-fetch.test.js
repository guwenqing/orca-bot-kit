// `obk skills fetch --bots <path> [--source <name>]` and `obk skills update`:
// the online sources in `<bots>/skills.yaml`, cloned into the sibling
// `<bots>.skill-sources/` at the version the user pinned (PRD 6.7, ADR 0014).
//
// The whole of "moving to a newer version happens only when the user asks" is
// the difference between the two commands, so that is what is pinned hardest:
// `fetch` gets what is missing and leaves a clone that is already there exactly
// as it is — even when its ref is a branch the origin has moved on — and
// `update` is the asking. A source in a test is a real git repository in the
// sandbox, with real commits, a tag and a branch that moves afterwards, so the
// no-op can be proved from the refs of the clone itself rather than taken on
// trust: a clone that was fetched into knows the origin's later commits, and
// one that was left alone does not.
//
// The other half of the acceptance is that the bots repo holds no copy. The
// clone is a sibling of the bots folder, and nothing of what it holds appears
// under the bots folder at all.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  assertCleanFailure,
  assertKeptWhatTheyWrote,
  createSandbox,
  skipGit,
  snapshot,
} from './helpers/cli.js';
import {
  answerOf,
  assertBesideTheBots,
  assertFullSha,
  assertNoCopyIn,
  assertReported,
  branchIn,
  cloneOf,
  commitIn,
  originUrlOf,
  putFile,
  putSkills,
  refsKnow,
  repoAt,
  shaIn,
  sourceEntryIn,
  sourceIn,
  sourceNamesIn,
  sourcesDirOf,
  sourcesTextIn,
  sourcesYaml,
  tagIn,
  writeSources,
} from './helpers/sources.js';

/** What the source is called in the lists and in the clone directory. */
const SOURCE = 'someones-skills';

/** The skill it ships, and the words each version of it says. */
const SKILL = 'their-skill';
const ONE = 'Version one, which the tag points at.';
const TWO = 'Version two, which came later.';
const THREE = 'Version three, made after the clone was taken.';

/** A bots folder `init` made, with Bot Father in it. */
async function seeded(box) {
  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(result.code, 0, result.stderr);
  return box.path('bots');
}

/**
 * The repository a source points at: one commit carrying version one, with the
 * tag `v1.0.0` and the branch `stable` left on it, and then a second commit on
 * `main`. So the three kinds of ref a user can pin are all there at once, and
 * `main` is the one that can still move.
 *
 * `mark` goes into what the skills say, so that a test with two repositories in
 * it can tell which one a clone came from — and so that the two cannot commit
 * the very same tree, message and second, and quietly share a sha.
 */
async function origin(box, name = 'their-repo', { sub = '', mark = '' } = {}) {
  const dir = path.join(box.root, name);
  await repoAt(dir);
  await putSkills(dir, { [SKILL]: `${ONE}${mark}` }, sub);
  const first = await commitIn(dir, 'the first version');
  await tagIn(dir, 'v1.0.0');
  await branchIn(dir, 'stable');
  await putSkills(dir, { [SKILL]: `${TWO}${mark}` }, sub);
  const second = await commitIn(dir, 'the second version');
  return { dir, first, second };
}

/** `obk skills fetch` / `obk skills update`, with whatever else the test wants to say. */
const fetch = (box, ...rest) => box.run(['skills', 'fetch', '--bots', 'bots', ...rest]);
const update = (box, ...rest) => box.run(['skills', 'update', '--bots', 'bots', ...rest]);

/** A fetch a test needs to have happened before the part it is about. */
async function fetched(box, ...rest) {
  const result = await fetch(box, ...rest);
  assert.equal(result.code, 0, `the fetch should have gone through, got: ${result.stderr}${result.stdout}`);
  return result;
}

/** What one skill of a clone says now. */
const skillTextIn = (bots, name, sub = '') =>
  readFile(path.join(cloneOf(bots, name), sub, SKILL, 'SKILL.md'), 'utf8');

for (const [kind, refOf] of [
  ['a tag', () => 'v1.0.0'],
  ['a branch', () => 'stable'],
  ['a sha', (made) => made.first],
]) {
  test(`a source pinned to ${kind} is cloned beside the bots folder, at that version`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    const made = await origin(box);
    const ref = refOf(made);
    await writeSources(bots, sourcesYaml({ name: SOURCE, repo: made.dir, ref }));

    const result = await fetch(box, '--json');

    assert.equal(result.code, 0, result.stderr);
    const entry = sourceIn(answerOf(result), SOURCE);
    assert.equal(entry.state, 'cloned', `a source with no clone is cloned, got: ${JSON.stringify(entry)}`);
    assert.equal(entry.ref, ref, 'the ref reported is the one the user asked for');
    assert.equal(entry.sha, made.first, `${ref} names the first commit, and that is what the clone is at`);

    // What is on disk, read from git rather than from the report.
    assertBesideTheBots(bots, SOURCE);
    assert.equal(await shaIn(cloneOf(bots, SOURCE)), made.first);
    assert.ok((await skillTextIn(bots, SOURCE)).includes(ONE), 'and the skill in it is the pinned version');

    // The sha it resolved to is written down, in the user's own file.
    const written = await sourceEntryIn(bots, SOURCE);
    assertFullSha(written.sha, `the sha written into skills.yaml for ${SOURCE}`);
    assert.equal(written.sha, made.first);
    assert.equal(written.ref, ref, 'the ref stays what the user asked for');

    await assertNoCopyIn(bots, ONE);
  });
}

test('the sha goes into the source\'s own entry, and the rest of the file is still the user\'s', async (t) => {
  // It is their file. The kit adds one key to one entry and gives everything
  // else back as they wrote it, comments and all.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const one = await origin(box, 'one-repo', { sub: 'skills' });
  const two = await origin(box, 'two-repo');
  await writeSources(bots, sourcesYaml(
    { name: SOURCE, repo: one.dir, path: 'skills', ref: 'v1.0.0', comment: 'the team shelf' },
    { name: 'other-skills', repo: two.dir, ref: 'stable' },
  ));
  const before = await sourcesTextIn(bots);

  const result = await fetch(box);

  assert.equal(result.code, 0, `${result.stderr}${result.stdout}`);
  const after = await sourcesTextIn(bots);
  assertKeptWhatTheyWrote(before, after, { changed: ['sources'] });
  for (const [name, repo, rest] of [
    [SOURCE, one.dir, { path: 'skills', ref: 'v1.0.0' }],
    ['other-skills', two.dir, { ref: 'stable' }],
  ]) {
    const written = await sourceEntryIn(bots, name);
    assertFullSha(written.sha, `the sha written for ${name}`);
    assert.deepEqual(
      { ...written, sha: undefined },
      { name, repo, ...rest, sha: undefined },
      `sha is the only thing the kit adds to ${name}'s entry, got: ${after}`,
    );
  }
});

test('a second fetch leaves a clone exactly where it is, even after the branch has moved on', async (t) => {
  // The whole of "only when the user asks". A branch is the ref that can move
  // under a clone, and `fetch` is not the command that follows it: nothing
  // moves, and nothing goes and looks either, which the clone's own refs say.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const made = await origin(box);
  await writeSources(bots, sourcesYaml({ name: SOURCE, repo: made.dir, ref: 'main' }));
  await fetched(box);
  const clone = await snapshot(cloneOf(bots, SOURCE), skipGit);
  const file = await sourcesTextIn(bots);

  // The origin moves on, the way a shelf somebody else keeps does.
  await putSkills(made.dir, { [SKILL]: THREE });
  const third = await commitIn(made.dir, 'the third version');

  const result = await fetch(box, '--json');

  assert.equal(result.code, 0, result.stderr);
  const entry = sourceIn(answerOf(result), SOURCE);
  assert.equal(entry.state, 'there', `a source already cloned is left as it is, got: ${JSON.stringify(entry)}`);
  assert.equal(entry.sha, made.second, 'and it is still at the sha it was cloned at');
  assert.equal(await shaIn(cloneOf(bots, SOURCE)), made.second);
  assert.deepEqual(await snapshot(cloneOf(bots, SOURCE), skipGit), clone, 'nothing in the clone moved');
  assert.ok((await skillTextIn(bots, SOURCE)).includes(TWO), 'so a session reads the version it was pinned to');
  assert.equal(await sourcesTextIn(bots), file, 'and the user\'s file was not written again');
  assert.equal(
    await refsKnow(cloneOf(bots, SOURCE), third),
    false,
    'no ref in the clone knows the origin\'s later commit: fetch did not go and look',
  );
});

test('update moves the clone to where the ref points now, and writes the new sha down', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const made = await origin(box);
  await writeSources(bots, sourcesYaml({ name: SOURCE, repo: made.dir, ref: 'main' }));
  await fetched(box);
  await putSkills(made.dir, { [SKILL]: THREE });
  const third = await commitIn(made.dir, 'the third version');

  const result = await update(box, '--json');

  assert.equal(result.code, 0, result.stderr);
  const entry = sourceIn(answerOf(result), SOURCE);
  assert.equal(entry.state, 'moved', `the asking is what moves it, got: ${JSON.stringify(entry)}`);
  assert.equal(entry.ref, 'main');
  assert.equal(entry.sha, third);
  assert.equal(await shaIn(cloneOf(bots, SOURCE)), third);
  assert.ok((await skillTextIn(bots, SOURCE)).includes(THREE), 'and the skills in it are the new version');

  const written = await sourceEntryIn(bots, SOURCE);
  assert.equal(written.sha, third, 'the new sha is what the file says now');
  assert.equal(written.ref, 'main', 'and the ref is still what the user asked for');
});

test('update on a source that is already at what its ref names leaves it there', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const made = await origin(box);
  await writeSources(bots, sourcesYaml({ name: SOURCE, repo: made.dir, ref: 'v1.0.0' }));
  await fetched(box);
  const clone = await snapshot(cloneOf(bots, SOURCE), skipGit);

  const result = await update(box, '--json');

  assert.equal(result.code, 0, result.stderr);
  const entry = sourceIn(answerOf(result), SOURCE);
  assert.equal(entry.state, 'there', `nothing to move is not a move, got: ${JSON.stringify(entry)}`);
  assert.equal(entry.sha, made.first);
  assert.deepEqual(await snapshot(cloneOf(bots, SOURCE), skipGit), clone);
});

test('fetch --source gets the one named, and leaves the others alone', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const one = await origin(box, 'one-repo');
  const two = await origin(box, 'two-repo');
  await writeSources(bots, sourcesYaml(
    { name: SOURCE, repo: one.dir, ref: 'v1.0.0' },
    { name: 'other-skills', repo: two.dir, ref: 'v1.0.0' },
  ));

  const result = await fetch(box, '--source', SOURCE, '--json');

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(sourceNamesIn(answerOf(result)), [SOURCE], 'only the source that was asked for is reported');
  assert.equal(await shaIn(cloneOf(bots, SOURCE)), one.first);
  assert.ok(!existsSync(cloneOf(bots, 'other-skills')), 'the one that was not named is not cloned either');
  assert.equal((await sourceEntryIn(bots, 'other-skills')).sha, undefined, 'and nothing is written down about it');
});

test('update --source moves the one named, and leaves the others where they are', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const one = await origin(box, 'one-repo');
  const two = await origin(box, 'two-repo');
  await writeSources(bots, sourcesYaml(
    { name: SOURCE, repo: one.dir, ref: 'main' },
    { name: 'other-skills', repo: two.dir, ref: 'main' },
  ));
  await fetched(box);
  // Both origins move; only one of them is asked about.
  for (const made of [one, two]) {
    await putSkills(made.dir, { [SKILL]: THREE });
    made.third = await commitIn(made.dir, 'the third version');
  }

  const result = await update(box, '--source', SOURCE, '--json');

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(sourceNamesIn(answerOf(result)), [SOURCE]);
  assert.equal(await shaIn(cloneOf(bots, SOURCE)), one.third);
  assert.equal(await shaIn(cloneOf(bots, 'other-skills')), two.second, 'the other is still where it was');
  assert.equal((await sourceEntryIn(bots, 'other-skills')).sha, two.second, 'and its entry still says so');
  assert.equal(
    await refsKnow(cloneOf(bots, 'other-skills'), two.third),
    false,
    'nobody went and looked at the source that was not named',
  );
});

test('a source that could not be fetched ends the run in 1, after every source is reported', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const made = await origin(box);
  const nowhere = path.join(box.root, 'no-repo-here');
  await writeSources(bots, sourcesYaml(
    { name: 'gone-skills', repo: nowhere, ref: 'main' },
    { name: SOURCE, repo: made.dir, ref: 'v1.0.0' },
  ));

  const result = await fetch(box, '--json');

  assert.equal(result.code, 1, 'a source that could not be fetched ends the run in 1');
  const answer = answerOf(result);
  assert.deepEqual(
    sourceNamesIn(answer),
    ['gone-skills', SOURCE],
    'every source is reported, in the order the file lists them',
  );
  const bad = sourceIn(answer, 'gone-skills');
  assert.equal(typeof bad.trouble, 'string', `it should say what went wrong, got: ${JSON.stringify(bad)}`);
  assert.ok(bad.trouble.includes('gone-skills'), `and name the source, got: ${bad.trouble}`);

  // The one beside it is fetched all the same: one bad line is not a reason to
  // leave the rest of the shelf empty.
  assert.ok(!('trouble' in sourceIn(answer, SOURCE)), `got: ${JSON.stringify(sourceIn(answer, SOURCE))}`);
  assert.equal(await shaIn(cloneOf(bots, SOURCE)), made.first);
  assert.equal((await sourceEntryIn(bots, SOURCE)).sha, made.first);
});

test('a source whose skills carry scripts or hooks is warned about, once', async (t) => {
  // PRD 6.7: one line, no scanning and no gate. The user takes the risk, and
  // what the kit owes them is knowing there is one to take.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const risky = await origin(box, 'risky-repo');
  const plain = await origin(box, 'plain-repo');
  // Two skills in the one source, each carrying something that runs, so a line
  // per skill would show up as two.
  await putSkills(risky.dir, { 'second-skill': 'Another of theirs.' });
  await putFile(risky.dir, path.join(SKILL, 'scripts', 'build.sh'));
  await putFile(risky.dir, path.join('second-skill', 'hooks', 'on-start.sh'));
  const carries = await commitIn(risky.dir, 'skills that run things');
  await writeSources(bots, sourcesYaml(
    { name: SOURCE, repo: risky.dir, ref: carries },
    { name: 'plain-skills', repo: plain.dir, ref: 'v1.0.0' },
  ));

  const result = await fetch(box);

  assert.equal(result.code, 0, `a source that carries scripts is not trouble: ${result.stderr}`);
  const warned = result.stdout.split('\n').filter((line) => /\b(script|hook)/i.test(line));
  assert.equal(warned.length, 1, `one line per source, whatever is in it, got:\n${result.stdout}`);
  assert.ok(warned[0].includes(SOURCE), `and it should say which source, got: ${warned[0]}`);
  assert.ok(!warned[0].includes('plain-skills'), 'the source that carries nothing is not warned about');
});

for (const [label, text, named] of [
  ['a source called kit', (made) => sourcesYaml({ name: 'kit', repo: made.dir, ref: 'main' }), 'kit'],
  ['a file that is not YAML at all', () => 'sources: [\n  - name: half written\n', 'skills.yaml'],
  ['a sources: that is not a list', (made) => `sources:\n  ${SOURCE}: ${made.dir}\n`, 'skills.yaml'],
  ['a source with no repo', () => sourcesYaml({ name: SOURCE, ref: 'main' }), SOURCE],
]) {
  test(`${label} is refused, and the file is left exactly as it was`, async (t) => {
    // The prefix `kit:` is taken (issue #35), so a source may not be called it;
    // and a file the kit cannot read is a file it will not rewrite either.
    const box = await createSandbox(t);
    const bots = await seeded(box);
    const made = await origin(box);
    await writeSources(bots, text(made));
    const before = await sourcesTextIn(bots);

    const result = await fetch(box);

    assertCleanFailure(result);
    assert.ok(result.stderr.includes(named), `the refusal should name ${named}, got: ${result.stderr}`);
    assert.equal(await sourcesTextIn(bots), before, 'the user\'s file is refused, never rewritten');
    assert.ok(!existsSync(sourcesDirOf(bots)), 'and nothing is cloned');
  });
}

test('the plain report says what became of each source, and --json says the same', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const made = await origin(box);
  await writeSources(bots, sourcesYaml(
    { name: SOURCE, repo: made.dir, ref: 'v1.0.0' },
    { name: 'other-skills', repo: made.dir, ref: 'main' },
  ));

  const plain = await fetch(box);

  assert.equal(plain.code, 0, plain.stderr);
  assertReported(plain.stdout, SOURCE, { state: 'cloned', ref: 'v1.0.0', sha: made.first });
  assertReported(plain.stdout, 'other-skills', { state: 'cloned', ref: 'main', sha: made.second });

  // The second run of the same thing: what a source already in place reads as.
  const again = await fetch(box);

  assert.equal(again.code, 0, again.stderr);
  assertReported(again.stdout, SOURCE, { state: 'there', ref: 'v1.0.0', sha: made.first });

  const other = await createSandbox(t);
  const theirs = await seeded(other);
  const mine = await origin(other);
  await writeSources(theirs, sourcesYaml(
    { name: SOURCE, repo: mine.dir, ref: 'v1.0.0' },
    { name: 'other-skills', repo: mine.dir, ref: 'main' },
  ));
  const asJson = await other.run(['skills', 'fetch', '--bots', 'bots', '--json']);

  assert.equal(asJson.code, 0, asJson.stderr);
  const answer = answerOf(asJson);
  assert.deepEqual(sourceNamesIn(answer), [SOURCE, 'other-skills'], 'the same sources, in the same order');
  assert.deepEqual(
    sourceNamesIn(answer).map((name) => {
      const { name: said, state, ref, sha } = sourceIn(answer, name);
      return { name: said, state, ref, sha };
    }),
    [
      { name: SOURCE, state: 'cloned', ref: 'v1.0.0', sha: mine.first },
      { name: 'other-skills', state: 'cloned', ref: 'main', sha: mine.second },
    ],
    `every entry carries its name, what became of it, the ref and the sha, got: ${asJson.stdout}`,
  );
});

test('a --source no skills.yaml names is refused, and nothing is fetched', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const made = await origin(box);
  await writeSources(bots, sourcesYaml({ name: SOURCE, repo: made.dir, ref: 'v1.0.0' }));

  const result = await fetch(box, '--source', 'nobody-here');

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('nobody-here'), `it should name what was asked for, got: ${result.stderr}`);
  assert.ok(!existsSync(sourcesDirOf(bots)), 'a run that did not understand the ask fetches nothing');
});

test('a bots folder with no sources listed is nothing to do, and not trouble', async (t) => {
  // What every fresh bots folder looks like: `init` seeds `sources: []`.
  const box = await createSandbox(t);
  const bots = await seeded(box);

  const result = await fetch(box, '--json');

  assert.equal(result.code, 0, `an empty list is not trouble: ${result.stderr}`);
  assert.deepEqual(answerOf(result).sources, []);
  assert.ok(!existsSync(sourcesDirOf(bots)), 'and no folder is made beside the bots repo for nothing');
});

for (const command of ['fetch', 'update']) {
  test(`skills ${command} never talks to Orca, and works with Orca down`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    const made = await origin(box);
    await writeSources(bots, sourcesYaml({ name: SOURCE, repo: made.dir, ref: 'v1.0.0' }));
    await box.orca.set({ reachable: false, setups: [], terminals: [] });
    const calls = (await box.orca.calls()).length;

    const result = await box.run(['skills', command, '--bots', 'bots']);

    assert.equal(result.code, 0, `an Orca that is down is nothing to skills ${command}: ${result.stderr}`);
    assert.equal(await shaIn(cloneOf(bots, SOURCE)), made.first);
    assert.equal((await box.orca.calls()).length, calls, `skills ${command} must not call Orca at all`);
  });

  test(`skills ${command} without --bots fails and says so`, async (t) => {
    const box = await createSandbox(t);

    const result = await box.run(['skills', command]);

    assertCleanFailure(result);
    assert.ok(result.stderr.includes('--bots'), `should name --bots, got: ${result.stderr}`);
  });
}

test('a clone the user deleted is fetched again, and the sha written down is the one it comes back at', async (t) => {
  // The ordinary way a clone goes missing: the user tidied the sibling folder
  // away. `fetch` gets what is missing, which is now this.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const made = await origin(box);
  await writeSources(bots, sourcesYaml({ name: SOURCE, repo: made.dir, ref: 'v1.0.0' }));
  await fetched(box);
  await rm(sourcesDirOf(bots), { recursive: true });

  const result = await fetch(box, '--json');

  assert.equal(result.code, 0, result.stderr);
  assert.equal(sourceIn(answerOf(result), SOURCE).state, 'cloned');
  assert.equal(await shaIn(cloneOf(bots, SOURCE)), made.first);
  assert.equal((await sourceEntryIn(bots, SOURCE)).sha, made.first);
});

// Three ways a version can be got wrong, all of them found in review of the
// first implementation and all of them the same failure underneath: the kit
// believing something about a clone that the clone does not actually say. A
// directory is taken for a finished fetch, a sha in the file is taken for
// something a plain fetch may replace, and the repository a clone came from is
// taken for the one the file names now. Each one ends with a bot reading a
// version nobody asked for, which is the one thing this slice exists to stop.

test('a fetch that could not reach the version asked for leaves nothing behind, and says so again next time', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const made = await origin(box);
  await writeSources(bots, sourcesYaml({ name: SOURCE, repo: made.dir, ref: 'v9.9.9' }));

  const result = await fetch(box, '--json');

  assert.equal(result.code, 1, 'a source that could not be fetched ends the run in 1');
  const entry = sourceIn(answerOf(result), SOURCE);
  assert.ok(entry.trouble?.includes('v9.9.9'), `the trouble should name the ref, got: ${JSON.stringify(entry)}`);
  // A directory under the sibling folder is what every later run reads as "this
  // source is here, at the version it was asked for". A half-done one there is
  // that claim made about a clone sitting at whatever the repository's default
  // branch happens to be.
  assert.ok(!existsSync(cloneOf(bots, SOURCE)), 'a fetch that did not finish leaves no clone behind');
  assert.equal((await sourceEntryIn(bots, SOURCE)).sha, undefined, 'and writes no version down');

  const again = await fetch(box, '--json');

  assert.equal(again.code, 1, 'and the run after it ends in 1 too');
  const said = sourceIn(answerOf(again), SOURCE);
  assert.notEqual(said.state, 'there', `nothing is there, so nothing is reported as there: ${JSON.stringify(said)}`);
  assert.ok(said.trouble?.includes('v9.9.9'), `the same trouble is said again, got: ${JSON.stringify(said)}`);
  assert.equal((await sourceEntryIn(bots, SOURCE)).sha, undefined);
});

test('a clone that has gone missing comes back at the sha that was recorded, not at whatever the branch is now', async (t) => {
  // `ref: main` and a sha in the file: the user pinned a moving branch and got
  // a commit. Putting the clone back is not the user asking to move, so the
  // commit they got is the one that comes back — otherwise a deleted folder, or
  // a bots repo restored onto another machine, moves every bot to a version
  // nobody asked for.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const made = await origin(box);
  await writeSources(bots, sourcesYaml({ name: SOURCE, repo: made.dir, ref: 'main' }));
  await fetched(box);
  assert.equal((await sourceEntryIn(bots, SOURCE)).sha, made.second);
  await rm(sourcesDirOf(bots), { recursive: true });
  await putSkills(made.dir, { [SKILL]: THREE });
  const third = await commitIn(made.dir, 'the third version');

  const result = await fetch(box, '--json');

  assert.equal(result.code, 0, result.stderr);
  const entry = sourceIn(answerOf(result), SOURCE);
  assert.equal(entry.sha, made.second, `the version in the file is the version that comes back, got: ${JSON.stringify(entry)}`);
  assert.equal(await shaIn(cloneOf(bots, SOURCE)), made.second);
  assert.ok((await skillTextIn(bots, SOURCE)).includes(TWO), 'so a session reads what it read before');
  assert.equal((await sourceEntryIn(bots, SOURCE)).sha, made.second, 'and nothing in the file moved');
  assert.equal((await sourceEntryIn(bots, SOURCE)).ref, 'main', 'while the ref is still what the user asked for');

  // And the asking still works: `update` is the command that follows the branch.
  const moved = await update(box, '--json');

  assert.equal(moved.code, 0, moved.stderr);
  assert.equal(sourceIn(answerOf(moved), SOURCE).sha, third);
  assert.equal(await shaIn(cloneOf(bots, SOURCE)), third);
});

test('a recorded sha the repository no longer has is said out loud, not replaced with a newer one', async (t) => {
  // The other half of the rule above. If the commit that was written down
  // cannot be found, the honest answer is that it cannot be found — a fetch
  // that quietly took the top of the branch instead would be the same silent
  // move, arriving by a different road.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const made = await origin(box);
  const gone = '0123456789abcdef0123456789abcdef01234567';
  await writeSources(bots, sourcesYaml({ name: SOURCE, repo: made.dir, ref: 'main', sha: gone }));

  const result = await fetch(box, '--json');

  assert.equal(result.code, 1, 'a version that cannot be found ends the run in 1');
  const entry = sourceIn(answerOf(result), SOURCE);
  assert.ok(entry.trouble?.includes(SOURCE), `the trouble should name the source, got: ${JSON.stringify(entry)}`);
  assert.ok(entry.trouble.includes(gone.slice(0, 7)), `and the version it could not find, got: ${entry.trouble}`);
  assert.ok(!existsSync(cloneOf(bots, SOURCE)), 'and nothing usable is left behind');
  assert.equal((await sourceEntryIn(bots, SOURCE)).sha, gone, 'the file still says what it said');

  // The way out is the user asking for a version that does exist.
  const moved = await update(box, '--json');

  assert.equal(moved.code, 0, `${moved.stderr}${moved.stdout}`);
  assert.equal(sourceIn(answerOf(moved), SOURCE).sha, made.second);
  assert.equal(await shaIn(cloneOf(bots, SOURCE)), made.second);
  assert.equal((await sourceEntryIn(bots, SOURCE)).sha, made.second);
});

test('update takes the source from the repository the file names now', async (t) => {
  // The user points a source at a fork, or at the place a repository moved to.
  // A clone whose origin is the old one is the old source, whatever the entry
  // around it says, and an update that fetched it would report the new
  // repository's name against the old repository's commit.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const first = await origin(box, 'their-repo');
  const other = await origin(box, 'other-repo', { mark: ' Taken from the fork.' });
  assert.notEqual(first.first, other.first, 'the two repositories must not share a commit, or this proves nothing');
  await writeSources(bots, sourcesYaml({ name: SOURCE, repo: first.dir, ref: 'v1.0.0' }));
  await fetched(box);
  await writeSources(bots, sourcesYaml({ name: SOURCE, repo: other.dir, ref: 'v1.0.0' }));

  const result = await update(box, '--json');

  assert.equal(result.code, 0, `${result.stderr}${result.stdout}`);
  assert.equal(sourceIn(answerOf(result), SOURCE).sha, other.first);
  assert.equal(await originUrlOf(cloneOf(bots, SOURCE)), other.dir, 'the clone is taken from the repository the file names');
  assert.equal(await shaIn(cloneOf(bots, SOURCE)), other.first);
  assert.ok((await skillTextIn(bots, SOURCE)).includes('Taken from the fork.'), 'and the skills in it are that repository\'s');
  assert.equal((await sourceEntryIn(bots, SOURCE)).sha, other.first, 'the sha beside the new repo is the new repo\'s');
});

test('fetch will not take a source from a different repository, and changes nothing', async (t) => {
  // Fetch gets what is missing; it is not the command that changes what a
  // source is. Left unsaid, the entry names one repository and the clone under
  // it is another's, with a sha that belongs to neither line of work.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const first = await origin(box, 'their-repo');
  const other = await origin(box, 'other-repo', { mark: ' Taken from the fork.' });
  await writeSources(bots, sourcesYaml({ name: SOURCE, repo: first.dir, ref: 'v1.0.0' }));
  await fetched(box);
  await writeSources(bots, sourcesYaml({ name: SOURCE, repo: other.dir, ref: 'v1.0.0' }));
  const file = await sourcesTextIn(bots);

  const result = await fetch(box, '--json');

  assert.equal(result.code, 1, 'a clone that is not of the repository the file names ends the run in 1');
  const entry = sourceIn(answerOf(result), SOURCE);
  assert.ok(entry.trouble?.includes(SOURCE), `the trouble should name the source, got: ${JSON.stringify(entry)}`);
  assert.ok(/skills update/.test(entry.trouble), `and say what to run to take it from there, got: ${entry.trouble}`);
  assert.equal(await originUrlOf(cloneOf(bots, SOURCE)), first.dir, 'the clone is left exactly as it was');
  assert.equal(await shaIn(cloneOf(bots, SOURCE)), first.first);
  assert.equal(await sourcesTextIn(bots), file, 'and nothing is written into the user\'s file');
});

test('a skills.yaml the sha cannot be written into without changing something else is left alone', async (t) => {
  // The guard in front of every write the kit makes to a file the user also
  // writes in. An anchor on the source and an alias to it elsewhere is one
  // document where adding a key in one place adds it in two, so the change is
  // not the one the kit meant to make and the file is not written at all.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const made = await origin(box);
  await writeSources(bots, [
    '# The shelf, and a copy of the entry I keep for myself.',
    '',
    'sources:',
    '  - &shared',
    `    name: ${SOURCE}`,
    `    repo: ${made.dir}`,
    '    ref: v1.0.0',
    'backup: *shared',
    '',
  ].join('\n'));
  const file = await sourcesTextIn(bots);

  const result = await fetch(box);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('skills.yaml'), `the refusal should name the file, got: ${result.stderr}`);
  assert.equal(await sourcesTextIn(bots), file, 'the user\'s file is left exactly as they wrote it');
});
