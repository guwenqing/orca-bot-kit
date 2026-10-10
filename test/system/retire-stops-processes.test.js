// A system test: `obk temp retire` stops the real processes a temporary
// session left running in its work dir, and nothing else (#537, the issue's
// live check). Against the real Orca, a real Claude Code, and the machine's
// real ps, lsof and kill. Run it alone with
// `npm run test:system -- --yes test/system/retire-stops-processes.test.js`;
// `npm test` cannot, and no CI machine could.
//
// The fake proves the rules (test/retire-stops-processes.test.js). This proves
// what a fake cannot: that the kit reads this machine's process table and
// working folders as they really print, and that its signals really end the
// processes. What it does, in a throwaway fleet:
//
//   1. A long-lived Claude Code session, lead, makes a temporary session, dev,
//      with `obk temp make`, which gives dev the work dir work/dev.
//   2. The test starts processes of its own, each in a new process group of
//      its own, as a harness's background command would be:
//        - plain      `sleep 600`, its working folder dev's work dir;
//        - stubborn   a node program that ignores SIGTERM, in the work dir;
//        - parent     a shell in the work dir, and its child, a `sleep 600`
//                     whose working folder is a throwaway folder outside it;
//        - bystander  a `sleep 600` in that outside folder, which is no
//                     process of dev's by any road.
//   3. lead runs `obk temp retire --name dev` from its tab. dev's tab is
//      closed, and then each of dev's processes is gone: plain, parent and
//      the child with SIGTERM, stubborn with SIGKILL after the wait. The
//      answer's `processes.stopped` names each, with the signal it took.
//   4. The bystander still runs, and is not named. The test then stops it by
//      its own pid.
//
// "From a session's tab" is how the kit finds a caller: by `ORCA_TAB_ID`,
// matched against the tab the book records (#250). The test runs this
// checkout's CLI with lead's tab id and handle and none of the ORCA_ or OBK_
// variables of wherever the test itself was started. lead is a Claude Code
// session, for which the kit asks no more than that (#408). Nothing types
// into any tab and no agent is asked anything.
//
// **It is not attended.** Nothing here waits on what a tab shows, so each tab's
// first-run screens (Claude Code's folder trust in lead's, dev's and Bot
// Father's) are left as they are and never answered; a person is not asked to
// answer them either. Were a screen ever to need an answer, the rule for every
// live run here is to answer it in the test's own tab, only through the
// allowlists in helpers/screens.js (`onlyPlainTrustOf`, `onlyTeachFormOf`), and
// to stop the run on any other screen.
//
// The machine it runs on is someone's working machine. So this test, like the
// ones beside it: works in a throwaway bots folder under the system temp
// directory; writes down every terminal and workspace Orca already had; runs
// this checkout's `src/cli.js` by its full path, never the machine's `obk`
// (#220); closes only its own tabs, through the tab guard, and deletes its own
// workspaces through `deleteOwnProject` (#536), whatever happened, failing at
// the end on any it could not remove. `orca terminal close --worktree … --all` is
// never run, and the guard refuses it. Each run leaves the fleet's
// orchestration Runs behind, which Orca offers no way to delete; the runner
// lists them.
//
// Killing processes (AGENTS.md, 2026-09-20): the processes the kit stops here
// are this test's own, each in a group of its own made at spawn (`detached`),
// so that no group the kit could signal holds anything of anyone else's. The
// test itself signals only the processes it started, by the pid it captured
// when it started them, after it has checked that the pid still runs the
// command it started and has printed the list. It never sends a signal to a
// group, and never to an id it read from `ps`. It reads `ps -p <pid>` only to
// see whether one of its own still runs. A minute or two.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry } from '../helpers/cli.js';
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

/** How long a process of the test's is given to start, or to be gone after the retire. */
const SETTLE_MS = 15000;

const BOT = 'stop-bot';
const LEAD = 'lead';
const DEV = 'dev';

