// Every call the kit makes to Orca goes through here (ADR 0034). Orca's CLI
// changes often, so the kit reads `--json` and never the human text, and keeps
// the parsing in one place.
//
// A word on words: Orca calls every workspace a "worktree", a plain folder
// included. Nothing the user reads may say that, or they will think a git
// worktree was made. Say "Orca project". The word belongs only in the selector
// handed to Orca on the command line.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { SHELL_ENV } from './launch.js';
import { TAB_ENV } from './record.js';

// The Orca that works for a normal user: `/usr/local/bin/orca` is a root-only
// symlink on this machine (tech notes, section 1). OBK_ORCA overrides it, for a
// machine that keeps Orca somewhere else.
const BUILT_IN = '/Applications/Orca.app/Contents/Resources/bin/orca';

/** The Orca CLI this run talks to. */
export const orcaCli = () => process.env.OBK_ORCA || BUILT_IN;

/**
 * Run one Orca command and give back its `result`.
 * Every call asks for `--json`; anything else would be text to guess at.
 * With `timeoutMs`, Orca is given that long to answer, and the call is ended
 * and refused if it has not.
 */
export function orca(args, { timeoutMs } = {}) {
  const answer = ask(args, timeoutMs);
  if (answer.ok !== true) {
    // Orca's own words: it knows what went wrong, and the caller is an LLM
    // that can act on them.
    throw refusal(args, answer);
  }
  return answer.result;
}

/** What an error carries when Orca was given a time and did not answer in it. */
export const TIMED_OUT = 'orca_timed_out';

/**
 * Orca's refusal as an error, with its code on it, so a caller can tell a stale
 * handle from the rest (#294), and its own message as `reason`, so a caller
 * that goes by the message reads Orca's words rather than the kit's (#405).
 */
const refusal = (args, answer) => Object.assign(
  new Error(`Orca refused ${args.join(' ')}: ${answer.error?.message ?? 'no reason given'}`),
  { code: answer.error?.code, reason: answer.error?.message },
);

/** One Orca command, and the whole envelope back, refusals included. */
function ask(args, timeoutMs) {
  const asked = spawnSync(orcaCli(), [...args, '--json'], { encoding: 'utf8', ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }) });
  if (asked.error?.code === 'ETIMEDOUT') {
    throw Object.assign(new Error(`Orca did not answer ${args.join(' ')} within ${timeoutMs / 1000} seconds.`), { code: TIMED_OUT });
  }
  if (asked.error) {
    throw new Error(`could not run Orca at ${orcaCli()}: ${asked.error.message}`);
  }

  const answer = parse(asked.stdout);
  if (answer === null || typeof answer !== 'object') {
    // What Orca did say, so the failure shows its cause (#438): its exit, and
    // each stream cut short and on one line, so a stack trace in it reads as
    // text and not as the kit's own.
    const exit = asked.status ?? `signal ${asked.signal}`;
    throw new Error(`Orca answered ${args.join(' ')} with something that is not JSON (exit ${exit}; `
      + `stdout ${said(asked.stdout)}; stderr ${said(asked.stderr)}).`);
  }
  return answer;
}

/** How much of each of Orca's streams an error carries. */
const SAID = 500;

/** A stream of Orca's as an error carries it: its lines folded into one, cut short with an ellipsis, in quotes. */
const said = (text) => {
  const one = String(text ?? '').trim().replace(/\s*\r?\n\s*/g, ' ⏎ ');
  return `"${one.length > SAID ? `${one.slice(0, SAID)}…` : one}"`;
};

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * What is wrong with Orca, or undefined when nothing is: it is up and its
 * runtime is reachable, the only state in which any of the calls below mean
 * anything. Asking is cheap, and asking first is what turns "Orca refused
 * terminal create" into a sentence the caller can act on.
 */
export function orcaTrouble() {
  const where = `Start Orca and run the command again, or point OBK_ORCA at its CLI if it lives somewhere else.`;

  const asked = spawnSync(orcaCli(), ['status', '--json'], { encoding: 'utf8' });
  if (asked.error) return `could not run Orca at ${orcaCli()}: ${asked.error.message}. ${where}`;

  const answer = parse(asked.stdout);
  // Orca knowing what is wrong beats the kit guessing, so its own words go
  // first when it gave any.
  if (answer !== null && typeof answer === 'object' && answer.ok !== true && answer.error?.message) {
    return `Orca is not ready: ${answer.error.message}. ${where}`;
  }
  // `null` is valid JSON with nothing to say, and so is anything else that
  // does not carry a runtime calling itself reachable.
  if (answer?.ok === true && answer.result?.runtime?.reachable === true) return undefined;

  return `Orca is not answering at ${orcaCli()}. ${where}`;
}

/** Every workspace Orca has a record of, folder and git alike. */
export const projects = () => orca(['project', 'setups']).setups;

/** Orca's record of the folder at `home`, or undefined when it knows none. */
export function findProject(home) {
  return projects().find((setup) => setup.path === home);
}

/** Where Orca keeps its own settings: one file per profile, under the user's home. */
export const profilesDir = () => path.join(homedir(), 'Library', 'Application Support', 'orca', 'profiles');

/**
 * Orca's own default launch arguments, per profile it keeps:
 * `{ dir, profiles: [{ file, args }] }`, where `args` maps an agent name to the
 * arguments Orca adds to it, and is undefined for a file that cannot be read.
 *
 * Orca adds these to the agents it launches, relaunches and resumes itself, so
 * they override the approval level a session was started with (PRD 6.5). The
 * kit reads Orca's files and never writes them.
 *
 * Orca 1.4.223 keeps them in `profile-state.db`, and older Orca in
 * `orca-data.json` (tech notes, section 1). Orca's CLI has no command that
 * prints them. A profile is read from its db when the db holds a settings
 * document, and from the json file otherwise. A db that cannot be read is not
 * passed over for the json beside it, which an upgraded Orca no longer keeps up
 * to date.
 *
 * A mapping with no entry for an agent is not "no arguments": Orca falls back
 * to its own built-in default, which is the permission bypass itself (tech
 * notes, section 1). So the caller reads a missing entry as one.
 */
export function orcaDefaultArgs() {
  const dir = profilesDir();

  let profiles;
  try {
    profiles = readdirSync(dir);
  } catch {
    return { dir, profiles: [] };
  }

  return {
    dir,
    profiles: profiles.map((name) => argsOfProfile(path.join(dir, name))).filter((one) => one !== undefined),
  };
}

