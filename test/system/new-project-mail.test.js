// A system test, and the live check for #676: a bot that `obk up` brings up in
// a new Orca project gets a tab that Orca's window loads, so Orca's own mail
// notice reaches it. It runs against the real Claude Code, the real Codex and
// the real Orca on this machine. Run it alone with
// `npm run test:system -- --yes test/system/new-project-mail.test.js`,
// starting from 00:00 to 05:29 local time; `npm test` cannot, and no CI
// machine could.
//
// What was seen (tech notes, section 1, #676): the tabs of a project that
// `obk up` made were listed `orphaned: true` 2 s to 7 s after they opened, and
// Orca writes its notice only into a tab its window has loaded, so the bot got
// no fleet mail. `orca worktree set --worktree path:<bot home>`, with no field,
// made the window load that project's tabs within 0.4 s. The kit now runs it
// for each bot a run brings up, and never says "worktree" in its output.
//
// The case: one Claude Code bot, NEW, with one session, `daily`, in a
// throwaway bots folder of its own. Bot Father there runs on Codex, so a letter
// from Bot Father to the Claude session takes the Orca road (Claude to Claude
// in one approval class goes by Claude's own messaging). Bot Father's project
// is made by `obk init` and the bot's project by `obk up`, so the bot's project
// is the newest one: the case of #561 and #676, where the newest project's
// tabs were orphaned.
//
//   1. `obk init --harness codex`, `obk bot create`, `obk session add`, then
//      `obk up --bots <bots> --bot NEW`, all by this checkout's `src/cli.js`.
//      ASSERTED: `obk up` printed no `window` line (the line the kit prints
//      when its call to make Orca's window load the bot's project failed).
//   2. For WATCH_MS after `obk up`, every WATCH_STEP_MS: ASSERTED, Orca lists
//      the bot's tab, never `orphaned: true`, and never with a `tabId` that
//      starts `pty:`.
//   3. Once the tab is idle with nothing to answer: one plain letter, by
//      `obk message send` with no --interrupt, from Bot Father. ASSERTED: the
//      send went by the Orca mailbox; Orca's notice reached the tab, read as
//      the letter's `delivered_at` in `orca orchestration inbox --terminal
//      run:<mailbox>` (tech notes, section 1, #630), within NOTICE_MS.
//   4. Once the bot's project is at least PROJECT_AGE_MS old (the test waits
//      when it is not): `orca worktree show --worktree path:<bot home>`, the
//      test's own read-only call; `obk up --bots <bots> --bot NEW` again,
//      which finds the tab and opens none, and so runs the kit's `worktree
//      set` on a project already there; `worktree show` again. ASSERTED:
//      `sortOrder`, `lastActivityAt` and `isUnread` are the same before and
//      after, so the kit's step changes nothing the user can see there. Every
//      field that differs is printed. Then ASSERTED once more: the tab is not
//      orphaned.
//
// In every step, ASSERTED: no obk output says "worktree" (PRD 6: the kit
// says "Orca project").
//
// What is OBSERVED, NOT JUDGED (printed as diagnostics): every obk run's
// output; the tab's listing at each look; how long after the send
// `delivered_at` came.
//
// **This test makes no extra project.** Until #687, the tests beside it
// (pi-mail, mail-interrupt and others) opened one more throwaway project to
// make an orphaned tab real; now none does. This one must not: whether the
// kit's own step keeps the tab real is the point, and a newer project would
// hide it. It does
// not switch to or focus any tab either; its `orca` refuses both.
//
// **The night gate.** A live run makes a throwaway tab real in the owner's
// Orca window. The owner's rule (2026-10-17): such a test runs its live part
// only in a run that names its file, between midnight and 6 am local time
// (helpers/night-gate.js). Issue #676 narrows it for this test: nothing starts
// after 05:30. So its live part starts only from 00:00 to 05:29 local time
// (`startsInWindow`), and helpers/night-gate.js, which other tests share,
// keeps the owner's rule as it is. Otherwise this test opens nothing, says
// why, and is reported as skipped: nothing live was checked.
//
// The machine it runs on is someone's working machine, with their own tabs
// open. So this test, like the ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory;
//   - writes down every terminal and workspace Orca already had, before it
//     creates anything;
//   - runs this checkout's `src/cli.js` by its full path, never the machine's
//     `obk`;
//   - types at no bot: the only keys that go into a tab are the kit's launch
//     lines, Orca's own notice, and the test's answers below, in its own
//     Claude tab;
//   - closes only its own tabs, through the tab guard, then deletes its own
//     projects (deleteOwnProject), whatever happened, and removes its folder;
//   - does not reload Orca's window: it prints the reload line instead;
//   - signals no process.
//
// `orca terminal close --worktree … --all` is never run here, and the helper
// refuses to run it at all. The runner (scripts/test-system.js) keeps and puts
// back ~/.claude.json and ~/.codex/config.toml.
//
// **Nobody answers anything by hand.** The test answers two first-run screens
// itself, in its own throwaway Claude tab, by the suite's allowlists:
//
//   - Claude Code's folder trust, once, for NEW's folder, only when it is the
//     plain one for that folder (`onlyPlainTrustOf`), or the one that
//     pre-approves exactly the kit's default rules for this throwaway bots
//     folder, which ends in the same check (helpers/claude-trust.js
//     `claudeTrustAt`, #558): down and return.
//   - "Teach auto mode about your environment?", at most once, only when it
//     is the captured form (`onlyTeachFormOf`): Esc, then the form gone and
//     ~/.claude.json's autoModeEnvSetup as it was.
//
// Every other question on the tab's screen (`questionOn`) stops the run at
// once, with the screen in the failure message, and is never answered. Bot
// Father's Codex tab is left as it comes up; nothing is sent to it.
//
// What it cannot clean up, and says so: the Run mailboxes it makes (Orca has
// no `run-delete`), named `obk <bot>/<session>`; Claude Code's and Codex's
// own records for this throwaway folder; whatever Orca keeps of its own for
// these tabs. None of them is used again.
//
// It takes about six minutes: most of it waits for the project to be three
// minutes old.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { claudeTrustAt, trustScreenMet } from '../helpers/claude-trust.js';
import { cliEntry } from '../helpers/cli.js';
import { onlyTeachFormOf, questionOn, waitingOn } from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { deleteOwnProject, placesOf, projectsInBots } from '../helpers/own-project.js';
import { atNight, namedThisRun } from '../helpers/night-gate.js';
import { RELOAD_LINE } from '../../src/orca.js';

