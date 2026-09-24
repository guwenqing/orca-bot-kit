// A fake Orca CLI for the ordinary suite. `OBK_ORCA` points every sandboxed
// run at it, so `npm test` never reaches the real Orca — not even by mistake.
//
// It answers the commands the kit is allowed to use, in the envelope Orca
// 1.4.205 really uses (docs/prd.md, the slice interface and the tech notes),
// it remembers what it was told to create and what was typed into each tab,
// and it can be steered into every way Orca can let the kit down. Its whole
// world is two files in one directory, named by OBK_FAKE_ORCA_DIR:
//
//   state.json   what Orca "has", and how it should misbehave
//   calls.log    one JSON line per call: { args, cwd }
//
// state.json, all optional except the lists:
//   setups      [{ id, projectId, hostId, repoId, path, displayName, kind, ... }]
//   terminals   [{ handle, tabId, worktreePath, title, typed: [...],
//               notices: [...], ... }]
//               `typed` is what the kit sent into the tab with `terminal send`.
//               `notices` is what Orca itself wrote there: "You have N
//               orchestration message. Run `orca orchestration check --run
//               <id>`", one per message sent to a Run this terminal
//               coordinates. Neither is part of what Orca reports about a tab.
//               A terminal with `orphaned: true` is listed the way Orca 1.4.207
//               lists a tab of a project its window has not loaded: the same
//               handle and ptyId, but `tabId` and `leafId` both `pty:<ptyId>`
//               and `orphaned: true`. Its real tab id is still the one kept
//               here, and it is what `terminal close` and `terminal show`
//               answer with. Set it back to false and it is listed as it was
//               made. Seen live (#187, #185, the review of PR #190).
//   automations [{ id, name, enabled, rrule, provider, prompt, runContext }]
//               The daily jobs Orca runs by itself. Orca does **not**
//               deduplicate them by name: the same --name against the same
//               workspace twice gives two automations, both listed and both
//               schedulable (verified live, 2026-09-21), so the fake creates a
//               second one just as readily. Making that idempotent is the
//               kit's job, and a fake that quietly merged them would hide the
//               one failure this is worth testing.
//   repoAddKind the kind `repo add` registers a folder as (Orca says "git" for
//               a folder inside a git repo, which is why the kit must correct it)
//   reachable   false: the app answers but its runtime is not there
//   status      an answer for `status` to print instead of its own (null counts)
//   waitIdle    what `terminal wait --for tui-idle` finds in the tab:
//                 true (default) a TUI that is up and idle: ok, satisfied
//                 'blocked'      a TUI that is up with something to answer:
//                                ok, not satisfied, agent-interactive-prompt
//                 'busy'         a harness that is up and working: Orca
//                                refuses with `timeout`, as for a shell
//                 false          no TUI at all — a plain shell prompt — which
//                                Orca reports by refusing with `timeout`
//                 'quit'         a harness that quit back to its shell: ok,
//                                satisfied, as though a TUI were idle there
//               A list is one of those per call of `terminal wait`, the last
//               entry answering every call after it, counted from the call
//               after the list was set (`waitIdleFrom` is how many came
//               before, which helpers/cli.js writes). [true, false] is a tab
//               the harness came up in and then died in: the thing a single
//               look cannot tell from a harness that is running.
//               Measured live on Orca 1.4.209 with Claude Code 2.1.281 and
//               Codex 0.156.1 (#232): a busy harness and a plain shell both
//               time out, and a shell Codex quit to answers ok. So neither a
//               timeout nor an ok says whether a harness is there; what a tab
//               holds is read from its process group, by the fake `ps` in
//               helpers/fake-ps.js, and `waitIdle` also decides who is in
//               front there unless a test says otherwise.
//   foreground  who is in front of every launched tab, for the fake `ps`:
//               'harness', 'shell', or one of the ways it cannot be read
//               (helpers/fake-ps.js lists them). Left out, it follows waitIdle.
//   agentIdentity  what `terminal show` and `terminal list` give as every
//               tab's `agentIdentity`, when the key is there (null included).
//               Left out, a tab carries its own: null when it is made, and the
//               harness its launch line names once that line is typed into it.
//               Live it is both late and stale (#232): up to ~5 s after the
//               launch line it may not be there yet, and a tab back at a zsh
//               prompt still said `codex` more than 70 s after Codex quit. The
//               fake keeps a tab's own value after its harness quits, as Orca
//               does.
//   fail        { "<command>": { code, message, after } } — that command
//               answers ok:false. With `after: n` the first n calls of it go
//               through and the ones after that fail, which is how a test
//               breaks the second tab of a run and not the first.
//   closeLag    a whole number: how many more `terminal list` answers still
//               carry a terminal after its own `terminal close` has answered
//               ok. 0, the default, is a close the listing agrees with at once.
//               Seen live and written down in both system tests: Orca answers
//               the close before `terminal list` stops reporting the tab, for a
//               second or two on a busy machine, so a caller that believes the
//               answer and lists straight away finds the tab it just closed.
//               Counted in listings that report it, not in seconds, so a test
//               does not depend on how fast anything runs; the terminal is gone
//               from the fake's world once the count runs out. It goes on
//               answering `rename`, `wait` and `send` while it lags, because to
//               anything that found it in a listing it is a tab like any other.
//   crash       { command, exitCode, stdout, stderr } — no JSON, a bad exit code
//   garbage     { command, text } — output that is not JSON at all
//   runs        [{ id, objective, coordinator_handle, consumer_generation,
//               legacy, created_at, updated_at }] — the Run mailboxes
//               `orchestration run-create` has made, in the words `run-show`
//               answers with (Orca 1.4.209). A Run cannot be deleted; there is
//               no command for it, here or in Orca. `coordinator_handle` is
//               the terminal the Run is bound to, and the only one Orca writes
//               its notice into; null is a Run nobody coordinates, which live
//               was seen as an empty coordinator. `run-create` and `run-use`
//               bind the caller's own terminal (`ORCA_TERMINAL_HANDLE`), or the
//               one `--from` names instead, leaving the caller's own binding as
//               it was. One terminal holds one Run: binding it to a Run takes it
//               off the Run it held before, which is left with no coordinator.
//               A `--from` with no live pane is refused `stable_pane_required`,
//               and a caller with no terminal that names none is refused
//               `no_active_sender_terminal` (both seen live on 1.4.209; the
//               second is explained where it is answered). A read of one Run by
//               a terminal that coordinates another is refused
//               `consumer_fenced`; the reader is the terminal `check
//               --terminal` names, or the caller's own when it names none.
//               `consumer_generation` stays 0 here: what Orca counts in it was
//               not measured, and nothing the kit does reads it.
//   messages    [{ id, to, from, subject, body, type, priority, threadId,
//               at, acked }] — everything `orchestration send` has queued, in
//               the order it was sent. `acked` is what `check --ack` sets, and
//               an unacked message is replayed on every read. Those are this
//               fake's own names, for a test to read; Orca's own words for the
//               same message are in `asOrca` below.
//   runDuring   { command, argv, env, on } — run `argv` to completion once,
//               before answering the `on`th call of `command` (the first by
//               default), so another writer really lands in the middle of a run
//               rather than after it. That is the only way to reach the case the
//               book's lock exists for: the kit is between two Orca calls,
//               holding what it read, while a hook writes the same file.
//               `ORCA_TAB_ID` is added to the child's environment as the tab of
//               the terminal the call names, which is the one thing a test
//               cannot know before the run. What to start is the harness chain
//               of helpers/cli.js, not the hook command on its own: a report
//               with no harness above it is not the session's and is ignored.
//
// In `crash` and `garbage`, `command` may be "*" for every command. A command
// is its leading words: "status", "repo add", "terminal create", and so on.
//
// `terminal close` is the one call that takes something away, so it is the one
// the fake is strictest about. Real Orca takes either form:
//
//   terminal close --terminal <handle> [--tab]   one pane, or its whole tab
//   terminal close --worktree <selector> --all   every tab of a project
//
// The first is answered: the terminal leaves the fake's world, a tab at a time,
// because a tab here holds one terminal — at once, or after `closeLag` more
// listings when a test asked for a listing that lags. The second is not
// answered at all —
// the fake falls over with a message, because it closes tabs the kit does not
// own and the kit must never call it. A handle the fake does not have is
// refused with `terminal_not_found`, as `rename`, `wait` and `send` refuse one.

