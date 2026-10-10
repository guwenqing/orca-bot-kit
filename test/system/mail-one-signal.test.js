// A system test, and the live check for #509: one signal for each fleet mail,
// against the real Claude Code and Codex in the real Orca on this machine
// (written for Claude Code 2.1.296, Codex 0.162.0 and Orca 1.4.223). Run it
// alone with `npm run test:system -- --yes test/system/mail-one-signal.test.js`;
// `npm test` cannot, and no CI machine could.
//
// The rule under test (ADR 0035, the architect's rulings for #509): Orca's own
// notice is the first signal and the kit's typed line a fallback only. An idle
// receiver is watched for up to 8 s; the kit types its line only when Orca's
// notice did not show in the receiver's own record and no turn started. A busy
// Claude Code gets nothing typed, and its own Stop hook tells it of mail still
// unread at its turn end, once for each message. A busy Codex gets the line,
// which it takes into the running turn as a steer.
//
// What is ASSERTED, each case judged from the receiver's own record of its
// turns (the Claude transcript `~/.claude/projects/<slug>/<id>.jsonl`, the
// Codex rollout `~/.codex/sessions/…/rollout-…-<id>.jsonl`, found by the
// conversation id the book holds), read only:
//
//   (Cases 1 and 4 send only once the receiver is at rest, `atRest`: its record
//   shows the turn over, Orca's tui-idle answers ok, on Codex the kit's naming
//   hook (#480) has named the thread and left nothing in the input line, and
//   all of it has held for SETTLE_MS with the record still.)
//
//   1. IDLE CLAUDE. One mail to an idle Claude session. The send's `signal` is
//      "orca" or "line" (with `because: "no-turn"`), and the record holds
//      exactly one signal for the mail, of that kind: Orca's notice for its
//      mailbox and no kit line, or the kit's line and no Orca notice, watched
//      for LATE_MS after the signal. It reads the mail with `obk message check`.
//   2. BUSY CLAUDE. A Claude session busy with a shell loop its start prompt
//      gives it. Each send says `signal: "hook"`, `because: "busy"`, nothing
//      typed. While the loop runs, nothing that looks like the kit's line is on
//      its screen. When the loop's turn ends, the kit's Stop hook tells it: its
//      record gets the hook's text, with "still unread", after the send; then
//      it reads the mail, after the loop's last line. Afterwards its input box
//      holds no kit line and no Orca notice. The hook answers with Stop hook
//      context, not a block (the architect's ruling), so its screen shows it as
//      "Stop hook feedback": the case fails when a screen row draws the hook's
//      fleet mail text as "Stop hook error". Whether "Stop hook feedback" was
//      seen is observed.
//   3. TWO MAILS. Case 2 sends two mails in the one busy turn: one reason names
//      both, it is given once, and the receiver reads both.
//   4. IDLE CODEX. One mail to an idle Codex session: one signal, Orca's notice
//      or the kit's line, never both, judged from its rollout, and of the kind
//      the send said; watched for LATE_MS after the signal. It reads the mail.
//   5. BUSY CODEX. A Codex session busy with a shell loop (sleep tool off). The
//      send says `signal: "line"`, `because: "busy"`. The rollout shows the
//      line as a user message inside the running turn (no turn start between
//      the loop's call and the line; the line before the loop's last line);
//      it reads the mail in that turn; after the turn ends its input box holds
//      no kit line, and no Orca notice for the mail lands in its rollout within
//      LATE_MS of the turn's end.
//   6. RETIRE. A Claude session told to ignore its mail gets one; `obk retire
//      --session` of it says `unread: { count: 1, from: [the sender] }`.
//   7. NAMING HOLDS THE TURN (the architect's ask for run 3; beside case 4).
//      A further Codex session, `mail-codex/named`, is sent one mail as soon
//      as its first turn has ended and the kit's naming hook (#480) has begun
//      to type `/rename` into it. Its rollout is watched for up to
//      NAMED_WATCH_MS for any signal for that mail: Orca's notice for its
//      mailbox, or the kit's line. Which came, when, and whether the mail was
//      read are OBSERVED (diagnostics), as is the send's answer, expected to
//      say "the kit is typing into it". It FAILS only when no signal at all
//      reached the session in that time: the gap against R1 the architect
//      wants to know about.
//
//   Also asserted: no Claude session here showed a hooks question of Claude
//   Code's own at its start (the new Stop hook is a new entry in the bot's
//   `.claude/settings.json`; the tech notes read 2.1.296 as asking nothing).
//
// Every case runs every time (the architect's ruling after the first live
// run): a case that fails is recorded, the run goes on to the next group, and
// the test fails at its end with every failure together. Only the two senders'
// bring-up, which every case needs, ends the run when it fails.
//
// What is OBSERVED, NOT JUDGED (printed as diagnostics): every send's answer;
// in case 2, whether Orca typed its own notice into the busy Claude tab after
// its turn ended (out of #509's scope: "Orca's own notice when Orca itself
// types it into a busy tab"); in cases 1 and 4, which signal went.
//
// What it cannot show live:
//   - A Codex session's hooks review for the kit's hooks: every system test's
//     Codex is launched with `--dangerously-bypass-hook-trust`
//     (test/helpers/codex-trust.js). That `.codex/hooks.json` is unchanged is
//     the ordinary suite's (test/mail-turn-end-hook.test.js, T2).
//   - Which way an idle receiver is reached is Orca's choice, not the test's:
//     a tab the window has not loaded gets no notice, so case 1 and case 4
//     accept either signal and judge only that there is exactly one.
//   - The kit's record in the system temp folder: the ordinary suite's.
//
// The receivers: bot `mail-claude` (Claude Code) with sessions `idle`, `busy`
// and `quiet`; bot `mail-codex` (Codex) with sessions `idle`, `busy` and
// `named`. Mail to a Claude session is sent `--from mail-codex/idle`, and mail
// to a Codex session `--from mail-claude/idle`, so every mail takes the Orca
// road: Claude to Claude in one approval class goes by Claude's own
// messaging. The busy sessions, and `named`, are brought up only when their
// case starts, so their loops cannot end early and the naming is watched from
// its start; the folder's trust, answered for `idle`, covers them.
//
// Every word a check waits for is one its tab was never told: each mail's
// subject and body word are in no start prompt, and no prompt says "still
// unread", "Fleet mail from" or "orchestration check". Each bot reads its mail
// with the kit's own check, its shell writing the time and the answer to a file
// in its own folder, so what was read is the kit's answer and when is a time
// its own shell wrote down.
//
// The machine it runs on is someone's working machine, with their own tabs
// open. So this test, like the ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory;
//   - writes down every terminal and workspace Orca already had, before it
//     creates anything;
//   - runs this checkout's `src/cli.js` by its full path, never the machine's
//     `obk`;
//   - types at no bot: the only lines that go into a tab are the kit's launch
//     lines, its lines for mail and Orca's own notices; the only keys the test
//     presses are its two answers below, in its own Claude tabs;
//   - closes only its own tabs, through the tab guard, then deletes its own
//     workspaces, whatever happened;
//   - signals no process.
//
// `orca terminal close --worktree … --all` is never run here, and the helper
// refuses to run it at all. The runner (scripts/test-system.js) keeps and puts
// back ~/.claude.json and ~/.codex/config.toml. It leaves behind what every
// system test does: the Run mailboxes Orca cannot delete, and offline entries
// in Claude Code's Remote Control list.
//
// **Nobody answers anything by hand** (the architect's ruling for the #509
// live run). The test answers two first-run screens itself, in its own
// throwaway Claude tabs, by the suite's allowlists and the keys and checks
// session-clear.test.js uses (`answerScreens`):
//
//   - Claude Code's folder trust, once, for `mail-claude`'s folder, only when
//     it is the plain one for that folder (helpers/screens.js
//     `onlyPlainTrustOf`): down and return. `Mail Claude quiet` and `Mail
//     Claude busy` are in the same folder; a trust question there again stops
//     the run.
//   - "Teach auto mode about your environment?", at most once in a tab, only
//     when it is the captured form (`onlyTeachFormOf`): Esc, then the form
//     gone and ~/.claude.json's autoModeEnvSetup as it was.
//
// Every other question on a tab's screen (`questionOn`) stops the run at once,
// with the screen in the failure message, and is never answered: a trust
// screen that is not the plain one, a second Teach form, Claude Code asking
// before it runs a command, a Codex update offer, a hooks review. The Codex
// tabs are given their trust at launch and should ask nothing. `Bot Father
// daily`, if `init` opens it, is never looked at.
//
// Every wait says what the tab is showing when it runs out, so a run that was
// left alone names the screen that stopped it.
//
// It takes about ten minutes, fifteen at the most: six sessions, three
// cases side by side, a quiet one and a retire, then two busy cases side by
// side around 75 s loops, and LATE_MS watches after each signal.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry } from '../helpers/cli.js';
import { codexTrustArgs } from '../helpers/codex-trust.js';
import { rolloutFilesOf } from '../helpers/codex-rollout.js';
import { onlyPlainTrustOf, onlyTeachFormOf, questionOn, waitingOn } from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { deleteOwnProject } from '../helpers/own-project.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/** The Orca CLI that works for a normal user (tech notes, section 1). */
const ORCA = process.env.OBK_ORCA || '/Applications/Orca.app/Contents/Resources/bin/orca';

