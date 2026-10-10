// `obk retire` with a start-prompt file it cannot remove (#393): retire
// finishes, and says what it left.
//
// The kit keeps a session's start prompt in `<bots>.prompts/<bot>/<session>.txt`
// (#534), beside the bots folder. Retiring a session or a whole bot removes those
// files, and nothing reads one of a retired session afterwards. So a file that
// cannot be removed (seen live: EPERM under Codex's sandbox) does not stop the
// retirement halfway: the session is retired, or the bot moved, as it would be
// anyway, the run ends in 0, and it names each file it left, why, and the
// command that removes it. In `--json` those are `promptsLeft: [{ file, reason }]`.
// When nothing was left, there is no `promptsLeft` and no word about it. A
// prompt file that is not there is nothing to remove, not a file left.
//
// A file cannot be removed when its folder cannot be written: here the bot's
// prompts folder is made read-only for the run and given its mode back after.

import assert from 'node:assert/strict';
import { chmod, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import {
  bookOf,
  botHomeOf,
  createSandbox,
  recordSession,
  sessionIn,
  tabsOfBot,
} from './helpers/cli.js';
import { botYamlOf } from './helpers/skills.js';

/** Root removes a file whatever its folder's mode, so no file can be made unremovable. */
const NEEDS_A_USER = process.getuid?.() === 0
  && 'runs as root, which removes a file whatever its folder\'s mode, so no prompt file can be left';

/** A duty long enough that the kit leaves it in a file beside the bots folder. */
const LONG_DUTY = 'Watch the queue and say what you see. '.repeat(10);

/** A bots folder with Bot Father and an api-bot carrying the sessions given. */
async function madeBot(box, sessions = [['daily']]) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude'])).code, 0);
  for (const [name, ...settings] of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', name, ...settings]);
    assert.equal(added.code, 0, added.stderr);
  }
  return box.path('bots');
}

async function up(box, bot = 'api-bot') {
  const result = await box.run(['up', '--bots', 'bots', '--bot', bot]);
  assert.equal(result.code, 0, result.stderr);
}

/** The tab the book gives a session, and Orca's own record of it. */
async function liveTab(box, bots, bot, name) {
  const entry = await sessionIn(bots, bot, name);
  assert.equal(typeof entry?.tab, 'string', `the book should hold a tab for ${name}, got: ${JSON.stringify(entry)}`);
  const terminal = (await tabsOfBot(box, bots, bot)).find((one) => one.tabId === entry.tab);
  assert.ok(terminal, `Orca should still have ${name}'s tab ${entry.tab}`);
  return { tabId: entry.tab, handle: terminal.handle, terminal };
}

const retire = (box, ...rest) => box.run(['retire', '--bots', 'bots', ...rest]);

const exists = (file) => stat(file).then(() => true, () => false);

/** Everything retire said, on either stream. */
const saidBy = (result) => `${result.stdout}${result.stderr}`;

