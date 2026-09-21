// `obk skills build --bots <path> [--bot <bot>]` gives every bot the skills its
// lists name, linked into both harnesses' skills directories inside the bot
// home (PRD 6.7, ADR 0004, ADR 0009).
//
// What is worth pinning hard is the two directions of "linked, never copied".
// Inwards: what lands in the bot home is a symlink to the skill's own
// directory, so an edit to the skill is what a running session reads, and a kit
// skill is read where the package installed it rather than copied into the
// user's repo. Outwards: the kit takes away only what it put there, and never
// the skill it was pointing at — a removal that followed a link would delete
// the user's common skill, or one of the kit's own.
//
// Everything here goes through the CLI on a sandboxed bots folder. The command
// writes links and never talks to Orca, so the fake Orca is only ever asked to
// prove it was not called.
//
// One house rule for the setup: every bot is created before its lists are
// written, because `bot create` links too — a test that added a skill first
// would be watching the create rather than the build.

import assert from 'node:assert/strict';
import { lstat, lutimes, mkdir, readFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  assertCleanFailure,
  botHomeOf,
  createSandbox,
  skipGit,
  snapshot,
} from './helpers/cli.js';
import {
  addSkills,
  answerOf,
  assertLinked,
  assertNotThere,
  botsIn,
  botYamlOf,
  commonSkill,
  defaultsOf,
  entryOf,
  HARNESSES,
  heldBy,
  kitSkill,
  linesAbout,
  namesIn,
  readThrough,
  setSkills,
  skillIn,
  SKILL_DIRS,
  skillNamesIn,
  skillsDirOf,
  writeSkill,
} from './helpers/skills.js';

/** One of the kit's own skills, named here so a test that meets it says which. */
const KIT_SKILL = 'obk-tdd';

/** A bots folder `init` made, with Bot Father in it. */
async function seeded(box) {
  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(result.code, 0, result.stderr);
  return box.path('bots');
}

/** One more bot. */
async function makeBot(box, name) {
  const result = await box.run([
    'bot', 'create', '--bots', 'bots', '--name', name, '--harness', 'claude',
    '--charter', `${name} owns its own corner.`,
  ]);
  assert.equal(result.code, 0, result.stderr);
}

/** `obk skills build`, with whatever else the test wants to say. */
const build = (box, ...rest) => box.run(['skills', 'build', '--bots', 'bots', ...rest]);

/** A build a test needs to have happened before the part it is about. */
async function buildOk(box, ...rest) {
  const result = await build(box, ...rest);
  assert.equal(result.code, 0, `the build should have gone through, got: ${result.stderr}`);
  return result;
}

/**
 * One skill of each of the three kinds, and the lists that name them: the kit's
 * own, one in the user's common folder, and one anywhere else on disk.
 */
async function threeSources(box, bots, bot) {
  const kit = await kitSkill(KIT_SKILL);
  const common = await commonSkill(bots, 'house-style');
  const anywhere = await writeSkill(path.join(box.root, 'elsewhere', 'deploy-notes'));
  await addSkills(defaultsOf(bots), `kit:${KIT_SKILL}`, 'house-style');
  await addSkills(botYamlOf(bots, bot), anywhere);
  return { kit, common, anywhere };
}

test('a kit skill, a common skill and a path skill are each linked into both harnesses', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  const { kit, common, anywhere } = await threeSources(box, bots, 'api-bot');

  const result = await build(box, '--bot', 'api-bot');

  assert.equal(result.code, 0, result.stderr);
  await assertLinked(bots, 'api-bot', KIT_SKILL, kit);
  await assertLinked(bots, 'api-bot', 'house-style', common);
  await assertLinked(bots, 'api-bot', 'deploy-notes', anywhere);

  // The name is the last segment of what the entry points at, and nothing else
  // is in the directory: a skill loads under the name of the folder it is in.
  for (const harness of HARNESSES) {
    assert.deepEqual(
      await namesIn(bots, 'api-bot', harness),
      ['deploy-notes', 'house-style', KIT_SKILL],
      `${harness} should read those three skills and nothing else`,
    );
  }

  // ADR 0004: a kit skill stays in the installed package, which is outside the
  // user's repo, so the link to it cannot be a relative one.
  const held = (await heldBy(bots, 'api-bot', 'claude')).get(KIT_SKILL);
  assert.ok(
    path.isAbsolute(held.target),
    `a kit skill lives outside the bots folder, so its link is absolute, got: ${held.target}`,
  );
});

