// `obk unpause` tells the session it resumed what the pause ended (#732).
//
// What happened (the issue): `obk pause` closes a session's tab and marks it
// paused, and the background shells of its harness end with the tab. `obk
// unpause` takes the mark off and resumes the conversation in a new tab (the
// same bring-up as `obk up`). The kit typed nothing into a resumed Claude Code
// or Pi session, and only the list line into a resumed Codex session, so the
// session was told nothing about what the pause ended. #726 closed the same gap
// for `obk restart` (restart-line.test.js); this file is the unpause road.
//
// The requirement, as kit-dev/architect ruled it:
//
//   U1. On the `obk unpause` road, each session whose pause mark this unpause
//       took off, whose conversation the kit then resumed in a new tab, and
//       whose harness came up there, gets exactly one typed line: the unpause
//       line. On every harness: Claude Code, Codex and Pi. With `--bot <bot>`
//       alone and the bot marked paused: the bot's sessions that come up (a
//       session that also has its own pause mark stays paused, with no tab and
//       no line). With `--session <name>` and that session marked paused: that
//       session.
//   U2. The unpause line, word for word, is `unpauseLineOf` in helpers/cli.js:
//       `cli` is the CLI that ran the command and `bots` the bots folder by its
//       absolute path, each spelled by `shellWord`. The backticks are part of
//       the line. It is submitted with a return.
//   U3. For a Codex session on the unpause road, the unpause line takes the
//       place of the list line: one line in all, never both.
//   U4. The unpause line goes through the same gate as the list line and the
//       restart line, with the same 20 s cutoff and the session's typing turn.
//   U5. No line for a session that stays paused, a session that was not paused
//       (`obk unpause --bot X` on a bot that is not paused brings its sessions
//       up as `up` does: Codex gets the list line, Claude and Pi nothing), a
//       session started fresh rather than resumed (it gets its start prompt),
//       or a session whose resumed harness did not come up (then the entry
//       says why, U6).
//   U6. The report. In the `--json` answer of `obk unpause`, each tab entry of
//       a session U1 covers carries the same keys as on restart: `restartLine:
//       true` when the line was typed, or `restartLine: false` with
//       `restartLineTrouble`, a sentence that says why, when it was not. Such
//       an entry carries no `listLine` key. An entry of a session U1 does not
//       cover carries no `restartLine` key. The plain report says under that
//       tab, in a line of its own, whether the session was told what the pause
//       ended; when it was not, that line gives the reason and tells the caller
//       to tell the session itself. Only the JSON keys and the line's words are
//       ruled, so the plain report is read by those facts, not by its words.
//   U7. `obk up` alone is as before, and so is `obk restart`.
//   U8. No new command, option or environment variable in the kit
//       (test/core-is-core.test.js and the command-list check guard that).
//
// Readings this file takes where the ruling does not spell a case out:
//
//   - "Started fresh" covers both ways the fake world gives it: a session paused
//     before it was ever brought up (no conversation in the book), and a session
//     whose book names a conversation the harness has nothing on record for
//     (no-conversation.test.js, N1). Both start with their duty, and neither
//     gets a line.
//   - A second `obk unpause` of a bot the first one already brought up finds it
//     not paused and its tabs live: as `up`, it types nothing and the entries
//     carry no `restartLine` key.
//   - A session the unpause told, whose tab is later closed and brought back by
//     `obk up`, is on the `up` road: nothing after its launch line (U7).
//
// How the wait is modelled is as in restart-line.test.js: the fake Orca keeps
// no clock, time passes in it only while `terminal wait` waits, and a
// `waitIdle` list is one answer per `terminal wait`. The 20 s cutoff is
// modelled with the fake's `hang` on `terminal read`, 21 s a read, which costs
// a minute or more of real time. The typing turn is held from the test
// process, as typing-turn-list-line.test.js holds it. Each fake setting a test
// turns on is set after the pause and before the unpause, so it is the
// unpause that meets it.
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

