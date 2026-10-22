// A system test: `obk session compact` on a Pi session (#671), against the
// real Orca and a real Pi on this machine. Run it alone with
// `npm run test:system -- --yes test/system/pi-compact.test.js`; `npm test`
// cannot, and no CI machine could.
//
// What it shows, with one Pi bot in a throwaway bots folder, its session
// daily on openai/gpt-6-luna at thinking low, and a start prompt that asks for
// one word and no tool:
//
//   a. Three turns that each read one throwaway file of this test's own with
//      Pi's read tool, so that the conversation is large enough to compact.
//      Pi 1.3.0 keeps the last 20000 tokens or so (its keepRecentTokens, by
//      its estimate of 4 characters a token) and compacts only what is
//      older; a conversation smaller than that answers "Nothing to compact
//      (session too small)" and writes nothing (read in its code,
//      core/compaction/compaction.js). Each file is about 47 KB, under the
//      read tool's 50 KB cut, so the three are about 36000 tokens.
//   b. `obk session compact` on the idle Pi session exits 0, its JSON answer
//      says harness pi, the book's conversation and confirmed true, and Pi's
//      session file for that id holds one more `compaction` line, dated after
//      the command started. The book still holds the same id. The kit types
//      `/compact`, a space, and then its return only when the editor reads
//      `/compact` with no menu below the box (the architect's ruling, #671):
//      the run prints that screen when a read catches it, and asserts a
//      compaction dated after it; when no read catches it, it says so as a
//      finding.
//   c. While Pi runs one turn that does only `sleep 40` through its bash tool,
//      `obk session compact` is refused as busy within about 30 s, and nothing
//      was typed: Pi's editor is still empty, and its file holds no more
//      compactions than before.
//   d. At the end, the tab is idle and its editor empty.
//
// It is also the research for the tech notes (#671): Pi's /compact screens in
// the unit suite are reconstructions from Pi 1.3.0's code. So it prints the
// rows of `orca terminal read --screen` of its own tab, with Orca's `draft`
// when Orca gives one: at rest before anything is typed; with `/c`, with
// `/compact` and with `/compact ` typed by this test, before any return; during the kit's compact,
// each time the screen changes, to see what Pi shows while it compacts; after
// the compact; during the busy turn; and at the end. It also says how long the
// compact took: the kit's whole run, and from its start to the compaction's
// own timestamp. The `/c`, `/compact` and `/compact ` steps are the test's own typing,
// before the kit's compact runs: one character a send, 100 ms apart, then
// taken back with one send of as many backspaces (\x7f), and the editor is
// checked empty again. No return is ever sent after them. Those prints are
// research, not assertions.
//
// How the editor is read here, after Pi 1.3.0's code (the reconstruction of
// #663, as test/system/pi-clear.test.js reads it): the input box's bottom rule
// is the lowest row on the screen that is `─` alone, or `─` with Pi's scroll
// label ` ↓ <n> more `; its top rule is the nearest row above that which is a
// rule of the same full width (starts `──`, ends `─`, exactly as long); every
// row between them is an editor row. Pi is at work when that top rule holds
// any text besides `─` and the scroll label ` ↑ <n> more `. When the screen
// has no such box, the check that needs it fails, with the screen in the
// message: that is a finding about the reconstruction.
//
// **The tab must be real after `obk up` alone.** Orca lists a tab of a
// project its window has not loaded as orphaned (`orphaned: true`, tab id
// `pty:<ptyId>`), and this test cannot read such a tab as the window shows it
// (tech notes, section 1; #579). A tab counts as real only when Orca lists it
// with `orphaned: false` and a tab id that does not start with `pty:`. Since
// #676, the kit's command that opens a tab makes the Orca window load the
// bot's project, so the tab is real. Before it types into a tab, the test
// looks at that tab and prints what it saw. When the tab is not real, the test
// fails at once and says so: which tab, what Orca listed, and whether the
// command's answer named a `windowTrouble`. It does not wait for the tab to
// turn real.
// It looks again every second for WATCH_MS (10 s), and fails at the first
// look that finds the tab orphaned: #676 saw a new tab real when it opened
// and orphaned 2 s to 7 s later, so one look could miss a failure.
//
// **This test makes no extra project.** Until #676, it opened one more
// throwaway project with one plain tab when its tab was orphaned, and that
// made the tab real (#561, #634); the cause was not known then. #676 found the
// cause (tech notes, section 1), and that extra project would now hide whether
// the kit's own command makes the tab real.
//
// **The night gate.** The owner's rule (2026-10-17): a test that makes a
// throwaway tab real in the owner's Orca window runs that part only in a run
// that names its file, between midnight and 6 am local time
// (helpers/night-gate.js). Since #676, `obk init` and `obk up` themselves make
// the tabs they open real. So the gate covers the whole live part, from before
// the test makes its bots folder, and it starts only when both hold:
//
//   - the local hour is 0 to 5 (between midnight and 6 am), and
//   - the run named this file (the runner's OBK_SYSTEM_NAMED holds its path).
//
// Otherwise it opens nothing, says why, and is reported as skipped: nothing
// live was checked.
//
// The machine it runs on is someone's working machine. So this test, like the
// ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory, and
//     keeps its files for Pi to read beside it, in `<bots>.filler`, which the
//     teardown removes with the bots folder's other siblings;
//   - writes down every terminal and workspace Orca already had, before it
//     creates anything;
//   - runs this checkout's `src/cli.js` by its full path, never the machine's
//     `obk` (#220), outside any tab of its own caller;
//   - types only into its own Pi tab: `/c`, `/compact` and `/compact `, each one character
//     a send and taken back, and the lines of its own turns with a return;
//     every other key is the kit's own compact;
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
// session file for the book's id, to see a turn end and the compaction.
// Nothing under ~/.pi is written by it, and it reads no credential.
// settings.json and trust.json in ~/.pi/agent are compared before and after,
// and a change is reported, not undone. models.json is left out: it can hold
// a provider's API key.
//
// What it cannot clean up, and says so: the Run mailbox `up` makes (Orca has
// no `run-delete`), and whatever Orca keeps of its own for the tabs.
//
// It runs at night: the owner's rule is that a live test that mounts a
// throwaway tab in the owner's open Orca runs between midnight and 6 am. It
// takes several minutes and spends five short Pi turns and one compaction of
// about 36000 tokens on the cheapest model. TOTAL_MS bounds the whole test;
// every wait inside it is bounded by its own limit and by what is left of
// TOTAL_MS.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
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
import { atNight, namedThisRun } from '../helpers/night-gate.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/** The Orca CLI that works for a normal user (tech notes, section 1). */
const ORCA = process.env.OBK_ORCA || '/Applications/Orca.app/Contents/Resources/bin/orca';

