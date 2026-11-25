// A system test, and the live check for #862: a booked conversation resumed a
// second time, in a tab no session of the bot owns, is told by the kit's hook
// that it is a copy. Against the real Orca and real Claude Code on this
// machine. Run it alone with
// `npm run test:system -- --yes test/system/conversation-copy-tab.test.js`,
// between midnight and 6 am local time; `npm test` cannot, and no CI machine
// could.
//
// What happens on a real fleet (seen on 2026-11-24): `obk up` or `obk restart`
// opened a new tab for a session because its old tab was gone, and later Orca
// brought the old tab back by itself and typed `claude --resume <the same
// conversation>` into its shell, with none of the kit's launch line. Then the
// conversation runs in two tabs. The kit's SessionStart hook runs in the old
// tab too, because it is in the bot folder's project settings, and since #862
// it gives that copy a notice (test/conversation-in-two-tabs.test.js holds the
// rules against the fake Orca).
//
// Orca's real wake of an old tab cannot be staged in a throwaway fleet: it
// needs an Orca restart or Orca's phone app. So this test stands in for it the
// way test/system/restored-tab.test.js stands in for a cold restore (#318): a
// second tab of the test's own in the bot's Orca project, where the bare
// resume Orca would type is typed into the tab's shell. The test checks that
// premise before it relies on it.
//
// The steps:
//
//   L1. A throwaway fleet, by this checkout's CLI, with one Claude Code bot and
//       one session, daily, with a start prompt, brought up with `obk up`. The
//       kit's hook names daily's conversation C in the book, with its tab T1,
//       and the start prompt's turn puts C on Claude Code's record.
//   L2. A second tab T0 in the bot's Orca project, made by the test, and the
//       bare `claude --resume <C>` typed into its shell. ASSERTED as premises:
//       no session of the book names T0, and the claude in front of T0 has
//       ORCA_TAB_ID=T0 and no OBK_TAB_SHELL in its environment (read by `ps`,
//       one pid at a time).
//   L3. The copy got the kit's notice. ASSERTED: C's transcript gets, after
//       T0's start, a `hook_additional_context` attachment of the SessionStart
//       event, and its text names `copy-tab/daily`, C, T0 and T1, each as a
//       word of its own. Where that record is: seen in Claude Code 2.1.332, in
//       a transcript of the kit-dev fleet on 2026-11-25 (read by line type and
//       key names only). The kit's hook leaves an `attachment` line of type
//       `hook_success`, `hookName` `SessionStart:<source>`, with the hook's
//       `command` and its `stdout`, and then one of type
//       `hook_additional_context`, `hookEvent` `SessionStart`, whose `content`
//       is a list holding the text the session was given. The tech notes
//       (section 2) name only the `hook_success` line. When the record has not
//       come within a short wait, the test gives the copy one turn, a question
//       whose answer only the notice carries ("Which tab id …"): Claude Code
//       may write the attachments only with the next message. The answer
//       itself is printed and fails nothing, because a model's reply is not
//       the kit's behaviour.
//   L4. ASSERTED: the book is exactly as it was before T0 started, byte for
//       byte, and daily's claude still runs in front of T1, the same process.
//   L5. The teardown, as the tests beside it.
//
// **Nobody answers anything by hand.** The test answers its own tabs' first-run
// screens only through the allowlists: Claude Code's folder trust when it is
// the plain one or the one the kit's default rules bring up
// (helpers/claude-trust.js `claudeTrustAt`), and the captured Teach form with
// Esc (`onlyTeachFormOf`). Any other screen (`questionOn`) stops the run with
// the screen in the message. `Bot Father daily` may sit on its own trust
// screen: nothing waits on it, and nothing is typed into it.
//
// **The night gate.** helpers/system.js runs this test only in a run that names
// its file, between midnight and 6 am local time (#689). It reads the gate
// again before `obk up` and before it opens T0 (#687).
//
// The bare resume carries none of the kit's off for Remote Control (#755), so
// Claude Code's own hard off goes into the bot folder's local settings first
// (helpers/remote-control-off.js `hardRemoteControlOff`).
//
// The machine it runs on is someone's working machine, with their own tabs open.
// So this test, like the ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory,
//     `<tmp>/obk-system-conversation-copy-*`; the kit's `<bots>.*` folders are
//     beside it, and go with it;
//   - writes down every terminal and project Orca already had, before it creates
//     anything;
//   - runs this checkout's `src/cli.js` by its full path, never the machine's
//     `obk`;
//   - types only into its own tabs;
//   - closes only its own tabs, one by one through the tab guard
//     (`--terminal <handle> --tab`), then deletes its own projects, whatever
//     happened, and checks that it closed no tab it did not create;
//   - never runs `orca terminal close --worktree … --all`; reads `ps` only, one
//     pid at a time, and signals no process: each claude it starts ends when
//     its tab is closed;
//   - never writes to ~/.claude.json or to a profile's .claude.json. The runner
//     (scripts/test-system.js) backs up both before any test, and takes the
//     run's keys out after it.
//
// It reads Claude Code's transcripts of the throwaway bot folder only, in each
// config folder a tab's claude can write to (~/.claude, each Orca profile's
// home, CLAUDE_CONFIG_DIR), and writes nothing there. It prints no word of
// Claude Code's own text: only the kit's notice, line types and sizes.
//
// It takes a few minutes: one start with one short turn, one resume, and at
// most one more short turn.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry } from '../helpers/cli.js';
import { claudeTrustAt, trustScreenMet } from '../helpers/claude-trust.js';
import { atNight, namedThisRun } from '../helpers/night-gate.js';
import { deleteOwnProject, placesOf, projectsInBots } from '../helpers/own-project.js';
import { onlyTeachFormOf, questionOn } from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { RC_OFF, hardRemoteControlOff, withBotFatherOff } from '../helpers/remote-control-off.js';
import { autoModeState, sessionRecordFiles } from '../helpers/teach-record.js';
import { RELOAD_LINE } from '../../src/orca.js';

