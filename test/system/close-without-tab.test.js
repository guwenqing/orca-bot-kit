// A system test: the close `obk restart` falls back on when Orca refuses
// `terminal close --terminal <h> --tab` with tab_not_found (#405), against the
// real Claude Code in the real Orca on this machine. Run it with `npm run
// test:system`; `npm test` cannot, and no CI machine could.
//
// Seen live on Orca 1.4.214 after a machine restart: `close --tab` was refused
// with tab_not_found for a tab `terminal list` still listed, and `orca terminal
// close --terminal <h>` without `--tab` closed it. The kit now makes that second
// close itself, and then waits, as after any close, for the listing to drop the
// tab. The refusal cannot be produced on demand: nobody found a safe way to
// bring a tab into that state, and restarting Orca or the machine would take
// the owner's whole fleet with it. So the trigger is faked, in
// `test/restart-tab-not-found.test.js`, and this file proves the close itself,
// on the kind of tab the live case had: a one-pane tab the kit opened, whose
// harness quit to the tab's shell.
//
//   1. The kit brings one session up; the book learns its conversation, and
//      the conversation has a turn, so a resume has something to pick up (#295).
//   2. Its Claude Code is ended with `/exit`, and the tab's shell is in front.
//   3. The tab is closed with `orca terminal close --terminal <handle>`, no
//      `--tab`: the fallback's own call.
//   4. `terminal list` stops listing the tab within the kit's own wait, and
//      neither the tab's pane process nor its shell is left.
//   5. The kit's `up` brings the session back in a new tab, resuming the book's
//      conversation.
//
// What it cannot know live: whether Orca answers a tab in the refused state the
// same way. That tab is missing from the snapshot `close --tab` reads, and the
// close without `--tab` was seen to work on one such tab (#405, Orca 1.4.214);
// here it is shown on an ordinary tab only. Nor does it prove that the resumed
// conversation remembers anything: that is `restart.test.js`'s passphrase,
// and here the resume is read off Claude Code's own process record and the
// harness's arguments.
//
// Claude Code, not Codex, although the live case was a Codex session: the close
// is Orca's and the harness has quit before it, so which one it was does not
// matter to it, and Claude Code asks one question on a new folder where Codex
// asks two.
//
// The machine it runs on is someone's working machine, with their own tabs open.
// So this test, like the ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory;
//   - writes down every terminal and workspace Orca already had, before it
//     creates anything;
//   - touches only what it created, matched by handle and by workspace path;
//   - closes one tab of its own without `--tab`, as step 3, and the rest of its
//     own tabs one by one (`--terminal <handle> --tab`) at the end, then
//     deletes its own workspaces;
//   - checks afterwards that it closed no tab it did not create;
//   - signals no process: a process is only ever looked at, with `ps -p <pid>`,
//     one pid at a time, and a harness is ended with `/exit` or with its tab.
//
// `orca terminal close --worktree … --all` is never run here, and the helper
// below refuses to run it at all.
//
// It is slow: a real agent, one answer, a quit and a resume. Minutes.
//
// **It is attended.** A bot folder nobody has opened before asks questions
// before the harness is running in it, and this test answers none of them —
// answering them is the caller's job and not the kit's (PRD 6.5). What to expect:
//
//   1. `Plain Close daily`: Claude Code's folder-trust list. Its selection
//      starts on `No, exit`, so it takes a down-arrow and then return.
//   2. The same tab, if Claude Code offers an update: accept it (PRD 6.5).
//   3. After `up`, the new `Plain Close daily` tab. It is the same folder, so it
//      should come straight up; if it asks again, answer it the same way.
//   4. `Bot Father daily` will be sitting on its own trust question. Leave it.
//   5. `Plain Close daily`, after its first answer: Claude Code 2.1.283's form
//      "Teach auto mode about your environment?". Esc cancels it. The test
//      types nothing into the tab while it is up, since a return presses
//      Continue (#416).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry } from '../helpers/cli.js';
import { waitingOn } from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { deleteOwnProject } from '../helpers/own-project.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/**
 * Remove the throwaway bots folder and everything the kit made beside it:
 * `<bots>.prompts`, `<bots>.locks` and the rest are siblings of the bots folder,
 * not children of it (PRD 6.3).
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

