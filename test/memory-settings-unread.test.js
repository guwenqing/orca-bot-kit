// A start report says when the kit names no memory folder for a Claude Code
// session only because a settings file could not be read or is not valid JSON
// (#782).
//
// The kit names the bot's own memory folder on a Claude launch line
// (test/memory-folder-flag.test.js). It names none when a settings file where a
// user can name a folder by hand has an `autoMemoryDirectory` key, and also
// when such a file is there but cannot be read, or is not valid JSON: such a
// file may name a folder. The session then starts on Claude Code's own default
// folder, which the bots of one repository share. That stays. What is new: the
// report of the start says so.
//
// The settings files, where a broken one does not stop the start:
//
//   local    the bot's .claude/settings.local.json
//   root     the repository root's .claude/settings.local.json (the bots folder)
//   profile  the selected Orca profile's settings.json
//   user     ~/.claude/settings.json, with no profile selected
//
// The bot's own .claude/settings.json is not a case here: the kit writes its
// session hook there, so a broken one stops the start with an error of its own
// (test/memory-folder-flag.test.js, M8).
//
// What is held here:
//
//   U1  `up` of a Claude session with one broken file: under that session's tab
//       lines, a line names the file's full path, says `cannot read` and the
//       error code (a read error) or `is not valid JSON` (a parse error), and
//       says `the folder that the bots shared`. The session starts: no refused
//       line, exit 0. The kit only reads the file: its bytes and its mode stay
//   U2  two broken files: each one is named
//   U3  `restart`, `unpause`, `temp make` and `init` say it the same way
//   U4  no such line: a readable file names the folder by hand (another file
//       broken), no file is broken, a Codex session, a session whose own
//       extra_args carry `--settings`
//   U5  the line does not promise that a repair gives the bot's own folder: a
//       repaired file can name a folder by hand, and then the kit names none.
//       It says that the kit `reads it again at the next start` (`reads them
//       again at the next start` when it names more than one file). Every
//       line of U1 to U4 is held to this too
//
// The tests hold the path and the words above, not other wording, and not the
// number of lines. The kit wraps the prose of its reports, so the text under a
// tab is read as one (`joined`): a wrap does not hide the path or the words.
// Every run is in a sandbox (helpers/cli.js): its own HOME, a
// fake Orca, and no real harness.

import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { parse, stringify } from 'yaml';

import {
  botHomeOf,
  conversationOnRecord,
  createSandbox,
  kitLaunchMark,
  recordSession,
  sessionIn,
  typedInto,
} from './helpers/cli.js';

const BOT = 'api-bot';
const OTHER = 'web-bot';
const KEY = 'autoMemoryDirectory';
const SHARED = 'the folder that the bots shared';
/** What the line says of a repair: the kit reads the file again, or the files. */
const AGAIN_ONE = 'reads it again at the next start';
const AGAIN = /reads (it|them) again at the next start/;
/** The promise the line must not make: a repaired file can name a folder by hand. */
const PROMISES = ["names its bot's own folder", "names the bot's own folder"];
const AS_ROOT = process.getuid?.() === 0 ? 'root reads a file of mode 000, so it cannot be made unreadable here' : undefined;

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

/**
 * A sandbox with a bots repo and api-bot with the sessions named. With
 * `profile`, a selected Orca profile. Nothing is up but Bot Father.
 */
async function fleet(t, { profile: withProfile = true, sessions = ['daily'] } = {}) {
  const box = await createSandbox(t);
  const profile = withProfile ? await profileIn(box) : undefined;
  await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);
  await botIn(box, { sessions });
  const bots = box.path('bots');
  return { box, profile, bots, home: botHomeOf(bots, BOT) };
}

/** The settings files of the cases, for the bot at `home`. */
const filesOf = ({ box, profile, bots, home }) => ({
  local: path.join(home, '.claude', 'settings.local.json'),
  root: path.join(bots, '.claude', 'settings.local.json'),
  profile: profile === undefined ? undefined : path.join(profile.home, 'settings.json'),
  user: path.join(box.home, '.claude', 'settings.json'),
});

