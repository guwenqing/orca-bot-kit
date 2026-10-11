// The Escape of `obk message send --interrupt` waits its turn, and looks once
// more at a stale handle (#555, after the reviewer's ask). These are the cases
// typing-turn.test.js (#480) and message-nudge-stale.test.js (#294) had for the
// nudge, now for the Escape.
//
//   T   The Escape is a key typed into the receiver's tab, so it takes the
//       receiver's typing turn first, waiting for it 5 s at most:
//       (a) the turn held for longer than that: no Escape, the letter is
//           posted, and the output says why there was no interrupt;
//       (b) the turn let go within the 5 s: the Escape goes;
//       (c) another session's typing turn held does not hold it up.
//   S   Orca refuses the look before the Escape with `terminal_handle_stale`:
//       the tab is listed afresh and looked at once more. A good second look
//       lets the Escape go, by the handle the fresh listing gives. A second
//       refusal is not tried again: no Escape, the letter is posted, and the
//       output says why. Any other refusal earns no second look.
//
// Every run is in the sandbox (helpers/cli.js): its own HOME and TMPDIR, a
// fake Orca, a fake ps. Nothing here reaches the real Orca or a real harness.

import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';

import {
  createSandbox,
  orcaCallsOf,
  orcaCommand,
  orcaFlag,
  sessionIn,
} from './helpers/cli.js';
import { withTypingTurnHeld } from './helpers/typing-turn.js';

/** The one key an interrupt is. */
const ESCAPE = '\x1b';

/** What the output says of an interrupt that was not done. */
const NOT_INTERRUPTED = /interrupt|escape/i;

/** Orca's refusal as it came back live: the code, and the code again as the message. */
const STALE = { code: 'terminal_handle_stale', message: 'terminal_handle_stale' };

/**
 * A Claude bot `writer` with `daily`, and a Codex bot `coder` with `daily` and
 * `nightly`, all up, with coder/daily's harness busy: Orca's tui-idle wait for
 * its tab times out. Returns the bots folder and coder/daily's tab and handle.
 */
async function fleetIn(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  for (const [bot, harness, sessions] of [['writer', 'claude', ['daily']], ['coder', 'codex', ['daily', 'nightly']]]) {
    assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness])).code, 0);
    for (const session of sessions) {
      assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', session])).code, 0);
    }
  }
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  const bots = box.path('bots');
  const tab = (await sessionIn(bots, 'coder', 'daily'))?.tab;
  assert.equal(typeof tab, 'string', 'the premise: coder/daily has a tab');
  const terminals = await box.orca.terminals();
  const reader = terminals.find((one) => one.tabId === tab);
  assert.ok(reader, `the premise: Orca has the tab ${tab}`);
  await box.orca.set({ terminals: terminals.map((one) => (one.tabId === tab ? { ...one, tuiIdle: 'busy' } : one)) });
  return { bots, tab, handle: reader.handle };
}

/** Send one letter from writer/daily to coder/daily with --interrupt, plain output. */
const send = (box) => box.run([
  'message', 'send', '--bots', 'bots', '--to', 'coder/daily', '--from', 'writer/daily',
  '--subject', 'the staging host', '--text', 'It is down again.', '--interrupt',
]);

/** Exit 0, and the letter is in the mailbox, once. */
async function assertPosted(box, result) {
  assert.equal(result.code, 0, `the letter went whatever became of the interrupt: ${result.stdout}${result.stderr}`);
  const queued = await box.orca.messages();
  assert.equal(queued.length, 1, `one letter in the mailbox, got: ${JSON.stringify(queued)}`);
  assert.equal(queued[0].subject, 'the staging host');
}

/** The `terminal send` calls among `calls`. */
const typedIn = (calls) => orcaCallsOf(calls, 'terminal send');

/** Exactly one Escape, into `handle`, with no Enter, before the post; nothing else typed. */
function assertOneEscape(calls, handle, what) {
  const typed = typedIn(calls);
  assert.equal(typed.length, 1, `${what}: one terminal send, the Escape, got: ${JSON.stringify(typed.map((call) => call.args))}`);
  const [escape] = typed;
  assert.equal(orcaFlag(escape, '--terminal'), handle, `${what}: into the receiver's tab, got: ${JSON.stringify(escape.args)}`);
  assert.equal(orcaFlag(escape, '--text'), ESCAPE, `${what}: the text is one Escape, got: ${JSON.stringify(escape.args)}`);
  assert.ok(!escape.args.includes('--enter'), `${what}: with no Enter, got: ${JSON.stringify(escape.args)}`);
  const postedAt = calls.map(orcaCommand).indexOf('orchestration send');
  assert.ok(postedAt >= 0 && calls.indexOf(escape) < postedAt, `${what}: the Escape comes before the post, got: ${JSON.stringify(calls.map(orcaCommand))}`);
}

/** No `terminal send` call at all. */
function assertNoEscape(calls, what) {
  assert.deepEqual(typedIn(calls).map((call) => call.args), [], `${what}: nothing is typed, no Escape`);
}

/** Run `body` and give back its result with the Orca calls made while it ran. */
async function callsDuring(box, body) {
  const before = (await box.orca.calls()).length;
  const result = await body();
  return { ...result, calls: (await box.orca.calls()).slice(before) };
}

