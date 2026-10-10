// A system test, and the live proof #240 asks for before any other Codex test
// changes: a Codex session the kit launches with trust given at launch starts
// with no folder-trust question and no hooks review, its hooks still run, and
// nothing about this test's folder is written into the user's own
// ~/.codex/config.toml. Against the real Codex in the real Orca on this
// machine. Run it alone with
// `npm run test:system -- --yes test/system/codex-trust-override.test.js`;
// `npm test` cannot, and no CI machine could.
//
// Why: every folder trust and hooks trust a test answers in a Codex tab is
// written into the user's own config.toml and stays after the throwaway folder
// is gone (#240: 118 `[projects` and 69 `[hooks` headers counted on this
// machine, most for folders that no longer exist). The architect ruled option
// (c) for Codex: the test never makes Codex write trust, and passes it as a
// launch-time override instead. Read in Codex 0.158.0's source for #240, and
// not yet seen live, which is what this test is for:
//
//   -c projects={"<bots folder>"={trust_level="trusted"}}   the folder's trust,
//                     a whole TOML table in one -c (the dotted key form splits on
//                     every `.` and does not work); Codex asks, and writes, only
//                     when trust is unset, and looks at the session's folder and
//                     then its git root, the bots folder, by its realpath
//   --dangerously-bypass-hook-trust   no hooks review, so no hooks.state entry;
//                     the hooks still run, the project being trusted
//   -c tui.show_tooltips=false        no model-availability notice counted
//                     into the file at startup
//
// They reach the session the way any user's own arguments do: `obk session add
// … --extra-arg=…`, one argument each (test/helpers/codex-trust.js). The kit
// itself does not change.
//
// What it requires:
//
//   1. The premise: the codex in the tab was started with those three
//      arguments (`ps`, one pid, its command line).
//   2. No folder-trust question and no hooks review ever shows in the Codex
//      tab. The test never answers one: if one shows, it fails at once and
//      names what it saw, since then the override did not work.
//   3. The kit's own SessionStart hook still runs: the book learns the
//      session's conversation. And the session's start prompt gets its one
//      turn.
//   4. ~/.codex/config.toml has no `[projects."…"]` and no `[hooks.state."…"]`
//      table for a path under this test's throwaway folder, in either spelling
//      (`/var/…` or `/private/var/…`), that it did not have before: checked
//      after the session's turn, and again in the teardown, after its tab is
//      closed. The file is read only by those table headers (`trustKeysIn`),
//      never written, and nothing else in it is printed: it may hold secrets.
//
// If it fails at 2, the trust Codex asked for was not answered, so none was
// written; but a run that meets a question another way, or a Codex that writes
// trust on its own, can leave one entry behind for this test's folder. That
// entry is the owner's to clear; this test does not edit the file.
//
// Out of it: Bot Father. The kit makes Bot Father a Claude session
// (`obk init --harness claude`), and Claude Code's folder trust is still the
// person attending's to answer, and is still written into the user's own
// ~/.claude.json. #240's Claude half waits on the owner's choice of option (a)
// or (b). Codex's other files under ~/.codex (history, sessions, logs, state)
// are outside #240's boxes.
//
// The machine it runs on is someone's working machine, with their own tabs
// open. So this test, like the ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory, new to
//     Codex, so Codex has never trusted it;
//   - writes down every terminal and workspace Orca already had, before it
//     creates anything;
//   - runs this checkout's `src/cli.js` by its full path, never the machine's
//     `obk`;
//   - types into no tab at all;
//   - closes only its own tabs, through the tab guard (`guard.closeOwnAt`), then
//     deletes its own workspaces, whatever happened;
//   - signals no process; `ps` is read one pid at a time.
//
// `orca terminal close --worktree … --all` is never run here, and the helper
// refuses to run it at all.
//
// **It is attended, lightly.** The bots folder is
// `<tmp>/obk-system-codex-trust-*`. `Bot Father daily` shows Claude Code's
// folder trust; nothing here waits on it, so leave it. `Trust Codex daily`
// should ask nothing: leave it alone, and if it shows a trust or hooks screen,
// do not answer it (the test fails, which is the finding). If Codex offers an
// update, accept it (PRD 6.5).
//
// It takes a minute or two: one harness and one start turn.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry } from '../helpers/cli.js';
import { addedUnder, codexTrustArgs, trustKeysIn } from '../helpers/codex-trust.js';
import { questionOn } from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { deleteOwnProject } from '../helpers/own-project.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/**
 * Remove the throwaway bots folder and everything the kit made beside it:
 * `<bots>.prompts` and the rest are siblings of the bots folder (PRD 6.3).
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

/** How long the kit's hook is given to tell the book the conversation, an update offer answered by a person included. */
const READY_MS = 180000;

/** How long a real agent is given for its turn. */
const ANSWER_MS = 240000;

/** The user's own Codex config: read by its table headers only, never written. */
const CODEX_CONFIG = path.join(os.homedir(), '.codex', 'config.toml');

/** The trust tables config.toml holds now, by key only. No file is none. */
const trustNow = () => trustKeysIn(existsSync(CODEX_CONFIG) ? readFileSync(CODEX_CONFIG, 'utf8') : '');