/** The text of a parse error: a trailing comma. */
const NOT_JSON = '{"a":1,}';
/** The text of a file of mode 000. */
const UNREAD_TEXT = '{}\n';

/**
 * Break `file` in one of two ways: `parse` writes JSON with a trailing comma;
 * `read` writes a good file and takes every permission off it (mode 000). Gives
 * back what to check after the run. The mode is given back in cleanup.
 */
async function breakFile(t, file, kind) {
  await mkdir(path.dirname(file), { recursive: true });
  if (kind === 'parse') {
    await writeFile(file, NOT_JSON);
    return { file, kind, text: NOT_JSON, mode: (await stat(file)).mode & 0o777 };
  }
  await writeFile(file, UNREAD_TEXT);
  await chmod(file, 0o000);
  t.after(() => chmod(file, 0o644).catch(() => {}));
  return { file, kind, text: UNREAD_TEXT, mode: 0o000 };
}

/** The kit only read the file: its mode and its bytes are as they were. */
async function assertUntouched(broken) {
  const mode = (await stat(broken.file)).mode & 0o777;
  assert.equal(mode, broken.mode, `the mode of ${broken.file} stays ${broken.mode.toString(8)}, got ${mode.toString(8)}`);
  if (broken.kind === 'read') await chmod(broken.file, 0o644);
  assert.equal(await readFile(broken.file, 'utf8'), broken.text, `the bytes of ${broken.file} stay as they were`);
  if (broken.kind === 'read') await chmod(broken.file, 0o000);
}

/**
 * The lines of a plain report under the tab line of tab `tabId`: from the
 * line that names `tab <tabId>` to the next line that does not start with a
 * space. Gives back the lines under it, the tab line not among them.
 */
function underTab(stdout, tabId) {
  const lines = stdout.split('\n');
  const at = lines.findIndex((line) => !/^\s/.test(line) && line.includes(`tab ${tabId}`));
  assert.ok(at >= 0, `the report should have a line for tab ${tabId}, got:\n${stdout}`);
  const under = [];
  for (const line of lines.slice(at + 1)) {
    if (!/^\s/.test(line)) break;
    under.push(line);
  }
  return under;
}

/** The lines under the current tab of `bot`/`session` in a report. */
async function linesUnder(stdout, bots, bot, session) {
  const entry = await sessionIn(bots, bot, session);
  assert.equal(typeof entry?.tab, 'string', `the book should hold a tab for ${bot}/${session}, got: ${JSON.stringify(entry)}`);
  return underTab(stdout, entry.tab);
}

/**
 * The text under a session's tab, read as one: each line trimmed, and the
 * lines joined by one space. The kit wraps the prose of its reports, so a
 * line that holds a long path and its words may go on over the next lines;
 * read this way, the path and the words are found where the wrap fell.
 */
const joined = (under) => under.map((line) => line.trim()).join(' ');

/** What the text must say for the kind of breakage. */
const saysKind = (text, kind) => (kind === 'parse' ? text.includes('is not valid JSON') : text.includes('cannot read') && text.includes('EACCES'));
const kindWords = (kind) => (kind === 'parse' ? '"is not valid JSON"' : '"cannot read" and "EACCES"');

/**
 * Under the session's tab, the report names the file's full path, says the
 * kind of breakage, and says the folder that the bots shared.
 */
async function assertSaid(stdout, bots, { bot = BOT, session }, broken) {
  const text = joined(await linesUnder(stdout, bots, bot, session));
  assert.ok(text.includes(broken.file), `the lines under ${bot}/${session}'s tab should name ${broken.file}, got:\n${stdout}`);
  assert.ok(saysKind(text, broken.kind), `the lines under ${bot}/${session}'s tab should say ${kindWords(broken.kind)} for ${broken.file}, got:\n${stdout}`);
  assert.ok(text.includes(SHARED), `the lines under ${bot}/${session}'s tab should say "${SHARED}", got:\n${stdout}`);
  assert.match(text, AGAIN, `the lines under ${bot}/${session}'s tab should say that the kit "${AGAIN_ONE}" (or "reads them again at the next start"), got:\n${stdout}`);
  for (const promise of PROMISES) assert.ok(!text.includes(promise), `a repaired file can name a folder by hand, so nothing under ${bot}/${session}'s tab should promise that the next start "${promise}", got:\n${stdout}`);
  return text;
}

