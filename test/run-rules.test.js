// The permission rules of `obk run` are narrow by construction, and none is
// in the kit's default set (#532, parts 2 and 3).
//
// The check is the one `obk permission allow --bots <path> --bot <bot> --rule
// <rule>` applies (test/permissions-broad.test.js): a broad rule is refused,
// exit 1, the message on stderr naming the rule and the bot's settings file,
// and nothing is written, not bot.yaml and not the settings file; a narrow one
// is recorded in bot.yaml's `allow` and written into the settings.
//
// The "kit" word of a rule is the program word whose basename is `obk`, or the
// kit's own CLI path exactly as the kit prints itself (here `box.cli`, as
// `shellWord` spells it).
//
// - Narrow, so recorded: `Bash(<kit> run --timeout <n> -- <rest>)`, where <n>
//   is a plain number with no `*` (`--timeout=<n>` too), and <rest> is a
//   command that would be narrow as a rule of its own. An exact rule with no
//   wildcard is narrow as well.
// - Broad, so refused, and nothing written: any other `run` rule of the kit
//   with a wildcard. That is a wildcard before or in the `--timeout <n> --`
//   part, a timeout that is no plain number, and every rule whose <rest> is
//   broad on its own (a shell, interpreter or wrapper after `--`, a program
//   with any arguments, nothing after `--` but a wildcard).
// - Other kit commands keep today's judgment, and a program that is not the
//   kit with a word `run` in it is judged as today. Those cases, and the raw
//   `perl -e 'alarm …'` form, which stays broad (out of scope), are judged
//   here by the rules spelled out in the comment header of
//   test/permissions-broad.test.js; they hold before this change as after it,
//   and are here to show the new check does not reach past the kit's `run`.
// - The kit's CLI run through an interpreter or a wrapper by its absolute
//   path (`node <cli> run …`, `env <cli> run …`): the rule is judged as the
//   kit's own rule, so broad and narrow as above.
// - A bot on Codex gets a narrow `run` rule in Codex's own form, a
//   `prefix_rule` of the words before the wildcard, in
//   `<bot home>/.codex/rules/obk.rules`.
// - `run` is never in the default set: no default rule names it, for a bot on
//   Claude or on Codex.
//
// Expected lines are literals worked out by hand from those formats.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  assertCleanFailure,
  createSandbox,
  shellWord,
  skipGit,
  snapshot,
} from './helpers/cli.js';
import {
  allowedIn,
  allowOf,
  codexAllowedIn,
  kitRule,
  permissionAllow,
  prefixRule,
  settingsOf,
} from './helpers/permissions.js';
import { botYamlOf } from './helpers/skills.js';

const BOT = 'api-bot';
const CHARTER = 'Api Bot owns the API. Good is a green build. Ask before a release.';

/** A bots folder `init` made, with one bot of its own on `harness` and one session. */
async function withBot(box, harness = 'claude') {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', harness, '--charter', CHARTER]);
  assert.equal(made.code, 0, made.stderr);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily']);
  assert.equal(added.code, 0, added.stderr);
  return box.path('bots');
}

/** `obk permission allow` for the bot, one `--rule` per rule. */
const allow = (box, ...rules) => permissionAllow(box, BOT, rules);

/** Nothing under the bots folder changed: not bot.yaml, not AGENTS.md, not the settings file, not obk.rules. */
async function assertNothingWritten(bots, before) {
  const now = await snapshot(bots, skipGit);
  const changed = Object.keys({ ...before, ...now }).filter((rel) => before[rel] !== now[rel]);
  assert.deepEqual(changed, [], `a refusal writes nothing. bot.yaml now:\n${await readFile(botYamlOf(bots, BOT), 'utf8')}`);
}

/** The refusal names the rule, verbatim, and the bot's own settings file. */
function assertNamesRuleAndFile(result, rule, bots) {
  assert.ok(result.stderr.includes(rule), `the refusal should name ${rule} verbatim, got: ${result.stderr}`);
  assert.ok(result.stderr.includes(settingsOf(bots, BOT)), `the refusal should name ${settingsOf(bots, BOT)}, got: ${result.stderr}`);
}

