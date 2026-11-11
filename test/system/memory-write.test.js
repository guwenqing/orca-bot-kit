// A system test, and the live check for #722: a Claude session the kit starts
// under an Orca Claude profile saves an auto-memory file with no permission
// dialog, in the physical memory folder, and still reads what that folder held.
// Against the real Orca and real Claude Code on this machine. Run it alone with
// `npm run test:system -- --yes test/system/memory-write.test.js`, between
// midnight and 6 am local time; `npm test` cannot, and no CI machine could.
//
// Under a profile, Orca starts a tab with CLAUDE_CONFIG_DIR at
// `<orca data>/claude-profiles/<id>/home`, where `projects` is a symbolic link
// to `~/.claude/projects`. Claude Code names its memory folder through that
// link, and a write there stops on a dialog that only a person can answer: "Do
// you want to create …", "via a symlink". So the kit's launch line carries
// `--settings {"autoMemoryDirectory":"<real projects>/<slug>/memory"}`
// (test/memory-folder-flag.test.js holds the rules against the fake). This test
// shows the one thing the fake cannot: that the line does its work in a real tab.
//
// The steps:
//
//   1. A throwaway fleet, by this checkout's CLI. `obk init` brings up Bot
//      Father, which gives the run a project in Orca.
//   2. THE PREMISE. A plain tab of the test's own in that project writes down
//      its CLAUDE_CONFIG_DIR. When that is not an Orca profile whose `projects`
//      is a symbolic link, or `selected-host` names another profile, the test
//      FAILS here and starts no session, because the run would prove nothing.
//   3. The memory folder is seeded, before the session starts:
//      `<real projects>/<slug of the throwaway repo>/memory/MEMORY.md` holds
//      CODEWORD, which no prompt holds. This test made that folder, and it was
//      not there before.
//   4. One Claude session, approval `auto`, model `claude-haiku-5-5`, effort
//      `low`, brought up with `obk up`. Its start prompt asks it to save a new
//      auto-memory file, FILE, with one word, WORD, with the Write tool, in the
//      memory folder its instructions name, not to change MEMORY.md, and to
//      answer with the codeword.
//   5. ASSERTED:
//        a. FILE appears at the physical folder, holding WORD, within ANSWER_MS;
//        b. its transcript has a Write call whose `file_path` is that physical
//           path, not the path through the profile, and the call did not fail;
//        c. the tab's screen never showed "Do you want to create" or "via a
//           symlink". Every look at the screen checks. Such a dialog stays up
//           until someone answers it, so a look cannot miss it. If it shows,
//           the test sends Esc to its own tab, and fails at once;
//        d. the session's answer in its transcript holds CODEWORD: it read what
//           the folder held, so no memory is lost;
//        e. MEMORY.md is as it was seeded, and the folder holds it and FILE,
//           and nothing else.
//
// Printed as diagnostics, never failed on: the commit, the Claude Code version
// in the transcript, whether Orca still has the kit's line in the tab's text
// (the line goes by as Claude Code takes the screen), and the tool calls.
//
// **Nobody answers anything by hand.** The test answers its own tab's first-run
// screens, as mailbox-run-gone.test.js does, and only through the allowlists:
// Claude Code's folder trust when it is the plain one or the one the kit's
// default rules bring up (helpers/claude-trust.js `claudeTrustAt`, which ends in
// `onlyPlainTrustOf`), and the captured Teach form with Esc (`onlyTeachFormOf`).
// Any other screen (`questionOn`) stops the run with the screen in the message.
// `Bot Father daily` may sit on its own trust screen: nothing waits on it, and
// nothing is typed into it.
//
// **The night gate.** helpers/system.js runs this test only in a run that names
// its file, between midnight and 6 am local time (#689). It reads the gate again
// before `obk up`, which opens the session's tab (#687).
//
// The machine it runs on is someone's working machine, with their own tabs open.
// So this test, like the ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory,
//     `<tmp>/obk-system-memory-write-*`; the probe's file is beside it, and goes
//     with it;
//   - writes down every terminal and project Orca already had, before it creates
//     anything;
//   - runs this checkout's `src/cli.js` by its full path, never the machine's
//     `obk`;
//   - types only into its own tabs: the probe's line, and the answers above;
//   - closes only its own tabs, through the tab guard, then deletes its own
//     projects, whatever happened;
//   - signals no process, and never writes to ~/.claude.json or to the profile's
//     .claude.json. The runner (scripts/test-system.js) backs up both before any
//     test, and takes the run's keys out after it.
//
// **What it writes under the real ~/.claude/projects.** The seeded folder
// `<real projects>/<slug>`, whose name holds this run's throwaway name. The
// teardown removes that one folder, by its exact path, and only when this run
// made it; `removeSeededFolder` refuses any other path. Claude Code's own
// transcript folders for the throwaway bots stay there, as they do for every
// system test here.
//
// It takes a few minutes: one start and one turn.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry, shellWord } from '../helpers/cli.js';
import { claudeTrustAt, trustScreenMet } from '../helpers/claude-trust.js';
import { atNight, namedThisRun } from '../helpers/night-gate.js';
import { deleteOwnProject, placesOf, projectsInBots } from '../helpers/own-project.js';
import { onlyTeachFormOf, questionOn } from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { autoModeState, sessionRecordFiles } from '../helpers/teach-record.js';
import { RELOAD_LINE } from '../../src/orca.js';