import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { foregroundOf, launchedIn, panePid } from './fake-ps.js';

const dir = process.env.OBK_FAKE_ORCA_DIR;
if (dir === undefined) {
  process.stderr.write('fake orca: OBK_FAKE_ORCA_DIR is not set\n');
  process.exit(70);
}

const stateFile = path.join(dir, 'state.json');
const args = process.argv.slice(2);
appendFileSync(path.join(dir, 'calls.log'), `${JSON.stringify({ args, cwd: process.cwd() })}\n`);

let state = JSON.parse(readFileSync(stateFile, 'utf8'));
const save = () => writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);

/** The leading words of the call: everything before the first flag. */
const words = [];
for (const arg of args) {
  if (arg.startsWith('-')) break;
  words.push(arg);
}
const command = words.join(' ');

/** The value after `--name`, or undefined when the flag is not there. */
function flag(name) {
  const at = args.indexOf(name);
  return at >= 0 && at + 1 < args.length ? args[at + 1] : undefined;
}

let answered = 0;
function write(answer) {
  answered += 1;
  process.stdout.write(`${JSON.stringify(answer)}\n`);
}

function ok(result) {
  write({ id: `fake-${answered + 1}`, ok: true, result, _meta: { durationMs: 1 } });
  process.exit(0);
}

