// StrykerJS: the mutation check for this repo's own code.
//
// Run it with `npm run mutate`, which mutates only what this branch changed
// against main. It is a developer tool: the kit neither ships nor needs it.

import { availableParallelism } from 'node:os';

export default {
  // The suite is plain `node --test`, for which Stryker has no runner plugin.
  // The command runner needs none: a mutant is killed when the command fails.
  // The command is not `npm test`, which runs every test file for every mutant
  // and takes the better part of a minute each time; scripts/mutation-suite.js
  // runs the same files, one at a time, and stops at the first one that fails.
  testRunner: 'command',
  commandRunner: { command: 'node scripts/mutation-suite.js' },
  coverageAnalysis: 'off',

  // Everything but the runner this check uses: a mutant in that file is judged
  // by the mutated file itself, so whatever comes out says nothing. It is
  // checked by hand instead.
  mutate: ['src/**/*.js', 'scripts/**/*.js', '!scripts/mutation-suite.js'],

  // Stryker copies the project into a sandbox with the execute bit off, and the
  // tests reach the CLI as `obk` on PATH — a symlink to src/cli.js that has to
  // be runnable. Without this, PATH skips it and the tests run whatever obk is
  // installed on the machine instead, so every mutant looks like a survivor.
  buildCommand: 'chmod +x src/cli.js',

  // A mutant run is one test file at a time now, and that file spends most of
  // its life waiting on the processes it starts rather than on a core, so a
  // worker per core keeps the machine busy without swamping it.
  concurrency: availableParallelism(),

  // A mutant that survives is only known to have survived once every test file
  // has run, which is minutes when the machine is busy with other mutants, so
  // this has to stay well clear of that. What is left is the real hangs: a
  // mutant that stops the code from finishing ends up here, and Stryker reports
  // it in a column of its own. A timeout is not a kill anyone made — it is a
  // run that never answered, and it is there to be looked at.
  timeoutMS: 300_000,

  reporters: ['clear-text', 'progress'],
  clearTextReporter: { reportTests: false, maxTestsToLog: 0 },
};
