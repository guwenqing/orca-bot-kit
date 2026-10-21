// `obk session clear` on a Pi session (#663, part of #547): the kit types
// `/new` into the Pi tab with the care it takes on Claude Code and Codex, and
// the book confirms the clear.
//
//   obk session clear --bots <path> --bot <bot> --session <name> [--json]
//
// The requirement, with the architect's rulings, as these tests hold it:
//
//   - Every check the clear makes on Claude Code and Codex holds on Pi too:
//     the refusals before anything is typed (a paused session, a tab with its
//     shell in front, a tab where Orca names another agent); the wait of up to
//     30 s for the session to be idle with nothing to answer on its screen
//     (Pi's selector foot counts as a question, #659); no draft; the typing
//     gate before each character; one character a send, 100 ms or more
//     between sends; on any stop, exactly the characters typed taken back, that
//     many backspaces (\x7f) in one send; the return as a send of its own
//     (`\r`, no --enter); and the confirmation by the book: within 30 s it
//     holds a conversation id for the session other than the one before.
//     `--json` answers `{ bots, cleared: { bot, session, harness: 'pi', was,
//     now } }`. None in 30 s: non-zero, saying the command went in, the book
//     has no new conversation, and to look at the tab.
//   - The command typed on Pi is `/new`. Nothing is typed after its return:
//     no line like Codex's record line, no answer to Codex's "Where should the
//     new conversation run?".
//   - Pi's screen (helpers/screens.js, the Pi screens, RECONSTRUCTIONS from
//     Pi 1.3.0's code, not seen through Orca yet): the chat, then the input
//     box (a top rule, the editor's row, a bottom rule), then BELOW it the
//     slash menu when open, then Pi's footer. The checks on it:
//       - Before the first character: no draft from Orca, and the editor's row
//         between the two rules blank. Otherwise refused, nothing typed, and
//         the refusal says what the line holds.
//       - Busy: Pi draws its status into the TOP rule of its input box,
//         `── <spinner> <message> ───…`, and the message can be anything:
//         usually `Working` with no hint after it, or `Working (escape to
//         interrupt)`, `Compacting context... (escape to cancel)`, a message
//         cut short at a narrow width, or an extension's own words. So a top
//         rule that holds any text besides its rule characters and Pi's scroll
//         label is Pi at work: waited out, and refused at 30 s with nothing
//         typed. The same row between characters stops the typing and takes
//         back what was typed. Not at work: a top rule of `─` alone, or of `─`
//         and the scroll label ` ↑ <n> more ` alone (a long draft; the bottom
//         rule may carry ` ↓ <n> more `). A status beside the scroll label is
//         at work. The startup help's
//         `escape to interrupt` in the chat is no sign of work. (The first
//         version of this file took only a bracketed `(<key> to interrupt)` or
//         `(<key> to cancel)` for work, which missed Pi's usual row: the
//         review of #663, checked in Pi 1.3.0's code.)
//       - The input box: its bottom rule is the lowest row that is a rule (`─`
//         alone, or with a scroll label); its top rule is the nearest row
//         above it that is a rule of the same full width (starts `──`, ends
//         `─`, exactly as long as the bottom rule). Every row between them is
//         an editor row, whatever it starts with, `─` included; a row that
//         starts with `─` in the chat above the box is no rule of it. With no
//         such pair, nothing is typed, and the refusal says the screen shows
//         no input box. (The review's second finding: a looser reading took
//         an editor row `─ a draft of the user` for the top rule.)
//       - Wide characters (the review of 5455aa6): Pi lays its rows out by
//         terminal columns, so a status with an emoji, CJK characters or a
//         combining mark fills the full width with another count of
//         characters than the bottom rule. The kit does not measure columns.
//         And Pi frames some command output in the chat (/hotkeys,
//         /changelog) with plain full-width rules, as long as the box's rules
//         (the review of b2a0bde). So the kit walks up from the bottom rule
//         over the rows that start `──` and end `─`:
//           1. The first one as long as the bottom rule is the top rule; Pi is
//              at work when it holds words besides `─` and the scroll label.
//              Rows above it never count.
//           2. Before that, one of another length whose words hold a
//              character that is not ASCII is a status: Pi is at work.
//           3. Before that, one of another length whose words are all ASCII
//              is an editor row (an ASCII status always fills the width), and
//              the walk goes on.
//           4. No top rule and no status: no input box, not at work.
//         At work means as above: waited out, refused as busy at 30 s,
//         nothing typed, and the typing gate calls the tab not idle (skills
//         build types no `/reload`). D3 (a short pure rule) and a lone
//         `── a draft ──` with no top rule are no input box.
//       - After `/new`, before the space: the editor's row reads exactly
//         `/new` (or Orca's draft does), and the menu row below the bottom rule
//         that starts with `→` has `new` as its first word. Otherwise the four
//         characters are taken back in one send, no space, no return, and the
//         refusal shows the screen's rows.
//   - The space (#673, as #671 did for `/compact`). Pi 1.3.0 redraws its menu
//     after each key, asynchronously, and a list drawn for an earlier key,
//     `/n` say, can still be up with `new` selected once `/new` is in: Return
//     then applies that row to the old prefix, and Pi submits a wrong line
//     such as `/nnew`. A space closes the menu, since `new` takes no argument
//     (seen in Orca: with `/new ` the editor's row reads `/new` and no menu row
//     shows), and Return with no menu submits the line trimmed, `/new`. So:
//       1. Once `/new` passes the check above, one space, a send of its own,
//          after the same look through the typing gate as each character, 100
//          ms or more after the `w`. Orca's tui-idle alone not answering ok
//          does not stop it (an open menu can stop tui-idle answering ok).
//       2. Then the return, only when the editor's row reads `/new` once
//          trimmed (or Orca's draft does, the row blank) and no menu row below
//          the box starts `→`. A list that closes within the kit's screen wait
//          passes. A menu that stays, a line that reads anything else, Pi at
//          work, a question, or a stop at the gate: no return, all five
//          characters taken back in one send of five backspaces, and the
//          refusal says why (the menu and its selected row, or what the line
//          reads after the space).
//       3. Claude Code's `/clear` and Codex's `/new` get no space: typed and
//          entered as before.
//   - The architect's addition A: Pi's at-work row is part of the kit's shared
//     screen check, and counts only in a tab where Orca names the agent pi,
//     as Pi's selector foot does (#659). The same row on a Claude Code or a
//     Codex screen changes nothing. And `obk skills build` types no `/reload`
//     into a Pi tab whose screen shows that row, even when Orca's tui-idle
//     answers ok: the session is reported busy, as when Orca calls it busy.
//   - `obk session compact` on Pi is as it was: test/pi-compact.test.js.
//   - No command, option or environment setting is added to the core for
//     these tests: the screens are in helpers/screens.js.
//
// How Pi is played here. The fake Orca types nothing anywhere. Each send into
// the Pi tab can move its screen on (`nextScreens`, helpers/fake-orca.js), so
// the screens Pi would show as `/new` and the space are typed and the line is
// entered are given in order.
// Pi reports the new conversation at once, through the kit's own extension
// (#662): the test plays that as Pi would, running the kit's
// src/pi-record.js under a fake Pi (helpers/pi-extension.js) with the new id
// and reason `new`, once the return was sent. A screen that changes on its
// own, while the kit waits before typing, is the fake's `thenScreen`: it
// answers the next `readsBeforeThen` reads, then the screen after it.
//
// How the wait is modelled, as in test/session-clear.test.js: the fake Orca
// keeps no clock, so a wait that runs out costs the full 30 s of real time.
// Those tests are few, and run side by side.
//
// Every expected value comes from the requirement: the keys, the words on
// screen, the JSON's shape. Every run is in the sandbox (helpers/cli.js), with
// the fake Orca and a fake `pi` (helpers/pi.js); nothing here reaches the real
// Orca, the real `pi` or the real ~/.pi.

import assert from 'node:assert/strict';
import { realpath } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, it } from 'node:test';