/**
 * Whether the live part may start at `at`: the owner's night (helpers/night-gate.js,
 * 0 to 5 am) and, for this test (#676), not from 05:30 on, so 00:00 to 05:29.
 */
const startsInWindow = (at) => atNight(at) && !(at.getHours() === 5 && at.getMinutes() >= 30);

/** This file, as the runner names it in OBK_SYSTEM_NAMED. */
const THIS_FILE = fileURLToPath(import.meta.url);

/** The Orca CLI that works for a normal user (tech notes, section 1). */
const ORCA = process.env.OBK_ORCA || '/Applications/Orca.app/Contents/Resources/bin/orca';

/** How long the bot's tab is watched after `obk up`: the orphaned state came 2 s to 7 s after a tab opened (#676). */
const WATCH_MS = 60000;

/** How often it is looked at in that time. */
const WATCH_STEP_MS = 2000;

/** How long a tab is given to get past its own screens and be idle. */
const READY_MS = 180000;

/**
 * How long Orca's notice is given to reach the idle receiver: it reached an
 * idle Claude Code session about 3.5 min after its turn ended (ADR 0053, the
 * probe of 2026-10-11), and 2 s after a send to a tab the window had loaded
 * (#561).
 */
const NOTICE_MS = 300000;

/**
 * How old the bot's project must be before the second `obk up` (#676): the
 * probe saw `sortOrder` move on a project made seconds before, so the check
 * of what the kit's step changes waits until that has had time to settle.
 */
const PROJECT_AGE_MS = 180000;

/** The fields of `worktree show` that the user sees and the kit's step must not change. */
const SEEN_FIELDS = ['sortOrder', 'lastActivityAt', 'isUnread'];

/** How a plain report line about the window starts (#676): the word padded to 11 characters. */
const WINDOW = 'window     ';

/** The bot under test: one Claude Code bot with one session. */
const NEW = 'new-mail';
const SESSION = 'daily';

/** The letter's subject: a word in no prompt. */
const SUBJECT = 'the new project letter PLOVER-8642';

const guard = tabGuard(ORCA);

