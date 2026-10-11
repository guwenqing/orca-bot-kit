// The kit's default permission rules, written for every bot with nobody asked
// (#527; it replaces #344's "waiting for the user's yes", and #354 slice C for
// Codex).
//
// The kit's own commands are allowed by the kit's code. The default set
// (helpers/permissions.js spells it from the requirement) is one rule per kit
// command a bot runs, narrowed to this bots folder and to the kit's own CLI,
// reading a long message's body beside the bots folder, the commit rule, and
// Orca's orchestration check. `init`, `retire`, `pause`, the three
// `permission` commands, and since #548 `restart` and `bot create`, are never
// in it, and no broad rule is. A bot that runs
// only on Codex gets the set without the Read rule, in Codex's own form in
// `.codex/rules/obk.rules`. A bot runs on Claude when its harness is `claude`
// or any of its sessions says `harness: claude`, and on Codex the same way with
// `codex`; it can run on both.
//
// `bot create`, `rules build` and `up` (and so `init` and `restart`, which
// bring bots up) add each default rule a bot's `allow` lacks, after the
// entries already there, keeping the user's entries and their order, and then
// write the harness files. Nothing waits for a yes: no answer says a rule
// waits, and no `waiting` list is offered. The text answer names each default
// rule it added on a line of its own, `allowed    <bot>  <rule>`; in `--json`
// each `permissions` entry carries `defaults`, the default rules this run added
// to that bot's `allow`. Run again, nothing is added. The kit adds no rule
// outside the set by itself.
//
// The set has no order the tests rely on, except that rules already in `allow`
// keep their place. A SendMessage rule may or may not be in it; every check
// here leaves SendMessage rules out.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  botHomeOf,
  conversationOnRecord,
  createSandbox,
  recordSession,
  sessionIn,
  shellWord,
} from './helpers/cli.js';
import {
  addedLinesIn,
  allowedIn,
  allowOf,
  assertAddedLines,
  assertDefaultsAppended,
  assertEntryWaitsForNothing,
  assertNothingWaits,
  assertSameRules,
  codexAllowedIn,
  codexDefaultLines,
  codexDefaultRules,
  codexRulesOf,
  defaultRules,
  defaultsOf,
  entryAt,
  jsonOf,
  KIT_COMMANDS,
  kitRule,
  NOT_DEFAULT_COMMANDS,
  notDefaultRules,
  ORCA_CHECK_RULE,
  OWN_RULE,
  permissionBots,
  prefixRule,
  readDefault,
  settingsIn,
  settingsOf,
  withoutSendMessage,
  writeAllow,
} from './helpers/permissions.js';

/** A bots folder `init` made, on `harness`. */
async function seeded(box, harness = 'claude', folder = 'bots') {
  const result = await box.run(['init', '--bots', folder, '--harness', harness]);
  assert.equal(result.code, 0, result.stderr);
  return box.path(folder);
}

/** One more bot, written through the kit, with the sessions given: `[name, ...settings]` each. */
async function makeBot(box, name, harness = 'claude', sessions = [], folder = 'bots') {
  const made = await box.run(['bot', 'create', '--bots', folder, '--name', name, '--harness', harness]);
  assert.equal(made.code, 0, made.stderr);
  for (const [session, ...settings] of sessions) {
    const added = await box.run(['session', 'add', '--bots', folder, '--bot', name, '--name', session, ...settings]);
    assert.equal(added.code, 0, added.stderr);
  }
}

/** The one `permissions` entry about `bot` (a bot on one harness has one). */
function entryOf(answer, bot) {
  const found = answer.permissions.filter((entry) => entry.bot === bot);
  assert.equal(found.length, 1, `one permissions entry should be about ${bot}, got: ${JSON.stringify(answer.permissions)}`);
  return found[0];
}

/** Run a command that has to go through for the test to mean anything. */
async function ok(promise) {
  const result = await promise;
  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  return result;
}

// ----------------------------------------------------------------- the set itself