// ------------------------------------------------------------- T: the typing turn

test('T(a) the receiver\'s typing turn held for longer than 5 s: no Escape, the letter is posted, and the output says why there was no interrupt', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);

  const started = Date.now();
  const result = await withTypingTurnHeld(fleet.bots, 'coder', 'daily', () => callsDuring(box, () => send(box)));
  const took = Date.now() - started;

  await assertPosted(box, result);
  assertNoEscape(result.calls, 'the typing turn held');
  assert.match(result.stdout, NOT_INTERRUPTED, `the output speaks of the interrupt, got:\n${result.stdout}`);
  assert.match(result.stdout, /typing/i, `and says the kit is typing into the tab, got:\n${result.stdout}`);
  assert.ok(took >= 4_000, `it waited for the turn, up to 5 s, before giving up; it took ${took} ms`);
  assert.ok(took < 30_000, `and the wait is bounded; it took ${took} ms`);
});

test('T(b) the receiver\'s typing turn let go within the 5 s: the Escape goes', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);

  const result = await withTypingTurnHeld(fleet.bots, 'coder', 'daily', (release) => callsDuring(box, async () => {
    const run = send(box);
    await sleep(1_500);
    release();
    return run;
  }));

  await assertPosted(box, result);
  assertOneEscape(result.calls, fleet.handle, 'the turn let go');
});

test('T(c) another session\'s typing turn held does not hold up the Escape', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);

  const result = await withTypingTurnHeld(fleet.bots, 'coder', 'nightly', () => callsDuring(box, () => send(box)));

  await assertPosted(box, result);
  assertOneEscape(result.calls, fleet.handle, 'nightly\'s turn held');
});

// ------------------------------------------------------------- S: a stale handle (#294)

/**
 * Make the next `times` calls of `terminal wait` be refused with `refusal`, or
 * every one after now when `times` is left out. Counted from the calls made so
 * far, since `up` makes them too.
 */
async function refuseLooks(box, refusal, times) {
  const after = orcaCallsOf(await box.orca.calls(), 'terminal wait').length;
  await box.orca.set({ fail: { 'terminal wait': { ...refusal, after, ...(times === undefined ? {} : { times }) } } });
}

test('S a look refused as a stale handle is looked at once more after a fresh listing, and the Escape goes', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await refuseLooks(box, STALE, 1);

  const result = await callsDuring(box, () => send(box));

  await assertPosted(box, result);
  const waits = result.calls.flatMap((call, at) => (orcaCommand(call) === 'terminal wait' ? [at] : []));
  assert.ok(waits.length >= 2, `two looks, got: ${JSON.stringify(result.calls.map((call) => call.args))}`);
  assert.ok(
    result.calls.slice(waits[0] + 1, waits[1]).some((call) => orcaCommand(call) === 'terminal list'),
    `the tab is listed afresh between the refused look and the next, got: ${JSON.stringify(result.calls.map((call) => call.args))}`,
  );
  assertOneEscape(result.calls, fleet.handle, 'after one stale refusal');
});

test('S the second look and the Escape use the handle the fresh listing gives', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await refuseLooks(box, STALE, 1);
  await box.orca.set({ reissue: { [fleet.handle]: 'term_90' } });

  const result = await callsDuring(box, () => send(box));

  await assertPosted(box, result);
  const looks = orcaCallsOf(result.calls, 'terminal wait').map((call) => orcaFlag(call, '--terminal'));
  assert.ok(looks.length >= 2, `the refused look and one more, got: ${JSON.stringify(looks)}`);
  assert.deepEqual(looks, [fleet.handle, ...looks.slice(1).map(() => 'term_90')], 'the first look by the handle first listed, every one after it by the new one');
  assertOneEscape(result.calls, 'term_90', 'by the re-issued handle');
});

test('S a second stale refusal is not tried again: no Escape, the letter is posted, and the output says why', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);
  await refuseLooks(box, STALE);

  const result = await callsDuring(box, () => send(box));

  await assertPosted(box, result);
  assert.equal(orcaCallsOf(result.calls, 'terminal wait').length, 2, 'one look, one more after a fresh listing, and no third');
  assertNoEscape(result.calls, 'two stale refusals');
  assert.match(result.stdout, NOT_INTERRUPTED, `the output speaks of the interrupt, got:\n${result.stdout}`);
  assert.match(result.stdout, /stale/i, `and gives Orca's refusal, got:\n${result.stdout}`);
});

test('S a refusal other than a stale handle earns no second look: no Escape, and the output says why', async (t) => {
  // The refusal goes away after one call, so a kit that looked again on any
  // refusal would get through and press Escape; only a stale handle earns that.
  const box = await createSandbox(t);
  await fleetIn(box);
  await refuseLooks(box, { code: 'runtime_error', message: 'the renderer did not answer' }, 1);

  const result = await callsDuring(box, () => send(box));

  await assertPosted(box, result);
  assert.equal(orcaCallsOf(result.calls, 'terminal wait').length, 1, 'one look and no second');
  assertNoEscape(result.calls, 'a refusal that is not stale');
  assert.match(result.stdout, /the renderer did not answer/, `Orca's refusal, in its words, got:\n${result.stdout}`);
});
