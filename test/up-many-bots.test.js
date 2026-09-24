// `obk up` over a fleet. Every folder under `<bots>/bots/` holding a `bot.yaml`
// is a bot, and they come up in name order so a run reads the same way twice.
//
// Each bot gets its own Orca project — a folder workspace named after it, the
// hyphens as spaces and each word capitalised — and one tab per session,
// titled `<display name> <session name>`. Only Bot Father gets the extra ops
// tab for fleet-wide work (PRD 6.2); a bot with one session has one tab.
//
// `--bot` narrows a run to one bot and `--session` to one of its sessions, for
// a caller that wants one thing back rather than the fleet.

import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import {
  assertCleanFailure,
  assertOrcaCallsAllowed,
  bareLaunch,
  botHomeOf,
  createSandbox,
  skipGit,
  snapshot,
  TAB_TITLES,
  tabsOfBot,
  typedInto,
} from './helpers/cli.js';

/** Make a bot with the sessions named, and give back the bots folder. */
async function makeBot(box, name, harness, sessions = ['daily']) {
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', name, '--harness', harness]);
  assert.equal(made.code, 0, made.stderr);
  for (const session of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', name, '--name', session]);
    assert.equal(added.code, 0, added.stderr);
  }
  return box.path('bots');
}

/** A seeded bots folder, with Bot Father already up in Orca. */
async function seeded(box, harness = 'claude') {
  const result = await box.run(['init', '--bots', 'bots', '--harness', harness]);
  assert.equal(result.code, 0, result.stderr);
  return box.path('bots');
}

/** The tabs a `--json` run reported, as `<bot> <name>` pairs, in the order it reported them. */
function reported(result) {
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout).tabs.map((tab) => `${tab.bot} ${tab.name}`);
}

test('every bot in the folder comes up, in name order', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  // Made out of order, so nothing but a sort can put them back in it.
  await makeBot(box, 'zebra-bot', 'codex');
  await makeBot(box, 'api-bot', 'claude');

  const result = await box.run(['up', '--bots', 'bots', '--json']);

  assert.deepEqual(reported(result), [
    'api-bot daily',
    'bot-father daily',
    'bot-father null',
    'zebra-bot daily',
  ]);
});

test('each bot gets its own Orca project, named after it', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot', 'claude');

  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);

  const setups = await box.orca.setups();
  assert.deepEqual(
    setups.map((setup) => [setup.path, setup.displayName, setup.kind]).sort(),
    [
      [botHomeOf(bots, 'api-bot'), 'Api Bot', 'folder'],
      [botHomeOf(bots, 'bot-father'), 'Bot Father', 'folder'],
    ].sort(),
    'a bot\'s project is a folder workspace called by the bot\'s name in words',
  );
});

for (const [name, display] of [
  ['api-bot', 'Api Bot'],
  ['web', 'Web'],
  ['a-b-c', 'A B C'],
]) {
  test(`${name} shows in Orca as ${display}`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await makeBot(box, name, 'claude', ['daily']);

    assert.equal((await box.run(['up', '--bots', 'bots', '--bot', name])).code, 0);

    const setup = (await box.orca.setups()).find((one) => one.path === botHomeOf(bots, name));
    assert.equal(setup.displayName, display);
    const tabs = await tabsOfBot(box, bots, name);
    assert.deepEqual(tabs.map((tab) => tab.title), [`${display} daily`], 'and its tab carries the same name');
  });
}

test('a bot has one tab per session, and no ops tab: that is Bot Father\'s alone', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot', 'codex', ['daily', 'review']);

  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);

  const mine = await tabsOfBot(box, bots, 'api-bot');
  assert.deepEqual(
    mine.map((tab) => tab.title).sort(),
    ['Api Bot daily', 'Api Bot review'],
    'two sessions, two tabs, and nothing beside them',
  );
  for (const tab of mine) {
    assert.deepEqual(typedInto(tab), [bareLaunch(box, 'codex')], 'each session is started on the bot\'s harness');
  }

  const father = await tabsOfBot(box, bots, 'bot-father');
  assert.deepEqual(father.map((tab) => tab.title).sort(), [TAB_TITLES.daily, TAB_TITLES.ops].sort());
});

test('a bot with no sessions at all gets no tab, and no project full of nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot', 'claude', []);

  const result = await box.run(['up', '--bots', 'bots', '--json']);

  assert.deepEqual(await tabsOfBot(box, bots, 'api-bot'), [], 'a bot with nothing to run has nothing open');
  assert.deepEqual(reported(result), ['bot-father daily', 'bot-father null']);
});

test('--bot brings up that bot and leaves the rest alone', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot', 'claude');
  await makeBot(box, 'web-bot', 'codex');
  await box.orca.set({ setups: [], terminals: [] });

  const result = await box.run(['up', '--bots', 'bots', '--bot', 'web-bot', '--json']);

  assert.deepEqual(reported(result), ['web-bot daily']);
  assert.deepEqual(await tabsOfBot(box, bots, 'api-bot'), [], 'the bot that was not asked for stays as it was');
  assert.deepEqual(await tabsOfBot(box, bots, 'bot-father'), [], 'and so does Bot Father, ops tab and all');
  assert.deepEqual((await box.orca.setups()).map((setup) => setup.displayName), ['Web Bot']);
});

