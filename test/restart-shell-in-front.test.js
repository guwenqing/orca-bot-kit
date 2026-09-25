// `obk restart` brings back a session whose tab is live with only its shell in
// front and whose book entry names no conversation (#303).
//
// A harness can quit before its hook reports a conversation: the tab stays open
// with the shell at a prompt, and the book holds the tab and no `session`. Until
// #303 `obk restart` refused that tab, as it refuses any live tab whose
// conversation it cannot name (R5 in test/restart.test.js), and the user had to
// close the tab by hand and run `obk up`.
//
// What the kit reads to tell the shell from a program is the #232 gate, the
// same "who holds the tab's terminal" read `obk health` and the mail nudge make:
// Orca's pane pid, then `ps`. Here that is the fake Orca and the fake `ps`
// (helpers/fake-ps.js lists the fronts a test can set on one tab).
//
// With the shell in front there is no conversation running in that tab to lose,
// so restart closes the tab by its own handle and starts the session fresh with
// its duty, as `up` does for a session whose tab is gone and whose book names no
// conversation: no resume, and any conversation of the bot's folder that began
// since the kit started a harness in that tab and that no session claims is
// written into the session's `unclaimed` note, not adopted.
//
// Out: a front that is a program (the session's harness, another harness,
// anything else) or cannot be read. That tab may hold the conversation, so
// restart refuses it, as before, and closes nothing. And a whole-bot restart
// still judges every session before it closes any. `obk pause` is not changed
// by #303: it still refuses a live tab whose book names no conversation, shell
// in front or not (S6).

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertCleanFailure,
  bareLaunch,
  botHomeOf,
  conversationOnRecord,
  createSandbox,
  orcaCallsOf,
  orcaFlag,
  recordSession,
  sessionIn,
  skipGit,
  snapshot,
  tabsOfBot,
  typedInto,
} from './helpers/cli.js';

const BOT = 'api-bot';
const PROMPT = 'Read your AGENTS.md and keep the queue moving.';

/** Conversation ids shaped the way both harnesses shape them. */
const conv = (n) => `0199b2c0-${String(n).padStart(4, '0')}-4444-8888-cccccccccccc`;

/** Fronts that are a program, not the shell: the tab may hold a conversation. */
const PROGRAMS = ['harness', 'bare-harness', 'program', 'other-harness'];

/** Fronts that cannot be read: nothing says what the tab holds. */
const UNREADABLE = ['no-pid', 'ps-fails', 'garbage', 'no-tpgid', 'gone'];

/** A bots folder with api-bot on `harness` and the sessions named, each with the duty PROMPT, brought up. */
async function started(box, harness, sessions = ['daily']) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', harness])).code, 0);
  for (const name of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', name, '--prompt', PROMPT]);
    assert.equal(added.code, 0, added.stderr);
  }
  const up = await box.run(['up', '--bots', 'bots', '--bot', BOT]);
  assert.equal(up.code, 0, up.stderr);
  const bots = box.path('bots');
  for (const name of sessions) {
    assert.equal((await sessionIn(bots, BOT, name))?.session, undefined, `the premise: the book names no conversation for ${name}`);
  }
  return { bots, home: botHomeOf(bots, BOT) };
}

/** The tab the book gives a session, and Orca's own record of it. */
async function liveTab(box, bots, name) {
  const entry = await sessionIn(bots, BOT, name);
  assert.equal(typeof entry?.tab, 'string', `the book should hold a tab for ${name}, got: ${JSON.stringify(entry)}`);
  const terminal = (await tabsOfBot(box, bots, BOT)).find((one) => one.tabId === entry.tab);
  assert.ok(terminal, `Orca should still have ${name}'s tab ${entry.tab}`);
  return { tabId: entry.tab, handle: terminal.handle, terminal };
}

/** Put `front` in front of one session's tab alone, in the fake Orca's world. */
async function frontOf(box, bots, name, front) {
  const { tab } = await sessionIn(bots, BOT, name);
  const terminals = await box.orca.terminals();
  assert.ok(terminals.some((one) => one.tabId === tab), `the premise: Orca has ${name}'s tab ${tab}`);
  await box.orca.set({ terminals: terminals.map((one) => (one.tabId === tab ? { ...one, foreground: front } : one)) });
}

