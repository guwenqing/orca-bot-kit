import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createSandbox, skipGit, snapshot } from './helpers/cli.js';

test('a second init changes nothing and adds nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');

  assert.equal((await box.run(['init', '--bots', 'bots'])).code, 0);
  const before = await snapshot(bots, skipGit);

  const second = await box.run(['init', '--bots', 'bots']);

  assert.equal(second.code, 0);
  assert.deepEqual(await snapshot(bots, skipGit), before);
});

test('a second init leaves the existing git repo alone', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');

  assert.equal((await box.run(['init', '--bots', 'bots'])).code, 0);

  const sentinel = path.join(bots, '.git', 'sentinel.txt');
  await writeFile(sentinel, 'placed by the user\n');
  const configMtime = (await stat(path.join(bots, '.git', 'config'))).mtimeMs;

  assert.equal((await box.run(['init', '--bots', 'bots'])).code, 0);

  assert.equal(await readFile(sentinel, 'utf8'), 'placed by the user\n');
  assert.equal(
    (await stat(path.join(bots, '.git', 'config'))).mtimeMs,
    configMtime,
    'git should not have been re-initialised',
  );
});

test("a second init keeps the user's edits", async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');

  assert.equal((await box.run(['init', '--bots', 'bots'])).code, 0);

  const edits = {
    'defaults.yaml': 'rules:\n  - my-rule\nskills:\n  - my-skill\n',
    'skills.yaml': 'sources:\n  - https://example.invalid/skills.git\n',
    'bots/bot-father/bot.yaml':
      'name: bot-father\ncharter: my own charter\nrules: [my-rule]\nskills: []\nsessions: []\n',
  };
  for (const [rel, contents] of Object.entries(edits)) {
    await writeFile(path.join(bots, rel), contents);
  }

  const second = await box.run(['init', '--bots', 'bots']);

  assert.equal(second.code, 0);
  for (const [rel, contents] of Object.entries(edits)) {
    assert.equal(await readFile(path.join(bots, rel), 'utf8'), contents, `${rel} was rewritten`);
  }
});
