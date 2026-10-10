// A system test: a maker answers its Claude temporary session's "Teach auto
// mode about your environment?" form with `obk temp answer`, and the command
// refuses any other screen untouched (#489, the issue's live check). Against
// the real Orca and a real Claude Code on this machine. Run it alone with
// `npm run test:system -- --yes test/system/temp-answer.test.js`; `npm test`
// cannot, and no CI machine could.
//
// Claude Code has two known forms of it: 2.1.283's form, answered with Esc,
// and 2.1.289's numbered list, answered with "2. Not now" by arrows, a look
// at the screen, and a return (helpers/screens.js CLAUDE_TEACH_FORM and
// CLAUDE_TEACH_LIST; the architect's ruling on #489's live run). In auto mode
// Claude Code now puts the list up after every first turn on this machine. Any
// key into it writes a choice into the owner's ~/.claude.json for the whole
// machine, which a system test may not do (#240). So this test sends a real
// form no key and runs no `obk temp answer` on one. It answers staged copies
// instead, in a tab of its own that never shows a real one:
//
//   1. A throwaway fleet: a bot on Claude Code with one long-lived session,
//      lead, brought up. lead is asked to do nothing; the commands it would run
//      are run for it, with lead's tab id and handle (#250, #408).
//   2. From lead's tab, `obk temp make --name helper --approval ask`, a Claude
//      temporary session whose start prompt asks for one short reply, so it
//      has a first turn. It runs at `ask` (`--permission-mode manual`), not in
//      auto mode, because the Teach form is auto mode's and Claude Code shows
//      it in auto mode only (read in the 2.1.283 code, tech notes, section 1;
//      worked out, not proven for 2.1.289). That is the way to a tab of the
//      test's own with no real form in it: a Codex helper would need its first-
//      run screens answered and a harness the kit may not take a Teach form
//      from. Its folder trust is answered by this test, down and return, only
//      when it is the plain one for the bot home (helpers/screens.js
//      `onlyPlainTrustOf`, the ruling on #451), as temp-roles does.
//   3. Should a real form come up all the same: for TEACH_WATCH_MS after
//      helper's reply, the test looks for the title. If it comes, the test
//      types nothing into it. It records whether `onlyTeachFormOf` or
//      `onlyTeachListOf` matches it, with its rows, and ends there as skipped:
//      steps 4 and 5 need helper at its plain input line, and only a key would
//      take the form away. The teardown closes the tab. If it does not come,
//      the test says so and goes on.
//   4. A real screen that is not the form: helper at its plain input line.
//      `obk temp answer` is refused, says something of what the screen shows,
//      and leaves the tab as it was: still at its plain input line, the input
//      line as before, and no new user line in helper's transcript.
//   5. The staged forms. helper quits with /exit, typed only at its plain
//      input line with no Teach title on screen, and the shell comes to the
//      front. The test then runs a small node program of its own in that tab,
//      on the tab's terminal: it clears the screen, draws the rows it is given,
//      writes every byte it reads to a file, and writes how it ended to
//      another. As the list, it moves its pointer on each arrow, as Claude
//      Code's does, and ends only on a return with the pointer on "2. Not now";
//      a return on 1 or 3, Esc, or any other key leaves it up. As the 2.1.283
//      form, it ends on Esc alone. A stop file the test writes ends it too. It
//      is started with `OBK_TAB_SHELL=$$`, the kit's mark for a program the
//      tab's shell started (#261), in case the kit looks at what is in front.
//      a. The captured list with one row changed (`2. Later`). `obk temp
//         answer` is refused, prints that row, and the program read no byte
//         at all: refused untouched.
//      b. The captured list from the rule above its title down, with the
//         input box below its foot and that box's own `❯`. As Orca renders it, it passes
//         `onlyTeachListOf` (the premise). `obk temp answer` answers: exit 0,
//         the answer names helper and lead, the program read exactly down and
//         return, it ended on "2. Not now", and the title is gone.
//      c. The 2.1.283 form's own rows, from the rule above its title down:
//         answered, the program read exactly one Esc, and the title is gone.
//
// What it cannot show: what Claude Code's own form or list does with the
// answer. Esc on the form is read in the 2.1.283 code (tech notes, section 1),
// and this test sends a real one no key. What it does show: the kit reads the
// live screen as Orca renders it, matches both known forms there, answers
// each with its own keys and nothing else, waits for the pointer before the
// return, refuses a list one row off without a single byte, and sees the
// form go.
//
// The machine it runs on is someone's working machine. So this test, like the
// ones beside it: works in a throwaway bots folder under the system temp
// directory, its staging program and files beside it; writes down every
// terminal and workspace Orca already had; runs this checkout's `src/cli.js` by
// its full path, never the machine's `obk` (#220); types only into helper's tab,
// its own: the folder trust's answer, /exit, and the three lines that start
// the staging program; closes only its own tabs, through the tab guard, and deletes
// its own workspaces, whatever happened; signals no process, and reads `ps` for
// one pid at a time. `orca terminal close --worktree … --all` is never run, and
// the guard refuses it. Claude Code's records of the throwaway folder are read,
// never written. This test does not read or write ~/.claude.json; Claude Code
// records the folder's trust in it, and the runner takes that key out again
// (#240).
//
// **It is attended, lightly.** lead's tab and Bot Father's show Claude Code's
// folder trust; nothing here waits on them, so leave them. It takes a few
// minutes.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry, shellWord } from '../helpers/cli.js';
import {
  CLAUDE_TEACH_FORM,
  CLAUDE_TEACH_LIST,
  onlyPlainTrustOf,
  onlyTeachFormOf,
  onlyTeachListOf,
  questionOn,
} from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { deleteOwnProject } from '../helpers/own-project.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/**
 * Remove the throwaway bots folder and everything the kit or this test made
 * beside it: `<bots>.prompts`, `<bots>.locks`, this test's staging program and
 * its files are siblings of it (PRD 6.3).
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

