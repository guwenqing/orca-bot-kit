// Fleet mail has one road and one signal (#555, which replaces #509's fallback,
// #511 and #550). `obk message send` puts the letter in the receiver's Orca
// mailbox, and Orca's own doorbell tells the receiver when it is idle. The kit
// types nothing else into another session's tab.
//
//   R1  What is removed: the kit's typed fallback line ("Fleet mail from …"),
//       its 8 s watch for Orca's notice, the unread-hint record (`obk-unread`
//       in the system temp folder), the Codex nudge left for a hook
//       (`obk-nudges` there, `obk session nudge`), and the Claude Code Stop
//       hook reminder (`obk session mail`). A retire no longer reports mail
//       that was not read. A send stops once the letter is in the mailbox, and
//       its output says which road it took: the Orca mailbox.
//   R2  Without --interrupt, a send to a live receiver, idle or busy, Claude
//       Code or Codex, makes no `terminal send` call to Orca at all.
//   R6  Unchanged: the native road, long messages as a file, `message check`
//       (message-send.test.js and message-check.test.js keep those).
//
// The kit's hooks are mail-hooks-gone.test.js; --interrupt is
// mail-interrupt.test.js.
//
// Every run is in the sandbox (helpers/cli.js): its own HOME and TMPDIR, a
// fake Orca, a fake ps. Nothing here reaches the real Orca or a real harness.

import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import test from 'node:test';

import {
  createSandbox,
  kitLaunchMark,
  orcaCallsOf,
  orcaCommand,
  sessionIn,
} from './helpers/cli.js';

/** Who receives on each harness, and who sends to it down the Orca road. */
const RECEIVERS = {
  claude: { harness: 'claude', bot: 'writer', from: 'coder/daily' },
  codex: { harness: 'codex', bot: 'coder', from: 'writer/daily' },
};

/** The plain output names the road it took. */
const ORCA_MAILBOX = /orca mailbox/i;

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

/** Change one tab in the fake Orca's world. */
async function setTab(box, tab, changes) {
  const terminals = await box.orca.terminals();
  assert.ok(terminals.some((one) => one.tabId === tab), `the premise: Orca has the tab ${tab}`);
  await box.orca.set({ terminals: terminals.map((one) => (one.tabId === tab ? { ...one, ...changes } : one)) });
}

/** Send one letter to the receiver, plain output, and the Orca calls the send made. */
async function send(box, receiver, { args = [], env } = {}) {
  const before = (await box.orca.calls()).length;
  const result = await box.run([
    'message', 'send', '--bots', 'bots', '--to', receiver.bot, ...(receiver.from === undefined ? [] : ['--from', receiver.from]),
    '--subject', 'the staging host', '--text', 'It is down again.', ...args,
  ], env === undefined ? {} : { env });
  return { ...result, calls: (await box.orca.calls()).slice(before) };
}

/** Exit 0, and the letter is in the mailbox, once. */
async function assertPosted(box, result) {
  assert.equal(result.code, 0, `the letter went: ${result.stdout}${result.stderr}`);
  const queued = await box.orca.messages();
  assert.equal(queued.length, 1, `one letter in the mailbox, got: ${JSON.stringify(queued)}`);
  assert.equal(queued[0].subject, 'the staging host');
}

/** No `terminal send` call among `calls`: nothing typed into any tab. */
function assertNothingTyped(calls, what) {
  const typed = orcaCallsOf(calls, 'terminal send');
  assert.deepEqual(typed.map((call) => call.args), [], `${what}: the kit types nothing into any tab`);
}

/** The folders the kit has in the sandbox's system temp folder. */
async function inTmp(box) {
  return readdir(box.tmp).catch(() => []);
}

// ------------------------------------------------------------- R2: nothing typed

for (const receiver of Object.values(RECEIVERS)) {
  for (const state of ['idle', 'busy']) {
    test(`R2 a send to a ${state} ${receiver.harness} receiver without --interrupt posts the letter and makes no terminal send call`, async (t) => {
      const box = await createSandbox(t);
      const fleet = await fleetIn(box);
      if (state === 'busy') await setTab(box, fleet.tabs[receiver.bot], { tuiIdle: 'busy' });

      const result = await send(box, receiver);

      await assertPosted(box, result);
      assertNothingTyped(result.calls, `${state} ${receiver.harness}`);
    });
  }
}

test('R1 R2 a busy Codex receiver gets no typed line either: the old fallback typed one into it', async (t) => {
  // Before #555 a busy Codex got the kit's line, "Fleet mail from …", typed
  // into its running turn. Now Orca's doorbell comes when it is idle.
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await setTab(box, fleet.tabs.coder, { tuiIdle: 'busy' });

  await send(box, RECEIVERS.codex);

  for (const terminal of await box.orca.terminals()) {
    const lines = (terminal.typed ?? []).slice(1).map((entry) => entry.text);
    assert.ok(!lines.some((line) => /Fleet mail from/.test(line)), `no kit line in ${terminal.tabId}, got: ${JSON.stringify(lines)}`);
  }
});

// ------------------------------------------------------------- R1: the road, and the stop

