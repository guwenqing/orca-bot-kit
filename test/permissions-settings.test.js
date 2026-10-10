// Writing the allowed rules into a bot's `.claude/settings.json`
// `permissions.allow` (#344 slice A).
//
// `rules build`, `up` (before any tab opens, like the hook) and `permission
// allow` (#527; `bot change --allow` before it) write it, for a bot that runs
// on Claude. What is pinned:
//
// - every rule in bot.yaml `allow` is in the file, and no rule outside `allow`
//   and the kit's default set is ever added. Since #527 the kit adds the
//   default rules a bot's `allow` lacks to `allow` itself, with no question,
//   so after any of these runs the file holds the defaults too;
// - everything else in the file is kept as it was: the kit's hook, the other
//   `permissions` keys, entries in `permissions.allow` the kit did not write,
//   and their order. Allowed rules missing from the file are appended after
//   what is there, and none twice;
// - a run that changes nothing leaves the file untouched, content and mtime;
// - nothing outside the bot folder, and never user-level settings: a settings
//   file that is a link leading outside the bot folder is refused by name, as
//   the hook is, and the sandbox's HOME stays as it was seeded;
// - a bot that runs only on Codex gets no Claude settings from this; its rules
//   go into its obk.rules instead (#354, permissions-codex.test.js).
//
// And the kit's rules: every bot's built AGENTS.md tells it that permission
// rules are written by the kit through `obk permission allow`, never by hand,
// and no longer names `bot change --allow`, which is refused since #527. Only
// the command is read there; the prose around it is the implementer's.

import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, readlink, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  assertHomeUntouched,
  assertRefused,
  createSandbox,
  kitHooksIn,
  orcaCallsOf,
} from './helpers/cli.js';
import {
  allowedIn,
  allowOf,
  assertDefaultsAppended,
  assertSameRules,
  codexAllowedIn,
  codexDefaultLines,
  defaultRules,
  FOREIGN_RULE,
  OWN_RULE,
  permissionAllow,
  prefixRule,
  settingsIn,
  settingsOf,
  withoutSendMessage,
  writeAllow,
} from './helpers/permissions.js';
import { agentsIn, blockIn } from './helpers/rules.js';

const BOT = 'api-bot';

/** A bots folder `init` made on Claude, with one more bot on `harness` and a daily session. */
async function withBot(box, harness = 'claude') {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', harness]);
  assert.equal(made.code, 0, made.stderr);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily']);
  assert.equal(added.code, 0, added.stderr);
  return box.path('bots');
}

/** The commands that write the settings from bot.yaml `allow`, each run for the one bot. */
const WRITERS = {
  'rules build': (box) => box.run(['rules', 'build', '--bots', 'bots', '--bot', BOT]),
  up: (box) => box.run(['up', '--bots', 'bots', '--bot', BOT]),
};

/** Run a command that has to go through for the test to mean anything. */
async function ok(promise) {
  const result = await promise;
  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  return result;
}