test('D0 the set as the tests spell it: every kit command but the kept-back ones, once each', (t) => {
  // A check of the helper against the requirement, so a slip in the one place
  // the set is spelled does not pass quietly.
  const box = { cli: '/x/bin/obk' };
  const rules = defaultRules(box, '/x/bots');
  assert.equal(new Set(rules).size, rules.length, 'each rule once');
  // #548 R1: restart and bot create no longer among them (#527 had 36, #548
  // 34). #555 removed session nudge and session mail from the kit: 32.
  assert.equal(KIT_COMMANDS.length, 32);
  for (const command of NOT_DEFAULT_COMMANDS) {
    assert.ok(!rules.includes(kitRule(box, '/x/bots', command)), `${command} is not in the set`);
  }
  assert.ok(rules.includes('Bash(/x/bin/obk temp make --bots /x/bots:*)'));
  assert.ok(rules.includes('Bash(/x/bin/obk bot change --bots /x/bots:*)'));
  assert.ok(rules.includes('Bash(/x/bin/obk session answer --bots /x/bots:*)'));
  assert.ok(rules.includes(ORCA_CHECK_RULE));
  assert.equal(readDefault(box, '/x/bots'), 'Read(//x/bots.messages/**)');
  assert.equal(codexDefaultRules(box, '/x/bots').length, rules.length - 1, 'Codex: the set without the Read rule');
  assert.ok(codexDefaultLines(box, '/x/bots').includes('prefix_rule(pattern=["orca", "orchestration", "check", "--run"], decision="allow")'));
  assert.ok(codexDefaultLines(box, '/x/bots').includes('prefix_rule(pattern=["/x/bin/obk", "temp", "trust-hooks", "--bots", "/x/bots"], decision="allow")'));
});

// ----------------------------------------------------------------- bot create

test('D1 bot create of a Claude bot writes the whole set into its allow and its settings, with no question', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);

  const result = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude']);

  assert.equal(result.code, 0, result.stderr);
  assertSameRules(await allowOf(bots, 'api-bot'), defaultRules(box, bots), 'bot.yaml allow should hold exactly the default set, each rule once');
  assertSameRules(await allowedIn(bots, 'api-bot'), defaultRules(box, bots), `${settingsOf(bots, 'api-bot')} should allow exactly the default set`);
});

test('D1 bot create names each default rule it added, with the bot, and offers nothing to wait for', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);

  const result = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude']);

  assert.equal(result.code, 0, result.stderr);
  assertAddedLines(result.stdout, 'api-bot', defaultRules(box, bots));
  assertNothingWaits(result.stdout);
});

test('D1 bot create --json: one entry for the bot, its defaults the whole set, and no waiting list', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);

  const answer = jsonOf(await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude', '--json']));

  assert.deepEqual(permissionBots(answer), ['api-bot'], 'one entry, about the one bot the command was about');
  const entry = entryOf(answer, 'api-bot');
  assertSameRules(defaultsOf(entry), defaultRules(box, bots));
  assertEntryWaitsForNothing(entry);
});

test('D2 bot create of a bot that runs only on Codex writes the set without the Read rule, in Codex form into obk.rules', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);

  const result = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'codex-bot', '--harness', 'codex']);

  assert.equal(result.code, 0, result.stderr);
  assertSameRules(await allowOf(bots, 'codex-bot'), codexDefaultRules(box, bots), 'bot.yaml allow holds the set without the Read rule, in Claude text');
  assertSameRules(await codexAllowedIn(bots, 'codex-bot'), codexDefaultLines(box, bots), `${codexRulesOf(bots, 'codex-bot')} should hold every default in Codex's form`);
  assert.equal(await settingsIn(bots, 'codex-bot'), undefined, 'a bot only on Codex has no Claude settings');
  assertAddedLines(result.stdout, 'codex-bot', codexDefaultRules(box, bots));
  assert.ok(!result.stdout.includes(readDefault(box, bots)), `a Codex bot needs no Read rule, got:\n${result.stdout}`);
  assertNothingWaits(result.stdout);
});

test('D2 bot create --json of a Codex bot: one entry, for its obk.rules, its defaults the set without the Read rule', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);

  const answer = jsonOf(await box.run(['bot', 'create', '--bots', 'bots', '--name', 'codex-bot', '--harness', 'codex', '--json']));

  assert.deepEqual(permissionBots(answer), ['codex-bot'], 'one entry: the bot has one harness file');
  const entry = entryAt(answer, 'codex-bot', codexRulesOf(bots, 'codex-bot'));
  assertSameRules(defaultsOf(entry), codexDefaultRules(box, bots));
  assertEntryWaitsForNothing(entry);
});

// ----------------------------------------------------------------- init