/** How long a tab is given to show its next screen. */
const READY_MS = 180000;

/** How long a real harness is given for its turn. */
const ANSWER_MS = 240000;

/** How long after helper's reply the test looks for the real form. */
const TEACH_WATCH_MS = 30000;

/** How long a screen is given to move on, or a program to come to the front. */
const MOVE_MS = 30000;

/** How long after a refusal the tab is watched for a change that should not come. */
const SETTLE_MS = 5000;

const BOT = 'answer-bot';
const LEAD = 'lead';
const HELPER = 'helper';

/** In helper's start prompt only: its first turn prints it. */
const READY_WORD = 'READY-4893';

/** helper's task: one short reply, so it has a first turn, and nothing else. */
const TASK = 'You are a system test\'s session and you own nothing. Do not run any command, read or write any file,'
  + ` or use any tool. Reply now with ${READY_WORD} and nothing else, then wait.`;

/** The form's title row, as captured. */
const TEACH_TITLE = 'Teach auto mode about your environment?';

/**
 * The captured 2.1.283 form's own rows, from the rule of `▔` it is drawn under
 * down: the kit takes a form only so framed, not quoted in a turn (the ruling
 * on the review of PR #490).
 */
const FORM_ROWS = CLAUDE_TEACH_FORM.slice(CLAUDE_TEACH_FORM.findIndex((row) => row.trim() === TEACH_TITLE) - 1);

/** The captured 2.1.289 list from the rule of `─` it is drawn under down: the list, its foot, and the input box below. */
const LIST_ROWS = CLAUDE_TEACH_LIST.slice(CLAUDE_TEACH_LIST.findIndex((row) => row.trim() === TEACH_TITLE) - 1);

/** The same rows with one row changed: not the captured list. */
const LIST_ONE_OFF = LIST_ROWS.map((row) => (row === '    2. Not now' ? '    2. Later' : row));

