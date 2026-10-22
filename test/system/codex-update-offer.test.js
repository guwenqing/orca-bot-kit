// A system test, and the live proof #581 rests on: the real Codex on this
// machine honors `-c check_for_update_on_startup=false`. With it, Codex shows no
// update offer at start, though its version.json names a newer release. Run it
// alone with
// `npm run test:system -- --yes test/system/codex-update-offer.test.js`;
// `npm test` cannot, and no CI machine could.
//
// Why: Codex shows its update offer at start whenever a newer release is out,
// and a system test answers no screen outside the allowlists in
// test/helpers/screens.js. So every new Codex release stopped the live tests.
// Every Codex session a system test makes is now launched with the key, for
// that run only and written nowhere (test/helpers/codex-trust.js). A live test
// takes no update, and dismisses no offer in the user's own ~/.codex.
//
// It does not use Orca, so it takes its `test` from helpers/system-no-orca.js
// and runs at any hour, with OBK_ORCA pointed at a path that does not exist
// (#689). It runs the real `codex` in a pty of its own, twice,
// each time with a new throwaway CODEX_HOME and cwd under the system temp
// folder. That CODEX_HOME holds only an `auth.json` with a fake API key (without
// one, Codex stops at its sign-in screen and shows no offer) and a
// `version.json` that names 99.0.0 as the latest release, checked now. Each run
// passes `--no-daemon` (without it Codex leaves an app-server daemon running)
// and trusts its cwd by `-c projects=…`. Each run reads the screen for
// WINDOW_S seconds, and then the child is killed by its own pid.
//
//   1. The control, without the key: the screen shows "Update available" and
//      the version it offers, 99.0.0. So the setup really makes Codex offer an
//      update, and the next run means something.
//   2. With `-c check_for_update_on_startup=false`: the screen shows Codex's
//      input line, "Ask Codex to do anything", so the run really came up, and
//      no "Update available" and no 99.0.0.
//   3. Neither run changed its throwaway version.json, byte for byte.
//   4. Nothing was typed into Codex. The pty driver writes only the answer to
//      the terminal's cursor-position query (`ESC[6n` gets `ESC[1;1R`), once
//      for each query, and the test checks every byte it wrote.
//   5. The user's own ~/.codex/config.toml and ~/.codex/version.json are byte
//      for byte as they were before the runs. Only their hashes are compared
//      and printed: the files may hold secrets. A change made meanwhile by the
//      owner's own Codex fails the test the same way; run it again then.
//   6. Each child is gone at the end, and no process is left with the run's
//      throwaway folder on its command line.
//
// What the screen is: the bytes Codex wrote to the pty, with the escape
// sequences and all white space taken out. Codex draws with cursor moves and
// does not write the blanks of a new screen, so a phrase is looked for with
// its blanks taken out too.
//
// The pty driver is a short Python script (test/helpers/pty-driver.js), written
// into the run's temp folder and run with `python3 -I`: Node has no pty of its
// own, and the kit takes no dependency for one. It forks the child in a new
// pty, sets the window to 40 rows by 120 columns before it starts Codex, reads
// for WINDOW_S seconds, and then sends SIGKILL to the child by the pid the fork
// gave it, and waits for it. Each driver run has a hard time limit; if the
// driver itself is killed, the test kills the child by that same pid, only when
// the child's command line still names the run's own folder.
//
// The new pty puts the child in a session of its own, so the runner's hard stop
// at its time limit (#653) kills the driver and not the child, and can take
// this test's own kill with it. So the child ends by itself after CHILD_LIFE_S
// whatever happens: the driver sets an alarm in it before it starts Codex
// (#655).
//
// The machine it runs on is someone's working machine. So this test opens no
// Orca tab, types into nothing, signals no process but its own children by
// their own pids, reads ~/.codex only to compare, writes nothing there, and
// removes its temp folders whatever happens.
//
// **Nobody answers anything.** It takes about a minute: two runs of WINDOW_S
// seconds.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system-no-orca.js';

import { projectTrust } from '../helpers/codex-trust.js';
import { PTY_DRIVER } from '../helpers/pty-driver.js';

/** How long each run reads the screen. Codex 0.163.0 drew the offer within 12 s. */
const WINDOW_S = 30;

/** The hard limit on each driver run, past its own window. */
const DRIVER_LIMIT_MS = (WINDOW_S + 30) * 1000;

