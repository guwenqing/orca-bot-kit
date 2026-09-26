// A fake `ps` for the ordinary suite. `OBK_PS` points every sandboxed run at
// it, so `npm test` never reads the machine's own process table.
//
// It answers the question the kit asks it most (#232): who is in front of an
// Orca tab's terminal. The kit reads the tab's pane pid out of `orca
// diagnostics memory` and asks, one pid per call,
//
//   <ps> -o pid=,ppid=,tpgid=,comm= -p <pid>
//
// and nothing else but the environment read further down (#318). Any other
// shape is refused here with exit 70, the way the
// fake Orca falls over on a close it must never be asked for: `ps` is a reader
// for the kit and never a road to a `kill` (AGENTS.md, 2026-09-20), and a call
// with other flags is a call that was not thought through. Every call, refused
// or not, is written to ps.log in the fake Orca's directory for a test to read.
//
// What a tab holds, measured live on Orca 1.4.209, Claude Code 2.1.281, Codex
// 0.156.1 (#232):
//
//   the pane       /usr/bin/login     the pid Orca's diagnostics give the pane
//   its shell      -/bin/zsh          parent: the pane
//   the harness    claude / codex     parent: the shell
//
// Every one of them answers with the same tpgid, the pid of whoever is in
// front: the shell at a prompt, the harness while it runs. One live line, the
// pane with its harness in front: `44701  1063 44812 /usr/bin/login`. A pid
// that is not there prints to stderr and exits 1.
//
// The pids are the fake's own: 40000 plus ten times the terminal's number, the
// shell one above that, and the program run from the shell two above.
//
// What is in front of a tab is decided in this order:
//
//   - A tab nothing was launched in — no harness named by the first line typed
//     into it, like Bot Father's ops tab — has its shell in front, always.
//   - `foreground` on one terminal in state.json, when a test set it, for
//     that tab alone: one of the words below. It comes before the one for
//     every tab, so one session's harness can quit beside a sibling's.
//   - `foreground` in state.json, when a test set it, for every launched tab:
//       'harness'       login, shell, harness; the harness in front
//       'shell'         login, shell; the shell in front (the harness quit)
//       'bare-shell'    the pane is the shell itself, no login above it, and
//                       it is in front: tpgid is the pane's own pid
//       'bare-harness'  the pane is the shell itself and the harness, its
//                       child, is in front. A program, not the shell: only a
//                       `login` pane makes its child the shell
//       'program'       login, shell, and `less` in front, the shell's child:
//                       the harness quit and the user ran something else.
//                       Seen live on Orca 1.4.209 with Codex 0.156.1 (PR
//                       #260): after /quit and `less /etc/hosts`, the tab's
//                       `agentIdentity` said `codex` for 20 s and `tui-idle`
//                       was ok and satisfied
//       'other-harness' login, shell, and in front the harness the tab was
//                       not launched with: `claude` in a Codex tab
//       'no-pid'        Orca's diagnostics list no pane for the tab
//       'ps-fails'      the pane's pid cannot be read: stderr, exit 1
//       'garbage'       the pane's pid reads back as text that is no ps line
//       'no-tpgid'      the pane has no terminal in front: tpgid 0
//       'gone'          the tpgid names a process that is no longer there
//   - Otherwise the tab is what `waitIdle` last found it to be. Time passes in
//     the fake only while `terminal wait` waits, so with a list of answers the
//     tab is as the latest wait left it, and as the first wait will find it
//     before any wait was made, counting from where the list was set, as
//     the fake Orca does. `false` and 'quit' are a shell in front; every
//     other answer is the harness.
//
// It answers one more question (#318): what one process of a tab carries in
// its environment, which says whether the kit's launch line started it. The
// kit asks, one pid per call,
//
//   <ps> -E -ww -o command= -p <pid>
//
// and macOS answers with one line: the command and its arguments, then each
// variable as a `NAME=value` word, all separated by spaces (tech notes,
// section 1, measured live on Orca 1.4.210, Claude Code 2.1.282, Codex
// 0.156.1). What each process of a tab carries:
//
//   - the pane and its shell: the variables Orca puts in every tab, ORCA_TAB_ID
//     among them, and none of the kit's.
//   - the program the shell started (the harness, or whatever is there in its
//     place), by `environment` on its terminal:
//       left out     what the tab's first typed line gave it, as the tab's shell
//                    would: Orca's variables, and with the kit's launch line
//                    `OBK_TAB_SHELL` (the pid of the shell it ran in) and
//                    `OBK_CLI`
//       'orca'       Orca resumed it by itself, as after a cold restore: `claude
//                    --resume <id>` or `codex resume <id>`, Orca's variables with
//                    ORCA_AGENT_LAUNCH_TOKEN, and none of the kit's
//       'other-tab'  as 'orca', with ORCA_TAB_ID naming another tab, whose id
//                    begins with this tab's own: only a whole word tells them
//                    apart
//       'no-tab-id'  the command alone and no variables, which is what ps
//                    gives for a process whose environment it may not read
//       'ps-fails'   the read fails: stderr, exit 1
//
// And one way it answers nothing at all (#298): `ps` in state.json set to
// 'not-permitted' is a `ps` that does not start, as inside Codex's
// `workspace-write` sandbox, where /bin/ps gave `Operation not permitted` and
// exit 126 on every pid, the caller's own included (seen live, codex-cli
// 0.156.1). Every call, of either shape, fails that way, and is still logged.
//
// What Orca's runtime says is in front of a tab (#298) is here too, since it
// reads the same tab: `runtimeViewOf` gives the `process` that
// `terminal.inspectProcess` answers for it, for the fake runtime client in
// helpers/cli.js (`orcaApp`). The shapes were seen live on Orca 1.4.212, but
// for the harness, which was read in Orca's code: a shell at its prompt is
// verdict `live` with `processName` and `foregroundProcess` null and no child;
// `less` is `foregroundProcess: "less"`, `processName` null, with children;
// a recognised harness is named in both. A front that only `ps` or Orca's
// diagnostics cannot read ('ps-fails', 'garbage', 'gone', 'no-tpgid',
// 'no-pid') is a tab holding the harness it was launched with, which the
// runtime sees.