/** Put `settings` in the bot's Claude settings file, as the user would write it. */
async function writeSettings(bots, settings) {
  const file = settingsOf(bots, BOT);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`);
}

// ----------------------------------------------------------------- only what was allowed

for (const [writer, run] of Object.entries(WRITERS)) {
  test(`S1 ${writer} writes the rules in allow and the defaults it added, and nothing outside them`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    const defaults = defaultRules(box, bots);
    const add = 'Bash(git add:*)';
    // A hand-written allow: one rule of the user's own and one default, so the
    // kit has defaults to add back. The settings file is the user's to start.
    await writeAllow(bots, BOT, [OWN_RULE, add]);
    await writeSettings(bots, {});

    await ok(run(box));

    assertDefaultsAppended(await allowOf(bots, BOT), [OWN_RULE, add], defaults, 'bot.yaml: ');
    const now = await allowedIn(bots, BOT);
    assertSameRules(now, [...defaults, OWN_RULE], `${settingsOf(bots, BOT)} should hold allow, each once, and nothing else`);
    assert.deepEqual(withoutSendMessage(now).slice(0, 2), [OWN_RULE, add], 'in allow\'s order: the user\'s entries first');
    assertSameRules(await allowedIn(bots, 'bot-father'), defaults, 'Bot Father holds the defaults, and nothing else');
  });
}

// ----------------------------------------------------------------- the rest of the file is kept

test('S2 the hook, the other permissions keys, the user\'s own entries and their order are all kept', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const read = `Read(/${bots}.messages/**)`;
  const theirs = {
    permissions: {
      allow: ['Bash(npm test:*)', FOREIGN_RULE, 'Bash(git status)'],
      deny: ['Bash(rm -rf:*)'],
      ask: ['Bash(git push:*)'],
      defaultMode: 'default',
      additionalDirectories: ['../shared'],
    },
    env: { MY_KEY: 'mine' },
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo before' }] }] },
    theme: 'dark',
  };
  await writeSettings(bots, theirs);
  await ok(box.run(['up', '--bots', 'bots', '--bot', BOT]));

  await ok(permissionAllow(box, BOT, [read, OWN_RULE]));
  await ok(box.run(['rules', 'build', '--bots', 'bots', '--bot', BOT]));
  await ok(box.run(['up', '--bots', 'bots', '--bot', BOT]));

  const now = await settingsIn(bots, BOT);
  const allowed = withoutSendMessage(now.permissions.allow);
  assert.deepEqual(allowed.slice(0, theirs.permissions.allow.length), theirs.permissions.allow, 'theirs first, as they were');
  assertSameRules(allowed.slice(theirs.permissions.allow.length), [...defaultRules(box, bots), OWN_RULE], 'then the allowed ones and the defaults, once each');
  for (const key of ['deny', 'ask', 'defaultMode', 'additionalDirectories']) {
    assert.deepEqual(now.permissions[key], theirs.permissions[key], `permissions.${key} is the user's`);
  }
  assert.deepEqual(now.env, theirs.env);
  assert.equal(now.theme, theirs.theme);
  assert.deepEqual(now.hooks.PreToolUse, theirs.hooks.PreToolUse);
  assert.equal(kitHooksIn(now).length, 1, `the kit's hook is still there, once, got: ${JSON.stringify(now.hooks)}`);
});

test('S3 an allowed rule already in the file is not written twice, and keeps its place', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const add = 'Bash(git add:*)';
  await ok(box.run(['up', '--bots', 'bots', '--bot', BOT]));
  const settings = await settingsIn(bots, BOT);
  settings.permissions = { allow: [FOREIGN_RULE, OWN_RULE, add] };
  await writeSettings(bots, settings);
  await writeAllow(bots, BOT, [...await allowOf(bots, BOT), OWN_RULE]);

  await ok(box.run(['rules', 'build', '--bots', 'bots', '--bot', BOT]));

  const now = withoutSendMessage(await allowedIn(bots, BOT));
  assert.deepEqual(now.slice(0, 3), [FOREIGN_RULE, OWN_RULE, add], 'what was there keeps its place');
  assertSameRules(now.slice(3), defaultRules(box, bots).filter((rule) => rule !== add), 'and the rest of allow is appended, none twice');
});

// ----------------------------------------------------------------- a run with nothing to do

const PAST = new Date('2020-01-01T00:00:00Z');

for (const [writer, run] of Object.entries({
  ...WRITERS,
  'permission allow of a rule already allowed': (box) => permissionAllow(box, BOT, [OWN_RULE]),
})) {
  test(`S4 ${writer} with nothing new to write leaves the settings file untouched, content and mtime`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    await ok(box.run(['up', '--bots', 'bots', '--bot', BOT]));
    await ok(permissionAllow(box, BOT, [OWN_RULE, 'Bash(npm test)']));
    const file = settingsOf(bots, BOT);
    const before = await readFile(file, 'utf8');
    await utimes(file, PAST, PAST);

    await ok(run(box));

    assert.equal(await readFile(file, 'utf8'), before);
    assert.equal((await stat(file)).mtime.getTime(), PAST.getTime(), 'the file was not written again');
  });
}

// ----------------------------------------------------------------- up writes before any tab

test('S5 up has written the allowed rules before it opens the bot\'s tab', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  // A rule of the user's own, allowed by hand in bot.yaml since the last write: up writes it before the tab.
  await writeAllow(bots, BOT, [...await allowOf(bots, BOT), OWN_RULE]);
  const kept = path.join(box.root, 'settings-at-tab.json');
  const witness = path.join(box.root, 'witness.cjs');
  await writeFile(witness, "require('node:fs').copyFileSync(process.env.OBK_TEST_WATCH, process.env.OBK_TEST_WITNESS);\n");
  await chmod(witness, 0o755);
  const already = orcaCallsOf(await box.orca.calls(), 'terminal create').length;
  await box.orca.set({
    runDuring: {
      command: 'terminal create',
      on: already + 1,
      argv: [process.execPath, witness],
      env: { OBK_TEST_WATCH: settingsOf(bots, BOT), OBK_TEST_WITNESS: kept },
    },
  });

  await ok(box.run(['up', '--bots', 'bots', '--bot', BOT]));

  const ran = await box.orca.ranDuring();
  assert.equal(ran.length, 1, `the witness should have run as the tab was made, got: ${JSON.stringify(ran)}`);
  assert.equal(ran[0].status, 0, `the settings file should have been there to copy: ${ran[0].stderr}`);
  assertSameRules(JSON.parse(await readFile(kept, 'utf8')).permissions?.allow ?? [], [...defaultRules(box, bots), OWN_RULE]);
});

// ----------------------------------------------------------------- never outside the bot folder

/** What a user keeps in their own settings, outside every bot. */
const USERS_OWN = `${JSON.stringify({ permissions: { allow: ['Bash(git status)'] }, theme: 'dark' }, null, 2)}\n`;

for (const [writer, run] of Object.entries({
  ...WRITERS,
  'permission allow': (box) => permissionAllow(box, BOT, [OWN_RULE]),
})) {
  test(`S6 ${writer} refuses a settings file that links outside the bot folder, and the user's file is untouched`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    await writeAllow(bots, BOT, [...await allowOf(bots, BOT), 'Bash(npm test)']);
    const file = settingsOf(bots, BOT);
    const target = path.join(box.home, '.claude', 'settings.json');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, USERS_OWN);
    await mkdir(path.dirname(file), { recursive: true });
    await rm(file, { force: true });
    await symlink(target, file);

    const result = await run(box);

    assertRefused(result, file);
    assert.equal(await readFile(target, 'utf8'), USERS_OWN, 'the user\'s own settings, byte for byte');
    assert.equal(await readlink(file), target, 'and the link is left as they made it');
  });
}

