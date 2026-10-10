// `obk health` on the permission rules in a bot's `.claude/settings.json`
// (#344 slice A).
//
// Only the kit writes those rules: the kit's own default set, which it writes
// for every bot with nobody asked (#527), and the ones the user said yes to.
// So for a bot that runs on Claude, health names each entry in the file's
// `permissions.allow` that bot.yaml `allow` does not hold: a finding of kind
// `config`, naming the file and the entry verbatim. It names an allowed rule
// the file is missing too (`obk up` writes it). It says nothing when the file
// and `allow` agree, and it never changes the file: an entry it did not write
// stays where it is. `allow` is a key the kit knows, so the unknown-key check
// does not name it.
//
// For a bot that runs on Codex (#354), the kit owns `.codex/rules/obk.rules`
// whole and writes no other file in `.codex/rules/`. So health names each rule
// line (not blank, not a `#` comment) of any other `.rules` file there,
// neutrally: the kit did not write it, and it stays. It names an obk.rules that
// is not what the kit would write from `allow`, a rule missing or a line
// added, and says `obk up` rewrites it. A Read rule and a rule with no Codex
// form are not missing from it. And a bot just made, which holds the kit's
// default set and nothing else, hears nothing about its rules: since #527 no
// default waits for anything. A `.rules` file that cannot be read (a link to
// nothing) does not stop health: it is a finding naming the file, beside every
// other finding, and the file is left as it is.
//
// A finding "names the file" when its `where` is the file or its `says`
// carries the path; which of the two is the implementer's. Everything goes
// through the CLI on a sandboxed fleet that is up in the fake Orca, the way
// test/health-unknown-keys.test.js does. A SendMessage rule may or may not be
// in the default set, and is left out of every comparison.

import assert from 'node:assert/strict';
import { appendFile, lstat, mkdir, readFile, readlink, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createSandbox } from './helpers/cli.js';
import {
  allowedIn,
  allowOf,
  assertSameRules,
  codexAllowedIn,
  codexDefaultLines,
  codexDefaultRules,
  codexRulesOf,
  defaultRules,
  FOREIGN_RULE,
  OWN_RULE,
  permissionAllow,
  readDefault,
  settingsIn,
  settingsOf,
  withoutSendMessage,
  writeAllow,
} from './helpers/permissions.js';
import { botYamlOf } from './helpers/skills.js';

const BOT = 'api-bot';
/** Rules of the bot's own, outside the kit's default set. */
const CLOSE_RULE = 'Bash(gh issue close:*)';
const BUILD_RULE = 'Bash(npm run build:*)';
const VIEW_RULE = 'Bash(gh pr view:*)';
const PAST = new Date('2020-01-01T00:00:00Z');

/** A fleet up in Orca: Bot Father, and one more bot on `harness` with a daily session and any more given. */
async function fleet(box, harness = 'claude', more = []) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', harness]);
  assert.equal(made.code, 0, made.stderr);
  for (const [session, ...settings] of [['daily'], ...more]) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', session, ...settings]);
    assert.equal(added.code, 0, added.stderr);
  }
  const up = await box.run(['up', '--bots', 'bots', '--bot', BOT]);
  assert.equal(up.code, 0, up.stderr);
  return box.path('bots');
}

