// A system test: `obk session clear` on a Pi session (#663), against the real
// Orca and a real Pi on this machine. Run it alone with
// `npm run test:system -- --yes test/system/pi-clear.test.js`; `npm test`
// cannot, and no CI machine could.
//
// What it shows, with one Pi bot in a throwaway bots folder, its session
// daily on openai/gpt-6-luna at thinking low, and a start prompt that asks for
// one word and no tool:
//
//   a. `obk session clear` on the idle Pi session exits 0, its JSON answer
//      says harness pi, and the book holds a new id, with the old one in
//      daily's history. The kit types `/new`, a space, and then its return
//      only when the editor reads `/new` with no menu below the box (#673, as
//      #671 did for `/compact`): the run prints that screen when a read
//      catches it, and asserts that the book still held the old id when that
//      screen was read, and holds the new one after; when no read catches it,
//      it says so as a finding.
//   b. While Pi runs one turn that does only `sleep 40` through its bash tool,
//      `obk session clear` is refused as busy within about 30 s, and nothing
//      was typed: the book holds the same id, and Pi's editor is still empty.
//   c. At the end, the tab is idle and its editor empty.
//
// It is also the research for the tech notes (#663): Pi's screens in the unit
// suite are reconstructions from Pi 1.3.0's code, and this run is the first
// look at them through Orca's `terminal read`. So at each step it prints the
// rows of `orca terminal read --screen` of its own tab, with Orca's `draft`
// when Orca gives one: at rest before anything is typed, with `/new` typed and
// before any return, with `/new ` (a trailing space) typed, during the kit's
// clear each time the screen changes (#673), after the clear,
// during the busy turn, after the refused clear, and at the end. The `/new`
// and `/new ` steps are the test's own typing, before the kit's clear runs:
// one character a send, 100 ms apart, then taken back with one send of 4 or 5
// backspaces (\x7f), and the editor is checked empty again. No return is ever
// sent after them. Those prints are research, not assertions.
//
// How the editor is read here, after Pi 1.3.0's code (the reconstruction):
// the input box's bottom rule is the lowest row on the screen that is `─`
// alone, or `─` with Pi's scroll label ` ↓ <n> more `; its top rule is the
// nearest row above that which is a rule of the same full width (starts `──`,
// ends `─`, exactly as long); every row between them is an editor row. Pi is at work when that top rule holds any text besides `─` and the
// scroll label ` ↑ <n> more `: Pi draws its status there as `── <spinner>
// <message> ───…`, usually `── ⠋ Working ───…` with no hint. When the screen
// has no such box, the check that needs it fails, with the screen in the
// message: that is a finding about the reconstruction.
//
// **An orphaned tab.** This test opens its bot in a throwaway Orca project,
// and the Orca window may not load it. Orca lists a tab of a project its
// window has not loaded as orphaned (`orphaned: true`, tab id `pty:<ptyId>`),
// and this test cannot read such a tab as the window shows it (tech notes,
// section 1; #579). A tab counts as real only when Orca lists it with
// `orphaned: false` and a tab id that does not start with `pty:`. Before it
// types into a tab, the test looks at that tab and prints what it saw.
//
// When the tab is not real, the test opens ONE MORE throwaway project in its
// bots folder, made as `obk up` makes a bot's project, with one plain tab in it
// (helpers/newer-project.js). Then it waits up to REAL_MS until the tab is
// real, and fails plainly if it is not (#561, #634). That step opens a project
// and a tab in the owner's Orca window, so it runs only when both hold (the
// owner's rule in #561; helpers/night-gate.js):
//
//   - the local hour is 0 to 5 (between midnight and 6 am), and
//   - the run named this file (the runner's OBK_SYSTEM_NAMED holds its path).
//
// Otherwise it opens nothing and fails, and says why. The extra project's home
// is in the teardown's homes, so the tab guard closes its plain tab and the
// teardown deletes the project.
//
// The machine it runs on is someone's working machine. So this test, like the
// ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory;
//   - writes down every terminal and workspace Orca already had, before it
//     creates anything;
//   - runs this checkout's `src/cli.js` by its full path, never the machine's
//     `obk` (#220), outside any tab of its own caller;
//   - types only into its own Pi tab: `/new` and `/new `, each one character a
//     send and taken back, and the one line of the busy turn with a return;
//     every other key is the kit's own clear;
//   - closes only its own tabs, through the tab guard, then deletes its own
//     workspaces, whatever happened;
//   - signals no process.
//
// `orca terminal close --worktree … --all` is never run here, and the guard
// refuses it. The runner (scripts/test-system.js) makes a fresh copy of
// ~/.claude.json and ~/.codex/config.toml before any test is loaded, and runs
// nothing when it cannot (#619).
//
// **Nobody answers anything.** The kit starts Pi with --no-approve, and Pi
// 1.3.0 then asks nothing at start (tech notes, section 6). So the Pi tab must
// show no question at any look: not Pi's project-trust question, not a Pi
// warning that waits for a key, not a Pi list or selector, nor any question
// the kit's shared look finds (helpers/screens.js `questionOn`). Any of them
// stops the run at once, with the screen in the failure message, and nothing
// is typed into it. The only screens a system test here may ever answer are
// Claude Code's plain folder trust (helpers/screens.js `onlyPlainTrustOf`)
// and its Teach form (`onlyTeachFormOf`); neither is a screen of Pi's, and
// this test types into no Claude Code tab, so it answers none. Bot Father's
// tab is left as it comes up.
//
// **Pi's records.** The runner removes the Pi session folders under
// ~/.pi/agent/sessions that the run's own throwaway folders caused (PR #638);
// it is the one deleter of them. This test removes none: it only reads Pi's
// session files for the book's ids, to see a turn end. Nothing under ~/.pi is
// written by it, and it reads no credential. settings.json, trust.json and
// models.json in ~/.pi/agent are compared before and after, and a change is
// reported, not undone.
//
// What it cannot clean up, and says so: the Run mailbox `up` makes (Orca has
// no `run-delete`), and whatever Orca keeps of its own for the tabs.
//
// It runs at night: the owner's rule is that a live test that mounts a
// throwaway tab in the owner's open Orca runs between midnight and 6 am. It
// takes a few minutes and spends two short Pi turns. TOTAL_MS bounds the
// whole test; every wait inside it is bounded by its own limit and by what is
// left of TOTAL_MS.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import { cliEntry } from '../helpers/cli.js';
import { questionOn, waitingOn } from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { deleteOwnProject } from '../helpers/own-project.js';
import { openNewerProject } from '../helpers/newer-project.js';
import { atNight, namedThisRun } from '../helpers/night-gate.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/** The Orca CLI that works for a normal user (tech notes, section 1). */
const ORCA = process.env.OBK_ORCA || '/Applications/Orca.app/Contents/Resources/bin/orca';