/**
 * The session's conversation reported by the kit's hook and on the harness's
 * own record, as a session that has had a turn has it: what a restart resumes.
 */
async function conversationOf(box, bots, harness, name, id) {
  const { tab } = await sessionIn(bots, BOT, name);
  const ran = await recordSession(box, { bots, bot: BOT, tab, session: id });
  assert.equal(ran.code, 0, ran.stderr);
  await conversationOnRecord(box, { harness, cwd: botHomeOf(bots, BOT), id });
}

/**
 * A conversation the harness left in the bot's folder a second after the kit
 * started a harness in `name`'s tab, which no hook ever reported: the harness
 * that quit before its hook recorded one.
 */
async function leftBehind(box, bots, harness, name, id) {
  const { launched } = await sessionIn(bots, BOT, name);
  const when = Date.parse(launched);
  assert.ok(Number.isFinite(when), `the premise: the book says when ${name} was launched, got: ${launched}`);
  await conversationOnRecord(box, { harness, cwd: botHomeOf(bots, BOT), id, at: new Date(when + 1000) });
}

/** The line a session starts fresh on: its settings, then its duty. */
const freshLine = (box, harness, name) => `${bareLaunch(box, harness, BOT, name)} -- '${PROMPT}'`;

/** The line a session resumes `id` on: Claude Code by the flag, Codex by the subcommand. */
const resumeLine = (box, harness, id, name) => (harness === 'claude'
  ? `${bareLaunch(box, 'claude', BOT, name)} --resume ${id}`
  : bareLaunch(box, 'codex', BOT, name).replace(/ codex /, ' codex resume ') + ` ${id}`);

/** Everything Orca was asked since `from`, and the calls of one command among them. */
const since = async (box, from) => (await box.orca.calls()).slice(from);
const closes = (calls) => orcaCallsOf(calls, 'terminal close');
const creates = (calls) => orcaCallsOf(calls, 'terminal create');

// ---------------------------------------------------------------------------
// S1 — the shell in front and no conversation: closed, and started fresh.
// ---------------------------------------------------------------------------

