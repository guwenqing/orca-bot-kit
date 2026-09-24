// A bot given a skill from an online source: `<source>:<skill>` in a `skills:`
// list, beside the three kinds #35 already has (PRD 6.7, ADR 0014).
//
// The entry points into the clone beside the bots folder —
// `<bots>.skill-sources/<source>/<path>/<skill>` — and what the bot gets is a
// link to it, on both harnesses, so a session reads the version the source is
// pinned at and reads the new one the moment `skills update` moves the clone.
// Nothing of it is ever copied into the bots repo.
//
// The other thing pinned here is what these commands do not do. `up` and
// `bot create` link what the lists name and never fetch: a command that opens
// tabs is not a command that reaches the network, and a clone it met on the way
// is left exactly where it is, whatever the origin has done since.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { createSandbox, tabsOfBot } from './helpers/cli.js';
import {
  addSkills,
  answerOf,
  assertLinked,
  botYamlOf,
  commonSkill,
  defaultsOf,
  entryOf,
  HARNESSES,
  kitSkill,
  linesAbout,
  namesIn,
  readThrough,
  skillIn,
  treeIn,
} from './helpers/skills.js';
import {
  answerOf as fetchAnswerOf,
  assertNoCopyIn,
  branchIn,
  cloneOf,
  commitIn,
  originUrlOf,
  putSkills,
  refsKnow,
  repoAt,
  shaIn,
  sourceIn,
  sourcesDirOf,
  sourcesYaml,
  tagIn,
  writeSources,
} from './helpers/sources.js';

/** One of the kit's own skills, named here so a test that meets it says which. */
const KIT_SKILL = 'obk-tdd';

/** The source, the skill it ships, and the words each version of it says. */
const SOURCE = 'someones-skills';
const SKILL = 'their-skill';
const ONE = 'Version one, which the tag points at.';
const TWO = 'Version two, which came later.';

/** A bots folder `init` made, with Bot Father in it. */
async function seeded(box) {
  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(result.code, 0, result.stderr);
  return box.path('bots');
}

/** One more bot, with a session, so `up` has a tab to open for it. */
async function makeBot(box, name) {
  const made = await box.run([
    'bot', 'create', '--bots', 'bots', '--name', name, '--harness', 'claude',
    '--charter', `${name} owns its own corner.`,
  ]);
  assert.equal(made.code, 0, made.stderr);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', name, '--name', 'daily']);
  assert.equal(added.code, 0, added.stderr);
}

/**
 * The repository the source points at: version one on the tag `v1.0.0`, then a
 * second commit on `main`, so a test can say which of the two a bot is reading.
 */
async function origin(box, { sub = '' } = {}) {
  const dir = path.join(box.root, 'their-repo');
  await repoAt(dir);
  await putSkills(dir, { [SKILL]: ONE }, sub);
  const first = await commitIn(dir, 'the first version');
  await tagIn(dir, 'v1.0.0');
  await branchIn(dir, 'stable');
  await putSkills(dir, { [SKILL]: TWO }, sub);
  const second = await commitIn(dir, 'the second version');
  return { dir, sub, first, second };
}

/** The source in the user's `skills.yaml`, at whatever ref the test pins. */
const listSource = (bots, made, ref = 'v1.0.0') => writeSources(bots, sourcesYaml({
  name: SOURCE,
  repo: made.dir,
  ...(made.sub === '' ? {} : { path: made.sub }),
  ref,
}));

const fetched = async (box) => {
  const result = await box.run(['skills', 'fetch', '--bots', 'bots']);
  assert.equal(result.code, 0, `the fetch should have gone through, got: ${result.stderr}${result.stdout}`);
};

const build = (box, ...rest) => box.run(['skills', 'build', '--bots', 'bots', ...rest]);

/** Where the skill sits inside the clone: under the source's `path`, or at its root. */
const skillDirOf = (bots, made) => path.join(cloneOf(bots, SOURCE), made.sub, SKILL);

