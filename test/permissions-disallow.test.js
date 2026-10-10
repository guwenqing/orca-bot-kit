// Taking back a rule a charter no longer grants, after the user's yes (#360),
// through its own command since #527.
//
// `obk permission disallow --bots <B> --bot <X> --rule <rule> [--rule <rule> ...]
// [--json]` takes each rule out of bot.yaml `allow`, where it must be, exactly
// as written there. It does what `bot change --disallow` did before #527, with
// the same refusals. The other entries stay, in their order, and the rest of
// bot.yaml is kept (comments, other keys, the charter). What is pinned:
//
// - for a bot that runs on Claude Code, every entry of that exact text leaves
//   `permissions.allow` in its `.claude/settings.json`; every other entry (the
//   user's own, others the kit wrote) stays in its order, every other key is
//   kept, and nothing is added, not even a rule `allow` holds that the file
//   lacks. No settings file, or one without the rule, still goes through, and
//   no file is made;
// - for a bot that runs on Codex, `.codex/rules/obk.rules` is rewritten from
//   what `allow` still holds: the rule's line goes, unless another rule still in
//   `allow` gives the very same line. No other `.rules` file is touched;
// - refused, with nothing changed anywhere (bot.yaml, the settings file,
//   obk.rules): a rule `allow` does not hold, even one the settings file has by
//   hand; an empty rule; no `--rule` at all; a settings file the kit would
//   refuse to write (a link outside the bot folder, not JSON, `permissions` not
//   a mapping, `permissions.allow` not a list); an `allow` in bot.yaml that is
//   not a list of rules; an unknown bot; a harness file or a bot.yaml the kit
//   cannot write; a bot.yaml whose `allow` edit cannot be made (an anchor
//   another key uses);
// - #527: a rule in the kit's current default set is refused too: the refusal
//   says it is one of the kit's default rules, which the kit writes again at
//   its next rules write, and nothing changes;
// - #527: `bot change --disallow` no longer takes a rule back: it is refused,
//   names `obk permission disallow`, and changes nothing, the charter included
//   when `--charter` comes with it;
// - when a line leaves obk.rules, the last of the bot's own included, the plain
//   report says `obk restart`; when none does, it does not;
// - the same rule given twice is taken out once; `--json` carries `allow` (the
//   whole list now) and `disallowed` (what this call took out, in the order
//   given, each once); `obk health` then has nothing to say about the rule;
// - `bot change --charter` for a bot with rules beyond the defaults says how to
//   take one back (`obk permission disallow`), and `--help` lists
//   `obk permission disallow`.
//
// A bot's `allow` holds the kit's default set from the moment it is made
// (#527), in no promised order, so the rules taken back here are rules of the
// bot's own, outside that set, and lists are read as "the defaults, plus these
// own rules in this order". A SendMessage rule is neither required nor
// forbidden, and is left out of every comparison.
//
// Plain text is read only for exact rule strings, file paths, the command and
// the flag name; the sentences around them are the implementer's. Where the
// claim is that nothing changed, the bots folder is compared byte for byte.
//
// Not covered here: that Bot Father offers the take-back and runs nothing on a
// no. That is the skill's prose, read in review, not something a unit test runs.

import assert from 'node:assert/strict';
import { appendFile, chmod, mkdir, readFile, readlink, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse, parseDocument, stringify } from 'yaml';

import {
  assertKeptWhatTheyWrote,
  assertRefused,
  botHomeOf,
  createSandbox,
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
  codexRulesOf,
  defaultRules,
  FOREIGN_RULE,
  jsonOf,
  ORCA_CHECK_RULE,
  OWN_RULE,
  permissionAllow,
  permissionDisallow,
  readDefault,
  settingsIn,
  settingsOf,
  withoutSendMessage,
} from './helpers/permissions.js';
import { botYamlOf } from './helpers/skills.js';

const BOT = 'api-bot';
const CHARTER = 'Api Bot owns the API. It merges pull requests and closes issues without asking.';
const NEW_CHARTER = 'Api Bot owns the API. It asks before merging a pull request.';
const CLOSE_RULE = 'Bash(gh issue close:*)';
/** Two more rules of the bot's own, outside the kit's default set. */
const BUILD_RULE = 'Bash(npm run build:*)';
const VIEW_RULE = 'Bash(gh pr view:*)';
/** The same Codex line as OWN_RULE (`Bash(gh pr merge:*)`), spelled the other way Claude Code allows. */
const OWN_RULE_SPACED = 'Bash(gh pr merge *)';
const PAST = new Date('2020-01-01T00:00:00Z');

/** The lines OWN_RULE, BUILD_RULE and CLOSE_RULE become in obk.rules, worked out by hand. */
const OWN_LINE = 'prefix_rule(pattern=["gh", "pr", "merge"], decision="allow")';
const BUILD_LINE = 'prefix_rule(pattern=["npm", "run", "build"], decision="allow")';
const CLOSE_LINE = 'prefix_rule(pattern=["gh", "issue", "close"], decision="allow")';

/** Sessions that make a Codex bot run on Claude too. */
const BOTH = [['daily'], ['review', '--harness', 'claude']];

