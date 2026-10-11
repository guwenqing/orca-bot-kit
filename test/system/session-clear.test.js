// A system test: `obk session clear` and `obk session compact` against the real
// harnesses in the real Orca on this machine (#391). Run it alone with
// `npm run test:system -- --yes test/system/session-clear.test.js`;
// `npm test` cannot, and no CI machine could.
//
// It is the live done check of #391, on Claude Code and on Codex:
//
//   0. Recorded, not checked: what Orca's tui-idle answers with a "/" typed
//      into the idle tab and its slash popup open, which live run 3 worked out
//      turns it off. The "/" is taken back, and that is checked.
//   1. On a busy session, `obk session clear` waits and then refuses, and types
//      nothing: the session's conversation in the book is the same, and its
//      record holds no clear.
//   2. On an idle session, `obk session clear` gives a new conversation in the
//      book, and the kit's hook briefed it: asked for a word only its start
//      prompt holds, the new conversation answers it.
//   3. A line added to the bot's AGENTS.md before the clear is read by the new
//      conversation. On Codex that is the architect's condition for the rules
//      stamp (the ruling on #391): the new rollout's "AGENTS.md instructions"
//      message holds the line. Then `obk health` says the session's rules are
//      current, where before the clear it said older and offered the clear.
//   4. `obk session compact` compacts, or says this harness cannot. A compact
//      the harness's record does not show within the kit's 5 minutes is
//      answered `confirmed: false`, not a failure (the architect's ruling on
//      #391); this run reports it when it happens, which is the only check of
//      that case: the unit suite does not wait the 5 minutes.
//
// A cleared session is not promised to be idle afterwards (a Codex one may
// run its start routine). This test waits for it to be idle only so that it
// can type its own question safely, and checks nothing about it.
//
// The kit names a Codex thread `<bot>.<session>` (#480): at each turn end its
// Stop hook types `/rename <bot>.<session>` into the tab, one character a
// send, until Codex holds that name for the thread. That typing races with
// whatever this test types next. On live run 2026-10-10 of #516 (Codex
// 0.162.0) the clear on the idle session was refused as busy while the tab's
// input line read "› /rename clear-codex", and the thread was never named.
// So on Codex, after each turn ends and before the test types anything or
// runs a kit command that types (step 0's "/", the busy turn, the clear, the
// question, the compact), it waits for the naming of the thread the book
// holds to land: the newest line for that thread's id in
// ~/.codex/session_index.jsonl names it `<bot>.daily`. After the clear the
// book holds a new thread, which the kit names after that thread's first
// turn, so the wait is for the new id. The wait is 60 s from when the test
// sees the tab idle after the turn. A name not there by then fails the run:
// it is a finding about the naming, not something to wait out. The failure
// names the thread and shows the tab's rows, Orca's draft and Codex's
// warning. Claude Code threads are not named this way, so there is no wait.
//
// Every word the session is asked for is one the question does not carry, so
// a wait cannot be satisfied by the question itself. Each answer is read from
// the new conversation's own record, not from the screen, since the screen
// shows the old conversation's start prompt until the clear redraws it.
//
// The machine it runs on is someone's working machine, with their own tabs
// open. So this test, like the others beside it:
//
//   - works in a throwaway bots folder under the system temp directory;
//   - writes down every terminal and workspace Orca already had, before it
//     creates anything;
//   - touches only what it created, matched by handle and by workspace path;
//   - types only into its own bot's tab: the question, the busy turn, and
//     nothing else, but for step 0's "/" and its backspace, and, only when the
//     wait for a Codex thread's name fails, F2 to open Codex's warning and Esc
//     to close it again (#516);
//   - closes its own tabs one by one (`--terminal <handle> --tab`) and then
//     deletes its own workspaces, whatever happened, and checks afterwards that
//     it closed no tab it did not create.
//
// `orca terminal close --worktree … --all` is never run here, and the helper
// below refuses to run it at all.
//
// One thing it cannot clean up, as messaging.test.js says of itself: the Run
// mailboxes `up` makes. Orca has no `run-delete`.
//
// **It is attended, a little.** A bot folder nobody has opened before asks
// questions before the harness is running in it (PRD 6.5). This test answers
// one of them itself, Claude Code's folder trust, in its own throwaway Claude
// bot's tab alone, by the architect's ruling on #391 (folder trust, option
// (c)), the same exception send-outside-fleet.test.js has under #451: it
// answers only when every row from "Accessing workspace:" down is a row of the
// captured plain screen with the tab's own throwaway folder in the folder's
// place, the pointer is on "No, exit", "Yes, I trust this folder" is there,
// and no line pre-approves a permission (helpers/screens.js
// `onlyPlainTrustOf`), or, since #539, the screen that pre-approves exactly
// the kit's default rules in the tab's own .claude/settings.json
// (helpers/claude-trust.js `claudeTrustAt`, #558). Then down and return, once, with no `--enter`. Any
// other screen gets no answer, and the test fails printing every row it saw.
// The Codex session is given its folder's trust at launch (#240,
// test/helpers/codex-trust.js), so Codex asks neither its folder trust nor its
// hooks review; it may still offer an update, which is the person's. Bot
// Father's tab shows the same folder trust, which nothing here waits on, and it
// can be left. After a turn Claude Code may offer "Teach auto mode about your
// environment?" (#416). The test answers that too, in its own Claude bot's tab
// alone, by the architect's ruling after live run 3: with Esc, at most once,
// only when every row from its title down is the captured form's
// (helpers/screens.js `onlyTeachFormOf`, the pointer on any of its rows), and
// it then shows the form gone and ~/.claude.json's autoModeEnvSetup unchanged,
// or fails; any other form fails, printing its rows. Every
// wait says what the tab is showing when it runs out of patience, so a run left
// alone names the screen that stopped it.
//
// It takes several minutes: two real harnesses, a busy turn of 75 s on each, a
// clear, a question and a compact.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry } from '../helpers/cli.js';
import { codexTrustArgs } from '../helpers/codex-trust.js';
import { onlyTeachFormOf, waitingOn } from '../helpers/screens.js';
import { claudeTrustAt } from '../helpers/claude-trust.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { deleteOwnProject } from '../helpers/own-project.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/** The Orca CLI that works for a normal user (tech notes, section 1). */
const ORCA = process.env.OBK_ORCA || '/Applications/Orca.app/Contents/Resources/bin/orca';

