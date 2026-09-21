// What a run that dies halfway leaves behind.
//
// A tab exists the moment Orca answers `terminal create`. Everything after
// that — typing the harness in, asking whether it came up, making the
// session's mailbox, opening the plain tab — can fail, and if the book is only
// written at the end, the run dies with a live session tab that nothing
// remembers. The next run then starts a second harness in a second tab and
// takes the first for the leftover, so it makes no plain tab either: one
// failed call and the user has two agents in the same folder and no shell.
//
// So the id goes into the book as soon as the tab is there, before anything
// that can fail.
//
// Which resource is left half-made matters, and there are two. A tab with no
// mailbox yet is recoverable: the next run finds it in the book and finishes
// it. A mailbox with no tab is not, because Orca has no way to delete a Run —
// so the tab is always the one made and written down first, and a run that
// never opened one asks for no mailbox either.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assertCleanFailure,
  bareLaunch,
  bookOf,
  botFatherTabs,
  createSandbox,
  orcaCallsOf,
  sessionIn,
  sessionTabIds,
  TAB_TITLES,
  typedInto,
} from './helpers/cli.js';

/** Every way a run can die after the session's tab is already open. */
const AFTER_THE_TAB_EXISTS = {
  'typing the harness in': { 'terminal send': { code: 'runtime_error', message: 'the pty went away' } },
  'asking whether the harness came up': { 'terminal wait': { code: 'terminal_not_found', message: 'no such terminal' } },
  // The session's tab is made first; this breaks the plain tab that follows it.
  'opening the plain tab': { 'terminal create': { code: 'runtime_error', message: 'no room for another tab', after: 1 } },
  // Making the session's mailbox is another Orca call that can be refused, and
  // it sits between the tab being opened and the run ending (review of PR #132,
  // finding 3). The tab has to be on the books before it.
  'making the session\'s mailbox': { 'orchestration run-create': { code: 'runtime_error', message: 'no run for you' } },
};

for (const [label, failure] of Object.entries(AFTER_THE_TAB_EXISTS)) {
  test(`a run that died ${label} leaves the session in the book`, async (t) => {
    const box = await createSandbox(t);
    await box.orca.set({ fail: failure });

    const died = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

    assertCleanFailure(died);
    const open = await box.orca.terminals();
    assert.equal(open.length, 1, `the session's tab is open, got: ${JSON.stringify(open)}`);
    const { sessions } = sessionTabIds(readBook(box));
    assert.ok(
      sessions.has(open[0].tabId),
      `the tab that exists must be in the book before anything that can fail: ${[...sessions].join(', ')}`,
    );
  });

  test(`the next run picks up the session left by a run that died ${label}`, async (t) => {
    const box = await createSandbox(t);
    await box.orca.set({ fail: failure });
    assertCleanFailure(await box.run(['init', '--bots', 'bots', '--harness', 'claude']));
    const orphan = (await box.orca.terminals())[0];

    await box.orca.set({ fail: {} });
    const again = await box.run(['up', '--bots', 'bots']);

    assert.equal(again.code, 0, again.stderr);
    const { inBook, leftovers, terminals } = await botFatherTabs(box, box.path('bots'));
    assert.equal(terminals.length, 2, `the same session and one plain tab, got: ${JSON.stringify(terminals)}`);
    assert.equal(inBook.length, 1);
    assert.equal(inBook[0].tabId, orphan.tabId, 'the session is the tab the first run made');
    assert.equal(leftovers.length, 1);
    assert.notEqual(leftovers[0].tabId, orphan.tabId, 'the session tab is not taken for the leftover');
    assert.equal(leftovers[0].title, TAB_TITLES.ops, 'and a plain tab was made, as it should be');
  });
}

test('no second harness is started in the tab the first run made', async (t) => {
  const box = await createSandbox(t);
  // The line was typed; the run died asking whether anything came up.
  await box.orca.set({ fail: { 'terminal wait': { code: 'terminal_not_found', message: 'no such terminal' } } });
  assertCleanFailure(await box.run(['init', '--bots', 'bots', '--harness', 'claude']));
  const orphan = (await box.orca.terminals())[0];
  assert.deepEqual(typedInto(orphan), [bareLaunch('claude', 'bot-father', 'daily')], 'the first run did type it in');

  await box.orca.set({ fail: {} });
  const soFar = (await box.orca.calls()).length;
  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);

  const { inBook } = await botFatherTabs(box, box.path('bots'));
  assert.deepEqual(typedInto(inBook[0]), [bareLaunch('claude', 'bot-father', 'daily')], 'and the second run must not type it in again');
  assert.deepEqual(
    orcaCallsOf((await box.orca.calls()).slice(soFar), 'terminal send'),
    [],
    'nothing is typed into a tab that was already live, whatever happened before',
  );
});

test('a run that died before any tab existed leaves no session behind', async (t) => {
  // The other side of it: the book must not name a tab that was never made,
  // and the orphan must not move to the other resource either. A Run made for a
  // session that got no tab is worse than a tab with no Run — a tab the next
  // run finds and finishes, where a Run cannot be deleted at all, by the kit or
  // by anybody.
  const box = await createSandbox(t);
  await box.orca.set({ fail: { 'terminal create': { code: 'runtime_error', message: 'no room for another tab' } } });

  assertCleanFailure(await box.run(['init', '--bots', 'bots', '--harness', 'claude']));

  assert.deepEqual(await box.orca.terminals(), []);
  const { sessions } = sessionTabIds(readBook(box));
  assert.deepEqual([...sessions], [], 'nothing was opened, so nothing is on the books');
  assert.deepEqual(await box.orca.runs(), [], 'and no mailbox was made for a session that has no tab');
});

test('the mailbox a run could not make is made by the next one, in the tab that is already there', async (t) => {
  // The failure the review found, and what it must leave behind: a tab on the
  // books with no mailbox yet, which the next run finishes. Not a second tab
  // beside the first, and not a session the fleet can never write to.
  const box = await createSandbox(t);
  await box.orca.set({ fail: { 'orchestration run-create': { code: 'runtime_error', message: 'no run for you' } } });
  assertCleanFailure(await box.run(['init', '--bots', 'bots', '--harness', 'claude']));
  const orphan = (await box.orca.terminals())[0];
  assert.ok(orphan, 'the tab was made before the mailbox was asked for');
  assert.equal(await mailboxOf(box), undefined, 'and it has no mailbox, because Orca would not make one');

  await box.orca.set({ fail: {} });
  const again = await box.run(['up', '--bots', 'bots']);

  assert.equal(again.code, 0, again.stderr);
  const { inBook, terminals } = await botFatherTabs(box, box.path('bots'));
  assert.equal(terminals.length, 2, `the same session and one plain tab, got: ${JSON.stringify(terminals)}`);
  assert.equal(inBook.length, 1);
  assert.equal(inBook[0].tabId, orphan.tabId, 'the session is still the tab the first run made');
  const mailbox = await mailboxOf(box);
  assert.ok(
    (await box.orca.runs()).some((run) => run.id === mailbox),
    `and it has the mailbox now: ${JSON.stringify(await box.orca.runs())}`,
  );
});

/** What the book says the daily session's mailbox is, if it says anything. */
const mailboxOf = async (box) => (await sessionIn(box.path('bots'), 'bot-father', 'daily'))?.mailbox;

/** The book as it is on disk, or an empty one when the run never wrote it. */
function readBook(box) {
  try {
    return readFileSync(bookOf(box.path('bots')), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}
