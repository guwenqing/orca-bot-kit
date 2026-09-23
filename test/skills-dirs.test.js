// Every bot has both skills directories, `.claude/skills` and `.agents/skills`,
// once the kit has built its skills — whether or not it has any skills yet
// (PRD 4.6, PRD 6.7).
//
// The reason is in the tech notes: both harnesses pick up a skill added while a
// session runs only if the skills directory was there when the session began,
// and neither starts watching one made afterwards. A bot that started with no
// skills and no directory could not use the first skill it was given without a
// restart. So the empty directory is not clutter: it is what the harness is
// watching. And it has to stay the same directory — adding a skill puts the
// link inside it, and never swaps it for a new one, which the running session
// would not be watching.
//
// What does not change: nothing of the user's at either path is touched, git
// is given nothing new (it tracks no empty directory, and the root .gitignore
// keeps what goes inside out of it), and a second build does nothing.
//
// Every command that builds a bot's skills is covered: `skills build`, `bot
// create`, `up`, and `init`, which brings Bot Father up.

import assert from 'node:assert/strict';
import { lstat, mkdir, readdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  bookOf,
  botHomeOf,
  createSandbox,
  skipGit,
  snapshot,
  tabsOfBot,
} from './helpers/cli.js';
import { commitIn, gitOk } from './helpers/sources.js';
import {
  addSkills,
  answerOf,
  assertLinked,
  botYamlOf,
  entryOf,
  HARNESSES,
  kitSkill,
  setSkills,
  SKILL_DIRS,
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

/** One more bot, whose lists name nothing. */
async function makeBot(box, name, ...rest) {
  const result = await box.run([
    'bot', 'create', '--bots', 'bots', '--name', name, '--harness', 'claude',
    '--charter', `${name} owns its own corner.`, ...rest,
  ]);
  assert.equal(result.code, 0, result.stderr);
  return result;
}

/** `obk skills build`, with whatever else the test wants to say. */
const build = (box, ...rest) => box.run(['skills', 'build', '--bots', 'bots', ...rest]);

/**
 * Take a bot's two skills directories away, so the bot is one made before the
 * kit gave every bot them. Only the skills directories: whatever else is in
 * `.claude` or `.agents` stays.
 */
async function withoutSkillsDirs(bots, bot) {
  for (const harness of HARNESSES) await rm(skillsDirOf(bots, bot, harness), { recursive: true, force: true });
}

/**
 * Both skills directories are there, as real directories and not links, and
 * hold nothing. Answers each one's inode, by harness, for a test that has to
 * know it is the same directory later.
 */
async function assertEmptyDirs(bots, bot, why) {
  const inodes = {};
  for (const harness of HARNESSES) {
    const dir = skillsDirOf(bots, bot, harness);
    const found = await lstat(dir).catch(() => undefined);
    assert.ok(found !== undefined, `${bot} should have ${SKILL_DIRS[harness]} ${why}, and there is nothing there`);
    assert.ok(found.isDirectory(), `${bot}'s ${SKILL_DIRS[harness]} should be a directory of its own, not a link or a file`);
    assert.deepEqual(await readdir(dir), [], `${bot}'s ${SKILL_DIRS[harness]} should be empty: the bot has no skills`);
    inodes[harness] = found.ino;
  }
  return inodes;
}

/** Each skills directory's inode, by harness: which directory it is, not only that one is there. */
async function inodesOf(bots, bot) {
  const inodes = {};
  for (const harness of HARNESSES) inodes[harness] = (await lstat(skillsDirOf(bots, bot, harness))).ino;
  return inodes;
}

test('skills build gives a bot with no skills both skills directories, empty', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  await withoutSkillsDirs(bots, 'api-bot');

  const result = await build(box);

  assert.equal(result.code, 0, `${result.stderr}${result.stdout}`);
  await assertEmptyDirs(bots, 'api-bot', 'after a build');
});

test('bot create gives a new bot whose lists name nothing both skills directories, empty', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);

  await makeBot(box, 'api-bot');

  await assertEmptyDirs(bots, 'api-bot', 'as soon as it is made');
});