function fail(code, message, data = {}) {
  write({ id: `fake-${answered + 1}`, ok: false, error: { code, message, data } });
  process.exit(1);
}

const aimedHere = (spec) => spec != null && (spec.command === undefined || spec.command === '*' || spec.command === command);

// Real Orca prints human text without --json, and the kit must never read that.
if (!args.includes('--json')) {
  process.stdout.write(`Orca ${command || '(no command)'}: human-readable output, not JSON\n`);
  process.exit(0);
}

if (aimedHere(state.crash)) {
  process.stdout.write(state.crash.stdout ?? '');
  process.stderr.write(state.crash.stderr ?? 'orca: something went wrong\n');
  process.exit(state.crash.exitCode ?? 1);
}

if (aimedHere(state.garbage)) {
  process.stdout.write(state.garbage.text ?? 'not json at all\n');
  process.exit(0);
}

// Another writer, run to completion before this call is answered. It sees the
// disk as the kit left it a moment ago, which is what makes the two overlap.
if (aimedHere(state.runDuring)) {
  const spec = state.runDuring;
  if (callsSoFar() === (spec.on ?? 1)) {
    const named = (state.terminals ?? []).find((entry) => entry.handle === flag('--terminal'));
    const [program, ...rest] = spec.argv;
    const ran = spawnSync(program, rest, {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...(named === undefined ? {} : { ORCA_TAB_ID: named.tabId }),
        ...(spec.env ?? {}),
      },
    });
    appendFileSync(path.join(dir, 'ran-during.log'), `${JSON.stringify({
      command,
      argv: spec.argv,
      status: ran.status,
      stdout: ran.stdout,
      stderr: ran.stderr,
    })}\n`);

    // Whatever the child did to Orca's world, it did. Orca is one program with
    // one memory, so this call must answer from what is there now rather than
    // write the copy it read a moment ago back over the top — a fake that lost
    // the child's Run would make the kit look as though it had never made one.
    state = JSON.parse(readFileSync(stateFile, 'utf8'));
  }
}

const planned = (state.fail ?? {})[command];
if (planned && callsSoFar() > (planned.after ?? 0)) {
  fail(planned.code ?? 'orca_said_no', planned.message ?? 'orca said no', planned.data ?? {});
}

/** How many times this command has been called, this one included. */
function callsSoFar() {
  return readFileSync(path.join(dir, 'calls.log'), 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line).args)
    .filter((earlier) => {
      const words = [];
      for (const arg of earlier) {
        if (arg.startsWith('-')) break;
        words.push(arg);
      }
      return words.join(' ') === command;
    })
    .length;
}

const setupAt = (target) => (state.setups ?? []).find((setup) => setup.path === target);

/** `path:<p>` is the only selector the kit is allowed to use; the others are here to be recognised. */
function worktreePathOf(selector) {
  if (selector === undefined) return undefined;
  if (selector.startsWith('path:')) return selector.slice('path:'.length);
  if (selector.startsWith('id:')) return selector.slice(selector.indexOf('::') + 2);
  return undefined;
}

if (command === 'status') {
  if ('status' in state) {
    write(state.status);
    process.exit(state.status != null && state.status.ok === false ? 1 : 0);
  }
  ok({
    app: { running: true, version: '1.4.205' },
    runtime: { reachable: state.reachable !== false },
    capabilities: {},
  });
}

if (command === 'project setups') {
  ok({ setups: state.setups ?? [] });
}

if (command === 'repo add') {
  const target = flag('--path');
  if (target === undefined) fail('missing_argument', 'repo add needs --path');

  const already = setupAt(target);
  if (already) ok({ repo: { id: already.repoId, path: already.path, displayName: already.displayName, kind: already.kind } });

  const n = state.nextId ?? 1;
  state.nextId = n + 1;
  const repo = {
    id: `repo_${n}`,
    path: target,
    // Orca registers a folder inside a git repo as a git repo. The kit has to
    // correct that, or `terminal create` finds no worktree (slice interface, 1).
    kind: state.repoAddKind ?? 'git',
    displayName: path.basename(target),
  };
  state.setups = [...(state.setups ?? []), {
    id: repo.id,
    projectId: `proj_${n}`,
    hostId: 'host_local',
    repoId: repo.id,
    path: repo.path,
    displayName: repo.displayName,
    kind: repo.kind,
    setupState: 'ready',
    setupMethod: 'repo-add',
  }];
  save();
  ok({ repo });
}

