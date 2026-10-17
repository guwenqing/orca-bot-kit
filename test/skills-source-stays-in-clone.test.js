// A skill linked from an online source comes from that source's pinned clone,
// and from nowhere else (#571).
//
// A source's `path` in skills.yaml, and the skill part of a `<source>:<skill>`
// entry, are joined onto the clone to find the skill. Neither may lead out of
// it: not by `..` segments, not by an absolute path, and not by a symlink the
// source repository committed. Where one would, `skills build` refuses that
// skill, names the source and makes no link in either harness's skills dir;
// `skills fetch` and `source add` refuse such a `path` too.
//
// Every skill a test plants outside the clone is a real skill directory, with
// a SKILL.md, so that where it lies is the only reason left to refuse it. And
// each refusal of build runs against a clone that fetch really made, with a
// `path` that fetch took, so "it was never fetched" is not a way to pass.
//
// The positive cases at the end are guards: they pass today, and they must
// still pass once the refusals are in.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import { assertRefused, createSandbox, skipGit, snapshot } from './helpers/cli.js';
import {
  addSkills,
  assertLinked,
  botYamlOf,
  HARNESSES,
  heldBy,
  namesIn,
  readThrough,
  SKILL_DIRS,
  writeSkill,
} from './helpers/skills.js';
import {
  cloneOf,
  commitIn,
  putFile,
  putSkills,
  repoAt,
  skillsYamlOf,
  sourcesTextIn,
  sourcesYaml,
  tagIn,
  writeSources,
} from './helpers/sources.js';

/** The source a test lists, the skill it ships, and what that skill says. */
const SOURCE = 'someones-skills';
const SKILL = 'their-skill';
const INSIDE = 'The skill as the pinned clone has it.';
const OUTSIDE = 'A skill from outside the clone, which no bot may be given.';

/** The bot a test gives the skill to. */
const BOT = 'api-bot';

/** A bots folder `init` made, with one bot in it besides Bot Father. */
async function seeded(box) {
  const init = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(init.code, 0, init.stderr);
  const made = await box.run([
    'bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude',
    '--charter', `${BOT} owns its own corner.`,
  ]);
  assert.equal(made.code, 0, made.stderr);
  return box.path('bots');
}

/**
 * A source repository at `<root>/<name>-repo`, tagged `v1.0.0`. `build` writes
 * into it before the one commit: skills, files, symlinks.
 */
async function sourceRepo(box, name, build) {
  const dir = path.join(box.root, `${name}-repo`);
  await repoAt(dir);
  await build(dir);
  await commitIn(dir, 'the only version');
  await tagIn(dir, 'v1.0.0');
  return dir;
}

/** A real skill directory at `dir`, saying `body`. */
const realSkillAt = (dir, body = OUTSIDE) => writeSkill(dir, { body });

const fetch = (box, ...rest) => box.run(['skills', 'fetch', '--bots', 'bots', ...rest]);

async function fetched(box, ...rest) {
  const result = await fetch(box, ...rest);
  assert.equal(result.code, 0, `the fetch should have gone through, got: ${result.stderr}${result.stdout}`);
}

const build = (box) => box.run(['skills', 'build', '--bots', 'bots', '--bot', BOT]);

/**
 * Set (or, with `undefined`, take away) one source's `path` in skills.yaml,
 * leaving everything else fetch wrote there (the sha beside the ref) as it is.
 */
async function setPathOf(bots, name, value) {
  const doc = parse(await readFile(skillsYamlOf(bots), 'utf8'));
  const entry = doc.sources.find((source) => source.name === name);
  assert.ok(entry, `skills.yaml should list ${name}`);
  if (value === undefined) delete entry.path;
  else entry.path = value;
  await writeFile(skillsYamlOf(bots), stringify(doc));
}

/** The bot has nothing at all in either harness's skills dir: no link, no entry of any kind. */
async function assertNothingLinked(bots, why) {
  for (const harness of HARNESSES) {
    assert.deepEqual(
      await namesIn(bots, BOT, harness),
      [],
      `${SKILL_DIRS[harness]} of ${BOT} should hold nothing: ${why}`,
    );
  }
}

/**
 * A build refused for this source: exit 1, a message naming the source, and no
 * link in either harness's skills dir.
 */
async function assertBuildRefused(box, bots, why) {
  const result = await build(box);
  assertRefused(result, SOURCE);
  await assertNothingLinked(bots, why);
}

/**
 * The common start of the `..` and absolute cases: one source with its skill
 * under `skills/`, listed with `path: skills`, fetched, and on the bot's list.
 * What build then meets is a clone that fetch really made.
 */