/** Pause api-bot (`flags` may name a session), as the step a test stands on. */
async function paused(box, { folder = 'bots', flags = [] } = {}) {
  const result = await box.run(['pause', '--bots', folder, '--bot', BOT, ...flags]);
  assert.equal(result.code, 0, `the pause this test stands on: ${result.stdout}${result.stderr}`);
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

/** A bot on one harness, its sessions up with a conversation each: what a pause closes and an unpause resumes. */
async function runningBot(box, harness, sessions = ['daily']) {
  const bots = await madeBot(box, { harness, sessions });
  const ids = await running(box, bots, { sessions, harnessOf: () => harness });
  return { bots, ids };
}

/** A bot on one harness with a conversation in each session, the whole bot paused: what `unpause --bot` resumes. */
async function pausedBot(box, harness, sessions = ['daily']) {
  const made = await runningBot(box, harness, sessions);
  const old = {};
  for (const name of sessions) old[name] = (await liveTab(box, made.bots, name)).tabId;
  await paused(box);
  const left = (await box.orca.terminals()).filter((one) => Object.values(old).includes(one.tabId));
  assert.deepEqual(left, [], 'the premise: the pause closed the session tabs');
  return { ...made, old };
}

/** The session's tab, closed the way a user closes one: Orca simply stops listing it. */
async function closeTab(box, tabId) {
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((terminal) => terminal.tabId !== tabId) });
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
 * The typed case in full (U1, U2, U6): the launch line resumed the
 * conversation, then exactly the unpause line with a return and nothing after
 * it, and the entry says it was typed and carries no list line.
 */
async function assertUnpauseLineTyped(box, bots, entry, { harness, id, name = 'daily', what }) {
  const typed = await typedIn(box, bots, name);
  assert.equal(typed.length, 2, `${what}: the launch line and then the unpause line, nothing else, got: ${JSON.stringify(typed)}`);
  assertResumeLine(harness, typed[0], id, what);
  assert.equal(typed[1], unpauseLineOf(box.cli, bots), `${what}: the line is the ruled unpause line of #732, word for word`);
  assert.equal(sentInto(await liveTab(box, bots, name))[1].enter, true, `${what}: and it is submitted with a return`);
  assert.equal(entry.restartLine, true, `${what}: the answer says the line was typed, restartLine: true, got: ${JSON.stringify(entry)}`);
  assert.equal(entry.restartLineTrouble, undefined, `${what}: and gives no trouble for it, got: ${JSON.stringify(entry)}`);
  assert.equal('listLine' in entry, false, `${what}: and the entry carries no listLine key, got: ${JSON.stringify(entry)}`);
}

/**
 * The refused case (U4, U6): a session U1 covers, and nothing typed after the
 * launch line; the entry says the line was not typed and why, and carries no
 * list line. Gives back the why.
 */
async function assertUnpauseLineNotTyped(box, bots, entry, { harness, id, name = 'daily', what }) {
  const typed = await typedIn(box, bots, name);
  assert.equal(typed.length, 1, `${what}: nothing is typed after the launch line, got: ${JSON.stringify(typed)}`);
  assertResumeLine(harness, typed[0], id, what);
  assert.equal(entry.restartLine, false, `${what}: the answer says the line was not typed, restartLine: false, got: ${JSON.stringify(entry)}`);
  assert.equal(typeof entry.restartLineTrouble, 'string', `${what}: and why, in restartLineTrouble, got: ${JSON.stringify(entry)}`);
  assert.notEqual(entry.restartLineTrouble.trim(), '', `${what}: a why with words in it`);
  assert.equal('listLine' in entry, false, `${what}: and the entry carries no listLine key, got: ${JSON.stringify(entry)}`);
  return entry.restartLineTrouble;
}

/** No line key in the entry of a session U1 does not cover (U6). */
function assertNoRestartLineKey(entry, what) {
  assert.equal('restartLine' in entry, false, `${what}: the entry carries no restartLine key, got: ${JSON.stringify(entry)}`);
  assert.equal('restartLineTrouble' in entry, false, `${what}: nor a restartLineTrouble, got: ${JSON.stringify(entry)}`);
}

