// No Orca command that writes runs twice in effect, on Orca 1.4.255 and on
// Orca 1.4.245 (#729, #730): the refusals. The time-outs are in
// test/orca-short-answers-time-outs.test.js.
//
// The kit may have to ask an Orca for its answer in two ways: with `--full`,
// which 1.4.246 and later need for the whole record, and without it, which
// 1.4.245 and older need, since they refuse the flag. That second asking is
// safe only after Orca's own refusal of the unknown flag, which did nothing:
// `invalid_argument`, "Unknown flag --full for command: orchestration <cmd>".
// After any other refusal Orca may still have done something, or will refuse
// again; a kit that asks again there makes a second Run, sends a letter
// twice, or takes a second batch nobody sees. A sender who sends again
// because the kit said the send failed is the same harm (#730).
//
// What is pinned, on each of the two Orcas, for each command that writes:
// `run-create`, `run-use`, `send`, a consuming `check` and `check --ack`.
// Orca refuses it with a code that is not that refusal, and the kit asks it
// once: one call of it reached Orca's runtime (helpers/orca-versions.js,
// `takenCallsOf`: on 1.4.245 a call refused for its `--full` did nothing and
// does not count). The same for a send whose answer is not JSON at all, and
// for an `invalid_argument` refusal in other words than the unknown flag's.

import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';
import { stringify } from 'yaml';

import { bookIn, bookOf, createSandbox, mailboxStep, sessionIn, sh } from './helpers/cli.js';
import { acksOf, consumingChecks, modelOrca, ORCA_MODELS, ORCA_SHORT, shownCalls, takenCallsOf } from './helpers/orca-versions.js';

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

/** The fake Orca's terminal for coder's tab, as the book names it. */
async function coderTab(box, bots) {
  const { tab } = await sessionIn(bots, 'coder', 'daily');
  const terminal = (await box.orca.terminals()).find((entry) => entry.tabId === tab);
  assert.ok(terminal !== undefined, `the book says coder/daily lives in ${tab}, and Orca has no such tab`);
  return terminal;
}

/** Take a session's mailbox out of its book, as a session made on a broken Orca is left. */
async function forgetMailbox(bots, bot, session) {
  const book = await bookIn(bots, bot);
  delete book.sessions[session].mailbox;
  await writeFile(bookOf(bots, bot), stringify(book));
}

/** coder's mailbox step, run in coder's own tab, as its launch line runs it. */
const stepInCoderTab = (box, coder) => sh(mailboxStep(box, { bot: 'coder', session: 'daily' }), {
  cwd: box.cwd,
  env: { ...box.env, ORCA_TERMINAL_HANDLE: coder.handle, ORCA_TAB_ID: coder.tabId },
});

/** `obk message send` from writer/daily to coder. */
const send = (box, subject) => box.run([
  'message', 'send', '--bots', 'bots', '--to', 'coder', '--from', 'writer/daily',
  '--subject', subject, '--text', `about ${subject}`,
]);

/** `obk message check` for coder's one session. */
const check = (box) => box.run(['message', 'check', '--bots', 'bots', '--bot', 'coder', '--session', 'daily']);

/** The calls made since the first `from` of them. */
const callsSince = async (box, from) => (await box.orca.calls()).slice(from);

/** Orca's refusal, in a code that is not the unknown flag's: the runtime said no. */
const RUNTIME_NO = { code: 'runtime_error', message: 'the orchestration runtime is restarting; try again in a moment' };

/** An `invalid_argument` refusal in other words than the unknown `--full` flag's. */
const OTHER_ARGUMENT = { code: 'invalid_argument', message: 'Unknown flag --fuller for command: orchestration send' };

/** A run that ended in a message, not a crash: whatever its exit code. */
function assertNoCrash(result) {
  assert.ok(!/^\s+at /m.test(`${result.stdout}${result.stderr}`), `a message, not a crash:\n${result.stdout}${result.stderr}`);
}