/**
 * A bots folder `init` made on Claude, with one more bot on `harness`, the
 * sessions given (`[name, ...settings]` each), and `allowed` allowed through
 * the kit, so its harness files hold them as the kit writes them.
 */
async function withBot(box, { harness = 'claude', sessions = [['daily']], allowed = [] } = {}) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', harness, '--charter', CHARTER]);
  assert.equal(made.code, 0, made.stderr);
  for (const [session, ...settings] of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', session, ...settings]);
    assert.equal(added.code, 0, added.stderr);
  }
  const up = await box.run(['up', '--bots', 'bots', '--bot', BOT]);
  assert.equal(up.code, 0, up.stderr);
  if (allowed.length > 0) {
    const allow = await permissionAllow(box, BOT, allowed);
    assert.equal(allow.code, 0, `the premise: ${allowed.join(', ')} allowed through the kit\n${allow.stdout}${allow.stderr}`);
  }
  return box.path('bots');
}

/** `obk permission disallow` for the bot, one `--rule` per rule, then any more arguments. */
const disallow = (box, rules, ...extra) => permissionDisallow(box, BOT, rules, { extra });

/** `bot change` for the bot, with the arguments given: what no longer takes a rule back (#527). */
const change = (box, ...rest) => box.run(['bot', 'change', '--bots', 'bots', '--bot', BOT, ...rest]);

/** What a list of rules holds beyond the kit's default set (and SendMessage), in its order. */
const beyond = (box, bots, list) => {
  const defaults = new Set(defaultRules(box, bots));
  return withoutSendMessage(list).filter((rule) => !defaults.has(rule));
};

/** The bot's own rules in bot.yaml `allow`, in order: the defaults left out. */
const ownAllow = async (box, bots) => beyond(box, bots, await allowOf(bots, BOT));

/** The bot's own rules in its Claude settings, in order: the defaults left out. */
const ownSettings = async (box, bots) => beyond(box, bots, await allowedIn(bots, BOT));

/** The bot's own lines in obk.rules, in order: the defaults' lines left out. */
const ownLines = async (box, bots) => {
  const defaults = new Set(codexDefaultLines(box, bots));
  return withoutSendMessage(await codexAllowedIn(bots, BOT)).filter((line) => !defaults.has(line));
};

/** `allow` still holds every default rule of the bot, each once: a take-back leaves them be. */
async function assertDefaultsKept(box, bots, harness = 'claude') {
  const defaults = harness === 'codex' ? codexDefaultRules(box, bots) : defaultRules(box, bots);
  const allow = withoutSendMessage(await allowOf(bots, BOT));
  assertSameRules(allow.filter((rule) => defaults.includes(rule)), defaults, `${BOT}'s allow should still hold the kit's defaults, got:\n${JSON.stringify(allow, null, 2)}`);
}

const botText = (bots) => readFile(botYamlOf(bots, BOT), 'utf8');

/** Put `settings` in the bot's Claude settings file by hand, as the user would write it. */
async function writeSettings(bots, settings) {
  const file = settingsOf(bots, BOT);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`);
}

/** Set the settings file's `permissions.allow` by hand, keeping everything else in it. */
async function handAllow(bots, entries) {
  const settings = (await settingsIn(bots, BOT)) ?? {};
  settings.permissions = { ...settings.permissions, allow: entries };
  await writeSettings(bots, settings);
}

/** Run a command that has to go through for the test to mean anything. */
async function ok(promise) {
  const result = await promise;
  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  return result;
}

/** Nothing under the bots folder changed, byte for byte: not bot.yaml, not AGENTS.md, not a harness file. */
async function assertNothingChanged(bots, before) {
  const now = await snapshot(bots, skipGit);
  const changed = Object.keys({ ...before, ...now }).filter((rel) => before[rel] !== now[rel]);
  assert.deepEqual(changed, [], `a refusal changes nothing. bot.yaml now:\n${await botText(bots)}`);
}

/** A refusal: not 0, a message rather than a crash, and stderr naming each of `named`. */
function assertRefusedNaming(result, ...named) {
  assert.notEqual(result.code, 0, `this should have been refused, got:\n${result.stdout}${result.stderr}`);
  assert.ok(!/^\s+at /m.test(`${result.stdout}${result.stderr}`), `expected a message, got a crash:\n${result.stderr}`);
  for (const word of named) {
    assert.ok(result.stderr.includes(word), `the refusal should name ${word} on stderr, got:\n${result.stderr}`);
  }
}

/** Run the health check for JSON: the findings. */
async function healthFindings(box) {
  const result = await box.run(['health', '--bots', 'bots', '--json']);
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  assert.ok(Array.isArray(answer.found), `the answer should carry a list of findings, got: ${result.stdout}`);
  return answer.found;
}

// ----------------------------------------------------------------- bot.yaml: the rule leaves allow, the rest stays

test('D1 permission disallow takes the rule out of allow; the others stay in their order, and the charter and the user\'s own lines stay', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { allowed: [BUILD_RULE, OWN_RULE, CLOSE_RULE, VIEW_RULE] });
  // A comment and a key of the user's own, added by hand after the kit wrote the file.
  await appendFile(botYamlOf(bots, BOT), '# my own note about this bot\nnotes: keep me\n');
  const before = await botText(bots);

  const result = await disallow(box, [OWN_RULE]);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  const after = await botText(bots);
  assert.deepEqual(beyond(box, bots, parse(after).allow), [BUILD_RULE, CLOSE_RULE, VIEW_RULE]);
  await assertDefaultsKept(box, bots);
  assert.equal(parse(after).charter.trim(), CHARTER, 'the charter is the one it had');
  assertKeptWhatTheyWrote(before, after, { changed: ['allow'] });
  assert.ok(after.includes('# my own note about this bot'), `the user's comment should have survived:\n${after}`);
});

