// Every call the kit makes to Orca goes through here (ADR 0001). Orca's CLI
// changes often, so the kit reads `--json` and never the human text, and keeps
// the parsing in one place.
//
// A word on words: Orca calls every workspace a "worktree", a plain folder
// included. Nothing the user reads may say that, or they will think a git
// worktree was made. Say "Orca project". The word belongs only in the selector
// handed to Orca on the command line.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

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
 * Whether a TUI is running in the tab, and what it is waiting on if Orca says.
 *
 * `tui-idle` asks about a TUI, not about a shell: a tab sitting at a shell
 * prompt is refused with `timeout` however long you wait, a TUI that is up
 * answers `ok:true`, and `satisfied` only tells idle from busy. So this is the
 * way to learn whether a harness actually started — and `blockedReason` is
 * Orca saying something on screen wants answering, which is for the caller to
 * deal with, not the kit.
 */
export function tuiInTab(handle, timeoutMs) {
  const args = ['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', String(timeoutMs)];
  const answer = ask(args);

  if (answer.ok !== true) {
    // Out of time means no TUI came up. That is an answer, not a breakdown.
    if (answer.error?.code === 'timeout') return { running: false };
    throw new Error(`Orca refused ${args.join(' ')}: ${answer.error?.message ?? 'no reason given'}`);
  }
  return { running: true, blockedReason: answer.result?.wait?.blockedReason };
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
 * Take a turn at reading a mailbox, as the terminal `handle`.
 *
 * Orca fences a Run to one reader: a `check` from a terminal bound elsewhere is
 * refused with `consumer_fenced`, whatever the Run says. So a read binds first,
 * every time — the kit's runs are short and the binding is the last one to have
 * asked, not a lease anybody has to give back. Without a handle it binds this
 * process's own terminal.
 */
export const useMailbox = (id, handle) =>
  orca(['orchestration', 'run-use', '--id', id, ...(handle === undefined ? [] : ['--from', handle])]).run;

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

/** Say a batch has been read, so the next check brings the one after it. */
export const ackMailbox = (id, delivery, handle) =>
  orca(['orchestration', 'check', '--run', id, ...as(handle), '--ack', delivery]);

/** The reader of a `check`: the terminal named, or this process's own. */
const as = (handle) => (handle === undefined ? [] : ['--terminal', handle]);
