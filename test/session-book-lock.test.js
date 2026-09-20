// Two things write the book, and neither may lose the other's work.
//
// `up` writes it — the tab id, the moment Orca hands one over — and the kit's
// hook writes it, from inside a live session, whenever that session reports the
// conversation it is running. They are separate processes with no idea of each
// other, and the hook fires when the harness feels like firing it, which is
// often while `up` is still working.
//
// The review drove a real hook during a real `up` and watched `up`'s later write
// erase the id the hook had just saved. A lost id is a lost conversation: the
// book is the authority (ADR 0002), and what it does not hold, nothing holds.
//
// So every change is a read-modify-write while nobody else can write, and the
// file is replaced in one go rather than filled in. What that has to mean from
// outside is what the tests here pin: two writers that really overlap both keep
// their change, a crowd of them all keep theirs, and a reader in the middle of
// the crowd never gets a half file. The lock itself is not pinned anywhere —
// see the note at the foot of this file.
//
// Overlapping for real is the point, and the only way to reach it through the
// public interface is to make Orca slow on purpose: the fake Orca runs a hook
// of its own in the middle of a call, so the hook writes the book at the moment
// `up` is holding it (helpers/fake-orca.js, `runDuring`).

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';

import {
  bookIn,
  bookOf,
  createSandbox,
  harnessChain,
  orcaCallsOf,
  recordSession,
  sessionIn,
  sessionStart,
  tabsOfBot,
} from './helpers/cli.js';

/** A bots folder with one Claude bot and the sessions named, not yet brought up. */
async function written(box, sessions = ['daily']) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude'])).code, 0);
  for (const name of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', name]);
    assert.equal(added.code, 0, added.stderr);
  }
  return box.path('bots');
}

/**
 * What the fake Orca should start in the middle of a call so that a real report
 * lands there: the harness chain, running the kit's hook command with the event
 * in its environment.
 *
 * Not the hook command on its own. The kit decides whose conversation a report
 * is about from the process tree (round 2, finding 2), so a hook with no harness
 * above it is rightly ignored and the writer this test means to overlap with
 * would never write anything.
 */
async function aHookDuring(box, command, { bots, session, tab, source = 'startup', after = 0 }) {
  const chain = await harnessChain(box, `obk 'session' 'record' '--bots' '${bots}' '--bot' 'api-bot'`, {
    stdin: sessionStart({ session, source }),
  });
  // The fake counts every call of a command since the sandbox began, and `init`
  // has already made some, so which call to run this on is counted from here:
  // `after: 0` is the very next one, `after: 1` the one after that.
  const already = orcaCallsOf(await box.orca.calls(), command).length;
  return {
    command,
    argv: chain.argv,
    // The tab the report is about. `terminal create` names no terminal, so the
    // fake has none to take it from — and it is the tab the book already holds
    // that matters here, not the one the call is about to make.
    env: { ...chain.env, ORCA_TAB_ID: tab },
    on: already + 1 + after,
  };
}

test('an id the hook writes while up is opening a tab is still there afterwards', async (t) => {
  // The window the review's bug lived in, and the one still open: `up` reads the
  // book, asks Orca for a tab — which takes as long as it takes — and then writes
  // the tab id into the session's entry. A hook that reports in that gap has
  // written the same entry first, and the run must not put its own read back over
  // the top of it.
  const box = await createSandbox(t);
  const bots = await written(box);
  assert.equal((await box.run(['up', '--bots', 'bots', '--bot', 'api-bot'])).code, 0);
  const was = (await sessionIn(bots, 'api-bot', 'daily')).tab;

  // The tab is gone, so the next run opens another one — and the hook reports
  // while Orca is making it, about the tab the book still names.
  await box.orca.set({
    terminals: (await box.orca.terminals()).filter((one) => one.tabId !== was),
    runDuring: await aHookDuring(box, 'terminal create', { bots, tab: was, session: 'sess-from-the-hook' }),
  });

  const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(up.code, 0, up.stderr);
  const ran = await box.orca.ranDuring();
  assert.equal(ran.length, 1, `the hook should have run in the middle of the run, got: ${JSON.stringify(ran)}`);
  assert.equal(ran[0].status, 0, `and it should not have failed: ${ran[0].stderr}`);

  const daily = await sessionIn(bots, 'api-bot', 'daily');
  const tab = (await tabsOfBot(box, bots, 'api-bot'))[0];
  assert.equal(daily.tab, tab.tabId, 'the tab the run made is in the book');
  assert.notEqual(daily.tab, was, 'and it is the new one');
  assert.equal(
    daily.session,
    'sess-from-the-hook',
    `and the id the hook saved is still there: ${JSON.stringify(daily)}`,
  );
});

test('a clear the hook records while up is opening a tab keeps its history too', async (t) => {
  // Not only the id: the one the hook moved aside has to survive the same gap, or
  // the history the book exists to keep is the first thing lost.
  const box = await createSandbox(t);
  const bots = await written(box);
  assert.equal((await box.run(['up', '--bots', 'bots', '--bot', 'api-bot'])).code, 0);
  const was = (await sessionIn(bots, 'api-bot', 'daily')).tab;
  await recordSession(box, { bots, bot: 'api-bot', tab: was, session: 'sess-1', source: 'startup' });

  await box.orca.set({
    terminals: (await box.orca.terminals()).filter((one) => one.tabId !== was),
    runDuring: await aHookDuring(box, 'terminal create', { bots, tab: was, session: 'sess-2', source: 'clear' }),
  });

  const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(up.code, 0, up.stderr);
  assert.equal((await box.orca.ranDuring()).length, 1, 'the hook should have run in the middle of the run');
  const daily = await sessionIn(bots, 'api-bot', 'daily');
  assert.equal(daily.session, 'sess-2', `got: ${JSON.stringify(daily)}`);
  assert.deepEqual(
    (daily.history ?? []).map((old) => old.session),
    ['sess-1'],
    `the id the hook moved aside must survive the run it happened inside: ${JSON.stringify(daily)}`,
  );
});