/** How long a tab is given to get past the screens of its own, a person answering them. */
const READY_MS = 180000;

/** How long a bot is given to do something: read its mail, end its turn. */
const ANSWER_MS = 240000;

/** How long after a signal the record is watched for a second one. */
const LATE_MS = 60000;

/** How long a line the kit typed is given to show in the record. */
const RECORD_MS = 30000;

/** How long case 7 watches for any signal after its send. */
const NAMED_WATCH_MS = 180000;

/** How long a receiver must stay at rest, its record still, before mail that wants it idle is sent. */
const SETTLE_MS = 5000;

/** The busy loop: this many lines, one a second. */
const LOOP_STEPS = 75;
const PART_WAY = 'STEP-03';
const LAST_STEP = `STEP-${LOOP_STEPS}`;

/** Claude Code's and Codex's own records (tech notes, sections 2 and 3): read only. */
const CLAUDE_PROJECTS = path.join(os.homedir(), '.claude', 'projects');
const CODEX_SESSIONS = path.join(os.homedir(), '.codex', 'sessions');

/** Where Codex's `/rename` writes a thread's name (codex-thread-name.test.js): read only, and only this thread's lines. */
const SESSION_INDEX = path.join(os.homedir(), '.codex', 'session_index.jsonl');

/** The start of the kit's line, as src/message.js types it and test/message-nudge.test.js pins it. */
const KIT_LINE = /Fleet mail from [^\s:]+: /;

/** A hooks question of a harness's own: Codex's words as captured (helpers/screens.js), and the like. */
const HOOKS_QUESTION = /hooks? (?:is|are) new or changed|hooks need review|review hooks|hooks? (?:have )?changed/i;

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
 * look: the tab's own first-run screens, answered or stopped at (`screensOf`).
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

/** Every row the tab renders now, one to a line, for a message. */
const screenRows = (handle) => (rowsOf(handle) ?? ['(unreadable)']).join('\n    ');

