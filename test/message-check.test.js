// `obk message check`: a session reading its own mail.
//
// Nothing in the mailbox reaches a running harness by itself — proved live, a
// message addressed to the tab of a running Claude session left its screen
// untouched — so the mailbox is pull-only and this command is the pull.
//
// Two facts about Orca's own mailbox shape what it has to do (tech notes,
// section 1). Reading a Run is fenced to one bound reader: a caller bound
// somewhere else is refused with `consumer_fenced`, so the command binds to
// the session's own Run first. And a message is replayed on every read until
// it is acknowledged, so a check that reads and does not acknowledge would
// hand the same mail over for ever. `--peek` is the deliberate version of
// that: look without taking it.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertOrcaCallsAllowed,
  assertRefused,
  createSandbox,
  orcaCallsOf,
  orcaFlag,
  sessionIn,
} from './helpers/cli.js';

/** A bots folder with a Claude bot that writes and a Codex bot that reads, both up. */
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

/** Put one message in the Codex bot's mailbox, from the Claude bot. */
async function sendTo(box, { subject = 'the staging host', text = 'It is down again.' } = {}) {
  const sent = await box.run([
    'message', 'send', '--bots', 'bots', '--to', 'coder', '--from', 'writer/daily',
    '--subject', subject, '--text', text,
  ]);
  assert.equal(sent.code, 0, sent.stderr);
}

/** `obk message check` for one session. */
const check = (box, args = []) => box.run(['message', 'check', '--bots', 'bots', '--bot', 'coder', '--session', 'daily', ...args]);

/** What the fake mailbox still holds unacknowledged. */
const unacked = async (box) => (await box.orca.messages()).filter((message) => !message.acked);

test('a check reads what is waiting: who it is from, what it is about and what it says', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);
  await sendTo(box, { subject: 'the staging host', text: 'It is down again.' });

  const result = await check(box);

  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout.includes('the staging host'), `the subject should be there, got: ${result.stdout}`);
  assert.ok(result.stdout.includes('It is down again.'), `and what it says, got: ${result.stdout}`);
  assert.ok(
    result.stdout.includes('writer'),
    `and who wrote it, or there is nobody to answer: ${result.stdout}`,
  );
});

test('a check binds to the session\'s own mailbox before it reads it', async (t) => {
  // Orca fences a Run to one reader. A read from a caller bound to another Run
  // is refused outright, so binding is not politeness: it is how the read works
  // at all on a machine where more than one mailbox has been made.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await sendTo(box);
  const { mailbox } = await sessionIn(bots, 'coder', 'daily');

  const result = await check(box);

  assert.equal(result.code, 0, result.stderr);
  const calls = await box.orca.calls();
  const bind = calls.findIndex((call) => orcaFlag(call, '--id') === mailbox);
  const read = calls.findIndex((call) => orcaFlag(call, '--run') === mailbox);
  assert.ok(bind >= 0, `the session's own Run should have been taken, got: ${JSON.stringify(calls.map((call) => call.args))}`);
  assert.ok(read > bind, `and taken before it was read, got: ${JSON.stringify(calls.map((call) => call.args))}`);
});

test('what a check read is acknowledged, so the next check does not hand it over again', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);
  await sendTo(box, { subject: 'read me once', text: 'and once only' });

  const first = await check(box);
  const second = await check(box);

  assert.equal(first.code, 0, first.stderr);
  assert.ok(first.stdout.includes('read me once'), `got: ${first.stdout}`);
  assert.equal(second.code, 0, second.stderr);
  assert.ok(!second.stdout.includes('read me once'), `it was read already, got: ${second.stdout}`);
  assert.deepEqual(await unacked(box), [], 'and Orca was told, or it would replay it for ever');
});

test('--peek leaves the message unread, and it is still there next time', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);
  await sendTo(box, { subject: 'still waiting', text: 'nobody has taken this yet' });

  const peeked = await check(box, ['--peek']);
  const after = await check(box, ['--peek']);

  assert.equal(peeked.code, 0, peeked.stderr);
  assert.ok(peeked.stdout.includes('still waiting'), `a peek still shows the mail, got: ${peeked.stdout}`);
  assert.ok(after.stdout.includes('still waiting'), `and it is still waiting afterwards, got: ${after.stdout}`);
  assert.equal((await unacked(box)).length, 1, 'nothing was acknowledged');
  assert.deepEqual(
    orcaCallsOf(await box.orca.calls(), 'orchestration check').filter((call) => call.args.includes('--ack')),
    [],
    'and nothing was acknowledged on the way past either',
  );
});

test('a peek and then a real check: the message is read once and then gone', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);
  await sendTo(box, { subject: 'take me', text: 'when you are ready' });

  await check(box, ['--peek']);
  const taken = await check(box);
  const after = await check(box);

  assert.ok(taken.stdout.includes('take me'), `got: ${taken.stdout}`);
  assert.ok(!after.stdout.includes('take me'), `got: ${after.stdout}`);
});

test('messages come back in the order they were sent, and all of them are acknowledged', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);
  await sendTo(box, { subject: 'first', text: 'the earlier one' });
  await sendTo(box, { subject: 'second', text: 'the later one' });

  const result = await check(box);

  assert.equal(result.code, 0, result.stderr);
  assert.ok(
    result.stdout.indexOf('first') < result.stdout.indexOf('second'),
    `the mailbox is first in, first out, got: ${result.stdout}`,
  );
  assert.ok(result.stdout.includes('the earlier one') && result.stdout.includes('the later one'), `got: ${result.stdout}`);
  assert.deepEqual(await unacked(box), []);
});

test('a session with nothing waiting is told so, and that is not a failure', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);

  const result = await check(box);

  assert.equal(result.code, 0, result.stderr);
  assert.notEqual(result.stdout.trim(), '', 'an empty mailbox is an answer, not silence');
});

test('a session that was never brought up has no mailbox, and the check says so', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);
  assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', 'coder', '--name', 'night'])).code, 0);

  const result = await box.run(['message', 'check', '--bots', 'bots', '--bot', 'coder', '--session', 'night']);

  assertRefused(result, 'night');
  assert.deepEqual(
    orcaCallsOf(await box.orca.calls(), 'orchestration check'),
    [],
    'and no mailbox was read on the way to finding out',
  );
});

test('a bot with several sessions, named without one, is refused and the choices are listed', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);
  assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', 'coder', '--name', 'night'])).code, 0);

  const result = await box.run(['message', 'check', '--bots', 'bots', '--bot', 'coder']);

  assertRefused(result, 'daily', 'night');
});

test('a session reads its own mail from its own tab, naming nobody', async (t) => {
  // How a bot actually runs it: inside its own Orca tab, where `ORCA_TAB_ID`
  // says which session it is.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await sendTo(box, { subject: 'for you', text: 'and nobody else' });
  const coder = await sessionIn(bots, 'coder', 'daily');

  const result = await box.run(['message', 'check', '--bots', 'bots'], {
    env: { ...box.env, ORCA_TAB_ID: coder.tab },
  });

  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout.includes('for you'), `got: ${result.stdout}`);
  assert.deepEqual(await unacked(box), []);
});

test('every Orca call a check makes is one of the allowed ones, and no tab is closed', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);
  await sendTo(box);

  assert.equal((await check(box)).code, 0);

  assertOrcaCallsAllowed(await box.orca.calls());
});
