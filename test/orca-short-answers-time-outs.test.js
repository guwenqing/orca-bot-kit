// No Orca command that writes runs twice in effect, on Orca 1.4.255 and on
// Orca 1.4.245 (#729): the time-outs. The refusals are in
// test/orca-short-answers-writes-once.test.js, which says why.
//
// An Orca that does not answer in time may have done what it was asked. So a
// kit that asks again, with `--full` or without it, may make a second Run,
// bind twice, or take a second batch nobody sees. Here Orca does the command
// at once and holds its answer back for a minute (the fake's `hang` with
// `applied: true`), past the twenty seconds the kit gives each mailbox call,
// and the kit asks it once.
//
// Each case waits those twenty seconds out, so they run side by side.
// `obk message send` gives Orca no time limit of its own, so a send that times
// out cannot be made here: a slow send is answered, however late.

import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';
import { stringify } from 'yaml';

import { bookIn, bookOf, createSandbox, mailboxStep, sessionIn, sh } from './helpers/cli.js';
import { acksOf, consumingChecks, modelOrca, ORCA_MODELS, shownCalls, takenCallsOf } from './helpers/orca-versions.js';

/** How long Orca holds its answer back: far past the kit's own limit for a call. */
const HANG_MS = 60_000;

/** Each case's own limit: the kit's twenty seconds, its setup, and a busy machine. */
const CASE_MS = 120_000;

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

/** Put one letter in coder's mailbox, from writer. */
async function mailCoder(box) {
  const sent = await box.run([
    'message', 'send', '--bots', 'bots', '--to', 'coder', '--from', 'writer/daily',
    '--subject', 'the staging host', '--text', 'It is down again.',
  ]);
  assert.equal(sent.code, 0, sent.stderr);
}

/** `obk message check` for coder's one session. */
const check = (box) => box.run(['message', 'check', '--bots', 'bots', '--bot', 'coder', '--session', 'daily']);

/** The calls made since the first `from` of them. */
const callsSince = async (box, from) => (await box.orca.calls()).slice(from);

/** Run `go`, and insist it gave up on Orca rather than waiting its minute out, and did not crash. */
async function gaveUp(go) {
  const started = Date.now();
  const result = await go();
  const took = Date.now() - started;
  assert.ok(took < HANG_MS, `it gave up on Orca before Orca answered, after ${took} ms`);
  assert.ok(!/^\s+at /m.test(`${result.stdout}${result.stderr}`), `a message, not a crash:\n${result.stdout}${result.stderr}`);
  return result;
}

test('#729 10: a command that writes and that Orca does not answer in time is asked once, on each Orca', { concurrency: true }, async (t) => {
  const cases = [];
  for (const version of ORCA_MODELS) {
    cases.push(t.test(`on Orca ${version}: a run-create Orca did and did not answer is asked once`, { timeout: CASE_MS }, async (t) => {
      const box = await createSandbox(t);
      const bots = await fleetIn(box);
      const coder = await coderTab(box, bots);
      await forgetMailbox(bots, 'coder', 'daily');
      await modelOrca(box, version);
      await box.orca.set({ hang: { command: 'orchestration run-create', ms: HANG_MS, applied: true } });
      const from = (await box.orca.calls()).length;

      await gaveUp(() => stepInCoderTab(box, coder));

      const made = takenCallsOf(version, await callsSince(box, from), 'orchestration run-create');
      assert.equal(made.length, 1, `Orca was asked for one Run, got:\n${shownCalls(made)}`);
    }));

    cases.push(t.test(`on Orca ${version}: a run-use Orca did and did not answer is asked once`, { timeout: CASE_MS }, async (t) => {
      const box = await createSandbox(t);
      const bots = await fleetIn(box);
      const coder = await coderTab(box, bots);
      await modelOrca(box, version);
      await box.orca.set({ hang: { command: 'orchestration run-use', ms: HANG_MS, applied: true } });
      const from = (await box.orca.calls()).length;

      await gaveUp(() => stepInCoderTab(box, coder));

      const calls = await callsSince(box, from);
      const bound = takenCallsOf(version, calls, 'orchestration run-use');
      assert.equal(bound.length, 1, `Orca was asked to bind the mailbox once, got:\n${shownCalls(bound)}`);
      assert.deepEqual(takenCallsOf(version, calls, 'orchestration run-create'), [], 'and made no Run in its place');
    }));

    cases.push(t.test(`on Orca ${version}: a consuming check Orca did and did not answer is asked once`, { timeout: CASE_MS }, async (t) => {
      const box = await createSandbox(t);
      await fleetIn(box);
      await mailCoder(box);
      await modelOrca(box, version);
      await box.orca.set({ hang: { command: 'orchestration check', ms: HANG_MS, applied: true } });
      const from = (await box.orca.calls()).length;

      await gaveUp(() => check(box));

      const reads = consumingChecks(version, await callsSince(box, from));
      assert.equal(reads.length, 1, `Orca was asked for the mail once, got:\n${shownCalls(reads)}`);
    }));

    cases.push(t.test(`on Orca ${version}: an acknowledgement Orca did and did not answer is asked at most once`, { timeout: CASE_MS }, async (t) => {
      // On 1.4.245 the kit must acknowledge what it showed; on 1.4.255 a plain
      // check has done so already, and whether the kit acks too is its own.
      const box = await createSandbox(t);
      await fleetIn(box);
      await mailCoder(box);
      await modelOrca(box, version);
      await box.orca.set({ hang: { command: 'orchestration check', with: '--ack', ms: HANG_MS, applied: true } });
      const from = (await box.orca.calls()).length;

      const result = await gaveUp(() => check(box));

      assert.ok(result.stdout.includes('the staging host'), `the letter handed over is shown, got:\n${result.stdout}${result.stderr}`);
      const acks = acksOf(version, await callsSince(box, from));
      assert.ok(acks.length <= 1, `Orca was asked to acknowledge the batch once at most, got:\n${shownCalls(acks)}`);
    }));
  }
  await Promise.all(cases);
});
