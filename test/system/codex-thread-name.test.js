// A system test: a Codex session the kit starts has its thread named
// `<bot>.<session>`, so its tab's title says which bot and session it is
// (#480). Against the real Codex in the real Orca on this machine. Run it alone
// with `npm run test:system -- --yes test/system/codex-thread-name.test.js`;
// `npm test` cannot, and no CI machine could.
//
// Codex 0.160.0 titles its tab with its thread's name when idle, and has no
// launch-time way to set one. So the kit's async Codex `Stop` hook runs
// `obk session name` at each turn end, which types Codex's own
// `/rename <bot>.<session>` once the session is idle, through #391's safe
// path, and confirms it in Codex's record of names,
// `~/.codex/session_index.jsonl` (the architect's ruling on #480). This test
// is the issue's live done check, one Codex bot `name-codex` with one session
// `main`:
//
//   1. `obk up` brings the session up with a short start prompt, which gives
//      it one turn.
//   2. After that turn ends, within NAMED_MS, its tab's title in `orca
//      terminal list` contains `name-codex.main`, and the newest line for its
//      thread in session_index.jsonl names it so.
//   3. `obk restart` of the session. After the turn the kit's list line starts
//      (src/up.js LIST_LINE, #226) ends, the new tab's title again contains
//      `name-codex.main`, within NAMED_MS.
//   4. After each, it prints what the kit typed into the tab, if anything, as
//      the tab's output shows it (`orca terminal read`, its stream), so the
//      run's record holds it. It also checks Codex took `/rename` as its own
//      command: no user turn in the conversation's record holds it.
//   5. Every wait that runs out prints the tab's screen.
//
// For #713 the kit writes `/rename <bot>.<session>` in one `orca terminal
// send`, not one character a send. The architect requires this run, on Codex
// 0.164.0, to show three things. It prints the version Codex wrote in the
// conversation's record.
//
//   a. The one write runs as a command: 2 and 4 above.
//   b. No paste-style input is left standing: after the name is confirmed in
//      step 2, the tab's input line is empty, its placeholder or a bare `›`,
//      with no draft from Orca, within EMPTY_MS. Otherwise it fails and
//      prints the screen and the draft.
//   c. What the kit's line check sees when text stands under the input line.
//      After a and b, before the restart, the test writes into its own tab,
//      in one `orca terminal send` with no enter, `/rename name-codex.main`
//      and then Orca's mail notice as Orca writes it, with a made-up Run id,
//      `run_probe713`. About 1 s later it reads the screen and Orca's draft
//      and prints both whole, so the run's record holds the capture. Then it
//      takes it all back, one backspace per character written, in one send,
//      and checks that the input line is empty again and that no user turn in
//      the record holds the notice. It never presses Enter there.
//
// Codex's records. This test only reads them, never writes them: the names
// under `~/.codex/sessions` to find its own conversation's rollout by id, those
// files alone, and `~/.codex/session_index.jsonl`, of which it keeps only the
// lines for its own thread. The rename itself is Codex's own write, the one
// line `/rename` appends to session_index.jsonl for this test's throwaway
// thread; it is the behaviour under test.
//
// The machine it runs on is someone's working machine, with their own tabs
// open. So this test, like the ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory;
//   - writes down every terminal and workspace Orca already had, before it
//     creates anything;
//   - runs this checkout's `src/cli.js` by its full path, never the machine's
//     `obk`;
//   - types into its own throwaway Codex tab only, and only for c above: the
//     command and Orca's notice in one write, then the backspaces that take
//     them back, so the run records what the kit's line check sees (#713). It
//     types into no other tab at all;
//   - closes only its own tabs, one by one (`--terminal <handle> --tab`), then
//     deletes its own workspaces, whatever happened, and checks afterwards
//     that it closed no tab it did not create;
//   - signals no process.
//
// `orca terminal close --worktree … --all` is never run here, and the helper
// refuses to run it at all.
//
// **It is attended.** The bots folder is `<tmp>/obk-system-thread-name-*`.
// This test answers none of the screens a harness puts up of its own. What to
// expect:
//
//   1. `Bot Father daily`: Claude Code's folder trust. Nothing here waits on
//      Bot Father. Leave it.
//   2. `Name Codex main` should ask nothing. Its session is given its folder's
//      trust at launch (#240, test/helpers/codex-trust.js), so Codex asks
//      neither its folder trust nor its hooks review, and still runs the kit's
//      hooks.
//   3. Any tab, if its harness offers an update: do not take it. It updates
//      that harness for the whole machine (#581, #618).
//
// It takes a few minutes: one start and one restart, each with a turn.

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

/**
 * How long after a turn ends the tab's title is given to show the name: the
 * kit's hook waits up to 30 s for the session to be idle, types for a few
 * seconds and confirms for up to 10 s, and Codex retitles the tab after that.
 */
