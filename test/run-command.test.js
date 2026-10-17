// `obk run`: a bounded run of one command (#532, part 1).
//
//   obk run --timeout <seconds> -- <command> [<arg> ...]
//
// - It runs <command> with its arguments directly, with no shell in between,
//   with stdin, stdout and stderr passed through to the caller. It needs no
//   `--bots`, and works on macOS and Linux alike.
// - `--timeout` is a whole number of seconds, more than zero; `--timeout=<n>`
//   is accepted too.
// - A command that ends by itself: obk run exits with the command's exit code.
//   One ended by a signal obk run did not send: 128 + the signal number.
// - When the time runs out, it stops the command's whole process group (the
//   command and everything it started, also a grandchild that outlives its
//   parent): SIGTERM to the group, then SIGKILL to the group if anything
//   still runs after up to 3 seconds. It writes a plain line on stderr that
//   says so and names the number of seconds, and exits 124. A command that
//   ignores SIGTERM is still stopped, and obk run still exits 124.
// - A command that is not found: it says so on stderr, and exits 127.
// - Usage errors are refused with exit 1 and a message on stderr that starts
//   `obk: `: no `--timeout`; a timeout that is not a whole number more than
//   zero; no `--`; nothing after `--`; any other flag before `--`. A refused
//   run runs nothing.
// - `obk --help` lists `obk run`.
//
// The commands run here are small fixtures this file writes into the
// sandbox: node scripts that print, hang, ignore SIGTERM or start a
// grandchild, and write their pids to a file the test reads. Every fixture
// ends by itself within 20 seconds whatever happens, and any pid a test
// recorded that is still alive at its end is killed by that pid alone. The
// kit is started by the sandbox's own link to this checkout's CLI, by its
// full path, and with a guard of its own: a run that has not ended in 20
// seconds is killed by the pid captured at spawn.
//
// Expected exit codes are the requirement's literals: 124, 127, 128 + 9 = 137
// and 128 + 15 = 143. The wording of every message is the implementer's; only
// the `obk: ` start of a refusal, the number of seconds and the command's
// name are read.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { assertCleanFailure, createSandbox } from './helpers/cli.js';

/** How long the test waits for a run of the kit before it kills it by its own pid. */
const GUARD_MS = 20_000;

/** The node that runs this suite, by its full path: the fixtures' interpreter. */
const NODE = process.execPath;

/**
 * Run `obk <args>` by the sandbox's link to this checkout's CLI, with stdin
 * given as text (a pipe that closes) or none at all. Resolves with the exit
 * code, the signal, both streams, and how long the kit took to exit.
 *
 * A run that has not exited after GUARD_MS is killed, by the pid captured at
 * spawn, and resolves with `guarded: true`. Once the kit has exited, the
 * streams get 3 seconds to close, in case something it left behind still
 * holds them; then they are given up on.
 */
function runKit(box, args, { stdin } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(box.cli, args, {
      cwd: box.cwd,
      env: box.env,
      stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let guarded = false;
    let exited;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const guard = setTimeout(() => {
      guarded = true;
      child.kill('SIGKILL');
    }, GUARD_MS);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      resolve({ ...exited, stdout, stderr, guarded });
    };
    child.on('error', (error) => { clearTimeout(guard); reject(error); });
    child.on('exit', (code, signal) => {
      exited = { code, signal, elapsed: Date.now() - started };
      setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        finish();
      }, 3000).unref();
    });
    child.on('close', () => finish());
    if (stdin !== undefined) {
      child.stdin.on('error', () => {});
      child.stdin.end(stdin);
    }
  });
}

/** The run ended by itself, before the guard. */
function assertNotGuarded(result) {
  assert.equal(result.guarded, false, `obk run should have ended by itself within ${GUARD_MS} ms, got:\n${result.stdout}${result.stderr}`);
}

/** A refusal of a usage error: exit 1, nothing on stdout, a message on stderr that starts `obk: `, no crash. */
function assertUsageRefusal(result) {
  assertNotGuarded(result);
  assertCleanFailure(result);
  assert.ok(result.stderr.startsWith('obk: '), `a refusal starts its message with "obk: ", as every other obk refusal, got:\n${result.stderr}`);
}

/**
 * A fixture that hangs: it prints `started`, then (after it has set up what
 * `mode` asks) writes its pid to `pidFile`, and ends by itself after 20 s.
 * `mode` 'ignore-term' makes it ignore SIGTERM.
 */
