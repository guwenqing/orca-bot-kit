// Claude Code's records that a test's own session may write, and one string
// that tells their `autoModeEnvSetup` apart without holding any of it (#738).
//
// A live test answers the "Teach auto mode about your environment?" form with
// Esc, then checks that `autoModeEnvSetup` is as it was. Claude Code keeps it
// in `<CLAUDE_CONFIG_DIR>/.claude.json`, or in `~/.claude.json` when that is
// not set. Which config folder a tab's session gets depends on Orca: its
// `claude` wrapper may route it to an account's profile, restore the user's
// own CLAUDE_CONFIG_DIR, or leave a pane's own value in place (Orca 1.4.255,
// out/shared/claude-shell-function.js). So the test does not guess. It asks
// Claude Code's registry of live sessions, `<config dir>/sessions/<pid>.json`,
// which names each session's `cwd`. A test's session runs in a throwaway bot
// folder of its own, so the folder whose registry lists that cwd is the
// session's config folder. Nothing here prints a value from any file.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Where `file` really is: its real path, or its resolved path when it is not there. */
function realOrResolved(file) {
  try {
    return realpathSync(file);
  } catch {
    return path.resolve(file);
  }
}

/** True when `dir` is a folder, through a link too. */
function isFolder(dir) {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/** True when a live-session entry in `dir/sessions/` has a cwd whose real path is `target`. */
function listsCwd(dir, target) {
  let names;
  try {
    names = readdirSync(path.join(dir, 'sessions')).filter((name) => name.endsWith('.json'));
  } catch {
    return false;
  }
  return names.some((name) => {
    try {
      const entry = JSON.parse(readFileSync(path.join(dir, 'sessions', name), 'utf8'));
      return typeof entry?.cwd === 'string' && realOrResolved(entry.cwd) === target;
    } catch {
      return false;
    }
  });
}

/**
 * Claude Code's records that the live session working in the folder `cwd`
 * may write, found through its registry of live sessions: `{ files }`, or
 * `{ why }` when no config folder looked at lists that cwd. The folders, in
 * order: `<home>/.claude`, each `<orcaData>/claude-profiles/<name>/home`, and
 * the absolute folders `env.CLAUDE_CONFIG_DIR` and
 * `env.ORCA_CLAUDE_USER_CONFIG_DIR` name, each real folder once. Reads only.
 */
export function sessionRecordFiles(cwd, { home = os.homedir(), orcaData = process.env.OBK_ORCA_DATA || path.join(home, 'Library', 'Application Support', 'orca'), env = process.env } = {}) {
  const homeDir = path.join(home, '.claude');
  // The registry cannot tell whether the session ran with no CLAUDE_CONFIG_DIR or with one that names ~/.claude.
  const candidates = [{ dir: homeDir, records: [path.join(home, '.claude.json'), path.join(homeDir, '.claude.json')] }];
  let profiles = [];
  try {
    profiles = readdirSync(path.join(orcaData, 'claude-profiles')).sort();
  } catch {
    // No Orca profiles here.
  }
  for (const name of profiles) {
    const dir = path.join(orcaData, 'claude-profiles', name, 'home');
    if (isFolder(dir)) candidates.push({ dir, records: [path.join(dir, '.claude.json')] });
  }
  for (const name of ['CLAUDE_CONFIG_DIR', 'ORCA_CLAUDE_USER_CONFIG_DIR']) {
    const dir = env[name];
    if (typeof dir === 'string' && path.isAbsolute(dir)) candidates.push({ dir, records: [path.join(dir, '.claude.json')] });
  }

  const seen = new Set();
  const looked = [];
  const files = [];
  const target = realOrResolved(cwd);
  for (const { dir, records } of candidates) {
    const real = realOrResolved(dir);
    if (seen.has(real)) continue;
    seen.add(real);
    looked.push(dir);
    if (listsCwd(dir, target)) files.push(...records);
  }
  if (files.length > 0) return { files };
  return { why: `no Claude Code registry of live sessions lists a session in ${cwd}; the config folders looked at: ${looked.join(', ')}` };
}

/** The state of `autoModeEnvSetup` in one file, with no value of the file in it. */
function stateOf(file) {
  let held;
  try {
    held = JSON.parse(readFileSync(file, 'utf8'))?.autoModeEnvSetup;
  } catch (error) {
    // The code or the error's name only: a JSON error's message can quote the file.
    return `unreadable (${error.code ?? error.name})`;
  }
  if (held === undefined) return 'absent';
  const hash = createHash('sha256').update(JSON.stringify(held)).digest('hex').slice(0, 12);
  const keys = held !== null && typeof held === 'object' && !Array.isArray(held) ? `keys ${Object.keys(held).join(',') || '(none)'}, ` : '';
  return `${keys}sha256 ${hash}`;
}

/**
 * One string that tells `autoModeEnvSetup` in each of `files` apart, for a
 * compare before and after an Esc: each file's path, then `absent`,
 * `unreadable (<code>)`, or the value's key names and a hash of it.
 */
export function autoModeState(files) {
  return files.map((file) => `${file}: ${stateOf(file)}`).join('; ');
}
