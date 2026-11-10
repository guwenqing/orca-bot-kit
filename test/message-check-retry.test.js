// A consuming read that Orca does not answer in time is asked again with the
// same request id, so no letter is lost (#735).
//
// From Orca 1.4.246 a plain `orca orchestration check` acknowledges the batch
// it hands over. `obk message check` gives each Orca call twenty seconds and
// the whole check forty. When a read runs out of time, Orca may still have
// taken its batch as read, and the kit never showed it: the letters were lost
// to the session. Orca keeps the answer of a check given `--retry-request
// <uuid>` under that id, and the same command with the same id answers it
// again and changes nothing (read in Orca's source at tags v1.4.245, v1.4.246
// and v1.4.255; the fake models it, helpers/fake-orca.js, `receipts`).
//
// What is pinned:
//
//   1. Each consuming check the kit makes (not `--peek`, not `--ack`) carries
//      `--retry-request <id>`, and the id is a UUID.
//   2. No two consuming reads carry the same id, in one check or across
//      checks, but for the repeat of point 3.
//   3. A read Orca does not answer in time, with time left in the check's
//      hold, is asked again with the same command and the same id. When Orca
//      took the batch and answered late, every letter of it is shown once,
//      with the rest of the mail, and the next check shows none of them and
//      finds nothing left. For the first read and for a later one.
//   4. When the read and its repeats all run out of time, the check fails
//      plainly and says Orca may have taken letters as read without the kit
//      showing them. For the first read too.
//   5. A peek and an `--ack` carry no `--retry-request`.
//   6. On Orca 1.4.245, a late first read still ends with each letter shown
//      once and all of them acknowledged.
//   7. A repeat after a read that never reached Orca takes the batch as new:
//      each letter is shown once.
//   8. On an Orca whose CLI refuses `--retry-request` on `check` as an
//      unknown flag, mail is still read, each letter once. Only that exact
//      refusal makes the kit send the check again without the flag: after
//      any other refusal, no consuming check goes without it.
//
// The cases with a late answer each wait out the kit's twenty seconds, or its
// forty, so they run side by side. The fleet is brought up on the fake as it
// always answered, and the Orca under test is put in place before the check.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSandbox, orcaCallsOf, orcaFlag, sessionIn } from './helpers/cli.js';
import { consumingChecks, modelOrca, ORCA_MODELS, ORCA_NO_FULL, ORCA_SHORT, shownCalls } from './helpers/orca-versions.js';

/** How long Orca holds its answer back: far past the kit's twenty seconds for a call and its forty for a check. */
const HANG_MS = 60_000;

/** Each late case's own limit: the kit's forty seconds, two checks, the setup, and a busy machine. */
const CASE_MS = 150_000;

/** Less than the kit's twenty seconds for one call: a check that took this long waited on a held answer. */
const WAITED_MS = 15_000;

/** The shape Orca's CLI takes as a request id. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A bots folder with a Claude bot that writes and a Codex bot that reads, both up, on the fake as it always answered. */
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

/** `obk message check` for coder's one session. */
const check = (box, args = []) => box.run(['message', 'check', '--bots', 'bots', '--bot', 'coder', '--session', 'daily', ...args]);

/** What the fake mailbox still holds unacknowledged. */
const unacked = async (box) => (await box.orca.messages()).filter((message) => !message.acked);

/** How many times `part` is in `text`. */
const timesIn = (text, part) => text.split(part).length - 1;

/** The calls made since the first `from` of them. */
const callsSince = async (box, from) => (await box.orca.calls()).slice(from);

/** How many `orchestration check` calls Orca has had: where a `hang` set now starts to count. */
const checksSoFar = async (box) => orcaCallsOf(await box.orca.calls(), 'orchestration check').length;

/** The request id a call carries, or undefined. */
const idOf = (call) => orcaFlag(call, '--retry-request');

/**
 * `count` letters waiting in coder's mailbox from writer's, put straight into
 * the fake's mailbox. Each subject is unique and is no part of another.
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
      at: '2026-11-10T12:00:00.000Z',
      acked: false,
    };
  });
  await box.orca.set({ messages: [...await box.orca.messages(), ...letters] });
  return letters;
}

/** Every one of `letters` is in `text` exactly once. */
function assertEachShownOnce(text, letters, what) {
  const missing = letters.filter((letter) => !text.includes(letter.subject)).map((letter) => letter.subject);
  assert.deepEqual(missing, [], `${what}: every letter is shown, got:\n${text}`);
  const twice = letters.filter((letter) => timesIn(text, letter.subject) > 1).map((letter) => letter.subject);
  assert.deepEqual(twice, [], `${what}: and none of them twice`);
}

