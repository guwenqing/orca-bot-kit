// `obk permission approval`: a session's approval, and the widest approval a
// bot's temporary sessions may be made at, set by a command of their own that
// keeps the user's yes (#527).
//
//   obk permission approval --bots F --bot B --session S --approval auto|ask|dangerously-skip
//     sets session S's approval in B's bot.yaml, the rest of the file as it
//     was, and says that a running session takes it at its next start, naming
//     the `obk restart` command.
//   obk permission approval --bots F --bot B --temps --approval <level>
//     writes `temp_approval: <level>` into B's bot.yaml: the widest approval
//     B's temporary sessions may be made at.
//
// It needs `--approval` and exactly one of `--session` and `--temps`; an
// unknown level is refused; nothing is written on a refusal. `obk health` does
// not name `temp_approval` as a key the kit does not know; it names a
// `temp_approval` that is not one of the three levels.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import {
  assertKeptWhatTheyWrote,
  assertRefused,
  createSandbox,
  skipGit,
  snapshot,
} from './helpers/cli.js';
import { botYamlOf } from './helpers/skills.js';

const BOT = 'api-bot';
const CHARTER = 'Api Bot owns the API. Good is a green build. Ask before a release.';

/** The bot.yaml the user wrote by hand: two sessions, settings of their own, and comments. */
const MINE = `# my own notes about this bot
name: api-bot
harness: claude
charter: |
  ${CHARTER}
notes: keep me            # a key the kit knows nothing about
rules: []
skills: []
sessions:
  - name: daily           # my session
    approval: auto
    model: sonnet
    effort: high
  - name: review
    approval: ask
    model: opus
`;

/** A bots folder `init` made, with one Claude bot whose bot.yaml is MINE. */
async function withBot(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude', '--charter', CHARTER]);
  assert.equal(made.code, 0, made.stderr);
  const bots = box.path('bots');
  await writeFile(botYamlOf(bots, BOT), MINE);
  return bots;
}

const approval = (box, ...rest) => box.run(['permission', 'approval', '--bots', 'bots', '--bot', BOT, ...rest]);

const botText = (bots) => readFile(botYamlOf(bots, BOT), 'utf8');

/** One session's entry in the bot's bot.yaml. */
const sessionOf = (doc, name) => doc.sessions.find((one) => one.name === name);

// ----------------------------------------------------------------- a session's approval

for (const level of ['auto', 'ask', 'dangerously-skip']) {
  test(`PA1 --session daily --approval ${level} sets daily's approval, and nothing else in bot.yaml moves`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    const was = parse(MINE);

    const result = await approval(box, '--session', 'daily', '--approval', level);

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    const after = await botText(bots);
    const doc = parse(after);
    assert.deepEqual(sessionOf(doc, 'daily'), { ...sessionOf(was, 'daily'), approval: level }, 'only the approval changed');
    assert.deepEqual(sessionOf(doc, 'review'), sessionOf(was, 'review'), 'the other session is as it was');
    assert.equal(doc.sessions.length, 2);
    assertKeptWhatTheyWrote(MINE, after, { changed: ['sessions'] });
  });
}

test('PA1 the answer says a running session takes the approval at its next start, and names obk restart for the session', async (t) => {
  const box = await createSandbox(t);
  await withBot(box);

  const result = await approval(box, '--session', 'review', '--approval', 'auto');

  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout.includes('review'), `the answer should name the session, got:\n${result.stdout}`);
  assert.ok(/ restart\b/.test(result.stdout), `the answer should name the obk restart command, got:\n${result.stdout}`);
  assert.ok(result.stdout.includes(' restart --bots '), `as a command to run, with the bots folder, got:\n${result.stdout}`);
  assert.ok(result.stdout.includes(BOT), `and the bot, got:\n${result.stdout}`);
});

test('PA1 --json answers as JSON and nothing else', async (t) => {
  const box = await createSandbox(t);
  await withBot(box);

  const result = await approval(box, '--session', 'daily', '--approval', 'ask', '--json');

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  assert.equal(answer.bot, BOT);
});

test('PA1 a session added with no approval and then given one is launched with it', async (t) => {
  // The level is the one `up` puts on the launch line: Claude's `--permission-mode manual` for ask.
  const box = await createSandbox(t);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily'])).code, 0);
  const bots = box.path('bots');
  assert.equal(sessionOf(parse(await botText(bots)), 'daily').approval, 'auto', 'the premise: session add wrote approval: auto');

  const set = await approval(box, '--session', 'daily', '--approval', 'ask');
  assert.equal(set.code, 0, `${set.stdout}${set.stderr}`);
  const up = await box.run(['up', '--bots', 'bots', '--bot', BOT]);

  assert.equal(up.code, 0, up.stderr);
  const typed = (await box.orca.terminals()).flatMap((terminal) => (terminal.typed ?? []).map((entry) => entry.text));
  assert.ok(typed.some((line) => line.includes('--permission-mode manual') && line.includes(`${BOT}.daily.`)), `daily should start in ask mode, got:\n${typed.join('\n')}`);
});

