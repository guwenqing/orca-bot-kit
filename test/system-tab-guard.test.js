// The guard every system test ends on (#246): a system test never closes a tab
// that is not its own (AGENTS.md, safety on the owner's machine). It used to
// compare every terminal on the machine before and after, so a tab the owner's
// other sessions closed in the meantime failed a test that had done nothing
// wrong. Now it fails when, and only when, the test itself closed a tab it did
// not create; a tab gone by some other hand is reported, not failed. A tab the
// test created is one it opened through the guard, or one a kit run it started
// says it opened (`created: true`). Being opened after the test began does not
// make a tab the test's: another process can open one in the test's own
// project at any time, and a teardown that closed it would be closing a
// stranger's tab (found in review).
//
// Run here against the fake Orca only. "Another process" is the fake Orca CLI
// called directly, the way the owner's other sessions call Orca, never through
// the guard.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { createSandbox } from './helpers/cli.js';
import { tabGuard } from './helpers/tab-guard.js';

/** Call the fake Orca as some other process would, not through the guard. */
function elsewhere(box, args) {
  const done = spawnSync(box.orca.cli, [...args, '--json'], { cwd: box.cwd, env: box.env, encoding: 'utf8' });
  assert.equal(done.error, undefined, `the fake Orca should be runnable: ${done.error?.message}`);
  const answer = JSON.parse(done.stdout);
  assert.equal(answer.ok, true, `orca ${args.join(' ')} should have gone through: ${JSON.stringify(answer.error)}`);
  return answer.result;
}

/** Open a tab in `home` as some other process would, and give back its handle. */
const openElsewhere = (box, home, title) => elsewhere(box, ['terminal', 'create', '--worktree', `path:${home}`, '--title', title]).terminal.handle;

/**
 * A tab entry of an obk JSON answer (init, up, restart, unpause), in the shape
 * the kit writes it: `created` is false for a tab that was already there and
 * the kit only reused.
 */
const kitTab = (handle, created) => ({
  bot: 'example', name: 'daily', title: 'Example daily', tabId: `tab_of_${handle}`, terminal: handle, created, harnessStarted: created,
});

/** Close a tab as some other process would: the owner's other sessions, or the kit. */
const closeElsewhere = (box, handle) => elsewhere(box, ['terminal', 'close', '--terminal', handle, '--tab']);

/** Every handle Orca lists right now. */
const openNow = (box) => new Set(elsewhere(box, ['terminal', 'list']).terminals.map((terminal) => terminal.handle));

/**
 * A machine the owner is working on: one project of theirs with three tabs open
 * in it, and an empty project for the test to open its own tabs in. `before` is
 * what a system test takes when it starts: every handle open at that moment.
 */
async function ownersMachine(t) {
  const box = await createSandbox(t);
  // Orca registers a folder inside a git repo as git; this machine's are plain
  // folders, registered as given, as Orca did before 1.4.240 (#712).
  await box.orca.set({ repoAddKind: 'folder', repoAddAsGiven: true });
  const theirs = box.path('owner-project');
  const ours = box.path('test-project');
  elsewhere(box, ['repo', 'add', '--path', theirs]);
  elsewhere(box, ['repo', 'add', '--path', ours]);
  const owner = [
    openElsewhere(box, theirs, 'owner one'),
    openElsewhere(box, theirs, 'owner two'),
    openElsewhere(box, theirs, 'owner three'),
  ];
  const before = openNow(box);
  assert.deepEqual([...before].sort(), [...owner].sort(), 'the owner\'s three tabs should be all that is open');
  return { box, ours, owner, before };
}

/** Open a tab of the test's own, through the guard. */
function openOurs(guard, home, title) {
  const answer = guard.orca(['terminal', 'create', '--worktree', `path:${home}`, '--title', title]);
  assert.equal(answer.ok, true, `the test's own tab should open: ${JSON.stringify(answer.error)}`);
  return answer.result.terminal.handle;
}

// Done-check 1 of #246.
test('a test that closes a tab it did not create fails the guard', async (t) => {
  const { box, ours, owner, before } = await ownersMachine(t);
  const guard = tabGuard(box.orca.cli, { env: box.env });
  const mine = openOurs(guard, ours, 'mine');

  const answer = guard.orca(['terminal', 'close', '--terminal', owner[1], '--tab']);
  assert.equal(answer.ok, true, 'the fake should have closed it, as Orca would');
  guard.orca(['terminal', 'close', '--terminal', mine, '--tab']);

  assert.deepEqual(guard.verdict(before), { closedNotOurs: [owner[1]], goneElsewhere: [] });
});