/** A failure a caller can act on: a non-zero exit, something said, and no crash. */
function assertFailedPlainly(said, code) {
  assert.ok(code !== 0 && code !== null, `this should have failed, got exit ${code}:\n${said}`);
  assert.notEqual(said.trim(), '', 'a failure with nothing said is no use to anybody');
  assert.ok(!/^\s+at /m.test(said), `expected a message, got a crash:\n${said}`);
}

/**
 * The late read and its repeat: the first two consuming checks that carry
 * `id`, the same command both times, and no other consuming check with it.
 */
function assertAskedAgainWithTheSameId(reads, late) {
  const id = idOf(late);
  assert.match(String(id), UUID, `the late read carried a request id, got:\n${shownCalls([late])}`);
  const withIt = reads.filter((call) => idOf(call) === id);
  assert.equal(withIt.length, 2, `the late read was asked again once, with the same id ${id}, got:\n${shownCalls(reads)}`);
  assert.deepEqual(withIt[1].args, withIt[0].args, 'with the same command');
}

// ---------------------------------------------------------------------------
// Which calls carry a request id (1, 2, 5), on each Orca
// ---------------------------------------------------------------------------

for (const version of ORCA_MODELS) {
  test(`#735 1 2 5 on Orca ${version}: each consuming check carries a UUID request id of its own, in one check and across checks, and a peek or an ack carries none`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    const first = await seedLetters(box, bots, 120);
    await modelOrca(box, version);
    const from = (await box.orca.calls()).length;

    const peeked = await check(box, ['--peek']);
    const one = await check(box);
    const fromSecond = (await box.orca.calls()).length;
    const later = await seedLetters(box, bots, 3, { prefix: 'later' });
    const two = await check(box);

    assert.equal(peeked.code, 0, `the peek works:\n${peeked.stdout}${peeked.stderr}`);
    assert.equal(one.code, 0, `the first check works:\n${one.stdout}${one.stderr}`);
    assert.equal(two.code, 0, `the second check works:\n${two.stdout}${two.stderr}`);
    assertEachShownOnce(one.stdout, first, 'the first check');
    assertEachShownOnce(two.stdout, later, 'the second check');

    const calls = await callsSince(box, from);
    const reads = consumingChecks(version, calls);
    const firstReads = consumingChecks(version, calls.slice(0, fromSecond - from));
    // On 1.4.255 each batch of fifty is a read of its own; on 1.4.245 an ack answers with the next batch.
    assert.ok(firstReads.length >= (version === ORCA_SHORT ? 3 : 1), `the first check read its 120 letters, got:\n${shownCalls(firstReads)}`);
    const withoutId = reads.filter((call) => !UUID.test(String(idOf(call))));
    assert.deepEqual(withoutId.map((call) => call.args.join(' ')), [], 'every consuming check carries --retry-request <uuid>');
    const ids = reads.map(idOf);
    assert.equal(new Set(ids).size, ids.length, `no two consuming checks carry the same id, within a check or across checks, got:\n${shownCalls(reads)}`);

    const checks = orcaCallsOf(calls, 'orchestration check');
    const peeks = checks.filter((call) => call.args.includes('--peek'));
    const acks = checks.filter((call) => call.args.includes('--ack'));
    assert.ok(peeks.length > 0, 'the premise: the peek asked Orca');
    if (version === ORCA_NO_FULL) assert.ok(acks.length > 0, 'the premise: on 1.4.245 the kit acknowledges what it read');
    assert.deepEqual(
      [...peeks, ...acks].filter((call) => call.args.includes('--retry-request')).map((call) => call.args.join(' ')),
      [],
      'a peek and an ack carry no --retry-request',
    );
  });
}

// ---------------------------------------------------------------------------
// A read Orca answers too late (3, 4, 6, 7)
// ---------------------------------------------------------------------------

