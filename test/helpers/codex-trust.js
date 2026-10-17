// A system test's Codex session starts trusted by launch-time overrides, so
// Codex writes no folder trust and no hooks trust into the user's own
// ~/.codex/config.toml (#240, option (c)), without Codex's sleep tool (#432),
// and with no update offer (#581); and the reader a test checks that file
// with, before and after. See test/codex-trust.test.js.

/** A TOML basic string: the same escapes JSON uses, which TOML reads alike. */
const tomlString = (text) => JSON.stringify(text);

/**
 * The folder's trust as one `-c` value: a whole `projects` table, the folder a
 * TOML basic string. The dotted key form splits on every `.` and does not work.
 * For a `codex` run the kit does not launch, such as `codex exec`, whose own
 * trust write Codex makes only while the folder's trust is unset (worked out
 * from Codex 0.158.0's source for #240, not seen live).
 */
export const projectTrust = (folder) => `projects={${tomlString(folder)}={trust_level="trusted"}}`;

/**
 * The `session add` arguments every Codex session a system test makes is
 * launched with: it starts in the bots folder at `botsRealpath` with no
 * folder-trust question and no hooks review, with nothing of its own written
 * into config.toml at startup, without Codex's sleep tool, and with no update
 * offer:
 *
 *   -c projects={"<folder>"={trust_level="trusted"}}   the folder's trust, as a
 *                                  whole table in one -c; the dotted key form
 *                                  splits on every `.` and does not work
 *   --dangerously-bypass-hook-trust  no hooks review, so no hooks.state entry;
 *                                  the hooks still run
 *   -c tui.show_tooltips=false     no model-availability notice counted in the
 *                                  file at startup
 *   -c features.sleep_tool=false   not a trust setting: a test-only launch
 *                                  argument (#432). A Codex on a GPT-6 model
 *                                  told to wait calls its built-in `sleep` in
 *                                  its turn, for an hour or more, and the tests'
 *                                  waits for an idle tab never end. The kit's
 *                                  own launch line keeps the tool: the notice it
 *                                  types ends such a sleep (seen live, #432)
 *   -c check_for_update_on_startup=false  no update offer at start, which no
 *                                  system test may answer: a test takes no
 *                                  update and dismisses none in the user's
 *                                  own Codex state (#581)
 *
 * Codex looks for trust at the session's folder and then at its git root, the
 * realpath first, so the bots folder's realpath covers every bot in it.
 *
 * `hooks: false` leaves the bypass out, for the one case that wants the hooks
 * untrusted: the folder is still trusted, so the review is shown and the hooks
 * do not run until they are trusted, and "Continue without trusting" writes
 * nothing (read in Codex 0.158.0's source for #240, not seen live).
 *
 * `sleep: true` leaves the sleep tool on, for the one session that checks a
 * real bot with it still gets its mail: codex-sleep.test.js's sleep-codex.
 *
 * The name says trust because trust is what it began as (#240); it is the
 * whole of what a system test's Codex session is launched with.
 */
export const codexTrustArgs = (botsRealpath, { hooks = true, sleep = false } = {}) => [
  '-c', projectTrust(botsRealpath),
  ...(hooks ? ['--dangerously-bypass-hook-trust'] : []),
  '-c', 'tui.show_tooltips=false',
  ...(sleep ? [] : ['-c', 'features.sleep_tool=false']),
  '-c', 'check_for_update_on_startup=false',
].map((arg) => `--extra-arg=${arg}`);

/** A table header this reads: `[projects."…"]` or `[hooks.state."…"]`, the key double- or single-quoted. */
const HEADER = /^[ \t]*\[(projects|hooks\.state)\.("(?:[^"\\]|\\.)*"|'[^']*')\][ \t]*(?:#.*)?$/;

/** A quoted TOML key, read back to what it names. */
function keyOf(quoted) {
  if (quoted.startsWith('\'')) return quoted.slice(1, -1);
  try {
    return JSON.parse(quoted);
  } catch {
    return quoted.slice(1, -1);
  }
}

/**
 * The keys of config.toml's `[projects."…"]` and `[hooks.state."…"]` tables, in
 * the order the file has them, as `{ projects, hooks }`. Only those headers are
 * read: the file may hold secrets, and nothing else in it is returned.
 */
export function trustKeysIn(text) {
  const found = { projects: [], hooks: [] };
  for (const line of String(text).split('\n')) {
    const header = HEADER.exec(line);
    if (header === null) continue;
    found[header[1] === 'projects' ? 'projects' : 'hooks'].push(keyOf(header[2]));
  }
  return found;
}

/** The ways a macOS temp path is written: with `/private` in front and without. */
function spellingsOf(folder) {
  const bare = folder.replace(/^\/private(?=\/)/, '');
  return [...new Set([folder, bare, `/private${bare}`])];
}

/**
 * The keys in `after` and not in `before` that name `folder` or a path under
 * it, in either spelling, as `{ projects, hooks }`. A hooks.state key starts
 * with the hooks file's path.
 */
export function addedUnder(before, after, folder) {
  const under = (key) => spellingsOf(folder).some((one) => key === one || key.startsWith(`${one}/`));
  const added = (kind) => after[kind].filter((key) => !before[kind].includes(key) && under(key));
  return { projects: added('projects'), hooks: added('hooks') };
}
