// The gate for a system test step that makes a throwaway tab turn real in the
// owner's Orca window (#561, #634): one more project with a plain tab in it
// (helpers/newer-project.js).
//
// The owner's rule (2026-10-17): a test that makes a throwaway tab turn real
// in the owner's Orca window runs that part only in a run that names its file,
// between midnight and 6 am local time. The test asks both, and runs the step
// only when both hold.

import { realpathSync } from 'node:fs';

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
