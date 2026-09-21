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
//   terminals   [{ handle, tabId, worktreePath, title, typed: [...], ... }]
//   repoAddKind the kind `repo add` registers a folder as (Orca says "git" for
//               a folder inside a git repo, which is why the kit must correct it)
//   reachable   false: the app answers but its runtime is not there
//   status      an answer for `status` to print instead of its own (null counts)
//   waitIdle    what `terminal wait --for tui-idle` finds in the tab:
//                 true (default) a TUI that is up and idle: ok, satisfied
//                 'blocked'      a TUI that is up with something to answer:
//                                ok, not satisfied, agent-interactive-prompt
//                 false          no TUI at all — a plain shell prompt — which
//                                Orca reports by refusing with `timeout`
//               A list is one of those per call of `terminal wait`, the last
//               entry answering every call after it. [true, false] is a tab
//               the harness came up in and then died in: the thing a single
//               look cannot tell from a harness that is running.
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

const dir = process.env.OBK_FAKE_ORCA_DIR;
if (dir === undefined) {
  process.stderr.write('fake orca: OBK_FAKE_ORCA_DIR is not set\n');
  process.exit(70);
}

const stateFile = path.join(dir, 'state.json');
const args = process.argv.slice(2);
appendFileSync(path.join(dir, 'calls.log'), `${JSON.stringify({ args, cwd: process.cwd() })}\n`);

const state = JSON.parse(readFileSync(stateFile, 'utf8'));
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

/**
 * What Orca reports about a tab. What was typed into it is ours, and stays
 * ours, and so is how many more listings a closed tab still shows up in.
 */
const asReported = ({ typed: _typed, closingFor: _closingFor, ...rest }) => rest;

if (command === 'terminal list') {
  const target = worktreePathOf(flag('--worktree'));
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

  const terminal = {
    handle: `term_${n}`,
    tabId: `tab_${n}`,
    paneKey: `tab_${n}:pane_${n}`,
    ptyId: `pty_${n}`,
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
    ? state.waitIdle[Math.min(callsSoFar() - 1, state.waitIdle.length - 1)]
    : state.waitIdle;

  // `tui-idle` asks about a TUI, not about a shell. Seen live: a tab with no
  // TUI in it — a clean zsh prompt — is refused with `timeout`, however long
  // the wait. So this is how the kit learns that nothing took.
  if (idle === false) fail('timeout', 'timeout');

  // A TUI that is up but has something to answer — a harness sitting on its
  // folder-trust question, which is the first run of every new bot. It is up,
  // so the harness started, and `satisfied` says nothing about that.
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
  save();
  // `accepted: true` means the input was accepted, not that anything read it.
  ok({ accepted: true, terminal: terminal.handle });
}

fail('unknown_command', `orca has no "${command}" command in this fake`);
