// A system test: the mail nudge and a harness's own question, against the real
// Codex in the real Orca on this machine (#329). Run it alone with
// `npm run test:system -- --yes test/system/harness-question.test.js`;
// `npm test` cannot, and no CI machine could.
//
// What it is the live check for. Codex 0.156.1 drew its update offer just as a
// line was typed into its tab with a return; the return took the default,
// "Update now", and Codex updated the machine. Orca did not report that screen:
// `terminal wait --for tui-idle` answered ok and satisfied, with no
// `blockedReason`, and the kit's nudge trusted only that. So the kit now reads
// the screen itself before it types, and a harness's own question on it stops
// the nudge.
//
// An update offer cannot be brought up on demand, so this uses a harness
// question the test can bring up in its own tab: Codex's `/new` menu, "Where
// should the new conversation run?", which Orca reports the same way, no reason
// and the tab idle (seen on a screen recording, session-identity.test.js).
// With the menu up, `obk message send` to that session must answer that
// nothing was typed and why, and afterwards the menu must still be on screen
// with no trace of the nudge in it: nothing answered it. Then the test answers
// its own menu, and cleans up.
//
// The fake Orca cannot say any of this: whether the kit's look at a real
// screen sees a real menu, and whether a line it held back really stayed out
// of the tab.
//
// The machine it runs on is someone's working machine, with their own tabs
// open. So this test, like the others beside it:
//
//   - works in a throwaway bots folder under the system temp directory;
//   - writes down every terminal and workspace Orca already had, before it
//     creates anything;
//   - touches only what it created, matched by handle and by workspace path;
//   - types only into its own Codex tab, and answers only the menu it brought
//     up itself;
//   - closes its own tabs one by one (`--terminal <handle> --tab`) and then
//     deletes its own workspaces, whatever happened, and checks afterwards that
//     every terminal that was there before is still there.
//
// `orca terminal close --worktree … --all` is never run here, and the helper
// below refuses to run it at all.
//
// One thing it cannot clean up, as messaging.test.js says of itself: the Run
// mailboxes. Orca has no `run-delete`, so each run of this file leaves the Runs
// `up` made behind, named `obk <bot>/<session>`, holding the one message this
// test sent, for a bots folder that no longer exists.
//
// **It is attended.** A bot folder nobody has opened before asks questions
// before the harness is running in it, and this test answers none of them but
// its own menu: answering them is the caller's job and not the kit's (PRD 6.5).
// On this machine a first run asks Codex's folder trust (`1. Trust and
// continue`), Codex's `Hooks need review` (`2`, "Trust all and continue"), and
// perhaps an update offer, and Bot Father's Claude tab asks its folder trust,
// which nothing here waits on. Every wait says what the tab is showing when it
// runs out of patience, so a run left alone names the screen that stopped it.
//
// It takes a minute or two: one real harness, one start prompt, one menu.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';

import { cliEntry } from '../helpers/cli.js';
import { waitingOn } from '../helpers/screens.js';

/**
 * Remove the throwaway bots folder and everything the kit made beside it:
 * `<bots>.prompts`, where a session's start prompt goes, is a sibling of the
 * bots folder and not a child of it (PRD 6.3).
 */
async function removeBotsFolderAndSiblings(bots) {
  const parent = path.dirname(bots);
  const mine = path.basename(bots);
  const ours = async () => (await readdir(parent)).filter((name) => name === mine || name.startsWith(`${mine}.`));

  for (const name of await ours()) {
    await rm(path.join(parent, name), { recursive: true, force: true });
  }
  assert.deepEqual(await ours(), [], `this test left folders behind in ${parent}`);
}

/** The Orca CLI that works for a normal user (tech notes, section 1). */
const ORCA = process.env.OBK_ORCA || '/Applications/Orca.app/Contents/Resources/bin/orca';

/**
 * How long a tab is given to be ready for a line. A first run has screens on it
 * and a person answering them, so this waits rather than races.
 */
const READY_MS = 180000;

