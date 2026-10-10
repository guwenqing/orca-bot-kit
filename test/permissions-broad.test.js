// `obk permission allow` takes only narrow, exact rules (#353, slice B of
// #344; the command moved out of `bot change --allow` by #527).
//
// A charter's grants become exact rules, and the kit records a yes to them
// through `permission allow`. A broad rule is not one the kit records: when
// any `--rule` value is broad, the whole command is refused (exit 1, the
// message on stderr, as slice A's refusals are) and nothing is written, not
// bot.yaml and not the settings file. The refusal names the rule and the bot's settings
// file, `<bot home>/.claude/settings.json`, where the user may add it
// themselves. Why it is broad is said in plain words; that wording is the
// implementer's and is not read here.
//
// Broad, from the requirement:
//   a. a Bash rule that matches any command;
//   b. a `*` inside the program word;
//   c. a wildcard with fewer than two words before the first `*`;
//   d. a shell, interpreter or command wrapper as the program (by the program
//      word's basename) with a wildcard, unless the word after it is a fixed
//      absolute path: no `*` in it, and no shell, interpreter or wrapper by
//      its basename;
//   e. Read, Edit or Write on the whole disk or the whole home.
// A rule's words are shell words: quotes keep a space inside one word. The
// program is the first word after any leading shell assignments (NAME=value
// words), and c and d are judged on it and the words after it. A command
// wrapper is narrowed only by a fixed program by absolute path right after
// it, and the rule from that program on is then judged by itself under all
// the same rules. A shell or interpreter with a version on its name
// (python3.12, node20) counts as that shell or interpreter.
//
// And a Bash rule must be plain words, or it is refused the same way: outside
// quotes only letters, digits, `-_./:=@%+,^`, a leading `~` and the `*`
// wildcard; inside single quotes anything, the quote closed; inside double
// quotes anything but `$`, a backtick and a backslash.
// Everything else is accepted exactly as slice A accepts it, the kit's
// default set first of all: since #527 the kit writes that set itself, with
// no question, so none of it may be broad either.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';

import {
  assertCleanFailure,
  createSandbox,
  sh,
  shellWord,
  skipGit,
  snapshot,
} from './helpers/cli.js';
import {
  allowCommand,
  allowedIn,
  allowOf,
  assertSameRules,
  defaultRules,
  OWN_RULE,
  permissionAllow,
  settingsOf,
} from './helpers/permissions.js';
import { botYamlOf } from './helpers/skills.js';

const BOT = 'api-bot';
const CHARTER = 'Api Bot owns the API. Good is a green build. Ask before a release.';
const NEW_CHARTER = 'Api Bot owns the API and its docs. It closes issues without asking.';

/** A bots folder `init` made, with one Claude bot of its own and one session: it holds the kit's defaults. */
async function withBot(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude', '--charter', CHARTER]);
  assert.equal(made.code, 0, made.stderr);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily']);
  assert.equal(added.code, 0, added.stderr);
  return box.path('bots');
}

/**
 * The same, with one rule already allowed, so the settings file holds
 * something a refusal must leave as it is.
 */
async function withAllowedBot(box) {
  const bots = await withBot(box);
  const first = await allow(box, OWN_RULE);
  assert.equal(first.code, 0, first.stderr);
  assertSameRules(await allowedIn(bots, BOT), [...defaultRules(box, bots), OWN_RULE], 'the premise: the settings file holds the rule allowed first, beside the defaults');
  return bots;
}

/** `obk permission allow` for the bot, one `--rule` per rule. */
const allow = (box, ...rules) => permissionAllow(box, BOT, rules);

const change = (box, ...rest) => box.run(['bot', 'change', '--bots', 'bots', '--bot', BOT, ...rest]);

/** Nothing under the bots folder changed: not bot.yaml, not AGENTS.md, not the settings file. */
async function assertNothingWritten(bots, before) {
  const now = await snapshot(bots, skipGit);
  const changed = Object.keys({ ...before, ...now }).filter((rel) => before[rel] !== now[rel]);
  assert.deepEqual(changed, [], `a refusal writes nothing. bot.yaml now:\n${await readFile(botYamlOf(bots, BOT), 'utf8')}`);
}

/** The refusal names the rule, verbatim, and the bot's own settings file the user may add it to. */
function assertNamesRuleAndFile(result, rule, bots) {
  assert.ok(result.stderr.includes(rule), `the refusal should name ${rule} verbatim, got: ${result.stderr}`);
  assert.ok(
    result.stderr.includes(settingsOf(bots, BOT)),
    `the refusal should name ${settingsOf(bots, BOT)}, where the user can add it themselves, got: ${result.stderr}`,
  );
}

