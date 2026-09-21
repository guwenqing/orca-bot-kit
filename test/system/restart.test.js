// A system test: a restart the user asked for, against the real Claude Code in
// the real Orca on this machine. Run it with `npm run test:system`; `npm test`
// cannot, and no CI machine could.
//
// This is the live check the restart slice exists for, and it is the one thing
// a fake Orca can never prove. `obk restart` closes a real tab — the harness in
// it is killed, and Orca's own resume record goes with the tab (ADR 0002) — and
// then opens a new one and hands the harness the session id the book held. Only
// the harness itself can say whether that brought the conversation back. So the
// session is given a passphrase that exists nowhere but in that conversation,
// the tab is thrown away by the kit, and afterwards the session is asked for the
// passphrase. It can only answer if the conversation really came back.
//
// One harness, not two: this is about the kit's own close-and-resume, which is
// the same code either side, and Claude Code is the cheaper one to sit with —
// one screen to answer rather than two. The resume flags themselves are proved
// on both harnesses by `session-identity.test.js`.
//
// The other half of the claim rides along for nothing, because both are already
// open by the time the restart runs: a tab in the same Orca project that the
// book does not name, and Bot Father's own two tabs in a project of their own.
// Neither is the kit's to close, and both are checked after the restart.
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
//   - checks afterwards that every terminal that was there before is still there.
//
// `orca terminal close --worktree … --all` is never run here, and the helper
// below refuses to run it at all. What the kit itself asks Orca for is the
// implementation's business and is pinned in `test/restart.test.js`; what this
// file can say about it is the thing that matters to the person at the keyboard,
// and it says it at the end: everything that was open before is still open.
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
//
// The keys, measured live and written down in `session-identity.test.js`:
// Claude Code's folder trust takes `\x1b[B\r` — down, then return — sent as one
// payload with its own return and no `--enter`, because a menu takes a return as
// the key it is waiting for. A question put to the agent itself is the other
// case and needs `--enter`: see `askIn`. Nothing here sends any of them; which
// question to answer, and how, is the caller's judgement and not the kit's.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

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

/** Run the real `obk`, the one `npm link` put on PATH. */
function obk(args) {
  const done = spawnSync('obk', args, { encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(done.error, undefined, `could not run \`obk\`: ${done.error?.message}: run \`npm link\` in this repo first`);
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
 * through it. The wait is long because a person is answering.
 */
async function readyForAQuestion(handle, within = READY_MS) {
  await until(
    `${handle} to be past the questions of its own`,
    within,
    async () => {
      const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '5000']);
      if (answer.ok !== true) return undefined;
      return answer.result?.wait?.blockedReason === undefined ? true : undefined;
    },
    () => whatIsUp(handle),
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

/** Ask the session something and wait for `word` to appear on its screen. */
async function answers(handle, question, word, within = ANSWER_MS) {
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
  'When anyone asks you for your codeword, reply with it and nothing else.',
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

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-restart-')));
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
        closed.push(terminal.tabId);
      }
    }
    for (const setup of allSetups()) {
      if (!homes.includes(setup.path) || before.setups.has(setup.id)) continue;
      orca(['project', 'setup-delete', '--setup', setup.id]);
    }
    await removeBotsFolderAndSiblings(bots);

    // The point of all the care above: everything that was open is still open.
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
  // Read back as Orca lists it, not as it was asked for: with Orca's dynamic
  // tab titles on, a title drifts on its own, and what this checks afterwards
  // is that the kit changed nothing — not that Orca kept the title still.
  const mine = terminalsAt(home).find((terminal) => terminal.tabId === spare.result.terminal.tabId);
  assert.ok(mine, `Orca should list the spare tab it just made: ${JSON.stringify(spare.result)}`);

  // And Bot Father's two tabs, in a project of their own, which this restart is
  // not about at all.
  const botFather = terminalsAt(homeOf('bot-father')).map((terminal) => terminal.tabId).sort();
  assert.equal(botFather.length, 2, `init should have left Bot Father two tabs, got: ${JSON.stringify(botFather)}`);

  // Something in this conversation and nowhere else. If the session comes back
  // with the conversation, it can still say it; if it comes back fresh, it
  // cannot, because the start prompt never carried this word.
  await answers(
    opened.terminal,
    `Remember this passphrase: ${BOT.passphrase}. Reply with the passphrase and nothing else.`,
    BOT.passphrase,
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
  assert.equal('promptSent' in back, false, 'a resumed session is not told its duty a second time');
  assert.equal(
    back.harnessStarted,
    true,
    `no ${BOT.harness} came up in ${back.title}: look at it with `
    + `\`orca terminal read --terminal ${back.terminal} --screen\``,
  );

  // Orca agrees: the old tab is gone, the new one is there, and the tab the book
  // never named was not touched.
  const now = await terminalsAfterClosing(home, [opened.tabId]);
  assert.deepEqual(
    now.map((terminal) => terminal.tabId).sort(),
    [back.tabId, mine.tabId].sort(),
    `the session's old tab should be gone and the spare untouched, got: ${JSON.stringify(now)}`,
  );
  const stillMine = now.find((terminal) => terminal.tabId === mine.tabId);
  assert.equal(stillMine.handle, mine.handle, 'the spare tab is the same tab');
  assert.equal(stillMine.title, mine.title, 'and the kit does not even rename a tab that is not its own');
  assert.deepEqual(
    terminalsAt(homeOf('bot-father')).map((terminal) => terminal.tabId).sort(),
    botFather,
    'and Bot Father, whose sessions this restart was not about, still has both its tabs',
  );

  // The book followed the session to its new tab, and it is the same conversation.
  const daily = await sessionIn(home, 'daily');
  assert.equal(daily.tab, back.tabId, `the book should hold the new tab, got: ${JSON.stringify(daily)}`);
  assert.equal(daily.session, id, `and the harness session it resumed, got: ${JSON.stringify(daily)}`);

  // The proof, and the only one there is: the passphrase was said in that
  // conversation and nowhere else.
  await answers(back.terminal, 'What was the passphrase I gave you? Reply with it and nothing else.', BOT.passphrase);

  // And it is still the conversation it was. A resumed Claude Code session keeps
  // its id (tech notes, section 2), so a new id in the book here — with the old
  // one pushed into the history by the hook — would mean the session that came
  // back was a different one, whatever it managed to answer.
  const after = await sessionIn(home, 'daily');
  assert.equal(after.session, id, `the session is still the one the book named, got: ${JSON.stringify(after)}`);
  assert.equal(after.history, undefined, `and it never started a second one, got: ${JSON.stringify(after)}`);
});
