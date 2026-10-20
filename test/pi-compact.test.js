// `obk session compact` on a Pi session (#671, part of #547): the kit types
// Pi's own `/compact` into the Pi tab with the care it takes on Claude Code
// and Codex, and as `obk session clear` takes for `/new` on Pi
// (test/pi-clear.test.js), and confirms the compact by Pi's own record.
//
//   obk session compact --bots <path> --bot <bot> --session <name> [--json]
//
// The requirement (R1 of requests/pi-compact/request.md), as these tests hold it:
//
//   - Every check the clear makes on a Pi tab holds for the compact: refused
//     before anything is typed for a paused session, a tab with its shell in
//     front, or a tab where Orca names another agent; the wait of up to 30 s
//     for the session to be idle with nothing to answer (Pi's at-work top
//     rule, whatever its words, and Pi's selector foot as a question); no
//     draft, and an empty editor between the two rules of Pi's input box; a
//     screen with no input box refused; one character a send, each through
//     the typing gate, 100 ms or more apart; on any stop, exactly the
//     characters typed taken back, that many backspaces (\x7f) in one send;
//     the return a send of its own (`\r`, no --enter); nothing typed after it.
//   - The command is `/compact`. Before the return, the editor's row reads
//     exactly `/compact` (or Orca's draft does, the row blank), and the menu's
//     selected row BELOW the bottom rule, the one that starts `→ `, has
//     `compact` as its first word. Otherwise the eight characters are taken
//     back in one send, no return, and the refusal shows the screen's rows. A
//     list still drawn from an earlier key (`→ changelog` from `/c`, `→ copy`
//     from `/co`) must not run: Return would run its selected row.
//   - Confirmed by Pi's own record of the session's conversation, the book's
//     id: the session file `~/.pi/agent/sessions/--<folder>--/<time>_<id>.jsonl`
//     of the bot home gains a `compaction` line whose `timestamp` is at or
//     after the typing, within 5 minutes. A compaction already in the file, one
//     dated before the typing, one Pi wrote while the kit still waited for the
//     session to go idle, or one in another conversation's file, does not
//     confirm it. `--json` answers `{ bots, compacted: { bot, session,
//     harness: 'pi', conversation, confirmed } }`, as on Claude Code and Codex
//     (test/session-clear.test.js). None in the 5 minutes is not a failure:
//     exit 0, `confirmed: false`, and the plain answer says it is "not
//     confirmed yet".
//   - The kit reads no credential (here, Pi's ~/.pi/agent/auth.json, watched
//     by helpers/read-gate.js), writes nothing into ~/.pi/agent and deletes
//     nothing there: the folder is the same before and after, but for the
//     line Pi itself (this test) appended.
//   - `obk session clear` on Pi is as it was: test/pi-clear.test.js.
//
// How Pi is played here, as in test/pi-clear.test.js: the fake Orca types
// nothing anywhere, and each send into the Pi tab can move its screen on
// (`nextScreens`, helpers/fake-orca.js), so the screens Pi would show as
// `/compact` is typed and entered are given in order (helpers/screens.js, the
// /compact screens, RECONSTRUCTIONS from Pi 1.3.0's code). Pi's part after the
// return, the compaction line in its session file, is written by the test
// once it sees the return go in. A screen that changes on its own, while the
// kit waits before typing, is the fake's `thenScreen`.
//
// How the waits are modelled. The fake Orca keeps no clock, so a wait that
// runs out costs its full real time. test/session-clear.test.js does not test
// the 5-minute wait running out at all, since it costs 300 s; it holds only
// that an early compaction does not confirm, by waiting 10 s after the return
// before it writes the real one. This file does that too (the C tests), and
// also waits the 5 minutes out twice, side by side, at the end (the Y tests).
//
// Every expected value comes from the requirement: the keys, the words on
// screen, the JSON's shape. Every run is in the sandbox (helpers/cli.js), with
// the fake Orca and a fake `pi` (helpers/pi.js); nothing here reaches the real
// Orca, the real `pi` or the real ~/.pi.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  botHomeOf,
  createSandbox,
  orcaCallsOf,
  orcaCommand,
  orcaFlag,
  repoRoot,
  sessionIn,
  snapshot,
  tabsOfBot,
} from './helpers/cli.js';
import { fakePi, piLines, piSessionOnRecord } from './helpers/pi.js';
import {
  PI_COMPACT_DRAFT_KEYS_SWAPPED,
  PI_COMPACT_KEYS_SWAPPED,
  PI_COMPACT_LONGER_SELECTED,
  PI_COMPACT_MENU_ABOVE,
  PI_COMPACT_NO_MENU,
  PI_COMPACT_STALE_CHANGELOG,
  PI_COMPACT_STALE_COPY,
  PI_COMPACT_TYPED,
  PI_COMPACT_TYPED_IN_DRAFT,
  PI_COMPACTING,
  PI_DASH_DRAFT,
  PI_DASH_DRAFT_TWO_DASH_ROWS,
  PI_DASH_DRAFT_TWO_ROWS,
  PI_DASHES_DRAFT,
  PI_DRAFT,
  PI_IDLE,
  PI_IDLE_DIVIDED,
  PI_IDLE_NO_CURSOR,
  PI_LONG_DRAFT,
  PI_LONG_DRAFT_LEFT,
  PI_LONG_DRAFT_ROWS,
  PI_LONG_DRAFT_WORKING,
  PI_MODEL_SELECTOR,
  PI_RULED_DRAFT,
  PI_RULED_DRAFT_NO_TOP,
  PI_SHORT_TOP,
  PI_SUMMARY_IN_CHAT,
  PI_WORKING,
  PI_WORKING_CJK_DIVIDED,
  PI_WORKING_CUT,
  PI_WORKING_DASHES_IN_EDITOR,
  PI_WORKING_EMOJI,
  piAtWorkCompact,
  piBusyWith,
  whileTypingPiCompact,
} from './helpers/screens.js';