/** This file, as the runner names it in OBK_SYSTEM_NAMED. */
const THIS_FILE = fileURLToPath(import.meta.url);

/** The Orca CLI that works for a normal user (tech notes, section 1). */
const ORCA = process.env.OBK_ORCA || '/Applications/Orca.app/Contents/Resources/bin/orca';

/** How long a session is given to be past its first-run screens and have the kit's hook write the book. */
const READY_MS = 180000;

/** How long a real agent is given to do its work. */
const ANSWER_MS = 240000;

/** How long the resumed claude is given to be in front of T0. */
const RESUME_MS = 120000;

/** How long the record of the hook is waited for before the copy is given a turn. */
const RECORD_FIRST_MS = 45000;

/** How long the shell of a new tab is given to take its first line. */
const SHELL_MS = 60000;

/** How long the book must stay the same before T0 starts, so a late write of T1's own hooks is not taken for T0's. */
const STEADY_MS = 10000;

/** The title of Claude Code's "Teach auto mode" form (#416), as helpers/screens.js has it. */
const TEACH_TITLE = 'Teach auto mode about your environment?';

/** The bot and its one session. */
const BOT = { name: 'copy-tab', display: 'Copy Tab' };
const SESSION = 'daily';

/** The model the session runs on. */
const MODEL = 'claude-haiku-5-5';

/** The start of every throwaway bots folder of this test. */
const RUN_PREFIX = 'obk-system-conversation-copy-';

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

/** Run `obk ... --json` and read the answer it printed. A tab it says it opened is this test's own. */
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

/**
 * The night gate again, right before a later step that opens a tab (#687).
 * When the night ended during the run, the test opens nothing more and fails
 * here, naming `step`. The teardown runs as before.
 */
