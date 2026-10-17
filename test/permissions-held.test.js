// `obk restart` and `obk bot create` leave the kit's default permission set
// (#548; the architect's ruling D replaces the issue's boundary item 2).
//
// R1. `restart` and `bot create` move from DEFAULT_COMMANDS to KEPT_BACK in
//     src/commands.js (test/command-lists.test.js CL3 and CL4 hold that).
// R2. `bot create`, `init`, `rules build` and `up` no longer write
//     `Bash(<cli> restart --bots <bots>:*)` or `Bash(<cli> bot create --bots
//     <bots>:*)` into a bot's bot.yaml `allow`, its `.claude/settings.json`, or
//     its `.codex/rules/obk.rules`. Every other default is written as before.
// R3. A bot whose `allow` still holds one of those two rules (kit 0.26.0 wrote
//     them, or the user said yes to one) keeps it: `rules build` and `up`
//     remove nothing from `allow`, from the settings file, or from obk.rules.
// R4. `rules build` and `up` name each such bot and rule once (once also for a
//     bot on both harnesses), on a line of their text output:
//       holds      <bot>  <rule>, which is no longer one of the kit's defaults. To take it back:  <cli> permission disallow --bots <bots> --bot <bot> --rule <rule shell-quoted>
//     `holds` padded to 9 characters, then two spaces; the CLI, the bots folder
//     and the rule each one shell word, as `shellWord` gives it. The line does
//     not say the rule is wrong. In `--json`, each permissions entry of the
//     bot carries `held`, the list of those rules its allow holds (an empty
//     list for none). A bot that holds neither gets no `holds` line.
// R5. `obk permission disallow` takes either rule back as it takes back any
//     rule the user allowed (bot.yaml, the settings file, obk.rules); no
//     `holds` line is printed for it afterwards. A rule still in the default
//     set is still refused.
//
// #564 widens R2 to R5 to every rule kit 0.26 gave every bot that is no longer
// in the set (its R2 and R3): besides the rules of `restart` and `bot create`,
// the rules of `session mail` and `session nudge` (commands #555 removed from
// the kit), and `Bash(orca orchestration check --run:*)`, which #564 R1 takes
// out of the set. The kit writes none of the five, keeps each one a bot holds,
// names each one with the `holds` line of R4, and `permission disallow` takes
// each one back. The order of the holds lines is not promised.
//
// The rules are spelled here from the requirement, as kit 0.26.0 spelled its
// defaults (helpers/permissions.js `kitRule`), and the Codex lines as
// `prefixRule` spells them: the CLI and the bots folder plain words. A
// SendMessage rule is neither required nor forbidden.

import assert from 'node:assert/strict';
import { chmod, writeFile } from 'node:fs/promises';
import test from 'node:test';

import { createSandbox, sh, shellWord, skipGit, snapshot } from './helpers/cli.js';
import {
  addedLinesIn,
  allowedIn,
  allowOf,
  codexAllowedIn,
  codexRulesOf,
  entryAt,
  GONE_COMMANDS,
  jsonOf,
  kitRule,
  NO_LONGER_DEFAULT_COMMANDS,
  noLongerDefaultRules,
  ORCA_CHECK_LINE,
  ORCA_CHECK_RULE,
  OWN_RULE,
  permissionDisallow,
  permissionBots,
  prefixRule,
  settingsIn,
  settingsOf,
  writeAllow,
} from './helpers/permissions.js';

const BOT = 'api-bot';

/** A bots folder `init` made, on `harness`. */
async function seeded(box, harness = 'claude', folder = 'bots') {
  const result = await box.run(['init', '--bots', folder, '--harness', harness]);
  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  return box.path(folder);
}

/** One more bot, written through the kit, with the sessions given: `[name, ...settings]` each. */
async function makeBot(box, name, harness = 'claude', sessions = [], folder = 'bots') {
  const made = await box.run(['bot', 'create', '--bots', folder, '--name', name, '--harness', harness]);
  assert.equal(made.code, 0, `${made.stdout}${made.stderr}`);
  for (const [session, ...settings] of sessions) {
    const added = await box.run(['session', 'add', '--bots', folder, '--bot', name, '--name', session, ...settings]);
    assert.equal(added.code, 0, `${added.stdout}${added.stderr}`);
  }
}

/** Run a command that has to go through for the test to mean anything. */
async function ok(promise) {
  const result = await promise;
  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  return result;
}

/** The rule kit 0.26.0 wrote for `restart`. */
const restartRule = (box, bots) => kitRule(box, bots, 'restart');