/**
 * How long the test watches the tab after the send before it says nothing
 * answered the menu. A line the kit had typed would be in the tab by the time
 * `obk` answered; this is for the screen to catch up with it.
 */
const SETTLE_MS = 5000;

/** Ask Orca something and read its JSON. Never the blanket close, on any road. */
function orca(args) {
  assert.ok(
    !(args.includes('--all') && args.includes('close')),
    `refusing to run \`orca ${args.join(' ')}\`: it would take away someone else's tabs`,
  );
  const done = spawnSync(ORCA, [...args, '--json'], { encoding: 'utf8' });
  assert.equal(done.error, undefined, `could not run ${ORCA}: ${done.error?.message}`);
  let answer;
  try {
    answer = JSON.parse(done.stdout);
  } catch {
    assert.fail(`orca ${args.join(' ')} did not answer JSON: ${done.stdout}${done.stderr}`);
  }
  return answer;
}

/** Every terminal Orca knows about right now. */
function allTerminals() {
  const answer = orca(['terminal', 'list']);
  assert.equal(answer.ok, true, `orca terminal list failed: ${JSON.stringify(answer.error)}`);
  return answer.result.terminals;
}

/** The terminals in one workspace, by the path they were opened in. */
const terminalsAt = (home) => allTerminals().filter((terminal) => terminal.worktreePath === home);

/**
 * The tabs Orca lists at `home` once it has caught up with what was closed:
 * `terminal close` answers ok before `terminal list` stops reporting the tab,
 * so the listing is read again until the closed tabs are out of it. By handle,
 * which stays the same while Orca lists a tab as orphaned (#187).
 */
async function terminalsAfterClosing(home, closed, within = 5000) {
  const until = Date.now() + within;
  let left = terminalsAt(home);
  while (left.some((terminal) => closed.includes(terminal.handle)) && Date.now() < until) {
    await setTimeout(250);
    left = terminalsAt(home);
  }
  return left;
}

/** Every workspace Orca knows about right now. */
function allSetups() {
  const answer = orca(['project', 'setups']);
  assert.equal(answer.ok, true, `orca project setups failed: ${JSON.stringify(answer.error)}`);
  return answer.result.setups;
}

/**
 * Run this checkout's `obk`, by its full path. The `obk` on PATH is the
 * published release this machine uses, not the code under test (#217).
 */
