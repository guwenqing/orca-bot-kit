// A system test: a long-lived session's first-run screens answered through the
// kit, with `obk session trust-hooks` and `obk session answer` (#506, the
// issue's live check). Against the real Orca, a real Codex and a real Claude
// Code on this machine. Run it alone with
// `npm run test:system -- --yes test/system/session-first-run.test.js`;
// `npm test` cannot, and no CI machine could.
//
// The steps:
//
//   1. A throwaway fleet: Bot Father, `first-codex` on Codex with one
//      long-lived session, daily, and `first-claude` on Claude Code with one
//      long-lived session, lead, at approval `ask`. Both are brought up.
//   2. daily is launched with the folder's trust as a launch-time override and
//      no hooks bypass (helpers/codex-trust.js, `codexTrustArgs(bots, { hooks:
//      false })`), so Codex shows no folder trust and does show "Hooks need
//      review" for the kit's three hooks. The book's entry for daily holds
//      `launched_with`, equal to bot.yaml's extra_args for daily, as typed
//      (#506). Should a folder trust or any other question come up all the
//      same, the test stops with the screen and types nothing into it.
//   3. From lead's tab, a session of another bot than Bot Father, `obk session
//      trust-hooks` for daily is refused, names Bot Father, and leaves daily
//      untouched: the review still up with the same rows, and no conversation
//      in the book.
//   4. Run outside every bot's session, as the user would, `obk session
//      trust-hooks` for daily answers: exit 0, it names first-codex, daily and
//      "Trust all and continue", the review goes, and the kit's hooks run: the
//      book holds daily's conversation.
//   5. lead's folder trust is answered by this test, down and return, only when
//      it is the plain one for the bot home (helpers/screens.js
//      `onlyPlainTrustOf`, the ruling on #451), as temp-answer.test.js does.
//      lead replies to its start prompt. If a real Teach form comes up after
//      it, the test types nothing into it, records it, and ends as skipped.
//   6. A real screen that is not the form: lead at its plain input line. `obk
//      session answer` is refused, says something of what the screen shows,
//      and leaves the tab as it was.
//   7. The staged forms, as temp-answer.test.js stages them: lead quits with
//      /exit, typed only at its plain input line, and a small node program of
//      this test's own draws the rows in lead's tab, writes every byte it reads
//      to a file, and ends only on the right answer.
//      a. The captured 2.1.289 list (helpers/screens.js CLAUDE_TEACH_LIST), run
//         from daily's tab, a session of another bot, as a command daily's
//         Codex runs: the tab and the kit's launch line's mark (OBK_TAB_SHELL,
//         OBK_CLI). Refused, names Bot Father, and the program read no byte.
//         Then from daily's tab without the mark: refused, says the kit
//         cannot tell which session is asking (#408), and still no byte.
//      b. The list with one row changed: refused, prints that row, no byte.
//      c. The captured list, run outside every bot's session, after the
//         premise that it passes `onlyTeachListOf`: answered with down, then
//         return, it ended on "2. Not now", and the title is gone.
//      d. The 2.1.283 form's own rows, after the premise that they pass
//         `onlyTeachFormOf`: answered with Esc alone, and the title is gone.
//
// What it cannot show: what Claude Code's own Teach screens do with the answer.
// Any key into a real one writes a choice into the owner's ~/.claude.json for
// the whole machine, which a system test may not do (#240), so this test sends
// a real one no key and runs no `obk session answer` on one.
//
// What it leaves behind is Codex's own doing, as codex-first-run-screens.test.js
// says of its own run: "Trust all and continue" makes Codex write the three
// hooks' hashes for this throwaway bot into ~/.codex/config.toml, which the
// runner takes out again after the run (#240). Claude Code records lead's
// folder trust in ~/.claude.json, which the runner takes out too. The test
// never writes either file itself.
//
// The machine it runs on is someone's working machine. So this test, like the
// ones beside it: works in a throwaway bots folder under the system temp
// directory, its staging program and files beside it; writes down every
// terminal and workspace Orca already had; runs this checkout's `src/cli.js` by
// its full path, never the machine's `obk` (#220); types only into its own
// tabs: lead's folder trust, /exit, and the lines that start the staging
// program; closes only its own tabs, through the tab guard, and deletes its own
// workspaces, whatever happened; signals no process, and reads `ps` for one pid
// at a time. `orca terminal close --worktree … --all` is never run, and the
// guard refuses it.
//
// **It is attended, lightly.** The bots folder is
// `<tmp>/obk-system-session-first-run-*`. Its tabs are the test's to answer:
// leave them alone. Bot Father's tab may show Claude Code's folder trust;
// nothing here waits on it. It takes a few minutes.

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
import { codexTrustArgs } from '../helpers/codex-trust.js';
import {
  CLAUDE_TEACH_FORM,
  CLAUDE_TEACH_LIST,
  onlyPlainTrustOf,
  onlyTeachFormOf,
  onlyTeachListOf,
  questionOn,
} from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
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

