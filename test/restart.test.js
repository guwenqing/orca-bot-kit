// `obk restart --bots <path> --bot <bot> [--session <name>]`: the one command
// in the kit that ever closes a tab.
//
// Everything else only adds. Closing a tab throws away the user's screen and
// Orca's resume record with it, so `up` never does it. But a restart is a thing
// the user asks for (PRD 6.5: avoided, not banned), and when they ask, the
// session has to come back as itself — the conversation it was having, not a
// fresh one.
//
// So "safe" is the whole of this command, and it is three rules:
//
//   1. It closes only a tab the book itself names. Anything else in the bot's
//      project — Bot Father's ops tab, a tab the user opened — is none of its
//      business, and a tab it cannot name it cannot close.
//   2. It never closes a tab whose conversation it could not bring back. A
//      session with a live tab and no harness session in the book is refused
//      before anything is touched, because the close would be the end of that
//      conversation.
//   3. It closes one tab at a time, by that tab's own handle. Orca's
//      `terminal close --worktree <selector> --all` closes every tab of a
//      project; the fake Orca here does not answer that call at all, it falls
//      over, so an implementation that reaches for it fails the suite rather
//      than passing quietly.
//
// What it does after the close is `up`'s work, unchanged, and that is the point
// of `--session <name>`, of the resume on the launch line and of the report:
// the tests below read them against what `up` already does.

import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import {
  assertCleanFailure,
  bareLaunch,
  bookOf,
  botFatherTabs,
  botHomeOf,
  createSandbox,
  hookFileOf,
  orcaCallsOf,
  orcaCommand,
  orcaFlag,
  recordSession,
  sessionIn,
  tabsOfBot,
  TAB_TITLES,
  tokenless,
  typedInto,
} from './helpers/cli.js';
import { addRules, agentsOf } from './helpers/rules.js';

const PROMPT = 'Read your AGENTS.md and keep the queue moving.';

/** A bots folder with Bot Father and an api-bot carrying the sessions named. */
async function madeBot(box, { sessions = ['daily'], harness = 'claude', settings = [] } = {}) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', harness])).code, 0);
  for (const name of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', name, ...settings]);
    assert.equal(added.code, 0, added.stderr);
  }
  return box.path('bots');
}

/** Open the bot's sessions in Orca, the way a user has them open before a restart. */
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

/** Change one session's entry in the book, the way a user or an earlier run leaves it. */
async function editSession(bots, bot, name, changes) {
  const file = bookOf(bots, bot);
  const book = parse(await readFile(file, 'utf8'));
  book.sessions[name] = { ...book.sessions[name], ...changes };
  await writeFile(file, stringify(book));
}

/** Change one of a bot's sessions in bot.yaml, the way a user editing that file by hand does. */
async function editBotSession(bots, bot, name, changes) {
  const file = path.join(botHomeOf(bots, bot), 'bot.yaml');
  const written = parse(await readFile(file, 'utf8'));
  written.sessions = written.sessions.map((session) => (session.name === name ? { ...session, ...changes } : session));
  await writeFile(file, stringify(written));
}

/** Everything Orca was asked since `from`, and the calls of one command among them. */
const since = async (box, from) => (await box.orca.calls()).slice(from);
const closes = (calls) => orcaCallsOf(calls, 'terminal close');
const creates = (calls) => orcaCallsOf(calls, 'terminal create');

/**
 * The line a claude session is started with when it resumes `id` and nothing
 * else is set. A session's own name is on that line — `-n <bot>.<session>.<token>`,
 * which is the address another Claude session writes to (ADR 0018) — and it
 * goes on a resume as much as on a first start, so the session that comes back
 * answers to the name it had. The token is compared through `tokenless`;
 * session-resume checks that it is the one the book held.
 */
const resumeLine = (box, id, bot = 'api-bot', session = 'daily') =>
  `${bareLaunch(box, 'claude', bot, session)} --resume ${id}`;