test('#735 a consuming read that Orca does not answer in time', { concurrency: true }, async (t) => {
  const cases = [];
  for (const version of ORCA_MODELS) {
    const point = version === ORCA_SHORT ? '3' : '6';
    cases.push(t.test(`#735 ${point} on Orca ${version}: the first read is taken by Orca and answered too late; the kit asks again with the same id and shows each letter once, and the next check finds nothing`, { timeout: CASE_MS }, async (t) => {
      const box = await createSandbox(t);
      const bots = await fleetIn(box);
      const letters = await seedLetters(box, bots, 60);
      await modelOrca(box, version);
      // Orca takes the first read's batch at once and holds its answer back.
      await box.orca.set({ hang: { command: 'orchestration check', ms: HANG_MS, applied: true, from: await checksSoFar(box), times: 1 } });
      const from = (await box.orca.calls()).length;

      const started = Date.now();
      const first = await check(box);
      const took = Date.now() - started;
      const second = await check(box);

      assert.ok(took >= WAITED_MS, `the premise: the first read was held back past the kit's limit, the check took ${took} ms`);
      assert.ok(took < HANG_MS, `and the kit did not wait for Orca's late answer, took ${took} ms`);
      assert.equal(first.code, 0, `the check read all the mail, so it works:\n${first.stdout}${first.stderr}`);
      assertEachShownOnce(first.stdout, letters, 'the check');
      assert.deepEqual((await unacked(box)).map((letter) => letter.subject), [], 'Orca holds none of them unread');
      const reads = consumingChecks(version, await callsSince(box, from));
      assertAskedAgainWithTheSameId(reads, reads[0]);
      assert.equal(second.code, 0, `the next check works:\n${second.stdout}${second.stderr}`);
      const again = letters.filter((letter) => second.stdout.includes(letter.subject)).map((letter) => letter.subject);
      assert.deepEqual(again, [], `the next check shows none of them again, got:\n${second.stdout}`);
    }));
  }

  cases.push(t.test(`#735 3 on Orca ${ORCA_SHORT}: a later read is taken by Orca and answered too late; the kit asks again with the same id and shows every letter once`, { timeout: CASE_MS }, async (t) => {
    // Sixty letters: the first read takes fifty and is answered at once; the
    // second takes the last ten and is answered too late.
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    const letters = await seedLetters(box, bots, 60);
    await modelOrca(box, ORCA_SHORT);
    await box.orca.set({ hang: { command: 'orchestration check', ms: HANG_MS, applied: true, from: await checksSoFar(box), after: 1, times: 1 } });
    const from = (await box.orca.calls()).length;

    const started = Date.now();
    const first = await check(box);
    const took = Date.now() - started;
    const second = await check(box);

    assert.ok(took >= WAITED_MS, `the premise: the second read was held back past the kit's limit, the check took ${took} ms`);
    assert.equal(first.code, 0, `the check read all the mail, so it works:\n${first.stdout}${first.stderr}`);
    assertEachShownOnce(first.stdout, letters, 'the check');
    assert.deepEqual((await unacked(box)).map((letter) => letter.subject), [], 'Orca holds none of them unread');
    const reads = consumingChecks(ORCA_SHORT, await callsSince(box, from));
    assert.ok(reads.length >= 3, `a read, the late read, and its repeat, got:\n${shownCalls(reads)}`);
    assertAskedAgainWithTheSameId(reads, reads[1]);
    assert.notEqual(idOf(reads[0]), idOf(reads[1]), 'the first read and the late one carry ids of their own');
    assert.equal(second.code, 0, `the next check works:\n${second.stdout}${second.stderr}`);
    const again = letters.filter((letter) => second.stdout.includes(letter.subject)).map((letter) => letter.subject);
    assert.deepEqual(again, [], `the next check shows none of them again, got:\n${second.stdout}`);
  }));

  cases.push(t.test(`#735 4 on Orca ${ORCA_SHORT}: the first read and every repeat of it are answered too late, and the check fails plainly, saying Orca may have taken letters as read without the kit showing them`, { timeout: CASE_MS }, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    const letters = await seedLetters(box, bots, 3);
    await modelOrca(box, ORCA_SHORT);
    // Every check from now on is carried out at once and answered a minute late.
    await box.orca.set({ hang: { command: 'orchestration check', ms: HANG_MS, applied: true, from: await checksSoFar(box) } });
    const from = (await box.orca.calls()).length;

    const started = Date.now();
    const ran = await check(box);
    const took = Date.now() - started;

    const said = `${ran.stdout}${ran.stderr}`;
    assert.deepEqual((await unacked(box)).map((letter) => letter.subject), [], 'the premise: Orca took the letters as read');
    assert.ok(took < HANG_MS, `the kit gave up within its hold, took ${took} ms`);
    assertFailedPlainly(said, ran.code);
    assert.match(said, /\bmay have taken\b[^\n]*\bas read\b/i, `it says Orca may have taken letters as read, got:\n${said}`);
    assert.doesNotMatch(said, /\bhas taken\b/i, `and does not say Orca has taken them, which the kit cannot know, got:\n${said}`);
    const reads = consumingChecks(ORCA_SHORT, await callsSince(box, from));
    assert.ok(reads.length >= 2, `the late read was asked again while the hold had time left, got:\n${shownCalls(reads)}`);
    assert.equal(new Set(reads.map(idOf)).size, 1, `every repeat carries the first read's id, so none takes a second batch, got:\n${shownCalls(reads)}`);
    assert.match(String(idOf(reads[0])), UUID);
    const shown = letters.filter((letter) => ran.stdout.includes(letter.subject)).map((letter) => letter.subject);
    assert.deepEqual(shown, [], 'no answer reached the kit, so no letter is shown');
  }));

  cases.push(t.test(`#735 7 on Orca ${ORCA_SHORT}: the first read never reached Orca; the repeat with the same id takes the batch as new, and each letter is shown once`, { timeout: CASE_MS }, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    const letters = await seedLetters(box, bots, 60);
    await modelOrca(box, ORCA_SHORT);
    // The first check waits and does nothing: the kit's limit ends it before it reaches Orca's runtime.
    await box.orca.set({ hang: { command: 'orchestration check', ms: HANG_MS, from: await checksSoFar(box), times: 1 } });
    const from = (await box.orca.calls()).length;

    const started = Date.now();
    const first = await check(box);
    const took = Date.now() - started;
    const second = await check(box);

    assert.ok(took >= WAITED_MS, `the premise: the first read was held past the kit's limit, the check took ${took} ms`);
    assert.equal(first.code, 0, `the check read all the mail, so it works:\n${first.stdout}${first.stderr}`);
    assertEachShownOnce(first.stdout, letters, 'the check');
    assert.deepEqual((await unacked(box)).map((letter) => letter.subject), [], 'Orca holds none of them unread');
    const reads = consumingChecks(ORCA_SHORT, await callsSince(box, from));
    assertAskedAgainWithTheSameId(reads, reads[0]);
    assert.equal(second.code, 0, `the next check works:\n${second.stdout}${second.stderr}`);
    assert.ok(letters.every((letter) => !second.stdout.includes(letter.subject)), `the next check shows none of them again, got:\n${second.stdout}`);
  }));

  await Promise.all(cases);
});

