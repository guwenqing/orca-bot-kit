// Loaded with `node --import` ahead of every process a sandbox starts
// (helpers/cli.js puts it in the sandbox's NODE_OPTIONS), the kit's own runs
// and the runs it starts of itself included. The kit runs `/bin/ps`,
// `/usr/sbin/lsof`, `/bin/stty`, `/usr/bin/osascript` and `/bin/kill` by those
// fixed paths, and reads no setting that changes them: core is core and test
// is test (#652). This file is test code, so the fakes are reached from here:
// a call of one of the five paths goes to the fake that the variable beside it
// names in the process's environment.
//
// What it covers, in a process with this file loaded:
//
//   1. spawn, spawnSync, execFile and execFileSync of one of the five fixed
//      paths run the fake its variable names. With the variable not set, the
//      call goes to a path that is not there, and the kit sees a program that
//      does not start. The kit runs the five this way (src/orca.js,
//      src/processes.js).
//   2. A call of any other program whose arguments name one of the five paths
//      as a word is refused: a shell with -c and a line (`sh -c '/bin/kill
//      -l'`), a wrapper (`env /bin/kill`), anything. So is a shell line, from
//      exec, execSync or `shell: true`, that names one.
//   3. kill, osascript and stty by any other spelling (`kill`, `/usr/bin/kill`)
//      are refused as programs. As words of a shell line (exec, execSync,
//      `shell: true`, or a shell such as sh, bash or zsh with -c) they are
//      refused too, because a shell's own `kill` sends real signals.
//   4. process.kill() of any process but this one, and of any group, is
//      refused, except for a child that this process started with spawn,
//      execFile or exec, and that child's group: kill only processes you
//      started, by their own pid (AGENTS.md). A child's own pid is let
//      through until its exit is seen, and its group after that as well, so
//      that a runner can stop what its child left in the group (as
//      scripts/test-system.js does). Signal 0, which only asks whether a
//      process is there, is let through.
//   5. A child inherits this file through NODE_OPTIONS, and so does each of its
//      children, while the environment it is given keeps NODE_OPTIONS.
//
// What it does not cover:
//
//   - A child started with an environment whose NODE_OPTIONS does not load
//     this file runs without it, and so does all it starts. The kit does that
//     for one child only, Orca's runtime client (src/orca.js askRuntime),
//     which starts no process. core-is-core.test.js CC5 holds the core to
//     that: it fails on any other environment the core gives a child, any
//     other mention of NODE_OPTIONS in src/, and any process call in
//     src/orca-runtime.cjs. helpers/cli.js refuses such an environment for a
//     process the suite itself starts. Test code that starts a child with
//     such an environment (FT10 does, to show this) is not held.
//   - ps and lsof by another spelling (a bare `ps` on PATH, which
//     src/record.js runs) are the real programs. Both only read.
//   - A child from fork, and one from spawnSync or execFileSync (which has
//     ended when the call returns), is not recorded, so it may not be
//     signalled. A grandchild may not be either, unless its own parent sends
//     the signal.
//   - A group id is a child's pid. Once the group is empty, that id may come
//     back to an unrelated process; a signal to the group then reaches it.
//   - A shell script from a file, and code given to another interpreter
//     (`node -e`, `python3 -c`) that builds a path at run time, are not read.
//
// Node's builtin modules give ES modules live bindings, so a change to
// `node:child_process` reaches `import { spawnSync } from 'node:child_process'`
// once `syncBuiltinESMExports` has run.
//
// Only a preload: importing it changes `node:child_process` for the whole
// process, so the suite's own process never imports it, and it exports
// nothing. helpers/cli.js names the five variables itself.

import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

/** Each fixed path the kit runs, and the variable that names its fake. */
const FAKE_TOOLS = {
  '/bin/ps': 'OBK_TEST_PS',
  '/usr/sbin/lsof': 'OBK_TEST_LSOF',
  '/bin/stty': 'OBK_TEST_STTY',
  '/usr/bin/osascript': 'OBK_TEST_OSASCRIPT',
  '/bin/kill': 'OBK_TEST_KILL',
};

/** Where a call goes when its fake is not named: a path that is not there. */
const NO_FAKE = '/nonexistent/obk-test-fake-tools/no-fake-named';

/** The program a call of `file` runs in this process. */
function programFor(file) {
  if (typeof file !== 'string' || !Object.hasOwn(FAKE_TOOLS, file)) return file;
  const fake = process.env[FAKE_TOOLS[file]];
  return fake === undefined || fake === '' ? NO_FAKE : fake;
}

