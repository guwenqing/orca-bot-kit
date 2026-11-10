// The fake Orca's two older and newer Orcas (#729): what each answers, as
// read in Orca's source at tags v1.4.245, v1.4.246 and v1.4.255 and seen in
// part on the owner's 1.4.255 (helpers/fake-orca.js, `orcaVersion`). A fake
// that answered otherwise would make every #729 test a test of nothing.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { createSandbox } from './helpers/cli.js';
import { modelOrca, ORCA_NO_FULL, ORCA_SHORT } from './helpers/orca-versions.js';

/** Call the fake Orca the way the kit would, and give back the envelope. */
function ask(box, args) {
  const done = spawnSync(box.orca.cli, [...args, '--json'], { cwd: box.cwd, env: box.env, encoding: 'utf8' });
  assert.equal(done.stderr, '', `the fake should not have complained: ${done.stderr}`);
  return { ...JSON.parse(done.stdout), exit: done.status };
}

/** A sandbox whose Orca has one tab, term_a, and models `version` (left out: the fake as it always was). */
async function orcaWithTab(t, version) {
  const box = await createSandbox(t);
  await box.orca.set({ terminals: [{ handle: 'term_a', tabId: 'tab_a', title: 'a', typed: [] }] });
  if (version !== undefined) await modelOrca(box, version);
  return box;
}

/** A Run bound to term_a, made in the full answer, which every Orca gives one way or another. */
function runIn(box, version) {
  const made = ask(box, ['orchestration', 'run-create', '--objective', 'obk t', '--from', 'term_a', ...(version === ORCA_NO_FULL ? [] : ['--full'])]);
  assert.equal(made.ok, true, JSON.stringify(made));
  return made.result.run.id;
}

/** Send `count` letters to the Run `run`, each named `note <n>`. */
function mailTo(box, run, count) {
  for (let n = 1; n <= count; n += 1) {
    assert.equal(ask(box, ['orchestration', 'send', '--to', `run:${run}`, '--subject', `note ${n}`, '--body', 'b', '--from', 'run:other']).ok, true);
  }
}

test('#729 the fake as it always was lets a --full through and answers the full record', async (t) => {
  const box = await orcaWithTab(t);

  const made = ask(box, ['orchestration', 'run-create', '--objective', 'obk t', '--from', 'term_a', '--full']);

  assert.equal(made.ok, true);
  assert.equal(typeof made.result.run.id, 'string');
  assert.equal(ask(box, ['status']).result.app.version, '1.4.205');
});

test('#729 Orca 1.4.245 refuses --full on every orchestration command but inbox, with nothing done', async (t) => {
  const box = await orcaWithTab(t, ORCA_NO_FULL);
  const run = runIn(box, ORCA_NO_FULL);
  const before = await box.orca.state();

  for (const words of [
    ['run-create', '--objective', 'obk u', '--from', 'term_a'],
    ['run-use', '--id', run, '--from', 'term_a'],
    ['run-show', '--id', run],
    ['send', '--to', `run:${run}`, '--subject', 's', '--body', 'b'],
    ['check', '--run', run, '--terminal', 'term_a'],
  ]) {
    const refused = ask(box, ['orchestration', ...words, '--full']);
    assert.equal(refused.ok, false, `${words[0]} --full is refused`);
    assert.equal(refused.exit, 1);
    assert.equal(refused.error.code, 'invalid_argument');
    assert.equal(refused.error.message, `Unknown flag --full for command: orchestration ${words[0]}`);
  }
  const after = await box.orca.state();
  assert.deepEqual(after.runs, before.runs, 'no Run made or bound');
  assert.deepEqual(after.messages ?? [], before.messages ?? [], 'no letter sent');

  const inbox = ask(box, ['orchestration', 'inbox', '--terminal', `run:${run}`, '--limit', '5', '--full']);
  assert.equal(inbox.ok, true, 'inbox --full is answered');
  assert.deepEqual(inbox.result, { messages: [], count: 0 });
  assert.equal(ask(box, ['status']).result.app.version, ORCA_NO_FULL);
});

