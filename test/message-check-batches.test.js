// `obk message check` hands over every batch that is waiting, not only the
// oldest one (issue #299).
//
// Orca hands a mailbox's mail over a batch (a delivery) at a time. A plain
// read replays the one outstanding delivery, however much newer mail has come
// since, until it is acknowledged; the acknowledgement answers with the next
// batch. Seen on 2026-09-24 with obk 0.4.0: a check showed only an old message,
// and a review sent later stayed hidden until a second check.
//
// Two batches are made waiting the way it happened live: a message comes in,
// something reads the mailbox the way Orca's own notice tells a bot to and
// does not acknowledge it, then newer mail comes in. More than 50 unread is the
// other way, since Orca puts at most 50 in one batch.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { createSandbox, orcaCallsOf, sessionIn } from './helpers/cli.js';

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
async function sendTo(box, subject, text = `about ${subject}`) {
  const sent = await box.run([
    'message', 'send', '--bots', 'bots', '--to', 'coder', '--from', 'writer/daily',
    '--subject', subject, '--text', text,
  ]);
  assert.equal(sent.code, 0, sent.stderr);
}

/**
 * Read coder's mailbox with Orca's own `orchestration check`, as its notice
 * tells a bot to, and acknowledge nothing: what it was handed stays the
 * mailbox's outstanding batch. Answers with the subjects it was handed.
 */
async function readWithoutAck(box, bots) {
  const { mailbox } = await sessionIn(bots, 'coder', 'daily');
  const reader = (await box.orca.runs()).find((run) => run.id === mailbox).coordinator_handle;
  const done = spawnSync(
    box.orca.cli,
    ['orchestration', 'check', '--run', mailbox, '--terminal', reader, '--json'],
    { cwd: box.cwd, env: box.env, encoding: 'utf8' },
  );
  const answer = JSON.parse(done.stdout);
  assert.equal(answer.ok, true, `the direct read should have gone through: ${done.stdout}`);
  return answer.result.messages.map((message) => message.subject);
}

/** Two batches waiting for coder: `older` in the outstanding one, `newer` unread after it. */
async function twoBatches(box, bots, older, newer) {
  for (const subject of older) await sendTo(box, subject);
  assert.deepEqual(await readWithoutAck(box, bots), older, 'the first batch is handed over and left outstanding');
  for (const subject of newer) await sendTo(box, subject);
}

/** `obk message check` for coder's one session. */
const check = (box, args = []) => box.run(['message', 'check', '--bots', 'bots', '--bot', 'coder', '--session', 'daily', ...args]);

/** What the fake mailbox still holds unacknowledged. */
const unacked = async (box) => (await box.orca.messages()).filter((message) => !message.acked);

/** The check's closing line: the last line it printed that has anything on it. */
const closingLine = (stdout) => stdout.trimEnd().split('\n').at(-1);

/** Whether `line` says the number `n` as a number of its own, not as part of another. */
const saysNumber = (line, n) => new RegExp(`(^|\\D)${n}(\\D|$)`).test(line);

test('#299 done when: with two batches waiting, one check shows both and a second check shows none', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await twoBatches(box, bots, ['the old one'], ['the review']);

  const first = await check(box);
  const second = await check(box);

  assert.equal(first.code, 0, first.stderr);
  assert.ok(first.stdout.includes('the old one'), `the oldest batch is shown, got: ${first.stdout}`);
  assert.ok(first.stdout.includes('the review'), `and the batch after it, in the same check, got: ${first.stdout}`);
  assert.ok(
    first.stdout.indexOf('the old one') < first.stdout.indexOf('the review'),
    `oldest first, got: ${first.stdout}`,
  );
  assert.equal(second.code, 0, second.stderr);
  assert.ok(!second.stdout.includes('the old one'), `the second check has nothing left to show, got: ${second.stdout}`);
  assert.ok(!second.stdout.includes('the review'), `the review included, got: ${second.stdout}`);
});

test('#299: one check acknowledges every batch it hands over, so none is left waiting in Orca', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await twoBatches(box, bots, ['the old one'], ['the review']);

  const result = await check(box);

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(
    (await unacked(box)).map((message) => message.subject),
    [],
    'every message the check showed was acknowledged, the newer batch as well as the old one',
  );
});

test('#299: the closing line counts every message handed over, across all the batches', async (t) => {
  // One message in the first batch and two in the second: three in all, which
  // is neither batch's own count.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await twoBatches(box, bots, ['the old one'], ['the review', 'the follow-up']);

  const result = await check(box);

  assert.equal(result.code, 0, result.stderr);
  const last = closingLine(result.stdout);
  assert.ok(saysNumber(last, 3), `the closing line should say 3 messages, got: ${last}`);
  assert.ok(last.includes('coder/daily'), `and whose they were, got: ${last}`);
});

test('#299: --peek shows the mail of every batch and takes none of it', async (t) => {
  // Orca's own peek already lists every unread message, whatever batch it is
  // in, so this holds today; it guards the peek while the plain check changes.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await twoBatches(box, bots, ['the old one'], ['the review']);

  const peeked = await check(box, ['--peek']);

  assert.equal(peeked.code, 0, peeked.stderr);
  assert.ok(peeked.stdout.includes('the old one'), `the outstanding batch is shown, got: ${peeked.stdout}`);
  assert.ok(peeked.stdout.includes('the review'), `and the mail after it, got: ${peeked.stdout}`);
  assert.equal((await unacked(box)).length, 2, 'nothing was acknowledged');
  assert.deepEqual(
    orcaCallsOf(await box.orca.calls(), 'orchestration check').filter((call) => call.args.includes('--ack')),
    [],
    'and nothing was acknowledged on the way past either',
  );

  const taken = await check(box);
  assert.ok(
    taken.stdout.includes('the old one') && taken.stdout.includes('the review'),
    `a real check afterwards still finds both, got: ${taken.stdout}`,
  );
});

test('#299: more mail than Orca puts in one batch is all handed over, and counted, in one check', async (t) => {
  // Orca puts at most 50 messages in a batch, so 60 waiting are two batches
  // with no earlier read at all. They are put straight into the fake's mailbox:
  // sixty sends would only make the test slow.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const { mailbox } = await sessionIn(bots, 'coder', 'daily');
  const { mailbox: writer } = await sessionIn(bots, 'writer', 'daily');
  const subjects = Array.from({ length: 60 }, (_, i) => `note ${String(i + 1).padStart(2, '0')}`);
  await box.orca.set({
    messages: subjects.map((subject, i) => ({
      id: `msg_seeded_${i + 1}`,
      to: `run:${mailbox}`,
      from: `run:${writer}`,
      subject,
      body: `the body of ${subject}`,
      type: 'status',
      priority: 'normal',
      threadId: null,
      at: '2026-09-24T12:00:00.000Z',
      acked: false,
    })),
  });

  const result = await check(box);

  assert.equal(result.code, 0, result.stderr);
  const missing = subjects.filter((subject) => !result.stdout.includes(subject));
  assert.deepEqual(missing, [], 'every one of the 60 is shown, past the first batch of 50 as well');
  assert.ok(saysNumber(closingLine(result.stdout), 60), `the closing line should say 60, got: ${closingLine(result.stdout)}`);
  assert.deepEqual(await unacked(box), [], 'and all 60 were acknowledged');
});