/**
 * The staging program: `node stage.mjs <list|form> <rows file> <keys file>
 * <stop file>`. It draws the rows on a cleared screen, writes every byte it
 * reads to the keys file and how it ended to `<keys file>.outcome`. As the
 * list, each arrow moves its pointer among the numbered rows and redraws, and
 * only a return with the pointer on "2. Not now" ends it ("not now"). As the
 * form, Esc alone ends it ("esc"). It ends too when the stop file appears
 * ("stopped"), and after ten minutes ("timed out"). Written with no backtick
 * and no template, so it can sit in String.raw as it is.
 */
const STAGE = String.raw`import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const [mode, rowsFile, keysFile, stopFile] = process.argv.slice(2);
const outcomeFile = keysFile + '.outcome';
let rows = JSON.parse(readFileSync(rowsFile, 'utf8'));
writeFileSync(keysFile, '');
writeFileSync(outcomeFile, 'up');
const draw = (lines) => process.stdout.write('\x1b[2J\x1b[H' + lines.join('\r\n') + '\r\n');
const CHOICE = /^ {2}(?:❯ | {2})([123]\. .+)$/;
const choices = () => rows.flatMap((row, at) => (CHOICE.test(row) ? [at] : []));
const pointerAt = () => rows.findIndex((row) => /^ {2}❯ [123]\. /.test(row));
const move = (by) => {
  const list = choices();
  const to = list.indexOf(pointerAt()) + by;
  if (to < 0 || to >= list.length) return;
  rows = rows.map((row, at) => {
    const found = CHOICE.exec(row);
    if (found === null) return row;
    return at === list[to] ? '  ❯ ' + found[1] : '    ' + found[1];
  });
  draw(rows);
};
let watch;
const end = (outcome, code) => {
  writeFileSync(outcomeFile, outcome);
  clearInterval(watch);
  process.stdin.setRawMode(false);
  process.exit(code);
};
draw(rows);
watch = setInterval(() => { if (existsSync(stopFile)) { draw(['STAGE-STOPPED']); end('stopped', 0); } }, 250);
setTimeout(() => { draw(['STAGE-TIMED-OUT']); end('timed out', 1); }, 600000);
process.stdin.setRawMode(true);
process.stdin.on('data', (chunk) => {
  appendFileSync(keysFile, chunk);
  let text = chunk.toString('latin1');
  while (text.length > 0) {
    if (text.startsWith('\x1b[A') || text.startsWith('\x1b[B')) {
      if (mode === 'list') move(text[2] === 'A' ? -1 : 1);
      text = text.slice(3);
    } else if (text[0] === '\x1b') {
      if (mode === 'form') { draw(['STAGE-ESC: the staged form was cancelled']); end('esc', 0); }
      text = text.slice(1);
    } else if (text[0] === '\r') {
      if (mode === 'list' && CHOICE.exec(rows[pointerAt()] ?? '')?.[1] === '2. Not now') { draw(['STAGE-NOT-NOW: the staged list was answered']); end('not now', 0); }
      text = text.slice(1);
    } else {
      text = text.slice(1);
    }
  }
});
process.stdin.resume();
`;

/** Every close goes through the guard, which counts it for the check at the end (#246). */
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

/** The tabs Orca lists at `home` once it has caught up with what was closed (#187). */
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
 * The environment of wherever this test was started, without anything that
 * names an Orca tab or the kit's launch line: the test may itself run in an
 * Orca tab, and a command of the kit's must not take that tab for its caller.
 */
const outsideAnyTab = Object.fromEntries(Object.entries(process.env)
  .filter(([name]) => !name.startsWith('ORCA_') && name !== 'OBK_CLI' && name !== 'OBK_TAB_SHELL'));

