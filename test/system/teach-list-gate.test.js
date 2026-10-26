// A system test: the kit types nothing into a tab that shows Claude Code
// 2.1.289's "Teach auto mode about your environment?" list above its input box
// (#491, the issue's live check). Against the real Orca on this machine. Run it
// alone with `npm run test:system -- --yes test/system/teach-list-gate.test.js`;
// `npm test` cannot, and no CI machine could.
//
// The list (helpers/screens.js CLAUDE_TEACH_LIST, captured in #489's live run)
// sits above the input box, and the box's own empty `❯` is the lowest pointer
// row on the screen. A return typed into it confirms "1. Yes" and starts auto
// mode's teach scan. Any key into a real one writes a choice into the owner's
// ~/.claude.json for the whole machine, which a system test may not do (#240).
// So this test sends a real list no key. It stages a copy instead, in tabs of
// its own that never show a real one, and checks what the kit does there. It
// has two stages, each in a fresh tab of its own Claude Code session:
//
//   1. A throwaway fleet: a bot on Claude Code with three sessions. `target`
//      and `listed` are Claude Code at `ask` (`--permission-mode manual`), not
//      in auto mode, because Claude Code puts the Teach list up in auto mode
//      (worked out from #489's run, not proven for 2.1.289); the start prompt
//      of each asks for one short reply. `target` holds the presence stage
//      (step 6) and `listed` the list stage (step 7). `sender` is Codex, so
//      mail from it goes through Orca, where the kit carries the letter and the
//      Escape of `--interrupt`, and not by Claude Code's own messaging (PRD
//      6.9, ADR 0053). Its trust comes at launch (#240, helpers/codex-trust.js);
//      only its mailbox, which its launch line makes, is used.
//   2. Each Claude session comes up in its own tab, and its folder trust is
//      answered by this test, down and return, only when it is the plain one
//      for the bot home, or the one that pre-approves exactly the kit's
//      default rules (helpers/claude-trust.js `claudeTrustAt`, the rulings on
//      #451 and #558), as temp-answer does. The second session in the same
//      bot home can get no trust screen at all; then nothing is answered.
//   3. Should a real Teach list or form come up all the same, the test types
//      nothing into it, records its rows and ends there as skipped. The
//      teardown closes the tab.
//   4. The session quits with /exit, typed only at its plain input line, and
//      the shell comes to the front.
//   5. The test runs a small node program of its own in that tab, on the tab's
//      terminal: it clears the screen, draws the rows it is given, writes
//      every byte it reads to a file, and ends only when a stop file the test
//      writes appears (or after ten minutes). It takes no key as an answer. It
//      is started through a link named `claude` beside the bots folder, to the
//      node that runs this test, and with `OBK_TAB_SHELL=$$`, the kit's mark
//      for the program the tab's shell started (#261). That is the premise of
//      the whole run: the kit's gate types into the staged tab when no
//      question is on it. Orca names an agent in a tab from, among other
//      things, the process in front (tech notes, section 1); whether it names
//      `claude` for this program is checked, not assumed.
//   6. The presence, in `target`'s tab: staged, the capture with the list
//      taken out (CLAUDE_TEACH_LIST_GONE). Since #555 the kit types no mail
//      line; the one key mail types is the Escape of `message send
//      --interrupt`, through the same gate as the skills reload. Both pass the
//      gate: the send reports no trouble, and either it pressed Escape (the
//      program reads one Escape and nothing else of the kit's) or Orca called
//      the program idle and the kit typed nothing, as `--interrupt` wants.
//      The program reads `/reload-skills`. Then the program stops, and the
//      shell is in front of `target`'s tab.
//   7. The check, in `listed`'s tab, which steps 2 to 5 bring up only now:
//      staged, the captured list (CLAUDE_TEACH_LIST). The send to `listed`
//      with `--interrupt` is not interrupted and names `question-on-screen`,
//      and a skills reload is reported blocked on `question-on-screen` for
//      `listed`; the program read not one byte from the kit, and the list is
//      still drawn. The system tests' own look, `waitingOn`, sees the live
//      list too.
//
// Orca's own notice can also reach the staging program (#561). Each send puts
// a letter in the receiver's Orca mailbox, and Orca types its notice into the
// receiver's tab when it calls the agent there idle. Orca gives no notice to
// a Claude tab it lists as orphaned (tech notes, "Mailbox"). Seen in a probe
// of 2026-10-18 (Orca 1.4.225; the cause is not known): in a throwaway bots
// folder, the tabs of the newest Orca project are listed orphaned, and a
// Claude tab turned real, and got Orca's notice, once a newer project was
// made. `target` and `listed` are in gate-bot's project, the newest one here,
// so most likely they get no notice today. But one run of that probe had a
// real Claude tab in the newest project, which is not explained, so a notice
// can land in `target`'s or `listed`'s program after the send. So the checks of
// what the program read take Orca's notice for that receiver's own mailbox
// out first (`orcaNoticesOnly`), and judge the rest as before. The notice's
// words are known from Claude Code's transcript; the bytes Orca frames them
// with in the pty are not, so the check passes any mix of returns, new lines
// and `ESC [` sequences around the words, and nothing else: no bare Escape,
// and no other text. A notice is not judged here, whether it comes or not;
// the program's bytes are printed, with the tab's `tabId` and `orphaned`.
//
// Why a fresh tab for each stage (#560): on Orca 1.4.224 the stage that ran
// second in the same tab got no agent name from Orca in 3 of 4 runs, so no kit
// check ran in it. The stage that ran first got the name in 4 of 4 runs: the
// presence stage three times and the list stage once. Each time it ran right
// after a real Claude Code had its first turn in that tab and quit.
// Worked out from Orca 1.4.225's bundle, not proven live: Orca's pty daemon
// checks that a process named `claude` really is Claude Code, and keeps for
// each tab the last agent it verified. The first staged program seems to get
// the record the real Claude Code left; a second one in the same tab does not,
// and Orca names no agent. So each stage gets the condition that passes.
//
// The order keeps the kit from typing into a real harness. `skills build`
// types `/reload-skills` into each of the bot's sessions that its gate lets
// through. During step 6's build `listed` is not up, so no real Claude Code
// runs in a second tab. During step 7's build the shell is in front of
// `target`'s tab, and the gate types into no shell.
//
// What it cannot show: what Claude Code's own list does with a key; this test
// sends a real one none. What it does show: the kit reads the live screen as
// Orca renders it, sees the list above the input box there, and types nothing,
// where its gate let both through in the same kind of tab a moment before.
//
// The machine it runs on is someone's working machine. So this test, like the
// ones beside it: works in a throwaway bots folder under the system temp
// directory, its staging program, its link and its files beside it; writes
// down every terminal and workspace Orca already had; runs this checkout's
// `src/cli.js` by its full path, never the machine's `obk` (#220); types only
// into the tabs of `target` and `listed`, its own: the folder trust's answer,
// /exit, and the lines that start the staging program; closes only its own
// tabs, through the tab guard, and deletes its own workspaces, whatever
// happened; signals no process, and reads `ps` for one pid at a time. `orca
// terminal close --worktree … --all` is never run, and the guard refuses it.
// This test does not read or write ~/.claude.json; Claude Code records the
// folder's trust in it, and the runner takes that key out again (#240).
//
// One thing it cannot clean up, as messaging.test.js says of itself: the Run
// mailboxes. Orca has no `run-delete`, so each run leaves the Runs `up` made
// behind, holding the two messages this test sent, one to each Claude session.
//
// **It is attended, lightly.** Bot Father's tab shows Claude Code's folder
// trust; nothing here waits on it, so leave it. `sender`'s Codex may offer an
// update; nothing here waits on it either. It takes a few minutes.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry, shellWord } from '../helpers/cli.js';
import { codexTrustArgs } from '../helpers/codex-trust.js';
import {
  CLAUDE_TEACH_LIST,
  CLAUDE_TEACH_LIST_GONE,
  questionOn,
  waitingOn,
} from '../helpers/screens.js';
import { claudeTrustAt, trustScreenMet } from '../helpers/claude-trust.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { deleteOwnProject } from '../helpers/own-project.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/**
 * Remove the throwaway bots folder and everything the kit or this test made
 * beside it: `<bots>.prompts`, `<bots>.locks`, this test's staging program,
 * its link and its files are siblings of it (PRD 6.3).
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

/** How long a tab is given to show its next screen. */
const READY_MS = 180000;

