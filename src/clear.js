// `obk session clear` and `obk session compact` (#391): the kit, not the
// harness, is asked to clear or compact a session, and does it safely.
//
// A clear is special because a cleared session has to be told its duty again.
// That is the kit's hook's work already (src/record.js): it hears the new
// conversation and answers with the start prompt. So this only types the
// harness's own command, and only when that cannot cut off a turn or answer a
// question: it waits for the session to be idle, types the command without a
// return, reads the screen, and presses return only when the screen shows the
// command and nothing else. Afterwards it confirms what happened from the
// records, not from the screen: the book's new conversation for a clear, the
// harness's own record of a compaction for a compact.

import { realpathSync, statSync } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';

import { readBook, takeTypingTurn, TYPING_HELD, TYPING_WAIT_MS } from './book.js';
import { botDir, readBot } from './bot.js';
import { claudeTranscript, codexRollout, piSession } from './conversations.js';
import { harnessOf, ownCli, shellWord } from './launch.js';
import { eachLine, firstLine } from './lines.js';
import { FEEDBACK_PANEL, feedbackPanelIn, findProject, orca, piAtWorkIn, piBox, QUESTION_ON_SCREEN, questionIn, screenRows, tabs, tabToTypeInto, TIMED_OUT } from './orca.js';
import { botsNamed, sessionsOf, typeListLine } from './up.js';

/** The harness's own command for each, as typed into its input line. Codex's and Pi's clear is `/new` (tech notes, sections 3 and 6). */
const COMMANDS = {
  clear: { claude: '/clear', codex: '/new', pi: '/new' },
  compact: { claude: '/compact', codex: '/compact', pi: '/compact' },
};

/** The pointer each harness starts its input line with (tech notes, section 1). */
const POINTER = { claude: '❯', codex: '›' };

/**
 * The line typed into Codex after its `/new`, in the architect's words (#391).
 * Codex reports a new conversation only at its first turn (tech notes, section
 * 3), so without a turn the hook never hears of it and never re-briefs it.
 */
const RECORD_LINE = 'obk: this conversation was started by obk session clear, and this line is only so the kit can record it. Reply "ok"; nothing else is asked.';

/**
 * What Codex asks after `/new`, and the one answer the kit gives it: the bot
 * home it runs in. Codex 0.162.0 calls it by another name, and its whole row
 * has to be as captured, but for the padding before its description (#516).
 */
const WHERE_TO_RUN = 'Where should the new conversation run?';
const CURRENT_CHECKOUT = /^ *› +1\. Current checkout\b|^ *› 1\. Use current Git worktree\s+Keep using the current working directory *$/;

/** Codex's empty input line: its pointer alone, or with its placeholder. */
const CODEX_EMPTY = ['›', '› Ask Codex to do anything'];

/**
 * The Codex whose input line Orca's screen shows bare while its slash menu is
 * open, whatever was typed (#391, live runs 2 to 4). On it alone, the menu's
 * selected row stands for what Return will run: with the menu open, Return
 * runs the selected command, and the menu is narrowed to what was typed
 * (codex-rs/tui/src/bottom_pane/chat_composer.rs, rust-v0.160.0). The
 * architect's ruling on #391, after live run 4. Only where Orca gives no
 * draft: a draft is the line's text, and has to be the command (#516).
 */
const CODEX_BARE_LINE = '0.160.0';

/** How long the session is given to be idle before nothing is typed, and how long each look waits on it. */
const IDLE_WAIT_MS = 30_000;
const LOOK_MS = 2000;
/**
 * How long each look between two characters waits on Orca's tui-idle, whose
 * answer it does not use: an open slash menu keeps it from answering ok (live
 * run 3 of #391). Short, so a naming holds the session's typing turn for
 * seconds (#480).
 */
