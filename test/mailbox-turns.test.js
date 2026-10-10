// A session's mailbox steps and checks take turns (issue #321, from the review
// of PR #320).
//
// A session's mailbox is an Orca Run, bound to one terminal: the only one Orca
// tells about the Run's mail and the only one that may read it. Two things bind
// it, both from inside the session's own tab: the `obk session mailbox` step a
// launch line starts with (#317), and `obk message check`, which binds, reads
// and acks. Starting one session twice at the same moment (two `up`, `restart`
// or `unpause` runs racing) gives it two tabs, A and then B, with the book
// ending up naming B. review-317 reproduced three ways A's work lands after B's:
//
//   1. make: A's step is making the Run while the book moves to B and B's step
//      runs;
//   2. bind-only: A's step's `run-use` is in flight while the book moves to B
//      and B's step binds;
//   3. check: A's `message check` has read the book (naming A) and is binding,
//      reading and acking while the book moves to B.
//
// Each leaves the Run bound to A, or mail acked in A and lost to B.
//
// What the kit does about it (#321), and what these tests hold it to:
//
//   - For one session, steps and checks take turns. One that starts while
//     another is going waits for it, then reads the book afresh. Different
//     sessions do not wait for each other.
//   - `up`, `restart`, `unpause` and `init` wait for that turn before writing a
//     new tab for the session into the book, so the book never moves under a
//     step or a check.
//   - Hooks never wait on it.
//   - The turn is waited for at most sixty seconds. A step that does not get
//     it fails, touches nothing and says where the mailbox was left, and the
//     harness after it still starts. A check that does not get it reads
//     nothing and says the mail is still waiting. An `up` that does not get it
//     still writes its tab and types the launch line.
//   - Each Orca call made during a turn is given twenty seconds, the check's
//     included.
//
// What is pinned is the outcome: which tab the Run is bound to, how many Runs
// there are, whose acks happened when, and how each command ends. The turn
// itself is a lock the kernel holds for the process, in
// `<bots>.locks/<bot>/<bot>.<session>.mailbox.lock` beside the book's own (#534). It is held
// directly only where holding it is the only way to make something wait.
//
// Each overlap is arranged through the fake Orca rather than hoped for. Nothing
// here signals or kills a process. Everything these tests start ends by itself,
// and every wait has a limit.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { parse } from 'yaml';

import {
  botHomeOf,
  bookOf,
  createSandbox,
  fakeProgram,
  launchLineEnv,
  orcaCallsOf,
  orcaFlag,
  recordSession,
  sessionIn,
  sh,
  shellWord,
  turnLockFile,
} from './helpers/cli.js';

// ---------------------------------------------------------------------------
// Running the kit as a tab, and reading what it left
// ---------------------------------------------------------------------------

/** The environment of a command run inside `terminal`, as Orca sets it in every pane. */
const inTab = (box, terminal) => ({ ...box.env, ORCA_TERMINAL_HANDLE: terminal.handle, ORCA_TAB_ID: terminal.tabId });

/** Run `obk <args>` inside `terminal`, or from a plain shell outside Orca when it is null. */
const obkFrom = (box, terminal, args) => box.run(args, terminal === null ? {} : { env: inTab(box, terminal) });

/** The same, and insist it worked. */
async function obkIn(box, terminal, args) {
  const result = await obkFrom(box, terminal, args);
  assert.equal(result.code, 0, `obk ${args.join(' ')} should have worked${terminal === null ? '' : ` in ${terminal.title}`}:\n${result.stdout}${result.stderr}`);
  return result;
}

/** A bots folder made from a plain shell: `init` brings Bot Father up. */
async function initBots(box) {
  await obkIn(box, null, ['init', '--bots', 'bots', '--harness', 'claude']);
  return box.path('bots');
}

/** A bot and its sessions in the book, none of them brought up yet. */
async function addBot(box, bot, harness, sessions = ['daily']) {
  await obkIn(box, null, ['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness]);
  for (const session of sessions) {
    await obkIn(box, null, ['session', 'add', '--bots', 'bots', '--bot', bot, '--name', session]);
  }
}

/** The fake Orca's terminal for one session's tab, as the book names it. */
async function tabOf(box, bots, bot, session = 'daily') {
  const { tab } = await sessionIn(bots, bot, session);
  const terminal = (await box.orca.terminals()).find((entry) => entry.tabId === tab);
  assert.ok(terminal !== undefined, `the book says ${bot}/${session} lives in ${tab}, and Orca has no such tab`);
  return terminal;
}

/** Orca's record of one Run. */
async function runNamed(box, id) {
  const run = (await box.orca.runs()).find((entry) => entry.id === id);
  assert.ok(run !== undefined, `Orca has no Run ${id}`);
  return run;
}

/** Assert one session's mailbox is coordinated by the tab the book names for it now. */
async function assertBoundToTheBooksTab(box, bots, bot = 'coder', session = 'daily') {
  const { mailbox } = await sessionIn(bots, bot, session);
  assert.ok(typeof mailbox === 'string' && mailbox !== '', `${bot}/${session} should have a mailbox, got: ${mailbox}`);
  const run = await runNamed(box, mailbox);
  const own = await tabOf(box, bots, bot, session);
  assert.equal(
    run.coordinator_handle,
    own.handle,
    `${bot}/${session}'s mailbox ${run.id} should be bound to the tab the book names, ${own.handle}, got ${run.coordinator_handle}`,
  );
  return { run, own };
}

/** Say what Orca the kit's Run was bound to, as a test sets it up. */
async function setCoordinator(box, mailbox, handle) {
  const state = await box.orca.state();
  await box.orca.set({ runs: state.runs.map((run) => (run.id === mailbox ? { ...run, coordinator_handle: handle } : run)) });
}

/** Take a session's tab away, as a user closing it does: the Run is left naming the tab that is gone. */
async function closeTab(box, terminal) {
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((entry) => entry.handle !== terminal.handle) });
}

/** Mail from Bot Father's session to coder/daily, sent from a plain shell. */
const mail = (box, subject) => obkIn(box, null, [
  'message', 'send', '--bots', 'bots', '--to', 'coder', '--from', 'bot-father/daily',
  '--subject', subject, '--text', 'Please look at the staging host.',
]);

/** How the calls look in a failure message: who asked, and what. */
const shown = (calls) => JSON.stringify(calls.map((call) => `${call.caller ?? 'a plain shell'}: ${call.args.join(' ')}`));