/** This file, as the runner names it in OBK_SYSTEM_NAMED. */
const THIS_FILE = fileURLToPath(import.meta.url);

/** The Orca CLI that works for a normal user (tech notes, section 1). */
const ORCA = process.env.OBK_ORCA || '/Applications/Orca.app/Contents/Resources/bin/orca';

/** Orca's data folder, as the kit finds it (src/orca.js). */
const ORCA_DATA = process.env.OBK_ORCA_DATA || path.join(os.homedir(), 'Library', 'Application Support', 'orca');

/** How long the plain tab is given to run the probe's line. */
const PROBE_MS = 60000;

/** How long the session is given to be past its first-run screens and have the kit's hook write the book. */
const READY_MS = 180000;

/** How long a real agent is given to do its work. */
const ANSWER_MS = 240000;

/** What the dialog says, in the words that must never be on the tab's screen. */
const DIALOG_WORDS = ['Do you want to create', 'via a symlink'];

/** The title of Claude Code's "Teach auto mode" form (#416), as helpers/screens.js has it. */
const TEACH_TITLE = 'Teach auto mode about your environment?';

const BOT = { name: 'memory-write', display: 'Memory Write' };

/** The start of every throwaway bots folder of this test. */
const RUN_PREFIX = 'obk-system-memory-write-';

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
    'Run it again in a night run, between midnight and 6 am local time: npm run test:system -- --yes test/system/memory-write.test.js',
  ].join('\n'));
}

/**
 * Keep asking until `look` gives something other than undefined, or the time
 * runs out. `look` comes first: once the work is seen, a form that Claude Code
 * puts up after its turn has nothing to stop. `screen` is run after each look
 * that found nothing.
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
 * The dialog on `rows`: Esc in this test's own tab, and the test fails at once,
 * with the screen in the message. A long row may wrap, so the words are looked
 * for in the rows as one line.
 */
function failOnDialog(handle, rows) {
  const text = rows.map((row) => row.trim()).join(' ');
  const shown = DIALOG_WORDS.filter((words) => text.includes(words));
  if (shown.length === 0) return;
  const sent = orca(['terminal', 'send', '--terminal', handle, '--text', '\x1b']);
  assert.fail(`the memory write stopped on Claude Code's dialog: the screen shows ${JSON.stringify(shown)}. This test sent Esc to its own tab${sent.ok === true ? '' : `, and Orca refused it: ${JSON.stringify(sent.error)}`}. So the kit's launch line did not keep the dialog away.\n  what it showed:\n    ${rows.join('\n    ')}`);
}

/** The folder whose trust this test answered, and the tab whose Teach form it answered. */
const answered = { trust: new Set(), teach: new Set() };

/**
 * One look at a tab's screen. The dialog fails the test at once. The folder
 * trust of `home` is answered once, the captured Teach form at most once with
 * Esc, and any other question stops the run with the screen in the message.
 */
