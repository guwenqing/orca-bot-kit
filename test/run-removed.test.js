// `obk run` and #635's health finding leave the kit (#652 R2).
//
// The owner, 2026-10-18: "All the test related stuff please build it out side
// the kit core!!!! Core is core and test is test." `obk run --timeout <s> --
// <command>` (#532) came from the fleet's own test runs, and made a hole: an
// allow rule that covers `obk` broadly also allowed any command. #635's health
// finding existed only because of it. Both go; nothing else a user does with
// the kit changes.
//
// What is checked here, through the CLI and the files a user reads:
//
//   RM1 `obk run …` answers as any unknown command does (`obk wibble …` with
//       the same arguments, the word swapped), and runs nothing.
//   RM2 `obk --help` has no usage line for run, says no `obk run`, and names
//       no `--timeout`.
//   RM3 README.md, SETUP.md, rules/ and skills/ name no `obk run`.
//   RM4 A bot whose allow still holds a rule for `obk run` (as `permission
//       allow` recorded one from kit 0.29.0 on: `Bash(<cli> run --timeout 300
//       -- go test:*)`) is told so as a bot that holds a rule for `session
//       mail` is (test/permissions-held.test.js, #564): `rules build` and `up`
//       keep the rule in allow and its harness files, name it once on a
//       `holds` line that ends with the `permission disallow` command that
//       takes it back, and carry it in `held` in --json; `permission disallow`
//       takes it back, and no `holds` line is left for it. The middle of the
//       line is the implementer's wording.
//   RM5 The kit writes no rule that names `obk run`, for a bot on Claude or on
//       Codex (RR5 of the run-rules test, which #652 removed, moved here).
//   RM6 `obk health` gives no finding about rules that let `obk run` run any
//       command, wherever such a rule is: a bot's settings.local.json, the
//       repo's settings.local.json, the user's Claude settings, the user's
//       Codex rules.
//
// The list of commands and settings the core has, and the PRD's list of them,
// is test/core-is-core.test.js. src/commands.js's lists are
// test/command-lists.test.js CL6.

import assert from 'node:assert/strict';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { botHomeOf, createSandbox, repoRoot, shellWord } from './helpers/cli.js';
import {
  allowedIn,
  allowOf,
  codexAllowedIn,
  codexRulesOf,
  entryAt,
  jsonOf,
  kitRule,
  permissionDisallow,
  prefixRule,
  settingsOf,
  writeAllow,
} from './helpers/permissions.js';

const BOT = 'api-bot';

/** Run a command that has to go through for the test to mean anything. */
async function ok(promise) {
  const result = await promise;
  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  return result;
}

/** A bots folder `init` made, with one bot on `harness` and a daily session. */
async function withBot(box, harness = 'claude', name = BOT) {
  await ok(box.run(['init', '--bots', 'bots', '--harness', 'claude']));
  await ok(box.run(['bot', 'create', '--bots', 'bots', '--name', name, '--harness', harness]));
  await ok(box.run(['session', 'add', '--bots', 'bots', '--bot', name, '--name', 'daily']));
  return box.path('bots');
}

const exists = (file) => access(file).then(() => true, () => false);

// ----------------------------------------------------------------- RM1: no command of the kit's

/** Argument lists after the command word, and whether each names a marker file a run would make. */
const AFTER_THE_WORD = (marker) => [
  [],
  ['--json'],
  ['--', '/usr/bin/touch', marker],
  ['--timeout', '5', '--', '/usr/bin/touch', marker],
  ['--timeout=5', '--', '/usr/bin/touch', marker],
  ['--bots', 'bots'],
];

test('RM1 obk run, with any of the arguments it took, answers as an unknown command does, and runs nothing', async (t) => {
  const box = await createSandbox(t);
  const marker = box.path('the-command-ran');

  for (const rest of AFTER_THE_WORD(marker)) {
    const asRun = await box.run(['run', ...rest]);
    const asUnknown = await box.run(['wibble', ...rest]);

    const shown = JSON.stringify(['run', ...rest]);
    assert.equal(asUnknown.code, 1, `the premise: obk wibble ${rest.join(' ')} is refused, got:\n${asUnknown.stdout}${asUnknown.stderr}`);
    assert.equal(asRun.code, asUnknown.code, `${shown}: the exit code of an unknown command, got:\n${asRun.stdout}${asRun.stderr}`);
    assert.equal(asRun.stdout, asUnknown.stdout, `${shown}: the stdout of an unknown command`);
    assert.equal(asRun.stderr, asUnknown.stderr.replaceAll('wibble', 'run'), `${shown}: the stderr of an unknown command, with its word`);
    assert.equal(await exists(marker), false, `${shown}: nothing was run`);
  }
  assert.deepEqual(await readdir(box.cwd), [], 'and nothing was made where it ran');
});

