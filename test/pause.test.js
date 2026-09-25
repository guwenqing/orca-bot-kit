// `obk pause --bots <path> --bot <bot> [--session <name>]` and
// `obk unpause --bots <path> --bot <bot> [--session <name>]` (PRD 3.2).
//
// A pause is a bot, or one session of it, that is kept but not run. It is
// written down in `bot.yaml`, so the rest of the kit can see it: `up` opens
// nothing for it, `restart` refuses it, `health` does not call its missing tab
// lost, and `roster` shows it as paused.
//
// Pausing a session that is running closes its tab, and closing a tab is the
// thing `obk restart` is careful about, so a pause is careful the same way:
//
//   - it closes only a tab the book names, one at a time by its own handle,
//     never a tab of the user's and never Bot Father's ops tab, and never with
//     Orca's whole-project close;
//   - it refuses, before anything is closed or written, when the book holds no
//     conversation for a session with a live tab, because that close would end
//     a conversation nobody could bring back;
//   - the book keeps the conversation, and `unpause` brings the session back
//     with it, the way `up` does.
//
// Bot Father is never paused, and nor is its management session, daily: it is
// what the user asks to unpause anything. Any other session of Bot Father's
// pauses like any bot's (#230).

import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  assertCleanFailure,
  bareLaunch,
  botFatherTabs,
  botHomeOf,
  createSandbox,
  orcaCallsOf,
  orcaCommand,
  orcaFlag,
  recordSession,
  sessionIn,
  skipGit,
  snapshot,
  TAB_TITLES,
  tabsOfBot,
  tokenless,
  typedInto,
} from './helpers/cli.js';

/** A bots folder with Bot Father (unless `init: false`) and a bot carrying the sessions named. */
async function madeBot(box, { sessions = ['daily'], bot = 'api-bot', init = true } = {}) {
  if (init) assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', 'claude'])).code, 0);
  for (const name of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', name]);
    assert.equal(added.code, 0, added.stderr);
  }
  return box.path('bots');
}

/** Open the bot's sessions in Orca. */
async function up(box, bot = 'api-bot') {
  const result = await box.run(['up', '--bots', 'bots', '--bot', bot]);
  assert.equal(result.code, 0, result.stderr);
}

/** Tell the book which conversation a session is running, the way the kit's hook does. */
const reported = (box, bots, bot, tab, session) => recordSession(box, { bots, bot, tab, session });

/** The tab the book gives a session, and Orca's own record of it. */
async function liveTab(box, bots, bot, name) {
  const entry = await sessionIn(bots, bot, name);
  assert.equal(typeof entry?.tab, 'string', `the book should hold a tab for ${name}, got: ${JSON.stringify(entry)}`);
  const terminal = (await tabsOfBot(box, bots, bot)).find((one) => one.tabId === entry.tab);
  assert.ok(terminal, `Orca should still have ${name}'s tab ${entry.tab}`);
  return { tabId: entry.tab, handle: terminal.handle, terminal };
}

/** A bot brought up with every session named running a conversation the book knows: `sess-<name>`. */
async function running(box, { sessions = ['daily'] } = {}) {
  const bots = await madeBot(box, { sessions });
  await up(box);
  const tabs = {};
  for (const name of sessions) {
    tabs[name] = await liveTab(box, bots, 'api-bot', name);
    await reported(box, bots, 'api-bot', tabs[name].tabId, `sess-${name}`);
  }
  return { bots, tabs };
}

const since = async (box, from) => (await box.orca.calls()).slice(from);
const closes = (calls) => orcaCallsOf(calls, 'terminal close');
const creates = (calls) => orcaCallsOf(calls, 'terminal create');
const callCount = async (box) => (await box.orca.calls()).length;

const pause = (box, ...rest) => box.run(['pause', '--bots', 'bots', ...rest]);
const unpause = (box, ...rest) => box.run(['unpause', '--bots', 'bots', ...rest]);

