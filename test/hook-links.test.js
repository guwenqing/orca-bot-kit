// The kit never writes outside a bot's own folder through a link the user made
// (#170; PRD 6.3's paragraph on writing, PRD 6.5, ADR 0010).
//
// The kit writes its session hook into `<bot>/.claude/settings.json` and
// `<bot>/.codex/hooks.json`, and links skills into `<bot>/.claude/skills`. A
// user can make any of those a link: the file to their own user-level settings,
// or the whole `.claude` directory to their own `~/.claude`. Writing the nominal
// path then writes the user's own settings, which is exactly what ADR 0010 says
// the kit does not do. So such a link is refused, said out loud, and left alone;
// it is never followed silently.
//
// A link that stays inside the bot folder is the user arranging their own bot,
// and is followed as it always was: that is the contrast that keeps a fix from
// refusing every link.
//
// "Outside" here is the sandbox's own HOME, which is where the real case lands.

import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  assertCleanFailure,
  botHomeOf,
  createSandbox,
  hookFileOf,
  hooksIn,
  kitHooksIn,
  orcaCallsOf,
  skipGit,
  snapshot,
  tabsOfBot,
} from './helpers/cli.js';
import { addSkills, answerOf, botYamlOf, commonSkill, entryOf } from './helpers/skills.js';

/** What a user keeps in their own settings: none of it the kit's. */
const USERS_OWN = `${JSON.stringify({ permissions: { allow: ['Bash(git status)'] }, theme: 'dark' }, null, 2)}\n`;

/** A bots folder with one bot on `harness`, one session, and a common skill on its list. Nothing up yet. */
async function withBot(box, harness = 'claude') {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', harness])).code, 0);
  assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily'])).code, 0);
  const bots = box.path('bots');
  await commonSkill(bots, 'house-style');
  await addSkills(botYamlOf(bots, 'api-bot'), 'house-style');
  return bots;
}

/** Put a file of the user's at `file`, outside every bot, and link `link` to it. */
async function linkOut(link, file, contents = USERS_OWN) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents);
  await mkdir(path.dirname(link), { recursive: true });
  await rm(link, { force: true });
  await symlink(file, link);
}

/** Replace the bot's `.claude` directory by a link to a directory of the user's outside it. */
async function claudeDirLinkedOut(box, bots) {
  const home = botHomeOf(bots, 'api-bot');
  const outside = path.join(box.home, '.claude');
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(outside, 'CLAUDE.md'), 'My own notes.\n');
  // Whatever bot create put in .claude goes aside, so the link can take its place.
  await rename(path.join(home, '.claude'), path.join(box.root, 'was-dot-claude')).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  await symlink(outside, path.join(home, '.claude'));
  return outside;
}

/** The message names the bot's own file, and says where the link goes or that it goes outside. */
function assertNamesTheLink(said, file, target) {
  assert.ok(said.includes(file), `the message should name ${file}, got: ${said}`);
  assert.ok(
    said.includes(target) || /outside/i.test(said),
    `and say where the link leads (${target}) or that it leads outside the bot folder, got: ${said}`,
  );
}

const since = async (box, from) => (await box.orca.calls()).slice(from);

// ----------------------------------------------------------------- up

test('HL1 up refuses a bot whose .claude/settings.json links outside it, and the user\'s file is untouched', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const file = hookFileOf(bots, 'api-bot', 'claude');
  const target = path.join(box.home, '.claude', 'settings.json');
  await linkOut(file, target);
  const from = (await box.orca.calls()).length;

  const result = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(await readFile(target, 'utf8'), USERS_OWN, 'the user\'s own settings, byte for byte');
  assertCleanFailure(result);
  assertNamesTheLink(result.stderr, file, target);
  assert.equal(await readlink(file), target, 'and the link is left as they made it');
  assert.deepEqual(orcaCallsOf(await since(box, from), 'terminal create'), [], 'no tab for a bot that was refused');
  assert.deepEqual(await tabsOfBot(box, bots, 'api-bot'), []);
});