/** The --json answer, which is JSON and nothing else. */
function answerIn(result) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout}${result.stderr} (${error.message})`);
  }
}

/** Every string anywhere under a value. */
function stringsIn(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(stringsIn);
  return [];
}

/** The folder the kit keeps api-bot's start prompts in, its own beside the bots folder (#534), and one session's file in it. */
const promptsOf = (bots) => path.join(`${bots}.prompts`, 'api-bot');
const promptOf = (bots, session) => path.join(promptsOf(bots), `${session}.txt`);

/** Why a file in a folder nobody may write cannot be removed: Node's EACCES. */
const DENIED = /EACCES|permission denied/i;

/** A line of what retire said that names `file` and a command that removes it. */
const removeLineFor = (result, file) => saidBy(result).split('\n').find((line) => line.includes(file) && /\b(rm|unlink)\b/.test(line));

/**
 * Run retire with the prompts folder read-only, so no file in it can be
 * removed, and give the folder its mode back whatever happens.
 */
async function retireLocked(box, bots, ...rest) {
  const folder = promptsOf(bots);
  const mode = (await stat(folder)).mode & 0o7777;
  await chmod(folder, 0o555);
  try {
    return await retire(box, ...rest);
  } finally {
    await chmod(folder, mode);
  }
}

// --------------------------------------------------------- retiring a session

/**
 * api-bot with daily (a long duty, so a prompt file, and a conversation) and
 * review (a short duty, so no prompt file), both up.
 */
async function sessionsRunning(box) {
  const bots = await madeBot(box, [['daily', '--prompt', LONG_DUTY], ['review']]);
  await up(box);
  const daily = await liveTab(box, bots, 'api-bot', 'daily');
  const review = await liveTab(box, bots, 'api-bot', 'review');
  await recordSession(box, { bots, bot: 'api-bot', tab: daily.tabId, session: 'sess-daily' });
  await recordSession(box, { bots, bot: 'api-bot', tab: review.tabId, session: 'sess-review' });
  const prompt = promptOf(bots, 'daily');
  assert.ok(await exists(prompt), `bringing daily up should have left its start prompt at ${prompt}`);
  assert.equal(await exists(promptOf(bots, 'review')), false, 'review has no prompt file, or PL6 proves nothing');
  return { bots, daily, review, prompt };
}

test('PL1 a session whose prompt file cannot be removed is still retired in full, and the run ends in 0', { skip: NEEDS_A_USER }, async (t) => {
  const box = await createSandbox(t);
  const { bots, daily, review, prompt } = await sessionsRunning(box);

  const result = await retireLocked(box, bots, '--bot', 'api-bot', '--session', 'daily');

  assert.equal(result.code, 0, `a prompt file left is no reason to fail, got:\n${saidBy(result)}`);
  assert.deepEqual(
    (await tabsOfBot(box, bots, 'api-bot')).map((one) => one.tabId),
    [review.tabId],
    `daily's tab ${daily.tabId} is closed, and review's is left`,
  );
  const yaml = parse(await readFile(botYamlOf(bots, 'api-bot'), 'utf8'));
  assert.deepEqual(yaml.sessions.map((one) => one.name), ['review'], 'daily is off bot.yaml');
  const book = parse(await readFile(bookOf(bots, 'api-bot'), 'utf8'));
  assert.equal(book.sessions?.daily, undefined, `daily is off the book's live list, got: ${JSON.stringify(book.sessions)}`);
  const entries = (book.retired ?? []).filter((one) => one?.name === 'daily');
  assert.equal(entries.length, 1, `one retired entry for daily, got: ${JSON.stringify(book.retired)}`);
  assert.ok(stringsIn(entries[0]).includes('sess-daily'), `its conversation is kept, got: ${JSON.stringify(entries[0])}`);
  assert.ok(await exists(prompt), `${prompt} could not be removed, so it is still there`);
});

test('PL2 the text names the prompt file it left by its full path, why, and a command that removes it', { skip: NEEDS_A_USER }, async (t) => {
  const box = await createSandbox(t);
  const { bots, prompt } = await sessionsRunning(box);

  const result = await retireLocked(box, bots, '--bot', 'api-bot', '--session', 'daily');

  assert.equal(result.code, 0, saidBy(result));
  assert.ok(removeLineFor(result, prompt), `a line should name ${prompt} with a command that removes it, got:\n${saidBy(result)}`);
  assert.match(saidBy(result), DENIED, `and say why it could not be removed, got:\n${saidBy(result)}`);
});