// ------------------------------------------------------------- U1, U2: typed on every harness

describe('U1 U2 an unpause that took the pause off and resumed the conversation types the unpause line once', { concurrency: true }, () => {
  for (const harness of ['claude', 'codex', 'pi']) {
    it(`${harness}: unpause --bot of a paused bot: the new tab gets the launch line and then the unpause line, word for word, with a return, and the answer says restartLine: true`, LIMIT, async (t) => {
      const box = await createSandbox(t);
      const { bots, ids, old } = await pausedBot(box, harness);

      const entry = entryOf(answered(await kit(box, 'unpause'), 'unpause'));

      assert.notEqual(entry.tabId, old.daily, `the premise: a new tab, got: ${JSON.stringify(entry)}`);
      assert.equal(entry.resumed, true, `the premise: resumed, got: ${JSON.stringify(entry)}`);
      assert.equal(entry.harnessStarted, true, `the premise: the harness came up, got: ${JSON.stringify(entry)}`);
      await assertUnpauseLineTyped(box, bots, entry, { harness, id: ids.daily, what: `unpause, ${harness}` });
    });
  }

  it('codex: the unpause line takes the place of the list line, so neither the list line nor the restart line is typed beside it (U3)', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots } = await pausedBot(box, 'codex');

    entryOf(answered(await kit(box, 'unpause'), 'unpause'));

    const typed = await typedIn(box, bots);
    assert.equal(typed.filter((line) => line === listLineOf(box.cli, bots)).length, 0, `no list line on the unpause road, got: ${JSON.stringify(typed)}`);
    assert.equal(typed.filter((line) => line === restartLineOf(box.cli, bots)).length, 0, `nor the restart line, got: ${JSON.stringify(typed)}`);
    assert.equal(typed.filter((line) => line === unpauseLineOf(box.cli, bots)).length, 1, `the unpause line once, got: ${JSON.stringify(typed)}`);
  });

  it('a ready Pi tab, Pi at rest as PI_IDLE shows it and Orca naming agent pi, gets the unpause line once (U4)', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, ids } = await pausedBot(box, 'pi');
    await box.orca.set({ screen: PI_IDLE });

    const entry = entryOf(answered(await kit(box, 'unpause'), 'unpause'));

    assert.equal((await liveTab(box, bots)).agentIdentity, 'pi', 'the premise: Orca names agent pi in the new tab');
    await assertUnpauseLineTyped(box, bots, entry, { harness: 'pi', id: ids.daily, what: 'a ready Pi tab' });
  });

  it('unpause of a paused bot with a Claude Code, a Codex and a Pi session types the unpause line exactly once into each new tab', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const harnessOf = (name) => ({ daily: 'claude', review: 'codex', notes: 'pi' })[name];
    const sessions = ['daily', 'review', 'notes'];
    const bots = await madeBot(box, { harness: 'claude', sessions, harnessOf });
    const ids = await running(box, bots, { sessions, harnessOf });
    await paused(box);

    const answer = answered(await kit(box, 'unpause'), 'unpause');

    for (const name of sessions) {
      await assertUnpauseLineTyped(box, bots, entryOf(answer, name), { harness: harnessOf(name), id: ids[name], name, what: `unpause, ${name} on ${harnessOf(name)}` });
    }
  });

  for (const harness of ['claude', 'codex']) {
    it(`${harness}: unpause --session of the one session paused tells that session only: its sibling keeps its tab and gets nothing typed`, LIMIT, async (t) => {
      const box = await createSandbox(t);
      const { bots, ids } = await runningBot(box, harness, ['daily', 'review']);
      await paused(box, { flags: ['--session', 'daily'] });
      const review = await liveTab(box, bots, 'review');

      const answer = answered(await kit(box, 'unpause', { flags: ['--session', 'daily'] }), 'unpause --session daily');

      await assertUnpauseLineTyped(box, bots, entryOf(answer, 'daily'), { harness, id: ids.daily, what: 'the session named' });
      const left = await liveTab(box, bots, 'review');
      assert.equal(left.tabId, review.tabId, 'the premise: review keeps its tab');
      assert.deepEqual(typedInto(left), typedInto(review), 'and nothing more is typed into it');
      for (const one of (answer.tabs ?? []).filter((entry) => entry.name === 'review')) assertNoRestartLineKey(one, 'review, which was not paused');
    });
  }

  it('for a bots folder with a space in its path, the unpause line names that folder in single quotes, as shellWord spells it', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const folder = 'my bots';
    const bots = await madeBot(box, { folder });
    const ids = await running(box, bots, { folder });
    await paused(box, { folder });

    const entry = entryOf(answered(await kit(box, 'unpause', { folder }), 'unpause'));

    await assertUnpauseLineTyped(box, bots, entry, { harness: 'claude', id: ids.daily, what: 'a bots folder with a space' });
    const typed = await typedIn(box, bots);
    assert.ok(typed[1].includes(` message check --bots '${bots}'\``), `the folder in single quotes, got: ${typed[1]}`);
  });
});

