// Reading and writing what #344 slice A is about, as #527 changed it: the
// Claude Code permission rules the kit writes into a bot's own
// `.claude/settings.json`, the `allow` list in `bot.yaml`, and the kit's own
// default rules, which it writes for every bot with nobody asked.
//
// The default set is spelled here from the requirement, not from the code: the
// kit's CLI as it names itself in the commands it prints (`box.cli`, as
// `shellWord` spells it), and the bots folder as the command was given it,
// absolute. Many test files need the same set and the same reading, so it
// lives here and nowhere else.
//
// #354 (slice C) writes the same rules for a bot that runs on Codex, in Codex's
// own form, into `<bot home>/.codex/rules/obk.rules`: one
// `prefix_rule(pattern=[...], decision="allow")` line per rule, each word a
// JSON string. The Codex lines are spelled here from that requirement too.
//
// #527: the set holds no order the tests may rely on, except that rules
// already in a bot's `allow` keep their place. A SendMessage rule may or may
// not be in it (still being settled), so every reading here leaves SendMessage
// rules out before it compares.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';

import { botHomeOf, hookFileOf, hooksIn, shellWord } from './cli.js';
import { botYamlOf } from './skills.js';

/**
 * The kit's commands every bot is allowed, each narrowed to the bots folder
 * (#527): every command but `init`, `retire`, `pause` and the three
 * `permission` commands.
 */
export const KIT_COMMANDS = [
  'up', 'restart', 'unpause', 'health', 'groom', 'roster', 'usage',
  'bot create', 'bot change', 'rules build',
  'skills add', 'skills remove', 'skills build', 'skills fetch', 'skills update', 'source add',
  'session add', 'session change', 'session clear', 'session compact',
  'message to', 'message send', 'message check',
  'session record', 'session sent', 'session nudge', 'session mail', 'session name', 'session mailbox',
  'temp make', 'temp roles', 'temp retire', 'temp trust-hooks', 'temp answer',
];

/** The kit's commands that are never in the default set: they keep the user's yes (#527). */
export const NOT_DEFAULT_COMMANDS = ['init', 'retire', 'pause', 'permission allow', 'permission disallow', 'permission approval'];

/** The one Orca rule in the default set, exactly this text (#527). */
export const ORCA_CHECK_RULE = 'Bash(orca orchestration check --run:*)';

/** The Claude rule that allows one kit command for this bots folder: `Bash(<CLI> <command> --bots <folder>:*)`. */
export const kitRule = (box, bots, command) => `Bash(${shellWord(box.cli)} ${command} --bots ${shellWord(bots)}:*)`;

/**
 * The rules every Claude bot is given (#527): one per kit command in
 * KIT_COMMANDS, reading long message bodies beside the bots folder (`//` is
 * Claude's absolute-path form, and the path there is plain, not shell-quoted),
 * the commit rule, and Orca's orchestration check. No order is promised.
 */
export function defaultRules(box, bots) {
  return [
    ...KIT_COMMANDS.map((command) => kitRule(box, bots, command)),
    `Read(/${bots}.messages/**)`,
    'Bash(git add:*)',
    'Bash(git commit:*)',
    ORCA_CHECK_RULE,
  ];
}

/** The Read rule of the set: the one a Codex-only bot is not given. */
export const readDefault = (box, bots) => `Read(/${bots}.messages/**)`;

/**
 * The rules a bot that runs only on Codex is given: the set without the Read
 * rule, since Codex's sandbox reads every file already.
 */
export const codexDefaultRules = (box, bots) => defaultRules(box, bots).filter((rule) => !rule.startsWith('Read('));

/** The rules of the set for kit commands that are never in it: what a test checks is absent. */
export const notDefaultRules = (box, bots) => NOT_DEFAULT_COMMANDS.map((command) => kitRule(box, bots, command));

/**
 * One line of a Codex rules file that allows commands starting with `words`,
 * as the requirement spells it: each word a JSON string literal, joined by
 * `, `.
 */
export const prefixRule = (words) => `prefix_rule(pattern=[${words.map((word) => JSON.stringify(word)).join(', ')}], decision="allow")`;

/**
 * The Codex lines for the default Bash rules. The CLI and the bots folder are
 * plain words here, whatever quoting `shellWord` gave them inside the Claude
 * rule.
 */
export const codexDefaultLines = (box, bots) => [
  ...KIT_COMMANDS.map((command) => prefixRule([box.cli, ...command.split(' '), '--bots', bots])),
  prefixRule(['git', 'add']),
  prefixRule(['git', 'commit']),
  prefixRule(['orca', 'orchestration', 'check', '--run']),
];

/** Whether a rule, or a Codex line, is about SendMessage: the one the tests neither require nor forbid. */
export const isSendMessage = (rule) => typeof rule === 'string' && rule.includes('SendMessage');

/** A list without its SendMessage rules. */
export const withoutSendMessage = (rules) => rules.filter((rule) => !isSendMessage(rule));