if (command === 'project setup-update') {
  const wanted = flag('--setup');
  const setup = (state.setups ?? []).find((entry) => entry.id === wanted);
  if (!setup) fail('setup_not_found', `no setup with id ${wanted}`);

  const kind = flag('--kind');
  if (kind !== undefined) {
    if (kind !== 'git' && kind !== 'folder') fail('invalid_argument', `--kind must be git or folder, got ${kind}`);
    setup.kind = kind;
  }
  const displayName = flag('--display-name');
  if (displayName !== undefined) setup.displayName = displayName;
  save();

  ok({
    result: {
      project: { id: setup.projectId },
      setup,
      repo: { id: setup.repoId, path: setup.path, kind: setup.kind, displayName: setup.displayName },
    },
  });
}

// Removes the setup, its project and its repo record in one call (tech notes,
// section 1). What happens to tabs still open in it is left as it is here: they
// stay in the fake's world, which is what makes a delete that came before the
// closes show up in a test. The shape of the answer was not recorded when the
// call was measured, so this one is the fake's own.
if (command === 'project setup-delete') {
  const wanted = flag('--setup');
  const setup = (state.setups ?? []).find((entry) => entry.id === wanted);
  if (!setup) fail('setup_not_found', `no setup with id ${wanted}`);

  state.setups = state.setups.filter((entry) => entry !== setup);
  save();
  ok({ deleted: { setupId: setup.id, projectId: setup.projectId, repoId: setup.repoId, path: setup.path } });
}

/**
 * What Orca reports about a tab. What was typed into it is ours, and stays
 * ours, and so are the notices Orca wrote into it and how many more listings a
 * closed tab still shows up in.
 */
const asReported = ({ typed: _typed, notices: _notices, closingFor: _closingFor, ...rest }) => (rest.orphaned === true
  ? { ...rest, ...identity(), tabId: `pty:${rest.ptyId}`, leafId: `pty:${rest.ptyId}`, orphaned: true }
  : { ...rest, ...identity(), orphaned: false });

/** The `agentIdentity` a test gave every tab, or nothing when each tab says its own. */
const identity = () => ('agentIdentity' in state ? { agentIdentity: state.agentIdentity } : {});

if (command === 'terminal list') {
  const target = worktreePathOf(flag('--worktree'));
  // Proven live: asked about a folder it has no project for, Orca refuses the
  // listing rather than answering an empty one (tech notes, `terminal list --worktree`).
  if (flag('--worktree') !== undefined && (target === undefined || !setupAt(target))) {
    fail('selector_not_found', `no worktree matches ${flag('--worktree')}`);
  }
  const shown = (state.terminals ?? [])
    .filter((terminal) => target === undefined || terminal.worktreePath === target);

  // A tab that was closed is reported for as many more listings as the test
  // asked for, and then it is gone. Only the listings that report it count: one
  // asked about another project says nothing about this tab either way.
  let caughtUp = false;
  for (const terminal of shown) {
    if (terminal.closingFor === undefined) continue;
    terminal.closingFor -= 1;
    if (terminal.closingFor <= 0) caughtUp = true;
  }
  if (caughtUp) state.terminals = state.terminals.filter((terminal) => (terminal.closingFor ?? 1) > 0);
  if (shown.some((terminal) => terminal.closingFor !== undefined)) save();

  ok({ terminals: shown.map(asReported) });
}

if (command === 'terminal create') {
  const target = worktreePathOf(flag('--worktree'));
  const setup = target === undefined ? undefined : setupAt(target);
  // Proven live: a git-kind registration of a folder inside a git repo has no
  // worktree, and creating a terminal there fails exactly like this.
  if (!setup || setup.kind !== 'folder') {
    fail('selector_not_found', `no worktree matches ${flag('--worktree')}`);
  }

  const n = state.nextId ?? 1;
  state.nextId = n + 1;

  // Proven live, three times for each harness: a create whose --command is a
  // bare harness name never becomes live. Orca gives up waiting for the handle
  // and the tab it left behind never shows up in `terminal list`.
  const wanted = flag('--command');
  if (wanted === 'claude' || wanted === 'codex') {
    save();
    fail('runtime_error', 'Timed out waiting for terminal handle after creation');
  }

  // The shape Orca 1.4.207 answers with: the pane key is the tab and the leaf,
  // and the pty id names the setup and the folder, then eight hex digits.
  const terminal = {
    handle: `term_${n}`,
    tabId: `tab_${n}`,
    paneKey: `tab_${n}:leaf_${n}`,
    ptyId: `${setup.id}::${setup.path}@@${n.toString(16).padStart(8, '0')}`,
    leafId: `leaf_${n}`,
    worktreeId: `${setup.repoId}::${setup.path}`,
    worktreePath: setup.path,
    title: flag('--title') ?? '',
    agentIdentity: null,
    typed: [],
  };
  if (wanted !== undefined) terminal.startedWith = wanted;
  state.terminals = [...(state.terminals ?? []), terminal];
  save();

  ok({ terminal: asReported(terminal) });
}

