// A system test, and the live check for #634: a Pi session gets fleet mail as
// a Claude Code or Codex session does. It runs against the real Pi, the real
// Codex and the real Orca on this machine. Run it alone with
// `npm run test:system -- --yes test/system/pi-mail.test.js`;
// `npm test` cannot, and no CI machine could.
//
// The rule under test (PRD-16 since #555, and #634): there is one road, the
// Orca mailbox, and one signal, Orca's own notice. `obk message send` puts the
// letter in the Pi session's mailbox, which its launch line's mailbox step
// gave it at `up`, and types nothing into its tab. Orca's notice tells the Pi
// session when it is idle, and it reads its mail with `obk message check`.
// With `--interrupt`, the kit first presses one Escape in a busy Pi tab.
//
// Three cases, on two Pi sessions of one bot, `pi-mail/idle` and
// `pi-mail/busy`, with a Codex sender, `pi-codex/daily`:
//
//   1. An idle Pi receiver. A letter goes into its mailbox. Orca's own notice
//      reaches its tab: a user turn in its Pi session file that names its Run.
//      It reads the letter with `obk message check`, run in its own tab with
//      no --bot. Its shell writes the answer to a file in its own folder,
//      through `tee`, so the answer is also in the Pi's own tool result: the
//      Pi sees the letter's words, which ask it to reply.
//      Then it replies, with `obk message send` and no --from, and the reply
//      reaches the Codex sender, whose own check writes it to its file.
//   2. A busy Pi receiver, running a shell loop of LOOP_STEPS seconds that its
//      start prompt gives it. A letter WITHOUT --interrupt: the send says it
//      went by the Orca mailbox; for QUIET_MS no user turn is written in its
//      Pi session file, the letter is not read, and the loop goes on.
//   3. The same busy receiver, a letter WITH --interrupt: the send says the
//      receiver was busy, so the kit pressed Escape once, and it says nothing
//      of a Codex background terminal (Pi kills a running command at an
//      Escape: read in Pi 1.3.0's code). Orca's notice then lands as a user
//      turn well before the loop would have ended by itself, and the receiver
//      reads both letters.
//
// What is ASSERTED is judged from the Pi session's own record of its turns,
// `~/.pi/agent/sessions/--<folder>--/<timestamp>_<id>.jsonl` (tech notes,
// section 6), found by the id the book holds and read only, and from the files
// the sessions' own shells write in their bot folders: the loop's steps and the
// mail checks.
//
// What is OBSERVED, NOT JUDGED (printed as diagnostics): every send's output;
// whether Orca listed the Pi tab as orphaned at each look; how long after a
// send Orca's notice came, and the reply; how far the loop got after the
// Escape.
//
// **An orphaned tab.** This test opens its bots in a throwaway Orca project,
// and the Orca window may not load it. Orca lists a tab of a project its
// window has not loaded as orphaned (`orphaned: true`, tab id `pty:<ptyId>`),
// and it gives such a tab no notice (tech notes, section 1; #579). A tab counts
// as real only when Orca lists it with `orphaned: false` and a tab id that does
// not start with `pty:`. Before each case the test looks at the Pi tab, and in
// case 1 also at the Codex sender's tab, which gets the reply.
//
// When one of them is not real, the test opens ONE MORE throwaway project in
// its bots folder, made as `obk up` makes a bot's project, with one plain tab
// in it (helpers/newer-project.js). Then it waits up to REAL_MS until those
// tabs are real, and fails plainly if they are not. What was seen live on
// 2026-10-18 (#561, #634): `orca terminal switch --terminal <handle>` answered
// ok, and the tab stayed orphaned, so this test no longer switches. One more
// project with a plain tab made the older tabs real; a tab added to the same
// project did not; the plain tab itself was orphaned again within 30 s. The
// cause is not known.
//
// That step opens a project and a tab in the owner's Orca window, so it runs
// only when both hold (the owner's rule in #561):
//
//   - the local hour is 0 to 5 (between midnight and 6 am), and
//   - the run named this file (the runner's OBK_SYSTEM_NAMED holds its path).
//
// Otherwise it opens nothing and fails, and says why: Orca gives no notice to
// an orphaned tab. A run that does not name this file opens no extra project
// and no extra tab. The extra project's home is in the teardown's homes, so
// the tab guard closes its plain tab and the teardown deletes the project.
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
//     lines, the kit's Escape for --interrupt, and Orca's own notices;
//   - closes only its own tabs, through the tab guard, then deletes its own
//     workspaces, whatever happened;
//   - signals no process.
//
// `orca terminal close --worktree … --all` is never run here, and the helper
// refuses to run it at all. The runner (scripts/test-system.js) backs up
// ~/.claude.json and ~/.codex/config.toml before the run and compares them
// after it.
//
// **Nobody answers anything by hand.** No tab here should ask anything. Pi
// shows no trust screen with the kit's `--no-approve` (tech notes, section 6).
// The Codex sender is given its trust at launch (helpers/codex-trust.js). Bot
// Father's own tab is left as it comes up; nothing is sent to it. So the test
// answers no screen: any question on a tab's screen (`questionOn`), and Pi's
// trust screen by its title, stops the run at once, with the screen in the
// failure message.
//
// The models: Pi on `openai/gpt-6-luna` at thinking `low`, what slice 1's live
// probe used (Pi 1.3.0 is installed now). The Codex sender on Codex's own
// default, as the Codex sessions beside it.
//
// What it cannot clean up, and says so: the Run mailboxes it makes (Orca has
// no `run-delete`), named `obk <bot>/<session>`; Pi's session files under
// ~/.pi/agent/sessions/ for this test's throwaway bot home, which this test
// only reads; Codex's rollouts of its sender; and whatever Orca keeps of its
// own for these tabs (its agent-hooks status). None of them is used again.
//
// It takes about ten minutes: three sessions, a round trip and a busy loop.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry } from '../helpers/cli.js';
import { codexTrustArgs } from '../helpers/codex-trust.js';
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

