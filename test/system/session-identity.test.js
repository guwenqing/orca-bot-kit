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
// And, on the same two sessions so that no extra harness is started, two more
// the PRD names (PRD 4.2 and 4.6, added for issue #157):
//
//   3. The session read its `AGENTS.md` where it started. A file on disk is not
//      a file read, and nothing else checks it.
//   4. A skill given to the bot while its session is running is one the session
//      can use, without a restart.
//
// All of them are proved by asking the session, because that is the only
// proof: a book holding the right id says nothing about whether the harness
// agreed. So each bot is given a word in its start prompt, a word in its
// conversation, a word in its charter and a word in a skill it is given late,
// and afterwards it is asked for them. A model answering from something it was
// never told is not a failure mode worth worrying about. A wait satisfied by
// something already on the screen is, and it is the one way a test like this
// goes green while proving nothing: a word the question carries is there as
// soon as the question is typed, and the codeword and the passphrase are there
// before anyone asks, because a harness shows its start prompt as the first
// thing said and a resumed one shows the conversation again. So every wait
// below is for a word its question does not carry and the screen does not yet
// show — `answers` refuses any other — and those two words are asked for in a
// form nobody ever wrote down (see `lowered`).
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
//     choose `2`, "Trust all and continue". `3` is "Continue without trusting
//     (hooks won't run)", `1` opens the review list — Orca's own hook sits there
//     beside the kit's — `esc` backs out of that list, and `t` does nothing at
//     all: nine presses, nine tabs still on the screen. Orca reports the screen as
//     `blockedReason: "agent-hooks-review-prompt"`.
//
//     Nothing runs behind it. While that screen is up there is no conversation and
//     no rollout, so a screen left alone is a session that never started rather
//     than one running untrusted (measured live, round 4; it is in the tech notes,
//     because it is a fact about Codex). This is the answer that will look like a
//     broken kit if it goes unanswered: no hook, so an empty book.
//
//     And answering it later does not put right a conversation that ran without
//     the hook: Codex never reports that one, whatever happens afterwards (the
//     reviewer proved this). That is why the kit writes down when it launched a
//     harness and asks Codex's own records what ran in the folder since. What it
//     finds there is written down as a conversation nobody claims; it is never
//     assigned to a session, because the folder holds every session of the bot and
//     every harness they started inside themselves (round 3, finding 1). The last
//     test in this file is that case, and it is the one that wants `3`.
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
//                                     3\r        "Continue without trusting"
//
// which is what to send if you drive them from a script of your own rather than
// clicking. On the hooks screen `1` opens the review list, which lists Orca's own
// hook beside the kit's, and `esc` backs out of it; `2` trusts and goes on, and
// `3` goes on without trusting, which is a live session whose hook never fires.
// Nothing here sends any of them: which question to answer, and how, is the
// caller's judgement and not the kit's (PRD 6.5), and a test that guessed at a
// screen it did not recognise is exactly what that rule exists to prevent.
//
// A question put to the agent itself is the other case, and it needs `--enter`:
// see `askIn`.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry } from '../helpers/cli.js';

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
 * And how long a session is given when what it has to do is run a harness of its
 * own: two agents' turns one after the other, and the inner one's own first
 * screen in between. Measured on this machine: fifty seconds when it goes well,
 * and a run that had already gone past four minutes still finished afterwards. So
 * this is not the ordinary answer's patience, and a case that used that wait
 * failed on a slow turn rather than on anything the kit did.
 */
const CHILD_MS = 480000;

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
 * The conversations Codex has on record for one folder, from `since` on.
 *
 * One rollout file per conversation, filed under the day it started, its first
 * line a `session_meta` carrying the id, the folder and the time (tech notes,
 * section 3). Read only, and read here for one reason: whether a conversation
 * happened at all is the premise of the last two cases in this file — a child
 * the kit must not take for the session, and a conversation run while the hooks
 * file is untrusted — and neither the book nor the screen can say.
 *
 * Files last written before `since` are never opened, so on a machine with years
 * of conversations this costs a walk of the folders and a read of today's few.
 */
async function codexConversationsSince(home, since) {
  const found = [];

  async function walk(dir, depth) {
    if (depth > 4) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // No records there at all, which is an answer.
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.name.endsWith('.jsonl') && await touchedSince(full, since)) {
        const id = await conversationIn(full, home);
        if (id !== undefined) found.push(id);
      }
    }
  }

  await walk(path.join(os.homedir(), '.codex', 'sessions'), 0);
  return found;
}

