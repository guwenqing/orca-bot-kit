// The kit makes a bot's memory folder, with an ignore file, and moves no note
// (#752).
//
// When the kit names `<bot folder>/claude-memory` on a Claude launch line
// (test/memory-folder-flag.test.js) and nothing is at that path, it makes the
// folder and writes `<bot folder>/claude-memory/.gitignore` holding exactly `*`
// and a line end, before the session starts. So git ignores the notes. A user
// who wants them in git deletes that file, and the kit never writes it again
// (ADR 0056).
//
// What is held here, from requirement R1 of own-memory-folder:
//
//   F1  `up` of a new session makes the folder and its .gitignore, and nothing
//       else in it; `init` does so for Bot Father
//   F2  each way the kit starts a Claude session makes it when it is not
//       there: `up` of a resume, `restart`, `unpause`, `temp make`
//   F3  a folder that is there gets nothing written in it: the user's own, or
//       the kit's with the .gitignore deleted or changed
//   F4  when the kit names no folder, it makes nothing: a key named by hand,
//       `--settings` in the session's extra_args, a file or a link at the
//       path, a Codex or a Pi session
//   F5  git ignores what is in the folder; once the .gitignore is deleted, it
//       does not
//   F6  the kit moves, copies and deletes no note: a folder that is there keeps
//       its files byte for byte across each start, and the folder that the
//       bots shared is as it was
//   F7  when the kit makes the folder and cannot write its .gitignore, it
//       leaves no claude-memory behind and names no folder on that line; the
//       next start, with the cause gone, makes both as usual
//   F8  the same when the .gitignore is made and its write then fails: no
//       claude-memory is left, not even with an empty .gitignore
//
// The kit makes the folder before it types the launch line. The fake Orca does
// not run the harness, so these tests read the folder when the kit's command
// has returned, which is after the line was typed: they hold that the folder is
// there when the command is done, not the order inside it.
//
// A negative case has its positive in the same sandbox: another bot, or the
// same bot before the change, gets its folder in the same run.
//
// Every run is in a sandbox (helpers/cli.js): its own HOME, a fake Orca, and no
// real harness. Nothing here reads the real Orca's data or a real profile.

import assert from 'node:assert/strict';
import { existsSync, lstatSync } from 'node:fs';
import { chmod, lstat, mkdir, readdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { parse, stringify } from 'yaml';

import {
  botHomeOf,
  conversationOnRecord,
  createSandbox,
  git,
  kitLaunchMark,
  recordSession,
  repoRoot,
  sessionIn,
  sh,
  shellWord,
  snapshot,
  typedInto,
} from './helpers/cli.js';
import { fakePi } from './helpers/pi.js';

const BOT = 'api-bot';
const OTHER = 'web-bot';
const KEY = 'autoMemoryDirectory';
const FOLDER = 'claude-memory';

/** What the .gitignore holds, exactly. */
const IGNORE_ALL = '*\n';

/** Orca's data folder in a sandbox. */
const orcaDataOf = (box) => path.join(box.home, 'Library', 'Application Support', 'orca');

/** A selected Claude profile whose `projects` links to `~/.claude/projects` under the sandbox's HOME. */
async function profileIn(box) {
  const data = orcaDataOf(box);
  const home = path.join(data, 'claude-profiles', 'profile-one', 'home');
  const projects = path.join(box.home, '.claude', 'projects');
  await mkdir(home, { recursive: true });
  await mkdir(projects, { recursive: true });
  await symlink(projects, path.join(home, 'projects'));
  await writeFile(path.join(data, 'claude-profiles', 'selected-host'), home);
  return { data, home, projects };
}

const ownOf = (home) => path.join(home, FOLDER);

const AS_ROOT = process.getuid?.() === 0 ? 'root writes into a folder of mode 555, so the write cannot be made to fail here' : undefined;

/** A run of `obk` that must go through. */
async function ok(box, args, options) {
  const result = await box.run(args, options);
  assert.equal(result.code, 0, `obk ${args.join(' ')} should have gone through:\n${result.stdout}${result.stderr}`);
  return result;
}

/** One more bot, on `harness`, with the sessions named. Each session is `name` or `[name, ...flags of session add]`. */
async function botIn(box, { name = BOT, harness = 'claude', sessions = ['daily'] } = {}) {
  await ok(box, ['bot', 'create', '--bots', 'bots', '--name', name, '--harness', harness]);
  for (const session of sessions) {
    const [each, ...flags] = [session].flat();
    await ok(box, ['session', 'add', '--bots', 'bots', '--bot', name, '--name', each, ...flags]);
  }
}

/** A sandbox with a profile, a bots repo, and api-bot and web-bot with one Claude session each. Nothing is up but Bot Father. */
async function fleet(t, { sessions = ['daily'] } = {}) {
  const box = await createSandbox(t);
  const profile = await profileIn(box);
  await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);
  await botIn(box, { sessions });
  await botIn(box, { name: OTHER });
  const bots = box.path('bots');
  return { box, profile, bots, home: botHomeOf(bots, BOT), other: botHomeOf(bots, OTHER) };
}

