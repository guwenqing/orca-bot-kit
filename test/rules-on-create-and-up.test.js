// The two commands that build a bot's `AGENTS.md` without being asked:
// `bot create`, which writes a built file rather than the charter alone, and
// `up`, which rebuilds every bot it is bringing up before it opens a tab.
//
// The order is the point of the `up` half. A session reads `AGENTS.md` once, as
// it starts, so a rebuild that lands after the tab is open reaches nobody until
// the next restart — and the acceptance for this slice is that a session
// started by `up` comes up with the current rules. The proof is taken from
// inside the run: the fake Orca copies a bot's file aside in the middle of the
// first `terminal create`, and the copy shows what the file held at the moment
// the first tab was opened.
//
// `up`'s own job is unchanged by any of it: a bot whose build is in trouble is
// reported, and the run carries on with its usual exit code.

import assert from 'node:assert/strict';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  botHomeOf,
  createSandbox,
  orcaCallsOf,
  skipGit,
  snapshot,
  tabsOfBot,
} from './helpers/cli.js';
import {
  addRules,
  agentsIn,
  agentsOf,
  answerOf,
  blockIn,
  defaultUnits,
  END_MARKER,
  entryOf,
  hasBlock,
  headingsIn,
  plainEntry,
  titleIn,
  underIn,
  unitText,
  writeUnit,
} from './helpers/rules.js';

/** A bots folder `init` made, with Bot Father in it. */
async function seeded(box) {
  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(result.code, 0, result.stderr);
  return box.path('bots');
}

/** A bot with one session, so `up` has a tab to open for it. */
async function makeBot(box, name, charter = `${name} owns its own corner.`) {
  const made = await box.run([
    'bot', 'create', '--bots', 'bots', '--name', name, '--harness', 'claude', '--charter', charter,
  ]);
  assert.equal(made.code, 0, made.stderr);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', name, '--name', 'daily']);
  assert.equal(added.code, 0, added.stderr);
}

/** A rule change every bot in the folder feels. */
async function changeARule(box, bots, body = 'Say it in one line.') {
  await writeUnit(bots, 'house', unitText('The house style', body));
  await addRules(path.join(bots, 'defaults.yaml'), 'house');
}

/** The titles every bot carries without anyone asking. */
const defaultTitles = async () => (await defaultUnits()).map((unit) => unit.title);

/**
 * A program the fake Orca runs in the middle of a call: it copies the file
 * `OBK_TEST_WATCH` names to `OBK_TEST_WITNESS`, so a test can read what that
 * file held at that moment rather than at the end of the run.
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

test('bot create writes a built AGENTS.md, and CLAUDE.md reads as it', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);

  const result = await box.run([
    'bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'codex',
    '--charter', 'Api Bot owns the API.',
  ]);

  assert.equal(result.code, 0, result.stderr);
  const built = await agentsIn(bots, 'api-bot');
  const block = blockIn(built);
  assert.equal(titleIn(block.body), 'Api Bot');
  assert.equal(underIn(block.body, 'Charter'), 'Api Bot owns the API.');
  assert.deepEqual(
    headingsIn(block.body),
    ['Charter', ...await defaultTitles()],
    'a new bot starts with the kit\'s rules, not with its charter alone',
  );
  assert.equal(
    await readFile(path.join(botHomeOf(bots, 'api-bot'), 'CLAUDE.md'), 'utf8'),
    built,
    'the Claude session reads the same built file the Codex one does',
  );
});

test('the file bot create wrote is the file the builder would write', async (t) => {
  // Two ways of writing the same file is a drift waiting to happen: if they
  // ever part, the first `rules build` after a create rewrites a file nobody
  // touched.
  const box = await createSandbox(t);
  await seeded(box);
  await makeBot(box, 'api-bot');

  const result = await box.run(['rules', 'build', '--bots', 'bots', '--json']);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(entryOf(answerOf(result), 'api-bot').state, 'unchanged');
  assert.equal(entryOf(answerOf(result), 'bot-father').state, 'unchanged', 'init seeds a built file too');
});

test('up rebuilds every bot before it opens the first tab', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'zebra-bot');
  await changeARule(box, bots);
  // Orca forgot everything, so the run opens tabs for both bots, in name
  // order: the first `terminal create` is Bot Father's, and the bot whose file
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
      ...await witness(box, agentsOf(bots, 'zebra-bot'), kept),
    },
  });

  const result = await box.run(['up', '--bots', 'bots']);

  assert.equal(result.code, 0, result.stderr);
  const ran = await box.orca.ranDuring();
  assert.equal(ran.length, 1, `the witness should have run once during the run, got: ${JSON.stringify(ran)}`);
  assert.equal(ran[0].status, 0, `the witness should have found the file to copy: ${ran[0].stderr}`);
  assert.ok(
    headingsIn(blockIn(await readFile(kept, 'utf8')).body).includes('The house style'),
    'every bot\'s rules are built before any session is started on them',
  );
});

test('up carries the rules entries beside the tabs, plain and as JSON', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  await changeARule(box, bots);

  const plain = await box.run(['up', '--bots', 'bots']);

  assert.equal(plain.code, 0, plain.stderr);
  for (const bot of ['api-bot', 'bot-father']) {
    assert.ok(plainEntry(plain.stdout, bot).includes('AGENTS.md'), `up should report the build of ${bot}, got:\n${plain.stdout}`);
  }

  const other = await createSandbox(t);
  const theirs = await seeded(other);
  await makeBot(other, 'api-bot');
  await changeARule(other, theirs);
  const asJson = await other.run(['up', '--bots', 'bots', '--json']);

  assert.equal(asJson.code, 0, asJson.stderr);
  const answer = answerOf(asJson);
  assert.ok(Array.isArray(answer.tabs), `up --json still answers about its tabs, got: ${asJson.stdout}`);
  for (const bot of ['api-bot', 'bot-father']) {
    assert.equal(entryOf(answer, bot).state, 'built');
  }
});

test('one bot\'s conflict does not stop up, and does not change what it ends in', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  const file = agentsOf(bots, 'api-bot');
  const edited = (await readFile(file, 'utf8')).replace(END_MARKER, `A line I typed in myself.\n\n${END_MARKER}`);
  assert.ok(blockIn(edited).body.includes('A line I typed in myself.'), 'the test should have edited inside the block');
  await writeFile(file, edited);
  await changeARule(box, bots);
  const before = await snapshot(bots, skipGit);

  const result = await box.run(['up', '--bots', 'bots', '--json']);

  assert.equal(result.code, 0, `a bot whose build is in trouble does not change what up ends in: ${result.stderr}`);
  const answer = answerOf(result);
  assert.equal(entryOf(answer, 'api-bot').state, 'conflict');
  assert.notEqual(entryOf(answer, 'api-bot').trouble?.trim(), '', 'and it says what to do about it');
  assert.equal(entryOf(answer, 'bot-father').state, 'built', 'the bots beside it are built as usual');
  assert.equal(
    (await snapshot(bots, skipGit))[path.relative(bots, file)],
    before[path.relative(bots, file)],
    'the hand-edited file is left exactly as its user left it',
  );

  assert.deepEqual(
    (await tabsOfBot(box, bots, 'api-bot')).map((tab) => tab.title),
    ['Api Bot daily'],
    'the bot still comes up: a file the user edited is not a reason to leave a session down',
  );
  assert.ok(hasBlock(await agentsIn(bots, 'bot-father')), 'and the rest of the fleet is built and up');
});
