// One mailbox step at a time for one session (issue #321, from the reviews of
// PR #320).
//
// A session's mailbox is made or bound by `obk session mailbox`, the step its
// launch line starts with, run in the session's own tab (#317). Two such steps
// for one session can overlap: two runs of `up` at once each open a tab and
// type the line, or the book moves to a new tab while the old tab's step is
// still asking Orca. Free to interleave, they make two Runs, or one binds the
// Run while the other's bind lands after it and takes it back, and the book
// then names one tab while its Run is bound to another.
//
// The design (#321): `session mailbox` for one session runs one at a time,
// under a per-session lock of the kit's own, held for the whole step: read the
// book, check it names this tab, make or bind, write. A second step waits for
// the first, then reads the book afresh.
//
// What these tests pin is the outcome, not the lock: the number of Runs, that
// the Run ends up bound to the tab the book names, and how each step exits.
// Each arranges the overlap through the fake Orca rather than hoping for it:
// in the middle of one step's Orca call, a second step is started as another
// tab's shell would start it, without anybody waiting for it.

import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  bookOf,
  botHomeOf,
  createSandbox,
  orcaCallsOf,
  sessionIn,
  sh,
  shellWord,
} from './helpers/cli.js';

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


/** A bots folder made from inside `terminal`: `init` brings Bot Father up. */
async function initIn(box, terminal) {
  await obkIn(box, terminal, ['init', '--bots', 'bots', '--harness', 'claude']);
  return box.path('bots');
}

