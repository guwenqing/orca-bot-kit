// The kit never writes outside a bot's own folder through a link the user made,
// for the two files it manages in every bot folder (#569; the same promise as
// #170 for the hook files, PRD 6.3's paragraph on writing, ADR 0022).
//
// `bots/<bot>/AGENTS.md` is written by `rules build` (and `bot change`, which
// rebuilds it). `bots/<bot>/bot.yaml` is written by `session add`, `session
// change`, `bot change`, `skills add`, `skills remove`, `permission allow`, and
// by `init` when it completes an old Bot Father bot.yaml. A user can make
// either name a link to a file of their own outside the bot folder. Writing the
// nominal path then changes the user's own file, so such a link is refused,
// said out loud, and left alone. Reading through it may still happen; only the
// write must not.
//
// A link that stays inside the bot folder is the user arranging their own bot
// (real fleets have CLAUDE.md -> AGENTS.md today), and is followed as before:
// that is the contrast that keeps a fix from refusing every link. "Inside" is
// judged by real paths, so a bots folder reached through a link of its own
// behaves the same as one reached directly.
//
// "Outside" here is the sandbox's own HOME, or a sibling folder whose path
// starts with the bot folder's. Nothing here touches the real home.

import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import { botHomeOf, bookOf, createSandbox, hookFileOf, skipGit, snapshot } from './helpers/cli.js';
import { agentsIn, agentsOf, hasBlock } from './helpers/rules.js';
import { botYamlOf } from './helpers/skills.js';

/** What a user keeps in a notes file of their own: no block of the kit's in it. */
const USERS_NOTES = '# My own notes\n\nNothing of the kit\'s belongs in here.\n';

/** `bot.yaml` exactly as the slice before init completed it wrote it: no harness, no sessions (from init-completes-bot-yaml). */
const PREVIOUS_SLICE = `# Bot Father runs the fleet. Ask it for changes rather than editing this file.

name: bot-father
charter: |
  Bot Father owns the fleet.
rules: []
skills: []
sessions: []
`;

/** `init`, then one Claude bot per name, each made by `bot create` with its own charter. */
async function withBots(box, names, bots = 'bots') {
  const made = await box.run(['init', '--bots', bots, '--harness', 'claude']);
  assert.equal(made.code, 0, made.stderr);
  for (const name of names) {
    const created = await box.run([
      'bot', 'create', '--bots', bots, '--name', name, '--harness', 'claude', '--charter', `${name} owns its corner.`,
    ]);
    assert.equal(created.code, 0, created.stderr);
  }
  return box.path(bots);
}

/**
 * A bots folder reached through a link: the real folder is elsewhere under the
 * sandbox root, and `linked-bots` in the working directory leads to it.
 */
async function linkedBotsFolder(box) {
  const real = path.join(box.root, 'elsewhere', 'real-bots');
  await mkdir(real, { recursive: true });
  await symlink(real, box.path('linked-bots'));
  return real;
}

