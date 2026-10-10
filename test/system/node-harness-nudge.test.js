// A system test: a Claude Code that runs as `node` in its tab is told its mail
// is there, idle and busy, and `less` in its place after it quit is not
// (#261), against the real Claude Code in the real Orca on this machine. Run it
// alone with `npm run test:system -- --yes test/system/node-harness-nudge.test.js`;
// `npm test` cannot, and no CI machine could.
//
// Under #232 the kit types into a tab only when the process leading its
// foreground group has the name of the agent Orca names there. A harness
// installed through npm runs as `node`, so its tab got "cannot tell" and was
// never nudged. Since #261 a front not named as the agent counts as the
// harness the kit launched when its environment carries this tab's
// `ORCA_TAB_ID` and an `OBK_TAB_SHELL` equal to its own parent's pid: the
// tab's shell started it on the kit's launch line.
//
// Nothing is installed with npm, and the owner's own installs are never
// touched. Instead:
//
//   1. The kit brings up a throwaway Claude session, `target`, whose start
//      prompt gives it one turn, so its conversation is on disk and in the book.
//      Its `claude` is read with `ps` while it runs: its arguments, which are
//      the kit's, and its parent, the tab's shell. Then it quits with /exit,
//      and the test waits for the shell to be in front.
//   2. The test types into that tab the kit's launch-line shape with a node
//      wrapper in place of `claude`: `OBK_TAB_SHELL=$$ OBK_CLI=<this
//      checkout's cli> node <wrapper> <the arguments the kit gave claude>
//      --resume <id>`. The wrapper is a few lines this test writes beside its
//      bots folder: it starts the `claude` on PATH with those arguments, its
//      terminal inherited, and exits with it. So `node` leads the tab's
//      foreground group, the shell's child, with the mark.
//   3. The premise, read the way the kit reads a tab (the pane's pid from
//      `orca diagnostics memory`, then `ps`): `node` is in front, its parent
//      is the tab's shell, and its environment carries `ORCA_TAB_ID=<this
//      tab>` and `OBK_TAB_SHELL=<its parent>`.
//   4. Idle: `obk message send --from` a second session of the same bot,
//      `sender`, a Codex one, so the mail goes through Orca and not Claude's
//      own messaging, which carries mail between two Claude sessions of one
//      approval class (auto and ask are one class). The test sends it itself;
//      the sender's Codex only has to have come up once, for its mailbox. The
//      send must say it nudged, and the subject,
//      which only the nudge carries, must show up in the tab.
//   5. Busy: the test asks the wrapped Claude for a long answer, and while it
//      is writing it (Orca's wait times out and the answer's last line, which
//      the request never states, is not on screen) sends again. The send must
//      say it nudged, and the subject must show up in the tab.
//   6. The wrapped Claude quits with /exit, the shell is in front, and `less`
//      runs in the tab on this test's own file. The next send must type
//      nothing and say the kit could not tell; its subject must stay off the
//      screen, and `less` must still be showing the file.
//
// What it cannot know live:
//
//   - Whether a real npm install looks the same. There `node` runs Claude
//     Code's own script and is the harness; here `node` is a wrapper with
//     `claude` as its child. What the kit reads is the same (the name, the
//     parent and the environment of the process in front), but anything that
//     looks at the harness itself sees `claude` under `node`, not under the
//     shell. That includes the kit's own hook, which may treat the resumed
//     conversation differently; this test does not rely on the book changing
//     after step 1.
//   - Codex installed through npm. Only Claude Code is wrapped here.
//   - A tab Orca restored by itself, with no mark: the fakes cover it
//     (test/node-harness-nudge.test.js).
//   - A sender inside Codex's sandbox, where `ps` does not run: the fakes cover
//     it too.
//   - Whether Orca names `claude` in the tab while `node` leads it. What Orca
//     names is printed as a diagnostic at each send, not asserted.
//
// The machine it runs on is someone's working machine, with their own tabs
// open. So this test, like the ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory;
//   - writes down every terminal and workspace Orca already had, before it
//     creates anything;
//   - touches only what it created, matched by handle and by workspace path;
//   - types into only its own `target` tab: /exit twice, the launch line with
//     the wrapper, the long request, and `less <its own file>`;
//   - closes its own tabs one by one (`--terminal <handle> --tab`) and then
//     deletes its own workspaces, whatever happened, and checks afterwards that
//     it closed no tab it did not create;
//   - signals no process: a process is only ever looked at, with `ps` on one
//     pid at a time, and a harness is ended with /exit or with its tab. What an
//     environment holds is only ever searched for a word, never printed.
//
// `orca terminal close --worktree … --all` is never run here, and the helper
// below refuses to run it at all.
//
// It leaves behind what every system test does: offline entries in Claude
// Code's Remote Control list, and the Run mailboxes Orca cannot delete.
//
// **It is attended.** A bot folder nobody has opened before asks questions
// before the harness is running in it, and this test answers none of them:
// answering them is the caller's job and not the kit's (PRD 6.5). What to
// expect, in order:
//
//   1. `Bot Father daily`: Claude Code's folder trust. Nothing here waits on
//      Bot Father or writes to it. Leave it.
//   2. `Node Nudge target`: Claude Code's folder trust, once for the folder.
//      Its selection starts on `No, exit`, so it takes a down-arrow and then
//      return.
//   3. `Node Nudge sender`, a Codex tab in the same folder
//      (`<tmp>/obk-system-node-nudge-*/bots/node-nudge`, bot `node-nudge`),
//      should ask nothing: its session is given its folder's trust at launch
//      (#240, test/helpers/codex-trust.js), so Codex asks neither its folder
//      trust nor its hooks review, and writes nothing about this folder into
//      the user's own ~/.codex/config.toml. Nothing here waits on it anyway:
//      the sender's mailbox is made by its launch line before Codex starts,
//      and the test sends for it.
//   4. `Node Nudge target`, after its first turn, and again under the wrapper:
//      Claude Code's form "Teach auto mode about your environment?" ("←/→ to
//      change usage · Enter to continue · Esc to cancel"). Seen live on 2.1.283
//      in the first run of this test, where a typed /exit pressed Continue on
//      it. Answer it (Esc cancels it) before the test types into the tab: if
//      it is still up then, the test fails with the screen and types nothing.
//   5. `Node Nudge target`: if Claude Code asks before it runs the command the
//      nudge names, allow it.
//   6. Any tab, if its harness offers an update: accept it (PRD 6.5).
//
// Nothing typed into a Claude tab here answers any of these. Before each line
// with a return that goes to Claude Code (/exit twice and the long request)
// the test reads the screen, and it types only at Claude's plain input prompt:
// its lowest `❯` row between the input box's two rules, and no question, form
// or menu by the suite's shared look (helpers/screens.js, `questionOn`: a
// numbered list, or a foot row offering "Enter to continue", "Enter to
// confirm" or "Esc to cancel"). Anything else fails the test with the screen,
// and nothing is typed.
//
// Every wait says what the tab is showing when it runs out of patience, so a
// run that was left alone names the screen that stopped it.
//
// It takes several minutes: two tabs, one resume through the wrapper, a long
// answer and three sends.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry, shellWord } from '../helpers/cli.js';
import { codexTrustArgs } from '../helpers/codex-trust.js';
import { questionOn, waitingOn } from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { deleteOwnProject } from '../helpers/own-project.js';