test('HL1 a sibling folder whose path starts with the bot folder\'s is still outside it', async (t) => {
  // `bots/api-bot-shared` begins with the characters of `bots/api-bot`, and is
  // another folder all the same. A prefix of the path is not the folder.
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const file = hookFileOf(bots, 'api-bot', 'claude');
  const target = path.join(`${botHomeOf(bots, 'api-bot')}-shared`, 'settings.json');
  await linkOut(file, target);
  const from = (await box.orca.calls()).length;

  const result = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(await readFile(target, 'utf8'), USERS_OWN, 'the file in the sibling folder, byte for byte');
  assertCleanFailure(result);
  assertNamesTheLink(result.stderr, file, target);
  assert.deepEqual(orcaCallsOf(await since(box, from), 'terminal create'), [], 'no tab for a bot that was refused');
});

test('HL2 up refuses a bot whose .claude directory links outside it, and the outside directory gains nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const outside = await claudeDirLinkedOut(box, bots);
  const before = await snapshot(outside);
  const from = (await box.orca.calls()).length;

  const result = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  assert.deepEqual(
    await snapshot(outside),
    before,
    'no settings file, no skills directory, no skill link in the user\'s own directory',
  );
  assertCleanFailure(result);
  assertNamesTheLink(result.stderr, path.join(botHomeOf(bots, 'api-bot'), '.claude'), outside);
  assert.deepEqual(orcaCallsOf(await since(box, from), 'terminal create'), []);
});

test('HL3 up refuses a Codex bot whose .codex/hooks.json links outside it, and the user\'s file is untouched', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'codex');
  const file = hookFileOf(bots, 'api-bot', 'codex');
  const target = path.join(box.home, '.codex', 'hooks.json');
  const theirs = `${JSON.stringify({ hooks: {} }, null, 2)}\n`;
  await linkOut(file, target, theirs);
  const from = (await box.orca.calls()).length;

  const result = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(await readFile(target, 'utf8'), theirs, 'the user\'s own hooks file, byte for byte');
  assertCleanFailure(result);
  assertNamesTheLink(result.stderr, file, target);
  assert.deepEqual(orcaCallsOf(await since(box, from), 'terminal create'), []);
});

test('HL4 a link that stays inside the bot folder is followed as ever: up succeeds and the hook lands where it points', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const home = botHomeOf(bots, 'api-bot');
  const file = hookFileOf(bots, 'api-bot', 'claude');
  const shared = path.join(home, 'shared', 'settings.json');
  await mkdir(path.dirname(shared), { recursive: true });
  await writeFile(shared, USERS_OWN);
  await mkdir(path.dirname(file), { recursive: true });
  await rm(file, { force: true });
  await symlink(path.join('..', 'shared', 'settings.json'), file);

  const result = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(result.code, 0, result.stderr);
  assert.ok((await lstat(file)).isSymbolicLink(), 'the link is still a link');
  assert.equal(await readlink(file), path.join('..', 'shared', 'settings.json'));
  const written = JSON.parse(await readFile(shared, 'utf8'));
  assert.equal(kitHooksIn(written).length, 1, `the kit's hook is in the file the link points at, got: ${JSON.stringify(written)}`);
  assert.equal(written.theme, 'dark', 'beside what the user wrote');
  assert.equal((await tabsOfBot(box, bots, 'api-bot')).length, 1, 'and the bot came up');
});

test('HL7 a dangling link is judged by where the file system takes it: through a linked folder to HOME is outside', async (t) => {
  // From the review of PR #195. `.claude/settings.json` -> `../shared-settings/settings.json`
  // reads as a path inside the bot, and there is no file at the end of it yet.
  // But `shared-settings` is a link to the user's own `~/.claude`, so creating
  // that file creates it there.
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const home = botHomeOf(bots, 'api-bot');
  const file = hookFileOf(bots, 'api-bot', 'claude');
  const outside = path.join(box.home, '.claude');
  await mkdir(outside, { recursive: true });
  await symlink(outside, path.join(home, 'shared-settings'));
  await mkdir(path.dirname(file), { recursive: true });
  await rm(file, { force: true });
  await symlink(path.join('..', 'shared-settings', 'settings.json'), file);
  const from = (await box.orca.calls()).length;

  const result = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(
    await lstat(path.join(outside, 'settings.json')).then(() => true, () => false),
    false,
    'no settings.json comes into being in the user\'s own ~/.claude',
  );
  assertCleanFailure(result);
  assert.ok(result.stderr.includes(file), `the message should name ${file}, got: ${result.stderr}`);
  assert.deepEqual(orcaCallsOf(await since(box, from), 'terminal create'), [], 'no tab for a bot that was refused');
});

