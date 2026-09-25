// How the kit knows its own tabs.
//
// A session is its Orca tab id, recorded in the book. A title is cosmetic: the
// kit always writes it — at creation and again on every `up`, with
// `terminal rename` — and never reads it. With Orca's dynamic tab title option
// on, the title it reports drifts as soon as an agent runs in the tab: one
// whose `customTitle` is `Kit Arch` lists as `✳ Chatgpt-bot-kit orca
// migration`. A kit that recognised its sessions by title would lose them the
// moment they started working, so the tab id is the key either way.
//
// A session is recognised by the id the kit wrote down, never by a title. The
// ops tab is recognised not at all: the kit keeps nothing about it and only
// makes sure some tab exists outside the book (amendment 4), so what is asserted
// about it here is what is left over, never what it is called.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  assertOrcaCallsAllowed,
  bareLaunch,
  bookOf,
  botFatherTabs,
  createSandbox,
  orcaCallsOf,
  orcaCommand,
  orcaFlag,
  orcaFlags,
  skipGit,
  snapshot,
  TAB_TITLES,
  tokenless,
  typedInto,
} from './helpers/cli.js';

const botHomeIn = (box) => box.path('bots', 'bots', 'bot-father');

/** A bots folder with Bot Father in Orca, and the two tabs it got. */
async function seeded(box, harness = 'claude') {
  const result = await box.run(['init', '--bots', 'bots', '--harness', harness]);
  assert.equal(result.code, 0, result.stderr);
  const tabs = await botFatherTabs(box, box.path('bots'));
  assert.equal(tabs.terminals.length, 2, 'init should have opened two tabs');
  assert.equal(tabs.inBook.length, 1, `the daily session should be in the book, got: ${tabs.book}`);
  assert.equal(tabs.leftovers.length, 1, 'and the ops tab should be the one tab outside it');
  return { daily: tabs.inBook[0], ops: tabs.leftovers[0], book: tabs.book };
}

test('the kit records the ids Orca gave it, and keys on them', async (t) => {
  const box = await createSandbox(t);
  const { daily, book } = await seeded(box);

  assert.ok(book.includes(daily.tabId), `the daily tab id ${daily.tabId} should be in the book: ${book}`);
  const setup = (await box.orca.setups())[0];
  assert.ok(book.includes(setup.id), `the Orca project id ${setup.id} should be in the book: ${book}`);
});

test('up twice creates nothing, closes nothing and changes no file', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  const before = await seeded(box);
  const tree = await snapshot(bots, skipGit);

  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);
  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);

  const after = await box.orca.terminals();
  assert.equal(after.length, 2, 'no tab should have been added');
  assert.deepEqual(after.map((terminal) => terminal.tabId).sort(), [before.daily.tabId, before.ops.tabId].sort());
  assert.deepEqual(await snapshot(bots, skipGit), tree, 'every file should be byte-identical');
});

test('a second run creates nothing and types nothing', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  const soFar = (await box.orca.calls()).length;

  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);

  const second = (await box.orca.calls()).slice(soFar);
  assert.ok(second.length > 0, 'up should have looked at Orca');
  for (const call of second) {
    assert.ok(
      !/repo add|setup-update|terminal create|terminal send/.test(orcaCommand(call)),
      `a run with nothing to do must not change anything, and it called: ${call.args.join(' ')}`,
    );
  }
  assertOrcaCallsAllowed(await box.orca.calls());
});

test('every up writes the session\'s title again, and touches no other tab', async (t) => {
  // A session's title is set and never read, so every run puts it back however
  // Orca or the harness has changed it. A tab outside the book is not the
  // kit's to rename: it cannot tell its own plain tab from the user's.
  const box = await createSandbox(t);
  const { daily, ops } = await seeded(box);
  const soFar = (await box.orca.calls()).length;

  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);

  const renames = orcaCallsOf((await box.orca.calls()).slice(soFar), 'terminal rename');
  assert.equal(renames.length, 1, 'one rename, for the one session the book holds');
  assert.equal(orcaFlag(renames[0], '--terminal'), daily.handle);
  assert.notEqual(orcaFlag(renames[0], '--terminal'), ops.handle);
  assert.equal(orcaFlag(renames[0], '--title'), TAB_TITLES.daily);
  assert.deepEqual(orcaFlags(renames[0]), ['--json', '--terminal', '--title']);
});

test('titles that have drifted change nothing, and the session\'s is written back', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  const before = await seeded(box);

  // What the harness leaves behind in a session's title, and what a user who
  // renamed the other tab leaves behind. Neither is read by anything.
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((terminal) => ({
      ...terminal,
      title: terminal.tabId === before.daily.tabId ? '✳ Chatgpt-bot-kit orca migration' : 'my own shell',
    })),
  });

  const result = await box.run(['up', '--bots', 'bots']);

  assert.equal(result.code, 0, result.stderr);
  const after = await botFatherTabs(box, bots);
  assert.equal(after.terminals.length, 2, 'a drifted title is not a missing tab');
  assert.equal(after.inBook.length, 1);
  assert.equal(after.inBook[0].tabId, before.daily.tabId, 'it is the same tab, found by its id');
  assert.equal(after.inBook[0].title, TAB_TITLES.daily, 'and its title is written back');
  assert.deepEqual(after.leftovers, [{ ...before.ops, title: 'my own shell' }], 'the renamed tab is left as the user left it');
  assert.deepEqual(typedInto(after.inBook[0]).map(tokenless), [bareLaunch(box, 'claude', 'bot-father', 'daily')], 'a tab that was already live is not typed into again');
});

