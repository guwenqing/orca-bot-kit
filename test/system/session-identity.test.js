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
//     `t` on the review screen trusts all. Until it is answered the hook does
//     not run at all and the book stays empty, so this is the one that will
//     look like a broken kit if it goes unanswered. Orca reports it as
//     `blockedReason: "agent-hooks-review-prompt"`.
//
// So: run it with Orca in front of you and answer what the tabs ask. Every wait
// below says what the tab is showing when it runs out of patience, so a run
// that was left alone names the screen that stopped it rather than timing out
// into silence.

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

/** Wait until a TUI is up in the tab, so what is typed next is not swallowed by a shell. */
async function tuiIsUp(handle, within = 60000) {
  await until(
    `a TUI in ${handle}`,
    within,
    async () => {
      const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '5000']);
      return answer.ok === true ? true : undefined;
    },
    () => whatIsUp(handle),
  );
}

/** Type a line into a tab, once the tab is ready to take one. */
async function askIn(handle, text) {
  await tuiIsUp(handle);
  const sent = orca(['terminal', 'send', '--terminal', handle, '--text', text, '--enter']);
  assert.equal(sent.ok, true, `orca terminal send failed: ${JSON.stringify(sent.error)}`);
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