/** Pause, as the step a test stands on rather than the thing it is about. */
async function paused(box, ...rest) {
  const result = await pause(box, ...rest);
  assert.equal(result.code, 0, `the pause this test stands on did not happen: ${result.stderr}`);
}

/** What the roster says about one bot, as JSON. */
async function rosterEntry(box, bot) {
  const result = await box.run(['roster', '--bots', 'bots', '--bot', bot, '--json']);
  assert.equal(result.code, 0, result.stderr);
  const [entry] = JSON.parse(result.stdout).roster;
  return entry;
}
const rosterSession = (entry, name) => entry.sessions.find((one) => one.name === name);

/** A resumed claude session's launch line when nothing else is set. */
const resumeLine = (box, id, session = 'daily', bot = 'api-bot') => `${bareLaunch(box, 'claude', bot, session)} --resume ${id}`;

/** A tab in a bot's project that the book has never heard of: one the user opened. */
async function strangerIn(box, home) {
  const stranger = {
    handle: 'term_stranger',
    tabId: 'tab_stranger',
    paneKey: 'tab_stranger:pane_1',
    ptyId: 'pty_stranger',
    leafId: 'leaf_stranger',
    worktreeId: `repo_x::${home}`,
    worktreePath: home,
    title: 'my own shell',
    agentIdentity: null,
    typed: [],
  };
  await box.orca.set({ terminals: [...await box.orca.terminals(), stranger] });
  return stranger;
}

// ---------------------------------------------------------------- pausing

test('P1 pausing a bot closes each of its session tabs by its own handle, and the roster shows it paused', async (t) => {
  const box = await createSandbox(t);
  const { bots, tabs } = await running(box, { sessions: ['daily', 'review'] });
  assert.notEqual((await rosterEntry(box, 'api-bot')).paused, true, 'not paused before, or this proves nothing');
  const from = await callCount(box);

  const result = await pause(box, '--bot', 'api-bot');

  assert.equal(result.code, 0, result.stderr);
  const closed = closes(await since(box, from));
  assert.deepEqual(
    closed.map((call) => orcaFlag(call, '--terminal')).sort(),
    [tabs.daily.handle, tabs.review.handle].sort(),
    'one close per session, each by that session\'s own handle',
  );
  assert.deepEqual(await tabsOfBot(box, bots, 'api-bot'), [], 'and the bot has no tab left open');
  assert.deepEqual(creates(await since(box, from)), [], 'a pause opens nothing');
  assert.equal((await rosterEntry(box, 'api-bot')).paused, true);
});

test('P1 the book keeps each paused session\'s conversation', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await running(box, { sessions: ['daily', 'review'] });

  const result = await pause(box, '--bot', 'api-bot');

  assert.equal(result.code, 0, result.stderr);
  assert.equal((await sessionIn(bots, 'api-bot', 'daily'))?.session, 'sess-daily');
  assert.equal((await sessionIn(bots, 'api-bot', 'review'))?.session, 'sess-review');
});

test('P2 pausing one session closes only its tab and marks only it paused', async (t) => {
  const box = await createSandbox(t);
  const { bots, tabs } = await running(box, { sessions: ['daily', 'review'] });
  const from = await callCount(box);

  const result = await pause(box, '--bot', 'api-bot', '--session', 'daily');

  assert.equal(result.code, 0, result.stderr);
  const closed = closes(await since(box, from));
  assert.deepEqual(closed.map((call) => orcaFlag(call, '--terminal')), [tabs.daily.handle]);
  assert.deepEqual(
    (await tabsOfBot(box, bots, 'api-bot')).map((one) => one.tabId),
    [tabs.review.tabId],
    'the other session is left running',
  );
  const entry = await rosterEntry(box, 'api-bot');
  assert.equal(rosterSession(entry, 'daily').paused, true);
  assert.notEqual(rosterSession(entry, 'review').paused, true, 'the session that was not named is not paused');
  assert.notEqual(entry.paused, true, 'and neither is the bot as a whole');
  assert.equal((await sessionIn(bots, 'api-bot', 'daily'))?.session, 'sess-daily', 'the book keeps its conversation');
});

