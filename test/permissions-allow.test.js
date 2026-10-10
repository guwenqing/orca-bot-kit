// Recording the user's yes: `obk permission allow <rule>` and the `allow`
// list in `bot.yaml` (#344 slice A, moved out of `bot change` by #527).
//
// `allow` is a list of exact Claude Code permission rule strings the bot is
// allowed; missing means none. Since #527 it holds the kit's default set from
// the moment the bot is made (helpers/permissions.js spells it). `permission
// allow --bots <B> --bot <X> --rule <rule> [--rule <rule> ...]` adds each rule
// to it, in the order given, after the ones already there, and never a second
// copy of one that is there. Everything else in bot.yaml is kept. `--rule` is
// needed, and an empty `--rule ''` is refused and nothing is written. The
// change is written into the bot's Claude settings at once, as `rules build`
// would write it. The plain report names each rule added; `--json` carries
// `allow`, the whole list after the change.
//
// `bot change` holds no permission writes any more: `bot change --allow` is
// refused, names `obk permission allow`, and writes nothing, the charter
// included when `--charter` comes with it.
//
// A value of `allow` that is not a list of strings is a config problem named
// with the file, as a bad `rules` or `skills` is: `rules build` fails that bot,
// naming its bot.yaml, and `health` names it as a config finding.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import {
  assertCleanFailure,
  assertKeptWhatTheyWrote,
  assertNoTrailingSpace,
  createSandbox,
  skipGit,
  snapshot,
} from './helpers/cli.js';
import {
  allowedIn,
  allowOf,
  assertSameRules,
  defaultRules,
  OWN_RULE,
  permissionAllow,
  settingsOf,
  withoutSendMessage,
} from './helpers/permissions.js';
import { botYamlOf } from './helpers/skills.js';

const BOT = 'api-bot';
const CHARTER = 'Api Bot owns the API. Good is a green build. Ask before a release.';
const NEW_CHARTER = 'Api Bot owns the API and its docs. Ask before deleting a page.';

/** Rules outside the kit's default set, each narrow and exact: ones a user might say yes to. */
const CLOSE = 'Bash(gh issue close:*)';
const TEST = 'Bash(npm test)';
const PUSH = 'Bash(git push origin main)';

/** A bots folder `init` made, with one Claude bot of its own and one session: its allow holds the kit's defaults and nothing else. */
async function withBot(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude', '--charter', CHARTER]);
  assert.equal(made.code, 0, made.stderr);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily']);
  assert.equal(added.code, 0, added.stderr);
  return box.path('bots');
}

/** `obk permission allow` for the bot, one `--rule` per rule, then `extra`. */
const allow = (box, rules, ...extra) => permissionAllow(box, BOT, rules, { extra });

/** `obk bot change` for the bot, with the flags given. */
const change = (box, ...rest) => box.run(['bot', 'change', '--bots', 'bots', '--bot', BOT, ...rest]);

const botText = (bots) => readFile(botYamlOf(bots, BOT), 'utf8');

/** The rules of a list that are not the kit's defaults, in the list's order. */
const beyondDefaults = (box, bots, rules) => withoutSendMessage(rules).filter((rule) => !defaultRules(box, bots).includes(rule));

// ----------------------------------------------------------------- adding

test('A1 permission allow adds the rules after the ones already there, in the order given, and the charter stays', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const already = await allowOf(bots, BOT);
  assertSameRules(already, defaultRules(box, bots), 'the premise: bot create gave the bot the kit\'s defaults');
  const before = await botText(bots);

  const result = await allow(box, [TEST, OWN_RULE, CLOSE]);

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await allowOf(bots, BOT), [...already, TEST, OWN_RULE, CLOSE]);
  const after = await botText(bots);
  assert.equal(parse(after).charter.trim(), CHARTER, 'permission allow does not touch the charter');
  assertKeptWhatTheyWrote(before, after, { changed: ['allow'] });
});