/** How long a real harness is given for its turn. */
const ANSWER_MS = 240000;

/** How long after a Claude session's reply the test looks for a real Teach list or form. */
const TEACH_WATCH_MS = 30000;

/** How long a screen is given to move on, a program to come to the front, or a line to reach the staging program. */
const MOVE_MS = 30000;

/** How long the kit's own hook and launch line are given to write the book. */
const HOOK_MS = 60000;

/** How long after a refusal the tab is watched for a byte that should not come. */
const SETTLE_MS = 5000;

const BOT = 'gate-bot';
const TARGET = 'target';
const LISTED = 'listed';
const SENDER = 'sender';

/** The kit's word for a tab whose screen shows a harness's own question. */
const QUESTION = 'question-on-screen';

/** In the start prompt of target and listed only: the first turn prints it. */
const READY_WORD = 'READY-4917';

/** The start prompt of target and listed: one short reply, so each has a first turn, and nothing else. */
const TASK = 'You are a system test\'s session and you own nothing. Do not run any command, read or write any file,'
  + ` or use any tool. Reply now with ${READY_WORD} and nothing else, then wait.`;

/** sender's start prompt: nothing to do. */
const SENDER_TASK = 'You are a system test\'s session and you own nothing. Do not run any command, read or write any file,'
  + ' or use any tool. Say nothing and wait.';