test('D1 two rules taken back in one run: both leave allow, the rest keep their order', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { allowed: [BUILD_RULE, OWN_RULE, VIEW_RULE, CLOSE_RULE] });

  await ok(disallow(box, [CLOSE_RULE, BUILD_RULE]));

  assert.deepEqual(await ownAllow(box, bots), [OWN_RULE, VIEW_RULE]);
  assert.deepEqual(await ownSettings(box, bots), [OWN_RULE, VIEW_RULE]);
});

// ----------------------------------------------------------------- the Claude settings file

test('D2 the rule leaves the settings file; the user\'s own entries, their order and every other key stay as they were', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { allowed: [BUILD_RULE, OWN_RULE, CLOSE_RULE] });
  // The kit's hook is in the file already; the user's own entries and keys go round the kit's rules.
  const settings = await settingsIn(bots, BOT);
  const theirs = {
    ...settings,
    permissions: {
      allow: ['Bash(npm test:*)', BUILD_RULE, FOREIGN_RULE, OWN_RULE, 'Bash(git status)', CLOSE_RULE],
      deny: ['Bash(rm -rf:*)'],
      ask: ['Bash(git push:*)'],
      defaultMode: 'default',
    },
    env: { MY_KEY: 'mine' },
    theme: 'dark',
  };
  await writeSettings(bots, theirs);

  await ok(disallow(box, [OWN_RULE]));

  const expected = structuredClone(theirs);
  expected.permissions.allow = ['Bash(npm test:*)', BUILD_RULE, FOREIGN_RULE, 'Bash(git status)', CLOSE_RULE];
  assert.deepEqual(await settingsIn(bots, BOT), expected, 'only the rule taken back is gone; the hook and every other key are as they were');
});

test('D2 every entry of that exact text leaves the settings file, a second copy the user added by hand included', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { allowed: [BUILD_RULE, OWN_RULE] });
  await handAllow(bots, [OWN_RULE, BUILD_RULE, FOREIGN_RULE, OWN_RULE]);

  await ok(disallow(box, [OWN_RULE]));

  assert.deepEqual(await allowedIn(bots, BOT), [BUILD_RULE, FOREIGN_RULE]);
});

test('D2 permission disallow adds nothing to the settings file, not even a rule allow holds that the file lacks', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { allowed: [BUILD_RULE, OWN_RULE, CLOSE_RULE] });
  // CLOSE_RULE and the kit's defaults taken out of the file by hand: allow still holds them.
  await handAllow(bots, [BUILD_RULE, OWN_RULE]);

  await ok(disallow(box, [OWN_RULE]));

  assert.deepEqual(await ownAllow(box, bots), [BUILD_RULE, CLOSE_RULE]);
  assert.deepEqual(await allowedIn(bots, BOT), [BUILD_RULE], `neither ${CLOSE_RULE} nor a default is written back by a take-back`);
});

test('D2 another spelling of the rule in the settings file is the user\'s and stays: only the exact text leaves', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { allowed: [OWN_RULE] });
  await handAllow(bots, [OWN_RULE_SPACED, OWN_RULE]);

  await ok(disallow(box, [OWN_RULE]));

  assert.deepEqual(await allowedIn(bots, BOT), [OWN_RULE_SPACED], 'only that exact text leaves the file');
});

// ----------------------------------------------------------------- no settings file, or one without the rule

test('D3 with no settings file, the rule still leaves allow, and no settings file is made', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { allowed: [BUILD_RULE, OWN_RULE] });
  await rm(settingsOf(bots, BOT));

  await ok(disallow(box, [OWN_RULE]));

  assert.deepEqual(await ownAllow(box, bots), [BUILD_RULE]);
  assert.equal(await settingsIn(bots, BOT), undefined, `${settingsOf(bots, BOT)} should not have been made`);
});

test('D3 with a settings file that does not hold the rule, the rule still leaves allow, and the file keeps what it had', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { allowed: [BUILD_RULE, OWN_RULE] });
  await handAllow(bots, [FOREIGN_RULE, BUILD_RULE]);
  const was = await settingsIn(bots, BOT);

  await ok(disallow(box, [OWN_RULE]));

  assert.deepEqual(await ownAllow(box, bots), [BUILD_RULE]);
  assert.deepEqual(await settingsIn(bots, BOT), was);
});

