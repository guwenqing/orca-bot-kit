// `obk session clear` and `obk session compact`: the kit, not the harness, is
// asked to clear or compact a session, and does it safely (#391).
//
//   obk session clear   --bots <path> --bot <bot> --session <name> [--json]
//   obk session compact --bots <path> --bot <bot> --session <name> [--json]
//
// The requirement, with the architect's rulings, as these tests hold it:
//
//   - All three flags are needed, and a missing one is refused the way every
//     command refuses one. Both commands are in `obk --help`.
//   - Refused before anything is typed (non-zero exit, a reason, nothing sent
//     into any tab): an unknown bot or session, a paused bot or session, a
//     session with no tab open, and a tab with only its shell in front (the
//     harness quit; the reason says a restart brings it back).
//   - Then it waits, up to 30 s, for the session to be idle with nothing on its
//     screen to answer. Busy is Orca's `tui-idle` not answering ok, or any
//     screen row saying "esc to interrupt" in any case, since Orca can call a
//     busy Codex idle. A question or form on screen (as the kit's own look
//     sees one), or a reason Orca gives for a blocked tab, is waited out too.
//     Still not idle at 30 s: refused, nothing typed, and it says why. One that
//     goes idle within the 30 s goes on.
//   - It types the harness's own command as text, with no return: `/clear` on
//     Claude Code, `/new` on Codex, `/compact` on both. It types it one
//     character a send, never the whole command in one, with a gap between
//     sends past Codex's paste-burst window (Codex 0.160.0: 8 ms between
//     characters, a 60 ms idle flush; the kit uses 100 ms or more), and each
//     character goes through the typing gate first: a look with Orca's
//     `terminal wait --for tui-idle`. The slash menu is not a question to the
//     gate. If the gate refuses partway (busy, a question, cannot tell), it
//     stops and takes back exactly the characters typed so far, that many
//     backspaces (\x7f) in one send, and refuses (the architect's ruling on
//     #391, 2026-10-03).
//   - Then it reads the screen, by the architect's ruling after live run 4.
//     Claude Code: the input line (the lowest row its pointer `❯` starts),
//     read with a non-breaking space after the pointer as a space, reads
//     exactly `❯ /clear`; above the input box's top rule, the first row whose
//     first text starts with `/` names exactly that command as its first word
//     (a wrapped description row is no command row). Codex: before the first
//     character its input line was empty or its placeholder, with no draft;
//     after typing, the popup's selected row (the nearest `›` row above the
//     input line) names exactly the command and is the popup's only command
//     row, and the input line reads exactly `› /new`, or `›` alone on Codex
//     0.160.0, whose screen read shows no composer text while the popup is
//     open (the version as the session's current rollout gives it).
//     Otherwise it takes the text back with one backspace per character, as
//     one send, and refuses, saying what the screen showed, its last rows
//     among it. A compact the menu does not offer is "this harness cannot
//     compact".
//   - The return is a send of its own: `\r`, without --enter.
//   - Codex's clear: when "Where should the new conversation run?" comes up
//     with the pointer on "1. Current checkout", one more `\r`; with the
//     pointer anywhere else, Esc (\x1b) and a refusal, never `2`. Then, because
//     Codex reports a new conversation only at its first turn (tech notes,
//     section 3), RECORD_LINE below, word for word (approved by the architect
//     on #391), with a return, through the
//     gate the mail notice goes through. Nothing like it on Claude Code.
//   - A clear is confirmed by the book: within 30 s it holds a conversation id
//     for the session other than the one it held before anything was typed.
//     `--json` answers `{ bots, cleared: { bot, session, harness, was, now } }`.
//     None in 30 s: non-zero, saying the command was entered, the book has no
//     new conversation, and to look at the tab.
//   - A compact is confirmed by the harness's own record of the session's
//     current conversation: within 300 s it gains a compaction made after the
//     command began (Claude Code's `compact_boundary` line, Codex's top-level
//     `compacted` record). `--json` answers `{ bots, compacted: { bot,
//     session, harness, conversation, confirmed: true } }`. None in the 300 s
//     is not a failure: exit 0, `confirmed: false`, and the plain answer says
//     the compaction is "not confirmed yet" (the architect's ruling on #391,
//     comment 5963852753). That case is not tested here, since it costs the
//     whole 300 s; the live system test reports it when it happens.
//   - Nothing goes into any tab but the session's own.
//   - A cleared session is not promised to be idle afterwards (a Codex one may
//     run its start routine), so nothing here asks that of it: a clear is the
//     book's new id.
//
// How the harness is played here. The fake Orca types nothing anywhere and
// runs no hook. Each send into the session's tab can move its screen on
// (`nextScreens`, helpers/fake-orca.js), so the screens a harness would show
// as the command is typed, entered and answered are given in order, from
// helpers/screens.js; the typed-command screens there are reconstructions.
// The harness's part after the return (the hook reporting a new
// conversation, or a compaction written to its record) is played by the test
// while the command waits: it watches the tab's sends and acts once the step
// that would cause it has been sent.
//
// How the wait is modelled. The fake Orca keeps no clock: its `terminal wait`
// answers at once. So a tab that goes idle in time is a `waitIdle` list
// (busy on the first looks, idle after), and one that never does costs the
// full 30 s of real time. Those tests are few, and run
// side by side at the end of this file.
//
// Every expected value comes from the requirement: the commands typed, the
// keys, the line's words and the JSON's shape.

import assert from 'node:assert/strict';
import { appendFile, readdir, stat, truncate } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import test, { describe, it } from 'node:test';

import {
  botHomeOf,
  conversationOnRecord,
  createSandbox,
  orcaCallsOf,
  orcaCommand,
  orcaFlag,
  recordSession,
  sessionIn,
  tabsOfBot,
} from './helpers/cli.js';
import {
  CLAUDE_296_CLEAR_OTHER_DRAFT,
  CLAUDE_296_CLEAR_READ,
  CLAUDE_296_CLEAR_SHOWN,
  CLAUDE_296_COMPACT_ECHOED,
  CLAUDE_296_COMPACT_MENU_BELOW,
  CLAUDE_296_COMPACT_OTHER_DRAFT,
  CLAUDE_296_COMPACT_READ,
  CLAUDE_296_COMPACT_SHOWN,
  CLAUDE_296_IDLE,
  CLAUDE_296_ON_AUTOCOMPACT,
  CLAUDE_296_ON_CLEAR_HISTORY,
  CLAUDE_296_ON_COMPACT_X,
  CLAUDE_296_TURN_CLEAR_READ,
  CLAUDE_296_TURN_CLEAR_TYPED,
  CLAUDE_296_TURN_COMPACT,
  CLAUDE_296_TURN_DRAFT,
  CLAUDE_296_TURN_DRAFT_COMPACT,
  CLAUDE_296_TURN_IDLE,
  CLAUDE_CLEAR_AFTER_DRAFT,
  CLAUDE_CLEAR_BARE,
  CLAUDE_CLEAR_MENU_BELOW,
  CLAUDE_CLEAR_NO_MENU,
  CLAUDE_CLEAR_OTHER_FIRST,
  CLAUDE_CLEAR_TYPED,
  CLAUDE_COMPACT_BARE,
  CLAUDE_COMPACT_OTHER_FIRST,
  CLAUDE_COMPACT_TYPED,
  CLAUDE_AT_WORK,
  CLAUDE_FEEDBACK_PANEL,
  CLAUDE_FEEDBACK_PANEL_GONE,
  CLAUDE_FEEDBACK_PANEL_TYPED,
  CLAUDE_IDLE,
  CLAUDE_TEACH_AUTO,
  CLAUDE_TEACH_LIST,
  CLAUDE_TEACH_LIST_GONE,
  CLAUDE_WORKING,
  CODEX_162_COMPACT_OTHER_DRAFT,
  CODEX_162_COMPACT_READ,
  CODEX_162_DRAFT,
  CODEX_162_DRAFT_COMPACT,
  CODEX_162_IDLE,
  CODEX_162_NEW_MENU,
  CODEX_162_NEW_MENU_NO_WORDS,
  CODEX_162_NEW_MENU_ON_TWO,
  CODEX_162_NEW_MENU_PADDED_3,
  CODEX_162_NEW_MENU_PADDED_8,
  CODEX_162_NEW_MENU_OTHER_WORDS,
  CODEX_162_NEW_NO_MENU,
  CODEX_162_NEW_OTHER_DRAFT,
  CODEX_162_NEW_OTHER_SELECTED,
  CODEX_162_NEW_READ,
  CODEX_162_NEW_SHOWN,
  CODEX_162_NEW_SPACE_DRAFT,
  CODEX_162_NEW_TWO_ROWS,
  CODEX_162_PLACEHOLDER_DRAFT,
  CODEX_COMPACT_NOT_OFFERED,
  CODEX_COMPACT_TYPED,
  CODEX_DRAFT,
  CODEX_IDLE,
  CODEX_IDLE_EMPTY,
  CODEX_NEW_MENU,
  CODEX_NEW_BARE_INPUT,
  CODEX_NEW_MENU_ON_TWO,
  CODEX_NEW_OTHER_SELECTED,
  CODEX_NEW_TWO_ROWS,
  CODEX_NEW_TWO_ROWS_SHOWN,
  CODEX_NEW_NO_MENU,
  CODEX_NEW_TYPED,
  CODEX_NEW_TYPED_SHOWN,
  CODEX_UPDATE_OFFER,
  CODEX_WORKING,
  atWork,
  whileTyping,
  whileTypingCodex162,
} from './helpers/screens.js';

/** The line the kit types into Codex after its `/new`, word for word, as the architect approved it on #391. */
const RECORD_LINE = 'obk: this conversation was started by obk session clear, and this line is only so the kit can record it. Reply "ok"; nothing else is asked.';

const BOT = 'api-bot';
const PROMPT = 'Read your AGENTS.md and keep the queue moving.';
const VERBS = ['clear', 'compact'];

/** The command each harness clears with, and the one it compacts with. */
const CLEAR = { claude: '/clear', codex: '/new' };
const COMPACT = '/compact';

/**
 * The command as the kit types it: one character a send, none with a return
 * (the architect's ruling on #391, 2026-10-03), so Codex never takes it for a
 * paste.
 */
const typed = (command) => [...command].map((text) => ({ text, enter: false }));

/**
 * The screens a tab shows, one per send, as `command` is typed into it on
 * `harness` a character at a time (helpers/screens.js `whileTyping`), then
 * `after`: the screen once the last character is in, and whatever follows.
 */
const screensFor = (harness, command, ...after) => [...whileTyping(harness, command), ...after];

/** One backspace per character of `command`, as the one send that takes it back. */
const backspaces = (command) => '\x7f'.repeat(command.length);

// ---------------------------------------------------------------- the fleet

/** A bots folder with Bot Father and api-bot on `harness`, with the sessions named, none of them up yet. */
async function madeBot(box, { harness = 'claude', sessions = ['daily', 'review'] } = {}) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', harness]);
  assert.equal(made.code, 0, made.stderr);
  for (const name of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', name, '--prompt', PROMPT]);
    assert.equal(added.code, 0, added.stderr);
  }
  return box.path('bots');
}

/** The tab the book gives a session, as Orca has it now. */
async function liveTab(box, bots, name = 'daily') {
  const entry = await sessionIn(bots, BOT, name);
  assert.equal(typeof entry?.tab, 'string', `the book should hold a tab for ${name}, got: ${JSON.stringify(entry)}`);
  const terminal = (await tabsOfBot(box, bots, BOT)).find((one) => one.tabId === entry.tab);
  assert.ok(terminal, `Orca should have ${name}'s tab ${entry.tab}`);
  return terminal;
}

/**
 * api-bot up on `harness`, each session with a conversation the book holds and
 * the harness has on record, as a session that has had a turn has them: its
 * id `sess-<name>`. With `reported: false` the hook has not reported one yet,
 * and the book holds none. A Codex rollout's first line names the Codex that
 * wrote it, `cliVersion`, 0.160.0 unless a test says otherwise; `null` leaves
 * it out, a version that cannot be read (#391).
 */
async function running(box, { harness = 'claude', sessions = ['daily', 'review'], reported = true, cliVersion = '0.160.0' } = {}) {
  const bots = await madeBot(box, { harness, sessions });
  const up = await box.run(['up', '--bots', 'bots', '--bot', BOT]);
  assert.equal(up.code, 0, `the up this test stands on: ${up.stdout}${up.stderr}`);
  if (reported) {
    for (const name of sessions) {
      const tab = await liveTab(box, bots, name);
      const heard = await recordSession(box, { bots, bot: BOT, tab: tab.tabId, session: `sess-${name}` });
      assert.equal(heard.code, 0, `the hook report this test stands on: ${heard.stderr}`);
      await conversationOnRecord(box, { harness, cwd: botHomeOf(bots, BOT), id: `sess-${name}`, ...(harness === 'codex' && cliVersion !== null ? { cliVersion } : {}) });
    }
    assert.equal((await sessionIn(bots, BOT, 'daily')).session, 'sess-daily', 'the premise: the book holds daily\'s conversation');
  }
  return bots;
}

/**
 * The file the harness keeps for conversation `id`, the one `running` left
 * on its record: one conversation has one record, and a test that writes
 * into it writes there rather than making a second (a Codex rollout's name
 * carries the second it was made in, so a second write is a second file).
 */