/** How long a real harness is given for its turn, and the kit's hook to report it. */
const ANSWER_MS = 240000;

/** How long after lead's reply the test looks for a real Teach form. */
const TEACH_WATCH_MS = 30000;

/** How long a screen is given to move on, or a program to come to the front. */
const MOVE_MS = 30000;

/** How long after a refusal the tab is watched for a change that should not come. */
const SETTLE_MS = 5000;

const CODEX_BOT = 'first-codex';
const CODEX_SESSION = 'daily';
const CLAUDE_BOT = 'first-claude';
const CLAUDE_SESSION = 'lead';

/** In lead's start prompt only: its first turn prints it. */
const READY_WORD = 'READY-5061';

/** The title of Codex's hooks review, as captured. */
const REVIEW_TITLE = 'Hooks need review';

/** The Teach form's title row, as captured. */
const TEACH_TITLE = 'Teach auto mode about your environment?';

/** The captured 2.1.283 form's own rows, from the rule of `▔` it is drawn under down. */
const FORM_ROWS = CLAUDE_TEACH_FORM.slice(CLAUDE_TEACH_FORM.findIndex((row) => row.trim() === TEACH_TITLE) - 1);

/** The captured 2.1.289 list from the rule of `─` it is drawn under down: the list, its foot, and the input box below. */
const LIST_ROWS = CLAUDE_TEACH_LIST.slice(CLAUDE_TEACH_LIST.findIndex((row) => row.trim() === TEACH_TITLE) - 1);

/** The same rows with one row changed: not the captured list. */
const LIST_ONE_OFF = LIST_ROWS.map((row) => (row === '    2. Not now' ? '    2. Later' : row));

/**
 * The staging program, as temp-answer.test.js has it: `node stage.mjs
 * <list|form> <rows file> <keys file> <stop file>`. It draws the rows on a
 * cleared screen, writes every byte it reads to the keys file and how it ended
 * to `<keys file>.outcome`. As the list, each arrow moves its pointer among the
 * numbered rows and redraws, and only a return with the pointer on "2. Not
 * now" ends it ("not now"). As the form, Esc alone ends it ("esc"). It ends too
 * when the stop file appears ("stopped"), and after ten minutes ("timed out").
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
 * names an Orca tab or the kit's launch line: a caller outside every bot's
 * session, as the user in a plain terminal is.
 */
const outsideAnyTab = Object.fromEntries(Object.entries(process.env)
  .filter(([name]) => !name.startsWith('ORCA_') && name !== 'OBK_CLI' && name !== 'OBK_TAB_SHELL'));

/** What a command run in a session's tab sees of it: the tab's id, as the book holds it, and its handle. */
const inTab = ({ tabId, handle }) => ({ ...outsideAnyTab, ORCA_TAB_ID: tabId, ORCA_TERMINAL_HANDLE: handle });

/**
 * What a command that the session's own harness runs sees of its tab, when the
 * kit's launch line started that harness: the tab, and the launch line's mark,
 * the tab shell's pid and the CLI (#220, #408). The kit takes a Codex tab's
 * caller to be its session only with that mark. The pid stands for the
 * shell's, as test/helpers/cli.js `launchLineEnv` has it: the kit reads only
 * that the mark is there.
 */
const fromHarnessIn = (tab) => ({ ...inTab(tab), OBK_TAB_SHELL: String(process.pid), OBK_CLI: cliEntry });