test('#729 Orca 1.4.245 answers a check as before: the batch replays until acked, and the ack answers with the next', async (t) => {
  const box = await orcaWithTab(t, ORCA_NO_FULL);
  const run = runIn(box, ORCA_NO_FULL);
  mailTo(box, run, 51);

  const first = ask(box, ['orchestration', 'check', '--run', run, '--terminal', 'term_a']).result;
  const again = ask(box, ['orchestration', 'check', '--run', run, '--terminal', 'term_a']).result;
  const acked = ask(box, ['orchestration', 'check', '--run', run, '--terminal', 'term_a', '--ack', first.deliveryId]).result;

  assert.equal(first.messages.length, 50);
  assert.equal(first.messages[0].from_handle, 'run:other');
  assert.equal(again.deliveryId, first.deliveryId, 'replayed');
  assert.equal(acked.acknowledged, first.deliveryId);
  assert.deepEqual(acked.messages.map((message) => message.subject), ['note 51'], 'the next batch, in the same call');
});

test('#729 Orca 1.4.255 answers run-create, run-use, run-show and send short, and in full with --full', async (t) => {
  const box = await orcaWithTab(t, ORCA_SHORT);

  const made = ask(box, ['orchestration', 'run-create', '--objective', 'obk t', '--from', 'term_a']).result;
  assert.deepEqual(made, { runId: 'run_1', objective: 'obk t' });
  const full = ask(box, ['orchestration', 'run-create', '--objective', 'obk u', '--from', 'term_a', '--full']).result;
  assert.equal(full.run.id, 'run_2');
  assert.equal(full.run.coordinator_handle, 'term_a');

  assert.deepEqual(ask(box, ['orchestration', 'run-use', '--id', 'run_1', '--from', 'term_a']).result, { runId: 'run_1', objective: 'obk t' });
  assert.equal(ask(box, ['orchestration', 'run-use', '--id', 'run_1', '--from', 'term_a', '--full']).result.run.id, 'run_1');

  const shown = ask(box, ['orchestration', 'run-show', '--id', 'run_1']).result;
  assert.deepEqual(Object.keys(shown).sort(), ['objective', 'removedWork', 'runId']);
  assert.equal(ask(box, ['orchestration', 'run-show', '--id', 'run_1', '--full']).result.run.coordinator_handle, 'term_a');

  const sent = ask(box, ['orchestration', 'send', '--to', 'run:run_1', '--subject', 's', '--body', 'b']).result;
  assert.deepEqual(Object.keys(sent), ['messageId']);
  const sentFull = ask(box, ['orchestration', 'send', '--to', 'run:run_1', '--subject', 's', '--body', 'b', '--thread-id', 'th', '--full']).result;
  assert.equal(sentFull.message.thread_id, 'th');
  assert.equal(ask(box, ['status']).result.app.version, ORCA_SHORT);
});

test('#729 Orca 1.4.255 acknowledges a batch as it hands it over, and --ack answers with no batch', async (t) => {
  const box = await orcaWithTab(t, ORCA_SHORT);
  const run = runIn(box, ORCA_SHORT);
  mailTo(box, run, 51);

  const short = ask(box, ['orchestration', 'check', '--run', run, '--terminal', 'term_a']).result;
  assert.equal(short.messages.length, 50);
  assert.deepEqual(Object.keys(short.messages[0]).sort(), ['body', 'from', 'id', 'priority', 'subject', 'type']);
  assert.equal(short.messages[0].from, 'run:other');
  assert.equal('deliveryId' in short, false, 'no delivery id once the batch was acknowledged on read');
  assert.equal((await box.orca.messages()).filter((message) => message.acked).length, 50, 'acknowledged as handed over');

  const full = ask(box, ['orchestration', 'check', '--run', run, '--terminal', 'term_a', '--full']).result;
  assert.deepEqual(full.messages.map((message) => message.subject), ['note 51'], 'the next batch, not the one handed over');
  assert.equal(full.deliveryAcknowledged, true);
  assert.equal(full.messages[0].from_handle, 'run:other');
  assert.equal(typeof full.messages[0].created_at, 'string');
  assert.equal('read' in full.messages[0], false);

  const acked = ask(box, ['orchestration', 'check', '--run', run, '--terminal', 'term_a', '--ack', full.deliveryId, '--full']);
  assert.equal(acked.ok, true, 'an acknowledged delivery is a duplicate, not an error');
  assert.deepEqual(acked.result.messages, []);
  assert.equal(acked.result.deliveryId, null);
  assert.equal(acked.result.acknowledged, full.deliveryId);
  assert.match(acked.result.next, /--ack is not needed/);

  const stale = ask(box, ['orchestration', 'check', '--run', run, '--terminal', 'term_a', '--ack', 'delivery_nope']);
  assert.equal(stale.error?.code, 'stale_delivery');
});

