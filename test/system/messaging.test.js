// A system test: two bots the kit made, on the two real harnesses, writing to
// each other through the real Orca mailbox on this machine. Run it with
// `npm run test:system`; `npm test` cannot, and no CI machine could.
//
// It is the live check for the three things the fake Orca cannot answer:
//
//   1. A Claude bot and a Codex bot exchange a message and a reply. Every part
//      of that is real: the Run mailbox each session was given at `up`, the
//      message queued into it, the line typed into the receiver's tab — the
//      only thing that reaches a harness, because the mailbox is pull-only —
//      the harness reading its own mail with `obk message check`, and the
//      reply coming back the other way under its own steam.
//   2. A busy receiver is not interrupted (PRD 6.9). The nudge is typed into a
//      tab that is in the middle of something; both harnesses take a typed
//      line as the next turn rather than cutting into the one they are having,
//      so the work that was running finishes first and the mail is read after.
//   3. A long, oddly formatted message arrives unchanged. Above 4 KiB the body
//      is written to a file beside the bots folder and the message names it,
//      so what has to survive is the file's bytes and the naming of it,
//      through Orca's own store and back.
//
// What the fake Orca cannot say about any of it: whether the fields the kit
// reads out of `orchestration check` are the fields Orca really answers with.
// The kit reads `from_handle`, `thread_id`, `created_at` and the delivery to
// acknowledge; a fake can only agree with whoever wrote it. Case 3 below is
// what settles that, because it reads a real message back out of a real
// mailbox and compares it with what was sent.
//
// The machine it runs on is someone's working machine, with their own tabs
// open. So this test, like the others beside it:
//
//   - works in a throwaway bots folder under the system temp directory;
//   - writes down every terminal and workspace Orca already had, before it
//     creates anything;
//   - touches only what it created, matched by handle and by workspace path;
//   - closes its own tabs one by one (`--terminal <handle> --tab`) and deletes
//     its own workspaces, whatever happened, and checks afterwards that it
//     closed no tab it did not create.
//
// `orca terminal close --worktree … --all` is never run here. It would take
// away tabs, layouts and resume records that belong to the person at the
// keyboard. The helper below refuses to run it at all.
//
// One thing this test cannot clean up, and says so rather than hiding it: the
// Run mailboxes. Orca has no `run-delete`, and `orchestration reset --messages`
// would empty the whole machine's mailbox, which the kit never runs and neither
// does this. So each run of this file leaves two or three Runs behind, named
// `obk <bot>/<session>`, belonging to a bots folder that no longer exists. They
// are listed by `orca orchestration run-list` and can be ignored.
//
// **It is attended.** A bot folder nobody has opened before asks questions
// before the harness is running in it, and this test answers none of them —
// answering them is the caller's job and not the kit's (PRD 6.5). On this
// machine a first run asks for Claude Code's folder trust (the selection starts
// on `No, exit`, so it takes a down-arrow and then return) and possibly a
// harness update offer. The Codex bot's session is given its folder's trust at
// launch (#240, test/helpers/codex-trust.js), so Codex asks neither its
// directory trust nor its hooks review, and writes nothing about this folder
// into the user's own ~/.codex/config.toml. It also runs without Codex's sleep
// tool (#432): told to "wait", a Codex on a GPT-6 model called its built-in
// `sleep` in its turn, for hours, and the waits below for its tab to be idle
// before anything is sent to it never ended (#240's live set). Every wait below
// says what the tab is showing when it runs out of patience, so a run that was
// left alone names the screen that stopped it.
//
// **Nothing here types at a bot.** Each one is given its whole part in its
// start prompt, and the only lines that go into these tabs afterwards are the
// launch line the kit types and the nudge the kit types. That is what the
// product does — a fleet nobody is sitting over — and it is also the only way
// these cases can be relied on to run: Orca gates a line typed into an agent's
// tab as `agent_prompt_blocked`, and on one run of four it refused the re-issue
// it had itself asked for, answering that the prompt "may have reached its exact
// terminal incarnation before restart" and would not be sent again. It has never
// gated the kit's own nudge.
//
// What the test does do to a tab is wait on it. A bot is not written to until
// Orca says nothing of its own is waiting to be answered on it, because the kit
// will not nudge a tab with a question on screen — the guard is right, and a
// test that sends into that window is testing nothing but its own patience.
//
// **What a receipt here may be made of.** Every word these tests wait for has
// to be one the tab it is waited for in was never told. A word that is in the
// question is on the screen whether or not the thing under test ever happened,
// and an assertion that looks for it passes on that echo — which is what the
// review of PR #132 found in the first two cases below: the reply's word, the
// sender's name and the thread were all in what the sending tab had been told,
// and the busy case's finishing word was in its own instruction, so both could
// pass with no reply sent and no work done. Where a fact cannot be checked that
// way it is checked somewhere it can be: the thread and the sender are pinned
// by the unit tests and by case 3, which reads a real message back out of a real
// mailbox.
//
// To see them fail, which is the other half of believing them: take the reply
// sentence out of the Codex bot's start prompt and case 1 cannot find MARMOSET;
// take the shell loop out of the busy bot's and case 2 finds no line in the
// loop's file. Neither passes on what its tab was told.
//
// It is slow: two real agents, a round trip between them, and a long task in
// the middle. Minutes, not seconds.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { addressPattern, cliEntry } from '../helpers/cli.js';
import { codexTrustArgs } from '../helpers/codex-trust.js';
import { waitingOn } from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { deleteOwnProject } from '../helpers/own-project.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/**
 * Remove the throwaway bots folder and everything the kit made beside it.
 *
 * What the kit writes for itself is a **sibling** of the bots folder and not a
 * child of it (PRD 6.3): `<bots>.prompts` for start prompts, and the file a
 * long message's body goes to. A teardown that removes `<bots>` alone leaves
 * both on the disk of whoever ran the test.
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