async function recordFileOf(box, id) {
  const roots = [path.join(box.home, '.codex', 'sessions'), path.join(box.home, '.claude', 'projects')];
  const found = [];
  for (const root of roots) {
    let names = [];
    try {
      names = await readdir(root, { recursive: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    for (const name of names) {
      if (path.basename(name) === `${id}.jsonl` || path.basename(name).endsWith(`-${id}.jsonl`)) found.push(path.join(root, name));
    }
  }
  assert.equal(found.length, 1, `the premise: one record for ${id}, got: ${JSON.stringify(found)}`);
  return found[0];
}

/** Change one of Orca's terminals, found by its tab id, as `change` says. */
async function changeTab(box, tabId, change) {
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((terminal) => (terminal.tabId === tabId ? { ...terminal, ...change } : terminal)),
  });
}

/** What every tab Orca has had typed into it, by handle. */
async function typedEverywhere(box) {
  return Object.fromEntries((await box.orca.terminals()).map((terminal) => [terminal.handle, terminal.typed ?? []]));
}

/** The sends into a tab after its launch line, each as `{ text, enter }`. */
const sendsAfterLaunch = (terminal) => (terminal.typed ?? []).slice(1).map(({ text, enter }) => ({ text, enter }));

/** The sends into the session's tab after its launch line, as Orca has them now. */
const sendsInto = async (box, bots, name = 'daily') => sendsAfterLaunch(await liveTab(box, bots, name));

/** `obk session <verb>` for api-bot's `session`, with any more flags. */
const sessionCommand = (box, verb, { session = 'daily', bot = BOT, flags = [] } = {}) =>
  box.run(['session', verb, '--bots', 'bots', '--bot', bot, '--session', session, ...flags]);

/**
 * Run `obk session <verb>` with `--json`, and play the harness while it runs:
 * once `when` holds for the sends into the session's tab, run `then`, once.
 * Answers the run's result and whether `then` ran.
 */
async function runPlaying(box, bots, verb, { when, then, session = 'daily' }) {
  const { tabId } = await liveTab(box, bots, session);
  let finished = false;
  const run = sessionCommand(box, verb, { session, flags: ['--json'] });
  run.then(() => { finished = true; }, () => { finished = true; });

  let played = false;
  const until = Date.now() + 25_000;
  while (!finished && Date.now() < until) {
    const terminal = (await box.orca.terminals()).find((one) => one.tabId === tabId);
    if (terminal !== undefined && when(sendsAfterLaunch(terminal))) {
      await then();
      played = true;
      break;
    }
    await sleep(50);
  }
  return { result: await run, played };
}

/** The hook reporting a new conversation `id` from the session's tab, as the harness would run it. */
async function hookReports(box, bots, id, source, session = 'daily') {
  const tab = await liveTab(box, bots, session);
  const heard = await recordSession(box, { bots, bot: BOT, tab: tab.tabId, session: id, source });
  assert.equal(heard.code, 0, `the hook's own run: ${heard.stderr}`);
}

/** A compaction written into the session's conversation record now, the way `harness` writes one. */
async function compactionIn(file, harness) {
  const at = new Date().toISOString();
  const line = harness === 'codex'
    ? { timestamp: at, type: 'compacted', payload: { message: 'A summary of the conversation so far.' } }
    : { type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', sessionId: 'sess-daily', timestamp: at, compactMetadata: { trigger: 'manual', preTokens: 81522 } };
  await appendFile(file, `${JSON.stringify(line)}\n`);
}

/** The JSON a run answered with, which must have gone through. */
function answered(result, what) {
  assert.equal(result.code, 0, `${what} should go through: ${result.stdout}${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch {
    assert.fail(`${what} should answer JSON on stdout, got:\n${result.stdout}`);
  }
}

/** Refused: a non-zero exit, no crash, and a reason, with every word in `named`. Answers what it said. */
function assertRefused(result, ...named) {
  assert.notEqual(result.code, 0, `this should have been refused, got:\n${result.stdout}${result.stderr}`);
  const said = result.stdout + result.stderr;
  assert.notEqual(said.trim(), '', 'a refusal with nothing said is no use to anybody');
  assert.ok(!/^\s+at /m.test(said), `expected a reason, got a crash:\n${said}`);
  for (const word of named) assert.ok(said.includes(word), `the refusal should name ${word}, got:\n${said}`);
  return said;
}

/** Nothing was sent into any tab: every tab's typed list is what it was. */
async function assertNothingTyped(box, before, what) {
  assert.deepEqual(await typedEverywhere(box), before, `${what}: nothing is typed into any tab`);
}

/** Every `terminal send` since `from` calls went into `handle` and no other tab. */
async function assertSentOnlyInto(box, handle, from, what) {
  const sends = orcaCallsOf((await box.orca.calls()).slice(from), 'terminal send');
  assert.ok(sends.length > 0, `${what}: the premise, something was sent`);
  assert.deepEqual([...new Set(sends.map((call) => orcaFlag(call, '--terminal')))], [handle], `${what}: every send went into the session's own tab`);
}

/**
 * What a refusal says with every row of `screen` it quotes taken out, so the
 * words left are the kit's own: the capture's status row says "4 feedback
 * drafts", and its foot "1 to review · 2 to send · 0 to dismiss".
 */
const ownWords = (said, screen) => screen
  .filter((row) => row.trim() !== '')
  .reduce((rest, row) => rest.replaceAll(row.trimEnd(), '').replaceAll(row.trim(), ''), said);

/** The refusal names the panel and what clears it, in the kit's own words, and does not say the harness cannot compact. */
function assertNamesThePanel(said, screen, what) {
  const own = ownWords(said, screen);
  assert.match(own, /feedback drafts/i, `${what}: the refusal names the panel of feedback drafts, got:\n${said}`);
  for (const word of [/\breview/i, /\bsend/i, /\bdismiss/i]) {
    assert.match(own, word, `${what}: and says the user reviews, sends or dismisses the drafts, got:\n${said}`);
  }
  assert.doesNotMatch(said, /can(?:not|'t|’t) compact/i, `${what}: and does not say the harness cannot compact, got:\n${said}`);
}

/** How many times `word` is in `said`: a row the refusal quotes from the screen counts once. */
const timesIn = (said, word) => said.split(word).length - 1;

/**
 * Four tests side by side (#778). A test here spends most of its time in
 * `obk up` and in the CLI runs that build its fleet: `up` waits up to 5 s for
 * the start prompt in the record of each session it launched, no harness here
 * writes that record, and the test only sleeps through the wait. Every test
 * has a sandbox of its own, so no test sees another. The groups that wait out
 * the kit's own time limits run alone, after these, as they did.
 */
const SIDE_BY_SIDE = { concurrency: 4 };

// ---------------------------------------------------------------- the interface

describe('the interface, the refusals, the typing and the screen read, four side by side', SIDE_BY_SIDE, () => {
  test('obk --help lists session clear and session compact, each with its three flags', async (t) => {
    const box = await createSandbox(t);

    const result = await box.run(['--help']);

    assert.equal(result.code, 0);
    for (const verb of VERBS) {
      const at = result.stdout.indexOf(`obk session ${verb} `);
      assert.notEqual(at, -1, `the usage should list obk session ${verb}, got:\n${result.stdout}`);
      const usage = result.stdout.slice(at, at + 200);
      for (const flag of ['--bots', '--bot', '--session']) {
        assert.ok(usage.includes(flag), `obk session ${verb}'s usage should give ${flag}, got:\n${usage}`);
      }
    }
  });

  for (const verb of VERBS) {
    for (const missing of ['bots', 'bot', 'session']) {
      test(`session ${verb} without --${missing} is refused the way every command refuses a missing flag, and types nothing`, async (t) => {
        const box = await createSandbox(t);
        await running(box);
        const before = await typedEverywhere(box);
        const flags = { bots: ['--bots', 'bots'], bot: ['--bot', BOT], session: ['--session', 'daily'] };
        const args = ['session', verb, ...Object.entries(flags).filter(([name]) => name !== missing).flatMap(([, given]) => given)];

        const result = await box.run(args);

        const said = assertRefused(result);
        assert.match(said, new RegExp(`session ${verb} needs --${missing}\\b`), `in the words every missing flag gets, got:\n${said}`);
        await assertNothingTyped(box, before, `--${missing} missing`);
      });
    }
  }

  // ---------------------------------------------------- refused before anything is typed

  for (const verb of VERBS) {
    test(`session ${verb} for a bot the bots folder does not have is refused, naming it, and types nothing`, async (t) => {
      const box = await createSandbox(t);
      await running(box);
      const before = await typedEverywhere(box);

      assertRefused(await sessionCommand(box, verb, { bot: 'no-such-bot' }), 'no-such-bot');

      await assertNothingTyped(box, before, 'an unknown bot');
    });

    test(`session ${verb} for a session the bot does not have is refused, naming it, and types nothing`, async (t) => {
      const box = await createSandbox(t);
      await running(box);
      const before = await typedEverywhere(box);

      assertRefused(await sessionCommand(box, verb, { session: 'no-such-session' }), 'no-such-session');

      await assertNothingTyped(box, before, 'an unknown session');
    });

    test(`session ${verb} for a paused session is refused, saying it is paused, and types nothing`, async (t) => {
      const box = await createSandbox(t);
      await running(box);
      const paused = await box.run(['pause', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);
      assert.equal(paused.code, 0, `the pause this test stands on: ${paused.stdout}${paused.stderr}`);
      const before = await typedEverywhere(box);

      const said = assertRefused(await sessionCommand(box, verb));

      assert.match(said, /paused/i, `it says the session is paused, got:\n${said}`);
      await assertNothingTyped(box, before, 'a paused session');
    });

    test(`session ${verb} for a session of a paused bot is refused, saying it is paused, and types nothing`, async (t) => {
      const box = await createSandbox(t);
      await running(box);
      const paused = await box.run(['pause', '--bots', 'bots', '--bot', BOT]);
      assert.equal(paused.code, 0, `the pause this test stands on: ${paused.stdout}${paused.stderr}`);
      const before = await typedEverywhere(box);

      const said = assertRefused(await sessionCommand(box, verb));

      assert.match(said, /paused/i, `it says the bot is paused, got:\n${said}`);
      await assertNothingTyped(box, before, 'a paused bot');
    });

    test(`session ${verb} for a session never brought up, with no tab, is refused and types nothing`, async (t) => {
      const box = await createSandbox(t);
      await madeBot(box);
      const before = await typedEverywhere(box);

      assertRefused(await sessionCommand(box, verb), 'daily');

      await assertNothingTyped(box, before, 'a session with no tab');
    });

    test(`session ${verb} for a session whose tab Orca no longer has is refused and types nothing`, async (t) => {
      const box = await createSandbox(t);
      const bots = await running(box);
      const { tabId } = await liveTab(box, bots);
      await box.orca.set({ terminals: (await box.orca.terminals()).filter((terminal) => terminal.tabId !== tabId) });
      const before = await typedEverywhere(box);

      assertRefused(await sessionCommand(box, verb), 'daily');

      await assertNothingTyped(box, before, 'a closed tab');
    });

    test(`session ${verb} for a tab with only its shell in front is refused, saying a restart brings it back, and types nothing`, async (t) => {
      // The harness quit or crashed: a command typed now would run in the shell.
      const box = await createSandbox(t);
      const bots = await running(box);
      await changeTab(box, (await liveTab(box, bots)).tabId, { foreground: 'shell' });
      const before = await typedEverywhere(box);

      assertRefused(await sessionCommand(box, verb), 'restart');

      await assertNothingTyped(box, before, 'the shell in front');
    });
  }

  // ---------------------------------------------------------------- clear, Claude Code

  test('clear on Claude Code: /clear typed a character a send, read on screen, a return of its own, and the new conversation the book holds is the answer', async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box);
    const tab = await liveTab(box, bots);
    await changeTab(box, tab.tabId, { nextScreens: screensFor('claude', '/clear', CLAUDE_CLEAR_TYPED, CLAUDE_IDLE) });
    const others = Object.fromEntries(Object.entries(await typedEverywhere(box)).filter(([handle]) => handle !== tab.handle));
    const from = (await box.orca.calls()).length;

    // Claude Code reports the clear at /clear itself, with its own word for it.
    const { result, played } = await runPlaying(box, bots, 'clear', {
      when: (sends) => sends.some((one) => one.text === '\r'),
      then: () => hookReports(box, bots, 'sess-cleared', 'clear'),
    });

    const answer = answered(result, 'the clear');
    assert.ok(played, 'the premise: the return was sent and the hook reported the new conversation');
    assert.deepEqual(
      await sendsInto(box, bots),
      [...typed('/clear'), { text: '\r', enter: false }],
      'the command as text with no return, then the return as a send of its own, and nothing else: no line after it on Claude Code',
    );
    assert.equal(answer.bots, bots, 'bots is the folder, resolved');
    assert.deepEqual(answer.cleared, { bot: BOT, session: 'daily', harness: 'claude', was: 'sess-daily', now: 'sess-cleared' });
    assert.equal((await sessionIn(bots, BOT, 'daily')).session, 'sess-cleared', 'the book holds the new conversation');
    const now = Object.fromEntries(Object.entries(await typedEverywhere(box)).filter(([handle]) => handle !== tab.handle));
    assert.deepEqual(now, others, 'no other tab, Bot Father\'s and the bot\'s other session\'s among them, had anything typed into it');
    await assertSentOnlyInto(box, tab.handle, from, 'clear');
  });

  test('clear of a session whose book held no conversation yet answers was: null', async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box, { reported: false });
    assert.equal((await sessionIn(bots, BOT, 'daily')).session, undefined, 'the premise: no conversation in the book');
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: screensFor('claude', '/clear', CLAUDE_CLEAR_TYPED, CLAUDE_IDLE) });

    const { result, played } = await runPlaying(box, bots, 'clear', {
      when: (sends) => sends.some((one) => one.text === '\r'),
      then: () => hookReports(box, bots, 'sess-cleared', 'clear'),
    });

    const answer = answered(result, 'the clear');
    assert.ok(played, 'the premise: the hook reported the new conversation');
    assert.deepEqual(answer.cleared, { bot: BOT, session: 'daily', harness: 'claude', was: null, now: 'sess-cleared' });
  });

  test('clear without --json says, on its way out, the bot, the session and the new conversation', async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box);
    const { tabId } = await liveTab(box, bots);
    await changeTab(box, tabId, { nextScreens: screensFor('claude', '/clear', CLAUDE_CLEAR_TYPED, CLAUDE_IDLE) });

    const run = sessionCommand(box, 'clear');
    let finished = false;
    run.then(() => { finished = true; });
    const until = Date.now() + 25_000;
    while (!finished && Date.now() < until && !(await sendsInto(box, bots)).some((one) => one.text === '\r')) await sleep(50);
    await hookReports(box, bots, 'sess-cleared', 'clear');
    const result = await run;

    assert.equal(result.code, 0, `the clear should go through: ${result.stdout}${result.stderr}`);
    for (const word of [BOT, 'daily', 'sess-cleared']) {
      assert.ok(result.stdout.includes(word), `the plain answer names ${word}, got:\n${result.stdout}`);
    }
  });

  test('clear waits out a busy session and types once it is idle, within the 30 s', async (t) => {
    // Orca's tui-idle says busy on the first two looks and idle after.
    const box = await createSandbox(t);
    const bots = await running(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: screensFor('claude', '/clear', CLAUDE_CLEAR_TYPED, CLAUDE_IDLE) });
    await box.orca.set({ waitIdle: ['busy', 'busy', true] });
    const from = (await box.orca.calls()).length;

    const { result, played } = await runPlaying(box, bots, 'clear', {
      when: (sends) => sends.some((one) => one.text === '\r'),
      then: () => hookReports(box, bots, 'sess-cleared', 'clear'),
    });

    const answer = answered(result, 'the clear');
    assert.ok(played, 'the premise: the hook reported the new conversation');
    assert.deepEqual(answer.cleared.now, 'sess-cleared');
    assert.deepEqual(await sendsInto(box, bots), [...typed('/clear'), { text: '\r', enter: false }]);
    const calls = (await box.orca.calls()).slice(from);
    const firstSend = calls.findIndex((call) => orcaCommand(call) === 'terminal send');
    const looksBefore = calls.slice(0, firstSend).filter((call) => orcaCommand(call) === 'terminal wait').length;
    assert.ok(looksBefore >= 3, `nothing was typed until a look found it idle: the third, got ${looksBefore} look(s) first`);
  });

  test('a draft already in Claude Code\'s input line: the /clear is taken back with six backspaces in one send, nothing entered, and the refusal shows the line', async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: screensFor('claude', '/clear', CLAUDE_CLEAR_AFTER_DRAFT, CLAUDE_IDLE) });
    const book = await sessionIn(bots, BOT, 'daily');

    const said = assertRefused(await sessionCommand(box, 'clear'));

    assert.deepEqual(await sendsInto(box, bots), [...typed('/clear'), { text: backspaces('/clear'), enter: false }]);
    assert.ok(said.includes('fix the flaky test/clear'), `it says what the input line showed, got:\n${said}`);
    assert.deepEqual(await sessionIn(bots, BOT, 'daily'), book, 'the book is as it was');
  });

  test('Claude Code\'s menu with another command first, one whose name only starts with /clear: taken back, nothing entered, and the refusal names that row', async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: screensFor('claude', '/clear', CLAUDE_CLEAR_OTHER_FIRST, CLAUDE_IDLE) });

    const said = assertRefused(await sessionCommand(box, 'clear'));

    assert.deepEqual(await sendsInto(box, bots), [...typed('/clear'), { text: backspaces('/clear'), enter: false }]);
    assert.ok(said.includes('/clear-history'), `it says what the menu showed first, got:\n${said}`);
  });

  test('no slash menu under Claude Code\'s input line: /clear taken back, nothing entered, and the refusal shows how the screen ended', async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: screensFor('claude', '/clear', CLAUDE_CLEAR_NO_MENU, CLAUDE_IDLE) });

    const said = assertRefused(await sessionCommand(box, 'clear'));

    assert.deepEqual(await sendsInto(box, bots), [...typed('/clear'), { text: backspaces('/clear'), enter: false }]);
    // The screen's last rows, those below the input line among them, so a
    // layout the check did not expect can be seen from the refusal alone (the
    // first live run, #391).
    assert.ok(said.includes('auto mode on (shift+tab to cycle)'), `it shows the screen's last rows, the foot row below the input box among them, got:\n${said}`);
  });

  // ---------------------------------------------------------------- clear, Codex

  test('clear on Codex: /new a character a send, a return, "Current checkout" taken with a return, then the ruled line with a return, and the new conversation is the answer', async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box, { harness: 'codex' });
    const tab = await liveTab(box, bots);
    await changeTab(box, tab.tabId, { nextScreens: screensFor('codex', '/new', CODEX_NEW_TYPED, CODEX_NEW_MENU, CODEX_IDLE) });
    const others = Object.fromEntries(Object.entries(await typedEverywhere(box)).filter(([handle]) => handle !== tab.handle));
    const from = (await box.orca.calls()).length;

    // Codex reports its new conversation at its first turn, as a startup.
    const { result, played } = await runPlaying(box, bots, 'clear', {
      when: (sends) => sends.some((one) => one.text === RECORD_LINE),
      then: () => hookReports(box, bots, 'sess-new', 'startup'),
    });

    const answer = answered(result, 'the clear');
    assert.ok(played, 'the premise: the line was typed and the hook reported the new conversation');
    assert.deepEqual(await sendsInto(box, bots), [
      ...typed('/new'),
      { text: '\r', enter: false },
      { text: '\r', enter: false },
      { text: RECORD_LINE, enter: true },
    ], '/new as text, its return, the return that takes "Current checkout", and the ruled line, once, with a return');
    assert.equal(answer.bots, bots);
    assert.deepEqual(answer.cleared, { bot: BOT, session: 'daily', harness: 'codex', was: 'sess-daily', now: 'sess-new' });
    assert.equal((await sessionIn(bots, BOT, 'daily')).session, 'sess-new', 'the book holds the new conversation');
    const now = Object.fromEntries(Object.entries(await typedEverywhere(box)).filter(([handle]) => handle !== tab.handle));
    assert.deepEqual(now, others, 'no other tab had anything typed into it');
    await assertSentOnlyInto(box, tab.handle, from, 'clear on Codex');
  });

  test('clear on Codex when no "Where should the new conversation run?" comes up: /new, its return, and the ruled line', async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box, { harness: 'codex' });
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: screensFor('codex', '/new', CODEX_NEW_TYPED, CODEX_IDLE) });

    const { result, played } = await runPlaying(box, bots, 'clear', {
      when: (sends) => sends.some((one) => one.text === RECORD_LINE),
      then: () => hookReports(box, bots, 'sess-new', 'startup'),
    });

    const answer = answered(result, 'the clear');
    assert.ok(played, 'the premise: the hook reported the new conversation');
    assert.deepEqual(await sendsInto(box, bots), [
      ...typed('/new'),
      { text: '\r', enter: false },
      { text: RECORD_LINE, enter: true },
    ]);
    assert.deepEqual(answer.cleared, { bot: BOT, session: 'daily', harness: 'codex', was: 'sess-daily', now: 'sess-new' });
  });

  test('Codex\'s "Where should the new conversation run?" with its pointer on "2. New worktree": Esc, a refusal, and never a 2, a return or the line', async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box, { harness: 'codex' });
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: screensFor('codex', '/new', CODEX_NEW_TYPED, CODEX_NEW_MENU_ON_TWO, CODEX_IDLE) });

    assertRefused(await sessionCommand(box, 'clear'));

    assert.deepEqual(await sendsInto(box, bots), [
      ...typed('/new'),
      { text: '\r', enter: false },
      { text: '\x1b', enter: false },
    ], 'the menu is backed out of with Esc, and nothing picks a worktree');
  });

  test('no slash menu under Codex\'s input line: /new taken back with four backspaces in one send, nothing entered, and the refusal shows how the screen ended', async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box, { harness: 'codex' });
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: screensFor('codex', '/new', CODEX_NEW_NO_MENU, CODEX_IDLE) });

    const said = assertRefused(await sessionCommand(box, 'clear'));

    assert.deepEqual(await sendsInto(box, bots), [...typed('/new'), { text: backspaces('/new'), enter: false }]);
    assert.ok(said.includes('? for shortcuts'), `it shows the screen's last rows, Codex's status rows below the input line among them, got:\n${said}`);
  });

  // ------------------------------------- one character a send (ruling 2026-10-03)
  //
  // Live run 2 of #391: Codex 0.160.0, given `/new` in one send, left its input
  // line a bare `›` for 3 s, and its slash popup is drawn above the input line,
  // not below. The architect's ruling: the kit types a slash command one
  // character a send, each through the typing gate, with a gap past Codex's
  // paste-burst window; and the Return rule stays as it was, read on Codex
  // against the popup's selected row above the input line.

  /** The happy path on each harness: the command, the screens it shows, what follows the last character, and the hook's word. */
  const TYPING = [
    { harness: 'claude', command: '/clear', typedScreen: CLAUDE_CLEAR_TYPED, after: [CLAUDE_IDLE], source: 'clear', last: '\r' },
    { harness: 'codex', command: '/new', typedScreen: CODEX_NEW_TYPED, after: [CODEX_NEW_MENU, CODEX_IDLE], source: 'startup', last: RECORD_LINE },
  ];

  for (const { harness, command, typedScreen, after, source, last } of TYPING) {
    test(`clear on ${harness}: each character of ${command} is its own send, each after a look through the typing gate, at least 60 ms apart`, async (t) => {
      const box = await createSandbox(t);
      const bots = await running(box, { harness });
      const tab = await liveTab(box, bots);
      await changeTab(box, tab.tabId, { nextScreens: screensFor(harness, command, typedScreen, ...after) });
      const from = (await box.orca.calls()).length;

      const { result, played } = await runPlaying(box, bots, 'clear', {
        when: (sends) => sends.some((one) => one.text === last),
        then: () => hookReports(box, bots, 'sess-new', source),
      });

      answered(result, 'the clear');
      assert.ok(played, 'the premise: the hook reported the new conversation');
      const calls = (await box.orca.calls()).slice(from);
      const clock = (await box.orca.clock()).slice(from);
      const sends = calls
        .map((call, at) => ({ call, at }))
        .filter(({ call }) => orcaCommand(call) === 'terminal send' && orcaFlag(call, '--terminal') === tab.handle);
      const keys = sends.slice(0, command.length);
      assert.deepEqual(
        keys.map(({ call }) => ({ text: orcaFlag(call, '--text'), enter: call.args.includes('--enter') })),
        typed(command),
        `the first ${command.length} sends are ${command}, one character each, none with --enter`,
      );
      let since = -1;
      for (const [n, { at }] of keys.entries()) {
        const looks = calls.slice(since + 1, at).filter((call) => orcaCommand(call) === 'terminal wait'
          && orcaFlag(call, '--terminal') === tab.handle && orcaFlag(call, '--for') === 'tui-idle');
        assert.ok(looks.length > 0, `a look through the gate (terminal wait --for tui-idle on the tab) before character ${n + 1}, ${JSON.stringify(command[n])}`);
        since = at;
      }
      for (let n = 1; n < keys.length; n += 1) {
        const gap = clock[keys[n].at].at - clock[keys[n - 1].at].at;
        assert.ok(gap >= 60, `character ${n + 1} came ${gap} ms after the one before it, inside Codex's 60 ms paste-burst flush`);
      }
    });
  }

  for (const { harness, command, question } of [
    { harness: 'claude', command: '/clear', question: CLAUDE_TEACH_AUTO },
    { harness: 'codex', command: '/new', question: CODEX_UPDATE_OFFER },
  ]) {
    test(`a question that comes up on ${harness} after two characters of ${command}: the gate stops the typing, the two are taken back in one send, and it refuses`, async (t) => {
      const box = await createSandbox(t);
      const bots = await running(box, { harness });
      await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: [whileTyping(harness, command)[0], question] });

      const said = assertRefused(await sessionCommand(box, 'clear'));

      assert.deepEqual(
        await sendsInto(box, bots),
        [...typed(command.slice(0, 2)), { text: backspaces(command.slice(0, 2)), enter: false }],
        'the two characters typed, and then exactly those two taken back, and nothing more',
      );
      assert.match(said, /question/i, `it says a question came up, got:\n${said}`);
    });
  }

  // #491: Claude Code 2.1.289's Teach list, drawn ABOVE the input box with the
  // box's own empty `❯` below it (helpers/screens.js CLAUDE_TEACH_LIST, a live
  // capture), is a question to the gate like one at the bottom of the screen. It
  // comes up after a session's first turn in auto mode, so a clear can meet it
  // partway. The two characters typed before it came are the presence: the path
  // was typing.
  test('#491: the Teach list drawn above the input box comes up after two characters of /clear: the gate stops the typing, the two are taken back in one send, and it refuses, saying a question came up', async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: [whileTyping('claude', '/clear')[0], CLAUDE_TEACH_LIST] });

    const said = assertRefused(await sessionCommand(box, 'clear'));

    assert.deepEqual(
      await sendsInto(box, bots),
      [...typed('/c'), { text: backspaces('/c'), enter: false }],
      'the two characters typed, and then exactly those two taken back, and nothing more',
    );
    assert.match(said, /question/i, `it says a question came up, got:\n${said}`);
  });

  // #491, the presence beside the refusals: the same capture with the list taken
  // out is no question, and the clear goes through from it. Passes before the
  // change.
  test('#491: clear on Claude Code from the 2.1.289 capture with the list taken out: /clear typed, entered, and the new conversation is the answer', async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, {
      screen: CLAUDE_TEACH_LIST_GONE,
      nextScreens: screensFor('claude', '/clear', CLAUDE_CLEAR_TYPED, CLAUDE_IDLE),
    });

    const { result, played } = await runPlaying(box, bots, 'clear', {
      when: (sends) => sends.some((one) => one.text === '\r'),
      then: () => hookReports(box, bots, 'sess-cleared', 'clear'),
    });

    const answer = answered(result, 'the clear');
    assert.ok(played, 'the premise: the return was sent and the hook reported the new conversation');
    assert.deepEqual(await sendsInto(box, bots), [...typed('/clear'), { text: '\r', enter: false }]);
    assert.deepEqual(answer.cleared, { bot: BOT, session: 'daily', harness: 'claude', was: 'sess-daily', now: 'sess-cleared' });
  });

  // #502: Claude Code's panel of feedback drafts (helpers/screens.js
  // CLAUDE_FEEDBACK_PANEL_TYPED, a capture) stops the slash menu, and takes
  // single keys from the input line: `1` reviews, `2` and `2` sends a draft to
  // Anthropic, `0` dismisses. A refusal names the panel as the cause and says
  // what clears it: the user reviews, sends or dismisses the drafts. It does not
  // say Claude Code cannot compact; Claude Code has /compact.

  // #502, the issue's own screen: the panel shows with /compact typed under it,
  // as the kit's refusal on arch-panel quoted it. The eight characters typed
  // before it showed are the kit's own, and are taken back; nothing else goes in.
  test('#502: the panel of feedback drafts shows once /compact is typed: no return, the eight taken back in one send, and the refusal names the panel and what clears it, not that Claude Code cannot compact', async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: screensFor('claude', COMPACT, CLAUDE_FEEDBACK_PANEL_TYPED, CLAUDE_FEEDBACK_PANEL) });

    const said = assertRefused(await sessionCommand(box, 'compact'));

    assert.deepEqual(
      await sendsInto(box, bots),
      [...typed(COMPACT), { text: backspaces(COMPACT), enter: false }],
      'the eight characters typed, then exactly those eight taken back, and nothing more: no return, no Esc, no key for the panel',
    );
    assertNamesThePanel(said, CLAUDE_FEEDBACK_PANEL_TYPED, 'compact');
  });

  // #502: the panel draws late, after the gate's look that follows the last
  // character: that look finds the menu and no panel, and only the read that
  // decides on the return shows the panel (the fake Orca's `then`, as the
  // late-draw tests further down use it). The refusal there names the panel,
  // not just a question.
  test('#502: the panel of feedback drafts draws only on the read that decides on the return: no return, the eight taken back, and the refusal names the panel and what clears it', async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, {
      nextScreens: [...whileTyping('claude', COMPACT), { screen: CLAUDE_COMPACT_TYPED, then: CLAUDE_FEEDBACK_PANEL_TYPED }, CLAUDE_FEEDBACK_PANEL],
    });

    const said = assertRefused(await sessionCommand(box, 'compact'));

    assert.deepEqual(
      await sendsInto(box, bots),
      [...typed(COMPACT), { text: backspaces(COMPACT), enter: false }],
      'the eight characters typed, then exactly those eight taken back: no return',
    );
    assertNamesThePanel(said, CLAUDE_FEEDBACK_PANEL_TYPED, 'compact, the panel drawn late');
  });

  // #502, the presence beside the refusals: the same screen with the panel
  // taken out is no panel, and the clear goes through from it. Passes before the
  // change.
  test('#502: clear on Claude Code from the panel screen with the panel taken out: /clear typed, entered, and the new conversation is the answer', async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, {
      screen: CLAUDE_FEEDBACK_PANEL_GONE,
      nextScreens: screensFor('claude', '/clear', CLAUDE_CLEAR_TYPED, CLAUDE_FEEDBACK_PANEL_GONE),
    });

    const { result, played } = await runPlaying(box, bots, 'clear', {
      when: (sends) => sends.some((one) => one.text === '\r'),
      then: () => hookReports(box, bots, 'sess-cleared', 'clear'),
    });

    const answer = answered(result, 'the clear');
    assert.ok(played, 'the premise: the return was sent and the hook reported the new conversation');
    assert.deepEqual(await sendsInto(box, bots), [...typed('/clear'), { text: '\r', enter: false }]);
    assert.deepEqual(answer.cleared, { bot: BOT, session: 'daily', harness: 'claude', was: 'sess-daily', now: 'sess-cleared' });
  });

  // ------------------------------------------------ after live run 4 (ruling 2026-10-03)
  //
  // Live run 4 of #391. Claude Code 2.1.288 puts a non-breaking space after its
  // pointer, and draws its menu above the input box's top rule. Codex 0.160.0's
  // input line reads `›` alone in Orca's screen read whenever its slash popup is
  // open. The architect's ruling: on Claude Code the input line, read with
  // U+00A0 as a space, reads exactly the command, and the first command row
  // above the box's top rule names it; wrapped description rows are no command
  // rows. On Codex, before the first character the input line is empty or
  // Codex's placeholder, no draft; after typing, the popup's selected row (the
  // nearest `›` row above the input line) names exactly the command and is the
  // popup's only command row; the input line may be `›` alone on Codex 0.160.0,
  // as the session's current rollout names its Codex (its first line's
  // `payload.cli_version`), and must read exactly `› /new` on any other or on
  // one that cannot be read.

  for (const { cliVersion, what } of [
    { cliVersion: '0.161.0', what: 'a Codex other than 0.160.0' },
    { cliVersion: null, what: 'a Codex whose version its rollout does not give' },
  ]) {
    test(`${what}: a bare "›" input line under /new's own popup row is taken back, never entered, and the refusal shows the rows`, async (t) => {
      // The screen of live run 2 (helpers/screens.js, CODEX_NEW_BARE_INPUT),
      // which Codex 0.160.0 draws; on another, the line must show the command.
      const box = await createSandbox(t);
      const bots = await running(box, { harness: 'codex', cliVersion });
      await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: screensFor('codex', '/new', CODEX_NEW_BARE_INPUT, CODEX_IDLE) });

      const said = assertRefused(await sessionCommand(box, 'clear'));

      assert.deepEqual(await sendsInto(box, bots), [...typed('/new'), { text: backspaces('/new'), enter: false }]);
      assert.ok(said.includes('start a new chat during a conversation'), `it shows the rows it saw, the popup's above the bare line among them, got:\n${said}`);
    });
  }

  test('a Codex other than 0.160.0 whose input line reads exactly "› /new" under its popup row: /new is entered, and the new conversation is the answer', async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box, { harness: 'codex', cliVersion: '0.161.0' });
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: screensFor('codex', '/new', CODEX_NEW_TYPED_SHOWN, CODEX_NEW_MENU, CODEX_IDLE) });

    const { result, played } = await runPlaying(box, bots, 'clear', {
      when: (sends) => sends.some((one) => one.text === RECORD_LINE),
      then: () => hookReports(box, bots, 'sess-new', 'startup'),
    });

    const answer = answered(result, 'the clear');
    assert.ok(played, 'the premise: the line was typed and the hook reported the new conversation');
    assert.deepEqual(answer.cleared, { bot: BOT, session: 'daily', harness: 'codex', was: 'sess-daily', now: 'sess-new' });
  });

  for (const { screen, line } of [
    { screen: CODEX_NEW_TWO_ROWS, line: '"›" alone' },
    { screen: CODEX_NEW_TWO_ROWS_SHOWN, line: '"› /new"' },
  ]) {
    test(`Codex's popup with /new selected and a second command row in it, the input line ${line}: /new taken back, never entered, and refused`, async (t) => {
      const box = await createSandbox(t);
      const bots = await running(box, { harness: 'codex' });
      await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: screensFor('codex', '/new', screen, CODEX_IDLE) });

      assertRefused(await sessionCommand(box, 'clear'));

      assert.deepEqual(await sendsInto(box, bots), [...typed('/new'), { text: backspaces('/new'), enter: false }]);
    });
  }

  test('a draft in Codex\'s input line before the first character: refused, nothing typed, and the refusal shows the draft', async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box, { harness: 'codex' });
    await changeTab(box, (await liveTab(box, bots)).tabId, { screen: CODEX_DRAFT, nextScreens: screensFor('codex', '/new', CODEX_NEW_TYPED, CODEX_NEW_MENU, CODEX_IDLE) });
    const before = await typedEverywhere(box);

    const said = assertRefused(await sessionCommand(box, 'clear'));

    await assertNothingTyped(box, before, 'a draft in the input line');
    assert.ok(said.includes('Reply with the single word OK'), `it shows the draft it found, got:\n${said}`);
  });

  test('Codex\'s input line empty, "›" alone with no placeholder, before the first character: /new is typed and entered', async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box, { harness: 'codex' });
    await changeTab(box, (await liveTab(box, bots)).tabId, { screen: CODEX_IDLE_EMPTY, nextScreens: screensFor('codex', '/new', CODEX_NEW_TYPED, CODEX_NEW_MENU, CODEX_IDLE) });

    const { result, played } = await runPlaying(box, bots, 'clear', {
      when: (sends) => sends.some((one) => one.text === RECORD_LINE),
      then: () => hookReports(box, bots, 'sess-new', 'startup'),
    });

    const answer = answered(result, 'the clear');
    assert.ok(played, 'the premise: the hook reported the new conversation');
    assert.equal(answer.cleared.now, 'sess-new');
  });

  test('Claude Code\'s menu drawn under the input box and none above it, the layout 2.1.288 does not draw: /clear taken back, never entered', async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: screensFor('claude', '/clear', CLAUDE_CLEAR_MENU_BELOW, CLAUDE_IDLE) });

    assertRefused(await sessionCommand(box, 'clear'));

    assert.deepEqual(await sendsInto(box, bots), [...typed('/clear'), { text: backspaces('/clear'), enter: false }]);
  });

  test('Codex\'s popup above the input line with another command selected: /new taken back, never entered, and the refusal names that command', async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box, { harness: 'codex' });
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: screensFor('codex', '/new', CODEX_NEW_OTHER_SELECTED, CODEX_IDLE) });

    const said = assertRefused(await sessionCommand(box, 'clear'));

    assert.deepEqual(await sendsInto(box, bots), [...typed('/new'), { text: backspaces('/new'), enter: false }]);
    assert.ok(said.includes('/model'), `it says what the popup had selected, got:\n${said}`);
  });

  // ---------------------------------- the look between characters (after live run 3)
  //
  // Live run 3 of #391: Codex's look before the second character found Orca's
  // tui-idle no longer answering ok once "/" was typed, most likely because the
  // open slash popup turns it off (worked out, not seen). The architect's
  // ruling: before the first character, idle as before; between characters, and
  // once more after the last before the return, the typing gate plus the
  // harness's own at-work row on screen, with no tui-idle-ok requirement. A
  // refusal names its signal. Here the popup's effect is the fake's `tuiIdle`
  // on each screen put up while the command is typed.

  /** Screens that each turn Orca's tui-idle off in their tab, as an open slash popup was worked out to. */
  const popupOpen = (screens) => screens.map((screen) => ({ screen, tuiIdle: 'busy' }));

  /** Screens that leave Orca's tui-idle to answer as it did before the popup. */
  const popupClosed = (screens) => screens.map((screen) => ({ screen }));

  for (const { harness, command, typedScreen, after, source, last } of TYPING) {
    test(`${harness}: Orca's tui-idle stops answering ok once the first character is typed, and no at-work row is on screen: ${command} is still typed and entered`, async (t) => {
      const box = await createSandbox(t);
      const bots = await running(box, { harness });
      await changeTab(box, (await liveTab(box, bots)).tabId, {
        nextScreens: [...popupOpen([...whileTyping(harness, command), typedScreen]), ...popupClosed(after)],
      });

      const { result, played } = await runPlaying(box, bots, 'clear', {
        when: (sends) => sends.some((one) => one.text === last),
        then: () => hookReports(box, bots, 'sess-new', source),
      });

      const answer = answered(result, 'the clear');
      assert.ok(played, 'the premise: the hook reported the new conversation');
      assert.deepEqual(answer.cleared, { bot: BOT, session: 'daily', harness, was: 'sess-daily', now: 'sess-new' });
      assert.deepEqual((await sendsInto(box, bots)).slice(0, command.length + 1), [...typed(command), { text: '\r', enter: false }], 'every character, then the return');
    });

    test(`${harness}: the harness's at-work row comes up after two characters of ${command}: the typing stops, the two are taken back, and the refusal names the row`, async (t) => {
      const box = await createSandbox(t);
      const bots = await running(box, { harness });
      await changeTab(box, (await liveTab(box, bots)).tabId, {
        nextScreens: [whileTyping(harness, command)[0], atWork(harness, command.slice(0, 2), command)],
      });

      const said = assertRefused(await sessionCommand(box, 'clear'));

      assert.deepEqual(await sendsInto(box, bots), [...typed(command.slice(0, 2)), { text: backspaces(command.slice(0, 2)), enter: false }]);
      assert.ok(said.includes(harness === 'codex' ? 'esc to interrupt' : 'Nucleating'), `it names its signal, the at-work row, got:\n${said}`);
    });

    test(`${harness}: the harness's at-work row is up once the last character of ${command} is in: no return, the command taken back, and the refusal names the row`, async (t) => {
      const box = await createSandbox(t);
      const bots = await running(box, { harness });
      await changeTab(box, (await liveTab(box, bots)).tabId, {
        nextScreens: [...whileTyping(harness, command), atWork(harness, command, command)],
      });

      const said = assertRefused(await sessionCommand(box, 'clear'));

      assert.deepEqual(await sendsInto(box, bots), [...typed(command), { text: backspaces(command), enter: false }], 'the look before the return stops it');
      assert.ok(said.includes(harness === 'codex' ? 'esc to interrupt' : 'Nucleating'), `it names its signal, the at-work row, got:\n${said}`);
    });
  }

  // --------------------------------------- the screen read before Return (review of c1e5ba4)
  //
  // The reviewer's round-3 finding at c1e5ba4: after the last character the
  // kit looks once through the gate, then reads the screen again, waiting up to
  // 3 s for the menu to draw, and checks only the input line and the menu on
  // those later reads. An at-work row or a question that shows there did not
  // stop Return. The requirement: the screen the kit accepts before Return, the
  // same read that passes the input-line and menu rule, shows no at-work row
  // and no question, on every read while it waits for the menu; otherwise no
  // Return, the command is taken back, and the refusal names the signal.
  //
  // How it is modelled. After the last character the screen is first drawn
  // without the menu, the command in the input line and nothing above it, for
  // one read; every read after that shows the menu drawn, and with it the
  // signal. So whatever the kit reads first, the first screen that passes the
  // input-line and menu rule carries the signal, and a kit that reads on until
  // the menu is drawn cannot accept a screen without it.

  /** A form's foot under Claude Code's input box: a question, as questionIn sees one, below the input line. A reconstruction. */
  const UNDER_A_FORM = [...CLAUDE_CLEAR_TYPED, '  Enter to confirm · Esc to cancel'];

  for (const { harness, command, early, late, after, what, signal } of [
    { harness: 'claude', command: '/clear', early: CLAUDE_CLEAR_NO_MENU, late: atWork('claude', '/clear', '/clear'), after: CLAUDE_IDLE, what: 'its at-work row', signal: (said) => said.includes('Nucleating') },
    { harness: 'codex', command: '/new', early: CODEX_IDLE_EMPTY, late: atWork('codex', '/new', '/new'), after: CODEX_IDLE, what: 'its at-work row', signal: (said) => said.includes('esc to interrupt') },
    { harness: 'claude', command: '/clear', early: CLAUDE_CLEAR_NO_MENU, late: UNDER_A_FORM, after: CLAUDE_IDLE, what: 'a question', signal: (said) => /question/i.test(said) },
  ]) {
    test(`${harness}: the menu draws after the last character of ${command} with ${what} on the same screen: no return, the command taken back, and the refusal names it`, async (t) => {
      const box = await createSandbox(t);
      const bots = await running(box, { harness });
      await changeTab(box, (await liveTab(box, bots)).tabId, {
        nextScreens: [...whileTyping(harness, command), { screen: early, then: late }, after],
      });

      const said = assertRefused(await sessionCommand(box, 'clear'));

      assert.deepEqual(await sendsInto(box, bots), [...typed(command), { text: backspaces(command), enter: false }], 'the screen that passed the menu rule carried the signal, so no return');
      assert.ok(signal(said), `it names its signal, ${what}, got:\n${said}`);
    });
  }

  // ---------------------------------------------------------------- compact

  for (const harness of ['claude', 'codex']) {
    test(`compact on ${harness}: /compact typed a character a send, read on screen, a return of its own, and a compaction on the harness's record is confirmed`, async (t) => {
      const box = await createSandbox(t);
      const bots = await running(box, { harness });
      const tab = await liveTab(box, bots);
      await changeTab(box, tab.tabId, { nextScreens: screensFor(harness, COMPACT, harness === 'codex' ? CODEX_COMPACT_TYPED : CLAUDE_COMPACT_TYPED, harness === 'codex' ? CODEX_IDLE : CLAUDE_IDLE) });
      const record = await recordFileOf(box, 'sess-daily');
      const book = await sessionIn(bots, BOT, 'daily');
      const from = (await box.orca.calls()).length;

      // The harness writes its compaction into the conversation's record once
      // the return has gone in.
      const { result, played } = await runPlaying(box, bots, 'compact', {
        when: (sends) => sends.some((one) => one.text === '\r'),
        then: () => compactionIn(record, harness),
      });

      const answer = answered(result, 'the compact');
      assert.ok(played, 'the premise: the return was sent and the compaction written');
      assert.deepEqual(await sendsInto(box, bots), [...typed(COMPACT), { text: '\r', enter: false }]);
      assert.equal(answer.bots, bots);
      assert.deepEqual(answer.compacted, { bot: BOT, session: 'daily', harness, conversation: 'sess-daily', confirmed: true });
      assert.deepEqual(await sessionIn(bots, BOT, 'daily'), book, 'a compact leaves the book as it was');
      await assertSentOnlyInto(box, tab.handle, from, `compact on ${harness}`);
    });
  }

  test('compact on a harness whose slash menu does not offer /compact: taken back with eight backspaces, nothing entered, and it says the harness cannot compact', async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box, { harness: 'codex' });
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: screensFor('codex', COMPACT, CODEX_COMPACT_NOT_OFFERED, CODEX_IDLE) });

    const said = assertRefused(await sessionCommand(box, 'compact'));

    assert.deepEqual(await sendsInto(box, bots), [...typed(COMPACT), { text: backspaces(COMPACT), enter: false }]);
    assert.match(said, /can(?:not|'t|’t) compact/i, `it says this harness cannot compact, got:\n${said}`);
  });

  /**
   * `/compact` typed into Claude Code's input line, no menu above the box and no
   * panel either: CLAUDE_CLEAR_NO_MENU with /compact in place of /clear. A
   * reconstruction.
   */
  const CLAUDE_COMPACT_NO_MENU = CLAUDE_CLEAR_NO_MENU.map((row) => (row === '❯\u00a0/clear' ? '❯\u00a0/compact' : row));

  // #502: the "cannot compact" line above is for Codex alone. Claude Code has
  // /compact, so a compact refused there because no menu came up says so plainly
  // and shows how the screen ended, with no claim about the harness.
  test('#502: compact on Claude Code with no slash menu above its input box: taken back with eight backspaces, nothing entered, the refusal says no menu came up and shows the screen\'s end, and not that Claude Code cannot compact', async (t) => {
    assert.equal(CLAUDE_COMPACT_NO_MENU.filter((row, at) => row !== CLAUDE_CLEAR_NO_MENU[at]).length, 1, 'the premise: only the input line changed');
    const box = await createSandbox(t);
    const bots = await running(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: screensFor('claude', COMPACT, CLAUDE_COMPACT_NO_MENU, CLAUDE_IDLE) });

    const said = assertRefused(await sessionCommand(box, 'compact'));

    assert.deepEqual(await sendsInto(box, bots), [...typed(COMPACT), { text: backspaces(COMPACT), enter: false }]);
    assert.match(said, /no menu/i, `it says no menu came up, got:\n${said}`);
    assert.ok(said.includes('auto mode on (shift+tab to cycle)'), `it shows the screen's last rows, got:\n${said}`);
    assert.doesNotMatch(said, /can(?:not|'t|’t) compact/i, `it does not say Claude Code cannot compact, got:\n${said}`);
  });

  // ------------------------------------- Claude Code 2.1.296's menu pointer (#510)
  //
  // Claude Code 2.1.296 marks the selected row of its slash menu with a pointer,
  // `  ❯ /compact`, above the input box's top rule. Its input line under the
  // rule reads `❯` alone whatever is in it, and Orca 1.4.223's screen read gives
  // the line's text as `draft` beside the rows, leaving the key out when the
  // line is empty (helpers/screens.js, the 2.1.296 captures). The architect's
  // final ruling on #510, as these tests hold it:
  //
  //   - The menu's selected row, above the input box's top rule, is its pointer
  //     row when it has one, and its first command row when it has none, as on
  //     2.1.288. Its first word is exactly the command: not `/compact-x`, not
  //     `/autocompact`. A refusal on the menu names the selected row.
  //   - The input line's text is Orca's `draft` when the read gives one, and it
  //     equals the command exactly. With no `draft`, the line is read from the
  //     rows as before: `❯ /compact`, with a space or a non-breaking space,
  //     passes, and a bare `❯` is refused.
  //   - Before the first key: a read that gives a non-empty `draft` means the
  //     user has a draft in the line. Refused, nothing typed into the tab at
  //     all, and the refusal says the input line holds a draft.
  //   - Not tied to a Claude Code version, and `/clear` is read as `/compact` is.
  //     Codex is as it was.
  //
  // The screens while the command is typed are whileTyping's, on 2.1.288's
  // layout and with no draft: the probes read the screen only once the whole
  // command was in, and the looks between characters ask the gate only. A
  // refused command's backspaces put up the read taken after them.

  /** How Claude Code's part is played once the return is in, and what the kit answers once it is done. */
  const ENTERED = {
    compact: {
      then: async (box) => compactionIn(await recordFileOf(box, 'sess-daily'), 'claude'),
      key: 'compacted',
      answer: { bot: BOT, session: 'daily', harness: 'claude', conversation: 'sess-daily', confirmed: true },
    },
    clear: {
      then: (box, bots) => hookReports(box, bots, 'sess-cleared', 'clear'),
      key: 'cleared',
      answer: { bot: BOT, session: 'daily', harness: 'claude', was: 'sess-daily', now: 'sess-cleared' },
    },
  };

  for (const { verb, command, idle, read, what } of [
    {
      verb: 'compact', command: COMPACT, idle: CLAUDE_296_TURN_IDLE, read: CLAUDE_296_TURN_COMPACT,
      what: 'the live read after a turn: the pointer on /compact, the input line "❯" alone, and the draft "/compact"',
    },
    {
      verb: 'clear', command: '/clear', idle: CLAUDE_296_TURN_IDLE, read: CLAUDE_296_TURN_CLEAR_READ,
      what: 'the capture after a turn, the pointer on /clear and the input line "❯" alone, with the draft "/clear" (rebuilt pairing)',
    },
    {
      verb: 'compact', command: COMPACT, idle: CLAUDE_296_IDLE, read: CLAUDE_296_COMPACT_READ,
      what: 'the capture with no turn yet, the pointer on /compact, with the draft "/compact" (rebuilt pairing)',
    },
    {
      verb: 'clear', command: '/clear', idle: CLAUDE_296_IDLE, read: CLAUDE_296_CLEAR_READ,
      what: 'the capture with no turn yet, the pointer on /clear, with the draft "/clear" (rebuilt pairing)',
    },
    {
      verb: 'compact', command: COMPACT, idle: CLAUDE_296_TURN_IDLE, read: CLAUDE_296_COMPACT_SHOWN,
      what: 'no draft, the input line reading "❯ /compact" and the pointer on /compact (rebuilt)',
    },
    {
      verb: 'clear', command: '/clear', idle: CLAUDE_296_TURN_IDLE, read: CLAUDE_296_CLEAR_SHOWN,
      what: 'no draft, the input line reading "❯ /clear" and the pointer on /clear (rebuilt)',
    },
  ]) {
    test(`#510: ${verb} on Claude Code 2.1.296 from ${what}: ${command} typed, entered, and the ${verb} confirmed`, async (t) => {
      const box = await createSandbox(t);
      const bots = await running(box);
      await changeTab(box, (await liveTab(box, bots)).tabId, { screen: idle, nextScreens: screensFor('claude', command, read, idle) });

      const { result, played } = await runPlaying(box, bots, verb, {
        when: (sends) => sends.some((one) => one.text === '\r'),
        then: () => ENTERED[verb].then(box, bots),
      });

      const answer = answered(result, `the ${verb}`);
      assert.ok(played, `the premise: the return was sent and Claude Code did the ${verb}`);
      assert.deepEqual(await sendsInto(box, bots), [...typed(command), { text: '\r', enter: false }], 'the command, a character a send, then its return, and nothing taken back');
      assert.deepEqual(answer[ENTERED[verb].key], ENTERED[verb].answer);
    });
  }

  for (const verb of VERBS) {
    test(`#510: ${verb} on Claude Code 2.1.296 with a draft in its input line before the first key, the live read with the draft "hello": refused, nothing typed into any tab, and the refusal says the line holds a draft`, async (t) => {
      const box = await createSandbox(t);
      const bots = await running(box);
      const command = verb === 'clear' ? '/clear' : COMPACT;
      await changeTab(box, (await liveTab(box, bots)).tabId, {
        screen: CLAUDE_296_TURN_DRAFT.screen,
        draft: CLAUDE_296_TURN_DRAFT.draft,
        nextScreens: screensFor('claude', command, { screen: CLAUDE_296_TURN_DRAFT.screen, draft: `hello${command}` }, CLAUDE_296_TURN_DRAFT),
      });
      const before = await typedEverywhere(box);
      const book = await sessionIn(bots, BOT, 'daily');

      const said = assertRefused(await sessionCommand(box, verb));

      await assertNothingTyped(box, before, 'a draft in the input line');
      assert.match(said, /draft/i, `it says the input line holds a draft, got:\n${said}`);
      assert.deepEqual(await sessionIn(bots, BOT, 'daily'), book, 'the book is as it was');
    });
  }
});