test('#729 Orca 1.4.255 replays a batch an older Orca left outstanding, and acknowledges it by handing it over', async (t) => {
  const box = await orcaWithTab(t, ORCA_SHORT);
  const run = runIn(box, ORCA_SHORT);
  mailTo(box, run, 2);
  const [first] = await box.orca.messages();
  await box.orca.set({ deliveries: [{ id: 'delivery_left', run, messageIds: [first.id], acknowledged: false }] });

  const replay = ask(box, ['orchestration', 'check', '--run', run, '--terminal', 'term_a', '--full']).result;
  const next = ask(box, ['orchestration', 'check', '--run', run, '--terminal', 'term_a', '--full']).result;

  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.messages.map((message) => message.subject), ['note 1']);
  assert.deepEqual(next.messages.map((message) => message.subject), ['note 2']);
});

test('#729 Orca 1.4.255 answers inbox short, with no read, delivered_at or created_at, and in full with --full', async (t) => {
  const box = await orcaWithTab(t, ORCA_SHORT);
  const row = {
    id: 'msg_x', run_id: 'run_9', from_handle: 'run:other', to_handle: 'run:run_9', subject: 's', body: 'y'.repeat(250),
    type: 'status', priority: 'normal', thread_id: null, payload: null, read: 1, sequence: 1,
    created_at: '2026-11-10T03:42:04Z', delivered_at: null, delivery_contract: null,
  };
  await box.orca.set({ inbox: { run_9: [row] } });

  const short = ask(box, ['orchestration', 'inbox', '--terminal', 'run:run_9', '--limit', '5']).result;
  const full = ask(box, ['orchestration', 'inbox', '--terminal', 'run:run_9', '--limit', '5', '--full']).result;

  assert.deepEqual(short, {
    messages: [{ id: 'msg_x', type: 'status', from: 'run:other', to: 'run:run_9', subject: 's', handled: true, body: `${'y'.repeat(200)}… (truncated; --full)` }],
  });
  assert.deepEqual(full, { messages: [row], count: 1 });
});

test('#729 a knob with `with` is aimed only at calls that carry that flag, and answerAs replaces an ok answer', async (t) => {
  const box = await orcaWithTab(t);
  const run = runIn(box);
  mailTo(box, run, 1);
  await box.orca.set({
    fail: { 'orchestration check': { code: 'runtime_error', message: 'no', with: '--ack' } },
    answerAs: { command: 'orchestration send', result: { status: 'queued' } },
  });

  const read = ask(box, ['orchestration', 'check', '--run', run, '--terminal', 'term_a']);
  const ack = ask(box, ['orchestration', 'check', '--run', run, '--terminal', 'term_a', '--ack', read.result.deliveryId]);
  const sent = ask(box, ['orchestration', 'send', '--to', `run:${run}`, '--subject', 's', '--body', 'b']);

  assert.equal(read.ok, true, 'a plain read goes through');
  assert.equal(ack.error?.code, 'runtime_error', 'the ack is refused');
  assert.deepEqual(sent, { ...sent, ok: true, result: { status: 'queued' } });
  assert.equal((await box.orca.messages()).length, 2, 'the send was done all the same');
});

// ------------------------------------------------------------- request ids on check (#735)
//
// A consuming `check` given `--retry-request <uuid>` keeps its answer under
// that id, and the same id again answers the kept answer and changes nothing
// (read in Orca's source at tags v1.4.245, v1.4.246 and v1.4.255). The kit's
// #735 tests rest on this, so the fake is held to it here.

/** Two request ids of the shape Orca takes. */
const FIRST_ID = '0d6f5c1e-7a2b-4c3d-9e8f-1a2b3c4d5e6f';
const SECOND_ID = '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

