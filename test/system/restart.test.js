// A system test: a restart the user asked for, against the real Claude Code in
// the real Orca on this machine. Run it with `npm run test:system`; `npm test`
// cannot, and no CI machine could.
//
// This is the live check the restart slice exists for, and it is the one thing
// a fake Orca can never prove. `obk restart` closes a real tab — the harness in
// it is killed, and Orca's own resume record goes with the tab (ADR 0012) — and
// then opens a new one and hands the harness the session id the book held. Only
// the harness itself can say whether that brought the conversation back. So the
// session is given a passphrase that exists nowhere but in that conversation,
// the tab is thrown away by the kit, and afterwards the session is asked for the
// passphrase. It can only answer if the conversation really came back.
//
// Each of those two turns waits for a word its own question does not carry and
// the screen does not yet show — the first for the codeword out of the start
// prompt, the second for the passphrase, which the question asks for without
// saying — and `answers` refuses any other. A wait on a word the question
// itself carries is satisfied by the echo of the line the test just typed in,
// so it would pass with an agent that read nothing, and pass with no agent
// there at all. That is the one way a live test like this goes quietly green
// while proving nothing (found in an attended run, and it had). A word already
// on the screen does the same, and both words are: the harness shows the start
// prompt as the conversation's first line, and a resumed one shows the
// conversation again. So each is asked for in lower case, a form nobody wrote
// down and only a session that holds the word can produce (issue #163).
//
// The kit's own close-and-resume is the same code either side, and Claude Code
// is the cheaper one to sit with, so the first case is Claude Code alone. The
// second is Codex, for a reason of Codex's own (#330): 0.157 starts a shared
// background server by default, and a `codex resume` through it was seen to
// fail once in two tries with "Cannot use the shared background server". The
// kit launches Codex with `--no-daemon`, and that case restarts one Codex
// session several times over, reading after each one what the harness was
// started with, what the book holds, what the screen shows and what the
// conversation remembers. The resume flags themselves are proved on both
// harnesses by `session-identity.test.js`.
//
// The other half of the claim rides along for nothing, because both are already
// open by the time the restart runs: a tab in the same Orca project that the
// book does not name, and Bot Father's own two tabs in a project of their own.
// Neither is the kit's to close, and both are checked after the restart — by
// their handles and tab ids, never by their titles, which are written by
// whatever runs in the tab and drift on their own.
//
// The machine it runs on is someone's working machine, with their own tabs open.
// So this test, like the ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory;
//   - writes down every terminal and workspace Orca already had, before it
//     creates anything;
//   - touches only what it created, matched by handle and by workspace path;
//   - closes its own tabs one by one (`--terminal <handle> --tab`) and then
//     deletes its own workspaces — that order, because a workspace deleted
//     first leaves tabs no command line can reach;
//   - checks afterwards that every tab it closed was one of its own, and that
//     none of its own is left. Not that every tab open before is still open:
//     on a busy machine other sessions close their own tabs meanwhile (#330).
//
// `orca terminal close --worktree … --all` is never run here, and the helper
// below refuses to run it at all. What the kit itself asks Orca for is the
// implementation's business and is pinned in `test/restart.test.js`; what this
// file can say about it is the thing that matters to the person at the keyboard:
// the one tab the kit closed was the session's own, and at the end, every tab
// the test closed was its own.
//
// It is slow: a real agent, three real answers, and a tab closed and reopened in
// between. Minutes, not seconds.
//
// **It is attended.** A bot folder nobody has opened before asks questions
// before the harness is running in it, and this test answers none of them —
// answering them is the caller's job and not the kit's (PRD 6.5). What to expect
// on this machine, in order:
//
//   1. `Restart Claude daily`: Claude Code's folder-trust list. Its selection
//      starts on `No, exit`, so it takes a down-arrow and then return, not a
//      bare return. Nothing can be asked of the tab until it is answered, and
//      every wait below says which screen stopped it.
//   2. The same tab, if Claude Code offers an update: accept it (PRD 6.5).
//   3. After the restart, the new `Restart Claude daily` tab. It is the same
//      folder, which Claude Code has just been told to trust, so it should come
//      straight up; if it asks again, answer it the same way.
//   4. `Bot Father daily` will be sitting on its own trust question. Leave it:
//      nothing is asked of Bot Father here, and a screen nobody talks to costs
//      this test nothing.
//   5. In the Codex case, `Restart Codex daily`: Codex's directory trust, `1.
//      Yes, continue`, already selected; then `Hooks need review`, answered
//      `2`, "Trust all and continue" — without it the kit's hook never runs and
//      the book never learns the session's id. After each restart the tab is
//      the same folder and should come straight up; if it asks again, answer
//      it the same way. `Bot Father daily` is as in 4.
//
// The keys, measured live and written down in `session-identity.test.js`:
// Claude Code's folder trust takes `\x1b[B\r` — down, then return — Codex's
// directory trust `1\r` and its `Hooks need review` `2\r`, each sent as one
// payload with its own return and no `--enter`, because a menu takes a return as
// the key it is waiting for. A question put to the agent itself is the other
// case and needs `--enter`: see `askIn`. Nothing here sends any of them; which
// question to answer, and how, is the caller's judgement and not the kit's.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry } from '../helpers/cli.js';
import { waitingOn } from '../helpers/screens.js';