// ---------------------------------------------------------------------------
// An Orca that refuses the flag (8)
// ---------------------------------------------------------------------------

/** Orca's refusal of a request id that is not a UUID: the same code, other words, and the flag named in them. */
const NOT_A_UUID = '--retry-request must be the UUID Orca reported for the original request; pass it exactly as printed, or omit the flag to start a new request.';

for (const version of ORCA_MODELS) {
  test(`#735 8 on Orca ${version}: an Orca that refuses --retry-request on check as an unknown flag still has every letter read, each once`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    const letters = await seedLetters(box, bots, 60);
    await modelOrca(box, version);
    // Refused `invalid_argument`, "Unknown flag --retry-request for command: orchestration check", with nothing done.
    await box.orca.set({ retryRequestUnknown: true });
    const from = (await box.orca.calls()).length;

    const first = await check(box);
    const second = await check(box);

    assert.equal(first.code, 0, `the check works:\n${first.stdout}${first.stderr}`);
    assertEachShownOnce(first.stdout, letters, 'the check');
    assert.deepEqual((await unacked(box)).map((letter) => letter.subject), [], 'Orca holds none of them unread');
    assert.equal(second.code, 0, `the next check works:\n${second.stdout}${second.stderr}`);
    assert.ok(letters.every((letter) => !second.stdout.includes(letter.subject)), `the next check shows none of them again, got:\n${second.stdout}`);
    const reads = consumingChecks(version, await callsSince(box, from));
    assert.ok(reads.some((call) => idOf(call) !== undefined), `the premise: the kit asked with the flag first, got:\n${shownCalls(reads)}`);
    assert.ok(reads.some((call) => idOf(call) === undefined), `and, refused for it, asked without it, got:\n${shownCalls(reads)}`);
  });

  test(`#735 8 on Orca ${version}: a refusal of a check in any other words is no reason to drop --retry-request`, async (t) => {
    // invalid_argument, as the unknown flag is, but in other words: Orca knows
    // the flag and refused its value. Asked without it, a read could take a
    // batch with no request id to recover it by.
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    const letters = await seedLetters(box, bots, 3);
    await modelOrca(box, version);
    await box.orca.set({
      fail: { 'orchestration check': { code: 'invalid_argument', message: NOT_A_UUID, with: '--retry-request' } },
    });
    const from = (await box.orca.calls()).length;

    const ran = await check(box);

    assertFailedPlainly(`${ran.stdout}${ran.stderr}`, ran.code);
    const reads = orcaCallsOf(await callsSince(box, from), 'orchestration check')
      .filter((call) => !call.args.includes('--peek') && !call.args.includes('--ack'));
    assert.ok(reads.length > 0, 'the premise: the kit asked Orca for its mail');
    assert.deepEqual(
      reads.filter((call) => idOf(call) === undefined).map((call) => call.args.join(' ')),
      [],
      'no consuming check went without --retry-request',
    );
    assert.equal((await unacked(box)).length, letters.length, 'Orca took nothing, and all the mail is still waiting');
  });
}