// Done-check 2 of #246.
test('a tab closed by another process during the run does not fail the guard, and is reported', async (t) => {
  const { box, ours, owner, before } = await ownersMachine(t);
  const guard = tabGuard(box.orca.cli, { env: box.env });
  const mine = openOurs(guard, ours, 'mine');

  // The owner's other session closes one of its own tabs while the test runs.
  closeElsewhere(box, owner[0]);
  guard.orca(['terminal', 'close', '--terminal', mine, '--tab']);

  assert.deepEqual(guard.verdict(before), { closedNotOurs: [], goneElsewhere: [owner[0]] });
});

test('a tab another process opened in the test\'s own project after it began is not the test\'s to close', async (t) => {
  // The review's case: the tab is not in `before`, and it is in the project a
  // teardown sweeps, but the test did not create it.
  const { box, ours, before } = await ownersMachine(t);
  const guard = tabGuard(box.orca.cli, { env: box.env });
  const mine = openOurs(guard, ours, 'mine');
  const stranger = openElsewhere(box, ours, 'stranger');

  guard.orca(['terminal', 'close', '--terminal', mine, '--tab']);
  guard.orca(['terminal', 'close', '--terminal', stranger, '--tab']);

  assert.deepEqual(guard.verdict(before), { closedNotOurs: [stranger], goneElsewhere: [] });
});

test('a tab a kit run says it created is the test\'s own to close', async (t) => {
  // The kit opens tabs in a process of its own; the test knows them only from
  // the kit's answer.
  const { box, ours, before } = await ownersMachine(t);
  const guard = tabGuard(box.orca.cli, { env: box.env });
  const opened = openElsewhere(box, ours, 'Example daily');
  const answer = { bots: box.path('bots'), tabs: [kitTab(opened, true)] };

  guard.openedByKit(answer);
  guard.orca(['terminal', 'close', '--terminal', opened, '--tab']);

  assert.deepEqual(guard.closed(), [opened]);
  assert.deepEqual(guard.verdict(before), { closedNotOurs: [], goneElsewhere: [] });
});

test('a tab the kit only reused, or an answer with no tabs, makes nothing the test\'s own', async (t) => {
  const { box, ours, before } = await ownersMachine(t);
  const guard = tabGuard(box.orca.cli, { env: box.env });
  const reused = openElsewhere(box, ours, 'Example daily');
  const created = openElsewhere(box, ours, 'Example ops');

  guard.openedByKit({ bots: box.path('bots') });
  guard.openedByKit({ bots: box.path('bots'), tabs: [] });
  guard.openedByKit({ bots: box.path('bots'), tabs: [kitTab(reused, false), kitTab(created, true)] });
  guard.orca(['terminal', 'close', '--terminal', reused, '--tab']);
  guard.orca(['terminal', 'close', '--terminal', created, '--tab']);

  assert.deepEqual(guard.verdict(before), { closedNotOurs: [reused], goneElsewhere: [] });
});

test('openedByKit gives the answer back as it was, so a caller can wrap it', async (t) => {
  const { box } = await ownersMachine(t);
  const guard = tabGuard(box.orca.cli, { env: box.env });

  const answer = { bots: '/tmp/bots', tabs: [kitTab('term_7', true), kitTab('term_8', false)], paused: [] };
  assert.deepEqual(guard.openedByKit(answer), {
    bots: '/tmp/bots',
    tabs: [
      { bot: 'example', name: 'daily', title: 'Example daily', tabId: 'tab_of_term_7', terminal: 'term_7', created: true, harnessStarted: true },
      { bot: 'example', name: 'daily', title: 'Example daily', tabId: 'tab_of_term_8', terminal: 'term_8', created: false, harnessStarted: false },
    ],
    paused: [],
  });
  assert.deepEqual(guard.openedByKit({ bots: '/tmp/bots' }), { bots: '/tmp/bots' });
});

test('a tab closed twice is named once, in the order first closed', async (t) => {
  const { box, owner, before } = await ownersMachine(t);
  const guard = tabGuard(box.orca.cli, { env: box.env });

  guard.orca(['terminal', 'close', '--terminal', owner[2], '--tab']);
  guard.orca(['terminal', 'close', '--terminal', owner[0], '--tab']);
  guard.closedByKit([kitTab(owner[2], false)]);

  assert.deepEqual(guard.verdict(before).closedNotOurs, [owner[2], owner[0]]);
});