/** The rule kit 0.26.0 wrote for `bot create`. */
const createRule = (box, bots) => kitRule(box, bots, 'bot create');

/** The rule kit 0.26 wrote for `session mail`, a command #555 removed. */
const mailRule = (box, bots) => kitRule(box, bots, 'session mail');

/** Every rule that left the default set, the five of #564 R2. */
const heldRules = (box, bots) => noLongerDefaultRules(box, bots);

/** The Codex line for a kit command, the CLI and the bots folder plain words. */
const codexLine = (box, bots, command) => prefixRule([box.cli, ...command.split(' '), '--bots', bots]);

/**
 * The five rules of #564 R2 by name, each with its rule and its Codex line:
 * the four kit commands, then Orca's bare check.
 */
const HELD = [
  ...[...NO_LONGER_DEFAULT_COMMANDS, ...GONE_COMMANDS].map((command) => ({
    name: command,
    rule: (box, bots) => kitRule(box, bots, command),
    line: (box, bots) => codexLine(box, bots, command),
  })),
  { name: 'orca orchestration check', rule: () => ORCA_CHECK_RULE, line: () => ORCA_CHECK_LINE },
];

/** The line R4 asks for, built from its words. */
const heldLine = (box, bots, bot, rule) => `${'holds'.padEnd(9)}  ${bot}  ${rule}, which is no longer one of the kit's defaults. `
  + `To take it back:  ${shellWord(box.cli)} permission disallow --bots ${shellWord(bots)} --bot ${shellWord(bot)} --rule ${shellWord(rule)}`;

/** Every `holds` line of a text answer, each trimmed, in order. */
const holdsLinesIn = (stdout) => stdout.split('\n').map((line) => line.trim()).filter((line) => line.startsWith(`${'holds'.padEnd(9)}  `));

/** The `holds` lines about `bot`. */
const holdsLinesOf = (stdout, bot) => holdsLinesIn(stdout).filter((line) => line.startsWith(`${'holds'.padEnd(9)}  ${bot}  `));

/**
 * Put `rules` into the bot's allow by hand, after what it holds, as kit 0.26.0
 * or the user's yes would have left them: each once.
 */
async function hold(bots, bot, rules) {
  const allow = (await allowOf(bots, bot)).filter((rule) => !rules.includes(rule));
  await writeAllow(bots, bot, [...allow, ...rules]);
}

/** How many times `rule` is in `list`. */
const count = (list, rule) => list.filter((one) => one === rule).length;

/** The `held` list of a permissions entry. */
function heldOf(entry) {
  assert.ok(Array.isArray(entry.held), `each permissions entry should carry held, a list, got: ${JSON.stringify(entry)}`);
  return entry.held;
}

const sorted = (list) => [...list].sort();

/** Sessions that make a Codex bot run on Claude too. */
const BOTH = [['daily'], ['review', '--harness', 'claude']];

/** The harnesses a test runs over: label, the bot's harness, its sessions, and which files it has. */
const HARNESSES = [
  ['a Claude bot', 'claude', [['daily']], { claude: true, codex: false }],
  ['a Codex bot', 'codex', [['daily']], { claude: false, codex: true }],
  ['a bot on both harnesses', 'codex', BOTH, { claude: true, codex: true }],
];

/** The two commands R3 and R4 are about, each with what it is run with for the one bot. */
const WRITERS = [
  ['rules build', ['rules', 'build', '--bots', 'bots', '--bot', BOT]],
  ['up', ['up', '--bots', 'bots', '--bot', BOT]],
];

// ----------------------------------------------------------------- the line, as the tests spell it

test('H0 the holds line as the tests spell it, against a worked example', () => {
  // A check of the one place the line is built, against R4's words written out by hand.
  const box = { cli: '/x/bin/obk' };
  const rule = 'Bash(/x/bin/obk restart --bots /x/bots:*)';
  assert.equal(restartRule(box, '/x/bots'), rule);
  assert.equal(createRule(box, '/x/bots'), 'Bash(/x/bin/obk bot create --bots /x/bots:*)');
  assert.equal(
    heldLine(box, '/x/bots', 'api-bot', rule),
    "holds      api-bot  Bash(/x/bin/obk restart --bots /x/bots:*), which is no longer one of the kit's defaults. "
      + "To take it back:  /x/bin/obk permission disallow --bots /x/bots --bot api-bot --rule 'Bash(/x/bin/obk restart --bots /x/bots:*)'",
  );
  assert.equal(codexLine(box, '/x/bots', 'bot create'), 'prefix_rule(pattern=["/x/bin/obk", "bot", "create", "--bots", "/x/bots"], decision="allow")');
});