/**
 * Remove the throwaway bots folder and everything the kit made beside it.
 *
 * `<bots>.prompts`, where a session's start prompt goes, and `<bots>.locks`,
 * where the book's writers take their turn, are **siblings** of the bots folder
 * and not children of it (PRD 6.3 keeps kit-made folders out of the user's
 * repo), so a teardown that removes `<bots>` alone leaves them on the disk of
 * whoever ran the test. Everything the kit puts beside it is named the same
 * way, so this takes the folder and every `<bots>.*` next to it, and then says
 * so if one is still there.
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

/** How long a real agent is given to answer a question before the test gives up on it. */
const ANSWER_MS = 240000;

/** And how long the kit's hook is given to have written the book after a session starts. */
const HOOK_MS = 60000;

/**
 * How long a tab is given to be ready for a question. A first run has a screen
 * on it and a person answering it, and a question sent through that screen is
 * refused rather than queued, so this waits rather than races.
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
 * seen live, for a second or two on a busy machine — so the listing is read
 * again until the closed tabs are out of it, rather than read once and believed.
 *
 * By handle: a raw listing can show a tab under `pty:<ptyId>` rather than its
 * id while Orca calls it orphaned, and the handle is the same either way (#187).
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

/** What every throwaway bots folder of this file is named from, under the system temp directory. */
const THROWAWAY = 'obk-system-restart-';

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

/**
 * Wait until the tab will take a question: a TUI is up, so nothing is swallowed
 * by a shell, and the tab is not waiting on a screen of its own. Idle is not the
 * same as ready — Orca refuses an agent's prompt to a tab that is itself waiting
 * on one — so this waits for the screen to be answered rather than asking
 * through it. Nor is no reason from Orca the same as no question: Orca called
 * Codex's update offer idle, and a return typed into it updated the machine
 * (#329). So the screen itself is read too, and a harness's own question on it
 * is waited out like one Orca names (helpers/screens.js, `waitingOn`). The wait
 * is long because a person is answering.
 */
async function readyForAQuestion(handle, within = READY_MS) {
  await until(
    `${handle} to be past the questions of its own`,
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
 * Ask a live agent something, once the tab is ready to take a line: the text,
 * and `--enter` to submit it. `--enter` is what submits a question, and only
 * `--enter`: a return inside the payload is a newline in the composer, and
 * questions sent that way pile up unsent in a draft.
 *
 * Orca gates `--enter` as an agent prompt and sometimes refuses it, with
 * `agent_prompt_blocked` and an id to reissue against. Reissuing was tried live
 * and refused again, so there is nothing here to retry: this fails with the
 * screen and the id, and submitting it is then a person's decision in the Orca
 * window (PRD 6.5).
 */
async function askIn(handle, text) {
  await readyForAQuestion(handle);
  const sent = orca(['terminal', 'send', '--terminal', handle, '--text', text, '--enter']);
  if (sent.ok === true) return;

  const gated = requestIdIn(sent.error);
  assert.fail(
    `orca terminal send --enter failed: ${JSON.stringify(sent.error)}.`
    + (gated === undefined
      ? ''
      : ' Orca gated it as an agent prompt. Submit the line yourself in the tab, or reissue the'
        + ` same command with --retry-request ${gated} --wait-submit 30 — which was refused when it`
        + ' was tried live, so the tab is where this ends.')
    + whatIsUp(handle),
  );
}

/**
 * The request id an `agent_prompt_blocked` carries, when that is what came back.
 * Read out of the whole error rather than a field of it: where Orca hangs the id
 * is Orca's, and a test that guessed at the shape would say "not gated" when it
 * guessed wrong.
 */
function requestIdIn(error) {
  const found = /"orchestrationRequestId"\s*:\s*"([^"]+)"/.exec(JSON.stringify(error ?? null));
  return found === null ? undefined : found[1];
}