const BOT = 'pi-bot';
const PROMPT = 'Read your AGENTS.md and keep the queue moving.';

/** Pi's command to compact, which the kit types. */
const COMPACT = '/compact';

/** The draft the user left in a line, in the tests that have one. */
const DRAFT = 'half a thought about the release';

/** A hard limit for each test, so a wait that never ends fails here rather than hangs the run. */
const LIMIT = { timeout: 120_000 };

/** The limit for a test that waits out the kit's 5 minutes. */
const LONG_LIMIT = { timeout: 420_000 };

/** The command as the kit types it: one character a send, none with a return. */
const typed = (command) => [...command].map((text) => ({ text, enter: false }));

/** One backspace per character of `command`, as the one send that takes it back. */
const backspaces = (command) => '\x7f'.repeat(command.length);

/** The return, as a send of its own. */
const RETURN = { text: '\r', enter: false };

/** `/compact` typed and taken back with eight backspaces in one send, and never entered. */
const TAKEN_BACK = [...typed(COMPACT), { text: backspaces(COMPACT), enter: false }];

/** The screens the Pi tab shows, one per send, as `/compact` is typed, then `after`: the screen once the last character is in, and whatever follows. */
const piScreensFor = (...after) => [...whileTypingPiCompact(), ...after];

/** Pi's own folder under the sandbox's HOME, which the kit must not write into. */
const piAgentOf = (box) => path.join(box.home, '.pi', 'agent');

// ---------------------------------------------------------------- the fleet

/**
 * A bots folder with Bot Father and pi-bot on Pi, the sessions named and up,
 * each tab showing Pi at rest (PI_IDLE), Orca naming agent pi in it, and the
 * book holding the id the kit gave each session. For each session, Pi's
 * session file for that id in the bot home's session folder, begun ten
 * minutes ago with two turns in it. Answers the bots folder, and each
 * session's file and id by name.
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
  const records = {};
  const ids = {};
  for (const name of sessions) {
    const tab = await liveTab(box, bots, name);
    assert.equal(tab.agentIdentity, 'pi', `the premise: Orca names agent pi in ${name}'s tab, got ${tab.agentIdentity}`);
    ids[name] = (await sessionIn(bots, BOT, name)).session;
    assert.equal(typeof ids[name], 'string', `the premise: the book holds an id for ${name}`);
    await changeTab(box, tab.tabId, { screen: PI_IDLE });
    const at = new Date(Date.now() - 10 * 60_000);
    records[name] = await piSessionOnRecord({
      home: box.home,
      cwd: botHomeOf(bots, BOT),
      id: ids[name],
      at,
      lines: [piLines.user(PROMPT, at, 1), piLines.assistant('ok', at, 2), piLines.user('What is in the queue?', at, 3), piLines.assistant('Nothing yet.', at, 4)],
    });
  }
  return { bots, records, ids, record: records.daily, id: ids.daily };
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
const sendsInto = async (box, bots, name = 'daily') => sendsAfterLaunch(await liveTab(box, bots, name));

/** `obk session compact` for pi-bot's `session`, with any more flags. */
const compactOf = (box, { session = 'daily', flags = [], env } = {}) =>
  box.run(['session', 'compact', '--bots', 'bots', '--bot', BOT, '--session', session, ...flags], env === undefined ? {} : { env });

/** Whether the return has gone into the tab. */
const returned = (sends) => sends.some((one) => one.text === '\r');

let compactions = 0;

/** A compaction line, as Pi appends one, dated `at`. */
const compactionAt = (at = new Date()) => {
  compactions += 1;
  return `${JSON.stringify(piLines.compaction(at, compactions))}\n`;
};

/** Pi compacting: one compaction line appended to `file`, dated `at` (now when left out). Answers the text appended. */
async function piCompacts(file, at = new Date()) {
  const line = compactionAt(at);
  await appendFile(file, line);
  return line;
}

/**
 * Run `obk session compact` (with `--json` unless `flags` says otherwise),
 * and play Pi while it runs: once `when` holds for the sends into the
 * session's tab, run `then`, once. Answers the run's result and whether
 * `then` ran.
 */
