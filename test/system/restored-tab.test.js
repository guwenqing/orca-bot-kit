// A system test: a session whose harness the kit's launch line did not start
// (#318), against the real harnesses in the real Orca on this machine. Run it
// with `npm run test:system -- --yes`; `npm test` cannot, and no CI machine could.
//
// After a machine restart or an Orca update, Orca resumes every tab's harness by
// itself, as a bare `claude --resume <id>` or `codex resume <id>` typed into the
// tab's shell, with nothing of the kit's launch line (tech notes, "When Orca
// restores its tabs by itself"). A cold restore cannot be staged here without
// restarting the owner's Orca, so this test stands in for it the way #318
// allows: the harness in the kit's tab is quit, and the same bare resume Orca
// would type is typed into the tab's shell. The harness then sits where a
// restored one does, a child of the tab's login shell, with ORCA_TAB_ID and no
// OBK_TAB_SHELL, and the test checks that premise before it relies on it.
//
// What it shows, for one Claude Code bot and one Codex bot:
//
//   1. Before the stand-in, `obk health` says nothing about the session: the kit
//      started it, and the harness in front carries the launch line's marker.
//   2. After it, `obk health` names the session in one `session` finding, with
//      the `restart` that puts it back on bot.yaml, and the resume itself left
//      the book as it was.
//   3. A clear in that tab (`/clear` on Claude Code, `/new` on Codex) is written
//      to the book, the old id kept in history, and the session is told its
//      duty again: asked for its codeword, which only the start prompt carried,
//      it answers.
//   4. A stranger's harness in another tab of the same Orca project, which sits
//      where a tab's own harness does, is not written to the book at all.
//
// Every answer is waited for as a word neither its question nor the screen
// already carries (`answers`), because a harness shows its start prompt as the
// conversation's first line and a resumed one shows the conversation again;
// session-identity.test.js says why at length.
//
// The machine it runs on is someone's working machine, with their own tabs
// open. So this test, like the ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory;
//   - writes down every terminal and workspace Orca already had, before it
//     creates anything;
//   - touches only what it created, matched by handle and by workspace path,
//     the stranger's tab included;
//   - closes its own tabs one by one (`--terminal <handle> --tab`) and then
//     deletes its own workspaces, whatever happened, and checks afterwards that
//     every terminal that was there before is still there;
//   - runs this checkout's `src/cli.js` by its full path, never the machine's
//     `obk`.
//
// `orca terminal close --worktree … --all` is never run here, and the helper
// below refuses to run it at all. `ps` is only ever read, one pid at a time,
// and nothing here signals a process: every harness this test starts ends when
// its tab is closed.
//
// It is slow: two real agents, a quit and a resume each, a clear each, and a
// third harness in the stranger's tab. Minutes, not seconds.
//
// **It is attended.** A bot folder nobody has opened before asks questions
// before the harness is running in it, and this test answers none of them
// (PRD 6.5). On this machine a first run asks:
//
//   - Claude Code's folder-trust list, for Bot Father's daily and for the Claude
//     bot: its selection starts on `No, exit`, so down-arrow then return
//     (`\x1b[B\r`). Bot Father's can be left alone; nothing here waits on it.
//   - Codex's directory-trust question: `1` (`1\r`), "Yes, continue".
//   - Codex's `Hooks need review`: `2` (`2\r`), "Trust all and continue". It has
//     to be `2`: with `3` the kit's hook never runs, the book never learns the
//     session's id, and the first wait runs out saying so.
//
// The resumes, the clears and the stranger's `claude` run in folders already
// trusted by then, so they are expected to ask nothing more; this test has not
// yet been run live, and if one of them does ask, answer it. Codex's `/new` menu
// ("Where should the new conversation run?") is answered here, with `1`, as
// session-identity.test.js does.
//
// Orca sometimes refuses a line sent with `--enter` as an agent prompt
// (`agent_prompt_blocked`). The failure then says which tab and which line;
// type it there yourself and run the test again.
//
// The resumed harnesses run on whatever this machine's own harness settings say,
// because that is what a restore does: on 2026-09-25 this machine's Codex
// defaults were `approval_policy never` with `sandbox danger-full-access`. The
// bots are told to run nothing and are only ever asked for their codeword.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, realpath, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry, spellingsOf } from '../helpers/cli.js';

