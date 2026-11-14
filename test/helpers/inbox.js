// The letters in a mailbox as Orca keeps them, for the live tests (#748).
//
// From Orca 1.4.246 `orca orchestration inbox` answers short unless it is given
// `--full`: each letter as `{ id, type, from, to, subject, handled, body }`,
// with no `read`, `delivered_at`, `run_id`, `to_handle` or `sequence` (tech
// notes, #729 and #730). A test that reads those from the short answer reads
// each letter as unread, or finds no letter of its Run. So this asks with
// `--full`, as the kit's own read does (src/orca.js), and asks once more
// without it only when Orca refuses the flag as unknown, as 1.4.245 and older
// do for the commands that do not know it.
//
// A list with no `--terminal` holds the mail of everyone on the machine. So no
// failure here prints Orca's output, its error message or a letter: only the
// command, the exit status, the error code and how long the output was.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

/** Orca's words when its CLI does not know `--full` on a command: nothing was done. */
const FULL_UNKNOWN = 'Unknown flag --full for command: ';

/**
 * The newest `limit` letters of the mailbox `terminal` (`run:<id>`), or of the
 * whole machine when `terminal` is undefined, newest first, each with every
 * column Orca gives.
 */
export function inboxLetters(cli, { terminal, limit, env = process.env } = {}) {
  const args = ['orchestration', 'inbox', ...(terminal === undefined ? [] : ['--terminal', terminal]), '--limit', String(limit)];
  let answer = ask(cli, [...args, '--full'], env);
  if (answer.ok !== true && answer.error?.code === 'invalid_argument' && String(answer.error?.message ?? '').startsWith(FULL_UNKNOWN)) {
    answer = ask(cli, args, env);
  }
  const asked = `orca ${args.join(' ')} --json`;
  assert.equal(answer.ok, true, `${asked} was refused: error code ${JSON.stringify(answer.error?.code ?? null)} (Orca's message is not shown, as it may quote other people's mail)`);
  const messages = answer.result?.messages;
  assert.ok(Array.isArray(messages), `${asked} should answer a list under result.messages, and answered ${messages === undefined ? 'none' : typeof messages}`);
  return messages;
}

/**
 * One inbox call, as Orca's JSON answer. Fails, printing none of the output,
 * when there is no JSON. The answer is taken whatever its size, as the kit's
 * `whole` read takes it (src/orca.js): with `--full` each body comes whole, so
 * a list of the whole machine can pass spawnSync's 1 MB default (review of
 * PR #749).
 */
function ask(cli, args, env) {
  const asked = `orca ${args.join(' ')} --json`;
  const done = spawnSync(cli, [...args, '--json'], { encoding: 'utf8', env, maxBuffer: Infinity });
  if (done.error !== undefined) assert.fail(`could not run ${asked}: ${done.error.code}`);
  try {
    return JSON.parse(done.stdout);
  } catch {
    return assert.fail(`${asked} exited ${done.status} and did not answer JSON (${done.stdout.length} characters on stdout, ${done.stderr.length} on stderr; not shown, as they may hold other people's mail)`);
  }
}
