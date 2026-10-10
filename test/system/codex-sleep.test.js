// A system test, and the live probe #432 asks for before any fix: what a Codex
// bot on a GPT-6 model does when it is told to wait for mail, and what a kit
// notice does to it then. Against the real Codex in the real Orca on this
// machine, on the machine's own default Codex model. Run it alone with
// `npm run test:system -- --yes test/system/codex-sleep.test.js`; `npm test`
// cannot, and no CI machine could.
//
// Seen in #240's live set (Codex 0.158.0, gpt-6-astra): messaging.test.js's
// Codex bot, whose start prompt ends "Say nothing now and wait.", never ended
// its turn. Its own rollout shows a function call `sleep` with
// `{"duration_ms":43200000}`, twelve hours, and nothing after it. Read in
// Codex 0.158.0's source for #432, not run: `sleep` is a built-in tool behind
// the feature `sleep_tool`, on by default, offered to the GPT-6 models; it ends
// early only when new input arrives; and `-c features.sleep_tool=false` should
// turn it off.
//
// Two Codex bots, each with one session told what messaging.test.js's Codex bot
// is told: to read its mail when a line says it is waiting, and then print
// MAIL: and the message, and to "Say nothing now and wait." Both sessions are
// given their folder's trust at launch (#240, test/helpers/codex-trust.js).
// `awake-codex` also has `-c features.sleep_tool=false`, as every other system
// test's Codex session does since #432's ruling; `sleep-codex` keeps the tool
// (`codexTrustArgs(bots, { sleep: true })`, the one session allowed it): it is
// the check that a real bot, which keeps the tool, still gets its mail.
//
// What is ASSERTED:
//
//   1. SLEEPS. `sleep-codex`'s rollout gets a `sleep` call, and for WATCH_MS
//      after it is seen the call gets no answer and Orca's `tui-idle` never
//      says the tab is idle: its turn does not end.
//   3. THE FLAG. `awake-codex` carries the flag on its command line (the
//      premise); its rollout has no `sleep` call; its turn ends (`tui-idle`
//      idle) within FLAG_IDLE_MS; and mail sent to it the kit's own way is
//      read, its text printed after MAIL:, within READ_MS.
//
// What is OBSERVED, NOT JUDGED:
//
//   2. THE NOTICE. While `sleep-codex` sleeps, mail is sent to it the kit's own
//      way, `obk message send`, so the kit gates and types its notice into the
//      tab. Printed as diagnostics: what the send said (typed and seen, typed
//      but not seen, held back and why); whether the sleep ended, and how long
//      after the send; whether the bot read the mail; and whether its tab went
//      idle. They are watched until both bots have read their mail, READ_MS at
//      most, and a fact not seen by then is printed as not seen in the time
//      actually watched. Only what the observation needs is asserted:
//      the sleep was still running when the mail was sent, and the mail was
//      queued.
//
// The evidence is each session's own rollout: `~/.codex/sessions/…/rollout-…-
// <id>.jsonl`, found by the conversation id the book holds, read only, and only
// its `function_call` and `function_call_output` entries and their times
// (test/helpers/codex-rollout.js). What the sessions and the kit said in them
// is never read.
//
// The sleeping tab stays busy for up to twelve hours. The teardown closes it
// the same way it closes every other tab of its own, `orca terminal close
// --terminal <handle> --tab` through the tab guard (`guard.closeOwnAt`): a close
// takes the tab and what runs in it whether it is busy or not, as `obk restart`
// does to a running session every time.
//
// The machine it runs on is someone's working machine, with their own tabs
// open. So this test, like the ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory;
//   - writes down every terminal and workspace Orca already had, before it
//     creates anything;
//   - runs this checkout's `src/cli.js` by its full path, never the machine's
//     `obk`;
//   - types into no tab: the only lines that go in are the kit's launch lines
//     and its notices;
//   - closes only its own tabs, through the tab guard, then deletes its own
//     workspaces, whatever happened;
//   - signals no process; `ps` is read one pid at a time.
//
// `orca terminal close --worktree … --all` is never run here, and the helper
// refuses to run it at all.
//
// **It is attended, lightly.** The bots folder is
// `<tmp>/obk-system-codex-sleep-*`. `Bot Father daily` shows Claude Code's
// folder trust; nothing here waits on it, so leave it (its mailbox, which the
// mail is sent from, is made before its harness starts). `Sleep Codex daily`
// and `Awake Codex daily` should ask no folder trust and no hooks review (see
// above); if one does, leave it. If Codex asks before it runs the command the
// notice names, allow it. If Codex offers an update, accept it (PRD 6.5).
//
// It takes about five minutes, ten at the most: two sessions, a watched
// sleep and two mails.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry } from '../helpers/cli.js';
import { codexTrustArgs } from '../helpers/codex-trust.js';
import { rolloutFilesOf, sleepCallsIn } from '../helpers/codex-rollout.js';
import { waitingOn } from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { deleteOwnProject } from '../helpers/own-project.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/**
 * Remove the throwaway bots folder and everything the kit made beside it:
 * `<bots>.prompts` and the rest are siblings of the bots folder (PRD 6.3).
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