/**
 * Remove the throwaway bots folder and everything the kit made beside it: the
 * folder and every `<bots>.*` next to it, where the start prompts go
 * (session-identity.test.js says why), and then say so if one is still there.
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
 * How long a tab is given to be ready for a question. A first run has screens
 * on it and a person answering them, so this waits rather than races.
 */
const READY_MS = 180000;

/** How long a harness is given to quit back to its tab's shell (seen live: within about 3 s). */
const QUIT_MS = 30000;

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
 * `terminal close` answers ok before `terminal list` stops reporting the tab,
 * so the listing is read again until the closed ones are out of it. By handle,
 * which stays the same while a tab is listed as orphaned (#187).
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
 * published release this machine uses, not the code under test (#217, #220).
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

/**
 * Run `obk health --json` and read it. It exits 1 when it has found anything,
 * and this machine's own Orca settings may be something it finds, so 0 and 1
 * are both an answer here, as long as the exit matches the findings.
 */
function healthOf(bots) {
  const done = obk(['health', '--bots', bots, '--json']);
  let answer;
  try {
    answer = JSON.parse(done.stdout);
  } catch {
    assert.fail(`obk health --json did not print JSON: ${done.stdout}${done.stderr}`);
  }
  assert.equal(done.status, answer.found.length === 0 ? 0 : 1, `obk health exited ${done.status}: ${done.stdout}${done.stderr}`);
  return answer;
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

/** Every session entry in one bot's book. */
async function sessionsIn(home) {
  const book = parse(await readFile(path.join(home, 'sessions.yaml'), 'utf8')) ?? {};
  return book.sessions ?? {};
}

/** Whether `word` is in `text` as a word of its own, not inside another. */
const hasWord = (text, word) => new RegExp(`(^|[^A-Za-z0-9_-])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9_-])`).test(text);

/** The findings about one session of one bot: the bot's own, naming the session. */
const findingsAbout = (answer, bot, session) => answer.found
  .filter((one) => one.bot === bot && hasWord(`${one.where} ${one.says}`, session));

/**
 * The conversations Claude Code has on record for one folder, from `since` on:
 * one transcript per conversation, named by its id, in a folder named for the
 * working directory with every character that is not a letter or a digit made a
 * dash (tech notes, section 2). Read only.
 */
async function claudeConversationsSince(home, since) {
  const dir = path.join(os.homedir(), '.claude', 'projects', home.replaceAll(/[^A-Za-z0-9]/g, '-'));
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const found = [];
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    try {
      if ((await stat(path.join(dir, name))).mtimeMs >= since) found.push(name.slice(0, -'.jsonl'.length));
    } catch {
      // Gone between the listing and the look, which is not one of today's.
    }
  }
  return found;
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
 * word for whatever is waiting to be answered, and then the screen itself.
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
 * Wait until the tab will take a question: a TUI is up and the tab is not
 * waiting on a screen of its own (session-identity.test.js says why idle is not
 * enough).
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

/** The request id an `agent_prompt_blocked` carries, when that is what came back. */
function requestIdIn(error) {
  const found = /"orchestrationRequestId"\s*:\s*"([^"]+)"/.exec(JSON.stringify(error ?? null));
  return found === null ? undefined : found[1];
}

/**
 * Type one line into a tab and submit it with `--enter`, the only thing that
 * submits one (session-identity.test.js, `askIn`). A refusal fails with the
 * line, so the person running this can type it in the tab themselves.
 */
function typeInto(handle, text) {
  const sent = orca(['terminal', 'send', '--terminal', handle, '--text', text, '--enter']);
  if (sent.ok === true) return;
  const gated = requestIdIn(sent.error);
  assert.fail(
    `orca terminal send --enter failed: ${JSON.stringify(sent.error)}.`
    + (gated === undefined ? '' : ' Orca gated it as an agent prompt.')
    + ` Type \`${text}\` into that tab yourself and run the test again.${whatIsUp(handle)}`,
  );
}

/** Ask a live agent something, once the tab is ready to take a line. */
async function askIn(handle, text) {
  await readyForAQuestion(handle);
  typeInto(handle, text);
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

/** What Codex asks as soon as `/new` is typed (tech notes, section 3). */
const WHERE_TO_RUN = 'Where should the new conversation run?';

/**
 * Clear the session the way its harness does, and come back only once the new
 * conversation will take a question: on Codex, `/new`, then `1` for the menu it
 * puts up first, and the menu gone.
 */
async function clearIn(handle, bot) {
  await askIn(handle, bot.clears);
  if (bot.harness !== 'codex') return;

  const asking = () => screenOf(handle).includes(WHERE_TO_RUN);
  await until(
    `${handle} to ask where the new conversation should run`,
    READY_MS,
    async () => (asking() ? true : undefined),
    () => whatIsUp(handle),
  );
  const picked = orca(['terminal', 'send', '--terminal', handle, '--text', '1\r']);
  assert.equal(picked.ok, true, `answering the menu failed: ${JSON.stringify(picked.error)}.${whatIsUp(handle)}`);
  await until(
    `${handle} to start the new conversation`,
    READY_MS,
    async () => (asking() ? undefined : true),
    () => whatIsUp(handle),
  );
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
 * command's own name, a login shell's leading `-` aside. Undefined when any of
 * it cannot be read.
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

/** Whether a command name is a shell's. */
const isShell = (name) => ['zsh', 'bash', 'sh', 'fish', 'ksh', 'tcsh', 'dash'].includes(name);

/**
 * What one process carries in its environment, as the words `ps -E` prints
 * (tech notes, section 1). Only ever looked through for a word it names: what
 * it holds is never printed, because it holds whatever this machine keeps there.
 */
const environmentWords = (pid) => (psOf(pid, ['-E', '-ww', '-o', 'command=']) ?? '').split(/\s+/);

/**
 * The two bots, one per harness, each with a word only its start prompt
 * carries. `clears` is what the harness calls wiping the conversation, and
 * `ended` what the book records for it: Claude Code's `/clear` reports `clear`,
 * and Codex's `/new` reports an ordinary `startup` at the new conversation's
 * first prompt (tech notes, section 3). `quits` leaves the harness for the
 * tab's shell, and `resumes` is what Orca's restore types for an id.
 */
const BOTS = [
  {
    name: 'restored-claude',
    harness: 'claude',
    display: 'Restored Claude',
    codeword: 'HERON-6021',
    quits: '/exit',
    resumes: (id) => `claude --resume ${id}`,
    clears: '/clear',
    ended: 'clear',
  },
  {
    name: 'restored-codex',
    harness: 'codex',
    display: 'Restored Codex',
    codeword: 'BEAVER-3187',
    quits: '/quit',
    resumes: (id) => `codex resume ${id}`,
    clears: '/new',
    ended: 'startup',
  },
];

/** What each bot is told to be: inert, and holding a codeword it gives in whatever form it is asked for. */
const startPromptFor = (bot) => [
  `You are a system test's bot and you own nothing. Your codeword is ${bot.codeword}.`,
  'When anyone asks you for your codeword, give it in exactly the form they ask for, and nothing else.',
  'Do not run any command, read or write any file, or use any tool.',
  'Say nothing now and wait.',
].join(' ');

/** The codeword in forms nobody wrote down, one per time it is asked (session-identity.test.js, `lowered`). */
const lowered = (word) => word.toLowerCase();
const underscored = (word) => word.replace('-', '_');

test('a session Orca brought back without the kit\'s launch line is named by health, and its clear is still the kit\'s', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-restored-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', ...BOTS.map((bot) => bot.name)].map(homeOf);

  // Registered before anything is created, so it runs however this test ends.
  // The stranger's tab is in the Claude bot's workspace, so it goes with the rest.
  t.after(async () => {
    const closed = [];
    for (const home of homes) {
      for (const terminal of terminalsAt(home)) {
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
    obkJson(['session', 'add', '--bots', bots, '--bot', bot.name, '--name', 'daily', `--prompt=${startPromptFor(bot)}`]);
  }

  const tabs = {};
  const firsts = {};
  for (const bot of BOTS) {
    const home = homeOf(bot.name);

    // 1. The kit starts the session, and its hook tells the book its id.
    const entry = tabOf(obkJson(['up', '--bots', bots, '--bot', bot.name]), 'daily');
    assert.equal(
      entry.harnessStarted,
      true,
      `no ${bot.harness} came up in ${entry.title}: look at it with \`orca terminal read --terminal ${entry.terminal} --screen\``,
    );
    tabs[bot.name] = entry;
    // With a person answering the first-run screens in front of it, so with
    // their patience rather than the hook's.
    const first = await until(
      `${bot.name} to report its session id`,
      READY_MS,
      async () => (await sessionIn(home, 'daily')).session,
      () => ` The kit's hook has not run. On Codex that is usually the \`Hooks need review\` screen: answer it with 2.${whatIsUp(entry.terminal)}`,
    );
    firsts[bot.name] = first;

    // A turn, so the harness has the conversation on its own record and a
    // resume of it has something to find (tech notes, section 2: a conversation
    // with no turn has no file). In lower case, a form nobody wrote down.
    await answers(entry.terminal, 'What is your codeword? Reply with the codeword in lower case and nothing else.', lowered(bot.codeword));

    // The contrast, before the stand-in: the kit's own harness carries the
    // launch line's marker, and health has nothing to say about the session.
    const launched = inFront(entry.terminal);
    assert.equal(launched?.name, bot.harness, `the premise: the kit's ${bot.harness} is in front of ${entry.title}, got: ${JSON.stringify(launched)}`);
    assert.ok(
      environmentWords(launched.pid).some((word) => word.startsWith('OBK_TAB_SHELL=')),
      `the premise: the harness the kit's launch line started carries OBK_TAB_SHELL (pid ${launched.pid})`,
    );
    const kitStarted = healthOf(bots);
    assert.equal(
      kitStarted.sessions.find((one) => one.bot === bot.name && one.session === 'daily')?.running,
      'yes',
      `the premise: health sees ${bot.name}'s harness in front, got: ${JSON.stringify(kitStarted.sessions, null, 2)}`,
    );
    assert.deepEqual(
      findingsAbout(kitStarted, bot.name, 'daily'),
      [],
      `the kit started ${bot.name}'s session, so health has nothing to say about it`,
    );

    // 2. The stand-in for Orca's restore: the harness quits to the tab's shell,
    // and the bare resume Orca would type goes into that shell, with nothing of
    // the kit's launch line on it.
    await askIn(entry.terminal, bot.quits);
    await until(
      `${bot.harness} in ${entry.title} to quit to the tab's shell`,
      QUIT_MS,
      async () => (isShell(inFront(entry.terminal)?.name) ? true : undefined),
      () => whatIsUp(entry.terminal),
    );
    typeInto(entry.terminal, bot.resumes(first));
    const restored = await until(
      `${bot.harness} to be back in front of ${entry.title} after \`${bot.resumes(first)}\``,
      READY_MS,
      async () => {
        const front = inFront(entry.terminal);
        return front?.name === bot.harness ? front : undefined;
      },
      () => whatIsUp(entry.terminal),
    );
    await readyForAQuestion(entry.terminal);

    // The premise of everything after this: the harness sits where a restored
    // one does, with the tab's id and without the kit's marker.
    const words = environmentWords(restored.pid);
    assert.ok(words.includes(`ORCA_TAB_ID=${entry.tabId}`), `the premise: the resumed ${bot.harness} (pid ${restored.pid}) carries this tab's ORCA_TAB_ID`);
    assert.ok(
      !words.some((word) => word.startsWith('OBK_TAB_SHELL=')),
      `the premise: the resumed ${bot.harness} (pid ${restored.pid}) carries no OBK_TAB_SHELL, as a harness Orca restored carries none`,
    );

    // Resuming the conversation the book already names changes nothing in it.
    const resumed = await sessionIn(home, 'daily');
    assert.equal(resumed.session, first, `the resume is the same conversation, got: ${JSON.stringify(resumed)}`);
    assert.equal(resumed.history, undefined, `and nothing went into history, got: ${JSON.stringify(resumed)}`);
  }

  // 3. Health names each session the kit's launch line did not start, with the
  // restart that puts it back on bot.yaml, in one finding.
  const answer = healthOf(bots);
  for (const bot of BOTS) {
    assert.equal(
      answer.sessions.find((one) => one.bot === bot.name && one.session === 'daily')?.running,
      'yes',
      `the premise: health sees ${bot.name}'s harness in front, got: ${JSON.stringify(answer.sessions, null, 2)}`,
    );
    const mine = findingsAbout(answer, bot.name, 'daily');
    assert.equal(mine.length, 1, `one finding about ${bot.name}'s daily, got: ${JSON.stringify(answer.found, null, 2)}`);
    const { kind, says } = mine[0];
    assert.equal(kind, 'session', `a finding about a session, got: ${JSON.stringify(mine[0])}`);
    assert.ok(
      spellingsOf(cliEntry).some((cli) => says.includes(`${cli} restart `)),
      `the command is this checkout's CLI running restart, got: ${says}`,
    );
    assert.ok(spellingsOf(bots).some((word) => says.includes(`--bots ${word}`)), `naming the bots folder, got: ${says}`);
    assert.ok(says.includes(`--bot ${bot.name}`), `naming the bot, got: ${says}`);
    assert.ok(hasWord(says, '--session daily'), `naming the session, got: ${says}`);
  }

  // 4. A clear in the tab is still the kit's: written to the book, the old id
  // kept, and the duty handed back. Asked for with an underscore, a form not on
  // the screen yet; answering it is the proof, because the conversation that
  // carried the start prompt is gone and no launch line carried it here.
  for (const bot of BOTS) {
    const home = homeOf(bot.name);
    const entry = tabs[bot.name];
    await clearIn(entry.terminal, bot);
    await answers(
      entry.terminal,
      'What is your codeword? Reply with the codeword with its dash made an underscore, and nothing else.',
      underscored(bot.codeword),
    );

    const second = await until(
      `${bot.name} to report a new session id after ${bot.clears}`,
      HOOK_MS,
      async () => {
        const session = (await sessionIn(home, 'daily')).session;
        return session !== undefined && session !== firsts[bot.name] ? session : undefined;
      },
      () => ` The book still names the conversation from before the clear: the kit's hook did not take a report from a harness with no launch line.${whatIsUp(entry.terminal)}`,
    );
    const daily = await sessionIn(home, 'daily');
    assert.equal(daily.session, second);
    assert.deepEqual(
      (daily.history ?? []).map((old) => [old.session, old.ended]),
      [[firsts[bot.name], bot.ended]],
      `the conversation before the clear is in history, ended by ${bot.ended}, got: ${JSON.stringify(daily.history)}`,
    );
  }

  // 5. A stranger: a tab of the user's own in the Claude bot's workspace,
  // running a bare `claude` in the bot's folder. Its harness sits exactly where
  // a tab's own does and fires the same hook, from a tab no book names.
  const claudeBot = BOTS.find((bot) => bot.harness === 'claude');
  const home = homeOf(claudeBot.name);
  const books = {};
  for (const bot of BOTS) books[bot.name] = await sessionsIn(homeOf(bot.name));
  const known = new Set(Object.values(books[claudeBot.name]).flatMap((one) => [one.session, ...(one.history ?? []).map((old) => old.session)]));

  const made = orca(['terminal', 'create', '--worktree', `path:${home}`, '--title', 'Stranger']);
  assert.equal(made.ok, true, `orca terminal create failed: ${JSON.stringify(made.error)}`);
  const stranger = made.result.terminal;
  const since = Date.now();
  typeInto(stranger.handle, 'claude');
  await answers(stranger.handle, 'Reply with the word pelican written in capital letters, and nothing else.', 'PELICAN');

  // The premise: the stranger's conversation exists, in the bot's folder.
  const theirs = await until(
    `the stranger's conversation on record for ${home}`,
    ANSWER_MS,
    async () => {
      const found = (await claudeConversationsSince(home, since)).filter((id) => !known.has(id));
      return found.length > 0 ? found : undefined;
    },
    () => whatIsUp(stranger.handle),
  );

  for (const bot of BOTS) {
    const now = await sessionsIn(homeOf(bot.name));
    assert.deepEqual(
      Object.entries(now).filter(([, one]) => one.tab === stranger.tabId).map(([name]) => name),
      [],
      `no session of ${bot.name} names the stranger's tab ${stranger.tabId}`,
    );
    for (const [name, was] of Object.entries(books[bot.name])) {
      assert.deepEqual(
        { session: now[name]?.session, history: now[name]?.history },
        { session: was.session, history: was.history },
        `${bot.name}'s ${name} is as it was: the stranger's conversation ${JSON.stringify(theirs)} is not its`,
      );
    }
  }
});