/** A consuming check of term_a's Run with request id `id`, and `extra` flags. */
const keyedCheck = (box, run, id, extra = []) => ask(box, ['orchestration', 'check', '--run', run, '--terminal', 'term_a', '--retry-request', id, ...extra]);

/** What a check may change: the letters and their marks, and the deliveries. */
const mailState = async (box) => {
  const state = await box.orca.state();
  return { messages: state.messages ?? [], deliveries: state.deliveries ?? [] };
};

for (const version of [undefined, ORCA_SHORT, ORCA_NO_FULL]) {
  const named = version ?? 'as it always was';
  // On 1.4.255 the full answer is asked for, as the kit asks; 1.4.245 knows no --full.
  const full = version === ORCA_NO_FULL ? [] : ['--full'];

  test(`#735 on the fake ${named}: the same request id answers the kept batch again and changes nothing; a new id is a new read`, async (t) => {
    const box = await orcaWithTab(t, version);
    const run = runIn(box, version);
    mailTo(box, run, 3);

    const first = keyedCheck(box, run, FIRST_ID, full);
    const after = await mailState(box);
    const again = keyedCheck(box, run, FIRST_ID, full);

    assert.equal(first.ok, true, JSON.stringify(first));
    assert.deepEqual(first.result.messages.map((message) => message.subject), ['note 1', 'note 2', 'note 3']);
    assert.deepEqual(first.result.mutation, { requestId: FIRST_ID, replayed: false });
    assert.equal(again.ok, true, JSON.stringify(again));
    assert.deepEqual(again.result.messages.map((message) => message.id), first.result.messages.map((message) => message.id), 'the same letters');
    assert.equal(again.result.deliveryId, first.result.deliveryId, 'under the same delivery');
    assert.deepEqual(again.result.mutation, { requestId: FIRST_ID, replayed: true });
    assert.deepEqual(await mailState(box), after, 'and nothing changed');

    const fresh = keyedCheck(box, run, SECOND_ID, full).result;
    if (version === ORCA_SHORT) {
      assert.deepEqual(fresh.messages, [], 'on 1.4.255 the batch was acknowledged as handed over, so a new read finds none');
    } else {
      // An older Orca hands an unacknowledged delivery over again to any read.
      assert.equal(fresh.deliveryId, first.result.deliveryId);
      assert.equal(fresh.replayed, true);
    }
  });

  test(`#735 on the fake ${named}: the same request id with other input is refused request_mismatch, and an id that is not a UUID invalid_argument, with nothing done`, async (t) => {
    const box = await orcaWithTab(t, version);
    const run = runIn(box, version);
    mailTo(box, run, 2);
    assert.equal(keyedCheck(box, run, FIRST_ID, full).ok, true);
    mailTo(box, run, 1);
    const before = await mailState(box);

    const other = keyedCheck(box, run, FIRST_ID, [...full, '--types', 'status']);
    const notUuid = keyedCheck(box, run, 'req-1', full);

    assert.equal(other.ok, false);
    assert.equal(other.exit, 1);
    assert.equal(other.error.code, 'request_mismatch');
    assert.equal(other.error.message, `Mutation request ${FIRST_ID} was already used with different input.`);
    assert.equal(notUuid.ok, false);
    assert.equal(notUuid.error.code, 'invalid_argument');
    assert.match(notUuid.error.message, /--retry-request must be the UUID/);
    assert.deepEqual(await mailState(box), before, 'nothing was taken or acknowledged');
  });
}

test('#735 on the fake: flag order does not change the input, and a peek with a request id keeps nothing', async (t) => {
  const box = await orcaWithTab(t, ORCA_SHORT);
  const run = runIn(box, ORCA_SHORT);
  mailTo(box, run, 2);

  const peek = ask(box, ['orchestration', 'check', '--run', run, '--terminal', 'term_a', '--peek', '--retry-request', FIRST_ID, '--full']);
  const read = keyedCheck(box, run, FIRST_ID, ['--full']);
  const reordered = ask(box, ['orchestration', 'check', '--retry-request', FIRST_ID, '--terminal', 'term_a', '--run', run]);

  assert.equal(peek.result.messages.length, 2, 'the peek is answered as ever');
  assert.deepEqual(read.result.mutation, { requestId: FIRST_ID, replayed: false }, 'the read after it is new: the peek kept nothing');
  assert.equal(read.result.messages.length, 2);
  assert.equal(reordered.ok, true, 'the same flags in another order, and without --full, are the same input');
  assert.deepEqual(reordered.result.messages.map((message) => message.id), read.result.messages.map((message) => message.id), 'answered in the short view from the kept answer');
  assert.equal('mutation' in reordered.result, false, 'the short view carries no mutation');
});