async function runPlaying(box, bots, { when = returned, then, session = 'daily', flags = ['--json'], env }) {
  const { tabId } = await liveTab(box, bots, session);
  let finished = false;
  const run = compactOf(box, { session, flags, env });
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

/** How many calls of `command` the fake Orca has answered so far. */
const callsOf = async (box, command) => orcaCallsOf(await box.orca.calls(), command).length;

/** The happy path's `compacted`, for daily. */
const confirmedFor = (id) => ({ bot: BOT, session: 'daily', harness: 'pi', conversation: id, confirmed: true });

// ---------------------------------------------------------------- the compact

describe('obk session compact on a Pi session types /compact and is confirmed by Pi\'s record (#671)', { concurrency: 4 }, () => {
  it('P1 the happy path: /compact a character a send, a return of its own, nothing after it, and a compaction in Pi\'s file for the book\'s id is the answer, with harness pi', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, record, id } = await piRunning(box);
    const tab = await liveTab(box, bots);
    const book = await sessionIn(bots, BOT, 'daily');
    await changeTab(box, tab.tabId, { nextScreens: piScreensFor(PI_COMPACT_TYPED, PI_IDLE) });
    const others = Object.fromEntries(Object.entries(await typedEverywhere(box)).filter(([handle]) => handle !== tab.handle));
    const from = (await box.orca.calls()).length;

    const { result, played } = await runPlaying(box, bots, { then: () => piCompacts(record) });

    const answer = answered(result, 'the compact');
    assert.ok(played, 'the premise: the return was sent and Pi wrote its compaction');
    assert.deepEqual(
      await sendsInto(box, bots),
      [...typed(COMPACT), RETURN],
      '/compact as text, one character a send, then the return as a send of its own, and nothing else',
    );
    assert.equal(answer.bots, bots, 'bots is the folder, resolved');
    assert.deepEqual(answer.compacted, confirmedFor(id));
    assert.deepEqual(await sessionIn(bots, BOT, 'daily'), book, 'a compact leaves the book as it was');
    const now = Object.fromEntries(Object.entries(await typedEverywhere(box)).filter(([handle]) => handle !== tab.handle));
    assert.deepEqual(now, others, 'no other tab, Bot Father\'s and the bot\'s other session\'s among them, had anything typed into it');
    await assertSentOnlyInto(box, tab.handle, from, 'compact on Pi');
  });

  for (const { start, read, after, what } of [
    { start: PI_IDLE_NO_CURSOR, read: PI_COMPACT_TYPED, after: PI_IDLE, what: 'its editor row empty with no cursor space before the first key' },
    { start: PI_IDLE, read: PI_COMPACT_TYPED_IN_DRAFT, after: PI_IDLE, what: 'the editor row blank after typing and Orca\'s draft reading /compact' },
    { start: PI_IDLE, read: PI_COMPACT_TYPED, after: PI_COMPACTING, what: 'Pi showing "── ⠋ Compacting context... (escape to cancel) ──…" after the return until it writes its compaction' },
  ]) {
    it(`P1 the compact on Pi with ${what}: /compact is entered, and the compaction is the answer`, LIMIT, async (t) => {
      const box = await createSandbox(t);
      const { bots, record, id } = await piRunning(box);
      await changeTab(box, (await liveTab(box, bots)).tabId, { screen: start, nextScreens: piScreensFor(read, after) });

      const { result, played } = await runPlaying(box, bots, { then: () => piCompacts(record) });

      const answer = answered(result, 'the compact');
      assert.ok(played, 'the premise: the return was sent and Pi wrote its compaction');
      assert.deepEqual(await sendsInto(box, bots), [...typed(COMPACT), RETURN]);
      assert.deepEqual(answer.compacted, confirmedFor(id));
    });
  }

  it('P1 the compact of the bot\'s other session, review: its own tab and its own Pi file, and the answer names review and its conversation', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, records, ids } = await piRunning(box);
    const tab = await liveTab(box, bots, 'review');
    await changeTab(box, tab.tabId, { nextScreens: piScreensFor(PI_COMPACT_TYPED, PI_IDLE) });
    const daily = await sendsInto(box, bots, 'daily');

    const { result, played } = await runPlaying(box, bots, { session: 'review', then: () => piCompacts(records.review) });

    const answer = answered(result, 'the compact of review');
    assert.ok(played, 'the premise: the return was sent and Pi wrote its compaction');
    assert.deepEqual(await sendsInto(box, bots, 'review'), [...typed(COMPACT), RETURN]);
    assert.deepEqual(await sendsInto(box, bots, 'daily'), daily, 'nothing typed into daily\'s tab');
    assert.deepEqual(answer.compacted, { bot: BOT, session: 'review', harness: 'pi', conversation: ids.review, confirmed: true });
  });

  it('P2 each character of /compact is its own send, each after a look through the typing gate, 100 ms or more apart, then the return', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, record } = await piRunning(box);
    const tab = await liveTab(box, bots);
    await changeTab(box, tab.tabId, { nextScreens: piScreensFor(PI_COMPACT_TYPED, PI_IDLE) });
    const from = (await box.orca.calls()).length;

    const { result, played } = await runPlaying(box, bots, { then: () => piCompacts(record) });

    answered(result, 'the compact');
    assert.ok(played, 'the premise: Pi wrote its compaction');
    const calls = (await box.orca.calls()).slice(from);
    const clock = (await box.orca.clock()).slice(from);
    const sends = calls
      .map((call, at) => ({ call, at }))
      .filter(({ call }) => orcaCommand(call) === 'terminal send' && orcaFlag(call, '--terminal') === tab.handle);
    const keys = sends.slice(0, COMPACT.length);
    assert.deepEqual(
      keys.map(({ call }) => ({ text: orcaFlag(call, '--text'), enter: call.args.includes('--enter') })),
      typed(COMPACT),
      'the first eight sends are /compact, one character each, none with --enter',
    );
    let since = -1;
    for (const [n, { at }] of keys.entries()) {
      const looks = calls.slice(since + 1, at).filter((call) => orcaCommand(call) === 'terminal wait'
        && orcaFlag(call, '--terminal') === tab.handle && orcaFlag(call, '--for') === 'tui-idle');
      assert.ok(looks.length > 0, `a look through the gate (terminal wait --for tui-idle on the tab) before character ${n + 1}, ${JSON.stringify(COMPACT[n])}`);
      since = at;
    }
    for (let n = 1; n < keys.length; n += 1) {
      const gap = clock[keys[n].at].at - clock[keys[n - 1].at].at;
      assert.ok(gap >= 100, `character ${n + 1} came ${gap} ms after the one before it; the requirement is 100 ms or more`);
    }
    const ret = sends[COMPACT.length];
    assert.deepEqual(ret && { text: orcaFlag(ret.call, '--text'), enter: ret.call.args.includes('--enter') }, RETURN, 'then the return, as a send of its own, with no --enter');
    assert.equal(sends.length, COMPACT.length + 1, 'and nothing after the return');
  });

  it('P3 the compact without --json says, on its way out, the bot, the session and the conversation, and not that it is unconfirmed', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, record, id } = await piRunning(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: piScreensFor(PI_COMPACT_TYPED, PI_IDLE) });

    const { result, played } = await runPlaying(box, bots, { flags: [], then: () => piCompacts(record) });

    assert.ok(played, 'the premise: Pi wrote its compaction');
    assert.equal(result.code, 0, `the compact should go through: ${result.stdout}${result.stderr}`);
    for (const word of [BOT, 'daily', id]) {
      assert.ok(result.stdout.includes(word), `the plain answer names ${word}, got:\n${result.stdout}`);
    }
    assert.doesNotMatch(result.stdout, /not confirmed/i, `a confirmed compact is not called unconfirmed, got:\n${result.stdout}`);
  });

  it('P4 the kit reads no credential, writes nothing into ~/.pi/agent and deletes nothing there: the folder is as it was, but for Pi\'s own compaction line', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, record, id } = await piRunning(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: piScreensFor(PI_COMPACT_TYPED, PI_IDLE) });
    const agent = piAgentOf(box);
    // Pi's credentials, its settings, and another conversation of the same
    // bot home, compacted an hour ago: all Pi's, none the kit's to touch.
    const auth = path.join(agent, 'auth.json');
    const secret = 'sk-zq-not-a-real-key-6710';
    await mkdir(agent, { recursive: true });
    await writeFile(auth, `${JSON.stringify({ openai: { type: 'api_key', key: secret } })}\n`);
    await writeFile(path.join(agent, 'settings.json'), `${JSON.stringify({ defaultModel: 'gpt-6-luna', defaultProvider: 'openai' })}\n`);
    const hourAgo = new Date(Date.now() - 60 * 60_000);
    await piSessionOnRecord({
      home: box.home,
      cwd: botHomeOf(bots, BOT),
      id: 'an-older-conversation',
      at: hourAgo,
      lines: [piLines.user(PROMPT, hourAgo, 1), piLines.assistant('ok', hourAgo, 2), piLines.compaction(hourAgo, 2)],
    });
    const before = await snapshot(agent);
    const recordBefore = await readFile(record, 'utf8');
    const log = path.join(box.root, 'auth-reads.log');
    const env = {
      ...box.env,
      NODE_OPTIONS: [box.env.NODE_OPTIONS, `--import=${pathToFileURL(path.join(repoRoot, 'test', 'helpers', 'read-gate.js')).href}`].filter(Boolean).join(' '),
      OBK_TEST_READ_GATE_FILE: auth,
      OBK_TEST_READ_GATE_LOG: log,
      OBK_TEST_READ_GATE_AT: '0',
    };

    let line;
    const { result, played } = await runPlaying(box, bots, { env, then: async () => { line = await piCompacts(record); } });

    const answer = answered(result, 'the compact');
    assert.ok(played, 'the premise: the return was sent and Pi wrote its compaction');
    assert.deepEqual(answer.compacted, confirmedFor(id));
    const recordRel = path.relative(agent, record).split(path.sep).join('/');
    assert.ok(recordRel in before, `the premise: the session file is under ~/.pi/agent, at ${recordRel}`);
    const expected = { ...before, [recordRel]: `file:${createHash('sha256').update(recordBefore + line).digest('hex')}` };
    assert.deepEqual(await snapshot(agent), expected, 'every file and folder under ~/.pi/agent is as it was, and the session file holds what it held and Pi\'s own line, nothing more');
    assert.equal(await readFile(log, 'utf8').catch(() => ''), '', 'the compact never reads ~/.pi/agent/auth.json');
    assert.ok(!(result.stdout + result.stderr).includes(secret), 'nothing of Pi\'s credentials is in the answer');
  });

  // ------------------------------------------------ refused before anything is typed

  it('R1 a paused Pi session: refused, saying it is paused, and nothing typed', LIMIT, async (t) => {
    const box = await createSandbox(t);
    await piRunning(box);
    const paused = await box.run(['pause', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);
    assert.equal(paused.code, 0, `the pause this test stands on: ${paused.stdout}${paused.stderr}`);
    const before = await typedEverywhere(box);

    const said = assertRefused(await compactOf(box));

    assert.match(said, /paused/i, `it says the session is paused, got:\n${said}`);
    await assertNothingTyped(box, before, 'a paused Pi session');
  });

  it('R1 a Pi tab with only its shell in front: refused, saying a restart brings it back, and nothing typed', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots } = await piRunning(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { foreground: 'shell' });
    const before = await typedEverywhere(box);

    assertRefused(await compactOf(box), 'restart');

    await assertNothingTyped(box, before, 'the shell in front of a Pi tab');
  });

  it('R1 a Pi session\'s tab where Orca names another agent, claude: refused, naming it, and nothing typed', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots } = await piRunning(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { agentIdentity: 'claude' });
    const before = await typedEverywhere(box);
    const book = await sessionIn(bots, BOT, 'daily');

    assertRefused(await compactOf(box), 'claude');

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
      const { bots } = await piRunning(box);
      await changeTab(box, (await liveTab(box, bots)).tabId, { ...change, nextScreens: piScreensFor(PI_COMPACT_TYPED, PI_IDLE) });
      const before = await typedEverywhere(box);

      const said = assertRefused(await compactOf(box));

      await assertNothingTyped(box, before, `a draft in the Pi line (${what})`);
      assert.ok(said.includes(DRAFT), `the refusal shows what the line holds, ${DRAFT}, got:\n${said}`);
    });
  }

  // An editor row that starts with `─` is an editor row, not the box's top
  // rule (the review of #663). With no draft from Orca, each is a draft in
  // the line: refused before the first key, nothing typed.
  for (const { screen, shows, what } of [
    { screen: PI_DASH_DRAFT, shows: '─ a draft of the user', what: 'one editor row "─ a draft of the user"' },
    { screen: PI_RULED_DRAFT, shows: '── a draft ──', what: 'one editor row "── a draft ──"' },
    { screen: PI_DASH_DRAFT_TWO_ROWS, shows: 'and the second row of it', what: 'two editor rows, the first "─ the first row of a draft"' },
    { screen: PI_DASH_DRAFT_TWO_DASH_ROWS, shows: '─ and the second row of it', what: 'two editor rows, each starting with "─"' },
    { screen: PI_DASHES_DRAFT, shows: '──────────', what: 'one editor row "──────────", `─` alone and shorter than the rules' },
  ]) {
    it(`D2 Orca gives no draft and Pi's editor holds ${what}: refused before the first character, nothing typed into any tab, and the refusal is about the line`, LIMIT, async (t) => {
      const box = await createSandbox(t);
      const { bots } = await piRunning(box);
      await changeTab(box, (await liveTab(box, bots)).tabId, { screen, nextScreens: piScreensFor(PI_COMPACT_TYPED, PI_IDLE) });
      const before = await typedEverywhere(box);

      const said = assertRefused(await compactOf(box));

      await assertNothingTyped(box, before, `a draft in the Pi line (${what})`);
      assert.ok(said.includes(shows), `the refusal shows the draft, ${shows}, got:\n${said}`);
      const own = screen.filter((row) => row.trim() !== '').reduce((rest, row) => rest.replaceAll(row.trim(), ''), said);
      assert.match(own, /\b(?:line|draft|editor)\b/i, `the refusal is about what the line holds, got:\n${said}`);
    });
  }

  for (const { screen, what } of [
    { screen: PI_SHORT_TOP, what: 'the row right above the editor is a rule of another width than the bottom rule' },
    { screen: PI_RULED_DRAFT_NO_TOP, what: 'a bottom rule with "── a draft ──" above it and no top rule at all' },
  ]) {
    it(`D3 ${what}: no input box, so nothing typed, and the refusal says the screen shows no input box`, LIMIT, async (t) => {
      const box = await createSandbox(t);
      const { bots } = await piRunning(box);
      await changeTab(box, (await liveTab(box, bots)).tabId, { screen, nextScreens: piScreensFor(PI_COMPACT_TYPED, PI_IDLE) });
      const before = await typedEverywhere(box);

      const said = assertRefused(await compactOf(box));

      await assertNothingTyped(box, before, 'a screen with no input box');
      assert.match(said, /input box/i, `it says the screen shows no input box, got:\n${said}`);
      assert.doesNotMatch(said, /busy/i, `and does not call the session busy, got:\n${said}`);
    });
  }

  // ------------------------------------------------ busy, by Pi's own row

  // A screen that shows Pi at work for its first three reads, Orca's tui-idle
  // answering ok all along, then Pi at rest: the kit may type only after a
  // read that shows Pi at rest, the fourth at the earliest.
  for (const { screen, what } of [
    { screen: PI_WORKING, what: 'its usual row, "── ⠋ Working ──…", no hint after the message' },
    { screen: PI_COMPACTING, what: 'Pi compacting on its own, "── ⠋ Compacting context... (escape to cancel) ──…"' },
    { screen: PI_WORKING_CUT, what: 'a status cut short in a narrow tab, "── ⠋ Working (escape to ────"' },
    { screen: piBusyWith('Reading the pull request'), what: 'an extension\'s own message, "── ⠋ Reading the pull request ──…"' },
    { screen: PI_LONG_DRAFT_WORKING, what: 'the status beside the scroll label, "── ⠋ Working ─── ↑ 3 more ──…", a long draft below it' },
    { screen: PI_WORKING_DASHES_IN_EDITOR, what: 'its usual row, "── ⠋ Working ──…", over an editor row "──────────"' },
    { screen: PI_WORKING_EMOJI, what: 'an extension\'s message with an emoji, "── ⠋ Reading 🔎 ──…", 119 code points in 120 columns' },
    { screen: PI_WORKING_CJK_DIVIDED, what: 'an extension\'s message in CJK characters, "── ⠋ 正在处理 ──…", under a full-width divider in the chat' },
  ]) {
    it(`B1 Pi at work by its top rule ${what}, Orca's tui-idle ok: waited out, nothing typed until a read shows Pi at rest, then /compact is entered`, LIMIT, async (t) => {
      const box = await createSandbox(t);
      const { bots, record, id } = await piRunning(box);
      const tab = await liveTab(box, bots);
      await changeTab(box, tab.tabId, {
        screen,
        thenScreen: PI_IDLE,
        readsBeforeThen: 3,
        nextScreens: piScreensFor(PI_COMPACT_TYPED, PI_IDLE),
      });
      const from = (await box.orca.calls()).length;

      const { result, played } = await runPlaying(box, bots, { then: () => piCompacts(record) });

      const answer = answered(result, 'the compact');
      assert.ok(played, 'the premise: Pi wrote its compaction');
      assert.deepEqual(answer.compacted, confirmedFor(id));
      assert.deepEqual(await sendsInto(box, bots), [...typed(COMPACT), RETURN]);
      const reads = await readsBeforeFirstSend(box, tab.handle, from);
      assert.ok(reads >= 4, `nothing was typed while the screen showed Pi at work: the first read to show it at rest is the fourth, and ${reads} read(s) came before the first key`);
    });
  }

  for (const { screen, what } of [
    { screen: PI_SUMMARY_IN_CHAT, what: 'a row "── Summary ──…" in the chat above the box, as a compaction\'s summary may draw, the box\'s top rule `─` alone' },
    { screen: PI_IDLE_DIVIDED, what: 'full-width dividers of `─` alone in the chat above the box, the box\'s top rule `─` alone, its editor empty' },
  ]) {
    it(`B2 ${what}: no sign of work, so /compact is typed at once and entered`, LIMIT, async (t) => {
      const box = await createSandbox(t);
      const { bots, record } = await piRunning(box);
      await changeTab(box, (await liveTab(box, bots)).tabId, { screen, nextScreens: piScreensFor(PI_COMPACT_TYPED, PI_IDLE) });

      const started = Date.now();
      const { result, played } = await runPlaying(box, bots, { then: () => piCompacts(record) });
      const took = Date.now() - started;

      answered(result, 'the compact');
      assert.ok(played, 'the premise: Pi wrote its compaction');
      assert.deepEqual(await sendsInto(box, bots), [...typed(COMPACT), RETURN]);
      assert.ok(took < 20_000, `nothing was waited out: it took ${took} ms`);
    });
  }

  it('B3 Pi\'s /model selector on screen, Orca calling the tab idle: waited out as a question, nothing typed until it is gone, then /compact is entered', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, record } = await piRunning(box);
    const tab = await liveTab(box, bots);
    await changeTab(box, tab.tabId, {
      screen: PI_MODEL_SELECTOR,
      thenScreen: PI_IDLE,
      readsBeforeThen: 3,
      nextScreens: piScreensFor(PI_COMPACT_TYPED, PI_IDLE),
    });
    const from = (await box.orca.calls()).length;

    const { result, played } = await runPlaying(box, bots, { then: () => piCompacts(record) });

    answered(result, 'the compact');
    assert.ok(played, 'the premise: Pi wrote its compaction');
    assert.deepEqual(await sendsInto(box, bots), [...typed(COMPACT), RETURN]);
    const reads = await readsBeforeFirstSend(box, tab.handle, from);
    assert.ok(reads >= 4, `nothing was typed while the selector was up: the first read without it is the fourth, and ${reads} read(s) came before the first key`);
  });

  // A long draft, Pi at rest: its scroll labels in the rules are no status.
  for (const { screen, what } of [
    { screen: PI_LONG_DRAFT, what: 'centred, "── ↑ 3 more ──" and "── ↓ 2 more ──"' },
    { screen: PI_LONG_DRAFT_LEFT, what: 'near the left end, "─── ↑ 3 more ───…" and "─── ↓ 2 more ───…"' },
  ]) {
    it(`B4 a long draft with Pi's scroll labels in its rules, ${what}, and no status: refused at once for the draft, nothing typed`, LIMIT, async (t) => {
      const box = await createSandbox(t);
      const { bots } = await piRunning(box);
      await changeTab(box, (await liveTab(box, bots)).tabId, { screen, nextScreens: piScreensFor(PI_COMPACT_TYPED, PI_IDLE) });
      const before = await typedEverywhere(box);

      const started = Date.now();
      const said = assertRefused(await compactOf(box));
      const took = Date.now() - started;

      await assertNothingTyped(box, before, 'a long draft in the Pi line');
      assert.ok(PI_LONG_DRAFT_ROWS.some((row) => said.includes(row)), `the refusal shows what the line holds, got:\n${said}`);
      assert.doesNotMatch(said, /busy/i, `a scroll label is no sign of work, got:\n${said}`);
      assert.ok(took < 20_000, `nothing was waited out: it took ${took} ms`);
    });
  }

  // ------------------------------------------------ Pi at work between characters

  it('W1 Pi\'s at-work row comes up in its top rule after two characters: the typing stops, the two are taken back in one send, and the refusal names the row', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, record } = await piRunning(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: [whileTypingPiCompact()[0], piAtWorkCompact('/c'), PI_IDLE] });
    const file = await readFile(record, 'utf8');

    const said = assertRefused(await compactOf(box));

    assert.deepEqual(await sendsInto(box, bots), [...typed('/c'), { text: backspaces('/c'), enter: false }], 'the two typed, then exactly those two taken back, and nothing more');
    assert.ok(said.includes('⠋ Working'), `it names its signal, the at-work row "── ⠋ Working ──…", got:\n${said}`);
    assert.equal(await readFile(record, 'utf8'), file, 'Pi\'s file is as it was');
  });

  it('W1 Pi\'s at-work row is up once the last character of /compact is in: no return, the eight taken back in one send, and the refusal names the row', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots } = await piRunning(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: piScreensFor(piAtWorkCompact(COMPACT), PI_IDLE) });

    const said = assertRefused(await compactOf(box));

    assert.deepEqual(await sendsInto(box, bots), TAKEN_BACK, 'the look before the return stops it');
    assert.ok(said.includes('⠋ Working'), `it names its signal, the at-work row "── ⠋ Working ──…", got:\n${said}`);
  });

  it('W1 the menu draws late, after the last character, with Pi\'s at-work row on the same screen: no return, the eight taken back, and the refusal names the row', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots } = await piRunning(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, {
      nextScreens: piScreensFor({ screen: PI_COMPACT_NO_MENU, then: piAtWorkCompact(COMPACT) }, PI_IDLE),
    });

    const said = assertRefused(await compactOf(box));

    assert.deepEqual(await sendsInto(box, bots), TAKEN_BACK, 'the screen that passed the menu rule carried the at-work row, so no return');
    assert.ok(said.includes('⠋ Working'), `it names its signal, the at-work row "── ⠋ Working ──…", got:\n${said}`);
  });
});

