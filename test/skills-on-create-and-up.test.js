// The two commands that link a bot's skills without being asked: `bot create`,
// which gives a new bot what the lists already name, and `up`, which links
// every bot it is bringing up before it opens a tab.
//
// The order is the point of the `up` half. Both harnesses read a project's
// skills out of the folder the session starts in, and a session that comes up
// with an empty skills directory is a bot missing the techniques it was given
// — so the links have to be there before the first tab is opened, for the same
// reason the rules are built there. The proof is taken from inside the run: the
// fake Orca copies a bot's skill file aside in the middle of the first
// `terminal create`, through the link, and what it copied says what was there
// at that moment.
//
// `up`'s own job is unchanged by any of it: a bot whose skills are in trouble
// is reported, and the run carries on with its usual exit code.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  createSandbox,
  orcaCallsOf,
  tabsOfBot,
} from './helpers/cli.js';
import { agentsOf } from './helpers/rules.js';
import {
  addSkills,
  answerOf,
  assertLinked,
  botYamlOf,
  commonSkill,
  defaultsOf,
  entryOf,
  HARNESSES,
  heldBy,
  kitSkill,
  linesAbout,
  linkByHand,
  namesIn,
  skillIn,
  skillsDirOf,
  treeIn,
  writeSkill,
} from './helpers/skills.js';

/** One of the kit's own skills, named here so a test that meets it says which. */
const KIT_SKILL = 'obk-tdd';

/** A bots folder `init` made, with Bot Father in it. */
async function seeded(box) {
  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(result.code, 0, result.stderr);
  return box.path('bots');
}

/** `obk bot create`, answered as it comes back. */
const createBot = (box, name, ...rest) => box.run([
  'bot', 'create', '--bots', 'bots', '--name', name, '--harness', 'claude',
  '--charter', `${name} owns its own corner.`, ...rest,
]);

/** A bot with one session, so `up` has a tab to open for it. */
async function makeBot(box, name) {
  const made = await createBot(box, name);
  assert.equal(made.code, 0, made.stderr);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', name, '--name', 'daily']);
  assert.equal(added.code, 0, added.stderr);
}

/**
 * A program the fake Orca runs in the middle of a call: it copies the file
 * `OBK_TEST_WATCH` names to `OBK_TEST_WITNESS`, so a test can read what was
 * there at that moment rather than at the end of the run. A file reached
 * through a link that has not been made yet is a copy that fails, and the
 * witness says so with its exit code.
 */
async function witness(box, watch, kept) {
  const file = path.join(box.root, 'witness.cjs');
  await writeFile(file, [
    "const { copyFileSync } = require('node:fs');",
    'copyFileSync(process.env.OBK_TEST_WATCH, process.env.OBK_TEST_WITNESS);',
    '',
  ].join('\n'));
  await chmod(file, 0o755);
  return {
    argv: [process.execPath, file],
    env: { OBK_TEST_WATCH: watch, OBK_TEST_WITNESS: kept },
  };
}

test('bot create links the skills the new bot is born with', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const kit = await kitSkill(KIT_SKILL);
  await addSkills(defaultsOf(bots), `kit:${KIT_SKILL}`);

  const result = await createBot(box, 'api-bot');

  assert.equal(result.code, 0, result.stderr);
  await assertLinked(bots, 'api-bot', KIT_SKILL, kit);
  linesAbout(result.stdout, KIT_SKILL);
});

test('a new bot that lists no skills is linked nothing, and the create says nothing about skills', async (t) => {
  // A fresh bots folder names no skills, so this is what every create looks
  // like until a user picks some: a report that does not talk about a shelf
  // the bot has nothing on.
  const box = await createSandbox(t);
  const bots = await seeded(box);

  const result = await createBot(box, 'api-bot');

  assert.equal(result.code, 0, result.stderr);
  for (const harness of HARNESSES) {
    assert.deepEqual(await namesIn(bots, 'api-bot', harness), [], `${harness} should have been given nothing`);
  }
  assert.ok(
    !/\bskills?\b/i.test(`${result.stdout}${result.stderr}`),
    `a bot with no skills has nothing to report about them, got:\n${result.stdout}${result.stderr}`,
  );
});