/** How long each Codex child lives at most, should its driver be killed (#655). */
const CHILD_LIFE_S = DRIVER_LIMIT_MS / 1000;

/** The release the throwaway version.json offers. */
const OFFERED = '99.0.0';

/** The only bytes the driver may write to the pty: the answer to a cursor-position query. */
const CURSOR_ANSWER = Buffer.from('\x1b[1;1R').toString('hex');

/** The user's own Codex files this test must leave as they are. */
const USER_FILES = ['config.toml', 'version.json'].map((name) => path.join(os.homedir(), '.codex', name));

/** A file's sha256, or `missing`. Only the hash is ever printed. */
const hashOf = (file) => (existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : 'missing');

/** The screen as text: escape sequences, control bytes and all white space taken out. */
const flat = (bytes) => bytes.toString('utf8')
  .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
  .replace(/\x1b[P^_X][^\x1b]*\x1b\\/g, '')
  .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
  .replace(/\x1b[ -/]*[0-~]/g, '')
  .replace(/[\x00-\x1f\x7f]/g, '')
  .replace(/\s+/g, '');

/** A phrase as it is looked for in a flat screen. */
const phrase = (text) => text.replace(/\s+/g, '');

/** The end of a flat screen, for a failure message. */
const tail = (text) => (text.length > 800 ? `…${text.slice(-800)}` : text);

/** Whether a process with this pid is alive. */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/** One pid's command line, or '' when it is gone. Only `-p`, never `-e`. */
function commandOf(pid) {
  const done = spawnSync('ps', ['-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8', timeout: 10000 });
  return done.status === 0 ? done.stdout.trim() : '';
}

/** Every process whose command line names `folder`: read only, never signalled. */
function processesNaming(folder) {
  const done = spawnSync('ps', ['-ww', '-A', '-o', 'pid=,command='], { encoding: 'utf8', timeout: 10000 });
  assert.equal(done.status, 0, `could not list processes: ${done.stderr}`);
  return done.stdout.split('\n').filter((line) => line.includes(folder)).map((line) => line.trim());
}

/** The child's environment: this one, without any Codex or OpenAI setting of the user's, and the throwaway CODEX_HOME. */
function childEnv(codexHome) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('CODEX_') && !name.startsWith('OPENAI_')));
  return { ...env, CODEX_HOME: codexHome, TERM: 'xterm-256color' };
}

/**
 * One run of the real `codex` in a pty, in a new throwaway CODEX_HOME and cwd
 * under `root`. `extra` are the arguments after the folder trust. Returns the
 * flat screen, the driver's report, and the version.json before and after.
 */
async function runCodex(root, name, extra) {
  const dir = path.join(root, name);
  const codexHome = path.join(dir, 'codex-home');
  const cwd = path.join(dir, 'cwd');
  await mkdir(codexHome, { recursive: true });
  await mkdir(cwd, { recursive: true });
  const cwdReal = await realpath(cwd);
  const versionFile = path.join(codexHome, 'version.json');
  await writeFile(path.join(codexHome, 'auth.json'), `${JSON.stringify({ OPENAI_API_KEY: 'sk-not-a-real-key' })}\n`);
  await writeFile(versionFile, `${JSON.stringify({ latest_version: OFFERED, last_checked_at: new Date().toISOString(), dismissed_version: null })}\n`);
  const versionBefore = await readFile(versionFile);

  const files = { out: path.join(dir, 'screen.bin'), report: path.join(dir, 'report.json'), pid: path.join(dir, 'pid') };
  const command = ['codex', '--no-daemon', '-c', projectTrust(cwdReal), ...extra];
  const done = spawnSync('python3', ['-I', path.join(root, 'pty-driver.py'), String(WINDOW_S), String(CHILD_LIFE_S), files.out, files.report, files.pid, cwdReal, ...command], {
    env: childEnv(codexHome),
    cwd: cwdReal,
    encoding: 'utf8',
    timeout: DRIVER_LIMIT_MS,
    killSignal: 'SIGKILL',
  });

  if (done.error !== undefined || done.status !== 0) {
    // The driver did not finish. Kill its child by the pid the fork gave it,
    // only while that pid still runs a command that names this run's folder.
    const pid = existsSync(files.pid) ? Number(readFileSync(files.pid, 'utf8')) : NaN;
    if (Number.isInteger(pid) && pid > 1 && commandOf(pid).includes(cwdReal)) process.kill(pid, 'SIGKILL');
    assert.fail(`the pty driver did not finish (${done.error?.message ?? `exit ${done.status}, signal ${done.signal}`}); its child ${pid} was killed if it still ran.\n${done.stderr}`);
  }

  const report = JSON.parse(await readFile(files.report, 'utf8'));
  return {
    screen: flat(await readFile(files.out)),
    report,
    versionBefore,
    versionAfter: await readFile(versionFile),
    cwdReal,
  };
}

