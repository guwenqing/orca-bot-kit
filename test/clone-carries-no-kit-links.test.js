// What the kit links into a bot home is the kit's to make on each machine, and
// not the bots repo's to carry (PRD 6.3, PRD 6.7, ADR 0004).
//
// The bots folder is the user's own git repo, and they may clone it or check it
// out fresh. The skill links the kit makes inside a bot — `.claude/skills/<name>`
// and `.agents/skills/<name>` — point at where the skill is installed on the
// machine that made them: the kit's package for a kit skill, a folder on disk
// for a path one. Carried in git, they arrive on the other machine as links to
// nothing, before `obk up` has had any chance to put them right.
//
// So this file reads the repo the way a user does — `git add -A`, a commit, a
// clone — and asks four things of it:
//
//   what git tracks           nothing of the kit's linking
//   what a clone holds        the user's own files, and nothing pointing nowhere
//   what the kit does there   every bot gets exactly the skills its lists name,
//                             in both harnesses, from that clone's own shelves
//   what is left to commit    nothing, however often the kit is run
//
// How the kit keeps its links out of git is the implementer's. Nothing here
// names a mechanism: every check is on what a user can see — what `git ls-files`
// says, what a clone holds on disk, and what `git status` has to say afterwards.
//
// The one rule that cuts the other way is the last test: whatever the kit writes
// to keep its own links out, the user's own content in those directories is
// still theirs, and git is still theirs to point at it.

import assert from 'node:assert/strict';
import { lstat, readFile, readdir, readlink, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  botHomeOf,
  createSandbox,
  HOOK_FILES,
  repoRoot,
} from './helpers/cli.js';
import {
  assertLinked,
  commonSkill,
  HARNESSES,
  heldBy,
  kitSkill,
  namesIn,
  SKILL_DIRS,
  skillsDirOf,
  writeSkill,
} from './helpers/skills.js';
import { commitIn, gitOk } from './helpers/sources.js';

/** One of the kit's own skills, named here so a test that meets it says which. */
const KIT_SKILL = 'obk-tdd';

/** One of the user's own, in the common folder inside their repo. */
const COMMON_SKILL = 'house-style';

/** The skills `init` puts on Bot Father's list: the kit's two management ones. */
const MANAGEMENT = ['obk-bot-building', 'obk-fleet-review'];

/**
 * The fleet every test here starts from: Bot Father, whom `init` seeds, and one
 * bot of the other harness, so that both hook files and both harnesses' skills
 * directories are in the repo. `skills` is what each bot's lists name, in the
 * order a directory listing gives them back.
 */
const BOTS = {
  'api-bot': { harness: 'codex', skills: [COMMON_SKILL, KIT_SKILL].sort() },
  'bot-father': { harness: 'claude', skills: [...MANAGEMENT].sort() },
};

/** A path as git spells it, whatever the platform's separator is. */
const asGit = (rel) => rel.split(path.sep).join('/');

/** Where a harness reads a bot's skills, as a path inside the repo. */
const skillsDirIn = (bot, harness) => `bots/${bot}/${asGit(SKILL_DIRS[harness])}`;

/**
 * The bots repo of the issue: `init`, one more bot, skills on its list, a build
 * and a fleet brought up — everything the kit makes before a user thinks about
 * committing any of it.
 */
async function fleet(box) {
  const bots = box.path('bots');

  const init = await box.run(['init', '--bots', 'bots', '--harness', BOTS['bot-father'].harness]);
  assert.equal(init.code, 0, init.stderr);

  const made = await box.run([
    'bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', BOTS['api-bot'].harness,
    '--charter', 'Api Bot owns the API. Good is a green build. Ask before a release.',
  ]);
  assert.equal(made.code, 0, made.stderr);
  const session = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily']);
  assert.equal(session.code, 0, session.stderr);

  await commonSkill(bots, COMMON_SKILL);
  for (const ref of [`kit:${KIT_SKILL}`, COMMON_SKILL]) {
    const added = await box.run(['skills', 'add', '--bots', 'bots', '--bot', 'api-bot', '--skill', ref]);
    assert.equal(added.code, 0, added.stderr);
  }

  const built = await box.run(['skills', 'build', '--bots', 'bots']);
  assert.equal(built.code, 0, built.stderr);
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);

  await assertEveryBotHasItsSkills(bots);
  return bots;
}

