// A system test bounds the life of each process it starts outside the
// runner's process group (#655): `stubbornProgram(seconds)` in
// test/helpers/stubborn.js, and how the system tests use it.
//
// `npm run test:system` stops a run at its limit by SIGKILL to the process
// group it made for the tests (scripts/test-system.js). A process that a
// system test starts with `detached: true` is in a group of its own, out of
// reach of that stop, and AGENTS.md forbids a kill by an id read from `ps`. So
// such a process must end by itself. test/system/retire-stops-processes.test.js
// starts one that ignores SIGTERM on purpose, so that `obk temp retire` has to
// escalate to SIGKILL; it builds that program with `stubbornProgram(LIFE_S)`.
//
// What this holds the helper's program to, run for real with `node -e`:
//
//   - it ignores a SIGTERM sent once it says `ready`;
//   - it ends by itself, with code 0, once its `seconds` have passed, and not
//     before, SIGTERM or not; it writes `ready` and a newline and nothing else;
//   - its text names SIGTERM, which the system test looks for in the command
//     line the kit reports.
//
// And, reading the system tests as text (it runs none of them): each
// `stubbornProgram(` there has a bound of at most the runner's limit, as
// `const LIMIT = <n>;` in scripts/test-system.js says it.
//
// Killing processes (AGENTS.md, 2026-09-20): every process here is this test's
// own child, in this test's own group. The test signals only those, through
// the handle node gave it at spawn, and prints each pid before it signals it.
// An after-hook sends SIGKILL to any of them that still runs, however the test
// ends.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { stubbornProgram } from './helpers/stubborn.js';

/** The repo this file is in. */
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** How long after its bound the program is given to be seen ended: node's start and exit, on a loaded machine. */
const MARGIN_MS = 3000;

/** How early, by the clocks' rounding, an end still counts as "once its seconds have passed". */
const EARLY_MS = 50;

/**
 * Start `node -e stubbornProgram(seconds)` as this test's own child. Answers
 * `{ child, ready, ended }`: `ready` is the first line it writes, and `ended`
 * is `{ code, signal, ms, out }` once it ends, `ms` counted from the spawn and
 * `out` all it wrote. Any such child that still runs when the test ends gets
 * SIGKILL, by its own handle.
 */
function startStubborn(t, seconds) {
  const at = performance.now();
  const child = spawn(process.execPath, ['-e', stubbornProgram(seconds)], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    t.diagnostic(`stopping this test's own child that still runs: ${child.pid} (stubbornProgram(${seconds}))`);
    child.kill('SIGKILL');
  });
  let out = '';
  let err = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { err += chunk; });
  const ended = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal, ms: performance.now() - at, out, err }));
  });
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      out += chunk;
      if (out.includes('\n')) resolve(out.slice(0, out.indexOf('\n')));
    });
    ended.then(({ code, signal }) => reject(new Error(`stubbornProgram(${seconds}) ended (code ${code}, signal ${signal}) before it said anything: ${err}`)), reject);
  });
  return { child, ready, ended };
}

/** What `ended` gives within `ms`, or undefined if the child still runs then. */
const endedWithin = (ended, ms) => Promise.race([ended, setTimeout(ms, undefined)]);

// ------------------------------------------------------------- the program

test('the stubborn program outlives a SIGTERM sent once it says ready', async (t) => {
  const { child, ready, ended } = startStubborn(t, 60);
  assert.equal(await ready, 'ready');
  t.diagnostic(`SIGTERM to this test's own child ${child.pid} (stubbornProgram(60))`);
  child.kill('SIGTERM');
  const after = await endedWithin(ended, 1000);
  assert.equal(after, undefined, `stubbornProgram(60) ended within 1 s of a SIGTERM: ${JSON.stringify(after)}`);
});

test('the stubborn program ends by itself, with code 0, once its seconds have passed and not before, SIGTERM or not, and writes only ready', async (t) => {
  // Two bounds, so that a program that ignores its argument cannot meet both.
  const runs = [1, 5].map((seconds) => ({ seconds, ...startStubborn(t, seconds) }));
  await Promise.all(runs.map(async ({ seconds, child, ready, ended }) => {
    assert.equal(await ready, 'ready', `stubbornProgram(${seconds}) says ready first`);
    t.diagnostic(`SIGTERM to this test's own child ${child.pid} (stubbornProgram(${seconds}))`);
    child.kill('SIGTERM');
    const within = seconds * 1000 + MARGIN_MS;
    const end = await endedWithin(ended, within);
    assert.notEqual(end, undefined, `stubbornProgram(${seconds}) does not end by itself: it still runs ${within} ms after it was started`);
    assert.deepEqual({ code: end.code, signal: end.signal }, { code: 0, signal: null }, `stubbornProgram(${seconds}) ends by itself with code 0, not by a signal: ${end.err}`);
    assert.ok(end.ms >= seconds * 1000 - EARLY_MS, `stubbornProgram(${seconds}) ended ${Math.round(end.ms)} ms after it was started, before its ${seconds} s had passed`);
    assert.equal(end.out, 'ready\n', `stubbornProgram(${seconds}) writes ready and a newline, and nothing else`);
  }));
});

