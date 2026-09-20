// Orca not answering. Before any Orca work, `init` and `up` check that Orca is
// there: `orca status --json` saying `ok: true` with a runtime that calls
// itself reachable. When it does not, the command changes nothing at all — no
// folder seeded, no file written — and exits 1 with a message, not a stack.
//
// A call that fails later passes Orca's own message on, so the person reading
// it learns what Orca refused, not that some promise rejected.

import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  assertCleanFailure,
  createSandbox,
  orcaCommand,
  skipGit,
  snapshot,
} from './helpers/cli.js';

/** Orca was asked whether it is there, and nothing else was asked of it. */
async function assertOnlyAskedForStatus(box) {
  assert.deepEqual(
    (await box.orca.calls()).map(orcaCommand),
    ['status'],
    'once Orca is out, the kit must stop asking it for things',
  );
}

/** Every way Orca can be out, and how the fake is told to behave that way. */
const OUTAGES = {
  'a status that answers nothing but an error code': { crash: { command: 'status', exitCode: 1, stderr: 'orca: could not reach the app\n' } },
  'a status that prints something other than JSON': { garbage: { command: 'status', text: 'Orca is starting up…\n' } },
  'a status that answers ok: false': { status: { id: 'x', ok: false, error: { code: 'runtime_unavailable', message: 'the runtime is not running' } } },
  'a status that answers null': { status: null },
  'a runtime that is not reachable': { reachable: false },
  'a status with no runtime in it': { status: { id: 'x', ok: true, result: { app: { running: true } } } },
};

for (const [label, outage] of Object.entries(OUTAGES)) {
  test(`init stops at ${label} and writes nothing`, async (t) => {
    const box = await createSandbox(t);
    await box.orca.set(outage);

    const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

    assertCleanFailure(result);
    assert.match(result.stderr, /orca/i, `the message should name Orca, got: ${result.stderr}`);
    assert.ok(result.stderr.includes('OBK_ORCA'), `should say how to point the kit at Orca, got: ${result.stderr}`);
    assert.deepEqual(await readdir(box.cwd), [], 'nothing at all should have been written');
    await assertOnlyAskedForStatus(box);
  });
}

test('init stops when the Orca CLI is not there at all, and writes nothing', async (t) => {
  const box = await createSandbox(t);
  const missing = path.join(box.root, 'no-such-place', 'orca');

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude'], {
    env: { ...box.env, OBK_ORCA: missing },
  });

  assertCleanFailure(result);
  assert.match(result.stderr, /orca/i, `the message should name Orca, got: ${result.stderr}`);
  assert.ok(result.stderr.includes('OBK_ORCA'), `should say how to point the kit at Orca, got: ${result.stderr}`);
  assert.deepEqual(await readdir(box.cwd), []);
  assert.deepEqual(await box.orca.calls(), [], 'the fake was not the CLI this run looked for');
});

test('init passes on what Orca said when its status failed', async (t) => {
  const box = await createSandbox(t);
  await box.orca.set({
    status: { id: 'x', ok: false, error: { code: 'runtime_unavailable', message: 'the runtime is not running' } },
  });

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assertCleanFailure(result);
  assert.ok(
    result.stderr.includes('the runtime is not running'),
    `should pass Orca's own message on, got: ${result.stderr}`,
  );
});

test('up stops when Orca is out, and changes no file', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const before = await snapshot(bots, skipGit);
  const calls = (await box.orca.calls()).length;
  await box.orca.set({ reachable: false });

  const result = await box.run(['up', '--bots', 'bots']);

  assertCleanFailure(result);
  assert.deepEqual(await snapshot(bots, skipGit), before, 'every file should be byte-identical');
  assert.deepEqual(
    (await box.orca.calls()).slice(calls).map(orcaCommand),
    ['status'],
    'once Orca is out, the kit must stop asking it for things',
  );
});

for (const command of [
  'project setups',
  'repo add',
  'project setup-update',
  'terminal list',
  'terminal create',
  'terminal send',
]) {
  test(`init passes on what Orca said when \`${command}\` failed`, async (t) => {
    const box = await createSandbox(t);
    await box.orca.set({ fail: { [command]: { code: 'orca_refused', message: `${command} is not having it today` } } });

    const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

    assertCleanFailure(result);
    assert.ok(
      result.stderr.includes(`${command} is not having it today`),
      `should pass Orca's own message on, got: ${result.stderr}`,
    );
  });
}

test('a wait that runs out of time is not a failure: it means no harness came up', async (t) => {
  // The one refusal the kit swallows. `tui-idle` asks about a TUI, and a tab
  // that has none is refused with `timeout`, however long the wait. After the
  // harness has been typed in, that answer means it did not start — which the
  // run reports and carries on from.
  const box = await createSandbox(t);
  await box.orca.set({ fail: { 'terminal wait': { code: 'timeout', message: 'timeout' } } });

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assert.equal(result.code, 0, `a harness that did not come up is not a failure: ${result.stderr}`);
  assert.equal(result.stderr, '');
  assert.ok(result.stdout.includes('Bot Father daily'), `should name the tab, got: ${result.stdout}`);
});

test('any other refusal from a wait is passed on, and the run fails', async (t) => {
  // Only `timeout` means "busy". Anything else is Orca refusing, and the kit
  // must not swallow it.
  const box = await createSandbox(t);
  await box.orca.set({
    fail: { 'terminal wait': { code: 'terminal_not_found', message: 'no terminal with handle term_7' } },
  });

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assertCleanFailure(result);
  assert.ok(
    result.stderr.includes('no terminal with handle term_7'),
    `should pass Orca's own message on, got: ${result.stderr}`,
  );
});

test('init reports an Orca call that died without answering', async (t) => {
  const box = await createSandbox(t);
  await box.orca.set({
    crash: { command: 'terminal list', exitCode: 2, stderr: 'orca: the runtime went away\n' },
  });

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assertCleanFailure(result);
  assert.match(result.stderr, /orca/i, `the message should name Orca, got: ${result.stderr}`);
});

test('init reports an Orca answer that is not JSON', async (t) => {
  const box = await createSandbox(t);
  await box.orca.set({ garbage: { command: 'project setups', text: 'Setups:\n  bot-father\n' } });

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assertCleanFailure(result);
  assert.match(result.stderr, /orca/i, `the message should name Orca, got: ${result.stderr}`);
});

test('a failed Orca call opens no half a workspace', async (t) => {
  const box = await createSandbox(t);
  await box.orca.set({ fail: { 'terminal create': { code: 'selector_not_found', message: 'no worktree matches' } } });

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assertCleanFailure(result);
  assert.deepEqual(await box.orca.terminals(), [], 'a create that fails leaves no tab');
});