/** How long a tab is given to be ready: a first run has screens on it and a person answering them. */
const READY_MS = 180000;

/** How long a session is given to answer one question. */
const ANSWER_MS = 120000;

/**
 * How long the busy turn's command runs: well past the kit's 30 s wait for an
 * idle session, counted from when the test sees the turn start.
 */
const BUSY_SECONDS = 75;

/**
 * The busy turn: one shell command run in the foreground, which holds the
 * turn open for BUSY_SECONDS. Not `sleep`: on the live run Claude Code 2.1.288
 * ran `sleep 45` as a background command and was never busy. A `perl` that
 * waits on `select` is a program like any other, and the line says plainly to
 * run it in the foreground and wait for it, so neither harness has a reason to
 * put it in the background. Whether it does is still the model's; if it does,
 * the wait for the turn to show as busy runs out and prints the screen.
 */
const BUSY_LINE = 'Run exactly this shell command once, in the foreground, not in the background, and wait until it'
  + ` has finished before you reply: perl -e 'select(undef, undef, undef, ${BUSY_SECONDS}); print "waited\\n"'`
  + ' . When it has finished, reply DONE and nothing else.';

/** How long a session is given to start its busy turn before the clear is asked for. */
const BUSY_START_MS = 60000;

/** How long the tab is given to take a key in before the return that goes after it. */
const KEY_GAP_MS = 1000;

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
 * Remove the throwaway bots folder and everything the kit made beside it:
 * `<bots>.prompts` is a sibling of the bots folder and not a child of it.
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

/**
 * Run this checkout's `obk`, by its full path. The `obk` on PATH is the
 * published release this machine uses, not the code under test (#217).
 */