/** A bot and its sessions in the book, none of them brought up yet. */
async function addBot(box, terminal, bot, harness, sessions = [['daily']]) {
  await obkIn(box, terminal, ['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness]);
  for (const [session, ...settings] of sessions) {
    await obkIn(box, terminal, ['session', 'add', '--bots', 'bots', '--bot', bot, '--name', session, ...settings]);
  }
}


/** The fake Orca's terminal for one session's tab, as the book names it. */
async function tabOf(box, bots, bot, session = 'daily') {
  const { tab } = await sessionIn(bots, bot, session);
  const terminal = (await box.orca.terminals()).find((entry) => entry.tabId === tab);
  assert.ok(terminal !== undefined, `the book says ${bot}/${session} lives in ${tab}, and Orca has no such tab`);
  return terminal;
}

/** Orca's record of the Run that is one session's mailbox. */
async function mailboxOf(box, bots, bot, session = 'daily') {
  const { mailbox } = await sessionIn(bots, bot, session);
  assert.ok(typeof mailbox === 'string' && mailbox !== '', `${bot}/${session} should have a mailbox, got: ${mailbox}`);
  const run = (await box.orca.runs()).find((entry) => entry.id === mailbox);
  assert.ok(run !== undefined, `the book names ${mailbox} for ${bot}/${session}, and Orca never made it`);
  return run;
}


/** Assert one session's mailbox is coordinated by that session's own tab. */
async function assertBoundToItsOwnTab(box, bots, bot, session = 'daily') {
  const run = await mailboxOf(box, bots, bot, session);
  const own = await tabOf(box, bots, bot, session);
  assert.equal(
    run.coordinator_handle,
    own.handle,
    `${bot}/${session}'s mailbox ${run.id} should be bound to its own tab ${own.handle} (${own.title}), got ${run.coordinator_handle}`,
  );
}


/** `obk session mailbox` for coder/daily. */
const MAILBOX = ['session', 'mailbox', '--bots', 'bots', '--bot', 'coder', '--session', 'daily'];

/** coder brought up from a plain shell, its step held: a tab, and no mailbox yet. */
async function coderWithNoMailbox(box) {
  const bots = await initIn(box, null);
  await addBot(box, null, 'coder', 'codex');
  await box.orca.set({ holdSteps: true });
  await obkIn(box, null, ['up', '--bots', 'bots', '--bot', 'coder']);
  assert.equal(
    (await sessionIn(bots, 'coder', 'daily')).mailbox,
    undefined,
    'up should leave the mailbox to the step in the tab, and the step has not run yet',
  );
  return { bots, coder: await tabOf(box, bots, 'coder') };
}

/** coder brought up from a plain shell, its step run in its tab: a tab, and a mailbox bound there. */
async function coderWithMailbox(box) {
  const bots = await initIn(box, null);
  await addBot(box, null, 'coder', 'codex');
  await obkIn(box, null, ['up', '--bots', 'bots', '--bot', 'coder']);
  const coder = await tabOf(box, bots, 'coder');
  const { mailbox } = await sessionIn(bots, 'coder', 'daily');
  assert.ok(typeof mailbox === 'string', `coder's step should have given it a mailbox, got: ${mailbox}`);
  return { bots, coder, mailbox };
}


test('#321: two session mailbox runs at once in the session\'s tab make one Run between them, bound to that tab', async (t) => {
  // One step at a time for one session. A second step started while the first
  // is asking Orca for a Run waits for it, then finds that Run in the book and
  // binds it, rather than making a second one: a Run cannot be deleted, and
  // two steps each with a Run of their own are a session with a mailbox that
  // nobody reads. (Without the lock, both make one and the book keeps the
  // first written: mailbox-attestation.test.js holds #320 to that.)
  //
  // The overlap is arranged rather than hoped for: in the middle of the first
  // step's `run-create`, the fake starts the second without waiting for it.
  const box = await createSandbox(t);
  const { bots, coder } = await coderWithNoMailbox(box);
  const runsBefore = (await box.orca.runs()).length;
  const other = await otherStepDuring(box, bots, 'orchestration run-create', { in: coder });

  const first = await obkFrom(box, coder, MAILBOX);
  const second = await other.finished();

  assert.equal(first.code, 0, `the first step works: ${first.stdout}${first.stderr}`);
  assert.equal(second.code, 0, `and so does the second, once it has its turn: ${second.output}`);
  assert.equal((await box.orca.runs()).length, runsBefore + 1, 'one Run between them');
  await assertBoundToItsOwnTab(box, bots, 'coder');
});


/** A second tab in a bot's Orca project, as a second `up` at the same moment opens one: nothing typed into it yet. */
async function anotherTab(box, bots, bot) {
  const made = await sh(
    `${shellWord(box.orca.cli)} terminal create --worktree ${shellWord(`path:${botHomeOf(bots, bot)}`)} --title 'Coder daily' --json`,
    { cwd: box.cwd, env: box.env },
  );
  assert.equal(made.code, 0, `the fake should have made the tab: ${made.stdout}${made.stderr}`);
  return JSON.parse(made.stdout).result.terminal;
}

/**
 * A shell command that moves coder/daily's tab in the book from one tab id to
 * another, the way another run of `up` writes the tab it has just opened. It
 * fails if the book did not name `from`, so a test cannot pass on a move that
 * never happened.
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
 * Arrange a second `session mailbox` for coder/daily, run as the tab `in`, to
 * start in the middle of the next `command` call the first step makes: after
 * the book is moved, when `move` gives a shell command for that.
 *
 * The fake's `runDuring` runs its child to the end before it answers, and a
 * second step that waited for the first there would wait for ever, the first
 * being stuck in the very call it is waiting on. So the child starts the
 * second step without waiting for it, as another tab's shell does, and lets
 * the first step's call be answered when the second has finished or two
 * seconds have passed, whichever is first. Two seconds is long enough for a
 * step nothing holds back to do all its work in the middle of the first, which
 * is the race these tests are about, and well short of the ten seconds a step
 * waits for its turn.
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
      const until = Date.now() + 30_000;
      for (;;) {
        try {
          const code = Number((await readFile(status, 'utf8')).trim());
          return { code, output: await readFile(out, 'utf8') };
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        if (Date.now() > until) assert.fail('the second step never finished');
        await new Promise((resolve) => { setTimeout(resolve, 100); });
      }
    },
  };
}

/** A step that did not work said why, plainly: a non-zero exit, and no crash. */
const workedOrSaidWhy = (result) => result.code === 0 || !/^\s+at /m.test(result.output ?? `${result.stdout}${result.stderr}`);

test('#321: when the book moves to another tab while a tab is making the mailbox, one Run is made, and it ends up bound to the tab the book names', async (t) => {
  // The review's first reproduction. Tab A's step finds the book naming A and
  // no mailbox, and asks Orca for a Run. Meanwhile another run of `up` writes
  // its own tab B into the book, and B's step starts. Whatever order the two
  // steps then take, one Run is made for the session, and it is bound to B,
  // the tab the book names. A either made the Run that B then binds, or was
  // turned away; B's step, in the tab the book names, works.
  const box = await createSandbox(t);
  const { bots, coder: a } = await coderWithNoMailbox(box);
  const b = await anotherTab(box, bots, 'coder');
  const runsBefore = (await box.orca.runs()).length;
  const other = await otherStepDuring(box, bots, 'orchestration run-create', { in: b, move: moveTab(bots, a.tabId, b.tabId) });

  const first = await obkFrom(box, a, MAILBOX);
  const second = await other.finished();

  assert.equal(second.code, 0, `B's step, in the tab the book names, works: ${second.output}`);
  assert.ok(workedOrSaidWhy(first), `A's step worked, or said plainly why not: ${first.stdout}${first.stderr}`);
  const daily = await sessionIn(bots, 'coder', 'daily');
  assert.equal(daily.tab, b.tabId, 'the book names B, as the other run left it');
  assert.equal((await box.orca.runs()).length, runsBefore + 1, 'one Run for the session');
  await assertBoundToItsOwnTab(box, bots, 'coder');
});

test('#321: when the book moves to another tab while a tab is binding the mailbox, it ends up bound to the tab the book names', async (t) => {
  // The review's second reproduction. The book holds coder's Run. Tab A's
  // step starts binding it; the book moves to B and B's step starts. With the
  // two steps free to interleave, B could bind the Run and A's bind then land
  // and take it back. One at a time, the last to bind is the tab the book
  // names, and no second Run is made.
  const box = await createSandbox(t);
  const { bots, coder: a, mailbox } = await coderWithMailbox(box);
  const b = await anotherTab(box, bots, 'coder');
  const runsBefore = (await box.orca.runs()).length;
  const other = await otherStepDuring(box, bots, 'orchestration run-use', { in: b, move: moveTab(bots, a.tabId, b.tabId) });

  const first = await obkFrom(box, a, MAILBOX);
  const second = await other.finished();

  assert.equal(second.code, 0, `B's step, in the tab the book names, works: ${second.output}`);
  assert.ok(workedOrSaidWhy(first), `A's step worked, or said plainly why not: ${first.stdout}${first.stderr}`);
  const daily = await sessionIn(bots, 'coder', 'daily');
  assert.equal(daily.tab, b.tabId, 'the book names B');
  assert.equal(daily.mailbox, mailbox, 'and still holds the same mailbox');
  assert.equal((await box.orca.runs()).length, runsBefore, 'no Run is made');
  await assertBoundToItsOwnTab(box, bots, 'coder');
});