/**
 * Ask the session something and wait for `word` to appear on its screen. Only
 * a word that is neither in the question nor on the screen already can be
 * waited for: the echo of the typed line would satisfy the first, and whatever
 * was already there the second, with no agent reading anything.
 */
async function answers(handle, question, word, within = ANSWER_MS) {
  assert.ok(!question.includes(word), `${word} is in the question itself, so its echo would answer it: ${question}`);
  assert.ok(
    !screenOf(handle).includes(word),
    `${word} is on the screen before anyone asked for it, so an answer would prove nothing: ${question}`,
  );
  await askIn(handle, question);
  await until(
    `${handle} to answer with ${word}`,
    within,
    async () => (screenOf(handle).includes(word) ? true : undefined),
    () => whatIsUp(handle),
  );
}

/** The bot: one session, one word in its start prompt, one word only its conversation will carry. */
const BOT = {
  name: 'restart-claude',
  harness: 'claude',
  display: 'Restart Claude',
  codeword: 'PELICAN-4417',
  passphrase: 'VIOLET-6082',
};

const START_PROMPT = [
  `You are a system test's bot and you own nothing. Your codeword is ${BOT.codeword}.`,
  'When anyone asks you for your codeword, give it in exactly the form they ask for, and nothing else.',
  'Do not run any command, do not read or write any file, and do not use any tool.',
  'Say nothing now and wait.',
].join(' ');

