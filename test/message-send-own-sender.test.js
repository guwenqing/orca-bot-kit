// `obk message send --from` from a fleet tab sends only as that tab's own
// session (#570).
//
// The default rules allow `obk message send` to every bot. Before #570 the kit
// took `--from <bot>/<session>` at its word and sent from that session's
// mailbox, whatever tab the command ran in. So a bot in its own tab could name
// another fleet session as the sender, and the receiver's `message check`
// showed that other session as the writer.
//
// The caller's tab is ORCA_TAB_ID. A fleet tab is a tab that the books of the
// `--bots` folder on the command line give to one of its sessions.
//
//   R1  From a fleet tab, `--from` that names any other session (of another
//       bot, or another session of the same bot) is refused: not 0, a message
//       and no crash, and the refusal names the tab's own session. Nothing is
//       sent: no message is queued, nothing is typed into the receiver's tab
//       (with `--interrupt` to a busy receiver), and no file is written beside
//       the bots folder (with a body over 4 KiB).
//   R2  From a fleet tab, `--from` that names the tab's own session is sent as
//       before, from that session's mailbox.
//   R3  Outside a fleet tab, `--from` is sent as before, from the mailbox of the
//       session it names: a plain shell with no ORCA_* variables; Bot Father's
//       ops tab, which is no session's; and a tab that is a session's tab in
//       another bots folder only (how the live system tests run).
//   R4  A Claude tab without the kit's launch-line mark is still its session,
//       so R1 and R2 hold there. A Codex tab without the mark is refused for
//       the #408 reason (restored-codex-caller.test.js); a Codex tab with the
//       mark is covered here as any other fleet tab.
//
// Scope: `message send` only. `message to` sends nothing and does not change.
// The words of the refusal are the implementer's; the test reads only that it
// names the tab's own session as `<bot>/<session>`. Every run is in the
// sandbox (helpers/cli.js), against the fake Orca.

import assert from 'node:assert/strict';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  botFatherTabs,
  botHomeOf,
  createSandbox,
  orcaCallsOf,
  orcaCommand,
  sessionIn,
  tabsOfBot,
} from './helpers/cli.js';

// ---------------------------------------------------------------- the fleet

/** Run one obk command that has to work. */
async function ok(box, args) {
  const result = await box.run(args);
  assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stderr}${result.stdout}`);
}

/**
 * Bot Father, `coder` on Codex with two sessions (daily and review), and
 * `writer` on Claude with one, all brought up by the kit in the bots folder
 * `folder`. Answers the bots folder and each session's tab as Orca has it.
 */
async function fleet(box, folder = 'bots') {
  await ok(box, ['init', '--bots', folder, '--harness', 'claude']);
  await ok(box, ['bot', 'create', '--bots', folder, '--name', 'coder', '--harness', 'codex']);
  await ok(box, ['session', 'add', '--bots', folder, '--bot', 'coder', '--name', 'daily', '--prompt', 'You write the code.']);
  await ok(box, ['session', 'add', '--bots', folder, '--bot', 'coder', '--name', 'review', '--prompt', 'You review the code.']);
  await ok(box, ['bot', 'create', '--bots', folder, '--name', 'writer', '--harness', 'claude']);
  await ok(box, ['session', 'add', '--bots', folder, '--bot', 'writer', '--name', 'daily', '--prompt', 'You write the docs.']);
  await ok(box, ['up', '--bots', folder]);
  const bots = box.path(folder);
  return {
    bots,
    'bot-father/daily': await tabOf(box, bots, 'bot-father', 'daily'),
    'coder/daily': await tabOf(box, bots, 'coder', 'daily'),
    'coder/review': await tabOf(box, bots, 'coder', 'review'),
    'writer/daily': await tabOf(box, bots, 'writer', 'daily'),
  };
}

/** The Orca tab the book gives one session. */
async function tabOf(box, bots, bot, session) {
  const { tab } = await sessionIn(bots, bot, session);
  const found = (await tabsOfBot(box, bots, bot)).find((terminal) => terminal.tabId === tab);
  assert.ok(found, `the premise: Orca has ${bot}/${session}'s tab ${tab}`);
  return found;
}

// ------------------------------------------------------- who is calling

/**
 * The environment of a command run in `terminal`: Orca's two variables, as
 * Orca sets them in every pane. `kit` adds what the kit's launch line gives the
 * harness, and so every command the harness runs. `codex` adds what a Codex
 * tool command carries.
 */
