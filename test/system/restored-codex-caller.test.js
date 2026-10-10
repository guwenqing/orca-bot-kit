// A system test: a Codex session never acts under another session's tab (#408),
// against the real Codex in the real Orca on this machine. Run it with
// `npm run test:system -- --yes <this file>`; `npm test` cannot, and no CI
// machine could.
//
// Seen live on 2026-09-27 (Orca 1.4.214, codex-cli 0.157.1): Orca brought Codex
// sessions back by itself as a bare `codex resume <id>`, without the kit's
// launch line and so without `--no-daemon`. Codex 0.157 then runs one shared
// background server for them, and every command run through it carries the
// environment of the session that started it: its ORCA_TAB_ID and its
// ORCA_TERMINAL_HANDLE. So the kit took another session's commands for the
// first session's.
//
// A cold restore cannot be staged without restarting the owner's Orca, so this
// test stands in for it as test/system/restored-tab.test.js does: the kit's
// Codex in each tab is quit, and the bare resume Orca would type is typed into
// the tab's shell. `first` is resumed before `second`, so if a shared server is
// started, `first`'s Codex starts it and `second`'s uses it.
//
// Every Codex here is given its folder's trust at launch (#240,
// test/helpers/codex-trust.js), so Codex asks neither its folder trust nor its
// hooks review and writes nothing about this folder into the user's own
// ~/.codex/config.toml; and each runs without Codex's sleep tool (#432): a
// Codex on a GPT-6 model told to wait sleeps in its turn otherwise, and the
// waits here for its turn to end would not end. The kit's launch lines carry
// them from bot.yaml, a restart included (worked out from src/launch.js, not
// proven live). The bare resume carries the same arguments and nothing else of
// the kit's line: without them Codex would ask this folder's trust again, and
// could sleep, where Orca's own restore
// resumes in a folder the user trusted long ago. What this test is about, the
// missing `OBK_TAB_SHELL` and `--no-daemon`, is the same either way.
//
// What it shows, for one Codex bot with two sessions:
//
//   1. Brought back that way, `second` is asked to run tab-bound kit commands:
//      `message send` with no `--from`, `message check` with no `--bot`, and
//      `message check` naming itself. Each is refused, not 0, and says why
//      (Codex, its shared background server), names `obk restart`, and says a
//      restart can stop at "open in another app". Nothing was sent: Orca's
//      mailbox for `first` holds no such message.
//   2. `obk restart` of the bot brings both back on the kit's launch line.
//   3. The same send and check from `second` then work, and `first`'s mailbox
//      holds the message sent the second time and not the first.
//
// What this test cannot know before it runs, and how it copes:
//
//   - Whether a bare `codex resume` here starts a shared server at all, and
//     whether `second`'s commands run through `first`'s. `second` writes down
//     the ORCA_TAB_ID and OBK_TAB_SHELL its commands see before anything else.
//     `first`'s tab is the shared server, as seen live, and is said in a
//     diagnostic. `second`'s own tab is no shared server; the refusal is still
//     due, since that tab is a Codex session's and carries no OBK_TAB_SHELL,
//     and a diagnostic says the shared server was not reproduced. Any other tab
//     is a server a session outside this test started, already running on this
//     machine, and the test stops there: that run shows nothing about the kit.
//     Any OBK_TAB_SHELL at all stops it too.
//   - A bare resume on 0.157.1 once failed with "Cannot use the shared
//     background server" (tech notes, section 3). It is typed once more; a
//     second failure stops the test with the screen.
//   - Whether the restart meets "This conversation is open in another app".
//     It did in live run 5: the shared server outlives the sessions that
//     started it and goes on holding the conversation, so a second plain
//     restart met the same screen. The kit's advice for it is Codex's own
//     `codex app-server daemon stop`, once every Codex session is back on the
//     kit's line, and then the stuck session's restart again; the test follows
//     it. After the bot's restart, a session at that screen gets the stop,
//     only when the one managed server running is the test's own (as in the
//     cleanup; one that is not fails the test and is not stopped), and then
//     its own restart, which must come back ready. Still at the screen, the
//     test fails with it: the advice does not hold. The test never presses R.
//     That the restart works after the stop has not been seen live yet.
//   - Whether the shared server outlives the tabs it was started from. It
//     does: the live run of 2026-09-27 left `codex app-server --listen unix://
//     --managed-daemon` and `codex app-server daemon pid-update-loop` running,
//     reparented to pid 1, after every tab of the test's was closed. Left
//     there, the owner's Codex sessions would join it at their next bare
//     resume, under a dead test tab's identity. So the cleanup stops it, pass
//     or fail, with Codex's own `codex app-server daemon stop`, and only when
//     the one managed server running is the test's own: its environment, read
//     with `ps -E`, names the test's bots folder. One that is not the test's
//     is left alone and the test fails saying so. Codex's updater helper,
//     `codex app-server daemon pid-update-loop`, outlives the stop (seen live),
//     and nothing of Codex's ends it; Codex, not the test, started it. So a
//     helper still there after the stop is named in a diagnostic, with the pid
//     Codex records for it in ~/.codex/app-server-daemon/daemon-updater.pid,
//     and never signalled.
//   - And so the test refuses to start while a managed Codex server is already
//     running: its resumes would join that one, and the cleanup could not
//     tell it from its own.
//
// The mailbox is looked at the way test/system/codex-nudge.test.js does and
// for the same reason: Orca's own listing, `orca orchestration inbox`, read
// and kept to this test's own Run, nothing else printed.
//
// The machine it runs on is someone's working machine, with their own tabs
// open. So this test, like the ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory;
//   - writes down every terminal and workspace Orca already had, before it
//     creates anything;
//   - types into none but its own tabs, and touches only what it created,
//     matched by handle and by workspace path;
//   - closes its own tabs one by one (`--terminal <handle> --tab`) and then
//     deletes its own workspaces, whatever happened, and checks afterwards that
//     it closed no tab it did not create;
//   - runs this checkout's `src/cli.js` by its full path, never the machine's
//     `obk`, and has the bots run it the same way.
//
// `orca terminal close --worktree … --all` is never run here, and the helper
// below refuses to run it at all. `ps` is only ever read: one pid at a time,
// but for one listing of this user's command lines, kept to the lines of
// Codex's server. Nothing here signals a process by a pid; the only thing
// stopped is Codex's server, by Codex's own command.
//
// It is slow: two real Codex sessions, a quit and a resume each, a restart of
// both, and commands run by the model twice. Ten minutes or more.
//
// **It is attended.** Bot Father's daily may ask Claude Code's folder trust;
// nothing here waits on it, so it can be left. The Codex tabs, `Daemon Codex
// first` and `second`, should ask no folder trust and no hooks review (see
// above); a trust or hooks screen there means the launch-time trust did not
// take, and is not to be answered. The resumed Codex runs on
// this machine's own Codex settings, as a restore does; if it asks before it
// runs a command, allow it. If a harness offers an update, accept it (PRD 6.5).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry, shellWord, spellingsOf } from '../helpers/cli.js';
import { codexTrustArgs } from '../helpers/codex-trust.js';
import { waitingOn } from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { deleteOwnProject } from '../helpers/own-project.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/**
 * Remove the throwaway bots folder and everything the kit made beside it, and
 * then say so if one is still there.
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

