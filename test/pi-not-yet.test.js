// Pi slice 1 (#578): what this slice does not do yet on Pi, refused in plain
// words, with nothing changed. Later slices of #547 add them.
//
//   obk init --harness pi           Bot Father on Pi
//   obk session compact             on a Pi session
//
// A temporary session on Pi came in #648: test/pi-temp.test.js. `obk session
// clear` on a Pi session came in #663: test/pi-clear.test.js. Compact on Pi
// stays refused until the architect adds it.
//
// Every run is in the sandbox (helpers/cli.js), with a fake `pi` on its PATH
// (helpers/pi.js).

import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';

import { createSandbox, orcaCallsOf, sessionIn, skipGit, snapshot, tabsOfBot } from './helpers/cli.js';
import { fakePi } from './helpers/pi.js';

const BOT = 'pi-bot';
const PROMPT = 'Read your AGENTS.md and keep the queue moving.';

const exists = (file) => access(file).then(() => true, () => false);

/** A refusal in plain words that says it is about Pi: a non-zero exit, a sentence naming Pi, no crash. */
function assertRefusedForPi(result) {
  assert.notEqual(result.code, 0, `this should have been refused, got:\n${result.stdout}${result.stderr}`);
  const said = result.stdout + result.stderr;
  assert.ok(!/^\s+at /m.test(said), `expected a message, got a crash:\n${said}`);
  assert.match(said, /\bPi\b/, `the refusal should say it is about Pi, got:\n${said}`);
}

/** A Pi bot with one Pi session, brought up, and that session's tab. */
async function piUp(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'pi']);
  assert.equal(made.code, 0, `${made.stdout}${made.stderr}`);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily', '--prompt', PROMPT]);
  assert.equal(added.code, 0, `${added.stdout}${added.stderr}`);
  const up = await box.run(['up', '--bots', 'bots', '--bot', BOT]);
  assert.equal(up.code, 0, `the up this test stands on did not happen: ${up.stdout}${up.stderr}`);
  const bots = box.path('bots');
  const tab = (await sessionIn(bots, BOT, 'daily'))?.tab;
  const terminal = (await tabsOfBot(box, bots, BOT)).find((one) => one.tabId === tab);
  assert.ok(terminal, `the Pi session should have a tab, got the book's ${tab}`);
  return { bots, terminal };
}

// ----------------------------------------------------------------- init

test('N11 init --harness pi is refused in plain words, and makes nothing', async (t) => {
  const box = await createSandbox(t);
  await fakePi(box);

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'pi']);

  assertRefusedForPi(result);
  assert.equal(await exists(box.path('bots')), false, 'no bots folder was made');
  assert.deepEqual(await box.orca.setups(), [], 'and nothing was opened in Orca');
  assert.deepEqual(await box.orca.terminals(), []);
});

// ----------------------------------------------------------------- session compact

for (const verb of ['compact']) {
  test(`N11 session ${verb} on a Pi session is refused in plain words, types nothing, and changes nothing`, async (t) => {
    const box = await createSandbox(t);
    await fakePi(box);
    const { bots } = await piUp(box);
    const files = await snapshot(bots, skipGit);
    const sends = orcaCallsOf(await box.orca.calls(), 'terminal send').length;
    const terminals = await box.orca.terminals();

    const result = await box.run(['session', verb, '--bots', 'bots', '--bot', BOT, '--session', 'daily']);

    assertRefusedForPi(result);
    assert.equal(orcaCallsOf(await box.orca.calls(), 'terminal send').length, sends, 'nothing was typed into any tab');
    assert.deepEqual(await box.orca.terminals(), terminals, 'no tab changed');
    assert.deepEqual(await snapshot(bots, skipGit), files, 'and nothing in the bots folder changed');
  });
}