// ---------------------------------------------------------------- the screen before the return
//
// Side by side: a check that wrongly lets the return in waits out the 5
// minutes for Pi's record, past this file's limit for each test.

describe('#671: Pi refusals once /compact is typed, side by side', { concurrency: true }, () => {
  for (const { read, shows, what } of [
    { read: PI_COMPACT_NO_MENU, shows: 'openai/gpt-6-luna', what: 'no menu below the bottom rule, the footer right under it' },
    { read: PI_COMPACT_STALE_CHANGELOG, shows: '→ changelog', what: 'the list drawn for /c still below the box, its selected row changelog, with compact under it' },
    { read: PI_COMPACT_STALE_COPY, shows: '→ copy', what: 'the list drawn for /co still below the box, its selected row copy, with compact under it' },
    { read: PI_COMPACT_LONGER_SELECTED, shows: '→ compact-memory', what: 'the selected row an extension\'s command whose name only starts with compact, compact-memory' },
    { read: PI_COMPACT_MENU_ABOVE, shows: 'openai/gpt-6-luna', what: 'the "→ compact" row drawn above the top rule and nothing below the bottom rule' },
    { read: PI_COMPACT_KEYS_SWAPPED, shows: '/compcat', what: 'the editor row reads /compcat under the right menu' },
    { read: PI_COMPACT_DRAFT_KEYS_SWAPPED, shows: '/compcat', what: 'Orca\'s draft reads /compcat, the editor row blank, under the right menu' },
  ]) {
    it(`M1 ${what}: no return, the eight taken back in one send, refused, and the refusal shows the screen's rows`, LIMIT, async (t) => {
      const box = await createSandbox(t);
      const { bots, record } = await piRunning(box);
      await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: piScreensFor(read, PI_IDLE) });
      const book = await sessionIn(bots, BOT, 'daily');
      const file = await readFile(record, 'utf8');

      const said = assertRefused(await compactOf(box));

      assert.deepEqual(await sendsInto(box, bots), TAKEN_BACK, '/compact taken back with eight backspaces in one send, and never entered');
      assert.ok(said.includes(shows), `the refusal says what the screen showed, ${shows} among it, got:\n${said}`);
      assert.deepEqual(await sessionIn(bots, BOT, 'daily'), book, 'the book is as it was');
      assert.equal(await readFile(record, 'utf8'), file, 'Pi\'s file is as it was');
    });
  }
});