// The refusals once the command is typed. In each, the command is not the
// menu's selected row, or the input line does not read it: no return, and
// exactly the characters typed are taken back in one send. Side by side,
// since a check that wrongly lets a compact in waits out its 300 s.
describe('#510: the refusals once the command is typed, side by side', { concurrency: true }, () => {
  for (const { verb, command, idle = CLAUDE_296_TURN_IDLE, read, names, shows, what } of [
    {
      verb: 'compact', command: COMPACT, read: CLAUDE_296_ON_AUTOCOMPACT, names: '/autocompact',
      what: 'the draft "/compact" and the pointer moved down onto /autocompact, /compact the first command row and not selected',
    },
    {
      verb: 'compact', command: COMPACT, read: CLAUDE_296_ON_COMPACT_X, names: '/compact-x',
      what: 'the draft "/compact" and the pointer on /compact-x, a command whose name only starts with /compact, /compact under it not selected',
    },
    {
      verb: 'clear', command: '/clear', read: CLAUDE_296_ON_CLEAR_HISTORY, names: '/clear-history',
      what: 'the draft "/clear" and the pointer on /clear-history, /clear under it not selected',
    },
    {
      verb: 'compact', command: COMPACT, read: CLAUDE_296_TURN_COMPACT.screen,
      what: 'no draft, the input line "❯" alone and the pointer on /compact: the live read\'s rows with its draft left out',
    },
    {
      verb: 'clear', command: '/clear', read: CLAUDE_296_TURN_CLEAR_TYPED,
      what: 'no draft, the input line "❯" alone and the pointer on /clear: the capture after a turn, with no draft',
    },
    {
      // Stands for a draft the kit could not see before the first key: the
      // read before it gives none, and the read after typing gives the live
      // "hello/compact".
      verb: 'compact', command: COMPACT, read: CLAUDE_296_TURN_DRAFT_COMPACT,
      what: 'the draft "hello/compact" and no menu, the live read, the read before the first key giving no draft',
    },
    {
      // The draft alone is wrong: the menu is as captured, its pointer on the
      // command. Stands for a draft the kit could not see before its first key.
      verb: 'compact', command: COMPACT, read: CLAUDE_296_COMPACT_OTHER_DRAFT, shows: 'x/compact',
      what: 'the draft "x/compact" under the live read\'s menu, its pointer on /compact, the read before the first key giving no draft',
    },
    {
      verb: 'clear', command: '/clear', read: CLAUDE_296_CLEAR_OTHER_DRAFT, shows: 'x/clear',
      what: 'the draft "x/clear" under the captured menu, its pointer on /clear, the read before the first key giving no draft',
    },
    {
      verb: 'compact', command: COMPACT, read: CLAUDE_296_COMPACT_ECHOED,
      what: 'the draft "/compact" and no menu, only an earlier "❯ /compact" turn echoed in the history above the box',
    },
    {
      verb: 'compact', command: COMPACT, read: CLAUDE_296_COMPACT_MENU_BELOW,
      what: 'the draft "/compact" and the menu with its pointer on /compact drawn under the input box, none above it',
    },
    {
      verb: 'compact', command: COMPACT, idle: CLAUDE_IDLE, read: CLAUDE_COMPACT_BARE,
      what: 'no draft, 2.1.288\'s menu with no pointer and /compact its first row, and the input line "❯" alone',
    },
    {
      verb: 'clear', command: '/clear', idle: CLAUDE_IDLE, read: CLAUDE_CLEAR_BARE,
      what: 'no draft, 2.1.288\'s menu with no pointer and /clear its first row, and the input line "❯" alone',
    },
    {
      // The input line's pointer is below the rule, and is never the menu's.
      verb: 'compact', command: COMPACT, idle: CLAUDE_IDLE, read: CLAUDE_COMPACT_OTHER_FIRST, names: '/autocompact',
      what: 'no draft, the screen\'s only "❯ /compact" its input line, under 2.1.288\'s menu with no pointer and /autocompact first',
    },
  ]) {
    it(`${verb} on Claude Code with ${what}: ${command} taken back, never entered, and refused${names === undefined ? '' : `, naming ${names}`}`, async (t) => {
      const box = await createSandbox(t);
      const bots = await running(box);
      await changeTab(box, (await liveTab(box, bots)).tabId, { screen: idle, nextScreens: screensFor('claude', command, read, idle) });
      const book = await sessionIn(bots, BOT, 'daily');

      const said = assertRefused(await sessionCommand(box, verb));

      assert.deepEqual(await sendsInto(box, bots), [...typed(command), { text: backspaces(command), enter: false }]);
      assert.deepEqual(await sessionIn(bots, BOT, 'daily'), book, 'the book is as it was');
      if (shows !== undefined) assert.ok(said.includes(shows), `the refusal shows the draft the line held, ${shows}, got:\n${said}`);
      if (names !== undefined) {
        assert.ok(timesIn(said, names) >= 2, `the reason names the selected row, ${names}, beside the screen rows it quotes, got:\n${said}`);
      }
    });
  }
});