/** The kit's word in a rule: `obk`, the sandbox's own CLI path, or another path whose basename is `obk`. */
const KITS = {
  obk: () => 'obk',
  'the kit\'s own CLI path': (box) => shellWord(box.cli),
  'another path whose basename is obk': () => '/opt/homebrew/bin/obk',
};

/** `run` rules that are narrow: `[rule after the kit word, why]`. */
const NARROW_RUN = [
  ['run --timeout 300 -- go test:*', 'a plain number, and go test is narrow on its own'],
  ['run --timeout=300 -- go test:*', '--timeout=<n>'],
  ['run --timeout 300 -- npm test:*', 'npm test is narrow on its own'],
  ['run --timeout 300 -- npm run build:*', 'three words after --'],
  ['run --timeout 300 -- go test *', 'a spaced star after two words'],
  ['run --timeout 300 -- python3 /abs/tool.py:*', 'an interpreter running a fixed script by its absolute path is narrow on its own'],
  ['run --timeout 300 -- go test ./...', 'an exact rule, no wildcard'],
];

/** `run` rules that are broad: `[rule after the kit word, why]`. */
const BROAD_RUN = [
  ['run:*', 'run with any arguments'],
  ['run *', 'run with any arguments, a spaced star'],
  ['run --timeout:*', 'any timeout and any command'],
  ['run --timeout 300:*', 'any command after the timeout'],
  ['run --timeout 300 --:*', 'any command after --'],
  ['run --timeout 300 -- *', 'nothing after -- but a wildcard'],
  ['run --timeout * -- go test:*', 'a star for the timeout'],
  ['run --timeout 30* -- go test:*', 'a star inside the timeout'],
  ['run --timeout=* -- go test:*', 'a star for the timeout in --timeout='],
  ['run --timeout abc -- go test:*', 'a timeout that is no plain number'],
  ['run --timeout 300 -- go:*', 'a program with any arguments after --'],
  ['run --timeout 300 -- sh:*', 'a shell after --'],
  ['run --timeout 300 -- bash -c:*', 'bash -c after --'],
  ['run --timeout 300 -- node:*', 'an interpreter after --'],
  ['run --timeout 300 -- perl -e:*', 'perl -e after --'],
  ['run --timeout 300 -- env go test:*', 'a wrapper after --'],
  ['run --timeout 300 -- sudo go test:*', 'sudo after --'],
  ['run --timeout 300 -- python3.12 x:*', 'an interpreter with a version on its name after --'],
  ['run --timeout 300 -- X=1 sh -c:*', 'a shell after a leading assignment after --'],
  ['run --timeout=300 -- sh:*', 'a shell after --, with --timeout='],
];

// Each kit word gets one bots folder, which all its cases share, to keep the
// file fast: the broad rules go first, since a refusal writes nothing, and
// then the narrow ones, each read against the allow list just before it.

for (const [kit, word] of Object.entries(KITS)) {
  test(`RR1 and RR2 (${kit}): each broad run rule is refused and writes nothing; each narrow one is recorded`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);

    for (const [rest, why] of BROAD_RUN) {
      const rule = `Bash(${word(box)} ${rest})`;
      await t.test(`RR2 (${kit}) permission allow ${rule} is refused as broad (${why}), naming the rule and the settings file, and nothing is written`, async () => {
        const kept = await allowOf(bots, BOT);
        const before = await snapshot(bots, skipGit);

        const result = await allow(box, rule);

        assertCleanFailure(result);
        assertNamesRuleAndFile(result, rule, bots);
        await assertNothingWritten(bots, before);
        assert.deepEqual(await allowOf(bots, BOT), kept, 'allow is as it was');
      });
    }

    for (const [rest, why] of NARROW_RUN) {
      const rule = `Bash(${word(box)} ${rest})`;
      await t.test(`RR1 (${kit}) permission allow ${rule} is narrow (${why}): kept in allow and written into the settings`, async () => {
        const kept = await allowOf(bots, BOT);

        const result = await allow(box, rule);

        assert.equal(result.code, 0, `${rule} is narrow, and should be allowed, got:\n${result.stdout}${result.stderr}`);
        assert.deepEqual(await allowOf(bots, BOT), [...kept, rule]);
        assert.ok((await allowedIn(bots, BOT)).includes(rule), `${settingsOf(bots, BOT)} should allow ${rule} now`);
      });
    }
  });
}