test('P3 a tab the book does not name is never closed: the user\'s own tab in the bot\'s project stays', async (t) => {
  const box = await createSandbox(t);
  const { bots, tabs } = await running(box);
  const stranger = await strangerIn(box, botHomeOf(bots, 'api-bot'));
  const from = await callCount(box);

  const result = await pause(box, '--bot', 'api-bot');

  assert.equal(result.code, 0, result.stderr);
  const calls = await since(box, from);
  assert.deepEqual(closes(calls).map((call) => orcaFlag(call, '--terminal')), [tabs.daily.handle], 'the session tab, and nothing else');
  assert.deepEqual(
    (await box.orca.terminals()).find((one) => one.tabId === stranger.tabId),
    stranger,
    'the tab the book does not name is left exactly as it was',
  );
  for (const call of calls) {
    assert.ok(!call.args.includes('--all'), `orca ${call.args.join(' ')}: --all closes tabs the kit does not own`);
    if (orcaCommand(call) === 'terminal close') {
      assert.equal(orcaFlag(call, '--worktree'), undefined, 'a close names one tab, never a project');
    }
  }
});

test('P4 a live session the book holds no conversation for is refused: nothing closed, nothing written', async (t) => {
  // daily's conversation is known; review's is not. Closing review's tab would
  // end a conversation nobody could bring back, so neither is touched.
  const box = await createSandbox(t);
  const bots = await madeBot(box, { sessions: ['daily', 'review'] });
  await up(box);
  const daily = await liveTab(box, bots, 'api-bot', 'daily');
  await reported(box, bots, 'api-bot', daily.tabId, 'sess-daily');
  const terminals = await box.orca.terminals();
  const before = await snapshot(bots, skipGit);
  const from = await callCount(box);

  const result = await pause(box, '--bot', 'api-bot');

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('review'), `the refusal should name the session in the way, got: ${result.stderr}`);
  assert.deepEqual(closes(await since(box, from)), [], 'not one tab may be closed');
  assert.deepEqual(await box.orca.terminals(), terminals, 'every tab is as it was');
  assert.deepEqual(await snapshot(bots, skipGit), before, 'and nothing is written: bot.yaml and the book as they were');
  assert.notEqual((await rosterEntry(box, 'api-bot')).paused, true);
});

test('P5 Bot Father is never paused, and nothing is done', async (t) => {
  const box = await createSandbox(t);
  const bots = await madeBot(box);
  const { inBook } = await botFatherTabs(box, bots);
  await reported(box, bots, 'bot-father', inBook[0].tabId, 'sess-bf');
  const terminals = await box.orca.terminals();
  const before = await snapshot(bots, skipGit);
  const from = await callCount(box);

  const result = await pause(box, '--bot', 'bot-father');

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('bot-father'), `the refusal should name Bot Father, got: ${result.stderr}`);
  assert.deepEqual(closes(await since(box, from)), []);
  assert.deepEqual(await box.orca.terminals(), terminals);
  assert.deepEqual(await snapshot(bots, skipGit), before);
});

test('P6 pause refuses when Orca is not answering, and writes nothing', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await running(box);
  await box.orca.set({ reachable: false });
  const before = await snapshot(bots, skipGit);
  const from = await callCount(box);

  const result = await pause(box, '--bot', 'api-bot');

  assertCleanFailure(result);
  assert.match(result.stderr, /not answering/i, `the kit's own sentence about Orca, as up says it, got: ${result.stderr}`);
  assert.deepEqual((await since(box, from)).map(orcaCommand), ['status'], 'once Orca is out, it is asked nothing more');
  assert.deepEqual(await snapshot(bots, skipGit), before);
});