/** Every bot reads exactly the skills its lists name, in both harnesses. */
async function assertEveryBotHasItsSkills(bots, where = 'the bots folder') {
  for (const [bot, { skills }] of Object.entries(BOTS)) {
    for (const harness of HARNESSES) {
      assert.deepEqual(
        await namesIn(bots, bot, harness),
        skills,
        `${bot} should read those skills from its ${SKILL_DIRS[harness]} in ${where}`,
      );
    }
  }
}

/** What git tracks in a repository, as paths relative to it. */
const trackedIn = async (repo) => (await gitOk(['ls-files'], repo)).split('\n').filter((line) => line !== '');

/** What is waiting to be committed, untracked files included. */
const statusIn = (repo) => gitOk(['status', '--porcelain', '--untracked-files=all'], repo);

/** The repo as a user gets it on another machine. */
async function clonedFrom(box, bots, name = 'clone') {
  const to = box.path(name);
  await gitOk(['clone', bots, to], box.cwd);
  return to;
}

/**
 * Every link under `dir` with nothing at the end of it, as `<path> -> <target>`.
 * The repository's own `.git` is skipped: what git keeps in there is git's.
 */
async function danglingIn(dir) {
  const found = [];
  async function walk(rel) {
    const abs = rel === '' ? dir : path.join(dir, rel);
    for (const entry of await readdir(abs, { withFileTypes: true })) {
      if (rel === '' && entry.name === '.git') continue;
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
      const childAbs = path.join(abs, entry.name);
      if (entry.isSymbolicLink()) {
        // `stat` follows the link, so a link leading nowhere is what throws.
        const there = await stat(childAbs).then(() => true, () => false);
        if (!there) found.push(`${childRel} -> ${await readlink(childAbs)}`);
      } else if (entry.isDirectory()) {
        await walk(childRel);
      }
    }
  }
  await walk('');
  return found.sort();
}

test('git tracks none of the skill links the kit made, and a clone holds none', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);

  await commitIn(bots, 'my bots, as the kit left them');

  const tracked = await trackedIn(bots);
  const carried = [];
  for (const bot of Object.keys(BOTS)) {
    for (const harness of HARNESSES) {
      carried.push(...tracked.filter((rel) => rel.startsWith(`${skillsDirIn(bot, harness)}/`)));
    }
  }
  assert.deepEqual(
    carried,
    [],
    'what the kit links into a bot home is the kit\'s to make on each machine, and not the repo\'s to carry',
  );

  const clone = await clonedFrom(box, bots);
  for (const bot of Object.keys(BOTS)) {
    for (const harness of HARNESSES) {
      assert.deepEqual(
        [...(await heldBy(clone, bot, harness)).keys()],
        [],
        `a clone should hold nothing in ${skillsDirIn(bot, harness)} until the kit runs there`,
      );
    }
  }
  assert.deepEqual(await danglingIn(clone), [], 'nothing a clone holds should point nowhere');

  // And the repo the kit made still has its links: they are kept out of git, not
  // taken away from the bot that reads them.
  await assertEveryBotHasItsSkills(bots);
  await assertLinked(bots, 'api-bot', KIT_SKILL, await kitSkill(KIT_SKILL));
});

