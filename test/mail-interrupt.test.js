// `obk message send … --interrupt`: one Escape for urgent mail (#555).
//
// Orca's doorbell comes when the receiver is idle. For urgent mail the sender
// asks the kit to interrupt first, and the doorbell then comes at once (seen
// live: about 1 s after the Escape on Claude Code, about 2 s on Codex).
//
//   I1  The receiver's tab holds its harness and the harness is busy (Orca's
//       `terminal wait --for tui-idle` for that tab times out, as the kit's
//       typing gate reads it): exactly one Escape goes into the receiver's
//       tab, `terminal send --terminal <handle> --text "\x1b"` with no
//       `--enter`, and then the letter is posted (`orchestration send` comes
//       after the Escape). Nothing else is typed anywhere.
//   I2  An idle receiver gets no Escape; the letter is posted.
//   I3  No Escape into a tab with a question or block on its screen, a tab
//       with only a shell in front, a tab the kit cannot tell about, or a
//       receiver that is not up. The letter still goes, and the output says
//       why there was no interrupt.
//   I4  Never by default: without --interrupt nothing is typed, busy or not
//       (mail-one-road.test.js, R2, and I5 here for the function).
//   I5  The same through `sendMessage(bots, { …, interrupt: true })`, the
//       exported function in src/message.js.
//   I6  A Codex receiver that was sent an Escape: the output says that Codex
//       keeps a running command as a background terminal after an Escape.
//
// Every run is in the sandbox (helpers/cli.js): its own HOME and TMPDIR, a
// fake Orca, a fake ps. Nothing here reaches the real Orca or a real harness.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

import {
  createSandbox,
  orcaCallsOf,
  orcaCommand,
  orcaFlag,
  repoRoot,
  sessionIn,
} from './helpers/cli.js';
import { CLAUDE_TEACH_FORM, CODEX_UPDATE_OFFER } from './helpers/screens.js';

/** The one key an interrupt is. */
const ESCAPE = '\x1b';

/** Who receives on each harness, and who sends to it down the Orca road. */
const RECEIVERS = {
  claude: { harness: 'claude', bot: 'writer', from: 'coder/daily', question: CLAUDE_TEACH_FORM },
  codex: { harness: 'codex', bot: 'coder', from: 'writer/daily', question: CODEX_UPDATE_OFFER },
};

/** What the output says of an interrupt, done or not. */
const ABOUT_INTERRUPT = /interrupt|escape/i;

/** A Claude bot `writer` and a Codex bot `coder`, a `daily` session each, both up. */
async function fleetIn(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  for (const [bot, harness] of [['writer', 'claude'], ['coder', 'codex']]) {
    assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness])).code, 0);
    assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', 'daily'])).code, 0);
  }
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  const bots = box.path('bots');
  const tabs = {};
  for (const { bot } of Object.values(RECEIVERS)) {
    const entry = await sessionIn(bots, bot, 'daily');
    assert.equal(typeof entry?.tab, 'string', `the premise: ${bot}/daily has a tab`);
    assert.equal(typeof entry?.mailbox, 'string', `the premise: ${bot}/daily has a mailbox`);
    tabs[bot] = entry.tab;
  }
  return { bots, tabs };
}

/** One tab of the fake Orca's world, by its tab id. */
async function terminalOf(box, tab) {
  const found = (await box.orca.terminals()).find((one) => one.tabId === tab);
  assert.ok(found, `the premise: Orca has the tab ${tab}`);
  return found;
}

/** Change one tab in the fake Orca's world. */
async function setTab(box, tab, changes) {
  await terminalOf(box, tab);
  await box.orca.set({ terminals: (await box.orca.terminals()).map((one) => (one.tabId === tab ? { ...one, ...changes } : one)) });
}

/** The receiver's harness is up and busy: Orca's tui-idle wait for its tab times out. */
const busy = (box, fleet, receiver) => setTab(box, fleet.tabs[receiver.bot], { tuiIdle: 'busy' });

/** Send one letter, plain output, with --interrupt unless told not to; and the Orca calls it made. */
async function send(box, receiver, { interrupt = true } = {}) {
  const before = (await box.orca.calls()).length;
  const result = await box.run([
    'message', 'send', '--bots', 'bots', '--to', receiver.bot, '--from', receiver.from,
    '--subject', 'the staging host', '--text', 'It is down again.', ...(interrupt ? ['--interrupt'] : []),
  ]);
  return { ...result, calls: (await box.orca.calls()).slice(before) };
}