/** A list without SendMessage rules, sorted: for comparing sets where no order is promised. */
export const asSet = (rules) => withoutSendMessage(rules).sort();

/**
 * `actual` holds exactly the rules of `expected`, each once, in any order,
 * whatever SendMessage rule it holds besides.
 */
export function assertSameRules(actual, expected, message) {
  assert.deepEqual(asSet([...actual]), [...expected].sort(), message ?? `the rules should be exactly these, in any order:\n${JSON.stringify([...expected].sort(), null, 2)}\ngot:\n${JSON.stringify(actual, null, 2)}`);
}

/**
 * An `allow` list after the kit added what it lacked of `defaults`: the
 * entries already there first, as they were and in their order, then the
 * missing defaults, each once, in any order. SendMessage rules aside.
 */
export function assertDefaultsAppended(allow, before, defaults, message = '') {
  const list = withoutSendMessage(allow);
  const kept = withoutSendMessage(before);
  assert.deepEqual(list.slice(0, kept.length), kept, `${message}the entries already there should keep their place, first, got:\n${JSON.stringify(allow, null, 2)}`);
  const missing = defaults.filter((rule) => !kept.includes(rule));
  assertSameRules(list.slice(kept.length), missing, `${message}after them, exactly the defaults that were missing, each once:\n${JSON.stringify([...missing].sort(), null, 2)}\ngot:\n${JSON.stringify(allow, null, 2)}`);
}

/**
 * The line a text answer gives for each default rule the kit added to a bot:
 * `allowed`, padded to 9 characters, two spaces, the bot, two spaces, the rule.
 */
export const addedLine = (bot, rule) => `${'allowed'.padEnd(9)}  ${bot}  ${rule}`;

/** The `allowed <bot> <rule>` lines of a text answer, each trimmed: every one, about any bot. */
export const addedLinesIn = (stdout) => stdout.split('\n').map((line) => line.trim()).filter((line) => line.startsWith(`${'allowed'.padEnd(9)}  `));

/** Each of `rules` named for `bot` on a line of its own, word for word, and no other `allowed` line about `bot` but SendMessage. */
export function assertAddedLines(stdout, bot, rules) {
  const lines = addedLinesIn(stdout).filter((line) => line.startsWith(`${'allowed'.padEnd(9)}  ${bot}  `));
  assertSameRules(lines.map((line) => line.slice(`${'allowed'.padEnd(9)}  ${bot}  `.length)), rules, `one line \`${addedLine(bot, '<rule>')}\` for each default rule added to ${bot}, word for word, got:\n${stdout}`);
}

/**
 * An answer that offers no wait for a yes: no `waiting` line, no sentence
 * that says a rule waits for the user's yes, and no command offered to allow
 * the defaults.
 */
export function assertNothingWaits(stdout) {
  const lines = stdout.split('\n');
  assert.deepEqual(lines.filter((line) => line.trim().startsWith('waiting')), [], `no rule waits, so no waiting line, got:\n${stdout}`);
  assert.deepEqual(lines.filter((line) => /wait[a-z]*\b.*\byes\b/i.test(line)), [], `no line should say a rule waits for the user's yes, got:\n${stdout}`);
  assert.ok(!/--allow\b|--rule\b/.test(stdout), `no command to allow the defaults should be offered, got:\n${stdout}`);
}

/** A `permissions` entry offers no waiting list of the defaults: none, or an empty one. */
export function assertEntryWaitsForNothing(entry) {
  assert.ok(entry.waiting === undefined || (Array.isArray(entry.waiting) && entry.waiting.length === 0), `no waiting list of the defaults should be offered, got: ${JSON.stringify(entry)}`);
}

/** The `defaults` of a `permissions` entry: the default rules this run added to the bot's `allow`. */
export function defaultsOf(entry) {
  assert.ok(Array.isArray(entry.defaults), `each permissions entry should carry defaults, a list, got: ${JSON.stringify(entry)}`);
  return entry.defaults;
}

/** The bot's own Codex rules file, which the kit owns whole. */
export const codexRulesOf = (bots, bot) => path.join(botHomeOf(bots, bot), '.codex', 'rules', 'obk.rules');

/**
 * The rule lines of a Codex rules file, in the file's order: every line but
 * blank ones and `#` comments. Undefined when there is no file.
 */
export async function codexLinesIn(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
  return text.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#'));
}

/** The rule lines of the bot's obk.rules: an empty list for no file. */
export const codexAllowedIn = async (bots, bot) => (await codexLinesIn(codexRulesOf(bots, bot))) ?? [];

/** A rule no default is: one a user might say yes to for one bot of their own. */
export const OWN_RULE = 'Bash(gh pr merge:*)';

/** A rule nobody said yes to, as a hand edit might leave it in the settings file. */
export const FOREIGN_RULE = 'Bash(curl:*)';

/**
 * The one command that allows `rules` for `bot` (#527): the kit's CLI,
 * `permission allow`, the bots folder and the bot, then one `--rule` per rule,
 * each word as `shellWord` gives it.
 */
