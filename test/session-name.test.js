// `obk session name`: the kit names a Codex session's thread `<bot>.<session>`,
// so the tab Codex titles with the thread's name says which bot and session it
// is (#480).
//
//   obk session name --bots <path> --bot <bot>
//
// A hook command, run by Codex at each turn end from the kit's async `Stop`
// hook, never by a person. The requirement, with the architect's ruling on
// #480 (2026-10-04), as these tests hold it:
//
//   - It reads Codex's hook JSON on stdin and the tab from ORCA_TAB_ID, as
//     `obk session record` and `obk session nudge` do. The session is the one
//     whose tab in the bot's book is that tab.
//   - It always exits 0 and writes nothing on stdout, whatever happens: bad
//     JSON, no tab, an unknown tab, an Orca that fails, a refusal. It never
//     fails the turn and never gives Codex a decision.
//   - It acts only when `hook_event_name` is `Stop`, the tab belongs to a
//     session of this bot, that session runs on Codex, and `session_id` is the
//     conversation the book holds for that session (`sessions.<name>.session`;
//     added by the developer of #480, for #408: a Codex Orca restored on its
//     own runs its hooks under another session's tab). Otherwise it calls no
//     Orca command at all.
//   - The name is `<bot>.<session>`, with no token.
//   - Cheap when done: when the newest line for `session_id` in
//     `$HOME/.codex/session_index.jsonl` has `thread_name` equal to the name,
//     it calls no Orca command and types nothing. An older line with the name
//     does not count when a newer line for the same id names it otherwise, and
//     lines for other ids do not count.
//   - Otherwise it types through the safe path `obk session clear` takes on
//     Codex (#391; session-clear.test.js's header has its rules):
//       1. It waits up to 30 s for the session to be idle with nothing on its
//          screen to answer. Busy is Orca's `tui-idle` not answering ok, or a
//          screen row that says "esc to interrupt". A question on the screen,
//          or a reason Orca gives for a blocked tab, is waited out too. Still
//          not idle at 30 s: nothing is typed.
//       2. The input line is empty or shows its placeholder before the
//          command goes in. Otherwise nothing is typed.
//       3. The mailbox gate (#713). After the idle wait, the empty-line check
//          and the typing turn, and immediately before the command goes in,
//          it reads the session's own Orca mailbox: the Run the book names as
//          `sessions.<session>.mailbox`, with `orchestration inbox --terminal
//          run:<id> --limit <n>`, as `obk health` reads it. A letter that is
//          unread (`read` 0) and has no delivery yet (`delivered_at` null)
//          means Orca is about to type its notice into the tab, so nothing is
//          typed into the tab at all, and it exits 0: the next turn end tries
//          again. Letters that are read, or delivered (read or not), do not
//          stop it. An inbox Orca refuses to answer: nothing is typed. A
//          session with no mailbox in the book: it goes on as before.
//       4. It types `/rename <bot>.<session>` as one write: the whole text in
//          one `terminal send`, without --enter, not one character a send
//          (#713: Orca's notice, one write of its own, joined a command typed
//          a character at a time). Then a look through the typing gate. If
//          the gate refuses, or anything stops it once the text went in, the
//          text is taken back, exactly as many backspaces (\x7f) as the
//          command has characters, in one send, and it stops.
//       5. Then it reads the screen: the input line, the lowest row starting
//          with `›`, reads exactly `› /rename <bot>.<session>`, or, where Orca
//          gives a draft, the draft is exactly the command; no slash-menu row
//          stands above the line; and no text stands under the line before
//          Codex's status row (the row like `  GPT-6.1-Sol default · <path> ·
//          …`: two spaces, the model, then ` · `). A blank row there is not
//          text. Otherwise the text is taken back, one backspace per
//          character, in one send, nothing is entered, and it stops.
//       6. The return is a send of its own: `\r`, without --enter.
//       7. It confirms the name in session_index.jsonl, waiting up to 10 s.
//          Confirmed or not, it exits 0.
//   - Nothing goes into any tab but the session's own.
//   - One naming at a time per session: while one run for a session is at
//     work, a second one for the same session types nothing.
//   - A run that typed nothing tries again at the next turn end; there is no
//     retry inside one run beyond the waits above.
//
// What Codex 0.160.0 does, read in its source at rust-v0.160.0 and not seen
// live: `/rename <name>` appends `{"id","thread_name","updated_at"}` to
// `~/.codex/session_index.jsonl`, a file that only grows, the newest line for
// an id winning. A Stop hook gets `{ session_id, turn_id, transcript_path,
// cwd, hook_event_name: "Stop", model, permission_mode, stop_hook_active,
// last_assistant_message }`, `session_id` the thread id. Once a space follows
// the command name Codex closes its slash menu, so with the whole command
// typed the screen has no menu rows and the input line shows the text.
//
// What Orca does with mail (#713, the cause on the issue): it writes its
// notice, `\nYou have 1 orchestration message. Run \`orca orchestration check
// --run <id>\`.\n`, into an idle Codex tab in one write, and Enter 500 ms
// later, without looking at the input line. A letter it is about to ring for
// is unread with no `delivered_at` in the Run's inbox.
//
// How Codex is played here. The fake Orca types nothing anywhere and runs no
// hook. The hook is run the way Codex runs it, under the process chain a tab
// really has (helpers/cli.js `throughAHarness`), and with the command alone,
// without the `2>/dev/null || true` the installed line adds, so its own exit
// code is what the test sees. Each send into the tab moves its screen on
// (`nextScreens`, helpers/fake-orca.js), and the screens below are given in
// order. Orca's inbox for a Run is the fake's `inbox`, letters in Orca's own
// words (helpers/fake-orca.js, as test/health-mail-unannounced.test.js gives
// them). Codex's own part after the return, the line in session_index.jsonl,
// is written by the test once the return has gone in.
//
// The fake Orca keeps no clock: a tab that goes idle in time is a `waitIdle`
// list, and one that never does costs the full 30 s. Those tests run side by
// side at the end of this file.
//
// Every expected value comes from the requirement: the name, the command, the
// keys and the record's line.

import assert from 'node:assert/strict';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import test, { describe, it } from 'node:test';
import { parse, stringify } from 'yaml';

import {
  bookOf,
  botHomeOf,
  conversationOnRecord,
  createSandbox,
  harnessChain,
  orcaCallsOf,
  orcaCommand,
  orcaFlag,
  recordSession,
  sessionIn,
  sessionStart,
  shellWord,
  tabsOfBot,
  throughAHarness,
} from './helpers/cli.js';
import {
  CLAUDE_FEEDBACK_PANEL,
  CLAUDE_TEACH_LIST,
  CODEX_162_DRAFT,
  CODEX_162_IDLE,
  CODEX_162_PLACEHOLDER_DRAFT,
  CODEX_ANSWERED,
  CODEX_DRAFT,
  CODEX_IDLE,
  CODEX_IDLE_EMPTY,
  CODEX_UPDATE_OFFER,
  CODEX_WORKING,
  codex162With,
} from './helpers/screens.js';
import { linesTurnWanted, typingTurnHeld, withLinesTurnHeld, withTypingTurnHeld } from './helpers/typing-turn.js';

const BOT = 'api-bot';

/** The name the kit gives each session's thread: `<bot>.<session>`, no token. */
const NAME = `${BOT}.daily`;

/** What the kit types for daily: Codex's own command, with the name. */
const RENAME = `/rename ${NAME}`;

/** A Codex thread id for each session, of the shape Codex gives one. */
const THREADS = {
  daily: '0199c0de-4800-7000-8000-00000000da11',
  review: '0199c0de-4800-7000-8000-0000000e7e1e',
};

/** The command as the kit types it: the whole text in one send, with no return (#713). */
const typed = (command) => [{ text: command, enter: false }];

/** One backspace per character of `text`, as the one send that takes it back. */
const backspaces = (text) => '\x7f'.repeat(text.length);

/** The command typed, and then its return as a send of its own. */
const renamed = (command = RENAME) => [...typed(command), { text: '\r', enter: false }];

// ---------------------------------------------------------------- the screens
//
// Codex 0.160.0 as it shows `/rename` once it is written. Reconstructions, but
// for the rows they take from helpers/screens.js's captures: CODEX_ANSWERED's
// box, answered turn, tip and status rows. The popup's layout is live run 4's
// of #391 (helpers/screens.js), the popup above the input line and the line a
// bare `›` while it is open. The words of the `/rename` row after the command
// are made up here. With the whole command typed, the menu closed and the line
// showing the text is read in Codex's source, not seen live.

/** Codex's screen above its popup: the box and the answered turn (CODEX_ANSWERED, a capture). */
const ABOVE_POPUP = CODEX_ANSWERED.slice(0, 11);

/** Codex's screen above its input line: the box, the answered turn and the tip row (CODEX_ANSWERED, a capture). */
const ABOVE_INPUT = CODEX_ANSWERED.slice(0, 12);

/** Codex's status row under its input line, as live run 4 of #391 showed it, the folder as Codex shortened it. */
const STATUS = '  GPT-6-Luna medium · /private/var/folders/…/bots/api-b…';

/** `/rename`'s row in the popup, selected. The words after the command are made up. */
const RENAME_ROW = '› /rename  rename the current thread';

/** The same row, not selected. */
const RENAME_ROW_UNSELECTED = '  /rename  rename the current thread';

/** Codex at work, as live run 3 of #391 showed its row. */
const WORKING_ROW = '• Working (8s • esc to interrupt)';

/** Codex with `popup` above its input line, a blank row between, and `input` as the line. */
const popup = (rows, input = '›') => [...ABOVE_POPUP, ...rows, '', input, STATUS];

/** Codex with no popup, its input line showing `text`. */
const shown = (text) => [...ABOVE_INPUT, `› ${text}`, STATUS];

/** The whole command typed: no menu, and the input line reads it exactly. */
const RENAME_TYPED = shown(RENAME);

/** The screens a tab shows as the kit names daily: the command written in one send, then, after the return, the idle line. */
const NAMING_SCREENS = [RENAME_TYPED, CODEX_IDLE];