// ---------------------------------------------------------------- what does not confirm
//
// Side by side. Each writes something that is not Pi's compaction of this
// conversation after /compact was typed, then, 10 s after the return, the
// real one. A kit that took the early line for the compaction would have
// answered by then.

/**
 * Run `obk session compact --json` on daily; once the return has gone in,
 * run `early`, wait 10 s, note whether the run has answered, and then write
 * Pi's real compaction into `record`. Answers the run's result and whether it
 * had answered before the real one.
 */
async function confirmedOnlyByTheRealOne(box, bots, record, early = async () => {}) {
  let finished = false;
  const run = compactOf(box, { flags: ['--json'] });
  run.then(() => { finished = true; }, () => { finished = true; });
  const until = Date.now() + 25_000;
  while (!finished && Date.now() < until && !returned(await sendsInto(box, bots))) await sleep(50);
  assert.ok(returned(await sendsInto(box, bots)), `the premise: /compact was typed and entered, got: ${JSON.stringify(await sendsInto(box, bots))}`);
  await early();
  await sleep(10_000);
  const answeredEarly = finished;
  await piCompacts(record);
  return { result: await run, answeredEarly };
}

/** The verdict of `confirmedOnlyByTheRealOne`: not answered on the early line, and confirmed by the real one. */
function assertConfirmedOnlyByTheRealOne({ result, answeredEarly }, id, what) {
  assert.equal(answeredEarly, false, `${what} must not confirm the compact, but it had answered before Pi's real compaction was written:\n${result.stdout}${result.stderr}`);
  assert.deepEqual(answered(result, 'the compact').compacted, confirmedFor(id), 'Pi\'s real compaction, written after, confirms it');
}

