// A Codex bot's permission rules, in Codex's own form (#354, slice C of #344),
// as #527 changed how they come to be written.
//
// A bot that runs on Codex (its harness is `codex`, or any of its sessions
// says `harness: codex`) gets the same rules as a Claude bot, written for
// Codex: bot.yaml's `allow` stays the one record, in Claude Code's rule text,
// and the kit makes `<bot home>/.codex/rules/obk.rules` from it. Since #527 the
// kit's default set is in `allow` from the moment the bot is made, with nobody
// asked, and a rule outside it is allowed through `obk permission allow`. What
// is pinned:
//
// - the file: `#` comment lines may come first, then one line per rule, in
//   `allow`'s order, with no duplicates:
//     prefix_rule(pattern=["w1", "w2", ...], decision="allow")
//   each word a JSON string literal, joined by `, `;
// - `Bash(<words>:*)` and `Bash(<words> *)` become the pattern of those words,
//   read as shell words with the quotes taken off and `\'` read as an
//   apostrophe. Two rules with the same pattern make one line;
// - `Read(...)` needs no Codex rule, and is not reported as missing;
// - anything else has no Codex form (Edit, Write, a Bash rule with no trailing
//   wildcard, a wildcard anywhere but the end). It is not written, the JSON
//   answer's Codex entry lists it in `unwritten` as `{ rule, why }`, and
//   `permission allow` refuses it for a bot that runs only on Codex (not 0,
//   naming the rule, saying Codex has no rule for it, writing nothing), while
//   for a bot on both harnesses it is recorded, written for Claude only, and
//   reported as not written for Codex. Broad rules are refused as ADR 0038
//   says;
// - the kit owns obk.rules whole: a line added by hand does not survive a
//   build, and no other file in `.codex/rules/` is ever written;
// - a run whose file would be unchanged does not write it; `written` in the
//   Codex entry is every allowed rule now in the file when the run wrote it,
//   `[]` when it did not;
// - `permission allow` writes it at once, names the file, and says a Codex
//   session already running gets the rule at its next start; `up` writes it
//   before any tab opens, since Codex reads rules when a session starts;
// - only inside the bot folder: a `.codex` or `.codex/rules` that links
//   outside it is refused and nothing is written there, and the user's home
//   (so `~/.codex`) is never touched.
//
// The default lines are in the file in no promised order, so a test reads the
// file as "the default lines, plus these own lines in this order". A
// SendMessage rule, and any line naming it, is neither required nor forbidden,
// and is left out of every comparison.
//
// Expected lines are literals worked out by hand from that format, or spelled
// by helpers/permissions.js from the same requirement. Plain text is read only
// for the rule, the file, and the words "Codex" and "start"; the rest of the
// wording is the implementer's.

