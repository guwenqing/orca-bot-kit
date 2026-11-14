// The helper the live tests list a mailbox through, test/helpers/inbox.js
// `inboxLetters` (#748).
//
// From Orca 1.4.246, `orca orchestration inbox` answers short unless it is
// given `--full`: each letter is `{ id, type, from, to, subject, handled,
// body }`, the body cut to 200 characters, with no `read`, `delivered_at`,
// `run_id`, `to_handle` or `sequence`. Five live tests listed a mailbox with no
// `--full` and read those keys, so on the owner's 1.4.255 each letter read as
// unread, or no letter was found for the test's own Run. Orca 1.4.245 and
// older know `--full` on `inbox`; an Orca that does not is asked again without
// it, on its refusal alone, as the kit's own `orchestration()` in src/orca.js
// does (docs/tech-notes.md, #729 and #730).
//
// What is pinned, against the repo's fake Orca (helpers/fake-orca.js) and,
// where the fake cannot give a case, a small stand-in written here:
//
//   1. On a 1.4.255 Orca the helper answers every column Orca holds: `read: 1`
//      for a letter that was read, `delivered_at`, `run_id`, `to_handle`,
//      `sequence`, and a long body whole. The call carries `--full` and
//      `--json`, and the `terminal` and `limit` it was given; with no
//      `terminal` it carries no `--terminal`. It runs with the `env` it was
//      given, and answers at once, not a promise.
//   2. When Orca refuses `--full` as unknown (`invalid_argument`, "Unknown flag
//      --full for command: …"), the helper asks once more, the same command
//      without `--full`, and answers that list.
//   3. Any other refusal, a crash, an answer that is not JSON, or an answer
//      with no list of letters fails with an AssertionError after one call. A
//      run that cannot start fails the same way.
//   4. No failure shows Orca's stdout, stderr, error message or a letter's
//      text. A list with no `--terminal` holds the mail of everyone on the
//      machine. What is checked is all a test runner prints of the error: its
//      message and everything `util.inspect` shows of it (the stack, `actual`,
//      `expected`, a `cause`).

import assert, { AssertionError } from 'node:assert/strict';
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspect } from 'node:util';

import { createSandbox, orcaCallsOf, orcaFlag, orcaFlags } from './helpers/cli.js';
import { inboxLetters } from './helpers/inbox.js';

/** The Run whose mailbox each test reads. */
const RUN = 'run_inbox_748';

/** Orca's words when its CLI does not know `--full` on `inbox` (docs/tech-notes.md, #729). */
const FULL_UNKNOWN = 'Unknown flag --full for command: orchestration inbox';

/** Text put in Orca's output, its error message or a letter: no failure may show it. */
const SECRET = {
  stdout: 'zq-stdout-damson-5521',
  stderr: 'zq-stderr-medlar-8803',
  message: 'zq-message-loquat-3917',
  data: 'zq-data-sloe-2264',
  body: 'zq-body-greengage-6648',
  subject: 'zq-subject-rowan-1179',
  short: 'zqpear7731',
};

let sequence = 0;

/**
 * One letter as `orchestration inbox --full` answers it: every column Orca
 * 1.4.225 gave (seen live, 2026-10-17), in the shapes of
 * test/health-mail-unannounced.test.js. `read` is 0 or 1.
 */
function letter({ read = 0, deliveredAt = null, body = 'a short body', subject = 'a subject' } = {}) {
  sequence += 1;
  return {
    body,
    created_at: '2026-11-14T01:00:00Z',
    delivered_at: deliveredAt,
    delivery_contract: null,
    from_handle: 'term_sender',
    id: `msg_inbox_${sequence}`,
    payload: null,
    pointer_enter_pending: 0,
    pointer_process_incarnation: null,
    pointer_pty_id: null,
    priority: 'normal',
    read,
    run_id: RUN,
    sender_pane_key: null,
    sequence,
    subject,
    thread_id: null,
    to_handle: `run:${RUN}`,
    type: 'status',
  };
}

/** A sandbox whose fake Orca answers as `version` and holds `letters` in RUN's mailbox. */
async function orcaWith(t, version, letters, changes = {}) {
  const box = await createSandbox(t);
  await box.orca.set({ orcaVersion: version, inbox: { [RUN]: letters }, ...changes });
  return box;
}

/** Every `orchestration inbox` call the fake Orca took, in order. */
const inboxCalls = async (box) => orcaCallsOf(await box.orca.calls(), 'orchestration inbox');

