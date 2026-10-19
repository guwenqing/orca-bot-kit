// Pi slice 2 (#634, of #547): a Pi session gets fleet mail as a Claude Code or
// Codex session does. There is one road, the Orca mailbox, and one signal,
// Orca's own notice (PRD-16 since #555). The kit adds no reminder of its own.
//
//   A1  `obk up` of a Pi session gives it a mailbox: its launch line runs the
//       kit's `session mailbox` step in its tab before `pi`, as a Claude or
//       Codex line does, and once that step runs the book holds a mailbox
//       for it, a Run bound to its tab.
//   A2  `obk message to --to <pi bot>/<session>` names the Orca road
//       (transport `orca`) and the address `run:<its mailbox>`, from a Claude
//       sender, a Codex sender and a Pi sender. Never the native road, which
//       is only Claude to Claude in one approval class. A Pi sender writing to
//       a Claude session takes the Orca road too. A Pi session not yet up gets
//       the same "no mailbox yet" answer as a session of another harness.
//   A3  `obk message send` to a Pi session puts the letter in its Orca
//       mailbox, from the sender's own Run, and says it went by the Orca
//       mailbox. It types nothing into the Pi tab.
//   A4  `obk message send` from inside a Pi session's tab takes the sender
//       from the tab (ORCA_TAB_ID), as for Claude Code: no --from needed, and
//       a --from naming another session is refused. The kit's launch line
//       gives Pi OBK_TAB_SHELL and OBK_CLI, as it gives Claude and Codex, so
//       the tab's commands carry them. A Pi tab without that mark is not
//       refused as a Codex one is (#408): that refusal is about Codex's shared
//       background server, which Pi does not have.
//   A5  `obk message check` from a Pi session's tab with no --bot reads and
//       acknowledges that session's own mail, and no one else's.
//   A6  `obk message send --interrupt` to a busy Pi receiver presses one
//       Escape in its tab, then posts the letter; to an idle one it presses
//       nothing. Its output for Pi does not carry the Codex sentence about a
//       background terminal: Pi kills a running command at an Escape (read in
//       Pi 1.3.0's code).
//
// Unhappy inputs: a Pi session never brought up (to, send, check), and a Pi
// tab Orca lists as orphaned (#579: the send says the letter waits).
//
// The fakes know a Pi tab as Orca and `ps` show one (tech notes, section 6):
// Orca names its agent `pi`, and Pi's process shows as command `pi`
// (helpers/fake-ps.js, helpers/fake-orca.js). Every run is in the sandbox
// (helpers/cli.js), with a fake `pi` on PATH (helpers/pi.js). Nothing here
// reaches the real Orca, the real `pi` or the real ~/.pi.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertRefused,
  cliOnLine,
  createSandbox,
  harnessPartOf,
  launchLineEnv,
  mailboxStep,
  orcaCallsOf,
  orcaCommand,
  orcaFlag,
  sessionIn,
  TAB_SHELL,
  typedInto,
} from './helpers/cli.js';
import { addSession } from './helpers/permissions.js';
import { fakePi } from './helpers/pi.js';

/** The one key an interrupt is. */
const ESCAPE = '\x1b';

/** The plain output of a send names the road it took. */
const ORCA_MAILBOX = /orca mailbox/i;

/**
 * The fleet: Bot Father, a Claude bot at `auto` (writer), a Claude bot at
 * `dangerously-skip` (skipper, in the same approval level every Pi session
 * has), a Codex bot (coder), and two Pi bots (pier and pier-two). One `daily`
 * session each, all brought up.
 */
const FLEET = [
  ['writer', 'claude', []],
  ['skipper', 'claude', ['--approval', 'dangerously-skip']],
  ['coder', 'codex', []],
  ['pier', 'pi', ['--prompt', 'You keep the queue moving.']],
  ['pier-two', 'pi', ['--prompt', 'You write the release notes.']],
];