test('the repo carries nothing that is only true on this machine', async (t) => {
  // The other half of the same fact, from the side of what a file says rather
  // than where it sits: a tracked file that names where the kit is installed
  // here, or a tracked link that reaches out of the repo, is a line that is
  // false the moment the repo is on another machine.
  const box = await createSandbox(t);
  const bots = await fleet(box);

  await commitIn(bots, 'my bots, as the kit left them');

  const installed = repoRoot.replace(new RegExp(`${path.sep}$`), '');
  for (const rel of await trackedIn(bots)) {
    const abs = path.join(bots, rel);
    if ((await lstat(abs)).isSymbolicLink()) {
      const target = await readlink(abs);
      const lands = path.resolve(path.dirname(abs), target);
      assert.ok(
        !path.isAbsolute(target) && (lands === bots || lands.startsWith(`${bots}${path.sep}`)),
        `${rel} is tracked and points at ${target}, which is a path this repo cannot carry to another machine`,
      );
    } else {
      const text = await readFile(abs, 'utf8');
      assert.ok(
        !text.includes(installed),
        `${rel} is tracked and says where the kit is installed on this machine (${installed}), which is not true on another one`,
      );
    }
  }
});

test('a clone on a machine without those skill directories holds nothing that points nowhere', async (t) => {
  // The complaint itself, made visible on one machine: a skill linked from a
  // directory that the other machine does not have. It stands in for the kit
  // installed somewhere else, or not installed at all.
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const elsewhere = await writeSkill(path.join(box.root, 'installed-elsewhere', 'deploy-notes'));

  const added = await box.run(['skills', 'add', '--bots', 'bots', '--bot', 'api-bot', '--skill', elsewhere]);
  assert.equal(added.code, 0, added.stderr);
  const built = await box.run(['skills', 'build', '--bots', 'bots', '--bot', 'api-bot']);
  assert.equal(built.code, 0, built.stderr);
  await assertLinked(bots, 'api-bot', 'deploy-notes', elsewhere);

  await commitIn(bots, 'my bots, as the kit left them');
  await rm(path.dirname(elsewhere), { recursive: true });

  const clone = await clonedFrom(box, bots);

  assert.deepEqual(
    await danglingIn(clone),
    [],
    'a clone should carry no link whose target belongs to the machine it was made on',
  );
});

test('the clone still holds everything else the repo carried', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);

  await commitIn(bots, 'my bots, as the kit left them');
  const clone = await clonedFrom(box, bots);
  const tracked = new Set(await trackedIn(clone));

  for (const rel of ['defaults.yaml', 'skills.yaml', 'rules/.gitkeep', 'skills/.gitkeep', `skills/${COMMON_SKILL}/SKILL.md`]) {
    assert.ok(tracked.has(rel), `the folder's own ${rel} belongs in the repo, and the clone tracks: ${[...tracked].join(', ')}`);
  }

  for (const [bot, { harness }] of Object.entries(BOTS)) {
    const mine = ['bot.yaml', 'AGENTS.md', 'CLAUDE.md', 'sessions.yaml', asGit(HOOK_FILES[harness])];
    // A bot the kit gave a .gitignore keeps it; `init` seeds Bot Father without
    // one, so what is asked of each bot is what that bot was given.
    const ignore = await lstat(path.join(botHomeOf(bots, bot), '.gitignore')).then(() => true, () => false);
    if (ignore) mine.push('.gitignore');

    for (const rel of mine) {
      assert.ok(
        tracked.has(`bots/${bot}/${rel}`),
        `${bot}'s ${rel} is the user's and belongs in the clone, which tracks: ${[...tracked].filter((one) => one.startsWith(`bots/${bot}/`)).join(', ')}`,
      );
      const there = path.join(botHomeOf(clone, bot), rel);
      assert.equal(
        await readFile(there, 'utf8'),
        await readFile(path.join(botHomeOf(bots, bot), rel), 'utf8'),
        `${bot}'s ${rel} should say in the clone what it says here`,
      );
    }

    // CLAUDE.md is a link to AGENTS.md beside it (PRD 6.6), and still is.
    const target = await readlink(path.join(botHomeOf(clone, bot), 'CLAUDE.md'));
    assert.equal(path.basename(target), 'AGENTS.md', `${bot}'s CLAUDE.md should still be the link to AGENTS.md`);
  }
});