test('a test that closes only its own tabs leaves both lists empty', async (t) => {
  const { box, ours, before } = await ownersMachine(t);
  const guard = tabGuard(box.orca.cli, { env: box.env });
  const first = openOurs(guard, ours, 'first');
  const second = openOurs(guard, ours, 'second');

  guard.orca(['terminal', 'close', '--terminal', first, '--tab']);
  guard.orca(['terminal', 'close', '--terminal', second, '--tab']);

  // The closes were seen, so the empty verdict is not a guard that saw nothing.
  assert.deepEqual(guard.closed(), [first, second]);
  assert.deepEqual(guard.verdict(before), { closedNotOurs: [], goneElsewhere: [] });
});

test('the test\'s own close and another process\'s close land each in their own list', async (t) => {
  const { box, owner, before } = await ownersMachine(t);
  const guard = tabGuard(box.orca.cli, { env: box.env });

  guard.orca(['terminal', 'close', '--terminal', owner[2], '--tab']);
  closeElsewhere(box, owner[0]);

  // owner[1] is still open and in neither list.
  assert.deepEqual(guard.verdict(before), { closedNotOurs: [owner[2]], goneElsewhere: [owner[0]] });
});

test('a tab the test closed still counts while Orca goes on listing it', async (t) => {
  // Orca answers a close before `terminal list` stops reporting the tab (the
  // fake's `closeLag`), so the guard cannot wait for the tab to be gone to call
  // it closed: the test closed it, and that is the failure.
  const { box, owner, before } = await ownersMachine(t);
  await box.orca.set({ closeLag: 5 });
  const guard = tabGuard(box.orca.cli, { env: box.env });

  guard.orca(['terminal', 'close', '--terminal', owner[0], '--tab']);
  assert.ok(openNow(box).has(owner[0]), 'the fake should still list the tab it was told to close');

  assert.deepEqual(guard.verdict(before), { closedNotOurs: [owner[0]], goneElsewhere: [] });
});

test('a tab the kit says it closed for the test counts as closed by the test', async (t) => {
  // `obk restart`, `pause` and `retire` close tabs themselves and say which in
  // their `closed` list; a kit run the test started that took an owner's tab is
  // the test's doing, not another process's.
  const { box, ours, owner, before } = await ownersMachine(t);
  const guard = tabGuard(box.orca.cli, { env: box.env });
  const mine = openOurs(guard, ours, 'mine');

  const tabIdOf = (handle) => elsewhere(box, ['terminal', 'show', '--terminal', handle]).terminal.tabId;
  const kitClosed = [
    { bot: 'example', name: 'daily', tabId: tabIdOf(mine), terminal: mine },
    { bot: 'example', name: 'weekly', tabId: tabIdOf(owner[1]), terminal: owner[1] },
  ];
  closeElsewhere(box, mine);
  closeElsewhere(box, owner[1]);
  guard.closedByKit(kitClosed);

  assert.deepEqual(guard.closed(), [mine, owner[1]]);
  assert.deepEqual(guard.verdict(before), { closedNotOurs: [owner[1]], goneElsewhere: [] });
});

test('a kit answer that closed nothing records nothing', async (t) => {
  const { box, ours, before } = await ownersMachine(t);
  const guard = tabGuard(box.orca.cli, { env: box.env });
  const mine = openOurs(guard, ours, 'mine');

  guard.closedByKit(undefined);
  guard.closedByKit([]);
  assert.deepEqual(guard.closed(), []);

  // And the guard still records what does come after.
  guard.orca(['terminal', 'close', '--terminal', mine, '--tab']);
  assert.deepEqual(guard.closed(), [mine]);
  assert.deepEqual(guard.verdict(before), { closedNotOurs: [], goneElsewhere: [] });
});

test('closed() gives every close the test made, on both roads, in the order made', async (t) => {
  const { box, ours } = await ownersMachine(t);
  const guard = tabGuard(box.orca.cli, { env: box.env });
  const first = openOurs(guard, ours, 'first');
  const second = openOurs(guard, ours, 'second');
  const third = openOurs(guard, ours, 'third');

  guard.orca(['terminal', 'close', '--terminal', second, '--tab']);
  closeElsewhere(box, third);
  guard.closedByKit([{ bot: 'example', name: 'daily', tabId: 'tab_x', terminal: third }]);
  guard.orca(['terminal', 'close', '--terminal', first, '--tab']);

  assert.deepEqual(guard.closed(), [second, third, first]);
});