function obk(args) {
  const done = spawnSync(process.execPath, [cliEntry, ...args], { encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(done.error, undefined, `could not run \`obk\`: ${done.error?.message}`);
  // The owner reads this output. Orca's word for a workspace must not be in it.
  assert.ok(!/worktree/i.test(done.stdout + done.stderr), `obk said "worktree": ${done.stdout}${done.stderr}`);
  return done;
}

/** Run `obk ... --json` and read the answer it printed. */
function obkJson(args) {
  const done = obk([...args, '--json']);
  assert.equal(done.status, 0, `obk ${args.join(' ')} failed: ${done.stdout}${done.stderr}`);
  try {
    return JSON.parse(done.stdout);
  } catch {
    assert.fail(`obk ${args.join(' ')} --json did not print JSON: ${done.stdout}`);
  }
}

/** The entry for one tab in an `obk --json` answer. */
function tabOf(answer, name) {
  const found = (answer.tabs ?? []).filter((entry) => entry.name === name);
  assert.equal(found.length, 1, `one entry should be the ${name} tab, got: ${JSON.stringify(answer.tabs)}`);
  return found[0];
}

/**
 * Keep asking until `look` gives something other than undefined, or the time
 * runs out. `note` is added to the message when it does, so a run left alone
 * says which screen was waiting rather than only that it waited.
 */
async function until(what, within, look, note = () => '') {
  const stop = Date.now() + within;
  for (;;) {
    const found = await look();
    if (found !== undefined) return found;
    assert.ok(Date.now() < stop, `gave up waiting for ${what} after ${within}ms.${note()}`);
    await setTimeout(1000);
  }
}

/** Everything the tab is rendering right now, as one piece of text to look through. */
function screenOf(handle) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  return answer.ok === true ? JSON.stringify(answer.result) : '';
}

/**
 * What the tab is showing, for the message of a wait that ran out: Orca's own
 * word for whatever is waiting to be answered when it gave one, and then the
 * screen itself.
 */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  return [
    blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`,
    ' This test answers nothing a tab asks but its own menu; answer it in Orca and run again.',
    `\n  orca terminal read --terminal ${handle} --screen\n  ${screenOf(handle).slice(0, 2000)}`,
  ].join('');
}

/**
 * Wait until the tab will take a line: a TUI is up, Orca names nothing waiting
 * on it, and its screen shows no question of the harness's own
 * (helpers/screens.js, `waitingOn`). Orca refuses an agent's prompt to a tab
 * waiting on one, and calls some of them idle with no reason (#329), so this
 * waits for the screens to be answered rather than typing through them.
 */
async function readyForAQuestion(handle, within = READY_MS) {
  await until(
    `${handle} to be past the questions of its own`,
    within,
    async () => {
      const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '5000']);
      if (answer.ok !== true) return undefined;
      if (answer.result?.wait?.blockedReason !== undefined) return undefined;
      return waitingOn(orca, handle) === undefined ? true : undefined;
    },
    () => `${waitingOn(orca, handle) ?? ''}${whatIsUp(handle)}`,
  );
}

/** The request id an `agent_prompt_blocked` carries, when that is what came back. */
function requestIdIn(error) {
  const found = /"orchestrationRequestId"\s*:\s*"([^"]+)"/.exec(JSON.stringify(error ?? null));
  return found === null ? undefined : found[1];
}

/**
 * Type one line into the test's own tab, once it is ready, and submit it with
 * `--enter`, the only thing that submits one (session-identity.test.js,
 * `askIn`). A refusal fails with the line, so the person running this can type
 * it in the tab themselves.
 */
async function askIn(handle, text) {
  await readyForAQuestion(handle);
  const sent = orca(['terminal', 'send', '--terminal', handle, '--text', text, '--enter']);
  if (sent.ok === true) return;
  const gated = requestIdIn(sent.error);
  assert.fail(
    `orca terminal send --enter failed: ${JSON.stringify(sent.error)}.`
    + (gated === undefined ? '' : ' Orca gated it as an agent prompt.')
    + ` Type \`${text}\` into that tab yourself and run the test again.${whatIsUp(handle)}`,
  );
}

/**
 * What Codex 0.156.1 asks as soon as `/new` is typed, before the new
 * conversation starts (a screen recording of the tab, quoted in
 * session-identity.test.js):
 *
 *       Where should the new conversation run?
 *     › 1. Current checkout  Keep using the current working directory
 *       2. New worktree      Create an isolated managed checkout
 */
const WHERE_TO_RUN = 'Where should the new conversation run?';

/** The Codex bot the test brings up, and the kit's word for a tab showing a harness's own question. */
const BOT = { name: 'question-codex', display: 'Question Codex' };
const QUESTION = 'question-on-screen';

/**
 * A word only the message's subject carries, and so only the nudge: the kit
 * types the subject into the receiver's tab when it nudges. Seen anywhere on
 * the screen after the send, it means a line went in.
 */
const SUBJECT_WORD = 'KESTREL-5150';