for (const [label, spell] of [
  ['relative to the bots folder', (box) => ({ at: path.join(box.cwd, 'beside', 'road-map'), entry: '../beside/road-map' })],
  ['starting at ~', (box) => ({ at: path.join(box.home, 'skills', 'road-map'), entry: '~/skills/road-map' })],
  ['absolute', (box) => ({ at: path.join(box.root, 'elsewhere', 'road-map'), entry: path.join(box.root, 'elsewhere', 'road-map') })],
]) {
  test(`a path ${label} reaches the skill it names`, async (t) => {
    // The three spellings a user writes. The relative one is the one a test
    // can get wrong quietly: read from the working directory instead of the
    // bots folder it belongs to, it lands somewhere else entirely.
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await makeBot(box, 'api-bot');
    const { at, entry } = spell(box);
    await writeSkill(at);
    await addSkills(botYamlOf(bots, 'api-bot'), entry);

    const result = await build(box, '--bot', 'api-bot');

    assert.equal(result.code, 0, result.stderr);
    await assertLinked(bots, 'api-bot', 'road-map', at);
  });
}

test('the two lists are read in order, and a skill named twice is linked once', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  const kit = await kitSkill(KIT_SKILL);
  const alpha = await commonSkill(bots, 'alpha-notes');
  const zulu = await commonSkill(bots, 'zulu-notes');
  await addSkills(defaultsOf(bots), 'alpha-notes', `kit:${KIT_SKILL}`);
  // `alpha-notes` is named in both lists, and the bot's own list names one more.
  await addSkills(botYamlOf(bots, 'api-bot'), 'alpha-notes', 'zulu-notes');

  const result = await build(box, '--bot', 'api-bot', '--json');

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(
    skillNamesIn(entryOf(answerOf(result), 'api-bot')),
    ['alpha-notes', KIT_SKILL, 'zulu-notes'],
    'defaults.yaml in the order written, then the bot\'s own, each skill named once',
  );
  await assertLinked(bots, 'api-bot', 'alpha-notes', alpha);
  await assertLinked(bots, 'api-bot', KIT_SKILL, kit);
  await assertLinked(bots, 'api-bot', 'zulu-notes', zulu);
});

test('a skill changed after the build is what a session reads through the link', async (t) => {
  // The acceptance for this slice: a changed skill shows up in a running
  // session without a restart. Both harnesses follow a symlinked skill folder
  // and watch it (tech notes 2 and 3), so what the kit owes is a link to the
  // skill itself rather than a copy of it taken at build time.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  const common = await commonSkill(bots, 'house-style', { body: 'The first thing I wrote.' });
  await addSkills(botYamlOf(bots, 'api-bot'), 'house-style');
  await buildOk(box, '--bot', 'api-bot');

  await writeSkill(common, { body: 'What I changed my mind to, with no build in between.' });

  for (const harness of HARNESSES) {
    assert.ok(
      (await readThrough(bots, 'api-bot', harness, 'house-style')).includes('What I changed my mind to'),
      `${harness} should read the skill as it is now, not as it was when the build ran`,
    );
  }
});

test('a build that has already been done changes nothing when it is run again', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  await threeSources(box, bots, 'api-bot');
  await buildOk(box);
  const before = await snapshot(bots, skipGit);

  const result = await build(box);

  assert.equal(result.code, 0, `a link that is already there is not trouble: ${result.stderr}`);
  assert.deepEqual(await snapshot(bots, skipGit), before, 'the second run should leave the folder exactly as the first did');
});

test('a link that already says the right thing is not written again', async (t) => {
  // Not the same as the tree being unchanged, which the test above checks: an
  // unlink and an identical relink leaves exactly that tree, and is every
  // skill of every bot disappearing and coming back on every build and every
  // `up`. Both harnesses watch these directories and read a change as it
  // happens (tech notes 2 and 3), so a session in the middle of a turn sees
  // its skills go. What tells a rewrite from a run that let the link be is the
  // time on the link itself — `lutimes` and `lstat`, so it is the link's own
  // time and not the skill's.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  await threeSources(box, bots, 'api-bot');
  await buildOk(box);

  const when = new Date('2020-01-01T00:00:00Z');
  const links = [];
  for (const harness of HARNESSES) {
    for (const name of [KIT_SKILL, 'house-style', 'deploy-notes']) {
      const at = path.join(skillsDirOf(bots, 'api-bot', harness), name);
      await lutimes(at, when, when);
      links.push(at);
    }
  }

  const result = await build(box);

  assert.equal(result.code, 0, result.stderr);
  for (const at of links) {
    assert.equal(
      (await lstat(at)).mtimeMs,
      when.getTime(),
      `${path.relative(bots, at)} already pointed at the skill it should, so the build should not have written the link again`,
    );
  }
});