import assert from 'node:assert/strict';
import { appendFile, chmod, mkdir, readdir, readFile, readlink, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import {
  assertHomeUntouched,
  botHomeOf,
  createSandbox,
  orcaCallsOf,
  sh,
  shellWord,
  skipGit,
  snapshot,
} from './helpers/cli.js';
import {
  allowedIn,
  allowOf,
  assertSameRules,
  codexAllowedIn,
  codexDefaultLines,
  codexDefaultRules,
  codexLinesIn,
  codexRulesOf,
  defaultRules,
  entryAt,
  jsonOf,
  namesFile,
  OWN_RULE,
  permissionAllow,
  readDefault,
  settingsOf,
  withoutSendMessage,
  writeAllow,
} from './helpers/permissions.js';
import { botYamlOf } from './helpers/skills.js';

const BOT = 'api-bot';
const CHARTER = 'Api Bot owns the API. Good is a green build. Ask before a release.';
const NEW_CHARTER = 'Api Bot owns the API and its docs. It closes issues without asking.';
const PAST = new Date('2020-01-01T00:00:00Z');

/** The line OWN_RULE (`Bash(gh pr merge:*)`) becomes, worked out by hand. */
const OWN_LINE = 'prefix_rule(pattern=["gh", "pr", "merge"], decision="allow")';
/** Two more rules of the bot's own, outside the kit's default set, and their lines, worked out by hand. */
const BUILD_RULE = 'Bash(npm run build:*)';
const BUILD_LINE = 'prefix_rule(pattern=["npm", "run", "build"], decision="allow")';
const VIEW_RULE = 'Bash(gh pr view:*)';
const VIEW_LINE = 'prefix_rule(pattern=["gh", "pr", "view"], decision="allow")';

/** Sessions that make a Codex bot run on Claude too. */
const BOTH = [['daily'], ['review', '--harness', 'claude']];

/**
 * A bots folder `init` made on Claude, with one more bot on `harness` and the
 * sessions given: `[name, ...settings]` each.
 */
async function withBot(box, harness = 'codex', sessions = [['daily']], folder = 'bots') {
  assert.equal((await box.run(['init', '--bots', folder, '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', folder, '--name', BOT, '--harness', harness, '--charter', CHARTER]);
  assert.equal(made.code, 0, made.stderr);
  for (const [session, ...settings] of sessions) {
    const added = await box.run(['session', 'add', '--bots', folder, '--bot', BOT, '--name', session, ...settings]);
    assert.equal(added.code, 0, added.stderr);
  }
  return box.path(folder);
}

/** `obk permission allow` for the bot, one `--rule` per rule. */
const allow = (box, ...rules) => permissionAllow(box, BOT, rules);

/** What a list of rules holds beyond the kit's default set (and SendMessage), in its order. */
const beyond = (box, bots, list) => {
  const defaults = new Set(defaultRules(box, bots));
  return withoutSendMessage(list).filter((rule) => !defaults.has(rule));
};

/** The bot's own rules in bot.yaml `allow`, in order: the defaults left out. */
const ownAllow = async (box, bots, bot = BOT) => beyond(box, bots, await allowOf(bots, bot));

/** The bot's own rules in its Claude settings, in order: the defaults left out. */
const ownSettings = async (box, bots) => beyond(box, bots, await allowedIn(bots, BOT));

/** The own lines of a list of obk.rules lines, in order: the defaults' lines and SendMessage left out. */
const ownOf = (box, bots, lines) => {
  const defaults = new Set(codexDefaultLines(box, bots));
  return withoutSendMessage(lines).filter((line) => !defaults.has(line));
};

/** The bot's own lines in obk.rules, in order. */
const ownLines = async (box, bots, bot = BOT) => ownOf(box, bots, await codexAllowedIn(bots, bot));

/** obk.rules holds every default line, each once, beside whatever own lines. */
async function assertDefaultLines(box, bots, bot = BOT) {
  const lines = withoutSendMessage(await codexAllowedIn(bots, bot));
  const defaults = codexDefaultLines(box, bots);
  assertSameRules(lines.filter((line) => defaults.includes(line)), defaults, `${codexRulesOf(bots, bot)} should hold the kit's default lines, each once, got:\n${lines.join('\n')}`);
}

/** Run a command that has to go through for the test to mean anything. */
async function ok(promise) {
  const result = await promise;
  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  return result;
}

/** The commands that write obk.rules from bot.yaml `allow`, each run for the one bot. */
const WRITERS = {
  'rules build': (box) => box.run(['rules', 'build', '--bots', 'bots', '--bot', BOT]),
  up: (box) => box.run(['up', '--bots', 'bots', '--bot', BOT]),
};

/** The Codex entry of a `--json` answer about the bot. */
const codexEntry = (answer, bots) => entryAt(answer, BOT, codexRulesOf(bots, BOT));

/** What a run said, on either stream, with every `.codex` path word taken out, so "Codex" is read only from the words. */
const wordsOf = (result) => `${result.stdout}${result.stderr}`.replaceAll('.codex', '');

/**
 * A refusal for a bot that runs only on Codex: not 0, no crash, naming the
 * rule, and saying Codex (beyond a path) has no rule for it.
 */
function assertNoCodexForm(result, rule) {
  assert.notEqual(result.code, 0, `${rule} has no Codex form and should be refused, got:\n${result.stdout}${result.stderr}`);
  const said = `${result.stdout}${result.stderr}`;
  assert.ok(!/^\s+at /m.test(said), `expected a message, got a crash:\n${said}`);
  assert.ok(said.includes(rule), `the refusal should name ${rule} verbatim, got:\n${said}`);
  assert.match(wordsOf(result), /codex/i, `the refusal should say Codex has no rule for it, got:\n${said}`);
}

/**
 * Whether a plain report says something about `rule` and Codex: on a line that
 * names the rule, or, for a rule on an indented line, on the heading above it
 * (the nearest line that is not indented), as the waiting block is laid out.
 * `.codex` in a path does not count.
 */
function reportsForCodex(stdout, rule) {
  return codexLinesNaming(stdout, rule) > 0;
}

/** How many lines of a plain report say something about `rule` and Codex, as `reportsForCodex` reads them. */
function codexLinesNaming(stdout, rule) {
  const lines = stdout.split('\n').map((line) => line.replaceAll('.codex', ''));
  return lines.filter((line, at) => {
    if (!line.includes(rule)) return false;
    if (/codex/i.test(line)) return true;
    if (!/^\s/.test(line)) return false;
    const heading = lines.slice(0, at).findLast((above) => above.trim() !== '' && !/^\s/.test(above));
    return heading !== undefined && /codex/i.test(heading);
  }).length;
}

/** Nothing under the bots folder changed: not bot.yaml, not AGENTS.md, not obk.rules. */
async function assertNothingWritten(bots, before) {
  const now = await snapshot(bots, skipGit);
  const changed = Object.keys({ ...before, ...now }).filter((rel) => before[rel] !== now[rel]);
  assert.deepEqual(changed, [], `a refusal writes nothing. bot.yaml now:\n${await readFile(botYamlOf(bots, BOT), 'utf8')}`);
}

// ----------------------------------------------------------------- the Codex form of a rule

for (const [rule, line, why] of [
  ['Bash(npm run build:*)', BUILD_LINE, 'the :* suffix'],
  ['Bash(npm run build *)', BUILD_LINE, 'a bare * as the last word is the same prefix'],
  ['Bash(gh pr merge:*)', OWN_LINE, 'three words'],
  ['Bash(git log --format=%H:*)', 'prefix_rule(pattern=["git", "log", "--format=%H"], decision="allow")', '% and = are plain'],
  ['Bash(python3 /abs/tool.py:*)', 'prefix_rule(pattern=["python3", "/abs/tool.py"], decision="allow")', 'a fixed script by its absolute path'],
  ['Bash(gh pr create --title "a b":*)', 'prefix_rule(pattern=["gh", "pr", "create", "--title", "a b"], decision="allow")', 'double quotes keep a space in one word, and come off'],
  ["Bash(gh pr create --title 'a b' --body \"c d\":*)", 'prefix_rule(pattern=["gh", "pr", "create", "--title", "a b", "--body", "c d"], decision="allow")', 'single and double quotes both come off'],
  [String.raw`Bash(gh pr merge --body 'it'\''s done':*)`, 'prefix_rule(pattern=["gh", "pr", "merge", "--body", "it\'s done"], decision="allow")', String.raw`\' is an apostrophe`],
  ["Bash(gh pr merge --body 'say \"hi\"':*)", String.raw`prefix_rule(pattern=["gh", "pr", "merge", "--body", "say \"hi\""], decision="allow")`, 'a double quote inside a word is escaped as JSON escapes it'],
]) {
  test(`X1 permission allow ${rule} for a Codex bot writes one line into obk.rules (${why})`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);

    const result = await allow(box, rule);

    assert.equal(result.code, 0, `${rule} has a Codex form and should be allowed, got:\n${result.stdout}${result.stderr}`);
    assert.deepEqual(await ownAllow(box, bots), [rule], 'the yes is kept in bot.yaml in Claude text');
    assert.deepEqual(await ownLines(box, bots), [line]);
    await assertDefaultLines(box, bots);
  });
}

test('X1 a Codex bot\'s obk.rules holds the default lines as soon as bot create returns, the CLI and the bots folder as plain words', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);

  await assertDefaultLines(box, bots);
  assert.deepEqual(await ownLines(box, bots), [], 'and nothing else');
  // The premise, by hand, for one of them: the kit's own path, then the words.
  assert.ok(
    (await codexAllowedIn(bots, BOT)).includes(`prefix_rule(pattern=["${box.cli}", "message", "check", "--bots", "${bots}"], decision="allow")`),
    `the message check line, spelled by hand, should be in obk.rules, got:\n${(await codexAllowedIn(bots, BOT)).join('\n')}`,
  );
});