async function fetchedSource(box, bots) {
  const repo = await sourceRepo(box, SOURCE, (dir) => putSkills(dir, { [SKILL]: INSIDE }, 'skills'));
  await writeSources(bots, sourcesYaml({ name: SOURCE, repo, path: 'skills', ref: 'v1.0.0' }));
  await fetched(box);
  await addSkills(botYamlOf(bots, BOT), `${SOURCE}:${SKILL}`);
  return cloneOf(bots, SOURCE);
}

// --- Criterion 1 and 2: a `path` that leaves the repo is refused by build ----

test('#571 c1 build refuses a source whose path leaves the clone by .. segments, and links nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const clone = await fetchedSource(box, bots);
  // `../../outside`, joined onto the clone, is a real folder holding a real skill.
  await realSkillAt(path.join(path.dirname(path.dirname(clone)), 'outside', SKILL));
  await setPathOf(bots, SOURCE, '../../outside');

  await assertBuildRefused(box, bots, 'a path with .. segments leads out of the pinned clone');
});

test('#571 c1 build refuses a source whose path walks into another source\'s clone', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const other = 'other-skills';
  const otherRepo = await sourceRepo(box, other, (dir) => putSkills(dir, { [SKILL]: OUTSIDE }, 'skills'));
  const repo = await sourceRepo(box, SOURCE, (dir) => putSkills(dir, { [SKILL]: INSIDE }, 'skills'));
  await writeSources(bots, sourcesYaml(
    { name: other, repo: otherRepo, path: 'skills', ref: 'v1.0.0' },
    { name: SOURCE, repo, path: 'skills', ref: 'v1.0.0' },
  ));
  await fetched(box);
  assert.ok(existsSync(path.join(cloneOf(bots, other), 'skills', SKILL, 'SKILL.md')), 'the other clone holds the skill');
  await addSkills(botYamlOf(bots, BOT), `${SOURCE}:${SKILL}`);
  await setPathOf(bots, SOURCE, `../${other}/skills`);

  await assertBuildRefused(box, bots, `${SOURCE}'s skill may not come out of ${other}'s clone`);
});

test('#571 c2 build refuses a source whose path is absolute, even to a real skill, and links nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const shelf = path.join(box.root, 'elsewhere', 'skills');
  await realSkillAt(path.join(shelf, SKILL));
  // The repo also carries a real skill at `<repo>/<that absolute path>`, so
  // whether the path is resolved (landing on the shelf) or glued onto the clone
  // (landing inside it), a real skill is found: only refusing an absolute path
  // keeps the bot from being given one.
  const repo = await sourceRepo(box, SOURCE, async (dir) => {
    await putSkills(dir, { [SKILL]: INSIDE }, 'skills');
    await putSkills(dir, { [SKILL]: INSIDE }, shelf);
  });
  await writeSources(bots, sourcesYaml({ name: SOURCE, repo, path: 'skills', ref: 'v1.0.0' }));
  await fetched(box);
  await addSkills(botYamlOf(bots, BOT), `${SOURCE}:${SKILL}`);
  await setPathOf(bots, SOURCE, shelf);

  await assertBuildRefused(box, bots, 'an absolute path is outside the pinned clone');
});

// --- Criterion 1 and 2: fetch refuses the same paths -------------------------

for (const [label, pathFor] of [
  ['by .. segments', () => '../../outside'],
  ['into a sibling source\'s clone', () => '../other-skills/skills'],
  ['as an absolute path', (box) => path.join(box.root, 'elsewhere', 'skills')],
]) {
  test(`#571 c1/c2 fetch refuses a source whose path leaves the repo ${label}`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    const repo = await sourceRepo(box, SOURCE, (dir) => putSkills(dir, { [SKILL]: INSIDE }, 'skills'));
    // Each of these names a real folder with a real skill, once joined onto
    // where the clone goes, so a missing folder is not why it is refused.
    const target = pathFor(box);
    await realSkillAt(path.join(path.resolve(cloneOf(bots, SOURCE), target), SKILL));
    await writeSources(bots, sourcesYaml({ name: SOURCE, repo, path: target, ref: 'v1.0.0' }));

    const result = await fetch(box);

    assertRefused(result, SOURCE);
  });
}

// --- Criterion 3: source add refuses an escaping --path ----------------------

const REPO_URL = 'https://github.com/someone/skills';