test('up gives a bot with no skills both skills directories before its session starts', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily']);
  assert.equal(added.code, 0, added.stderr);
  await withoutSkillsDirs(bots, 'api-bot');

  const result = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(result.code, 0, `${result.stderr}${result.stdout}`);
  await assertEmptyDirs(bots, 'api-bot', 'once up has brought it up');
});

test('init gives a Bot Father with no skills both skills directories', async (t) => {
  // A Bot Father from an older kit: its list is empty, and init leaves a list
  // it did not write alone. It is still brought up, and the directories are
  // what a skill given to it later is found through.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await setSkills(botYamlOf(bots, 'bot-father'));
  const emptied = await build(box, '--bot', 'bot-father');
  assert.equal(emptied.code, 0, `${emptied.stderr}${emptied.stdout}`);
  await withoutSkillsDirs(bots, 'bot-father');
  await rm(bookOf(bots));
  await box.orca.set({ setups: [], terminals: [] });

  const again = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assert.equal(again.code, 0, `${again.stderr}${again.stdout}`);
  await assertEmptyDirs(bots, 'bot-father', 'once init has brought it up');
});

test('a skill given to a bot that had none goes into the directory that was already there', async (t) => {
  // The case the directories exist for. A session of this bot started while it
  // had no skills, and is watching the directories it found. The link has to
  // land in those very directories: a new one in the same place is one no
  // running session is watching.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  const built = await build(box);
  assert.equal(built.code, 0, `${built.stderr}${built.stdout}`);
  const watched = await assertEmptyDirs(bots, 'api-bot', 'before it is given anything');

  const added = await box.run(['skills', 'add', '--bots', 'bots', '--bot', 'api-bot', '--skill', `kit:${KIT_SKILL}`]);
  assert.equal(added.code, 0, added.stderr);
  const result = await build(box);

  assert.equal(result.code, 0, `${result.stderr}${result.stdout}`);
  await assertLinked(bots, 'api-bot', KIT_SKILL, await kitSkill(KIT_SKILL));
  assert.deepEqual(
    await inodesOf(bots, 'api-bot'),
    watched,
    'the link should be inside the directories the session is watching, not in new ones made in their place',
  );
});

test('a bot whose last skill is taken off keeps its skills directories', async (t) => {
  // The same thing the other way round: going back to no skills is not a
  // reason to take the directories away, or the next skill given is one a
  // running session cannot see.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  await addSkills(botYamlOf(bots, 'api-bot'), `kit:${KIT_SKILL}`);
  const first = await build(box);
  assert.equal(first.code, 0, `${first.stderr}${first.stdout}`);
  const watched = await inodesOf(bots, 'api-bot');
  await setSkills(botYamlOf(bots, 'api-bot'));

  const result = await build(box);

  assert.equal(result.code, 0, `${result.stderr}${result.stdout}`);
  await assertEmptyDirs(bots, 'api-bot', 'after its last skill is taken off');
  assert.deepEqual(await inodesOf(bots, 'api-bot'), watched, 'and they are the same directories they were');
});

test('a second build of a bot with no skills writes nothing and changes nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  const first = await build(box);
  assert.equal(first.code, 0, `${first.stderr}${first.stdout}`);
  const watched = await assertEmptyDirs(bots, 'api-bot', 'after the first build');
  const before = await snapshot(bots, skipGit);

  const result = await build(box, '--json');

  assert.equal(result.code, 0, `${result.stderr}${result.stdout}`);
  assert.ok(!('trouble' in entryOf(answerOf(result), 'api-bot')), 'an empty directory is not trouble');
  assert.deepEqual(await snapshot(bots, skipGit), before, 'the second run should leave the folder exactly as the first did');
  assert.deepEqual(await inodesOf(bots, 'api-bot'), watched, 'and the directories are not made again');
});

test('the directories give git nothing new to commit', async (t) => {
  // Git tracks no empty directory, and the root .gitignore keeps what goes in
  // one out of it, so a bot given its directories is a repo with nothing new.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  await withoutSkillsDirs(bots, 'api-bot');
  await commitIn(bots, 'my bots, before the build');

  const result = await build(box);

  assert.equal(result.code, 0, `${result.stderr}${result.stdout}`);
  await assertEmptyDirs(bots, 'api-bot', 'after a build');
  assert.equal(
    await gitOk(['status', '--porcelain', '--untracked-files=all'], bots),
    '',
    'making the skills directories leaves the repo with nothing to commit',
  );
});