test('D3 init --harness claude writes Bot Father the whole set, names each rule, and offers nothing to wait for', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');

  const plain = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assert.equal(plain.code, 0, plain.stderr);
  assertSameRules(await allowOf(bots, 'bot-father'), defaultRules(box, bots));
  assertSameRules(await allowedIn(bots, 'bot-father'), defaultRules(box, bots));
  assertAddedLines(plain.stdout, 'bot-father', defaultRules(box, bots));
  assertNothingWaits(plain.stdout);

  const other = await createSandbox(t);
  const answer = jsonOf(await other.run(['init', '--bots', 'bots', '--harness', 'claude', '--json']));
  const entry = entryOf(answer, 'bot-father');
  assertSameRules(defaultsOf(entry), defaultRules(other, other.path('bots')));
  assertEntryWaitsForNothing(entry);
});

test('D3 init --harness codex writes Bot Father the set without the Read rule, in Codex form', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');

  const plain = await box.run(['init', '--bots', 'bots', '--harness', 'codex']);

  assert.equal(plain.code, 0, plain.stderr);
  assertSameRules(await allowOf(bots, 'bot-father'), codexDefaultRules(box, bots));
  assertSameRules(await codexAllowedIn(bots, 'bot-father'), codexDefaultLines(box, bots));
  assertAddedLines(plain.stdout, 'bot-father', codexDefaultRules(box, bots));
  assertNothingWaits(plain.stdout);

  const other = await createSandbox(t);
  const otherBots = other.path('bots');
  const answer = jsonOf(await other.run(['init', '--bots', 'bots', '--harness', 'codex', '--json']));
  assert.deepEqual(permissionBots(answer), ['bot-father']);
  const entry = entryAt(answer, 'bot-father', codexRulesOf(otherBots, 'bot-father'));
  assertSameRules(defaultsOf(entry), codexDefaultRules(other, otherBots));
  assertEntryWaitsForNothing(entry);
});

// ----------------------------------------------------------------- what is never in it

for (const [label, harness] of [['a Claude bot', 'claude'], ['a Codex bot', 'codex']]) {
  test(`D4 ${label} is given no rule for init, retire, pause, the permission commands, restart or bot create, and nothing broad`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await makeBot(box, 'api-bot', harness, [['daily']]);
    await ok(box.run(['rules', 'build', '--bots', 'bots']));
    await ok(box.run(['up', '--bots', 'bots']));

    const allow = await allowOf(bots, 'api-bot');
    for (const rule of notDefaultRules(box, bots)) {
      assert.ok(!allow.includes(rule), `${rule} keeps the user's yes and is not written by the kit, got:\n${JSON.stringify(allow, null, 2)}`);
    }
    const cli = shellWord(box.cli);
    const broad = allow.filter((rule) => [`Bash(${cli}:*)`, `Bash(${cli} *)`, 'Bash(orca:*)', 'Bash', 'Bash(*)', 'Read', 'Edit', 'Write'].includes(rule));
    assert.deepEqual(broad, [], 'no broad rule');
    if (harness === 'codex') {
      const lines = await codexAllowedIn(bots, 'api-bot');
      for (const command of NOT_DEFAULT_COMMANDS) {
        const line = prefixRule([box.cli, ...command.split(' '), '--bots', bots]);
        assert.ok(!lines.includes(line), `no Codex line for ${command}, got:\n${lines.join('\n')}`);
      }
    } else {
      const lines = await allowedIn(bots, 'api-bot');
      for (const rule of notDefaultRules(box, bots)) {
        assert.ok(!lines.includes(rule), `no settings rule ${rule}`);
      }
    }
  });
}

// ----------------------------------------------------------------- rules build and up add what a bot lacks