/** The calls that make or bind a Run. */
const runCalls = (calls) => calls.filter((call) => ['orchestration run-create', 'orchestration run-use'].includes(call.args.slice(0, 2).join(' ')));

/** A failure a caller can act on: a non-zero exit, something said, no crash, and the names asked about. */
function assertFailedPlainly(said, code, ...named) {
  assert.ok(code !== 0 && code !== null, `this should have failed, got exit ${code}:\n${said}`);
  assert.notEqual(said.trim(), '', 'a failure with nothing said is no use to anybody');
  assert.ok(!/^\s+at /m.test(said), `expected a message, got a crash:\n${said}`);
  for (const word of named) assert.ok(said.includes(word), `it should name ${word}, got:\n${said}`);
}

/** Wait until `check` says yes, and fail saying `what` if it has not after `ms`. */
async function until(what, check, ms = 30_000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) assert.fail(what);
    await new Promise((resolve) => { setTimeout(resolve, 50); });
  }
}

/** `obk session mailbox` for one session of coder. */
const mailboxStep = (session = 'daily') => ['session', 'mailbox', '--bots', 'bots', '--bot', 'coder', '--session', session];

/** `obk message check` for coder/daily. */
const CHECK = ['message', 'check', '--bots', 'bots', '--bot', 'coder', '--session', 'daily'];

/**
 * CHECK as coder's harness runs it in `terminal`: in that tab, with what the
 * kit's launch line gives the harness it starts (#408). Every check here is
 * that harness's, in a tab the kit launched.
 */
const checkFrom = (box, terminal) => box.run(CHECK, { env: { ...inTab(box, terminal), ...launchLineEnv(box) } });

/** The same, and insist it worked. */
async function checkIn(box, terminal) {
  const result = await checkFrom(box, terminal);
  assert.equal(result.code, 0, `obk ${CHECK.join(' ')} should have worked in ${terminal.title}:\n${result.stdout}${result.stderr}`);
  return result;
}

// ---------------------------------------------------------------------------
// Where coder starts from
// ---------------------------------------------------------------------------

/** coder brought up from a plain shell, its step run in its tab: a tab, and a mailbox bound there. */
async function coderWithMailbox(box, sessions = ['daily']) {
  const bots = await initBots(box);
  await addBot(box, 'coder', 'codex', sessions);
  await obkIn(box, null, ['up', '--bots', 'bots', '--bot', 'coder']);
  const coder = await tabOf(box, bots, 'coder');
  const { mailbox } = await sessionIn(bots, 'coder', 'daily');
  assert.ok(typeof mailbox === 'string', `coder's step should have given it a mailbox, got: ${mailbox}`);
  return { bots, coder, mailbox };
}

/** coder with a mailbox, and its tab since closed: the next `up` opens a new one. */
async function coderClosedWithMailbox(box) {
  const { bots, coder, mailbox } = await coderWithMailbox(box);
  await closeTab(box, coder);
  return { bots, old: coder, mailbox };
}

// ---------------------------------------------------------------------------
// A second step, started in the middle of the first (review-317's sequences)
// ---------------------------------------------------------------------------

/** A second tab in coder's Orca project, as a second `up` at the same moment opens one: nothing typed into it yet. */
async function anotherTab(box, bots) {
  const made = await sh(
    `${shellWord(box.orca.cli)} terminal create --worktree ${shellWord(`path:${botHomeOf(bots, 'coder')}`)} --title 'Coder daily' --json`,
    { cwd: box.cwd, env: box.env },
  );
  assert.equal(made.code, 0, `the fake should have made the tab: ${made.stdout}${made.stderr}`);
  return JSON.parse(made.stdout).result.terminal;
}

/**
 * A shell command that moves coder/daily's tab in the book from one tab id to
 * another. It fails if the book did not name `from`, so a test cannot pass on a
 * move that never happened. It stands for the book having moved, by whatever
 * means: it takes no turn of any kind.
 */
function moveTab(bots, from, to) {
  return [process.execPath, '-e', [
    "const fs = require('fs');",
    `const file = ${JSON.stringify(bookOf(bots, 'coder'))};`,
    "const was = fs.readFileSync(file, 'utf8');",
    `const now = was.replace(${JSON.stringify(`tab: ${from}\n`)}, ${JSON.stringify(`tab: ${to}\n`)});`,
    'if (now === was) process.exit(3);',
    'fs.writeFileSync(file, now);',
  ].join(' ')].map(shellWord).join(' ');
}

/**
 * Start a second `session mailbox` for coder/daily, run as the tab `in`, in the
 * middle of the next `command` call the first step makes, after the book is
 * moved when `move` gives a shell command for that.
 *
 * The fake's `runDuring` runs its child to the end before it answers, and a
 * second step that waited for the first there would wait for ever, the first
 * being stuck in the very call it is waiting on. So the child starts the second
 * step without waiting for it, as another tab's shell does. It lets the first
 * step's call be answered when the second has finished or two seconds have
 * passed, whichever is first. Two seconds is long enough for a step nothing
 * holds back to do all its work in the middle of the first, which is the race,
 * and well short of the sixty seconds a step waits for its turn.
 *
 * `finished()` waits for the second step to end and gives its exit code and
 * what it printed.
 */
async function otherStepDuring(box, bots, command, { in: terminal, move }) {
  const dir = path.join(box.root, 'other-step');
  await mkdir(dir, { recursive: true });
  const out = path.join(dir, 'out');
  const status = path.join(dir, 'status');
  const step = [box.cli, 'session', 'mailbox', '--bots', bots, '--bot', 'coder', '--session', 'daily'].map(shellWord).join(' ');
  const detached = `( ${step} > ${shellWord(out)} 2>&1; echo $? > ${shellWord(`${status}.part`)}; mv ${shellWord(`${status}.part`)} ${shellWord(status)} ) > /dev/null 2>&1 < /dev/null &`;
  const wait = `i=0; while [ ! -f ${shellWord(status)} ] && [ $i -lt 20 ]; do sleep 0.1; i=$((i+1)); done`;
  await box.orca.set({
    runDuring: {
      command,
      on: orcaCallsOf(await box.orca.calls(), command).length + 1,
      // The move on its own first: `a && b &` would put the whole list in the
      // background, and the shell running it would hold the fake's output open
      // until the second step ended, which is the wait this is here to avoid.
      argv: ['/bin/sh', '-c', `${move ?? ':'} || exit 3; ${detached} ${wait}`],
      env: { ORCA_TERMINAL_HANDLE: terminal.handle, ORCA_TAB_ID: terminal.tabId },
    },
  });

  return {
    async finished() {
      const ran = await box.orca.ranDuring();
      assert.equal(ran.length, 1, `the second step should have been started in the middle of the first, got: ${JSON.stringify(ran)}`);
      assert.equal(ran[0].status, 0, `and what started it should have worked: ${ran[0].stdout}${ran[0].stderr}`);
      let code;
      await until('the second step never finished', async () => {
        try {
          code = Number((await readFile(status, 'utf8')).trim());
          return true;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          return false;
        }
      }, 90_000);
      return { code, output: await readFile(out, 'utf8') };
    },
  };
}