/** Put `contents` at `target` (making its folder), and make `link` a link to it in place of whatever was there. */
async function linkTo(link, target, linkText, contents) {
  if (contents !== undefined) {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
  await rm(link, { force: true });
  await symlink(linkText ?? target, link);
}

/** Move the bot's own bot.yaml to `target` and leave a link to it in its place. Returns the bytes it held. */
async function moveBotYamlBehindLink(bots, bot, target, linkText) {
  const file = botYamlOf(bots, bot);
  const bytes = await readFile(file, 'utf8');
  await mkdir(path.dirname(target), { recursive: true });
  await rename(file, target);
  await symlink(linkText ?? target, file);
  return bytes;
}

/** The bot's own Claude settings file, as the messages here name it. */
const HOOK_FILE = '.claude/settings.json';

const exists = (file) => lstat(file).then(() => true, () => false);

/** A refused write: the command exits non-zero with something said, and does not crash. */
function assertRefusedWrite(result) {
  const said = result.stdout + result.stderr;
  assert.notEqual(result.code, 0, `this write should have been refused, got exit 0:\n${said}`);
  assert.notEqual(said.trim(), '', 'a refusal with nothing said is no use to anybody');
  assert.ok(!/^\s+at /m.test(said), `expected a message, got a crash:\n${said}`);
}

/**
 * The output names the bot's own file (by any of `spellings`: the absolute
 * path, the path from the working directory, or through the real folder) and
 * says where the link leads or that it leads outside the bot folder.
 */
function assertNamesTheLink(result, spellings, target) {
  const said = result.stdout + result.stderr;
  assert.ok(
    spellings.some((spelling) => said.includes(spelling)),
    `the message should name the bot's own file (${spellings.join(' or ')}), got:\n${said}`,
  );
  assert.ok(
    said.includes(target) || /outside/i.test(said),
    `and say where the link leads (${target}) or that it leads outside the bot folder, got:\n${said}`,
  );
}

/** The ways an output may spell a file under the sandbox's working directory. */
const spellingsOf = (box, file) => [file, path.relative(box.cwd, file)];

/** The names of the sessions in a bot.yaml text. */
const sessionNames = (text) => (parse(text).sessions ?? []).map((session) => (
  typeof session === 'string' ? session : session?.name
));

// ----------------------------------------------------------------- AGENTS.md (rules build)

test('C1 rules build refuses an AGENTS.md that links to a file outside the bot, and still builds the other bot', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBots(box, ['api-bot', 'web-bot']);
  const file = agentsOf(bots, 'api-bot');
  const target = path.join(box.home, 'notes', 'AGENTS.md');
  await linkTo(file, target, undefined, USERS_NOTES);
  // The other bot's file has no block of the kit's, so a build of it is visible.
  await writeFile(agentsOf(bots, 'web-bot'), 'Web Bot notes.\n');

  const result = await box.run(['rules', 'build', '--bots', 'bots']);

  assert.equal(await readFile(target, 'utf8'), USERS_NOTES, 'the user\'s own file, byte for byte');
  assert.ok((await lstat(file)).isSymbolicLink(), 'the link is still a link');
  assert.equal(await readlink(file), target, 'and still leads where the user made it lead');
  assertRefusedWrite(result);
  assertNamesTheLink(result, spellingsOf(box, file), target);
  const web = await agentsIn(bots, 'web-bot');
  assert.ok(hasBlock(web), `the other bot is still built in the same run, got:\n${web}`);
  assert.ok(web.includes('Web Bot notes.'), 'beside what was in its file');
});

test('C1 a sibling folder whose path starts with the bot folder\'s is still outside it', async (t) => {
  // `bots/api-bot-shared` begins with the characters of `bots/api-bot`, and is
  // another folder all the same.
  const box = await createSandbox(t);
  const bots = await withBots(box, ['api-bot']);
  const file = agentsOf(bots, 'api-bot');
  const target = path.join(`${botHomeOf(bots, 'api-bot')}-shared`, 'AGENTS.md');
  await linkTo(file, target, undefined, USERS_NOTES);

  const result = await box.run(['rules', 'build', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(await readFile(target, 'utf8'), USERS_NOTES, 'the file in the sibling folder, byte for byte');
  assert.equal(await readlink(file), target, 'the link is left as it was made');
  assertRefusedWrite(result);
  assertNamesTheLink(result, spellingsOf(box, file), target);
});

test('C2 rules build does not create the missing target of a dangling AGENTS.md link that leads outside the bot', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBots(box, ['api-bot', 'web-bot']);
  const file = agentsOf(bots, 'api-bot');
  // The folder is there, so a write through the link would succeed in making the file.
  await mkdir(path.join(box.home, 'notes'), { recursive: true });
  const target = path.join(box.home, 'notes', 'AGENTS.md');
  await linkTo(file, target);
  await writeFile(agentsOf(bots, 'web-bot'), 'Web Bot notes.\n');

  const result = await box.run(['rules', 'build', '--bots', 'bots']);

  assert.equal(await exists(target), false, 'no AGENTS.md comes into being in the user\'s own folder');
  assert.equal(await readlink(file), target, 'the link is left as it was made');
  assertRefusedWrite(result);
  assertNamesTheLink(result, spellingsOf(box, file), target);
  assert.ok(hasBlock(await agentsIn(bots, 'web-bot')), 'the other bot is still built in the same run');
});

test('C3 an AGENTS.md that links to a file inside the same bot folder is built where it points', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBots(box, ['api-bot']);
  const file = agentsOf(bots, 'api-bot');
  const inside = path.join(botHomeOf(bots, 'api-bot'), 'shared', 'AGENTS.md');
  await linkTo(file, inside, path.join('shared', 'AGENTS.md'), USERS_NOTES);

  const result = await box.run(['rules', 'build', '--bots', 'bots']);

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const written = await readFile(inside, 'utf8');
  assert.ok(hasBlock(written), `the kit's rules block lands in the file the link points at, got:\n${written}`);
  assert.ok(written.includes('Nothing of the kit\'s belongs in here.'), 'beside what the user wrote');
  assert.ok((await lstat(file)).isSymbolicLink(), 'the link is still a link');
  assert.equal(await readlink(file), path.join('shared', 'AGENTS.md'));
});