// ----------------------------------------------------------------- RM2: the help

test('RM2 obk --help has no usage line for run, says no obk run, and names no --timeout', async (t) => {
  const box = await createSandbox(t);

  const { code, stdout } = await box.run(['--help']);

  assert.equal(code, 0);
  assert.deepEqual(stdout.split('\n').filter((line) => /^\s*obk run(\s|$)/.test(line)), [], 'no usage line for obk run');
  assert.ok(!/\bobk run\b/.test(stdout), `the help should say no obk run, got:\n${stdout}`);
  assert.ok(!stdout.includes('--timeout'), `the help should name no --timeout, got:\n${stdout}`);
});

// ----------------------------------------------------------------- RM3: the shipped pages

/** Every file under `dir`, recursively, as absolute paths. */
async function filesUnder(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await filesUnder(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

test('RM3 README.md, SETUP.md, rules/ and skills/ name no obk run', async () => {
  const files = [
    path.join(repoRoot, 'README.md'),
    path.join(repoRoot, 'SETUP.md'),
    ...await filesUnder(path.join(repoRoot, 'rules')),
    ...await filesUnder(path.join(repoRoot, 'skills')),
  ];
  // `obk run`, and the kit's own spelling of itself in rules and skills.
  const names = /\bobk run\b|"\$\{OBK_CLI:-obk\}" run\b/;
  const found = [];
  for (const file of files) {
    const lines = (await readFile(file, 'utf8')).split('\n');
    lines.forEach((line, at) => {
      if (names.test(line)) found.push(`${path.relative(repoRoot, file)}:${at + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(found, [], 'these still name obk run, which the kit no longer has');
});

// ----------------------------------------------------------------- RM4: a bot that still holds a run rule

/** The rules for `obk run` a bot may hold, as `permission allow` recorded them, and the Codex line it wrote for each. */
const runRules = (box) => [
  { rule: `Bash(${shellWord(box.cli)} run --timeout 300 -- go test:*)`, line: prefixRule([box.cli, 'run', '--timeout', '300', '--', 'go', 'test']) },
  { rule: `Bash(${shellWord(box.cli)} run --timeout=300 -- npm test:*)`, line: prefixRule([box.cli, 'run', '--timeout=300', '--', 'npm', 'test']) },
];

/** Put `rules` into the bot's allow by hand, after what it holds, each once. */
async function hold(bots, bot, rules) {
  const allow = (await allowOf(bots, bot)).filter((rule) => !rules.includes(rule));
  await writeAllow(bots, bot, [...allow, ...rules]);
}

const count = (list, item) => list.filter((one) => one === item).length;

/** Every `holds` line of a text answer, each trimmed. */
const holdsLinesIn = (stdout) => stdout.split('\n').map((line) => line.trim()).filter((line) => line.startsWith(`${'holds'.padEnd(9)}  `));

/**
 * The one `holds` line about `rule` for `bot`: it starts as the line for any
 * held rule does, and ends with the command that takes the rule back. What
 * comes between is the implementer's.
 */
function assertHoldsLine(stdout, box, bots, bot, rule) {
  const start = `${'holds'.padEnd(9)}  ${bot}  ${rule}`;
  const lines = holdsLinesIn(stdout).filter((line) => line.startsWith(start));
  assert.equal(lines.length, 1, `one holds line for ${bot}'s ${rule}, got:\n${stdout}`);
  const takeBack = `${shellWord(box.cli)} permission disallow --bots ${shellWord(bots)} --bot ${shellWord(bot)} --rule ${shellWord(rule)}`;
  assert.ok(lines[0].endsWith(`To take it back:  ${takeBack}`), `the line ends with the command that takes it back, ${takeBack}, got: ${lines[0]}`);
  assert.ok(!/\bwrong\b/i.test(lines[0]), `the line does not say the rule is wrong, got: ${lines[0]}`);
}

const WRITERS = [
  ['rules build', (bot) => ['rules', 'build', '--bots', 'bots', '--bot', bot]],
  ['up', (bot) => ['up', '--bots', 'bots', '--bot', bot]],
];

const HARNESSES = [
  ['a Claude bot', 'claude', { claude: true, codex: false }],
  ['a Codex bot', 'codex', { claude: false, codex: true }],
];

for (const [writer, argsFor] of WRITERS) {
  for (const [label, harness, files] of HARNESSES) {
    test(`RM4 ${writer} of ${label} whose allow holds rules for obk run keeps them, and names each once, with the command that takes it back, at every run`, async (t) => {
      const box = await createSandbox(t);
      const bots = await withBot(box, harness);
      const held = runRules(box);
      await hold(bots, BOT, held.map(({ rule }) => rule));

      for (const run of ['first', 'second']) {
        const result = await ok(box.run(argsFor(BOT)));

        for (const { rule, line } of held) {
          assert.equal(count(await allowOf(bots, BOT), rule), 1, `the ${run} run: allow still holds ${rule}, once`);
          if (files.claude) assert.equal(count(await allowedIn(bots, BOT), rule), 1, `the ${run} run: ${settingsOf(bots, BOT)} still allows ${rule}, once`);
          if (files.codex) {
            const lines = await codexAllowedIn(bots, BOT);
            assert.equal(count(lines, line), 1, `the ${run} run: ${codexRulesOf(bots, BOT)} still holds ${line}, once, got:\n${lines.join('\n')}`);
          }
        }
        for (const { rule } of held) assertHoldsLine(result.stdout, box, bots, BOT, rule);
      }
    });
  }
}

test('RM4 rules build --json: the entry of a bot that holds rules for obk run carries them in held', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'claude');
  await ok(box.run(['bot', 'create', '--bots', 'bots', '--name', 'codex-bot', '--harness', 'codex']));
  const held = runRules(box).map(({ rule }) => rule);
  await hold(bots, BOT, held);
  await hold(bots, 'codex-bot', [held[0]]);

  const answer = jsonOf(await box.run(['rules', 'build', '--bots', 'bots', '--json']));

  const heldOf = (entry) => {
    assert.ok(Array.isArray(entry.held), `each permissions entry carries held, a list, got: ${JSON.stringify(entry)}`);
    return entry.held;
  };
  for (const rule of held) assert.equal(count(heldOf(entryAt(answer, BOT, settingsOf(bots, BOT))), rule), 1, `${BOT}'s held names ${rule}`);
  assert.equal(count(heldOf(entryAt(answer, 'codex-bot', codexRulesOf(bots, 'codex-bot'))), held[0]), 1, `codex-bot's held names ${held[0]}`);
  assert.deepEqual(heldOf(entryAt(answer, 'bot-father', settingsOf(bots, 'bot-father'))), [], 'bot-father holds none');
});

for (const [label, harness, files] of HARNESSES) {
  test(`RM4 permission disallow takes back a rule for obk run of ${label}, from allow and its harness file, and no holds line is left for it`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, harness);
    const [gone, kept] = runRules(box);
    await hold(bots, BOT, [gone.rule, kept.rule]);
    await ok(box.run(['rules', 'build', '--bots', 'bots', '--bot', BOT]));

    const result = await permissionDisallow(box, BOT, [gone.rule]);

    assert.equal(result.code, 0, `a rule for a command the kit no longer has is taken back, got:\n${result.stdout}${result.stderr}`);
    assert.equal(count(await allowOf(bots, BOT), gone.rule), 0, `allow no longer holds ${gone.rule}`);
    assert.equal(count(await allowOf(bots, BOT), kept.rule), 1, `the other rule stays: ${kept.rule}`);
    if (files.claude) assert.equal(count(await allowedIn(bots, BOT), gone.rule), 0, `${settingsOf(bots, BOT)} no longer allows ${gone.rule}`);
    if (files.codex) assert.equal(count(await codexAllowedIn(bots, BOT), gone.line), 0, `${codexRulesOf(bots, BOT)} no longer holds ${gone.line}`);

    const after = await ok(box.run(['rules', 'build', '--bots', 'bots', '--bot', BOT]));

    assert.deepEqual(holdsLinesIn(after.stdout).filter((line) => line.includes(gone.rule)), [], `no holds line for the rule taken back, got:\n${after.stdout}`);
    assertHoldsLine(after.stdout, box, bots, BOT, kept.rule);
    assert.equal(count(await allowOf(bots, BOT), gone.rule), 0, 'rules build does not write it back');
  });
}

// ----------------------------------------------------------------- RM5: no default names it

/** Whether a Claude rule names the kit's `run`: by `obk` or a path whose basename is obk, or the kit's own CLI. */
const namesRun = (box, rule) => /^Bash\((?:\S*\/)?obk run(?:[ :]|\))/.test(rule)
  || rule.startsWith(`Bash(${shellWord(box.cli)} run `) || rule.startsWith(`Bash(${shellWord(box.cli)} run:`);

/** Whether a Codex line names the kit's `run`: a pattern whose first word is the kit and whose second is run. */
const lineNamesRun = (box, line) => line.startsWith(`prefix_rule(pattern=[${JSON.stringify(box.cli)}, "run"`)
  || /^prefix_rule\(pattern=\["(?:[^"]*\/)?obk", "run"/.test(line);

for (const [, harness] of HARNESSES) {
  test(`RM5 a bot on ${harness} is given no rule for obk run by the kit, after bot create and after rules build`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, harness);
    await ok(box.run(['rules', 'build', '--bots', 'bots']));

    const allowed = await allowOf(bots, BOT);
    assert.ok(allowed.includes(kitRule(box, bots, 'health')), `the premise: the default set is there, got:\n${JSON.stringify(allowed, null, 2)}`);
    assert.deepEqual(allowed.filter((rule) => namesRun(box, rule)), [], 'no default rule in bot.yaml names obk run');
    if (harness === 'claude') {
      assert.deepEqual((await allowedIn(bots, BOT)).filter((rule) => namesRun(box, rule)), [], 'no rule in the settings names obk run');
    } else {
      const lines = await codexAllowedIn(bots, BOT);
      assert.ok(lines.includes(prefixRule([box.cli, 'health', '--bots', bots])), `the premise: obk.rules holds the default lines, got:\n${lines.join('\n')}`);
      assert.deepEqual(lines.filter((line) => lineNamesRun(box, line)), [], 'no line in obk.rules names obk run');
    }
  });
}

// ----------------------------------------------------------------- RM6: health has no kit-run finding

/** Write `text` to `file`, making its folder. */
async function put(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

test('RM6 obk health gives no finding about rules that let obk run run any command, wherever they are', async (t) => {
  const box = await createSandbox(t);
  // The user's own files are the sandbox's HOME, never the real ones.
  delete box.env.CODEX_HOME;
  delete box.env.CLAUDE_CONFIG_DIR;
  const bots = await withBot(box, 'claude');
  await ok(box.run(['bot', 'create', '--bots', 'bots', '--name', 'cx-bot', '--harness', 'codex']));
  await ok(box.run(['session', 'add', '--bots', 'bots', '--bot', 'cx-bot', '--name', 'daily']));
  await ok(box.run(['up', '--bots', 'bots']));

  // Each was a kit-run rule to #635 (KR1 and KR2 of its test, which #652 removed).
  const claudeRules = ['Bash(obk:*)', 'Bash(obk run:*)', `Bash(${shellWord(box.cli)} run --timeout 300 -- sh:*)`];
  const codexLines = [prefixRule(['obk', 'run']), prefixRule([box.cli])];
  const settingsText = `${JSON.stringify({ permissions: { allow: claudeRules } }, null, 2)}\n`;
  await put(path.join(botHomeOf(bots, BOT), '.claude', 'settings.local.json'), settingsText);
  await put(path.join(bots, '.claude', 'settings.local.json'), settingsText);
  await put(path.join(box.home, '.claude', 'settings.json'), settingsText);
  await put(path.join(box.home, '.codex', 'rules', 'default.rules'), ['# my own rules', ...codexLines, ''].join('\n'));

  const result = await box.run(['health', '--bots', 'bots', '--json']);

  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    assert.fail(`--json should print JSON and nothing else, got: ${result.stdout}${result.stderr} (${error.message})`);
  }
  assert.ok(Array.isArray(answer.found), `the answer should carry a list of findings, got: ${result.stdout}`);
  const about = answer.found.filter((finding) => typeof finding.says === 'string'
    && (finding.says.includes('any command') || finding.says.includes('obk run')
      || claudeRules.some((rule) => finding.says.includes(rule)) || codexLines.some((line) => finding.says.includes(line))));
  assert.deepEqual(about, [], 'health should say nothing about rules for obk run: the kit has no run');
});
