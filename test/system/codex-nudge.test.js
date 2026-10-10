// A system test: mail sent from a Codex session reaches its receiver (#298),
// against the real Codex and Claude Code in the real Orca on this machine. Run
// it with `npm run test:system`; `npm test` cannot, and no CI machine could.
//
// Before #298 a Codex session's mail never told anybody. The kit types the
// one-line nudge into a receiver's tab only when it can see a harness in front
// of it (ADR 0034), and it looked with `/bin/ps`. At the kit's `auto` level,
// the default, the kit launches Codex with `--approve-for-me -c
// sandbox_workspace_write.network_access=true`: Codex's `workspace-write`
// sandbox, where /bin/ps does not start at all (`Operation not permitted`, exit
// 126). So every send from there said it could not tell, and typed nothing.
// Since #298 the kit asks Orca's runtime when `ps` cannot read the tab.
//
// For a Claude Code running a command, or holding one in the background,
// Orca's runtime cannot say either (#350). That is an Orca bug, not the kit's
// choice: on macOS, `terminal.inspectProcess` answers verdict `unverifiable`,
// reason `tty_boundary`, whenever the harness has a child with no terminal
// (`ps` prints `??`), which is every Claude Code running a command (read in
// Orca's source and seen live). So since #350 the send leaves the nudge it
// could not decide on (`nudgeLeft: true`), and the kit's hook in the Codex bot's
// `.codex/hooks.json`, on Codex's `PostToolUse` event matched to its shell tool
// `Bash`, decides it right after the shell command that ran the send. Codex
// runs its hooks outside its sandbox, so there `ps` runs, and the hook types
// the nudge by #232's gate. The day Orca fixes its bug the send nudges by
// itself, and this test takes either road.
//
// The Codex bot here sends with the kit's own command, `"$OBK_CLI" message
// send`, from its start prompt, so every send runs inside its sandbox. It sends
// to five Claude sessions, one after another, each in the state the case needs
// when the mail arrives:
//
//   1. `idle`: waiting at its prompt. It is nudged, and reads the mail with the
//      command the nudge names.
//   2. `busy`: part way through a shell loop of about a minute and a half. It
//      is told of its mail, by the send or by the sender's hook, finishes its
//      loop, and then reads the mail (PRD 6.9: queued, not interrupting).
//   3. `background`: idle at its prompt while it holds a long `sleep` it started
//      as a background command, with Claude Code's own way of running one. It
//      is told of its mail the same way, and reads it.
//   4. `quit`: its Claude Code ended with `/exit`, so the tab's shell is in
//      front. Nothing is typed, the send says it was not nudged, and plainly:
//      the shell in front is no harness (#232).
//   5. `pager`: its Claude Code ended with `/exit` and `less` started in its
//      shell, so a pager is in front under what may be a stale `agentIdentity`
//      of `claude`. Nothing is typed, by the send or by the hook, and the send
//      says it could not tell.
//
// What the send answered is taken from the kit's own words, not from the
// model: each send is piped through `tee` into a file in the Codex bot's own
// folder, which its sandbox may write, and the test reads that file. The
// answer carries the Run it went to, which the Codex bot was never told, so a
// file the model wrote by itself would not pass for it. The same way, the bot
// first writes the exit status of a `/bin/ps` it runs, which is the premise:
// a status of 0 is a run outside the sandbox that shows nothing about #298.
// The five answers are printed as diagnostics of the run, with the road each
// told receiver was told by.
//
// **What a receipt here may be made of.** Every word waited for is one the
// tab it is waited for in was never told. Each message's body carries a word
// that is only in the Codex bot's start prompt; the nudge says who wrote and
// what the subject is, and not the body, so that word on a receiver's screen
// is the mail having been read. Nothing having arrived is read the same way:
// neither the subject nor the body word is on the quit or pager tab's screen
// long after the send, and Orca's mailbox holds that mail unread, where the
// idle, busy and background receivers' is read. The busy receiver's loop was
// still running when its answer came back, and its total, which its
// instruction asks for and never states, says it finished; the body word comes
// after that. The background receiver's `sleep` writes its own pid to a file
// in its bot's folder as it starts, and the test looks at that one pid with
// `ps -p`: it was running when the sender started and when the answer came
// back. `less` is still showing the test's own file.
//
// **How the mailboxes are looked at, and what that rests on.** A live run is
// started from an Orca tab, and from there `obk message check` refuses any
// session but the tab's own, `--peek` included (#317). So this test reads
// Orca's own listing, `orca orchestration inbox --json --limit 100`, as the
// tab it runs in, with nothing taken out of its environment and no
// `--terminal`. It is a read of Orca's store, not a fenced check, and changes
// nothing. Seen live by the architect from an attested Claude tab: it answers
// `{ messages, count }`, newest first by `sequence`, each message with its
// `run_id`, `to_handle`, `read` (0 or 1), `sequence`, `delivered_at`, subject
// and body. It lists every recipient's mail on the machine, so the test keeps
// only the entries of its own five Runs, the ones the book holds, and no
// assertion or failure message prints anything else. A message of the test's
// that the listing does not hold fails the test and says so; it is never
// taken for read. Not known until a run shows it: that `read` turns 1 when
// `obk message check` acknowledges a message. The idle, busy and background
// receivers' must be 1 and the other two's 0; if `read` means something else,
// the failure says so. Also not known: whether 100 is Orca's cap for `--limit`,
// and whether a machine busy with other mail between the sends and the look
// pushes the test's five out of the newest 100.
//
// The machine it runs on is someone's working machine, with their own tabs open.
// So this test, like the ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory;
//   - writes down every terminal and workspace Orca already had, before it
//     creates anything;
//   - touches only what it created, matched by handle and by workspace path;
//   - types into none of its bots but two of its own tabs: `/exit` into `quit`
//     and `pager`, and `less <its own file>` into `pager`'s shell;
//   - closes its own tabs one by one (`--terminal <handle> --tab`) and then
//     deletes its own workspaces;
//   - checks afterwards that it closed no tab it did not create;
//   - signals no process: a process is only ever looked at, with `ps -p <pid>`,
//     one pid at a time, and a harness is ended with `/exit` or with its tab.
//     The background receiver's `sleep` is not this test's to end: it ends by
//     itself BACKGROUND_S seconds after it starts, if closing its tab has not
//     ended it first.
//
// `orca terminal close --worktree … --all` is never run here, and the helper
// below refuses to run it at all.
//
// It leaves behind what every system test does: offline entries in Claude
// Code's Remote Control list, and the Run mailboxes Orca cannot delete.
//
// It is slow: two warm-up tabs, five receivers, a loop of a minute and a half
// and three real reads. Ten minutes or more, attended.
//
// **Nobody answers anything by hand.** A bot folder nobody has opened before
// asks questions before the harness is running in it (PRD 6.5). This test
// answers one of them itself, Claude Code's folder trust, in its own throwaway
// Claude tabs alone, under the architect's rulings on #451
// (https://github.com/guwenqing/orca-bot-kit/issues/451#issuecomment-5961132572)
// and #391, as send-outside-fleet does: only when the screen is the plain trust
// for the Claude bot's own throwaway folder, every row from "Accessing
// workspace:" down a row of the captured plain screen with that folder in the
// folder's place, the pointer on "No, exit", "Yes, I trust this folder" there,
// and no line pre-approving a permission (helpers/screens.js
// `onlyPlainTrustOf`). Then down and return, at most once for that tab, with no
// `--enter`. `Nudge Claude idle` comes up first and should be the only one to
// show it: `quit`, `pager`, `background` and `busy` share its folder. Any
// other screen gets no answer, and the test fails printing its rows; a hooks
// line on the trust screen goes to the architect before any rerun. What else
// may show:
//
//   - `Bot Father daily` shows the same folder trust for its own folder.
//     Nothing here waits on Bot Father or writes to it, and it is left.
//   - Both Codex sessions, `Nudge Codex warmup` and `Nudge Codex sender`, should
//     ask nothing: they are given their folder's trust at launch (#240,
//     test/helpers/codex-trust.js), which also bypasses Codex's hooks review, so
//     the kit's hooks in its folder, the nudge hook among them, run without
//     one, and nothing about this folder is written into the user's own
//     ~/.codex/config.toml.
//   - A Claude Code that asks before it runs a command (the loop in `busy`, the
//     background `sleep` in `background`, or the command the nudge names), or
//     any harness offering an update, is a screen this test does not answer:
//     the wait it stops fails, printing what the tab shows.
//
// Every wait says what the tab is showing when it runs out of patience, so a
// run that stopped names the screen that stopped it.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry } from '../helpers/cli.js';
import { codexTrustArgs } from '../helpers/codex-trust.js';
import { onlyPlainTrustOf, questionOn, waitingOn } from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { deleteOwnProject } from '../helpers/own-project.js';

