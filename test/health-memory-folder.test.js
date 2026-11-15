// `obk health` says when a bot's own memory folder holds no notes while the
// folder that the bots shared does, and names each Claude session that gets no
// folder of its bot's own because its `extra_args` carry `--settings` (#752).
//
// Since #752 the kit names one memory folder for each Claude bot on its launch
// line: `<real bot folder>/claude-memory` (test/memory-folder-flag.test.js holds
// that, and when the kit names none; ADR 0056). Before #752 every bot of a bots
// repo used Claude Code's default, the folder of the repository's top under
// `projects`. The kit moves no note. So at the upgrade a bot starts with an
// empty folder, and its old notes stay in the shared one. `obk health` says so,
// read-only.
//
// What is held here, from requirement R1 of own-memory-folder:
//
//   HM1  a finding for a bot when the kit names its folder, that folder has no
//        MEMORY.md, and the shared folder has one; it names the bot, the bot's
//        own folder and the shared folder as full absolute paths
//   HM2  it ends when the bot's own folder gets a MEMORY.md; a folder with only
//        the kit's .gitignore, an empty one, or notes without a MEMORY.md do not
//        end it
//   HM3  no MEMORY.md in any folder above the bot folder: no finding
//   HM4  the shared folder: each folder above the real bot folder, nearest
//        first, by its slug in NFC; never a folder below it or beside it
//   HM5  P: the selected profile's real `projects`, or the real
//        `~/.claude/projects` with no profile; P not there, no finding
//   HM6  no finding when the kit names no folder for any Claude session of the
//        bot: a folder named by hand, `--settings` in each session's
//        extra_args, something that is not a plain folder at claude-memory
//   HM7  no finding for a bot with only Codex or only Pi sessions
//   HM8  health creates and changes no file for this
//   HS1  a finding for each Claude session whose own extra_args carry
//        `--settings`: it names the bot, the session and `--settings`; none for
//        a Codex or Pi session with it, none for a Claude session without it
//   HC1  a finding for a bot that has a Claude session without its own
//        `--settings`, no folder named by hand, and a file or a link at
//        `<real bot folder>/claude-memory`: it names the bot and that path;
//        none for a plain folder or nothing there, a folder named by hand, a
//        bot with only Codex or Pi sessions, or one whose every Claude
//        session carries `--settings`
//
// A finding is read from `obk health --json`: `found` is a list of
// `{ kind, bot, where, says }`. These tests hold the bot's name, the session's
// name and the paths or words named, not the wording and not the kind. A
// negative case has its positive in the same sandbox: health is run once with
// the finding there, then one thing is changed, and health is run again. A
// negative looks for `/<bot>/claude-memory` in any finding, so a finding that
// names the bot's folder by another spelling still counts.
//
// Every run is in a sandbox (helpers/cli.js): its own HOME and a fake Orca.
// Nothing here reads the real Orca's data, a real profile or a real harness.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { parse, stringify } from 'yaml';

import { botHomeOf, createSandbox, snapshot } from './helpers/cli.js';
import { fakePi } from './helpers/pi.js';

const BOT = 'api-bot';
const KEY = 'autoMemoryDirectory';
const FOLDER = 'claude-memory';
const AS_ROOT = process.getuid?.() === 0 ? 'root reads a file of mode 000, so it cannot be made unreadable here' : undefined;

/** Orca's data folder in a sandbox: where Orca keeps it, under the sandbox's home. */
const orcaDataOf = (box) => path.join(box.home, 'Library', 'Application Support', 'orca');

/** `~/.claude/projects` under the sandbox's HOME. The sandbox's home is a real path. */
const homeProjectsOf = (box) => path.join(box.home, '.claude', 'projects');

/**
 * A Claude profile as Orca keeps one: a home folder in which `projects` is a
 * symbolic link to the real folder, and `selected-host` names that home.
 */
async function profileIn(box, { projects = homeProjectsOf(box) } = {}) {
  const data = orcaDataOf(box);
  const home = path.join(data, 'claude-profiles', 'profile-one', 'home');
  await mkdir(home, { recursive: true });
  await mkdir(projects, { recursive: true });
  const link = path.join(home, 'projects');
  await symlink(projects, link);
  const selected = path.join(data, 'claude-profiles', 'selected-host');
  await writeFile(selected, home);
  return { data, home, projects, link, selected };
}

/** The slug as the requirement says: the folder in NFC, each character that is not an ASCII letter or digit changed to `-`. */
const slugOf = (folder) => folder.normalize('NFC').replaceAll(/[^A-Za-z0-9]/g, '-');

/** The folder that the bots shared, as Claude Code named it for `folder`: P, the slug, and `memory`. */
const sharedOf = (projects, folder) => path.join(projects, slugOf(folder), 'memory');

/** A bot's own folder. The caller gives the real bot folder. */
const ownOf = (realHome) => path.join(realHome, FOLDER);