test('#735 8 and 3: a read without the flag, on an Orca that refused it, is never asked again after a time-out', { concurrency: true }, async (t) => {
  // With no request id, Orca has nothing to answer a repeat from: a second
  // read would take the next batch, and the late one stays lost. So the kit
  // asks nothing more, and says the letters may have been taken.
  const cases = [];
  for (const version of ORCA_MODELS) {
    cases.push(t.test(`#735 on Orca ${version}: Orca refuses --retry-request as an unknown flag, the read without it is answered too late, and the check asks no more and fails plainly, saying Orca may have taken letters as read`, { timeout: CASE_MS }, async (t) => {
      const box = await createSandbox(t);
      const bots = await fleetIn(box);
      await seedLetters(box, bots, 60);
      await modelOrca(box, version);
      // The first check, with the flag, is refused before it reaches Orca's
      // runtime. Every check after it is carried out at once and answered a
      // minute late.
      await box.orca.set({
        retryRequestUnknown: true,
        hang: { command: 'orchestration check', ms: HANG_MS, applied: true, from: await checksSoFar(box), after: 1 },
      });
      const from = (await box.orca.calls()).length;

      const started = Date.now();
      const ran = await check(box);
      const took = Date.now() - started;

      const said = `${ran.stdout}${ran.stderr}`;
      const reads = consumingChecks(version, await callsSince(box, from));
      const flagged = reads.filter((call) => idOf(call) !== undefined);
      const plain = reads.filter((call) => idOf(call) === undefined);
      assert.ok(flagged.length > 0, `the premise: the kit asked with the flag first, and Orca refused it, got:\n${shownCalls(reads)}`);
      assert.ok(took >= WAITED_MS, `the premise: the read without the flag was held back past the kit's limit, the check took ${took} ms`);
      if (version === ORCA_SHORT) {
        const left = (await unacked(box)).length;
        assert.ok(left <= 10, `the premise: Orca took at least the first fifty as read, ${left} of 60 are left`);
      }
      assert.equal(plain.length, 1, `one read without the flag reached Orca, and it was not asked again, got:\n${shownCalls(reads)}`);
      assert.equal(reads.at(-1), plain[0], `and no consuming check came after it, got:\n${shownCalls(reads)}`);
      assert.ok(took < HANG_MS, `the kit did not wait for Orca's late answer, took ${took} ms`);
      assertFailedPlainly(said, ran.code);
      assert.match(said, /\bmay have taken\b[^\n]*\bas read\b/i, `it says Orca may have taken letters as read, got:\n${said}`);
      assert.doesNotMatch(said, /\bhas taken\b/i, `and does not say Orca has taken them, got:\n${said}`);
    }));
  }
  await Promise.all(cases);
});
