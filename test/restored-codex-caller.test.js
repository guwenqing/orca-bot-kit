// A Codex session never acts under another session's tab (#408).
//
// Seen live on 2026-09-27 (Orca 1.4.214, codex-cli 0.157.1): Orca brought three
// Codex sessions back by itself as a bare `codex resume <id>`, without the
// kit's launch line and so without `--no-daemon`. Codex 0.157 then runs one
// shared background server for them, and every process of that server carries
// the environment of the session that started it: its ORCA_TAB_ID and its
// ORCA_TERMINAL_HANDLE. So a command another of those sessions runs looks, to
// the kit, as if it came from the first session's tab.
//
// The kit's launch line puts OBK_TAB_SHELL (and OBK_CLI) in the harness's
// environment, and every command the harness runs inherits it; the kit's
// Codex line always carries `--no-daemon`. A Codex Orca brought back by itself
// has no OBK_TAB_SHELL, and neither does anything run through the shared
// server. Inside Codex's sandbox `ps` cannot run at all, so the kit judges
// from the caller's environment alone.
//
// The rule, at the CLI: when a command would take the calling session from
// the caller's tab (`message send` with or without `--from`, since #570 holds
// a send from a session's tab to that session; `message to` without `--from`;
// `message check` without `--bot`; `temp make`; `temp retire`), or would read
// mail as the caller's terminal (`message check` with ORCA_TERMINAL_HANDLE set,
// `--bot/--session` given or not), and the book gives that tab to a Codex
// session, and the caller carries no OBK_TAB_SHELL, it refuses. The refusal
// says why (the command did not come from the Codex the kit started in that
// tab: a Codex Orca brought back runs its commands in Codex's shared background
// server, under the tab of whichever session started it), names `obk restart`,
// and says a restart can stop at "open in another app" while Codex's shared
// server still holds the conversation. That server outlives the sessions that
// started it, so a second restart does not help (seen live, run 5): the advice
// is Codex's own `codex app-server daemon stop` once every Codex session is
// back on the kit's line, then the stuck session's restart again. It
// writes nothing: no message, nothing typed, no mailbox read, acknowledged or
// bound, no temporary session made or retired, bot.yaml and the book as they
// were.
//
// Unchanged: the same commands with OBK_TAB_SHELL; a Claude tab without it; an
// explicit `--from` on `message to`; a tab that is no session's (Bot Father's
// ops tab).
//
// The words are the implementer's. What is read is the content, loosely: the
// reason (Codex, its shared background server), the restart, the other-app
// case and `codex app-server daemon stop` for it. Every run is in the sandbox
// (helpers/cli.js), against the fake Orca.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import {
  assertRefused,
  botFatherTabs,
  botHomeOf,
  createSandbox,
  orcaCommand,
  sessionIn,
  skipGit,
  snapshot,
  tabsOfBot,
} from './helpers/cli.js';

// ---------------------------------------------------------------- the fleet

/**
 * Bot Father, `coder` on Codex with two sessions (daily and review, the two
 * that shared a server live), and `writer` on Claude with one, all brought up
 * by the kit. Answers the bots folder and each session's tab as Orca has it.
 */
