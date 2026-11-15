// A fake `ps` for the ordinary suite. helpers/fake-tools.js sends every
// sandboxed run's /bin/ps to it (OBK_TEST_PS), so `npm test` never reads the
// machine's own process table.
//
// It answers the question the kit asks it most (#232): who is in front of an
// Orca tab's terminal. The kit reads the tab's pane pid out of `orca
// diagnostics memory` and asks, one pid per call,
//
//   <ps> -o pid=,ppid=,tpgid=,comm= -p <pid>
//
// and nothing else but the environment, table and start-time reads further
// down (#318, #537, #755). Any other shape is refused here with exit 70, the way the
// fake Orca falls over on a close it must never be asked for: `ps` is a reader
// for the kit and never a road to a `kill` (AGENTS.md, 2026-09-20), and a call
// with other flags is a call that was not thought through. Every call, refused
// or not, is written to ps.log in the fake Orca's directory for a test to read,
// `{ args, at }` per line, `at` in ms since the epoch when it was asked.
//
// What a tab holds, measured live on Orca 1.4.209, Claude Code 2.1.281, Codex
// 0.156.1 (#232):
//
//   the pane       /usr/bin/login     the pid Orca's diagnostics give the pane
//   its shell      -/bin/zsh          parent: the pane
//   the harness    claude / codex     parent: the shell
//
// A Pi tab (#634) holds `pi` there: Pi renames its process, and `ps` shows
// command `pi` with no arguments (seen live, Orca 1.4.225 and Pi 1.1.0; tech
// notes, section 6). What `ps -E` shows of a renamed process's environment was
// not seen: the fake gives it the variables a launched harness has.
//
// Every one of them answers with the same tpgid, the pid of whoever is in
// front: the shell at a prompt, the harness while it runs. One live line, the
// pane with its harness in front: `44701  1063 44812 /usr/bin/login`. A pid
// that is not there prints nothing at all, on stdout or stderr, and exits 1:
// measured on macOS 27.0.1, `/bin/ps -o pid=,ppid=,tpgid=,comm= -p 99999`
// exits 1 with stdout and stderr both empty (the developer of #700,
// 2026-10-25). Apple's ps also exits 1 on an error of its own, with a message
// on stderr (`errx(1, "malloc failed")`, adv_cmds ps/ps.c), so exit 1 alone
// does not say a pid is gone (review of PR #702).
//
// `psErrors` in state.json, when a test set it, makes that error: an object
// keyed by pid, each value a line of text. A read of one of those pids, in the
// shape above, writes the text to stderr and exits 1 with nothing on stdout,
// whether or not the fake knows the pid.
//
// The pids are the fake's own: 40000 plus ten times the terminal's number, the
// shell one above that, and the program run from the shell two above.
//
// What is in front of a tab is decided in this order:
//
//   - A tab nothing was launched in — no harness named by the first line typed
//     into it, like Bot Father's ops tab — has its shell in front, unless
//     `front` under its entry in `byName` (below) says otherwise: one of the
//     words below, for the shell a tab opens with before the kit types into
//     it (#498). 'program' there is `less` in front, as any program the
//     shell's start-up ran would be.
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
//       'node-harness'  login, shell, and in front the harness the tab was
//                       launched with, installed through npm, so it runs as
//                       `node` (#261): the shell's child, as `harness` is
//       'node-child'    login, shell, the harness the tab was launched with,
//                       and in front a `node` program the harness started:
//                       the harness's child, not the shell's (#261)
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
//   - a program the user ran from the shell after the harness quit (`less`,
//     'program') or the harness the tab was not launched with
//     ('other-harness'): the shell's variables, Orca's, and none of the kit's,
//     which the launch line gave the harness alone (#261).
//   - a program the harness started ('node-child'): everything the harness
//     carries, the kit's `OBK_TAB_SHELL` included, though its parent is the
//     harness and not that shell (#261).
//   - the program the shell started (the harness, as `claude`, `codex` or
//     `node`), by `environment` on its terminal:
//       left out     what the tab's first typed line gave it, as the tab's shell
//                    would: Orca's variables, and with the kit's launch line
//                    `OBK_TAB_SHELL` (the pid of the shell it ran in) and
//                    `OBK_CLI`
//       'launched-other-tab'  as left out, the kit's variables and all, with
//                    ORCA_TAB_ID naming another tab, whose id begins with
//                    this tab's own (#261)
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
// And it can be slow (#498): `psDelayMs` in state.json holds every answer back
// that long, after the call is written to ps.log. A delay longer than the test
// is a `ps` that never answers.
//
// It answers a third question (#537): the whole process table, which the kit
// reads when it retires a session, to find what the session left running. The
// kit asks, once per look,
//
//   <ps> -A -ww -o pid=,ppid=,pgid=,uid=,stat=,lstart=,command=
//
// and gets one line per process: pid, parent pid, process group, uid, state,
// the time it started, then the whole command line, spaces and all. The start
// time is in `ps`'s own form, `Www Mmm d HH:MM:SS YYYY`, with a space before a
// one-digit day. One real line, on this machine (#537):
//
//       1     0     1     0 Rs   Fri Oct  9 14:26:20 2026     /sbin/launchd
//
// A pid with its start time is one process: the system can give a pid out
// again, never with the same start time. A state that starts with `Z` is a
// zombie: it has exited and only waits for its parent to read its status. The
// table is `processes` in state.json, which a test sets, and after it the fake
// ps's own process, as a real `ps -A` always lists itself, so the table is
// never empty. The tabs' own processes above are not in it. Left unset, the
// table holds the fake ps alone: nothing sits in a work dir, and a retire stops
// nothing. The fake ps's own row is its real pid and its parent's, the kit's,
// with a group of its own and no working folder from lsof; the kit's own group
// is not known here, so that much is made up. Each entry is
//
//   { pid, ppid, pgid, uid, stat, startedAt, command, cwd, ...how it takes a signal }
//
// with `uid` the user's own (`process.getuid()`) and `stat` 'S' when left out.
// `startedAt` is the start time in ms since the epoch, printed in UTC; left
// out, it is a time on 2026-10-10 that the pid gives, the same at every read.
// `appearsAfterMs: n` on an entry keeps the process out of the table, out of
// lsof's records and out of the fake kill's reach until n ms after the first
// signal the fake kill was asked for: a process started during the wait.
// `appearsAfterReads: n` does the same until the nth read of the table after
// the first signal (1 is the first read after it), and `exitsAfterReads: n`
// ends the process just before that read, as `exitsAtRead` does, counting
// from the first signal: steps of the wait tied to the kit's own reads.
// `appearsAfterKillOf: n` does the same until the fake kill has been asked
// for a KILL to pid n by its own pid (`-s KILL -- n`, in kill.log): a process
// started only once the kit has sent that KILL, tied to the kit's own signal
// and not to a clock, so a slow run cannot show it before that KILL.
// `exitsAtRead: n` on an entry ends that process just before the nth read of
// the table (1 is the first, the reads counted from ps.log): from that read on
// it is not in the table, and its children's parent pid is 1, as the system
// gives an orphan to launchd.
// `cwd` is what the fake lsof gives as its working folder (helpers/fake-tty.js);
// left out, lsof names none. How it takes a signal is the fake kill's
// (helpers/fake-kill.js). `pid`, `ppid` or `pgid` may be the word 'kit': the
// pid of the process that runs this fake, which is the kit's own run, since
// the kit starts `ps`, `lsof` and `kill` as its own children. So a table can
// list the retire itself, in a work dir, under the process that started it.
//
// It answers a fourth question (#755): when one process started. Claude Code
// writes that time into its registry entry as `procStart`, and health compares
// it with the live process's, so an entry left by an older process that had
// the same pid does not count. Claude Code 2.1.325 asks it this way, one pid
// per call, with TZ=UTC and LC_ALL=C in the environment, when it writes
// procStart (read in its binary); a test asks it so to see what Claude Code
// wrote (the kit itself reads the elapsed time below),
//
//   <ps> -o lstart= -p <pid>
//
// and gets one line: the start time in `ps`'s own form, `Wed Nov 11 20:27:58
// 2026`, with a space before a one-digit day, as in the table above. The real
// `ps` prints it in the local time zone, which TZ sets: the same process read
// `Wed Nov 11 15:27:58 2026` with TZ unset (EST) and `Wed Nov 11 20:27:58 2026`
// with TZ=UTC, on this machine. The fake prints it in the zone TZ names when TZ
// is set and not empty, and in UTC when it is not, so a run is the same on
// every machine. The day and month names follow LC_ALL as `ps` follows the
// locale: those of the locale it names (`de_DE.UTF-8` gives German names),
// and the C locale's, `Wed Nov`, when it is not set or is C or POSIX. It knows the tab's processes above, for the front a tab has
// now, and the table's processes (their `startedAt`). A tab process's start
// time is `psStarts` in state.json, an object keyed by pid, each value ms since
// the epoch; left out, it is a time on 2026-10-10 that the pid gives, as for
// the table (`tabStartOf` gives it to a test). A value of `null` there is a
// `ps` that prints an empty line and exits 0. A pid the fake does not know
// prints nothing and exits 1, as the first read does. `psStartErrors` in
// state.json, an object keyed by pid, each value a line of text, makes this
// read of that pid fail: the text on stderr, nothing on stdout, exit 1,
// whether or not the fake knows the pid. `psErrors` does not touch this read.
//
// It answers the same question a second way (#755): how long ago one process
// started. The kit asks, one pid per call, with no environment of its own,
//
//   <ps> -o etime= -p <pid>
//
// and gets one line: the time from that same start (`psStarts`, the default,
// or `startedAt`) to now, by the fake's own clock, in `[[dd-]hh:]mm:ss`, with
// the whole seconds truncated. Measured on macOS 27.0.1, 2026-11-14: `00:00`
// for a shell just started, `03:16:21` past an hour, `01-07:04:43` and
// `22-06:14:10` past a day, the days two digits at least, and nothing before
// or after but the newline. It is digits alone, so TZ and the locale do not
// change it: `22-06:14:10` both with TZ and LC_ALL unset and with
// TZ=Asia/Shanghai LC_ALL=fr_FR.UTF-8, where lstart read `sam. 24 oct.
// 00:15:30 2026`. `null`, `psStartErrors` and a pid the fake does not know
// answer as for lstart above. A start after now is a test that chose its time
// wrong, since the real ps cannot be asked about a process that has not
// started: the fake says so on stderr and exits 70.
//
// And one way it answers nothing at all (#298): `ps` in state.json set to
// 'not-permitted' is a `ps` that does not start, as inside Codex's
// `workspace-write` sandbox, where /bin/ps gave `Operation not permitted` and
// exit 126 on every pid, the caller's own included (seen live, codex-cli
// 0.156.1). Every call, of every shape, fails that way, and is still logged.
// 'fails-after-kill' answers as usual until the fake kill (helpers/fake-kill.js)
// has been called once, and from then on fails every call that same way: a
// table that could be read before a signal and not after it.
//
// `psDelayAfterKillMs` holds each read of the table back that long, but only
// once the fake kill has been called: a read made slow during the wait. Each
// read of the table that is answered is also written to ps-table.log, `{ at,
// done }` per line, ms since the epoch: when it was asked and when it was
// answered. A read the kit gave up on and killed is not there.
//
// What Orca's runtime says is in front of a tab (#298) is here too, since it
// reads the same tab: `runtimeViewOf` gives the `process` that
// `terminal.inspectProcess` answers for it, for the fake runtime client in
// helpers/cli.js (`orcaApp`). The shapes were seen live on Orca 1.4.212, but
// for the harness, which was read in Orca's code: a shell at its prompt is
// verdict `live` with `processName` and `foregroundProcess` null and no child;
// `less` is `foregroundProcess: "less"`, `processName` null, with children;
// a recognised harness is named in both; a `node` program, the harness
// installed through npm among them, is `foregroundProcess: "node"`,
// `processName` null, as front-without-ps.test.js has it. A front that only `ps` or Orca's
// diagnostics cannot read ('ps-fails', 'garbage', 'gone', 'no-tpgid',
// 'no-pid') is a tab holding the harness it was launched with, which the
// runtime sees.