/**
 * Remove the throwaway bots folder and everything the kit or this test made
 * beside it: `<bots>.prompts`, `<bots>.locks`, this test's wrapper and pager
 * file and the rest are siblings of the bots folder, not children of it (PRD
 * 6.3).
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

/** How long a nudged line is given to show up in the tab, behind a long answer included. */
const ROUND_TRIP_MS = 480000;

/** How long the kit's hook is given to have written the book after a session starts. */
const HOOK_MS = 60000;

/** How long a tab is given to get past the screens of its own, a person answering them included. */
const READY_MS = 180000;

/** How long after a send that typed nothing the tab is watched for a line that should not be there. */
const SETTLE_MS = 15000;

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

/** A row of Claude Code's input box's rules: nothing but `─`, a name set into it aside. */
const RULE_ROW = /^\s*─{8,}/;

/**
 * Why a Claude tab is not at its plain input prompt, or undefined when it is:
 * the screen can be read, shows no question, form or menu (helpers/screens.js,
 * `questionOn`: Claude Code 2.1.283's "Teach auto mode about your
 * environment?" form, drawn after a first turn, is one, #416), and its lowest
 * `❯` row is the input line, between the input box's two rules. A `❯`
 * anywhere below that is a list's pointer.
 */
function notAtPrompt(handle) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  const shown = answer.ok === true ? answer.result?.terminal : undefined;
  if (shown?.source !== 'screen' || !Array.isArray(shown.tail)) {
    return `its screen could not be read (${answer.ok === true ? `source ${shown?.source}` : JSON.stringify(answer.error)})`;
  }
  const rows = shown.tail;
  const screen = `\n    ${rows.join('\n    ')}`;
  if (questionOn(rows) !== undefined) return `a question, form or menu is up:${screen}`;
  const at = rows.findLastIndex((row) => row.trimStart().startsWith('❯'));
  if (at < 0) return `no input line is on it:${screen}`;
  if (!RULE_ROW.test(rows[at - 1] ?? '') || !RULE_ROW.test(rows[at + 1] ?? '')) {
    return `its lowest ❯ row is not the input line between the input box's rules:${screen}`;
  }
  return undefined;
}