/**
 * Remove the throwaway bots folder and everything the kit or this test made
 * beside it: `<bots>.prompts`, `<bots>.locks`, this test's `<bots>.pager.txt`
 * and the rest are siblings of the bots folder, not children of it (PRD 6.3).
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

/** How long a real agent is given to do something before the test gives up on it. */
const ANSWER_MS = 240000;

/** And how long a read after a nudge is given: the sender's turn, the nudge, and the receiver's turn. */
const ROUND_TRIP_MS = 480000;

/** How long the kit's hook is given to have written the book after a session starts. */
const HOOK_MS = 60000;

/** How long a tab is given to get past the screens of its own, a person answering them included. */
const READY_MS = 180000;

/**
 * How long the background receiver's `sleep` runs, in seconds: past the
 * slowest the sender can be started and get to its sends after it, so the
 * receiver still holds it when its mail is sent.
 */
const BACKGROUND_S = 900;

/**
 * How long a harness that quit is given before mail is sent to its tab. Orca
 * can still give a harness's children for about a second after it quits
 * (read in Orca's code); this is well past that.
 */
const QUIT_SETTLE_MS = 5000;

/**
 * Ask Orca something and read its JSON. Never the blanket close, on any road.
 * Every tab it closes is counted as this test's, for the check at the end (#246).
 */
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