/** A step that did not work said why, plainly: a non-zero exit, and no crash. */
const workedOrSaidWhy = (code, said) => code === 0 || !/^\s+at /m.test(said);

// Two steps at once in the session's own tab, and review-317's make path with
// the book moved by hand, are in mailbox-attestation.test.js, where #317 first
// pinned them.

test('#321 path 2 (bind-only): when the book moves to B while A\'s step is binding the mailbox, it ends up bound to B', async (t) => {
  // review-317's bind-only path. The book holds coder's Run. A's step starts
  // binding it; the book moves to B and B's step starts. Free to interleave, B
  // binds the Run and A's bind then lands and takes it back. Taking turns, B's
  // step waits for A's, then reads the book afresh, and its bind is the last.
  const box = await createSandbox(t);
  const { bots, coder: a, mailbox } = await coderWithMailbox(box);
  await setCoordinator(box, mailbox, null);
  const b = await anotherTab(box, bots);
  const runsBefore = (await box.orca.runs()).length;
  const other = await otherStepDuring(box, bots, 'orchestration run-use', { in: b, move: moveTab(bots, a.tabId, b.tabId) });

  const first = await obkFrom(box, a, mailboxStep());
  const second = await other.finished();

  assert.equal(second.code, 0, `B's step, in the tab the book names, works: ${second.output}`);
  assert.ok(workedOrSaidWhy(first.code, first.stdout + first.stderr), `A's step worked, or said plainly why not: ${first.stdout}${first.stderr}`);
  const daily = await sessionIn(bots, 'coder', 'daily');
  assert.equal(daily.tab, b.tabId, 'the book names B');
  assert.equal(daily.mailbox, mailbox, 'and still holds the same mailbox');
  assert.equal((await box.orca.runs()).length, runsBefore, 'no Run is made');
  await assertBoundToTheBooksTab(box, bots);
});

// ---------------------------------------------------------------------------
// Two runs of `up` racing: the book moves because a real `up` writes it
// ---------------------------------------------------------------------------

/**
 * A second `up` for coder, started now and held in the middle of its `terminal
 * create` until `go` is written. By then it has listed Orca's tabs and read
 * the book, and found no live tab for coder/daily, so once let go it opens tab
 * B and writes B into the book: the second of two runs of `up` started at the
 * same moment. `finished` is its result.
 *
 * Held by the fake's `runDuring` on that one call, whose child waits for `go`
 * for two minutes at most, so a test that never lets it go still ends.
 */
async function secondUpHeld(box) {
  const dir = path.join(box.root, 'second-up');
  await mkdir(dir, { recursive: true });
  const waiting = path.join(dir, 'waiting');
  const go = path.join(dir, 'go');
  await box.orca.set({
    runDuring: {
      command: 'terminal create',
      on: orcaCallsOf(await box.orca.calls(), 'terminal create').length + 1,
      argv: ['/bin/sh', '-c', `: > ${shellWord(waiting)}; i=0; while [ ! -f ${shellWord(go)} ] && [ $i -lt 1200 ]; do sleep 0.1; i=$((i+1)); done`],
    },
  });
  const finished = box.run(['up', '--bots', 'bots', '--bot', 'coder']);
  await until('the second up never reached its terminal create', () => existsSync(waiting));
  return { finished, go, letGo: () => writeFile(go, '') };
}

/**
 * Let the held `up` go in the middle of the next `command` call, and hold that
 * call until the `up`'s tab has had its step run, or five seconds have passed.
 * Nothing holding it back, the `up` writes B and B's step binds well inside
 * five seconds, all while the call is in flight: the race. Then, still inside
 * the call, the book is read, for `bookDuring` to say what it named then.
 * Returns the index of that call among the calls of `command`, to find who
 * made it afterwards.
 */
async function letGoDuring(box, bots, command, go) {
  const calls = orcaCallsOf(await box.orca.calls(), command).length;
  const steps = (await box.orca.steps()).length;
  // The fake gives its child its own OBK_FAKE_ORCA_DIR: steps.log is there.
  const stepsNow = '$(( $(cat "$OBK_FAKE_ORCA_DIR/steps.log" 2>/dev/null | wc -l) ))';
  await box.orca.set({
    runDuring: {
      command,
      on: calls + 1,
      argv: ['/bin/sh', '-c', `: > ${shellWord(go)}; i=0; while [ ${stepsNow} -le ${steps} ] && [ $i -lt 50 ]; do sleep 0.1; i=$((i+1)); done; cat ${shellWord(bookOf(bots, 'coder'))}`],
    },
  });
  return calls;
}

/**
 * Assert the held `up` really was let go in the middle of a `command` call, and
 * give the tab the book named for coder/daily at the end of that call.
 */
async function bookDuring(box, command) {
  const ran = (await box.orca.ranDuring()).filter((entry) => entry.command === command);
  assert.ok(
    ran.length === 1 && ran[0].status === 0,
    `the second up should have been let go in the middle of ${command}, got: ${JSON.stringify(await box.orca.ranDuring())}`,
  );
  return (parse(ran[0].stdout) ?? {}).sessions?.daily?.tab;
}

/** The tab id of the terminal with `handle`. */
const tabIdOf = async (box, handle) => (await box.orca.terminals()).find((entry) => entry.handle === handle)?.tabId;

/**
 * Watch coder/daily's book from now on, every few milliseconds, for the moment
 * it stops naming the tab `from`. `movedAt()` stops watching and gives how many
 * Orca calls had been logged when the move was first seen, or undefined when it
 * never was: each call from that index on began after the book had moved. The
 * slack left is the few milliseconds between the write and the read that saw
 * it, in which a call that began counts as before it.
 */
