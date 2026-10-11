// What a retired session left running (#537).
//
// A session's harness runs at the bot home, and the commands it runs for its
// work run in its work dir: a test run, a build, a server. Closing its tab ends
// the harness, and what it started from there can run on with launchd as its
// parent, for hours. So a retire stops them, and `obk health` names any that
// still run in a retired session's work dir.
//
// The kit has no record of what a session started. A session's own processes
// are the user's processes whose working folder is in its work dir, and every
// process that descends from one of them, wherever it works, as a test run's
// throwaway folders do. Nothing else is stopped: a process that shares a
// process group with them and is not their own is named, with its pid, its
// working folder and its command, and so is anything the kit could not stop.
// The run that does the stopping, its callers and its own children are never
// stopped, nor a process of another user.
//
// `ps` gives the processes, `lsof` their working folders, and `kill` sends the
// signals: SIGTERM first, to the whole group where every process in it is the
// session's own, then up to 3 seconds for them to end, then SIGKILL to each
// that still runs. Inside Codex's sandbox `ps` does not start (#298), and then
// nothing is stopped and the answer says it cannot tell. OBK_PS, OBK_LSOF and
// OBK_KILL override the three, as OBK_ORCA does Orca, so the suite runs on
// fakes and sends no real signal.

import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { lsofCli, psCli } from './orca.js';

/** The `kill` this run sends signals with. OBK_KILL overrides it. */
const killCli = () => process.env.OBK_KILL || '/bin/kill';

/** How long one `ps`, `lsof` or `kill` may take. */
const READ_MS = 10_000;

/** How long the processes have to end after SIGTERM, before SIGKILL. */
const TERM_WAIT_MS = 3000;

/** How long after the first SIGTERM a new process of theirs is still looked for. */
const ADOPT_MS = 2 * TERM_WAIT_MS;

/** The end of the whole stop: the last one found has its own wait after SIGTERM, then after SIGKILL. */
const STOP_MS = ADOPT_MS + 2 * TERM_WAIT_MS;

/** How often the table is read again while they end. */
const POLL_MS = 100;

/**
 * Stop the processes the sessions in `dirs` left running: `dirs` is a list of
 * `{ session, dir }`, each a session and its work dir. Returns `{ stopped,
 * left }`: `stopped` holds `{ session, pid, cwd, command, signal }` for each
 * process that ended, with the signal it took; `left` holds `{ session, pid,
 * cwd, command, why }` for each that was named and not stopped. With
 * `unreadable: <why>` beside them, both empty, where the processes could not be
 * read, and then nothing was signalled.
 */