test('X1 a kit whose CLI path has a space: the Claude rule quotes it, the Codex pattern holds it plain', async (t) => {
  // The kit names itself by the path it was started by, so start it by a
  // link in a folder with a space in its name.
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const spaced = path.join(box.root, 'my bin', 'obk');
  await mkdir(path.dirname(spaced));
  await symlink(path.join(box.root, 'bin', 'obk'), spaced);
  const kit = { cli: spaced };
  const set = codexDefaultRules(kit, bots);
  assert.ok(set.some((rule) => rule.startsWith(`Bash('${spaced}' message check`)), `the premise: the rule quotes the CLI, got: ${JSON.stringify(set)}`);

  const built = await sh(`${shellWord(spaced)} rules build --bots bots --bot ${BOT}`, { env: box.env, cwd: box.cwd });

  assert.equal(built.code, 0, built.stderr);
  for (const rule of set) {
    assert.ok((await allowOf(bots, BOT)).includes(rule), `${rule}, spelled with the path the kit was started by, should be in allow`);
  }
  const lines = await codexAllowedIn(bots, BOT);
  for (const line of codexDefaultLines(kit, bots)) {
    assert.ok(lines.includes(line), `obk.rules should hold ${line}, got:\n${lines.join('\n')}`);
  }
  assert.ok(lines.includes(`prefix_rule(pattern=["${spaced}", "message", "check", "--bots", "${bots}"], decision="allow")`), 'the path, space and all, as one word');
});