test('H0 #564: the five rules of R2 and their Codex lines as the tests spell them, against worked examples', () => {
  const box = { cli: '/x/bin/obk' };
  assert.deepEqual(sorted(heldRules(box, '/x/bots')), sorted([
    'Bash(/x/bin/obk restart --bots /x/bots:*)',
    'Bash(/x/bin/obk bot create --bots /x/bots:*)',
    'Bash(/x/bin/obk session mail --bots /x/bots:*)',
    'Bash(/x/bin/obk session nudge --bots /x/bots:*)',
    'Bash(orca orchestration check --run:*)',
  ]));
  assert.deepEqual(HELD.map(({ rule }) => rule(box, '/x/bots')), heldRules(box, '/x/bots'), 'HELD names the same five');
  assert.deepEqual(sorted(HELD.map(({ line }) => line(box, '/x/bots'))), sorted([
    'prefix_rule(pattern=["/x/bin/obk", "restart", "--bots", "/x/bots"], decision="allow")',
    'prefix_rule(pattern=["/x/bin/obk", "bot", "create", "--bots", "/x/bots"], decision="allow")',
    'prefix_rule(pattern=["/x/bin/obk", "session", "mail", "--bots", "/x/bots"], decision="allow")',
    'prefix_rule(pattern=["/x/bin/obk", "session", "nudge", "--bots", "/x/bots"], decision="allow")',
    'prefix_rule(pattern=["orca", "orchestration", "check", "--run"], decision="allow")',
  ]));
  assert.equal(
    heldLine(box, '/x/bots', 'api-bot', ORCA_CHECK_RULE),
    "holds      api-bot  Bash(orca orchestration check --run:*), which is no longer one of the kit's defaults. "
      + "To take it back:  /x/bin/obk permission disallow --bots /x/bots --bot api-bot --rule 'Bash(orca orchestration check --run:*)'",
  );
  assert.equal(
    heldLine(box, '/x/bots', 'api-bot', mailRule(box, '/x/bots')),
    "holds      api-bot  Bash(/x/bin/obk session mail --bots /x/bots:*), which is no longer one of the kit's defaults. "
      + "To take it back:  /x/bin/obk permission disallow --bots /x/bots --bot api-bot --rule 'Bash(/x/bin/obk session mail --bots /x/bots:*)'",
  );
});

// ----------------------------------------------------------------- R2: the kit writes neither rule

test('H2 R2 (#564 R1) init and bot create of Claude bots write none of the five rules, and write the other defaults', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  const made = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(made.code, 0, `${made.stdout}${made.stderr}`);
  const created = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  assert.equal(created.code, 0, `${created.stdout}${created.stderr}`);

  for (const [bot, result] of [['bot-father', made], [BOT, created]]) {
    const allow = await allowOf(bots, bot);
    const settings = await allowedIn(bots, bot);
    // The contrast: the defaults beside them are written.
    for (const command of ['up', 'unpause', 'bot change', 'rules build']) {
      assert.ok(allow.includes(kitRule(box, bots, command)), `${bot}'s allow should hold the default for ${command}, got:\n${JSON.stringify(allow, null, 2)}`);
      assert.ok(settings.includes(kitRule(box, bots, command)), `${settingsOf(bots, bot)} should allow the default for ${command}`);
    }
    for (const rule of heldRules(box, bots)) {
      assert.equal(count(allow, rule), 0, `${bot}'s allow should not hold ${rule}, got:\n${JSON.stringify(allow, null, 2)}`);
      assert.equal(count(settings, rule), 0, `${settingsOf(bots, bot)} should not allow ${rule}`);
      assert.ok(!addedLinesIn(result.stdout).some((line) => line.endsWith(rule)), `no allowed line should name ${rule}, got:\n${result.stdout}`);
    }
  }
});

test('H2 R2 (#564 R1) init and bot create of Codex bots write none of the five rules, nor their lines in obk.rules, and write the other defaults', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box, 'codex');
  await makeBot(box, BOT, 'codex');

  for (const bot of ['bot-father', BOT]) {
    const allow = await allowOf(bots, bot);
    const lines = await codexAllowedIn(bots, bot);
    assert.ok(allow.includes(kitRule(box, bots, 'up')), `the contrast: ${bot}'s allow holds the default for up, got:\n${JSON.stringify(allow, null, 2)}`);
    assert.ok(lines.includes(codexLine(box, bots, 'up')), `the contrast: ${codexRulesOf(bots, bot)} holds the line for up, got:\n${lines.join('\n')}`);
    for (const { name, rule, line } of HELD) {
      assert.equal(count(allow, rule(box, bots)), 0, `${bot}'s allow should not hold the rule for ${name}, got:\n${JSON.stringify(allow, null, 2)}`);
      assert.equal(count(lines, line(box, bots)), 0, `${codexRulesOf(bots, bot)} should hold no line for ${name}, got:\n${lines.join('\n')}`);
    }
  }
});