// ----------------------------------------------------------------- a bot on Codex

test('D4 for a Codex bot, obk.rules is rewritten from what allow still holds: the rule\'s line goes, the others stay in order', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { harness: 'codex', allowed: [BUILD_RULE, OWN_RULE, CLOSE_RULE] });
  assert.deepEqual(await ownLines(box, bots), [BUILD_LINE, OWN_LINE, CLOSE_LINE], 'the premise: obk.rules holds all three');

  await ok(disallow(box, [OWN_RULE]));

  assert.deepEqual(await ownAllow(box, bots), [BUILD_RULE, CLOSE_RULE]);
  assert.deepEqual(await ownLines(box, bots), [BUILD_LINE, CLOSE_LINE]);
  const lines = withoutSendMessage(await codexAllowedIn(bots, BOT));
  assertSameRules(lines.filter((line) => codexDefaultLines(box, bots).includes(line)), codexDefaultLines(box, bots), 'the default lines stay');
  assert.equal(await settingsIn(bots, BOT), undefined, 'a bot only on Codex gets no Claude settings from a take-back');
});

test('D4 a line another rule still in allow gives stays in obk.rules', async (t) => {
  // `Bash(gh pr merge:*)` and `Bash(gh pr merge *)` both become the same line.
  const box = await createSandbox(t);
  const bots = await withBot(box, { harness: 'codex', allowed: [OWN_RULE, OWN_RULE_SPACED, BUILD_RULE] });
  assert.deepEqual(await ownLines(box, bots), [OWN_LINE, BUILD_LINE], 'the premise: one line for the two spellings');

  await ok(disallow(box, [OWN_RULE]));

  assert.deepEqual(await ownAllow(box, bots), [OWN_RULE_SPACED, BUILD_RULE]);
  assert.deepEqual(await ownLines(box, bots), [OWN_LINE, BUILD_LINE], `${OWN_RULE_SPACED} still gives the line`);
});

test('D4 another .rules file in the bot\'s .codex/rules is untouched, byte for byte and mtime', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { harness: 'codex', allowed: [OWN_RULE, CLOSE_RULE] });
  const theirs = path.join(botHomeOf(bots, BOT), '.codex', 'rules', 'default.rules');
  const text = `# mine\n${OWN_LINE}\nprefix_rule(pattern=["make"], decision="allow")\n`;
  await writeFile(theirs, text);
  await utimes(theirs, PAST, PAST);

  await ok(disallow(box, [OWN_RULE]));

  assert.deepEqual(await ownLines(box, bots), [CLOSE_LINE], 'the premise: the take-back happened');
  assert.equal(await readFile(theirs, 'utf8'), text, 'the user\'s own rules file, the same line in it included');
  assert.equal((await stat(theirs)).mtime.getTime(), PAST.getTime(), 'not even written back the same');
});

test('D4 a bot on both harnesses loses the rule from its Claude settings and from its obk.rules', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { harness: 'codex', sessions: BOTH, allowed: [BUILD_RULE, OWN_RULE] });
  assert.deepEqual(await ownSettings(box, bots), [BUILD_RULE, OWN_RULE], 'the premise: the Claude settings hold both');
  assert.deepEqual(await ownLines(box, bots), [BUILD_LINE, OWN_LINE], 'the premise: obk.rules holds both');

  await ok(disallow(box, [OWN_RULE]));

  assert.deepEqual(await ownSettings(box, bots), [BUILD_RULE]);
  assert.deepEqual(await ownLines(box, bots), [BUILD_LINE]);
});

// ----------------------------------------------------------------- a rule allow does not hold

test('D5 permission disallow of a rule allow does not hold is refused, naming it, and a hand-added copy in the settings file stays', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { allowed: [OWN_RULE] });
  await handAllow(bots, [OWN_RULE, FOREIGN_RULE]);
  const before = await snapshot(bots, skipGit);

  const result = await disallow(box, [FOREIGN_RULE]);

  assertRefusedNaming(result, FOREIGN_RULE);
  await assertNothingChanged(bots, before);
  assert.deepEqual(await allowedIn(bots, BOT), [OWN_RULE, FOREIGN_RULE], 'the user\'s own entry stays theirs');
});

test('D5 a rule is taken back only as allow spells it: another spelling of it is refused', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { allowed: [OWN_RULE] });
  const before = await snapshot(bots, skipGit);

  const result = await disallow(box, [OWN_RULE_SPACED]);

  assertRefusedNaming(result, OWN_RULE_SPACED);
  await assertNothingChanged(bots, before);
});

test('D5 one rule allow holds beside one it does not: the whole run is refused, and the held one stays', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { allowed: [OWN_RULE, CLOSE_RULE] });
  const before = await snapshot(bots, skipGit);

  const result = await disallow(box, [OWN_RULE, FOREIGN_RULE]);

  assertRefusedNaming(result, FOREIGN_RULE);
  await assertNothingChanged(bots, before);
});

