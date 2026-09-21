// The book: `bots/<bot>/sessions.yaml`. This slice creates it and writes into
// it the bot's Orca project — the setup id Orca gave us — and, for each
// session, that session's Orca tab id. `up` reads it, keys on the tab id,
// creates what is missing and writes back what it made.
//
// It is an ordinary file of the bots repo, committed like the rest (PRD 6.10).
// There is no machine-state file beside it and nothing about it is ignored.
//
// The ops tab is not in it, and not anywhere else either: the kit tracks
// nothing about that tab. `up` lists the tabs of Bot Father's Orca project,
// takes away the ones the book holds, and makes a plain shell tab only when
// nothing at all is left. So to the kit — and to these tests — the ops tab is
// simply a tab outside the book.

import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import {
  bookOf,
  botFatherTabs,
  createSandbox,
  git,
  sessionTabIds,
  skipGit,
  snapshot,
  TAB_TITLES,
} from './helpers/cli.js';

/** Every key anywhere in a parsed book, however deep. */
function keysIn(value) {
  if (Array.isArray(value)) return value.flatMap(keysIn);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, held]) => [key, ...keysIn(held)]);
  }
  return [];
}

test('init writes the book, and it is readable YAML', async (t) => {
  const box = await createSandbox(t);

  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);

  const book = await readFile(bookOf(box.path('bots')), 'utf8');
  assert.notEqual(book.trim(), '', 'the book should not be empty');
  assert.notEqual(parse(book), null, `the book should be YAML, got: ${book}`);
});

test('the book holds the Orca project and the daily session', async (t) => {
  const box = await createSandbox(t);

  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);

  const { book, inBook, leftovers, terminals } = await botFatherTabs(box, box.path('bots'));
  assert.equal(terminals.length, 2);
  assert.equal(inBook.length, 1, `one tab id should sit under a session, got: ${book}`);
  assert.equal(inBook[0].title, TAB_TITLES.daily, 'the tab the book knows is the daily one');
  assert.equal(leftovers.length, 1, 'the ops tab is the one tab outside the book');
  assert.equal(leftovers[0].title, TAB_TITLES.ops);

  const setup = (await box.orca.setups())[0];
  assert.ok(book.includes(setup.id), `the book should hold the Orca project id ${setup.id}: ${book}`);
});

test('the kit remembers nothing at all about the ops tab', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');

  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);

  const { book, parsed, leftovers } = await botFatherTabs(box, bots);
  const ops = leftovers[0];
  assert.ok(ops, 'there should be a tab outside the book');
  assert.ok(!book.includes(ops.tabId), `the ops tab id must not be written down: ${book}`);
  assert.ok(!book.includes(ops.handle), `the ops tab handle must not be written down: ${book}`);
  // No entry for it, under that name or any other: a comment may mention the
  // tab, but nothing in the book may hold anything about it.
  assert.ok(!('ops_tab' in parsed), `there is no entry for the ops tab: ${book}`);
  assert.deepEqual(keysIn(parsed).filter((key) => /ops/i.test(key)), [], `the kit keeps no record of an ops tab: ${book}`);

  // Nor anywhere else: the bots folder holds the book and the seed files, and
  // nothing that could be a store of its own.
  const tree = Object.keys(await snapshot(bots, skipGit));
  assert.deepEqual(tree.filter((rel) => path.basename(rel) === 'orca.yaml'), [], 'there is no state file');
});

test('the book is committed like any other file: nothing is ignored', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');

  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);

  const ignored = await git(['check-ignore', '--no-index', '--quiet', 'bots/bot-father/sessions.yaml'], bots);
  assert.equal(ignored.code, 1, 'the book belongs in the repo');

  const status = await git(['status', '--porcelain', '--untracked-files=all'], bots);
  assert.equal(status.code, 0, status.stderr);
  assert.ok(
    status.stdout.includes('bots/bot-father/sessions.yaml'),
    `the book should be waiting to be committed: ${status.stdout}`,
  );
});

test('init ignores nothing of the user\'s: everything it seeds is waiting to be committed', async (t) => {
  // This said "init seeds no .gitignore" while the kit ignored nothing at all.
  // It ignores one thing now — the skill links it makes inside a bot are its own
  // to make on each machine and never the repo's to carry (issue #136, and
  // clone-carries-no-kit-links.test.js) — so what is pinned here is what has
  // been true throughout and is the point of it: every file of the user's that
  // init writes is theirs to commit, and nothing the kit does keeps one out.
  const box = await createSandbox(t);
  const bots = box.path('bots');

  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);

  const waiting = await git(['status', '--porcelain', '--untracked-files=all'], bots);
  assert.equal(waiting.code, 0, waiting.stderr);
  for (const [rel, kind] of Object.entries(await snapshot(bots, skipGit))) {
    if (kind === 'dir' || madeOnThisMachine(rel)) continue;
    assert.ok(
      waiting.stdout.includes(rel),
      `${rel} is the user's and should be waiting to be committed, and git says:\n${waiting.stdout}`,
    );
  }
});