test('a restart closes the session\'s tab and brings the conversation back with it', async (t) => {
  // Before a person is asked to sit through minutes of this: the CLI has to
  // know the command at all. A run that finds out at the end has spent their
  // attention for nothing.
  const knows = obk(['restart']);
  assert.ok(
    !/there is no "restart" command/.test(knows.stderr),
    `this \`obk\` has no restart command yet, so there is nothing live to check: ${knows.stderr}`,
  );

  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), THROWAWAY)));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', BOT.name].map(homeOf);
  const home = homeOf(BOT.name);

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

    // The point of all the care above: this test closes only tabs of its own.
    // The loop above picks them, and it picks only a tab listed at one of the
    // homes this test made and not open before it began; the one tab the kit
    // closed for it is checked where the restart ran. Whether every tab open
    // before is still open is not asked: on a busy machine other sessions
    // close their own tabs while this runs (seen live, #330), and that is not
    // this test's doing. What is asked is that nothing of its own is left.
    for (const each of homes) {
      assert.deepEqual(await terminalsAfterClosing(each, closed), [], `this test left tabs behind in ${each}`);
    }
  });

  obkJson(['init', '--bots', bots, '--harness', 'claude']);
  obkJson([
    'bot', 'create', '--bots', bots, '--name', BOT.name, '--harness', BOT.harness,
    '--charter', `${BOT.display} exists for one system test run and owns nothing.`,
  ]);
  obkJson([
    'session', 'add', '--bots', bots, '--bot', BOT.name, '--name', 'daily',
    `--prompt=${START_PROMPT}`,
  ]);

  const opened = tabOf(obkJson(['up', '--bots', bots, '--bot', BOT.name]), 'daily');
  assert.equal(opened.created, true);
  assert.equal(
    opened.harnessStarted,
    true,
    `no ${BOT.harness} came up in ${opened.title}: look at it with `
    + `\`orca terminal read --terminal ${opened.terminal} --screen\``,
  );

  // The kit's hook fires as the session comes up, so the book learns what the
  // harness is running as without anybody asking it. This is the id the restart
  // has to hand back.
  const id = await until(
    `${BOT.name} to report its session id`,
    HOOK_MS,
    async () => (await sessionIn(home, 'daily')).session,
    () => ` The kit's hook has not run.${whatIsUp(opened.terminal)}`,
  );

  // A tab of the user's own, in the same Orca project, that the book has never
  // heard of. Plain: nothing is started in it and nothing is typed into it, so
  // it costs this run nothing and asks nobody anything. The kit must leave it
  // exactly where it is.
  const spare = orca(['terminal', 'create', '--worktree', `path:${home}`, '--title', `${BOT.display} spare`]);
  assert.equal(spare.ok, true, `could not open the spare tab: ${JSON.stringify(spare.error)}`);
  // Kept as Orca lists it, which is where its handle and its project come
  // from. Found and compared by handle, not tab id: a listing can show a tab
  // under `pty:<ptyId>` while Orca calls it orphaned, and the handle is the
  // same either way (#187; tech notes, section 1).
  const mine = terminalsAt(home).find((terminal) => terminal.handle === spare.result.terminal.handle);
  assert.ok(mine, `Orca should list the spare tab it just made: ${JSON.stringify(spare.result)}`);

  // And Bot Father's two tabs, in a project of their own, which this restart is
  // not about at all.
  const botFather = terminalsAt(homeOf('bot-father')).map((terminal) => terminal.handle).sort();
  assert.equal(botFather.length, 2, `init should have left Bot Father two tabs, got: ${JSON.stringify(botFather)}`);

  // Put something in this conversation and nowhere else. If the session comes
  // back with the conversation it can still say the passphrase; if it comes
  // back fresh it cannot, because the start prompt never carried that word.
  //
  // What is waited for here is the **codeword**, not the passphrase. The
  // passphrase is in the line that was just typed in, so a wait on it would be
  // satisfied by the echo of the test's own question — green whether an agent
  // read the line or not, and green with no agent there at all. The codeword is
  // in the start prompt and in no question, and it is asked for in lower case
  // because the start prompt as written is on the screen: the harness shows it
  // as the conversation's first line. So only a session that is running, has
  // read its duty and has read this line can produce it. Which is the same
  // thing as saying the passphrase reached the conversation.
  //
  // And the wait for the session id above is what makes this safe to ask at
  // all: on Claude Code the kit's hook runs once the folder is trusted (tech
  // notes, section 2), so an id in the book means the trust list has already
  // been answered and this line goes to a live session rather than into a menu.
  // What Orca says of that screen has moved: it was seen idle with nothing
  // blocking, and on Claude Code 2.1.283 its wait timed out (#329), which
  // `readyForAQuestion` does not pass. The screen check it makes as well takes
  // only numbered lists, and that one has no numbers. So the id stays the proof.
  await answers(
    opened.terminal,
    `Remember this passphrase: ${BOT.passphrase}. Then reply with your codeword in lower case and nothing else.`,
    BOT.codeword.toLowerCase(),
  );

  // The restart the user asked for (PRD 6.5). The kit closes that tab itself —
  // the harness in it is killed and Orca's resume record goes with the tab —
  // and opens a new one on the conversation the book holds.
  const answer = obkJson(['restart', '--bots', bots, '--bot', BOT.name]);

  // The facts, not the exact shape: what the answer carries key for key is
  // pinned in `test/restart.test.js`, and a cosmetic difference there is not
  // worth a person sitting through this run again.
  assert.equal(
    (answer.closed ?? []).length,
    1,
    `the run should say it closed one tab, got: ${JSON.stringify(answer.closed)}`,
  );
  const [gone] = answer.closed;
  assert.equal(gone.bot, BOT.name);
  assert.equal(gone.name, 'daily');
  assert.equal(gone.tabId, opened.tabId, 'and it is the session\'s own tab that went');
  assert.equal(gone.terminal, opened.terminal);

  const back = tabOf(answer, 'daily');
  assert.equal(back.created, true, 'a new tab was opened for it');
  assert.notEqual(back.tabId, opened.tabId, 'and it is a new tab, with a new id');
  assert.equal(back.resumed, true, 'and the run says it picked the conversation up again');
  assert.equal('promptReceived' in back, false, 'a resumed session is not told its duty a second time');
  assert.equal(
    back.harnessStarted,
    true,
    `no ${BOT.harness} came up in ${back.title}: look at it with `
    + `\`orca terminal read --terminal ${back.terminal} --screen\``,
  );

  // Orca agrees: the old tab is gone, the new one is there, and the tab the book
  // never named was not touched.
  const now = await terminalsAfterClosing(home, [opened.terminal]);
  assert.deepEqual(
    now.map((terminal) => terminal.handle).sort(),
    [back.terminal, mine.handle].sort(),
    `the session's old tab should be gone and the spare untouched, got: ${JSON.stringify(now)}`,
  );
  const stillMine = now.find((terminal) => terminal.handle === mine.handle);
  assert.equal(stillMine.worktreePath, home, 'and it is still in the bot\'s own Orca project');
  // Its title is deliberately not compared with the one it was made with. A
  // title is written by whatever is running in the tab — the tab's own zsh
  // prompt rewrites it to the folder as soon as it draws — and Orca reports
  // the last thing written, so two reads a minute apart differ for reasons
  // that have nothing to do with the kit (tech notes, section 1: a title is
  // set, never read). Measured live: `Restart Claude
  // spare` was `..estart-claude` by the end of the run. That the kit renames
  // no tab outside the book is pinned in `test/restart.test.js`, where every
  // Orca call it makes can be read.
  assert.deepEqual(
    terminalsAt(homeOf('bot-father')).map((terminal) => terminal.handle).sort(),
    botFather,
    'and Bot Father, whose sessions this restart was not about, still has both its tabs',
  );

  // The book followed the session to its new tab, and it is the same conversation.
  const daily = await sessionIn(home, 'daily');
  assert.equal(daily.tab, back.tabId, `the book should hold the new tab, got: ${JSON.stringify(daily)}`);
  assert.equal(daily.session, id, `and the harness session it resumed, got: ${JSON.stringify(daily)}`);

  // The proof, and the only one there is: the passphrase was said in that
  // conversation and nowhere else. Asked for in lower case, because a resumed
  // harness shows the conversation again and the passphrase as it was typed is
  // on this new screen already.
  await answers(
    back.terminal,
    'What was the passphrase I gave you? Reply with it in lower case and nothing else.',
    BOT.passphrase.toLowerCase(),
  );

  // And it is still the conversation it was. A resumed Claude Code session keeps
  // its id (tech notes, section 2), so a new id in the book here — with the old
  // one pushed into the history by the hook — would mean the session that came
  // back was a different one, whatever it managed to answer.
  const after = await sessionIn(home, 'daily');
  assert.equal(after.session, id, `the session is still the one the book named, got: ${JSON.stringify(after)}`);
  assert.equal(after.history, undefined, `and it never started a second one, got: ${JSON.stringify(after)}`);
});

