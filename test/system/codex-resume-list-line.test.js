// A system test: a Codex session the kit resumes is among Orca's agents
// straight away, by the kit's own line, with nothing typed by anyone else
// (#226, the check after the fix). Against the real Codex in the real Orca on
// this machine. Run it alone with
// `npm run test:system -- --yes test/system/codex-resume-list-line.test.js`;
// `npm test` cannot, and no CI machine could.
//
// The repro (test/system/codex-resume-listed.test.js, Codex 0.157.1, Orca
// 1.4.215) showed that a resumed Codex thread fires SessionStart only at its
// first turn, and Orca lists the pane only then. So `up`, `restart` and
// `unpause` now type one line, LIST_LINE, into a Codex session they have just
// resumed. This test resumes one Codex session three times, once through each
// command, and after each it requires:
//
//   1. the command's `--json` entry for the tab says `listLine: true`;
//   2. `orca worktree ps --json` lists the new tab's pane among the agents of
//      the bot's project row within LISTED_MS of the command returning;
//   3. the conversation holds LIST_LINE as the only user turn since the command
//      began, and an answer after it. That is read from Codex's own record of
//      the conversation, its rollout (see below), not from the screen, which
//      shows the conversation's history again on every resume.
//
// And it records, as a diagnostic, what the agent row shows as the agent's
// name (the repro found `displayName` and `taskTitle` null) and what the
// session answered (LIST_LINE asks for "ok"; the words are the model's, so
// they are recorded, not required).
//
// The test types nothing into any tab. The session's one turn before the first
// resume is its start prompt, on the kit's own launch line; every line after
// that is the kit's.
//
// The flow, one Codex bot `list-codex` with one session `main`:
//
//   0. `obk up`: a fresh start. Its start prompt gives it one turn, so the book
//      holds its conversation and Codex has it on record.
//   1. `obk restart --session main`: resumed in a new tab.
//   2. The tab closed by this test, by its own handle, then `obk up`: resumed in
//      a new tab.
//   3. `obk pause`, then `obk unpause`: resumed in a new tab.
//
// Codex's record. Codex writes every conversation to
// `~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-<stamp>-<id>.jsonl`, and a user
// turn there is a `response_item` message with role `user` and `input_text`
// content (tech notes, section 3; the kit reads it the same way,
// src/conversations.js). This test only reads there: the names under that
// folder, to find the files of its own conversation by id, and those files
// alone. Before each command it notes how many whole lines each of them holds,
// and afterwards reads only the lines added since, so it reads the same way
// whether a resume appends to the file or starts another. Codex also puts
// context of its own into user messages (its AGENTS.md instructions, and
// blocks such as `<environment_context>`); a user message that begins
// `# AGENTS.md instructions` or `<` counts as Codex's, not as a typed line.
// Every user message seen is printed as a diagnostic, its first words only,
// so a shape this reading did not expect shows in the run.
//
// The machine it runs on is someone's working machine, with their own tabs
// open. So this test, like the ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory;
//   - writes down every terminal and workspace Orca already had, before it
//     creates anything;
//   - runs this checkout's `src/cli.js` by its full path, never the machine's
//     `obk`;
//   - types into no tab at all, and closes only its own, one by one
//     (`--terminal <handle> --tab`), then deletes its own workspaces, whatever
//     happened, and checks afterwards that it closed no tab it did not create;
//   - never writes to ~/.codex or ~/.claude, and signals no process.
//
// `orca terminal close --worktree … --all` is never run here, and the helper
// refuses to run it at all.
//
// **It is attended.** The bots folder is `<tmp>/obk-system-list-line-*`
// (`<tmp>` is the system temp folder), and the bot's project shows in Orca as
// `List Codex · temp fleet obk-system-list-line-…`. This test answers none of
// the screens a harness puts up of its own. What to expect:
//
//   1. `Bot Father daily`: Claude Code's folder trust. Nothing here waits on
//      Bot Father. Leave it.
//   2. `List Codex main` (bot `list-codex`) should ask nothing. Its session is
//      given its folder's trust at launch (#240, test/helpers/codex-trust.js),
//      so Codex asks neither its folder trust nor its hooks review, still runs
//      the kit's hook, and writes nothing about this folder into the user's own
//      ~/.codex/config.toml. Each resume carries the same arguments, which the
//      kit keeps in bot.yaml and puts on every launch line (worked out from
//      src/launch.js, not proven live).
//   3. Any tab, if its harness offers an update: accept it (PRD 6.5).
//
// Each resume opens a new tab with the same title, `List Codex main`. A
// resumed tab should ask nothing; if one does, the kit types nothing into it,
// the command's entry says `listLine: false` with why, and the test fails
// with that.
//
// It takes five to ten minutes: one start and three resumes, each with a turn.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry } from '../helpers/cli.js';
import { codexTrustArgs } from '../helpers/codex-trust.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { deleteOwnProject } from '../helpers/own-project.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/**
 * Remove the throwaway bots folder and everything the kit made beside it:
 * `<bots>.prompts`, `<bots>.locks` and the rest are siblings of the bots
 * folder, not children of it (PRD 6.3).
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

/** How long a tab is given to be past its first-run screens, a person answering them included. */
const READY_MS = 180000;