/**
 * Run `call`, insist it fails with an AssertionError, and that nothing a test
 * runner prints of the error holds any of `secrets`.
 */
function failsQuietly(call, secrets, what) {
  let caught;
  let answered;
  try {
    answered = call();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught !== undefined, `${what}: inboxLetters should have failed, and answered ${inspect(answered)}`);
  assert.ok(caught instanceof AssertionError, `${what}: inboxLetters should fail with an AssertionError, and threw ${caught?.name}: ${caught?.message}`);
  const shown = `${caught.message}\n${inspect(caught, { depth: null })}`;
  for (const secret of secrets) {
    assert.ok(!shown.includes(secret), `${what}: the failure shows Orca's text ${secret}, which may be other people's mail`);
  }
  return caught;
}

// ---------------------------------------------------------------- a stand-in

/**
 * A stand-in for Orca in a temp folder, for what the fake cannot give: a call
 * with no `--terminal`, the environment a call runs with, and a second call
 * that fails after a refusal of `--full`. Each call is written to calls.jsonl
 * as `{ args, probe }`, `probe` being the call's INBOX_PROBE variable. The nth
 * call prints the nth of `answers` (the last one for every call after it):
 * `{ json }` as one JSON line with exit status `code` (0 if left out), or
 * `{ stdout, stderr, code }` as given.
 */
async function standIn(t, ...answers) {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-inbox-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const log = path.join(dir, 'calls.jsonl');
  const cli = path.join(dir, 'orca');
  const printed = answers.map(({ json, stdout = '', stderr = '', code = 0 }) => ({
    stdout: json === undefined ? stdout : `${JSON.stringify(json)}\n`,
    stderr,
    code,
  }));
  await writeFile(cli, [
    '#!/usr/bin/env node',
    "const { appendFileSync, readFileSync } = require('node:fs');",
    `const log = ${JSON.stringify(log)};`,
    'let before = 0;',
    "try { before = readFileSync(log, 'utf8').split('\\n').filter((line) => line !== '').length; } catch {}",
    "appendFileSync(log, JSON.stringify({ args: process.argv.slice(2), probe: process.env.INBOX_PROBE }) + '\\n');",
    `const answers = ${JSON.stringify(printed)};`,
    'const answer = answers[Math.min(before, answers.length - 1)];',
    'process.stdout.write(answer.stdout);',
    'process.stderr.write(answer.stderr);',
    'process.exitCode = answer.code;',
    '',
  ].join('\n'));
  await chmod(cli, 0o755);
  const calls = async () => {
    try {
      return (await readFile(log, 'utf8')).split('\n').filter((line) => line !== '').map((line) => JSON.parse(line));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  };
  return { cli, dir, calls };
}

// ------------------------------------------------------------ 1. full columns

test('on Orca 1.4.255 the helper answers every column Orca holds: read, delivered_at, run_id, to_handle, sequence, and a long body whole', async (t) => {
  const long = `${'a letter longer than the short view keeps. '.repeat(8)}end`;
  assert.ok(long.length > 200, 'the premise: the short view of 1.4.255 would cut this body');
  const wasRead = letter({ read: 1, deliveredAt: '2026-11-14T01:00:05Z', body: long });
  const unread = letter();
  const box = await orcaWith(t, '1.4.255', [wasRead, unread]);

  const letters = inboxLetters(box.orca.cli, { terminal: `run:${RUN}`, limit: 5, env: box.env });

  assert.ok(Array.isArray(letters), `inboxLetters answers the list itself, at once, and answered ${inspect(letters)}`);
  assert.deepEqual(letters, [unread, wasRead], 'every column of each letter, newest first, as Orca holds it');
  assert.equal(letters[1].read, 1, 'the letter that was read reads as read, not as unread');
  assert.equal(letters[1].delivered_at, '2026-11-14T01:00:05Z', 'and keeps its delivered_at');
});

test('the call carries --full and --json, and the terminal and limit it was given', async (t) => {
  const box = await orcaWith(t, '1.4.255', [letter()]);

  inboxLetters(box.orca.cli, { terminal: `run:${RUN}`, limit: 7, env: box.env });

  const calls = await inboxCalls(box);
  assert.equal(calls.length, 1, `one call of orchestration inbox, got:\n${calls.map((call) => call.args.join(' ')).join('\n')}`);
  const [call] = calls;
  assert.deepEqual(call.args.slice(0, 2), ['orchestration', 'inbox']);
  assert.deepEqual(orcaFlags(call), ['--full', '--json', '--limit', '--terminal']);
  assert.equal(orcaFlag(call, '--terminal'), `run:${RUN}`);
  assert.equal(orcaFlag(call, '--limit'), '7');
});

test('the limit reaches Orca: of three letters, a limit of 2 answers the two newest', async (t) => {
  const [oldest, middle, newest] = [letter(), letter({ read: 1 }), letter()];
  const box = await orcaWith(t, '1.4.255', [oldest, middle, newest]);

  const letters = inboxLetters(box.orca.cli, { terminal: `run:${RUN}`, limit: 2, env: box.env });

  assert.deepEqual(letters, [newest, middle]);
});

test('with no terminal the call carries no --terminal, and still --full, --json and the limit', async (t) => {
  const listed = [letter({ read: 1, deliveredAt: '2026-11-14T01:00:05Z' })];
  const orca = await standIn(t, { json: { id: 'x', ok: true, result: { messages: listed, count: 1 } } });

  const letters = inboxLetters(orca.cli, { limit: 9, env: process.env });

  assert.deepEqual(letters, listed);
  const calls = await orca.calls();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(0, 2), ['orchestration', 'inbox']);
  assert.deepEqual(orcaFlags(calls[0]), ['--full', '--json', '--limit']);
  assert.equal(orcaFlag(calls[0], '--limit'), '9');
});