/**
 * Orca's mail notice as it writes it into a tab (#713, seen in
 * ~/.codex/session_index.jsonl on the owner's machine), its middle line as the
 * screen shows it under the input line: two spaces, as Codex lines up the rows
 * of its input under the pointer's text. The Run id is made up. A
 * reconstruction, not a capture.
 */
const NOTICE = 'You have 1 orchestration message. Run `orca orchestration check --run run_x`.';
const NOTICE_ROW = `  ${NOTICE}`;

/**
 * The whole command written, and Orca's notice under it before the status row:
 * the screen of #713 on Codex 0.160.0's rows, `blank` rows between the line and
 * the notice. A reconstruction, not a capture.
 */
const noticeUnder = (command = RENAME, blank = 0) => [...ABOVE_INPUT, `› ${command}`, ...Array(blank).fill(''), NOTICE_ROW, STATUS];

/** Codex at work, with the popup and a bare input line below the at-work row. */
const workingOver = (rows) => [...ABOVE_POPUP.slice(0, 9), WORKING_ROW, '', ...rows];

// ---------------------------------------------------------------- the fleet

/**
 * A bots folder with api-bot on Codex and its sessions named, each brought up,
 * with a conversation the book holds and Codex has on record (its thread id
 * from THREADS, its rollout's first line naming Codex `cliVersion`, 0.160.0
 * unless a test says otherwise), as a session that has had a turn has them.
 * `claude` adds sessions of api-bot that run on Claude Code; `others` adds
 * bots on Codex, each with a `daily` session.
 */
async function running(box, { sessions = ['daily', 'review'], claude = [], others = [], cliVersion = '0.160.0' } = {}) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  for (const bot of [BOT, ...others]) {
    const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', 'codex']);
    assert.equal(made.code, 0, made.stderr);
  }
  const adds = [
    ...sessions.map((name) => [BOT, name, []]),
    ...claude.map((name) => [BOT, name, ['--harness', 'claude']]),
    ...others.map((bot) => [bot, 'daily', []]),
  ];
  for (const [bot, name, flags] of adds) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', name, ...flags]);
    assert.equal(added.code, 0, added.stderr);
  }
  const bots = box.path('bots');
  for (const bot of [BOT, ...others]) {
    const up = await box.run(['up', '--bots', 'bots', '--bot', bot]);
    assert.equal(up.code, 0, `the up this test stands on: ${up.stdout}${up.stderr}`);
  }
  for (const name of sessions) {
    const tab = await liveTab(box, bots, name);
    const heard = await recordSession(box, { bots, bot: BOT, tab: tab.tabId, session: THREADS[name] });
    assert.equal(heard.code, 0, `the hook report this test stands on: ${heard.stderr}`);
    await conversationOnRecord(box, { harness: 'codex', cwd: botHomeOf(bots, BOT), id: THREADS[name], cliVersion });
  }
  return bots;
}

/** The tab the book gives a session, as Orca has it now. */
async function liveTab(box, bots, name = 'daily', bot = BOT) {
  const entry = await sessionIn(bots, bot, name);
  assert.equal(typeof entry?.tab, 'string', `the book should hold a tab for ${bot} ${name}, got: ${JSON.stringify(entry)}`);
  const terminal = (await tabsOfBot(box, bots, bot)).find((one) => one.tabId === entry.tab);
  assert.ok(terminal, `Orca should have ${bot} ${name}'s tab ${entry.tab}`);
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
const sendsAfterLaunch = (terminal) => (terminal?.typed ?? []).slice(1).map(({ text, enter }) => ({ text, enter }));

/** The sends into one tab after its launch line, as Orca has them now. */
async function sendsInto(box, tabId) {
  return sendsAfterLaunch((await box.orca.terminals()).find((one) => one.tabId === tabId));
}

// ---------------------------------------------------------------- Codex's part

/**
 * The Stop payload Codex hands its hook, every field the requirement names,
 * for `thread`. `event` replaces `hook_event_name`, for a payload of another
 * event.
 */
const stopPayload = (bots, { thread = THREADS.daily, event = 'Stop' } = {}) => `${JSON.stringify({
  session_id: thread,
  turn_id: 'turn-2',
  transcript_path: `/nowhere/rollout-${thread}.jsonl`,
  cwd: botHomeOf(bots, BOT),
  hook_event_name: event,
  model: 'gpt-5.5',
  permission_mode: 'default',
  stop_hook_active: false,
  last_assistant_message: 'OK',
})}\n`;

/** Codex's record of thread names. */
const indexFile = (box) => path.join(box.home, '.codex', 'session_index.jsonl');

/** One line in session_index.jsonl, as Codex's `/rename` appends it. */
async function indexLine(box, id, name, at = new Date()) {
  await mkdir(path.dirname(indexFile(box)), { recursive: true });
  await appendFile(indexFile(box), `${JSON.stringify({ id, thread_name: name, updated_at: at.toISOString() })}\n`);
}

/**
 * Run `obk session name` the way Codex runs its hook: in `tab` (its
 * ORCA_TAB_ID and ORCA_TERMINAL_HANDLE; left out, none), under the process
 * chain a tab has, the payload on stdin. The command alone, without the
 * installed line's `|| true`. Answers its own exit code, stdout and stderr.
 */
function nameHook(box, bots, tab, { stdin = stopPayload(bots), bot = BOT } = {}) {
  const command = [box.cli, 'session', 'name', '--bots', bots, '--bot', bot].map(shellWord).join(' ');
  const env = { ...box.env, OBK_CLI: box.cli, ...(tab === undefined ? {} : { ORCA_TERMINAL_HANDLE: tab.handle }) };
  return throughAHarness(box, command, { env, tab: tab?.tabId, stdin });
}

/**
 * Codex, played while the kit runs: once a return has gone into `tabId`, it
 * appends the line `/rename` writes, naming `thread` `name`, once. `stop()`
 * ends the play and answers whether it wrote the line.
 */
function codexRenames(box, tabId, { thread = THREADS.daily, name = NAME } = {}) {
  let stopped = false;
  let wrote = false;
  const loop = (async () => {
    while (!stopped) {
      if (!wrote && (await sendsInto(box, tabId)).some((one) => one.text === '\r')) {
        await indexLine(box, thread, name);
        wrote = true;
      }
      await sleep(50);
    }
  })();
  return async () => {
    stopped = true;
    await loop;
    return wrote;
  };
}

/** Run the hook in `tab` while Codex is played. Answers the run and whether Codex wrote its line. */
async function nameHookPlaying(box, bots, tab, { thread = THREADS.daily, name = NAME, stdin } = {}) {
  const stop = codexRenames(box, tab.tabId, { thread, name });
  const result = await nameHook(box, bots, tab, { stdin: stdin ?? stopPayload(bots, { thread }) });
  return { result, played: await stop() };
}

/** The hook did not disturb the turn: exit 0, and nothing on stdout. */
function assertQuiet(result, what) {
  assert.equal(result.code, 0, `${what}: the hook never fails the turn, got exit ${result.code}:\n${result.stdout}${result.stderr}`);
  assert.equal(result.stdout, '', `${what}: and writes nothing on stdout, so Codex is given no decision`);
}

/** The Orca calls made since `from`. */
const callsSince = async (box, from) => (await box.orca.calls()).slice(from);

/** Every `terminal send` since `from` went into `handle` and no other tab. */
async function assertSentOnlyInto(box, handle, from, what) {
  const sends = orcaCallsOf(await callsSince(box, from), 'terminal send');
  assert.ok(sends.length > 0, `${what}: the premise, something was sent`);
  assert.deepEqual([...new Set(sends.map((call) => orcaFlag(call, '--terminal')))], [handle], `${what}: every send went into the session's own tab`);
}

// ---------------------------------------------------------------- the naming

test('at a turn end, in an idle Codex session\'s tab, the kit types /rename <bot>.<session> and its return, into that tab alone, and exits 0 quietly', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots);
  await changeTab(box, tab.tabId, { nextScreens: NAMING_SCREENS });
  const others = Object.fromEntries(Object.entries(await typedEverywhere(box)).filter(([handle]) => handle !== tab.handle));
  const from = (await box.orca.calls()).length;

  const { result, played } = await nameHookPlaying(box, bots, tab);

  assertQuiet(result, 'the naming');
  assert.ok(played, 'the premise: the return went in, and Codex wrote its line');
  assert.deepEqual(await sendsInto(box, tab.tabId), renamed(), 'the whole command in one send, then the return as a send of its own, and nothing else');
  const now = Object.fromEntries(Object.entries(await typedEverywhere(box)).filter(([handle]) => handle !== tab.handle));
  assert.deepEqual(now, others, 'no other tab, the bot\'s other session\'s among them, had anything typed into it');
  await assertSentOnlyInto(box, tab.handle, from, 'the naming');
});

test('the name is the tab\'s own session\'s: in review\'s tab the kit types /rename api-bot.review', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots, 'review');
  const command = `/rename ${BOT}.review`;
  await changeTab(box, tab.tabId, { nextScreens: [shown(command), CODEX_IDLE] });

  const { result, played } = await nameHookPlaying(box, bots, tab, { thread: THREADS.review, name: `${BOT}.review` });

  assertQuiet(result, 'the naming of review');
  assert.ok(played, 'the premise: the return went in');
  assert.deepEqual(await sendsInto(box, tab.tabId), renamed(command));
  assert.deepEqual(await sendsInto(box, (await liveTab(box, bots, 'daily')).tabId), [], 'nothing went into daily\'s tab');
});

