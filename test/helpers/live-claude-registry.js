// Claude Code's registry of running sessions, as a live system test reads it
// on this machine (#866). It only reads.
//
// Claude Code keeps one `<pid>.json` file for each running session in
// `<config dir>/sessions` (tech notes, section 2), and a `<pid>.<hex>.key`
// file beside it. The config dir is `$CLAUDE_CONFIG_DIR` when that is set and
// not empty, else `~/.claude`. Orca can start a tab's Claude Code with
// CLAUDE_CONFIG_DIR set to a profile folder of its own, and the runner
// inherits it; then `~/.claude/sessions` stays empty (seen live in the run of
// PR #865). So both places are read, and a folder both name is read once.
//
// helpers/claude-registry.js is the other side: it writes registry entries
// inside a sandbox, for the tests that use the fake Orca.

import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The real path of `dir` when it is there, else its resolved path. */
function sameAs(dir) {
  try {
    return realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
}

/**
 * The registry folders to read: `<home>/.claude/sessions`, and
 * `<configDir>/sessions` when `configDir` is a string that is not empty. A
 * folder both name is given once.
 */
export function claudeRegistries({ home = os.homedir(), configDir = process.env.CLAUDE_CONFIG_DIR } = {}) {
  const dirs = [path.join(home, '.claude')];
  if (typeof configDir === 'string' && configDir !== '') dirs.push(configDir);
  return [...new Set(dirs.map((dir) => sameAs(path.join(dir, 'sessions'))))];
}

/**
 * Every entry in the registries, read as it is, with the folder it is in as
 * `at`. One being written or removed as it is read is left out, and so is a
 * file that is not `<pid>.json`, such as `<pid>.<hex>.key`.
 */
export function claudeRegistryEntries(options = {}) {
  const entries = [];
  for (const dir of claudeRegistries(options)) {
    let names;
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names.filter((one) => one.endsWith('.json'))) {
      try {
        const entry = JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
        if (entry !== null && typeof entry === 'object') entries.push({ ...entry, at: dir });
      } catch {
        // The next look reads it again.
      }
    }
  }
  return entries;
}