for (const [writer, args] of [
  ['rules build', ['rules', 'build', '--bots', 'bots', '--bot', 'api-bot']],
  ['up', ['up', '--bots', 'bots', '--bot', 'api-bot']],
]) {
  test(`D5 ${writer} adds each default a bot's allow lacks after the entries there, which keep their order`, async (t) => {
    // Two defaults and a rule of the user's own, in an order of the user's:
    // they stay first, as they were, and the rest of the set follows.
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await makeBot(box, 'api-bot', 'claude', [['daily']]);
    const defaults = defaultRules(box, bots);
    const theirs = [defaults[30], OWN_RULE, defaults[2]];
    await writeAllow(bots, 'api-bot', theirs);

    const result = await box.run(args);

    assert.equal(result.code, 0, result.stderr);
    assertDefaultsAppended(await allowOf(bots, 'api-bot'), theirs, defaults);
    assertSameRules(await allowedIn(bots, 'api-bot'), [...defaults, OWN_RULE], 'the settings allow the whole of allow, and nothing else');
    const missing = defaults.filter((rule) => !theirs.includes(rule));
    assertAddedLines(result.stdout, 'api-bot', missing);
    assert.ok(!addedLinesIn(result.stdout).some((line) => line.endsWith(OWN_RULE)), 'the user\'s own rule was not added by this run');
    assertNothingWaits(result.stdout);
  });

  test(`D5 ${writer} --json: the bot's defaults are the rules this run added`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await makeBot(box, 'api-bot', 'claude', [['daily']]);
    const defaults = defaultRules(box, bots);
    const theirs = [OWN_RULE, defaults[5]];
    await writeAllow(bots, 'api-bot', theirs);

    const answer = jsonOf(await box.run([...args, '--json']));

    assert.deepEqual(permissionBots(answer), ['api-bot']);
    const entry = entryOf(answer, 'api-bot');
    assertSameRules(defaultsOf(entry), defaults.filter((rule) => !theirs.includes(rule)));
    assertEntryWaitsForNothing(entry);
  });

  test(`D6 ${writer} run again adds nothing, names no rule, and its defaults are empty`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await makeBot(box, 'api-bot', 'claude', [['daily']]);
    await writeAllow(bots, 'api-bot', [OWN_RULE]);
    await ok(box.run(args));
    const allow = await allowOf(bots, 'api-bot');

    const plain = await box.run(args);
    const answer = jsonOf(await box.run([...args, '--json']));

    assert.equal(plain.code, 0, plain.stderr);
    assert.deepEqual(await allowOf(bots, 'api-bot'), allow, 'nothing added, nothing moved');
    assert.deepEqual(addedLinesIn(plain.stdout), [], `no allowed line, got:\n${plain.stdout}`);
    assertNothingWaits(plain.stdout);
    assert.deepEqual(withoutSendMessage(defaultsOf(entryOf(answer, 'api-bot'))), [], 'nothing added this run');
  });
}

test('D5 rules build over every bot adds to each what it lacks, each named with its own bot', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  await makeBot(box, 'codex-bot', 'codex');
  for (const bot of ['api-bot', 'codex-bot', 'bot-father']) await writeAllow(bots, bot, []);

  const plain = await box.run(['rules', 'build', '--bots', 'bots']);

  assert.equal(plain.code, 0, plain.stderr);
  assertSameRules(await allowOf(bots, 'api-bot'), defaultRules(box, bots));
  assertSameRules(await allowOf(bots, 'bot-father'), defaultRules(box, bots));
  assertSameRules(await allowOf(bots, 'codex-bot'), codexDefaultRules(box, bots));
  assertAddedLines(plain.stdout, 'api-bot', defaultRules(box, bots));
  assertAddedLines(plain.stdout, 'bot-father', defaultRules(box, bots));
  assertAddedLines(plain.stdout, 'codex-bot', codexDefaultRules(box, bots));
  assertNothingWaits(plain.stdout);

  const again = jsonOf(await box.run(['rules', 'build', '--bots', 'bots', '--json']));
  assert.deepEqual([...permissionBots(again)].sort(), ['api-bot', 'bot-father', 'codex-bot']);
  for (const entry of again.permissions) {
    assert.deepEqual(withoutSendMessage(defaultsOf(entry)), [], `nothing added to ${entry.bot} the second time`);
    assertEntryWaitsForNothing(entry);
  }
});

test('D5 up of a Codex bot adds the defaults it lacks to allow and writes them into obk.rules', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'codex-bot', 'codex', [['daily']]);
  const theirs = [OWN_RULE];
  await writeAllow(bots, 'codex-bot', theirs);

  const result = await box.run(['up', '--bots', 'bots', '--bot', 'codex-bot']);

  assert.equal(result.code, 0, result.stderr);
  assertDefaultsAppended(await allowOf(bots, 'codex-bot'), theirs, codexDefaultRules(box, bots));
  assertSameRules(await codexAllowedIn(bots, 'codex-bot'), [...codexDefaultLines(box, bots), prefixRule(['gh', 'pr', 'merge'])]);
  assertAddedLines(result.stdout, 'codex-bot', codexDefaultRules(box, bots));
});

// ----------------------------------------------------------------- a bot on both harnesses