test('up links every bot before it opens the first tab', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'zebra-bot');
  const kit = await kitSkill(KIT_SKILL);
  await addSkills(defaultsOf(bots), `kit:${KIT_SKILL}`);
  // Orca forgot everything, so the run opens tabs for both bots, in name
  // order: the first `terminal create` is Bot Father's, and the bot whose link
  // is watched is the last one the run would get to.
  const kept = path.join(box.root, 'kept.md');
  // The fake counts a command's calls from the day the sandbox began, and
  // `init` has made some already, so the call to watch is counted from here.
  const already = orcaCallsOf(await box.orca.calls(), 'terminal create').length;
  await box.orca.set({
    setups: [],
    terminals: [],
    runDuring: {
      command: 'terminal create',
      on: already + 1,
      ...await witness(box, path.join(skillsDirOf(bots, 'zebra-bot', 'claude'), KIT_SKILL, 'SKILL.md'), kept),
    },
  });

  const result = await box.run(['up', '--bots', 'bots']);

  assert.equal(result.code, 0, result.stderr);
  const ran = await box.orca.ranDuring();
  assert.equal(ran.length, 1, `the witness should have run once during the run, got: ${JSON.stringify(ran)}`);
  assert.equal(
    ran[0].status,
    0,
    `every bot's skills should be linked before any session is started on them; the witness could not read the link: ${ran[0].stderr}`,
  );
  assert.equal(
    await readFile(kept, 'utf8'),
    await readFile(path.join(kit, 'SKILL.md'), 'utf8'),
    'and what it read through the link is the kit\'s own skill',
  );
});

test('up carries the skills entries beside the tabs and the rules, plain and as JSON', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  const kit = await kitSkill(KIT_SKILL);
  await addSkills(defaultsOf(bots), `kit:${KIT_SKILL}`);

  const plain = await box.run(['up', '--bots', 'bots']);

  assert.equal(plain.code, 0, plain.stderr);
  for (const bot of ['api-bot', 'bot-father']) {
    await assertLinked(bots, bot, KIT_SKILL, kit);
    linesAbout(plain.stdout, bot);
  }
  linesAbout(plain.stdout, KIT_SKILL);

  const other = await createSandbox(t);
  const theirs = await seeded(other);
  await makeBot(other, 'api-bot');
  await addSkills(defaultsOf(theirs), `kit:${KIT_SKILL}`);
  const asJson = await other.run(['up', '--bots', 'bots', '--json']);

  assert.equal(asJson.code, 0, asJson.stderr);
  const answer = answerOf(asJson);
  assert.ok(Array.isArray(answer.tabs), `up --json still answers about its tabs, got: ${asJson.stdout}`);
  assert.ok(Array.isArray(answer.rules), `and about its rules, got: ${asJson.stdout}`);
  for (const bot of ['api-bot', 'bot-father']) {
    assert.equal(skillIn(entryOf(answer, bot), KIT_SKILL).managed, true);
  }
});

