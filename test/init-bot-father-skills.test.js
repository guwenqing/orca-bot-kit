// `obk init` seeds Bot Father with the kit's two management skills, so that a
// fresh fleet has a Bot Father that can actually manage it.
//
// The live failure this is about: after an init, Bot Father's `bot.yaml` said
// `skills: []` and its home had no skills directory at all. The bot whose whole
// job is to run the fleet in conversation had no technique for doing it, and
// the user could not fix that by asking, because asking is the thing that did
// not work.
//
// Two rules hold it together. The entries go on Bot Father's own list, not into
// `defaults.yaml`, because they are its job and not every bot's. And `init`
// writes them only when it writes the file: a `bot.yaml` that is already there
// is the user's, and the kit cannot tell a list somebody trimmed from a list
// that came from an older kit. So a second init adds nothing, and an entry
// taken off stays off. The way back for a Bot Father that predates this is
// `obk skills add`, which is a thing a person can be told to run.

import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import {
  assertKeptWhatTheyWrote,
  assertNoTrailingSpace,
  bookOf,
  botHomeOf,
  createSandbox,
} from './helpers/cli.js';
import {
  answerOf,
  assertLinked,
  botYamlOf,
  defaultsOf,
  entryOf,
  HARNESSES,
  kitSkill,
  namesIn,
  setSkills,
  skillNamesIn,
} from './helpers/skills.js';

/** The two skills Bot Father's job needs, and the entries that name them. */
const MANAGEMENT = ['obk-bot-building', 'obk-fleet-review'];
const ENTRIES = MANAGEMENT.map((name) => `kit:${name}`);

/** A bots folder `init` made. */
async function seeded(box, harness = 'claude') {
  const result = await box.run(['init', '--bots', 'bots', '--harness', harness]);
  assert.equal(result.code, 0, result.stderr);
  return box.path('bots');
}

/** The `skills:` list of a bot.yaml, as text and as the list itself. */
const botText = (bots, bot) => readFile(botYamlOf(bots, bot), 'utf8');
const skillsIn = async (bots, bot) => parse(await botText(bots, bot))?.skills;

/** A list named without caring what order it is in, and with a duplicate still visible. */
const inAnyOrder = (listed) => (listed ?? []).slice().sort();

test('R4 init puts both management skills on Bot Father\'s own list', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);

  const listed = await skillsIn(bots, 'bot-father');

  assert.deepEqual(inAnyOrder(listed), ENTRIES, `got: ${await botText(bots, 'bot-father')}`);
  assert.equal(listed.length, 2, 'each of them once');
});

test('R4 they go on Bot Father\'s own list and not into defaults.yaml', async (t) => {
  // Every bot would get them from `defaults.yaml`, and they are Bot Father's
  // job, not the fleet's. The two halves are asserted together so that the
  // empty one cannot pass on its own.
  const box = await createSandbox(t);
  const bots = await seeded(box);

  const defaults = parse(await readFile(defaultsOf(bots), 'utf8'));

  assert.deepEqual(inAnyOrder(await skillsIn(bots, 'bot-father')), ENTRIES, 'Bot Father carries them itself');
  assert.deepEqual(defaults.skills, [], `defaults.yaml is for what every bot gets, got: ${JSON.stringify(defaults)}`);
});

test('R4 both skills are linked into Bot Father\'s home, for both harnesses', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);

  for (const name of MANAGEMENT) {
    await assertLinked(bots, 'bot-father', name, await kitSkill(name));
  }
  for (const harness of HARNESSES) {
    assert.deepEqual(
      await namesIn(bots, 'bot-father', harness),
      MANAGEMENT,
      `${harness} should read exactly the two management skills`,
    );
  }
});

test('R4 what a harness reads through the link is the skill the kit ships', async (t) => {
  // A link that lands nowhere is the same to a session as no skill at all.
  const box = await createSandbox(t);
  const bots = await seeded(box, 'codex');

  const held = await namesIn(bots, 'bot-father', 'codex');
  for (const name of MANAGEMENT) {
    assert.ok(held.includes(name), `Codex should find ${name} in the bot home, which holds: ${held.join(', ') || 'nothing'}`);
    const through = await readFile(
      path.join(botHomeOf(bots, 'bot-father'), '.agents', 'skills', name, 'SKILL.md'),
      'utf8',
    );
    assert.equal(through, await readFile(path.join(await kitSkill(name), 'SKILL.md'), 'utf8'));
  }
});

