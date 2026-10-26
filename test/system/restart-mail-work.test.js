// A system test, and the live check for #709: a Codex session the kit resumes
// in a new tab with mail waiting does the mail's work, and one with no mail
// only answers. Against the real Codex in the real Orca on this machine. Run it
// alone with `npm run test:system -- --yes test/system/restart-mail-work.test.js`,
// between midnight and 6 am local time; `npm test` cannot, and no CI machine
// could.
//
// Seen live twice before #709: a Codex session restarted with unread mail read
// the mail (Orca's notice reached the new tab), then obeyed the kit's resume
// line, which said 'Reply "ok"; nothing else is asked.', replied "ok" and went
// idle. The mail's work was never done. Since #709 the line asks the session
// to read its mail with the kit's own check and do what it asks, mail it read
// just before the line included, and to reply "ok" only when there is none
// (helpers/cli.js listLineOf, here with this checkout's CLI and the throwaway
// bots folder). `up`, `restart` and `unpause` share the one path that types it
// (test/codex-resume-list-line.test.js covers all three against the fake).
//
// One Codex bot `mail-resume` with one session `main`:
//
//   0. `obk up`: a fresh start. Its start prompt gives it one turn, so the book
//      holds its conversation and Codex has it on record, which is what a
//      resume picks up. Bot Father's mailbox, which the letter is sent from,
//      is in the book.
//   1. MAIL WAITING. `obk pause`, which closes the session's tab. Then one
//      letter to it with `obk message send`, from bot-father/daily. With no
//      tab, Orca has nowhere to ring, so the letter waits unread in the
//      session's mailbox (read from the mailbox, as `obk health` reads it: the
//      premise; its `delivered_at` is printed). Then `obk unpause`: a new tab, the
//      conversation resumed, the kit's line typed. The letter asks for one
//      small piece of work that shows on disk: WORD written into WORK_FILE in
//      the bot's own folder. WORD is in no prompt and in no line the kit types.
//      ASSERTED:
//        a. the entry says `listLine: true`;
//        b. the session's own record (its Codex rollout) holds the kit's line,
//           word for word, as a user turn since unpause began, and the only
//           user turn that is not Codex's own context or Orca's mail notice;
//        c. no user turn since unpause began holds WORD: the kit typed none of
//           the mail into the tab;
//        d. WORK_FILE holds WORD within ANSWER_MS of unpause returning.
//   2. NO MAIL. The premise: the session's mailbox holds no unread letter.
//      Then `obk restart --session main`: a new tab, the conversation resumed,
//      the kit's line typed. ASSERTED:
//        a. the entry says `listLine: true`;
//        b. the rollout holds the kit's line as the only typed user turn since
//           restart began, an answer after it, and then the end of that turn;
//        c. WORK_FILE is as case 1 left it, the same text and the same
//           modification time: the session did not do the old letter's work
//           again (the line names "mail you read just before this line", and
//           the letter of case 1 is in the conversation's history).
//
// Case 1 comes first so that case 2 has a letter in its history to do again,
// and so case 2's "no mail" holds after a real letter was read.
//
// Why pause and unpause make the mail wait, and not a restart of a live tab:
// a letter sent to a session whose tab is live and idle gets Orca's notice in
// that tab at once, and the session reads it there before any resume (tech
// notes, "Mailbox"). Paused, the session has no tab; its mailbox, an Orca Run,
// stays in the book, and `message send` puts the letter in it. The new tab's
// launch line binds the Run to that tab (`obk session mailbox`), and Orca's
// notice for the letter can go only there.
//
// What is OBSERVED, NOT JUDGED (printed as diagnostics): every message in the
// rollout since each command began, its first words only; whether Orca's notice
// came, and before or after the kit's line; the tool calls the session made,
// by name, and whether one of them ran the kit's mail check; what the session
// answered after the line, and whether it said "ok"; the letter's `read` and
// `delivered_at` in the mailbox after case 1.
//
// Codex's record. Codex writes every conversation to
// `~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-<stamp>-<id>.jsonl` (tech notes,
// section 3). This test only reads there: the names under that folder, to find
// its own conversation's files by id, and those files alone. Before each
// command it notes how many whole lines each of them holds, and afterwards
// reads only the lines added since, as codex-resume-list-line.test.js does. A
// user message that begins `# AGENTS.md instructions` or `<` is Codex's own
// context, not a typed line.
//
// **The night gate.** helpers/system.js runs this test only in a run that
// names its file, between midnight and 6 am local time (#689). It reads the
// gate again right before each later kit command that can open a tab or make
// the Orca window load a project (#687). When the night ended during the run,
// it opens nothing more and fails, and names the step that did not run.
//
// The machine it runs on is someone's working machine, with their own tabs
// open. So this test, like the ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory,
//     `<tmp>/obk-system-restart-mail-*`; the bot's project shows in Orca as
//     `Mail Resume`;
//   - writes down every terminal and workspace Orca already had, before it
//     creates anything;
//   - runs this checkout's `src/cli.js` by its full path, never the machine's
//     `obk`;
//   - types into no tab: the only lines that go in are the kit's launch lines,
//     the kit's resume line and Orca's own notices;
//   - closes only its own tabs, through the tab guard, then deletes its own
//     workspaces, whatever happened;
//   - never writes to ~/.codex or ~/.claude, and signals no process.
//
// `orca terminal close --worktree … --all` is never run here, and the helper
// refuses to run it at all. The runner (scripts/test-system.js) keeps and puts
// back ~/.claude.json and ~/.codex/config.toml.
//
// **Nobody answers anything by hand, and this test answers nothing.** The
// session's Codex is given its folder's trust at launch (#240,
// helpers/codex-trust.js), so it should ask nothing. Any question on its
// screen (`questionOn`) stops the run at once, with the screen in the failure
// message; it is never answered. `Bot Father daily` shows Claude Code's
// folder trust: nothing here waits on Bot Father, and its mailbox is made
// before its harness starts, so the test leaves that screen as it is and
// types nothing into that tab.
//
// It takes five to ten minutes: one start and two resumes, each with a turn.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry, listLineOf } from '../helpers/cli.js';
import { codexTrustArgs } from '../helpers/codex-trust.js';
import { rolloutFilesOf } from '../helpers/codex-rollout.js';
import { questionOn, waitingOn } from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { deleteOwnProject } from '../helpers/own-project.js';
import { atNight, namedThisRun } from '../helpers/night-gate.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/** This file, as the runner names it in OBK_SYSTEM_NAMED. */
const THIS_FILE = fileURLToPath(import.meta.url);