/**
 * Run this checkout's `obk`, by its full path (#217, #220), outside any tab
 * unless `env` says which. The kit's own words never say "worktree". `shown`
 * is the screen a command may print back when it refuses: those rows are the
 * tab's, not the kit's, so they are taken out before the look.
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

/** The one tab an `obk --json` answer says it opened for `name`. */
function openedFor(answer, name) {
  const found = (answer.tabs ?? []).filter((entry) => entry.name === name && entry.created === true);
  assert.equal(found.length, 1, `one tab should have been opened for ${name}, got: ${JSON.stringify(answer.tabs)}`);
  return found[0];
}

/** What the book says about one of a bot's sessions right now. */
const sessionIn = (home, name) => (parse(readFileSync(path.join(home, 'sessions.yaml'), 'utf8')) ?? {}).sessions?.[name] ?? {};

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

/** Whether the rows show a row whose trimmed text is `title`, or that holds it. */
const showsTitle = (rows, title) => (rows ?? []).some((row) => row.includes(title));

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

/** Send one line into this test's own tab, with `--enter`; a gated line fails with the screen. */
function sendLine(handle, text) {
  const sent = orca(['terminal', 'send', '--terminal', handle, '--text', text, '--enter']);
  assert.equal(sent.ok, true, `orca terminal send --enter failed: ${JSON.stringify(sent.error)}.${whatIsUp(handle)}`);
}

/** A row of Claude Code's input box's rules: nothing but `─`, a name set into it aside. */
const RULE_ROW = /^\s*─{8,}/;

/**
 * The input line of a Claude tab at its plain input prompt, or why it is not
 * at one: the screen can be read, shows no question, form or menu, and its
 * lowest `❯` row is the input line, between the input box's two rules.
 */
function promptOf(handle) {
  const rows = rowsOf(handle);
  if (rows === undefined) return { why: 'its screen could not be read' };
  const screen = `\n    ${rows.join('\n    ')}`;
  if (showsTitle(rows, TEACH_TITLE)) return { why: `a Teach auto mode form is up:${screen}` };
  if (questionOn(rows) !== undefined) return { why: `a question, form or menu is up:${screen}` };
  const at = rows.findLastIndex((row) => row.trimStart().startsWith('❯'));
  if (at < 0) return { why: `no input line is on it:${screen}` };
  if (!RULE_ROW.test(rows[at - 1] ?? '') || !RULE_ROW.test(rows[at + 1] ?? '')) {
    return { why: `its lowest ❯ row is not the input line between the input box's rules:${screen}` };
  }
  return { line: rows[at], rows };
}

/** Type one line into a Claude tab of this test's own, and only at its plain input prompt. */
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

/** The name of the process in front of a tab's terminal, the way the kit finds it (tech notes, section 1). */
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
  return comm === undefined ? undefined : path.basename(comm.replace(/^-/, ''));
}

/** Whether a command name is a shell's. */
const isShell = (name) => ['zsh', 'bash', 'sh', 'fish', 'ksh', 'tcsh', 'dash'].includes(name);

/** Wait until a shell leads the tab's foreground group. */
const shellInFront = (handle) => until(
  `a shell to be in front of ${handle}`,
  MOVE_MS,
  async () => (isShell(inFront(handle) ?? '') ? true : undefined),
  () => ` In front now: ${inFront(handle) ?? '(unknown)'}.${whatIsUp(handle)}`,
);

/** A refusal: a non-zero exit with a reason and no crash. */
function refused(done, what) {
  const said = `${done.stdout}${done.stderr}`;
  assert.notEqual(done.status, 0, `${what}: the command should refuse, got: ${said}`);
  assert.notEqual(said.trim(), '', `${what}: a refusal says why`);
  assert.ok(!/^\s+at /m.test(said), `${what}: a message, not a crash: ${said}`);
  return said;
}

/** An answer that went through, naming the bot and the session. */
function answered(done, bot, session, what) {
  const said = `${done.stdout}${done.stderr}`;
  assert.equal(done.status, 0, `${what}: the command should answer: ${said}`);
  assert.ok(done.stdout.includes(bot) && done.stdout.includes(session), `${what}: it names ${bot} and ${session}: ${done.stdout}`);
  return done.stdout;
}