for (const [label, sub] of [['at the root of the repo', ''], ['in the subfolder its path names', 'skills']]) {
  test(`a skill from a source ${label} is linked into both harnesses, at the version it is pinned to`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await makeBot(box, 'api-bot');
    const made = await origin(box, { sub });
    await listSource(bots, made);
    await fetched(box);
    // Beside the three kinds #35 already has, so the new one does not displace them.
    const kit = await kitSkill(KIT_SKILL);
    const common = await commonSkill(bots, 'house-style');
    await addSkills(botYamlOf(bots, 'api-bot'), `kit:${KIT_SKILL}`, 'house-style', `${SOURCE}:${SKILL}`);

    const result = await build(box, '--bot', 'api-bot', '--json');

    assert.equal(result.code, 0, `${result.stderr}${result.stdout}`);
    await assertLinked(bots, 'api-bot', SKILL, skillDirOf(bots, made));
    await assertLinked(bots, 'api-bot', KIT_SKILL, kit);
    await assertLinked(bots, 'api-bot', 'house-style', common);
    for (const harness of HARNESSES) {
      assert.deepEqual(
        await namesIn(bots, 'api-bot', harness),
        ['house-style', KIT_SKILL, SKILL],
        `${harness} should read those three skills and nothing else`,
      );
      assert.ok(
        (await readThrough(bots, 'api-bot', harness, SKILL)).includes(ONE),
        `${harness} should read the version the source is pinned at, not whatever the origin is at now`,
      );
    }

    // Where it came from is the source it came from: with four shelves to name,
    // "a source" would not tell the user which.
    const from = skillIn(entryOf(answerOf(result), 'api-bot'), SKILL).from;
    assert.ok(
      typeof from === 'string' && from.includes(SOURCE),
      `the entry should say the skill came from ${SOURCE}, got: ${JSON.stringify(from)}`,
    );
  });
}

test('the bots repo holds no copy of the source, before or after a bot is given it', async (t) => {
  // The acceptance for this slice, said plainly: the clone is a sibling, and
  // what lands in the bot is a link into it.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  const made = await origin(box);
  await listSource(bots, made);
  await fetched(box);
  await assertNoCopyIn(bots, ONE);
  await addSkills(botYamlOf(bots, 'api-bot'), `${SOURCE}:${SKILL}`);

  const result = await build(box, '--bot', 'api-bot');

  assert.equal(result.code, 0, `${result.stderr}${result.stdout}`);
  await assertNoCopyIn(bots, ONE);
  for (const harness of HARNESSES) {
    assert.ok(
      (await readThrough(bots, 'api-bot', harness, SKILL)).includes(ONE),
      `and ${harness} reads it all the same, through the link`,
    );
  }
});

test('a source moved by update is what the sessions read, with no build in between', async (t) => {
  // Linked, never copied (ADR 0014): the link points at the clone, so moving
  // the clone is the whole of moving the bot to a newer version.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  const made = await origin(box);
  await listSource(bots, made, 'main');
  await fetched(box);
  await addSkills(botYamlOf(bots, 'api-bot'), `${SOURCE}:${SKILL}`);
  assert.equal((await build(box, '--bot', 'api-bot')).code, 0);
  await putSkills(made.dir, { [SKILL]: 'Version three, which the user asked for.' });
  const third = await commitIn(made.dir, 'the third version');

  const result = await box.run(['skills', 'update', '--bots', 'bots']);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(await shaIn(cloneOf(bots, SOURCE)), third);
  for (const harness of HARNESSES) {
    assert.ok(
      (await readThrough(bots, 'api-bot', harness, SKILL)).includes('Version three'),
      `${harness} should read the version the user moved to, with no build run afterwards`,
    );
  }
  await assertNoCopyIn(bots, 'Version three');
});