for (const [writer, args] of WRITERS) {
  for (const [label, harness, sessions, files] of HARNESSES) {
    test(`H2 R2 (#564 R1) ${writer} of ${label} whose allow is empty writes every default back but none of the five rules`, async (t) => {
      const box = await createSandbox(t);
      const bots = await seeded(box);
      await makeBot(box, BOT, harness, sessions);
      await writeAllow(bots, BOT, []);

      await ok(box.run(args));

      const allow = await allowOf(bots, BOT);
      assert.ok(allow.includes(kitRule(box, bots, 'unpause')), `the contrast: the default for unpause is written back, got:\n${JSON.stringify(allow, null, 2)}`);
      for (const { name, rule: ruleOf, line } of HELD) {
        const rule = ruleOf(box, bots);
        assert.equal(count(allow, rule), 0, `allow should not hold ${rule}, got:\n${JSON.stringify(allow, null, 2)}`);
        if (files.claude) assert.equal(count(await allowedIn(bots, BOT), rule), 0, `${settingsOf(bots, BOT)} should not allow ${rule}`);
        if (files.codex) assert.equal(count(await codexAllowedIn(bots, BOT), line(box, bots)), 0, `${codexRulesOf(bots, BOT)} should hold no line for ${name}`);
      }
    });
  }
}

// ----------------------------------------------------------------- R3: a bot that holds them keeps them

for (const [writer, args] of WRITERS) {
  for (const [label, harness, sessions, files] of HARNESSES) {
    test(`H3 R3 (#564 R2) ${writer} of ${label} whose allow holds all five rules removes none, from allow or its harness files`, async (t) => {
      const box = await createSandbox(t);
      const bots = await seeded(box);
      await makeBot(box, BOT, harness, sessions);
      await hold(bots, BOT, [...heldRules(box, bots), OWN_RULE]);

      await ok(box.run(args));
      await ok(box.run(args));

      const allow = await allowOf(bots, BOT);
      for (const { name, rule: ruleOf, line } of HELD) {
        const rule = ruleOf(box, bots);
        assert.equal(count(allow, rule), 1, `allow should still hold ${rule}, once, got:\n${JSON.stringify(allow, null, 2)}`);
        if (files.claude) assert.equal(count(await allowedIn(bots, BOT), rule), 1, `${settingsOf(bots, BOT)} should still allow ${rule}, once`);
        if (files.codex) {
          const lines = await codexAllowedIn(bots, BOT);
          assert.equal(count(lines, line(box, bots)), 1, `${codexRulesOf(bots, BOT)} should still hold the line for ${name}, once, got:\n${lines.join('\n')}`);
        }
      }
      assert.equal(count(allow, OWN_RULE), 1, 'the user\'s own rule stays too');
    });
  }
}

// ----------------------------------------------------------------- R4: the holds line

for (const [writer, args] of WRITERS) {
  for (const [label, harness, sessions] of HARNESSES) {
    test(`H4 R4 (#564 R2) ${writer} of ${label} that holds all five rules names each once, with the command that takes it back, at every run`, async (t) => {
      const box = await createSandbox(t);
      const bots = await seeded(box);
      await makeBot(box, BOT, harness, sessions);
      await hold(bots, BOT, heldRules(box, bots));

      for (const run of ['first', 'second']) {
        const result = await ok(box.run(args));

        const expected = heldRules(box, bots).map((rule) => heldLine(box, bots, BOT, rule));
        assert.deepEqual(sorted(holdsLinesIn(result.stdout)), sorted(expected), `the ${run} run: one holds line for each rule, exactly as R4 spells it, and no other, got:\n${result.stdout}`);
        const aboutThem = result.stdout.split('\n').filter((line) => heldRules(box, bots).some((rule) => line.includes(rule)));
        assert.deepEqual(aboutThem.filter((line) => /\bwrong\b/i.test(line)), [], `no line should say the rule is wrong, got:\n${result.stdout}`);
      }
    });
  }
}