// ----------------------------------------------------------------- bot.yaml

test('C4 session add refuses a bot.yaml that links to a file outside the bot, and the user\'s file is unchanged', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBots(box, ['api-bot']);
  const file = botYamlOf(bots, 'api-bot');
  const target = path.join(box.home, 'fleet-config', 'api-bot.yaml');
  const bytes = await moveBotYamlBehindLink(bots, 'api-bot', target);

  const result = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'review']);

  assert.equal(await readFile(target, 'utf8'), bytes, 'the user\'s own file, byte for byte');
  assert.equal(await readlink(file), target, 'the link is left as it was made');
  assertRefusedWrite(result);
  assertNamesTheLink(result, spellingsOf(box, file), target);
});

test('C5 session add through a bot.yaml that links inside the same bot folder adds the session where it points', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBots(box, ['api-bot']);
  const file = botYamlOf(bots, 'api-bot');
  const inside = path.join(botHomeOf(bots, 'api-bot'), 'config', 'bot.yaml');
  await moveBotYamlBehindLink(bots, 'api-bot', inside, path.join('config', 'bot.yaml'));

  const result = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'review']);

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual(sessionNames(await readFile(inside, 'utf8')), ['review'], 'the new session is in the file the link points at');
  assert.ok((await lstat(file)).isSymbolicLink(), 'the link is still a link');
  assert.equal(await readlink(file), path.join('config', 'bot.yaml'));
});

/**
 * Every other command that writes bot.yaml. Each row runs the command twice in
 * one folder: once for `in-bot`, whose bot.yaml links inside its own folder and
 * must take the change, and once for `out-bot`, whose bot.yaml links outside
 * and must be refused. `wrote` says, from the bot.yaml text, whether the
 * command's change is in it.
 */
const WRITERS = [
  {
    command: 'bot change --charter',
    args: (bot) => ['bot', 'change', '--bots', 'bots', '--bot', bot, '--charter', 'A new charter, from the user.'],
    wrote: (text) => parse(text).charter.trim() === 'A new charter, from the user.',
  },
  {
    command: 'session change',
    args: (bot) => ['session', 'change', '--bots', 'bots', '--bot', bot, '--session', 'daily', '--effort', 'low'],
    wrote: (text) => parse(text).sessions.find((session) => session.name === 'daily')?.effort === 'low',
  },
  {
    command: 'skills add',
    args: (bot) => ['skills', 'add', '--bots', 'bots', '--bot', bot, '--skill', 'kit:obk-reviewing'],
    wrote: (text) => (parse(text).skills ?? []).includes('kit:obk-reviewing'),
  },
  {
    command: 'skills remove',
    args: (bot) => ['skills', 'remove', '--bots', 'bots', '--bot', bot, '--skill', 'kit:obk-tdd'],
    wrote: (text) => !(parse(text).skills ?? []).includes('kit:obk-tdd'),
  },
  {
    command: 'permission allow',
    args: (bot) => ['permission', 'allow', '--bots', 'bots', '--bot', bot, '--rule', 'Bash(make lint)'],
    wrote: (text) => (parse(text).allow ?? []).includes('Bash(make lint)'),
  },
];