for (const [label, pathFor] of [
  ['.. segments out of the repo', () => '../../outside'],
  ['.. into a sibling source', () => '../other-skills/skills'],
  ['.. after a folder name', () => 'skills/../../outside'],
  ['an absolute path', (box) => path.join(box.root, 'elsewhere', 'skills')],
]) {
  test(`#571 c3 source add refuses a --path with ${label}, and skills.yaml is left exactly as it was`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    const before = await sourcesTextIn(bots);

    const result = await box.run([
      'source', 'add', '--bots', 'bots', '--name', SOURCE, '--repo', REPO_URL, '--ref', 'v1.0.0',
      `--path=${pathFor(box)}`,
    ]);

    assertRefused(result, SOURCE);
    assert.equal(await sourcesTextIn(bots), before, 'the user\'s file is byte for byte as it was');
  });
}

test('#571 c3 source add refuses an escaping --path when there is no skills.yaml, and makes none', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await rm(skillsYamlOf(bots));
  const before = await snapshot(bots, skipGit);

  const result = await box.run([
    'source', 'add', '--bots', 'bots', '--name', SOURCE, '--repo', REPO_URL, '--ref', 'v1.0.0',
    '--path', '../../outside',
  ]);

  assertRefused(result, SOURCE);
  assert.equal(existsSync(skillsYamlOf(bots)), false, 'a refused add makes no skills.yaml');
  assert.deepEqual(await snapshot(bots, skipGit), before, 'and writes nothing else');
});

for (const given of ['skills', './skills', 'sub/../skills', '..foo']) {
  test(`#571 c3/c8 source add still takes --path ${given}, which stays inside the repo`, async (t) => {
    // The other half of the pair: a path inside the repo is written down. `..foo`
    // is a folder name, not a walk up the tree.
    const box = await createSandbox(t);
    const bots = await seeded(box);

    const result = await box.run([
      'source', 'add', '--bots', 'bots', '--name', SOURCE, '--repo', REPO_URL, '--ref', 'v1.0.0',
      `--path=${given}`,
    ]);

    assert.equal(result.code, 0, `${result.stderr}${result.stdout}`);
    const doc = parse(await sourcesTextIn(bots));
    assert.equal(doc.sources.length, 1, `skills.yaml should list the one source, got:\n${await sourcesTextIn(bots)}`);
    assert.equal(doc.sources[0].name, SOURCE);
    assert.equal(typeof doc.sources[0].path, 'string', 'and carry the path it was given');
  });
}

// --- Criterion 4 and 5: a committed symlink out of the clone -----------------

test('#571 c4 build refuses a source whose path is a committed symlink to a folder outside the clone', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const shelf = path.join(box.root, 'outside-shelf');
  await realSkillAt(path.join(shelf, SKILL));
  const repo = await sourceRepo(box, SOURCE, async (dir) => {
    await putFile(dir, 'README.md', 'A shelf whose skills folder is somewhere else.\n');
    await symlink(shelf, path.join(dir, 'skills'));
  });
  await writeSources(bots, sourcesYaml({ name: SOURCE, repo, path: 'skills', ref: 'v1.0.0' }));
  // Not asserted: fetch may refuse this source already, which is fine. Build
  // must refuse it either way.
  await fetch(box);
  await addSkills(botYamlOf(bots, BOT), `${SOURCE}:${SKILL}`);

  await assertBuildRefused(box, bots, 'the path is inside the clone only until the symlink is followed');
});

test('#571 c5 build refuses a skill whose directory in the clone is a committed symlink to a skill outside it', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const outside = path.join(box.root, 'outside-shelf', SKILL);
  await realSkillAt(outside);
  const repo = await sourceRepo(box, SOURCE, async (dir) => {
    await putSkills(dir, { 'a-real-one': INSIDE }, 'skills');
    await symlink(outside, path.join(dir, 'skills', SKILL));
  });
  await writeSources(bots, sourcesYaml({ name: SOURCE, repo, path: 'skills', ref: 'v1.0.0' }));
  await fetch(box);
  await addSkills(botYamlOf(bots, BOT), `${SOURCE}:${SKILL}`);

  await assertBuildRefused(box, bots, 'the skill directory leads out of the clone once its symlink is followed');
});

// --- Criterion 6: the skill part of the entry cannot escape ------------------

test('#571 c6 build refuses <source>:../../outside, a real skill outside the clone', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const repo = await sourceRepo(box, SOURCE, (dir) => putSkills(dir, { [SKILL]: INSIDE }));
  await writeSources(bots, sourcesYaml({ name: SOURCE, repo, ref: 'v1.0.0' }));
  await fetched(box);
  // `<clone>/../../outside` is a real skill directory, so its name is a valid skill name.
  await realSkillAt(path.join(path.dirname(path.dirname(cloneOf(bots, SOURCE))), 'outside'));
  await addSkills(botYamlOf(bots, BOT), `${SOURCE}:../../outside`);

  await assertBuildRefused(box, bots, 'the skill part of the entry leads out of the clone');
  for (const harness of HARNESSES) {
    assert.equal((await heldBy(bots, BOT, harness)).get('outside'), undefined, `no ${SKILL_DIRS[harness]}/outside`);
  }
});