import {
  botHomeOf,
  conversationOnRecord,
  createSandbox,
  orcaCallsOf,
  orcaCommand,
  orcaFlag,
  recordSession,
  sentInto,
  sessionIn,
  tabsOfBot,
} from './helpers/cli.js';
import { fakePi } from './helpers/pi.js';
import { runPiExtension } from './helpers/pi-extension.js';
import {
  CLAUDE_CLEAR_TYPED,
  CLAUDE_IDLE,
  CODEX_IDLE,
  CODEX_NEW_MENU,
  CODEX_NEW_TYPED,
  PI_DASH_DRAFT,
  PI_DASH_DRAFT_TWO_DASH_ROWS,
  PI_DASH_DRAFT_TWO_ROWS,
  PI_DASHES_DRAFT,
  PI_DRAFT,
  PI_IDLE,
  PI_LONG_DRAFT,
  PI_LONG_DRAFT_LEFT,
  PI_LONG_DRAFT_ROWS,
  PI_LONG_DRAFT_WORKING,
  PI_IDLE_AFTER_NEW,
  PI_IDLE_NO_CURSOR,
  PI_MODEL_SELECTOR,
  PI_NEW_DRAFT_KEYS_SWAPPED,
  PI_NEW_KEYS_SWAPPED,
  PI_NEW_MENU_ABOVE,
  PI_NEW_NO_MENU,
  PI_NEW_OTHER_SELECTED,
  PI_NEW_SPACED,
  PI_NEW_SPACED_AS_SEEN,
  PI_NEW_SPACED_AT_WORK,
  PI_NEW_SPACED_DRAFT_SWAPPED,
  PI_NEW_SPACED_IN_DRAFT,
  PI_NEW_SPACED_KEYS_SWAPPED,
  PI_NEW_SPACED_STALE,
  PI_NEW_SPACED_STALE_IN_DRAFT,
  PI_NEW_SPACED_STALE_NAME,
  PI_NEW_SPACED_STALE_ON_NEW,
  PI_NEW_STALE_ON_NEW,
  PI_NEW_TYPED,
  PI_NEW_TYPED_IN_DRAFT,
  PI_RULED_DRAFT,
  PI_SHORT_TOP,
  PI_SUMMARY_IN_CHAT,
  PI_WORKING,
  PI_IDLE_DIVIDED,
  PI_RULED_DRAFT_NO_TOP,
  PI_WORKING_CJK,
  PI_WORKING_CJK_DIVIDED,
  PI_WORKING_COMBINING,
  PI_WORKING_COMBINING_DIVIDED,
  PI_WORKING_CUT,
  PI_WORKING_DASHES_IN_EDITOR,
  PI_WORKING_EMOJI,
  PI_WORKING_EMOJI_DIVIDED,
  PI_WORKING_RULE,
  piAtWork,
  piBusyWith,
  whileTyping,
  whileTypingPi,
} from './helpers/screens.js';
import { addSkills, botYamlOf } from './helpers/skills.js';

const BOT = 'pi-bot';

// Pi's status in wide or combining characters (the review of 5455aa6): each
// top rule fills the bottom rule's 120 columns, with the code points Pi 1.3.0's
// renderer gave at that width. `names` is the status the refusal shows.
const WIDE_STATUSES = [
  { screen: PI_WORKING_EMOJI, codePoints: 119, names: '⠋ Reading 🔎', what: 'an extension\'s message with an emoji, "── ⠋ Reading 🔎 ──…", 119 code points in 120 columns' },
  { screen: PI_WORKING_CJK, codePoints: 116, names: '⠋ 正在处理', what: 'an extension\'s message in CJK characters, "── ⠋ 正在处理 ──…", 116 code points in 120 columns' },
  { screen: PI_WORKING_COMBINING, codePoints: 121, names: '⠋ Cafe\u0301', what: 'an extension\'s message with a combining acute, "── ⠋ Café ──…", 121 code points in 120 columns' },
];

// The same statuses under a chat that holds Pi's plain full-width dividers
// (/hotkeys, /changelog; the review of b2a0bde): a divider as long as the
// bottom rule sits above each status, and is no top rule.
const WIDE_STATUSES_DIVIDED = [
  { screen: PI_WORKING_EMOJI_DIVIDED, codePoints: 119, names: '⠋ Reading 🔎', what: 'an extension\'s message with an emoji, "── ⠋ Reading 🔎 ──…", under a full-width divider in the chat' },
  { screen: PI_WORKING_CJK_DIVIDED, codePoints: 116, names: '⠋ 正在处理', what: 'an extension\'s message in CJK characters, "── ⠋ 正在处理 ──…", under a full-width divider in the chat' },
  { screen: PI_WORKING_COMBINING_DIVIDED, codePoints: 121, names: '⠋ Cafe\u0301', what: 'an extension\'s message with a combining acute, "── ⠋ Café ──…", under a full-width divider in the chat' },
];

/**
 * The premise of a wide-character case: its top rule has the code points the
 * review measured, its bottom rule 120, and, under a divided chat, a row of
 * `─` alone as long as the bottom rule above the status.
 */
function assertWidePremise(screen, what) {
  const wide = [...WIDE_STATUSES, ...WIDE_STATUSES_DIVIDED].find((entry) => entry.screen === screen);
  if (wide === undefined) return;
  const top = screen.find((row) => row.startsWith('── ⠋'));
  const bottom = screen.findLast((row) => /^─+$/.test(row));
  assert.equal([...top].length, wide.codePoints, `the premise (${what}): the top rule's code points`);
  assert.equal([...bottom].length, 120, `the premise (${what}): the bottom rule's code points`);
  if (WIDE_STATUSES_DIVIDED.includes(wide)) {
    const above = screen.slice(0, screen.indexOf(top));
    assert.ok(above.some((row) => row === bottom), `the premise (${what}): a full-width divider in the chat above the status`);
  }
}
const PROMPT = 'Read your AGENTS.md and keep the queue moving.';

/** The id Pi makes for the new conversation, as its extension reports it. */
const NEW_ID = 'b0b0b0b0-1111-4222-8333-444455556666';

/** Pi's command for a new conversation, which the kit types. */
const NEW = '/new';

/** The draft the user left in a line, in the tests that have one. */
const DRAFT = 'half a thought about the release';

/** The line the kit types into Codex after its `/new`, word for word, as the architect approved it on #391 (test/session-clear.test.js). */
const RECORD_LINE = 'obk: this conversation was started by obk session clear, and this line is only so the kit can record it. Reply "ok"; nothing else is asked.';

/** A hard limit for each test, so a wait that never ends fails here rather than hangs the run. */
const LIMIT = { timeout: 120_000 };

/** The command as the kit types it: one character a send, none with a return. */
const typed = (command) => [...command].map((text) => ({ text, enter: false }));

/** One backspace per character of `command`, as the one send that takes it back. */
const backspaces = (command) => '\x7f'.repeat(command.length);

/** The return, as a send of its own. */
const RETURN = { text: '\r', enter: false };

/** What the kit types before the return on Pi: `/new` and one space (#673). */
const SPACED = `${NEW} `;

/** `/new`, the space and the return, each a send of its own: the command entered on Pi. */
const ENTERED = [...typed(SPACED), RETURN];

/** `/new` typed and taken back with four backspaces in one send: no space, and never entered. */
const TAKEN_BACK = [...typed(NEW), { text: backspaces(NEW), enter: false }];

/** `/new` and the space typed, and all five taken back with five backspaces in one send, never entered. */
const SPACED_TAKEN_BACK = [...typed(SPACED), { text: backspaces(SPACED), enter: false }];

/** The screens the Pi tab shows, one per send, as `/new` is typed, then `after`: the screen once the last character is in, the one after the space, and whatever follows. */
const piScreensFor = (...after) => [...whileTypingPi(), ...after];

/** The kit's own words in a refusal: what it said with every row of `rows` taken out. */
const ownWords = (said, rows) => rows.filter((row) => row.trim() !== '').reduce((rest, row) => rest.replaceAll(row.trim(), ''), said);

// ---------------------------------------------------------------- the fleet

/**
 * A bots folder with Bot Father and pi-bot on Pi, the sessions named and up,
 * each tab showing Pi at rest (PI_IDLE), Orca naming agent pi in it, and the
 * book holding the id the kit gave each session.
 */
async function piRunning(box, { sessions = ['daily', 'review'] } = {}) {
  await fakePi(box);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'pi']);
  assert.equal(made.code, 0, `${made.stdout}${made.stderr}`);
  for (const name of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', name, '--prompt', PROMPT]);
    assert.equal(added.code, 0, `${added.stdout}${added.stderr}`);
  }
  const up = await box.run(['up', '--bots', 'bots', '--bot', BOT]);
  assert.equal(up.code, 0, `the up this test stands on: ${up.stdout}${up.stderr}`);
  const bots = box.path('bots');
  for (const name of sessions) {
    const tab = await liveTab(box, bots, name);
    assert.equal(tab.agentIdentity, 'pi', `the premise: Orca names agent pi in ${name}'s tab, got ${tab.agentIdentity}`);
    assert.equal(typeof (await sessionIn(bots, BOT, name)).session, 'string', `the premise: the book holds an id for ${name}`);
    await changeTab(box, tab.tabId, { screen: PI_IDLE });
  }
  return bots;
}