/**
 * The tabs Orca lists at `home` once it has caught up with what was closed:
 * `terminal close` answers ok before `terminal list` stops reporting the tab.
 */
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
 * Run this checkout's `obk`, by its full path. The `obk` on PATH is the
 * published release this machine uses, not the code under test (#217).
 */
function obk(args) {
  const done = spawnSync(process.execPath, [cliEntry, ...args], { encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(done.error, undefined, `could not run \`obk\`: ${done.error?.message}`);
  assert.ok(!/worktree/i.test(done.stdout + done.stderr), `obk said "worktree": ${done.stdout}${done.stderr}`);
  return done;
}

/** Run `obk ... --json` and read the answer it printed. */
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

/** What the book says about one session right now. */
async function sessionIn(home, name) {
  const book = parse(await readFile(path.join(home, 'sessions.yaml'), 'utf8')) ?? {};
  return book.sessions?.[name] ?? {};
}

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

/** The rows the tab renders right now, or undefined when Orca gives no rendered screen. */
function rowsOf(handle) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  const tail = answer.ok === true && answer.result?.terminal?.source === 'screen' ? answer.result.terminal.tail : undefined;
  return Array.isArray(tail) ? tail : undefined;
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
    ' This test answers nothing a tab asks; answer it in Orca and run again.',
    `\n  orca terminal read --terminal ${handle} --screen\n  ${screenOf(handle).slice(0, 2000)}`,
  ].join('');
}

/** Wait for a word to show up on a tab's screen, whoever put it there. */
const showsUp = (handle, word, within = ANSWER_MS) => until(
  `${word} to show up in ${handle}`,
  within,
  async () => (screenOf(handle).includes(word) ? true : undefined),
  () => whatIsUp(handle),
);

/**
 * Wait until a tab can be written to at all: a TUI is up, Orca reports nothing
 * waiting to be answered on it, and its screen shows no question of the
 * harness's own (#329). Nothing is typed here; this only waits.
 */
async function readyForMail(handle, within = READY_MS) {
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

/** The request id an `agent_prompt_blocked` carries, read out of the whole error. */
function requestIdIn(error) {
  const found = /"orchestrationRequestId"\s*:\s*"([^"]+)"/.exec(JSON.stringify(error ?? null));
  return found === null ? undefined : found[1];
}

/**
 * Send one line into this test's own tab, with `--enter`. A gated line fails
 * with the screen and the id rather than retrying (see
 * `session-identity.test.js`).
 */
function sendLine(handle, text) {
  const sent = orca(['terminal', 'send', '--terminal', handle, '--text', text, '--enter']);
  if (sent.ok === true) return;

  const gated = requestIdIn(sent.error);
  assert.fail(
    `orca terminal send --enter failed: ${JSON.stringify(sent.error)}.`
    + (gated === undefined
      ? ''
      : ' Orca gated it as an agent prompt. Submit the line yourself in the tab, or reissue the'
        + ` same command with --retry-request ${gated} --wait-submit 30.`)
    + whatIsUp(handle),
  );
}

/** Claude Code's registry of running processes, one file each, `<pid>.json` (tech notes, section 2). */
const REGISTRY = path.join(os.homedir(), '.claude', 'sessions');

/** Every entry in the registry, read as it is; one being written or removed as it is read is left out. */
function registry() {
  let names;
  try {
    names = readdirSync(REGISTRY);
  } catch {
    return [];
  }
  const entries = [];
  for (const name of names.filter((one) => one.endsWith('.json'))) {
    try {
      entries.push(JSON.parse(readFileSync(path.join(REGISTRY, name), 'utf8')));
    } catch {
      // The next look reads it again.
    }
  }
  return entries.filter((entry) => entry !== null && typeof entry === 'object');
}

/**
 * The registry's entries for conversation `id` whose process is still there.
 * The look is `ps -p`, from this test's own process, which only reads.
 */
function processesIn(id) {
  return registry()
    .filter((entry) => entry.sessionId === id && Number.isInteger(entry.pid) && entry.pid > 0)
    .filter((entry) => spawnSync('ps', ['-p', String(entry.pid), '-o', 'pid='], { encoding: 'utf8' }).status === 0);
}

/**
 * End the Claude Code running in one of this test's own tabs with `/exit`, and
 * wait until its process is gone, so the tab's shell is in front.
 */
