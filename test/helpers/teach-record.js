// Claude Code's records of the Teach form's choice that a new Orca tab may
// write, and one string that tells their `autoModeEnvSetup` apart without
// holding any of it (#738).
//
// A live test answers the "Teach auto mode about your environment?" form with
// Esc, then checks that `autoModeEnvSetup` is as it was. Claude Code keeps it
// in `.claude.json` under CLAUDE_CONFIG_DIR, or in `~/.claude.json` when that
// is not set. Where Orca has a Claude account, Orca starts a new tab with
// CLAUDE_CONFIG_DIR at the profile home that `claude-profiles/selected-host`
// names (tech notes, section 2). So the check reads both files. It never
// prints a value from either: only key names and a hash.

import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Where `file` really is: its real path, or its real folder's when the file is not there yet. */
function whereItIs(file) {
  try {
    return realpathSync(file);
  } catch {
    try {
      return path.join(realpathSync(path.dirname(file)), path.basename(file));
    } catch {
      return path.resolve(file);
    }
  }
}

/**
 * Claude Code's records of the Teach form's choice that a new Orca tab here
 * may write: `<home>/.claude.json` first, then the `.claude.json` of the
 * profile home that `selected-host` names, when it names an absolute path and
 * that is another file. Reads only.
 */
export function teachRecordFiles({ home = os.homedir(), orcaData = process.env.OBK_ORCA_DATA || path.join(home, 'Library', 'Application Support', 'orca') } = {}) {
  const homeFile = path.join(home, '.claude.json');
  const files = [homeFile];
  let selected;
  try {
    selected = readFileSync(path.join(orcaData, 'claude-profiles', 'selected-host'), 'utf8').replace(/\r?\n$/, '');
  } catch {
    return files;
  }
  if (!path.isAbsolute(selected)) return files;
  const profileFile = path.join(selected, '.claude.json');
  if (whereItIs(profileFile) !== whereItIs(homeFile)) files.push(profileFile);
  return files;
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