// And one more (#768): the command line of a process outside Orca's tabs,
// which the kit's SessionStart hook reads to see whether its harness was
// launched with the appended system text. The harness stand-ins of
// helpers/cli.js (`recordSession`, `throughATab`) are real processes; each
// writes its pid and the words its launch line gave it to ps-args.log in the
// fake Orca's directory, `{ pid, command }` per line, and carries the same
// words in its own argv, so a bare `ps` sees them too. For such a pid this
// fake answers, with the command and its arguments on one line, any of
//
//   <ps> [-w|-ww] -o command= -p <pid>      (or -o args=, or -wwo …)
//
// and the one environment read above, `-E -ww -o command= -p <pid>`, which
// adds the variables a launched harness carries. No other `-E` shape: the
// environment read stays the one the kit may make (test/orca-fake.test.js). For a tab's own
// process it gives the command part of what `ps -E` gives above. A pid it
// knows neither way: nothing, exit 1.

import { appendFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** The argv the kit may hand `ps` to ask who is in front, but for the pid on the end. */
export const PS_READ = ['-o', 'pid=,ppid=,tpgid=,comm=', '-p'];

/** The argv the kit may hand `ps` to read one process's environment (#318), but for the pid on the end. */
export const PS_ENVIRONMENT = ['-E', '-ww', '-o', 'command=', '-p'];

/** The argv the kit may hand `ps` to read the whole process table (#537). */
export const PS_TABLE = ['-A', '-ww', '-o', 'pid=,ppid=,pgid=,uid=,stat=,lstart=,command='];

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A start time as `ps -o lstart=` prints it, `Sat Oct 10 08:00:00 2026`, from ms since the epoch, in UTC. */
export function lstartOf(ms) {
  const at = new Date(ms);
  const two = (n) => String(n).padStart(2, '0');
  return `${DAYS[at.getUTCDay()]} ${MONTHS[at.getUTCMonth()]} ${String(at.getUTCDate()).padStart(2, ' ')} `
    + `${two(at.getUTCHours())}:${two(at.getUTCMinutes())}:${two(at.getUTCSeconds())} ${at.getUTCFullYear()}`;
}

/** The argv the kit may hand `ps` to read when one process started (#755), but for the pid on the end. */
export const PS_START = ['-o', 'lstart=', '-p'];

/** The argv the kit may hand `ps` to read how long ago one process started (#755), but for the pid on the end. */
export const PS_ELAPSED = ['-o', 'etime=', '-p'];

/**
 * A time since a start as `ps -o etime=` prints it, `[[dd-]hh:]mm:ss`, from
 * ms: whole seconds, truncated; the hours only past an hour, the days only
 * past a day, and the days two digits at least.
 */
export function etimeOf(ms) {
  const all = Math.floor(ms / 1000);
  const two = (n) => String(n).padStart(2, '0');
  const days = Math.floor(all / 86400);
  const hours = Math.floor((all % 86400) / 3600);
  const clock = `${two(Math.floor((all % 3600) / 60))}:${two(all % 60)}`;
  if (days > 0) return `${two(days)}-${two(hours)}:${clock}`;
  if (hours > 0) return `${two(hours)}:${clock}`;
  return clock;
}

/**
 * A start time as `ps -o lstart=` prints it (#755): in the zone TZ names, or in
 * UTC when TZ is not set; with the day and month names of the locale LC_ALL
 * names, or the C locale's when LC_ALL is not set or is C or POSIX.
 */
function lstartInZone(ms) {
  const zone = process.env.TZ === undefined || process.env.TZ === '' ? 'UTC' : process.env.TZ;
  const locale = process.env.LC_ALL;
  const c = locale === undefined || locale === '' || locale === 'C' || locale === 'POSIX';
  const tag = c ? 'en-US' : locale.replace(/\..*$/, '').replace('_', '-');
  let parts;
  try {
    parts = new Intl.DateTimeFormat(tag, {
      timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(ms));
  } catch {
    // A zone or a locale Intl does not know: UTC and C, as Node falls back.
    return lstartOf(ms);
  }
  const part = (type) => parts.find((one) => one.type === type)?.value ?? '';
  return `${part('weekday')} ${part('month')} ${part('day').padStart(2, ' ')} ${part('hour')}:${part('minute')}:${part('second')} ${part('year')}`;
}

/** The start time of an entry that gives none: 2026-10-10 08:00:00 UTC, plus one second for each pid mod 3600. */
const defaultStart = (pid) => Date.UTC(2026, 9, 10, 8, 0, 0) + (Number(pid) % 3600) * 1000;

/**
 * When a tab's process `pid` started, in ms since the epoch, as the fake ps
 * answers `-o lstart= -p <pid>` for it: `psStarts[pid]` in state.json, or the
 * pid's default. `null` is what a test set for a ps that prints nothing.
 */
export const tabStartOf = (state, pid) => (Object.hasOwn(state.psStarts ?? {}, String(pid)) ? state.psStarts[String(pid)] : defaultStart(pid));

/** When the fake kill was first called, in ms since the epoch, or undefined before that. */
function firstSignalAt() {
  const dir = process.env.OBK_FAKE_ORCA_DIR;
  try {
    const first = readFileSync(path.join(dir, 'kill.log'), 'utf8').split('\n').find((line) => line !== '');
    return first === undefined ? undefined : JSON.parse(first).at;
  } catch {
    return undefined;
  }
}

/** How many reads of the table were made since the first signal, ps.log's `at` against kill.log's. */
function readsSinceSignal() {
  const at = firstSignalAt();
  if (at === undefined) return 0;
  try {
    return readFileSync(path.join(process.env.OBK_FAKE_ORCA_DIR, 'ps.log'), 'utf8').split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line))
      .filter((call) => JSON.stringify(call.args) === JSON.stringify(PS_TABLE) && call.at >= at)
      .length;
  } catch {
    return 0;
  }
}