// #713, R2: one write. The whole command in one `terminal send` with no
// --enter, after a look through the gate; then a look and a read of the
// screen; then the return, a send of its own.
test('#713: the command goes in as one send, with no --enter, after a look through the typing gate; then a look and a read of the screen, and the return as a send of its own', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots);
  await changeTab(box, tab.tabId, { nextScreens: NAMING_SCREENS });
  const from = (await box.orca.calls()).length;

  const { result, played } = await nameHookPlaying(box, bots, tab);

  assertQuiet(result, 'the naming');
  assert.ok(played, 'the premise: the return went in');
  const calls = await callsSince(box, from);
  const onTab = (call) => orcaFlag(call, '--terminal') === tab.handle;
  const sends = calls.map((call, at) => ({ call, at })).filter(({ call }) => orcaCommand(call) === 'terminal send' && onTab(call));
  assert.deepEqual(
    sends.map(({ call }) => ({ text: orcaFlag(call, '--text'), enter: call.args.includes('--enter') })),
    [{ text: RENAME, enter: false }, { text: '\r', enter: false }],
    'two sends into the tab: the whole command with no --enter, then the return',
  );
  const [write, enter] = sends.map(({ at }) => at);
  const looks = (start, end) => calls.slice(start, end).filter((call) => orcaCommand(call) === 'terminal wait' && onTab(call) && orcaFlag(call, '--for') === 'tui-idle');
  assert.ok(looks(0, write).length > 0, 'a look through the gate (terminal wait --for tui-idle on the tab) before the write');
  assert.ok(looks(write + 1, enter).length > 0, 'a look through the gate between the write and the return');
  const reads = calls.slice(write + 1, enter).filter((call) => orcaCommand(call) === 'terminal read' && onTab(call));
  assert.ok(reads.length > 0, 'a read of the tab\'s screen between the write and the return');
});

test('Codex\'s input line empty, "›" alone with no placeholder: the command is typed and entered', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots);
  await changeTab(box, tab.tabId, { screen: CODEX_IDLE_EMPTY, nextScreens: NAMING_SCREENS });

  const { result } = await nameHookPlaying(box, bots, tab);

  assertQuiet(result, 'the naming');
  assert.deepEqual(await sendsInto(box, tab.tabId), renamed());
});

test('a session Orca reports busy on the first two looks is named once a look finds it idle, within the 30 s', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots);
  await changeTab(box, tab.tabId, { nextScreens: NAMING_SCREENS });
  await box.orca.set({ waitIdle: ['busy', 'busy', true] });
  const from = (await box.orca.calls()).length;

  const { result } = await nameHookPlaying(box, bots, tab);

  assertQuiet(result, 'the naming');
  assert.deepEqual(await sendsInto(box, tab.tabId), renamed());
  const calls = await callsSince(box, from);
  const firstSend = calls.findIndex((call) => orcaCommand(call) === 'terminal send');
  const looksBefore = calls.slice(0, firstSend).filter((call) => orcaCommand(call) === 'terminal wait').length;
  assert.ok(looksBefore >= 3, `nothing was typed until a look found it idle: the third, got ${looksBefore} look(s) first`);
});

// ------------------------------------------------------------- cheap when done

test('the newest line for the thread already names it: no Orca call and nothing typed; a thread with no line is acted on', async (t) => {
  // The contrast keeps itself cheap: a draft in the input line, so a run that
  // acts looks at the tab and types nothing.
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots);
  await changeTab(box, tab.tabId, { screen: CODEX_DRAFT });
  await indexLine(box, THREADS.daily, 'Prepare issue #8 draft contract', new Date(Date.now() - 60_000));
  await indexLine(box, THREADS.daily, NAME);
  const before = await typedEverywhere(box);

  const from = (await box.orca.calls()).length;
  assertQuiet(await nameHook(box, bots, tab), 'already named');
  assert.deepEqual(await callsSince(box, from), [], 'named already, so no Orca command at all');

  // The session goes on to a new thread, as after a `/new`, and the hook
  // reports it to the book: that thread has no line yet.
  const next = '0199c0de-4800-7000-8000-00000000f4e5';
  const heard = await recordSession(box, { bots, bot: BOT, tab: tab.tabId, session: next });
  assert.equal(heard.code, 0, `the hook report this test stands on: ${heard.stderr}`);
  assert.equal((await sessionIn(bots, BOT, 'daily')).session, next, 'the premise: the book holds the new thread');
  const fresh = (await box.orca.calls()).length;
  assertQuiet(await nameHook(box, bots, tab, { stdin: stopPayload(bots, { thread: next }) }), 'a thread with no line');
  assert.ok((await callsSince(box, fresh)).length > 0, 'the premise: a thread with no name is acted on, so Orca is asked about the tab');
  assert.deepEqual(await typedEverywhere(box), before, 'and with a draft in the input line nothing is typed');
});

test('an older line names the thread and a newer one names it otherwise (the user renamed it): the kit names it again', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots);
  await changeTab(box, tab.tabId, { nextScreens: NAMING_SCREENS });
  await indexLine(box, THREADS.daily, NAME, new Date(Date.now() - 60_000));
  await indexLine(box, THREADS.daily, 'Follow live test instructions');

  const { result } = await nameHookPlaying(box, bots, tab);

  assertQuiet(result, 'renamed by the user');
  assert.deepEqual(await sendsInto(box, tab.tabId), renamed(), 'the newest line wins, and it does not carry the name');
});

test('a line for another thread with the name does not count: the kit names this one', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots);
  await changeTab(box, tab.tabId, { nextScreens: NAMING_SCREENS });
  await indexLine(box, '0199c0de-4800-7000-8000-0000000071d0', NAME);
  await indexLine(box, THREADS.review, NAME);

  const { result } = await nameHookPlaying(box, bots, tab);

  assertQuiet(result, 'another thread named');
  assert.deepEqual(await sendsInto(box, tab.tabId), renamed());
});

// ------------------------------------------------- acts only on its own Codex tab
//
// Each case below runs the hook with one thing wrong and requires no Orca
// command at all; then, in the same fleet, the hook with everything right is
// run to show the fleet is one the kit acts on. A draft in daily's input line
// keeps that run from typing.

/** Each case: what is wrong, and the hook run it makes, given the fleet. */
const NOT_ITS_OWN = [
  { what: 'a payload of another event, PostToolUse', run: (box, bots, tabs) => nameHook(box, bots, tabs.daily, { stdin: stopPayload(bots, { event: 'PostToolUse' }) }) },
  { what: 'a payload of another event, SessionStart', run: (box, bots, tabs) => nameHook(box, bots, tabs.daily, { stdin: stopPayload(bots, { event: 'SessionStart' }) }) },
  { what: 'no standard input at all', run: (box, bots, tabs) => nameHook(box, bots, tabs.daily, { stdin: '' }) },
  { what: 'standard input that is not JSON', run: (box, bots, tabs) => nameHook(box, bots, tabs.daily, { stdin: 'codex: something went wrong\n' }) },
  { what: 'JSON that is not an object', run: (box, bots, tabs) => nameHook(box, bots, tabs.daily, { stdin: '"Stop"\n' }) },
  { what: 'no ORCA_TAB_ID', run: (box, bots) => nameHook(box, bots, undefined) },
  { what: 'a tab no session has', run: (box, bots, tabs) => nameHook(box, bots, { tabId: 'tab-nobody-has', handle: 'term-nobody-has' }) },
  { what: 'the tab of another bot\'s session', run: (box, bots, tabs) => nameHook(box, bots, tabs.other) },
  { what: 'the tab of a session of this bot that runs on Claude Code', run: (box, bots, tabs) => nameHook(box, bots, tabs.notes) },
  { what: 'a --bot the bots folder does not have', run: (box, bots, tabs) => nameHook(box, bots, tabs.daily, { bot: 'no-such-bot' }) },
  // A Codex Orca restored on its own runs its hooks in Codex's shared
  // background server, under another session's tab (#408): the thread that
  // stopped is not the one the tab shows.
  { what: 'a session_id that is another session\'s conversation, not the one the book holds for the tab (#408)', run: (box, bots, tabs) => nameHook(box, bots, tabs.daily, { stdin: stopPayload(bots, { thread: THREADS.review }) }) },
  { what: 'a session_id that is no conversation the book holds', run: (box, bots, tabs) => nameHook(box, bots, tabs.daily, { stdin: stopPayload(bots, { thread: '0199c0de-4800-7000-8000-00000000ba5e' }) }) },
];

for (const { what, run } of NOT_ITS_OWN) {
  test(`with ${what}, the hook exits 0 quietly and calls no Orca command; the same fleet's own Codex tab is acted on`, async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box, { claude: ['notes'], others: ['other-bot'] });
    const tabs = {
      daily: await liveTab(box, bots, 'daily'),
      notes: await liveTab(box, bots, 'notes'),
      other: await liveTab(box, bots, 'daily', 'other-bot'),
    };
    await changeTab(box, tabs.daily.tabId, { screen: CODEX_DRAFT });
    const before = await typedEverywhere(box);

    const from = (await box.orca.calls()).length;
    assertQuiet(await run(box, bots, tabs), what);
    assert.deepEqual((await callsSince(box, from)).map((call) => call.args.join(' ')), [], `${what}: no Orca command at all`);

    const right = (await box.orca.calls()).length;
    assertQuiet(await nameHook(box, bots, tabs.daily), 'the hook with everything right');
    assert.ok((await callsSince(box, right)).length > 0, 'the premise: in this fleet, the hook in daily\'s tab asks Orca about the tab');
    assert.deepEqual(await typedEverywhere(box), before, 'and nothing was typed anywhere: daily has a draft');
  });
}

// ------------------------------------------------- the input line before typing

test('a draft in Codex\'s input line before the command goes in: nothing typed, and it exits 0 quietly', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots);
  await changeTab(box, tab.tabId, { screen: CODEX_DRAFT, nextScreens: NAMING_SCREENS });
  const before = await typedEverywhere(box);

  assertQuiet(await nameHook(box, bots, tab), 'a draft');

  assert.deepEqual(await typedEverywhere(box), before, 'nothing is typed into any tab');
});

test('a run that typed nothing tries again at the next turn end: the draft gone, the next run names the thread', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots);
  await changeTab(box, tab.tabId, { screen: CODEX_DRAFT });

  assertQuiet(await nameHook(box, bots, tab), 'the first turn end');
  assert.deepEqual(await sendsInto(box, tab.tabId), [], 'the premise: the first run typed nothing');

  await changeTab(box, tab.tabId, { screen: CODEX_IDLE, nextScreens: NAMING_SCREENS });
  const { result } = await nameHookPlaying(box, bots, tab);

  assertQuiet(result, 'the next turn end');
  assert.deepEqual(await sendsInto(box, tab.tabId), renamed());
});