test('a skill taken out of the lists loses its links, and the skill itself is untouched', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  const kit = await kitSkill(KIT_SKILL);
  const common = await commonSkill(bots, 'house-style');
  await addSkills(botYamlOf(bots, 'api-bot'), `kit:${KIT_SKILL}`, 'house-style');
  await buildOk(box, '--bot', 'api-bot');
  await assertLinked(bots, 'api-bot', KIT_SKILL, kit);

  await setSkills(botYamlOf(bots, 'api-bot'));
  const result = await build(box, '--bot', 'api-bot');

  assert.equal(result.code, 0, result.stderr);
  await assertNotThere(bots, 'api-bot', KIT_SKILL);
  await assertNotThere(bots, 'api-bot', 'house-style');
  // What it took away is named, or the user has no way of knowing it went.
  for (const name of [KIT_SKILL, 'house-style']) linesAbout(result.stdout, name);

  // A removal that followed the link instead of taking it away would delete the
  // kit's own skill from the installed package, and the user's from their repo.
  assert.ok(
    (await readFile(path.join(kit, 'SKILL.md'), 'utf8')).trim() !== '',
    `the kit's own ${KIT_SKILL} should still be in the package`,
  );
  assert.ok(
    (await readFile(path.join(common, 'SKILL.md'), 'utf8')).trim() !== '',
    'the user\'s common skill should still be in their bots folder',
  );
});

test('what the user put in a skills directory by hand is left alone, and reported as not managed', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  // A skill of their own in one harness, and a link of their own to somewhere
  // the kit never points, in the other. Neither name is in any list.
  await writeSkill(path.join(skillsDirOf(bots, 'api-bot', 'claude'), 'mine'));
  const theirs = await writeSkill(path.join(box.root, 'theirs', 'borrowed'));
  await mkdir(skillsDirOf(bots, 'api-bot', 'codex'), { recursive: true });
  await symlink(theirs, path.join(skillsDirOf(bots, 'api-bot', 'codex'), 'borrowed'));
  await addSkills(botYamlOf(bots, 'api-bot'), `kit:${KIT_SKILL}`);
  const before = await snapshot(botHomeOf(bots, 'api-bot'), skipGit);

  const result = await build(box, '--bot', 'api-bot', '--json');

  assert.equal(result.code, 0, `a skill the user placed is not trouble: ${result.stderr}`);
  const entry = entryOf(answerOf(result), 'api-bot');
  assert.equal(skillIn(entry, 'mine').managed, false, 'a directory the user made is theirs');
  assert.equal(skillIn(entry, 'borrowed').managed, false, 'and so is a link of theirs pointing where the kit never points');
  assert.equal(skillIn(entry, KIT_SKILL).managed, true, 'while the one the kit linked is the kit\'s');

  const after = await snapshot(botHomeOf(bots, 'api-bot'), skipGit);
  for (const [dir, name] of [[SKILL_DIRS.claude, 'mine'], [SKILL_DIRS.codex, 'borrowed']]) {
    const held = Object.keys(before).filter((rel) => rel === `${dir}/${name}` || rel.startsWith(`${dir}/${name}/`));
    assert.notDeepEqual(held, [], `the test should have put ${name} in ${dir}`);
    for (const rel of held) assert.equal(after[rel], before[rel], `${rel} is the user's, and is never touched`);
  }
});

test('every bot is reported, in name order, with where each skill came from, and --json says the same', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'zebra-bot');
  await makeBot(box, 'api-bot');
  await threeSources(box, bots, 'api-bot');

  const plain = await build(box);

  assert.equal(plain.code, 0, plain.stderr);
  const order = ['api-bot', 'bot-father', 'zebra-bot'];
  for (const bot of order) linesAbout(plain.stdout, bot);
  assert.deepEqual(
    order.slice().sort((one, other) => plain.stdout.indexOf(one) - plain.stdout.indexOf(other)),
    order,
    `the bots should be reported in name order, got:\n${plain.stdout}`,
  );
  for (const [name, from] of [[KIT_SKILL, 'kit'], ['house-style', 'common'], ['deploy-notes', 'path']]) {
    for (const line of plain.stdout.split('\n').filter((line) => line.includes(name))) {
      assert.ok(line.includes(from), `a line about ${name} should say it came from ${from}, got: ${line}`);
    }
  }

  const other = await createSandbox(t);
  const theirs = await seeded(other);
  await makeBot(other, 'zebra-bot');
  await makeBot(other, 'api-bot');
  await threeSources(other, theirs, 'api-bot');
  const asJson = await build(other, '--json');

  assert.equal(asJson.code, 0, asJson.stderr);
  const answer = answerOf(asJson);
  assert.deepEqual(botsIn(answer), order, 'the same bots, in the same order');
  const entry = entryOf(answer, 'api-bot');
  for (const [name, from] of [[KIT_SKILL, 'kit'], ['house-style', 'common'], ['deploy-notes', 'path']]) {
    assert.equal(skillIn(entry, name).from, from, `${name} came from ${from}`);
    assert.equal(skillIn(entry, name).managed, true, `and the kit put ${name} there`);
  }
  assert.ok(!('trouble' in entry), `a bot whose skills are in place has nothing to say about trouble, got: ${JSON.stringify(entry)}`);
  assert.deepEqual(
    skillNamesIn(entryOf(answer, 'zebra-bot')),
    [KIT_SKILL, 'house-style'],
    'a bot whose own list is empty still carries what defaults.yaml names',
  );
});