/** This file, as the runner names it in OBK_SYSTEM_NAMED. */
const THIS_FILE = fileURLToPath(import.meta.url);

/** The longest the whole test may take, its teardown not counted. */
const TOTAL_MS = 1200000;

/** How long a tab is given to come up and be idle. */
const READY_MS = 180000;

/** How long a Pi turn is given, and its record to show it. */
const ANSWER_MS = 240000;

/** How long the busy turn is given to show as busy, from its return. */
const BUSY_START_MS = 60000;

/** The longest one run of the kit's `obk session clear` may take here: its own waits are 30 s each. */
const CLEAR_LIMIT_MS = 120000;

/** How long a refusal for a busy session may take: the kit's 30 s wait, and some to spare. */
const BUSY_REFUSAL_MS = 60000;

/** How often the screen is looked at while the kit's clear runs, once the screen before its return is caught. */
const DURING_EVERY_MS = 1000;

/** How often the screen is read while the kit's clear runs, until the screen before its return is caught. */
const DURING_FAST_MS = 100;

/** At most this many screens are printed while the kit's clear runs, each one only when the rows changed. */
const DURING_PRINTS = 12;

/** The gap between the characters this test types itself, as the kit's own clear spaces them. */
const CHAR_GAP_MS = 100;

/** How long the tab is given to draw what was typed before it is read. */
const DRAW_MS = 1000;

/** How long the tab is given to take a key in before the return that goes after it. */
const KEY_GAP_MS = 1000;

/** How long a tab is given to be listed as real after one more project is opened (#561: about 30 s). */
const REAL_MS = 30000;

const BOT = 'pi-clear-bot';
const SESSION = 'daily';

/** The Pi model and effort: the cheapest the tech notes name. */
const MODEL = 'openai/gpt-6-luna';
const EFFORT = 'low';

/** The one word the start prompt asks for. */
const CODE = 'PLOVER-6630';

/** The start prompt: one word to say, and nothing else. */
const PROMPT = 'You are a system test\'s session and you own nothing. Do not run any command, read or write any file,'
  + ` or use any tool. Reply now with ${CODE} and nothing else, then wait.`;

/** How long the busy turn's command runs: past the kit's 30 s wait for an idle session. */
const BUSY_SECONDS = 40;

/** The busy turn: one bash tool call of `sleep`, and nothing else. */
const BUSY_LINE = `Use your bash tool once to run exactly the command \`sleep ${BUSY_SECONDS}\`, and wait for it to finish.`
  + ' Run no other command, read no file and write no file. When it has finished, reply DONE and nothing else.';

/** Where Pi keeps its sessions, under the user's own HOME (tech notes, section 6). */
const PI_AGENT = path.join(os.homedir(), '.pi', 'agent');
const PI_SESSIONS = path.join(PI_AGENT, 'sessions');

/** Pi's session folder for a working folder: its real path, the leading `/` off, every `/`, `\` and `:` a `-`. */
const piFolderNameOf = (real) => `--${real.replace(/^\//, '').replaceAll(/[/\\:]/g, '-')}--`;

/** The files in ~/.pi/agent this test compares, never writes. None of them holds a credential. */
const PI_SETTINGS = ['settings.json', 'trust.json', 'models.json'];