/** How long a session is given to start, and to reach its first tool call or the end of its turn. */
const READY_MS = 120000;

/** How long the sleep is watched, once its call is seen, for the turn not to end. */
const WATCH_MS = 90000;

/** How long the flagged session's start turn is given to end. */
const FLAG_IDLE_MS = 60000;

/** How long each bot is given to read its mail once it is sent. */
const READ_MS = 180000;

/** Codex's own record of every conversation (tech notes, section 3): read only. */
const CODEX_SESSIONS = path.join(os.homedir(), '.codex', 'sessions');

/**
 * Ask Orca something and read its JSON. Never the blanket close, on any road.
 * Every tab it opens or closes is counted as this test's, for the check at the end.
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

/** Run `obk ... --json` and read the answer it printed. A tab it says it opened is this test's own. */
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
  return answer.ok === true && Array.isArray(answer.result?.terminal?.tail) ? answer.result.terminal.tail.join('\n') : '';
}

/** What the tab is showing, for the message of a wait that ran out. */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  return `${blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`}\n  orca terminal read --terminal ${handle} --screen\n  ${screenOf(handle).slice(0, 2000)}`;
}

/** Whether Orca calls the tab idle right now: `tui-idle` satisfied, nothing named to answer, and no question on screen. */
function idleNow(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  return answer.ok === true && answer.result?.wait?.satisfied === true && answer.result?.wait?.blockedReason === undefined
    && waitingOn(orca, handle) === undefined;
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

/** The sleep calls in one conversation's rollouts, read only, as test/helpers/codex-rollout.js reads them. */
const sleepsOf = (id) => rolloutFilesOf(CODEX_SESSIONS, id).flatMap((file) => sleepCallsIn(readFileSync(file, 'utf8')));

const SLEEPER = { name: 'sleep-codex', title: 'Sleep Codex daily', word: 'WREN-4471' };
const AWAKE = { name: 'awake-codex', title: 'Awake Codex daily', word: 'STOAT-8826' };

/** How a bot here starts the kit: by the variable its launch line set, this checkout's CLI (#220). */
const KIT = '"$OBK_CLI"';

/** What each bot is told: messaging.test.js's Codex bot's part, the mail and the wait. */
const promptOf = (bots) => [
  'You are a system test\'s bot and you own nothing.',
  `Your bots folder is ${bots}.`,
  'Do nothing that is not written here: read no file, write nothing, and run no command but the ones below.',
  'When a line arrives saying fleet mail is waiting, run exactly the command that line names to read it,',
  'and then print MAIL: followed by the text of the message.',
  `If you ever need the kit, it is ${KIT}.`,
  'Say nothing now and wait.',
].join(' ');

test('a GPT-6 Codex bot told to wait sleeps in its turn; a notice to it is observed; with sleep_tool off it does not sleep and reads its mail', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-codex-sleep-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', SLEEPER.name, AWAKE.name].map(homeOf);

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    // Only this test's own tabs are closed, the sleeping one included. A tab it
    // did not create at one of its homes is not its to close: that project and
    // the bots folder stay where they are, and the test fails naming the tab (#426).
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

  obkJson(['init', '--bots', bots, '--harness', 'claude']);
  for (const bot of [SLEEPER, AWAKE]) {
    obkJson([
      'bot', 'create', '--bots', bots, '--name', bot.name, '--harness', 'codex',
      '--charter', `${bot.name} exists for one system test run and owns nothing.`,
    ]);
  }
  // The sleep tool left on for sleep-codex alone; taken away for awake-codex, as for every system test's Codex (#432).
  obkJson(['session', 'add', '--bots', bots, '--bot', SLEEPER.name, '--name', 'daily', `--prompt=${promptOf(bots)}`, ...codexTrustArgs(bots, { sleep: true })]);
  obkJson(['session', 'add', '--bots', bots, '--bot', AWAKE.name, '--name', 'daily', `--prompt=${promptOf(bots)}`, ...codexTrustArgs(bots)]);

  // Both up, then the premises: each tab's codex, on the right command line,
  // and the book holding each conversation (the kit's hook ran).
  const tabs = {};
  const ids = {};
  for (const bot of [SLEEPER, AWAKE]) {
    tabs[bot.name] = tabOf(obkJson(['up', '--bots', bots, '--bot', bot.name]), 'daily');
    assert.equal(tabs[bot.name].created, true, `the premise: up opened ${bot.title}`);
  }
  for (const bot of [SLEEPER, AWAKE]) {
    const { terminal } = tabs[bot.name];
    const front = await until(`codex to be in front of ${bot.title}`, READY_MS, async () => {
      const found = inFront(terminal);
      return found?.name === 'codex' ? found : undefined;
    }, () => whatIsUp(terminal));
    const flagged = (psOf(front.pid, ['-ww', '-o', 'command=']) ?? '').includes('features.sleep_tool=false');
    assert.equal(flagged, bot === AWAKE, `the premise: ${bot.title}'s codex ${bot === AWAKE ? 'carries' : 'does not carry'} features.sleep_tool=false`);
    ids[bot.name] = await until(`the kit's hook to tell the book ${bot.title}'s conversation`, READY_MS, async () => (await sessionIn(homeOf(bot.name), 'daily')).session, () => whatIsUp(terminal));
  }

  // 1. SLEEPS: the call, and then WATCH_MS in which its turn does not end.
  const sleeper = tabs[SLEEPER.name];
  const call = await until(`a sleep call in ${SLEEPER.title}'s rollout`, READY_MS, async () => sleepsOf(ids[SLEEPER.name])[0], () => whatIsUp(sleeper.terminal));
  t.diagnostic(`${SLEEPER.title}: sleep called at ${new Date(call.at).toISOString()} for ${call.durationMs} ms`);
  const watchUntil = Date.now() + WATCH_MS;
  while (Date.now() < watchUntil) {
    const now = sleepsOf(ids[SLEEPER.name]).find((one) => one.callId === call.callId);
    assert.equal(now?.endedAt ?? null, null, `${SLEEPER.title}'s sleep call got an answer within ${WATCH_MS} ms of being seen, with no mail sent`);
    assert.equal(idleNow(sleeper.terminal), false, `${SLEEPER.title}'s turn ended within ${WATCH_MS} ms of its sleep call: Orca calls the tab idle.${whatIsUp(sleeper.terminal)}`);
    await setTimeout(5000);
  }
  t.diagnostic(`${SLEEPER.title}: still asleep, the tab busy, ${WATCH_MS / 1000}s after the call was seen`);

  // 3. THE FLAG: no sleep, and the turn ends.
  const awake = tabs[AWAKE.name];
  await until(`${AWAKE.title}'s start turn to end`, FLAG_IDLE_MS, async () => (idleNow(awake.terminal) ? true : undefined), () => whatIsUp(awake.terminal));
  assert.deepEqual(sleepsOf(ids[AWAKE.name]), [], `${AWAKE.title}, with sleep_tool off, made no sleep call`);

  // 2 and 3: mail to both, the kit's own way, the awake one first.
  const send = (bot) => obkJson([
    'message', 'send', '--bots', bots, '--to', `${bot.name}/daily`, '--from', 'bot-father/daily',
    '--subject', 'a note from the system test', '--text', `${bot.word} — nothing to do, just read this.`,
  ]);
  const toAwake = send(AWAKE);
  assert.equal(toAwake.sent, true, `the premise: the mail to ${AWAKE.title} is queued: ${JSON.stringify(toAwake)}`);
  const stillAsleep = sleepsOf(ids[SLEEPER.name]).find((one) => one.callId === call.callId);
  assert.equal(stillAsleep?.endedAt ?? null, null, `the premise of the observation: ${SLEEPER.title} is still asleep when its mail is sent`);
  const sentAt = Date.now();
  const toSleeper = send(SLEEPER);
  assert.equal(toSleeper.sent, true, `the premise: the mail to ${SLEEPER.title} is queued: ${JSON.stringify(toSleeper)}`);
  const { nudged, nudgeUnseen, nudgeTrouble, blocked } = toSleeper;
  t.diagnostic(`${SLEEPER.title}: the send said ${JSON.stringify({ nudged, nudgeUnseen, nudgeTrouble, blocked })}`);

  // Watched together, up to READ_MS: the awake bot reading its mail, and what
  // becomes of the sleeper. The watch stops as soon as both have read their
  // mail, so a fact not seen by then is reported as not seen in the time that
  // was watched, never as not within READ_MS.
  const seen = { awakeRead: null, sleepEnded: null, sleeperRead: null, sleeperIdle: null };
  const readUntil = sentAt + READ_MS;
  while (Date.now() < readUntil) {
    const now = Date.now();
    if (seen.awakeRead === null && screenOf(awake.terminal).includes(AWAKE.word)) seen.awakeRead = now;
    const sleep = sleepsOf(ids[SLEEPER.name]).find((one) => one.callId === call.callId);
    if (seen.sleepEnded === null && sleep?.endedAt != null) seen.sleepEnded = sleep.endedAt;
    if (seen.sleeperRead === null && screenOf(sleeper.terminal).includes(SLEEPER.word)) seen.sleeperRead = now;
    if (seen.sleeperIdle === null && idleNow(sleeper.terminal)) seen.sleeperIdle = now;
    if (seen.awakeRead !== null && seen.sleeperRead !== null) break;
    await setTimeout(3000);
  }
  const watched = Math.round((Date.now() - sentAt) / 1000);
  const after = (at) => (at === null ? `not seen in the ${watched}s watched after the send` : `${Math.round((at - sentAt) / 1000)}s after the send`);
  t.diagnostic(`${SLEEPER.title}: its sleep ended ${after(seen.sleepEnded)}`);
  t.diagnostic(`${SLEEPER.title}: it read its mail ${after(seen.sleeperRead)}`);
  t.diagnostic(`${SLEEPER.title}: its tab went idle ${after(seen.sleeperIdle)}`);
  t.diagnostic(`${SLEEPER.title}: sleep calls now: ${JSON.stringify(sleepsOf(ids[SLEEPER.name]).map(({ at, durationMs, endedAt }) => ({ at: new Date(at).toISOString(), durationMs, ended: endedAt === null ? null : new Date(endedAt).toISOString() })))}`);
  t.diagnostic(`${AWAKE.title}: the send said ${JSON.stringify({ nudged: toAwake.nudged, nudgeUnseen: toAwake.nudgeUnseen, nudgeTrouble: toAwake.nudgeTrouble, blocked: toAwake.blocked })}; it read its mail ${after(seen.awakeRead)}`);

  // 3, asserted: the awake bot read its mail, and never slept.
  assert.notEqual(seen.awakeRead, null, `${AWAKE.title}, with sleep_tool off, should read its mail within ${READ_MS / 1000}s and print its text after MAIL:.${whatIsUp(awake.terminal)}`);
  assert.deepEqual(sleepsOf(ids[AWAKE.name]), [], `${AWAKE.title} made no sleep call, reading its mail included`);
});