// ---------------------------------- Codex 0.162.0 and Orca's draft (#516)
//
// Codex 0.162.0 under Orca 1.4.223, as a live probe for #516 showed it
// (helpers/screens.js, the CODEX_162 captures): Orca's read gives the text of
// Codex's input line as `draft`, and the line's row then reads `›` alone. An
// empty line gives no `draft`. The popup for `/new` or `/compact` is the
// command's one row, selected, with the input line right under it and no
// blank row. The intent of #516, as these tests hold it, for clear (`/new`)
// and compact (`/compact`) on Codex:
//
//   - Before the first key: a non-empty `draft` means the user's draft is in
//     the line. Refused, nothing typed at all, and the refusal shows the
//     draft. This holds when the line's row reads `›` alone or the
//     placeholder.
//   - After typing, with a `draft`: it equals the command exactly, and the
//     popup's selected row names the command exactly and is its only command
//     row. Then the return goes in, and the clear or compact goes on as
//     before. On any Codex version: 0.162.0, 0.160.0, or one the rollout does
//     not give.
//   - A draft that is not exactly the command: the typed keys are taken back,
//     one backspace each in one send, no return, and the refusal shows the
//     draft. On 0.160.0 too, whose bare line is taken only with no draft.
//   - The right draft does not excuse a wrong popup: another command
//     selected, two command rows, or none. Taken back and refused.
//   - With no `draft`, the screen is read as before: a bare `›` is taken only
//     on 0.160.0. And 0.162.0's layout, with no blank row, is read the same.
//
// The reads while the command is typed are whileTypingCodex162's: the
// capture for "/", and then the command's row with the draft so far.