for (const row of WRITERS) {
  test(`C4 ${row.command} refuses a bot.yaml that links outside the bot, and writes through one that links inside`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBots(box, ['in-bot', 'out-bot']);
    for (const bot of ['in-bot', 'out-bot']) {
      const session = await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', 'daily']);
      assert.equal(session.code, 0, session.stderr);
      const skill = await box.run(['skills', 'add', '--bots', 'bots', '--bot', bot, '--skill', 'kit:obk-tdd']);
      assert.equal(skill.code, 0, skill.stderr);
    }
    const inside = path.join(botHomeOf(bots, 'in-bot'), 'config', 'bot.yaml');
    const insideBefore = await moveBotYamlBehindLink(bots, 'in-bot', inside, path.join('config', 'bot.yaml'));
    assert.equal(row.wrote(insideBefore), false, `the premise: in-bot does not have the change yet:\n${insideBefore}`);
    const outFile = botYamlOf(bots, 'out-bot');
    const target = path.join(box.home, 'fleet-config', 'out-bot.yaml');
    const bytes = await moveBotYamlBehindLink(bots, 'out-bot', target);
    assert.equal(row.wrote(bytes), false, `the premise: out-bot does not have the change yet:\n${bytes}`);

    const followed = await box.run(row.args('in-bot'));
    const refused = await box.run(row.args('out-bot'));

    // The contrast: a link that stays inside takes the change.
    assert.equal(followed.code, 0, `${row.command} for in-bot:\n${followed.stdout}${followed.stderr}`);
    const insideAfter = await readFile(inside, 'utf8');
    assert.equal(row.wrote(insideAfter), true, `the change lands in the file in-bot's link points at, got:\n${insideAfter}`);
    assert.equal(await readlink(botYamlOf(bots, 'in-bot')), path.join('config', 'bot.yaml'), 'and that link is still a link');

    // The refusal: a link that leads outside is left alone.
    assert.equal(await readFile(target, 'utf8'), bytes, 'the user\'s own file, byte for byte');
    assert.equal(await readlink(outFile), target, 'the link is left as it was made');
    assertRefusedWrite(refused);
    assertNamesTheLink(refused, spellingsOf(box, outFile), target);
  });
}

test('C4 permission allow refused for a bot.yaml that links outside writes nothing first: the bot\'s Claude settings stay as they were', async (t) => {
  // A refusal refuses the whole command, not only its bot.yaml write.
  // `permission allow` also writes the rule into the bot's own
  // `.claude/settings.json`; a refusal that came only at the bot.yaml write
  // would leave that half of the change behind.
  const box = await createSandbox(t);
  const bots = await withBots(box, ['in-bot', 'out-bot']);
  for (const bot of ['in-bot', 'out-bot']) {
    const session = await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', 'daily']);
    assert.equal(session.code, 0, session.stderr);
  }
  const rule = 'Bash(npm test)';
  const settingsState = (bot) => readFile(hookFileOf(bots, bot, 'claude'), 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return 'absent';
    throw error;
  });
  const allowedBy = async (bot) => {
    const state = await settingsState(bot);
    return state === 'absent' ? [] : JSON.parse(state)?.permissions?.allow ?? [];
  };
  await moveBotYamlBehindLink(bots, 'in-bot', path.join(botHomeOf(bots, 'in-bot'), 'config', 'bot.yaml'), path.join('config', 'bot.yaml'));
  const target = path.join(box.home, 'fleet-config', 'out-bot.yaml');
  const bytes = await moveBotYamlBehindLink(bots, 'out-bot', target);
  assert.equal((await allowedBy('in-bot')).includes(rule), false, 'the premise: in-bot\'s settings do not allow the rule yet');
  const settingsBefore = await settingsState('out-bot');
  assert.equal((await allowedBy('out-bot')).includes(rule), false, 'the premise: out-bot\'s settings do not allow the rule yet');

  const followed = await box.run(['permission', 'allow', '--bots', 'bots', '--bot', 'in-bot', '--rule', rule]);
  const refused = await box.run(['permission', 'allow', '--bots', 'bots', '--bot', 'out-bot', '--rule', rule]);

  // The contrast: through a link that stays inside, the rule reaches the settings.
  assert.equal(followed.code, 0, followed.stdout + followed.stderr);
  assert.ok((await allowedBy('in-bot')).includes(rule), `in-bot's ${HOOK_FILE} should allow ${rule} now`);

  // The refusal: out-bot's settings are as they were, byte for byte (or still absent).
  assertRefusedWrite(refused);
  assert.equal(await settingsState('out-bot'), settingsBefore, `out-bot's ${HOOK_FILE} is left as it was`);
  assert.equal(await readFile(target, 'utf8'), bytes, 'and the user\'s own bot.yaml, byte for byte');
});