test('a .claude/skills that is a file of the user\'s is reported, and left as it is', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  await withoutSkillsDirs(bots, 'api-bot');
  const theirs = skillsDirOf(bots, 'api-bot', 'claude');
  await mkdir(path.dirname(theirs), { recursive: true });
  await writeFile(theirs, 'mine, not a directory\n');

  const result = await build(box, '--json');

  assert.equal(result.code, 1, 'a bot the kit could not give its directories ends the run in 1');
  const entry = entryOf(answerOf(result), 'api-bot');
  assert.equal(typeof entry.trouble, 'string', `it should say what is wrong, got: ${JSON.stringify(entry)}`);
  assert.ok(entry.trouble.includes(theirs), `and name the path, got: ${entry.trouble}`);
  assert.equal(await readFile(theirs, 'utf8'), 'mine, not a directory\n', 'the user\'s file is never written over');
  assert.ok((await lstat(theirs)).isFile(), 'and it is still a file');
});

test('a .claude that is a file of the user\'s is reported, and left as it is', async (t) => {
  // The directory cannot be made without replacing what is in its way. A bot
  // whose skills directory cannot be there is a bot that cannot be given a
  // skill without a restart, which is worth saying rather than passing over.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  const theirs = path.join(botHomeOf(bots, 'api-bot'), '.claude');
  await rm(theirs, { recursive: true, force: true });
  await writeFile(theirs, 'mine, not a directory\n');

  const result = await build(box, '--json');

  assert.equal(result.code, 1, 'a bot the kit could not give its directories ends the run in 1');
  const entry = entryOf(answerOf(result), 'api-bot');
  assert.equal(typeof entry.trouble, 'string', `it should say what is wrong, got: ${JSON.stringify(entry)}`);
  assert.ok(entry.trouble.includes(theirs), `and name the path, got: ${entry.trouble}`);
  assert.equal(await readFile(theirs, 'utf8'), 'mine, not a directory\n', 'the user\'s file is never written over');
});

test('a skills directory that is the user\'s own link is left pointing where they pointed it', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  await withoutSkillsDirs(bots, 'api-bot');
  const shelf = path.join(box.root, 'elsewhere', 'my-skills');
  await writeSkill(path.join(shelf, 'my-own'));
  const before = await snapshot(shelf);
  const theirs = skillsDirOf(bots, 'api-bot', 'claude');
  await mkdir(path.dirname(theirs), { recursive: true });
  await symlink(shelf, theirs);

  const result = await build(box);

  assert.equal(result.code, 0, `${result.stderr}${result.stdout}`);
  assert.ok((await lstat(theirs)).isSymbolicLink(), `${SKILL_DIRS.claude} should still be the user's link`);
  assert.equal(await readlink(theirs), shelf, 'pointing where they pointed it');
  assert.deepEqual(await snapshot(shelf), before, 'and nothing is written into what it points at');
  const codex = await lstat(skillsDirOf(bots, 'api-bot', 'codex')).catch(() => undefined);
  assert.ok(codex?.isDirectory(), `the other harness still gets its ${SKILL_DIRS.codex}`);
});

test('what the user keeps beside the skills directory is left as it is', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  await withoutSkillsDirs(bots, 'api-bot');
  const home = botHomeOf(bots, 'api-bot');
  for (const harness of HARNESSES) {
    const beside = path.dirname(path.join(home, SKILL_DIRS[harness]));
    await mkdir(beside, { recursive: true });
    await writeFile(path.join(beside, 'notes.md'), `mine, in ${harness}'s folder\n`);
  }
  const theirs = (entries) => Object.fromEntries(Object.entries(entries)
    .filter(([rel]) => !HARNESSES.some((harness) => rel.startsWith(SKILL_DIRS[harness].split(path.sep).join('/')))));
  const before = theirs(await snapshot(home));

  const result = await build(box);

  assert.equal(result.code, 0, `${result.stderr}${result.stdout}`);
  await assertEmptyDirs(bots, 'api-bot', 'after a build');
  assert.deepEqual(theirs(await snapshot(home)), before, 'everything else in the bot home is as the user left it');
});