/** What a command run in a session's tab sees of it: the tab's id, as the book holds it, and its handle. */
const inTab = ({ tabId, handle }) => ({ ...outsideAnyTab, ORCA_TAB_ID: tabId, ORCA_TERMINAL_HANDLE: handle });

/**
 * Run this checkout's `obk`, by its full path (#217, #220), outside any tab
 * unless `env` says which. The kit's own words never say "worktree". `shown`
 * is the screen a command may print back, as `obk temp answer` does when it
 * refuses: those rows are the tab's, not the kit's (helper's start prompt
 * says it is "not a git worktree"), so they are taken out before the look.
 */
function obk(args, env = outsideAnyTab, shown = []) {
  const done = spawnSync(process.execPath, [cliEntry, ...args], { encoding: 'utf8', cwd: os.tmpdir(), env });
  assert.equal(done.error, undefined, `could not run \`obk\`: ${done.error?.message}`);
  const own = shown.map((row) => row.trim()).filter((row) => row !== '')
    .reduce((text, row) => text.replaceAll(row, ''), done.stdout + done.stderr);
  assert.ok(!/worktree/i.test(own), `obk said "worktree": ${done.stdout}${done.stderr}`);
  return done;
}

/** Run `obk ... --json` and read the answer it printed; every tab it says it opened is counted as this test's. */
function obkJson(args, env) {
  const done = obk([...args, '--json'], env);
  assert.equal(done.status, 0, `obk ${args.join(' ')} failed: ${done.stdout}${done.stderr}`);
  try {
    return guard.openedByKit(JSON.parse(done.stdout));
  } catch {
    assert.fail(`obk ${args.join(' ')} --json did not print JSON: ${done.stdout}`);
  }
}

/** The one tab an `obk --json` answer says it opened. */
function openedIn(answer, what) {
  const found = (answer.tabs ?? []).filter((entry) => entry.created === true);
  assert.equal(found.length, 1, `${what} should have opened one tab, got: ${JSON.stringify(answer.tabs)}`);
  return found[0];
}

/** The bot's book as it stands. */
const bookOf = (home) => parse(readFileSync(path.join(home, 'sessions.yaml'), 'utf8')) ?? {};

/** What the book says about one of the bot's sessions right now. */
const sessionIn = (home, name) => bookOf(home).sessions?.[name] ?? {};

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

/** The rows the tab renders right now, or undefined when Orca gives no rendered screen. */
function rowsOf(handle) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  const shown = answer.ok === true ? answer.result?.terminal : undefined;
  return shown?.source === 'screen' && Array.isArray(shown.tail) ? shown.tail : undefined;
}

/** Whether the tab shows the form's title row right now. */
const showsForm = (rows) => (rows ?? []).some((row) => row.trim() === TEACH_TITLE);

