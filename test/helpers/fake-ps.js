// A fake `ps` for the ordinary suite. `OBK_PS` points every sandboxed run at
// it, so `npm test` never reads the machine's own process table.
//
// It answers the one question the kit may ask (#232): who is in front of an
// Orca tab's terminal. The kit reads the tab's pane pid out of `orca
// diagnostics memory` and asks, one pid per call,
//
//   <ps> -o pid=,ppid=,tpgid=,comm= -p <pid>
//
// and nothing else. Any other shape is refused here with exit 70, the way the
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
// shell one above that and the harness two above.
//
// What is in front of a tab is decided in this order:
//
//   - A tab nothing was launched in — no harness named by the first line typed
//     into it, like Bot Father's ops tab — has its shell in front, always.
//   - `foreground` in state.json, when a test set it, for every launched tab:
//       'harness'       login, shell, harness; the harness in front
//       'shell'         login, shell; the shell in front (the harness quit)
//       'bare-shell'    the pane is the shell itself, no login above it, and
//                       it is in front: tpgid is the pane's own pid
//       'bare-harness'  the pane is the shell itself and the harness, its
//                       child, is in front. A program, not the shell: only a
//                       `login` pane makes its child the shell
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

import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** The only argv the kit may hand `ps`, but for the pid on the end. */
export const PS_READ = ['-o', 'pid=,ppid=,tpgid=,comm=', '-p'];

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

/** Run as `ps`: read the fake Orca's world and answer for one pid. */
export function runPs() {
  const dir = process.env.OBK_FAKE_ORCA_DIR;
  if (dir === undefined) {
    process.stderr.write('fake ps: OBK_FAKE_ORCA_DIR is not set\n');
    process.exit(70);
  }

  const args = process.argv.slice(2);
  appendFileSync(path.join(dir, 'ps.log'), `${JSON.stringify({ args })}\n`);

  const read = args.length === PS_READ.length + 1
    && PS_READ.every((word, at) => args[at] === word)
    && /^[1-9]\d*$/.test(args[PS_READ.length]);
  if (!read) {
    process.stderr.write(`fake ps: ${args.join(' ')} is not a read of one pid; the kit asks ps nothing else\n`);
    process.exit(70);
  }
  const pid = Number(args[PS_READ.length]);

  const state = JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8'));
  for (const terminal of state.terminals ?? []) {
    if (pid === panePid(state, terminal) && foregroundOf(state, terminal, dir) === 'garbage') {
      process.stdout.write('ps: the table was busy; this is not a line of it\n');
      process.exit(0);
    }
    const found = processesOf(state, terminal, dir).find((one) => one.pid === pid);
    if (found !== undefined) {
      const column = (value) => String(value).padStart(5);
      process.stdout.write(`${column(found.pid)} ${column(found.ppid)} ${column(found.tpgid)} ${found.comm}\n`);
      process.exit(0);
    }
  }

  process.stderr.write(`ps: process id ${pid} not found\n`);
  process.exit(1);
}