test('#571 c6 build refuses <source>:../<other-source>/<skill>, a skill in a sibling clone', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const other = 'other-skills';
  const otherRepo = await sourceRepo(box, other, (dir) => putSkills(dir, { 'borrowed-skill': OUTSIDE }));
  const repo = await sourceRepo(box, SOURCE, (dir) => putSkills(dir, { [SKILL]: INSIDE }));
  await writeSources(bots, sourcesYaml(
    { name: other, repo: otherRepo, ref: 'v1.0.0' },
    { name: SOURCE, repo, ref: 'v1.0.0' },
  ));
  await fetched(box);
  await addSkills(botYamlOf(bots, BOT), `${SOURCE}:../${other}/borrowed-skill`);

  await assertBuildRefused(box, bots, `a skill named from ${SOURCE} may not come out of ${other}'s clone`);
});

// --- Criterion 7: a sibling clone whose name starts with the same text --------

test('#571 c7 a symlink from abc into abc-two counts as outside abc\'s clone, and is refused', async (t) => {
  // `<sources>/abc-two/...` starts with the text `<sources>/abc`, and is still
  // not inside it.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const twoRepo = await sourceRepo(box, 'abc-two', (dir) => putSkills(dir, { [SKILL]: OUTSIDE }, 'skills'));
  const abcRepo = await sourceRepo(box, 'abc', async (dir) => {
    await putFile(dir, 'README.md', 'A shelf whose skills folder is in its neighbour.\n');
    await symlink(path.join('..', 'abc-two', 'skills'), path.join(dir, 'skills'));
  });
  await writeSources(bots, sourcesYaml(
    { name: 'abc-two', repo: twoRepo, path: 'skills', ref: 'v1.0.0' },
    { name: 'abc', repo: abcRepo, path: 'skills', ref: 'v1.0.0' },
  ));
  // abc-two first, so the link in abc lands on a real folder. abc's own fetch
  // is not asserted: it may refuse already, which is fine.
  await fetched(box, '--source', 'abc-two');
  await fetch(box, '--source', 'abc');
  await addSkills(botYamlOf(bots, BOT), `abc:${SKILL}`);

  const result = await build(box);

  assertRefused(result, 'abc');
  await assertNothingLinked(bots, 'abc\'s skill may not come out of abc-two\'s clone');
});

// --- Criterion 8: paths that stay inside the clone are linked as today -------

for (const [label, given, lay] of [
  ['path: skills', 'skills', (dir) => putSkills(dir, { [SKILL]: INSIDE }, 'skills')],
  ['path: ./skills', './skills', (dir) => putSkills(dir, { [SKILL]: INSIDE }, 'skills')],
  ['path: sub/../skills', 'sub/../skills', async (dir) => {
    await putFile(dir, path.join('sub', 'README.md'), 'A folder the path walks through.\n');
    await putSkills(dir, { [SKILL]: INSIDE }, 'skills');
  }],
  ['a folder literally named ..foo', '..foo', (dir) => putSkills(dir, { [SKILL]: INSIDE }, '..foo')],
  ['no path at all', undefined, (dir) => putSkills(dir, { [SKILL]: INSIDE })],
  ['a path that is a symlink to another folder in the same clone', 'skills', async (dir) => {
    await putSkills(dir, { [SKILL]: INSIDE }, 'real-shelf');
    await symlink('real-shelf', path.join(dir, 'skills'));
  }],
]) {
  test(`#571 c8 a source with ${label} is still linked into both harnesses`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    const repo = await sourceRepo(box, SOURCE, lay);
    await writeSources(bots, sourcesYaml({
      name: SOURCE,
      repo,
      ...(given === undefined ? {} : { path: given }),
      ref: 'v1.0.0',
    }));
    await fetched(box);
    await addSkills(botYamlOf(bots, BOT), `${SOURCE}:${SKILL}`);

    const result = await build(box);

    assert.equal(result.code, 0, `${result.stderr}${result.stdout}`);
    const skillDir = path.join(cloneOf(bots, SOURCE), given ?? '', SKILL);
    assert.ok(
      (await realpath(skillDir)).startsWith(`${await realpath(cloneOf(bots, SOURCE))}${path.sep}`),
      'the fixture itself keeps the skill inside the clone',
    );
    await assertLinked(bots, BOT, SKILL, skillDir);
    for (const harness of HARNESSES) {
      assert.ok(
        (await readThrough(bots, BOT, harness, SKILL)).includes(INSIDE),
        `${harness} should read the skill out of the pinned clone`,
      );
    }
  });
}
