// A system test: a maker makes a temporary session on Pi, finds no first-run
// screen of Pi's to answer in it, and retires it (#648, R1, the issue's live
// check). Against the real Orca and a real Pi on this machine. Run it alone
// with `npm run test:system -- --yes test/system/pi-temp.test.js`; `npm test`
// cannot, and no CI machine could.
//
// What it proves, in a throwaway fleet:
//
//   1. A bot on Claude Code with one long-lived session, lead, brought up. lead
//      is asked to do nothing; the commands it would run are run for it, with
//      lead's tab id and handle (#250, #408). The bot's temp_approval is set
//      to dangerously-skip with the kit's own `obk permission approval
//      --temps`, as a user does: every Pi session runs as dangerously-skip,
//      and lead stays at the kit's default, auto. That is why: it takes the
//      road the requirement names for a maker whose approval is narrower,
//      and it keeps lead's real Claude Code out of
//      --dangerously-skip-permissions, which a maker on dangerously-skip
//      would run.
//   2. From lead's tab, `obk temp make --name helper --harness pi --model
//      openai/gpt-6-luna --effort low`, with a start prompt that asks for one
//      word and nothing else. The answer says the harness came from the flag
//      and the approval is dangerously-skip; bot.yaml has helper on pi at
//      dangerously-skip, on that model and effort; the book has it as lead's,
//      with a Pi session id.
//   3. helper's tab comes up as Pi (Orca's `terminal show` gives
//      `agentIdentity: pi`, or its title starts `π - ` or `Pi - `), and no
//      question is on its screen at any look: not Pi's project-trust question,
//      not a warning that waits for a key, not an extension's list, nor any
//      question the kit's shared look finds (helpers/screens.js `questionOn`).
//      Any of them stops the run with the screen, and nothing is typed into
//      it. Pi's own record of the session, the file for the book's id in the
//      bot home's session folder under ~/.pi/agent/sessions (tech notes,
//      section 6), holds the first turn: a header whose cwd is the bot home,
//      and an assistant reply. It is read, never written.
//   4. `obk temp answer --name helper` from lead's tab: a non-zero exit, a
//      sentence that names Pi and says no first-run screen of Pi's is there,
//      and nothing typed: after a few seconds the session file has no new
//      user turn, and the screen still shows no question.
//   5. lead retires helper with `obk temp retire`: its tab closed in Orca, off
//      bot.yaml, on the book's retired list with its maker and its Pi session
//      id. lead's tab is still open.
//
// What it cannot show: a first-run screen of Pi's that comes only in a folder
// that has `.pi/` files, a `hooks/` folder or an extension that asks at start.
// Those are read in Pi's code and answered by the kit's words alone, in the
// fake-based tests (test/pi-temp.test.js P7).
//
// The screens. lead's tab and Bot Father's show Claude Code's folder trust;
// nothing here waits on them or types into them, so they are left, as in
// temp-answer and temp-roles. helper's tab must show nothing to answer: the
// kit starts Pi with --no-approve, and Pi 1.3.0 then asks nothing at start
// (tech notes, section 6). This test answers no screen of Pi's, and a person
// answers none either. A screen of Claude Code's the test would answer would
// have to pass `onlyPlainTrustOf` or `onlyTeachFormOf`
// (helpers/screens.js); none is answered here.
//
// The machine it runs on is someone's working machine. So this test, like the
// ones beside it: works in a throwaway bots folder under the system temp
// directory; writes down every terminal and workspace Orca already had; runs
// this checkout's `src/cli.js` by its full path, never the machine's `obk`
// (#220); types into no tab at all; closes only its own tabs, through the tab
// guard, and deletes its own workspaces, whatever happened; signals no
// process. `orca terminal close --worktree … --all` is never run, and the
// guard refuses it. The runner (scripts/test-system.js) makes a fresh copy of
// ~/.claude.json and ~/.codex/config.toml before any test is loaded, and runs
// nothing when it cannot (#619); it takes out of ~/.claude.json the trust
// Claude Code records for the run's own folders (#240).
//
// Pi's records. The runner removes the Pi session folders under
// ~/.pi/agent/sessions that the run's own throwaway folders caused (PR #638);
// it is the one deleter of them. This test removes none: it only reads Pi's
// session file for the book's id. Nothing under ~/.pi is written by it;
// settings.json, trust.json and models.json in ~/.pi/agent are compared
// before and after, and a change is reported, not undone (Pi may write a new
// lastChangelogVersion or a missing deviceId).
// The model, openai/gpt-6-luna at low, is the cheapest the tech notes name.
//
// It runs at night: the owner's rule is that a live test that mounts a
// throwaway tab in the owner's open Orca runs between midnight and 6 am. It
// takes a few minutes, and spends one short Pi turn.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry } from '../helpers/cli.js';
import { questionOn } from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { deleteOwnProject } from '../helpers/own-project.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/**
 * Remove the throwaway bots folder and everything the kit made beside it:
 * `<bots>.prompts`, `<bots>.locks` and the rest are siblings of it (PRD 6.3).
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