const HANG = String.raw`
const fs = require('node:fs');
const [pidFile, mode = ''] = process.argv.slice(2);
if (mode === 'ignore-term') process.on('SIGTERM', () => {});
process.stdout.write('started\n');
fs.writeFileSync(pidFile + '.tmp', String(process.pid));
fs.renameSync(pidFile + '.tmp', pidFile);
setInterval(() => {}, 1000);
setTimeout(() => process.exit(99), 20000);
`;

/**
 * A fixture that starts a grandchild in its own process group and hangs.
 * Once the grandchild is up, it writes `{ child, grandchild }` pids to
 * `pidFile`. Both end by themselves after 20 s. The grandchild's stdio is
 * none, so it holds none of the kit's streams.
 *
 * `mode`:
 * - 'plain': both end on SIGTERM; the grandchild does not end when its parent
 *   ends.
 * - 'orphan-ignores-term': the child ends on SIGTERM, the grandchild ignores
 *   it, so the grandchild outlives its parent and only a SIGKILL to the group
 *   stops it.
 * - 'all-ignore-term': both ignore SIGTERM.
 */
const TREE = String.raw`
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const [pidFile, mode] = process.argv.slice(2);
if (mode === 'all-ignore-term') process.on('SIGTERM', () => {});
const ready = pidFile + '.grandchild';
const ignore = mode === 'plain' ? '' : "process.on('SIGTERM', () => {});";
const code = ignore + " require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000); setTimeout(() => process.exit(98), 20000);";
const grandchild = spawn(process.execPath, ['-e', code, ready], { stdio: 'ignore' });
const wait = setInterval(() => {
  if (!fs.existsSync(ready)) return;
  clearInterval(wait);
  fs.writeFileSync(pidFile + '.tmp', JSON.stringify({ child: process.pid, grandchild: grandchild.pid }));
  fs.renameSync(pidFile + '.tmp', pidFile);
}, 20);
setInterval(() => {}, 1000);
setTimeout(() => process.exit(99), 20000);
`;

/** Write the fixtures into the sandbox: `{ hang, tree }`, each a .cjs file's full path. */
async function fixtures(box) {
  const dir = path.join(box.root, 'fixtures');
  await mkdir(dir, { recursive: true });
  const hang = path.join(dir, 'hang.cjs');
  const tree = path.join(dir, 'tree.cjs');
  await writeFile(hang, HANG);
  await writeFile(tree, TREE);
  return { hang, tree };
}

/** Whether a process by this pid is still there: only ESRCH counts as gone. */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

/** Wait up to `ms` for the pid to be gone. Answers whether it is gone. */
async function goneWithin(pid, ms = 3000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (!alive(pid)) return true;
    await new Promise((resolve) => { setTimeout(resolve, 50); });
  }
  return !alive(pid);
}

/**
 * Kill, at the test's end, each pid in `pids` that is still alive: by that pid
 * alone, and only pids a fixture of this test wrote down.
 */
function cleanUp(t, pids) {
  t.after(() => {
    for (const pid of pids) {
      if (Number.isInteger(pid) && pid > 1 && alive(pid)) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // gone in between
        }
      }
    }
  });
}