test('R1 a session that is up is closed once, by its own handle, and comes back with its conversation', async (t) => {
  const box = await createSandbox(t);
  const bots = await madeBot(box);
  await up(box);
  const before = await liveTab(box, bots, 'api-bot', 'daily');
  await reported(box, bots, 'api-bot', before.tabId, 'sess-1');
  const from = (await box.orca.calls()).length;

  const result = await box.run(['restart', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(result.code, 0, result.stderr);
  const calls = await since(box, from);
  const closed = closes(calls);
  assert.equal(closed.length, 1, `one close, for the one session: ${JSON.stringify(calls.map((call) => call.args))}`);
  assert.equal(orcaFlag(closed[0], '--terminal'), before.handle, 'the tab the book names, by the handle Orca gave it');
  assert.ok(closed[0].args.includes('--tab'), `the whole tab goes, not one pane of it: ${closed[0].args.join(' ')}`);

  const made = creates(calls);
  assert.equal(made.length, 1, 'and one tab is opened in its place');
  assert.ok(calls.indexOf(closed[0]) < calls.indexOf(made[0]), 'the old tab goes first, the new one after it');

  const after = await liveTab(box, bots, 'api-bot', 'daily');
  assert.notEqual(after.tabId, before.tabId, 'a tab that comes back is a new tab');
  assert.deepEqual(
    typedInto(after.terminal).map(tokenless),
    [resumeLine(box, 'sess-1')],
    'and the line typed into it picks up the conversation the book held',
  );
  const entry = await sessionIn(bots, 'api-bot', 'daily');
  assert.equal(entry.tab, after.tabId, 'the book follows the session to its new tab');
  assert.equal(entry.session, 'sess-1', 'and it is still the same conversation');
});

test('R2 with no --session every session of the bot is restarted', async (t) => {
  const box = await createSandbox(t);
  const bots = await madeBot(box, { sessions: ['daily', 'review'] });
  await up(box);
  const before = {
    daily: await liveTab(box, bots, 'api-bot', 'daily'),
    review: await liveTab(box, bots, 'api-bot', 'review'),
  };
  await reported(box, bots, 'api-bot', before.daily.tabId, 'sess-daily');
  await reported(box, bots, 'api-bot', before.review.tabId, 'sess-review');
  const from = (await box.orca.calls()).length;

  const result = await box.run(['restart', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(result.code, 0, result.stderr);
  const calls = await since(box, from);
  assert.deepEqual(
    closes(calls).map((call) => orcaFlag(call, '--terminal')).sort(),
    [before.daily.handle, before.review.handle].sort(),
    'one close per session, each for that session\'s own tab',
  );

  for (const [name, id] of [['daily', 'sess-daily'], ['review', 'sess-review']]) {
    const after = await liveTab(box, bots, 'api-bot', name);
    assert.notEqual(after.tabId, before[name].tabId, `${name} should be in a new tab`);
    assert.deepEqual(typedInto(after.terminal).map(tokenless), [resumeLine(box, id, 'api-bot', name)], `${name} should come back as itself`);
  }
});

test('R3 only the tabs the book names are closed: Bot Father keeps its ops tab', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);

  const first = await botFatherTabs(box, bots);
  assert.equal(first.inBook.length, 1, `the daily session should be in the book, got: ${first.book}`);
  assert.equal(first.leftovers.length, 1, 'and the ops tab outside it (PRD 6.2)');
  const [daily] = first.inBook;
  const [ops] = first.leftovers;

  // And a third tab in the same project that the book has never heard of: a
  // tab the user opened for themselves.
  const stranger = {
    handle: 'term_stranger',
    tabId: 'tab_stranger',
    paneKey: 'tab_stranger:pane_1',
    ptyId: 'pty_stranger',
    leafId: 'leaf_stranger',
    worktreeId: `repo_1::${botHomeOf(bots)}`,
    worktreePath: botHomeOf(bots),
    title: 'my own shell',
    agentIdentity: null,
    typed: [],
  };
  await box.orca.set({ terminals: [...await box.orca.terminals(), stranger] });
  await reported(box, bots, 'bot-father', daily.tabId, 'sess-bf');
  const from = (await box.orca.calls()).length;

  const result = await box.run(['restart', '--bots', 'bots', '--bot', 'bot-father']);

  assert.equal(result.code, 0, result.stderr);
  const closed = closes(await since(box, from));
  assert.equal(closed.length, 1, 'the one session tab, and nothing else');
  assert.equal(orcaFlag(closed[0], '--terminal'), daily.handle);

  const after = await box.orca.terminals();
  assert.equal(after.length, 3, 'the session tab is back, and the other two were never touched');
  assert.deepEqual(after.find((one) => one.tabId === ops.tabId), ops, 'the ops tab is left exactly as it was');
  assert.deepEqual(after.find((one) => one.tabId === stranger.tabId), stranger, 'and so is the tab the book does not name');
  const came = await liveTab(box, bots, 'bot-father', 'daily');
  assert.notEqual(came.tabId, daily.tabId);
  assert.equal(came.terminal.title, TAB_TITLES.daily);
  assert.deepEqual(typedInto(came.terminal).map(tokenless), [resumeLine(box, 'sess-bf', 'bot-father', 'daily')]);
});

test('R4 Orca\'s whole-project close is never called, by this command or any other', async (t) => {
  const box = await createSandbox(t);
  const bots = await madeBot(box);
  await up(box);
  const before = await liveTab(box, bots, 'api-bot', 'daily');
  await reported(box, bots, 'api-bot', before.tabId, 'sess-1');

  const restarted = await box.run(['restart', '--bots', 'bots', '--bot', 'api-bot']);
  const again = await box.run(['up', '--bots', 'bots']);

  assert.equal(restarted.code, 0, restarted.stderr);
  assert.equal(again.code, 0, again.stderr);
  const calls = await box.orca.calls();
  assert.equal(closes(calls).length, 1, 'a tab really was closed, or this test proves nothing');
  for (const call of calls) {
    const shown = call.args.join(' ');
    assert.ok(!call.args.includes('--all'), `orca ${shown}: --all closes tabs the kit does not own`);
    if (orcaCommand(call) !== 'terminal close') continue;
    assert.equal(orcaFlag(call, '--worktree'), undefined, `orca ${shown}: a close names one tab, never a project`);
    assert.ok(call.args.includes('--terminal'), `orca ${shown}: a close names the tab by its handle`);
  }
});

test('R5 a live session the book holds no conversation for is refused, and nothing is touched', async (t) => {
  // Nothing ever reported for this session, so the kit cannot name the
  // conversation in that tab. Closing it would be the end of it.
  const box = await createSandbox(t);
  const bots = await madeBot(box);
  await up(box);
  const before = await liveTab(box, bots, 'api-bot', 'daily');
  const terminals = await box.orca.terminals();
  const from = (await box.orca.calls()).length;

  const result = await box.run(['restart', '--bots', 'bots', '--bot', 'api-bot']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('api-bot'), `the message should name the bot, got: ${result.stderr}`);
  assert.ok(result.stderr.includes('daily'), `and the session, got: ${result.stderr}`);
  assert.ok(
    result.stderr.includes(bookOf(bots, 'api-bot')),
    `and the file the user would settle it in, got: ${result.stderr}`,
  );

  const calls = await since(box, from);
  assert.deepEqual(closes(calls), [], 'nothing may be closed');
  assert.deepEqual(creates(calls), [], 'and nothing opened');
  assert.deepEqual(await box.orca.terminals(), terminals, 'every tab should be as it was');
  assert.equal((await sessionIn(bots, 'api-bot', 'daily')).tab, before.tabId, 'and the book unchanged');
});

test('R5 the refusal names the conversations nobody claims for that session', async (t) => {
  // What the user has to settle first: the kit found these in the bot's folder
  // and no session claims them, so one of them may be the conversation in that
  // tab. Naming them is the difference between a refusal they can act on and
  // one they cannot.
  const box = await createSandbox(t);
  const bots = await madeBot(box);
  await up(box);
  await editSession(bots, 'api-bot', 'daily', { unclaimed: ['conv-a', 'conv-b'] });

  const result = await box.run(['restart', '--bots', 'bots', '--bot', 'api-bot']);

  assertCleanFailure(result);
  for (const id of ['conv-a', 'conv-b']) {
    assert.ok(result.stderr.includes(id), `the message should name ${id}, got: ${result.stderr}`);
  }
});

test('R6 one session that cannot come back stops the whole run before anything is closed', async (t) => {
  const box = await createSandbox(t);
  const bots = await madeBot(box, { sessions: ['daily', 'review'] });
  await up(box);
  const daily = await liveTab(box, bots, 'api-bot', 'daily');
  // Only one of the two is a conversation the kit could hand back.
  await reported(box, bots, 'api-bot', daily.tabId, 'sess-daily');
  const terminals = await box.orca.terminals();
  const from = (await box.orca.calls()).length;

  const result = await box.run(['restart', '--bots', 'bots', '--bot', 'api-bot']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('review'), `the message should name the session in the way, got: ${result.stderr}`);
  const calls = await since(box, from);
  assert.deepEqual(closes(calls), [], 'not one tab of the bot may be closed');
  assert.deepEqual(creates(calls), [], 'and not one opened');
  assert.deepEqual(await box.orca.terminals(), terminals, 'the session that could have come back is left running');
});

test('R7 a session whose tab Orca no longer has is brought back, and nothing is closed', async (t) => {
  const box = await createSandbox(t);
  const bots = await madeBot(box);
  await up(box);
  const before = await liveTab(box, bots, 'api-bot', 'daily');
  await reported(box, bots, 'api-bot', before.tabId, 'sess-1');
  // The user closed it themselves, or the machine was restarted.
  await box.orca.set({
    terminals: (await box.orca.terminals()).filter((one) => one.tabId !== before.tabId),
  });
  const from = (await box.orca.calls()).length;

  const result = await box.run(['restart', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(result.code, 0, result.stderr);
  const calls = await since(box, from);
  assert.deepEqual(closes(calls), [], 'there was nothing there to close');
  assert.equal(creates(calls).length, 1, 'and the session comes back all the same');
  const after = await liveTab(box, bots, 'api-bot', 'daily');
  assert.notEqual(after.tabId, before.tabId);
  assert.deepEqual(typedInto(after.terminal).map(tokenless), [resumeLine(box, 'sess-1')], 'with the conversation the book held');
});

test('R8 a session that has never had a tab is started fresh, with its duty and no resume', async (t) => {
  const box = await createSandbox(t);
  const bots = await madeBot(box, { settings: ['--prompt', PROMPT] });
  const from = (await box.orca.calls()).length;

  const result = await box.run(['restart', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(result.code, 0, result.stderr);
  const calls = await since(box, from);
  assert.deepEqual(closes(calls), [], 'the book names no tab, so there is nothing to close');
  assert.equal(creates(calls).length, 1);
  const after = await liveTab(box, bots, 'api-bot', 'daily');
  assert.deepEqual(
    typedInto(after.terminal).map(tokenless),
    [`${bareLaunch(box, 'claude', 'api-bot', 'daily')} -- '${PROMPT}'`],
    'a session with no conversation behind it starts one, and is told what it is for',
  );
});

test('R9 Orca refusing the close stops the command, and no harness is started beside the old one', async (t) => {
  // Two harnesses on one conversation is what this prevents: the tab is still
  // there with the session in it, so a second one must not be opened.
  const box = await createSandbox(t);
  const bots = await madeBot(box);
  await up(box);
  const before = await liveTab(box, bots, 'api-bot', 'daily');
  await reported(box, bots, 'api-bot', before.tabId, 'sess-1');
  await box.orca.set({ fail: { 'terminal close': { code: 'runtime_error', message: 'the tab will not close' } } });
  const from = (await box.orca.calls()).length;

  const result = await box.run(['restart', '--bots', 'bots', '--bot', 'api-bot']);

  assertCleanFailure(result);
  assert.ok(
    result.stderr.includes('the tab will not close'),
    `Orca's own words should reach the reader, got: ${result.stderr}`,
  );
  const calls = await since(box, from);
  assert.equal(closes(calls).length, 1, 'it asked, and was refused');
  assert.deepEqual(creates(calls), [], 'and opened nothing after that');
  assert.equal(
    (await liveTab(box, bots, 'api-bot', 'daily')).tabId,
    before.tabId,
    'the session is still in the tab it was in',
  );
});

test('R10 the ordinary refusals: no bot, a bot that is not there, a session the bot has not, a session with no bot', async (t) => {
  const box = await createSandbox(t);
  await madeBot(box);
  await up(box);
  const from = (await box.orca.calls()).length;

  const refusals = [
    [['restart', '--bots', 'bots'], '--bot', 'a restart is of one bot, so it has to be told which'],
    [['restart', '--bots', 'bots', '--bot', 'ghost'], 'ghost', 'there is no such bot in the folder'],
    [['restart', '--bots', 'bots', '--bot', 'api-bot', '--session', 'ghost'], 'ghost', 'the bot has no session of that name'],
    [['restart', '--bots', 'bots', '--session', 'daily'], '--bot', 'a session belongs to a bot, and none was named'],
  ];

  for (const [args, named, why] of refusals) {
    const result = await box.run(args);

    assertCleanFailure(result);
    assert.ok(result.stderr.includes(named), `${why}: the message should name ${named}, got: ${result.stderr}`);
  }
  assert.deepEqual(closes(await since(box, from)), [], 'a command that was refused closes nothing');
});

test('R11 a restart refuses when Orca is not answering', async (t) => {
  const box = await createSandbox(t);
  const bots = await madeBot(box);
  await up(box);
  const before = await liveTab(box, bots, 'api-bot', 'daily');
  await reported(box, bots, 'api-bot', before.tabId, 'sess-1');
  await box.orca.set({ reachable: false });
  const from = (await box.orca.calls()).length;

  const result = await box.run(['restart', '--bots', 'bots', '--bot', 'api-bot']);

  assertCleanFailure(result);
  assert.match(result.stderr, /not answering/i, `the kit's own sentence about Orca, got: ${result.stderr}`);
  assert.deepEqual(
    (await since(box, from)).map(orcaCommand),
    ['status'],
    'once Orca is out, the kit must stop asking it for things',
  );
});

test('R12 --json and the plain lines carry the same facts, the closed tabs included', async (t) => {
  const box = await createSandbox(t);
  const bots = await madeBot(box);
  await up(box);
  const first = await liveTab(box, bots, 'api-bot', 'daily');
  await reported(box, bots, 'api-bot', first.tabId, 'sess-1');

  const asJson = await box.run(['restart', '--bots', 'bots', '--bot', 'api-bot', '--json']);

  assert.equal(asJson.code, 0, asJson.stderr);
  assert.equal(asJson.stderr, '');
  let answer;
  try {
    answer = JSON.parse(asJson.stdout);
  } catch (error) {
    assert.fail(`--json should print JSON and nothing else, got: ${asJson.stdout} (${error.message})`);
  }
  assert.deepEqual(
    answer.closed,
    [{ bot: 'api-bot', name: 'daily', tabId: first.tabId, terminal: first.handle }],
    'the tab that was closed, named the way the book and Orca name it',
  );

  // The same run, as `up` would have answered it, and one key more.
  const second = await liveTab(box, bots, 'api-bot', 'daily');
  const upAnswer = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot', '--json']);
  assert.equal(upAnswer.code, 0, upAnswer.stderr);
  assert.deepEqual(
    Object.keys(answer).sort(),
    [...Object.keys(JSON.parse(upAnswer.stdout)), 'closed'].sort(),
    'a restart answers what an up answers, plus what it closed',
  );

  // And the plain report of a restart carries what the JSON carried: it closes
  // the tab the first one opened, so its ids are known before it runs.
  const plain = await box.run(['restart', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(plain.code, 0, plain.stderr);
  const third = await liveTab(box, bots, 'api-bot', 'daily');
  const lines = plain.stdout.trimEnd().split('\n');
  const lineWith = (fact) => {
    const at = lines.findIndex((line) => line.includes(fact));
    assert.notEqual(at, -1, `the lines should carry ${fact}, got: ${plain.stdout}`);
    return at;
  };
  lineWith(second.handle);
  lineWith('daily');
  assert.ok(
    lineWith(second.tabId) < lineWith(third.tabId),
    `the tab that went should be reported before the one that came, got: ${plain.stdout}`,
  );
  assert.ok(lines.at(-1).includes(bots), `the summary line comes last, got: ${plain.stdout}`);
  assert.ok(!plain.stdout.includes('undefined'), `nothing should be undefined, got: ${plain.stdout}`);
  assert.ok(!/worktree/i.test(plain.stdout), `obk says "Orca project", never "worktree", got: ${plain.stdout}`);
});

// R13 and R14 come from the review, and both are about the same half-second:
// the one between the tab being closed and the session being back. Nothing may
// be closed until everything that could stop the session starting again has
// been asked, and nothing may be believed closed until Orca's own listing says
// so. A tab closed either way round is a conversation the kit threw away for a
// session it could not bring back.

test('R13 a session whose launch line would be refused is refused before anything is closed', async (t) => {
  // A bot.yaml somebody edited by hand: an approval level that does not exist.
  // The launch refuses it, and it is refused wherever it is found — so a
  // restart that closed the tab first would have ended the conversation for a
  // session that could never have come back. Everything that can be refused is
  // settled before Orca is asked to take anything away.
  const box = await createSandbox(t);
  const bots = await madeBot(box);
  await up(box);
  const before = await liveTab(box, bots, 'api-bot', 'daily');
  await reported(box, bots, 'api-bot', before.tabId, 'sess-1');
  await editBotSession(bots, 'api-bot', 'daily', { approval: 'nonsense' });
  const terminals = await box.orca.terminals();
  const from = (await box.orca.calls()).length;

  const result = await box.run(['restart', '--bots', 'bots', '--bot', 'api-bot']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('nonsense'), `the message should name what is wrong, got: ${result.stderr}`);
  assert.ok(result.stderr.includes('daily'), `and the session it is wrong in, got: ${result.stderr}`);

  const calls = await since(box, from);
  assert.deepEqual(closes(calls), [], 'nothing may be closed for a session that could not be started again');
  assert.deepEqual(creates(calls), [], 'and nothing opened');
  assert.deepEqual(await box.orca.terminals(), terminals, 'the session is left running where it was');
  const entry = await sessionIn(bots, 'api-bot', 'daily');
  assert.equal(entry.tab, before.tabId, `and the book unchanged, got: ${JSON.stringify(entry)}`);
  assert.equal(entry.session, 'sess-1', 'conversation included');
});

test('R13 a bot whose hook file cannot be read is refused before anything is closed', async (t) => {
  // The other half of the same rule, and the one that is not about the session
  // at all: the kit puts its session hook into the bot's own harness settings
  // before any tab is opened (ADR 0020), and a file it cannot read as JSON
  // stops the run. That preparation belongs before the close for the same
  // reason the launch checks do.
  const box = await createSandbox(t);
  const bots = await madeBot(box);
  await up(box);
  const before = await liveTab(box, bots, 'api-bot', 'daily');
  await reported(box, bots, 'api-bot', before.tabId, 'sess-1');
  const hooks = hookFileOf(bots, 'api-bot', 'claude');
  await writeFile(hooks, 'this is not JSON, and it is the user\'s\n');
  const terminals = await box.orca.terminals();
  const from = (await box.orca.calls()).length;

  const result = await box.run(['restart', '--bots', 'bots', '--bot', 'api-bot']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes(hooks), `the message should name the file, got: ${result.stderr}`);

  const calls = await since(box, from);
  assert.deepEqual(closes(calls), [], 'a run that cannot prepare the bot may not close its tabs');
  assert.deepEqual(creates(calls), [], 'and opens nothing');
  assert.deepEqual(await box.orca.terminals(), terminals, 'the session is left running where it was');
  assert.equal((await sessionIn(bots, 'api-bot', 'daily')).tab, before.tabId, 'and the book unchanged');
});

test('R14 a close the listing is slow to agree with still ends with the session in a new tab', async (t) => {
  // Orca answers `terminal close` before `terminal list` stops reporting the
  // tab — seen live on a busy machine, and both system tests poll for it. A
  // restart that lists straight away finds the tab it has just closed, takes it
  // for a session that is still up, and leaves the user with no session at all.
  //
  // The lag here is counted in listings, not in seconds, so this does not
  // depend on how fast anything runs: two more listings carry the tab, and any
  // implementation that looks again at all gets past it.
  const box = await createSandbox(t);
  const bots = await madeBot(box);
  await up(box);
  const before = await liveTab(box, bots, 'api-bot', 'daily');
  await reported(box, bots, 'api-bot', before.tabId, 'sess-1');
  await box.orca.set({ closeLag: 2 });
  const from = (await box.orca.calls()).length;

  const result = await box.run(['restart', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(result.code, 0, result.stderr);
  const calls = await since(box, from);
  assert.equal(closes(calls).length, 1, 'one close, as ever');
  assert.equal(creates(calls).length, 1, 'and the session comes back in a tab of its own');

  const after = await liveTab(box, bots, 'api-bot', 'daily');
  assert.notEqual(after.tabId, before.tabId, 'the tab Orca was still listing is not the tab that came back');
  assert.deepEqual(typedInto(after.terminal).map(tokenless), [resumeLine(box, 'sess-1')], 'with the conversation the book held');
  const entry = await sessionIn(bots, 'api-bot', 'daily');
  assert.equal(entry.tab, after.tabId, 'and the book holds the new tab');
  assert.equal(entry.session, 'sess-1');
});

test('R14 a listing that never agrees stops the run rather than reporting the old tab as the new one', async (t) => {
  // The same lag, never catching up. There is nothing the kit can do about
  // that, and two things it must not do: say the session came back when it did
  // not, and type a harness into a tab Orca has closed. So the run stops and
  // says which tab it is waiting on.
  const box = await createSandbox(t);
  const bots = await madeBot(box);
  await up(box);
  const before = await liveTab(box, bots, 'api-bot', 'daily');
  await reported(box, bots, 'api-bot', before.tabId, 'sess-1');
  await box.orca.set({ closeLag: 100000 });
  const from = (await box.orca.calls()).length;

  const result = await box.run(['restart', '--bots', 'bots', '--bot', 'api-bot']);

  assertCleanFailure(result);
  assert.ok(
    result.stderr.includes(before.tabId) || result.stderr.includes(before.handle),
    `the message should name the tab it is waiting on, got: ${result.stderr}`,
  );

  const calls = await since(box, from);
  assert.equal(closes(calls).length, 1, 'it asked for the close');
  assert.deepEqual(creates(calls), [], 'and opened nothing, rather than report the old tab as the new one');
  assert.equal(
    (await sessionIn(bots, 'api-bot', 'daily')).session,
    'sess-1',
    'and the conversation is still in the book, which is the only way back to it',
  );
});

test('R13 a bot whose rules will not build is refused before anything is closed', async (t) => {
  // The third door into the same rule, and the one neither case above goes
  // through: nothing here throws. `up` simply does not start the sessions of a
  // bot with no instructions — a bot comes up with its rules or not at all —
  // so a restart that closed first would end the conversation and then find it
  // has nowhere to put the session back, with nothing having gone wrong
  // anywhere it was looking.
  //
  // Both halves are needed to reach it: the file is gone, and the build cannot
  // write it again because the bot's rules list names a unit that is not there.
  // Either alone leaves the bot able to come up.
  const box = await createSandbox(t);
  const bots = await madeBot(box);
  await up(box);
  const before = await liveTab(box, bots, 'api-bot', 'daily');
  await reported(box, bots, 'api-bot', before.tabId, 'sess-1');
  await rm(agentsOf(bots, 'api-bot'));
  await addRules(path.join(botHomeOf(bots, 'api-bot'), 'bot.yaml'), 'no-such-unit');
  const terminals = await box.orca.terminals();
  const from = (await box.orca.calls()).length;

  const result = await box.run(['restart', '--bots', 'bots', '--bot', 'api-bot']);

  // The calls first, because this is what the case is about: a run that cannot
  // put the session back must not take it away.
  const calls = await since(box, from);
  assert.deepEqual(
    closes(calls),
    [],
    'a bot that cannot come up must not have its tabs closed.'
    + ` The run ended ${result.code} and said: ${JSON.stringify(result.stdout + result.stderr)}`,
  );
  assert.deepEqual(creates(calls), [], 'and nothing is opened either');

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('api-bot'), `the message should name the bot, got: ${result.stderr}`);
  assert.ok(
    result.stderr.includes('no-such-unit'),
    `and what is wrong with its rules, which is what the user has to put right, got: ${result.stderr}`,
  );

  assert.deepEqual(await box.orca.terminals(), terminals, 'the session is left running where it was');
  const entry = await sessionIn(bots, 'api-bot', 'daily');
  assert.equal(entry.tab, before.tabId, `and the book unchanged, got: ${JSON.stringify(entry)}`);
  assert.equal(entry.session, 'sess-1', 'conversation included');
});