/** And how long a round trip between two agents is given: two turns and a nudge in between. */
const ROUND_TRIP_MS = 480000;

/**
 * How long a tab is given to get past the screens of its own. A first run has
 * two or three of them and a person answering them.
 */
const READY_MS = 180000;

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
 * The tabs Orca lists at `home` once it has caught up with what was closed.
 * `terminal close` answers ok before `terminal list` stops reporting the tab —
 * seen live on a busy machine — so the listing is read again until the closed
 * tabs are out of it rather than read once and believed.
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
  // The owner reads this output. Orca's word for a workspace must not be in it.
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

/**
 * Keep asking until `look` gives something other than undefined, or the time
 * runs out. `note` is added to the message when it does, so a run left alone
 * says which screen was waiting rather than only that it waited.
 */
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

/**
 * What the tab is showing, for the message of a wait that ran out: Orca's own
 * word for whatever is waiting to be answered when it gave one, and then the
 * screen itself, which is the only thing that catches the rest.
 */
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
 * harness's own. Orca called Codex's update offer idle with no reason, and a
 * return typed into it updated the machine (#329), so the screen is read as
 * well (helpers/screens.js, `waitingOn`). Nothing is typed here; this only
 * waits.
 *
 * A bot whose part is to write to another has to wait for that one, and brought
 * up is not the same as ready. Seen live: the Claude bot sent the moment its own
 * harness was running, the Codex bot was still on its `Hooks need review`
 * screen, and the kit rightly typed nothing into a tab with a question on it —
 * so the mail sat in the mailbox and the receiver never learned it was there.
 * The nudge guard doing its job is what this wait exists to get out of the way
 * of, and the order the bots come up in is only half of it.
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

/**
 * Wait until the receiver is part way through the work it was given, and say so
 * if it has already finished.
 *
 * This is what establishes that the receiver was busy when the message arrived,
 * and it is read off the work's own output rather than out of Orca. Orca cannot
 * answer it: Codex runs a shell command in the background and waits on it, so
 * the TUI reads idle for the whole forty seconds — `satisfied` was never false
 * once in a live run where the work plainly ran.
 *
 * Nor can the screen, any more. Codex 0.157.1 shows a command's output only
 * when the command ends: while the loop ran, no STEP line was ever on the
 * screen, only `Working (22s • esc to interrupt) · 1 background terminal
 * running`, and when it ended, `└ STEP-38 / STEP-39 / STEP-40 / + Show
 * details` (#363). So the loop writes each line to a file in the bot's own
 * folder as well as printing it, and the file is what is read: the third line
 * written, and the last one not.
 */
async function partWayThrough(handle, steps, within = ANSWER_MS) {
  let written = '';
  await until(
    `${handle} to be part way through the work it was given`,
    within,
    async () => {
      written = await readFile(steps, 'utf8').catch(() => '');
      if (!written.includes(PART_WAY)) return undefined;
      assert.ok(
        !written.includes(LAST_STEP),
        `the work finished before this could send anything, so nothing here would be about a busy receiver: ${steps} holds ${JSON.stringify(written)}`,
      );
      return true;
    },
    () => ` ${steps} holds ${JSON.stringify(written)}.${whatIsUp(handle)}`,
  );
}

/**
 * The two bots, and the words that make the checks below mean something.
 *
 * Every receipt this file waits for is a word that could not have come from
 * anything the tab it is waited for in was ever told. That is not fussiness: a
 * word that is in the question is on the screen whether or not the thing under
 * test ever happened, and an assertion that looks for it passes on that echo.
 *
 *   PELICAN  is in the Claude bot's own start prompt, as part of the command it
 *            sends, and the Codex tab is never told it: the nudge says who
 *            wrote and what the subject is, and this is neither. So PELICAN on
 *            the Codex screen is the message having been read.
 *   MARMOSET is in the Codex bot's own start prompt, and the Claude tab is
 *            never told it — not by the message, which asks for a reply without
 *            saying what it should carry. So MARMOSET on the Claude screen is
 *            the reply having been written, carried and read.
 *   STEP-40  is the busy receiver's last line, and it and the time beside it
 *            are what running the loop writes to its file. Its instruction
 *            holds the format that makes them and never the line or the time,
 *            so the file holds them only if the work was done.
 *
 * Which is why each bot's part is in its own start prompt: a prompt that told
 * one bot what the other would say would put that word on the wrong screen
 * before anything happened.
 */
const BOTS = [
  // The Codex bot comes up first, and its order matters: the Claude bot starts
  // writing to it the moment its own harness is running, and a session that has
  // not been brought up has no address to write to yet.
  { name: 'mail-codex', harness: 'codex', display: 'Mail Codex' },
  { name: 'mail-claude', harness: 'claude', display: 'Mail Claude' },
];

/** The word only the Codex bot knows, which reaches the Claude bot only as a reply. */
const PASSPHRASE = 'MARMOSET-9930';

/** The word only the Claude bot knows, which reaches the Codex bot only as mail. */
const QUESTION = 'PELICAN-4417';

/**
 * The work the busy receiver is given: a shell loop of about a minute, and the
 * lines it writes while it runs, each with the time it was written.
 *
 * The lines are numbered with a leading zero so that one of them is not a piece
 * of another — a file holding `STEP-30` must not read as `STEP-3` — and the
 * third is what the test waits for before it sends, which leaves most of the
 * loop still to run. The last one, and its time, say when the work ended:
 * each turn of the loop sleeps first and writes after, so writing `STEP-40` is
 * the last thing the loop does. With the sleep after the write, a read in the
 * second after `STEP-40` would come while the loop was still sleeping.
 *
 * Each line goes, through `tee`, to a file in the bot's own folder, the one
 * place a Codex bot in auto mode may write, because the file grows while the
 * loop runs and the screen does not (see `partWayThrough`). Neither `STEP-03`
 * nor `STEP-40` nor any time is in the instruction, only the format that makes
 * them, so the file holds one only if the loop has run that far.
 *
 * The work used to end in a total the model worked out from the lines, and the
 * case waited for it. It is gone: seen live on Codex 0.157.1, the model stopped
 * waiting on the loop after 30 seconds (`Unknown process id`), summed the
 * thirty lines it had and printed `TOTAL: 465`, while the loop ran on to the
 * end. A sum the model gets wrong says nothing about the kit.
 */
const COUNT_TO = 40;
const STEPS_FILE = 'steps.txt';
const work = (steps) => `for i in $(seq 1 ${COUNT_TO}); do sleep 1; printf 'STEP-%02d %s\\n' "$i" "$(date +%s)" | tee -a ${steps}; done`;
const PART_WAY = 'STEP-03';
const LAST_STEP = `STEP-${COUNT_TO}`;

/**
 * The subjects of the busy case's two mails, which the kit's nudge line carries:
 * the one that starts the work, and the one that arrives while it runs. Neither
 * is a receipt: nothing here waits for either word on a screen.
 */
const START_WORK = 'start the work';
const WHILE_BUSY = 'while you are busy';

/**
 * Where the busy receiver reads its mail to: the time, in whole seconds, just
 * before the kit's check ran, and then the check's answer. The time comes
 * first, so the read itself can only have been later.
 */
const MAIL_FILE = 'mail-read.txt';

/**
 * What every bot here is told, whatever its part: who it is, where its bots
 * folder is — without which the first command it runs cannot be written — and
 * that it does nothing nobody asked it for.
 */
const aBotOf = (bots) => [
  'You are a system test\'s bot and you own nothing.',
  `Your bots folder is ${bots}.`,
  'Do nothing that is not written here: read no file, write nothing, and run no command but the ones below.',
];

/** Reading its own mail when the kit tells it there is some, which both bots in case 1 do. */
const READS_ITS_MAIL = [
  'When a line arrives saying fleet mail is waiting, run exactly the command that line names to read it,',
  'and then print MAIL: followed by the text of the message.',
];

/**
 * How a bot here starts the kit: by the variable its launch line set, which
 * names the CLI that typed that line — this checkout's (#220). Never `obk`,
 * which is whatever the machine has installed, and not `"${OBK_CLI:-obk}"`
 * either: a launch line that lost the variable should fail this test, not
 * quietly fall back to that install.
 */
const KIT = '"$OBK_CLI"';

/**
 * The start prompts for the exchange: each bot's whole part, so that the only
 * lines ever typed into either tab are the launch line the kit types and the
 * nudge the kit types. Nothing in this file drives a tab by hand.
 *
 * That is not only tidiness. Orca gates a line typed into an agent's tab —
 * `agent_prompt_blocked` — and on the third run of four it refused the re-issue
 * it had asked for as well, saying the prompt "may have reached its exact
 * terminal incarnation before restart" and would not be sent again. So a test
 * that types at a bot cannot be relied on to run at all, whatever it does about
 * it. It has never touched the kit's own nudge.
 *
 * It also makes the case a truer picture of the product: two bots that were
 * started, and then talked to each other, with nobody typing at either of them.
 */
const exchangePrompts = (bots, bot) => (bot.harness === 'claude'
  ? [
    ...aBotOf(bots),
    'As soon as you are running, run exactly this command, once:',
    `${KIT} message send --bots ${bots} --to mail-codex/daily --from mail-claude/daily`,
    `--subject 'the system test' --text '${QUESTION}. Please reply to me.'`,
    ...READS_ITS_MAIL,
    'Then wait, and say nothing else.',
  ]
  : [
    ...aBotOf(bots),
    ...READS_ITS_MAIL,
    `When a message asks you to reply, reply to whoever wrote it with your passphrase, which is ${PASSPHRASE}:`,
    `ask the kit for the road with ${KIT} message to, and then send it with the command its answer names.`,
    'Say nothing now and wait.',
  ]).join(' ');

/**
 * The start prompts for the busy receiver: the Codex bot is given a piece of
 * work that takes it the best part of a minute, so that it is still running
 * when the message arrives. It is a shell loop rather than a model counting to
 * itself, because the first version of this case had the agent print forty
 * numbers of its own and it was finished before Orca could be asked whether it
 * was working — the tab has to be busy long enough for "busy" to be a fact
 * anybody can check.
 *
 * The work starts when the test says so, not when the session starts: a first
 * mail, subject START_WORK, whose nudge line carries that subject, and whose
 * body the bot never reads. It used to start from the start prompt, and the
 * case leaned on something it could not bound: the Codex tab's own first-run
 * screens, answered by a person, which kept the loop from starting until the
 * Claude bot was ready too. With Codex's trust given at launch (#240) the loop
 * started at once and was over before the Claude bot's trust was answered, and
 * so before anything could be sent (#432's live run). The test sends the first
 * mail once both bots are ready, and the loop cannot end before then.
 *
 * Its mail it reads the way the receiver in case 3 does: the kit's own check,
 * in its own tab, with its shell writing the answer to a file, here after the
 * time. So when the mail was read is a time its own shell wrote down, and so
 * is when the work ended; the order is theirs, not where things sit on a
 * screen.
 */
const busyPrompts = (bots, bot) => {
  const home = path.join(bots, 'bots', bot.name);
  const check = `${KIT} message check --bots ${bots} --bot ${bot.name} --session daily --json`;
  return (bot.harness === 'codex'
    ? [
      ...aBotOf(bots),
      'Say nothing now and wait.',
      `When a line arrives saying fleet mail is waiting with the subject ${START_WORK}, do not run the command that line names,`,
      'and do not read that mail. Run exactly this command instead, once, and wait for it to finish:',
      work(path.join(home, STEPS_FILE)),
      `When a line arrives saying fleet mail is waiting with the subject ${WHILE_BUSY}, do not run the command that line names.`,
      'Run exactly this command instead, once, and then wait and say nothing else:',
      `{ date +%s; ${check}; } > ${path.join(home, MAIL_FILE)}`,
      'The two files these commands write in your folder are the only thing you write.',
    ]
    : [...aBotOf(bots), 'Say nothing now and wait.']).join(' ');
};

/**
 * Where the receiver in case 3 puts the two answers its mail check gave: its
 * own folder, the one place a Codex bot in auto mode may write.
 */
const READ_FILES = ['first-read.json', 'second-read.json'];

/**
 * The start prompts for the long message. A session's mail is read only in its
 * own tab (#317), so the Codex bot reads it there when the kit's nudge arrives:
 * the kit's own check, twice, with its shell writing each answer to a file for
 * the test to read. The model retypes nothing; what is in the files is the
 * kit's answer.
 */
const longPrompts = (bots, bot) => {
  const check = `${KIT} message check --bots ${bots} --bot ${bot.name} --session daily --json`;
  const [first, second] = READ_FILES.map((file) => path.join(bots, 'bots', bot.name, file));
  return (bot.harness === 'codex'
    ? [
      ...aBotOf(bots),
      'When a line arrives saying fleet mail is waiting, do not run the command that line names.',
      'Run exactly this command instead, once, and then wait and say nothing else.',
      'The two files it writes in your folder are the only thing you write:',
      `${check} > ${first}; ${check} > ${second}`,
    ]
    : [...aBotOf(bots), 'Say nothing now and wait.']).join(' ');
};

/** Everything this test made, taken away again, and a check that nothing else was. */
function cleanUpAfter(t, { before, bots, homes }) {
  t.after(async () => {
    // Only this test's own tabs are closed. A tab it did not create at one of
    // its homes is not its to close: that project and the bots folder stay
    // where they are, and the test fails naming the tab (#426).
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
    // Orca's sidebar keeps a deleted project's row until its window is
    // rebuilt (#343): the kit's own reload, as after a retire.
    if (deleted > 0 && !(await reloadWindow())) t.diagnostic(RELOAD_LINE);
    assert.deepEqual(foreign, [], `tabs this test did not create are open at its homes, so it closed only its own and left those projects and ${bots} in place`);
    await removeBotsFolderAndSiblings(bots);

    // The point of all the care above: this test closed no tab but its own. A
    // tab open before it and gone now that it did not close was closed by
    // someone else on this shared machine, so that is said, not failed (#246).
    const { closedNotOurs, goneElsewhere } = guard.verdict(before.handles);
    assert.deepEqual(closedNotOurs, [], 'this test closed tabs it did not create');
    if (goneElsewhere.length > 0) t.diagnostic(`tabs open before this test and closed elsewhere meanwhile: ${goneElsewhere.join(', ')}`);
    for (const home of homes) {
      assert.deepEqual(await terminalsAfterClosing(home, closed), [], `this test left tabs behind in ${home}`);
    }
    assert.deepEqual(failedDeletes, [], 'projects this test could not remove, left in Orca');
  });
}

/**
 * A throwaway fleet: Bot Father, a Codex bot and a Claude bot, each with one
 * session up and each carrying the part `promptFor` gives it.
 *
 * The bots come up one at a time, in the order `BOTS` has them, because a bot
 * whose part begins the moment it is running can only write to a session that
 * is already up.
 */
async function aFleet(t, label, promptFor) {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };
  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), `obk-system-${label}-`)));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', ...BOTS.map((bot) => bot.name)].map(homeOf);

  // Registered before anything is created, so it runs however the test ends.
  cleanUpAfter(t, { before, bots, homes });

  obkJson(['init', '--bots', bots, '--harness', 'claude']);

  const tabs = {};
  for (const bot of BOTS) {
    obkJson([
      'bot', 'create', '--bots', bots, '--name', bot.name, '--harness', bot.harness,
      '--charter', `${bot.display} exists for one system test run and owns nothing.`,
    ]);
    obkJson([
      'session', 'add', '--bots', bots, '--bot', bot.name, '--name', 'daily',
      `--prompt=${promptFor(bots, bot)}`,
      ...(bot.harness === 'codex' ? codexTrustArgs(bots) : []),
    ]);

    const entry = tabOf(obkJson(['up', '--bots', bots, '--bot', bot.name]), 'daily');
    assert.equal(entry.created, true);
    assert.equal(
      entry.harnessStarted,
      true,
      `no ${bot.harness} came up in ${entry.title}: look at it with `
      + `\`orca terminal read --terminal ${entry.terminal} --screen\``,
    );

    // The address book, live: `up` gave the session a Run of its own and wrote
    // it down, and a Claude session carries its name as well.
    const session = await sessionIn(homeOf(bot.name), 'daily');
    assert.match(String(session.mailbox), /^run_/, `${bot.name} should have a Run mailbox, got: ${JSON.stringify(session)}`);
    if (bot.harness === 'claude') assert.match(String(session.address), addressPattern(bot.name, 'daily'));

    // And it is answerable before the next bot is started. A bot's part begins
    // the moment its own harness is running, and the bot before it may still be
    // on a first-run screen of its own — in which case the kit will not type a
    // nudge into it, rightly, and mail sent to it is mail nobody learns about.
    // The order these come up in is only half of what that needs.
    await readyForMail(entry.terminal);

    tabs[bot.name] = entry;
  }

  return { bots, homeOf, tabs };
}