test('--session with --bot brings up that one session', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot', 'codex', ['daily', 'review', 'watch']);

  const result = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot', '--session', 'review', '--json']);

  assert.deepEqual(reported(result), ['api-bot review']);
  assert.deepEqual((await tabsOfBot(box, bots, 'api-bot')).map((tab) => tab.title), ['Api Bot review']);
});

test('--session on Bot Father does not drag the ops tab in with it', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await box.orca.set({ terminals: [] });

  const result = await box.run(['up', '--bots', 'bots', '--bot', 'bot-father', '--session', 'daily', '--json']);

  assert.deepEqual(reported(result), ['bot-father daily']);
  assert.deepEqual((await tabsOfBot(box, bots, 'bot-father')).map((tab) => tab.title), [TAB_TITLES.daily]);
});

test('--session without --bot is refused: it says nothing about whose session it is', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot', 'claude');
  const before = await snapshot(bots, skipGit);

  const result = await box.run(['up', '--bots', 'bots', '--session', 'daily']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('--bot'), `should say what is missing, got: ${result.stderr}`);
  assert.deepEqual(await snapshot(bots, skipGit), before);
});

test('a bot that is not there is refused, and the bots there are named', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  await makeBot(box, 'api-bot', 'claude');
  const terminals = await box.orca.terminals();

  const result = await box.run(['up', '--bots', 'bots', '--bot', 'ghost-bot']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('ghost-bot'), `should name what it was asked for, got: ${result.stderr}`);
  assert.deepEqual(await box.orca.terminals(), terminals, 'and open nothing on the way');
});

test('a session the bot does not have is refused, and nothing is opened', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  await makeBot(box, 'api-bot', 'claude');
  const terminals = await box.orca.terminals();

  const result = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot', '--session', 'nightly']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('nightly'), `should name the session it was asked for, got: ${result.stderr}`);
  assert.deepEqual(await box.orca.terminals(), terminals);
});

test('a bots folder holding no bot at all is refused plainly, and nothing is written', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await rm(botHomeOf(bots, 'bot-father'), { recursive: true });
  await box.orca.set({ setups: [], terminals: [] });
  const before = await snapshot(bots, skipGit);

  const result = await box.run(['up', '--bots', 'bots']);

  assertCleanFailure(result);
  assert.deepEqual(await snapshot(bots, skipGit), before, 'up seeds nothing: making bots is not its job');
  assert.deepEqual(await box.orca.terminals(), []);
});

test('a folder under bots/ with no bot.yaml in it is not a bot', async (t) => {
  // Whatever else a user keeps there — notes, a scratch folder, something half
  // moved — is theirs. `bot.yaml` is what makes a folder a bot.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await mkdir(path.join(bots, 'bots', 'notes'), { recursive: true });
  await writeFile(path.join(bots, 'bots', 'notes', 'scratch.md'), 'mine\n');

  const result = await box.run(['up', '--bots', 'bots', '--json']);

  assert.deepEqual(reported(result), ['bot-father daily', 'bot-father null']);
  assert.deepEqual(await readdir(path.join(bots, 'bots', 'notes')), ['scratch.md'], 'and it is left alone');
});

test('a bots folder holding only such a folder is refused like an empty one', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await rm(botHomeOf(bots, 'bot-father'), { recursive: true });
  await mkdir(path.join(bots, 'bots', 'notes'), { recursive: true });

  const result = await box.run(['up', '--bots', 'bots']);

  assertCleanFailure(result);
});

test('a second run over the fleet changes nothing anywhere', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot', 'codex', ['daily', 'review']);
  await makeBot(box, 'web-bot', 'claude');
  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);
  const terminals = await box.orca.terminals();
  const setups = await box.orca.setups();
  const files = await snapshot(bots, skipGit);

  const again = await box.run(['up', '--bots', 'bots']);

  assert.equal(again.code, 0, again.stderr);
  assert.deepEqual(await box.orca.terminals(), terminals, 'nothing opened, nothing typed into');
  assert.deepEqual(await box.orca.setups(), setups);
  assert.deepEqual(await snapshot(bots, skipGit), files);
});

test('one bot\'s book is its own', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot', 'codex', ['daily', 'review']);

  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);

  const mine = parse(await readFile(path.join(botHomeOf(bots, 'api-bot'), 'sessions.yaml'), 'utf8'));
  assert.deepEqual(Object.keys(mine.sessions).sort(), ['daily', 'review']);

  const father = parse(await readFile(path.join(botHomeOf(bots, 'bot-father'), 'sessions.yaml'), 'utf8'));
  assert.deepEqual(Object.keys(father.sessions).sort(), ['daily'], 'Bot Father\'s book knows only Bot Father');
});

test('a whole fleet run keeps to the allowed Orca commands, and closes no tab', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  await makeBot(box, 'api-bot', 'codex', ['daily', 'review']);
  await makeBot(box, 'web-bot', 'claude');

  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);
  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);

  assertOrcaCallsAllowed(await box.orca.calls());
});