/** The tab the book gives a session, as Orca has it now. */
async function liveTab(box, bots, name = 'daily', bot = BOT) {
  const entry = await sessionIn(bots, bot, name);
  assert.equal(typeof entry?.tab, 'string', `the book should hold a tab for ${name}, got: ${JSON.stringify(entry)}`);
  const terminal = (await tabsOfBot(box, bots, bot)).find((one) => one.tabId === entry.tab);
  assert.ok(terminal, `Orca should have ${name}'s tab ${entry.tab}`);
  return terminal;
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
const sendsInto = async (box, bots, name = 'daily', bot = BOT) => sendsAfterLaunch(await liveTab(box, bots, name, bot));

/** `obk session clear` for `bot`'s `session`, with any more flags. */
const clearOf = (box, { session = 'daily', bot = BOT, flags = [] } = {}) =>
  box.run(['session', 'clear', '--bots', 'bots', '--bot', bot, '--session', session, ...flags]);

/** Whether the return has gone into the tab. */
const returned = (sends) => sends.some((one) => one.text === '\r');

/**
 * Run `obk session clear --json`, and play the harness while it runs: once
 * `when` holds for the sends into the session's tab, run `then`, once.
 * Answers the run's result and whether `then` ran.
 */
async function runPlaying(box, bots, { when = returned, then, session = 'daily', bot = BOT }) {
  const { tabId } = await liveTab(box, bots, session, bot);
  let finished = false;
  const run = clearOf(box, { session, bot, flags: ['--json'] });
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

/**
 * Pi reporting the new conversation `id` from the session's tab, as it does
 * at once after a `/new`: the kit's extension, run by a fake Pi in the bot
 * home with reason `new` (#662).
 */
async function piReports(box, bots, id = NEW_ID, session = 'daily') {
  const tab = (await sessionIn(bots, BOT, session))?.tab;
  const report = await runPiExtension(box, { cwd: await realpath(botHomeOf(bots, BOT)), sessionId: id, reason: 'new', tab });
  assert.equal(report.outcome, 'resolved', `the extension's own run: ${JSON.stringify({ ...report, run: undefined })}`);
}

/** The JSON a run answered with, which must have gone through. */
function answered(result, what) {
  assert.equal(result.code, 0, `${what} should go through: ${result.stdout}${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch {
    return assert.fail(`${what} should answer JSON on stdout, got:\n${result.stdout}`);
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
 * How many `terminal read` calls on `handle` came, since `from` calls, before
 * the first `terminal send` into it.
 */
async function readsBeforeFirstSend(box, handle, from) {
  const calls = (await box.orca.calls()).slice(from).filter((call) => orcaFlag(call, '--terminal') === handle);
  const first = calls.findIndex((call) => orcaCommand(call) === 'terminal send');
  assert.ok(first >= 0, 'the premise: something was sent into the tab');
  return calls.slice(0, first).filter((call) => orcaCommand(call) === 'terminal read').length;
}

// ---------------------------------------------------------------- the clear

describe('obk session clear on a Pi session types /new and is confirmed by the book (#663)', { concurrency: 4 }, () => {
  it('P1 the happy path: /new a character a send, then one space, then a return of its own, nothing after it, and the new id the book holds is the answer, with harness pi', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const bots = await piRunning(box);
    const tab = await liveTab(box, bots);
    const was = (await sessionIn(bots, BOT, 'daily')).session;
    await changeTab(box, tab.tabId, { nextScreens: piScreensFor(PI_NEW_TYPED, PI_NEW_SPACED, PI_IDLE_AFTER_NEW) });
    const others = Object.fromEntries(Object.entries(await typedEverywhere(box)).filter(([handle]) => handle !== tab.handle));
    const from = (await box.orca.calls()).length;

    const { result, played } = await runPlaying(box, bots, { then: () => piReports(box, bots) });

    const answer = answered(result, 'the clear');
    assert.ok(played, 'the premise: the return was sent and Pi reported the new conversation');
    assert.deepEqual(
      await sendsInto(box, bots),
      ENTERED,
      '/new as text, one character a send, then one space, then the return as a send of its own, and nothing else: no record line, no answer to a question',
    );
    assert.equal(answer.bots, bots, 'bots is the folder, resolved');
    assert.deepEqual(answer.cleared, { bot: BOT, session: 'daily', harness: 'pi', was, now: NEW_ID });
    assert.equal((await sessionIn(bots, BOT, 'daily')).session, NEW_ID, 'the book holds the new conversation');
    const now = Object.fromEntries(Object.entries(await typedEverywhere(box)).filter(([handle]) => handle !== tab.handle));
    assert.deepEqual(now, others, 'no other tab, Bot Father\'s and the bot\'s other session\'s among them, had anything typed into it');
    await assertSentOnlyInto(box, tab.handle, from, 'clear on Pi');
  });

  for (const { start, read, spaced = PI_NEW_SPACED, what } of [
    { start: PI_IDLE_NO_CURSOR, read: PI_NEW_TYPED, what: 'its editor row empty with no cursor space before the first key' },
    { start: PI_IDLE, read: PI_NEW_TYPED_IN_DRAFT, spaced: PI_NEW_SPACED_IN_DRAFT, what: 'the editor row blank after typing and Orca\'s draft reading /new, then "/new " after the space, with no menu' },
    { start: PI_IDLE, read: PI_NEW_TYPED, spaced: PI_NEW_SPACED_IN_DRAFT, what: 'the editor row blank after the space and Orca\'s draft reading "/new ", with no menu' },
    { start: PI_IDLE, read: PI_NEW_TYPED, spaced: PI_NEW_SPACED_AS_SEEN, what: 'the editor row reading /new after the space, trimmed as Orca showed it, with no menu' },
    // The gap of #673: a list drawn for `/n`, `new` selected, still up once
    // `/new` is in. The check before the space cannot tell it from a fresh
    // list; the space closes it, and only then does the return go in.
    { start: PI_IDLE, read: PI_NEW_STALE_ON_NEW, what: 'the list drawn for /n still below the box once /new is in, new selected, closed by the space' },
  ]) {
    it(`P1 the clear on Pi with ${what}: /new and the space are typed, the return goes in, and the new conversation is the answer`, LIMIT, async (t) => {
      const box = await createSandbox(t);
      const bots = await piRunning(box);
      const was = (await sessionIn(bots, BOT, 'daily')).session;
      await changeTab(box, (await liveTab(box, bots)).tabId, { screen: start, nextScreens: piScreensFor(read, spaced, PI_IDLE_AFTER_NEW) });

      const { result, played } = await runPlaying(box, bots, { then: () => piReports(box, bots) });

      const answer = answered(result, 'the clear');
      assert.ok(played, 'the premise: the return was sent and Pi reported the new conversation');
      assert.deepEqual(await sendsInto(box, bots), ENTERED);
      assert.deepEqual(answer.cleared, { bot: BOT, session: 'daily', harness: 'pi', was, now: NEW_ID });
    });
  }

  it('P2 each character of /new and the space after it is its own send, each after a look through the typing gate, 100 ms or more apart, then a read of the screen, then the return', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const bots = await piRunning(box);
    const tab = await liveTab(box, bots);
    await changeTab(box, tab.tabId, { nextScreens: piScreensFor(PI_NEW_TYPED, PI_NEW_SPACED, PI_IDLE_AFTER_NEW) });
    const from = (await box.orca.calls()).length;

    const { result, played } = await runPlaying(box, bots, { then: () => piReports(box, bots) });

    answered(result, 'the clear');
    assert.ok(played, 'the premise: Pi reported the new conversation');
    const calls = (await box.orca.calls()).slice(from);
    const clock = (await box.orca.clock()).slice(from);
    const sends = calls
      .map((call, at) => ({ call, at }))
      .filter(({ call }) => orcaCommand(call) === 'terminal send' && orcaFlag(call, '--terminal') === tab.handle);
    const keys = sends.slice(0, SPACED.length);
    assert.deepEqual(
      keys.map(({ call }) => ({ text: orcaFlag(call, '--text'), enter: call.args.includes('--enter') })),
      typed(SPACED),
      'the first five sends are /new and a space, one character each, none with --enter',
    );
    let since = -1;
    for (const [n, { at }] of keys.entries()) {
      const looks = calls.slice(since + 1, at).filter((call) => orcaCommand(call) === 'terminal wait'
        && orcaFlag(call, '--terminal') === tab.handle && orcaFlag(call, '--for') === 'tui-idle');
      assert.ok(looks.length > 0, `a look through the gate (terminal wait --for tui-idle on the tab) before character ${n + 1}, ${JSON.stringify(SPACED[n])}`);
      since = at;
    }
    for (let n = 1; n < keys.length; n += 1) {
      const gap = clock[keys[n].at].at - clock[keys[n - 1].at].at;
      assert.ok(gap >= 100, `character ${n + 1} came ${gap} ms after the one before it; the requirement is 100 ms or more`);
    }
    const ret = sends[SPACED.length];
    const readsAfterSpace = calls.slice(keys[SPACED.length - 1].at + 1, ret?.at ?? calls.length)
      .filter((call) => orcaCommand(call) === 'terminal read' && orcaFlag(call, '--terminal') === tab.handle);
    assert.ok(readsAfterSpace.length > 0, 'the screen is read after the space and before the return');
    assert.deepEqual(ret && { text: orcaFlag(ret.call, '--text'), enter: ret.call.args.includes('--enter') }, RETURN, 'then the return, as a send of its own, with no --enter');
    assert.equal(sends.length, SPACED.length + 1, 'and nothing after the return');
  });

  it('P3 the clear without --json says, on its way out, the bot, the session and the new conversation', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const bots = await piRunning(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: piScreensFor(PI_NEW_TYPED, PI_NEW_SPACED, PI_IDLE_AFTER_NEW) });

    const run = clearOf(box);
    let finished = false;
    run.then(() => { finished = true; }, () => { finished = true; });
    const until = Date.now() + 25_000;
    while (!finished && Date.now() < until && !returned(await sendsInto(box, bots))) await sleep(50);
    if (!finished) await piReports(box, bots);
    const result = await run;

    assert.equal(result.code, 0, `the clear should go through: ${result.stdout}${result.stderr}`);
    for (const word of [BOT, 'daily', NEW_ID]) {
      assert.ok(result.stdout.includes(word), `the plain answer names ${word}, got:\n${result.stdout}`);
    }
  });

  // ------------------------------------------------ refused before anything is typed

  it('R1 a paused Pi session: refused, saying it is paused, and nothing typed', LIMIT, async (t) => {
    const box = await createSandbox(t);
    await piRunning(box);
    const paused = await box.run(['pause', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);
    assert.equal(paused.code, 0, `the pause this test stands on: ${paused.stdout}${paused.stderr}`);
    const before = await typedEverywhere(box);

    const said = assertRefused(await clearOf(box));

    assert.match(said, /paused/i, `it says the session is paused, got:\n${said}`);
    await assertNothingTyped(box, before, 'a paused Pi session');
  });

  it('R1 a Pi tab with only its shell in front: refused, saying a restart brings it back, and nothing typed', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const bots = await piRunning(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { foreground: 'shell' });
    const before = await typedEverywhere(box);

    assertRefused(await clearOf(box), 'restart');

    await assertNothingTyped(box, before, 'the shell in front of a Pi tab');
  });

  it('R1 a Pi session\'s tab where Orca names another agent, claude: refused, naming it, and nothing typed', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const bots = await piRunning(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { agentIdentity: 'claude' });
    const before = await typedEverywhere(box);
    const book = await sessionIn(bots, BOT, 'daily');

    assertRefused(await clearOf(box), 'claude');

    await assertNothingTyped(box, before, 'another agent in the Pi tab');
    assert.deepEqual(await sessionIn(bots, BOT, 'daily'), book, 'the book is as it was');
  });

  // ------------------------------------------------ the line before the first character

  for (const { change, what } of [
    { change: { screen: PI_DRAFT }, what: 'the editor row holds a draft, and Orca gives no draft' },
    { change: { screen: PI_IDLE, draft: DRAFT }, what: 'Orca gives a draft, and the editor row is blank' },
    { change: { screen: PI_DRAFT, draft: DRAFT }, what: 'the editor row and Orca\'s draft both hold it' },
  ]) {
    it(`D1 ${what}: refused before the first character, nothing typed into any tab, and the refusal says what the line holds`, LIMIT, async (t) => {
      const box = await createSandbox(t);
      const bots = await piRunning(box);
      await changeTab(box, (await liveTab(box, bots)).tabId, { ...change, nextScreens: piScreensFor(PI_NEW_TYPED, PI_NEW_SPACED, PI_IDLE_AFTER_NEW) });
      const before = await typedEverywhere(box);
      const book = await sessionIn(bots, BOT, 'daily');

      const said = assertRefused(await clearOf(box));

      await assertNothingTyped(box, before, `a draft in the Pi line (${what})`);
      assert.ok(said.includes(DRAFT), `the refusal shows what the line holds, ${DRAFT}, got:\n${said}`);
      assert.deepEqual(await sessionIn(bots, BOT, 'daily'), book, 'the book is as it was');
    });
  }

  // The review's second finding: an editor row that starts with `─` is an
  // editor row, not the box's top rule. With no draft from Orca, each of these
  // is a draft in the line: refused before the first key, nothing typed.
  for (const { screen, shows, what } of [
    { screen: PI_DASH_DRAFT, shows: '─ a draft of the user', what: 'one editor row "─ a draft of the user"' },
    { screen: PI_RULED_DRAFT, shows: '── a draft ──', what: 'one editor row "── a draft ──"' },
    { screen: PI_DASH_DRAFT_TWO_ROWS, shows: 'and the second row of it', what: 'two editor rows, the first "─ the first row of a draft"' },
    { screen: PI_DASH_DRAFT_TWO_DASH_ROWS, shows: '─ and the second row of it', what: 'two editor rows, each starting with "─"' },
    { screen: PI_DASHES_DRAFT, shows: '──────────', what: 'one editor row "──────────", `─` alone and shorter than the rules' },
  ]) {
    it(`D2 Orca gives no draft and Pi's editor holds ${what}: refused before the first character, nothing typed into any tab, and the refusal is about the line`, LIMIT, async (t) => {
      const box = await createSandbox(t);
      const bots = await piRunning(box);
      await changeTab(box, (await liveTab(box, bots)).tabId, { screen, nextScreens: piScreensFor(PI_NEW_TYPED, PI_NEW_SPACED, PI_IDLE_AFTER_NEW) });
      const before = await typedEverywhere(box);
      const book = await sessionIn(bots, BOT, 'daily');

      const said = assertRefused(await clearOf(box));

      await assertNothingTyped(box, before, `a draft in the Pi line (${what})`);
      assert.ok(said.includes(shows), `the refusal shows the draft, ${shows}, got:\n${said}`);
      const own = screen.filter((row) => row.trim() !== '').reduce((rest, row) => rest.replaceAll(row.trim(), ''), said);
      assert.match(own, /\b(?:line|draft|editor)\b/i, `the refusal is about what the line holds, got:\n${said}`);
      assert.deepEqual(await sessionIn(bots, BOT, 'daily'), book, 'the book is as it was');
    });
  }

  for (const { screen, what } of [
    { screen: PI_SHORT_TOP, what: 'the row right above the editor is a rule of another width than the bottom rule' },
    // Rule 4 of the walk: ASCII words in a short rule-shaped row are an editor
    // row, and no row above it is a rule, so there is no top rule and no status.
    { screen: PI_RULED_DRAFT_NO_TOP, what: 'a bottom rule with "── a draft ──" above it and no top rule at all' },
  ]) {
    it(`D3 ${what}: no input box, so nothing typed, and the refusal says the screen shows no input box`, LIMIT, async (t) => {
      const box = await createSandbox(t);
      const bots = await piRunning(box);
      await changeTab(box, (await liveTab(box, bots)).tabId, { screen, nextScreens: piScreensFor(PI_NEW_TYPED, PI_NEW_SPACED, PI_IDLE_AFTER_NEW) });
      const before = await typedEverywhere(box);

      const said = assertRefused(await clearOf(box));

      await assertNothingTyped(box, before, 'a screen with no input box');
      assert.match(said, /input box/i, `it says the screen shows no input box, got:\n${said}`);
      assert.doesNotMatch(said, /busy/i, `and does not call the session busy, got:\n${said}`);
    });
  }

  // ------------------------------------------------ busy, by Pi's own row

  // A screen that shows Pi at work for its first three reads, Orca's tui-idle
  // answering ok all along, then Pi at rest: the kit may type only after a
  // read that shows Pi at rest, the fourth at the earliest. The first case,
  // `Working` with no hint, is the row Pi draws on almost every turn.
  for (const { screen, what } of [
    { screen: PI_WORKING, what: 'its usual row, "── ⠋ Working ──…", no hint after the message' },
    { screen: PI_WORKING_CUT, what: 'a status cut short in a narrow tab, "── ⠋ Working (escape to ────"' },
    { screen: piBusyWith('Reading the pull request'), what: 'an extension\'s own message, "── ⠋ Reading the pull request ──…"' },
    // The long draft is gone once Pi is at rest here: a fixture's shortcut, so
    // that a kit that took the row for no work would meet the draft and refuse.
    { screen: PI_LONG_DRAFT_WORKING, what: 'the status beside the scroll label, "── ⠋ Working ─── ↑ 3 more ──…", a long draft below it' },
    // The editor row is `─` alone and shorter than the rules: no rule of the
    // box, so the top rule is the one above it, with the status in it.
    { screen: PI_WORKING_DASHES_IN_EDITOR, what: 'its usual row, "── ⠋ Working ──…", over an editor row "──────────"' },
    { screen: piBusyWith('Working (escape to interrupt)'), what: '"── ⠋ Working (escape to interrupt) ──…"' },
    { screen: piBusyWith('Compacting context... (escape to cancel)'), what: '"── ⠋ Compacting context... (escape to cancel) ──…"' },
    { screen: piBusyWith('Retrying (1/3) in 4s... (escape to cancel)'), what: '"── ⠋ Retrying (1/3) in 4s... (escape to cancel) ──…"' },
    { screen: piBusyWith('Working (ctrl+x to interrupt)'), what: 'a rebound key, "── ⠋ Working (ctrl+x to interrupt) ──…"' },
    // Wide characters: the top rule fills the 120 columns of the bottom rule
    // with another count of code points (the review of 5455aa6).
    ...WIDE_STATUSES,
    // The same under a full-width divider in the chat (the review of b2a0bde).
    ...WIDE_STATUSES_DIVIDED,
  ]) {
    it(`B1 Pi at work by its top rule ${what}, Orca's tui-idle ok: waited out, nothing typed until a read shows Pi at rest, then /new is entered`, LIMIT, async (t) => {
      assertWidePremise(screen, what);
      const box = await createSandbox(t);
      const bots = await piRunning(box);
      const tab = await liveTab(box, bots);
      await changeTab(box, tab.tabId, {
        screen,
        thenScreen: PI_IDLE,
        readsBeforeThen: 3,
        nextScreens: piScreensFor(PI_NEW_TYPED, PI_NEW_SPACED, PI_IDLE_AFTER_NEW),
      });
      const from = (await box.orca.calls()).length;

      const { result, played } = await runPlaying(box, bots, { then: () => piReports(box, bots) });

      const answer = answered(result, 'the clear');
      assert.ok(played, 'the premise: Pi reported the new conversation');
      assert.equal(answer.cleared.now, NEW_ID);
      assert.deepEqual(await sendsInto(box, bots), ENTERED);
      const reads = await readsBeforeFirstSend(box, tab.handle, from);
      assert.ok(reads >= 4, `nothing was typed while the screen showed Pi at work: the first read to show it at rest is the fourth, and ${reads} read(s) came before the first key`);
    });
  }

  for (const { screen, what } of [
    { screen: PI_IDLE, what: 'the startup help\'s "escape to interrupt" in the chat, the top rule `─` alone' },
    { screen: PI_SUMMARY_IN_CHAT, what: 'a row "── Summary ──…" in the chat above the box, the box\'s top rule `─` alone' },
    { screen: PI_IDLE_DIVIDED, what: 'full-width dividers of `─` alone in the chat above the box, the box\'s top rule `─` alone, its editor empty' },
  ]) {
    it(`B2 ${what}: no sign of work, so /new is typed at once and entered`, LIMIT, async (t) => {
      const box = await createSandbox(t);
      const bots = await piRunning(box);
      assert.ok(screen.includes(' escape to interrupt'), 'the premise: the help line is on the screen');
      await changeTab(box, (await liveTab(box, bots)).tabId, { screen, nextScreens: piScreensFor(PI_NEW_TYPED, PI_NEW_SPACED, PI_IDLE_AFTER_NEW) });

      const started = Date.now();
      const { result, played } = await runPlaying(box, bots, { then: () => piReports(box, bots) });
      const took = Date.now() - started;

      answered(result, 'the clear');
      assert.ok(played, 'the premise: Pi reported the new conversation');
      assert.deepEqual(await sendsInto(box, bots), ENTERED);
      assert.ok(took < 20_000, `nothing was waited out: it took ${took} ms`);
    });
  }

  // A long draft, Pi at rest: its scroll labels in the rules are no status.
  // The draft is refused at once, as a draft, not waited out as work.
  for (const { screen, what } of [
    { screen: PI_LONG_DRAFT, what: 'centred, "── ↑ 3 more ──" and "── ↓ 2 more ──"' },
    { screen: PI_LONG_DRAFT_LEFT, what: 'near the left end, "─── ↑ 3 more ───…" and "─── ↓ 2 more ───…"' },
  ]) {
    it(`B4 a long draft with Pi's scroll labels in its rules, ${what}, and no status: no sign of work, so it is refused at once for the draft, nothing typed`, LIMIT, async (t) => {
      const box = await createSandbox(t);
      const bots = await piRunning(box);
      await changeTab(box, (await liveTab(box, bots)).tabId, { screen, nextScreens: piScreensFor(PI_NEW_TYPED, PI_NEW_SPACED, PI_IDLE_AFTER_NEW) });
      const before = await typedEverywhere(box);

      const started = Date.now();
      const said = assertRefused(await clearOf(box));
      const took = Date.now() - started;

      await assertNothingTyped(box, before, 'a long draft in the Pi line');
      assert.ok(PI_LONG_DRAFT_ROWS.some((row) => said.includes(row)), `the refusal shows what the line holds, got:\n${said}`);
      // The box with its scroll labels is still Pi's input box, so the reason
      // is the line, in the kit's own words: with every row of the screen
      // taken out of what it said, it still speaks of the line or the draft.
      const own = screen.filter((row) => row.trim() !== '').reduce((rest, row) => rest.replaceAll(row.trim(), ''), said);
      assert.match(own, /\b(?:line|draft|editor)\b/i, `the refusal is about what the line holds, not about the screen, got:\n${said}`);
      assert.doesNotMatch(said, /busy/i, `a scroll label is no sign of work, got:\n${said}`);
      assert.ok(took < 20_000, `nothing was waited out: it took ${took} ms`);
    });
  }

  it('B3 Pi\'s /model selector on screen, Orca calling the tab idle: waited out as a question, nothing typed until it is gone, then /new is entered', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const bots = await piRunning(box);
    const tab = await liveTab(box, bots);
    await changeTab(box, tab.tabId, {
      screen: PI_MODEL_SELECTOR,
      thenScreen: PI_IDLE,
      readsBeforeThen: 3,
      nextScreens: piScreensFor(PI_NEW_TYPED, PI_NEW_SPACED, PI_IDLE_AFTER_NEW),
    });
    const from = (await box.orca.calls()).length;

    const { result, played } = await runPlaying(box, bots, { then: () => piReports(box, bots) });

    answered(result, 'the clear');
    assert.ok(played, 'the premise: Pi reported the new conversation');
    assert.deepEqual(await sendsInto(box, bots), ENTERED);
    const reads = await readsBeforeFirstSend(box, tab.handle, from);
    assert.ok(reads >= 4, `nothing was typed while the selector was up: the first read without it is the fourth, and ${reads} read(s) came before the first key`);
  });

  // ------------------------------------------------ Pi at work between characters

  it('W1 Pi\'s at-work row comes up in its top rule after two characters: the typing stops, the two are taken back in one send, and the refusal names the row', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const bots = await piRunning(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: [whileTypingPi()[0], piAtWork('/n'), PI_IDLE] });

    const said = assertRefused(await clearOf(box));

    assert.deepEqual(await sendsInto(box, bots), [...typed('/n'), { text: backspaces('/n'), enter: false }], 'the two typed, then exactly those two taken back, and nothing more');
    assert.ok(said.includes('⠋ Working'), `it names its signal, the at-work row "── ⠋ Working ──…", got:\n${said}`);
  });

  it('W1 Pi\'s at-work row is up once the last character of /new is in: no space, no return, the four taken back in one send, and the refusal names the row', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const bots = await piRunning(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: piScreensFor(piAtWork(NEW), PI_IDLE) });

    const said = assertRefused(await clearOf(box));

    assert.deepEqual(await sendsInto(box, bots), TAKEN_BACK, 'the look before the space stops it');
    assert.ok(said.includes('⠋ Working'), `it names its signal, the at-work row "── ⠋ Working ──…", got:\n${said}`);
  });

  it('W1 the menu draws late, after the last character, with Pi\'s at-work row on the same screen: no space, no return, the four taken back, and the refusal names the row', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const bots = await piRunning(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, {
      nextScreens: piScreensFor({ screen: PI_NEW_NO_MENU, then: piAtWork(NEW) }, PI_IDLE),
    });

    const said = assertRefused(await clearOf(box));

    assert.deepEqual(await sendsInto(box, bots), TAKEN_BACK, 'the screen that passed the menu rule carried the at-work row, so no space and no return');
    assert.ok(said.includes('⠋ Working'), `it names its signal, the at-work row "── ⠋ Working ──…", got:\n${said}`);
  });

  // ------------------------------------------------ the space, and the screen after it (#673)

  // Between keys the kit's look is the typing gate (a question) and Pi's own
  // at-work row, not Orca's tui-idle: an open slash menu was seen to stop
  // tui-idle answering ok (#391, live run 3). The space is typed with Pi's
  // menu open, so it is a key like the others (as W2 of test/pi-compact.test.js).
  it('W2 Orca\'s tui-idle stops answering ok once /new is in, the menu open, with no at-work row and no question on screen: the space is still typed, then the return, and the book confirms it', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const bots = await piRunning(box);
    const was = (await sessionIn(bots, BOT, 'daily')).session;
    await changeTab(box, (await liveTab(box, bots)).tabId, {
      nextScreens: piScreensFor({ screen: PI_NEW_TYPED, tuiIdle: 'busy' }, PI_NEW_SPACED, PI_IDLE_AFTER_NEW),
    });

    const { result, played } = await runPlaying(box, bots, { then: () => piReports(box, bots) });

    const answer = answered(result, 'the clear');
    assert.ok(played, 'the premise: the return was sent and Pi reported the new conversation');
    assert.deepEqual(await sendsInto(box, bots), ENTERED, 'tui-idle alone does not stop the space: /new, the space, and the return');
    assert.deepEqual(answer.cleared, { bot: BOT, session: 'daily', harness: 'pi', was, now: NEW_ID });
  });

  it('W2 Pi\'s at-work row comes up after the space, with no menu: no return, all five taken back in one send, and the refusal names the row', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const bots = await piRunning(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: piScreensFor(PI_NEW_TYPED, PI_NEW_SPACED_AT_WORK, PI_IDLE) });
    const book = await sessionIn(bots, BOT, 'daily');

    const said = assertRefused(await clearOf(box));

    assert.deepEqual(await sendsInto(box, bots), SPACED_TAKEN_BACK, '/new and the space, then five backspaces in one send, and no return');
    assert.ok(said.includes('⠋ Working'), `it names its signal, the at-work row "── ⠋ Working ──…", got:\n${said}`);
    assert.deepEqual(await sessionIn(bots, BOT, 'daily'), book, 'the book is as it was');
  });

  for (const { spaced, what } of [
    // Orca's gate names a reason after the space: the screen itself would pass.
    { spaced: { screen: PI_NEW_SPACED, tuiIdle: 'blocked' }, what: 'Orca\'s gate names a question after the space, the editor reading "/new " with no menu' },
    { spaced: PI_MODEL_SELECTOR, what: 'Pi\'s /model selector up after the space, by its cancel foot' },
  ]) {
    it(`Q1 ${what}: no return, all five taken back in one send, and the refusal says a question is up`, LIMIT, async (t) => {
      const box = await createSandbox(t);
      const bots = await piRunning(box);
      await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: piScreensFor(PI_NEW_TYPED, spaced, PI_IDLE) });
      const book = await sessionIn(bots, BOT, 'daily');

      const said = assertRefused(await clearOf(box));

      assert.deepEqual(await sendsInto(box, bots), SPACED_TAKEN_BACK, '/new and the space, then five backspaces in one send, and no return');
      assert.match(said, /question/i, `it says a question is up, got:\n${said}`);
      assert.deepEqual(await sessionIn(bots, BOT, 'daily'), book, 'the book is as it was');
    });
  }

  // A list still drawn after the space, that closes within the kit's screen
  // wait: the return waits for a read with no menu, then goes in (as S1 of
  // test/pi-compact.test.js).
  for (const { stale, what } of [
    { stale: PI_NEW_SPACED_STALE, what: 'the /ne list with new selected' },
    { stale: PI_NEW_SPACED_STALE_ON_NEW, what: 'the /n list with new selected, under which a Return would submit a line such as /nnew' },
    { stale: PI_NEW_SPACED_STALE_NAME, what: 'the /n list with name selected' },
  ]) {
    it(`L1 a menu still drawn after the space, ${what}, that closes after a few reads: the return waits for a read with no menu, then goes in`, LIMIT, async (t) => {
      const box = await createSandbox(t);
      const bots = await piRunning(box);
      const tab = await liveTab(box, bots);
      const was = (await sessionIn(bots, BOT, 'daily')).session;
      await changeTab(box, tab.tabId, {
        nextScreens: piScreensFor(PI_NEW_TYPED, { screen: stale, then: PI_NEW_SPACED, reads: 3 }, PI_IDLE_AFTER_NEW),
      });
      const from = (await box.orca.calls()).length;

      const { result, played } = await runPlaying(box, bots, { then: () => piReports(box, bots) });

      const answer = answered(result, 'the clear');
      assert.ok(played, 'the premise: the return was sent and Pi reported the new conversation');
      assert.deepEqual(answer.cleared, { bot: BOT, session: 'daily', harness: 'pi', was, now: NEW_ID });
      assert.deepEqual(await sendsInto(box, bots), ENTERED, '/new, the space, and the return once the menu had closed');
      const calls = (await box.orca.calls()).slice(from).filter((call) => orcaFlag(call, '--terminal') === tab.handle);
      const sendAt = calls.map((call, at) => (orcaCommand(call) === 'terminal send' ? at : -1)).filter((at) => at >= 0);
      const space = sendAt[SPACED.length - 1];
      const ret = sendAt[SPACED.length];
      const reads = calls.slice(space + 1, ret).filter((call) => orcaCommand(call) === 'terminal read').length;
      assert.ok(reads >= 4, `the return came only after a read with no menu: the first such read is the fourth after the space, and ${reads} read(s) came between the space and the return`);
    });
  }
});