async function fleet(box) {
  const ok = async (args) => {
    const result = await box.run(args);
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stderr}${result.stdout}`);
  };
  await ok(['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(['bot', 'create', '--bots', 'bots', '--name', 'coder', '--harness', 'codex']);
  await ok(['session', 'add', '--bots', 'bots', '--bot', 'coder', '--name', 'daily', '--prompt', 'You write the code.']);
  await ok(['session', 'add', '--bots', 'bots', '--bot', 'coder', '--name', 'review', '--prompt', 'You review the code.']);
  await ok(['bot', 'create', '--bots', 'bots', '--name', 'writer', '--harness', 'claude']);
  await ok(['session', 'add', '--bots', 'bots', '--bot', 'writer', '--name', 'daily', '--prompt', 'You write the docs.']);
  await ok(['up', '--bots', 'bots']);
  const bots = box.path('bots');
  return {
    bots,
    daily: await tabOf(box, bots, 'coder', 'daily'),
    review: await tabOf(box, bots, 'coder', 'review'),
    writer: await tabOf(box, bots, 'writer', 'daily'),
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

/** A conversation id of the shape Codex gives one. */
const THREAD = '0199b2c0-0408-4444-8888-cccccccccccc';

/**
 * The environment of a command run in `terminal`: Orca's two variables for it,
 * as Orca sets them in every pane. `codex` adds what a Codex tool command was
 * seen to carry live (codex-cli 0.157.1): the conversation id and the sandbox.
 * `kit` adds what the kit's launch line gives the harness, and so every command
 * it runs: the pid of the tab's shell, and the CLI.
 */
const inTab = (box, terminal, { codex = false, kit = false } = {}) => ({
  ...box.env,
  ORCA_TAB_ID: terminal.tabId,
  ORCA_TERMINAL_HANDLE: terminal.handle,
  ...(codex ? { CODEX_THREAD_ID: THREAD, CODEX_SESSION_ID: THREAD, CODEX_SANDBOX: 'seatbelt' } : {}),
  ...(kit ? { OBK_TAB_SHELL: String(process.pid), OBK_CLI: box.cli } : {}),
});

/** A command from a Codex tab the kit launched: the launch line's mark is there. */
const fromKitCodex = (box, terminal) => inTab(box, terminal, { codex: true, kit: true });

/**
 * A command from a Codex tab with no mark: a Codex Orca brought back by itself,
 * or the shared server another restored session started, carrying this tab's
 * variables. To the kit the two are the same, which is the point.
 */
const fromRestoredCodex = (box, terminal) => inTab(box, terminal, { codex: true });

/** A command from a Claude tab with no mark: a Claude session Orca brought back. */
const fromRestoredClaude = (box, terminal) => inTab(box, terminal);

// ------------------------------------------------------------ the refusal

/** Every run of whitespace as one space, so a wrapped sentence reads the same. */
const flat = (text) => text.replace(/\s+/g, ' ').trim();

/** Words that name Codex's shared background server, loosely. */
const SHARED_SERVER = /\b(?:shared|background)\b[^.]{0,40}\bserver\b|\bdaemon\b/i;

/** Words that name the screen a restart can stop at. */
const OTHER_APP = /\banother app\b/i;

/**
 * What frees a conversation Codex's shared server still holds, seen live
 * (#408, run 5): the server outlives the sessions that started it, and a
 * second restart meets "open in another app" again. Codex's own stop of it,
 * once every Codex session is back on the kit's line, is the way past.
 */
const DAEMON_STOP = 'codex app-server daemon stop';

/**
 * Words that warn what the stop reaches: Codex's shared server ends for
 * everything using it. Read loosely.
 */
const STOP_REACH = /\b(?:everything|every|all|any|other)\b[^.;]{0,80}\b(?:using|uses|use|sharing|shares|share|connected to|attached to)\b[^.;]{0,40}\b(?:it|server)\b/i;

/** Words that say that reach includes Codex sessions the kit did not start, the owner's own among them. */
const BEYOND_THE_KIT = /\boutside (?:the kit|obk)\b|\bCodex sessions? (?:the kit|obk) (?:did not|didn't|does not|doesn't) start\b|\b(?:your|the owner's|the user's) own Codex\b/i;

/**
 * The refusal #408 asks for: not 0, a message rather than a crash, and it says
 * why (Codex, its shared background server), names `obk restart` (the kit's
 * own CLI, whose last word is obk), and the other-app case.
 */
function assertRefusedAsRestored(result) {
  const said = flat(`${result.stdout}\n${result.stderr}`);
  assert.notEqual(result.code, 0, `a command from a Codex tab without the kit's launch line should be refused, got exit 0:\n${said}`);
  assert.notEqual(said, '', 'a refusal says why');
  assert.ok(!/^\s+at /m.test(result.stdout + result.stderr), `expected a message, got a crash:\n${result.stdout}${result.stderr}`);
  assert.match(said, /\bCodex\b/, `it says the caller is a Codex the kit did not start, got: ${said}`);
  assert.match(said, SHARED_SERVER, `and why the kit cannot tell who asks: Codex's shared background server, got: ${said}`);
  assert.match(said, /\bobk'? restart\b/, `it names obk restart as the fix, got: ${said}`);
  assert.match(said, OTHER_APP, `and says a restart can stop at "open in another app", got: ${said}`);
  assert.ok(said.includes(DAEMON_STOP), `and that the way past it is Codex's own \`${DAEMON_STOP}\`, got: ${said}`);
  assert.match(said, STOP_REACH, `and warns that the stop ends Codex's shared server for everything using it, got: ${said}`);
  assert.match(said, BEYOND_THE_KIT, `Codex sessions outside the kit, the owner's own, included, got: ${said}`);
}

/** Orca commands that write: send, type, open, bind, read a mailbox, close. */
const WRITES = [
  'orchestration send',
  'orchestration check',
  'orchestration run-use',
  'orchestration run-create',
  'terminal send',
  'terminal create',
  'terminal rename',
  'terminal close',
  'project setup-update',
  'project setup-delete',
  'repo add',
  'automations create',
  'automations edit',
];

/** Everything a refusal leaves as it was: the bots folder, and Orca's tabs, mailboxes, messages and projects. */
async function world(box, bots) {
  return {
    files: await snapshot(bots, skipGit),
    terminals: await box.orca.terminals(),
    runs: await box.orca.runs(),
    messages: await box.orca.messages(),
    setups: await box.orca.setups(),
  };
}

/** Run `args` with `env` and hold it to the refusal, with nothing written. */
async function refusedWithNothingDone(box, bots, args, env) {
  const before = await world(box, bots);
  const from = (await box.orca.calls()).length;

  const result = await box.run(args, { env });

  assertRefusedAsRestored(result);
  const wrote = (await box.orca.calls()).slice(from).map(orcaCommand).filter((command) => WRITES.includes(command));
  assert.deepEqual(wrote, [], 'no message sent, nothing typed, no mailbox bound or read, no tab opened or closed');
  assert.deepEqual(await world(box, bots), before, 'bot.yaml, the book and Orca are as they were');
  return result;
}

// ------------------------------------------------------------ the mail

/** The mailbox address of one session, as a send writes it. */
const mailboxOf = async (bots, bot, session) => `run:${(await sessionIn(bots, bot, session)).mailbox}`;

/** Put one message in coder/<session>'s mailbox, sent from a plain shell. */
async function mailFor(box, session, subject) {
  const sent = await box.run([
    'message', 'send', '--bots', 'bots', '--to', `coder/${session}`, '--from', 'writer/daily',
    '--subject', subject, '--text', 'It is down again.',
  ]);
  assert.equal(sent.code, 0, `the premise: mail for coder/${session}: ${sent.stderr}${sent.stdout}`);
}

/** The messages to one session nobody has acknowledged. */
const waiting = async (box, bots, bot, session) => {
  const to = await mailboxOf(bots, bot, session);
  return (await box.orca.messages()).filter((message) => message.to === to && !message.acked);
};

const SEND = ['message', 'send', '--bots', 'bots', '--to', 'writer', '--subject', 'the build', '--text', 'It is green.'];

// ---------------------------------------------------------------------------
// message send
// ---------------------------------------------------------------------------

test('R1 message send with no --from, from a Codex tab without the kit\'s mark, is refused with the reason and sends nothing; with the mark it is sent as that session', async (t) => {
  const box = await createSandbox(t);
  const { bots, daily } = await fleet(box);

  await refusedWithNothingDone(box, bots, SEND, fromRestoredCodex(box, daily));

  const marked = await box.run(SEND, { env: fromKitCodex(box, daily) });
  assert.equal(marked.code, 0, `from the Codex the kit started, the same send works: ${marked.stderr}${marked.stdout}`);
  const queued = await box.orca.messages();
  assert.equal(queued.length, 1, `one message, got: ${JSON.stringify(queued)}`);
  assert.equal(queued[0].from, await mailboxOf(bots, 'coder', 'daily'), 'from the session whose tab it is');
});

test('R1 the second Codex session\'s tab is refused the same way: the rule is the tab\'s session\'s harness, not which session it is', async (t) => {
  const box = await createSandbox(t);
  const { bots, review } = await fleet(box);

  await refusedWithNothingDone(box, bots, SEND, fromRestoredCodex(box, review));
});

test('R1 message send with --from, from a Codex tab without the mark, is refused with the reason and sends nothing, even naming the tab\'s own session; with the mark, its own session is sent', async (t) => {
  // Since #570 a send from a session's tab may only be from that session, so
  // the kit has to know who is calling. From a Codex tab without the mark it
  // cannot (#408), whichever session --from names. Before #570 this send went,
  // from the session --from named.
  const box = await createSandbox(t);
  const { bots, daily } = await fleet(box);

  // Each pair has a Codex end, so none is a native Claude pair, refused for a
  // reason of its own.
  for (const [from, to] of [['coder/review', 'writer'], ['coder/daily', 'writer'], ['writer/daily', 'coder/review']]) {
    const args = ['message', 'send', '--bots', 'bots', '--to', to, '--from', from, '--subject', 'the build', '--text', 'It is green.'];
    await refusedWithNothingDone(box, bots, args, fromRestoredCodex(box, daily));
  }

  const marked = await box.run([...SEND, '--from', 'coder/daily'], { env: fromKitCodex(box, daily) });
  assert.equal(marked.code, 0, `from the Codex the kit started, its own session sends: ${marked.stderr}${marked.stdout}`);
  const queued = await box.orca.messages();
  assert.equal(queued.length, 1, `one message, got: ${JSON.stringify(queued)}`);
  assert.equal(queued[0].from, await mailboxOf(bots, 'coder', 'daily'), 'from the session whose tab it is');
});

test('R1 message send with no --from, from a Claude tab without the mark, is sent as that session, as before', async (t) => {
  // A Claude session Orca brought back is not affected: Claude Code runs no
  // shared server, so the tab's variables are its own.
  const box = await createSandbox(t);
  const { bots, writer } = await fleet(box);

  const result = await box.run(
    ['message', 'send', '--bots', 'bots', '--to', 'coder/daily', '--subject', 'the docs', '--text', 'They are done.'],
    { env: fromRestoredClaude(box, writer) },
  );

  assert.equal(result.code, 0, `${result.stderr}${result.stdout}`);
  const queued = await box.orca.messages();
  assert.equal(queued.length, 1, `one message, got: ${JSON.stringify(queued)}`);
  assert.equal(queued[0].from, await mailboxOf(bots, 'writer', 'daily'));
});

test('R1 message send with no --from, from Bot Father\'s ops tab, is refused as before: it asks for --from, and says nothing of Codex\'s server', async (t) => {
  // The ops tab is no session's, so there is no Codex to doubt; the answer is
  // today's, which asks the caller to say who is writing.
  const box = await createSandbox(t);
  const { bots } = await fleet(box);
  const ops = (await botFatherTabs(box, bots)).leftovers.filter((one) => one.worktreePath === botHomeOf(bots));
  assert.equal(ops.length, 1, `the premise: Bot Father's ops tab is the one tab of his outside the book, got: ${JSON.stringify(ops)}`);

  const result = await box.run(SEND, { env: inTab(box, ops[0]) });

  assertRefused(result, '--from');
  const said = flat(result.stdout + result.stderr);
  assert.doesNotMatch(said, SHARED_SERVER, `got: ${said}`);
  assert.doesNotMatch(said, OTHER_APP, `got: ${said}`);
  assert.deepEqual(await box.orca.messages(), []);
});

test('R1 with ps not permitted, as inside Codex\'s sandbox, the unmarked caller is still refused and the marked one still sends', async (t) => {
  // The rule is read from the caller's environment, not the process table:
  // inside Codex's workspace-write sandbox ps does not start at all.
  const box = await createSandbox(t);
  const { bots, daily } = await fleet(box);
  await box.orca.set({ ps: 'not-permitted' });

  await refusedWithNothingDone(box, bots, SEND, fromRestoredCodex(box, daily));

  const marked = await box.run(SEND, { env: fromKitCodex(box, daily) });
  assert.equal(marked.code, 0, `${marked.stderr}${marked.stdout}`);
  assert.equal((await box.orca.messages()).length, 1, 'the marked send went');
});

// ---------------------------------------------------------------------------
// message to
// ---------------------------------------------------------------------------

const TO = ['message', 'to', '--bots', 'bots', '--to', 'writer', '--json'];

/** `message to`'s answer, parsed, from a run that had to work. */
function answerOf(result) {
  assert.equal(result.code, 0, `${result.stderr}${result.stdout}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
}

test('R2 message to with no --from, from a Codex tab without the mark, is refused with the reason; with the mark it answers for that session', async (t) => {
  const box = await createSandbox(t);
  const { bots, daily } = await fleet(box);

  await refusedWithNothingDone(box, bots, TO, fromRestoredCodex(box, daily));

  const answer = answerOf(await box.run(TO, { env: fromKitCodex(box, daily) }));
  assert.deepEqual([answer.from?.bot, answer.from?.session], ['coder', 'daily'], `got: ${JSON.stringify(answer)}`);
  assert.equal(answer.address, await mailboxOf(bots, 'writer', 'daily'));
});

test('R2 message to with --from, from a Codex tab without the mark, answers for the session named', async (t) => {
  const box = await createSandbox(t);
  const { daily } = await fleet(box);

  const answer = answerOf(await box.run([...TO, '--from', 'coder/review'], { env: fromRestoredCodex(box, daily) }));

  assert.deepEqual([answer.from?.bot, answer.from?.session], ['coder', 'review'], `got: ${JSON.stringify(answer)}`);
});

test('R2 message to with no --from, from a Claude tab without the mark, answers for that session, as before', async (t) => {
  const box = await createSandbox(t);
  const { writer } = await fleet(box);

  const answer = answerOf(await box.run(
    ['message', 'to', '--bots', 'bots', '--to', 'coder/daily', '--json'],
    { env: fromRestoredClaude(box, writer) },
  ));

  assert.deepEqual([answer.from?.bot, answer.from?.session], ['writer', 'daily'], `got: ${JSON.stringify(answer)}`);
});

// ---------------------------------------------------------------------------
// message check
// ---------------------------------------------------------------------------

const CHECK = ['message', 'check', '--bots', 'bots'];

test('R3 message check naming nobody, from a Codex tab without the mark, is refused with the reason and reads nothing; with the mark it reads that session\'s mail', async (t) => {
  const box = await createSandbox(t);
  const { bots, daily } = await fleet(box);
  await mailFor(box, 'daily', 'for daily');

  await refusedWithNothingDone(box, bots, CHECK, fromRestoredCodex(box, daily));
  assert.equal((await waiting(box, bots, 'coder', 'daily')).length, 1, 'daily\'s mail is still waiting');

  const marked = await box.run(CHECK, { env: fromKitCodex(box, daily) });
  assert.equal(marked.code, 0, `${marked.stderr}${marked.stdout}`);
  assert.ok(marked.stdout.includes('for daily'), `the Codex the kit started reads its mail, got: ${marked.stdout}`);
  assert.deepEqual(await waiting(box, bots, 'coder', 'daily'), [], 'and it is acknowledged');
});

test('R3 message check naming the tab\'s own session, from its Codex tab without the mark, is refused: it would read as the caller\'s terminal', async (t) => {
  const box = await createSandbox(t);
  const { bots, daily } = await fleet(box);
  await mailFor(box, 'daily', 'for daily');
  const args = [...CHECK, '--bot', 'coder', '--session', 'daily'];

  await refusedWithNothingDone(box, bots, args, fromRestoredCodex(box, daily));
  assert.equal((await waiting(box, bots, 'coder', 'daily')).length, 1, 'daily\'s mail is still waiting');

  const marked = await box.run(args, { env: fromKitCodex(box, daily) });
  assert.equal(marked.code, 0, `${marked.stderr}${marked.stdout}`);
  assert.ok(marked.stdout.includes('for daily'), `got: ${marked.stdout}`);
});

test('R3 message check naming another Codex session, from a Codex tab without the mark, gives the reason, not "only in its own tab"', async (t) => {
  // The live case: review's `message check --bot coder --session review` ran
  // in the server daily's restored Codex started, so it carried daily's tab
  // and terminal, and was refused as mail read outside its own tab, which sent
  // the owner looking in the wrong place.
  const box = await createSandbox(t);
  const { bots, daily, review } = await fleet(box);
  await mailFor(box, 'review', 'for review');
  const args = [...CHECK, '--bot', 'coder', '--session', 'review'];

  await refusedWithNothingDone(box, bots, args, fromRestoredCodex(box, daily));
  assert.equal((await waiting(box, bots, 'coder', 'review')).length, 1, 'review\'s mail is still waiting');

  const own = await box.run(args, { env: fromKitCodex(box, review) });
  assert.equal(own.code, 0, `from review's own tab, launched by the kit, it reads: ${own.stderr}${own.stdout}`);
  assert.ok(own.stdout.includes('for review'), `got: ${own.stdout}`);
});

test('R3 message check naming nobody, from a Claude tab without the mark, reads that session\'s mail, as before', async (t) => {
  // A Claude session Orca brought back gets its mailbox back at its first
  // check in its own tab.
  const box = await createSandbox(t);
  const { bots, writer } = await fleet(box);
  const sent = await box.run([
    'message', 'send', '--bots', 'bots', '--to', 'writer', '--from', 'coder/daily',
    '--subject', 'for writer', '--text', 'The docs build is red.',
  ]);
  assert.equal(sent.code, 0, `the premise: mail for writer: ${sent.stderr}${sent.stdout}`);

  const result = await box.run(CHECK, { env: fromRestoredClaude(box, writer) });

  assert.equal(result.code, 0, `${result.stderr}${result.stdout}`);
  assert.ok(result.stdout.includes('for writer'), `got: ${result.stdout}`);
  assert.deepEqual(await waiting(box, bots, 'writer', 'daily'), []);
});

// ---------------------------------------------------------------------------
// temp make, temp retire
// ---------------------------------------------------------------------------

const MAKE = ['temp', 'make', '--bots', 'bots', '--name', 'scout', '--prompt', 'Read the open pull request.'];
const RETIRE = ['temp', 'retire', '--bots', 'bots', '--name', 'scout'];

/** The names bot.yaml gives one bot's sessions. */
const sessionsOf = async (bots, bot) => {
  const doc = parse(await readFile(path.join(botHomeOf(bots, bot), 'bot.yaml'), 'utf8'));
  return (doc.sessions ?? []).map((one) => one?.name).sort();
};

test('R4 temp make, from a Codex tab without the mark, is refused with the reason and makes nothing; with the mark it makes one for that session', async (t) => {
  // Live, it would have made a temporary session for the other session.
  const box = await createSandbox(t);
  const { bots, daily } = await fleet(box);

  await refusedWithNothingDone(box, bots, MAKE, fromRestoredCodex(box, daily));

  const marked = await box.run(MAKE, { env: fromKitCodex(box, daily) });
  assert.equal(marked.code, 0, `${marked.stderr}${marked.stdout}`);
  assert.deepEqual(await sessionsOf(bots, 'coder'), ['daily', 'review', 'scout']);
  assert.equal((await sessionIn(bots, 'coder', 'scout'))?.temporary?.maker, 'daily', 'made by the session whose tab it is');
});

test('R4 temp make, from a Claude tab without the mark, makes one for that session, as before', async (t) => {
  const box = await createSandbox(t);
  const { bots, writer } = await fleet(box);

  const result = await box.run(MAKE, { env: fromRestoredClaude(box, writer) });

  assert.equal(result.code, 0, `${result.stderr}${result.stdout}`);
  assert.deepEqual(await sessionsOf(bots, 'writer'), ['daily', 'scout']);
  assert.equal((await sessionIn(bots, 'writer', 'scout'))?.temporary?.maker, 'daily');
});

test('R5 temp retire, from a Codex tab without the mark, is refused with the reason and retires nothing; with the mark it retires what that session made', async (t) => {
  const box = await createSandbox(t);
  const { bots, daily } = await fleet(box);
  const made = await box.run(MAKE, { env: fromKitCodex(box, daily) });
  assert.equal(made.code, 0, `the premise: daily made scout: ${made.stderr}${made.stdout}`);

  await refusedWithNothingDone(box, bots, RETIRE, fromRestoredCodex(box, daily));
  assert.deepEqual(await sessionsOf(bots, 'coder'), ['daily', 'review', 'scout'], 'scout is still there');

  const marked = await box.run(RETIRE, { env: fromKitCodex(box, daily) });
  assert.equal(marked.code, 0, `${marked.stderr}${marked.stdout}`);
  assert.deepEqual(await sessionsOf(bots, 'coder'), ['daily', 'review']);
});

// ---------------------------------------------------------------------------
// A caller that cannot reach Orca at all
// ---------------------------------------------------------------------------

/**
 * Orca as a command inside a Codex sandbox with no network access sees it:
 * `orca status` answers not ok, in Orca's words as the kit printed them in the
 * live run of 2026-09-27. A Codex brought back by itself has none of the kit's
 * `-c sandbox_workspace_write.network_access=true`, so this is where its
 * commands run. The error code is the fake's own.
 */
const SANDBOX_BLOCKED = {
  status: { id: 'x', ok: false, error: { code: 'runtime_unavailable', message: 'The Codex sandbox blocked this command from connecting to Orca (EPERM)' } },
};

/** What "Orca is not ready" looks like, loosely, whoever says it. */
const ORCA_NOT_READY = /not ready|blocked this command from connecting to Orca/i;

for (const [label, args, makeFirst] of [
  ['message send with no --from', SEND, false],
  ['message check naming nobody', CHECK, false],
  ['temp make', MAKE, false],
  ['temp retire', RETIRE, true],
]) {
  test(`R6 ${label}, from a Codex tab without the mark that cannot reach Orca, gives the #408 reason, not "Orca is not ready"; the marked caller there is told Orca is not ready`, async (t) => {
    // Seen live: the kit asked Orca first, and the Codex brought back was told
    // Orca was not ready, which sends its user to the wrong fix.
    const box = await createSandbox(t);
    const { bots, daily } = await fleet(box);
    if (makeFirst) {
      const made = await box.run(MAKE, { env: fromKitCodex(box, daily) });
      assert.equal(made.code, 0, `the premise: daily made scout while Orca could be reached: ${made.stderr}${made.stdout}`);
    }
    await box.orca.set(SANDBOX_BLOCKED);

    const refused = await refusedWithNothingDone(box, bots, args, fromRestoredCodex(box, daily));
    const said = flat(`${refused.stdout}\n${refused.stderr}`);
    assert.doesNotMatch(said, ORCA_NOT_READY, `the reason is the caller, not Orca, got: ${said}`);

    // The contrast, in the same sandbox: the Codex the kit started is not in
    // doubt, and is told what stops it.
    const marked = await box.run(args, { env: fromKitCodex(box, daily) });
    const told = flat(`${marked.stdout}\n${marked.stderr}`);
    assert.notEqual(marked.code, 0, `the premise: Orca cannot be reached from here, got exit 0: ${told}`);
    assert.match(told, ORCA_NOT_READY, `the marked caller is told Orca is not ready, got: ${told}`);
    assert.doesNotMatch(told, SHARED_SERVER, `and not the #408 reason, got: ${told}`);
  });
}