// ------------------------------------------------- the mailbox gate (#713)
//
// R1: after the idle wait, the empty-line check and the typing turn, and
// immediately before the command goes in, the naming reads the session's own
// Orca mailbox, the Run the book names as `sessions.<session>.mailbox`, with
// `orchestration inbox --terminal run:<id> --limit <n>`. A letter unread and
// not delivered yet means Orca is about to write its notice into the tab: the
// naming types nothing into the tab at all, and exits 0 quietly. Read
// letters, and delivered ones, read or not, do not stop it. An inbox Orca
// refuses to answer: nothing typed. No mailbox in the book: it goes on as
// before. How many letters it asks for (`--limit`) is the kit's.
//
// The letters are as test/health-mail-unannounced.test.js gives them: every
// column Orca 1.4.225 gave in `orchestration inbox` (seen live, 2026-10-17),
// the values of the columns that test did not write down standing in.

let sequence = 0;

/** A time as Orca writes it: whole seconds, then Z. */
const stamp = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * One letter in a Run's mailbox, as `orchestration inbox` answers it, written
 * a minute ago. `read` is 0 or 1; `delivered` puts a `delivered_at` on it, the
 * time Orca rang for it.
 */
function letter(run, { read = 0, delivered = false } = {}) {
  sequence += 1;
  const at = Date.now() - 60_000;
  return {
    body: 'zq-body-quince-4410',
    created_at: stamp(at),
    delivered_at: delivered ? stamp(at + 1_000) : null,
    delivery_contract: null,
    from_handle: 'term_sender',
    id: `msg_mail_${sequence}`,
    payload: null,
    pointer_enter_pending: 0,
    pointer_process_incarnation: null,
    pointer_pty_id: null,
    priority: 'normal',
    read,
    run_id: run,
    sender_pane_key: null,
    sequence,
    subject: 'zq-subject-plum-7731',
    thread_id: null,
    to_handle: `run:${run}`,
    type: 'status',
  };
}

/** Put letters into a Run's mailbox, beside any it holds. Answers the letters. */
async function mailTo(box, run, ...letters) {
  const inbox = (await box.orca.state()).inbox ?? {};
  await box.orca.set({ inbox: { ...inbox, [run]: [...(inbox[run] ?? []), ...letters] } });
  return letters;
}

/** The mailbox the book names for one of api-bot's sessions. */
async function mailboxOf(bots, name) {
  const { mailbox } = (await sessionIn(bots, BOT, name)) ?? {};
  assert.ok(typeof mailbox === 'string' && /^run_/.test(mailbox), `the premise: the book names a mailbox for ${name}, got: ${mailbox}`);
  return mailbox;
}

/** The `orchestration inbox` calls among `calls` that read the Run `run`. */
const inboxReadsOf = (calls, run) => orcaCallsOf(calls, 'orchestration inbox').filter((call) => orcaFlag(call, '--terminal') === `run:${run}`);

test('#713 R1: a letter in the session\'s own mailbox, unread and not delivered yet: nothing is typed into any tab, and it exits 0 quietly; once Orca has delivered it, the next turn end names the thread', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots);
  const run = await mailboxOf(bots, 'daily');
  await changeTab(box, tab.tabId, { nextScreens: NAMING_SCREENS });
  const [waiting] = await mailTo(box, run, letter(run));
  const before = await typedEverywhere(box);
  const from = (await box.orca.calls()).length;

  assertQuiet(await nameHook(box, bots, tab), 'a letter Orca is about to ring for');

  assert.ok(inboxReadsOf(await callsSince(box, from), run).length > 0, 'the premise: the naming read the session\'s own mailbox, orchestration inbox --terminal run:<its mailbox>');
  assert.deepEqual(await typedEverywhere(box), before, 'nothing is typed into any tab, not even a key taken back');

  // Orca rings for it: the letter has its delivery now, and is still unread.
  await box.orca.set({ inbox: { [run]: [{ ...waiting, delivered_at: stamp(Date.now()) }] } });
  const { result, played } = await nameHookPlaying(box, bots, tab);

  assertQuiet(result, 'the letter delivered');
  assert.ok(played, 'the premise: the return went in, and Codex wrote its line');
  assert.deepEqual(await sendsInto(box, tab.tabId), renamed(), 'the next turn end names the thread');
});

for (const { what, letters } of [
  { what: 'a letter read, with no delivery', letters: (run) => [letter(run, { read: 1 })] },
  { what: 'a letter delivered and not read', letters: (run) => [letter(run, { delivered: true })] },
  { what: 'a letter read and delivered', letters: (run) => [letter(run, { read: 1, delivered: true })] },
  { what: 'three letters, each read or delivered', letters: (run) => [letter(run, { read: 1 }), letter(run, { delivered: true }), letter(run, { read: 1, delivered: true })] },
]) {
  test(`#713 R1: ${what} in the session's own mailbox does not stop the naming: the command is entered, and Codex names the thread`, async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box);
    const tab = await liveTab(box, bots);
    const run = await mailboxOf(bots, 'daily');
    await changeTab(box, tab.tabId, { nextScreens: NAMING_SCREENS });
    await mailTo(box, run, ...letters(run));
    const from = (await box.orca.calls()).length;

    const { result, played } = await nameHookPlaying(box, bots, tab);

    assertQuiet(result, what);
    assert.ok(played, 'the premise: the return went in, and Codex wrote its line');
    assert.ok(inboxReadsOf(await callsSince(box, from), run).length > 0, 'the naming read the session\'s own mailbox');
    assert.deepEqual(await sendsInto(box, tab.tabId), renamed());
  });
}

test('#713 R1: the mailbox is read after every look through the gate before the write, and right before it', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots);
  const run = await mailboxOf(bots, 'daily');
  await changeTab(box, tab.tabId, { nextScreens: NAMING_SCREENS });
  await mailTo(box, run, letter(run, { read: 1, delivered: true }));
  const from = (await box.orca.calls()).length;

  const { result } = await nameHookPlaying(box, bots, tab);

  assertQuiet(result, 'the naming');
  assert.deepEqual(await sendsInto(box, tab.tabId), renamed(), 'the premise: the command and its return went in');
  const calls = await callsSince(box, from);
  const write = calls.findIndex((call) => orcaCommand(call) === 'terminal send' && orcaFlag(call, '--terminal') === tab.handle);
  const read = calls.slice(0, write).findLastIndex((call) => orcaCommand(call) === 'orchestration inbox' && orcaFlag(call, '--terminal') === `run:${run}`);
  assert.ok(read >= 0, 'the session\'s own mailbox was read before the write');
  const looks = calls.slice(0, write).map((call, at) => ({ call, at }))
    .filter(({ call }) => orcaCommand(call) === 'terminal wait' && orcaFlag(call, '--terminal') === tab.handle)
    .map(({ at }) => at);
  assert.ok(looks.length > 0, 'the premise: the naming looked through the gate before the write');
  assert.deepEqual(looks.filter((at) => at > read), [], 'no look through the gate between the mailbox read and the write: the read is the last thing before it');
});

test('#713 R1: a letter that comes while the naming waits for the session to be idle stops it: nothing typed, and it exits 0 quietly', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots);
  const run = await mailboxOf(bots, 'daily');
  await changeTab(box, tab.tabId, { tuiIdle: 'busy', nextScreens: NAMING_SCREENS });
  const stop = codexRenames(box, tab.tabId);
  const from = (await box.orca.calls()).length;

  let early;
  const hook = nameHook(box, bots, tab);
  hook.then((result) => { early = result; });
  const until = Date.now() + 20_000;
  while (early === undefined && orcaCallsOf(await callsSince(box, from), 'terminal wait').length === 0 && Date.now() < until) await sleep(20);
  if (early !== undefined) assertQuiet(early, 'the run, which ended before the tab went idle');
  assert.ok(orcaCallsOf(await callsSince(box, from), 'terminal wait').length > 0, 'the premise: the hook is at work, waiting for its tab to be idle');
  await mailTo(box, run, letter(run));
  await changeTab(box, tab.tabId, { tuiIdle: undefined });
  const result = await hook;
  await stop();

  assertQuiet(result, 'a letter while it waited');
  assert.deepEqual(await sendsInto(box, tab.tabId), [], 'nothing typed: the mailbox is read when the command is about to go in, not when the hook starts');
});

test('#713 R1: a letter unread and not delivered in another session\'s mailbox does not stop the naming of this one', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots);
  const run = await mailboxOf(bots, 'daily');
  const other = await mailboxOf(bots, 'review');
  assert.notEqual(other, run, 'the premise: each session has a mailbox of its own');
  await changeTab(box, tab.tabId, { nextScreens: NAMING_SCREENS });
  await mailTo(box, other, letter(other));
  const from = (await box.orca.calls()).length;

  const { result } = await nameHookPlaying(box, bots, tab);

  assertQuiet(result, 'review\'s letter');
  assert.ok(inboxReadsOf(await callsSince(box, from), run).length > 0, 'the naming read daily\'s own mailbox');
  assert.deepEqual(await sendsInto(box, tab.tabId), renamed(), 'daily is named');
});

test('#713 R1: a session with no mailbox in the book: the naming goes on as before', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots);
  const run = await mailboxOf(bots, 'daily');
  // A letter waits in the Run, so a naming that read it anyway would stop.
  await mailTo(box, run, letter(run));
  const file = bookOf(bots, BOT);
  const book = parse(await readFile(file, 'utf8'));
  delete book.sessions.daily.mailbox;
  await writeFile(`${file}.moving`, stringify(book));
  await rename(`${file}.moving`, file);
  assert.equal((await sessionIn(bots, BOT, 'daily')).mailbox, undefined, 'the premise: the book names no mailbox for daily');
  await changeTab(box, tab.tabId, { nextScreens: NAMING_SCREENS });

  const { result, played } = await nameHookPlaying(box, bots, tab);

  assertQuiet(result, 'no mailbox');
  assert.ok(played, 'the premise: the return went in, and Codex wrote its line');
  assert.deepEqual(await sendsInto(box, tab.tabId), renamed());
});