// ---------------------------------------------------------------- the screen before the return
//
// Side by side: a check that wrongly lets the return in waits out the 30 s
// for the book.

describe('#663: Pi refusals once /new is typed, side by side', { concurrency: true }, () => {
  for (const { read, shows, what } of [
    { read: PI_NEW_NO_MENU, shows: 'openai/gpt-6-luna', what: 'no menu below the bottom rule, the footer right under it' },
    { read: PI_NEW_OTHER_SELECTED, shows: '→ name', what: 'the menu\'s selected row another command, name, with new under it' },
    { read: PI_NEW_MENU_ABOVE, shows: 'openai/gpt-6-luna', what: 'the "→ new" row drawn above the top rule and nothing below the bottom rule' },
    { read: PI_NEW_KEYS_SWAPPED, shows: '/nwe', what: 'the editor row reads /nwe under the right menu' },
    { read: PI_NEW_DRAFT_KEYS_SWAPPED, shows: '/nwe', what: 'Orca\'s draft reads /nwe, the editor row blank, under the right menu' },
  ]) {
    it(`M1 ${what}: no space, no return, the four taken back in one send, refused, and the refusal shows the screen's rows`, LIMIT, async (t) => {
      const box = await createSandbox(t);
      const bots = await piRunning(box);
      await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: piScreensFor(read, PI_IDLE) });
      const book = await sessionIn(bots, BOT, 'daily');

      const said = assertRefused(await clearOf(box));

      assert.deepEqual(await sendsInto(box, bots), TAKEN_BACK, '/new taken back with four backspaces in one send: no space, and never entered');
      assert.ok(said.includes(shows), `the refusal says what the screen showed, ${shows} among it, got:\n${said}`);
      assert.deepEqual(await sessionIn(bots, BOT, 'daily'), book, 'the book is as it was');
    });
  }

  // After the space: the return only with the line reading /new and no menu
  // row below the box. A menu still up after the kit's screen wait, or
  // another line, takes back all five (#673). `menu` says which reason the
  // refusal gives in its own words: the menu, or the line.
  for (const { spaced, shows, menu, what } of [
    { spaced: PI_NEW_SPACED_STALE, shows: '→ new', menu: true, what: 'the list drawn for /ne still below the box after the space, new selected, never closing' },
    { spaced: PI_NEW_SPACED_STALE_ON_NEW, shows: '→ new', menu: true, what: 'the list drawn for /n still below the box after the space, new selected, never closing (a Return would submit a line such as /nnew)' },
    { spaced: PI_NEW_SPACED_STALE_NAME, shows: '→ name', menu: true, what: 'the list drawn for /n still below the box after the space, name selected, never closing' },
    { spaced: PI_NEW_TYPED, shows: '→ new', menu: true, what: 'the screen unchanged after the space, the editor row /new and the menu on new, never closing' },
    { spaced: PI_NEW_SPACED_STALE_IN_DRAFT, shows: '→ new', menu: true, what: 'Orca\'s draft "/new " after the space, the editor row blank, and the /ne list still below the box' },
    { spaced: PI_NEW_SPACED_KEYS_SWAPPED, shows: '/ne w', menu: false, what: 'the editor row reads "/ne w" after the space, with no menu' },
    { spaced: PI_NEW_SPACED_DRAFT_SWAPPED, shows: '/ne w', menu: false, what: 'Orca\'s draft reads "/ne w" after the space, the editor row blank, with no menu' },
  ]) {
    it(`M2 ${what}: no return, all five taken back in one send, refused, and the refusal says why`, LIMIT, async (t) => {
      const box = await createSandbox(t);
      const bots = await piRunning(box);
      await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: piScreensFor(PI_NEW_TYPED, spaced, PI_IDLE) });
      const book = await sessionIn(bots, BOT, 'daily');

      const started = Date.now();
      const said = assertRefused(await clearOf(box));
      const took = Date.now() - started;

      assert.deepEqual(await sendsInto(box, bots), SPACED_TAKEN_BACK, '/new and the space taken back with five backspaces in one send, and never entered');
      assert.ok(said.includes(shows), `the refusal says what the screen showed, ${shows} among it, got:\n${said}`);
      const own = ownWords(said, Array.isArray(spaced) ? spaced : spaced.screen);
      assert.match(own, menu ? /\bmenu\b/i : /\bline\b/i, `the refusal says, in its own words, that ${menu ? 'a menu is still below the box' : 'the line reads something else'} after the space, got:\n${said}`);
      assert.ok(took < 60_000, `the reads after the space last a few seconds, not long; it took ${took} ms`);
      assert.deepEqual(await sessionIn(bots, BOT, 'daily'), book, 'the book is as it was');
    });
  }
});

