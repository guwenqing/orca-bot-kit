// A system test, and the live check for #726: `obk restart` closes a Claude
// session's tab, which ends the background shells its harness ran there, and
// the kit types one line into the resumed session that says so. Against the
// real Orca and real Claude Code on this machine. Run it alone, between
// midnight and 6 am local time, with a hard limit on the whole run:
//
//   npm run test:system -- --yes --limit=720 test/system/restart-line.test.js
//
// `npm test` cannot run it, and no CI machine could. The runner
// (scripts/test-system.js) sets OBK_SYSTEM_TESTS, backs up ~/.claude.json and
// ~/.codex/config.toml before any test (#619), and stops the run at its limit.
//
// The fake proves the rules (test/restart-line.test.js). This proves what the
// fake cannot: that a real background shell ends with the real tab, and that
// the real Claude Code takes the kit's line as a turn and answers it.
//
// The steps:
//
//   1. A throwaway fleet, by this checkout's CLI: one Claude bot with one
//      session, model `claude-haiku-5-5`, effort `low`, brought up with
//      `obk up`. The test waits until the kit's hook writes the conversation
//      into the book, which a restart needs.
//   2. THE PREMISE. One line typed into the session asks it to start one
//      background shell with its own Bash tool: `sh -c 'sleep 600; echo
//      <TOKEN>'`, with a token of this run. A process with the token is not
//      enough, because a foreground Bash call shows the same processes. So the
//      test waits until the transcript shows the Bash call with
//      `run_in_background: true`, its result naming a background task, and the
//      end of that turn (a `turn_duration` line after an `end_turn` or
//      `stop_sequence` message, with no tool call between), while `ps` still
//      shows a process with the token. Then it writes down that process and everything under it (the
//      `sleep`). Without all of it, the run proves nothing and fails.
//   3. `obk restart --json` for the session. ASSERTED: its tab entry has
//      `created: true`, `resumed: true`, `restartLine: true` and no `listLine`
//      key, and its `closed` names the old tab.
//   4. ASSERTED: after the restart, no process written down in step 2 is
//      still there (the test gives them GONE_MS to go). One that stays fails
//      the run, by its pid and command. The test never signals it.
//   5. ASSERTED: the session's transcript holds `restartLineOf(cliEntry,
//      bots)`, word for word, as a user turn, and an answer from the session
//      after it.
//
// Printed as diagnostics, never failed on: the commit, the Claude Code
// version, the session's answer to the line, whether the transcript has
// Claude Code's own `<task-notification>` that the shell "didn't finish before
// the previous session ended" (tech notes, #726) and where, whether the
// resumed conversation kept its id, and any process with the token that the
// resumed session started again.
//
// **Nobody answers anything by hand.** The test answers its own tabs' first-run
// screens, as memory-write.test.js does, and only through the allowlists:
//
//   - Claude Code's folder trust, once in each of this test's tabs, only when it
//     is the plain one for the bot's folder or the one the kit's default rules
//     bring up (helpers/claude-trust.js `claudeTrustAt`): down and return,
//     because the selection starts on "No, exit" (SETUP.md); then the trust rows
//     go, or the test fails. The new tab after the restart may ask again, so it
//     is looked at while `obk restart` runs, and answered the same way there.
//     That tab is found by the book: the kit writes `sessions.daily.tab` before
//     it starts the harness. The test records that one tab as its own in the
//     tab guard before it answers any screen in it, and answers no screen in
//     any other new tab. The record stays on a failure too, so the teardown
//     closes that tab as this test's own.
//   - Claude Code's "Teach auto mode about your environment?" form, at most once
//     in each tab, only when it is the captured form (`onlyTeachFormOf`): Esc;
//     then the form goes and autoModeEnvSetup stays as it was in ~/.claude.json
//     and in the Orca profile's own .claude.json, or the test fails.
//
// Any other question on the screen (`questionOn`) stops the run with the screen
// in the message; it is never answered. A permission prompt for the background
// command is such a question: the session runs at the kit's default approval,
// auto. `Bot Father daily` may sit on its own trust screen: nothing waits on
// it, and nothing is typed into it.
//
// **The night gate.** helpers/system.js runs this test only in a run that names
// its file, between midnight and 6 am local time (#689). It reads the gate
// again before `obk up` and before `obk restart`, which open tabs (#687).
//
// The machine it runs on is someone's working machine, with their own tabs open.
// So this test, like the ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory,
//     `<tmp>/obk-system-restart-line-*`;
//   - writes down every terminal and project Orca already had, before it creates
//     anything;
//   - runs this checkout's `src/cli.js` by its full path, never the machine's
//     `obk`;
//   - types only into its own tabs: the one line of step 2, and the answers
//     above;
//   - closes only its own tabs, through the tab guard, then deletes its own
//     projects, whatever happened;
//   - reads `ps` and signals no process it did not start. The one process it
//     may stop is its own `obk restart`, by its own handle, when that runs past
//     RESTART_MS or a screen look fails while it runs;
//   - never writes to ~/.claude.json or to the profile's .claude.json.
//
// Claude Code's own transcript folders for the throwaway bots stay under
// ~/.claude/projects, as they do for every system test here. It takes a few
// minutes: one start, two turns, one restart and one more turn. Each wait is
// bounded, and together they come to under ten minutes.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry, restartLineOf } from '../helpers/cli.js';
import { claudeTrustAt, trustScreenMet } from '../helpers/claude-trust.js';
import { atNight, namedThisRun } from '../helpers/night-gate.js';
import { deleteOwnProject, placesOf, projectsInBots } from '../helpers/own-project.js';
import { onlyTeachFormOf, questionOn, waitingOn } from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { RELOAD_LINE } from '../../src/orca.js';