/** dev's task: long enough to be kept in a file beside the bots folder, and asking for nothing. */
const TASK = 'You are a system test\'s session and you own nothing. Do not run any command, read or write any file,'
  + ' or use any tool. Say nothing now and wait. '
  + 'This session exists only to be made and retired by the test that made it. '.repeat(6);

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
 * unless `env` says which.
 */
function obk(args, env = outsideAnyTab) {
  const done = spawnSync(process.execPath, [cliEntry, ...args], { encoding: 'utf8', cwd: os.tmpdir(), env });
  assert.equal(done.error, undefined, `could not run \`obk\`: ${done.error?.message}`);
  assert.ok(!/worktree/i.test(done.stdout + done.stderr), `obk said "worktree": ${done.stdout}${done.stderr}`);
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

/** What the book says about one of the bot's sessions right now. */
const sessionIn = (home, name) => (parse(readFileSync(path.join(home, 'sessions.yaml'), 'utf8')) ?? {}).sessions?.[name] ?? {};

/** Give the kit's own account of tabs it closed to the guard: a retire's `closed`, as an array of `{ terminal }`. */
function closedByKit(entries) {
  if (Array.isArray(entries)) guard.closedByKit(entries);
}

/**
 * One of the test's own processes as ps sees it now, by the pid it captured
 * at spawn: `{ stat, command }`, or undefined when no such process runs. A
 * zombie, `Z`, has exited: it is gone.
 */
function running(pid) {
  const seen = spawnSync('/bin/ps', ['-o', 'stat=,command=', '-p', String(pid)], { encoding: 'utf8' });
  const line = seen.status === 0 ? seen.stdout.trim() : '';
  if (line === '') return undefined;
  const [, stat, command] = /^(\S+)\s+(.*)$/.exec(line) ?? [];
  return stat === undefined || stat.startsWith('Z') ? undefined : { stat, command };
}

/**
 * Whether one of the test's own processes still runs: a child of the test's
 * own while node has not seen it end, so its pid cannot have gone to anyone
 * else; another by its pid only while that pid runs the command it started.
 */
const alive = (one) => (one.child !== undefined
  ? one.child.exitCode === null && one.child.signalCode === null
  : running(one.pid)?.command === one.command);

/**
 * How long the teardown gives node to see a child of the test's end before it
 * takes the child for one that still runs. A child the kit stopped has exited,
 * and node sets its exit code only when its own event loop takes the exit; the
 * test can reach its teardown before that (the review of PR #537).
 */
const EXIT_MS = 2000;

/** Wait until node has seen `child` end, or `within` ms, whichever comes first. */
function ended(child, within) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return Promise.race([once(child, 'exit'), setTimeout(within)]);
}

/** Keep asking until `look` gives something other than undefined, or the time runs out. */
async function until(what, within, look) {
  const stop = Date.now() + within;
  for (;;) {
    const found = await look();
    if (found !== undefined) return found;
    assert.ok(Date.now() < stop, `gave up waiting for ${what} after ${within}ms`);
    await setTimeout(250);
  }
}

/** The first line a child writes on its standard output. */
function firstLine(child, what) {
  return new Promise((resolve, reject) => {
    let text = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      text += chunk;
      if (text.includes('\n')) resolve(text.slice(0, text.indexOf('\n')).trim());
    });
    child.once('exit', () => reject(new Error(`${what} ended before it said anything`)));
    child.once('error', reject);
  });
}

