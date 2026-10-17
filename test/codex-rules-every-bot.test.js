// The kit's Codex rules file matches bot.yaml for every bot that has one (#613,
// widened by #614).
//
// The kit owns `<bot>/.codex/rules/obk.rules` whole and writes it from bot.yaml's
// `allow` list: each `Bash(<words>:*)` or `Bash(<words> *)` becomes
//   prefix_rule(pattern=["w1", "w2", ...], decision="allow")
// (see test/permissions-codex.test.js). Before #613 it wrote the file only while
// the bot ran on Codex. So a bot that once ran on Codex and now runs only on
// Claude kept a file that no longer matched its `allow` list. What is pinned:
//
//   G1  For a bot that runs no Codex session but has an obk.rules, `obk rules
//       build --bots <bots>`, and with `--bot <bot>`, rewrites the file from
//       the `allow` list now: the line of a rule that left `allow` goes, the
//       line of a rule now in `allow` comes, and the default lines stay.
//   G2  The same holds for such a bot that is paused.
//   H1  `obk up --bots <bots> --bot <bot>` does the same for such a bot it
//       brings up.
//   I1  A bot that runs no Codex session and has no obk.rules gets none from
//       `rules build` or `up`.
//   J1  Another `.rules` file of the user's in `.codex/rules/` stays byte for
//       byte when the kit rewrites obk.rules.
//   K1  `obk permission disallow` on such a bot takes the rule's line out of
//       its obk.rules too, paused or not.
//   L1  For such a bot, an obk.rules that is a link leading outside the bot
//       folder is not the kit's file to write: `rules build` leaves it alone
//       (the file it leads to byte for byte, the link as it was), ends with
//       code 0, and prints no `refused` line about it.
//
// "Runs no Codex session": the bot's harness is claude and every session is on
// Claude. The state is made the way a user gets there: a bot on Claude with a
// session on Codex, a rule allowed through the kit (which writes obk.rules),
// then the session moved to Claude, then `allow` changed in bot.yaml.
//
// Expected lines are worked out by hand from the format, or spelled by
// helpers/permissions.js. Every run is in the sandbox (helpers/cli.js).
// Nothing here reaches the real Orca or a real harness.