async function quitIn(home, session, handle) {
  const id = await until(
    `${session} to report its session id`,
    HOOK_MS,
    async () => (await sessionIn(home, session)).session,
    () => ` The kit's hook has not run.${whatIsUp(handle)}`,
  );
  assert.equal(processesIn(id).length, 1, `the premise: one Claude Code is having ${session}'s conversation ${id}`);
  await readyForMail(handle);
  sendLine(handle, '/exit');
  await until(
    `the Claude Code in ${session} to exit, so the shell is in front`,
    ANSWER_MS,
    async () => (processesIn(id).length === 0 ? true : undefined),
    () => whatIsUp(handle),
  );
}

/** The bots, and what each session is. */
const CLAUDE = { name: 'nudge-claude', display: 'Nudge Claude' };
const CODEX = { name: 'nudge-codex', display: 'Nudge Codex' };

/**
 * The five sends, in the order the Codex bot makes them: the busy receiver
 * first, while its loop is still running. `subject` and `body` are each only
 * in the Codex bot's start prompt; the nudge carries the subject, the body
 * only the mail.
 */
const SENDS = [
  { session: 'busy', subject: 'while you work SUBJ-4410', body: 'WALRUS-7720' },
  { session: 'background', subject: 'while you hold a job SUBJ-5174', body: 'HERON-9036' },
  { session: 'idle', subject: 'while you wait SUBJ-2291', body: 'KESTREL-5163' },
  { session: 'quit', subject: 'after you quit SUBJ-8812', body: 'IBIS-3308' },
  { session: 'pager', subject: 'behind the pager SUBJ-6630', body: 'LYNX-4471' },
];
const sendTo = (session) => SENDS.find((send) => send.session === session);

/**
 * The busy receiver's work: a shell loop of about a minute and a half, inside
 * Claude Code's two-minute limit for a command, and the total only doing it
 * produces. Its instruction asks for the total and never says what it is.
 */
const COUNT_TO = 96;
const WORK = `for i in $(seq 1 ${COUNT_TO}); do printf 'STEP-%02d\\n' "$i"; sleep 1; done`;
const TOTAL = `TOTAL: ${(COUNT_TO * (COUNT_TO + 1)) / 2}`;

/**
 * The background receiver's command: a `sleep` that writes its own pid to
 * `file` as it starts (`exec` keeps the shell's pid), so the test can look at
 * that one process, and at no other, with `ps -p`.
 */
const backgroundCommand = (file) => `/bin/sh -c 'echo $$ > ${file}; exec sleep ${BACKGROUND_S}'`;

/** Whether the one process `pid` is there, looked at with `ps -p` from this test's own process, which only reads. */
const running = (pid) => spawnSync('ps', ['-p', String(pid), '-o', 'pid='], { encoding: 'utf8' }).status === 0;

/** The word in the file `less` shows in the pager tab: that tab is only ever told the file's path. */
const PAGER_WORD = 'PAGER-6042';

/** How a bot here starts the kit: by the variable its launch line set, never a bare `obk` (#220). */
const KIT = '"$OBK_CLI"';

/** What every bot here is told, whatever its part. */
const aBotOf = (bots) => [
  'You are a system test\'s bot and you own nothing.',
  `Your bots folder is ${bots}.`,
];

/** The file the background receiver's `sleep` writes its pid to, in that bot's own folder. */
const backgroundPidFile = (home) => path.join(home, 'background-pid.txt');

/** A Claude receiver: reads its own mail when the kit says there is some. */
const receiverPrompt = (bots, session, home) => [
  ...aBotOf(bots),
  'Do nothing that is not written here: read no file, write nothing, and run no command but the ones below.',
  ...(session === 'busy'
    ? [
      'As soon as you are running, run exactly this command, once, in the foreground, and wait for it to finish;',
      `it takes about a minute and a half: ${WORK}`,
      'When it has finished, print TOTAL: followed by the sum of the numbers in the STEP lines it printed,',
      'on a line of its own.',
    ]
    : []),
  ...(session === 'background'
    ? [
      'As soon as you are running, start exactly this command, once, as a background command, with your own way',
      'of running a command in the background, and do not wait for it to finish or look at it again:',
      `${backgroundCommand(backgroundPidFile(home))}`,
    ]
    : []),
  'When a line arrives saying fleet mail is waiting, run exactly the command that line names to read it,',
  'and then print MAIL: followed by the text of the message.',
  'Otherwise say nothing and wait.',
].join(' ');

/** The Codex sender's own folder, where its sandbox may write, and the files it writes there. */
const psStatusFile = (home) => path.join(home, 'ps-status.txt');
const answerFile = (home, session) => path.join(home, `answer-${session}.json`);

/**
 * The Codex sender: the premise first, then the five sends, each answer piped
 * through `tee` into its own file, so what the kit said is on disk in its own
 * words. `tee` rather than `>`: a redirect the sandbox refused would stop the
 * send from running at all.
 */