test('D5 for a Codex bot, a rule allow does not hold is refused, and obk.rules is as it was', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { harness: 'codex', allowed: [OWN_RULE] });
  const before = await snapshot(bots, skipGit);

  const result = await disallow(box, [CLOSE_RULE]);

  assertRefusedNaming(result, CLOSE_RULE);
  await assertNothingChanged(bots, before);
});

// ----------------------------------------------------------------- an empty rule, no rule, a rule twice

for (const [label, rules] of [
  ['an empty --rule', ['']],
  ['an empty --rule beside a good one', [OWN_RULE, '']],
]) {
  test(`D6 ${label} is refused, and nothing changes; the good one alone then goes through`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, { allowed: [OWN_RULE, CLOSE_RULE] });
    const before = await snapshot(bots, skipGit);

    const result = await disallow(box, rules);

    assertRefusedNaming(result, '--rule');
    await assertNothingChanged(bots, before);
    // The contrast: the same command without the empty rule is taken.
    await ok(disallow(box, [OWN_RULE]));
    assert.deepEqual(await ownAllow(box, bots), [CLOSE_RULE]);
  });
}

for (const command of ['disallow', 'allow']) {
  test(`D6 permission ${command} with no --rule is refused, naming --rule, and nothing changes`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, { allowed: [OWN_RULE] });
    const before = await snapshot(bots, skipGit);

    const result = await box.run(['permission', command, '--bots', 'bots', '--bot', BOT]);

    assertRefusedNaming(result, '--rule');
    await assertNothingChanged(bots, before);
  });
}

test('D6 the same rule given twice is taken out once, and disallowed names it once', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { allowed: [OWN_RULE, CLOSE_RULE] });

  const answer = jsonOf(await disallow(box, [OWN_RULE, OWN_RULE], '--json'));

  assert.deepEqual(answer.disallowed, [OWN_RULE]);
  assert.deepEqual(beyond(box, bots, answer.allow), [CLOSE_RULE]);
  assert.deepEqual(await ownAllow(box, bots), [CLOSE_RULE]);
  assert.deepEqual(await ownSettings(box, bots), [CLOSE_RULE]);
});

// ----------------------------------------------------------------- bot change no longer takes a rule back

for (const [label, args] of [
  ['bot change --disallow', ['--disallow', OWN_RULE]],
  ['bot change --charter with --disallow', ['--charter', NEW_CHARTER, '--disallow', OWN_RULE]],
  ['bot change --allow with --disallow', ['--allow', CLOSE_RULE, '--disallow', OWN_RULE]],
]) {
  test(`D7 ${label} is refused, names obk permission disallow, and nothing changes, the charter included`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, { allowed: [OWN_RULE] });
    const before = await snapshot(bots, skipGit);

    const result = await change(box, ...args);

    assertRefusedNaming(result, 'permission disallow');
    await assertNothingChanged(bots, before);
    assert.equal(parse(await botText(bots)).charter.trim(), CHARTER, 'the charter is the one it had');
    // The road it names goes through.
    await ok(disallow(box, [OWN_RULE]));
    assert.deepEqual(await ownAllow(box, bots), []);
  });
}

// ----------------------------------------------------------------- a rule of the kit's default set

/** Some rules of the default set, one of each kind: a kit command, the Read rule, git, Orca. */
const someDefaults = (box, bots) => {
  const all = defaultRules(box, bots);
  return [
    all.find((rule) => rule.includes(' message check --bots ')),
    all.find((rule) => rule.includes(' temp make --bots ')),
    readDefault(box, bots),
    'Bash(git commit:*)',
    ORCA_CHECK_RULE,
  ];
};

/** A refusal of a default rule: names the rule, and says it is one of the kit's defaults. */
function assertRefusedAsDefault(result, rule) {
  assertRefusedNaming(result, rule);
  assert.match(result.stderr, /default/i, `the refusal should say ${rule} is one of the kit's default rules, got:\n${result.stderr}`);
}

test('D9 permission disallow of a rule in the kit\'s default set is refused, saying it is a default, and nothing changes', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { allowed: [OWN_RULE] });
  const before = await snapshot(bots, skipGit);

  for (const rule of someDefaults(box, bots)) {
    assert.ok((await allowOf(bots, BOT)).includes(rule), `the premise: ${BOT}'s allow holds the default ${rule}`);

    const result = await disallow(box, [rule]);

    assertRefusedAsDefault(result, rule);
    await assertNothingChanged(bots, before);
  }
});

test('D9 a default rule beside an own rule the bot holds: the whole run is refused, and the own rule stays', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { allowed: [OWN_RULE, CLOSE_RULE] });
  const [check] = someDefaults(box, bots);
  const before = await snapshot(bots, skipGit);

  const result = await disallow(box, [OWN_RULE, check]);

  assertRefusedAsDefault(result, check);
  await assertNothingChanged(bots, before);
  assert.deepEqual(await ownAllow(box, bots), [OWN_RULE, CLOSE_RULE]);
});