/** Broad rules, by the requirement's letter: the rule and why it is broad. */
const BROAD = [
  // a. matches any command
  ['Bash', 'a: Bash with no specifier'],
  ['Bash()', 'a: an empty specifier'],
  ['Bash(*)', 'a: only a wildcard'],
  ['Bash(:*)', 'a: an empty prefix'],
  // b. a `*` inside the program word
  ['Bash(g*:*)', 'b: a star in the program word'],
  ['Bash(*git commit:*)', 'b: a star before the program word'],
  // c. fewer than two words before the first `*`
  ['Bash(gh:*)', 'c: one word before the :* suffix'],
  ['Bash(git *)', 'c: one word before a star'],
  ['Bash(git * main)', 'c: one word before a star in the middle'],
  ['Bash(/Applications/Orca.app/Contents/Resources/bin/orca:*)', 'c: one absolute program word before :*'],
  ['Bash(curl:*)', 'c: one word before :*'],
  // d. a shell, interpreter or wrapper with a wildcard, the next word no absolute path
  ['Bash(python3 -c:*)', 'd: python3 -c'],
  ['Bash(sh -c:*)', 'd: sh -c'],
  ['Bash(bash -lc:*)', 'd: bash -lc'],
  ['Bash(zsh -c *)', 'd: zsh -c with a spaced star'],
  ['Bash(node -e:*)', 'd: node -e'],
  ['Bash(ruby -e:*)', 'd: ruby -e'],
  ['Bash(perl -e:*)', 'd: perl -e'],
  ['Bash(osascript -e:*)', 'd: osascript -e'],
  ['Bash(npx prettier:*)', 'd: npx'],
  ['Bash(uvx ruff:*)', 'd: uvx'],
  ['Bash(env FOO=1:*)', 'd: env'],
  ['Bash(xargs rm:*)', 'd: xargs'],
  ['Bash(sudo rm:*)', 'd: sudo'],
  ['Bash(nohup git push:*)', 'd: nohup, whatever follows'],
  ['Bash(timeout 10 git:*)', 'd: timeout'],
  ['Bash(/usr/bin/python3 -m:*)', 'd: python3 by the basename of an absolute program word'],
  ['Bash(python3 ./tool.py:*)', 'd: a script by a relative path is no fixed script'],
  ['Bash(python3 /tmp/*:*)', 'd: an absolute path with a star in it is no fixed script'],
  ['Bash(env /bin/sh -c:*)', 'd: a wrapper running a shell by its absolute path'],
  ['Bash(sudo /usr/bin/env bash:*)', 'd: a wrapper running a wrapper by its absolute path'],
  ['Bash(X=1 /bin/sh -c:*)', 'd: a shell after a leading assignment'],
  ['Bash(X=1 gh:*)', 'c: one program word after a leading assignment'],
  ['Bash(env /usr/bin/git:*)', 'c: a wrapper\'s fixed program, judged by itself, takes any arguments'],
  ['Bash(env /abs/tool.sh:*)', 'c: a wrapper\'s fixed program, judged by itself, takes any arguments'],
  ['Bash(X="a b" /bin/sh -c:*)', 'd: a shell after a quoted assignment, one word'],
  ['Bash(X=\'a b\' gh:*)', 'c: one program word after a quoted assignment, one word'],
  ['Bash(\'/opt/my tools/sh\' -c:*)', 'd: a shell by a quoted absolute path with a space in it'],
  ['Bash(/opt/homebrew/bin/python3.12 -c:*)', 'd: python3 with a version on its name'],
  ['Bash(node20 -e:*)', 'd: node with a version on its name'],
  // not plain words: a character the shell reads as more than itself
  [String.raw`Bash(/bin/s\h -c:*)`, 'plain: a backslash escape in the program'],
  [String.raw`Bash(X=a\ b /bin/sh -c:*)`, 'plain: a backslash escaping a space'],
  [String.raw`Bash(gh pr merge \" x:*)`, 'plain: a backslash before a double quote'],
  [String.raw`Bash(/bin/sh\  -c:*)`, 'plain: a backslash before a space after the program'],
  ['Bash(/bin/s? -c:*)', 'plain: a ? pattern'],
  ['Bash(/bin/s[h] -c:*)', 'plain: a [ ] pattern'],
  ['Bash($SHELL -c:*)', 'plain: a $ variable'],
  ['Bash(`which sh` -c:*)', 'plain: a backtick command'],
  ['Bash(gh pr merge; rm:*)', 'plain: a ; ending the command'],
  ['Bash(gh pr merge "$(id)":*)', 'plain: a $ inside double quotes'],
  ['Bash(gh pr merge \'unclosed:*)', 'plain: a quote that does not close'],
  // e. the whole disk or the whole home
  ['Read', 'e: Read with no specifier'],
  ['Edit', 'e: Edit with no specifier'],
  ['Write', 'e: Write with no specifier'],
  ['Edit(//**)', 'e: the whole disk'],
  ['Read(//*)', 'e: the top of the disk'],
  ['Write(~/**)', 'e: the whole home'],
  ['Read(~/*)', 'e: the top of the home'],
];

