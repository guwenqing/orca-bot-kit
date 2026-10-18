// `obk health` on an allow rule that lets `obk run` run any command (#635).
//
// `obk run --timeout <s> -- <command>` (#532) runs whatever follows `--`.
// `permission allow` refuses a broad rule for it, and the default set leaves
// it out. But a rule the kit did not write can still cover it, and auto mode
// then does not judge the command. So health names each such rule ("a kit-run
// rule") in every allow list the bot's harness reads, and what to do about it.
// It edits and deletes nothing: the rule stays where it is.
//
// A kit-run rule, for Claude: an entry of `permissions.allow` that matches the
// kit's run with any command after `--`, as Claude Code matches rules
// (`x:*` and `x *` match `x` and `x <anything>`; a `*` elsewhere matches any
// text, spaces too), where the kit is `obk`, the kit's CLI path as it prints
// itself (`box.cli`, as `shellWord` spells it), or an absolute path whose last
// part is `obk`. Also a rule that names the kit's `run` and that `permission
// allow` refuses as broad (test/run-rules.test.js, RR2 and RR7). Not one: a
// default rule, a narrow run rule (RR1), a rule for another program, and
// `Bash` or `Bash(*)`, which let the bot run any command without the kit.
// For Codex: a `prefix_rule` with decision `allow` (or none) whose pattern,
// word by word, can match `<kit> run --timeout <n> -- <any command>`; an
// element of the pattern may be a list of alternatives.
//
// Where health looks, and the finding's `where`, kind `config`:
//   per bot, with `bot`:
//     a. `<home>/bot.yaml`, its `allow` list (a hand edit)
//     b. `<home>/.claude/settings.json`, an entry `allow` does not hold: still
//        the one finding that names it (test/permissions-health.test.js H1)
//     c. `<home>/.claude/settings.local.json` (a bot on Claude)
//     d. `<home>/.codex/rules/<name>.rules` other than obk.rules (a bot on
//        Codex): still the one finding that names the line (H5)
//   fleet-wide, no `bot`, named once, only when a bot runs on that harness:
//     e. `<repo root>/.claude/settings.local.json`, the repo root the nearest
//        folder above the bot homes with `.git` in it (the bots folder for a
//        fleet `init` made), unless that folder is HOME
//     f. `.codex/rules/*.rules` in each folder from the repo root down to
//        `<bots folder>/bots`
//     g. `$CLAUDE_CONFIG_DIR/settings.json`, else `$HOME/.claude/settings.json`
//     h. `$CODEX_HOME/rules/*.rules`, else `$HOME/.codex/rules/*.rules`
//     i. Codex system rules, `<P>/etc/codex/rules/*.rules` (review of PR #640)
//     j. Claude managed settings: `managed-settings.json` and each `*.json`
//        (not hidden) in `managed-settings.d/`, under `<P>/Library/Application
//        Support/ClaudeCode` on macOS and `<P>/etc/claude-code` elsewhere
//   <P> is OBK_POLICY_ROOT, a folder that stands for /, or / when it is unset.
//
// A Codex rules file is read as Codex reads it (review of PR #640): a `#`
// comment is no rule and hides no call; a call may span lines; text in a
// comment or in another argument does not change the decision; the pattern
// may come first without its name. A file with anything else in it (a name,
// an argument that is no literal) gets one finding that names the file and
// says `cannot tell`, beside the kit-run findings for what health can read.
// Claude rules are matched with a wildcard anywhere, and the kit counts behind
// a program that runs its arguments (env, node, nice); a rule that lets the
// bot run any command without the kit (`Bash(sh:*)`, `Bash(env:*)`, `Bash(o*)`)
// is not a kit-run rule.
//
// The words read here are only these: the rule or the line verbatim, the
// `where`, `obk run` and `any command`, and the fix: for a file the kit did not
// write, a narrow rule of its own (`run --timeout 300 -- go test`) through
// `permission allow`; for bot.yaml's `allow`, `permission disallow`. The rest
// of the sentence is the implementer's. A finding without `any command` is not
// a kit-run finding.
//
// Every sandbox starts with CODEX_HOME and CLAUDE_CONFIG_DIR unset, so no run
// reads the real ones; HOME is the sandbox's own, and OBK_POLICY_ROOT an empty
// folder of the sandbox's own, so no run reads the machine's system policy. Everything goes through the
// CLI on a sandboxed fleet that is up in the fake Orca.

import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, readlink, rename, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { botHomeOf, createSandbox, git, shellWord } from './helpers/cli.js';
import {
  allowOf,
  codexRulesOf,
  kitRule,
  permissionAllow,
  prefixRule,
  settingsIn,
  settingsOf,
  writeAllow,
} from './helpers/permissions.js';
import { botYamlOf } from './helpers/skills.js';

const BOT = 'api-bot';
const CODEX_BOT = 'cx-bot';
const PAST = new Date('2020-01-01T00:00:00Z');

/** The folder that stands for / in system policy paths: OBK_POLICY_ROOT. */
const policyRootOf = (box) => path.join(box.root, 'policy');

/** A sandbox with neither CODEX_HOME nor CLAUDE_CONFIG_DIR set: every run reads the sandbox's HOME, never the real one. */
async function sandbox(t) {
  const box = await createSandbox(t);
  delete box.env.CODEX_HOME;
  delete box.env.CLAUDE_CONFIG_DIR;
  // The machine's system policy is never read: an empty folder stands for /.
  box.env.OBK_POLICY_ROOT = policyRootOf(box);
  await mkdir(box.env.OBK_POLICY_ROOT);
  return box;
}

/**
 * A fleet up in Orca: Bot Father on `father`, and each of `bots`, `[name,
 * harness]`, with a daily session.
 */