test('S7 allowing, building and bringing up write nothing in the user\'s home', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);

  await ok(permissionAllow(box, BOT, ['Bash(npm test)']));
  await ok(permissionAllow(box, 'bot-father', [OWN_RULE]));
  await ok(box.run(['rules', 'build', '--bots', 'bots']));
  await ok(box.run(['up', '--bots', 'bots']));

  assertSameRules(await allowedIn(bots, BOT), [...defaultRules(box, bots), 'Bash(npm test)'], 'the rules went into the bot folder');
  assertSameRules(await allowedIn(bots, 'bot-father'), [...defaultRules(box, bots), OWN_RULE], 'Bot Father\'s too');
  await assertHomeUntouched(box);
});

// ----------------------------------------------------------------- only Claude

test('S8 a bot that runs only on Codex gets no Claude settings, whatever its allow holds: its rules go into obk.rules', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'codex');
  await writeAllow(bots, BOT, [...await allowOf(bots, BOT), OWN_RULE]);

  await ok(box.run(['rules', 'build', '--bots', 'bots', '--bot', BOT]));
  await ok(box.run(['up', '--bots', 'bots', '--bot', BOT]));

  assert.equal(await settingsIn(bots, BOT), undefined, `${settingsOf(bots, BOT)} has no reason to exist`);
  assertSameRules(await codexAllowedIn(bots, BOT), [...codexDefaultLines(box, bots), prefixRule(['gh', 'pr', 'merge'])], 'the rules went into the Codex form instead');
});

// ----------------------------------------------------------------- the kit's rules say so

for (const [label, bot, harness] of [
  ['Bot Father', 'bot-father', 'claude'],
  ['a Claude bot', BOT, 'claude'],
  ['a Codex bot', BOT, 'codex'],
]) {
  test(`S9 ${label}'s built AGENTS.md names obk permission allow as the way permission rules are written, and not bot change --allow`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, harness);

    const block = blockIn(await agentsIn(bots, bot)).body;

    assert.ok(block.includes('permission allow'), `the kit's block in ${bot}'s AGENTS.md should name obk permission allow, got:\n${block}`);
    const old = block.split('\n').filter((line) => line.includes('bot change') && line.includes('--allow'));
    assert.deepEqual(old, [], 'and no longer bot change --allow, which is refused now');
  });
}
