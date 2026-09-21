// `obk skills add --bots <path> --bot <bot> --skill <ref>`: one entry appended
// to a bot's own `skills:` list, so that giving a bot a skill no longer means
// opening its `bot.yaml`.
//
// It writes the list and stops. Nothing is linked — `obk skills build` is what
// puts a skill where a harness reads it — and Orca is not touched.
//
// An entry the list already carries is not an error: the bot already has what
// was asked for, so the command says so, changes nothing and exits 0. That is
// the "safe to run again" rule, and the one place this command differs from
// `obk source add` next door.
//
// The rest of the bot.yaml is the user's, on the same terms as everywhere else:
// their comments, their keys and their sessions come back as they wrote them,
// or the command refuses and writes nothing.

import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import {
  assertCleanFailure,
  assertHomeUntouched,
  assertKeptWhatTheyWrote,
  assertNoTrailingSpace,
  botHomeOf,
  createSandbox,
  skipGit,
  snapshot,
} from './helpers/cli.js';
import {
  assertLinked,
  botYamlOf,
  commonSkill,
  treeIn,
} from './helpers/skills.js';

/** The bot every test here gives a skill to. */
const BOT = 'api-bot';

/** A bots folder `init` made, with one bot of its own in it. */
async function withBot(box, harness = 'claude') {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', harness]);
  assert.equal(made.code, 0, made.stderr);
  return box.path('bots');
}

/** Add one skill to the bot. */
const add = (box, skill, bot = BOT) =>
  box.run(['skills', 'add', '--bots', 'bots', '--bot', bot, '--skill', skill]);

/** The bot.yaml as text, and as the mapping the kit reads. */
const botText = (bots, bot = BOT) => readFile(botYamlOf(bots, bot), 'utf8');
const listedIn = async (bots, bot = BOT) => parse(await botText(bots, bot))?.skills;

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

test('R2 skills add appends the entry to the bot\'s skills list, and changes nothing else', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const before = await snapshot(bots, skipGit);
  const calls = (await box.orca.calls()).length;

  const result = await add(box, 'kit:obk-tdd');

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(await listedIn(bots), ['kit:obk-tdd']);
  const after = await snapshot(bots, skipGit);
  assert.deepEqual(
    Object.keys(after).filter((rel) => after[rel] !== before[rel]),
    [path.join('bots', BOT, 'bot.yaml')],
    'the bot\'s own file is the only thing that changes',
  );
  assert.equal((await box.orca.calls()).length, calls, 'and Orca is asked nothing');
  await assertHomeUntouched(box);
});

for (const [label, ref] of [
  ['a bare name, a skill in the user\'s own folder', 'house-style'],
  ['one of the kit\'s own', 'kit:obk-tdd'],
  ['one from an online source', 'someones-skills:their-skill'],
  ['a path to a skill directory on disk', '../shared/skills/house-style'],
]) {
  test(`R2 ${label} is written down exactly as it was given`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);

    const result = await add(box, ref);

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(await listedIn(bots), [ref], `got:\n${await botText(bots)}`);
  });
}

test('R2 skills pile up in the order they were added', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);

  for (const ref of ['kit:obk-tdd', 'house-style', 'someones-skills:their-skill']) {
    const result = await add(box, ref);
    assert.equal(result.code, 0, result.stderr);
  }

  assert.deepEqual(await listedIn(bots), ['kit:obk-tdd', 'house-style', 'someones-skills:their-skill']);
});

test('R2 an entry already on the list changes nothing on disk and says it was already there', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const first = await add(box, 'kit:obk-tdd');
  assert.equal(first.code, 0, first.stderr);
  const before = await botText(bots);
  const tree = await snapshot(bots, skipGit);

  const again = await add(box, 'kit:obk-tdd');

  assert.equal(again.code, 0, `already there is a success, not a refusal: ${again.stderr}`);
  assert.equal(again.stderr, '');
  assert.ok(again.stdout.includes('kit:obk-tdd'), `the report should name the skill, got: ${again.stdout}`);
  assert.notEqual(
    again.stdout,
    first.stdout,
    'a run that found it already there does not read the same as the run that added it',
  );
  assert.equal(await botText(bots), before, 'the file keeps its bytes: there was nothing to write');
  assert.deepEqual(await snapshot(bots, skipGit), tree);
  assert.deepEqual(await listedIn(bots), ['kit:obk-tdd'], 'and the entry is on the list once, not twice');
});

