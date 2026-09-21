// `obk bot create` writes one new bot into a bots folder `init` made: the
// `bot.yaml` that holds its charter and its (empty) lists, the `AGENTS.md` the
// charter is written into, the `CLAUDE.md` symlink beside it (PRD 6.6), and a
// `.gitignore` keeping `work/` out of the repo (PRD 6.3).
//
// It writes files and nothing else. A bot is a folder until `obk up` gives it
// tabs, so nothing here reaches Orca, and a refusal leaves the folder exactly
// as it was found — the bots folder is the user's.

import assert from 'node:assert/strict';
import { lstat, readFile, readdir, readlink, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import {
  assertCleanFailure,
  assertHomeUntouched,
  botHomeOf,
  createSandbox,
  skipGit,
  snapshot,
} from './helpers/cli.js';

/** A bots folder `init` made, and Bot Father already in Orca. */
async function seeded(box, harness = 'claude') {
  const result = await box.run(['init', '--bots', 'bots', '--harness', harness]);
  assert.equal(result.code, 0, result.stderr);
  return box.path('bots');
}

/** What a bot's `bot.yaml` says. */
const botYaml = async (bots, bot) => parse(await readFile(path.join(botHomeOf(bots, bot), 'bot.yaml'), 'utf8'));

/** The paths `bot create` added to the bots folder, relative to it. */
async function added(bots, before) {
  const after = await snapshot(bots, skipGit);
  return Object.keys(after).filter((rel) => !(rel in before)).sort();
}

test('bot create writes the bot a home of four files, and touches nothing else', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const before = await snapshot(bots, skipGit);
  const calls = (await box.orca.calls()).length;

  const result = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'codex']);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(await added(bots, before), [
    'bots/api-bot',
    'bots/api-bot/.gitignore',
    'bots/api-bot/AGENTS.md',
    'bots/api-bot/CLAUDE.md',
    'bots/api-bot/bot.yaml',
  ]);
  // A bot is a folder until `up` gives it tabs.
  assert.equal((await box.orca.calls()).length, calls, 'bot create must not talk to Orca at all');
});

test('bot.yaml holds the bot, its harness, its charter and three empty lists', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);

  const result = await box.run([
    'bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'codex',
    '--charter', 'Api Bot owns the API. Good is a green build. Ask before a release.',
  ]);

  assert.equal(result.code, 0, result.stderr);
  const bot = await botYaml(bots, 'api-bot');
  assert.deepEqual(Object.keys(bot).sort(), ['charter', 'harness', 'name', 'rules', 'sessions', 'skills']);
  assert.equal(bot.name, 'api-bot', 'the bot is named after the folder it lives in');
  assert.equal(bot.harness, 'codex');
  assert.equal(bot.charter.trim(), 'Api Bot owns the API. Good is a green build. Ask before a release.');
  assert.deepEqual(bot.rules, []);
  assert.deepEqual(bot.skills, []);
  assert.deepEqual(bot.sessions, [], 'a new bot has no sessions until one is added');
});

test('the harness is the one asked for, whichever it is', async (t) => {
  // The bot's harness is its own: the folder Bot Father runs on says nothing
  // about it.
  const box = await createSandbox(t);
  const bots = await seeded(box, 'codex');

  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'one', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'two', '--harness', 'codex'])).code, 0);

  assert.equal((await botYaml(bots, 'one')).harness, 'claude');
  assert.equal((await botYaml(bots, 'two')).harness, 'codex');
});

test('AGENTS.md holds the charter, and CLAUDE.md is a symlink to it', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const charter = 'Api Bot owns the API.';

  assert.equal((await box.run([
    'bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude', '--charter', charter,
  ])).code, 0);

  const home = botHomeOf(bots, 'api-bot');
  const agents = await readFile(path.join(home, 'AGENTS.md'), 'utf8');
  assert.ok(agents.includes(charter), `AGENTS.md should hold the charter, got: ${agents}`);

  const link = path.join(home, 'CLAUDE.md');
  assert.ok((await lstat(link)).isSymbolicLink(), 'CLAUDE.md is a symlink, not a copy to keep in step');
  assert.equal(
    await readlink(link),
    'AGENTS.md',
    'the link is relative: the bots folder is a git repo, and an absolute one breaks wherever it is cloned',
  );
  assert.equal(await realpath(link), path.join(home, 'AGENTS.md'));
  assert.equal(await readFile(link, 'utf8'), agents, 'reading CLAUDE.md is reading AGENTS.md');
});