/** Put entries into the settings file's `permissions.allow` by hand, keeping what else is there. */
async function handAllow(bots, entries) {
  const file = settingsOf(bots, BOT);
  const settings = (await settingsIn(bots, BOT)) ?? {};
  settings.permissions = { ...settings.permissions, allow: entries };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`);
}

/** Run the health check for JSON: the findings, with the exit code they call for. */
async function health(box) {
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

/** The findings whose sentence carries `text`. */
const saying = (found, text) => found.filter((one) => typeof one.says === 'string' && one.says.includes(text));

/** Whether a finding points at `file`, by its `where` or in what it says. */
const names = (finding, file) => finding.where === file || (typeof finding.says === 'string' && finding.says.includes(file));

/** The settings file as bytes and mtime, with the mtime set back first so a rewrite shows. */
async function frozen(bots) {
  const file = settingsOf(bots, BOT);
  await utimes(file, PAST, PAST);
  return { text: await readFile(file, 'utf8'), mtime: PAST.getTime() };
}

async function assertUnchanged(bots, was) {
  const file = settingsOf(bots, BOT);
  assert.equal(await readFile(file, 'utf8'), was.text, 'health never changes the settings file');
  assert.equal((await stat(file)).mtime.getTime(), was.mtime, 'not even to write the same thing back');
}

// ----------------------------------------------------------------- an entry nobody allowed

test('H1 an entry in the settings that allow does not hold is a config finding naming the file and the entry', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await handAllow(bots, [FOREIGN_RULE]);
  const was = await frozen(bots);

  const found = await health(box);

  const said = saying(found, FOREIGN_RULE);
  assert.equal(said.length, 1, `one finding should name ${FOREIGN_RULE} verbatim, got: ${show(found)}`);
  assert.equal(said[0].kind, 'config', `got: ${show(said[0])}`);
  assert.equal(said[0].bot, BOT, `got: ${show(said[0])}`);
  assert.ok(names(said[0], settingsOf(bots, BOT)), `the finding should name ${settingsOf(bots, BOT)}, got: ${show(said[0])}`);
  await assertUnchanged(bots, was);
});

test('H1 an entry allow does not hold is named even beside allowed ones, and they are not', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const add = 'Bash(git add:*)';
  const allowed = await permissionAllow(box, BOT, [OWN_RULE]);
  assert.equal(allowed.code, 0, allowed.stderr);
  const kept = (await allowedIn(bots, BOT)).filter((rule) => rule !== add && rule !== OWN_RULE);
  await handAllow(bots, [...kept, add, FOREIGN_RULE, OWN_RULE]);
  const was = await frozen(bots);

  const found = await health(box);

  assert.equal(saying(found, FOREIGN_RULE).length, 1, `the stray entry is named, got: ${show(found)}`);
  assert.deepEqual(saying(found, add), [], 'an allowed entry, a default, is not a finding');
  assert.deepEqual(saying(found, OWN_RULE), [], 'nor is one the user allowed');
  await assertUnchanged(bots, was);
});

// ----------------------------------------------------------------- an allowed rule the file is missing

test('H2 a rule allow holds and the file is missing is a finding naming the rule, and health does not write it', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  // Added to allow by hand, after the kit wrote the settings file.
  await writeAllow(bots, BOT, [...withoutSendMessage(await allowOf(bots, BOT)), CLOSE_RULE]);
  const was = await frozen(bots);

  const found = await health(box);

  const said = saying(found, CLOSE_RULE);
  assert.equal(said.length, 1, `one finding should name ${CLOSE_RULE}, got: ${show(found)}`);
  assert.equal(said[0].bot, BOT, `got: ${show(said[0])}`);
  await assertUnchanged(bots, was);
});

// ----------------------------------------------------------------- agreement

test('H3 when the file and allow agree, health says nothing about them, and does not call allow unknown', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const rules = [...defaultRules(box, bots), OWN_RULE];
  const allowed = await permissionAllow(box, BOT, [OWN_RULE]);
  assert.equal(allowed.code, 0, allowed.stderr);
  assertSameRules(await allowedIn(bots, BOT), rules, 'the premise: the file holds the defaults and the rule the user allowed');
  const was = await frozen(bots);

  const found = await health(box);

  for (const rule of rules) {
    assert.deepEqual(saying(found, rule), [], `nothing to say about ${rule}, got: ${show(found)}`);
  }
  assert.deepEqual(found.filter((one) => names(one, settingsOf(bots, BOT))), [], `nor about the settings file, got: ${show(found)}`);
  assert.deepEqual(found.filter((one) => names(one, botYamlOf(bots, BOT))), [], `allow is a key the kit knows, got: ${show(found)}`);
  await assertUnchanged(bots, was);
});

test('H3 a Claude bot just made holds the kit\'s defaults in allow and in its settings, and has nothing to hear about them', async (t) => {
  // #527: nobody is asked for the defaults, so none waits; health has nothing to say.
  const box = await createSandbox(t);
  const bots = await fleet(box);
  assertSameRules(await allowOf(bots, BOT), defaultRules(box, bots), 'the premise: bot create put the default set in allow');
  assertSameRules(await allowedIn(bots, BOT), defaultRules(box, bots), 'the premise: and the kit wrote it into the settings');

  const found = await health(box);

  assert.deepEqual(found.filter((one) => names(one, settingsOf(bots, BOT))), [], `got: ${show(found)}`);
  for (const rule of defaultRules(box, bots)) {
    assert.deepEqual(saying(found, rule), [], `got: ${show(found)}`);
  }
});

// ----------------------------------------------------------------- a bot only on Codex

test('H4 a bot that runs only on Codex is not held to a Claude settings file, but to its obk.rules', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box, 'codex');
  await handAllow(bots, [FOREIGN_RULE]);
  // The contrast: a line in its obk.rules that allow does not make.
  const file = codexRulesOf(bots, BOT);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, 'prefix_rule(pattern=["curl"], decision="allow")\n');

  const found = await health(box);

  assert.deepEqual(saying(found, FOREIGN_RULE), [], `the bot does not run on Claude, got: ${show(found)}`);
  assert.equal(found.filter((one) => names(one, file)).length, 1, `its obk.rules is not what the kit would write, got: ${show(found)}`);
});

// ----------------------------------------------------------------- a Codex bot's rules files

/** A rules file of the user's own in the bot's `.codex/rules/`, beside obk.rules. */
const THEIR_RULES = [
  '# my own rules, kept by hand',
  'prefix_rule(pattern=["npm", "test"], decision="allow")',
  '',
  'prefix_rule(pattern=["rm"], decision="forbidden")',
  '',
].join('\n');

/** The rules file's bytes and mtime, with the mtime set back first so a rewrite shows. */
async function frozenFile(file) {
  await utimes(file, PAST, PAST);
  return { file, text: await readFile(file, 'utf8'), mtime: PAST.getTime() };
}

async function assertFileUnchanged(was) {
  assert.equal(await readFile(was.file, 'utf8'), was.text, `health never changes ${was.file}`);
  assert.equal((await stat(was.file)).mtime.getTime(), was.mtime, 'not even to write the same thing back');
}

test('H5 each rule line of another .rules file in a Codex bot\'s .codex/rules is named, neutrally, and the file stays', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box, 'codex');
  const theirs = path.join(path.dirname(codexRulesOf(bots, BOT)), 'default.rules');
  await mkdir(path.dirname(theirs), { recursive: true });
  await writeFile(theirs, THEIR_RULES);
  const was = await frozenFile(theirs);

  const found = await health(box);

  for (const line of ['prefix_rule(pattern=["npm", "test"], decision="allow")', 'prefix_rule(pattern=["rm"], decision="forbidden")']) {
    const said = saying(found, line);
    assert.equal(said.length, 1, `one finding should name ${line} verbatim, got: ${show(found)}`);
    assert.equal(said[0].kind, 'config', `got: ${show(said[0])}`);
    assert.equal(said[0].bot, BOT, `got: ${show(said[0])}`);
    assert.ok(names(said[0], theirs), `the finding should name ${theirs}, got: ${show(said[0])}`);
    assert.doesNotMatch(said[0].says, /broad|unsafe|dangerous|risky/i, `the finding should not judge the user's own rule, got: ${said[0].says}`);
  }
  assert.deepEqual(saying(found, '# my own rules'), [], `a comment is no rule, got: ${show(found)}`);
  await assertFileUnchanged(was);
});

