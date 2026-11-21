// The kit asks Orca's runtime through Orca's own runtime client, and a client
// that is not where the kit looks is said, not hidden (#844).
//
// The kit loads Orca's runtime client out of the installed app and runs it with
// the app's binary as plain Node (ADR 0057): for the window call after a
// project is made or renamed, and, where `ps` cannot run, for
// `terminal.inspectProcess`. A real Orca has the client at
// `<Orca.app>/Contents/Resources/app.asar.unpacked/out/cli/runtime/client.js`;
// the installed Orca 1.4.263 has no `out/cli/runtime-client.js`. The kit used
// to look at that old place, and both calls failed quietly on a current Orca.
// The fake app (`orcaApp` in helpers/cli.js) now puts its client at the real
// place, so every test that relies on the client (test/orca-window.test.js,
// test/front-without-ps.test.js and the other users of `orcaApp`) holds the
// kit to the real layout. This file holds what is new:
//
//   R3  When the Orca app is there with its binary, and no client file is at
//       the place the kit looks, the "cannot tell" answer for the front-process
//       question names the missing file by its full path and says that Orca's
//       runtime client is not there. Everything else about cannot tell stays:
//       nothing is typed, the letter still goes, the command does not fail.
//   R3  Where the client file is there but the call goes wrong (no
//       `RuntimeClient` export, the call rejects, never settles or hangs), and
//       where there is no Orca app at all or no binary in it, the answer does
//       not say that the client file is missing.
//
// The window call stays silent in every case (test/orca-window.test.js, W7:
// `up` says exactly what it says when the call works, with the client file
// missing too).
//
// The wording is the implementer's. Only the full path, the words "runtime
// client" and words that say it is not there are pinned
// (helpers/client-missing.js).
//
// The front-process question is reached as test/front-without-ps.test.js
// reaches it: from Codex's sandbox, where the fake `ps` does not start, an
// `obk message send --interrupt` to a busy Codex receiver.

import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { RUNTIME_CLIENT_IN_CONTENTS, createSandbox, orcaApp, sentInto } from './helpers/cli.js';
import { namesClientMissing, saysClientMissing } from './helpers/client-missing.js';

/** The kit could not tell whether a harness is in the tab (#232). */
const COULD_NOT_TELL = /tell/i;

/**
 * A Claude bot that writes and a Codex bot that reads, both up, nothing typed
 * since, and every tab busy by Orca's tui-idle wait.
 */
async function fleetIn(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  for (const [bot, harness] of [['writer', 'claude'], ['coder', 'codex']]) {
    assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness])).code, 0);
    assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', 'daily'])).code, 0);
  }
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  await box.orca.set({ waitIdle: 'busy' });
}

/** From here on `ps` does not start, for any pid, as inside Codex's sandbox. */
const sandboxPs = (box) => box.orca.set({ ps: 'not-permitted' });

/**
 * Send one urgent letter to the Codex reader with --interrupt, plain, and
 * answer what it printed. The letter goes whatever became of the interrupt.
 */
async function send(box) {
  const result = await box.run([
    'message', 'send', '--bots', 'bots', '--to', 'coder', '--from', 'writer/daily',
    '--subject', 'the staging host', '--text', 'It is down again.', '--interrupt',
  ]);
  assert.equal(result.code, 0, `the letter went whatever became of the interrupt: ${result.stdout}${result.stderr}`);
  return `${result.stdout}${result.stderr}`;
}

/** Cannot tell, as #232 has it: the output says so, the letter is in the mailbox, and nothing went into any tab. */
async function assertCouldNotTell(box, said, what) {
  assert.match(said, COULD_NOT_TELL, `${what}: the output says the kit could not tell, got: ${said}`);
  assert.equal((await box.orca.messages()).length, 1, `${what}: the letter is in the mailbox`);
  const typed = (await box.orca.terminals()).flatMap((terminal) => sentInto(terminal).slice(1));
  assert.deepEqual(typed, [], `${what}: and nothing went into any tab after its launch line`);
}

const exists = (file) => access(file).then(() => true, () => false);

// ---------------------------------------------------------------------------
// R3 — the app and its binary are there, the client file is not: the answer names it.
// ---------------------------------------------------------------------------

test('R3 with the Orca app and its binary there and no client file at out/cli/runtime/client.js, the answer names that file by its full path and says the runtime client is not there', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);
  const app = await orcaApp(box, { client: 'missing' });
  await sandboxPs(box);
  const clientFile = path.join(box.root, 'Orca.app', 'Contents', ...RUNTIME_CLIENT_IN_CONTENTS);
  assert.equal(app.clientFile, clientFile, 'the premise: the fake app is laid out where a real Orca has its client');
  assert.equal(await exists(path.join(app.contents, 'MacOS', 'Orca')), true, 'the premise: the app\'s binary is there');
  assert.equal(await exists(clientFile), false, 'the premise: no client file is there');

  const said = await send(box);

  await assertCouldNotTell(box, said, 'no client file');
  assert.ok(said.includes(clientFile), `the answer names the missing file by its full path, ${clientFile}, got: ${said}`);
  assert.match(said, /runtime client/i, `it says it is Orca's runtime client, got: ${said}`);
  assert.ok(namesClientMissing(said, clientFile), `and that it is not there, got: ${said}`);
});