/**
 * A bots folder holding the bots of FLEET named in `only` (all of them when
 * left out), every session up. Answers the bots folder and the fake `pi`.
 * Each fleet takes a while to bring up, so a group of cases shares one.
 */
async function fleetIn(box, only) {
  const pi = await fakePi(box);
  const init = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(init.code, 0, `${init.stdout}${init.stderr}`);
  for (const [bot, harness, settings] of FLEET.filter(([name]) => only === undefined || only.includes(name))) {
    const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness]);
    assert.equal(made.code, 0, `${made.stdout}${made.stderr}`);
    const added = await addSession(box, { bot, name: 'daily', settings });
    assert.equal(added.code, 0, `${added.stdout}${added.stderr}`);
  }
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, `obk up: ${up.stdout}${up.stderr}`);
  return { bots: box.path('bots'), pi };
}

/** One session's tab as Orca holds it, by the tab the book names. */
async function tabOf(box, bots, where) {
  const [bot, session = 'daily'] = where.split('/');
  const tabId = (await sessionIn(bots, bot, session))?.tab;
  const terminal = (await box.orca.terminals()).find((one) => one.tabId === tabId);
  assert.ok(terminal, `the premise: Orca holds ${bot}/${session}'s tab ${tabId}`);
  return terminal;
}

/** The mailbox address of one session, as a send writes it. */
async function mailboxOf(bots, where) {
  const [bot, session = 'daily'] = where.split('/');
  const mailbox = (await sessionIn(bots, bot, session))?.mailbox;
  assert.equal(typeof mailbox, 'string', `the premise: ${bot}/${session} has a mailbox, got: ${mailbox}`);
  return `run:${mailbox}`;
}

/** Change one tab in the fake Orca's world. */
async function setTab(box, tabId, changes) {
  const terminals = await box.orca.terminals();
  assert.ok(terminals.some((one) => one.tabId === tabId), `the premise: Orca has the tab ${tabId}`);
  await box.orca.set({ terminals: terminals.map((one) => (one.tabId === tabId ? { ...one, ...changes } : one)) });
}

/**
 * The environment of a command a session's harness runs in its own tab:
 * Orca's variables for that pane, and, when `kit` is true, what the kit's
 * launch line gave the harness (OBK_TAB_SHELL and OBK_CLI).
 */
const inTab = (box, terminal, { kit = true } = {}) => ({
  ...box.env,
  ORCA_TAB_ID: terminal.tabId,
  ORCA_TERMINAL_HANDLE: terminal.handle,
  ...(kit ? launchLineEnv(box) : {}),
});