test('temp retire stops the real processes a temporary session left in its work dir, a child outside it and one that ignores TERM among them, and leaves a process outside it running', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-retire-stops-')));
  const outside = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-retire-stops-out-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', BOT].map(homeOf);
  const home = homeOf(BOT);

  /** Each process this test started: { name, pid, command, child }, `child` when it is this test's own child. */
  const mine = [];

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    // First the test's own processes that still run: by the pid captured when
    // it started them, only while that pid still runs the command it started,
    // and listed before anything is sent. Node is given the time to see each
    // child that has already exited end, so that one is not taken for one
    // that still runs.
    await Promise.all(mine.filter((one) => one.child !== undefined).map((one) => ended(one.child, EXIT_MS)));
    const still = mine.filter(alive);
    if (still.length > 0) {
      t.diagnostic(`stopping this test's own processes that still run: ${still.map((one) => `${one.name} ${one.pid} (${one.command})`).join('; ')}`);
      for (const one of still) {
        if (one.child !== undefined) one.child.kill('SIGKILL');
        else process.kill(one.pid, 'SIGKILL');
      }
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
    await rm(outside, { recursive: true, force: true });

    const { closedNotOurs, goneElsewhere } = guard.verdict(before.handles);
    assert.deepEqual(closedNotOurs, [], 'this test closed tabs it did not create');
    if (goneElsewhere.length > 0) t.diagnostic(`tabs open before this test and closed elsewhere meanwhile: ${goneElsewhere.join(', ')}`);
    for (const each of homes) {
      assert.deepEqual(await terminalsAfterClosing(each, closed), [], `this test left tabs behind in ${each}`);
    }
    const stop = Date.now() + SETTLE_MS;
    while (mine.some(alive) && Date.now() < stop) await setTimeout(250);
    assert.deepEqual(mine.filter(alive).map((one) => `${one.name} ${one.pid}`), [], 'this test left processes of its own running');
    assert.deepEqual(failedDeletes, [], 'projects this test could not remove, left in Orca');
  });

  // ---------------------------------------------------------------------------
  // 1. The fleet: Bot Father, and stop-bot on Claude Code with lead, which
  // makes dev.
  obkJson(['init', '--bots', bots, '--harness', 'claude']);
  obkJson([
    'bot', 'create', '--bots', bots, '--name', BOT, '--harness', 'claude',
    '--charter', `${BOT} exists for one system test run and owns nothing.`,
  ]);
  obkJson(['session', 'add', '--bots', bots, '--bot', BOT, '--name', LEAD, '--prompt', 'You are a system test\'s session and you own nothing. Say nothing and wait.']);
  const leadTab = openedIn(obkJson(['up', '--bots', bots, '--bot', BOT]), 'up');
  const lead = { tabId: sessionIn(home, LEAD).tab, handle: leadTab.terminal };
  assert.equal(typeof lead.tabId, 'string', `the premise: the book holds lead's tab, got: ${JSON.stringify(sessionIn(home, LEAD))}`);

  const devMade = obkJson(['temp', 'make', '--bots', bots, '--name', DEV, '--prompt', TASK], inTab(lead));
  const dev = { tabId: sessionIn(home, DEV).tab, handle: openedIn(devMade, 'temp make of dev').terminal };
  assert.equal(sessionIn(home, DEV).temporary?.maker, LEAD, `the premise: the book has dev as lead's: ${JSON.stringify(sessionIn(home, DEV))}`);
  const work = path.join(home, 'work', DEV);
  assert.ok(existsSync(work), `the premise: temp make gave dev its work dir, ${work}`);

  // ---------------------------------------------------------------------------
  // 2. The test's own processes, each in a new group of its own.
  const started = (name, child, command) => {
    mine.push({ name, pid: child.pid, command, child });
    return child;
  };
  const plain = started('plain', spawn('/bin/sleep', ['600'], { cwd: work, detached: true, stdio: 'ignore' }), '/bin/sleep 600');

  const STUBBORN = 'process.on("SIGTERM", () => {}); process.stdout.write("ready\\n"); setInterval(() => {}, 1000);';
  const stubborn = started('stubborn', spawn(process.execPath, ['-e', STUBBORN], { cwd: work, detached: true, stdio: ['ignore', 'pipe', 'ignore'] }), `${process.execPath} -e ${STUBBORN}`);
  // Its TERM handler is in place once it says so; a TERM before that would end it.
  assert.equal(await firstLine(stubborn, 'stubborn'), 'ready');

  // The shell waits on its child, which runs in the outside folder and whose
  // pid the shell says first.
  const PARENT = '(cd "$1" && exec /bin/sleep 600) & echo $!; wait';
  const parent = started('parent', spawn('/bin/sh', ['-c', PARENT, 'sh', outside], { cwd: work, detached: true, stdio: ['ignore', 'pipe', 'ignore'] }), `/bin/sh -c ${PARENT} sh ${outside}`);
  const childPid = Number(await firstLine(parent, 'parent'));
  assert.ok(Number.isInteger(childPid) && childPid > 1, `the shell names its child's pid, got: ${childPid}`);
  mine.push({ name: 'child', pid: childPid, command: '/bin/sleep 600' });

  const bystander = started('bystander', spawn('/bin/sleep', ['600'], { cwd: outside, detached: true, stdio: 'ignore' }), '/bin/sleep 600');

  await until('each of the test\'s processes to run', SETTLE_MS, () => (mine.every((one) => running(one.pid) !== undefined) ? true : undefined));
  t.diagnostic(`started: ${mine.map((one) => `${one.name} ${one.pid}`).join(', ')}; dev's work dir ${work}; outside ${outside}`);

  // ---------------------------------------------------------------------------
  // 3. lead retires dev, from its tab.
  const retired = obkJson(['temp', 'retire', '--bots', bots, '--name', DEV], inTab(lead));
  closedByKit(retired.closed);
  for (const entry of retired.retiredWith ?? []) closedByKit(entry.closed);
  assert.equal(retired.session, DEV, `the answer names dev: ${JSON.stringify(retired)}`);
  t.diagnostic(`processes in the answer: ${JSON.stringify(retired.processes)}`);

  const left = await terminalsAfterClosing(home, [dev.handle]);
  assert.ok(!left.some((one) => one.handle === dev.handle), 'dev\'s tab is closed in Orca');

  const gone = ['plain', 'stubborn', 'parent', 'child'];
  await until(`dev's processes (${gone.join(', ')}) to be gone`, SETTLE_MS, () => (
    mine.filter((one) => gone.includes(one.name)).every((one) => running(one.pid) === undefined) ? true : undefined
  ));

  const stopped = retired.processes?.stopped ?? [];
  const entryOf = (pid) => stopped.find((one) => one.session === DEV && one.pid === pid);
  for (const [name, pid, cwd, signal] of [
    ['plain', plain.pid, work, 'SIGTERM'],
    ['stubborn', stubborn.pid, work, 'SIGKILL'],
    ['parent', parent.pid, work, 'SIGTERM'],
    ['child', childPid, outside, 'SIGTERM'],
  ]) {
    const entry = entryOf(pid);
    assert.ok(entry !== undefined, `the answer names ${name} (${pid}) as stopped: ${JSON.stringify(retired.processes)}`);
    assert.equal(entry.cwd, cwd, `${name} is named in the folder it ran in`);
    assert.equal(entry.signal, signal, `${name} took ${signal}`);
    assert.equal(typeof entry.command, 'string', `${name} is named with its command`);
  }
  for (const [name, pid] of [['plain', plain.pid], ['child', childPid]]) {
    assert.equal(entryOf(pid).command, '/bin/sleep 600', `${name} is named by its whole command line`);
  }
  assert.ok(entryOf(stubborn.pid).command.includes('SIGTERM'), `stubborn is named by its whole command line, the program after -e included: ${entryOf(stubborn.pid).command}`);

  // ---------------------------------------------------------------------------
  // 4. The bystander still runs, and the answer does not name it.
  assert.equal(running(bystander.pid)?.command, '/bin/sleep 600', 'the process outside the work dir still runs');
  const named = [...stopped, ...(retired.processes?.left ?? [])].filter((one) => one.pid === bystander.pid);
  assert.deepEqual(named, [], 'and the answer does not name it');
  t.diagnostic(`stopping the bystander, this test's own, by its pid ${bystander.pid}`);
  bystander.kill('SIGTERM');
  await until('the bystander to end', SETTLE_MS, () => (running(bystander.pid) === undefined ? true : undefined));
});
