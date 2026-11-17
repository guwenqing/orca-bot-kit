// `obk health` says when the kit names no memory folder for a bot's Claude
// Code sessions only because a settings file could not be read or is not valid
// JSON (#782).
//
// The kit names the bot's own memory folder on a Claude launch line. It names
// none when a settings file where a user can name a folder by hand has an
// `autoMemoryDirectory` key, and also when such a file is there but cannot be
// read, or is not valid JSON. The sessions then start on Claude Code's own
// default folder, which the bots of one repository share. That stays. What is
// new: health gives a finding for the bot.
//
// The settings files, where a broken one does not stop the start:
//
//   local    the bot's .claude/settings.local.json
//   root     the repository root's .claude/settings.local.json (the bots folder)
//   profile  the selected Orca profile's settings.json
//   user     ~/.claude/settings.json, with no profile selected
//
// The bot's own .claude/settings.json is not a case here: a broken one stops
// the start, and health already has findings of its own for it.
//
// What is held here:
//
//   HU1  one broken file: a finding for the bot names the file's full path,
//        says `cannot read` and the error code (a read error) or `is not valid
//        JSON` (a parse error), and says `the folder that the bots shared`.
//        Health only reads the file: its bytes and its mode stay
//   HU2  two broken files: each one is named
//   HU3  no such finding: a readable file names the folder by hand (another
//        file broken), no file is broken, a Codex bot, a bot whose every Claude
//        session carries its own `--settings`
//
// A finding is read from `obk health --json`: `found` is a list of
// `{ kind, bot, where, says }`. These tests hold the bot, the path and the
// words above, not other wording, not the kind, and not the number of
// findings. Every run is in a sandbox (helpers/cli.js): its own HOME and a
// fake Orca. No notes are put in the folder that the bots shared, so the
// finding about those notes (test/health-memory-folder.test.js) does not come.

import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { parse, stringify } from 'yaml';

import { botHomeOf, createSandbox } from './helpers/cli.js';

