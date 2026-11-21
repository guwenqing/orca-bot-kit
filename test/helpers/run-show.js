// A Run as Orca keeps it, for the live tests (#847).
//
// From Orca 1.4.246 `orca orchestration run-show` answers short unless it is
// given `--full`: `{ runId, objective, … }`, with no `run` and no
// `coordinator_handle` (tech notes, #729 and #730). A test that reads the Run's
// tab from the short answer reads nothing. So this asks with `--full`, as the
// kit's own read does (src/orca.js), and asks once more without it only when
// Orca refuses the flag as unknown, as 1.4.245 and older do; those answer the
// whole record without it.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

/** Orca's words when its CLI does not know `--full` on a command: nothing was done. */
const FULL_UNKNOWN = 'Unknown flag --full for command: ';

/**
 * The Run `id` as Orca's full `orchestration run-show` answer gives it:
 * `{ id, objective, coordinator_handle, … }`. Fails when Orca refuses, or
 * answers no Run.
 */
export function runRecord(cli, id, { env = process.env } = {}) {
  const args = ['orchestration', 'run-show', '--id', id];
  let answer = ask(cli, [...args, '--full'], env);
  if (answer.ok !== true && answer.error?.code === 'invalid_argument' && String(answer.error?.message ?? '').startsWith(FULL_UNKNOWN)) {
    answer = ask(cli, args, env);
  }
  const asked = `orca ${args.join(' ')} --json`;
  assert.equal(answer.ok, true, `${asked} was refused: error code ${JSON.stringify(answer.error?.code ?? null)}: ${JSON.stringify(answer.error ?? null)}`);
  const run = answer.result?.run;
  assert.ok(run !== null && typeof run === 'object', `${asked} should answer the Run under result.run, and answered ${JSON.stringify(answer.result ?? null)}`);
  return run;
}

/** One run-show call, as Orca's JSON answer. Fails when there is no JSON. */
function ask(cli, args, env) {
  const asked = `orca ${args.join(' ')} --json`;
  const done = spawnSync(cli, [...args, '--json'], { encoding: 'utf8', env });
  if (done.error !== undefined) assert.fail(`could not run ${asked}: ${done.error.code}`);
  try {
    return JSON.parse(done.stdout);
  } catch {
    return assert.fail(`${asked} exited ${done.status} and did not answer JSON: ${JSON.stringify(done.stdout.slice(0, 500))} ${JSON.stringify(done.stderr.slice(0, 500))}`);
  }
}