async function fleet(box, { father = 'claude', bots = [[BOT, 'claude']] } = {}) {
  const init = await box.run(['init', '--bots', 'bots', '--harness', father]);
  assert.equal(init.code, 0, init.stderr);
  for (const [name, harness] of bots) {
    const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', name, '--harness', harness]);
    assert.equal(made.code, 0, made.stderr);
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', name, '--name', 'daily']);
    assert.equal(added.code, 0, added.stderr);
  }
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  return box.path('bots');
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

/** The findings that point at `file`. */
const naming = (found, file) => found.filter((one) => names(one, file));

/** Whether a finding speaks of the kit's run with any command. */
const isKitRun = (finding) => typeof finding.says === 'string' && finding.says.includes('any command');

// ----------------------------------------------------------------- the places

/** The bot's own local Claude settings (c). */
const localSettingsOf = (bots, bot) => path.join(botHomeOf(bots, bot), '.claude', 'settings.local.json');
/** A rules file of the user's in the bot's own `.codex/rules`, beside obk.rules (d). */
const theirRulesOf = (bots, bot) => path.join(path.dirname(codexRulesOf(bots, bot)), 'default.rules');
/** The repo's local Claude settings (e), for a fleet whose repo root is `root`. */
const repoLocalSettings = (root) => path.join(root, '.claude', 'settings.local.json');
/** A Codex rules file in `folder`'s `.codex/rules` (f). */
const folderRules = (folder, name = 'fleet.rules') => path.join(folder, '.codex', 'rules', name);
/** Claude's user settings under HOME (g). */
const userSettings = (home) => path.join(home, '.claude', 'settings.json');
/** Codex's user rules under HOME (h). */
const userRules = (home) => path.join(home, '.codex', 'rules', 'default.rules');

/** Claude settings that allow `rules`, as a user writes them. */
const settingsText = (rules) => `${JSON.stringify({ permissions: { allow: rules } }, null, 2)}\n`;
/** A Codex rules file with `lines`, after a comment, as a user writes it. */
const rulesText = (lines) => ['# my own rules', ...lines, ''].join('\n');

/** Write `text` to `file`, making its folder. */
async function put(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

/** Add `entries` to the bot's `.claude/settings.json` by hand, after what is there (b). */
async function handAllow(bots, bot, entries) {
  const settings = (await settingsIn(bots, bot)) ?? {};
  settings.permissions = { ...settings.permissions, allow: [...(settings.permissions?.allow ?? []), ...entries] };
  await put(settingsOf(bots, bot), `${JSON.stringify(settings, null, 2)}\n`);
}

/** Each file as bytes and mtime, with the mtime set back first so a rewrite shows. */
async function frozen(files) {
  const was = [];
  for (const file of files) {
    await utimes(file, PAST, PAST);
    was.push({ file, text: await readFile(file, 'utf8'), mtime: PAST.getTime() });
  }
  return was;
}

/** Health changed none of the files it read: not their bytes, not their mtime. */
async function assertUnchanged(was) {
  for (const { file, text, mtime } of was) {
    assert.equal(await readFile(file, 'utf8'), text, `health never changes ${file}`);
    assert.equal((await stat(file)).mtime.getTime(), mtime, `not even to write the same thing back to ${file}`);
  }
}

/**
 * The one kit-run finding about `rule` in `file`: kind config, `where` the
 * file, the rule verbatim, `obk run`, `any command`, and the fix. `bot` is the
 * bot's name, or undefined for a fleet-wide file. `disallow` is for bot.yaml's
 * `allow`, which the kit wrote and the user can take back.
 */
function assertKitRun(found, rule, file, { bot, disallow = false } = {}) {
  const said = saying(found, rule).filter((one) => one.where === file);
  assert.equal(said.length, 1, `one finding should name ${rule} verbatim, with where ${file}, got: ${show(found)}`);
  const [finding] = said;
  assert.equal(finding.kind, 'config', `got: ${show(finding)}`);
  assert.equal(finding.bot, bot, `${bot === undefined ? 'a fleet-wide file is about no one bot' : `the finding is about ${bot}`}, got: ${show(finding)}`);
  const { says } = finding;
  assert.ok(says.includes('obk run'), `it should say the rule lets obk run run any command, got: ${says}`);
  assert.ok(says.includes('any command'), `it should say any command, got: ${says}`);
  if (disallow) {
    assert.ok(says.includes('permission disallow'), `the fix for bot.yaml's allow is obk permission disallow, got: ${says}`);
  } else {
    assert.ok(says.includes('run --timeout 300 -- go test'), `the fix names a narrow run rule, such as run --timeout 300 -- go test, got: ${says}`);
    assert.ok(says.includes('permission allow'), `allowed through obk permission allow after the user's yes, got: ${says}`);
  }
  return finding;
}

// ----------------------------------------------------------------- which Claude rules count

/** Claude rules that let the kit's run run any command: `[rule, why]`. */
const claudeKitRun = (box) => [
  ['Bash(obk:*)', 'the kit with any arguments'],
  ['Bash(/opt/homebrew/bin/obk:*)', 'an absolute path whose last part is obk'],
  [`Bash(${shellWord(box.cli)}:*)`, 'the kit\'s own CLI path, with any arguments'],
  ['Bash(obk *)', 'a spaced star after the kit'],
  ['Bash(obk*)', 'a star glued to the kit word matches any text, obk run and what follows it too'],
  ['Bash(obk run:*)', 'run with any arguments'],
  ['Bash(obk r*)', 'r* matches run and anything after it'],
  ['Bash(obk run --timeout 300 -- *)', 'nothing after -- but a star'],
  ['Bash(obk run --timeout 300 -- sh:*)', 'a shell after --, which permission allow refuses as broad'],
  ['Bash(obk run --timeout * -- go test:*)', 'a star for the timeout, which permission allow refuses as broad'],
];

/** Claude rules that do not: `[rule, why]`. */
const claudeNotKitRun = (box, bots) => [
  [kitRule(box, bots, 'message check'), 'a rule of the kit\'s default set'],
  ['Bash(obk run --timeout 300 -- go test:*)', 'a narrow run rule (RR1)'],
  ['Bash(obk ru:*)', ':* only at a word boundary: obk ru and its arguments, never obk run (RR7)'],
  ['Bash(gh:*)', 'another program'],
  ['Bash', 'any command by itself, without the kit'],
  ['Bash(*)', 'any command by itself, without the kit'],
];

test('KR1 which Claude rules are kit-run rules: each one in a bot\'s settings.local.json is named on its own; the others there name nothing', async (t) => {
  const box = await sandbox(t);
  const bots = await fleet(box);
  const inFile = localSettingsOf(bots, BOT);
  const inRules = claudeKitRun(box);
  await put(inFile, settingsText(inRules.map(([rule]) => rule)));
  // The rules that are not, in Bot Father's local settings, the repo's and the user's.
  const outRules = claudeNotKitRun(box, bots);
  const outFiles = [localSettingsOf(bots, 'bot-father'), repoLocalSettings(bots), userSettings(box.home)];
  for (const file of outFiles) await put(file, settingsText(outRules.map(([rule]) => rule)));
  const was = await frozen([inFile, ...outFiles]);

  const found = await health(box);

  for (const [rule, why] of inRules) {
    await t.test(`KR1 ${rule} is a kit-run rule (${why}): one finding names it, its file and the fix`, () => {
      assertKitRun(found, rule, inFile, { bot: BOT });
    });
  }
  await t.test(`KR1 the rules that are not (${outRules.map(([rule]) => rule).join(', ')}) in c, e and g: no finding names those files`, () => {
    for (const file of outFiles) {
      assert.deepEqual(naming(found, file), [], `nothing there lets obk run run any command, got: ${show(found)}`);
    }
  });
  await t.test('KR1 health changes none of those files', () => assertUnchanged(was));
});

// ----------------------------------------------------------------- which Codex rules count

/** Codex lines that let the kit's run run any command: `[line, why]`. */
const codexKitRun = (box) => [
  ['prefix_rule(pattern=["obk"], decision="allow")', 'the kit with any arguments'],
  ['prefix_rule(pattern=["/opt/homebrew/bin/obk"], decision="allow")', 'an absolute path whose last part is obk'],
  [prefixRule([box.cli, 'run']), 'the kit\'s own CLI path, then run'],
  ['prefix_rule(pattern=["obk", "run"], decision="allow")', 'run with any arguments'],
  ['prefix_rule(pattern=["obk", "run", "--timeout", "300", "--"], decision="allow")', 'any command after --'],
  ['prefix_rule(pattern=["obk", "run", "--timeout", "300", "--", "sh"], decision="allow")', 'a shell after --'],
  ['prefix_rule(pattern=[["obk", "/opt/homebrew/bin/obk"], "run"], decision="allow")', 'alternatives for the kit word'],
  ['prefix_rule(pattern=["obk", ["health", "run"]], decision="allow")', 'alternatives, run among them'],
  ['prefix_rule(pattern=["obk", "run", "--timeout"])', 'decision left out, which means allow'],
];

/** Codex lines that do not. */
const CODEX_NOT_KIT_RUN = [
  ['prefix_rule(pattern=["obk", "run"], decision="prompt")', 'Codex asks first'],
  ['prefix_rule(pattern=["obk"], decision="forbidden")', 'Codex refuses it'],
  ['prefix_rule(pattern=["obk", "message", "check"], decision="allow")', 'another kit command'],
  ['prefix_rule(pattern=["obk", "run", "--timeout", "300", "--", "go", "test"], decision="allow")', 'a narrow run rule'],
  ['prefix_rule(pattern=[["obk", "/opt/homebrew/bin/obk"], "health"], decision="allow")', 'alternatives for the kit word, then another command'],
  ['prefix_rule(pattern=["gh"], decision="allow")', 'another program'],
];

test('KR2 which Codex lines are kit-run rules: each one in the user\'s Codex rules is named on its own; the others are not named as one', async (t) => {
  const box = await sandbox(t);
  const bots = await fleet(box, { bots: [[CODEX_BOT, 'codex']] });
  const inFile = userRules(box.home);
  const inLines = codexKitRun(box);
  await put(inFile, rulesText(inLines.map(([line]) => line)));
  // The lines that are not, in a fleet-wide rules file and in the bot's own.
  const outLines = CODEX_NOT_KIT_RUN.map(([line]) => line);
  const fleetFile = folderRules(bots);
  const botFile = theirRulesOf(bots, CODEX_BOT);
  await put(fleetFile, rulesText(outLines));
  await put(botFile, rulesText(outLines));
  const was = await frozen([inFile, fleetFile, botFile]);

  const found = await health(box);

  for (const [line, why] of inLines) {
    await t.test(`KR2 ${line} is a kit-run rule (${why}): one finding names it, its file and the fix`, () => {
      assertKitRun(found, line, inFile);
    });
  }
  for (const [line, why] of CODEX_NOT_KIT_RUN) {
    await t.test(`KR2 ${line} is not (${why}): no kit-run finding in the fleet's rules; in the bot's own, still one finding, not a kit-run one`, () => {
      assert.deepEqual(saying(found, line).filter((one) => names(one, fleetFile) && isKitRun(one)), [], `got: ${show(found)}`);
      const said = saying(found, line).filter((one) => one.where === botFile);
      assert.equal(said.length, 1, `the bot's own rules file keeps one finding for each line (H5), got: ${show(found)}`);
      assert.ok(!isKitRun(said[0]), `and it is no kit-run finding, got: ${show(said[0])}`);
    });
  }
  await t.test('KR2 health changes none of those files', () => assertUnchanged(was));
});

// ----------------------------------------------------------------- per bot: a, b, c, d

test('KR3 a kit-run rule in each file of a bot\'s own is named for the bot, with the fix, and health changes none of the files', async (t) => {
  const box = await sandbox(t);
  const bots = await fleet(box, { bots: [[BOT, 'claude'], [CODEX_BOT, 'codex']] });
  // A narrow run rule after the user's yes, as #532 made it.
  const narrow = 'Bash(obk run --timeout 60 -- npm test:*)';
  const allowed = await permissionAllow(box, BOT, [narrow]);
  assert.equal(allowed.code, 0, allowed.stderr);
  // a. bot.yaml's allow, by hand; up then writes it into the settings, as it does any rule there.
  const inAllow = 'Bash(obk run --timeout 300 -- sh:*)';
  await writeAllow(bots, BOT, [...await allowOf(bots, BOT), inAllow]);
  const up = await box.run(['up', '--bots', 'bots', '--bot', BOT]);
  assert.equal(up.code, 0, up.stderr);
  // b. the bot's settings.json, by hand.
  const inSettings = 'Bash(obk:*)';
  await handAllow(bots, BOT, [inSettings]);
  // c. the bot's settings.local.json.
  const inLocal = 'Bash(/opt/homebrew/bin/obk:*)';
  await put(localSettingsOf(bots, BOT), settingsText([inLocal]));
  // d. a rules file of the user's in the Codex bot's .codex/rules.
  const inRules = 'prefix_rule(pattern=["obk", "run"], decision="allow")';
  await put(theirRulesOf(bots, CODEX_BOT), rulesText([inRules]));
  // A Codex-only bot is not held to c.
  const codexLocal = localSettingsOf(bots, CODEX_BOT);
  await put(codexLocal, settingsText(['Bash(obk r*)']));
  const files = [botYamlOf(bots, BOT), settingsOf(bots, BOT), localSettingsOf(bots, BOT), theirRulesOf(bots, CODEX_BOT), codexLocal];
  const was = await frozen(files);

  const found = await health(box);

  await t.test(`KR3 a. ${inAllow} in bot.yaml's allow is named, with obk permission disallow`, () => {
    assertKitRun(found, inAllow, botYamlOf(bots, BOT), { bot: BOT, disallow: true });
  });
  await t.test(`KR3 b. ${inSettings} in the bot's settings.json is named with the kit-run fix, and still by one finding`, () => {
    assertKitRun(found, inSettings, settingsOf(bots, BOT), { bot: BOT });
    assert.equal(saying(found, inSettings).length, 1, `one finding names the entry, got: ${show(found)}`);
  });
  await t.test(`KR3 c. ${inLocal} in the bot's settings.local.json is named`, () => {
    assertKitRun(found, inLocal, localSettingsOf(bots, BOT), { bot: BOT });
  });
  await t.test(`KR3 d. ${inRules} in the Codex bot's default.rules is named with the kit-run fix, and still by one finding`, () => {
    assertKitRun(found, inRules, theirRulesOf(bots, CODEX_BOT), { bot: CODEX_BOT });
    assert.equal(saying(found, inRules).length, 1, `one finding names the line, got: ${show(found)}`);
  });
  await t.test('KR3 a bot only on Codex is not held to a settings.local.json', () => {
    assert.deepEqual(naming(found, codexLocal), [], `got: ${show(found)}`);
  });
  await t.test(`KR3 the narrow run rule ${narrow} the user said yes to is not named`, () => {
    assert.deepEqual(saying(found, narrow), [], `got: ${show(found)}`);
  });
  await t.test('KR3 health changes none of the files', () => assertUnchanged(was));
});

// ----------------------------------------------------------------- fleet-wide: e, f, g, h

test('KR4 a kit-run rule in each fleet-wide file is named once, for no one bot, however many bots run on that harness', async (t) => {
  const box = await sandbox(t);
  const bots = await fleet(box, { bots: [[BOT, 'claude'], [CODEX_BOT, 'codex'], ['job-bot', 'codex']] });
  const places = [
    ['e. the repo\'s settings.local.json', repoLocalSettings(bots), settingsText(['Bash(obk *)']), 'Bash(obk *)'],
    ['f. the bots folder\'s .codex/rules', folderRules(bots), rulesText(['prefix_rule(pattern=["obk"], decision="allow")']), 'prefix_rule(pattern=["obk"], decision="allow")'],
    ['f. the .codex/rules of the folder that holds the bot homes', folderRules(path.join(bots, 'bots')), rulesText(['prefix_rule(pattern=["/opt/homebrew/bin/obk"], decision="allow")']), 'prefix_rule(pattern=["/opt/homebrew/bin/obk"], decision="allow")'],
    ['g. Claude\'s user settings under HOME', userSettings(box.home), settingsText(['Bash(obk run:*)']), 'Bash(obk run:*)'],
    ['h. Codex\'s user rules under HOME', userRules(box.home), rulesText(['prefix_rule(pattern=["obk", "run", "--timeout", "300", "--"], decision="allow")']), 'prefix_rule(pattern=["obk", "run", "--timeout", "300", "--"], decision="allow")'],
  ];
  for (const [, file, text] of places) await put(file, text);
  const was = await frozen(places.map(([, file]) => file));

  const found = await health(box);

  for (const [label, file, , rule] of places) {
    await t.test(`KR4 ${label}: ${rule} is named once, with the fix`, () => {
      assertKitRun(found, rule, file);
      assert.equal(saying(found, rule).length, 1, `named once, not once per bot, got: ${show(found)}`);
    });
  }
  await t.test('KR4 health changes none of the files', () => assertUnchanged(was));
});

test('KR5 with CLAUDE_CONFIG_DIR and CODEX_HOME set, health reads the user\'s files there, and not the ones under HOME', async (t) => {
  const box = await sandbox(t);
  const claudeDir = path.join(box.root, 'claude-config');
  const codexDir = path.join(box.root, 'codex-home');
  box.env.CLAUDE_CONFIG_DIR = claudeDir;
  box.env.CODEX_HOME = codexDir;
  await fleet(box, { bots: [[CODEX_BOT, 'codex']] });
  const claudeFile = path.join(claudeDir, 'settings.json');
  const codexFile = path.join(codexDir, 'rules', 'default.rules');
  await put(claudeFile, settingsText(['Bash(obk:*)']));
  await put(codexFile, rulesText(['prefix_rule(pattern=["obk"], decision="allow")']));
  await put(userSettings(box.home), settingsText(['Bash(obk *)']));
  await put(userRules(box.home), rulesText(['prefix_rule(pattern=["obk", "run"], decision="allow")']));
  const was = await frozen([claudeFile, codexFile, userSettings(box.home), userRules(box.home)]);

  const found = await health(box);

  await t.test('KR5 g. $CLAUDE_CONFIG_DIR/settings.json is read', () => assertKitRun(found, 'Bash(obk:*)', claudeFile));
  await t.test('KR5 h. $CODEX_HOME/rules is read', () => assertKitRun(found, 'prefix_rule(pattern=["obk"], decision="allow")', codexFile));
  await t.test('KR5 the files under HOME are not read when those are set', () => {
    assert.deepEqual(naming(found, userSettings(box.home)), [], `got: ${show(found)}`);
    assert.deepEqual(naming(found, userRules(box.home)), [], `got: ${show(found)}`);
  });
  await t.test('KR5 health changes none of the files', () => assertUnchanged(was));
});

test('KR6 a repo root above the bots folder: health reads its settings.local.json, and the .codex/rules of each folder from it down', async (t) => {
  const box = await sandbox(t);
  const bots = await fleet(box, { bots: [[CODEX_BOT, 'codex']] });
  // The bots folder kept inside a repo of the user's: its own .git goes, and the folder around it is the repo.
  await rename(path.join(bots, '.git'), path.join(box.root, 'bots.git'));
  const made = await git(['init', '-q'], box.cwd);
  assert.equal(made.code, 0, made.stderr);
  const local = repoLocalSettings(box.cwd);
  const top = folderRules(box.cwd, 'top.rules');
  const middle = folderRules(bots, 'middle.rules');
  await put(local, settingsText(['Bash(obk:*)']));
  await put(top, rulesText(['prefix_rule(pattern=["obk"], decision="allow")']));
  await put(middle, rulesText(['prefix_rule(pattern=["obk", "run"], decision="allow")']));
  const was = await frozen([local, top, middle]);

  const found = await health(box);

  await t.test('KR6 e. the repo root\'s settings.local.json', () => assertKitRun(found, 'Bash(obk:*)', local));
  await t.test('KR6 f. the repo root\'s .codex/rules', () => assertKitRun(found, 'prefix_rule(pattern=["obk"], decision="allow")', top));
  await t.test('KR6 f. the bots folder\'s .codex/rules, below the repo root', () => assertKitRun(found, 'prefix_rule(pattern=["obk", "run"], decision="allow")', middle));
  await t.test('KR6 health changes none of the files', () => assertUnchanged(was));
});

test('KR7 a repo root that is HOME: its settings.local.json is not read, and the user settings in HOME are', async (t) => {
  const box = await sandbox(t);
  const bots = await fleet(box);
  box.env.HOME = bots;
  const local = repoLocalSettings(bots);
  await put(local, settingsText(['Bash(obk run:*)']));
  await put(userSettings(bots), settingsText(['Bash(obk *)']));

  const found = await health(box);

  await t.test('KR7 the contrast: g. $HOME/.claude/settings.json is read', () => assertKitRun(found, 'Bash(obk *)', userSettings(bots)));
  await t.test('KR7 e. the repo root is HOME, so its settings.local.json is not read', () => {
    assert.deepEqual(naming(found, local), [], `got: ${show(found)}`);
    assert.deepEqual(saying(found, 'Bash(obk run:*)'), [], `got: ${show(found)}`);
  });
});

// ----------------------------------------------------------------- one finding per file and rule

test('KR8 the same kit-run rule in three files is three findings, one for each file', async (t) => {
  const box = await sandbox(t);
  const bots = await fleet(box);
  const rule = 'Bash(obk:*)';
  const files = [localSettingsOf(bots, BOT), localSettingsOf(bots, 'bot-father'), userSettings(box.home)];
  for (const file of files) await put(file, settingsText([rule]));

  const found = await health(box);

  assert.equal(saying(found, rule).length, 3, `one finding for each file, got: ${show(found)}`);
  assertKitRun(found, rule, files[0], { bot: BOT });
  assertKitRun(found, rule, files[1], { bot: 'bot-father' });
  assertKitRun(found, rule, files[2]);
});

// ----------------------------------------------------------------- files health cannot read, and files not there

test('KR9 a file that is not valid JSON, or a .rules file that cannot be read, is one finding naming it, and health still answers the rest', async (t) => {
  const box = await sandbox(t);
  const bots = await fleet(box, { bots: [[BOT, 'claude'], [CODEX_BOT, 'codex']] });
  const notJson = [
    ['c. the bot\'s settings.local.json', localSettingsOf(bots, BOT)],
    ['e. the repo\'s settings.local.json', repoLocalSettings(bots)],
    ['g. Claude\'s user settings', userSettings(box.home)],
  ];
  for (const [, file] of notJson) await put(file, '{ "permissions": { "allow": [\n');
  // Links to files that are not there.
  const unreadable = [
    ['f. the bots folder\'s .codex/rules', folderRules(bots), path.join(box.root, 'gone', 'fleet.rules')],
    ['h. Codex\'s user rules', userRules(box.home), path.join(box.root, 'gone', 'default.rules')],
  ];
  for (const [, file, missing] of unreadable) {
    await mkdir(path.dirname(file), { recursive: true });
    await symlink(missing, file);
  }
  // Kit-run rules elsewhere, which health still names.
  await handAllow(bots, BOT, ['Bash(obk:*)']);
  await put(theirRulesOf(bots, CODEX_BOT), rulesText(['prefix_rule(pattern=["obk"], decision="allow")']));
  const was = await frozen(notJson.map(([, file]) => file));

  const found = await health(box);

  for (const [label, file] of [...notJson, ...unreadable]) {
    await t.test(`KR9 ${label}, unreadable, is one finding naming it`, () => {
      assert.equal(naming(found, file).length, 1, `one finding should name ${file}, got: ${show(found)}`);
    });
  }
  await t.test('KR9 the kit-run rules elsewhere are still named', () => {
    assertKitRun(found, 'Bash(obk:*)', settingsOf(bots, BOT), { bot: BOT });
    assertKitRun(found, 'prefix_rule(pattern=["obk"], decision="allow")', theirRulesOf(bots, CODEX_BOT), { bot: CODEX_BOT });
  });
  await t.test('KR9 health changes none of the files, and leaves the links as they are', async () => {
    await assertUnchanged(was);
    for (const [, file, missing] of unreadable) {
      assert.ok((await lstat(file)).isSymbolicLink(), `${file} is still a link`);
      assert.equal(await readlink(file), missing, 'leading where it led');
    }
  });
});

test('KR10 a file that is not there is no finding', async (t) => {
  const box = await sandbox(t);
  const bots = await fleet(box, { bots: [[BOT, 'claude'], [CODEX_BOT, 'codex']] });

  const found = await health(box);

  for (const file of [
    localSettingsOf(bots, BOT),
    localSettingsOf(bots, 'bot-father'),
    theirRulesOf(bots, CODEX_BOT),
    repoLocalSettings(bots),
    path.dirname(folderRules(bots)),
    path.dirname(folderRules(path.join(bots, 'bots'))),
    userSettings(box.home),
    path.dirname(userRules(box.home)),
  ]) {
    assert.deepEqual(naming(found, file), [], `nothing there, nothing to say about ${file}, got: ${show(found)}`);
  }
  assert.deepEqual(found.filter(isKitRun), [], `got: ${show(found)}`);
});

// ----------------------------------------------------------------- only the harnesses the fleet runs

test('KR11 a fleet with no bot on Codex is not held to the fleet\'s or the user\'s Codex rules', async (t) => {
  const box = await sandbox(t);
  const bots = await fleet(box);
  const codexFiles = [folderRules(bots), folderRules(path.join(bots, 'bots')), userRules(box.home)];
  for (const file of codexFiles) await put(file, rulesText(['prefix_rule(pattern=["obk"], decision="allow")']));
  // The contrast: a Claude file, which it is held to.
  await put(userSettings(box.home), settingsText(['Bash(obk:*)']));

  const found = await health(box);

  await t.test('KR11 the contrast: g. Claude\'s user settings are read', () => assertKitRun(found, 'Bash(obk:*)', userSettings(box.home)));
  await t.test('KR11 f and h are not read', () => {
    for (const file of codexFiles) assert.deepEqual(naming(found, file), [], `got: ${show(found)}`);
    assert.deepEqual(saying(found, 'prefix_rule(pattern=["obk"], decision="allow")'), [], `got: ${show(found)}`);
  });
});

test('KR12 a fleet with no bot on Claude is not held to the repo\'s or the user\'s Claude settings, nor a bot\'s settings.local.json', async (t) => {
  const box = await sandbox(t);
  const bots = await fleet(box, { father: 'codex', bots: [[CODEX_BOT, 'codex']] });
  const claudeFiles = [repoLocalSettings(bots), userSettings(box.home), localSettingsOf(bots, CODEX_BOT), localSettingsOf(bots, 'bot-father')];
  for (const file of claudeFiles) await put(file, settingsText(['Bash(obk:*)']));
  // The contrast: a Codex file, which it is held to.
  await put(userRules(box.home), rulesText(['prefix_rule(pattern=["obk"], decision="allow")']));

  const found = await health(box);

  await t.test('KR12 the contrast: h. Codex\'s user rules are read', () => assertKitRun(found, 'prefix_rule(pattern=["obk"], decision="allow")', userRules(box.home)));
  await t.test('KR12 e, g and c are not read', () => {
    for (const file of claudeFiles) assert.deepEqual(naming(found, file), [], `got: ${show(found)}`);
    assert.deepEqual(saying(found, 'Bash(obk:*)'), [], `got: ${show(found)}`);
  });
});

// ----------------------------------------------------------------- system policy: i, j (review of PR #640)

/** Where Claude Code keeps managed settings under `root`, by the platform the kit runs on. */
const claudePolicyDir = (root) => (process.platform === 'darwin'
  ? path.join(root, 'Library', 'Application Support', 'ClaudeCode')
  : path.join(root, 'etc', 'claude-code'));
/** Claude's managed settings (j). */
const managedSettings = (root) => path.join(claudePolicyDir(root), 'managed-settings.json');
/** A drop-in file of Claude's managed settings (j). */
const managedDropIn = (root, name) => path.join(claudePolicyDir(root), 'managed-settings.d', name);
/** A Codex system rules file (i). */
const systemRules = (root, name = 'default.rules') => path.join(root, 'etc', 'codex', 'rules', name);

/** Whether a finding says health cannot tell what a file allows. */
const isCannotTell = (finding) => typeof finding.says === 'string' && finding.says.includes('cannot tell');
/** A kit-run finding, and not a `cannot tell` one. */
const isKitRunOnly = (finding) => isKitRun(finding) && !isCannotTell(finding);

/**
 * The kit-run findings whose `where` is `file`, `count` of them, each of kind
 * config, about `bot` (undefined for a fleet-wide file), with `obk run`, `any
 * command` and the fix. For a rule health names without its line verbatim.
 */
function assertKitRunsIn(found, file, count, { bot } = {}) {
  const said = found.filter((one) => one.where === file && isKitRunOnly(one));
  assert.equal(said.length, count, `${count} kit-run finding(s) should have where ${file}, got: ${show(found)}`);
  for (const finding of said) {
    assert.equal(finding.kind, 'config', `got: ${show(finding)}`);
    assert.equal(finding.bot, bot, `got: ${show(finding)}`);
    assert.ok(finding.says.includes('obk run'), `got: ${finding.says}`);
    assert.ok(finding.says.includes('run --timeout 300 -- go test'), `the fix names a narrow run rule, got: ${finding.says}`);
    assert.ok(finding.says.includes('permission allow'), `got: ${finding.says}`);
  }
  return said;
}

test('KR13 a kit-run rule in system policy is named once, for no one bot: Codex system rules, Claude managed settings and their drop-ins', async (t) => {
  const box = await sandbox(t);
  const root = policyRootOf(box);
  await fleet(box, { bots: [[BOT, 'claude'], [CODEX_BOT, 'codex']] });
  const places = [
    ['i. Codex system rules', systemRules(root), rulesText(['prefix_rule(pattern=["obk"], decision="allow")']), 'prefix_rule(pattern=["obk"], decision="allow")'],
    ['j. Claude managed settings', managedSettings(root), settingsText(['Bash(obk:*)']), 'Bash(obk:*)'],
    ['j. a drop-in of Claude managed settings', managedDropIn(root, '10-team.json'), settingsText(['Bash(obk run:*)']), 'Bash(obk run:*)'],
  ];
  for (const [, file, text] of places) await put(file, text);
  // Not read: a hidden drop-in, and a drop-in that is no .json.
  const hidden = managedDropIn(root, '.hidden.json');
  const notJsonName = managedDropIn(root, 'README.txt');
  await put(hidden, settingsText(['Bash(obk *)']));
  await put(notJsonName, settingsText(['Bash(obk r*)']));
  const was = await frozen([...places.map(([, file]) => file), hidden, notJsonName]);

  const found = await health(box);

  for (const [label, file, , rule] of places) {
    await t.test(`KR13 ${label}: ${rule} is named once, with the fix`, () => {
      assertKitRun(found, rule, file);
      assert.equal(saying(found, rule).length, 1, `named once, not once per bot, got: ${show(found)}`);
    });
  }
  await t.test('KR13 a hidden drop-in and a drop-in that is no .json are not read', () => {
    assert.deepEqual(naming(found, hidden), [], `got: ${show(found)}`);
    assert.deepEqual(naming(found, notJsonName), [], `got: ${show(found)}`);
  });
  await t.test('KR13 health changes none of the files', () => assertUnchanged(was));
});

test('KR14 system policy health cannot read is one finding naming the file, and health still answers the rest', async (t) => {
  const box = await sandbox(t);
  const root = policyRootOf(box);
  const bots = await fleet(box, { bots: [[BOT, 'claude'], [CODEX_BOT, 'codex']] });
  const notJson = [
    ['j. Claude managed settings', managedSettings(root)],
    ['j. a drop-in of Claude managed settings', managedDropIn(root, '20-bad.json')],
  ];
  for (const [, file] of notJson) await put(file, '{ "permissions": { "allow": [\n');
  const unreadable = systemRules(root);
  const missing = path.join(box.root, 'gone', 'system.rules');
  await mkdir(path.dirname(unreadable), { recursive: true });
  await symlink(missing, unreadable);
  await handAllow(bots, BOT, ['Bash(obk:*)']);
  const was = await frozen(notJson.map(([, file]) => file));

  const found = await health(box);

  for (const [label, file] of [...notJson, ['i. Codex system rules', unreadable]]) {
    await t.test(`KR14 ${label}, unreadable, is one finding naming it`, () => {
      assert.equal(naming(found, file).length, 1, `one finding should name ${file}, got: ${show(found)}`);
    });
  }
  await t.test('KR14 the kit-run rule elsewhere is still named', () => {
    assertKitRun(found, 'Bash(obk:*)', settingsOf(bots, BOT), { bot: BOT });
  });
  await t.test('KR14 health changes none of the files, and leaves the link as it is', async () => {
    await assertUnchanged(was);
    assert.equal(await readlink(unreadable), missing);
  });
});

test('KR15 a fleet with no bot on Codex is not held to Codex system rules', async (t) => {
  const box = await sandbox(t);
  const root = policyRootOf(box);
  await fleet(box);
  await put(systemRules(root), rulesText(['prefix_rule(pattern=["obk"], decision="allow")']));
  // The contrast: Claude managed settings, which it is held to.
  await put(managedSettings(root), settingsText(['Bash(obk:*)']));

  const found = await health(box);

  await t.test('KR15 the contrast: j. Claude managed settings are read', () => assertKitRun(found, 'Bash(obk:*)', managedSettings(root)));
  await t.test('KR15 i is not read', () => assert.deepEqual(naming(found, systemRules(root)), [], `got: ${show(found)}`));
});

test('KR16 a fleet with no bot on Claude is not held to Claude managed settings', async (t) => {
  const box = await sandbox(t);
  const root = policyRootOf(box);
  await fleet(box, { father: 'codex', bots: [[CODEX_BOT, 'codex']] });
  const claudeFiles = [managedSettings(root), managedDropIn(root, '10-team.json')];
  for (const file of claudeFiles) await put(file, settingsText(['Bash(obk:*)']));
  // The contrast: Codex system rules, which it is held to.
  await put(systemRules(root), rulesText(['prefix_rule(pattern=["obk"], decision="allow")']));

  const found = await health(box);

  await t.test('KR16 the contrast: i. Codex system rules are read', () => assertKitRun(found, 'prefix_rule(pattern=["obk"], decision="allow")', systemRules(root)));
  await t.test('KR16 j is not read', () => {
    for (const file of claudeFiles) assert.deepEqual(naming(found, file), [], `got: ${show(found)}`);
  });
});

// ----------------------------------------------------------------- Codex rules read as Codex reads them (review of PR #640)

test('KR17 a Codex rules file is read as Codex reads it: comments, calls over several lines, other arguments, the pattern first, and what health cannot read', async (t) => {
  const box = await sandbox(t);
  const bots = await fleet(box, { bots: [[CODEX_BOT, 'codex']] });
  const dir = path.dirname(userRules(box.home));
  const at = (name) => path.join(dir, name);
  // [label, file, text, kit-run findings, cannot tell findings]
  const cases = [
    ['a rule in a comment is no rule', at('comment.rules'), '# prefix_rule(pattern=["obk"], decision="allow")\n', 0, 0],
    ['a comment inside a call over several lines does not hide it', at('lines.rules'), [
      'prefix_rule(pattern=[',
      '    "obk", # command name',
      '    "run"',
      '], decision="allow")',
      '',
    ].join('\n'), 1, 0],
    ['a decision in another argument\'s string is not the decision', at('justification.rules'), 'prefix_rule(pattern=["obk"], justification="decision=\'forbidden\'")\n', 1, 0],
    ['a decision in a comment is not the decision', at('comment-decision.rules'), 'prefix_rule(pattern=["obk"], # decision="forbidden"\ndecision="allow")\n', 1, 0],
    ['forbidden, with allow only in another argument\'s string', at('forbidden.rules'), 'prefix_rule(pattern=["obk"], justification="decision=\'allow\'", decision="forbidden")\n', 0, 0],
    ['the pattern first, without its name', at('positional.rules'), 'prefix_rule(["obk", "run"])\n', 1, 0],
    ['a pattern held in a name', at('name.rules'), 'kit = ["obk", "run"]\nprefix_rule(pattern=kit, decision="allow")\n', 0, 1],
    ['a decision that is no literal, beside a rule health can read', at('mixed.rules'), 'prefix_rule(pattern=["obk"], decision="allow")\nprefix_rule(pattern=["obk"], decision=d)\n', 1, 1],
    ['only literal calls of prefix_rule, host_executable and network_rule', at('literals.rules'), [
      '# literals only',
      'prefix_rule(pattern=["gh", ("pr", "issue")], decision=\'allow\', justification=\'single quotes\', not_match=None)',
      'host_executable(name="git", paths=["/usr/bin/git"])',
      'network_rule(host="example.com", port=443, allow=True, log=False)',
      '',
    ].join('\n'), 0, 0],
  ];
  for (const [, file, text] of cases) await put(file, text);
  // f: what health cannot read in the fleet's rules too.
  const fleetFile = folderRules(bots, 'name.rules');
  await put(fleetFile, 'kit = ["obk"]\nprefix_rule(pattern=kit)\n');
  const was = await frozen([...cases.map(([, file]) => file), fleetFile]);

  const found = await health(box);

  for (const [label, file, , kitRuns, cannot] of cases) {
    await t.test(`KR17 ${label}: ${kitRuns} kit-run finding(s), ${cannot} cannot tell`, () => {
      assertKitRunsIn(found, file, kitRuns);
      const told = found.filter((one) => names(one, file) && isCannotTell(one));
      assert.equal(told.length, cannot, `${cannot} finding(s) should name ${file} and say cannot tell, got: ${show(found)}`);
    });
  }
  await t.test('KR17 the rule health can read in mixed.rules is named verbatim', () => {
    assert.equal(saying(found, 'prefix_rule(pattern=["obk"], decision="allow")').filter((one) => one.where === at('mixed.rules') && isKitRunOnly(one)).length, 1, `got: ${show(found)}`);
  });
  await t.test('KR17 f. what health cannot read in the fleet\'s rules is one cannot tell finding', () => {
    assert.equal(found.filter((one) => names(one, fleetFile) && isCannotTell(one)).length, 1, `got: ${show(found)}`);
  });
  await t.test('KR17 health changes none of the files', () => assertUnchanged(was));
});

test('KR18 in a bot\'s own rules file, each line keeps its finding, and a kit-run call that is not one whole line gets a kit-run finding of its own', async (t) => {
  const box = await sandbox(t);
  const bots = await fleet(box, { bots: [[CODEX_BOT, 'codex']] });
  const file = theirRulesOf(bots, CODEX_BOT);
  const whole = 'prefix_rule(pattern=["obk", "run"], decision="allow")';
  const commented = 'prefix_rule(pattern=["obk"], decision="allow")  # mine';
  await put(file, [
    whole,
    'prefix_rule(pattern=[',
    '    "obk", # command name',
    '    "run"',
    '], decision="allow")',
    commented,
    '',
  ].join('\n'));
  const was = await frozen([file]);

  const found = await health(box);

  await t.test('KR18 three kit-run findings: the whole line, the call over several lines, the call with a comment after it', () => {
    assertKitRunsIn(found, file, 3, { bot: CODEX_BOT });
  });
  await t.test('KR18 the whole line is named by one finding, and it is the kit-run one', () => {
    const said = saying(found, whole).filter((one) => one.where === file);
    assert.equal(said.length, 1, `got: ${show(found)}`);
    assert.ok(isKitRunOnly(said[0]), `got: ${show(said[0])}`);
  });
  await t.test('KR18 the line with a comment after it keeps its neutral finding (H5)', () => {
    assert.equal(saying(found, commented).filter((one) => one.where === file && !isKitRun(one)).length, 1, `got: ${show(found)}`);
  });
  await t.test('KR18 health does not change the file', () => assertUnchanged(was));
});

// ----------------------------------------------------------------- a wildcard anywhere, and the kit behind a runner (review of PR #640)

test('KR19 Claude rules match with a wildcard anywhere and with the kit behind a runner; Codex patterns count the kit behind a runner too', async (t) => {
  const box = await sandbox(t);
  const bots = await fleet(box, { bots: [[BOT, 'claude'], [CODEX_BOT, 'codex']] });
  const cli = shellWord(box.cli);
  const inRules = [
    ['Bash(/opt/*/obk:*)', 'a star inside the path of the kit'],
    ['Bash(*/obk:*)', 'a star for the folder of the kit'],
    ['Bash(env /opt/homebrew/bin/obk run:*)', 'the kit behind env'],
    [`Bash(env ${cli} run:*)`, 'the kit\'s own CLI behind env'],
    [`Bash(node ${cli} run:*)`, 'the kit\'s own CLI behind node'],
    ['Bash(nice obk run:*)', 'the kit behind nice'],
    ['Bash(obk run --timeout=60 -- *)', '--timeout=<n>, then any command'],
  ];
  const inFile = localSettingsOf(bots, BOT);
  await put(inFile, settingsText(inRules.map(([rule]) => rule)));
  const outRules = [
    'Bash', 'Bash(*)', 'Bash(sh:*)', 'Bash(env:*)', 'Bash(o*)',
    'Bash(env /usr/bin/true:*)', 'Bash(obk run --timeout 300 -- env /usr/bin/true:*)', 'Bash(obk ru:*)',
  ];
  const outFiles = [localSettingsOf(bots, 'bot-father'), repoLocalSettings(bots), userSettings(box.home)];
  for (const file of outFiles) await put(file, settingsText(outRules));
  const codexIn = 'prefix_rule(pattern=["env", "/opt/homebrew/bin/obk", "run"], decision="allow")';
  const codexOut = ['prefix_rule(pattern=["env"], decision="allow")', 'prefix_rule(pattern=["sh"], decision="allow")'];
  await put(userRules(box.home), rulesText([codexIn]));
  const fleetFile = folderRules(bots);
  await put(fleetFile, rulesText(codexOut));
  const was = await frozen([inFile, ...outFiles, userRules(box.home), fleetFile]);

  const found = await health(box);

  for (const [rule, why] of inRules) {
    await t.test(`KR19 ${rule} is a kit-run rule (${why})`, () => assertKitRun(found, rule, inFile, { bot: BOT }));
  }
  await t.test(`KR19 the rules that are not (${outRules.join(', ')}) in c, e and g: no finding names those files`, () => {
    for (const file of outFiles) assert.deepEqual(naming(found, file), [], `got: ${show(found)}`);
  });
  await t.test(`KR19 ${codexIn} is a kit-run rule (the kit behind env)`, () => assertKitRun(found, codexIn, userRules(box.home)));
  for (const line of codexOut) {
    await t.test(`KR19 ${line} is not a kit-run rule (any command, without the kit)`, () => {
      assert.deepEqual(saying(found, line).filter((one) => names(one, fleetFile) && isKitRun(one)), [], `got: ${show(found)}`);
    });
  }
  await t.test('KR19 health changes none of the files', () => assertUnchanged(was));
});

// ----------------------------------------------------------------- strings, positions, tokens and a run inside a run (second review of PR #640)

test('KR20 Codex strings with escapes, the decision by position, patterns token by token, and a kit run inside a kit run, for Codex and Claude', async (t) => {
  const box = await sandbox(t);
  const bots = await fleet(box, { bots: [[CODEX_BOT, 'codex']] });
  const dir = path.dirname(userRules(box.home));
  const at = (name) => path.join(dir, name);
  const many = [...Array.from({ length: 256 }, (_, n) => `"other${n}"`), '"obk"'].join(', ');
  // [label, file name, line, kit-run findings, cannot tell findings]; undefined: not asserted.
  const cases = [
    ['D1 an escape in the pattern is not decoded', 'escape-pattern.rules', 'prefix_rule(pattern=["\\x6fbk"], decision="allow")', 0, 1],
    ['D1 an escape in the decision is not decoded', 'escape-decision.rules', 'prefix_rule(pattern=["obk"], decision="\\x61llow")', 0, 1],
    ['D2 the second positional argument is the decision: allow', 'positional-allow.rules', 'prefix_rule(["obk"], "allow")', 1, 0],
    ['D2 a third positional argument is more than health reads', 'positional-three.rules', 'prefix_rule(["obk"], "allow", "why")', undefined, 1],
    ['E1 one token that holds spaces matches no command of several words', 'one-token.rules', 'prefix_rule(pattern=["obk", "run --timeout 300 -- sh -c"], decision="allow")', 0, 0],
    ['E2 a first element of 257 alternatives, the kit last', 'many.rules', `prefix_rule(pattern=[[${many}]], decision="allow")`, 1, 0],
    ['E3 alternatives that hold a runner and the kit', 'runner-or-kit.rules', 'prefix_rule(pattern=[["sh", "obk"]], decision="allow")', 1, 0],
    ['F a kit run inside a kit run', 'nested.rules', 'prefix_rule(pattern=["obk", "run", "--timeout", "300", "--", "obk", "run"], decision="allow")', 1, 0],
    ['F the kit behind env inside a kit run', 'nested-env.rules', 'prefix_rule(pattern=["obk", "run", "--timeout", "300", "--", "env", "/opt/homebrew/bin/obk", "run"], decision="allow")', 1, 0],
    ['F a narrow run inside a kit run', 'nested-narrow.rules', 'prefix_rule(pattern=["obk", "run", "--timeout", "300", "--", "obk", "run", "--timeout", "5", "--", "go", "test"], decision="allow")', 0, 0],
  ];
  for (const [, name, line] of cases) await put(at(name), rulesText([line]));
  // D2: the second positional argument forbids, so no finding at all.
  const forbidden = at('positional-forbidden.rules');
  await put(forbidden, rulesText(['prefix_rule(["obk"], "forbidden")']));
  // F for Claude: a kit run inside a kit run, and the kit behind env with a wildcard path, in g; the rules that are not, in e.
  const claudeIn = [
    'Bash(obk run --timeout 300 -- obk run:*)',
    'Bash(obk run --timeout 300 -- obk run --timeout 5 -- sh:*)',
    'Bash(env /opt/*/obk run:*)',
  ];
  const claudeOut = ['Bash(obk run --timeout 300 -- obk run --timeout 5 -- go test:*)', 'Bash(env *)'];
  await put(userSettings(box.home), settingsText(claudeIn));
  await put(repoLocalSettings(bots), settingsText(claudeOut));
  const was = await frozen([...cases.map(([, name]) => at(name)), forbidden, userSettings(box.home), repoLocalSettings(bots)]);

  const found = await health(box);

  for (const [label, name, line, kitRuns, cannot] of cases) {
    await t.test(`KR20 ${label}: ${line.length > 120 ? `${line.slice(0, 117)}...` : line}`, () => {
      if (kitRuns !== undefined) assertKitRunsIn(found, at(name), kitRuns);
      const told = found.filter((one) => names(one, at(name)) && isCannotTell(one));
      assert.equal(told.length, cannot, `${cannot} finding(s) should name ${at(name)} and say cannot tell, got: ${show(found)}`);
    });
  }
  await t.test('KR20 D2 the second positional argument is the decision: forbidden gives no finding', () => {
    assert.deepEqual(naming(found, forbidden), [], `got: ${show(found)}`);
  });
  for (const rule of claudeIn) {
    await t.test(`KR20 F ${rule} in Claude's user settings is a kit-run rule`, () => assertKitRun(found, rule, userSettings(box.home)));
  }
  await t.test(`KR20 F ${claudeOut.join(' and ')} are not kit-run rules: no finding names the repo's settings.local.json`, () => {
    assert.deepEqual(naming(found, repoLocalSettings(bots)), [], `got: ${show(found)}`);
  });
  await t.test('KR20 health changes none of the files', () => assertUnchanged(was));
});

// ----------------------------------------------------------------- a runner behind a runner after -- (third review of PR #640)

test('KR21 after --, a runner followed by the absolute path of another runner is that runner, for Claude and Codex', async (t) => {
  const box = await sandbox(t);
  const bots = await fleet(box, { bots: [[CODEX_BOT, 'codex']] });
  const claudeIn = [
    'Bash(obk run --timeout 300 -- env /bin/sh:*)',
    'Bash(obk run --timeout 300 -- env /usr/bin/env /bin/sh:*)',
    'Bash(obk run --timeout 300 -- nice /usr/bin/python3:*)',
  ];
  const claudeOut = [
    'Bash(obk run --timeout 300 -- env /usr/bin/true:*)',
    'Bash(obk run --timeout 300 -- env /usr/bin/env /usr/bin/true:*)',
  ];
  const codexIn = 'prefix_rule(pattern=["obk", "run", "--timeout", "300", "--", "env", "/bin/sh"], decision="allow")';
  const codexOut = 'prefix_rule(pattern=["obk", "run", "--timeout", "300", "--", "env", "/usr/bin/true"], decision="allow")';
  await put(userSettings(box.home), settingsText(claudeIn));
  await put(repoLocalSettings(bots), settingsText(claudeOut));
  await put(userRules(box.home), rulesText([codexIn]));
  const fleetFile = folderRules(bots);
  await put(fleetFile, rulesText([codexOut]));
  const was = await frozen([userSettings(box.home), repoLocalSettings(bots), userRules(box.home), fleetFile]);

  const found = await health(box);

  for (const rule of claudeIn) {
    await t.test(`KR21 ${rule} in Claude's user settings is a kit-run rule`, () => assertKitRun(found, rule, userSettings(box.home)));
  }
  await t.test(`KR21 ${claudeOut.join(' and ')} are not kit-run rules: no finding names the repo's settings.local.json`, () => {
    assert.deepEqual(naming(found, repoLocalSettings(bots)), [], `got: ${show(found)}`);
  });
  await t.test(`KR21 ${codexIn} in Codex's user rules is a kit-run rule`, () => assertKitRun(found, codexIn, userRules(box.home)));
  await t.test(`KR21 ${codexOut} in the fleet's rules is not a kit-run rule`, () => {
    assert.deepEqual(found.filter((one) => names(one, fleetFile) && isKitRun(one)), [], `got: ${show(found)}`);
  });
  await t.test('KR21 health changes none of the files', () => assertUnchanged(was));
});