// The kit's CLI run through an interpreter or a wrapper by its absolute path:
// the rule from the CLI on is judged as the kit's own rule, so a broad run
// rule stays broad behind `node` or `env`, and a narrow one stays narrow.
test('RR6 the kit\'s CLI behind node or env, by its absolute path: a broad run rule is refused and writes nothing; a narrow one is recorded', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const cli = shellWord(box.cli);

  for (const [front, rest, why] of [
    ['node', 'run:*', 'run with any arguments, behind an interpreter'],
    ['env', 'run:*', 'run with any arguments, behind a wrapper'],
    ['node', 'run --timeout 300 -- sh:*', 'a shell after --, behind an interpreter'],
    ['env', 'run --timeout 300 -- sh:*', 'a shell after --, behind a wrapper'],
  ]) {
    const rule = `Bash(${front} ${cli} ${rest})`;
    await t.test(`RR6 permission allow ${rule} is refused as broad (${why}), naming the rule and the settings file, and nothing is written`, async () => {
      const kept = await allowOf(bots, BOT);
      const before = await snapshot(bots, skipGit);

      const result = await allow(box, rule);

      assertCleanFailure(result);
      assertNamesRuleAndFile(result, rule, bots);
      await assertNothingWritten(bots, before);
      assert.deepEqual(await allowOf(bots, BOT), kept, 'allow is as it was');
    });
  }

  for (const [front, why] of [
    ['node', 'behind an interpreter'],
    ['env', 'behind a wrapper'],
  ]) {
    const rule = `Bash(${front} ${cli} run --timeout 300 -- go test:*)`;
    await t.test(`RR6 permission allow ${rule} is narrow (${why}): kept in allow and written into the settings`, async () => {
      const kept = await allowOf(bots, BOT);

      const result = await allow(box, rule);

      assert.equal(result.code, 0, `${rule} is narrow, and should be allowed, got:\n${result.stdout}${result.stderr}`);
      assert.deepEqual(await allowOf(bots, BOT), [...kept, rule]);
      assert.ok((await allowedIn(bots, BOT)).includes(rule), `${settingsOf(bots, BOT)} should allow ${rule} now`);
    });
  }
});

test('RR2 a narrow run rule beside a broad one is refused with it: neither is recorded or written', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const narrow = 'Bash(obk run --timeout 300 -- go test:*)';
  const broad = 'Bash(obk run --timeout 300 -- sh:*)';
  const before = await snapshot(bots, skipGit);

  const result = await allow(box, narrow, broad);

  assertCleanFailure(result);
  assertNamesRuleAndFile(result, broad, bots);
  await assertNothingWritten(bots, before);
});

// ----------------------------------------------------------------- the rest keep today's judgment

// Guards: by the rules in test/permissions-broad.test.js's header these hold
// before #532 as after it. They pass today, on purpose.
test('RR3 rules that are not the kit\'s run are judged as before #532', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);

  for (const [rule, accepted, why] of [
    ["Bash(perl -e 'alarm 300; exec @ARGV' -- go test:*)", false, 'the raw perl form: an interpreter whose next word is no fixed absolute path, broad as today'],
    ['Bash(obk health --bots /x:*)', true, 'another kit command: four words before :*, as today'],
    ['Bash(make run --timeout 3 -- sh:*)', true, 'make is no shell, interpreter, wrapper or the kit, with many words before :*, as today'],
  ]) {
    await t.test(`RR3 permission allow ${rule} is ${accepted ? 'narrow, recorded' : 'broad, refused'} (${why})`, async () => {
      const kept = await allowOf(bots, BOT);
      const before = await snapshot(bots, skipGit);

      const result = await allow(box, rule);

      if (accepted) {
        assert.equal(result.code, 0, `${rule} should be allowed, got:\n${result.stdout}${result.stderr}`);
        assert.deepEqual(await allowOf(bots, BOT), [...kept, rule]);
      } else {
        assertCleanFailure(result);
        assertNamesRuleAndFile(result, rule, bots);
        await assertNothingWritten(bots, before);
      }
    });
  }
});

