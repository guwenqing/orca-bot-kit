// A system test: the book follows a `/new` typed in a Pi tab (#662), against
// the real Orca and a real Pi on this machine. Run it alone with
// `npm run test:system -- --yes test/system/pi-new.test.js`; `npm test`
// cannot, and no CI machine could.
//
// What it shows, with one Pi bot in a throwaway bots folder, its session
// daily on openai/gpt-6-luna at thinking low, and a start prompt that asks for
// one word, a made-up code that is in no other text this test types:
//
//   1. `obk up` opens daily's Pi tab. The book holds an id A. After the start
//      prompt's turn, Pi's session file for A is in the bot home's session
//      folder under ~/.pi/agent/sessions (tech notes, section 6), with an
//      assistant reply, and Orca calls the tab idle.
//   2. The test types `/new` and a return into its own Pi tab, and nothing
//      else.
//   3. Within NEW_MS of that return, the book holds an id B that is not A, and
//      daily's history holds A. This is read from the book, never from Orca.
//      Then the tab is idle again.
//   4. The test types one short line into its own tab, asking for the word
//      `ok`. After that turn, Pi's session file for B is there: its header id
//      is B, it has no `parentSession`, and it holds a `custom_message` line
//      whose content has the start prompt's code (the kit's extension gave
//      the start prompt back with `pi.sendMessage`).
//   5. `obk restart` of daily. Its answer says the tab was resumed, and the
//      book still holds B. The line the kit typed is checked by what it made
//      Pi do, because Pi renames its process (`ps` shows `pi` with no
//      arguments, tech notes section 6) and Orca's `terminal read` gives the
//      screen only:
//        a. `--session-id B`: one more line typed into the new tab lands as a
//           user turn in B's own file, and the book still holds B;
//        b. `--extension <this clone's src/pi-record.js>`: a second `/new` in
//           the new tab is followed by the book within NEW_MS, a new id C with
//           B in daily's history. Only the kit's extension tells the book of
//           a `/new`, and only this clone's `src/cli.js` typed the line.
//      The screen right after the restart is also searched for the launch
//      line itself. If the line is on it, it must carry `--session-id B` and
//      `--extension <this clone's src/pi-record.js>`; if it is not, that is
//      printed, not failed (not seen live: what Pi leaves of the shell's echo).
//   6. `obk retire` of the bot, then the teardown below.
//
// **The tab must be real after `obk up` (or `obk restart`) alone.** Orca
// lists a tab of a project its window has not loaded as orphaned
// (`orphaned: true`, tab id `pty:<ptyId>`), and this test cannot read such a
// tab as the window shows it (tech notes, section 1; #579). A tab counts as
// real only when Orca lists it with `orphaned: false` and a tab id that does
// not start with `pty:`. Since
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
// It reads the gate again right before each later kit command that can open a
// tab or make the window load a project (`obk up`, `obk restart`). When the
// night ended during the run, it opens nothing more and fails, and names the
// step that did not run: such a run is not a pass.
//
// The machine it runs on is someone's working machine. So this test, like the
// ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory;
//   - writes down every terminal and workspace Orca already had, before it
//     creates anything;
//   - runs this checkout's `src/cli.js` by its full path, never the machine's
//     `obk` (#220), outside any tab of its own caller;
//   - types only into its own Pi tab: `/new` and a return, twice, and two
//     short lines asking for one word;
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
// warning that waits for a key, not a Pi list, nor any question the kit's
// shared look finds (helpers/screens.js `questionOn`). Any of them stops the
// run at once, with the screen in the failure message, and nothing is typed
// into it. The only screens a system test here may ever answer are Claude
// Code's plain folder trust (helpers/screens.js `onlyPlainTrustOf`) and its
// Teach form (`onlyTeachFormOf`); neither is a screen of Pi's, and this test
// types into no Claude Code tab, so it answers none. Bot Father's tab is left
// as it comes up.
//
// **Pi's records.** The runner removes the Pi session folders under
// ~/.pi/agent/sessions that the run's own throwaway folders caused (PR #638);
// it is the one deleter of them. This test removes none: it only reads Pi's
// session files for the book's ids. Nothing under ~/.pi is written by it;
// settings.json, trust.json and models.json in ~/.pi/agent are compared
// before and after, and a change is reported, not undone.
//
// What it cannot clean up, and says so: the Run mailbox `up` makes (Orca has
// no `run-delete`), and whatever Orca keeps of its own for the tabs.
//
// It runs at night: the owner's rule is that a live test that mounts a
// throwaway tab in the owner's open Orca runs between midnight and 6 am. It
// takes a few minutes and spends four short Pi turns. TOTAL_MS bounds the
// whole test; every wait inside it is bounded by its own limit and by what is
// left of TOTAL_MS.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
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
import { deleteOwnProject, placesOf, projectsInBots } from '../helpers/own-project.js';
import { atNight, namedThisRun } from '../helpers/night-gate.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/** The Orca CLI that works for a normal user (tech notes, section 1). */
const ORCA = process.env.OBK_ORCA || '/Applications/Orca.app/Contents/Resources/bin/orca';