function watchTheBook(box, bots, from) {
  let at;
  let stop = false;
  const watching = (async () => {
    while (!stop) {
      const tab = await sessionIn(bots, 'coder', 'daily').then((entry) => entry?.tab, () => undefined);
      if (tab !== undefined && tab !== from) {
        at = (await box.orca.calls()).length;
        return;
      }
      await new Promise((resolve) => { setTimeout(resolve, 5); });
    }
  })();
  return {
    async movedAt() {
      stop = true;
      await watching;
      return at;
    },
  };
}

/** A's acks among the calls from `movedAt` on: acks begun once the book no longer named A. */
async function acksAfterTheMove(box, a, movedAt) {
  assert.ok(movedAt !== undefined, 'the book should have moved from A to B while it was watched');
  return orcaCallsOf((await box.orca.calls()).slice(movedAt), 'orchestration check')
    .filter((call) => call.caller === a.handle && orcaFlag(call, '--ack') !== undefined);
}

/**
 * The fake Orca's last `count` calls, one a line with the tab that made it, for
 * the message of a run of `up` that failed: which call it was on, and what the
 * other `up` was doing beside it (#438).
 */
async function callsTail(box, count = 30) {
  const calls = await box.orca.calls();
  const shown = calls.slice(-count).map((call) => `  ${call.caller ?? '(outside Orca)'}  ${call.args.join(' ')}`);
  return `the fake Orca's last ${shown.length} of ${calls.length} calls:\n${shown.join('\n')}`;
}

test('#321 path 1 (make), two ups at once: the book does not move under A\'s step, and the session ends with one Run, bound to the book\'s tab', async (t) => {
  // Two runs of `up` at the same moment, neither finding coder's tab. The first
  // opens A and A's step asks Orca for a Run; in the middle of that, the second
  // opens B and comes to write B into the book. It waits for A's step first, so
  // A's step works on the book it read and writes its Run down; then B is
  // written and B's step binds that same Run to B. Without the wait, B's step
  // runs inside A's and makes a Run of its own, and A's is left over.
  const box = await createSandbox(t);
  const bots = await initBots(box);
  await addBot(box, 'coder', 'codex');
  const runsBefore = (await box.orca.runs()).length;
  const second = await secondUpHeld(box);
  const hooked = await letGoDuring(box, bots, 'orchestration run-create', second.go);

  const first = await obkFrom(box, null, ['up', '--bots', 'bots', '--bot', 'coder']);
  await second.letGo();
  const later = await second.finished;

  assert.equal(first.code, 0, `the first up works: ${first.stdout}${first.stderr}\n${await callsTail(box)}`);
  assert.equal(later.code, 0, `and so does the second: ${later.stdout}${later.stderr}\n${await callsTail(box)}`);
  const then = await bookDuring(box, 'orchestration run-create');
  const a = orcaCallsOf(await box.orca.calls(), 'orchestration run-create')[hooked].caller;
  assert.equal(then, await tabIdOf(box, a), 'while A\'s step was asking Orca, the book still named A');
  const stepOfA = (await box.orca.steps()).find((step) => step.handle === a);
  assert.ok(stepOfA !== undefined, `A's step should have run, got: ${JSON.stringify(await box.orca.steps())}`);
  assert.equal(stepOfA.status, 0, `A's step works, the book never having moved under it: ${stepOfA.stdout}${stepOfA.stderr}`);
  assert.equal((await box.orca.runs()).length, runsBefore + 1, 'one Run for the session');
  await assertBoundToTheBooksTab(box, bots);
});

test('#321 path 2 (bind-only), two ups at once: the mailbox ends up bound to the tab the book names, and no Run is made', async (t) => {
  // coder's tab was closed, and two runs of `up` bring it back at the same
  // moment. The first opens A, and A's step binds the book's Run; in the middle
  // of that `run-use`, the second opens B and comes to write it. Without the
  // wait, B's step binds the Run and then A's bind lands and takes it back.
  const box = await createSandbox(t);
  const { bots, mailbox } = await coderClosedWithMailbox(box);
  const runsBefore = (await box.orca.runs()).length;
  const second = await secondUpHeld(box);
  const hooked = await letGoDuring(box, bots, 'orchestration run-use', second.go);

  const first = await obkFrom(box, null, ['up', '--bots', 'bots', '--bot', 'coder']);
  await second.letGo();
  const later = await second.finished;

  assert.equal(first.code, 0, `the first up works: ${first.stdout}${first.stderr}`);
  assert.equal(later.code, 0, `and so does the second: ${later.stdout}${later.stderr}`);
  const then = await bookDuring(box, 'orchestration run-use');
  const a = orcaCallsOf(await box.orca.calls(), 'orchestration run-use')[hooked].caller;
  assert.equal(then, await tabIdOf(box, a), 'while A\'s step was binding, the book still named A');
  assert.equal((await sessionIn(bots, 'coder', 'daily')).mailbox, mailbox, 'the book holds the mailbox it always had');
  assert.equal((await box.orca.runs()).length, runsBefore, 'and no Run is made');
  await assertBoundToTheBooksTab(box, bots);
});

test('#321 path 3 (check), two ups at once: A\'s message check acks nothing once the book names B, and the mailbox ends up bound to B', async (t) => {
  // coder's tab was closed with mail waiting, and two runs of `up` bring it back
  // at the same moment. The first opens A and is done; the second is still on
  // its way. A's harness runs `message check`, which binds the Run to A and
  // reads and acks; in the middle of its bind, the second `up` comes to write
  // B. Without the wait, B is written and B's step binds the Run, then A's bind
  // lands and takes it back, and A acks mail meant for B. With it, A's check
  // finishes on the book it read, and only then is B written and bound.
  const box = await createSandbox(t);
  const { bots, mailbox } = await coderClosedWithMailbox(box);
  await mail(box, 'the staging host');
  const second = await secondUpHeld(box);
  await obkIn(box, null, ['up', '--bots', 'bots', '--bot', 'coder']);
  const a = await tabOf(box, bots, 'coder');
  // Bound to nothing, so the check has a bind to make, the call it is caught in.
  await setCoordinator(box, mailbox, null);
  await letGoDuring(box, bots, 'orchestration run-use', second.go);
  const from = (await box.orca.calls()).length;
  const watch = watchTheBook(box, bots, a.tabId);

  await checkFrom(box, a);
  await second.letGo();
  const later = await second.finished;
  const movedAt = await watch.movedAt();

  assert.equal(later.code, 0, `the second up works: ${later.stdout}${later.stderr}`);
  assert.equal(await bookDuring(box, 'orchestration run-use'), a.tabId, 'while A\'s check was binding, the book still named A');
  const b = await tabOf(box, bots, 'coder');
  assert.notEqual(b.handle, a.handle, 'the book names the second up\'s tab, B');
  const lateAcks = await acksAfterTheMove(box, a, movedAt);
  assert.deepEqual(lateAcks, [], `A acks nothing once the book names B, got: ${shown((await box.orca.calls()).slice(from))}`);
  await assertBoundToTheBooksTab(box, bots);
});