/** Under the session's tab, nothing names the files, or says the folder that the bots shared. */
async function assertNotSaid(stdout, bots, { bot = BOT, session }, files, why) {
  const text = joined(await linesUnder(stdout, bots, bot, session));
  for (const file of files) assert.ok(!text.includes(file), `${why}: nothing under ${bot}/${session}'s tab should name ${file}, got:\n${stdout}`);
  assert.ok(!text.includes(SHARED), `${why}: nothing under ${bot}/${session}'s tab should say "${SHARED}", got:\n${stdout}`);
}

/** The refused lines of a plain report. */
const refusedIn = (stdout) => stdout.split('\n').filter((line) => line.startsWith('refused'));

/** The run went through, refused nothing, and the session has a tab with a launch line that names no folder of the kit's. */
async function assertStartedWithoutFolder(box, result, bots, { bot = BOT, session }) {
  assert.equal(result.code, 0, `the run should go through:\n${result.stdout}${result.stderr}`);
  assert.deepEqual(refusedIn(result.stdout), [], `no session is refused, got:\n${result.stdout}`);
  const { tab } = await sessionIn(bots, bot, session);
  const terminal = (await box.orca.terminals()).find((one) => one.tabId === tab);
  assert.ok(terminal, `Orca should have ${bot}/${session}'s tab ${tab}`);
  const [line] = typedInto(terminal);
  assert.ok(typeof line === 'string' && line.includes(`${bot}`), `a launch line was typed for ${bot}/${session}, got: ${JSON.stringify(typedInto(terminal))}`);
  assert.ok(!line.includes(KEY), `the premise: the kit names no folder of its own on the line, got: ${line}`);
}

