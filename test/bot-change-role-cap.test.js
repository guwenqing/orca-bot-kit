// `obk bot change --role-cap <role>=<n>`: the cap of a role in a bot's
// `temp_roles`, set without a hand edit of bot.yaml (#527).
//
// `bot change --bots F --bot B --role-cap <role>=<n>` (repeatable, and may
// come with `--charter`) sets the cap of that role in B's `temp_roles`.
// `<role>=` with nothing after the `=` takes the cap off. A role written as a
// plain list of options becomes a mapping with `options` (the same list) and
// `cap`. The rest of bot.yaml stays as it was.
//
// Refused, nothing written: a role B's `temp_roles` does not have, an `<n>`
// that is not a whole number of 1 or more, a value with no `=`. `bot change`
// needs `--charter` or `--role-cap` (bot-change.test.js).

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';

import {
  assertKeptWhatTheyWrote,
  assertRefused,
  createSandbox,
  skipGit,
  snapshot,
} from './helpers/cli.js';
import { agentsIn } from './helpers/rules.js';
import { botYamlOf } from './helpers/skills.js';

const BOT = 'api-bot';
const CHARTER = 'Api Bot owns the API. Good is a green build. Ask before a release.';
const NEW = 'Api Bot owns the API and its docs. Ask before deleting a page.';

/** The bot.yaml the user wrote by hand: two roles, one a plain list and one a mapping with a cap, and comments of theirs. */
const MINE = `# my own notes about this bot
name: api-bot
harness: claude
charter: |
  ${CHARTER}
notes: keep me            # a key the kit knows nothing about
rules: []
skills: []
sessions:
  - name: daily           # my session
    approval: auto
temp_roles:
  developer:              # a plain list of options
    - name: standard
      model: claude-opus-5-5
      effort: high
      for: most issues
    - name: deep
      model: claude-fable-5-1
      effort: max
      for: hard causes
  reviewer:
    cap: 2
    prompt_file: reviewer.md
    options:
      - name: deep
        harness: codex
        model: gpt-6.1-sol
        for: most reviews
`;

/** The two roles as MINE spells them, parsed. */
const ROLES = parse(MINE).temp_roles;

/** A bots folder `init` made, with one Claude bot whose bot.yaml is MINE. */
async function withRoles(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude', '--charter', CHARTER]);
  assert.equal(made.code, 0, made.stderr);
  const bots = box.path('bots');
  await writeFile(botYamlOf(bots, BOT), MINE);
  return bots;
}

const change = (box, ...rest) => box.run(['bot', 'change', '--bots', 'bots', '--bot', BOT, ...rest]);

const botText = (bots) => readFile(botYamlOf(bots, BOT), 'utf8');

/** Run a command that has to go through for the test to mean anything. */
async function ok(promise) {
  const result = await promise;
  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  return result;
}

// ----------------------------------------------------------------- setting a cap

test('RC1 --role-cap sets the cap of a role that has one, and the rest of bot.yaml stays as it was', async (t) => {
  const box = await createSandbox(t);
  const bots = await withRoles(box);

  await ok(change(box, '--role-cap', 'reviewer=3'));

  const after = await botText(bots);
  const roles = parse(after).temp_roles;
  assert.deepEqual(roles.reviewer, { ...ROLES.reviewer, cap: 3 }, 'only the cap changed');
  assert.deepEqual(roles.developer, ROLES.developer, 'the other role is as it was');
  assertKeptWhatTheyWrote(MINE, after, { changed: ['temp_roles'] });
  assert.equal(parse(after).charter.trim(), CHARTER, 'no --charter, so the charter is the one it had');
});

test('RC2 --role-cap on a role written as a plain list makes it a mapping with options, the same list, and cap', async (t) => {
  const box = await createSandbox(t);
  const bots = await withRoles(box);

  await ok(change(box, '--role-cap', 'developer=2'));

  const roles = parse(await botText(bots)).temp_roles;
  assert.deepEqual(roles.developer, { options: ROLES.developer, cap: 2 });
  assert.deepEqual(roles.reviewer, ROLES.reviewer, 'the other role is as it was');
});