test('H4 R4 a bot that holds only one rule gets one line; a bot that holds neither gets none', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, BOT, 'claude');
  await makeBot(box, 'codex-bot', 'codex');
  const two = [restartRule(box, bots), createRule(box, bots)];
  await hold(bots, BOT, two);
  await hold(bots, 'codex-bot', [createRule(box, bots)]);

  const result = await ok(box.run(['rules', 'build', '--bots', 'bots']));

  assert.deepEqual(sorted(holdsLinesOf(result.stdout, BOT)), sorted(two.map((rule) => heldLine(box, bots, BOT, rule))), `two lines for ${BOT}, got:\n${result.stdout}`);
  assert.deepEqual(holdsLinesOf(result.stdout, 'codex-bot'), [heldLine(box, bots, 'codex-bot', createRule(box, bots))], `one line for codex-bot, got:\n${result.stdout}`);
  assert.deepEqual(holdsLinesOf(result.stdout, 'bot-father'), [], `bot-father holds neither, so no line, got:\n${result.stdout}`);
  assert.equal(holdsLinesIn(result.stdout).length, 3, `three holds lines in all, got:\n${result.stdout}`);
});

// #564 R2: each of the three new rules alone, on each harness, gets its own
// line and nothing else does; bot-father, which holds none, gets none.
for (const { name, rule: ruleOf } of HELD.filter(({ name }) => !NO_LONGER_DEFAULT_COMMANDS.includes(name))) {
  for (const [writer, args] of WRITERS) {
    test(`H4 #564 R2 ${writer} of a Claude bot and a Codex bot that hold only the ${name} rule names it once for each, and nothing for bot-father`, async (t) => {
      const box = await createSandbox(t);
      const bots = await seeded(box);
      await makeBot(box, BOT, 'claude', [['daily']]);
      await makeBot(box, 'codex-bot', 'codex', [['daily']]);
      const rule = ruleOf(box, bots);
      await hold(bots, BOT, [rule]);
      await hold(bots, 'codex-bot', [rule]);
      const all = args.filter((arg) => arg !== '--bot' && arg !== BOT);

      const result = await ok(box.run(all));

      assert.deepEqual(
        sorted(holdsLinesIn(result.stdout)),
        sorted([heldLine(box, bots, BOT, rule), heldLine(box, bots, 'codex-bot', rule)]),
        `one holds line for each bot, exactly as R4 spells it, and no other, got:\n${result.stdout}`,
      );
      assert.equal(count(await allowOf(bots, BOT), rule), 1, `${BOT} still holds ${rule}`);
      assert.equal(count(await allowOf(bots, 'codex-bot'), rule), 1, `codex-bot still holds ${rule}`);
      assert.ok(!addedLinesIn(result.stdout).some((line) => line.endsWith(rule)), `no allowed line should name ${rule}, got:\n${result.stdout}`);
    });
  }
}

test('H4 R4 rules build --json: each entry carries held, the rules its bot holds, and an empty list for a bot that holds neither', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, BOT, 'claude');
  await makeBot(box, 'codex-bot', 'codex');
  await hold(bots, BOT, heldRules(box, bots));
  await hold(bots, 'codex-bot', [restartRule(box, bots), ORCA_CHECK_RULE]);

  const answer = jsonOf(await box.run(['rules', 'build', '--bots', 'bots', '--json']));

  assert.deepEqual(sorted(permissionBots(answer)), ['api-bot', 'bot-father', 'codex-bot']);
  assert.deepEqual(sorted(heldOf(entryAt(answer, BOT, settingsOf(bots, BOT)))), sorted(heldRules(box, bots)));
  assert.deepEqual(sorted(heldOf(entryAt(answer, 'codex-bot', codexRulesOf(bots, 'codex-bot')))), sorted([restartRule(box, bots), ORCA_CHECK_RULE]));
  assert.deepEqual(heldOf(entryAt(answer, 'bot-father', settingsOf(bots, 'bot-father'))), []);
});

for (const [writer, args] of WRITERS) {
  test(`H4 R4 ${writer} --json of a bot on both harnesses: the entry for each file carries held`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await makeBot(box, BOT, 'codex', BOTH);
    await hold(bots, BOT, heldRules(box, bots));

    const answer = jsonOf(await box.run([...args, '--json']));

    assert.deepEqual(permissionBots(answer), [BOT, BOT], 'one entry per harness file');
    for (const file of [settingsOf(bots, BOT), codexRulesOf(bots, BOT)]) {
      assert.deepEqual(sorted(heldOf(entryAt(answer, BOT, file))), sorted(heldRules(box, bots)), `the entry for ${file}`);
    }
  });
}