test('a bot whose skills list cannot be followed still has both skills directories', async (t) => {
  // The list is wrong, so the bot is given no skills, and says why. But a
  // session of it may be running, and the user fixing the list is how it gets
  // its skill: the directories have to be there already for that session to
  // see it, however wrong the list was.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  await withoutSkillsDirs(bots, 'api-bot');
  await addSkills(botYamlOf(bots, 'api-bot'), 'ghost-skill');

  const result = await build(box, '--json');

  assert.equal(result.code, 1, 'a bot whose list the kit cannot follow ends the run in 1, as it did');
  const entry = entryOf(answerOf(result), 'api-bot');
  assert.equal(typeof entry.trouble, 'string', `it should say what is wrong, got: ${JSON.stringify(entry)}`);
  assert.ok(entry.trouble.includes('ghost-skill'), `and name the entry, got: ${entry.trouble}`);
  await assertEmptyDirs(bots, 'api-bot', 'even though its list could not be followed');
});

// Two ways the directory cannot be made: a file where its parent should be,
// and a file where the directory itself should be. They fail in different
// places in the kit, and each has to be the bot's trouble, not the fleet's.
for (const blocked of ['.claude', SKILL_DIRS.claude]) {
  test(`up brings the fleet up when one bot's ${blocked} is a file of the user's`, async (t) => {
    // Skills are what a bot is good at, not the boundary it works inside, so a
    // skills directory the kit cannot make is that bot's skills trouble, reported
    // the way a list it cannot follow is: in the bot's entry, with the run
    // carrying on and ending as it would have. The bot in trouble runs on Codex,
    // whose hooks live outside .claude, so it has nothing else in the way and
    // comes up like a bot with a bad list does.
    const box = await createSandbox(t);
    const bots = await seeded(box);
    for (const [name, harness] of [['api-bot', 'codex'], ['web-bot', 'claude']]) {
      const made = await box.run([
        'bot', 'create', '--bots', 'bots', '--name', name, '--harness', harness,
        '--charter', `${name} owns its own corner.`,
      ]);
      assert.equal(made.code, 0, made.stderr);
      const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', name, '--name', 'daily']);
      assert.equal(added.code, 0, added.stderr);
    }
    const theirs = path.join(botHomeOf(bots, 'api-bot'), blocked);
    await rm(theirs, { recursive: true, force: true });
    await mkdir(path.dirname(theirs), { recursive: true });
    await writeFile(theirs, 'mine, not a directory\n');

    const result = await box.run(['up', '--bots', 'bots', '--json']);

    assert.ok(!/^\s+at /m.test(result.stderr), `expected a report, got a crash:\n${result.stderr}`);
    assert.equal(result.code, 0, `a bot whose skills are in trouble does not change what up ends in: ${result.stderr}`);
    const answer = answerOf(result);
    const entry = entryOf(answer, 'api-bot');
    assert.equal(typeof entry.trouble, 'string', `the bot's entry should say what is wrong, got: ${JSON.stringify(entry)}`);
    assert.ok(entry.trouble.includes(theirs), `and name the path, got: ${entry.trouble}`);
    assert.ok(!('trouble' in entryOf(answer, 'web-bot')), `the bot beside it has nothing wrong, got: ${JSON.stringify(entryOf(answer, 'web-bot'))}`);
    await assertEmptyDirs(bots, 'web-bot', 'as usual');
    assert.deepEqual(
      (await tabsOfBot(box, bots, 'web-bot')).map((tab) => tab.title),
      ['Web Bot daily'],
      'the other bot comes up: one bot\'s skills directory is not the fleet\'s problem',
    );
    assert.deepEqual(
      (await tabsOfBot(box, bots, 'api-bot')).map((tab) => tab.title),
      ['Api Bot daily'],
      'and the bot itself comes up, as a bot with a list the kit cannot follow does',
    );
    assert.equal(await readFile(theirs, 'utf8'), 'mine, not a directory\n', 'the user\'s file is never written over');
  });
}
