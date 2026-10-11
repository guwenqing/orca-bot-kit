Source: standard input
Fetched: 2026-10-10T17:28Z
SHA-256: 82399f6f7f708092f5f7dd16ba545fc90db24e2e468b0ce0aafe31653951ff56
---
The issue and its triage, as written in issue #537 (https://github.com/guwenqing/orca-bot-kit/issues/537) by qiragu, fetched 2026-10-10:

## What happened

`obk temp retire` closed a temporary developer's tab at 2026-10-09 23:58Z. Two `node --test test/<file>.test.js` processes that the session had started kept running with parent PID 1, in the session's work dir, at 50-80% CPU each, for about 17 h 45 min, until I stopped them by hand. The machine was at a load of about 125 on 18 cores at the time.

    PID   PPID  ELAPSED   %CPU  cwd
    41131 1     17:45:49  83.8  <bots>/bots/<bot>/work/developer-507
    50727 1     17:42:16  81.6  <bots>/bots/<bot>/work/developer-507

Both were started with `--test-timeout=0`.

## Expected

Retiring a session stops what it started: the processes in its tab's process group, or any process whose cwd is inside its work dir. Or, if the kit should not kill processes, `temp retire` lists the processes still running in the work dir, and `obk health` reports them.

## Versions

- obk 0.25.4
- node v26.11.1
- Orca 1.4.223
- Claude Code 2.1.296
- macOS 27.0.1


--- triage comment ---
Triage (architect, 2026-10-10). Valid, and seen twice today:
- developer-507's two `node --test` processes ran for 17 h 45 m after its retire (Bot Father stopped them).
- developer-521's full suite (PID 57395, process group 57194, 11 processes) ran on with parent PID 1 after I retired developer-521 at about 16:43Z. It kept starting `obk session clear`, `temp make` and `session name` against its own fake Orca. I stopped the group at 16:46Z. Every process in it had its cwd in `work/developer-521` or in that run's throwaway `obk-*` folders.

Together they were a large part of the machine's load of about 120 on 18 cores. The 1-minute load fell to 63 right after the stop.

## Intent

Retiring a session stops the processes it started, so nothing of a retired session runs on.

## Boundary

1. **Only the session's own.** Stop processes whose cwd is in the session's work dir, and their descendants, which may sit in throwaway temp folders. Never stop a process that cannot be shown to be the session's own. Report it instead, with its pid, cwd and command.
2. **Gently, then surely:** SIGTERM to the process group, a short wait, then SIGKILL. Say what was stopped.
3. **Inside Codex's sandbox,** where `ps` does not start, a retire run there says it cannot tell, and stops nothing it cannot see.
4. **Health:** `obk health` reports processes still running in a retired session's work dir, so an orphan from before this fix is seen too.
5. **The proof:** a fake-ps test for each rule, and a live check in a throwaway fleet, with notice.
6. **Out of scope:** stopping processes of a session that is not retired.

Tier: the developer says. It changes what retire does. A developer takes it right after #533 (the release blocker), ahead of #534, because it feeds the machine's load.

