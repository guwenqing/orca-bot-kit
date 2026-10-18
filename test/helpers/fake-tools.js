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
//   4. process.kill() of any process but this one is refused. Signal 0, which
//      only asks whether a process is there, is let through.
//   5. A child inherits this file through NODE_OPTIONS, and so does each of its
//      children, while the environment it is given keeps NODE_OPTIONS.
//
// What it does not cover:
//
//   - A child started with an environment whose NODE_OPTIONS does not load
//     this file runs without it, and so does all it starts. The kit does that
//     for one child only, Orca's runtime client (src/orca.js askRuntime),
//     which starts no process. helpers/cli.js refuses such an environment for
//     a process the suite itself starts.
//   - ps and lsof by another spelling (a bare `ps` on PATH, which
//     src/record.js runs) are the real programs. Both only read.
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

for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  const real = childProcess[name];
  childProcess[name] = function fakeTools(file, ...rest) {
    check(name, file, rest);
    return real.call(this, programFor(file), ...rest);
  };
}

for (const name of ['exec', 'execSync']) {
  const real = childProcess[name];
  childProcess[name] = function fakeTools(line, ...rest) {
    if (shellLineActs(line)) refuse(`${name} runs ${JSON.stringify(line)}`);
    return real.call(this, line, ...rest);
  };
}

const realKill = process.kill.bind(process);
process.kill = function fakeTools(pid, signal) {
  if (Number(pid) !== process.pid && signal !== 0) refuse(`process.kill(${pid}, ${JSON.stringify(signal ?? 'SIGTERM')}) would signal a process that is not this one`);
  return realKill(pid, signal);
};

syncBuiltinESMExports();