// ----------------------------------------------------------------- a bots folder reached through a link

test('C6 through a linked bots folder, rules build builds a plain AGENTS.md and one that links inside the bot', async (t) => {
  const box = await createSandbox(t);
  const real = await linkedBotsFolder(box);
  await withBots(box, ['api-bot', 'web-bot'], 'linked-bots');
  const bots = box.path('linked-bots');
  const inside = path.join(real, 'bots', 'api-bot', 'shared', 'AGENTS.md');
  await linkTo(agentsOf(bots, 'api-bot'), inside, path.join('shared', 'AGENTS.md'), USERS_NOTES);
  await writeFile(agentsOf(bots, 'web-bot'), 'Web Bot notes.\n');

  const result = await box.run(['rules', 'build', '--bots', 'linked-bots']);

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const written = await readFile(inside, 'utf8');
  assert.ok(hasBlock(written), `the inside link's target is built, got:\n${written}`);
  assert.ok(hasBlock(await readFile(path.join(real, 'bots', 'web-bot', 'AGENTS.md'), 'utf8')), 'and the plain file is built');
  assert.equal(await readlink(path.join(real, 'bots', 'api-bot', 'AGENTS.md')), path.join('shared', 'AGENTS.md'));
});

test('C6 through a linked bots folder, session add writes a plain bot.yaml and one that links inside the bot', async (t) => {
  const box = await createSandbox(t);
  const real = await linkedBotsFolder(box);
  await withBots(box, ['api-bot', 'web-bot'], 'linked-bots');
  const bots = box.path('linked-bots');
  const inside = path.join(real, 'bots', 'web-bot', 'config', 'bot.yaml');
  await moveBotYamlBehindLink(bots, 'web-bot', inside, path.join('config', 'bot.yaml'));

  const plain = await box.run(['session', 'add', '--bots', 'linked-bots', '--bot', 'api-bot', '--name', 'review']);
  const linked = await box.run(['session', 'add', '--bots', 'linked-bots', '--bot', 'web-bot', '--name', 'review']);

  assert.equal(plain.code, 0, plain.stdout + plain.stderr);
  assert.deepEqual(sessionNames(await readFile(path.join(real, 'bots', 'api-bot', 'bot.yaml'), 'utf8')), ['review']);
  assert.equal(linked.code, 0, linked.stdout + linked.stderr);
  assert.deepEqual(sessionNames(await readFile(inside, 'utf8')), ['review'], 'the session is in the file the link points at');
  assert.equal(await readlink(path.join(real, 'bots', 'web-bot', 'bot.yaml')), path.join('config', 'bot.yaml'));
});