test('R4 Bot Father has them and a bot made by bot create does not', async (t) => {
  // Both bots in one test, so that "api-bot has none" cannot pass because
  // nobody has any.
  const box = await createSandbox(t);
  const bots = await seeded(box);

  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude']);

  assert.equal(made.code, 0, made.stderr);
  assert.deepEqual(await skillsIn(bots, 'api-bot'), [], 'a new bot\'s list is its own, and starts empty');
  assert.deepEqual(inAnyOrder(await skillsIn(bots, 'bot-father')), ENTRIES, 'and Bot Father\'s carries both');
  for (const harness of HARNESSES) {
    assert.deepEqual(
      await namesIn(bots, 'api-bot', harness),
      [],
      'managing the fleet is Bot Father\'s job, not every bot\'s',
    );
    assert.deepEqual(await namesIn(bots, 'bot-father', harness), MANAGEMENT);
  }
});

test('R4 a second init leaves the list as it is, with each skill named once', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const before = await botText(bots, 'bot-father');

  const second = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assert.equal(second.code, 0, second.stderr);
  assert.equal(await botText(bots, 'bot-father'), before, 'a file that needs nothing is not rewritten');
  const listed = await skillsIn(bots, 'bot-father');
  assert.deepEqual(inAnyOrder(listed), ENTRIES);
  assert.equal(listed.length, 2, 'and neither of them twice');
});

test('R4 a skill the user has taken off the list is not put back', async (t) => {
  // The kit cannot tell a list somebody trimmed from one that never had them,
  // and a fleet manager that quietly re-adds what its owner removed is worse
  // than one that is missing a skill.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  assert.deepEqual(inAnyOrder(await skillsIn(bots, 'bot-father')), ENTRIES, 'the first init gave it both');
  await setSkills(botYamlOf(bots, 'bot-father'), 'kit:obk-fleet-review');

  const second = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assert.equal(second.code, 0, second.stderr);
  assert.deepEqual(await skillsIn(bots, 'bot-father'), ['kit:obk-fleet-review'], 'what they left is what they get');
  await assertLinked(bots, 'bot-father', 'obk-fleet-review', await kitSkill('obk-fleet-review'));
});

test('R4 a Bot Father that predates this keeps the list it has', async (t) => {
  // A bot.yaml from an older kit is the user's file by now. `init` completes
  // what a run needs — the harness and a session — and leaves the lists alone,
  // exactly as it does today. The way to give an old Bot Father its skills is
  // to ask for them: obk skills add --bot bot-father --skill kit:<name>.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  // The contrast: the file this same init wrote does carry them. What follows
  // puts an older file in its place, and that one is left alone.
  assert.deepEqual(inAnyOrder(await skillsIn(bots, 'bot-father')), ENTRIES, 'a bot.yaml init wrote carries both');
  const older = `# Bot Father runs the fleet.

name: bot-father
charter: |
  Bot Father owns the fleet.
rules: []
skills: []
sessions: []
`;
  await writeFile(botYamlOf(bots, 'bot-father'), older);
  await rm(bookOf(bots));
  await box.orca.set({ setups: [], terminals: [] });

  const again = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assert.equal(again.code, 0, again.stderr);
  const after = await botText(bots, 'bot-father');
  assertKeptWhatTheyWrote(older, after, { changed: ['sessions'] });
  assertNoTrailingSpace(after);
  assert.deepEqual(parse(after).skills, [], 'the lists in a file that was already there are the user\'s');
});

test('R4 a Bot Father whose list was emptied can be given them by asking', async (t) => {
  // The other half of the rule above: init leaves an existing list alone, so
  // the command that adds one has to work on Bot Father like any other bot.
  // That much already works; what makes this test red today is the line that
  // says init gave it the two in the first place.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  assert.deepEqual(inAnyOrder(await skillsIn(bots, 'bot-father')), ENTRIES, 'init gave it both');
  await setSkills(botYamlOf(bots, 'bot-father'));

  for (const entry of ENTRIES) {
    const added = await box.run(['skills', 'add', '--bots', 'bots', '--bot', 'bot-father', '--skill', entry]);
    assert.equal(added.code, 0, added.stderr);
  }
  const built = await box.run(['skills', 'build', '--bots', 'bots', '--bot', 'bot-father']);

  assert.equal(built.code, 0, `${built.stderr}${built.stdout}`);
  assert.deepEqual(inAnyOrder(await skillsIn(bots, 'bot-father')), ENTRIES);
  for (const name of MANAGEMENT) {
    await assertLinked(bots, 'bot-father', name, await kitSkill(name));
  }
});

test('R4 init says which skills Bot Father was given, plain and as JSON', async (t) => {
  const box = await createSandbox(t);

  const plain = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assert.equal(plain.code, 0, plain.stderr);
  for (const name of MANAGEMENT) {
    assert.ok(plain.stdout.includes(name), `the report should name ${name}, got:\n${plain.stdout}`);
  }

  const other = await createSandbox(t);
  const asJson = await other.run(['init', '--bots', 'bots', '--harness', 'claude', '--json']);

  assert.equal(asJson.code, 0, asJson.stderr);
  assert.deepEqual(skillNamesIn(entryOf(answerOf(asJson), 'bot-father')).slice().sort(), MANAGEMENT);
});