/** Whether the fake kill has been asked for a KILL to `pid` by its own pid, from kill.log. */
function killSentTo(pid) {
  const args = JSON.stringify(['-s', 'KILL', '--', String(pid)]);
  try {
    return readFileSync(path.join(process.env.OBK_FAKE_ORCA_DIR, 'kill.log'), 'utf8').split('\n')
      .some((line) => line !== '' && JSON.stringify(JSON.parse(line).args) === args);
  } catch {
    return false;
  }
}

/** Whether an entry's process has started yet: see `appearsAfterMs`, `appearsAfterReads` and `appearsAfterKillOf` above. */
function started(entry) {
  if (Number.isInteger(entry.appearsAfterKillOf) && !killSentTo(entry.appearsAfterKillOf)) return false;
  if (Number.isFinite(entry.appearsAfterReads) && readsSinceSignal() < entry.appearsAfterReads) return false;
  if (!Number.isFinite(entry.appearsAfterMs)) return true;
  const at = firstSignalAt();
  return at !== undefined && Date.now() >= at + entry.appearsAfterMs;
}

/** One of a table entry's ids as the fake answers it: 'kit' is the pid of whoever runs this fake. */
const idOf = (value) => (value === 'kit' ? process.ppid : value);

/**
 * The process table a test set, as `ps` reads it: one `{ pid, ppid, pgid, uid,
 * stat, startedAt, command, cwd, entry }` per entry of `processes` in
 * state.json that has started, with 'kit' given as the kit's pid and the
 * defaults filled in. `entry` is the entry itself, for the fake kill to change.
 */