/**
 * Ask Orca something and read its JSON. Never the blanket close, on any road.
 * Every tab it opens or closes is counted as this test's, for the check at the end.
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

/** Run `obk ... --json` and read the answer it printed. A tab it says it opened is this test's own. */
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
  return `${blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`}\n  orca terminal read --terminal ${handle} --screen\n  ${(rowsOf(handle) ?? ['(no rendered screen)']).join('\n  ')}`;
}

/**
 * Codex's two trust screens, known by their choices (helpers/screens.js,
 * CODEX_TRUST and CODEX_HOOKS_REVIEW, captured on 0.157.1): the folder-trust
 * question and the hooks review. Either one up in the tab means the override
 * did not take.
 */
const TRUST_SCREENS = [
  ['the folder-trust question', /\bTrust this folder\?|\b(?:Trust and continue|Yes, continue)\b/],
  ['the hooks review', /\bHooks need review\b|\bTrust all and continue\b|\bReview hooks\b/],
];

/** The trust screen up in the tab now, by name, or undefined. Read, never answered. */
function trustScreenIn(handle) {
  const rows = rowsOf(handle);
  if (rows === undefined) return undefined;
  const question = questionOn(rows);
  if (question === undefined) return undefined;
  return TRUST_SCREENS.find(([, words]) => question.some((row) => words.test(row)))?.[0];
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

const BOT = { name: 'trust-codex', title: 'Trust Codex daily' };

/** In the start prompt only, and asked for in lower case, so its echo is not its answer. */
const READY = 'READY-3419';

const startPrompt = [
  "You are a system test's bot and you own nothing.",
  'Do not run any command, read or write any file, or use any tool.',
  `Reply now with ${READY} in lower case and nothing else, and then wait.`,
].join(' ');

test('a Codex session launched with trust given at launch asks no trust, still runs its hooks, and leaves nothing in the user\'s config.toml', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
    trust: trustNow(),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-codex-trust-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', BOT.name].map(homeOf);
  const home = homeOf(BOT.name);

  /** What config.toml gained under this test's folder since the test began: none, or the keys. */
  const leftInConfig = () => addedUnder(before.trust, trustNow(), bots);

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    // Only this test's own tabs are closed. A tab it did not create at one of
    // its homes is not its to close: that project and the bots folder stay
    // where they are, and the test fails naming the tab (#426).
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
    // And after the session's tab is gone, still nothing of this test's in the user's config.toml.
    assert.deepEqual(
      leftInConfig(),
      { projects: [], hooks: [] },
      `~/.codex/config.toml gained trust for this test's folder ${bots} by the end of the run; it is the owner's to clear`,
    );
    assert.deepEqual(failedDeletes, [], 'projects this test could not remove, left in Orca');
  });

  obkJson(['init', '--bots', bots, '--harness', 'claude']);
  obkJson([
    'bot', 'create', '--bots', bots, '--name', BOT.name, '--harness', 'codex',
    '--charter', `${BOT.name} exists for one system test run and owns nothing.`,
  ]);
  const trustArgs = codexTrustArgs(bots);
  obkJson(['session', 'add', '--bots', bots, '--bot', BOT.name, '--name', 'daily', ...trustArgs, `--prompt=${startPrompt}`]);

  const entry = tabOf(obkJson(['up', '--bots', bots, '--bot', BOT.name]), 'daily');
  assert.equal(entry.created, true, 'the premise: up opened the Codex tab');
  const handle = entry.terminal;

  /** Fail at once, naming it, if a trust screen is up; it is never answered. */
  const noTrustScreen = () => {
    const seen = trustScreenIn(handle);
    assert.equal(seen, undefined, `Codex showed ${seen} in ${BOT.title}: the launch-time trust did not take. Nothing was answered.${whatIsUp(handle)}`);
  };

  // 1. The premise: the codex in the tab carries the launch-time arguments.
  const front = await until(`codex to be in front of ${BOT.title}`, READY_MS, async () => {
    noTrustScreen();
    const found = inFront(handle);
    return found?.name === 'codex' ? found : undefined;
  }, () => whatIsUp(handle));
  const argv = psOf(front.pid, ['-ww', '-o', 'command=']) ?? '';
  for (const arg of trustArgs.map((one) => one.slice('--extra-arg='.length)).filter((one) => one !== '-c')) {
    assert.ok(argv.includes(arg), `the premise: the codex in ${BOT.title} (pid ${front.pid}) was started with ${arg}`);
  }

  // 2 and 3. No trust screen while the kit's hook tells the book the
  // conversation and the start prompt gets its turn.
  const id = await until(`the kit's hook to tell the book ${BOT.title}'s conversation`, READY_MS, async () => {
    noTrustScreen();
    return (await sessionIn(home, 'daily')).session;
  }, () => whatIsUp(handle));
  t.diagnostic(`the book holds ${BOT.title}'s conversation ${id}: the kit's SessionStart hook ran`);
  await until(`the start turn to answer ${READY.toLowerCase()}`, ANSWER_MS, async () => {
    noTrustScreen();
    return (rowsOf(handle) ?? []).join('\n').includes(READY.toLowerCase()) ? true : undefined;
  }, () => whatIsUp(handle));
  noTrustScreen();

  // 4. Nothing of this test's folder in the user's config.toml.
  assert.deepEqual(
    leftInConfig(),
    { projects: [], hooks: [] },
    `~/.codex/config.toml gained trust for this test's folder ${bots} while its session ran; it is the owner's to clear`,
  );
});
