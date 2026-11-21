// The helper the live tests read one Run through, test/helpers/run-show.js
// `runRecord` (#847).
//
// From Orca 1.4.246, `orca orchestration run-show --id <id> --json` answers
// short unless it is given `--full`: `{ runId, objective, removedWork }`, with
// no `run` and no `coordinator_handle`. With `--full` it answers `{ run: { id,
// objective, coordinator_handle, ... }, removedWork }`. Orca 1.4.245 and older
// refuse `--full` on `run-show` with `invalid_argument`, "Unknown flag --full
// for command: orchestration run-show", and do nothing; without the flag they
// answer the full record (docs/tech-notes.md, #729 and #730). A live test read
// `result.run.coordinator_handle` from the short answer on 1.4.263 and failed
// with a TypeError (#847).
//
// What is pinned, against the repo's fake Orca (helpers/fake-orca.js), which
// answers `run-show` by Orca version, and a small stand-in written here for
// the one case the fake cannot give (a call with no `env`):
//
//   R1. On an Orca that answers short (1.4.246 and later), `runRecord` answers
//       the Run's full record, with its real `coordinator_handle`: the handle
//       of the tab it is bound to, or null when it is bound to none.
//   R2. On an Orca that refuses `--full` as unknown (1.4.245 and older),
//       `runRecord` asks again without the flag and answers the full record.
//   R3. Any other refusal (for example `run_not_found`) fails with an
//       AssertionError and is not asked again; the message names the command
//       and Orca's error code.
//   R4. An ok answer with no `result.run` object fails.

import assert, { AssertionError } from 'node:assert/strict';
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspect } from 'node:util';

import { createSandbox, orcaCallsOf, orcaFlag, orcaFlags } from './helpers/cli.js';
import { runRecord } from './helpers/run-show.js';

/** Orca's words when its CLI does not know `--full` on `run-show` (docs/tech-notes.md, #729). */
const FULL_UNKNOWN = 'Unknown flag --full for command: orchestration run-show';

/** The tab a Run is bound to in these tests. */
const TAB = 'term_runshow_847a';

/**
 * One Run as Orca keeps it, field for field as the full `run-show` answers it
 * (seen live on 1.4.255, docs/tech-notes.md).
 */
function run(id, { objective = `mailbox of ${id}`, coordinator = TAB, legacy = false } = {}) {
  return {
    id,
    objective,
    coordinator_handle: coordinator,
    consumer_generation: 0,
    legacy,
    created_at: '2026-11-21T01:00:00.000Z',
    updated_at: '2026-11-21T01:00:05.000Z',
  };
}

/** A sandbox whose fake Orca answers as `version` and holds `runs`. */
async function orcaWith(t, version, runs, changes = {}) {
  const box = await createSandbox(t);
  await box.orca.set({ orcaVersion: version, runs, ...changes });
  return box;
}

/** Every `orchestration run-show` call the fake Orca took, in order. */
const runShowCalls = async (box) => orcaCallsOf(await box.orca.calls(), 'orchestration run-show');

const listed = (calls) => calls.map((call) => call.args.join(' ')).join('\n');

/**
 * Run `call`, insist it throws, and answer the error. With `assertion` (the
 * default) the error must be an AssertionError.
 */
function failsWithAssertion(call, what, { assertion = true } = {}) {
  let caught;
  let answered;
  try {
    answered = call();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught !== undefined, `${what}: runRecord should have failed, and answered ${inspect(answered)}`);
  if (assertion) assert.ok(caught instanceof AssertionError, `${what}: runRecord should fail with an AssertionError, and threw ${caught?.name}: ${caught?.message}`);
  return caught;
}

// ---------------------------------------------------------------- a stand-in

/**
 * A stand-in for Orca in a temp folder, for a call with no `env`: the fake
 * Orca finds its state only through the sandbox's environment. Each call is
 * written to calls.jsonl as `{ args }`, and every call prints `json` as one
 * JSON line.
 */
