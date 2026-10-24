// The gate for a system test step that makes a throwaway tab turn real in the
// owner's Orca window. Since #676, each bring-up of a bot (`obk init`, `obk up`
// and the others) makes the Orca window load the bot's project, so its tabs
// turn real. A test that checks those tabs gates every step from its first
// bring-up on.
//
// The owner's rule (2026-10-17): a test that makes a throwaway tab turn real
// in the owner's Orca window runs that part only in a run that names its file,
// between midnight and 6 am local time. The test asks both, and runs the step
// only when both hold.
//
// Since #689, test/helpers/system.js asks `gateClosed` for every system test
// on it, when the test starts.

import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repo this file is in: test/helpers/ is two folders down from it. */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Whether the runner named `file` (OBK_SYSTEM_NAMED: one absolute path per line), by real path. */
export function namedThisRun(file) {
  const real = (one) => {
    try {
      return realpathSync(one);
    } catch {
      return one;
    }
  };
  return (process.env.OBK_SYSTEM_NAMED ?? '').split('\n').filter((line) => line !== '').some((line) => real(line) === real(file));
}

/** Whether the local hour is 0 to 5. */
export const atNight = (at = new Date()) => at.getHours() < 6;

/**
 * Why the gate is closed for `file` at `at`, or undefined when it is open: the
 * run names the file, and the local hour is 0 to 5.
 */
export function gateClosed(file, at = new Date()) {
  const named = namedThisRun(file ?? '');
  if (named && atNight(at)) return undefined;
  return [
    `this run is at ${at.toTimeString().slice(0, 5)} local time and ${named ? 'names this file' : 'does not name this file'}, so it opened nothing in Orca and checked nothing live.`,
    'A live test that can make a throwaway tab real in the Orca window runs only in a run that names its file, between midnight and 6 am local time:',
    `  npm run test:system -- --yes ${path.relative(REPO, file ?? '')}`,
  ].join(' ');
}