/** How long after the command returns the pane has to be among the project's agents (the repro saw ~5 s after a line). */
const LISTED_MS = 60000;

/** How many rows `worktree ps` is asked for: the owner's machine has many projects, this test's is new. */
const PS_LIMIT = 1000;

/** The line the kit types into a Codex session it has just resumed, as the architect ruled it on #226. */
const LIST_LINE = 'obk: this session was resumed in a new tab, and this line is only so Orca lists it. Reply "ok"; nothing else is asked.';

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

// ------------------------------------------------------------- Orca's agents

/** One path, and the same without macOS's `/private` in front, for comparing Orca's paths with the kit's. */
const unprivate = (at) => String(at).replace(/^\/private(?=\/)/, '');

/**
 * The tab's own agent row in `orca worktree ps --json`, as `{ agentType,
 * displayName, taskTitle, state }`, or undefined when the bot's project lists
 * none for it. The row is the project's by its path, the agent the tab's by its
 * id at the front of `paneKey` (seen live in the repro). Anything else in the
 * answer is other people's and is not kept.
 */
function agentRowOf(home, tabId) {
  const answer = orca(['worktree', 'ps', '--limit', String(PS_LIMIT)]);
  if (answer.ok !== true) return undefined;
  const rows = Array.isArray(answer.result?.worktrees) ? answer.result.worktrees : [];
  const project = rows.find((row) => unprivate(row?.path) === unprivate(home));
  const agent = (Array.isArray(project?.agents) ? project.agents : [])
    .find((one) => typeof one?.paneKey === 'string' && one.paneKey.startsWith(`${tabId}:`));
  if (agent === undefined) return undefined;
  return { agentType: agent.agentType ?? null, displayName: agent.displayName ?? null, taskTitle: agent.taskTitle ?? null, state: agent.state ?? null };
}

// ------------------------------------------------------------- Codex's record

/** Where Codex keeps its record of every conversation (tech notes, section 3). */
const CODEX_SESSIONS = path.join(os.homedir(), '.codex', 'sessions');

/** The files of one conversation's record, found by its id in their names. Only names are read to find them. */
function rolloutFilesOf(id) {
  if (!existsSync(CODEX_SESSIONS)) return [];
  return readdirSync(CODEX_SESSIONS, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith(`-${id}.jsonl`))
    .map((name) => path.join(CODEX_SESSIONS, name));
}

/** The whole lines of one file: a line still being written is not one yet. */
function wholeLinesOf(file) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  lines.pop();
  return lines;
}

/** How many whole lines each file of the conversation's record holds now. */
const recordMark = (id) => new Map(rolloutFilesOf(id).map((file) => [file, wholeLinesOf(file).length]));