/** The words only each message's subject carries. */
const SUBJECT_IDLE = 'OSPREY-4917';
const SUBJECT_LIST = 'HERON-4917';

/** The title row of either Teach screen, as captured. */
const TEACH_TITLE = 'Teach auto mode about your environment?';

/**
 * The staging program: `<link> stage.mjs <rows file> <keys file> <stop file>`.
 * It draws the rows on a cleared screen and writes every byte it reads to the
 * keys file, which it starts empty. No key ends it or moves anything: it ends
 * when the stop file appears ("STAGE-STOPPED"), and after ten minutes.
 * Written with no backtick and no template, so it can sit in String.raw as it
 * is.
 */
const STAGE = String.raw`import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const [rowsFile, keysFile, stopFile] = process.argv.slice(2);
const rows = JSON.parse(readFileSync(rowsFile, 'utf8'));
writeFileSync(keysFile, '');
const draw = (lines) => process.stdout.write('\x1b[2J\x1b[H' + lines.join('\r\n') + '\r\n');
let watch;
const end = (code) => {
  clearInterval(watch);
  process.stdin.setRawMode(false);
  process.exit(code);
};
draw(rows);
watch = setInterval(() => { if (existsSync(stopFile)) { draw(['STAGE-STOPPED']); end(0); } }, 250);
setTimeout(() => { draw(['STAGE-TIMED-OUT']); end(1); }, 600000);
process.stdin.setRawMode(true);
process.stdin.on('data', (chunk) => appendFileSync(keysFile, chunk));
process.stdin.resume();
`;

/** Every close goes through the guard, which counts it for the check at the end (#246). */
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

/** The tabs Orca lists at `home` once it has caught up with what was closed (#187). */
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
 * The environment of wherever this test was started, without anything that
 * names an Orca tab or the kit's launch line: the test may itself run in an
 * Orca tab, and a command of the kit's must not take that tab for its caller.
 */
const outsideAnyTab = Object.fromEntries(Object.entries(process.env)
  .filter(([name]) => !name.startsWith('ORCA_') && name !== 'OBK_CLI' && name !== 'OBK_TAB_SHELL'));

/** Run this checkout's `obk`, by its full path (#217, #220), outside any tab. */
function obk(args) {
  const done = spawnSync(process.execPath, [cliEntry, ...args], { encoding: 'utf8', cwd: os.tmpdir(), env: outsideAnyTab });
  assert.equal(done.error, undefined, `could not run \`obk\`: ${done.error?.message}`);
  assert.ok(!/worktree/i.test(done.stdout + done.stderr), `obk said "worktree": ${done.stdout}${done.stderr}`);
  return done;
}

/** Run `obk ... --json` and read the answer it printed; every tab it says it opened is counted as this test's. */
function obkJson(args) {
  const done = obk([...args, '--json']);
  assert.equal(done.status, 0, `obk ${args.join(' ')} failed: ${done.stdout}${done.stderr}`);
  try {
    return guard.openedByKit(JSON.parse(done.stdout));
  } catch {
    assert.fail(`obk ${args.join(' ')} --json did not print JSON: ${done.stdout}`);
  }
}

/** The one tab an `obk --json` answer says it opened. */
function openedIn(answer, what) {
  const found = (answer.tabs ?? []).filter((entry) => entry.created === true);
  assert.equal(found.length, 1, `${what} should have opened one tab, got: ${JSON.stringify(answer.tabs)}`);
  return found[0];
}

/** The bot's book as it stands. */
const bookOf = (home) => parse(readFileSync(path.join(home, 'sessions.yaml'), 'utf8')) ?? {};

/** What the book says about one of the bot's sessions right now. */
const sessionIn = (home, name) => bookOf(home).sessions?.[name] ?? {};

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

/** The rows the tab renders right now, or undefined when Orca gives no rendered screen. */
function rowsOf(handle) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  const shown = answer.ok === true ? answer.result?.terminal : undefined;
  return shown?.source === 'screen' && Array.isArray(shown.tail) ? shown.tail : undefined;
}

/** Whether the tab shows a Teach title row right now. */
const showsTeach = (rows) => (rows ?? []).some((row) => row.trim() === TEACH_TITLE);

/** The agent Orca names in a tab right now, or undefined. */
function agentIn(handle) {
  const answer = orca(['terminal', 'show', '--terminal', handle]);
  const agent = answer.ok === true ? answer.result?.terminal?.agentIdentity : undefined;
  return typeof agent === 'string' && agent !== '' ? agent : undefined;
}