test('a closed tab is opened again, with a new id, and the live tab is left alone', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  const before = await seeded(box, 'codex');

  // The user closed the daily tab: Orca does not have it any more.
  await box.orca.set({
    terminals: (await box.orca.terminals()).filter((terminal) => terminal.tabId !== before.daily.tabId),
  });

  const result = await box.run(['up', '--bots', 'bots']);

  assert.equal(result.code, 0, result.stderr);
  const after = await botFatherTabs(box, bots);
  assert.equal(after.terminals.length, 2, 'the closed tab should be back, and only it');
  assert.deepEqual(after.leftovers, [before.ops], 'the tab that was still there must be untouched');

  assert.equal(after.inBook.length, 1);
  assert.notEqual(after.inBook[0].tabId, before.daily.tabId, 'a new tab has a new id');
  assert.equal(after.inBook[0].title, TAB_TITLES.daily, 'the kit writes the name the book gives it');
  assert.deepEqual(typedInto(after.inBook[0]), [bareLaunch(box, 'codex')], 'the new tab runs the harness bot.yaml names');
  assertOrcaCallsAllowed(await box.orca.calls());
});

test('the id of the tab that came back replaces the old one', async (t) => {
  const box = await createSandbox(t);
  const before = await seeded(box);
  await box.orca.set({
    terminals: (await box.orca.terminals()).filter((terminal) => terminal.tabId !== before.daily.tabId),
  });
  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);
  const replaced = await box.orca.terminals();

  // If the old id were still on the books, this run would open the tab again.
  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);

  assert.deepEqual(await box.orca.terminals(), replaced, 'nothing more should have been opened');
});

test('the plain tab is never waited for and never typed into, whenever it is made', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  const before = await seeded(box);

  // Only the session is left, so `up` makes a plain tab again.
  await box.orca.set({
    terminals: (await box.orca.terminals()).filter((terminal) => terminal.tabId !== before.ops.tabId),
  });
  const soFar = (await box.orca.calls()).length;

  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);

  const after = await botFatherTabs(box, bots);
  assert.equal(after.terminals.length, 2, 'the tab should be back, and only it');
  assert.equal(after.leftovers.length, 1);
  assert.notEqual(after.leftovers[0].tabId, before.ops.tabId);
  assert.deepEqual(typedInto(after.leftovers[0]), [], 'a plain shell is a plain shell');
  assert.deepEqual(after.inBook, [before.daily], 'the session that was still there must be untouched');

  const later = (await box.orca.calls()).slice(soFar);
  assert.deepEqual(orcaCallsOf(later, 'terminal wait'), [], 'nothing is waited for but a session');
  assert.deepEqual(orcaCallsOf(later, 'terminal send'), []);
});

test('a tab in another workspace is never taken for Bot Father\'s', async (t) => {
  const box = await createSandbox(t);
  const before = await seeded(box);

  // Someone else's tab, in someone else's folder, wearing one of our titles.
  const foreign = {
    handle: 'term_foreign',
    tabId: 'tab_foreign',
    paneKey: 'tab_foreign:pane_1',
    ptyId: 'pty_foreign',
    leafId: 'leaf_foreign',
    worktreeId: 'repo_other::/somewhere/else',
    worktreePath: '/somewhere/else',
    title: TAB_TITLES.ops,
    agentIdentity: null,
    typed: [],
  };
  await box.orca.set({ terminals: [...await box.orca.terminals(), foreign] });

  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);

  const terminals = await box.orca.terminals();
  assert.equal(terminals.length, 3, 'nothing should have been opened or closed');
  assert.deepEqual(terminals.find((terminal) => terminal.tabId === 'tab_foreign'), foreign);
  for (const call of orcaCallsOf(await box.orca.calls(), 'terminal list')) {
    assert.equal(orcaFlag(call, '--worktree'), `path:${botHomeIn(box)}`, 'the kit only asks about its own project');
  }
  assert.deepEqual(orcaCallsOf(await box.orca.calls(), 'terminal rename')
    .filter((call) => orcaFlag(call, '--terminal') === foreign.handle), [], 'and renames nothing of anyone else\'s');
});

test('the book is what up reads: a tab id it does not know is not adopted', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  const before = await seeded(box);

  // The book says the daily session is a tab that is not there any more, while
  // the tab that is there is one the book has never heard of.
  const book = await readFile(bookOf(bots), 'utf8');
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((terminal) => (
      terminal.tabId === before.daily.tabId ? { ...terminal, tabId: 'tab_stranger' } : terminal
    )),
  });

  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);

  const after = await botFatherTabs(box, bots);
  assert.equal(after.terminals.length, 3, 'the stranger is left alone and a daily tab is made');
  assert.ok(
    after.terminals.some((terminal) => terminal.tabId === 'tab_stranger'),
    'a tab the kit does not know is not closed and not taken over',
  );
  assert.ok(!book.includes('tab_stranger'));
  assert.equal(after.inBook.length, 1);
  assert.notEqual(after.inBook[0].tabId, 'tab_stranger');
});
