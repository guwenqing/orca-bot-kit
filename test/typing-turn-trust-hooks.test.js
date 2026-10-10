// `obk temp trust-hooks` waits its turn to type (#482).
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
// This file is `obk temp trust-hooks` (temp-trust-hooks.test.js): a maker
// answers its temporary Codex run's "Hooks need review" with arrows and a
// return in one send. Before it reads the run's screen and sends, it takes the
// run's typing turn, waiting the same 5 s as the nudge:
//
//   - not got: nothing is typed into any tab, and it is refused as it refuses
//     today, a non-zero exit with the reason on stderr, which says the kit is
//     typing into it and that nothing was typed;
//   - got within the 5 s (here let go after about 1 s): it answers the review
//     as it does today;
//   - per session: the turn is the run's, so one held for another session of
//     the bot (here the maker's own) does not stop it.
//
// The turn is held from the test process, as typing-turn.test.js holds it.
// Every run is in the sandbox, with a fake Orca that shows the run's tab the
// review and moves on at the next key (`screenAfterSend`).

import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, it } from 'node:test';

import { createSandbox, kitLaunchMark, sentInto, sessionIn } from './helpers/cli.js';
import { CODEX_AFTER_TRUST, CODEX_HOOKS_REVIEW_THREE } from './helpers/screens.js';
import { withTypingTurnHeld } from './helpers/typing-turn.js';

/** The words the refusal gives for keys the turn kept out. */
const TYPING = /the kit is typing into it/;

const BOT = 'temp-bot';
const TASK = 'Read the open pull request and write down what it changes.';

/** Down one, then return: from the review's first choice to "Trust all and continue", taken. */
const DOWN_RETURN = '\x1b[B\r';

/** A hard limit for each test, so a wait that never ends fails here rather than hangs the run. */
const LIMIT = { timeout: 120_000 };

/** The environment of a command a session's harness runs in `terminal`. */
const inTab = (box, terminal) => ({ ...box.env, ORCA_TERMINAL_HANDLE: terminal.handle, ORCA_TAB_ID: terminal.tabId, ...kitLaunchMark(box, terminal) });

/** The terminal Orca has for a session of the bot, by the book's tab. */
async function tabOf(box, bots, name) {
  const tab = (await sessionIn(bots, BOT, name))?.tab;
  const found = (await box.orca.terminals()).find((one) => one.tabId === tab);
  assert.ok(found, `Orca should have ${BOT}/${name}'s tab ${tab}`);
  return found;
}

/**
 * A bots folder with temp-bot on Claude Code, its session planner brought up,
 * and a temporary Codex session scout that planner made, whose tab shows the
 * hooks review with the pointer on its first choice and moves on at the next
 * key.
 */
async function fleet(box) {
  const ok = async (args, env) => {
    const result = await box.run(args, env === undefined ? {} : { env });
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  };
  await ok(['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  await ok(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'planner']);
  await ok(['up', '--bots', 'bots', '--bot', BOT]);
  const bots = box.path('bots');
  const planner = await tabOf(box, bots, 'planner');
  await ok(['temp', 'make', '--bots', 'bots', '--name', 'scout', '--harness', 'codex', '--prompt', TASK], inTab(box, planner));
  const scout = (await sessionIn(bots, BOT, 'scout')).tab;
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((terminal) => (terminal.tabId === scout
      ? { ...terminal, screen: CODEX_HOOKS_REVIEW_THREE, screenAfterSend: CODEX_AFTER_TRUST }
      : terminal)),
  });
  return { bots, planner, scout };
}

/** Every `terminal send` so far into every tab, by tab id. */
async function sendsByTab(box) {
  return Object.fromEntries((await box.orca.terminals()).map((terminal) => [terminal.tabId, sentInto(terminal)]));
}

/** What was sent since `before`, by tab id, for the tabs that got anything. */
async function sentSince(box, before) {
  const sent = {};
  for (const [tab, sends] of Object.entries(await sendsByTab(box))) {
    const since = sends.slice((before[tab] ?? []).length);
    if (since.length > 0) sent[tab] = since;
  }
  return sent;
}

/** `obk temp trust-hooks --bots bots --name scout`, run in planner's tab. */
const trustScout = (box, planner) => box.run(['temp', 'trust-hooks', '--bots', 'bots', '--name', 'scout'], { env: inTab(box, planner) });

/** The review answered as today: exit 0, down and return into scout's tab and no other, with no --enter. */
async function assertAnswered(box, result, before, scout, what) {
  assert.equal(result.code, 0, `${what}: it answers the review:\n${result.stdout}${result.stderr}`);
  const sent = await sentSince(box, before);
  assert.deepEqual(Object.keys(sent), [scout], `${what}: keys go into the run's tab and no other: ${JSON.stringify(sent)}`);
  assert.ok(sent[scout].every((one) => one.enter === false), `${what}: with no --enter: ${JSON.stringify(sent[scout])}`);
  assert.equal(sent[scout].map((one) => one.text).join(''), DOWN_RETURN, `${what}: one down, then return`);
}

describe('temp trust-hooks and the typing turn, side by side', { concurrency: true }, () => {
  it('scout\'s typing turn held for the whole run: refused, nothing typed into any tab, and stderr says the kit is typing into it and nothing was typed', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, planner } = await fleet(box);
    const before = await sendsByTab(box);

    const started = Date.now();
    const result = await withTypingTurnHeld(bots, BOT, 'scout', () => trustScout(box, planner));
    const took = Date.now() - started;

    assert.deepEqual(await sentSince(box, before), {}, 'nothing may be typed into any tab while scout\'s turn is held');
    assert.equal(typeof result.code, 'number', 'it should exit, not be killed');
    assert.notEqual(result.code, 0, `it should be refused, got:\n${result.stdout}${result.stderr}`);
    assert.ok(!/^\s+at /m.test(result.stderr), `expected a reason, got a crash:\n${result.stderr}`);
    assert.match(result.stderr, TYPING, `the refusal says the kit is typing into it, got:\n${result.stderr}`);
    assert.match(result.stderr, /nothing was typed/i, `and that nothing was typed, got:\n${result.stderr}`);
    assert.ok(took < 30_000, `the wait for the turn is bounded; it took ${took} ms`);
  });

  it('scout\'s typing turn let go after about 1 s: nothing typed while it was held, then the review is answered as today', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, planner, scout } = await fleet(box);
    const before = await sendsByTab(box);

    let whileHeld;
    const result = await withTypingTurnHeld(bots, BOT, 'scout', async (release) => {
      const run = trustScout(box, planner);
      await sleep(1_000);
      whileHeld = await sentSince(box, before);
      release();
      return run;
    });

    assert.deepEqual(whileHeld, {}, 'nothing was typed while scout\'s turn was held');
    await assertAnswered(box, result, before, scout, 'the turn let go');
  });

  it('the maker planner\'s typing turn held does not hold up the answer to scout\'s review', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, planner, scout } = await fleet(box);
    const before = await sendsByTab(box);

    const result = await withTypingTurnHeld(bots, BOT, 'planner', () => trustScout(box, planner));

    await assertAnswered(box, result, before, scout, 'planner\'s turn is not scout\'s');
  });
});