test('R3 the answer about a missing client file names it on every send, not only the first', async (t) => {
  // A miss on every call for weeks is the defect nobody saw (#844): each
  // answer says it, so a user who runs the command once more is told again.
  const box = await createSandbox(t);
  await fleetIn(box);
  const app = await orcaApp(box, { client: 'missing' });
  await sandboxPs(box);

  const first = await send(box);
  const second = await box.run([
    'message', 'send', '--bots', 'bots', '--to', 'coder', '--from', 'writer/daily',
    '--subject', 'the staging host again', '--text', 'Still down.', '--interrupt',
  ]);

  assert.equal(second.code, 0, `${second.stdout}${second.stderr}`);
  const again = `${second.stdout}${second.stderr}`;
  assert.ok(namesClientMissing(first, app.clientFile), `the first send names it, got: ${first}`);
  assert.ok(namesClientMissing(again, app.clientFile), `and so does the second, got: ${again}`);
  assert.equal((await box.orca.messages()).length, 2, 'both letters are in the mailbox');
});

// ---------------------------------------------------------------------------
// R3 — the client file is there and goes wrong, or there is no app or binary: not "missing".
// ---------------------------------------------------------------------------

for (const [label, options] of [
  ['the client file has no RuntimeClient export', { client: 'no-export' }],
  ['every call rejects with method_not_found', { client: 'method-not-found' }],
  ['the call never settles, and nothing holds the client process', { client: 'never-settles' }],
  ['the call hangs, and the client process stays up', { client: 'hangs', hangMs: 8000 }],
]) {
  test(`R3 when ${label}, the kit cannot tell, and the answer does not say the client file is missing`, async (t) => {
    const box = await createSandbox(t);
    await fleetIn(box);
    const app = await orcaApp(box, options);
    await sandboxPs(box);
    assert.equal(await exists(app.clientFile), true, 'the premise: the client file is there');

    const said = await send(box);

    await assertCouldNotTell(box, said, label);
    assert.equal(saysClientMissing(said), false, `the client file is there, so the answer must not say it is missing, got: ${said}`);
    assert.equal(namesClientMissing(said, app.clientFile), false, `nor name ${app.clientFile} as not there, got: ${said}`);
  });
}

test('R3 with no Orca app at all, only a CLI, the kit cannot tell, and the answer does not say the client file is missing', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);
  await sandboxPs(box);

  const said = await send(box);

  await assertCouldNotTell(box, said, 'no app');
  assert.equal(saysClientMissing(said), false, `there is no app to have a client, so the answer must not say the client file is missing, got: ${said}`);
});

test('R3 with the Orca app there but no binary in it, the kit cannot tell, and the answer does not say the client file is missing', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);
  const app = await orcaApp(box, { executable: false });
  await sandboxPs(box);
  assert.equal(await exists(app.clientFile), true, 'the premise: the client file is there');
  assert.equal(await exists(path.join(app.contents, 'MacOS', 'Orca')), false, 'the premise: the binary is not');

  const said = await send(box);

  await assertCouldNotTell(box, said, 'no binary');
  assert.equal(saysClientMissing(said), false, `the client file is there, so the answer must not say it is missing, got: ${said}`);
  assert.equal(namesClientMissing(said, app.clientFile), false, `nor name ${app.clientFile} as not there, got: ${said}`);
});

// ---------------------------------------------------------------------------
// R1 R3 — the client at the real place, answering: the runtime's answer, and nothing about a missing client.
// ---------------------------------------------------------------------------

test('R1 R3 with the client at out/cli/runtime/client.js, as a current Orca has it, the busy Codex receiver gets the one Escape and nothing is said of a missing client', async (t) => {
  // The contrast to the cases above: the same send, with a client that answers.
  const box = await createSandbox(t);
  await fleetIn(box);
  const app = await orcaApp(box);
  await sandboxPs(box);
  const called = (await app.calls()).length;

  const said = await send(box);

  const calls = (await app.calls()).slice(called);
  assert.ok(
    calls.some((call) => call.method === 'terminal.inspectProcess'),
    `the kit asked Orca's runtime through the client at ${app.clientFile}, got: ${JSON.stringify(calls)}`,
  );
  const escapes = (await box.orca.terminals()).flatMap((terminal) => sentInto(terminal).slice(1));
  assert.deepEqual(escapes.map((one) => ({ text: one.text, enter: one.enter })), [{ text: '\x1b', enter: false }], `one Escape, got: ${JSON.stringify(escapes)}`);
  assert.doesNotMatch(said, /could not tell|cannot tell/i, `the kit could tell, got: ${said}`);
  assert.equal(saysClientMissing(said), false, `got: ${said}`);
});