export async function stopProcesses(dirs) {
  const read = readProcesses();
  if (read.unreadable !== undefined) return { stopped: [], left: [], unreadable: read.unreadable };
  const { table, cwds } = read;

  const owner = ownersIn(table, cwds, dirs);
  const where = realDirs(dirs);
  const mine = ownRun(table);
  const uid = process.getuid();
  const about = (pid) => ({ session: owner.get(pid), pid, cwd: cwds.get(pid) ?? null, command: table.get(pid).command });

  const left = [];
  const targets = new Map();
  // The session's own that the kit names and does not signal, by pid with
  // when it started: what they start is the session's own too (R1, review
  // of PR #543).
  const kept = new Map();
  for (const pid of owner.keys()) {
    if (mine.has(pid)) left.push({ ...about(pid), why: 'it is this retire\'s own run, or one that started it' });
    else if (table.get(pid).uid !== uid) {
      left.push({ ...about(pid), why: 'it runs as another user' });
      kept.set(pid, { session: owner.get(pid), pid, started: table.get(pid).started });
    } else targets.set(pid, about(pid));
  }

  // A group is signalled whole only where every process in it is the
  // session's own. The others in a group with the session's processes are
  // named, and left as they are.
  const theirs = new Set([...targets.keys()].map((pid) => table.get(pid).pgid));
  const groups = new Map();
  for (const [pid, { pgid }] of table) if (theirs.has(pgid)) groups.set(pgid, [...(groups.get(pgid) ?? []), pid]);
  const whole = new Set();
  for (const [pgid, members] of groups) {
    const strangers = members.filter((pid) => !targets.has(pid));
    if (pgid > 1 && strangers.length === 0) whole.add(pgid);
    for (const pid of strangers) {
      if (owner.has(pid) || mine.has(pid)) continue;
      const session = owner.get(members.find((one) => targets.has(one)));
      left.push({ ...about(pid), session, why: `it shares process group ${pgid} with ${session}'s processes, and the kit cannot show it is ${session}'s own` });
    }
  }
  if (targets.size === 0) return { stopped: [], left };

  // Each process the kit signalled, by pid, with when it started: a pid that
  // later has another start time is another process, and the one signalled
  // has ended. A process can change its own command line; it cannot change
  // when it started.
  const tracked = new Map();
  const refused = new Map();
  const ended = new Set();
  const begun = Date.now();
  /** What is left of the stop, for a read or a signal to take. */
  const budget = () => begun + STOP_MS - Date.now();
  // Every signal is given only what is left of the stop: none once it is
  // spent, and a `kill` that does not return within it leaves the kit unable
  // to say whether that signal went, which the answer says (review of PR #543).
  const send = (name, target) => (budget() <= 0 ? { timeUp: true } : signal(name, target, budget()));
  // Each signal is timed once its `kill` has returned, so a slow one does not
  // eat into the wait it starts.
  const note = (one, sent, name) => {
    if (sent.timeUp) refused.set(one.pid, { ...one, why: `the stop's time ran out before its ${name}, so the kit sent it nothing more` });
    else if (sent.refused !== undefined) refused.set(one.pid, { ...one, why: `kill refused ${name}: ${sent.refused}` });
    else {
      refused.delete(one.pid);
      // `late`: its `kill` was cut off, so whether it went is not known.
      tracked.set(one.pid, { ...one, signal: name, at: Date.now(), late: sent.late === true });
    }
  };
  const first = (pid, one) => ({ ...one, pgid: table.get(pid).pgid, started: table.get(pid).started });
  for (const pgid of whole) {
    const sent = send('TERM', -pgid);
    for (const [pid, one] of targets) if (table.get(pid).pgid === pgid) note(first(pid, one), sent, 'SIGTERM');
  }
  for (const [pid, one] of targets) if (!whole.has(table.get(pid).pgid)) note(first(pid, one), send('TERM', pid), 'SIGTERM');

  // Each process has TERM_WAIT_MS after its own SIGTERM to end, then SIGKILL,
  // then TERM_WAIT_MS more to be gone. A process a read shows one of them
  // started meanwhile is theirs as much as they are (R1): it is tracked from
  // that read, even after its parent has gone, and is given the same, and so
  // is any new process whose working folder is in the work dir, so each read
  // reads the working folders too; one found after ADOPT_MS, or run by another
  // user, is named and sent nothing. One that only joined a group signalled
  // whole, and works elsewhere, is not shown to be theirs, and is named and
  // never signalled, whoever runs it (R2, review of PR #543).
  // All of it ends by STOP_MS: each read is given only what is left of it, and
  // the clock is asked again after each read and before each signal. Where
  // the table or the working folders can no longer be read, nothing more is
  // sent: the kit cannot see which pid is still theirs. A process a uid other
  // than the user's now runs is sent nothing more either.
  const named = new Set(left.map((one) => one.pid));
  let lost;
  // When the last read that worked was asked: it says nothing of a signal sent after it.
  let lastRead;
  for (;;) {
    const asked = Date.now();
    if (budget() <= 0) break;
    const read = processTable(budget());
    if (read.unreadable !== undefined) {
      lost = read.unreadable;
      break;
    }
    lastRead = asked;
    const now = read.table;
    const live = (one) => !ended.has(one.pid) && now.get(one.pid)?.started === one.started;
    for (const one of tracked.values()) if (!live(one)) ended.add(one.pid);

    // Every read looks at what is new, whatever the time: what it may still
    // signal waits on the deadline, what it has to name does not.
    // The retire's own run as it is now: the `ps` and `lsof` it starts for
    // each read work where it works, which can be the work dir.
    const ours = ownRun(now);
    const fresh = [...now].filter(([pid]) => !tracked.has(pid) && !refused.has(pid) && !named.has(pid) && !mine.has(pid) && !ours.has(pid));
    // A process whose working folder is in a work dir is that session's
    // own by R1, whatever its group and its parent (review of PR #543).
    let folders = new Map();
    if (fresh.length > 0) {
      const folderRead = workingFolders(budget());
      if (folderRead.unreadable !== undefined) {
        lost = folderRead.unreadable;
        break;
      }
      folders = folderRead.cwds;
    }
    const name = (session, one, why) => {
      named.add(one.pid);
      left.push({ session, ...one, why });
    };
    // One the session owns but the kit does not signal stays a parent for what it starts.
    const keep = (session, one, why, started) => {
      name(session, one, why);
      kept.set(one.pid, { session, pid: one.pid, started });
    };
    for (const [pid, seen] of fresh) {
      const one = { pid, cwd: folders.get(pid) ?? null, command: seen.command };
      const parent = [...ancestorsOf(now, pid)].map((it) => tracked.get(it) ?? kept.get(it)).find((it) => it !== undefined && live(it));
      const home = one.cwd === null ? undefined : where.find(({ real }) => inside(one.cwd, real));
      const theirs = parent ?? home;
      if (theirs !== undefined) {
        if (seen.uid !== uid) keep(theirs.session, one, 'it runs as another user, so the kit sends it nothing', seen.started);
        else if (Date.now() - begun >= ADOPT_MS) keep(theirs.session, one, 'it was found after the time for new processes ran out, so the kit sent it nothing', seen.started);
        else note({ session: theirs.session, ...one, pgid: seen.pgid, started: seen.started }, send('TERM', pid), 'SIGTERM');
      } else if (whole.has(seen.pgid)) {
        const mate = [...tracked.values()].find((it) => it.pgid === seen.pgid);
        name(mate.session, one, `it joined process group ${seen.pgid} of ${mate.session}'s processes, and the kit cannot show it is ${mate.session}'s own`);
      }
    }

    const running = [...tracked.values()].filter((one) => !refused.has(one.pid) && live(one));
    for (const one of running) {
      if (one.signal !== 'SIGTERM' || Date.now() - one.at < TERM_WAIT_MS) continue;
      const seen = now.get(one.pid);
      if (seen.uid !== uid) refused.set(one.pid, { ...one, why: 'it runs as another user now, so the kit sends it no SIGKILL' });
      else note({ ...one, command: seen.command }, send('KILL', one.pid), 'SIGKILL');
    }
    const waiting = running.filter((one) => !refused.has(one.pid) && Date.now() - tracked.get(one.pid).at < TERM_WAIT_MS);
    if (running.length === 0 || waiting.length === 0 || budget() <= 0) break;
    await delay(Math.max(0, Math.min(POLL_MS, budget())));
  }

  const stopped = [];
  for (const one of tracked.values()) {
    if (refused.has(one.pid)) continue;
    if (ended.has(one.pid)) stopped.push(shown(one));
    else {
      let why = `it still runs after ${one.signal}`;
      if (lost !== undefined) why = `the kit could not read the processes again after ${one.signal}, so it sent nothing more: ${lost}`;
      else if (lastRead === undefined || lastRead < one.at) why = `the kit could not confirm that its ${one.signal} went and that it ended: the stop's time ran out before a read after it`;
      // A cut-off kill is said whatever else is: both are true (review of PR #543).
      if (one.late) why = `the kit could not confirm that its ${one.signal} went, since kill did not answer in time; ${why}`;
      left.push(shown({ ...one, why }));
    }
  }
  return { stopped, left: [...left, ...[...refused.values()].map(shown)] };
}