import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** The argv the kit may hand `ps` to ask who is in front, but for the pid on the end. */
export const PS_READ = ['-o', 'pid=,ppid=,tpgid=,comm=', '-p'];

/** The argv the kit may hand `ps` to read one process's environment (#318), but for the pid on the end. */
export const PS_ENVIRONMENT = ['-E', '-ww', '-o', 'command=', '-p'];

/** The harness a tab was launched with: the first line typed into it names one, or none was. */
export function launchedIn(terminal) {
  const first = terminal.typed?.[0]?.text;
  return first === undefined ? undefined : /(?:^|\s)(claude|codex)(?=\s|$)/.exec(first)?.[1];
}

/** The number a terminal was made with: `term_7` is 7. */
function numberOf(state, terminal) {
  const n = /(\d+)$/.exec(terminal.handle ?? '')?.[1];
  return n === undefined ? 1000 + (state.terminals ?? []).indexOf(terminal) : Number(n);
}

/** The pid Orca's diagnostics give a tab's pane. */
export const panePid = (state, terminal) => 40000 + 10 * numberOf(state, terminal);

/** How many times `terminal wait` has been answered, from the fake Orca's own log. */
function waitsSoFar(dir) {
  let log = '';
  try {
    log = readFileSync(path.join(dir, 'calls.log'), 'utf8');
  } catch {
    return 0;
  }
  return log.split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line).args)
    .filter((args) => args[0] === 'terminal' && args[1] === 'wait')
    .length;
}

/** What is in front of a tab, as one of the words in the list above. */
export function foregroundOf(state, terminal, dir) {
  if (launchedIn(terminal) === undefined) return 'shell';
  if (terminal.foreground !== undefined) return terminal.foreground;
  if (state.foreground !== undefined) return state.foreground;
  const waits = waitsSoFar(dir) - (state.waitIdleFrom ?? 0);
  const idle = Array.isArray(state.waitIdle)
    ? state.waitIdle[Math.min(Math.max(waits - 1, 0), state.waitIdle.length - 1)]
    : state.waitIdle;
  return idle === false || idle === 'quit' ? 'shell' : 'harness';
}