test('a bot with no charter gets one naming the three things a charter says', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);

  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude'])).code, 0);

  const charter = (await botYaml(bots, 'api-bot')).charter;
  assert.equal(typeof charter, 'string');
  assert.notEqual(charter.trim(), '', 'a bot without a charter has no boundary to act inside');
  // PRD 6.6: what it owns, what good looks like, what it must ask about first.
  assert.match(charter, /owns/i, `the placeholder should name what the bot owns, got: ${charter}`);
  assert.match(charter, /good looks like/i, `it should name what good looks like, got: ${charter}`);
  assert.match(charter, /ask/i, `it should name what the bot must ask about first, got: ${charter}`);

  const agents = await readFile(path.join(botHomeOf(bots, 'api-bot'), 'AGENTS.md'), 'utf8');
  assert.ok(agents.includes(charter.trim()), `AGENTS.md should hold the same charter, got: ${agents}`);
});

test('.gitignore keeps the work dir out of the repo', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);

  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude'])).code, 0);

  const ignored = await readFile(path.join(botHomeOf(bots, 'api-bot'), '.gitignore'), 'utf8');
  assert.deepEqual(
    ignored.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#')),
    ['work/'],
    'work/ holds clones and scratch space; nothing else of the bot is kept out',
  );
});

test('bot create writes nothing outside the new bot\'s own folder', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const outside = await snapshot(box.root, (rel) => rel.startsWith('orca-fake') || rel.includes('/bots/api-bot'));

  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude'])).code, 0);

  assert.deepEqual(
    await snapshot(box.root, (rel) => rel.startsWith('orca-fake') || rel.includes('/bots/api-bot')),
    outside,
    'the only thing that changed anywhere is the bot\'s own folder',
  );
  await assertHomeUntouched(box);
});

test('an Orca that is down is nothing to bot create', async (t) => {
  // The proof that it needs no Orca at all: the one thing every other command
  // checks first is out, and this one still does its work.
  const box = await createSandbox(t);
  const bots = box.path('bots');
  await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  await box.orca.set({ reachable: false, setups: [], terminals: [] });

  const result = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude']);

  assert.equal(result.code, 0, `an Orca that is down is nothing to bot create: ${result.stderr}`);
  assert.equal((await botYaml(bots, 'api-bot')).name, 'api-bot');
});

for (const name of ['api-bot', 'bot', 'a', '2nd-bot', 'bot2', 'a-b-c']) {
  test(`${name} is a name a bot may have`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);

    const result = await box.run(['bot', 'create', '--bots', 'bots', '--name', name, '--harness', 'claude']);

    assert.equal(result.code, 0, result.stderr);
    assert.equal((await botYaml(bots, name)).name, name);
  });
}

for (const [label, name] of [
  ['an upper-case letter', 'Api-Bot'],
  ['an underscore', 'api_bot'],
  ['a space', 'api bot'],
  ['a leading hyphen', '-api'],
  ['a trailing dot', 'api.'],
  ['a slash', 'api/bot'],
  ['a walk up the tree', '..'],
  ['nothing at all', ''],
]) {
  test(`a name with ${label} is refused, by name, and nothing is written`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    const before = await snapshot(bots, skipGit);
    const calls = (await box.orca.calls()).length;

    // `--name=<value>` so a name starting with a hyphen reaches the CLI as a name.
    const result = await box.run(['bot', 'create', '--bots', 'bots', `--name=${name}`, '--harness', 'claude']);

    assertCleanFailure(result);
    if (name !== '') {
      assert.ok(result.stderr.includes(name), `the refusal should name ${name}, got: ${result.stderr}`);
    }
    assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
    assert.equal((await box.orca.calls()).length, calls, 'and asks Orca nothing');
  });
}

