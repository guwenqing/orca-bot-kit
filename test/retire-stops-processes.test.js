// Retiring a session stops what it left running (#537,
// requests/retire-stops-processes/request.md). Seen twice on 2026-10-10: a
// retired developer session's test runs went on for hours with parent pid 1,
// and were a large part of the machine's load.
//
//   R1  When `obk temp retire` or `obk retire` retires a session that has a work
//       dir, the kit stops, after it closes the session's tab, each process of
//       the user's whose working folder is in that work dir, and each process
//       that descends from one of them, wherever its own working folder is.
//       Retiring a bot does the same for each of its sessions.
//   R2  It stops no process it cannot show to be the session's own by R1, nor
//       the retire's own run or a process that started it. A process that
//       shares a process group with the session's processes and is not its own
//       is named instead, with its pid, its working folder and its command.
//   R3  Gently, then surely: SIGTERM first, to the whole group where every
//       process in the group is the session's own and to each process by its
//       pid otherwise, then a wait of up to 3 seconds, then SIGKILL to each that
//       still runs. The retire names each process it stopped, with its pid,
//       working folder and command, and each it could not stop, with why.
//   R4  Where the kit cannot read the process table or the working folders, as
//       inside Codex's sandbox, where `ps` does not start, the retire says it
//       cannot tell which processes the session left running, and why, and
//       stops nothing. The retire itself still finishes.
//   (R5, `obk health`, is in health-retired-processes.test.js, and so is the
//   book keeping a retired session's work dir, which health reads.)
//
// The interface, as the brief gives it. The kit reads the table with
// `<OBK_PS> -A -ww -o pid=,ppid=,pgid=,uid=,stat=,command=`, the working
// folders with `<OBK_LSOF> -a -d cwd -u <uid> -Fpn`, and signals with
// `<OBK_KILL> -s TERM|KILL -- -<pgid>|<pid>`. All three are fakes here
// (helpers/fake-ps.js, helpers/fake-tty.js, helpers/fake-kill.js): the table
// is `processes` in the fake Orca's state.json, and the fake kill writes each
// call down and changes that table, and signals nothing. The `--json` answer
// of a retire of a session with a work dir gains
//
//   processes: { stopped: [{ session, pid, cwd, command, signal }],
//                left:    [{ session, pid, cwd, command, why }],
//                unreadable: '<why>' }      only for R4, with both lists empty
//
// and each entry of `retiredWith` carries its own. A session with no work dir
// gets no `processes`. The plain output gives a line starting `stopped` per
// process stopped, `left` per process left, and for R4 one starting
// `processes` that says the kit cannot tell.
//
// Read here, and said in the report: a process that KILL does not take is held
// to be one the kit could not stop, so it is under `left` and not `stopped`;
// a process already gone when its signal comes is not held to be left running.
//
// The pids are made up, from 51000 up: no fake tab's (40000 and up) and none
// of fake lsof's own (1063, 30001, 30002). The kit's own run is listed as the
// word 'kit', which the fakes answer with the real pid of the kit that runs
// them; and the process that started it is this test's own, by its real pid.
// Nothing here signals or reads a real process.
//
// Every run is in the sandbox (helpers/cli.js): its own HOME, a fake Orca, and
// fake harnesses on its own PATH. Nothing here reaches the real Orca, a real
// harness, or anything outside the sandbox.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import {
  bookIn,
  botHomeOf,
  createSandbox,
  kitLaunchMark,
  sessionIn,
  tabsOfBot,
} from './helpers/cli.js';
import { PS_TABLE } from './helpers/fake-ps.js';

const BOT = 'api-bot';

/** Every session's start prompt in the temporary family below; short, so it stays in bot.yaml. */
const TASK = 'Read the open pull request and write down what it changes.';

/** A uid that is not this user's: the user may not signal its processes. */
const OTHER_UID = process.getuid() + 1;

// ------------------------------------------------------------------ the fleet

/** The bots folder and api-bot's home in it. */
const botsOf = (box) => box.path('bots');
const homeOf = (box) => botHomeOf(botsOf(box), BOT);

/** Where a session's work dir is, as `work/<name>` under the bot home resolves. */
const workOf = (box, name) => path.join(homeOf(box), 'work', name);

/**
 * Bot Father, and api-bot with the sessions given as `[name, ...settings]`,
 * brought up. A session with `--work-dir` has its folder made by `up`; it is
 * made here as well, so a test about it does not rest on that.
 */
async function fleet(box, sessions) {
  const ok = async (args) => {
    const result = await box.run(args);
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  };
  await ok(['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  for (const [name, ...settings] of sessions) {
    await ok(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', name, ...settings]);
  }
  await ok(['up', '--bots', 'bots', '--bot', BOT]);
  for (const [name, ...settings] of sessions) {
    const at = settings.indexOf('--work-dir');
    if (at >= 0) await mkdir(path.resolve(homeOf(box), settings[at + 1]), { recursive: true });
  }
}

/** api-bot with one session, dev, whose work dir is work/dev. */
const devFleet = (box) => fleet(box, [['dev', '--work-dir', 'work/dev']]);

/** A throwaway folder in the kit's own temp folder, outside every work dir: where a test run keeps its fleets. */
const throwaway = (box) => mkdtemp(path.join(box.tmp, 'obk-run-'));

/** Put the fake process table in place: `processes` in the fake Orca's state (helpers/fake-ps.js). */
const table = (box, processes) => box.orca.set({ processes });

/** `obk retire --bot api-bot ...`, from outside any tab. */
const retire = (box, rest, options) => box.run(['retire', '--bots', 'bots', '--bot', BOT, ...rest], options);

/** The --json answer, which is JSON and nothing else. */
function answerIn(result) {
  assert.equal(result.code, 0, `the retire should finish, got: ${result.stdout}${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout}${result.stderr} (${error.message})`);
  }
}

/** The `processes` part of an answer, which must be there, with both lists. */
function processesIn(answer, who = 'the answer') {
  const { processes } = answer;
  assert.equal(typeof processes, 'object', `${who} should carry processes, got: ${JSON.stringify(answer)}`);
  assert.ok(processes !== null && Array.isArray(processes.stopped) && Array.isArray(processes.left), `processes should have stopped and left lists, got: ${JSON.stringify(processes)}`);
  return processes;
}

/** Every kill the kit asked for, as its argv, in order. */
const kills = async (box) => (await box.kill.calls()).map((call) => call.args);

/** The argv of one signal: `term(-51001)` is `-s TERM -- -51001`. */
const term = (target) => ['-s', 'TERM', '--', String(target)];
const kill = (target) => ['-s', 'KILL', '--', String(target)];

/** Every argv in `calls` that reaches `pid` by its own id or as its group's. */
const reaching = (calls, ...ids) => calls.filter((args) => ids.some((id) => args[3] === String(id) || args[3] === `-${id}`));

/** The pids of a list of processes, sorted. */
const pidsOf = (list) => list.map((one) => one.pid).sort((a, b) => a - b);

/** The argvs sorted, so that a set of signals sent in any order compares. */
const sorted = (calls) => [...calls].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

/** The names in api-bot's bot.yaml. */
const namesInBotYaml = async (box) => (parse(await readFile(path.join(homeOf(box), 'bot.yaml'), 'utf8')).sessions ?? []).map((one) => one?.name);

/** One session retired as a retire does it, whatever else happened: off bot.yaml and on the book's retired list. */
async function assertRetired(box, name) {
  assert.ok(!(await namesInBotYaml(box)).includes(name), `${name} is off bot.yaml`);
  const book = await bookIn(botsOf(box), BOT);
  assert.equal(book.sessions?.[name], undefined, `${name} is off the book's live list`);
  assert.equal((book.retired ?? []).filter((one) => one?.name === name).length, 1, `${name} is on the book's retired list once, got: ${JSON.stringify(book.retired)}`);
}

// ------------------------------------------------------------------ R1

test('R1 a process whose working folder is in the work dir is stopped with TERM to its group, and named with its pid, folder and command', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  const inside = path.join(workOf(box, 'dev'), 'repo');
  await mkdir(inside, { recursive: true });
  await table(box, [
    { pid: 51001, ppid: 1, pgid: 51001, cwd: inside, command: 'node --test test/slow.test.js' },
    // Someone else's, in a folder of their own: not dev's by any road.
    { pid: 51002, ppid: 1, pgid: 51002, cwd: path.join(box.home, 'elsewhere'), command: 'sleep 600' },
  ]);

  const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

  assert.deepEqual(await kills(box), [term(-51001)], 'one TERM, to the group of the process in the work dir, and nothing to anyone else');
  const processes = processesIn(answer);
  assert.deepEqual(processes.stopped, [
    { session: 'dev', pid: 51001, cwd: inside, command: 'node --test test/slow.test.js', signal: 'SIGTERM' },
  ]);
  assert.deepEqual(processes.left, [], 'nothing is left: the other process shares no group with dev\'s');
  assert.equal(processes.unreadable, undefined, 'the table was read');
  await assertRetired(box, 'dev');
});