/** This file, as the runner names it in OBK_SYSTEM_NAMED. */
const THIS_FILE = fileURLToPath(import.meta.url);

/** The Orca CLI that works for a normal user (tech notes, section 1). */
const ORCA = process.env.OBK_ORCA || '/Applications/Orca.app/Contents/Resources/bin/orca';

/** Orca's data folder, as the kit finds it (src/orca.js). */
const ORCA_DATA = process.env.OBK_ORCA_DATA || path.join(os.homedir(), 'Library', 'Application Support', 'orca');

/** How long the session is given to be past its first-run screens and have the kit's hook write the book. */
const HOOK_MS = 120000;

/** How long the session is given to finish its first turn and take a line. */
const READY_MS = 60000;

/** How long the session is given to start the background shell, as `ps` shows it. */
const START_MS = 90000;

/** How long the shell's own `sleep` is given to show under it, once the shell is seen. */
const CHILD_MS = 5000;

/** How long `obk restart` is given to end. Its own waits come to well under a minute. */
const RESTART_MS = 90000;

/** How long the old tab's processes are given to go once the restart has ended. */
const GONE_MS = 15000;

/** How long the resumed session is given to take the restart line and answer it. */
const ANSWER_MS = 120000;

/** The title of Claude Code's "Teach auto mode" form (#416), as helpers/screens.js has it. */
const TEACH_TITLE = 'Teach auto mode about your environment?';

/** The words of Claude Code's own notice for a background shell that a closed tab ended (tech notes, #726). */
const NOTICE = 'didn\'t finish before the previous session ended';

const BOT = { name: 'restart-line', display: 'Restart Line' };

/** The start of every throwaway bots folder of this test. */
const RUN_PREFIX = 'obk-system-restart-line-';

const guard = tabGuard(ORCA);
const { orca } = guard;

/** Every terminal Orca knows about right now. */
function allTerminals() {
  const answer = orca(['terminal', 'list']);
  assert.equal(answer.ok, true, `orca terminal list failed: ${JSON.stringify(answer.error)}`);
  return answer.result.terminals;
}

/** The terminals in one Orca project, by the path it was opened at. */
const terminalsAt = (home) => allTerminals().filter((terminal) => terminal.worktreePath === home);

/** The tabs Orca lists at `home` once it has caught up with what was closed. */
async function terminalsAfterClosing(home, closed, within = 5000) {
  const stop = Date.now() + within;
  let left = terminalsAt(home);
  while (left.some((terminal) => closed.includes(terminal.handle)) && Date.now() < stop) {
    await setTimeout(250);
    left = terminalsAt(home);
  }
  return left;
}

/** Every Orca project Orca knows about right now. */
function allSetups() {
  const answer = orca(['project', 'setups']);
  assert.equal(answer.ok, true, `orca project setups failed: ${JSON.stringify(answer.error)}`);
  return answer.result.setups;
}

