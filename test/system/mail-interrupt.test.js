// A system test, and the live check for #555: fleet mail has one road and one
// signal, and `obk message send --interrupt` ends a busy receiver's turn so
// that Orca's own doorbell comes at once. It runs against the real Claude Code
// and Codex in the real Orca on this machine. Run it alone with
// `npm run test:system -- --yes test/system/mail-interrupt.test.js`;
// `npm test` cannot, and no CI machine could.
//
// The rule under test (#555): `obk message send` puts the letter in the
// receiver's Orca mailbox and types nothing into any tab. Orca's doorbell
// tells the receiver when it is idle. With `--interrupt`, the kit first sends
// one Escape into a busy receiver's tab, and the doorbell then comes at once
// (the probe of 2026-10-11: about 1 s after the Escape on Claude Code, about
// 2 s on Codex).
//
// Two busy receivers, one on each harness, side by side: `mail-claude/busy`
// and `mail-codex/busy`. Each runs a shell loop of LOOP_STEPS seconds, which
// its start prompt gives it. Part way through the loop, each gets two letters:
//
//   1. WITHOUT --interrupt. The send says it went by the Orca mailbox. For
//      QUIET_MS after it, while the loop runs: no user turn is written in the
//      receiver's record (no kit line, and no Orca notice, since it is busy),
//      the letter is not read, and the loop goes on. So the letter waits in
//      the mailbox, and nothing was typed.
//   2. WITH --interrupt. The send says it went. On Codex its output names
//      the background terminal Codex keeps a running command as. Within
//      NOTICE_MS of the send, Orca's notice for the receiver's mailbox lands
//      in its record as a user turn, well before the loop would have ended by
//      itself: the busy turn was ended. On Codex the rollout also shows a turn
//      end between the send and the notice. Then the receiver reads both
//      letters with `obk message check`.
//
// What is ASSERTED is judged from the receiver's own record of its turns (the
// Claude transcript `~/.claude/projects/<slug>/<id>.jsonl`, the Codex rollout
// `~/.codex/sessions/…/rollout-…-<id>.jsonl`, found by the conversation id the
// book holds), read only, and from the files the receiver's own shell writes
// in its bot folder: its loop's steps and its mail checks.
//
// What is OBSERVED, NOT JUDGED (printed as diagnostics): every send's output;
// how long after the Escape the notice came; whether Codex's loop went on in
// a background terminal after the Escape.
//
// The senders: `mail-codex/idle` writes to the Claude receiver and
// `mail-claude/idle` to the Codex one, so every letter takes the Orca road:
// Claude to Claude in one approval class goes by Claude's own messaging.
//
// Every word a check waits for is one its tab was never told: each letter's
// subject and body word are in no start prompt. Each bot reads its mail with
// the kit's own check, its shell writing the time and the answer to a file in
// its own folder.
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
//     lines, the kit's Escape for --interrupt, Orca's own notices, and the
//     test's answers below, in its own Claude tabs;
//   - closes only its own tabs, through the tab guard, then deletes its own
//     workspaces, whatever happened;
//   - signals no process.
//
// `orca terminal close --worktree … --all` is never run here, and the helper
// refuses to run it at all. The runner (scripts/test-system.js) keeps and puts
// back ~/.claude.json and ~/.codex/config.toml.
//
// **Nobody answers anything by hand.** The test answers two first-run screens
// itself, in its own throwaway Claude tabs, by the suite's allowlists:
//
//   - Claude Code's folder trust, once, for `mail-claude`'s folder, only when
//     it is the plain one for that folder (helpers/screens.js
//     `onlyPlainTrustOf`): down and return.
//   - "Teach auto mode about your environment?", at most once in a tab, only
//     when it is the captured form (`onlyTeachFormOf`): Esc, then the form
//     gone and ~/.claude.json's autoModeEnvSetup as it was.
//
// Every other question on a tab's screen (`questionOn`) stops the run at once,
// with the screen in the failure message, and is never answered. The Codex
// tabs are given their trust at launch and should ask nothing.
//
// It takes about ten minutes: four sessions, two busy cases side by side.

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
import { rolloutFilesOf } from '../helpers/codex-rollout.js';
import { onlyPlainTrustOf, onlyTeachFormOf, questionOn, waitingOn } from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { deleteOwnProject } from '../helpers/own-project.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/** The Orca CLI that works for a normal user (tech notes, section 1). */
const ORCA = process.env.OBK_ORCA || '/Applications/Orca.app/Contents/Resources/bin/orca';

