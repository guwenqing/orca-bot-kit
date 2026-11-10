// `obk restart` tells the session it resumed what the restart ended (#726).
//
// What happened (the issue): `obk restart` closed a Claude session's tab and
// resumed its conversation in a new tab. Closing the old tab ended the
// harness's background shells (an hourly timer, a repo watch), and the kit
// typed nothing into the resumed session, so nothing told it. The kit typed a
// line only into a resumed Codex session, the list line (#226, #709), so that
// Orca lists it.
//
// The requirement, as the architect ruled it:
//
//   R1. On the `obk restart` road only, for each session whose live tab this
//       restart closed and whose conversation it then resumed in a new tab
//       where the harness came up, the kit types exactly one line into the new
//       tab: the restart line. On every harness: Claude Code, Codex and Pi.
//   R2. The restart line, word for word, is `restartLineOf` in helpers/cli.js:
//       `cli` is the CLI that ran the command and `bots` the bots folder by its
//       absolute path, each spelled by `shellWord`, as `listLineOf` does. The
//       backticks are part of the line. It is submitted with a return.
//   R3. For a Codex session on the restart road, the restart line takes the
//       place of the list line: one line in all, never both. On the `up` and
//       `unpause` roads nothing changes: a resumed Codex session still gets the
//       list line, and a resumed Claude or Pi session still gets no line.
//       Since #732 the `unpause` road types a line of its own, the unpause
//       line (unpause-line.test.js); the restart line is still never typed there.
//   R4. The restart line goes through the list line's gate, with the same 20 s
//       cutoff: nothing is typed while Orca reports the tab blocked, while a
//       question, a form or a menu of the harness is on its screen, or while
//       the kit cannot tell whether the harness is there. It is taken in the
//       session's typing turn, as the list line is
//       (typing-turn-list-line.test.js). On Pi: no line into a Pi selector
//       (a question, by its cancel foot, and a menu, by its `→` list), and one
//       line into a ready Pi tab.
//   R5. No line on the restart road for a session whose tab was not open when
//       the restart ran (the restart closed nothing of it; `up` just brings it
//       back), a session started fresh rather than resumed (the shell-in-front
//       case: the harness had quit, and the session starts with its start
//       prompt), or a session that is paused.
//   R6. The report. In the `--json` answer of `obk restart`, each tab entry of
//       a session that R1 covers carries `restartLine: true` when the line was
//       typed, or `restartLine: false` with `restartLineTrouble`, a sentence
//       that says why, when it was not (the gate's reason, or that the harness
//       did not come up in the new tab). Such an entry carries no `listLine`
//       key. The plain report says under that tab, in a line of its own,
//       whether the session was told what the restart ended; when it was not,
//       that line gives the reason and tells the caller to tell the session
//       itself. Only the JSON keys and the line's words are ruled, so the plain
//       report is read by those facts, not by its words.
//   R7. No new command, option or environment variable in the kit for this
//       (test/core-is-core.test.js and the command-list check guard that).
//
// Readings this file takes where the ruling does not spell a case out:
//
//   - A Codex session whose tab was not open is brought back by `restart` as
//     `up` brings it back (R5: "`up` just brings it back"), so it still gets
//     the list line, as on `up`, and no restart line.
//   - A tab entry of a session that R1 does not cover carries no
//     `restartLine` key at all: R6 defines the key for the sessions R1 covers,
//     and a `restartLine: false` there would have the caller tell a session
//     that lost nothing.
//
// How the wait is modelled is as in codex-resume-list-line.test.js: the fake
// Orca keeps no clock, time passes in it only while `terminal wait` waits, and
// a `waitIdle` list is one answer per `terminal wait`. The 20 s cutoff is
// modelled with the fake's `hang` on `terminal read`, 21 s a read, which
// costs a minute or more of real time. The typing turn is held from the test
// process, as typing-turn-list-line.test.js holds it.
//
// Every expected value is the ruling's: the line's words, the report's keys,
// and Orca's own reason where it gave one. Every run is in the sandbox
// (helpers/cli.js), with the fake Orca, the fake `ps` and a fake `pi`
// (helpers/pi.js). Nothing here reaches the real Orca, a real harness, or the
// real ~/.claude, ~/.codex or ~/.pi.

import assert from 'node:assert/strict';
import { realpath } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, it } from 'node:test';