// ---------------------------------------------------------------- the waits that run out

describe('#663: the Pi waits that run out, side by side', { concurrency: true }, () => {
  for (const { screen, what, names } of [
    { screen: PI_WORKING, what: 'its usual top rule "── ⠋ Working ──…"', names: '⠋ Working' },
    ...WIDE_STATUSES,
    WIDE_STATUSES_DIVIDED[0],
  ]) {
    it(`X1 Pi at work by ${what === 'its usual top rule "── ⠋ Working ──…"' ? what : `its top rule ${what}`} for the whole 30 s, Orca's tui-idle ok: refused after about that long, saying it is busy and naming the row, nothing typed`, LIMIT, async (t) => {
      assertWidePremise(screen, what);
      const box = await createSandbox(t);
      const bots = await piRunning(box);
      const was = (await sessionIn(bots, BOT, 'daily')).session;
      await changeTab(box, (await liveTab(box, bots)).tabId, { screen });
      const before = await typedEverywhere(box);

      const started = Date.now();
      const result = await clearOf(box);
      const took = Date.now() - started;

      const said = assertRefused(result);
      assert.match(said, /busy/i, `it says the session is busy, got:\n${said}`);
      assert.ok(said.includes(names), `and names its signal, the at-work row with "${names}", got:\n${said}`);
      await assertNothingTyped(box, before, 'Pi at work throughout');
      assert.ok(took >= 25_000, `it waited for the session, up to 30 s, before refusing; it took ${took} ms`);
      assert.ok(took < 90_000, `and the wait is bounded; it took ${took} ms`);
      assert.equal((await sessionIn(bots, BOT, 'daily')).session, was, 'the book is as it was');
    });
  }

  it('X1 Pi\'s /model selector on screen for the whole 30 s, Orca calling the tab idle: refused, saying a question is up, nothing typed', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const bots = await piRunning(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { screen: PI_MODEL_SELECTOR });
    const before = await typedEverywhere(box);

    const said = assertRefused(await clearOf(box));

    assert.match(said, /question/i, `it says a question is waiting, got:\n${said}`);
    await assertNothingTyped(box, before, 'a Pi selector on screen');
  });

  it('X1 /new entered on Pi whose new conversation never reaches the book in 30 s: refused, saying /new went in, no new conversation, and to look at the tab', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const bots = await piRunning(box);
    const was = (await sessionIn(bots, BOT, 'daily')).session;
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: piScreensFor(PI_NEW_TYPED, PI_NEW_SPACED, PI_IDLE_AFTER_NEW) });

    const said = assertRefused(await clearOf(box));

    assert.deepEqual(await sendsInto(box, bots), ENTERED, 'the premise: the command was entered, and nothing was typed after it');
    assert.ok(said.includes(NEW), `it says what was entered, got:\n${said}`);
    assert.match(said, /\bconversation\b/i, `it says the book has no new conversation, got:\n${said}`);
    assert.match(said, /\btab\b/i, `and to look at the tab, got:\n${said}`);
    assert.equal((await sessionIn(bots, BOT, 'daily')).session, was, 'the book is as it was');
  });
});