/**
 * The processes of one tab, as `ps` would find them: { pid, ppid, tpgid, comm }.
 * A tab whose pane cannot be read has none.
 */
function processesOf(state, terminal, dir) {
  const pane = panePid(state, terminal);
  const shell = pane + 1;
  const harness = pane + 2;
  const program = launchedIn(terminal) ?? 'claude';
  const other = program === 'claude' ? 'codex' : 'claude';
  const orca = 1063;
  const row = (pid, ppid, tpgid, comm) => ({ pid, ppid, tpgid, comm });

  switch (foregroundOf(state, terminal, dir)) {
    case 'shell':
      return [row(pane, orca, shell, '/usr/bin/login'), row(shell, pane, shell, '-/bin/zsh')];
    case 'bare-shell':
      return [row(pane, orca, pane, '-/bin/zsh')];
    case 'bare-harness':
      return [row(pane, orca, harness, '-/bin/zsh'), row(harness, pane, harness, program)];
    case 'no-tpgid':
      return [row(pane, orca, 0, '/usr/bin/login'), row(shell, pane, 0, '-/bin/zsh')];
    case 'gone':
      return [row(pane, orca, harness, '/usr/bin/login'), row(shell, pane, harness, '-/bin/zsh')];
    case 'program':
      return [
        row(pane, orca, harness, '/usr/bin/login'),
        row(shell, pane, harness, '-/bin/zsh'),
        row(harness, shell, harness, 'less'),
      ];
    case 'other-harness':
      return [
        row(pane, orca, harness, '/usr/bin/login'),
        row(shell, pane, harness, '-/bin/zsh'),
        row(harness, shell, harness, other),
      ];
    case 'ps-fails':
      return [];
    default:
      return [
        row(pane, orca, harness, '/usr/bin/login'),
        row(shell, pane, harness, '-/bin/zsh'),
        row(harness, shell, harness, program),
      ];
  }
}

/**
 * What Orca's runtime answers as a tab's `process` to `terminal.inspectProcess`,
 * a verdict `live` for every front: see the list at the top. What is inside
 * `fence` is this fake's own; the kit has no use for it.
 */
export function runtimeViewOf(state, terminal, dir) {
  const program = launchedIn(terminal) ?? 'claude';
  const other = program === 'claude' ? 'codex' : 'claude';
  const live = (foregroundProcess, processName, hasChildProcesses) => ({
    foregroundProcess,
    hasChildProcesses,
    foregroundProcessEvidence: { verdict: 'live', processName, fence: { ptyId: terminal.ptyId ?? null } },
  });
  switch (foregroundOf(state, terminal, dir)) {
    case 'shell':
    case 'bare-shell':
      return live(null, null, false);
    case 'program':
      return live('less', null, true);
    case 'other-harness':
      return live(other, other, true);
    default:
      return live(program, program, true);
  }
}

/** A conversation id of the shape both harnesses use, for a harness Orca resumed. */
const RESUMED = '0199b2c0-0318-4444-8888-cccccccccccc';

/** What every process of the user's carries, whoever started it. */
const USERS = ['TERM=xterm-256color', 'SHELL=/bin/zsh', 'HOME=/Users/someone', 'LANG=en_US.UTF-8', 'PATH=/usr/bin:/bin:/usr/sbin:/sbin'];

/** What Orca puts in the environment of everything in a tab (tech notes, section 1). */
const orcaVariables = (terminal, tabId = terminal.tabId) => [
  `ORCA_PANE_KEY=${terminal.handle}:0`,
  `ORCA_TAB_ID=${tabId}`,
  `ORCA_TERMINAL_HANDLE=${terminal.handle}`,
  `ORCA_WORKTREE_ID=${terminal.worktreeId ?? 'wt_1'}`,
  'ORCA_AGENT_HOOK_PORT=51234',
  'ORCA_AGENT_HOOK_TOKEN=hook-token',
];

/**
 * What `ps -E` prints for one process of a tab: its command and arguments, then
 * its variables, or undefined when the read fails. Only the program the shell
 * started carries anything of the kit's; see the list at the top.
 */