describe('#671: what does not confirm a compact on Pi, side by side', { concurrency: true }, () => {
  it('C1 a compaction already in Pi\'s file before the command does not confirm it; the one after the return does', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, record, id } = await piRunning(box);
    await piCompacts(record, new Date(Date.now() - 60_000));
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: piScreensFor(PI_COMPACT_TYPED, PI_IDLE) });

    const outcome = await confirmedOnlyByTheRealOne(box, bots, record);

    assertConfirmedOnlyByTheRealOne(outcome, id, 'a compaction already in the file');
    assert.deepEqual(await sendsInto(box, bots), [...typed(COMPACT), RETURN]);
  });

  it('C2 a compaction written after the return but dated before the command does not confirm it; one dated after does', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, record, id } = await piRunning(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: piScreensFor(PI_COMPACT_TYPED, PI_IDLE) });
    const old = new Date(Date.now() - 5 * 60_000);

    const outcome = await confirmedOnlyByTheRealOne(box, bots, record, () => piCompacts(record, old));

    assertConfirmedOnlyByTheRealOne(outcome, id, `a compaction dated ${old.toISOString()}, before the command`);
  });

  it('C3 Pi\'s own automatic compaction, written while the kit waits out "Compacting context..." before it types, does not confirm it; the one after the return does', LIMIT, async (t) => {
    // Pi's top rule shows it compacting on its own for the first three reads.
    // Before the fake answers the first read, it writes a compaction into the
    // file, dated then: after the command began, before /compact was typed.
    const box = await createSandbox(t);
    const { bots, record, id } = await piRunning(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, {
      screen: PI_COMPACTING,
      thenScreen: PI_IDLE,
      readsBeforeThen: 3,
      nextScreens: piScreensFor(PI_COMPACT_TYPED, PI_IDLE),
    });
    const early = "const line = JSON.parse(process.argv[2]); line.timestamp = new Date().toISOString();"
      + " require('node:fs').appendFileSync(process.argv[1], JSON.stringify(line) + '\\n');";
    await box.orca.set({
      runDuring: {
        command: 'terminal read',
        argv: [process.execPath, '-e', early, record, JSON.stringify(piLines.compaction(new Date(0), 99))],
        on: (await callsOf(box, 'terminal read')) + 1,
      },
    });

    const outcome = await confirmedOnlyByTheRealOne(box, bots, record);

    const ran = await box.orca.ranDuring();
    assert.equal(ran.length, 1, `the premise: Pi's automatic compaction was written during the kit's first read, got: ${JSON.stringify(ran)}`);
    assert.equal(ran[0].status, 0, `the premise: and written without trouble: ${ran[0].stderr}`);
    assertConfirmedOnlyByTheRealOne(outcome, id, 'Pi\'s automatic compaction written before /compact was typed');
  });

  it('C4 a fresh compaction in another conversation\'s file in the same session folder does not confirm it; the one in the book\'s conversation does', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, record, id } = await piRunning(box);
    const hourAgo = new Date(Date.now() - 60 * 60_000);
    const other = await piSessionOnRecord({
      home: box.home,
      cwd: botHomeOf(bots, BOT),
      id: 'an-older-conversation',
      at: hourAgo,
      lines: [piLines.user(PROMPT, hourAgo, 1), piLines.assistant('ok', hourAgo, 2)],
    });
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: piScreensFor(PI_COMPACT_TYPED, PI_IDLE) });

    const outcome = await confirmedOnlyByTheRealOne(box, bots, record, () => piCompacts(other));

    assertConfirmedOnlyByTheRealOne(outcome, id, 'a compaction in another conversation\'s file');
  });

  it('C5 a line of another type written after the return, a message, does not confirm it; the compaction after it does', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, record, id } = await piRunning(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: piScreensFor(PI_COMPACT_TYPED, PI_IDLE) });

    const outcome = await confirmedOnlyByTheRealOne(box, bots, record, () => appendFile(record, `${JSON.stringify(piLines.assistant('Compacted the context.', new Date(), 5))}\n`));

    assertConfirmedOnlyByTheRealOne(outcome, id, 'a message line that is no compaction');
  });
});

