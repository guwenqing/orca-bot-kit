// `obk session add` edits a file the user writes in too, and YAML lets them
// write the same list five ways. The edit goes through the YAML library, which
// keeps their keys, their values and their comments (PRD 6.3); what it does
// about layout — spacing an inline list, dropping the padding in front of a
// comment — is its own business, and no test here asks otherwise.
//
// What every one of these pins is that the file still means what it meant,
// plus the one session. The failure this file exists for is the quiet one: the
// command writes, says it worked and exits 0, and the bot is only found to be
// broken the next time something reads it — `obk up`, or the user, or Bot
// Father.
//
// So what was built is read back before it replaces anything: the document as
// it was, plus the one new session, or the command refuses and writes nothing.
// A bot the kit cannot add to safely is a bot the user can still edit by hand.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import {
  assertCleanFailure,
  assertKeptWhatTheyWrote,
  assertNoTrailingSpace,
  botHomeOf,
  createSandbox,
  skipGit,
  snapshot,
} from './helpers/cli.js';

/** Everything in a bot.yaml above its sessions. The styles below differ only below it. */
const HEAD = '# my own notes about this bot\nname: api-bot\nharness: codex\ncharter: mine\nrules: []\nskills: []\n';

const botFile = (bots) => path.join(botHomeOf(bots, 'api-bot'), 'bot.yaml');

/** A bots folder with one bot whose bot.yaml is `text`, byte for byte. */
async function withBotYaml(box, text) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'codex']);
  assert.equal(made.code, 0, made.stderr);
  const bots = box.path('bots');
  await writeFile(botFile(bots), text);
  return bots;
}

/** Add one session to api-bot. */
const add = (box, name, settings = []) =>
  box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', name, ...settings]);

/** The bot.yaml as it now reads, and a clear failure when it no longer parses. */
async function parsed(bots) {
  const text = await readFile(botFile(bots), 'utf8');
  try {
    return { text, doc: parse(text) };
  } catch (error) {
    return assert.fail(`bot.yaml no longer parses as YAML (${error.message}):\n${text}`);
  }
}

/** The ways a user writes a sessions list. */
const STYLES = [
  [
    'a flow list, all on one line',
    'sessions: [{ name: first, approval: ask }, { name: second, approval: ask }]\n',
  ],
  [
    'a block list indented four spaces',
    'sessions:\n    - name: first\n      approval: ask\n    - name: second\n      approval: ask\n',
  ],
  [
    'an indentless block list, at the key\'s own column',
    'sessions:\n- name: first\n  approval: ask\n- name: second\n  approval: ask\n',
  ],
  [
    'a list with a comment of the user\'s under it',
    'sessions:\n  - name: first\n    approval: ask\n  - name: second\n    approval: ask\n'
    + '# add the rest once this bot has a charter\n',
  ],
  ['an empty flow list', 'sessions: []\n'],
  ['a sessions key with nothing under it', 'sessions:\n'],
  ['no sessions key at all', ''],
];

for (const [label, tail] of STYLES) {
  test(`a session added to ${label} leaves a file that still parses`, async (t) => {
    const box = await createSandbox(t);
    const mine = HEAD + tail;
    const bots = await withBotYaml(box, mine);
    const were = parse(mine).sessions ?? [];

    const result = await add(box, 'daily', ['--model', 'gpt-5.4']);

    assert.equal(result.code, 0, result.stderr);
    const { text, doc } = await parsed(bots);
    assert.deepEqual(
      doc.sessions,
      [...were, { name: 'daily', approval: 'auto', model: 'gpt-5.4' }],
      `every session that was there should be untouched, with the new one after them:\n${text}`,
    );
    // The rest of the document is the user's and has nothing to do with this.
    assert.equal(doc.name, 'api-bot');
    assert.equal(doc.harness, 'codex');
    assert.equal(doc.charter, 'mine');
    assertNoTrailingSpace(text);
    assertKeptWhatTheyWrote(mine, text, { changed: ['sessions'] });
  });

  test(`${label} takes a second session too, in the style the file kept`, async (t) => {
    // The first add writes an item of its own, and the second has to read that
    // one and match it. A style the kit can write but not write into again
    // breaks on the second session rather than the first.
    const box = await createSandbox(t);
    const mine = HEAD + tail;
    const bots = await withBotYaml(box, mine);
    const were = parse(mine).sessions ?? [];

    assert.equal((await add(box, 'daily')).code, 0);
    const second = await add(box, 'review', ['--approval', 'ask']);

    assert.equal(second.code, 0, second.stderr);
    const { text, doc } = await parsed(bots);
    assert.deepEqual(
      doc.sessions,
      [...were, { name: 'daily', approval: 'auto' }, { name: 'review', approval: 'ask' }],
      `both new sessions should be there, after the user's own:\n${text}`,
    );
    assertNoTrailingSpace(text);
  });
}

test('a bot.yaml the kit cannot add to safely is refused, and left exactly as it was', async (t) => {
  // An alias: the sessions are defined once, under a key of the user's own,
  // and `sessions` points at them. There is no place in that file to put a new
  // item that means what the user asked for — writing one where the alias
  // stands would drop the sessions it stands for. The bot is not broken, so
  // the answer is to say so and leave the file to its owner.
  const box = await createSandbox(t);
  const mine = HEAD
    + 'shared: &shared\n  - name: first\n    approval: auto\nsessions: *shared\n';
  const bots = await withBotYaml(box, mine);
  const before = await snapshot(bots, skipGit);

  const result = await add(box, 'daily');

  assertCleanFailure(result);
  assert.ok(
    result.stderr.includes(botFile(bots)),
    `the refusal should name the file the user has to open, got: ${result.stderr}`,
  );
  assert.ok(result.stderr.includes('daily'), `and the session it could not add, got: ${result.stderr}`);
  assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing at all');
  assert.equal((await parsed(bots)).text, mine, 'and the file is the user\'s, byte for byte');
});

test('the sessions that were there are still readable after an add', async (t) => {
  // The end of it: `obk up` is what reads this file next, and a file it cannot
  // read is a fleet that will not come up. The styles above go in, the kit
  // adds to them, and the run that follows finds every session.
  const box = await createSandbox(t);
  const bots = await withBotYaml(
    box,
    `${HEAD}sessions:\n- name: first\n  approval: auto\n`,
  );

  assert.equal((await add(box, 'daily')).code, 0);
  const result = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(result.code, 0, result.stderr);
  const titles = (await box.orca.terminals())
    .filter((terminal) => terminal.worktreePath === botHomeOf(bots, 'api-bot'))
    .map((terminal) => terminal.title)
    .sort();
  assert.deepEqual(titles, ['Api Bot daily', 'Api Bot first']);
});