// ----------------------------------------------------------------- a bot on Codex

for (const [label, rest, words] of [
  ['obk', 'run --timeout 300 -- go test:*', ['obk', 'run', '--timeout', '300', '--', 'go', 'test']],
  ['obk, --timeout=', 'run --timeout=300 -- npm run build:*', ['obk', 'run', '--timeout=300', '--', 'npm', 'run', 'build']],
]) {
  test(`RR4 (${label}) a narrow run rule for a bot on Codex is written into obk.rules as a prefix_rule of the words before the wildcard`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, 'codex');
    const rule = `Bash(obk ${rest})`;

    const result = await allow(box, rule);

    assert.equal(result.code, 0, `${rule} is narrow, and should be allowed, got:\n${result.stdout}${result.stderr}`);
    assert.ok((await allowOf(bots, BOT)).includes(rule), 'the yes is kept in bot.yaml in Claude text');
    const line = `prefix_rule(pattern=[${words.map((word) => JSON.stringify(word)).join(', ')}], decision="allow")`;
    assert.ok((await codexAllowedIn(bots, BOT)).includes(line), `obk.rules should hold ${line}, got:\n${(await codexAllowedIn(bots, BOT)).join('\n')}`);
  });
}

test('RR4 the kit\'s own CLI path: a narrow run rule for a bot on Codex holds the path as a plain word in its prefix_rule', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'codex');
  const rule = `Bash(${shellWord(box.cli)} run --timeout 300 -- go test:*)`;

  const result = await allow(box, rule);

  assert.equal(result.code, 0, `${rule} is narrow, and should be allowed, got:\n${result.stdout}${result.stderr}`);
  const line = prefixRule([box.cli, 'run', '--timeout', '300', '--', 'go', 'test']);
  assert.ok((await codexAllowedIn(bots, BOT)).includes(line), `obk.rules should hold ${line}, got:\n${(await codexAllowedIn(bots, BOT)).join('\n')}`);
});

test('RR4 a broad run rule for a bot on Codex is refused, and nothing is written, obk.rules included', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'codex');
  const rule = 'Bash(obk run --timeout 300 -- sh:*)';
  const before = await snapshot(bots, skipGit);

  const result = await allow(box, rule);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes(rule), `the refusal should name ${rule} verbatim, got: ${result.stderr}`);
  await assertNothingWritten(bots, before);
});

// ----------------------------------------------------------------- never in the default set

/** Whether a Claude rule names the kit's `run`: by `obk` or a path whose basename is obk, or the kit's own CLI. */
const namesRun = (box, rule) => /^Bash\((?:\S*\/)?obk run(?:[ :]|\))/.test(rule) || rule.startsWith(`Bash(${shellWord(box.cli)} run `) || rule.startsWith(`Bash(${shellWord(box.cli)} run:`);

/** Whether a Codex line names the kit's `run`: a pattern whose first word is the kit and whose second is run. */
const lineNamesRun = (box, line) => line.startsWith(`prefix_rule(pattern=[${JSON.stringify(box.cli)}, "run"`) || /^prefix_rule\(pattern=\["(?:[^"]*\/)?obk", "run"/.test(line);

for (const harness of ['claude', 'codex']) {
  test(`RR5 a bot on ${harness} is given no rule for obk run by the kit, after bot create and after rules build`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, harness);
    assert.equal((await box.run(['rules', 'build', '--bots', 'bots'])).code, 0);

    const allowed = await allowOf(bots, BOT);
    // The premise: the kit wrote its default set, the health rule among it.
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