/** A file's SHA-256, or null when it is not there. */
function hashOf(file) {
  if (!existsSync(file)) return null;
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** Every close goes through the guard, which counts it for the check at the end (#246). */
const guard = tabGuard(ORCA);
const { orca } = guard;

/** When the whole test runs out of time: set when the test starts. */
let deadline = Date.now() + TOTAL_MS;

// ------------------------------------------------------------- Orca and the kit

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
  const stop = Date.now() + within;
  let left = terminalsAt(home);
  while (left.some((terminal) => closed.includes(terminal.handle)) && Date.now() < stop) {
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
 * Remove the throwaway bots folder and everything the kit made beside it:
 * `<bots>.prompts`, `<bots>.locks` and the rest are siblings of it (PRD 6.3).
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

/**
 * The environment of wherever this test was started, without anything that
 * names an Orca tab or the kit's launch line: the test may itself run in an
 * Orca tab, and a command of the kit's must not take that tab for its caller.
 */
const outsideAnyTab = Object.fromEntries(Object.entries(process.env)
  .filter(([name]) => !name.startsWith('ORCA_') && name !== 'OBK_CLI' && name !== 'OBK_TAB_SHELL'));

/** Run this checkout's `obk`, by its full path (#217, #220), outside any tab, for at most `limit` ms. */
function obk(args, limit = CLEAR_LIMIT_MS) {
  const done = spawnSync(process.execPath, [cliEntry, ...args], { encoding: 'utf8', cwd: os.tmpdir(), env: outsideAnyTab, timeout: limit });
  assert.equal(done.error, undefined, `could not run \`obk\` to its end within ${limit} ms: ${done.error?.message}`);
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
    return assert.fail(`obk ${args.join(' ')} --json did not print JSON: ${done.stdout}`);
  }
}

/** The entry for one tab in an `obk --json` answer. */
function tabOf(answer, name) {
  const found = (answer.tabs ?? []).filter((entry) => entry.name === name);
  assert.equal(found.length, 1, `one entry should be the ${name} tab, got: ${JSON.stringify(answer.tabs)}`);
  return found[0];
}

/** What the book says about one session right now. */
const sessionIn = (home, name) => (parse(readFileSync(path.join(home, 'sessions.yaml'), 'utf8')) ?? {}).sessions?.[name] ?? {};

/** Whether the session's history in the book holds `id`. */
const historyHolds = (entry, id) => (entry.history ?? []).some((old) => old?.session === id);

/**
 * Keep asking until `look` gives something other than undefined, or the time
 * runs out: `within`, or what is left of TOTAL_MS, whichever ends first.
 * `note` says what was seen; `screen` is run before each look.
 */
async function until(what, within, look, note = () => '', screen = async () => {}) {
  const stop = Math.min(Date.now() + within, deadline);
  for (;;) {
    await screen();
    const found = await look();
    if (found !== undefined) return found;
    if (Date.now() >= stop) {
      const why = stop === deadline ? `the test's total time limit of ${TOTAL_MS}ms ran out` : `${within}ms`;
      assert.fail(`gave up waiting for ${what} after ${why}.${note()}`);
    }
    await setTimeout(1000);
  }
}

/** One read of the tab: its rendered rows, or undefined when Orca gives no rendered screen, and Orca's `draft`, when it gives one. */
function readOf(handle) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  const shown = answer.ok === true ? answer.result?.terminal : undefined;
  const rows = shown?.source === 'screen' && Array.isArray(shown.tail) ? shown.tail.map(String) : undefined;
  return { rows, draft: shown?.draft, source: shown?.source, error: answer.ok === true ? undefined : answer.error };
}

/** The rows the tab renders right now, or undefined when Orca gives no rendered screen. */
const rowsOf = (handle) => readOf(handle).rows;

/** The tab as Orca lists it now, or undefined when Orca does not list it. */
const listed = (handle) => allTerminals().find((terminal) => terminal.handle === handle);

/** Whether Orca lists the tab as real: `orphaned: false` and a tab id that does not start with `pty:` (#561). */
const realTab = (entry) => entry?.orphaned === false && typeof entry.tabId === 'string' && !entry.tabId.startsWith('pty:');

/** Whether Orca lists the tab as orphaned now, in words. */
function orphanWords(handle) {
  const entry = listed(handle);
  if (entry === undefined) return 'not listed by Orca at all';
  return realTab(entry)
    ? `listed as real (orphaned: false, tab id ${entry.tabId})`
    : `listed as ORPHANED (orphaned: ${entry.orphaned}, tab id ${entry.tabId}): it is not a tab the Orca window has loaded`;
}

/** What Orca's tui-idle answers for the tab now, in a 2 s look. */
function tuiLook(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  return {
    ok: answer.ok === true && answer.result?.wait?.satisfied === true && answer.result?.wait?.blockedReason === undefined,
    said: answer.ok === true ? JSON.stringify(answer.result?.wait) : `refused: ${JSON.stringify(answer.error)}`,
  };
}

/** What the tab is showing, for the message of a wait that ran out, with whether it is orphaned. */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  const { rows, draft } = readOf(handle);
  return `${blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`}\n  The tab ${handle} is ${orphanWords(handle)}.`
    + `\n  orca terminal read --terminal ${handle} --screen (draft: ${JSON.stringify(draft)})\n    ${(rows ?? ['(no rendered screen)']).join('\n    ')}`;
}

/** Print what Orca's read of the tab shows now, every row, with its draft: the research this run is for. */
function printScreen(t, when, handle) {
  const { rows, draft, source, error } = readOf(handle);
  const tui = tuiLook(handle);
  t.diagnostic([
    `${when}: orca terminal read --terminal ${handle} --screen`,
    `  source: ${JSON.stringify(source)}; draft: ${draft === undefined ? '(no draft key)' : JSON.stringify(draft)}; tui-idle: ${tui.said}${error === undefined ? '' : `; error: ${JSON.stringify(error)}`}`,
    `  ${(rows ?? ['(no rendered screen)']).length} rows, each between | and |:`,
    ...(rows ?? ['(no rendered screen)']).map((row) => `  |${row}|`),
  ].join('\n'));
}

// ------------------------------------------------------------- Pi's screen, as Pi 1.3.0's code draws it

/** Pi's scroll label in a rule of its input box, ` ↑ 3 more ` or ` ↓ 2 more `, with a long draft (pi-tui editor.js createScrollBorder). */
const SCROLL_LABEL = / [↑↓] \d+ more /g;

/** A rule's text once its `─` and its scroll label are taken out: empty for a plain rule. */
const ruleWords = (row) => row.replaceAll(SCROLL_LABEL, '').replaceAll('─', '').trim();

/** A bottom rule of Pi's input box: `─` alone, or `─` with the scroll label. */
const isBottomRule = (row) => row.trimEnd().startsWith('─') && ruleWords(row) === '';

/** A row shaped like a rule of Pi's: starts `──`, ends `─`. */
const isRuleShaped = (row) => row.startsWith('──') && row.endsWith('─');

/**
 * Pi's input box on `rows`, by the walk of #663: from the lowest bottom rule
 * up, over the rule-shaped rows only. The first one as long as the bottom
 * rule (in code points) is the top rule, and rows above it never count:
 * `{ top, editor, below }`. Before it, one of another length whose words
 * hold a character that is not ASCII is a status in wide or combining
 * characters (the review of 5455aa6): `{ status }`, no box to type into.
 * One whose words are all ASCII is an editor row, and the walk goes on.
 * Neither: undefined, no input box. A plain full-width divider in the chat
 * (DynamicBorder, the review of b2a0bde) is reached only when no status or
 * top rule comes before it.
 */
function inputBoxOf(rows) {
  const bottom = rows.findLastIndex(isBottomRule);
  if (bottom < 1) return undefined;
  const width = [...rows[bottom]].length;
  for (let at = bottom - 1; at >= 0; at -= 1) {
    const row = rows[at];
    if (!isRuleShaped(row)) continue;
    if ([...row].length === width) return { top: row, editor: rows.slice(at + 1, bottom), below: rows.slice(bottom + 1) };
    if (/[^\x00-\x7f]/.test(ruleWords(row))) return { status: row };
  }
  return undefined;
}

/** Whether Pi's screen on `rows` says it is at work: a status found on the walk, or a top rule with words in it besides `─` and the scroll label. */
const atWorkOn = (rows) => {
  const box = inputBoxOf(rows ?? []);
  if (box === undefined) return false;
  return box.status !== undefined || ruleWords(box.top) !== '';
};

/** Fail unless Pi's editor in the tab is empty now: no draft from Orca, and every row between the two rules blank. */
function assertEditorEmpty(handle, when) {
  const { rows, draft } = readOf(handle);
  assert.ok(rows !== undefined, `${when}: the tab's screen could not be read.${whatIsUp(handle)}`);
  const box = inputBoxOf(rows);
  assert.ok(box?.top !== undefined, `${when}: the screen shows no input box of two rules of ─, as Pi 1.3.0's code draws it; the reconstruction is wrong:\n    ${rows.join('\n    ')}`);
  assert.ok(draft === undefined || draft === '', `${when}: Orca's draft for the tab is ${JSON.stringify(draft)}, not empty:\n    ${rows.join('\n    ')}`);
  assert.deepEqual(box.editor.filter((row) => row.trim() !== ''), [], `${when}: Pi's editor is empty:\n    ${rows.join('\n    ')}`);
}