/** What the tab is showing, for the message of a wait that ran out. */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  return `${blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`}`
    + ` Orca names ${agentIn(handle) ?? 'no agent'} in it.`
    + `\n  orca terminal read --terminal ${handle} --screen\n  ${(rowsOf(handle) ?? ['(no rendered screen)']).join('\n  ')}`;
}

/** Send keys into the test's own tab exactly as given, with no `--enter`. */
function sendKeys(handle, keys) {
  const sent = orca(['terminal', 'send', '--terminal', handle, '--text', keys]);
  assert.equal(sent.ok, true, `sending ${JSON.stringify(keys)} into ${handle} failed: ${JSON.stringify(sent.error)}.${whatIsUp(handle)}`);
}

/** The request id an `agent_prompt_blocked` carries, read out of the whole error. */
function requestIdIn(error) {
  const found = /"orchestrationRequestId"\s*:\s*"([^"]+)"/.exec(JSON.stringify(error ?? null));
  return found === null ? undefined : found[1];
}

/**
 * Send one line into this test's own tab, with `--enter`. A gated line fails
 * with the screen and the id rather than retrying (see
 * `session-identity.test.js`).
 */
function sendLine(handle, text) {
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

/** A row of Claude Code's input box's rules: nothing but `─`, a name set into it aside. */
const RULE_ROW = /^\s*─{8,}/;

/**
 * The input line of a Claude tab at its plain input prompt, or why it is not
 * at one: the screen can be read, shows no Teach title and no question, form
 * or menu (helpers/screens.js, `questionOn`), and its lowest `❯` row is the
 * input line, between the input box's two rules.
 */
function promptOf(handle) {
  const rows = rowsOf(handle);
  if (rows === undefined) return { why: 'its screen could not be read' };
  const screen = `\n    ${rows.join('\n    ')}`;
  if (showsTeach(rows)) return { why: `a Teach auto mode list or form is up:${screen}` };
  if (questionOn(rows) !== undefined) return { why: `a question, form or menu is up:${screen}` };
  const at = rows.findLastIndex((row) => row.trimStart().startsWith('❯'));
  if (at < 0) return { why: `no input line is on it:${screen}` };
  if (!RULE_ROW.test(rows[at - 1] ?? '') || !RULE_ROW.test(rows[at + 1] ?? '')) {
    return { why: `its lowest ❯ row is not the input line between the input box's rules:${screen}` };
  }
  return { line: rows[at], rows };
}

/** Read `ps` for one pid, and nothing else: it is a reader here and never a road to a signal. */
function psOf(pid, columns) {
  assert.match(String(pid), /^[1-9]\d*$/, `ps is asked about one positive pid, got: ${pid}`);
  const done = spawnSync('ps', [...columns, '-p', String(pid)], { encoding: 'utf8' });
  return done.status === 0 ? done.stdout.trim() : undefined;
}

/**
 * The process in front of a tab's terminal, the way the kit finds it (tech
 * notes, section 1): the tab's pty id, the pane's pid from `orca diagnostics
 * memory`, and the pane's terminal foreground group from `ps`. Undefined when
 * any of it cannot be read.
 */
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
  if (comm === undefined) return undefined;
  return { pid: group, name: path.basename(comm.replace(/^-/, '')) };
}

/** Whether a command name is a shell's. */
const isShell = (name) => ['zsh', 'bash', 'sh', 'fish', 'ksh', 'tcsh', 'dash'].includes(name);

/** Wait until a shell leads the tab's foreground group. */
const shellInFront = (handle) => until(
  `a shell to be in front of ${handle}`,
  MOVE_MS,
  async () => {
    const front = inFront(handle);
    return front !== undefined && isShell(front.name) ? front : undefined;
  },
  () => ` In front now: ${JSON.stringify(inFront(handle) ?? null)}.${whatIsUp(handle)}`,
);

/**
 * Whether `rendered`, the rows Orca gives for the tab, show every non-blank
 * row of `staged` as it was drawn, in order: a tab too narrow wraps a row, and
 * then the screen is not the capture.
 */
function drawnAsStaged(rendered, staged) {
  const shown = (rendered ?? []).map((row) => row.trimEnd());
  let from = 0;
  for (const row of staged.map((one) => one.trimEnd()).filter((one) => one !== '')) {
    const at = shown.indexOf(row, from);
    if (at < 0) return false;
    from = at + 1;
  }
  return true;
}

/**
 * Whether the bytes a staging program read are Orca's own notices for
 * `mailbox` and nothing else (#561; the header says why). The empty string is,
 * since it holds nothing that is not Orca's. The notice's words are as Claude
 * Code's transcript showed them on 2026-10-18: "You have 1 orchestration
 * message. Run `orca orchestration check --run run_<id>`." Orca's framing of
 * them in the pty is not known, so around them only a return, a new line or
 * an `ESC [` sequence (such as bracketed paste's `ESC [200~`) passes, and
 * only with at least one notice for this mailbox among them. A bare Escape,
 * `/reload-skills`, a mail line or any other text is not Orca's notice, so a
 * key from the kit makes this false. Bytes still arriving make it false until
 * the notice is whole; a check waits for it rather than look once.
 */