/** `obk message to --json`; the parsed answer. */
async function askTo(box, args, options = {}) {
  const result = await box.run(['message', 'to', '--bots', 'bots', ...args, '--json'], options);
  assert.equal(result.code, 0, `obk message to: ${result.stdout}${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
}

/** `obk message send`, plain output, and the Orca calls it made. */
async function send(box, { to, from, subject = 'the staging host', text = 'It is down again.', extra = [], env } = {}) {
  const before = (await box.orca.calls()).length;
  const queuedBefore = await box.orca.messages();
  const result = await box.run([
    'message', 'send', '--bots', 'bots', '--to', to, ...(from === undefined ? [] : ['--from', from]),
    '--subject', subject, '--text', text, ...extra,
  ], env === undefined ? {} : { env });
  return { ...result, calls: (await box.orca.calls()).slice(before), queuedBefore };
}

/** The messages a send added to the fake mailbox. */
async function addedBy(box, result) {
  return (await box.orca.messages()).slice(result.queuedBefore.length);
}

/** Exit 0, and exactly one letter queued, from `from` to `to` (mailbox addresses). */
async function assertPosted(box, result, { from, to, subject = 'the staging host' }) {
  assert.equal(result.code, 0, `the send should have gone:\n${result.stdout}${result.stderr}`);
  const added = await addedBy(box, result);
  assert.equal(added.length, 1, `one letter should be queued, got: ${JSON.stringify(added)}`);
  assert.equal(added[0].to, to, `into the receiver's own mailbox, got: ${JSON.stringify(added[0])}`);
  assert.equal(added[0].from, from, `from the sender's own mailbox, got: ${JSON.stringify(added[0])}`);
  assert.equal(added[0].subject, subject);
}

/** The `terminal send` calls among `calls`: everything the kit typed. */
const typedIn = (calls) => orcaCallsOf(calls, 'terminal send');

/** Nothing typed into any tab. */
function assertNothingTyped(calls, what) {
  assert.deepEqual(typedIn(calls).map((call) => call.args), [], `${what}: nothing is typed into any tab`);
}

/** Exactly one Escape, into `handle`, with no Enter, and before the post. */
function assertOneEscapeThenPost(calls, handle, what) {
  const typed = typedIn(calls);
  assert.equal(typed.length, 1, `${what}: one terminal send, the Escape, got: ${JSON.stringify(typed.map((call) => call.args))}`);
  const [escape] = typed;
  assert.equal(orcaFlag(escape, '--terminal'), handle, `${what}: into the receiver's own tab, got: ${JSON.stringify(escape.args)}`);
  assert.equal(orcaFlag(escape, '--text'), ESCAPE, `${what}: the text is one Escape, got: ${JSON.stringify(escape.args)}`);
  assert.ok(!escape.args.includes('--enter'), `${what}: with no Enter, got: ${JSON.stringify(escape.args)}`);
  const commands = calls.map(orcaCommand);
  const postedAt = commands.indexOf('orchestration send');
  assert.ok(postedAt >= 0, `${what}: the letter was posted, got: ${JSON.stringify(commands)}`);
  assert.ok(calls.indexOf(escape) < postedAt, `${what}: the Escape comes before the post, got: ${JSON.stringify(commands)}`);
}

/** A refusal: not 0, something said, and no crash. */
function assertCleanRefusal(result, what) {
  const said = `${result.stdout}\n${result.stderr}`;
  assert.notEqual(result.code, 0, `${what} should be refused, got exit 0:\n${said}`);
  assert.notEqual(said.trim(), '', `${what}: a refusal says why`);
  assert.ok(!/^\s+at /m.test(said), `${what}: expected a message, got a crash:\n${said}`);
}

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');


/** The tab each Orca terminal shows Orca's notices in, by handle: how many it has now. */
const noticeCounts = async (box) => Object.fromEntries((await box.orca.terminals()).map((one) => [one.handle, (one.notices ?? []).length]));

// ------------------------------------------------------------------ A1 a mailbox

test('A1 up of a Pi session gives it a mailbox', async (t) => {
  // One fleet for the group: nothing below changes it.
  const box = await createSandbox(t);
  const { bots } = await fleetIn(box, ['coder', 'pier', 'pier-two']);

  await t.test('A1 the launch line of a Pi session runs the kit\'s mailbox step in its tab before pi, as a Codex line does', async () => {
    const pier = typedInto(await tabOf(box, bots, 'pier'));
    const coder = typedInto(await tabOf(box, bots, 'coder'));

    // The premise: the Codex line, which has a mailbox, starts with its step.
    assert.ok(coder[0].startsWith(`${mailboxStep(box, { bot: 'coder', session: 'daily' })}; `), `the premise, got: ${coder[0]}`);
    assert.equal(pier.length, 1, `one line typed into the Pi tab at up, got: ${JSON.stringify(pier)}`);
    const step = `${mailboxStep(box, { bot: 'pier', session: 'daily' })}; `;
    assert.ok(pier[0].startsWith(step), `the Pi line should start with its mailbox step:\n  want: ${step}…\n  got:  ${pier[0]}`);
    assert.equal(pier[0].indexOf(harnessPartOf(pier[0])), step.length, `and pi comes straight after it, got: ${pier[0]}`);
    assert.ok(
      harnessPartOf(pier[0]).startsWith(`${TAB_SHELL} ${cliOnLine(box.cli)} pi `),
      `the rest of the line starts pi, as slice 1 made it, got: ${pier[0]}`,
    );
  });

  await t.test('A1 once the step has run in the Pi tab, the book holds a mailbox for the session: a Run bound to that tab', async () => {
    const tab = await tabOf(box, bots, 'pier');

    const steps = (await box.orca.steps()).filter((step) => step.handle === tab.handle);
    assert.equal(steps.length, 1, `the fake ran one mailbox step in the Pi tab, got: ${JSON.stringify(steps)}`);
    assert.equal(steps[0].status, 0, `and it went through: ${steps[0].stdout}${steps[0].stderr}`);

    const { mailbox } = await sessionIn(bots, 'pier', 'daily');
    assert.equal(typeof mailbox, 'string', `the book holds a mailbox for pier/daily, got: ${JSON.stringify(await sessionIn(bots, 'pier', 'daily'))}`);
    const run = (await box.orca.runs()).find((one) => one.id === mailbox);
    assert.ok(run, `Orca has the Run the book names, got: ${JSON.stringify(await box.orca.runs())}`);
    assert.equal(run.coordinator_handle, tab.handle, 'the Run is bound to the Pi tab, so Orca\'s notice goes there');
    assert.notEqual((await sessionIn(bots, 'pier-two', 'daily')).mailbox, mailbox, 'each Pi session has a mailbox of its own');
  });
});

// ------------------------------------------------------------------ A2 the road

const TO_PI = [
  ['a Claude sender at auto', 'writer/daily'],
  ['a Claude sender at dangerously-skip, the level every Pi session has', 'skipper/daily'],
  ['a Codex sender', 'coder/daily'],
  ['a Pi sender', 'pier-two/daily'],
];

const FROM_PI = [
  ['a Claude session at auto', 'writer/daily'],
  ['a Claude session at dangerously-skip', 'skipper/daily'],
  ['a Codex session', 'coder/daily'],
];

test('A2 message to names the Orca road to and from a Pi session, never the native one', async (t) => {
  // One fleet for the table: `message to` sends nothing and changes nothing.
  const box = await createSandbox(t);
  const { bots } = await fleetIn(box);

  for (const [label, from] of TO_PI) {
    await t.test(`A2 to a Pi session from ${label}: the Orca road, at run:<its mailbox>`, async () => {
      const answer = await askTo(box, ['--to', 'pier/daily', '--from', from]);

      assert.deepEqual(
        { transport: answer.transport, address: answer.address },
        { transport: 'orca', address: await mailboxOf(bots, 'pier') },
        `got: ${JSON.stringify(answer)}`,
      );
    });
  }

  for (const [label, to] of FROM_PI) {
    await t.test(`A2 from a Pi sender to ${label}: the Orca road, at the receiver's mailbox`, async () => {
      const answer = await askTo(box, ['--to', to, '--from', 'pier/daily']);

      assert.deepEqual(
        { transport: answer.transport, address: answer.address },
        { transport: 'orca', address: await mailboxOf(bots, to) },
        `got: ${JSON.stringify(answer)}`,
      );
    });
  }

  await t.test('A2 from inside a Pi tab, with no --from, it answers for that Pi session: the Orca road to a Claude receiver at dangerously-skip', async () => {
    // A Claude sender at dangerously-skip would be native to skipper; a Pi one is not.
    const answer = await askTo(box, ['--to', 'skipper'], { env: inTab(box, await tabOf(box, bots, 'pier')) });

    assert.deepEqual(
      { transport: answer.transport, address: answer.address },
      { transport: 'orca', address: await mailboxOf(bots, 'skipper') },
      `got: ${JSON.stringify(answer)}`,
    );
  });
});

// ------------------------------------------------------------------ never brought up

test('a Pi session never brought up has no mailbox yet, and to, send and check say so', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box, ['writer', 'coder', 'pier']);
  for (const bot of ['pier', 'writer']) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', 'night', ...(bot === 'pier' ? ['--prompt', 'You watch the night queue.'] : [])]);
    assert.equal(added.code, 0, `${added.stdout}${added.stderr}`);
  }

  await t.test('A2 message to gives a Pi session never brought up the same "no mailbox yet" answer as a Claude one', async () => {
    const pi = await box.run(['message', 'to', '--bots', 'bots', '--to', 'pier/night', '--from', 'coder/daily']);
    const claude = await box.run(['message', 'to', '--bots', 'bots', '--to', 'writer/night', '--from', 'coder/daily']);

    assertRefused(pi, 'night', 'obk up');
    assertRefused(claude, 'night', 'obk up');
    // The names differ in length, and a table pads its columns to them.
    const said = (result, bot) => `${result.stdout}\n${result.stderr}`.replaceAll(bot, '<bot>').replaceAll(/[ \t]+/g, ' ');
    assert.equal(said(pi, 'pier'), said(claude, 'writer'), 'the same answer, but for the name of the bot');
  });

  await t.test('a send to a Pi session never brought up is refused, and nothing is queued or typed', async () => {
    const result = await send(box, { to: 'pier/night', from: 'writer/daily' });

    assertRefused(result, 'night');
    assert.deepEqual(await addedBy(box, result), [], 'nothing is queued');
    assertNothingTyped(result.calls, 'a receiver never up');
  });

  await t.test('a check for a Pi session never brought up says it has no mailbox, and reads none', async () => {
    const before = (await box.orca.calls()).length;

    const result = await box.run(['message', 'check', '--bots', 'bots', '--bot', 'pier', '--session', 'night']);

    assertRefused(result, 'night');
    assert.deepEqual(orcaCallsOf((await box.orca.calls()).slice(before), 'orchestration check'), [], 'no mailbox was read');
  });
});