test('PL3 --json: the prompt file left is in promptsLeft, with its full path and the reason', { skip: NEEDS_A_USER }, async (t) => {
  const box = await createSandbox(t);
  const { bots, prompt } = await sessionsRunning(box);

  const result = await retireLocked(box, bots, '--bot', 'api-bot', '--session', 'daily', '--json');

  assert.equal(result.code, 0, saidBy(result));
  const answer = answerIn(result);
  assert.ok(Array.isArray(answer.promptsLeft), `the answer should carry promptsLeft, got: ${JSON.stringify(answer)}`);
  assert.deepEqual(answer.promptsLeft.map((one) => one.file), [prompt]);
  assert.equal(typeof answer.promptsLeft[0].reason, 'string');
  assert.match(answer.promptsLeft[0].reason, DENIED, `the reason is the error's message, got: ${answer.promptsLeft[0].reason}`);
});

test('PL4 a prompt file that can be removed is removed, and --json carries no promptsLeft', async (t) => {
  const box = await createSandbox(t);
  const { prompt } = await sessionsRunning(box);

  const result = await retire(box, '--bot', 'api-bot', '--session', 'daily', '--json');

  assert.equal(result.code, 0, saidBy(result));
  assert.equal(await exists(prompt), false, `${prompt} should be gone`);
  const answer = answerIn(result);
  assert.equal('promptsLeft' in answer, false, `nothing was left, got: ${JSON.stringify(answer)}`);
});

test('PL5 a prompt file that can be removed gets no line telling the user to remove it', async (t) => {
  const box = await createSandbox(t);
  const { prompt } = await sessionsRunning(box);

  const result = await retire(box, '--bot', 'api-bot', '--session', 'daily');

  assert.equal(result.code, 0, saidBy(result));
  assert.equal(await exists(prompt), false, `${prompt} should be gone`);
  assert.equal(removeLineFor(result, prompt), undefined, `nothing to remove by hand, got:\n${saidBy(result)}`);
  assert.doesNotMatch(saidBy(result), DENIED, `and no failure to report, got:\n${saidBy(result)}`);
});

test('PL6 a session with no prompt file retires with nothing left, even when the prompts folder is read-only', { skip: NEEDS_A_USER }, async (t) => {
  const box = await createSandbox(t);
  const { bots, prompt } = await sessionsRunning(box);

  const result = await retireLocked(box, bots, '--bot', 'api-bot', '--session', 'review', '--json');

  assert.equal(result.code, 0, saidBy(result));
  const answer = answerIn(result);
  assert.equal('promptsLeft' in answer, false, `a missing file is nothing to remove, got: ${JSON.stringify(answer)}`);
  const yaml = parse(await readFile(botYamlOf(bots, 'api-bot'), 'utf8'));
  assert.deepEqual(yaml.sessions.map((one) => one.name), ['daily'], 'review is retired: off bot.yaml');
  assert.ok(await exists(prompt), 'daily\'s prompt file is not review\'s to touch');
});

// ------------------------------------------------------------ retiring a bot

/** api-bot with daily and review, both on a long duty so both have a prompt file, up. */
async function botRunning(box) {
  const bots = await madeBot(box, [['daily', '--prompt', LONG_DUTY], ['review', '--prompt', LONG_DUTY]]);
  await up(box);
  const daily = await liveTab(box, bots, 'api-bot', 'daily');
  await recordSession(box, { bots, bot: 'api-bot', tab: daily.tabId, session: 'sess-daily' });
  const [setup] = (await box.orca.setups()).filter((one) => one.path === botHomeOf(bots, 'api-bot'));
  assert.ok(setup, 'up should have made the bot an Orca project');
  const prompts = [promptOf(bots, 'daily'), promptOf(bots, 'review')].sort();
  for (const prompt of prompts) assert.ok(await exists(prompt), `bringing the bot up should have left ${prompt}`);
  return { bots, setup, prompts, retired: path.join(bots, 'retired', 'api-bot') };
}

