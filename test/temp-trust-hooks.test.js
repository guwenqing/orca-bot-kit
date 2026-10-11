// `obk temp trust-hooks --bots <path> --name <run>`: a maker answers its own
// temporary Codex run's hooks review with "Trust all and continue" (#238, the
// owner's choice (b) and the architect's ruling of 2026-09-29).
//
// Claude Code's auto mode refused the grooming session's raw `orca terminal
// send` of that answer (live run 3), and no narrow permission rule fits a raw
// send: its handle changes every time and its keys are special-reading text.
// So the kit has one command for this one answer, and the rule the owner is
// asked for is `Bash(<kit> temp trust-hooks:*)`. The command:
//
//   1. is run by the run's maker in its own tab, found as `temp retire` finds
//      it, and refuses a name the bot has no session of, a long-lived session,
//      and a temporary one another session made;
//   2. refuses a run that is not on Codex;
//   3. reads the run's rendered screen and refuses unless it shows Codex's
//      `Hooks need review` with its numbered choices, saying what it saw, or
//      that the screen could not be read;
//   4. goes to "2. Trust all and continue" from wherever the pointer is, with
//      arrows (a return alone when it is already on 2), then return: never a
//      digit, and never `--enter` (tech notes, section 3; the obk-bot-building
//      screen table);
//   5. reads the screen again and fails, saying so, if the review is still up;
//   6. says what it did: which run, and that it chose Trust all and continue.
//
// Every refusal types nothing into any tab. Every run is in the sandbox
// (helpers/cli.js): the fake Orca shows each tab the screen a test gives it,
// and moves it on at the next key when told to (`screenAfterSend`).
//
// Since #506 the command answers a review only when its count row is the
// number of the kit's own hooks Codex does not trust yet
// (codex-hooks-only-the-kits.test.js). scout's bot has the kit's two Codex
// hooks and the sandbox has no config.toml, so every review here says
// "2 hooks are new or changed." (helpers/screens.js CODEX_HOOKS_REVIEW_TWO),
// where these tests showed the 0.157.1 capture's "1 hook" before.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSandbox,
  kitLaunchMark,
  sentInto,
  sessionIn,
} from './helpers/cli.js';
import {
  CODEX_AFTER_TRUST,
  CODEX_HOOKS_REVIEW_TWO,
  CODEX_HOOKS_REVIEW_TWO_ON_TWO,
  CODEX_IDLE,
  CODEX_TRUST,
} from './helpers/screens.js';

const BOT = 'temp-bot';
const TASK = 'Read the open pull request and write down what it changes.';

/** Down one, then return: from the review's first choice to "Trust all and continue", taken. */
const DOWN_RETURN = '\x1b[B\r';
const RETURN = '\r';

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
 * A bots folder with temp-bot on Claude Code, its long-lived sessions planner
 * and nightly brought up, and two temporary sessions planner made: scout on
 * Codex and drafter on Claude Code.
 */
async function fleet(box) {
  const ok = async (args, env) => {
    const result = await box.run(args, env === undefined ? {} : { env });
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  };
  await ok(['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  for (const name of ['planner', 'nightly']) await ok(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', name]);
  await ok(['up', '--bots', 'bots', '--bot', BOT]);
  const bots = box.path('bots');
  const planner = await tabOf(box, bots, 'planner');
  await ok(['temp', 'make', '--bots', 'bots', '--name', 'scout', '--harness', 'codex', '--prompt', TASK], inTab(box, planner));
  await ok(['temp', 'make', '--bots', 'bots', '--name', 'drafter', '--prompt', TASK], inTab(box, planner));
  return { bots, planner, nightly: await tabOf(box, bots, 'nightly') };
}

/** Give one session's tab a screen of its own, and what it moves on to at the next key, if anything. */
async function showIn(box, bots, name, shown) {
  const tab = (await sessionIn(bots, BOT, name)).tab;
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((terminal) => (terminal.tabId === tab ? { ...terminal, ...shown } : terminal)),
  });
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

/** `obk temp trust-hooks --bots bots --name <name>`, run in `terminal`, or outside any tab when it is null. */
const trustHooks = (box, terminal, name) => box.run(
  ['temp', 'trust-hooks', '--bots', 'bots', '--name', name],
  terminal === null ? {} : { env: inTab(box, terminal) },
);