export const allowCommand = (box, bots, bot, rules) => [
  shellWord(box.cli), 'permission', 'allow', '--bots', shellWord(bots), '--bot', shellWord(bot),
  ...rules.flatMap((rule) => ['--rule', shellWord(rule)]),
].join(' ');

/** Run `obk permission allow` for `bot` with one `--rule` per rule, in the folder `folder` names from the sandbox. */
export const permissionAllow = (box, bot, rules, { folder = 'bots', extra = [] } = {}) =>
  box.run(['permission', 'allow', '--bots', folder, '--bot', bot, ...rules.flatMap((rule) => ['--rule', rule]), ...extra]);

/** Run `obk permission disallow` for `bot` with one `--rule` per rule. */
export const permissionDisallow = (box, bot, rules, { folder = 'bots', extra = [] } = {}) =>
  box.run(['permission', 'disallow', '--bots', folder, '--bot', bot, ...rules.flatMap((rule) => ['--rule', rule]), ...extra]);

/** `--rule <rule>` for each rule, in order. */
export const ruling = (...rules) => rules.flatMap((rule) => ['--rule', rule]);

/**
 * Split `--approval <level>` (or `--approval=<level>`) out of a list of
 * session settings: `{ rest, approval }`, `approval` undefined when none.
 */
export function splitApproval(settings) {
  const rest = [];
  let approval;
  for (let at = 0; at < settings.length; at += 1) {
    const arg = settings[at];
    if (arg === '--approval') {
      approval = settings[at + 1];
      at += 1;
    } else if (arg.startsWith('--approval=')) {
      approval = arg.slice('--approval='.length);
    } else {
      rest.push(arg);
    }
  }
  return { rest, approval };
}

/**
 * Add a session the way a user does since #527: `session add` with every
 * setting but the approval, then `permission approval` for the approval, when
 * one is given. Answers the `session add` run, or the first run that failed.
 * `options` are `box.run`'s.
 */
export async function addSession(box, { bots = 'bots', bot, name, settings = [] }, options = {}) {
  const { rest, approval } = splitApproval(settings);
  const added = await box.run(['session', 'add', '--bots', bots, '--bot', bot, '--name', name, ...rest], options);
  if (added.code !== 0 || approval === undefined) return added;
  const set = await box.run(['permission', 'approval', '--bots', bots, '--bot', bot, '--session', name, '--approval', approval], options);
  return set.code === 0 ? added : set;
}

/** The answer of a `--json` run, parsed, with the `permissions` list the requirement gives it. */
export function jsonOf(result) {
  assert.equal(result.code, 0, `the run should have gone through, got:\n${result.stdout}${result.stderr}`);
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  assert.ok(Array.isArray(answer.permissions), `the answer should carry a permissions list, got: ${result.stdout}`);
  return answer;
}

/**
 * The one `permissions` entry about `bot` and `file`: for a bot that runs on
 * both harnesses there is one per harness file.
 */
export function entryAt(answer, bot, file) {
  const found = answer.permissions.filter((entry) => entry.bot === bot && entry.file === file);
  assert.equal(found.length, 1, `one permissions entry should be about ${bot} and ${file}, got: ${JSON.stringify(answer.permissions)}`);
  return found[0];
}

/** The bots a `permissions` list is about, in the order it gives them. */
export const permissionBots = (answer) => answer.permissions.map((entry) => entry.bot);

/** The bot's own Claude settings file. */
export const settingsOf = (bots, bot) => hookFileOf(bots, bot, 'claude');

/** The bot's Claude settings, parsed, or undefined when there is no file. */
export const settingsIn = (bots, bot) => hooksIn(bots, bot, 'claude');

/** What the bot's Claude settings allow, in the file's order: an empty list for no file or no list. */
export const allowedIn = async (bots, bot) => (await settingsIn(bots, bot))?.permissions?.allow ?? [];

/** The bot's `bot.yaml`, parsed. */
export const botYamlIn = async (bots, bot) => parse(await readFile(botYamlOf(bots, bot), 'utf8')) ?? {};

/** The yes the bot's `bot.yaml` holds: missing means none. */
export const allowOf = async (bots, bot) => (await botYamlIn(bots, bot)).allow ?? [];

/** Set `allow` in a `bot.yaml` by hand, the way a user editing the file would, and not through the kit. */
export async function writeAllow(bots, bot, allow) {
  const doc = await botYamlIn(bots, bot);
  doc.allow = allow;
  await writeFile(botYamlOf(bots, bot), stringify(doc));
}

/** Whether a plain report names `file`: by its full path, or by its path from the folder the command ran in. */
export const namesFile = (text, box, file) => text.includes(file) || text.includes(path.relative(box.cwd, file));

/** Which of `rules` appear anywhere in `text`: an empty list when none does. */
export const mentionsAny = (text, rules) => rules.filter((rule) => text.includes(rule));