for (const version of ORCA_MODELS) {
  test(`#729 10 on Orca ${version}: a run-create Orca refuses with another code is asked once`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    const coder = await coderTab(box, bots);
    await forgetMailbox(bots, 'coder', 'daily');
    await modelOrca(box, version);
    await box.orca.set({ fail: { 'orchestration run-create': RUNTIME_NO } });
    const from = (await box.orca.calls()).length;

    const ran = await stepInCoderTab(box, coder);

    assertNoCrash(ran);
    const made = takenCallsOf(version, await callsSince(box, from), 'orchestration run-create');
    assert.equal(made.length, 1, `Orca was asked for one Run, and refused it, got:\n${shownCalls(made)}`);
    assert.equal((await sessionIn(bots, 'coder', 'daily')).mailbox, undefined, 'and the book names none');
  });

  test(`#729 10 on Orca ${version}: a run-use Orca refuses with another code is asked once`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    const coder = await coderTab(box, bots);
    const { mailbox } = await sessionIn(bots, 'coder', 'daily');
    await modelOrca(box, version);
    await box.orca.set({ fail: { 'orchestration run-use': RUNTIME_NO } });
    const from = (await box.orca.calls()).length;

    const ran = await stepInCoderTab(box, coder);

    assertNoCrash(ran);
    const calls = await callsSince(box, from);
    const bound = takenCallsOf(version, calls, 'orchestration run-use');
    assert.equal(bound.length, 1, `Orca was asked to bind the mailbox once, got:\n${shownCalls(bound)}`);
    assert.deepEqual(takenCallsOf(version, calls, 'orchestration run-create'), [], 'and made no Run in its place');
    assert.equal((await sessionIn(bots, 'coder', 'daily')).mailbox, mailbox, 'the book keeps the mailbox it had');
  });

  for (const [what, refusal] of [['another code', RUNTIME_NO], ['invalid_argument in other words than the unknown --full', OTHER_ARGUMENT]]) {
    test(`#730 10 on Orca ${version}: a send Orca refuses with ${what} is asked once`, async (t) => {
      const box = await createSandbox(t);
      await fleetIn(box);
      await modelOrca(box, version);
      await box.orca.set({ fail: { 'orchestration send': refusal } });
      const from = (await box.orca.calls()).length;

      const sent = await send(box, 'the staging host');

      assertNoCrash(sent);
      assert.notEqual(sent.code, 0, `Orca refused the send, and the kit says so, got:\n${sent.stdout}${sent.stderr}`);
      const sends = takenCallsOf(version, await callsSince(box, from), 'orchestration send');
      assert.equal(sends.length, 1, `Orca was asked to send once, got:\n${shownCalls(sends)}`);
    });
  }

  test(`#730 10 on Orca ${version}: a send whose answer is not JSON at all is asked once`, async (t) => {
    // The kit cannot tell whether Orca queued the letter, so it must not
    // queue it again.
    const box = await createSandbox(t);
    await fleetIn(box);
    await modelOrca(box, version);
    await box.orca.set({ garbage: { command: 'orchestration send', text: 'orca: something went wrong\n' } });
    const from = (await box.orca.calls()).length;

    const sent = await send(box, 'the staging host');

    assertNoCrash(sent);
    const sends = takenCallsOf(version, await callsSince(box, from), 'orchestration send');
    assert.equal(sends.length, 1, `Orca was asked to send once, got:\n${shownCalls(sends)}`);
  });

  test(`#729 10 on Orca ${version}: a consuming check Orca refuses with another code is asked once`, async (t) => {
    const box = await createSandbox(t);
    await fleetIn(box);
    assert.equal((await send(box, 'the staging host')).code, 0);
    await modelOrca(box, version);
    await box.orca.set({ fail: { 'orchestration check': RUNTIME_NO } });
    const from = (await box.orca.calls()).length;

    const result = await check(box);

    assertNoCrash(result);
    assert.notEqual(result.code, 0, `Orca refused the read, and the kit says so, got:\n${result.stdout}${result.stderr}`);
    const reads = consumingChecks(version, await callsSince(box, from));
    assert.equal(reads.length, 1, `Orca was asked for the mail once, got:\n${shownCalls(reads)}`);
  });

  test(`#729 10 on Orca ${version}: an acknowledgement Orca refuses with another code is asked at most once`, async (t) => {
    // On 1.4.245 the kit must acknowledge what it showed, and a batch whose
    // acknowledgement Orca refused is handed over again by the next check. On
    // 1.4.255 a plain check has acknowledged it already, so it is never handed
    // over again: it must be shown now, or it is lost. Whether the kit acks
    // there too is its own.
    const box = await createSandbox(t);
    await fleetIn(box);
    assert.equal((await send(box, 'the staging host')).code, 0);
    await modelOrca(box, version);
    await box.orca.set({ fail: { 'orchestration check': { ...RUNTIME_NO, with: '--ack' } } });
    const from = (await box.orca.calls()).length;

    const result = await check(box);

    assertNoCrash(result);
    if (version === ORCA_SHORT) {
      assert.ok(result.stdout.includes('the staging host'), `the letter Orca took as read is shown, got:\n${result.stdout}${result.stderr}`);
    }
    const acks = acksOf(version, await callsSince(box, from));
    assert.ok(acks.length <= 1, `Orca was asked to acknowledge the batch once at most, got:\n${shownCalls(acks)}`);
  });
}

// #735: only a consuming check that Orca did not answer in time is asked
// again, and only with the same request id. Every other command that writes
// is asked once, after an answer the kit cannot read too: Orca may have done it.
for (const version of ORCA_MODELS) {
  test(`#735 on Orca ${version}: a run-create, a run-use and an ack whose answer is not JSON are each asked once`, async (t) => {
    const garbled = 'orca: something went wrong\n';
    const cases = [
      {
        command: 'orchestration run-create',
        async go(box, bots) {
          const coder = await coderTab(box, bots);
          await forgetMailbox(bots, 'coder', 'daily');
          return { garbage: { command: 'orchestration run-create', text: garbled }, run: () => stepInCoderTab(box, coder) };
        },
        taken: (calls) => takenCallsOf(version, calls, 'orchestration run-create'),
      },
      {
        command: 'orchestration run-use',
        async go(box, bots) {
          const coder = await coderTab(box, bots);
          return { garbage: { command: 'orchestration run-use', text: garbled }, run: () => stepInCoderTab(box, coder) };
        },
        taken: (calls) => takenCallsOf(version, calls, 'orchestration run-use'),
      },
      {
        command: 'orchestration check --ack',
        async go(box) {
          assert.equal((await send(box, 'the staging host')).code, 0);
          return { garbage: { command: 'orchestration check', with: '--ack', text: garbled }, run: () => check(box) };
        },
        taken: (calls) => acksOf(version, calls),
      },
    ];
    for (const one of cases) {
      await t.test(one.command, async (t) => {
        const box = await createSandbox(t);
        const bots = await fleetIn(box);
        const { garbage, run } = await one.go(box, bots);
        await modelOrca(box, version);
        await box.orca.set({ garbage });
        const from = (await box.orca.calls()).length;

        const ran = await run();

        assertNoCrash(ran);
        const taken = one.taken(await callsSince(box, from));
        // On 1.4.255 the kit need not ack at all; when it does, it acks once.
        assert.ok(one.command.endsWith('--ack') ? taken.length <= 1 : taken.length === 1, `${one.command} was asked once, got:\n${shownCalls(taken)}`);
      });
    }
  });
}
