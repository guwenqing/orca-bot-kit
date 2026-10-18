// One more throwaway Orca project for a system test whose tabs Orca lists as
// orphaned (#561, #634).
//
// Seen live on 2026-10-18 (#561): `orca terminal switch` to an orphaned tab
// answered ok, and the tab stayed orphaned. One more project, made as `obk up`
// makes a bot's project, with one plain tab opened in it, made the tabs of the
// older projects real. A tab added to the same project did not. The cause is
// not known. The plain tab itself was orphaned again within 30 s.
//
// This opens a project and a tab in the owner's Orca window. Only a test that
// may do that calls it; the test keeps its own gate.

import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

import { makeProject, tellWindow } from '../../src/orca.js';

/**
 * One more throwaway project at `home`, made as `obk up` makes a bot's project
 * (makeProject, then tellWindow), with one plain tab opened through `guard`
 * (terminal create, no --focus). Seen 2026-10-18 (#561): the tabs of the older
 * projects then list a real tabId. The caller puts `home` in its teardown's
 * homes, so the guard closes the tab and the teardown deletes the project.
 * Answers { setup, projectId, told, handle }.
 */
export async function openNewerProject(guard, home, title) {
  await mkdir(home, { recursive: true });
  const setup = makeProject(home, title);
  const told = tellWindow(setup.projectId);
  const opened = guard.orca(['terminal', 'create', '--worktree', `path:${home}`]);
  assert.equal(opened.ok, true, `orca terminal create --worktree path:${home} failed: ${JSON.stringify(opened.error)}`);
  const handle = opened.result?.terminal?.handle;
  assert.equal(typeof handle, 'string', `orca terminal create --worktree path:${home} answered no handle: ${JSON.stringify(opened.result)}`);
  return { setup, projectId: setup.projectId, told, handle };
}