/**
 * The conversations Claude Code has on record for one folder, from `since` on:
 * one transcript per conversation, named by its id, in a folder named for the
 * working directory with every character that is not a letter or a digit made
 * a dash (tech notes, section 2). Read only, for the same reason as Codex's.
 */
async function claudeConversationsSince(home, since) {
  const dir = path.join(os.homedir(), '.claude', 'projects', home.replaceAll(/[^A-Za-z0-9]/g, '-'));
  let names;
  try {
    names = await readdir(dir);
  } catch {
    // No records there at all, which is an answer.
    return [];
  }
  const found = [];
  for (const name of names) {
    if (name.endsWith('.jsonl') && await touchedSince(path.join(dir, name), since)) {
      found.push(name.slice(0, -'.jsonl'.length));
    }
  }
  return found;
}

/** Whether a file has been written since then, as the file system has it. */
async function touchedSince(file, since) {
  try {
    return (await stat(file)).mtimeMs >= since;
  } catch {
    return false;
  }
}

/** The conversation a rollout says it is, when it is one of this folder's. */
async function conversationIn(file, home) {
  let said;
  try {
    said = JSON.parse((await readFile(file, 'utf8')).split('\n', 1)[0]);
  } catch {
    return undefined;
  }
  const meta = said?.type === 'session_meta' ? said.payload : undefined;
  return meta?.cwd === home && typeof meta.id === 'string' ? meta.id : undefined;
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

/**
 * Ask the session something and wait for `word` to appear on its screen.
 * `within` is for the questions that are more than one answer's work.
 *
 * Only a word that is neither in the question nor on the screen already can be
 * waited for. The echo of the typed line would satisfy the first, and whatever
 * was already there the second, with no agent reading anything (review of #150,
 * the echo shape; issue #163).
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

/**
 * What Codex 0.156.1 asks as soon as `/new` is typed, before the new
 * conversation starts, and its first answer — the current checkout, which is
 * the bot home the kit launched it in:
 *
 *       Where should the new conversation run?
 *     › 1. Current checkout  Keep using the current working directory
 *       2. New worktree      Create an isolated managed checkout
 *
 * Seen live on a screen recording of the tab. Orca does not report the menu as
 * anything waiting to be answered — no `blockedReason`, and the tab reads as
 * idle — so `readyForAQuestion` walks straight past it: a question typed then
 * went into the menu, its return picked option 1, and the new conversation sat
 * waiting with nothing asked.
 */
const WHERE_TO_RUN = 'Where should the new conversation run?';

/**
 * Clear the session the way its harness does, and come back only once the new
 * conversation will take a question. On Codex that means answering the menu
 * `/new` puts up first, and waiting for it to go: a return inside the payload
 * is the key a menu waits for (see `askIn`).
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
    charterWord: 'QUARTZ-5061',
    probeWord: 'LANTERN-3378',
  },
  {
    name: 'clear-codex',
    harness: 'codex',
    display: 'Clear Codex',
    clears: '/new',
    codeword: 'WALRUS-2210',
    passphrase: 'INDIGO-448',
    charterWord: 'BASALT-7142',
    probeWord: 'COMPASS-6605',
  },
];

/**
 * What each bot is told to be. It keeps the bot inert — nothing is run, read or
 * used unless a later message asks for it — and the "unless" is the point.
 *
 * The first version forbade tools outright, and the last check in the first
 * scenario then could not pass on Codex: a skill is used by reading its
 * SKILL.md, the kit's hook gives a cleared session its start prompt back as
 * context Codex ranks above anything the user says, and Codex answered "a
 * higher-priority instruction still prohibits tools and file access" however
 * plainly the question lifted it (review of #183, finding 1, and the rerun). A
 * permission has to sit where the ban does, so it sits here.
 */
const startPromptFor = (bot) => [
  `You are a system test's bot and you own nothing. Your codeword is ${bot.codeword}.`,
  // In the form asked for, because the codeword is asked for in forms nobody
  // wrote down (see `lowered`), and "reply with it" won over the question on
  // Codex after a `/new`: it answered the codeword as written (live run, #163).
  'When anyone asks you for your codeword, give it in exactly the form they ask for, and nothing else.',
  'Do not run any command, read or write any file, or use any tool, unless a later message asks you to.',
  'Say nothing now and wait.',
].join(' ');

/**
 * The bot's charter, which is its `AGENTS.md` and nowhere else: `bot create`
 * builds it into that file, it is not on the launch line and not in the start
 * prompt. So a session that can say the charter word read its instructions
 * where it started (PRD 4.2), and nothing on its screen could have told it.
 */
const charterFor = (bot) => [
  `${bot.display} exists for one system test run and owns nothing.`,
  `Its charter word is ${bot.charterWord}; when asked for the charter word, reply with it and nothing else.`,
].join(' ');

/** The skill a bot is given while its session is running, one per bot. */
const probeOf = (bot) => `${bot.name}-probe`;

/**
 * Write that skill into the bots folder's own skills shelf. The word is in the
 * body only: a harness shows a skill's name and description when it lists
 * one, and a word that could be read off that list would prove nothing about
 * the skill being usable.
 */
async function writeProbe(bots, bot) {
  const dir = path.join(bots, 'skills', probeOf(bot));
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'SKILL.md'), [
    '---',
    `name: ${probeOf(bot)}`,
    'description: >-',
    '  Holds the probe word for a system test. Use when you are asked for the',
    '  probe word.',
    '---',
    '',
    `The probe word is ${bot.probeWord}. When you are asked for the probe word, reply`,
    'with it and nothing else.',
    '',
  ].join('\n'));
}