for (const { what, misbehaving } of [
  { what: 'refuses to answer the mailbox read', misbehaving: { fail: { 'orchestration inbox': { code: 'runtime_error', message: 'the orchestration runtime is restarting; try again in a moment' } } } },
  { what: 'fails the mailbox read outright, with no JSON', misbehaving: { crash: { command: 'orchestration inbox', exitCode: 1, stdout: '', stderr: 'orca: something went wrong\n' } } },
]) {
  test(`#713 R1: Orca ${what}: nothing is typed into any tab, and it exits 0 quietly`, async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box);
    const tab = await liveTab(box, bots);
    const run = await mailboxOf(bots, 'daily');
    await changeTab(box, tab.tabId, { nextScreens: NAMING_SCREENS });
    await box.orca.set(misbehaving);
    const before = await typedEverywhere(box);
    const from = (await box.orca.calls()).length;

    assertQuiet(await nameHook(box, bots, tab), what);

    assert.ok(inboxReadsOf(await callsSince(box, from), run).length > 0, 'the premise: the naming asked Orca for the session\'s own mailbox');
    assert.deepEqual(await typedEverywhere(box), before, 'nothing is typed into any tab');
  });
}

// ------------------------------------------------- the gate after the write
//
// #713: the command goes in as one write, so there is no partway. What comes
// up once it is in, before the return, stops it: the whole command is taken
// back, one backspace per character, in one send, and nothing is entered.

/** The command written, then exactly as many backspaces as it has characters, in one send, and nothing more: no return. */
const takenBack = (command = RENAME) => [...typed(command), { text: backspaces(command), enter: false }];

test('a question that comes up after the write: the command is taken back in one send, and nothing is entered', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots);
  await changeTab(box, tab.tabId, { nextScreens: [CODEX_UPDATE_OFFER] });

  assertQuiet(await nameHook(box, bots, tab), 'a question after the write');

  assert.deepEqual(await sendsInto(box, tab.tabId), takenBack(), 'the command, then exactly its characters taken back, and nothing more');
});

// #491: a question drawn ABOVE the input line, with the input line's own
// pointer below it, stops the naming as a question at the bottom does. The
// screen is Claude Code 2.1.289's Teach list as captured (helpers/screens.js
// CLAUDE_TEACH_LIST). The naming types only into Codex, and no Codex question
// above its input line has been seen; the gate reads the rows and not the
// harness, and this capture is the one screen of the kind there is. The write
// before it came is the presence: the path was typing.
test('#491: the Teach list drawn above the input box comes up after the write: the command is taken back in one send, and nothing is entered', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots);
  await changeTab(box, tab.tabId, { nextScreens: [CLAUDE_TEACH_LIST] });

  assertQuiet(await nameHook(box, bots, tab), 'the Teach list after the write');

  assert.deepEqual(await sendsInto(box, tab.tabId), takenBack(), 'the command, then exactly its characters taken back, and nothing more');
});

// #502: Claude Code's panel of feedback drafts above the input box
// (helpers/screens.js CLAUDE_FEEDBACK_PANEL, built on a capture) takes single
// keys from the input line, and one of them sends a draft to Anthropic. It
// stops the naming as a question does. The naming types only into Codex, and
// Codex draws no such panel; the gate reads the rows and not the harness, as
// the #491 test above says. The write before it came is the presence: the
// path was typing.
test('#502: the panel of feedback drafts comes up after the write: the command is taken back in one send, and nothing is entered', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots);
  await changeTab(box, tab.tabId, { nextScreens: [CLAUDE_FEEDBACK_PANEL] });

  assertQuiet(await nameHook(box, bots, tab), 'the panel after the write');

  assert.deepEqual(await sendsInto(box, tab.tabId), takenBack(), 'the command, then exactly its characters taken back, and nothing more');
});

// ------------------------------------------------- the screen before Return
//
// #713, R3: besides the input line and the menu, the line check refuses text
// that stands under the input line before Codex's status row: Orca's notice,
// written into the tab while the command stood there, shows so. A blank row
// there is not text.

for (const { what, screen } of [
  { what: 'the slash menu still open above the input line, its /rename row selected', screen: popup([RENAME_ROW], `› ${RENAME}`) },
  { what: 'a slash menu row above the input line, none selected', screen: popup([RENAME_ROW_UNSELECTED], `› ${RENAME}`) },
  { what: 'the menu open and the input line a bare "›"', screen: popup([RENAME_ROW]) },
  { what: 'the input line short of the last character', screen: shown(RENAME.slice(0, -1)) },
  { what: 'the input line with text before the command', screen: shown(`fix the flaky test${RENAME}`) },
  { what: 'Codex at work, its row above the input line', screen: workingOver([`› ${RENAME}`, STATUS]) },
  { what: '#713: Orca\'s notice under the input line, right above the status row', screen: noticeUnder() },
  { what: '#713: Orca\'s notice under the input line, a blank row between them', screen: noticeUnder(RENAME, 1) },
  {
    what: '#713: the screen of the issue on Codex 0.162.0\'s rows, the line reading the command and the notice under it',
    screen: [...CODEX_162_IDLE.slice(0, 5), `› ${RENAME}`, NOTICE_ROW, CODEX_162_IDLE[6]],
  },
]) {
  test(`after the write, ${what}: no return, and the command is taken back, one backspace per character, in one send`, async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box);
    const tab = await liveTab(box, bots);
    await changeTab(box, tab.tabId, { nextScreens: [screen, CODEX_IDLE] });

    assertQuiet(await nameHook(box, bots, tab), what);

    assert.deepEqual(await sendsInto(box, tab.tabId), takenBack());
  });
}

for (const { what, screen } of [
  { what: 'an empty row between the input line and the status row', screen: [...ABOVE_INPUT, `› ${RENAME}`, '', STATUS] },
  { what: 'a row of spaces between the input line and the status row', screen: [...ABOVE_INPUT, `› ${RENAME}`, '    ', STATUS] },
]) {
  test(`#713: after the write, ${what}: a blank row is not text, so the command is entered, and Codex names the thread`, async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box);
    const tab = await liveTab(box, bots);
    await changeTab(box, tab.tabId, { nextScreens: [screen, CODEX_IDLE] });

    const { result, played } = await nameHookPlaying(box, bots, tab);

    assertQuiet(result, what);
    assert.ok(played, 'the premise: the return went in, and Codex wrote its line');
    assert.deepEqual(await sendsInto(box, tab.tabId), renamed(), 'the command in one send, then the return, and nothing taken back');
  });
}

// ------------------------------------------------- Codex 0.162.0 and Orca's draft (#516)
//
// Codex 0.162.0 under Orca 1.4.223 (helpers/screens.js, the CODEX_162
// captures): Orca's read gives the text of the input line as `draft`, and the
// line's row reads `›` alone while it holds text; an empty line gives no
// `draft`. The intent of #516 for the naming, as these tests hold it:
//
//   - Before the write: a non-empty `draft` means the user's draft is in the
//     line, and nothing is typed, even when the line's row reads `›` alone or
//     the placeholder.
//   - After the write, with a `draft`: it equals the command exactly, and no
//     slash-menu row stands right above the input line. Then the return goes
//     in, as before.
//   - A draft that is not exactly the command, one that holds more than the
//     command on more lines (#713: Orca's notice joined to it) among them: the
//     command is taken back, one backspace per character in one send, and no
//     return.
//   - With no `draft`, the screen is read as before: the tests above.
//
// No live read of `/rename` was made. The screens below are reconstructions on
// the 0.162.0 captures: with the whole command written, no popup, as Codex's
// source says, on the rows of the live read with a draft (CODEX_162_DRAFT),
// with the draft Orca would give.

/** Codex 0.162.0 with no popup, its input line's row `›` alone, and `draft` in the line. A reconstruction on CODEX_162_DRAFT. */
const drafted162 = (draft) => ({ screen: CODEX_162_DRAFT.screen, draft });

for (const { start, what } of [
  { start: CODEX_162_DRAFT, what: 'the live read with the draft "hello" and the line\'s row "›" alone' },
  { start: CODEX_162_PLACEHOLDER_DRAFT, what: 'the draft "hello" and the line\'s row showing the placeholder (rebuilt pairing)' },
]) {
  test(`#516: Codex 0.162.0 with a draft in its input line before the write, ${what}: nothing typed, and it exits 0 quietly`, async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box, { cliVersion: '0.162.0' });
    const tab = await liveTab(box, bots);
    await changeTab(box, tab.tabId, { screen: start.screen, draft: start.draft, nextScreens: [drafted162(RENAME), CODEX_162_IDLE] });
    const before = await typedEverywhere(box);
    const from = (await box.orca.calls()).length;

    assertQuiet(await nameHook(box, bots, tab), 'a draft');

    assert.ok((await callsSince(box, from)).length > 0, 'the premise: the hook acted, and asked Orca about the tab');
    assert.deepEqual(await typedEverywhere(box), before, 'nothing is typed into any tab');
  });
}

for (const cliVersion of ['0.162.0', '0.160.0']) {
  test(`#516: Codex ${cliVersion} whose read gives the draft "${RENAME}" exactly, the line's row "›" alone and no popup: the command is entered, and Codex names the thread`, async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box, { cliVersion });
    const tab = await liveTab(box, bots);
    await changeTab(box, tab.tabId, { screen: CODEX_162_IDLE, nextScreens: [drafted162(RENAME), CODEX_162_IDLE] });

    const { result, played } = await nameHookPlaying(box, bots, tab);

    assertQuiet(result, 'the naming');
    assert.ok(played, 'the premise: the return went in, and Codex wrote its line');
    assert.deepEqual(await sendsInto(box, tab.tabId), renamed(), 'the command in one send, then the return, and nothing taken back');
  });
}