/** A process as the answer gives it, without what the kit kept to know it again. */
const shown = ({ pgid: _, started: __, at: ___, late: ____, signal, why, ...one }) => (why === undefined ? { ...one, signal } : { ...one, why });

/**
 * The processes that run in the work dirs in `dirs`, a list of `{ session, dir
 * }`, read only: `{ running: [{ session, dir, pid, command }] }`, or `{
 * unreadable: <why> }`. Only the ones whose working folder is there, and never
 * this run or one that started it.
 */
export function processesIn(dirs) {
  const read = readProcesses();
  if (read.unreadable !== undefined) return { unreadable: read.unreadable };
  const mine = ownRun(read.table);
  const where = realDirs(dirs);
  const running = [];
  for (const [pid, cwd] of read.cwds) {
    const found = where.find(({ real }) => inside(cwd, real));
    if (found === undefined || mine.has(pid) || !read.table.has(pid)) continue;
    running.push({ session: found.session, dir: found.dir, pid, command: read.table.get(pid).command });
  }
  return { running };
}

/**
 * Every process `ps` lists, `table`: pid to `{ ppid, pgid, uid, command }`, a
 * zombie left out as one that has ended; and `cwds`: pid to the working folder
 * `lsof` gives, for the user's own processes. Or `{ unreadable: <why> }`.
 */