function orcaNoticesOnly(read, mailbox) {
  assert.match(String(mailbox), /^run_\w+$/, `the premise: the receiver's mailbox is an Orca Run, got: ${mailbox}`);
  const notice = new RegExp(`You have \\d+ orchestration messages?\\.\\s+Run \`orca orchestration check --run ${mailbox}\`\\.?`, 'y');
  const frame = /\x1b\[[0-?]*[ -/]*[@-~]|[\r\n]/y;
  let at = 0;
  let notices = 0;
  while (at < read.length) {
    notice.lastIndex = at;
    frame.lastIndex = at;
    if (notice.test(read)) {
      notices += 1;
      at = notice.lastIndex;
    } else if (frame.test(read)) {
      at = frame.lastIndex;
    } else {
      return false;
    }
  }
  return read === '' || notices > 0;
}

/** One tab's `tabId` and `orphaned` in Orca's listing right now, for a diagnostic: Orca gives an orphaned Claude tab no notice. */
function listingOf(handle) {
  const found = allTerminals().find((terminal) => terminal.handle === handle);
  return found === undefined ? { listed: false } : { tabId: found.tabId, orphaned: found.orphaned };
}

/** `obk skills build` for the bot, `--json`: what it says of the session `name`. */
function buildFor(bots, name) {
  const answer = obkJson(['skills', 'build', '--bots', bots, '--bot', BOT]);
  const entry = (answer.skills ?? []).find((one) => one.bot === BOT);
  assert.ok(Array.isArray(entry?.sessions), `${BOT}'s links changed, so its sessions are reported, got: ${JSON.stringify(answer)}`);
  const said = entry.sessions.find((one) => one.session === name);
  assert.ok(said !== undefined, `the build says something of ${name}, got: ${JSON.stringify(entry.sessions)}`);
  return said;
}

test('the kit types no mail interrupt and no skills reload into a tab showing Claude Code 2.1.289\'s Teach list above its input box, and its gate lets both through in a tab like it with the list gone', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-teach-gate-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', BOT].map(homeOf);
  const home = homeOf(BOT);
  const stage = `${bots}.stage.mjs`;
  const linkDir = `${bots}.stage-bin`;
  const link = path.join(linkDir, 'claude');
  const rowsFile = `${bots}.stage-rows.json`;
  const keysFile = `${bots}.stage-keys`;
  const stopFile = `${bots}.stage-stop`;

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    // A staging program still up ends on its own stop file before its tab goes.
    try {
      writeFileSync(stopFile, '');
    } catch {
      // The bots folder's parent is the system temp folder; nothing to stop if it cannot be written.
    }
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
    // Orca's sidebar keeps a deleted project's row until its window is rebuilt (#343).
    if (deleted > 0 && !(await reloadWindow())) t.diagnostic(RELOAD_LINE);
    assert.deepEqual(foreign, [], `tabs this test did not create are open at its homes, so it closed only its own and left those projects and ${bots} in place`);
    await removeBotsFolderAndSiblings(bots);

    const { closedNotOurs, goneElsewhere } = guard.verdict(before.handles);
    assert.deepEqual(closedNotOurs, [], 'this test closed tabs it did not create');
    if (goneElsewhere.length > 0) t.diagnostic(`tabs open before this test and closed elsewhere meanwhile: ${goneElsewhere.join(', ')}`);
    for (const each of homes) {
      assert.deepEqual(await terminalsAfterClosing(each, closed), [], `this test left tabs behind in ${each}`);
    }
    assert.deepEqual(failedDeletes, [], 'projects this test could not remove, left in Orca');
  });

  // ---------------------------------------------------------------------------
  // 1. The fleet: Bot Father, and gate-bot on Claude Code with target and
  // listed at `ask` and sender on Codex.
  obkJson(['init', '--bots', bots, '--harness', 'claude']);
  obkJson([
    'bot', 'create', '--bots', bots, '--name', BOT, '--harness', 'claude',
    '--charter', `${BOT} exists for one system test run and owns nothing.`,
  ]);
  obkJson(['session', 'add', '--bots', bots, '--bot', BOT, '--name', TARGET, `--prompt=${TASK}`]);
  // #527: a session's approval is set by `obk permission approval`, not by session add.
  obkJson(['permission', 'approval', '--bots', bots, '--bot', BOT, '--session', TARGET, '--approval', 'ask']);
  obkJson(['session', 'add', '--bots', bots, '--bot', BOT, '--name', LISTED, `--prompt=${TASK}`]);
  obkJson(['permission', 'approval', '--bots', bots, '--bot', BOT, '--session', LISTED, '--approval', 'ask']);
  obkJson(['session', 'add', '--bots', bots, '--bot', BOT, '--name', SENDER, '--harness', 'codex', `--prompt=${SENDER_TASK}`, ...codexTrustArgs(bots)]);

  // ---------------------------------------------------------------------------
  // 2 and 3. A Claude session up in a fresh tab of its own, to its first turn.
  // It gives the tab's handle, or undefined when a real Teach list or form
  // came up: then the test is skipped.
  const firstTurn = async (name) => {
    const handle = openedIn(obkJson(['up', '--bots', bots, '--bot', BOT, '--session', name]), `up of ${name}`).terminal;

    // Its folder trust, which this test answers itself, once, and only when it
    // is the plain one for the bot home (the ruling on #451). The second
    // session in the same bot home can get none.
    const asked = await until(
      `${name} to show Claude Code's folder trust, or its reply`,
      READY_MS,
      async () => {
        const rows = rowsOf(handle) ?? [];
        if (rows.some((row) => row.trimStart().startsWith('⏺') && row.includes(READY_WORD))) return { rows: null };
        return rows.some((row) => row.includes('Yes, I trust this folder')) ? { rows } : undefined;
      },
      () => whatIsUp(handle),
    );
    if (asked.rows !== null) {
      const wrong = claudeTrustAt(asked.rows, home, bots, cliEntry);
      assert.equal(
        wrong,
        undefined,
        `${name}'s folder trust is not one this test may answer, so it answered nothing: ${wrong}.`
        + `\n  what it showed:\n    ${asked.rows.join('\n    ')}`,
      );
      sendKeys(handle, '\x1b[B\r');
      t.diagnostic(`answered ${name}'s ${trustScreenMet(asked.rows)} (the ruling on #451)`);
    } else {
      t.diagnostic(`${name} showed no folder trust before its reply, so nothing was answered`);
    }

    // Its reply to the start prompt: the first turn done.
    await until(
      `${name} to reply ${READY_WORD}`,
      ANSWER_MS,
      async () => ((rowsOf(handle) ?? []).some((row) => row.trimStart().startsWith('⏺') && row.includes(READY_WORD)) ? true : undefined),
      () => whatIsUp(handle),
    );

    // A real Teach list or form, should Claude Code put one up all the same:
    // no key into it. Recorded, and left to the teardown.
    const watchUntil = Date.now() + TEACH_WATCH_MS;
    let real;
    while (real === undefined && Date.now() < watchUntil) {
      const rows = rowsOf(handle);
      if (showsTeach(rows)) real = rows;
      else await setTimeout(1000);
    }
    if (real !== undefined) {
      t.diagnostic(`a real Teach list or form came up in ${name}'s tab at approval ask, left unanswered; what it showed:\n    ${real.join('\n    ')}`);
      t.skip(`a real Teach list or form is up in ${name}'s tab and this test sends it no key, so the staged check in that tab cannot run: this run proves nothing about #491. Run it again once Claude Code no longer puts it up at ask.`);
      return undefined;
    }
    t.diagnostic(`Claude Code put up no Teach list or form in ${name}'s tab at approval ask within ${TEACH_WATCH_MS} ms of its first turn`);
    return handle;
  };

  // 4. The session quits, typed only at its plain input line; a Teach screen
  // that came up late is left alone as in step 3. It gives false when one did:
  // then the test is skipped.
  const quit = async (name, handle) => {
    const atPrompt = await until(
      `${name} to be at its plain input line`,
      MOVE_MS,
      async () => {
        const at = promptOf(handle);
        if (at.why === undefined) return at;
        return showsTeach(rowsOf(handle)) ? { teach: rowsOf(handle) } : undefined;
      },
      () => ` ${promptOf(handle).why ?? ''}`,
    );
    if (atPrompt.teach !== undefined) {
      t.diagnostic(`a real Teach list or form came up late in ${name}'s tab, left unanswered; what it showed:\n    ${atPrompt.teach.join('\n    ')}`);
      t.skip(`a real Teach list or form is up in ${name}'s tab and this test sends it no key: this run proves nothing about #491.`);
      return false;
    }
    const still = promptOf(handle);
    assert.equal(still.why, undefined, `this test would type /exit into ${handle}, but ${still.why}\n  Nothing was typed.`);
    sendLine(handle, '/exit');
    await shellInFront(handle);
    return true;
  };

  // ---------------------------------------------------------------------------
  // target's tab, for the presence. listed stays down until the presence is
  // done (see the header).
  const handle = await firstTurn(TARGET);
  if (handle === undefined) return;

  // sender's mailbox, which its launch line makes before its Codex starts.
  // Nothing here waits on its Codex or types into it.
  openedIn(obkJson(['up', '--bots', bots, '--bot', BOT, '--session', SENDER]), `up of ${SENDER}`);
  await until(
    `${SENDER} to have its mailbox`,
    HOOK_MS,
    async () => (/^run_/.test(String(sessionIn(home, SENDER).mailbox)) ? true : undefined),
    () => ` The book's entry: ${JSON.stringify(sessionIn(home, SENDER))}.`,
  );

  if (!(await quit(TARGET, handle))) return;

  // ---------------------------------------------------------------------------
  // 5. The staging program, through a link named `claude`, with the kit's mark.
  await writeFile(stage, STAGE);
  await mkdir(linkDir, { recursive: true });
  await symlink(process.execPath, link);
  const keysRead = () => (existsSync(keysFile) ? readFileSync(keysFile, 'latin1') : undefined);
  const startStage = async (tab, name, rows, what) => {
    await rm(stopFile, { force: true });
    await rm(keysFile, { force: true });
    await writeFile(rowsFile, JSON.stringify(rows));
    sendLine(tab, `OBK_TAB_SHELL=$$ ${shellWord(link)} ${shellWord(stage)} ${shellWord(rowsFile)} ${shellWord(keysFile)} ${shellWord(stopFile)}`);
    await until(`${what} to be drawn in ${name}'s tab, every row as staged`, MOVE_MS, async () => (
      keysRead() !== undefined && drawnAsStaged(rowsOf(tab), rows) ? true : undefined
    ), () => ` A tab narrower than the capture's 120 columns wraps its rows.${whatIsUp(tab)}`);
    const front = await until(`the staging program to be in front of ${name}'s tab`, MOVE_MS, async () => {
      const now = inFront(tab);
      return now !== undefined && !isShell(now.name) ? now : undefined;
    }, () => whatIsUp(tab));
    // The premise of every check here: Orca names an agent in the staged tab.
    // Without one the kit's gate types nothing anywhere, list or no list.
    const agent = await until(`Orca to name an agent in ${name}'s staged tab`, MOVE_MS, async () => agentIn(tab), () => (
      ` The kit's gate types into no tab where Orca names no agent, so this run cannot show what the list does.${whatIsUp(tab)}`
    ));
    t.diagnostic(`${what}: ${front.name} (pid ${front.pid}) in front of ${name}'s tab, Orca names ${agent}`);
  };
  const stopStage = async (tab) => {
    await writeFile(stopFile, '');
    await shellInFront(tab);
  };

  // ---------------------------------------------------------------------------
  // 6. The presence, in target's tab: the capture with the list taken out. The
  // gate lets the interrupt and the skills reload through.
  await startStage(handle, TARGET, CLAUDE_TEACH_LIST_GONE, 'the staged capture with the list taken out');
  assert.equal(waitingOn(orca, handle), undefined, 'the premise: the system tests\' own look sees nothing in the way on the staged screen with the list gone');

  const idleSent = obkJson([
    'message', 'send', '--bots', bots, '--to', `${BOT}/${TARGET}`, '--from', `${BOT}/${SENDER}`,
    '--subject', `the typing gate ${SUBJECT_IDLE}`, '--text', 'Nothing to do; this only checks the typing gate.', '--interrupt',
  ]);
  t.diagnostic(`the send --interrupt on the screen with the list gone: ${JSON.stringify({ transport: idleSent.transport, interrupted: idleSent.interrupted, idle: idleSent.idle, interruptTrouble: idleSent.interruptTrouble })}`);
  assert.equal(idleSent.sent, true, `the message is in the mailbox: ${JSON.stringify(idleSent)}`);
  assert.equal(idleSent.transport, 'orca', `through Orca, where the kit carries the letter and its --interrupt: ${JSON.stringify(idleSent)}`);
  assert.equal(idleSent.interruptTrouble, undefined, `the premise: with no question on the staged screen the kit's gate lets the interrupt through, got: ${JSON.stringify(idleSent)}`);
  // Orca's notice for target's letter can follow in the program's bytes
  // (#561). The kit presses its Escape before it posts the letter
  // (src/message.js), so the notice can only come after the Escape: the kit's
  // part is the first byte, and the rest is Orca's notice or nothing. Not
  // drained: target's mailbox is empty until the send posts the letter, and a
  // drain after the send races Orca's notice, which comes about 2 s after it.
  const targetMailbox = sessionIn(home, TARGET).mailbox;
  if (idleSent.interrupted === true) {
    await until('one Escape, and nothing else but Orca\'s notice, to reach the staging program', MOVE_MS, async () => {
      const read = keysRead() ?? '';
      return read.startsWith('\x1b') && orcaNoticesOnly(read.slice(1), targetMailbox) ? true : undefined;
    }, () => ` It read: ${JSON.stringify(keysRead())}; Orca's notice for ${targetMailbox} is the only other thing it may read.`);
  } else {
    assert.equal(idleSent.idle, true, `not interrupted with no trouble only when Orca called the staged program idle, got: ${JSON.stringify(idleSent)}`);
    await until('the staging program to read nothing from the kit, in a receiver Orca calls idle', MOVE_MS, async () => {
      const read = keysRead();
      return read !== undefined && orcaNoticesOnly(read, targetMailbox) ? true : undefined;
    }, () => ` It read: ${JSON.stringify(keysRead())}; Orca's notice for ${targetMailbox} is the only thing it may read.`);
    t.diagnostic('Orca called the staged program idle, so the interrupt passed the gate and typed nothing; the skills reload below shows the gate typing into this tab');
  }
  t.diagnostic(`after the send --interrupt, the staging program in target's tab read ${JSON.stringify(keysRead())}; Orca lists the tab as ${JSON.stringify(listingOf(handle))}`);

  obkJson(['skills', 'add', '--bots', bots, '--bot', BOT, '--skill', 'kit:obk-tdd']);
  const idleBuild = buildFor(bots, TARGET);
  assert.deepEqual(idleBuild, { session: TARGET, harness: 'claude', state: 'reloaded' }, `the premise: with no question on the staged screen the kit types /reload-skills into it, got: ${JSON.stringify(idleBuild)}`);
  await until('/reload-skills to reach the staging program', MOVE_MS, async () => (
    (keysRead() ?? '').includes('/reload-skills') ? true : undefined
  ), () => ` It read: ${JSON.stringify(keysRead())}.`);
  await stopStage(handle);

  // ---------------------------------------------------------------------------
  // 7. The check, in listed's fresh tab, brought up only now through steps 2
  // to 4: the captured list. Neither line goes in, and not one byte.
  const listHandle = await firstTurn(LISTED);
  if (listHandle === undefined) return;
  if (!(await quit(LISTED, listHandle))) return;

  await startStage(listHandle, LISTED, CLAUDE_TEACH_LIST, 'the staged Teach list');
  const look = waitingOn(orca, listHandle);
  assert.ok(look !== undefined && look.includes(TEACH_TITLE), `the system tests' own look sees the live list in the way, with its title, got: ${look}`);

  const listSent = obkJson([
    'message', 'send', '--bots', bots, '--to', `${BOT}/${LISTED}`, '--from', `${BOT}/${SENDER}`,
    '--subject', `the typing gate ${SUBJECT_LIST}`, '--text', 'Nothing to do; this only checks the typing gate.', '--interrupt',
  ]);
  t.diagnostic(`the send --interrupt on the staged list: ${JSON.stringify({ transport: listSent.transport, interrupted: listSent.interrupted, idle: listSent.idle, interruptTrouble: listSent.interruptTrouble })}`);
  assert.equal(listSent.sent, true, `the message is in the mailbox: ${JSON.stringify(listSent)}`);
  assert.equal(listSent.interrupted, false, `no Escape into a tab with the Teach list up: ${JSON.stringify(listSent)}`);
  assert.ok(typeof listSent.interruptTrouble === 'string' && listSent.interruptTrouble.includes(QUESTION), `the answer says the tab is waiting on a question: ${JSON.stringify(listSent)}`);

  obkJson(['skills', 'add', '--bots', bots, '--bot', BOT, '--skill', 'kit:obk-debugging']);
  const listBuild = buildFor(bots, LISTED);
  assert.deepEqual(listBuild, { session: LISTED, harness: 'claude', state: 'blocked', blocked: QUESTION }, `no /reload-skills into a tab with the Teach list up, got: ${JSON.stringify(listBuild)}`);

  // Orca's notice for listed's letter can still reach the program (#561; the
  // header says why); it is Orca's key, not the kit's, so it is taken out.
  await setTimeout(SETTLE_MS);
  const listedMailbox = sessionIn(home, LISTED).mailbox;
  await until('the staging program to have read not one byte from the kit while the list was up', MOVE_MS, async () => {
    const read = keysRead();
    return read !== undefined && orcaNoticesOnly(read, listedMailbox) ? true : undefined;
  }, () => ` It read: ${JSON.stringify(keysRead())}; Orca's notice for ${listedMailbox} is the only thing it may read.`);
  t.diagnostic(`while the list was up, the staging program in listed's tab read ${JSON.stringify(keysRead())}; Orca lists the tab as ${JSON.stringify(listingOf(listHandle))}`);
  assert.ok(drawnAsStaged(rowsOf(listHandle), CLAUDE_TEACH_LIST), `and the staged list is still drawn as it was.${whatIsUp(listHandle)}`);
  await stopStage(listHandle);
});