/** How long a tab is given to get past its own screens and be idle. */
const READY_MS = 180000;

/** How long a bot is given to do something: read its mail. */
const ANSWER_MS = 240000;

/** How long after a letter without --interrupt the busy receiver is watched for anything typed. */
const QUIET_MS = 30000;

/** How long after a letter with --interrupt Orca's notice is given to land in the record. */
const NOTICE_MS = 90000;

/**
 * The busy loop: this many lines, one a second. Long enough that the interrupt
 * comes well inside it, and short of the 120 s Claude Code's Bash tool gives
 * a command by default.
 */
const LOOP_STEPS = 100;
const PART_WAY = 'STEP-05';

/** Claude Code's and Codex's own records (tech notes, sections 2 and 3): read only. */
const CLAUDE_PROJECTS = path.join(os.homedir(), '.claude', 'projects');
const CODEX_SESSIONS = path.join(os.homedir(), '.codex', 'sessions');

/** The start of the kit's old typed line (#509), which #555 removed. */
const KIT_LINE = /Fleet mail from [^\s:]+: /;

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
 * One look at a tab's own first-run screens: this test answers two of them
 * itself, in its own throwaway tabs, and only when the suite's allowlist
 * matches (helpers/screens.js `onlyPlainTrustOf`, `onlyTeachFormOf`). Any
 * other question on screen (`questionOn`) stops the run at once, with the
 * screen in the failure message; it is never answered.
 */