// The refusals once the command is written. Side by side, since a naming that
// wrongly goes in waits about 10 s for Codex's line.
describe('#516: Codex naming refusals with a draft once the command is typed, side by side', { concurrency: true }, () => {
  for (const { what, read } of [
    { what: `the draft "x${RENAME}" and no popup`, read: drafted162(`x${RENAME}`) },
    { what: 'the draft short of the last character', read: drafted162(RENAME.slice(0, -1)) },
    { what: 'the draft with a space after the command', read: drafted162(`${RENAME} `) },
    // The line's row reads the command, and Orca's draft says otherwise.
    { what: `the draft "x${RENAME}" while the line's row reads "› ${RENAME}"`, read: { screen: shown(RENAME), draft: `x${RENAME}` } },
    // The right draft does not excuse a menu row right above the input line.
    { what: `the draft "${RENAME}" exactly and the /rename popup row right above the line`, read: { screen: codex162With([RENAME_ROW]), draft: RENAME } },
    // #713: Orca's notice joined to the command in the draft.
    { what: 'the draft the command, then Orca\'s notice on the lines after it', read: drafted162(`${RENAME}\n${NOTICE}\n`) },
    { what: 'the draft the command, then Orca\'s notice on the next line, with no newline at its end', read: drafted162(`${RENAME}\n${NOTICE}`) },
    // #713: the right draft does not excuse text under the input line on the screen.
    {
      what: `the draft "${RENAME}" exactly and Orca's notice under the line's bare "›", above the status row`,
      read: { screen: [...CODEX_162_DRAFT.screen.slice(0, 6), NOTICE_ROW, CODEX_162_DRAFT.screen[6]], draft: RENAME },
    },
  ]) {
    it(`#516: on Codex 0.162.0, after the write, ${what}: no return, and the command is taken back, one backspace per character, in one send`, async (t) => {
      const box = await createSandbox(t);
      const bots = await running(box, { cliVersion: '0.162.0' });
      const tab = await liveTab(box, bots);
      await changeTab(box, tab.tabId, { screen: CODEX_162_IDLE, nextScreens: [read, CODEX_162_IDLE] });

      assertQuiet(await nameHook(box, bots, tab), what);

      assert.deepEqual(await sendsInto(box, tab.tabId), takenBack());
    });
  }
});

// ------------------------------------------------- one naming at a time

test('a second run for the same session while the first is at work types nothing; the command goes in once', async (t) => {
  // Codex runs its Stop hook async, so two turn ends close together give two
  // runs at once. Here both start while Orca's tui-idle calls the tab busy,
  // and the tab goes idle only once the second has had 3 s to start and look.
  // Two runs that each went on would each find it idle with an empty input
  // line, and type.
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots);
  await changeTab(box, tab.tabId, { tuiIdle: 'busy', nextScreens: NAMING_SCREENS });
  const stop = codexRenames(box, tab.tabId);
  const from = (await box.orca.calls()).length;

  let firstEarly;
  const first = nameHook(box, bots, tab);
  first.then((result) => { firstEarly = result; });
  const until = Date.now() + 20_000;
  while (firstEarly === undefined && orcaCallsOf(await callsSince(box, from), 'terminal wait').length === 0 && Date.now() < until) await sleep(20);
  if (firstEarly !== undefined) assertQuiet(firstEarly, 'the first run, which ended before the tab went idle');
  assert.ok(orcaCallsOf(await callsSince(box, from), 'terminal wait').length > 0, 'the premise: the first run is at work, waiting for the tab to be idle');
  let secondDone = false;
  const second = nameHook(box, bots, tab);
  second.then(() => { secondDone = true; });
  const flip = Date.now() + 3_000;
  while (!secondDone && Date.now() < flip) await sleep(50);
  assert.deepEqual(await sendsInto(box, tab.tabId), [], 'the premise: nothing typed while the tab was busy');
  await changeTab(box, tab.tabId, { tuiIdle: undefined });
  const [one, two] = [await first, await second];
  await stop();

  assertQuiet(one, 'the first run');
  assertQuiet(two, 'the second run');
  assert.deepEqual(await sendsInto(box, tab.tabId), renamed(), 'one command and one return, nothing of the second run among them');
});

// ------------------------------------------------- the tab the hook ran in
//
// Added by the developer of #480: the hook types only into the tab it ran in
// (ORCA_TAB_ID). A Stop hook from a tab can still be waiting for idle when
// `obk restart` opens the session's new tab and the book takes it. If, by the
// time it would type, the book holds another tab for the session, it types
// nothing into any tab and exits 0 quietly.
//
// How it is played. The hook runs in daily's tab while Orca's tui-idle calls
// that tab busy. Orca has a second tab, a copy of daily's with its own ids,
// its Codex launch line in it and an idle Codex screen, as a new tab after a
// restart. Once the hook has looked at daily's tab, and before the tab turns
// idle, the book's `tab` for daily is set to the second tab (written whole and
// then moved into place, so the hook never reads half a book). Its
// conversation stays the one the hook names. The contrast is the same run
// with the book left as it was.

/** Point the book's `tab` for `name` at `to`, by its text, leaving the rest of the file as it is. */
async function bookTabMoved(bots, name, from, to) {
  const file = bookOf(bots, BOT);
  const text = await readFile(file, 'utf8');
  assert.equal(text.split(`tab: ${from}\n`).length, 2, `the premise: the book holds ${from} once, for ${name}`);
  await writeFile(`${file}.moving`, text.replace(`tab: ${from}\n`, `tab: ${to}\n`));
  await rename(`${file}.moving`, file);
  assert.equal((await sessionIn(bots, BOT, name)).tab, to, `the premise: the book holds ${to} for ${name} now`);
}

for (const moved of [true, false]) {
  test(moved
    ? 'the book takes another tab for the session while the hook waits for its own to be idle: nothing typed into either tab, and it exits 0 quietly'
    : 'the contrast: the same run with the book left as it was types the command into the hook\'s own tab', async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box);
    const tab = await liveTab(box, bots);
    const other = {
      ...tab,
      handle: `${tab.handle}_new`,
      tabId: `${tab.tabId}_new`,
      paneKey: `${tab.tabId}_new:${tab.leafId}_new`,
      leafId: `${tab.leafId}_new`,
      ptyId: `${tab.ptyId}_new`,
      typed: tab.typed.slice(0, 1),
      nextScreens: NAMING_SCREENS,
    };
    await box.orca.set({ terminals: [...await box.orca.terminals(), other] });
    await changeTab(box, tab.tabId, { tuiIdle: 'busy', nextScreens: NAMING_SCREENS });
    const stop = codexRenames(box, tab.tabId);
    const from = (await box.orca.calls()).length;

    let early;
    const run = nameHook(box, bots, tab);
    run.then((result) => { early = result; });
    const until = Date.now() + 20_000;
    while (early === undefined && orcaCallsOf(await callsSince(box, from), 'terminal wait').length === 0 && Date.now() < until) await sleep(20);
    if (early !== undefined) assertQuiet(early, 'the run, which ended before the tab went idle');
    assert.ok(orcaCallsOf(await callsSince(box, from), 'terminal wait').length > 0, 'the premise: the hook is at work, waiting for its tab to be idle');
    if (moved) await bookTabMoved(bots, 'daily', tab.tabId, other.tabId);
    await changeTab(box, tab.tabId, { tuiIdle: undefined });
    const result = await run;
    await stop();

    assertQuiet(result, moved ? 'the tab moved' : 'the tab as it was');
    if (moved) {
      assert.deepEqual(await sendsInto(box, tab.tabId), [], 'nothing into the tab the hook ran in: the book no longer holds it for the session');
      assert.deepEqual(await sendsInto(box, other.tabId), [], 'and nothing into the tab the book holds now: the hook did not run there');
    } else {
      assert.deepEqual(await sendsInto(box, tab.tabId), renamed(), 'the command and its return, into the hook\'s own tab');
      assert.deepEqual(await sendsInto(box, other.tabId), [], 'and nothing into the other tab');
    }
  });
}

// ------------------------------------------------- the thread the hook ran for
//
// Added from the review of #480: the thread is checked again, not only the
// tab. If, at any look while it waits or types, the book no longer holds the
// hook's session_id as the session's conversation (a `/new` in the same tab
// reported a new thread through `session record`), the run stops. Before the
// write nothing is typed; after it, the command is taken back, one backspace
// per character in one send, and no return goes in. Either way it exits 0
// quietly. The contrast, the same run with the book left as it was, is the
// moved-tab contrast above.

/** The thread a `/new` in daily's tab starts, which the hook did not run for. */
const NEW_THREAD = '0199c0de-4800-7000-8000-00000000da12';

test('a /new reports a new thread in the same tab while the hook waits for idle: nothing typed, and it exits 0 quietly', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots);
  await changeTab(box, tab.tabId, { tuiIdle: 'busy', nextScreens: NAMING_SCREENS });
  const stop = codexRenames(box, tab.tabId);
  const from = (await box.orca.calls()).length;

  let early;
  const run = nameHook(box, bots, tab);
  run.then((result) => { early = result; });
  const until = Date.now() + 20_000;
  while (early === undefined && orcaCallsOf(await callsSince(box, from), 'terminal wait').length === 0 && Date.now() < until) await sleep(20);
  if (early !== undefined) assertQuiet(early, 'the run, which ended before the tab went idle');
  assert.ok(orcaCallsOf(await callsSince(box, from), 'terminal wait').length > 0, 'the premise: the hook is at work, waiting for its tab to be idle');
  const heard = await recordSession(box, { bots, bot: BOT, tab: tab.tabId, session: NEW_THREAD });
  assert.equal(heard.code, 0, `the premise: the new thread's report: ${heard.stderr}`);
  assert.equal((await sessionIn(bots, BOT, 'daily')).session, NEW_THREAD, 'the premise: the book holds the new thread for daily');
  await changeTab(box, tab.tabId, { tuiIdle: undefined });
  const result = await run;
  await stop();

  assertQuiet(result, 'a new thread while it waited');
  assert.deepEqual(await sendsInto(box, tab.tabId), [], 'nothing typed: the thread the hook ran for is no longer the session\'s');
});

test('a /new reports a new thread in the same tab during the write: the command is taken back in one send, no return, and it exits 0 quietly', async (t) => {
  // The report runs inside Orca's answer to the write, the command's one
  // send, as Codex's SessionStart hook would run while the kit types, under
  // the process chain a tab has; the command goes in after it.
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots);
  await changeTab(box, tab.tabId, { nextScreens: NAMING_SCREENS });
  const report = [box.cli, 'session', 'record', '--bots', bots, '--bot', BOT].map(shellWord).join(' ');
  const chain = await harnessChain(box, report, { stdin: sessionStart({ session: NEW_THREAD, cwd: botHomeOf(bots, BOT) }) });
  const sendsSoFar = orcaCallsOf(await box.orca.calls(), 'terminal send').length;
  await box.orca.set({ runDuring: { command: 'terminal send', argv: chain.argv, env: chain.env, on: sendsSoFar + 1 } });
  const stop = codexRenames(box, tab.tabId);

  const result = await nameHook(box, bots, tab);
  await stop();

  const ran = await box.orca.ranDuring();
  assert.equal(ran.length, 1, `the premise: the report ran during the write, got: ${JSON.stringify(ran)}`);
  assert.equal(ran[0].status, 0, `the premise: and without trouble: ${ran[0].stderr}`);
  assert.equal((await sessionIn(bots, BOT, 'daily')).session, NEW_THREAD, 'the premise: the book holds the new thread for daily');
  assertQuiet(result, 'a new thread while it typed');
  assert.deepEqual(await sendsInto(box, tab.tabId), takenBack(), 'the command, then exactly its characters taken back, and nothing more: no return');
});