test('R1 a descendant is the session\'s own wherever its working folder is: a child in a temp folder and a grandchild lsof names no folder for', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  const outside = await throwaway(box);
  await table(box, [
    { pid: 51011, ppid: 1, pgid: 51011, cwd: workOf(box, 'dev'), command: 'npm test' },
    { pid: 51012, ppid: 51011, pgid: 51012, cwd: outside, command: 'node --test' },
    { pid: 51013, ppid: 51012, pgid: 51013, command: 'node /tmp/obk-run/bin/obk up' },
  ]);

  const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

  assert.deepEqual(sorted(await kills(box)), sorted([term(-51011), term(-51012), term(-51013)]), 'each of the three groups gets one TERM, and nothing more');
  const { stopped } = processesIn(answer);
  assert.deepEqual(pidsOf(stopped), [51011, 51012, 51013]);
  assert.equal(stopped.find((one) => one.pid === 51012)?.cwd, outside, 'the child is named in the folder lsof gives it');
  assert.equal(stopped.find((one) => one.pid === 51013)?.cwd, null, 'the grandchild has no folder from lsof: null');
});

test('R1 a work dir that begins another\'s name does not reach it: retiring dev-53 leaves what runs in work/dev-537', async (t) => {
  const box = await createSandbox(t);
  await fleet(box, [['dev-53', '--work-dir', 'work/dev-53'], ['dev-537', '--work-dir', 'work/dev-537']]);
  await mkdir(path.join(workOf(box, 'dev-53'), 'sub'), { recursive: true });
  await table(box, [
    { pid: 51021, pgid: 51021, cwd: workOf(box, 'dev-537'), command: 'node --test' },
    { pid: 51022, pgid: 51022, cwd: workOf(box, 'dev-53'), command: 'sleep 600' },
    { pid: 51023, pgid: 51023, cwd: path.join(workOf(box, 'dev-53'), 'sub'), command: 'sleep 601' },
    { pid: 51024, pgid: 51024, cwd: `${workOf(box, 'dev-537')}/sub`, command: 'sleep 602' },
  ]);

  const answer = answerIn(await retire(box, ['--session', 'dev-53', '--json']));

  assert.deepEqual(sorted(await kills(box)), sorted([term(-51022), term(-51023)]), 'the work dir and the folder under it, and not dev-537\'s');
  assert.deepEqual(pidsOf(processesIn(answer).stopped), [51022, 51023]);
});

test('R1 a work dir reached through a link is matched by its real path, which is what lsof gives', async (t) => {
  const box = await createSandbox(t);
  const real = path.join(homeOf(box), 'work', 'real-dev');
  // The link is made before the session is up, so `up` finds it there.
  await fleet(box, [['daily']]);
  await mkdir(real, { recursive: true });
  await symlink(real, path.join(homeOf(box), 'work', 'dev'));
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'dev', '--work-dir', 'work/dev']);
  assert.equal(added.code, 0, `${added.stdout}${added.stderr}`);
  const up = await box.run(['up', '--bots', 'bots', '--bot', BOT]);
  assert.equal(up.code, 0, `${up.stdout}${up.stderr}`);
  await table(box, [{ pid: 51031, pgid: 51031, cwd: real, command: 'sleep 600' }]);

  const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

  assert.deepEqual(await kills(box), [term(-51031)]);
  assert.deepEqual(pidsOf(processesIn(answer).stopped), [51031]);
});

test('R1 nothing is signalled until the session\'s tab is closed', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  const tab = (await sessionIn(botsOf(box), BOT, 'dev'))?.tab;
  assert.equal(typeof tab, 'string', 'the premise: dev has a tab in the book');
  assert.ok((await tabsOfBot(box, botsOf(box), BOT)).some((one) => one.tabId === tab), 'the premise: dev\'s tab is open');
  await table(box, [{ pid: 51041, pgid: 51041, cwd: workOf(box, 'dev'), command: 'sleep 600' }]);

  const result = await retire(box, ['--session', 'dev', '--json']);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  const calls = await box.kill.calls();
  assert.deepEqual(calls.map((call) => call.args), [term(-51041)], 'the premise: the process was signalled');
  for (const call of calls) {
    assert.ok(!call.tabs.includes(tab), `dev's tab ${tab} was still open when the kit sent ${call.args.join(' ')}`);
  }
});

test('R1 a session with no work dir gets no processes and nothing is signalled; its sibling with one, retired next, does', async (t) => {
  const box = await createSandbox(t);
  await fleet(box, [['daily'], ['dev', '--work-dir', 'work/dev']]);
  await table(box, [
    // daily runs at the bot home with every other session that has no work
    // dir of its own, so nothing there can be told to be daily's.
    { pid: 51051, pgid: 51051, cwd: homeOf(box), command: 'sleep 600' },
    { pid: 51052, pgid: 51052, cwd: workOf(box, 'dev'), command: 'sleep 601' },
  ]);

  const daily = answerIn(await retire(box, ['--session', 'daily', '--json']));

  assert.equal('processes' in daily, false, `a session with no work dir has no processes in its answer, got: ${JSON.stringify(daily)}`);
  assert.deepEqual(await kills(box), [], 'nothing is signalled for a session with no work dir');
  await assertRetired(box, 'daily');

  const dev = answerIn(await retire(box, ['--session', 'dev', '--json']));

  assert.deepEqual(pidsOf(processesIn(dev).stopped), [51052]);
  assert.deepEqual(await kills(box), [term(-51052)], 'dev\'s, and still nothing at the bot home');
});

// ------------------------------------------------------------------ R1, the other roads

/** The environment of a command a session's harness runs in `terminal`. */
const inTab = (box, terminal) => ({ ...box.env, ORCA_TERMINAL_HANDLE: terminal.handle, ORCA_TAB_ID: terminal.tabId, ...kitLaunchMark(box, terminal) });

/** The tab the book gives a session, as Orca has it. */
async function liveTab(box, name) {
  const entry = await sessionIn(botsOf(box), BOT, name);
  assert.equal(typeof entry?.tab, 'string', `the book should hold a tab for ${name}, got: ${JSON.stringify(entry)}`);
  const terminal = (await tabsOfBot(box, botsOf(box), BOT)).find((one) => one.tabId === entry.tab);
  assert.ok(terminal, `Orca should have ${name}'s tab ${entry.tab}`);
  return terminal;
}

/** `obk temp make` from `maker`'s tab, which must work. */
async function made(box, maker, name) {
  const result = await box.run(['temp', 'make', '--bots', 'bots', '--name', name, '--prompt', TASK], { env: inTab(box, await liveTab(box, maker)) });
  assert.equal(result.code, 0, `obk temp make --name ${name}: ${result.stdout}${result.stderr}`);
  await mkdir(workOf(box, name), { recursive: true });
}

/**
 * api-bot with lead, long-lived and with no work dir; lead made scout, and
 * scout made reviewer, each in work/<name>. A process in each of their work
 * dirs, and one at the bot home, where lead runs.
 */
async function family(box) {
  await fleet(box, [['lead']]);
  await made(box, 'lead', 'scout');
  await made(box, 'scout', 'reviewer');
  await table(box, [
    { pid: 52001, pgid: 52001, cwd: workOf(box, 'scout'), command: 'node --test test/a.test.js' },
    { pid: 52002, pgid: 52002, cwd: workOf(box, 'reviewer'), command: 'node --test test/b.test.js' },
    { pid: 52003, pgid: 52003, cwd: homeOf(box), command: 'sleep 600' },
  ]);
}

test('R1 temp retire stops the temporary session\'s processes, and each session retired along with it carries its own in retiredWith', async (t) => {
  const box = await createSandbox(t);
  await family(box);

  const result = await box.run(['temp', 'retire', '--bots', 'bots', '--name', 'scout', '--json'], { env: inTab(box, await liveTab(box, 'lead')) });

  const answer = answerIn(result);
  assert.deepEqual(processesIn(answer).stopped.map((one) => [one.session, one.pid, one.signal]), [['scout', 52001, 'SIGTERM']]);
  assert.deepEqual((answer.retiredWith ?? []).map((one) => one.session), ['reviewer'], `the premise: reviewer went with scout, got: ${result.stdout}`);
  const reviewer = processesIn(answer.retiredWith[0], 'reviewer\'s entry in retiredWith');
  assert.deepEqual(reviewer.stopped.map((one) => [one.session, one.pid, one.signal]), [['reviewer', 52002, 'SIGTERM']]);
  assert.deepEqual(sorted(await kills(box)), sorted([term(-52001), term(-52002)]), 'and nothing at the bot home, where lead runs');
  await assertRetired(box, 'scout');
  await assertRetired(box, 'reviewer');
});