/**
 * The night gate again, right before a later kit command that can open a tab
 * or make the Orca window load a project (#687), as mail-interrupt.test.js
 * reads it. When the night ended during the run, the test opens nothing more
 * and fails here, naming `step`, which did not run. The teardown runs as before.
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

/** The Orca CLI that works for a normal user (tech notes, section 1). */
const ORCA = process.env.OBK_ORCA || '/Applications/Orca.app/Contents/Resources/bin/orca';

/** How long a tab is given to be past its start and idle. */
const READY_MS = 180000;

/** How long a real agent is given to answer, or to do the letter's work. */
const ANSWER_MS = 240000;

/** How many letters of the session's mailbox are read for the premises: all of them, in this throwaway mailbox. */
const MAIL_LIMIT = 20;

const guard = tabGuard(ORCA);
const { orca } = guard;

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

/** Run this checkout's `obk`, by its full path (#217, #220). */
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
async function sessionIn(home, name) {
  const book = parse(await readFile(path.join(home, 'sessions.yaml'), 'utf8')) ?? {};
  return book.sessions?.[name] ?? {};
}

/**
 * Keep asking until `look` gives something other than undefined, or the time
 * runs out; `note` says what was seen. `screen`, when given, is run before each
 * look: a question on the tab's screen stops the run there.
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

/** What the tab is showing, for the message of a wait that ran out. */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  return `${blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`}\n  orca terminal read --terminal ${handle} --screen\n    ${(rowsOf(handle) ?? ['(unreadable)']).join('\n    ')}`;
}

/** Whether Orca calls the tab idle right now, with nothing to answer on it. */
function idleNow(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  return answer.ok === true && answer.result?.wait?.satisfied === true && answer.result?.wait?.blockedReason === undefined
    && waitingOn(orca, handle) === undefined;
}

/**
 * One look at the session's tab: this test answers no screen. A question on
 * it (`questionOn`) stops the run at once, with the screen in the message.
 */
function noQuestionOn(title, handle) {
  return async () => {
    const rows = rowsOf(handle);
    if (rows === undefined) return;
    const question = questionOn(rows);
    assert.equal(question, undefined, `${title} shows a question, and this test answers none; the run stops here:\n    ${rows.join('\n    ')}`);
  };
}

// ------------------------------------------------------------- the mailbox

/**
 * The letters in a session's mailbox, `run_<id>` as the book holds it, newest
 * first, as `{ read, delivered }`: whether Orca marked it read, and whether
 * Orca delivered a notice for it. Read with `orca orchestration inbox`, the
 * way `obk health` reads a mailbox (src/orca.js mailIn; tech notes, #630):
 * Orca asks no reader for it, and it marks nothing read or delivered. No
 * subject and no body is kept.
 */
function lettersIn(mailbox) {
  const answer = orca(['orchestration', 'inbox', '--terminal', `run:${mailbox}`, '--limit', String(MAIL_LIMIT)]);
  assert.equal(answer.ok, true, `orca orchestration inbox for run:${mailbox} failed: ${JSON.stringify(answer.error)}`);
  const messages = answer.result?.messages;
  assert.ok(Array.isArray(messages), `orca orchestration inbox answers a list under result.messages, got the keys ${JSON.stringify(Object.keys(answer.result ?? {}))}`);
  return messages.map((one) => ({ read: one?.read === 1 || one?.read === true, delivered: one?.delivered_at != null }));
}

// ------------------------------------------------------------- Codex's record

/** Where Codex keeps its record of every conversation (tech notes, section 3). */
const CODEX_SESSIONS = path.join(os.homedir(), '.codex', 'sessions');

/** The whole lines of one file: a line still being written is not one yet. */
function wholeLinesOf(file) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.pop();
  return lines;
}

/** How many whole lines each file of the conversation's record holds now. */
const recordMark = (id) => new Map(rolloutFilesOf(CODEX_SESSIONS, id).map((file) => [file, wholeLinesOf(file).length]));

/**
 * The entries the conversation's record gained since `mark`, in order, as
 * JSON. An entry whose own `timestamp` is before `since` is left out too, in
 * case a resume starts a new file with the history copied into it.
 */
function entriesSince(id, mark, since) {
  return rolloutFilesOf(CODEX_SESSIONS, id).flatMap((file) => wholeLinesOf(file).slice(mark.get(file) ?? 0))
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    })
    .filter((entry) => !(Date.parse(entry?.timestamp) < since));
}

/**
 * What each entry is, for the reading below, in order: `{ kind: 'message',
 * role, text }` for a user's `input_text` or the model's `output_text`,
 * `{ kind: 'call', name, mailCheck }` for a tool call, `mailCheck` whether its
 * arguments name the kit's ` message check --bots ` (nothing else of them is
 * kept), and `{ kind: 'end' }` for the end of a turn.
 */
function eventsOf(entries) {
  return entries.flatMap((entry) => {
    if (entry?.type === 'event_msg' && ['task_complete', 'turn_complete', 'turn_aborted'].includes(entry.payload?.type)) return [{ kind: 'end' }];
    const item = entry?.type === 'response_item' ? entry.payload : undefined;
    if (item?.type === 'function_call') {
      return [{ kind: 'call', name: String(item.name), mailCheck: String(item.arguments ?? '').includes(' message check --bots ') }];
    }
    if (item?.type !== 'message' || !Array.isArray(item.content)) return [];
    const text = item.content
      .filter((block) => block?.type === 'input_text' || block?.type === 'output_text')
      .map((block) => String(block.text))
      .join('\n');
    return [{ kind: 'message', role: item.role, text }];
  });
}

/** A user message Codex puts in itself: its AGENTS.md instructions, or a block such as `<environment_context>`. */
const codexOwn = (text) => text.trimStart().startsWith('<') || text.trimStart().startsWith('# AGENTS.md instructions');

/** Orca's notice for the session's mailbox, as a user turn: it names `orchestration check` and the Run. */
const isNotice = (text, mailbox) => text.includes('orchestration check') && text.includes(mailbox);

/** The user turns that were typed: not Codex's own context, and not Orca's notice. */
const typedTurns = (events, mailbox) => events
  .filter((one) => one.kind === 'message' && one.role === 'user' && !codexOwn(one.text) && !isNotice(one.text, mailbox))
  .map((one) => one.text.trim());

/** Every event, short, for a diagnostic or a failure message. */
const shortly = (events) => events.map((one) => (one.kind === 'message'
  ? `${one.role}: ${JSON.stringify(one.text.slice(0, 120))}`
  : one.kind === 'call' ? `call ${one.name}${one.mailCheck ? ' (the kit\'s mail check)' : ''}` : 'turn end'));

// ------------------------------------------------------------- the bot

const BOT = { name: 'mail-resume', title: 'Mail Resume main' };
const SESSION = 'main';

/** In the start prompt only, and asked for in lower case, so its echo is not its answer. */
const READY = 'READY-3961';

/** The word the letter asks for: in no prompt, and in no line the kit types. */
const WORD = 'OSPREY-4817';

/** What the session is told: one turn now, then what each later line asks, inside its own folder. */
const promptOf = (home) => [
  "You are a system test's bot and you own nothing.",
  `Reply now with ${READY} in lower case and nothing else.`,
  'After that, do what each later line asks you, and nothing more.',
  `Write no file outside your own folder, ${home}.`,
].join(' ');

test('a Codex session resumed with mail waiting does the mail\'s work after the kit\'s line, and one resumed with no mail only answers (#709; only in a night run that names this file)', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-restart-mail-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', BOT.name].map(homeOf);
  const home = homeOf(BOT.name);
  const WORK_FILE = path.join(home, 'mail-work.txt');
  /** The line the kit types into a Codex session it has just resumed, in the words of #709: this checkout's CLI, this bots folder. */
  const LIST_LINE = listLineOf(cliEntry, bots);

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
    assert.deepEqual(foreign, [], `tabs this test did not create are open at its homes, so it closed only its own and left those projects and ${bots} in place`);
    const parent = path.dirname(bots);
    const mine = path.basename(bots);
    for (const name of (await readdir(parent)).filter((one) => one === mine || one.startsWith(`${mine}.`))) {
      await rm(path.join(parent, name), { recursive: true, force: true });
    }
    assert.deepEqual((await readdir(parent)).filter((one) => one === mine || one.startsWith(`${mine}.`)), [], `this test left folders behind in ${parent}`);
    const { closedNotOurs, goneElsewhere } = guard.verdict(before.handles);
    assert.deepEqual(closedNotOurs, [], 'this test closed tabs it did not create');
    if (goneElsewhere.length > 0) t.diagnostic(`tabs open before this test and closed elsewhere meanwhile: ${goneElsewhere.join(', ')}`);
    for (const each of homes) {
      assert.deepEqual(await terminalsAfterClosing(each, closed), [], `this test left tabs behind in ${each}`);
    }
    assert.deepEqual(failedDeletes, [], 'projects this test could not remove, left in Orca');
  });

  gateStillOpen('obk init');
  obkJson(['init', '--bots', bots, '--harness', 'claude']);
  obkJson([
    'bot', 'create', '--bots', bots, '--name', BOT.name, '--harness', 'codex',
    '--charter', `${BOT.name} exists for one system test run and owns nothing.`,
  ]);
  obkJson(['session', 'add', '--bots', bots, '--bot', BOT.name, '--name', SESSION, `--prompt=${promptOf(home)}`, ...codexTrustArgs(bots)]);

  // 0. A fresh start, and its one turn: the book holds the conversation and
  // its mailbox, and Codex has it on record.
  gateStillOpen(`obk up of ${BOT.name}/${SESSION}`);
  const started = tabOf(obkJson(['up', '--bots', bots, '--bot', BOT.name, '--session', SESSION]), SESSION);
  assert.equal(started.created, true, 'the premise: up opened a tab');
  const startScreen = noQuestionOn(BOT.title, started.terminal);
  const held = await until(
    `${BOT.title}'s conversation and mailbox in the book`,
    READY_MS,
    async () => {
      const found = await sessionIn(home, SESSION);
      return typeof found.session === 'string' && typeof found.mailbox === 'string' ? found : undefined;
    },
    () => ` The kit's hook has not run. A \`Hooks need review\` screen here means the launch-time trust did not take (#240).${whatIsUp(started.terminal)}`,
    startScreen,
  );
  const { session: id, mailbox } = held;
  await until(
    `the start turn to answer ${READY.toLowerCase()}`,
    ANSWER_MS,
    async () => ((rowsOf(started.terminal) ?? []).some((row) => row.includes(READY.toLowerCase())) ? true : undefined),
    () => whatIsUp(started.terminal),
    startScreen,
  );
  await until(`Codex's record of conversation ${id} under ${CODEX_SESSIONS}`, ANSWER_MS, async () => (rolloutFilesOf(CODEX_SESSIONS, id).length > 0 ? true : undefined));
  await until(`${BOT.title} to be idle after its start turn`, READY_MS, async () => (idleNow(started.terminal) ? true : undefined), () => whatIsUp(started.terminal), startScreen);
  // The sender: Bot Father's mailbox, made by its launch line before its harness starts.
  await until(`Bot Father's mailbox in the book, which the letter is sent from`, READY_MS, async () => (typeof (await sessionIn(homeOf('bot-father'), 'daily')).mailbox === 'string' ? true : undefined));
  assert.deepEqual(lettersIn(mailbox), [], `the premise: ${BOT.title}'s mailbox holds no letter before this test sends one`);

  // ------------------------------------------------------------- 1. mail waiting

  const paused = obkJson(['pause', '--bots', bots, '--bot', BOT.name]);
  guard.closedByKit(paused.closed);
  assert.equal(existsSync(WORK_FILE), false, `the premise: ${WORK_FILE} is not there before the letter`);

  gateStillOpen(`the letter to ${BOT.name}/${SESSION}`);
  const sent = obkJson([
    'message', 'send', '--bots', bots, '--to', `${BOT.name}/${SESSION}`, '--from', 'bot-father/daily',
    '--subject', 'a small job from the system test',
    '--text', `Please write the word ${WORD} into the file ${WORK_FILE}, with nothing else in it. That is the whole job.`,
  ]);
  assert.equal(sent.sent, true, `the premise: the letter is queued: ${JSON.stringify(sent)}`);
  t.diagnostic(`the send said ${JSON.stringify({ transport: sent.transport, interrupted: sent.interrupted })}`);
  const waiting = lettersIn(mailbox);
  assert.deepEqual(waiting.map((one) => one.read), [false], 'the premise: the letter waits in the paused session\'s mailbox, unread');
  t.diagnostic(`with mail: before unpause, Orca ${waiting[0].delivered ? 'had set' : 'had not set'} the letter's delivered_at (the session has no tab to ring)`);

  gateStillOpen(`obk unpause of ${BOT.name}`);
  const mailMark = recordMark(id);
  const mailBegan = Date.now();
  const back = tabOf(obkJson(['unpause', '--bots', bots, '--bot', BOT.name]), SESSION);
  const mailReturned = Date.now();
  const backScreen = noQuestionOn(BOT.title, back.terminal);

  // The premises: a new tab, and the conversation the book holds, resumed.
  assert.equal(back.created, true, `with mail: the premise: a new tab, got: ${JSON.stringify(back)}`);
  assert.equal(back.resumed, true, `with mail: the premise: the conversation was resumed, got: ${JSON.stringify(back)}`);
  // 1a. The kit says it typed its line.
  assert.equal(back.listLine, true, `with mail: the kit should have typed its line, and says ${JSON.stringify(back.listLine)}: ${back.listLineTrouble ?? 'no reason given'}.${whatIsUp(back.terminal)}`);

  // 1d. The letter's work, on disk.
  await until(
    `with mail: ${WORD} in ${WORK_FILE}, the letter's work`,
    ANSWER_MS,
    async () => ((await readFile(WORK_FILE, 'utf8').catch(() => '')).includes(WORD) ? true : undefined),
    () => ` Since unpause began:\n  ${shortly(eventsOf(entriesSince(id, mailMark, mailBegan))).join('\n  ')}${whatIsUp(back.terminal)}`,
    backScreen,
  );
  t.diagnostic(`with mail: ${WORK_FILE} held ${WORD} ${Math.round((Date.now() - mailReturned) / 1000)}s after unpause returned`);

  // 1b and 1c. The record: the kit's line, the one line typed, and no mail typed.
  await until(`with mail: ${BOT.title} to be idle after the letter's work`, ANSWER_MS, async () => (idleNow(back.terminal) ? true : undefined), () => whatIsUp(back.terminal), backScreen);
  const mailEvents = eventsOf(entriesSince(id, mailMark, mailBegan));
  for (const line of shortly(mailEvents)) t.diagnostic(`with mail: ${line}`);
  const lineAt = mailEvents.findIndex((one) => one.kind === 'message' && one.role === 'user' && one.text.trim() === LIST_LINE);
  assert.ok(lineAt >= 0, `with mail: the rollout holds the kit's line, word for word, as a user turn since unpause began:\n  ${LIST_LINE}\n  got:\n  ${shortly(mailEvents).join('\n  ')}`);
  assert.deepEqual(typedTurns(mailEvents, mailbox), [LIST_LINE], 'with mail: the kit\'s line is the only line typed into the session since unpause began');
  const userWithWord = mailEvents.filter((one) => one.kind === 'message' && one.role === 'user' && one.text.includes(WORD));
  assert.deepEqual(userWithWord.map((one) => one.text.slice(0, 200)), [], `with mail: no user turn holds ${WORD}: the kit typed none of the letter into the tab`);
  const noticeAt = mailEvents.findIndex((one) => one.kind === 'message' && one.role === 'user' && isNotice(one.text, mailbox));
  t.diagnostic(`with mail: Orca's notice ${noticeAt < 0 ? 'did not come as a user turn' : noticeAt < lineAt ? 'came before the kit\'s line' : 'came after the kit\'s line'}`);
  t.diagnostic(`with mail: the session ran the kit's mail check: ${mailEvents.some((one) => one.kind === 'call' && one.mailCheck)}`);
  const mailAnswer = mailEvents.slice(lineAt + 1).find((one) => one.kind === 'message' && one.role === 'assistant');
  t.diagnostic(`with mail: the session answered after the line ${JSON.stringify(mailAnswer?.text.slice(0, 120) ?? null)}`);
  t.diagnostic(`with mail: the letter in the mailbox now: ${JSON.stringify(lettersIn(mailbox))}`);

  // ------------------------------------------------------------- 2. no mail

  const workBefore = { text: readFileSync(WORK_FILE, 'utf8'), mtimeMs: statSync(WORK_FILE).mtimeMs };
  assert.deepEqual(lettersIn(mailbox).filter((one) => !one.read), [], 'the premise of the case with no mail: the session\'s mailbox holds no unread letter (the letter of case 1 was read with the kit\'s check, which marks it read)');

  gateStillOpen(`obk restart of ${BOT.name}/${SESSION}`);
  const quietMark = recordMark(id);
  const quietBegan = Date.now();
  const restarted = obkJson(['restart', '--bots', bots, '--bot', BOT.name, '--session', SESSION]);
  guard.closedByKit(restarted.closed);
  const again = tabOf(restarted, SESSION);
  const againScreen = noQuestionOn(BOT.title, again.terminal);

  assert.equal(again.created, true, `no mail: the premise: a new tab, got: ${JSON.stringify(again)}`);
  assert.equal(again.resumed, true, `no mail: the premise: the conversation was resumed, got: ${JSON.stringify(again)}`);
  // 2a. The kit says it typed its line.
  assert.equal(again.listLine, true, `no mail: the kit should have typed its line, and says ${JSON.stringify(again.listLine)}: ${again.listLineTrouble ?? 'no reason given'}.${whatIsUp(again.terminal)}`);

  // 2b. The kit's line, an answer after it, and the end of that turn.
  const quietEvents = await until(
    `no mail: an answer after the kit's line in Codex's record of ${id}, and the end of that turn`,
    ANSWER_MS,
    async () => {
      const seen = eventsOf(entriesSince(id, quietMark, quietBegan));
      const at = seen.findIndex((one) => one.kind === 'message' && one.role === 'user' && one.text.trim() === LIST_LINE);
      if (at < 0) return undefined;
      const answered = seen.findIndex((one, index) => index > at && one.kind === 'message' && one.role === 'assistant');
      return answered >= 0 && seen.some((one, index) => index > answered && one.kind === 'end') ? seen : undefined;
    },
    () => ` Since restart began:\n  ${shortly(eventsOf(entriesSince(id, quietMark, quietBegan))).join('\n  ')}${whatIsUp(again.terminal)}`,
    againScreen,
  );
  await until(`no mail: ${BOT.title} to be idle after its answer`, ANSWER_MS, async () => (idleNow(again.terminal) ? true : undefined), () => whatIsUp(again.terminal), againScreen);
  const settled = eventsOf(entriesSince(id, quietMark, quietBegan));
  for (const line of shortly(settled)) t.diagnostic(`no mail: ${line}`);
  assert.deepEqual(typedTurns(settled, mailbox), [LIST_LINE], 'no mail: the kit\'s line is the only line typed into the session since restart began');
  const quietAt = quietEvents.findIndex((one) => one.kind === 'message' && one.role === 'user' && one.text.trim() === LIST_LINE);
  const quietAnswer = quietEvents.slice(quietAt + 1).find((one) => one.kind === 'message' && one.role === 'assistant');
  t.diagnostic(`no mail: the session answered ${JSON.stringify(quietAnswer.text.slice(0, 120))}${/\bok\b/i.test(quietAnswer.text) ? '' : ' (not "ok")'}`);
  t.diagnostic(`no mail: the session ran the kit's mail check: ${settled.some((one) => one.kind === 'call' && one.mailCheck)}; its tool calls: ${JSON.stringify(settled.filter((one) => one.kind === 'call').map((one) => one.name))}`);

  // 2c. The old letter's work was not done again.
  const workAfter = { text: readFileSync(WORK_FILE, 'utf8'), mtimeMs: statSync(WORK_FILE).mtimeMs };
  assert.deepEqual(workAfter, workBefore, `no mail: ${WORK_FILE} is as case 1 left it: the session did not do the old letter's work again`);
});