test('skills build in a clone gives every bot its skills, from that clone\'s own shelves', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await commitIn(bots, 'my bots, as the kit left them');
  const clone = await clonedFrom(box, bots);

  const built = await box.run(['skills', 'build', '--bots', 'clone']);

  assert.equal(built.code, 0, built.stderr);
  await assertEveryBotHasItsSkills(clone, 'the clone');
  await assertLinked(clone, 'api-bot', KIT_SKILL, await kitSkill(KIT_SKILL));
  // The user's own skill comes from the clone's shelf, not from the repo it was
  // cloned from: a clone is a bots folder of its own.
  await assertLinked(clone, 'api-bot', COMMON_SKILL, path.join(clone, 'skills', COMMON_SKILL));
  for (const name of MANAGEMENT) await assertLinked(clone, 'bot-father', name, await kitSkill(name));

  assert.equal(await statusIn(clone), '', 'a build in a fresh clone leaves nothing of the kit\'s to commit');
});

test('up in a clone gives every bot its skills, and a second up leaves nothing to commit', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await commitIn(bots, 'my bots, as the kit left them');
  const clone = await clonedFrom(box, bots);

  const up = await box.run(['up', '--bots', 'clone']);

  assert.equal(up.code, 0, up.stderr);
  await assertEveryBotHasItsSkills(clone, 'the clone');
  await assertLinked(clone, 'api-bot', KIT_SKILL, await kitSkill(KIT_SKILL));
  await assertLinked(clone, 'api-bot', COMMON_SKILL, path.join(clone, 'skills', COMMON_SKILL));

  // The book is the user's file and the tabs this machine opened belong in it,
  // so that first run has something to commit. Nothing after it does.
  await commitIn(clone, 'brought the fleet up here');
  const again = await box.run(['up', '--bots', 'clone']);

  assert.equal(again.code, 0, again.stderr);
  assert.equal(await statusIn(clone), '', 'bringing the fleet up again leaves nothing to commit');
  assert.deepEqual(await danglingIn(clone), [], 'and nothing in the clone points nowhere');
});

test('the kit run twice over its own repo leaves nothing to commit', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await commitIn(bots, 'my bots, as the kit left them');

  const built = await box.run(['skills', 'build', '--bots', 'bots']);
  assert.equal(built.code, 0, built.stderr);
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);

  assert.equal(await statusIn(bots), '', 'building and bringing up again leaves the repo with nothing to commit');
});

test('a user\'s own skill in a bot\'s skills directory is theirs, and git can still track it', async (t) => {
  // The kit does not decide what a user may keep in their own repo. Whatever it
  // writes to keep its own links out of git, somebody who wants their own skill
  // in there, in the repo, must be able to have it — and keep it when the kit
  // runs again.
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const mine = path.join(skillsDirOf(bots, 'api-bot', 'claude'), 'my-own');
  await writeSkill(mine, { body: 'My own skill, in my own repo.\n' });
  const rel = `${skillsDirIn('api-bot', 'claude')}/my-own/SKILL.md`;

  await commitIn(bots, 'my bots, and one skill of my own');
  if (!(await trackedIn(bots)).includes(rel)) {
    // Ignored, so the user reaches for git's own way past that, once.
    await gitOk(['add', '--force', rel], bots);
    await commitIn(bots, 'and I mean it');
  }

  assert.ok((await trackedIn(bots)).includes(rel), `${rel} is the user's own and git should be able to track it`);

  // It is still theirs after the kit has run again, and still nothing to commit.
  const built = await box.run(['skills', 'build', '--bots', 'bots']);
  assert.equal(built.code, 0, built.stderr);
  assert.match(
    await readFile(path.join(mine, 'SKILL.md'), 'utf8'),
    /My own skill, in my own repo\./,
    'the skill the user put there is still theirs, and still says what they wrote',
  );
  assert.equal(await statusIn(bots), '', 'and the repo has nothing waiting to be committed');

  const clone = await clonedFrom(box, bots);
  assert.ok(
    await lstat(path.join(clone, rel)).then(() => true, () => false),
    'what the user tracked is in the clone',
  );
});