export function tableOf(state) {
  return (state.processes ?? []).filter(started).map((entry) => ({
    pid: idOf(entry.pid),
    ppid: idOf(entry.ppid ?? 1),
    pgid: idOf(entry.pgid ?? entry.pid),
    uid: entry.uid ?? process.getuid(),
    stat: entry.stat ?? 'S',
    startedAt: entry.startedAt ?? defaultStart(idOf(entry.pid)),
    command: entry.command ?? 'sleep 600',
    cwd: entry.cwd,
    entry,
  }));
}

/** The harness a tab was launched with: the first line typed into it names one, or none was. */
export function launchedIn(terminal) {
  const first = terminal.typed?.[0]?.text;
  return first === undefined ? undefined : /(?:^|\s)(claude|codex|pi)(?=\s|$)/.exec(first)?.[1];
}

/**
 * What a test said about one tab before the kit made it (#498): `byName` in
 * state.json, keyed by the last word of a tab's title, which for a session's tab
 * is the session's name. `{ front, tty, screen }`, any of them: who is in front
 * before anything is launched in it (here), how its tty reads (helpers/fake-tty.js),
 * and what its screen shows (helpers/fake-orca.js, as `screen` on one terminal).
 */
export function settingsFor(state, terminal) {
  const word = /(\S+)\s*$/.exec(terminal.title ?? '')?.[1];
  return word === undefined ? undefined : state.byName?.[word];
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
  if (launchedIn(terminal) === undefined) return settingsFor(state, terminal)?.front ?? 'shell';
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
export function processesOf(state, terminal, dir) {
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
    case 'node-harness':
      return [
        row(pane, orca, harness, '/usr/bin/login'),
        row(shell, pane, harness, '-/bin/zsh'),
        row(harness, shell, harness, 'node'),
      ];
    case 'node-child':
      return [
        row(pane, orca, harness + 1, '/usr/bin/login'),
        row(shell, pane, harness + 1, '-/bin/zsh'),
        row(harness, shell, harness + 1, program),
        row(harness + 1, harness, harness + 1, 'node'),
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
    case 'node-harness':
    case 'node-child':
      return live('node', null, true);
    default:
      return live(program, program, true);
  }
}

/** A conversation id of the shape both harnesses use, for a harness Orca resumed. */
const RESUMED = '0199b2c0-0318-4444-8888-cccccccccccc';

/**
 * The script `node` runs for a harness installed through npm, as ps shows it:
 * the shape of a global npm install, not a path read off a machine.
 */
const NPM_CLI = {
  claude: '/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js',
  codex: '/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js',
};

/** The script of a `node` program a harness started, a tool server say. Made up. */
const NODE_CHILD = '/Users/someone/.npm/_npx/0a1b2c3d/node_modules/.bin/some-tool-server';

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
function environmentOf(state, terminal, row, dir) {
  const harness = panePid(state, terminal) + 2;
  if (row.pid === harness + 1) {
    // A program the harness started carries what the harness carries, under a
    // command of its own.
    const parent = processesOf(state, terminal, dir).find((one) => one.pid === harness);
    return environmentOf(state, terminal, parent, dir)?.replace(/^.*?(?= TERM=)/, `node ${NODE_CHILD}`);
  }
  if (row.pid !== harness) return [row.comm, ...USERS.slice(0, 2), ...orcaVariables(terminal), ...USERS.slice(2)].join(' ');

  const launched = launchedIn(terminal) ?? 'claude';
  const program = row.comm === 'node' ? `node ${NPM_CLI[launched]}` : row.comm;
  const typed = terminal.typed?.[0]?.text ?? '';
  const resumed = row.comm === 'pi'
    ? 'pi'
    : (row.comm === 'node' ? launched : row.comm) === 'codex' ? `${program} resume ${RESUMED}` : `${program} --resume ${RESUMED}`;
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
      const front = foregroundOf(state, terminal, dir);
      if (front === 'program' || front === 'other-harness') {
        // Typed at the shell's prompt by hand: the shell's variables, and none
        // of the kit's, which its launch line gave the harness alone.
        const command = front === 'program' ? 'less /etc/hosts' : row.comm;
        return [command, ...USERS.slice(0, 2), ...orcaVariables(terminal), ...USERS.slice(2)].join(' ');
      }
      // The arguments the line gave the harness, as ps shows them: unquoted,
      // behind `node` and its script when npm installed it.
      const word = row.comm === 'node' ? launched : row.comm;
      const at = typed.search(new RegExp(`(?:^|\\s)${word}(?=\\s|$)`));
      const given = at < 0 ? word : typed.slice(at).trim().replaceAll("'\\''", "'").replaceAll("'", '');
      // Pi renames its process: `pi`, with no arguments (#634).
      const command = row.comm === 'pi' ? 'pi' : `${program}${given.slice(word.length)}`;
      const cli = /(?:^|\s)OBK_CLI=('(?:[^']|'\\'')*'|\S+)/.exec(typed)?.[1];
      const kits = [
        ...(typed.includes('OBK_TAB_SHELL=$$') ? [`OBK_TAB_SHELL=${row.ppid}`] : []),
        ...(cli === undefined ? [] : [`OBK_CLI=${cli.replaceAll("'\\''", "'").replace(/^'(.*)'$/, '$1')}`]),
      ];
      const tabId = terminal.environment === 'launched-other-tab' ? `${terminal.tabId}0` : terminal.tabId;
      return [command, ...USERS.slice(0, 2), ...orcaVariables(terminal, tabId), ...kits, ...USERS.slice(2)].join(' ');
    }
  }
}