// ------------------------------------------------------------- U4: the gate, and the harness not up

describe('U4 U6 the unpause line goes through the gate, and the answer says why it was not typed', { concurrency: true }, () => {
  it('claude: a new tab Orca reports blocked for the whole wait gets nothing after its launch line, and restartLineTrouble gives Orca\'s reason', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, ids } = await pausedBot(box, 'claude');
    await box.orca.set({ waitIdle: 'blocked', blockedReason: 'agent-permission-prompt' });

    const entry = entryOf(answered(await kit(box, 'unpause'), 'unpause'));

    const why = await assertUnpauseLineNotTyped(box, bots, entry, { harness: 'claude', id: ids.daily, what: 'blocked' });
    assert.ok(why.includes('agent-permission-prompt'), `in Orca's words, got: ${why}`);
  });

  it('codex: a new tab Orca reports blocked for the whole wait gets neither the unpause line nor the list line', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, ids } = await pausedBot(box, 'codex');
    await box.orca.set({ waitIdle: 'blocked', blockedReason: 'agent-permission-prompt' });

    const entry = entryOf(answered(await kit(box, 'unpause'), 'unpause'));

    const why = await assertUnpauseLineNotTyped(box, bots, entry, { harness: 'codex', id: ids.daily, what: 'codex blocked' });
    assert.ok(why.includes('agent-permission-prompt'), `in Orca's words, got: ${why}`);
  });

  it('claude: a question drawn on the screen (the Teach list above the input box), which Orca calls idle, gets nothing typed, and the why says a question is waiting', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, ids } = await pausedBot(box, 'claude');
    await box.orca.set({ screen: CLAUDE_TEACH_LIST });

    const entry = entryOf(answered(await kit(box, 'unpause'), 'unpause'));

    assert.equal(entry.harnessStarted, true, `the premise: the harness came up, got: ${JSON.stringify(entry)}`);
    const why = await assertUnpauseLineNotTyped(box, bots, entry, { harness: 'claude', id: ids.daily, what: 'a question on screen' });
    assert.match(why, /question/i, `it says a question is waiting, got: ${why}`);
  });

  it('pi: Pi\'s /model selector in the input box\'s place gets nothing typed, and the why says a question is waiting', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, ids } = await pausedBot(box, 'pi');
    await box.orca.set({ screen: PI_MODEL_SELECTOR });

    const entry = entryOf(answered(await kit(box, 'unpause'), 'unpause'));

    assert.equal(entry.harnessStarted, true, `the premise: the harness came up, got: ${JSON.stringify(entry)}`);
    assert.equal((await liveTab(box, bots)).agentIdentity, 'pi', 'the premise: Orca names agent pi in the new tab');
    const why = await assertUnpauseLineNotTyped(box, bots, entry, { harness: 'pi', id: ids.daily, what: 'a Pi selector on screen' });
    assert.match(why, /question/i, `it says a question is waiting, got: ${why}`);
  });

  it('claude: a new tab where Orca names no agent for the whole wait gets nothing typed: the kit cannot tell the harness is there', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, ids } = await pausedBot(box, 'claude');
    await box.orca.set({ agentIdentity: null });

    const entry = entryOf(answered(await kit(box, 'unpause'), 'unpause'));

    assert.equal(entry.harnessStarted, true, `the premise: the harness came up, got: ${JSON.stringify(entry)}`);
    await assertUnpauseLineNotTyped(box, bots, entry, { harness: 'claude', id: ids.daily, what: 'no agent named' });
  });

  it('claude: a gate that refuses at first and lets the line through within the wait: the unpause line is typed once, when it may be', LIMIT, async (t) => {
    // Orca answers `blocked` on the first three waits and idle after (see the
    // header): refused at first, and let through far inside the 20 s.
    const box = await createSandbox(t);
    const { bots, ids } = await pausedBot(box, 'claude');
    await box.orca.set({ waitIdle: ['blocked', 'blocked', 'blocked', true] });

    const entry = entryOf(answered(await kit(box, 'unpause'), 'unpause'));

    await assertUnpauseLineTyped(box, bots, entry, { harness: 'claude', id: ids.daily, what: 'a gate refused at first' });
  });

  it('claude: a gate that lets the line through only after the 20 s are up is too late: nothing is typed, and the why says the wait ran out', LIMIT, async (t) => {
    // Each screen read answers 21 s late and then as it would have: an idle
    // Claude Code, no question, the agent named. So the gate's first yes comes
    // after the 20 s.
    const box = await createSandbox(t);
    const { bots, ids } = await pausedBot(box, 'claude');
    await box.orca.set({ hang: { command: 'terminal read', ms: 21000 } });

    const entry = entryOf(answered(await kit(box, 'unpause'), 'unpause'));

    assert.equal(entry.harnessStarted, true, `the premise: the harness came up, got: ${JSON.stringify(entry)}`);
    const why = await assertUnpauseLineNotTyped(box, bots, entry, { harness: 'claude', id: ids.daily, what: 'a yes after the wait' });
    assert.match(why, /\b20\s*(?:s|seconds?)\b/i, `it says the 20 s wait ran out, got: ${why}`);
  });

  for (const harness of ['claude', 'codex']) {
    it(`${harness}: a resumed harness that did not come up in the new tab gets nothing after its launch line, and the answer says the line was not typed and why`, LIMIT, async (t) => {
      // No TUI in the new tab and the shell in front: a line typed now would
      // run in the shell.
      const box = await createSandbox(t);
      const { bots, ids } = await pausedBot(box, harness);
      await box.orca.set({ waitIdle: false });

      const entry = entryOf(answered(await kit(box, 'unpause'), 'unpause'));

      assert.equal(entry.resumed, true, `the premise: resumed, got: ${JSON.stringify(entry)}`);
      assert.equal(entry.harnessStarted, false, `the premise: no harness came up, got: ${JSON.stringify(entry)}`);
      await assertUnpauseLineNotTyped(box, bots, entry, { harness, id: ids.daily, what: `${harness} did not come up` });
    });
  }
});