test('the call runs with the env it was given', async (t) => {
  const orca = await standIn(t, { json: { id: 'x', ok: true, result: { messages: [] } } });
  const probe = 'zq-probe-quince-4120';
  assert.notEqual(process.env.INBOX_PROBE, probe, 'the premise: the test runner does not carry the probe');

  inboxLetters(orca.cli, { terminal: `run:${RUN}`, limit: 3, env: { ...process.env, INBOX_PROBE: probe } });

  const calls = await orca.calls();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].probe, probe);
});

// ------------------------------------------------------- 2. --full refused

test('an Orca that refuses --full as unknown is asked once more, the same command without it, and that list is the answer', async (t) => {
  const listed = [letter({ read: 1, deliveredAt: '2026-11-14T01:00:05Z' }), letter()];
  const box = await orcaWith(t, '1.4.245', listed, {
    fail: { 'orchestration inbox': { code: 'invalid_argument', message: FULL_UNKNOWN, with: '--full' } },
  });

  const letters = inboxLetters(box.orca.cli, { terminal: `run:${RUN}`, limit: 5, env: box.env });

  assert.deepEqual(letters, [listed[1], listed[0]], 'the list of the call without --full, every column');
  const calls = await inboxCalls(box);
  assert.equal(calls.length, 2, `two calls of orchestration inbox, got:\n${calls.map((call) => call.args.join(' ')).join('\n')}`);
  assert.ok(calls[0].args.includes('--full'), 'the first call carries --full');
  assert.deepEqual(calls[1].args, calls[0].args.filter((arg) => arg !== '--full'), 'the second is the same command without --full');
});

test('when the call without --full fails too, the helper fails, shows nothing of Orca\'s, and asks no third time', async (t) => {
  const refusedFull = { id: 'x', ok: false, error: { code: 'invalid_argument', message: FULL_UNKNOWN, data: {} } };
  const refusedAgain = { id: 'y', ok: false, error: { code: 'runtime_error', message: SECRET.message, data: { quoted: SECRET.data } } };
  const listed = { id: 'z', ok: true, result: { messages: [letter({ body: SECRET.body })] } };
  const orca = await standIn(t, { json: refusedFull, code: 1 }, { json: refusedAgain, code: 1, stderr: SECRET.stderr }, { json: listed });

  failsQuietly(
    () => inboxLetters(orca.cli, { terminal: `run:${RUN}`, limit: 5, env: process.env }),
    [SECRET.message, SECRET.data, SECRET.stderr, SECRET.body],
    'a refusal of --full, then another refusal',
  );
  const calls = await orca.calls();
  assert.equal(calls.length, 2, `two calls, got:\n${calls.map((call) => call.args.join(' ')).join('\n')}`);
  assert.ok(calls[0].args.includes('--full'), 'the first call carries --full');
  assert.deepEqual(calls[1].args, calls[0].args.filter((arg) => arg !== '--full'), 'the second is the same command without --full');
});

// --------------------------------------------------- 3 and 4. every failure