for (const [label, edit] of [
  ['a rule missing', async (file) => writeFile(file, (await readFile(file, 'utf8')).split('\n').filter((line) => !line.includes('"view"')).join('\n'))],
  ['a line added by hand', async (file) => appendFile(file, 'prefix_rule(pattern=["curl"], decision="allow")\n')],
]) {
  test(`H6 an obk.rules with ${label} is named, with obk up to rewrite it, and health does not rewrite it`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box, 'codex');
    const allowed = await permissionAllow(box, BOT, [BUILD_RULE, VIEW_RULE]);
    assert.equal(allowed.code, 0, allowed.stderr);
    const file = codexRulesOf(bots, BOT);
    assert.equal(withoutSendMessage(await codexAllowedIn(bots, BOT)).length, codexDefaultLines(box, bots).length + 2, 'the premise: the kit wrote the defaults and both rules');
    await edit(file);
    const was = await frozenFile(file);

    const found = await health(box);

    const said = found.filter((one) => names(one, file));
    assert.equal(said.length, 1, `one finding should name ${file}, got: ${show(found)}`);
    assert.equal(said[0].bot, BOT, `got: ${show(said[0])}`);
    assert.match(said[0].says, /\bup\b/, `and say obk up rewrites it, got: ${said[0].says}`);
    await assertFileUnchanged(was);
  });
}