/**
 * What the kit makes on this machine, rather than what the repo carries: the
 * skill links inside a bot's two skills directories, and the kit's own note of
 * which of them it made. The note is named here because it has no other name;
 * it says nothing without the links it is about, so it stands or falls with
 * them (issue #136, and clone-carries-no-kit-links.test.js). Everything else
 * `init` writes is the user's.
 */
const madeOnThisMachine = (rel) => ['.claude/skills/', '.agents/skills/'].some((dir) => rel.includes(`/${dir}`))
  || path.basename(rel) === '.obk-skills.yaml';

test('up writes the new tab id back, in place of the one that was closed', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const before = await botFatherTabs(box, bots);
  const closed = before.inBook[0];

  await box.orca.set({ terminals: before.terminals.filter((terminal) => terminal.tabId !== closed.tabId) });
  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);

  const after = await botFatherTabs(box, bots);
  assert.equal(after.inBook.length, 1, `one daily session in the book, got: ${after.book}`);
  assert.notEqual(after.inBook[0].tabId, closed.tabId);
  assert.ok(!after.book.includes(closed.tabId), `the closed tab should be off the book: ${after.book}`);
});

test('a run with nothing to do leaves the book byte-identical', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const before = await readFile(bookOf(bots), 'utf8');

  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);

  assert.equal(await readFile(bookOf(bots), 'utf8'), before);
});

test('a tab of the user\'s own is enough: up makes no second plain tab', async (t) => {
  // Step 4 of the rule: anything left outside the book, whoever made it, and
  // the kit does nothing. It cannot tell its own plain tab from the user's.
  const box = await createSandbox(t);
  const bots = box.path('bots');
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const before = await botFatherTabs(box, bots);

  // The user closed the ops tab and opened one of his own in its place.
  const mine = { ...before.leftovers[0], handle: 'term_mine', tabId: 'tab_mine', title: 'my own shell' };
  await box.orca.set({ terminals: [...before.inBook, mine] });

  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);

  const after = await botFatherTabs(box, bots);
  assert.equal(after.terminals.length, 2, `nothing should have been added, got: ${JSON.stringify(after.terminals)}`);
  assert.deepEqual(after.leftovers, [mine], 'the user\'s tab is left exactly as it is');
});

test('the ops tab closed means up makes a plain tab again', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const before = await botFatherTabs(box, bots);

  await box.orca.set({ terminals: before.inBook });
  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);

  const after = await botFatherTabs(box, bots);
  assert.equal(after.terminals.length, 2);
  assert.equal(after.leftovers.length, 1);
  assert.notEqual(after.leftovers[0].tabId, before.leftovers[0].tabId, 'a new tab, with a new id');
  assert.equal(after.leftovers[0].title, TAB_TITLES.ops, 'and the title is set as it is made');
  assert.deepEqual(after.leftovers[0].typed, [], 'a plain shell: nothing is typed into it');
  assert.ok(!after.book.includes(after.leftovers[0].tabId), `and it is still not written down: ${after.book}`);
});

test('a book that is gone means a new daily tab, and no ops tab at all', async (t) => {
  // The surprising case, and it falls straight out of the rule: the two tabs
  // the kit lost track of are now outside the book, so after the daily session
  // is made again there is something left over and no plain tab is made.
  const box = await createSandbox(t);
  const bots = box.path('bots');
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const before = await botFatherTabs(box, bots);

  await rm(bookOf(bots));
  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);

  const after = await botFatherTabs(box, bots);
  assert.equal(after.terminals.length, 3, `one new daily tab and the two orphans, got: ${JSON.stringify(after.terminals)}`);
  assert.equal(after.inBook.length, 1, 'the book holds one daily session again');
  assert.notEqual(after.inBook[0].tabId, before.inBook[0].tabId, 'it was made again, not guessed from a title');
  for (const lost of before.terminals) {
    assert.ok(
      after.terminals.some((terminal) => terminal.tabId === lost.tabId),
      `${lost.tabId} was lost track of, and must be left open rather than closed`,
    );
  }
});

test('the sessions in the book are sessions, and nothing else is', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');

  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);

  const { book, leftovers, inBook } = await botFatherTabs(box, bots);
  const { sessions } = sessionTabIds(book);
  assert.equal(inBook.length, 1);
  assert.ok(sessions.has(inBook[0].tabId), 'the daily tab is a session');
  assert.ok(!sessions.has(leftovers[0].tabId), 'the tab outside the book is not a session');
});
