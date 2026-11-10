// A retire finishes when Orca still lists a closed tab whose process is gone
// (#733). On Orca 1.4.255 a closed tab could stay listed for minutes as
// `connected: false, orphaned: false` after its harness had stopped, and
// `obk temp retire` refused, pointing at `obk up`. The architect's ruling:
//
//   R1  For a retire only (`obk retire --session`, `obk temp retire`, and
//       `obk retire` of a whole bot): a closed tab that Orca still lists after
//       the kit's wait counts as gone when both hold: (a) `terminal list` lists
//       that tab with `connected: false`, and (b) `diagnostics memory` lists no
//       session whose `sessionId` is that tab's pty. The row is matched by the
//       tab the kit closed and by its pty, never by a title. Then the retire
//       finishes as a retire does: off bot.yaml, the book entry under
//       `retired`, exit 0.
//   R3  The refusal of a retire tells the user to run the same retire again
//       once Orca has caught up. It names no `obk up` (` up --bots`). It still
//       names the tab it is waiting on.
//   R5  Orca versions that work today keep working: a close that the listing
//       agrees with in time retires as before.
//
// R2 (what still refuses) is in retire-closed-tab-refused.test.js, and R4
// (restart and pause unchanged) in restart-pause-closed-tab.test.js.
//
// The lingering row is the fake's `closeLag` with `closingAs`
// (helpers/fake-orca.js). The kit's wait is 5 seconds of real time, so each
// test of a tab that stays listed takes about that long.
//
// Every run is in the sandbox (helpers/cli.js): its own HOME, a fake Orca, and
// fake harnesses on its own PATH. Nothing here reaches the real Orca or a real
// harness.

import assert from 'node:assert/strict';
import test from 'node:test';

import { botHomeOf, createSandbox } from './helpers/cli.js';
import {
  BOT,
  assertNotRetired,
  assertRetired,
  assertWaitRefusal,
  callCount,
  closedSince,
  closesLinger,
  exists,
  fleet,
  liveTab,
  reported,
  retire,
  retiredHome,
  tempMade,
  tempRetire,
} from './helpers/closed-tab.js';

/** The pane is gone: listed disconnected, and no pty for it in `diagnostics memory`. */
const PANE_GONE = { connected: false, ptyLive: false };

/** Whether a message points the user at `obk up`. */
const NAMES_UP = /\sup\s+--bots\b/;

// ------------------------------------------------------------------ R1

test('R1 obk retire --session finishes when Orca still lists the closed tab disconnected with no pty, and leaves the sibling running', async (t) => {
  // The sibling, ops, is up in the same project, so `diagnostics memory`
  // still lists a session there: only builder's own pty is gone. A kit that
  // asked whether the project has any live pane, rather than this tab's pty,
  // would refuse here.
  const box = await createSandbox(t);
  const bots = await fleet(box, ['builder', 'ops']);
  const builder = await liveTab(box, bots, 'builder');
  const ops = await liveTab(box, bots, 'ops');
  await closesLinger(box, PANE_GONE);
  const from = await callCount(box);

  const result = await retire(box, '--session', 'builder');

  assert.equal(result.code, 0, `the retire should finish, got:\n${result.stdout}${result.stderr}`);
  assert.deepEqual(await closedSince(box, from), [builder.handle], 'one close, of builder\'s tab by its own handle');
  await assertRetired(bots, 'builder');
  await assertNotRetired(bots, 'ops', ops.tabId);
});

test('R1 obk temp retire finishes when Orca still lists the closed tab disconnected with no pty, and the maker stays', async (t) => {
  // The case of the report: a finished temporary session retired by its maker,
  // whose own tab is live in the same project.
  const box = await createSandbox(t);
  const bots = await fleet(box, ['lead']);
  const lead = await liveTab(box, bots, 'lead');
  const scout = await tempMade(box, bots, 'lead', 'scout');
  await closesLinger(box, PANE_GONE);
  const from = await callCount(box);

  const result = await tempRetire(box, bots, 'lead', 'scout');

  assert.equal(result.code, 0, `the temp retire should finish, got:\n${result.stdout}${result.stderr}`);
  assert.deepEqual(await closedSince(box, from), [scout.handle], 'one close, of scout\'s tab by its own handle');
  await assertRetired(bots, 'scout');
  await assertNotRetired(bots, 'lead', lead.tabId);
});

test('R1 obk retire of a whole bot finishes when Orca still lists its closed tabs disconnected with no pty', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box, ['builder', 'ops']);
  const builder = await liveTab(box, bots, 'builder');
  const ops = await liveTab(box, bots, 'ops');
  await reported(box, bots, builder, 'sess-builder');
  await reported(box, bots, ops, 'sess-ops');
  const setup = (await box.orca.setups()).find((one) => one.path === botHomeOf(bots, BOT));
  assert.ok(setup, 'the premise: up made the bot an Orca project');
  await closesLinger(box, PANE_GONE);
  const from = await callCount(box);

  const result = await retire(box);

  assert.equal(result.code, 0, `the retire should finish, got:\n${result.stdout}${result.stderr}`);
  assert.deepEqual((await closedSince(box, from)).sort(), [builder.handle, ops.handle].sort(), 'each session\'s tab closed by its own handle');
  assert.equal(await exists(botHomeOf(bots, BOT)), false, 'the bot is gone from bots/');
  assert.equal(await exists(retiredHome(bots)), true, 'and its folder is under retired/');
  assert.equal((await box.orca.setups()).some((one) => one.id === setup.id), false, 'and its Orca project is deleted');
});