async function lookAtScreen(t, { title, handle, home, bots }) {
  const rows = rowsOf(handle);
  if (rows === undefined) return;
  failOnDialog(handle, rows);

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

/** The slug as the requirement says: every character that is not an ASCII letter or digit changed to `-`. */
const slugOf = (root) => root.replaceAll(/[^A-Za-z0-9]/g, '-');

/** A premise that does not hold: this run would prove nothing, and it says so as a failure. */
function premise(holds, why) {
  assert.ok(holds, `${why} So this run would prove nothing about the dialog, and it starts no session. Run it in an Orca whose new tabs start under a Claude profile, whose projects folder is a symbolic link.`);
}

/**
 * The tab's own CLAUDE_CONFIG_DIR, read in a plain tab of this test's own in
 * the project at `place`: an Orca profile whose `projects` is a symbolic link,
 * and the profile that `selected-host` names, or the run stops. Gives back the
 * profile and the real path of its `projects`.
 */
async function profileOfATab(t, { bots, place }) {
  const file = `${bots}.probe-config-dir`;
  const answer = orca(['terminal', 'create', '--worktree', `path:${place}`, '--title', `${BOT.display} probe`]);
  assert.equal(answer.ok, true, `opening the probe's tab failed: ${JSON.stringify(answer.error)}`);
  const { handle } = answer.result.terminal;

  let sentAt = 0;
  await until(
    'the probe\'s tab to write down its CLAUDE_CONFIG_DIR',
    PROBE_MS,
    async () => (existsSync(file) ? true : undefined),
    () => whatIsUp(handle),
    async () => {
      // A shell still starting may not take a first line, and sending it again in this tab of our own costs nothing.
      if (Date.now() - sentAt < 15000) return;
      sentAt = Date.now();
      orca(['terminal', 'send', '--terminal', handle, '--text', `printenv CLAUDE_CONFIG_DIR > ${shellWord(file)}`, '--enter']);
    },
  );
  await setTimeout(500);
  const configDir = readFileSync(file, 'utf8').trim();
  t.diagnostic(`a tab here starts with CLAUDE_CONFIG_DIR=${configDir === '' ? '(unset)' : configDir}`);

  premise(configDir !== '', 'A plain Orca tab here has no CLAUDE_CONFIG_DIR.');
  premise(existsSync(configDir), `The tab's CLAUDE_CONFIG_DIR, ${configDir}, is not there.`);
  const profiles = path.join(ORCA_DATA, 'claude-profiles');
  premise(existsSync(profiles) && realpathSync(configDir).startsWith(`${realpathSync(profiles)}${path.sep}`), `The tab's CLAUDE_CONFIG_DIR, ${configDir}, is not under Orca's ${profiles}.`);
  const link = path.join(configDir, 'projects');
  let isLink = false;
  try {
    isLink = lstatSync(link).isSymbolicLink();
  } catch {
    isLink = false;
  }
  premise(isLink, `${link} is not a symbolic link.`);
  let selected = '';
  try {
    selected = readFileSync(path.join(profiles, 'selected-host'), 'utf8').trim();
  } catch {
    selected = '';
  }
  premise(selected !== '' && existsSync(selected) && realpathSync(selected) === realpathSync(configDir), `Orca's selected-host names ${selected === '' ? 'no profile' : selected}, and the tab runs under ${configDir}, so the kit would not name the folder that tab's session uses.`);
  return { profile: configDir, projects: realpathSync(link) };
}

/**
 * Remove the folder this run seeded under the real projects folder: by its exact
 * path, and only when that path is `<projects>/<slug of this run's bots folder>`
 * and holds this run's throwaway name. Anything else is refused.
 */
async function removeSeededFolder(folder, { projects, bots }) {
  const run = path.basename(bots);
  assert.ok(run.startsWith(RUN_PREFIX) && run.length > RUN_PREFIX.length, `${bots} is not this test's throwaway bots folder, so nothing was removed`);
  assert.equal(path.dirname(folder), projects, `${folder} is not directly in ${projects}, so it was not removed`);
  assert.equal(path.basename(folder), slugOf(bots), `${folder} is not this run's own folder, so it was not removed`);
  assert.ok(path.basename(folder).endsWith(slugOf(run)), `${folder} does not hold this run's name, ${run}, so it was not removed`);
  await rm(folder, { recursive: true, force: true });
  assert.ok(!existsSync(folder), `${folder} is still there`);
}

/** Remove the throwaway bots folder and every `<bots>.*` beside it (PRD 6.3): the kit's own, and the probe's file. */
async function removeBotsFolderAndSiblings(bots) {
  const parent = path.dirname(bots);
  const mine = path.basename(bots);
  const ours = async () => (await readdir(parent)).filter((name) => name === mine || name.startsWith(`${mine}.`));
  for (const name of await ours()) await rm(path.join(parent, name), { recursive: true, force: true });
  assert.deepEqual(await ours(), [], `this test left folders behind in ${parent}`);
}

/** One conversation's transcript, whole lines only, a JSON object each. */
function linesOf(projects, home, id) {
  if (typeof id !== 'string') return [];
  const file = path.join(projects, slugOf(home), `${id}.jsonl`);
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
const toolUses = (lines) => lines.filter((line) => line.type === 'assistant').flatMap((line) => itemsOf(line, 'tool_use'));
const toolResults = (lines) => lines.filter((line) => line.type === 'user').flatMap((line) => itemsOf(line, 'tool_result'));
const saidBySession = (lines) => lines.filter((line) => line.type === 'assistant').flatMap((line) => itemsOf(line, 'text')).map((item) => String(item.text ?? '')).join('\n');

/** The last lines of a transcript, short, for the message of a wait that ran out. */
function tailOf(lines, count = 15) {
  if (lines.length === 0) return '    (nothing)';
  return lines.slice(-count).map((line) => `    ${line.timestamp ?? '-'}  ${line.type}  ${JSON.stringify(line).slice(0, 300)}`).join('\n');
}

/** The commit of the checkout this test runs from, or why it could not be read. */
function commitRun() {
  const done = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: path.dirname(path.dirname(cliEntry)) });
  if (done.error !== undefined) return `(git did not run: ${done.error.message})`;
  return done.status === 0 ? done.stdout.trim() : `(git rev-parse HEAD failed: ${done.stderr.trim()})`;
}