/** Whether the tab is idle right now: Orca's tui-idle ok, nothing to answer on it, and Pi's top rule not at work. */
function idleNow(handle) {
  return tuiLook(handle).ok && waitingOn(orca, handle) === undefined && !atWorkOn(rowsOf(handle));
}

/**
 * A question of Pi's on `rows`, or of any harness the kit's shared look knows,
 * named; undefined when there is none. Pi's shapes are those of tech notes
 * section 6, and its selectors' cancel foot (#659).
 */
function questionIn(rows) {
  if (rows.some((row) => row.trim() === 'Trust project folder?')) return 'Pi\'s project-trust question';
  if (rows.some((row) => /Press any key to continue/.test(row))) return 'a Pi warning that waits for a key';
  if (rows.some((row) => /↑↓ navigate\s+enter select\s+escape\/ctrl\+c cancel/.test(row))) return 'a Pi list, from an extension or Pi itself';
  if (rows.some((row) => /escape\/ctrl\+c (?:to )?(?:cancel|close)|escape\/ctrl\+c skip setup/i.test(row))) return 'a Pi selector or dialog, by its cancel foot';
  if (questionOn(rows) !== undefined) return 'a question the kit\'s shared look finds';
  return undefined;
}

/** Fail, typing nothing, when a question is on the Pi tab's screen. This test answers none. */
function assertNoQuestion(handle, when) {
  const rows = rowsOf(handle);
  if (rows === undefined) return;
  const found = questionIn(rows);
  assert.equal(found, undefined, `${when}, ${found} is up in ${BOT} ${SESSION}'s Pi tab. The kit's --no-approve should have kept it away; this test answers nothing, typed nothing into it, and stops here:\n    ${rows.join('\n    ')}`);
}

