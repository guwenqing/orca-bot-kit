// `obk skills remove --bots <path> --bot <bot> --skill <ref>`: the mirror of
// `obk skills add`. One entry comes off the bot's own `skills:` list, and that
// is all it writes.
//
// Nothing is unlinked here: `obk skills build` is what puts a skill where a
// harness reads it, and it already takes away a link no list names. Orca is not
// touched.
//
// An entry that is not on the list is not an error, for the same reason an
// entry already there is not one for `skills add`: the bot already is what was
// asked for. The answer says so, and nothing is written.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import {
  assertCleanFailure,
  assertKeptWhatTheyWrote,
  assertNoTrailingSpace,
  createSandbox,
  skipGit,
  snapshot,
} from './helpers/cli.js';
import {
  assertLinked,
  assertNotThere,
  botYamlOf,
  commonSkill,
  setSkills,
  treeIn,
} from './helpers/skills.js';

const BOT = 'api-bot';

/** A bots folder `init` made, with one bot whose skills list holds the entries given. */
async function withBot(box, ...skills) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  assert.equal(made.code, 0, made.stderr);
  const bots = box.path('bots');
  if (skills.length > 0) await setSkills(botYamlOf(bots, BOT), ...skills);
  return bots;
}

const remove = (box, skill, ...rest) =>
  box.run(['skills', 'remove', '--bots', 'bots', '--bot', BOT, '--skill', skill, ...rest]);

const botText = (bots) => readFile(botYamlOf(bots, BOT), 'utf8');
const listedIn = async (bots) => parse(await botText(bots))?.skills;

/** The answer of a `--json` run, parsed, and nothing but JSON on the way out. */
function answerOf(result) {
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
}

test('SR1 skills remove takes the one entry off the list, keeps the others in order, and changes nothing else', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'kit:obk-tdd', 'house-style', 'someones-skills:their-skill');
  const before = await snapshot(bots, skipGit);
  const calls = (await box.orca.calls()).length;

  const result = await remove(box, 'house-style');

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await listedIn(bots), ['kit:obk-tdd', 'someones-skills:their-skill']);
  const after = await snapshot(bots, skipGit);
  assert.deepEqual(
    Object.keys(after).filter((rel) => after[rel] !== before[rel]),
    [path.join('bots', BOT, 'bot.yaml')],
    'the bot\'s own file is the only thing that changes',
  );
  assert.equal((await box.orca.calls()).length, calls, 'and Orca is asked nothing');
});

test('SR1 only the exact entry comes off: another way of naming the same skill stays', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'kit:obk-tdd', 'obk-tdd');

  const result = await remove(box, 'obk-tdd');

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await listedIn(bots), ['kit:obk-tdd']);
});

test('SR1 everything else in bot.yaml still says what the user wrote', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const mine = `# my own notes about this bot
name: api-bot
harness: claude
charter: |
  Mine, and unchanged.
notes: keep me            # a key the kit knows nothing about
rules: []
skills:
  - house-style           # the one I wrote myself
  - kit:obk-tdd
sessions:
  - name: mine
    approval: ask
`;
  await writeFile(botYamlOf(bots, BOT), mine);

  const result = await remove(box, 'kit:obk-tdd');

  assert.equal(result.code, 0, result.stderr);
  const after = await botText(bots);
  assertKeptWhatTheyWrote(mine, after, { changed: ['skills'] });
  assertNoTrailingSpace(after);
  assert.deepEqual(parse(after).skills, ['house-style']);
  assert.ok(after.includes('the one I wrote myself'), `the comment on their own entry should still be there:\n${after}`);
});

test('SR2 an entry that is not on the list is a success that writes nothing and says it was not there', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'kit:obk-tdd', 'house-style');
  const removed = await remove(box, 'house-style');
  assert.equal(removed.code, 0, removed.stderr);
  const before = await botText(bots);
  const tree = await snapshot(bots, skipGit);

  const again = await remove(box, 'house-style');

  assert.equal(again.code, 0, `not there is a success, not a refusal: ${again.stderr}`);
  assert.equal(again.stderr, '');
  assert.ok(again.stdout.includes('house-style'), `the report should name the skill, got: ${again.stdout}`);
  assert.notEqual(again.stdout, removed.stdout, 'a run that found nothing to take off does not read like the one that took it off');
  assert.equal(await botText(bots), before, 'the file keeps its bytes');
  assert.deepEqual(await snapshot(bots, skipGit), tree);
});

test('SR2 the answer says which of the two happened: removed, or absent', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'kit:obk-tdd');

  const first = answerOf(await remove(box, 'kit:obk-tdd', '--json'));
  const second = answerOf(await remove(box, 'kit:obk-tdd', '--json'));

  assert.equal(first.state, 'removed');
  assert.equal(second.state, 'absent');
  assert.equal(first.bot, BOT);
  assert.equal(first.skill, 'kit:obk-tdd');
  assert.deepEqual(await listedIn(bots), []);
});

test('SR3 a bot that is not there is refused, and nothing is written', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'kit:obk-tdd');
  const before = await snapshot(bots, skipGit);

  const result = await box.run(['skills', 'remove', '--bots', 'bots', '--bot', 'no-such-bot', '--skill', 'kit:obk-tdd']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('no-such-bot'), `the refusal should name the bot, got: ${result.stderr}`);
  assert.deepEqual(await snapshot(bots, skipGit), before);
});

test('SR4 it unlinks nothing itself, and skills build afterwards takes the link away', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'house-style');
  const common = await commonSkill(bots, 'house-style');
  const built = await box.run(['skills', 'build', '--bots', 'bots', '--bot', BOT]);
  assert.equal(built.code, 0, `${built.stderr}${built.stdout}`);
  await assertLinked(bots, BOT, 'house-style', common);
  const linked = await treeIn(bots, BOT);

  const result = await remove(box, 'house-style');

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await treeIn(bots, BOT), linked, 'skills remove writes the list and links nothing, unlinks nothing');

  const rebuilt = await box.run(['skills', 'build', '--bots', 'bots', '--bot', BOT]);
  assert.equal(rebuilt.code, 0, `${rebuilt.stderr}${rebuilt.stdout}`);
  await assertNotThere(bots, BOT, 'house-style');
});