/** What one profile says about the agents' default arguments, or undefined when it keeps no settings. */
function argsOfProfile(profile) {
  const db = path.join(profile, 'profile-state.db');
  const json = path.join(profile, 'orca-data.json');

  if (existsSync(db)) {
    let payload;
    try {
      payload = settingsPayloadIn(db);
    } catch {
      return { file: db, args: undefined };
    }
    if (payload !== null) return { file: db, args: argsIn(() => JSON.parse(payload)) };
  }
  if (existsSync(json)) return { file: json, args: argsIn(() => JSON.parse(readFileSync(json, 'utf8'))?.settings) };
  // A db with no settings document and no older file beside it: a store the
  // kit does not know how to read, which it says rather than pass over.
  return existsSync(db) ? { file: db, args: undefined } : undefined;
}

/**
 * The `settings` document in Orca's `profile-state.db`, as text, or null when
 * the db has none. Throws when the db cannot be read.
 *
 * Orca holds the db open in WAL mode, and its current settings may be in the
 * `-wal` alone. A SQLite open of Orca's own file, read-only included, writes
 * reader marks into its `-shm` and is refused while Orca holds the db in
 * exclusive mode. So the kit reads a copy: the `-wal` and then the db, into a
 * private folder of its own (0700, as mkdtemp makes it), removed straight after
 * on every path.
 *
 * A copy Orca changed under it is thrown away: a part of the `-wal` laid over a
 * db Orca has just checkpointed reads as older settings than Orca's own. So the
 * two files are noted before and after, and a copy is read only when neither
 * moved; after COPY_TRIES copies that all moved, the db counts as unreadable.
 * The bytes are read whole and written out rather than copied with
 * `copyFileSync`, which on macOS never returns when its source is truncated
 * under it, as a checkpoint truncates the `-wal` (#507).
 */
function settingsPayloadIn(db) {
  const copyDir = mkdtempSync(path.join(tmpdir(), 'obk-orca-'));
  try {
    const copy = path.join(copyDir, path.basename(db));
    for (let tries = 0; tries < COPY_TRIES; tries += 1) {
      const before = stateOf(db);
      const wal = bytesIfThere(`${db}-wal`);
      rmSync(`${copy}-wal`, { force: true });
      if (wal !== undefined) writeFileSync(`${copy}-wal`, wal);
      writeFileSync(copy, readFileSync(db));
      if (stateOf(db) !== before) continue;

      const store = new DatabaseSync(copy);
      try {
        const row = store.prepare("SELECT payload FROM profile_state_documents WHERE domain = 'settings'").get();
        return row === undefined ? null : row.payload;
      } finally {
        store.close();
      }
    }
    throw new Error(`${db} changed during each of ${COPY_TRIES} copies`);
  } finally {
    rmSync(copyDir, { recursive: true, force: true });
  }
}

/** How many copies of Orca's db the kit makes before it gives up on one that keeps changing. */
const COPY_TRIES = 3;