function obk(args) {
  const done = spawnSync(process.execPath, [cliEntry, ...args], { encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(done.error, undefined, `could not run \`obk\`: ${done.error?.message}`);
  assert.ok(!/worktree/i.test(done.stdout + done.stderr), `obk said "worktree": ${done.stdout}${done.stderr}`);
  return done;
}

/** Run `obk ... --json`, which has to go through, and read its answer. */
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

/** What a bot's book says about one session now. */
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

/** The rows the tab renders now, or undefined when Orca will not say. */
function rowsOf(handle) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  const tail = answer.ok === true && answer.result?.terminal?.source === 'screen' ? answer.result.terminal.tail : undefined;
  return Array.isArray(tail) ? tail : undefined;
}

/** Every row the tab renders now, one to a line, for a message. */
const screenRows = (handle) => (rowsOf(handle) ?? ['(unreadable)']).join('\n    ');

/** What the tab is showing, for the message of a wait that ran out. */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  return [
    blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`,
    ' This test answers nothing a tab asks; answer it in Orca and run again.',
    `\n  orca terminal read --terminal ${handle} --screen\n    ${(rowsOf(handle) ?? ['(unreadable)']).join('\n    ')}`,
  ].join('');
}

/** Codex at work says how to interrupt it. Claude Code 2.1.288 does not (live run 2 of #391). */
const isBusy = (rows) => rows.some((row) => /esc to interrupt/i.test(row));

/**
 * Whether Orca's `tui-idle` reads the tab busy now: a short wait that is not
 * answered ok, the kit's own busy signal (the architect's ruling on #391,
 * 2026-10-03). Answers Orca's answer too, for the run's record.
 */
function tuiBusy(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  return { busy: answer.ok !== true, answer };
}

/**
 * A harness's status rows while it works, kept as evidence only: Claude Code
 * 2.1.288's "✳ Nucleating… (1m 8s · ↓ 131 tokens)" and "(ctrl+b to run in
 * background)", seen on live run 2, and Codex's "esc to interrupt".
 */
const statusRows = (rows) => rows.filter((row) => /\(\s*(?:\d+m\s*)?\d+s\b[^)]*\)|ctrl\+b to run in background|esc to interrupt/i.test(row));

/**
 * Wait until the tab is idle: a TUI up, nothing of its own waiting, and not at
 * work. `onScreen` is shown the tab's rows at each look first, for a screen
 * the test itself may answer.
 */
async function idle(handle, onScreen = async () => {}, within = READY_MS) {
  await until(
    `${handle} to be idle`,
    within,
    async () => {
      const shown = rowsOf(handle);
      if (shown !== undefined) await onScreen(shown);
      const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '5000']);
      if (answer.ok !== true || answer.result?.wait?.satisfied !== true) return undefined;
      if (waitingOn(orca, handle) !== undefined) return undefined;
      const rows = rowsOf(handle);
      return rows !== undefined && !isBusy(rows) ? true : undefined;
    },
    () => `${waitingOn(orca, handle) ?? ''}${whatIsUp(handle)}`,
  );
}

/**
 * Press keys in the test's own tab: `text`, then a return as a send of its own,
 * neither with `--enter` (Orca's gate can refuse a line with one; on Codex a
 * return inside the text lands in the draft).
 */
async function pressIn(handle, text) {
  for (const keys of [text, '\r']) {
    const sent = orca(['terminal', 'send', '--terminal', handle, '--text', keys]);
    assert.equal(sent.ok, true, `typing ${JSON.stringify(keys)} into ${handle} failed: ${JSON.stringify(sent.error)}.${whatIsUp(handle)}`);
    await setTimeout(KEY_GAP_MS);
  }
}

/** The lines of a JSONL record, each parsed, skipping a line still being written. */
function linesOf(file) {
  if (file === undefined || !existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').flatMap((line) => {
    try {
      return line.trim() === '' ? [] : [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

/** Where Claude Code keeps a conversation of the folder `home` (tech notes, section 2). */
const claudeRecord = (home, id) => path.join(os.homedir(), '.claude', 'projects', home.replaceAll(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);

/** Where Codex keeps a conversation, found by its id (tech notes, section 3). */
function codexRecord(id) {
  const root = path.join(os.homedir(), '.codex', 'sessions');
  const name = readdirSync(root, { recursive: true }).find((one) => String(one).endsWith(`-${id}.jsonl`));
  return name === undefined ? undefined : path.join(root, String(name));
}

/** How long the kit's naming of a Codex thread is given to land after a turn ends (#516). */
const NAMED_MS = 60000;

/** Codex's record of thread names, where `/rename` appends a line (#480). */
const SESSION_INDEX = path.join(os.homedir(), '.codex', 'session_index.jsonl');

/**
 * The name Codex holds for thread `id`: the newest line for that id in
 * session_index.jsonl, or undefined when it has none. Lines for other ids are
 * not read.
 */
const threadNameOf = (id) => linesOf(SESSION_INDEX).filter((line) => line.id === id).at(-1)?.thread_name;

/** The text Orca gives as the tab's input line, its `draft`, for a message. */
function draftOf(handle) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  if (answer.ok !== true) return `(unreadable: ${JSON.stringify(answer.error)})`;
  const draft = answer.result?.terminal?.draft;
  return draft === undefined ? '(none: Orca gave no draft)' : JSON.stringify(draft);
}

/**
 * Codex's warning, for a message: F2 opens its warning panel in the test's own
 * tab, the screen is read, and Esc closes the panel again. Used only when a
 * wait has already failed.
 */
async function codexWarning(handle) {
  const opened = orca(['terminal', 'send', '--terminal', handle, '--text', '\x1bOQ']);
  if (opened.ok !== true) return `(F2 could not be sent: ${JSON.stringify(opened.error)})`;
  await setTimeout(1500);
  const rows = rowsOf(handle) ?? ['(unreadable)'];
  const closed = orca(['terminal', 'send', '--terminal', handle, '--text', '\x1b']);
  return `${rows.join('\n    ')}${closed.ok === true ? '' : `\n  (Esc to close it could not be sent: ${JSON.stringify(closed.error)})`}`;
}

/** The harness's own record of conversation `id`, as its lines. */
const recordOf = (harness, home, id) => linesOf(harness === 'codex' ? codexRecord(id) : claudeRecord(home, id));

/** What the model said in a record, as one piece of text: never the user's turn or the hook's context. */
function modelSaid(harness, lines) {
  const said = harness === 'codex'
    ? lines.filter((line) => line.type === 'response_item' && line.payload?.role === 'assistant')
    : lines.filter((line) => line.type === 'assistant');
  return said.map((line) => JSON.stringify(harness === 'codex' ? line.payload.content : line.message?.content)).join('\n');
}

/** Whether a record holds a compaction (tech notes, sections 2 and 3). */
const compactionsIn = (harness, lines) => lines.filter((line) => (harness === 'codex'
  ? line.type === 'compacted'
  : line.type === 'system' && line.subtype === 'compact_boundary')).length;

/** `obk health` for the fleet, read whatever it exits with: findings exit non-zero. */
function health(bots) {
  const done = obk(['health', '--bots', bots, '--json']);
  try {
    return JSON.parse(done.stdout);
  } catch {
    assert.fail(`obk health --json did not print JSON: ${done.stdout}${done.stderr}`);
  }
}

/** One session's entry in `obk health`'s answer. */
function healthOf(answer, bot, session) {
  const found = (answer.sessions ?? []).filter((one) => one.bot === bot && one.session === session);
  assert.equal(found.length, 1, `one health entry for ${bot} ${session}, got: ${JSON.stringify(answer.sessions)}`);
  return found[0];
}

/** The two bots, one per harness, and the words each is checked with. */
const BOTS = [
  { harness: 'claude', name: 'clear-claude', word: 'OSPREY-4471', marker: 'HERON-2208' },
  { harness: 'codex', name: 'clear-codex', word: 'PLOVER-6093', marker: 'AVOCET-3517' },
];

/** The start prompt: the word lives here and nowhere else. */
const promptFor = (bot) => 'You are a system test\'s bot and you own nothing. Read or write no file and use no tool,'
  + ' except to run a shell command when a line in this tab asks for one by name. Your word is'
  + ` ${bot.word}. When asked for your word, reply with it and nothing else. Otherwise say nothing and wait.`;

for (const bot of BOTS) {
  test(`session clear and compact on ${bot.harness}: refused while busy, a briefed new conversation on the current rules when idle, and a compact or a "cannot"`, async (t) => {
    const before = {
      handles: new Set(allTerminals().map((terminal) => terminal.handle)),
      setups: new Set(allSetups().map((setup) => setup.id)),
    };

    const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), `obk-system-clear-${bot.harness}-`)));
    const homeOf = (name) => path.join(bots, 'bots', name);
    const home = homeOf(bot.name);
    const homes = [homeOf('bot-father'), home];

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
      await removeBotsFolderAndSiblings(bots);

      const { closedNotOurs, goneElsewhere } = guard.verdict(before.handles);
      assert.deepEqual(closedNotOurs, [], 'this test closed tabs it did not create');
      if (goneElsewhere.length > 0) t.diagnostic(`tabs open before this test and closed elsewhere meanwhile: ${goneElsewhere.join(', ')}`);
      for (const one of homes) {
        assert.deepEqual(await terminalsAfterClosing(one, closed), [], `this test left tabs behind in ${one}`);
      }
      assert.deepEqual(failedDeletes, [], 'projects this test could not remove, left in Orca');
    });

    obkJson(['init', '--bots', bots, '--harness', 'claude']);
    obkJson([
      'bot', 'create', '--bots', bots, '--name', bot.name, '--harness', bot.harness,
      '--charter', `${bot.name} exists for one system test run and owns nothing.`,
    ]);
    obkJson([
      'session', 'add', '--bots', bots, '--bot', bot.name, '--name', 'daily', `--prompt=${promptFor(bot)}`,
      ...(bot.harness === 'codex' ? codexTrustArgs(bots) : []),
    ]);

    const entry = tabOf(obkJson(['up', '--bots', bots, '--bot', bot.name]), 'daily');
    assert.equal(entry.created, true);
    assert.equal(entry.harnessStarted, true, `no ${bot.harness} came up in ${entry.title}: \`orca terminal read --terminal ${entry.terminal} --screen\``);
    const handle = entry.terminal;

    /**
     * `obk session <verb>` for this bot's session. When it fails, the tab's
     * screen as Orca renders it goes into the run's diagnostics, so a refusal
     * comes with the layout it saw (on the first live run Codex 0.160.0's
     * input line after `/new` was not the one the unit fixture has).
     */
    const sessionCall = (verb, flags = []) => {
      const done = obk(['session', verb, '--bots', bots, '--bot', bot.name, '--session', 'daily', ...flags]);
      if (done.status !== 0) {
        t.diagnostic(`obk session ${verb} exited ${done.status}: ${(done.stdout + done.stderr).trim()}\n  the tab's screen now:\n    ${screenRows(handle)}`);
      }
      return done;
    };

    // A Claude bot's folder trust, which this test answers itself, once, and
    // only when it is the plain one for this tab's own folder (the ruling on
    // #391, option (c); the same check as send-outside-fleet's under #451).
    if (bot.harness === 'claude') {
      const asked = await until(
        `${bot.name} daily to show Claude Code's folder trust, or report its conversation`,
        READY_MS,
        async () => {
          if (typeof sessionIn(home, 'daily').session === 'string') return { rows: null };
          const rows = rowsOf(handle);
          return rows !== undefined && rows.some((row) => row.includes('Yes, I trust this folder')) ? { rows } : undefined;
        },
        () => whatIsUp(handle),
      );
      if (asked.rows !== null) {
        const wrong = claudeTrustAt(asked.rows, home, bots, cliEntry);
        assert.equal(
          wrong,
          undefined,
          `${entry.title}'s folder trust is not one this test may answer, so it answered nothing: ${wrong}.`
          + `\n  what it showed:\n    ${asked.rows.join('\n    ')}`,
        );
        const sent = orca(['terminal', 'send', '--terminal', handle, '--text', '\x1b[B\r']);
        assert.equal(sent.ok, true, `answering ${entry.title}'s folder trust failed: ${JSON.stringify(sent.error)}`);
        t.diagnostic(`answered ${entry.title}'s plain folder trust (the ruling on #391, option (c))`);
      }
    }

    // Claude Code's "Teach auto mode about your environment?" form, which
    // 2.1.288 put up after the session's first turn on live run 3 (#416's
    // form). This test answers it with Esc, "Not now", once, in its own tab,
    // and only when every row from its title down is the captured form's (the
    // architect's ruling on #391 after live run 3). Esc teaching nothing is
    // read in the 2.1.283 binary and not seen live, so the run shows it: the
    // form gone, and ~/.claude.json's autoModeEnvSetup, which only the accept
    // path clears (tech notes, section 1), as it was. Anything else fails.
    const TEACH_TITLE = 'Teach auto mode about your environment?';
    const claudeJson = path.join(os.homedir(), '.claude.json');
    const autoModeState = () => {
      try {
        const held = JSON.parse(readFileSync(claudeJson, 'utf8')).autoModeEnvSetup;
        return held === undefined ? 'absent' : JSON.stringify(held);
      } catch (error) {
        return `unreadable (${error.message})`;
      }
    };
    let taught = false;
    const teach = async (rows) => {
      if (bot.harness !== 'claude' || !rows.some((row) => row.trim() === TEACH_TITLE)) return;
      assert.equal(taught, false, `the Teach form came up again in ${entry.title}, and this test answers it at most once:\n    ${rows.join('\n    ')}`);
      const wrong = onlyTeachFormOf(rows);
      assert.equal(
        wrong,
        undefined,
        `${entry.title}'s Teach form is not the captured one, so this test answered nothing: ${wrong}.\n  what it showed:\n    ${rows.join('\n    ')}`,
      );
      const was = autoModeState();
      const sent = orca(['terminal', 'send', '--terminal', handle, '--text', '\x1b']);
      assert.equal(sent.ok, true, `answering ${entry.title}'s Teach form with Esc failed: ${JSON.stringify(sent.error)}`);
      taught = true;
      await until(
        `${entry.title}'s Teach form to go after Esc`,
        15000,
        async () => ((rowsOf(handle) ?? []).some((row) => row.trim() === TEACH_TITLE) ? undefined : true),
        () => whatIsUp(handle),
      );
      await setTimeout(2000);
      const now = autoModeState();
      assert.equal(now, was, `Esc on the Teach form taught nothing: ~/.claude.json's autoModeEnvSetup should be as it was (before: ${was}, after: ${now})`);
      t.diagnostic(`answered ${entry.title}'s Teach form with Esc; it went, and ~/.claude.json's autoModeEnvSetup stayed ${was}`);
    };

    // The kit's naming of a Codex thread (#480, #516). At each turn end the
    // kit's Stop hook types `/rename <bot>.<session>` into this tab, until
    // Codex holds that name for the thread. It races with whatever this test
    // types next. So, on Codex only, once the tab is idle after a turn and
    // before the test types or runs a kit command that types, this waits for
    // the newest line for the thread the book holds, in
    // ~/.codex/session_index.jsonl, to give that name. Not by 60 s: the run
    // fails there, naming the thread and showing the tab, its draft and
    // Codex's warning. Then the tab is let go idle again.
    const named = async (before) => {
      if (bot.harness !== 'codex') return;
      const id = sessionIn(home, 'daily').session;
      assert.equal(typeof id, 'string', `the premise: the book holds a conversation for ${bot.name} daily before ${before}: ${JSON.stringify(sessionIn(home, 'daily'))}`);
      const name = `${bot.name}.daily`;
      if (threadNameOf(id) === name) return;
      const started = Date.now();
      while (threadNameOf(id) !== name) {
        if (Date.now() - started >= NAMED_MS) {
          const rows = screenRows(handle);
          const draft = draftOf(handle);
          const warning = await codexWarning(handle);
          assert.fail(`the kit's naming of thread ${id} as ${name} did not land within ${NAMED_MS} ms of the turn's end, before ${before}:`
            + ` the newest line for it in ${SESSION_INDEX} names it ${JSON.stringify(threadNameOf(id) ?? null)}.`
            + `\n  orca terminal read --terminal ${handle} --screen\n    ${rows}`
            + `\n  Orca's draft: ${draft}`
            + `\n  Codex's warning, read with F2 and closed with Esc:\n    ${warning}`);
        }
        await setTimeout(1000);
      }
      t.diagnostic(`the kit named thread ${id} ${name} ${Date.now() - started} ms after the tab was idle, before ${before}`);
      await idle(handle, teach);
    };

    // The session's first conversation, reported by the hook, and the tab idle.
    const first = await until(
      `${bot.name} daily to report its conversation`,
      READY_MS,
      async () => sessionIn(home, 'daily').session,
      () => whatIsUp(handle),
    );
    await idle(handle, teach);
    await named('step 0\'s "/"');

    // 0. A recorded fact, not a check that fails the run either way: whether an
    //    open slash popup turns Orca's tui-idle off, which live run 3 worked
    //    out and did not see (the ruling after live run 3). The test types "/"
    //    into its own idle tab, records tui-idle and the screen, and takes the
    //    "/" back with one backspace. That the "/" went is checked: the tab is
    //    the test's own, and what follows types into it.
    const tuiSaid = (look) => JSON.stringify(look.answer.ok === true ? look.answer.result?.wait : look.answer.error);
    const quiet = tuiBusy(handle);
    const slash = orca(['terminal', 'send', '--terminal', handle, '--text', '/']);
    assert.equal(slash.ok, true, `typing "/" into ${entry.title} failed: ${JSON.stringify(slash.error)}`);
    await setTimeout(1500);
    const open = tuiBusy(handle);
    const openRows = rowsOf(handle) ?? ['(unreadable)'];
    const back = orca(['terminal', 'send', '--terminal', handle, '--text', '\x7f']);
    assert.equal(back.ok, true, `taking the "/" back from ${entry.title} failed: ${JSON.stringify(back.error)}`);
    await setTimeout(1500);
    const shut = tuiBusy(handle);
    const shutRows = rowsOf(handle) ?? [];
    t.diagnostic(`a "/" typed into idle ${bot.harness}: tui-idle before it ${tuiSaid(quiet)}; with the popup open ${tuiSaid(open)}; after the backspace ${tuiSaid(shut)}.`
      + ` The screen with the popup open:\n    ${openRows.join('\n    ')}`);
    const input = shutRows.findLast((row) => /^\s*[›❯]/.test(row));
    assert.ok(input !== undefined && !/^\s*[›❯]\s*\//.test(input), `the "/" was taken back: the input line reads ${JSON.stringify(input)}:\n    ${shutRows.join('\n    ')}`);
    await idle(handle, teach);
    await named('the busy turn');

    // The rules change before the clear: a line only the new AGENTS.md holds.
    obkJson(['bot', 'change', '--bots', bots, '--bot', bot.name, '--charter', `${bot.name} exists for one system test run and owns nothing. Its charter marker is ${bot.marker}.`]);
    assert.ok(readFileSync(path.join(home, 'AGENTS.md'), 'utf8').includes(bot.marker), 'the premise: AGENTS.md holds the marker');
    const older = health(bots);
    assert.equal(healthOf(older, bot.name, 'daily').rules?.state, 'older', `the premise: health says older rules before the clear: ${JSON.stringify(older)}`);
    const offer = (older.found ?? []).find((one) => one.where === path.join(home, 'AGENTS.md'));
    assert.ok(offer?.says.includes('session clear'), `the older-rules finding offers obk session clear: ${JSON.stringify(older.found)}`);

    // 1. Busy: a turn that runs longer than the kit waits. The clear refuses
    //    and types nothing.
    //    Busy is what the kit itself goes by: Orca's tui-idle not answering
    //    ok. On Claude Code that is the whole test, and this run must show it
    //    reading busy while the foreground command runs. On Codex, whose
    //    tui-idle can answer ok while it works (tech notes, section 1), the
    //    kit also goes by "esc to interrupt" on screen, and so does this wait.
    await pressIn(handle, BUSY_LINE);
    const atWork = await until(
      `${bot.name} daily to be at work on its foreground command, as Orca's tui-idle reads it`,
      BUSY_START_MS,
      async () => {
        const look = tuiBusy(handle);
        const rows = rowsOf(handle) ?? [];
        if (look.busy || (bot.harness === 'codex' && isBusy(rows))) return { look, rows };
        return undefined;
      },
      () => whatIsUp(handle),
    );
    if (bot.harness === 'claude') {
      assert.equal(atWork.look.busy, true, `on Claude Code, tui-idle reads busy while the foreground command runs: ${JSON.stringify(atWork.look.answer)}`);
    }
    t.diagnostic(`${bot.harness} at work: tui-idle answered ${JSON.stringify(atWork.look.answer.ok === true ? atWork.look.answer.result?.wait : atWork.look.answer.error)};`
      + ` its status rows: ${JSON.stringify(statusRows(atWork.rows))}`);
    const refused = sessionCall('clear');
    assert.notEqual(refused.status, 0, `a clear on a busy session should be refused: ${refused.stdout}${refused.stderr}`);
    assert.match(refused.stdout + refused.stderr, /busy/i, `and say it is busy: ${refused.stdout}${refused.stderr}`);
    assert.equal(sessionIn(home, 'daily').session, first, 'the book holds the same conversation: nothing was cleared');
    const typedIn = (rowsOf(handle) ?? []).filter((row) => /^\s*[›❯]\s*\/(?:clear|new)\b/.test(row));
    assert.deepEqual(typedIn, [], `and nothing was typed into the input line: ${(rowsOf(handle) ?? []).join('\n')}`);

    // 2. Idle: the clear gives a new conversation in the book.
    await idle(handle, teach);
    await named('obk session clear');
    const clear = sessionCall('clear', ['--json']);
    assert.equal(clear.status, 0, `the clear on an idle session should go through: ${clear.stdout}${clear.stderr}\n  the tab's screen now:\n    ${screenRows(handle)}`);
    const { cleared } = JSON.parse(clear.stdout);
    assert.equal(cleared?.bot, bot.name, JSON.stringify(cleared));
    assert.equal(cleared.session, 'daily');
    assert.equal(cleared.harness, bot.harness);
    assert.equal(cleared.was, first, 'the answer says which conversation it was');
    assert.notEqual(cleared.now, first, 'and a new one');
    assert.equal(sessionIn(home, 'daily').session, cleared.now, 'the book holds the new conversation');

    // 3. The new conversation was briefed by the hook: asked for its word, it
    //    answers it, though the question does not carry it. On Codex, the new
    //    conversation is a new thread, which the kit names after its first
    //    turn: the clear's own line. The wait is for that thread's name.
    await idle(handle, teach);
    await named('the question');
    await pressIn(handle, 'What is your word? Reply with it and nothing else.');
    await until(
      `the new conversation ${cleared.now} to answer with its word`,
      ANSWER_MS,
      async () => (modelSaid(bot.harness, recordOf(bot.harness, home, cleared.now)).includes(bot.word) ? true : undefined),
      () => whatIsUp(handle),
    );

    // 4. It read the AGENTS.md there is now, and health agrees.
    const lines = recordOf(bot.harness, home, cleared.now);
    if (bot.harness === 'codex') {
      const instructions = lines.filter((line) => line.type === 'response_item' && line.payload?.role === 'user'
        && JSON.stringify(line.payload.content).includes('AGENTS.md instructions'));
      assert.ok(instructions.length > 0, `the new rollout carries an "AGENTS.md instructions" message: ${codexRecord(cleared.now)}`);
      assert.ok(instructions.some((line) => JSON.stringify(line.payload.content).includes(bot.marker)), `and it holds the line added before the clear, ${bot.marker}: ${codexRecord(cleared.now)}`);
    } else {
      assert.ok(lines.some((line) => JSON.stringify(line).includes(bot.marker)), `the new transcript carries the line added before the clear, ${bot.marker}: ${claudeRecord(home, cleared.now)}`);
    }
    assert.equal(healthOf(health(bots), bot.name, 'daily').rules?.state, 'current', 'health says the session is on the current rules after the clear');

    // 5. A compact, or the harness says it cannot.
    await idle(handle, teach);
    await named('obk session compact');
    const compactions = compactionsIn(bot.harness, recordOf(bot.harness, home, cleared.now));
    const compact = sessionCall('compact', ['--json']);
    const said = compact.stdout + compact.stderr;
    if (compact.status === 0) {
      // Not confirmed in the kit's 5 minutes is not a failure (the architect's
      // ruling on #391): the answer says so, and this run reports it.
      const { confirmed, ...compacted } = JSON.parse(compact.stdout).compacted ?? {};
      assert.deepEqual(compacted, { bot: bot.name, session: 'daily', harness: bot.harness, conversation: sessionIn(home, 'daily').session });
      assert.equal(typeof confirmed, 'boolean', `the answer says whether the compact was confirmed: ${compact.stdout}`);
      if (confirmed) {
        assert.ok(compactionsIn(bot.harness, recordOf(bot.harness, home, compacted.conversation)) > compactions, 'a confirmed compact: the record holds a new compaction');
      } else {
        t.diagnostic(`the compact on ${bot.harness} was entered and not confirmed within the kit's wait: ${said.trim()}`);
      }
    } else {
      assert.equal(bot.harness, 'codex', `Claude Code has /compact, so its compact should go through: ${said}`);
      assert.match(said, /can(?:not|'t|’t) compact/i, `a refused compact says this harness cannot compact: ${said}`);
      t.diagnostic(`Codex did not compact: ${said.trim()}`);
    }
  });
}