for (const [label, put, named] of [
  ['a name no common folder holds', async () => 'ghost-skill', 'ghost-skill'],
  ['a kit skill the package does not ship', async () => `kit:${KIT_SKILL}-nothing-like-it`, `${KIT_SKILL}-nothing-like-it`],
  ['a path that is not there', async (box) => path.join(box.root, 'elsewhere', 'never-written'), 'never-written'],
  ['a directory with no SKILL.md', async (box) => {
    const dir = path.join(box.root, 'elsewhere', 'no-manifest');
    await mkdir(dir, { recursive: true });
    return dir;
  }, 'no-manifest'],
  ['a directory whose name is no skill name', async (box) => writeSkill(path.join(box.root, 'elsewhere', 'My_Skill')), 'My_Skill'],
]) {
  test(`${label} stops that bot and not the others`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await makeBot(box, 'api-bot');
    await makeBot(box, 'web-bot');
    const kit = await kitSkill(KIT_SKILL);
    await addSkills(defaultsOf(bots), `kit:${KIT_SKILL}`);
    await addSkills(botYamlOf(bots, 'api-bot'), await put(box));

    const result = await build(box, '--json');

    assert.equal(result.code, 1, 'a bot that could not be done ends the run in 1');
    const answer = answerOf(result);
    const entry = entryOf(answer, 'api-bot');
    assert.equal(typeof entry.trouble, 'string', `it should say what is wrong, got: ${JSON.stringify(entry)}`);
    assert.ok(entry.trouble.includes(named), `the trouble should name the entry, got: ${entry.trouble}`);

    // Every bot is reported, and the ones with nothing wrong are done.
    assert.deepEqual(botsIn(answer), ['api-bot', 'bot-father', 'web-bot'], 'the run reports every bot before it ends');
    for (const bot of ['bot-father', 'web-bot']) {
      assert.ok(!('trouble' in entryOf(answer, bot)), `one bot's bad list is not another bot's problem, got: ${JSON.stringify(entryOf(answer, bot))}`);
      await assertLinked(bots, bot, KIT_SKILL, kit);
    }
    for (const harness of HARNESSES) {
      assert.deepEqual(
        await namesIn(bots, 'api-bot', harness),
        [],
        'a list the kit cannot follow stops the bot: half its skills is not a bot anybody asked for',
      );
    }
  });
}

test('--bot does the one bot, and leaves the others where they were', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  await makeBot(box, 'web-bot');
  const kit = await kitSkill(KIT_SKILL);
  await addSkills(defaultsOf(bots), `kit:${KIT_SKILL}`);

  const result = await build(box, '--bot', 'api-bot', '--json');

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(botsIn(answerOf(result)), ['api-bot'], 'only the bot that was asked for is reported');
  await assertLinked(bots, 'api-bot', KIT_SKILL, kit);
  await assertNotThere(bots, 'web-bot', KIT_SKILL);
});

test('skills build never talks to Orca, and works with Orca down', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  const kit = await kitSkill(KIT_SKILL);
  await addSkills(defaultsOf(bots), `kit:${KIT_SKILL}`);
  await box.orca.set({ reachable: false, setups: [], terminals: [] });
  const calls = (await box.orca.calls()).length;

  const result = await build(box);

  assert.equal(result.code, 0, `an Orca that is down is nothing to skills build: ${result.stderr}`);
  await assertLinked(bots, 'api-bot', KIT_SKILL, kit);
  assert.equal((await box.orca.calls()).length, calls, 'skills build must not call Orca at all');
});

test('skills build without --bots fails and says so', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['skills', 'build']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('--bots'), `should name --bots, got: ${result.stderr}`);
});