// ------------------------------------------------------------------ R3

test('R3 the refusal of obk retire --session names the tab and the retire to run again, and not obk up', async (t) => {
  // A plain lag: the fake lists the closed tab, unchanged, for the whole wait.
  const box = await createSandbox(t);
  const bots = await fleet(box, ['builder', 'ops']);
  const builder = await liveTab(box, bots, 'builder');
  await closesLinger(box);

  const result = await retire(box, '--session', 'builder');

  assertWaitRefusal(result, builder.tabId);
  assert.ok(/\bretire\b/.test(result.stderr), `the refusal should say to run the retire again, got: ${result.stderr}`);
  assert.ok(result.stderr.includes('builder'), `and name the session it retires, got: ${result.stderr}`);
  assert.ok(!NAMES_UP.test(result.stderr), `and not point at obk up, which brings a session back, got: ${result.stderr}`);
});

test('R3 the refusal of obk temp retire names the tab and the temp retire to run again, and not obk up', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box, ['lead']);
  const scout = await tempMade(box, bots, 'lead', 'scout');
  await closesLinger(box);

  const result = await tempRetire(box, bots, 'lead', 'scout');

  assertWaitRefusal(result, scout.tabId);
  assert.ok(/\btemp retire\b/.test(result.stderr), `the refusal should say to run the temp retire again, got: ${result.stderr}`);
  assert.ok(result.stderr.includes('scout'), `and name the session it retires, got: ${result.stderr}`);
  assert.ok(!NAMES_UP.test(result.stderr), `and not point at obk up, which brings a session back, got: ${result.stderr}`);
});

test('R3 the refusal of obk retire of a whole bot names the tab and the retire to run again, and not obk up', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box, ['builder']);
  const builder = await liveTab(box, bots, 'builder');
  await reported(box, bots, builder, 'sess-builder');
  await closesLinger(box);

  const result = await retire(box);

  assertWaitRefusal(result, builder.tabId);
  assert.ok(/\bretire\b/.test(result.stderr), `the refusal should say to run the retire again, got: ${result.stderr}`);
  assert.ok(!NAMES_UP.test(result.stderr), `and not point at obk up, which brings a session back, got: ${result.stderr}`);
  assert.equal(await exists(botHomeOf(bots, BOT)), true, 'and the bot is not moved');
});

// ------------------------------------------------------------------ R5

test('R5 obk retire --session still finishes when the listing catches up within the wait', async (t) => {
  // Two more listings carry the tab, unchanged, and then it is gone: the Orca
  // of every release before 1.4.255.
  const box = await createSandbox(t);
  const bots = await fleet(box, ['builder', 'ops']);
  const ops = await liveTab(box, bots, 'ops');
  await box.orca.set({ closeLag: 2 });

  const result = await retire(box, '--session', 'builder');

  assert.equal(result.code, 0, `the retire should finish, got:\n${result.stdout}${result.stderr}`);
  await assertRetired(bots, 'builder');
  await assertNotRetired(bots, 'ops', ops.tabId);
});

test('R5 obk temp retire still finishes when the listing catches up within the wait', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box, ['lead']);
  await tempMade(box, bots, 'lead', 'scout');
  await box.orca.set({ closeLag: 2 });

  const result = await tempRetire(box, bots, 'lead', 'scout');

  assert.equal(result.code, 0, `the temp retire should finish, got:\n${result.stdout}${result.stderr}`);
  await assertRetired(bots, 'scout');
});

test('R5 obk retire of a whole bot still finishes when the listing catches up within the wait', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box, ['builder']);
  await reported(box, bots, await liveTab(box, bots, 'builder'), 'sess-builder');
  await box.orca.set({ closeLag: 2 });

  const result = await retire(box);

  assert.equal(result.code, 0, `the retire should finish, got:\n${result.stdout}${result.stderr}`);
  assert.equal(await exists(retiredHome(bots)), true, 'the bot\'s folder is under retired/');
});

test('R5 a retire still finishes when the listing catches up, on an Orca that refuses diagnostics memory after the close', async (t) => {
  // A close the listing agrees with needs no look at the pane: an Orca whose
  // `diagnostics memory` is refused retires as it did. The refusal starts at
  // the close, so nothing before it is touched. The code and words are a
  // stand-in for an Orca that does not know the command, not seen live.
  const box = await createSandbox(t);
  const bots = await fleet(box, ['builder', 'ops']);
  await box.orca.set({
    closeLag: 2,
    closingAs: { connected: false },
    fail: { 'diagnostics memory': { code: 'invalid_argument', message: 'Unknown command: diagnostics memory', since: 'terminal close' } },
  });

  const result = await retire(box, '--session', 'builder');

  assert.equal(result.code, 0, `the retire should finish, got:\n${result.stdout}${result.stderr}`);
  await assertRetired(bots, 'builder');
});