/** How Codex's part is played once the return is in, what the kit types after it, and what it answers once it is done. */
const CODEX_ENTERED = {
  clear: {
    command: '/new',
    read: CODEX_162_NEW_READ,
    after: [CODEX_NEW_MENU, CODEX_IDLE],
    when: (sends) => sends.some((one) => one.text === RECORD_LINE),
    then: (box, bots) => hookReports(box, bots, 'sess-new', 'startup'),
    sends: [...typed('/new'), { text: '\r', enter: false }, { text: '\r', enter: false }, { text: RECORD_LINE, enter: true }],
    key: 'cleared',
    answer: { bot: BOT, session: 'daily', harness: 'codex', was: 'sess-daily', now: 'sess-new' },
  },
  compact: {
    command: COMPACT,
    read: CODEX_162_COMPACT_READ,
    after: [CODEX_162_IDLE],
    when: (sends) => sends.some((one) => one.text === '\r'),
    then: async (box) => compactionIn(await recordFileOf(box, 'sess-daily'), 'codex'),
    sends: [...typed(COMPACT), { text: '\r', enter: false }],
    key: 'compacted',
    answer: { bot: BOT, session: 'daily', harness: 'codex', conversation: 'sess-daily', confirmed: true },
  },
};

describe('#516: Codex 0.162.0 and Orca\'s draft, the commands entered, four side by side', SIDE_BY_SIDE, () => {
  for (const verb of VERBS) {
    for (const { start, what } of [
      { start: CODEX_162_DRAFT, what: 'the live read with the draft "hello" and the line\'s row "›" alone' },
      { start: CODEX_162_PLACEHOLDER_DRAFT, what: 'the draft "hello" and the line\'s row showing the placeholder (rebuilt pairing)' },
    ]) {
      test(`#516: ${verb} on Codex 0.162.0 with a draft in its input line before the first key, ${what}: refused, nothing typed into any tab, and the refusal shows the draft`, async (t) => {
        const box = await createSandbox(t);
        const bots = await running(box, { harness: 'codex', cliVersion: '0.162.0' });
        const { command, read } = CODEX_ENTERED[verb];
        await changeTab(box, (await liveTab(box, bots)).tabId, {
          screen: start.screen,
          draft: start.draft,
          nextScreens: [...whileTypingCodex162(command), read, CODEX_162_IDLE],
        });
        const before = await typedEverywhere(box);
        const book = await sessionIn(bots, BOT, 'daily');

        const said = assertRefused(await sessionCommand(box, verb));

        await assertNothingTyped(box, before, 'a draft in the input line');
        assert.ok(said.includes('hello'), `the refusal shows the draft the line holds, hello, got:\n${said}`);
        assert.deepEqual(await sessionIn(bots, BOT, 'daily'), book, 'the book is as it was');
      });
    }
  }

  for (const verb of VERBS) {
    for (const { cliVersion, what } of [
      { cliVersion: '0.162.0', what: 'Codex 0.162.0' },
      { cliVersion: '0.160.0', what: 'Codex 0.160.0' },
      { cliVersion: null, what: 'a Codex whose version its rollout does not give' },
    ]) {
      test(`#516: ${verb} on ${what}, from the 0.162.0 live read: the draft exactly the command and its popup row selected, so it is entered and the ${verb} goes on as before`, async (t) => {
        const box = await createSandbox(t);
        const bots = await running(box, { harness: 'codex', cliVersion });
        const entered = CODEX_ENTERED[verb];
        await changeTab(box, (await liveTab(box, bots)).tabId, {
          screen: CODEX_162_IDLE,
          nextScreens: [...whileTypingCodex162(entered.command), entered.read, ...entered.after],
        });

        const { result, played } = await runPlaying(box, bots, verb, {
          when: entered.when,
          then: () => entered.then(box, bots),
        });

        const answer = answered(result, `the ${verb}`);
        assert.ok(played, `the premise: the return went in and Codex did the ${verb}`);
        assert.deepEqual(await sendsInto(box, bots), entered.sends, 'the command a character a send, its return, and on a clear the "Current checkout" return and the ruled line; nothing taken back');
        assert.deepEqual(answer[entered.key], entered.answer);
      });
    }
  }

  for (const { read, what } of [
    {
      read: { screen: CODEX_NEW_TYPED, draft: '/new' },
      what: 'the draft "/new" under 0.160.0\'s layout, a blank row between the popup and the line (rebuilt pairing)',
    },
    {
      read: CODEX_162_NEW_SHOWN,
      what: 'no draft, 0.162.0\'s layout with the line "› /new" right under the popup row (rebuilt)',
    },
  ]) {
    test(`#516: clear on Codex 0.162.0 with ${what}: /new is entered, and the new conversation is the answer`, async (t) => {
      const box = await createSandbox(t);
      const bots = await running(box, { harness: 'codex', cliVersion: '0.162.0' });
      await changeTab(box, (await liveTab(box, bots)).tabId, {
        screen: CODEX_162_IDLE,
        nextScreens: [...whileTypingCodex162('/new'), read, CODEX_NEW_MENU, CODEX_IDLE],
      });

      const { result, played } = await runPlaying(box, bots, 'clear', {
        when: CODEX_ENTERED.clear.when,
        then: () => CODEX_ENTERED.clear.then(box, bots),
      });

      const answer = answered(result, 'the clear');
      assert.ok(played, 'the premise: the line was typed and the hook reported the new conversation');
      assert.deepEqual(await sendsInto(box, bots), CODEX_ENTERED.clear.sends);
      assert.deepEqual(answer.cleared, CODEX_ENTERED.clear.answer);
    });
  }
});