/** This file, as the runner names it in OBK_SYSTEM_NAMED. */
const THIS_FILE = fileURLToPath(import.meta.url);

/**
 * The night gate again, right before a later kit command that can open a tab
 * or make the Orca window load a project (#687): the same rule as at the
 * test's start. When the night ended during the run, the test opens nothing
 * more and fails here, naming `step`, which did not run, so the run is not a
 * pass. The teardown runs as before.
 */
function gateStillOpen(step) {
  const now = new Date();
  const night = atNight(now);
  const named = namedThisRun(THIS_FILE);
  assert.ok(night && named, [
    `The night gate closed during this run: it is ${now.toTimeString().slice(0, 5)} local time${named ? '' : ', and this run does not name this file'}.`,
    `So this test opened nothing more: ${step} did not run, and no live step after it ran. This run is not a pass.`,
    `Run it again in a night run, between midnight and 6 am local time: npm run test:system -- --yes test/system/${path.basename(THIS_FILE)}`,
  ].join('\n'));
}

/** The longest the whole test may take, its teardown not counted. */
const TOTAL_MS = 1200000;

/** How long a tab is given to come up and be idle. */
const READY_MS = 180000;

/** How long a Pi turn is given, and its record to show it. */
const ANSWER_MS = 240000;

/** How long after the return of a `/new` the book is given to follow it. */
const NEW_MS = 15000;

/** How long the tab is given to take a key in before the return that goes after it. */
const KEY_GAP_MS = 1000;

/**
 * How long a judged look watches a tab after the kit's command that opened it,
 * and how often it looks: #676 saw a new tab real when it opened and orphaned
 * 2 s to 7 s later. The tab must be real at every look in that time.
 */
const WATCH_MS = 10000;
const WATCH_STEP_MS = 1000;

const BOT = 'pi-new-bot';
const SESSION = 'daily';

/** The Pi model and effort: the cheapest the tech notes name. */
const MODEL = 'openai/gpt-6-luna';
const EFFORT = 'low';

/** In the start prompt only: its first turn prints it, and the custom message after a /new carries it. */
const CODE = 'BITTERN-6620';

/** The start prompt: one word to say, and nothing else. */
const PROMPT = 'You are a system test\'s session and you own nothing. Do not run any command, read or write any file,'
  + ` or use any tool. Reply now with ${CODE} and nothing else, then wait.`;

/** The lines this test types after a /new and after the restart: each asks for one word, and neither carries CODE. */
const OK_LINE = 'Reply with the one word ok and nothing else.';
const YES_LINE = 'Reply with the one word yes and nothing else.';

/** The kit's Pi extension in this checkout: the one its launch line must name. */
const EXTENSION = path.join(path.dirname(cliEntry), 'pi-record.js');

/** Where Pi keeps its sessions, under the user's own HOME (tech notes, section 6). */
const PI_AGENT = path.join(os.homedir(), '.pi', 'agent');
const PI_SESSIONS = path.join(PI_AGENT, 'sessions');

/** Pi's session folder for a working folder: its real path, the leading `/` off, every `/`, `\` and `:` a `-`. */
const piFolderNameOf = (real) => `--${real.replace(/^\//, '').replaceAll(/[/\\:]/g, '-')}--`;

/** The files in ~/.pi/agent this test compares, never writes. */
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

/** The rows the tab renders right now, or undefined when Orca gives no rendered screen. */
function rowsOf(handle) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  const shown = answer.ok === true ? answer.result?.terminal : undefined;
  return shown?.source === 'screen' && Array.isArray(shown.tail) ? shown.tail.map(String) : undefined;
}

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