test('a Claude session the kit starts under an Orca profile saves a memory file in the physical folder with no dialog, and reads what that folder held', async (t) => {
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
  /** Set once this run has made the folder under the real projects folder. */
  let seeded;

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
    // The seeded folder goes first: it holds no tab, and it is under the real
    // ~/.claude/projects, where a foreign tab below must not leave it.
    const failedSeeded = [];
    if (seeded !== undefined) {
      try {
        await removeSeededFolder(seeded.folder, { projects: seeded.projects, bots });
      } catch (error) {
        failedSeeded.push(`${seeded.folder}: ${error.message}`);
      }
    }
    assert.deepEqual(foreign, [], `tabs this test did not create are open at its homes, so it closed only its own and left those projects and ${bots} in place`);
    await removeBotsFolderAndSiblings(bots);

    const { closedNotOurs, goneElsewhere } = guard.verdict(before.handles);
    assert.deepEqual(closedNotOurs, [], 'this test closed tabs it did not create');
    if (goneElsewhere.length > 0) t.diagnostic(`tabs open before this test and closed elsewhere meanwhile: ${goneElsewhere.join(', ')}`);
    for (const each of homes) {
      assert.deepEqual(await terminalsAfterClosing(each, closed), [], `this test left tabs behind in ${each}`);
    }
    assert.deepEqual(failedSeeded, [], 'the folder this test seeded under the real projects folder is still there');
    assert.deepEqual(failedDeletes, [], 'projects this test could not remove, left in Orca');
  });

  // ----------------------------------------------------- 1. the throwaway fleet

  const initialised = obkJson(['init', '--bots', bots, '--harness', 'claude']);
  const fatherTab = (initialised.tabs ?? []).find((entry) => entry.created === true);
  assert.ok(fatherTab !== undefined, `the premise: init opened Bot Father's tab, got: ${JSON.stringify(initialised.tabs)}`);
  const place = allTerminals().find((terminal) => terminal.handle === fatherTab.terminal)?.worktreePath;
  assert.equal(typeof place, 'string', `the premise: Orca lists Bot Father's tab ${fatherTab.terminal}`);

  // ------------------------------------------------------------- 2. the premise

  const { projects } = await profileOfATab(t, { bots, place });

  // ------------------------------------------------------- 3. the seeded memory

  const token = randomBytes(5).toString('hex');
  const CODEWORD = `heron${token}`;
  const WORD = `lantern${token}`;
  const FILE = `obk_test_note_${token}.md`;

  const slug = slugOf(bots);
  premise(slug.length <= 200, `The slug of the throwaway bots folder has ${slug.length} characters, and the kit adds nothing above 200.`);
  const folder = path.join(projects, slug);
  assert.ok(!existsSync(folder), `${folder} is there before this run made it, so it is not this run's, and the test stops here`);
  const memory = path.join(folder, 'memory');
  await mkdir(memory, { recursive: true });
  seeded = { folder, projects };
  const memoryIndex = path.join(memory, 'MEMORY.md');
  const seed = `- The codeword of this project is ${CODEWORD}.\n`;
  await writeFile(memoryIndex, seed);
  const physical = path.join(memory, FILE);

  // ----------------------------------------------------------- 4. the session

  const prompt = [
    'You are a system test\'s throwaway bot and you own nothing.',
    'Your instructions name your auto memory folder, and its MEMORY.md holds a codeword.',
    'Do exactly these three things and nothing else.',
    `First, with the Write tool, write a new file named ${FILE} in that memory folder. The file holds one word: ${WORD}.`,
    'Second, do not change MEMORY.md, and run no command.',
    'Third, answer with the codeword from MEMORY.md, and stop.',
  ].join(' ');
  obkJson(['bot', 'create', '--bots', bots, '--name', BOT.name, '--harness', 'claude', '--charter', `${BOT.display} exists for one system test run and owns nothing.`]);
  obkJson(['session', 'add', '--bots', bots, '--bot', BOT.name, '--name', 'daily', '--model', 'claude-haiku-5-5', '--effort', 'low', `--prompt=${prompt}`]);
  obkJson(['permission', 'approval', '--bots', bots, '--bot', BOT.name, '--session', 'daily', '--approval', 'auto']);

  gateStillOpen('obk up of the throwaway session');
  const entry = tabOf(obkJson(['up', '--bots', bots, '--bot', BOT.name]), 'daily');
  assert.equal(entry.created, true, 'up opened the session\'s tab');
  assert.equal(entry.harnessStarted, true, `no claude came up in ${entry.title}: \`orca terminal read --terminal ${entry.terminal} --screen\``);
  const tab = { title: entry.title, handle: entry.terminal, home, bots };
  const screen = () => lookAtScreen(t, tab);
  const lines = () => linesOf(projects, home, entryInBook().session);

  // Orca may still have the line in the tab's text: said, not failed.
  const typed = orca(['terminal', 'read', '--terminal', entry.terminal]);
  const text = JSON.stringify(typed.result ?? {});
  t.diagnostic(text.includes('--settings') && text.includes('autoMemoryDirectory')
    ? 'the tab\'s text shows the kit\'s line with --settings and autoMemoryDirectory'
    : 'the kit\'s line is no longer in what Orca reads of the tab; the file and the transcript below are the proof');

  // ----------------------------------------------------------- 5. what it did

  // a. The file, at the physical folder, holding the word.
  await until(
    `${FILE} to appear in ${memory}`,
    ANSWER_MS,
    async () => (existsSync(physical) ? true : undefined),
    () => `\n  the conversation:\n${tailOf(lines())}${whatIsUp(tab.handle)}`,
    screen,
  );
  await until(
    `${physical} to hold ${WORD}`,
    30000,
    async () => (readFileSync(physical, 'utf8').trim() === WORD ? true : undefined),
    () => `\n  it holds: ${readFileSync(physical, 'utf8')}`,
    screen,
  );

  // d. The answer, with the codeword it can have only from the seeded folder.
  await until(
    `the session to answer with the codeword ${CODEWORD}`,
    ANSWER_MS,
    async () => (saidBySession(lines()).includes(CODEWORD) ? true : undefined),
    () => `\n  the conversation:\n${tailOf(lines())}${whatIsUp(tab.handle)}`,
    screen,
  );
  assert.ok(!prompt.includes(CODEWORD), 'the premise: the prompt does not hold the codeword');

  // b. The Write call: to the physical path, and it did not fail.
  const now = lines();
  const uses = toolUses(now);
  t.diagnostic(`the session's tool calls: ${uses.map((use) => use.name).join(', ') || '(none)'}`);
  t.diagnostic(`Claude Code version the transcript records: ${now.map((line) => line.version).find((one) => typeof one === 'string') ?? '(none recorded)'}`);
  const writes = uses.filter((use) => use.name === 'Write' && path.basename(String(use.input?.file_path ?? '')) === FILE);
  assert.equal(writes.length, 1, `one Write call for ${FILE}, got: ${JSON.stringify(writes)}\n  the conversation:\n${tailOf(now)}`);
  assert.equal(writes[0].input.file_path, physical, 'the Write goes to the physical path, not the path through the profile');
  const result = toolResults(now).find((one) => one.tool_use_id === writes[0].id);
  assert.notEqual(result, undefined, `the Write call has its result:\n${tailOf(now)}`);
  assert.notEqual(result.is_error, true, `the Write call did not fail: ${JSON.stringify(result)}`);

  // c. The dialog, on the screen as the work ends: every look before this one checked too.
  const last = rowsOf(tab.handle);
  if (last !== undefined) failOnDialog(tab.handle, last);

  // e. The folder holds what was seeded, and the new file, and nothing else.
  assert.equal(readFileSync(memoryIndex, 'utf8'), seed, 'MEMORY.md is as it was seeded');
  assert.deepEqual((await readdir(memory)).sort(), ['MEMORY.md', FILE].sort(), 'the memory folder holds MEMORY.md and the new file');
});
