// A system test: fleet mail and temporary sessions work from inside a Codex
// session's sandbox, with no escalation, and the sandbox still keeps the
// session out of another bot's mail (#534). Against the real Orca and a real
// Codex on this machine. Run it alone with
// `npm run test:system -- --yes test/system/codex-sandbox-writes.test.js`;
// `npm test` cannot, and no CI machine could.
//
// At the kit's default `auto` level Codex runs in its `workspace-write`
// sandbox. Its cwd is its bot's folder, `<bots>/bots/<bot>`, and it may write
// only there, in /tmp, in $TMPDIR and in each `--add-dir` folder (tech notes,
// section 3). Before #534 the kit wrote long message bodies to
// `<bots>.messages/`, start prompts to `<bots>.prompts/` and SQLite lock files
// to `<bots>.locks/`, all outside those places. So a send with a long body and
// `obk temp make` failed with EPERM, or went through only when Codex's
// automatic reviewer granted an escalation.
//
// What it proves, in a throwaway fleet of two Codex bots at `auto`:
//
//   1. The sender, `sandbox-codex/daily`, runs `"$OBK_CLI" message send` with
//      a body over 4 KiB (`--text-file`, a file the test wrote in the sender's
//      own folder) to `sandbox-peer/daily`. The kit's answer says it was sent
//      to the peer's Run and names a body file under
//      `<bots>.messages/sandbox-codex/`, which holds the text word for word.
//      Orca's inbox holds the message for the peer's Run, and its body names
//      that file.
//   2. The sender runs `"$OBK_CLI" temp make` for `scout`, a temporary session
//      of its own bot, with a long task (`--prompt-file`), so the kit writes a
//      start-prompt file. The answer says scout's tab was opened with its
//      harness started, the book names scout temporary with maker `daily`, and
//      the prompt file is `<bots>.prompts/sandbox-codex/scout.txt`. The sender
//      then runs `"$OBK_CLI" temp retire` for scout: scout is on the retired
//      list, its tab is closed and its prompt file is gone.
//   3. The sender tries to write `intrusion.txt` into each of the peer's three
//      folders, `<bots>.messages/sandbox-peer/`, `<bots>.prompts/sandbox-peer/`
//      and `<bots>.locks/sandbox-peer/`, which the test made beforehand from
//      outside the sandbox. Each shell's exit status is not 0, and no file is
//      there afterwards.
//   3b. Two holders contend for one lock, and the sandboxed one waits: the
//      void lock of #534, live. When the sender says it has reached its mail
//      check, a child process of the test's own, outside the sandbox, takes
//      the sender's mailbox turn (`<bots>.locks/sandbox-codex/
//      sandbox-codex.daily.mailbox.lock`, BEGIN IMMEDIATE) and holds it 8 s.
//      The sender waits until the holder says it holds the turn, then runs
//      `"$OBK_CLI" message check` and writes when it started and ended. The
//      check works, it started while the turn was held, and it ended only
//      after the holder let go. Before #534 the sandbox opened the lock file
//      read-only, BEGIN IMMEDIATE passed beside the holder, and the check
//      returned at once. The holder ends by itself; if it is still running
//      at the end, it is stopped by its own pid, and nothing else is.
//   4. No escalation. The sender's own rollout, found by the conversation id
//      the kit's hook wrote into the book, is read as
//      test/system/permissions.test.js reads one: each shell command, with
//      whether it asked for `sandbox_permissions: "require_escalated"`. Not
//      one of the send, the temp make, the temp retire and the mail check
//      asked, and none of them came back refused. No rollout of Codex's
//      automatic reviewer (`thread_source: "guardian_review"`,
//      `parent_thread_id` the sender's conversation) names any of the four.
//
// Step 3 and escalation. The sender's prompt tells it to run every command in
// its sandbox as written, never to ask for approval or escalation, and not to
// retry a command that failed. A Codex that asks all the same, for the
// intrusion alone, is said as a diagnostic: what the test holds is that the
// file is not there. A reviewer that granted it would have let the command
// write the file, and the test fails on that.
//
// Where the fleet lives, and why not in the temp folder. The sandbox lets a
// session write anywhere under /tmp and $TMPDIR, so a bots folder there would
// let every write through, the fix or not, and the test would show nothing. So
// this test makes its bots folder under the checkout's own `local-data/`,
// which .gitignore keeps out of git, and checks that premise against the
// $TMPDIR the sender itself sees. The folder is named `obk-system-…` and sits
// directly in `local-data/`, which is where the runner (scripts/test-system.js)
// looks for a run's own folders besides the temp folder: for a Codex trust key
// the run left, and for an Orca project it left (#536). Every Codex here is
// launched with its trust given at launch (helpers/codex-trust.js), so no key
// is expected; not seen live.
//
// The sender also writes the exit status of a `/bin/ps` it runs, as
// codex-nudge does: inside the sandbox `ps` does not start, so a status of 0
// is a run outside the sandbox that shows nothing about #534.
//
// The machine it runs on is someone's working machine. So this test, like the
// ones beside it: works in its own throwaway bots folder; writes down every
// terminal and workspace Orca already had; runs this checkout's `src/cli.js`
// by its full path, never the machine's `obk` (#220), and the sessions reach
// the kit through the `$OBK_CLI` their launch line set; types into no tab at
// all; closes only its own tabs, one by one through the tab guard, and
// deletes its own workspaces through deleteOwnProject (#536), whatever
// happened, failing on any it could not remove; and removes the bots folder
// and every folder of the kit's beside it. `orca terminal close --worktree …
// --all` is never run, and the guard refuses it. Each run leaves the fleet's
// orchestration Runs behind, which Orca offers no way to delete.
//
// **Nobody answers anything by hand.** Both Codex sessions, and scout, are
// given their folder's trust at launch, which also bypasses the hooks review,
// so they should ask nothing. A question of a harness's own in one of them
// (helpers/screens.js `waitingOn`, the shared look) is not answered: the wait
// fails, printing the screen. This test opens no Claude Code tab of its own,
// so it has no screen to answer through `onlyPlainTrustOf` or
// `onlyTeachFormOf`. The throwaway fleet's Bot Father tab may show Claude
// Code's folder trust; nothing here waits on it or types into it, and it is
// closed at the end with the rest.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, realpath, rm, rmdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry, repoRoot, shellWord } from '../helpers/cli.js';
import { codexTrustArgs } from '../helpers/codex-trust.js';
import { deleteOwnProject } from '../helpers/own-project.js';
import { rolloutFilesOf } from '../helpers/codex-rollout.js';
import { waitingOn } from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/**
 * Remove the throwaway bots folder and everything the kit or this test made
 * beside it: `<bots>.messages`, `<bots>.prompts`, `<bots>.locks` and the rest
 * are siblings of it, not children (PRD 6.3).
 */