if (command === 'terminal close') {
  // Orca's whole-project close. It is not a refusal the kit could handle and
  // report: it is a call the kit must never make, so the fake stops the run
  // where it stands rather than letting one pass quietly.
  if (args.includes('--all') || flag('--worktree') !== undefined) {
    process.stderr.write(`fake orca: ${args.join(' ')} closes every tab of a project, the user's own among them; the kit must never call it\n`);
    process.exit(70);
  }

  const terminal = (state.terminals ?? []).find((entry) => entry.handle === flag('--terminal'));
  if (!terminal) fail('terminal_not_found', `no terminal with handle ${flag('--terminal')}`);

  // A tab here holds one terminal, so the terminal goes either way; whether the
  // kit asked for the whole tab is in calls.log for a test to read. The answer
  // is the one the real call gave when it was measured (tech notes, section 1).
  //
  // With `closeLag` the answer comes back the same and the tab stays in the
  // listing a while longer, which is what Orca really does.
  const lag = state.closeLag ?? 0;
  if (lag > 0) {
    terminal.closingFor = lag;
  } else {
    state.terminals = state.terminals.filter((entry) => entry !== terminal);
  }
  save();
  ok({
    close: {
      handle: terminal.handle,
      tabId: terminal.tabId,
      closeMode: args.includes('--tab') ? 'tab' : 'pane',
      ptyKilled: false,
    },
  });
}

// One terminal by its handle. Proved live on 1.4.207: for a terminal `list`
// reports as `pty:<ptyId>`, `show` gives the real tab id, with `orphaned: true`
// still set. Only the listing substitutes the id.
if (command === 'terminal show') {
  const terminal = (state.terminals ?? []).find((entry) => entry.handle === flag('--terminal'));
  if (!terminal) fail('terminal_not_found', `no terminal with handle ${flag('--terminal')}`);
  const { typed: _typed, notices: _notices, closingFor: _closingFor, ...rest } = terminal;
  ok({ terminal: { ...rest, ...identity(), orphaned: terminal.orphaned === true } });
}

if (command === 'terminal rename') {
  const terminal = (state.terminals ?? []).find((entry) => entry.handle === flag('--terminal'));
  if (!terminal) fail('terminal_not_found', `no terminal with handle ${flag('--terminal')}`);

  // Orca: omit --title or pass an empty string to reset to the auto title.
  terminal.title = flag('--title') ?? '';
  save();
  ok({ terminal: asReported(terminal) });
}

if (command === 'terminal wait') {
  const terminal = (state.terminals ?? []).find((entry) => entry.handle === flag('--terminal'));
  if (!terminal) fail('terminal_not_found', `no terminal with handle ${flag('--terminal')}`);

  // One answer per call when a test gave a list, so a tab can hold a TUI on
  // one look and none on the next; the last entry stands for every call after.
  const idle = Array.isArray(state.waitIdle)
    ? state.waitIdle[Math.min(Math.max(callsSoFar() - 1 - (state.waitIdleFrom ?? 0), 0), state.waitIdle.length - 1)]
    : state.waitIdle;

  // `tui-idle` asks about a TUI, not about a shell. Seen live: a tab with no
  // TUI in it — a clean zsh prompt — is refused with `timeout`, however long
  // the wait. And so is a harness that is busy (Orca 1.4.209, #232): a
  // timeout says nothing was idle, not that nothing was there.
  if (idle === false || idle === 'busy') fail('timeout', 'timeout');

  // A TUI that is up but has something to answer — a harness sitting on its
  // folder-trust question, which is the first run of every new bot. It is up,
  // so the harness started, and `satisfied` says nothing about that.
  //
  // 'quit' answers as an idle TUI does, and there is none: seen live after
  // Codex quit to the shell, the plain shell was ok and satisfied (#232).
  const blocked = idle === 'blocked';
  ok({
    status: blocked ? 'running' : 'idle',
    wait: {
      satisfied: !blocked,
      for: flag('--for') ?? 'tui-idle',
      timeoutMs: Number(flag('--timeout-ms') ?? 0),
      ...(blocked ? { blockedReason: 'agent-interactive-prompt' } : {}),
    },
  });
}

if (command === 'terminal send') {
  const terminal = (state.terminals ?? []).find((entry) => entry.handle === flag('--terminal'));
  if (!terminal) fail('terminal_not_found', `no terminal with handle ${flag('--terminal')}`);

  terminal.typed = [...(terminal.typed ?? []), { text: flag('--text') ?? '', enter: args.includes('--enter') }];
  // Orca learns which agent is in a tab once it runs there. The fake gives it
  // at once; a test that wants it late says so with `agentIdentity`.
  if (terminal.typed.length === 1 && launchedIn(terminal) !== undefined && terminal.agentIdentity == null) {
    terminal.agentIdentity = launchedIn(terminal);
  }
  save();
  // `accepted: true` means the input was accepted, not that anything read it.
  ok({ accepted: true, terminal: terminal.handle });
}

