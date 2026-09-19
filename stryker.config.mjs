// StrykerJS: the mutation check for this repo's own code.
//
// Run it with `npm run mutate`, which mutates only what this branch changed
// against main. It is a developer tool: the kit neither ships nor needs it.

import { availableParallelism } from 'node:os';

export default {
  // The suite is plain `node --test`, for which Stryker has no runner plugin.
  // The command runner needs none: a mutant is killed when `npm test` fails.
  testRunner: 'command',
  commandRunner: { command: 'npm test' },
  coverageAnalysis: 'off',

  mutate: ['src/**/*.js', 'scripts/**/*.js'],

  // Stryker copies the project into a sandbox with the execute bit off, and the
  // tests reach the CLI as `obk` on PATH — a symlink to src/cli.js that has to
  // be runnable. Without this, PATH skips it and the tests run whatever obk is
  // installed on the machine instead, so every mutant looks like a survivor.
  buildCommand: 'chmod +x src/cli.js',

  // A mutant that is merely slow must not be read as a mutant that hangs, and a
  // timeout counts as killed, so an overloaded machine would quietly inflate
  // the score. The suite runs its own files in parallel and uses about four
  // cores, so give each worker that much room, and leave the timeout long
  // enough that a run of a couple of seconds has to be truly stuck to hit it.
  concurrency: Math.max(1, Math.floor(availableParallelism() / 4)),
  timeoutMS: 15000,

  reporters: ['clear-text', 'progress'],
  clearTextReporter: { reportTests: false, maxTestsToLog: 0 },
};