test('Codex shows its update offer without -c check_for_update_on_startup=false and none with it, and nothing of the user\'s changes (#581)', async (t) => {
  const userBefore = USER_FILES.map(hashOf);
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-codex-update-')));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    assert.equal(existsSync(root), false, `this test left ${root} behind`);
  });
  await writeFile(path.join(root, 'pty-driver.py'), PTY_DRIVER);

  // The premise, in a throwaway CODEX_HOME of its own: a codex on PATH, and which.
  const versionHome = path.join(root, 'version-home');
  await mkdir(versionHome);
  const version = spawnSync('codex', ['--version'], { encoding: 'utf8', cwd: root, env: childEnv(versionHome), timeout: 30000, killSignal: 'SIGKILL' });
  assert.equal(version.status, 0, `the premise: a codex on PATH answers --version: ${version.error?.message ?? version.stderr}`);
  t.diagnostic(`codex --version: ${version.stdout.trim()}`);

  const runs = {};
  try {
    runs.control = await runCodex(root, 'control', []);
    runs.keyed = await runCodex(root, 'keyed', ['-c', 'check_for_update_on_startup=false']);
  } finally {
    // 5. The user's own files, whatever happened in the runs.
    assert.deepEqual(
      USER_FILES.map(hashOf),
      userBefore,
      `~/.codex/config.toml or ~/.codex/version.json changed during the run (sha256 before and after, in that order); if the owner's own Codex did not change it, this test did`,
    );
  }

  // 6. Each child is gone, and nothing is left running for this run's folder.
  for (const [name, run] of Object.entries(runs)) {
    t.diagnostic(`${name}: pid ${run.report.pid}, ${run.report.killed ? 'killed at the end of its window' : 'ended by itself'}, ${run.report.queries} cursor queries answered`);
    assert.equal(alive(run.report.pid), false, `the ${name} child ${run.report.pid} is still alive`);
  }
  assert.deepEqual(processesNaming(root), [], `processes left with ${root} on their command line; this test does not kill them`);

  for (const [name, run] of Object.entries(runs)) {
    // 3. The throwaway version.json, unchanged.
    assert.equal(run.versionAfter.equals(run.versionBefore), true, `the ${name} run changed its version.json: ${run.versionAfter.toString('utf8')}`);
    // 4. Nothing typed: every write the cursor-position answer, once a query.
    assert.equal(run.report.writes.length, run.report.queries, `the ${name} run wrote ${run.report.writes.length} times for ${run.report.queries} cursor queries`);
    assert.deepEqual(run.report.writes.filter((hex) => hex !== CURSOR_ANSWER), [], `the ${name} run wrote something other than the cursor-position answer to Codex`);
  }

  // 1. The control: the offer, and the release it offers.
  const { control, keyed } = runs;
  assert.ok(control.screen.includes(phrase('Update available')), `the control run showed no update offer in ${WINDOW_S} s, so the setup proves nothing; its screen:\n${tail(control.screen)}`);
  assert.ok(control.screen.includes(OFFERED), `the control run's offer did not name ${OFFERED}; its screen:\n${tail(control.screen)}`);

  // 2. With the key: Codex came up to its input line, and offered nothing.
  assert.ok(keyed.screen.includes(phrase('Ask Codex to do anything')), `with the key, Codex did not draw its input line in ${WINDOW_S} s; its screen:\n${tail(keyed.screen)}`);
  assert.equal(keyed.screen.includes(phrase('Update available')), false, `with the key, Codex still showed its update offer; its screen:\n${tail(keyed.screen)}`);
  assert.equal(keyed.screen.includes(OFFERED), false, `with the key, Codex still named ${OFFERED}; its screen:\n${tail(keyed.screen)}`);
});