// ------------------------------------------------- the typing turn
//
// The architect's ruling on #480 (2026-10-04): one typing turn per session, a
// lock beside its mailbox turn (helpers/typing-turn.js), which any kit path
// that types into the session's tab takes. The naming takes it once it has
// found the session idle, just before the command goes in, and holds it until
// its return is sent or its text is taken back. If anything else holds it, the
// naming types nothing and exits 0 quietly, and tries again at the next turn
// end. Its look between the write and the return asks Orca's tui-idle wait
// for 250 ms or less, so the turn is held for seconds; the look before the
// write, which waits for idle, keeps its own wait.

test('the session\'s typing turn held by something else: the naming types nothing and exits 0 quietly; once it is free, the next turn end names the thread', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots);
  await changeTab(box, tab.tabId, { nextScreens: NAMING_SCREENS });

  const held = await withTypingTurnHeld(bots, BOT, 'daily', () => nameHook(box, bots, tab));

  assertQuiet(held, 'the turn held');
  assert.deepEqual(await sendsInto(box, tab.tabId), [], 'nothing typed while another holds the turn');

  const { result } = await nameHookPlaying(box, bots, tab);

  assertQuiet(result, 'the turn free');
  assert.deepEqual(await sendsInto(box, tab.tabId), renamed(), 'the next run names the thread');
});

test('while the naming types, it holds the session\'s typing turn; once its return is sent, the turn is free', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots);
  await changeTab(box, tab.tabId, { nextScreens: NAMING_SCREENS });
  assert.equal(typingTurnHeld(bots, BOT, 'daily'), false, 'the premise: nothing holds the turn before the run');
  const stop = codexRenames(box, tab.tabId);

  let done;
  const run = nameHook(box, bots, tab);
  run.then((result) => { done = result; });
  const until = Date.now() + 20_000;
  while (done === undefined && (await sendsInto(box, tab.tabId)).length === 0 && Date.now() < until) await sleep(10);
  if (done !== undefined) assertQuiet(done, 'the run, which ended before it typed');
  const sofar = await sendsInto(box, tab.tabId);
  assert.deepEqual(sofar, typed(RENAME), 'the premise: the naming is between its write and its return');
  const heldWhileTyping = typingTurnHeld(bots, BOT, 'daily');
  const result = await run;
  await stop();

  assertQuiet(result, 'the naming');
  assert.deepEqual(await sendsInto(box, tab.tabId), renamed(), 'the premise: the command and its return went in');
  assert.equal(heldWhileTyping, true, 'the session\'s typing turn was held while the command was being typed');
  assert.equal(typingTurnHeld(bots, BOT, 'daily'), false, 'and is free once the run is over');
});

test('another session\'s typing turn held does not stop the naming of this one', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots);
  await changeTab(box, tab.tabId, { nextScreens: NAMING_SCREENS });

  const { result } = await withTypingTurnHeld(bots, BOT, 'review', () => nameHookPlaying(box, bots, tab));

  assertQuiet(result, 'review\'s turn held');
  assert.deepEqual(await sendsInto(box, tab.tabId), renamed(), 'one turn per session: daily is named');
});

// A whole line already on its way into the session's tab (a nudge holding the
// session's line turn) goes first: the naming, about to type, waits up to 10 s
// for it. A line that finishes in that time is followed by the naming as
// usual; one that does not leaves the naming to type nothing, and exit 0
// quietly, until the next turn end.

test('a nudge\'s line on its way into the tab for longer than 10 s: the naming waits for it, then types nothing and exits 0 quietly', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots);
  await changeTab(box, tab.tabId, { nextScreens: NAMING_SCREENS });

  const started = Date.now();
  const result = await withLinesTurnHeld(bots, BOT, 'daily', () => nameHook(box, bots, tab));
  const took = Date.now() - started;

  assertQuiet(result, 'a line on its way');
  assert.deepEqual(await sendsInto(box, tab.tabId), [], 'nothing typed while the line turn was held');
  assert.ok(took >= 8_000, `it waited for the line, up to 10 s, before giving up; it took ${took} ms`);
  assert.ok(took < 60_000, `and the wait is bounded; it took ${took} ms`);
});

test('a nudge\'s line on its way into the tab that finishes after about 2 s: the naming then types the command as usual', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots);
  await changeTab(box, tab.tabId, { nextScreens: NAMING_SCREENS });

  const { result, typedWhileHeld } = await withLinesTurnHeld(bots, BOT, 'daily', async (release) => {
    const run = nameHookPlaying(box, bots, tab);
    await sleep(2_000);
    const sends = await sendsInto(box, tab.tabId);
    release();
    return { ...(await run), typedWhileHeld: sends };
  });

  assertQuiet(result, 'a line that finished');
  assert.deepEqual(typedWhileHeld, [], 'nothing typed while the line was on its way');
  assert.deepEqual(await sendsInto(box, tab.tabId), renamed(), 'then the command and its return');
});

// From the review of 34a9caa: once the naming holds the typing turn (which
// can wait up to 10 s for a line in flight), it looks once more, with no
// further wait, before the command goes in: the book's tab and thread, idle
// with no question and no at-work row, and the input line empty or its
// placeholder.
// If any of these no longer holds, it types nothing and exits 0 quietly.
// Each case below holds the line turn, waits until the naming wants the line
// turn alone (so it holds the typing turn and is waiting for the line), sees
// that it holds the typing turn, changes one thing, then lets the line turn
// go. The contrast is the test above, where nothing changes.

for (const { what, change } of [
  {
    what: 'a /new reports a new thread in the same tab',
    change: async (box, bots, tab) => {
      const heard = await recordSession(box, { bots, bot: BOT, tab: tab.tabId, session: NEW_THREAD });
      assert.equal(heard.code, 0, `the premise: the new thread's report: ${heard.stderr}`);
      assert.equal((await sessionIn(bots, BOT, 'daily')).session, NEW_THREAD, 'the premise: the book holds the new thread for daily');
    },
  },
  { what: 'a draft comes into the input line', change: (box, bots, tab) => changeTab(box, tab.tabId, { screen: CODEX_DRAFT }) },
  { what: 'Codex starts work, its at-work row on screen', change: (box, bots, tab) => changeTab(box, tab.tabId, { screen: CODEX_WORKING }) },
  { what: 'a question of Codex\'s own comes up', change: (box, bots, tab) => changeTab(box, tab.tabId, { screen: CODEX_UPDATE_OFFER }) },
]) {
  test(`${what} while the naming holds the typing turn and waits for a line in flight: nothing typed, and it exits 0 quietly`, async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box);
    const tab = await liveTab(box, bots);
    await changeTab(box, tab.tabId, { nextScreens: NAMING_SCREENS });
    const stop = codexRenames(box, tab.tabId);

    const { result, reached } = await withLinesTurnHeld(bots, BOT, 'daily', async (release) => {
      let done;
      const run = nameHook(box, bots, tab);
      run.then((answer) => { done = answer; });
      const until = Date.now() + 20_000;
      // Wait on the line turn alone: a look at the typing turn takes it for a
      // moment, and the naming that comes to it then finds it held and gives up.
      let wanted = false;
      while (done === undefined && !(wanted = await linesTurnWanted(bots, BOT, 'daily')) && Date.now() < until) await sleep(25);
      const held = done === undefined && wanted && typingTurnHeld(bots, BOT, 'daily');
      if (held) await change(box, bots, tab);
      release();
      return { result: await run, reached: held };
    });
    await stop();

    assert.ok(reached, `the premise: the naming took the typing turn and waited for the line, got: ${JSON.stringify(result)}`);
    assertQuiet(result, what);
    assert.deepEqual(await sendsInto(box, tab.tabId), [], `${what}: nothing typed, not even a key taken back`);
  });
}

test('the look between the write and the return asks Orca\'s tui-idle wait for 250 ms or less', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots);
  await changeTab(box, tab.tabId, { nextScreens: NAMING_SCREENS });
  const from = (await box.orca.calls()).length;

  const { result } = await nameHookPlaying(box, bots, tab);

  assertQuiet(result, 'the naming');
  assert.deepEqual(await sendsInto(box, tab.tabId), renamed(), 'the premise: the command and its return went in');
  const calls = await callsSince(box, from);
  const sendsAt = calls.map((call, at) => ({ call, at })).filter(({ call }) => orcaCommand(call) === 'terminal send' && orcaFlag(call, '--terminal') === tab.handle).map(({ at }) => at);
  const between = calls.slice(sendsAt[0] + 1, sendsAt[1])
    .filter((call) => orcaCommand(call) === 'terminal wait' && orcaFlag(call, '--terminal') === tab.handle && orcaFlag(call, '--for') === 'tui-idle');
  assert.ok(between.length >= 1, `the premise: a look between the write and the return, got ${between.length}`);
  const asked = between.map((call) => orcaFlag(call, '--timeout-ms'));
  assert.deepEqual(
    asked.filter((ms) => !(Number(ms) > 0 && Number(ms) <= 250)),
    [],
    `every look between the write and the return gives --timeout-ms of 250 or less, got: ${JSON.stringify(asked)}`,
  );
});

// ------------------------------------------------- an error once the command is in
//
// From the review of #480, for one write (#713): any error once the command
// went in (a refused or failed `terminal send` of the return, or a look Orca
// refuses) makes the run take back the whole command, one backspace per
// character in one send, and stop with no return. A write Orca refused put
// nothing in, so nothing is taken back. It exits 0 quietly, even when the
// take-back itself fails.

