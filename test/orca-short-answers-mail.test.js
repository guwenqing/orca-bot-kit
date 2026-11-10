// Sending and reading fleet mail on Orca 1.4.255 and on Orca 1.4.245 (#729,
// #730).
//
// Orca 1.4.246 prints a short answer for each orchestration command unless
// `--full` is given. A send answers `{ messageId }`, with no `message`; a
// check gives each letter `from`, with no `from_handle`, `created_at` or
// `thread_id`; and a plain check now acknowledges the batch it hands over, so
// `check --ack` answers with no next batch. On the owner's 1.4.255 `obk
// message send` exited 1 after Orca had queued the letter, and senders sent
// it twice; `obk message check` showed "undefined undefined" for sender and
// time. Orca 1.4.245 and older refuse `--full` on all of them with nothing
// done. The fake models both (helpers/fake-orca.js, `orcaVersion`).
//
// What is pinned, on each of the two:
//
//   3. `obk message send` exits 0, says sent, and Orca took one send.
//   4. `obk message check` shows each letter's sender as `<bot>/<session>`
//      and its time as Orca's `created_at` gives it; its `--json` answer
//      carries the letter's thread where it has one.
//   5. One check reads every waiting letter, more than Orca's 50 a batch too,
//      and a delivery an older Orca left outstanding: each shown once,
//      nothing left unread in Orca, and a second check right after shows none.
//   8. (#730) A send Orca answered ok:true, in a shape the kit cannot read a
//      message id from: exit 0, the letter said to be queued, nothing that
//      says it failed or asks for it to be sent again, and one send.
//
// The fleet is brought up on the fake as it always answered, and the Orca
// under test is put in place before the send or the check: mailboxes made
// before an Orca update, as on the owner's machine.

import assert from 'node:assert/strict';
import test from 'node:test';

import { assertOrcaCallsAllowed, createSandbox, sessionIn } from './helpers/cli.js';
import { modelOrca, ORCA_MODELS, shownCalls, takenCallsOf } from './helpers/orca-versions.js';

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

/** `obk message send` from writer/daily to coder. */
const send = (box, subject, extra = []) => box.run([
  'message', 'send', '--bots', 'bots', '--to', 'coder', '--from', 'writer/daily',
  '--subject', subject, '--text', `about ${subject}`, ...extra,
]);

/** `obk message check` for coder's one session. */
const check = (box, args = []) => box.run(['message', 'check', '--bots', 'bots', '--bot', 'coder', '--session', 'daily', ...args]);

/** What the fake mailbox still holds unacknowledged. */
const unacked = async (box) => (await box.orca.messages()).filter((message) => !message.acked);

/** How many times `part` is in `text`. */
const timesIn = (text, part) => text.split(part).length - 1;

/** The calls made since the first `from` of them. */
const callsSince = async (box, from) => (await box.orca.calls()).slice(from);

/**
 * `count` letters waiting in coder's mailbox from writer's, put straight into
 * the fake's mailbox: sixty sends would only make the test slow. Each subject
 * is unique and is no part of another.
 */
async function seedLetters(box, bots, count, { prefix = 'note', from = 1 } = {}) {
  const { mailbox } = await sessionIn(bots, 'coder', 'daily');
  const { mailbox: writer } = await sessionIn(bots, 'writer', 'daily');
  const letters = Array.from({ length: count }, (_, i) => {
    const n = String(from + i).padStart(3, '0');
    return {
      id: `msg_seeded_${prefix}_${n}`,
      to: `run:${mailbox}`,
      from: `run:${writer}`,
      subject: `${prefix}-${n}-x`,
      body: `the body of ${prefix} ${n}`,
      type: 'status',
      priority: 'normal',
      threadId: null,
      at: '2026-11-09T12:00:00.000Z',
      acked: false,
    };
  });
  await box.orca.set({ messages: [...await box.orca.messages(), ...letters] });
  return letters;
}

