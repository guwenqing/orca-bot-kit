// A system test: Bot Father's management session moves from Claude Code to
// Codex (#565), against the real harnesses in the real Orca on this machine.
// Run it alone with
// `npm run test:system -- --yes test/system/session-harness-change.test.js`;
// `npm test` cannot, and no CI machine could.
//
// It is the live check of the issue's own case, point 6 of its requirement:
//
//   1. `obk init` brings Bot Father's `daily` up on Claude Code. It has one
//      turn, so its conversation is on Claude Code's record.
//   2. `obk session change --bot bot-father --session daily --harness codex`
//      goes through. It writes bot.yaml and nothing else: the running tab is
//      still there, and the book still names the Claude conversation.
//   3. `obk restart --bot bot-father --session daily` closes that tab and
//      opens a new one. The new tab runs Codex on a fresh conversation, not a
//      resume of the Claude id. The run's answer says `resumed: false` and
//      `harnessChanged: <the Claude id>`.
//   4. The book's history ends with the Claude id, `ended: 'harness changed'`,
//      `harness: claude`. Once Codex has had a turn, the book holds Codex's
//      own id, and Codex's record of it ran in Bot Father's folder.
//
// The machine it runs on is someone's working machine, with their own tabs
// open. So this test, like the others beside it:
//
//   - works in a throwaway bots folder under the system temp directory;
//   - writes down every terminal and workspace Orca already had, before it
//     creates anything;
//   - touches only what it created, matched by handle and by workspace path;
//   - types only into its own Bot Father daily tab: one short line on each
//     harness, and the answers to the screens named below;
//   - closes its own tabs one by one (`--terminal <handle> --tab`) and then
//     deletes its own workspaces, whatever happened, and checks afterwards
//     that it closed no tab it did not create.
//
// `orca terminal close --worktree … --all` is never run here, and the helper
// below refuses to run it at all.
//
// One thing it cannot clean up, as messaging.test.js says of itself: the Run
// mailboxes `up` makes. Orca has no `run-delete`.
//
// The screens it answers itself, in its own throwaway tab alone, and no other:
//
//   - Claude Code's folder trust in Bot Father daily, with down and return,
//     once, only when helpers/claude-trust.js `claudeTrustAt` takes it: the
//     plain screen (`onlyPlainTrustOf`) or the one that pre-approves exactly
//     the kit's default rules for this bots folder (#558).
//   - Claude Code's "Teach auto mode about your environment?" form after the
//     first turn, with Esc, at most once, only when `onlyTeachFormOf` takes
//     it; ~/.claude.json's autoModeEnvSetup is then checked unchanged.
//
// Codex is given its folder's trust at launch (#240, test/helpers/codex-trust.js):
// the same `session change` call that moves the session gives it those extra
// arguments, so Codex asks neither its folder trust nor its hooks review. Any
// other screen, a Codex update offer included, is the person's: it gets no
// keypress, and the wait that meets it fails, printing the screen.
//
// It takes a few minutes: two real harnesses, one short turn on each.

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
import { claudeTrustAt, trustScreenMet } from '../helpers/claude-trust.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { deleteOwnProject, placesOf, projectsInBots } from '../helpers/own-project.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/** The Orca CLI that works for a normal user (tech notes, section 1). */
const ORCA = process.env.OBK_ORCA || '/Applications/Orca.app/Contents/Resources/bin/orca';

/** How long a tab is given to be ready: a first run has screens on it. */
const READY_MS = 180000;

/** How long a session is given to finish one short turn, and its harness to write it down. */
const TURN_MS = 180000;

/** How long the tab is given to take a key in before the return that goes after it. */
const KEY_GAP_MS = 1000;

/** The one line typed into the session on each harness: a turn, so the harness keeps a record. */
const ONE_TURN = 'Reply with the single word OK and nothing else. Run no command and use no tool.';

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
 * `<bots>.prompts`, `<bots>.messages` and `<bots>.locks` are siblings of the
 * bots folder and not children of it.
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

/** Run `obk ... --json`, which has to go through, and read its answer. A tab it says it opened is this test's own. */
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

/** One session's entry in a bot's bot.yaml now. */
const entryIn = (home, name) => (parse(readFileSync(path.join(home, 'bot.yaml'), 'utf8'))?.sessions ?? []).find((one) => one?.name === name) ?? {};

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

