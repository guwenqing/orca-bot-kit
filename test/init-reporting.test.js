// What `init` tells the person who ran it. The files on disk are covered
// elsewhere; this is about the report: a run that makes something says what it
// made, a run that makes nothing says so, and the two cannot be confused.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { createSandbox } from './helpers/cli.js';

/** The lines naming what was created, and the closing summary. */
function report(stdout) {
  const lines = stdout.trimEnd().split('\n');
  return { created: lines.filter((line) => line.startsWith('created')), summary: lines.at(-1) };
}

/** What each `created` line names, without the word. */
const entriesOf = (created) => created.map((line) => line.replace(/^created\s+/, ''));

/**
 * Everything a first `init` seeds, sorted the way the report is compared.
 *
 * The `.gitignore` is the one the kit keeps its own skill links out of git with
 * (issue #136): the links inside a bot are made again on whatever machine the
 * repo is checked out on, so the repo does not carry them. It is seeded like
 * every other file here and is the user's from then on, which is why it is
 * reported as created like the rest.
 *
 * Bot Father's own `.gitignore` keeps its `work/` out of the repo, the same
 * file `bot create` writes for every other bot (issue #172).
 */
const SEEDED = [
  '.git',
  '.gitignore',
  'bots/bot-father/.gitignore',
  'bots/bot-father/bot.yaml',
  'defaults.yaml',
  'rules/.gitkeep',
  'skills.yaml',
  'skills/.gitkeep',
].sort();

/** The book is written by the Orca half of the run; whether it is reported is that half's business. */
const BOOK = 'bots/bot-father/sessions.yaml';

test('a first init lists every entry it created, once each', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');

  const { created } = report((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).stdout);

  // Whatever else the run reports about Orca, the entries it names inside the
  // bots folder are exactly the ones it seeded — no entry missing, none twice.
  const named = entriesOf(created)
    .filter((entry) => entry !== BOOK)
    .filter((entry) => existsSync(path.join(bots, entry)));
  assert.deepEqual(named.sort(), SEEDED);
});

test('a second init lists nothing and still names the folder', async (t) => {
  const box = await createSandbox(t);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);

  const second = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assert.equal(second.code, 0);
  const { created, summary } = report(second.stdout);
  assert.deepEqual(created, [], 'a run that created nothing should list nothing');
  assert.ok(summary.includes(box.path('bots')), `should name the folder, got: ${summary}`);
});

test('a run that made something cannot be read as one that did not', async (t) => {
  const box = await createSandbox(t);

  const first = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  const second = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assert.equal(first.code, 0, first.stderr);
  assert.equal(second.code, 0, second.stderr);
  assert.notEqual(first.stdout, second.stdout, 'the two runs did different things and must not read alike');
  assert.notDeepEqual(report(first.stdout).created, [], 'the first run made the folder');
  assert.deepEqual(report(second.stdout).created, [], 'the second made nothing');
  assert.ok(report(first.stdout).summary.includes(box.path('bots')));
});