/** Whether `args` asks for one process's command line: `[-w|-ww] -o command=|args= -p <pid>`, `-wwo` too, or the environment read `-E -ww -o command= -p <pid>`. */
function commandReadOf(args) {
  if (args.length < 3 || args.at(-2) !== '-p' || !/^[1-9]\d*$/.test(args.at(-1))) return false;
  const flags = args.slice(0, -2).join(' ');
  return flags === '-E -ww -o command=' || /^(?:-w{1,2} )?(?:-o |-w{1,2}o )(?:command|args)=$/.test(flags);
}

/** The command lines the harness stand-ins wrote down, by pid; the last one for a pid wins. */
function standInCommands(dir) {
  const known = new Map();
  try {
    for (const line of readFileSync(path.join(dir, 'ps-args.log'), 'utf8').split('\n')) {
      if (line === '') continue;
      const { pid, command } = JSON.parse(line);
      known.set(Number(pid), command);
    }
  } catch {
    // No stand-in has written anything yet.
  }
  return known;
}

/** Answer a command-line read (see the top), and exit. */
function answerCommandRead(state, dir, args) {
  const pid = Number(args.at(-1));
  const withEnvironment = args[0] === '-E';
  const standIn = standInCommands(dir).get(pid);
  if (standIn !== undefined) {
    const kits = withEnvironment ? [...USERS.slice(0, 2), `OBK_TAB_SHELL=${process.ppid}`, ...USERS.slice(2)] : [];
    process.stdout.write(`${[standIn, ...kits].join(' ')}\n`);
    process.exit(0);
  }
  for (const terminal of state.terminals ?? []) {
    const found = processesOf(state, terminal, dir).find((one) => one.pid === pid);
    if (found === undefined) continue;
    const line = environmentOf(state, terminal, found, dir);
    if (line === undefined) {
      process.stderr.write(`ps: cannot read the environment of process ${pid}\n`);
      process.exit(1);
    }
    process.stdout.write(`${withEnvironment ? line : line.replace(/ TERM=.*$/, '')}\n`);
    process.exit(0);
  }
  process.exit(1);
}