test('R1 obk retire of a maker with no work dir has no processes of its own, and its temporary sessions carry theirs in retiredWith', async (t) => {
  const box = await createSandbox(t);
  await family(box);

  const answer = answerIn(await retire(box, ['--session', 'lead', '--json']));

  assert.equal('processes' in answer, false, `lead has no work dir, so no processes, got: ${JSON.stringify(answer)}`);
  const along = Object.fromEntries((answer.retiredWith ?? []).map((one) => [one.session, one]));
  assert.deepEqual(Object.keys(along).sort(), ['reviewer', 'scout'], `the premise: both went with lead, got: ${JSON.stringify(answer.retiredWith)}`);
  assert.deepEqual(processesIn(along.scout, 'scout\'s entry').stopped.map((one) => one.pid), [52001]);
  assert.deepEqual(processesIn(along.reviewer, 'reviewer\'s entry').stopped.map((one) => one.pid), [52002]);
  assert.deepEqual(sorted(await kills(box)), sorted([term(-52001), term(-52002)]));
});

test('R1 retiring a bot stops what runs in the work dir of each of its sessions, each named by its session', async (t) => {
  const box = await createSandbox(t);
  await fleet(box, [['daily'], ['dev', '--work-dir', 'work/dev'], ['ops', '--work-dir', 'work/ops']]);
  await table(box, [
    { pid: 53001, pgid: 53001, cwd: workOf(box, 'dev'), command: 'node --test' },
    { pid: 53002, pgid: 53002, cwd: workOf(box, 'ops'), command: 'sleep 600' },
    { pid: 53003, pgid: 53003, cwd: homeOf(box), command: 'sleep 601' },
  ]);

  const answer = answerIn(await retire(box, ['--json']));

  assert.ok(typeof answer.moved === 'string', `the premise: the bot was retired and moved, got: ${JSON.stringify(answer)}`);
  const { stopped } = processesIn(answer);
  assert.deepEqual(
    stopped.map((one) => [one.session, one.pid, one.cwd]).sort((a, b) => a[1] - b[1]),
    [['dev', 53001, workOf(box, 'dev')], ['ops', 53002, workOf(box, 'ops')]],
    'each named in the folder it ran in before the bot moved to retired/',
  );
  assert.deepEqual(sorted(await kills(box)), sorted([term(-53001), term(-53002)]), 'and nothing at the bot home');
});

// ------------------------------------------------------------------ R2

test('R2 the retire\'s own run and the processes that started it are never stopped, though they sit in the work dir', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  const work = workOf(box, 'dev');
  // The kit started by this test, which a harness started: all of them in
  // the work dir, as a session that retires itself from its own tab would be.
  await table(box, [
    { pid: 51060, ppid: 1, pgid: 51060, cwd: work, command: 'claude' },
    { pid: process.pid, ppid: 51060, pgid: 51060, cwd: work, command: 'node --test' },
    { pid: 'kit', ppid: process.pid, pgid: 'kit', cwd: work, command: `node ${box.cli} retire --bots ${botsOf(box)} --bot ${BOT} --session dev` },
    { pid: 51061, ppid: 1, pgid: 51061, cwd: work, command: 'sleep 600' },
  ]);

  // Run from the work dir, so the bots folder is given by its full path.
  const answer = answerIn(await box.run(['retire', '--bots', botsOf(box), '--bot', BOT, '--session', 'dev', '--json'], { cwd: work }));

  const calls = await box.kill.calls();
  const kit = calls[0]?.caller;
  assert.deepEqual(calls.map((call) => call.args), [term(-51061)], `only the process that is dev's alone; the kit (${kit}), this test (${process.pid}) and the harness above it are not signalled`);
  assert.deepEqual(pidsOf(processesIn(answer).stopped), [51061]);
});

test('R2 a process that shares a group with the session\'s own and is not its own is named under left and never signalled; the own ones get TERM by pid', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  const outside = await throwaway(box);
  const elsewhere = path.join(box.home, 'elsewhere');
  await table(box, [
    { pid: 51071, ppid: 1, pgid: 51071, cwd: workOf(box, 'dev'), command: 'node --test' },
    { pid: 51072, ppid: 51071, pgid: 51071, cwd: outside, command: 'node test/child.js' },
    // In the same group, and no descendant of either, nor in the work dir.
    { pid: 51073, ppid: 1, pgid: 51071, cwd: elsewhere, command: 'tail -f server.log' },
  ]);

  const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

  const calls = await kills(box);
  assert.deepEqual(sorted(calls), sorted([term(51071), term(51072)]), 'TERM by pid to each of dev\'s, and no group signal');
  assert.deepEqual(reaching(calls, 51073), [], 'nothing reaches the group-mate');
  const processes = processesIn(answer);
  assert.deepEqual(pidsOf(processes.stopped), [51071, 51072]);
  const left = processes.left.filter((one) => one.pid === 51073);
  assert.equal(left.length, 1, `the group-mate is named under left, got: ${JSON.stringify(processes.left)}`);
  assert.deepEqual({ ...left[0], why: typeof left[0].why }, { session: 'dev', pid: 51073, cwd: elsewhere, command: 'tail -f server.log', why: 'string' });
  assert.notEqual(left[0].why.trim(), '', 'with why');
  assert.ok(!pidsOf(processes.stopped).includes(51073), 'and not as stopped');
});

test('R2 a process of another uid is never signalled, though it descends from the session\'s own', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  await table(box, [
    { pid: 51081, ppid: 1, pgid: 51081, cwd: workOf(box, 'dev'), command: 'npm run serve' },
    // Started by it through a setuid program, say; lsof, asked for the user's
    // own processes, does not list it.
    { pid: 51082, ppid: 51081, pgid: 51082, uid: OTHER_UID, cwd: workOf(box, 'dev'), command: 'sudo -n true' },
  ]);

  const result = await retire(box, ['--session', 'dev', '--json']);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  const calls = await kills(box);
  assert.deepEqual(reaching(calls, 51082), [], `nothing reaches the process of another uid, got: ${JSON.stringify(calls)}`);
  assert.deepEqual(calls, [term(-51081)], 'the user\'s own process still gets its TERM');
  assert.ok(!pidsOf(processesIn(JSON.parse(result.stdout)).stopped).includes(51082), 'and it is not named as stopped');
});

// ------------------------------------------------------------------ R3

test('R3 TERM goes to the whole group, once, when every process in it is the session\'s own', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  const outside = await throwaway(box);
  await table(box, [
    { pid: 51091, ppid: 1, pgid: 51091, cwd: workOf(box, 'dev'), command: 'node --test' },
    { pid: 51092, ppid: 51091, pgid: 51091, cwd: outside, command: 'node test/a.test.js' },
    { pid: 51093, ppid: 51092, pgid: 51091, cwd: workOf(box, 'dev'), command: 'node src/cli.js up' },
  ]);

  const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

  assert.deepEqual(await kills(box), [term(-51091)]);
  const { stopped } = processesIn(answer);
  assert.deepEqual(pidsOf(stopped), [51091, 51092, 51093], 'each process in the group is named');
  assert.deepEqual([...new Set(stopped.map((one) => one.signal))], ['SIGTERM']);
});

test('R3 a group id of 1 is never signalled as a group: TERM goes by pid', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  await table(box, [{ pid: 51101, ppid: 1, pgid: 1, cwd: workOf(box, 'dev'), command: 'sleep 600' }]);

  const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

  assert.deepEqual(await kills(box), [term(51101)], 'never -1, which reaches every process of the user\'s');
  assert.deepEqual(pidsOf(processesIn(answer).stopped), [51101]);
});

test('R3 a process that ignores TERM gets KILL by pid after the wait, and only after TERM, and is named as stopped with SIGKILL', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  await table(box, [{ pid: 51111, ppid: 1, pgid: 51111, cwd: workOf(box, 'dev'), command: 'node stubborn.js', ignoresTerm: true }]);

  const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

  const calls = await box.kill.calls();
  assert.deepEqual(calls.map((call) => call.args), [term(-51111), kill(51111)], 'TERM to the group first, then KILL to the pid');
  const waited = calls[1].at - calls[0].at;
  assert.ok(waited >= 2000, `KILL comes after a wait for TERM to work, of up to 3 s; it came after ${waited} ms`);
  assert.deepEqual(processesIn(answer).stopped.map((one) => [one.pid, one.signal]), [[51111, 'SIGKILL']]);
});