test('H4 R4 in a bots folder with an apostrophe and a space, the line quotes the CLI, the folder and the rule, and its command takes the rule back', async (t) => {
  const box = await createSandbox(t);
  const folder = "bob's bots";
  const bots = await seeded(box, 'claude', folder);
  await makeBot(box, BOT, 'claude', [], folder);
  const rule = restartRule(box, bots);
  assert.notEqual(shellWord(bots), bots, 'the premise: the folder needs quoting');
  await hold(bots, BOT, [rule]);

  const result = await ok(box.run(['rules', 'build', '--bots', folder]));

  const expected = heldLine(box, bots, BOT, rule);
  assert.deepEqual(holdsLinesIn(result.stdout), [expected], `one holds line, exactly as R4 spells it, got:\n${result.stdout}`);

  // The command on the line, run as a user would paste it into a shell.
  const command = expected.slice(expected.indexOf('To take it back:  ') + 'To take it back:  '.length);
  const taken = await sh(command, { cwd: box.cwd, env: box.env });
  assert.equal(taken.code, 0, `the printed command should go through, got:\n${taken.stdout}${taken.stderr}`);
  assert.equal(count(await allowOf(bots, BOT), rule), 0, 'the rule left allow');
  assert.equal(count(await allowedIn(bots, BOT), rule), 0, 'and the settings file');
});

for (const { name, rule: ruleOf, line } of HELD.filter(({ name }) => !NO_LONGER_DEFAULT_COMMANDS.includes(name))) {
  test(`H4 #564 R2 R3 in a bots folder with an apostrophe and a space, the line for the ${name} rule of a bot on both harnesses is right, and its command takes the rule back from allow and both harness files`, async (t) => {
    const box = await createSandbox(t);
    const folder = "bob's bots";
    const bots = await seeded(box, 'claude', folder);
    await makeBot(box, BOT, 'codex', BOTH, folder);
    const rule = ruleOf(box, bots);
    await hold(bots, BOT, [rule]);

    const result = await ok(box.run(['rules', 'build', '--bots', folder]));

    const expected = heldLine(box, bots, BOT, rule);
    assert.deepEqual(holdsLinesIn(result.stdout), [expected], `one holds line, exactly as R4 spells it, got:\n${result.stdout}`);
    assert.equal(count(await codexAllowedIn(bots, BOT), line(box, bots)), 1, 'the premise: obk.rules holds its line');

    // The command on the line, run as a user would paste it into a shell.
    const command = expected.slice(expected.indexOf('To take it back:  ') + 'To take it back:  '.length);
    const taken = await sh(command, { cwd: box.cwd, env: box.env });
    assert.equal(taken.code, 0, `the printed command should go through, got:\n${taken.stdout}${taken.stderr}`);
    assert.equal(count(await allowOf(bots, BOT), rule), 0, 'the rule left allow');
    assert.equal(count(await allowedIn(bots, BOT), rule), 0, 'and the settings file');
    assert.equal(count(await codexAllowedIn(bots, BOT), line(box, bots)), 0, 'and obk.rules');
  });
}

// A harness file the kit cannot write as it expects does not hide what the
// bot's allow holds: when allow can be read, the holds lines and `held` still
// name both rules (the reviewer's finding on PR #549). The reproduction: the
// settings file's `permissions.allow` set to `{}`, valid JSON of the wrong shape.

/** The settings file kept as it is, but `permissions.allow` a mapping, as a hand edit might leave it. */
async function breakSettings(bots, bot) {
  const settings = (await settingsIn(bots, bot)) ?? {};
  settings.permissions = { ...settings.permissions, allow: {} };
  await writeFile(settingsOf(bots, bot), `${JSON.stringify(settings, null, 2)}\n`);
}