/** Run this checkout's `obk`, by its full path (#217, #220). */
function obk(args) {
  const done = spawnSync(process.execPath, [cliEntry, ...args], { encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(done.error, undefined, `could not run \`obk\`: ${done.error?.message}`);
  return done;
}

/** Read what `obk ... --json` printed. A tab it says it opened is this test's own. */
function answerOf(args, { status, stdout, stderr }) {
  assert.equal(status, 0, `obk ${args.join(' ')} failed: ${stdout}${stderr}`);
  try {
    return guard.openedByKit(JSON.parse(stdout));
  } catch {
    return assert.fail(`obk ${args.join(' ')} --json did not print JSON: ${stdout}`);
  }
}

/** Run `obk ... --json` and read the answer it printed. */
const obkJson = (args) => answerOf(args, obk([...args, '--json']));

/**
 * Run `obk ... --json` as a process of this test's own, and call `meanwhile`
 * every two seconds while it runs, so that a screen in a tab it opens can be
 * answered before it ends. When it runs past `within`, or `meanwhile` fails,
 * the test stops that one process, by its own handle, and fails.
 */
async function obkJsonWhile(args, within, meanwhile) {
  const child = spawn(process.execPath, [cliEntry, ...args, '--json'], { cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  let ended;
  const done = new Promise((resolve) => {
    child.on('error', (error) => { ended ??= { error }; resolve(); });
    child.on('close', (code, signal) => { ended ??= { code, signal }; resolve(); });
  });
  const stopOwn = async () => {
    if (ended === undefined) child.kill('SIGTERM');
    await done;
  };

  const stop = Date.now() + within;
  while (ended === undefined && Date.now() < stop) {
    try {
      await meanwhile();
    } catch (error) {
      await stopOwn();
      throw error;
    }
    await Promise.race([done, setTimeout(2000)]);
  }
  if (ended === undefined) {
    await stopOwn();
    assert.fail(`obk ${args.join(' ')} --json ran past ${within}ms, so this test stopped it.\n  what it printed:\n${stdout}${stderr}`);
  }
  assert.equal(ended.error, undefined, `could not run \`obk\`: ${ended.error?.message}`);
  return answerOf(args, { status: ended.code, stdout, stderr });
}

/** The entry for one tab in an `obk --json` answer. */
function tabOf(answer, name) {
  const found = (answer.tabs ?? []).filter((entry) => entry.name === name);
  assert.equal(found.length, 1, `one entry should be the ${name} tab, got: ${JSON.stringify(answer.tabs)}`);
  return found[0];
}

/**
 * The night gate again, right before a later kit command that can open a tab
 * (#687). When the night ended during the run, the test opens nothing more and
 * fails here, naming `step`. The teardown runs as before.
 */
function gateStillOpen(step) {
  const now = new Date();
  const named = namedThisRun(THIS_FILE);
  assert.ok(atNight(now) && named, [
    `The night gate closed during this run: it is ${now.toTimeString().slice(0, 5)} local time${named ? '' : ', and this run does not name this file'}.`,
    `So this test opened nothing more: ${step} did not run. This run is not a pass.`,
    'Run it again in a night run, between midnight and 6 am local time: npm run test:system -- --yes --limit=720 test/system/restart-line.test.js',
  ].join('\n'));
}

/**
 * Keep asking until `look` gives something other than undefined, or the time
 * runs out. `screen` is run after each look that found nothing.
 */
async function until(what, within, look, note = () => '', screen = async () => {}) {
  const stop = Date.now() + within;
  for (;;) {
    const found = await look();
    if (found !== undefined) return found;
    await screen();
    assert.ok(Date.now() < stop, `gave up waiting for ${what} after ${within}ms.${note()}`);
    await setTimeout(1000);
  }
}

/** The rows the tab is rendering right now, or undefined when Orca rendered none. */
function rowsOf(handle) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  const tail = answer.ok === true && answer.result?.terminal?.source === 'screen' ? answer.result.terminal.tail : undefined;
  return Array.isArray(tail) ? tail.map(String) : undefined;
}

/** What the tab is showing, for the message of a wait that ran out. */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  return `${blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`}\n  orca terminal read --terminal ${handle} --screen\n    ${(rowsOf(handle) ?? ['(unreadable)']).join('\n    ')}`;
}

/**
 * Claude Code's config folders a tab here may run under: ~/.claude, and the
 * Orca profile that `selected-host` names, when there is one. Read only.
 */
function claudeConfigDirs() {
  const dirs = [path.join(os.homedir(), '.claude')];
  try {
    const selected = readFileSync(path.join(ORCA_DATA, 'claude-profiles', 'selected-host'), 'utf8').trim();
    if (selected !== '' && existsSync(selected)) dirs.push(selected);
  } catch {
    // No Orca profile is selected: ~/.claude is the only one.
  }
  return dirs;
}

/** Claude Code's two records of the Teach form's choice: ~/.claude.json and the profile's own. Read only. */
function autoModeState() {
  const files = [path.join(os.homedir(), '.claude.json'), ...claudeConfigDirs().slice(1).map((dir) => path.join(dir, '.claude.json'))];
  return files.map((file) => {
    try {
      const held = JSON.parse(readFileSync(file, 'utf8')).autoModeEnvSetup;
      return held === undefined ? 'absent' : JSON.stringify(held);
    } catch (error) {
      return `unreadable (${error.code ?? error.message})`;
    }
  }).join(', ');
}

/** The tabs whose folder trust this test answered, and the tabs whose Teach form it answered. */
const answered = { trust: new Set(), teach: new Set() };

/**
 * One look at one of this test's own tabs. The folder trust of `home` is
 * answered once in each tab, the captured Teach form at most once in each tab
 * with Esc, and any other question stops the run with the screen in the
 * message.
 */
async function lookAtScreen(t, { title, handle, home, bots }) {
  const rows = rowsOf(handle);
  if (rows === undefined) return;

  if (rows.some((row) => row.includes('Yes, I trust this folder'))) {
    assert.ok(!answered.trust.has(handle), `${title} asked Claude Code's folder trust for ${home} again, which this test answered once in this tab and answers no more:\n    ${rows.join('\n    ')}`);
    const wrong = claudeTrustAt(rows, home, bots, cliEntry);
    assert.equal(wrong, undefined, `${title}'s folder trust is not one this test may answer, so it answered nothing: ${wrong}.\n  what it showed:\n    ${rows.join('\n    ')}`);
    const sent = orca(['terminal', 'send', '--terminal', handle, '--text', '\x1b[B\r']);
    assert.equal(sent.ok, true, `answering ${title}'s folder trust failed: ${JSON.stringify(sent.error)}`);
    answered.trust.add(handle);
    await until(`${title}'s folder trust to go after it was answered`, 15000, async () => ((rowsOf(handle) ?? []).some((row) => row.includes('Yes, I trust this folder')) ? undefined : true), () => whatIsUp(handle));
    t.diagnostic(`answered ${title}'s (${handle}) ${trustScreenMet(rows)}`);
    return;
  }

  if (rows.some((row) => row.trim() === TEACH_TITLE)) {
    assert.ok(!answered.teach.has(handle), `the Teach form came up again in ${title}, and this test answers it at most once in each tab:\n    ${rows.join('\n    ')}`);
    const wrong = onlyTeachFormOf(rows);
    assert.equal(wrong, undefined, `${title}'s Teach form is not the captured one, so this test answered nothing: ${wrong}.\n  what it showed:\n    ${rows.join('\n    ')}`);
    const was = autoModeState();
    const sent = orca(['terminal', 'send', '--terminal', handle, '--text', '\x1b']);
    assert.equal(sent.ok, true, `answering ${title}'s Teach form with Esc failed: ${JSON.stringify(sent.error)}`);
    answered.teach.add(handle);
    await until(`${title}'s Teach form to go after Esc`, 15000, async () => ((rowsOf(handle) ?? []).some((row) => row.trim() === TEACH_TITLE) ? undefined : true), () => whatIsUp(handle));
    await setTimeout(2000);
    assert.equal(autoModeState(), was, `Esc on ${title}'s Teach form taught nothing: autoModeEnvSetup should be as it was`);
    t.diagnostic(`answered ${title}'s (${handle}) Teach form with Esc; autoModeEnvSetup stayed ${was}`);
    return;
  }

  const question = questionOn(rows);
  assert.equal(question, undefined, `${title} shows a screen this test does not know, and it answers nothing; the run stops here:\n    ${rows.join('\n    ')}`);
}