/** Change sessions' `extra_args` in bot.yaml by hand (`session add` refuses `--settings`). */
async function handEdit(home, extras) {
  const file = path.join(home, 'bot.yaml');
  const written = parse(await readFile(file, 'utf8'));
  written.sessions = written.sessions.map((session) => (Object.hasOwn(extras, session.name) ? { ...session, extra_args: extras[session.name] } : session));
  await writeFile(file, stringify(written));
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

const up = (box, bot = BOT, session) => box.run(['up', '--bots', 'bots', '--bot', bot, ...(session === undefined ? [] : ['--session', session])]);

describe('a start report says when a settings file that cannot be read or is not valid JSON keeps the kit from naming a memory folder (#782)', { concurrency: 8 }, () => {
  // ---------------------------------------------------------------- U1

  const CASES = [
    ['local', 'parse', { profile: true }],
    ['local', 'read', { profile: true }],
    ['root', 'parse', { profile: true }],
    ['root', 'read', { profile: true }],
    ['profile', 'parse', { profile: true }],
    ['profile', 'read', { profile: true }],
    ['user', 'parse', { profile: false }],
    ['user', 'read', { profile: false }],
  ];
  for (const [where, kind, { profile }] of CASES) {
    const label = kind === 'parse' ? 'is not valid JSON' : 'cannot be read (mode 000)';
    const setting = where === 'user' ? ', with no profile selected' : '';
    test(`U1 up: the ${where} settings file ${label}${setting}: the session starts, a line under its tab names the file, says why and says the folder that the bots shared; the file is as it was`, { skip: kind === 'read' ? AS_ROOT : undefined }, async (t) => {
      const world = await fleet(t, { profile });
      const { box, bots } = world;
      const broken = await breakFile(t, filesOf(world)[where], kind);

      const result = await up(box, BOT, 'daily');

      await assertStartedWithoutFolder(box, result, bots, { session: 'daily' });
      await assertSaid(result.stdout, bots, { session: 'daily' }, broken);
      await assertUntouched(broken);
    });
  }

  // ---------------------------------------------------------------- U2

  test('U2 up: two broken files, the bot\'s local one not valid JSON and the repository root\'s one unreadable: each is named, with its own why, under the session\'s tab', { skip: AS_ROOT }, async (t) => {
    const world = await fleet(t);
    const { box, bots } = world;
    const files = filesOf(world);
    const local = await breakFile(t, files.local, 'parse');
    const root = await breakFile(t, files.root, 'read');

    const result = await up(box, BOT, 'daily');

    await assertStartedWithoutFolder(box, result, bots, { session: 'daily' });
    await assertSaid(result.stdout, bots, { session: 'daily' }, local);
    await assertSaid(result.stdout, bots, { session: 'daily' }, root);
    await assertUntouched(local);
    await assertUntouched(root);
  });

  test('U2 up of a bot with two Claude sessions and a broken local file: the line is under each session\'s tab', async (t) => {
    const world = await fleet(t, { sessions: ['daily', 'review'] });
    const { box, bots } = world;
    const broken = await breakFile(t, filesOf(world).local, 'parse');

    const result = await up(box, BOT);

    await assertStartedWithoutFolder(box, result, bots, { session: 'daily' });
    await assertStartedWithoutFolder(box, result, bots, { session: 'review' });
    await assertSaid(result.stdout, bots, { session: 'daily' }, broken);
    await assertSaid(result.stdout, bots, { session: 'review' }, broken);
  });

  // ---------------------------------------------------------------- U3

  test('U3 restart: the bot\'s local settings file is not valid JSON: the restarted session starts, and a line under its new tab names the file and says why', async (t) => {
    const world = await fleet(t);
    const { box, bots } = world;
    await ok(box, ['up', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);
    await reported(box, bots, 'daily');
    const before = (await sessionIn(bots, BOT, 'daily')).tab;
    const broken = await breakFile(t, filesOf(world).local, 'parse');

    const result = await box.run(['restart', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);

    assert.notEqual((await sessionIn(bots, BOT, 'daily')).tab, before, 'the premise: restart opened a new tab');
    await assertStartedWithoutFolder(box, result, bots, { session: 'daily' });
    await assertSaid(result.stdout, bots, { session: 'daily' }, broken);
    await assertUntouched(broken);
  });

  test('U3 unpause: ~/.claude/settings.json cannot be read, with no profile selected: the session starts, and a line under its new tab names the file and says why', { skip: AS_ROOT }, async (t) => {
    const world = await fleet(t, { profile: false });
    const { box, bots } = world;
    await ok(box, ['up', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);
    await reported(box, bots, 'daily');
    await ok(box, ['pause', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);
    const broken = await breakFile(t, filesOf(world).user, 'read');

    const result = await box.run(['unpause', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);

    await assertStartedWithoutFolder(box, result, bots, { session: 'daily' });
    await assertSaid(result.stdout, bots, { session: 'daily' }, broken);
    await assertUntouched(broken);
  });

  test('U3 temp make: the selected profile\'s settings.json cannot be read: the temporary session starts, and a line under its tab names the file and says why', { skip: AS_ROOT }, async (t) => {
    const world = await fleet(t);
    const { box, bots } = world;
    await ok(box, ['up', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);
    const env = await inTabOf(box, bots, 'daily');
    const broken = await breakFile(t, filesOf(world).profile, 'read');

    const result = await box.run(['temp', 'make', '--bots', 'bots', '--name', 'scout', '--prompt', 'Read the pull request.'], { env });

    await assertStartedWithoutFolder(box, result, bots, { session: 'scout' });
    await assertSaid(result.stdout, bots, { session: 'scout' }, broken);
    await assertUntouched(broken);
  });

  test('U3 init: the repository root\'s settings.local.json is not valid JSON: Bot Father starts, and a line under its tab names the file and says why', async (t) => {
    const box = await createSandbox(t);
    await profileIn(box);
    await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);
    const bots = box.path('bots');
    const { tab } = await sessionIn(bots, 'bot-father', 'daily');
    await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.tabId !== tab) });
    const broken = await breakFile(t, path.join(bots, '.claude', 'settings.local.json'), 'parse');

    const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

    await assertStartedWithoutFolder(box, result, bots, { bot: 'bot-father', session: 'daily' });
    await assertSaid(result.stdout, bots, { bot: 'bot-father', session: 'daily' }, broken);
    await assertUntouched(broken);
  });

  // ---------------------------------------------------------------- U4

  test('U4 a readable local file names the folder by hand and the repository root\'s file is not valid JSON: no line for that bot; another bot in the same repository gets the line', async (t) => {
    const world = await fleet(t);
    const { box, bots, home } = world;
    await botIn(box, { name: OTHER });
    await addTo(filesOf(world).local, { [KEY]: '/somewhere/of/my/own' });
    const broken = await breakFile(t, filesOf(world).root, 'parse');

    const hand = await ok(box, ['up', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);
    const other = await up(box, OTHER, 'daily');

    await assertNotSaid(hand.stdout, bots, { session: 'daily' }, [broken.file, path.join(home, '.claude', 'settings.local.json')], 'a folder named by hand');
    await assertStartedWithoutFolder(box, other, bots, { bot: OTHER, session: 'daily' });
    await assertSaid(other.stdout, bots, { bot: OTHER, session: 'daily' }, broken);
  });

  test('U4 the selected profile\'s settings.json names the folder by hand and the bot\'s local file cannot be read: no line; before the key, the same broken file gave the line', { skip: AS_ROOT }, async (t) => {
    const world = await fleet(t, { sessions: ['control', 'daily'] });
    const { box, bots, profile } = world;
    const broken = await breakFile(t, filesOf(world).local, 'read');
    const control = await up(box, BOT, 'control');
    await assertSaid(control.stdout, bots, { session: 'control' }, broken);

    await addTo(path.join(profile.home, 'settings.json'), { [KEY]: '/somewhere/of/my/own' });
    const result = await ok(box, ['up', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);

    await assertNotSaid(result.stdout, bots, { session: 'daily' }, [broken.file], 'a folder named by hand in the profile');
  });

  test('U4 no file is broken: the kit names its own folder, and no line says why it names none', async (t) => {
    const world = await fleet(t);
    const { box, bots } = world;
    const files = Object.values(filesOf(world)).filter((file) => file !== undefined);

    const result = await ok(box, ['up', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);

    const { tab } = await sessionIn(bots, BOT, 'daily');
    const terminal = (await box.orca.terminals()).find((one) => one.tabId === tab);
    assert.ok(typedInto(terminal)[0].includes(KEY), `the premise: the kit names its own folder, got: ${typedInto(terminal)[0]}`);
    await assertNotSaid(result.stdout, bots, { session: 'daily' }, files, 'no file is broken');
    assert.ok(!result.stdout.includes('is not valid JSON') && !result.stdout.includes('cannot read'), `nothing says a file is broken, got:\n${result.stdout}`);
  });

  test('U4 with a profile selected, ~/.claude/settings.json that is not valid JSON does not count: the kit names its own folder, and no line names that file', async (t) => {
    const world = await fleet(t);
    const { box, bots } = world;
    const broken = await breakFile(t, filesOf(world).user, 'parse');

    const result = await ok(box, ['up', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);

    const { tab } = await sessionIn(bots, BOT, 'daily');
    const terminal = (await box.orca.terminals()).find((one) => one.tabId === tab);
    assert.ok(typedInto(terminal)[0].includes(KEY), `the premise: the kit names its own folder, got: ${typedInto(terminal)[0]}`);
    await assertNotSaid(result.stdout, bots, { session: 'daily' }, [broken.file], 'a user file that does not count with a profile selected');
    await assertUntouched(broken);
  });

  test('U4 a Codex session of a Claude bot, with the repository root\'s file not valid JSON: no line under its tab; the Claude session of the same bot gets one', async (t) => {
    const world = await fleet(t, { sessions: ['daily', ['coder', '--harness', 'codex']] });
    const { box, bots } = world;
    const broken = await breakFile(t, filesOf(world).root, 'parse');

    const result = await up(box, BOT);

    assert.equal(result.code, 0, `the run should go through:\n${result.stdout}${result.stderr}`);
    await assertNotSaid(result.stdout, bots, { session: 'coder' }, [broken.file], 'a Codex session');
    await assertSaid(result.stdout, bots, { session: 'daily' }, broken);
  });

  test('U4 a Codex bot with a .claude/settings.local.json that cannot be read: no line under its tab', { skip: AS_ROOT }, async (t) => {
    const world = await fleet(t);
    const { box, bots } = world;
    await botIn(box, { name: 'codex-bot', harness: 'codex' });
    const broken = await breakFile(t, path.join(botHomeOf(bots, 'codex-bot'), '.claude', 'settings.local.json'), 'read');

    const result = await ok(box, ['up', '--bots', 'bots', '--bot', 'codex-bot', '--session', 'daily']);

    await assertNotSaid(result.stdout, bots, { bot: 'codex-bot', session: 'daily' }, [broken.file], 'a Codex bot');
    await assertUntouched(broken);
  });

  test('U4 a session whose own extra_args carry --settings, with the bot\'s local file not valid JSON: no line under its tab names the file; its plain sibling gets the line', async (t) => {
    const world = await fleet(t, { sessions: ['daily', 'keeper'] });
    const { box, bots, home } = world;
    await handEdit(home, { keeper: ['--settings', '/srv/mine.json'] });
    const broken = await breakFile(t, filesOf(world).local, 'parse');

    const result = await up(box, BOT);

    assert.equal(result.code, 0, `the run should go through:\n${result.stdout}${result.stderr}`);
    const keeper = joined(await linesUnder(result.stdout, bots, BOT, 'keeper'));
    assert.ok(!keeper.includes(broken.file), `a session with its own --settings: nothing under its tab names ${broken.file}, got:\n${result.stdout}`);
    await assertSaid(result.stdout, bots, { session: 'daily' }, broken);
  });

  // ---------------------------------------------------------------- U5

  test('U5 up: the bot\'s local file names a folder by hand with a trailing comma: the line says the kit reads it again at the next start and promises no folder of the bot\'s own; once repaired, the next start names no folder of the kit\'s', async (t) => {
    const world = await fleet(t, { sessions: ['daily', 'later'] });
    const { box, bots } = world;
    const file = filesOf(world).local;
    await mkdir(path.dirname(file), { recursive: true });
    const text = '{"autoMemoryDirectory":"/x",}';
    await writeFile(file, text);
    const broken = { file, kind: 'parse', text, mode: (await stat(file)).mode & 0o777 };

    const result = await up(box, BOT, 'daily');

    await assertStartedWithoutFolder(box, result, bots, { session: 'daily' });
    const said = await assertSaid(result.stdout, bots, { session: 'daily' }, broken);
    assert.ok(said.includes(AGAIN_ONE), `one file is named, so the lines say "${AGAIN_ONE}", got:\n${result.stdout}`);
    await assertUntouched(broken);

    // The user takes the comma out: the file names a folder by hand, and the kit names none, with no line.
    await writeFile(file, '{"autoMemoryDirectory":"/x"}');
    const next = await up(box, BOT, 'later');

    await assertStartedWithoutFolder(box, next, bots, { session: 'later' });
    await assertNotSaid(next.stdout, bots, { session: 'later' }, [file], 'a repaired file that names a folder by hand');
  });

  test('U5 up: two broken files named: the lines say the kit reads it, or them, again at the next start', { skip: AS_ROOT }, async (t) => {
    const world = await fleet(t);
    const { box, bots } = world;
    const files = filesOf(world);
    const local = await breakFile(t, files.local, 'parse');
    const profile = await breakFile(t, files.profile, 'read');

    const result = await up(box, BOT, 'daily');

    await assertStartedWithoutFolder(box, result, bots, { session: 'daily' });
    await assertSaid(result.stdout, bots, { session: 'daily' }, local);
    await assertSaid(result.stdout, bots, { session: 'daily' }, profile);
  });
});