test('R3 a process that has exited and waits for its parent, a zombie, counts as gone: no KILL after TERM', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  await table(box, [{ pid: 51121, ppid: 51120, pgid: 51121, cwd: workOf(box, 'dev'), command: 'sleep 600', zombieOnTerm: true }]);

  const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

  assert.deepEqual(await kills(box), [term(-51121)]);
  assert.deepEqual(processesIn(answer).stopped.map((one) => [one.pid, one.signal]), [[51121, 'SIGTERM']]);
});

test('R3 a child started by a process that ignores TERM, after the TERM, gets KILL by pid along with it', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  const outside = await throwaway(box);
  await table(box, [{
    pid: 51131,
    ppid: 1,
    pgid: 51131,
    cwd: workOf(box, 'dev'),
    command: 'node respawner.js',
    ignoresTerm: true,
    spawnsOnTerm: { pid: 51132, cwd: outside, command: 'node worker.js', ignoresTerm: true },
  }]);

  const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

  const calls = await kills(box);
  assert.deepEqual(calls[0], term(-51131), 'TERM to the group comes first');
  const killed = calls.filter((args) => args[1] === 'KILL');
  assert.deepEqual(sorted(killed), sorted([kill(51131), kill(51132)]), `KILL by pid to the process and its new child, got: ${JSON.stringify(calls)}`);
  assert.ok(calls.indexOf(killed[0]) > 0, 'and only after the TERM');
  assert.deepEqual(processesIn(answer).stopped.map((one) => [one.pid, one.signal]).sort(), [[51131, 'SIGKILL'], [51132, 'SIGKILL']]);
});

test('R3 a process the kill is refused for is named under left with why, and the retire still finishes', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  await table(box, [{ pid: 51141, ppid: 1, pgid: 51141, cwd: workOf(box, 'dev'), command: 'node held.js', refuses: true }]);

  const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

  assert.ok(reaching(await kills(box), 51141).length > 0, 'the premise: the kit tried to signal it');
  const processes = processesIn(answer);
  assert.deepEqual(processes.stopped, [], 'it was not stopped');
  assert.deepEqual(processes.left.map((one) => [one.session, one.pid, one.cwd, one.command]), [['dev', 51141, workOf(box, 'dev'), 'node held.js']]);
  assert.ok(typeof processes.left[0].why === 'string' && processes.left[0].why.trim() !== '', `with why, got: ${JSON.stringify(processes.left[0])}`);
  await assertRetired(box, 'dev');
});

test('R3 a process that KILL does not take is named under left, not as stopped', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  await table(box, [{ pid: 51151, ppid: 1, pgid: 51151, cwd: workOf(box, 'dev'), command: 'node stuck.js', unkillable: true }]);

  const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

  assert.deepEqual(await kills(box), [term(-51151), kill(51151)], 'the premise: TERM, then KILL');
  const processes = processesIn(answer);
  assert.deepEqual(processes.stopped, [], 'it still runs, so it was not stopped');
  assert.deepEqual(processes.left.map((one) => one.pid), [51151]);
  assert.ok(typeof processes.left[0].why === 'string' && processes.left[0].why.trim() !== '', `with why, got: ${JSON.stringify(processes.left[0])}`);
});

test('R3 a process gone by the time its signal comes is not named as left running', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  await table(box, [
    { pid: 51161, ppid: 1, pgid: 51161, cwd: workOf(box, 'dev'), command: 'sleep 1', ghost: true },
    { pid: 51162, ppid: 1, pgid: 51162, cwd: workOf(box, 'dev'), command: 'sleep 600' },
  ]);

  const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

  assert.ok(reaching(await kills(box), 51161).length > 0, 'the premise: the kit signalled it and heard No such process');
  const processes = processesIn(answer);
  assert.deepEqual(processes.left.filter((one) => one.pid === 51161), [], `it is gone, not left, got: ${JSON.stringify(processes.left)}`);
  assert.ok(pidsOf(processes.stopped).includes(51162), 'and the other is stopped as usual');
});

test('R3 the plain output gives a stopped line with pid and command for each process stopped, and a left line with pid, folder, command and why', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  const elsewhere = path.join(box.home, 'elsewhere');
  await table(box, [
    { pid: 51171, ppid: 1, pgid: 51171, cwd: workOf(box, 'dev'), command: 'node --test test/slow.test.js' },
    { pid: 51172, ppid: 1, pgid: 51171, cwd: elsewhere, command: 'tail -f server.log' },
  ]);

  const result = await retire(box, ['--session', 'dev']);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  const lines = result.stdout.split('\n');
  const stopped = lines.filter((line) => /^stopped\b/.test(line));
  assert.equal(stopped.length, 1, `one stopped line, got:\n${result.stdout}`);
  assert.match(stopped[0], /\b51171\b/);
  assert.ok(stopped[0].includes('node --test test/slow.test.js'), `the stopped line names the command: ${stopped[0]}`);
  const left = lines.filter((line) => /^left\b/.test(line) && /\b51172\b/.test(line));
  assert.equal(left.length, 1, `one left line for 51172, got:\n${result.stdout}`);
  assert.ok(left[0].includes(elsewhere), `the left line names the folder: ${left[0]}`);
  assert.ok(left[0].includes('tail -f server.log'), `the left line names the command: ${left[0]}`);
});

// ------------------------------------------------------------------ R4

/** Whether the kit asked the fake lsof for the user's working folders (helpers/fake-tty.js). */
const askedLsofForFolders = async (box) => (await box.lsof.calls()).some((call) => call.args.includes('cwd'));

/** Whether the kit asked the fake ps for the whole table. */
const askedPsForTable = async (box) => (await box.ps.calls()).some((call) => JSON.stringify(call.args) === JSON.stringify(PS_TABLE));

for (const [what, fault, asked] of [
  ['ps cannot run, as in Codex\'s sandbox', { ps: 'not-permitted' }, askedPsForTable],
  ['lsof cannot read the working folders', { lsof: 'not-permitted' }, askedLsofForFolders],
]) {
  test(`R4 where ${what}, the retire says it cannot tell, signals nothing at all, and still finishes`, async (t) => {
    const box = await createSandbox(t);
    await devFleet(box);
    const tab = (await sessionIn(botsOf(box), BOT, 'dev'))?.tab;
    await table(box, [{ pid: 51181, ppid: 1, pgid: 51181, cwd: workOf(box, 'dev'), command: 'sleep 600' }]);
    await box.orca.set(fault);

    const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

    const processes = processesIn(answer);
    assert.equal(typeof processes.unreadable, 'string', `the answer says why it cannot tell, got: ${JSON.stringify(processes)}`);
    assert.notEqual(processes.unreadable.trim(), '');
    assert.deepEqual([processes.stopped, processes.left], [[], []]);
    assert.deepEqual(await box.kill.calls(), [], 'no kill is run at all');
    assert.ok(await asked(box), 'the premise: the kit tried the reader that failed');
    await assertRetired(box, 'dev');
    assert.ok(!(await box.orca.terminals()).some((one) => one.tabId === tab), 'and dev\'s tab is closed');
  });
}

