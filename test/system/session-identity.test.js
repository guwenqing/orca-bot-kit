// A system test: session identity against the real harnesses in the real Orca
// on this machine. Run it with `npm run test:system`; `npm test` cannot, and no
// CI machine could.
//
// These are the two live checks slice 04 exists for, and neither can be faked:
//
//   1. `/clear` in a live session. The harness makes a new session id, the
//      kit's hook reports it, the book takes it and puts the old one in that
//      session's history — and the session gets its start prompt back, which
//      is the only thing that says whose session it is once the conversation
//      is gone (PRD 6.4).
//   2. A tab the user closed. Orca drops its resume record with the tab, so the
//      book is all there is (ADR 0002); `obk up` opens a new tab and resumes
//      the harness session, and the conversation is still there.
//
// Both are proved by asking the session, because that is the only proof: a
// book holding the right id says nothing about whether the harness agreed. So
// each bot is given a word in its start prompt and a word in its conversation,
// and afterwards it is asked for them. A model answering from something it was
// never told is not a failure mode worth worrying about.
//
// The machine it runs on is someone's working machine, with their own tabs
// open. So this test, like the two beside it:
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
// It is slow: two real agents, four real answers, and a clear in between.
// Minutes, not seconds.
//
// **It is attended.** A bot folder nobody has opened before asks questions
// before the harness is running in it, and this test answers none of them —
// answering them is the caller's job and not the kit's (PRD 6.5), which is why
// no test in `test/system/` does it. On this machine a first run asks:
//
//   - Claude Code's folder-trust list. Its selection starts on `No, exit`, so
//     it takes a down-arrow and then return, not a bare return.
//   - Codex's directory-trust question, `1. Yes, continue`, already selected.
//   - Codex's `Hooks need review` screen, which is new with the kit's own hook:
//     choose `2`, "Trust all and continue". `1` opens the review list and `esc`
//     backs out of it, and `t` does nothing at all — nine presses, nine tabs
//     still on the screen (round 3, live run). Until it is answered the hook does
//     not run at all and the book stays empty, so this is the one that will
//     look like a broken kit if it goes unanswered. Orca reports it as
//     `blockedReason: "agent-hooks-review-prompt"`.
//
//     And answering it later does not put right the conversation that was
//     already running: Codex never reports that one, whatever happens
//     afterwards (the reviewer proved this). That is why the kit writes down
//     when it launched a harness and asks Codex's own records what ran in the
//     folder since — and why the last test in this file leaves the screen
//     unanswered on purpose for a while. What it finds is written down as a
//     conversation nobody claims; it is never assigned to a session, because
//     the folder holds every session of the bot and every harness they started
//     inside themselves (round 3, finding 1).
//
// So: run it with Orca in front of you and answer what the tabs ask. Every wait
// below says what the tab is showing when it runs out of patience, so a run
// that was left alone names the screen that stopped it rather than timing out
// into silence.
//
// The three screens answer to raw keys, all measured live, each sent as one
// payload with its own return and no `--enter`, because a menu takes a return as
// the key it is waiting for:
//
//     Claude Code's folder trust      \x1b[B\r   down, then return
//     Codex's directory trust         1\r        "Yes, continue"
//     Codex's `Hooks need review`     2\r        "Trust all and continue"
//
// which is what to send if you drive them from a script of your own rather than
// clicking. On the hooks screen `1` opens the review list, which lists Orca's own
// hook beside the kit's, and `esc` backs out of it; only `2` trusts and goes on.
// Nothing here sends any of them: which question to answer, and how, is the
// caller's judgement and not the kit's (PRD 6.5), and a test that guessed at a
// screen it did not recognise is exactly what that rule exists to prevent.
//
// A question put to the agent itself is the other case, and it needs `--enter`:
// see `askIn`.

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
 * `<bots>.prompts`, where a session's start prompt goes, is a **sibling** of the
 * bots folder and not a child of it (PRD 6.3 keeps kit-made folders out of the
 * user's repo), so a teardown that removes `<bots>` alone leaves the sessions'
 * duty text on the disk of whoever ran the test. Anything else the kit ever
 * puts beside it is named the same way, so this takes the folder and every
 * `<bots>.*` next to it, and then says so if one is still there.
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
 * How long a tab is given to be ready for a question. A first run has two
 * screens on it and a person answering them, and a question sent through one of
 * them is refused rather than queued, so this waits rather than races.
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
 * again until the closed tabs are out of it, rather than read once and
 * believed.
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
 * word for whatever is waiting to be answered when it gave one — a Codex
 * `Hooks need review` screen comes back as `agent-hooks-review-prompt` — and
 * then the screen itself, which is the only thing that catches the rest.
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
 * by a shell, and the tab is not waiting on a screen of its own.
 *
 * Idle is not the same as ready. Orca refuses an agent's prompt to a tab that is
 * itself waiting on a prompt — `agent_prompt_blocked`, with Orca reporting
 * `agent-interactive-prompt` — so a run that asked as soon as a TUI answered was
 * asking through Codex's own directory-trust question, and the ask could never
 * land however long it waited afterwards (round 3, live run). The other tests
 * only survived that by luck: their screens happened to be answered first.
 *
 * The wait is long because a person is answering those screens.
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
 * and `--enter` to submit it.
 *
 * `--enter` is what submits a question, and only `--enter`. A return inside the
 * payload works on a menu screen, where a return is the key the menu is waiting
 * for, and does not work here: Codex's composer takes a carriage return as a
 * newline, so three questions sent that way piled up unsent in one draft and
 * every wait below ran out on a session nobody had actually asked anything
 * (round 3, live run — the draft was in the screen dump).
 *
 * `--enter` is gated as an agent prompt and is sometimes refused, with
 * `agent_prompt_blocked` and an `orchestrationRequestId` to reissue the same
 * command against. That reissue was tried on a live tab and refused again, so
 * there is nothing here to fall back to and nothing worth retrying in a loop:
 * this fails with the screen and the id, and submitting it is then a person's
 * decision in the Orca window (PRD 6.5). Round two saw it on one send in four,
 * so a run that hits it is a run to start again rather than a broken kit.
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
async function answers(handle, question, word) {
  await askIn(handle, question);
  await until(
    `${handle} to answer with ${word}`,
    ANSWER_MS,
    async () => (screenOf(handle).includes(word) ? true : undefined),
    () => whatIsUp(handle),
  );
}

/**
 * The two bots, one per harness, each with a word only its start prompt
 * carries and a word only its conversation does.
 *
 * `clears` is what the harness calls wiping the conversation, and they differ:
 * Claude Code has `/clear` and reports `source: "clear"`; Codex has no `/clear`
 * at all — `/new` is its clear, no hook fires at `/new` itself, and SessionStart
 * comes with the first prompt of the new conversation, as an ordinary
 * `source: "startup"` with a new id (tech notes, section 3). Which is why the
 * order below is clear, then ask, then look at the book: it is the only order
 * that is the same on both.
 */
const BOTS = [
  {
    name: 'clear-claude',
    harness: 'claude',
    display: 'Clear Claude',
    clears: '/clear',
    codeword: 'ZEBRA-7734',
    passphrase: 'ORANGE-991',
  },
  {
    name: 'clear-codex',
    harness: 'codex',
    display: 'Clear Codex',
    clears: '/new',
    codeword: 'WALRUS-2210',
    passphrase: 'INDIGO-448',
  },
];

const startPromptFor = (bot) => [
  `You are a system test's bot and you own nothing. Your codeword is ${bot.codeword}.`,
  'When anyone asks you for your codeword, reply with it and nothing else.',
  'Do not run any command, do not read or write any file, and do not use any tool.',
  'Say nothing now and wait.',
].join(' ');

test('a cleared session gets a new id, keeps the old one, and is told its duty again', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-clear-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', ...BOTS.map((bot) => bot.name)].map(homeOf);

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    const closed = [];
    for (const home of homes) {
      for (const terminal of terminalsAt(home)) {
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
    for (const home of homes) {
      assert.deepEqual(await terminalsAfterClosing(home, closed), [], `this test left tabs behind in ${home}`);
    }
  });

  obkJson(['init', '--bots', bots, '--harness', 'claude']);

  for (const bot of BOTS) {
    obkJson([
      'bot', 'create', '--bots', bots, '--name', bot.name, '--harness', bot.harness,
      '--charter', `${bot.display} exists for one system test run and owns nothing.`,
    ]);
    obkJson([
      'session', 'add', '--bots', bots, '--bot', bot.name, '--name', 'daily',
      `--prompt=${startPromptFor(bot)}`,
    ]);
  }

  for (const bot of BOTS) {
    const home = homeOf(bot.name);
    const entry = tabOf(obkJson(['up', '--bots', bots, '--bot', bot.name]), 'daily');
    assert.equal(entry.created, true);
    assert.equal(entry.resumed, false, 'there was nothing to come back to yet');
    assert.equal(
      entry.harnessStarted,
      true,
      `no ${bot.harness} came up in ${entry.title}: look at it with `
      + `\`orca terminal read --terminal ${entry.terminal} --screen\``,
    );

    // The kit's hook fires as the session comes up, so the book learns what the
    // harness is running as without anybody asking it.
    const first = await until(
      `${bot.name} to report its session id`,
      HOOK_MS,
      async () => (await sessionIn(home, 'daily')).session,
      () => ` The kit's hook has not run. On Codex that is usually the \`Hooks need review\` screen.${whatIsUp(entry.terminal)}`,
    );
    assert.equal(typeof first, 'string');
    assert.equal(
      (await sessionIn(home, 'daily')).history,
      undefined,
      'a session that has run under one id only has no history',
    );

    // It knows its duty, because the launch line carried it.
    await answers(entry.terminal, 'What is your codeword? Reply with the codeword only.', bot.codeword);

    // 1. The clear, and then the question. On Codex the hook only fires when the
    // new conversation gets its first prompt, so asking is also what makes the
    // hook run; on Claude Code the hook has already run by then. Either way,
    // answering with the codeword is the proof that the duty came back: the
    // conversation that carried it is gone.
    await askIn(entry.terminal, bot.clears);
    await answers(entry.terminal, 'What is your codeword? Reply with the codeword only.', bot.codeword);

    // 2. And the book followed it: a new id, the old one kept.
    const second = await until(
      `${bot.name} to report a new session id after ${bot.clears}`,
      HOOK_MS,
      async () => {
        const session = (await sessionIn(home, 'daily')).session;
        return session !== undefined && session !== first ? session : undefined;
      },
      () => whatIsUp(entry.terminal),
    );

    const daily = await sessionIn(home, 'daily');
    assert.equal(daily.session, second, `the book holds the id the session runs under now, got: ${JSON.stringify(daily)}`);
    assert.deepEqual(
      (daily.history ?? []).map((old) => old.session),
      [first],
      `the id it ran under before should be in its history, got: ${JSON.stringify(daily.history)}`,
    );
    assert.equal(typeof daily.history[0].ended, 'string', 'with the reason the harness gave for it ending');
    assert.notEqual(daily.history[0].ended.trim(), '');
    assert.ok(Number.isFinite(Date.parse(String(daily.history[0].at))), `and when, got: ${daily.history[0].at}`);
  }
});