test('P7 pausing what is already paused is safe: exit 0, nothing closed, still paused', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await running(box);
  await paused(box, '--bot', 'api-bot');
  const from = await callCount(box);

  const again = await pause(box, '--bot', 'api-bot');

  assert.equal(again.code, 0, again.stderr);
  assert.deepEqual(closes(await since(box, from)), []);
  assert.equal((await rosterEntry(box, 'api-bot')).paused, true);
  assert.equal((await sessionIn(bots, 'api-bot', 'daily'))?.session, 'sess-daily');
});

test('P8 pause and unpause answer --json with JSON and nothing else', async (t) => {
  const box = await createSandbox(t);
  await running(box);

  for (const run of [pause, unpause]) {
    const result = await run(box, '--bot', 'api-bot', '--json');
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, '');
    try {
      JSON.parse(result.stdout);
    } catch (error) {
      assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
    }
    assert.ok(result.stdout.includes('api-bot'), `the answer should name the bot, got: ${result.stdout}`);
  }
});

// ----------------------------------------------------- what the rest of the kit does with a pause

test('P9 obk up for the whole fleet opens nothing for a paused bot, says it is paused, and still opens the others', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await running(box);
  await madeBot(box, { bot: 'web-bot', init: false });
  await paused(box, '--bot', 'api-bot');
  const from = await callCount(box);

  const result = await box.run(['up', '--bots', 'bots']);

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await tabsOfBot(box, bots, 'api-bot'), [], 'the paused bot stays closed');
  assert.equal((await tabsOfBot(box, bots, 'web-bot')).length, 1, 'while a bot that is not paused is opened as ever');
  assert.ok(
    creates(await since(box, from)).every((call) => orcaFlag(call, '--worktree') !== `path:${botHomeOf(bots, 'api-bot')}`),
    'not one tab is made in the paused bot\'s project',
  );
  assert.match(result.stdout, /paused/i, `up should say the bot is paused, got: ${result.stdout}`);
  assert.ok(result.stdout.includes('api-bot'), `and name it, got: ${result.stdout}`);
});

test('P9 obk up --bot on a paused bot opens nothing and says it is paused', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await running(box);
  await paused(box, '--bot', 'api-bot');
  const from = await callCount(box);

  const result = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(creates(await since(box, from)), []);
  assert.deepEqual(await tabsOfBot(box, bots, 'api-bot'), []);
  assert.match(result.stdout, /paused/i, `up should say it is paused, got: ${result.stdout}`);
});

test('P9 obk up skips a paused session and opens its sibling', async (t) => {
  const box = await createSandbox(t);
  const { bots, tabs } = await running(box, { sessions: ['daily', 'review'] });
  await paused(box, '--bot', 'api-bot', '--session', 'daily');
  // review's tab is lost too, so up has something to open for the bot.
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.tabId !== tabs.review.tabId) });
  const from = await callCount(box);

  const result = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(creates(await since(box, from)).length, 1, 'one tab, for the session that is not paused');
  const open = await tabsOfBot(box, bots, 'api-bot');
  assert.deepEqual(open.map((tab) => typedInto(tab).map(tokenless)), [[resumeLine(box, 'sess-review', 'review')]], 'and it is review, with its conversation');
  assert.match(result.stdout, /paused/i, `up should say daily is paused, got: ${result.stdout}`);
});