/**
 * Type one line into a Claude tab of this test's own, and only when it is at
 * its plain input prompt (architect's rule, #261 live run): a line with a
 * return must never answer a form or a menu. Otherwise fail with the screen,
 * having typed nothing.
 */
function typeIntoClaude(handle, text) {
  const why = notAtPrompt(handle);
  assert.equal(why, undefined, `this test would type ${JSON.stringify(text)} into ${handle}, but ${why}\n  Nothing was typed.`);
  sendLine(handle, text);
}

/** Read `ps` for one pid, and nothing else: it is a reader here and never a road to a signal. */
function psOf(pid, columns) {
  assert.match(String(pid), /^[1-9]\d*$/, `ps is asked about one positive pid, got: ${pid}`);
  const done = spawnSync('ps', [...columns, '-p', String(pid)], { encoding: 'utf8' });
  return done.status === 0 ? done.stdout.trim() : undefined;
}

/**
 * The process in front of a tab's terminal, the way the kit finds it (tech
 * notes, section 1): the tab's pty id, the pane's pid from `orca diagnostics
 * memory`, and the pane's terminal foreground group from `ps`. `name` is the
 * command's own name, a login shell's leading `-` aside, and `ppid` its
 * parent. Undefined when any of it cannot be read.
 */
function inFront(handle) {
  const ptyId = allTerminals().find((terminal) => terminal.handle === handle)?.ptyId;
  const memory = orca(['diagnostics', 'memory']);
  const pane = memory.ok === true
    ? (memory.result?.worktrees ?? []).flatMap((worktree) => worktree.sessions ?? []).find((one) => one.sessionId === ptyId)?.pid
    : undefined;
  if (ptyId === undefined || pane === undefined) return undefined;
  const group = Number(psOf(pane, ['-o', 'tpgid=']));
  if (!Number.isInteger(group) || group <= 0) return undefined;
  const comm = psOf(group, ['-o', 'comm=']);
  const ppid = Number(psOf(group, ['-o', 'ppid=']));
  if (comm === undefined || !Number.isInteger(ppid)) return undefined;
  return { pid: group, ppid, name: path.basename(comm.replace(/^-/, '')) };
}

/** Whether a command name is a shell's. */
const isShell = (name) => ['zsh', 'bash', 'sh', 'fish', 'ksh', 'tcsh', 'dash'].includes(name);

/** Wait until the program named `name` (or a shell, for `shell`) leads the tab's foreground group, and give it back. */
const frontIs = (handle, name, within = ANSWER_MS) => until(
  `${name} to be in front of ${handle}`,
  within,
  async () => {
    const front = inFront(handle);
    if (front === undefined) return undefined;
    return (name === 'shell' ? isShell(front.name) : front.name === name) ? front : undefined;
  },
  () => ` In front now: ${JSON.stringify(inFront(handle) ?? null)}.${whatIsUp(handle)}`,
);

/**
 * What one process carries in its environment, as the words `ps -E` prints
 * (tech notes, section 1). Only ever looked through for a word it names: what
 * it holds is never printed, because it holds whatever this machine keeps there.
 */