/**
 * Wait until a tab will take a line: Orca's wait is satisfied with no reason
 * named, and the suite's shared look finds no question on its screen. The
 * tab's own first-run screens are answered meanwhile, through `screen`.
 */
async function readyForALine(handle, within, screen) {
  await until(
    `${handle} to take a line`,
    within,
    async () => {
      const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '5000']);
      if (answer.ok !== true) return undefined;
      if (answer.result?.wait?.blockedReason !== undefined) return undefined;
      return waitingOn(orca, handle) === undefined ? true : undefined;
    },
    () => `${waitingOn(orca, handle) ?? ''}${whatIsUp(handle)}`,
    screen,
  );
}

/**
 * Type one line into one of this test's own tabs and submit it, and only when
 * the shared look finds nothing on the screen for a return to answer, looked
 * at right before the line goes. Otherwise fail with the screen, having typed
 * nothing.
 */
function typeInto(handle, text) {
  const why = waitingOn(orca, handle);
  assert.equal(why, undefined, `this test would type ${JSON.stringify(text)} into ${handle}, but${why}\n  Nothing was typed.`);
  const sent = orca(['terminal', 'send', '--terminal', handle, '--text', text, '--enter']);
  assert.equal(sent.ok, true, `orca terminal send --enter failed: ${JSON.stringify(sent.error)}${whatIsUp(handle)}`);
}

/**
 * The handle of the tab `tabId` in the Orca project at `home`, or undefined
 * when Orca lists no such tab there. An orphaned entry is listed under
 * `pty:<ptyId>`, so its real id is asked of `terminal show`, as the kit does
 * (src/orca.js `tabs`).
 */
function handleOfTab(home, tabId) {
  for (const terminal of terminalsAt(home)) {
    let id = terminal.tabId;
    if (terminal.orphaned === true) {
      const shown = orca(['terminal', 'show', '--terminal', terminal.handle]);
      id = shown.ok === true ? shown.result?.terminal?.tabId : undefined;
    }
    if (id === tabId) return terminal.handle;
  }
  return undefined;
}

/** Every process on the machine, `{ pid, ppid, command }`, from one read of `ps`. It is a reader here and never a road to a signal. */
function allProcesses() {
  const done = spawnSync('ps', ['-axww', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' });
  assert.equal(done.error, undefined, `could not run ps: ${done.error?.message}`);
  assert.equal(done.status, 0, `ps failed: ${done.stderr}`);
  return done.stdout.split('\n').flatMap((row) => {
    const match = /^\s*(\d+)\s+(\d+)\s(.*)$/.exec(row);
    return match === null ? [] : [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3].trim() }];
  });
}

/** The processes whose command holds `token`, and every process under them, from one read of `ps`. */
function tokenTree(token) {
  const all = allProcesses();
  const tree = new Map(all.filter((one) => one.command.includes(token)).map((one) => [one.pid, one]));
  for (let grew = true; grew;) {
    grew = false;
    for (const one of all) {
      if (!tree.has(one.pid) && tree.has(one.ppid)) {
        tree.set(one.pid, one);
        grew = true;
      }
    }
  }
  return [...tree.values()];
}

/** One process, for a message. */
const shownProcess = (one) => `pid ${one.pid} (parent ${one.ppid}): ${one.command}`;

