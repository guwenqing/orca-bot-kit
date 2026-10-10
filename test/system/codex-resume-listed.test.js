// A system test, and an observation rather than a verdict: whether a Codex
// session the kit resumes is among Orca's agents straight away, with a Claude
// session as the control (#226, the live repro it asks for first). Against the
// real harnesses in the real Orca on this machine. Run it alone with
// `npm run test:system -- --yes test/system/codex-resume-listed.test.js`;
// `npm test` cannot, and no CI machine could.
//
// Seen once, on Codex 0.156.1 and Orca 1.4.209: after `obk restart` of a Codex
// session with a conversation in the book, Orca did not list it among the
// project's agents until a line was typed into it. A resumed Claude session was
// listed. Worked out, not proven: Codex fires SessionStart for a resumed thread
// only at its first turn, and Orca registers a Codex pane on SessionStart.
//
// This test records what it sees and asserts only its premises and its
// cleanup. What it does:
//
//   1. One throwaway fleet with two bots, each with one session, `main`:
//      `resume-codex` (Codex) and `resume-claude` (Claude Code, the control).
//      Each session's start prompt gives it one real turn, so the book holds
//      its conversation.
//   2. Beside the kit's own SessionStart hook, in each bot's own hooks file
//      (`.codex/hooks.json`, `.claude/settings.json`), the test puts a logger
//      of its own: a SessionStart hook that appends one line per run to a file
//      beside the bots folder, with the time, the tab it ran in (ORCA_TAB_ID)
//      and the payload the harness handed it (`source` among it). Why a logger
//      and not the book: the kit's hook writes the book only when the id
//      changes, and a resume keeps the same id, so the book cannot say whether
//      the hook ran at a resume. The logger sits in the same file under the
//      same event, so it runs when that file's SessionStart hooks run. That it
//      runs at all is a premise, checked at each session's start.
//   3. For each session, twice: `obk restart`, then, before anything is typed,
//      for up to SETTLE_MS: whether the bot folder's SessionStart hook ran in
//      the new tab since the restart, and its `source`; whether `orca worktree
//      ps --json` lists the new tab's pane among the agents of the bot's
//      project row, and what that row shows as the agent's name; and whether
//      `orca terminal show` gives the tab an `agentIdentity`. Then one short
//      line, a request to reply with a word, and once the answer is on screen,
//      the same three again, the hook still counted from the restart.
//   4. The same three are read once after each session's start turn too, as a
//      baseline for the readings themselves.
//
// All of it is printed at the end, pass or fail, as one table: harness ×
// start / restart 1 / restart 2 × before / after the typed line. Each `+Ns` is
// seconds after the restart (or, for the start, after `obk up`): for the hook,
// when it ran; for the agent row and the identity, when the watch first saw
// them, which is never earlier than the watch began. The after row also says
// when the line was typed.
//
// What it assumes about `orca worktree ps --json`, read from the Orca 1.4.215
// app bundle and not from a live answer: `result.worktrees[]` holds one row per
// project, with its `path`, and `agents[]`, each with `paneKey` (the tab id,
// a colon, then the pane's own id), `agentType`, `displayName`, `taskTitle`
// and `state`. The project's row is matched by the bot folder's path and the
// session's by its tab id at the front of `paneKey`. A shape that turns out
// otherwise shows as "no project row" or "not listed" in the table, not as a
// failure; the first `worktree ps` answering at all is a premise.
//
// The machine it runs on is someone's working machine, with their own tabs
// open. So this test, like the ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory, and
//     writes its logger and its log beside it, nowhere else; the user-level
//     ~/.codex and ~/.claude are never touched;
//   - writes down every terminal and workspace Orca already had, before it
//     creates anything;
//   - runs this checkout's `src/cli.js` by its full path, never the machine's
//     `obk`;
//   - types into none but its own tabs, and only after the suite's shared look
//     (helpers/screens.js, `waitingOn`) finds no question, form or menu on the
//     screen right before the line: anything there fails the test with the
//     screen, and nothing is typed;
//   - closes its own tabs one by one (`--terminal <handle> --tab`) and then
//     deletes its own workspaces, whatever happened, and checks afterwards that
//     it closed no tab it did not create;
//   - signals no process: a process is only ever looked at, with `ps` on one
//     pid at a time.
//
// `orca terminal close --worktree … --all` is never run here, and the helper
// refuses to run it at all.
//
// **It is attended.** The bots folder is `<tmp>/obk-system-resume-listed-*`
// (`<tmp>` is the system temp folder), and its projects show in Orca as
// `Resume Codex · temp fleet obk-system-resume-listed-…` and `Resume Claude ·
// temp fleet …`. This test answers none of the screens a harness puts up of its
// own. What to expect, in order:
//
//   1. `Bot Father daily`: Claude Code's folder trust. Nothing here waits on
//      Bot Father or writes to it. Leave it.
//   2. `Resume Codex main` (bot `resume-codex`) should ask nothing. Its session
//      is given its folder's trust at launch (#240, test/helpers/codex-trust.js):
//      `-c projects=…` and `--dangerously-bypass-hook-trust`, so Codex asks
//      neither its folder trust nor its hooks review, runs both hooks (the
//      kit's and this test's logger), and writes nothing about this folder into
//      the user's own ~/.codex/config.toml. A restart resumes it with the same
//      arguments, which the kit keeps in bot.yaml and puts on every launch line
//      (worked out from src/launch.js, not proven live). The first runs of this
//      repro, for #226, trusted the hooks through the review instead; whether
//      the bypass changes when Codex fires SessionStart on a resume is not
//      known, so a reading here that differs from #226's says so.
//   3. `Resume Claude main` (bot `resume-claude`): Claude Code's folder trust.
//      Its selection starts on `No, exit`, so it takes a down-arrow and then
//      return.
//   4. `Resume Claude main`, after a turn: Claude Code's form "Teach auto mode
//      about your environment?" may come up. Esc cancels it. The test types
//      into that tab only after a restart, before any turn, so it should not
//      stand in the way; if it does, the test fails with the screen.
//   5. Any tab, if its harness offers an update: accept it (PRD 6.5).
//
// Each restart opens a new tab with the same title. Every wait says what the
// tab is showing when it runs out of patience.
//
// It takes ten minutes or more: two sessions, each started, restarted twice,
// and asked one line after each restart, with up to SETTLE_MS of watching on
// either side of each line.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry, shellWord } from '../helpers/cli.js';
import { codexTrustArgs } from '../helpers/codex-trust.js';
import { waitingOn } from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { deleteOwnProject } from '../helpers/own-project.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/**
 * Remove the throwaway bots folder and everything the kit or this test made
 * beside it: `<bots>.prompts`, `<bots>.locks`, this test's logger and its log
 * are siblings of the bots folder, not children of it (PRD 6.3).
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