/** This file, as the runner names it in OBK_SYSTEM_NAMED. */
const THIS_FILE = fileURLToPath(import.meta.url);

/** The longest the whole test may take, its teardown not counted. */
const TOTAL_MS = 2400000;

/** How long a tab is given to come up and be idle. */
const READY_MS = 180000;

/** How long a Pi turn is given, and its record to show it. */
const ANSWER_MS = 240000;

/** How long the busy turn is given to show as busy, from its return. */
const BUSY_START_MS = 60000;

/** The longest one run of the kit's `obk` may take here, but for the compact. */
const OBK_LIMIT_MS = 120000;

/** The longest the kit's compact may take: its 30 s wait for an idle session, its typing, its 5 minutes for Pi's record, and some to spare. */
const COMPACT_LIMIT_MS = 420000;

/** How often the screen is looked at while the kit's compact runs. */
const DURING_EVERY_MS = 1000;

/** How often the screen is read while the kit's compact runs, until the screen before its return is caught. */
const DURING_FAST_MS = 100;

/** At most this many screens are printed while the kit's compact runs, each one only when the rows changed. */
const DURING_PRINTS = 12;

/** How long a refusal for a busy session may take: the kit's 30 s wait, and some to spare. */
const BUSY_REFUSAL_MS = 60000;