/** One `terminal send` of `keys` into the test's own tab, with no --enter. */
function send(handle, keys) {
  const sent = orca(['terminal', 'send', '--terminal', handle, '--text', keys]);
  assert.equal(sent.ok, true, `typing ${JSON.stringify(keys)} into ${handle} failed: ${JSON.stringify(sent.error)}.${whatIsUp(handle)}`);
}

/** Type `text` into the test's own Pi tab one character a send, CHAR_GAP_MS apart, and no return. A question on screen stops the run first. */
async function typeSlowly(handle, text) {
  assertNoQuestion(handle, `before ${JSON.stringify(text)} was typed`);
  for (const key of text) {
    send(handle, key);
    await setTimeout(CHAR_GAP_MS);
  }
}

/**
 * Press keys in the test's own Pi tab: `text`, then a return as a send of its
 * own, neither with `--enter` (as test/system/pi-new.test.js does). The screen
 * is looked at first: a question on it stops the run.
 */
async function pressIn(handle, text) {
  assertNoQuestion(handle, `before ${JSON.stringify(text)} was typed`);
  for (const keys of [text, '\r']) {
    send(handle, keys);
    await setTimeout(KEY_GAP_MS);
  }
}

/** Give the kit's own account of tabs it closed to the guard: a restart's or a retire's `closed`. */
function closedByKit(entries) {
  if (Array.isArray(entries)) guard.closedByKit(entries);
}

// ------------------------------------------------------------- an orphaned tab

/**
 * Before the test types into a tab ({ title, handle }): the tab is real, or
 * this test opens one more project, at night in a run that names this file,
 * and the tab is real within REAL_MS; or the test fails and says why. The
 * extra project's home goes into `homes`, the teardown's list, before it is
 * made.
 */
async function loadedForTyping(t, { title, handle }, why, { bots, homes }) {
  const entry = listed(handle);
  assert.ok(entry !== undefined, `${title}: Orca no longer lists its tab ${handle}`);
  t.diagnostic(`${title} (${handle}) before ${why}: ${orphanWords(handle)}`);
  if (realTab(entry)) return;

  const name = `${title} (${handle})`;
  const now = new Date();
  const night = atNight(now);
  const named = namedThisRun(THIS_FILE);
  if (!(night && named)) {
    t.diagnostic(`opened no extra project for ${name} (night: ${night}, this file named: ${named})`);
    assert.fail([
      `Orca lists ${name}'s tab as orphaned before ${why}.`,
      'An orphaned tab is not a tab the Orca window has loaded, so this test cannot read it as the window shows it, and types nothing into it.',
      'This test opens one more project and one plain tab in the Orca window only in a night run, between midnight and 6 am local time, that names this file:',
      '  npm run test:system -- --yes test/system/pi-clear.test.js',
      `This run is at ${now.toTimeString().slice(0, 5)} local time and ${named ? 'names this file' : 'does not name this file'}, so it opened nothing.`,
    ].join('\n'));
  }

  const count = homes.filter((home) => path.basename(home).startsWith('newer-')).length + 1;
  const home = path.join(bots, 'bots', `newer-${count}`);
  homes.push(home);
  const newer = await openNewerProject(guard, home, `pi-clear newer ${count}`);
  t.diagnostic(`opened one more project at ${home} at ${now.toISOString()} for ${name}: tellWindow ${newer.told ? 'taken' : 'not taken'}, plain tab ${newer.handle}`);
  const stop = Date.now() + REAL_MS;
  let real = realTab(listed(handle));
  while (!real && Date.now() < stop) {
    await setTimeout(500);
    real = realTab(listed(handle));
  }
  t.diagnostic(`${name} after one more project: ${orphanWords(handle)}`);
  t.diagnostic(`the plain tab ${newer.handle}: ${orphanWords(newer.handle)}`);
  assert.ok(real, `Orca still lists ${name}'s tab as orphaned ${REAL_MS} ms after this test opened one more project at ${home}, so this test types nothing into it`);
}

// ------------------------------------------------------------- Pi's record

/** Pi's JSON lines in one session file, whole lines only; none when it is not there. */
function piLinesOf(file) {
  if (file === undefined || !existsSync(file)) return [];
  const text = readFileSync(file, 'utf8');
  return text.slice(0, text.lastIndexOf('\n') + 1).split('\n').flatMap((raw) => {
    try {
      return raw.trim() === '' ? [] : [JSON.parse(raw)];
    } catch {
      return [];
    }
  });
}

/** The text of a Pi message's content, whether a string or a list of text blocks. */
const textOf = (content) => (typeof content === 'string'
  ? content
  : Array.isArray(content) ? content.filter((block) => block?.type === 'text').map((block) => String(block.text)).join('') : '');

/** Pi's session file for `id` in the folder `dir`, or undefined. */
function piFileIn(dir, id) {
  if (typeof id !== 'string' || !existsSync(dir)) return undefined;
  const name = readdirSync(dir).find((one) => one.endsWith(`_${id}.jsonl`));
  return name === undefined ? undefined : path.join(dir, name);
}

/** The turns of one role in a Pi file's lines, as their text. */
const turnsOf = (lines, role) => lines.filter((line) => line.type === 'message' && line.message?.role === role).map((line) => textOf(line.message.content));