import {
  botHomeOf,
  conversationOnRecord,
  createSandbox,
  listLineOf,
  recordSession,
  restartLineOf,
  sentInto,
  sessionIn,
  tabsOfBot,
  typedInto,
  unpauseLineOf,
} from './helpers/cli.js';
import { fakePi, piLines, piSessionOnRecord } from './helpers/pi.js';
import { CLAUDE_TEACH_LIST, PI_IDLE, PI_MODEL_SELECTOR } from './helpers/screens.js';
import { withTypingTurnHeld } from './helpers/typing-turn.js';

const PROMPT = 'Read your AGENTS.md and keep the queue moving.';
const BOT = 'api-bot';

/** A hard limit for each test, so a wait that never ends fails here rather than hangs the run. */
const LIMIT = { timeout: 180_000 };

/** The words the report gives for a line the typing turn kept out (#482). */
const TYPING = /the kit is typing into it/;

// ------------------------------------------------------------- the fleet

/**
 * A bots folder (`folder`, `bots` unless named) with Bot Father and api-bot
 * on `harness`, with the sessions named, none of them up yet. `harnessOf`
 * gives a session a harness of its own, set when it is added.
 */
async function madeBot(box, { harness = 'claude', sessions = ['daily'], harnessOf = () => undefined, folder = 'bots' } = {}) {
  if (harness === 'pi' || sessions.some((name) => harnessOf(name) === 'pi')) await fakePi(box);
  assert.equal((await box.run(['init', '--bots', folder, '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', folder, '--name', BOT, '--harness', harness]);
  assert.equal(made.code, 0, `${made.stdout}${made.stderr}`);
  for (const name of sessions) {
    const own = harnessOf(name);
    const added = await box.run(['session', 'add', '--bots', folder, '--bot', BOT, '--name', name, ...(own ? ['--harness', own] : []), '--prompt', PROMPT]);
    assert.equal(added.code, 0, `${added.stdout}${added.stderr}`);
  }
  return box.path(folder);
}

/** Run one kit command for api-bot, `--json` unless `plain`. */
const kit = (box, command, { plain = false, folder = 'bots', flags = [] } = {}) =>
  box.run([command, '--bots', folder, '--bot', BOT, ...(plain ? [] : ['--json']), ...flags]);

/** The JSON a kit command answered with, which must have gone through. */
function answered(result, what) {
  assert.equal(result.code, 0, `${what} should go through: ${result.stdout}${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch {
    return assert.fail(`--json should print JSON, got:\n${result.stdout}`);
  }
}

/** The tab the book gives a session, as Orca has it now. */
async function liveTab(box, bots, name = 'daily') {
  const entry = await sessionIn(bots, BOT, name);
  assert.equal(typeof entry?.tab, 'string', `the book should hold a tab for ${name}, got: ${JSON.stringify(entry)}`);
  const terminal = (await tabsOfBot(box, bots, BOT)).find((one) => one.tabId === entry.tab);
  assert.ok(terminal, `Orca should have ${name}'s tab ${entry.tab}`);
  return terminal;
}

/** One session's entry in a kit answer. */
function entryOf(answer, name = 'daily') {
  const found = (answer.tabs ?? []).filter((one) => one.bot === BOT && one.name === name);
  assert.equal(found.length, 1, `one entry for ${BOT} ${name}, got: ${JSON.stringify(answer.tabs)}`);
  return found[0];
}

/**
 * Bring api-bot up once (`folder`, `bots` unless named), and give each session
 * a conversation the book holds and its harness has on record, the way a
 * session that has had a turn has it: what the next launch resumes (#295).
 * Claude Code and Codex: the hook reports `sess-<name>`. Pi: the kit gave the
 * session its id at the first start, and Pi files a session under it. Gives
 * back the conversation id of each session.
 */
async function running(box, bots, { sessions = ['daily'], harnessOf = () => 'claude', folder = 'bots' } = {}) {
  answered(await kit(box, 'up', { folder }), 'the up this test stands on');
  const ids = {};
  for (const name of sessions) {
    const tab = await liveTab(box, bots, name);
    const harness = harnessOf(name);
    if (harness === 'pi') {
      ids[name] = (await sessionIn(bots, BOT, name))?.session;
      assert.equal(typeof ids[name], 'string', `the premise: the book holds the id the kit gave ${name}`);
      await piSessionOnRecord({ home: box.home, cwd: await realpath(botHomeOf(bots, BOT)), id: ids[name], lines: [piLines.user(PROMPT, new Date(), 1)] });
    } else {
      ids[name] = `sess-${name}`;
      const heard = await recordSession(box, { bots, bot: BOT, tab: tab.tabId, session: ids[name] });
      assert.equal(heard.code, 0, `the hook report this test stands on: ${heard.stderr}`);
      await conversationOnRecord(box, { harness, cwd: botHomeOf(bots, BOT), id: ids[name] });
    }
  }
  return ids;
}

/** A bot on one harness, its sessions up with a conversation each: what a restart closes and resumes. */
async function runningBot(box, harness, sessions = ['daily']) {
  const bots = await madeBot(box, { harness, sessions });
  const ids = await running(box, bots, { sessions, harnessOf: () => harness });
  return { bots, ids };
}

/** The session's tab, closed the way a user closes one: Orca simply stops listing it. */
async function closeTab(box, tabId) {
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((terminal) => terminal.tabId !== tabId) });
}

/** Put `front` in front of one session's tab alone, in the fake Orca's world (helpers/fake-ps.js). */
async function frontOf(box, bots, name, front) {
  const { tab } = await sessionIn(bots, BOT, name);
  const terminals = await box.orca.terminals();
  assert.ok(terminals.some((one) => one.tabId === tab), `the premise: Orca has ${name}'s tab ${tab}`);
  await box.orca.set({ terminals: terminals.map((one) => (one.tabId === tab ? { ...one, foreground: front } : one)) });
}

/** What was typed into the session's tab, the launch line first. */
const typedIn = async (box, bots, name = 'daily') => typedInto(await liveTab(box, bots, name));

// ------------------------------------------------------------- what a test asserts

/** The launch line resumed conversation `id` on `harness`, and does not carry the start prompt. */
function assertResumeLine(harness, line, id, what) {
  const shown = line ?? '';
  if (harness === 'claude') assert.ok(shown.includes(` --resume ${id}`), `${what}: the launch line resumes Claude Code's ${id}, got: ${line}`);
  if (harness === 'codex') {
    assert.match(shown, / codex resume /, `${what}: the launch line resumes Codex, got: ${line}`);
    assert.ok(shown.includes(id), `${what}: with the conversation the book holds, ${id}, got: ${line}`);
  }
  if (harness === 'pi') {
    assert.match(shown, / pi /, `${what}: the launch line starts Pi, got: ${line}`);
    assert.ok(shown.includes(`--session-id ${id}`), `${what}: with the id the book holds, ${id}, got: ${line}`);
  }
  assert.ok(!shown.includes(PROMPT), `${what}: and the start prompt is not sent again, got: ${line}`);
}

/**
 * The typed case in full (R1, R2, R6): the launch line resumed the
 * conversation, then exactly the restart line with a return and nothing after
 * it, and the entry says it was typed and carries no list line.
 */
async function assertRestartLineTyped(box, bots, entry, { harness, id, name = 'daily', what }) {
  const typed = await typedIn(box, bots, name);
  assert.equal(typed.length, 2, `${what}: the launch line and then the restart line, nothing else, got: ${JSON.stringify(typed)}`);
  assertResumeLine(harness, typed[0], id, what);
  assert.equal(typed[1], restartLineOf(box.cli, bots), `${what}: the line is the ruled restart line of #726, word for word`);
  assert.equal(sentInto(await liveTab(box, bots, name))[1].enter, true, `${what}: and it is submitted with a return`);
  assert.equal(entry.restartLine, true, `${what}: the answer says the restart line was typed, got: ${JSON.stringify(entry)}`);
  assert.equal(entry.restartLineTrouble, undefined, `${what}: and gives no trouble for it, got: ${JSON.stringify(entry)}`);
  assert.equal('listLine' in entry, false, `${what}: and the entry carries no listLine key, got: ${JSON.stringify(entry)}`);
}

/**
 * The refused case (R4, R6): a session R1 covers, and nothing typed after the
 * launch line; the entry says the restart line was not typed and why, and
 * carries no list line. Gives back the why.
 */
async function assertRestartLineNotTyped(box, bots, entry, { harness, id, name = 'daily', what }) {
  const typed = await typedIn(box, bots, name);
  assert.equal(typed.length, 1, `${what}: nothing is typed after the launch line, got: ${JSON.stringify(typed)}`);
  assertResumeLine(harness, typed[0], id, what);
  assert.equal(entry.restartLine, false, `${what}: the answer says the restart line was not typed, got: ${JSON.stringify(entry)}`);
  assert.equal(typeof entry.restartLineTrouble, 'string', `${what}: and why, got: ${JSON.stringify(entry)}`);
  assert.notEqual(entry.restartLineTrouble.trim(), '', `${what}: a why with words in it`);
  assert.equal('listLine' in entry, false, `${what}: and the entry carries no listLine key, got: ${JSON.stringify(entry)}`);
  return entry.restartLineTrouble;
}

/** No restart line in the entry of a session R1 does not cover: the reading at the top of this file. */
function assertNoRestartLineKey(entry, what) {
  assert.equal('restartLine' in entry, false, `${what}: the entry carries no restartLine key, got: ${JSON.stringify(entry)}`);
  assert.equal('restartLineTrouble' in entry, false, `${what}: nor a restartLineTrouble, got: ${JSON.stringify(entry)}`);
}

// ------------------------------------------------------------- R1, R2: typed on every harness

describe('R1 R2 a restart that closed a live tab and resumed the conversation types the restart line once', { concurrency: true }, () => {
  for (const harness of ['claude', 'codex', 'pi']) {
    it(`${harness}: the new tab gets the launch line and then the restart line, word for word, with a return, and the answer says restartLine: true`, LIMIT, async (t) => {
      const box = await createSandbox(t);
      const { bots, ids } = await runningBot(box, harness);
      const old = await liveTab(box, bots);

      const entry = entryOf(answered(await kit(box, 'restart'), 'restart'));

      const closed = (await box.orca.terminals()).some((one) => one.tabId === old.tabId);
      assert.equal(closed, false, 'the premise: the restart closed the old tab');
      assert.notEqual(entry.tabId, old.tabId, `the premise: a new tab, got: ${JSON.stringify(entry)}`);
      assert.equal(entry.resumed, true, `the premise: resumed, got: ${JSON.stringify(entry)}`);
      assert.equal(entry.harnessStarted, true, `the premise: the harness came up, got: ${JSON.stringify(entry)}`);
      await assertRestartLineTyped(box, bots, entry, { harness, id: ids.daily, what: `restart, ${harness}` });
    });
  }

  it('codex: the restart line takes the place of the list line, so the list line is never typed beside it (R3)', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots } = await runningBot(box, 'codex');

    entryOf(answered(await kit(box, 'restart'), 'restart'));

    const typed = await typedIn(box, bots);
    assert.equal(typed.filter((line) => line === listLineOf(box.cli, bots)).length, 0, `no list line on the restart road, got: ${JSON.stringify(typed)}`);
    assert.equal(typed.filter((line) => line === restartLineOf(box.cli, bots)).length, 1, `the restart line once, got: ${JSON.stringify(typed)}`);
  });

  it('a ready Pi tab, Pi at rest as PI_IDLE shows it and Orca naming agent pi, gets the restart line once (R4)', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, ids } = await runningBot(box, 'pi');
    await box.orca.set({ screen: PI_IDLE });

    const entry = entryOf(answered(await kit(box, 'restart'), 'restart'));

    assert.equal((await liveTab(box, bots)).agentIdentity, 'pi', 'the premise: Orca names agent pi in the new tab');
    await assertRestartLineTyped(box, bots, entry, { harness: 'pi', id: ids.daily, what: 'a ready Pi tab' });
  });

  it('a restart of a bot with a Claude Code, a Codex and a Pi session types the restart line exactly once into each new tab', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const harnessOf = (name) => ({ daily: 'claude', review: 'codex', notes: 'pi' })[name];
    const sessions = ['daily', 'review', 'notes'];
    const bots = await madeBot(box, { harness: 'claude', sessions, harnessOf });
    const ids = await running(box, bots, { sessions, harnessOf });

    const answer = answered(await kit(box, 'restart'), 'restart');

    for (const name of sessions) {
      await assertRestartLineTyped(box, bots, entryOf(answer, name), { harness: harnessOf(name), id: ids[name], name, what: `restart, ${name} on ${harnessOf(name)}` });
    }
  });

  it('restart --session restarts and tells only the session named: the other keeps its tab and gets nothing typed', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, ids } = await runningBot(box, 'claude', ['daily', 'review']);
    const review = await liveTab(box, bots, 'review');

    const answer = answered(await kit(box, 'restart', { flags: ['--session', 'daily'] }), 'restart --session daily');

    await assertRestartLineTyped(box, bots, entryOf(answer, 'daily'), { harness: 'claude', id: ids.daily, what: 'the session named' });
    const left = await liveTab(box, bots, 'review');
    assert.equal(left.tabId, review.tabId, 'the premise: review keeps its tab');
    assert.deepEqual(typedInto(left), typedInto(review), 'and nothing more is typed into it');
  });

  it('for a bots folder with a space in its path, the restart line names that folder in single quotes, as shellWord spells it', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const folder = 'my bots';
    const bots = await madeBot(box, { folder });
    const ids = await running(box, bots, { folder });

    const entry = entryOf(answered(await kit(box, 'restart', { folder }), 'restart'));

    await assertRestartLineTyped(box, bots, entry, { harness: 'claude', id: ids.daily, what: 'a bots folder with a space' });
    const typed = await typedIn(box, bots);
    assert.ok(typed[1].includes(` message check --bots '${bots}'\``), `the folder in single quotes, got: ${typed[1]}`);
  });
});

