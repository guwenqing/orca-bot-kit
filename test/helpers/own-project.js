// How a system test removes one of its throwaway Orca projects (#536).
//
// Orca's next release refuses a plain `project setup-delete` of a project with
// saved workspace details, which a test's project keeps after its tabs close
// (stablyai/orca#27172). `deleteProject` sends `--force`, and on 1.4.223, which
// does not know the flag, the plain delete (#528). `--force` removes a project
// whatever it holds, so it goes only to a project that is the run's own: one
// inside the test's own throwaway bots folder.

import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { deleteProject } from '../../src/orca.js';

/**
 * Remove the Orca project `setup` (an entry of `orca project setups`), when it
 * lies inside `bots`, the test's own `<tmp>/obk-system-…` folder. Anything else
 * fails, before anything is sent to Orca. So does a delete Orca refuses.
 */
export function deleteOwnProject(setup, bots) {
  const tmp = realpathSync(os.tmpdir());
  assert.ok(
    path.dirname(bots) === tmp && path.basename(bots).startsWith('obk-system-'),
    `${bots} is not a system test's throwaway bots folder in ${tmp}, so its projects were not removed`,
  );
  const inside = path.relative(bots, setup.path);
  assert.ok(
    path.isAbsolute(setup.path) && inside !== '' && inside !== '..' && !inside.startsWith(`..${path.sep}`) && !path.isAbsolute(inside),
    `the project at ${setup.path} is not inside ${bots}, so it is not this run's to remove`,
  );
  return deleteProject(setup.id);
}