// ---------------------------------------------------------------------------
// Who does not wait
// ---------------------------------------------------------------------------

/** The file a session's turn is taken on: beside the book's own lock, in `<bots>.locks/<bot>/` (#534). */
const turnFile = (bots, bot, session) => turnLockFile(bots, bot, session, 'mailbox');

/**
 * Take one session's turn from this test process, run `body`, and let the turn
 * go when `body` ends, or earlier when it calls the `release` it is given: a
 * SQLite write transaction on the turn's file, as the kit's own is. The only
 * way to have a turn held for as long as a test needs. Let go inside the test
 * itself, because the sandbox is removed before a `t.after` of the test's own
 * would run.
 */
async function withTurnHeld(bots, bot, session, body) {
  const file = turnFile(bots, bot, session);
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('BEGIN IMMEDIATE');
  let held = true;
  const release = () => {
    if (!held) return;
    held = false;
    db.exec('COMMIT');
    db.close();
  };
  try {
    return await body(release);
  } finally {
    release();
  }
}

/** Well short of the sixty seconds a turn is waited for, and long for anything that does not wait. */
const PROMPTLY_MS = 20_000;

test('#321: a session\'s hook writes its id while a step or check of that session holds its turn', async (t) => {
  // Hooks never wait on the turn: the id a hook brings is one nothing else in
  // the kit knows, and a harness does not sit waiting for a mailbox. What they
  // wait for is the book's own lock, which a turn does not hold.
  const box = await createSandbox(t);
  const { bots, coder } = await coderWithMailbox(box);
  const started = Date.now();
  const ran = await withTurnHeld(bots, 'coder', 'daily', () => recordSession(box, { bots, bot: 'coder', tab: coder.tabId, session: 'sess-1' }));
  const took = Date.now() - started;

  assert.equal(ran.code, 0, `the hook works: ${ran.stdout}${ran.stderr}`);
  assert.ok(took < PROMPTLY_MS, `without waiting for the turn, took ${took} ms`);
  assert.equal((await sessionIn(bots, 'coder', 'daily')).session, 'sess-1', 'and the id is in the book');
});

test('#321: one session\'s turn does not hold up another session\'s step', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await coderWithMailbox(box, ['daily', 'nightly']);
  const nightly = await tabOf(box, bots, 'coder', 'nightly');
  const { mailbox } = await sessionIn(bots, 'coder', 'nightly');
  await setCoordinator(box, mailbox, null);
  const started = Date.now();
  const ran = await withTurnHeld(bots, 'coder', 'daily', () => obkFrom(box, nightly, mailboxStep('nightly')));
  const took = Date.now() - started;

  assert.equal(ran.code, 0, `coder/nightly's step works: ${ran.stdout}${ran.stderr}`);
  assert.ok(took < PROMPTLY_MS, `without waiting for coder/daily's turn, took ${took} ms`);
  await assertBoundToTheBooksTab(box, bots, 'coder', 'nightly');
});

// ---------------------------------------------------------------------------
// One that waited for its turn acts on the book as it is once it has it
// ---------------------------------------------------------------------------

/**
 * Hold coder/daily's turn, start `command` while it is held, move the book from
 * A to B the way a writer holding the turn would, and then let the turn go.
 * Two seconds is ample for the command to have read the book once and be
 * waiting; one that is slower only reads the moved book the first time.
 */
async function startedWhileTheBookMoves(box, bots, a, b, command) {
  const from = (await box.orca.calls()).length;
  const ran = await withTurnHeld(bots, 'coder', 'daily', async (release) => {
    const pending = command();
    await new Promise((resolve) => { setTimeout(resolve, 2000); });
    const moved = await sh(moveTab(bots, a.tabId, b.tabId), { cwd: box.cwd, env: box.env });
    assert.equal(moved.code, 0, `the book should have named A, and been moved to B: ${moved.stderr}`);
    release();
    return pending;
  });
  return { ran, since: (await box.orca.calls()).slice(from) };
}

test('#321: a step that waited for its turn while the book moved to another tab makes and binds nothing, and says so', async (t) => {
  // It read the book naming its own tab before it had its turn. Once it has
  // it, the book names B, and what it read before is stale.
  const box = await createSandbox(t);
  const { bots, coder: a, mailbox } = await coderWithMailbox(box);
  await setCoordinator(box, mailbox, null);
  const b = await anotherTab(box, bots);

  const { ran, since } = await startedWhileTheBookMoves(box, bots, a, b, () => obkFrom(box, a, mailboxStep()));

  assertFailedPlainly(ran.stdout + ran.stderr, ran.code, 'coder/daily');
  assert.deepEqual(runCalls(since), [], `nothing is made or bound, got: ${shown(since)}`);
  assert.equal((await runNamed(box, mailbox)).coordinator_handle, null, 'the mailbox is where it was');
});

test('#321: a message check that waited for its turn while the book moved to another tab reads nothing, and the mail stays for B', async (t) => {
  const box = await createSandbox(t);
  const { bots, coder: a, mailbox } = await coderWithMailbox(box);
  await setCoordinator(box, mailbox, null);
  await mail(box, 'the staging host');
  const b = await anotherTab(box, bots);

  const { ran, since } = await startedWhileTheBookMoves(box, bots, a, b, () => checkFrom(box, a));

  const said = ran.stdout + ran.stderr;
  assert.ok(!/^\s+at /m.test(said), `a message, not a crash:\n${said}`);
  assert.ok(!said.includes('the staging host'), `nothing is read, got:\n${said}`);
  assert.match(said, /still waiting/i, `it says the mail is still waiting, got:\n${said}`);
  const asked = since.filter((call) => ['orchestration run-use', 'orchestration check'].includes(call.args.slice(0, 2).join(' ')));
  assert.deepEqual(asked, [], `no bind and no read was asked of Orca, got: ${shown(asked)}`);
  assert.deepEqual((await box.orca.messages()).map((message) => message.acked), [false], 'the mail is still waiting');
});

// ---------------------------------------------------------------------------
// Bounded waits: the harness always starts. These wait the minute out, side by
// side, each in a sandbox of its own.
// ---------------------------------------------------------------------------