// The refusals once the command is typed. Side by side, since a check that
// wrongly lets a compact in waits out its 300 s, and a clear its 30 s.
describe('#516: Codex refusals once the command is typed, side by side', { concurrency: true }, () => {
  for (const { verb, cliVersion = '0.162.0', typing = whileTypingCodex162, read, shows, what } of [
    // A draft that is not exactly the command.
    {
      verb: 'clear', read: CODEX_162_NEW_OTHER_DRAFT, shows: 'x/new',
      what: 'the draft "x/new" under the live read\'s popup, /new selected',
    },
    {
      verb: 'compact', read: CODEX_162_COMPACT_OTHER_DRAFT, shows: 'x/compact',
      what: 'the draft "x/compact" under the live read\'s popup, /compact selected',
    },
    {
      verb: 'clear', read: CODEX_162_NEW_SPACE_DRAFT,
      what: 'the draft "/new " with a space after it, under the live read\'s popup',
    },
    {
      verb: 'compact', read: CODEX_162_DRAFT_COMPACT, shows: 'hello/compact',
      what: 'the draft "hello/compact" and no popup, the live read',
    },
    {
      verb: 'clear', cliVersion: '0.160.0', typing: (command) => whileTyping('codex', command), read: { screen: CODEX_NEW_TYPED, draft: 'x/new' }, shows: 'x/new',
      what: 'the draft "x/new" on Codex 0.160.0, its bare line under the /new row as live run 4 showed it',
    },
    {
      verb: 'compact', cliVersion: '0.160.0', typing: (command) => whileTyping('codex', command), read: { screen: CODEX_COMPACT_TYPED, draft: 'x/compact' }, shows: 'x/compact',
      what: 'the draft "x/compact" on Codex 0.160.0, its bare line under the /compact row',
    },
    {
      // The line's row reads the command, and Orca's draft says otherwise.
      verb: 'clear', typing: (command) => whileTyping('codex', command), read: { screen: CODEX_NEW_TYPED_SHOWN, draft: 'x/new' }, shows: 'x/new',
      what: 'the draft "x/new" while the line\'s row reads "› /new" under the /new row',
    },
    // The right draft under a wrong popup.
    {
      verb: 'clear', read: CODEX_162_NEW_OTHER_SELECTED,
      what: 'the draft "/new" and the popup\'s one row /model, selected',
    },
    {
      verb: 'clear', read: CODEX_162_NEW_TWO_ROWS,
      what: 'the draft "/new" and two command rows in the popup, /new selected',
    },
    {
      verb: 'clear', read: CODEX_162_NEW_NO_MENU,
      what: 'the draft "/new" and no popup at all',
    },
    {
      verb: 'clear', cliVersion: '0.160.0', typing: (command) => whileTyping('codex', command), read: { screen: CODEX_NEW_OTHER_SELECTED, draft: '/new' },
      what: 'the draft "/new" on Codex 0.160.0 and its popup\'s one row /model, selected',
    },
    // No draft: a bare line is taken only on 0.160.0.
    {
      verb: 'clear', read: CODEX_162_NEW_READ.screen,
      what: 'no draft, the input line "›" alone right under the /new row: the live read\'s rows with its draft left out',
    },
    {
      verb: 'compact', read: CODEX_162_COMPACT_READ.screen,
      what: 'no draft, the input line "›" alone right under the /compact row: the live read\'s rows with its draft left out',
    },
  ]) {
    const command = CODEX_ENTERED[verb].command;
    it(`#516: ${verb} on Codex ${cliVersion} with ${what}: ${command} taken back, never entered, and refused${shows === undefined ? '' : `, showing ${shows}`}`, async (t) => {
      const box = await createSandbox(t);
      const bots = await running(box, { harness: 'codex', cliVersion });
      await changeTab(box, (await liveTab(box, bots)).tabId, { screen: CODEX_162_IDLE, nextScreens: [...typing(command), read, CODEX_162_IDLE] });
      const book = await sessionIn(bots, BOT, 'daily');

      const said = assertRefused(await sessionCommand(box, verb));

      assert.deepEqual(await sendsInto(box, bots), [...typed(command), { text: backspaces(command), enter: false }], 'the command a character a send, then exactly those taken back in one send, and no return');
      assert.deepEqual(await sessionIn(bots, BOT, 'daily'), book, 'the book is as it was');
      if (shows !== undefined) assert.ok(said.includes(shows), `the refusal shows the draft the line held, ${shows}, got:\n${said}`);
    });
  }
});