/** What the tab is showing, for the message of a wait that ran out. */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  return `${blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`}\n  orca terminal read --terminal ${handle} --screen\n    ${screenRows(handle)}`;
}

/** Whether Orca calls the tab idle right now, with nothing to answer on it. */
function idleNow(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  return answer.ok === true && answer.result?.wait?.satisfied === true && answer.result?.wait?.blockedReason === undefined
    && waitingOn(orca, handle) === undefined;
}

/** Every screen of a tab that showed a hooks question, kept for the check at the end. */
const hooksScreens = [];

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
 * One look at a tab's own first-run screens, by the architect's ruling for the
 * #509 live run: this test answers two of them itself, in its own throwaway
 * tabs, and only when the suite's allowlist matches, by the keys and checks
 * session-clear.test.js uses (the rulings on #391 and #451):
 *
 *   - Claude Code's folder trust, once for a bot folder, only when it is the
 *     plain one for that folder (helpers/screens.js `onlyPlainTrustOf`): down
 *     and return, with no `--enter`; then the trust rows go, or the test fails.
 *   - Claude Code's "Teach auto mode about your environment?" form, at most
 *     once in a tab, only when every row from its title down is the captured
 *     form's (`onlyTeachFormOf`): Esc; then the form goes, and
 *     ~/.claude.json's autoModeEnvSetup stays as it was, or the test fails.
 *
 * Any other question on screen (helpers/screens.js `questionOn`) stops the run
 * at once, with the screen in the failure message; it is never answered. A
 * screen showing a hooks question is kept for the check at the end as well.
 */
async function answerScreens(t, title, handle, home) {
  const rows = rowsOf(handle);
  if (rows === undefined) return;
  if (rows.some((row) => HOOKS_QUESTION.test(row))) hooksScreens.push(`${title}:\n    ${rows.join('\n    ')}`);

  if (rows.some((row) => row.includes('Yes, I trust this folder'))) {
    assert.ok(!answered.trust.has(home), `${title} asked Claude Code's folder trust for ${home} again, which this test answered once and answers no more:\n    ${rows.join('\n    ')}`);
    const wrong = onlyPlainTrustOf(rows, home);
    assert.equal(wrong, undefined, `${title}'s folder trust is not one this test may answer, so it answered nothing: ${wrong}.\n  what it showed:\n    ${rows.join('\n    ')}`);
    const sent = orca(['terminal', 'send', '--terminal', handle, '--text', '\x1b[B\r']);
    assert.equal(sent.ok, true, `answering ${title}'s folder trust failed: ${JSON.stringify(sent.error)}`);
    answered.trust.add(home);
    await until(`${title}'s folder trust to go after it was answered`, 15000, async () => ((rowsOf(handle) ?? []).some((row) => row.includes('Yes, I trust this folder')) ? undefined : true), () => whatIsUp(handle));
    t.diagnostic(`answered ${title}'s plain folder trust (the ruling on #391, option (c))`);
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

/** Wait, `ms` in all, looking at the tab's screens every two seconds. */
async function pause(ms, screen) {
  const stop = Date.now() + ms;
  while (Date.now() < stop) {
    await screen();
    await setTimeout(Math.min(2000, Math.max(0, stop - Date.now())));
  }
}

/** Wait until a tab can be written to: a TUI up, nothing to answer, its start turn over. */
async function readyAndIdle(title, handle, screen, within = READY_MS) {
  await until(`${title} to be past its screens and idle`, within, async () => (idleNow(handle) ? true : undefined), () => whatIsUp(handle), screen);
}

// ------------------------------------------------------------- the records

/** The whole lines of a JSONL file, as JSON; a line being written, or not JSON, is left out. */
function entriesOf(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  return text.split('\n').flatMap((raw) => {
    try {
      return [JSON.parse(raw)];
    } catch {
      return [];
    }
  });
}

/** Every string anywhere under a value. */
function stringsIn(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(stringsIn);
  return [];
}

/** When a record line was written, in ms. */
const atOf = (entry) => Date.parse(entry?.timestamp ?? '');