/** Run as `ps`: read the fake Orca's world and answer for one pid. */
export function runPs() {
  const asked = Date.now();
  const dir = process.env.OBK_FAKE_ORCA_DIR;
  if (dir === undefined) {
    process.stderr.write('fake ps: OBK_FAKE_ORCA_DIR is not set\n');
    process.exit(70);
  }

  const args = process.argv.slice(2);
  appendFileSync(path.join(dir, 'ps.log'), `${JSON.stringify({ args, at: asked })}\n`);

  const state = JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8'));
  // A `ps` slow to answer, or one that never does (#498, the review of PR
  // #499): `psDelayMs` holds every answer back that long, the call written
  // down first.
  if (Number.isFinite(state.psDelayMs) && state.psDelayMs > 0) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, state.psDelayMs);
  }
  const killed = () => {
    try {
      return readFileSync(path.join(dir, 'kill.log'), 'utf8').trim() !== '';
    } catch {
      return false;
    }
  };
  if (state.ps === 'not-permitted' || (state.ps === 'fails-after-kill' && killed())) {
    process.stderr.write(`${process.argv[1]}: Operation not permitted\n`);
    process.exit(126);
  }

  if (args.length === PS_TABLE.length && PS_TABLE.every((word, at) => args[at] === word)) {
    if (killed() && Number.isFinite(state.psDelayAfterKillMs) && state.psDelayAfterKillMs > 0) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, state.psDelayAfterKillMs);
    }
    // The processes whose time has come end before this read is answered.
    const reads = readFileSync(path.join(dir, 'ps.log'), 'utf8').split('\n')
      .filter((line) => line !== '' && JSON.stringify(JSON.parse(line).args) === JSON.stringify(PS_TABLE))
      .length;
    const sinceSignal = readsSinceSignal();
    const ending = (state.processes ?? []).filter((entry) => (Number.isInteger(entry.exitsAtRead) && entry.exitsAtRead <= reads)
      || (Number.isInteger(entry.exitsAfterReads) && sinceSignal > 0 && entry.exitsAfterReads <= sinceSignal));
    if (ending.length > 0) {
      const pids = new Set(ending.map((entry) => idOf(entry.pid)));
      state.processes = state.processes.filter((entry) => !ending.includes(entry));
      for (const entry of state.processes) {
        if (pids.has(idOf(entry.ppid))) entry.ppid = 1;
      }
      const stateFile = path.join(dir, 'state.json');
      const next = `${stateFile}.ps.${process.pid}.tmp`;
      writeFileSync(next, `${JSON.stringify(state, null, 2)}\n`);
      renameSync(next, stateFile);
    }
    const column = (value) => String(value).padStart(5);
    const itself = { pid: process.pid, ppid: process.ppid, pgid: process.pid, uid: process.getuid(), stat: 'R+', startedAt: Date.now(), command: `ps ${PS_TABLE.join(' ')}` };
    process.stdout.write([...tableOf(state), itself]
      .map((row) => `${column(row.pid)} ${column(row.ppid)} ${column(row.pgid)} ${column(row.uid)} ${row.stat.padEnd(4)} ${lstartOf(row.startedAt)}     ${row.command}\n`)
      .join(''));
    appendFileSync(path.join(dir, 'ps-table.log'), `${JSON.stringify({ at: asked, done: Date.now() })}\n`);
    process.exit(0);
  }

  const asks = (shape) => args.length === shape.length + 1
    && shape.every((word, at) => args[at] === word)
    && /^[1-9]\d*$/.test(args[shape.length]);
  const read = asks(PS_READ);
  const environment = asks(PS_ENVIRONMENT);
  const start = asks(PS_START);
  const elapsed = asks(PS_ELAPSED);
  const commandRead = !read && commandReadOf(args);
  if (commandRead) answerCommandRead(state, dir, args);
  if (!read && !environment && !start && !elapsed) {
    process.stderr.write(`fake ps: ${args.join(' ')} is not a read of one pid; the kit asks ps nothing else\n`);
    process.exit(70);
  }
  const pid = Number(args.at(-1));

  if (start || elapsed) {
    // When one process started, or how long ago (#755): see the top.
    const failure = state.psStartErrors?.[String(pid)];
    if (typeof failure === 'string') {
      process.stderr.write(`${failure}\n`);
      process.exit(1);
    }
    const tab = (state.terminals ?? []).some((terminal) => processesOf(state, terminal, dir).some((one) => one.pid === pid));
    const listed = tableOf(state).find((row) => row.pid === pid);
    if (!tab && listed === undefined) process.exit(1);
    const at = tab ? tabStartOf(state, pid) : listed.startedAt;
    if (at === null) {
      process.stdout.write('\n');
      process.exit(0);
    }
    if (start) {
      process.stdout.write(`${lstartInZone(at)}\n`);
      process.exit(0);
    }
    const now = Date.now();
    if (at > now) {
      process.stderr.write(`fake ps: process ${pid} starts at ${new Date(at).toISOString()}, after now (${new Date(now).toISOString()}); a test must give a start in the past\n`);
      process.exit(70);
    }
    process.stdout.write(`${etimeOf(now - at)}\n`);
    process.exit(0);
  }

  // An error of ps's own for this pid, which a test set (see the top).
  const error = state.psErrors?.[String(pid)];
  if (read && typeof error === 'string') {
    process.stderr.write(`${error}\n`);
    process.exit(1);
  }

  for (const terminal of state.terminals ?? []) {
    if (read && pid === panePid(state, terminal) && foregroundOf(state, terminal, dir) === 'garbage') {
      process.stdout.write('ps: the table was busy; this is not a line of it\n');
      process.exit(0);
    }
    const found = processesOf(state, terminal, dir).find((one) => one.pid === pid);
    if (found !== undefined && environment) {
      const line = environmentOf(state, terminal, found, dir);
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

  // A pid that is not there: nothing on stdout or stderr, and exit 1, as the
  // real ps answers it (see the top).
  process.exit(1);
}