test('#735 on the fake: a check whose answer a hang holds back is kept all the same; one that never reached Orca keeps nothing', async (t) => {
  // Each first call is cut off by the caller after a second, as the kit's
  // time limit cuts off a call that Orca does not answer.
  const box = await orcaWithTab(t, ORCA_SHORT);
  const run = runIn(box, ORCA_SHORT);
  mailTo(box, run, 2);
  const cutOff = (id) => spawnSync(box.orca.cli, ['orchestration', 'check', '--run', run, '--terminal', 'term_a', '--retry-request', id, '--full', '--json'], {
    cwd: box.cwd, env: box.env, encoding: 'utf8', timeout: 1000,
  });
  const checksSoFar = async () => (await box.orca.calls()).filter((call) => call.args[1] === 'check').length;

  await box.orca.set({ hang: { command: 'orchestration check', ms: 60_000, applied: true, from: await checksSoFar(), times: 1 } });
  const late = cutOff(FIRST_ID);
  const taken = (await box.orca.messages()).filter((message) => message.acked).length;
  const again = keyedCheck(box, run, FIRST_ID, ['--full']).result;

  assert.equal(late.error?.code, 'ETIMEDOUT', 'the premise: the caller gave up on the answer');
  assert.equal(taken, 2, 'Orca took the batch all the same');
  assert.deepEqual(again.messages.map((message) => message.subject), ['note 1', 'note 2'], 'the same id gives the batch the late call took');
  assert.equal(again.mutation.replayed, true);

  mailTo(box, run, 1);
  await box.orca.set({ hang: { command: 'orchestration check', ms: 60_000, from: await checksSoFar(), times: 1 } });
  const lost = cutOff(SECOND_ID);
  const untaken = (await box.orca.messages()).filter((message) => !message.acked).map((message) => message.id);
  const retried = keyedCheck(box, run, SECOND_ID, ['--full']).result;

  assert.equal(lost.error?.code, 'ETIMEDOUT', 'the premise: the caller gave up on the answer');
  assert.equal(untaken.length, 1, 'a call that never reached Orca took nothing: the third letter is still unread');
  assert.deepEqual(retried.messages.map((message) => message.id), untaken, 'so the same id runs as a new read, and takes it');
  assert.equal(retried.mutation.replayed, false);
});

test('#735 on the fake: an Orca that does not know --retry-request on check refuses it with nothing done, and names the first unknown flag', async (t) => {
  const box = await orcaWithTab(t, ORCA_NO_FULL);
  const run = runIn(box, ORCA_NO_FULL);
  mailTo(box, run, 1);
  await box.orca.set({ retryRequestUnknown: true });
  const before = await mailState(box);

  const refused = keyedCheck(box, run, FIRST_ID);
  const both = ask(box, ['orchestration', 'check', '--run', run, '--terminal', 'term_a', '--retry-request', FIRST_ID, '--full']);
  const untouched = await mailState(box);
  const plain = ask(box, ['orchestration', 'check', '--run', run, '--terminal', 'term_a']);

  assert.equal(refused.ok, false);
  assert.equal(refused.exit, 1);
  assert.equal(refused.error.code, 'invalid_argument');
  assert.equal(refused.error.message, 'Unknown flag --retry-request for command: orchestration check');
  assert.equal(both.error.message, 'Unknown flag --retry-request for command: orchestration check', 'the first unknown flag given is named');
  assert.deepEqual(untouched, before, 'nothing was taken');
  assert.equal(plain.ok, true, 'a check without the flag goes through');
  assert.deepEqual(plain.result.messages.map((message) => message.subject), ['note 1']);
});