test('a long-lived session\'s first-run screens answered through the kit: Codex\'s hooks review with obk session trust-hooks, and the staged Teach screens with obk session answer', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-session-first-run-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', CODEX_BOT, CLAUDE_BOT].map(homeOf);
  const codexHome = homeOf(CODEX_BOT);
  const claudeHome = homeOf(CLAUDE_BOT);
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
    for (const setup of allSetups()) {
      if (!homes.includes(setup.path) || before.setups.has(setup.id) || held.has(setup.path)) continue;
      orca(['project', 'setup-delete', '--setup', setup.id]);
      deleted += 1;
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
  });

  // ---------------------------------------------------------------------------
  // 1. The fleet.
  obkJson(['init', '--bots', bots, '--harness', 'claude']);
  obkJson([
    'bot', 'create', '--bots', bots, '--name', CODEX_BOT, '--harness', 'codex',
    '--charter', `${CODEX_BOT} exists for one system test run and owns nothing.`,
  ]);
  obkJson([
    'session', 'add', '--bots', bots, '--bot', CODEX_BOT, '--name', CODEX_SESSION,
    '--prompt=You are a system test\'s bot and you own nothing. Do not run any command, read or write'
    + ' any file, or use any tool. Say nothing now and wait.',
    // The folder trusted at launch, and no hooks bypass: the review is shown.
    ...codexTrustArgs(bots, { hooks: false }),
  ]);
  obkJson([
    'bot', 'create', '--bots', bots, '--name', CLAUDE_BOT, '--harness', 'claude',
    '--charter', `${CLAUDE_BOT} exists for one system test run and owns nothing.`,
  ]);
  obkJson([
    'session', 'add', '--bots', bots, '--bot', CLAUDE_BOT, '--name', CLAUDE_SESSION, '--approval', 'ask',
    '--prompt', `You are a system test's session and you own nothing. Do not run any command, read or write any file, or use any tool. Reply now with ${READY_WORD} and nothing else, then wait.`,
  ]);

  const lead = { handle: openedFor(obkJson(['up', '--bots', bots, '--bot', CLAUDE_BOT]), CLAUDE_SESSION).terminal };
  lead.tabId = sessionIn(claudeHome, CLAUDE_SESSION).tab;
  assert.equal(typeof lead.tabId, 'string', `the premise: the book holds lead's tab, got: ${JSON.stringify(sessionIn(claudeHome, CLAUDE_SESSION))}`);
  const daily = { handle: openedFor(obkJson(['up', '--bots', bots, '--bot', CODEX_BOT]), CODEX_SESSION).terminal };
  daily.tabId = sessionIn(codexHome, CODEX_SESSION).tab;
  assert.equal(typeof daily.tabId, 'string', `the premise: the book holds daily's tab, got: ${JSON.stringify(sessionIn(codexHome, CODEX_SESSION))}`);
  // The launch wrote what daily was launched with into the book: bot.yaml's
  // extra_args for daily, as typed, which trust-hooks reads in step 4.
  const dailyInBotYaml = (parse(readFileSync(path.join(codexHome, 'bot.yaml'), 'utf8'))?.sessions ?? []).find((one) => one.name === CODEX_SESSION);
  assert.ok(Array.isArray(dailyInBotYaml?.extra_args) && dailyInBotYaml.extra_args.length > 0, `the premise: bot.yaml holds daily's extra_args, got: ${JSON.stringify(dailyInBotYaml)}`);
  assert.deepEqual(sessionIn(codexHome, CODEX_SESSION).launched_with, dailyInBotYaml.extra_args, `the book's launched_with for daily is bot.yaml's extra_args, got: ${JSON.stringify(sessionIn(codexHome, CODEX_SESSION))}`);

  // ---------------------------------------------------------------------------
  // 2. daily's hooks review, and no other question.
  const review = await until(`${CODEX_BOT}/${CODEX_SESSION} to show Codex's hooks review`, READY_MS, async () => {
    const rows = rowsOf(daily.handle);
    if (rows === undefined) return undefined;
    if (showsTitle(rows, REVIEW_TITLE)) return rows;
    const question = questionOn(rows);
    if (question !== undefined) assert.fail(`the premise: a question other than the hooks review is up in daily's tab, and nothing was typed into it:\n    ${question.join('\n    ')}`);
    return undefined;
  }, () => whatIsUp(daily.handle));
  t.diagnostic(`daily's hooks review, as Orca renders it:\n    ${review.join('\n    ')}`);

  // ---------------------------------------------------------------------------
  // 3. From lead's tab, a session of another bot: refused, daily untouched.
  const fromLead = refused(
    obk(['session', 'trust-hooks', '--bots', bots, '--bot', CODEX_BOT, '--session', CODEX_SESSION], inTab(lead), review),
    'session trust-hooks from another bot\'s session',
  );
  assert.match(fromLead, /Bot Father|bot-father/i, `the refusal names Bot Father: ${fromLead}`);
  await setTimeout(SETTLE_MS);
  const fromTitle = (rows) => (rows ?? []).slice((rows ?? []).findIndex((row) => row.includes(REVIEW_TITLE)));
  assert.deepEqual(fromTitle(rowsOf(daily.handle)), fromTitle(review), `daily's review is still up as it was.${whatIsUp(daily.handle)}`);
  assert.equal(sessionIn(codexHome, CODEX_SESSION).session, undefined, 'and the kit\'s hooks have not run: the book holds no conversation for daily');

  // ---------------------------------------------------------------------------
  // 4. Outside every bot's session, as the user: answered, gone, and the hooks ran.
  const trusted = answered(
    obk(['session', 'trust-hooks', '--bots', bots, '--bot', CODEX_BOT, '--session', CODEX_SESSION], outsideAnyTab, review),
    CODEX_BOT,
    CODEX_SESSION,
    'session trust-hooks from outside every bot\'s session',
  );
  assert.match(trusted, /Trust all and continue/, `it says it chose Trust all and continue: ${trusted}`);
  await until('the hooks review to go', MOVE_MS, async () => (showsTitle(rowsOf(daily.handle), REVIEW_TITLE) ? undefined : true), () => whatIsUp(daily.handle));
  const conversation = await until(
    'the kit\'s hooks to report daily\'s conversation to the book',
    ANSWER_MS,
    async () => {
      const id = sessionIn(codexHome, CODEX_SESSION).session;
      return typeof id === 'string' ? id : undefined;
    },
    () => ` The book's entry: ${JSON.stringify(sessionIn(codexHome, CODEX_SESSION))}.${whatIsUp(daily.handle)}`,
  );
  t.diagnostic(`daily's review answered through the kit, and its hooks ran: the book holds ${conversation}`);
  assert.equal(inFront(daily.handle), 'codex', `Codex is still in front of daily's tab.${whatIsUp(daily.handle)}`);

  // ---------------------------------------------------------------------------
  // 5. lead's folder trust, its first turn, and any real Teach form.
  const asked = await until(
    `${CLAUDE_SESSION} to show Claude Code's folder trust, or report its conversation`,
    READY_MS,
    async () => {
      if (typeof sessionIn(claudeHome, CLAUDE_SESSION).session === 'string') return { rows: null };
      const rows = rowsOf(lead.handle);
      return rows !== undefined && rows.some((row) => row.includes('Yes, I trust this folder')) ? { rows } : undefined;
    },
    () => whatIsUp(lead.handle),
  );
  if (asked.rows !== null) {
    const wrong = onlyPlainTrustOf(asked.rows, claudeHome);
    assert.equal(
      wrong,
      undefined,
      `${CLAUDE_SESSION}'s folder trust is not one this test may answer, so it answered nothing: ${wrong}.`
      + `\n  what it showed:\n    ${asked.rows.join('\n    ')}`,
    );
    sendKeys(lead.handle, '\x1b[B\r');
    t.diagnostic(`answered ${CLAUDE_SESSION}'s plain folder trust (the ruling on #451)`);
  }
  await until(
    `${CLAUDE_SESSION} to reply ${READY_WORD} and report its conversation`,
    ANSWER_MS,
    async () => (typeof sessionIn(claudeHome, CLAUDE_SESSION).session === 'string'
      && (rowsOf(lead.handle) ?? []).some((row) => row.trimStart().startsWith('⏺') && row.includes(READY_WORD)) ? true : undefined),
    () => ` The book's entry: ${JSON.stringify(sessionIn(claudeHome, CLAUDE_SESSION))}.${whatIsUp(lead.handle)}`,
  );

  const watchUntil = Date.now() + TEACH_WATCH_MS;
  let real;
  while (real === undefined && Date.now() < watchUntil) {
    const rows = rowsOf(lead.handle);
    if (showsTitle(rows, TEACH_TITLE)) real = rows;
    else await setTimeout(1000);
  }
  if (real !== undefined) {
    // No key into it, and no obk session answer on it (#240). Recorded, and left to the teardown.
    const asForm = onlyTeachFormOf(real);
    const asList = onlyTeachListOf(real);
    const matched = asForm === undefined ? 'matched by onlyTeachFormOf' : asList === undefined ? 'matched by onlyTeachListOf'
      : `matched by neither (onlyTeachFormOf: ${asForm}; onlyTeachListOf: ${asList})`;
    t.diagnostic(`real Teach form seen in ${CLAUDE_SESSION}'s tab at approval ask, ${matched}, left unanswered; what it showed:\n    ${real.join('\n    ')}`);
    t.skip(`the real Teach form is up in ${CLAUDE_SESSION}'s tab and this test sends it no key, so steps 6 and 7 cannot run: the session trust-hooks steps ran, and this run proves nothing about obk session answer.`);
    return;
  }

  /** `obk session answer` for lead, with `env`, which may print back the screen it read. */
  const answerLead = (env) => obk(
    ['session', 'answer', '--bots', bots, '--bot', CLAUDE_BOT, '--session', CLAUDE_SESSION],
    env,
    rowsOf(lead.handle) ?? [],
  );

  // ---------------------------------------------------------------------------
  // 6. A real screen that is not the form: lead at its plain input line.
  const idle = await until(
    `${CLAUDE_SESSION} to be at its plain input line`,
    MOVE_MS,
    async () => {
      const at = promptOf(lead.handle);
      return at.why === undefined ? at : undefined;
    },
    () => ` ${promptOf(lead.handle).why ?? ''}`,
  );
  const idleSaid = refused(answerLead(outsideAnyTab), 'lead at its input line');
  const drawn = idle.rows.map((row) => row.trim()).filter((row) => /[A-Za-z]{4,}/.test(row));
  assert.ok(drawn.some((row) => idleSaid.includes(row)), `the refusal says what the screen shows: ${idleSaid}\n  the screen:\n    ${drawn.join('\n    ')}`);
  await setTimeout(SETTLE_MS);
  const still = promptOf(lead.handle);
  assert.equal(still.why, undefined, `lead is still at its plain input line after the refusal: ${still.why}`);
  assert.equal(still.line, idle.line, 'its input line is as it was');

  // ---------------------------------------------------------------------------
  // 7. The staged forms, in lead's own tab once its Claude Code has quit.
  typeIntoClaude(lead.handle, '/exit');
  await shellInFront(lead.handle);
  await writeFile(stage, STAGE);
  const startStage = async (mode, rows, what) => {
    await rm(stopFile, { force: true });
    await writeFile(rowsFile, JSON.stringify(rows));
    sendLine(lead.handle, `OBK_TAB_SHELL=$$ node ${shellWord(stage)} ${mode} ${shellWord(rowsFile)} ${shellWord(keysFile)} ${shellWord(stopFile)}`);
    return until(`${what} to be drawn in ${CLAUDE_SESSION}'s tab`, MOVE_MS, async () => {
      const rows = rowsOf(lead.handle);
      return showsTitle(rows, TEACH_TITLE) ? rows : undefined;
    }, () => whatIsUp(lead.handle));
  };
  const keysRead = () => (existsSync(keysFile) ? readFileSync(keysFile, 'latin1') : undefined);
  const outcome = () => (existsSync(`${keysFile}.outcome`) ? readFileSync(`${keysFile}.outcome`, 'utf8') : undefined);
  const stopStage = async () => {
    await writeFile(stopFile, '');
    await shellInFront(lead.handle);
  };

  // 7a. The captured list, from daily's tab, a session of another bot: refused, not one byte.
  // First as a command daily's Codex runs, with the launch line's mark; then
  // from the same tab without the mark, where the kit cannot tell who asks.
  const listFirst = await startStage('list', LIST_ROWS, 'the staged captured list');
  assert.equal(onlyTeachListOf(listFirst), undefined, `the premise: the staged list, as Orca renders it, is the captured one:\n    ${listFirst.join('\n    ')}`);
  const fromDaily = refused(answerLead(fromHarnessIn(daily)), 'session answer from another bot\'s session');
  assert.match(fromDaily, /Bot Father|bot-father/i, `the refusal names Bot Father: ${fromDaily}`);
  await setTimeout(SETTLE_MS);
  assert.equal(keysRead(), '', 'the refusal sent no key into the tab: the staging program read nothing');
  assert.equal(showsTitle(rowsOf(lead.handle), TEACH_TITLE), true, 'and the staged list is still up');
  const unmarked = refused(answerLead(inTab(daily)), 'session answer from daily\'s tab without the launch line\'s mark');
  assert.match(unmarked, /cannot tell which session is asking/, `the refusal says the kit cannot tell who asks: ${unmarked}`);
  await setTimeout(SETTLE_MS);
  assert.equal(keysRead(), '', 'the refusal sent no key into the tab: the staging program read nothing');
  assert.equal(showsTitle(rowsOf(lead.handle), TEACH_TITLE), true, 'and the staged list is still up');
  await stopStage();

  // 7b. The list one row off: refused, and not one byte reaches the tab.
  const offRows = await startStage('list', LIST_ONE_OFF, 'the staged list one row off');
  assert.notEqual(onlyTeachListOf(offRows), undefined, `the premise: the staged list one row off is not the captured one:\n    ${offRows.join('\n    ')}`);
  const offSaid = refused(answerLead(outsideAnyTab), 'the staged list one row off');
  assert.match(offSaid, /2\. Later/, `the refusal prints the row that is off: ${offSaid}`);
  await setTimeout(SETTLE_MS);
  assert.equal(keysRead(), '', 'the refusal sent no key into the tab: the staging program read nothing');
  await stopStage();

  // 7c. The captured list, outside every bot's session: down, a look, return; and gone.
  const listRows = await startStage('list', LIST_ROWS, 'the staged captured list');
  assert.equal(onlyTeachListOf(listRows), undefined, `the premise: the staged list, as Orca renders it, is the captured one:\n    ${listRows.join('\n    ')}`);
  const listSaid = answered(answerLead(outsideAnyTab), CLAUDE_BOT, CLAUDE_SESSION, 'the staged list');
  assert.match(listSaid, /Not now/, `it says it chose Not now: ${listSaid}`);
  assert.equal(keysRead(), '\x1b[B\r', `the staging program read down, then return, and nothing else, got: ${JSON.stringify(keysRead())}`);
  assert.equal(outcome(), 'not now', 'and it ended on the return with its pointer on "2. Not now"');
  assert.equal(showsTitle(rowsOf(lead.handle), TEACH_TITLE), false, `the staged list has gone.${whatIsUp(lead.handle)}`);
  await shellInFront(lead.handle);

  // 7d. The 2.1.283 form's own rows: Esc alone, and gone.
  const formRows = await startStage('form', FORM_ROWS, 'the staged 2.1.283 form');
  assert.equal(onlyTeachFormOf(formRows), undefined, `the premise: the staged form, as Orca renders it, is the captured one:\n    ${formRows.join('\n    ')}`);
  const formSaid = answered(answerLead(outsideAnyTab), CLAUDE_BOT, CLAUDE_SESSION, 'the staged form');
  assert.match(formSaid, /\bEsc\b/, `it says it sent Esc: ${formSaid}`);
  assert.equal(keysRead(), '\x1b', `the staging program read Esc and nothing else, got: ${JSON.stringify(keysRead())}`);
  assert.equal(outcome(), 'esc', 'and it ended on the Esc');
  assert.equal(showsTitle(rowsOf(lead.handle), TEACH_TITLE), false, `the staged form has gone.${whatIsUp(lead.handle)}`);
  await shellInFront(lead.handle);
});