function readProcesses() {
  const listed = processTable();
  if (listed.unreadable !== undefined) return listed;
  const folders = workingFolders();
  return folders.unreadable !== undefined ? folders : { table: listed.table, cwds: folders.cwds };
}

/**
 * The working folder of each of the user's processes, `cwds`: pid to folder,
 * as `lsof` gives it. Or `{ unreadable: <why> }`. `ms` bounds the read below
 * READ_MS.
 */
function workingFolders(ms = READ_MS) {
  const asked = spawnSync(lsofCli(), ['-a', '-d', 'cwd', '-u', String(process.getuid()), '-Fpn'], { encoding: 'utf8', timeout: bound(ms), maxBuffer: 64 * 1024 * 1024 });
  if (asked.error?.code === 'ETIMEDOUT') return { unreadable: 'lsof did not answer in time' };
  if (asked.error || asked.status !== 0) return { unreadable: `lsof could not list the processes' working folders${because(asked)}` };
  const cwds = new Map();
  let pid;
  for (const line of asked.stdout.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && Number.isInteger(pid)) cwds.set(pid, line.slice(1));
  }
  return { cwds };
}

/**
 * The process table alone, as `readProcesses` gives it, with `started`, when
 * each process started as `ps` gives it, which with its pid is what tells one
 * process from another: a pid can be taken again, and a process can change its
 * own command line (review of PR #543). Or `{ unreadable: <why> }`.
 */
function processTable(ms = READ_MS) {
  const asked = spawnSync(psCli(), ['-A', '-ww', '-o', 'pid=,ppid=,pgid=,uid=,stat=,lstart=,command='], { encoding: 'utf8', timeout: bound(ms), maxBuffer: 64 * 1024 * 1024 });
  if (asked.error?.code === 'ETIMEDOUT') return { unreadable: 'ps did not answer in time' };
  if (asked.error || asked.status !== 0) return { unreadable: `ps could not read the process table${because(asked)}` };
  const table = new Map();
  for (const line of asked.stdout.split('\n')) {
    // lstart is five words: `Sat Oct 10 14:40:01 2026`.
    const read = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+\d+:\d+:\d+\s+\d+)(?:\s+(.*?))?\s*$/.exec(line);
    if (read === null || read[5].startsWith('Z')) continue;
    table.set(Number(read[1]), { ppid: Number(read[2]), pgid: Number(read[3]), uid: Number(read[4]), started: read[6].replace(/\s+/g, ' '), command: read[7] ?? '' });
  }
  if (table.size === 0) return { unreadable: 'ps listed no processes' };
  return { table };
}