async function removeBotsFolderAndSiblings(bots) {
  const parent = path.dirname(bots);
  const mine = path.basename(bots);
  const ours = async () => (await readdir(parent)).filter((name) => name === mine || name.startsWith(`${mine}.`));

  for (const name of await ours()) {
    await rm(path.join(parent, name), { recursive: true, force: true });
  }
  assert.deepEqual(await ours(), [], `this test left folders behind in ${parent}`);
}

/** The Orca CLI that works for a normal user (tech notes, section 1). */
const ORCA = process.env.OBK_ORCA || '/Applications/Orca.app/Contents/Resources/bin/orca';

/** When this test began: rollouts of Codex's reviewer older than this are not looked at. */
const STARTED = Date.now();

/** How long a tab is given to get past the screens of its own. */
const READY_MS = 180000;

/** How long the sender is given for all its commands, each of which may wait on Orca. */
const WORK_MS = 600000;

/** How long the kit's hook is given to have written the book after a session starts. */
const HOOK_MS = 60000;

const SENDER = 'sandbox-codex';
const PEER = 'sandbox-peer';
const SESSION = 'daily';
const TEMP = 'scout';

/** The message's subject, and a word only its body holds. */
const SUBJECT = 'a long body SUBJ-5340';
const BODY_WORD = 'OSPREY-5341';

/** The body: over 4 KiB, so the kit writes it to a file (INLINE_LIMIT in src/message.js). */
const LONG_BODY = `${BODY_WORD}\n${'This line is part of a long message body, for a system test of #534.\n'.repeat(80)}`;

/** scout's task: long enough that the kit keeps it in a start-prompt file, and asking for nothing. */
const TASK = 'You are a system test\'s temporary session and you own nothing. Do not run any command, read or write any file,'
  + ' or use any tool. Say nothing now and wait. '
  + 'This session exists only to be made and retired by the session that made it. '.repeat(6);

/** Every close goes through the guard, which counts it for the check at the end (#246). */
const guard = tabGuard(ORCA);
const { orca } = guard;

/** Every terminal Orca knows about right now. */
function allTerminals() {
  const answer = orca(['terminal', 'list']);
  assert.equal(answer.ok, true, `orca terminal list failed: ${JSON.stringify(answer.error)}`);
  return answer.result.terminals;
}

/** The terminals in one workspace, by the path they were opened in. */
const terminalsAt = (home) => allTerminals().filter((terminal) => terminal.worktreePath === home);

/** The tabs Orca lists at `home` once it has caught up with what was closed (#187). */
async function terminalsAfterClosing(home, closed, within = 5000) {
  const until = Date.now() + within;
  let left = terminalsAt(home);
  while (left.some((terminal) => closed.includes(terminal.handle)) && Date.now() < until) {
    await setTimeout(250);
    left = terminalsAt(home);
  }
  return left;
}

/** Every workspace Orca knows about right now. */
function allSetups() {
  const answer = orca(['project', 'setups']);
  assert.equal(answer.ok, true, `orca project setups failed: ${JSON.stringify(answer.error)}`);
  return answer.result.setups;
}

/**
 * The environment of wherever this test was started, without anything that
 * names an Orca tab or the kit's launch line: the test may itself run in an
 * Orca tab, and a command of the kit's must not take that tab for its caller.
 */
const outsideAnyTab = Object.fromEntries(Object.entries(process.env)
  .filter(([name]) => !name.startsWith('ORCA_') && name !== 'OBK_CLI' && name !== 'OBK_TAB_SHELL'));

/** Run this checkout's `obk`, by its full path (#217, #220), outside any tab. */
function obk(args) {
  const done = spawnSync(process.execPath, [cliEntry, ...args], { encoding: 'utf8', cwd: os.tmpdir(), env: outsideAnyTab });
  assert.equal(done.error, undefined, `could not run \`obk\`: ${done.error?.message}`);
  assert.ok(!/worktree/i.test(done.stdout + done.stderr), `obk said "worktree": ${done.stdout}${done.stderr}`);
  return done;
}

/** Run `obk ... --json` and read the answer it printed; every tab it says it opened is counted as this test's. */
function obkJson(args) {
  const done = obk([...args, '--json']);
  assert.equal(done.status, 0, `obk ${args.join(' ')} failed: ${done.stdout}${done.stderr}`);
  try {
    return guard.openedByKit(JSON.parse(done.stdout));
  } catch {
    assert.fail(`obk ${args.join(' ')} --json did not print JSON: ${done.stdout}`);
  }
}