test('R4 the plain output says on a processes line that the kit cannot tell, and stops nothing', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  await table(box, [{ pid: 51191, ppid: 1, pgid: 51191, cwd: workOf(box, 'dev'), command: 'sleep 600' }]);
  await box.orca.set({ ps: 'not-permitted' });

  const result = await retire(box, ['--session', 'dev']);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  const lines = result.stdout.split('\n');
  const said = lines.filter((line) => /^processes\b/.test(line));
  assert.equal(said.length, 1, `one processes line, got:\n${result.stdout}`);
  assert.match(said[0], /can(?:no|')t tell|can not tell/i, `it says the kit cannot tell: ${said[0]}`);
  assert.deepEqual(lines.filter((line) => /^stopped\b/.test(line)), [], 'and no stopped line');
  assert.deepEqual(await box.kill.calls(), []);
});

// ------------------------------------------------------------------ the book

test('R5 the book keeps a retired session\'s work dir as bot.yaml had it, and none for a session that had none', async (t) => {
  const box = await createSandbox(t);
  await fleet(box, [['daily'], ['dev', '--work-dir', 'work/dev']]);

  for (const name of ['dev', 'daily']) {
    const result = await retire(box, ['--session', name]);
    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  }

  const retired = (await bookIn(botsOf(box), BOT)).retired ?? [];
  const entry = (name) => retired.find((one) => one?.name === name);
  assert.equal(entry('dev')?.work_dir, 'work/dev', `dev's retired entry keeps its work dir, got: ${JSON.stringify(entry('dev'))}`);
  assert.ok(entry('daily') !== undefined && !('work_dir' in entry('daily')), `daily had none, and its entry has none, got: ${JSON.stringify(entry('daily'))}`);
});

test('R5 the book keeps a retired temporary session\'s work dir too', async (t) => {
  const box = await createSandbox(t);
  await family(box);

  const result = await box.run(['temp', 'retire', '--bots', 'bots', '--name', 'scout'], { env: inTab(box, await liveTab(box, 'lead')) });

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  const retired = (await bookIn(botsOf(box), BOT)).retired ?? [];
  for (const name of ['scout', 'reviewer']) {
    const entry = retired.find((one) => one?.name === name);
    assert.equal(entry?.work_dir, `work/${name}`, `${name}'s retired entry keeps its work dir, got: ${JSON.stringify(entry)}`);
  }
});

// ------------------------------------------------------------------ R3, found in review
//
// Four defects the review of 79ba541 found, each held here as the developer
// gave the intended rule:
//
//   - A process is its pid and its start time, which the table gives as
//     `lstart` (the interface as changed after the review). A pid that comes
//     back during the wait with another start time is another process: the
//     one signalled has ended. A process that renames itself is still the one
//     signalled, and is named by what it is now.
//   - When the table cannot be read again after TERM, nothing more is sent:
//     what still might run is left, with why.
//   - A process found during the wait that a read shows to descend, by parent
//     pid, from a live tracked process is tracked from that read on. It gets
//     TERM by pid at once, and KILL only when it still runs 3 s after its own
//     TERM, even when it is found at or after the first deadline. So no
//     process gets KILL without its own TERM and its own wait. A descent once
//     seen stays known when the parent exits and leaves it to pid 1. (The
//     whole stop is bounded to about 9 s; what still runs after that is left.
//     That bound has no test of its own here.)
//   - A newcomer in a group that was signalled whole, which no read showed to
//     descend from the session's processes, is not shown to be the session's
//     own (R2; the review of 6d36262): it is never signalled, and is named
//     under left once, with why naming the group.

/** The one call in `calls` with exactly the argv `args`, with its index, or undefined. */
const callOf = (calls, args) => {
  const at = calls.findIndex((call) => JSON.stringify(call.args) === JSON.stringify(args));
  return at < 0 ? undefined : { ...calls[at], index: at };
};

for (const [what, becomes] of [
  ['with the same command, group and folder and only another start time', { command: 'node --test', cwd: '<work>', startedAt: Date.UTC(2026, 9, 10, 12, 0, 0) }],
  ['with the same command, in another group, in a folder elsewhere, and another start time', { command: 'node --test', pgid: 51200, cwd: '/Users/someone/elsewhere' }],
]) {
  test(`R3 a pid that comes back during the wait as another process, ${what}, gets no KILL, and is not named as stopped`, async (t) => {
    const box = await createSandbox(t);
    await devFleet(box);
    const reused = { ...becomes, cwd: becomes.cwd === '<work>' ? workOf(box, 'dev') : becomes.cwd };
    await table(box, [{ pid: 51201, ppid: 1, pgid: 51201, startedAt: Date.UTC(2026, 9, 10, 8, 0, 0), cwd: workOf(box, 'dev'), command: 'node --test', reusedAfterTerm: reused }]);

    const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

    assert.deepEqual(await kills(box), [term(-51201)], 'TERM, and nothing to the process that took the pid after');
    const processes = processesIn(answer);
    assert.deepEqual(processes.stopped.filter((one) => one.pid === 51201).map((one) => one.signal), ['SIGTERM'], `only the process that was signalled is named, ended by TERM; the new one is not, got: ${JSON.stringify(processes.stopped)}`);
    assert.deepEqual(processes.left.filter((one) => one.pid === 51201), [], 'and the new process with its pid is not the session\'s to name');
  });
}

test('R3 a process that renames itself on TERM and runs on is not named as stopped by TERM: it gets KILL after the wait, and is named by what it is now', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  await table(box, [{ pid: 51251, ppid: 1, pgid: 51251, cwd: workOf(box, 'dev'), command: 'node worker.js', commandOnTerm: 'worker: ready', ignoresTerm: true }]);

  const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

  const calls = await box.kill.calls();
  assert.deepEqual(calls.map((call) => call.args), [term(-51251), kill(51251)], 'TERM to the group, then KILL to the pid');
  assert.ok(calls[1].at - calls[0].at >= 2000, `KILL after the wait, came after ${calls[1].at - calls[0].at} ms`);
  const named = processesIn(answer).stopped.filter((one) => one.pid === 51251);
  assert.deepEqual(named.map((one) => [one.signal, one.command]), [['SIGKILL', 'worker: ready']], `named once, as stopped by KILL, by its command now, got: ${JSON.stringify(named)}`);
});

test('R3 a process that renames itself on TERM and that KILL does not end is named under left, and not as stopped', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  await table(box, [{ pid: 51261, ppid: 1, pgid: 51261, cwd: workOf(box, 'dev'), command: 'node worker.js', commandOnTerm: 'worker: ready', ignoresTerm: true, unkillable: true }]);

  const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

  assert.deepEqual(await kills(box), [term(-51261), kill(51261)]);
  const processes = processesIn(answer);
  assert.deepEqual(processes.stopped.filter((one) => one.pid === 51261), [], `it still runs, so it is not stopped, got: ${JSON.stringify(processes.stopped)}`);
  assert.deepEqual(processes.left.map((one) => one.pid), [51261]);
});

test('R3 when the table cannot be read again after TERM, no KILL is sent, and the process is named under left with why', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  await table(box, [{ pid: 51211, ppid: 1, pgid: 51211, cwd: workOf(box, 'dev'), command: 'node stubborn.js', ignoresTerm: true }]);
  await box.orca.set({ ps: 'fails-after-kill' });

  const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

  assert.deepEqual(await kills(box), [term(-51211)], 'the first read worked and TERM went; nothing after it');
  const processes = processesIn(answer);
  assert.deepEqual(processes.stopped.filter((one) => one.pid === 51211), [], 'it is not known to have stopped');
  const left = processes.left.filter((one) => one.pid === 51211);
  assert.equal(left.length, 1, `it is named under left, got: ${JSON.stringify(processes.left)}`);
  assert.match(left[0].why ?? '', /read/i, `why says the kit could not read the processes again: ${left[0].why}`);
  await assertRetired(box, 'dev');
});

test('R2 a child started on TERM in the group signalled whole, whose parent exits before any read shows it, is not signalled: it is named under left as a group-mate the kit cannot show is its own', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  const outside = await throwaway(box);
  // On TERM 51221 starts 51222 in its own group, 51221, and exits at once, so
  // the first read after TERM finds 51222 with parent pid 1: no read shows it
  // to descend from 51221, only that it shares the group. 51222 ignores TERM.
  await table(box, [{
    pid: 51221,
    ppid: 1,
    pgid: 51221,
    cwd: workOf(box, 'dev'),
    command: 'node respawner.js',
    spawnsOnTerm: { pid: 51222, cwd: outside, command: 'node worker.js', ignoresTerm: true },
  }]);

  const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

  const calls = await kills(box);
  assert.deepEqual(calls[0], term(-51221), 'TERM to the group comes first');
  assert.deepEqual(reaching(calls, 51222), [], `nothing is sent to 51222 by its pid, got: ${JSON.stringify(calls)}`);
  assert.deepEqual(reaching(calls, 51221), [term(-51221)], `and the group, which now holds 51222, gets nothing more, got: ${JSON.stringify(calls)}`);
  const processes = processesIn(answer);
  assert.deepEqual(processes.stopped.filter((one) => one.pid === 51222), [], 'it is not named as stopped');
  const left = processes.left.filter((one) => one.pid === 51222);
  assert.deepEqual(left.map((one) => [one.session, one.cwd, one.command]), [['dev', outside, 'node worker.js']], `it is named once under left, got: ${JSON.stringify(processes.left)}`);
  assert.match(left[0].why ?? '', /\b51221\b/, `why names the group it shares: ${left[0].why}`);
});