/** The pid a hang fixture wrote, or undefined when it never wrote one. */
async function pidIn(file) {
  try {
    return Number(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/** The pids a tree fixture wrote, or undefined when it never wrote them. */
async function pidsIn(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Whether a file exists. */
async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** The command words of a node one-liner that writes `ran` into `marker`. */
const marking = (marker) => [NODE, '-e', "require('node:fs').writeFileSync(process.argv[1], 'ran')", marker];

/**
 * The block of the usage that a command's line starts: from `  obk <command> `
 * up to the next command's line. Undefined when the usage has no such line.
 * (As test/cli-basics.test.js reads it.)
 */
function usageBlock(usage, command) {
  const lines = usage.split('\n');
  const at = lines.findIndex((line) => line.startsWith(`  obk ${command} `) || line === `  obk ${command}`);
  if (at < 0) return undefined;
  const next = lines.findIndex((line, index) => index > at && line.startsWith('  obk '));
  return lines.slice(at, next < 0 ? undefined : next).join('\n');
}

// ----------------------------------------------------------------- a command that ends by itself

for (const code of [0, 3, 42]) {
  test(`R1 obk run exits with the command's own exit code when it ends by itself: ${code}`, async (t) => {
    const box = await createSandbox(t);

    const result = await runKit(box, ['run', '--timeout', '10', '--', NODE, '-e', `process.exit(${code})`]);

    assertNotGuarded(result);
    assert.equal(result.code, code, `the command exited ${code}, got ${result.code}:\n${result.stdout}${result.stderr}`);
  });
}

test('R1 the timeout is in seconds: a command that ends after 1.2 s, under --timeout 2, keeps its own exit code 5', async (t) => {
  const box = await createSandbox(t);

  const result = await runKit(box, ['run', '--timeout', '2', '--', NODE, '-e', 'setTimeout(() => process.exit(5), 1200)']);

  assertNotGuarded(result);
  assert.equal(result.code, 5, `the command ends by itself within the 2 seconds, got ${result.code}:\n${result.stdout}${result.stderr}`);
  assert.equal(result.stderr, '', 'nothing is said about a time limit the command kept to');
});

test('R1 --timeout=<n> is accepted as --timeout <n> is', async (t) => {
  const box = await createSandbox(t);

  const result = await runKit(box, ['run', '--timeout=10', '--', NODE, '-e', 'process.exit(7)']);

  assertNotGuarded(result);
  assert.equal(result.code, 7, `got ${result.code}:\n${result.stdout}${result.stderr}`);
});

for (const [signal, code] of [['SIGTERM', 143], ['SIGKILL', 137]]) {
  test(`R2 a command ended by a ${signal} that obk run did not send: obk run exits ${code}, 128 + the signal number`, async (t) => {
    const box = await createSandbox(t);

    const result = await runKit(box, ['run', '--timeout', '10', '--', NODE, '-e', `process.kill(process.pid, '${signal}')`]);

    assertNotGuarded(result);
    assert.equal(result.code, code, `got ${result.code} (signal ${result.signal}):\n${result.stdout}${result.stderr}`);
  });
}

// ----------------------------------------------------------------- no shell, and the streams pass through

test('R3 the command and its arguments go to the program as they are, with no shell in between', async (t) => {
  const box = await createSandbox(t);
  const args = ['a b', '$HOME', '*', '; echo hi', '', "it's"];

  const result = await runKit(box, ['run', '--timeout', '10', '--', 'node', '-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', ...args]);

  assertNotGuarded(result);
  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.deepEqual(JSON.parse(result.stdout), args, 'each argument arrives as one word, unexpanded, the empty one too');
});

test('R3 a command line given as one word is not split by a shell: no program is called "echo hi", so it is not found (127)', async (t) => {
  const box = await createSandbox(t);

  const result = await runKit(box, ['run', '--timeout', '10', '--', 'echo hi']);

  assertNotGuarded(result);
  assert.equal(result.code, 127, `got ${result.code}:\n${result.stdout}${result.stderr}`);
  assert.ok(!result.stdout.includes('hi'), `no shell ran echo, got stdout: ${result.stdout}`);
});

test('R3 stdin is passed through to the command, and its stdout comes back as it wrote it', async (t) => {
  const box = await createSandbox(t);
  const text = 'line one\nline two\n';

  const result = await runKit(box, ['run', '--timeout', '10', '--', NODE, '-e', 'process.stdin.pipe(process.stdout)'], { stdin: text });

  assertNotGuarded(result);
  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.equal(result.stdout, text);
});

test('R3 the command\'s stderr comes back on stderr, and its stdout on stdout, each apart', async (t) => {
  const box = await createSandbox(t);

  const result = await runKit(box, ['run', '--timeout', '10', '--', NODE, '-e', "process.stderr.write('to stderr\\n'); process.stdout.write('to stdout\\n')"]);

  assertNotGuarded(result);
  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.equal(result.stdout, 'to stdout\n');
  assert.ok(result.stderr.includes('to stderr'), `the command's stderr should come back on stderr, got: ${result.stderr}`);
});

// ----------------------------------------------------------------- a command that is not found

for (const [label, command] of [
  ['by a name on no folder of PATH', 'no-such-command-532'],
  ['by an absolute path that does not exist', '/no/such/folder/no-such-command-532'],
]) {
  test(`R4 a command not found ${label}: obk run says so on stderr, naming it, and exits 127`, async (t) => {
    const box = await createSandbox(t);

    const result = await runKit(box, ['run', '--timeout', '10', '--', command, 'arg']);

    assertNotGuarded(result);
    assert.equal(result.code, 127, `got ${result.code}:\n${result.stdout}${result.stderr}`);
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.includes('no-such-command-532'), `stderr should name the command, got: ${result.stderr}`);
    assert.ok(!/^\s+at /m.test(result.stderr), `expected a message, got a crash:\n${result.stderr}`);
  });
}

// ----------------------------------------------------------------- the time runs out

test('R5 a command that runs past the time is stopped: obk run says so on stderr, naming the seconds, and exits 124', async (t) => {
  const box = await createSandbox(t);
  const { hang } = await fixtures(box);
  const pidFile = path.join(box.root, 'hang.pid');
  const pids = [];
  cleanUp(t, pids);

  const result = await runKit(box, ['run', '--timeout', '2', '--', NODE, hang, pidFile]);
  const pid = await pidIn(pidFile);
  pids.push(pid);

  assertNotGuarded(result);
  assert.ok(pid !== undefined, `the premise: the fixture got going and wrote its pid, got:\n${result.stdout}${result.stderr}`);
  assert.equal(result.code, 124, `got ${result.code}:\n${result.stdout}${result.stderr}`);
  assert.ok(result.stdout.includes('started'), `what the command wrote before the time ran out comes back, got: ${result.stdout}`);
  assert.ok(result.elapsed >= 1800, `it should wait the 2 seconds before it stops the command, it took ${result.elapsed} ms`);
  assert.ok(result.elapsed < 2000 + 3000 + 4000, `it should stop the command soon after the 2 seconds, it took ${result.elapsed} ms`);
  const lines = result.stderr.split('\n').filter((line) => line.trim() !== '');
  assert.ok(lines.some((line) => /(^|\D)2(\D|$)/.test(line)), `a line on stderr should name the 2 seconds, got:\n${result.stderr}`);
  assert.ok(!/^\s+at /m.test(result.stderr), `expected a plain line, got a crash:\n${result.stderr}`);
  assert.ok(await goneWithin(pid), `the command ${pid} should be stopped`);
});

test('R5 --timeout=<n> bounds the run as --timeout <n> does: a hanging command is stopped and obk run exits 124', async (t) => {
  const box = await createSandbox(t);
  const { hang } = await fixtures(box);
  const pidFile = path.join(box.root, 'hang.pid');
  const pids = [];
  cleanUp(t, pids);

  const result = await runKit(box, ['run', '--timeout=1', '--', NODE, hang, pidFile]);
  pids.push(await pidIn(pidFile));

  assertNotGuarded(result);
  assert.equal(result.code, 124, `got ${result.code}:\n${result.stdout}${result.stderr}`);
  assert.ok(result.elapsed >= 900, `it should wait the 1 second, it took ${result.elapsed} ms`);
});

test('R5 a command that ignores SIGTERM is still stopped (by the SIGKILL), and obk run still exits 124', async (t) => {
  const box = await createSandbox(t);
  const { hang } = await fixtures(box);
  const pidFile = path.join(box.root, 'stubborn.pid');
  const pids = [];
  cleanUp(t, pids);

  const result = await runKit(box, ['run', '--timeout', '2', '--', NODE, hang, pidFile, 'ignore-term']);
  const pid = await pidIn(pidFile);
  pids.push(pid);

  assertNotGuarded(result);
  assert.ok(pid !== undefined, `the premise: the fixture got going and wrote its pid, got:\n${result.stdout}${result.stderr}`);
  assert.equal(result.code, 124, `got ${result.code}:\n${result.stdout}${result.stderr}`);
  assert.ok(result.elapsed < 2000 + 3000 + 4000, `the SIGKILL comes no more than 3 seconds after the SIGTERM, it took ${result.elapsed} ms`);
  assert.ok(await goneWithin(pid), `the command ${pid} ignored SIGTERM and should have been killed`);
});

for (const [mode, why] of [
  ['plain', 'a grandchild that does not end when its parent ends'],
  ['orphan-ignores-term', 'a grandchild that ignores SIGTERM and outlives its parent, which ends on it'],
  ['all-ignore-term', 'a command and a grandchild that both ignore SIGTERM'],
]) {
  test(`R6 the time running out stops the whole process group: ${why}; obk run exits 124 and none of them is left`, async (t) => {
    const box = await createSandbox(t);
    const { tree } = await fixtures(box);
    const pidFile = path.join(box.root, `tree-${mode}.pid`);
    const pids = [];
    cleanUp(t, pids);

    const result = await runKit(box, ['run', '--timeout', '2', '--', NODE, tree, pidFile, mode]);
    const written = await pidsIn(pidFile);
    // The grandchild's pid is also in its own ready file, should the child
    // have died before it wrote the pair.
    const ready = await pidIn(`${pidFile}.grandchild`);
    pids.push(written?.child, written?.grandchild, ready);

    assertNotGuarded(result);
    assert.ok(written !== undefined, `the premise: the fixture started its grandchild and wrote both pids, got:\n${result.stdout}${result.stderr}`);
    assert.equal(result.code, 124, `got ${result.code}:\n${result.stdout}${result.stderr}`);
    assert.ok(await goneWithin(written.child), `the command ${written.child} should be stopped`);
    assert.ok(await goneWithin(written.grandchild), `the grandchild ${written.grandchild} is in the command's process group and should be stopped too`);
  });
}

// ----------------------------------------------------------------- usage errors

/** Each refused form: the arguments after `run`, given a marker command to put after `--` where the form has one. */
const REFUSED = [
  ['no --timeout', (cmd) => ['--', ...cmd]],
  ['--timeout 0', (cmd) => ['--timeout', '0', '--', ...cmd]],
  ['--timeout -5', (cmd) => ['--timeout', '-5', '--', ...cmd]],
  ['--timeout 1.5', (cmd) => ['--timeout', '1.5', '--', ...cmd]],
  ['--timeout abc', (cmd) => ['--timeout', 'abc', '--', ...cmd]],
  ['--timeout given empty', (cmd) => ['--timeout', '', '--', ...cmd]],
  ['--timeout= with no value', (cmd) => ['--timeout=', '--', ...cmd]],
  ['--timeout=0', (cmd) => ['--timeout=0', '--', ...cmd]],
  ['--timeout with no value before --', (cmd) => ['--timeout', '--', ...cmd]],
  ['no -- before the command', (cmd) => ['--timeout', '5', ...cmd]],
  ['nothing after --', () => ['--timeout', '5', '--']],
  ['another flag before -- (--bots)', (cmd) => ['--timeout', '5', '--bots', 'bots', '--', ...cmd]],
  ['another flag before -- (--verbose), ahead of --timeout', (cmd) => ['--verbose', '--timeout', '5', '--', ...cmd]],
];

for (const [label, argsFor] of REFUSED) {
  test(`R7 obk run with ${label} is refused (exit 1, "obk: " on stderr) and runs nothing`, async (t) => {
    const box = await createSandbox(t);
    // The premise: the same command, given as obk run takes it, runs.
    const control = path.join(box.root, 'control.marker');
    const ran = await runKit(box, ['run', '--timeout', '5', '--', ...marking(control)]);
    assertNotGuarded(ran);
    assert.equal(ran.code, 0, `the premise: obk run --timeout 5 -- <command> runs it, got ${ran.code}:\n${ran.stdout}${ran.stderr}`);
    assert.ok(await exists(control), 'the premise: the command ran and left its marker');
    const marker = path.join(box.root, 'refused.marker');

    const result = await runKit(box, ['run', ...argsFor(marking(marker))]);

    assertUsageRefusal(result);
    assert.equal(await exists(marker), false, 'a refused run runs nothing');
  });
}

// ----------------------------------------------------------------- it needs no bots folder, and --help lists it

test('R8 obk run needs no --bots: it runs in a folder with no bots folder anywhere, and makes none', async (t) => {
  const box = await createSandbox(t);
  const marker = path.join(box.root, 'ran.marker');

  const result = await runKit(box, ['run', '--timeout', '5', '--', ...marking(marker)]);

  assertNotGuarded(result);
  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.ok(await exists(marker), 'the command ran');
  assert.equal(await exists(box.path('bots')), false, 'no bots folder was made');
});

test('R9 obk --help lists obk run, with its --timeout', async (t) => {
  const box = await createSandbox(t);

  const result = await runKit(box, ['--help']);

  assert.equal(result.code, 0);
  const block = usageBlock(result.stdout, 'run');
  assert.notEqual(block, undefined, `usage should list obk run, got:\n${result.stdout}`);
  assert.ok(block.includes('--timeout'), `obk run's usage should name --timeout, got:\n${block}`);
});
