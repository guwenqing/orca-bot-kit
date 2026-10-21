// The pty driver bounds the life of the child it forks (#655): `PTY_DRIVER`
// in test/helpers/pty-driver.js, the Python script that
// test/system/codex-update-offer.test.js runs as
// `python3 -I <file> <seconds> <life> <out> <report> <pid file> <cwd> <command...>`.
//
// Its `pty.fork()` puts the child in a new session, outside the process group
// that `npm run test:system` stops at its limit (scripts/test-system.js). A
// hard stop kills the driver, not the child. So the child must end by itself.
//
// What this holds the driver to, run for real with a harmless node program as
// its command (no harness, no Orca):
//
//   - its child ends by itself once <life> seconds have passed, after the
//     driver was killed with SIGKILL, though the command ignores SIGHUP and
//     SIGTERM; it still runs before then;
//   - a child that ends on its own inside the window is reported as ended, not
//     killed, with its cursor-position query answered.
//
// And, reading the system tests as text (it runs none of them): no system test
// forks a pty or a new session of its own; that goes through the helper.
//
// Killing processes (AGENTS.md, 2026-09-20): the test signals only the driver,
// its own child, through the handle node gave it at spawn, and the driver's
// child, by the pid the driver wrote at its fork, only while `ps -p <pid>`
// shows that pid running this test's own command line. It prints each pid
// before it signals it. An after-hook sends SIGKILL to either that still
// runs, however the test ends.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { PTY_DRIVER } from './helpers/pty-driver.js';

/** The repo this file is in. */
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** How long after its life the child is given to be seen ended: starts and exits on a loaded machine. */
const MARGIN_MS = 3000;

/** A command that ignores SIGHUP and SIGTERM, writes the file it is given once it does, and runs for ever. */
const STUBBORN = 'process.on("SIGHUP", () => {}); process.on("SIGTERM", () => {});'
  + ' require("fs").writeFileSync(process.argv[1], "ready"); setInterval(() => {}, 1000);';

/** A command that asks for the cursor position, reads the answer, and ends with code 0. */
const ASKS = 'process.stdout.write("hi\\x1b[6n"); setTimeout(() => process.exit(0), 300);';

/**
 * Write the driver into a throwaway folder and run it with `python3 -I`, as
 * the system test does. Answers `{ dir, files, driver, exited }`; `exited` is
 * `{ code, signal }`. The after-hook kills the driver, and its child while
 * `ps -p` shows that pid running a command line that names `dir`.
 */
