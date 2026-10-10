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
  const mine = ownRun(table);
  const uid = process.getuid();
  const about = (pid) => ({ session: owner.get(pid), pid, cwd: cwds.get(pid) ?? null, command: table.get(pid).command });

  const left = [];
  const targets = new Map();
  for (const pid of owner.keys()) {
    if (mine.has(pid)) left.push({ ...about(pid), why: 'it is this retire\'s own run, or one that started it' });
    else if (table.get(pid).uid !== uid) left.push({ ...about(pid), why: 'it runs as another user' });
    else targets.set(pid, about(pid));
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
  const note = (one, sent, name, at) => {
    if (sent.refused !== undefined) refused.set(one.pid, { ...one, why: `kill refused ${name}: ${sent.refused}` });
    else {
      refused.delete(one.pid);
      tracked.set(one.pid, { ...one, signal: name, at });
    }
  };
  const begun = Date.now();
  const first = (pid, one) => ({ ...one, pgid: table.get(pid).pgid, started: table.get(pid).started });
  for (const pgid of whole) {
    const sent = signal('TERM', -pgid);
    for (const [pid, one] of targets) if (table.get(pid).pgid === pgid) note(first(pid, one), sent, 'SIGTERM', begun);
  }
  for (const [pid, one] of targets) if (!whole.has(table.get(pid).pgid)) note(first(pid, one), signal('TERM', pid), 'SIGTERM', begun);

  // Each process has TERM_WAIT_MS after its own SIGTERM to end, then SIGKILL,
  // then TERM_WAIT_MS more to be gone. A process a read shows one of them
  // started meanwhile is theirs as much as they are (R1): it is tracked from
  // that read, even after its parent has gone, and is given the same. One that
  // only joined a group signalled whole is not shown to be theirs, and is
  // named and never signalled (R2, review of PR #543). Both are looked for
  // until ADOPT_MS.
  // All of it ends by STOP_MS, and what still runs then is named. Where the
  // table can no longer be read, nothing more is sent: the kit cannot see
  // which pid is still theirs.
  const named = new Set(left.map((one) => one.pid));
  let lost;
  for (;;) {
    const read = processTable();
    if (read.unreadable !== undefined) {
      lost = read.unreadable;
      break;
    }
    const now = read.table;
    const at = Date.now();
    const live = (one) => !ended.has(one.pid) && now.get(one.pid)?.started === one.started;
    for (const one of tracked.values()) if (!live(one)) ended.add(one.pid);

    if (at - begun < ADOPT_MS) {
      const found = [...now].flatMap(([pid, seen]) => {
        if (tracked.has(pid) || refused.has(pid) || named.has(pid) || mine.has(pid) || seen.uid !== uid) return [];
        const parent = [...ancestorsOf(now, pid)].map((one) => tracked.get(one)).find((one) => one !== undefined && live(one));
        const mate = parent === undefined && whole.has(seen.pgid) ? [...tracked.values()].find((one) => one.pgid === seen.pgid) : undefined;
        return parent === undefined && mate === undefined ? [] : [{ pid, seen, parent, mate }];
      });
      // Their working folders, read once when there is someone new to name.
      const folders = found.length === 0 ? new Map() : workingFolders().cwds ?? new Map();
      for (const { pid, seen, parent, mate } of found) {
        const one = { pid, cwd: folders.get(pid) ?? null, command: seen.command };
        if (parent !== undefined) note({ session: parent.session, ...one, pgid: seen.pgid, started: seen.started }, signal('TERM', pid), 'SIGTERM', at);
        else {
          named.add(pid);
          left.push({ session: mate.session, ...one, why: `it joined process group ${seen.pgid} of ${mate.session}'s processes, and the kit cannot show it is ${mate.session}'s own` });
        }
      }
    }

    const running = [...tracked.values()].filter((one) => !refused.has(one.pid) && live(one));
    for (const one of running) {
      if (one.signal === 'SIGTERM' && at - one.at >= TERM_WAIT_MS) note({ ...one, command: now.get(one.pid).command }, signal('KILL', one.pid), 'SIGKILL', at);
    }
    const waiting = running.filter((one) => !refused.has(one.pid) && at - tracked.get(one.pid).at < TERM_WAIT_MS);
    if (running.length === 0 || waiting.length === 0 || at - begun >= STOP_MS) break;
    await delay(POLL_MS);
  }

  const stopped = [];
  for (const one of tracked.values()) {
    if (refused.has(one.pid)) continue;
    if (ended.has(one.pid)) stopped.push(shown(one));
    else {
      const why = lost === undefined ? `it still runs after ${one.signal}` : `the kit could not read the processes again after ${one.signal}, so it sent nothing more: ${lost}`;
      left.push(shown({ ...one, why }));
    }
  }
  return { stopped, left: [...left, ...[...refused.values()].map(shown)] };
}

/** A process as the answer gives it, without what the kit kept to know it again. */
const shown = ({ pgid: _, started: __, at: ___, signal, why, ...one }) => (why === undefined ? { ...one, signal } : { ...one, why });

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

/** The working folder of each of the user's processes, `cwds`: pid to folder, as `lsof` gives it. Or `{ unreadable: <why> }`. */
function workingFolders() {
  const asked = spawnSync(lsofCli(), ['-a', '-d', 'cwd', '-u', String(process.getuid()), '-Fpn'], { encoding: 'utf8', timeout: READ_MS, maxBuffer: 64 * 1024 * 1024 });
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
function processTable() {
  const asked = spawnSync(psCli(), ['-A', '-ww', '-o', 'pid=,ppid=,pgid=,uid=,stat=,lstart=,command='], { encoding: 'utf8', timeout: READ_MS, maxBuffer: 64 * 1024 * 1024 });
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
 * Send `SIG<name>` to `target`, a pid, or a process group as its negative.
 * `{}` when it was sent or the process was already gone, `{ refused: <why> }`
 * otherwise. Never to pid 1 or below, or to group 1 or 0: those are every
 * process of the user's (AGENTS.md, 2026-09-20).
 */
function signal(name, target) {
  if (!Number.isInteger(target) || Math.abs(target) <= 1) return { refused: `the kit does not signal ${target}` };
  const sent = spawnSync(killCli(), ['-s', name, '--', String(target)], { encoding: 'utf8', timeout: READ_MS });
  if (!sent.error && sent.status === 0) return {};
  if (/No such process/i.test(sent.stderr ?? '')) return {};
  return { refused: (sent.error?.message ?? sent.stderr ?? '').trim() || `kill exited ${sent.status}` };
}