test('D7 a Codex bot given a Claude session gets the Read rule added at the next rules build, and both files hold the set', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'mixed-bot', 'codex', [['daily'], ['review', '--harness', 'claude']]);
  const before = await allowOf(bots, 'mixed-bot');

  const answer = jsonOf(await box.run(['rules', 'build', '--bots', 'bots', '--bot', 'mixed-bot', '--json']));

  assertSameRules(await allowOf(bots, 'mixed-bot'), defaultRules(box, bots), 'the whole set now, the Read rule with it');
  assertDefaultsAppended(await allowOf(bots, 'mixed-bot'), before, defaultRules(box, bots));
  assertSameRules(await allowedIn(bots, 'mixed-bot'), defaultRules(box, bots), 'the Claude settings hold the whole set');
  assertSameRules(await codexAllowedIn(bots, 'mixed-bot'), codexDefaultLines(box, bots), 'and obk.rules every Bash default; the Read rule needs no Codex line');
  assert.deepEqual(permissionBots(answer), ['mixed-bot', 'mixed-bot'], 'one entry per harness file');
  for (const file of [settingsOf(bots, 'mixed-bot'), codexRulesOf(bots, 'mixed-bot')]) {
    const entry = entryAt(answer, 'mixed-bot', file);
    assertEntryWaitsForNothing(entry);
    assert.ok(Array.isArray(entry.defaults), `the entry for ${file} carries defaults`);
  }
});

test('D7 a Claude bot given a Codex session: rules build writes every Bash default into obk.rules', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'mixed-bot', 'claude', [['daily'], ['review', '--harness', 'codex']]);

  const result = await box.run(['rules', 'build', '--bots', 'bots', '--bot', 'mixed-bot']);

  assert.equal(result.code, 0, result.stderr);
  assertSameRules(await allowOf(bots, 'mixed-bot'), defaultRules(box, bots));
  assertSameRules(await allowedIn(bots, 'mixed-bot'), defaultRules(box, bots));
  assertSameRules(await codexAllowedIn(bots, 'mixed-bot'), codexDefaultLines(box, bots));
  assertNothingWaits(result.stdout);
});

// ----------------------------------------------------------------- restart

test('D8 restart, which brings a bot up again, adds the defaults its allow lacks', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot', 'claude', [['daily']]);
  await ok(box.run(['up', '--bots', 'bots', '--bot', 'api-bot']));
  const entry = await sessionIn(bots, 'api-bot', 'daily');
  await recordSession(box, { bots, bot: 'api-bot', tab: entry.tab, session: 'sess-1' });
  await conversationOnRecord(box, { harness: 'claude', cwd: botHomeOf(bots, 'api-bot'), id: 'sess-1' });
  await writeAllow(bots, 'api-bot', [OWN_RULE]);

  const result = await box.run(['restart', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assertDefaultsAppended(await allowOf(bots, 'api-bot'), [OWN_RULE], defaultRules(box, bots));
  assertSameRules(await allowedIn(bots, 'api-bot'), [...defaultRules(box, bots), OWN_RULE]);
});

// ----------------------------------------------------------------- folders that need quoting

for (const [label, folder] of [
  ['a bots folder with a space in its path', 'my bots'],
  ['a bots folder with an apostrophe and a space in its path', "bob's bots"],
]) {
  test(`D9 in ${label}, the set is spelled with the folder as one shell word, and the Codex lines with the plain path`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box, 'claude', folder);
    await makeBot(box, 'api-bot', 'claude', [], folder);
    await makeBot(box, 'codex-bot', 'codex', [], folder);
    // The premise: the folder is quoted inside the Bash rules and plain in the Read rule.
    assert.ok(defaultRules(box, bots).includes(`Bash(${shellWord(box.cli)} message to --bots ${shellWord(bots)}:*)`));
    assert.notEqual(shellWord(bots), bots, 'the premise: the folder needs quoting');

    assertSameRules(await allowOf(bots, 'api-bot'), defaultRules(box, bots));
    assertSameRules(await allowedIn(bots, 'api-bot'), defaultRules(box, bots));
    assertSameRules(await allowOf(bots, 'codex-bot'), codexDefaultRules(box, bots));
    assertSameRules(await codexAllowedIn(bots, 'codex-bot'), codexDefaultLines(box, bots));
  });
}

// ----------------------------------------------------------------- nothing outside the set

test('D10 the kit adds no rule outside the set by itself: create, build and up leave allow as the set and the user\'s own', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot', 'claude', [['daily']]);
  await writeAllow(bots, 'api-bot', [...await allowOf(bots, 'api-bot'), OWN_RULE]);

  await ok(box.run(['rules', 'build', '--bots', 'bots']));
  await ok(box.run(['up', '--bots', 'bots']));

  assertSameRules(await allowOf(bots, 'api-bot'), [...defaultRules(box, bots), OWN_RULE]);
  assertSameRules(await allowedIn(bots, 'api-bot'), [...defaultRules(box, bots), OWN_RULE]);
  assertSameRules(await allowOf(bots, 'bot-father'), defaultRules(box, bots));
});