/** Rules that are narrow and exact, each accepted as slice A accepts any rule. */
const NARROW = [
  ['Bash(gh pr merge:*)', 'three words before :*'],
  ['Bash(gh issue close:*)', 'three words before :*'],
  ['Bash(git push *)', 'two words before the star: the boundary of c'],
  ['Bash(npm test)', 'no wildcard'],
  ['Bash(git push origin main)', 'no wildcard'],
  ['Bash(curl -s https://example.com)', 'no wildcard'],
  ['Bash(node --version)', 'an interpreter with no wildcard'],
  ['Bash(python3 /abs/tool.py:*)', 'an interpreter running a fixed script by its absolute path'],
  ['Bash(node /abs/cli.js run:*)', 'node running a fixed script by its absolute path'],
  ['Bash(env /abs/tool.sh run:*)', 'a wrapper running a fixed program by its absolute path'],
  ['Bash(FOO=1 gh pr merge:*)', 'a leading assignment in front of a narrow rule'],
  ['Bash(X="a b" gh pr merge:*)', 'a quoted assignment, one word, in front of a narrow rule'],
  ['Bash(git log --format=%H:*)', 'plain: % and = are plain characters'],
  ['Bash(gh pr merge --body \'fix: a (small) thing; really\':*)', 'plain: anything inside single quotes'],
  ['Bash(gh pr create --title "a b":*)', 'plain: a space inside double quotes'],
  ['Bash(~/bin/tool run:*)', 'plain: a ~ at the start of a word'],
  ['Bash(npm run build:*)', 'three plain words'],
  [String.raw`Bash(gh pr merge --body 'it'\''s done':*)`, String.raw`plain: \' outside quotes, the kit's own form for an apostrophe`],
  ['Read(//Users/someone/project/**)', 'one folder, not the whole disk'],
  ['Edit(~/notes/**)', 'one folder, not the whole home'],
];

// ----------------------------------------------------------------- a broad rule is refused

for (const [rule, why] of BROAD) {
  test(`N1 permission allow ${rule} is refused as broad (${why}), naming the rule and the settings file, and nothing is written`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withAllowedBot(box);
    const kept = await allowOf(bots, BOT);
    const before = await snapshot(bots, skipGit);

    const result = await allow(box, rule);

    assertCleanFailure(result);
    assertNamesRuleAndFile(result, rule, bots);
    await assertNothingWritten(bots, before);
    assert.deepEqual(await allowOf(bots, BOT), kept, 'allow is as it was');
  });
}

// ----------------------------------------------------------------- narrow rules still go through

for (const [rule, why] of NARROW) {
  test(`N2 permission allow ${rule} is accepted (${why}): kept in allow and written into the settings`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    const kept = await allowOf(bots, BOT);

    const result = await allow(box, rule);

    assert.equal(result.code, 0, `${rule} is narrow and exact, and should be allowed, got:\n${result.stdout}${result.stderr}`);
    assert.deepEqual(await allowOf(bots, BOT), [...kept, rule]);
    assertSameRules(await allowedIn(bots, BOT), [...defaultRules(box, bots), rule], `${settingsOf(bots, BOT)} should allow it now, beside the defaults`);
  });
}

test('N2 the kit\'s default rules are accepted together by permission allow, none taken for broad, and none added twice', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const defaults = defaultRules(box, bots);
  const kept = await allowOf(bots, BOT);

  const result = await allow(box, ...defaults);

  assert.equal(result.code, 0, `the defaults are the kit's own narrow rules, got:\n${result.stdout}${result.stderr}`);
  assert.deepEqual(await allowOf(bots, BOT), kept, 'the bot holds them all already, so nothing is added');
  assertSameRules(await allowOf(bots, BOT), defaults);
  assertSameRules(await allowedIn(bots, BOT), defaults);
});