/** The last lines of a record, short, for a failure message. */
const tailOf = (lines, count = 15) => lines.slice(-count)
  .map((line) => `${line?.type}/${line?.message?.role ?? line?.customType ?? '-'}: ${JSON.stringify(line?.message?.content ?? line?.content ?? '').slice(0, 200)}`)
  .join('\n    ');

/** Print one read of the tab that was already made, every row, with its draft, without reading again. */
function printRows(t, when, { rows, draft, source, error }) {
  t.diagnostic([
    `${when}: orca terminal read --screen`,
    `  source: ${JSON.stringify(source)}; draft: ${draft === undefined ? '(no draft key)' : JSON.stringify(draft)}${error === undefined ? '' : `; error: ${JSON.stringify(error)}`}`,
    `  ${(rows ?? ['(no rendered screen)']).length} rows, each between | and |:`,
    ...(rows ?? ['(no rendered screen)']).map((row) => `  |${row}|`),
  ].join('\n'));
}

/**
 * Whether one read shows the screen the kit sends its return on (#673, as
 * test/system/pi-compact.test.js reads it for `/compact`): Pi's input box
 * with its editor reading `/new` once trimmed, or its editor blank and Orca's
 * draft reading `/new` once trimmed, and no row starting `→` below the box.
 */
function readyForReturn({ rows, draft }) {
  const box = inputBoxOf(rows ?? []);
  if (box?.top === undefined) return false;
  const editor = box.editor.map((row) => row.trim()).filter((row) => row !== '');
  const line = editor.length === 0 ? String(draft ?? '').trim() : editor.join(' ');
  return line === '/new' && !box.below.some((row) => row.trimStart().startsWith('→'));
}

/**
 * Start this checkout's `obk`, by its full path, outside any tab, and do not
 * wait for it: the screen is read while it runs. `finished` turns true when
 * it has ended, and `done` gives { status, stdout, stderr }. Nothing here
 * signals it; the kit's own waits bound it.
 */