/** The answer of a `--json` run, parsed, whatever its exit code: the trouble may make it non-zero. */
function answerOf(result) {
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout}${result.stderr} (${error.message})`);
  }
  assert.ok(Array.isArray(answer.permissions), `the answer should carry a permissions list, got: ${result.stdout}`);
  return answer;
}

// `up` is not run here: with this file it refuses the whole command, with
// nothing on stdout and no permissions report, so it has no report to name them in.
{
  const args = ['rules', 'build', '--bots', 'bots', '--bot', BOT];
  test('H4 R4 rules build of a bot whose settings file it refuses to write still names both rules its allow holds, in text and in held', async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await makeBot(box, BOT, 'claude', [['daily']]);
    await hold(bots, BOT, heldRules(box, bots));
    await ok(box.run(['rules', 'build', '--bots', 'bots', '--bot', BOT]));
    await breakSettings(bots, BOT);

    const plain = await box.run(args);
    const answer = answerOf(await box.run([...args, '--json']));

    // The premises: the file's trouble is reported, and allow still holds both rules.
    assert.ok(plain.stdout.split('\n').some((line) => line.trim().startsWith(`${'refused'.padEnd(9)}  `)), `the premise: a refused line about the settings file, got:\n${plain.stdout}${plain.stderr}`);
    const allow = await allowOf(bots, BOT);
    for (const rule of heldRules(box, bots)) assert.equal(count(allow, rule), 1, `the premise: allow still holds ${rule}`);

    // Both claims in one comparison, so a failure shows the text and the JSON together.
    assert.deepEqual(
      { holds: sorted(holdsLinesIn(plain.stdout)), held: sorted(heldOf(entryAt(answer, BOT, settingsOf(bots, BOT)))) },
      { holds: sorted(heldRules(box, bots).map((rule) => heldLine(box, bots, BOT, rule))), held: sorted(heldRules(box, bots)) },
      `one holds line for each rule allow holds, and held naming both, though the settings file was refused, got:\n${plain.stdout}${plain.stderr}`,
    );
  });
}

// The same for a bot whose obk.rules the kit may not write (the reviewer's ask
// on PR #549): the file is read-only, and a rule of the user's own is added to
// allow after the first build, so the next build has to write it.
for (const [label, sessions, files] of [
  ['a bot only on Codex', [['daily']], ['codex']],
  ['a bot on both harnesses', BOTH, ['claude', 'codex']],
]) {
  test(`H4 R4 rules build of ${label} whose obk.rules it may not write still names both rules its allow holds, in text and in held on each entry`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await makeBot(box, BOT, 'codex', sessions);
    await hold(bots, BOT, heldRules(box, bots));
    await ok(box.run(['rules', 'build', '--bots', 'bots', '--bot', BOT]));
    await hold(bots, BOT, [OWN_RULE]);
    const rules = codexRulesOf(bots, BOT);
    await chmod(rules, 0o444);
    t.after(() => chmod(rules, 0o644).catch(() => {}));
    const args = ['rules', 'build', '--bots', 'bots', '--bot', BOT];

    const plain = await box.run(args);
    const answer = answerOf(await box.run([...args, '--json']));

    // The premises: the file's trouble is reported, and allow still holds both rules.
    assert.ok(plain.stdout.split('\n').some((line) => line.trim().startsWith(`${'refused'.padEnd(9)}  `)), `the premise: a refused line about obk.rules, got:\n${plain.stdout}${plain.stderr}`);
    const allow = await allowOf(bots, BOT);
    for (const rule of heldRules(box, bots)) assert.equal(count(allow, rule), 1, `the premise: allow still holds ${rule}`);

    const entryFiles = { claude: settingsOf(bots, BOT), codex: rules };
    // All claims in one comparison, so a failure shows the text and the JSON together.
    assert.deepEqual(
      {
        holds: sorted(holdsLinesIn(plain.stdout)),
        held: Object.fromEntries(files.map((harness) => [harness, sorted(heldOf(entryAt(answer, BOT, entryFiles[harness])))])),
      },
      {
        holds: sorted(heldRules(box, bots).map((rule) => heldLine(box, bots, BOT, rule))),
        held: Object.fromEntries(files.map((harness) => [harness, sorted(heldRules(box, bots))])),
      },
      `one holds line for each rule allow holds, and held naming both on each entry, though obk.rules was refused, got:\n${plain.stdout}${plain.stderr}`,
    );
  });
}

// ----------------------------------------------------------------- R5: permission disallow takes them back

for (const [at, { name: command, rule: ruleOf, line: lineOf }] of HELD.entries()) {
  for (const [label, harness, sessions, files] of HARNESSES) {
    test(`H5 R5 (#564 R3) permission disallow takes back the ${command} rule of ${label}, from allow and its harness files, and no holds line is left for it`, async (t) => {
      const box = await createSandbox(t);
      const bots = await seeded(box);
      await makeBot(box, BOT, harness, sessions);
      // The other is the next of the five: one that stays, to show only the one asked for leaves.
      const next = HELD[(at + 1) % HELD.length];
      const [rule, other] = [ruleOf(box, bots), next.rule(box, bots)];
      const otherCommand = next.name;
      await hold(bots, BOT, [rule, other]);
      await ok(box.run(['rules', 'build', '--bots', 'bots', '--bot', BOT]));

      const result = await permissionDisallow(box, BOT, [rule]);

      assert.equal(result.code, 0, `the rule is no longer a default, so it is taken back, got:\n${result.stdout}${result.stderr}`);
      const allow = await allowOf(bots, BOT);
      assert.equal(count(allow, rule), 0, `allow should no longer hold ${rule}, got:\n${JSON.stringify(allow, null, 2)}`);
      assert.equal(count(allow, other), 1, `the other rule stays, got:\n${JSON.stringify(allow, null, 2)}`);
      if (files.claude) {
        const settings = await allowedIn(bots, BOT);
        assert.equal(count(settings, rule), 0, `${settingsOf(bots, BOT)} should no longer allow ${rule}`);
        assert.equal(count(settings, other), 1, `${settingsOf(bots, BOT)} still allows ${other}`);
      }
      if (files.codex) {
        const lines = await codexAllowedIn(bots, BOT);
        assert.equal(count(lines, lineOf(box, bots)), 0, `${codexRulesOf(bots, BOT)} should no longer hold the line for ${command}, got:\n${lines.join('\n')}`);
        assert.equal(count(lines, next.line(box, bots)), 1, `${codexRulesOf(bots, BOT)} still holds the line for ${otherCommand}`);
      }

      const after = await ok(box.run(['rules', 'build', '--bots', 'bots', '--bot', BOT]));

      assert.deepEqual(holdsLinesIn(after.stdout), [heldLine(box, bots, BOT, other)], `only the rule still held is named, got:\n${after.stdout}`);
      assert.equal(count(await allowOf(bots, BOT), rule), 0, 'rules build does not write the rule back');
      if (files.claude) assert.equal(count(await allowedIn(bots, BOT), rule), 0, 'nor into the settings file');
      if (files.codex) assert.equal(count(await codexAllowedIn(bots, BOT), lineOf(box, bots)), 0, 'nor its line into obk.rules');
    });
  }
}