function gateStillOpen(step) {
  const now = new Date();
  const named = namedThisRun(THIS_FILE);
  assert.ok(atNight(now) && named, [
    `The night gate closed during this run: it is ${now.toTimeString().slice(0, 5)} local time${named ? '' : ', and this run does not name this file'}.`,
    `So this test opened nothing more: ${step} did not run. This run is not a pass.`,
    'Run it again in a night run, between midnight and 6 am local time: npm run test:system -- --yes test/system/conversation-copy-tab.test.js',
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

/**
 * What Orca says the tab waits on, for the message of a wait that ran out. The
 * screen itself is not put in the message: it can show Claude Code's text.
 */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  return `${blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`} Its screen is not shown here; the tab closes with the run.`;
}

/** The folder whose trust this test answered, and the tabs whose Teach form it answered. */
const answered = { trust: new Set(), teach: new Set() };

/**
 * One look at a tab's screen. The folder trust of `home` is answered once, the
 * captured Teach form at most once for each tab with Esc, and any other
 * question stops the run with the screen in the message.
 */
async function lookAtScreen(t, { title, handle, home, bots }) {
  const rows = rowsOf(handle);
  if (rows === undefined) return;

  if (rows.some((row) => row.includes('Yes, I trust this folder'))) {
    assert.ok(!answered.trust.has(home), `${title} asked Claude Code's folder trust for ${home} again, which this test answered once and answers no more:\n    ${rows.join('\n    ')}`);
    const wrong = claudeTrustAt(rows, home, bots, cliEntry);
    assert.equal(wrong, undefined, `${title}'s folder trust is not one this test may answer, so it answered nothing: ${wrong}.\n  what it showed:\n    ${rows.join('\n    ')}`);
    const sent = orca(['terminal', 'send', '--terminal', handle, '--text', '\x1b[B\r']);
    assert.equal(sent.ok, true, `answering ${title}'s folder trust failed: ${JSON.stringify(sent.error)}`);
    answered.trust.add(home);
    await until(`${title}'s folder trust to go after it was answered`, 15000, async () => ((rowsOf(handle) ?? []).some((row) => row.includes('Yes, I trust this folder')) ? undefined : true), () => whatIsUp(handle));
    t.diagnostic(`answered ${title}'s ${trustScreenMet(rows)}`);
    return;
  }

  if (rows.some((row) => row.trim() === TEACH_TITLE)) {
    assert.ok(!answered.teach.has(handle), `the Teach form came up again in ${title}, and this test answers it at most once:\n    ${rows.join('\n    ')}`);
    const wrong = onlyTeachFormOf(rows);
    assert.equal(wrong, undefined, `${title}'s Teach form is not the captured one, so this test answered nothing: ${wrong}.\n  what it showed:\n    ${rows.join('\n    ')}`);
    const found = sessionRecordFiles(home);
    assert.ok(found.files !== undefined, `this test cannot tell which record ${title}'s session writes, so it answered nothing: ${found.why}`);
    const { files } = found;
    const was = autoModeState(files);
    const sent = orca(['terminal', 'send', '--terminal', handle, '--text', '\x1b']);
    assert.equal(sent.ok, true, `answering ${title}'s Teach form with Esc failed: ${JSON.stringify(sent.error)}`);
    answered.teach.add(handle);
    await until(`${title}'s Teach form to go after Esc`, 15000, async () => ((rowsOf(handle) ?? []).some((row) => row.trim() === TEACH_TITLE) ? undefined : true), () => whatIsUp(handle));
    await setTimeout(2000);
    const now = autoModeState(files);
    assert.equal(now, was, `Esc on ${title}'s Teach form taught nothing: autoModeEnvSetup should be as it was in each record the session may write (before: ${was}; after: ${now})`);
    t.diagnostic(`answered ${title}'s Teach form with Esc; it went, and autoModeEnvSetup stayed as it was: ${was}`);
    return;
  }

  const question = questionOn(rows);
  assert.equal(question, undefined, `${title} shows a screen this test does not know, and it answers nothing; the run stops here:\n    ${rows.join('\n    ')}`);
}

/**
 * Wait until the tab will take a line: Orca says its TUI is idle and waits on
 * nothing, and no question of its own is on the screen. Each look in between
 * answers what the allowlists let it answer.
 */
async function readyForALine(t, tab, within = READY_MS) {
  await until(
    `${tab.title} to take a line`,
    within,
    async () => {
      const answer = orca(['terminal', 'wait', '--terminal', tab.handle, '--for', 'tui-idle', '--timeout-ms', '5000']);
      if (answer.ok !== true || answer.result?.wait?.blockedReason !== undefined) return undefined;
      const rows = rowsOf(tab.handle);
      return rows !== undefined && questionOn(rows) === undefined && !rows.some((row) => row.includes('Yes, I trust this folder') || row.trim() === TEACH_TITLE) ? true : undefined;
    },
    () => whatIsUp(tab.handle),
    () => lookAtScreen(t, tab),
  );
}