// ------------------------------------------------------------- U4: the typing turn

describe('U4 the unpause line waits for the session\'s typing turn', { concurrency: true }, () => {
  it('unpause with the session\'s typing turn held for the whole run: it succeeds, nothing is typed after the launch line, and restartLineTrouble says the kit is typing into it', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, ids } = await pausedBot(box, 'claude');

    const started = Date.now();
    const result = await withTypingTurnHeld(bots, BOT, 'daily', () => kit(box, 'unpause'));
    const took = Date.now() - started;

    const entry = entryOf(answered(result, 'unpause with the turn held'));
    const why = await assertUnpauseLineNotTyped(box, bots, entry, { harness: 'claude', id: ids.daily, what: 'the turn held' });
    assert.match(why, TYPING, `the why says the kit is typing into it, got: ${why}`);
    assert.ok(took < 90_000, `the wait for the turn is bounded; unpause took ${took} ms`);
  });

  it('unpause with the turn let go after about 1 s: the unpause line is typed once', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, ids } = await pausedBot(box, 'claude');

    const result = await withTypingTurnHeld(bots, BOT, 'daily', async (release) => {
      const run = kit(box, 'unpause');
      await sleep(1_000);
      release();
      return run;
    });

    await assertUnpauseLineTyped(box, bots, entryOf(answered(result, 'unpause with the turn let go')), { harness: 'claude', id: ids.daily, what: 'the turn let go' });
  });

  it('unpause of two Codex sessions with only review\'s turn held: daily gets its unpause line, review gets nothing after its launch line', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, ids } = await pausedBot(box, 'codex', ['daily', 'review']);

    const result = await withTypingTurnHeld(bots, BOT, 'review', () => kit(box, 'unpause'));

    const answer = answered(result, 'unpause with review\'s turn held');
    await assertUnpauseLineTyped(box, bots, entryOf(answer, 'daily'), { harness: 'codex', id: ids.daily, what: 'review\'s turn is not daily\'s' });
    const why = await assertUnpauseLineNotTyped(box, bots, entryOf(answer, 'review'), { harness: 'codex', id: ids.review, name: 'review', what: 'review\'s own turn held' });
    assert.match(why, TYPING, `the why says the kit is typing into it, got: ${why}`);
  });
});