/** How long a real agent is given to answer before the test gives up on it. */
const ANSWER_MS = 240000;

/** How long a tab is given to be ready for a line, a person answering its first-run screens included. */
const READY_MS = 180000;

/**
 * How long each reading watches for the hook, the agent row and the identity
 * before it writes down what it has. Long enough for a harness that registers
 * late but on its own; the issue's case never registered until a line went in.
 */
const SETTLE_MS = 45000;

/** How many rows `worktree ps` is asked for: the owner's machine has many projects, this test's are new. */
const PS_LIMIT = 1000;

/**
 * Ask Orca something and read its JSON. Never the blanket close, on any road.
 * Every tab it closes is counted as this test's, for the check at the end (#246).
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

/** Run `obk ... --json` and read the answer it printed. */
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
  return answer.ok === true ? JSON.stringify(answer.result) : '';
}

/** What the tab is showing, for the message of a wait that ran out. */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  return [
    blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`,
    ' This test answers nothing a tab asks; if it is a first-run screen, answer it in Orca and run again.',
    `\n  orca terminal read --terminal ${handle} --screen\n  ${screenOf(handle).slice(0, 2000)}`,
  ].join('');
}

/**
 * Wait until a tab will take a line: Orca's wait is satisfied with no reason
 * named, and the suite's shared look finds no question, form or menu on its
 * screen (#329, #416). Nothing is typed here; this only waits.
 */
async function readyForALine(handle, within = READY_MS) {
  await until(
    `${handle} to be past the screens of its own`,
    within,
    async () => {
      const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '5000']);
      if (answer.ok !== true) return undefined;
      if (answer.result?.wait?.blockedReason !== undefined) return undefined;
      return waitingOn(orca, handle) === undefined ? true : undefined;
    },
    () => `${waitingOn(orca, handle) ?? ''}${whatIsUp(handle)}`,
  );
}

/**
 * Type one line into one of this test's own tabs and submit it, and only when
 * the shared look finds nothing on the screen for a return to answer, looked
 * at right before the line goes. Otherwise fail with the screen, having typed
 * nothing.
 */
function typeInto(handle, text) {
  const why = waitingOn(orca, handle);
  assert.equal(why, undefined, `this test would type ${JSON.stringify(text)} into ${handle}, but${why}\n  Nothing was typed.`);
  const sent = orca(['terminal', 'send', '--terminal', handle, '--text', text, '--enter']);
  if (sent.ok === true) return;
  assert.fail(`orca terminal send --enter failed: ${JSON.stringify(sent.error)}. Type \`${text}\` into that tab yourself and run the test again.${whatIsUp(handle)}`);
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