/** How long a real agent is given to answer, or to run what it was asked to, before the test gives up on it. */
const ANSWER_MS = 240000;

/** How long a tab is given to be ready for a question, a person answering its first-run screens included. */
const READY_MS = 180000;

/** How long a harness is given to quit back to its tab's shell (seen live: within about 3 s). */
const QUIT_MS = 30000;

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

/** The tabs Orca lists at `home` once it has caught up with what was closed. */
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
 * published release this machine uses, not the code under test (#217, #220).
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
    ' If it is a first-run screen or a request to run a command, answer it in Orca and run again.',
    `\n  orca terminal read --terminal ${handle} --screen\n  ${screenOf(handle).slice(0, 2000)}`,
  ].join('');
}

/** Wait until the tab will take a question (restored-tab.test.js says why idle is not enough). */
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

/** Type one line into one of this test's own tabs and submit it. A refusal fails with the line. */
function typeInto(handle, text) {
  const sent = orca(['terminal', 'send', '--terminal', handle, '--text', text, '--enter']);
  if (sent.ok === true) return;
  assert.fail(`orca terminal send --enter failed: ${JSON.stringify(sent.error)}. Type \`${text}\` into that tab yourself and run the test again.${whatIsUp(handle)}`);
}

/** Ask a live agent something, once the tab is ready to take a line. */
async function askIn(handle, text) {
  await readyForAQuestion(handle);
  typeInto(handle, text);
}

/** Ask the session something and wait for `word`, which neither the question nor the screen carries yet. */
async function answers(handle, question, word, within = ANSWER_MS) {
  assert.ok(!question.includes(word), `${word} is in the question itself, so its echo would answer it: ${question}`);
  assert.ok(!screenOf(handle).includes(word), `${word} is on the screen before anyone asked for it: ${question}`);
  await askIn(handle, question);
  await until(`${handle} to answer with ${word}`, within, async () => (screenOf(handle).includes(word) ? true : undefined), () => whatIsUp(handle));
}