test('R3 a child started on TERM in a group of its own, whose parent exits later in the wait, is still stopped: TERM by pid, then KILL', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  const outside = await throwaway(box);
  // 51231 ignores TERM, starts 51232 in a new group when it gets it, and
  // exits just before the third read of the table (the first is the one
  // before TERM), which leaves 51232 to pid 1.
  await table(box, [{
    pid: 51231,
    ppid: 1,
    pgid: 51231,
    cwd: workOf(box, 'dev'),
    command: 'node respawner.js',
    ignoresTerm: true,
    exitsAtRead: 3,
    spawnsOnTerm: { pid: 51232, pgid: 51232, cwd: outside, command: 'node worker.js', ignoresTerm: true },
  }]);

  const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

  const calls = await kills(box);
  assert.deepEqual(calls[0], term(-51231), 'TERM to the group comes first');
  const termAt = calls.findIndex((args) => JSON.stringify(args) === JSON.stringify(term(51232)));
  const killAt = calls.findIndex((args) => JSON.stringify(args) === JSON.stringify(kill(51232)));
  const timed = await box.kill.calls();
  assert.ok(termAt > 0, `the new child gets TERM by pid, got: ${JSON.stringify(calls)}`);
  assert.ok(killAt > termAt, `and KILL by pid after it, got: ${JSON.stringify(calls)}`);
  const waited = timed[killAt].at - timed[termAt].at;
  assert.ok(waited >= 2500, `KILL comes only after its own wait of 3 s from its own TERM; it came after ${waited} ms`);
  assert.deepEqual(processesIn(answer).stopped.filter((one) => one.pid === 51232).map((one) => one.signal), ['SIGKILL']);
});

test('R3 a child that first appears after the deadline gets its own TERM, and KILL only 3 s after it', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  const outside = await throwaway(box);
  // 51241 ignores TERM, and KILL does not end it either, so it is alive when
  // its child 51242, in its group, starts 3.5 s after the first signal: after
  // the first wait has ended and 51241 has had its KILL. A child is forked by
  // a parent that is alive, so the parent stays in the table.
  await table(box, [
    { pid: 51241, ppid: 1, pgid: 51241, cwd: workOf(box, 'dev'), command: 'node respawner.js', ignoresTerm: true, unkillable: true },
    { pid: 51242, ppid: 51241, pgid: 51241, cwd: outside, command: 'node late-worker.js', ignoresTerm: true, appearsAfterMs: 3500 },
  ]);

  const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

  const calls = await box.kill.calls();
  const argvs = JSON.stringify(calls.map((call) => call.args));
  assert.deepEqual(calls[0]?.args, term(-51241), 'TERM to the group comes first');
  const parentKill = callOf(calls, kill(51241));
  const childTerm = callOf(calls, term(51242));
  const childKill = callOf(calls, kill(51242));
  assert.ok(parentKill !== undefined, `the premise: the parent got its KILL at the first deadline, got: ${argvs}`);
  assert.ok(childTerm !== undefined, `the late child gets its own TERM, by pid, got: ${argvs}`);
  assert.ok(childTerm.index > parentKill.index, `the premise: the child was found after the first deadline, got: ${argvs}`);
  assert.ok(childKill !== undefined && childKill.index > childTerm.index, `and KILL by pid after it, got: ${argvs}`);
  const waited = childKill.at - childTerm.at;
  assert.ok(waited >= 2500, `KILL comes only after its own wait of 3 s from its own TERM; it came after ${waited} ms`);
  const processes = processesIn(answer);
  assert.deepEqual(processes.stopped.filter((one) => one.pid === 51242).map((one) => one.signal), ['SIGKILL']);
  assert.deepEqual(processes.left.map((one) => one.pid), [51241], 'the parent, which KILL did not end, is left');
});

test('R2 a process that joins the group signalled whole during the wait, and descends from nothing of the session\'s, is never signalled and is named under left', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  const elsewhere = path.join(box.home, 'elsewhere');
  // The reviewer's case (the review of 6d36262): 62002 is no process of dev's,
  // in a group and a folder of its own. Once the TERM to group 62001 has gone
  // out, it moves into that group (setpgid), with the same pid and start time.
  // 62001 ignores TERM, so the kit goes on reading through the wait.
  await table(box, [
    { pid: 62001, ppid: 1, pgid: 62001, cwd: workOf(box, 'dev'), command: 'node --test', ignoresTerm: true },
    { pid: 62002, ppid: 1, pgid: 62999, cwd: elsewhere, command: 'node server.js', joinsGroupAfterFirstSignal: 62001 },
  ]);

  const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

  const calls = await kills(box);
  assert.deepEqual(calls[0], term(-62001), 'TERM to the group, before 62002 joins it');
  assert.deepEqual(reaching(calls, 62002), [], `nothing is sent to 62002 by its pid, got: ${JSON.stringify(calls)}`);
  assert.deepEqual(calls.filter((args) => args[3] === '-62001'), [term(-62001)], `and the group, which now holds 62002, gets nothing more, got: ${JSON.stringify(calls)}`);
  assert.ok(reaching(calls, 62001).some((args) => args[1] === 'KILL'), `the premise: 62001 itself still gets its KILL, by pid, got: ${JSON.stringify(calls)}`);
  const processes = processesIn(answer);
  assert.deepEqual(processes.stopped.filter((one) => one.pid === 62002), [], 'it is not named as stopped');
  const left = processes.left.filter((one) => one.pid === 62002);
  assert.deepEqual(left.map((one) => [one.session, one.cwd, one.command]), [['dev', elsewhere, 'node server.js']], `it is named once under left, with its folder and command, got: ${JSON.stringify(processes.left)}`);
  assert.match(left[0].why ?? '', /\b62001\b/, `why names the group it joined: ${left[0].why}`);
});

test('R1 a process that joins the group signalled whole during the wait with its working folder in the work dir is the session\'s own: TERM by pid, then KILL after its own wait', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  // The review of df653f0: on TERM 62001 starts 62003 in its group, 62001,
  // with its working folder in dev's work dir, and exits at once, so no read
  // shows 62003 to descend from it (its parent pid is 1). Its folder makes it
  // dev's by R1 all the same. 62003 ignores TERM.
  await table(box, [{
    pid: 62001,
    ppid: 1,
    pgid: 62001,
    cwd: workOf(box, 'dev'),
    command: 'node --test',
    spawnsOnTerm: { pid: 62003, cwd: workOf(box, 'dev'), command: 'node test/worker.js', ignoresTerm: true },
  }]);

  const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

  const calls = await box.kill.calls();
  const argvs = JSON.stringify(calls.map((call) => call.args));
  assert.deepEqual(calls[0]?.args, term(-62001), 'TERM to the group comes first');
  const ownTerm = callOf(calls, term(62003));
  const ownKill = callOf(calls, kill(62003));
  assert.ok(ownTerm !== undefined, `62003 gets its own TERM, by pid, got: ${argvs}`);
  assert.ok(ownKill !== undefined && ownKill.index > ownTerm.index, `and KILL by pid after it, got: ${argvs}`);
  const waited = ownKill.at - ownTerm.at;
  assert.ok(waited >= 2500, `KILL comes only after its own wait of 3 s from its own TERM; it came after ${waited} ms`);
  const processes = processesIn(answer);
  assert.deepEqual(
    processes.stopped.filter((one) => one.pid === 62003).map((one) => [one.session, one.cwd, one.signal]),
    [['dev', workOf(box, 'dev'), 'SIGKILL']],
    `named as stopped, in the work dir, got: ${JSON.stringify(processes.stopped)}`,
  );
  assert.deepEqual(processes.left.filter((one) => one.pid === 62003), [], `and not under left, got: ${JSON.stringify(processes.left)}`);
});

