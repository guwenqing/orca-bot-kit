// A nudge whose look Orca refuses as a stale handle (#294).
//
// Seen live five times on Orca 1.4.209: `obk message send` listed the
// receiver's tab, and Orca refused the `terminal wait` on the handle it had
// just given with `terminal_handle_stale`. Minutes later the same handle was
// listed again and worked. It comes and goes, and read in Orca's bundle, a
// `terminal list` re-issues a handle at the tab's current state. So one fresh
// listing and one more look is what a stale handle earns: the mail was queued
// either way, and a session that is idle should still be told it is there.
//
// One more look, not a loop: a second refusal is reported the way any refusal
// is, and every other refusal is reported after the first look, as before. And
// the rules the nudge already keeps hold on the second look as on the first:
// only the receiver's tab, and nothing typed into a tab with a question of its
// own or a shell in front.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSandbox,
  orcaCallsOf,
  orcaCommand,
  orcaFlag,
  sessionIn,
  typedInto,
} from './helpers/cli.js';

/** Orca's refusal as it came back live: the code, and the code again as the message. */
const STALE = { code: 'terminal_handle_stale', message: 'terminal_handle_stale' };

/** A Claude bot that writes and a Codex bot that reads, both up, nothing typed since. */
async function fleetIn(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  for (const [bot, harness] of [['writer', 'claude'], ['coder', 'codex']]) {
    assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness])).code, 0);
    assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', 'daily'])).code, 0);
  }
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  return box.path('bots');
}

/** Send one message from the writer to the reader, and read the answer. */
async function send(box) {
  const result = await box.run([
    'message', 'send', '--bots', 'bots', '--to', 'coder', '--from', 'writer/daily',
    '--subject', 'the staging host', '--text', 'It is down again.', '--json',
  ]);
  assert.equal(result.code, 0, `the message went whatever became of the nudge: ${result.stdout}${result.stderr}`);
  return JSON.parse(result.stdout);
}

/** How many times `terminal wait` has been called so far: where a refusal set now starts counting. */
const waitsSoFar = async (box) => orcaCallsOf(await box.orca.calls(), 'terminal wait').length;

/** Make the next `times` looks be refused with `refusal`, or every one after now when `times` is left out. */
async function refuseLooks(box, refusal, times) {
  await box.orca.set({
    fail: { 'terminal wait': { ...refusal, after: await waitsSoFar(box), ...(times === undefined ? {} : { times }) } },
  });
}

/** The Orca calls `message send` made: everything after the first `before` calls. */
const callsSince = async (box, before) => (await box.orca.calls()).slice(before);

/** What was typed into every tab of the whole fleet, after the launch line each one got. */
async function typedSinceLaunch(box) {
  const after = {};
  for (const terminal of await box.orca.terminals()) {
    after[terminal.tabId] = typedInto(terminal).slice(1);
  }
  return after;
}

/** The reader's tab id, as the book has it, and its handle, as Orca has it now. */
async function readerTab(box, bots) {
  const tab = (await sessionIn(bots, 'coder', 'daily')).tab;
  const handle = (await box.orca.terminals()).find((terminal) => terminal.tabId === tab).handle;
  return { tab, handle };
}

test('a look refused as a stale handle is tried once more after a fresh listing, and the tab is told', async (t) => {
  // The case seen live: the handle string stays the same, and the second look
  // with it works.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const reader = await readerTab(box, bots);
  await refuseLooks(box, STALE, 1);
  const before = (await box.orca.calls()).length;

  const answer = await send(box);

  assert.equal(answer.nudged, true, `the tab should have been told, got: ${JSON.stringify(answer)}`);
  assert.equal((await box.orca.messages()).length, 1, 'the message is in the mailbox');

  const calls = await callsSince(box, before);
  const waits = calls.flatMap((call, at) => (orcaCommand(call) === 'terminal wait' ? [at] : []));
  assert.equal(waits.length, 2, `two looks, got: ${JSON.stringify(calls.map((call) => call.args))}`);
  assert.deepEqual(waits.map((at) => orcaFlag(calls[at], '--terminal')), [reader.handle, reader.handle], 'both at the receiver\'s tab');
  assert.ok(
    calls.slice(waits[0] + 1, waits[1]).some((call) => orcaCommand(call) === 'terminal list'),
    `the tab is listed afresh between the refused look and the next, got: ${JSON.stringify(calls.map((call) => call.args))}`,
  );

  const typed = await typedSinceLaunch(box);
  assert.equal(typed[reader.tab].length, 1, `one line into the receiver's tab, got: ${JSON.stringify(typed[reader.tab])}`);
  assert.ok(typed[reader.tab][0].includes('the staging host'), `the nudge as ever, got: ${typed[reader.tab][0]}`);
  assert.ok(typed[reader.tab][0].includes('message check --bots '), `the nudge as ever, got: ${typed[reader.tab][0]}`);
  for (const [tab, lines] of Object.entries(typed)) {
    if (tab === reader.tab) continue;
    assert.deepEqual(lines, [], `nothing may be typed into ${tab}: it is not the receiver's`);
  }
});