// What each pane costs, and the pid of the process each pane runs: the one
// place Orca gives a tab's pid (#232). The shape is the one Orca 1.4.209
// answered with, key for key: a worktree per project, and in each a session
// per pane whose `sessionId` is the tab's `ptyId`. The pid is the pane's own
// process — on macOS `/usr/bin/login`, with the shell under it — and the fake
// `ps` answers for it. What the app, host and totals carry was not written
// down, so their values here are the fake's own.
if (command === 'diagnostics memory') {
  const MEMORY = 12386304;
  const worktrees = [];
  for (const terminal of state.terminals ?? []) {
    let worktree = worktrees.find((one) => one.worktreePath === terminal.worktreePath);
    if (worktree === undefined) {
      const setup = setupAt(terminal.worktreePath);
      worktree = {
        worktreePath: terminal.worktreePath,
        worktreeId: terminal.worktreeId,
        worktreeName: path.basename(terminal.worktreePath ?? ''),
        repoId: setup?.repoId ?? null,
        repoName: setup?.displayName ?? null,
        cpu: 0,
        memory: 0,
        sessions: [],
        history: [],
      };
      worktrees.push(worktree);
    }
    if (foregroundOf(state, terminal, dir) === 'no-pid') continue;
    worktree.memory += MEMORY;
    worktree.sessions.push({ sessionId: terminal.ptyId, paneKey: terminal.paneKey, pid: panePid(state, terminal), cpu: 0, memory: MEMORY });
  }
  const shown = worktrees.map(({ worktreePath: _path, ...rest }) => rest);
  const totalMemory = shown.reduce((sum, one) => sum + one.memory, 0);
  ok({
    app: { cpu: 0, memory: 0 },
    worktrees: shown,
    host: { cpu: 0, memory: 0 },
    processMemoryMetric: 'rss',
    totalCpu: 0,
    totalMemory,
    collectedAt: 1790251200000,
  });
}

// The mailbox. Everything below was proved live on 2026-09-21 and is written
// down in the tech notes, section 1: a Run is the only address that lasts, a
// send to a terminal handle is a legacy mailbox that dies with the tab, reading
// a Run is fenced to one bound reader, and a message is replayed until it is
// acked. What the kit never does — `reply --id`, the broadcast groups,
// `orchestration reset` — this fake does not answer at all.

/**
 * The terminal the calling process runs in: its `ORCA_TERMINAL_HANDLE`, which
 * Orca sets in every pane. A plain shell outside Orca has none.
 */
const caller = process.env.ORCA_TERMINAL_HANDLE;

const runNamed = (id) => (state.runs ?? []).find((run) => run.id === id);

/** The Run a terminal is the coordinator of, if any: one terminal holds one Run. */
const runHeldBy = (handle) => (state.runs ?? []).find((run) => run.coordinator_handle === handle);

/**
 * The terminal a `run-create` or `run-use` binds: `--from` when it is given,
 * the caller's own otherwise. Both refusals are Orca's own, seen live on
 * 1.4.209. A handle with no live pane cannot coordinate anything. And a caller
 * with no terminal of its own that names none is refused rather than handed
 * one: Orca 1.4.205 once gave such a caller a handle, but 1.4.209 refuses it
 * whenever it cannot pick a terminal unambiguously, which on a machine with a
 * fleet's worth of tabs is always. So the fake refuses it every time. A fake
 * that went on binding a made-up terminal would pass a kit that leaves `--from`
 * off from a plain shell, and the real Orca would refuse that kit.
 */
function coordinatorFor() {
  const wanted = flag('--from') ?? caller;
  if (wanted === undefined) {
    fail(
      'no_active_sender_terminal',
      'Could not determine the sender terminal for this orchestration command. Pass --from with your own '
        + 'terminal\'s handle — another pane\'s handle would act on its mailbox — or run the command inside a '
        + 'live Orca terminal with ORCA_TERMINAL_HANDLE set.',
    );
  }
  if (!(state.terminals ?? []).some((terminal) => terminal.handle === wanted)) {
    fail(
      'stable_pane_required',
      'The coordinator terminal has no stable pane identity. Run this command inside a live Orca terminal.',
    );
  }
  return wanted;
}

/**
 * Make `handle` the coordinator of `run`. One terminal holds one Run, so the
 * Run it held before is left with no coordinator at all (seen live: `run-use
 * --id RB --from A` left RA's `coordinator_handle` empty and RB bound to A).
 */
