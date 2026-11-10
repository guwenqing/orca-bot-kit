// A retire still refuses when a closed tab that Orca still lists may hold a
// live harness (#733). The architect's ruling:
//
//   R2  A retire still refuses, as today, with nothing more retired, when the
//       closed tab is still listed after the wait and any of these is true:
//       the row says `connected: true`; the row says `connected: false` but
//       `diagnostics memory` still lists a session for its pty; or
//       `diagnostics memory` is refused, or answers something the kit cannot
//       read. That is "cannot tell", so the retire refuses.
//
// A retire never leaves a live harness behind: that is what these guard. R1,
// R3 and R5 are in retire-closed-tab.test.js. Most of these pass on the kit as
// it was before #733, which refused every closed tab still listed; they are
// guards that the change lets through only what R1 names.
//
// Each case below fails exactly one half of R1, so a kit that checked only the
// other half retires here. The lingering row is the fake's `closeLag` with
// `closingAs` (helpers/fake-orca.js). The kit's wait is 5 seconds of real time.
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

/**
 * api-bot with builder and ops up, the closed tab set to linger as
 * `closingAs` says and with `more` set on the fake, then `obk retire
 * --session builder`. Returns what a test checks.
 */
async function retireBuilder(t, closingAs, more = {}) {
  const box = await createSandbox(t);
  const bots = await fleet(box, ['builder', 'ops']);
  const builder = await liveTab(box, bots, 'builder');
  const ops = await liveTab(box, bots, 'ops');
  await closesLinger(box, closingAs);
  await box.orca.set(more);
  const from = await callCount(box);
  const result = await retire(box, '--session', 'builder');
  return { box, bots, builder, ops, from, result };
}

/** The refusal R2 asks for: builder's tab closed, the refusal names it, and nothing retired. */
async function assertRefusedNothingRetired({ box, bots, builder, ops, from, result }) {
  assertWaitRefusal(result, builder.tabId);
  assert.deepEqual(await closedSince(box, from), [builder.handle], 'the kit closed builder\'s tab, and only it, before it refused');
  await assertNotRetired(bots, 'builder', builder.tabId);
  await assertNotRetired(bots, 'ops', ops.tabId);
}

test('R2 a closed tab still listed connected: true stops obk retire --session, even with no pty in diagnostics', async (t) => {
  // Orca says the pane is connected. That `diagnostics memory` has no pty for
  // it does not outweigh that.
  await assertRefusedNothingRetired(await retireBuilder(t, { connected: true, ptyLive: false }));
});

test('R2 a closed tab still listed connected: false stops obk retire --session while diagnostics still lists its pty', async (t) => {
  // The pane's process is still there, so a harness may still run in it.
  await assertRefusedNothingRetired(await retireBuilder(t, { connected: false, ptyLive: true }));
});

test('R2 a closed tab still listed with no connected at all stops obk retire --session, even with no pty in diagnostics', async (t) => {
  // R1 (a) asks for `connected: false`. A row that does not say so is not a
  // row that says the pane is disconnected.
  await assertRefusedNothingRetired(await retireBuilder(t, { ptyLive: false }));
});

test('R2 an Orca that refuses diagnostics memory cannot tell, and obk retire --session refuses', async (t) => {
  // The refusal starts at the close, so nothing before it is touched. The code
  // and words are a stand-in for an Orca that does not know the command, not
  // seen live.
  await assertRefusedNothingRetired(await retireBuilder(t, { connected: false, ptyLive: false }, {
    fail: { 'diagnostics memory': { code: 'invalid_argument', message: 'Unknown command: diagnostics memory', since: 'terminal close' } },
  }));
});

test('R2 a diagnostics memory answer that is not JSON cannot tell, and obk retire --session refuses', async (t) => {
  // The kit makes no `diagnostics memory` call before the close in a session
  // retire (seen in calls.log for this road), so this answer reaches only the
  // check after it. The close is asserted, so a refusal before it fails here.
  await assertRefusedNothingRetired(await retireBuilder(t, { connected: false, ptyLive: false }, {
    garbage: { command: 'diagnostics memory', text: 'diagnostics: the memory sampler is not ready\n' },
  }));
});

test('R2 a diagnostics memory answer with no list of worktrees cannot tell, and obk retire --session refuses', async (t) => {
  // An ok answer in a shape the kit does not know: no session can be read
  // from it, which is not the same as no session there.
  await assertRefusedNothingRetired(await retireBuilder(t, { connected: false, ptyLive: false }, {
    answerAs: { command: 'diagnostics memory', result: { sampler: 'not ready' } },
  }));
});

test('R2 a diagnostics memory answer with an empty list of worktrees cannot tell, and obk retire --session refuses', async (t) => {
  // Read in Orca 1.4.255's source: a snapshot that failed is answered ok with
  // `worktrees: []`. That cannot be told from a machine with no terminal at
  // all, and here the sibling, ops, is still up, so a true answer would list
  // it. The rest of the answer is in the shape of the failed snapshot.
  await assertRefusedNothingRetired(await retireBuilder(t, { connected: false, ptyLive: false }, {
    answerAs: {
      command: 'diagnostics memory',
      result: { app: { cpu: 0, memory: 0 }, worktrees: [], host: { cpu: 0, memory: 0 }, totalCpu: 0, totalMemory: 0, collectedAt: 1790251200000 },
    },
  }));
});

test('R2 a closed tab still listed connected: false stops obk temp retire while diagnostics still lists its pty', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box, ['lead']);
  const lead = await liveTab(box, bots, 'lead');
  const scout = await tempMade(box, bots, 'lead', 'scout');
  await closesLinger(box, { connected: false, ptyLive: true });
  const from = await callCount(box);

  const result = await tempRetire(box, bots, 'lead', 'scout');

  assertWaitRefusal(result, scout.tabId);
  assert.deepEqual(await closedSince(box, from), [scout.handle], 'the kit closed scout\'s tab, and only it, before it refused');
  await assertNotRetired(bots, 'scout', scout.tabId);
  await assertNotRetired(bots, 'lead', lead.tabId);
});

test('R2 obk retire of a whole bot refuses when one closed tab is gone by R1 and the other is still listed connected', async (t) => {
  // builder's row meets R1; ops's row, by a closingAs of its own, says the
  // pane is still connected. The bot is not retired, and the refusal names
  // the tab it still waits on.
  const box = await createSandbox(t);
  const bots = await fleet(box, ['builder', 'ops']);
  const builder = await liveTab(box, bots, 'builder');
  const ops = await liveTab(box, bots, 'ops');
  await reported(box, bots, builder, 'sess-builder');
  await reported(box, bots, ops, 'sess-ops');
  const setup = (await box.orca.setups()).find((one) => one.path === botHomeOf(bots, BOT));
  assert.ok(setup, 'the premise: up made the bot an Orca project');
  await closesLinger(box, { connected: false, ptyLive: false });
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((one) => (one.handle === ops.handle ? { ...one, closingAs: { connected: true, ptyLive: true } } : one)),
  });
  const from = await callCount(box);

  const result = await retire(box);

  assertWaitRefusal(result, ops.tabId);
  assert.deepEqual((await closedSince(box, from)).sort(), [builder.handle, ops.handle].sort(), 'both tabs were asked to close');
  assert.equal(await exists(botHomeOf(bots, BOT)), true, 'the bot stays in bots/');
  assert.equal(await exists(retiredHome(bots)), false, 'and is not moved under retired/');
  assert.equal((await box.orca.setups()).some((one) => one.id === setup.id), true, 'and its Orca project is not deleted');
});