test('a session whose tab was closed comes back with its conversation', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-resume-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', ...BOTS.map((bot) => bot.name)].map(homeOf);

  t.after(async () => {
    const closed = [];
    for (const home of homes) {
      for (const terminal of terminalsAt(home)) {
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

    const left = new Set(allTerminals().map((terminal) => terminal.handle));
    for (const handle of before.handles) {
      assert.ok(left.has(handle), `${handle} was open before this test and is gone now`);
    }
    for (const home of homes) {
      assert.deepEqual(await terminalsAfterClosing(home, closed), [], `this test left tabs behind in ${home}`);
    }
  });

  obkJson(['init', '--bots', bots, '--harness', 'claude']);

  for (const bot of BOTS) {
    obkJson([
      'bot', 'create', '--bots', bots, '--name', bot.name, '--harness', bot.harness,
      '--charter', `${bot.display} exists for one system test run and owns nothing.`,
    ]);
    obkJson([
      'session', 'add', '--bots', bots, '--bot', bot.name, '--name', 'daily',
      `--prompt=${startPromptFor(bot)}`,
    ]);
  }

  for (const bot of BOTS) {
    const home = homeOf(bot.name);
    const opened = tabOf(obkJson(['up', '--bots', bots, '--bot', bot.name]), 'daily');
    assert.equal(opened.harnessStarted, true, `no ${bot.harness} came up in ${opened.title}`);

    const id = await until(
      `${bot.name} to report its session id`,
      HOOK_MS,
      async () => (await sessionIn(home, 'daily')).session,
      () => ` The kit's hook has not run. On Codex that is usually the \`Hooks need review\` screen.${whatIsUp(opened.terminal)}`,
    );

    // Something in this conversation and nowhere else. If the session comes
    // back with the conversation, it can still say it; if it comes back fresh,
    // it cannot, because the start prompt never carried this word.
    await answers(
      opened.terminal,
      `Remember this passphrase: ${bot.passphrase}. Reply with the passphrase and nothing else.`,
      bot.passphrase,
    );

    // The user closes the tab. Orca's own resume record goes with it, which is
    // the whole reason the kit keeps a book (ADR 0002).
    orca(['terminal', 'close', '--terminal', opened.terminal, '--tab']);
    assert.deepEqual(
      await terminalsAfterClosing(home, [opened.tabId]),
      [],
      'the fixture itself should have closed the session tab',
    );

    const back = tabOf(obkJson(['up', '--bots', bots, '--bot', bot.name]), 'daily');

    assert.equal(back.created, true, 'a new tab was opened for it');
    assert.notEqual(back.tabId, opened.tabId, 'and it is a new tab, with a new id');
    assert.equal(back.resumed, true, 'and the run says it picked the conversation up again');
    assert.equal('promptSent' in back, false, 'a resumed session is not told its duty a second time');
    assert.equal(
      back.harnessStarted,
      true,
      `no ${bot.harness} came up in ${back.title}: look at it with `
      + `\`orca terminal read --terminal ${back.terminal} --screen\``,
    );
    assert.equal((await sessionIn(home, 'daily')).session, id, 'it is still the same harness session');

    // The proof: the passphrase was only ever said in the conversation.
    await answers(back.terminal, 'What was the passphrase I gave you? Reply with it and nothing else.', bot.passphrase);
  }
});

/**
 * The two bots that start a harness inside themselves, one per harness. A child
 * harness inherits `ORCA_TAB_ID` and fires the kit's hook with a conversation of
 * its own, in the same folder — which is how the review's finding 2 and finding 1
 * both went wrong, and the review only ever proved it on Codex.
 */
const CHILDREN = [
  {
    name: 'child-codex',
    harness: 'codex',
    display: 'Child Codex',
    codeword: 'BADGER-5512',
    child: 'codex exec --skip-git-repo-check \'reply with the single word ok\'',
  },
  {
    name: 'child-claude',
    harness: 'claude',
    display: 'Child Claude',
    codeword: 'MARMOT-8820',
    child: 'claude -p \'reply with the single word ok\' --permission-mode auto',
  },
];

test('a harness the session starts for itself does not become the session\'s conversation', async (t) => {
  // The review's finding 2, live, on both harnesses. Before the fix the child's
  // conversation became the session's, the session's own went into the history,
  // and the next `up` resumed the child's.
  //
  // Attended: answer the trust and hooks-review screens as they come up. If the
  // agent declines to run the command, run the same line in a shell of your own
  // inside that tab's folder with `ORCA_TAB_ID` set to the tab id the failure
  // message names — the point is a harness under the session, however it gets
  // there.
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-child-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', ...CHILDREN.map((bot) => bot.name)].map(homeOf);

  t.after(async () => {
    const closed = [];
    for (const home of homes) {
      for (const terminal of terminalsAt(home)) {
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

    const left = new Set(allTerminals().map((terminal) => terminal.handle));
    for (const handle of before.handles) {
      assert.ok(left.has(handle), `${handle} was open before this test and is gone now`);
    }
    for (const home of homes) {
      assert.deepEqual(await terminalsAfterClosing(home, closed), [], `this test left tabs behind in ${home}`);
    }
  });

  obkJson(['init', '--bots', bots, '--harness', 'claude']);

  for (const bot of CHILDREN) {
    obkJson([
      'bot', 'create', '--bots', bots, '--name', bot.name, '--harness', bot.harness,
      '--charter', `${bot.display} exists for one system test run and owns nothing.`,
    ]);
    obkJson([
      'session', 'add', '--bots', bots, '--bot', bot.name, '--name', 'daily',
      `--prompt=You are a system test's bot and you own nothing. Your codeword is ${bot.codeword}.`
      + ' When anyone asks for your codeword, reply with it and nothing else. Say nothing now and wait.',
    ]);
  }

  for (const bot of CHILDREN) {
    const home = homeOf(bot.name);
    const entry = tabOf(obkJson(['up', '--bots', bots, '--bot', bot.name]), 'daily');
    assert.equal(entry.harnessStarted, true, `no ${bot.harness} came up in ${entry.title}`);

    const own = await until(
      `${bot.name} to report its own session id`,
      HOOK_MS,
      async () => (await sessionIn(home, 'daily')).session,
      () => ` The kit's hook has not run.${whatIsUp(entry.terminal)}`,
    );

    // The session runs a harness of its own, bounded, and says when it is done.
    await answers(
      entry.terminal,
      `Run exactly this command, then reply with the single word DONE: ${bot.child}`,
      'DONE',
    );

    const daily = await sessionIn(home, 'daily');
    assert.equal(daily.session, own, `the session's own conversation is still its own: ${JSON.stringify(daily)}`);
    assert.equal(
      daily.history,
      undefined,
      `and it was not pushed into the history by its own child: ${JSON.stringify(daily)}`,
    );
    // Nor is the child's conversation written down as the session's own loose
    // end: the session reported its conversation itself, so the kit is not
    // unsure about it (round 3, finding 1).
    assert.equal(
      daily.unclaimed,
      undefined,
      `a session that reported for itself has nothing unplaced: ${JSON.stringify(daily)}`,
    );

    // And the session still knows what it is for, which a swapped conversation
    // would have taken with it.
    await answers(entry.terminal, 'What is your codeword? Reply with the codeword only.', bot.codeword);
  }
});

test('a Codex conversation that ran before the hooks file was trusted is not lost', async (t) => {
  // The review's finding 3, live, and the one test in this file that asks you to
  // leave a screen alone for a while.
  //
  // Attended, in this order:
  //   1. Answer Codex's directory-trust question if it asks.
  //   2. Leave `Hooks need review` UNANSWERED until the test says otherwise. The
  //      conversation the launch line started runs behind it and the kit's hook
  //      never fires, so the book learns nothing — which is what this test checks
  //      first. Nothing is asked of the session while that screen is up: Orca
  //      refuses a prompt to a tab that is waiting on one of its own, so there is
  //      no road to the agent from here (round 3, live run).
  //   3. When the test prints that it is waiting, answer the screen with `2`,
  //      "Trust all and continue". Trusting does not replay the report it missed.
  //   4. Answer anything else as usual.
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-untrusted-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', 'untrusted-codex'].map(homeOf);

  t.after(async () => {
    const closed = [];
    for (const home of homes) {
      for (const terminal of terminalsAt(home)) {
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

    const left = new Set(allTerminals().map((terminal) => terminal.handle));
    for (const handle of before.handles) {
      assert.ok(left.has(handle), `${handle} was open before this test and is gone now`);
    }
    for (const home of homes) {
      assert.deepEqual(await terminalsAfterClosing(home, closed), [], `this test left tabs behind in ${home}`);
    }
  });

  obkJson(['init', '--bots', bots, '--harness', 'claude']);
  obkJson([
    'bot', 'create', '--bots', bots, '--name', 'untrusted-codex', '--harness', 'codex',
    '--charter', 'Untrusted Codex exists for one system test run and owns nothing.',
  ]);
  obkJson([
    'session', 'add', '--bots', bots, '--bot', 'untrusted-codex', '--name', 'daily',
    '--prompt=You are a system test\'s bot and you own nothing. Your codeword is OTTER-3391.'
    + ' When anyone asks for your codeword, reply with it and nothing else. Say nothing now and wait.',
  ]);

  const home = homeOf('untrusted-codex');
  const entry = tabOf(obkJson(['up', '--bots', bots, '--bot', 'untrusted-codex']), 'daily');
  assert.equal(entry.harnessStarted, true, `no codex came up in ${entry.title}`);

  // The book knows when it launched a harness here, whatever the harness does next.
  const launched = (await sessionIn(home, 'daily')).launched;
  assert.ok(Number.isFinite(Date.parse(String(launched))), `the book should say when, got: ${launched}`);

  // The screen this case is about. The conversation the launch line started runs
  // behind it, with its duty; the kit's hook does not run at all until the file
  // is trusted. Nothing is asked of the session here — Orca refuses a prompt to a
  // tab that is waiting on one — so the screen itself is what the test waits for.
  await until(
    'the tab to be waiting on its hooks review',
    READY_MS,
    async () => {
      const answer = orca(['terminal', 'wait', '--terminal', entry.terminal, '--for', 'tui-idle', '--timeout-ms', '5000']);
      const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
      return /hooks/i.test(String(blocked)) ? blocked : undefined;
    },
    () => ' Answer Codex\'s directory-trust question if it is up, and then leave the `Hooks need'
      + ' review` screen alone. If this machine has already trusted the kit\'s hooks file, that'
      + ' screen never comes and this case cannot run here at all.'
      + whatIsUp(entry.terminal),
  );

  // And the kit was told nothing, because the hook never ran.
  const unreported = await sessionIn(home, 'daily');
  assert.equal(
    unreported.session,
    undefined,
    'the hook must not have run while the review screen is still up.'
    + ` If it has, this machine trusted the file some other way. Got: ${JSON.stringify(unreported)}`,
  );

  // The one place this file says anything to the person running it: from here on
  // the screen has to be answered, and the run is waiting on it.
  process.stdout.write(
    `session-identity: answer the \`Hooks need review\` screen in ${entry.title} now, with \`2\``
    + ' ("Trust all and continue"). The run waits for it.\n',
  );

  // Now answer the review, and begin a new conversation. Trusting does not
  // replay what it missed, so the id that comes in is the new one — and the one
  // before it can only be found in Codex's own records.
  //
  // Answering the codeword is the proof that the duty came back: the conversation
  // that carried it is gone, and the kit hands it over again because it cannot be
  // sure this is the conversation the launch line spoke to (round 3, finding 1).
  await askIn(entry.terminal, '/new');
  await answers(entry.terminal, 'What is your codeword? Reply with the codeword only.', 'OTTER-3391');

  const daily = await until(
    'untrusted-codex to report a session id once the hooks file is trusted',
    HOOK_MS,
    async () => {
      const entryNow = await sessionIn(home, 'daily');
      return entryNow.session === undefined ? undefined : entryNow;
    },
    () => ' Answer the `Hooks need review` screen with `2` now, if you have not.'
      + whatIsUp(entry.terminal),
  );

  // The conversation that ran before the hook did is on the record — and it is
  // not made this session's history. Nothing Codex writes down could say it was
  // this session's rather than another session's or a child's (round 3, finding
  // 1), so it goes in as a conversation of this folder that nobody claims, for a
  // person or Bot Father to settle.
  assert.equal(
    daily.history,
    undefined,
    `no history may be invented for a conversation nobody reported: ${JSON.stringify(daily)}`,
  );
  assert.ok(
    Array.isArray(daily.unclaimed) && daily.unclaimed.length >= 1,
    'the conversation that ran before the hooks file was trusted must be written down, and it is not:'
    + ` ${JSON.stringify(daily)}.`
    + ' If Codex left no record of it at all — it began no conversation until the review was'
    + ' answered — then this case cannot be tested on this version of it, and that is not the kit'
    + ' failing: say so rather than loosening the rule.',
  );
  for (const id of daily.unclaimed) {
    assert.equal(typeof id, 'string', `as plain ids, got: ${JSON.stringify(daily.unclaimed)}`);
  }
  assert.ok(
    !daily.unclaimed.includes(daily.session),
    `and the conversation it is running now is claimed, so it is not on that list: ${JSON.stringify(daily)}`,
  );
});