// ---------------------------------------------------------------- the 30 s waits that run out

describe('#671: the Pi waits that run out before typing, side by side', { concurrency: true }, () => {
  for (const { screen, what, names } of [
    { screen: PI_WORKING, what: 'its usual top rule "── ⠋ Working ──…"', names: '⠋ Working' },
    { screen: PI_COMPACTING, what: 'its top rule "── ⠋ Compacting context... (escape to cancel) ──…"', names: 'Compacting context' },
  ]) {
    it(`X1 Pi at work by ${what} for the whole 30 s, Orca's tui-idle ok: refused after about that long, saying it is busy and naming the row, nothing typed`, LIMIT, async (t) => {
      const box = await createSandbox(t);
      const { bots, record } = await piRunning(box);
      await changeTab(box, (await liveTab(box, bots)).tabId, { screen });
      const before = await typedEverywhere(box);
      const file = await readFile(record, 'utf8');

      const started = Date.now();
      const result = await compactOf(box);
      const took = Date.now() - started;

      const said = assertRefused(result);
      assert.match(said, /busy/i, `it says the session is busy, got:\n${said}`);
      assert.ok(said.includes(names), `and names its signal, the at-work row with "${names}", got:\n${said}`);
      await assertNothingTyped(box, before, 'Pi at work throughout');
      assert.ok(took >= 25_000, `it waited for the session, up to 30 s, before refusing; it took ${took} ms`);
      assert.ok(took < 90_000, `and the wait is bounded; it took ${took} ms`);
      assert.equal(await readFile(record, 'utf8'), file, 'Pi\'s file is as it was');
    });
  }

  it('X1 Pi\'s /model selector on screen for the whole 30 s, Orca calling the tab idle: refused, saying a question is up, nothing typed', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots } = await piRunning(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { screen: PI_MODEL_SELECTOR });
    const before = await typedEverywhere(box);

    const said = assertRefused(await compactOf(box));

    assert.match(said, /question/i, `it says a question is waiting, got:\n${said}`);
    await assertNothingTyped(box, before, 'a Pi selector on screen');
  });
});