// ------------------------------------------------------------------ A3 the send

test('A3 message send to a Pi session puts the letter in its Orca mailbox and types nothing', async (t) => {
  // One fleet for the group. Each case reads only what its own send added.
  const box = await createSandbox(t);
  const { bots } = await fleetIn(box);

  for (const [label, from] of TO_PI) {
    await t.test(`A3 from ${label}: the letter is in the Pi session's Orca mailbox, from the sender's own, and nothing is typed`, async () => {
      const result = await send(box, { to: 'pier/daily', from });

      await assertPosted(box, result, { from: await mailboxOf(bots, from), to: await mailboxOf(bots, 'pier') });
      assert.match(result.stdout, ORCA_MAILBOX, `the output says it went by the Orca mailbox, got:\n${result.stdout}`);
      assertNothingTyped(result.calls, `a send from ${from}`);
    });
  }

  await t.test('A3 the letter brings Orca\'s own notice into the Pi tab, naming its Run, and into no other tab', async () => {
    // The fake writes Orca's notice into the tab the receiver's Run is bound
    // to: the signal is Orca's, not a line of the kit's.
    const pier = await tabOf(box, bots, 'pier');
    const run = (await mailboxOf(bots, 'pier')).slice('run:'.length);
    const before = await noticeCounts(box);

    const result = await send(box, { to: 'pier', from: 'writer/daily' });

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    const after = await noticeCounts(box);
    const told = Object.keys(after).filter((handle) => after[handle] > (before[handle] ?? 0));
    assert.deepEqual(told, [pier.handle], 'Orca told the Pi tab and nobody else');
    const notices = (await tabOf(box, bots, 'pier')).notices;
    assert.match(notices.at(-1), new RegExp(`--run ${escapeRe(run)}(?![\\w-])`), `naming its own Run, got: ${JSON.stringify(notices)}`);
    assertNothingTyped(result.calls, 'the kit');
  });

  await t.test('A3 a send from a Pi sender to a Claude receiver goes into the Claude session\'s mailbox, from the Pi session\'s own', async () => {
    const result = await send(box, { to: 'skipper', from: 'pier/daily' });

    await assertPosted(box, result, { from: await mailboxOf(bots, 'pier'), to: await mailboxOf(bots, 'skipper') });
    assertNothingTyped(result.calls, 'a send from Pi');
  });
});