test('X2 two allowed rules that give the same pattern make one line, in the place of the first', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);

  await ok(allow(box, BUILD_RULE, OWN_RULE, 'Bash(npm run build *)', VIEW_RULE));

  assert.deepEqual(await ownAllow(box, bots), [BUILD_RULE, OWN_RULE, 'Bash(npm run build *)', VIEW_RULE], 'both are kept as the user allowed them');
  assert.deepEqual(await ownLines(box, bots), [BUILD_LINE, OWN_LINE, VIEW_LINE]);
});

// ----------------------------------------------------------------- Read needs nothing

test('X3 an allowed Read rule gets no Codex line and is not reported as unwritten', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const read = 'Read(//Users/someone/project/**)';

  await ok(allow(box, read));

  assert.deepEqual(await ownAllow(box, bots), [read], 'the yes is kept all the same');
  assert.deepEqual(await ownLines(box, bots), [], 'no line for it in obk.rules');
  const alone = codexEntry(jsonOf(await box.run(['rules', 'build', '--bots', 'bots', '--bot', BOT, '--json'])), bots);
  assert.deepEqual(withoutSendMessage((alone.unwritten ?? []).map((one) => one.rule)), [], `a Read rule is not missing from Codex, got: ${JSON.stringify(alone)}`);

  // Beside a rule that has a Codex form: that one is written, the Read rule still not.
  await ok(allow(box, BUILD_RULE));
  assert.deepEqual(await ownLines(box, bots), [BUILD_LINE]);
  const beside = codexEntry(jsonOf(await box.run(['rules', 'build', '--bots', 'bots', '--bot', BOT, '--json'])), bots);
  assert.deepEqual(withoutSendMessage((beside.unwritten ?? []).map((one) => one.rule)), [], `got: ${JSON.stringify(beside)}`);
});

// ----------------------------------------------------------------- no Codex form, a bot only on Codex

/** Narrow rules permission allow accepts for a Claude bot, which have no Codex form. */
const NO_CODEX_FORM = [
  ['Edit(~/notes/**)', 'Edit'],
  ['Write(~/notes/**)', 'Write'],
  ['Bash(npm test)', 'an exact command: a prefix rule would be looser'],
  ['Bash(git push origin main)', 'an exact command of several words'],
  ['Bash(git push * main)', 'a wildcard in the middle'],
];

for (const [rule, why] of NO_CODEX_FORM) {
  test(`X4 permission allow ${rule} for a bot only on Codex is refused (${why}), and nothing is written`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    await ok(allow(box, OWN_RULE));
    assert.deepEqual(await ownLines(box, bots), [OWN_LINE], 'the premise: obk.rules holds the rule allowed first');
    const before = await snapshot(bots, skipGit);

    const result = await allow(box, rule);

    assertNoCodexForm(result, rule);
    await assertNothingWritten(bots, before);
    assert.deepEqual(await ownAllow(box, bots), [OWN_RULE], 'allow is as it was');
  });
}

test('X4 a rule with no Codex form beside good ones refuses the whole command: no rule written', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  await ok(allow(box, OWN_RULE));
  const before = await snapshot(bots, skipGit);

  const result = await allow(box, BUILD_RULE, 'Bash(npm test)', VIEW_RULE);

  assertNoCodexForm(result, 'Bash(npm test)');
  await assertNothingWritten(bots, before);
  const doc = parse(await readFile(botYamlOf(bots, BOT), 'utf8'));
  assert.equal(doc.charter.trim(), CHARTER, 'the charter is the one it had');
  assert.deepEqual(beyond(box, bots, doc.allow), [OWN_RULE], 'the good ones are not recorded either');
});

// ----------------------------------------------------------------- no Codex form, a bot on both

for (const [rule, why] of NO_CODEX_FORM) {
  test(`X5 permission allow ${rule} for a bot on both harnesses is recorded, written for Claude only, and reported as not written for Codex (${why})`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, 'codex', BOTH);

    const result = await allow(box, BUILD_RULE, rule);

    assert.equal(result.code, 0, `the bot runs on Claude too, so ${rule} is allowed, got:\n${result.stdout}${result.stderr}`);
    assert.deepEqual(await ownAllow(box, bots), [BUILD_RULE, rule]);
    assert.deepEqual(await ownSettings(box, bots), [BUILD_RULE, rule], 'written for Claude');
    assert.deepEqual(await ownLines(box, bots), [BUILD_LINE], 'and not for Codex');
    assert.ok(
      reportsForCodex(result.stdout, rule),
      `the report should say ${rule} is not written for Codex, on its line or under a heading that says so, got:\n${result.stdout}`,
    );
  });
}