const BOT = 'api-bot';
const OTHER = 'web-bot';
const KEY = 'autoMemoryDirectory';
const SHARED = 'the folder that the bots shared';
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
async function ok(box, args) {
  const result = await box.run(args);
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

/** A sandbox with a bots repo (init brings up Bot Father) and api-bot with the sessions named. With `profile`, a selected Orca profile. */
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

const NOT_JSON = '{"a":1,}';
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

/** Health only read the file: its mode and its bytes are as they were. */
async function assertUntouched(broken) {
  const mode = (await stat(broken.file)).mode & 0o777;
  assert.equal(mode, broken.mode, `the mode of ${broken.file} stays ${broken.mode.toString(8)}, got ${mode.toString(8)}`);
  if (broken.kind === 'read') await chmod(broken.file, 0o644);
  assert.equal(await readFile(broken.file, 'utf8'), broken.text, `the bytes of ${broken.file} stay as they were`);
  if (broken.kind === 'read') await chmod(broken.file, 0o000);
}

/** Run the health check for JSON: findings, and exit 1 when there are any, 0 when none. */
async function found(box) {
  const result = await box.run(['health', '--bots', 'bots', '--json']);
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

/** The finding is for `bot`: its `bot` is that bot, or it names the bot outside the paths it names. */
const isFor = (one, bot, paths) => one.bot === bot || paths.reduce((text, each) => text.replaceAll(each, ''), textOf(one)).includes(bot);

const saysKind = (text, kind) => (kind === 'parse' ? text.includes('is not valid JSON') : text.includes('cannot read') && text.includes('EACCES'));
const kindWords = (kind) => (kind === 'parse' ? '"is not valid JSON"' : '"cannot read" and "EACCES"');

/** A finding for `bot` names the file's full path, says the kind of breakage, and says the folder that the bots shared. */
function assertFinding(findings, bot, broken) {
  const naming = findings.filter((one) => textOf(one).includes(broken.file) && isFor(one, bot, [broken.file]));
  assert.ok(naming.length > 0, `a finding for ${bot} should name ${broken.file}, got: ${show(findings)}`);
  assert.ok(
    naming.some((one) => saysKind(textOf(one), broken.kind) && textOf(one).includes(SHARED)),
    `the finding for ${bot} that names ${broken.file} should say ${kindWords(broken.kind)} and "${SHARED}", got: ${show(naming)}`,
  );
}

/** No finding for `bot` names any of `files`, or says the folder that the bots shared. */
function assertNoFinding(findings, bot, files, why) {
  const said = findings.filter((one) => isFor(one, bot, files) && (files.some((file) => textOf(one).includes(file)) || textOf(one).includes(SHARED)));
  assert.deepEqual(said, [], `${why}: no finding for ${bot} should name ${files.join(', ')} or say "${SHARED}", got: ${show(said)}`);
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

describe('obk health says when a settings file that cannot be read or is not valid JSON keeps the kit from naming a bot\'s memory folder (#782)', { concurrency: 8 }, () => {
  // ---------------------------------------------------------------- HU1

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
    test(`HU1 the ${where} settings file ${label}${setting}: a finding for the bot names the file, says why and says the folder that the bots shared; the file is as it was`, { skip: kind === 'read' ? AS_ROOT : undefined }, async (t) => {
      const world = await fleet(t, { profile });
      const broken = await breakFile(t, filesOf(world)[where], kind);

      const findings = await found(world.box);

      assertFinding(findings, BOT, broken);
      await assertUntouched(broken);
    });
  }

  test('HU1 the repository root\'s file is not valid JSON: every Claude bot of the repository gets the finding, Bot Father too', async (t) => {
    const world = await fleet(t);
    const broken = await breakFile(t, filesOf(world).root, 'parse');

    const findings = await found(world.box);

    assertFinding(findings, BOT, broken);
    assertFinding(findings, 'bot-father', broken);
  });

  // ---------------------------------------------------------------- HU2

  test('HU2 two broken files, the bot\'s local one unreadable and the selected profile\'s one not valid JSON: each is named, with its own why', { skip: AS_ROOT }, async (t) => {
    const world = await fleet(t);
    const files = filesOf(world);
    const local = await breakFile(t, files.local, 'read');
    const profile = await breakFile(t, files.profile, 'parse');

    const findings = await found(world.box);

    assertFinding(findings, BOT, local);
    assertFinding(findings, BOT, profile);
    await assertUntouched(local);
    await assertUntouched(profile);
  });

  // ---------------------------------------------------------------- HU3

  test('HU3 a readable local file names the folder by hand and the repository root\'s file is not valid JSON: no finding for that bot; Bot Father gets one', async (t) => {
    const world = await fleet(t);
    await addTo(filesOf(world).local, { [KEY]: '/somewhere/of/my/own' });
    const broken = await breakFile(t, filesOf(world).root, 'parse');

    const findings = await found(world.box);

    assertNoFinding(findings, BOT, [broken.file], 'a folder named by hand');
    assertFinding(findings, 'bot-father', broken);
  });

  test('HU3 the selected profile\'s settings.json names the folder by hand and the bot\'s local file cannot be read: no finding names the local file; before the key, the same file gave one', { skip: AS_ROOT }, async (t) => {
    const world = await fleet(t);
    const broken = await breakFile(t, filesOf(world).local, 'read');
    assertFinding(await found(world.box), BOT, broken);

    await addTo(filesOf(world).profile, { [KEY]: '/somewhere/of/my/own' });

    assertNoFinding(await found(world.box), BOT, [broken.file], 'a folder named by hand in the profile');
  });

  test('HU3 no file is broken: no finding names a settings file or says the folder that the bots shared', async (t) => {
    const world = await fleet(t);
    const files = Object.values(filesOf(world)).filter((file) => file !== undefined);

    const findings = await found(world.box);

    assertNoFinding(findings, BOT, files, 'no file is broken');
    assertNoFinding(findings, 'bot-father', files, 'no file is broken');
  });

  test('HU3 with a profile selected, ~/.claude/settings.json that is not valid JSON does not count: no finding names it', async (t) => {
    const world = await fleet(t);
    const broken = await breakFile(t, filesOf(world).user, 'parse');

    const findings = await found(world.box);

    assertNoFinding(findings, BOT, [broken.file], 'a user file that does not count with a profile selected');
    await assertUntouched(broken);
  });

  test('HU3 a Codex bot with a .claude/settings.local.json that is not valid JSON: no finding for it; a Claude bot with the same file gets one', async (t) => {
    const world = await fleet(t);
    const { box, bots } = world;
    await botIn(box, { name: 'codex-bot', harness: 'codex' });
    const codex = await breakFile(t, path.join(botHomeOf(bots, 'codex-bot'), '.claude', 'settings.local.json'), 'parse');
    const claude = await breakFile(t, filesOf(world).local, 'parse');

    const findings = await found(box);

    assert.deepEqual(findings.filter((one) => textOf(one).includes(codex.file)), [], `a Codex bot: no finding names ${codex.file}, got: ${show(findings)}`);
    assertNoFinding(findings, 'codex-bot', [codex.file], 'a Codex bot');
    assertFinding(findings, BOT, claude);
  });

  test('HU3 a Codex bot, with the repository root\'s file unreadable: no finding for it; the Claude bot beside it gets one', { skip: AS_ROOT }, async (t) => {
    const world = await fleet(t);
    await botIn(world.box, { name: 'codex-bot', harness: 'codex' });
    const broken = await breakFile(t, filesOf(world).root, 'read');

    const findings = await found(world.box);

    assertNoFinding(findings, 'codex-bot', [broken.file], 'a Codex bot');
    assertFinding(findings, BOT, broken);
  });

  test('HU3 every Claude session of a bot carries its own --settings, and its local file is not valid JSON: no finding for it; another bot with the same file gets one', async (t) => {
    const world = await fleet(t, { sessions: ['daily', 'other'] });
    const { box, bots, home } = world;
    await botIn(box, { name: OTHER });
    await handEdit(home, { daily: ['--settings', '/srv/mine.json'], other: '--settings=/srv/mine.json' });
    const own = await breakFile(t, filesOf(world).local, 'parse');
    const beside = await breakFile(t, path.join(botHomeOf(bots, OTHER), '.claude', 'settings.local.json'), 'parse');

    const findings = await found(box);

    assert.deepEqual(findings.filter((one) => textOf(one).includes(own.file)), [], `no finding names ${own.file}, got: ${show(findings)}`);
    assertFinding(findings, OTHER, beside);
  });
});
