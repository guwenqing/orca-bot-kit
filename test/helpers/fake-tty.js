// A fake `lsof` and a fake `stty` for the ordinary suite. `OBK_LSOF` and
// `OBK_STTY` point every sandboxed run at them, so `npm test` never reads the
// machine's own terminals.
//
// They answer the question the kit asks before it types a launch line into a
// tab it has just opened (#498): is the tab's shell at a ready prompt, with
// nothing asking? Ready is the shell in front (the fake `ps`, helpers/fake-ps.js)
// and the tab's tty in line-editor mode. The kit finds the tty from the pane
// pid Orca's diagnostics give the tab. That pid is `/usr/bin/login`, which runs
// as root, so `lsof -p <pane pid>` shows the user nothing (seen live, #498).
// The kit asks instead, once, for fd 0 of every process of the user:
//
//   <lsof> -a -R -d 0 -u <uid> -FpRn
//
// which on macOS prints one record per process, a field per line: `p<pid>`,
// `R<parent pid>`, `f0`, `n<name>`, and exits 0. Live record: `p88639`,
// `R88620`, `f0`, `n/dev/ttys010`, where 88620 was the pane's login. The tab's
// tty is the name in the record whose parent is the pane pid (the shell under
// login), or whose pid is the pane pid (a pane that is the shell itself, the
// fake ps's 'bare-shell'). A name that does not start with /dev/ is no tty.
//
// The records are the user's processes the fake `ps` knows in each tab (the
// shell and what runs from it, not the root-owned login), and before them
// processes of the user's that are no tab's: Orca itself on /dev/null, and a
// shell with its child in another terminal app, on /dev/ttys900, whose parent
// is no pane. A kit that took the first tty it saw would read that one. A uid
// that is not the caller's own has no processes: nothing, exit 1. Then the kit
// reads the tty's mode with
//
//   <stty> -a -f /dev/ttys012
//
// which prints macOS `stty -a` output. Its `lflags:` line holds `icanon` or
// `-icanon`, and `echo` or `-echo`, as whole words beside the other flags that
// start with "echo" (`echoe`, `echok`, `echoke`, `-echonl`, `echoctl`,
// `-echoprt`). Its `cchars:` part holds `lnext = <undef>` or `lnext = ^V`,
// among other characters that may be `<undef>` too (`eol`, `eol2`). Line-editor
// mode is `-icanon`, `-echo` and `lnext = <undef>` together, which is Orca
// 1.4.219's own test (shared/pty-slave-line-discipline-echo.js). Measured in a
// pty (#498, the review of PR #499): zsh, bash and /bin/sh at their prompts
// read `-icanon -echo`, lnext <undef>; zsh in oh-my-zsh's update question
// (`read -k 1`) reads `-icanon echo`, lnext ^V; zsh `read -s -k 1`, a silent
// one-key question, reads `-icanon -echo`, lnext ^V; bash `read -p` reads
// `icanon echo`, lnext ^V.
//
// It answers one more question (#537): the working folder of every process of
// the user's, which the kit reads when it retires a session, to find what the
// session left running in its work dir. The kit asks, once,
//
//   <lsof> -a -d cwd -u <uid> -Fpn
//
// which prints one record per process, a field per line: `p<pid>`, `fcwd`,
// `n<absolute path>`. The records are the entries of the fake ps's process
// table (`processes` in state.json, helpers/fake-ps.js) that have a `cwd`, are
// the given uid's, and are no zombie: a zombie has no working folder left to
// name. A uid that is not the caller's own has no processes: nothing, exit 1.
// An empty table prints nothing and exits 0, though a real machine always has
// a process of the user's to list. `lsof` in state.json set to
// 'not-permitted' is an lsof that cannot read the process table, as a sandbox
// may forbid it: every call, of either shape, prints why and exits 1, and is
// still logged. 'fails-after-kill' answers as usual until the fake kill
// (helpers/fake-kill.js) has been called once, and then fails every call that
// way. `lsofDelayAfterKillMs` holds every lsof answer back that long, but only
// once the fake kill has been called: a read made slow during the wait.
//
// Any other call shape is refused with exit 70, as the fake `ps` refuses one.
// Every call, refused or not, is written to lsof.log or stty.log in the fake
// Orca's directory, `{ args, at }` per line, `at` in ms since the epoch.
//
// Each tab's tty is `/dev/ttys` and the tab's number in three digits: the tty
// of the tab with pane pid 40070 is /dev/ttys007. Every process of the tab
// (the pane, its shell, what runs in it) has it on fd 0.
//
// How a tab's tty reads, `tty` in state.json for every tab, or `tty` under the
// tab's entry in `byName` (helpers/fake-ps.js) for that tab alone:
//
//   'prompt'      (default) zsh at its prompt: -icanon, -echo, lnext <undef>.
//                 Ready.
//   'question'    a shell question read one key at a time, as oh-my-zsh's
//                 "Would you like to update? [Y/n]": -icanon, echo, lnext ^V
//   'silent-key'  a question read one key at a time with the echo off, as zsh
//                 `read -s -k 1`: -icanon, -echo, lnext ^V. Only lnext tells
//                 it from a prompt
//   'read'        a plain line read, as bash `read`: icanon, echo, lnext ^V
//   'secret'      a line read with the echo off, as `read -s`: icanon, -echo,
//                 lnext ^V
//   'no-lnext'    -icanon, -echo, and no lnext in cchars at all: what Orca
//                 reads as neither, so not ready
//   'stty-fails'  stty cannot read the tty: stderr, exit 1
//   'lsof-fails'  lsof fails: stderr, exit 1, whichever tab it was asked for
//   'no-tty'      the tab's processes have no tty on fd 0: their records
//                 name /dev/null
//
// A list is one of the stty words per look: the first `stty` call for that tab
// reads the first, the second the second, and the last answers every call
// after it. ['question', 'question', 'prompt'] is a question the user answered
// while the kit was looking. `lsof` reads a list the same way, by its own
// calls, and answers as 'prompt' for any word that is not its own.
//
// And how long each takes to answer (#498, the review of PR #499): `lsofDelayMs`
// in state.json holds every lsof answer back that long, and `sttyDelayMs`, in
// state.json or under a tab's entry in `byName`, every stty answer for that
// tab. The call is written down first, then the fake sleeps, then answers as
// it would have. A delay longer than the test is an lsof or stty that never
// answers. One that the kit kills takes its sleep with it.