async function answerScreens(t, title, handle, home) {
  const rows = rowsOf(handle);
  if (rows === undefined) return;

  if (rows.some((row) => row.includes('Yes, I trust this folder'))) {
    assert.ok(!answered.trust.has(home), `${title} asked Claude Code's folder trust for ${home} again, which this test answered once and answers no more:\n    ${rows.join('\n    ')}`);
    const wrong = onlyPlainTrustOf(rows, home);
    assert.equal(wrong, undefined, `${title}'s folder trust is not one this test may answer, so it answered nothing: ${wrong}.\n  what it showed:\n    ${rows.join('\n    ')}`);
    const sent = orca(['terminal', 'send', '--terminal', handle, '--text', '\x1b[B\r']);
    assert.equal(sent.ok, true, `answering ${title}'s folder trust failed: ${JSON.stringify(sent.error)}`);
    answered.trust.add(home);
    await until(`${title}'s folder trust to go after it was answered`, 15000, async () => ((rowsOf(handle) ?? []).some((row) => row.includes('Yes, I trust this folder')) ? undefined : true), () => whatIsUp(handle));
    t.diagnostic(`answered ${title}'s plain folder trust`);
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

/** Orca's notices for `mailbox` in a record since `since`. */
const noticesIn = (harness, entries, { since, mailbox }) =>
  userTurnsOf(harness, entries).filter((turn) => turn.at >= since && turn.text.includes(`orchestration check --run ${mailbox}`));

/** The last lines of a record, short, for a failure message. */
function tailOf(entries, count = 20) {
  return entries.slice(-count).map((entry) => {
    const kind = entry?.type === 'response_item' || entry?.type === 'event_msg' ? `${entry.type}/${entry.payload?.type}` : entry?.type;
    return `${entry?.timestamp ?? '?'} ${kind}: ${stringsIn(entry?.message ?? entry?.payload ?? {}).join(' ').replaceAll('\n', ' ').slice(0, 300)}`;
  }).join('\n  ');
}

/** Codex's turn ends in a rollout: `event_msg`s by their type. */
const isTurnEnd = (entry) => entry?.type === 'event_msg' && ['task_complete', 'turn_complete', 'turn_aborted'].includes(entry.payload?.type);

// ------------------------------------------------------------- the fleet

/** How a bot here starts the kit: by the variable its launch line set, this checkout's CLI (#220). */
const KIT = '"$OBK_CLI"';

const CLAUDE = 'mail-claude';
const CODEX = 'mail-codex';

/** The file a session's shell writes its mail checks to, and its loop's file. */
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
  const reads = readsItsMail(bots, bot, session, home);
  if (session === 'busy') {
    return [
      ...aBotOf(bots), ...reads,
      'As soon as you are running, run exactly this command, once, in the foreground, and wait for it to finish:',
      loop(stepsFileOf(home, session)),
      'Never run that command again, whatever happens to it. Then say nothing else and wait.',
    ].join(' ');
  }
  return [...aBotOf(bots), ...reads, 'Say nothing now and wait.'].join(' ');
}

/** Send one letter, the kit's own way, plain, and answer what it printed. */
function send(bots, { to, from, subject, word, interrupt = false }) {
  const done = obk([
    'message', 'send', '--bots', bots, '--to', to, '--from', from,
    '--subject', subject, '--text', `${word} — nothing to do, just read this.`,
    ...(interrupt ? ['--interrupt'] : []),
  ]);
  assert.equal(done.status, 0, `the letter to ${to} went: ${done.stdout}${done.stderr}`);
  assert.match(done.stdout, /orca mailbox/i, `the send to ${to} says it went by the Orca mailbox, got:\n${done.stdout}`);
  return done.stdout;
}

/** What a session's shell wrote of its mail checks: the whole text. */
const mailReadIn = async (file) => readFile(file, 'utf8').catch(() => '');

/** The loop's steps so far: how many lines it wrote. */
async function stepsIn(file) {
  return (await readFile(file, 'utf8').catch(() => '')).split('\n').filter((line) => /^STEP-/.test(line)).length;
}

/**
 * Run cases side by side and wait for every one, so each reports what it saw,
 * and answer every failure there was, by its case.
 */
async function together(t, cases) {
  const settled = await Promise.allSettled(Object.values(cases).map((one) => one()));
  const failed = settled.flatMap((one, at) => (one.status === 'rejected' ? [`${Object.keys(cases)[at]}: ${one.reason?.message ?? one.reason}`] : []));
  for (const line of failed) t.diagnostic(`FAILED ${line}`);
  return failed;
}

// ------------------------------------------------------------- the case

/**
 * One busy receiver: a letter without --interrupt, which waits and types
 * nothing; then one with --interrupt, which ends the busy turn so that Orca's
 * notice comes at once; then both are read.
 */
async function busyCase(t, { bots, title, harness, handle, recordOf, mailbox, stepsFile, mailFile, screen, from, to }) {
  await until(`${title} to be part way through its loop`, READY_MS, async () => ((await readFile(stepsFile, 'utf8').catch(() => '')).includes(PART_WAY) ? true : undefined), () => whatIsUp(handle), screen);
  const loopStarted = Date.now() - 5000;
  const record = () => entriesOf(recordOf());

  // 1. Without --interrupt: the letter waits, and nothing is typed.
  const quiet = { subject: `the ${harness} quiet report`, word: harness === 'claude' ? 'GANNET-5150' : 'BITTERN-6271' };
  const sinceQuiet = Date.now() - 1000;
  const stepsBefore = await stepsIn(stepsFile);
  const quietSaid = send(bots, { to, from, ...quiet });
  t.diagnostic(`${title}: the send without --interrupt said:\n  ${quietSaid.trim().replaceAll('\n', '\n  ')}`);
  const quietEnd = Date.now() + QUIET_MS;
  while (Date.now() < quietEnd) {
    await screen();
    const turns = userTurnsOf(harness, record()).filter((turn) => turn.at >= sinceQuiet);
    assert.deepEqual(turns.map((turn) => turn.text), [], `${title}: nothing typed into the busy receiver after a send without --interrupt: no user turn in its record.\n  ${tailOf(record())}`);
    assert.ok(!(await mailReadIn(mailFile)).includes(quiet.word), `${title}: the letter waits in the mailbox while the receiver is busy; it was read already`);
    const rows = rowsOf(handle) ?? [];
    assert.ok(!rows.some((row) => KIT_LINE.test(row)), `${title}: a kit line is on the screen:\n  ${rows.join('\n  ')}`);
    await setTimeout(2000);
  }
  const stepsAfter = await stepsIn(stepsFile);
  assert.ok(stepsAfter > stepsBefore, `${title}: the loop went on through the send without --interrupt (${stepsBefore} steps, then ${stepsAfter})`);
  assert.ok(stepsAfter < LOOP_STEPS, `${title}: the loop is still running, so the receiver was busy all along (${stepsAfter} of ${LOOP_STEPS} steps)`);

  // 2. With --interrupt: the turn ends, and Orca's notice comes.
  const urgent = { subject: `the ${harness} urgent report`, word: harness === 'claude' ? 'PETREL-7382' : 'SHRIKE-8493' };
  const sinceUrgent = Date.now() - 1000;
  const urgentSaid = send(bots, { to, from, ...urgent, interrupt: true });
  t.diagnostic(`${title}: the send with --interrupt said:\n  ${urgentSaid.trim().replaceAll('\n', '\n  ')}`);
  if (harness === 'codex') {
    assert.match(urgentSaid, /background terminal/i, `${title}: the send names the background terminal Codex keeps a running command as, got:\n${urgentSaid}`);
  }
  const notice = await until(`${title}'s record to show Orca's notice after the interrupt`, NOTICE_MS, async () => noticesIn(harness, record(), { since: sinceUrgent, mailbox })[0], () => `\n  the record's tail:\n  ${tailOf(record())}${whatIsUp(handle)}`, screen);
  t.diagnostic(`${title}: Orca's notice came ${Math.round((notice.at - sinceUrgent) / 1000)} s after the send with --interrupt`);
  const naturalEnd = loopStarted + LOOP_STEPS * 1000;
  assert.ok(notice.at < naturalEnd - 30000, `${title}: the notice came well before the loop would have ended by itself, so the busy turn was ended (notice at ${new Date(notice.at).toISOString()}, the loop's own end about ${new Date(naturalEnd).toISOString()})`);
  if (harness === 'codex') {
    const entries = record();
    const ended = entries.slice(0, notice.index).filter((entry) => isTurnEnd(entry) && atOf(entry) >= sinceUrgent);
    assert.ok(ended.length > 0, `${title}: the rollout shows the busy turn's end between the send with --interrupt and the notice.\n  ${tailOf(entries)}`);
  }

  // 3. Both letters are read, with obk message check.
  await until(`${title} to read both letters`, ANSWER_MS, async () => {
    const text = await mailReadIn(mailFile);
    return text.includes(quiet.word) && text.includes(urgent.word) ? true : undefined;
  }, () => `\n  the record's tail:\n  ${tailOf(record())}${whatIsUp(handle)}`, screen);
  const later = await stepsIn(stepsFile);
  t.diagnostic(`${title}: the loop had written ${later} of ${LOOP_STEPS} steps when both letters were read${harness === 'codex' ? ' (a loop that went on after the Escape is the background terminal)' : ''}`);
}

// ------------------------------------------------------------- the test

test('one road and one signal: a busy receiver gets nothing typed without --interrupt, and --interrupt ends its turn so Orca\'s notice comes', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };
  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-interrupt-')));
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
  for (const session of ['idle', 'busy']) obkJson(['session', 'add', '--bots', bots, '--bot', CLAUDE, '--name', session, `--prompt=${promptOf(bots, CLAUDE, session)}`]);
  for (const session of ['idle', 'busy']) obkJson(['session', 'add', '--bots', bots, '--bot', CODEX, '--name', session, `--prompt=${promptOf(bots, CODEX, session)}`, ...codexTrustArgs(bots)]);

  /** One session up, idle once its start turn is over when `wait`, and its conversation and mailbox in the book. */
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
    return {
      title,
      harness,
      handle: entry.terminal,
      screen,
      mailbox: held.mailbox,
      recordOf: () => (harness === 'claude' ? claudeRecordOf(homeOf(bot), held.session) : codexRecordOf(held.session) ?? '/nowhere'),
      mailFile: mailFileOf(homeOf(bot), session),
      stepsFile: stepsFileOf(homeOf(bot), session),
    };
  };

  // The two senders: a failure here ends the run.
  await bringUp(CODEX, 'idle');
  await bringUp(CLAUDE, 'idle');

  // The two busy receivers, side by side: each comes up in its own case, now,
  // so its loop starts now.
  const failures = await together(t, {
    'busy Claude': async () => {
      const busy = await bringUp(CLAUDE, 'busy', { wait: false });
      await busyCase(t, { bots, ...busy, to: `${CLAUDE}/busy`, from: `${CODEX}/idle` });
    },
    'busy Codex': async () => {
      const busy = await bringUp(CODEX, 'busy', { wait: false });
      await busyCase(t, { bots, ...busy, to: `${CODEX}/busy`, from: `${CLAUDE}/idle` });
    },
  });

  assert.deepEqual(failures, [], `${failures.length} of the cases failed; both ran:\n\n${failures.join('\n\n')}`);
});
