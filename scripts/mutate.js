#!/usr/bin/env node

// The mutation check, run on what this branch changed rather than on the whole
// repo: `npm run mutate`. Name targets yourself to check a whole area instead:
// `npm run mutate -- 'src/**/*.js'`.
//
// StrykerJS does the work and is configured in stryker.config.mjs. It is called
// as `stryker` on PATH, where npm puts this repo's own binaries, so go through
// npm rather than running this file directly.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This file lives in <repo>/scripts/, and the check always runs on its own repo,
// whatever directory it was called from.
const repo = path.resolve(fileURLToPath(import.meta.url), '../..');

const BASE = 'main';

// Mutating means mutating this repo's own code: the CLI and these scripts.
const WORTH_MUTATING = /^(src|scripts)\/.*\.js$/;

// Except the one file a mutation run cannot judge: the runner the check itself
// uses. A mutant in it is tested by a run of the mutated runner, which decides
// its own verdict, so whatever comes out says nothing about the tests. It is
// checked by hand instead.
const THE_RUNNER = 'scripts/mutation-suite.js';

// git's output, a line per entry, with its record terminator dropped. A command
// that fails stops the run: a wrong answer here would silently mutate the wrong
// files, or nothing at all.
function git(args) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  if (result.error) throw new Error(`could not run git: ${result.error.message}`);
  if (result.status !== 0) {
    // git that ran at all reports a string, empty or not; one that could not
    // run was caught above.
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.split('\n').filter((line) => line !== '');
}

/**
 * What this branch changed against `main` and is worth mutating: every file
 * added, copied, modified or renamed since the two parted — committed, sitting
 * in the working tree, or not tracked yet — and nothing that was deleted.
 *
 * The comparison is against where the branch started, not against the tip of
 * `main`, so work someone else landed on `main` meanwhile is not ours to check.
 */
function changedFiles() {
  const [base] = git(['merge-base', BASE, 'HEAD']);
  const changed = [
    ...git(['diff', '--name-only', '--diff-filter=ACMR', '--relative', base]),
    ...git(['ls-files', '--others', '--exclude-standard']),
  ];
  return [...new Set(changed)].filter((file) => WORTH_MUTATING.test(file)).sort();
}

function run(argv) {
  const named = argv.length > 0;
  const wanted = named ? argv : changedFiles();
  const targets = wanted.filter((file) => file !== THE_RUNNER);

  if (targets.length < wanted.length) {
    process.stdout.write(
      `Leaving out ${THE_RUNNER}: it is the runner this check uses, so a run of it would be judging itself. Check that file by hand.\n`,
    );
  }

  if (targets.length === 0) {
    process.stdout.write(named
      ? 'Nothing to mutate: nothing named is left to mutate.\n'
      : `Nothing to mutate: this branch changes no JavaScript under src/ or scripts/ against ${BASE}.\n`);
    return 0;
  }

  // The suite runs once per mutant, each run a process of its own, and the file
  // here is how one tells the next what it learned about the suite. It belongs
  // to this run alone, and the runs happen in a sandbox copy of the repo, so it
  // lives outside both, under an absolute path.
  const notes = mkdtempSync(path.join(os.tmpdir(), 'obk-mutate-'));
  try {
    // The exclusion travels with the targets rather than sitting only in
    // stryker.config.mjs: a `--mutate` on the command line replaces the config's
    // own list, and a target can be a glob, which the filter above cannot catch.
    const mutate = [...targets, `!${THE_RUNNER}`].join(',');

    const result = spawnSync('stryker', ['run', '--mutate', mutate], {
      cwd: repo,
      stdio: 'inherit',
      env: { ...process.env, OBK_MUTATION_CACHE: path.join(notes, 'suite.json') },
    });
    if (result.error) {
      throw new Error(
        `could not run stryker (${result.error.code}): run the check as \`npm run mutate\`, which puts this repo's own binaries on PATH.`,
      );
    }
    // A run killed by a signal reports no code of its own; it did not pass.
    return result.status ?? 1;
  } finally {
    rmSync(notes, { recursive: true, force: true });
  }
}

try {
  process.exitCode = run(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`mutate: ${error.message}\n`);
  process.exitCode = 1;
}
