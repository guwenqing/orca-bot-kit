// The list line waits its turn to type (#482).
//
// The owner's intent on #482: two kit paths never type into the same
// session's tab at once, since each kit line is a whole line with its own
// Return, and one that lands in the middle of another submits a mixed line.
// #480 gave each session a typing turn (helpers/typing-turn.js); the naming
// and the mail nudge take it (typing-turn.test.js). The boundary, in the
// owner's words: "every kit path that types into a session's tab takes #480's
// typing turn. When it's held, a path waits a short, bounded time, then
// reports 'not typed: the kit is typing into it' through the trouble report it
// already has, and types nothing."
//
// This file is the list line: when `up` (and `restart`, `unpause`, the same
// path) resumes a Codex session in a new tab, the kit types one line into it
// so Orca lists it (codex-resume-list-line.test.js). Before it types, it takes
// the session's typing turn, waiting the same 5 s as the nudge:
//
//   - not got: nothing is typed after the launch line, the tab's `--json`
//     entry has `listLine: false` and a `listLineTrouble` that says the kit is
//     typing into it, the plain report says so under the tab, and `up` still
//     succeeds;
//   - got within the 5 s (here let go after about 1 s): the line is typed as
//     it is today;
//   - per session: a turn held for another session of the bot does not stop
//     this one.
//
// The turn is held from the test process, as typing-turn.test.js holds it.
// Every run is in the sandbox, with a fake Orca.

import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, it } from 'node:test';

import {
  botHomeOf,
  conversationOnRecord,
  createSandbox,
  listLineOf,
  recordSession,
  sentInto,
  sessionIn,
  tabsOfBot,
  typedInto,
} from './helpers/cli.js';
import { withTypingTurnHeld } from './helpers/typing-turn.js';

/** The words the report gives for a line the turn kept out. */
const TYPING = /the kit is typing into it/;

const PROMPT = 'Read your AGENTS.md and keep the queue moving.';
const BOT = 'api-bot';

/** A hard limit for each test, so a wait that never ends fails here rather than hangs the run. */
const LIMIT = { timeout: 120_000 };

/** A bots folder with Bot Father and a Codex api-bot with the sessions named, none of them up yet. */
async function madeBot(box, sessions) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'codex'])).code, 0);
  for (const name of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', name, '--prompt', PROMPT]);
    assert.equal(added.code, 0, added.stderr);
  }
  return box.path('bots');
}

/** Run one kit command for api-bot, `--json` unless `plain`. */
const kit = (box, command, { plain = false } = {}) => box.run([command, '--bots', 'bots', '--bot', BOT, ...(plain ? [] : ['--json'])]);

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
async function liveTab(box, bots, name) {
  const entry = await sessionIn(bots, BOT, name);
  assert.equal(typeof entry?.tab, 'string', `the book should hold a tab for ${name}, got: ${JSON.stringify(entry)}`);
  const terminal = (await tabsOfBot(box, bots, BOT)).find((one) => one.tabId === entry.tab);
  assert.ok(terminal, `Orca should have ${name}'s tab ${entry.tab}`);
  return terminal;
}

/** One session's entry in a kit answer. */
function entryOf(answer, name) {
  const found = (answer.tabs ?? []).filter((one) => one.bot === BOT && one.name === name);
  assert.equal(found.length, 1, `one entry for ${BOT} ${name}, got: ${JSON.stringify(answer.tabs)}`);
  return found[0];
}

/**
 * api-bot up once, each session with a conversation the book holds and Codex
 * has on record (`sess-<name>`), as a session that has had a turn has them:
 * what the next launch resumes.
 */
async function running(box, sessions = ['daily']) {
  const bots = await madeBot(box, sessions);
  answered(await kit(box, 'up'), 'the up this test stands on');
  for (const name of sessions) {
    const tab = await liveTab(box, bots, name);
    const heard = await recordSession(box, { bots, bot: BOT, tab: tab.tabId, session: `sess-${name}` });
    assert.equal(heard.code, 0, `the hook report this test stands on: ${heard.stderr}`);
    await conversationOnRecord(box, { harness: 'codex', cwd: botHomeOf(bots, BOT), id: `sess-${name}` });
  }
  return bots;
}

/** A Codex session with a conversation in the book, and its tab closed the way a user closes one: what `up` resumes. */
async function closedWithConversation(box) {
  const bots = await running(box);
  const { tabId } = await liveTab(box, bots, 'daily');
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((terminal) => terminal.tabId !== tabId) });
  return bots;
}

/** What was typed into the session's tab, the launch line first. */
const typedIn = async (box, bots, name = 'daily') => typedInto(await liveTab(box, bots, name));

