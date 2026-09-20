// A session's work dir (PRD 6.4). It is an instruction, not a place the
// session runs: every session starts at the bot home, and the work dir is a
// plain folder the kit makes for it and then tells it about.
//
// Making it is the kit's job because the session must not have to: a harness
// that finds no folder where its prompt says one is either makes one wherever
// it happens to be standing or stops to ask.

import assert from 'node:assert/strict';
import { readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  assertCleanFailure,
  botHomeOf,
  createSandbox,
  tabsOfBot,
} from './helpers/cli.js';

/** A bots folder holding one Codex bot with one session, not yet brought up. */
async function withSession(box, settings) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'codex'])).code, 0);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily', ...settings]);
  assert.equal(added.code, 0, added.stderr);
  return box.path('bots');
}

/** Whether there is a directory at `target`. */
async function isDirectory(target) {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

test('a work dir written relative to the bot home is made under it', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSession(box, ['--work-dir', 'work/api']);

  const result = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(result.code, 0, result.stderr);
  assert.ok(
    await isDirectory(path.join(botHomeOf(bots, 'api-bot'), 'work', 'api')),
    'the work dir should be there for the session to walk into',
  );
});

test('the parents of a work dir are made with it', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSession(box, ['--work-dir', 'work/clones/api/deep']);

  assert.equal((await box.run(['up', '--bots', 'bots', '--bot', 'api-bot'])).code, 0);

  assert.ok(await isDirectory(path.join(botHomeOf(bots, 'api-bot'), 'work', 'clones', 'api', 'deep')));
});

test('an absolute work dir is made where it says, parents and all', async (t) => {
  const box = await createSandbox(t);
  const elsewhere = path.join(box.root, 'clones', 'api');
  await withSession(box, ['--work-dir', elsewhere]);

  assert.equal((await box.run(['up', '--bots', 'bots', '--bot', 'api-bot'])).code, 0);

  assert.ok(await isDirectory(elsewhere), `${elsewhere} should have been made`);
});

test('the work dir is there before the session is started in the tab', async (t) => {
  // Orca refuses the line the kit types in, so the run dies at the moment the
  // session would have started. The folder has to be there already.
  const box = await createSandbox(t);
  const bots = await withSession(box, ['--work-dir', 'work/api']);
  await box.orca.set({ fail: { 'terminal send': { code: 'runtime_error', message: 'the tab would not take it' } } });

  const result = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  assertCleanFailure(result);
  assert.ok(
    await isDirectory(path.join(botHomeOf(bots, 'api-bot'), 'work', 'api')),
    'the work dir is made before the session is told anything, not after',
  );
});

test('a session with no work dir has none made for it', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSession(box, []);

  assert.equal((await box.run(['up', '--bots', 'bots', '--bot', 'api-bot'])).code, 0);

  assert.deepEqual(
    (await readdir(botHomeOf(bots, 'api-bot'))).sort(),
    ['.gitignore', 'AGENTS.md', 'CLAUDE.md', 'bot.yaml', 'sessions.yaml'],
    'nothing is made that the session did not ask for',
  );
});

test('the session still starts at the bot home, not in its work dir', async (t) => {
  // PRD 6.4: every session starts at the bot home, and nothing changes the
  // tab's directory. The work dir reaches the session as words.
  const box = await createSandbox(t);
  const bots = await withSession(box, ['--work-dir', 'work/api']);

  assert.equal((await box.run(['up', '--bots', 'bots', '--bot', 'api-bot'])).code, 0);

  const tabs = await tabsOfBot(box, bots, 'api-bot');
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].worktreePath, botHomeOf(bots, 'api-bot'));
});

test('a work dir that is already there is left as it is', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSession(box, ['--work-dir', 'work/api']);
  assert.equal((await box.run(['up', '--bots', 'bots', '--bot', 'api-bot'])).code, 0);
  const work = path.join(botHomeOf(bots, 'api-bot'), 'work', 'api');
  await writeFile(path.join(work, 'clone.txt'), 'the session put this here\n');

  // The tab is gone, so the session is started again — into the same folder.
  const tabs = await tabsOfBot(box, bots, 'api-bot');
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.tabId !== tabs[0].tabId) });
  assert.equal((await box.run(['up', '--bots', 'bots', '--bot', 'api-bot'])).code, 0);

  assert.deepEqual(await readdir(work), ['clone.txt'], 'the session\'s own work must survive a restart');
});