/** How long a real agent is given to answer a question before the test gives up on it. */
const ANSWER_MS = 240000;

/** How long the kit's hook is given to have written the book after a session starts. */
const HOOK_MS = 60000;

/** How long a tab is given to be ready for a question, a person answering its screens included. */
const READY_MS = 180000;

/**
 * How long the kit waits, after a close Orca answered, for `terminal list` to
 * stop listing the tab before it gives up and opens nothing: `SETTLED_MS` in
 * src/restart.js, which the kit does not export, so it is written down again
 * here. The fallback close is only as good as a listing that catches up in time.
 */
const KIT_CLOSE_WAIT_MS = 5000;

/**
 * How long the tab's processes are given to be gone once Orca has answered the
 * close. A process dies a moment after Orca answers; this test's own allowance,
 * not a number the kit has.
 */
const GONE_MS = 10000;

/**
 * Ask Orca something and read its JSON. Never the blanket close, on any road.
 * Every tab it closes is counted as this test's, for the check at the end (#246).
 */
const guard = tabGuard(ORCA);
const { orca } = guard;

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
 * `terminal close` answers ok before `terminal list` stops reporting the tab.
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
  assert.ok(!/worktree/i.test(done.stdout + done.stderr), `obk said "worktree": ${done.stdout}${done.stderr}`);
  return done;
}