/** How long a tab is given to come up and be idle. */
const READY_MS = 180000;

/** How long a bot is given to do something: read its mail. */
const ANSWER_MS = 240000;

/**
 * How long Orca's notice is given to reach an idle receiver: it reached an
 * idle Claude Code session about 3.5 min after its turn ended (ADR 0042, the
 * probe of 2026-10-11).
 */
const IDLE_NOTICE_MS = 300000;

/** And how long a reply is given to reach the sender: two turns and a notice between them. */
const ROUND_TRIP_MS = 480000;

/** How long after a letter without --interrupt the busy receiver is watched for anything typed. */
const QUIET_MS = 30000;

/** How long after a letter with --interrupt Orca's notice is given to land in the record. */
const NOTICE_MS = 90000;

/** How long the tabs are given to be listed as real after one more project is opened (#561: about 30 s). */
const REAL_MS = 30000;

/**
 * The busy loop: this many lines, one a second. Long enough that the interrupt
 * comes well inside it.
 */
const LOOP_STEPS = 100;
const PART_WAY = 'STEP-05';

/** Pi's model and thinking level here. */
const PI_MODEL = 'openai/gpt-6-luna';
const PI_THINKING = 'low';

/** Pi's own record of its sessions (tech notes, section 6): read only. */
const PI_SESSIONS = path.join(os.homedir(), '.pi', 'agent', 'sessions');

/** The start of the kit's old typed line (#509), which #555 removed. */
const KIT_LINE = /Fleet mail from [^\s:]+: /;

/** The title of Pi's project-trust screen (tech notes, section 6), which --no-approve should keep away. */
const PI_TRUST_TITLE = 'Trust project folder?';

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
 * look: the tab's screens, stopped at.
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
const realTab = (entry) => entry?.orphaned === false && typeof entry.tabId === 'string' && !entry.tabId.startsWith('pty:');

/** Whether Orca lists the tab as orphaned now, in words. */
function orphanWords(handle) {
  const entry = listed(handle);
  if (entry === undefined) return 'not listed by Orca at all';
  return realTab(entry)
    ? `listed as real (orphaned: false, tab id ${entry.tabId})`
    : `listed as ORPHANED (orphaned: ${entry.orphaned}, tab id ${entry.tabId}): Orca gives an orphaned tab no notice`;
}