test('D9 for a bot only on Codex, permission disallow of a default rule is refused, and obk.rules is as it was', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { harness: 'codex', allowed: [OWN_RULE] });
  const before = await snapshot(bots, skipGit);

  for (const rule of [codexDefaultRules(box, bots).find((one) => one.includes(' temp retire --bots ')), 'Bash(git add:*)']) {
    assert.ok((await allowOf(bots, BOT)).includes(rule), `the premise: ${BOT}'s allow holds the default ${rule}`);

    const result = await disallow(box, [rule]);

    assertRefusedAsDefault(result, rule);
    await assertNothingChanged(bots, before);
  }
});

// ----------------------------------------------------------------- a settings file that cannot be safely changed

/** What a user keeps in their own settings, outside every bot. */
const USERS_OWN = `${JSON.stringify({ permissions: { allow: [OWN_RULE, 'Bash(git status)'] }, theme: 'dark' }, null, 2)}\n`;

test('D8 a settings file that links outside the bot folder is refused by name; nothing changes, and the user\'s file is untouched', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { allowed: [OWN_RULE, CLOSE_RULE] });
  const file = settingsOf(bots, BOT);
  const target = path.join(box.home, '.claude', 'settings.json');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, USERS_OWN);
  await rm(file, { force: true });
  await symlink(target, file);
  const before = await snapshot(bots, skipGit);

  const result = await disallow(box, [OWN_RULE]);

  assertRefused(result, file);
  await assertNothingChanged(bots, before);
  assert.equal(await readFile(target, 'utf8'), USERS_OWN, 'the user\'s own settings, byte for byte');
  assert.equal(await readlink(file), target, 'and the link is left as they made it');
});

for (const [label, text] of [
  ['not valid JSON', `{ "permissions": { "allow": [${JSON.stringify(OWN_RULE)}] `],
  ['a permissions that is a list', `${JSON.stringify({ permissions: [OWN_RULE] }, null, 2)}\n`],
  ['a permissions that is a line of text', `${JSON.stringify({ permissions: OWN_RULE }, null, 2)}\n`],
  ['a permissions.allow that is a line of text', `${JSON.stringify({ permissions: { allow: OWN_RULE } }, null, 2)}\n`],
  ['a permissions.allow that is a mapping', `${JSON.stringify({ permissions: { allow: { rule: OWN_RULE } } }, null, 2)}\n`],
]) {
  test(`D8 a settings file with ${label} is refused by name, and nothing changes, bot.yaml included`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, { allowed: [OWN_RULE, CLOSE_RULE] });
    const file = settingsOf(bots, BOT);
    await writeFile(file, text);
    const before = await snapshot(bots, skipGit);

    const result = await disallow(box, [OWN_RULE]);

    assertRefused(result, file);
    await assertNothingChanged(bots, before);
    assert.deepEqual(await ownAllow(box, bots), [OWN_RULE, CLOSE_RULE], 'the rule is still allowed');
  });
}

// ----------------------------------------------------------------- an allow in bot.yaml that is not a list of rules

for (const [label, value] of [
  ['a line of text', OWN_RULE],
  ['a list holding a number', [OWN_RULE, 42]],
  ['a list holding an empty string', [OWN_RULE, '']],
  ['a list holding a mapping', [OWN_RULE, { rule: CLOSE_RULE }]],
  ['a mapping', { rule: OWN_RULE }],
]) {
  test(`D8 an allow in bot.yaml that is ${label} is refused, naming the bot.yaml, and nothing changes`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, { allowed: [OWN_RULE] });
    const doc = parse(await botText(bots));
    doc.allow = value;
    await writeFile(botYamlOf(bots, BOT), stringify(doc));
    const before = await snapshot(bots, skipGit);

    const result = await disallow(box, [OWN_RULE]);

    assertRefusedNaming(result, botYamlOf(bots, BOT), 'allow');
    await assertNothingChanged(bots, before);
  });
}

test('D8 an unknown bot is refused, naming it, and nothing changes', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { allowed: [OWN_RULE] });
  const before = await snapshot(bots, skipGit);

  const result = await permissionDisallow(box, 'nobody-bot', [OWN_RULE]);

  assertRefusedNaming(result, 'nobody-bot');
  await assertNothingChanged(bots, before);
});

// ----------------------------------------------------------------- a harness file the kit cannot write

// Found in the review of PR #380: the refusal comes before anything is
// written, so a file the kit cannot write leaves bot.yaml as it was too.
for (const [label, harness, fileOf, holds] of [
  ['the Claude settings file', 'claude', settingsOf, async (bots) => (await allowedIn(bots, BOT)).includes(OWN_RULE)],
  ['a Codex bot\'s obk.rules', 'codex', codexRulesOf, async (bots) => (await codexAllowedIn(bots, BOT)).includes(OWN_LINE)],
]) {
  test(`D15 ${label} read-only: permission disallow is refused and nothing changes; with write access back, it goes through`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, { harness, allowed: [BUILD_RULE, OWN_RULE] });
    const file = fileOf(bots, BOT);
    assert.ok(await holds(bots), `the premise: ${file} holds the rule`);
    await chmod(file, 0o444);
    t.after(() => chmod(file, 0o644).catch(() => {}));
    const before = await snapshot(bots, skipGit);

    const result = await disallow(box, [OWN_RULE]);

    assert.notEqual(result.code, 0, `a file the kit cannot write should be refused, got:\n${result.stdout}${result.stderr}`);
    assert.ok(!/^\s+at /m.test(`${result.stdout}${result.stderr}`), `expected a message, got a crash:\n${result.stderr}`);
    await assertNothingChanged(bots, before);
    assert.deepEqual(await ownAllow(box, bots), [BUILD_RULE, OWN_RULE], 'allow still holds the rule');
    assert.ok(await holds(bots), `${file} still holds the rule`);

    await chmod(file, 0o644);
    await ok(disallow(box, [OWN_RULE]));
    assert.deepEqual(await ownAllow(box, bots), [BUILD_RULE]);
    assert.ok(!(await holds(bots)), `the rule should have left ${file}`);
  });
}