const up = (box, bot, session = 'daily') => ok(box, ['up', '--bots', 'bots', '--bot', bot, '--session', session]);

/** The folder is a plain folder, not a link, and holds the .gitignore alone, with exactly `*` and a line end. */
async function assertMade(home, why) {
  const at = ownOf(home);
  assert.ok(existsSync(at), `${why}: ${at} should be there`);
  assert.ok(lstatSync(at).isDirectory() && !lstatSync(at).isSymbolicLink(), `${why}: ${at} should be a plain folder`);
  assert.deepEqual(Object.keys(await snapshot(at)), ['.gitignore'], `${why}: the folder holds the .gitignore and nothing else`);
  assert.ok(lstatSync(path.join(at, '.gitignore')).isFile(), `${why}: the .gitignore is a plain file`);
  assert.equal(await readFile(path.join(at, '.gitignore'), 'utf8'), IGNORE_ALL, `${why}: the .gitignore holds exactly "*" and a line end`);
}

/** Nothing is at `<home>/claude-memory`, not even a link. */
function assertNothingAt(home, why) {
  let there = true;
  try {
    lstatSync(ownOf(home));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    there = false;
  }
  assert.equal(there, false, `${why}: nothing should be at ${ownOf(home)}`);
}

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

/** Change one session's `extra_args` in bot.yaml by hand (`session add` refuses `--settings`). */
async function handEdit(home, name, extra) {
  const file = path.join(home, 'bot.yaml');
  const written = parse(await readFile(file, 'utf8'));
  written.sessions = written.sessions.map((session) => (session.name === name ? { ...session, extra_args: extra } : session));
  await writeFile(file, stringify(written));
}

/** Tell the book which conversation a session runs, as the kit's hook does. */
async function reported(box, bots, name, bot = BOT) {
  const entry = await sessionIn(bots, bot, name);
  const id = `conversation-of-${name}`;
  const ran = await recordSession(box, { bots, bot, tab: entry.tab, session: id, source: 'startup' });
  assert.equal(ran.code, 0, ran.stderr);
  await conversationOnRecord(box, { harness: 'claude', cwd: botHomeOf(bots, bot), id });
  return id;
}

/** The environment of a command run inside a session's tab. */
async function inTabOf(box, bots, name) {
  const { tab } = await sessionIn(bots, BOT, name);
  const terminal = (await box.orca.terminals()).find((one) => one.tabId === tab);
  return { ...box.env, ORCA_TERMINAL_HANDLE: terminal.handle, ORCA_TAB_ID: terminal.tabId, ...kitLaunchMark(box, terminal) };
}

/**
 * The ways the kit starts a Claude session of api-bot after its first `up`,
 * each given the world after that first start. Each gives back nothing; the
 * test reads the folder.
 */