for (const version of ORCA_MODELS) {
  test(`#730 3 on Orca ${version}: message send exits 0, says sent, and Orca took one send`, async (t) => {
    const box = await createSandbox(t);
    await fleetIn(box);
    const from = (await box.orca.calls()).length;
    await modelOrca(box, version);

    const sent = await send(box, 'the staging host');

    assert.equal(sent.code, 0, `the send works:\n${sent.stdout}${sent.stderr}`);
    assert.match(sent.stdout, /\bsent\b/i, `it says the letter was sent, got: ${sent.stdout}`);
    assert.doesNotMatch(sent.stdout + sent.stderr, /not sent|fail/i, `and nothing says it was not, got:\n${sent.stdout}${sent.stderr}`);
    const calls = await callsSince(box, from);
    const sends = takenCallsOf(version, calls, 'orchestration send');
    assert.equal(sends.length, 1, `Orca took exactly one send, got:\n${shownCalls(sends)}`);
    assert.equal((await box.orca.messages()).length, 1, 'and holds one letter');
    assertOrcaCallsAllowed(calls);
  });

  test(`#730 4 on Orca ${version}: message check shows the sender as <bot>/<session> and the time Orca gave, and never "undefined"`, async (t) => {
    const box = await createSandbox(t);
    await fleetIn(box);
    assert.equal((await send(box, 'the staging host')).code, 0);
    const [queued] = await box.orca.messages();
    await modelOrca(box, version);

    const result = await check(box);

    assert.equal(result.code, 0, `the check works:\n${result.stdout}${result.stderr}`);
    assert.ok(result.stdout.includes('the staging host'), `the letter is shown, got: ${result.stdout}`);
    assert.ok(result.stdout.includes('writer/daily'), `with who sent it, as <bot>/<session>, got: ${result.stdout}`);
    assert.ok(result.stdout.includes(queued.at), `and when, as Orca's created_at gives it, ${queued.at}, got: ${result.stdout}`);
    assert.doesNotMatch(result.stdout, /undefined/, `nothing is shown as undefined, got: ${result.stdout}`);
  });

  test(`#730 4 on Orca ${version}: message check --json gives each letter its sender, its time and its thread`, async (t) => {
    const box = await createSandbox(t);
    await fleetIn(box);
    assert.equal((await send(box, 'in a thread', ['--thread', 'thread-7'])).code, 0);
    assert.equal((await send(box, 'in no thread')).code, 0);
    const queued = await box.orca.messages();
    await modelOrca(box, version);

    const result = await check(box, ['--json']);

    assert.equal(result.code, 0, `the check works:\n${result.stdout}${result.stderr}`);
    const { messages } = JSON.parse(result.stdout);
    assert.deepEqual(
      messages.map((message) => ({ subject: message.subject, from: message.from, at: message.at, thread: message.thread })),
      [
        { subject: 'in a thread', from: 'writer/daily', at: queued[0].at, thread: 'thread-7' },
        { subject: 'in no thread', from: 'writer/daily', at: queued[1].at, thread: undefined },
      ],
      'each letter with its sender, its time as Orca gave it, and its thread where it has one',
    );
  });

  test(`#729 5 on Orca ${version}: one check reads 120 waiting letters, past Orca's 50 a batch, each once, and the next check finds none`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    const letters = await seedLetters(box, bots, 120);
    await modelOrca(box, version);

    const first = await check(box);
    const second = await check(box);

    assert.equal(first.code, 0, `the check works:\n${first.stdout}${first.stderr}`);
    const missing = letters.filter((letter) => !first.stdout.includes(letter.subject)).map((letter) => letter.subject);
    assert.deepEqual(missing, [], 'every one of the 120 is shown, past the first batch of 50 and the second');
    const twice = letters.filter((letter) => timesIn(first.stdout, letter.subject) > 1).map((letter) => letter.subject);
    assert.deepEqual(twice, [], 'and none of them twice');
    assert.ok(
      first.stdout.indexOf(letters[0].subject) < first.stdout.indexOf(letters[119].subject),
      'oldest first',
    );
    assert.deepEqual((await unacked(box)).map((letter) => letter.subject), [], 'Orca holds none of them unread');
    assert.equal(second.code, 0, second.stderr);
    const again = letters.filter((letter) => second.stdout.includes(letter.subject)).map((letter) => letter.subject);
    assert.deepEqual(again, [], `the second check shows none of them again, got: ${second.stdout}`);
  });

  test(`#729 5 on Orca ${version}: a batch an older Orca left outstanding, and 55 letters after it, are all read in one check, each once`, async (t) => {
    // A delivery handed over and never acknowledged, as an Orca before the
    // update leaves one, sits in front of newer mail.
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    const { mailbox } = await sessionIn(bots, 'coder', 'daily');
    const [old] = await seedLetters(box, bots, 1, { prefix: 'old' });
    await box.orca.set({ deliveries: [{ id: 'delivery_left', run: mailbox, messageIds: [old.id], acknowledged: false }] });
    const newer = await seedLetters(box, bots, 55, { prefix: 'new' });
    await modelOrca(box, version);

    const first = await check(box);
    const second = await check(box);

    assert.equal(first.code, 0, `the check works:\n${first.stdout}${first.stderr}`);
    for (const letter of [old, ...newer]) {
      assert.equal(timesIn(first.stdout, letter.subject), 1, `${letter.subject} is shown once, got: ${first.stdout}`);
    }
    assert.ok(first.stdout.indexOf(old.subject) < first.stdout.indexOf(newer[0].subject), 'the outstanding batch first');
    assert.deepEqual((await unacked(box)).map((letter) => letter.subject), [], 'Orca holds none of them unread');
    assert.ok(
      [old, ...newer].every((letter) => !second.stdout.includes(letter.subject)),
      `the second check shows none of them again, got: ${second.stdout}`,
    );
  });

  test(`#730 8 on Orca ${version}: a send Orca took and answered with no message id the kit can read exits 0, says queued, and asks for no second send`, async (t) => {
    const box = await createSandbox(t);
    await fleetIn(box);
    const from = (await box.orca.calls()).length;
    await modelOrca(box, version);
    // Orca queues the letter and answers ok, in a shape the kit does not know.
    await box.orca.set({ answerAs: { command: 'orchestration send', result: { status: 'queued' } } });

    const sent = await send(box, 'the staging host');

    const said = `${sent.stdout}${sent.stderr}`;
    assert.equal((await box.orca.messages()).length, 1, 'the premise: Orca queued the letter');
    assert.equal(sent.code, 0, `the send is not a failure: Orca queued the letter, got:\n${said}`);
    assert.match(said, /queued/i, `it says the letter is queued, got:\n${said}`);
    assert.doesNotMatch(said, /not sent|fail|refused/i, `nothing says the send failed, got:\n${said}`);
    assert.doesNotMatch(said, /again|retry|re-send|resend/i, `nothing asks for it to be sent again, got:\n${said}`);
    const sends = takenCallsOf(version, await callsSince(box, from), 'orchestration send');
    assert.equal(sends.length, 1, `Orca took exactly one send, got:\n${shownCalls(sends)}`);
  });
}