test('a hook that writes while the run is busy with another session loses nothing', async (t) => {
  // Two sessions to bring back, and the second one's hook reports while Orca is
  // still making the first one's tab. So the run is in the middle of one session
  // and has not reached the other, whose entry has just been written under it —
  // and when it does reach that one, it must add the tab without taking the id.
  const box = await createSandbox(t);
  const bots = await written(box, ['daily', 'review']);
  assert.equal((await box.run(['up', '--bots', 'bots', '--bot', 'api-bot'])).code, 0);
  const before = await bookIn(bots, 'api-bot');

  await box.orca.set({
    terminals: [],
    // The sessions come up in the order they are written, so the first
    // `terminal create` of the run is the first session's — and the report that
    // lands then is about the second, whose tab the book still names.
    runDuring: await aHookDuring(box, 'terminal create', {
      bots, tab: before.sessions.review.tab, session: 'sess-review',
    }),
  });

  const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(up.code, 0, up.stderr);
  assert.equal((await box.orca.ranDuring()).length, 1, 'the hook should have run once, in the middle of the run');
  const book = await bookIn(bots, 'api-bot');
  const tabs = await tabsOfBot(box, bots, 'api-bot');
  assert.equal(tabs.length, 2, `both sessions should have a tab, got: ${JSON.stringify(tabs)}`);
  assert.equal(book.sessions.review.session, 'sess-review', `got: ${JSON.stringify(book.sessions)}`);
  assert.deepEqual(
    [book.sessions.daily.tab, book.sessions.review.tab].sort(),
    tabs.map((tab) => tab.tabId).sort(),
    'and both tabs are written down, whichever order the writes landed in',
  );
});

test('a crowd of writers all keep their change, and the book stays readable', async (t) => {
  // Six sessions of one bot, six hooks at once. Whatever order they land in,
  // every one of them has to be in the file at the end and the file has to be
  // one a reader can parse — a write that is not replaced in one go leaves a
  // half file for whoever reads next.
  const box = await createSandbox(t);
  const names = ['one', 'two', 'three', 'four', 'five', 'six'];
  const bots = await written(box, names);
  assert.equal((await box.run(['up', '--bots', 'bots', '--bot', 'api-bot'])).code, 0);
  const book = await bookIn(bots, 'api-bot');

  const reported = await Promise.all(names.map((name) => recordSession(box, {
    bots,
    bot: 'api-bot',
    tab: book.sessions[name].tab,
    session: `sess-${name}`,
    source: 'startup',
  })));

  for (const [at, ran] of reported.entries()) {
    assert.equal(ran.code, 0, `${names[at]}: ${ran.stderr}`);
    assert.equal(ran.stdout, '', `${names[at]} should have said nothing: ${ran.stdout}`);
  }
  const text = await readFile(bookOf(bots, 'api-bot'), 'utf8');
  const after = parse(text);
  assert.notEqual(after, null, `the book must still be readable YAML, got:\n${text}`);
  assert.deepEqual(
    Object.fromEntries(names.map((name) => [name, after.sessions?.[name]?.session])),
    Object.fromEntries(names.map((name) => [name, `sess-${name}`])),
    `every writer's id must be in the file:\n${text}`,
  );
});

test('a reader in the middle of a crowd never sees half a book', async (t) => {
  // The other side of the same rule. While six hooks write, the book is read
  // over and over, and every single read has to come back as a whole document —
  // a file being filled in place would be caught here as a parse error or as a
  // session that lost its tab.
  const box = await createSandbox(t);
  const names = ['one', 'two', 'three', 'four', 'five', 'six'];
  const bots = await written(box, names);
  assert.equal((await box.run(['up', '--bots', 'bots', '--bot', 'api-bot'])).code, 0);
  const book = await bookIn(bots, 'api-bot');
  const tabs = Object.fromEntries(names.map((name) => [name, book.sessions[name].tab]));

  let reading = true;
  const reads = (async () => {
    const seen = [];
    // Capped: the point is to read often while the writers work, not to read
    // for ever if a slow machine takes its time over six small processes.
    while (reading && seen.length < 2000) {
      seen.push(await readFile(bookOf(bots, 'api-bot'), 'utf8'));
    }
    return seen;
  })();
  await Promise.all(names.map((name) => recordSession(box, {
    bots, bot: 'api-bot', tab: tabs[name], session: `sess-${name}`, source: 'startup',
  })));
  reading = false;
  const seen = await reads;

  assert.ok(seen.length > 0, 'the reader should have managed at least one read');
  for (const text of seen) {
    const parsed = parse(text);
    assert.notEqual(parsed, null, `a read came back as something that is not YAML:\n${text}`);
    assert.deepEqual(
      Object.keys(parsed.sessions ?? {}).sort(),
      [...names].sort(),
      `a read came back with sessions missing:\n${text}`,
    );
  }
});

// Two rules are not here, and not because they do not matter: a writer that
// cannot get the lock yet waiting rather than dropping its change, and a writer
// held up for half a minute being unable to write over what the next one
// committed (round 3, finding 2). Neither can be arranged from the command line
// — `up` and the hook each hold the book for one read and one write, so there is
// no moment from outside at which a test can be inside the lock — and neither
// may be reached by naming the lock file, whose name is the kit's own business.
// They are pinned at `updateBook` instead, in separate processes, in
// `test/session-book-writers.test.js`.
//
// What is covered without naming it: a write that finishes leaves no lock behind,
// because `test/work-dir.test.js` lists the whole bot home and would fail on one.