/** What the tab is showing, for the message of a wait that ran out. */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  return [
    blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`,
    ' This test answers only the screens its header names; answer this one in Orca and run again.',
    `\n  orca terminal read --terminal ${handle} --screen\n    ${(rowsOf(handle) ?? ['(unreadable)']).join('\n    ')}`,
  ].join('');
}

/** Codex at work says how to interrupt it. */
const isBusy = (rows) => rows.some((row) => /esc to interrupt/i.test(row));

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
  if (!existsSync(root)) return undefined;
  const name = readdirSync(root, { recursive: true }).find((one) => String(one).endsWith(`-${id}.jsonl`));
  return name === undefined ? undefined : path.join(root, String(name));
}

test('Bot Father daily moves from Claude Code to Codex: session change --harness codex, then restart, starts Codex fresh with the Claude id in history', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-harness-change-')));
  const home = path.join(bots, 'bots', 'bot-father');
  const homes = [home];

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    const { closed, foreign } = guard.closeOwnAt(placesOf(homes, allSetups(), bots));
    const held = new Set(foreign.map((one) => one.home));
    let deleted = 0;
    const failedDeletes = [];
    for (const setup of projectsInBots(allSetups(), bots)) {
      if (before.setups.has(setup.id) || held.has(setup.path)) continue;
      try {
        await deleteOwnProject(setup, bots);
        deleted += 1;
      } catch (error) {
        failedDeletes.push(`${setup.path}: ${error.message}`);
      }
    }
    if (deleted > 0 && !(await reloadWindow())) t.diagnostic(RELOAD_LINE);
    assert.deepEqual(foreign, [], `tabs this test did not create are open at its home, so it closed only its own and left that project and ${bots} in place`);
    await removeBotsFolderAndSiblings(bots);

    const { closedNotOurs, goneElsewhere } = guard.verdict(before.handles);
    assert.deepEqual(closedNotOurs, [], 'this test closed tabs it did not create');
    if (goneElsewhere.length > 0) t.diagnostic(`tabs open before this test and closed elsewhere meanwhile: ${goneElsewhere.join(', ')}`);
    assert.deepEqual(await terminalsAfterClosing(home, closed), [], 'this test left tabs behind');
    assert.deepEqual(failedDeletes, [], 'projects this test could not remove, left in Orca');
  });

  // ---------------------------------------------------------------------------
  // 1. Bot Father daily on Claude Code, with one turn on its record.
  const daily = tabOf(obkJson(['init', '--bots', bots, '--harness', 'claude']), 'daily');
  assert.equal(daily.harnessStarted, true, `no claude came up in ${daily.title}: \`orca terminal read --terminal ${daily.terminal} --screen\``);
  const handle = daily.terminal;

  const asked = await until(
    'Bot Father daily to show Claude Code\'s folder trust, or report its conversation',
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
      `Bot Father daily's folder trust is not one this test may answer, so it answered nothing: ${wrong}.`
      + `\n  what it showed:\n    ${asked.rows.join('\n    ')}`,
    );
    const sent = orca(['terminal', 'send', '--terminal', handle, '--text', '\x1b[B\r']);
    assert.equal(sent.ok, true, `answering Bot Father daily's folder trust failed: ${JSON.stringify(sent.error)}`);
    t.diagnostic(`answered Bot Father daily's ${trustScreenMet(asked.rows)} (#558)`);
  }

  // Claude Code's "Teach auto mode" form, answered with Esc, at most once,
  // only when it is the captured one (see the header).
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
    if (!rows.some((row) => row.trim() === TEACH_TITLE)) return;
    assert.equal(taught, false, `the Teach form came up again in ${daily.title}, and this test answers it at most once:\n    ${rows.join('\n    ')}`);
    const wrong = onlyTeachFormOf(rows);
    assert.equal(
      wrong,
      undefined,
      `${daily.title}'s Teach form is not the captured one, so this test answered nothing: ${wrong}.\n  what it showed:\n    ${rows.join('\n    ')}`,
    );
    const was = autoModeState();
    const sent = orca(['terminal', 'send', '--terminal', handle, '--text', '\x1b']);
    assert.equal(sent.ok, true, `answering ${daily.title}'s Teach form with Esc failed: ${JSON.stringify(sent.error)}`);
    taught = true;
    await until(
      `${daily.title}'s Teach form to go after Esc`,
      15000,
      async () => ((rowsOf(handle) ?? []).some((row) => row.trim() === TEACH_TITLE) ? undefined : true),
      () => whatIsUp(handle),
    );
    await setTimeout(2000);
    const now = autoModeState();
    assert.equal(now, was, `Esc on the Teach form taught nothing: ~/.claude.json's autoModeEnvSetup should be as it was (before: ${was}, after: ${now})`);
    t.diagnostic(`answered ${daily.title}'s Teach form with Esc; it went, and ~/.claude.json's autoModeEnvSetup stayed ${was}`);
  };

  const claudeId = await until(
    'Bot Father daily to report its Claude conversation',
    READY_MS,
    async () => sessionIn(home, 'daily').session,
    () => whatIsUp(handle),
  );
  await idle(handle, teach);
  await pressIn(handle, ONE_TURN);
  // Claude Code writes a conversation down once it has had a turn (#295):
  // only then is the id on Claude Code's record, which is what makes the
  // restart below a harness change and not "no conversation".
  await until(
    `Claude Code's record of ${claudeId} to hold the turn`,
    TURN_MS,
    async () => (linesOf(claudeRecord(home, claudeId)).some((line) => line.type === 'assistant') ? true : undefined),
    () => whatIsUp(handle),
  );
  await idle(handle, teach);
  assert.equal(sessionIn(home, 'daily').session, claudeId, 'the premise: the book still holds the Claude conversation after its turn');

  // ---------------------------------------------------------------------------
  // 2. The move. It writes bot.yaml only: the tab and the book are as they were.
  const tabsBefore = terminalsAt(home).map((terminal) => terminal.handle).sort();
  const changed = obk([
    'session', 'change', '--bots', bots, '--bot', 'bot-father', '--session', 'daily', '--harness', 'codex',
    ...codexTrustArgs(bots),
  ]);
  assert.equal(changed.status, 0, `session change --harness codex should go through: ${changed.stdout}${changed.stderr}`);
  t.diagnostic(`session change said:\n  ${changed.stdout.trim().split('\n').join('\n  ')}`);
  assert.equal(entryIn(home, 'daily').harness, 'codex', `bot.yaml should give daily harness: codex, got: ${JSON.stringify(entryIn(home, 'daily'))}`);
  assert.equal(sessionIn(home, 'daily').session, claudeId, 'session change does not write the book');
  assert.deepEqual(terminalsAt(home).map((terminal) => terminal.handle).sort(), tabsBefore, 'and does not touch a tab');
  const others = tabsBefore.filter((one) => one !== handle);

  // ---------------------------------------------------------------------------
  // 3. The restart: the Claude tab goes, and Codex starts fresh in a new one.
  const answer = obkJson(['restart', '--bots', bots, '--bot', 'bot-father', '--session', 'daily']);
  guard.closedByKit(answer.closed);
  assert.deepEqual(
    (answer.closed ?? []).map((one) => one.terminal),
    [handle],
    `the restart closes daily's own tab and nothing else, got: ${JSON.stringify(answer.closed)}`,
  );
  const back = tabOf(answer, 'daily');
  assert.equal(back.created, true, 'a new tab was opened for daily');
  assert.equal(back.resumed, false, `the Claude id is not resumed on Codex, got: ${JSON.stringify(back)}`);
  assert.equal(back.harnessChanged, claudeId, `the run names the Claude id it set aside, got: ${JSON.stringify(back)}`);
  assert.equal('noConversation' in back, false, `the Claude id was on record, so it is not reported missing, got: ${JSON.stringify(back)}`);
  assert.equal(back.harnessStarted, true, `no codex came up in ${back.title}: \`orca terminal read --terminal ${back.terminal} --screen\``);

  const now = await terminalsAfterClosing(home, [handle]);
  assert.deepEqual(
    now.map((terminal) => terminal.handle).sort(),
    [...others, back.terminal].sort(),
    `daily's old tab is gone and Bot Father's other tabs are untouched, got: ${JSON.stringify(now)}`,
  );

  // ---------------------------------------------------------------------------
  // 4. The book: the Claude id in history, and Codex's own id once it has had a turn.
  const set = sessionIn(home, 'daily');
  const last = (set.history ?? []).at(-1) ?? {};
  assert.deepEqual(
    { session: last.session, ended: last.ended, harness: last.harness },
    { session: claudeId, ended: 'harness changed', harness: 'claude' },
    `the book's history ends with the Claude conversation, got: ${JSON.stringify(set)}`,
  );
  assert.match(String(last.at), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, `with an ISO time, got: ${JSON.stringify(last)}`);

  await idle(back.terminal);
  await pressIn(back.terminal, ONE_TURN);
  const codexId = await until(
    'the book to hold Codex\'s own conversation for daily',
    TURN_MS,
    async () => {
      const id = sessionIn(home, 'daily').session;
      return typeof id === 'string' && id !== claudeId ? id : undefined;
    },
    () => ` The book's entry for daily: ${JSON.stringify(sessionIn(home, 'daily'))}.${whatIsUp(back.terminal)}`,
  );
  const meta = await until(
    `Codex's record of ${codexId}`,
    TURN_MS,
    async () => linesOf(codexRecord(codexId)).find((line) => line.type === 'session_meta'),
    () => whatIsUp(back.terminal),
  );
  assert.equal(await realpath(meta.payload?.cwd ?? '/'), home, `Codex's conversation ran in Bot Father's folder, got: ${JSON.stringify(meta.payload)}`);
  assert.equal(codexRecord(claudeId), undefined, 'and Codex has nothing on record under the Claude id: it was not resumed');
  const after = sessionIn(home, 'daily');
  assert.ok(
    (after.history ?? []).some((old) => old?.session === claudeId && old?.ended === 'harness changed' && old?.harness === 'claude'),
    `the Claude id stays in the history once Codex reports its own, got: ${JSON.stringify(after)}`,
  );
  t.diagnostic(`daily moved: Claude ${claudeId} went into history, and Codex runs ${codexId}`);
});