/** How long a tab is given to show its harness. */
const READY_MS = 180000;

/** How long a real harness is given for its turn, and its record to show it. */
const ANSWER_MS = 240000;

/** How long after a refusal the tab is watched for a change that should not come. */
const SETTLE_MS = 5000;

const BOT = 'pi-temp-bot';
const LEAD = 'lead';
const HELPER = 'helper';

/** The Pi model and effort helper runs on: the cheapest the tech notes name. */
const MODEL = 'openai/gpt-6-luna';
const EFFORT = 'low';

/** In helper's start prompt only: its first turn prints it. */
const READY_WORD = 'READY-6481';

/** helper's task: one short reply, so it has a first turn, and nothing else. */
const TASK = 'You are a system test\'s session and you own nothing. Do not run any command, read or write any file,'
  + ` or use any tool. Reply now with ${READY_WORD} and nothing else, then wait.`;

/** Where Pi keeps its sessions, under the user's own HOME (tech notes, section 6). */
const PI_AGENT = path.join(os.homedir(), '.pi', 'agent');
const PI_SESSIONS = path.join(PI_AGENT, 'sessions');

/** Pi's session folder for a working folder: its real path, the leading `/` off, every `/`, `\` and `:` a `-`. */
const piFolderNameOf = (real) => `--${real.replace(/^\//, '').replaceAll(/[/\\:]/g, '-')}--`;

/** The files in ~/.pi/agent this test compares, never writes. */
const PI_SETTINGS = ['settings.json', 'trust.json', 'models.json'];