/** The slug Claude Code names a project's transcript folder by: every character that is not an ASCII letter or digit changed to `-`. */
const slugOf = (root) => root.replaceAll(/[^A-Za-z0-9]/g, '-');

/** The folders that can hold this bot's transcripts, by their real path, each once. */
function transcriptFolders(home) {
  const found = new Set();
  for (const dir of claudeConfigDirs()) {
    try {
      found.add(path.join(realpathSync(path.join(dir, 'projects')), slugOf(home)));
    } catch {
      // That config folder has no projects folder: nothing of this bot is there.
    }
  }
  return [...found].filter((folder) => existsSync(folder));
}

/** One transcript, whole lines only, a JSON object each. */
function linesOfFile(file) {
  const text = readFileSync(file, 'utf8');
  const lines = [];
  for (const raw of text.slice(0, text.lastIndexOf('\n') + 1).split('\n')) {
    if (raw.trim() === '') continue;
    try {
      lines.push(JSON.parse(raw));
    } catch {
      // Not a line Claude Code finished writing as JSON; nothing here reads it.
    }
  }
  return lines;
}

/** Every conversation of this bot's folder, `{ id, file, lines }`. The folder is the throwaway bot's, so all of them are this run's. */
function conversationsOf(home) {
  return transcriptFolders(home).flatMap((folder) => readdirSync(folder)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => {
      const file = path.join(folder, name);
      return { id: name.slice(0, -'.jsonl'.length), file, lines: linesOfFile(file) };
    }));
}

/** The user turns of a Claude transcript, `{ text, index }`: `type: "user"` lines that are not meta, as text or text blocks. */
function userTurnsOf(lines) {
  return lines.flatMap((line, index) => {
    if (line?.type !== 'user' || line.isMeta === true) return [];
    const content = line.message?.content;
    const text = typeof content === 'string'
      ? content
      : Array.isArray(content) ? content.filter((block) => block?.type === 'text').map((block) => String(block.text)).join('\n') : '';
    return text === '' ? [] : [{ text, index }];
  });
}

/** What the session said in text after line `from` of a transcript. */
const saidAfter = (lines, from) => lines.slice(from + 1)
  .filter((line) => line?.type === 'assistant' && Array.isArray(line.message?.content))
  .flatMap((line) => line.message.content.filter((item) => item?.type === 'text'))
  .map((item) => String(item.text ?? ''))
  .filter((text) => text.trim() !== '')
  .join('\n');

/** The text of a tool result's content: a string, or text blocks. */
const resultText = (content) => (typeof content === 'string'
  ? content
  : Array.isArray(content) ? content.filter((block) => block?.type === 'text').map((block) => String(block.text)).join('\n') : '');

/** The stop reasons that end a turn, as the last assistant message of a finished turn carries them. */
const TURN_ENDS = ['end_turn', 'stop_sequence'];

/**
 * How far the session got with the background launch of the shell that holds
 * `token`, from its transcript: `{ file, task, said }` once a Bash tool_use
 * whose command holds the token has `run_in_background: true`, its result is
 * no error and names a background task, and the turn that made the call has
 * ended; otherwise `{ why }`, the step it has not reached. Claude Code names
 * the task in the result's `toolUseResult.backgroundTaskId` and in its text,
 * "Command running in background with ID: <id>", as a transcript on this
 * machine shows.
 *
 * Text after the result is not the end of the turn: another tool call can
 * follow it. The end is the first `type: "system"`, `subtype: "turn_duration"`
 * line after the result, which Claude Code writes when a turn ends, with an
 * assistant message whose `stop_reason` is `"end_turn"` or `"stop_sequence"`
 * between the result and that line, and no assistant tool_use after that
 * message and before that line (seen in a Claude Code 2.1.322 transcript on
 * this machine). Both stop reasons are taken: in that transcript, 540 finished
 * turns end on `end_turn` and 45 on `stop_sequence`, each with text and a
 * `turn_duration` line after it. `said` is the session's text in that turn
 * after the result.
 */