/** The programs that act on the world, refused by any spelling but the fixed one. */
const ACTING = ['kill', 'osascript', 'stty'];

/** Shells, which run the line after -c. */
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'mksh', 'fish', 'csh', 'tcsh', 'ash', 'busybox']);

const asWord = (word) => new RegExp(`(^|[\\s;&|(){}<>!'"\`])${word.replaceAll('/', '\\/')}($|[\\s;&|(){}<>'"\`])`);
const FIXED_WORDS = Object.keys(FAKE_TOOLS).map(asWord);
const ACTING_WORDS = ACTING.map(asWord);

/** Whether a text names one of the fixed paths as a word. */
const namesTool = (text) => typeof text === 'string' && FIXED_WORDS.some((word) => word.test(text));

/** Whether a shell line names a fixed path, or kill, osascript or stty, as a word. */
const shellLineActs = (line) => namesTool(line) || (typeof line === 'string' && ACTING_WORDS.some((word) => word.test(line)));

const basename = (file) => (typeof file === 'string' ? file.slice(file.lastIndexOf('/') + 1) : '');

const refuse = (what) => {
  throw new Error(`helpers/fake-tools.js: ${what}. In a sandbox the kit's ps, lsof, stty, osascript and kill go to fakes, `
    + `and only by their fixed paths (${Object.keys(FAKE_TOOLS).join(', ')}), run by themselves with spawnSync or execFileSync.`);
};

/** The options of a call, wherever they sit among its arguments. */
const optionsIn = (rest) => rest.find((arg) => arg !== null && typeof arg === 'object' && !Array.isArray(arg));

/** The argument list of a call, when it has one. */
const argsIn = (rest) => (Array.isArray(rest[0]) ? rest[0] : []);

/** Refuse a call of `file` with `rest` that could reach a real one of the five. */
function check(name, file, rest) {
  if (typeof file !== 'string' || Object.hasOwn(FAKE_TOOLS, file)) return;
  const args = argsIn(rest);
  if (optionsIn(rest)?.shell) {
    const line = [file, ...args].join(' ');
    if (shellLineActs(line)) refuse(`${name} with shell runs ${JSON.stringify(line)}`);
    return;
  }
  if (ACTING.includes(basename(file))) refuse(`${name} runs ${file}, which is not its fixed path`);
  const named = args.find((arg) => namesTool(arg));
  if (named !== undefined) refuse(`${name} runs ${file} with ${JSON.stringify(named)}, which names a fixed path`);
  if (SHELLS.has(basename(file))) {
    const at = args.findIndex((arg) => typeof arg === 'string' && /^-[a-zA-Z]*c[a-zA-Z]*$/.test(arg));
    const line = at < 0 ? undefined : args[at + 1];
    if (line !== undefined && shellLineActs(line)) refuse(`${name} runs ${file} -c ${JSON.stringify(line)}`);
  }
}

/** The pids of the children this process started that have not ended yet. */
const running = new Set();
/** The pids of all the children this process started: each is the id of the child's group, if it leads one. */
const started = new Set();

/** Record the child of an async call, so that this process may signal it and its group. */
function record(child) {
  if (!Number.isInteger(child?.pid)) return child;
  running.add(child.pid);
  started.add(child.pid);
  child.once('exit', () => running.delete(child.pid));
  return child;
}

for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  const real = childProcess[name];
  const async = !name.endsWith('Sync');
  childProcess[name] = function fakeTools(file, ...rest) {
    check(name, file, rest);
    const result = real.call(this, programFor(file), ...rest);
    return async ? record(result) : result;
  };
}

for (const name of ['exec', 'execSync']) {
  const real = childProcess[name];
  const async = !name.endsWith('Sync');
  childProcess[name] = function fakeTools(line, ...rest) {
    if (shellLineActs(line)) refuse(`${name} runs ${JSON.stringify(line)}`);
    const result = real.call(this, line, ...rest);
    return async ? record(result) : result;
  };
}

/** Whether this process may send a signal to `pid`: itself, a running child of its own, or the group of a child of its own. */
function mayKill(pid) {
  const id = Number(pid);
  if (id === process.pid) return true;
  return id < 0 ? started.has(-id) : running.has(id);
}

const realKill = process.kill.bind(process);
process.kill = function fakeTools(pid, signal) {
  if (signal !== 0 && !mayKill(pid)) refuse(`process.kill(${pid}, ${JSON.stringify(signal ?? 'SIGTERM')}) would signal a process or a group that this process did not start`);
  return realKill(pid, signal);
};

syncBuiltinESMExports();