test('C6 through a linked bots folder, links that lead outside a bot are still refused', async (t) => {
  const box = await createSandbox(t);
  const real = await linkedBotsFolder(box);
  await withBots(box, ['api-bot', 'web-bot', 'ops-bot'], 'linked-bots');
  const bots = box.path('linked-bots');
  const agents = agentsOf(bots, 'api-bot');
  const agentsTarget = path.join(box.home, 'notes', 'AGENTS.md');
  await linkTo(agents, agentsTarget, undefined, USERS_NOTES);
  await writeFile(agentsOf(bots, 'web-bot'), 'Web Bot notes.\n');
  const yaml = botYamlOf(bots, 'ops-bot');
  const yamlTarget = path.join(box.home, 'fleet-config', 'ops-bot.yaml');
  const bytes = await moveBotYamlBehindLink(bots, 'ops-bot', yamlTarget);
  const realSpellings = (file) => [...spellingsOf(box, file), path.join(real, path.relative(bots, file))];

  const built = await box.run(['rules', 'build', '--bots', 'linked-bots']);
  const added = await box.run(['session', 'add', '--bots', 'linked-bots', '--bot', 'ops-bot', '--name', 'review']);

  assert.equal(await readFile(agentsTarget, 'utf8'), USERS_NOTES, 'the user\'s own AGENTS.md target, byte for byte');
  assertRefusedWrite(built);
  assertNamesTheLink(built, realSpellings(agents), agentsTarget);
  assert.ok(hasBlock(await readFile(path.join(real, 'bots', 'web-bot', 'AGENTS.md'), 'utf8')), 'the plain bot is built in the same run');

  assert.equal(await readFile(yamlTarget, 'utf8'), bytes, 'the user\'s own bot.yaml target, byte for byte');
  assert.equal(await readlink(path.join(real, 'bots', 'ops-bot', 'bot.yaml')), yamlTarget, 'the link is left as it was made');
  assertRefusedWrite(added);
  assertNamesTheLink(added, realSpellings(yaml), yamlTarget);
});

// ----------------------------------------------------------------- init completing Bot Father's bot.yaml

/**
 * A bots folder as the slice before init completed it left it (see init-completes-bot-yaml):
 * Bot Father's bot.yaml has no harness and no sessions, there is no book, and
 * nothing of it is in Orca. Here that bot.yaml is a link to `target`, made
 * with `linkText`.
 */
async function previousSliceBehindLink(box, target, linkText) {
  const bots = await withBots(box, []);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, PREVIOUS_SLICE);
  const file = botYamlOf(bots, 'bot-father');
  await rm(file);
  await symlink(linkText ?? target, file);
  await rm(bookOf(bots));
  await box.orca.set({ setups: [], terminals: [] });
  return file;
}

test('C7 init does not complete a Bot Father bot.yaml that links to a file outside the bot', async (t) => {
  const box = await createSandbox(t);
  const target = path.join(box.home, 'fleet-config', 'bot-father.yaml');
  const file = await previousSliceBehindLink(box, target);

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assert.equal(await readFile(target, 'utf8'), PREVIOUS_SLICE, 'the user\'s own file, byte for byte');
  assert.equal(await readlink(file), target, 'the link is left as it was made');
  assertRefusedWrite(result);
  assertNamesTheLink(result, spellingsOf(box, file), target);
});

test('C7 init completes a Bot Father bot.yaml that links to a file inside the bot folder, where it points', async (t) => {
  const box = await createSandbox(t);
  const inside = box.path('bots', 'bots', 'bot-father', 'config', 'bot.yaml');
  const file = await previousSliceBehindLink(box, inside, path.join('config', 'bot.yaml'));

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const after = await readFile(inside, 'utf8');
  assert.equal(parse(after).harness, 'claude', `the harness is written into the file the link points at, got:\n${after}`);
  assert.deepEqual(sessionNames(after), ['daily']);
  assert.equal(await readlink(file), path.join('config', 'bot.yaml'), 'and the link is still a link');
});