/** Read `ps` for one pid, and nothing else: it is a reader here and never a road to a signal. */
function psOf(pid, columns) {
  assert.match(String(pid), /^[1-9]\d*$/, `ps is asked about one positive pid, got: ${pid}`);
  const done = spawnSync('ps', [...columns, '-p', String(pid)], { encoding: 'utf8' });
  return done.status === 0 ? done.stdout.trim() : undefined;
}

/**
 * The process in front of a tab's terminal, the way the kit finds it (tech
 * notes, section 1): the tab's pty id, the pane's pid from `orca diagnostics
 * memory`, and the pane's terminal foreground group from `ps`. A harness leads
 * its own group, and its `comm` is exactly `codex`. `name` is the command's own
 * name, a login shell's leading `-` aside. Undefined when any of it cannot be
 * read. As `restored-tab.test.js` has it; the system tests share no helpers.
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
  return comm === undefined ? undefined : { pid: group, name: path.basename(comm.replace(/^-/, '')) };
}

/**
 * The words the harness in front was started with: what the tab's shell made
 * of the launch line the kit typed. `command=` and not `-E`, so none of the
 * environment is read. A resume line carries no prompt, so no word of it has a
 * space in it and the split is exact.
 */
const argvOf = (pid) => (psOf(pid, ['-ww', '-o', 'command=']) ?? '').split(/\s+/);