// ------------------------------------------------------------- U5: no unpause line

describe('U5 no unpause line for a session that stays paused, was not paused, or starts fresh', { concurrency: true }, () => {
  it('unpause --bot of a paused bot with one session paused on its own too: that session stays paused, with no tab and no line, and its sibling gets its unpause line', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, ids } = await runningBot(box, 'claude', ['daily', 'review']);
    await paused(box, { flags: ['--session', 'daily'] });
    await paused(box);

    const answer = answered(await kit(box, 'unpause'), 'unpause');

    assert.deepEqual(answer.paused, [{ bot: BOT, session: 'daily' }], `the premise: daily stays paused, got: ${JSON.stringify(answer.paused)}`);
    for (const one of (answer.tabs ?? []).filter((entry) => entry.name === 'daily')) assertNoRestartLineKey(one, 'the session that stays paused');
    assert.deepEqual(
      (await tabsOfBot(box, bots, BOT)).map((one) => one.tabId),
      [entryOf(answer, 'review').tabId],
      'Orca has one tab of api-bot, review\'s new one: daily has none, so nothing can be typed into it',
    );
    await assertUnpauseLineTyped(box, bots, entryOf(answer, 'review'), { harness: 'claude', id: ids.review, name: 'review', what: 'the session beside it' });
  });

  it('unpause --bot of a bot that is not paused brings its closed sessions up as up does: Codex gets the list line, Claude Code and Pi nothing after the launch line, and no entry carries restartLine', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const harnessOf = (name) => ({ daily: 'claude', review: 'codex', notes: 'pi' })[name];
    const sessions = ['daily', 'review', 'notes'];
    const bots = await madeBot(box, { harness: 'claude', sessions, harnessOf });
    const ids = await running(box, bots, { sessions, harnessOf });
    for (const name of sessions) await closeTab(box, (await liveTab(box, bots, name)).tabId);

    const answer = answered(await kit(box, 'unpause'), 'unpause of a bot that is not paused');

    assert.equal(answer.changed, false, `the premise: there was no pause mark to take off, got: ${JSON.stringify(answer.changed)}`);
    for (const name of sessions) {
      const entry = entryOf(answer, name);
      const harness = harnessOf(name);
      assert.equal(entry.resumed, true, `the premise: ${name} resumed, got: ${JSON.stringify(entry)}`);
      const typed = await typedIn(box, bots, name);
      assertResumeLine(harness, typed[0], ids[name], `not paused, ${name} on ${harness}`);
      assert.deepEqual(typed.slice(1), harness === 'codex' ? [listLineOf(box.cli, bots)] : [], `not paused, ${name} on ${harness}: after the launch line, got: ${JSON.stringify(typed)}`);
      if (harness === 'codex') assert.equal(entry.listLine, true, `the answer says the list line was typed, got: ${JSON.stringify(entry)}`);
      assertNoRestartLineKey(entry, `not paused, ${name} on ${harness}`);
    }
  });

  it('claude: unpause --session of a session that is not paused, its tab closed, brings it back as up does: nothing after the launch line, and no restartLine key', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, ids } = await runningBot(box, 'claude');
    await closeTab(box, (await liveTab(box, bots)).tabId);

    const entry = entryOf(answered(await kit(box, 'unpause', { flags: ['--session', 'daily'] }), 'unpause --session daily'));

    assert.equal(entry.resumed, true, `the premise: resumed, got: ${JSON.stringify(entry)}`);
    const typed = await typedIn(box, bots);
    assert.equal(typed.length, 1, `the launch line and nothing after it, got: ${JSON.stringify(typed)}`);
    assertResumeLine('claude', typed[0], ids.daily, 'a session that was not paused');
    assertNoRestartLineKey(entry, 'a session that was not paused');
  });

  it('a second unpause of a bot the first one brought back finds its tabs live: nothing more is typed, and no entry carries restartLine', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots } = await pausedBot(box, 'claude');
    answered(await kit(box, 'unpause'), 'the first unpause');
    const after = await typedIn(box, bots);
    assert.equal(after.length, 2, `the premise: the first unpause typed its line, got: ${JSON.stringify(after)}`);

    const answer = answered(await kit(box, 'unpause'), 'the second unpause');

    assert.deepEqual(await typedIn(box, bots), after, 'nothing more is typed into the live tab');
    for (const one of answer.tabs ?? []) assertNoRestartLineKey(one, `the second unpause, ${one.bot} ${one.name}`);
  });

  for (const harness of ['claude', 'codex']) {
    it(`${harness}: a session paused before it was ever brought up starts fresh with its duty on unpause, and nothing is typed after that`, LIMIT, async (t) => {
      const box = await createSandbox(t);
      const bots = await madeBot(box, { harness });
      await paused(box);
      assert.equal((await sessionIn(bots, BOT, 'daily'))?.session, undefined, 'the premise: the book names no conversation');

      const entry = entryOf(answered(await kit(box, 'unpause'), 'unpause'));

      const typed = await typedIn(box, bots);
      assert.equal(typed.length, 1, `the launch line and nothing after it, got: ${JSON.stringify(typed)}`);
      assert.ok(typed[0].includes(PROMPT), `the premise: started fresh, with its duty, got: ${typed[0]}`);
      assertNoRestartLineKey(entry, `${harness} started fresh`);
    });

    it(`${harness}: a paused session whose book names a conversation with nothing on record starts fresh with its duty on unpause, and nothing is typed after that`, LIMIT, async (t) => {
      const box = await createSandbox(t);
      const bots = await madeBot(box, { harness });
      answered(await kit(box, 'up'), 'the up this test stands on');
      const heard = await recordSession(box, { bots, bot: BOT, tab: (await liveTab(box, bots)).tabId, session: 'sess-nothing' });
      assert.equal(heard.code, 0, `the hook report this test stands on: ${heard.stderr}`);
      await paused(box);

      const entry = entryOf(answered(await kit(box, 'unpause'), 'unpause'));

      const typed = await typedIn(box, bots);
      assert.equal(typed.length, 1, `the launch line and nothing after it, got: ${JSON.stringify(typed)}`);
      assert.ok(typed[0].includes(PROMPT), `the premise: started fresh, with its duty, got: ${typed[0]}`);
      assert.ok(!typed[0].includes('sess-nothing'), `the premise: the id with nothing behind it is not resumed, got: ${typed[0]}`);
      assertNoRestartLineKey(entry, `${harness} with nothing on record`);
    });
  }
});