/** A refusal: a non-zero exit, something said, no crash, and nothing typed into any tab. */
async function assertRefusedUntyped(box, result, before, what) {
  const said = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.code, 0, `${what} should be refused, got:\n${said}`);
  assert.notEqual(said.trim(), '', `${what}: a refusal says why`);
  assert.ok(!/^\s+at /m.test(said), `${what}: a message, not a crash:\n${said}`);
  assert.deepEqual(await sentSince(box, before), {}, `${what}: nothing is typed into any tab`);
  return said;
}

/**
 * The keys the command sent into one tab, all together, and each send made
 * with no `--enter`: the return is inside the text.
 */
function keysSent(sent, tab) {
  const sends = sent[tab] ?? [];
  assert.ok(sends.length > 0, `keys should have been sent into the run's tab, got: ${JSON.stringify(sent)}`);
  assert.ok(sends.every((one) => one.enter === false), `with no --enter, the return inside the text: ${JSON.stringify(sends)}`);
  return sends.map((one) => one.text).join('');
}

// ------------------------------------------------------------ 1. who may ask

test('TH1 a name the bot has no session of is refused, and nothing is typed', async (t) => {
  const box = await createSandbox(t);
  const { planner } = await fleet(box);
  const before = await sendsByTab(box);

  const said = await assertRefusedUntyped(box, await trustHooks(box, planner, 'nobody'), before, 'a name the bot has no session of');
  assert.ok(said.includes('nobody'), `it names what was asked for: ${said}`);
});

test('TH1 a long-lived session is refused, and nothing is typed', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);
  await showIn(box, bots, 'nightly', { screen: CODEX_HOOKS_REVIEW_TWO });
  const before = await sendsByTab(box);

  const said = await assertRefusedUntyped(box, await trustHooks(box, planner, 'nightly'), before, 'a long-lived session');
  assert.match(said, /long-lived/i, `it says the session is long-lived: ${said}`);
});

test('TH1 a temporary session another session made is refused, and nothing is typed; its maker is not', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner, nightly } = await fleet(box);
  await showIn(box, bots, 'scout', { screen: CODEX_HOOKS_REVIEW_TWO, screenAfterSend: CODEX_AFTER_TRUST });
  const before = await sendsByTab(box);

  const said = await assertRefusedUntyped(box, await trustHooks(box, nightly, 'scout'), before, 'a run another session made');
  assert.ok(said.includes('planner'), `it names the maker, whose it is: ${said}`);

  const made = await trustHooks(box, planner, 'scout');
  assert.equal(made.code, 0, `from its maker's tab the same ask works:\n${made.stdout}${made.stderr}`);
});

test('TH1 run outside any tab it is refused, and nothing is typed', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await fleet(box);
  await showIn(box, bots, 'scout', { screen: CODEX_HOOKS_REVIEW_TWO });
  const before = await sendsByTab(box);

  const said = await assertRefusedUntyped(box, await trustHooks(box, null, 'scout'), before, 'a call from outside any tab');
  assert.match(said, /\btab\b/i, `it says it is run in a session's own tab, as temp retire says: ${said}`);
});

// ------------------------------------------------------------ 2. only a Codex run

test('TH2 a run that is not on Codex is refused, whatever its screen shows, and nothing is typed', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);
  await showIn(box, bots, 'drafter', { screen: CODEX_HOOKS_REVIEW_TWO });
  const before = await sendsByTab(box);

  const said = await assertRefusedUntyped(box, await trustHooks(box, planner, 'drafter'), before, 'a run on Claude Code');
  assert.match(said, /codex/i, `it says the command is for a Codex run: ${said}`);
});

// ------------------------------------------------------------ 3. only the hooks review

for (const [label, shown, words] of [
  ['its idle input line', { screen: CODEX_IDLE }, 'Ask Codex to do anything'],
  ['its folder trust, which is not the hooks review', { screen: CODEX_TRUST }, 'Trust this folder?'],
]) {
  test(`TH3 a Codex run showing ${label} is refused, says what it saw, and nothing is typed`, async (t) => {
    const box = await createSandbox(t);
    const { bots, planner } = await fleet(box);
    await showIn(box, bots, 'scout', shown);
    const before = await sendsByTab(box);

    const said = await assertRefusedUntyped(box, await trustHooks(box, planner, 'scout'), before, label);
    assert.ok(said.includes(words), `it says what the screen showed: ${said}`);
  });
}

