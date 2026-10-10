// How a system test removes one of its throwaway Orca projects (#536).
//
// Orca's next release refuses a plain `project setup-delete` of a project with
// saved workspace details, which a test's project keeps after its tabs close
// (stablyai/orca#27172). `deleteProject` sends `--force`, and on 1.4.223, which
// does not know the flag, the plain delete (#528). `--force` removes a project
// whatever it holds, so it goes only to a project that is the run's own: one
// inside the test's own throwaway bots folder: `<tmp>/obk-system-…`, or
// `<repo>/local-data/obk-system-…` for a test whose Codex sessions must not
// find their bots folder writable through the sandbox's temp folder (#534).

import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { deleteProject } from '../../src/orca.js';

/** The checkout's own `local-data/`, which .gitignore keeps out of git. */
const localData = () => path.join(realpathSync(fileURLToPath(new URL('../..', import.meta.url))), 'local-data');

/**
 * Remove the Orca project `setup` (an entry of `orca project setups`), when it
 * lies inside `bots`, the test's own `<tmp>/obk-system-…` or
 * `<repo>/local-data/obk-system-…` folder. Anything else fails, before
 * anything is sent to Orca. So does a delete Orca refuses.
 */
export function deleteOwnProject(setup, bots) {
  const places = [realpathSync(os.tmpdir()), localData()];
  assert.ok(
    places.includes(path.dirname(bots)) && path.basename(bots).startsWith('obk-system-'),
    `${bots} is not a system test's throwaway bots folder in ${places.join(' or ')}, so its projects were not removed`,
  );
  const inside = path.relative(bots, setup.path);
  assert.ok(
    path.isAbsolute(setup.path) && inside !== '' && inside !== '..' && !inside.startsWith(`..${path.sep}`) && !path.isAbsolute(inside),
    `the project at ${setup.path} is not inside ${bots}, so it is not this run's to remove`,
  );
  return deleteProject(setup.id);
}