/** The entry for one tab in an `obk --json` answer. */
function tabOf(answer, name) {
  const found = (answer.tabs ?? []).filter((entry) => entry.name === name);
  assert.equal(found.length, 1, `one entry should be the ${name} tab, got: ${JSON.stringify(answer.tabs)}`);
  return found[0];
}

/** The bot's book as it stands. */
const bookOf = (home) => parse(readFileSync(path.join(home, 'sessions.yaml'), 'utf8')) ?? {};

/** What the book says about one of the bot's sessions right now. */
const sessionIn = (home, name) => bookOf(home).sessions?.[name] ?? {};

/** Keep asking until `look` gives something other than undefined, or the time runs out. */
async function until(what, within, look, note = () => '') {
  const stop = Date.now() + within;
  for (;;) {
    const found = await look();
    if (found !== undefined) return found;
    assert.ok(Date.now() < stop, `gave up waiting for ${what} after ${within}ms.${note()}`);
    await setTimeout(1000);
  }
}

/** Everything the tab is rendering right now, as one piece of text to look through. */
function screenOf(handle) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  return answer.ok === true ? JSON.stringify(answer.result) : '';
}

/** What the tab is showing, for the message of a wait that ran out. */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  return [
    blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`,
    ' This test answers nothing a tab asks.',
    `\n  orca terminal read --terminal ${handle} --screen\n  ${screenOf(handle).slice(0, 2000)}`,
  ].join('');
}

/**
 * Wait until a tab is past the screens of its own: a TUI is up, Orca reports
 * nothing waiting to be answered on it, and its screen shows no question of
 * the harness's own (#329). Nothing is typed here; this only waits.
 */
async function pastItsScreens(handle, within = READY_MS) {
  await until(
    `${handle} to be past the screens of its own`,
    within,
    async () => {
      const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '5000']);
      if (answer.ok !== true) return undefined;
      if (answer.result?.wait?.blockedReason !== undefined) return undefined;
      return waitingOn(orca, handle) === undefined ? true : undefined;
    },
    () => `${waitingOn(orca, handle) ?? ''}${whatIsUp(handle)}`,
  );
}

/** A file's text once it has some, or undefined while it is not there or empty. */
function textIn(file) {
  if (!existsSync(file)) return undefined;
  const text = readFileSync(file, 'utf8');
  return text.trim() === '' ? undefined : text;
}

/** The one JSON answer in a file, or a failure that shows what the file holds instead. */
function answerIn(file, what) {
  const text = textIn(file);
  assert.notEqual(text, undefined, `${what}: the sender should have written the kit's answer to ${file}, and it is not there`);
  try {
    return JSON.parse(text);
  } catch {
    return assert.fail(`${what}: the kit's answer in ${file} is not the JSON of a run that worked:\n${text}`);
  }
}

/** How many of the newest messages on the machine the inbox is asked for: far more than this test sends. */
const INBOX_LIMIT = 100;

/**
 * Orca's inbox entries for one Run, as codex-nudge.test.js reads them (see its
 * header for what this rests on). Everything else the inbox lists belongs to
 * other people and is dropped here, before anything can print it.
 */
function inboxOf(run) {
  const asked = `orca orchestration inbox --json --limit ${INBOX_LIMIT}`;
  const done = spawnSync(ORCA, ['orchestration', 'inbox', '--json', '--limit', String(INBOX_LIMIT)], { encoding: 'utf8' });
  assert.equal(done.error, undefined, `could not run ${ORCA}: ${done.error?.code}`);
  let answer;
  try {
    answer = JSON.parse(done.stdout);
  } catch {
    assert.fail(`${asked} exited ${done.status} and did not answer JSON (${done.stdout.length} characters on stdout, ${done.stderr.length} on stderr; not shown, as they may hold other people's mail)`);
  }
  assert.equal(
    answer?.ok,
    true,
    `${asked} was refused: error code ${JSON.stringify(answer?.error?.code ?? null)} (Orca's message is not shown, as it may quote other people's mail)`,
  );
  const all = answer.result?.messages;
  assert.ok(Array.isArray(all), `the inbox should answer a list of messages, and answered ${all === undefined ? 'none' : typeof all}`);
  return all
    .filter((message) => message?.run_id === run)
    .map(({ run_id: runId, to_handle: to, read, subject, body }) => ({ runId, to, read, subject, body }));
}

// ------------------------------------------------------------ Codex's record
//
// Read as test/system/permissions.test.js reads it (its header says what each
// form is): a 0.157.1 `custom_tool_call` named `exec` whose script calls
// `tools.exec_command({ cmd: ... })`, or an older `function_call` named
// `exec_command` with `cmd` in its JSON arguments; each command's result under
// the same `call_id`.

/** Every JSON line of a rollout that parses, in order; a line still being written is left for the next look. */
function rolloutLines(file) {
  const lines = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    try {
      lines.push(JSON.parse(line));
    } catch {
      // not a whole line yet
    }
  }
  return lines;
}

/** The text of a Codex tool result: a string, a list of `{ type, text }`, or an object holding either. */
const codexTextOf = (output) => (typeof output === 'string'
  ? output
  : Array.isArray(output)
    ? output.map((item) => (typeof item === 'string' ? item : item?.text ?? '')).join('\n')
    : output !== null && typeof output === 'object' ? codexTextOf(output.content ?? output.output ?? '') : '');