test('HL7 a dangling link whose target really stays inside the bot folder is followed, and the file is made there', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const home = botHomeOf(bots, 'api-bot');
  const file = hookFileOf(bots, 'api-bot', 'claude');
  const shared = path.join(home, 'shared');
  await mkdir(shared, { recursive: true });
  await mkdir(path.dirname(file), { recursive: true });
  await rm(file, { force: true });
  await symlink(path.join('..', 'shared', 'settings.json'), file);

  const result = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(await readlink(file), path.join('..', 'shared', 'settings.json'), 'the link is left as it was made');
  const written = JSON.parse(await readFile(path.join(shared, 'settings.json'), 'utf8'));
  assert.equal(kitHooksIn(written).length, 1, `the hook lands in the file the link names, got: ${JSON.stringify(written)}`);
  assert.equal((await tabsOfBot(box, bots, 'api-bot')).length, 1, 'and the bot came up');
});

// ----------------------------------------------------------------- health

test('HL5 health reports a hook file that links outside the bot as a config finding, and changes nothing', async (t) => {
  // The bot came up the ordinary way, then its settings file was made a link to
  // a user file that already holds the kit's hook — the state an older kit left
  // behind — so nothing else about the file is wrong.
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);
  assert.equal(up.code, 0, up.stderr);
  const file = hookFileOf(bots, 'api-bot', 'claude');
  assert.equal(kitHooksIn(await hooksIn(bots, 'api-bot', 'claude')).length, 1, 'up wrote the hook first');
  const target = path.join(box.home, '.claude', 'settings.json');
  await linkOut(file, target, await readFile(file, 'utf8'));
  const outsideBefore = await readFile(target, 'utf8');
  const before = await snapshot(bots, skipGit);

  const result = await box.run(['health', '--bots', 'bots', '--bot', 'api-bot', '--json']);

  assert.equal(result.code, 1, `a finding ends health in 1, got:\n${result.stdout}${result.stderr}`);
  const found = JSON.parse(result.stdout).found.filter((one) => one.kind === 'config' && one.bot === 'api-bot');
  const naming = found.filter((one) => `${one.where} ${one.says}`.includes(file));
  assert.equal(naming.length, 1, `one config finding names ${file}, got: ${JSON.stringify(found, null, 2)}`);
  assertNamesTheLink(`${naming[0].where} ${naming[0].says}`, file, target);
  assert.equal(await readFile(target, 'utf8'), outsideBefore, 'health writes nothing through the link');
  assert.deepEqual(await snapshot(bots, skipGit), before, 'and nothing in the bots folder');
});

// ----------------------------------------------------------------- skills build

test('HL6 skills build links nothing through a .claude directory that leads outside the bot, and says so', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const outside = await claudeDirLinkedOut(box, bots);
  const before = await snapshot(outside);

  const result = await box.run(['skills', 'build', '--bots', 'bots', '--bot', 'api-bot', '--json']);

  assert.deepEqual(await snapshot(outside), before, 'the user\'s own directory gains no skills directory and no links');
  assert.equal(result.code, 1, `trouble with a bot ends the run in 1, got:\n${result.stdout}${result.stderr}`);
  const entry = entryOf(answerOf(result), 'api-bot');
  assert.equal(typeof entry.trouble, 'string', `the bot's entry should say what is wrong, got: ${JSON.stringify(entry)}`);
  assertNamesTheLink(entry.trouble, path.join(botHomeOf(bots, 'api-bot'), '.claude'), outside);
});