// From the review of PR 184: up treats a paused session as if it were not
// there, so nothing about it — here a prompt file that has gone — can stop the
// sessions that will run from coming up.
for (const [label, args] of [
  ['obk up --bot', ['up', '--bots', 'bots', '--bot', 'api-bot']],
  ['obk up for the whole fleet', ['up', '--bots', 'bots']],
]) {
  test(`P12 ${label}: a paused session's missing prompt file does not stop its sibling coming up`, async (t) => {
    const box = await createSandbox(t);
    assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
    assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude'])).code, 0);
    const bots = box.path('bots');
    const duty = path.join(botHomeOf(bots, 'api-bot'), 'duty.md');
    await writeFile(duty, 'The daily duty.\n');
    for (const settings of [['--name', 'daily', '--prompt-file', 'duty.md'], ['--name', 'review']]) {
      const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', ...settings]);
      assert.equal(added.code, 0, added.stderr);
    }
    await paused(box, '--bot', 'api-bot', '--session', 'daily');
    await rm(duty);

    const result = await box.run(args);

    assert.equal(result.code, 0, `the paused session is not one up starts, so its file is nothing to up: ${result.stderr}`);
    const open = await tabsOfBot(box, bots, 'api-bot');
    assert.deepEqual(open.map((tab) => typedInto(tab).map(tokenless)), [[bareLaunch(box, 'claude', 'api-bot', 'review')]], 'review has its tab, and daily has none');
    assert.equal((await sessionIn(bots, 'api-bot', 'daily'))?.tab, undefined, 'the book gives daily no tab');
    assert.match(result.stdout, /paused/i, `up should say daily is paused, got: ${result.stdout}`);
    assert.ok(result.stdout.includes('daily'), `and name it, got: ${result.stdout}`);

    // The contrast: unpausing daily is asking for it to run, and a session
    // whose prompt file is not there cannot.
    const from = await callCount(box);
    const back = await unpause(box, '--bot', 'api-bot', '--session', 'daily');

    assertCleanFailure(back);
    assert.ok(back.stderr.includes('duty.md'), `the refusal should name the missing file, got: ${back.stderr}`);
    assert.deepEqual(creates(await since(box, from)), [], 'and no tab is opened for daily');
  });
}

test('P10 obk restart on a paused bot is refused, says it is paused, and closes nothing', async (t) => {
  const box = await createSandbox(t);
  await running(box);
  await paused(box, '--bot', 'api-bot');
  const from = await callCount(box);

  const result = await box.run(['restart', '--bots', 'bots', '--bot', 'api-bot']);

  assertCleanFailure(result);
  assert.match(result.stderr, /paused/i, `the refusal should say it is paused, got: ${result.stderr}`);
  const calls = await since(box, from);
  assert.deepEqual(closes(calls), []);
  assert.deepEqual(creates(calls), []);
});

test('P10 obk restart of a paused session is refused while its sibling is left running', async (t) => {
  const box = await createSandbox(t);
  const { bots, tabs } = await running(box, { sessions: ['daily', 'review'] });
  await paused(box, '--bot', 'api-bot', '--session', 'daily');
  const from = await callCount(box);

  const result = await box.run(['restart', '--bots', 'bots', '--bot', 'api-bot', '--session', 'daily']);

  assertCleanFailure(result);
  assert.match(result.stderr, /paused/i, `the refusal should say it is paused, got: ${result.stderr}`);
  const calls = await since(box, from);
  assert.deepEqual(closes(calls), []);
  assert.deepEqual(creates(calls), []);
  assert.deepEqual((await tabsOfBot(box, bots, 'api-bot')).map((one) => one.tabId), [tabs.review.tabId]);
});

test('P11 health does not call a paused session\'s missing tab lost, and still reports one that is', async (t) => {
  const box = await createSandbox(t);
  const { tabs } = await running(box, { sessions: ['daily', 'review'] });
  await paused(box, '--bot', 'api-bot', '--session', 'daily');
  // review is not paused and loses its tab: that one is lost, and is the contrast.
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.tabId !== tabs.review.tabId) });

  const result = await box.run(['health', '--bots', 'bots', '--json']);

  const answer = JSON.parse(result.stdout);
  const sessions = answer.found.filter((one) => one.kind === 'session' && one.bot === 'api-bot');
  const words = (one) => `${one.where} ${one.says}`;
  assert.equal(sessions.length, 1, `one lost session, review's, got: ${JSON.stringify(sessions, null, 2)}`);
  assert.ok(words(sessions[0]).includes(tabs.review.tabId), `it names review's tab, got: ${JSON.stringify(sessions[0])}`);
  assert.deepEqual(
    answer.found.filter((one) => words(one).includes(tabs.daily.tabId)),
    [],
    'nothing names the paused session\'s tab',
  );
});