test('a Claude bot and a Codex bot exchange a message and a reply', async (t) => {
  // Every part of the road is real: the Run mailboxes, the queued message, the
  // line typed into the receiver's tab — the only thing that reaches a harness
  // — the harness reading its own mail, and the reply coming back the other
  // way.
  //
  // Two words carry the proof, and neither can be echoed from the tab it is
  // waited for in. The Codex tab has never been told PELICAN: the nudge carries
  // the sender and the subject, and PELICAN is in the body of the message. The
  // Claude tab has never been told MARMOSET: it is in the Codex bot's own start
  // prompt, and the message asks for a reply without saying what it must carry.
  //
  // Nothing here types at either bot. Each was given its part when it was
  // started, and the only lines that go into these tabs afterwards are the
  // kit's own nudges — which is both what the product does and the only way
  // this case can be relied on to run at all (see `exchangePrompts`).
  //
  // What is deliberately not checked here is the thread, and who a message says
  // it is from. Both are in what the sending bot was told, so an assertion on
  // them would pass on that echo. They are pinned where they can be pinned
  // honestly: the thread by the unit tests, and the sender by the third case
  // below, which reads a real message back out of a real mailbox and compares
  // its `from`.
  const { tabs } = await aFleet(t, 'mail', exchangePrompts);

  // 1. The Claude bot wrote to the Codex bot as soon as it was running, with
  //    the kit's own command, and the Codex bot was nudged, read its own mail
  //    and printed what was in it. Nobody asked it anything: the line the kit
  //    typed is the whole wake-up, and the word it prints was only ever in the
  //    body of the message.
  await showsUp(tabs['mail-codex'].terminal, QUESTION, ROUND_TRIP_MS);

  // 2. And the reply came back the other way under its own steam: the Codex bot
  //    looked the road up, sent it, the Claude bot was nudged in its turn, and
  //    read it. The word is the Codex bot's own.
  await showsUp(tabs['mail-claude'].terminal, PASSPHRASE, ROUND_TRIP_MS);
});