test('X5 the JSON answer\'s Codex entry lists what has no Codex form as unwritten, { rule, why }, and not the Read rule or what was written', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'codex', BOTH);
  const read = readDefault(box, bots);
  await writeAllow(bots, BOT, [...withoutSendMessage(await allowOf(bots, BOT)), BUILD_RULE, 'Edit(~/notes/**)', 'Bash(npm test)']);

  const answer = jsonOf(await box.run(['rules', 'build', '--bots', 'bots', '--bot', BOT, '--json']));

  const { unwritten } = codexEntry(answer, bots);
  assert.ok(Array.isArray(unwritten), `unwritten should be a list, got: ${JSON.stringify(codexEntry(answer, bots))}`);
  assert.deepEqual(withoutSendMessage(unwritten.map((one) => one.rule)).sort(), ['Bash(npm test)', 'Edit(~/notes/**)']);
  for (const one of unwritten) {
    assert.equal(typeof one.why, 'string', `each says why, got: ${JSON.stringify(one)}`);
    assert.notEqual(one.why.trim(), '', `each says why, got: ${JSON.stringify(one)}`);
  }
  assert.deepEqual(await ownLines(box, bots), [BUILD_LINE]);
  assert.deepEqual(await ownSettings(box, bots), [BUILD_RULE, 'Edit(~/notes/**)', 'Bash(npm test)'], 'Claude gets every one');
  assert.ok((await allowedIn(bots, BOT)).includes(read), 'the Read rule included');
});

// ----------------------------------------------------------------- broad rules

for (const rule of ['Bash(gh:*)', 'Bash(git *)', 'Bash(python3 -c:*)', 'Bash(sudo rm:*)', 'Bash(*)']) {
  test(`X6 permission allow ${rule} for a bot only on Codex is refused as broad, and nothing is written`, async (t) => {
    // All but the last have a prefix Codex could hold, so only the broad
    // line refuses them.
    const box = await createSandbox(t);
    const bots = await withBot(box);
    await ok(allow(box, OWN_RULE));
    const before = await snapshot(bots, skipGit);

    const result = await allow(box, rule);

    assert.equal(result.code, 1, `${rule} is broad, got:\n${result.stdout}${result.stderr}`);
    assert.ok(result.stderr.includes(rule), `the refusal should name ${rule}, got: ${result.stderr}`);
    await assertNothingWritten(bots, before);
  });
}

test('X6 a broad rule for a bot on both harnesses is refused too, and nothing is written', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'codex', BOTH);
  await ok(allow(box, OWN_RULE));
  const before = await snapshot(bots, skipGit);

  const result = await allow(box, 'Bash(gh:*)');

  assert.equal(result.code, 1, `got:\n${result.stdout}${result.stderr}`);
  assert.ok(result.stderr.includes('Bash(gh:*)'), `got: ${result.stderr}`);
  await assertNothingWritten(bots, before);
});

// ----------------------------------------------------------------- what permission allow says

test('X7 permission allow for a Codex bot names obk.rules, and says a running Codex session gets the rule when it next starts', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);

  const result = await ok(allow(box, BUILD_RULE));

  assert.ok(namesFile(result.stdout, box, codexRulesOf(bots, BOT)), `the report should name ${codexRulesOf(bots, BOT)}, got:\n${result.stdout}`);
  const words = wordsOf(result);
  assert.ok(/codex/i.test(words) && /\bstart/i.test(words), `the report should say a Codex session takes the rule at its next start, got:\n${result.stdout}`);

  // Beside it, a Claude bot's permission allow has no Codex session to speak of.
  await ok(box.run(['bot', 'create', '--bots', 'bots', '--name', 'claude-bot', '--harness', 'claude']));
  const other = await ok(permissionAllow(box, 'claude-bot', [BUILD_RULE]));
  assert.doesNotMatch(wordsOf(other), /codex/i, `a Claude bot's report has no Codex in it, got:\n${other.stdout}`);
});

// ----------------------------------------------------------------- the kit owns obk.rules, and only it

test('X8 a line added to obk.rules by hand does not survive a build, and another .rules file is never written', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  await ok(allow(box, BUILD_RULE));
  assert.deepEqual(await ownLines(box, bots), [BUILD_LINE], 'the premise: the kit wrote obk.rules');
  const rulesDir = path.dirname(codexRulesOf(bots, BOT));
  const theirs = '# my own\nprefix_rule(pattern=["npm", "test"], decision="allow")\n';
  await writeFile(path.join(rulesDir, 'default.rules'), theirs);
  await appendFile(codexRulesOf(bots, BOT), 'prefix_rule(pattern=["curl"], decision="allow")\n');

  await ok(box.run(['rules', 'build', '--bots', 'bots', '--bot', BOT]));
  assert.deepEqual(await ownLines(box, bots), [BUILD_LINE], 'obk.rules is what allow makes, and nothing else');
  await assertDefaultLines(box, bots);

  await ok(allow(box, VIEW_RULE));
  await ok(box.run(['up', '--bots', 'bots', '--bot', BOT]));
  assert.deepEqual(await ownLines(box, bots), [BUILD_LINE, VIEW_LINE]);
  assert.equal(await readFile(path.join(rulesDir, 'default.rules'), 'utf8'), theirs, 'default.rules is theirs, byte for byte');
  assert.deepEqual((await readdir(rulesDir)).sort(), ['default.rules', 'obk.rules'], 'and the kit made no other file there');
});