// ---------------------------------------------------------------- Pi's row counts only where Orca names pi
//
// The architect's addition A: the at-work row is Pi's, and counts only in a
// tab where Orca names the agent pi. These pass before the change: they hold
// that the change keeps Claude Code and Codex as they were.

const OTHER_BOT = 'api-bot';

/** api-bot on `harness`, its session daily up, with conversation `sess-daily` in the book and on the harness's record. */
async function otherRunning(box, harness) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', OTHER_BOT, '--harness', harness]);
  assert.equal(made.code, 0, made.stderr);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', OTHER_BOT, '--name', 'daily', '--prompt', PROMPT]);
  assert.equal(added.code, 0, added.stderr);
  const up = await box.run(['up', '--bots', 'bots', '--bot', OTHER_BOT]);
  assert.equal(up.code, 0, `the up this test stands on: ${up.stdout}${up.stderr}`);
  const bots = box.path('bots');
  const tab = await liveTab(box, bots, 'daily', OTHER_BOT);
  const heard = await recordSession(box, { bots, bot: OTHER_BOT, tab: tab.tabId, session: 'sess-daily' });
  assert.equal(heard.code, 0, `the hook report this test stands on: ${heard.stderr}`);
  await conversationOnRecord(box, { harness, cwd: botHomeOf(bots, OTHER_BOT), id: 'sess-daily', ...(harness === 'codex' ? { cliVersion: '0.160.0' } : {}) });
  return { bots, tab };
}