for (const [label, prepare, entry, named] of [
  [
    'whose source holds no skill of that name',
    (box) => fetched(box),
    `${SOURCE}:no-such-skill`,
    ['no-such-skill', SOURCE],
  ],
  [
    'naming a source skills.yaml does not list',
    (box) => fetched(box),
    `nobody:${SKILL}`,
    ['nobody', 'skills.yaml'],
  ],
]) {
  test(`an entry ${label} stops that bot and names what is wrong`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await makeBot(box, 'api-bot');
    const made = await origin(box);
    await listSource(bots, made);
    await prepare(box);
    await addSkills(botYamlOf(bots, 'api-bot'), entry);

    const result = await build(box, '--bot', 'api-bot', '--json');

    assert.equal(result.code, 1, 'a bot that could not be given what its list names ends the run in 1');
    const said = entryOf(answerOf(result), 'api-bot').trouble;
    assert.equal(typeof said, 'string', `it should say what is wrong, got: ${result.stdout}`);
    // Named so the user knows where to go: which entry, and which of the two
    // places — the source's own shelf, or the file that lists the sources — is
    // missing the thing it names.
    for (const word of named) assert.ok(said.includes(word), `the trouble should name ${word}, got: ${said}`);
    for (const harness of HARNESSES) {
      assert.deepEqual(
        await namesIn(bots, 'api-bot', harness),
        [],
        'a list the kit cannot follow stops the bot, as any other unfollowable entry does',
      );
    }
  });
}

test('a source that has not been fetched is trouble naming it and the command to run', async (t) => {
  // The one the user meets first, and the only one they cannot work out for
  // themselves: the list and the file are both right, and nobody has fetched.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  const made = await origin(box);
  await listSource(bots, made);
  await addSkills(botYamlOf(bots, 'api-bot'), `${SOURCE}:${SKILL}`);

  const result = await build(box, '--bot', 'api-bot');

  assert.equal(result.code, 1, result.stdout);
  const said = linesAbout(result.stdout, SOURCE);
  assert.ok(/skills fetch/.test(said), `it should say what to run, got:\n${said}`);
  for (const harness of HARNESSES) {
    assert.deepEqual(await namesIn(bots, 'api-bot', harness), [], 'and the bot is left as it was');
  }
});

test('up never fetches: a source with no clone leaves the fleet up and the sibling folder unmade', async (t) => {
  // A command that opens tabs is not a command that reaches the network. The
  // bot comes up without the skill, which is a line in a report, not a reason
  // to leave a session down — and the line says what to run to get it.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  const made = await origin(box);
  await listSource(bots, made);
  await addSkills(botYamlOf(bots, 'api-bot'), `${SOURCE}:${SKILL}`);

  const result = await box.run(['up', '--bots', 'bots', '--json']);

  assert.equal(result.code, 0, `a skill the kit has no clone of does not change what up ends in: ${result.stderr}`);
  assert.ok(!existsSync(sourcesDirOf(bots)), 'up cloned nothing');
  const said = entryOf(answerOf(result), 'api-bot').trouble;
  assert.ok(said.includes(SOURCE), `it should say which source it has none of, got: ${said}`);
  assert.ok(/skills fetch/.test(said), `and what to run to get it, got: ${said}`);
  assert.deepEqual(
    (await tabsOfBot(box, bots, 'api-bot')).map((tab) => tab.title),
    ['Api Bot daily'],
    'the bot comes up all the same',
  );
});

test('bot create never fetches: the new bot is written, and nothing is cloned for it', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const made = await origin(box);
  await listSource(bots, made);
  // Every bot gets it, so a bot born after this is born wanting it.
  await addSkills(defaultsOf(bots), `${SOURCE}:${SKILL}`);

  const result = await box.run([
    'bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude',
    '--charter', 'api-bot owns its own corner.',
  ]);

  assert.ok(!existsSync(sourcesDirOf(bots)), 'bot create cloned nothing');
  assert.ok(!/^\s+at /m.test(result.stderr), `expected a message, got a crash:\n${result.stderr}`);
  const said = `${result.stdout}${result.stderr}`;
  assert.ok(said.includes(SOURCE), `it should say which source it has none of, got:\n${said}`);
  assert.ok(/skills fetch/.test(said), `and what to run to get it, got:\n${said}`);
  assert.ok(existsSync(botYamlOf(bots, 'api-bot')), 'the bot itself is written');
});