test('RC3 <role>= with nothing after the = takes the cap off, and leaves the rest of the role', async (t) => {
  const box = await createSandbox(t);
  const bots = await withRoles(box);

  await ok(change(box, '--role-cap', 'reviewer='));

  const roles = parse(await botText(bots)).temp_roles;
  const { cap, ...rest } = ROLES.reviewer;
  assert.equal(cap, 2, 'the premise: the role had a cap');
  assert.ok(!('cap' in roles.reviewer), `the cap should be gone, got: ${JSON.stringify(roles.reviewer)}`);
  assert.deepEqual(roles.reviewer, rest, 'and the rest of the role is as it was');
});

test('RC4 --role-cap is repeatable: each role named gets its cap in one run', async (t) => {
  const box = await createSandbox(t);
  const bots = await withRoles(box);

  await ok(change(box, '--role-cap', 'reviewer=1', '--role-cap', 'developer=4'));

  const roles = parse(await botText(bots)).temp_roles;
  assert.equal(roles.reviewer.cap, 1);
  assert.deepEqual(roles.developer, { options: ROLES.developer, cap: 4 });
});

test('RC5 --role-cap with --charter does both, and AGENTS.md carries the new charter', async (t) => {
  const box = await createSandbox(t);
  const bots = await withRoles(box);

  await ok(change(box, '--charter', NEW, '--role-cap', 'reviewer=5'));

  const doc = parse(await botText(bots));
  assert.equal(doc.charter.trim(), NEW);
  assert.equal(doc.temp_roles.reviewer.cap, 5);
  assert.ok((await agentsIn(bots, BOT)).includes(NEW), 'the charter change is built as before');
});

test('RC6 --role-cap answers in --json as JSON and nothing else', async (t) => {
  const box = await createSandbox(t);
  await withRoles(box);

  const result = await change(box, '--role-cap', 'reviewer=3', '--json');

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  assert.equal(answer.bot, BOT);
});

// ----------------------------------------------------------------- refused, nothing written

for (const [label, args, named] of [
  ['a role the bot does not have', ['--role-cap', 'tester=2'], ['tester']],
  ['a cap of 0', ['--role-cap', 'reviewer=0'], ['reviewer']],
  ['a negative cap', ['--role-cap', 'reviewer=-1'], ['reviewer']],
  ['a cap that is not whole', ['--role-cap', 'reviewer=1.5'], ['reviewer']],
  ['a cap that is not a number', ['--role-cap', 'reviewer=two'], ['reviewer']],
  ['a value with no =', ['--role-cap', 'reviewer3'], ['reviewer3']],
  ['a good cap beside a bad one', ['--role-cap', 'developer=2', '--role-cap', 'reviewer=0'], ['reviewer']],
  ['a good cap beside an unknown role', ['--role-cap', 'reviewer=3', '--role-cap', 'tester=1'], ['tester']],
  ['a bad cap with a good --charter', ['--charter', NEW, '--role-cap', 'reviewer=0'], ['reviewer']],
]) {
  test(`RC7 ${label} is refused, and nothing is written`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withRoles(box);
    const before = await snapshot(bots, skipGit);

    const result = await change(box, ...args);

    assertRefused(result, ...named);
    assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing: not bot.yaml, not AGENTS.md');
  });
}

test('RC7 --role-cap for a bot with no temp_roles is refused, and nothing is written', async (t) => {
  const box = await createSandbox(t);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude', '--charter', CHARTER])).code, 0);
  const bots = box.path('bots');
  const before = await snapshot(bots, skipGit);

  const result = await change(box, '--role-cap', 'reviewer=2');

  assertRefused(result, 'reviewer');
  assert.deepEqual(await snapshot(bots, skipGit), before);
  assert.equal(parse(await botText(bots)).temp_roles, undefined, 'no temp_roles made up');
});