for (const [label, change] of [
  ['Orca refuses to read it', { fail: { 'terminal read': { code: 'runtime_error', message: 'the renderer did not answer' } } }],
  ['Orca answers with no rendered screen', null],
]) {
  test(`TH3 a Codex run whose screen cannot be read (${label}) is refused, says so, and nothing is typed`, async (t) => {
    const box = await createSandbox(t);
    const { bots, planner } = await fleet(box);
    if (change === null) await showIn(box, bots, 'scout', { screen: CODEX_HOOKS_REVIEW_TWO, screenSource: 'screen-unavailable' });
    else {
      await showIn(box, bots, 'scout', { screen: CODEX_HOOKS_REVIEW_TWO });
      await box.orca.set(change);
    }
    const before = await sendsByTab(box);

    const said = await assertRefusedUntyped(box, await trustHooks(box, planner, 'scout'), before, label);
    assert.match(said, /could not|cannot|can't|unreadable|not be read/i, `it says the screen could not be read: ${said}`);
  });
}

// ------------------------------------------------------------ 4-6. the answer

test('TH4 with the pointer on "1. Review hooks": down, then return, into the run\'s tab alone, and it says what it chose', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);
  await showIn(box, bots, 'scout', { screen: CODEX_HOOKS_REVIEW_TWO, screenAfterSend: CODEX_AFTER_TRUST });
  const scout = (await sessionIn(bots, BOT, 'scout')).tab;
  const before = await sendsByTab(box);

  const result = await trustHooks(box, planner, 'scout');

  assert.equal(result.code, 0, `it answers the review:\n${result.stdout}${result.stderr}`);
  const sent = await sentSince(box, before);
  assert.deepEqual(Object.keys(sent), [scout], `keys go into the run's tab and no other: ${JSON.stringify(sent)}`);
  assert.equal(keysSent(sent, scout), DOWN_RETURN, 'one down, then return: never a digit');
  assert.ok(result.stdout.includes('scout'), `it says which run: ${result.stdout}`);
  assert.match(result.stdout, /Trust all and continue/, `and that it chose Trust all and continue: ${result.stdout}`);
});

test('TH4 with the pointer already on "2. Trust all and continue": return alone', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);
  await showIn(box, bots, 'scout', { screen: CODEX_HOOKS_REVIEW_TWO_ON_TWO, screenAfterSend: CODEX_AFTER_TRUST });
  const scout = (await sessionIn(bots, BOT, 'scout')).tab;
  const before = await sendsByTab(box);

  const result = await trustHooks(box, planner, 'scout');

  assert.equal(result.code, 0, `it answers the review:\n${result.stdout}${result.stderr}`);
  const sent = await sentSince(box, before);
  assert.deepEqual(Object.keys(sent), [scout], `keys go into the run's tab and no other: ${JSON.stringify(sent)}`);
  assert.equal(keysSent(sent, scout), RETURN, 'the pointer is on it already, so return alone');
  assert.ok(result.stdout.includes('scout'), `it says which run: ${result.stdout}`);
  assert.match(result.stdout, /Trust all and continue/, `and that it chose Trust all and continue: ${result.stdout}`);
});

test('TH5 a review still on screen after the answer is a failure, and it says so', async (t) => {
  // The keys went in and Codex did not move on: the screen read again still
  // shows the review.
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);
  await showIn(box, bots, 'scout', { screen: CODEX_HOOKS_REVIEW_TWO });
  const scout = (await sessionIn(bots, BOT, 'scout')).tab;
  const before = await sendsByTab(box);

  const result = await trustHooks(box, planner, 'scout');

  const said = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.code, 0, `the review did not go, so it did not work:\n${said}`);
  assert.ok(!/^\s+at /m.test(said), `a message, not a crash:\n${said}`);
  assert.equal(keysSent(await sentSince(box, before), scout), DOWN_RETURN, 'the answer was sent');
  assert.match(said, /still/i, `it says the review is still there: ${said}`);
  assert.ok(said.includes('Hooks need review'), `naming it: ${said}`);
});