test('R2 the answer says which of the two happened, and the two are not the same answer', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);

  const asJson = ['skills', 'add', '--bots', 'bots', '--bot', BOT, '--skill', 'kit:obk-tdd', '--json'];
  const first = answerOf(await box.run(asJson));
  const second = answerOf(await box.run(asJson));

  assert.equal(first.state, 'added');
  assert.equal(second.state, 'there', 'the second run found it already listed');
  assert.deepEqual(await listedIn(bots), ['kit:obk-tdd']);
});

test('R2 a longer way of naming the same skill is a different entry, and is added', async (t) => {
  // `kit:obk-tdd` and `obk-tdd` are two entries, and which shelf each looks on
  // is `skills build`'s business. This command adds what it was given unless
  // that exact entry is already listed.
  const box = await createSandbox(t);
  const bots = await withBot(box);
  assert.equal((await add(box, 'kit:obk-tdd')).code, 0);

  const result = await add(box, 'obk-tdd');

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await listedIn(bots), ['kit:obk-tdd', 'obk-tdd']);
});

test('R2 everything else in bot.yaml still says what the user wrote', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const mine = `# my own notes about this bot
name: api-bot
harness: codex
charter: |
  Mine, and unchanged.
notes: keep me            # a key the kit knows nothing about
rules: [my-rule]
skills:
  - house-style           # the one I wrote myself
sessions:
  - name: mine
    approval: ask
`;
  await writeFile(botYamlOf(bots, BOT), mine);

  const result = await add(box, 'kit:obk-tdd');

  assert.equal(result.code, 0, result.stderr);
  const after = await botText(bots);
  assertKeptWhatTheyWrote(mine, after, { changed: ['skills'] });
  assertNoTrailingSpace(after);
  const doc = parse(after);
  assert.equal(doc.notes, 'keep me');
  assert.deepEqual(doc.rules, ['my-rule']);
  assert.equal(doc.charter, 'Mine, and unchanged.\n');
  assert.deepEqual(doc.sessions, [{ name: 'mine', approval: 'ask' }]);
  assert.deepEqual(doc.skills, ['house-style', 'kit:obk-tdd'], 'theirs first, the new one after it');
  assert.ok(after.includes('the one I wrote myself'), `the comment on their own entry should still be there:\n${after}`);
});

/** The ways a user writes a skills list. */
const STYLES = [
  ['the empty list bot create writes', 'skills: []\n'],
  ['a block list of their own', 'skills:\n  - house-style\n  - kit:obk-reviewing\n'],
  ['an indentless block list', 'skills:\n- house-style\n- kit:obk-reviewing\n'],
  ['a flow list all on one line', 'skills: [house-style, kit:obk-reviewing]\n'],
  ['a skills key with nothing under it', 'skills:\n'],
  ['no skills key at all', ''],
];

for (const [label, tail] of STYLES) {
  test(`R2 a skill added to ${label} leaves a file that still lists them all`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    const mine = `name: api-bot\nharness: claude\ncharter: mine\nrules: []\nsessions: []\n${tail}`;
    await writeFile(botYamlOf(bots, BOT), mine);
    const were = parse(mine)?.skills ?? [];

    const result = await add(box, 'kit:obk-tdd');

    assert.equal(result.code, 0, result.stderr);
    const text = await botText(bots);
    assert.deepEqual(
      parse(text)?.skills,
      [...were, 'kit:obk-tdd'],
      `every skill that was there should be untouched, with the new one after them:\n${text}`,
    );
    assertNoTrailingSpace(text);
  });
}

test('R2 a bot.yaml the kit cannot add to safely is refused, and left exactly as it was', async (t) => {
  // An alias: the skills are written once under a key of the user's own, and
  // `skills` points at them. There is nowhere in that file to put a new entry
  // that means what the user asked for, so the answer is to say so and leave
  // the file to its owner.
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const mine = 'name: api-bot\nharness: claude\ncharter: mine\nrules: []\nsessions: []\n'
    + 'shared: &shared\n  - house-style\nskills: *shared\n';
  await writeFile(botYamlOf(bots, BOT), mine);
  const before = await snapshot(bots, skipGit);

  const result = await add(box, 'kit:obk-tdd');

  assertCleanFailure(result);
  assert.ok(
    result.stderr.includes(botYamlOf(bots, BOT)),
    `the refusal should name the file the user has to open, got: ${result.stderr}`,
  );
  assert.ok(result.stderr.includes('kit:obk-tdd'), `and the entry it could not add, got: ${result.stderr}`);
  assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing at all');
  assert.equal(await botText(bots), mine, 'and the file is the user\'s, byte for byte');
});

