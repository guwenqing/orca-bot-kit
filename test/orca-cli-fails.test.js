// The Orca CLI itself fails to start (#556). Before most Orca work the kit asks
// `orca status --json`. Here that call dies: it exits 1, prints no JSON, and
// writes its own error on stderr. The reporter's case was a shell whose current
// folder macOS no longer let the process read: Orca was running and reachable,
// but its CLI crashed in `process.cwd()` before it could ask the app anything.
//
// The kit then said Orca "is not answering" and told the user to start it. That
// sends a person to start an app that is already running. So, when the status
// call fails this way:
//
//   C1  the command exits 1 with a message, not a stack of the kit's own, and
//       the message carries what the Orca CLI said on stderr;
//   C2  it does not say Orca is not answering, and does not say to start Orca;
//   C3  it still says how to point the kit at another Orca CLI (OBK_ORCA);
//   C4  it asks Orca for nothing after `status`;
//   C5  that holds for each command that checks Orca first, not only one;
//   C6  `skills build`, which tells running sessions of changed skills and
//       carries on when it cannot, reports each session unknown with the CLI's
//       words in its `trouble`, types nothing, and still makes the links;
//   C7  and an Orca that does answer, with a runtime that is not reachable, is
//       still "not answering", and the user is still told to start it.
//
// How the kit joins the CLI's lines or how far it cuts them is its own
// business: only the text of the first line is held here.

import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import test from 'node:test';

import {
  assertCleanFailure,
  botHomeOf,
  conversationOnRecord,
  createSandbox,
  orcaCommand,
  recordSession,
  sentInto,
  sessionIn,
} from './helpers/cli.js';
import {
  addSkills,
  answerOf,
  assertLinked,
  botYamlOf,
  entryOf,
  kitSkill,
} from './helpers/skills.js';

/** What the reporter's Orca CLI printed on stderr when it could not read its current folder. */
const EPERM_STDERR = [
  'Error: EPERM: process.cwd failed with error operation not permitted, uv_cwd',
  '    at process.wrappedCwd [as cwd] (node:internal/bootstrap/switches/does_own_process_state:142:28)',
  '    at resolveInvocationCwd (/Applications/Orca.app/Contents/Resources/app.asar/out/cli/index.js:51:85)',
  '    at main (/Applications/Orca.app/Contents/Resources/app.asar/out/cli/index.js:212:19)',
  '',
].join('\n');

/** The text of its first line, which the kit has to pass on. */
const EPERM_SAID = 'EPERM: process.cwd failed with error operation not permitted, uv_cwd';

/** The status call dies before it answers: exit 1, no JSON, the CLI's own error on stderr. */
const STATUS_CRASHES = { crash: { command: 'status', exitCode: 1, stderr: EPERM_STDERR } };

/** The status call answers, and says the runtime is not reachable. */
const NOT_REACHABLE = { reachable: false };

/** The words that send a person to start an Orca that is already running. */
const NOT_ANSWERING = /not answering/i;
const START_ORCA = /start orca/i;

const BOT = 'api-bot';

/** A bots folder made by init, with Bot Father up in Orca. */
async function initDone(box) {
  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(result.code, 0, result.stderr);
  return box.path('bots');
}

/**
 * A bot with a Claude session up in Orca, whose conversation is on record: a
 * session a restart could bring back, so that only Orca can stop it.
 */
async function botWithAConversation(box) {
  const bots = await initDone(box);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  assert.equal(made.code, 0, made.stderr);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily']);
  assert.equal(added.code, 0, added.stderr);
  const up = await box.run(['up', '--bots', 'bots', '--bot', BOT]);
  assert.equal(up.code, 0, up.stderr);
  const tab = (await sessionIn(bots, BOT, 'daily'))?.tab;
  assert.equal(typeof tab, 'string', 'the book should hold a tab for daily');
  await recordSession(box, { bots, bot: BOT, tab, session: 'sess-1' });
  await conversationOnRecord(box, { harness: 'claude', cwd: botHomeOf(bots, BOT), id: 'sess-1' });
  return bots;
}

/**
 * Each command that checks Orca first: how its sandbox is made ready, and the
 * command itself. `ready` returns nothing the test needs; the outage is set
 * after it, so that only the command under test meets it.
 */