test('H5 R5 a rule still in the default set is still refused, beside a rule that left it, and nothing changes', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, BOT, 'claude');
  await hold(bots, BOT, heldRules(box, bots));
  await ok(box.run(['rules', 'build', '--bots', 'bots', '--bot', BOT]));
  const upRule = kitRule(box, bots, 'up');
  assert.ok((await allowOf(bots, BOT)).includes(upRule), 'the premise: allow holds the default for up');
  const before = await snapshot(bots, skipGit);

  const result = await permissionDisallow(box, BOT, [restartRule(box, bots), upRule]);

  assert.notEqual(result.code, 0, `the default for up is refused, got:\n${result.stdout}${result.stderr}`);
  assert.ok(result.stderr.includes(upRule), `the refusal names ${upRule}, got:\n${result.stderr}`);
  assert.match(result.stderr, /default/i, `the refusal says it is one of the kit's defaults, got:\n${result.stderr}`);
  const now = await snapshot(bots, skipGit);
  const changed = Object.keys({ ...before, ...now }).filter((rel) => before[rel] !== now[rel]);
  assert.deepEqual(changed, [], 'a refusal changes nothing, the restart rule included');

  const alone = await permissionDisallow(box, BOT, [restartRule(box, bots)]);
  assert.equal(alone.code, 0, `the restart rule alone is taken back, got:\n${alone.stdout}${alone.stderr}`);
});

test('H5 #564 R3 permission disallow of the orca check rule beside a rule still in the set is refused for the default alone, and the orca rule alone is taken back', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, BOT, 'claude');
  await hold(bots, BOT, [ORCA_CHECK_RULE]);
  await ok(box.run(['rules', 'build', '--bots', 'bots', '--bot', BOT]));
  const upRule = kitRule(box, bots, 'up');
  const before = await snapshot(bots, skipGit);

  const result = await permissionDisallow(box, BOT, [ORCA_CHECK_RULE, upRule]);

  assert.notEqual(result.code, 0, `the default for up is refused, got:\n${result.stdout}${result.stderr}`);
  assert.ok(result.stderr.includes(upRule), `the refusal names ${upRule}, got:\n${result.stderr}`);
  const now = await snapshot(bots, skipGit);
  const changed = Object.keys({ ...before, ...now }).filter((rel) => before[rel] !== now[rel]);
  assert.deepEqual(changed, [], 'a refusal changes nothing, the orca rule included');

  const alone = await permissionDisallow(box, BOT, [ORCA_CHECK_RULE]);
  assert.equal(alone.code, 0, `the orca rule alone is taken back, got:\n${alone.stdout}${alone.stderr}`);
  assert.equal(count(await allowOf(bots, BOT), ORCA_CHECK_RULE), 0, 'it left allow');
  assert.equal(count(await allowedIn(bots, BOT), ORCA_CHECK_RULE), 0, 'and the settings file');
});