const WAYS = [
  ['up of a resume', async ({ box, bots }) => {
    await reported(box, bots, 'daily');
    const { tab } = await sessionIn(bots, BOT, 'daily');
    await box.orca.set({ terminals: (await box.orca.terminals()).filter((terminal) => terminal.tabId !== tab) });
    await up(box, BOT);
  }],
  ['obk restart', async ({ box, bots }) => {
    await reported(box, bots, 'daily');
    await ok(box, ['restart', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);
  }],
  ['obk unpause', async ({ box, bots }) => {
    await reported(box, bots, 'daily');
    await ok(box, ['pause', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);
    await ok(box, ['unpause', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);
  }],
  ['obk temp make', async ({ box, bots }) => {
    const env = await inTabOf(box, bots, 'daily');
    await ok(box, ['temp', 'make', '--bots', 'bots', '--name', 'scout', '--prompt', 'Read the pull request.'], { env });
  }],
];

describe('the kit makes a bot\'s memory folder with an ignore file, and moves no note (#752)', { concurrency: 8 }, () => {
  // ---------------------------------------------------------------- F1

  test('F1 up of a new Claude session makes <bot folder>/claude-memory with a .gitignore of exactly "*", and nothing else in it', async (t) => {
    const { box, home, other } = await fleet(t);
    assertNothingAt(home, 'the premise: before the first start');

    await up(box, BOT);

    await assertMade(home, 'after up');
    assertNothingAt(other, 'a bot that was not started gets nothing');
  });

  test('F1 init makes Bot Father\'s folder as it brings Bot Father up', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);

    await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);

    await assertMade(botHomeOf(box.path('bots'), 'bot-father'), 'after init');
  });

  test('F1 with no Orca profile at all, up still makes the folder', async (t) => {
    const box = await createSandbox(t);
    await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);
    await botIn(box);

    await up(box, BOT);

    await assertMade(botHomeOf(box.path('bots'), BOT), 'after up with no profile');
  });

  test('F1 a session with a work dir of its own: the folder is made in the bot folder, not the work dir', async (t) => {
    const { box, home } = await fleet(t, { sessions: [['daily', '--work-dir', 'work/api']] });
    await mkdir(path.join(home, 'work', 'api'), { recursive: true });

    await up(box, BOT);

    await assertMade(home, 'after up');
    assertNothingAt(path.join(home, 'work', 'api'), 'nothing in the work dir');
  });

  // ---------------------------------------------------------------- F2

  for (const [label, start] of WAYS) {
    test(`F2 ${label}: the folder is made again when it is not there`, async (t) => {
      const world = await fleet(t);
      await up(world.box, BOT);
      await assertMade(world.home, 'the control: the first start made it');
      await rm(ownOf(world.home), { recursive: true });

      await start(world);

      await assertMade(world.home, `after ${label}`);
    });
  }

  // ---------------------------------------------------------------- F3

  test('F3 a folder of the user\'s own with notes and no .gitignore: the start writes nothing in it, byte for byte', async (t) => {
    const { box, home, other } = await fleet(t);
    const at = ownOf(home);
    await mkdir(path.join(at, 'deeper'), { recursive: true });
    await writeFile(path.join(at, 'MEMORY.md'), '- [A note](a-note.md) — something learnt.\n');
    await writeFile(path.join(at, 'a-note.md'), 'Something learnt.\n');
    await writeFile(path.join(at, 'deeper', 'more.md'), 'More.\n');
    const before = await snapshot(at);

    await up(box, BOT);
    await up(box, OTHER);

    assert.deepEqual(await snapshot(at), before, 'the user\'s folder is as it was, with no .gitignore added');
    await assertMade(other, 'the control: a bot with no folder gets one in the same run');
  });

  test('F3 an empty folder of the user\'s own stays empty', async (t) => {
    const { box, home } = await fleet(t);
    await mkdir(ownOf(home));

    await up(box, BOT);

    assert.deepEqual(await snapshot(ownOf(home)), {}, 'the folder is still empty');
  });

  for (const [label, start] of WAYS) {
    test(`F3 ${label}: a .gitignore the user deleted is not written again, and the notes stay byte for byte`, async (t) => {
      const world = await fleet(t);
      await up(world.box, BOT);
      await assertMade(world.home, 'the control: the first start made it');
      const at = ownOf(world.home);
      await rm(path.join(at, '.gitignore'));
      await writeFile(path.join(at, 'MEMORY.md'), '- a note\n');
      const before = await snapshot(at);

      await start(world);

      assert.deepEqual(await snapshot(at), before, `after ${label}, the folder is as the user left it`);
    });
  }

  test('F3 a .gitignore the user changed stays as they wrote it', async (t) => {
    const { box, bots, home } = await fleet(t);
    await up(box, BOT);
    await assertMade(home, 'the control: the first start made it');
    const ignore = path.join(ownOf(home), '.gitignore');
    await writeFile(ignore, '*\n!MEMORY.md\n');
    await reported(box, bots, 'daily');

    await ok(box, ['restart', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);

    assert.equal(await readFile(ignore, 'utf8'), '*\n!MEMORY.md\n');
  });

  // ---------------------------------------------------------------- F4

  const NAMES_NONE = [
    ['the bot\'s settings.local.json names a folder by hand', ({ home }) => addTo(path.join(home, '.claude', 'settings.local.json'), { [KEY]: '/somewhere/of/my/own' })],
    ['the bot\'s settings.json names a folder by hand', ({ home }) => addTo(path.join(home, '.claude', 'settings.json'), { [KEY]: '/somewhere/of/my/own' })],
    ['the session\'s extra_args hold --settings', ({ home }) => handEdit(home, 'daily', ['--settings', '/srv/mine.json'])],
    ['the session\'s extra_args hold --settings=value', ({ home }) => handEdit(home, 'daily', '--settings=/srv/mine.json')],
  ];
  for (const [label, change] of NAMES_NONE) {
    test(`F4 ${label}: the kit makes nothing; another bot gets its folder`, async (t) => {
      const world = await fleet(t);
      await change(world);

      await up(world.box, BOT);
      await up(world.box, OTHER);

      assertNothingAt(world.home, 'the kit names no folder');
      await assertMade(world.other, 'the control');
    });
  }

  test('F4 the selected profile\'s settings.json names a folder by hand: the kit makes nothing for a bot started after it', async (t) => {
    const { box, profile, home, other } = await fleet(t);
    await up(box, OTHER);
    await assertMade(other, 'the control, before the key');
    await addTo(path.join(profile.home, 'settings.json'), { [KEY]: '/somewhere/of/my/own' });

    await up(box, BOT);

    assertNothingAt(home, 'the kit names no folder');
  });

  test('F4 the repository root\'s settings.local.json names a folder by hand: the kit makes nothing for a bot started after it', async (t) => {
    const { box, bots, home, other } = await fleet(t);
    await up(box, OTHER);
    await assertMade(other, 'the control, before the key');
    await addTo(path.join(bots, '.claude', 'settings.local.json'), { [KEY]: '/somewhere/of/my/own' });

    await up(box, BOT);

    assertNothingAt(home, 'the kit names no folder');
  });

  test('F4 a Codex bot, a Pi bot and a Codex session of a Claude bot make nothing; a Claude session beside them does', async (t) => {
    const { box, bots, home } = await fleet(t, { sessions: [['review', '--harness', 'codex'], 'daily'] });
    await fakePi(box);
    await botIn(box, { name: 'codex-bot', harness: 'codex' });
    await botIn(box, { name: 'pi-bot', harness: 'pi' });

    await up(box, 'codex-bot');
    await up(box, 'pi-bot');
    await up(box, BOT, 'review');
    assertNothingAt(home, 'a Codex session of a Claude bot makes nothing');

    await up(box, BOT, 'daily');

    assertNothingAt(botHomeOf(bots, 'codex-bot'), 'a Codex bot');
    assertNothingAt(botHomeOf(bots, 'pi-bot'), 'a Pi bot');
    await assertMade(home, 'the Claude session of the same bot');
  });

  const NOT_A_FOLDER = [
    ['a file', async (at) => {
      await writeFile(at, 'my own notes\n');
    }],
    ['a link to a folder elsewhere', async (at, { box }) => {
      const target = path.join(box.root, 'elsewhere', 'notes');
      await mkdir(target, { recursive: true });
      await writeFile(path.join(target, 'MEMORY.md'), '- mine\n');
      await symlink(target, at);
      return target;
    }],
    ['a relative link to a folder in the bot folder', async (at, { home }) => {
      await mkdir(path.join(home, 'notes'));
      await symlink('notes', at);
      return path.join(home, 'notes');
    }],
    ['a link that leads nowhere', async (at, { box }) => {
      await symlink(path.join(box.root, 'no-such-folder'), at);
      return path.join(box.root, 'no-such-folder');
    }],
  ];
  for (const [label, put] of NOT_A_FOLDER) {
    test(`F4 ${label} at <bot folder>/claude-memory: the kit leaves it and what it leads to as they were; another bot gets its folder`, async (t) => {
      const world = await fleet(t);
      const at = ownOf(world.home);
      const target = await put(at, world);
      const link = lstatSync(at).isSymbolicLink() ? await readlink(at) : undefined;
      const before = link === undefined ? await readFile(at, 'utf8') : undefined;
      const targetBefore = target !== undefined && existsSync(target) ? await snapshot(target) : undefined;

      await up(world.box, BOT);
      await up(world.box, OTHER);

      if (link === undefined) {
        assert.ok(lstatSync(at).isFile(), 'the file is still a file');
        assert.equal(await readFile(at, 'utf8'), before, 'the file is as it was');
      } else {
        assert.ok(lstatSync(at).isSymbolicLink(), 'the link is still a link');
        assert.equal(await readlink(at), link, 'the link leads where it led');
      }
      if (targetBefore !== undefined) assert.deepEqual(await snapshot(target), targetBefore, 'what the link leads to is as it was: no .gitignore in it');
      if (target !== undefined && targetBefore === undefined) assert.ok(!existsSync(target), 'the folder a link leads to is not made');
      await assertMade(world.other, 'the control');
    });
  }

  // ---------------------------------------------------------------- F5

  /** What `git status` lists in the bots repo, as paths from its top. */
  async function listed(bots) {
    const status = await git(['status', '--porcelain', '--untracked-files=all'], bots);
    assert.equal(status.code, 0, status.stderr);
    return status.stdout.split('\n').filter((line) => line !== '').map((line) => line.slice(3));
  }

  test('F5 git ignores what is in the folder: a note put there does not show in git status; a note beside the folder does', async (t) => {
    const { box, bots, home } = await fleet(t);
    await up(box, BOT);
    await assertMade(home, 'the control: the start made it');
    await writeFile(path.join(ownOf(home), 'MEMORY.md'), '- [A note](a-note.md)\n');
    await writeFile(path.join(ownOf(home), 'a-note.md'), 'Something learnt.\n');
    await mkdir(path.join(ownOf(home), 'deeper'));
    await writeFile(path.join(ownOf(home), 'deeper', 'more.md'), 'More.\n');
    await writeFile(path.join(home, 'beside.md'), 'Beside the folder.\n');

    const seen = await listed(bots);

    assert.ok(seen.includes(`bots/${BOT}/beside.md`), `the control: a new file beside the folder shows, got: ${JSON.stringify(seen)}`);
    const inFolder = seen.filter((one) => one.startsWith(`bots/${BOT}/${FOLDER}`));
    assert.deepEqual(inFolder, [], 'nothing in the folder shows, the .gitignore itself neither');
  });

  test('F5 a user who deletes the .gitignore takes the rule away: the notes show in git status', async (t) => {
    const { box, bots, home } = await fleet(t);
    await up(box, BOT);
    await assertMade(home, 'the control: the start made it');
    await writeFile(path.join(ownOf(home), 'MEMORY.md'), '- a note\n');
    assert.ok(!(await listed(bots)).some((one) => one.startsWith(`bots/${BOT}/${FOLDER}`)), 'the control: ignored while the .gitignore is there');

    await rm(path.join(ownOf(home), '.gitignore'));

    assert.ok((await listed(bots)).includes(`bots/${BOT}/${FOLDER}/MEMORY.md`), 'the note shows once the .gitignore is gone');
  });

  // ---------------------------------------------------------------- F6

  test('F6 the folder that the bots shared keeps its notes, and none of them is copied into the bot\'s new folder', async (t) => {
    const { box, profile, bots, home } = await fleet(t);
    const shared = path.join(profile.projects, bots.replaceAll(/[^A-Za-z0-9]/g, '-'), 'memory');
    await mkdir(shared, { recursive: true });
    await writeFile(path.join(shared, 'MEMORY.md'), '- [A note](a-note.md)\n');
    await writeFile(path.join(shared, 'a-note.md'), 'Something learnt.\n');
    // Only the shared folder: the test's own record of a conversation goes under projects too.
    const before = await snapshot(shared);

    await up(box, BOT);
    await reported(box, bots, 'daily');
    await ok(box, ['restart', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);

    assert.deepEqual(await snapshot(shared), before, 'the shared folder is as it was, its notes among it');
    await assertMade(home, 'the bot\'s folder holds the .gitignore alone: no note moved or copied');
  });

  for (const [label, start] of WAYS) {
    test(`F6 ${label}: a folder the kit made, with the bot's notes in it, keeps them byte for byte`, async (t) => {
      const world = await fleet(t);
      await up(world.box, BOT);
      await assertMade(world.home, 'the control: the first start made it');
      const at = ownOf(world.home);
      await writeFile(path.join(at, 'MEMORY.md'), '- [A note](a-note.md)\n');
      await writeFile(path.join(at, 'a-note.md'), 'Something learnt.\n');
      const before = await snapshot(at);

      await start(world);

      assert.deepEqual(await snapshot(at), before, `after ${label}, the folder is as it was`);
    });
  }

  // ---------------------------------------------------------------- F7

  /**
   * Run `obk <args>` through a real shell under umask 0222. A folder the kit
   * makes then has mode 555: its mkdir goes through, and a file written into
   * that new folder is refused (EACCES). Files the kit writes into folders
   * that are already there still go through. The sandbox's own environment
   * is kept, so it is the sandbox's `obk` on PATH.
   */
  const underUmask = (box, args) => sh(`umask 0222; exec obk ${args.map(shellWord).join(' ')}`, { cwd: box.cwd, env: box.env });

  /**
   * Give the owner's write back to what the umask run made in the kit's
   * folder of locks, `<bots>.locks`. The kit makes a session's lock file the
   * first time it takes that session's turn, and under umask 0222 that file
   * has mode 444, so the kit's next turn of the session is refused. That is
   * the umask, not the memory folder, so the test undoes it before the next
   * start. Nothing else is changed.
   */
  async function locksWritableAgain(bots) {
    const locks = `${bots}.locks`;
    for (const name of await readdir(locks, { recursive: true })) {
      const file = path.join(locks, name);
      const { mode } = await lstat(file);
      if ((mode & 0o200) === 0) await chmod(file, mode | 0o200);
    }
  }

  /** The first line typed into a session's current tab. */
  async function lineIn(box, bots, name) {
    const { tab } = await sessionIn(bots, BOT, name);
    const terminal = (await box.orca.terminals()).find((one) => one.tabId === tab);
    assert.ok(terminal, `Orca should have ${BOT}/${name}'s tab ${tab}`);
    return typedInto(terminal)[0];
  }

  /** The ways a start runs under the umask, each after the session's first start. */
  const FAILING_WAYS = [
    ['up of a new session', async ({ box }) => underUmask(box, ['up', '--bots', 'bots', '--bot', BOT, '--session', 'daily']), { first: false }],
    ['obk restart', async ({ box, bots }) => {
      await reported(box, bots, 'daily');
      return underUmask(box, ['restart', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);
    }, { first: true }],
  ];
  for (const [label, failing, { first }] of FAILING_WAYS) {
    test(`F7 ${label}: the kit makes the folder and cannot write its .gitignore, so it leaves no claude-memory and names no folder on the line; a restart with the cause gone makes both`, { skip: AS_ROOT }, async (t) => {
      const world = await fleet(t, { sessions: ['control', 'daily'] });
      const { box, bots, home } = world;
      // The premise: under umask 0222, mkdir goes through and the file write in the new folder does not.
      const probe = path.join(box.root, 'umask-probe');
      const tried = await sh(`umask 0222; mkdir ${shellWord(probe)} && : > ${shellWord(path.join(probe, '.gitignore'))}`, { cwd: box.cwd, env: box.env });
      assert.ok(existsSync(probe) && !existsSync(path.join(probe, '.gitignore')) && tried.code !== 0, `the premise: umask 0222 lets mkdir through and stops the file write, got code ${tried.code}: ${tried.stderr}`);
      // The control: a start of the same bot with the usual umask makes the folder, and so the bot's other folders are there.
      await up(box, BOT, 'control');
      await assertMade(home, 'the control');
      await rm(ownOf(home), { recursive: true });
      if (first) await up(box, BOT, 'daily');
      if (first) await rm(ownOf(home), { recursive: true });

      const ran = await failing(world);

      const said = `exit ${ran.code}\n${ran.stdout}${ran.stderr}`;
      assertNothingAt(home, `the kit could not write the .gitignore, so it leaves no folder it made (the run said: ${said})`);
      const line = await lineIn(box, bots, 'daily');
      assert.equal(typeof line, 'string', `a line was typed into daily's tab (the run said: ${said})`);
      assert.ok(!line.includes('--settings') && !line.includes(KEY), `the line names no folder, got: ${line}`);

      await locksWritableAgain(bots);
      await reported(box, bots, 'daily');
      await ok(box, ['restart', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);

      await assertMade(home, 'the next start, with the usual umask');
      const next = await lineIn(box, bots, 'daily');
      assert.ok(next.includes('--settings') && next.includes(KEY) && next.includes(ownOf(home)), `the next start names the folder, got: ${next}`);
    });
  }

  // ---------------------------------------------------------------- F8

  // A file-size limit of 0 lets the kit make the folder and open the
  // .gitignore, and then stops the write itself (EFBIG; SIGXFSZ is ignored, so
  // the write fails and the process goes on). Through `obk` this cannot be
  // reached: the same limit stops the kit's book, its prompt file and the fake
  // Orca's own state before anything is typed. So this case calls the kit's
  // own step, `madeMemoryFolder` of src/memory.js, the function `up`, `restart`,
  // `unpause` and `temp make` call for a Claude line, in a child process under
  // that limit, with the sandbox's environment. The next start goes through
  // `obk up`, with no limit.

  /** Run `script`, an ES module, by node under `ulimit -f 0` with SIGXFSZ ignored; give back what it printed as JSON. */
  async function underNoFileSize(box, script) {
    const ran = await sh(`ulimit -f 0; trap '' XFSZ; exec ${shellWord(process.execPath)} --input-type=module -e ${shellWord(script)}`, { cwd: box.cwd, env: box.env });
    assert.equal(ran.code, 0, `the child should run to its end: ${ran.stdout}${ran.stderr}`);
    return JSON.parse(ran.stdout);
  }

  test('F8 the kit makes the folder and its .gitignore, and the write of "*" then fails: it names no folder and leaves no claude-memory, not even with an empty .gitignore; the next start makes both', { skip: AS_ROOT }, async (t) => {
    const { box, bots, home } = await fleet(t);
    // The premise: under the limit, a file is made and the write into it fails, so an empty file is left.
    const probe = path.join(box.root, 'size-probe');
    const seen = await underNoFileSize(box, `
      import { existsSync, statSync, writeFileSync } from 'node:fs';
      let code = null;
      try { writeFileSync(${JSON.stringify(probe)}, '*\\n', { flag: 'wx' }); } catch (error) { code = error.code; }
      process.stdout.write(JSON.stringify({ code, made: existsSync(${JSON.stringify(probe)}), size: existsSync(${JSON.stringify(probe)}) ? statSync(${JSON.stringify(probe)}).size : null }));
    `);
    assert.deepEqual(seen, { code: 'EFBIG', made: true, size: 0 }, 'the premise: under the limit the file is made, and the write into it fails with EFBIG');
    assertNothingAt(home, 'the premise: nothing is at the bot\'s claude-memory before the start');

    const first = await underNoFileSize(box, `
      import { madeMemoryFolder } from ${JSON.stringify(pathToFileURL(path.join(repoRoot, 'src', 'memory.js')).href)};
      process.stdout.write(JSON.stringify({ named: madeMemoryFolder(${JSON.stringify(home)}) ?? null }));
    `);

    assert.equal(first.named, null, 'the kit names no folder when it could not write the .gitignore');
    assertNothingAt(home, `the kit could not write the .gitignore, so it leaves no folder it made (it holds: ${existsSync(ownOf(home)) ? JSON.stringify(await snapshot(ownOf(home))) : 'nothing'})`);

    await up(box, BOT);

    await assertMade(home, 'the next start, with no limit');
    const line = await lineIn(box, bots, 'daily');
    assert.ok(line.includes('--settings') && line.includes(KEY) && line.includes(ownOf(home)), `the next start names the folder, got: ${line}`);
  });
});
