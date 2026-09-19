// What `init` tells the person who ran it. The files on disk are covered
// elsewhere; this is about the report: a run that makes something says what it
// made, a run that makes nothing says so, and the two cannot be confused.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSandbox } from './helpers/cli.js';

/** The lines naming what was created, and the closing summary, split apart. */
function report(stdout) {
  const lines = stdout.trimEnd().split('\n');
  return { listed: lines.slice(0, -1), summary: lines.at(-1) };
}

test('a first init lists every entry it created', async (t) => {
  const box = await createSandbox(t);

  const { listed } = report((await box.run(['init', '--bots', 'bots'])).stdout);

  const naming = (needle) => listed.filter((line) => line.includes(needle)).length;
  assert.equal(naming('defaults.yaml'), 1);
  assert.equal(naming('skills.yaml'), 1);
  assert.equal(naming('bot.yaml'), 1);
  assert.equal(naming('.gitkeep'), 2, 'both .gitkeep files');
  // `.git` on its own: `.gitkeep` contains it, so the repository needs its own line.
  assert.equal(listed.filter((line) => line.trimEnd().endsWith('.git')).length, 1);
  assert.equal(listed.length, 6, `six entries and nothing else, got: ${listed.join(' / ')}`);
});

test('a second init lists nothing and still names the folder', async (t) => {
  const box = await createSandbox(t);
  assert.equal((await box.run(['init', '--bots', 'bots'])).code, 0);

  const second = await box.run(['init', '--bots', 'bots']);

  assert.equal(second.code, 0);
  const { listed, summary } = report(second.stdout);
  assert.deepEqual(listed, [], 'a run that created nothing should list nothing');
  assert.ok(summary.includes(box.path('bots')), `should name the folder, got: ${summary}`);
});

test('the summary tells a run that created something from one that did not', async (t) => {
  const box = await createSandbox(t);

  const first = await box.run(['init', '--bots', 'bots']);
  const second = await box.run(['init', '--bots', 'bots']);

  assert.equal(first.code, 0);
  assert.equal(second.code, 0);
  assert.ok(report(first.stdout).summary.includes(box.path('bots')));
  assert.notEqual(report(first.stdout).summary, report(second.stdout).summary);
});