/** What the tab is showing, for the message of a wait that ran out, with whether it is orphaned. */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  return `${blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`}\n  The tab ${handle} is ${orphanWords(handle)}.`
    + `\n  orca terminal read --terminal ${handle} --screen\n    ${(rowsOf(handle) ?? ['(no rendered screen)']).join('\n    ')}`;
}

/** Whether Orca calls the tab idle right now, with nothing to answer on it. */
function idleNow(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  return answer.ok === true && answer.result?.wait?.satisfied === true && answer.result?.wait?.blockedReason === undefined
    && waitingOn(orca, handle) === undefined;
}

/**
 * A question of Pi's on `rows`, or of any harness the kit's shared look knows,
 * named; undefined when there is none. Pi's shapes are those of tech notes
 * section 6, as test/system/pi-temp.test.js reads them.
 */
function questionIn(rows) {
  if (rows.some((row) => row.trim() === 'Trust project folder?')) return 'Pi\'s project-trust question';
  if (rows.some((row) => /Press any key to continue/.test(row))) return 'a Pi warning that waits for a key';
  if (rows.some((row) => /↑↓ navigate\s+enter select\s+escape\/ctrl\+c cancel/.test(row))) return 'a Pi list, from an extension or Pi itself';
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

/**
 * Press keys in the test's own Pi tab: `text`, then a return as a send of its
 * own, neither with `--enter` (as test/system/session-clear.test.js does).
 * The screen is looked at first: a question on it stops the run.
 */
async function pressIn(handle, text) {
  assertNoQuestion(handle, `before ${JSON.stringify(text)} was typed`);
  for (const keys of [text, '\r']) {
    const sent = orca(['terminal', 'send', '--terminal', handle, '--text', keys]);
    assert.equal(sent.ok, true, `typing ${JSON.stringify(keys)} into ${handle} failed: ${JSON.stringify(sent.error)}.${whatIsUp(handle)}`);
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
 * that opened the tab (`obk up`, or `obk restart` in step 5), and `answer` is
 * its --json answer: since #676 that command makes the Orca window load the
 * bot's project. This test opens no extra project and does not wait for the
 * tab to turn real.
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

// ------------------------------------------------------------- the test

test('the book follows a /new typed in a Pi tab, the new conversation is given its start prompt, and a restart resumes it with the kit\'s extension', async (t) => {
  // The night gate (the header says why): the whole live part, from before
  // the bots folder is made, runs only in a night run that names this file.
  const now = new Date();
  const night = atNight(now);
  const named = namedThisRun(THIS_FILE);
  if (!(night && named)) {
    t.skip([
      `this run is at ${now.toTimeString().slice(0, 5)} local time and ${named ? 'names this file' : 'does not name this file'}, so it opened nothing and checked nothing live.`,
      'Its obk init and obk up make throwaway tabs real in the Orca window (#676), so its live part starts only in a run that names this file, between midnight and 6 am local time:',
      '  npm run test:system -- --yes test/system/pi-new.test.js',
    ].join(' '));
    return;
  }

  deadline = Date.now() + TOTAL_MS;
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
    pi: Object.fromEntries(PI_SETTINGS.map((name) => [name, hashOf(path.join(PI_AGENT, name))])),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-pi-new-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', BOT].map(homeOf);
  const home = homeOf(BOT);

  /** Pi's session folder for the bot home, read only: set once the home is there. */
  let piFolder;

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    // Only this test's own tabs are closed. A tab it did not create at one of
    // its homes is not its to close: that project and the bots folder stay
    // where they are, and the test fails naming the tab (review of PR #425).
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
  // brought up. The book holds A, and Pi's file for A holds the start turn.
  gateStillOpen('obk init');
  obkJson(['init', '--bots', bots, '--harness', 'claude']);
  obkJson(['bot', 'create', '--bots', bots, '--name', BOT, '--harness', 'pi', '--charter', `${BOT} exists for one system test run and owns nothing.`]);
  obkJson(['session', 'add', '--bots', bots, '--bot', BOT, '--name', SESSION, '--model', MODEL, '--effort', EFFORT, `--prompt=${PROMPT}`]);
  gateStillOpen(`step 1, obk up of ${BOT}`);
  const upAnswer = obkJson(['up', '--bots', bots, '--bot', BOT]);
  const up = tabOf(upAnswer, SESSION);
  assert.equal(up.created, true, `the premise: up opened ${SESSION}'s tab: ${JSON.stringify(up)}`);
  let tab = { title: up.title, handle: up.terminal };
  const real = realpathSync(home);
  piFolder = path.join(PI_SESSIONS, piFolderNameOf(real));

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
  const replyA = turnsOf(piLinesOf(fileA), 'assistant').join('\n');
  if (!replyA.includes(CODE)) t.diagnostic(`step 1: the start turn's reply did not carry ${CODE}: ${JSON.stringify(replyA.slice(0, 200))}`);

  // ---------------------------------------------------------------------------
  // 2 and 3. `/new` typed into the test's own Pi tab. Within NEW_MS of its
  // return, the book holds B, not A, with A in daily's history. Then idle.
  await pressIn(tab.handle, '/new');
  const newAt = Date.now();
  const idB = await until(
    `step 3: the book to follow the /new: a new id for ${SESSION}, with A (${idA}) in its history`,
    NEW_MS,
    async () => {
      const entry = sessionIn(home, SESSION);
      return typeof entry.session === 'string' && entry.session !== idA && historyHolds(entry, idA) ? entry.session : undefined;
    },
    () => `\n  The book holds: ${JSON.stringify(sessionIn(home, SESSION))}${whatIsUp(tab.handle)}`,
    async () => assertNoQuestion(tab.handle, 'step 3, after the /new'),
  );
  t.diagnostic(`step 3: the book held B (${idB}) ${Date.now() - newAt} ms after the /new's return`);
  await until(
    'step 3: the Pi tab to be idle after the /new',
    READY_MS,
    async () => (idleNow(tab.handle) ? true : undefined),
    () => whatIsUp(tab.handle),
    async () => assertNoQuestion(tab.handle, 'step 3, while the tab settled after the /new'),
  );

  // ---------------------------------------------------------------------------
  // 4. One short line, one turn. Pi's file for B: header B, no parentSession,
  // and the start prompt the kit gave back as a custom_message.
  await pressIn(tab.handle, OK_LINE);
  const fileB = await until(
    `step 4: Pi's file for B (${idB}) to hold a reply to "${OK_LINE}", and the tab to be idle`,
    ANSWER_MS,
    async () => {
      const found = piFileIn(piFolder, idB);
      const lines = piLinesOf(found);
      return turnsOf(lines, 'user').some((text) => text.includes(OK_LINE)) && turnsOf(lines, 'assistant').some((text) => text.trim() !== '')
        && idleNow(tab.handle) ? found : undefined;
    },
    () => ` Looked in ${piFolder} for *_${idB}.jsonl.\n  Its tail:\n    ${tailOf(piLinesOf(piFileIn(piFolder, idB)))}${whatIsUp(tab.handle)}`,
    async () => assertNoQuestion(tab.handle, 'step 4, while the turn ran'),
  );
  const linesB = piLinesOf(fileB);
  assert.equal(linesB[0]?.type, 'session', `step 4: B's file starts with Pi's header: ${JSON.stringify(linesB[0])}`);
  assert.equal(linesB[0]?.id, idB, `step 4: the header's id is B, the id the book holds: ${JSON.stringify(linesB[0])}`);
  assert.equal('parentSession' in (linesB[0] ?? {}), false, `step 4: the header has no parentSession: a /new, not a fork: ${JSON.stringify(linesB[0])}`);
  const given = linesB.filter((line) => line.type === 'custom_message');
  assert.ok(
    given.some((line) => (textOf(line.content) || JSON.stringify(line.content ?? '')).includes(CODE)),
    `step 4: B's file holds a custom_message line with the start prompt's ${CODE}, which the kit's extension gives back after a /new. Its custom_message lines: ${JSON.stringify(given)}\n  Its tail:\n    ${tailOf(linesB)}`,
  );
  assert.equal(sessionIn(home, SESSION).session, idB, 'step 4: and the book still holds B');

  // ---------------------------------------------------------------------------
  // 5. `obk restart` of daily: a resume of B, on a line that carries the
  // kit's extension, shown by what Pi then does.
  gateStillOpen(`step 5, obk restart of ${BOT}/${SESSION}`);
  const restarted = obkJson(['restart', '--bots', bots, '--bot', BOT, '--session', SESSION]);
  closedByKit(restarted.closed);
  const back = tabOf(restarted, SESSION);
  assert.equal(back.created, true, `step 5: the restart opened a new tab: ${JSON.stringify(back)}`);
  assert.equal(back.resumed, true, `step 5: and resumed the conversation the book held: ${JSON.stringify(back)}`);
  tab = { title: back.title, handle: back.terminal };
  assert.equal(sessionIn(home, SESSION).session, idB, `step 5: the book still holds B after the restart: ${JSON.stringify(sessionIn(home, SESSION))}`);

  // The line itself, if Pi left the shell's echo of it on the screen: judged
  // when it is there, printed when it is not (not seen live).
  // A long line wraps over rows, so the rows are read as one text with every
  // space and quote taken out, and so are the words looked for.
  const screen = rowsOf(tab.handle) ?? [];
  const bare = (text) => text.replaceAll(/[\s']/g, '');
  const shown = bare(screen.join(''));
  if (shown.includes('--session-id')) {
    assert.ok(shown.includes(bare(`--session-id ${idB}`)), `step 5: the launch line on the screen carries --session-id B (${idB}):\n    ${screen.join('\n    ')}`);
    assert.ok(shown.includes(bare(`--extension ${EXTENSION}`)), `step 5: the launch line on the screen carries --extension ${EXTENSION}:\n    ${screen.join('\n    ')}`);
    t.diagnostic('step 5: the launch line was on the screen after the restart, and carried --session-id B and the extension');
  } else {
    t.diagnostic(`step 5: the launch line was not on the screen after the restart, so it is checked by what Pi does:\n    ${(rowsOf(tab.handle) ?? ['(no rendered screen)']).join('\n    ')}`);
  }

  await loadedForTyping(t, tab, 'step 5, the line after the restart', { by: 'obk restart', answer: restarted, screen: async () => assertNoQuestion(tab.handle, 'step 5, while its tab was watched') });
  await until(
    'step 5: the restarted Pi tab to be idle',
    READY_MS,
    async () => (idleNow(tab.handle) ? true : undefined),
    () => whatIsUp(tab.handle),
    async () => assertNoQuestion(tab.handle, 'step 5, while the restarted tab came up'),
  );

  // a. --session-id B: the next turn lands in B's own file.
  await pressIn(tab.handle, YES_LINE);
  await until(
    `step 5a: "${YES_LINE}" to land as a user turn in B's file (${idB}), with a reply, and the tab to be idle`,
    ANSWER_MS,
    async () => {
      const lines = piLinesOf(piFileIn(piFolder, idB));
      const at = lines.findIndex((line) => line.type === 'message' && line.message?.role === 'user' && textOf(line.message.content).includes(YES_LINE));
      const replied = at >= 0 && lines.slice(at + 1).some((line) => line.type === 'message' && line.message?.role === 'assistant' && textOf(line.message.content).trim() !== '');
      return replied && idleNow(tab.handle) ? true : undefined;
    },
    () => ` B's file's tail:\n    ${tailOf(piLinesOf(piFileIn(piFolder, idB)))}\n  The book holds: ${JSON.stringify(sessionIn(home, SESSION))}${whatIsUp(tab.handle)}`,
    async () => assertNoQuestion(tab.handle, 'step 5a, while the turn ran'),
  );
  assert.equal(sessionIn(home, SESSION).session, idB, 'step 5a: the restarted Pi resumed B, and the book still holds B');

  // b. --extension: a second /new in the restarted tab is followed by the book.
  await pressIn(tab.handle, '/new');
  const againAt = Date.now();
  const idC = await until(
    `step 5b: the book to follow a /new in the restarted tab: a new id for ${SESSION}, with B (${idB}) in its history. Only the kit's extension, on the restart's launch line, tells the book of a /new`,
    NEW_MS,
    async () => {
      const entry = sessionIn(home, SESSION);
      return typeof entry.session === 'string' && entry.session !== idB && entry.session !== idA && historyHolds(entry, idB) ? entry.session : undefined;
    },
    () => `\n  The book holds: ${JSON.stringify(sessionIn(home, SESSION))}${whatIsUp(tab.handle)}`,
    async () => assertNoQuestion(tab.handle, 'step 5b, after the /new'),
  );
  t.diagnostic(`step 5b: the book held C (${idC}) ${Date.now() - againAt} ms after the second /new's return`);

  // ---------------------------------------------------------------------------
  // 6. The bot retired; the teardown does the rest.
  const retired = obkJson(['retire', '--bots', bots, '--bot', BOT]);
  closedByKit(retired.closed);
  const left = await terminalsAfterClosing(home, [tab.handle]);
  assert.equal(left.some((one) => one.handle === tab.handle), false, `step 6: the retire closed ${SESSION}'s tab in Orca`);
});