// ------------------------------------------------------------- R4: the gate, and the harness not up

describe('R4 R6 the restart line goes through the gate, and the answer says why it was not typed', { concurrency: true }, () => {
  it('claude: a new tab Orca reports blocked for the whole wait gets nothing after its launch line, and restartLineTrouble gives Orca\'s reason', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, ids } = await runningBot(box, 'claude');
    await box.orca.set({ waitIdle: 'blocked', blockedReason: 'agent-permission-prompt' });

    const entry = entryOf(answered(await kit(box, 'restart'), 'restart'));

    const why = await assertRestartLineNotTyped(box, bots, entry, { harness: 'claude', id: ids.daily, what: 'blocked' });
    assert.ok(why.includes('agent-permission-prompt'), `in Orca's words, got: ${why}`);
  });

  it('codex: a new tab Orca reports blocked for the whole wait gets neither the restart line nor the list line', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, ids } = await runningBot(box, 'codex');
    await box.orca.set({ waitIdle: 'blocked', blockedReason: 'agent-permission-prompt' });

    const entry = entryOf(answered(await kit(box, 'restart'), 'restart'));

    const why = await assertRestartLineNotTyped(box, bots, entry, { harness: 'codex', id: ids.daily, what: 'codex blocked' });
    assert.ok(why.includes('agent-permission-prompt'), `in Orca's words, got: ${why}`);
  });

  it('claude: a question drawn on the screen (the Teach list above the input box), which Orca calls idle, gets nothing typed, and the why says a question is waiting', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, ids } = await runningBot(box, 'claude');
    await box.orca.set({ screen: CLAUDE_TEACH_LIST });

    const entry = entryOf(answered(await kit(box, 'restart'), 'restart'));

    assert.equal(entry.harnessStarted, true, `the premise: the harness came up, got: ${JSON.stringify(entry)}`);
    const why = await assertRestartLineNotTyped(box, bots, entry, { harness: 'claude', id: ids.daily, what: 'a question on screen' });
    assert.match(why, /question/i, `it says a question is waiting, got: ${why}`);
  });

  it('pi: Pi\'s /model selector in the input box\'s place (a question by its cancel foot, a menu by its → list) gets nothing typed, and the why says a question is waiting', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, ids } = await runningBot(box, 'pi');
    await box.orca.set({ screen: PI_MODEL_SELECTOR });

    const entry = entryOf(answered(await kit(box, 'restart'), 'restart'));

    assert.equal(entry.harnessStarted, true, `the premise: the harness came up, got: ${JSON.stringify(entry)}`);
    assert.equal((await liveTab(box, bots)).agentIdentity, 'pi', 'the premise: Orca names agent pi in the new tab');
    const why = await assertRestartLineNotTyped(box, bots, entry, { harness: 'pi', id: ids.daily, what: 'a Pi selector on screen' });
    assert.match(why, /question/i, `it says a question is waiting, got: ${why}`);
  });

  it('claude: a new tab where Orca names no agent for the whole wait gets nothing typed: the kit cannot tell the harness is there', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, ids } = await runningBot(box, 'claude');
    await box.orca.set({ agentIdentity: null });

    const entry = entryOf(answered(await kit(box, 'restart'), 'restart'));

    assert.equal(entry.harnessStarted, true, `the premise: the harness came up, got: ${JSON.stringify(entry)}`);
    await assertRestartLineNotTyped(box, bots, entry, { harness: 'claude', id: ids.daily, what: 'no agent named' });
  });

  it('claude: a gate that refuses at first and lets the line through within the wait: the restart line is typed once, when it may be', LIMIT, async (t) => {
    // Orca answers `blocked` on the first three waits and idle after (see the
    // header): refused at first, and let through far inside the 20 s.
    const box = await createSandbox(t);
    const { bots, ids } = await runningBot(box, 'claude');
    await box.orca.set({ waitIdle: ['blocked', 'blocked', 'blocked', true] });

    const entry = entryOf(answered(await kit(box, 'restart'), 'restart'));

    await assertRestartLineTyped(box, bots, entry, { harness: 'claude', id: ids.daily, what: 'a gate refused at first' });
  });

  it('claude: a gate that lets the line through only after the 20 s are up is too late: nothing is typed, and the why says the wait ran out', LIMIT, async (t) => {
    // Each screen read answers 21 s late and then as it would have: an idle
    // Claude Code, no question, the agent named. So the gate's first yes comes
    // after the 20 s.
    const box = await createSandbox(t);
    const { bots, ids } = await runningBot(box, 'claude');
    await box.orca.set({ hang: { command: 'terminal read', ms: 21000 } });

    const entry = entryOf(answered(await kit(box, 'restart'), 'restart'));

    assert.equal(entry.harnessStarted, true, `the premise: the harness came up, got: ${JSON.stringify(entry)}`);
    const why = await assertRestartLineNotTyped(box, bots, entry, { harness: 'claude', id: ids.daily, what: 'a yes after the wait' });
    assert.match(why, /\b20\s*(?:s|seconds?)\b/i, `it says the 20 s wait ran out, got: ${why}`);
  });

  it('claude: a resumed harness that did not come up in the new tab gets nothing after its launch line, and the answer says the line was not typed and why', LIMIT, async (t) => {
    // No TUI in the new tab and the shell in front: a line typed now would run
    // in the shell.
    const box = await createSandbox(t);
    const { bots, ids } = await runningBot(box, 'claude');
    await box.orca.set({ waitIdle: false });

    const entry = entryOf(answered(await kit(box, 'restart'), 'restart'));

    assert.equal(entry.resumed, true, `the premise: resumed, got: ${JSON.stringify(entry)}`);
    assert.equal(entry.harnessStarted, false, `the premise: no harness came up, got: ${JSON.stringify(entry)}`);
    await assertRestartLineNotTyped(box, bots, entry, { harness: 'claude', id: ids.daily, what: 'did not come up' });
  });
});