const senderPrompt = (bots, home) => [
  ...aBotOf(bots),
  'Do nothing that is not written here: read no file, write nothing but what these commands write,',
  'and run no command but the ones below.',
  'As soon as you are running, run exactly these commands, once each, in this order, each exactly as written:',
  `/bin/ps -o pid= -p 1 >/dev/null 2>&1; echo $? > ${psStatusFile(home)}`,
  ...SENDS.map((send) => `${KIT} message send --bots ${bots} --to ${CLAUDE.name}/${send.session} --from ${CODEX.name}/sender`
    + ` --subject '${send.subject}' --text '${send.body}' --json | tee ${answerFile(home, send.session)}`),
  'Then say nothing else and wait.',
].join(' ');

/** The one JSON answer in a file, once it is whole, or undefined while it is not there or not whole. */
function answerIn(file) {
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/** How many of the newest messages on the machine the inbox is asked for: far more than this test sends. */
const INBOX_LIMIT = 100;

/**
 * Orca's inbox entries for this test's own Runs, by session: each session's
 * Run from the book, and the entries whose `run_id` is that Run. Everything
 * else the inbox lists belongs to other people and is dropped here, before
 * anything can print it. See the header for what this rests on.
 */
async function inboxOf(home, sessions) {
  const runs = {};
  for (const session of sessions) {
    const { mailbox } = await sessionIn(home, session);
    assert.match(String(mailbox), /^run_/, `the book should hold ${session}'s Run, got: ${mailbox}`);
    runs[session] = mailbox;
  }
  // Not through `orca()`, whose failures print Orca's output: here that output
  // is everybody's mail. Every failure below says what went wrong in words
  // that cannot carry any of it: a status, a length, an error code.
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
  const ours = {};
  for (const [session, run] of Object.entries(runs)) {
    ours[session] = all
      .filter((message) => message?.run_id === run)
      .map(({ run_id: runId, to_handle: to, read, sequence, subject, body }) => ({ runId, to, read, sequence, subject, body }));
  }
  return ours;
}

test('mail from a Codex session in its sandbox tells an idle Claude receiver, a busy one and one holding a background command, and nothing is typed into a quit one or one behind a pager', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-codex-nudge-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', CLAUDE.name, CODEX.name].map(homeOf);
  const claudeHome = homeOf(CLAUDE.name);
  const codexHome = homeOf(CODEX.name);
  const pagerFile = `${bots}.pager.txt`;

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    // Only this test's own tabs are closed. A tab it did not create at one of
    // its homes is not its to close: that project and the bots folder stay
    // where they are, and the test fails naming the tab (#426).
    const { closed, foreign } = guard.closeOwnAt(homes);
    const held = new Set(foreign.map((one) => one.home));
    const failedDeletes = [];
    for (const setup of allSetups()) {
      if (!homes.includes(setup.path) || before.setups.has(setup.id) || held.has(setup.path)) continue;
      try {
        await deleteOwnProject(setup, bots);
      } catch (error) {
        failedDeletes.push(`${setup.path}: ${error.message}`);
      }
    }
    assert.deepEqual(foreign, [], `tabs this test did not create are open at its homes, so it closed only its own and left those projects and ${bots} in place`);
    await removeBotsFolderAndSiblings(bots);

    // The point of all the care above: this test closed no tab but its own. A
    // tab open before it and gone now that it did not close was closed by
    // someone else on this shared machine, so that is said, not failed (#246).
    const { closedNotOurs, goneElsewhere } = guard.verdict(before.handles);
    assert.deepEqual(closedNotOurs, [], 'this test closed tabs it did not create');
    if (goneElsewhere.length > 0) t.diagnostic(`tabs open before this test and closed elsewhere meanwhile: ${goneElsewhere.join(', ')}`);
    for (const each of homes) {
      assert.deepEqual(await terminalsAfterClosing(each, closed), [], `this test left tabs behind in ${each}`);
    }
    assert.deepEqual(failedDeletes, [], 'projects this test could not remove, left in Orca');
  });

  obkJson(['init', '--bots', bots, '--harness', 'claude']);
  obkJson([
    'bot', 'create', '--bots', bots, '--name', CODEX.name, '--harness', 'codex',
    '--charter', `${CODEX.display} exists for one system test run and owns nothing.`,
  ]);
  obkJson([
    'bot', 'create', '--bots', bots, '--name', CLAUDE.name, '--harness', 'claude',
    '--charter', `${CLAUDE.display} exists for one system test run and owns nothing.`,
  ]);
  // No --approval anywhere: every session is at the kit's default, `auto`,
  // which for Codex is the workspace-write sandbox.
  obkJson(['session', 'add', '--bots', bots, '--bot', CODEX.name, '--name', 'warmup', `--prompt=${[...aBotOf(bots), 'Say nothing now and wait.'].join(' ')}`, ...codexTrustArgs(bots)]);
  obkJson(['session', 'add', '--bots', bots, '--bot', CODEX.name, '--name', 'sender', `--prompt=${senderPrompt(bots, codexHome)}`, ...codexTrustArgs(bots)]);
  for (const session of ['idle', 'quit', 'pager', 'background', 'busy']) {
    obkJson(['session', 'add', '--bots', bots, '--bot', CLAUDE.name, '--name', session, `--prompt=${receiverPrompt(bots, session, claudeHome)}`]);
  }

  /** Bring one session up, alone, and hand back its tab's entry. */
  const bringUp = (bot, session) => {
    const entry = tabOf(obkJson(['up', '--bots', bots, '--bot', bot, '--session', session]), session);
    assert.equal(entry.created, true);
    assert.equal(
      entry.harnessStarted,
      true,
      `no harness came up in ${entry.title}: look at it with \`orca terminal read --terminal ${entry.terminal} --screen\``,
    );
    return entry;
  };

  /**
   * Get one of this test's own Claude tabs past its first-run screens: Claude
   * Code's folder trust, answered here at most once for the tab and only when
   * it is the plain one for the Claude bot's own folder (see the header). Any
   * other question fails the test with its rows. Done when the session has
   * reported its conversation.
   */
  const pastTrust = async (session, entry) => {
    const asked = await until(
      `${CLAUDE.name}/${session} to show Claude Code's folder trust, or report its conversation`,
      READY_MS,
      async () => {
        if (typeof (await sessionIn(claudeHome, session)).session === 'string') return { rows: null };
        const rows = rowsOf(entry.terminal);
        if (rows === undefined) return undefined;
        if (rows.some((row) => row.includes('Yes, I trust this folder'))) return { rows };
        const question = questionOn(rows);
        assert.equal(
          question,
          undefined,
          `${entry.title} asks something this test does not answer, so it answered nothing.\n  what it showed:\n    ${rows.join('\n    ')}`,
        );
        return undefined;
      },
      () => whatIsUp(entry.terminal),
    );
    if (asked.rows !== null) {
      const wrong = onlyPlainTrustOf(asked.rows, claudeHome);
      assert.equal(
        wrong,
        undefined,
        `${entry.title}'s folder trust is not one this test may answer, so it answered nothing: ${wrong}.`
        + `\n  what it showed:\n    ${asked.rows.join('\n    ')}`,
      );
      const sent = orca(['terminal', 'send', '--terminal', entry.terminal, '--text', '\x1b[B\r']);
      assert.equal(sent.ok, true, `answering ${entry.title}'s folder trust failed: ${JSON.stringify(sent.error)}`);
      t.diagnostic(`answered ${entry.title}'s plain folder trust (the rulings on #451 and #391)`);
    }
    await until(
      `${CLAUDE.name}/${session} to report its session id`,
      READY_MS,
      async () => (await sessionIn(claudeHome, session)).session,
      () => ` Its folder trust was answered, or never asked.${whatIsUp(entry.terminal)}`,
    );
  };

  // A Codex tab that does nothing else, up before the sender. It used to carry
  // the folder's first-run screens, answered by hand; with the trust given at
  // launch (#240) it should ask nothing, and is waited for all the same.
  const warmup = bringUp(CODEX.name, 'warmup');
  await readyForMail(warmup.terminal);

  // 1. The idle receiver. Its folder trust is the one the other four share.
  const idle = bringUp(CLAUDE.name, 'idle');
  await pastTrust('idle', idle);
  await readyForMail(idle.terminal);

  // 4. The shell in front: Claude Code ended in its own tab.
  const quit = bringUp(CLAUDE.name, 'quit');
  await pastTrust('quit', quit);
  await quitIn(claudeHome, 'quit', quit.terminal);

  // 5. `less` in front: Claude Code ended, and the pager started in its shell
  //    on this test's own file. The tab is told only the file's path.
  const pager = bringUp(CLAUDE.name, 'pager');
  await pastTrust('pager', pager);
  await quitIn(claudeHome, 'pager', pager.terminal);
  await writeFile(pagerFile, `${Array.from({ length: 200 }, (_, n) => `${PAGER_WORD} line ${n + 1}`).join('\n')}\n`);
  sendLine(pager.terminal, `less ${pagerFile}`);
  await showsUp(pager.terminal, PAGER_WORD, ANSWER_MS);

  // 3. Idle, holding a background command: the `sleep` writes its pid as it
  //    starts, and the test waits for that process to be there and for the
  //    tab to be idle.
  const background = bringUp(CLAUDE.name, 'background');
  await pastTrust('background', background);
  const backgroundPid = await until(
    `${CLAUDE.name}/background's sleep to write its pid to ${backgroundPidFile(claudeHome)}`,
    ANSWER_MS,
    async () => {
      if (!existsSync(backgroundPidFile(claudeHome))) return undefined;
      const text = readFileSync(backgroundPidFile(claudeHome), 'utf8').trim();
      return /^\d+$/.test(text) ? Number(text) : undefined;
    },
    () => whatIsUp(background.terminal),
  );
  assert.ok(running(backgroundPid), `the premise: the background receiver's sleep, pid ${backgroundPid}, is running`);
  await readyForMail(background.terminal);

  // 2. The busy receiver, last: it starts its loop the moment it is running.
  //    Once its hook has reported, a TUI wait that times out with no total on
  //    the screen is Claude Code at work (#232).
  const busy = bringUp(CLAUDE.name, 'busy');
  await pastTrust('busy', busy);
  await until(
    `${busy.terminal} to be at work on its loop`,
    ANSWER_MS,
    async () => {
      const answer = orca(['terminal', 'wait', '--terminal', busy.terminal, '--for', 'tui-idle', '--timeout-ms', '3000']);
      if (answer.ok === true) return undefined;
      assert.ok(!screenOf(busy.terminal).includes(TOTAL), `the loop finished before the sender was started: ${screenOf(busy.terminal).slice(0, 2000)}`);
      return true;
    },
    () => whatIsUp(busy.terminal),
  );
  await setTimeout(QUIT_SETTLE_MS);

  // What Orca names in the two tabs with no harness in front, for the record:
  // the case is about a stale identity, which is Orca's to keep or let go.
  for (const [session, entry] of [['quit', quit], ['pager', pager]]) {
    const shown = orca(['terminal', 'show', '--terminal', entry.terminal]);
    t.diagnostic(`${session}: Orca names ${JSON.stringify(shown.result?.terminal?.agentIdentity ?? null)} as its agent before the sends`);
  }

  // The sender's hooks file holds the kit's nudge hook, which `up` wrote when
  // the Codex bot came up; and the background receiver still holds its sleep.
  const codexHooks = path.join(codexHome, '.codex', 'hooks.json');
  assert.ok(
    existsSync(codexHooks) && readFileSync(codexHooks, 'utf8').includes('session nudge'),
    `the premise: ${codexHooks} holds the kit's nudge hook (#350)`,
  );
  assert.ok(running(backgroundPid), `the premise: the background receiver's sleep, pid ${backgroundPid}, is still running before the sends`);

  // The sender. Everything it does is in its start prompt.
  const sender = bringUp(CODEX.name, 'sender');

  // The premise: inside its sandbox /bin/ps does not start.
  const psStatus = await until(
    `the Codex sender to write the status of its /bin/ps to ${psStatusFile(codexHome)}`,
    ANSWER_MS,
    async () => {
      if (!existsSync(psStatusFile(codexHome))) return undefined;
      const text = readFileSync(psStatusFile(codexHome), 'utf8').trim();
      return text === '' ? undefined : text;
    },
    () => whatIsUp(sender.terminal),
  );
  t.diagnostic(`/bin/ps in the Codex sender's sandbox exited ${psStatus}`);
  assert.notEqual(psStatus, '0', 'the premise: /bin/ps does not start in the Codex sandbox; this run was not in one and shows nothing about #298');

  // Each send's answer, in the kit's own words, as the sender's `tee` wrote it.
  const answers = {};
  for (const send of SENDS) {
    answers[send.session] = await until(
      `the Codex sender's answer for ${send.session} in ${answerFile(codexHome, send.session)}`,
      ANSWER_MS,
      async () => answerIn(answerFile(codexHome, send.session)),
      () => whatIsUp(sender.terminal),
    );
    if (send.session === 'busy') {
      // The send was made before this file was written, so a loop not yet
      // finished now was not finished then.
      assert.ok(
        !screenOf(busy.terminal).includes(TOTAL),
        `the loop finished before the mail was sent, so this shows nothing about a receiver running a command: ${screenOf(busy.terminal).slice(0, 2000)}`,
      );
    }
    if (send.session === 'background') {
      // Likewise: a sleep still running now was running when the mail was sent.
      assert.ok(
        running(backgroundPid),
        `the background receiver's sleep, pid ${backgroundPid}, ended before the mail was sent, so this shows nothing about a receiver holding a background command`,
      );
    }
    const { nudged, nudgeTrouble, nudgeLeft, blocked } = answers[send.session];
    t.diagnostic(`${send.session}: ${JSON.stringify({ nudged, nudgeTrouble, nudgeLeft, blocked })}`);
  }

  for (const send of SENDS) {
    const answer = answers[send.session];
    assert.equal(answer.sent, true, `${send.session}: the message is in the mailbox, got: ${JSON.stringify(answer)}`);
    const mailbox = (await sessionIn(claudeHome, send.session)).mailbox;
    assert.equal(answer.address, `run:${mailbox}`, `${send.session}: the kit's own answer, sent to the Run the book holds, got: ${JSON.stringify(answer)}`);
  }
  assert.equal(answers.idle.nudged, true, `the idle receiver should have been nudged, got: ${JSON.stringify(answers.idle)}`);
  // The busy receiver and the one holding a background command are told by
  // one of two roads. Orca's runtime cannot see past a child with no terminal
  // (`??`), so the send cannot tell, types nothing and leaves the nudge for the
  // sender's hook, which decides it with `ps` outside the sandbox (#350). An
  // Orca that has fixed its bug lets the send nudge by itself.
  for (const session of ['busy', 'background']) {
    const answer = answers[session];
    if (answer.nudged === true) {
      t.diagnostic(`${session}: nudged by the send itself; Orca's runtime named the harness, so it no longer answers tty_boundary here`);
      continue;
    }
    assert.equal(answer.nudgeLeft, true, `${session}: not nudged by the send, so the nudge is left for the sender's hook (#350), got: ${JSON.stringify(answer)}`);
    assert.match(
      String(answer.nudgeTrouble),
      /could not tell whether a harness is running in it/,
      `${session}: and the send says it could not tell, got: ${JSON.stringify(answer)}`,
    );
    t.diagnostic(`${session}: left for the sender's hook`);
  }
  assert.equal(answers.quit.nudged, false, `nothing is typed into a tab with its shell in front, got: ${JSON.stringify(answers.quit)}`);
  assert.equal(
    'nudgeTrouble' in answers.quit,
    false,
    `the shell in front is no harness, plainly, and Orca's runtime says so; got: ${JSON.stringify(answers.quit)}`,
  );
  assert.equal(answers.pager.nudged, false, `nothing is typed into a tab with less in front, got: ${JSON.stringify(answers.pager)}`);
  assert.match(
    String(answers.pager.nudgeTrouble),
    /could not tell whether a harness is running in it/,
    `and the kit says it could not tell, got: ${JSON.stringify(answers.pager)}`,
  );

  // 1. The idle receiver read its mail: the body's word is only in the mail.
  await showsUp(idle.terminal, sendTo('idle').body, ROUND_TRIP_MS);

  // 2. The busy receiver finishes its loop, and then reads its mail: the line
  //    that told it waited for the work to end (PRD 6.9).
  await showsUp(busy.terminal, TOTAL, ANSWER_MS);
  await showsUp(busy.terminal, sendTo('busy').body, ROUND_TRIP_MS);
  const afterWork = screenOf(busy.terminal);
  if (afterWork.includes(TOTAL)) {
    assert.ok(
      afterWork.indexOf(TOTAL) < afterWork.indexOf(sendTo('busy').body),
      `the busy receiver read its mail after its loop's total, not in the middle of the work: ${afterWork.slice(0, 3000)}`,
    );
  } else {
    t.diagnostic('busy: the total has scrolled off the screen by the time the mail was read, so its order was not looked at');
  }

  // 3. The receiver holding a background command reads its mail.
  await showsUp(background.terminal, sendTo('background').body, ROUND_TRIP_MS);

  // 4 and 5. Minutes after the sends, nothing arrived in the tabs with no
  // harness in front, by the send or by the hook: neither word is on either
  // screen.
  for (const [session, entry] of [['quit', quit], ['pager', pager]]) {
    const shown = screenOf(entry.terminal);
    const { subject, body } = sendTo(session);
    const word = subject.split(' ').at(-1);
    assert.ok(!shown.includes(word) && !shown.includes(body), `nothing should have been typed into ${session}: ${shown.slice(0, 3000)}`);
  }
  assert.ok(screenOf(pager.terminal).includes(PAGER_WORD), `less is still showing this test's file: ${screenOf(pager.terminal).slice(0, 3000)}`);

  // Last, the mailboxes, by the look the header describes, so a failure of it
  // stops nothing above. Each Run holds the one message sent to it. The idle,
  // busy and background receivers read their mail with the kit's own command,
  // the one the nudge named, so Orca has it read; the other two's waits unread.
  const inbox = await inboxOf(claudeHome, SENDS.map((send) => send.session));
  for (const { session, body } of SENDS) {
    const found = inbox[session];
    assert.equal(
      found.length,
      1,
      `${session}'s Run should hold the one message sent to it, and the newest ${INBOX_LIMIT} of the inbox hold ${found.length}`
      + ` of it: ${JSON.stringify(found)}. A message missing here is not known to be read or unread, so this fails rather than guess.`,
    );
    assert.ok(String(found[0].body).includes(body), `and it is the mail that was sent: ${JSON.stringify(found[0])}`);
    const told = ['idle', 'busy', 'background'].includes(session);
    assert.equal(
      found[0].read,
      told ? 1 : 0,
      told
        ? `${session}'s message is read ${JSON.stringify(found[0].read)}, and it was read and acknowledged by obk message check (its body word is on its screen). `
          + `Either the inbox's \`read\` does not mean acknowledged, or the acknowledgement did not happen: ${JSON.stringify(found[0])}`
        : `${session}'s message is read ${JSON.stringify(found[0].read)}, and nobody was told of it or ran a check for it. `
          + `Either the inbox's \`read\` does not mean acknowledged, or something read it: ${JSON.stringify(found[0])}`,
    );
  }
});