// ------------------------------------------------------------- U7: up and restart unchanged

describe('U7 up and restart are as they were after an unpause', { concurrency: true }, () => {
  it('claude: a session the unpause told, whose tab is then closed, is brought back by up with nothing after its launch line, and no restartLine key', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, ids } = await pausedBot(box, 'claude');
    answered(await kit(box, 'unpause'), 'the unpause this test stands on');
    assert.equal((await typedIn(box, bots)).length, 2, 'the premise: the unpause typed its line');
    await closeTab(box, (await liveTab(box, bots)).tabId);

    const entry = entryOf(answered(await kit(box, 'up'), 'up'));

    assert.equal(entry.resumed, true, `the premise: resumed, got: ${JSON.stringify(entry)}`);
    const typed = await typedIn(box, bots);
    assert.equal(typed.length, 1, `the launch line and nothing after it, got: ${JSON.stringify(typed)}`);
    assertResumeLine('claude', typed[0], ids.daily, 'up after an unpause');
    assertNoRestartLineKey(entry, 'up after an unpause');
  });

  it('claude: a restart after an unpause types the restart line, not the unpause line', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, ids } = await pausedBot(box, 'claude');
    answered(await kit(box, 'unpause'), 'the unpause this test stands on');

    const entry = entryOf(answered(await kit(box, 'restart'), 'restart'));

    const typed = await typedIn(box, bots);
    assert.equal(typed.length, 2, `the launch line and the restart line, nothing else, got: ${JSON.stringify(typed)}`);
    assertResumeLine('claude', typed[0], ids.daily, 'restart after an unpause');
    assert.equal(typed[1], restartLineOf(box.cli, bots), 'the restart line of #726, word for word');
    assert.equal(entry.restartLine, true, `got: ${JSON.stringify(entry)}`);
  });
});

