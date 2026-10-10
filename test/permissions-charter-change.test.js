// A charter change and the rules the bot is allowed now (#353, slice B of
// #344, and #354 for Codex).
//
// A new charter may grant more or less than the old one, and its rules are to
// be listed and shown to the user again; until the user answers, nothing
// changes. So `obk bot change --bots <B> --bot <X> --charter <text>`, for a
// bot that runs on Claude Code, adds to its plain report each rule the bot is
// allowed now beyond the kit's defaults, word for word, and says none of
// them is removed or added until the user answers. With nothing allowed beyond
// the defaults, the report lists no rule. Its `--json` answer carries
// `beyondDefaults`: the rules in bot.yaml `allow` that are not defaults, in
// `allow`'s order, `[]` for none. The change writes nothing into the settings
// file and leaves `allow` as it was. A bot that runs on Codex gets the same
// note and `beyondDefaults`, and the note names its `.codex/rules/obk.rules`
// among the places the rules would be taken out of; the change writes nothing
// into that file either.
//
// Since #527 the permission writes live in commands of their own: where the
// report says how a rule is allowed or taken back, it names `obk permission
// allow` and `obk permission disallow`, and no longer `bot change --allow` or
// `--disallow`, which are refused now.
//
// Plain text is read only for the exact rule strings and those command names;
// the sentence that nothing changes until the user answers is the
// implementer's wording.

import assert from 'node:assert/strict';
import { mkdir, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import { createSandbox } from './helpers/cli.js';
import {
  allowOf,
  assertSameRules,
  codexAllowedIn,
  codexDefaultLines,
  codexDefaultRules,
  codexRulesOf,
  defaultRules,
  mentionsAny,
  namesFile,
  OWN_RULE,
  permissionAllow,
  prefixRule,
  settingsIn,
  settingsOf,
  writeAllow,
} from './helpers/permissions.js';
import { botYamlOf } from './helpers/skills.js';

const BOT = 'api-bot';
const NEW_CHARTER = 'Api Bot owns the API and its docs. It merges pull requests without asking.';
const CLOSE_RULE = 'Bash(gh issue close:*)';
const PAST = new Date('2020-01-01T00:00:00Z');

/** A bots folder `init` made, with one more bot on `harness`, and the sessions given: `[name, ...settings]` each. */
async function withBot(box, harness = 'claude', sessions = [['daily']]) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', harness]);
  assert.equal(made.code, 0, made.stderr);
  for (const [session, ...settings] of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', session, ...settings]);
    assert.equal(added.code, 0, added.stderr);
  }
  return box.path('bots');
}

const charterChange = (box, ...rest) => box.run(['bot', 'change', '--bots', 'bots', '--bot', BOT, '--charter', NEW_CHARTER, ...rest]);