const inTab = (box, terminal, { kit = true, codex = false } = {}) => ({
  ...box.env,
  ORCA_TAB_ID: terminal.tabId,
  ORCA_TERMINAL_HANDLE: terminal.handle,
  ...(codex ? { CODEX_THREAD_ID: '0199b2c0-0570-4444-8888-cccccccccccc', CODEX_SANDBOX: 'seatbelt' } : {}),
  ...(kit ? { OBK_TAB_SHELL: String(process.pid), OBK_CLI: box.cli } : {}),
});

/** A command from a session's own tab, as the harness the kit started there runs it. */
const fromSessionTab = (box, fleetOf, session) => inTab(box, fleetOf[session], { codex: session.startsWith('coder/') });

// ------------------------------------------------------------ the mail

/** The mailbox address of one session, as a send writes it. */
const mailboxOf = async (bots, address) => {
  const [bot, session] = address.split('/');
  return `run:${(await sessionIn(bots, bot, session)).mailbox}`;
};

/** `obk message send` in `folder`, to `to`, from `from`, with `extra` flags. */
const sendArgs = ({ folder = 'bots', to, from, subject = 'the staging host', text = 'It is down again.', extra = [] }) => [
  'message', 'send', '--bots', folder, '--to', to, '--from', from, '--subject', subject, '--text', text, ...extra,
];

/** Run a send and answer its result with the Orca calls it made. */
async function sendIn(box, args, env) {
  const before = (await box.orca.calls()).length;
  const queuedBefore = await box.orca.messages();
  const result = await box.run(args, env === undefined ? {} : { env });
  return { ...result, calls: (await box.orca.calls()).slice(before), queuedBefore };
}

/** Exit 0, and exactly one message queued, from `from` (a mailbox address) to `to`. */
async function assertSentFrom(box, result, { from, to }) {
  assert.equal(result.code, 0, `the send should have gone:\n${result.stdout}${result.stderr}`);
  const queued = await box.orca.messages();
  assert.equal(queued.length, 1, `one message should be queued, got: ${JSON.stringify(queued)}`);
  assert.equal(queued[0].from, from, `the message comes from the named session's mailbox, got: ${JSON.stringify(queued[0])}`);
  assert.equal(queued[0].to, to, `and goes to the receiver's, got: ${JSON.stringify(queued[0])}`);
}

/**
 * The refusal #570 asks for: not 0, something said and no crash, the tab's own
 * session named so the caller can see what it may send as, and nothing sent:
 * no message queued and no `orchestration send` or `terminal send` made.
 */
async function assertRefusedAsNotItsOwn(box, result, own) {
  const said = `${result.stdout}\n${result.stderr}`;
  assert.notEqual(result.code, 0, `a send from a fleet tab naming another session should be refused, got exit 0:\n${said}`);
  assert.notEqual(said.trim(), '', 'a refusal says why');
  assert.ok(!/^\s+at /m.test(result.stdout + result.stderr), `expected a message, got a crash:\n${said}`);
  assert.ok(said.includes(own), `the refusal names the tab's own session ${own}, got:\n${said}`);
  assert.deepEqual(await box.orca.messages(), result.queuedBefore, 'no message is queued');
  const wrote = result.calls.map(orcaCommand).filter((command) => ['orchestration send', 'terminal send'].includes(command));
  assert.deepEqual(wrote, [], 'nothing is posted to a mailbox and nothing is typed into any tab');
}

// ---------------------------------------------------------------------------
// R1 a fleet tab naming another session is refused
// ---------------------------------------------------------------------------

// Each case: the tab the command runs in, the session `--from` names, and a
// receiver whose name is not the tab's own, so the refusal's naming of the tab's
// session cannot come from an echo of the receiver. One side of every pair is
// on Codex, so no pair is the native Claude pair a send refuses for its own
// reason (message-send.test.js).
const OTHERS = [
  ['writer/daily', 'coder/daily', 'coder/review', 'a session of another bot'],
  ['writer/daily', 'bot-father/daily', 'coder/daily', 'Bot Father\'s session'],
  ['coder/daily', 'coder/review', 'writer', 'another session of the same bot'],
  ['coder/daily', 'writer/daily', 'coder/review', 'a session of another bot, from a Codex tab'],
];