// ------------------------------------------------------------- R4: the typing turn

describe('R4 the restart line waits for the session\'s typing turn', { concurrency: true }, () => {
  it('restart with the session\'s typing turn held for the whole run: it succeeds, nothing is typed after the launch line, and restartLineTrouble says the kit is typing into it', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, ids } = await runningBot(box, 'claude');

    const started = Date.now();
    const result = await withTypingTurnHeld(bots, BOT, 'daily', () => kit(box, 'restart'));
    const took = Date.now() - started;

    const entry = entryOf(answered(result, 'restart with the turn held'));
    const why = await assertRestartLineNotTyped(box, bots, entry, { harness: 'claude', id: ids.daily, what: 'the turn held' });
    assert.match(why, TYPING, `the why says the kit is typing into it, got: ${why}`);
    assert.ok(took < 90_000, `the wait for the turn is bounded; restart took ${took} ms`);
  });

  it('restart with the turn let go after about 1 s: the restart line is typed once', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, ids } = await runningBot(box, 'claude');

    const result = await withTypingTurnHeld(bots, BOT, 'daily', async (release) => {
      const run = kit(box, 'restart');
      await sleep(1_000);
      release();
      return run;
    });

    await assertRestartLineTyped(box, bots, entryOf(answered(result, 'restart with the turn let go')), { harness: 'claude', id: ids.daily, what: 'the turn let go' });
  });

  it('restart of two sessions with only review\'s turn held: daily gets its restart line, review gets nothing after its launch line', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, ids } = await runningBot(box, 'claude', ['daily', 'review']);

    const result = await withTypingTurnHeld(bots, BOT, 'review', () => kit(box, 'restart'));

    const answer = answered(result, 'restart with review\'s turn held');
    await assertRestartLineTyped(box, bots, entryOf(answer, 'daily'), { harness: 'claude', id: ids.daily, what: 'review\'s turn is not daily\'s' });
    const why = await assertRestartLineNotTyped(box, bots, entryOf(answer, 'review'), { harness: 'claude', id: ids.review, name: 'review', what: 'review\'s own turn held' });
    assert.match(why, TYPING, `the why says the kit is typing into it, got: ${why}`);
  });
});