test('H7 an obk.rules the kit wrote from allow is not named: a Read rule is not missing from it', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box, 'codex');
  await writeAllow(bots, BOT, [...codexDefaultRules(box, bots), readDefault(box, bots), OWN_RULE]);
  const up = await box.run(['up', '--bots', 'bots', '--bot', BOT]);
  assert.equal(up.code, 0, up.stderr);
  assert.equal(withoutSendMessage(await codexAllowedIn(bots, BOT)).length, codexDefaultLines(box, bots).length + 1, 'the premise: up wrote the defaults and the own rule');

  const found = await health(box);

  const codexDir = path.dirname(codexRulesOf(bots, BOT));
  assert.deepEqual(found.filter((one) => names(one, codexDir) || (typeof one.says === 'string' && one.says.includes('obk.rules'))), [], `got: ${show(found)}`);
  for (const rule of [...defaultRules(box, bots), OWN_RULE]) {
    assert.deepEqual(saying(found, rule), [], `nothing to say about ${rule}, got: ${show(found)}`);
  }
});

test('H7 on a bot on both harnesses, a rule with no Codex form is not missing from obk.rules', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box, 'codex', [['review', '--harness', 'claude']]);
  const allowed = await permissionAllow(box, BOT, [BUILD_RULE, 'Bash(npm test)']);
  assert.equal(allowed.code, 0, allowed.stderr);
  assert.equal(withoutSendMessage(await codexAllowedIn(bots, BOT)).length, codexDefaultLines(box, bots).length + 1, 'the premise: only npm run build has a Codex form');

  const found = await health(box);

  assert.deepEqual(found.filter((one) => names(one, codexRulesOf(bots, BOT))), [], `got: ${show(found)}`);
  assert.deepEqual(saying(found, 'Bash(npm test)'), [], `got: ${show(found)}`);
});

test('H8 a Codex bot just made holds the defaults in its obk.rules, and has nothing to hear about rules', async (t) => {
  // #527: nobody is asked for the defaults, so none waits; health has nothing to say.
  const box = await createSandbox(t);
  const bots = await fleet(box, 'codex');
  assertSameRules(await allowOf(bots, BOT), codexDefaultRules(box, bots), 'the premise: bot create put the Codex default set in allow');
  assertSameRules(await codexAllowedIn(bots, BOT), codexDefaultLines(box, bots), 'the premise: and the kit wrote it into obk.rules');

  const found = await health(box);

  assert.deepEqual(found.filter((one) => names(one, path.dirname(codexRulesOf(bots, BOT))) || (typeof one.says === 'string' && one.says.includes('.rules'))), [], `got: ${show(found)}`);
  for (const rule of defaultRules(box, bots)) {
    assert.deepEqual(saying(found, rule), [], `got: ${show(found)}`);
  }
});

test('H9 a .rules file of the user\'s that cannot be read is a finding naming it, and health still answers everything else', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box, 'codex');
  // A finding elsewhere in the fleet: an entry nobody allowed in Bot Father's settings.
  const father = settingsOf(bots, 'bot-father');
  const settings = (await settingsIn(bots, 'bot-father')) ?? {};
  settings.permissions = { ...settings.permissions, allow: [FOREIGN_RULE] };
  await mkdir(path.dirname(father), { recursive: true });
  await writeFile(father, `${JSON.stringify(settings, null, 2)}\n`);
  // The user's own rules file, a link to a file that is not there.
  const theirs = path.join(path.dirname(codexRulesOf(bots, BOT)), 'default.rules');
  const missing = path.join(box.root, 'gone', 'default.rules');
  await mkdir(path.dirname(theirs), { recursive: true });
  await symlink(missing, theirs);

  const found = await health(box);

  const unread = found.filter((one) => names(one, theirs));
  assert.equal(unread.length, 1, `one finding should name ${theirs}, got: ${show(found)}`);
  assert.equal(unread[0].bot, BOT, `got: ${show(unread[0])}`);
  assert.match(unread[0].says, /read/i, `and say it could not be read, got: ${unread[0].says}`);
  const other = saying(found, FOREIGN_RULE);
  assert.equal(other.length, 1, `the rest of the fleet's findings are still there, got: ${show(found)}`);
  assert.equal(other[0].bot, 'bot-father', `got: ${show(other[0])}`);
  assert.ok((await lstat(theirs)).isSymbolicLink(), 'the link is left as it is');
  assert.equal(await readlink(theirs), missing, 'leading where it led');
});