/** Run `obk ... --json` and read the answer it printed. */
function obkJson(args) {
  const done = obk([...args, '--json']);
  assert.equal(done.status, 0, `obk ${args.join(' ')} failed: ${done.stdout}${done.stderr}`);
  try {
    return guard.openedByKit(JSON.parse(done.stdout));
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

/** What the book says about one session right now. */
async function sessionIn(home, name) {
  const book = parse(await readFile(path.join(home, 'sessions.yaml'), 'utf8')) ?? {};
  return book.sessions?.[name] ?? {};
}

/** Keep asking until `look` gives something other than undefined, or the time runs out. */
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

/** What the tab is showing, for the message of a wait that ran out. */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  return [
    blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`,
    ' This test answers nothing a tab asks; answer it in Orca and run again.',
    `\n  orca terminal read --terminal ${handle} --screen\n  ${screenOf(handle).slice(0, 2000)}`,
  ].join('');
}

/**
 * Wait until the tab will take a question: a TUI is up and nothing of its own
 * is waiting to be answered, by Orca's word or by the screen itself (#329).
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

/** The request id an `agent_prompt_blocked` carries, read out of the whole error. */
function requestIdIn(error) {
  const found = /"orchestrationRequestId"\s*:\s*"([^"]+)"/.exec(JSON.stringify(error ?? null));
  return found === null ? undefined : found[1];
}

/**
 * Type a line into this test's own tab once it is ready to take one, with
 * `--enter`. A gated line fails with the screen and the id rather than
 * retrying (see `session-identity.test.js`).
 */
async function askIn(handle, text) {
  await readyForAQuestion(handle);
  const sent = orca(['terminal', 'send', '--terminal', handle, '--text', text, '--enter']);
  if (sent.ok === true) return;

  const gated = requestIdIn(sent.error);
  assert.fail(
    `orca terminal send --enter failed: ${JSON.stringify(sent.error)}.`
    + (gated === undefined
      ? ''
      : ' Orca gated it as an agent prompt. Submit the line yourself in the tab, or reissue the'
        + ` same command with --retry-request ${gated} --wait-submit 30.`)
    + whatIsUp(handle),
  );
}

/**
 * Ask the session something and wait for `word` to appear on its screen. Only a
 * word that is neither in the question nor on the screen already can be waited
 * for: the echo of the typed line would satisfy the first, and whatever was
 * already there the second, with no agent reading anything.
 */
async function answers(handle, question, word, within = ANSWER_MS) {
  assert.ok(!question.includes(word), `${word} is in the question itself, so its echo would answer it: ${question}`);
  assert.ok(
    !screenOf(handle).includes(word),
    `${word} is on the screen before anyone asked for it, so an answer would prove nothing: ${question}`,
  );
  await askIn(handle, question);
  await until(
    `${handle} to answer with ${word}`,
    within,
    async () => (screenOf(handle).includes(word) ? true : undefined),
    () => whatIsUp(handle),
  );
}

/** Read `ps` for one pid, and nothing else: it is a reader here and never a road to a signal. */
function psOf(pid, columns) {
  assert.match(String(pid), /^[1-9]\d*$/, `ps is asked about one positive pid, got: ${pid}`);
  const done = spawnSync('ps', [...columns, '-p', String(pid)], { encoding: 'utf8' });
  return done.status === 0 ? done.stdout.trim() : undefined;
}

/** Whether a process with this pid is there at all. Read with `ps -p`, never signalled. */
const running = (pid) => psOf(pid, ['-o', 'pid=']) !== undefined;

/**
 * The pid Orca's diagnostics give a tab's pane: `/usr/bin/login` on macOS, with
 * the login shell as its child (tech notes, section 1). Found by the tab's pty
 * id. Undefined when it cannot be read.
 */
function panePidOf(handle) {
  const ptyId = allTerminals().find((terminal) => terminal.handle === handle)?.ptyId;
  if (ptyId === undefined) return undefined;
  const memory = orca(['diagnostics', 'memory']);
  if (memory.ok !== true) return undefined;
  return (memory.result?.worktrees ?? [])
    .flatMap((worktree) => worktree.sessions ?? [])
    .find((one) => one.sessionId === ptyId)?.pid;
}

/**
 * The process in front of a tab's terminal, the way the kit finds it: the
 * pane's pid, then its terminal's foreground group from `ps`. `name` is the
 * command's own name, a login shell's leading `-` aside, and `parent` its
 * parent's pid. Undefined when any of it cannot be read. As
 * `restart.test.js` has it; the system tests share no helpers.
 */
function inFront(pane) {
  if (pane === undefined) return undefined;
  const group = Number(psOf(pane, ['-o', 'tpgid=']));
  if (!Number.isInteger(group) || group <= 0) return undefined;
  const comm = psOf(group, ['-o', 'comm=']);
  const parent = Number(psOf(group, ['-o', 'ppid=']));
  return comm === undefined ? undefined : { pid: group, name: path.basename(comm.replace(/^-/, '')), parent };
}

/**
 * The tab a listed terminal really belongs to. While Orca calls a tab orphaned,
 * `terminal list` gives it `tabId: "pty:<ptyId>"`, and only `terminal show`
 * answers with the real one (tech notes, section 1: Claude Code typed into a
 * tab of a project the window has not loaded orphans it within 2 s; #187).
 * Undefined when `show` cannot say, as for a terminal already gone.
 */
function realTabIdOf(terminal) {
  if (terminal.orphaned !== true) return terminal.tabId;
  const shown = orca(['terminal', 'show', '--terminal', terminal.handle]);
  return shown.ok === true ? shown.result?.terminal?.tabId : undefined;
}

/** The words a process was started with. `command=` and not `-E`, so none of the environment is read. */
const argvOf = (pid) => (psOf(pid, ['-ww', '-o', 'command=']) ?? '').split(/\s+/);

/** Claude Code's registry of running processes, one file each, `<pid>.json` (tech notes, section 2). */
const REGISTRY = path.join(os.homedir(), '.claude', 'sessions');

/** Every entry in the registry, read as it is; one being written or removed as it is read is left out. */
function registry() {
  let names;
  try {
    names = readdirSync(REGISTRY);
  } catch {
    return [];
  }
  const entries = [];
  for (const name of names.filter((one) => one.endsWith('.json'))) {
    try {
      entries.push(JSON.parse(readFileSync(path.join(REGISTRY, name), 'utf8')));
    } catch {
      // The next look reads it again.
    }
  }
  return entries.filter((entry) => entry !== null && typeof entry === 'object');
}

/**
 * The registry's entries for conversation `id` whose process is still there. A
 * file left by a process that ended is not one, which is why the process is
 * looked at as well, with `ps -p`, which only reads.
 */
const processesIn = (id) => registry()
  .filter((entry) => entry.sessionId === id && Number.isInteger(entry.pid) && entry.pid > 0)
  .filter((entry) => running(entry.pid));

/** The registry's entries for one folder, short, for the message of a wait that ran out. */
const registryAt = (home) => JSON.stringify(registry()
  .filter((entry) => entry.cwd === home)
  .map((entry) => ({ pid: entry.pid, sessionId: entry.sessionId, name: entry.name })));

/** The bot: one session, one word in its start prompt. */
const BOT = {
  name: 'plain-close',
  display: 'Plain Close',
  codeword: 'HERON-2659',
};

const START_PROMPT = [
  `You are a system test's bot and you own nothing. Your codeword is ${BOT.codeword}.`,
  'When anyone asks you for your codeword, give it in exactly the form they ask for, and nothing else.',
  'Do not run any command, do not read or write any file, and do not use any tool.',
  'Say nothing now and wait.',
].join(' ');

test('#405: a kit tab whose harness quit, closed without --tab, leaves the listing and no process behind, and up brings the session back on its conversation', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-close-without-tab-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', BOT.name].map(homeOf);
  const home = homeOf(BOT.name);

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    // Only this test's own tabs are closed. A tab it did not create at one of
    // its homes is not its to close: that project and the bots folder stay
    // where they are, and the test fails naming the tab (review of PR #425).
    const { closed, foreign } = guard.closeOwnAt(homes);
    const held = new Set(foreign.map((one) => one.home));
    let deleted = 0;
    const failedDeletes = [];
    for (const setup of allSetups()) {
      if (!homes.includes(setup.path) || before.setups.has(setup.id) || held.has(setup.path)) continue;
      try {
        await deleteOwnProject(setup, bots);
        deleted += 1;
      } catch (error) {
        failedDeletes.push(`${setup.path}: ${error.message}`);
      }
    }
    // Orca's sidebar keeps a deleted project's row until its window is
    // rebuilt (#343): the kit's own reload, as after a retire.
    if (deleted > 0 && !(await reloadWindow())) t.diagnostic(RELOAD_LINE);
    assert.deepEqual(foreign, [], `tabs this test did not create are open at its homes, so it closed only its own and left those projects and ${bots} in place`);
    await removeBotsFolderAndSiblings(bots);

    // This test closed no tab but its own. A tab open before it and gone now
    // that it did not close was closed by someone else on this shared machine,
    // so that is said, not failed (#246).
    const { closedNotOurs, goneElsewhere } = guard.verdict(before.handles);
    assert.deepEqual(closedNotOurs, [], 'this test closed tabs it did not create');
    if (goneElsewhere.length > 0) t.diagnostic(`tabs open before this test and closed elsewhere meanwhile: ${goneElsewhere.join(', ')}`);
    for (const each of homes) {
      assert.deepEqual(await terminalsAfterClosing(each, closed), [], `this test left tabs behind in ${each}`);
    }
    assert.deepEqual(failedDeletes, [], 'projects this test could not remove, left in Orca');
  });

  obkJson(['init', '--bots', bots, '--harness', 'claude']);
  obkJson([
    'bot', 'create', '--bots', bots, '--name', BOT.name, '--harness', 'claude',
    '--charter', `${BOT.display} exists for one system test run and owns nothing.`,
  ]);
  obkJson(['session', 'add', '--bots', bots, '--bot', BOT.name, '--name', 'daily', `--prompt=${START_PROMPT}`]);

  // 1. The kit brings the session up in a tab of its own.
  const opened = tabOf(obkJson(['up', '--bots', bots, '--bot', BOT.name]), 'daily');
  assert.equal(opened.created, true);
  assert.equal(
    opened.harnessStarted,
    true,
    `no claude came up in ${opened.title}: look at it with \`orca terminal read --terminal ${opened.terminal} --screen\``,
  );

  // The hook's report is what says the folder trust was answered and the
  // harness is running; the id is what `up` has to hand back.
  const id = await until(
    `${BOT.name}/daily to report its session id`,
    HOOK_MS,
    async () => (await sessionIn(home, 'daily')).session,
    () => ` The kit's hook has not run.${whatIsUp(opened.terminal)}`,
  );
  const tabId = (await sessionIn(home, 'daily')).tab;
  assert.equal(tabId, opened.tabId, 'the premise: the book holds the tab the kit opened');

  // One turn, so the conversation is on Claude Code's own record and a resume
  // has something to pick up (#295).
  await answers(opened.terminal, 'Reply with your codeword in lower case and nothing else.', BOT.codeword.toLowerCase());

  // The tab holds one pane, as every tab the kit opens does: that is what makes
  // a close without --tab take the whole tab (#405, Orca 1.4.215's code).
  // A pane of the tab is listed in the bot's project, under its real tab id or,
  // while orphaned, under `pty:<ptyId>`, so each is read through `show`.
  const atHome = terminalsAt(home).map((terminal) => ({ ...terminal, realTabId: realTabIdOf(terminal) }));
  const unknown = atHome.filter((terminal) => terminal.realTabId === undefined);
  assert.deepEqual(unknown, [], `the premise: Orca says which tab each terminal of ${home} is in`);
  const panesOfTab = atHome.filter((terminal) => terminal.realTabId === tabId);
  assert.deepEqual(
    panesOfTab.map((terminal) => terminal.handle),
    [opened.terminal],
    `the premise: the kit's tab holds one pane, got: ${JSON.stringify(atHome)}`,
  );
  const { ptyId } = panesOfTab[0];
  assert.equal(typeof ptyId, 'string', `the premise: Orca gives the tab's pane a pty id, got: ${JSON.stringify(panesOfTab[0])}`);

  // 2. Its harness quits to the tab's shell, as a session's whose harness quit.
  const kits = processesIn(id);
  assert.equal(kits.length, 1, `the premise: one running Claude Code is having ${id}, got ${registryAt(home)}`);
  await askIn(opened.terminal, '/exit');
  await until(
    `the Claude Code the kit started (pid ${kits[0].pid}) to exit, so the shell is in front`,
    ANSWER_MS,
    async () => (processesIn(id).length === 0 ? true : undefined),
    () => whatIsUp(opened.terminal),
  );

  const pane = panePidOf(opened.terminal);
  assert.ok(pane !== undefined, `the premise: Orca's diagnostics give the tab's pane pid, for ${opened.terminal}`);
  const shell = await until(
    `the tab's shell to be in front of ${opened.title} (pane pid ${pane})`,
    HOOK_MS,
    async () => {
      const now = inFront(pane);
      return now !== undefined && now.parent === pane && now.name !== 'claude' ? now : undefined;
    },
    () => ` In front: ${JSON.stringify(inFront(pane))}.${whatIsUp(opened.terminal)}`,
  );
  t.diagnostic(`before the close: pane pid ${pane}, ${shell.name} (pid ${shell.pid}) in front`);
  assert.ok(running(pane) && running(shell.pid), 'the premise: the pane and its shell are running before the close');

  // 3. The fallback's own call: the terminal by its handle, without --tab.
  const answer = orca(['terminal', 'close', '--terminal', opened.terminal]);
  assert.equal(answer.ok, true, `Orca refused the close without --tab: ${JSON.stringify(answer.error)}`);
  t.diagnostic(`orca terminal close --terminal ${opened.terminal} answered: ${JSON.stringify(answer.result)}`);

  // 4. The listing drops the tab within the kit's own wait. Looked for every
  // way it can be listed: by its handle, by its pane's pty id (a handle Orca
  // re-issues keeps it, #294), by its real tab id, by `pty:<ptyId>`, the id an
  // orphaned tab is listed under (#187), and by the real tab id `show` gives
  // any orphaned terminal of the bot's project.
  const ofTheTab = (terminal) => terminal.handle === opened.terminal
    || terminal.ptyId === ptyId
    || terminal.tabId === tabId
    || terminal.tabId === `pty:${ptyId}`
    || (terminal.worktreePath === home && terminal.orphaned === true && realTabIdOf(terminal) === tabId);
  const closedAt = Date.now();
  let still = allTerminals().filter(ofTheTab);
  while (still.length > 0 && Date.now() - closedAt < KIT_CLOSE_WAIT_MS) {
    await setTimeout(250);
    still = allTerminals().filter(ofTheTab);
  }
  assert.deepEqual(
    still,
    [],
    `Orca still lists the tab ${KIT_CLOSE_WAIT_MS}ms after the close without --tab, where the kit would give up`,
  );
  t.diagnostic(`the listing dropped the tab within ${Date.now() - closedAt}ms`);

  // And nothing of the tab is left running: not its pane, not its shell.
  await until(
    `the tab's pane (pid ${pane}) and shell (pid ${shell.pid}) to be gone`,
    GONE_MS,
    async () => (!running(pane) && !running(shell.pid) ? true : undefined),
    () => ` Still running: ${[pane, shell.pid].filter(running).map((pid) => `${pid} ${psOf(pid, ['-o', 'comm='])}`).join(', ')}`,
  );

  // 5. The kit's `up` brings the session back in a new tab, on its conversation.
  const back = tabOf(obkJson(['up', '--bots', bots, '--bot', BOT.name]), 'daily');
  assert.equal(back.created, true, `a new tab was opened for it: ${JSON.stringify(back)}`);
  assert.notEqual(back.tabId, tabId, 'and it is a new tab, with a new id');
  assert.equal(back.resumed, true, `and the run says it picked the conversation up again: ${JSON.stringify(back)}`);
  assert.equal(
    back.harnessStarted,
    true,
    `no claude came up in ${back.title}: look at it with \`orca terminal read --terminal ${back.terminal} --screen\``,
  );
  assert.deepEqual(
    terminalsAt(home).map((terminal) => terminal.handle),
    [back.terminal],
    'the bot has the new tab and no other: nothing of the old one is left',
  );

  const daily = await sessionIn(home, 'daily');
  assert.equal(daily.tab, back.tabId, `the book holds the new tab, got: ${JSON.stringify(daily)}`);
  assert.equal(daily.session, id, `and the same conversation, got: ${JSON.stringify(daily)}`);

  // Claude Code itself says it is having that conversation again, in a new
  // process started by the kit's line, which resumes it by its id.
  const resumed = await until(
    `a Claude Code to be having ${id} again`,
    READY_MS,
    async () => processesIn(id)[0],
    () => ` The registry for this folder: ${registryAt(home)}.${whatIsUp(back.terminal)}`,
  );
  assert.notEqual(resumed.pid, kits[0].pid, 'a new process, not the one that quit');
  const argv = argvOf(resumed.pid);
  assert.equal(argv[argv.indexOf('--resume') + 1], id, `started with --resume ${id}, got: ${argv.join(' ')}`);
});