test('R1 a process started on TERM in a group of its own, with its working folder in the work dir, whose parent exits before any read, is the session\'s own: TERM by pid, then KILL after its own wait', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  // The review of 45da003: as the test above, but 62001 starts 62003 in a
  // group of its own, 62003. 62001 exits at once, so 62003 has parent pid 1
  // and shares no group with dev's processes; its folder alone makes it
  // dev's, by R1. 62003 ignores TERM.
  await table(box, [{
    pid: 62001,
    ppid: 1,
    pgid: 62001,
    cwd: workOf(box, 'dev'),
    command: 'node --test',
    spawnsOnTerm: { pid: 62003, pgid: 62003, cwd: workOf(box, 'dev'), command: 'node test/worker.js', ignoresTerm: true },
  }]);

  const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

  const calls = await box.kill.calls();
  const argvs = JSON.stringify(calls.map((call) => call.args));
  assert.deepEqual(calls[0]?.args, term(-62001), 'TERM to the group comes first');
  const ownTerm = callOf(calls, term(62003));
  const ownKill = callOf(calls, kill(62003));
  assert.ok(ownTerm !== undefined, `62003 gets its own TERM, by pid, got: ${argvs}`);
  assert.ok(ownKill !== undefined && ownKill.index > ownTerm.index, `and KILL by pid after it, got: ${argvs}`);
  const waited = ownKill.at - ownTerm.at;
  assert.ok(waited >= 2500, `KILL comes only after its own wait of 3 s from its own TERM; it came after ${waited} ms`);
  const processes = processesIn(answer);
  assert.deepEqual(
    processes.stopped.filter((one) => one.pid === 62003).map((one) => [one.session, one.cwd, one.signal]),
    [['dev', workOf(box, 'dev'), 'SIGKILL']],
    `named as stopped, in the work dir, got: ${JSON.stringify(processes.stopped)}`,
  );
  assert.deepEqual(processes.left.filter((one) => one.pid === 62003), [], `and not under left, got: ${JSON.stringify(processes.left)}`);
});

test('R2 a process the retire itself starts during the wait, in the work dir, is never signalled and never named as stopped', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  const work = workOf(box, 'dev');
  // The retire runs from dev's work dir, as a session retiring itself from
  // its own tab would, under this test and a harness. 62021 is dev's and
  // ignores TERM, so the kit goes on reading through the wait. Half a second
  // after the first signal, a child of the kit's own appears in the work dir,
  // in the kit's group: a ps or lsof it runs, say.
  await table(box, [
    { pid: 62020, ppid: 1, pgid: 62020, cwd: work, command: 'claude' },
    { pid: process.pid, ppid: 62020, pgid: 62020, cwd: work, command: 'node --test' },
    { pid: 'kit', ppid: process.pid, pgid: 'kit', cwd: work, command: `node ${box.cli} retire --bots ${botsOf(box)} --bot ${BOT} --session dev` },
    { pid: 62021, ppid: 1, pgid: 62021, cwd: work, command: 'node --test test/slow.test.js', ignoresTerm: true },
    { pid: 62022, ppid: 'kit', pgid: 'kit', cwd: work, command: '/usr/sbin/lsof -a -d cwd -Fpn', appearsAfterMs: 500 },
  ]);

  // Run from the work dir, so the bots folder is given by its full path.
  const answer = answerIn(await box.run(['retire', '--bots', botsOf(box), '--bot', BOT, '--session', 'dev', '--json'], { cwd: work }));

  const calls = await box.kill.calls();
  const kit = calls[0]?.caller;
  const argvs = JSON.stringify(calls.map((call) => call.args));
  assert.deepEqual(calls[0]?.args, term(-62021), 'the premise: dev\'s process gets its TERM first');
  assert.ok(callOf(calls, kill(62021)) !== undefined, `the premise: and its KILL after the wait, so the kit read the table through it, got: ${argvs}`);
  assert.deepEqual(reaching(calls.map((call) => call.args), 62022), [], `nothing is sent to the kit's own child, got: ${argvs}`);
  assert.deepEqual(reaching(calls.map((call) => call.args), kit, process.pid, 62020), [], `nor to the kit (${kit}) or what started it, got: ${argvs}`);
  assert.deepEqual(processesIn(answer).stopped.filter((one) => one.pid === 62022), [], 'and the kit\'s own child is not named as stopped');
});

// ------------------------------------------------------------------ R3 R4, found in the review of ae4d452
//
//   - A later read of the working folders that fails is a later read that
//     fails, as one of the table is: no signal after it, and what is not
//     known to have ended is left, with why.
//   - Each wait runs from its own signal, as the signal went, and the
//     deadlines are checked after every call that can block: no TERM to a
//     newcomer later than 6 s after the first TERM, and no signal at all later
//     than 12 s after it (the stop's whole budget). A process whose last
//     signal no read after it checked is left, with why saying the kit could
//     not confirm it ended, never that it still runs.
//   - A process that is another user's by the time of KILL gets no KILL.
//
// The times are kill.log's: when each signal went (helpers/fake-kill.js). The
// deadlines get 750 ms of margin, for the time a fake takes to start on a
// busy machine.

test('R4 when the working folders cannot be read again after TERM, no KILL is sent, and the process is named under left with why', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  await table(box, [
    { pid: 62141, ppid: 1, pgid: 62141, cwd: workOf(box, 'dev'), command: 'node stubborn.js', ignoresTerm: true },
    { pid: 62142, ppid: 1, pgid: 62142, cwd: path.join(box.home, 'elsewhere'), command: 'sleep 600' },
  ]);
  await box.orca.set({ lsof: 'fails-after-kill' });

  const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

  assert.deepEqual(await kills(box), [term(-62141)], 'the first reads worked and TERM went; nothing after it');
  const processes = processesIn(answer);
  assert.deepEqual(processes.stopped.filter((one) => one.pid === 62141), [], 'it is not known to have stopped');
  const left = processes.left.filter((one) => one.pid === 62141);
  assert.equal(left.length, 1, `it is named under left, got: ${JSON.stringify(processes.left)}`);
  assert.match(left[0].why ?? '', /read/i, `why says the kit could not read again: ${left[0].why}`);
  await assertRetired(box, 'dev');
});

test('R3 each process waits 3 s from its own TERM, as it went: a first TERM call that takes 3.5 s does not shorten the second process\'s wait', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  await table(box, [
    { pid: 62151, ppid: 1, pgid: 62151, cwd: workOf(box, 'dev'), command: 'node a.js', ignoresTerm: true },
    { pid: 62152, ppid: 1, pgid: 62152, cwd: workOf(box, 'dev'), command: 'node b.js', ignoresTerm: true },
  ]);
  await box.orca.set({ killDelaysMs: [3500] });

  const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

  const calls = await box.kill.calls();
  const argvs = JSON.stringify(calls.map((call) => call.args));
  for (const pid of [62151, 62152]) {
    const sent = callOf(calls, term(-pid));
    const killed = callOf(calls, kill(pid));
    assert.ok(sent !== undefined && killed !== undefined, `the premise: ${pid} got TERM and KILL, got: ${argvs}`);
    const waited = killed.at - sent.at;
    assert.ok(waited >= 2500, `${pid}'s KILL comes only after its own wait of 3 s from its own TERM; it came after ${waited} ms`);
  }
  assert.deepEqual(processesIn(answer).stopped.map((one) => [one.pid, one.signal]).sort(), [[62151, 'SIGKILL'], [62152, 'SIGKILL']]);
});

test('R3 a child adopted during the wait waits 3 s from its own TERM, though the read that found it took 3.5 s', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  const outside = await throwaway(box);
  await table(box, [{
    pid: 62161,
    ppid: 1,
    pgid: 62161,
    cwd: workOf(box, 'dev'),
    command: 'node respawner.js',
    ignoresTerm: true,
    spawnsOnTerm: { pid: 62163, pgid: 62163, cwd: outside, command: 'node worker.js', ignoresTerm: true },
  }]);
  await box.orca.set({ lsofDelayAfterKillMs: 3500 });

  const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

  const calls = await box.kill.calls();
  const argvs = JSON.stringify(calls.map((call) => call.args));
  const sent = callOf(calls, term(62163));
  const killed = callOf(calls, kill(62163));
  assert.ok(sent !== undefined, `the child gets its own TERM, by pid, got: ${argvs}`);
  assert.ok(killed !== undefined && killed.index > sent.index, `and KILL by pid after it, got: ${argvs}`);
  const waited = killed.at - sent.at;
  assert.ok(waited >= 2500, `its KILL comes only after its own wait of 3 s from its own TERM; it came after ${waited} ms`);
  assert.deepEqual(processesIn(answer).stopped.filter((one) => one.pid === 62163).map((one) => one.signal), ['SIGKILL']);
});