// A bot.yaml the kit cannot write is refused the same way, before a harness
// file is touched.
for (const [label, harness, fileOf, holds, restart] of [
  ['a Claude bot', 'claude', settingsOf, async (bots) => (await allowedIn(bots, BOT)).includes(OWN_RULE), false],
  ['a Codex bot', 'codex', codexRulesOf, async (bots) => (await codexAllowedIn(bots, BOT)).includes(OWN_LINE), true],
]) {
  test(`D18 ${label} with a read-only bot.yaml: permission disallow is refused and nothing changes; with write access back, it goes through`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, { harness, allowed: [BUILD_RULE, OWN_RULE] });
    const yamlFile = botYamlOf(bots, BOT);
    const file = fileOf(bots, BOT);
    assert.ok(await holds(bots), `the premise: ${file} holds the rule`);
    await chmod(yamlFile, 0o444);
    t.after(() => chmod(yamlFile, 0o644).catch(() => {}));
    const before = await snapshot(bots, skipGit);

    const result = await disallow(box, [OWN_RULE]);

    assert.notEqual(result.code, 0, `a bot.yaml the kit cannot write should be refused, got:\n${result.stdout}${result.stderr}`);
    assert.ok(!/^\s+at /m.test(`${result.stdout}${result.stderr}`), `expected a message, got a crash:\n${result.stderr}`);
    await assertNothingChanged(bots, before);
    assert.deepEqual(await ownAllow(box, bots), [BUILD_RULE, OWN_RULE], 'allow still holds the rule');
    assert.ok(await holds(bots), `${file} still holds the rule`);

    await chmod(yamlFile, 0o644);
    const retry = await ok(disallow(box, [OWN_RULE]));
    assert.deepEqual(await ownAllow(box, bots), [BUILD_RULE]);
    assert.ok(!(await holds(bots)), `the rule should have left ${file}`);
    if (restart) assert.ok(retry.stdout.includes('obk restart'), `a Codex line left, so say obk restart, got:\n${retry.stdout}`);
  });
}

// ----------------------------------------------------------------- a bot.yaml edit that cannot be made

test('D16 permission disallow changes nothing when allow carries an anchor another key uses', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { allowed: [BUILD_RULE, OWN_RULE] });
  // A valid bot.yaml, edited by hand: allow is anchored and a key of the user's own is an alias of it.
  const doc = parseDocument(await botText(bots));
  const allowNode = doc.get('allow', true);
  allowNode.anchor = 'grants';
  doc.set('notes', doc.createAlias(allowNode, 'grants'));
  await writeFile(botYamlOf(bots, BOT), String(doc));
  const text = await botText(bots);
  assert.ok(text.includes('&grants') && text.includes('*grants'), `the premise: an anchor and its alias, got:\n${text}`);
  assert.deepEqual(parse(text).notes, parse(text).allow, 'the premise: the file is valid and the alias reads as allow');
  const before = await snapshot(bots, skipGit);

  const result = await disallow(box, [OWN_RULE]);

  assert.notEqual(result.code, 0, `the edit cannot be made, so the run should be refused, got:\n${result.stdout}${result.stderr}`);
  assert.ok(!/^\s+at /m.test(`${result.stdout}${result.stderr}`), `expected a message, got a crash:\n${result.stderr}`);
  await assertNothingChanged(bots, before);
  assert.equal(parse(await botText(bots)).charter.trim(), CHARTER, 'the charter is the one it had');
});

// ----------------------------------------------------------------- obk restart, when a Codex line leaves

test('D17 a line leaving obk.rules: the plain report says obk restart', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { harness: 'codex', allowed: [BUILD_RULE, OWN_RULE] });

  const result = await ok(disallow(box, [OWN_RULE]));

  assert.deepEqual(await ownLines(box, bots), [BUILD_LINE], 'the premise: the line left');
  assert.ok(result.stdout.includes('obk restart'), `a running Codex session keeps the rule until it restarts, so say obk restart, got:\n${result.stdout}`);
});