// ------------------------------------------------------------------ A4 the sender from the tab

test('A4 message send from inside a Pi session\'s tab takes the sender from the tab', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await fleetIn(box, ['writer', 'coder', 'pier', 'pier-two']);
  const pier = await tabOf(box, bots, 'pier');

  await t.test('A4 with no --from, the send goes from that Pi session\'s mailbox', async () => {
    const result = await send(box, { to: 'writer', env: inTab(box, pier) });

    await assertPosted(box, result, { from: await mailboxOf(bots, 'pier'), to: await mailboxOf(bots, 'writer') });
  });

  await t.test('A4 with --from that Pi session, the send goes from its mailbox', async () => {
    const result = await send(box, { to: 'coder', from: 'pier/daily', env: inTab(box, pier) });

    await assertPosted(box, result, { from: await mailboxOf(bots, 'pier'), to: await mailboxOf(bots, 'coder') });
  });

  for (const [label, from] of [['a session of another bot', 'coder/daily'], ['the other Pi bot\'s session', 'pier-two/daily']]) {
    await t.test(`A4 with --from ${label}, the send is refused, names the tab's session, and sends nothing`, async () => {
      const result = await send(box, { to: 'writer', from, env: inTab(box, pier) });

      assertCleanRefusal(result, `--from ${from} from pier's tab`);
      assert.ok(`${result.stdout}${result.stderr}`.includes('pier/daily'), `the refusal names the tab's own session, got:\n${result.stdout}${result.stderr}`);
      assert.deepEqual(await addedBy(box, result), [], 'no letter is queued');
      const wrote = result.calls.map(orcaCommand).filter((command) => ['orchestration send', 'terminal send'].includes(command));
      assert.deepEqual(wrote, [], 'nothing is posted and nothing is typed');
    });
  }

  await t.test('A4 a Pi tab without the kit\'s launch mark is still its session: the send goes, where a Codex tab without it is refused', async () => {
    // The Codex refusal (#408) is about Codex's shared background server, whose
    // processes carry another session's tab. Pi runs no such server. A Pi Orca
    // brought back by itself runs `pi --session <file>` with none of the kit's
    // variables (tech notes, section 6).
    const codex = await send(box, { to: 'writer', env: inTab(box, await tabOf(box, bots, 'coder'), { kit: false }) });
    assertCleanRefusal(codex, 'the premise: a send from a Codex tab without the mark');
    assert.deepEqual(await addedBy(box, codex), [], 'the premise: nothing queued from the Codex tab');

    const pi = await send(box, { to: 'writer', env: inTab(box, pier, { kit: false }) });

    await assertPosted(box, pi, { from: await mailboxOf(bots, 'pier'), to: await mailboxOf(bots, 'writer') });
  });
});