test('PL7 a bot whose prompt files cannot be removed is still retired in full, and the run ends in 0', { skip: NEEDS_A_USER }, async (t) => {
  const box = await createSandbox(t);
  const { bots, setup, prompts, retired } = await botRunning(box);

  const result = await retireLocked(box, bots, '--bot', 'api-bot');

  assert.equal(result.code, 0, `prompt files left are no reason to fail, got:\n${saidBy(result)}`);
  assert.deepEqual(await tabsOfBot(box, bots, 'api-bot'), [], 'every tab of the bot is closed');
  assert.equal((await box.orca.setups()).some((one) => one.id === setup.id), false, 'its Orca project is removed');
  assert.equal(await exists(botHomeOf(bots, 'api-bot')), false, 'the bot is gone from bots/');
  assert.ok(await exists(path.join(retired, 'bot.yaml')), `it is in ${retired} now`);
  assert.ok(
    stringsIn(parse(await readFile(path.join(retired, 'sessions.yaml'), 'utf8'))).includes('sess-daily'),
    'with its book, which still knows the conversation',
  );
  for (const prompt of prompts) assert.ok(await exists(prompt), `${prompt} could not be removed, so it is still there`);
});

test('PL8 the text names every prompt file the bot\'s retirement left, each with a command that removes it', { skip: NEEDS_A_USER }, async (t) => {
  const box = await createSandbox(t);
  const { bots, prompts } = await botRunning(box);

  const result = await retireLocked(box, bots, '--bot', 'api-bot');

  assert.equal(result.code, 0, saidBy(result));
  for (const prompt of prompts) {
    assert.ok(removeLineFor(result, prompt), `a line should name ${prompt} with a command that removes it, got:\n${saidBy(result)}`);
  }
  assert.match(saidBy(result), DENIED, `and say why they could not be removed, got:\n${saidBy(result)}`);
});

test('PL9 --json: every prompt file the bot\'s retirement left is in promptsLeft, and the move is named', { skip: NEEDS_A_USER }, async (t) => {
  const box = await createSandbox(t);
  const { bots, prompts, retired } = await botRunning(box);

  const result = await retireLocked(box, bots, '--bot', 'api-bot', '--json');

  assert.equal(result.code, 0, saidBy(result));
  const answer = answerIn(result);
  assert.equal(answer.moved, retired, `the bot was moved, got: ${JSON.stringify(answer)}`);
  assert.ok(Array.isArray(answer.promptsLeft), `the answer should carry promptsLeft, got: ${JSON.stringify(answer)}`);
  assert.deepEqual(answer.promptsLeft.map((one) => one.file).sort(), prompts);
  for (const { reason } of answer.promptsLeft) {
    assert.equal(typeof reason, 'string');
    assert.match(reason, DENIED, `the reason is the error's message, got: ${reason}`);
  }
});

test('PL10 a bot whose prompt files can all be removed has them removed, and --json carries no promptsLeft', async (t) => {
  const box = await createSandbox(t);
  const { bots, prompts, retired } = await botRunning(box);

  const result = await retire(box, '--bot', 'api-bot', '--json');

  assert.equal(result.code, 0, saidBy(result));
  for (const prompt of prompts) assert.equal(await exists(prompt), false, `${prompt} should be gone`);
  const answer = answerIn(result);
  assert.equal(answer.moved, retired, `the bot was moved, got: ${JSON.stringify(answer)}`);
  assert.equal('promptsLeft' in answer, false, `nothing was left, got: ${JSON.stringify(answer)}`);
  assert.equal(await exists(botHomeOf(bots, 'api-bot')), false);
});

test('PL11 a bot whose prompt files can all be removed gets no line telling the user to remove one', async (t) => {
  const box = await createSandbox(t);
  const { prompts } = await botRunning(box);

  const result = await retire(box, '--bot', 'api-bot');

  assert.equal(result.code, 0, saidBy(result));
  for (const prompt of prompts) {
    assert.equal(await exists(prompt), false, `${prompt} should be gone`);
    assert.equal(removeLineFor(result, prompt), undefined, `nothing to remove by hand, got:\n${saidBy(result)}`);
  }
  assert.doesNotMatch(saidBy(result), DENIED, `and no failure to report, got:\n${saidBy(result)}`);
});