/** Type one line into a tab of this test's own and submit it with `--enter`. A refusal fails with the line. */
function typeInto(handle, text) {
  const sent = orca(['terminal', 'send', '--terminal', handle, '--text', text, '--enter']);
  assert.equal(
    sent.ok,
    true,
    `orca terminal send --enter failed: ${JSON.stringify(sent.error)}. The line was: ${text}.${whatIsUp(handle)}`,
  );
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
 * memory`, and the pane's terminal foreground group from `ps`. `name` is the
 * command's own name, a login shell's leading `-` aside. Undefined when any of
 * it cannot be read.
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
  return comm === undefined ? undefined : { pid: group, name: path.basename(comm.replace(/^-/, '')) };
}

/**
 * What one process carries in its environment, as the words `ps -E` prints
 * (tech notes, section 1). Only ever looked through for a word it names: what
 * it holds is never printed, because it holds whatever this machine keeps there.
 */
const environmentWords = (pid) => (psOf(pid, ['-E', '-ww', '-o', 'command=']) ?? '').split(/\s+/);

/** Whether `word` is in `text` as a word of its own, not inside another. */
const hasWord = (text, word) => new RegExp(`(^|[^A-Za-z0-9_-])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9_-])`).test(text);

/** The slug as Claude Code makes it: the folder in NFC, each character that is not an ASCII letter or digit changed to `-`. */
const slugOf = (root) => root.normalize('NFC').replaceAll(/[^A-Za-z0-9]/g, '-');

/** True when `dir` is a folder, through a link too. */
function isFolder(dir) {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Every config folder a tab's claude can write its transcripts in: ~/.claude,
 * each Orca profile's home (Orca's `claude` wrapper can route a tab's session
 * there, helpers/teach-record.js says why), and the folders CLAUDE_CONFIG_DIR
 * and ORCA_CLAUDE_USER_CONFIG_DIR name. Read only, by name.
 */
function configFolders() {
  const found = [path.join(os.homedir(), '.claude')];
  const profiles = path.join(process.env.OBK_ORCA_DATA || path.join(os.homedir(), 'Library', 'Application Support', 'orca'), 'claude-profiles');
  const names = isFolder(profiles) ? readdirSync(profiles).sort() : [];
  for (const name of names) found.push(path.join(profiles, name, 'home'));
  for (const name of ['CLAUDE_CONFIG_DIR', 'ORCA_CLAUDE_USER_CONFIG_DIR']) {
    const dir = process.env[name];
    if (typeof dir === 'string' && path.isAbsolute(dir)) found.push(dir);
  }
  return [...new Set(found)].filter(isFolder);
}

/** The transcript files of conversation `id` in the folder `home`, in every config folder that has one. */
const transcriptFilesOf = (home, id) => configFolders()
  .map((dir) => path.join(dir, 'projects', slugOf(home), `${id}.jsonl`))
  .filter((file) => existsSync(file));

/** The transcripts of the folder `home` changed since `since`, other than `id`'s: their ids only. */
function otherTranscriptsSince(home, id, since) {
  const ids = [];
  for (const dir of configFolders()) {
    const folder = path.join(dir, 'projects', slugOf(home));
    if (!isFolder(folder)) continue;
    for (const name of readdirSync(folder)) {
      if (!name.endsWith('.jsonl') || name === `${id}.jsonl`) continue;
      try {
        if (statSync(path.join(folder, name)).mtimeMs >= since) ids.push(name.slice(0, -'.jsonl'.length));
      } catch {
        // Gone between the listing and the look.
      }
    }
  }
  return ids;
}

/** One transcript file, whole lines only, a JSON object each. */
function linesIn(file) {
  if (!existsSync(file)) return [];
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

const itemsOf = (line, type) => (Array.isArray(line.message?.content) ? line.message.content.filter((item) => item?.type === type) : []);
const saidBySession = (lines) => lines.filter((line) => line.type === 'assistant').flatMap((line) => itemsOf(line, 'text')).map((item) => String(item.text ?? '')).join('\n');

/**
 * The last lines of a transcript, for the message of a wait that ran out: the
 * time, the type and the size of each, and no word of what it holds.
 */
function tailOf(lines, count = 15) {
  if (lines.length === 0) return '    (nothing)';
  return lines.slice(-count).map((line) => `    ${line.timestamp ?? '-'}  ${line.type}${line.type === 'attachment' ? ` ${line.attachment?.type ?? '-'} ${line.attachment?.hookName ?? ''}` : ''}  ${JSON.stringify(line).length} characters`).join('\n');
}

/**
 * The text a SessionStart hook added to the conversation, from the lines given:
 * the `content` of each `hook_additional_context` attachment of the
 * SessionStart event, joined, or undefined when there is none.
 */
function addedContextIn(lines) {
  const texts = lines
    .filter((line) => line.type === 'attachment' && line.attachment?.type === 'hook_additional_context' && line.attachment?.hookEvent === 'SessionStart')
    .flatMap((line) => (Array.isArray(line.attachment.content) ? line.attachment.content : [line.attachment.content]))
    .filter((one) => typeof one === 'string');
  return texts.length === 0 ? undefined : texts.join('\n\n');
}

/** The kit's own SessionStart hook lines among `lines`: their hookName, and whether their stdout is the hook's JSON answer. */
const kitHookLinesIn = (lines) => lines
  .filter((line) => line.type === 'attachment' && line.attachment?.type === 'hook_success' && /^SessionStart:/.test(String(line.attachment?.hookName))
    && String(line.attachment?.command ?? '').includes('session record'))
  .map((line) => `${line.attachment.hookName} (stdout ${String(line.attachment.stdout ?? '').length} characters${String(line.attachment.stdout ?? '').includes('"additionalContext"') ? ', with additionalContext' : ''})`);

/** Remove the throwaway bots folder and every `<bots>.*` beside it (PRD 6.3). */
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

test('a booked conversation resumed in a tab no session owns is told by the kit that it is a copy, and the book stays as it was', async (t) => {
  t.diagnostic(`the commit this run ran: ${commitRun()}`);
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), RUN_PREFIX)));
  const home = path.join(bots, 'bots', BOT.name);
  const homes = [path.join(bots, 'bots', 'bot-father'), home];
  const bookFile = path.join(home, 'sessions.yaml');
  const bookText = () => readFileSync(bookFile, 'utf8');
  const book = () => (existsSync(bookFile) ? parse(bookText()) ?? {} : {});

  // Registered before anything is created, so it runs however this test ends.
  // T0 is in the bot's project, so it goes with the rest.
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
    assert.deepEqual(failedDeletes, [], 'projects this test could not remove, left in Orca');
  });

  // ------------------------------------------------- L1. the fleet, and daily in T1

  const token = randomBytes(5).toString('hex');
  const WORD = `harbour${token}`;
  const prompt = `You are a system test's throwaway session and you own nothing. Run no command, use no tool and change no file. Answer with the one word ${WORD}, and stop.`;

  obkJson(withBotFatherOff(['init', '--bots', bots, '--harness', 'claude']));
  obkJson(['bot', 'create', '--bots', bots, '--name', BOT.name, '--harness', 'claude', '--charter', `${BOT.display} exists for one system test run and owns nothing.`]);
  obkJson(['session', 'add', '--bots', bots, '--bot', BOT.name, '--name', SESSION, '--model', MODEL, '--effort', 'low', `--prompt=${prompt}`, ...RC_OFF]);

  gateStillOpen(`obk up of the throwaway session ${SESSION}`);
  const entry = tabOf(obkJson(['up', '--bots', bots, '--bot', BOT.name, '--session', SESSION]), SESSION);
  assert.equal(entry.created, true, `up opened ${SESSION}'s tab`);
  assert.equal(entry.harnessStarted, true, `no claude came up in ${entry.title}: \`orca terminal read --terminal ${entry.terminal} --screen\``);
  const t1 = { title: entry.title, handle: entry.terminal, home, bots };
  const T1 = entry.tabId;

  const C = await until(
    `the kit's hook to name ${SESSION}'s conversation in ${bookFile}`,
    READY_MS,
    async () => {
      const held = book().sessions?.[SESSION]?.session;
      return typeof held === 'string' ? held : undefined;
    },
    () => whatIsUp(t1.handle),
    () => lookAtScreen(t, t1),
  );
  assert.equal(book().sessions[SESSION].tab, T1, `the premise: the book keeps ${SESSION} in T1 ${T1}, got: ${JSON.stringify(book().sessions[SESSION])}`);

  // The start prompt's turn puts C on Claude Code's own record, so a resume of it has something to find.
  const files = await until(
    `${SESSION} to answer its start prompt with ${WORD}, on Claude Code's record of ${C}`,
    ANSWER_MS,
    async () => {
      const found = transcriptFilesOf(home, C).filter((file) => saidBySession(linesIn(file)).includes(WORD));
      return found.length > 0 ? found : undefined;
    },
    () => `\n  the transcripts of ${C} found: ${transcriptFilesOf(home, C).join(', ') || '(none)'}, in the config folders ${configFolders().join(', ')}${whatIsUp(t1.handle)}`,
    () => lookAtScreen(t, t1),
  );
  t.diagnostic(`${C}'s transcript: ${transcriptFilesOf(home, C).join(', ')}`);
  for (const file of transcriptFilesOf(home, C)) t.diagnostic(`in T1: the kit's SessionStart lines in ${path.basename(file)}: ${kitHookLinesIn(linesIn(file)).join('; ') || '(none)'}`);
  assert.ok(files.length > 0);
  await readyForALine(t, t1);

  // The book once T1's own hooks are done with it: the same for STEADY_MS.
  const bookBefore = await until(
    `the book to stay the same for ${STEADY_MS}ms before T0 starts`,
    READY_MS,
    async () => {
      const was = bookText();
      await setTimeout(STEADY_MS);
      return bookText() === was ? was : undefined;
    },
  );
  const t1Claude = inFront(t1.handle);
  assert.equal(t1Claude?.name, 'claude', `the premise: daily's claude is in front of T1, got: ${JSON.stringify(t1Claude)}`);

  // ------------------------------------------- L2. T0, and the bare resume in it

  gateStillOpen('the tab T0, which this test opens in the bot\'s project');
  const made = orca(['terminal', 'create', '--worktree', `path:${home}`, '--title', `${BOT.display} copy`]);
  assert.equal(made.ok, true, `orca terminal create failed: ${JSON.stringify(made.error)}`);
  const T0 = made.result.terminal.tabId;
  const t0 = { title: `${BOT.display} copy`, handle: made.result.terminal.handle, home, bots };
  assert.equal(typeof T0, 'string', `the premise: Orca gave T0 a tab id, got: ${JSON.stringify(made.result.terminal)}`);
  assert.notEqual(T0, T1, 'the premise: T0 is not T1');
  assert.deepEqual(
    Object.entries(book().sessions ?? {}).filter(([, one]) => one?.tab === T0).map(([name]) => name),
    [],
    `the premise: no session of the book names T0 ${T0}`,
  );

  // The shell of a new tab may not take a first line at once: a line it takes
  // shows on its screen, and a line sent again into this tab of our own costs
  // nothing.
  const ping = `echo ready${token}`;
  let sentAt = 0;
  await until(
    'T0\'s shell to take a line',
    SHELL_MS,
    async () => ((rowsOf(t0.handle) ?? []).some((row) => row.trim() === `ready${token}`) ? true : undefined),
    () => whatIsUp(t0.handle),
    async () => {
      if (Date.now() - sentAt < 15000) return;
      sentAt = Date.now();
      orca(['terminal', 'send', '--terminal', t0.handle, '--text', ping, '--enter']);
    },
  );

  // The bare resume carries none of the kit's off for Remote Control (#755).
  hardRemoteControlOff(home);
  const marks = new Map(transcriptFilesOf(home, C).map((file) => [file, linesIn(file).length]));
  const since = Date.now();
  const afterMark = () => transcriptFilesOf(home, C).flatMap((file) => linesIn(file).slice(marks.get(file) ?? 0));
  typeInto(t0.handle, `claude --resume ${C}`);

  const copy = await until(
    `claude to be in front of T0 after \`claude --resume ${C}\``,
    RESUME_MS,
    async () => {
      const front = inFront(t0.handle);
      return front?.name === 'claude' ? front : undefined;
    },
    () => whatIsUp(t0.handle),
    () => lookAtScreen(t, t0),
  );
  const words = environmentWords(copy.pid);
  assert.ok(words.includes(`ORCA_TAB_ID=${T0}`), `the premise: the claude in T0 (pid ${copy.pid}) carries ORCA_TAB_ID=${T0}`);
  assert.ok(
    !words.some((word) => word.startsWith('OBK_TAB_SHELL=')),
    `the premise: the claude in T0 (pid ${copy.pid}) carries no OBK_TAB_SHELL, as a harness Orca brought back carries none`,
  );

  // ------------------------------------------------------ L3. the kit's notice

  const record = () => addedContextIn(afterMark());
  const note = () => [
    `\n  the lines of ${C}'s transcript after T0 started:\n${tailOf(afterMark())}`,
    `\n  the kit's SessionStart lines among them: ${kitHookLinesIn(afterMark()).join('; ') || '(none)'}`,
    `\n  other transcripts of ${home} changed since T0 started: ${otherTranscriptsSince(home, C, since).join(', ') || '(none)'}`,
    whatIsUp(t0.handle),
  ].join('');

  let context;
  try {
    context = await until(`the record of the kit's notice in ${C}'s transcript`, RECORD_FIRST_MS, async () => record(), note, () => lookAtScreen(t, t0));
    t.diagnostic('the record of the kit\'s notice came with no turn of the copy');
  } catch (error) {
    // Only the wait for the record itself running out; a screen the look refused stops the run.
    if (!(error instanceof assert.AssertionError) || !error.message.startsWith(`gave up waiting for the record of the kit's notice in ${C}'s transcript after`)) throw error;
    // One turn for the copy: Claude Code may write the attachments only with the next message.
    t.diagnostic(`no record of the notice ${RECORD_FIRST_MS}ms after T0 started, so the copy is given one turn`);
    await readyForALine(t, t0);
    const said = saidBySession(afterMark());
    typeInto(t0.handle, `Which tab id does the kit say ${BOT.name}/${SESSION} is kept in? Reply with that id and nothing else.`);
    const reply = await until(
      'the copy in T0 to answer',
      ANSWER_MS,
      async () => {
        const now = saidBySession(afterMark());
        return now.length > said.length ? now.slice(said.length) : undefined;
      },
      note,
      () => lookAtScreen(t, t0),
    );
    t.diagnostic(`the copy's answer ${hasWord(reply, T1) ? 'names' : 'does not name'} T1 ${T1} (a model's reply, which fails nothing)`);
    context = await until(`the record of the kit's notice in ${C}'s transcript, after the copy's turn`, 30000, async () => record(), note, () => lookAtScreen(t, t0));
  }
  t.diagnostic(`the kit's SessionStart lines in T0: ${kitHookLinesIn(afterMark()).join('; ') || '(none)'}`);
  t.diagnostic(`the kit's notice to the copy:\n${context}`);
  for (const [what, word] of [['the session', `${BOT.name}/${SESSION}`], ['the conversation C', C], ['the tab T0 it runs in now', T0], ['the session\'s own tab T1', T1]]) {
    assert.ok(hasWord(context, word), `the kit's notice to the copy names ${what}, ${word}, as a word of its own, got:\n${context}`);
  }

  // --------------------------------------------- L4. the book, and daily in T1

  assert.equal(bookText(), bookBefore, 'the book is exactly as it was before T0 started, byte for byte');
  const t1Now = inFront(t1.handle);
  assert.deepEqual(
    { name: t1Now?.name, pid: t1Now?.pid },
    { name: 'claude', pid: t1Claude.pid },
    `daily's claude still runs in front of T1, the same process as before T0 started, got: ${JSON.stringify(t1Now)}`,
  );
});