for (const [writer, run] of Object.entries(WRITERS)) {
  test(`X9 ${writer} writes obk.rules from allow as the user set it by hand, with no permission allow in between`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    await writeAllow(bots, BOT, [...withoutSendMessage(await allowOf(bots, BOT)), VIEW_RULE, OWN_RULE]);

    await ok(run(box));

    assert.deepEqual(await ownLines(box, bots), [VIEW_LINE, OWN_LINE]);
    await assertDefaultLines(box, bots);
  });
}

test('X9 the same for a bot whose harness is Claude and one session Codex\'s', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'claude', [['daily'], ['review', '--harness', 'codex']]);
  await writeAllow(bots, BOT, [...withoutSendMessage(await allowOf(bots, BOT)), OWN_RULE]);

  await ok(box.run(['rules', 'build', '--bots', 'bots', '--bot', BOT]));

  assert.deepEqual(await ownLines(box, bots), [OWN_LINE]);
  assert.deepEqual(await ownSettings(box, bots), [OWN_RULE]);
  await assertDefaultLines(box, bots);
});

test('X9 a Claude bot with no Codex session gets no obk.rules, whatever its allow holds', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'claude');
  await writeAllow(bots, BOT, [...withoutSendMessage(await allowOf(bots, BOT)), OWN_RULE]);

  await ok(box.run(['rules', 'build', '--bots', 'bots', '--bot', BOT]));
  await ok(box.run(['up', '--bots', 'bots', '--bot', BOT]));

  assert.deepEqual(await ownSettings(box, bots), [OWN_RULE], 'the premise: the yes was written for Claude');
  assert.equal(await codexLinesIn(codexRulesOf(bots, BOT)), undefined, 'and no Codex file was made');
});

// ----------------------------------------------------------------- when nothing more is to be written

test('X10 with no rule of its own allowed, building and bringing up leave obk.rules with the default lines alone', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);

  for (const run of Object.values(WRITERS)) await ok(run(box));

  await assertDefaultLines(box, bots);
  assert.deepEqual(await ownLines(box, bots), [], `${codexRulesOf(bots, BOT)} holds nothing beyond the defaults`);
});

test('X10 an own rule allow no longer holds leaves obk.rules', async (t) => {
  // The user took the rule out of bot.yaml by hand: the file the kit owns
  // follows allow.
  const box = await createSandbox(t);
  const bots = await withBot(box);
  await ok(allow(box, BUILD_RULE));
  assert.deepEqual(await ownLines(box, bots), [BUILD_LINE], 'the premise: the kit wrote obk.rules');
  await writeAllow(bots, BOT, (await allowOf(bots, BOT)).filter((rule) => rule !== BUILD_RULE));

  await ok(box.run(['rules', 'build', '--bots', 'bots', '--bot', BOT]));

  assert.deepEqual(await ownLines(box, bots), []);
  await assertDefaultLines(box, bots);
});

for (const [writer, run] of Object.entries({
  ...WRITERS,
  'permission allow of a rule already allowed': (box) => allow(box, OWN_RULE),
  'permission allow of a Read rule': (box) => allow(box, 'Read(//Users/someone/project/**)'),
})) {
  test(`X11 ${writer} with nothing new for Codex leaves obk.rules untouched, content and mtime`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    await ok(allow(box, OWN_RULE, BUILD_RULE));
    assert.deepEqual(await ownLines(box, bots), [OWN_LINE, BUILD_LINE], 'the premise: the kit wrote obk.rules');
    const file = codexRulesOf(bots, BOT);
    const before = await readFile(file, 'utf8');
    await utimes(file, PAST, PAST);

    await ok(run(box));

    assert.equal(await readFile(file, 'utf8'), before);
    assert.equal((await stat(file)).mtime.getTime(), PAST.getTime(), 'the file was not written again');
  });
}

