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
//     its own workspaces, whatever happened, and checks afterwards that every
//     terminal that was there before is still there.
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
// on `No, exit`, so it takes a down-arrow and then return), Codex's directory
// trust (`1. Yes, continue`), Codex's `Hooks need review` (`2`, "Trust all and
// continue" — without it the kit's hook never runs) and possibly a harness
// update offer. Every wait below says what the tab is showing when it runs out
// of patience, so a run that was left alone names the screen that stopped it.
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
// take the shell loop out of the busy bot's and case 2 cannot find the total.
// Neither passes on what its tab was told.
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
import { waitingOn } from '../helpers/screens.js';
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
 * The tabs Orca lists at `home` once it has caught up with what was closed.
 * `terminal close` answers ok before `terminal list` stops reporting the tab —
 * seen live on a busy machine — so the listing is read again until the closed
 * tabs are out of it rather than read once and believed.
 */
async function terminalsAfterClosing(home, closed, within = 5000) {
  const until = Date.now() + within;
  let left = terminalsAt(home);
  while (left.some((terminal) => closed.includes(terminal.tabId)) && Date.now() < until) {
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
 * once in a live run where the work plainly ran (its screen: "Waited for
 * background terminal", then the numbers, then the total). A longer loop would
 * not change that. What does answer it is the loop's own lines: some of them
 * printed, and the total not yet.
 */
async function partWayThrough(handle, marker, within = ANSWER_MS) {
  await until(
    `${handle} to be part way through the work it was given`,
    within,
    async () => {
      const screen = screenOf(handle);
      if (!screen.includes(marker)) return undefined;
      assert.ok(
        !screen.includes(TOTAL),
        `the work finished before this could send anything, so nothing here would be about a busy receiver: ${screen.slice(0, 2000)}`,
      );
      return true;
    },
    () => whatIsUp(handle),
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
 *   TOTAL    is the sum of the numbers the busy receiver counts. Its
 *            instruction asks for the sum and never says what it is, so the
 *            number is what doing the work produces and nothing else.
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
 * The work the busy receiver is given: a shell loop of about a minute, the
 * lines it prints while it runs, and the total only doing it produces.
 *
 * The lines are numbered with a leading zero so that one of them is not a piece
 * of another — a screen holding `STEP-30` must not read as `STEP-3` — and the
 * third is what the test waits for before it sends, which leaves most of the
 * loop still to run.
 */
const COUNT_TO = 40;
const WORK = `for i in $(seq 1 ${COUNT_TO}); do printf 'STEP-%02d\\n' "$i"; sleep 1; done`;
const PART_WAY = 'STEP-03';
const TOTAL = `TOTAL: ${(COUNT_TO * (COUNT_TO + 1)) / 2}`;

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
 */
const busyPrompts = (bots, bot) => (bot.harness === 'codex'
  ? [
    ...aBotOf(bots),
    'As soon as you are running, run exactly this command, once:',
    WORK,
    'When it has finished, print TOTAL: followed by the sum of the numbers in the STEP lines it printed,',
    'on a line of its own.',
    ...READS_ITS_MAIL,
    'Then wait, and say nothing else.',
  ]
  : [...aBotOf(bots), 'Say nothing now and wait.']).join(' ');

/** The start prompt for a bot with nothing to do: case 3 drives the mailbox itself. */
const waitingPrompts = (bots) => [...aBotOf(bots), 'Say nothing now and wait.'].join(' ');

/** Everything this test made, taken away again, and a check that nothing else was. */
function cleanUpAfter(t, { before, bots, homes }) {
  t.after(async () => {
    const closed = [];
    for (const home of homes) {
      for (const terminal of terminalsAt(home)) {
        if (before.handles.has(terminal.handle)) continue;
        orca(['terminal', 'close', '--terminal', terminal.handle, '--tab']);
        closed.push(terminal.tabId);
      }
    }
    let deleted = 0;
    for (const setup of allSetups()) {
      if (!homes.includes(setup.path) || before.setups.has(setup.id)) continue;
      orca(['project', 'setup-delete', '--setup', setup.id]);
      deleted += 1;
    }
    // Orca's sidebar keeps a deleted project's row until its window is
    // rebuilt (#343): the kit's own reload, as after a retire.
    if (deleted > 0 && !(await reloadWindow())) t.diagnostic(RELOAD_LINE);
    await removeBotsFolderAndSiblings(bots);

    // The point of all the care above: everything that was open is still open.
    const left = new Set(allTerminals().map((terminal) => terminal.handle));
    for (const handle of before.handles) {
      assert.ok(left.has(handle), `${handle} was open before this test and is gone now`);
    }
    for (const home of homes) {
      assert.deepEqual(await terminalsAfterClosing(home, closed), [], `this test left tabs behind in ${home}`);
    }
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
  // work's own output — some of the loop's lines printed, the total not yet —
  // and not out of Orca, which cannot answer it: Codex runs a shell command in
  // the background and waits on it, so the tab reads idle for the whole forty
  // seconds it is working (live run, 2 of 3).
  //
  // The work has to have finished, so the receipt is the total, a value its
  // instruction asks for and never states; the word the first version of this
  // case waited for was in the instruction itself, and was on the screen whether
  // or not a single line was ever printed.
  //
  // And the mail has to have been read after that, which is the order the two
  // sit in on the screen, both of them present.
  const { bots, tabs } = await aFleet(t, 'busy', busyPrompts);
  const mail = 'OTTER-2245';
  const receiver = tabs['mail-codex'].terminal;

  // It is part way through what its start prompt gave it: some of the loop's
  // lines are on the screen and the total is not. That is what says the mail
  // below arrives at a receiver with work in hand, and there are some thirty
  // seconds of loop still to run after it.
  await partWayThrough(receiver, PART_WAY);

  // Mail arrives in the middle of it. The kit types the nudge in; nobody
  // interrupts anybody.
  const sent = obk([
    'message', 'send', '--bots', bots, '--to', 'mail-codex/daily', '--from', 'mail-claude/daily',
    '--subject', 'while you are busy', '--text', `${mail} — nothing to do, just read this.`,
  ]);
  assert.equal(sent.status, 0, `the send should have gone through: ${sent.stdout}${sent.stderr}`);

  await showsUp(receiver, mail, ROUND_TRIP_MS);

  const screen = screenOf(receiver);
  assert.ok(
    screen.includes(TOTAL),
    `the work it was given should have finished, and ${TOTAL} is what finishing it produces: ${screen.slice(0, 3000)}`,
  );
  assert.ok(
    screen.indexOf(TOTAL) < screen.indexOf(mail),
    `the mail should have been read after the work, not in the middle of it: ${screen.slice(0, 3000)}`,
  );
});

test('a long, oddly formatted message arrives unchanged', async (t) => {
  // Above 4 KiB the body is written to a file beside the bots folder and the
  // message names it. So this reads a real message back out of a real mailbox
  // and compares it, character for character, with what was sent — which is
  // also the one check that says whether the fields the kit reads out of
  // `orchestration check` are the fields Orca really answers with.
  //
  // Nothing here goes through an agent: what is being checked is the road, and
  // a model retyping 5 KB of punctuation would be checking the model.
  const { bots, homeOf } = await aFleet(t, 'long', waitingPrompts);
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

  // And it reads back out of Orca's own store the same way. This is the
  // receiver's own read: it binds to its own Run first, as any session does.
  const read = obkJson(['message', 'check', '--bots', bots, '--bot', 'mail-codex', '--session', 'daily']);
  assert.equal(read.messages.length, 1, `one message should have been waiting: ${JSON.stringify(read)}`);
  const [message] = read.messages;
  assert.equal(message.subject, 'the long one');
  assert.equal(message.from, 'mail-claude/daily', 'the sender is a session of the fleet, so a reply has somewhere to go');
  assert.ok(message.body.includes(sent.file), `the message names the file: ${message.body}`);

  // Read once and acknowledged: Orca replays a message until it is acked, so a
  // second check must not hand the same one over again.
  const again = obkJson(['message', 'check', '--bots', bots, '--bot', 'mail-codex', '--session', 'daily']);
  assert.deepEqual(again.messages, [], `the mail was read already: ${JSON.stringify(again)}`);

  // Nothing of the kit's was left in the bot's own folder: the file lives
  // beside the bots folder, the way a long start prompt does (PRD 6.3).
  const home = homeOf('mail-codex');
  assert.ok(!sent.file.startsWith(home), `the body file must not be in the bot home: ${sent.file}`);
});