/** The hook reporting a new conversation `id` from api-bot's daily tab, as the harness would run it. */
async function hookReports(box, bots, id, source) {
  const tab = await liveTab(box, bots, 'daily', OTHER_BOT);
  const heard = await recordSession(box, { bots, bot: OTHER_BOT, tab: tab.tabId, session: id, source });
  assert.equal(heard.code, 0, `the hook's own run: ${heard.stderr}`);
}

/** Claude Code at rest, its input box's top rule Pi's at-work row. */
const CLAUDE_WITH_PI_ROW = CLAUDE_IDLE.map((row, at) => (at === 4 ? PI_WORKING_RULE : row));

/** Codex at rest, Pi's at-work row right above its input line. */
const CODEX_WITH_PI_ROW = CODEX_IDLE.flatMap((row) => (row.startsWith('› ') ? [PI_WORKING_RULE, row] : [row]));

describe('#663: Pi\'s at-work row on a Claude Code or Codex screen changes nothing', { concurrency: 2 }, () => {
  it('A1 a Claude Code tab whose input box\'s top rule reads like Pi\'s at-work row: /clear is typed at once and entered, as before', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, tab } = await otherRunning(box, 'claude');
    assert.equal(tab.agentIdentity, 'claude', 'the premise: Orca names claude in the tab');
    await changeTab(box, tab.tabId, { screen: CLAUDE_WITH_PI_ROW, nextScreens: [...whileTyping('claude', '/clear'), CLAUDE_CLEAR_TYPED, CLAUDE_IDLE] });

    const started = Date.now();
    const { result, played } = await runPlaying(box, bots, { bot: OTHER_BOT, then: () => hookReports(box, bots, 'sess-cleared', 'clear') });
    const took = Date.now() - started;

    const answer = answered(result, 'the clear on Claude Code');
    assert.ok(played, 'the premise: the hook reported the new conversation');
    assert.deepEqual(await sendsInto(box, bots, 'daily', OTHER_BOT), [...typed('/clear'), RETURN]);
    assert.deepEqual(answer.cleared, { bot: OTHER_BOT, session: 'daily', harness: 'claude', was: 'sess-daily', now: 'sess-cleared' });
    assert.ok(took < 20_000, `nothing was waited out: it took ${took} ms`);
  });

  it('A1 a Codex tab with Pi\'s at-work row right above its input line: /new is typed at once and entered, then its record line, as before', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, tab } = await otherRunning(box, 'codex');
    assert.equal(tab.agentIdentity, 'codex', 'the premise: Orca names codex in the tab');
    await changeTab(box, tab.tabId, { screen: CODEX_WITH_PI_ROW, nextScreens: [...whileTyping('codex', NEW), CODEX_NEW_TYPED, CODEX_NEW_MENU, CODEX_IDLE] });

    const started = Date.now();
    const { result, played } = await runPlaying(box, bots, {
      bot: OTHER_BOT,
      when: (sends) => sends.some((one) => one.text === RECORD_LINE),
      then: () => hookReports(box, bots, 'sess-new', 'startup'),
    });
    const took = Date.now() - started;

    const answer = answered(result, 'the clear on Codex');
    assert.ok(played, 'the premise: the line was typed and the hook reported the new conversation');
    assert.deepEqual(await sendsInto(box, bots, 'daily', OTHER_BOT), [...typed(NEW), RETURN, RETURN, { text: RECORD_LINE, enter: true }]);
    assert.deepEqual(answer.cleared, { bot: OTHER_BOT, session: 'daily', harness: 'codex', was: 'sess-daily', now: 'sess-new' });
    assert.ok(took < 20_000, `nothing was waited out: it took ${took} ms`);
  });
});