/** The turn's limit, and some room past it for everything else a command does. */
const TURN_MS = 60_000;
const WAITED_MS = 50_000;
const GAVE_UP_BY_MS = 90_000;

/** Past this, a command that was to give up has not: fail the test rather than wait on it for ever. */
const STUCK_MS = 150_000;

/** How long the fake takes to answer a call meant never to be answered in time. */
const HANG_MS = 60_000;

/** The line typed into `terminal`, with the step's own exit code written out between its two halves. */
function lineWithStepExit(terminal) {
  const text = terminal.typed?.[0]?.text ?? '';
  const at = text.indexOf('; OBK_TAB_SHELL=');
  assert.ok(at > 0, `${terminal.title} should have had a launch line with a mailbox step typed into it, got: ${text}`);
  return { line: `${text.slice(0, at)}; echo "step exited $?" >&2${text.slice(at)}`, step: text.slice(0, at) };
}

test('#321: waits are bounded, so the harness always starts', { concurrency: true }, async (t) => {
  await Promise.all([
    t.test('a step that does not get its turn within a minute fails, touches nothing, says where the mailbox was left, and the harness starts', { timeout: STUCK_MS }, async (t) => {
      const box = await createSandbox(t);
      const { bots, coder, mailbox } = await coderWithMailbox(box);
      await setCoordinator(box, mailbox, null);
      const harness = await fakeProgram(box, 'codex', {});
      const { line } = lineWithStepExit(coder);
      const from = (await box.orca.calls()).length;

      const started = Date.now();
      const ran = await withTurnHeld(bots, 'coder', 'daily', () => sh(line, { cwd: box.cwd, env: inTab(box, coder) }));
      const took = Date.now() - started;

      const exited = /step exited (\d+)/.exec(ran.stderr)?.[1];
      assert.ok(exited !== undefined, `the step's exit should have been written out, got: ${ran.stderr}`);
      assertFailedPlainly(ran.stdout + ran.stderr, Number(exited), 'coder/daily', mailbox);
      assert.ok(took >= WAITED_MS, `having waited for the turn first, took ${took} ms`);
      assert.ok(took < GAVE_UP_BY_MS, `and given up after about ${TURN_MS} ms, took ${took} ms`);
      const made = runCalls((await box.orca.calls()).slice(from));
      assert.deepEqual(made, [], `it makes and binds nothing, got: ${shown(made)}`);
      assert.equal((await runNamed(box, mailbox)).coordinator_handle, null, 'the mailbox is where it was');
      assert.equal((await sessionIn(bots, 'coder', 'daily')).mailbox, mailbox, 'and the book still names it');
      assert.equal((await harness.calls()).length, 1, 'and then the harness starts');
    }),

    t.test('a message check that does not get its turn within a minute reads nothing and says the mail is still waiting', { timeout: STUCK_MS }, async (t) => {
      const box = await createSandbox(t);
      const { bots, coder } = await coderWithMailbox(box);
      await mail(box, 'the staging host');
      const from = (await box.orca.calls()).length;

      const started = Date.now();
      const ran = await withTurnHeld(bots, 'coder', 'daily', () => checkFrom(box, coder));
      const took = Date.now() - started;

      const said = ran.stdout + ran.stderr;
      assert.ok(took >= WAITED_MS, `having waited for the turn first, took ${took} ms`);
      assert.ok(took < GAVE_UP_BY_MS, `and given up after about ${TURN_MS} ms, took ${took} ms`);
      assert.ok(!/^\s+at /m.test(said), `a message, not a crash:\n${said}`);
      assert.ok(!said.includes('the staging host'), `nothing is read, got:\n${said}`);
      assert.match(said, /still waiting/i, `it says the mail is still waiting, got:\n${said}`);
      const asked = (await box.orca.calls()).slice(from)
        .filter((call) => ['orchestration run-use', 'orchestration check'].includes(call.args.slice(0, 2).join(' ')));
      assert.deepEqual(asked, [], `no bind and no read was asked of Orca, got: ${shown(asked)}`);
      assert.deepEqual((await box.orca.messages()).map((message) => message.acked), [false], 'the mail is still waiting');
    }),

    t.test('an up that does not get the turn within a minute still writes its tab and types the launch line, and that tab\'s step then binds the mailbox', { timeout: STUCK_MS }, async (t) => {
      const box = await createSandbox(t);
      const { bots, old, mailbox } = await coderClosedWithMailbox(box);
      await box.orca.set({ holdSteps: true });
      const started = Date.now();
      const ran = await withTurnHeld(bots, 'coder', 'daily', () => obkFrom(box, null, ['up', '--bots', 'bots', '--bot', 'coder']));
      const took = Date.now() - started;

      const said = ran.stdout + ran.stderr;
      assert.ok(!/^\s+at /m.test(said), `a message, not a crash:\n${said}`);
      assert.ok(took >= WAITED_MS, `having waited for the turn first, took ${took} ms`);
      assert.ok(took < GAVE_UP_BY_MS, `and gone on after about ${TURN_MS} ms, took ${took} ms`);
      const now = await tabOf(box, bots, 'coder');
      assert.notEqual(now.handle, old.handle, 'the book names the new tab');
      assert.equal((now.typed ?? []).length, 1, `and the launch line was typed into it, got: ${JSON.stringify(now.typed)}`);

      // The turn is free now: the step in the new tab deals with the mailbox.
      const { step } = lineWithStepExit(now);
      const stepRan = await sh(step, { cwd: box.cwd, env: inTab(box, now) });
      assert.equal(stepRan.code, 0, `the step in the new tab works once the turn is free: ${stepRan.stdout}${stepRan.stderr}`);
      assert.equal((await sessionIn(bots, 'coder', 'daily')).mailbox, mailbox, 'the book holds the mailbox it always had');
      await assertBoundToTheBooksTab(box, bots);
    }),

    t.test('a message check whose read Orca does not answer gives up within twenty seconds or so, and leaves the turn free', { timeout: STUCK_MS }, async (t) => {
      // Each Orca call made during a turn is given twenty seconds, the check's
      // as much as the step's: a check stuck on Orca would otherwise keep the
      // session's step, and so its harness, waiting.
      const box = await createSandbox(t);
      const { bots, coder, mailbox } = await coderWithMailbox(box);
      await mail(box, 'the staging host');
      await box.orca.set({ hang: { command: 'orchestration check', ms: HANG_MS } });

      const started = Date.now();
      const ran = await checkFrom(box, coder);
      const took = Date.now() - started;

      const said = ran.stdout + ran.stderr;
      assert.ok(took < 45_000, `it gave up on Orca rather than waiting a minute for it, took ${took} ms`);
      assert.ok(!/^\s+at /m.test(said), `a message, not a crash:\n${said}`);
      assert.ok(!said.includes('the staging host'), `nothing is read, got:\n${said}`);

      await setCoordinator(box, mailbox, null);
      const stepStarted = Date.now();
      const step = await obkFrom(box, coder, mailboxStep());
      const stepTook = Date.now() - stepStarted;
      assert.equal(step.code, 0, `the step after it works: ${step.stdout}${step.stderr}`);
      assert.ok(stepTook < PROMPTLY_MS, `without waiting on the check's turn, took ${stepTook} ms`);
      await assertBoundToTheBooksTab(box, bots);
    }),
  ]);
});