import { appendFileSync, readFileSync } from 'node:fs';

/** Sleep `ms` before answering, the whole process held. */
function holdBack(ms) {
  if (Number.isFinite(ms) && ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
import path from 'node:path';

import { panePid, processesOf, settingsFor, tableOf } from './fake-ps.js';

/** The argv the kit may hand `lsof`, with the uid in place of UID. */
export const LSOF_READ = ['-a', '-R', '-d', '0', '-u', 'UID', '-FpRn'];

/** Processes of the user's that are no tab's, listed first: { pid, ppid, name }. */
export const OTHER_PROCESSES = [
  { pid: 1063, ppid: 1, name: '/dev/null' },
  { pid: 30001, ppid: 30000, name: '/dev/ttys900' },
  { pid: 30002, ppid: 30001, name: '/dev/ttys900' },
];

/** The argv the kit may hand `lsof` for working folders (#537), with the uid in place of UID. */
export const LSOF_CWD = ['-a', '-d', 'cwd', '-u', 'UID', '-Fpn'];

/** The argv the kit may hand `stty`, with the tty in place of TTY. */
export const STTY_READ = ['-a', '-f', 'TTY'];

/** The tty of a tab, by its pane pid: /dev/ttys007 for 40070. */
export const ttyOf = (state, terminal) => `/dev/ttys${String((panePid(state, terminal) - 40000) / 10).padStart(3, '0')}`;

/** How one tab's tty reads at its `look`th call (1 first), as one of the words above. */
export function ttyModeOf(state, terminal, look) {
  const told = settingsFor(state, terminal)?.tty ?? state.tty ?? 'prompt';
  if (!Array.isArray(told)) return told;
  return told[Math.min(Math.max(look - 1, 0), told.length - 1)];
}

/**
 * What macOS `stty -a` prints for a tty, with its two flags as given, and its
 * lnext character: '<undef>', '^V', or null for none listed.
 */
export function sttyOutput({ icanon, echo, lnext }) {
  return [
    'speed 38400 baud; 50 rows; 200 columns;',
    `lflags: ${icanon ? 'icanon' : '-icanon'} isig iexten ${echo ? 'echo' : '-echo'} echoe echok echoke -echonl echoctl`,
    '\t-echoprt -altwerase -noflsh -tostop -flusho pendin -nokerninfo',
    '\t-extproc',
    'iflags: -istrip icrnl -inlcr -igncr ixon -ixoff ixany imaxbel iutf8',
    '\t-ignbrk brkint -inpck -ignpar -parmrk',
    'oflags: opost onlcr -oxtabs -onocr -onlret',
    'cflags: cread cs8 -parenb -parodd hupcl -clocal -cstopb -crtscts -dsrflow',
    '\t-dtrflow -mdmbuf',
    'cchars: discard = ^O; dsusp = ^Y; eof = ^D; eol = <undef>;',
    `\teol2 = <undef>; erase = ^?; intr = ^C; kill = ^U;${lnext === null ? '' : ` lnext = ${lnext};`}`,
    '\tmin = 1; quit = ^\\; reprint = ^R; start = ^Q; status = ^T;',
    '\tstop = ^S; susp = ^Z; time = 0; werase = ^W;',
    '',
  ].join('\n');
}

/** The two flags and the lnext character of each word stty answers. */
const FLAGS = {
  prompt: { icanon: false, echo: false, lnext: '<undef>' },
  question: { icanon: false, echo: true, lnext: '^V' },
  'silent-key': { icanon: false, echo: false, lnext: '^V' },
  read: { icanon: true, echo: true, lnext: '^V' },
  secret: { icanon: true, echo: false, lnext: '^V' },
  'no-lnext': { icanon: false, echo: false, lnext: null },
};

/** The fake's world, and a call written down. */
function begin(log) {
  const dir = process.env.OBK_FAKE_ORCA_DIR;
  if (dir === undefined) {
    process.stderr.write(`fake ${log}: OBK_FAKE_ORCA_DIR is not set\n`);
    process.exit(70);
  }
  const args = process.argv.slice(2);
  appendFileSync(path.join(dir, `${log}.log`), `${JSON.stringify({ args, at: Date.now() })}\n`);
  const state = JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8'));
  return { dir, args, state };
}

/** How many calls in one of the logs `matches`, this one included. */
function callsSoFar(dir, log, matches) {
  return readFileSync(path.join(dir, `${log}.log`), 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line).args)
    .filter(matches)
    .length;
}

/**
 * The user's processes of one tab, as lsof lists them: the shell and what runs
 * from it, not the root-owned login. The fake ps's faults are its own, so a tab
 * it cannot read still has its shell here.
 */
function userProcessesOf(state, terminal, dir) {
  const rows = processesOf(state, terminal, dir).filter((row) => row.comm !== '/usr/bin/login');
  if (rows.length > 0) return rows;
  const pane = panePid(state, terminal);
  return [{ pid: pane + 1, ppid: pane }];
}

/** Run as `lsof`: name fd 0 of every process of the user's. */
export function runLsof() {
  const { dir, args, state } = begin('lsof');
  const killed = (() => {
    try {
      return readFileSync(path.join(dir, 'kill.log'), 'utf8').trim() !== '';
    } catch {
      return false;
    }
  })();
  if (killed) holdBack(state.lsofDelayAfterKillMs);
  if (state.lsof === 'not-permitted' || (state.lsof === 'fails-after-kill' && killed)) {
    process.stderr.write('lsof: WARNING: can\'t stat() of the process table: Operation not permitted\n');
    process.exit(1);
  }
  const cwds = args.length === LSOF_CWD.length
    && LSOF_CWD.every((word, at) => word === 'UID' || args[at] === word)
    && /^\d+$/.test(args[4]);
  if (cwds) {
    if (Number(args[4]) !== process.getuid()) process.exit(1);
    holdBack(state.lsofDelayMs);
    const records = tableOf(state).filter((row) => typeof row.cwd === 'string' && row.uid === Number(args[4]) && !row.stat.startsWith('Z'));
    process.stdout.write(records.map((row) => `p${row.pid}\nfcwd\nn${row.cwd}\n`).join(''));
    process.exit(0);
  }
  const shaped = args.length === LSOF_READ.length
    && LSOF_READ.every((word, at) => word === 'UID' || args[at] === word)
    && /^\d+$/.test(args[5]);
  if (!shaped) {
    process.stderr.write(`fake lsof: ${args.join(' ')} is not a read of the user's fd 0 or working folders; the kit asks lsof nothing else\n`);
    process.exit(70);
  }
  // As macOS lsof does for a user with no processes: nothing, and exit 1.
  if (Number(args[5]) !== process.getuid()) process.exit(1);

  holdBack(state.lsofDelayMs);
  const look = callsSoFar(dir, 'lsof', () => true);
  const terminals = state.terminals ?? [];
  if (terminals.some((terminal) => ttyModeOf(state, terminal, look) === 'lsof-fails')) {
    process.stderr.write('lsof: WARNING: can\'t stat() of the process table: Operation not permitted\n');
    process.exit(1);
  }
  const records = [...OTHER_PROCESSES];
  for (const terminal of terminals) {
    const name = ttyModeOf(state, terminal, look) === 'no-tty' ? '/dev/null' : ttyOf(state, terminal);
    records.push(...userProcessesOf(state, terminal, dir).map((row) => ({ pid: row.pid, ppid: row.ppid, name })));
  }
  process.stdout.write(records.map((one) => `p${one.pid}\nR${one.ppid}\nf0\nn${one.name}\n`).join(''));
  process.exit(0);
}

/** Run as `stty`: print one tab's tty mode. */
export function runStty() {
  const { dir, args, state } = begin('stty');
  const shaped = args.length === STTY_READ.length && args[0] === '-a' && args[1] === '-f' && /^\/dev\/\S+$/.test(args[2]);
  if (!shaped) {
    process.stderr.write(`fake stty: ${args.join(' ')} is not a read of one tty's mode; the kit asks stty nothing else\n`);
    process.exit(70);
  }
  const tty = args[2];

  const terminal = (state.terminals ?? []).find((one) => ttyOf(state, one) === tty);
  if (terminal === undefined) {
    process.stderr.write(`stty: ${tty}: No such file or directory\n`);
    process.exit(1);
  }
  holdBack(settingsFor(state, terminal)?.sttyDelayMs ?? state.sttyDelayMs);
  const look = callsSoFar(dir, 'stty', (one) => one[2] === tty);
  const mode = ttyModeOf(state, terminal, look);
  if (mode === 'stty-fails') {
    process.stderr.write(`stty: ${tty}: Operation not permitted\n`);
    process.exit(1);
  }
  process.stdout.write(sttyOutput(FLAGS[mode] ?? FLAGS.prompt));
  process.exit(0);
}