function obkInBackground(args) {
  const run = { finished: false, stdout: '', stderr: '' };
  const child = spawn(process.execPath, [cliEntry, ...args], { cwd: os.tmpdir(), env: outsideAnyTab, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.setEncoding('utf8').on('data', (chunk) => { run.stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { run.stderr += chunk; });
  run.done = new Promise((resolve) => {
    child.on('error', (error) => {
      run.finished = true;
      resolve({ status: null, stdout: run.stdout, stderr: `${run.stderr}could not start obk: ${error.message}` });
    });
    child.on('close', (status) => {
      run.finished = true;
      resolve({ status, stdout: run.stdout, stderr: run.stderr });
    });
  });
  return run;
}

// ------------------------------------------------------------- the test

test('obk session clear on a Pi session: a new id in the book when idle, refused as busy with nothing typed during a turn, and the tab idle and empty at the end', async (t) => {
  deadline = Date.now() + TOTAL_MS;
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
    pi: Object.fromEntries(PI_SETTINGS.map((name) => [name, hashOf(path.join(PI_AGENT, name))])),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-pi-clear-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', BOT].map(homeOf);
  const home = homeOf(BOT);
  t.diagnostic(`this run names this file: ${namedThisRun(THIS_FILE)}; local time ${new Date().toTimeString().slice(0, 5)}`);

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
    // Orca's sidebar keeps a deleted project's row until its window is rebuilt (#343).
    if (deleted > 0 && !(await reloadWindow())) t.diagnostic(RELOAD_LINE);

    // Pi's own settings files, compared and reported before any assert can stop the teardown; never written.
    for (const name of PI_SETTINGS) {
      const now = hashOf(path.join(PI_AGENT, name));
      if (now !== before.pi[name]) t.diagnostic(`${path.join(PI_AGENT, name)} changed during the run (Pi's own write); nothing was copied back`);
    }
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
  // 1. The fleet: Bot Father, and one Pi bot with daily on the cheap model,
  // brought up. The book holds A; Pi's file for A holds the start turn; idle.
  obkJson(['init', '--bots', bots, '--harness', 'claude']);
  obkJson(['bot', 'create', '--bots', bots, '--name', BOT, '--harness', 'pi', '--charter', `${BOT} exists for one system test run and owns nothing.`]);
  obkJson(['session', 'add', '--bots', bots, '--bot', BOT, '--name', SESSION, '--model', MODEL, '--effort', EFFORT, `--prompt=${PROMPT}`]);
  const up = tabOf(obkJson(['up', '--bots', bots, '--bot', BOT]), SESSION);
  assert.equal(up.created, true, `the premise: up opened ${SESSION}'s tab: ${JSON.stringify(up)}`);
  const tab = { title: up.title, handle: up.terminal };
  const piFolder = path.join(PI_SESSIONS, piFolderNameOf(realpathSync(home)));

  const idA = sessionIn(home, SESSION).session;
  assert.match(String(idA), /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/, `step 1: the book holds a Pi session id A for ${SESSION}: ${JSON.stringify(sessionIn(home, SESSION))}`);
  await loadedForTyping(t, tab, 'step 1, the start turn', { bots, homes });

  await until(
    `step 1: Pi's file for A (${idA}) to hold the start turn's reply, and the tab to be idle`,
    ANSWER_MS,
    async () => {
      const found = piFileIn(piFolder, idA);
      return turnsOf(piLinesOf(found), 'assistant').some((text) => text.trim() !== '') && idleNow(tab.handle) ? found : undefined;
    },
    () => ` Looked in ${piFolder} for *_${idA}.jsonl.\n  Its tail:\n    ${tailOf(piLinesOf(piFileIn(piFolder, idA)))}${whatIsUp(tab.handle)}`,
    async () => assertNoQuestion(tab.handle, 'step 1, while the start turn ran'),
  );
  printScreen(t, 'step 1, Pi at rest after its start turn, before anything is typed', tab.handle);
  assertEditorEmpty(tab.handle, 'step 1, before anything is typed');

  // ---------------------------------------------------------------------------
  // 2. Research: `/new` and `/new ` typed by this test, one character a send,
  // read before any return, and taken back. No return goes in, so no /new
  // runs: the book still holds A.
  for (const text of ['/new', '/new ']) {
    await typeSlowly(tab.handle, text);
    await setTimeout(DRAW_MS);
    printScreen(t, `step 2, ${JSON.stringify(text)} typed by this test one character a send, ${CHAR_GAP_MS} ms apart, before any return`, tab.handle);
    send(tab.handle, '\x7f'.repeat(text.length));
    await setTimeout(DRAW_MS);
    printScreen(t, `step 2, after ${text.length} backspaces in one send took ${JSON.stringify(text)} back`, tab.handle);
    assertEditorEmpty(tab.handle, `step 2, after ${JSON.stringify(text)} was taken back`);
    assert.equal(sessionIn(home, SESSION).session, idA, `step 2: no /new ran: the book still holds A after ${JSON.stringify(text)} was typed and taken back`);
  }

  // ---------------------------------------------------------------------------
  // 3 (a). `obk session clear` on the idle Pi session: exit 0, harness pi, and
  // the book holds B, not A, with A in daily's history. The screen is printed
  // as it changes. #673: the kit types `/new`, then a space, then the return
  // only when the editor reads `/new` and no menu row is below the box. This
  // run must show that moment: the screen is read every DURING_FAST_MS, and
  // the first read with the editor reading `/new` (or Orca's draft reading
  // it, trimmed) and no row starting `→` below the box is printed as the
  // screen before the return. The book is read just before each such read:
  // when it still held A then, the new id B came after the screen before the
  // return. When no read caught it, the run says so as a finding; the clear
  // is still asserted.
  await until('step 3: the Pi tab to be idle before the clear', READY_MS, async () => (idleNow(tab.handle) ? true : undefined), () => whatIsUp(tab.handle));
  printScreen(t, 'step 3, before obk session clear', tab.handle);
  const clearAt = Date.now();
  const running = obkInBackground(['session', 'clear', '--bots', bots, '--bot', BOT, '--session', SESSION, '--json']);
  let shown;
  let prints = 0;
  let beforeReturn;
  while (!running.finished && Date.now() - clearAt < CLEAR_LIMIT_MS) {
    const book = sessionIn(home, SESSION).session;
    const read = readOf(tab.handle);
    const since = Date.now() - clearAt;
    if (beforeReturn === undefined && readyForReturn(read)) {
      beforeReturn = { ...read, since, book };
      printRows(t, `step 3, the screen before the return: the editor reads /new and no menu is below the box, ${since} ms after the clear started; the book held ${book} just before this read`, read);
    }
    const rows = JSON.stringify(read.rows);
    if (rows !== shown && prints < DURING_PRINTS) {
      printRows(t, `step 3, during obk session clear, ${since} ms after it started`, read);
      shown = rows;
      prints += 1;
    }
    await setTimeout(beforeReturn === undefined ? DURING_FAST_MS : DURING_EVERY_MS);
  }
  assert.ok(running.finished, `step 3: obk session clear did not end within ${CLEAR_LIMIT_MS} ms.${whatIsUp(tab.handle)}`);
  const clear = await running.done;
  assert.ok(!/worktree/i.test(clear.stdout + clear.stderr), `obk said "worktree": ${clear.stdout}${clear.stderr}`);
  t.diagnostic(`step 3: obk session clear took ${Date.now() - clearAt} ms, exit ${clear.status}: ${clear.stdout.trim()} ${clear.stderr.trim()}`);
  printScreen(t, 'step 3, after obk session clear', tab.handle);
  assert.equal(clear.status, 0, `step 3: the clear on an idle Pi session should go through: ${clear.stdout}${clear.stderr}${whatIsUp(tab.handle)}`);
  let cleared;
  try {
    ({ cleared } = JSON.parse(clear.stdout));
  } catch {
    assert.fail(`step 3: obk session clear --json did not print JSON: ${clear.stdout}`);
  }
  assert.equal(cleared?.bot, BOT, `step 3: ${JSON.stringify(cleared)}`);
  assert.equal(cleared.session, SESSION, `step 3: ${JSON.stringify(cleared)}`);
  assert.equal(cleared.harness, 'pi', `step 3: the answer says harness pi: ${JSON.stringify(cleared)}`);
  assert.equal(cleared.was, idA, `step 3: the answer says which conversation it was: ${JSON.stringify(cleared)}`);
  assert.notEqual(cleared.now, idA, `step 3: and a new one: ${JSON.stringify(cleared)}`);
  const idB = cleared.now;
  const entryB = sessionIn(home, SESSION);
  assert.equal(entryB.session, idB, `step 3: the book holds the new id B: ${JSON.stringify(entryB)}`);
  assert.ok(historyHolds(entryB, idA), `step 3: with A in daily's history: ${JSON.stringify(entryB)}`);
  if (beforeReturn === undefined) {
    t.diagnostic('step 3, FINDING: no read during the clear caught the screen before the return (the editor reading /new with no menu below the box), '
      + `though the screen was read every ${DURING_FAST_MS} ms until then. So this run does not show that the return after the space is what ran Pi's /new.`);
  } else {
    t.diagnostic(`step 3: the screen before the return was read ${beforeReturn.since} ms after the clear started; the book held ${beforeReturn.book} just before that read, and holds ${idB} now`);
    assert.equal(beforeReturn.book, idA, `step 3: the book still held A when the screen before the return was read, so the new id B came after it; it held ${beforeReturn.book}`);
  }

  // ---------------------------------------------------------------------------
  // 4 (b). A turn that runs `sleep` through Pi's bash tool. While it runs,
  // the clear is refused as busy within about 30 s, and nothing is typed.
  await until(
    'step 4: the Pi tab to be idle after the clear',
    READY_MS,
    async () => (idleNow(tab.handle) ? true : undefined),
    () => whatIsUp(tab.handle),
    async () => assertNoQuestion(tab.handle, 'step 4, while the tab settled after the clear'),
  );
  printScreen(t, 'step 4, at rest after the clear, before the busy turn', tab.handle);
  await pressIn(tab.handle, BUSY_LINE);
  const busySeen = await until(
    `step 4: Pi to be at work on its sleep ${BUSY_SECONDS}: Orca's tui-idle not ok, or Pi's top rule at work`,
    BUSY_START_MS,
    async () => {
      const tui = tuiLook(tab.handle);
      const rows = rowsOf(tab.handle) ?? [];
      return !tui.ok || atWorkOn(rows) ? { tui, row: atWorkOn(rows) } : undefined;
    },
    () => whatIsUp(tab.handle),
    async () => assertNoQuestion(tab.handle, 'step 4, while the busy turn started'),
  );
  t.diagnostic(`step 4: busy seen: tui-idle ${busySeen.tui.said}; Pi's top rule at work: ${busySeen.row}`);
  printScreen(t, 'step 4, during the busy turn, before the clear', tab.handle);
  const busyAt = Date.now();
  const refused = obk(['session', 'clear', '--bots', bots, '--bot', BOT, '--session', SESSION]);
  const took = Date.now() - busyAt;
  t.diagnostic(`step 4: obk session clear during the busy turn took ${took} ms, exit ${refused.status}: ${refused.stdout.trim()} ${refused.stderr.trim()}`);
  printScreen(t, 'step 4, during the busy turn, after the refused clear', tab.handle);
  assert.notEqual(refused.status, 0, `step 4: a clear on a busy Pi session should be refused: ${refused.stdout}${refused.stderr}`);
  assert.match(refused.stdout + refused.stderr, /busy/i, `step 4: and say it is busy: ${refused.stdout}${refused.stderr}`);
  assert.ok(took < BUSY_REFUSAL_MS, `step 4: and refuse within about 30 s; it took ${took} ms`);
  assert.equal(sessionIn(home, SESSION).session, idB, 'step 4: the book holds the same id B: nothing was cleared');
  assertEditorEmpty(tab.handle, 'step 4, after the refused clear');

  // ---------------------------------------------------------------------------
  // 5 (c). The busy turn ends; the tab is idle and its editor empty.
  await until(
    `step 5: Pi's file for B (${idB}) to hold a reply after the busy line, and the tab to be idle`,
    ANSWER_MS,
    async () => {
      const lines = piLinesOf(piFileIn(piFolder, idB));
      const at = lines.findIndex((line) => line.type === 'message' && line.message?.role === 'user' && textOf(line.message.content).includes(`sleep ${BUSY_SECONDS}`));
      const replied = at >= 0 && lines.slice(at + 1).some((line) => line.type === 'message' && line.message?.role === 'assistant' && textOf(line.message.content).trim() !== '');
      return replied && idleNow(tab.handle) ? true : undefined;
    },
    () => ` B's file's tail:\n    ${tailOf(piLinesOf(piFileIn(piFolder, idB)))}${whatIsUp(tab.handle)}`,
    async () => assertNoQuestion(tab.handle, 'step 5, while the busy turn ran'),
  );
  printScreen(t, 'step 5, at rest at the end', tab.handle);
  assert.ok(idleNow(tab.handle), `step 5: the tab is idle at the end.${whatIsUp(tab.handle)}`);
  assertEditorEmpty(tab.handle, 'step 5, at the end');
  assert.equal(sessionIn(home, SESSION).session, idB, 'step 5: and the book still holds B');

  // ---------------------------------------------------------------------------
  // 6. The bot retired; the teardown does the rest.
  const retired = obkJson(['retire', '--bots', bots, '--bot', BOT]);
  closedByKit(retired.closed);
  const left = await terminalsAfterClosing(home, [tab.handle]);
  assert.equal(left.some((one) => one.handle === tab.handle), false, `step 6: the retire closed ${SESSION}'s tab in Orca`);
});