// ------------------------------------------------------------- R5: no restart line

describe('R5 no restart line for a session the restart closed nothing of, started fresh, or paused', { concurrency: true }, () => {
  it('claude: a session whose tab was not open is brought back with its conversation and nothing typed after the launch line', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, ids } = await runningBot(box, 'claude');
    const old = await liveTab(box, bots);
    await closeTab(box, old.tabId);

    const entry = entryOf(answered(await kit(box, 'restart'), 'restart'));

    assert.equal(entry.resumed, true, `the premise: resumed, got: ${JSON.stringify(entry)}`);
    const typed = await typedIn(box, bots);
    assert.equal(typed.length, 1, `the launch line and nothing after it, got: ${JSON.stringify(typed)}`);
    assertResumeLine('claude', typed[0], ids.daily, 'a tab that was not open');
    assertNoRestartLineKey(entry, 'a tab that was not open');
  });

  it('codex: a session whose tab was not open is brought back as up brings it back: the list line, and no restart line', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, ids } = await runningBot(box, 'codex');
    await closeTab(box, (await liveTab(box, bots)).tabId);

    const entry = entryOf(answered(await kit(box, 'restart'), 'restart'));

    const typed = await typedIn(box, bots);
    assert.equal(typed.length, 2, `the launch line and the list line, nothing else, got: ${JSON.stringify(typed)}`);
    assertResumeLine('codex', typed[0], ids.daily, 'a Codex tab that was not open');
    assert.equal(typed[1], listLineOf(box.cli, bots), 'the list line of #709, word for word');
    assert.equal(entry.listLine, true, `the answer says the list line was typed, got: ${JSON.stringify(entry)}`);
    assertNoRestartLineKey(entry, 'a Codex tab that was not open');
  });

  for (const harness of ['claude', 'codex']) {
    it(`${harness}: a live tab with its shell in front and no conversation in the book is closed and started fresh with its duty, and nothing is typed after that`, LIMIT, async (t) => {
      const box = await createSandbox(t);
      const bots = await madeBot(box, { harness });
      answered(await kit(box, 'up'), 'the up this test stands on');
      assert.equal((await sessionIn(bots, BOT, 'daily'))?.session, undefined, 'the premise: the book names no conversation');
      await frontOf(box, bots, 'daily', 'shell');
      const old = await liveTab(box, bots);

      const answer = answered(await kit(box, 'restart'), 'restart');

      assert.equal(answer.closed?.length, 1, `the premise: the restart closed the old tab, got: ${JSON.stringify(answer.closed)}`);
      const entry = entryOf(answer);
      assert.notEqual(entry.tabId, old.tabId, 'the premise: a new tab');
      const typed = await typedIn(box, bots);
      assert.equal(typed.length, 1, `the launch line and nothing after it, got: ${JSON.stringify(typed)}`);
      assert.ok(typed[0].includes(PROMPT), `the premise: started fresh, with its duty, got: ${typed[0]}`);
      assertNoRestartLineKey(entry, `${harness} started fresh`);
    });
  }

  it('a whole-bot restart with one session paused: the paused one gets no tab and no line, and the live one gets its restart line', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, ids } = await runningBot(box, 'claude', ['daily', 'review']);
    const paused = await box.run(['pause', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);
    assert.equal(paused.code, 0, `the pause this test stands on: ${paused.stdout}${paused.stderr}`);

    const answer = answered(await kit(box, 'restart'), 'restart');

    assert.deepEqual(answer.paused, [{ bot: BOT, session: 'daily' }], `the premise: daily is paused, got: ${JSON.stringify(answer.paused)}`);
    const daily = (answer.tabs ?? []).filter((one) => one.name === 'daily');
    for (const one of daily) assertNoRestartLineKey(one, 'the paused session');
    assert.deepEqual(
      (await tabsOfBot(box, bots, BOT)).map((one) => one.tabId),
      [entryOf(answer, 'review').tabId],
      'Orca has one tab of api-bot, review\'s new one: daily has none, so nothing can be typed into it',
    );
    await assertRestartLineTyped(box, bots, entryOf(answer, 'review'), { harness: 'claude', id: ids.review, name: 'review', what: 'the live session beside it' });
  });
});