/**
 * The messages the conversation's record gained since `mark`, in order, as
 * `{ role, text }`: a user's `input_text`, the model's `output_text`. A line
 * whose own `timestamp` is before `since` is left out too, in case a resume
 * starts a new file with the history copied into it.
 */
function messagesSince(id, mark, since) {
  return rolloutFilesOf(id).flatMap((file) => wholeLinesOf(file).slice(mark.get(file) ?? 0))
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    })
    .filter((entry) => !(Date.parse(entry?.timestamp) < since))
    .flatMap((entry) => {
      const item = entry?.type === 'response_item' ? entry.payload : undefined;
      if (item?.type !== 'message' || !Array.isArray(item.content)) return [];
      const text = item.content
        .filter((block) => block?.type === 'input_text' || block?.type === 'output_text')
        .map((block) => String(block.text))
        .join('\n');
      return [{ role: item.role, text }];
    });
}

/** A user message Codex puts in itself: its AGENTS.md instructions, or a block such as `<environment_context>`. */
const codexOwn = (text) => text.trimStart().startsWith('<') || text.trimStart().startsWith('# AGENTS.md instructions');

// ------------------------------------------------------------- the bot

const BOT = { name: 'list-codex', title: 'List Codex main' };
const SESSION = 'main';

/** In the start prompt only, and asked for in lower case, so its echo is not its answer. */
const READY = 'READY-7253';

/** What the session is told: one turn now, a short answer to anything after, and nothing else. */
const startPrompt = [
  "You are a system test's bot and you own nothing.",
  'Do nothing that is not written here: run no command, read no file and write nothing.',
  `Reply now with ${READY} in lower case and nothing else.`,
  'Answer any later line as briefly as it asks, and do nothing else.',
  'If a line arrives saying fleet mail is waiting, ignore it.',
].join(' ');