const NAMED_MS = 120000;

/** How long the input line is given to be empty after the name is confirmed, and after the probe is taken back. */
const EMPTY_MS = 15000;

/** The line the kit types into a Codex session it has just resumed (src/up.js LIST_LINE, #226). */
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

/** The rows the tab renders now, or undefined when Orca will not say. */
function rowsOf(handle) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  const tail = answer.ok === true && answer.result?.terminal?.source === 'screen' ? answer.result.terminal.tail : undefined;
  return Array.isArray(tail) ? tail : undefined;
}

/** One read of the tab: its rendered rows (undefined when Orca gives none), and Orca's `draft`, when it gives one. */
function readOf(handle) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  const shown = answer.ok === true ? answer.result?.terminal : undefined;
  const rows = shown?.source === 'screen' && Array.isArray(shown.tail) ? shown.tail : undefined;
  return { rows, draft: shown?.draft, error: answer.ok === true ? undefined : answer.error };
}

/** One read of the tab, every row and the draft, as text for the run's record or a failure. */
function screenWithDraft(handle) {
  const { rows, draft, error } = readOf(handle);
  return [
    `orca terminal read --terminal ${handle} --screen`,
    `  draft: ${draft === undefined ? '(no draft key)' : JSON.stringify(draft)}${error === undefined ? '' : `; error: ${JSON.stringify(error)}`}`,
    ...(rows ?? ['(no rendered screen)']).map((row) => `    ${row}`),
  ].join('\n');
}

/**
 * Codex's input line when it is empty: a bare `›`, or its placeholder. The
 * rows the kit itself takes for an empty line (src/clear.js CODEX_EMPTY): the
 * kit types nothing into a line that reads otherwise, so a run that got to the
 * name typed into a line that read one of these.
 */
const CODEX_EMPTY = ['›', '› Ask Codex to do anything'];

/** Whether the tab's input line, the lowest row starting with `›`, is empty, with no draft from Orca. */
function inputLineEmpty(handle) {
  const { rows, draft } = readOf(handle);
  if (rows === undefined) return false;
  if (draft !== undefined && draft !== '') return false;
  const line = rows.findLast((row) => /^ *›/.test(row))?.replaceAll('\u00a0', ' ').trim();
  return CODEX_EMPTY.includes(line);
}

/** Write `text` into this test's own tab exactly as given, in one send, with no `--enter`. */
function sendKeys(handle, text) {
  const sent = orca(['terminal', 'send', '--terminal', handle, '--text', text]);
  assert.equal(sent.ok, true, `sending ${JSON.stringify(text)} into ${handle} failed: ${JSON.stringify(sent.error)}.${whatIsUp(handle)}`);
}

/** The tab's title as `orca terminal list` reports it now, or undefined when Orca does not list the tab. */
const titleOf = (handle) => allTerminals().find((terminal) => terminal.handle === handle)?.title;