/** A read's time limit: `ms`, but never more than READ_MS, and at least 1. */
const bound = (ms) => Math.max(1, Math.min(READ_MS, Math.floor(ms)));

/** What a failed call said for itself, as the end of a sentence. */
function because(asked) {
  const said = (asked.error?.message ?? asked.stderr ?? '').trim().split('\n')[0];
  return said === '' ? '' : ` (${said})`;
}

/** The session each of the processes in `dirs` belongs to: pid to session, by working folder and then by descent. */
function ownersIn(table, cwds, dirs) {
  const where = realDirs(dirs);
  const owner = new Map();
  for (const [pid, cwd] of cwds) {
    const found = where.find(({ real }) => inside(cwd, real));
    if (found !== undefined && table.has(pid)) owner.set(pid, found.session);
  }
  for (const pid of descendantsOf(table, [...owner.keys()])) {
    if (owner.has(pid)) continue;
    owner.set(pid, owner.get([...ancestorsOf(table, pid)].find((one) => owner.has(one))));
  }
  return owner;
}

/** This run, every process that started it, and every process it started: never stopped. */
function ownRun(table) {
  return new Set([process.pid, ...ancestorsOf(table, process.pid), ...descendantsOf(table, [process.pid])]);
}

/** The parent of `pid`, its parent's parent and on up, nearest first. */
function* ancestorsOf(table, pid) {
  const seen = new Set([pid]);
  for (let at = table.get(pid)?.ppid; at !== undefined && at > 0 && !seen.has(at); at = table.get(at)?.ppid) {
    seen.add(at);
    yield at;
  }
}

/** Every process below the ones in `pids`, at any depth. */
function descendantsOf(table, pids) {
  const children = new Map();
  for (const [pid, { ppid }] of table) children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  const found = new Set();
  const queue = [...pids];
  while (queue.length > 0) {
    for (const child of children.get(queue.shift()) ?? []) {
      if (found.has(child) || pids.includes(child)) continue;
      found.add(child);
      queue.push(child);
    }
  }
  return [...found];
}

/** The work dirs in `dirs` with their real paths, as `lsof` gives a working folder; one that is not there holds nothing. */
function realDirs(dirs) {
  return dirs.flatMap((one) => {
    try {
      return [{ ...one, real: realpathSync(one.dir) }];
    } catch {
      return [];
    }
  });
}

/** Whether the folder `cwd` is `dir` or inside it. */
const inside = (cwd, dir) => cwd === dir || cwd.startsWith(`${dir}${path.sep}`);

/**
 * Send `SIG<name>` to `target`, a pid, or a process group as its negative,
 * within `ms`. `{}` when it was sent or the process was already gone, `{
 * late: true }` when `kill` did not return in time, and `{ refused: <why> }`
 * otherwise. Never to pid 1 or below, or to group 1 or 0: those are every
 * process of the user's (AGENTS.md, 2026-09-20).
 */
function signal(name, target, ms = READ_MS) {
  if (!Number.isInteger(target) || Math.abs(target) <= 1) return { refused: `the kit does not signal ${target}` };
  const sent = spawnSync(killCli(), ['-s', name, '--', String(target)], { encoding: 'utf8', timeout: bound(ms) });
  // Cut off at its time: whether the signal went is not known.
  if (sent.error?.code === 'ETIMEDOUT') return { late: true };
  if (!sent.error && sent.status === 0) return {};
  if (/No such process/i.test(sent.stderr ?? '')) return {};
  return { refused: (sent.error?.message ?? sent.stderr ?? '').trim() || `kill exited ${sent.status}` };
}