test('a bot whose skills list is bad is reported, and comes up all the same', async (t) => {
  // Not the same as a bot with no AGENTS.md. A bot without a skill has its
  // charter and its rules; it is a bot that is missing a technique, which is
  // no reason to leave its sessions down.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  const kit = await kitSkill(KIT_SKILL);
  await addSkills(defaultsOf(bots), `kit:${KIT_SKILL}`);
  await addSkills(botYamlOf(bots, 'api-bot'), 'ghost-skill');

  const result = await box.run(['up', '--bots', 'bots', '--json']);

  assert.equal(result.code, 0, `a bot whose skills are in trouble does not change what up ends in: ${result.stderr}`);
  const answer = answerOf(result);
  const entry = entryOf(answer, 'api-bot');
  assert.ok(entry.trouble.includes('ghost-skill'), `the trouble should name the entry, got: ${JSON.stringify(entry)}`);
  assert.ok(!('trouble' in entryOf(answer, 'bot-father')), 'the bots beside it are given their skills as usual');
  await assertLinked(bots, 'bot-father', KIT_SKILL, kit);
  assert.deepEqual(
    (await tabsOfBot(box, bots, 'api-bot')).map((tab) => tab.title),
    ['Api Bot daily'],
    'the bot still comes up: a skill the kit could not find is not a reason to leave a session down',
  );
});

test('bot create names a skills entry it could not follow, and the bot is written all the same', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await addSkills(defaultsOf(bots), 'ghost-skill');

  const result = await createBot(box, 'api-bot');

  const said = `${result.stdout}${result.stderr}`;
  assert.ok(!/^\s+at /m.test(result.stderr), `expected a message, got a crash:\n${result.stderr}`);
  assert.ok(said.includes('ghost-skill'), `it should name what it could not follow, got: ${said}`);
  assert.ok(
    existsSync(agentsOf(bots, 'api-bot')),
    'the bot has its charter and its rules, which is what a bot needs to exist; the skill it is missing is a line in a report',
  );
});

// `up` reads every bot's skills directories on the way to opening a tab, so
// whatever a user has put in one of them is something `up` meets on an ordinary
// morning. Neither of these is a reason to touch it, and neither is a reason
// for the fleet to stay down.

test('up leaves a link the user made alone, and still brings the bot up', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  const common = await commonSkill(bots, 'house-style');
  // Into their own shelf, which is where the kit links from too, and named in
  // no list: the kit has no reason of its own for it to be there.
  await linkByHand(bots, 'api-bot', 'house-style', common);
  const before = await treeIn(bots, 'api-bot');

  const result = await box.run(['up', '--bots', 'bots', '--json']);

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await treeIn(bots, 'api-bot'), before, 'what the user linked is still exactly what they linked');
  assert.equal(skillIn(entryOf(answerOf(result), 'api-bot'), 'house-style').managed, false);
  assert.deepEqual(
    (await tabsOfBot(box, bots, 'api-bot')).map((tab) => tab.title),
    ['Api Bot daily'],
    'and the bot comes up as usual',
  );
});

test('a link of the user\'s that points at nothing does not keep the fleet down', async (t) => {
  // Reading a link that resolves to nothing is something `up` does on the way
  // to every tab. If it ends the run there, one deleted folder of the user's
  // leaves every bot in the fleet with no session at all.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  const gone = await writeSkill(path.join(box.root, 'elsewhere', 'was-here'));
  await linkByHand(bots, 'api-bot', 'was-here', gone);
  await rm(gone, { recursive: true });

  const result = await box.run(['up', '--bots', 'bots', '--json']);

  assert.equal(result.code, 0, `a link of the user's pointing nowhere does not change what up ends in: ${result.stderr}`);
  assert.ok(!/^\s+at /m.test(result.stderr), `expected a report, got a crash:\n${result.stderr}`);
  assert.equal(skillIn(entryOf(answerOf(result), 'api-bot'), 'was-here').managed, false, 'it is the user\'s, and it is reported');
  for (const harness of HARNESSES) {
    assert.equal((await heldBy(bots, 'api-bot', harness)).get('was-here')?.link, true, 'and it is left where it is');
  }
  assert.deepEqual(
    (await tabsOfBot(box, bots, 'api-bot')).map((tab) => tab.title),
    ['Api Bot daily'],
    'the bot whose directory it is in comes up',
  );
  assert.equal((await tabsOfBot(box, bots, 'bot-father')).length, 2, 'and so does every other bot in the fleet');
});