/** Read `ps` for one pid, and nothing else: it is a reader here and never a road to a signal. */
function psOf(pid, columns) {
  assert.match(String(pid), /^[1-9]\d*$/, `ps is asked about one positive pid, got: ${pid}`);
  const done = spawnSync('ps', [...columns, '-p', String(pid)], { encoding: 'utf8' });
  return done.status === 0 ? done.stdout.trim() : undefined;
}

/** The process in front of a tab's terminal, the way the kit finds it (restored-tab.test.js). */
function inFront(handle) {
  const ptyId = allTerminals().find((terminal) => terminal.handle === handle)?.ptyId;
  const memory = orca(['diagnostics', 'memory']);
  const pane = memory.ok === true
    ? (memory.result?.worktrees ?? []).flatMap((worktree) => worktree.sessions ?? []).find((one) => one.sessionId === ptyId)?.pid
    : undefined;
  if (ptyId === undefined || pane === undefined) return undefined;
  const group = Number(psOf(pane, ['-o', 'tpgid=']));
  if (!Number.isInteger(group) || group <= 0) return undefined;
  const comm = psOf(group, ['-o', 'comm=']);
  return comm === undefined ? undefined : { pid: group, name: path.basename(comm.replace(/^-/, '')) };
}

/** Whether a command name is a shell's. */
const isShell = (name) => ['zsh', 'bash', 'sh', 'fish', 'ksh', 'tcsh', 'dash'].includes(name);

/** The words `ps -E` prints for one process: only ever looked through for a word, never printed. */
const environmentWords = (pid) => (psOf(pid, ['-E', '-ww', '-o', 'command=']) ?? '').split(/\s+/);

/** The command line of one process, word by word. */
const argvOf = (pid) => (psOf(pid, ['-ww', '-o', 'command=']) ?? '').split(/\s+/);

/**
 * The words on the command lines of Codex's shared background server and its
 * helper, as seen live on codex-cli 0.157.1 (#408).
 */
const MANAGED_SERVER = ['app-server', '--managed-daemon'];
const PID_UPDATE_LOOP = ['app-server', 'pid-update-loop'];

/**
 * This user's processes whose command line carries each of `words`, as
 * `{ pid, command }`. Command lines only, read to find Codex's server; no
 * environment is read here, and nothing found here is signalled.
 */
function processesWith(words) {
  const done = spawnSync('ps', ['-U', String(process.getuid()), '-ww', '-o', 'pid=,command='], { encoding: 'utf8' });
  assert.equal(done.status, 0, `ps could not list this user's processes: exit ${done.status}`);
  return done.stdout.split('\n')
    .map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
    .filter((found) => found !== null)
    .map(([, pid, command]) => ({ pid: Number(pid), command }))
    .filter(({ pid, command }) => pid !== process.pid && words.every((word) => command.split(/\s+/).includes(word)));
}

/**
 * Whether one process's environment names `folder`: some variable whose value
 * is that folder or inside it, macOS's `/private` in front or not. Looked
 * through, never printed.
 */
function environmentNames(pid, folder) {
  const spellings = [folder, folder.replace(/^\/private(?=\/)/, '')];
  return environmentWords(pid).some((word) => {
    const at = word.indexOf('=');
    const value = at > 0 ? word.slice(at + 1) : '';
    return spellings.some((one) => value === one || value.startsWith(`${one}/`));
  });
}

/** Where Codex records its updater helper: read, never acted on. */
const UPDATER_RECORD = path.join(os.homedir(), '.codex', 'app-server-daemon', 'daemon-updater.pid');

/** The pid Codex's record of its updater names, as words for the diagnostic, or why it could not be read. */
function recordedUpdater() {
  try {
    const { pid } = JSON.parse(readFileSync(UPDATER_RECORD, 'utf8'));
    return `, which names pid ${pid}`;
  } catch (error) {
    return `, which could not be read (${error.code ?? error.message})`;
  }
}

/** Whether one pid is still a process. */
const alive = (pid) => psOf(pid, ['-o', 'pid=']) !== undefined;

/**
 * Stop the managed Codex server this test started, if one is running: with
 * Codex's own `codex app-server daemon stop`, and only when every managed
 * server running names `bots` in its environment. Answers what is wrong, for
 * the cleanup to fail on after the rest of it is done.
 */