/** What a negative looks for: the bot's own folder, however the path before it is spelled. */
const tailOf = (bot) => `${path.sep}${bot}${path.sep}${FOLDER}`;

/** A run of `obk` that must go through. */
async function ok(box, args) {
  const result = await box.run(args);
  assert.equal(result.code, 0, `obk ${args.join(' ')} should have gone through:\n${result.stdout}${result.stderr}`);
  return result;
}

/** A bots folder, made by `init`, which brings up Bot Father. */
async function initIn(box, bots = 'bots') {
  await ok(box, ['init', '--bots', bots, '--harness', 'claude']);
}

/** One more bot, on `harness`, with the sessions named. Each session is `name` or `[name, ...flags of session add]`. */
async function botIn(box, { bots = 'bots', name = BOT, harness = 'claude', sessions = ['daily'] } = {}) {
  await ok(box, ['bot', 'create', '--bots', bots, '--name', name, '--harness', harness]);
  for (const session of sessions) {
    const [each, ...flags] = [session].flat();
    await ok(box, ['session', 'add', '--bots', bots, '--bot', name, '--name', each, ...flags]);
  }
}

/**
 * Change sessions' `extra_args` in bot.yaml, the way a user editing that file
 * by hand does: `session add`, `session change` and `temp make` refuse
 * `--settings` (ADR 0049), so a user gets it there only by hand.
 */
async function handEdit(home, extras) {
  const file = path.join(home, 'bot.yaml');
  const written = parse(await readFile(file, 'utf8'));
  written.sessions = written.sessions.map((session) => (Object.hasOwn(extras, session.name) ? { ...session, extra_args: extras[session.name] } : session));
  await writeFile(file, stringify(written));
}

/** Notes in a memory folder: a MEMORY.md with one line, or, with `index: false`, only a note of its own. */
async function notesIn(folder, { index = true } = {}) {
  await mkdir(folder, { recursive: true });
  if (index) await writeFile(path.join(folder, 'MEMORY.md'), '- [A note](a-note.md) — something learnt.\n');
  await writeFile(path.join(folder, 'a-note.md'), 'Something learnt.\n');
}

/** Run the health check for JSON: findings, and exit 1 when there are any, 0 when none. */
async function found(box, bots = 'bots') {
  const result = await box.run(['health', '--bots', bots, '--json']);
  assert.equal(result.stderr, '', `a health run reports on stdout, and put this on stderr: ${result.stderr}`);
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  assert.ok(Array.isArray(answer.found), `the answer should carry a list of findings, got: ${result.stdout}`);
  assert.equal(result.code, answer.found.length === 0 ? 0 : 1, `exit code for ${answer.found.length} findings`);
  return answer.found;
}

const show = (value) => JSON.stringify(value, null, 2);
const textOf = (one) => `${one.where ?? ''} ${one.says ?? ''}`;

/**
 * The one finding that names `own`, a bot's own folder. It also names
 * `shared`, and it names `bot` other than inside the two paths.
 */
function assertNotice(findings, { bot, own, shared }) {
  const naming = findings.filter((one) => textOf(one).includes(own));
  assert.equal(naming.length, 1, `one finding should name ${bot}'s own folder ${own}, got: ${show(findings)}`);
  const [one] = naming;
  assert.ok(textOf(one).includes(shared), `the finding should name the folder that the bots shared, ${shared}, got: ${show(one)}`);
  const outside = textOf(one).replaceAll(own, '').replaceAll(shared, '');
  assert.ok(one.bot === bot || outside.includes(bot), `the finding should name the bot ${bot}, got: ${show(one)}`);
  return one;
}

/** No finding names the bot `bot`'s own folder. */
function assertNoNotice(findings, bot, why) {
  const tail = tailOf(bot);
  const naming = findings.filter((one) => textOf(one).includes(tail));
  assert.deepEqual(naming, [], `${why}: no finding should name a folder ending ${tail}, got: ${show(naming)}`);
}

/** The usual sandbox: a profile, a bots repo, api-bot with one Claude session, and notes in the folder that the bots shared. */
async function usual(t, { seedShared = true, sessions = ['daily'] } = {}) {
  const box = await createSandbox(t);
  const profile = await profileIn(box);
  await initIn(box);
  await botIn(box, { sessions });
  const bots = box.path('bots');
  const home = botHomeOf(bots, BOT);
  const shared = sharedOf(profile.projects, bots);
  if (seedShared) await notesIn(shared);
  return { box, profile, bots, home, shared, own: ownOf(home) };
}