const CHAR_LOOK_MS = 250;
/** How long the screen is given to show the command typed, or Codex's question after `/new`. */
const SCREEN_MS = 3000;
/** How long the book is given to hold the new conversation, and a harness to record a compaction (the architect: up to 5 minutes). */
const CLEAR_MS = 30_000;
const COMPACT_MS = 300_000;
/** How long each screen read is given before it counts as a screen that cannot be read. */
const READ_MS = 5000;
/** The pause between looks, and between looks at a record that may be large. */
const ASK_MS = 500;
const RECORD_ASK_MS = 2000;
/**
 * The gap between two characters of a command. Codex takes characters that come
 * less than 8 ms apart as a paste, and flushes a paste after 60 ms without one
 * (PASTE_BURST_CHAR_INTERVAL and PASTE_BURST_ACTIVE_IDLE_TIMEOUT in
 * codex-rs/tui/src/bottom_pane/paste_burst.rs, rust-v0.160.0). A command it
 * takes for a paste was seen to leave its input line bare (#391, live run 2),
 * so the kit types well past both.
 */
const CHAR_GAP_MS = 100;

/**
 * A row that says the harness is at work on a turn, as seen live (#391): Codex
 * 0.160.0's "• Working (8s • esc to interrupt)", and Claude Code 2.1.288's
 * spinner row, "✳ Nucleating… (1m 8s · ↓ 131 tokens)": a glyph, a word that
 * ends in "…", then the time. A finished turn's row, "✻ Churned for 13s · done
 * 12:27 PM", has no "…".
 */