function bind(run, handle) {
  for (const held of state.runs ?? []) {
    if (held.coordinator_handle === handle && held !== run) held.coordinator_handle = null;
  }
  run.coordinator_handle = handle;
  run.updated_at = STAMP;
}

/** A fixed time for every Run: nothing the kit does reads it. */
const STAMP = '2026-09-24T12:00:00.000Z';

/** `run:<id>` is the durable address; a bare `term_…` is the legacy one. */
const runIn = (address) => (typeof address === 'string' && address.startsWith('run:') ? address.slice('run:'.length) : undefined);

if (command === 'orchestration run-create') {
  const coordinator = coordinatorFor();
  const n = state.nextId ?? 1;
  state.nextId = n + 1;
  // Orca's own record of a Run, field for field as `run-show` answers it.
  const run = {
    id: `run_${n}`,
    objective: flag('--objective') ?? '',
    coordinator_handle: null,
    consumer_generation: 0,
    legacy: false,
    created_at: STAMP,
    updated_at: STAMP,
  };
  state.runs = [...(state.runs ?? []), run];
  bind(run, coordinator);
  save();
  ok({ run, terminal: coordinator });
}

if (command === 'orchestration run-use') {
  const wanted = runNamed(flag('--id'));
  if (wanted === undefined) fail('run_not_found', `no run with id ${flag('--id')}`);
  bind(wanted, coordinatorFor());
  save();
  ok({ run: wanted });
}

if (command === 'orchestration run-show') {
  const wanted = runNamed(flag('--id'));
  if (wanted === undefined) fail('run_not_found', `no run with id ${flag('--id')}`);
  ok({ run: wanted });
}

if (command === 'orchestration send') {
  const to = flag('--to');
  if (to === undefined) fail('missing_argument', 'send needs --to');

  const warnings = [];
  const run = runIn(to);
  if (run !== undefined) {
    if (runNamed(run) === undefined) fail('run_not_found', `no run with id ${run}`);
  } else if ((state.terminals ?? []).some((terminal) => terminal.handle === to)) {
    warnings.push({
      code: 'legacy_terminal_recipient',
      message: `${to} is a live terminal-only mailbox. Delivery is not durable after that terminal closes.`,
    });
  } else {
    fail('recipient_not_found', `${to} has no live pane or durable Run/Dispatch mailbox`);
  }

  const n = state.nextId ?? 1;
  state.nextId = n + 1;
  const message = {
    id: `msg_${n}`,
    to,
    from: flag('--from') ?? null,
    subject: flag('--subject') ?? '',
    body: flag('--body') ?? '',
    type: flag('--type') ?? 'status',
    priority: flag('--priority') ?? 'normal',
    threadId: flag('--thread-id') ?? null,
    at: `2026-09-21T12:00:0${n % 10}.000Z`,
    acked: false,
  };
  state.messages = [...(state.messages ?? []), message];

  // Orca's own notice goes into the coordinator terminal of the Run the mail
  // was sent to, and nowhere else; a Run with no coordinator gives none at all.
  // Live it also wants an idle agent in that tab, which the fake does not ask.
  const held = run === undefined ? undefined : runNamed(run).coordinator_handle;
  const coordinator = (state.terminals ?? []).find((terminal) => held != null && terminal.handle === held);
  if (coordinator !== undefined) {
    const waiting = state.messages.filter((entry) => entry.to === to && !entry.acked).length;
    coordinator.notices = [
      ...(coordinator.notices ?? []),
      `You have ${waiting} orchestration message. Run \`orca orchestration check --run ${run}\``,
    ];
  }
  save();

  ok({ message: asOrca(message), ...(warnings.length > 0 ? { warnings } : {}) });
}

/**
 * One message as Orca hands it over, rather than as this fake keeps it. The
 * field names are the ones the live check answered with on 2026-09-21; the
 * fake keeps its own shorter names so a test can read what is in the mailbox
 * without going through Orca's words for it.
 */
function asOrca(message) {
  return {
    id: message.id,
    to_handle: message.to,
    from_handle: message.from,
    subject: message.subject,
    body: message.body,
    type: message.type,
    priority: message.priority,
    thread_id: message.threadId,
    created_at: message.at,
  };
}