/** Each other refusal: none of them is a refusal of --full as unknown. */
const OTHER_REFUSALS = [
  ['an invalid_argument with another message', 'invalid_argument', `this fake reads no such inbox ${SECRET.message}`],
  ['an unknown flag that is not --full', 'invalid_argument', `Unknown flag --fuller for command: orchestration inbox ${SECRET.message}`],
  ['the words of the --full refusal, not at the start', 'invalid_argument', `orca: ${FULL_UNKNOWN} ${SECRET.message}`],
  ['the words of the --full refusal under another code', 'runtime_error', `${FULL_UNKNOWN} ${SECRET.message}`],
  ['a runtime that is not there', 'runtime_unavailable', `the orchestration runtime is not running ${SECRET.message}`],
];

for (const [what, code, message] of OTHER_REFUSALS) {
  test(`${what} fails with an AssertionError after one call, and shows nothing of Orca's`, async (t) => {
    const box = await orcaWith(t, '1.4.255', [letter({ body: SECRET.body, subject: SECRET.subject })], {
      fail: { 'orchestration inbox': { code, message, data: { quoted: SECRET.data } } },
    });

    failsQuietly(
      () => inboxLetters(box.orca.cli, { terminal: `run:${RUN}`, limit: 5, env: box.env }),
      [SECRET.message, SECRET.data, SECRET.body, SECRET.subject],
      what,
    );
    const calls = await inboxCalls(box);
    assert.equal(calls.length, 1, `${what}: one call of orchestration inbox, got:\n${calls.map((call) => call.args.join(' ')).join('\n')}`);
  });
}

test('a crash, with no JSON and a bad exit status, fails after one call and shows neither stdout nor stderr', async (t) => {
  const box = await orcaWith(t, '1.4.255', [letter()], {
    crash: { command: 'orchestration inbox', exitCode: 3, stdout: SECRET.stdout, stderr: SECRET.stderr },
  });

  failsQuietly(
    () => inboxLetters(box.orca.cli, { terminal: `run:${RUN}`, limit: 5, env: box.env }),
    [SECRET.stdout, SECRET.stderr],
    'a crash',
  );
  assert.equal((await inboxCalls(box)).length, 1);
});

test('an answer that is not JSON fails after one call and shows none of it, not even in a parse error', async (t) => {
  // JSON.parse quotes the first 10 characters of what it could not read
  // ("Unexpected token 'z', "zqpear7731" is not valid JSON"), so the first
  // answer is a secret of 10 characters and nothing else.
  assert.equal(SECRET.short.length, 10, 'the premise: JSON.parse would quote all of it');
  const answers = [
    ['a short answer', `${SECRET.short}\n`, [SECRET.short]],
    ['a long answer with a letter in it', `${SECRET.stdout} {"body":"${SECRET.body}"}\n`, [SECRET.stdout, SECRET.body]],
  ];
  for (const [what, text, secrets] of answers) {
    await t.test(what, async (tt) => {
      const box = await orcaWith(tt, '1.4.255', [letter()], { garbage: { command: 'orchestration inbox', text } });

      failsQuietly(
        () => inboxLetters(box.orca.cli, { terminal: `run:${RUN}`, limit: 5, env: box.env }),
        secrets,
        `${what} that is not JSON`,
      );
      assert.equal((await inboxCalls(box)).length, 1, `${what}: one call`);
    });
  }
});

test('an ok answer with no list of letters fails after one call and shows no letter', async (t) => {
  const shapes = [
    ['messages is an object', { messages: { one: { body: SECRET.body, subject: SECRET.subject } } }],
    ['messages is a string', { messages: SECRET.body }],
    ['there is no messages', { letters: [{ body: SECRET.body }] }],
  ];
  for (const [what, result] of shapes) {
    await t.test(what, async (tt) => {
      const box = await orcaWith(tt, '1.4.255', [letter()], { answerAs: { command: 'orchestration inbox', result } });

      failsQuietly(
        () => inboxLetters(box.orca.cli, { terminal: `run:${RUN}`, limit: 5, env: box.env }),
        [SECRET.body, SECRET.subject],
        what,
      );
      assert.equal((await inboxCalls(box)).length, 1, `${what}: one call`);
    });
  }
});

test('a run that cannot start fails with an AssertionError', async (t) => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-inbox-')));
  t.after(() => rm(dir, { recursive: true, force: true }));

  failsQuietly(
    () => inboxLetters(path.join(dir, 'no-such-orca'), { terminal: `run:${RUN}`, limit: 5, env: process.env }),
    [],
    'an orca that is not there',
  );
});