test('a nudge types nothing into a tab whose harness is asking its own question, and says so', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-question-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', BOT.name].map(homeOf);

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    const closed = [];
    for (const home of homes) {
      for (const terminal of terminalsAt(home)) {
        if (before.handles.has(terminal.handle)) continue;
        orca(['terminal', 'close', '--terminal', terminal.handle, '--tab']);
        closed.push(terminal.handle);
      }
    }
    for (const setup of allSetups()) {
      if (!homes.includes(setup.path) || before.setups.has(setup.id)) continue;
      orca(['project', 'setup-delete', '--setup', setup.id]);
    }
    await removeBotsFolderAndSiblings(bots);

    // The point of all the care above: everything that was open is still open.
    const left = new Set(allTerminals().map((terminal) => terminal.handle));
    for (const handle of before.handles) {
      assert.ok(left.has(handle), `${handle} was open before this test and is gone now`);
    }
    for (const home of homes) {
      assert.deepEqual(await terminalsAfterClosing(home, closed), [], `this test left tabs behind in ${home}`);
    }
  });

  obkJson(['init', '--bots', bots, '--harness', 'claude']);
  obkJson([
    'bot', 'create', '--bots', bots, '--name', BOT.name, '--harness', 'codex',
    '--charter', `${BOT.display} exists for one system test run and owns nothing.`,
  ]);
  obkJson([
    'session', 'add', '--bots', bots, '--bot', BOT.name, '--name', 'daily',
    '--prompt=You are a system test\'s bot and you own nothing. Do not run any command, read or write'
    + ' any file, or use any tool. Say nothing now and wait.',
  ]);

  const entry = tabOf(obkJson(['up', '--bots', bots, '--bot', BOT.name]), 'daily');
  assert.equal(entry.created, true);
  assert.equal(
    entry.harnessStarted,
    true,
    `no codex came up in ${entry.title}: look at it with \`orca terminal read --terminal ${entry.terminal} --screen\``,
  );
  const handle = entry.terminal;

  // 1. The question, brought up by the test in its own tab, once the tab is
  //    past its first-run screens and its start prompt.
  await askIn(handle, '/new');
  await until(
    `${handle} to ask where the new conversation should run`,
    READY_MS,
    async () => (screenOf(handle).includes(WHERE_TO_RUN) ? true : undefined),
    () => ` This needs Codex's \`/new\` menu, seen on 0.156.1; a Codex that starts the new conversation without asking cannot run this test.${whatIsUp(handle)}`,
  );

  // The premise: Orca names no reason for this menu, as it named none for the
  // update offer. With a reason from Orca, the kit's old guard would have held
  // the nudge back too, and this run would show nothing about the new one.
  const look = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '5000']);
  assert.equal(
    look.result?.wait?.blockedReason,
    undefined,
    `the premise: Orca should name no reason for the menu, and named ${look.result?.wait?.blockedReason}.${whatIsUp(handle)}`,
  );

  // 2. Mail for the session while its menu is up. It is queued, and the tab is
  //    told nothing, and the answer says why.
  const sent = obkJson([
    'message', 'send', '--bots', bots, '--to', `${BOT.name}/daily`, '--from', 'bot-father/daily',
    '--subject', `the question guard ${SUBJECT_WORD}`, '--text', 'Nothing to do; this only checks the nudge.',
  ]);
  assert.equal(sent.sent, true, `the message should be in the mailbox: ${JSON.stringify(sent)}`);
  assert.equal(sent.nudged, false, `nothing should have been typed into a tab with a menu up: ${JSON.stringify(sent)}`);
  assert.equal(sent.blocked, QUESTION, `the answer should say the tab is waiting on a question: ${JSON.stringify(sent)}`);

  // 3. Nothing answered the menu: it is still up, and the nudge is nowhere on
  //    the screen. A return typed in would have picked option 1 and closed it.
  await setTimeout(SETTLE_MS);
  const screen = screenOf(handle);
  assert.ok(screen.includes(WHERE_TO_RUN), `the menu should still be up, nothing having answered it: ${screen.slice(0, 3000)}`);
  assert.ok(!screen.includes(SUBJECT_WORD), `no line of the kit's should be in the tab: ${screen.slice(0, 3000)}`);

  // 4. The test answers its own menu, the way session-identity.test.js does: a
  //    return inside the payload, no `--enter`, because a menu takes a return as
  //    the key it waits for. Then it waits for the menu to go.
  const picked = orca(['terminal', 'send', '--terminal', handle, '--text', '1\r']);
  assert.equal(picked.ok, true, `answering the menu failed: ${JSON.stringify(picked.error)}.${whatIsUp(handle)}`);
  await until(
    `${handle} to start the new conversation`,
    READY_MS,
    async () => (screenOf(handle).includes(WHERE_TO_RUN) ? undefined : true),
    () => whatIsUp(handle),
  );
});