test('C7 init that refuses an outside-linked Bot Father bot.yaml writes nothing at all: not even a missing defaults.yaml', async (t) => {
  // A refusal refuses the whole run, not only the bot.yaml write: the seed
  // files init would put back are not put back either.
  const box = await createSandbox(t);
  const target = path.join(box.home, 'fleet-config', 'bot-father.yaml');
  await previousSliceBehindLink(box, target);
  const bots = box.path('bots');
  await rm(path.join(bots, 'defaults.yaml'));
  const before = await snapshot(bots, skipGit);

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assertRefusedWrite(result);
  assert.equal(await exists(path.join(bots, 'defaults.yaml')), false, 'no defaults.yaml comes back from a refused init');
  assert.deepEqual(await snapshot(bots, skipGit), before, 'and nothing else in the bots folder changes');
  assert.equal(await readFile(target, 'utf8'), PREVIOUS_SLICE, 'the user\'s own file, byte for byte');
});

test('C7 init that completes an inside-linked Bot Father bot.yaml also puts a missing defaults.yaml back', async (t) => {
  const box = await createSandbox(t);
  const inside = box.path('bots', 'bots', 'bot-father', 'config', 'bot.yaml');
  await previousSliceBehindLink(box, inside, path.join('config', 'bot.yaml'));
  const bots = box.path('bots');
  await rm(path.join(bots, 'defaults.yaml'));

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(parse(await readFile(inside, 'utf8')).harness, 'claude', 'the bot.yaml the link points at is completed');
  assert.equal(await exists(path.join(bots, 'defaults.yaml')), true, 'and defaults.yaml is back');
});

// ----------------------------------------------------------------- where the write really lands

test('C2 a link whose text reads as inside but goes through a linked folder with .. lands outside, and is refused', async (t) => {
  // `hop` leads to <home>/notes/child. `AGENTS.md` -> `hop/../new-agents.md`
  // reads as <bot>/new-agents.md, but the file system takes `hop/..` to the
  // parent of where hop really points: <home>/notes/new-agents.md.
  const box = await createSandbox(t);
  const bots = await withBots(box, ['api-bot']);
  const home = botHomeOf(bots, 'api-bot');
  const child = path.join(box.home, 'notes', 'child');
  await mkdir(child, { recursive: true });
  await symlink(child, path.join(home, 'hop'));
  const file = agentsOf(bots, 'api-bot');
  await linkTo(file, undefined, path.join('hop', '..', 'new-agents.md'));
  const lands = path.join(box.home, 'notes', 'new-agents.md');

  const result = await box.run(['rules', 'build', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(await exists(lands), false, `no file comes into being at ${lands}`);
  assert.equal(await readlink(file), path.join('hop', '..', 'new-agents.md'), 'the link is left as it was made');
  assertRefusedWrite(result);
  assertNamesTheLink(result, spellingsOf(box, file), lands);
});

test('C3 a link with .. through a linked folder that stays inside the bot is built where the file system takes it', async (t) => {
  // `hop` leads to <bot>/sub/child, so `hop/../agents-here.md` lands in
  // <bot>/sub/agents-here.md, not <bot>/agents-here.md as the text reads.
  const box = await createSandbox(t);
  const bots = await withBots(box, ['api-bot']);
  const home = botHomeOf(bots, 'api-bot');
  await mkdir(path.join(home, 'sub', 'child'), { recursive: true });
  await symlink(path.join('sub', 'child'), path.join(home, 'hop'));
  const lands = path.join(home, 'sub', 'agents-here.md');
  await writeFile(lands, USERS_NOTES);
  const file = agentsOf(bots, 'api-bot');
  await linkTo(file, undefined, path.join('hop', '..', 'agents-here.md'));

  const result = await box.run(['rules', 'build', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const written = await readFile(lands, 'utf8');
  assert.ok(hasBlock(written), `the rules block lands in ${lands}, got:\n${written}`);
  assert.ok(written.includes('Nothing of the kit\'s belongs in here.'), 'beside what the user wrote');
  assert.equal(await exists(path.join(home, 'agents-here.md')), false, 'nothing at the place the text only reads as');
  assert.equal(await readlink(file), path.join('hop', '..', 'agents-here.md'), 'the link is still a link');
});