for (const harness of ['claude', 'codex']) {
  test(`S1 ${harness}: restart --session of a live tab with its shell in front and no conversation in the book closes that tab and starts the session fresh with its duty`, async (t) => {
    const box = await createSandbox(t);
    const { bots } = await started(box, harness, ['daily', 'review']);
    await conversationOf(box, bots, harness, 'daily', conv(1));
    await frontOf(box, bots, 'review', 'shell');
    const review = await liveTab(box, bots, 'review');
    const daily = await liveTab(box, bots, 'daily');
    const from = (await box.orca.calls()).length;

    const result = await box.run(['restart', '--bots', 'bots', '--bot', BOT, '--session', 'review', '--json']);

    assert.equal(result.code, 0, `restart should bring review back without a hand step: ${result.stderr}${result.stdout}`);
    const calls = await since(box, from);
    const closed = closes(calls);
    assert.equal(closed.length, 1, `one close, for review alone: ${JSON.stringify(calls.map((call) => call.args))}`);
    assert.equal(orcaFlag(closed[0], '--terminal'), review.handle, 'review\'s tab, by the handle Orca gave it');
    assert.ok(closed[0].args.includes('--tab'), `the whole tab goes, not one pane of it: ${closed[0].args.join(' ')}`);
    const made = creates(calls);
    assert.equal(made.length, 1, 'and one tab is opened in its place');
    assert.ok(calls.indexOf(closed[0]) < calls.indexOf(made[0]), 'the old tab goes first, the new one after it');
    assert.deepEqual(
      JSON.parse(result.stdout).closed,
      [{ bot: BOT, name: 'review', tabId: review.tabId, terminal: review.handle }],
      'the report names the tab that was closed',
    );

    const after = await liveTab(box, bots, 'review');
    assert.notEqual(after.tabId, review.tabId, 'review comes back in a new tab');
    assert.deepEqual(typedInto(after.terminal), [freshLine(box, harness, 'review')], 'started fresh and told its duty, not resumed');
    const entry = await sessionIn(bots, BOT, 'review');
    assert.equal(entry.tab, after.tabId, 'the book follows review to its new tab');
    assert.equal('session' in entry, false, `and names no conversation until the new one's hook reports it, got: ${JSON.stringify(entry)}`);

    assert.deepEqual(
      (await tabsOfBot(box, bots, BOT)).find((one) => one.tabId === daily.tabId),
      daily.terminal,
      'daily, which was not named, is left exactly as it was',
    );
    assert.equal((await sessionIn(bots, BOT, 'daily')).session, conv(1), 'with its conversation in the book');
  });

  test(`S2 ${harness}: a conversation the harness left in the bot's folder is written down as unclaimed, not resumed`, async (t) => {
    const box = await createSandbox(t);
    const { bots } = await started(box, harness);
    await leftBehind(box, bots, harness, 'daily', conv(7));
    await frontOf(box, bots, 'daily', 'shell');
    const before = await liveTab(box, bots, 'daily');

    const result = await box.run(['restart', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);

    assert.equal(result.code, 0, `restart should bring daily back without a hand step: ${result.stderr}${result.stdout}`);
    const after = await liveTab(box, bots, 'daily');
    assert.notEqual(after.tabId, before.tabId, 'daily comes back in a new tab');
    const line = typedInto(after.terminal);
    assert.deepEqual(line, [freshLine(box, harness, 'daily')], 'fresh, with its duty');
    assert.ok(!line[0].includes(conv(7)), `the conversation nobody claims is not resumed, got: ${line[0]}`);
    const entry = await sessionIn(bots, BOT, 'daily');
    assert.equal('session' in entry, false, `nothing is adopted, got: ${JSON.stringify(entry)}`);
    assert.deepEqual(entry.unclaimed, [conv(7)], `what was found is written down for someone to reattach, got: ${JSON.stringify(entry)}`);
    assert.ok(result.stdout.includes(conv(7)), `and the report names it, as up's does, got: ${result.stdout}`);
  });
}

test('S3 the bare shell in front counts as the shell: the tab is closed and the session started fresh', async (t) => {
  // The pane is the shell itself, with no login above it (helpers/fake-ps.js).
  const box = await createSandbox(t);
  const { bots } = await started(box, 'claude');
  await frontOf(box, bots, 'daily', 'bare-shell');
  const before = await liveTab(box, bots, 'daily');
  const from = (await box.orca.calls()).length;

  const result = await box.run(['restart', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);

  assert.equal(result.code, 0, `${result.stderr}${result.stdout}`);
  const closed = closes(await since(box, from));
  assert.deepEqual(closed.map((call) => orcaFlag(call, '--terminal')), [before.handle], 'daily\'s tab, once, by its handle');
  const after = await liveTab(box, bots, 'daily');
  assert.notEqual(after.tabId, before.tabId);
  assert.deepEqual(typedInto(after.terminal), [freshLine(box, 'claude', 'daily')]);
});

// ---------------------------------------------------------------------------
// S4 — a program in front, or a front that cannot be read: refused, as before.
// ---------------------------------------------------------------------------

for (const front of [...PROGRAMS, ...UNREADABLE]) {
  test(`S4 restart of a live tab with no conversation in the book and ${front} in front is refused, and nothing is touched`, async (t) => {
    const box = await createSandbox(t);
    const { bots } = await started(box, 'claude');
    await frontOf(box, bots, 'daily', front);
    const entry = await sessionIn(bots, BOT, 'daily');
    const terminals = await box.orca.terminals();
    const from = (await box.orca.calls()).length;

    const result = await box.run(['restart', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);

    assertCleanFailure(result);
    assert.ok(result.stderr.includes(BOT), `the message should name the bot, got: ${result.stderr}`);
    assert.ok(result.stderr.includes('daily'), `and the session, got: ${result.stderr}`);
    const calls = await since(box, from);
    assert.deepEqual(closes(calls), [], 'nothing may be closed: the tab may hold the conversation');
    assert.deepEqual(creates(calls), [], 'and nothing opened');
    assert.deepEqual(await box.orca.terminals(), terminals, 'every tab should be as it was');
    assert.deepEqual(await sessionIn(bots, BOT, 'daily'), entry, 'and the book unchanged');
  });
}

// ---------------------------------------------------------------------------
// S5 — a whole-bot restart judges every session before it closes any.
// ---------------------------------------------------------------------------

for (const front of ['harness', 'program', 'ps-fails']) {
  test(`S5 a whole-bot restart with one session's shell in front and another's ${front}, neither with a conversation, is refused and closes nothing`, async (t) => {
    // daily comes first and could be restarted on its own; review cannot. A run
    // that closed daily before it looked at review would have closed a tab for
    // a restart that is then refused.
    const box = await createSandbox(t);
    const { bots } = await started(box, 'claude', ['daily', 'review']);
    await frontOf(box, bots, 'daily', 'shell');
    await frontOf(box, bots, 'review', front);
    const terminals = await box.orca.terminals();
    const book = { daily: await sessionIn(bots, BOT, 'daily'), review: await sessionIn(bots, BOT, 'review') };
    const from = (await box.orca.calls()).length;

    const result = await box.run(['restart', '--bots', 'bots', '--bot', BOT]);

    assertCleanFailure(result);
    assert.ok(result.stderr.includes('review'), `the message should name the session in the way, got: ${result.stderr}`);
    const calls = await since(box, from);
    assert.deepEqual(closes(calls), [], 'not one tab of the bot may be closed');
    assert.deepEqual(creates(calls), [], 'and not one opened');
    assert.deepEqual(await box.orca.terminals(), terminals, 'every tab should be as it was, daily\'s included');
    assert.deepEqual(await sessionIn(bots, BOT, 'daily'), book.daily, 'and the book unchanged');
    assert.deepEqual(await sessionIn(bots, BOT, 'review'), book.review);
  });
}

test('S5 a whole-bot restart with one session\'s shell in front and no conversation, and another with its conversation, brings both back', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await started(box, 'claude', ['daily', 'review']);
  await conversationOf(box, bots, 'claude', 'review', conv(2));
  await frontOf(box, bots, 'daily', 'shell');
  const before = { daily: await liveTab(box, bots, 'daily'), review: await liveTab(box, bots, 'review') };
  const from = (await box.orca.calls()).length;

  const result = await box.run(['restart', '--bots', 'bots', '--bot', BOT]);

  assert.equal(result.code, 0, `${result.stderr}${result.stdout}`);
  assert.deepEqual(
    closes(await since(box, from)).map((call) => orcaFlag(call, '--terminal')).sort(),
    [before.daily.handle, before.review.handle].sort(),
    'one close per session, each for that session\'s own tab',
  );
  const daily = await liveTab(box, bots, 'daily');
  const review = await liveTab(box, bots, 'review');
  assert.notEqual(daily.tabId, before.daily.tabId);
  assert.notEqual(review.tabId, before.review.tabId);
  assert.deepEqual(typedInto(daily.terminal), [freshLine(box, 'claude', 'daily')], 'daily had no conversation, so it starts fresh with its duty');
  assert.deepEqual(typedInto(review.terminal), [resumeLine(box, 'claude', conv(2), 'review')], 'review comes back as itself');
});

// ---------------------------------------------------------------------------
// S6 — out of scope: pause is not changed, and still refuses.
// ---------------------------------------------------------------------------

test('S6 pause of a live tab with its shell in front and no conversation in the book is still refused, and nothing is touched', async (t) => {
  // The case restart now takes. A pause keeps the session for `unpause` to
  // bring back, and #303 does not change it: it refuses as it does for any
  // live tab whose book names no conversation (P4 in test/pause.test.js).
  const box = await createSandbox(t);
  const { bots } = await started(box, 'claude');
  await frontOf(box, bots, 'daily', 'shell');
  const terminals = await box.orca.terminals();
  const before = await snapshot(bots, skipGit);
  const from = (await box.orca.calls()).length;

  const result = await box.run(['pause', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('daily'), `the refusal should name the session, got: ${result.stderr}`);
  const calls = await since(box, from);
  assert.deepEqual(closes(calls), [], 'nothing may be closed');
  assert.deepEqual(creates(calls), [], 'and nothing opened');
  assert.deepEqual(await box.orca.terminals(), terminals, 'every tab should be as it was');
  assert.deepEqual(await snapshot(bots, skipGit), before, 'and nothing is written: bot.yaml and the book as they were');
});