test('a Codex session resumed by up, restart and unpause is among Orca\'s agents by the kit\'s own line, with nothing else typed', async (t) => {
  // The premise every listing below stands on: Orca answers `worktree ps` with rows.
  const firstPs = orca(['worktree', 'ps', '--limit', String(PS_LIMIT)]);
  assert.equal(firstPs.ok, true, `the premise: orca worktree ps answers; it was refused with error code ${JSON.stringify(firstPs.error?.code ?? null)}`);
  assert.ok(Array.isArray(firstPs.result?.worktrees), 'the premise: orca worktree ps --json answers a list of rows under result.worktrees');

  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-list-line-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', BOT.name].map(homeOf);
  const home = homeOf(BOT.name);

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
  obkJson([
    'bot', 'create', '--bots', bots, '--name', BOT.name, '--harness', 'codex',
    '--charter', `${BOT.name} exists for one system test run and owns nothing.`,
  ]);
  obkJson(['session', 'add', '--bots', bots, '--bot', BOT.name, '--name', SESSION, `--prompt=${startPrompt}`, ...codexTrustArgs(bots)]);

  // 0. A fresh start, and its one turn: the book holds the conversation and
  // Codex has it on record, which is what a resume picks up.
  const started = tabOf(obkJson(['up', '--bots', bots, '--bot', BOT.name, '--session', SESSION]), SESSION);
  assert.equal(started.created, true, 'the premise: up opened a tab');
  const id = await until(
    `${BOT.title} to report its session id to the book`,
    READY_MS,
    async () => (await sessionIn(home, SESSION)).session,
    () => ` The kit's hook has not run. A \`Hooks need review\` screen here means the launch-time trust did not take (#240).${whatIsUp(started.terminal)}`,
  );
  await until(
    `the start turn to answer ${READY.toLowerCase()}`,
    ANSWER_MS,
    async () => (screenOf(started.terminal).includes(READY.toLowerCase()) ? true : undefined),
    () => whatIsUp(started.terminal),
  );
  await until(
    `Codex's record of conversation ${id} under ${CODEX_SESSIONS}`,
    ANSWER_MS,
    async () => (rolloutFilesOf(id).length > 0 ? true : undefined),
  );

  let live = started;

  /** The three resumes: each makes the tab it resumes in, and gives back the command's entry for it. */
  const resumes = [
    ['restart', () => {
      const answer = obkJson(['restart', '--bots', bots, '--bot', BOT.name, '--session', SESSION]);
      guard.closedByKit(answer.closed);
      return tabOf(answer, SESSION);
    }],
    ['up, after its tab was closed', async () => {
      orca(['terminal', 'close', '--terminal', live.terminal, '--tab']);
      assert.deepEqual(
        (await terminalsAfterClosing(home, [live.terminal])).filter((terminal) => terminal.handle === live.terminal),
        [],
        `the premise: Orca no longer lists the tab this test closed, ${live.terminal}`,
      );
      return tabOf(obkJson(['up', '--bots', bots, '--bot', BOT.name, '--session', SESSION]), SESSION);
    }],
    ['unpause', () => {
      const paused = obkJson(['pause', '--bots', bots, '--bot', BOT.name]);
      guard.closedByKit(paused.closed);
      return tabOf(obkJson(['unpause', '--bots', bots, '--bot', BOT.name]), SESSION);
    }],
  ];

  for (const [how, resume] of resumes) {
    const mark = recordMark(id);
    const began = Date.now();
    const entry = await resume();
    const returned = Date.now();
    live = entry;

    // The premises: a new tab, and the conversation the book holds, resumed.
    assert.equal(entry.created, true, `${how}: the premise: a new tab, got: ${JSON.stringify(entry)}`);
    assert.equal(entry.resumed, true, `${how}: the premise: the conversation was resumed, got: ${JSON.stringify(entry)}`);

    // 1. The kit says it typed its line.
    assert.equal(
      entry.listLine,
      true,
      `${how}: the kit should have typed its line, and says ${JSON.stringify(entry.listLine)}: ${entry.listLineTrouble ?? 'no reason given'}.${whatIsUp(entry.terminal)}`,
    );

    // 2. Orca lists the pane among the project's agents, within LISTED_MS.
    const row = await until(
      `${how}: the new tab ${entry.tabId} among the agents of ${BOT.name}'s project in orca worktree ps`,
      LISTED_MS,
      async () => agentRowOf(home, entry.tabId),
      () => whatIsUp(entry.terminal),
    );
    const listedMs = Date.now();
    t.diagnostic(
      `${how}: listed ${Math.round((listedMs - returned) / 1000)}s after the command returned (${Math.round((listedMs - began) / 1000)}s after it began);`
      + ` agent row type=${row.agentType} name=${JSON.stringify(row.displayName)} title=${JSON.stringify(row.taskTitle)} state=${row.state}`,
    );

    // 3. The conversation holds the kit's line as the only line typed since
    // the command began, and an answer after it.
    const messages = await until(
      `${how}: an answer after the kit's line in Codex's record of ${id}`,
      ANSWER_MS,
      async () => {
        const seen = messagesSince(id, mark, began);
        const at = seen.findIndex((message) => message.role === 'user' && message.text.trim() === LIST_LINE);
        return at >= 0 && seen.slice(at + 1).some((message) => message.role === 'assistant') ? seen : undefined;
      },
      () => ` Messages since the command began: ${JSON.stringify(messagesSince(id, mark, began).map((message) => ({ role: message.role, text: message.text.slice(0, 80) })))}`,
    );
    for (const message of messages) t.diagnostic(`${how}: ${message.role}: ${JSON.stringify(message.text.slice(0, 80))}`);
    const typed = messages.filter((message) => message.role === 'user' && !codexOwn(message.text)).map((message) => message.text.trim());
    assert.deepEqual(typed, [LIST_LINE], `${how}: the kit's line is the only line typed into the session since the command began`);
    const answer = messages.slice(messages.findIndex((message) => message.text.trim() === LIST_LINE) + 1).find((message) => message.role === 'assistant');
    t.diagnostic(`${how}: the session answered ${JSON.stringify(answer.text.slice(0, 80))}${/\bok\b/i.test(answer.text) ? '' : ' (not "ok")'}`);
  }
});
