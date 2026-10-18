// Loaded with `node --import` ahead of every process a sandbox starts
// (helpers/cli.js puts it in the sandbox's NODE_OPTIONS), the kit's own runs
// and the runs it starts of itself included. The kit runs `/bin/ps`,
// `/usr/sbin/lsof`, `/bin/stty`, `/usr/bin/osascript` and `/bin/kill` by those
// fixed paths, and reads no setting that changes them: core is core and test
// is test (#652). This file is test code, so the fakes are reached from here:
// a call of one of the five paths goes to the fake that the variable beside it
// names in the process's environment.
//
// A process with this file loaded never runs one of the five real programs.
// When the variable is not set, the call goes to a path that is not there, and
// the kit sees a program that does not start. So no sandboxed run reads the
// machine's process table, clicks the real Orca's menu, or sends a real
// signal (#537), even when a test forgets a fake.
//
// The kit runs the five with spawnSync (src/orca.js, src/processes.js). This
// covers spawn, spawnSync, execFile and execFileSync, the forms that take the
// program by itself. A shell line (exec, execSync, or a spawn with `shell`)
// that names one of the five paths cannot be sent to a fake safely, so it is
// refused with an error that says why.
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

/** Whether a shell line names one of the fixed paths as a word. */
const namesTool = (line) => typeof line === 'string'
  && Object.keys(FAKE_TOOLS).some((file) => new RegExp(`(^|[\\s;&|('"\`])${file.replaceAll('/', '\\/')}($|[\\s;&|)'"\`])`).test(line));

const refuseLine = (how, line) => {
  throw new Error(`helpers/fake-tools.js: ${how} names ${JSON.stringify(line)}, a shell line with one of ${Object.keys(FAKE_TOOLS).join(', ')} in it. `
    + 'A shell line cannot be sent to a fake safely. Run the program by itself, with spawnSync or execFileSync.');
};

/** The options of a call, wherever they sit among its arguments. */
const optionsIn = (rest) => rest.find((arg) => arg !== null && typeof arg === 'object' && !Array.isArray(arg));

for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  const real = childProcess[name];
  childProcess[name] = function fakeTools(file, ...rest) {
    if (optionsIn(rest)?.shell && namesTool(file)) refuseLine(`${name} with shell`, file);
    return real.call(this, programFor(file), ...rest);
  };
}

for (const name of ['exec', 'execSync']) {
  const real = childProcess[name];
  childProcess[name] = function fakeTools(line, ...rest) {
    if (namesTool(line)) refuseLine(name, line);
    return real.call(this, line, ...rest);
  };
}

syncBuiltinESMExports();