/**
 * The file a process is running, as `lsof` lists it: the first `n` line of
 * its `txt` files, which is the executable, before the loader and anything
 * mapped after it. Read, and never a road to a signal. Undefined when it
 * cannot be read.
 */
function executableOf(pid) {
  assert.match(String(pid), /^[1-9]\d*$/, `lsof is asked about one positive pid, got: ${pid}`);
  const done = spawnSync('lsof', ['-a', '-p', String(pid), '-d', 'txt', '-Fn'], { encoding: 'utf8' });
  if (done.status !== 0) return undefined;
  return done.stdout.split('\n').find((line) => line.startsWith('n'))?.slice(1);
}

/** What `<codex> --version` says, and the minor version it names, if it names one. */
function codexVersion(executable) {
  const done = spawnSync(executable, ['--version'], { encoding: 'utf8' });
  const said = `${done.stdout ?? ''}${done.stderr ?? ''}${done.error?.message ?? ''}`.trim();
  return { said, minor: Number(/\b0\.(\d+)\.\d+\b/.exec(done.stdout ?? '')?.[1]) };
}

/**
 * The premise that counts: the Codex running in the tab is 0.157 or later. On
 * 0.156 the shared server is off unless asked for, so a green run there would
 * say nothing about the failure this case guards against. Read off the harness
 * the tab is running, not the `codex` this process finds on its own PATH: the
 * tab's shell reads the user's startup files and may find another one.
 */
function assertTabRunsCodex157(pid, which) {
  const executable = executableOf(pid);
  assert.ok(executable, `${which}: could not read which file codex (pid ${pid}) is running from \`lsof -a -p ${pid} -d txt -Fn\``);
  const { said, minor } = codexVersion(executable);
  assert.ok(
    Number.isInteger(minor) && minor >= 157,
    `${which}: this case is about Codex 0.157 and on, and the tab runs ${executable}, whose --version said: ${said}`,
  );
}

/**
 * What Codex 0.157.1 printed when a resume went through its shared background
 * server and failed, before exiting to the shell (tech notes, section 3). A
 * piece of the line only: the rest is Codex's and may be worded differently.
 */
const SHARED_SERVER_ERROR = 'Cannot use the shared background server';

/**
 * How many restarts in a row. The failure was seen once in two tries, so one
 * clean restart would say little; three in a row that each come back is a
 * claim worth a person's time.
 */
const RESTARTS = 3;

/** The Codex bot: one session, one word in its start prompt, one word only its conversation will carry. */
const CODEX_BOT = {
  name: 'restart-codex',
  harness: 'codex',
  display: 'Restart Codex',
  codeword: 'OTTER-5293',
  passphrase: 'AMBER-7716',
};

const CODEX_START_PROMPT = [
  `You are a system test's bot and you own nothing. Your codeword is ${CODEX_BOT.codeword}.`,
  'When anyone asks you for your codeword or your passphrase, give it in exactly the form they ask for, and nothing else.',
  'Do not run any command, do not read or write any file, and do not use any tool.',
  'Say nothing now and wait.',
].join(' ');

/**
 * The form the passphrase is asked for in, one per restart. A resumed Codex
 * shows the conversation again, so every form already given is on the new
 * screen; each restart asks for one nobody has written down yet, and the
 * question only describes it (see `answers`).
 */
const PASSPHRASE_FORMS = [
  ['in lower case', (word) => word.toLowerCase()],
  ['in lower case, with the dash replaced by an underscore', (word) => word.toLowerCase().replace('-', '_')],
  ['in lower case, with the dash replaced by a full stop', (word) => word.toLowerCase().replace('-', '.')],
];