test('A1 the user\'s own comments and keys in bot.yaml survive a permission allow', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const mine = `# my own notes about this bot
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
`;
  await writeFile(botYamlOf(bots, BOT), mine);

  const result = await allow(box, [OWN_RULE]);

  assert.equal(result.code, 0, result.stderr);
  const after = await botText(bots);
  assertKeptWhatTheyWrote(mine, after, { changed: ['allow'] });
  assertNoTrailingSpace(after);
  // Whether this run also adds the defaults this hand-written file lacks is
  // not this test's point: only that the rule allowed is there, once.
  assert.deepEqual(beyondDefaults(box, bots, parse(after).allow), [OWN_RULE]);
  assert.ok(after.includes('# a key the kit knows nothing about'), `the user's comment should have survived:\n${after}`);
});

test('A2 new rules go after the ones already there, and a rule already there is not added twice', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const already = await allowOf(bots, BOT);
  const [check] = defaultRules(box, bots);
  assert.equal((await allow(box, [CLOSE, TEST])).code, 0);

  const result = await allow(box, [PUSH, TEST, OWN_RULE, PUSH, check]);

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await allowOf(bots, BOT), [...already, CLOSE, TEST, PUSH, OWN_RULE], 'a default already there is not added again either');
});

for (const [label, args] of [
  ['bot change --allow', ['--allow', OWN_RULE]],
  ['bot change --charter with --allow', ['--charter', NEW_CHARTER, '--allow', OWN_RULE]],
]) {
  test(`A3 ${label} is refused, names obk permission allow, and nothing is written`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    const before = await snapshot(bots, skipGit);

    const result = await change(box, ...args);

    assertCleanFailure(result);
    assert.ok(result.stderr.includes('permission allow'), `the refusal should name obk permission allow, got: ${result.stderr}`);
    assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing: not the charter, not allow, not the settings');
    assert.equal(parse(await botText(bots)).charter.trim(), CHARTER, 'the charter is the one it had');
  });
}

test('A3 permission allow with no --rule is refused, names --rule, and nothing is written', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const before = await snapshot(bots, skipGit);

  const result = await box.run(['permission', 'allow', '--bots', 'bots', '--bot', BOT]);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('--rule'), `the refusal should name --rule, got: ${result.stderr}`);
  assert.deepEqual(await snapshot(bots, skipGit), before);
});

for (const [label, rules] of [
  ['an empty --rule', ['']],
  ['an empty --rule beside a good one', [OWN_RULE, '']],
]) {
  test(`A4 ${label} is refused, and nothing is written`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    const before = await snapshot(bots, skipGit);

    const result = await allow(box, rules);

    assertCleanFailure(result);
    assert.ok(result.stderr.includes('--rule'), `the refusal should name --rule, got: ${result.stderr}`);
    // The kit's own refusal of the empty rule, not an argument parser that knows no --rule.
    assert.ok(!result.stderr.includes('Unknown option'), `--rule should be a flag permission allow knows, got: ${result.stderr}`);
    assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing: not bot.yaml, not the settings');
  });
}

// ----------------------------------------------------------------- written at once

test('A5 the allowed rules are in the bot\'s Claude settings as soon as permission allow returns', async (t) => {
  // No rules build and no up in between: the command writes them itself.
  const box = await createSandbox(t);
  const bots = await withBot(box);

  const result = await allow(box, [TEST, OWN_RULE]);

  assert.equal(result.code, 0, result.stderr);
  const now = await allowedIn(bots, BOT);
  assert.deepEqual(beyondDefaults(box, bots, now), [TEST, OWN_RULE], `${settingsOf(bots, BOT)} should allow them now, in the order given`);
  assertSameRules(now, [...defaultRules(box, bots), TEST, OWN_RULE], 'beside the defaults, and nothing else');
});

// ----------------------------------------------------------------- the report