test('R2 a bot that is not there is refused, and nothing is written', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const before = await snapshot(bots, skipGit);

  const result = await add(box, 'kit:obk-tdd', 'no-such-bot');

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('no-such-bot'), `the refusal should name the bot, got: ${result.stderr}`);
  assert.deepEqual(await snapshot(bots, skipGit), before);
});

for (const [label, args, missing] of [
  ['no --bot', ['--skill', 'kit:obk-tdd'], '--bot'],
  ['no --skill', ['--bot', BOT], '--skill'],
  ['an empty --bot', ['--bot=', '--skill', 'kit:obk-tdd'], '--bot'],
  ['an empty --skill', ['--bot', BOT, '--skill='], '--skill'],
]) {
  test(`R2 skills add with ${label} is refused, names the flag, and writes nothing`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    const before = await snapshot(bots, skipGit);

    const result = await box.run(['skills', 'add', '--bots', 'bots', ...args]);

    assertCleanFailure(result);
    assert.ok(result.stderr.includes(missing), `should name ${missing}, got: ${result.stderr}`);
    assert.ok(
      result.stderr.includes('skills add'),
      `and say which command needs it, as every other refusal of a missing flag does, got: ${result.stderr}`,
    );
    assert.deepEqual(await snapshot(bots, skipGit), before);
  });
}

test('R2 a folder that is not a bots folder is refused, and nothing is made there', async (t) => {
  const box = await createSandbox(t);

  const result = await add(box, 'kit:obk-tdd');

  assertCleanFailure(result);
  assert.match(result.stderr, /obk init/, `should send the user to init, as its neighbours do, got: ${result.stderr}`);
  assert.deepEqual(await readdir(box.cwd), [], 'skills add makes no bots folder of its own');
});

test('R2 skills add without --bots is refused and says so', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['skills', 'add', '--bot', BOT, '--skill', 'kit:obk-tdd']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('--bots'), `should name --bots, got: ${result.stderr}`);
});

test('R2 it links nothing: what each harness reads is exactly what it read before', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  await commonSkill(bots, 'house-style');
  const before = await treeIn(bots, BOT);

  const result = await add(box, 'house-style');

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await listedIn(bots), ['house-style'], 'the entry is on the list');
  assert.deepEqual(
    await treeIn(bots, BOT),
    before,
    'and nothing is linked: skills build is what puts a skill where a harness reads it',
  );
});

test('R2 it says what it added and names the command that links it', async (t) => {
  const box = await createSandbox(t);
  await withBot(box);

  const result = await add(box, 'kit:obk-tdd');

  assert.equal(result.code, 0, result.stderr);
  for (const fact of ['kit:obk-tdd', BOT]) {
    assert.ok(result.stdout.includes(fact), `the report should name ${fact}, got: ${result.stdout}`);
  }
  assert.ok(
    result.stdout.includes('skills build'),
    `it should name the command that links it, got: ${result.stdout}`,
  );
  assert.ok(!result.stdout.includes('undefined'), `nothing should be undefined, got: ${result.stdout}`);
});

test('R2 --json answers the same facts, with bots as the resolved absolute path', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);

  const result = await box.run([
    'skills', 'add', '--bots', 'bots', '--bot', BOT, '--skill', 'kit:obk-tdd', '--json',
  ]);

  const answer = answerOf(result);
  assert.equal(answer.bots, bots, '--bots was given as a relative path and comes back resolved');
  assert.equal(answer.bot, BOT);
  assert.equal(answer.skill, 'kit:obk-tdd');
  assert.equal(answer.home, botHomeOf(bots, BOT));
});

test('R2 what it wrote is an entry skills build follows', async (t) => {
  // The end of it: an entry the kit writes and then cannot follow is a command
  // that looks like it worked and leaves the bot without its skill.
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const common = await commonSkill(bots, 'house-style');

  const added = await add(box, 'house-style');
  const built = await box.run(['skills', 'build', '--bots', 'bots', '--bot', BOT]);

  assert.equal(added.code, 0, added.stderr);
  assert.equal(built.code, 0, `${built.stderr}${built.stdout}`);
  await assertLinked(bots, BOT, 'house-style', common);
});