/** The launch line resumed `sess-<name>` on Codex: the premise of every test here. */
function assertCodexResumeLine(line, name, what) {
  assert.match(line ?? '', / codex resume /, `${what}: the launch line resumes Codex, got: ${line}`);
  assert.ok(line.includes(`sess-${name}`), `${what}: with the conversation the book holds, sess-${name}, got: ${line}`);
}

/** The list line typed once after the launch line, with a return, and the entry says so. */
async function assertListLineTyped(box, bots, entry, what, name = 'daily') {
  const typed = await typedIn(box, bots, name);
  assert.equal(typed.length, 2, `${what}: the launch line and then the list line, nothing else, got: ${JSON.stringify(typed)}`);
  assertCodexResumeLine(typed[0], name, what);
  assert.equal(typed[1], listLineOf(box.cli, bots), `${what}: the ruled line of #709, word for word`);
  assert.equal(sentInto(await liveTab(box, bots, name))[1].enter, true, `${what}: submitted with a return`);
  assert.equal(entry.listLine, true, `${what}: the answer says it was typed, got: ${JSON.stringify(entry)}`);
  assert.equal(entry.listLineTrouble, undefined, `${what}: and gives no trouble, got: ${JSON.stringify(entry)}`);
}

/** Nothing typed after the launch line, and the entry says the kit is typing into the tab. */
async function assertKeptOut(box, bots, entry, what, name = 'daily') {
  const typed = await typedIn(box, bots, name);
  assert.equal(typed.length, 1, `${what}: nothing may be typed after the launch line while the turn is held, got: ${JSON.stringify(typed)}`);
  assertCodexResumeLine(typed[0], name, what);
  assert.equal(entry.listLine, false, `${what}: the answer says the line was not typed, got: ${JSON.stringify(entry)}`);
  assert.match(String(entry.listLineTrouble), TYPING, `${what}: and why, got: ${JSON.stringify(entry)}`);
}

describe('the list line and the typing turn, side by side', { concurrency: true }, () => {
  it('up with the session\'s typing turn held for the whole run: up succeeds, nothing is typed after the launch line, and listLineTrouble says the kit is typing into it', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const bots = await closedWithConversation(box);

    const started = Date.now();
    const result = await withTypingTurnHeld(bots, BOT, 'daily', () => kit(box, 'up'));
    const took = Date.now() - started;

    const entry = entryOf(answered(result, 'up with the turn held'), 'daily');
    assert.equal(entry.resumed, true, `the premise: resumed in a new tab, got: ${JSON.stringify(entry)}`);
    await assertKeptOut(box, bots, entry, 'the turn held');
    assert.ok(took < 60_000, `the wait for the turn is bounded; up took ${took} ms`);
  });

  it('up with the turn held, plain: the line under the tab says the list line was not typed, because the kit is typing into it', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const bots = await closedWithConversation(box);

    const result = await withTypingTurnHeld(bots, BOT, 'daily', () => kit(box, 'up', { plain: true }));

    assert.equal(result.code, 0, `up still succeeds: ${result.stdout}${result.stderr}`);
    const typed = await typedIn(box, bots);
    assert.equal(typed.length, 1, `nothing may be typed after the launch line while the turn is held, got: ${JSON.stringify(typed)}`);
    const said = result.stdout.split('\n').filter((line) => /\bnot\b|n't\b/i.test(line) && /\btyped\b/i.test(line) && /\bOrca\b/.test(line) && /\blist/i.test(line));
    assert.equal(said.length, 1, `one line says the list line was not typed, got:\n${result.stdout}`);
    assert.match(said[0], TYPING, `and, on that line, that the kit is typing into it, got: ${said[0]}`);
  });

  it('up with the turn let go after about 1 s: the list line is typed once, as today', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const bots = await closedWithConversation(box);

    const result = await withTypingTurnHeld(bots, BOT, 'daily', async (release) => {
      const run = kit(box, 'up');
      await sleep(1_000);
      release();
      return run;
    });

    await assertListLineTyped(box, bots, entryOf(answered(result, 'up with the turn let go'), 'daily'), 'the turn let go');
  });

  it('restart of two Codex sessions with only review\'s turn held: daily gets its list line, review gets nothing after its launch line', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box, ['daily', 'review']);

    const result = await withTypingTurnHeld(bots, BOT, 'review', () => kit(box, 'restart'));

    const answer = answered(result, 'restart with review\'s turn held');
    await assertListLineTyped(box, bots, entryOf(answer, 'daily'), 'review\'s turn is not daily\'s', 'daily');
    await assertKeptOut(box, bots, entryOf(answer, 'review'), 'review\'s own turn held', 'review');
  });
});