function launchOf(home, token) {
  const calls = conversationsOf(home).flatMap(({ file, lines }) => lines.flatMap((line) => (
    line?.type === 'assistant' && Array.isArray(line.message?.content) ? line.message.content : []
  )).filter((use) => use?.type === 'tool_use' && use.name === 'Bash' && String(use.input?.command ?? '').includes(token))
    .map((use) => ({ file, lines, use })));
  if (calls.length === 0) return { why: `no Bash call whose command holds ${token}` };
  const call = calls.find(({ use }) => use.input?.run_in_background === true);
  if (call === undefined) return { why: `the Bash call with the token is not made in the background: ${JSON.stringify(calls.map(({ use }) => use.input))}` };
  const { file, lines, use } = call;
  const at = lines.findIndex((line) => line?.type === 'user' && Array.isArray(line.message?.content)
    && line.message.content.some((block) => block?.type === 'tool_result' && block.tool_use_id === use.id));
  if (at < 0) return { why: `the background Bash call ${use.id} has no result yet` };
  const result = lines[at].message.content.find((block) => block?.type === 'tool_result' && block.tool_use_id === use.id);
  const text = resultText(result.content);
  if (result.is_error === true) return { why: `the background Bash call failed: ${JSON.stringify(text)}` };
  const named = lines[at].toolUseResult?.backgroundTaskId;
  const task = typeof named === 'string' && named !== '' ? named : /running in background with ID: (\S+?)\.?(?:\s|$)/i.exec(text)?.[1];
  if (task === undefined) return { why: `the result of the Bash call names no background task: ${JSON.stringify(text)}` };
  const end = lines.findIndex((line, index) => index > at && line?.type === 'system' && line.subtype === 'turn_duration');
  const turn = lines.slice(at + 1, end < 0 ? lines.length : end);
  const stopped = turn.findLastIndex((line) => line?.type === 'assistant' && TURN_ENDS.includes(line.message?.stop_reason));
  const reasons = turn.filter((line) => line?.type === 'assistant').map((line) => line.message?.stop_reason ?? null);
  if (end < 0) {
    return { why: `the shell runs as task ${task}, and no turn_duration line follows its result yet, so the turn has not ended (${stopped < 0 ? 'no' : 'an'} end_turn or stop_sequence message after the result; stop reasons after it: ${JSON.stringify(reasons)})` };
  }
  if (stopped < 0) {
    return { why: `the shell runs as task ${task}, and the turn_duration line after its result has no end_turn or stop_sequence message before it (stop reasons after the result: ${JSON.stringify(reasons)})` };
  }
  const later = turn.slice(stopped + 1).filter((line) => line?.type === 'assistant' && Array.isArray(line.message?.content)
    && line.message.content.some((block) => block?.type === 'tool_use'));
  if (later.length > 0) {
    return { why: `the shell runs as task ${task}, and a tool call follows the end_turn or stop_sequence message before the turn_duration line: ${JSON.stringify(later.map((line) => line.message.content.filter((block) => block?.type === 'tool_use').map((block) => block.name)))}` };
  }
  const said = saidAfter(lines.slice(0, end), at);
  if (said === '') return { why: `the shell runs as task ${task}, and its turn ended with no text from the session after the result` };
  return { file, task, said };
}

/** Every string anywhere under a value. */
function stringsIn(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(stringsIn);
  return [];
}

/** The last lines of every conversation of this bot, short, for the message of a wait that ran out. */
function tailsOf(home, count = 15) {
  const all = conversationsOf(home);
  if (all.length === 0) return '\n    (no transcript yet)';
  return all.map(({ file, lines }) => `\n  ${file}:\n${lines.slice(-count).map((line) => `    ${line.timestamp ?? '-'}  ${line.type}  ${JSON.stringify(line).slice(0, 300)}`).join('\n')}`).join('');
}

/** Remove the throwaway bots folder and every `<bots>.*` the kit made beside it (PRD 6.3). */
async function removeBotsFolderAndSiblings(bots) {
  const parent = path.dirname(bots);
  const mine = path.basename(bots);
  const ours = async () => (await readdir(parent)).filter((name) => name === mine || name.startsWith(`${mine}.`));
  for (const name of await ours()) await rm(path.join(parent, name), { recursive: true, force: true });
  assert.deepEqual(await ours(), [], `this test left folders behind in ${parent}`);
}

/** The commit of the checkout this test runs from, or why it could not be read. */
function commitRun() {
  const done = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: path.dirname(path.dirname(cliEntry)) });
  if (done.error !== undefined) return `(git did not run: ${done.error.message})`;
  return done.status === 0 ? done.stdout.trim() : `(git rev-parse HEAD failed: ${done.stderr.trim()})`;
}