/** Exit 0, and the letter is in the mailbox, once. */
async function assertPosted(box, result) {
  assert.equal(result.code, 0, `the letter went: ${result.stdout}${result.stderr}`);
  const queued = await box.orca.messages();
  assert.equal(queued.length, 1, `one letter in the mailbox, got: ${JSON.stringify(queued)}`);
  assert.equal(queued[0].subject, 'the staging host');
}

/** The `terminal send` calls among `calls`. */
const typedIn = (calls) => orcaCallsOf(calls, 'terminal send');

/** Exactly one Escape, into `handle`, with no Enter, and before the post. */
function assertOneEscapeThenPost(calls, handle, what) {
  const typed = typedIn(calls);
  assert.equal(typed.length, 1, `${what}: one terminal send, the Escape, got: ${JSON.stringify(typed.map((call) => call.args))}`);
  const [escape] = typed;
  assert.equal(orcaFlag(escape, '--terminal'), handle, `${what}: into the receiver's own tab, got: ${JSON.stringify(escape.args)}`);
  assert.equal(orcaFlag(escape, '--text'), ESCAPE, `${what}: the text is one Escape, got: ${JSON.stringify(escape.args)}`);
  assert.ok(!escape.args.includes('--enter'), `${what}: with no Enter, got: ${JSON.stringify(escape.args)}`);
  const commands = calls.map(orcaCommand);
  const escapedAt = calls.indexOf(escape);
  const postedAt = commands.indexOf('orchestration send');
  assert.ok(postedAt >= 0, `${what}: the letter was posted, got: ${JSON.stringify(commands)}`);
  assert.ok(escapedAt < postedAt, `${what}: the Escape comes before the post, got: ${JSON.stringify(commands)}`);
}

/** No `terminal send` call at all. */
function assertNoEscape(calls, what) {
  assert.deepEqual(typedIn(calls).map((call) => call.args), [], `${what}: nothing is typed, no Escape`);
}

// ------------------------------------------------------------- I1, I6: a busy receiver

for (const receiver of Object.values(RECEIVERS)) {
  test(`I1 --interrupt to a busy ${receiver.harness} receiver sends exactly one Escape into its tab, with no Enter, and then posts the letter`, async (t) => {
    const box = await createSandbox(t);
    const fleet = await fleetIn(box);
    await busy(box, fleet, receiver);
    const { handle } = await terminalOf(box, fleet.tabs[receiver.bot]);

    const result = await send(box, receiver);

    await assertPosted(box, result);
    assertOneEscapeThenPost(result.calls, handle, `busy ${receiver.harness}`);
  });
}

test('I6 --interrupt to a busy Codex receiver says Codex keeps a running command as a background terminal after the Escape', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await busy(box, fleet, RECEIVERS.codex);

  const result = await send(box, RECEIVERS.codex);

  await assertPosted(box, result);
  assert.equal(typedIn(result.calls).length, 1, 'the premise: the Escape went');
  assert.match(result.stdout, /background terminal/i, `the output names the background terminal, got:\n${result.stdout}`);
});

// ------------------------------------------------------------- I2: an idle receiver

for (const receiver of Object.values(RECEIVERS)) {
  test(`I2 --interrupt to an idle ${receiver.harness} receiver sends no Escape, and posts the letter`, async (t) => {
    // Orca's doorbell comes at once to an idle receiver, so there is nothing
    // to interrupt, and an Escape into an idle harness is a key it acts on.
    const box = await createSandbox(t);
    await fleetIn(box);

    const result = await send(box, receiver);

    await assertPosted(box, result);
    assertNoEscape(result.calls, `idle ${receiver.harness}`);
  });
}

// ------------------------------------------------------------- I3: where no Escape goes

/**
 * The tabs that get no Escape, each with how the fake Orca shows it and the
 * words the output says why with. A tab busy by Orca's wait in each, unless
 * the case itself is about the wait, so only the gate holds the Escape back.
 */
const NO_ESCAPE = {
  'a question of its harness\'s own on its screen, while Orca\'s wait times out': {
    tab: (receiver) => ({ tuiIdle: 'busy', screen: receiver.question }),
    why: /question|answer|blocked|waiting/i,
  },
  'something Orca says is blocked, waiting to be answered': {
    tab: () => ({ tuiIdle: 'blocked' }),
    why: /question|answer|blocked|waiting/i,
  },
  'only a shell in front': {
    tab: () => ({ tuiIdle: false, foreground: 'shell' }),
    why: /shell|no harness|not running|harness/i,
  },
  'a screen the kit cannot read, so it cannot tell': {
    tab: () => ({ tuiIdle: 'busy', screenSource: 'screen-unavailable' }),
    why: /tell|know|unsure|not sure/i,
  },
  'another program than the harness in front, so it cannot tell': {
    tab: () => ({ tuiIdle: 'busy', foreground: 'program' }),
    why: /tell|know|unsure|not sure|harness/i,
  },
};

