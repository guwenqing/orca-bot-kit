// A fake `kill` for the ordinary suite (#537). `OBK_KILL` points every
// sandboxed run at it, so `npm test` never sends a signal to anything: it
// writes the call down and changes the fake ps's process table
// (`processes` in state.json, helpers/fake-ps.js), and that is all.
//
// The kit stops what a retired session left running with
//
//   <kill> -s TERM -- -<pgid>     every process in one group
//   <kill> -s TERM -- <pid>       one process
//
// and the same with `-s KILL`. Any other shape is refused with exit 70, as the
// fake ps refuses one, and so is a target of 0 or 1 and their groups: `kill -1`
// signals every process of the user's, and that once happened here by
// accident (AGENTS.md, 2026-09-20). macOS /bin/kill answers:
//
//   exit 0                               the signal was sent
//   exit 1, `kill: <target>: No such process`
//                                        nothing by that id is there: already gone
//   exit 1, `kill: <target>: Operation not permitted`
//                                        it is there and may not be signalled
//
// What a signal does to an entry of the table, by what the test put on it:
//
//   left as it is      TERM and KILL each take it off the table: it has exited
//   ignoresTerm        TERM leaves it running; KILL takes it off
//   zombieOnTerm       TERM turns it into a zombie, stat 'Z', which its parent
//                      has not read yet; it stays in the table
//   unkillable         nothing takes it off, KILL included, as a process stuck
//                      in the kernel; the signal is still sent, exit 0
//   refuses            the signal may not be sent to it: Operation not
//                      permitted, as for a process the user may not signal
//   ghost              it is in the table, and gone by the time the signal
//                      comes: No such process, and it leaves the table
//   spawnsOnTerm       an entry `{ pid, cwd, command, ... }`: on its first TERM
//                      it starts that child, whose parent and group are its
//                      own unless the entry says otherwise, and the child
//                      joins the table. The child's own marks are its own
//   reusedAfterTerm    TERM ends it, and at once another process takes its
//                      pid: the entry's fields (`pgid`, `uid`, `cwd`,
//                      `command`, `startedAt`, ...) over the old process's,
//                      parent pid 1, none of the old one's marks, and a start
//                      time an hour after the old one's unless the entry
//                      gives one. A pid the system gave out again, which the
//                      kit must not take for the old one
//   commandOnTerm      a command line: on TERM the process takes it, as a
//                      program that renames itself, and keeps its pid and
//                      start time. With `ignoresTerm` it runs on under it
//
// A process that leaves the table leaves its children to pid 1, as the
// system does: their parent pid becomes 1. The fake ps can end a process too,
// by `exitsAtRead` (helpers/fake-ps.js).
//
// A process of another uid is one the user may not signal: Operation not
// permitted, as `refuses`. A group signal reaches every process in the group
// that may be signalled, and is refused only when none may.
//
// Every call, refused or not, is written to kill.log in the fake Orca's
// directory, `{ args, at, caller, tabs }` per line: `at` in ms since the
// epoch, `caller` the pid that ran this fake (the kit), and `tabs` the tab ids
// the fake Orca still had open at that moment, so a test can tell whether a
// session's tab was closed before anything was signalled.

import { appendFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { tableOf } from './fake-ps.js';

/** The signals the kit may send, by the name it gives `-s`. */
export const KILL_SIGNALS = ['TERM', 'KILL'];

/** Run as `kill`: write the call down, and change the fake table as the signal would. */
export function runKill() {
  const dir = process.env.OBK_FAKE_ORCA_DIR;
  if (dir === undefined) {
    process.stderr.write('fake kill: OBK_FAKE_ORCA_DIR is not set\n');
    process.exit(70);
  }
  const stateFile = path.join(dir, 'state.json');
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const args = process.argv.slice(2);
  appendFileSync(path.join(dir, 'kill.log'), `${JSON.stringify({
    args,
    at: Date.now(),
    caller: process.ppid,
    tabs: (state.terminals ?? []).map((terminal) => terminal.tabId),
  })}\n`);

  const shaped = args.length === 4 && args[0] === '-s' && KILL_SIGNALS.includes(args[1]) && args[2] === '--'
    && /^-?\d+$/.test(args[3]);
  if (!shaped) {
    process.stderr.write(`fake kill: ${args.join(' ')} is not a signal the kit may send; it sends -s TERM or -s KILL, then --, then one pid or one -pgid\n`);
    process.exit(70);
  }
  const target = args[3];
  const group = target.startsWith('-');
  const id = Number(group ? target.slice(1) : target);
  if (id <= 1) {
    process.stderr.write(`fake kill: ${target} reaches every process of the user's or the system's own; the kit never sends it\n`);
    process.exit(70);
  }

  const table = tableOf(state);
  const hits = table.filter((row) => (group ? row.pgid === id : row.pid === id));
  const ghosts = hits.filter((row) => row.entry.ghost === true);
  const there = hits.filter((row) => row.entry.ghost !== true);
  const save = () => {
    const next = `${stateFile}.kill.${process.pid}.tmp`;
    writeFileSync(next, `${JSON.stringify(state, null, 2)}\n`);
    renameSync(next, stateFile);
  };
  const drop = (rows) => {
    const gone = new Set(rows.map((row) => row.entry));
    const pids = new Set(rows.map((row) => row.pid));
    state.processes = (state.processes ?? []).filter((entry) => !gone.has(entry));
    for (const entry of state.processes) {
      if (pids.has(entry.ppid)) entry.ppid = 1;
    }
  };

  if (ghosts.length > 0) drop(ghosts);
  if (there.length === 0) {
    if (ghosts.length > 0) save();
    process.stderr.write(`kill: ${target}: No such process\n`);
    process.exit(1);
  }
  const allowed = there.filter((row) => row.entry.refuses !== true && row.uid === process.getuid());
  if (allowed.length === 0) {
    if (ghosts.length > 0) save();
    process.stderr.write(`kill: ${target}: Operation not permitted\n`);
    process.exit(1);
  }

  const exited = [];
  const reused = [];
  for (const row of allowed) {
    const { entry } = row;
    if (args[1] === 'TERM' && entry.commandOnTerm !== undefined) entry.command = entry.commandOnTerm;
    if (entry.unkillable === true || row.stat.startsWith('Z')) continue;
    if (args[1] === 'KILL') {
      exited.push(row);
      continue;
    }
    if (entry.zombieOnTerm === true) {
      entry.stat = 'Z';
      continue;
    }
    if (entry.spawnsOnTerm !== undefined && entry.spawned !== true) {
      entry.spawned = true;
      state.processes.push({ ppid: entry.pid, pgid: entry.pgid ?? entry.pid, ...entry.spawnsOnTerm });
    }
    if (entry.reusedAfterTerm !== undefined) {
      exited.push(row);
      reused.push({ pid: entry.pid, ppid: 1, startedAt: row.startedAt + 3600000, ...entry.reusedAfterTerm });
      continue;
    }
    if (entry.ignoresTerm !== true) exited.push(row);
  }
  drop(exited);
  state.processes.push(...reused);
  save();
  process.exit(0);
}