// ----------------------------------------------------------------- the temps' widest approval

for (const level of ['auto', 'ask', 'dangerously-skip']) {
  test(`PA2 --temps --approval ${level} writes temp_approval: ${level}, and nothing else in bot.yaml moves`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);

    const result = await approval(box, '--temps', '--approval', level);

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    const after = await botText(bots);
    assert.equal(parse(after).temp_approval, level);
    assertKeptWhatTheyWrote(MINE, after, { changed: ['temp_approval'] });
  });
}

test('PA2 --temps again with another level replaces the one there', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  assert.equal((await approval(box, '--temps', '--approval', 'dangerously-skip')).code, 0);

  const result = await approval(box, '--temps', '--approval', 'ask');

  assert.equal(result.code, 0, result.stderr);
  assert.equal(parse(await botText(bots)).temp_approval, 'ask');
});

// ----------------------------------------------------------------- refused, nothing written

for (const [label, args, named] of [
  ['no --approval', ['--session', 'daily'], ['--approval']],
  ['no --approval with --temps', ['--temps'], ['--approval']],
  ['neither --session nor --temps', ['--approval', 'ask'], ['--session', '--temps']],
  ['both --session and --temps', ['--session', 'daily', '--temps', '--approval', 'ask'], ['--session', '--temps']],
  ['an unknown level for a session', ['--session', 'daily', '--approval', 'sometimes'], ['sometimes']],
  ['an unknown level for the temps', ['--temps', '--approval', 'yolo'], ['yolo']],
  ['an empty level', ['--session', 'daily', '--approval='], ['--approval']],
  ['a session the bot does not have', ['--session', 'ghost', '--approval', 'ask'], ['ghost']],
]) {
  test(`PA3 ${label} is refused, and nothing is written`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    const before = await snapshot(bots, skipGit);

    const result = await approval(box, ...args);

    assertRefused(result, ...named);
    assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
  });
}

test('PA3 a bot that is not there is refused, and nothing is written', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const before = await snapshot(bots, skipGit);

  const result = await box.run(['permission', 'approval', '--bots', 'bots', '--bot', 'ghost-bot', '--session', 'daily', '--approval', 'ask']);

  assertRefused(result, 'ghost-bot');
  assert.deepEqual(await snapshot(bots, skipGit), before);
});

// ----------------------------------------------------------------- health and temp_approval

/** `obk health --json`: the findings. */
async function findings(box) {
  const result = await box.run(['health', '--bots', 'bots', '--json']);
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout}${result.stderr} (${error.message})`);
  }
  assert.ok(Array.isArray(answer.found), `the answer should carry a list of findings, got: ${result.stdout}`);
  return answer.found;
}

/** Set temp_approval in the bot's bot.yaml by hand, as the user would. */
async function handSet(bots, value) {
  const doc = parse(await botText(bots));
  doc.temp_approval = value;
  await writeFile(botYamlOf(bots, BOT), stringify(doc));
}

for (const level of ['auto', 'ask', 'dangerously-skip']) {
  test(`PA4 health does not name temp_approval: ${level} as a key the kit does not know`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    await handSet(bots, level);

    const found = await findings(box);

    const named = found.filter((one) => typeof one.says === 'string' && one.says.includes('temp_approval'));
    assert.deepEqual(named, [], `temp_approval is the kit's own key, and ${level} a level it knows, got: ${JSON.stringify(found, null, 2)}`);
  });
}

test('PA4 health does not name a temp_approval written by permission approval --temps', async (t) => {
  const box = await createSandbox(t);
  await withBot(box);
  assert.equal((await approval(box, '--temps', '--approval', 'ask')).code, 0);

  const found = await findings(box);

  assert.deepEqual(found.filter((one) => typeof one.says === 'string' && one.says.includes('temp_approval')), []);
});

for (const [label, value] of [['an unknown level', 'sometimes'], ['a number', 3], ['a list', ['auto']]]) {
  test(`PA4 health names a temp_approval that is ${label}, as a config finding about the bot's bot.yaml`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    await handSet(bots, value);

    const found = await findings(box);

    const named = found.filter((one) => typeof one.says === 'string' && one.says.includes('temp_approval'));
    assert.equal(named.length, 1, `one finding should name temp_approval, got: ${JSON.stringify(found, null, 2)}`);
    assert.equal(named[0].kind, 'config');
    assert.equal(named[0].bot, BOT);
    assert.ok(named[0].where === botYamlOf(bots, BOT) || named[0].says.includes(botYamlOf(bots, BOT)), `and point at the bot.yaml, got: ${JSON.stringify(named[0])}`);
  });
}