async function stopOurCodexServer(t, bots) {
  const servers = processesWith(MANAGED_SERVER);
  if (servers.length === 0) return [];
  const others = servers.filter((one) => !environmentNames(one.pid, bots));
  if (others.length > 0) {
    return [
      `a managed Codex server this test did not start is running (pid ${others.map((one) => one.pid).join(', ')}), so none was stopped;`
      + ' `codex app-server daemon stop` would stop it too. Look at it before anything else starts a bare Codex.',
    ];
  }
  const stopped = spawnSync('codex', ['app-server', 'daemon', 'stop'], { encoding: 'utf8', cwd: os.tmpdir(), timeout: 30000 });
  t.diagnostic(`codex app-server daemon stop: exit ${stopped.status}${stopped.error ? ` (${stopped.error.message})` : ''}, said ${JSON.stringify(stopped.stdout.trim())}`);
  const until = Date.now() + 15000;
  while (servers.some((one) => alive(one.pid)) && Date.now() < until) await setTimeout(500);
  const loops = processesWith(PID_UPDATE_LOOP);
  if (loops.length > 0) {
    t.diagnostic(
      `Codex's updater helper (\`codex app-server daemon pid-update-loop\`, pid ${loops.map((one) => one.pid).join(', ')}) is still running after the stop.`
      + ' Codex started it, not this test, and nothing of Codex\'s ends it, so this test cannot end it and leaves it alone.'
      + ` Codex records it in ${UPDATER_RECORD}${recordedUpdater()}.`,
    );
  }
  const left = servers.filter((one) => alive(one.pid));
  return left.length === 0
    ? []
    : [`the managed Codex server this test started (pid ${left.map((one) => one.pid).join(', ')}) is still running after \`codex app-server daemon stop\``];
}

/** What Codex 0.157.1 printed when a resume could not use its shared server (tech notes, section 3). */
const SHARED_SERVER_ERROR = 'Cannot use the shared background server';

/** Codex's own stop of its shared server: the kit's advice for the other-app screen, and what this test runs for it. */
const DAEMON_STOP = 'codex app-server daemon stop';

/**
 * Words that warn what the stop reaches: Codex's shared server ends for
 * everything using it. Read loosely.
 */
const STOP_REACH = /\b(?:everything|every|all|any|other)\b[^.;]{0,80}\b(?:using|uses|use|sharing|shares|share|connected to|attached to)\b[^.;]{0,40}\b(?:it|server)\b/i;

/** Words that say that reach includes Codex sessions the kit did not start, the owner's own among them. */
const BEYOND_THE_KIT = /\boutside (?:the kit|obk)\b|\bCodex sessions? (?:the kit|obk) (?:did not|didn't|does not|doesn't) start\b|\b(?:your|the owner's|the user's) own Codex\b/i;

/** What Codex shows when another process holds the conversation (seen live, #408). */
const OTHER_APP_SCREEN = 'open in another app';

// ------------------------------------------------------------- the refusal

/** Words that name Codex's shared background server, loosely, as the ordinary tests read them. */
const SHARED_SERVER = /\b(?:shared|background)\b[^.]{0,40}\bserver\b|\bdaemon\b/i;

/** The refusal #408 asks for, read off what the kit printed and the status it exited with. */
function assertRefusedAsRestored(what, { status, said }) {
  const flat = said.replace(/\s+/g, ' ');
  assert.notEqual(status, '0', `${what} from a Codex brought back without the kit's line should be refused, and exited 0: ${flat}`);
  assert.match(flat, /\bCodex\b/, `${what}: it says the caller is a Codex the kit did not start, got: ${flat}`);
  assert.match(flat, SHARED_SERVER, `${what}: and names Codex's shared background server, got: ${flat}`);
  // The kit names itself by the path it was started by (#220): here this
  // checkout's CLI, never the bare `obk`.
  assert.ok(spellingsOf(cliEntry).some((cli) => flat.includes(`${cli} restart`)), `${what}: it names the kit's own CLI running restart, got: ${flat}`);
  assert.match(flat, /\banother app\b/i, `${what}: and the "open in another app" case, got: ${flat}`);
  assert.ok(flat.includes(DAEMON_STOP), `${what}: and Codex's own \`${DAEMON_STOP}\` as the way past it, got: ${flat}`);
  assert.match(flat, STOP_REACH, `${what}: and warns that the stop ends Codex's shared server for everything using it, got: ${flat}`);
  assert.match(flat, BEYOND_THE_KIT, `${what}: Codex sessions outside the kit, the owner's own, included, got: ${flat}`);
}

// ------------------------------------------------------------- the mailbox

/** How many of the newest messages on the machine the inbox is asked for. */
const INBOX_LIMIT = 100;

