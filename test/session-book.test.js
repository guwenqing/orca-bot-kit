// What the book holds once a session has reported a harness session of its own
// (ADR 0012). `sessions.yaml` in the bot home, as before — the bot's Orca
// project and each session's tab id — with the session the harness is running
// as beside the tab, and every id it ran as before that.
//
// The keys appear only when there is something to put in them: a session that
// nothing has reported for looks exactly as it did before this slice, which is
// what keeps a book the user reads from filling with empty entries.
//
// And the rule underneath all of it: a failed or interrupted run never leaves a
// session the book does not know. The tab id goes in the moment Orca hands it
// over, before anything that can fail, and nothing a later run does takes away
// what the hook wrote.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';

import {
  addressPattern,
  assertCleanFailure,
  bookIn,
  bookOf,
  createSandbox,
  recordSession,
  sessionIn,
  tabsOfBot,
} from './helpers/cli.js';

/** A bots folder with one Claude bot and its sessions, brought up. */
async function fleet(box, sessions = [['daily', []]]) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude'])).code, 0);
  for (const [name, settings = []] of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', name, ...settings]);
    assert.equal(added.code, 0, added.stderr);
  }
  const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot', '--json']);
  assert.equal(up.code, 0, up.stderr);
  const bots = box.path('bots');
  return { bots, tabs: Object.fromEntries(JSON.parse(up.stdout).tabs.map((tab) => [tab.name, tab])) };
}

test('the session the harness reported sits in the book beside the tab, and the book is still YAML', async (t) => {
  const box = await createSandbox(t);
  const { bots, tabs } = await fleet(box);

  await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, session: 'sess-1' });

  const text = await readFile(bookOf(bots, 'api-bot'), 'utf8');
  const book = parse(text);
  assert.notEqual(book, null, `the book should still be readable YAML, got:\n${text}`);
  assert.equal(typeof book.orca?.setup, 'string', `the Orca project is still in it, got:\n${text}`);
  // `launched` is when the kit started a harness in the tab, written with the
  // tab (round 2, finding 3): without it there is no telling which of a
  // harness's own conversations could have been this session's. `mailbox` and
  // `address` are how the session is written to (PRD 6.9): the Run made for it
  // at `up`, and, on Claude Code, the name it was launched under. `rules` is a
  // stamp of AGENTS.md as the session last read it (#272).
  assert.deepEqual(
    Object.keys(book.sessions.daily).sort(),
    ['address', 'launched', 'mailbox', 'rules', 'session', 'tab'],
    `got: ${JSON.stringify(book.sessions.daily)}`,
  );
  assert.equal(book.sessions.daily.tab, tabs.daily.tabId);
  assert.equal(book.sessions.daily.session, 'sess-1');
  assert.match(book.sessions.daily.address, addressPattern('api-bot', 'daily'));
});

test('up leaves what the hook wrote exactly as it found it', async (t) => {
  // `up` and the hook write the same file from two directions. A run that
  // rewrote the book from what it knows would throw away every id the sessions
  // reported while it was not looking, which is the one thing the book is for.
  const box = await createSandbox(t);
  const { bots, tabs } = await fleet(box);
  await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, session: 'sess-1', source: 'startup' });
  await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, session: 'sess-2', source: 'clear' });
  const before = await readFile(bookOf(bots, 'api-bot'), 'utf8');
  assert.ok(before.includes('sess-1') && before.includes('sess-2'), `both ids should be in it first:\n${before}`);

  assert.equal((await box.run(['up', '--bots', 'bots', '--bot', 'api-bot'])).code, 0);
  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);

  assert.equal(await readFile(bookOf(bots, 'api-bot'), 'utf8'), before, 'a run with nothing to do changes nothing');
});

test('a session whose tab came back keeps the id and the history it had', async (t) => {
  const box = await createSandbox(t);
  const { bots, tabs } = await fleet(box);
  await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, session: 'sess-1', source: 'startup' });
  await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, session: 'sess-2', source: 'clear' });
  await box.orca.set({
    terminals: (await box.orca.terminals()).filter((terminal) => terminal.tabId !== tabs.daily.tabId),
  });

  assert.equal((await box.run(['up', '--bots', 'bots', '--bot', 'api-bot'])).code, 0);

  const daily = await sessionIn(bots, 'api-bot', 'daily');
  const back = (await tabsOfBot(box, bots, 'api-bot'))[0];
  assert.equal(daily.tab, back.tabId, 'the new tab is the session\'s tab now');
  assert.notEqual(daily.tab, tabs.daily.tabId, 'and it is a new tab');
  assert.equal(daily.session, 'sess-2', 'the harness session is untouched: the tab went, the conversation did not');
  assert.deepEqual(daily.history.map((old) => old.session), ['sess-1']);
});

test('a run that died after the tab existed leaves a session the book knows, with no id yet', async (t) => {
  // The failure ADR 0012 is written against: a live tab nothing remembers. The
  // tab id is written the moment Orca gives it, and the id keys stay away until
  // a harness has actually reported one.
  const box = await createSandbox(t);
  await box.orca.set({ fail: { 'terminal send': { code: 'runtime_error', message: 'the pty went away' } } });

  assertCleanFailure(await box.run(['init', '--bots', 'bots', '--harness', 'claude']));

  const bots = box.path('bots');
  const open = await box.orca.terminals();
  assert.equal(open.length, 1, `the session's tab is open, got: ${JSON.stringify(open)}`);
  const daily = (await bookIn(bots)).sessions?.daily;
  assert.equal(daily?.tab, open[0].tabId, 'the tab that exists is in the book');
  assert.equal('session' in daily, false, 'nothing reported an id, so there is none to write');
  assert.equal('history' in daily, false);
});

test('two sessions of one bot keep two records, and neither reaches into the other', async (t) => {
  const box = await createSandbox(t);
  const { bots, tabs } = await fleet(box, [['daily', []], ['review', []]]);

  await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, session: 'daily-1', source: 'startup' });
  await recordSession(box, { bots, bot: 'api-bot', tab: tabs.review.tabId, session: 'review-1', source: 'startup' });
  await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, session: 'daily-2', source: 'clear' });

  const book = await bookIn(bots, 'api-bot');
  assert.equal(book.sessions.daily.session, 'daily-2');
  assert.deepEqual(book.sessions.daily.history.map((old) => old.session), ['daily-1']);
  assert.equal(book.sessions.review.session, 'review-1');
  assert.equal('history' in book.sessions.review, false, 'the session that was never cleared has no history');
});