// ------------------------------------------------------------------ A5 the check

test('A5 message check from a Pi session\'s tab with no --bot reads and acknowledges its own mail, and leaves the other Pi session\'s', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await fleetIn(box, ['writer', 'pier', 'pier-two']);
  const tab = await tabOf(box, bots, 'pier');
  const mine = await send(box, { to: 'pier', from: 'writer/daily', subject: 'for pier', text: 'the queue is long' });
  assert.equal(mine.code, 0, `${mine.stdout}${mine.stderr}`);
  const theirs = await send(box, { to: 'pier-two', from: 'writer/daily', subject: 'for pier-two', text: 'the notes are late' });
  assert.equal(theirs.code, 0, `${theirs.stdout}${theirs.stderr}`);

  const result = await box.run(['message', 'check', '--bots', 'bots'], { env: inTab(box, tab) });

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.ok(result.stdout.includes('for pier') && result.stdout.includes('the queue is long'), `its own letter, got:\n${result.stdout}`);
  assert.ok(!result.stdout.includes('the notes are late'), `and not the other session's, got:\n${result.stdout}`);
  assert.deepEqual(
    (await box.orca.messages()).map((message) => ({ to: message.to, acked: message.acked })),
    [{ to: await mailboxOf(bots, 'pier'), acked: true }, { to: await mailboxOf(bots, 'pier-two'), acked: false }],
    'its own letter is acknowledged, the other is still waiting',
  );

  const again = await box.run(['message', 'check', '--bots', 'bots'], { env: inTab(box, tab) });
  assert.equal(again.code, 0, `${again.stdout}${again.stderr}`);
  assert.ok(!again.stdout.includes('the queue is long'), `read once, it is not handed over again, got:\n${again.stdout}`);
});