test('D17 the bot\'s last own line leaving obk.rules: the plain report says obk restart, and only the defaults\' lines are left', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { harness: 'codex', allowed: [OWN_RULE] });
  assert.deepEqual(await ownLines(box, bots), [OWN_LINE], 'the premise: obk.rules holds the one own line');

  const result = await ok(disallow(box, [OWN_RULE]));

  assert.deepEqual(await ownAllow(box, bots), []);
  assert.deepEqual(await ownLines(box, bots), [], 'no own line should be left');
  assert.ok(result.stdout.includes('obk restart'), `a running Codex session keeps the rule until it restarts, so say obk restart, got:\n${result.stdout}`);
});

for (const [label, options, allowed] of [
  ['the line stays because another rule gives it', { harness: 'codex' }, [OWN_RULE, OWN_RULE_SPACED]],
  ['a Claude-only bot', {}, [BUILD_RULE, OWN_RULE]],
]) {
  test(`D17 no line leaving obk.rules (${label}): the plain report does not say obk restart`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, { ...options, allowed });

    const result = await ok(disallow(box, [OWN_RULE]));

    assert.ok(!(await allowOf(bots, BOT)).includes(OWN_RULE), 'the premise: the rule left allow');
    assert.ok(!result.stdout.includes('obk restart'), `no Codex line left, so nothing to restart for, got:\n${result.stdout}`);
  });
}

// ----------------------------------------------------------------- the report

test('D11 --json carries allow, the whole list now, and disallowed, the rules taken out in the order given', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { allowed: [BUILD_RULE, OWN_RULE, CLOSE_RULE, VIEW_RULE] });

  const answer = jsonOf(await disallow(box, [CLOSE_RULE, BUILD_RULE, CLOSE_RULE], '--json'));

  assert.deepEqual(answer.disallowed, [CLOSE_RULE, BUILD_RULE]);
  assert.deepEqual(beyond(box, bots, answer.allow), [OWN_RULE, VIEW_RULE]);
  assert.deepEqual(withoutSendMessage(answer.allow), withoutSendMessage(await allowOf(bots, BOT)), 'the answer says what the file holds, the defaults included');
  await assertDefaultsKept(box, bots);
});

test('D11 the plain report names each rule taken out, word for word', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { allowed: [BUILD_RULE, OWN_RULE, CLOSE_RULE] });

  const result = await disallow(box, [OWN_RULE, CLOSE_RULE]);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  for (const rule of [OWN_RULE, CLOSE_RULE]) {
    assert.ok(result.stdout.includes(rule), `the report should name ${rule}, got:\n${result.stdout}`);
  }
  assert.deepEqual(await ownAllow(box, bots), [BUILD_RULE]);
});

// ----------------------------------------------------------------- health afterwards

for (const [label, options] of [
  ['a Claude bot', {}],
  ['a Codex bot', { harness: 'codex' }],
  ['a bot on both harnesses', { harness: 'codex', sessions: BOTH }],
]) {
  test(`D12 after a take-back, health has no finding about the rule for ${label}`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, { ...options, allowed: [BUILD_RULE, OWN_RULE] });

    // Findings about the rule, its Codex line, or the files it lives in.
    const aboutIt = (found) => found.filter((one) => one.bot === BOT
      && [OWN_RULE, OWN_LINE, settingsOf(bots, BOT), codexRulesOf(bots, BOT)].some((text) => `${one.says} ${one.where}`.includes(text)));
    assert.deepEqual(aboutIt(await healthFindings(box)), [], 'the premise: with the rule allowed and written, health has nothing to say about it');

    await ok(disallow(box, [OWN_RULE]));

    assert.deepEqual(await ownAllow(box, bots), [BUILD_RULE], 'the premise: the rule left allow');
    const about = aboutIt(await healthFindings(box));
    assert.deepEqual(about, [], `nothing should be left to say about ${OWN_RULE}, got: ${JSON.stringify(about, null, 2)}`);
  });
}

// ----------------------------------------------------------------- the charter change points at permission disallow

test('D13 a charter change for a bot with rules beyond the defaults says how to take one back: obk permission disallow', async (t) => {
  const box = await createSandbox(t);
  await withBot(box, { allowed: [OWN_RULE] });

  const result = await change(box, '--charter', NEW_CHARTER);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.ok(result.stdout.includes(OWN_RULE), `the premise: the report names ${OWN_RULE}, got:\n${result.stdout}`);
  assert.ok(result.stdout.includes('permission disallow'), `the report should say how to take a rule back, got:\n${result.stdout}`);
  assert.doesNotMatch(result.stdout, /bot change[^\n]*--disallow/, `and not offer bot change --disallow, which is refused now, got:\n${result.stdout}`);
});

// ----------------------------------------------------------------- help

test('D14 --help lists obk permission disallow, with --rule', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['--help']);

  assert.equal(result.code, 0, result.stderr);
  const lines = result.stdout.split('\n');
  const from = lines.findIndex((line) => line.includes('obk permission disallow'));
  assert.notEqual(from, -1, `--help should list obk permission disallow, got:\n${result.stdout}`);
  const to = lines.findIndex((line, at) => at > from && /^\s*obk /.test(line));
  const block = lines.slice(from, to === -1 ? undefined : to).join('\n');
  assert.ok(block.includes('--rule'), `permission disallow's entry should list --rule, got:\n${block}`);
});