test('X12 the Codex entry\'s written is every allowed rule now in the file when the run wrote it, and [] when it did not', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const read = readDefault(box, bots);
  await writeAllow(bots, BOT, [...withoutSendMessage(await allowOf(bots, BOT)), BUILD_RULE, read, VIEW_RULE]);

  const first = codexEntry(jsonOf(await box.run(['rules', 'build', '--bots', 'bots', '--bot', BOT, '--json'])), bots);
  assertSameRules(first.written, [...codexDefaultRules(box, bots), BUILD_RULE, VIEW_RULE], `the Read rule is not in the file, got: ${JSON.stringify(first)}`);
  assert.deepEqual(await ownLines(box, bots), [BUILD_LINE, VIEW_LINE]);

  const again = codexEntry(jsonOf(await box.run(['rules', 'build', '--bots', 'bots', '--bot', BOT, '--json'])), bots);
  assert.deepEqual(again.written, [], `nothing changed, so nothing was written, got: ${JSON.stringify(again)}`);
});

// ----------------------------------------------------------------- up writes before any tab

test('X13 up has written obk.rules before it opens the Codex bot\'s tab', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  await writeAllow(bots, BOT, [BUILD_RULE, OWN_RULE]);
  const kept = path.join(box.root, 'rules-at-tab.rules');
  const witness = path.join(box.root, 'witness.cjs');
  await writeFile(witness, "require('node:fs').copyFileSync(process.env.OBK_TEST_WATCH, process.env.OBK_TEST_WITNESS);\n");
  await chmod(witness, 0o755);
  const already = orcaCallsOf(await box.orca.calls(), 'terminal create').length;
  await box.orca.set({
    runDuring: {
      command: 'terminal create',
      on: already + 1,
      argv: [process.execPath, witness],
      env: { OBK_TEST_WATCH: codexRulesOf(bots, BOT), OBK_TEST_WITNESS: kept },
    },
  });

  await ok(box.run(['up', '--bots', 'bots', '--bot', BOT]));

  const ran = await box.orca.ranDuring();
  assert.equal(ran.length, 1, `the witness should have run as the tab was made, got: ${JSON.stringify(ran)}`);
  assert.equal(ran[0].status, 0, `obk.rules should have been there to copy: ${ran[0].stderr}`);
  const atTab = await codexLinesIn(kept);
  assert.deepEqual(ownOf(box, bots, atTab), [BUILD_LINE, OWN_LINE]);
  const defaults = codexDefaultLines(box, bots);
  assertSameRules(withoutSendMessage(atTab).filter((line) => defaults.includes(line)), defaults, 'the defaults the run added are in the file before the tab opens too');
});

// ----------------------------------------------------------------- never outside the bot folder

for (const [writer, run] of Object.entries({
  ...WRITERS,
  'permission allow': (box) => allow(box, OWN_RULE),
})) {
  for (const linked of ['.codex', path.join('.codex', 'rules')]) {
    test(`X14 ${writer} refuses a ${linked} that links outside the bot folder, and writes nothing there`, async (t) => {
      const box = await createSandbox(t);
      const bots = await withBot(box);
      await writeAllow(bots, BOT, [...withoutSendMessage(await allowOf(bots, BOT)), BUILD_RULE]);
      const home = botHomeOf(bots, BOT);
      // Somewhere of the user's own outside every bot, shaped like what the link stands for.
      const target = path.join(box.root, 'elsewhere', linked);
      const own = path.join(target, ...(linked === '.codex' ? ['rules'] : []), 'default.rules');
      await mkdir(path.dirname(own), { recursive: true });
      await writeFile(own, 'prefix_rule(pattern=["ls"], decision="allow")\n');
      const at = path.join(home, linked);
      await mkdir(path.dirname(at), { recursive: true });
      await rm(at, { recursive: true, force: true });
      await symlink(target, at);
      const theirs = await snapshot(target);

      const result = await run(box);

      assert.equal(result.code, 1, `this should have been refused, got:\n${result.stdout}${result.stderr}`);
      const said = `${result.stdout}${result.stderr}`;
      assert.ok(!/^\s+at /m.test(said), `expected a message, got a crash:\n${said}`);
      assert.ok(namesFile(said, box, path.join(home, '.codex')), `the refusal should name the bot's .codex, got:\n${said}`);
      assert.deepEqual(await snapshot(target), theirs, 'nothing was written where the link leads');
      assert.equal(await readlink(at), target, 'and the link is left as they made it');
    });
  }
}

test('X15 allowing, building and bringing up a Codex bot write nothing in the user\'s home, so nothing in ~/.codex', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);

  await ok(allow(box, OWN_RULE));
  await ok(box.run(['rules', 'build', '--bots', 'bots']));
  await ok(box.run(['up', '--bots', 'bots']));

  assert.deepEqual(await ownLines(box, bots), [OWN_LINE], 'the rules went into the bot folder');
  await assertDefaultLines(box, bots);
  await assertHomeUntouched(box);
});

// ----------------------------------------------------------------- Bot Father on Codex