test('obk restart ends the background shells of the closed tab, and the resumed Claude session takes the restart line and answers it', async (t) => {
  t.diagnostic(`the commit this run ran: ${commitRun()}`);
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), RUN_PREFIX)));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const home = homeOf(BOT.name);
  const homes = [homeOf('bot-father'), home];
  const bookFile = path.join(home, 'sessions.yaml');
  const entryInBook = () => (existsSync(bookFile) ? parse(readFileSync(bookFile, 'utf8'))?.sessions?.daily ?? {} : {});
  const TOKEN = `obk726-${randomBytes(6).toString('hex')}`;

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    const { closed, foreign } = guard.closeOwnAt(placesOf(homes, allSetups(), bots));
    const held = new Set(foreign.map((one) => one.home));
    let deleted = 0;
    const failedDeletes = [];
    for (const setup of projectsInBots(allSetups(), bots)) {
      if (before.setups.has(setup.id) || held.has(setup.path)) continue;
      try {
        await deleteOwnProject(setup, bots);
        deleted += 1;
      } catch (error) {
        failedDeletes.push(`${setup.path}: ${error.message}`);
      }
    }
    // Orca's sidebar keeps a deleted project's row until its window is rebuilt
    // (#343). This test does not reload the owner's window: it says so.
    if (deleted > 0) t.diagnostic(RELOAD_LINE);
    assert.deepEqual(foreign, [], `tabs this test did not create are open at its homes, so it closed only its own and left those projects and ${bots} in place`);
    await removeBotsFolderAndSiblings(bots);

    const { closedNotOurs, goneElsewhere } = guard.verdict(before.handles);
    assert.deepEqual(closedNotOurs, [], 'this test closed tabs it did not create');
    if (goneElsewhere.length > 0) t.diagnostic(`tabs open before this test and closed elsewhere meanwhile: ${goneElsewhere.join(', ')}`);
    for (const each of homes) {
      assert.deepEqual(await terminalsAfterClosing(each, closed), [], `this test left tabs behind in ${each}`);
    }
    // Said, never signalled: this test stops no process it did not start.
    const left = tokenTree(TOKEN);
    if (left.length > 0) t.diagnostic(`processes with this run's token are still there after the teardown, and this test signals none:\n    ${left.map(shownProcess).join('\n    ')}`);
    assert.deepEqual(failedDeletes, [], 'projects this test could not remove, left in Orca');
  });

  // ----------------------------------------------------- 1. the throwaway fleet

  obkJson(['init', '--bots', bots, '--harness', 'claude']);
  obkJson(['bot', 'create', '--bots', bots, '--name', BOT.name, '--harness', 'claude', '--charter', `${BOT.display} exists for one system test run and owns nothing.`]);
  const prompt = 'You are a system test\'s throwaway bot and you own nothing. Run no command now. Reply "ready", and then wait for the next line.';
  obkJson(['session', 'add', '--bots', bots, '--bot', BOT.name, '--name', 'daily', '--model', 'claude-haiku-5-5', '--effort', 'low', `--prompt=${prompt}`]);

  gateStillOpen('obk up of the throwaway session');
  const opened = tabOf(obkJson(['up', '--bots', bots, '--bot', BOT.name]), 'daily');
  assert.equal(opened.created, true, 'up opened the session\'s tab');
  assert.equal(opened.harnessStarted, true, `no claude came up in ${opened.title}: \`orca terminal read --terminal ${opened.terminal} --screen\``);
  const first = { title: opened.title, handle: opened.terminal, home, bots };
  const firstScreen = () => lookAtScreen(t, first);

  // The restart resumes the conversation only when the book names it, which
  // the kit's hook writes once Claude Code is past its first-run screens.
  const startedAs = await until(
    `${BOT.name}'s hook to write its conversation into the book`,
    HOOK_MS,
    async () => entryInBook().session,
    () => whatIsUp(first.handle),
    firstScreen,
  );
  t.diagnostic(`the book names the conversation ${startedAs}`);

  // ------------------------------------------------------------- 2. the premise

  await readyForALine(first.handle, READY_MS, firstScreen);
  typeInto(first.handle, [
    'Run exactly one shell command, with your Bash tool, in the background (run_in_background set to true):',
    `sh -c 'sleep 600; echo ${TOKEN}'`,
    'Do not wait for it, do not read its output, and run nothing else.',
    'It is a one-off: if it ever ends, do not start it again.',
    'Then reply "started".',
  ].join(' '));

  // A process with the token is not enough: a foreground Bash call shows the
  // same processes, and a restart while that call runs tests no background
  // shell. So the transcript must show the call made in the background, its
  // result naming a background task, and the turn ended with an answer, all
  // while `ps` still shows the shell.
  const launch = await until(
    `the session to start the shell with ${TOKEN} in the background and end its turn, with ps showing it`,
    START_MS,
    async () => {
      const seen = launchOf(home, TOKEN);
      return seen.said !== undefined && tokenTree(TOKEN).length > 0 ? seen : undefined;
    },
    () => `\n  the launch in the transcript: ${launchOf(home, TOKEN).why}\n  processes with the token: ${tokenTree(TOKEN).map(shownProcess).join('; ') || '(none)'}\n  the conversation:${tailsOf(home)}${whatIsUp(first.handle)}`,
    firstScreen,
  );
  t.diagnostic(`the session started the shell in the background as task ${launch.task}, in ${launch.file}, and answered: ${JSON.stringify(launch.said.slice(0, 300))}`);
  // The shell's own `sleep` is under it, and it does not hold the token.
  const stop = Date.now() + CHILD_MS;
  while (!tokenTree(TOKEN).some((one) => /(^|\/)sleep 600\b/.test(one.command)) && Date.now() < stop) await setTimeout(500);
  const running = tokenTree(TOKEN);
  assert.ok(running.length > 0, `the premise: the background shell with ${TOKEN} still runs after the session's turn ended, before the restart`);
  t.diagnostic(`the background shell before the restart:\n    ${running.map(shownProcess).join('\n    ')}`);

  // ------------------------------------------------------------- 3. the restart

  gateStillOpen('obk restart of the throwaway session');
  const oldTab = entryInBook().tab;
  assert.notEqual(oldTab, undefined, `the premise: the book names the session's tab before the restart, got: ${JSON.stringify(entryInBook())}`);
  // The new tab may stop on a first-run screen while the kit waits to type its
  // line. The kit writes the new tab into the book before it starts the harness
  // there, so this test finds that one tab by the book, records it as its own,
  // and answers screens in it and in no other tab.
  let newTab;
  const claimNewTab = () => {
    if (newTab !== undefined) return newTab;
    let id;
    try {
      id = entryInBook().tab;
    } catch {
      // The kit may be writing the book at this moment: the next look reads it again.
      return undefined;
    }
    if (id === undefined || id === oldTab) return undefined;
    const handle = handleOfTab(home, id);
    if (handle === undefined) return undefined;
    guard.openedByKit({ tabs: [{ created: true, terminal: handle }] });
    newTab = { id, handle };
    t.diagnostic(`the book names the new tab ${id} (${handle}); this test records it as its own`);
    return newTab;
  };
  let restarted;
  try {
    restarted = await obkJsonWhile(['restart', '--bots', bots, '--bot', BOT.name, '--session', 'daily'], RESTART_MS, async () => {
      const own = claimNewTab();
      if (own !== undefined) await lookAtScreen(t, { title: `${BOT.display} daily (${own.handle})`, handle: own.handle, home, bots });
    });
  } finally {
    // On a failure too, so that the teardown closes the new tab as this test's own.
    claimNewTab();
  }
  guard.closedByKit(restarted.closed);
  const back = tabOf(restarted, 'daily');
  if (newTab !== undefined) assert.equal(back.terminal, newTab.handle, `the tab the restart reports is the one the book named, got: ${JSON.stringify(back)}`);
  assert.ok((restarted.closed ?? []).some((entry) => entry.terminal === first.handle), `the restart closed the old tab ${first.handle}, got: ${JSON.stringify(restarted.closed)}`);
  assert.equal(back.created, true, `a new tab was opened for it, got: ${JSON.stringify(back)}`);
  assert.equal(back.resumed, true, `the conversation was resumed in it, got: ${JSON.stringify(back)}`);
  assert.equal(back.restartLine, true, `the kit typed the restart line, got: ${JSON.stringify(back)}`);
  assert.equal('listLine' in back, false, `and the entry carries no listLine key, got: ${JSON.stringify(back)}`);
  const second = { title: back.title, handle: back.terminal, home, bots };
  const secondScreen = () => lookAtScreen(t, second);

  // --------------------------------------------------- 4. the shell is gone

  const gone = new Set(running.map((one) => `${one.pid} ${one.command}`));
  const stillThere = () => allProcesses().filter((one) => gone.has(`${one.pid} ${one.command}`));
  const goneBy = Date.now() + GONE_MS;
  while (stillThere().length > 0 && Date.now() < goneBy) await setTimeout(500);
  const left = stillThere();
  assert.deepEqual(left.map(shownProcess), [], `the old tab's background shell outlived the restart by ${GONE_MS}ms. This test signals none of them`);
  const again = tokenTree(TOKEN);
  if (again.length > 0) t.diagnostic(`the resumed session started the shell again, which the test asked it not to do:\n    ${again.map(shownProcess).join('\n    ')}`);

  // ----------------------------------------------------- 5. the line, and its answer

  const line = restartLineOf(cliEntry, bots);
  const found = await until(
    'the resumed session to take the restart line as a turn and answer it',
    ANSWER_MS,
    async () => {
      for (const conversation of conversationsOf(home)) {
        const turn = userTurnsOf(conversation.lines).find((one) => one.text.trim() === line);
        if (turn === undefined) continue;
        const said = saidAfter(conversation.lines, turn.index);
        if (said !== '') return { conversation, turn, said };
      }
      return undefined;
    },
    () => {
      const near = conversationsOf(home).flatMap(({ lines }) => userTurnsOf(lines)).filter((one) => one.text.includes('obk restart closed'));
      return `${near.length === 0 ? '' : `\n  turns that hold part of the line, not word for word:\n    ${near.map((one) => JSON.stringify(one.text)).join('\n    ')}`}\n  the line it looks for:\n    ${JSON.stringify(line)}\n  the conversations:${tailsOf(home)}${whatIsUp(second.handle)}`;
    },
    secondScreen,
  );

  // ----------------------------------------------------------- 6. diagnostics

  const { conversation, turn, said } = found;
  t.diagnostic(`the session's answer to the restart line: ${JSON.stringify(said.slice(0, 1000))}`);
  t.diagnostic(`the line is in ${conversation.file}; the conversation before the restart was ${startedAs}, and the book now names ${entryInBook().session ?? '(none)'}`);
  t.diagnostic(`Claude Code version the transcript records: ${conversation.lines.map((one) => one.version).filter((one) => typeof one === 'string').at(-1) ?? '(none recorded)'}`);
  const notices = conversationsOf(home).flatMap(({ file, lines }) => lines
    .map((one, index) => ({ one, index }))
    .filter(({ one }) => stringsIn(one).some((text) => text.includes(NOTICE)))
    .map(({ one, index }) => `${path.basename(file)} line ${index + 1}, ${one.type}${one.operation === undefined ? '' : ` ${one.operation}`}${file === conversation.file ? (index < turn.index ? ', before the restart line' : ', after the restart line') : ''}`));
  t.diagnostic(notices.length === 0
    ? `no "<task-notification>" with "${NOTICE}" reached the transcript`
    : `Claude Code's "<task-notification>" with "${NOTICE}" is in the transcript at:\n    ${notices.join('\n    ')}`);
});