test('up leaves a clone where it is, whatever the origin has done since', async (t) => {
  // The acceptance, on the command a user runs every morning: a branch that has
  // moved on in the origin moves nothing here until they ask for it.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  const made = await origin(box);
  await listSource(bots, made, 'main');
  await fetched(box);
  await addSkills(botYamlOf(bots, 'api-bot'), `${SOURCE}:${SKILL}`);
  await putSkills(made.dir, { [SKILL]: 'Version three, which nobody asked for yet.' });
  const third = await commitIn(made.dir, 'the third version');

  const result = await box.run(['up', '--bots', 'bots']);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(await shaIn(cloneOf(bots, SOURCE)), made.second, 'the clone is where it was');
  assert.equal(await refsKnow(cloneOf(bots, SOURCE), third), false, 'and nobody went and looked');
  for (const harness of HARNESSES) {
    assert.ok(
      (await readThrough(bots, 'api-bot', harness, SKILL)).includes(TWO),
      `${harness} reads the version the user pinned, not the one the origin is at`,
    );
  }
});

test('a build after a fetch that did not finish links nothing, and the right version arrives once the ref is corrected', async (t) => {
  // Found in review: a fetch that could not reach the ref left a clone behind
  // at the repository's default branch, and the build after it linked that into
  // both harnesses and exited 0 — a bot silently running a version nobody
  // pinned, and correcting the ref did not get it back, because the wrong clone
  // was still "there".
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  const made = await origin(box);
  await writeSources(bots, sourcesYaml({ name: SOURCE, repo: made.dir, ref: 'v9.9.9' }));
  await addSkills(botYamlOf(bots, 'api-bot'), `${SOURCE}:${SKILL}`);
  assert.equal((await box.run(['skills', 'fetch', '--bots', 'bots'])).code, 1, 'the fetch cannot have worked');

  const result = await build(box, '--bot', 'api-bot');

  assert.equal(result.code, 1, 'a source that was never fetched is a list the kit cannot follow');
  for (const harness of HARNESSES) {
    assert.deepEqual(
      await namesIn(bots, 'api-bot', harness),
      [],
      'and no version of it is linked: a version nobody asked for is worse than no skill at all',
    );
  }

  // The user corrects the ref, which is the whole of what they have to do.
  await writeSources(bots, sourcesYaml({ name: SOURCE, repo: made.dir, ref: 'v1.0.0' }));
  await fetched(box);
  const built = await build(box, '--bot', 'api-bot');

  assert.equal(built.code, 0, `${built.stderr}${built.stdout}`);
  await assertLinked(bots, 'api-bot', SKILL, path.join(cloneOf(bots, SOURCE), SKILL));
  for (const harness of HARNESSES) {
    assert.ok(
      (await readThrough(bots, 'api-bot', harness, SKILL)).includes(ONE),
      `${harness} should read the version the corrected ref names`,
    );
  }
});

// A clone is a source's only while it came from the repository skills.yaml
// names (#167). Fetch already refuses one that did not; these hold every
// command that links to the same refusal, in the same words, since a bot given
// instructions out of a repository the user has pointed away from is running
// something nobody registered.

/** What a fork of the source says, so a test can tell which repository a bot reads. */
const FORK = 'Taken from the fork.';

/**
 * Another repository shipping the same skill, with its own `v1.0.0`: what the
 * user points the source at when they move to a fork, or to where the
 * repository went.
 */
async function fork(box) {
  const dir = path.join(box.root, 'other-repo');
  await repoAt(dir);
  await putSkills(dir, { [SKILL]: FORK });
  const first = await commitIn(dir, 'the fork\'s version');
  await tagIn(dir, 'v1.0.0');
  return { dir, sub: '', first };
}

/**
 * The words fetch refuses the clone with, asked of fetch itself: build's
 * refusal is to be the same one, not a second sentence that could drift from it.
 */
async function fetchSays(box) {
  const result = await box.run(['skills', 'fetch', '--bots', 'bots', '--json']);
  assert.equal(result.code, 1, `fetch should refuse the clone, got: ${result.stdout}${result.stderr}`);
  const said = sourceIn(fetchAnswerOf(result), SOURCE).trouble;
  assert.equal(typeof said, 'string', `fetch should say why, got: ${result.stdout}`);
  return said;
}

/** The trouble names where the clone came from, what the file names now, and what to run. */
function assertWrongOrigin(said, made, other) {
  assert.equal(typeof said, 'string', `it should say what is wrong, got: ${JSON.stringify(said)}`);
  assert.ok(said.includes(made.dir), `the trouble should name the repository the clone came from, got: ${said}`);
  assert.ok(said.includes(other.dir), `and the one skills.yaml names now, got: ${said}`);
  assert.ok(said.includes(`skills update --source ${SOURCE}`), `and what to run to take it from there, got: ${said}`);
}