test('#330: a Codex session restarted again and again comes back each time, on the same conversation, without the shared server', async (t) => {
  assert.equal(PASSPHRASE_FORMS.length, RESTARTS, 'one passphrase form per restart');

  // A fast fail, before anyone is asked to sit through the run: the `codex`
  // this process finds is 0.157 or later. It is not the check that counts —
  // the tab's shell may find another one — so the Codex each tab really runs
  // is read again once it is up (`assertTabRunsCodex157`).
  const version = codexVersion('codex');
  assert.ok(
    Number.isInteger(version.minor) && version.minor >= 157,
    `this case is about Codex 0.157 and on, and \`codex --version\` here said: ${version.said}`,
  );

  const knows = obk(['restart']);
  assert.ok(
    !/there is no "restart" command/.test(knows.stderr),
    `this \`obk\` has no restart command yet, so there is nothing live to check: ${knows.stderr}`,
  );

  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), `${THROWAWAY}codex-`)));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', CODEX_BOT.name].map(homeOf);
  const home = homeOf(CODEX_BOT.name);

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

    // The point of all the care above: this test closes only tabs of its own.
    // The loop above picks them, and it picks only a tab listed at one of the
    // homes this test made and not open before it began; the one tab the kit
    // closed for it is checked where the restart ran. Whether every tab open
    // before is still open is not asked: on a busy machine other sessions
    // close their own tabs while this runs (seen live, #330), and that is not
    // this test's doing. What is asked is that nothing of its own is left.
    for (const each of homes) {
      assert.deepEqual(await terminalsAfterClosing(each, closed), [], `this test left tabs behind in ${each}`);
    }
  });

  obkJson(['init', '--bots', bots, '--harness', 'claude']);
  obkJson([
    'bot', 'create', '--bots', bots, '--name', CODEX_BOT.name, '--harness', CODEX_BOT.harness,
    '--charter', `${CODEX_BOT.display} exists for one system test run and owns nothing.`,
  ]);
  obkJson([
    'session', 'add', '--bots', bots, '--bot', CODEX_BOT.name, '--name', 'daily',
    `--prompt=${CODEX_START_PROMPT}`,
  ]);

  const opened = tabOf(obkJson(['up', '--bots', bots, '--bot', CODEX_BOT.name]), 'daily');
  assert.equal(opened.created, true);
  assert.equal(
    opened.harnessStarted,
    true,
    `no ${CODEX_BOT.harness} came up in ${opened.title}: look at it with `
    + `\`orca terminal read --terminal ${opened.terminal} --screen\``,
  );

  // The id the book learns from the kit's hook. On Codex the hook runs only
  // once `Hooks need review` is answered, and a person is answering it, so this
  // waits with their patience rather than the hook's.
  const id = await until(
    `${CODEX_BOT.name} to report its session id`,
    READY_MS,
    async () => (await sessionIn(home, 'daily')).session,
    () => ` The kit's hook has not run. On Codex that is usually the \`Hooks need review\` screen: answer it with 2.${whatIsUp(opened.terminal)}`,
  );

  // The fresh start carried `--no-daemon` too, straight after the approval
  // flag, and was not a resume. Read off the harness itself, not the book.
  const started = await until(
    `codex to be in front of ${opened.title}`,
    READY_MS,
    async () => {
      const now = inFront(opened.terminal);
      return now?.name === 'codex' ? now : undefined;
    },
    () => whatIsUp(opened.terminal),
  );
  assertTabRunsCodex157(started.pid, 'the first start');
  const fresh = argvOf(started.pid);
  assert.ok(!fresh.includes('resume'), `the first start is not a resume, got: ${fresh.join(' ')}`);
  assert.equal(fresh.filter((word) => word === '--no-daemon').length, 1, `the first start carries --no-daemon once, got: ${fresh.join(' ')}`);
  assert.equal(fresh[fresh.indexOf('--approve-for-me') + 1], '--no-daemon', `straight after the approval flag, got: ${fresh.join(' ')}`);

  // Something in this conversation and nowhere else, and a turn, so Codex has
  // the conversation on its own record and a resume has something to find
  // (#295). What is waited for is the codeword in lower case, not the
  // passphrase, whose echo would answer the wait with no agent there at all.
  await answers(
    opened.terminal,
    `Remember this passphrase: ${CODEX_BOT.passphrase}. Then reply with your codeword in lower case and nothing else.`,
    CODEX_BOT.codeword.toLowerCase(),
  );

  let current = opened;
  for (const [round, [form, shaped]] of PASSPHRASE_FORMS.entries()) {
    const which = `restart ${round + 1} of ${RESTARTS}`;
    const answer = obkJson(['restart', '--bots', bots, '--bot', CODEX_BOT.name]);

    assert.equal((answer.closed ?? []).length, 1, `${which}: the run should say it closed one tab, got: ${JSON.stringify(answer.closed)}`);
    assert.equal(answer.closed[0].terminal, current.terminal, `${which}: and it is the session's own tab that went`);
    const back = tabOf(answer, 'daily');
    assert.equal(back.created, true, `${which}: a new tab was opened for it`);
    assert.notEqual(back.tabId, current.tabId, `${which}: and it is a new tab, with a new id`);
    assert.equal(back.resumed, true, `${which}: and the run says it picked the conversation up again`);
    assert.equal('promptReceived' in back, false, `${which}: a resumed session is not told its duty a second time`);
    assert.equal(
      back.harnessStarted,
      true,
      `${which}: no ${CODEX_BOT.harness} came up in ${back.title}: look at it with `
      + `\`orca terminal read --terminal ${back.terminal} --screen\``,
    );
    assert.deepEqual(
      (await terminalsAfterClosing(home, [current.terminal])).map((terminal) => terminal.handle),
      [back.terminal],
      `${which}: the session's old tab should be gone and the new one there`,
    );

    // Codex is up in the new tab and stays up. A resume that went through the
    // shared server printed the error and dropped to the shell, so the error on
    // the screen ends the wait at once, with the screen, rather than at the
    // end of the patience.
    const front = await until(
      `${which}: codex to be in front of ${back.title}`,
      READY_MS,
      async () => {
        if (screenOf(back.terminal).includes(SHARED_SERVER_ERROR)) {
          assert.fail(`${which}: Codex could not use its shared background server.${whatIsUp(back.terminal)}`);
        }
        const now = inFront(back.terminal);
        return now?.name === 'codex' ? now : undefined;
      },
      () => whatIsUp(back.terminal),
    );

    // What the kit's launch line started: a resume of the book's conversation,
    // without the shared server, `--no-daemon` once and straight after the
    // approval flag, and the id last.
    assertTabRunsCodex157(front.pid, which);
    const argv = argvOf(front.pid);
    const said = argv.join(' ');
    assert.equal(path.basename(argv[0]), 'codex', `${which}: the harness is codex, got: ${said}`);
    assert.equal(argv[1], 'resume', `${which}: it is a resume, got: ${said}`);
    assert.equal(argv.filter((word) => word === '--no-daemon').length, 1, `${which}: it carries --no-daemon once, got: ${said}`);
    assert.equal(argv[argv.indexOf('--approve-for-me') + 1], '--no-daemon', `${which}: straight after the approval flag, got: ${said}`);
    assert.equal(argv.at(-1), id, `${which}: and it resumes the conversation the book held, got: ${said}`);

    const daily = await sessionIn(home, 'daily');
    assert.equal(daily.tab, back.tabId, `${which}: the book should hold the new tab, got: ${JSON.stringify(daily)}`);
    assert.equal(daily.session, id, `${which}: and the same conversation, got: ${JSON.stringify(daily)}`);

    // The proof that the conversation came back: the passphrase was said in it
    // and nowhere else. In a form nobody has written down, because a resumed
    // Codex shows the conversation again, earlier answers and all.
    await answers(
      back.terminal,
      `What was the passphrase I gave you? Reply with it ${form} and nothing else.`,
      shaped(CODEX_BOT.passphrase),
    );

    // And it is still that conversation. A resume keeps its id (tech notes,
    // section 3); a fresh one would have reported a new id at its first
    // prompt, just now, and pushed this one into the history.
    const after = await sessionIn(home, 'daily');
    assert.equal(after.session, id, `${which}: the session is still the one the book named, got: ${JSON.stringify(after)}`);
    assert.equal(after.history, undefined, `${which}: and it never started a second one, got: ${JSON.stringify(after)}`);
    if (screenOf(back.terminal).includes(SHARED_SERVER_ERROR)) {
      assert.fail(`${which}: the shared server's error is on the screen.${whatIsUp(back.terminal)}`);
    }
    if (inFront(back.terminal)?.name !== 'codex') {
      assert.fail(`${which}: codex is no longer in front.${whatIsUp(back.terminal)}`);
    }

    current = back;
  }
});