/**
 * Ask Orca something and read its JSON, through the guard. Never a switch to a
 * tab, never a focus, and of the `worktree` commands only the read-only
 * `worktree show`: the kit's own `worktree set` is what is under test.
 */
function orca(args) {
  assert.ok(
    !(args[0] === 'terminal' && ['switch', 'focus'].includes(args[1])) && !args.includes('--focus'),
    `refusing to run \`orca ${args.join(' ')}\`: this test switches to and focuses no tab`,
  );
  assert.ok(
    args[0] !== 'worktree' || args[1] === 'show',
    `refusing to run \`orca ${args.join(' ')}\`: this test only reads a project's record`,
  );
  return guard.orca(args);
}

// ------------------------------------------------------------- Orca and the kit

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

/** Remove the throwaway bots folder and the kit's folders beside it (`<bots>.messages` and the rest). */
async function removeBotsFolderAndSiblings(bots) {
  const parent = path.dirname(bots);
  const mine = path.basename(bots);
  const ours = async () => (await readdir(parent)).filter((name) => name === mine || name.startsWith(`${mine}.`));

  for (const name of await ours()) {
    await rm(path.join(parent, name), { recursive: true, force: true });
  }
  assert.deepEqual(await ours(), [], `this test left folders behind in ${parent}`);
}