/** What a refusal says in a Codex result: a rule forbidding it, a script that failed, or the sandbox stopping it. */
const CODEX_REFUSED = /Script failed|Rejected\(|policy forbids|Operation not permitted/i;

/** A JavaScript string literal in a Codex `exec` script, as its value: double, single or backtick quoted. */
function jsStringAt(text) {
  const quote = text[0];
  if (!['"', "'", '`'].includes(quote)) return undefined;
  let value = '';
  for (let at = 1; at < text.length; at += 1) {
    const char = text[at];
    if (char === quote) return value;
    if (char === '\\') {
      const next = text[at + 1];
      value += { n: '\n', t: '\t', r: '\r' }[next] ?? next;
      at += 1;
    } else {
      value += char;
    }
  }
  return undefined;
}

/** The commands of one Codex 0.157.1 `exec` script, in order, each with whether it asked to leave the sandbox. */
function commandsOfScript(input) {
  return String(input).split('exec_command(').slice(1).flatMap((call) => {
    const found = /\bcmd\s*:\s*/.exec(call);
    const text = found === null ? undefined : jsStringAt(call.slice(found.index + found[0].length));
    return text === undefined ? [] : [{ text, escalated: /sandbox_permissions\s*:\s*["'`]require_escalated/.test(call) }];
  });
}

/** The commands a Codex rollout made, oldest first: `{ text, escalated, result: { error, output } }`. */
function codexCommands(file) {
  const uses = [];
  const results = new Map();
  for (const entry of rolloutLines(file)) {
    if (entry?.type !== 'response_item') continue;
    const item = entry.payload ?? {};
    if (item.type === 'custom_tool_call' && item.name === 'exec') {
      for (const command of commandsOfScript(item.input)) uses.push({ id: item.call_id, ...command });
    } else if (item.type === 'function_call' && item.name === 'exec_command') {
      let args = {};
      try {
        args = JSON.parse(item.arguments);
      } catch {
        // an argument list still being written
      }
      const text = Array.isArray(args.cmd) ? args.cmd.join(' ') : String(args.cmd ?? '');
      uses.push({ id: item.call_id, text, escalated: args.sandbox_permissions === 'require_escalated' });
    } else if (item.type === 'custom_tool_call_output' || item.type === 'function_call_output') {
      const output = codexTextOf(item.output);
      results.set(item.call_id, { error: CODEX_REFUSED.test(output), output });
    }
  }
  return uses.map(({ id, ...use }) => ({ ...use, result: results.get(id) }));
}

/**
 * The folders of Codex's own record a rollout begun during this test can be
 * in: `~/.codex/sessions/<yyyy>/<mm>/<dd>`, from the day before it began to
 * the day after now, by local and by UTC date. Only read.
 */
function rolloutDays() {
  const days = new Set();
  for (let at = STARTED - 86400000; at <= Date.now() + 86400000; at += 86400000) {
    const day = new Date(at);
    for (const [year, month, date] of [
      [day.getFullYear(), day.getMonth() + 1, day.getDate()],
      [day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()],
    ]) {
      days.add(path.join(os.homedir(), '.codex', 'sessions', String(year), String(month).padStart(2, '0'), String(date).padStart(2, '0')));
    }
  }
  return [...days];
}

/** Every rollout written to since this test began, by its path. */
function rolloutsSince() {
  return rolloutDays()
    .flatMap((dir) => {
      try {
        return readdirSync(dir).filter((name) => name.startsWith('rollout-') && name.endsWith('.jsonl')).map((name) => path.join(dir, name));
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
    })
    .filter((file) => {
      try {
        return statSync(file).mtimeMs >= STARTED;
      } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
    });
}

/** The first line of a file, read without reading the rest: a rollout's `session_meta`. */
function firstLineOf(file) {
  const fd = openSync(file, 'r');
  try {
    const chunks = [];
    const buffer = Buffer.alloc(65536);
    for (let read = 0, total = 0; total < 8 * 1024 * 1024; total += read) {
      read = readSync(fd, buffer, 0, buffer.length, total);
      if (read === 0) break;
      const end = buffer.subarray(0, read).indexOf(0x0a);
      chunks.push(Buffer.from(buffer.subarray(0, end < 0 ? read : end)));
      if (end >= 0) break;
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/**
 * The texts of Codex's automatic reviewer's rollouts about conversation `id`:
 * `session_meta` with `parent_thread_id` the id and `thread_source:
 * "guardian_review"` (tech notes, section 3). One text per review, everything
 * it was given or said.
 */
function reviewsOf(id) {
  const reviews = [];
  for (const file of rolloutsSince()) {
    let meta;
    try {
      meta = JSON.parse(firstLineOf(file));
    } catch {
      continue;
    }
    if (meta?.payload?.parent_thread_id !== id || meta.payload.thread_source !== 'guardian_review') continue;
    const texts = [];
    for (const entry of rolloutLines(file)) {
      const item = entry?.payload ?? {};
      const said = entry?.type === 'response_item' && item.type === 'message'
        ? codexTextOf(item.content)
        : entry?.type === 'event_msg' && item.type === 'agent_message' ? String(item.message ?? '') : '';
      if (said !== '') texts.push(said);
    }
    reviews.push(texts.join('\n'));
  }
  return reviews;
}

// ------------------------------------------------------------- the sessions

/** How a bot here starts the kit: by the variable its launch line set, never a bare `obk` (#220). */
const KIT = '"$OBK_CLI"';

/** What every bot here is told, whatever its part. */
const aBotOf = (bots) => [
  'You are a system test\'s bot and you own nothing.',
  `Your bots folder is ${bots}.`,
];

/** The files the sender writes in its own folder, where its sandbox may write. */
const filesOf = (home) => ({
  body: path.join(home, 'long-body.md'),
  task: path.join(home, 'scout-task.md'),
  ps: path.join(home, 'ps-status.txt'),
  tmpdir: path.join(home, 'tmpdir.txt'),
  send: path.join(home, 'send-answer.json'),
  make: path.join(home, 'make-answer.json'),
  retire: path.join(home, 'retire-answer.json'),
  // The contended mail check: the sender says it is ready, waits for the
  // holder outside the sandbox to say it holds the turn, and writes when its
  // check started and ended (Date.now(), ms), the answer and the status.
  checkReady: path.join(home, 'check-ready.txt'),
  checkHeld: path.join(home, 'check-held.txt'),
  checkReleased: path.join(home, 'check-released.txt'),
  checkStart: path.join(home, 'check-start.txt'),
  check: path.join(home, 'check-answer.json'),
  checkStatus: path.join(home, 'check-status.txt'),
  checkEnd: path.join(home, 'check-end.txt'),
  intrusion: Object.fromEntries(KINDS.map((kind) => [kind, path.join(home, `intrusion-${kind}-status.txt`)])),
});

/** The kit's three folders beside the bots folder, each with a folder per bot (#534). */
const KINDS = ['messages', 'prompts', 'locks'];

/** The file the sender is told to write into the peer's folder of one kind, which its sandbox must refuse. */
const intrusionOf = (bots, kind) => path.join(`${bots}.${kind}`, PEER, 'intrusion.txt');

/**
 * The sender's own mailbox turn, the lock `message check` takes: in its bot's
 * folder of `<bots>.locks`, named as before #534 (the convention the unit
 * tests pin, test/helpers/cli.js `turnLockFile`).
 */
const mailboxLockOf = (bots) => path.join(`${bots}.locks`, SENDER, `${SENDER}.${SESSION}.mailbox.lock`);

/** How long the holder outside the sandbox holds the sender's mailbox turn. */
const HOLD_MS = 8000;

/** How long the sender waits, at most, for the holder to say it holds the turn. */
const HELD_WAIT_S = 180;

/** A shell word that prints the time now in ms, with the node the kit runs on. */
const NOW = `node -e 'process.stdout.write(String(Date.now()))'`;

/**
 * The sender's commands, in order. Each answer of the kit's is piped through
 * `tee` into a file in its own folder, stderr with it, so what the kit said
 * is on disk in its own words, refusal or not. `tee` rather than `>`: a
 * redirect the sandbox refused would stop the command from running at all.
 * The last command is the intrusion, so its status file says all are done.
 */
const senderCommands = (bots, home) => {
  const files = filesOf(home);
  const word = shellWord;
  return [
    `/bin/ps -o pid= -p 1 >/dev/null 2>&1; echo $? > ${word(files.ps)}; printf '%s' "$TMPDIR" > ${word(files.tmpdir)}`,
    `${KIT} message send --bots ${word(bots)} --to ${PEER}/${SESSION} --from ${SENDER}/${SESSION}`
      + ` --subject ${word(SUBJECT)} --text-file ${word(files.body)} --json 2>&1 | tee ${word(files.send)}`,
    `${KIT} temp make --bots ${word(bots)} --name ${TEMP} --prompt-file ${word(files.task)}`
      + ` ${codexTrustArgs(bots).map(word).join(' ')} --json 2>&1 | tee ${word(files.make)}`,
    `${KIT} temp retire --bots ${word(bots)} --name ${TEMP} --json 2>&1 | tee ${word(files.retire)}`,
    `${NOW} > ${word(files.checkReady)};`
      + ` for i in $(seq 1 ${HELD_WAIT_S}); do [ -s ${word(files.checkHeld)} ] && break; sleep 1; done;`
      + ` ${NOW} > ${word(files.checkStart)};`
      + ` ${KIT} message check --bots ${word(bots)} --bot ${SENDER} --session ${SESSION} --json > ${word(files.check)} 2>&1;`
      + ` echo $? > ${word(files.checkStatus)}; ${NOW} > ${word(files.checkEnd)}`,
    ...KINDS.map((kind) => `printf x > ${word(intrusionOf(bots, kind))}; echo $? > ${word(files.intrusion[kind])}`),
  ];
};

/** The sender: its commands, and how to run them. */
const senderPrompt = (bots, home) => [
  ...aBotOf(bots),
  'Do nothing that is not written here: read no file, write nothing but what these commands write,',
  'and run no command but the ones below.',
  'As soon as you are running, run exactly these commands, once each, in this order, each exactly as written,',
  'each as one shell command of its own, inside your sandbox.',
  'Never ask for approval, for escalation or for any permission outside your sandbox.',
  'If a command fails, do not retry it and do not change it: go on to the next one.',
  ...senderCommands(bots, home).map((command, at) => `Command ${at + 1}: ${command}`),
  'Then say nothing else and wait.',
].join(' ');

/** The peer: a receiver that does nothing. */
const peerPrompt = (bots) => [
  ...aBotOf(bots),
  'Do nothing at all: read no file, write nothing and run no command.',
  'If a line arrives saying fleet mail is waiting, do not read it and do not answer it.',
  'Say nothing and wait.',
].join(' ');

/**
 * Hold the SQLite lock on `file` the way the kit takes a turn (BEGIN
 * IMMEDIATE), from a child process of this test's own, outside the sandbox:
 * it writes the time it held the lock to `files.checkHeld`, holds it HOLD_MS,
 * lets it go, writes that time to `files.checkReleased`, and ends. Its script
 * sits beside the bots folder, where the teardown removes it. `done` is its
 * end, `{ code, stderr }`; `stop` ends it by its own pid if it is still
 * running, and does nothing otherwise.
 */
function holdTurn(bots, file, files) {
  const script = `${bots}.holder.cjs`;
  writeFileSync(script, [
    "const { mkdirSync, writeFileSync } = require('node:fs');",
    "const path = require('node:path');",
    "const { DatabaseSync } = require('node:sqlite');",
    `const FILE = ${JSON.stringify(file)};`,
    `mkdirSync(path.dirname(FILE), { recursive: true });`,
    'const db = new DatabaseSync(FILE);',
    "db.exec('PRAGMA busy_timeout = 20000');",
    "db.exec('BEGIN IMMEDIATE');",
    `writeFileSync(${JSON.stringify(files.checkHeld)}, String(Date.now()));`,
    'setTimeout(() => {',
    "  db.exec('COMMIT');",
    '  db.close();',
    `  writeFileSync(${JSON.stringify(files.checkReleased)}, String(Date.now()));`,
    `}, ${HOLD_MS});`,
    '',
  ].join('\n'));
  const child = spawn(process.execPath, [script], { stdio: ['ignore', 'ignore', 'pipe'], env: outsideAnyTab });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const done = new Promise((resolve) => child.on('close', (code) => resolve({ code, stderr })));
  return {
    done,
    stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    },
  };
}

/** Commands of a rollout whose text runs one of the kit's subcommands. */
const kitCommandsIn = (commands, subcommand) => commands.filter((one) => one.text.includes(subcommand));

test('#534 a Codex session at auto sends a long fleet message, makes and retires a temporary session and waits for a held mailbox turn, with no escalation, and its sandbox refuses a write into each of another bot\'s folders', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  // Outside /tmp and $TMPDIR, which the sandbox lets every session write (see
  // the header). `local-data/` is ignored by git.
  const parent = path.join(repoRoot, 'local-data');
  const parentWasThere = existsSync(parent);
  await mkdir(parent, { recursive: true });
  const bots = await realpath(await mkdtemp(path.join(parent, 'obk-system-codex-sandbox-writes-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', SENDER, PEER].map(homeOf);
  const senderHome = homeOf(SENDER);
  const peerHome = homeOf(PEER);
  const files = filesOf(senderHome);

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    // Only this test's own tabs are closed. A tab it did not create at one of
    // its homes is not its to close: that project and the bots folder stay
    // where they are, and the test fails naming the tab (review of PR #425).
    const { closed, foreign } = guard.closeOwnAt(homes);
    const held = new Set(foreign.map((one) => one.home));
    let deleted = 0;
    const failedDeletes = [];
    for (const setup of allSetups()) {
      if (!homes.includes(setup.path) || before.setups.has(setup.id) || held.has(setup.path)) continue;
      try {
        await deleteOwnProject(setup, bots);
        deleted += 1;
      } catch (error) {
        failedDeletes.push(`${setup.path}: ${error.message}`);
      }
    }
    // Orca's sidebar keeps a deleted project's row until its window is rebuilt (#343).
    if (deleted > 0 && !(await reloadWindow())) t.diagnostic(RELOAD_LINE);
    assert.deepEqual(foreign, [], `tabs this test did not create are open at its homes, so it closed only its own and left those projects and ${bots} in place`);
    await removeBotsFolderAndSiblings(bots);
    if (!parentWasThere) await rmdir(parent).catch(() => {});

    const { closedNotOurs, goneElsewhere } = guard.verdict(before.handles);
    assert.deepEqual(closedNotOurs, [], 'this test closed tabs it did not create');
    if (goneElsewhere.length > 0) t.diagnostic(`tabs open before this test and closed elsewhere meanwhile: ${goneElsewhere.join(', ')}`);
    for (const each of homes) {
      assert.deepEqual(await terminalsAfterClosing(each, closed), [], `this test left tabs behind in ${each}`);
    }
    assert.deepEqual(failedDeletes, [], 'projects this test could not remove, left in Orca');
  });

  for (const tmp of new Set([os.tmpdir(), await realpath(os.tmpdir()), '/tmp', '/private/tmp'])) {
    assert.ok(!`${bots}/`.startsWith(`${tmp.replace(/\/+$/, '')}/`), `the premise: the bots folder ${bots} is outside ${tmp}, which the sandbox lets every session write`);
  }

  // The fleet. No --approval anywhere: every session is at the kit's default,
  // `auto`, which for Codex is the workspace-write sandbox.
  obkJson(['init', '--bots', bots, '--harness', 'claude']);
  for (const bot of [SENDER, PEER]) {
    obkJson([
      'bot', 'create', '--bots', bots, '--name', bot, '--harness', 'codex',
      '--charter', `${bot} exists for one system test run and owns nothing.`,
    ]);
  }
  obkJson(['session', 'add', '--bots', bots, '--bot', PEER, '--name', SESSION, `--prompt=${peerPrompt(bots)}`, ...codexTrustArgs(bots)]);
  obkJson(['session', 'add', '--bots', bots, '--bot', SENDER, '--name', SESSION, `--prompt=${senderPrompt(bots, senderHome)}`, ...codexTrustArgs(bots)]);

  // What the sender is handed, written from outside its sandbox into its own folder.
  await writeFile(files.body, LONG_BODY);
  assert.ok(Buffer.byteLength(LONG_BODY, 'utf8') > 4096, 'the premise: the body is over 4 KiB');
  await writeFile(files.task, TASK);
  // The peer's three folders are there before the sender tries to write into
  // them, so a refusal is the sandbox's and not a missing folder's.
  for (const kind of KINDS) await mkdir(path.dirname(intrusionOf(bots, kind)), { recursive: true });

  /** Bring one session up, alone, and hand back its tab's entry. */
  const bringUp = (bot) => {
    const entry = tabOf(obkJson(['up', '--bots', bots, '--bot', bot, '--session', SESSION]), SESSION);
    assert.equal(entry.created, true);
    assert.equal(
      entry.harnessStarted,
      true,
      `no harness came up in ${entry.title}: look at it with \`orca terminal read --terminal ${entry.terminal} --screen\``,
    );
    return entry;
  };

  // The peer first: a message needs its Run, and its tab must be past its screens.
  const peer = bringUp(PEER);
  await pastItsScreens(peer.terminal);
  const peerRun = await until(
    `${PEER}/${SESSION}'s mailbox in the book`,
    HOOK_MS,
    async () => (typeof sessionIn(peerHome, SESSION).mailbox === 'string' ? sessionIn(peerHome, SESSION).mailbox : undefined),
    () => whatIsUp(peer.terminal),
  );

  // The sender. Everything it does is in its start prompt.
  const sender = bringUp(SENDER);
  const writtenSoFar = () => ` Written so far: ${Object.entries(files).filter(([, file]) => typeof file === 'string' && existsSync(file)).map(([name]) => name).join(', ')}.${whatIsUp(sender.terminal)}`;

  // The contended check: once the sender says it is ready, a holder of this
  // test's own, outside the sandbox, takes the sender's mailbox turn and
  // holds it HOLD_MS. It is a child process started here, which ends by
  // itself; only if it is still running at the end is it stopped, by its own
  // pid. Nothing else is signalled.
  await until(`the sender to reach its mail check, writing ${files.checkReady}`, WORK_MS, async () => textIn(files.checkReady), writtenSoFar);
  const holder = holdTurn(bots, mailboxLockOf(bots), files);
  t.after(() => holder.stop());
  const held = await holder.done;
  assert.equal(held.code, 0, `the holder outside the sandbox took and let go of ${mailboxLockOf(bots)}: ${held.stderr}`);

  const lastFiles = [files.checkEnd, ...KINDS.map((kind) => files.intrusion[kind])];
  await until(
    `the sender to run all its commands, the last ones writing ${lastFiles.join(', ')}`,
    WORK_MS,
    async () => (lastFiles.every((file) => textIn(file) !== undefined) ? true : undefined),
    writtenSoFar,
  );

  // The premises: the sender ran in its sandbox, and the bots folder is
  // outside the temp folder it may write.
  const psStatus = textIn(files.ps)?.trim();
  t.diagnostic(`/bin/ps in the sender's sandbox exited ${psStatus}`);
  assert.notEqual(psStatus, '0', 'the premise: /bin/ps does not start in the Codex sandbox; this run was not in one and shows nothing about #534');
  const sessionTmp = textIn(files.tmpdir)?.trim();
  assert.ok(sessionTmp !== undefined && sessionTmp !== '', `the premise: the sender wrote its $TMPDIR to ${files.tmpdir}`);
  for (const tmp of new Set([sessionTmp, existsSync(sessionTmp) ? await realpath(sessionTmp) : sessionTmp])) {
    assert.ok(!`${bots}/`.startsWith(`${tmp.replace(/\/+$/, '')}/`), `the premise: the bots folder ${bots} is outside the sender's $TMPDIR ${tmp}, which its sandbox may write`);
  }

  // 1. The long message: sent to the peer's Run, its body in a file under the
  //    sender's own folder of `<bots>.messages`, and Orca holds it.
  const sent = answerIn(files.send, 'message send');
  assert.equal(sent.sent, true, `the message is sent, got: ${JSON.stringify(sent)}`);
  assert.equal(sent.address, `run:${peerRun}`, `to the peer's Run, got: ${JSON.stringify(sent)}`);
  assert.equal(typeof sent.file, 'string', `the answer names the body file, got: ${JSON.stringify(sent)}`);
  assert.equal(path.dirname(sent.file), path.join(`${bots}.messages`, SENDER), `the body file is in the sender's own mail folder, got: ${sent.file}`);
  assert.equal(readFileSync(sent.file, 'utf8'), LONG_BODY, `and holds the text word for word: ${sent.file}`);
  const inbox = inboxOf(peerRun);
  assert.equal(inbox.length, 1, `the peer's Run holds the one message sent to it, and the newest ${INBOX_LIMIT} of the inbox hold ${inbox.length} of it`);
  assert.equal(inbox[0].subject, SUBJECT, `it is the message that was sent: ${JSON.stringify(inbox[0])}`);
  assert.ok(String(inbox[0].body).includes(sent.file), `and its body names the file: ${JSON.stringify(inbox[0])}`);
  assert.ok(!String(inbox[0].body).includes(BODY_WORD), `and does not carry the long text itself: ${JSON.stringify(inbox[0]).slice(0, 2000)}`);

  // 2. The temporary session: made, up, its prompt file in the sender's own
  //    folder of `<bots>.prompts`; then retired, its tab closed and the file gone.
  const made = guard.openedByKit(answerIn(files.make, 'temp make'));
  assert.equal(made.maker, SESSION, `${TEMP} is ${SESSION}'s, got: ${JSON.stringify(made)}`);
  const madeTab = tabOf(made, TEMP);
  assert.equal(madeTab.created, true, `${TEMP}'s tab was opened, got: ${JSON.stringify(madeTab)}`);
  assert.equal(madeTab.harnessStarted, true, `and its harness started, got: ${JSON.stringify(madeTab)}`);
  const promptFile = path.join(`${bots}.prompts`, SENDER, `${TEMP}.txt`);
  assert.equal(madeTab.promptFile, promptFile, `its start prompt went to a file in the sender's own folder of ${bots}.prompts, got: ${JSON.stringify(madeTab)}`);

  const retired = answerIn(files.retire, 'temp retire');
  guard.closedByKit(retired.closed);
  for (const entry of retired.retiredWith ?? []) guard.closedByKit(entry.closed);
  assert.equal(retired.session, TEMP, `the retire names ${TEMP}, got: ${JSON.stringify(retired)}`);
  const book = bookOf(senderHome);
  assert.equal(book.sessions?.[TEMP], undefined, `${TEMP} is off the book's live list: ${JSON.stringify(Object.keys(book.sessions ?? {}))}`);
  const gone = (book.retired ?? []).filter((one) => one?.name === TEMP);
  assert.equal(gone.length, 1, `one retired entry for ${TEMP}: ${JSON.stringify(book.retired)}`);
  assert.equal(gone[0].temporary?.maker, SESSION, `it was temporary, made by ${SESSION}: ${JSON.stringify(gone[0])}`);
  assert.equal(existsSync(promptFile), false, `${TEMP}'s start-prompt file is gone with it`);
  const left = await terminalsAfterClosing(senderHome, [madeTab.terminal]);
  assert.deepEqual(left.filter((one) => one.handle === madeTab.terminal).map((one) => one.handle), [], `${TEMP}'s tab is closed in Orca`);

  // 3. The intrusions: a write into each of the peer's three folders is
  //    refused by the sandbox, and nothing is written.
  for (const kind of KINDS) {
    const status = textIn(files.intrusion[kind]).trim();
    assert.notEqual(status, '0', `the write into ${PEER}'s folder of ${bots}.${kind} should have failed in the sandbox, and exited ${status}`);
    assert.equal(existsSync(intrusionOf(bots, kind)), false, `nothing of the sender's is in ${PEER}'s folder of ${bots}.${kind}: ${intrusionOf(bots, kind)}`);
  }

  // 3b. The contended lock: the sender's mail check, run in its sandbox while
  //     the holder held its mailbox turn, waited for the holder. Before #534
  //     the sandbox opened the lock file read-only, BEGIN IMMEDIATE passed
  //     beside the holder, and the check returned at once.
  const at = (file, what) => {
    const value = Number(textIn(file));
    assert.ok(Number.isFinite(value) && value > 0, `${what}: a time in ${file}, got: ${JSON.stringify(textIn(file))}`);
    return value;
  };
  const heldAt = at(files.checkHeld, 'the holder took the turn');
  const releasedAt = at(files.checkReleased, 'the holder let it go');
  const startAt = at(files.checkStart, 'the sender started its check');
  const endAt = at(files.checkEnd, 'the sender\'s check ended');
  t.diagnostic(`mail check under the held turn: held ${heldAt}, check started +${startAt - heldAt} ms, released +${releasedAt - heldAt} ms, check ended +${endAt - heldAt} ms`);
  assert.equal(textIn(files.checkStatus)?.trim(), '0', `the check worked once it had its turn: ${textIn(files.check)}`);
  const checked = answerIn(files.check, 'message check');
  assert.equal(checked.trouble, undefined, `and says no trouble, got: ${JSON.stringify(checked)}`);
  assert.ok(startAt >= heldAt && startAt < releasedAt, `the premise: the check started while the holder held the turn (held ${heldAt}, started ${startAt}, released ${releasedAt})`);
  assert.ok(endAt >= releasedAt, `the check waited for the holder: it ended ${releasedAt - endAt} ms before the turn was let go, so it ran beside the holder`);
  assert.ok(endAt - heldAt >= HOLD_MS * 0.9, `and so it ended at least most of ${HOLD_MS} ms after the holder took the turn, got ${endAt - heldAt} ms`);

  // 4. No escalation, from the sender's own record.
  const id = sessionIn(senderHome, SESSION).session;
  assert.equal(typeof id, 'string', `the premise: the kit's hook wrote the sender's conversation into the book, got: ${JSON.stringify(sessionIn(senderHome, SESSION))}`);
  const rollouts = rolloutFilesOf(path.join(os.homedir(), '.codex', 'sessions'), id);
  assert.equal(rollouts.length, 1, `the premise: one rollout of the sender's conversation ${id} under ~/.codex/sessions, got: ${JSON.stringify(rollouts)}`);
  const commands = codexCommands(rollouts[0]);
  for (const subcommand of ['message send', 'temp make', 'temp retire', 'message check']) {
    const runs = kitCommandsIn(commands, subcommand);
    assert.ok(runs.length > 0, `the sender's rollout holds its ${subcommand}, got the commands: ${JSON.stringify(commands.map((one) => one.text))}`);
    for (const run of runs) {
      assert.equal(run.escalated, false, `${subcommand} asked to leave the sandbox (sandbox_permissions: "require_escalated"): ${run.text}`);
      assert.notEqual(run.result?.error, true, `${subcommand} came back refused: ${run.text}\n${run.result?.output ?? ''}`);
    }
  }
  const reviews = reviewsOf(id);
  for (const subcommand of ['message send', 'temp make', 'temp retire', 'message check']) {
    assert.deepEqual(
      reviews.filter((text) => text.includes(subcommand)).map((text) => text.slice(0, 500)),
      [],
      `Codex's automatic reviewer was asked about the sender's ${subcommand}, so it asked to leave the sandbox`,
    );
  }
  const askedForIntrusion = commands.filter((one) => one.text.includes('intrusion.txt') && one.escalated);
  if (askedForIntrusion.length > 0) {
    t.diagnostic(`the sender asked to escalate its writes into ${PEER}'s folders ${askedForIntrusion.length} time(s), against its prompt; no file is there, so none was granted`);
  }
  t.diagnostic(`automatic reviews of the sender's conversation: ${reviews.length}`);
});
