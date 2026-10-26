// How a system test removes one of its throwaway Orca projects (#536).
//
// Orca's next release refuses a plain `project setup-delete` of a project with
// saved workspace details, which a test's project keeps after its tabs close
// (stablyai/orca#27172). `deleteProject` sends `--force`, and on 1.4.223, which
// does not know the flag, the plain delete (#528). `--force` removes a project
// whatever it holds, so it goes only to a project that is the run's own: at or
// inside the test's own throwaway bots folder: `<tmp>/obk-system-…`, or
// `<repo>/local-data/obk-system-…` for a test whose Codex sessions must not
// find their bots folder writable through the sandbox's temp folder (#534).
//
// A teardown removes every project the run made, not only those at its bot
// homes (#712): Orca 1.4.240 registers a git repo's top folder, so a kit that
// asks for a bot home there can leave a project at the bots folder itself.
// `projectsInBots` picks every project at the bots folder or inside it, and
// `placesOf` gives the tab guard those places beside the homes, so a tab the
// test did not create is found there too before anything is removed.

import assert from 'node:assert/strict';
import { lstatSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { deleteProject } from '../../src/orca.js';

/** The checkout's own `local-data/`, which .gitignore keeps out of git. */
const localData = () => path.join(fileURLToPath(new URL('../..', import.meta.url)), 'local-data');

/**
 * The real path of `target`: of the nearest part of it that is on disk, with
 * the rest as written. A part that is not there cannot be a link, so a path
 * gone from disk is read as safely as one that is there. A part that is there
 * but cannot be resolved is a dangling link, which realpath answers ENOENT for
 * as for a missing part: that is refused, never taken as missing (the review
 * of PR #552).
 */
function realOf(target) {
  const rest = [];
  for (let at = path.resolve(target); ; at = path.dirname(at)) {
    try {
      return path.join(realpathSync(at), ...rest);
    } catch (error) {
      if (error.code !== 'ENOENT' || path.dirname(at) === at) throw error;
      let there = true;
      try {
        lstatSync(at);
      } catch {
        there = false;
      }
      assert.ok(!there, `${at} is a link to something that is not there, so ${target} cannot be read by its real path and is not this run's to remove`);
      rest.unshift(path.basename(at));
    }
  }
}

/** Whether the path `inner` is `outer` or lies inside it, as written. */
function within(inner, outer) {
  const inside = path.relative(outer, inner);
  return inside !== '..' && !inside.startsWith(`..${path.sep}`) && !path.isAbsolute(inside);
}

/**
 * Whether `target` is `bots` or lies inside it: by its real path, or as it is
 * written. A path written inside `bots` that leads out of it through a link,
 * or that cannot be read by its real path at all, is still picked, so that the
 * delete, which refuses it, says so rather than the project being passed over
 * in silence. A relative path is never picked.
 */
function atOrInside(target, bots) {
  if (typeof target !== 'string' || !path.isAbsolute(target)) return false;
  const real = (one) => {
    try {
      return realOf(one);
    } catch {
      return path.resolve(one);
    }
  };
  return within(path.resolve(target), path.resolve(bots)) || within(real(target), real(bots));
}

/**
 * The projects among `setups` (entries of `orca project setups`) that lie in
 * the run's own bots folder `bots`: at the folder itself or anywhere inside
 * it (atOrInside). Which of them a teardown removes is still its own
 * call: not one that was there before the run, nor one at a place where a tab
 * the test did not create is open.
 */
export const projectsInBots = (setups, bots) => setups.filter((setup) => atOrInside(setup.path, bots));

/**
 * The places a teardown hands the tab guard: its bot `homes`, and the path of
 * every project in `setups` that lies in `bots` (projectsInBots), each once.
 */
export const placesOf = (homes, setups, bots) => [...new Set([...homes, ...projectsInBots(setups, bots).map((setup) => setup.path)])];

/**
 * Remove the Orca project `setup` (an entry of `orca project setups`), when it
 * is `bots` or lies inside it, the test's own `<tmp>/obk-system-…` or
 * `<repo>/local-data/obk-system-…` folder: the bots folder itself is the
 * run's own too (#712). Both are read by their real paths:
 * a link that is the bots folder, or one inside it, leads to a folder that is
 * not the run's own. A project path gone from disk is read by its nearest part
 * that is there. Anything else fails, before anything is sent to Orca. So
 * does a delete Orca refuses.
 */
export function deleteOwnProject(setup, bots) {
  const places = [realOf(os.tmpdir()), realOf(localData())];
  // By its real path, not its name: a link called obk-system-… leads to a
  // folder that is not the run's own (the review of PR #552).
  let real;
  try {
    real = realpathSync(bots);
  } catch (error) {
    assert.fail(`${bots} cannot be resolved (${error.code}), so its projects were not removed`);
  }
  assert.equal(real, bots, `${bots} is not its own real path (it leads to ${real}), so it is not a system test's throwaway bots folder and its projects were not removed`);
  assert.ok(
    places.includes(path.dirname(bots)) && path.basename(bots).startsWith('obk-system-'),
    `${bots} is not a system test's throwaway bots folder in ${places.join(' or ')}, so its projects were not removed`,
  );
  // By the project's real path too: a link inside the bots folder leads out of
  // it (the review of PR #552).
  assert.ok(path.isAbsolute(setup.path), `the project at ${setup.path} is not an absolute path, so it is not this run's to remove`);
  const project = realOf(setup.path);
  const inside = path.relative(real, project);
  assert.ok(
    inside !== '..' && !inside.startsWith(`..${path.sep}`) && !path.isAbsolute(inside),
    `the project at ${setup.path} (really ${project}) is not ${bots} or inside it, so it is not this run's to remove`,
  );
  return deleteProject(setup.id);
}