/** What the tab is showing, for the message of a wait that ran out, with whether it is orphaned. */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  return `${blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`}\n  The tab ${handle} is ${orphanWords(handle)}.\n  orca terminal read --terminal ${handle} --screen\n    ${(rowsOf(handle) ?? ['(unreadable)']).join('\n    ')}`;
}

/** Whether Orca calls the tab idle right now, with nothing to answer on it. */
function idleNow(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  return answer.ok === true && answer.result?.wait?.satisfied === true && answer.result?.wait?.blockedReason === undefined
    && waitingOn(orca, handle) === undefined;
}

/**
 * One look at a tab's screen. No tab here should ask anything, and this test
 * answers nothing: Pi's trust screen, which its `→` pointer keeps from
 * `questionOn`, or any other question stops the run, with the screen.
 */
function stopAtScreens(title, handle) {
  const rows = rowsOf(handle);
  if (rows === undefined) return;
  assert.ok(!rows.some((row) => row.includes(PI_TRUST_TITLE)), `${title} shows Pi's project-trust screen, which the kit's --no-approve should keep away; this test answers nothing, and the run stops here:\n    ${rows.join('\n    ')}`);
  const question = questionOn(rows);
  assert.equal(question, undefined, `${title} shows a screen this test does not know, and it answers nothing; the run stops here:\n    ${rows.join('\n    ')}`);
}

// ------------------------------------------------------------- an orphaned tab

/** Print whether Orca lists the tab as orphaned now: observed, not judged. */
function lookAtOrphan(t, title, handle, when) {
  t.diagnostic(`${title} (${handle}) ${when}: ${orphanWords(handle)}`);
}

/**
 * Before a case that needs Orca's notice in its tabs: each of `tabs`
 * ({ title, handle }, the Pi tab first) is real, or this test opens one more
 * project, at night in a run that names this file, and each is real within
 * REAL_MS; or the case fails and says why. The extra project's home goes into
 * `homes`, the teardown's list, before it is made.
 */
async function loadedForNotice(t, tabs, why, { bots, homes }) {
  const notReal = [];
  for (const { title, handle } of tabs) {
    const entry = listed(handle);
    assert.ok(entry !== undefined, `${title}: Orca no longer lists its tab ${handle}`);
    t.diagnostic(`${title} (${handle}) before ${why}: ${orphanWords(handle)}`);
    if (!realTab(entry)) notReal.push({ title, handle });
  }
  if (notReal.length === 0) return;

  const names = notReal.map(({ title, handle }) => `${title} (${handle})`).join(', ');
  const now = new Date();
  const night = atNight(now);
  const named = namedThisRun(THIS_FILE);
  if (!(night && named)) {
    t.diagnostic(`opened no extra project for ${names} (night: ${night}, this file named: ${named})`);
    assert.fail([
      `Orca lists these tabs as orphaned before ${why}: ${names}.`,
      'Orca gives no notice to an orphaned tab, so this case cannot pass.',
      'This test opens one more project and one plain tab in the Orca window only in a night run, between midnight and 6 am local time, that names this file:',
      '  npm run test:system -- --yes test/system/pi-mail.test.js',
      `This run is at ${now.toTimeString().slice(0, 5)} local time and ${named ? 'names this file' : 'does not name this file'}, so it opened nothing.`,
    ].join('\n'));
  }

  const count = homes.filter((home) => path.basename(home).startsWith('newer-')).length + 1;
  const home = path.join(bots, 'bots', `newer-${count}`);
  homes.push(home);
  const newer = await openNewerProject(guard, home, `pi-mail newer ${count}`);
  t.diagnostic(`opened one more project at ${home} at ${now.toISOString()} for ${names}: tellWindow ${newer.told ? 'taken' : 'not taken'}, plain tab ${newer.handle}`);
  const stop = Date.now() + REAL_MS;
  let still = notReal.filter(({ handle }) => !realTab(listed(handle)));
  while (still.length > 0 && Date.now() < stop) {
    await setTimeout(500);
    still = notReal.filter(({ handle }) => !realTab(listed(handle)));
  }
  for (const { title, handle } of notReal) t.diagnostic(`${title} (${handle}) after one more project: ${orphanWords(handle)}`);
  t.diagnostic(`the plain tab ${newer.handle}: ${orphanWords(newer.handle)}`);
  assert.deepEqual(
    still.map(({ handle }) => handle),
    [],
    `Orca still lists these tabs as orphaned ${REAL_MS} ms after this test opened one more project at ${home}, so no notice can come: ${still.map(({ title, handle }) => `${title} (${handle})`).join(', ')}`,
  );
}

// ------------------------------------------------------------- Pi's record

/** Pi's session folder for a working folder (tech notes, section 6): its real path, `/`, `\` and `:` as `-`. */
const piFolderOf = (cwd) => path.join(PI_SESSIONS, `--${realpathSync(cwd).replace(/^\//, '').replaceAll(/[/\\:]/g, '-')}--`);

/** The Pi session file of the session `id` that ran in `cwd`, or undefined before Pi has written one. */
function piRecordOf(cwd, id) {
  const folder = piFolderOf(cwd);
  let names = [];
  try {
    names = readdirSync(folder);
  } catch {
    return undefined;
  }
  const found = names.filter((name) => name.endsWith(`_${id}.jsonl`)).sort();
  return found.length === 0 ? undefined : path.join(folder, found.at(-1));
}

/** The whole lines of a JSONL file, as JSON; a line being written, or not JSON, is left out. */
function entriesOf(file) {
  if (file === undefined) return [];
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

/** When a Pi line was written, in ms: the line's own timestamp, or its message's. */
const atOf = (entry) => {
  const at = Date.parse(entry?.timestamp ?? '');
  return Number.isNaN(at) ? Number(entry?.message?.timestamp ?? Number.NaN) : at;
};

/** The text of a Pi message: a string, or its text blocks. */
const textOf = (content) => (typeof content === 'string'
  ? content
  : Array.isArray(content) ? content.filter((block) => block?.type === 'text').map((block) => String(block.text)).join('\n') : '');

/** The turns of one role in a Pi record, `{ at, text, index }`: `message` lines whose message has that role. */
const turnsOf = (entries, role) => entries.flatMap((entry, index) => (
  entry?.type === 'message' && entry.message?.role === role ? [{ at: atOf(entry), text: textOf(entry.message.content), index }] : []
));

/** Orca's notices for `mailbox` in a Pi record since `since`: user turns naming its Run. */
const noticesIn = (entries, { since, mailbox }) => turnsOf(entries, 'user').filter((turn) => turn.at >= since && turn.text.includes(`orchestration check --run ${mailbox}`));

/** The last lines of a record, short, for a failure message. */
function tailOf(entries, count = 20) {
  return entries.slice(-count).map((entry) => `${entry?.timestamp ?? '?'} ${entry?.type}/${entry?.message?.role ?? '-'}: ${textOf(entry?.message?.content).replaceAll('\n', ' ').slice(0, 300)}`).join('\n  ');
}

// ------------------------------------------------------------- the fleet

/** How a bot here starts the kit: by the variable its launch line set, this checkout's CLI (#220). */
const KIT = '"$OBK_CLI"';

const PI = 'pi-mail';
const CODEX = 'pi-codex';

/** The file a session's shell writes its mail checks to, and its loop's file. */
const mailFileOf = (home, session) => path.join(home, `mail-${session}.txt`);
const stepsFileOf = (home, session) => path.join(home, `steps-${session}.txt`);

/**
 * The words each check waits for, each in no prompt of the tab it is waited
 * for in. QUESTION is only in the letter to the idle Pi receiver. PASSPHRASE is
 * only in the idle Pi receiver's own prompt, and reaches the Codex sender only
 * as the reply. QUIET and URGENT are only in the letters to the busy receiver.
 */
const QUESTION = 'OSPREY-2468';
const PASSPHRASE = 'KESTREL-1357';
const QUIET = 'GREBE-3579';
const URGENT = 'AVOCET-4680';

/** A shell loop of LOOP_STEPS seconds that writes a numbered line and the time to `file` each second. */
const loop = (file) => `for i in $(seq 1 ${LOOP_STEPS}); do sleep 1; printf 'STEP-%02d %s\\n' "$i" "$(date +%s)" >> ${file}; done`;

/** What every bot here is told first. */
const aBotOf = (bots) => [
  'You are a system test\'s bot and you own nothing.',
  `Your bots folder is ${bots}.`,
  'Do nothing that is not written here: read no file, and run no command but the ones below.',
];

/**
 * How a session reads its mail: the kit's check, its shell writing the time and
 * the answer to its file. A Pi session runs it in its own tab with no --bot
 * (#634, A5); the Codex sender names itself, as the tests beside it do.
 *
 * Through `tee -a`, not `>>`: the answer goes to the file and to the session's
 * own tool result too. With `>>` alone the Pi's tool result was "(no output)",
 * so it never saw the letter that asked it to reply (live run, 2026-10-19).
 */
const readsItsMail = (bots, bot, session, home) => [
  'Whenever anything tells you that you have fleet mail or orchestration messages, new or not yet read,',
  'do not run the command it names. Run exactly this command instead:',
  bot === PI
    ? `{ date +%s; ${KIT} message check --bots ${bots} --json; } | tee -a ${mailFileOf(home, session)}`
    : `{ date +%s; ${KIT} message check --bots ${bots} --bot ${bot} --session ${session} --json; } | tee -a ${mailFileOf(home, session)}`,
  'Then read what that command printed: it is your mail.',
  'The files these commands write in your folder are the only thing you write.',
];

/** Each session's whole part, in its start prompt. Nothing here types at a bot. */
function promptOf(bots, bot, session) {
  const home = path.join(bots, 'bots', bot);
  const reads = readsItsMail(bots, bot, session, home);
  if (bot === PI && session === 'busy') {
    return [
      ...aBotOf(bots), ...reads,
      'As soon as you are running, run exactly this command, once, in the foreground, and wait for it to finish:',
      loop(stepsFileOf(home, session)),
      'Never run that command again, whatever happens to it. Then say nothing else and wait.',
    ].join(' ');
  }
  if (bot === PI) {
    // The reply goes with no --from: the kit takes the sender from the Pi tab (#634, A4).
    return [
      ...aBotOf(bots), ...reads,
      `When a message you read asks you to reply, reply with your passphrase, which is ${PASSPHRASE}.`,
      `To reply, first run exactly: ${KIT} message to --bots ${bots} --to ${CODEX}/daily`,
      `and then run exactly: ${KIT} message send --bots ${bots} --to ${CODEX}/daily --subject 'the pi reply' --text '${PASSPHRASE}'`,
      'Then say nothing else and wait. Say nothing now and wait.',
    ].join(' ');
  }
  return [...aBotOf(bots), ...reads, 'Say nothing now and wait.'].join(' ');
}

/** Send one letter, the kit's own way, plain, from the Codex sender, and answer what it printed. */
function send(t, bots, { to, subject, text, interrupt = false }) {
  const done = obk([
    'message', 'send', '--bots', bots, '--to', to, '--from', `${CODEX}/daily`,
    '--subject', subject, '--text', text, ...(interrupt ? ['--interrupt'] : []),
  ]);
  t.diagnostic(`the send to ${to}${interrupt ? ' with --interrupt' : ''} said (exit ${done.status}):\n  ${`${done.stdout}${done.stderr}`.trim().replaceAll('\n', '\n  ')}`);
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

// ------------------------------------------------------------- the test

test('a Pi session gets fleet mail: Orca\'s notice in its tab, its own check, a reply; nothing typed while it is busy; --interrupt ends its turn', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };
  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-pi-mail-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', PI, CODEX].map(homeOf);
  t.diagnostic(`this run names this file: ${namedThisRun(THIS_FILE)}; local time ${new Date().toTimeString().slice(0, 5)}`);

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
  obkJson(['bot', 'create', '--bots', bots, '--name', PI, '--harness', 'pi', '--charter', 'Pi Mail exists for one system test run and owns nothing.']);
  obkJson(['bot', 'create', '--bots', bots, '--name', CODEX, '--harness', 'codex', '--charter', 'Pi Codex exists for one system test run and owns nothing.']);
  for (const session of ['idle', 'busy']) {
    obkJson(['session', 'add', '--bots', bots, '--bot', PI, '--name', session, '--model', PI_MODEL, '--effort', PI_THINKING, `--prompt=${promptOf(bots, PI, session)}`]);
  }
  obkJson(['session', 'add', '--bots', bots, '--bot', CODEX, '--name', 'daily', `--prompt=${promptOf(bots, CODEX, 'daily')}`, ...codexTrustArgs(bots)]);

  /** One session up, and its conversation and mailbox in the book. */
  const bringUp = async (bot, session) => {
    const entry = tabOf(obkJson(['up', '--bots', bots, '--bot', bot, '--session', session]), session);
    assert.equal(entry.created, true, `the premise: up opened ${entry.title}`);
    const { title } = entry;
    const handle = entry.terminal;
    const screen = async () => stopAtScreens(title, handle);
    const held = await until(`the book to hold ${title}'s conversation and mailbox`, READY_MS, async () => {
      const found = await sessionIn(homeOf(bot), session);
      return typeof found.session === 'string' && typeof found.mailbox === 'string' ? found : undefined;
    }, () => whatIsUp(handle), screen);
    lookAtOrphan(t, title, handle, 'once it was up');
    return {
      title,
      handle,
      screen,
      mailbox: held.mailbox,
      record: () => entriesOf(piRecordOf(homeOf(bot), held.session)),
      mailFile: mailFileOf(homeOf(bot), session),
      stepsFile: stepsFileOf(homeOf(bot), session),
    };
  };

  // The sender first: the reply in case 1 goes to it.
  const sender = await bringUp(CODEX, 'daily');
  await until(`${sender.title} to be idle`, READY_MS, async () => (idleNow(sender.handle) ? true : undefined), () => whatIsUp(sender.handle), sender.screen);

  // ----------------------------------------------------------- 1. idle
  const idle = await bringUp(PI, 'idle');
  // Its start turn is over: Pi has answered it, and Orca calls the tab idle.
  await until(`${idle.title}'s start turn to be answered and its tab idle`, READY_MS, async () => (
    turnsOf(idle.record(), 'assistant').length > 0 && idleNow(idle.handle) ? true : undefined
  ), () => `\n  its Pi record's tail:\n  ${tailOf(idle.record())}${whatIsUp(idle.handle)}`, idle.screen);

  // The Codex sender's tab too: the reply needs Orca's notice there.
  await loadedForNotice(t, [idle, sender], 'the letter to the idle Pi receiver', { bots, homes });
  const sinceLetter = Date.now() - 1000;
  send(t, bots, { to: `${PI}/idle`, subject: 'the pi system test', text: `${QUESTION}. Please reply to me.` });
  lookAtOrphan(t, idle.title, idle.handle, 'after the letter');

  const notice = await until(`Orca's notice to land in ${idle.title}'s Pi record as a user turn`, IDLE_NOTICE_MS, async () => noticesIn(idle.record(), { since: sinceLetter, mailbox: idle.mailbox })[0], () => `\n  its Pi record's tail:\n  ${tailOf(idle.record())}${whatIsUp(idle.handle)}`, idle.screen);
  t.diagnostic(`${idle.title}: Orca's notice came ${Math.round((notice.at - sinceLetter) / 1000)} s after the letter`);
  const typed = turnsOf(idle.record(), 'user').filter((turn) => turn.at >= sinceLetter && KIT_LINE.test(turn.text));
  assert.deepEqual(typed.map((turn) => turn.text), [], `${idle.title}: no line of the kit's in its record, only Orca's notice`);

  await until(`${idle.title} to read the letter with obk message check`, ANSWER_MS, async () => ((await mailReadIn(idle.mailFile)).includes(QUESTION) ? true : undefined), () => `\n  its Pi record's tail:\n  ${tailOf(idle.record())}${whatIsUp(idle.handle)}`, idle.screen);
  t.diagnostic(`${idle.title}: its check wrote the letter to its file ${Math.round((Date.now() - sinceLetter) / 1000)} s after it was sent`);

  // Looked at again: a wait that runs out says whether it is orphaned now.
  lookAtOrphan(t, sender.title, sender.handle, 'before the reply reaches it');
  await until(`the reply from ${idle.title} to reach ${sender.title}, read with its own check`, ROUND_TRIP_MS, async () => ((await mailReadIn(sender.mailFile)).includes(PASSPHRASE) ? true : undefined), () => `\n  ${idle.title}'s Pi record's tail:\n  ${tailOf(idle.record())}${whatIsUp(sender.handle)}`, sender.screen);
  t.diagnostic(`${sender.title}: read the reply ${Math.round((Date.now() - sinceLetter) / 1000)} s after the first letter was sent`);

  // ----------------------------------------------------------- 2. busy, no --interrupt
  const busy = await bringUp(PI, 'busy');
  await until(`${busy.title} to be part way through its loop`, READY_MS, async () => ((await readFile(busy.stepsFile, 'utf8').catch(() => '')).includes(PART_WAY) ? true : undefined), () => `\n  its Pi record's tail:\n  ${tailOf(busy.record())}${whatIsUp(busy.handle)}`, busy.screen);
  const loopStarted = Date.now() - 5000;

  // Orca holds its notice for a busy receiver, so a quiet record means
  // something only in a tab that could get a notice at all.
  await loadedForNotice(t, [busy], 'the letter without --interrupt', { bots, homes });
  const sinceQuiet = Date.now() - 1000;
  const stepsBefore = await stepsIn(busy.stepsFile);
  send(t, bots, { to: `${PI}/busy`, subject: 'the pi quiet report', text: `${QUIET} — nothing to do, just read this.` });
  const quietEnd = Date.now() + QUIET_MS;
  while (Date.now() < quietEnd) {
    await busy.screen();
    const turns = turnsOf(busy.record(), 'user').filter((turn) => turn.at >= sinceQuiet);
    assert.deepEqual(turns.map((turn) => turn.text), [], `${busy.title}: nothing typed into the busy receiver after a send without --interrupt: no user turn in its Pi record.\n  ${tailOf(busy.record())}`);
    assert.ok(!(await mailReadIn(busy.mailFile)).includes(QUIET), `${busy.title}: the letter waits in the mailbox while the receiver is busy; it was read already`);
    const rows = rowsOf(busy.handle) ?? [];
    assert.ok(!rows.some((row) => KIT_LINE.test(row)), `${busy.title}: a kit line is on the screen:\n  ${rows.join('\n  ')}`);
    await setTimeout(2000);
  }
  const stepsAfter = await stepsIn(busy.stepsFile);
  assert.ok(stepsAfter > stepsBefore, `${busy.title}: the loop went on through the send without --interrupt (${stepsBefore} steps, then ${stepsAfter})`);
  assert.ok(stepsAfter < LOOP_STEPS, `${busy.title}: the loop is still running, so the receiver was busy all along (${stepsAfter} of ${LOOP_STEPS} steps)`);
  lookAtOrphan(t, busy.title, busy.handle, 'after the quiet watch');

  // ----------------------------------------------------------- 3. busy, --interrupt
  await loadedForNotice(t, [busy], 'the letter with --interrupt', { bots, homes });
  const sinceUrgent = Date.now() - 1000;
  const urgentSaid = send(t, bots, { to: `${PI}/busy`, subject: 'the pi urgent report', text: `${URGENT} — nothing to do, just read this.`, interrupt: true });
  const stepsAtEscape = await stepsIn(busy.stepsFile);
  assert.match(urgentSaid, /was busy, so the kit pressed Escape once/i, `${busy.title}: the send says the receiver was busy, so the kit pressed Escape once in its tab, got:\n${urgentSaid}`);
  assert.doesNotMatch(urgentSaid, /background terminal/i, `${busy.title}: the send says nothing of a Codex background terminal to a Pi receiver, got:\n${urgentSaid}`);
  lookAtOrphan(t, busy.title, busy.handle, 'after the letter with --interrupt');

  const naturalEnd = loopStarted + LOOP_STEPS * 1000;
  const urgentNotice = await until(`Orca's notice to land in ${busy.title}'s Pi record after the interrupt`, NOTICE_MS, async () => noticesIn(busy.record(), { since: sinceUrgent, mailbox: busy.mailbox })[0], () => `\n  its Pi record's tail:\n  ${tailOf(busy.record())}${whatIsUp(busy.handle)}`, busy.screen);
  t.diagnostic(`${busy.title}: Orca's notice came ${Math.round((urgentNotice.at - sinceUrgent) / 1000)} s after the send with --interrupt`);
  assert.ok(urgentNotice.at < naturalEnd - 30000, `${busy.title}: the notice came well before the loop would have ended by itself, so the busy turn was ended (notice at ${new Date(urgentNotice.at).toISOString()}, the loop's own end about ${new Date(naturalEnd).toISOString()})`);

  await until(`${busy.title} to read both letters`, ANSWER_MS, async () => {
    const text = await mailReadIn(busy.mailFile);
    return text.includes(QUIET) && text.includes(URGENT) ? true : undefined;
  }, () => `\n  its Pi record's tail:\n  ${tailOf(busy.record())}${whatIsUp(busy.handle)}`, busy.screen);
  const later = await stepsIn(busy.stepsFile);
  t.diagnostic(`${busy.title}: the loop had written ${stepsAtEscape} of ${LOOP_STEPS} steps at the Escape and ${later} when both letters were read (Pi kills a running command at an Escape, read in its code; this is observed, not judged)`);
});