/** The command line of one process, word by word. */
const argvOf = (pid) => (psOf(pid, ['-ww', '-o', 'command=']) ?? '').split(/\s+/);

// ------------------------------------------------------------- the logger

/**
 * The logger hook: one JSON line per run, appended to the file it is handed,
 * with the time, the tab it ran in and what the harness gave it on stdin. It
 * prints nothing, so it puts nothing into the session.
 */
const LOGGER = [
  "import { appendFileSync, readFileSync } from 'node:fs';",
  '',
  'let payload = null;',
  'try {',
  "  payload = JSON.parse(readFileSync(0, 'utf8'));",
  '} catch {',
  '  payload = null;',
  '}',
  "appendFileSync(process.argv[2], `${JSON.stringify({ at: Date.now(), tab: process.env.ORCA_TAB_ID ?? null, payload })}\\n`);",
  '',
].join('\n');

/** Where each harness reads a project's hooks, inside the bot folder (src/hooks.js). */
const HOOKS_FILE = { codex: path.join('.codex', 'hooks.json'), claude: path.join('.claude', 'settings.json') };

/**
 * Put the logger in one bot's own hooks file, under SessionStart, as a group
 * of its own beside whatever the file already holds. The kit keeps a hook of
 * the user's beside its own (src/hooks.js), so `up` and `restart` leave it.
 */