for (const receiver of Object.values(RECEIVERS)) {
  for (const [label, { tab, why }] of Object.entries(NO_ESCAPE)) {
    test(`I3 --interrupt to a ${receiver.harness} tab with ${label}: no Escape, the letter goes, and the output says why there was no interrupt`, async (t) => {
      const box = await createSandbox(t);
      const fleet = await fleetIn(box);
      await setTab(box, fleet.tabs[receiver.bot], tab(receiver));

      const result = await send(box, receiver);

      await assertPosted(box, result);
      assertNoEscape(result.calls, label);
      assert.match(result.stdout + result.stderr, ABOUT_INTERRUPT, `the output speaks of the interrupt, got:\n${result.stdout}${result.stderr}`);
      assert.match(result.stdout + result.stderr, why, `and says why there was none, got:\n${result.stdout}${result.stderr}`);
    });
  }

  test(`I3 --interrupt to a ${receiver.harness} receiver that is not up, its tab closed: no Escape, the letter waits in its mailbox, and the output says why there was no interrupt`, async (t) => {
    const box = await createSandbox(t);
    const fleet = await fleetIn(box);
    await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.tabId !== fleet.tabs[receiver.bot]) });

    const result = await send(box, receiver);

    await assertPosted(box, result);
    assertNoEscape(result.calls, 'not up');
    assert.match(result.stdout + result.stderr, ABOUT_INTERRUPT, `the output speaks of the interrupt, got:\n${result.stdout}${result.stderr}`);
    assert.match(result.stdout + result.stderr, /not up|no tab|closed|not running|not open/i, `and says the receiver is not up, got:\n${result.stdout}${result.stderr}`);
  });
}

// ------------------------------------------------------------- I4: never by default

for (const receiver of Object.values(RECEIVERS)) {
  test(`I4 the same busy ${receiver.harness} receiver without --interrupt gets no Escape: the interrupt is never done by default`, async (t) => {
    const box = await createSandbox(t);
    const fleet = await fleetIn(box);
    await busy(box, fleet, receiver);

    const result = await send(box, receiver, { interrupt: false });

    await assertPosted(box, result);
    assertNoEscape(result.calls, `busy ${receiver.harness}, no --interrupt`);
  });
}

// ------------------------------------------------------------- I5: the function

/**
 * Call `sendMessage` from src/message.js in a child process with the
 * sandbox's environment, so it reaches the fake Orca and nothing else, and
 * answer what it returned. Its argv[1] is the sandbox's `obk`, as when the CLI
 * runs, since the kit names itself by it.
 */
function sendMessageIn(box, options) {
  const module = path.join(repoRoot, 'src', 'message.js');
  const script = `import { sendMessage } from ${JSON.stringify(module)};
const answer = await sendMessage(process.argv[2], JSON.parse(process.argv[3]));
process.stdout.write(JSON.stringify(answer));`;
  const ran = spawnSync(process.execPath, ['--input-type=module', '-e', script, box.cli, box.path('bots'), JSON.stringify(options)], {
    cwd: box.cwd,
    env: box.env,
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(ran.status, 0, `sendMessage ran: ${ran.stdout}${ran.stderr}`);
  return JSON.parse(ran.stdout);
}

for (const interrupt of [true, undefined]) {
  test(`I5 sendMessage(bots, { …, interrupt: ${interrupt} }) to a busy Codex receiver ${interrupt ? 'sends one Escape before the post' : 'sends no Escape'}`, async (t) => {
    const box = await createSandbox(t);
    const fleet = await fleetIn(box);
    await busy(box, fleet, RECEIVERS.codex);
    const { handle } = await terminalOf(box, fleet.tabs.coder);
    const before = (await box.orca.calls()).length;

    const answer = sendMessageIn(box, {
      to: 'coder', from: 'writer/daily', subject: 'the staging host', text: 'It is down again.',
      ...(interrupt === undefined ? {} : { interrupt }),
    });

    assert.equal(answer.sent, true, `the letter went, got: ${JSON.stringify(answer)}`);
    assert.equal((await box.orca.messages()).length, 1, 'the letter is in the mailbox');
    const calls = (await box.orca.calls()).slice(before);
    if (interrupt) assertOneEscapeThenPost(calls, handle, 'sendMessage with interrupt');
    else assertNoEscape(calls, 'sendMessage without interrupt');
  });
}
