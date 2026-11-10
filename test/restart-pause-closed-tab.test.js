// Restart and pause still stop on a closed tab that Orca still lists (#733).
// The architect's ruling:
//
//   R4  `obk restart` and `obk pause` are unchanged: a closed tab still listed
//       after the wait, even `connected: false` with no session for its pty in
//       `diagnostics memory`, still stops them as today, and a restart opens
//       nothing in its place. Their refusal text may stay as it is.
//
// The retire treats that row as gone (R1, retire-closed-tab.test.js); these
// guard that the change reaches no further. A restart starts a harness in the
// session's place, and a tab on its way out is not a tab to start one in.
// These pass on the kit as it was before #733.
//
// The lingering row is the fake's `closeLag` with `closingAs`
// (helpers/fake-orca.js). The kit's wait is 5 seconds of real time.
//
// Every run is in the sandbox (helpers/cli.js): its own HOME, a fake Orca, and
// fake harnesses on its own PATH. Nothing here reaches the real Orca or a real
// harness.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSandbox, sessionIn } from './helpers/cli.js';
import {
  BOT,
  assertWaitRefusal,
  callCount,
  closedSince,
  closesLinger,
  createdSince,
  fleet,
  liveTab,
  reported,
} from './helpers/closed-tab.js';

/** The pane is gone: listed disconnected, and no pty for it in `diagnostics memory`. */
const PANE_GONE = { connected: false, ptyLive: false };

test('R4 obk restart still stops, and opens nothing, when the closed tab is still listed disconnected with no pty', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box, ['builder']);
  const builder = await liveTab(box, bots, 'builder');
  await reported(box, bots, builder, 'sess-builder');
  await closesLinger(box, PANE_GONE);
  const from = await callCount(box);

  const result = await box.run(['restart', '--bots', 'bots', '--bot', BOT]);

  assertWaitRefusal(result, builder.tabId);
  assert.deepEqual(await closedSince(box, from), [builder.handle], 'it asked for the close');
  assert.deepEqual(await createdSince(box, from), [], 'and opened nothing in the tab\'s place');
  assert.equal((await sessionIn(bots, BOT, 'builder'))?.session, 'sess-builder', 'and the conversation is still in the book');
});

test('R4 obk restart --session still stops, and opens nothing, when the closed tab is still listed disconnected with no pty', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box, ['builder', 'ops']);
  const builder = await liveTab(box, bots, 'builder');
  await reported(box, bots, builder, 'sess-builder');
  await closesLinger(box, PANE_GONE);
  const from = await callCount(box);

  const result = await box.run(['restart', '--bots', 'bots', '--bot', BOT, '--session', 'builder']);

  assertWaitRefusal(result, builder.tabId);
  assert.deepEqual(await closedSince(box, from), [builder.handle], 'it asked for the close of builder\'s tab alone');
  assert.deepEqual(await createdSince(box, from), [], 'and opened nothing in the tab\'s place');
});

test('R4 obk pause still stops when the closed tab is still listed disconnected with no pty', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box, ['builder', 'ops']);
  const builder = await liveTab(box, bots, 'builder');
  await reported(box, bots, builder, 'sess-builder');
  await closesLinger(box, PANE_GONE);
  const from = await callCount(box);

  const result = await box.run(['pause', '--bots', 'bots', '--bot', BOT, '--session', 'builder']);

  assertWaitRefusal(result, builder.tabId);
  assert.deepEqual(await closedSince(box, from), [builder.handle], 'it asked for the close of builder\'s tab alone');
  assert.deepEqual(await createdSince(box, from), [], 'and opened nothing');
});