import assert from 'node:assert/strict';
import { mkdir, readFile, readlink, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { botHomeOf, createSandbox } from './helpers/cli.js';
import {
  allowOf,
  assertSameRules,
  codexAllowedIn,
  codexDefaultLines,
  codexLinesIn,
  codexRulesOf,
  permissionAllow,
  permissionDisallow,
  withoutSendMessage,
  writeAllow,
} from './helpers/permissions.js';

const BOT = 'api-bot';
const PAST = new Date('2020-01-01T00:00:00Z');

/** Rules of the bot's own, outside the kit's default set, and their lines, worked out by hand. */
const BUILD_RULE = 'Bash(npm run build:*)';
const BUILD_LINE = 'prefix_rule(pattern=["npm", "run", "build"], decision="allow")';
const OWN_RULE = 'Bash(gh pr merge:*)';
const OWN_LINE = 'prefix_rule(pattern=["gh", "pr", "merge"], decision="allow")';
const VIEW_RULE = 'Bash(gh pr view *)';
const VIEW_LINE = 'prefix_rule(pattern=["gh", "pr", "view"], decision="allow")';

const run = async (box, args) => {
  const result = await box.run(args);
  assert.equal(result.code, 0, `${args.join(' ')}\n${result.stdout}${result.stderr}`);
  return result;
};

/** The bot's own lines in obk.rules, in order: the default lines and SendMessage left out. */
async function ownLines(box, bots) {
  const defaults = new Set(codexDefaultLines(box, bots));
  return withoutSendMessage(await codexAllowedIn(bots, BOT)).filter((line) => !defaults.has(line));
}

/** obk.rules holds every default line, each once. */
async function assertDefaultLines(box, bots) {
  const defaults = codexDefaultLines(box, bots);
  const lines = withoutSendMessage(await codexAllowedIn(bots, BOT));
  assertSameRules(lines.filter((line) => defaults.includes(line)), defaults, `obk.rules should keep the default lines, got:\n${lines.join('\n')}`);
}

/**
 * A bot that once ran on Codex and now runs only on Claude: harness claude,
 * its `daily` session on Codex while BUILD_RULE and OWN_RULE are allowed
 * through the kit, then moved to Claude. Nothing brought up. Paused too when
 * `paused`. Its obk.rules is the one written while it ran on Codex.
 */
async function movedOffCodex(box, { paused = false } = {}) {
  await run(box, ['init', '--bots', 'bots', '--harness', 'claude']);
  await run(box, ['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  await run(box, ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily', '--harness', 'codex']);
  const allowed = await permissionAllow(box, BOT, [BUILD_RULE, OWN_RULE]);
  assert.equal(allowed.code, 0, `the premise: the rules allowed through the kit\n${allowed.stdout}${allowed.stderr}`);
  const bots = box.path('bots');
  assert.deepEqual(await ownLines(box, bots), [BUILD_LINE, OWN_LINE], 'the premise: obk.rules written while the bot ran on Codex');
  await run(box, ['session', 'change', '--bots', 'bots', '--bot', BOT, '--session', 'daily', '--harness', 'claude']);
  if (paused) await run(box, ['pause', '--bots', 'bots', '--bot', BOT]);
  return bots;
}

/** Change `allow` in bot.yaml by hand: OWN_RULE leaves, VIEW_RULE comes. */
async function allowChanged(bots) {
  const allow = (await allowOf(bots, BOT)).filter((rule) => rule !== OWN_RULE);
  await writeAllow(bots, BOT, [...allow, VIEW_RULE]);
}

const RULES_BUILDS = [
  ['rules build --bots', ['rules', 'build', '--bots', 'bots']],
  ['rules build --bot', ['rules', 'build', '--bots', 'bots', '--bot', BOT]],
];

// ------------------------------------------------------------- G1, G2

for (const paused of [false, true]) {
  const who = paused ? 'a paused bot' : 'a bot';
  for (const [name, args] of RULES_BUILDS) {
    test(`${paused ? 'G2' : 'G1'} ${name} rewrites the obk.rules of ${who} that runs no Codex session from its allow list now`, async (t) => {
      const box = await createSandbox(t);
      const bots = await movedOffCodex(box, { paused });
      await allowChanged(bots);

      await run(box, args);

      assert.deepEqual(await ownLines(box, bots), [BUILD_LINE, VIEW_LINE],
        `the line of ${OWN_RULE} goes and the line of ${VIEW_RULE} comes, got:\n${await readFile(codexRulesOf(bots, BOT), 'utf8')}`);
      await assertDefaultLines(box, bots);
    });
  }
}

// ------------------------------------------------------------- H1

test('H1 up rewrites the obk.rules of a bot it brings up that runs no Codex session from its allow list now', async (t) => {
  const box = await createSandbox(t);
  const bots = await movedOffCodex(box);
  await allowChanged(bots);

  await run(box, ['up', '--bots', 'bots', '--bot', BOT]);

  assert.deepEqual(await ownLines(box, bots), [BUILD_LINE, VIEW_LINE],
    `the line of ${OWN_RULE} goes and the line of ${VIEW_RULE} comes, got:\n${await readFile(codexRulesOf(bots, BOT), 'utf8')}`);
  await assertDefaultLines(box, bots);
});

// ------------------------------------------------------------- I1

test('I1 a bot that runs no Codex session and has no obk.rules gets none from rules build or up', async (t) => {
  const box = await createSandbox(t);
  await run(box, ['init', '--bots', 'bots', '--harness', 'claude']);
  await run(box, ['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  await run(box, ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily']);
  const allowed = await permissionAllow(box, BOT, [BUILD_RULE]);
  assert.equal(allowed.code, 0, `the premise: a rule of the bot's own\n${allowed.stdout}${allowed.stderr}`);
  const bots = box.path('bots');
  const file = codexRulesOf(bots, BOT);

  for (const args of [
    ['rules', 'build', '--bots', 'bots'],
    ['rules', 'build', '--bots', 'bots', '--bot', BOT],
    ['up', '--bots', 'bots', '--bot', BOT],
  ]) {
    await run(box, args);
    assert.equal(await codexLinesIn(file), undefined, `${args.join(' ')} should make no ${file}`);
  }
});

test('I1 a paused bot that runs no Codex session and has no obk.rules gets none from rules build', async (t) => {
  const box = await createSandbox(t);
  await run(box, ['init', '--bots', 'bots', '--harness', 'claude']);
  await run(box, ['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  await run(box, ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily']);
  await run(box, ['pause', '--bots', 'bots', '--bot', BOT]);
  const bots = box.path('bots');

  await run(box, ['rules', 'build', '--bots', 'bots']);

  assert.equal(await codexLinesIn(codexRulesOf(bots, BOT)), undefined);
});

// ------------------------------------------------------------- J1

for (const [name, args] of [...RULES_BUILDS, ['up', ['up', '--bots', 'bots', '--bot', BOT]]]) {
  test(`J1 ${name} leaves another .rules file of the user's byte for byte while it rewrites obk.rules`, async (t) => {
    const box = await createSandbox(t);
    const bots = await movedOffCodex(box);
    const theirs = path.join(botHomeOf(bots, BOT), '.codex', 'rules', 'default.rules');
    const text = `# mine\n${OWN_LINE}\nprefix_rule(pattern=["make"], decision="allow")\n`;
    await writeFile(theirs, text);
    await utimes(theirs, PAST, PAST);
    await allowChanged(bots);

    await run(box, args);

    assert.equal(await readFile(theirs, 'utf8'), text, 'the user\'s own rules file, the same line as the removed rule\'s included');
    assert.equal((await stat(theirs)).mtime.getTime(), PAST.getTime(), 'not even written back the same');
    assert.deepEqual(await ownLines(box, bots), [BUILD_LINE, VIEW_LINE], 'the premise: obk.rules was rewritten beside it');
  });
}

// ------------------------------------------------------------- K1

for (const paused of [false, true]) {
  test(`K1 permission disallow takes the rule's line out of the obk.rules of ${paused ? 'a paused bot' : 'a bot'} that runs no Codex session`, async (t) => {
    const box = await createSandbox(t);
    const bots = await movedOffCodex(box, { paused });

    const result = await permissionDisallow(box, BOT, [OWN_RULE]);

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    assert.ok(!(await allowOf(bots, BOT)).includes(OWN_RULE), 'the premise: the rule left allow');
    assert.deepEqual(await ownLines(box, bots), [BUILD_LINE],
      `the line of ${OWN_RULE} goes, got:\n${await readFile(codexRulesOf(bots, BOT), 'utf8')}`);
    await assertDefaultLines(box, bots);
  });
}

// ------------------------------------------------------------- L1

test('L1 rules build leaves alone an obk.rules that links outside the bot folder of a bot that runs no Codex session, with code 0 and no refused line about it', async (t) => {
  const box = await createSandbox(t);
  const bots = await movedOffCodex(box);
  await allowChanged(bots);
  const file = codexRulesOf(bots, BOT);
  const held = await readFile(file, 'utf8');
  const target = path.join(box.home, '.codex', 'rules', 'obk.rules');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, held);
  await rm(file);
  await symlink(target, file);

  const result = await box.run(['rules', 'build', '--bots', 'bots']);

  assert.equal(await readFile(target, 'utf8'), held, 'the file outside the bot folder, byte for byte');
  assert.equal(await readlink(file), target, 'and the link is left as it was');
  const said = `${result.stdout}${result.stderr}`;
  assert.equal(result.code, 0, `rules build should end with code 0, got:\n${said}`);
  const relative = path.relative(box.cwd, file);
  const refusals = said.split('\n').filter((line) => /refused/i.test(line) && (line.includes(file) || line.includes(relative) || line.includes('obk.rules') || line.includes('.codex')));
  assert.deepEqual(refusals, [], `no refused line about ${file}, got:\n${said}`);
});