const COMMANDS = {
  init: { ready: async () => {}, args: ['init', '--bots', 'bots', '--harness', 'claude'] },
  up: { ready: initDone, args: ['up', '--bots', 'bots'] },
  restart: { ready: botWithAConversation, args: ['restart', '--bots', 'bots', '--bot', BOT] },
  health: { ready: initDone, args: ['health', '--bots', 'bots'] },
  'health --json': { ready: initDone, args: ['health', '--bots', 'bots', '--json'] },
};

/** Make the sandbox ready for `name`, set the outage, run the command, and say what Orca was asked meanwhile. */
async function runAgainst(t, name, outage) {
  const { ready, args } = COMMANDS[name];
  const box = await createSandbox(t);
  await ready(box);
  await box.orca.set(outage);
  const from = (await box.orca.calls()).length;
  const result = await box.run(args);
  const asked = (await box.orca.calls()).slice(from).map(orcaCommand);
  return { box, result, asked };
}

// ---------------------------------------------------------------------------
// C1–C5: a status call that dies, for each command that checks Orca first
// ---------------------------------------------------------------------------

for (const name of Object.keys(COMMANDS)) {
  test(`#556 C1 C5 ${name}: a status call that dies fails cleanly and passes on what the Orca CLI said`, async (t) => {
    const { result } = await runAgainst(t, name, STATUS_CRASHES);

    assertCleanFailure(result);
    assert.ok(
      result.stderr.includes(EPERM_SAID),
      `the message should carry the Orca CLI's own words, "${EPERM_SAID}", got: ${result.stderr}`,
    );
  });

  test(`#556 C2 C5 ${name}: a status call that dies is not called "not answering", and nobody is told to start Orca`, async (t) => {
    const { result } = await runAgainst(t, name, STATUS_CRASHES);

    assert.equal(result.code, 1, `the command should fail, got ${result.code}: ${result.stdout}${result.stderr}`);
    assert.doesNotMatch(result.stderr, NOT_ANSWERING, `Orca's CLI failed; the app may well be answering. Got: ${result.stderr}`);
    assert.doesNotMatch(result.stderr, START_ORCA, `Orca may already be running; do not send the user to start it. Got: ${result.stderr}`);
  });

  test(`#556 C3 C5 ${name}: a status call that dies still says how to point the kit at another Orca CLI`, async (t) => {
    const { result } = await runAgainst(t, name, STATUS_CRASHES);

    assert.equal(result.code, 1, `the command should fail, got ${result.code}: ${result.stdout}${result.stderr}`);
    assert.ok(result.stderr.includes('OBK_ORCA'), `should name OBK_ORCA, got: ${result.stderr}`);
  });

  test(`#556 C4 C5 ${name}: after a status call that dies, Orca is asked for nothing else`, async (t) => {
    const { result, asked } = await runAgainst(t, name, STATUS_CRASHES);

    assert.equal(result.code, 1, `the command should fail, got ${result.code}: ${result.stdout}${result.stderr}`);
    assert.deepEqual(asked, ['status'], 'once the Orca CLI fails, the kit must stop asking it for things');
  });
}

test('#556 C1 init: a status call that dies writes nothing', async (t) => {
  // The other outages in orca-down.test.js leave the folder empty; a CLI that
  // fails to start is one of them.
  const { box, result } = await runAgainst(t, 'init', STATUS_CRASHES);

  assertCleanFailure(result);
  assert.deepEqual(await readdir(box.cwd), [], 'nothing at all should have been written');
});

// ---------------------------------------------------------------------------
// C7: an Orca whose runtime is not reachable is still "not answering"
// ---------------------------------------------------------------------------

for (const name of Object.keys(COMMANDS)) {
  test(`#556 C7 ${name}: a runtime that is not reachable is still "not answering", and the user is told to start Orca`, async (t) => {
    const { result, asked } = await runAgainst(t, name, NOT_REACHABLE);

    assertCleanFailure(result);
    assert.match(result.stderr, NOT_ANSWERING, `the kit's own sentence about an Orca that is out, got: ${result.stderr}`);
    assert.match(result.stderr, START_ORCA, `and what to do about it, got: ${result.stderr}`);
    assert.ok(result.stderr.includes('OBK_ORCA'), `and how to point the kit at another Orca CLI, got: ${result.stderr}`);
    assert.deepEqual(asked, ['status'], 'once Orca is out, the kit must stop asking it for things');
  });
}