for (const [label, folder] of [
  ['a space', 'my bots'],
  ['an apostrophe and a space', "bob's bots"],
]) {
  test(`N2 in a bots folder with ${label} in its path, the defaults the kit wrote at create are narrow, and the command that allows them, run as the kit spells it, goes through`, async (t) => {
    // The folder is a quoted word inside the kit's Bash rules: quotes are
    // plain words, so the rules the kit wrote by itself must pass the same
    // check, and the kit's own spelling of the command must go through. The
    // kit writes an apostrophe as '\'' inside a quoted word: a backslash
    // outside quotes right before a single quote, which stands for that quote.
    const box = await createSandbox(t);
    assert.equal((await box.run(['init', '--bots', folder, '--harness', 'claude'])).code, 0);
    const made = await box.run(['bot', 'create', '--bots', folder, '--name', BOT, '--harness', 'claude']);
    assert.equal(made.code, 0, made.stderr);
    const bots = box.path(folder);
    const defaults = defaultRules(box, bots);
    const message = defaults.find((rule) => rule.includes(' message check --bots '));
    assert.ok(message.includes(`--bots ${shellWord(bots)}:*)`), `the premise: the folder is that word inside the rule, got: ${message}`);
    assert.ok(shellWord(bots).startsWith("'"), `the premise: the folder needs quoting, got: ${shellWord(bots)}`);
    assertSameRules(await allowOf(bots, BOT), defaults, 'bot create wrote the defaults, quoted, with no question');
    assertSameRules(await allowedIn(bots, BOT), defaults, 'and into the bot\'s settings');
    const command = allowCommand(box, bots, BOT, defaults);

    const ran = await sh(command, { env: box.env, cwd: box.cwd });

    assert.equal(ran.code, 0, `the kit's own rules should go through as narrow: ${command}\n${ran.stdout}${ran.stderr}`);
    assertSameRules(await allowOf(bots, BOT), defaults);
    assertSameRules(await allowedIn(bots, BOT), defaults);
  });
}

// ----------------------------------------------------------------- a character that is not plain

for (const [rule, character, name] of [
  [String.raw`Bash(/bin/s\h -c:*)`, '\\', 'the backslash'],
  ['Bash(gh pr merge; rm:*)', ';', 'the ;'],
]) {
  test(`N5 refusing ${rule} names ${name} itself, apart from the rule, and writes nothing`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withAllowedBot(box);
    const before = await snapshot(bots, skipGit);

    const result = await allow(box, rule);

    assertCleanFailure(result);
    assertNamesRuleAndFile(result, rule, bots);
    // The rule holds the character, so look for it in the rest of the message.
    assert.ok(
      result.stderr.replaceAll(rule, '').includes(character),
      `the refusal should name ${name} itself, not only inside the rule, got: ${result.stderr}`,
    );
    await assertNothingWritten(bots, before);
  });
}

// ----------------------------------------------------------------- a mix is refused as a whole

test('N3 good rules beside a broad one are refused with it: none of them is recorded or written', async (t) => {
  const box = await createSandbox(t);
  const bots = await withAllowedBot(box);
  const kept = await allowOf(bots, BOT);
  const settings = await allowedIn(bots, BOT);
  const broad = 'Bash(gh:*)';
  const before = await snapshot(bots, skipGit);

  const result = await allow(box, 'Bash(npm test)', broad, 'Bash(gh issue close:*)');

  assertCleanFailure(result);
  assertNamesRuleAndFile(result, broad, bots);
  await assertNothingWritten(bots, before);
  assert.deepEqual(await allowOf(bots, BOT), kept, 'the good ones are not recorded either');
  assert.deepEqual(await allowedIn(bots, BOT), settings, 'nor written into the settings');
});

test('N3 a broad rule as the last of several is refused all the same', async (t) => {
  const box = await createSandbox(t);
  const bots = await withAllowedBot(box);
  const broad = 'Bash(python3 -c:*)';
  const before = await snapshot(bots, skipGit);

  const result = await allow(box, 'Bash(gh issue close:*)', 'Bash(npm test)', broad);

  assertCleanFailure(result);
  assertNamesRuleAndFile(result, broad, bots);
  await assertNothingWritten(bots, before);
});

// #527: `bot change` holds no permission writes. With `--charter`, an
// `--allow` of any kind, broad or narrow, is refused with a pointer at
// `obk permission allow`, and the charter is not changed either.
for (const [label, rule] of [
  ['a broad --allow', 'Edit(//**)'],
  ['a narrow --allow', 'Bash(gh issue close:*)'],
]) {
  test(`N4 bot change --charter with ${label} is refused, names obk permission allow, and the charter is not changed either`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withAllowedBot(box);
    const before = await snapshot(bots, skipGit);

    const result = await change(box, '--charter', NEW_CHARTER, '--allow', rule);

    assertCleanFailure(result);
    assert.ok(result.stderr.includes('permission allow'), `the refusal should name obk permission allow, got: ${result.stderr}`);
    await assertNothingWritten(bots, before);
    const doc = parse(await readFile(botYamlOf(bots, BOT), 'utf8'));
    assert.equal(doc.charter.trim(), CHARTER, 'the charter is the one it had');
  });
}