async function runDriver(t, { seconds, life, command }) {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-pty-driver-')));
  const files = { script: path.join(dir, 'pty-driver.py'), out: path.join(dir, 'screen.bin'), report: path.join(dir, 'report.json'), pid: path.join(dir, 'pid') };
  await writeFile(files.script, PTY_DRIVER);
  const driver = spawn('python3', ['-I', files.script, String(seconds), String(life), files.out, files.report, files.pid, dir, ...command(dir)], { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  driver.stderr.setEncoding('utf8');
  driver.stderr.on('data', (chunk) => { err += chunk; });
  const exited = new Promise((resolve, reject) => {
    driver.once('error', reject);
    driver.once('exit', (code, signal) => resolve({ code, signal, err }));
  });
  t.after(async () => {
    if (driver.exitCode === null && driver.signalCode === null) {
      t.diagnostic(`stopping this test's own driver that still runs: ${driver.pid}`);
      driver.kill('SIGKILL');
    }
    const pid = await childPid(files);
    if (pid !== undefined && runsMine(pid, dir)) {
      t.diagnostic(`stopping the driver's child that still runs: ${pid} (${dir})`);
      process.kill(pid, 'SIGKILL');
    }
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, files, driver, exited };
}

/** The pid the driver wrote at its fork, or undefined. */
async function childPid(files) {
  if (!existsSync(files.pid)) return undefined;
  const pid = Number(await readFile(files.pid, 'utf8'));
  return Number.isInteger(pid) && pid > 1 ? pid : undefined;
}

/** Whether `pid` runs, not as a zombie, with a command line that names `dir`: this test's own child only. */
function runsMine(pid, dir) {
  const seen = spawnSync('/bin/ps', ['-o', 'stat=,command=', '-p', String(pid)], { encoding: 'utf8' });
  const [, stat, command] = /^(\S+)\s+(.*)$/.exec(seen.status === 0 ? seen.stdout.trim() : '') ?? [];
  return stat !== undefined && !stat.startsWith('Z') && command.includes(dir);
}

/** Keep asking until `look` gives true, or `within` ms pass; answers whether it did. */
async function until(within, look) {
  const stop = performance.now() + within;
  for (;;) {
    if (await look()) return true;
    if (performance.now() >= stop) return false;
    await setTimeout(50);
  }
}

test('the driver\'s child ends by itself once its life has passed, after the driver was killed, though it ignores SIGHUP and SIGTERM', async (t) => {
  const LIFE_S = 4;
  const at = performance.now();
  const { dir, files, driver, exited } = await runDriver(t, {
    seconds: 60,
    life: LIFE_S,
    command: (where) => [process.execPath, '-e', STUBBORN, path.join(where, 'ready')],
  });
  const ready = path.join(dir, 'ready');
  assert.ok(await until(10000, () => existsSync(ready)), `the premise: the child says it ignores SIGHUP and SIGTERM, in ${ready}`);
  const pid = await childPid(files);
  assert.notEqual(pid, undefined, 'the driver writes its child\'s pid at once');

  t.diagnostic(`SIGKILL to this test's own driver ${driver.pid}, as a hard stop would send`);
  driver.kill('SIGKILL');
  assert.equal((await exited).signal, 'SIGKILL', 'the driver is gone');

  await setTimeout(1000);
  assert.equal(runsMine(pid, dir), true, `the premise: the child ${pid} still runs 1 s after its driver was killed, before its life of ${LIFE_S} s is over`);

  const within = LIFE_S * 1000 + MARGIN_MS - (performance.now() - at);
  assert.ok(await until(within, () => !runsMine(pid, dir)), `the child does not end by itself: ${pid} still runs ${LIFE_S * 1000 + MARGIN_MS} ms after the driver was started with a life of ${LIFE_S} s`);
});

test('a child that ends inside the window is reported ended, not killed, with its cursor query answered', async (t) => {
  const { files, exited } = await runDriver(t, { seconds: 20, life: 60, command: () => [process.execPath, '-e', ASKS] });
  const end = await Promise.race([exited, setTimeout(15000, undefined)]);
  assert.notEqual(end, undefined, 'the driver ends soon after its child does, inside its window');
  assert.deepEqual({ code: end.code, signal: end.signal }, { code: 0, signal: null }, `the driver ends with code 0: ${end.err}`);
  const report = JSON.parse(await readFile(files.report, 'utf8'));
  assert.deepEqual(
    { queries: report.queries, writes: report.writes, ended: report.ended, killed: report.killed, status: report.status, pid: report.pid },
    { queries: 1, writes: ['1b5b313b3152'], ended: true, killed: false, status: 0, pid: await childPid(files) },
  );
  assert.match((await readFile(files.out)).toString('latin1'), /hi\x1b\[6n/);
});

// ------------------------------------------------------------- the system tests

test('no system test forks a pty or a new session of its own: each goes through the bounded driver', async () => {
  const dir = path.join(repoRoot, 'test', 'system');
  const files = (await readdir(dir)).filter((name) => name.endsWith('.js')).sort();
  assert.ok(files.length > 0, 'there should be system tests to check');
  const found = [];
  for (const name of files) {
    const source = await readFile(path.join(dir, name), 'utf8');
    for (const [hit] of source.matchAll(/\bpty\.(?:fork|spawn|openpty)\b|\bos\.(?:forkpty|setsid)\b|\bsetsid\b/g)) found.push(`test/system/${name}: ${hit}`);
  }
  assert.deepEqual(found, [], 'system tests that start a process in a new session of their own, out of the runner\'s reach');
});
