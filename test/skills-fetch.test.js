// `obk skills fetch --bots <path> [--source <name>]` and `obk skills update`:
// the online sources in `<bots>/skills.yaml`, cloned into the sibling
// `<bots>.skill-sources/` at the version the user pinned (PRD 6.7, ADR 0004).
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
 */
async function origin(box, name = 'their-repo', { sub = '' } = {}) {
  const dir = path.join(box.root, name);
  await repoAt(dir);
  await putSkills(dir, { [SKILL]: ONE }, sub);
  const first = await commitIn(dir, 'the first version');
  await tagIn(dir, 'v1.0.0');
  await branchIn(dir, 'stable');
  await putSkills(dir, { [SKILL]: TWO }, sub);
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
