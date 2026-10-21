// Pi slice 1 (#578): what this slice does not do yet on Pi, refused in plain
// words, with nothing changed. Later slices of #547 add them.
//
//   obk init --harness pi           Bot Father on Pi
//
// A temporary session on Pi came in #648: test/pi-temp.test.js. `obk session
// clear` on a Pi session came in #663: test/pi-clear.test.js. `obk session
// compact` on a Pi session came in #671: test/pi-compact.test.js.
//
// Every run is in the sandbox (helpers/cli.js), with a fake `pi` on its PATH
// (helpers/pi.js).

import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';

import { createSandbox } from './helpers/cli.js';
import { fakePi } from './helpers/pi.js';

const exists = (file) => access(file).then(() => true, () => false);

/** A refusal in plain words that says it is about Pi: a non-zero exit, a sentence naming Pi, no crash. */
function assertRefusedForPi(result) {
  assert.notEqual(result.code, 0, `this should have been refused, got:\n${result.stdout}${result.stderr}`);
  const said = result.stdout + result.stderr;
  assert.ok(!/^\s+at /m.test(said), `expected a message, got a crash:\n${said}`);
  assert.match(said, /\bPi\b/, `the refusal should say it is about Pi, got:\n${said}`);
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