test('P11 a paused bot\'s closed tabs are no finding of health\'s', async (t) => {
  const box = await createSandbox(t);
  await running(box);
  const clean = await box.run(['health', '--bots', 'bots', '--json']);
  assert.deepEqual(JSON.parse(clean.stdout).found, [], 'a fleet the kit brought up itself starts clean, or this proves nothing');
  await paused(box, '--bot', 'api-bot');

  const result = await box.run(['health', '--bots', 'bots', '--json']);

  assert.deepEqual(JSON.parse(result.stdout).found, [], `a pause is not a fault, got: ${result.stdout}`);
  assert.equal(result.code, 0);
});

// ---------------------------------------------------------------- unpausing

test('U1 unpausing a bot brings its session back with the conversation the book held', async (t) => {
  const box = await createSandbox(t);
  const { bots, tabs } = await running(box);
  await paused(box, '--bot', 'api-bot');
  const from = await callCount(box);

  const result = await unpause(box, '--bot', 'api-bot');

  assert.equal(result.code, 0, result.stderr);
  assert.equal(creates(await since(box, from)).length, 1);
  const after = await liveTab(box, bots, 'api-bot', 'daily');
  assert.notEqual(after.tabId, tabs.daily.tabId, 'a new tab');
  assert.deepEqual(typedInto(after.terminal).map(tokenless), [resumeLine(box, 'sess-daily')], 'resuming the conversation it had');
  assert.notEqual((await rosterEntry(box, 'api-bot')).paused, true, 'and the mark is gone');

  // Gone for good: the next up treats it as any other bot, and opens nothing
  // more because it is already up.
  const again = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);
  assert.equal(again.code, 0, again.stderr);
  assert.doesNotMatch(again.stdout, /paused/i, `up should no longer call it paused, got: ${again.stdout}`);
});

test('U2 unpausing one session brings back that session and leaves its sibling alone', async (t) => {
  const box = await createSandbox(t);
  const { bots, tabs } = await running(box, { sessions: ['daily', 'review'] });
  await paused(box, '--bot', 'api-bot', '--session', 'daily');
  const from = await callCount(box);

  const result = await unpause(box, '--bot', 'api-bot', '--session', 'daily');

  assert.equal(result.code, 0, result.stderr);
  const calls = await since(box, from);
  assert.equal(creates(calls).length, 1, 'one tab, for daily');
  assert.deepEqual(closes(calls), [], 'and nothing closed');
  const daily = await liveTab(box, bots, 'api-bot', 'daily');
  assert.deepEqual(typedInto(daily.terminal).map(tokenless), [resumeLine(box, 'sess-daily')]);
  assert.equal((await liveTab(box, bots, 'api-bot', 'review')).tabId, tabs.review.tabId, 'review is still in the tab it was in');
  assert.notEqual(rosterSession(await rosterEntry(box, 'api-bot'), 'daily').paused, true);
});

test('U3 unpause refuses when Orca is not answering, and the bot stays paused', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await running(box);
  await paused(box, '--bot', 'api-bot');
  await box.orca.set({ reachable: false });
  const before = await snapshot(bots, skipGit);

  const result = await unpause(box, '--bot', 'api-bot');

  assertCleanFailure(result);
  assert.match(result.stderr, /not answering/i, `got: ${result.stderr}`);
  assert.deepEqual(await snapshot(bots, skipGit), before, 'nothing written');
  assert.equal((await rosterEntry(box, 'api-bot')).paused, true);
});

// ------------------------------------------------ Bot Father's other sessions
//
// Only Bot Father's management session, daily, is protected (#230). A session
// the user added beside it pauses and unpauses like any bot's, and daily's tab
// and the ops tab are never touched by it.