test('R3 with reads made slow during the wait, no newcomer gets TERM after 6 s, nothing is signalled after 12 s, and a signal no later read checked is left as not confirmed', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  const outside = await throwaway(box);
  // After the first signal each read of the table takes 4 s, and each read of
  // the working folders 9 s: one read of both ends past the 6 s deadline for
  // newcomers and the reads alone would run past the 12 s budget.
  await table(box, [{
    pid: 62171,
    ppid: 1,
    pgid: 62171,
    cwd: workOf(box, 'dev'),
    command: 'node respawner.js',
    ignoresTerm: true,
    spawnsOnTerm: { pid: 62173, pgid: 62173, cwd: outside, command: 'node worker.js', ignoresTerm: true },
  }]);
  await box.orca.set({ psDelayAfterKillMs: 4000, lsofDelayAfterKillMs: 9000 });

  const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

  const calls = await box.kill.calls();
  const argvs = JSON.stringify(calls.map((call) => [call.args, call.at - calls[0].at]));
  assert.deepEqual(calls[0]?.args, term(-62171), 'the premise: TERM to the group comes first');
  const first = calls[0].at;
  for (const call of calls.filter((one) => one.args[1] === 'TERM' && reaching([one.args], 62173).length > 0)) {
    assert.ok(call.at - first <= 6750, `no TERM to a newcomer later than 6 s after the first TERM, got ${call.args.join(' ')} at ${call.at - first} ms: ${argvs}`);
  }
  for (const call of calls) {
    assert.ok(call.at - first <= 12750, `no signal later than 12 s after the first TERM, got ${call.args.join(' ')} at ${call.at - first} ms: ${argvs}`);
  }
  const reads = await box.ps.tableReads();
  const processes = processesIn(answer);
  for (const pid of [62171, 62173]) {
    const signalled = calls.filter((call) => reaching([call.args], pid).length > 0);
    if (signalled.length === 0) continue;
    const last = signalled.at(-1).at;
    if (reads.some((read) => read.at > last)) continue;
    // No read after its last signal was answered: nothing can say it ended.
    assert.deepEqual(processes.stopped.filter((one) => one.pid === pid), [], `${pid}'s last signal was not checked by any read, so it is not stopped: ${JSON.stringify(processes.stopped)}`);
    const left = processes.left.filter((one) => one.pid === pid);
    assert.equal(left.length, 1, `${pid} is named under left, got: ${JSON.stringify(processes.left)}`);
    assert.match(left[0].why ?? '', /confirm/i, `why says the kit could not confirm it ended: ${left[0].why}`);
    assert.doesNotMatch(left[0].why ?? '', /still runs/i, `and not that it still runs: ${left[0].why}`);
  }
});

test('R3 a process that turns into another user\'s after TERM gets no KILL, and is named under left as running as another user', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  await table(box, [{ pid: 62181, ppid: 1, pgid: 62181, cwd: workOf(box, 'dev'), command: 'node server.js', ignoresTerm: true, uidOnTerm: OTHER_UID }]);

  const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

  assert.deepEqual(await kills(box), [term(-62181)], 'TERM while it was the user\'s, and no KILL once it is another user\'s');
  const processes = processesIn(answer);
  assert.deepEqual(processes.stopped.filter((one) => one.pid === 62181), [], 'it is not named as stopped');
  const left = processes.left.filter((one) => one.pid === 62181);
  assert.equal(left.length, 1, `it is named under left, got: ${JSON.stringify(processes.left)}`);
  assert.match(left[0].why ?? '', /another user/i, `why says it runs as another user: ${left[0].why}`);
});

// ------------------------------------------------------------------ R3, the deadlines one rule at a time
//
// The hand mutation check at 7d0ba1d found that the test above lets three
// mistakes through: no adoption deadline after a slow read, a "could not
// confirm" said as "still runs", and reads not bounded by what is left of the
// stop. In its scenario each covers for another. Each test here holds one of
// those rules alone. The stop's budget is 12 s from its start, and newcomers
// are adopted for 6 s of it (6.75 s with the margin above).

test('R3 a newcomer first seen by a read that ends after 6 s is not adopted: no TERM to it later than 6 s after the first TERM', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  // 62201 ignores TERM until its KILL. 62203 starts 1.5 s after the first
  // signal, in the work dir, in a group of its own, and ignores TERM. The
  // table is fast, and each read of the working folders takes 7 s after the
  // first signal: the read that first sees 62203 ends at about 8.7 s, after
  // the 6 s deadline and well within the 12 s budget, so a read bounded by
  // the budget is not cut.
  await table(box, [
    { pid: 62201, ppid: 1, pgid: 62201, cwd: workOf(box, 'dev'), command: 'node respawner.js', ignoresTerm: true },
    { pid: 62203, ppid: 62201, pgid: 62203, cwd: workOf(box, 'dev'), command: 'node worker.js', ignoresTerm: true, appearsAfterMs: 1500 },
  ]);
  await box.orca.set({ lsofDelayAfterKillMs: 7000 });

  const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

  const calls = await box.kill.calls();
  const argvs = JSON.stringify(calls.map((call) => [call.args, call.at - calls[0].at]));
  assert.deepEqual(calls[0]?.args, term(-62201), 'the premise: TERM to the group comes first');
  assert.ok(callOf(calls, kill(62201)) !== undefined, `the premise: 62201 gets its KILL, so the kit read on after it, got: ${argvs}`);
  const late = calls.filter((call) => call.args[1] === 'TERM' && reaching([call.args], 62203).length > 0 && call.at - calls[0].at > 6750);
  assert.deepEqual(late.map((call) => call.args), [], `no TERM to the newcomer later than 6 s after the first TERM, got: ${argvs}`);
  assert.deepEqual(processesIn(answer).stopped.filter((one) => one.pid === 62203), [], 'and it is not named as stopped');
});

test('R3 a last signal that no read follows, because the KILL call returned after the stop\'s time, is left as not confirmed, never as still running', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  // 62211 ignores TERM. Its KILL, the second kill call, blocks for 9.5 s, so
  // it goes at about 12.5 s, past the 12 s budget, and no read can follow it.
  await table(box, [{ pid: 62211, ppid: 1, pgid: 62211, cwd: workOf(box, 'dev'), command: 'node stubborn.js', ignoresTerm: true }]);
  await box.orca.set({ killDelaysMs: [0, 9500] });

  const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

  const calls = await box.kill.calls();
  const argvs = JSON.stringify(calls.map((call) => [call.args, call.at - calls[0].at]));
  assert.deepEqual(calls.map((call) => call.args), [term(-62211), kill(62211)], 'the premise: TERM, then the slow KILL');
  const reads = await box.ps.tableReads();
  const checked = reads.filter((read) => read.at > calls[1].at);
  assert.deepEqual(checked, [], `the premise: no read of the table followed the KILL, so the set of signals not confirmed is not empty, got reads: ${JSON.stringify(reads.map((read) => read.at - calls[0].at))}, calls: ${argvs}`);
  const processes = processesIn(answer);
  assert.deepEqual(processes.stopped.filter((one) => one.pid === 62211), [], `nothing checked that it ended, so it is not stopped: ${JSON.stringify(processes.stopped)}`);
  const left = processes.left.filter((one) => one.pid === 62211);
  assert.equal(left.length, 1, `it is named under left, got: ${JSON.stringify(processes.left)}`);
  assert.match(left[0].why ?? '', /confirm/i, `why says the kit could not confirm it ended: ${left[0].why}`);
  assert.doesNotMatch(left[0].why ?? '', /still runs/i, `and not that it still runs: ${left[0].why}`);
});

test('R3 a read that would run past the stop\'s end is cut at the end: no read is answered after it, and the process is left because the kit could not read again', async (t) => {
  const box = await createSandbox(t);
  await devFleet(box);
  // The first TERM call blocks for 9 s, so the first read after it starts
  // with about 3 s of the 12 s budget left. That read of the table takes 6 s,
  // which is within a single read's own 10 s limit but not within the stop's.
  await table(box, [{ pid: 62221, ppid: 1, pgid: 62221, cwd: workOf(box, 'dev'), command: 'node stubborn.js', ignoresTerm: true }]);
  await box.orca.set({ killDelaysMs: [9000], psDelayAfterKillMs: 6000 });

  const answer = answerIn(await retire(box, ['--session', 'dev', '--json']));

  const calls = await box.kill.calls();
  assert.deepEqual(calls.map((call) => call.args), [term(-62221)], 'the premise: the TERM, which took 9 s, and no time left for a KILL');
  const reads = await box.ps.tableReads();
  const after = reads.filter((read) => read.at >= calls[0].at).map((read) => read.done - calls[0].at);
  assert.ok(after.every((done) => done <= 3750), `a read after the TERM is cut when the stop's 12 s are up, about 3 s after the TERM went; answered ${JSON.stringify(after)} ms after it`);
  const processes = processesIn(answer);
  assert.deepEqual(processes.stopped.filter((one) => one.pid === 62221), [], 'it is not named as stopped');
  const left = processes.left.filter((one) => one.pid === 62221);
  assert.equal(left.length, 1, `it is named under left, got: ${JSON.stringify(processes.left)}`);
  assert.match(left[0].why ?? '', /read/i, `why says the kit could not read again: ${left[0].why}`);
});