// ------------------------------------------------------------- U6: the plain report

/** The plain report's lines from the `opened` line of the session's new tab on, up to the next tab or the summary. */
function linesUnderTab(stdout, tabId) {
  const lines = stdout.split('\n');
  const at = lines.findIndex((line) => /^opened\b/.test(line) && line.includes(tabId));
  assert.notEqual(at, -1, `the plain report has an opened line for the new tab ${tabId}, got:\n${stdout}`);
  const rest = lines.slice(at + 1);
  const end = rest.findIndex((line) => !/^\s/.test(line));
  return end === -1 ? rest : rest.slice(0, end);
}

describe('U6 the plain report says under the tab whether the session was told what the pause ended', { concurrency: true }, () => {
  it('typed: one line under the new tab says the session was told what the pause ended, and not that it was not', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots } = await pausedBot(box, 'claude');

    const result = await kit(box, 'unpause', { plain: true });

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    assert.equal((await typedIn(box, bots)).length, 2, 'the launch line and then the unpause line were typed (U1)');
    const under = linesUnderTab(result.stdout, (await liveTab(box, bots)).tabId);
    const said = under.filter((line) => /pause/i.test(line) && /\b(?:told|typed)\b/i.test(line));
    assert.equal(said.length, 1, `one line under the tab says the session was told what the pause ended, got:\n${result.stdout}`);
    assert.doesNotMatch(said[0], /\bnot\b|n't\b/i, `and it does not say it was not, got: ${said[0]}`);
  });

  it('not typed: one line under the new tab says the session was not told, gives the reason, and tells the caller to tell the session itself', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots } = await pausedBot(box, 'claude');
    await box.orca.set({ waitIdle: 'blocked', blockedReason: 'agent-permission-prompt' });

    const result = await kit(box, 'unpause', { plain: true });

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    assert.equal((await typedIn(box, bots)).length, 1, 'the premise: the unpause line was not typed');
    const under = linesUnderTab(result.stdout, (await liveTab(box, bots)).tabId);
    const said = under.filter((line) => /pause/i.test(line) && /\bnot\b|n't\b/i.test(line) && line.includes('agent-permission-prompt'));
    assert.equal(said.length, 1, `one line under the tab says the session was not told what the pause ended, with Orca's reason, got:\n${result.stdout}`);
    assert.match(said[0], /\byourself\b|\btell (?:the|this|that|it)\b/i, `and, on that line, that the caller should tell the session itself, got: ${said[0]}`);
  });
});