/**
 * Bot Father as init made it, with a second session, grooming, added and
 * brought up beside daily, each running a conversation the book knows; and
 * the ops tab, the one tab of Bot Father's outside the book.
 */
async function fatherWithGrooming(box) {
  const bots = await madeBot(box);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'bot-father', '--name', 'grooming']);
  assert.equal(added.code, 0, added.stderr);
  await up(box, 'bot-father');
  const daily = await liveTab(box, bots, 'bot-father', 'daily');
  const grooming = await liveTab(box, bots, 'bot-father', 'grooming');
  await reported(box, bots, 'bot-father', daily.tabId, 'sess-bf');
  await reported(box, bots, 'bot-father', grooming.tabId, 'sess-grooming');
  const { leftovers } = await botFatherTabs(box, bots);
  assert.equal(leftovers.length, 1, `the ops tab should be the one tab outside the book, got: ${JSON.stringify(leftovers)}`);
  return { bots, daily, grooming, ops: leftovers[0] };
}

const tabIdsOf = async (box, bots, bot) => (await tabsOfBot(box, bots, bot)).map((one) => one.tabId).sort();
const terminalOf = async (box, tabId) => (await box.orca.terminals()).find((one) => one.tabId === tabId);

test('P13 pausing a Bot Father session that is not daily closes only its tab, by its handle, and marks only it paused', async (t) => {
  const box = await createSandbox(t);
  const { bots, daily, grooming, ops } = await fatherWithGrooming(box);
  const from = await callCount(box);

  const result = await pause(box, '--bot', 'bot-father', '--session', 'grooming');

  assert.equal(result.code, 0, result.stderr);
  const calls = await since(box, from);
  assert.deepEqual(closes(calls).map((call) => orcaFlag(call, '--terminal')), [grooming.handle], 'grooming\'s tab, by its own handle, and no other');
  assert.deepEqual(creates(calls), [], 'a pause opens nothing');
  assert.deepEqual(await tabIdsOf(box, bots, 'bot-father'), [daily.tabId, ops.tabId].sort(), 'daily and the ops tab are left open');
  assert.deepEqual(await terminalOf(box, ops.tabId), ops, 'the ops tab exactly as it was');
  assert.deepEqual(await terminalOf(box, daily.tabId), daily.terminal, 'and daily\'s tab too');
  const entry = await rosterEntry(box, 'bot-father');
  assert.equal(rosterSession(entry, 'grooming').paused, true);
  assert.notEqual(rosterSession(entry, 'daily').paused, true, 'daily is not paused');
  assert.notEqual(entry.paused, true, 'and neither is Bot Father as a whole');
  assert.equal((await sessionIn(bots, 'bot-father', 'grooming'))?.session, 'sess-grooming', 'the book keeps its conversation');
});

for (const [label, args] of [
  ['obk up for the whole fleet', ['up', '--bots', 'bots']],
  ['obk up --bot bot-father', ['up', '--bots', 'bots', '--bot', 'bot-father']],
]) {
  test(`P14 ${label} leaves a paused Bot Father session closed`, async (t) => {
    const box = await createSandbox(t);
    const { bots, daily, ops } = await fatherWithGrooming(box);
    await paused(box, '--bot', 'bot-father', '--session', 'grooming');
    const from = await callCount(box);

    const result = await box.run(args);

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(
      creates(await since(box, from)).filter((call) => orcaFlag(call, '--worktree') === `path:${botHomeOf(bots, 'bot-father')}`),
      [],
      'daily and the ops tab are up, and grooming is paused: nothing to open in Bot Father\'s project',
    );
    assert.deepEqual(await tabIdsOf(box, bots, 'bot-father'), [daily.tabId, ops.tabId].sort());
    assert.equal(rosterSession(await rosterEntry(box, 'bot-father'), 'grooming').paused, true, 'and it is still paused');
  });
}