/** What the tab is showing, for the message of a wait that ran out. */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  return `${blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`}`
    + `\n  orca terminal read --terminal ${handle} --screen\n  ${(rowsOf(handle) ?? ['(no rendered screen)']).join('\n  ')}`;
}

/** Send keys into the test's own tab exactly as given, with no `--enter`. */
function sendKeys(handle, keys) {
  const sent = orca(['terminal', 'send', '--terminal', handle, '--text', keys]);
  assert.equal(sent.ok, true, `sending ${JSON.stringify(keys)} into ${handle} failed: ${JSON.stringify(sent.error)}.${whatIsUp(handle)}`);
}

/** The request id an `agent_prompt_blocked` carries, read out of the whole error. */
function requestIdIn(error) {
  const found = /"orchestrationRequestId"\s*:\s*"([^"]+)"/.exec(JSON.stringify(error ?? null));
  return found === null ? undefined : found[1];
}

/**
 * Send one line into this test's own tab, with `--enter`. A gated line fails
 * with the screen and the id rather than retrying (see
 * `session-identity.test.js`).
 */
function sendLine(handle, text) {
  const sent = orca(['terminal', 'send', '--terminal', handle, '--text', text, '--enter']);
  if (sent.ok === true) return;

  const gated = requestIdIn(sent.error);
  assert.fail(
    `orca terminal send --enter failed: ${JSON.stringify(sent.error)}.`
    + (gated === undefined
      ? ''
      : ' Orca gated it as an agent prompt. Submit the line yourself in the tab, or reissue the'
        + ` same command with --retry-request ${gated} --wait-submit 30.`)
    + whatIsUp(handle),
  );
}

/** A row of Claude Code's input box's rules: nothing but `─`, a name set into it aside. */
const RULE_ROW = /^\s*─{8,}/;

/**
 * The input line of a Claude tab at its plain input prompt, or why it is not
 * at one: the screen can be read, shows no question, form or menu
 * (helpers/screens.js, `questionOn`), and its lowest `❯` row is the input
 * line, between the input box's two rules.
 */
function promptOf(handle) {
  const rows = rowsOf(handle);
  if (rows === undefined) return { why: 'its screen could not be read' };
  const screen = `\n    ${rows.join('\n    ')}`;
  // The shared look misses 2.1.289's list, whose foot row sits above the
  // input box (#489): its title says it is up.
  if (showsForm(rows)) return { why: `a Teach auto mode form is up:${screen}` };
  if (questionOn(rows) !== undefined) return { why: `a question, form or menu is up:${screen}` };
  const at = rows.findLastIndex((row) => row.trimStart().startsWith('❯'));
  if (at < 0) return { why: `no input line is on it:${screen}` };
  if (!RULE_ROW.test(rows[at - 1] ?? '') || !RULE_ROW.test(rows[at + 1] ?? '')) {
    return { why: `its lowest ❯ row is not the input line between the input box's rules:${screen}` };
  }
  return { line: rows[at], rows };
}

/**
 * Type one line into a Claude tab of this test's own, and only when it is at
 * its plain input prompt (architect's rule, #261 live run): a line with a
 * return must never answer a form or a menu. Otherwise fail with the screen,
 * having typed nothing.
 */