describe('obk health names a bot whose own memory folder is empty while the shared one is not, and a session that gets none (#752)', { concurrency: 8 }, () => {
  // ---------------------------------------------------------------- HM1

  test('HM1 a bot whose own folder has no MEMORY.md, in a bots repo whose shared folder has one: one finding names the bot, its own folder and the shared folder', async (t) => {
    const { box, bots } = await usual(t);

    const findings = await found(box);

    // Written out from the requirement, not through the test's own helpers.
    const own = `${bots}/bots/api-bot/claude-memory`;
    const shared = `${homeProjectsOf(box)}/${bots.replaceAll(/[^A-Za-z0-9]/g, '-')}/memory`;
    assertNotice(findings, { bot: BOT, own, shared });
  });

  test('HM1 every bot gets its own finding: Bot Father too, whose folder init made with only the .gitignore', async (t) => {
    const { box, bots, shared, own } = await usual(t);

    const findings = await found(box);

    assertNotice(findings, { bot: BOT, own, shared });
    assertNotice(findings, { bot: 'bot-father', own: ownOf(botHomeOf(bots, 'bot-father')), shared });
  });

  test('HM1 the finding holds after the bot\'s session is up, and the kit has made its folder with the .gitignore alone', async (t) => {
    const { box, shared, own } = await usual(t);
    await ok(box, ['up', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);
    assert.ok(existsSync(path.join(own, '.gitignore')), `the premise: the kit made ${own} with its .gitignore`);
    assert.ok(!existsSync(path.join(own, 'MEMORY.md')), 'the premise: no MEMORY.md there');

    assertNotice(await found(box), { bot: BOT, own, shared });
  });

  // ---------------------------------------------------------------- HM2

  test('HM2 the finding ends when the bot\'s own folder gets a MEMORY.md; another bot\'s finding stays', async (t) => {
    const { box, bots, shared, own } = await usual(t);
    const father = ownOf(botHomeOf(bots, 'bot-father'));
    assertNotice(await found(box), { bot: BOT, own, shared });

    await notesIn(own);

    const findings = await found(box);
    assertNoNotice(findings, BOT, `${BOT}'s own folder has a MEMORY.md now`);
    assertNotice(findings, { bot: 'bot-father', own: father, shared });
  });

  test('HM2 notes in the bot\'s own folder without a MEMORY.md do not end it', async (t) => {
    const { box, shared, own } = await usual(t);
    await notesIn(own, { index: false });

    assertNotice(await found(box), { bot: BOT, own, shared });
  });

  test('HM2 an empty own folder does not end it', async (t) => {
    const { box, shared, own } = await usual(t);
    await mkdir(own, { recursive: true });

    assertNotice(await found(box), { bot: BOT, own, shared });
  });

  // ---------------------------------------------------------------- HM3

  const NO_SHARED_INDEX = [
    ['no folder there at all', async () => {}],
    ['notes there, and no MEMORY.md', (shared) => notesIn(shared, { index: false })],
    ['an empty memory folder', (shared) => mkdir(shared, { recursive: true })],
  ];
  for (const [label, lay] of NO_SHARED_INDEX) {
    test(`HM3 the shared folder has ${label}: no finding; once it has a MEMORY.md, the finding comes`, async (t) => {
      const { box, shared, own } = await usual(t, { seedShared: false });
      await lay(shared);

      assertNoNotice(await found(box), BOT, 'no folder above the bot folder has a MEMORY.md');

      await mkdir(shared, { recursive: true });
      await writeFile(path.join(shared, 'MEMORY.md'), '- A note.\n');
      assertNotice(await found(box), { bot: BOT, own, shared });
    });
  }

  // ---------------------------------------------------------------- HM4

  test('HM4 nearest first: with a MEMORY.md for the bots folder and for the folder that holds the bot folders, the nearer one is named', async (t) => {
    const { box, profile, bots, own } = await usual(t);
    const nearer = sharedOf(profile.projects, path.join(bots, 'bots'));
    await notesIn(nearer);

    const one = assertNotice(await found(box), { bot: BOT, own, shared: nearer });
    assert.ok(!textOf(one).includes(sharedOf(profile.projects, bots)), `only the nearest folder is named, got: ${show(one)}`);
  });

  test('HM4 nearest first: with a MEMORY.md for the bots folder and for the folder above it, the bots folder is named', async (t) => {
    const { box, profile, own, shared } = await usual(t);
    const farther = sharedOf(profile.projects, box.cwd);
    await notesIn(farther);

    const one = assertNotice(await found(box), { bot: BOT, own, shared });
    assert.ok(!textOf(one).includes(farther), `only the nearest folder is named, got: ${show(one)}`);
  });

  test('HM4 a MEMORY.md only for a folder further up, not the repository\'s top: that folder is named', async (t) => {
    const { box, profile, own } = await usual(t, { seedShared: false });
    const farther = sharedOf(profile.projects, box.cwd);
    await notesIn(farther);

    assertNotice(await found(box), { bot: BOT, own, shared: farther });
  });

  // Another bot's folder is beside this bot's, and a folder of the bot's work
  // dir is below it: neither is above the bot folder, so neither is the folder
  // that the bots shared. Nor is the bot folder itself.
  const NOT_ABOVE = [
    ['another bot\'s folder', async ({ box, profile, bots }) => {
      await botIn(box, { name: 'web-bot' });
      await notesIn(sharedOf(profile.projects, botHomeOf(bots, 'web-bot')));
    }],
    ['a folder inside the bot folder', ({ profile, home }) => notesIn(sharedOf(profile.projects, path.join(home, 'work', 'api')))],
    ['the bot folder itself', ({ profile, home }) => notesIn(sharedOf(profile.projects, home))],
  ];
  for (const [label, lay] of NOT_ABOVE) {
    test(`HM4 a MEMORY.md only for ${label}: no finding for this bot; once the bots folder has one, the finding comes`, async (t) => {
      const world = await usual(t, { seedShared: false });
      await lay(world);

      assertNoNotice(await found(world.box), BOT, 'no folder above the bot folder has a MEMORY.md');

      await notesIn(world.shared);
      assertNotice(await found(world.box), { bot: BOT, own: world.own, shared: world.shared });
    });
  }

  test('HM4 the folders above the real bot folder: a bots folder given through a link is followed to its real path', async (t) => {
    const box = await createSandbox(t);
    const profile = await profileIn(box);
    const real = path.join(box.root, 'elsewhere', 'real-bots');
    await mkdir(real, { recursive: true });
    await symlink(real, box.path('linked-bots'));
    await initIn(box, 'linked-bots');
    await botIn(box, { bots: 'linked-bots' });
    const home = botHomeOf(real, BOT);
    await notesIn(sharedOf(profile.projects, box.path('linked-bots')));

    assertNoNotice(await found(box, 'linked-bots'), BOT, 'the link\'s own path is not above the real bot folder');

    const shared = sharedOf(profile.projects, real);
    await notesIn(shared);
    assertNotice(await found(box, 'linked-bots'), { bot: BOT, own: ownOf(home), shared });
  });

  // Claude Code holds its folders in NFC, so the slug is that of the NFC form:
  // `e` + U+0301 is one character there, and gives one `-`, not two.
  test('HM4 a bots folder stored in NFD form: the shared folder is found by the slug of its NFC form', async (t) => {
    const box = await createSandbox(t);
    const profile = await profileIn(box);
    const name = 'café';
    await initIn(box, name);
    const stored = await readdir(box.cwd);
    if (!stored.includes(name)) {
      t.skip(`this filesystem does not keep the NFD form of a name: it holds ${JSON.stringify(stored)}`);
      return;
    }
    await botIn(box, { bots: name });
    const bots = box.path(name);
    const nfdSlug = path.join(profile.projects, bots.replaceAll(/[^A-Za-z0-9]/g, '-'), 'memory');
    await notesIn(nfdSlug);

    assertNoNotice(await found(box, name), BOT, 'a slug of the NFD form is not the shared folder');

    // By hand: `/` `-`, `caf`, `é` `-`.
    const shared = path.join(profile.projects, `${box.cwd.replaceAll(/[^A-Za-z0-9]/g, '-')}-caf-`, 'memory');
    await notesIn(shared);
    assertNotice(await found(box, name), { bot: BOT, own: ownOf(botHomeOf(bots, BOT)), shared });
  });

  // ---------------------------------------------------------------- HM5

  test('HM5 with no profile selected, P is the real ~/.claude/projects', async (t) => {
    const box = await createSandbox(t);
    await mkdir(homeProjectsOf(box), { recursive: true });
    await initIn(box);
    await botIn(box);
    const bots = box.path('bots');
    const shared = sharedOf(homeProjectsOf(box), bots);
    await notesIn(shared);

    assertNotice(await found(box), { bot: BOT, own: ownOf(botHomeOf(bots, BOT)), shared });
  });

  test('HM5 with no profile selected and ~/.claude/projects a link, P is the real path it leads to', async (t) => {
    const box = await createSandbox(t);
    const real = path.join(box.root, 'elsewhere', 'real-projects');
    await mkdir(real, { recursive: true });
    await mkdir(path.dirname(homeProjectsOf(box)), { recursive: true });
    await symlink(real, homeProjectsOf(box));
    await initIn(box);
    await botIn(box);
    const bots = box.path('bots');
    const shared = sharedOf(real, bots);
    await notesIn(shared);

    const one = assertNotice(await found(box), { bot: BOT, own: ownOf(botHomeOf(bots, BOT)), shared });
    assert.ok(!textOf(one).includes(sharedOf(homeProjectsOf(box), bots)), `the shared folder is named by its real path, got: ${show(one)}`);
  });

  test('HM5 with no profile selected and no ~/.claude/projects: no finding; once it is there with notes, the finding comes', async (t) => {
    const box = await createSandbox(t);
    await initIn(box);
    await botIn(box);
    const bots = box.path('bots');
    assert.ok(!existsSync(homeProjectsOf(box)), 'the premise: P is not there');

    assertNoNotice(await found(box), BOT, 'P is not there');

    const shared = sharedOf(homeProjectsOf(box), bots);
    await notesIn(shared);
    assertNotice(await found(box), { bot: BOT, own: ownOf(botHomeOf(bots, BOT)), shared });
  });

  test('HM5 with a profile selected, P is its real projects folder: notes under ~/.claude/projects alone give no finding', async (t) => {
    const box = await createSandbox(t);
    const profile = await profileIn(box, { projects: path.join(box.root, 'profile-projects') });
    await mkdir(homeProjectsOf(box), { recursive: true });
    await initIn(box);
    await botIn(box);
    const bots = box.path('bots');
    await notesIn(sharedOf(homeProjectsOf(box), bots));

    assertNoNotice(await found(box), BOT, 'the profile\'s projects folder has no MEMORY.md for the bots folder');

    const shared = sharedOf(profile.projects, bots);
    await notesIn(shared);
    assertNotice(await found(box), { bot: BOT, own: ownOf(botHomeOf(bots, BOT)), shared });
  });

  test('HM5 a profile whose projects is a plain folder: P is that folder', async (t) => {
    const box = await createSandbox(t);
    const profile = await profileIn(box);
    await rm(profile.link);
    await mkdir(profile.link);
    await initIn(box);
    await botIn(box);
    const bots = box.path('bots');
    const shared = sharedOf(profile.link, bots);
    await notesIn(shared);

    assertNotice(await found(box), { bot: BOT, own: ownOf(botHomeOf(bots, BOT)), shared });
  });

  const NOWHERE = [
    ['the profile\'s projects is a link that leads nowhere', async ({ box, profile }) => {
      await rm(profile.link);
      await symlink(path.join(box.root, 'no-such-folder'), profile.link);
    }],
    ['the profile\'s projects is a link to itself', async ({ profile }) => {
      await rm(profile.link);
      await symlink(profile.link, profile.link);
    }],
    ['the profile\'s projects is not there', ({ profile }) => rm(profile.link)],
  ];
  for (const [label, change] of NOWHERE) {
    test(`HM5 ${label}: P is not there, and no finding`, async (t) => {
      const world = await usual(t);
      assertNotice(await found(world.box), { bot: BOT, own: world.own, shared: world.shared });

      await change(world);

      assertNoNotice(await found(world.box), BOT, 'P is not there');
    });
  }

  // ---------------------------------------------------------------- HM6

  /** The settings files where a user names a folder by hand. */
  const handFiles = ({ box, profile, bots, home }) => ({
    bot: path.join(home, '.claude', 'settings.json'),
    local: path.join(home, '.claude', 'settings.local.json'),
    root: path.join(bots, '.claude', 'settings.local.json'),
    profile: path.join(profile.home, 'settings.json'),
    user: path.join(box.home, '.claude', 'settings.json'),
  });

  /** Add keys to a settings file, keeping what the kit wrote there. */
  async function addTo(file, keys) {
    let held = {};
    try {
      held = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify({ ...held, ...keys }, null, 2)}\n`);
  }

  const BY_HAND = [
    ['holds the key', (file) => addTo(file, { [KEY]: '/somewhere/of/my/own' })],
    ['cannot be parsed', async (file) => {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, '{ not json');
    }],
    ['cannot be read: mode 000', async (file) => {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, '{}\n');
      await chmod(file, 0o000);
    }, { skip: AS_ROOT }],
  ];
  for (const where of ['bot', 'local', 'root', 'profile']) {
    for (const [label, change, options] of BY_HAND) {
      // An unreadable bot's own settings.json stops the kit before it reads
      // anything of the bot (test/memory-folder-flag.test.js), so it is not a case.
      if (where === 'bot' && label !== 'holds the key') continue;
      test(`HM6 the ${where} settings file ${label}: the kit names no folder, and no finding`, options ?? {}, async (t) => {
        const world = await usual(t);
        assertNotice(await found(world.box), { bot: BOT, own: world.own, shared: world.shared });

        await change(handFiles(world)[where]);

        assertNoNotice(await found(world.box), BOT, `a folder named by hand in the ${where} settings file`);
      });
    }
  }

  test('HM6 no profile selected, and ~/.claude/settings.json holds the key: the kit names no folder, and no finding', async (t) => {
    const world = await usual(t);
    await rm(world.profile.selected);
    assertNotice(await found(world.box), { bot: BOT, own: world.own, shared: world.shared });

    await addTo(handFiles(world).user, { [KEY]: '/somewhere/of/my/own' });

    assertNoNotice(await found(world.box), BOT, 'a folder named by hand in ~/.claude/settings.json with no profile');
  });

  test('HM6 with a profile selected, the key in ~/.claude/settings.json does not count: the finding stays', async (t) => {
    const world = await usual(t);
    await addTo(handFiles(world).user, { [KEY]: '/somewhere/of/my/own' });

    assertNotice(await found(world.box), { bot: BOT, own: world.own, shared: world.shared });
  });

  test('HM6 a key named by hand in the bot\'s own local settings ends that bot\'s finding and leaves Bot Father\'s', async (t) => {
    const world = await usual(t);
    await addTo(handFiles(world).local, { [KEY]: '/somewhere/of/my/own' });

    const findings = await found(world.box);

    assertNoNotice(findings, BOT, 'a folder named by hand');
    assertNotice(findings, { bot: 'bot-father', own: ownOf(botHomeOf(world.bots, 'bot-father')), shared: world.shared });
  });

  test('HM6 every Claude session of the bot has its own --settings in extra_args: no finding for the bot', async (t) => {
    const world = await usual(t, { sessions: ['daily', 'other'] });
    assertNotice(await found(world.box), { bot: BOT, own: world.own, shared: world.shared });

    await handEdit(world.home, { daily: ['--settings', '/srv/mine.json'], other: '--settings=/srv/mine.json' });

    assertNoNotice(await found(world.box), BOT, 'the kit names no folder for any session of the bot');
  });

  test('HM6 one Claude session with its own --settings and one without: the finding stays', async (t) => {
    const world = await usual(t, { sessions: ['daily', 'other'] });
    await handEdit(world.home, { other: ['--settings', '/srv/mine.json'] });

    assertNotice(await found(world.box), { bot: BOT, own: world.own, shared: world.shared });
  });

  const NOT_A_FOLDER = [
    ['a file', (at) => writeFile(at, 'my own notes\n')],
    ['a link to a folder', async (at, { box }) => {
      const target = path.join(box.root, 'elsewhere', 'notes');
      await mkdir(target, { recursive: true });
      await symlink(target, at);
    }],
    ['a link that leads nowhere', (at, { box }) => symlink(path.join(box.root, 'no-such-folder'), at)],
  ];
  for (const [label, put] of NOT_A_FOLDER) {
    test(`HM6 ${label} at <bot folder>/claude-memory: the kit names no folder, and no finding`, async (t) => {
      const world = await usual(t);
      assertNotice(await found(world.box), { bot: BOT, own: world.own, shared: world.shared });

      await put(world.own, world);

      // HC1 gives this bot a finding that names its claude-memory; none names the shared notes.
      const naming = (await found(world.box)).filter((one) => textOf(one).includes(tailOf(BOT)) && textOf(one).includes(world.shared));
      assert.deepEqual(naming, [], `${label} at the bot's claude-memory: no finding names the shared notes for it, got: ${show(naming)}`);
    });
  }

  // ---------------------------------------------------------------- HM7

  test('HM7 a bot with only Codex sessions gets no finding; a Codex bot with one Claude session gets one', async (t) => {
    const { box, bots, shared } = await usual(t);
    await botIn(box, { name: 'codex-bot', harness: 'codex', sessions: ['daily'] });
    await botIn(box, { name: 'mixed-bot', harness: 'codex', sessions: ['daily', ['lead', '--harness', 'claude']] });

    const findings = await found(box);

    assertNoNotice(findings, 'codex-bot', 'the kit names no folder for a Codex session');
    assertNotice(findings, { bot: 'mixed-bot', own: ownOf(botHomeOf(bots, 'mixed-bot')), shared });
  });

  test('HM7 a Claude bot whose every session runs on Codex gets no finding; a Claude bot beside it gets one', async (t) => {
    const { box, shared, own } = await usual(t);
    await botIn(box, { name: 'review-bot', sessions: [['review', '--harness', 'codex']] });

    const findings = await found(box);

    assertNoNotice(findings, 'review-bot', 'the kit names no folder for a Codex session');
    assertNotice(findings, { bot: BOT, own, shared });
  });

  test('HM7 a bot with only Pi sessions gets no finding; a Claude bot beside it gets one', async (t) => {
    const { box, shared, own } = await usual(t);
    await fakePi(box);
    await botIn(box, { name: 'pi-bot', harness: 'pi', sessions: ['daily'] });

    const findings = await found(box);

    assertNoNotice(findings, 'pi-bot', 'Pi has no memory folder');
    assertNotice(findings, { bot: BOT, own, shared });
  });

  // ---------------------------------------------------------------- HM8

  test('HM8 health creates and changes no file for this: P, the shared folder and the bot folder are as they were, and the own folder is not made', async (t) => {
    const { box, profile, home, shared, own } = await usual(t);
    const before = {
      projects: await snapshot(profile.projects),
      bot: await snapshot(home),
    };

    assertNotice(await found(box), { bot: BOT, own, shared });

    assert.ok(!existsSync(own), `health names ${own} and does not make it`);
    assert.deepEqual(await snapshot(profile.projects), before.projects, 'the projects folder is as it was, the shared notes among it');
    assert.deepEqual(await snapshot(home), before.bot, 'the bot folder is as it was');
  });

  test('HM8 health writes no .gitignore into a folder of the user\'s own that has none', async (t) => {
    const { box, shared, own } = await usual(t);
    await notesIn(own, { index: false });
    const before = await snapshot(own);

    assertNotice(await found(box), { bot: BOT, own, shared });

    assert.deepEqual(await snapshot(own), before, 'the own folder is as it was, with no .gitignore');
  });

  // ---------------------------------------------------------------- HS1

  /** The findings that name `--settings` and the session `session`. */
  const settingsFindings = (findings, session) => findings.filter((one) => textOf(one).includes('--settings') && textOf(one).includes(session));

  /** The one finding for `bot`/`session`: it names the session and `--settings`, and the bot. */
  function assertSettingsNotice(findings, { bot, session }) {
    const naming = settingsFindings(findings, session);
    assert.equal(naming.length, 1, `one finding should name ${bot}/${session} and --settings, got: ${show(findings)}`);
    const [one] = naming;
    assert.ok(one.bot === bot || textOf(one).includes(bot), `the finding should name the bot ${bot}, got: ${show(one)}`);
    return one;
  }

  const OWN_SETTINGS = [
    ['a list, --settings and its value', ['--settings', '/srv/mine.json']],
    ['a list, --settings=value', ['--settings=/srv/mine.json']],
    ['a string, --settings and its value', '--settings /srv/mine.json'],
    ['a string, --settings=value', '--verbose --settings=/srv/mine.json'],
  ];
  for (const [label, extra] of OWN_SETTINGS) {
    test(`HS1 a Claude session whose extra_args hold --settings, as ${label}: a finding names the bot, the session and --settings; its plain sibling gets none`, async (t) => {
      const box = await createSandbox(t);
      await initIn(box);
      await botIn(box, { sessions: ['keeper', 'plain'] });
      const home = botHomeOf(box.path('bots'), BOT);
      assert.deepEqual(settingsFindings(await found(box), 'keeper'), [], 'the control: no such finding before the hand edit');

      await handEdit(home, { keeper: extra });

      const findings = await found(box);
      assert.deepEqual(settingsFindings(findings, 'plain'), [], 'a Claude session without --settings gets no such finding');
      assertSettingsNotice(findings, { bot: BOT, session: 'keeper' });
    });
  }

  test('HS1 one finding for each such Claude session: two sessions, two findings', async (t) => {
    const box = await createSandbox(t);
    await initIn(box);
    await botIn(box, { sessions: ['keeper', 'holder'] });
    await handEdit(botHomeOf(box.path('bots'), BOT), { keeper: ['--settings', '/srv/a.json'], holder: '--settings=/srv/b.json' });

    const findings = await found(box);

    assertSettingsNotice(findings, { bot: BOT, session: 'keeper' });
    assertSettingsNotice(findings, { bot: BOT, session: 'holder' });
  });

  test('HS1 extra_args with a flag whose name only starts the same, --settings-file: no finding', async (t) => {
    const box = await createSandbox(t);
    await initIn(box);
    await botIn(box, { sessions: ['keeper', 'control'] });
    await handEdit(botHomeOf(box.path('bots'), BOT), { keeper: ['--settings-file', '/srv/x'], control: ['--settings', '/srv/x'] });

    const findings = await found(box);

    assert.deepEqual(settingsFindings(findings, 'keeper'), [], '--settings-file is another flag');
    assertSettingsNotice(findings, { bot: BOT, session: 'control' });
  });

  test('HS1 a Codex session and a Pi session with --settings in extra_args get no such finding; a Claude session of the same bot does', async (t) => {
    const box = await createSandbox(t);
    await fakePi(box);
    await initIn(box);
    await botIn(box, { sessions: [['coder', '--harness', 'codex'], ['pilot', '--harness', 'pi'], 'keeper'] });
    await handEdit(botHomeOf(box.path('bots'), BOT), {
      coder: ['--settings', '/srv/mine.json'],
      pilot: ['--settings', '/srv/mine.json'],
      keeper: ['--settings', '/srv/mine.json'],
    });

    const findings = await found(box);

    assert.deepEqual(settingsFindings(findings, 'coder'), [], 'a Codex line is not a Claude line');
    assert.deepEqual(settingsFindings(findings, 'pilot'), [], 'a Pi line is not a Claude line');
    assertSettingsNotice(findings, { bot: BOT, session: 'keeper' });
  });

  test('HS1 the finding ends when the hand edit is taken out', async (t) => {
    const box = await createSandbox(t);
    await initIn(box);
    await botIn(box, { sessions: ['keeper'] });
    const home = botHomeOf(box.path('bots'), BOT);
    await handEdit(home, { keeper: ['--settings', '/srv/mine.json'] });
    assertSettingsNotice(await found(box), { bot: BOT, session: 'keeper' });

    await handEdit(home, { keeper: [] });

    assert.deepEqual(settingsFindings(await found(box), 'keeper'), [], 'no --settings, no finding');
  });

  // ---------------------------------------------------------------- HC1

  /** The findings that name `where`. */
  const naming = (findings, where) => findings.filter((one) => textOf(one).includes(where));

  /** The one finding that names `where`, and names the bot. */
  function assertPathNotice(findings, { bot, where }) {
    const said = naming(findings, where);
    assert.equal(said.length, 1, `one finding should name ${where}, got: ${show(findings)}`);
    const [one] = said;
    assert.ok(one.bot === bot || textOf(one).replaceAll(where, '').includes(bot), `the finding should name the bot ${bot}, got: ${show(one)}`);
    return one;
  }

  const NOT_A_PLAIN_FOLDER = [
    ['a file', (at) => writeFile(at, 'my own notes\n')],
    ['a link to a folder', async (at, { box }) => {
      const target = path.join(box.root, 'elsewhere', 'notes');
      await mkdir(target, { recursive: true });
      await symlink(target, at);
    }],
    ['a link to a file', async (at, { box }) => {
      const target = path.join(box.root, 'elsewhere', 'notes.md');
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, 'notes\n');
      await symlink(target, at);
    }],
    ['a link that leads nowhere', (at, { box }) => symlink(path.join(box.root, 'no-such-folder'), at)],
    ['a link to itself', (at) => symlink(at, at)],
  ];
  for (const [label, put] of NOT_A_PLAIN_FOLDER) {
    test(`HC1 ${label} at <bot folder>/claude-memory: one finding names the bot and that path; health changes nothing there`, async (t) => {
      const world = await usual(t, { seedShared: false });
      assert.deepEqual(naming(await found(world.box), world.own), [], 'the control: nothing there, no finding names the path');
      await put(world.own, world);
      const before = await snapshot(world.home);

      assertPathNotice(await found(world.box), { bot: BOT, where: world.own });
      assert.deepEqual(await snapshot(world.home), before, 'health changes nothing in the bot folder');
    });
  }

  test('HC1 the finding ends when the file gives way to a plain folder', async (t) => {
    const world = await usual(t, { seedShared: false });
    await writeFile(world.own, 'my own notes\n');
    assertPathNotice(await found(world.box), { bot: BOT, where: world.own });

    await rm(world.own);
    await mkdir(world.own);

    assert.deepEqual(naming(await found(world.box), world.own), [], 'a plain folder gets no such finding');
  });

  const SILENT = [
    ['a folder named by hand in the bot\'s settings.local.json', async ({ home }) => {
      await mkdir(path.join(home, '.claude'), { recursive: true });
      const file = path.join(home, '.claude', 'settings.local.json');
      await writeFile(file, `${JSON.stringify({ [KEY]: '/somewhere/of/my/own' })}\n`);
    }],
    ['a folder named by hand in the selected profile\'s settings.json', ({ profile }) => writeFile(path.join(profile.home, 'settings.json'), `${JSON.stringify({ [KEY]: '/somewhere/of/my/own' })}\n`)],
    ['--settings in the extra_args of every Claude session of the bot', ({ home }) => handEdit(home, { daily: ['--settings', '/srv/mine.json'], other: '--settings=/srv/mine.json' })],
  ];
  for (const [label, change] of SILENT) {
    test(`HC1 a file at <bot folder>/claude-memory and ${label}: no finding names the path`, async (t) => {
      const world = await usual(t, { seedShared: false, sessions: ['daily', 'other'] });
      await writeFile(world.own, 'my own notes\n');
      assertPathNotice(await found(world.box), { bot: BOT, where: world.own });

      await change(world);

      assert.deepEqual(naming(await found(world.box), world.own), [], `${label}: the kit would name no folder in any case, so no finding`);
    });
  }

  test('HC1 one Claude session with its own --settings and one without: the finding stays', async (t) => {
    const world = await usual(t, { seedShared: false, sessions: ['daily', 'other'] });
    await writeFile(world.own, 'my own notes\n');
    await handEdit(world.home, { other: ['--settings', '/srv/mine.json'] });

    assertPathNotice(await found(world.box), { bot: BOT, where: world.own });
  });

  test('HC1 a bot with only Codex sessions, a bot with only Pi sessions and a Claude bot whose every session runs on Codex: no finding; a Claude bot beside them gets one', async (t) => {
    const world = await usual(t, { seedShared: false });
    const { box, bots } = world;
    await fakePi(box);
    await botIn(box, { name: 'codex-bot', harness: 'codex' });
    await botIn(box, { name: 'pi-bot', harness: 'pi' });
    await botIn(box, { name: 'review-bot', sessions: [['review', '--harness', 'codex']] });
    for (const bot of ['codex-bot', 'pi-bot', 'review-bot', BOT]) await writeFile(ownOf(botHomeOf(bots, bot)), 'my own notes\n');

    const findings = await found(box);

    for (const bot of ['codex-bot', 'pi-bot', 'review-bot']) {
      assert.deepEqual(naming(findings, ownOf(botHomeOf(bots, bot))), [], `${bot} has no Claude session the kit would name a folder for`);
    }
    assertPathNotice(findings, { bot: BOT, where: world.own });
  });
});