// ---------------------------------------------------------------------------
// C6: skills build carries on, and says why it told nobody
// ---------------------------------------------------------------------------
//
// `obk skills build` tells the running sessions of a bot whose skill links
// changed (skills-reload.test.js). When Orca cannot be asked, it makes the
// links all the same and reports each session unknown, with a `trouble` that
// says why. `obk skills add` only writes the list and asks Orca nothing, so it
// is `skills build` that meets the failing status call.

/** Bot Father, and `api-bot` with a Claude session and a Codex session, all up in Orca. */
async function fleetUp(box) {
  const bots = await initDone(box);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  assert.equal(made.code, 0, made.stderr);
  for (const [session, harness] of [['daily', 'claude'], ['reviewer', 'codex']]) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', session, '--harness', harness]);
    assert.equal(added.code, 0, added.stderr);
  }
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  return bots;
}

/** Everything typed into any tab after its launch line. */
async function typedSinceLaunch(box) {
  return (await box.orca.terminals()).flatMap((terminal) => sentInto(terminal).slice(1));
}

/** Give the bot one more kit skill, run `skills build --json`, and return its result and the bot's sessions in it. */
async function buildAgainst(t, outage) {
  const box = await createSandbox(t);
  const bots = await fleetUp(box);
  await box.orca.set(outage);
  await addSkills(botYamlOf(bots, BOT), 'kit:obk-tdd');

  const result = await box.run(['skills', 'build', '--bots', 'bots', '--json']);

  assert.equal(result.code, 0, `the build did its job; only the telling did not happen: ${result.stderr}`);
  const entry = entryOf(answerOf(result), BOT);
  assert.ok(Array.isArray(entry.sessions), `${BOT}'s links changed, so its entry should list its sessions, got: ${JSON.stringify(entry)}`);
  return { box, bots, sessions: entry.sessions };
}

test('#556 C6 skills build: a status call that dies leaves each session unknown, with the Orca CLI\'s words as the trouble, not "not answering"', async (t) => {
  const { sessions } = await buildAgainst(t, STATUS_CRASHES);

  assert.deepEqual(
    sessions.map((entry) => [entry.session, entry.state]),
    [['daily', 'unknown'], ['reviewer', 'unknown']],
  );
  for (const entry of sessions) {
    assert.equal(typeof entry.trouble, 'string', `why ${entry.session} was not told, got: ${JSON.stringify(entry)}`);
    assert.ok(
      entry.trouble.includes(EPERM_SAID),
      `the trouble should carry the Orca CLI's own words, "${EPERM_SAID}", got: ${JSON.stringify(entry)}`,
    );
    assert.doesNotMatch(entry.trouble, NOT_ANSWERING, `Orca's CLI failed; the app may well be answering. Got: ${JSON.stringify(entry)}`);
  }
});

test('#556 C6 skills build: a status call that dies types nothing, and the links are still made', async (t) => {
  const { box, bots, sessions } = await buildAgainst(t, STATUS_CRASHES);

  assert.notEqual(sessions.length, 0, 'the bot has sessions with tabs, so the build had someone to tell');
  assert.deepEqual(await typedSinceLaunch(box), [], 'nothing may be typed when Orca cannot be asked');
  await assertLinked(bots, BOT, 'obk-tdd', await kitSkill('obk-tdd'));
});

test('#556 C7 skills build: a runtime that is not reachable is still the trouble "not answering"', async (t) => {
  const { sessions } = await buildAgainst(t, NOT_REACHABLE);

  assert.deepEqual(
    sessions.map((entry) => [entry.session, entry.state]),
    [['daily', 'unknown'], ['reviewer', 'unknown']],
  );
  for (const entry of sessions) {
    assert.match(String(entry.trouble), NOT_ANSWERING, `why ${entry.session} was not told, got: ${JSON.stringify(entry)}`);
  }
});