test('the guard refuses the blanket close without running it', async (t) => {
  const { box, ours, owner } = await ownersMachine(t);
  const guard = tabGuard(box.orca.cli, { env: box.env });
  const callsBefore = (await box.orca.calls()).length;

  for (const args of [
    ['terminal', 'close', '--worktree', `path:${ours}`, '--all'],
    ['terminal', 'close', '--all', '--worktree', `path:${box.path('owner-project')}`],
  ]) {
    assert.throws(() => guard.orca(args), assert.AssertionError, `orca ${args.join(' ')} should be refused`);
  }

  assert.equal((await box.orca.calls()).length, callsBefore, 'nothing should have reached Orca');
  assert.deepEqual([...openNow(box)].sort(), [...owner].sort(), 'every tab should still be open');
});

test('orca() runs the call with --json and gives back Orca\'s whole answer, refusals included', async (t) => {
  const { box, owner } = await ownersMachine(t);
  const guard = tabGuard(box.orca.cli, { env: box.env });

  const listed = guard.orca(['terminal', 'list']);
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.result.terminals.map((terminal) => terminal.handle).sort(), [...owner].sort());
  assert.deepEqual((await box.orca.calls()).at(-1).args, ['terminal', 'list', '--json']);

  // A refusal is Orca's answer to read, not a crash of the guard.
  const refused = guard.orca(['terminal', 'show', '--terminal', 'term_none']);
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, 'terminal_not_found');
});

test('verdict() takes the handles open before as an array as well as a Set', async (t) => {
  const { box, owner, before } = await ownersMachine(t);
  const guard = tabGuard(box.orca.cli, { env: box.env });

  guard.orca(['terminal', 'close', '--terminal', owner[0], '--tab']);
  closeElsewhere(box, owner[2]);

  assert.deepEqual(guard.verdict([...before]), { closedNotOurs: [owner[0]], goneElsewhere: [owner[2]] });
});

// The review of PR #425: a teardown closed every tab at its homes that was not
// open before the run, so a stranger's tab opened there meanwhile went too.
// `closeOwnAt(homes)` is the teardown's close: it closes the test's own tabs
// at those homes, one by one by handle, and names every other tab it finds
// there instead of closing it.
test('closeOwnAt closes the test\'s own tabs at its homes, and names a stranger\'s there without closing it', async (t) => {
  const { box, ours, owner, before } = await ownersMachine(t);
  const guard = tabGuard(box.orca.cli, { env: box.env });
  const mine = openOurs(guard, ours, 'mine');
  const kits = openElsewhere(box, ours, 'Example daily');
  guard.openedByKit({ tabs: [kitTab(kits, true)] });
  const stranger = openElsewhere(box, ours, 'stranger');

  const { closed, foreign } = guard.closeOwnAt([ours]);

  assert.deepEqual([...closed].sort(), [mine, kits].sort(), 'the test\'s own two tabs, the one it opened and the one the kit said it opened');
  assert.deepEqual(foreign, [{ home: ours, handle: stranger }], 'the stranger\'s tab is named, with the home it is at');
  const open = openNow(box);
  assert.ok(open.has(stranger), 'and it is still open');
  assert.ok(!open.has(mine) && !open.has(kits), 'while the test\'s own are gone');
  assert.ok(owner.every((handle) => open.has(handle)), 'and the owner\'s tabs in their own project are untouched');
  assert.deepEqual(guard.verdict(before), { closedNotOurs: [], goneElsewhere: [] });
});

test('closeOwnAt leaves the test\'s own tabs at other homes alone, and finds nothing foreign where there is nothing', async (t) => {
  const { box, ours, before } = await ownersMachine(t);
  const guard = tabGuard(box.orca.cli, { env: box.env });
  const other = box.path('other-project');
  elsewhere(box, ['repo', 'add', '--path', other]);
  const here = openOurs(guard, ours, 'here');
  const there = openOurs(guard, other, 'there');

  const { closed, foreign } = guard.closeOwnAt([ours]);

  assert.deepEqual(closed, [here]);
  assert.deepEqual(foreign, []);
  assert.ok(openNow(box).has(there), 'a home not named is not swept');
  assert.deepEqual(guard.verdict(before), { closedNotOurs: [], goneElsewhere: [] });
});