test('the second look is made with the handle the fresh listing gives, and so is the line', async (t) => {
  // Orca usually re-issues the same string, but it is the listing's handle
  // that is good, not the one that was just refused.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const reader = await readerTab(box, bots);
  await refuseLooks(box, STALE, 1);
  await box.orca.set({ reissue: { [reader.handle]: 'term_90' } });
  const before = (await box.orca.calls()).length;

  const answer = await send(box);

  assert.equal(answer.nudged, true, `the tab should have been told, got: ${JSON.stringify(answer)}`);
  const calls = await callsSince(box, before);
  assert.deepEqual(
    orcaCallsOf(calls, 'terminal wait').map((call) => orcaFlag(call, '--terminal')),
    [reader.handle, 'term_90'],
    'the first look with the handle first listed, the second with the one listed after the refusal',
  );
  assert.deepEqual(
    orcaCallsOf(calls, 'terminal send').map((call) => orcaFlag(call, '--terminal')),
    ['term_90'],
    'and the line goes to the tab by its new handle',
  );
  const typed = await typedSinceLaunch(box);
  assert.equal(typed[reader.tab].length, 1, `one line into the receiver's tab, got: ${JSON.stringify(typed[reader.tab])}`);
});

test('a second stale refusal is reported plainly, and there is no third look', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);
  await refuseLooks(box, STALE);
  const before = (await box.orca.calls()).length;

  const answer = await send(box);

  assert.equal((await box.orca.messages()).length, 1, 'the message is in the mailbox');
  assert.equal(answer.nudged, false);
  assert.match(answer.nudgeTrouble ?? '', /terminal_handle_stale/, `Orca's refusal, in its words, got: ${JSON.stringify(answer)}`);
  assert.equal(
    orcaCallsOf(await callsSince(box, before), 'terminal wait').length,
    2,
    'one look, one more after a fresh listing, and no more than that',
  );
  assert.deepEqual(Object.values(await typedSinceLaunch(box)).flat(), [], 'and nothing was typed anywhere');
});

test('a refusal other than a stale handle is reported after one look, as before', async (t) => {
  // The refusal goes away after one call here, so a kit that looked again on
  // any refusal would get through and type; only a stale handle earns that.
  const box = await createSandbox(t);
  await fleetIn(box);
  await refuseLooks(box, { code: 'runtime_error', message: 'the renderer did not answer' }, 1);
  const before = (await box.orca.calls()).length;

  const answer = await send(box);

  assert.equal((await box.orca.messages()).length, 1, 'the message is in the mailbox');
  assert.equal(answer.nudged, false);
  assert.match(answer.nudgeTrouble ?? '', /the renderer did not answer/, `Orca's refusal, in its words, got: ${JSON.stringify(answer)}`);
  assert.equal(orcaCallsOf(await callsSince(box, before), 'terminal wait').length, 1, 'one look and no second');
  assert.deepEqual(Object.values(await typedSinceLaunch(box)).flat(), [], 'and nothing was typed anywhere');
});

for (const [what, found] of [
  ['a question of its own', 'blocked'],
  ['a shell in front, the harness gone', false],
]) {
  test(`a tab found with ${what} on the second look is not typed into`, async (t) => {
    // The first look is refused as stale and the second one goes through, so
    // the tab is judged on what that second look finds, by the same rules as a
    // first look. A harness is in front up to the refusal; what the second look
    // finds is the tab as it is now.
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    const reader = await readerTab(box, bots);
    await box.orca.set({ waitIdle: [true, found] });
    await refuseLooks(box, STALE, 1);
    const before = (await box.orca.calls()).length;

    const answer = await send(box);

    assert.equal((await box.orca.messages()).length, 1, 'the message is in the mailbox');
    assert.deepEqual(
      orcaCallsOf(await callsSince(box, before), 'terminal wait').map((call) => orcaFlag(call, '--terminal')),
      [reader.handle, reader.handle],
      'the tab was looked at again after the stale refusal',
    );
    assert.equal(answer.nudged, false, `nothing to be typed, got: ${JSON.stringify(answer)}`);
    assert.deepEqual(Object.values(await typedSinceLaunch(box)).flat(), [], 'and nothing was typed anywhere');
  });
}