for (const receiver of Object.values(RECEIVERS)) {
  test(`R1 the plain output of a send to ${receiver.harness} names the Orca mailbox as its road`, async (t) => {
    const box = await createSandbox(t);
    await fleetIn(box);

    const result = await send(box, receiver);

    await assertPosted(box, result);
    assert.match(result.stdout, ORCA_MAILBOX, `the output says the letter went by the Orca mailbox, got:\n${result.stdout}`);
  });

  test(`R1 a send to an idle ${receiver.harness} receiver stops once the letter is in the mailbox: no Orca call after the post`, async (t) => {
    // The old send watched an idle receiver for up to 8 s after the post,
    // asking Orca's tui-idle again and again. Now the post is its last call.
    const box = await createSandbox(t);
    await fleetIn(box);

    const result = await send(box, receiver);

    await assertPosted(box, result);
    const commands = result.calls.map(orcaCommand);
    const posted = commands.lastIndexOf('orchestration send');
    assert.ok(posted >= 0, `the letter was posted, got: ${JSON.stringify(commands)}`);
    assert.deepEqual(commands.slice(posted + 1), [], `nothing is asked of Orca after the post, got: ${JSON.stringify(commands)}`);
  });
}

// ------------------------------------------------------------- R1: no unread hint

test('R1 a send writes no unread-hint record: no obk-unread folder in the system temp folder', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);

  await assertPosted(box, await send(box, RECEIVERS.claude));
  await box.run(['message', 'send', '--bots', 'bots', '--to', 'coder', '--from', 'writer/daily', '--subject', 'second', '--text', 'and another']);

  assert.ok(!(await inTmp(box)).includes('obk-unread'), `no obk-unread in ${box.tmp}, got: ${JSON.stringify(await inTmp(box))}`);
});

test('R1 a Codex session that sends from its own tab where ps does not start leaves no nudge for a hook: no obk-nudges folder, nothing typed', async (t) => {
  // Before #555 this send (Codex's sandbox, a receiver the kit could not tell
  // about) left its nudge in obk-nudges for `obk session nudge` to type.
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await setTab(box, fleet.tabs.writer, { tuiIdle: 'busy' });
  await box.orca.set({ ps: 'not-permitted' });
  const coderTab = (await box.orca.terminals()).find((one) => one.tabId === fleet.tabs.coder);
  const env = {
    ...box.env,
    ORCA_TAB_ID: coderTab.tabId,
    ORCA_TERMINAL_HANDLE: coderTab.handle,
    ...kitLaunchMark(box, coderTab),
  };

  // No --from: the sender is the Codex session whose tab this runs in.
  const result = await send(box, { bot: 'writer' }, { env });

  await assertPosted(box, result);
  assertNothingTyped(result.calls, 'a busy Claude receiver, sent to from Codex\'s sandbox');
  assert.ok(!(await inTmp(box)).includes('obk-nudges'), `no obk-nudges in ${box.tmp}, got: ${JSON.stringify(await inTmp(box))}`);
});

// ------------------------------------------------------------- R1: the hook commands

for (const command of ['nudge', 'mail']) {
  test(`R1 \`obk session ${command}\` is no longer a command of the kit, and the help does not list it`, async (t) => {
    const box = await createSandbox(t);
    await fleetIn(box);
    const before = (await box.orca.calls()).length;

    const ran = await box.run(['session', command, '--bots', 'bots', '--bot', 'coder'], { stdin: '{}\n' });

    assert.notEqual(ran.code, 0, `session ${command} is refused as no command, got: ${ran.stdout}${ran.stderr}`);
    assertNothingTyped((await box.orca.calls()).slice(before), `session ${command}`);
    const help = await box.run(['--help']);
    assert.ok(!new RegExp(`session ${command}\\b`).test(help.stdout + help.stderr), `the help does not name session ${command}, got:\n${help.stdout}`);
  });
}

// ------------------------------------------------------------- R1: retire

test('R1 a retire of a session with mail it never read says nothing about unread mail', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);
  await assertPosted(box, await send(box, RECEIVERS.claude));

  const plain = await box.run(['retire', '--bots', 'bots', '--bot', 'writer', '--session', 'daily']);

  assert.equal(plain.code, 0, plain.stderr);
  assert.ok(!/unread|not read/i.test(plain.stdout + plain.stderr), `no line about unread mail, got:\n${plain.stdout}${plain.stderr}`);
});

test('R1 the --json answer of a retire, of a session and of a whole bot, has no unread entry', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);
  assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', 'coder', '--name', 'night'])).code, 0);
  assert.equal((await box.run(['up', '--bots', 'bots', '--bot', 'coder', '--session', 'night'])).code, 0);
  await assertPosted(box, await send(box, { bot: 'coder/daily', from: 'writer/daily' }));
  const toNight = await box.run(['message', 'send', '--bots', 'bots', '--to', 'coder/night', '--from', 'writer/daily', '--subject', 'for night', '--text', 'read me']);
  assert.equal(toNight.code, 0, toNight.stderr);

  const one = await box.run(['retire', '--bots', 'bots', '--bot', 'coder', '--session', 'night', '--json']);
  assert.equal(one.code, 0, one.stderr);
  assert.ok(!('unread' in JSON.parse(one.stdout)), `no unread in the session retire's answer, got: ${one.stdout}`);

  const whole = await box.run(['retire', '--bots', 'bots', '--bot', 'coder', '--json']);
  assert.equal(whole.code, 0, whole.stderr);
  assert.ok(!/"unread"/.test(whole.stdout), `no unread anywhere in the bot retire's answer, got: ${whole.stdout}`);
});
