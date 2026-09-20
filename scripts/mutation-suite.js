#!/usr/bin/env node

// The suite as a mutation run needs it. StrykerJS runs this once for every
// mutant, so it stops the moment the mutant is known to be dead.
//
// `npm test` runs every test file and reports them all. That is right for a
// person and wasteful here: a mutation run only ever asks "did anything fail?",
// and it asks it hundreds of times. With a mutant live this runs the files one
// at a time and stops at the first failure, trying the file that killed the
// last mutant first and then the quickest, so a dead mutant usually costs one
// test file rather than the whole suite. With no mutant live — the dry run, or
// a person running it by hand — it runs them all, several at a time, and
// records how long each took, which is where that order comes from.
//
// It is called by stryker.config.mjs. Run the check itself as `npm run mutate`.

import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This file lives in <repo>/scripts/, and it runs that repo's tests whatever
// directory it was called from: StrykerJS calls it inside a copy of the repo.
const repo = path.resolve(fileURLToPath(import.meta.url), '../..');

/** One mutant is live: the only question is whether some test fails. */
const mutantLive = process.env.__STRYKER_ACTIVE_MUTANT__ !== undefined;

/** Where a run leaves what it learned for the next one. Optional, and shared. */
const cacheFile = process.env.OBK_MUTATION_CACHE;

/** A test file still going after this has hung: a mutant the tests caught. */
const timeoutMs = Number(process.env.OBK_MUTATION_TIMEOUT_MS) || 60_000;

/** The files `npm test` runs: the unit and end-to-end tests, not the system ones. */
function testFiles() {
  return readdirSync(path.join(repo, 'test'))
    .filter((name) => name.endsWith('.test.js'))
    .sort()
    .map((name) => `test/${name}`);
}

/**
 * What the last run left. Runs share this file and write it while others read
 * it, so anything wrong with it means only that this run knows nothing.
 */
function readCache() {
  try {
    const cache = JSON.parse(readFileSync(cacheFile, 'utf8'));
    return cache !== null && typeof cache === 'object' ? cache : {};
  } catch {
    return {};
  }
}

/** Leave what this run learned, in one piece: a reader never sees half a file. */
function writeCache(cache) {
  if (cacheFile === undefined) return;
  const half = `${cacheFile}.${process.pid}`;
  try {
    writeFileSync(half, JSON.stringify(cache));
    renameSync(half, cacheFile);
  } catch {
    // Notes for the next run are a convenience; a run that could not leave any
    // has still run the tests.
    try { unlinkSync(half); } catch { /* there was nothing to clean up */ }
  }
}

/** The order to try the files in: what the last run recommends, then the quickest. */
function ordered(files, cache) {
  const recommended = (Array.isArray(cache.order) ? cache.order : []).filter((file) => files.includes(file));
  const took = cache.ms !== null && typeof cache.ms === 'object' ? cache.ms : {};
  // A file nobody has timed sorts last, and keeps its place among the others.
  const msOf = (file) => (typeof took[file] === 'number' ? took[file] : Number.MAX_VALUE);
  const rest = files
    .filter((file) => !recommended.includes(file))
    .sort((left, right) => msOf(left) - msOf(right));
  return [...recommended, ...rest];
}

/**
 * Run one test file. Resolves with how it went and never rejects: a file that
 * could not be started at all is a failing file like any other.
 *
 * The child leads a process group of its own, so cutting off a hung test takes
 * the test runner and the CLI processes it spawned with it.
 */
function runFile(file) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, ['--test', file], {
      cwd: repo,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });

    const killGroup = () => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* the group has ended */ }
    };

    let hung = false;
    let insist;
    const cutOff = setTimeout(() => {
      hung = true;
      killGroup();
      // One signal is not always enough. `node --test` runs the file in a
      // worker it forks, and a worker forked at the very moment the group is
      // signalled joins the group without being signalled; it then holds the
      // pipes open, and the run would wait out the hang it just cut off. So
      // keep asking until the child is really gone.
      insist = setInterval(killGroup, 200);
    }, timeoutMs);

    const done = (ok) => {
      clearTimeout(cutOff);
      clearInterval(insist);
      resolve({ file, ok, ms: Date.now() - started, output, hung });
    };
    child.on('error', (error) => { output += `${error.message}\n`; done(false); });
    child.on('close', (code) => done(code === 0 && !hung));
  });
}

/** Run the files with `limit` of them going at once. */
async function runAll(files, limit) {
  const queue = [...files];
  const results = [];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) results.push(await runFile(queue.shift()));
  }));
  return results;
}

/** What someone reading a failed run needs: which file it was, and what it said. */
function report(result) {
  const why = result.hung ? `ran longer than ${timeoutMs}ms` : 'failed';
  process.stdout.write(`mutation-suite: ${result.file} ${why}\n${result.output}`);
}

const files = testFiles();

if (mutantLive) {
  const cache = readCache();
  const order = ordered(files, cache);

  let killer;
  for (const file of order) {
    const result = await runFile(file);
    if (!result.ok) {
      report(result);
      killer = file;
      break;
    }
  }

  if (killer !== undefined) {
    // Mutants come in runs from the same file, so whatever killed this one is
    // the best guess for the next one.
    writeCache({ ...cache, order: [killer, ...order.filter((file) => file !== killer)] });
  }
  process.exitCode = killer === undefined ? 0 : 1;
} else {
  // Two at a time even on a small machine: nothing here is waiting on the CPU
  // alone, and the run after this one wants every file timed.
  const results = await runAll(files, Math.max(2, Math.floor(availableParallelism() / 2)));
  const ms = Object.fromEntries(results.map((result) => [result.file, result.ms]));
  writeCache({ ms, order: [...files].sort((left, right) => ms[left] - ms[right]) });

  const failures = results.filter((result) => !result.ok);
  for (const failure of failures) report(failure);
  process.exitCode = failures.length > 0 ? 1 : 0;
}
