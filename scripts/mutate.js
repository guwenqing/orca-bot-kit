#!/usr/bin/env node

// The mutation check, run on what this branch changed rather than on the whole
// repo: `npm run mutate`. Name targets yourself to check a whole area instead:
// `npm run mutate -- 'src/**/*.js'`.
//
// StrykerJS does the work and is configured in stryker.config.mjs. It is called
// as `stryker` on PATH, where npm puts this repo's own binaries, so go through
// npm rather than running this file directly.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This file lives in <repo>/scripts/, and the check always runs on its own repo,
// whatever directory it was called from.
const repo = path.resolve(fileURLToPath(import.meta.url), '../..');

const BASE = 'main';

// Mutating means mutating this repo's own code: the CLI and these scripts.
const WORTH_MUTATING = /^(src|scripts)\/.*\.js$/;

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
  const targets = argv.length > 0 ? argv : changedFiles();

  if (targets.length === 0) {
    process.stdout.write(
      `Nothing to mutate: this branch changes no JavaScript under src/ or scripts/ against ${BASE}.\n`,
    );
    return 0;
  }

  const result = spawnSync('stryker', ['run', '--mutate', targets.join(',')], {
    cwd: repo,
    stdio: 'inherit',
  });
  if (result.error) {
    throw new Error(
      `could not run stryker (${result.error.code}): run the check as \`npm run mutate\`, which puts this repo's own binaries on PATH.`,
    );
  }
  // A run killed by a signal reports no code of its own; it did not pass.
  return result.status ?? 1;
}

try {
  process.exitCode = run(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`mutate: ${error.message}\n`);
  process.exitCode = 1;
}