// Codex 0.162.0's "Where should the new conversation run?" (#516, the second
// live run). Codex 0.162.0 renamed its first choice "1. Use current Git
// worktree" (helpers/screens.js CODEX_162_NEW_MENU, a capture). The
// architect's ruling, as these tests hold it:
//
//   - With the selection on exactly that row, "› 1. Use current Git worktree
//     Keep using the current working directory", the whole row, the kit
//     answers it as it answers "1. Current checkout": one `\r`. Then the clear
//     goes on as before: the ruled line, and the new conversation in the book.
//   - The kit never chooses "Create new Git worktree". With the selection on
//     it, or on a row that only looks like row 1 (another description, or
//     none), it sends Esc, refuses, and types nothing more.
//   - The 0.160.0 question with "1. Current checkout" is answered as before:
//     the tests further up.
//
// The clear up to the question is the 0.162.0 live read of `/new` with its
// draft, which the tests above enter.

test('#516: clear on Codex 0.162.0 whose question has its selection on "1. Use current Git worktree", the live capture: one return takes it, then the ruled line, and the new conversation is the answer', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box, { harness: 'codex', cliVersion: '0.162.0' });
  await changeTab(box, (await liveTab(box, bots)).tabId, {
    screen: CODEX_162_IDLE,
    nextScreens: [...whileTypingCodex162('/new'), CODEX_162_NEW_READ, CODEX_162_NEW_MENU, CODEX_162_IDLE],
  });

  const { result, played } = await runPlaying(box, bots, 'clear', {
    when: CODEX_ENTERED.clear.when,
    then: () => CODEX_ENTERED.clear.then(box, bots),
  });

  const answer = answered(result, 'the clear');
  assert.ok(played, 'the premise: the line was typed and the hook reported the new conversation');
  assert.deepEqual(await sendsInto(box, bots), [
    ...typed('/new'),
    { text: '\r', enter: false },
    { text: '\r', enter: false },
    { text: RECORD_LINE, enter: true },
  ], '/new as text, its return, the return that takes "Use current Git worktree", and the ruled line, once, with a return');
  assert.deepEqual(answer.cleared, CODEX_ENTERED.clear.answer);
  assert.equal((await sessionIn(bots, BOT, 'daily')).session, 'sess-new', 'the book holds the new conversation');
});

// The gap between the choice and its description is column padding: row 2 of
// the capture has three spaces there. So other padding, with the choice and
// the description word for word as captured, is the same row, and taken the
// same way.
for (const { menu, spaces } of [
  { menu: CODEX_162_NEW_MENU_PADDED_3, spaces: 'three' },
  { menu: CODEX_162_NEW_MENU_PADDED_8, spaces: 'eight' },
]) {
  test(`#516: clear on Codex 0.162.0 whose question has its selection on "1. Use current Git worktree" with ${spaces} spaces before "Keep using the current working directory" (reconstruction: only the padding changed): one return takes it, then the ruled line, and the new conversation is the answer`, async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box, { harness: 'codex', cliVersion: '0.162.0' });
    await changeTab(box, (await liveTab(box, bots)).tabId, {
      screen: CODEX_162_IDLE,
      nextScreens: [...whileTypingCodex162('/new'), CODEX_162_NEW_READ, menu, CODEX_162_IDLE],
    });

    const { result, played } = await runPlaying(box, bots, 'clear', {
      when: CODEX_ENTERED.clear.when,
      then: () => CODEX_ENTERED.clear.then(box, bots),
    });

    const answer = answered(result, 'the clear');
    assert.ok(played, 'the premise: the line was typed and the hook reported the new conversation');
    assert.deepEqual(await sendsInto(box, bots), [
      ...typed('/new'),
      { text: '\r', enter: false },
      { text: '\r', enter: false },
      { text: RECORD_LINE, enter: true },
    ], '/new as text, its return, the return that takes "Use current Git worktree", and the ruled line, once, with a return');
    assert.deepEqual(answer.cleared, CODEX_ENTERED.clear.answer);
    assert.equal((await sessionIn(bots, BOT, 'daily')).session, 'sess-new', 'the book holds the new conversation');
  });
}

// Side by side, since a kit that wrongly answers one of these goes on to its
// ruled line and waits out its 30 s for the book.
describe('#516: Codex 0.162.0\'s question with its selection anywhere but on "1. Use current Git worktree" as captured, side by side', { concurrency: true }, () => {
  for (const { menu, what } of [
    { menu: CODEX_162_NEW_MENU_ON_TWO, what: 'on "2. Create new Git worktree" (reconstruction: the pointer moved)' },
    { menu: CODEX_162_NEW_MENU_OTHER_WORDS, what: 'on "1. Use current Git worktree" with another description (reconstruction, made-up words)' },
    { menu: CODEX_162_NEW_MENU_NO_WORDS, what: 'on "1. Use current Git worktree" with no description (reconstruction)' },
  ]) {
    it(`#516: clear on Codex 0.162.0 with the selection ${what}: Esc, a refusal, and never a 2, a return or the line`, async (t) => {
      const box = await createSandbox(t);
      const bots = await running(box, { harness: 'codex', cliVersion: '0.162.0' });
      await changeTab(box, (await liveTab(box, bots)).tabId, {
        screen: CODEX_162_IDLE,
        nextScreens: [...whileTypingCodex162('/new'), CODEX_162_NEW_READ, menu, CODEX_162_IDLE],
      });
      const book = await sessionIn(bots, BOT, 'daily');

      assertRefused(await sessionCommand(box, 'clear'));

      assert.deepEqual(await sendsInto(box, bots), [
        ...typed('/new'),
        { text: '\r', enter: false },
        { text: '\x1b', enter: false },
      ], 'the question is backed out of with Esc, and nothing picks a worktree');
      assert.deepEqual(await sessionIn(bots, BOT, 'daily'), book, 'the book is as it was');
    });
  }
});

// ---------------------------------------------------- the waits that run out
//
// Each of these costs its whole wait in real time, so they run side by side.

describe('the waits that run out, side by side', { concurrency: true }, () => {
  it('a session Orca reports busy for the whole 30 s: refused after waiting about that long, saying it is busy, and nothing typed', async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box);
    await box.orca.set({ waitIdle: 'busy' });
    const before = await typedEverywhere(box);

    const started = Date.now();
    const result = await sessionCommand(box, 'clear');
    const took = Date.now() - started;

    const said = assertRefused(result);
    assert.match(said, /busy/i, `it says the session is busy, got:\n${said}`);
    assert.match(said, /tui-idle/, `and names its signal, Orca's tui-idle (the ruling after live run 3), got:\n${said}`);
    await assertNothingTyped(box, before, 'busy throughout');
    assert.ok(took >= 25_000, `it waited for the session, up to 30 s, before refusing; it took ${took} ms`);
    assert.ok(took < 90_000, `and the wait is bounded; it took ${took} ms`);
    assert.equal((await sessionIn(bots, BOT, 'daily')).session, 'sess-daily', 'the book is as it was');
  });

  it('a Claude Code tab Orca calls idle while its spinner row says it is at work: refused as busy, naming the row, nothing typed', async (t) => {
    // Claude Code 2.1.288 shows no "esc to interrupt"; its at-work marker is
    // its spinner row (the ruling after live run 3).
    const box = await createSandbox(t);
    const bots = await running(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { screen: CLAUDE_AT_WORK });
    const before = await typedEverywhere(box);

    const said = assertRefused(await sessionCommand(box, 'clear'));

    assert.match(said, /busy/i, `it says the session is busy, got:\n${said}`);
    assert.ok(said.includes('Nucleating'), `and names its signal, the at-work row, got:\n${said}`);
    await assertNothingTyped(box, before, 'the spinner row on screen');
  });

  it('a Codex Orca calls idle while its screen says "esc to interrupt": refused as busy, nothing typed', async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box, { harness: 'codex' });
    await changeTab(box, (await liveTab(box, bots)).tabId, { screen: CODEX_WORKING });
    const before = await typedEverywhere(box);

    const said = assertRefused(await sessionCommand(box, 'clear'));

    assert.match(said, /busy/i, `it says the session is busy, got:\n${said}`);
    assert.ok(said.includes('esc to interrupt'), `and names its signal, the at-work row (the ruling after live run 3), got:\n${said}`);
    await assertNothingTyped(box, before, 'esc to interrupt on screen');
  });

  it('a Claude Code tab Orca calls idle while its screen says "Esc to interrupt", in another case: compact refused as busy, nothing typed', async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { screen: CLAUDE_WORKING });
    const before = await typedEverywhere(box);

    const said = assertRefused(await sessionCommand(box, 'compact'));

    assert.match(said, /busy/i, `it says the session is busy, got:\n${said}`);
    await assertNothingTyped(box, before, 'Esc to interrupt on screen');
  });

  it('a question of the harness\'s own on screen for the whole 30 s, Orca calling it idle: refused, saying a question is up, nothing typed', async (t) => {
    // Codex's update offer, whose default is "Update now" (#329).
    const box = await createSandbox(t);
    const bots = await running(box, { harness: 'codex' });
    await changeTab(box, (await liveTab(box, bots)).tabId, { screen: CODEX_UPDATE_OFFER });
    const before = await typedEverywhere(box);

    const said = assertRefused(await sessionCommand(box, 'clear'));

    assert.match(said, /question/i, `it says a question is waiting, got:\n${said}`);
    await assertNothingTyped(box, before, 'a question on screen');
  });

  // #491: a question drawn above the input box, for clear and for compact.
  for (const verb of VERBS) {
    it(`Claude Code 2.1.289's Teach list above the input box for the whole 30 s, Orca calling it idle: ${verb} refused, saying a question is up, nothing typed`, async (t) => {
      const box = await createSandbox(t);
      const bots = await running(box);
      await changeTab(box, (await liveTab(box, bots)).tabId, { screen: CLAUDE_TEACH_LIST });
      const before = await typedEverywhere(box);

      const said = assertRefused(await sessionCommand(box, verb));

      assert.match(said, /question/i, `it says a question is waiting, got:\n${said}`);
      await assertNothingTyped(box, before, `${verb} with the Teach list on screen`);
      assert.equal((await sessionIn(bots, BOT, 'daily')).session, 'sess-daily', 'the book is as it was');
    });
  }

  // #502: the panel of feedback drafts on screen the whole time, for clear
  // and for compact. Not a key goes in: no character, no Esc, no return, and
  // no backspace, since nothing was typed.
  for (const verb of VERBS) {
    it(`#502: the panel of feedback drafts above Claude Code's input box, Orca calling it idle: ${verb} refused, nothing typed, and the refusal names the panel and what clears it`, async (t) => {
      const box = await createSandbox(t);
      const bots = await running(box);
      await changeTab(box, (await liveTab(box, bots)).tabId, { screen: CLAUDE_FEEDBACK_PANEL });
      const before = await typedEverywhere(box);

      const said = assertRefused(await sessionCommand(box, verb));

      await assertNothingTyped(box, before, `${verb} with the panel on screen`);
      assertNamesThePanel(said, CLAUDE_FEEDBACK_PANEL, verb);
      assert.equal((await sessionIn(bots, BOT, 'daily')).session, 'sess-daily', 'the book is as it was');
    });
  }

  it('a tab Orca reports blocked for the whole 30 s: refused, nothing typed', async (t) => {
    const box = await createSandbox(t);
    await running(box);
    await box.orca.set({ waitIdle: 'blocked', blockedReason: 'agent-permission-prompt' });
    const before = await typedEverywhere(box);

    const said = assertRefused(await sessionCommand(box, 'clear'));

    assert.ok(/question/i.test(said) || said.includes('agent-permission-prompt'), `it says something is waiting to be answered, got:\n${said}`);
    await assertNothingTyped(box, before, 'blocked');
  });

  it('a clear entered whose new conversation never reaches the book in 30 s: refused, saying /clear went in and to look at the tab', async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: screensFor('claude', '/clear', CLAUDE_CLEAR_TYPED, CLAUDE_IDLE) });

    const said = assertRefused(await sessionCommand(box, 'clear'));

    assert.deepEqual(await sendsInto(box, bots), [...typed('/clear'), { text: '\r', enter: false }], 'the premise: the command was entered');
    assert.ok(said.includes('/clear'), `it says what was entered, got:\n${said}`);
    assert.match(said, /\bconversation\b/i, `it says the book has no new conversation, got:\n${said}`);
    assert.match(said, /\btab\b/i, `and to look at the tab, got:\n${said}`);
    assert.equal((await sessionIn(bots, BOT, 'daily')).session, 'sess-daily', 'the book is as it was');
  });
});

