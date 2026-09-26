// Every bot commits its own changes to the bots repo often, staging by name only
// what it changed (issue #235, the owner's decision of 2026-09-24; PRD 6.10).
// It is a rule every bot carries: the kit's unit `commit`, `applies: all`, which
// a new bot's AGENTS.md holds without anyone listing it anywhere.
//
// The other half of the boundary is what stays as it was: the CLI still never
// commits by itself. The bots commit; no `obk` command makes a commit in the
// bots repo. `init` is pinned for that in init.test.js; the rest is pinned here.
//
// What the unit says is the implementer's to word and the reviewer's to read;
// nothing here pins a sentence of it.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import { createSandbox, git } from './helpers/cli.js';
import { agentsIn, answerOf, blockIn, entryOf, headingsIn, kitUnit, underIn } from './helpers/rules.js';
import { botYamlOf } from './helpers/skills.js';
import { commitIn, gitOk } from './helpers/sources.js';

/** The name the requirement gives the unit; a user writes it `kit:commit`. */
const COMMIT = 'commit';

/** The `rules:` list a `defaults.yaml` or a `bot.yaml` names, as written. */
const rulesListed = async (file) => (parse(await readFile(file, 'utf8')) ?? {}).rules ?? [];

/**
 * Nothing in the folder names the unit, so a bot that carries it carries it
 * unasked. Checked rather than assumed: a unit listed in `defaults.yaml` would
 * also reach a new bot, and would not reach a folder made before it was listed.
 */
async function assertNobodyAskedFor(bots, bot) {
  for (const file of [path.join(bots, 'defaults.yaml'), botYamlOf(bots, bot)]) {
    const listed = await rulesListed(file);
    assert.ok(
      !listed.some((name) => String(name).replace(/^kit:/, '') === COMMIT),
      `${file} should not list the commit rule for this test to mean anything, got: ${JSON.stringify(listed)}`,
    );
  }
}

for (const harness of ['claude', 'codex']) {
  test(`a new ${harness} bot's AGENTS.md carries the commit rule without anyone asking (#235)`, async (t) => {
    const box = await createSandbox(t);
    const bots = box.path('bots');
    const init = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
    assert.equal(init.code, 0, init.stderr);
    const unit = await kitUnit(COMMIT);

    const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', harness]);

    assert.equal(made.code, 0, made.stderr);
    await assertNobodyAskedFor(bots, 'api-bot');
    const body = blockIn(await agentsIn(bots, 'api-bot')).body;
    assert.ok(
      headingsIn(body).includes(unit.title),
      `the bot's AGENTS.md should carry the commit rule under "${unit.title}", got headings: ${headingsIn(body)}`,
    );
    assert.equal(underIn(body, unit.title), unit.body, 'the unit the kit ships, written out whole');
  });
}

test('Bot Father carries the commit rule from init, without anyone asking (#235)', async (t) => {
  // Bot Father commits what no bot owns, so it carries the rule like any bot.
  const box = await createSandbox(t);
  const bots = box.path('bots');
  const unit = await kitUnit(COMMIT);

  const init = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assert.equal(init.code, 0, init.stderr);
  await assertNobodyAskedFor(bots, 'bot-father');
  const body = blockIn(await agentsIn(bots, 'bot-father')).body;
  assert.equal(
    underIn(body, unit.title),
    unit.body,
    `Bot Father's AGENTS.md should carry the commit rule, got headings: ${headingsIn(body)}`,
  );
});

test('rules build names the commit rule among what every bot carries (#235)', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'codex']);
  assert.equal(made.code, 0, made.stderr);

  const result = await box.run(['rules', 'build', '--bots', 'bots', '--json']);

  assert.equal(result.code, 0, result.stderr);
  const answer = answerOf(result);
  for (const bot of ['api-bot', 'bot-father']) {
    await assertNobodyAskedFor(bots, bot);
    const { units } = entryOf(answer, bot);
    assert.ok(
      units.includes(COMMIT),
      `${bot} should carry ${COMMIT}, and the build says it carries: ${JSON.stringify(units)}`,
    );
  }
});

/**
 * Every commit the repository knows of, the ones only a reflog still remembers
 * included, so a command that committed and then moved HEAD back is seen too.
 */
const commitsIn = async (bots) => (await gitOk(['rev-list', '--all', '--reflog'], bots)).split('\n').filter(Boolean);

test('no obk command makes a commit in the bots repo: the bots commit, the CLI does not (#235)', async (t) => {
  // Current behaviour to protect, run against the code as it stands. The
  // folder starts with one commit of the user's, as a bots folder whose bots
  // commit often will, and every command that writes into it runs in turn.
  // After each one the repository knows that one commit and no other, and
  // what the command wrote is still waiting to be committed.
  const box = await createSandbox(t);
  const bots = box.path('bots');
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const theirs = await commitIn(bots, 'the user\'s own commit');

  const commands = [
    ['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude', '--charter', 'Api Bot owns the API.'],
    ['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily'],
    ['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'nightly'],
    ['session', 'change', '--bots', 'bots', '--bot', 'api-bot', '--session', 'daily', '--model', 'opus'],
    ['bot', 'change', '--bots', 'bots', '--bot', 'api-bot', '--charter', 'Api Bot owns the API and its docs.'],
    ['rules', 'build', '--bots', 'bots'],
    ['skills', 'add', '--bots', 'bots', '--bot', 'api-bot', '--skill', 'kit:obk-tdd'],
    ['skills', 'build', '--bots', 'bots'],
    ['skills', 'remove', '--bots', 'bots', '--bot', 'api-bot', '--skill', 'kit:obk-tdd'],
    ['source', 'add', '--bots', 'bots', '--name', 'shelf', '--repo', 'https://example.invalid/shelf.git', '--ref', 'main'],
    ['pause', '--bots', 'bots', '--bot', 'api-bot', '--session', 'nightly'],
    ['unpause', '--bots', 'bots', '--bot', 'api-bot', '--session', 'nightly'],
    ['retire', '--bots', 'bots', '--bot', 'api-bot', '--session', 'nightly'],
    ['groom', '--bots', 'bots', '--at', '06:30'],
    ['up', '--bots', 'bots'],
  ];

  for (const args of commands) {
    const said = `obk ${args.slice(0, args.indexOf('--bots')).join(' ')}`;
    const result = await box.run(args);
    assert.equal(result.code, 0, `${said} should work, for this test to say anything about it: ${result.stderr}`);

    assert.deepEqual(await commitsIn(bots), [theirs], `${said} should make no commit in the bots repo`);
  }

  const waiting = await git(['status', '--porcelain', '--untracked-files=all'], bots);
  assert.equal(waiting.code, 0, waiting.stderr);
  assert.ok(
    waiting.stdout.includes('bots/api-bot/'),
    `what the commands wrote should be left for a bot to commit, and git says:\n${waiting.stdout}`,
  );
});