test('Orca refuses the write: nothing went in, nothing is taken back, no return, and it exits 0 quietly', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots);
  await changeTab(box, tab.tabId, { nextScreens: NAMING_SCREENS });
  const sendsSoFar = orcaCallsOf(await box.orca.calls(), 'terminal send').length;
  await box.orca.set({ fail: { 'terminal send': { code: 'runtime_error', message: 'transient send failure', after: sendsSoFar, times: 1 } } });
  const stop = codexRenames(box, tab.tabId);
  const from = (await box.orca.calls()).length;

  const result = await nameHook(box, bots, tab);
  await stop();

  assertQuiet(result, 'a refused write');
  const asked = orcaCallsOf(await callsSince(box, from), 'terminal send').map((call) => orcaFlag(call, '--text'));
  assert.equal(asked[0], RENAME, `the premise: the write was asked for, the whole command in one send, got: ${JSON.stringify(asked)}`);
  assert.deepEqual(await sendsInto(box, tab.tabId), [], 'nothing went in, so no backspaces and no return');
});

test('Orca refuses the return\'s send: the command is taken back in one send, no return, and it exits 0 quietly', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots);
  await changeTab(box, tab.tabId, { nextScreens: NAMING_SCREENS });
  const sendsSoFar = orcaCallsOf(await box.orca.calls(), 'terminal send').length;
  await box.orca.set({ fail: { 'terminal send': { code: 'runtime_error', message: 'transient send failure', after: sendsSoFar + 1, times: 1 } } });
  const stop = codexRenames(box, tab.tabId);

  const result = await nameHook(box, bots, tab);
  await stop();

  assertQuiet(result, 'a refused return');
  assert.deepEqual(await sendsInto(box, tab.tabId), takenBack(), 'the command, then exactly its characters taken back in one send, and nothing more');
});

test('Orca refuses the return\'s send and the take-back after it: no return, nothing more typed, and it exits 0 quietly', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots);
  await changeTab(box, tab.tabId, { nextScreens: NAMING_SCREENS });
  const sendsSoFar = orcaCallsOf(await box.orca.calls(), 'terminal send').length;
  await box.orca.set({ fail: { 'terminal send': { code: 'runtime_error', message: 'transient send failure', after: sendsSoFar + 1, times: 2 } } });
  const stop = codexRenames(box, tab.tabId);

  const result = await nameHook(box, bots, tab);
  await stop();

  assertQuiet(result, 'a refused take-back');
  const sends = await sendsInto(box, tab.tabId);
  assert.deepEqual(sends.slice(0, 1), typed(RENAME), `the premise: the command went in, got: ${JSON.stringify(sends)}`);
  assert.deepEqual(
    sends.slice(1).filter((one) => !/^\x7f+$/.test(one.text)),
    [],
    `after the error, nothing but backspaces: no more text and no return, got: ${JSON.stringify(sends)}`,
  );
});

test('Orca takes the write but does not answer it in time: the take-back counts the whole command, one backspace per character in one send, no return, and it exits 0 quietly', async (t) => {
  // From the review of 34a9caa: a send Orca does not answer in time may still
  // have gone in, so the take-back counts it; one Orca refused does not (the
  // test above). The input line was empty before the write, so a backspace
  // too many does no harm. Here Orca applies the write and holds its answer
  // for 90 s.
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots);
  await changeTab(box, tab.tabId, { nextScreens: NAMING_SCREENS });
  const sendsSoFar = orcaCallsOf(await box.orca.calls(), 'terminal send').length;
  await box.orca.set({ hang: { command: 'terminal send', ms: 90_000, applied: true, from: sendsSoFar, after: 0, times: 1 } });
  const stop = codexRenames(box, tab.tabId);

  const started = Date.now();
  const result = await nameHook(box, bots, tab);
  const took = Date.now() - started;
  await stop();

  assertQuiet(result, 'a write not answered in time');
  assert.ok(took < 60_000, `the late answer does not hold the hook; it took ${took} ms`);
  assert.deepEqual(
    await sendsInto(box, tab.tabId),
    takenBack(),
    'the command that went in late, then exactly as many backspaces as it has characters, in one send, and nothing more',
  );
});

test('Orca refuses the look after the write: the command is taken back in one send, no return, and it exits 0 quietly', async (t) => {
  // Orca refuses every tui-idle look once the write has been asked for, and
  // none before it. The refusal is set before the run, so nothing writes
  // Orca's world while the run types into it.
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots);
  await changeTab(box, tab.tabId, { nextScreens: NAMING_SCREENS });
  const sendsSoFar = orcaCallsOf(await box.orca.calls(), 'terminal send').length;
  await box.orca.set({ fail: { 'terminal wait': { code: 'runtime_error', message: 'transient wait failure', since: 'terminal send', sinceFrom: sendsSoFar } } });
  const stop = codexRenames(box, tab.tabId);

  const result = await nameHook(box, bots, tab);
  await stop();

  assertQuiet(result, 'a refused look');
  assert.deepEqual(await sendsInto(box, tab.tabId), takenBack(), 'the command, then exactly its characters taken back in one send, and nothing more');
});

// ------------------------------------------------- the waits that run out
//
// Each of these costs its whole wait in real time, so they run side by side.

describe('the waits that run out, side by side', { concurrency: true }, () => {
  for (const { what, setUp } of [
    { what: 'Orca reports the session busy', setUp: (box) => box.orca.set({ waitIdle: 'busy' }) },
    { what: 'Orca calls it idle while its screen says "esc to interrupt"', setUp: (box, tab) => changeTab(box, tab.tabId, { screen: CODEX_WORKING }) },
    { what: 'a question of Codex\'s own is on its screen', setUp: (box, tab) => changeTab(box, tab.tabId, { screen: CODEX_UPDATE_OFFER }) },
    // #491: a question drawn above the input line, as the test after the write above says.
    { what: 'Claude Code 2.1.289\'s Teach list is on its screen, above the input box', setUp: (box, tab) => changeTab(box, tab.tabId, { screen: CLAUDE_TEACH_LIST }) },
    { what: 'Orca reports the tab blocked', setUp: (box) => box.orca.set({ waitIdle: 'blocked', blockedReason: 'agent-permission-prompt' }) },
  ]) {
    it(`${what} for the whole 30 s: nothing typed, and it exits 0 quietly once the wait is out`, async (t) => {
      const box = await createSandbox(t);
      const bots = await running(box);
      const tab = await liveTab(box, bots);
      await setUp(box, tab);
      const before = await typedEverywhere(box);

      const started = Date.now();
      const result = await nameHook(box, bots, tab);
      const took = Date.now() - started;

      assertQuiet(result, what);
      assert.deepEqual(await typedEverywhere(box), before, `${what}: nothing is typed into any tab`);
      assert.ok(took >= 25_000, `it waited for the session, up to 30 s, before giving up; it took ${took} ms`);
      assert.ok(took < 90_000, `and the wait is bounded; it took ${took} ms`);
    });
  }

  it('a name Codex never confirms: the kit waits for it, about 10 s, exits 0 quietly, and types nothing more', async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box);
    const tab = await liveTab(box, bots);
    await changeTab(box, tab.tabId, { nextScreens: NAMING_SCREENS });
    const from = (await box.orca.calls()).length;

    const result = await nameHook(box, bots, tab);
    const ended = Date.now();

    assertQuiet(result, 'not confirmed');
    assert.deepEqual(await sendsInto(box, tab.tabId), renamed(), 'the command and its return once: no retry inside one run');
    const calls = await callsSince(box, from);
    const clock = (await box.orca.clock()).slice(from);
    const enter = calls.findIndex((call) => orcaCommand(call) === 'terminal send' && orcaFlag(call, '--text') === '\r');
    const waited = ended - clock[enter].at;
    assert.ok(waited >= 8_000, `after the return it looks for the name in session_index.jsonl for up to 10 s; it ended ${waited} ms after the return`);
    assert.ok(waited < 40_000, `and the wait is bounded; it ended ${waited} ms after the return`);
  });

  for (const { what, misbehaving } of [
    { what: 'Orca answering nothing it can read', misbehaving: { crash: { command: '*', exitCode: 1, stdout: '', stderr: 'orca: the app is not running' } } },
    { what: 'Orca refusing every send', misbehaving: { fail: { 'terminal send': { code: 'runtime_error', message: 'refused' } } } },
  ]) {
    it(`with ${what}, the hook exits 0 quietly, in bounded time`, async (t) => {
      const box = await createSandbox(t);
      const bots = await running(box);
      const tab = await liveTab(box, bots);
      await changeTab(box, tab.tabId, { nextScreens: NAMING_SCREENS });
      await box.orca.set(misbehaving);

      const started = Date.now();
      const result = await nameHook(box, bots, tab);
      const took = Date.now() - started;

      assertQuiet(result, what);
      assert.ok(took < 90_000, `bounded; it took ${took} ms`);
    });
  }

  it('a send Orca does not answer for 90 s does not hold the hook: it exits 0 quietly within a minute', async (t) => {
    // From the review of #480: every Orca call the hook makes has a time
    // bound, the sends included. The first send is answered 90 s late; the
    // rest at once.
    const box = await createSandbox(t);
    const bots = await running(box);
    const tab = await liveTab(box, bots);
    await changeTab(box, tab.tabId, { nextScreens: NAMING_SCREENS });
    await box.orca.set({ hang: { command: 'terminal send', ms: 90_000, times: 1, from: orcaCallsOf(await box.orca.calls(), 'terminal send').length } });

    const started = Date.now();
    const result = await nameHook(box, bots, tab);
    const took = Date.now() - started;

    assertQuiet(result, 'a send Orca does not answer');
    assert.ok(took < 60_000, `a quiet Orca does not hold the hook; it took ${took} ms`);
  });

  it('a line in session_index.jsonl that is not JSON: the hook still exits 0 quietly', async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box);
    const tab = await liveTab(box, bots);
    await changeTab(box, tab.tabId, { nextScreens: NAMING_SCREENS });
    await mkdir(path.dirname(indexFile(box)), { recursive: true });
    await appendFile(indexFile(box), '{"id":"0199c0de-4800-7000-8000-00000000da11","thread_na\n');

    const { result } = await nameHookPlaying(box, bots, tab);

    assertQuiet(result, 'a broken line in the record');
  });
});