test('a rule of the user\'s own takes their skill back, and leaves the kit\'s links out', async (t) => {
  // `git add --force` is a one-off, on a path somebody types. The durable way a
  // user says "this one is mine" is a line in their own ignore file, and it
  // only works while what is kept out of git is the entries in those
  // directories rather than the directories themselves: git cannot take a file
  // back into a directory it has been told to ignore. So this is the test that
  // tells those two apart, and it is the user's half of the bargain — the kit
  // keeps its links out, and does not take the decision away from them.
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const mine = path.join(skillsDirOf(bots, 'api-bot', 'claude'), 'my-own');
  await writeSkill(mine, { body: 'My own skill, in my own repo.\n' });

  // Said in the bot's own .gitignore, which the kit wrote and the user owns
  // from then on (PRD 6.3): what is theirs is theirs, whatever the kit keeps out.
  const ignore = path.join(botHomeOf(bots, 'api-bot'), '.gitignore');
  await writeFile(ignore, `${await readFile(ignore, 'utf8')}\n# mine, whatever obk keeps out\n!.claude/skills/my-own\n`);

  await commitIn(bots, 'my bots, and one skill of my own');

  const tracked = await trackedIn(bots);
  const theirs = `${skillsDirIn('api-bot', 'claude')}/my-own/SKILL.md`;
  assert.ok(
    tracked.includes(theirs),
    `a user who says in their own ignore file that ${theirs} is theirs should have git take it in on a plain add, and git tracks: ${tracked.join(', ')}`,
  );
  assert.deepEqual(
    tracked.filter((rel) => rel.startsWith(`${skillsDirIn('api-bot', 'claude')}/`) && rel !== theirs),
    [],
    'and what the kit linked there is still the kit\'s to make on each machine',
  );

  // What they took back is in a clone, and the kit's links are still not.
  const clone = await clonedFrom(box, bots);
  assert.deepEqual(
    [...(await heldBy(clone, 'api-bot', 'claude')).keys()],
    ['my-own'],
    'a clone should hold what the user tracked, and nothing else, until the kit runs there',
  );
});

test('a user\'s own skills outside the bot homes are theirs, and git tracks them', async (t) => {
  // The kit's rule reaches into the bot homes it has business in, and no
  // further. The bots folder is an ordinary git repo the user opens themselves,
  // so `.claude/skills` at its root is where their own skills for this repo
  // sit, and a folder of their own inside it is theirs as much as any other.
  // A rule of the kit's that swallowed either would be the kit deciding what a
  // user may keep in their own repo, which it does not do (PRD 6.3).
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const theirs = [
    await writeSkill(path.join(bots, '.claude', 'skills', 'repo-notes')),
    await writeSkill(path.join(bots, 'playbooks', '.claude', 'skills', 'release-steps')),
  ];

  await commitIn(bots, 'my bots, and my own skills for this repo');

  const tracked = await trackedIn(bots);
  const clone = await clonedFrom(box, bots);
  for (const dir of theirs) {
    const rel = asGit(path.relative(bots, path.join(dir, 'SKILL.md')));
    assert.ok(
      tracked.includes(rel),
      `${rel} is the user's own, outside every bot home, and git should take it in on a plain add. git tracks: ${tracked.join(', ')}`,
    );
    assert.ok(
      await lstat(path.join(clone, rel)).then(() => true, () => false),
      `${rel} is the user's own and should be in a clone of their repo`,
    );
  }
});