async function standIn(t, json) {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-run-show-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const log = path.join(dir, 'calls.jsonl');
  const cli = path.join(dir, 'orca');
  await writeFile(cli, [
    '#!/usr/bin/env node',
    "const { appendFileSync } = require('node:fs');",
    `appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2) }) + '\\n');`,
    `process.stdout.write(${JSON.stringify(`${JSON.stringify(json)}\n`)});`,
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
  return { cli, calls };
}

// ------------------------------------------- R1. an Orca that answers short

for (const version of ['1.4.246', '1.4.263']) {
  test(`R1: on Orca ${version} runRecord answers the Run's full record, bound to its tab`, async (t) => {
    const wanted = run('run_847_new', { coordinator: TAB });
    const other = run('run_847_other', { coordinator: 'term_runshow_847b' });
    const box = await orcaWith(t, version, [other, wanted]);

    const record = runRecord(box.orca.cli, 'run_847_new', { env: box.env });

    assert.deepEqual(record, wanted, 'every field of the Run asked for, as Orca keeps it');
    assert.equal(record?.coordinator_handle, TAB, 'the handle of the tab the Run is bound to');
  });
}

test('R1: on Orca 1.4.263 a Run bound to no tab answers coordinator_handle null, not a missing field', async (t) => {
  const unbound = run('run_847_unbound', { coordinator: null });
  const box = await orcaWith(t, '1.4.263', [run('run_847_bound'), unbound]);

  const record = runRecord(box.orca.cli, 'run_847_unbound', { env: box.env });

  assert.ok(record !== null && typeof record === 'object', `runRecord answers the record, and answered ${inspect(record)}`);
  assert.ok(Object.hasOwn(record, 'coordinator_handle'), `the record carries coordinator_handle, got ${inspect(record)}`);
  assert.equal(record.coordinator_handle, null);
  assert.deepEqual(record, unbound);
});

test('R1: on Orca 1.4.263 the one call is run-show of the id given, with --full and --json', async (t) => {
  const box = await orcaWith(t, '1.4.263', [run('run_847_new')]);

  runRecord(box.orca.cli, 'run_847_new', { env: box.env });

  const calls = await runShowCalls(box);
  assert.equal(calls.length, 1, `one call of orchestration run-show, got:\n${listed(calls)}`);
  assert.deepEqual(calls[0].args.slice(0, 2), ['orchestration', 'run-show']);
  assert.deepEqual(orcaFlags(calls[0]), ['--full', '--id', '--json']);
  assert.equal(orcaFlag(calls[0], '--id'), 'run_847_new');
});

test('R1: with no options the call runs with the test runner\'s own environment, and answers the record', async (t) => {
  const wanted = run('run_847_plain');
  const orca = await standIn(t, { id: 'x', ok: true, result: { run: wanted, removedWork: [] } });

  const record = runRecord(orca.cli, 'run_847_plain');

  assert.deepEqual(record, wanted);
  const calls = await orca.calls();
  assert.equal(calls.length, 1, `one call, got:\n${listed(calls)}`);
  assert.equal(orcaFlag(calls[0], '--id'), 'run_847_plain');
});

// ------------------------------------------------ R2. --full refused as unknown

for (const version of ['1.4.245', '1.4.209']) {
  test(`R2: on Orca ${version}, which refuses --full, runRecord asks again without it and answers the full record`, async (t) => {
    const wanted = run('run_847_old', { coordinator: TAB });
    const box = await orcaWith(t, version, [run('run_847_other', { coordinator: 'term_runshow_847b' }), wanted]);

    const record = runRecord(box.orca.cli, 'run_847_old', { env: box.env });

    assert.deepEqual(record, wanted, 'every field of the Run asked for, from the call without --full');
    assert.equal(record?.coordinator_handle, TAB);
    const calls = await runShowCalls(box);
    assert.equal(calls.length, 2, `two calls of orchestration run-show, got:\n${listed(calls)}`);
    assert.ok(calls[0].args.includes('--full'), 'the first call carries --full');
    assert.deepEqual(calls[1].args, calls[0].args.filter((arg) => arg !== '--full'), 'the second is the same command without --full');
    assert.equal(orcaFlag(calls[1], '--id'), 'run_847_old');
  });
}

test('R2: on Orca 1.4.245 a Run bound to no tab answers coordinator_handle null', async (t) => {
  const unbound = run('run_847_old_unbound', { coordinator: null });
  const box = await orcaWith(t, '1.4.245', [unbound]);

  const record = runRecord(box.orca.cli, 'run_847_old_unbound', { env: box.env });

  assert.deepEqual(record, unbound);
});

// ---------------------------------------------------- R3. any other refusal

test('R3: on Orca 1.4.263 a Run Orca does not have fails with an AssertionError naming the command and run_not_found, after one call', async (t) => {
  const box = await orcaWith(t, '1.4.263', [run('run_847_new')]);

  const error = failsWithAssertion(() => runRecord(box.orca.cli, 'run_847_never', { env: box.env }), 'a Run Orca never made');

  assert.ok(error.message.includes('orchestration run-show'), `the message names the command, got: ${error.message}`);
  assert.ok(error.message.includes('run_not_found'), `the message names Orca's error code, got: ${error.message}`);
  const calls = await runShowCalls(box);
  assert.equal(calls.length, 1, `one call of orchestration run-show, got:\n${listed(calls)}`);
});

test('R3: on Orca 1.4.245 a Run Orca does not have fails naming run_not_found, and is asked no third time', async (t) => {
  const box = await orcaWith(t, '1.4.245', [run('run_847_old')]);

  const error = failsWithAssertion(() => runRecord(box.orca.cli, 'run_847_never', { env: box.env }), 'a Run an old Orca never made');

  assert.ok(error.message.includes('orchestration run-show'), `the message names the command, got: ${error.message}`);
  assert.ok(error.message.includes('run_not_found'), `the message names Orca's error code, got: ${error.message}`);
  const calls = await runShowCalls(box);
  assert.equal(calls.length, 2, `the call with --full, then the one without, got:\n${listed(calls)}`);
  assert.ok(calls[0].args.includes('--full'), 'the first call carries --full');
  assert.ok(!calls[1].args.includes('--full'), 'the second does not');
});

/** Each other refusal: none of them is a refusal of --full as unknown. */
const OTHER_REFUSALS = [
  ['an invalid_argument with another message', 'invalid_argument', 'run-show needs --id'],
  ['an unknown flag that is not --full', 'invalid_argument', 'Unknown flag --fuller for command: orchestration run-show'],
  ['the words of the --full refusal, not at the start', 'invalid_argument', `orca: ${FULL_UNKNOWN}`],
  ['the words of the --full refusal under another code', 'runtime_error', FULL_UNKNOWN],
  ['a runtime that is not there', 'runtime_unavailable', 'the orchestration runtime is not running'],
];

for (const [what, code, message] of OTHER_REFUSALS) {
  test(`R3: ${what} fails with an AssertionError naming the command and ${code}, after one call`, async (t) => {
    const box = await orcaWith(t, '1.4.263', [run('run_847_new')], {
      fail: { 'orchestration run-show': { code, message } },
    });

    const error = failsWithAssertion(() => runRecord(box.orca.cli, 'run_847_new', { env: box.env }), what);

    assert.ok(error.message.includes('orchestration run-show'), `${what}: the message names the command, got: ${error.message}`);
    assert.ok(error.message.includes(code), `${what}: the message names Orca's error code ${code}, got: ${error.message}`);
    const calls = await runShowCalls(box);
    assert.equal(calls.length, 1, `${what}: one call of orchestration run-show, got:\n${listed(calls)}`);
  });
}

// ------------------------------------------------- R4. an ok answer, no run

const NO_RUN = [
  ['the short answer, as if --full were left out', { runId: 'run_847_new', objective: 'mailbox of run_847_new', removedWork: [] }],
  ['run is null', { run: null, removedWork: [] }],
  ['run is a string', { run: 'run_847_new', removedWork: [] }],
  ['the result is empty', {}],
];

for (const [what, result] of NO_RUN) {
  test(`R4: an ok answer with no run object fails: ${what}`, async (t) => {
    const box = await orcaWith(t, '1.4.263', [run('run_847_new')], {
      answerAs: { command: 'orchestration run-show', result },
    });

    // R4 asks only that it throws, not which kind of error.
    failsWithAssertion(() => runRecord(box.orca.cli, 'run_847_new', { env: box.env }), what, { assertion: false });
  });
}