/** The gap between the characters this test types itself, as the kit spaces its own. */
const CHAR_GAP_MS = 100;

/** How long the tab is given to draw what was typed before it is read. */
const DRAW_MS = 1000;

/** How long the tab is given to take a key in before the return that goes after it. */
const KEY_GAP_MS = 1000;

/**
 * How long a judged look watches a tab after the kit's command that opened it,
 * and how often it looks: #676 saw a new tab real when it opened and orphaned
 * 2 s to 7 s later. The tab must be real at every look in that time.
 */
const WATCH_MS = 10000;
const WATCH_STEP_MS = 1000;

const BOT = 'pi-compact-bot';
const SESSION = 'daily';

/** The Pi model and effort: the cheapest the tech notes name. */
const MODEL = 'openai/gpt-6-luna';
const EFFORT = 'low';

/** The one word the start prompt asks for. */
const CODE = 'PLOVER-6710';

/** The start prompt: one word to say, and nothing else. */
const PROMPT = 'You are a system test\'s session and you own nothing. Do not run any command, read or write any file,'
  + ` or use any tool. Reply now with ${CODE} and nothing else, then wait.`;

/** How many files Pi reads, one a turn, to make the conversation large enough to compact. */
const FILLERS = 3;

/** The lines in each file, each 25 characters with its newline: about 47 KB, under Pi's read tool cut of 50 KB and 2000 lines. */
const FILLER_LINES = 1900;

/** The line for one file's turn: read it with the read tool, and reply with one word. */
const fillerLine = (file, n) => `Use your read tool once to read exactly the file ${file}. Read no other file, run no command and write nothing.`
  + ` When you have read it, reply READ-${n} and nothing else.`;

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