async function addLogger(home, harness, command) {
  const file = path.join(home, HOOKS_FILE[harness]);
  const settings = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : {};
  const hooks = settings.hooks ?? {};
  const wanted = {
    ...settings,
    hooks: { ...hooks, SessionStart: [...(hooks.SessionStart ?? []), { hooks: [{ type: 'command', command, timeout: 10 }] }] },
  };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(wanted, null, 2)}\n`);
}

/** The logger's lines from one tab since `since`, oldest first. */
function hookRunsIn(log, tabId, since) {
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8').split('\n')
    .filter((line) => line.trim() !== '')
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    })
    .filter((run) => run.tab === tabId && run.at >= since)
    .sort((a, b) => a.at - b.at);
}

// ------------------------------------------------------------- Orca's agents

/** One path, and the same without macOS's `/private` in front, for comparing Orca's paths with the kit's. */
const unprivate = (at) => String(at).replace(/^\/private(?=\/)/, '');

/**
 * What `orca worktree ps --json` says about one tab: whether the bot's project
 * has a row, how many agents it lists, and the tab's own agent row, if any, as
 * `{ agentType, displayName, taskTitle, state }`. Anything else in the answer
 * belongs to other people's projects and is not kept.
 */
function psOfTab(home, tabId) {
  const answer = orca(['worktree', 'ps', '--limit', String(PS_LIMIT)]);
  if (answer.ok !== true) return { error: answer.error?.code ?? 'refused' };
  const rows = Array.isArray(answer.result?.worktrees) ? answer.result.worktrees : [];
  const project = rows.find((row) => unprivate(row?.path) === unprivate(home));
  if (project === undefined) return { project: false, truncated: answer.result?.truncated === true };
  const agents = Array.isArray(project.agents) ? project.agents : [];
  const mine = agents.filter((agent) => typeof agent?.paneKey === 'string' && agent.paneKey.startsWith(`${tabId}:`));
  const row = mine[0] === undefined
    ? undefined
    : { agentType: mine[0].agentType ?? null, displayName: mine[0].displayName ?? null, taskTitle: mine[0].taskTitle ?? null, state: mine[0].state ?? null };
  return { project: true, agents: agents.length, rows: mine.length, row };
}

/** What Orca names as the tab's agent right now. */
function identityOf(handle) {
  const shown = orca(['terminal', 'show', '--terminal', handle]);
  if (shown.ok !== true) return { error: shown.error?.code ?? 'refused' };
  const agent = shown.result?.terminal?.agentIdentity;
  return { agent: typeof agent === 'string' && agent !== '' ? agent : null };
}

/**
 * Watch one tab for up to SETTLE_MS, and write down the three things #226 asks
 * about: the bot folder's SessionStart hook in that tab since `since` (the
 * restart, or the start), the tab's agent row in `worktree ps`, and its
 * `agentIdentity`. Stops as soon as all three are there. Each carries how long
 * after `since` it was first seen; the row and the identity are looked for
 * only from the moment the watch begins.
 */
async function observe({ log, home, entry, since }) {
  const stop = Date.now() + SETTLE_MS;
  const first = { ps: null, identity: null };
  let ps;
  let identity;
  let runs;
  for (;;) {
    runs = hookRunsIn(log, entry.tabId, since);
    ps = psOfTab(home, entry.tabId);
    identity = identityOf(entry.terminal);
    if (first.ps === null && ps.row !== undefined) first.ps = { ms: Date.now() - since, row: ps.row };
    if (first.identity === null && identity.agent) first.identity = { ms: Date.now() - since, agent: identity.agent };
    if ((runs.length > 0 && first.ps !== null && first.identity !== null) || Date.now() >= stop) break;
    await setTimeout(1000);
  }
  return {
    hook: runs.map((run) => ({ ms: run.at - since, source: run.payload?.source ?? null, session: run.payload?.session_id ?? null })),
    ps,
    firstPs: first.ps,
    identity,
    firstIdentity: first.identity,
  };
}

/** Seconds, for the table. */
const secs = (ms) => `+${Math.round(ms / 1000)}s`;

/** One reading as the table's cells. */
function cellsOf(seen) {
  const hook = seen.hook.length === 0
    ? 'no'
    : `yes ×${seen.hook.length} (${seen.hook.map((run) => `${run.source ?? 'no source'} ${secs(run.ms)}`).join(', ')})`;

  let listed;
  if (seen.ps.error !== undefined) listed = `ps failed: ${seen.ps.error}`;
  else if (seen.ps.project === false) listed = `no project row${seen.ps.truncated ? ' (answer truncated)' : ''}`;
  else if (seen.firstPs === null) listed = `not listed (project lists ${seen.ps.agents} agent(s))`;
  else {
    const { row } = seen.firstPs;
    listed = `listed ${secs(seen.firstPs.ms)}: type=${row.agentType} name=${JSON.stringify(row.displayName)} title=${JSON.stringify(row.taskTitle)} state=${row.state}`
      + (seen.ps.row === undefined ? '; gone by the end of the watch' : '');
  }

  let identity;
  if (seen.firstIdentity !== null) identity = `${seen.firstIdentity.agent} ${secs(seen.firstIdentity.ms)}`;
  else identity = seen.identity.error !== undefined ? `show failed: ${seen.identity.error}` : 'none';

  return [hook, listed, identity];
}

/** The whole record as one table, a line per row, columns padded. */
function tableOf(records) {
  const rows = [
    ['harness', 'when', 'phase', 'SessionStart hook in the tab', 'worktree ps agent row', 'agentIdentity'],
    ...records.map((record) => [record.harness, record.when, record.phase, ...cellsOf(record.seen)]),
  ];
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  return rows.map((row) => row.map((cell, column) => cell.padEnd(widths[column])).join(' | ').trimEnd());
}

// ------------------------------------------------------------- the bots

const SESSION = 'main';

/**
 * The two bots. `ready` is what the start turn is asked to reply, in lower
 * case; `rounds` the word each restart's line asks for, one per restart. Each
 * word is only where the test puts it, and only ever typed in upper case, so its
 * lower-case form on screen is the answer and not the echo of the question.
 */
const BOTS = [
  { name: 'resume-codex', harness: 'codex', ready: 'READY-4417', rounds: ['PLOVER-5521', 'MARTEN-8830'] },
  { name: 'resume-claude', harness: 'claude', ready: 'READY-6093', rounds: ['HERON-3372', 'OTTER-1948'] },
];

/** What each session is told: one turn now, a word when asked, and nothing else. */
const promptOf = (ready) => [
  "You are a system test's bot and you own nothing.",
  'Do nothing that is not written here: run no command, read no file and write nothing.',
  `Reply now with ${ready} in lower case and nothing else.`,
  'Whenever you are asked to reply with a word, reply with exactly that word in the form asked for and nothing else.',
  'If a line arrives saying fleet mail is waiting, ignore it.',
  'Otherwise say nothing and wait.',
].join(' ');

/** The line typed after a restart: harmless, and its answer is a word nothing else puts on screen. */
const lineFor = (word) => `Reply with the word ${word} in lower case and nothing else.`;

test('a resumed Codex session, with a resumed Claude one as the control: is it among Orca\'s agents before and after one typed line, twice (observed, not judged)', async (t) => {
  // The premise every reading stands on: Orca answers `worktree ps` with rows.
  const firstPs = orca(['worktree', 'ps', '--limit', String(PS_LIMIT)]);
  assert.equal(firstPs.ok, true, `the premise: orca worktree ps answers; it was refused with error code ${JSON.stringify(firstPs.error?.code ?? null)}`);
  assert.ok(Array.isArray(firstPs.result?.worktrees), 'the premise: orca worktree ps --json answers a list of rows under result.worktrees');

  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-resume-listed-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', ...BOTS.map((bot) => bot.name)].map(homeOf);
  const logger = `${bots}.session-start-logger.mjs`;
  const log = `${bots}.session-start.jsonl`;
  const records = [];

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    for (const line of tableOf(records)) t.diagnostic(line);

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

  await writeFile(logger, LOGGER);
  const loggerCommand = `${shellWord(process.execPath)} ${shellWord(logger)} ${shellWord(log)} 2>/dev/null || true`;

  obkJson(['init', '--bots', bots, '--harness', 'claude']);
  for (const bot of BOTS) {
    obkJson([
      'bot', 'create', '--bots', bots, '--name', bot.name, '--harness', bot.harness,
      '--charter', `${bot.name} exists for one system test run and owns nothing.`,
    ]);
    obkJson([
      'session', 'add', '--bots', bots, '--bot', bot.name, '--name', SESSION, `--prompt=${promptOf(bot.ready)}`,
      ...(bot.harness === 'codex' ? codexTrustArgs(bots) : []),
    ]);
    await addLogger(homeOf(bot.name), bot.harness, loggerCommand);
  }

  // 1. Each session starts and has its one turn: the book holds its id, the
  // answer is on screen, and the logger ran in its tab with that id.
  const ids = {};
  for (const bot of BOTS) {
    const home = homeOf(bot.name);
    const since = Date.now();
    const entry = tabOf(obkJson(['up', '--bots', bots, '--bot', bot.name, '--session', SESSION]), SESSION);
    assert.equal(entry.created, true, `the premise: up opened a tab for ${bot.name} ${SESSION}`);
    ids[bot.name] = await until(
      `${bot.name} ${SESSION} to report its session id to the book`,
      READY_MS,
      async () => (await sessionIn(home, SESSION)).session,
      () => ` The kit's hook has not run. On Codex, a \`Hooks need review\` screen here means the launch-time trust did not take (#240).${whatIsUp(entry.terminal)}`,
    );
    await until(
      `${bot.name}'s start turn to answer ${bot.ready.toLowerCase()}`,
      ANSWER_MS,
      async () => (screenOf(entry.terminal).includes(bot.ready.toLowerCase()) ? true : undefined),
      () => whatIsUp(entry.terminal),
    );
    await until(
      `the logger to have run in ${entry.title} with the book's id`,
      ANSWER_MS,
      async () => (hookRunsIn(log, entry.tabId, since).some((run) => run.payload?.session_id === ids[bot.name]) ? true : undefined),
      () => ` The test's SessionStart logger in ${path.join(home, HOOKS_FILE[bot.harness])} has not run in this tab with id ${ids[bot.name]}, so its readings below would say nothing.${whatIsUp(entry.terminal)}`,
    );
    records.push({ harness: bot.harness, when: 'start', phase: 'after the start turn', seen: await observe({ log, home, entry, since }) });
  }

  // 2. Each session, twice: restart, watch, one line, watch.
  for (const round of [0, 1]) {
    for (const bot of BOTS) {
      const home = homeOf(bot.name);
      const when = `restart ${round + 1}`;

      const since = Date.now();
      const restarted = obkJson(['restart', '--bots', bots, '--bot', bot.name, '--session', SESSION]);
      guard.closedByKit(restarted.closed);
      const entry = tabOf(restarted, SESSION);
      assert.equal(entry.created, true, `the premise: ${when} of ${bot.name} opened a new tab`);

      // The premise: the harness in front of the new tab was told to resume
      // the conversation the book holds.
      const front = await until(
        `${bot.harness} to be in front of ${entry.title} after ${when}`,
        READY_MS,
        async () => {
          const found = inFront(entry.terminal);
          return found?.name === bot.harness ? found : undefined;
        },
        () => ` In front now: ${JSON.stringify(inFront(entry.terminal) ?? null)}.${whatIsUp(entry.terminal)}`,
      );
      assert.ok(
        argvOf(front.pid).includes(ids[bot.name]),
        `the premise: the ${bot.harness} in front of ${entry.title} after ${when} (pid ${front.pid}) resumes the book's conversation ${ids[bot.name]}`,
      );
      await readyForALine(entry.terminal);

      records.push({ harness: bot.harness, when, phase: 'before the line', seen: await observe({ log, home, entry, since }) });

      const word = bot.rounds[round];
      const answer = word.toLowerCase();
      assert.ok(!screenOf(entry.terminal).includes(answer), `the premise: ${answer} is not on ${entry.title}'s screen before it was asked for`);
      const typed = Date.now();
      typeInto(entry.terminal, lineFor(word));
      await until(`${entry.title} to answer ${answer}`, ANSWER_MS, async () => (screenOf(entry.terminal).includes(answer) ? true : undefined), () => whatIsUp(entry.terminal));

      records.push({ harness: bot.harness, when, phase: `after the line (typed ${secs(typed - since)})`, seen: await observe({ log, home, entry, since }) });
    }
  }
});