/**
 * Orca's inbox entries for one Run of this test's, as codex-nudge.test.js
 * reads them: everything else the inbox lists belongs to other people and is
 * dropped before anything can print it.
 */
function inboxOf(run) {
  assert.match(String(run), /^run_/, `the book should hold a Run, got: ${run}`);
  const asked = `orca orchestration inbox --json --limit ${INBOX_LIMIT}`;
  const done = spawnSync(ORCA, ['orchestration', 'inbox', '--json', '--limit', String(INBOX_LIMIT)], { encoding: 'utf8' });
  assert.equal(done.error, undefined, `could not run ${ORCA}: ${done.error?.code}`);
  let answer;
  try {
    answer = JSON.parse(done.stdout);
  } catch {
    assert.fail(`${asked} exited ${done.status} and did not answer JSON (not shown, as it may hold other people's mail)`);
  }
  assert.equal(answer?.ok, true, `${asked} was refused: error code ${JSON.stringify(answer?.error?.code ?? null)}`);
  const all = answer.result?.messages;
  assert.ok(Array.isArray(all), `the inbox should answer a list of messages, and answered ${all === undefined ? 'none' : typeof all}`);
  return all.filter((message) => message?.run_id === run).map(({ subject, body, read }) => ({ subject, body, read }));
}

// ------------------------------------------------------------- the bot

const BOT = { name: 'daemon-codex', display: 'Daemon Codex', codeword: 'OTTER-5092' };
const SESSIONS = ['first', 'second'];

/** What each session is told: inert, with a codeword, running only the commands it is handed. */
const startPrompt = [
  `You are a system test's bot and you own nothing. Your codeword is ${BOT.codeword}.`,
  'When anyone asks you for your codeword, give it in exactly the form they ask for, and nothing else.',
  'When you are asked to run commands, run exactly those commands, once each, in the order given, each exactly as written,',
  'and then reply DONE and nothing else. Otherwise run no command and read or write no file.',
  'If a line arrives saying fleet mail is waiting, ignore it.',
  'Say nothing now and wait.',
].join(' ');

/** How the bots here start the kit: this checkout's CLI by its full path, with the Node running this test. */
const KIT = `${shellWord(process.execPath)} ${shellWord(cliEntry)}`;

/** The two messages: the one that must be refused, and the one sent after the restart. Each word only here. */
const REFUSED = { subject: 'before the restart SUBJ-7141', body: 'MARTEN-2208' };
const SENT = { subject: 'after the restart SUBJ-3396', body: 'PLOVER-6517' };

/**
 * A command a bot is handed, and the two files it leaves in the bot's folder:
 * what the kit printed, both streams, and the status it exited with.
 */
const step = (home, name, command) => ({
  name,
  line: `${command} > ${shellWord(path.join(home, `${name}.out`))} 2>&1; echo $? > ${shellWord(path.join(home, `${name}.status`))}`,
  out: path.join(home, `${name}.out`),
  status: path.join(home, `${name}.status`),
});

/** What the kit printed for one step and the status it exited with, once both are written. */
function resultOf(one) {
  if (!existsSync(one.status)) return undefined;
  const status = readFileSync(one.status, 'utf8').trim();
  if (status === '') return undefined;
  return { status, said: existsSync(one.out) ? readFileSync(one.out, 'utf8') : '' };
}

/** The ORCA_TAB_ID and OBK_TAB_SHELL a command the session runs sees, written to `file` first. */
const callerLine = (file) => `printf 'ORCA_TAB_ID=%s\\nOBK_TAB_SHELL=%s\\n' "$ORCA_TAB_ID" "\${OBK_TAB_SHELL-}" > ${shellWord(file)}`;

/** Read back what `callerLine` wrote, once it is whole. */
function callerIn(file) {
  if (!existsSync(file)) return undefined;
  const text = readFileSync(file, 'utf8');
  const tab = /^ORCA_TAB_ID=(.*)$/m.exec(text)?.[1];
  const shell = /^OBK_TAB_SHELL=(.*)$/m.exec(text)?.[1];
  return tab === undefined || shell === undefined ? undefined : { tab, shell };
}

/** Hand `second` its commands in one line, and wait for each step's result. */
async function run(handle, steps, callerFile) {
  const lines = [callerLine(callerFile), ...steps.map((one) => one.line)];
  await askIn(handle, `Run exactly these commands, once each, in this order, each exactly as written: ${lines.map((line, n) => `(${n + 1}) ${line}`).join(' ')}`);
  const caller = await until(`the caller's variables in ${callerFile}`, ANSWER_MS, async () => callerIn(callerFile), () => whatIsUp(handle));
  const results = {};
  for (const one of steps) {
    results[one.name] = await until(`${one.name}'s status in ${one.status}`, ANSWER_MS, async () => resultOf(one), () => whatIsUp(handle));
  }
  return { caller, results };
}