test('build will not link a skill out of a clone of another repository, and says what fetch says', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  const made = await origin(box);
  const other = await fork(box);
  await listSource(bots, made);
  await fetched(box);
  await listSource(bots, other);
  await addSkills(botYamlOf(bots, 'api-bot'), `${SOURCE}:${SKILL}`);
  const fetchWords = await fetchSays(box);

  const result = await build(box, '--bot', 'api-bot', '--json');

  assert.equal(result.code, 1, `a clone that is not of the repository the file names is a list the kit cannot follow, got: ${result.stdout}`);
  const said = entryOf(answerOf(result), 'api-bot').trouble;
  assertWrongOrigin(said, made, other);
  assert.ok(said.includes(fetchWords), `build should refuse in fetch's words:\n  fetch: ${fetchWords}\n  build: ${said}`);
  for (const harness of HARNESSES) {
    assert.deepEqual(await namesIn(bots, 'api-bot', harness), [], 'and nothing of the old repository is linked');
  }
  assert.equal(await originUrlOf(cloneOf(bots, SOURCE)), made.dir, 'build takes nothing from anywhere: the clone is as it was');

  // What the refusal says to run is the whole of what the user has to do.
  const updated = await box.run(['skills', 'update', '--bots', 'bots', '--source', SOURCE]);
  assert.equal(updated.code, 0, `${updated.stderr}${updated.stdout}`);
  const built = await build(box, '--bot', 'api-bot');

  assert.equal(built.code, 0, `${built.stderr}${built.stdout}`);
  await assertLinked(bots, 'api-bot', SKILL, skillDirOf(bots, other));
  for (const harness of HARNESSES) {
    assert.ok(
      (await readThrough(bots, 'api-bot', harness, SKILL)).includes(FORK),
      `${harness} should read the repository skills.yaml names now`,
    );
  }
});

test('a bot linked before the source was pointed elsewhere is refused and left as it was', async (t) => {
  // Like every other refusal of a list: nothing written, nothing taken away.
  // The links still point where they did, and it is the trouble that tells the
  // user their bot is not reading what skills.yaml says.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  const made = await origin(box);
  const other = await fork(box);
  await listSource(bots, made);
  await fetched(box);
  await addSkills(botYamlOf(bots, 'api-bot'), `${SOURCE}:${SKILL}`);
  assert.equal((await build(box, '--bot', 'api-bot')).code, 0);
  const before = await treeIn(bots, 'api-bot');
  await listSource(bots, other);

  const result = await build(box, '--bot', 'api-bot', '--json');

  assert.equal(result.code, 1, `the bot is not reading the repository the file names, got: ${result.stdout}`);
  assertWrongOrigin(entryOf(answerOf(result), 'api-bot').trouble, made, other);
  assert.deepEqual(await treeIn(bots, 'api-bot'), before, 'the bot\'s skills directories are exactly as they were');
});

test('up reports a clone of another repository as the bot\'s trouble, and brings the bot up all the same', async (t) => {
  // up links through the same list as build, so it refuses the same clone; and
  // as with a source never fetched, a skills problem does not hold a session down.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  const made = await origin(box);
  const other = await fork(box);
  await listSource(bots, made);
  await fetched(box);
  await listSource(bots, other);
  await addSkills(botYamlOf(bots, 'api-bot'), `${SOURCE}:${SKILL}`);

  const result = await box.run(['up', '--bots', 'bots', '--json']);

  assert.equal(result.code, 0, `a skills problem does not change what up ends in: ${result.stderr}`);
  assertWrongOrigin(entryOf(answerOf(result), 'api-bot').trouble, made, other);
  for (const harness of HARNESSES) {
    assert.deepEqual(await namesIn(bots, 'api-bot', harness), [], 'and nothing of the old repository is linked');
  }
  assert.deepEqual(
    (await tabsOfBot(box, bots, 'api-bot')).map((tab) => tab.title),
    ['Api Bot daily'],
    'the bot comes up all the same',
  );
});