// ------------------------------------------------------------------ A6 the interrupt

test('A6 --interrupt to a Pi receiver presses one Escape when it is busy, and nothing when it is idle', async (t) => {
  // In order: the receiver idle first, then busy from the third case on.
  const box = await createSandbox(t);
  const { bots } = await fleetIn(box, ['writer', 'pier']);
  const tab = await tabOf(box, bots, 'pier');
  const letter = async (result) => assertPosted(box, result, { from: await mailboxOf(bots, 'writer'), to: await mailboxOf(bots, 'pier') });

  await t.test('A6 --interrupt to an idle Pi receiver presses nothing, and posts the letter', async () => {
    const result = await send(box, { to: 'pier', from: 'writer/daily', extra: ['--interrupt'] });

    await letter(result);
    assertNothingTyped(result.calls, 'idle Pi');
  });

  await setTab(box, tab.tabId, { tuiIdle: 'busy' });

  await t.test('A3 a send to a busy Pi receiver without --interrupt types nothing: the letter waits in its mailbox', async () => {
    const result = await send(box, { to: 'pier', from: 'writer/daily' });

    await letter(result);
    assertNothingTyped(result.calls, 'busy Pi, no --interrupt');
  });

  await t.test('A6 --interrupt to a busy Pi receiver presses one Escape in its tab, with no Enter, then posts; its output speaks of the Escape and not of a Codex background terminal', async () => {
    const result = await send(box, { to: 'pier', from: 'writer/daily', extra: ['--interrupt'] });

    await letter(result);
    assertOneEscapeThenPost(result.calls, tab.handle, 'busy Pi');
    assert.match(result.stdout, /interrupt|escape/i, `the output says what was done, got:\n${result.stdout}`);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /background terminal/i, `nothing of Codex's background terminal, got:\n${result.stdout}${result.stderr}`);
  });
});

// ------------------------------------------------------------------ orphaned

test('a send to a Pi session whose tab Orca lists as orphaned: the letter is in its mailbox, the answer says it waits, and nothing is typed or switched', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await fleetIn(box, ['writer', 'pier']);
  const { handle } = await tabOf(box, bots, 'pier');
  await box.orca.orphan(handle);

  const result = await send(box, { to: 'pier', from: 'writer/daily' });

  await assertPosted(box, result, { from: await mailboxOf(bots, 'writer'), to: await mailboxOf(bots, 'pier') });
  const text = result.stdout;
  assert.match(text, /orphaned/i, `the answer says the Pi tab is orphaned, got:\n${text}`);
  assert.match(text, /wait/i, `and that the letter waits, got:\n${text}`);
  assert.match(text, new RegExp(`terminal switch --terminal ${escapeRe(handle)}(?![\\w-])`), `and names the switch by the Pi tab's handle, got:\n${text}`);
  assert.doesNotMatch(text, /notice tells it to look/i, `and does not claim Orca's notice, got:\n${text}`);
  assertNothingTyped(result.calls, 'an orphaned Pi tab');
  const moved = result.calls.filter((call) => ['terminal switch', 'terminal focus'].includes(orcaCommand(call)));
  assert.deepEqual(moved.map((call) => call.args), [], 'the kit switches to no tab itself');

  const json = await send(box, { to: 'pier', from: 'writer/daily', extra: ['--json'] });
  assert.equal(json.code, 0, `${json.stdout}${json.stderr}`);
  assert.equal(JSON.parse(json.stdout).orphaned, true, `--json carries orphaned: true, got: ${json.stdout}`);
});