test('A6 the report names each rule added, and --json carries the whole allow list after the change', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const already = await allowOf(bots, BOT);
  assert.equal((await allow(box, [CLOSE])).code, 0);

  const plain = await allow(box, [TEST, OWN_RULE]);

  assert.equal(plain.code, 0, plain.stderr);
  for (const rule of [TEST, OWN_RULE]) {
    assert.ok(plain.stdout.includes(rule), `the report should name ${rule}, got:\n${plain.stdout}`);
  }

  const asJson = await allow(box, [CLOSE, PUSH], '--json');
  assert.equal(asJson.code, 0, asJson.stderr);
  assert.equal(asJson.stderr, '');
  let parsed;
  try {
    parsed = JSON.parse(asJson.stdout);
  } catch (error) {
    assert.fail(`--json should print JSON and nothing else, got: ${asJson.stdout} (${error.message})`);
  }
  assert.deepEqual(parsed.allow, [...already, CLOSE, TEST, OWN_RULE, PUSH]);
});

// ----------------------------------------------------------------- a value that is not a list of strings

for (const [label, value] of [
  ['a line of text', 'Bash(git add:*)'],
  ['a list holding a number', ['Bash(git add:*)', 42]],
  ['a mapping', { rule: 'Bash(git add:*)' }],
]) {
  test(`A7 an allow that is ${label} is a config problem named with the bot.yaml`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);
    const doc = parse(await botText(bots));
    doc.allow = value;
    await writeFile(botYamlOf(bots, BOT), stringify(doc));
    const was = await allowedIn(bots, BOT);

    const built = await box.run(['rules', 'build', '--bots', 'bots', '--bot', BOT]);
    assert.equal(built.code, 1, `the build should fail this bot, got:\n${built.stdout}${built.stderr}`);
    const said = built.stdout + built.stderr;
    assert.ok(said.includes(botYamlOf(bots, BOT)), `and name its bot.yaml, got:\n${said}`);
    assert.ok(said.includes('allow'), `and say it is the allow entry, got:\n${said}`);
    assert.deepEqual(await allowedIn(bots, BOT), was, 'nothing of it reaches the settings: they allow what they allowed before');

    const health = await box.run(['health', '--bots', 'bots', '--json']);
    const found = JSON.parse(health.stdout).found.filter((one) => one.kind === 'config' && one.bot === BOT
      && typeof one.says === 'string' && one.says.includes('allow')
      && (one.where === botYamlOf(bots, BOT) || one.says.includes(botYamlOf(bots, BOT))));
    assert.equal(found.length, 1, `health should name it once, as a config finding about the bot.yaml, got: ${health.stdout}`);
    assert.equal(health.code, 1);
  });
}

// ----------------------------------------------------------------- a bad allow already there: nothing written

// `permission allow` onto a bot.yaml whose `allow` is not a list of non-empty
// strings is refused before anything is written: not bot.yaml, not AGENTS.md,
// not the settings.
for (const [label, value] of [
  ['a list holding a number', [42]],
  ['a list holding an empty string', ['Bash(git commit:*)', '']],
  ['a list holding a mapping', [{ rule: 'Bash(git commit:*)' }]],
  ['a line of text', 'Bash(git commit:*)'],
  ['a mapping', { rule: 'Bash(git commit:*)' }],
]) {
  test(`A8 permission allow onto an allow that is ${label} is refused, and nothing is written`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    // A rule allowed first, so the settings hold one of the user's: they must not change either.
    assert.equal((await allow(box, [OWN_RULE])).code, 0);
    const doc = parse(await botText(bots));
    doc.allow = value;
    await writeFile(botYamlOf(bots, BOT), stringify(doc));
    const before = await snapshot(bots, skipGit);

    const result = await allow(box, [CLOSE]);

    assertCleanFailure(result);
    assert.ok(result.stderr.includes(botYamlOf(bots, BOT)), `the refusal should name the bot.yaml, got: ${result.stderr}`);
    assert.ok(result.stderr.includes('allow'), `the refusal should say it is the allow entry, got: ${result.stderr}`);
    const now = await snapshot(bots, skipGit);
    const changed = Object.keys({ ...before, ...now }).filter((rel) => before[rel] !== now[rel]);
    assert.deepEqual(changed, [], `a refusal writes nothing: not bot.yaml, not AGENTS.md, not the settings. bot.yaml now:\n${await botText(bots)}`);
  });
}