/**
 * Wait for Codex to be up in a tab and ready, or for the other-app screen.
 * Answers 'ready' or 'other-app'; the shared server's error fails at once.
 */
async function codexUpIn(handle, what) {
  return until(
    `codex to be ready in ${what}`,
    READY_MS,
    async () => {
      const shown = screenOf(handle);
      if (shown.includes(SHARED_SERVER_ERROR)) assert.fail(`${what}: Codex could not use its shared background server.${whatIsUp(handle)}`);
      if (shown.includes(OTHER_APP_SCREEN)) return 'other-app';
      if (inFront(handle)?.name !== 'codex') return undefined;
      const idle = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '5000']);
      if (idle.ok !== true || idle.result?.wait?.blockedReason !== undefined) return undefined;
      return waitingOn(orca, handle) === undefined ? 'ready' : undefined;
    },
    () => whatIsUp(handle),
  );
}

test('a Codex session brought back without the kit\'s line is refused its tab-bound commands, with the reason, and after obk restart they work', async (t) => {
  // A managed server already running would take this test's resumes, and its
  // cleanup could not tell that server from one of its own (see the header).
  assert.deepEqual(
    processesWith(MANAGED_SERVER).map((one) => one.pid),
    [],
    'a managed Codex server (`codex app-server --managed-daemon`) is already running on this machine, so this test\'s bare resumes'
    + ' would join it under a tab this test did not make. Run it when none is running.',
  );
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-daemon-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', BOT.name].map(homeOf);
  const home = homeOf(BOT.name);

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    // Only this test's own tabs are closed. A tab it did not create at one of
    // its homes is not its to close: that project and the bots folder stay
    // where they are, and the test fails naming the tab (#426).
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
    // Orca's sidebar keeps a deleted project's row until its window is rebuilt (#343).
    if (deleted > 0 && !(await reloadWindow())) t.diagnostic(RELOAD_LINE);
    // Codex's shared server outlives the tabs it was started from (see the header).
    let serverTrouble;
    try {
      serverTrouble = await stopOurCodexServer(t, bots);
    } catch (error) {
      serverTrouble = [`could not look for Codex's shared server: ${error.message}`];
    }
    assert.deepEqual(foreign, [], `tabs this test did not create are open at its homes, so it closed only its own and left those projects and ${bots} in place`);
    await removeBotsFolderAndSiblings(bots);

    const { closedNotOurs, goneElsewhere } = guard.verdict(before.handles);
    assert.deepEqual(closedNotOurs, [], 'this test closed tabs it did not create');
    if (goneElsewhere.length > 0) t.diagnostic(`tabs open before this test and closed elsewhere meanwhile: ${goneElsewhere.join(', ')}`);
    for (const each of homes) {
      assert.deepEqual(await terminalsAfterClosing(each, closed), [], `this test left tabs behind in ${each}`);
    }
    assert.deepEqual(serverTrouble, [], 'Codex\'s shared server is not left running under this test\'s identity');
    assert.deepEqual(failedDeletes, [], 'projects this test could not remove, left in Orca');
  });

  obkJson(['init', '--bots', bots, '--harness', 'claude']);
  obkJson([
    'bot', 'create', '--bots', bots, '--name', BOT.name, '--harness', 'codex',
    '--charter', `${BOT.display} exists for one system test run and owns nothing.`,
  ]);
  for (const session of SESSIONS) {
    obkJson(['session', 'add', '--bots', bots, '--bot', BOT.name, '--name', session, `--prompt=${startPrompt}`, ...codexTrustArgs(bots)]);
  }

  // 0. The kit starts each session, its hook tells the book its id, and one
  // turn puts the conversation on Codex's own record for a resume to find.
  const tabs = {};
  const ids = {};
  for (const session of SESSIONS) {
    const entry = tabOf(obkJson(['up', '--bots', bots, '--bot', BOT.name, '--session', session]), session);
    assert.equal(entry.harnessStarted, true, `no codex came up in ${entry.title}: look at it with \`orca terminal read --terminal ${entry.terminal} --screen\``);
    tabs[session] = entry;
    ids[session] = await until(
      `${session} to report its session id`,
      READY_MS,
      async () => (await sessionIn(home, session)).session,
      () => ` The kit's hook has not run. A \`Hooks need review\` screen here means the launch-time trust did not take (#240).${whatIsUp(entry.terminal)}`,
    );
    await answers(entry.terminal, 'What is your codeword? Reply with the codeword in lower case and nothing else.', BOT.codeword.toLowerCase());
    const launched = inFront(entry.terminal);
    assert.equal(launched?.name, 'codex', `the premise: the kit's codex is in front of ${entry.title}, got: ${JSON.stringify(launched)}`);
    assert.ok(
      environmentWords(launched.pid).some((word) => word.startsWith('OBK_TAB_SHELL=')),
      `the premise: the codex the kit's launch line started carries OBK_TAB_SHELL (pid ${launched.pid})`,
    );
  }

  // 1. The stand-in for Orca's restore, first and then second: the kit's Codex
  // quits to the tab's shell, and the bare resume Orca types goes in, with no
  // --no-daemon and nothing of the kit's line.
  for (const session of SESSIONS) {
    const entry = tabs[session];
    await askIn(entry.terminal, '/quit');
    await until(`codex in ${entry.title} to quit to the tab's shell`, QUIT_MS, async () => (isShell(inFront(entry.terminal)?.name) ? true : undefined), () => whatIsUp(entry.terminal));
    // The bare resume, with the launch-time trust and nothing else of the kit's line (see the header).
    const trust = codexTrustArgs(bots).map((arg) => shellWord(arg.slice('--extra-arg='.length))).join(' ');
    const resume = `codex resume ${trust} ${ids[session]}`;
    typeInto(entry.terminal, resume);
    let restored = await until(
      `codex to be back in front of ${entry.title} after \`${resume}\``,
      READY_MS,
      async () => {
        if (screenOf(entry.terminal).includes(SHARED_SERVER_ERROR) && isShell(inFront(entry.terminal)?.name)) return 'failed';
        const front = inFront(entry.terminal);
        return front?.name === 'codex' ? front : undefined;
      },
      () => whatIsUp(entry.terminal),
    );
    if (restored === 'failed') {
      // Seen once in two tries on 0.157.1: typed once more.
      t.diagnostic(`${session}: the bare resume could not use the shared background server; typed once more`);
      typeInto(entry.terminal, resume);
      restored = await until(
        `codex to be back in front of ${entry.title} after a second \`${resume}\``,
        READY_MS,
        async () => {
          if (screenOf(entry.terminal).includes(SHARED_SERVER_ERROR) && isShell(inFront(entry.terminal)?.name)) {
            assert.fail(`${session}: a bare \`${resume}\` failed twice on the shared background server, so the restore cannot be staged here.${whatIsUp(entry.terminal)}`);
          }
          const front = inFront(entry.terminal);
          return front?.name === 'codex' ? front : undefined;
        },
        () => whatIsUp(entry.terminal),
      );
    }
    await readyForAQuestion(entry.terminal);

    // The premise: it sits where a restored Codex does, and runs as one.
    const words = environmentWords(restored.pid);
    assert.ok(words.includes(`ORCA_TAB_ID=${entry.tabId}`), `the premise: the resumed codex (pid ${restored.pid}) carries this tab's ORCA_TAB_ID`);
    assert.ok(!words.some((word) => word.startsWith('OBK_TAB_SHELL=')), `the premise: the resumed codex (pid ${restored.pid}) carries no OBK_TAB_SHELL`);
    assert.ok(!argvOf(restored.pid).includes('--no-daemon'), `the premise: the resumed codex (pid ${restored.pid}) runs without --no-daemon`);
  }

  // 2. Second is asked to run the tab-bound commands. Each is refused, with
  // the reason, and nothing is sent.
  const mailboxOfFirst = (await sessionIn(home, 'first')).mailbox;
  const refusedSteps = [
    step(home, 'send-refused', `${KIT} message send --bots ${shellWord(bots)} --to ${BOT.name}/first --subject ${shellWord(REFUSED.subject)} --text ${REFUSED.body}`),
    step(home, 'check-refused', `${KIT} message check --bots ${shellWord(bots)}`),
    step(home, 'check-own-refused', `${KIT} message check --bots ${shellWord(bots)} --bot ${BOT.name} --session second`),
  ];
  const before408 = await run(tabs.second.terminal, refusedSteps, path.join(home, 'caller-restored.txt'));

  // Whose tab second's commands ran under: see the header.
  const { caller } = before408;
  assert.equal(caller.shell, '', 'the premise: a command of a Codex brought back without the kit\'s line carries no OBK_TAB_SHELL; this one carries one, so this run shows nothing about #408');
  assert.ok(
    [tabs.first.tabId, tabs.second.tabId].includes(caller.tab),
    'the premise: second\'s commands run under one of this test\'s two tabs. They ran under another (not shown): a Codex shared server already running on this machine, started by a session outside this test, so this run shows nothing about the kit. Run it again when no such server is running.',
  );
  t.diagnostic(caller.tab === tabs.first.tabId
    ? 'second\'s commands ran under first\'s tab: the shared background server, as seen live'
    : 'second\'s commands ran under its own tab: the shared background server was not reproduced here; the refusal is still due');

  for (const one of refusedSteps) assertRefusedAsRestored(one.name, before408.results[one.name]);
  assert.deepEqual(
    inboxOf(mailboxOfFirst).filter((message) => String(message.body).includes(REFUSED.body)),
    [],
    'the refused send put nothing in first\'s mailbox',
  );

  // 3. The restart the refusal names, of the bot, both sessions.
  const restarted = obkJson(['restart', '--bots', bots, '--bot', BOT.name]);
  guard.closedByKit(restarted.closed);
  for (const session of SESSIONS) {
    tabs[session] = tabOf(restarted, session);
    assert.equal(tabs[session].created, true, `${session}: restart opened a new tab for it`);
  }
  const stuck = [];
  for (const session of SESSIONS) {
    if (await codexUpIn(tabs[session].terminal, `${session}'s new tab`) === 'other-app') stuck.push(session);
  }
  if (stuck.length > 0) {
    // The kit's advice: every Codex session is back on its line now, so stop
    // the shared server that still holds the conversation, then restart the
    // stuck session again. Only the test's own server is stopped.
    const running = processesWith(MANAGED_SERVER).length;
    t.diagnostic(
      `${stuck.join(', ')} came back at "${OTHER_APP_SCREEN}" after the bot's restart; following the kit's advice: ${DAEMON_STOP}, then restart ${stuck.join(', ')} again`
      + (running === 0 ? '. No managed Codex server is running, so there is nothing to stop.' : ''),
    );
    assert.deepEqual(await stopOurCodexServer(t, bots), [], `before the stop the kit advises for "${OTHER_APP_SCREEN}"`);
    for (const session of stuck) {
      const again = obkJson(['restart', '--bots', bots, '--bot', BOT.name, '--session', session]);
      guard.closedByKit(again.closed);
      tabs[session] = tabOf(again, session);
      assert.equal(
        await codexUpIn(tabs[session].terminal, `${session}'s tab after ${DAEMON_STOP}`),
        'ready',
        `${session} is still at "${OTHER_APP_SCREEN}" after both sessions were restarted, ${DAEMON_STOP}, and its restart again: the kit's advice does not bring it back.${whatIsUp(tabs[session].terminal)}`,
      );
    }
  }
  for (const session of SESSIONS) {
    const front = inFront(tabs[session].terminal);
    assert.equal(front?.name, 'codex', `${session}: codex is in front of its new tab, got: ${JSON.stringify(front)}`);
    assert.ok(environmentWords(front.pid).some((word) => word.startsWith('OBK_TAB_SHELL=')), `${session}: the restarted codex carries OBK_TAB_SHELL`);
    assert.ok(argvOf(front.pid).includes('--no-daemon'), `${session}: and runs with --no-daemon`);
  }

  // 4. The same commands from second, now on the kit's line, work.
  const workingSteps = [
    step(home, 'send-after', `${KIT} message send --bots ${shellWord(bots)} --to ${BOT.name}/first --subject ${shellWord(SENT.subject)} --text ${SENT.body}`),
    step(home, 'check-after', `${KIT} message check --bots ${shellWord(bots)}`),
  ];
  const after408 = await run(tabs.second.terminal, workingSteps, path.join(home, 'caller-restarted.txt'));
  assert.equal(after408.caller.tab, tabs.second.tabId, 'after the restart second\'s commands run under its own tab');
  assert.notEqual(after408.caller.shell, '', 'and carry OBK_TAB_SHELL');
  for (const one of workingSteps) {
    const { status, said } = after408.results[one.name];
    assert.equal(status, '0', `${one.name} works from the Codex the kit started, got: ${said}`);
  }
  const inbox = inboxOf((await sessionIn(home, 'first')).mailbox);
  assert.equal(inbox.filter((message) => String(message.body).includes(SENT.body)).length, 1, `first's mailbox holds the message sent after the restart, got: ${JSON.stringify(inbox)}`);
  assert.deepEqual(inbox.filter((message) => String(message.body).includes(REFUSED.body)), [], 'and still not the refused one');
});
