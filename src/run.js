// `obk run --timeout <seconds> -- <command…>`: one command run with a hard time
// limit (#532). macOS has no `timeout`, and the fleet's form for a bounded run,
// `perl -e 'alarm …; exec @ARGV' -- <command>`, cannot be allowed by a narrow
// rule, since perl runs whatever its arguments say. A rule for this command
// names the real command after `--`, and the kit judges that command as a rule
// of its own (permissions.js). It runs whatever its arguments say too, so it is
// never in the default set (ADR 0050).
//
// The command runs with no shell, in a process group of its own, so the time
// limit stops what it started as well. Its exit code comes back as it is; one
// ended by a signal the kit did not send comes back as 128 and the signal's
// number, as a shell gives it.

import { spawn } from 'node:child_process';
import { constants } from 'node:os';

/** The exit code of a run the time limit stopped, as GNU timeout gives it. */
const TIMED_OUT = 124;

/** The exit codes a shell gives a command it cannot find, and one it cannot run. */
const NOT_FOUND = 127;
const CANNOT_RUN = 126;

/** How long the group has after SIGTERM before SIGKILL, as `retire` gives a session's processes (#537). */
const GRACE_MS = 3000;

/** How often the kit looks whether anything of the group still runs. */
const LOOK_MS = 100;

/** The longest time limit a timer holds, in seconds: about 24 days. */
const LONGEST = Math.floor((2 ** 31 - 1) / 1000);

/** The signals that end the kit and that it passes on to the command's group, so it is not left running. */
const PASSED_ON = ['SIGINT', 'SIGTERM', 'SIGHUP'];

const USE = 'obk run takes --timeout <seconds>, then --, then the command: obk run --timeout 300 -- go test ./...';

/**
 * The time limit and the command from `obk run`'s arguments, or a refusal.
 * Only `--timeout` goes before `--`; everything after it is the command's.
 */
export function parseRun(args) {
  const end = args.indexOf('--');
  const options = end === -1 ? args : args.slice(0, end);
  let value;
  for (let at = 0; at < options.length; at += 1) {
    const option = options[at];
    if (option === '--timeout' && at + 1 < options.length && value === undefined) {
      value = options[at + 1];
      at += 1;
    } else if (option.startsWith('--timeout=') && value === undefined) {
      value = option.slice('--timeout='.length);
    } else {
      throw new Error(`run does not take ${option}. ${USE}. Nothing was run.`);
    }
  }
  if (value === undefined) throw new Error(`run needs --timeout <seconds>: how long the command may run. ${USE}. Nothing was run.`);
  if (!/^\d+$/.test(value) || Number(value) === 0 || Number(value) > LONGEST) {
    throw new Error(`run's --timeout is a whole number of seconds from 1 to ${LONGEST}, and got: ${value === '' ? 'nothing' : value}. Nothing was run.`);
  }
  const command = end === -1 ? [] : args.slice(end + 1);
  if (command.length === 0) throw new Error(`run needs the command after --. ${USE}. Nothing was run.`);
  return { seconds: Number(value), command };
}

/**
 * Run the command with its time limit, its input and output the caller's, and
 * give back the exit code `obk run` exits with. The run ends when nothing of
 * the command's group runs any more: a process the command started and left
 * running is held to the same limit, and to a signal the kit passes on.
 */
export function runBounded({ seconds, command }) {
  return new Promise((resolve) => {
    // `detached` makes the command the leader of a group of its own, so its
    // pid, taken here at spawn, is the group's id.
    const child = spawn(command[0], command.slice(1), { stdio: 'inherit', detached: true });
    // The leader's exit code, once it has exited.
    let exitCode;
    let stopping = false;
    let result;
    let killAt;
    let deadline;
    let look;
    const signal = (pid, name) => {
      try {
        process.kill(pid, name);
        return true;
      } catch {
        return false;
      }
    };
    // The leader by its own pid as well, in case it left the group, but only
    // while it has not exited, since its pid is free again after that.
    const group = (name) => {
      if (exitCode === undefined && name !== 0) signal(child.pid, name);
      return signal(-child.pid, name);
    };

    const finish = (code) => {
      clearTimeout(deadline);
      clearTimeout(look);
      for (const name of PASSED_ON) process.off(name, passOn);
      resolve(code);
    };

    // Once the leader has exited or the group is being stopped: look until
    // nothing of the group runs, and send SIGKILL when the grace is over.
    const watch = () => {
      if (exitCode !== undefined && !group(0)) return finish(result ?? exitCode);
      if (killAt !== undefined && Date.now() >= killAt) {
        group('SIGKILL');
        killAt = undefined;
      }
      look = setTimeout(watch, LOOK_MS);
      return undefined;
    };

    // Stop the group: `name` first, then SIGKILL to what still runs after the
    // grace. obk run exits with `code`, or with the leader's own when it is
    // undefined.
    const stop = (name, code) => {
      if (stopping) return;
      stopping = true;
      result = code;
      clearTimeout(deadline);
      group(name);
      killAt = Date.now() + GRACE_MS;
      clearTimeout(look);
      watch();
    };
    const passOn = (name) => stop(name, undefined);

    child.on('error', (error) => {
      const missing = error.code === 'ENOENT';
      process.stderr.write(`obk: run could not start ${command[0]}: ${missing ? 'there is no such command' : error.code ?? error.message}.\n`);
      finish(missing ? NOT_FOUND : CANNOT_RUN);
    });
    if (child.pid === undefined) return;
    for (const name of PASSED_ON) process.on(name, passOn);

    child.on('exit', (code, name) => {
      exitCode = code ?? 128 + constants.signals[name];
      clearTimeout(look);
      watch();
    });

    deadline = setTimeout(() => {
      process.stderr.write(`obk: run stopped ${command.join(' ')}: it ran past its time limit of ${seconds} seconds, and its whole process group was stopped.\n`);
      stop('SIGTERM', TIMED_OUT);
    }, seconds * 1000);
  });
}