test('P15 obk up --bot bot-father still makes a missing ops tab while a session of it is paused', async (t) => {
  const box = await createSandbox(t);
  const { bots, daily, ops } = await fatherWithGrooming(box);
  await paused(box, '--bot', 'bot-father', '--session', 'grooming');
  // The user closed the ops tab.
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.tabId !== ops.tabId) });
  const from = await callCount(box);

  const result = await box.run(['up', '--bots', 'bots', '--bot', 'bot-father']);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(creates(await since(box, from)).length, 1, 'one tab: the ops tab, and none for grooming');
  const after = await botFatherTabs(box, bots);
  assert.deepEqual(after.inBook.map((one) => one.tabId), [daily.tabId], 'daily is the one session tab open');
  assert.equal(after.leftovers.length, 1, `one tab outside the book, got: ${JSON.stringify(after.leftovers)}`);
  assert.notEqual(after.leftovers[0].tabId, ops.tabId, 'a new tab');
  assert.equal(after.leftovers[0].title, TAB_TITLES.ops);
  assert.deepEqual(after.leftovers[0].typed, [], 'a plain shell: nothing is typed into it');
});

test('U4 unpausing a Bot Father session that is not daily brings it back with the conversation the book held', async (t) => {
  const box = await createSandbox(t);
  const { bots, daily, grooming, ops } = await fatherWithGrooming(box);
  await paused(box, '--bot', 'bot-father', '--session', 'grooming');
  const from = await callCount(box);

  const result = await unpause(box, '--bot', 'bot-father', '--session', 'grooming');

  assert.equal(result.code, 0, result.stderr);
  const calls = await since(box, from);
  assert.equal(creates(calls).length, 1, 'one tab, for grooming');
  assert.deepEqual(closes(calls), [], 'and nothing closed');
  const back = await liveTab(box, bots, 'bot-father', 'grooming');
  assert.notEqual(back.tabId, grooming.tabId, 'a new tab');
  assert.deepEqual(typedInto(back.terminal).map(tokenless), [resumeLine(box, 'sess-grooming', 'grooming', 'bot-father')], 'resuming the conversation it had');
  assert.deepEqual(await terminalOf(box, daily.tabId), daily.terminal, 'daily\'s tab is as it was');
  assert.deepEqual(await terminalOf(box, ops.tabId), ops, 'and so is the ops tab');
  assert.notEqual(rosterSession(await rosterEntry(box, 'bot-father'), 'grooming').paused, true, 'and the mark is gone');
});

test('P16 with another session beside it, Bot Father as a whole and its daily are still never paused or unpaused, and nothing is done', async (t) => {
  // Guards the other side of #230: letting grooming through must not let
  // Bot Father itself, or its management session, through with it.
  const box = await createSandbox(t);
  const { bots } = await fatherWithGrooming(box);
  const terminals = await box.orca.terminals();
  const before = await snapshot(bots, skipGit);
  const from = await callCount(box);

  for (const [run, ...args] of [
    [pause, '--bot', 'bot-father'],
    [pause, '--bot', 'bot-father', '--session', 'daily'],
    [unpause, '--bot', 'bot-father'],
    [unpause, '--bot', 'bot-father', '--session', 'daily'],
  ]) {
    const result = await run(box, ...args);
    const said = `${run === pause ? 'pause' : 'unpause'} ${args.join(' ')}`;
    assert.equal(result.code, 1, `${said} should be refused, got: ${result.stdout}${result.stderr}`);
    assertCleanFailure(result);
    assert.ok(result.stderr.includes('bot-father'), `${said}: the refusal should name Bot Father, got: ${result.stderr}`);
  }
  const calls = await since(box, from);
  assert.deepEqual(closes(calls), [], 'not one tab closed');
  assert.deepEqual(creates(calls), [], 'or opened');
  assert.deepEqual(await box.orca.terminals(), terminals);
  assert.deepEqual(await snapshot(bots, skipGit), before, 'and nothing written');
});