function environmentOf(state, terminal, row) {
  const harness = panePid(state, terminal) + 2;
  if (row.pid !== harness) return [row.comm, ...USERS.slice(0, 2), ...orcaVariables(terminal), ...USERS.slice(2)].join(' ');

  const program = row.comm;
  const typed = terminal.typed?.[0]?.text ?? '';
  const resumed = program === 'codex' ? `codex resume ${RESUMED}` : `${program} --resume ${RESUMED}`;
  switch (terminal.environment) {
    case 'ps-fails':
      return undefined;
    case 'no-tab-id':
      return resumed;
    case 'orca':
    case 'other-tab':
      return [
        resumed,
        ...USERS.slice(0, 2),
        ...orcaVariables(terminal, terminal.environment === 'other-tab' ? `${terminal.tabId}0` : terminal.tabId),
        'ORCA_AGENT_LAUNCH_TOKEN=launch-token',
        ...USERS.slice(2),
      ].join(' ');
    default: {
      // The arguments the line gave the program, as ps shows them: unquoted.
      const at = typed.search(new RegExp(`(?:^|\\s)${program}(?=\\s|$)`));
      const command = at < 0 ? program : typed.slice(at).trim().replaceAll("'\\''", "'").replaceAll("'", '');
      const cli = /(?:^|\s)OBK_CLI=('(?:[^']|'\\'')*'|\S+)/.exec(typed)?.[1];
      const kits = [
        ...(typed.includes('OBK_TAB_SHELL=$$') ? [`OBK_TAB_SHELL=${row.ppid}`] : []),
        ...(cli === undefined ? [] : [`OBK_CLI=${cli.replaceAll("'\\''", "'").replace(/^'(.*)'$/, '$1')}`]),
      ];
      return [command, ...USERS.slice(0, 2), ...orcaVariables(terminal), ...kits, ...USERS.slice(2)].join(' ');
    }
  }
}

/** Run as `ps`: read the fake Orca's world and answer for one pid. */
export function runPs() {
  const dir = process.env.OBK_FAKE_ORCA_DIR;
  if (dir === undefined) {
    process.stderr.write('fake ps: OBK_FAKE_ORCA_DIR is not set\n');
    process.exit(70);
  }

  const args = process.argv.slice(2);
  appendFileSync(path.join(dir, 'ps.log'), `${JSON.stringify({ args })}\n`);

  const state = JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8'));
  if (state.ps === 'not-permitted') {
    process.stderr.write(`${process.argv[1]}: Operation not permitted\n`);
    process.exit(126);
  }

  const asks = (shape) => args.length === shape.length + 1
    && shape.every((word, at) => args[at] === word)
    && /^[1-9]\d*$/.test(args[shape.length]);
  const read = asks(PS_READ);
  const environment = asks(PS_ENVIRONMENT);
  if (!read && !environment) {
    process.stderr.write(`fake ps: ${args.join(' ')} is not a read of one pid; the kit asks ps nothing else\n`);
    process.exit(70);
  }
  const pid = Number(args.at(-1));

  for (const terminal of state.terminals ?? []) {
    if (read && pid === panePid(state, terminal) && foregroundOf(state, terminal, dir) === 'garbage') {
      process.stdout.write('ps: the table was busy; this is not a line of it\n');
      process.exit(0);
    }
    const found = processesOf(state, terminal, dir).find((one) => one.pid === pid);
    if (found !== undefined && environment) {
      const line = environmentOf(state, terminal, found);
      if (line === undefined) {
        process.stderr.write(`ps: cannot read the environment of process ${pid}\n`);
        process.exit(1);
      }
      process.stdout.write(`${line}\n`);
      process.exit(0);
    }
    if (found !== undefined) {
      const column = (value) => String(value).padStart(5);
      process.stdout.write(`${column(found.pid)} ${column(found.ppid)} ${column(found.tpgid)} ${found.comm}\n`);
      process.exit(0);
    }
  }

  process.stderr.write(`ps: process id ${pid} not found\n`);
  process.exit(1);
}