/** Where Orca's db and its `-wal` stand: one string that changes whenever either file does. */
const stateOf = (db) => [db, `${db}-wal`].map((file) => {
  const stat = statSync(file, { bigint: true, throwIfNoEntry: false });
  return stat === undefined ? 'none' : `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}).join('|');

/** The bytes of `file`, or undefined when there is no such file. */
function bytesIfThere(file) {
  try {
    return readFileSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/** What one settings document, given by `read`, says about the agents' default arguments. */
function argsIn(read) {
  try {
    const settings = read()?.agentDefaultArgs;
    // Anything that is not a mapping of agents is a mapping with nothing in it,
    // which is Orca falling back to its own defaults for every agent.
    return settings !== null && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
  } catch {
    return undefined;
  }
}

/**
 * Register the folder at `home` and make it a folder workspace called `title`.
 *
 * Two calls, and both are needed: `repo add` registers a folder inside the bots
 * repo as git kind, which Orca gives no workspace at all, so no tab can be
 * created in it. `setup-update` turns it into the folder workspace a bot needs
 * and names the project in one go.
 */
export function makeProject(home, title) {
  const setupId = orca(['repo', 'add', '--path', home]).repo.id;
  return asFolderProject(setupId, title);
}

/** Make an existing registration a folder workspace called `title`. */
export function asFolderProject(setupId, title) {
  return orca(['project', 'setup-update', '--setup', setupId, '--kind', 'folder', '--display-name', title])
    .result.setup;
}

/**
 * Take a bot's Orca project away: the setup, the project and the repo record,
 * in one call (tech notes, section 1). Only after its tabs are closed: a
 * project taken away first leaves tabs no command line can reach.
 *
 * With `--force`, because the caller has made those checks itself: Orca's next
 * release refuses a plain delete of a project with saved workspace details,
 * which a bot's project keeps after its tabs close (#528). Orca 1.4.223 does
 * not know the flag and refuses it before it changes anything, so then the
 * plain delete is sent, which it takes with no such guard.
 */
export function deleteProject(setupId) {
  const plain = ['project', 'setup-delete', '--setup', setupId];
  try {
    return orca([...plain, '--force']);
  } catch (error) {
    if (error.code !== 'invalid_argument' || !error.reason?.includes('Unknown flag --force')) throw error;
    return orca(plain);
  }
}

/** Said after a run that made or renamed a project, whatever `tellWindow` answered, and after a removal `reloadWindow` could not follow. */
export const RELOAD_LINE = "If Orca's sidebar does not show it, reload the window with Cmd+Shift+R.";

/**
 * How long Orca's client waits for its runtime, and how long the kit waits for
 * the client. Measured beside the full unit suite on Orca 1.4.214, the whole
 * call took at most 721 ms and the call inside the client at most 447 ms
 * (tech notes, #384).
 */
const CLIENT_WAIT_MS = 2000;
const CLIENT_KILL_MS = 3000;

/**
 * Tell Orca's window that the project `projectId` changed, so it reads its
 * projects again: true when Orca's runtime took the call, false otherwise.
 *
 * Orca's window re-reads only when its runtime says the projects changed, and
 * `setup-update` and `setup-delete` do not say so. `project.update` with no
 * changes does, and Orca's CLI does not offer it (ADR 0034). The caller prints
 * `RELOAD_LINE` either way. It does not take a removed project out of the
 * sidebar: `reloadWindow` does.
 */
export const tellWindow = (projectId) => askRuntime('project.update', { projectId, updates: {} }) !== undefined;

/**
 * One call to Orca's runtime for a method its CLI does not offer, and the
 * runtime's answer, or undefined when there is none to be had.
 *
 * It goes through Orca's own runtime client out of the installed app, run by
 * Orca's binary the way its `bin/orca` runs its CLI (ADR 0034). None of that is
 * Orca's published interface, so anything that goes wrong is a quiet
 * undefined: it never throws and is never tried twice.
 */
function askRuntime(method, params, killMs = CLIENT_KILL_MS) {
  try {
    // The CLI sits at <Orca.app>/Contents/Resources/bin/orca, often reached
    // through a link.
    const contents = path.resolve(realpathSync(orcaCli()), '..', '..', '..');
    const client = path.join(contents, 'Resources', 'app.asar.unpacked', 'out', 'cli', 'runtime-client.js');
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
    // As Orca's `bin/orca` does: the kit's own Node options are not Orca's.
    delete env.NODE_OPTIONS;
    delete env.NODE_REPL_EXTERNAL_MODULE;

    const asked = spawnSync(
      path.join(contents, 'MacOS', 'Orca'),
      [RUNTIME_SCRIPT, client, method, JSON.stringify(params), String(Math.min(CLIENT_WAIT_MS, killMs))],
      { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: Math.min(CLIENT_KILL_MS, killMs) },
    );
    if (asked.error !== undefined || asked.status !== 0) return undefined;
    return parse(asked.stdout) ?? undefined;
  } catch {
    return undefined;
  }
}

const RUNTIME_SCRIPT = fileURLToPath(new URL('./orca-runtime.cjs', import.meta.url));

/** The `osascript` this run asks. OBK_OSASCRIPT overrides it, as OBK_PS does `ps`. */
const osascriptCli = () => process.env.OBK_OSASCRIPT || '/usr/bin/osascript';

/** How long macOS is given to click the menu item. */
const RELOAD_KILL_MS = 5000;

/**
 * Have Orca's window force-reload itself, after a project was removed: true
 * only when it did (#343, ADR 0034).
 *
 * The window keeps a removed project in its sidebar until it is rebuilt, and
 * `tellWindow` only relabels the row "Unknown" (stablyai/orca#23224; once a
 * release fixes it, this can go behind a version check). Orca's own menu item
 * Force Reload rebuilds it and keeps every terminal. So on macOS the kit has
 * System Events click that item, in the Orca app its CLI belongs to and no
 * other, and only while that Orca is the front app: a click on a background
 * Orca is taken and does nothing, and the kit does not take the user's screen. None of that is Orca's published interface, and macOS may refuse it,
 * so anything that goes wrong is a quiet false, as with `tellWindow`: it never
 * throws and is never tried twice, and the caller prints `RELOAD_LINE`.
 */
export function reloadWindow() {
  if (process.platform !== 'darwin') return false;
  try {
    // <Orca.app>/Contents/Resources/bin/orca, often reached through a link.
    const app = path.resolve(realpathSync(orcaCli()), '..', '..', '..', '..');
    const asked = spawnSync(osascriptCli(), [RELOAD_SCRIPT, app], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: RELOAD_KILL_MS,
    });
    return asked.error === undefined && asked.status === 0 && asked.stdout.trim() === 'reloaded';
  } catch {
    return false;
  }
}

const RELOAD_SCRIPT = fileURLToPath(new URL('./orca-reload.applescript', import.meta.url));

/**
 * The live tabs of the Orca project at `home`, each under its own tab id.
 *
 * The listing gives a tab whose pane the window has not loaded as orphaned,
 * under `pty:<ptyId>` rather than its id, and a running harness puts a tab the
 * kit opened in that state within seconds. `terminal show` still answers with
 * the real id, so an orphaned entry is given that one: the tab id is the key
 * (PRD 6.2), and this is where Orca is asked for it (tech notes, section 1).
 */
export const tabs = (home, options) => orca(['terminal', 'list', '--worktree', `path:${home}`], options).terminals
  .map((tab) => (tab.orphaned === true
    ? { ...tab, tabId: orca(['terminal', 'show', '--terminal', tab.handle], options).terminal.tabId }
    : tab));

/**
 * Open a tab in the Orca project at `home`, titled `title`.
 *
 * No `--command`: for a project the kit has just made, `--command` with a
 * harness times out and leaves a tab that never goes live (tech notes). The
 * launch command is typed in afterwards. No `--focus` either: the user is
 * working, and the kit does not take his screen.
 */
export const openTab = (home, title) =>
  orca(['terminal', 'create', '--worktree', `path:${home}`, '--title', title]).terminal;

/** Set a tab's title. The kit sets titles; it never reads them. */
export const retitleTab = (handle, title) =>
  orca(['terminal', 'rename', '--terminal', handle, '--title', title]).rename;

/**
 * One quick look at whether the harness in a tab is at rest, for a caller that
 * already knows a harness is there and is watching for a turn to start (#509):
 * `idle` when Orca's tui-idle answers ok, `busy` when it times out, and
 * `unknown` when Orca refuses or does not answer within `waitMs` and a second
 * more. Never throws.
 */
export function idleNow(handle, waitMs) {
  try {
    const answer = ask(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', String(waitMs)], waitMs + 1000);
    if (answer.ok === true) return answer.result?.wait?.blockedReason === undefined ? 'idle' : 'unknown';
    return answer.error?.code === 'timeout' ? 'busy' : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * What can be learned about the harness in a tab: what Orca says, and who is
 * in front of the tab's terminal.
 *
 * Orca's answers alone do not tell a harness from a shell (tech notes, section
 * 1, #232). `tui-idle` refuses a busy harness with `timeout` just as it refuses
 * a shell, and a shell Codex quit to answers `ok`. `agentIdentity` comes late
 * and can outlast the harness by minutes. So the answer the caller acts on is
 * `front`: `program` when something other than the tab's shell holds its
 * terminal, with `command` its name, `shell` when the shell does, and
 * undefined when that cannot be read, with `unreadable` saying why. `answered` (an `ok` from `tui-idle`) and
 * `agent` are Orca's own hints, for a caller that has nothing better.
 * `blockedReason` is Orca saying something on screen wants answering, which is
 * for the caller to deal with, not the kit. `question` is the kit's own look at
 * the screen, as `questionIn` answers, and `screenUnreadable` says why there
 * was none.
 */
export function harnessInTab(handle, timeoutMs, readMs) {
  const args = ['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', String(timeoutMs)];
  // With `readMs`, each call to Orca is given that long on top of what it was
  // asked to wait, and ends as TIMED_OUT when it has not answered (#422).
  const answer = ask(args, readMs === undefined ? undefined : timeoutMs + readMs);

  // Out of time means nothing went idle, busy or absent alike. That is an
  // answer, not a breakdown.
  if (answer.ok !== true && answer.error?.code !== 'timeout') {
    throw refusal(args, answer);
  }

  const shown = orca(['terminal', 'show', '--terminal', handle], { timeoutMs: readMs }).terminal;
  const agent = typeof shown?.agentIdentity === 'string' && shown.agentIdentity !== '' ? shown.agentIdentity : undefined;
  return {
    answered: answer.ok === true,
    blockedReason: answer.result?.wait?.blockedReason,
    agent,
    ...frontOf(handle, shown?.ptyId, readMs),
    ...screenOf(handle, readMs),
  };
}

/** Orca's reason for a folder-trust screen, which it can go on giving once that is answered (#342). */
const TRUST_REASON = 'agent-trust-workspace';

/**
 * How long each call to Orca the typing gate makes is given, beyond any wait it
 * asked for, before the gate gives up on it and cannot tell (#422).
 */
const GATE_READ_MS = 5000;

/** The kit's word for a tab whose screen shows a question of its harness's own (#329). */
export const QUESTION_ON_SCREEN = 'question-on-screen';

/**
 * What the tab `handle` renders: `{ question }`, true when it shows a question
 * of its harness's own, with the `rows` it read, or `{ screenUnreadable: <why> }`. Orca refusing is an
 * answer that cannot be read, not an error, and so is anything that is not the
 * rendered screen: accumulated output comes back in fragments (tech notes,
 * section 1).
 */
function screenOf(handle, readMs) {
  const read = screenRows(handle, readMs);
  return read.rows === undefined ? { screenUnreadable: read.unreadable } : { question: questionIn(read.rows), rows: read.rows, draft: read.draft };
}

/**
 * The rows the tab `handle` renders, `{ rows, draft }`, or `{ unreadable: <why> }`.
 * Orca refusing, or answering with anything but the rendered screen, is a
 * screen that cannot be read, not an error. `draft` is the text in the
 * harness's input line, undefined when there is none: Orca 1.4.223 gives it
 * beside the rows, and Claude Code 2.1.296's input line in the rows then reads
 * its pointer alone (#510, probe 4).
 */
export function screenRows(handle, readMs) {
  let read;
  try {
    read = orca(['terminal', 'read', '--terminal', handle, '--screen'], { timeoutMs: readMs }).terminal;
  } catch (error) {
    return { unreadable: `Orca would not read its screen: ${error.message}` };
  }
  if (read?.source !== 'screen' || !Array.isArray(read.tail)) {
    return { unreadable: `Orca gave no rendered screen for it (source: ${read?.source ?? 'none'})` };
  }
  return { rows: read.tail, draft: typeof read.draft === 'string' && read.draft !== '' ? read.draft : undefined };
}

/** A row the harness starts with its selection pointer: `›` on Codex, `❯` on Claude Code. */
const POINTER_ROW = /^ *[›❯]/;

/** How a harness's form says it is answered, as Claude Code 2.1.283 draws its foot (#416). */
const FORM_FOOT = /Enter to (?:continue|confirm|select)\b.*Esc to cancel/i;

/** That pointer on a numbered choice, and the column its number starts in. */
const ON_A_CHOICE = /^( *[›❯] +)\d+\. /;

/**
 * Whether the rows of a rendered screen hold a question of the harness's own.
 *
 * Every one seen is a numbered list of choices with the harness's pointer on
 * one (tech notes, section 1; ADR 0034). The same pointer starts the harness's
 * input line and its echo of the user's past turns, and the input line is the
 * lowest of them whenever it is on screen, so the lowest pointer row is asked
 * about: a question counts while it stands in the input line's place, or
 * while it is the last thing drawn right above the input box (#491).
 * Unnumbered lists do not count. Codex puts a status row right under its input
 * line, lined up with it, and by its layout that is one.
 */
export function questionIn(rows) {
  if (feedbackPanelIn(rows)) return true;
  const at = rows.findLastIndex((row) => POINTER_ROW.test(row));
  // A form of the harness's own has no numbers but a foot that says how to
  // answer it: Claude Code 2.1.283's "Teach auto mode" ends `Enter to continue
  // · Esc to cancel`, and a return there is Continue, which starts a scan
  // (#416). It counts on or below the lowest pointer row, or anywhere when
  // there is none: under old words of one in the history, the input line is
  // the lowest pointer, and nothing below it is a foot.
  if (rows.slice(Math.max(at, 0)).some((row) => FORM_FOOT.test(row))) return true;
  if (pointedChoiceAt(rows, at)) return true;
  // Claude Code 2.1.289 draws its Teach list above its input box, whose own
  // `❯` stays the lowest pointer row (#491). A question there is the last
  // thing drawn above the box's top rule: its foot, or its numbered choices
  // with the pointer on one, under it a foot that a narrow pane wraps onto
  // rows of its own. The same words with anything after them are history.
  if (at < 1 || !RULE_ROW.test(rows[at - 1])) return false;
  let end = rows.slice(0, at - 1).findLastIndex((row) => row.trim() !== '');
  if (end < 0) return false;
  if (FORM_FOOT.test(rows[end])) return true;
  while (end > 0 && FOOT_PART.test(rows[end])) end -= 1;
  if (!NUMBERED.test(rows[end])) return false;
  let first = end;
  while (first > 0 && NUMBERED.test(rows[first - 1])) first -= 1;
  for (let row = first; row <= end; row += 1) {
    if (pointedChoiceAt(rows, row)) return true;
  }
  return false;
}

/** The gate's answer for Claude Code's panel of feedback drafts (#502). */
export const FEEDBACK_PANEL = 'feedback-drafts-panel';

/** The first row in the panel's box, as Claude Code 2.1.291 draws it: `✻ Bug report drafted: <title>`. */
const PANEL_TITLE = /^ *│ +(?:\S+ +)?(?:Bug report|Product feedback|Feature request|Feedback) drafted: /;

/** What Claude Code 2.1.291 asks in the panel's place after a `0`, its keys' foot last: `… 0 to turn off · Esc to keep`. */
const PANEL_TURN_OFF = /^Turn off Claude-drafted feedback\? 0 to turn off · Esc to keep$/i;

/**
 * Whether the rows of a rendered screen show Claude Code's panel of feedback
 * drafts (#502). It has no pointer and no numbers, but it reads single keys
 * from the input line, and `2` twice sends a draft to Anthropic. Claude Code
 * 2.1.291 draws it as a box, its title row first, as the last thing above its
 * input box's top rule; after a `0`, the question whether to turn the drafts
 * off stands in its place, wrapped as the pane needs, and a typed line answers
 * that too. The same words
 * with anything after them are history.
 */
export function feedbackPanelIn(rows) {
  const at = rows.findLastIndex((row) => POINTER_ROW.test(row));
  if (at < 1 || !RULE_ROW.test(rows[at - 1])) return false;
  const end = rows.slice(0, at - 1).findLastIndex((row) => row.trim() !== '');
  if (end < 0) return false;
  // The question is plain text, which a narrow pane wraps onto rows of its
  // own, with a blank row above it: it is the whole block that ends there.
  const start = rows.slice(0, end).findLastIndex((row) => row.trim() === '') + 1;
  if (PANEL_TURN_OFF.test(rows.slice(start, end + 1).map((row) => row.trim()).join(' '))) return true;
  if (!/^ *╰─/.test(rows[end])) return false;
  const top = rows.slice(0, end).findLastIndex((row) => /^ *╭─/.test(row));
  return top >= 0 && PANEL_TITLE.test(rows[top + 1]);
}

/** A rule Claude Code draws right across, as the top of its input box: `─` or `▔`. */
const RULE_ROW = /^ *[─▔]{8,}/;

/** A numbered choice, with the pointer on it or not. */
const NUMBERED = /^ *(?:[›❯] +)?\d+\. /;

/** A part of a foot, as a narrow pane wraps it: `Enter to confirm ·`, `Esc to cancel`. */
const FOOT_PART = /\b(?:Enter to (?:continue|confirm|select)|Esc to cancel)\b/i;

/** Whether `rows[at]` has the pointer on a numbered choice, with another lined up right above or below it. */
function pointedChoiceAt(rows, at) {
  const pointer = at < 0 ? null : ON_A_CHOICE.exec(rows[at]);
  if (pointer === null) return false;
  const column = pointer[1].length;
  const choice = (row) => typeof row === 'string' && row.slice(0, column).trim() === '' && /^\d+\. /.test(row.slice(column));
  return choice(rows[at - 1]) || choice(rows[at + 1]);
}

/**
 * Whether the kit may type a line into `tabId`, the tab the book holds for a
 * session in the Orca project at `home`, and the handle to type into when it
 * may: `{ handle, agent }`, with the agent Orca names there. Otherwise nothing
 * is typed, and the answer says why. `idle` says whether Orca's `tui-idle` wait
 * answered ok, and `rows` is the screen the gate read, for a caller that must
 * not type into a busy harness (#391), with the `draft` Orca gave beside it (#510):
 * `{}` for a tab with no harness in it (none in the book, none Orca lists, or
 * the shell in front), `{ blocked }` for one with something on screen waiting
 * to be answered, and `{ unsure }`, a sentence, for one the kit cannot tell
 * about, with `psUnread` where `ps` could not read the tab (#350). Orca
 * refusing throws, for the caller to report.
 *
 * The one gate for every line the kit types into a running session: the mail
 * nudge and the skills reload. A busy harness passes it, since both harnesses
 * take a typed line as their next turn.
 */
export function tabToTypeInto(home, tabId, timeoutMs) {
  if (tabId === undefined) return {};
  // Every call to Orca here has a bound, so one slow reply cannot hold the
  // command that asked: one that runs out is "cannot tell" (#422).
  let live;
  let seen;
  try {
    live = tabs(home, { timeoutMs: GATE_READ_MS }).find((tab) => tab.tabId === tabId);
    if (live === undefined) return {};
    seen = harnessInTab(live.handle, timeoutMs, GATE_READ_MS);
  } catch (error) {
    if (error.code !== TIMED_OUT) throw error;
    return { unsure: `Orca did not answer in time (${error.message}), so the kit could not tell whether a harness is running in it, and nothing was typed` };
  }
  // A line typed into a screen waiting for an answer is that answer: once, it
  // confirmed Claude Code's folder-trust default, `No, exit` (tech notes,
  // section 1).
  // Except where Orca still reports Codex's trust screen after it was
  // answered, over an idle screen (#342). Nothing is typed then either, but
  // there is nothing to answer, so the kit says what it saw. Claude Code's
  // trust list is not numbered and the screen read cannot see it, so this is
  // for Codex alone.
  if (seen.blockedReason === TRUST_REASON && seen.agent === 'codex' && seen.question === false) {
    return { unsure: `Orca still reports ${TRUST_REASON} in it, and its screen shows no question: Orca can go on reporting the trust screen after it is answered, and refuse a typed line while it does, so nothing was typed` };
  }
  if (seen.blockedReason !== undefined) return { blocked: seen.blockedReason };
  // The shell in front is a tab with no harness, whatever a stale
  // `agentIdentity` says.
  if (seen.front === 'shell') return {};
  // Not knowing is not a reason to type: a line that lands in a shell is run
  // there. The program in front has to be the agent Orca names. With no name
  // it may be a harness a few seconds into its launch; under another name it
  // may be a pager started after the harness quit, under an identity Orca has
  // not let go of (tech notes, section 1). A harness run under another name,
  // such as `node` for an npm install, passes on the kit's own mark instead
  // (#261).
  // Either way Orca has to name an agent there: a harness it has not named yet
  // may be seconds into its launch and not ready for a line.
  if (seen.front === undefined || seen.agent === undefined || (seen.command !== seen.agent && !launchedHere(seen.pid, tabId))) {
    const why = seen.front === undefined
      ? seen.unreadable
      : `${seen.command} holds its terminal, and Orca names ${seen.agent ?? 'no agent'} in it`;
    // Where `ps` could not read the tab, a reader that can may yet tell (#350).
    return { unsure: `the kit could not tell whether a harness is running in it (${why}), so nothing was typed`, ...(seen.psUnread ? { psUnread: true } : {}) };
  }
  // Orca's reason does not cover every question: it called Codex's update
  // offer idle, and a return typed into it took "Update now" (#329). So the
  // screen is read too, and one that cannot be read is not a reason to type.
  if (seen.question === true) return { blocked: feedbackPanelIn(seen.rows) ? FEEDBACK_PANEL : QUESTION_ON_SCREEN };
  if (seen.question === undefined) {
    return { unsure: `the kit could not tell whether a question is waiting on its screen (${seen.screenUnreadable}), so nothing was typed` };
  }
  return { handle: live.handle, agent: seen.agent, idle: seen.answered, rows: seen.rows, draft: seen.draft };
}

/**
 * Whether the process `pid`, in front of the tab `tabId`, is the harness the
 * kit's launch line started there, whatever it is called (#261). The line sets
 * `OBK_TAB_SHELL` to the tab's shell's pid, for the harness alone and not
 * exported, so the harness carries it, with its parent that shell. A program
 * the shell starts later, such as `less` after the harness quit (#232), has no
 * mark. A program the harness starts carries the mark, and its parent is the
 * harness. A tab Orca restored by itself has no mark at all. Only whole words
 * of the environment count, and anything unread is a no.
 */
function launchedHere(pid, tabId) {
  if (pid === undefined) return false;
  const words = wordsOfProcess(pid);
  if (words === undefined || !words.includes(`${TAB_ENV}=${tabId}`)) return false;
  const marks = words.filter((word) => new RegExp(`^${SHELL_ENV}=[0-9]+$`).test(word));
  const own = psLine(pid);
  return marks.length === 1 && own !== undefined && Number(marks[0].slice(SHELL_ENV.length + 1)) === own.ppid;
}

/**
 * Who holds the terminal of the tab `handle`, as `frontOf` answers, without
 * waiting on the tab: for a caller that asks about every tab and has nothing
 * to type. Orca refusing is an answer that cannot be read, not an error.
 */
export function frontOfTab(handle) {
  let shown;
  try {
    shown = orca(['terminal', 'show', '--terminal', handle]).terminal;
  } catch (error) {
    return { unreadable: `Orca would not show the tab: ${error.message}` };
  }
  return frontOf(handle, shown?.ptyId);
}

/** The `ps` this run reads. OBK_PS overrides it, as OBK_ORCA does Orca. */
export const psCli = () => process.env.OBK_PS || '/bin/ps';

/**
 * Who holds the terminal of the tab `handle`, whose pane is `ptyId`:
 * `{ front: 'shell' }`, `{ front: 'program', command, pid }` with the name and,
 * where `ps` gave it, the pid of the process leading the group in front, or
 * `{ unreadable: <why> }`; each with `pane`, the pane's pid, where Orca gave it.
 *
 * `ps` is asked first. Where it cannot read the tab, as inside Codex's
 * sandbox, where it does not start at all, Orca's runtime is asked instead
 * (#298, ADR 0034). `readMs` bounds each call: a number, or a function that
 * says what is left of a wait, asked before each one (#498). A `ps` that runs
 * out of it ends the look, `late`, with no runtime asked after it.
 */
function frontOf(handle, ptyId, readMs) {
  const read = frontByPs(ptyId, readMs);
  if (read.unreadable === undefined || read.late === true) return read;
  const asked = frontByOrca(handle, msOf(readMs));
  // The pane's pid, where `diagnostics memory` gave it, goes on with the answer.
  const pane = read.pane === undefined ? {} : { pane: read.pane };
  return { ...(asked.unreadable === undefined ? asked : { unreadable: `${read.unreadable}, and ${asked.unreadable}` }), psUnread: true, ...pane };
}

/**
 * Who holds the tab's terminal as Orca's runtime says it, through
 * `terminal.inspectProcess`: Orca's own daemon reads the process table from
 * outside any sandbox of the kit's, and names what leads the terminal's
 * foreground group. Only a `live` answer counts. A process named there is the
 * program in front; none named and no child in front is the shell. Anything
 * else is "cannot tell": for a moment after a harness quits, Orca can name
 * nothing and still see a child in front (read in the Orca 1.4.212 bundle).
 */
function frontByOrca(handle, readMs) {
  const seen = askRuntime('terminal.inspectProcess', { terminal: handle }, readMs)?.result?.process;
  const evidence = seen?.foregroundProcessEvidence;
  if (evidence?.verdict !== 'live') {
    const why = typeof evidence?.reason === 'string' ? `: ${evidence.reason}` : '';
    return { unreadable: `Orca's runtime could not say who is in front of it${why}` };
  }
  const name = (word) => typeof word === 'string' && word !== '';
  if (name(evidence.processName)) return { front: 'program', command: evidence.processName };
  if (evidence.processName === null && name(seen.foregroundProcess)) return { front: 'program', command: seen.foregroundProcess };
  if (evidence.processName === null && seen.foregroundProcess === null && seen.hasChildProcesses === false) return { front: 'shell' };
  return { unreadable: "Orca's runtime gave no answer the kit can read about who is in front of it" };
}

/**
 * Who holds the terminal of the pane `ptyId`, as `ps` says it.
 *
 * Orca gives the pane's pid in `diagnostics memory` and nowhere else, and `ps`
 * gives that pid's terminal's foreground process group (ADR 0034).
 * On macOS the pane is `login` with the shell as its child, so the shell is in
 * front when the group is the pane's own or that of a child of a `login` pane.
 * `diagnostics memory` is a diagnostics command and may change, so everything
 * here ends in "cannot tell" rather than in an error or a guess.
 */
function frontByPs(ptyId, readMs) {
  const { pane, unreadable } = panePid(ptyId, msOf(readMs));
  if (unreadable !== undefined) return { unreadable };

  const own = psLine(pane, msOf(readMs));
  if (own?.late === true) return { unreadable: `ps did not answer in time for its pane, pid ${pane}`, late: true };
  if (own === undefined) return { unreadable: `ps could not read its pane, pid ${pane}`, pane };
  if (own.tpgid === pane) return { front: 'shell', pane };

  const front = psLine(own.tpgid, msOf(readMs));
  if (front?.late === true) return { unreadable: `ps did not answer in time for the process in front, pid ${own.tpgid}`, late: true };
  if (front === undefined) return { unreadable: `ps could not read the process in front, pid ${own.tpgid}`, pane };
  const shell = front.ppid === pane && path.basename(own.comm) === 'login';
  return shell ? { front: 'shell', pane } : { front: 'program', command: path.basename(front.comm), pid: own.tpgid, pane };
}

/** A bound `frontOf` was given, as a number of milliseconds: asked now when it is a function. */
const msOf = (readMs) => (typeof readMs === 'function' ? readMs() : readMs);

/**
 * The pid of the pane `ptyId`, `{ pane }`, from `diagnostics memory`, or
 * `{ unreadable: <why> }`.
 */
function panePid(ptyId, readMs) {
  let pane;
  try {
    pane = orca(['diagnostics', 'memory'], { timeoutMs: readMs }).worktrees
      .flatMap((worktree) => worktree.sessions ?? [])
      .find((session) => session.sessionId === ptyId)?.pid;
  } catch (error) {
    // Orca not answering within the bound the typing gate set is not a tab
    // `ps` cannot read: it ends the gate as "cannot tell", with no fallback to
    // the runtime (review of PR #424).
    if (error.code === TIMED_OUT) throw error;
    return { unreadable: `Orca would not give the pane's pid: ${error.message}` };
  }
  if (!Number.isInteger(pane) || pane <= 0) return { unreadable: 'Orca gave no pid for its pane' };
  return { pane };
}

/** The `lsof` and `stty` this run asks. OBK_LSOF and OBK_STTY override them, as OBK_PS does `ps`. */
export const lsofCli = () => process.env.OBK_LSOF || '/usr/sbin/lsof';
const sttyCli = () => process.env.OBK_STTY || '/bin/stty';

/**
 * One look at the shell of a tab the kit has just opened, before anything is
 * typed into it (#498): `{ ready: true }` when the shell is at a prompt that
 * takes a line, `{ asking: true }` when the shell is in front and reading the
 * tty some other way, `{ program }` when something else is in front, and
 * `{ unsure: <why> }` when the kit cannot tell, with `late` when a call ran out
 * of the time left until `until`.
 *
 * A shell's line editor (zsh's, bash's readline) puts the tty in non-canonical
 * mode with no echo and no literal-next key while it waits at a prompt. A
 * question asked in a start-up file (`read -k 1`, `read -p`, `read -s -k 1`)
 * leaves echo or the literal-next key on, and so does a shell still busy with
 * its start-up files. Orca's daemon tells a ready shell
 * the same way when its own mark does not come (tech notes, section 1). The
 * shell's prompt itself is never read: it is the user's.
 */
export function shellInTab(handle, until) {
  // Each call is given what is left until `until`, so a reader that hangs
  // cannot hold the launch past its wait.
  const left = () => Math.max(1, until - Date.now());
  try {
    let shown;
    try {
      shown = orca(['terminal', 'show', '--terminal', handle], { timeoutMs: left() }).terminal;
    } catch (error) {
      if (error.code === TIMED_OUT) throw error;
      return { unsure: `Orca would not show the tab: ${error.message}` };
    }
    const front = frontOf(handle, shown?.ptyId, left);
    if (front.unreadable !== undefined) return { unsure: front.unreadable, ...(front.late ? { late: true } : {}) };
    if (front.front === 'program') return { program: front.command };
    const { pane, unreadable } = front.pane === undefined ? panePid(shown?.ptyId, left()) : front;
    if (unreadable !== undefined) return { unsure: unreadable };
    const mode = ttyMode(pane, left);
    if (mode.unreadable !== undefined) return { unsure: mode.unreadable, ...(mode.late ? { late: true } : {}) };
    return mode.lineEditor ? { ready: true } : { asking: true };
  } catch (error) {
    if (error.code !== TIMED_OUT) throw error;
    return { unsure: `Orca did not answer in time: ${error.message}`, late: true };
  }
}

/**
 * Whether the tty of the pane `pid` is in a line editor's mode, `{ lineEditor }`,
 * or `{ unreadable: <why> }`. `lsof` names the tty on the standard input of the
 * shell, and `stty` reads its flags; both run inside Codex's sandbox, where
 * `ps` does not. The pane is `login`, which runs as root and whose files `lsof`
 * cannot read, so the shell is found as the user's process whose parent it is,
 * or as the pane itself where the pane is the shell.
 */
function ttyMode(pid, left) {
  const listed = spawnSync(lsofCli(), ['-a', '-R', '-d', '0', '-u', String(process.getuid()), '-FpRn'], { encoding: 'utf8', timeout: left() });
  if (listed.error?.code === 'ETIMEDOUT') return { unreadable: 'lsof did not answer in time', late: true };
  if (listed.error || listed.status !== 0) return { unreadable: `lsof could not list the processes' ttys` };
  // One record per process: `p<pid>`, `R<parent pid>`, `f0`, `n<name>`.
  let record = {};
  let tty;
  for (const line of listed.stdout.split('\n')) {
    if (line.startsWith('p')) record = { pid: Number(line.slice(1)) };
    else if (line.startsWith('R')) record.ppid = Number(line.slice(1));
    else if (line.startsWith('n/dev/') && (record.pid === pid || record.ppid === pid)) tty ??= line.slice(1);
  }
  if (tty === undefined) return { unreadable: `lsof named no tty for the shell of its pane, pid ${pid}` };

  const read = spawnSync(sttyCli(), ['-a', '-f', tty], { encoding: 'utf8', timeout: left() });
  if (read.error?.code === 'ETIMEDOUT') return { unreadable: `stty did not answer in time for ${tty}`, late: true };
  if (read.error || read.status !== 0) return { unreadable: `stty could not read ${tty}` };
  const words = read.stdout.split(/\s+/);
  const flag = (name) => (words.includes(name) ? true : words.includes(`-${name}`) ? false : undefined);
  const [icanon, echo] = [flag('icanon'), flag('echo')];
  if (icanon === undefined || echo === undefined) return { unreadable: `stty gave no icanon and echo flags for ${tty}` };
  // A line editor also turns off the literal-next key, which a question read
  // with echo off (`read -s -k 1`) leaves on, as Orca's own test has it.
  return { lineEditor: !icanon && !echo && /(?:^|[;\s])lnext\s*=\s*<undef>(?:;|\s|$)/.test(read.stdout) };
}

/**
 * The process `pid` as `ps -E` gives it, word by word: its command, its
 * arguments, then its environment as `NAME=value` words. Undefined when it
 * cannot be read. macOS gives a same-user harness's environment this way (tech
 * notes, section 1); nothing in it says where the arguments end, so a caller
 * looks for one whole word it knows.
 */
export function wordsOfProcess(pid) {
  const asked = spawnSync(psCli(), ['-E', '-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
  if (asked.error || asked.status !== 0) return undefined;
  return asked.stdout.trim().split(/\s+/);
}

/** One process as `ps` gives it, read only: `{ ppid, tpgid, comm }`, `{ late: true }` past `readMs`, or undefined. */
function psLine(pid, readMs) {
  const asked = spawnSync(psCli(), ['-o', 'pid=,ppid=,tpgid=,comm=', '-p', String(pid)], { encoding: 'utf8', ...(readMs === undefined ? {} : { timeout: readMs }) });
  if (asked.error?.code === 'ETIMEDOUT') return { late: true };
  if (asked.error || asked.status !== 0) return undefined;
  const line = /^\s*(\d+)\s+(\d+)\s+(-?\d+)\s+(.+?)\s*$/.exec(asked.stdout);
  if (line === null) return undefined;
  return { ppid: Number(line[2]), tpgid: Number(line[3]), comm: line[4] };
}

/**
 * Close one tab, by the handle Orca issued for it.
 *
 * With `closeTerminal` below, the only place in the kit that takes anything
 * away, and each takes away one tab: `--terminal <handle> --tab`. Orca's other
 * form, `--worktree <sel> --all`,
 * closes every tab of a project with its layouts and resume records, which are
 * the user's work and not the kit's to end (tech notes, section 1).
 */
export const closeTab = (handle) =>
  orca(['terminal', 'close', '--terminal', handle, '--tab']).close;

/**
 * Close one terminal without `--tab`: for a tab of one pane, as every tab the
 * kit opens is, Orca then closes that tab by its id and stops its process (read
 * in the 1.4.215 bundle). Only for a tab `--tab` could not find (#405): Orca
 * looks a `--tab` close up in a tab snapshot of its own, which a tab it still
 * lists can be missing from after a restart, and answers `tab_not_found`.
 */
export const closeTerminal = (handle) =>
  orca(['terminal', 'close', '--terminal', handle]).close;

/**
 * Type `text` into a tab and press return.
 *
 * Orca sometimes gates a line going into a tab that has an agent in it and
 * answers `agent_prompt_blocked`, carrying a request id and telling the caller
 * to re-issue the exact command with that id and a time to wait for the line to
 * be submitted — and not to retry without it. So that is what this does, once.
 * Seen live on 2026-09-21 in a system test run; not reproduced since, including
 * from a plain shell, long lines and lines sent while the agent was working.
 *
 * The wait is short because the caller is telling a session it has mail, not
 * handing it work: mail that has to wait for the next check is a smaller cost
 * than a command that hangs for half a minute.
 *
 * With `watch`, the line is sent with that wait from the start, and Orca's
 * receipt says whether it saw the line start a turn (#394). It gives back
 * Orca's `result`: the receipt is in its `send.prompt`, and Orca's words about
 * a turn it did not see in its `warnings`.
 */
export function typeIntoTab(handle, text, { watch = false } = {}) {
  const args = ['terminal', 'send', '--terminal', handle, '--text', text, '--enter'];
  const answer = ask(watch ? [...args, '--wait-submit', String(SUBMIT_WAIT_S)] : args);
  if (answer.ok === true) return answer.result;

  const again = answer.error?.data?.orchestrationRequestId;
  if (answer.error?.code !== 'agent_prompt_blocked' || typeof again !== 'string') {
    throw new Error(`Orca refused ${args.join(' ')}: ${answer.error?.message ?? 'no reason given'}`);
  }
  return orca([...args, '--retry-request', again, '--wait-submit', String(SUBMIT_WAIT_S)]);
}

/**
 * How long a watched or re-issued line is given to be submitted before Orca
 * gives up on it. An idle harness started its turn in about 2 s, live (#394).
 */
const SUBMIT_WAIT_S = 5;

/** Where Orca names the terminal a process runs in, in every pane it opens. */
export const TERMINAL_ENV = 'ORCA_TERMINAL_HANDLE';

/**
 * A mailbox of one session's own: an Orca Run, which is a name and an inbox and
 * nothing else — it schedules nothing and runs nobody. The objective is what a
 * person sees in `orca orchestration run-list`, so it says whose it is.
 *
 * Bound to the terminal this process runs in, which has to be the session's own
 * tab: Orca tells a Run's coordinator terminal about its mail and nobody else,
 * and one terminal holds one Run. Orca 1.4.210 lets a process in a tab bind a
 * Run to that tab and to no other, so this is called from inside the session's
 * tab and names no `--from` (tech notes, section 1; #317).
 */
export const makeMailbox = (objective, options) =>
  orca(['orchestration', 'run-create', '--objective', `obk ${objective}`], options).run.id;

/**
 * Bind a mailbox to the terminal `handle`, which makes it the Run's coordinator
 * and its one reader: Orca refuses a `check` from any other terminal with
 * `consumer_fenced`. A read itself binds nothing, so this is for a session's own
 * live tab, never for whoever is reading (tech notes, section 1). Without a
 * handle it binds this process's own terminal; on Orca 1.4.210 a process in a
 * tab may name no other (#317).
 */
export const useMailbox = (id, handle, options) =>
  orca(['orchestration', 'run-use', '--id', id, ...(handle === undefined ? [] : ['--from', handle])], options).run;

/**
 * The terminal a mailbox is bound to, or undefined when it has none. A closed
 * tab keeps its binding, and a read as its handle still works: a read binds
 * nothing, only `run-use` does (tech notes, section 1).
 */
export const coordinatorOf = (id, options) =>
  orca(['orchestration', 'run-show', '--id', id], options).run.coordinator_handle ?? undefined;

/**
 * Whether this Orca has no Run of that id at all, as when the book was written
 * on another machine (#508). Only `run-show` refused `run_not_found` says so:
 * `run-use` gives a legacy Run the same code and words, and a Run shown, a
 * time-out or any other refusal is not a Run known to be missing (tech notes,
 * section 1).
 */
export function runMissing(id, options) {
  try {
    orca(['orchestration', 'run-show', '--id', id], options);
    return false;
  } catch (error) {
    return error.code === 'run_not_found';
  }
}

/** Queue one message. `to` and `from` are mailboxes, written `run:<id>`. */
export function postMessage({ to, from, subject, body, type = 'status', thread }) {
  const args = ['orchestration', 'send', '--to', to, '--subject', subject, '--body', body, '--type', type];
  if (from !== undefined) args.push('--from', from);
  if (thread !== undefined) args.push('--thread-id', thread);
  return orca(args).message;
}

/**
 * What is waiting in a mailbox: the oldest batch that has not been
 * acknowledged, or, peeking, whatever is unread without touching it. Read as
 * the terminal `handle` when one is given, which is how a read works from a tab
 * bound to another Run; otherwise as this process's own terminal.
 */
export const readMailbox = (id, { peek = false, handle } = {}, options) =>
  orca(['orchestration', 'check', '--run', id, ...as(handle), ...(peek ? ['--peek'] : [])], options);

/** Say a batch has been read. Orca answers with the batch after it. */
export const ackMailbox = (id, delivery, handle, options) =>
  orca(['orchestration', 'check', '--run', id, ...as(handle), '--ack', delivery], options);

/** The reader of a `check`: the terminal named, or this process's own. */
const as = (handle) => (handle === undefined ? [] : ['--terminal', handle]);