const environmentWords = (pid) => (psOf(pid, ['-E', '-ww', '-o', 'command=']) ?? '').split(/\s+/);

/** What Orca names as the tab's agent right now, for the record. */
function agentNamedIn(handle) {
  const shown = orca(['terminal', 'show', '--terminal', handle]);
  return shown.result?.terminal?.agentIdentity ?? null;
}

/** The bot, and the words each step waits for: each is only where the test says. */
const BOT = { name: 'node-nudge', display: 'Node Nudge' };

/** In the target's start prompt only: its first turn prints it. */
const READY_WORD = 'READY-3917';

/** Each send's subject word. Only the nudge carries a subject into the tab; the body is only in the mail. */
const SENDS = {
  idle: { subject: 'while you wait SUBJ-5174', body: 'HERON-2206' },
  busy: { subject: 'while you write SUBJ-7738', body: 'OTTER-9051' },
  pager: { subject: 'behind the pager SUBJ-3362', body: 'MARTEN-4480' },
};
const subjectWord = (send) => send.subject.split(' ').at(-1);

/**
 * The long answer the wrapped Claude is asked for. The request names no total;
 * the sum of 1 to COUNT_TO on screen is the answer finished.
 */
const COUNT_TO = 600;
const LONG_REQUEST = `Write out every whole number from 1 to ${COUNT_TO} in English words, one per line, with nothing else on the line. `
  + 'After the last one, on a line of its own, write SUM: followed by the sum of all of them, in digits.';
const SUM = String((COUNT_TO * (COUNT_TO + 1)) / 2);

/** The word in the file `less` shows: the tab is only ever told the file's path. */
const PAGER_WORD = 'PAGER-8127';

/** What every session here is told. */
const promptOf = (bots, session) => [
  'You are a system test\'s bot and you own nothing.',
  `Your bots folder is ${bots}.`,
  'Do nothing that is not written here: read no file and write nothing.',
  ...(session === 'target'
    ? [
      `Reply now with ${READY_WORD} and nothing else.`,
      'When a line arrives saying fleet mail is waiting, run exactly the command that line names to read it,',
      'and then print MAIL: followed by the text of the message.',
      'When you are asked to write something out, do exactly that.',
    ]
    : []),
  'Otherwise say nothing and wait.',
].join(' ');

/**
 * The wrapper: `node` leads the tab's foreground group, and Claude Code runs
 * under it on the tab's terminal. It exits as Claude Code does.
 */
const WRAPPER = [
  "import { spawn } from 'node:child_process';",
  '',
  "const child = spawn('claude', process.argv.slice(2), { stdio: 'inherit' });",
  "child.on('error', (error) => { process.stderr.write(`the wrapper could not start claude: ${error.message}\\n`); process.exit(127); });",
  "child.on('exit', (code, signal) => process.exit(code ?? (signal === null ? 1 : 128)));",
  '',
].join('\n');

/** A word ps prints that the shell would take back as the same one word, unquoted. */
const SAFE_WORD = /^[A-Za-z0-9,._+:@%/=-]+$/;