const AT_WORK = [/esc to interrupt/i, /^\s*\S\s+\S+…\s+\(\d/];

/**
 * The selected row of Pi 1.3.0's slash menu, which it draws below its input
 * box (pi-tui's `select-list.js`; read in code, #663).
 */
const PI_SELECTED = /^ *→ +/;

/**
 * Clear the session: `/clear` on Claude Code, `/new` on Codex and Pi. Returns
 * `{ bot, session, harness, was, now }`, the conversation the book held before
 * (or null) and the one it holds now.
 */
export async function clearSession(bots, { bot, session }) {
  const it = sessionToType(bots, bot, session);
  const was = readBook(it.home).sessions[session]?.session ?? null;
  const { command, handle, typing } = await enter(it, 'clear');

  // Codex's question and the line after it are part of the clear, typed in
  // the typing turn it took for the command.
  try {
    if (it.harness === 'codex') {
      await answerWhereToRun(it, handle, command);
      const line = await typeListLine(it.home, it.session, it.tabId, { line: RECORD_LINE, held: true });
      if (!line.typed) {
        throw new Error(`${it.name}: ${command} went in, but the line that starts the new conversation's first turn was not typed (${line.why}), and Codex reports a new conversation only at its first turn. The book still holds ${was ?? 'no conversation'}. Look at its tab.`);
      }
    }
  } finally {
    typing.release();
  }

  const until = Date.now() + CLEAR_MS;
  for (;;) {
    const now = readBook(it.home).sessions[session]?.session;
    if (typeof now === 'string' && now !== was) return { bot, session, harness: it.harness, was, now };
    if (Date.now() >= until) {
      throw new Error(`${it.name}: ${command} went in, but after ${CLEAR_MS / 1000} s the book has no new conversation for it: it still holds ${was ?? 'none'}. Look at its tab.`);
    }
    await pause(ASK_MS);
  }
}

/**
 * Compact the session's conversation with the harness's `/compact`. Returns
 * `{ bot, session, harness, conversation, confirmed }`: confirmed once the
 * harness's own record of the conversation shows a compaction made after the
 * command began, and not yet when COMPACT_MS passed without one.
 */
export async function compactSession(bots, { bot, session }) {
  const it = sessionToType(bots, bot, session);
  // What the record holds when /compact is typed is not this compact's: one
  // that ends while the kit waits for the session to be idle is the one
  // before it (review of PR #466). So only what is written after counts.
  let record;
  const { typedAt, typing } = await enter(it, 'compact', () => {
    record = recordAt(it.harness, it.home, readBook(it.home).sessions[session]?.session ?? null);
  });
  typing.release();

  const until = typedAt + COMPACT_MS;
  for (;;) {
    const conversation = readBook(it.home).sessions[session]?.session ?? null;
    // A conversation the book did not hold when it was typed is read whole.
    if (conversation !== record.id) record = { id: conversation, from: 0 };
    record.file ??= recordFile(it.harness, it.home, conversation);
    if (record.file !== undefined && compactedSince(it.harness, record, typedAt)) {
      return { bot, session, harness: it.harness, conversation, confirmed: true };
    }
    if (Date.now() >= until) return { bot, session, harness: it.harness, conversation, confirmed: false };
    await pause(RECORD_ASK_MS);
  }
}

/**
 * The session as something to type into, once everything that refuses before
 * Orca is asked to type has been asked: `{ name, home, session, harness, tabId }`.
 */
export function sessionToType(bots, bot, session) {
  botsNamed(bots, bot);
  const home = realpathSync(botDir(bots, bot));
  const known = readBot(home, bot);
  const [settings] = sessionsOf(known, session);
  const name = `${bot} ${session}`;
  const unpause = `${shellWord(ownCli())} unpause --bots ${shellWord(bots)} --bot ${bot}`;
  if (known.paused === true) throw new Error(`${bot} is paused, so ${name} is not running and nothing was typed. Bring it back with ${unpause}.`);
  if (settings.paused === true) throw new Error(`${name} is paused, so it is not running and nothing was typed. Bring it back with ${unpause} --session ${session}.`);

  const tabId = readBook(home).sessions[session]?.tab;
  // Orca refuses to list the tabs of a folder it has no project for (tech
  // notes, section 1), so a bot never brought up is asked nothing.
  const open = typeof tabId === 'string' && findProject(home) !== undefined && tabs(home).some((tab) => tab.tabId === tabId);
  if (!open) {
    throw new Error(`${name} has no tab open in Orca, so it is not running and nothing was typed. Bring it up with ${shellWord(ownCli())} up --bots ${shellWord(bots)} --bot ${bot} --session ${session}.`);
  }
  return { name, home, session, harness: harnessOf(settings, known.harness), tabId, restart: `${shellWord(ownCli())} restart --bots ${shellWord(bots)} --bot ${bot} --session ${session}` };
}

/**
 * Type the harness's command for `verb` into the session's tab and press
 * return, once it is idle and the screen shows the command typed and nothing
 * else. `before` runs just before the command is typed. Returns the command,
 * the handle it went into, when it was typed, and the session's typing turn
 * (#482), taken once it is idle, as the naming takes it, and held for the
 * caller to release.
 */
async function enter(it, verb, before = () => {}) {
  let typing;
  try {
    const typed = await typeCommand(it, COMMANDS[verb][it.harness], {
      before: () => {
        typing = takeTypingTurn(it.home, it.session, TYPING_WAIT_MS);
        if (typing === undefined) throw new Error(`${it.name}: ${TYPING_HELD}. Run this again in a moment.`);
        before();
      },
      cannot: (wrong) => (verb === 'compact' && wrong.menu && it.harness === 'codex' ? ` ${harnessName(it.harness)} here cannot compact: its menu does not offer ${COMMANDS[verb][it.harness]}.` : ''),
      close: it.harness === 'pi' ? PI_CLOSE : undefined,
    });
    return { ...typed, typing };
  } catch (error) {
    typing?.release();
    throw error;
  }
}

/**
 * Type `command` into the session's tab, `it` as `sessionToType` gives it, and
 * press return, once it is idle and `check` finds nothing wrong with the
 * screen: by default the slash menu's check, which a command with words after
 * it does not pass, since Codex closes its menu at the space (#480). `before`
 * runs just before the command is typed; `cannot` adds to a refusal what a
 * wrong screen means; `close`, `{ key, check }`, is one more key typed once
 * `check` passes, and its own check of the screen before the return; past
 * `deadline`, a time, what was typed is taken back and nothing is entered;
 * `whole` sends the command in one write and not a character a send; `last`
 * runs after the last look, with nothing between it and the first key.
 * Returns the command, the handle it went into, and when it was typed.
 */
export async function typeCommand(it, command, { before = () => {}, check = menuWrong, cannot = () => '', close, deadline = Infinity, whole = false, last = () => {} } = {}) {
  // Nothing may be in the input line before: no draft for the command to join.
  // Orca gives a draft in the line beside the screen, and the screen's line
  // then reads the pointer alone (#510, #516). Where it gives none, Codex's
  // line on the screen has to be empty, and so do Pi's editor rows.
  const emptyLine = ({ rows, draft }) => {
    if (draft !== undefined) throw new Error(`${it.name}: nothing was typed, because its input line holds a draft: it reads "${draft}".${shownEnd(rows)}`);
    if (it.harness === 'pi') {
      const box = piBox(rows);
      if (box === undefined) throw new Error(`${it.name}: nothing was typed, because its screen shows no input box.${shownEnd(rows)}`);
      const line = box.editor.map((row) => row.trim()).filter((row) => row !== '').join(' ⏎ ');
      if (line !== '') throw new Error(`${it.name}: nothing was typed, because its input line is not empty: it reads "${line}".${shownEnd(rows)}`);
      return;
    }
    if (it.harness !== 'codex') return;
    const line = rows.findLast((row) => /^ *›/.test(row))?.trim();
    if (!CODEX_EMPTY.includes(line)) {
      throw new Error(`${it.name}: nothing was typed, because its input line is not empty: it reads "${line ?? 'nothing'}".${shownEnd(rows)}`);
    }
  };
  emptyLine(await idleTab(it));
  const version = it.harness === 'codex' ? codexVersion(readBook(it.home).sessions[it.session]?.session) : undefined;

  before();
  // What `before` waited for can have changed the session: one more look,
  // with no wait, before the first key (#480 review).
  const ready = lookAt(it);
  if (ready.why !== undefined) throw new Error(`${it.name}: nothing was typed, because ${ready.why}.`);
  emptyLine(ready);
  last();
  const { handle } = ready;
  const typedAt = Date.now();
  // One character a send, each after a look through the gate, so nothing goes
  // in as one burst and nothing goes in once something asks a question
  // (the architect's ruling on #391, after live run 2).
  // Between characters, and once more before the return, the look is the gate
  // and the harness's own at-work row, not Orca's tui-idle: an open slash menu
  // can stop it answering ok (live run 3).
  // The characters Orca took, and so what is in the input line of ours.
  let typed = 0;
  // Taken back, one backspace a character, in one send, so the input line is
  // as it was. Whatever stops the typing takes them back, a send Orca refused
  // or a look that threw included (#480 review); a take-back Orca refuses
  // too leaves nothing more the kit can do.
  const takeBack = () => {
    const keys = '\x7f'.repeat(typed);
    typed = 0;
    if (keys === '') return;
    try {
      send(handle, keys);
    } catch {
      // Said by the error that stopped the typing.
    }
  };
  const lookAgain = async () => {
    await pause(CHAR_GAP_MS);
    const look = lookAt(it, { idle: false });
    // Past the caller's deadline nothing more goes in: a hook stopped partway
    // would leave the text in the input line (#480 review).
    if (look.why === undefined && Date.now() > deadline) look.why = 'its time ran out';
    if (look.why === undefined) return;
    const sofar = command.slice(0, typed);
    takeBack();
    throw new Error(`${it.name}: ${command} was being typed, and after ${sofar} ${look.why}, so what was typed was taken back and nothing was entered.`);
  };
  const typeKey = (keys) => {
    try {
      send(handle, keys);
    } catch (error) {
      // A send Orca did not answer in time may have gone in all the same.
      // Counted only where the line was empty before the first key, so the
      // one backspace too many can take nothing of the user's (#480 review).
      if (error.code === TIMED_OUT && (it.harness === 'codex' || it.harness === 'pi')) typed += [...keys].length;
      throw error;
    }
    typed += [...keys].length;
  };
  try {
    // Whole, a write Orca's own notice cannot land inside (#713).
    if (whole) typeKey(command);
    else {
      for (const char of command) {
        if (typed > 0) await lookAgain();
        typeKey(char);
      }
    }
    await lookAgain();
    let wrong = await typedWrong(handle, it.harness, command, version, check);
    if (wrong === undefined && close !== undefined) {
      await lookAgain();
      typeKey(close.key);
      await lookAgain();
      wrong = await typedWrong(handle, it.harness, command, version, close.check);
    }
    if (wrong === undefined && Date.now() > deadline) wrong = { why: 'its time ran out' };
    if (wrong !== undefined) {
      takeBack();
      throw new Error(`${it.name}: ${command} was typed but not entered, and was taken back, because ${wrong.why}.${cannot(wrong)}${shownEnd(wrong.rows)}`);
    }
    // A return of its own, not `--enter`: Orca's gate can refuse a line sent
    // with `--enter` while it names a reason, and on Codex a return inside the
    // text lands in the draft (helpers in the system tests, #329).
    send(handle, '\r');
    typed = 0;
  } catch (error) {
    takeBack();
    throw error;
  }
  return { command, handle, typedAt };
}

/**
 * The handle of the session's tab once the session is idle, with nothing on
 * its screen to answer, within IDLE_WAIT_MS. Busy is Orca's `tui-idle` not
 * answering ok, or a screen that says it is at work: Orca can call a busy
 * Codex idle. Throws when the tab holds no harness, and when the wait ran out.
 */
async function idleTab(it) {
  const until = Date.now() + IDLE_WAIT_MS;
  for (;;) {
    const look = lookAt(it);
    if (look.moved) throw new Error(`${it.name}: nothing was typed, because ${look.why}.`);
    let why = look.why;
    // The wait is a cutoff, not a count of looks: a yes that comes after it
    // is too late (as for LIST_LINE, review of PR #421).
    if (why === undefined && Date.now() >= until) why = 'the look that found it idle came only after the wait was up';
    if (why === undefined) return look;
    if (Date.now() >= until) throw new Error(`${it.name}: nothing was typed, because after ${IDLE_WAIT_MS / 1000} s ${why}. Run this again once it is idle.`);
    await pause(ASK_MS);
  }
}

/**
 * One look through the typing gate at the session's tab: `{ handle, rows, draft }` when
 * nothing on its screen asks a question and nothing says it is at work, and,
 * with `idle`, Orca's tui-idle answered ok; or `{ why }`, naming the signal,
 * with `moved` when the book holds another tab for the session now, or, where
 * `it.conversation` is given, another conversation.
 * Throws when the tab holds no harness.
 */
function lookAt(it, { idle = true } = {}) {
  // A restart can give the session a new tab while this waits or types, and
  // a hook can outlive its Codex (#480): only the tab the book holds is the
  // session's.
  const entry = readBook(it.home).sessions[it.session];
  if (entry?.tab !== it.tabId) return { moved: true, why: `the book no longer holds its tab ${it.tabId} for it, but ${entry?.tab ?? 'none'}` };
  // And, for a caller typing for one conversation, a `/new` in the same tab
  // gives the session another (#480 review).
  if (it.conversation !== undefined && entry.session !== it.conversation) {
    return { moved: true, why: `the book no longer holds the conversation ${it.conversation} for it, but ${entry.session ?? 'none'}` };
  }
  const found = tabToTypeInto(it.home, it.tabId, idle ? LOOK_MS : CHAR_LOOK_MS);
  if (found.blocked !== undefined) {
    return {
      why: found.blocked === FEEDBACK_PANEL ? PANEL_WHY
        : found.blocked === QUESTION_ON_SCREEN ? 'a question of its harness\'s own is on its screen'
        : `a question is waiting on its screen: Orca says ${found.blocked}`,
    };
  }
  if (found.unsure !== undefined) return { why: found.unsure };
  if (found.handle === undefined) {
    throw new Error(`${it.name} is not running: its tab is open with no harness in front of it, so its harness quit or crashed, and nothing was typed. ${it.restart} brings it back.`);
  }
  if (found.agent !== it.harness) return { why: `Orca names ${found.agent} in it, and the session runs on ${it.harness}` };
  // The gate has read the screen already: it saw no question on it.
  const signal = signalIn(found.rows, it.harness);
  if (signal !== undefined) return { why: signal };
  if (idle && !found.idle) return { why: 'it is busy with a turn: Orca\'s tui-idle did not answer ok' };
  return { handle: found.handle, rows: found.rows, draft: found.draft };
}

/**
 * Why the screen does not show `command` typed and ready, or undefined when it
 * does, as `check` reads it: for a slash command alone, the input line, the
 * lowest row the harness's pointer starts, reads the pointer and the command
 * and nothing else, and the slash menu's selected row names the command.
 * `menu` is set when the input line was right and the menu was not. Read
 * again for SCREEN_MS while it is not so: a screen
 * takes a moment to draw what was typed.
 */
async function typedWrong(handle, harness, command, version, check) {
  const until = Date.now() + SCREEN_MS;
  for (;;) {
    const seen = screenRows(handle, READ_MS);
    // The screen that lets the return in has to pass the look too: a turn or
    // a question that shows on it stops it at once (review of c1e5ba4).
    const signal = seen.rows === undefined ? undefined : signalIn(seen.rows, harness);
    if (signal !== undefined) return { why: signal, rows: seen.rows };
    const wrong = seen.rows === undefined ? { why: `its screen could not be read (${seen.unreadable})` } : check(seen.rows, harness, command, version, seen.draft);
    if (wrong === undefined || Date.now() >= until) return wrong && { ...wrong, rows: seen.rows };
    await pause(ASK_MS);
  }
}

/**
 * Why nothing goes in while Claude Code's panel of feedback drafts is open
 * (#502): it reads single keys from the input line, and one sends a draft to
 * Anthropic, so only the user answers it.
 */
const PANEL_WHY = 'its panel of feedback drafts is open above its input box, and the kit does not answer it, since a draft sent from it goes to Anthropic: it clears once the user reviews, sends or dismisses the drafts in that tab';

/** Why `rows` of `harness` say not to type now, as the look says it, or undefined: a turn at work, or a question. */
function signalIn(rows, harness) {
  const working = rows.find((row) => AT_WORK.some((marker) => marker.test(row))) ?? piAtWorkIn(rows, harness);
  if (working !== undefined) return `it is busy with a turn: its screen shows "${working.trim()}"`;
  if (feedbackPanelIn(rows)) return PANEL_WHY;
  if (questionIn(rows)) return 'a question of its harness\'s own is on its screen';
  return undefined;
}

function menuWrong(rows, harness, command, version, draft) {
  if (harness === 'pi') return piMenuWrong(rows, command, draft);
  const at = rows.findLastIndex((row) => /^ *[›❯]/.test(row));
  if (at < 0) return { why: 'its screen shows no input line' };
  // Claude Code 2.1.288 puts a non-breaking space after its pointer (live run 4).
  const line = rows[at].replaceAll('\u00a0', ' ').trim();
  // Orca 1.4.223 gives the line's text as the draft, and the line on the
  // screen then reads the pointer alone: Claude Code 2.1.296's (#510, probe 4)
  // and Codex 0.162.0's (#516).
  const text = draft === undefined ? line : `${POINTER[harness]} ${draft}`;
  if (harness === 'codex') return codexMenuWrong(rows, at, text, command, version);
  if (text !== `${POINTER[harness]} ${command}`) return { why: `its input line reads "${text}"` };
  return claudeMenuWrong(rows, at, command);
}

/**
 * Claude Code 2.1.288 draws its slash menu above its input box's top rule, a
 * row of ─: a row per command, starting with it, its description wrapped onto
 * rows set far in (live run 4). No pointer marks a selection, so the first
 * command row there has to be the command. Claude Code 2.1.296 starts the
 * selected row with its pointer, `  ❯ /compact`, and that row has to be the
 * command (#510, probes 1 and 2). The menu's pointer is above the rule, the
 * input line's below it, so the one is never taken for the other.
 */
function claudeMenuWrong(rows, at, command) {
  const rule = rows.slice(0, at).findLastIndex((row) => /^\s*─{3}/.test(row));
  const menu = [];
  for (let up = rule - 1; up >= 0 && (/^ {1,4}(?:❯ +)?\/\S/.test(rows[up]) || /^ {20,}\S/.test(rows[up])); up -= 1) menu.unshift(rows[up]);
  const pointed = menu.find((row) => /^ {1,4}❯ +\//.test(row));
  const selected = pointed === undefined ? menu.find((row) => /^ {1,4}\//.test(row)) : pointed.replace(/^ *❯ +/, '');
  if (rule < 0 || selected === undefined) return { why: 'no menu of commands came up above its input box', menu: true };
  if (selected.trim().split(/\s+/)[0] !== command) return { why: `the ${pointed === undefined ? 'first' : 'selected'} row of its menu is "${selected.trim()}"`, menu: true };
  return undefined;
}

/**
 * Codex draws its slash menu above the input line: a row per command, the
 * selected one starting with its pointer, then a blank row on 0.160.0 and none
 * on 0.162.0, then the input line (its own snapshot tests, chat_composer
 * slash_popup_*.snap, rust-v0.160.0; live run 4; #516's probe). The menu has
 * to hold one command row, the selected one, naming the command. The input
 * line, Orca's draft where it gives one, reads the command, or, with no draft
 * on the Codex whose line Orca shows bare, its pointer alone.
 */
function codexMenuWrong(rows, at, line, command, version) {
  const bare = line === '›' && version === CODEX_BARE_LINE;
  if (line !== `› ${command}` && !bare) {
    const why = line === '›' ? `its input line reads "›" and this Codex is ${version ?? 'of a version its record does not give'}, not ${CODEX_BARE_LINE}` : `its input line reads "${line}"`;
    return { why };
  }
  const menu = [];
  for (let up = at - 1; up >= 0 && (rows[up].trim() === '' || /^ *(?:› +)?\/\S/.test(rows[up])); up -= 1) menu.unshift(rows[up]);
  const commands = menu.filter((row) => row.trim() !== '');
  if (commands.length === 0) return { why: 'no menu of commands came up above its input line', menu: true };
  if (commands.length > 1) return { why: `its menu offers more than one command: ${commands.map((row) => `"${row.trim()}"`).join(', ')}`, menu: true };
  if (!/^ *› +/.test(commands[0])) return { why: `its menu's one row "${commands[0].trim()}" is not selected`, menu: true };
  const selected = commands[0].replace(/^ *› +/, '');
  if (selected.split(/\s+/)[0] !== command) return { why: `the selected row of its menu is "${selected.trim()}"`, menu: true };
  return undefined;
}

/**
 * With the slash menu open, Return in Pi 1.3.0 runs the selected row's
 * command (pi-tui's `editor.js`, `tui.select.confirm`; read in code, #663).
 * So the editor's one row, or Orca's draft where it gives one, reads the
 * command, and the selected row below the box names it. A menu still drawn
 * for an earlier part of the command looks the same when its selected row is
 * the command too, and this cannot tell it apart: PI_CLOSE does.
 */
function piMenuWrong(rows, command, draft) {
  const box = piBox(rows);
  if (box === undefined) return { why: 'its screen shows no input box' };
  const lines = box.editor.map((row) => row.trim()).filter((row) => row !== '');
  const line = draft ?? lines.join(' ⏎ ');
  if (line !== command || (draft === undefined && lines.length !== 1)) return { why: `its input line reads "${line}"` };
  const selected = box.below.find((row) => PI_SELECTED.test(row));
  if (selected === undefined) return { why: 'no menu of commands came up below its input box', menu: true };
  const name = selected.replace(PI_SELECTED, '').trim().split(/\s+/)[0];
  if (`/${name}` !== command) return { why: `the selected row of its menu is "${selected.trim()}"`, menu: true };
  return undefined;
}

/**
 * Pi 1.3.0 applies a menu list still drawn from an earlier key against that
 * key's prefix, so `/compact` under a list for `/compa` submits `/ccompact`,
 * and `/new` under one for `/n` submits `/nnew`; the screen cannot tell that
 * list from a fresh one. A space makes Pi list `/compact ` or `/new `, for
 * which it has nothing, and so close the menu; with no menu, Return submits
 * the line trimmed, the command (tech notes, section 6; #671, #673).
 */
const PI_CLOSE = { key: ' ', check: (rows, harness, command, version, draft) => piClosedWrong(rows, command, draft) };

/**
 * Why the screen does not show Pi's editor reading `command`, a space after
 * it, with no menu below the box, or undefined when it does. A list still
 * drawn has its selected row.
 */
function piClosedWrong(rows, command, draft) {
  const box = piBox(rows);
  if (box === undefined) return { why: 'its screen shows no input box' };
  const lines = box.editor.map((row) => row.trim()).filter((row) => row !== '');
  const line = draft?.trim() ?? lines.join(' ⏎ ');
  if (line !== command || (draft === undefined && lines.length !== 1)) return { why: `its input line reads "${line}" after the space` };
  const selected = box.below.find((row) => PI_SELECTED.test(row));
  if (selected !== undefined) return { why: `a menu is still below its input box after the space, its selected row "${selected.trim()}"` };
  return undefined;
}

/** The Codex version that wrote the rollout of `conversation`, from its session_meta line; undefined when that cannot be read. */
function codexVersion(conversation) {
  const file = typeof conversation === 'string' ? codexRollout(conversation) : undefined;
  if (file === undefined) return undefined;
  try {
    const version = JSON.parse(firstLine(file) ?? 'null')?.payload?.cli_version;
    return typeof version === 'string' ? version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Answer Codex's "Where should the new conversation run?" with "1. Current
 * checkout", the bot home, when it comes up after `/new`. With its selection
 * anywhere else it is backed out of with Esc: the kit never makes a worktree
 * (PRD 6.2).
 */
async function answerWhereToRun(it, handle, command) {
  const until = Date.now() + SCREEN_MS;
  for (;;) {
    const rows = screenRows(handle, READ_MS).rows ?? [];
    if (rows.some((row) => row.includes(WHERE_TO_RUN))) {
      const pointer = rows.findLast((row) => /^ *›/.test(row));
      if (pointer === undefined || !CURRENT_CHECKOUT.test(pointer)) {
        send(handle, '\x1b');
        throw new Error(`${it.name}: after ${command}, Codex asked "${WHERE_TO_RUN}" with its selection on "${pointer?.trim() ?? 'nothing'}" rather than "1. Current checkout" (on Codex 0.162.0, "1. Use current Git worktree"), so it was backed out of with Esc and nothing else was typed. Look at its tab.`);
      }
      send(handle, '\r');
      return;
    }
    if (Date.now() >= until) return;
    await pause(ASK_MS);
  }
}

/** Where the harness keeps the record of `conversation`, or undefined when it has none yet. */
function recordFile(harness, home, conversation) {
  if (conversation === null) return undefined;
  if (harness === 'pi') return piSession(home, conversation);
  return harness === 'claude' ? claudeTranscript(home, conversation) : codexRollout(conversation);
}

/** The record of `conversation` as it is now: `{ id, file, from }`, `from` the byte it ends at. */
function recordAt(harness, home, conversation) {
  const file = recordFile(harness, home, conversation);
  let from = 0;
  try {
    from = file === undefined ? 0 : statSync(file).size;
  } catch {
    // Not written yet: everything in it will be new.
  }
  return { id: conversation, file, from };
}

/**
 * Whether the record holds, from its byte `from` on, a compaction made at
 * `since` or later. Read a line at a time: a record can be larger than one
 * string holds (#396).
 */
function compactedSince(harness, record, since) {
  let found = false;
  try {
    eachLine(record.file, (line) => {
      // Only a line that names a compaction is worth parsing.
      if (line === undefined || !line.includes('compact')) return false;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        return false;
      }
      // Claude Code's marker, Codex's, and Pi's (tech notes, sections 2, 3 and 6).
      const compaction = harness === 'claude' ? entry?.type === 'system' && entry.subtype === 'compact_boundary'
        : harness === 'pi' ? entry?.type === 'compaction'
        : entry?.type === 'compacted';
      found = compaction && Date.parse(entry.timestamp) >= since;
      return found;
    }, { from: record.from });
  } catch {
    return false;
  }
  return found;
}

/**
 * The last rows of the screen with words in them, as a sentence for a refusal,
 * so whoever reads it sees what the harness drew there.
 */
function shownEnd(rows) {
  const shown = (rows ?? []).filter((row) => row.trim() !== '').slice(-SHOWN_ROWS);
  return shown.length === 0 ? '' : ` Its screen ended: ${shown.map((row) => row.trimEnd()).join(' ⏎ ')}`;
}

/** How many rows of the screen a refusal shows. */
const SHOWN_ROWS = 12;

/** How long Orca is given to take one send: a send it never answers must not hold the caller (#480 review). */
const SEND_MS = 5000;

/** Type `keys` into the tab as they are, with no return of Orca's. */
const send = (handle, keys) => orca(['terminal', 'send', '--terminal', handle, '--text', keys], { timeoutMs: SEND_MS });

const harnessName = (harness) => ({ claude: 'Claude Code', codex: 'Codex', pi: 'Pi' })[harness];