test('R1 from a session\'s own tab, --from another session is refused, names the tab\'s session, and sends nothing', async (t) => {
  // One fleet for the table: a refusal changes nothing, so each case starts
  // from the same world. Each case is a subtest, so each one reports.
  const box = await createSandbox(t);
  const tabs = await fleet(box);

  for (const [tab, from, to, what] of OTHERS) {
    await t.test(`from ${tab}'s tab, --from ${from}: ${what}`, async () => {
      const result = await sendIn(box, sendArgs({ to, from }), fromSessionTab(box, tabs, tab));

      await assertRefusedAsNotItsOwn(box, result, tab);
    });
  }
});

test('R1 a refused send with --interrupt presses nothing in a busy receiver\'s tab; the same send as the tab\'s own session does', async (t) => {
  // The receiver is busy, so a send that went would press one Escape there
  // (mail-interrupt.test.js, I1). The contrast shows the setup would press.
  const box = await createSandbox(t);
  const tabs = await fleet(box);
  const receiver = tabs['coder/review'];
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((one) => (one.tabId === receiver.tabId ? { ...one, tuiIdle: 'busy' } : one)),
  });
  const env = fromSessionTab(box, tabs, 'writer/daily');

  const refused = await sendIn(box, sendArgs({ to: 'coder/review', from: 'coder/daily', extra: ['--interrupt'] }), env);

  await assertRefusedAsNotItsOwn(box, refused, 'writer/daily');
  assert.deepEqual(orcaCallsOf(refused.calls, 'terminal send').map((call) => call.args), [], 'no Escape in the receiver\'s tab');

  const own = await sendIn(box, sendArgs({ to: 'coder/review', from: 'writer/daily', extra: ['--interrupt'] }), env);

  await assertSentFrom(box, own, { from: await mailboxOf(tabs.bots, 'writer/daily'), to: await mailboxOf(tabs.bots, 'coder/review') });
  assert.equal(orcaCallsOf(own.calls, 'terminal send').length, 1, `the premise: a send that goes presses one Escape, got: ${JSON.stringify(own.calls.map((call) => call.args))}`);
});

/**
 * Every file the kit has beside the bots folder, at any depth, lock files left
 * out: as `besideTheBotsFolder` in message-send.test.js reads it. A long body
 * is written to one of these.
 */
async function besideTheBotsFolder(bots) {
  const parent = path.dirname(bots);
  const mine = path.basename(bots);
  const found = [];
  for (const name of await readdir(parent)) {
    if (!name.startsWith(`${mine}.`)) continue;
    const dir = path.join(parent, name);
    if (!(await stat(dir)).isDirectory()) continue;
    found.push(...(await filesUnder(dir)).filter((file) => !/\.lock(?:-journal|-wal|-shm)?$/.test(file)));
  }
  return found;
}

/** Every file under `dir`, at any depth. */
async function filesUnder(dir) {
  const found = [];
  for (const entry of await readdir(dir)) {
    const at = path.join(dir, entry);
    if ((await stat(at)).isDirectory()) found.push(...await filesUnder(at));
    else found.push(at);
  }
  return found;
}

test('R1 a refused send with a body over 4 KiB writes no file beside the bots folder; the same send as the tab\'s own session writes one', async (t) => {
  const box = await createSandbox(t);
  const tabs = await fleet(box);
  const env = fromSessionTab(box, tabs, 'writer/daily');
  const text = 'x'.repeat(4097);
  const before = await besideTheBotsFolder(tabs.bots);

  const refused = await sendIn(box, sendArgs({ to: 'coder/review', from: 'coder/daily', text }), env);

  await assertRefusedAsNotItsOwn(box, refused, 'writer/daily');
  const afterRefusal = await besideTheBotsFolder(tabs.bots);
  assert.deepEqual(afterRefusal.filter((file) => !before.includes(file)), [], 'no file is written for the body');

  const own = await sendIn(box, sendArgs({ to: 'coder/review', from: 'writer/daily', text }), env);

  await assertSentFrom(box, own, { from: await mailboxOf(tabs.bots, 'writer/daily'), to: await mailboxOf(tabs.bots, 'coder/review') });
  const written = (await besideTheBotsFolder(tabs.bots)).filter((file) => !afterRefusal.includes(file));
  assert.equal(written.length, 1, `the premise: a send that goes writes the body to one file, got: ${JSON.stringify(written)}`);
});

// ---------------------------------------------------------------------------
// R2 a fleet tab naming its own session is sent as before
// ---------------------------------------------------------------------------

