// What a run that dies halfway leaves behind.
//
// A tab exists the moment Orca answers `terminal create`. Everything after
// that — typing the harness in, asking whether it came up, opening the plain
// tab — can fail, and if the book is only written at the end, the run dies
// with a live session tab that nothing remembers. The next run then starts a
// second harness in a second tab and takes the first for the leftover, so it
// makes no plain tab either: one failed call and the user has two agents in
// the same folder and no shell.
//
// So the id goes into the book as soon as the tab is there, before anything
// that can fail.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assertCleanFailure,
  bookOf,
  botFatherTabs,
  createSandbox,
  orcaCallsOf,
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
  assert.deepEqual(typedInto(orphan), ['claude'], 'the first run did type it in');

  await box.orca.set({ fail: {} });
  const soFar = (await box.orca.calls()).length;
  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);

  const { inBook } = await botFatherTabs(box, box.path('bots'));
  assert.deepEqual(typedInto(inBook[0]), ['claude'], 'and the second run must not type it in again');
  assert.deepEqual(
    orcaCallsOf((await box.orca.calls()).slice(soFar), 'terminal send'),
    [],
    'nothing is typed into a tab that was already live, whatever happened before',
  );
});

test('a run that died before any tab existed leaves no session behind', async (t) => {
  // The other side of it: the book must not name a tab that was never made.
  const box = await createSandbox(t);
  await box.orca.set({ fail: { 'terminal create': { code: 'runtime_error', message: 'no room for another tab' } } });

  assertCleanFailure(await box.run(['init', '--bots', 'bots', '--harness', 'claude']));

  assert.deepEqual(await box.orca.terminals(), []);
  const { sessions } = sessionTabIds(readBook(box));
  assert.deepEqual([...sessions], [], 'nothing was opened, so nothing is on the books');
});

/** The book as it is on disk, or an empty one when the run never wrote it. */
function readBook(box) {
  try {
    return readFileSync(bookOf(box.path('bots')), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}