// ------------------------------------------------------------- R3: up unchanged, unpause its own line (#732)

describe('R3 up is as it was, and unpause types its own line (#732), never the restart line', { concurrency: true }, () => {
  it('up of a closed tab: Codex gets the list line, Claude Code and Pi get nothing after the launch line, and no entry carries restartLine', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const harnessOf = (name) => ({ daily: 'claude', review: 'codex', notes: 'pi' })[name];
    const sessions = ['daily', 'review', 'notes'];
    const bots = await madeBot(box, { harness: 'claude', sessions, harnessOf });
    const ids = await running(box, bots, { sessions, harnessOf });
    for (const name of sessions) await closeTab(box, (await liveTab(box, bots, name)).tabId);

    const answer = answered(await kit(box, 'up'), 'up');

    for (const name of sessions) {
      const entry = entryOf(answer, name);
      const harness = harnessOf(name);
      assert.equal(entry.resumed, true, `the premise: ${name} resumed, got: ${JSON.stringify(entry)}`);
      const typed = await typedIn(box, bots, name);
      assertResumeLine(harness, typed[0], ids[name], `up, ${name} on ${harness}`);
      assert.deepEqual(typed.slice(1), harness === 'codex' ? [listLineOf(box.cli, bots)] : [], `up, ${name} on ${harness}: after the launch line, got: ${JSON.stringify(typed)}`);
      assertNoRestartLineKey(entry, `up, ${name} on ${harness}`);
    }
  });

  it('unpause of a Codex and a Claude session: each tab gets the unpause line of #732, never the restart line or the list line', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const harnessOf = (name) => (name === 'review' ? 'claude' : 'codex');
    const bots = await madeBot(box, { harness: 'codex', sessions: ['daily', 'review'], harnessOf });
    const ids = await running(box, bots, { sessions: ['daily', 'review'], harnessOf });
    const paused = await box.run(['pause', '--bots', 'bots', '--bot', BOT]);
    assert.equal(paused.code, 0, `the pause this test stands on: ${paused.stdout}${paused.stderr}`);

    const answer = answered(await kit(box, 'unpause'), 'unpause');

    const daily = await typedIn(box, bots, 'daily');
    assertResumeLine('codex', daily[0], ids.daily, 'unpause, the Codex session');
    assert.deepEqual(daily.slice(1), [unpauseLineOf(box.cli, bots)], `unpause, the Codex session gets the unpause line alone (#732), got: ${JSON.stringify(daily)}`);
    const review = await typedIn(box, bots, 'review');
    assertResumeLine('claude', review[0], ids.review, 'unpause, the Claude session');
    assert.deepEqual(review.slice(1), [unpauseLineOf(box.cli, bots)], `unpause, the Claude session gets the unpause line alone (#732), got: ${JSON.stringify(review)}`);
    for (const name of ['daily', 'review']) {
      const entry = entryOf(answer, name);
      assert.equal(entry.restartLine, true, `unpause, ${name}: the entry says the unpause line was typed (#732), got: ${JSON.stringify(entry)}`);
      assert.equal('listLine' in entry, false, `unpause, ${name}: and carries no listLine key, got: ${JSON.stringify(entry)}`);
    }
  });
});

