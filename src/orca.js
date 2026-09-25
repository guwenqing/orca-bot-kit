// Every call the kit makes to Orca goes through here (ADR 0021). Orca's CLI
// changes often, so the kit reads `--json` and never the human text, and keeps
// the parsing in one place.
//
// A word on words: Orca calls every workspace a "worktree", a plain folder
// included. Nothing the user reads may say that, or they will think a git
// worktree was made. Say "Orca project". The word belongs only in the selector
// handed to Orca on the command line.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The Orca that works for a normal user: `/usr/local/bin/orca` is a root-only
// symlink on this machine (tech notes, section 1). OBK_ORCA overrides it, for a
// machine that keeps Orca somewhere else.
const BUILT_IN = '/Applications/Orca.app/Contents/Resources/bin/orca';

/** The Orca CLI this run talks to. */
export const orcaCli = () => process.env.OBK_ORCA || BUILT_IN;

/**
 * Run one Orca command and give back its `result`.
 * Every call asks for `--json`; anything else would be text to guess at.
 */
export function orca(args) {
  const answer = ask(args);
  if (answer.ok !== true) {
    // Orca's own words: it knows what went wrong, and the caller is an LLM
    // that can act on them.
    throw new Error(`Orca refused ${args.join(' ')}: ${answer.error?.message ?? 'no reason given'}`);
  }
  return answer.result;
}

/** One Orca command, and the whole envelope back, refusals included. */
function ask(args) {
  const asked = spawnSync(orcaCli(), [...args, '--json'], { encoding: 'utf8' });
  if (asked.error) {
    throw new Error(`could not run Orca at ${orcaCli()}: ${asked.error.message}`);
  }

  const answer = parse(asked.stdout);
  if (answer === null || typeof answer !== 'object') {
    throw new Error(`Orca answered ${args.join(' ')} with something that is not JSON.`);
  }
  return answer;
}

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
 * kit reads the file and never writes it.
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
    profiles: profiles
      .map((name) => path.join(dir, name, 'orca-data.json'))
      .filter((file) => existsSync(file))
      .map((file) => ({ file, args: argsIn(file) })),
  };
}

/** What one profile file says about the agents' default arguments. */
function argsIn(file) {
  try {
    const settings = JSON.parse(readFileSync(file, 'utf8'))?.settings?.agentDefaultArgs;
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
 */
export const deleteProject = (setupId) => orca(['project', 'setup-delete', '--setup', setupId]);

/** Said after a run that made, renamed or removed a project, whatever `tellWindow` answered. */
export const RELOAD_LINE = "If Orca's sidebar does not show it, reload the window with Cmd+Shift+R.";

/** How long Orca's client waits for its runtime, and how long the kit waits for the client. */
const CLIENT_WAIT_MS = 2000;
const CLIENT_KILL_MS = 3000;

/**
 * Tell Orca's window that the project `projectId` changed, so it reads its
 * projects again: true when Orca's runtime took the call, false otherwise.
 *
 * Orca's window re-reads only when its runtime says the projects changed, and
 * `setup-update` and `setup-delete` do not say so. `project.update` with no
 * changes does, and Orca's CLI does not offer it, so this goes through Orca's
 * own runtime client out of the installed app, run by Orca's binary the way
 * its `bin/orca` runs its CLI (ADR 0021). None of that is Orca's published
 * interface, so anything that goes wrong is a quiet false: it never throws and
 * is never tried twice, and the caller prints `RELOAD_LINE` either way.
 */
export function tellWindow(projectId) {
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
      [WINDOW_SCRIPT, client, projectId, String(CLIENT_WAIT_MS)],
      { env, stdio: 'ignore', timeout: CLIENT_KILL_MS },
    );
    return asked.error === undefined && asked.status === 0;
  } catch {
    return false;
  }
}

const WINDOW_SCRIPT = fileURLToPath(new URL('./orca-window.cjs', import.meta.url));

/**
 * The live tabs of the Orca project at `home`, each under its own tab id.
 *
 * The listing gives a tab whose pane the window has not loaded as orphaned,
 * under `pty:<ptyId>` rather than its id, and a running harness puts a tab the
 * kit opened in that state within seconds. `terminal show` still answers with
 * the real id, so an orphaned entry is given that one: the tab id is the key
 * (PRD 6.2), and this is where Orca is asked for it (tech notes, section 1).
 */