for (const [tab, to] of [['writer/daily', 'coder/review'], ['coder/daily', 'writer']]) {
  test(`R2 from ${tab}'s own tab, --from ${tab} is sent from ${tab}'s mailbox`, async (t) => {
    const box = await createSandbox(t);
    const tabs = await fleet(box);

    const result = await sendIn(box, sendArgs({ to, from: tab }), fromSessionTab(box, tabs, tab));

    await assertSentFrom(box, result, { from: await mailboxOf(tabs.bots, tab), to: await mailboxOf(tabs.bots, to.includes('/') ? to : `${to}/daily`) });
  });
}

// ---------------------------------------------------------------------------
// R3 outside a fleet tab, --from is sent as before
// ---------------------------------------------------------------------------

test('R3 from a plain shell with no ORCA_* variables, --from is sent from the named session\'s mailbox', async (t) => {
  const box = await createSandbox(t);
  const tabs = await fleet(box);
  assert.deepEqual(Object.keys(box.env).filter((name) => name.startsWith('ORCA_')), [], 'the premise: no Orca variables');

  const result = await sendIn(box, sendArgs({ to: 'writer', from: 'coder/review' }));

  await assertSentFrom(box, result, { from: await mailboxOf(tabs.bots, 'coder/review'), to: await mailboxOf(tabs.bots, 'writer/daily') });
});

test('R3 from Bot Father\'s ops tab, which is no session\'s, --from is sent from the named session\'s mailbox', async (t) => {
  const box = await createSandbox(t);
  const tabs = await fleet(box);
  const ops = (await botFatherTabs(box, tabs.bots)).leftovers.filter((one) => one.worktreePath === botHomeOf(tabs.bots));
  assert.equal(ops.length, 1, `the premise: Bot Father's ops tab is the one tab of his outside the book, got: ${JSON.stringify(ops)}`);

  const result = await sendIn(box, sendArgs({ to: 'coder/review', from: 'writer/daily' }), inTab(box, ops[0], { kit: false }));

  await assertSentFrom(box, result, { from: await mailboxOf(tabs.bots, 'writer/daily'), to: await mailboxOf(tabs.bots, 'coder/review') });
});

test('R3 from a session\'s tab in another bots folder, --from in the --bots folder named is sent from that session\'s mailbox', async (t) => {
  // How the live system tests run: the developer's own fleet tab, with a
  // throwaway --bots folder whose books do not know that tab.
  const box = await createSandbox(t);
  const mine = await fleet(box, 'bots');
  const scratch = await fleet(box, 'scratch');
  const caller = mine['writer/daily'];
  for (const session of ['bot-father/daily', 'coder/daily', 'coder/review', 'writer/daily']) {
    assert.notEqual(scratch[session].tabId, caller.tabId, `the premise: the scratch folder's ${session} has a tab of its own`);
  }

  const result = await sendIn(
    box,
    sendArgs({ folder: 'scratch', to: 'writer', from: 'coder/review' }),
    fromSessionTab(box, mine, 'writer/daily'),
  );

  await assertSentFrom(box, result, { from: await mailboxOf(scratch.bots, 'coder/review'), to: await mailboxOf(scratch.bots, 'writer/daily') });
});

// ---------------------------------------------------------------------------
// R4 a Claude tab without the kit's mark is still its session
// ---------------------------------------------------------------------------

test('R4 from a Claude tab without the kit\'s mark, --from another session is refused and names the tab\'s session', async (t) => {
  // A Claude session Orca brought back by itself: Claude Code runs no shared
  // server, so the tab's variables are its own (#408).
  const box = await createSandbox(t);
  const tabs = await fleet(box);

  const result = await sendIn(box, sendArgs({ to: 'coder/review', from: 'coder/daily' }), inTab(box, tabs['writer/daily'], { kit: false }));

  await assertRefusedAsNotItsOwn(box, result, 'writer/daily');
});

test('R4 from a Claude tab without the kit\'s mark, --from its own session is sent from its mailbox', async (t) => {
  const box = await createSandbox(t);
  const tabs = await fleet(box);

  const result = await sendIn(box, sendArgs({ to: 'coder/review', from: 'writer/daily' }), inTab(box, tabs['writer/daily'], { kit: false }));

  await assertSentFrom(box, result, { from: await mailboxOf(tabs.bots, 'writer/daily'), to: await mailboxOf(tabs.bots, 'coder/review') });
});