// ------------------------------------------------------------- R6: the plain report

/** The plain report's lines from the `opened` line of the session's new tab on, up to the next tab or the summary. */
function linesUnderTab(stdout, tabId) {
  const lines = stdout.split('\n');
  const at = lines.findIndex((line) => /^opened\b/.test(line) && line.includes(tabId));
  assert.notEqual(at, -1, `the plain report has an opened line for the new tab ${tabId}, got:\n${stdout}`);
  const rest = lines.slice(at + 1);
  const end = rest.findIndex((line) => !/^\s/.test(line));
  return end === -1 ? rest : rest.slice(0, end);
}

describe('R6 the plain report says under the tab whether the session was told what the restart ended', { concurrency: true }, () => {
  it('typed: one line under the new tab says the session was told what the restart ended, and not that it was not', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots } = await runningBot(box, 'claude');

    const result = await kit(box, 'restart', { plain: true });

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    assert.equal((await typedIn(box, bots)).length, 2, 'the launch line and then the restart line were typed (R1)');
    const under = linesUnderTab(result.stdout, (await liveTab(box, bots)).tabId);
    const said = under.filter((line) => /restart/i.test(line) && /\b(?:told|typed)\b/i.test(line));
    assert.equal(said.length, 1, `one line under the tab says the session was told what the restart ended, got:\n${result.stdout}`);
    assert.doesNotMatch(said[0], /\bnot\b|n't\b/i, `and it does not say it was not, got: ${said[0]}`);
  });

  it('not typed: one line under the new tab says the session was not told, gives the reason, and tells the caller to tell the session itself', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots } = await runningBot(box, 'claude');
    await box.orca.set({ waitIdle: 'blocked', blockedReason: 'agent-permission-prompt' });

    const result = await kit(box, 'restart', { plain: true });

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    assert.equal((await typedIn(box, bots)).length, 1, 'the premise: the restart line was not typed');
    const under = linesUnderTab(result.stdout, (await liveTab(box, bots)).tabId);
    const said = under.filter((line) => /restart/i.test(line) && /\bnot\b|n't\b/i.test(line) && line.includes('agent-permission-prompt'));
    assert.equal(said.length, 1, `one line under the tab says the session was not told what the restart ended, with Orca's reason, got:\n${result.stdout}`);
    assert.match(said[0], /\byourself\b|\btell (?:the|this|that|it)\b/i, `and, on that line, that the caller should tell the session itself, got: ${said[0]}`);
  });
});