/** Run this checkout's `obk`, by its full path (#217, #220). Nothing it prints says "worktree" (PRD 6). */
function obk(args) {
  const done = spawnSync(process.execPath, [cliEntry, ...args], { encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(done.error, undefined, `could not run \`obk\`: ${done.error?.message}`);
  assert.ok(!/worktree/i.test(done.stdout + done.stderr), `obk ${args.join(' ')} said "worktree", where the kit says "Orca project":\n${done.stdout}${done.stderr}`);
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

/** What the book says about one session right now. */
async function sessionIn(home, name) {
  const book = parse(await readFile(path.join(home, 'sessions.yaml'), 'utf8')) ?? {};
  return book.sessions?.[name] ?? {};
}

/**
 * Keep asking until `look` gives something other than undefined, or the time
 * runs out; `note` says what was seen. `screen`, when given, is run before each
 * look: the tab's own first-run screens, answered or stopped at.
 */
async function until(what, within, look, note = () => '', screen = async () => {}) {
  const stop = Date.now() + within;
  for (;;) {
    await screen();
    const found = await look();
    if (found !== undefined) return found;
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

/** The tab as Orca lists it now, or undefined when Orca does not list it. */
const listed = (handle) => allTerminals().find((terminal) => terminal.handle === handle);

/** Whether Orca lists the tab as real: `orphaned: false` and a tab id that does not start with `pty:` (#561). */
const realTab = (entry) => entry?.orphaned === false && typeof entry.tabId === 'string' && entry.tabId !== '' && !entry.tabId.startsWith('pty:');

/** The tab's listing, in words. */
function listingWords(entry) {
  if (entry === undefined) return 'not listed by Orca at all';
  return `listed with tab id ${entry.tabId} and orphaned: ${entry.orphaned}${realTab(entry) ? '' : ' (ORPHANED: Orca gives an orphaned tab no notice)'}`;
}

/** What the tab is showing, for the message of a wait that ran out. */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  return `${blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`}\n  The tab ${handle} is ${listingWords(listed(handle))}.\n  orca terminal read --terminal ${handle} --screen\n    ${(rowsOf(handle) ?? ['(unreadable)']).join('\n    ')}`;
}

/** Whether Orca calls the tab idle right now, with nothing to answer on it. */
function idleNow(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  return answer.ok === true && answer.result?.wait?.satisfied === true && answer.result?.wait?.blockedReason === undefined
    && waitingOn(orca, handle) === undefined;
}

/** The title of Claude Code's "Teach auto mode" form (#416), as helpers/screens.js has it. */
const TEACH_TITLE = 'Teach auto mode about your environment?';

/** ~/.claude.json's autoModeEnvSetup, which only the Teach form's accept path changes (tech notes, section 1). */
function autoModeState() {
  try {
    const held = JSON.parse(readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8')).autoModeEnvSetup;
    return held === undefined ? 'absent' : JSON.stringify(held);
  } catch (error) {
    return `unreadable (${error.message})`;
  }
}

/** The bot folders whose Claude folder trust this test answered, and the tabs whose Teach form it answered. */
const answered = { trust: new Set(), teach: new Set() };

/**
 * One look at the tab's own first-run screens: this test answers two of them
 * itself, in its own throwaway tab, and only when the suite's allowlist
 * matches (helpers/claude-trust.js `claudeTrustAt`, which ends in
 * `onlyPlainTrustOf`, and helpers/screens.js `onlyTeachFormOf`). `bots` is the
 * throwaway bots folder. Any other question on screen (`questionOn`) stops the
 * run at once, with the screen in the failure message; it is never answered.
 */
async function answerScreens(t, title, handle, home, bots) {
  const rows = rowsOf(handle);
  if (rows === undefined) return;

  if (rows.some((row) => row.includes('Yes, I trust this folder'))) {
    assert.ok(!answered.trust.has(home), `${title} asked Claude Code's folder trust for ${home} again, which this test answered once and answers no more:\n    ${rows.join('\n    ')}`);
    const wrong = claudeTrustAt(rows, home, bots, cliEntry);
    assert.equal(wrong, undefined, `${title}'s folder trust (${trustScreenMet(rows)}) is not one this test may answer, so it answered nothing: ${wrong}.\n  what it showed:\n    ${rows.join('\n    ')}`);
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
    const was = autoModeState();
    const sent = orca(['terminal', 'send', '--terminal', handle, '--text', '\x1b']);
    assert.equal(sent.ok, true, `answering ${title}'s Teach form with Esc failed: ${JSON.stringify(sent.error)}`);
    answered.teach.add(handle);
    await until(`${title}'s Teach form to go after Esc`, 15000, async () => ((rowsOf(handle) ?? []).some((row) => row.trim() === TEACH_TITLE) ? undefined : true), () => whatIsUp(handle));
    await setTimeout(2000);
    const now = autoModeState();
    assert.equal(now, was, `Esc on ${title}'s Teach form taught nothing: ~/.claude.json's autoModeEnvSetup should be as it was (before: ${was}, after: ${now})`);
    t.diagnostic(`answered ${title}'s Teach form with Esc; it went, and ~/.claude.json's autoModeEnvSetup stayed ${was}`);
    return;
  }

  const question = questionOn(rows);
  assert.equal(question, undefined, `${title} shows a screen this test does not know, and it answers nothing; the run stops here:\n    ${rows.join('\n    ')}`);
}

/** The bot's project as Orca's `worktree show` answers it: the test's own read-only call. */
function worktreeShow(home) {
  const answer = orca(['worktree', 'show', '--worktree', `path:${home}`]);
  assert.equal(answer.ok, true, `orca worktree show --worktree path:${home} failed: ${JSON.stringify(answer.error)}`);
  const record = answer.result?.worktree;
  assert.ok(record !== null && typeof record === 'object', `orca worktree show answered no worktree record: ${JSON.stringify(answer.result)}`);
  return record;
}

/** The letter in a Run's mailbox, by its subject, as Orca's inbox answers it, or undefined when it is not there. */
function letterIn(mailbox, subject) {
  const answer = orca(['orchestration', 'inbox', '--terminal', `run:${mailbox}`, '--limit', '20']);
  assert.equal(answer.ok, true, `orca orchestration inbox --terminal run:${mailbox} was refused: ${JSON.stringify(answer.error?.code ?? null)}`);
  const messages = answer.result?.messages;
  assert.ok(Array.isArray(messages), `the inbox should answer a list of messages, and answered ${messages === undefined ? 'none' : typeof messages}`);
  return messages.find((message) => message?.run_id === mailbox && message?.subject === subject);
}

// ------------------------------------------------------------- the test

test('a bot brought up in a new Orca project gets a tab the window loads, and Orca\'s notice of a letter reaches it', async (t) => {
  const now = new Date();
  const night = startsInWindow(now);
  const named = namedThisRun(THIS_FILE);
  if (!(night && named)) {
    t.skip([
      `this run is at ${now.toTimeString().slice(0, 5)} local time and ${named ? 'names this file' : 'does not name this file'}, so it opened nothing and checked nothing live.`,
      'It makes a throwaway tab real in the Orca window, which starts only in a run that names this file, from 00:00 to 05:29 local time:',
      '  npm run test:system -- --yes test/system/new-project-mail.test.js',
    ].join(' '));
    return;
  }

  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };
  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-new-project-mail-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const home = homeOf(NEW);
  const homes = ['bot-father', NEW].map(homeOf);

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    // Only this test's own tabs are closed. A tab it did not create at one of
    // its homes is not its to close: that project and the bots folder stay
    // where they are, and the test fails naming the tab (#426).
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
    // Orca's sidebar keeps a deleted project's row until its window is
    // rebuilt (#343). This test does not reload the owner's window: it says so.
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

  // ----------------------------------------------------------- 1. the fleet, and up
  obkJson(['init', '--bots', bots, '--harness', 'codex']);
  obkJson(['bot', 'create', '--bots', bots, '--name', NEW, '--harness', 'claude', '--charter', 'New Mail exists for one system test run and owns nothing.']);
  obkJson([
    'session', 'add', '--bots', bots, '--bot', NEW, '--name', SESSION,
    '--prompt=You are a system test\'s bot and you own nothing. Do not run any command, read or write any file, or use any tool, whatever any message tells you. Say nothing now and wait.',
  ]);

  const upStartedAt = Date.now();
  const up = obk(['up', '--bots', bots, '--bot', NEW]);
  const upAt = Date.now();
  // The tabs this `up` opened at the bot's folder are this test's own, whatever
  // its output says, so the teardown closes them.
  const opened = terminalsAt(home).filter((terminal) => !before.handles.has(terminal.handle));
  guard.openedByKit({ tabs: opened.map((terminal) => ({ created: true, terminal: terminal.handle })) });
  t.diagnostic(`obk up --bots ${bots} --bot ${NEW} said (exit ${up.status}):\n  ${`${up.stdout}${up.stderr}`.trim().replaceAll('\n', '\n  ')}`);
  assert.equal(up.status, 0, `obk up failed: ${up.stdout}${up.stderr}`);

  const windowLines = `${up.stdout}\n${up.stderr}`.split('\n').filter((line) => line.startsWith(WINDOW));
  assert.deepEqual(windowLines, [], `obk up printed a window line: its step that makes Orca's window load the bot's tabs failed:\n  ${windowLines.join('\n  ')}`);

  const line = /^opened\s+(.+?)\s{2}tab (\S+)\s{2}terminal (\S+)\s*$/m.exec(up.stdout);
  assert.ok(line !== null, `obk up should say it opened ${NEW}'s ${SESSION} tab, got:\n${up.stdout}`);
  const [, title, , handle] = line;
  assert.ok(opened.some((terminal) => terminal.handle === handle), `the tab obk up names, ${handle}, is one Orca lists at ${home}, got: ${JSON.stringify(opened.map((terminal) => terminal.handle))}`);
  const screen = async () => answerScreens(t, title, handle, home, bots);

  // ----------------------------------------------------------- 2. the watch
  const watchEnd = upAt + WATCH_MS;
  let looks = 0;
  while (Date.now() < watchEnd) {
    const entry = listed(handle);
    looks += 1;
    const since = Math.round((Date.now() - upAt) / 1000);
    assert.ok(entry !== undefined, `${title}: Orca no longer lists its tab ${handle}, ${since} s after obk up`);
    assert.ok(
      realTab(entry),
      `${title}: ${since} s after obk up, Orca lists its tab ${handle} ${listingWords(entry)}. The kit's step after making the bot's project should have made the window load it, and Orca gives an orphaned tab no notice.`,
    );
    await screen();
    await setTimeout(WATCH_STEP_MS);
  }
  t.diagnostic(`${title} (${handle}): ${looks} looks over ${WATCH_MS / 1000} s after obk up, each ${listingWords(listed(handle))}`);

  // ----------------------------------------------------------- 3. one letter
  const held = await until(`the book to hold ${title}'s mailbox`, READY_MS, async () => {
    const found = await sessionIn(home, SESSION);
    return typeof found.mailbox === 'string' ? found : undefined;
  }, () => whatIsUp(handle), screen);
  await until(`${title} to be past its screens and idle`, READY_MS, async () => (idleNow(handle) ? true : undefined), () => whatIsUp(handle), screen);

  const road = obkJson(['message', 'to', '--bots', bots, '--to', `${NEW}/${SESSION}`, '--from', 'bot-father/daily']);
  assert.equal(road.transport, 'orca', `the premise: a letter from Bot Father (Codex) to ${NEW}/${SESSION} (Claude) takes the Orca road, got: ${JSON.stringify(road)}`);

  t.diagnostic(`${title} (${handle}) just before the letter: ${listingWords(listed(handle))}`);
  const sentAt = Date.now();
  const sent = obk([
    'message', 'send', '--bots', bots, '--to', `${NEW}/${SESSION}`, '--from', 'bot-father/daily',
    '--subject', SUBJECT, '--text', 'Nothing to do; this letter is only to be delivered.',
  ]);
  t.diagnostic(`the send said (exit ${sent.status}):\n  ${`${sent.stdout}${sent.stderr}`.trim().replaceAll('\n', '\n  ')}`);
  assert.equal(sent.status, 0, `the letter went: ${sent.stdout}${sent.stderr}`);
  assert.match(sent.stdout, /orca mailbox/i, `the send says it went by the Orca mailbox, got:\n${sent.stdout}`);
  assert.doesNotMatch(sent.stdout, /orphaned/i, `the send found the receiver's tab orphaned, got:\n${sent.stdout}`);

  const delivered = await until(
    `Orca's notice of the letter to reach ${title}: its delivered_at in the inbox of run:${held.mailbox}`,
    NOTICE_MS,
    async () => {
      const letter = letterIn(held.mailbox, SUBJECT);
      return letter?.delivered_at == null ? undefined : letter;
    },
    () => `\n  the letter as Orca's inbox has it: ${JSON.stringify((({ id, read, delivered_at: at } = {}) => ({ id, read, delivered_at: at }))(letterIn(held.mailbox, SUBJECT)))}${whatIsUp(handle)}`,
    screen,
  );
  t.diagnostic(`${title}: delivered_at ${delivered.delivered_at}, ${Math.round((Date.now() - sentAt) / 1000)} s or less after the send; the tab is ${listingWords(listed(handle))}`);

  // ----------------------------------------------------------- 4. up again changes nothing seen
  const age = Date.now() - upStartedAt;
  if (age < PROJECT_AGE_MS) {
    t.diagnostic(`the bot's project is ${Math.round(age / 1000)} s old; waiting ${Math.round((PROJECT_AGE_MS - age) / 1000)} s more before the second up`);
    const ready = Date.now() + PROJECT_AGE_MS - age;
    while (Date.now() < ready) {
      await screen();
      await setTimeout(Math.min(5000, Math.max(0, ready - Date.now())));
    }
  }
  const showBefore = worktreeShow(home);
  const again = obkJson(['up', '--bots', bots, '--bot', NEW]);
  const showAfter = worktreeShow(home);

  const entries = (again.tabs ?? []).filter((entry) => entry.name === SESSION);
  assert.equal(entries.length, 1, `the second up names the ${SESSION} tab once, got: ${JSON.stringify(again.tabs)}`);
  assert.equal(entries[0].created, false, `the second up found the tab and opened none, got: ${JSON.stringify(entries[0])}`);
  assert.equal(entries[0].terminal, handle, `it found the same tab, ${handle}, got: ${JSON.stringify(entries[0])}`);
  const trouble = (again.projects ?? []).filter((entry) => entry.windowTrouble !== undefined);
  assert.deepEqual(trouble, [], 'the second up\'s call to make the window load the project worked: no windowTrouble');

  const changed = [...new Set([...Object.keys(showBefore), ...Object.keys(showAfter)])]
    .filter((key) => JSON.stringify(showBefore[key]) !== JSON.stringify(showAfter[key]));
  for (const key of changed) t.diagnostic(`worktree show ${key}: before the second up ${JSON.stringify(showBefore[key])}, after it ${JSON.stringify(showAfter[key])}`);
  if (changed.length === 0) t.diagnostic('worktree show: every field the same before and after the second up');
  for (const key of SEEN_FIELDS) {
    assert.ok(key in showBefore, `the premise: worktree show answers ${key}, got: ${JSON.stringify(showBefore)}`);
    assert.deepEqual(showAfter[key], showBefore[key], `the second up changed ${key} of the bot's project (before ${JSON.stringify(showBefore[key])}, after ${JSON.stringify(showAfter[key])}), which the user sees`);
  }

  const last = listed(handle);
  assert.ok(realTab(last), `${title}: after the second up, Orca lists its tab ${handle} ${listingWords(last)}`);
});