// ---------------------------------------------------------------- the 5 minutes that run out
//
// Side by side, about 5 minutes each. Pi can fail a compact and write nothing
// ("Nothing to compact (session too small)", "Already compacted"); the kit
// then says the compact is not confirmed yet, and that is not a failure.

describe('#671: the 5 minutes for Pi\'s record run out, side by side', { concurrency: true }, () => {
  it('Y1 --json, with only lines that do not confirm (one already in the file, one dated before the command, one in another conversation): exit 0 after about 5 minutes, confirmed false, harness pi', LONG_LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, record, id } = await piRunning(box);
    await piCompacts(record, new Date(Date.now() - 60_000));
    const hourAgo = new Date(Date.now() - 60 * 60_000);
    const other = await piSessionOnRecord({
      home: box.home,
      cwd: botHomeOf(bots, BOT),
      id: 'an-older-conversation',
      at: hourAgo,
      lines: [piLines.user(PROMPT, hourAgo, 1), piLines.assistant('ok', hourAgo, 2)],
    });
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: piScreensFor(PI_COMPACT_TYPED, PI_IDLE) });
    const old = new Date(Date.now() - 5 * 60_000);

    const started = Date.now();
    const { result, played } = await runPlaying(box, bots, {
      then: async () => {
        await piCompacts(record, old);
        await piCompacts(other);
      },
    });
    const took = Date.now() - started;

    assert.ok(played, 'the premise: the return was sent and the lines were written');
    const answer = answered(result, 'a compact Pi\'s record does not show in time');
    assert.deepEqual(answer.compacted, { bot: BOT, session: 'daily', harness: 'pi', conversation: id, confirmed: false });
    assert.deepEqual(await sendsInto(box, bots), [...typed(COMPACT), RETURN], 'the command was entered once, and nothing was typed after it');
    assert.ok(took >= 280_000, `it waited the 5 minutes for Pi's record before it answered; it took ${took} ms`);
    assert.ok(took < 400_000, `and the wait is bounded; it took ${took} ms`);
  });

  it('Y2 plain, Pi writing nothing at all: exit 0 after about 5 minutes, saying the compact of the bot\'s session is not confirmed yet', LONG_LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots } = await piRunning(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: piScreensFor(PI_COMPACT_TYPED, PI_IDLE) });

    const started = Date.now();
    const result = await compactOf(box);
    const took = Date.now() - started;

    assert.equal(result.code, 0, `a compact not confirmed in time is not a failure: ${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /not confirmed yet/i, `it says the compact is not confirmed yet, got:\n${result.stdout}`);
    for (const word of [BOT, 'daily']) {
      assert.ok(result.stdout.includes(word), `the plain answer names ${word}, got:\n${result.stdout}`);
    }
    assert.deepEqual(await sendsInto(box, bots), [...typed(COMPACT), RETURN], 'the premise: the command was entered');
    assert.ok(took >= 280_000, `it waited the 5 minutes for Pi's record before it answered; it took ${took} ms`);
  });
});