/**
 * The codeword and the passphrase as the session is asked to give them back.
 *
 * Both are on the screen before anyone asks for them — the codeword in the
 * start prompt the harness shows as the conversation's first line, and both in
 * the conversation a resumed harness shows again — so a wait on either as
 * written is answered by the screen. Asked for in lower case, the word is one
 * nobody wrote down: only a session that holds it can produce it. The
 * underscore is the second form, for a session asked twice, whose first answer
 * may still be on the screen.
 */
const lowered = (word) => word.toLowerCase();
const underscored = (word) => word.replace('-', '_');

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
      '--charter', charterFor(bot),
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

    // It knows its duty, because the launch line carried it. The codeword as
    // written is on the screen already, in the start prompt the harness shows;
    // in lower case it is in no prompt and no question.
    await answers(
      entry.terminal,
      'What is your codeword? Reply with the codeword in lower case and nothing else.',
      lowered(bot.codeword),
    );

    // And it read its AGENTS.md where it started (PRD 4.2). The charter word is
    // in that file and nowhere a screen could have shown it, which is what the
    // check above cannot say: a file on disk is not a file read.
    await answers(
      entry.terminal,
      'What is the charter word in your own instructions? Reply with the charter word only.',
      bot.charterWord,
    );

    // 1. The clear, and then the question. On Codex the hook only fires when the
    // new conversation gets its first prompt, so asking is also what makes the
    // hook run; on Claude Code the hook has already run by then. Either way,
    // answering with the codeword is the proof that the duty came back: the
    // conversation that carried it is gone. Asked for with an underscore, not in
    // lower case: a clear need not wipe the screen, and the answer above may
    // still be on it.
    await clearIn(entry.terminal, bot);
    await answers(
      entry.terminal,
      'What is your codeword? Reply with the codeword with its dash made an underscore, and nothing else.',
      underscored(bot.codeword),
    );

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

    // 3. A skill given to the bot while this conversation is running is one it
    // can use in it, without a restart (PRD 4.6). The conversation began at the
    // clear above, before the skill existed, so an answer from it is a live
    // pick-up and not a skill read at start. It is last on purpose: Codex's own
    // documentation only promises that it "detects skill changes automatically"
    // and says to restart when one does not appear, which nobody has checked
    // live, and if it does need a restart that is a finding about Codex that
    // must not hide the checks above.
    await writeProbe(bots, bot);
    obkJson(['skills', 'add', '--bots', bots, '--bot', bot.name, '--skill', probeOf(bot)]);
    obkJson(['skills', 'build', '--bots', bots, '--bot', bot.name]);
    // Asked for in so many words, because the start prompt keeps the bot from
    // using a tool unless a message asks it to (see `startPromptFor`): Claude
    // Code loads a skill with a tool, Codex by reading its SKILL.md.
    await answers(
      entry.terminal,
      `Please load your ${probeOf(bot)} skill and read its SKILL.md, then reply with the probe word it gives, and nothing else.`,
      bot.probeWord,
    );
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
    //
    // What is waited for is the codeword in lower case, not the passphrase: the
    // passphrase is in the line just typed, so its echo would answer a wait on
    // it with no agent there at all. The lowered codeword is in no question and
    // no prompt, so only a running session that has read this line produces it
    // — which is the same as saying the passphrase reached the conversation.
    await answers(
      opened.terminal,
      `Remember this passphrase: ${bot.passphrase}. Then reply with your codeword in lower case and nothing else.`,
      lowered(bot.codeword),
    );

    // The user closes the tab. Orca's own resume record goes with it, which is
    // the whole reason the kit keeps a book (ADR 0002).
    orca(['terminal', 'close', '--terminal', opened.terminal, '--tab']);
    assert.deepEqual(
      await terminalsAfterClosing(home, [opened.terminal]),
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

    // The proof: the passphrase was only ever said in the conversation. Asked
    // for in lower case, because a resumed harness shows the conversation again
    // and the passphrase as it was typed is on this new screen already.
    await answers(
      back.terminal,
      'What was the passphrase I gave you? Reply with it in lower case and nothing else.',
      lowered(bot.passphrase),
    );
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
    // In the kit's default `auto` level Codex's sandbox refuses a child harness
    // outright: `codex exec` exits 1 at once with "failed to initialize in-process
    // app-server client: Operation not permitted" (measured live, #163). So on
    // `auto` there is no child and nothing for this case to prove. A throwaway
    // bot that owns nothing can run outside the sandbox (ADR 0005).
    approval: 'dangerously-skip',
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
      + ' When anyone asks for your codeword, give it in exactly the form they ask for, and nothing else.'
      + ' Say nothing now and wait.',
      ...(bot.approval === undefined ? [] : ['--approval', bot.approval]),
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
    // Two agents' work, so it is given the patience for two. What says it is
    // done is its codeword in lower case, which is in no prompt and no question:
    // a word the line carries would be answered by the echo of the line.
    const since = Date.now();
    await answers(
      entry.terminal,
      `Run exactly this command, then reply with your codeword in lower case and nothing else: ${bot.child}`,
      lowered(bot.codeword),
      CHILD_MS,
    );

    // The premise of everything below: a child really ran, in this folder. The
    // answer above says the session finished its turn, not that it ran the
    // command, and the book checks after this all pass on a child that never
    // ran. The harness's own record can say — a conversation in this folder,
    // begun since the question, that is not the session's own.
    const children = await until(
      `a ${bot.harness} conversation other than the session's own on record for ${home}`,
      ANSWER_MS,
      async () => {
        const found = bot.harness === 'claude'
          ? await claudeConversationsSince(home, since)
          : await codexConversationsSince(home, since);
        const others = found.filter((id) => id !== own);
        return others.length > 0 ? others : undefined;
      },
      () => ` The session answered without its child on record. Run \`${bot.child}\` yourself in a`
        + ` shell of your own in ${home}, with ORCA_TAB_ID set to ${entry.tabId}.${whatIsUp(entry.terminal)}`,
    );

    const daily = await sessionIn(home, 'daily');
    assert.equal(
      daily.session,
      own,
      `the session's own conversation is still its own, not its child's ${JSON.stringify(children)}: ${JSON.stringify(daily)}`,
    );
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
    // would have taken with it. With an underscore, because the answer above is
    // still on the screen.
    await answers(
      entry.terminal,
      'What is your codeword? Reply with the codeword with its dash made an underscore, and nothing else.',
      underscored(bot.codeword),
    );
  }
});