/** Claude Code's transcript of the conversation `id` that ran in `home` (a realpath). */
const claudeRecordOf = (home, id) => path.join(CLAUDE_PROJECTS, home.replaceAll(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);

/** A Codex conversation's rollout, by its id. */
const codexRecordOf = (id) => rolloutFilesOf(CODEX_SESSIONS, id)[0];

/**
 * The user turns of a record, `{ at, text, index }`: Claude's `type: "user"`
 * lines that are not meta (text, or text blocks), Codex's `response_item`
 * messages with `role: "user"` (`input_text` blocks).
 */
function userTurnsOf(harness, entries) {
  return entries.flatMap((entry, index) => {
    if (harness === 'claude') {
      if (entry?.type !== 'user' || entry.isMeta === true) return [];
      const content = entry.message?.content;
      const text = typeof content === 'string'
        ? content
        : Array.isArray(content) ? content.filter((block) => block?.type === 'text').map((block) => String(block.text)).join('\n') : '';
      return text === '' ? [] : [{ at: atOf(entry), text, index }];
    }
    const item = entry?.type === 'response_item' ? entry.payload : undefined;
    if (item?.type !== 'message' || item.role !== 'user' || !Array.isArray(item.content)) return [];
    const text = item.content.filter((block) => block?.type === 'input_text').map((block) => String(block.text)).join('\n');
    return [{ at: atOf(entry), text, index }];
  });
}

/** The signals for one mail in a record since `since`: Orca's notices for `mailbox`, the kit's lines for `subject`. */
function signalsIn(harness, entries, { since, mailbox, subject }) {
  const turns = userTurnsOf(harness, entries).filter((turn) => turn.at >= since);
  return {
    notices: turns.filter((turn) => turn.text.includes(`orchestration check --run ${mailbox}`)),
    lines: turns.filter((turn) => KIT_LINE.test(turn.text) && turn.text.includes(subject)),
  };
}

/**
 * The kit's Stop hook tellings in a Claude transcript since `since` that name
 * `subject`: lines that are not the assistant's holding "still unread" and the
 * subject, gathered into tellings (lines within 2 s of each other are one
 * telling written down more than once).
 */
function tellingsIn(entries, { since, subject }) {
  const found = entries.filter((entry) => entry?.type !== 'assistant' && atOf(entry) >= since)
    .filter((entry) => stringsIn(entry).some((text) => text.includes('still unread') && text.includes(subject)));
  const tellings = [];
  for (const entry of found) {
    const last = tellings.at(-1);
    if (last !== undefined && atOf(entry) - atOf(last.at(-1)) <= 2000) last.push(entry);
    else tellings.push([entry]);
  }
  return tellings;
}

/** The last lines of a record, short, for a failure message. */
function tailOf(entries, count = 20) {
  return entries.slice(-count).map((entry) => {
    const kind = entry?.type === 'response_item' || entry?.type === 'event_msg' ? `${entry.type}/${entry.payload?.type}` : entry?.type;
    return `${entry?.timestamp ?? '?'} ${kind}: ${stringsIn(entry?.message ?? entry?.payload ?? {}).join(' ').replaceAll('\n', ' ').slice(0, 300)}`;
  }).join('\n  ');
}

/** Codex's turn starts and ends in a rollout: `event_msg`s by their type. */
const isTurnStart = (entry) => entry?.type === 'event_msg' && ['task_started', 'turn_started'].includes(entry.payload?.type);
const isTurnEnd = (entry) => entry?.type === 'event_msg' && ['task_complete', 'turn_complete', 'turn_aborted'].includes(entry.payload?.type);

/** The newest name session_index.jsonl gives thread `id`, or undefined when it gives none. */
function threadNameOf(id) {
  let text;
  try {
    text = readFileSync(SESSION_INDEX, 'utf8');
  } catch {
    return undefined;
  }
  return text.split('\n').flatMap((line) => {
    try {
      const entry = JSON.parse(line);
      return entry?.id === id ? [entry.thread_name] : [];
    } catch {
      return [];
    }
  }).at(-1);
}

/**
 * Whether the record shows the last turn over. Claude: its last `user` or
 * `assistant` line is the assistant's, with no tool call left open. Codex: a
 * turn's end comes after its last turn start.
 */
function turnOverIn(harness, entries) {
  if (harness === 'codex') return entries.findLastIndex(isTurnEnd) > entries.findLastIndex(isTurnStart);
  const last = entries.findLast((entry) => entry?.type === 'user' || entry?.type === 'assistant');
  if (last?.type !== 'assistant') return false;
  const content = last.message?.content;
  return !(Array.isArray(content) && content.some((block) => block?.type === 'tool_use'));
}

/** The record's size and last write, to tell whether it is still being written. */
function stampOf(file) {
  try {
    const found = statSync(file);
    return `${found.size}:${found.mtimeMs}`;
  } catch {
    return 'none';
  }
}

/**
 * Wait until a receiver is at rest, so mail sent now finds it idle (the
 * second live run: the first mail came while an idle Claude was still ending
 * its first turn, its stop hooks running, and while an idle Codex had the
 * kit's naming hook, #480, typing `/rename` into it). At rest is all of these
 * together, held for SETTLE_MS with the record not growing:
 *
 *   - the record shows the last turn over (`turnOverIn`);
 *   - Orca's tui-idle answers ok, with nothing to answer on screen;
 *   - on Codex, the kit's naming is done: session_index.jsonl names the thread
 *     `<bot>.<session>`, and its input line holds no `/rename`.
 */
async function atRest(session) {
  let settledSince;
  let stamp;
  let state = {};
  await until(`${session.title} to be at rest`, ANSWER_MS, async () => {
    const now = stampOf(session.recordOf());
    state = {
      turnOver: turnOverIn(session.harness, entriesOf(session.recordOf())),
      idle: idleNow(session.handle),
      ...(session.harness === 'codex' ? {
        named: threadNameOf(session.id) === session.name,
        inputClear: !/\/rename/.test(codexInputOf(rowsOf(session.handle) ?? [])),
      } : {}),
      recordStill: now === stamp,
    };
    stamp = now;
    if (!Object.values(state).every(Boolean)) {
      settledSince = undefined;
      return undefined;
    }
    settledSince ??= Date.now();
    return Date.now() - settledSince >= SETTLE_MS ? true : undefined;
  }, () => ` What was not so at the last look: ${JSON.stringify(state)}.\n  the record's tail:\n  ${tailOf(entriesOf(session.recordOf()))}${whatIsUp(session.handle)}`, session.screen);
}

// ------------------------------------------------------------- the screens

/** Claude's input box: the rows between its last two rules. */
function claudeInputOf(rows) {
  const rules = rows.flatMap((row, at) => (/^─{8,}/.test(row.trim()) ? [at] : []));
  if (rules.length < 2) return rows.slice(-4).join('\n');
  return rows.slice(rules.at(-2) + 1, rules.at(-1)).join('\n');
}

/** Codex's input line: its lowest row that starts with `›`, and the rows wrapped under it. */
function codexInputOf(rows) {
  const at = rows.findLastIndex((row) => row.startsWith('›'));
  return at === -1 ? '' : rows.slice(at, at + 3).join('\n');
}

// ------------------------------------------------------------- the fleet

/** How a bot here starts the kit: by the variable its launch line set, this checkout's CLI (#220). */
const KIT = '"$OBK_CLI"';

const CLAUDE = 'mail-claude';
const CODEX = 'mail-codex';

/** The file a session's shell writes its mail check to, and its loop's file. */
const mailFileOf = (home, session) => path.join(home, `mail-${session}.txt`);
const stepsFileOf = (home, session) => path.join(home, `steps-${session}.txt`);

/** A shell loop of LOOP_STEPS seconds that writes a numbered line and the time to `file` each second. */
const loop = (file) => `for i in $(seq 1 ${LOOP_STEPS}); do sleep 1; printf 'STEP-%02d %s\\n' "$i" "$(date +%s)" >> ${file}; done`;

/** What every bot here is told first. */
const aBotOf = (bots) => [
  'You are a system test\'s bot and you own nothing.',
  `Your bots folder is ${bots}.`,
  'Do nothing that is not written here: read no file, and run no command but the ones below.',
];

/** How a session reads its mail: the kit's check, its shell writing the time and the answer to its file. */
const readsItsMail = (bots, bot, session, home) => [
  'Whenever anything tells you that you have fleet mail or orchestration messages, new or not yet read,',
  'do not run the command it names. Run exactly this command instead, and then say nothing else:',
  `{ date +%s; ${KIT} message check --bots ${bots} --bot ${bot} --session ${session} --json; } >> ${mailFileOf(home, session)}`,
  'The files these commands write in your folder are the only thing you write.',
];

/** Each session's whole part, in its start prompt. Nothing here types at a bot. */
function promptOf(bots, bot, session) {
  const home = path.join(bots, 'bots', bot);
  if (session === 'quiet') {
    return [...aBotOf(bots), 'Write nothing.', 'If anything tells you that you have mail or messages, ignore it: run no command and say nothing.', 'Say nothing now and wait.'].join(' ');
  }
  const reads = readsItsMail(bots, bot, session, home);
  if (session === 'busy') {
    return [
      ...aBotOf(bots), ...reads,
      'As soon as you are running, run exactly this command, once, in the foreground, and wait for it to finish:',
      loop(stepsFileOf(home, session)),
      'Then say nothing else and wait.',
    ].join(' ');
  }
  return [...aBotOf(bots), ...reads, 'Say nothing now and wait.'].join(' ');
}

/** Send one mail, the kit's own way, and read its answer. */
function send(bots, { to, from, subject, word }) {
  const answer = obkJson([
    'message', 'send', '--bots', bots, '--to', to, '--from', from,
    '--subject', subject, '--text', `${word} — nothing to do, just read this.`,
  ]);
  assert.equal(answer.sent, true, `the premise: the mail to ${to} is queued: ${JSON.stringify(answer)}`);
  return answer;
}

/** What a session's shell wrote of its mail checks: the first time, and the whole text. */
async function mailReadIn(file) {
  const text = await readFile(file, 'utf8').catch(() => '');
  const first = /^(\d+)$/m.exec(text);
  return { text, at: first === null ? undefined : Number(first[1]) * 1000 };
}

/** The loop's last line and its time, in ms, or undefined while it runs. */
async function loopEndIn(file) {
  const found = new RegExp(`${LAST_STEP} (\\d+)`).exec(await readFile(file, 'utf8').catch(() => ''));
  return found === null ? undefined : Number(found[1]) * 1000;
}

/**
 * Run cases side by side and wait for every one, so each reports what it saw,
 * and answer every failure there was, by its case. A failure does not stop the
 * run: the architect's ruling after the first live run, where case 4 failing
 * stopped cases 2, 3, 5 and 6 from running at all. The test fails at its end,
 * with every case's failure together.
 */
async function together(t, cases) {
  const settled = await Promise.allSettled(Object.values(cases).map((one) => one()));
  const failed = settled.flatMap((one, at) => (one.status === 'rejected' ? [`${Object.keys(cases)[at]}: ${one.reason?.message ?? one.reason}`] : []));
  for (const line of failed) t.diagnostic(`FAILED ${line}`);
  return failed;
}

// ------------------------------------------------------------- the cases

/**
 * Cases 1 and 4: one mail to an idle session, and exactly one signal for it in
 * its record, of the kind the send said, watched LATE_MS after the signal.
 */
async function idleCase(t, { bots, title, harness, handle, recordOf, mailbox, mailFile, screen, rest, to, from, subject, word }) {
  await rest();
  const since = Date.now() - 1000;
  const answer = send(bots, { to, from, subject, word });
  const { signal, because, nudged, nudgeUnseen, nudgeTrouble, blocked, watchedMs } = answer;
  t.diagnostic(`${title}: the send said ${JSON.stringify({ signal, because, nudged, watchedMs, nudgeUnseen, nudgeTrouble, blocked })}`);
  assert.ok(signal === 'orca' || (signal === 'line' && because === 'no-turn'), `${title}: an idle receiver gets Orca's notice or the kit's line after the watch, got: ${JSON.stringify(answer)}.${whatIsUp(handle)}`);

  const record = () => entriesOf(recordOf());
  const seen = await until(`${title}'s record to show the ${signal === 'orca' ? 'Orca notice' : 'kit line'}`, RECORD_MS, async () => {
    const found = signalsIn(harness, record(), { since, mailbox, subject });
    const mine = signal === 'orca' ? found.notices : found.lines;
    return mine.length > 0 ? mine[0] : undefined;
  }, () => `\n  the record's tail:\n  ${tailOf(record())}${whatIsUp(handle)}`, screen);

  const read = await until(`${title} to read its mail`, ANSWER_MS, async () => {
    const found = await mailReadIn(mailFile);
    return found.text.includes(word) ? found : undefined;
  }, () => `\n  the record's tail:\n  ${tailOf(record())}${whatIsUp(handle)}`, screen);
  t.diagnostic(`${title}: the ${signal} signal showed ${Math.round((seen.at - since) / 1000)} s after the send; the mail was read ${Math.round((read.at - since) / 1000)} s after it`);

  await pause(seen.at + LATE_MS - Date.now(), screen);
  const found = signalsIn(harness, record(), { since, mailbox, subject });
  assert.deepEqual(
    { notices: found.notices.length, lines: found.lines.length },
    signal === 'orca' ? { notices: 1, lines: 0 } : { notices: 0, lines: 1 },
    `${title}: exactly one signal for the mail, the one the send said (${signal}), in the ${LATE_MS / 1000} s after it.\n  the record's tail:\n  ${tailOf(record())}`,
  );
  if (harness === 'claude') {
    assert.deepEqual(tellingsIn(record(), { since, subject }), [], `${title}: and no turn-end reminder for mail it had been told of and read.\n  ${tailOf(record())}`);
  }
}

/** Cases 2 and 3: two mails to a busy Claude session, the hook's one reason for both, and both read after the work. */
async function busyClaudeCase(t, { bots, title, handle, recordOf, stepsFile, mailFile, screen, mails }) {
  const steps = async () => readFile(stepsFile, 'utf8').catch(() => '');
  await until(`${title} to be part way through its loop`, READY_MS, async () => ((await steps()).includes(PART_WAY) ? true : undefined), () => whatIsUp(handle), screen);
  const since = Date.now() - 1000;
  for (const mail of mails) {
    const answer = send(bots, mail);
    t.diagnostic(`${title}: the send of "${mail.subject}" said ${JSON.stringify({ signal: answer.signal, because: answer.because, nudged: answer.nudged, nudgeTrouble: answer.nudgeTrouble })}`);
    assert.equal(answer.signal, 'hook', `${title}: a busy Claude Code is told by its hook, got: ${JSON.stringify(answer)}.${whatIsUp(handle)}`);
    assert.equal(answer.because, 'busy', `${title}: because it is busy, got: ${JSON.stringify(answer)}`);
    assert.equal(answer.nudged, false, `${title}: nothing typed, got: ${JSON.stringify(answer)}`);
  }
  assert.ok(!(await steps()).includes(LAST_STEP), `${title}: the loop ended before the mails went, so nothing here is about a busy receiver: ${stepsFile} holds ${JSON.stringify(await steps())}`);

  // While the loop runs, nothing like the kit's line is on its screen.
  let ended;
  while ((ended = await loopEndIn(stepsFile)) === undefined) {
    await screen();
    const rows = rowsOf(handle) ?? [];
    assert.ok(!rows.some((row) => KIT_LINE.test(row)), `${title}: a kit line is on the screen while it is busy:\n  ${rows.join('\n  ')}`);
    await setTimeout(2000);
  }

  // From the turn end on, how the hook's text is drawn: Claude Code 2.1.296
  // draws a Stop hook's context as "Stop hook feedback: …" and a block as
  // "Stop hook error: …" (the architect's ruling). A row (or the row after it)
  // that names the hook's fleet mail under "Stop hook error" fails the case.
  const drawn = { feedback: false, error: [] };
  const looks = async () => {
    await screen();
    const rows = rowsOf(handle) ?? [];
    rows.forEach((row, at) => {
      const near = `${row} ${rows[at + 1] ?? ''}`;
      if (row.includes('Stop hook feedback')) drawn.feedback = true;
      if (row.includes('Stop hook error') && /fleet mail/i.test(near)) drawn.error.push(near.trim());
    });
  };
  const record = () => entriesOf(recordOf());
  const read = await until(`${title} to read both mails after its turn end`, ANSWER_MS, async () => {
    const found = await mailReadIn(mailFile);
    return mails.every((mail) => found.text.includes(mail.word)) ? found : undefined;
  }, () => `\n  the record's tail:\n  ${tailOf(record())}${whatIsUp(handle)}`, looks);
  assert.ok(read.at > ended, `${title}: the mail was read after the loop's last line (${new Date(ended).toISOString()}), not during it: read at ${new Date(read.at).toISOString()}`);

  const [first, second] = mails.map((mail) => tellingsIn(record(), { since, subject: mail.subject }));
  assert.equal(first.length, 1, `${title}: the hook told of "${mails[0].subject}" once, got ${first.length}.\n  ${tailOf(record())}`);
  assert.equal(second.length, 1, `${title}: the hook told of "${mails[1].subject}" once, got ${second.length}.\n  ${tailOf(record())}`);
  assert.equal(atOf(first[0][0]), atOf(second[0][0]), `${title}: one reason names both mails.\n  ${tailOf(record())}`);
  assert.ok(atOf(first[0][0]) >= ended - 1000, `${title}: the reason came at the turn end, after the loop.\n  ${tailOf(record())}`);
  for (const mail of mails) {
    const found = signalsIn('claude', record(), { since, mailbox: mail.mailbox, subject: mail.subject });
    assert.deepEqual(found.lines, [], `${title}: no kit line for "${mail.subject}" in its record.\n  ${tailOf(record())}`);
    if (found.notices.length > 0) t.diagnostic(`${title}: Orca typed its own notice for its mailbox ${found.notices.length} time(s) after the send (out of scope, observed)`);
  }

  await until(`${title} to be idle after reading`, ANSWER_MS, async () => (idleNow(handle) ? true : undefined), () => whatIsUp(handle), looks);
  await looks();
  t.diagnostic(`${title}: the screen ${drawn.feedback ? 'showed' : 'did not show'} "Stop hook feedback" after the turn end`);
  assert.deepEqual(drawn.error, [], `${title}: the hook's fleet mail text was drawn as "Stop hook error" in the owner's tab; it must be Stop hook context, drawn as feedback:\n  ${drawn.error.join('\n  ')}`);
  const input = claudeInputOf(rowsOf(handle) ?? []);
  assert.ok(!KIT_LINE.test(input) && !input.includes('orchestration check'), `${title}: its input box holds no line for the mail:\n  ${input}`);
}

/** Case 5: a mail to a busy Codex session, taken into the running turn as a steer, read there, and no Orca notice after. */
async function busyCodexCase(t, { bots, title, handle, recordOf, stepsFile, mailFile, screen, mail }) {
  const steps = async () => readFile(stepsFile, 'utf8').catch(() => '');
  await until(`${title} to be part way through its loop`, READY_MS, async () => ((await steps()).includes(PART_WAY) ? true : undefined), () => whatIsUp(handle), screen);
  const since = Date.now() - 1000;
  const answer = send(bots, mail);
  t.diagnostic(`${title}: the send said ${JSON.stringify({ signal: answer.signal, because: answer.because, nudged: answer.nudged, nudgeUnseen: answer.nudgeUnseen, nudgeTrouble: answer.nudgeTrouble })}`);
  assert.equal(answer.signal, 'line', `${title}: a busy Codex gets the kit's line, got: ${JSON.stringify(answer)}.${whatIsUp(handle)}`);
  assert.equal(answer.because, 'busy', `${title}: because it is busy, got: ${JSON.stringify(answer)}. (On Codex 0.157.1 Orca's tui-idle read a Codex waiting on a shell command as idle: messaging.test.js.)`);
  assert.ok(!(await steps()).includes(LAST_STEP), `${title}: the loop ended before the mail went: ${stepsFile} holds ${JSON.stringify(await steps())}`);

  const record = () => entriesOf(recordOf());
  const line = await until(`${title}'s rollout to show the kit's line`, RECORD_MS, async () => signalsIn('codex', record(), { since, mailbox: mail.mailbox, subject: mail.subject }).lines[0], () => `\n  ${tailOf(record())}`, screen);
  const ended = await until(`${title}'s loop to end`, ANSWER_MS, () => loopEndIn(stepsFile), () => whatIsUp(handle), screen);
  assert.ok(line.at < ended, `${title}: the line went in while the loop ran: line at ${new Date(line.at).toISOString()}, loop ended ${new Date(ended).toISOString()}`);

  const entries = record();
  const loopAt = entries.findIndex((entry) => entry?.type === 'response_item' && entry.payload?.type !== 'message' && stringsIn(entry.payload).some((text) => text.includes(stepsFile)));
  assert.ok(loopAt !== -1 && loopAt < line.index, `${title}: the loop's call is in the rollout before the line.\n  ${tailOf(entries)}`);
  const startsBetween = entries.slice(loopAt + 1, line.index + 1).filter(isTurnStart);
  assert.deepEqual(startsBetween.map((entry) => entry.timestamp), [], `${title}: no turn started between the loop's call and the line: it went into the running turn.\n  ${tailOf(entries)}`);

  const read = await until(`${title} to read its mail`, ANSWER_MS, async () => {
    const found = await mailReadIn(mailFile);
    return found.text.includes(mail.word) ? found : undefined;
  }, () => `\n  ${tailOf(record())}${whatIsUp(handle)}`, screen);
  const turnEnd = await until(`${title}'s turn to end`, ANSWER_MS, async () => record().slice(line.index).find(isTurnEnd), () => `\n  ${tailOf(record())}${whatIsUp(handle)}`, screen);
  assert.ok(read.at <= atOf(turnEnd) + 1000, `${title}: it read the mail in that turn: read at ${new Date(read.at).toISOString()}, the turn ended ${turnEnd.timestamp}`);
  t.diagnostic(`${title}: the line went in ${Math.round((line.at - since) / 1000)} s after the send; the turn ended ${turnEnd.timestamp}`);

  await pause(atOf(turnEnd) + LATE_MS - Date.now(), screen);
  const found = signalsIn('codex', record(), { since, mailbox: mail.mailbox, subject: mail.subject });
  assert.deepEqual({ notices: found.notices.length, lines: found.lines.length }, { notices: 0, lines: 1 }, `${title}: the kit's one line, and no Orca notice for mail already read, ${LATE_MS / 1000} s after the turn ended.\n  ${tailOf(record())}`);
  const input = codexInputOf(rowsOf(handle) ?? []);
  assert.ok(!KIT_LINE.test(input), `${title}: its input line holds no kit line:\n  ${input}`);
}

/**
 * Case 7: a mail to a Codex session while the kit's naming hook holds its
 * typing turn. Observed, and failed only when no signal reached it at all.
 */
async function namedCase(t, { bots, bringUp }) {
  const named = await bringUp(CODEX, 'named', { wait: false });
  const title = named.title;

  // The naming begins once the first turn ends: `/rename` on the screen, in
  // the input line or in the slash popup over it (Orca's screen read can show
  // the input line as a bare `›` while that popup is open, helpers/screens.js).
  let begun;
  const stop = Date.now() + READY_MS;
  while (Date.now() < stop) {
    const rows = rowsOf(named.handle) ?? [];
    if (rows.some((row) => row.includes('/rename'))) {
      begun = 'the screen shows /rename';
      break;
    }
    if (threadNameOf(named.id) === named.name) {
      begun = 'the naming was over before the test saw it begin (session_index.jsonl names the thread): the mail goes all the same';
      break;
    }
    await setTimeout(300);
  }
  assert.ok(begun !== undefined, `${title}: the kit's naming did not begin within ${READY_MS / 1000} s of its start.${whatIsUp(named.handle)}`);
  t.diagnostic(`${title}: ${begun}; input line: ${JSON.stringify(codexInputOf(rowsOf(named.handle) ?? []))}`);

  const mail = { to: `${CODEX}/named`, from: `${CLAUDE}/idle`, subject: 'the dunlin report', word: 'DUNLIN-8847' };
  const since = Date.now() - 1000;
  const answer = send(bots, mail);
  const { signal, because, nudged, nudgeUnseen, nudgeTrouble, blocked, watchedMs } = answer;
  t.diagnostic(`${title}: the send said ${JSON.stringify({ signal, because, nudged, watchedMs, nudgeUnseen, nudgeTrouble, blocked })}`);
  t.diagnostic(`${title}: the send ${String(nudgeTrouble).includes('the kit is typing into it') ? 'said' : 'did not say'} "the kit is typing into it", as expected`);

  // Watched up to NAMED_WATCH_MS: any signal for the mail in its rollout, and the read.
  const seen = { notice: null, line: null, read: null };
  const until180 = Date.now() + NAMED_WATCH_MS;
  while (Date.now() < until180) {
    const found = signalsIn('codex', entriesOf(named.recordOf()), { since, mailbox: named.mailbox, subject: mail.subject });
    if (seen.notice === null && found.notices.length > 0) seen.notice = found.notices[0].at;
    if (seen.line === null && found.lines.length > 0) seen.line = found.lines[0].at;
    if (seen.read === null && (await mailReadIn(named.mailFile)).text.includes(mail.word)) seen.read = Date.now();
    if ((seen.notice !== null || seen.line !== null) && seen.read !== null) break;
    await setTimeout(2000);
  }
  const watched = Math.round((Date.now() - since) / 1000);
  const after = (at) => (at === null ? `not seen in the ${watched} s watched` : `${Math.round((at - since) / 1000)} s after the send`);
  const found = signalsIn('codex', entriesOf(named.recordOf()), { since, mailbox: named.mailbox, subject: mail.subject });
  t.diagnostic(`${title}: Orca's notice ${after(seen.notice)} (${found.notices.length} in all); the kit's line ${after(seen.line)} (${found.lines.length} in all); the mail read ${after(seen.read)}`);
  t.diagnostic(`${title}: the thread's name now: ${JSON.stringify(threadNameOf(named.id) ?? null)}`);
  assert.ok(
    seen.notice !== null || seen.line !== null,
    `${title}: no signal for the mail reached it in ${NAMED_WATCH_MS / 1000} s after a send made while the kit's naming held its typing turn: no Orca notice for ${named.mailbox} and no kit line in its rollout. The send said ${JSON.stringify(answer)}.\n  the rollout's tail:\n  ${tailOf(entriesOf(named.recordOf()))}${whatIsUp(named.handle)}`,
  );
}

// ------------------------------------------------------------- the test

test('one signal for each fleet mail: Orca\'s notice or the kit\'s line to an idle receiver, the Stop hook for a busy Claude, a steer for a busy Codex, and retire counts what was not read', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };
  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-one-signal-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', CLAUDE, CODEX].map(homeOf);

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
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
    if (deleted > 0 && !(await reloadWindow())) t.diagnostic(RELOAD_LINE);
    assert.deepEqual(foreign, [], `tabs this test did not create are open at its homes, so it closed only its own and left those projects and ${bots} in place`);
    const parent = path.dirname(bots);
    const mine = path.basename(bots);
    for (const name of (await readdir(parent)).filter((one) => one === mine || one.startsWith(`${mine}.`))) {
      await rm(path.join(parent, name), { recursive: true, force: true });
    }
    const { closedNotOurs, goneElsewhere } = guard.verdict(before.handles);
    assert.deepEqual(closedNotOurs, [], 'this test closed tabs it did not create');
    if (goneElsewhere.length > 0) t.diagnostic(`tabs open before this test and closed elsewhere meanwhile: ${goneElsewhere.join(', ')}`);
    for (const home of homes) assert.deepEqual(await terminalsAfterClosing(home, closed), [], `this test left tabs behind in ${home}`);
    assert.deepEqual(failedDeletes, [], 'projects this test could not remove, left in Orca');
  });

  obkJson(['init', '--bots', bots, '--harness', 'claude']);
  obkJson(['bot', 'create', '--bots', bots, '--name', CLAUDE, '--harness', 'claude', '--charter', 'Mail Claude exists for one system test run and owns nothing.']);
  obkJson(['bot', 'create', '--bots', bots, '--name', CODEX, '--harness', 'codex', '--charter', 'Mail Codex exists for one system test run and owns nothing.']);
  for (const session of ['idle', 'quiet', 'busy']) obkJson(['session', 'add', '--bots', bots, '--bot', CLAUDE, '--name', session, `--prompt=${promptOf(bots, CLAUDE, session)}`]);
  for (const session of ['idle', 'busy', 'named']) obkJson(['session', 'add', '--bots', bots, '--bot', CODEX, '--name', session, `--prompt=${promptOf(bots, CODEX, session)}`, ...codexTrustArgs(bots)]);

  /** One session up, idle once its start turn is over, and its conversation and mailbox in the book. */
  const sessions = {};
  const bringUp = async (bot, session, { wait = true } = {}) => {
    const entry = tabOf(obkJson(['up', '--bots', bots, '--bot', bot, '--session', session]), session);
    assert.equal(entry.created, true, `the premise: up opened ${entry.title}`);
    const title = entry.title;
    const screen = () => answerScreens(t, title, entry.terminal, homeOf(bot));
    if (wait) await readyAndIdle(title, entry.terminal, screen);
    const held = await until(`the book to hold ${title}'s conversation`, READY_MS, async () => {
      const found = await sessionIn(homeOf(bot), session);
      return typeof found.session === 'string' && typeof found.mailbox === 'string' ? found : undefined;
    }, () => whatIsUp(entry.terminal), screen);
    const harness = bot === CLAUDE ? 'claude' : 'codex';
    sessions[`${bot}/${session}`] = {
      title,
      name: `${bot}.${session}`,
      id: held.session,
      harness,
      handle: entry.terminal,
      screen,
      mailbox: held.mailbox,
      recordOf: () => (harness === 'claude' ? claudeRecordOf(homeOf(bot), held.session) : codexRecordOf(held.session) ?? '/nowhere'),
      mailFile: mailFileOf(homeOf(bot), session),
      stepsFile: stepsFileOf(homeOf(bot), session),
    };
    sessions[`${bot}/${session}`].rest = () => atRest(sessions[`${bot}/${session}`]);
    return sessions[`${bot}/${session}`];
  };

  // The two senders, which every case needs: a failure here ends the run.
  await bringUp(CODEX, 'idle');
  await bringUp(CLAUDE, 'idle');

  // Every case runs, whatever an earlier one did; each failure is kept, and
  // all of them are reported together at the end.
  const failures = [];

  // 1, 4 and 7, side by side.
  const idleClaude = sessions[`${CLAUDE}/idle`];
  const idleCodex = sessions[`${CODEX}/idle`];
  failures.push(...await together(t, {
    'case 1, idle Claude': () => idleCase(t, {
      bots, ...idleClaude, to: `${CLAUDE}/idle`, from: `${CODEX}/idle`, subject: 'the heron report', word: 'HERON-6120',
    }),
    'case 4, idle Codex': () => idleCase(t, {
      bots, ...idleCodex, to: `${CODEX}/idle`, from: `${CLAUDE}/idle`, subject: 'the kestrel report', word: 'KESTREL-3381',
    }),
    'case 7, naming holds the turn': () => namedCase(t, { bots, bringUp }),
  }));

  // 6: mail the quiet session is told to ignore, and a retire at once.
  failures.push(...await together(t, {
    'case 6, retire': async () => {
      const quiet = await bringUp(CLAUDE, 'quiet');
      const toQuiet = send(bots, { to: `${CLAUDE}/quiet`, from: `${CODEX}/idle`, subject: 'the plover report', word: 'PLOVER-5512' });
      t.diagnostic(`${quiet.title}: the send said ${JSON.stringify({ signal: toQuiet.signal, because: toQuiet.because, nudged: toQuiet.nudged })}`);
      const retired = obkJson(['retire', '--bots', bots, '--bot', CLAUDE, '--session', 'quiet']);
      guard.closedByKit(retired.closed);
      assert.deepEqual(
        { count: retired.unread?.count, from: retired.unread?.from },
        { count: 1, from: [`${CODEX}/idle`] },
        `${quiet.title}: the retire says one message was not read with obk message check, and who sent it: ${JSON.stringify(retired)}`,
      );
    },
  }));

  // 2, 3 and 5, side by side: each busy session comes up in its own case, now,
  // so its loop starts now.
  failures.push(...await together(t, {
    'cases 2 and 3, busy Claude': async () => {
      const busyClaude = await bringUp(CLAUDE, 'busy', { wait: false });
      await busyClaudeCase(t, {
        bots,
        ...busyClaude,
        mails: [
          { to: `${CLAUDE}/busy`, from: `${CODEX}/idle`, subject: 'the osprey report', word: 'OSPREY-7745', mailbox: busyClaude.mailbox },
          { to: `${CLAUDE}/busy`, from: `${CODEX}/idle`, subject: 'the curlew report', word: 'CURLEW-2209', mailbox: busyClaude.mailbox },
        ],
      });
    },
    'case 5, busy Codex': async () => {
      const busyCodex = await bringUp(CODEX, 'busy', { wait: false });
      await busyCodexCase(t, {
        bots,
        ...busyCodex,
        mail: { to: `${CODEX}/busy`, from: `${CLAUDE}/idle`, subject: 'the avocet report', word: 'AVOCET-4038', mailbox: busyCodex.mailbox },
      });
    },
  }));

  // And no tab here showed a hooks question of its harness's own at its start.
  if (hooksScreens.length > 0) failures.push(`hooks question: a tab showed a hooks question; the kit's new Stop hook must bring up none:\n${hooksScreens.join('\n\n')}`);

  assert.deepEqual(failures, [], `${failures.length} of the checks failed; every case ran:\n\n${failures.join('\n\n')}`);
});