if (command === 'orchestration check') {
  // The reader is the terminal `--terminal` names, or else the caller's own.
  // Seen live on 1.4.209: `--terminal S` reads and acks as S from another tab
  // or from a shell with no Orca terminal, and the fence is judged against S's
  // binding, not the caller's. A reader bound to another Run is fenced out.
  // What Orca says to a reader with no terminal at all, or to a `--terminal`
  // with no live pane, was never measured, so the fake lets it read whatever
  // Run it names.
  const reader = flag('--terminal') ?? caller;
  const boundTo = reader === undefined ? undefined : runHeldBy(reader)?.id;
  const run = flag('--run') ?? boundTo;
  if (run === undefined) fail('no_run', 'this caller is bound to no run and none was named');
  if (runNamed(run) === undefined) fail('run_not_found', `no run with id ${run}`);

  if (boundTo !== undefined && boundTo !== run) {
    fail('consumer_fenced', `This coordinator terminal is bound to ${boundTo}, not ${run}.`);
  }

  /** This Run's mail, oldest first. `--all` asks for the acknowledged ones too. */
  const mailIn = () => (state.messages ?? [])
    .filter((message) => message.to === `run:${run}` && (args.includes('--all') || !message.acked));

  // A delivery is the batch a read hands over, and acknowledging it
  // acknowledges everything up to and including it: FIFO, and replayed until
  // acked, so a reader that never acked would be given the same mail for ever.
  const acked = [];
  const wanted = flag('--ack');
  if (wanted !== undefined) {
    const upTo = (state.messages ?? []).findIndex((entry) => entry.id === wanted);
    if (upTo < 0) fail('delivery_not_found', `no delivery with id ${wanted}`);
    for (const message of mailIn()) {
      if ((state.messages ?? []).indexOf(message) > upTo) continue;
      message.acked = true;
      acked.push(message.id);
    }
    save();
  }

  const waiting = mailIn();
  ok({
    run,
    messages: waiting.map(asOrca),
    // What to acknowledge when this batch has been read.
    ...(waiting.length > 0 ? { deliveryId: waiting[waiting.length - 1].id } : {}),
    ...(acked.length > 0 ? { acked } : {}),
  });
}

/**
 * The recurrence Orca writes for a daily trigger at HH:MM. Taken from a real
 * answer: 04:00 comes back as `FREQ=DAILY;BYHOUR=4;BYMINUTE=0`, the numbers
 * unpadded.
 */
const rruleFor = (time) => {
  const [hour, minute] = time.split(':');
  return `FREQ=DAILY;BYHOUR=${Number(hour)};BYMINUTE=${Number(minute)}`;
};

const automationWith = (id) => (state.automations ?? []).find((one) => one.id === id);

if (command === 'automations list') {
  ok({ automations: state.automations ?? [] });
}

if (command === 'automations create') {
  const name = flag('--name');
  if (name === undefined) fail('missing_argument', 'automations create needs --name');

  const target = worktreePathOf(flag('--workspace'));
  const setup = target === undefined ? undefined : setupAt(target);
  if (!setup) fail('selector_not_found', `no workspace matches ${flag('--workspace')}`);

  const trigger = flag('--trigger');
  if (trigger !== 'daily') fail('invalid_argument', `this fake only makes daily automations, got ${trigger}`);
  const time = flag('--time');
  if (time === undefined) fail('missing_argument', '--trigger daily needs --time');

  const n = state.nextId ?? 1;
  state.nextId = n + 1;
  const automation = {
    id: `auto_${n}`,
    name,
    enabled: !args.includes('--disabled'),
    rrule: rruleFor(time),
    provider: flag('--provider'),
    prompt: flag('--prompt'),
    runContext: { path: setup.path, projectId: setup.projectId, projectHostSetupId: setup.id },
  };
  // Nothing here looks at the name first: see the note on `automations` above.
  state.automations = [...(state.automations ?? []), automation];
  save();
  ok({ automation });
}

if (command === 'automations edit') {
  const automation = automationWith(flag('--id'));
  if (!automation) fail('automation_not_found', `no automation with id ${flag('--id')}`);
  if (args.includes('--enabled') && args.includes('--disabled')) {
    fail('invalid_argument', '--enabled and --disabled are opposites');
  }

  const time = flag('--time');
  if (time !== undefined) {
    // Orca's own refusal, word for word: a time needs something to hang on.
    if (flag('--trigger') === undefined && flag('--schedule') === undefined) {
      fail('invalid_argument', '--time requires --trigger or --schedule');
    }
    automation.rrule = rruleFor(time);
  }
  if (args.includes('--enabled')) automation.enabled = true;
  if (args.includes('--disabled')) automation.enabled = false;
  if (flag('--name') !== undefined) automation.name = flag('--name');
  if (flag('--prompt') !== undefined) automation.prompt = flag('--prompt');
  save();
  ok({ automation });
}

if (command === 'automations remove') {
  const automation = automationWith(flag('--id'));
  if (!automation) fail('automation_not_found', `no automation with id ${flag('--id')}`);
  state.automations = state.automations.filter((one) => one !== automation);
  save();
  ok({ removed: { id: automation.id, name: automation.name } });
}

fail('unknown_command', `orca has no "${command}" command in this fake`);