// ---------------------------------------------------------------- no space on Claude Code or Codex
//
// The space after the command is Pi's alone (#673): Claude Code's `/clear`
// and Codex's `/new` are typed and entered as before, with no space. These
// pass before the change: they hold that the change keeps the other two as
// they were.

describe('#673: Claude Code and Codex get no space', { concurrency: 2 }, () => {
  it('N1 a Claude Code tab at rest: /clear a character a send, then the return, and no space anywhere', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, tab } = await otherRunning(box, 'claude');
    await changeTab(box, tab.tabId, { screen: CLAUDE_IDLE, nextScreens: [...whileTyping('claude', '/clear'), CLAUDE_CLEAR_TYPED, CLAUDE_IDLE] });

    const { result, played } = await runPlaying(box, bots, { bot: OTHER_BOT, then: () => hookReports(box, bots, 'sess-cleared', 'clear') });

    const answer = answered(result, 'the clear on Claude Code');
    assert.ok(played, 'the premise: the hook reported the new conversation');
    const sends = await sendsInto(box, bots, 'daily', OTHER_BOT);
    assert.deepEqual(sends, [...typed('/clear'), RETURN], '/clear and the return, exactly as before');
    assert.ok(!sends.some((one) => one.text.includes(' ')), `no send holds a space, got: ${JSON.stringify(sends)}`);
    assert.deepEqual(answer.cleared, { bot: OTHER_BOT, session: 'daily', harness: 'claude', was: 'sess-daily', now: 'sess-cleared' });
  });

  it('N1 a Codex tab at rest: /new a character a send, then the return, then the answer to its question and its record line, and no space after /new', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, tab } = await otherRunning(box, 'codex');
    await changeTab(box, tab.tabId, { screen: CODEX_IDLE, nextScreens: [...whileTyping('codex', NEW), CODEX_NEW_TYPED, CODEX_NEW_MENU, CODEX_IDLE] });

    const { result, played } = await runPlaying(box, bots, {
      bot: OTHER_BOT,
      when: (sends) => sends.some((one) => one.text === RECORD_LINE),
      then: () => hookReports(box, bots, 'sess-new', 'startup'),
    });

    const answer = answered(result, 'the clear on Codex');
    assert.ok(played, 'the premise: the line was typed and the hook reported the new conversation');
    const sends = await sendsInto(box, bots, 'daily', OTHER_BOT);
    assert.deepEqual(sends, [...typed(NEW), RETURN, RETURN, { text: RECORD_LINE, enter: true }], '/new, the return, the answer and the record line, exactly as before');
    assert.notEqual(sends[NEW.length]?.text, ' ', 'no space after /new');
    assert.deepEqual(answer.cleared, { bot: OTHER_BOT, session: 'daily', harness: 'codex', was: 'sess-daily', now: 'sess-new' });
  });
});

// ---------------------------------------------------------------- skills build and Pi's row
//
// The architect's addition A, its side effect: `obk skills build` types
// `/reload` into an idle Pi tab (#659); a Pi tab whose screen shows Pi's
// at-work row is not idle, even when Orca's tui-idle answers ok.

/** The one line of a plain `skills build` report about `<bot>/<session>`, and its first word: `reloaded` or `not told`. */
function toldLine(stdout, bot, session) {
  const who = `${bot}/${session}`;
  const lines = stdout.split('\n').filter((line) => line.includes(` ${who} `) || line.endsWith(` ${who}`));
  assert.equal(lines.length, 1, `the report should have one line about ${who}, got:\n${stdout}`);
  return { line: lines[0], word: /^ {2}(.+?) {2,}/.exec(lines[0])?.[1] };
}

describe('#663: skills build and Pi\'s at-work row', { concurrency: 2 }, () => {
  for (const { screen, what } of [
    { screen: PI_WORKING, what: 'its usual row "── ⠋ Working ──…"' },
    { screen: piBusyWith('Reading the pull request'), what: 'an extension\'s own message "── ⠋ Reading the pull request ──…"' },
    ...WIDE_STATUSES,
    ...WIDE_STATUSES_DIVIDED,
  ]) {
    it(`S1 a Pi tab showing Pi at work by its top rule, ${what}, Orca's tui-idle ok: no /reload typed, not told, and it says the session is busy`, LIMIT, async (t) => {
      assertWidePremise(screen, what);
      const box = await createSandbox(t);
      const bots = await piRunning(box, { sessions: ['daily'] });
      await changeTab(box, (await liveTab(box, bots)).tabId, { screen });
      await addSkills(botYamlOf(bots, BOT), 'kit:obk-tdd');

      const result = await box.run(['skills', 'build', '--bots', 'bots']);

      assert.equal(result.code, 0, `a session not told is not a failure: ${result.stdout}${result.stderr}`);
      assert.deepEqual(sentInto(await liveTab(box, bots)).slice(1), [], 'nothing typed into a Pi tab at work: Pi refuses /reload while it works');
      const { line, word } = toldLine(result.stdout, BOT, 'daily');
      assert.equal(word, 'not told', `got: ${line}`);
      assert.match(line, /busy|working|at work/i, `it says the Pi session is busy, got: ${line}`);
      assert.match(line, /\/reload(?![-\w])/, `and to type /reload once its turn ends, got: ${line}`);
    });
  }

  for (const { screen, what } of [
    { screen: PI_IDLE, what: 'its startup help on screen' },
    { screen: PI_SUMMARY_IN_CHAT, what: 'a row "── Summary ──…" in the chat above a pure top rule' },
    { screen: PI_IDLE_DIVIDED, what: 'full-width dividers in the chat above a pure top rule' },
  ]) {
    it(`S1 the control: the same Pi tab at rest, ${what}: /reload is typed, and it is reloaded`, LIMIT, async (t) => {
      const box = await createSandbox(t);
      const bots = await piRunning(box, { sessions: ['daily'] });
      await changeTab(box, (await liveTab(box, bots)).tabId, { screen });
      await addSkills(botYamlOf(bots, BOT), 'kit:obk-tdd');

      const result = await box.run(['skills', 'build', '--bots', 'bots']);

      assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
      const sent = sentInto(await liveTab(box, bots)).slice(1);
      assert.equal(sent.map((one) => one.text).join(''), '/reload', `exactly /reload, got: ${JSON.stringify(sent)}`);
      assert.equal(sent.filter((one) => one.enter).length, 1, `sent off with one Enter, got: ${JSON.stringify(sent)}`);
      assert.equal(toldLine(result.stdout, BOT, 'daily').word, 'reloaded');
    });
  }
});