/** What the tab is showing, for the message of a wait that ran out. */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  return [
    ` Its title in orca terminal list: ${JSON.stringify(titleOf(handle))}.`,
    blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`,
    ' This test answers nothing a tab asks; if it is a first-run screen, answer it in Orca and run again.',
    `\n  orca terminal read --terminal ${handle} --screen\n    ${(rowsOf(handle) ?? ['(unreadable)']).join('\n    ')}`,
  ].join('');
}

/** Terminal control sequences, taken out of a tab's output to read it as text. */
const CONTROL = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]|[\x00-\x08\x0b-\x1f\x7f]/g;

/**
 * What the kit typed into the tab, as far as the tab's output shows it: the
 * lines of its accumulated output (`orca terminal read`, no `--screen`) that
 * carry `/rename`, control sequences taken out. For the run's record.
 */
function renameInOutput(handle) {
  const answer = orca(['terminal', 'read', '--terminal', handle]);
  if (answer.ok !== true) return `(orca terminal read refused: ${JSON.stringify(answer.error)})`;
  const tail = answer.result?.terminal?.tail;
  const text = Array.isArray(tail) ? tail.join('\n') : String(tail ?? '');
  const lines = text.replace(CONTROL, '').split(/\r?\n|\r/).map((line) => line.trim()).filter((line) => line.includes('/rename'));
  return lines.length === 0 ? '(nothing with /rename in the tab\'s output)' : [...new Set(lines)].join('\n    ');
}

// ------------------------------------------------------------- Codex's records

/** Where Codex keeps its record of every conversation (tech notes, section 3). */
const CODEX_SESSIONS = path.join(os.homedir(), '.codex', 'sessions');

/** Where Codex 0.160.0's `/rename` writes a thread's name (read in its source at rust-v0.160.0). */
const SESSION_INDEX = path.join(os.homedir(), '.codex', 'session_index.jsonl');

/**
 * The newest line for thread `id` in session_index.jsonl, as Codex wrote it,
 * or undefined when it has none. The file only grows, and the newest line for
 * an id wins. Lines for other threads are not kept.
 */
function nameLineOf(id) {
  if (!existsSync(SESSION_INDEX)) return undefined;
  return readFileSync(SESSION_INDEX, 'utf8').split('\n').flatMap((line) => {
    try {
      const entry = JSON.parse(line);
      return entry?.id === id ? [entry] : [];
    } catch {
      return [];
    }
  }).at(-1);
}

/** The Codex version the conversation's record names in its first line (`cli_version`), or undefined. */
function codexVersionOf(id) {
  for (const file of rolloutFilesOf(id)) {
    try {
      const version = JSON.parse(readFileSync(file, 'utf8').split('\n')[0])?.payload?.cli_version;
      if (typeof version === 'string') return version;
    } catch {
      // Not a record this test can read; the next file, if any.
    }
  }
  return undefined;
}

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
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.pop();
  return lines;
}

/** How many whole lines each file of the conversation's record holds now. */
const recordMark = (id) => new Map(rolloutFilesOf(id).map((file) => [file, wholeLinesOf(file).length]));

/**
 * The messages the conversation's record gained since `mark` (all of them with
 * no mark), in order, as `{ role, text }`: a user's `input_text`, the model's
 * `output_text`.
 */
function messagesSince(id, mark = new Map()) {
  return rolloutFilesOf(id).flatMap((file) => wholeLinesOf(file).slice(mark.get(file) ?? 0))
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    })
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

// ------------------------------------------------------------- the bot

const BOT = { name: 'name-codex', title: 'Name Codex main' };
const SESSION = 'main';

/** The name the kit gives the session's thread. */
const NAME = `${BOT.name}.${SESSION}`;

/** What the session is told: one short turn now, a short answer to anything after, and nothing else. */
const startPrompt = [
  "You are a system test's bot and you own nothing.",
  'Do nothing that is not written here: run no command, read no file and write nothing.',
  'Reply OK and nothing else.',
  'Answer any later line as briefly as it asks, and do nothing else.',
  'If a line arrives saying fleet mail is waiting, ignore it.',
].join(' ');

test('a Codex session the kit starts shows <bot>.<session> in its tab title after its first turn, and again after obk restart', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-thread-name-')));
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

  // 1. A fresh start, and its one turn: the hook reports the thread to the
  // book at that turn, and its answer lands in Codex's record.
  const started = tabOf(obkJson(['up', '--bots', bots, '--bot', BOT.name, '--session', SESSION]), SESSION);
  assert.equal(started.created, true, 'the premise: up opened a tab');
  const handle = started.terminal;
  const id = await until(
    `${BOT.title} to report its thread to the book`,
    READY_MS,
    async () => (await sessionIn(home, SESSION)).session,
    () => ` The kit's hook has not run. A \`Hooks need review\` screen here means the launch-time trust did not take (#240).${whatIsUp(handle)}`,
  );
  await until(
    `the start turn's answer in Codex's record of ${id}`,
    ANSWER_MS,
    async () => (messagesSince(id).some((message) => message.role === 'assistant') ? true : undefined),
    () => whatIsUp(handle),
  );

  // 2. The title, and Codex's record of the name, after that turn ends.
  const turnEnded = Date.now();
  const title = await until(
    `${BOT.title}'s tab title to contain ${NAME} after its first turn`,
    NAMED_MS,
    async () => {
      const now = titleOf(handle);
      return typeof now === 'string' && now.includes(NAME) ? now : undefined;
    },
    () => ` session_index.jsonl's newest line for ${id}: ${JSON.stringify(nameLineOf(id) ?? null)}.${whatIsUp(handle)}`,
  );
  t.diagnostic(`after the first turn: title ${JSON.stringify(title)}, ${Math.round((Date.now() - turnEnded) / 1000)}s after the turn's answer was seen`);
  const named = await until(
    `session_index.jsonl's newest line for ${id} to name it ${NAME}`,
    NAMED_MS,
    async () => (nameLineOf(id)?.thread_name === NAME ? nameLineOf(id) : undefined),
    () => ` The newest line for ${id}: ${JSON.stringify(nameLineOf(id) ?? null)}.${whatIsUp(handle)}`,
  );
  t.diagnostic(`session_index.jsonl's newest line for the thread: ${JSON.stringify(named)}`);
  t.diagnostic(`what the kit typed into ${BOT.title}, from its output:\n    ${renameInOutput(handle)}`);
  const asMessage = messagesSince(id).filter((message) => message.role === 'user' && message.text.includes('/rename'));
  assert.deepEqual(asMessage, [], `Codex took /rename as its own command, not as a line to the model: ${JSON.stringify(asMessage)}`);
  t.diagnostic(`Codex's version in the conversation's record: ${JSON.stringify(codexVersionOf(id) ?? null)}`);

  // b. No paste-style input left standing (#713): the kit's one write went in
  // as a command, and the input line is empty again.
  await until(
    `${BOT.title}'s input line to be empty, with no draft, after the name was confirmed`,
    EMPTY_MS,
    async () => (inputLineEmpty(handle) ? true : undefined),
    () => `\n  ${screenWithDraft(handle)}`,
  );
  t.diagnostic(`after the name was confirmed, the input line is empty:\n  ${screenWithDraft(handle)}`);

  // c. What the kit's line check sees when text stands under the input line
  // (#713): the command and Orca's notice in one write, into this test's own
  // tab only, never with Enter, and all of it taken back.
  assert.ok(!before.handles.has(handle), `the probe types only into this test's own tab, and ${handle} was open before the test`);
  const probe = `/rename ${NAME}\nYou have 1 orchestration message. Run \`orca orchestration check --run run_probe713\`.\n`;
  const probeMark = recordMark(id);
  sendKeys(handle, probe);
  try {
    await setTimeout(1000);
    t.diagnostic(`#713 probe, about 1 s after the one write of ${JSON.stringify(probe)}:\n  ${screenWithDraft(handle)}`);
  } finally {
    sendKeys(handle, '\x7f'.repeat([...probe].length));
  }
  await until(
    `${BOT.title}'s input line to be empty again after the probe was taken back`,
    EMPTY_MS,
    async () => (inputLineEmpty(handle) ? true : undefined),
    () => `\n  ${screenWithDraft(handle)}`,
  );
  const probeSent = messagesSince(id, probeMark).filter((message) => message.role === 'user' && message.text.includes('run_probe713'));
  assert.deepEqual(probeSent, [], `the probe's write went to the model as a turn, so a newline in one write submitted the line: ${JSON.stringify(probeSent)}`);

  // 3. A restart: the conversation resumed in a new tab, and the kit's list
  // line gives it a turn. After that turn ends, the new tab's title names it.
  const mark = recordMark(id);
  const answer = obkJson(['restart', '--bots', bots, '--bot', BOT.name, '--session', SESSION]);
  guard.closedByKit(answer.closed);
  const back = tabOf(answer, SESSION);
  assert.equal(back.created, true, `the premise: a new tab, got: ${JSON.stringify(back)}`);
  assert.equal(back.resumed, true, `the premise: the conversation was resumed, got: ${JSON.stringify(back)}`);
  assert.equal(back.listLine, true, `the premise: the kit typed its list line, and says ${JSON.stringify(back.listLine)}: ${back.listLineTrouble ?? 'no reason given'}.${whatIsUp(back.terminal)}`);
  await until(
    `an answer after the kit's list line in Codex's record of ${id}`,
    ANSWER_MS,
    async () => {
      const seen = messagesSince(id, mark);
      const at = seen.findIndex((message) => message.role === 'user' && message.text.trim() === LIST_LINE);
      return at >= 0 && seen.slice(at + 1).some((message) => message.role === 'assistant') ? true : undefined;
    },
    () => ` Messages since the restart: ${JSON.stringify(messagesSince(id, mark).map((message) => ({ role: message.role, text: message.text.slice(0, 80) })))}.${whatIsUp(back.terminal)}`,
  );
  const restartTurnEnded = Date.now();
  const titleAfter = await until(
    `the restarted tab's title to contain ${NAME} after the list line's turn`,
    NAMED_MS,
    async () => {
      const now = titleOf(back.terminal);
      return typeof now === 'string' && now.includes(NAME) ? now : undefined;
    },
    () => ` session_index.jsonl's newest line for ${id}: ${JSON.stringify(nameLineOf(id) ?? null)}.${whatIsUp(back.terminal)}`,
  );
  t.diagnostic(`after the restart: title ${JSON.stringify(titleAfter)}, ${Math.round((Date.now() - restartTurnEnded) / 1000)}s after the list line's answer was seen`);
  t.diagnostic(`session_index.jsonl's newest line for the thread after the restart: ${JSON.stringify(nameLineOf(id) ?? null)}`);
  t.diagnostic(`what the kit typed into the restarted tab, from its output:\n    ${renameInOutput(back.terminal)}`);
  const asMessageAfter = messagesSince(id, mark).filter((message) => message.role === 'user' && message.text.includes('/rename'));
  assert.deepEqual(asMessageAfter, [], `Codex took /rename as its own command, not as a line to the model: ${JSON.stringify(asMessageAfter)}`);
});
