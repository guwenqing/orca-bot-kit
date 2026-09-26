// A system test: mail sent from a Codex session reaches its receiver (#298),
// against the real Codex and Claude Code in the real Orca on this machine. Run
// it with `npm run test:system`; `npm test` cannot, and no CI machine could.
//
// Before #298 a Codex session's mail never told anybody. The kit types the
// one-line nudge into a receiver's tab only when it can see a harness in front
// of it (ADR 0024), and it looked with `/bin/ps`. At the kit's `auto` level,
// the default, the kit launches Codex with `--approve-for-me -c
// sandbox_workspace_write.network_access=true`: Codex's `workspace-write`
// sandbox, where /bin/ps does not start at all (`Operation not permitted`, exit
// 126). So every send from there said it could not tell, and typed nothing.
// Since #298 the kit asks Orca's runtime when `ps` cannot read the tab.
//
// The Codex bot here sends with the kit's own command, `"$OBK_CLI" message
// send`, from its start prompt, so every send runs inside its sandbox. It sends
// to four Claude sessions, one after another, each in the state the case needs
// when the mail arrives:
//
//   1. `idle`: waiting at its prompt. It is nudged, and reads the mail with the
//      command the nudge names.
//   2. `busy`: part way through a shell loop of about a minute and a half.
//      Nothing is typed, and the send says it could not tell, naming
//      `tty_boundary`. That is an Orca bug, not the kit's choice: on macOS,
//      `terminal.inspectProcess` answers verdict `unverifiable`, reason
//      `tty_boundary`, whenever the harness has a child with no terminal (`ps`
//      prints `??`), which is every Claude Code running a command (read in
//      Orca's source and seen live). The receiver finishes its loop, and its
//      mail waits unread. The day Orca fixes it this case fails, loudly, and
//      #350 turns it back into a nudge read after the work (PRD 6.9).
//   3. `quit`: its Claude Code ended with `/exit`, so the tab's shell is in
//      front. Nothing is typed, the send says it was not nudged, and plainly:
//      the shell in front is no harness (#232).
//   4. `pager`: its Claude Code ended with `/exit` and `less` started in its
//      shell, so a pager is in front under what may be a stale `agentIdentity`
//      of `claude`. Nothing is typed, and the send says it could not tell.
//
// What the send answered is taken from the kit's own words, not from the
// model: each send is piped through `tee` into a file in the Codex bot's own
// folder, which its sandbox may write, and the test reads that file. The
// answer carries the Run it went to, which the Codex bot was never told, so a
// file the model wrote by itself would not pass for it. The same way, the bot
// first writes the exit status of a `/bin/ps` it runs, which is the premise:
// a status of 0 is a run outside the sandbox that shows nothing about #298.
// The four answers are printed as diagnostics of the run.
//
// **What a receipt here may be made of.** Every word waited for is one the
// tab it is waited for in was never told. Each message's body carries a word
// that is only in the Codex bot's start prompt; the nudge says who wrote and
// what the subject is, and not the body, so that word on a receiver's screen
// is the mail having been read. Nothing having arrived is read the same way:
// neither the subject nor the body word is on the busy, quit or pager tab's
// screen long after the send, and Orca's mailbox holds that mail unread, where
// the idle receiver's is read. The busy receiver's loop was still running when
// its answer came back, and its total, which its instruction asks for and
// never states, says it finished; a minute after that total nothing of the
// mail is on its screen. `less` is still showing the test's own file.
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
//   - checks afterwards that every terminal that was there before is still there;
//   - signals no process: a process is only ever looked at, with `ps -p <pid>`,
//     one pid at a time, and a harness is ended with `/exit` or with its tab.
//
// `orca terminal close --worktree … --all` is never run here, and the helper
// below refuses to run it at all.
//
// It leaves behind what every system test does: offline entries in Claude
// Code's Remote Control list, and the Run mailboxes Orca cannot delete.
//
// It is slow: two warm-up tabs, four receivers, a loop of a minute and a half
// and a real read. Ten minutes or more, attended.
//
// **It is attended.** A bot folder nobody has opened before asks questions
// before the harness is running in it, and this test answers none of them —
// answering them is the caller's job and not the kit's (PRD 6.5). What to
// expect, in order:
//
//   1. `Bot Father daily`: Claude Code's folder trust. Nothing here waits on
//      Bot Father or writes to it. Leave it.
//   2. `Nudge Codex warmup`: Codex's folder trust (`1`, trust and continue),
//      then Codex's `Hooks need review` (`2`, "Trust all and continue";
//      without it the kit's hook never runs). This tab exists only so that
//      the folder is trusted before the sender starts; it does nothing else.
//   3. `Nudge Claude idle`: Claude Code's folder trust, once for the folder.
//      Its selection starts on `No, exit`, so it takes a down-arrow and then
//      return. `quit`, `pager` and `busy` come up in the same folder after
//      it, and should ask nothing.
//   4. Any Claude tab: if Claude Code asks before it runs a command (the loop
//      in `busy`, or the command the nudge names in `idle`), allow it.
//   5. Any tab, if its harness offers an update: accept it (PRD 6.5). In
//      `Nudge Codex sender` or `Nudge Claude busy` that costs time the loop
//      may not have; a run that misses it says so.
//   6. `Nudge Codex sender` should ask nothing: its folder was trusted in 2.
//
// Every wait says what the tab is showing when it runs out of patience, so a
// run that was left alone names the screen that stopped it.

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
import { waitingOn } from '../helpers/screens.js';

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
 * How long after the busy receiver's loop is done its screen is watched for
 * the mail. A line typed while it worked would be its next turn, read within
 * seconds of the total.
 */