// ---------------------------------------------------------------------------
// A slow Orca never keeps a check past up's wait (review of PR #368)
//
// A check gives each Orca call twenty seconds, and makes one more call for each
// batch of mail it acks. With calls that are slow but each under that limit, a
// check with several batches waiting held the turn past the minute `up` waits
// for it: `up` then wrote B into the book, and A's next ack landed after it,
// mail acked from the stale tab. So a check holds the turn for forty seconds
// at most in all, each call given twenty or what is left of the forty,
// whichever is less, and lets go of the turn before `up` stops waiting,
// however slow Orca is. What it has acked it shows; what it has not stays.
// ---------------------------------------------------------------------------

/** How long each read and ack takes to answer here: slow, and under the twenty seconds a call is given. */
const SLOW_MS = 16_000;

/** Enough mail for four batches of fifty, Orca's most for one: a read and four acks at SLOW_MS is eighty seconds. */
const PILE = 200;

/** One message's subject, each one found in what a check prints only if that message was shown. */
const subjectOf = (n) => `pile mail ${String(n).padStart(3, '0')}`;

/** Queue `count` messages for a Run, in the words the fake keeps them in, oldest first. */
async function pileMail(box, mailbox, count) {
  const state = await box.orca.state();
  const pile = Array.from({ length: count }, (_, i) => ({
    id: `msg_pile_${i + 1}`,
    to: `run:${mailbox}`,
    from: null,
    subject: subjectOf(i + 1),
    body: 'Please look at the staging host.',
    type: 'status',
    priority: 'normal',
    threadId: null,
    at: '2026-09-21T12:00:00.000Z',
    acked: false,
  }));
  await box.orca.set({ messages: [...(state.messages ?? []), ...pile] });
}

/** A check that holds the turn this long or more has held it past what `up` can count on. */
const CHECK_LET_GO_BY_MS = 46_000;

/**
 * Assert a check says of a batch it showed that Orca did not answer whether it
 * took it as read, so the next check may show it again.
 */
function assertSaysUncertain(said) {
  assert.match(said, /\bnot answer/i, `it says Orca did not answer about that batch, got:\n${said}`);
  assert.match(said, /\bagain\b/i, `and that the next check may show it again, got:\n${said}`);
}

test('#321 review: slow Orca calls do not keep a message check past up\'s wait', { concurrency: true }, async (t) => {
  await Promise.all([
    t.test('a check whose every read and ack is slow lets go within about forty seconds, shows what it acked and the batch it gave up on, and leaves the rest waiting', { timeout: STUCK_MS }, async (t) => {
      // A read and an ack at sixteen seconds each leave eight of the forty for
      // the second ack, which runs past them: the kit gives up on that batch
      // without knowing whether Orca took it as read. So it is shown, and said
      // to be uncertain; the batches after it were never touched, and are not.
      const box = await createSandbox(t);
      const { coder, mailbox } = await coderWithMailbox(box);
      await pileMail(box, mailbox, PILE);
      await box.orca.set({ hang: { command: 'orchestration check', ms: SLOW_MS } });

      const started = Date.now();
      const ran = await checkFrom(box, coder);
      const took = Date.now() - started;

      const said = ran.stdout + ran.stderr;
      assert.ok(took < CHECK_LET_GO_BY_MS, `it stops within about forty seconds, took ${took} ms`);
      assertFailedPlainly(said, ran.code);
      const messages = await box.orca.messages();
      const ackedNotShown = messages.filter((message) => message.acked && !ran.stdout.includes(message.subject)).map((message) => message.subject);
      assert.deepEqual(ackedNotShown, [], 'mail it acked is shown: Orca will not hand it over again');
      // The batch whose ack it gave up on is the one Orca still has out.
      const outstanding = new Set(((await box.orca.state()).deliveries ?? [])
        .filter((delivery) => delivery.run === mailbox && !delivery.acknowledged)
        .flatMap((delivery) => delivery.messageIds));
      const uncertain = messages.filter((message) => outstanding.has(message.id));
      assert.equal(uncertain.length, 50, `one batch of fifty was out when it gave up, got: ${uncertain.length}`);
      const uncertainNotShown = uncertain.filter((message) => !ran.stdout.includes(message.subject)).map((message) => message.subject);
      assert.deepEqual(uncertainNotShown, [], 'the batch whose ack it gave up on is shown');
      assertSaysUncertain(said);
      const untouched = messages.filter((message) => !message.acked && !outstanding.has(message.id));
      assert.ok(untouched.length > 0, 'some of the pile was never handed over at all');
      const untouchedShown = untouched.filter((message) => ran.stdout.includes(message.subject)).map((message) => message.subject);
      assert.deepEqual(untouchedShown, [], 'a batch it never acked or received is not shown: the next check gets it');
    }),

    t.test('the review\'s case: while A\'s slow check has several batches to ack, a second up waits for it, A acks nothing once the book names B, and the rest of the mail is B\'s to read', { timeout: STUCK_MS }, async (t) => {
      // coder's tab was closed with a pile of mail waiting, and two runs of `up`
      // bring it back at the same moment. The first opens A and is done; the
      // second is on its way. A's harness runs `message check`, whose reads and
      // acks each take sixteen seconds. The second `up` comes to write B while
      // that check is going, and waits for it. A lets go of the turn in time,
      // so the book names B only once A has finished acking, and the mail A
      // did not get to is read in B.
      const box = await createSandbox(t);
      const { bots, mailbox } = await coderClosedWithMailbox(box);
      await pileMail(box, mailbox, PILE);
      const second = await secondUpHeld(box);
      await obkIn(box, null, ['up', '--bots', 'bots', '--bot', 'coder']);
      const a = await tabOf(box, bots, 'coder');
      await box.orca.set({ hang: { command: 'orchestration check', ms: SLOW_MS } });
      const from = (await box.orca.calls()).length;
      const watch = watchTheBook(box, bots, a.tabId);

      const checking = checkFrom(box, a);
      // Let the second up go once A's check is reading, so it holds the turn.
      await until('A\'s check never asked Orca for its mail', async () => orcaCallsOf((await box.orca.calls()).slice(from), 'orchestration check')
        .some((call) => call.caller === a.handle));
      await second.letGo();
      await checking;
      const later = await second.finished;
      const movedAt = await watch.movedAt();

      assert.equal(later.code, 0, `the second up works: ${later.stdout}${later.stderr}`);
      const b = await tabOf(box, bots, 'coder');
      assert.notEqual(b.handle, a.handle, 'the book names the second up\'s tab, B');
      const lateAcks = await acksAfterTheMove(box, a, movedAt);
      assert.deepEqual(lateAcks, [], `A acks nothing once the book names B, got: ${shown((await box.orca.calls()).slice(from))}`);
      const left = (await box.orca.messages()).filter((message) => !message.acked).map((message) => message.subject);
      assert.ok(left.length > 0, 'the mail A did not ack is still waiting');
      await assertBoundToTheBooksTab(box, bots);

      await box.orca.set({ hang: null });
      const readInB = await checkIn(box, b);
      const missed = left.filter((subject) => !readInB.stdout.includes(subject));
      assert.deepEqual(missed, [], 'and B reads every message of it');
      assert.deepEqual((await box.orca.messages()).filter((message) => !message.acked), [], 'so none is left waiting');
    }),
  ]);
});