// ---------------------------------------------------- the review of PR #466
//
// Four gaps the review found. Each is the requirement as it stood, now with a
// test of its own:
//
//   - The 30 s wait for an idle session is a cutoff, not a count of looks, as
//     #421 ruled for the list line: a look that finds the session idle but
//     answers after the 30 s are up is too late, and nothing is typed.
//   - Every call the command makes to Orca is bounded. A screen read Orca does
//     not answer in time is "cannot tell": before anything is typed, it is no
//     reason to type; after the command is typed, the screen check cannot
//     pass, so the command is taken back, as for any screen that fails it. It
//     never holds the command for as long as Orca stays quiet.
//   - "A compaction made after the command began" means after /compact was
//     typed: one written while the kit still waits for the session to go idle
//     does not confirm it.
//   - The harness's record can be larger than one string holds (a live Codex
//     rollout of 1.28 GB, #396). A compaction after such a stretch still
//     confirms the compact.

/** How many calls of `command` the fake Orca has answered so far. */
const callsOf = async (box, command) => orcaCallsOf(await box.orca.calls(), command).length;

describe('the review of PR #466: Orca slow or quiet, side by side', { concurrency: true }, () => {
  it('a look that finds the session idle only after the 30 s are up is too late: refused, and nothing typed', async (t) => {
    // Every tui-idle wait answers 3 s late, and the first twelve say busy, so
    // the look that finds the session idle starts at least 36 s in, whatever
    // the kit does between looks. Each answer comes well inside any bound the
    // kit could give a call, so the looks are answers, not "cannot tell".
    const box = await createSandbox(t);
    const bots = await running(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: screensFor('claude', '/clear', CLAUDE_CLEAR_TYPED, CLAUDE_IDLE) });
    await box.orca.set({ waitIdle: [...Array(12).fill('busy'), true], hang: { command: 'terminal wait', ms: 3000 } });
    const before = await typedEverywhere(box);

    assertRefused(await sessionCommand(box, 'clear'));

    await assertNothingTyped(box, before, 'idle only after the 30 s');
    assert.equal((await sessionIn(bots, BOT, 'daily')).session, 'sess-daily', 'the book is as it was');
  });

  it('a screen Orca does not read for 90 s before anything is typed is "cannot tell": refused within a minute, and nothing typed', async (t) => {
    // The review's probe, made longer than the whole wait: every screen read
    // answers 90 s late. The session is otherwise idle.
    const box = await createSandbox(t);
    const bots = await running(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: screensFor('claude', '/clear', CLAUDE_CLEAR_TYPED, CLAUDE_IDLE) });
    await box.orca.set({ hang: { command: 'terminal read', ms: 90_000 } });
    const before = await typedEverywhere(box);

    const started = Date.now();
    const result = await sessionCommand(box, 'clear');
    const took = Date.now() - started;

    const said = assertRefused(result);
    assert.match(said, /\b(?:can(?:not|'t|’t)|could(?: not|n't|n’t)) tell\b/i, `it names its signal, that it cannot tell (the ruling after live run 3), got:\n${said}`);
    await assertNothingTyped(box, before, 'a screen Orca does not read');
    assert.ok(took < 60_000, `a quiet Orca does not hold the command past its 30 s wait and a bounded call; it took ${took} ms`);
  });

  // The review's probe itself: one screen read answered 50 s late, the rest
  // at once, on an idle session. Which read the kit makes first is its own
  // business, so each of the first three takes its turn at being the late one.
  // Whatever the kit then does (clears, or refuses), it types nothing after
  // the 30 s are up, and the late read does not hold it: a read is bounded.
  // The harness is played as ever, so a kit that goes on can finish.
  for (const nth of [1, 2, 3]) {
    it(`one screen read, the ${['first', 'second', 'third'][nth - 1]}, answered 50 s late: nothing is typed after the 30 s are up, and the command is not held by it`, async (t) => {
      const box = await createSandbox(t);
      const bots = await running(box);
      const { tabId } = await liveTab(box, bots);
      await changeTab(box, tabId, { nextScreens: screensFor('claude', '/clear', CLAUDE_CLEAR_TYPED, CLAUDE_IDLE) });
      await box.orca.set({ hang: { command: 'terminal read', ms: 50_000, after: nth - 1, times: 1, from: await callsOf(box, 'terminal read') } });

      const started = Date.now();
      let finished = false;
      const run = sessionCommand(box, 'clear', { flags: ['--json'] });
      run.then(() => { finished = true; });
      let typedAt;
      let played = false;
      while (!finished) {
        const sends = await sendsInto(box, bots);
        if (typedAt === undefined && sends.length > 0) typedAt = Date.now() - started;
        if (!played && sends.some((one) => one.text === '\r')) {
          await hookReports(box, bots, 'sess-cleared', 'clear');
          played = true;
        }
        await sleep(50);
      }
      const result = await run;
      const took = Date.now() - started;

      assert.ok(typedAt === undefined || typedAt < 40_000, `anything typed is typed inside the 30 s wait; the first send came ${typedAt} ms in:\n${result.stdout}${result.stderr}`);
      assert.ok(took < 45_000, `one late read does not hold the command; it took ${took} ms:\n${result.stdout}${result.stderr}`);
    });
  }

  it('a screen Orca stops reading once the first character is typed is "cannot tell": that character taken back, nothing entered, refused within a minute', async (t) => {
    // Screen reads answer at once until the kit's first send, and 90 s late
    // from then on: the look before typing sees an idle session, and the
    // gate's look before the second character cannot read the screen. With
    // one character a send (the ruling of 2026-10-03), the gate stops there,
    // and the one character typed is taken back.
    const box = await createSandbox(t);
    const bots = await running(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: screensFor('claude', '/clear', CLAUDE_CLEAR_TYPED, CLAUDE_IDLE) });
    await box.orca.set({ hang: { command: 'terminal read', ms: 90_000, since: 'terminal send', sinceFrom: await callsOf(box, 'terminal send') } });

    const started = Date.now();
    const result = await sessionCommand(box, 'clear');
    const took = Date.now() - started;

    assertRefused(result);
    assert.deepEqual(
      await sendsInto(box, bots),
      [{ text: '/', enter: false }, { text: backspaces('/'), enter: false }],
      'a screen that cannot be read stops the typing: what was typed is taken back, and no return is sent',
    );
    assert.ok(took < 60_000, `a quiet Orca does not hold the command; it took ${took} ms`);
    assert.equal((await sessionIn(bots, BOT, 'daily')).session, 'sess-daily', 'the book is as it was');
  });

  it('Claude Code with a draft in its input line, and the third key\'s send not answered in time and never applied: the take-back is the two keys Orca answered for, not one more, so the draft keeps every character', async (t) => {
    // From the review of #480: a send Orca does not answer in time may have
    // gone in, and the naming counts its key when it takes back, because a
    // Codex input line was empty before its first key. Claude Code's may hold
    // a draft (the tests above), so here a key Orca did not answer for is not
    // counted: a backspace too many would eat the draft's last character. The
    // third key, `l`, is held 90 s and not applied.
    const box = await createSandbox(t);
    const bots = await running(box);
    const draft = CLAUDE_IDLE.map((row) => (row.startsWith('❯ ') ? '❯\u00a0fix the flaky test' : row));
    await changeTab(box, (await liveTab(box, bots)).tabId, { screen: draft, nextScreens: screensFor('claude', '/clear', CLAUDE_CLEAR_AFTER_DRAFT, CLAUDE_IDLE) });
    await box.orca.set({ hang: { command: 'terminal send', ms: 90_000, from: await callsOf(box, 'terminal send'), after: 2, times: 1 } });

    const started = Date.now();
    const result = await sessionCommand(box, 'clear');
    const took = Date.now() - started;

    assertRefused(result);
    assert.ok(took < 60_000, `the late answer does not hold the command; it took ${took} ms`);
    assert.deepEqual(
      await sendsInto(box, bots),
      [...typed('/c'), { text: backspaces('/c'), enter: false }],
      'the two keys Orca answered for, then exactly two backspaces in one send: none for the key it did not answer for',
    );
    assert.equal((await sessionIn(bots, BOT, 'daily')).session, 'sess-daily', 'the book is as it was');
  });
});

test('a compaction written while the kit still waits for the session to go idle does not confirm the compact; the one after the return does', async (t) => {
  // Orca says busy on the first four looks. Before it answers the first of
  // them, the fake writes a compaction into the conversation's record, dated
  // then: after the command began, before /compact was typed. Then, once the
  // return has gone in, the test waits 10 s and writes the real one. A kit
  // that took the early one would have answered by then.
  const box = await createSandbox(t);
  const bots = await running(box);
  await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: screensFor('claude', COMPACT, CLAUDE_COMPACT_TYPED, CLAUDE_IDLE) });
  const record = await recordFileOf(box, 'sess-daily');
  const early = "require('node:fs').appendFileSync(process.argv[1], JSON.stringify({ type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', sessionId: 'sess-daily', timestamp: new Date().toISOString(), compactMetadata: { trigger: 'auto', preTokens: 81522 } }) + '\\n');";
  await box.orca.set({
    waitIdle: ['busy', 'busy', 'busy', 'busy', true],
    runDuring: { command: 'terminal wait', argv: [process.execPath, '-e', early, record], on: (await callsOf(box, 'terminal wait')) + 1 },
  });

  let finished = false;
  const run = sessionCommand(box, 'compact', { flags: ['--json'] });
  run.then(() => { finished = true; });
  const until = Date.now() + 25_000;
  while (!finished && Date.now() < until && !(await sendsInto(box, bots)).some((one) => one.text === '\r')) await sleep(50);
  await sleep(10_000);
  const answeredEarly = finished;
  await compactionIn(record, 'claude');
  const result = await run;

  const ran = await box.orca.ranDuring();
  assert.equal(ran.length, 1, `the premise: the early compaction was written during the busy looks, got: ${JSON.stringify(ran)}`);
  assert.equal(ran[0].status, 0, `the premise: and written without trouble: ${ran[0].stderr}`);
  assert.deepEqual(await sendsInto(box, bots), [...typed(COMPACT), { text: '\r', enter: false }], 'the premise: /compact was typed and entered after the busy looks');
  assert.equal(answeredEarly, false, `the compact must not be confirmed by a compaction written before /compact was typed, but it had answered before the later one was written:\n${result.stdout}${result.stderr}`);
  const answer = answered(result, 'the compact');
  assert.deepEqual(answer.compacted, { bot: BOT, session: 'daily', harness: 'claude', conversation: 'sess-daily', confirmed: true });
});

test('a compaction after a stretch of the record too large for one string still confirms the compact', async (t) => {
  // Codex rollouts of 1.28 and 1.56 GB were seen live (#396). Here the
  // conversation's rollout carries 1.1 GiB of NUL bytes after its first line,
  // one "line" longer than any string can hold, written as a sparse stretch
  // that takes no room on disk; then a newline. The compaction comes after the
  // return, as the harness writes it.
  const box = await createSandbox(t);
  const bots = await running(box, { harness: 'codex' });
  await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: screensFor('codex', COMPACT, CODEX_COMPACT_TYPED, CODEX_IDLE) });
  const record = await recordFileOf(box, 'sess-daily');
  await truncate(record, (await stat(record)).size + Math.round(1.1 * 2 ** 30));
  await appendFile(record, '\n');

  const { result, played } = await runPlaying(box, bots, 'compact', {
    when: (sends) => sends.some((one) => one.text === '\r'),
    then: () => compactionIn(record, 'codex'),
  });

  assert.ok(played, 'the premise: the return was sent and the compaction written');
  const answer = answered(result, 'the compact');
  assert.deepEqual(answer.compacted, { bot: BOT, session: 'daily', harness: 'codex', conversation: 'sess-daily', confirmed: true });
});