/** The answer of a `--json` charter change, parsed. */
function jsonOf(result) {
  assert.equal(result.code, 0, `the charter change should have gone through, got:\n${result.stdout}${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
}

// ----------------------------------------------------------------- what is allowed beyond the defaults

test('C1 a charter change names each rule the bot is allowed beyond the defaults, word for word, and not the defaults', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const defaults = defaultRules(box, bots);
  await writeAllow(bots, BOT, [...defaults, OWN_RULE, CLOSE_RULE]);

  const result = await charterChange(box);

  assert.equal(result.code, 0, result.stderr);
  for (const rule of [OWN_RULE, CLOSE_RULE]) {
    assert.ok(result.stdout.includes(rule), `the report should name ${rule}, allowed now beyond the defaults, got:\n${result.stdout}`);
  }
  assert.deepEqual(mentionsAny(result.stdout, defaults), [], `the defaults are not beyond the defaults, got:\n${result.stdout}`);
});

test('C2 --json carries beyondDefaults: the allowed rules that are no default, in allow\'s order', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const defaults = defaultRules(box, bots);
  const [check, read, add] = [defaults[0], `Read(/${bots}.messages/**)`, 'Bash(git add:*)'];
  await writeAllow(bots, BOT, [CLOSE_RULE, check, OWN_RULE, read, add]);

  const answer = jsonOf(await charterChange(box, '--json'));

  assert.deepEqual(answer.beyondDefaults, [CLOSE_RULE, OWN_RULE]);
});

for (const [label, allow] of [
  ['nothing allowed at all', 'none'],
  ['only the defaults allowed', 'defaults'],
  ['some of the defaults allowed', 'some'],
]) {
  test(`C3 with ${label}, a charter change lists no rule, and beyondDefaults is empty`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    const defaults = defaultRules(box, bots);
    if (allow === 'none') await writeAllow(bots, BOT, []);
    if (allow === 'defaults') await writeAllow(bots, BOT, defaults);
    if (allow === 'some') await writeAllow(bots, BOT, [defaults[5], defaults[0]]);

    const answer = jsonOf(await charterChange(box, '--json'));
    assert.deepEqual(answer.beyondDefaults, [], `nothing is allowed beyond the defaults, got: ${JSON.stringify(answer)}`);

    const plain = await box.run(['bot', 'change', '--bots', 'bots', '--bot', BOT, '--charter', `${NEW_CHARTER} Again.`]);
    assert.equal(plain.code, 0, plain.stderr);
    assert.deepEqual(mentionsAny(plain.stdout, [...defaults, OWN_RULE, CLOSE_RULE]), [], `no rule should be listed, got:\n${plain.stdout}`);
  });
}

test('C4 a Codex bot with a Claude session runs on Claude, and its charter change carries beyondDefaults', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'codex', [['daily'], ['review', '--harness', 'claude']]);
  await writeAllow(bots, BOT, [OWN_RULE]);

  const answer = jsonOf(await charterChange(box, '--json'));

  assert.deepEqual(answer.beyondDefaults, [OWN_RULE]);
});

// ----------------------------------------------------------------- nothing changes until the user answers

test('C5 a charter change writes nothing into the settings file and leaves allow as it was, a hand-added entry included', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const allowed = await permissionAllow(box, BOT, [CLOSE_RULE, OWN_RULE]);
  assert.equal(allowed.code, 0, allowed.stderr);
  const kept = await allowOf(bots, BOT);
  // An entry of the user's own beside them, which the new charter may or may not grant.
  const file = settingsOf(bots, BOT);
  const settings = await settingsIn(bots, BOT);
  settings.permissions.allow = [...settings.permissions.allow, 'Bash(gh:*)'];
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`);
  await utimes(file, PAST, PAST);
  const text = await readFile(file, 'utf8');

  const result = await charterChange(box);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(parse(await readFile(botYamlOf(bots, BOT), 'utf8')).charter.trim(), NEW_CHARTER, 'the premise: the charter did change');
  assert.deepEqual(await allowOf(bots, BOT), kept, 'allow is as it was');
  assert.equal(await readFile(file, 'utf8'), text, 'the settings file is as it was');
  assert.equal((await stat(file)).mtime.getTime(), PAST.getTime(), 'not even written back the same');
});

// ----------------------------------------------------------------- a bot on Codex

test('C6 a bot that runs only on Codex gets the note of allowed rules and beyondDefaults, naming its obk.rules', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'codex');
  await writeAllow(bots, BOT, [...codexDefaultRules(box, bots), OWN_RULE, CLOSE_RULE]);

  const answer = jsonOf(await charterChange(box, '--json'));
  assert.deepEqual(answer.beyondDefaults, [OWN_RULE, CLOSE_RULE]);

  const plain = await box.run(['bot', 'change', '--bots', 'bots', '--bot', BOT, '--charter', `${NEW_CHARTER} Again.`]);
  assert.equal(plain.code, 0, plain.stderr);
  for (const rule of [OWN_RULE, CLOSE_RULE]) {
    assert.ok(plain.stdout.includes(rule), `the report should name ${rule}, allowed now beyond the defaults, got:\n${plain.stdout}`);
  }
  assert.deepEqual(mentionsAny(plain.stdout, codexDefaultRules(box, bots)), [], `the defaults are not beyond the defaults, got:\n${plain.stdout}`);
  assert.ok(namesFile(plain.stdout, box, codexRulesOf(bots, BOT)), `the report should name ${codexRulesOf(bots, BOT)}, got:\n${plain.stdout}`);
});

test('C6 a Codex bot with nothing allowed beyond the defaults hears of no rule', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'codex');
  await writeAllow(bots, BOT, codexDefaultRules(box, bots));

  const answer = jsonOf(await charterChange(box, '--json'));

  assert.deepEqual(answer.beyondDefaults, []);
});

test('C7 a charter change writes nothing into a Codex bot\'s obk.rules and leaves allow as it was', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'codex');
  const allowed = await permissionAllow(box, BOT, [CLOSE_RULE, OWN_RULE]);
  assert.equal(allowed.code, 0, allowed.stderr);
  const kept = await allowOf(bots, BOT);
  const file = codexRulesOf(bots, BOT);
  assertSameRules(await codexAllowedIn(bots, BOT), [...codexDefaultLines(box, bots), prefixRule(['gh', 'issue', 'close']), prefixRule(['gh', 'pr', 'merge'])], 'the premise: obk.rules holds both, beside the defaults');
  await utimes(file, PAST, PAST);
  const text = await readFile(file, 'utf8');

  const result = await charterChange(box);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(parse(await readFile(botYamlOf(bots, BOT), 'utf8')).charter.trim(), NEW_CHARTER, 'the premise: the charter did change');
  assert.deepEqual(await allowOf(bots, BOT), kept, 'allow is as it was');
  assert.equal(await readFile(file, 'utf8'), text, 'obk.rules is as it was');
  assert.equal((await stat(file)).mtime.getTime(), PAST.getTime(), 'not even written back the same');
});

// ----------------------------------------------------------------- the commands it names (#527)

for (const [label, harness, sessions] of [
  ['a Claude bot', 'claude', [['daily']]],
  ['a Codex bot', 'codex', [['daily']]],
]) {
  test(`C8 ${label}'s charter change, with rules beyond the defaults, names obk permission allow and obk permission disallow, and not bot change --allow or --disallow`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, harness, sessions);
    await writeAllow(bots, BOT, [...await allowOf(bots, BOT), OWN_RULE]);

    const result = await charterChange(box);

    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.stdout.includes('permission allow'), `the report should say a new rule is allowed with obk permission allow, got:\n${result.stdout}`);
    assert.ok(result.stdout.includes('permission disallow'), `and that a rule is taken back with obk permission disallow, got:\n${result.stdout}`);
    assert.ok(!/--allow\b|--disallow\b/.test(result.stdout), `and no longer name bot change --allow or --disallow, got:\n${result.stdout}`);
  });
}

test('C8 a charter change with nothing beyond the defaults names obk permission allow for a new rule, and not bot change --allow', async (t) => {
  const box = await createSandbox(t);
  await withBot(box);

  const result = await charterChange(box);

  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout.includes('permission allow'), `the report should say a new rule is allowed with obk permission allow, got:\n${result.stdout}`);
  assert.ok(!/--allow\b|--disallow\b/.test(result.stdout), `and no longer name bot change --allow, got:\n${result.stdout}`);
});