test('a busy receiver finishes what it was doing before it reads its mail', async (t) => {
  // PRD 6.9: queued, not interrupting. The nudge is a typed line, and both
  // harnesses take one as the next turn rather than cutting into the turn they
  // are having — which is the whole reason the kit types a line instead of
  // interrupting the tab.
  //
  // Three things have to hold for that to have been shown, rather than assumed.
  //
  // The receiver has to be busy when the message arrives. That is read off the
  // work's own output — some of the loop's lines written to its file, the last
  // one not yet — and not out of Orca, which cannot answer it: Codex runs a
  // shell command in the background and waits on it, so the tab reads idle for
  // the whole forty seconds it is working (live run, 2 of 3). Nor off the
  // screen, where Codex 0.157.1 shows none of the loop's lines until it has
  // ended (#363).
  //
  // The work has to have finished, so the receipt is the loop's last line in
  // its file. An earlier version waited for a word that was in the instruction
  // itself, and was on the screen whether or not a single line was ever
  // printed; a later one waited for a total the model summed, which Codex
  // 0.157.1 once got wrong with the work done (see `work`).
  //
  // And the mail has to have been read after that. The order is two times the
  // receiver's own shell wrote down: beside the loop's last line, and just
  // before the kit's check handed the mail over. Nobody's screen decides it.
  const { bots, homeOf, tabs } = await aFleet(t, 'busy', busyPrompts);
  const mail = 'OTTER-2245';
  const receiver = tabs['mail-codex'].terminal;
  const steps = path.join(homeOf('mail-codex'), STEPS_FILE);
  const mailRead = path.join(homeOf('mail-codex'), MAIL_FILE);

  // The work starts now, with both bots ready, by the first mail's nudge (see
  // `busyPrompts`): the loop has not run before this, so it cannot have ended.
  assert.equal(await readFile(steps, 'utf8').catch(() => ''), '', `the premise: the loop has not started before it is sent for: ${steps}`);
  const started = obkJson([
    'message', 'send', '--bots', bots, '--to', 'mail-codex/daily', '--from', 'mail-claude/daily',
    '--subject', START_WORK, '--text', 'Start the work your instructions give you for this subject.',
  ]);
  assert.equal(started.nudged, true, `the premise: the kit typed the nudge that starts the work into the receiver's tab: ${JSON.stringify(started)}`);

  // It is part way through that work: some of the loop's lines are in its
  // file, and the last one is not. That is what says the mail below arrives at
  // a receiver with work in hand, and there are some thirty seconds of loop
  // still to run after it.
  await partWayThrough(receiver, steps);

  // Mail arrives in the middle of it. The kit types the nudge in; nobody
  // interrupts anybody. The send exits 0 whether or not the nudge went in —
  // the mail is queued either way — so the kit's own answer is what says it
  // did: a tab it found blocked, or could not be sure of, gets nothing typed.
  const sent = obkJson([
    'message', 'send', '--bots', bots, '--to', 'mail-codex/daily', '--from', 'mail-claude/daily',
    '--subject', WHILE_BUSY, '--text', `${mail} — nothing to do, just read this.`,
  ]);
  assert.equal(sent.sent, true, `the send should have gone through: ${JSON.stringify(sent)}`);
  assert.equal(sent.nudged, true, `the kit should have typed its nudge into the receiver's tab while it worked: ${JSON.stringify(sent)}`);

  // The send types its nudge before it returns, so work not finished now was
  // not finished when the nudge went in.
  const written = await readFile(steps, 'utf8');
  assert.ok(
    !written.includes(LAST_STEP),
    `the work finished before the nudge went in, so this shows nothing about a busy receiver: ${steps} holds ${JSON.stringify(written)}`,
  );

  // It read its mail with the kit's check, and the answer holds the mail. The
  // tab was never told OTTER: the nudge carries the sender and the subject.
  const readIn = async () => {
    try {
      const [at, ...answer] = (await readFile(mailRead, 'utf8')).split('\n');
      return { at: Number(at), answer: JSON.parse(answer.join('\n')) };
    } catch {
      return undefined;
    }
  };
  const read = await until('the receiver to have read its mail', ROUND_TRIP_MS, readIn, () => whatIsUp(receiver));
  assert.ok(
    (read.answer.messages ?? []).some((message) => String(message.body).includes(mail)),
    `the kit's check should have handed it the mail: ${JSON.stringify(read.answer)}`,
  );

  // The work finished: the loop wrote its last line, which is the last thing
  // it does, and the time beside it.
  const lastLine = new RegExp(`${LAST_STEP} (\\d+)`);
  const ended = await until(
    `the loop's last line in ${steps}`,
    ANSWER_MS,
    async () => lastLine.exec(await readFile(steps, 'utf8').catch(() => ''))?.[1],
    () => whatIsUp(receiver),
  );

  // And the mail was read after it. Both times are whole seconds, so the read's
  // has to be a later second than the last line's: in the same second either
  // could have come first.
  assert.ok(
    read.at > Number(ended),
    `the mail should have been read after the work ended, not in the middle of it: the check ran at ${read.at}, and the loop wrote its last line at ${ended}. `
    + `If the screen shows Codex stopped waiting on the loop, the model left its own work, which is not the nudge cutting in: ${screenOf(receiver).slice(0, 3000)}`,
  );
});