// ---------------------------------------------------------------------------
// An ack Orca did not answer about (second review of PR #368)
//
// When the kit gives up waiting on an ack, Orca may have taken the batch as
// read all the same, and then it never hands that batch over again. So a check
// shows a batch whose ack it gave up on, with the batches acked before it, and
// says Orca did not answer whether it took these as read, so the next check
// may show them again. An ack Orca refused outright took nothing, and its batch
// is not shown: the next check gets it.
// ---------------------------------------------------------------------------

/** Orca's own refusal of an ack, the way the fake gives one. */
const ACK_REFUSED = 'the orchestration runtime is restarting; try again in a moment';

/** One batch of fifty and ten more: the second batch is only ever handed over by the first one's ack. */
const TWO_BATCHES = 60;

test('#321 review: a check whose ack Orca does not answer about', { concurrency: true }, async (t) => {
  await Promise.all([
    t.test('the review\'s case: the first ack is taken by Orca and answered too late, and the check shows that batch, says it is uncertain, and fails plainly', { timeout: STUCK_MS }, async (t) => {
      // Orca takes the first batch as read and then does not answer inside the
      // twenty seconds. Rethrowing the timeout would lose those fifty messages
      // to everyone: Orca will not hand them over again.
      const box = await createSandbox(t);
      const { coder, mailbox } = await coderWithMailbox(box);
      await pileMail(box, mailbox, TWO_BATCHES);
      // The read goes through as it always does. In the middle of the first
      // ack, before Orca carries it out, Orca is set to carry out what it is
      // asked and then say nothing for a minute: from that ack on.
      const checks = orcaCallsOf(await box.orca.calls(), 'orchestration check').length;
      const quiet = JSON.stringify({ command: 'orchestration check', ms: HANG_MS, applied: true });
      await box.orca.set({
        runDuring: {
          command: 'orchestration check',
          on: checks + 2,
          argv: [process.execPath, '-e', [
            "const fs = require('fs');",
            "const file = `${process.env.OBK_FAKE_ORCA_DIR}/state.json`;",
            "const state = JSON.parse(fs.readFileSync(file, 'utf8'));",
            `state.hang = ${quiet};`,
            'fs.writeFileSync(file, JSON.stringify(state, null, 2));',
          ].join(' ')],
        },
      });

      const started = Date.now();
      const ran = await checkFrom(box, coder);
      const took = Date.now() - started;

      const said = ran.stdout + ran.stderr;
      const messages = await box.orca.messages();
      const first = messages.slice(0, 50);
      const second = messages.slice(50);
      assert.ok(took < HANG_MS, `it gave up on the ack before Orca answered, took ${took} ms`);
      assert.deepEqual(first.filter((message) => !message.acked).map((message) => message.subject), [], 'Orca took the first batch as read, which is the case this test is about');
      assertFailedPlainly(said, ran.code);
      const firstNotShown = first.filter((message) => !ran.stdout.includes(message.subject)).map((message) => message.subject);
      assert.deepEqual(firstNotShown, [], 'the batch Orca took as read is shown');
      assertSaysUncertain(said);
      const secondShown = second.filter((message) => ran.stdout.includes(message.subject)).map((message) => message.subject);
      assert.deepEqual(secondShown, [], 'the batch after it, which never reached the kit, is not shown');
      assert.deepEqual(second.filter((message) => message.acked).map((message) => message.subject), [], 'and is still waiting');

      await box.orca.set({ hang: null, runDuring: null });
      const next = await checkIn(box, coder);
      const missed = second.filter((message) => !next.stdout.includes(message.subject)).map((message) => message.subject);
      assert.deepEqual(missed, [], 'the next check shows it');
    }),

    t.test('an ack Orca refuses outright on the first batch leaves the check showing nothing, failing in Orca\'s words, with all the mail still waiting', { timeout: STUCK_MS }, async (t) => {
      const box = await createSandbox(t);
      const { coder, mailbox } = await coderWithMailbox(box);
      await pileMail(box, mailbox, TWO_BATCHES);
      const checks = orcaCallsOf(await box.orca.calls(), 'orchestration check').length;
      // The read goes through; the ack after it is refused, once.
      await box.orca.set({ fail: { 'orchestration check': { code: 'runtime_error', message: ACK_REFUSED, after: checks + 1, times: 1 } } });

      const ran = await checkFrom(box, coder);

      const said = ran.stdout + ran.stderr;
      assertFailedPlainly(said, ran.code, ACK_REFUSED);
      const messages = await box.orca.messages();
      const shownAnyway = messages.filter((message) => ran.stdout.includes(message.subject)).map((message) => message.subject);
      assert.deepEqual(shownAnyway, [], 'nothing is shown: Orca took nothing as read, and hands it all over again');
      assert.deepEqual(messages.filter((message) => message.acked).map((message) => message.subject), [], 'all of it is still waiting');
    }),
  ]);
});