test('the stubborn program\'s text names SIGTERM, as the kit\'s report of its command line must show', () => {
  assert.match(stubbornProgram(600), /SIGTERM/);
});

// ------------------------------------------------------------- the system tests

/** The runner's limit for a whole run, in seconds, as scripts/test-system.js states it. */
async function runLimit() {
  const runner = await readFile(path.join(repoRoot, 'scripts', 'test-system.js'), 'utf8');
  const found = /^const LIMIT = (\d+);$/m.exec(runner);
  assert.ok(found, 'scripts/test-system.js should state its limit as `const LIMIT = <seconds>;`');
  return Number(found[1]);
}

/** A whole number, or a product of them such as `60 * 60`, as a number; otherwise undefined. */
function numberOf(text) {
  const factors = text.split('*').map((one) => one.trim().replaceAll('_', ''));
  if (!factors.every((one) => /^\d+$/.test(one))) return undefined;
  return factors.reduce((product, one) => product * Number(one), 1);
}

/**
 * Each `stubbornProgram(` call in one file's source, as `{ arg, seconds }`:
 * `seconds` is the bound as a number, from a literal or from a
 * `const NAME = <number>;` in the same file, or undefined when it cannot be
 * read so.
 */
function stubbornBoundsIn(source) {
  return [...source.matchAll(/\bstubbornProgram\(([^)]*)\)/g)].map(([, raw]) => {
    const arg = raw.trim();
    let seconds = numberOf(arg);
    if (seconds === undefined && /^[A-Za-z_$][\w$]*$/.test(arg)) {
      const declared = new RegExp(`\\bconst ${arg.replaceAll('$', '\\$')} = ([^;\\n]+);`).exec(source);
      if (declared) seconds = numberOf(declared[1]);
    }
    return { arg, seconds };
  });
}

/** What is wrong with each bound in `source`, given the run's `limit`. */
const boundTrouble = (source, limit) => stubbornBoundsIn(source)
  .filter(({ seconds }) => !(Number.isFinite(seconds) && seconds > 0 && seconds <= limit))
  .map(({ arg, seconds }) => (seconds === undefined
    ? `stubbornProgram(${arg}): its bound is not a number this check can read`
    : `stubbornProgram(${arg}) lives ${seconds} s, not from 1 to the run's limit of ${limit} s`));

test('the check reads a bound from a literal or a constant, and names one it cannot read or one past the limit', () => {
  const limit = 3600;
  assert.deepEqual(stubbornBoundsIn('const LIFE_S = 600;\nconst P = stubbornProgram(LIFE_S);'), [{ arg: 'LIFE_S', seconds: 600 }]);
  assert.deepEqual(boundTrouble('const LIFE_S = 60 * 60;\nstubbornProgram(LIFE_S);', limit), []);
  assert.deepEqual(boundTrouble('stubbornProgram(3600);', limit), []);
  assert.deepEqual(boundTrouble('stubbornProgram(3601);', limit), ['stubbornProgram(3601) lives 3601 s, not from 1 to the run\'s limit of 3600 s']);
  assert.deepEqual(boundTrouble('const LIFE_S = 24 * 3600;\nstubbornProgram(LIFE_S);', limit), ['stubbornProgram(LIFE_S) lives 86400 s, not from 1 to the run\'s limit of 3600 s']);
  assert.deepEqual(boundTrouble('stubbornProgram(Infinity);', limit), ['stubbornProgram(Infinity): its bound is not a number this check can read']);
  assert.deepEqual(boundTrouble('let LIFE_S = 600;\nstubbornProgram(LIFE_S);', limit), ['stubbornProgram(LIFE_S): its bound is not a number this check can read']);
  assert.deepEqual(boundTrouble('stubbornProgram();', limit), ['stubbornProgram(): its bound is not a number this check can read']);
});

test('every stubborn program a system test builds has a bound of at most the run\'s limit', async () => {
  const limit = await runLimit();
  const dir = path.join(repoRoot, 'test', 'system');
  const files = (await readdir(dir)).filter((name) => name.endsWith('.js')).sort();
  assert.ok(files.length > 0, 'there should be system tests to check');

  const found = [];
  let calls = 0;
  for (const name of files) {
    const source = await readFile(path.join(dir, name), 'utf8');
    calls += stubbornBoundsIn(source).length;
    for (const why of boundTrouble(source, limit)) found.push(`test/system/${name}: ${why}`);
  }
  assert.ok(calls > 0, 'no system test builds its stubborn program with stubbornProgram(, so its life has no bound this check can see');
  assert.deepEqual(found, [], `system tests whose stubborn program can outlive the run:\n  ${found.join('\n  ')}`);
});