function typeIntoClaude(handle, text) {
  const { why } = promptOf(handle);
  assert.equal(why, undefined, `this test would type ${JSON.stringify(text)} into ${handle}, but ${why}\n  Nothing was typed.`);
  sendLine(handle, text);
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
 * memory`, and the pane's terminal foreground group from `ps`. Undefined when
 * any of it cannot be read.
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
  if (comm === undefined) return undefined;
  return { pid: group, name: path.basename(comm.replace(/^-/, '')) };
}

/** Whether a command name is a shell's. */
const isShell = (name) => ['zsh', 'bash', 'sh', 'fish', 'ksh', 'tcsh', 'dash'].includes(name);

/** Wait until a shell leads the tab's foreground group. */
const shellInFront = (handle) => until(
  `a shell to be in front of ${handle}`,
  MOVE_MS,
  async () => {
    const front = inFront(handle);
    return front !== undefined && isShell(front.name) ? front : undefined;
  },
  () => ` In front now: ${JSON.stringify(inFront(handle) ?? null)}.${whatIsUp(handle)}`,
);

/** Where Claude Code keeps the conversations it had in one folder (tech notes, section 2). */
const transcriptsOf = (home) => path.join(os.homedir(), '.claude', 'projects', home.replaceAll(/[^A-Za-z0-9]/g, '-'));

/** One conversation's transcript, whole lines only, a JSON object per line; none when it has no file yet. */
function claudeLinesOf(home, id) {
  if (typeof id !== 'string') return [];
  const file = path.join(transcriptsOf(home), `${id}.jsonl`);
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8');
  return text.slice(0, text.lastIndexOf('\n') + 1).split('\n').flatMap((raw) => {
    try {
      return raw.trim() === '' ? [] : [JSON.parse(raw)];
    } catch {
      return [];
    }
  });
}

/** How many user lines a conversation's transcript holds. */
const userLinesIn = (home, id) => claudeLinesOf(home, id).filter((line) => line.type === 'user').length;

/** Read an `obk temp answer --json` that went through, and check whose it is. */
function answeredBy(done, what) {
  assert.equal(done.status, 0, `${what}: obk temp answer should answer the form: ${done.stdout}${done.stderr}`);
  let answer;
  try {
    answer = JSON.parse(done.stdout);
  } catch {
    assert.fail(`${what}: obk temp answer --json did not print JSON: ${done.stdout}`);
  }
  assert.deepEqual(
    { bot: answer.bot, session: answer.session, maker: answer.maker },
    { bot: BOT, session: HELPER, maker: LEAD },
    `${what}: the answer names helper and its maker: ${done.stdout}`,
  );
  return answer;
}

/** A refusal of `obk temp answer`: a non-zero exit with a reason and no crash. */
function refused(done, what) {
  const said = `${done.stdout}${done.stderr}`;
  assert.notEqual(done.status, 0, `${what}: obk temp answer should refuse, got: ${said}`);
  assert.notEqual(said.trim(), '', `${what}: a refusal says why`);
  assert.ok(!/^\s+at /m.test(said), `${what}: a message, not a crash: ${said}`);
  return said;
}

test('a maker answers its Claude temporary session\'s Teach auto mode form with obk temp answer, and an unknown screen is refused untouched', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-temp-answer-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', BOT].map(homeOf);
  const home = homeOf(BOT);
  const stage = `${bots}.stage.mjs`;
  const rowsFile = `${bots}.stage-rows.json`;
  const keysFile = `${bots}.stage-keys`;
  const stopFile = `${bots}.stage-stop`;

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    // A staging program still up ends on its own stop file before its tab goes.
    try {
      writeFileSync(stopFile, '');
    } catch {
      // The bots folder's parent is the system temp folder; nothing to stop if it cannot be written.
    }
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
  // 1. The fleet: Bot Father, and answer-bot on Claude Code with one
  // long-lived session, lead, brought up.
  obkJson(['init', '--bots', bots, '--harness', 'claude']);
  obkJson([
    'bot', 'create', '--bots', bots, '--name', BOT, '--harness', 'claude',
    '--charter', `${BOT} exists for one system test run and owns nothing.`,
  ]);
  obkJson(['session', 'add', '--bots', bots, '--bot', BOT, '--name', LEAD, '--prompt', 'You are a system test\'s session and you own nothing. Say nothing and wait.']);
  const leadTab = openedIn(obkJson(['up', '--bots', bots, '--bot', BOT]), 'up');
  const lead = { tabId: sessionIn(home, LEAD).tab, handle: leadTab.terminal };
  assert.equal(typeof lead.tabId, 'string', `the premise: the book holds lead's tab, got: ${JSON.stringify(sessionIn(home, LEAD))}`);

  /** `obk temp answer` for helper, run in lead's tab, which may print back the screen it read. */
  const answerHelper = (json) => obk(
    ['temp', 'answer', '--bots', bots, '--name', HELPER, ...(json ? ['--json'] : [])],
    inTab(lead),
    rowsOf(handle) ?? [],
  );

  // ---------------------------------------------------------------------------
  // 2. lead makes helper, a Claude temporary session with one short turn to
  // take, at `ask`, out of auto mode, where the Teach form does not come.
  const made = obkJson(['temp', 'make', '--bots', bots, '--name', HELPER, '--approval', 'ask', '--prompt', TASK], inTab(lead));
  assert.equal(made.session, HELPER, `temp make makes ${HELPER}: ${JSON.stringify(made)}`);
  assert.equal(made.maker, LEAD, `${HELPER} is lead's: ${JSON.stringify(made)}`);
  const handle = openedIn(made, `temp make of ${HELPER}`).terminal;

  // Its folder trust, which this test answers itself, once, and only when it
  // is the plain one for the bot home (the ruling on #451).
  const asked = await until(
    `${HELPER} to show Claude Code's folder trust, or report its conversation`,
    READY_MS,
    async () => {
      if (typeof sessionIn(home, HELPER).session === 'string') return { rows: null };
      const rows = rowsOf(handle);
      return rows !== undefined && rows.some((row) => row.includes('Yes, I trust this folder')) ? { rows } : undefined;
    },
    () => whatIsUp(handle),
  );
  if (asked.rows !== null) {
    const wrong = onlyPlainTrustOf(asked.rows, home);
    assert.equal(
      wrong,
      undefined,
      `${HELPER}'s folder trust is not one this test may answer, so it answered nothing: ${wrong}.`
      + `\n  what it showed:\n    ${asked.rows.join('\n    ')}`,
    );
    sendKeys(handle, '\x1b[B\r');
    t.diagnostic(`answered ${HELPER}'s plain folder trust (the ruling on #451)`);
  }

  // Its reply to the start prompt: the first turn done.
  await until(
    `${HELPER} to reply ${READY_WORD} and report its conversation`,
    ANSWER_MS,
    async () => (typeof sessionIn(home, HELPER).session === 'string'
      && (rowsOf(handle) ?? []).some((row) => row.trimStart().startsWith('⏺') && row.includes(READY_WORD)) ? true : undefined),
    () => ` The book's entry: ${JSON.stringify(sessionIn(home, HELPER))}.${whatIsUp(handle)}`,
  );
  const id = sessionIn(home, HELPER).session;

  // ---------------------------------------------------------------------------
  // 3. A real form, should Claude Code put one up all the same.
  const watchUntil = Date.now() + TEACH_WATCH_MS;
  let real;
  while (real === undefined && Date.now() < watchUntil) {
    const rows = rowsOf(handle);
    if (showsForm(rows)) real = rows;
    else await setTimeout(1000);
  }
  if (real !== undefined) {
    // No key into it, and no obk temp answer on it: an Esc would write a Not now
    // into the owner's ~/.claude.json (#240). Recorded, and left to the teardown.
    const asForm = onlyTeachFormOf(real);
    const asList = onlyTeachListOf(real);
    const matched = asForm === undefined ? 'matched by onlyTeachFormOf' : asList === undefined ? 'matched by onlyTeachListOf'
      : `matched by neither (onlyTeachFormOf: ${asForm}; onlyTeachListOf: ${asList})`;
    t.diagnostic(`real Teach form seen in ${HELPER}'s tab at approval ask, ${matched}, left unanswered; what it showed:\n    ${real.join('\n    ')}`);
    t.skip(`the real Teach form is up in ${HELPER}'s tab and this test sends it no key, so steps 4 and 5 cannot run: this run proves nothing about obk temp answer. Run it again once Claude Code no longer puts the form up.`);
    return;
  }
  t.diagnostic(`Claude Code put up no Teach form in ${HELPER}'s tab at approval ask within ${TEACH_WATCH_MS} ms of its first turn`);

  // ---------------------------------------------------------------------------
  // 4. A real screen that is not the form: helper at its plain input line.
  const idle = await until(
    `${HELPER} to be at its plain input line`,
    MOVE_MS,
    async () => {
      const at = promptOf(handle);
      return at.why === undefined ? at : undefined;
    },
    () => ` ${promptOf(handle).why ?? ''}`,
  );
  const usersBefore = userLinesIn(home, id);
  const idleSaid = refused(answerHelper(false), 'helper at its input line');
  // Rows with words in them: a rule or a bare pointer says nothing of the screen.
  const drawn = idle.rows.map((row) => row.trim()).filter((row) => /[A-Za-z]{4,}/.test(row));
  assert.ok(drawn.some((row) => idleSaid.includes(row)), `the refusal says what the screen shows: ${idleSaid}\n  the screen:\n    ${drawn.join('\n    ')}`);
  await setTimeout(SETTLE_MS);
  const still = promptOf(handle);
  assert.equal(still.why, undefined, `helper is still at its plain input line after the refusal: ${still.why}`);
  assert.equal(still.line, idle.line, 'its input line is as it was');
  assert.equal(userLinesIn(home, id), usersBefore, 'and its transcript has no new user line');

  // ---------------------------------------------------------------------------
  // 5. The staged forms, in helper's own tab once its Claude Code has quit.
  typeIntoClaude(handle, '/exit');
  await shellInFront(handle);
  await writeFile(stage, STAGE);
  const startStage = async (mode, rows, what) => {
    await rm(stopFile, { force: true });
    await writeFile(rowsFile, JSON.stringify(rows));
    sendLine(handle, `OBK_TAB_SHELL=$$ node ${shellWord(stage)} ${mode} ${shellWord(rowsFile)} ${shellWord(keysFile)} ${shellWord(stopFile)}`);
    return until(`${what} to be drawn in ${HELPER}'s tab`, MOVE_MS, async () => {
      const rows = rowsOf(handle);
      return showsForm(rows) ? rows : undefined;
    }, () => whatIsUp(handle));
  };
  const keysRead = () => (existsSync(keysFile) ? readFileSync(keysFile, 'latin1') : undefined);
  const outcome = () => (existsSync(`${keysFile}.outcome`) ? readFileSync(`${keysFile}.outcome`, 'utf8') : undefined);

  // 5a. The list one row off: refused, and not one byte reaches the tab.
  const offRows = await startStage('list', LIST_ONE_OFF, 'the staged list one row off');
  assert.notEqual(onlyTeachListOf(offRows), undefined, `the premise: the staged list one row off is not the captured one:\n    ${offRows.join('\n    ')}`);
  const offSaid = refused(answerHelper(false), 'the staged list one row off');
  assert.match(offSaid, /2\. Later/, `the refusal prints the row that is off: ${offSaid}`);
  await setTimeout(SETTLE_MS);
  assert.equal(keysRead(), '', 'the refusal sent no key into the tab: the staging program read nothing');
  assert.equal(showsForm(rowsOf(handle)), true, 'and the staged list is still up');
  await writeFile(stopFile, '');
  await shellInFront(handle);

  // 5b. The captured list: down to "2. Not now", a look, then return; and gone.
  const listRows = await startStage('list', LIST_ROWS, 'the staged captured list');
  assert.equal(
    onlyTeachListOf(listRows),
    undefined,
    `the premise: the staged list, as Orca renders it, is the captured one (a tab too narrow wraps its rows):\n    ${listRows.join('\n    ')}`,
  );
  answeredBy(answerHelper(true), 'the staged list');
  assert.equal(keysRead(), '\x1b[B\r', `the staging program read down, then return, and nothing else, got: ${JSON.stringify(keysRead())}`);
  assert.equal(outcome(), 'not now', 'and it ended on the return with its pointer on "2. Not now"');
  assert.equal(showsForm(rowsOf(handle)), false, `the staged list has gone.${whatIsUp(handle)}`);
  await shellInFront(handle);

  // 5c. The 2.1.283 form's own rows: answered with Esc alone, and gone.
  const formRows = await startStage('form', FORM_ROWS, 'the staged 2.1.283 form');
  assert.equal(
    onlyTeachFormOf(formRows),
    undefined,
    `the premise: the staged form, as Orca renders it, is the captured one (a tab too narrow wraps its rows):\n    ${formRows.join('\n    ')}`,
  );
  answeredBy(answerHelper(true), 'the staged form');
  assert.equal(keysRead(), '\x1b', `the staging program read Esc and nothing else, got: ${JSON.stringify(keysRead())}`);
  assert.equal(outcome(), 'esc', 'and it ended on the Esc');
  assert.equal(showsForm(rowsOf(handle)), false, `the staged form has gone.${whatIsUp(handle)}`);
  await shellInFront(handle);
});