test('a Codex conversation that ran before the hooks file was trusted is written down, not lost', async (t) => {
  // The one case in this file that needs a screen answered a particular way, and the
  // only one that wants the kit's hook not to run.
  //
  // Attended, and shorter than it used to be:
  //   1. Answer Codex's directory-trust question if it asks.
  //   2. Answer `Hooks need review` with `3`, "Continue without trusting (hooks
  //      won't run)". That is what this case needs, and leaving the screen alone is
  //      not: nothing runs behind it. While it is up Codex has started no
  //      conversation and written no rollout, so a screen left alone is a session
  //      that never began, and the premise wait below runs out saying so (measured
  //      live, round 4). `3` gives the case exactly what it is about — a live
  //      conversation, with its duty, that the kit's hook never reports.
  //   3. Answer nothing else. Nothing is asked of the session at all here.
  //
  // It used to answer that screen half way through and then wait for the hook to
  // report the conversation after it, and that road does not work: nothing can be
  // asked of a tab while it is waiting on a screen (Orca refuses it), and the wait
  // for the hook after the screen was answered ran out in every attended run.
  //
  // It is also the wrong road for what this proves. What the kit claims is about
  // its record, not about the hook: a conversation it never learned of is written
  // down as one nobody claims, and never assigned to a session. `obk up` reads
  // Codex's own records itself, so closing the tab and running it asks nothing of
  // anybody — and the hook reporting after a clear is already proved live, on both
  // harnesses, by the first case in this file.
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

  // The premise of the case, and the only thing that can tell us it holds: Codex's
  // own record of a conversation in this folder. The screen cannot — it is up
  // within a second or two of launch, before the conversation behind it has
  // necessarily run — and nothing can be asked of the session while it is up,
  // because Orca refuses a prompt to a tab that is waiting on one.
  const ran = await until(
    'Codex to have a conversation on record for this folder',
    ANSWER_MS,
    async () => {
      const found = await codexConversationsSince(home, Date.parse(String(launched)));
      return found.length > 0 ? found : undefined;
    },
    () => ' Answer Codex\'s directory-trust question if it is up, and answer `Hooks need review`'
      + ' with `3` — "Continue without trusting (hooks won\'t run)". Nothing runs behind that'
      + ' screen: while it is up there is no conversation and no rollout, so leaving it alone'
      + ' gives this case nothing to find. If this machine has already trusted the kit\'s hooks'
      + ' file, the screen never comes, the hook runs, and this case cannot run here at all.'
      + whatIsUp(entry.terminal),
  );

  // And the kit was told nothing about it, because the hook never ran.
  const unreported = await sessionIn(home, 'daily');
  assert.equal(
    unreported.session,
    undefined,
    'the hook must not have run: answer `Hooks need review` with `3`, not `2`, for this case.'
    + ` If it has run, the file was trusted — by \`2\` here, or by this machine some other way.`
    + ` Got: ${JSON.stringify(unreported)}`,
  );

  // Now the tab goes, which is the user closing it, and the kit is asked to bring
  // the session back. This is the road that needs nothing more answered and no
  // question asked of the agent: `obk up` reads Codex's records itself.
  //
  // Nothing is adopted — the folder holds every session of this bot and every
  // harness they start inside themselves, so no record can say whose that
  // conversation was (round 3, finding 1) — and what nobody claims is written
  // down for a person or Bot Father to settle, which is what this checks.
  orca(['terminal', 'close', '--terminal', entry.terminal, '--tab']);
  assert.deepEqual(
    await terminalsAfterClosing(home, [entry.terminal]),
    [],
    'the fixture itself should have closed the session tab',
  );

  const back = tabOf(obkJson(['up', '--bots', bots, '--bot', 'untrusted-codex']), 'daily');
  assert.equal(back.created, true, 'a new tab was opened for it');
  assert.equal(back.resumed, false, 'and nothing was resumed: the kit cannot say which conversation that was');

  const daily = await sessionIn(home, 'daily');
  assert.equal(
    daily.session,
    undefined,
    `no conversation may be adopted into the book: ${JSON.stringify(daily)}`,
  );
  assert.equal(
    daily.history,
    undefined,
    `and none invented as this session's history: ${JSON.stringify(daily)}`,
  );
  assert.ok(
    Array.isArray(daily.unclaimed) && daily.unclaimed.length >= 1,
    'the conversation that ran before the hooks file was trusted must be written down, and it is not:'
    + ` ${JSON.stringify(daily)}. Codex's own records held ${JSON.stringify(ran)}.`,
  );
  for (const id of daily.unclaimed) {
    assert.equal(typeof id, 'string', `as plain ids, got: ${JSON.stringify(daily.unclaimed)}`);
  }
  // At least one of them, rather than all: this test reads the rollout files by
  // their own time on disk and the kit reads what each one says about itself, so
  // the two can disagree at the edge of the window. One id in common is the claim
  // being made — that the conversation nobody recorded is the one on the record.
  assert.ok(
    daily.unclaimed.some((id) => ran.includes(id)),
    `and it must be the conversation Codex has on record: ${JSON.stringify(daily.unclaimed)} against ${JSON.stringify(ran)}`,
  );
});