const AFTER_WORK_MS = 60000;

/**
 * How long a harness that quit is given before mail is sent to its tab. Orca
 * can still give a harness's children for about a second after it quits
 * (read in Orca's code); this is well past that.
 */
const QUIT_SETTLE_MS = 5000;

/** Ask Orca something and read its JSON. Never the blanket close, on any road. */
function orca(args) {
  assert.ok(
    !(args.includes('--all') && args.includes('close')),
    `refusing to run \`orca ${args.join(' ')}\`: it would take away someone else's tabs`,
  );
  const done = spawnSync(ORCA, [...args, '--json'], { encoding: 'utf8' });
  assert.equal(done.error, undefined, `could not run ${ORCA}: ${done.error?.message}`);
  let answer;
  try {
    answer = JSON.parse(done.stdout);
  } catch {
    assert.fail(`orca ${args.join(' ')} did not answer JSON: ${done.stdout}${done.stderr}`);
  }
  return answer;
}

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
    return JSON.parse(done.stdout);
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
 * The four sends, in the order the Codex bot makes them: the busy receiver
 * first, while its loop is still running. `subject` and `body` are each only
 * in the Codex bot's start prompt; the nudge carries the subject, the body
 * only the mail.
 */
const SENDS = [
  { session: 'busy', subject: 'while you work SUBJ-4410', body: 'WALRUS-7720' },
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

/** The word in the file `less` shows in the pager tab: that tab is only ever told the file's path. */
const PAGER_WORD = 'PAGER-6042';

/** How a bot here starts the kit: by the variable its launch line set, never a bare `obk` (#220). */
const KIT = '"$OBK_CLI"';

/** What every bot here is told, whatever its part. */
const aBotOf = (bots) => [
  'You are a system test\'s bot and you own nothing.',
  `Your bots folder is ${bots}.`,
];

/** A Claude receiver: reads its own mail when the kit says there is some. */
const receiverPrompt = (bots, session) => [
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
  'When a line arrives saying fleet mail is waiting, run exactly the command that line names to read it,',
  'and then print MAIL: followed by the text of the message.',
  'Otherwise say nothing and wait.',
].join(' ');

/** The Codex sender's own folder, where its sandbox may write, and the files it writes there. */
const psStatusFile = (home) => path.join(home, 'ps-status.txt');
const answerFile = (home, session) => path.join(home, `answer-${session}.json`);

/**
 * The Codex sender: the premise first, then the four sends, each answer piped
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

/** Whether Orca holds mail for a session that nobody has read, by a look that leaves it unread. */
const unreadFor = (bots, session) => obkJson([
  'message', 'check', '--bots', bots, '--bot', CLAUDE.name, '--session', session, '--peek',
]).messages;

test('mail from a Codex session in its sandbox nudges an idle Claude receiver, and nothing is typed into a busy one, a quit one or one behind a pager', async (t) => {
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
    const closed = [];
    for (const each of homes) {
      for (const terminal of terminalsAt(each)) {
        if (before.handles.has(terminal.handle)) continue;
        orca(['terminal', 'close', '--terminal', terminal.handle, '--tab']);
        closed.push(terminal.handle);
      }
    }
    for (const setup of allSetups()) {
      if (!homes.includes(setup.path) || before.setups.has(setup.id)) continue;
      orca(['project', 'setup-delete', '--setup', setup.id]);
    }
    await removeBotsFolderAndSiblings(bots);

    const left = new Set(allTerminals().map((terminal) => terminal.handle));
    for (const handle of before.handles) {
      assert.ok(left.has(handle), `${handle} was open before this test and is gone now`);
    }
    for (const each of homes) {
      assert.deepEqual(await terminalsAfterClosing(each, closed), [], `this test left tabs behind in ${each}`);
    }
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
  obkJson(['session', 'add', '--bots', bots, '--bot', CODEX.name, '--name', 'warmup', `--prompt=${[...aBotOf(bots), 'Say nothing now and wait.'].join(' ')}`]);
  obkJson(['session', 'add', '--bots', bots, '--bot', CODEX.name, '--name', 'sender', `--prompt=${senderPrompt(bots, codexHome)}`]);
  for (const session of ['idle', 'quit', 'pager', 'busy']) {
    obkJson(['session', 'add', '--bots', bots, '--bot', CLAUDE.name, '--name', session, `--prompt=${receiverPrompt(bots, session)}`]);
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

  // The Codex folder's first-run screens, answered by hand in a tab that does
  // nothing else, so the sender comes up later with nothing to ask.
  const warmup = bringUp(CODEX.name, 'warmup');
  await readyForMail(warmup.terminal);

  // 1. The idle receiver. Its folder trust is the one the other three share.
  const idle = bringUp(CLAUDE.name, 'idle');
  await readyForMail(idle.terminal);

  // 3. The shell in front: Claude Code ended in its own tab.
  const quit = bringUp(CLAUDE.name, 'quit');
  await quitIn(claudeHome, 'quit', quit.terminal);

  // 4. `less` in front: Claude Code ended, and the pager started in its shell
  //    on this test's own file. The tab is told only the file's path.
  const pager = bringUp(CLAUDE.name, 'pager');
  await quitIn(claudeHome, 'pager', pager.terminal);
  await writeFile(pagerFile, `${Array.from({ length: 200 }, (_, n) => `${PAGER_WORD} line ${n + 1}`).join('\n')}\n`);
  sendLine(pager.terminal, `less ${pagerFile}`);
  await showsUp(pager.terminal, PAGER_WORD, ANSWER_MS);

  // 2. The busy receiver, last: it starts its loop the moment it is running.
  //    Once its hook has reported, a TUI wait that times out with no total on
  //    the screen is Claude Code at work (#232).
  const busy = bringUp(CLAUDE.name, 'busy');
  await until(
    `${CLAUDE.name}/busy to report its session id`,
    HOOK_MS,
    async () => (await sessionIn(claudeHome, 'busy')).session,
    () => ` The kit's hook has not run.${whatIsUp(busy.terminal)}`,
  );
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
    const { nudged, nudgeTrouble, blocked } = answers[send.session];
    t.diagnostic(`${send.session}: ${JSON.stringify({ nudged, nudgeTrouble, blocked })}`);
  }

  for (const send of SENDS) {
    const answer = answers[send.session];
    assert.equal(answer.sent, true, `${send.session}: the message is in the mailbox, got: ${JSON.stringify(answer)}`);
    const mailbox = (await sessionIn(claudeHome, send.session)).mailbox;
    assert.equal(answer.address, `run:${mailbox}`, `${send.session}: the kit's own answer, sent to the Run the book holds, got: ${JSON.stringify(answer)}`);
  }
  assert.equal(answers.idle.nudged, true, `the idle receiver should have been nudged, got: ${JSON.stringify(answers.idle)}`);
  // Orca's runtime cannot see past a child with no terminal (`??`), so the kit
  // cannot tell and types nothing. When this fails because the busy receiver
  // was nudged, Orca has fixed it: #350 turns this back into a nudge.
  assert.equal(answers.busy.nudged, false, `nothing is typed while Orca's runtime answers tty_boundary (#350), got: ${JSON.stringify(answers.busy)}`);
  assert.match(
    String(answers.busy.nudgeTrouble),
    /could not tell whether a harness is running in it/,
    `and the kit says it could not tell, got: ${JSON.stringify(answers.busy)}`,
  );
  assert.match(
    String(answers.busy.nudgeTrouble),
    /tty_boundary/,
    `naming Orca's reason, tty_boundary (#350), got: ${JSON.stringify(answers.busy)}`,
  );
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

  // It read it with the kit's own command, the one the nudge named: Orca holds
  // nothing of its unread.
  assert.deepEqual(unreadFor(bots, 'idle'), [], 'the idle receiver\'s mail was read');

  // 2. The busy receiver finishes its loop, and a minute on nothing of the
  //    mail has reached it.
  await showsUp(busy.terminal, TOTAL, ANSWER_MS);
  await setTimeout(AFTER_WORK_MS);

  // 2, 3 and 4. Minutes after the sends, nothing arrived in the tabs the kit
  // could not see a harness in: neither word is on any of their screens, and
  // the mail waits unread.
  for (const [session, entry] of [['busy', busy], ['quit', quit], ['pager', pager]]) {
    const shown = screenOf(entry.terminal);
    const { subject, body } = sendTo(session);
    const word = subject.split(' ').at(-1);
    assert.ok(!shown.includes(word) && !shown.includes(body), `nothing should have been typed into ${session}: ${shown.slice(0, 3000)}`);
    const unread = unreadFor(bots, session);
    assert.equal(unread.length, 1, `${session}'s mail waits unread, got: ${JSON.stringify(unread)}`);
    assert.ok(unread[0].body.includes(body), `and it is the mail that was sent, got: ${JSON.stringify(unread[0])}`);
  }
  assert.ok(screenOf(pager.terminal).includes(PAGER_WORD), `less is still showing this test's file: ${screenOf(pager.terminal).slice(0, 3000)}`);
});