/** A file's SHA-256, or null when it is not there. */
function hashOf(file) {
  if (!existsSync(file)) return null;
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

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
 * unless `env` says which. `shown` is the screen a command may print back, as
 * `obk temp answer` does when it refuses: those rows are the tab's, not the
 * kit's, so they are taken out before the look for "worktree".
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

/** The bot's bot.yaml as it stands. */
const botYamlOf = (home) => parse(readFileSync(path.join(home, 'bot.yaml'), 'utf8')) ?? {};

/** One session's entry in bot.yaml, or undefined. */
const entryIn = (home, name) => (botYamlOf(home).sessions ?? []).find((one) => one?.name === name);

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

/** What the tab is showing, for the message of a wait that ran out. */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  return `${blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`}`
    + `\n  orca terminal read --terminal ${handle} --screen\n  ${(rowsOf(handle) ?? ['(no rendered screen)']).join('\n  ')}`;
}

/** Orca's own account of one tab: `terminal show`. */
function shownOf(handle) {
  const answer = orca(['terminal', 'show', '--terminal', handle]);
  return answer.ok === true ? answer.result?.terminal : undefined;
}

/**
 * A question of Pi's on `rows`, or of any harness the kit's shared look knows,
 * named; undefined when there is none. Pi's shapes are those of tech notes
 * section 6: the project-trust title, the warning's `Press any key to
 * continue...`, and the `↑↓ navigate  enter select` foot of a Pi list.
 */
function questionIn(rows) {
  if (rows.some((row) => row.trim() === 'Trust project folder?')) return 'Pi\'s project-trust question';
  if (rows.some((row) => /Press any key to continue/.test(row))) return 'a Pi warning that waits for a key';
  if (rows.some((row) => /↑↓ navigate\s+enter select\s+escape\/ctrl\+c cancel/.test(row))) return 'a Pi list, from an extension or Pi itself';
  if (questionOn(rows) !== undefined) return 'a question the kit\'s shared look finds';
  return undefined;
}

/** Fail, typing nothing, when a question is on helper's screen. */
function assertNoQuestion(handle, when) {
  const rows = rowsOf(handle);
  if (rows === undefined) return;
  const found = questionIn(rows);
  assert.equal(found, undefined, `${when}, ${found} is up in ${HELPER}'s tab, which the kit's --no-approve should have kept away, and nothing was typed into it:\n    ${rows.join('\n    ')}`);
}

/** Pi's JSON lines in one session file, whole lines only; none when it is not there. */
function piLinesOf(file) {
  if (file === undefined || !existsSync(file)) return [];
  const text = readFileSync(file, 'utf8');
  return text.slice(0, text.lastIndexOf('\n') + 1).split('\n').flatMap((raw) => {
    try {
      return raw.trim() === '' ? [] : [JSON.parse(raw)];
    } catch {
      return [];
    }
  });
}

/** The text of one Pi message, whether its content is a string or a list of text blocks. */
const textOf = (message) => (typeof message?.content === 'string'
  ? message.content
  : (message?.content ?? []).filter((block) => block?.type === 'text').map((block) => block.text).join(''));

/** Pi's session file for `id` in the session folder of `real`, or undefined. */
function piFileOf(real, id) {
  const dir = path.join(PI_SESSIONS, piFolderNameOf(real));
  if (typeof id !== 'string' || !existsSync(dir)) return undefined;
  const name = readdirSync(dir).find((one) => one.endsWith(`_${id}.jsonl`));
  return name === undefined ? undefined : path.join(dir, name);
}

/** How many user turns a Pi session file holds. */
const userTurnsIn = (file) => piLinesOf(file).filter((line) => line.type === 'message' && line.message?.role === 'user').length;

/** Give the kit's own account of tabs it closed to the guard: a retire's `closed`, as an array of `{ terminal }`. */
function closedByKit(entries) {
  if (Array.isArray(entries)) guard.closedByKit(entries);
}

test('a maker makes a temporary session on Pi, finds no first-run screen of Pi\'s in it, and retires it', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
    pi: Object.fromEntries(PI_SETTINGS.map((name) => [name, hashOf(path.join(PI_AGENT, name))])),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-pi-temp-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', BOT].map(homeOf);
  const home = homeOf(BOT);

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
    for (const name of PI_SETTINGS) {
      const now = hashOf(path.join(PI_AGENT, name));
      if (now !== before.pi[name]) t.diagnostic(`${path.join(PI_AGENT, name)} changed during the run (Pi's own write); nothing was copied back`);
    }
  });

  // ---------------------------------------------------------------------------
  // 1. The fleet: Bot Father, and pi-temp-bot on Claude Code with one
  // long-lived session, lead, at the kit's default approval; the bot's
  // temporary sessions allowed dangerously-skip, by the kit's own command.
  obkJson(['init', '--bots', bots, '--harness', 'claude']);
  obkJson([
    'bot', 'create', '--bots', bots, '--name', BOT, '--harness', 'claude',
    '--charter', `${BOT} exists for one system test run and owns nothing.`,
  ]);
  obkJson(['session', 'add', '--bots', bots, '--bot', BOT, '--name', LEAD, '--prompt', 'You are a system test\'s session and you own nothing. Say nothing and wait.']);
  obkJson(['permission', 'approval', '--bots', bots, '--bot', BOT, '--temps', '--approval', 'dangerously-skip']);
  assert.equal(botYamlOf(home).temp_approval, 'dangerously-skip', `the premise: the bot's temporary sessions may run at dangerously-skip: ${JSON.stringify(botYamlOf(home))}`);
  const leadTab = openedIn(obkJson(['up', '--bots', bots, '--bot', BOT]), 'up');
  const lead = { tabId: sessionIn(home, LEAD).tab, handle: leadTab.terminal };
  assert.equal(typeof lead.tabId, 'string', `the premise: the book holds lead's tab, got: ${JSON.stringify(sessionIn(home, LEAD))}`);

  // ---------------------------------------------------------------------------
  // 2. lead makes helper on Pi, on the cheap model, with one word to say.
  const made = obkJson([
    'temp', 'make', '--bots', bots, '--name', HELPER, '--harness', 'pi', '--model', MODEL, '--effort', EFFORT, '--prompt', TASK,
  ], inTab(lead));
  assert.equal(made.session, HELPER, `temp make makes ${HELPER}: ${JSON.stringify(made)}`);
  assert.equal(made.maker, LEAD, `${HELPER} is lead's: ${JSON.stringify(made)}`);
  assert.deepEqual(
    { harness: made.chosen?.harness?.value, from: made.chosen?.harness?.from, approval: made.chosen?.approval?.value },
    { harness: 'pi', from: 'flag', approval: 'dangerously-skip' },
    `the answer says Pi came from the flag, at dangerously-skip: ${JSON.stringify(made.chosen)}`,
  );
  const handle = openedIn(made, `temp make of ${HELPER}`).terminal;
  const entry = entryIn(home, HELPER);
  assert.deepEqual(
    { harness: entry?.harness, approval: entry?.approval, model: entry?.model, effort: entry?.effort },
    { harness: 'pi', approval: 'dangerously-skip', model: MODEL, effort: EFFORT },
    `bot.yaml has ${HELPER} on Pi: ${JSON.stringify(entry)}`,
  );
  const booked = sessionIn(home, HELPER);
  assert.equal(booked.temporary?.maker, LEAD, `the book has ${HELPER} as lead's: ${JSON.stringify(booked)}`);
  const id = booked.session;
  assert.match(String(id), /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/, `the book holds a Pi session id for ${HELPER}: ${JSON.stringify(booked)}`);

  // ---------------------------------------------------------------------------
  // 3. Its tab comes up as Pi, with no question on it at any look.
  await until(
    `${HELPER}'s tab to come up as Pi`,
    READY_MS,
    async () => {
      assertNoQuestion(handle, 'while it came up');
      const shown = shownOf(handle);
      return shown?.agentIdentity === 'pi' || /^(?:π|Pi) - /.test(shown?.title ?? '') ? true : undefined;
    },
    () => ` Orca shows: ${JSON.stringify(shownOf(handle) ?? null)}.${whatIsUp(handle)}`,
  );
  const real = realpathSync(home);
  const file = await until(
    `Pi's record of ${HELPER} to hold its reply`,
    ANSWER_MS,
    async () => {
      assertNoQuestion(handle, 'while it took its first turn');
      const found = piFileOf(real, id);
      const lines = piLinesOf(found);
      const replied = lines.some((line) => line.type === 'message' && line.message?.role === 'assistant' && textOf(line.message).trim() !== '');
      return replied ? found : undefined;
    },
    () => ` Looked in ${path.join(PI_SESSIONS, piFolderNameOf(real))} for *_${id}.jsonl.${whatIsUp(handle)}`,
  );
  const lines = piLinesOf(file);
  assert.equal(lines[0]?.type, 'session', `the file starts with Pi's header: ${JSON.stringify(lines[0])}`);
  assert.equal(lines[0]?.id, id, `for the book's id: ${JSON.stringify(lines[0])}`);
  assert.equal(realpathSync(lines[0]?.cwd), real, `in the bot home: ${JSON.stringify(lines[0])}`);
  const reply = lines.filter((line) => line.type === 'message' && line.message?.role === 'assistant').map((line) => textOf(line.message)).join('\n');
  if (!reply.includes(READY_WORD)) t.diagnostic(`${HELPER}'s reply did not carry ${READY_WORD}: ${JSON.stringify(reply.slice(0, 200))}`);
  assertNoQuestion(handle, 'after its first turn');

  // ---------------------------------------------------------------------------
  // 4. temp answer: nothing of Pi's to answer, and nothing typed.
  const shownBefore = rowsOf(handle) ?? [];
  const turns = userTurnsIn(file);
  const answered = obk(['temp', 'answer', '--bots', bots, '--name', HELPER], inTab(lead), shownBefore);
  const said = `${answered.stdout}${answered.stderr}`;
  assert.notEqual(answered.status, 0, `temp answer has nothing of Pi's to answer, so it does not end in 0: ${said}`);
  assert.ok(!/^\s+at /m.test(said), `a message, not a crash: ${said}`);
  const own = shownBefore.map((row) => row.trim()).filter((row) => row !== '').reduce((text, row) => text.replaceAll(row, ''), said);
  assert.match(own, /\bPi\b/, `it names Pi: ${said}`);
  assert.match(own, /first[- ]run/i, `and says no first-run screen of Pi's is there: ${said}`);
  await setTimeout(SETTLE_MS);
  assert.equal(userTurnsIn(file), turns, 'nothing was typed: Pi\'s record has no new user turn');
  assertNoQuestion(handle, 'after temp answer');

  // ---------------------------------------------------------------------------
  // 5. lead retires helper, from its tab.
  const retired = obkJson(['temp', 'retire', '--bots', bots, '--name', HELPER], inTab(lead));
  closedByKit(retired.closed);
  for (const each of retired.retiredWith ?? []) closedByKit(each.closed);
  assert.equal(retired.session, HELPER, `the answer names ${HELPER}: ${JSON.stringify(retired)}`);
  const left = await terminalsAfterClosing(home, [handle]);
  assert.equal(left.some((one) => one.handle === handle), false, `${HELPER}'s tab is closed in Orca`);
  assert.ok(terminalsAt(home).some((one) => one.handle === lead.handle), 'and lead\'s is still open');
  assert.deepEqual((botYamlOf(home).sessions ?? []).map((one) => one?.name), [LEAD], `bot.yaml has lead, and not ${HELPER}`);
  const book = bookOf(home);
  assert.deepEqual(Object.keys(book.sessions ?? {}), [LEAD], `the book's live list has lead alone: ${JSON.stringify(Object.keys(book.sessions ?? {}))}`);
  const entries = (book.retired ?? []).filter((one) => one?.name === HELPER);
  assert.equal(entries.length, 1, `one retired entry for ${HELPER}: ${JSON.stringify(book.retired)}`);
  assert.equal(entries[0].temporary?.maker, LEAD, `its retired entry still names its maker: ${JSON.stringify(entries[0])}`);
  assert.ok(JSON.stringify(entries[0]).includes(id), `and keeps its Pi session id: ${JSON.stringify(entries[0])}`);
});
