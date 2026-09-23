// `obk bot change --bots <path> --bot <bot> --charter <text>`: a new charter for
// a bot that already exists, without anyone opening its `bot.yaml` (PRD 3.2).
//
// The charter is the one thing about a bot this command changes. The rest of
// `bot.yaml` is the user's — their comments, their keys, the sessions — and it
// comes back as they wrote it. Then the bot's `AGENTS.md` is built again, the
// way `bot create` and `rules build` build it, so the bot reads the charter it
// now has rather than the one it had.
//
// A bot's harness is not something this command changes: the sessions, the
// book and the conversations are all tied to it. Retiring the bot and making
// another, or adding a session with its own harness, is the road for that.
//
// It writes files and nothing else: no Orca, no commit.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
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
import { agentsIn } from './helpers/rules.js';
import { botYamlOf } from './helpers/skills.js';

const BOT = 'api-bot';
const OLD = 'Api Bot owns the API. Good is a green build. Ask before a release.';
const NEW = 'Api Bot owns the API and its docs. Good is a page nobody has to ask about. Ask before deleting one.';

/** A bots folder `init` made, with one bot of its own carrying the old charter and one session. */
async function withBot(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude', '--charter', OLD]);
  assert.equal(made.code, 0, made.stderr);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily', '--model', 'sonnet']);
  assert.equal(added.code, 0, added.stderr);
  return box.path('bots');
}

const change = (box, ...rest) => box.run(['bot', 'change', '--bots', 'bots', ...rest]);

const botText = (bots) => readFile(botYamlOf(bots, BOT), 'utf8');

test('BC1 the charter in bot.yaml is replaced, and nothing else in the file moves', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const before = await botText(bots);
  const calls = (await box.orca.calls()).length;

  const result = await change(box, '--bot', BOT, '--charter', NEW);

  assert.equal(result.code, 0, result.stderr);
  const after = await botText(bots);
  assert.equal(parse(after).charter.trim(), NEW);
  assertKeptWhatTheyWrote(before, after, { changed: ['charter'] });
  assert.deepEqual(parse(after).sessions, [{ name: 'daily', approval: 'auto', model: 'sonnet' }], 'the sessions are untouched');
  assert.equal((await box.orca.calls()).length, calls, 'and Orca is asked nothing');
});

test('BC1 the bot\'s AGENTS.md is built again and carries the new charter, not the old one', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  assert.ok((await agentsIn(bots, BOT)).includes(OLD), 'bot create wrote the old charter into AGENTS.md, or this proves nothing');

  const result = await change(box, '--bot', BOT, '--charter', NEW);

  assert.equal(result.code, 0, result.stderr);
  const agents = await agentsIn(bots, BOT);
  assert.ok(agents.includes(NEW), `AGENTS.md should carry the new charter, got:\n${agents}`);
  assert.ok(!agents.includes(OLD), `and no longer the old one, got:\n${agents}`);
});

test('BC1 the user\'s own comments and keys in bot.yaml survive a new charter', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const mine = `# my own notes about this bot
name: api-bot
harness: claude
charter: |
  ${OLD}
notes: keep me            # a key the kit knows nothing about
rules: []
skills:
  - house-style           # the one I wrote myself
sessions:
  - name: mine            # my session
    approval: ask
`;
  await writeFile(botYamlOf(bots, BOT), mine);

  const result = await change(box, '--bot', BOT, '--charter', NEW);

  assert.equal(result.code, 0, result.stderr);
  const after = await botText(bots);
  assertKeptWhatTheyWrote(mine, after, { changed: ['charter'] });
  assertNoTrailingSpace(after);
  assert.equal(parse(after).charter.trim(), NEW);
  assert.ok(after.includes('# a key the kit knows nothing about'), `the user's comment should have survived:\n${after}`);
});

for (const [label, args, named] of [
  ['a bot that is not there', ['--bot', 'ghost-bot', '--charter', NEW], 'ghost-bot'],
  ['an empty charter', ['--bot', BOT, '--charter='], '--charter'],
  ['a charter of nothing but spaces', ['--bot', BOT, '--charter', '   \n  '], '--charter'],
  ['nothing to change at all', ['--bot', BOT], '--charter'],
]) {
  test(`BC2 ${label} is refused, and nothing is written`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    const before = await snapshot(bots, skipGit);
    const calls = (await box.orca.calls()).length;

    const result = await change(box, ...args);

    assertCleanFailure(result);
    assert.ok(result.stderr.includes(named), `the refusal should name ${named}, got: ${result.stderr}`);
    assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing, AGENTS.md included');
    assert.equal((await box.orca.calls()).length, calls);
  });
}

test('BC3 --harness is refused with the road that does change a harness, and nothing is written', async (t) => {
  // The charter beside it is valid: the refusal is about the harness alone, so
  // a run that wrote the charter and ignored the flag would be caught here.
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const before = await snapshot(bots, skipGit);

  const result = await change(box, '--bot', BOT, '--charter', NEW, '--harness', 'codex');

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('harness'), `the refusal should be about the harness, got: ${result.stderr}`);
  assert.ok(result.stderr.includes('retire'), `and point at retiring the bot as the way to another harness, got: ${result.stderr}`);
  assert.deepEqual(await snapshot(bots, skipGit), before);
  assert.equal(parse(await botText(bots)).harness, 'claude');
});

test('BC4 it says what it changed, and --json answers as JSON and nothing else', async (t) => {
  const box = await createSandbox(t);
  await withBot(box);

  const plain = await change(box, '--bot', BOT, '--charter', NEW);

  assert.equal(plain.code, 0, plain.stderr);
  assert.ok(plain.stdout.includes(BOT), `the report should name the bot, got: ${plain.stdout}`);
  assert.ok(!plain.stdout.includes('undefined'), `nothing should be undefined, got: ${plain.stdout}`);

  const asJson = await change(box, '--bot', BOT, '--charter', OLD, '--json');

  assert.equal(asJson.code, 0, asJson.stderr);
  assert.equal(asJson.stderr, '');
  let answer;
  try {
    answer = JSON.parse(asJson.stdout);
  } catch (error) {
    assert.fail(`--json should print JSON and nothing else, got: ${asJson.stdout} (${error.message})`);
  }
  assert.equal(answer.bot, BOT);
});