test('a bot that is already there is refused, and the one on disk is left alone', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  assert.equal((await box.run([
    'bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude', '--charter', 'Mine.',
  ])).code, 0);
  const before = await snapshot(bots, skipGit);

  const result = await box.run([
    'bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'codex', '--charter', 'Someone else\'s.',
  ]);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('api-bot'), `the refusal should name the bot, got: ${result.stderr}`);
  assert.deepEqual(await snapshot(bots, skipGit), before, 'nothing of the bot that is there may move');
  assert.equal((await botYaml(bots, 'api-bot')).charter.trim(), 'Mine.');
});

test('Bot Father is a bot like any other: creating it again is refused', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const before = await snapshot(bots, skipGit);

  const result = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'bot-father', '--harness', 'claude']);

  assertCleanFailure(result);
  assert.deepEqual(await snapshot(bots, skipGit), before);
});

test('a bots folder init never made sends the user to obk init', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  // The folder is there, but the part that makes it a bots folder is not.
  await rm(path.join(bots, 'bots'), { recursive: true });
  const before = await snapshot(bots, skipGit);

  const result = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude']);

  assertCleanFailure(result);
  assert.match(result.stderr, /obk init/, `should send the user to init, got: ${result.stderr}`);
  assert.deepEqual(await snapshot(bots, skipGit), before, 'and seed nothing on the way');
});

test('a folder that is not there at all sends the user to obk init', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude']);

  assertCleanFailure(result);
  assert.match(result.stderr, /obk init/, `should send the user to init, got: ${result.stderr}`);
  assert.deepEqual(await readdir(box.cwd), [], 'bot create seeds nothing, not even the folder');
});

test('bot create without --name fails and says so', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);

  const result = await box.run(['bot', 'create', '--bots', 'bots', '--harness', 'claude']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('--name'), `should name --name, got: ${result.stderr}`);
});

test('bot create without --bots fails and says so', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['bot', 'create', '--name', 'api-bot', '--harness', 'claude']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('--bots'), `should name --bots, got: ${result.stderr}`);
});

test('bot create without --harness fails: there is no silent default', async (t) => {
  // The same rule as `init`. A bot that quietly took the wrong harness would
  // only show it once a session came up on the wrong one.
  const box = await createSandbox(t);
  const bots = await seeded(box, 'codex');
  const before = await snapshot(bots, skipGit);

  const result = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('claude'), `should name the harnesses, got: ${result.stderr}`);
  assert.ok(result.stderr.includes('codex'), `should name the harnesses, got: ${result.stderr}`);
  assert.deepEqual(await snapshot(bots, skipGit), before);
});

test('a harness the kit does not know is refused and named', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const before = await snapshot(bots, skipGit);

  const result = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'gemini']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('gemini'), `should name what it got, got: ${result.stderr}`);
  assert.deepEqual(await snapshot(bots, skipGit), before);
});

test('bot create with an extra argument fails and names it', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);

  const result = await box.run(['bot', 'create', 'stray', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('stray'), `should name the argument, got: ${result.stderr}`);
});

test('bot create says what it wrote, and --json says the same', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);

  const plain = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude']);

  assert.equal(plain.code, 0, plain.stderr);
  for (const written of ['api-bot', 'bot.yaml', 'AGENTS.md', 'CLAUDE.md', '.gitignore']) {
    assert.ok(plain.stdout.includes(written), `the report should name ${written}, got: ${plain.stdout}`);
  }
  assert.ok(!plain.stdout.includes('undefined'), `nothing should be undefined, got: ${plain.stdout}`);

  const other = await createSandbox(t);
  assert.equal((await other.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const asJson = await other.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude', '--json']);

  assert.equal(asJson.code, 0, asJson.stderr);
  let answer;
  try {
    answer = JSON.parse(asJson.stdout);
  } catch (error) {
    assert.fail(`--json should print JSON and nothing else, got: ${asJson.stdout} (${error.message})`);
  }
  const facts = JSON.stringify(answer);
  for (const written of ['api-bot', 'bot.yaml', 'AGENTS.md', 'CLAUDE.md', '.gitignore']) {
    assert.ok(facts.includes(written), `the answer should carry ${written}, got: ${facts}`);
  }
});