test('a long, oddly formatted message arrives unchanged', async (t) => {
  // Above 4 KiB the body is written to a file beside the bots folder and the
  // message names it. So this reads a real message back out of a real mailbox
  // and compares it, character for character, with what was sent — which is
  // also the one check that says whether the fields the kit reads out of
  // `orchestration check` are the fields Orca really answers with.
  //
  // The read is the receiver's own, in its own tab: the kit reads a session's
  // mail nowhere else (#317), and this test runs in a tab of its own. The bot
  // runs the kit's check and its shell writes the kit's answer to a file, so
  // nothing read below went through the model: a model retyping 5 KB of
  // punctuation would be checking the model. The subject and the sender are in
  // the nudge that tab was told, but not in anything the model wrote.
  const { bots, homeOf, tabs } = await aFleet(t, 'long', longPrompts);
  const odd = [
    'Line one, with "double quotes", \'single ones\' and a `backtick`.',
    'A line with a tab\there and trailing spaces   ',
    '- a bullet, which would be read as an option on its own',
    '$(whoami) and ${HOME} and $HOME, none of which may be run by anybody',
    'unicode: café — naïve — 日本語 — 🐙',
    'a windows line ending follows\r',
    '',
    'and a blank line above this one.',
    'x'.repeat(5000),
  ].join('\n');

  const sent = obkJson([
    'message', 'send', '--bots', bots, '--to', 'mail-codex/daily', '--from', 'mail-claude/daily',
    '--subject', 'the long one', '--text', odd,
  ]);
  assert.equal(sent.sent, true, `the message should have gone: ${JSON.stringify(sent)}`);

  // Over the limit, so it travels as a file beside the bots folder, and the
  // message says where.
  assert.ok(typeof sent.file === 'string', `a long body should have been written to a file: ${JSON.stringify(sent)}`);
  assert.ok(sent.file.startsWith(`${bots}.`), `and beside the bots folder, not inside it: ${sent.file}`);
  assert.equal(await readFile(sent.file, 'utf8'), odd, 'the file holds what was sent, character for character');

  // And it reads back out of Orca's own store the same way. The kit nudged the
  // receiver, and it read its mail twice in its own tab, binding to its own Run
  // first, as any session does.
  const home = homeOf('mail-codex');
  const [firstFile, secondFile] = READ_FILES.map((file) => path.join(home, file));
  const answerIn = async (file) => {
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch {
      return undefined;
    }
  };
  const again = await until(
    'the receiver to have read its mail twice',
    ANSWER_MS,
    () => answerIn(secondFile),
    () => whatIsUp(tabs['mail-codex'].terminal),
  );
  const read = await answerIn(firstFile);
  assert.ok(read !== undefined, `the first read should have answered JSON in ${firstFile}`);
  assert.equal(read.messages.length, 1, `one message should have been waiting: ${JSON.stringify(read)}`);
  const [message] = read.messages;
  assert.equal(message.subject, 'the long one');
  assert.equal(message.from, 'mail-claude/daily', 'the sender is a session of the fleet, so a reply has somewhere to go');
  assert.ok(message.body.includes(sent.file), `the message names the file: ${message.body}`);

  // Read once and acknowledged: Orca replays a message until it is acked, so a
  // second check must not hand the same one over again. A refused check hands
  // nothing over either, so the second one has to have read.
  assert.equal(again.read, true, `the second check should have read the mailbox: ${JSON.stringify(again)}`);
  assert.deepEqual(again.messages, [], `the mail was read already: ${JSON.stringify(again)}`);

  // Nothing of the kit's was left in the bot's own folder: the file lives
  // beside the bots folder, the way a long start prompt does (PRD 6.3).
  assert.ok(!sent.file.startsWith(home), `the body file must not be in the bot home: ${sent.file}`);
});