/** The files in ~/.pi/agent this test compares, never writes. Neither holds a credential; models.json may, so it is not read. */
const PI_SETTINGS = ['settings.json', 'trust.json'];

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
function obk(args, limit = OBK_LIMIT_MS) {
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

// ------------------------------------------------------------- the tab is real

/** What an `obk ... --json` answer said of its step that makes the Orca window load a bot's project (#676), in words. */
function windowWords(answer) {
  const trouble = (answer?.projects ?? []).filter((one) => one.windowTrouble !== undefined);
  return trouble.length === 0
    ? 'Its answer named no windowTrouble, so that step said it worked.'
    : `Its answer named windowTrouble, so that step failed: ${trouble.map((one) => `${one.bot}: ${one.windowTrouble}`).join('; ')}.`;
}

/**
 * Before the test types into a tab ({ title, handle }): Orca lists the tab as
 * real, or the test fails at once and says why. `by` names the kit's command
 * that opened the tab, and `answer` is its --json answer: since #676
 * that command makes the Orca window load the bot's project. This test opens
 * no extra project and does not wait for the tab to turn real.
 * It looks again every WATCH_STEP_MS for WATCH_MS, and fails at the first
 * look that finds the tab orphaned. `screen` is run between the looks.
 */
async function loadedForTyping(t, { title, handle }, why, { by, answer, screen = async () => {} }) {
  const start = Date.now();
  let looks = 0;
  for (;;) {
    const entry = listed(handle);
    const since = Math.round((Date.now() - start) / 1000);
    assert.ok(entry !== undefined, `${title}: Orca no longer lists its tab ${handle}${looks === 0 ? '' : `, ${since} s after the first look before ${why}`}`);
    if (looks === 0) t.diagnostic(`${title} (${handle}) before ${why}: ${orphanWords(handle)}`);
    assert.ok(realTab(entry), [
      looks === 0
        ? `Orca lists ${title}'s tab ${handle} as orphaned before ${why} (orphaned: ${entry.orphaned}, tab id ${entry.tabId}).`
        : `Orca lists ${title}'s tab ${handle} as orphaned ${since} s after the first look before ${why} (orphaned: ${entry.orphaned}, tab id ${entry.tabId}); it was real at the ${looks} looks before that.`,
      `\`${by}\` should have made the Orca window load the bot's project, so that its tabs are real (#676). ${windowWords(answer)}`,
      'An orphaned tab is not a tab the Orca window has loaded, so this test cannot read it as the window shows it, and types nothing into it.',
      `This test opens no extra project and does not wait for the tab to turn real: it must be real at the first look and stay real for ${WATCH_MS / 1000} s.`,
    ].join('\n'));
    looks += 1;
    if (Date.now() - start >= WATCH_MS) break;
    await screen();
    await setTimeout(WATCH_STEP_MS);
  }
  t.diagnostic(`${title} (${handle}): listed real at each of ${looks} looks over ${WATCH_MS / 1000} s after ${by}`);
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


/** The compaction lines in a Pi file's lines. */
const compactionsIn = (lines) => lines.filter((line) => line.type === 'compaction');

/** Whether a Pi file's lines hold a reply holding `word` after the user turn holding `asked`. */
function repliedAfter(lines, asked, word) {
  const at = lines.findIndex((line) => line.type === 'message' && line.message?.role === 'user' && textOf(line.message.content).includes(asked));
  return at >= 0 && lines.slice(at + 1).some((line) => line.type === 'message' && line.message?.role === 'assistant' && textOf(line.message.content).includes(word));
}

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
 * Whether one read shows the screen the kit sends its return on (the
 * architect's ruling, #671): Pi's input box with its editor reading
 * `/compact` once trimmed, or its editor blank and Orca's draft reading
 * `/compact` once trimmed, and no row starting `→` below the box.
 */
function readyForReturn({ rows, draft }) {
  const box = inputBoxOf(rows ?? []);
  if (box?.top === undefined) return false;
  const editor = box.editor.map((row) => row.trim()).filter((row) => row !== '');
  const line = editor.length === 0 ? String(draft ?? '').trim() : editor.join(' ');
  return line === '/compact' && !box.below.some((row) => row.trimStart().startsWith('→'));
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

test('obk session compact on a Pi session: a compaction in Pi\'s file when idle, refused as busy with nothing typed during a turn, and the tab idle and empty at the end', async (t) => {
  // The night gate (the header says why): the whole live part, from before
  // the bots folder is made, runs only in a night run that names this file.
  const now = new Date();
  const night = atNight(now);
  const named = namedThisRun(THIS_FILE);
  if (!(night && named)) {
    t.skip([
      `this run is at ${now.toTimeString().slice(0, 5)} local time and ${named ? 'names this file' : 'does not name this file'}, so it opened nothing and checked nothing live.`,
      'Its obk init and obk up make throwaway tabs real in the Orca window (#676), so its live part starts only in a run that names this file, between midnight and 6 am local time:',
      '  npm run test:system -- --yes test/system/pi-compact.test.js',
    ].join(' '));
    return;
  }

  deadline = Date.now() + TOTAL_MS;
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
    pi: Object.fromEntries(PI_SETTINGS.map((name) => [name, hashOf(path.join(PI_AGENT, name))])),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-pi-compact-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', BOT].map(homeOf);
  const home = homeOf(BOT);

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
  const upAnswer = obkJson(['up', '--bots', bots, '--bot', BOT]);
  const up = tabOf(upAnswer, SESSION);
  assert.equal(up.created, true, `the premise: up opened ${SESSION}'s tab: ${JSON.stringify(up)}`);
  const tab = { title: up.title, handle: up.terminal };
  const piFolder = path.join(PI_SESSIONS, piFolderNameOf(realpathSync(home)));

  const idA = sessionIn(home, SESSION).session;
  assert.match(String(idA), /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/, `step 1: the book holds a Pi session id A for ${SESSION}: ${JSON.stringify(sessionIn(home, SESSION))}`);
  await loadedForTyping(t, tab, 'step 1, the start turn', { by: 'obk up', answer: upAnswer, screen: async () => assertNoQuestion(tab.handle, 'step 1, while its tab was watched') });

  const fileA = await until(
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
  // 2. Something to compact: three turns, each reading one file of this
  // test's own with Pi's read tool.
  const fillers = `${bots}.filler`;
  await mkdir(fillers);
  for (let n = 1; n <= FILLERS; n += 1) {
    const file = path.join(fillers, `part-${n}.txt`);
    const lines = Array.from({ length: FILLER_LINES }, (_, at) => `part ${n} line ${String(at + 1).padStart(4, '0')} ok`.padEnd(24, '.'));
    await writeFile(file, `${lines.join('\n')}\n`);
    await until(`step 2: the Pi tab to be idle before turn ${n}`, READY_MS, async () => (idleNow(tab.handle) ? true : undefined), () => whatIsUp(tab.handle));
    await pressIn(tab.handle, fillerLine(file, n));
    await until(
      `step 2: Pi's file for A to hold READ-${n} after the turn that reads ${file}, and the tab to be idle`,
      ANSWER_MS,
      async () => (repliedAfter(piLinesOf(fileA), file, `READ-${n}`) && idleNow(tab.handle) ? true : undefined),
      () => ` A's file's tail:\n    ${tailOf(piLinesOf(fileA))}${whatIsUp(tab.handle)}`,
      async () => assertNoQuestion(tab.handle, `step 2, while turn ${n} ran`),
    );
  }
  t.diagnostic(`step 2: Pi's file for A is ${readFileSync(fileA).length} bytes after ${FILLERS} turns that read ${FILLER_LINES} lines each`);
  const compactionsBefore = compactionsIn(piLinesOf(fileA)).length;
  t.diagnostic(`step 2: compactions in A's file before the compact: ${compactionsBefore}`);

  // ---------------------------------------------------------------------------
  // 3. Research: `/c`, `/compact` and `/compact ` (with the space the kit
  // types before its return) typed by this test, one character a send, read
  // before any return, and taken back. No return goes in, so no command runs:
  // no compaction is written.
  for (const text of ['/c', '/compact', '/compact ']) {
    await typeSlowly(tab.handle, text);
    await setTimeout(DRAW_MS);
    printScreen(t, `step 3, ${JSON.stringify(text)} typed by this test one character a send, ${CHAR_GAP_MS} ms apart, before any return`, tab.handle);
    send(tab.handle, '\x7f'.repeat(text.length));
    await setTimeout(DRAW_MS);
    printScreen(t, `step 3, after ${text.length} backspaces in one send took ${JSON.stringify(text)} back`, tab.handle);
    assertEditorEmpty(tab.handle, `step 3, after ${JSON.stringify(text)} was taken back`);
  }
  assert.equal(compactionsIn(piLinesOf(fileA)).length, compactionsBefore, 'step 3: no compaction ran from the typing that was taken back');

  // ---------------------------------------------------------------------------
  // 4 (b). `obk session compact` on the idle Pi session: exit 0, harness pi,
  // the book's conversation A, confirmed, and one more compaction in A's file,
  // dated after the command started. The screen is printed as it changes.
  // The architect's ruling (#671): the kit types `/compact`, then a space,
  // then the return only when the editor reads `/compact` and no menu row is
  // below the box. This run must show that moment: the screen is read every
  // DURING_FAST_MS, and the first read with the editor reading `/compact`
  // (or Orca's draft reading it, trimmed) and no row starting `→` below the
  // box is printed as the screen before the return. When no read caught it,
  // the run says so as a finding; the compaction is still asserted.
  await until('step 4: the Pi tab to be idle before the compact', READY_MS, async () => (idleNow(tab.handle) ? true : undefined), () => whatIsUp(tab.handle));
  printScreen(t, 'step 4, before obk session compact', tab.handle);
  const compactAt = Date.now();
  const running = obkInBackground(['session', 'compact', '--bots', bots, '--bot', BOT, '--session', SESSION, '--json']);
  let shown;
  let prints = 0;
  let beforeReturn;
  while (!running.finished && Date.now() - compactAt < COMPACT_LIMIT_MS) {
    const read = readOf(tab.handle);
    const since = Date.now() - compactAt;
    if (beforeReturn === undefined && readyForReturn(read)) {
      beforeReturn = { ...read, since };
      printRows(t, `step 4, the screen before the return: the editor reads /compact and no menu is below the box, ${since} ms after the compact started`, read);
    }
    const rows = JSON.stringify(read.rows);
    if (rows !== shown && prints < DURING_PRINTS) {
      printRows(t, `step 4, during obk session compact, ${since} ms after it started`, read);
      shown = rows;
      prints += 1;
    }
    await setTimeout(beforeReturn === undefined ? DURING_FAST_MS : DURING_EVERY_MS);
  }
  assert.ok(running.finished, `step 4: obk session compact did not end within ${COMPACT_LIMIT_MS} ms.${whatIsUp(tab.handle)}`);
  const compact = await running.done;
  const took = Date.now() - compactAt;
  t.diagnostic(`step 4: obk session compact took ${took} ms, exit ${compact.status}: ${compact.stdout.trim()} ${compact.stderr.trim()}`);
  printScreen(t, 'step 4, after obk session compact', tab.handle);
  assert.ok(!/worktree/i.test(compact.stdout + compact.stderr), `obk said "worktree": ${compact.stdout}${compact.stderr}`);
  assert.equal(compact.status, 0, `step 4: the compact on an idle Pi session should go through: ${compact.stdout}${compact.stderr}${whatIsUp(tab.handle)}`);
  let compacted;
  try {
    ({ compacted } = JSON.parse(compact.stdout));
  } catch {
    assert.fail(`step 4: obk session compact --json did not print JSON: ${compact.stdout}`);
  }
  const fresh = compactionsIn(piLinesOf(fileA)).slice(compactionsBefore);
  for (const line of fresh) {
    t.diagnostic(`step 4: a compaction in A's file, dated ${line.timestamp}, ${Date.parse(line.timestamp) - compactAt} ms after the compact started; tokensBefore ${line.tokensBefore}; summary ${String(line.summary ?? '').length} characters`);
  }
  assert.deepEqual(compacted, { bot: BOT, session: SESSION, harness: 'pi', conversation: idA, confirmed: true }, `step 4: the answer says the compact of A is confirmed, harness pi.\n  A's file's tail:\n    ${tailOf(piLinesOf(fileA))}`);
  assert.ok(fresh.some((line) => Date.parse(line.timestamp) >= compactAt), `step 4: A's file holds a compaction dated after the compact started, got: ${JSON.stringify(fresh.map((line) => line.timestamp))}`);
  if (beforeReturn === undefined) {
    t.diagnostic('step 4, FINDING: no read during the compact caught the screen before the return (the editor reading /compact with no menu below the box), '
      + `though the screen was read every ${DURING_FAST_MS} ms until then. So this run does not show that the return after the space is what ran Pi's compact.`);
  } else {
    const after = fresh.filter((line) => Date.parse(line.timestamp) >= compactAt + beforeReturn.since);
    t.diagnostic(`step 4: the screen before the return was read ${beforeReturn.since} ms after the compact started; compactions dated after that read: ${after.length}`);
    assert.ok(after.length > 0, `step 4: a compaction in A's file is dated after the screen before the return was read, got: ${JSON.stringify(fresh.map((line) => line.timestamp))}`);
  }
  assert.equal(sessionIn(home, SESSION).session, idA, 'step 4: a compact leaves the book on A');
  const compactions = compactionsIn(piLinesOf(fileA)).length;

  // ---------------------------------------------------------------------------
  // 5 (c). A turn that runs `sleep` through Pi's bash tool. While it runs,
  // the compact is refused as busy within about 30 s, and nothing is typed.
  await until(
    'step 5: the Pi tab to be idle after the compact',
    READY_MS,
    async () => (idleNow(tab.handle) ? true : undefined),
    () => whatIsUp(tab.handle),
    async () => assertNoQuestion(tab.handle, 'step 5, while the tab settled after the compact'),
  );
  printScreen(t, 'step 5, at rest after the compact, before the busy turn', tab.handle);
  await pressIn(tab.handle, BUSY_LINE);
  const busySeen = await until(
    `step 5: Pi to be at work on its sleep ${BUSY_SECONDS}: Orca's tui-idle not ok, or Pi's top rule at work`,
    BUSY_START_MS,
    async () => {
      const tui = tuiLook(tab.handle);
      const rows = rowsOf(tab.handle) ?? [];
      return !tui.ok || atWorkOn(rows) ? { tui, row: atWorkOn(rows) } : undefined;
    },
    () => whatIsUp(tab.handle),
    async () => assertNoQuestion(tab.handle, 'step 5, while the busy turn started'),
  );
  t.diagnostic(`step 5: busy seen: tui-idle ${busySeen.tui.said}; Pi's top rule at work: ${busySeen.row}`);
  printScreen(t, 'step 5, during the busy turn, before the compact', tab.handle);
  const busyAt = Date.now();
  const refused = obk(['session', 'compact', '--bots', bots, '--bot', BOT, '--session', SESSION]);
  const busyTook = Date.now() - busyAt;
  t.diagnostic(`step 5: obk session compact during the busy turn took ${busyTook} ms, exit ${refused.status}: ${refused.stdout.trim()} ${refused.stderr.trim()}`);
  printScreen(t, 'step 5, during the busy turn, after the refused compact', tab.handle);
  assert.notEqual(refused.status, 0, `step 5: a compact on a busy Pi session should be refused: ${refused.stdout}${refused.stderr}`);
  assert.match(refused.stdout + refused.stderr, /busy/i, `step 5: and say it is busy: ${refused.stdout}${refused.stderr}`);
  assert.ok(busyTook < BUSY_REFUSAL_MS, `step 5: and refuse within about 30 s; it took ${busyTook} ms`);
  assertEditorEmpty(tab.handle, 'step 5, after the refused compact');

  // ---------------------------------------------------------------------------
  // 6 (d). The busy turn ends; no compaction came of the refused compact; the
  // tab is idle and its editor empty.
  await until(
    `step 6: Pi's file for A to hold DONE after the busy line, and the tab to be idle`,
    ANSWER_MS,
    async () => (repliedAfter(piLinesOf(fileA), `sleep ${BUSY_SECONDS}`, 'DONE') && idleNow(tab.handle) ? true : undefined),
    () => ` A's file's tail:\n    ${tailOf(piLinesOf(fileA))}${whatIsUp(tab.handle)}`,
    async () => assertNoQuestion(tab.handle, 'step 6, while the busy turn ran'),
  );
  printScreen(t, 'step 6, at rest at the end', tab.handle);
  assert.equal(compactionsIn(piLinesOf(fileA)).length, compactions, 'step 6: the refused compact wrote no compaction into A\'s file');
  assert.ok(idleNow(tab.handle), `step 6: the tab is idle at the end.${whatIsUp(tab.handle)}`);
  assertEditorEmpty(tab.handle, 'step 6, at the end');
  assert.equal(sessionIn(home, SESSION).session, idA, 'step 6: and the book still holds A');

  // ---------------------------------------------------------------------------
  // 7. The bot retired; the teardown does the rest.
  const retired = obkJson(['retire', '--bots', bots, '--bot', BOT]);
  closedByKit(retired.closed);
  const left = await terminalsAfterClosing(home, [tab.handle]);
  assert.equal(left.some((one) => one.handle === tab.handle), false, `step 7: the retire closed ${SESSION}'s tab in Orca`);
});