test('a Claude Code running as node on the kit\'s launch line is nudged idle and busy, and less in its place after it quit is not', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-node-nudge-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', BOT.name].map(homeOf);
  const home = homeOf(BOT.name);
  const wrapper = `${bots}.wrapper.mjs`;
  const pagerFile = `${bots}.pager.txt`;

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    // Only this test's own tabs are closed. A tab it did not create at one of
    // its homes is not its to close: that project and the bots folder stay
    // where they are, and the test fails naming the tab (review of PR #425).
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
    'bot', 'create', '--bots', bots, '--name', BOT.name, '--harness', 'claude',
    '--charter', `${BOT.display} exists for one system test run and owns nothing.`,
  ]);
  // `target` is Claude at the kit's default, `auto`; `sender` is Codex, so mail
  // between them goes through Orca, where the kit types the nudge, and not by
  // Claude's own messaging (PRD 6.9).
  obkJson(['session', 'add', '--bots', bots, '--bot', BOT.name, '--name', 'target', `--prompt=${promptOf(bots, 'target')}`]);
  obkJson(['session', 'add', '--bots', bots, '--bot', BOT.name, '--name', 'sender', '--harness', 'codex', `--prompt=${promptOf(bots, 'sender')}`, ...codexTrustArgs(bots)]);

  /** Bring one session up, alone, and hand back its tab's entry. */
  const bringUp = (session) => {
    const entry = tabOf(obkJson(['up', '--bots', bots, '--bot', BOT.name, '--session', session]), session);
    assert.equal(entry.created, true);
    assert.equal(
      entry.harnessStarted,
      true,
      `no harness came up in ${entry.title}: look at it with \`orca terminal read --terminal ${entry.terminal} --screen\``,
    );
    return entry;
  };

  /** One send from `sender` to `target`, as the kit answers it. */
  const send = (which) => {
    const answer = obkJson([
      'message', 'send', '--bots', bots, '--to', `${BOT.name}/target`, '--from', `${BOT.name}/sender`,
      '--subject', SENDS[which].subject, '--text', SENDS[which].body,
    ]);
    const { sent, transport, nudged, nudgeTrouble, nudgeUnseen, blocked } = answer;
    t.diagnostic(`${which}: ${JSON.stringify({ sent, transport, nudged, nudgeTrouble, nudgeUnseen, blocked })}`);
    assert.equal(sent, true, `${which}: the message is in the mailbox, got: ${JSON.stringify(answer)}`);
    assert.equal(transport, 'orca', `${which}: through Orca, where the kit types the nudge, got: ${JSON.stringify(answer)}`);
    return answer;
  };

  // 1. The kit's own Claude, one turn, then what the kit gave it, then /exit.
  const target = bringUp('target');
  const handle = target.terminal;
  await showsUp(handle, READY_WORD, READY_MS);
  await readyForMail(handle);
  const id = await until(
    'target to report its session id',
    HOOK_MS,
    async () => (await sessionIn(home, 'target')).session,
    () => ` The kit's hook has not run.${whatIsUp(handle)}`,
  );
  const native = await frontIs(handle, 'claude');
  const shellPid = native.ppid;
  assert.ok(isShell(path.basename(String(psOf(shellPid, ['-o', 'comm='])).replace(/^-/, ''))), `the premise: the kit's claude is the tab's shell's child, pid ${shellPid}`);
  const command = String(psOf(native.pid, ['-ww', '-o', 'command='])).split(/\s+/);
  const end = command.indexOf('--');
  const args = command.slice(1, end < 0 ? undefined : end);
  assert.ok(args.includes('-n'), `the premise: the kit named the session on its line, got: ${args.join(' ')}`);
  for (const word of args) {
    assert.match(word, SAFE_WORD, `the kit's argument ${JSON.stringify(word)} cannot be typed back unquoted; this test would have to learn its quoting`);
  }
  t.diagnostic(`the kit gave claude: ${args.join(' ')}; conversation ${id}`);

  // The sender needs a mailbox of its own, which its launch line makes before
  // its Codex starts. Codex's first-run screens in its tab are the attendee's.
  bringUp('sender');
  await until(
    'sender to have its mailbox',
    HOOK_MS,
    async () => (/^run_/.test(String((await sessionIn(home, 'sender')).mailbox)) ? true : undefined),
  );

  typeIntoClaude(handle, '/exit');
  await frontIs(handle, 'shell');

  // 2. The kit's launch line, with the wrapper where `claude` goes.
  await writeFile(wrapper, WRAPPER);
  const line = [
    'OBK_TAB_SHELL=$$',
    `OBK_CLI=${shellWord(cliEntry)}`,
    'node',
    shellWord(wrapper),
    ...args,
    '--resume',
    shellWord(id),
  ].join(' ');
  sendLine(handle, line);

  // 3. The premise: node in front, the shell's child, carrying the mark.
  const node = await frontIs(handle, 'node');
  await readyForMail(handle);
  assert.equal(node.ppid, shellPid, `the premise: node is the tab's shell's child, got parent ${node.ppid}, shell ${shellPid}`);
  assert.equal(inFront(handle)?.pid, node.pid, 'the premise: and it is still in front, with Claude Code up under it');
  const words = environmentWords(node.pid);
  assert.ok(words.includes(`ORCA_TAB_ID=${target.tabId}`), `the premise: node (pid ${node.pid}) carries this tab's ORCA_TAB_ID ${target.tabId}`);
  assert.ok(words.includes(`OBK_TAB_SHELL=${shellPid}`), `the premise: node (pid ${node.pid}) carries OBK_TAB_SHELL=${shellPid}, its parent`);

  // 4. Idle: nudged, and the line is in the tab.
  t.diagnostic(`idle: Orca names ${JSON.stringify(agentNamedIn(handle))} as the tab's agent`);
  const idle = send('idle');
  assert.equal(idle.nudged, true, `the idle node harness should have been nudged, got: ${JSON.stringify(idle)}`);
  assert.equal('nudgeTrouble' in idle, false, `nothing stopped the nudge, got: ${JSON.stringify(idle)}`);
  await showsUp(handle, subjectWord(SENDS.idle), ROUND_TRIP_MS);
  await readyForMail(handle, ROUND_TRIP_MS);
  t.diagnostic(`idle: the mail was ${screenOf(handle).includes(SENDS.idle.body) ? '' : 'not '}read in the tab`);

  // 5. Busy: a long answer under way, then the send.
  typeIntoClaude(handle, LONG_REQUEST);
  await until(
    `${handle} to be at work on its long answer`,
    ANSWER_MS,
    async () => {
      const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '3000']);
      if (answer.ok === true) return undefined;
      assert.ok(!screenOf(handle).includes(`SUM: ${SUM}`), `the answer finished before the send; ask for a longer one: ${screenOf(handle).slice(0, 2000)}`);
      return true;
    },
    () => whatIsUp(handle),
  );
  t.diagnostic(`busy: Orca names ${JSON.stringify(agentNamedIn(handle))} as the tab's agent`);
  const busy = send('busy');
  assert.ok(
    !screenOf(handle).includes(`SUM: ${SUM}`),
    `the answer finished before the send was answered, so this shows nothing about a busy harness: ${screenOf(handle).slice(0, 2000)}`,
  );
  assert.equal(inFront(handle)?.name, 'node', 'and node was still in front');
  assert.equal(busy.nudged, true, `the busy node harness should have been typed its line, got: ${JSON.stringify(busy)}`);
  assert.equal('nudgeTrouble' in busy, false, `nothing stopped the nudge, got: ${JSON.stringify(busy)}`);
  await showsUp(handle, subjectWord(SENDS.busy), ROUND_TRIP_MS);
  await showsUp(handle, `SUM: ${SUM}`, ROUND_TRIP_MS);
  await readyForMail(handle, ROUND_TRIP_MS);

  // 6. The wrapped Claude quits, and less takes the tab.
  typeIntoClaude(handle, '/exit');
  await frontIs(handle, 'shell');
  await writeFile(pagerFile, `${Array.from({ length: 200 }, (_, n) => `${PAGER_WORD} line ${n + 1}`).join('\n')}\n`);
  sendLine(handle, `less ${shellWord(pagerFile)}`);
  await showsUp(handle, PAGER_WORD);
  const pager = await frontIs(handle, 'less');
  assert.equal(
    environmentWords(pager.pid).some((word) => word.startsWith('OBK_TAB_SHELL=')),
    false,
    `the premise: less (pid ${pager.pid}), started from the shell, carries no OBK_TAB_SHELL`,
  );
  t.diagnostic(`pager: Orca names ${JSON.stringify(agentNamedIn(handle))} as the tab's agent`);
  const behind = send('pager');
  assert.equal(behind.nudged, false, `nothing is typed into a tab with less in front, got: ${JSON.stringify(behind)}`);
  assert.match(
    String(behind.nudgeTrouble),
    /could not tell whether a harness is running in it/,
    `and the kit says it could not tell, got: ${JSON.stringify(behind)}`,
  );
  await setTimeout(SETTLE_MS);
  const shown = screenOf(handle);
  assert.ok(!shown.includes(subjectWord(SENDS.pager)), `nothing should have been typed into less: ${shown.slice(0, 3000)}`);
  assert.ok(shown.includes(PAGER_WORD), `less is still showing this test's file: ${shown.slice(0, 3000)}`);
});