test('X16 Bot Father on Codex: init writes the default lines into its own obk.rules, and its Claude settings get nothing', async (t) => {
  const box = await createSandbox(t);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'codex'])).code, 0);
  const bots = box.path('bots');

  await assertDefaultLines(box, bots, 'bot-father');
  assert.deepEqual(await ownLines(box, bots, 'bot-father'), []);
  assert.deepEqual(await allowedIn(bots, 'bot-father'), [], `${settingsOf(bots, 'bot-father')} is not Codex's`);
});

// ----------------------------------------------------------------- empty quoted words are part of the prefix

// Only the wildcard comes off a Bash rule (`:*` at the end, or a last word
// `*`); every fixed word stays in the pattern, an empty quoted one too. A
// pattern that drops an empty word is looser than the rule the user allowed.

test('X17 permission allow Bash(git "" *) for a Codex bot never writes the pattern ["git"]: it keeps the empty word, or is refused', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);

  const result = await allow(box, 'Bash(git "" *)');

  const lines = await codexAllowedIn(bots, BOT);
  assert.ok(!lines.includes('prefix_rule(pattern=["git"], decision="allow")'), `["git"] lets every git command through, got:\n${lines.join('\n')}`);
  if (result.code === 0) {
    assert.deepEqual(await ownLines(box, bots), ['prefix_rule(pattern=["git", ""], decision="allow")'], 'allowed, it keeps the empty word');
  } else {
    assert.deepEqual(await ownLines(box, bots), [], 'refused, nothing is written');
    assert.deepEqual(await ownAllow(box, bots), [], 'and nothing recorded');
  }
});

for (const [rule, line] of [
  ['Bash(gh pr create --body "" *)', 'prefix_rule(pattern=["gh", "pr", "create", "--body", ""], decision="allow")'],
  ['Bash(gh pr create --body "":*)', 'prefix_rule(pattern=["gh", "pr", "create", "--body", ""], decision="allow")'],
  ["Bash(gh pr create --body '' *)", 'prefix_rule(pattern=["gh", "pr", "create", "--body", ""], decision="allow")'],
  ['Bash(gh pr create --body "" --title x:*)', 'prefix_rule(pattern=["gh", "pr", "create", "--body", "", "--title", "x"], decision="allow")'],
]) {
  test(`X17 permission allow ${rule} for a Codex bot keeps the empty word in the pattern`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);

    await ok(allow(box, rule));

    assert.deepEqual(await ownLines(box, bots), [line]);
  });
}

// ----------------------------------------------------------------- a grant with no Codex form, in every plain report

for (const [writer, run] of Object.entries(WRITERS)) {
  test(`X18 plain ${writer} names an allowed rule with no Codex form on a line that says Codex, once Codex is added to a Claude bot`, async (t) => {
    // The reproduction: the yes was given while the bot ran only on Claude,
    // so no permission allow ever said it has no Codex form.
    const box = await createSandbox(t);
    const bots = await withBot(box, 'claude');
    await ok(allow(box, 'Bash(npm test)', BUILD_RULE));
    await ok(box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'review', '--harness', 'codex']));

    const result = await ok(run(box));

    assert.deepEqual(await ownLines(box, bots), [BUILD_LINE], 'the premise: the bot runs on Codex now, and only npm run build has a Codex form');
    assert.equal(
      codexLinesNaming(result.stdout, 'Bash(npm test)'),
      1,
      `the report should say once, on a line that says Codex, that Bash(npm test) is not written for Codex, got:\n${result.stdout}`,
    );
    assert.equal(codexLinesNaming(result.stdout, BUILD_RULE), 0, `a rule written for Codex is no such line, got:\n${result.stdout}`);
  });
}

test('X18 plain rules build names every allowed rule with no Codex form of a bot on both harnesses, not the Read rule', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'codex', BOTH);
  const read = readDefault(box, bots);
  await writeAllow(bots, BOT, ['Edit(~/notes/**)', read, BUILD_RULE, 'Bash(git push * main)']);

  const result = await ok(box.run(['rules', 'build', '--bots', 'bots', '--bot', BOT]));

  for (const rule of ['Edit(~/notes/**)', 'Bash(git push * main)']) {
    assert.equal(codexLinesNaming(result.stdout, rule), 1, `the report should say once that ${rule} is not written for Codex, got:\n${result.stdout}`);
  }
  assert.equal(codexLinesNaming(result.stdout, read), 0, `a Read rule needs no Codex form, got:\n${result.stdout}`);
});

test('X18 permission allow of a rule with no Codex form, on a bot on both harnesses, says so once, not twice', async (t) => {
  const box = await createSandbox(t);
  await withBot(box, 'codex', BOTH);

  const result = await ok(allow(box, 'Bash(npm test)'));

  assert.equal(
    codexLinesNaming(result.stdout, 'Bash(npm test)'),
    1,
    `the report should say once that Bash(npm test) is not written for Codex, got:\n${result.stdout}`,
  );
});