export const tabs = (home) => orca(['terminal', 'list', '--worktree', `path:${home}`]).terminals
  .map((tab) => (tab.orphaned === true
    ? { ...tab, tabId: orca(['terminal', 'show', '--terminal', tab.handle]).terminal.tabId }
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
 * for the caller to deal with, not the kit.
 */
export function harnessInTab(handle, timeoutMs) {
  const args = ['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', String(timeoutMs)];
  const answer = ask(args);

  // Out of time means nothing went idle, busy or absent alike. That is an
  // answer, not a breakdown.
  if (answer.ok !== true && answer.error?.code !== 'timeout') {
    // With Orca's code on it, so a caller can tell a stale handle from the rest (#294).
    throw Object.assign(
      new Error(`Orca refused ${args.join(' ')}: ${answer.error?.message ?? 'no reason given'}`),
      { code: answer.error?.code },
    );
  }

  const shown = orca(['terminal', 'show', '--terminal', handle]).terminal;
  const agent = typeof shown?.agentIdentity === 'string' && shown.agentIdentity !== '' ? shown.agentIdentity : undefined;
  return {
    answered: answer.ok === true,
    blockedReason: answer.result?.wait?.blockedReason,
    agent,
    ...frontOf(shown?.ptyId),
  };
}

/**
 * Whether the kit may type a line into `tabId`, the tab the book holds for a
 * session in the Orca project at `home`, and the handle to type into when it
 * may: `{ handle, agent }`, with the agent Orca names there. Otherwise nothing
 * is typed, and the answer says why:
 * `{}` for a tab with no harness in it (none in the book, none Orca lists, or
 * the shell in front), `{ blocked }` for one with something on screen waiting
 * to be answered, and `{ unsure }`, a sentence, for one the kit cannot tell
 * about. Orca refusing throws, for the caller to report.
 *
 * The one gate for every line the kit types into a running session: the mail
 * nudge and the skills reload. A busy harness passes it, since both harnesses
 * take a typed line as their next turn.
 */
export function tabToTypeInto(home, tabId, timeoutMs) {
  if (tabId === undefined) return {};
  const live = tabs(home).find((tab) => tab.tabId === tabId);
  if (live === undefined) return {};

  const seen = harnessInTab(live.handle, timeoutMs);
  // A line typed into a screen waiting for an answer is that answer: once, it
  // confirmed Claude Code's folder-trust default, `No, exit` (tech notes,
  // section 1).
  if (seen.blockedReason !== undefined) return { blocked: seen.blockedReason };
  // The shell in front is a tab with no harness, whatever a stale
  // `agentIdentity` says.
  if (seen.front === 'shell') return {};
  // Not knowing is not a reason to type: a line that lands in a shell is run
  // there. The program in front has to be the agent Orca names. With no name
  // it may be a harness a few seconds into its launch; under another name it
  // may be a pager started after the harness quit, under an identity Orca has
  // not let go of (tech notes, section 1). A harness run through a wrapper such
  // as `node` lands here too, until #261.
  if (seen.front === undefined || seen.agent === undefined || seen.command !== seen.agent) {
    const why = seen.front === undefined
      ? seen.unreadable
      : `${seen.command} holds its terminal, and Orca names ${seen.agent ?? 'no agent'} in it`;
    return { unsure: `the kit could not tell whether a harness is running in it (${why}), so nothing was typed` };
  }
  return { handle: live.handle, agent: seen.agent };
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
  return frontOf(shown?.ptyId);
}

/** The `ps` this run reads. OBK_PS overrides it, as OBK_ORCA does Orca. */
const psCli = () => process.env.OBK_PS || '/bin/ps';

/**
 * Who holds the terminal of the pane `ptyId`: `{ front: 'shell' }`,
 * `{ front: 'program', command }` with the name of the process leading the
 * group in front, or `{ unreadable: <why> }`.
 *
 * Orca gives the pane's pid in `diagnostics memory` and nowhere else, and `ps`
 * gives that pid's terminal's foreground process group (ADR 0021).
 * On macOS the pane is `login` with the shell as its child, so the shell is in
 * front when the group is the pane's own or that of a child of a `login` pane.
 * `diagnostics memory` is a diagnostics command and may change, so everything
 * here ends in "cannot tell" rather than in an error or a guess.
 */
function frontOf(ptyId) {
  let pane;
  try {
    pane = orca(['diagnostics', 'memory']).worktrees
      .flatMap((worktree) => worktree.sessions ?? [])
      .find((session) => session.sessionId === ptyId)?.pid;
  } catch (error) {
    return { unreadable: `Orca would not give the pane's pid: ${error.message}` };
  }
  if (!Number.isInteger(pane) || pane <= 0) return { unreadable: 'Orca gave no pid for its pane' };

  const own = psLine(pane);
  if (own === undefined) return { unreadable: `ps could not read its pane, pid ${pane}` };
  if (own.tpgid === pane) return { front: 'shell' };

  const front = psLine(own.tpgid);
  if (front === undefined) return { unreadable: `ps could not read the process in front, pid ${own.tpgid}` };
  const shell = front.ppid === pane && path.basename(own.comm) === 'login';
  return shell ? { front: 'shell' } : { front: 'program', command: path.basename(front.comm) };
}

/** One process as `ps` gives it, read only: `{ ppid, tpgid, comm }`, or undefined. */
function psLine(pid) {
  const asked = spawnSync(psCli(), ['-o', 'pid=,ppid=,tpgid=,comm=', '-p', String(pid)], { encoding: 'utf8' });
  if (asked.error || asked.status !== 0) return undefined;
  const line = /^\s*(\d+)\s+(\d+)\s+(-?\d+)\s+(.+?)\s*$/.exec(asked.stdout);
  if (line === null) return undefined;
  return { ppid: Number(line[2]), tpgid: Number(line[3]), comm: line[4] };
}

/**
 * Close one tab, by the handle Orca issued for it.
 *
 * The only place in the kit that takes anything away, and it takes away one
 * tab: `--terminal <handle> --tab`. Orca's other form, `--worktree <sel> --all`,
 * closes every tab of a project with its layouts and resume records, which are
 * the user's work and not the kit's to end (tech notes, section 1).
 */
export const closeTab = (handle) =>
  orca(['terminal', 'close', '--terminal', handle, '--tab']).close;

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
 */
export function typeIntoTab(handle, text) {
  const args = ['terminal', 'send', '--terminal', handle, '--text', text, '--enter'];
  const answer = ask(args);
  if (answer.ok === true) return answer.result.send;

  const again = answer.error?.data?.orchestrationRequestId;
  if (answer.error?.code !== 'agent_prompt_blocked' || typeof again !== 'string') {
    throw new Error(`Orca refused ${args.join(' ')}: ${answer.error?.message ?? 'no reason given'}`);
  }
  return orca([...args, '--retry-request', again, '--wait-submit', String(SUBMIT_WAIT_S)]).send;
}

/** How long a re-issued line is given to be submitted before Orca gives up on it. */
const SUBMIT_WAIT_S = 5;

/**
 * A mailbox of one session's own: an Orca Run, which is a name and an inbox and
 * nothing else — it schedules nothing and runs nobody. The objective is what a
 * person sees in `orca orchestration run-list`, so it says whose it is.
 *
 * Bound to `handle`, the session's own tab, from the moment it is made. Orca
 * tells a Run's coordinator terminal about its mail and nobody else, and binds
 * the caller when no `--from` is given: the tab that ran `obk up` would be told
 * about every session it brought up, and would lose its own Run's binding, since
 * one terminal holds one Run (tech notes, section 1).
 */
export const makeMailbox = (objective, handle) =>
  orca(['orchestration', 'run-create', '--objective', `obk ${objective}`, '--from', handle]).run.id;

/**
 * Bind a mailbox to the terminal `handle`, which makes it the Run's coordinator
 * and its one reader: Orca refuses a `check` from any other terminal with
 * `consumer_fenced`. A read itself binds nothing, so this is for a session's own
 * live tab, never for whoever is reading (tech notes, section 1). Without a
 * handle it binds this process's own terminal.
 */
export const useMailbox = (id, handle) =>
  orca(['orchestration', 'run-use', '--id', id, ...(handle === undefined ? [] : ['--from', handle])]).run;

/**
 * The terminal a mailbox is bound to, or undefined when it has none. A closed
 * tab keeps its binding, and a read as its handle still works: a read binds
 * nothing, only `run-use` does (tech notes, section 1).
 */
export const coordinatorOf = (id) =>
  orca(['orchestration', 'run-show', '--id', id]).run.coordinator_handle ?? undefined;

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
export const readMailbox = (id, { peek = false, handle } = {}) =>
  orca(['orchestration', 'check', '--run', id, ...as(handle), ...(peek ? ['--peek'] : [])]);

/** Say a batch has been read. Orca answers with the batch after it. */
export const ackMailbox = (id, delivery, handle) =>
  orca(['orchestration', 'check', '--run', id, ...as(handle), '--ack', delivery]);

/** The reader of a `check`: the terminal named, or this process's own. */
const as = (handle) => (handle === undefined ? [] : ['--terminal', handle]);
