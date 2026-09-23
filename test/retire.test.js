// `obk retire --bots <path> --bot <bot> [--session <name>]` (PRD 3.2): a session
// or a whole bot taken out of the fleet, with its history kept.
//
// A retired session comes off the bot's `bot.yaml`, its tab is closed, and the
// kit's own start-prompt file for it is deleted. What the book knew about it —
// the conversations it had — is kept in `sessions.yaml` under `retired:`, off
// the live list, because those ids are the only way back to that history
// (ADR 0002). Off the live list means off it everywhere: roster, health and
// usage no longer see a session there, and a new session given the same name
// later is a new conversation, not the old one resumed.
//
// A retired bot has its session tabs closed, its Orca project deleted, and its
// folder moved to `<bots>/retired/<bot>` with its book, charter and memory in
// it. Tabs go first, then the project: a project deleted first leaves tabs no
// command can reach. A tab in the bot's project that the book does not name is
// the user's, and the whole retirement is refused rather than close it.
//
// Bot Father is never retired.

import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import {
  assertCleanFailure,
  bareLaunch,
  bookOf,
  botHomeOf,
  createSandbox,
  orcaCallsOf,
  orcaCommand,
  orcaFlag,
  recordSession,
  sessionIn,
  skipGit,
  snapshot,
  tabsOfBot,
  typedInto,
} from './helpers/cli.js';
import { botYamlOf } from './helpers/skills.js';

/** A duty long enough that the kit leaves it in a file beside the bots folder. */
const LONG_DUTY = 'Watch the queue and say what you see. '.repeat(10);

/** A bots folder with Bot Father and an api-bot carrying the sessions given. */
async function madeBot(box, sessions = [['daily']]) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude'])).code, 0);
  for (const [name, ...settings] of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', name, ...settings]);
    assert.equal(added.code, 0, added.stderr);
  }
  return box.path('bots');
}

async function up(box, bot = 'api-bot') {
  const result = await box.run(['up', '--bots', 'bots', '--bot', bot]);
  assert.equal(result.code, 0, result.stderr);
}

/** The tab the book gives a session, and Orca's own record of it. */
async function liveTab(box, bots, bot, name) {
  const entry = await sessionIn(bots, bot, name);
  assert.equal(typeof entry?.tab, 'string', `the book should hold a tab for ${name}, got: ${JSON.stringify(entry)}`);
  const terminal = (await tabsOfBot(box, bots, bot)).find((one) => one.tabId === entry.tab);
  assert.ok(terminal, `Orca should still have ${name}'s tab ${entry.tab}`);
  return { tabId: entry.tab, handle: terminal.handle, terminal };
}

const since = async (box, from) => (await box.orca.calls()).slice(from);
const closes = (calls) => orcaCallsOf(calls, 'terminal close');
const deletes = (calls) => orcaCallsOf(calls, 'project setup-delete');
const callCount = async (box) => (await box.orca.calls()).length;

const retire = (box, ...rest) => box.run(['retire', '--bots', 'bots', ...rest]);

const exists = (file) => stat(file).then(() => true, () => false);

/** A tab in a project that the book has never heard of: one the user opened. */
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

/** The health check's findings, as JSON. */
async function findings(box) {
  const result = await box.run(['health', '--bots', 'bots', '--json']);
  assert.equal(result.stderr, '', result.stderr);
  return JSON.parse(result.stdout).found;
}
const wordsOf = (finding) => `${finding.where} ${finding.says}`;

/** What the roster says, as JSON. */
async function roster(box) {
  const result = await box.run(['roster', '--bots', 'bots', '--json']);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout).roster;
}

/** A Claude Code conversation planted where the harness files it for `home`, with one call in it. */
async function plantClaude(box, home, id) {
  const file = path.join(box.home, '.claude', 'projects', home.replaceAll(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  const when = '2026-09-20T09:01:00.000Z';
  const lines = [
    { type: 'system', sessionId: id, cwd: home, timestamp: '2026-09-20T09:00:00.000Z' },
    {
      type: 'assistant',
      timestamp: when,
      requestId: `req-${id}`,
      effort: 'high',
      message: {
        id: `msg-${id}`,
        model: 'claude-opus-5',
        usage: { input_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 4 },
      },
    },
  ];
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
  await utimes(file, new Date(when), new Date(when));
}

/** The conversations `obk usage` reports as nobody's under the bot. */
async function unclaimed(box, bot) {
  const result = await box.run(['usage', '--bots', 'bots', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const entry = JSON.parse(result.stdout).usage.find((one) => one.bot === bot);
  return (entry?.unclaimed ?? []).map((one) => one.id).sort();
}

/** Every string anywhere under a value. */
function stringsIn(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(stringsIn);
  return [];
}

// --------------------------------------------------------- retiring a session

/**
 * api-bot with daily (a long duty, so a prompt file, and two conversations: one
 * cleared, one current) and review (one conversation), both up.
 */
async function twoSessionsRunning(box) {
  const bots = await madeBot(box, [['daily', '--prompt', LONG_DUTY], ['review']]);
  await up(box);
  const daily = await liveTab(box, bots, 'api-bot', 'daily');
  const review = await liveTab(box, bots, 'api-bot', 'review');
  await recordSession(box, { bots, bot: 'api-bot', tab: daily.tabId, session: 'sess-old', source: 'startup' });
  await recordSession(box, { bots, bot: 'api-bot', tab: daily.tabId, session: 'sess-now', source: 'clear' });
  await recordSession(box, { bots, bot: 'api-bot', tab: review.tabId, session: 'sess-review' });
  return { bots, daily, review, prompt: path.join(`${bots}.prompts`, 'api-bot.daily.txt') };
}

test('RS1 a retired session\'s tab is closed by its own handle, and only that tab', async (t) => {
  const box = await createSandbox(t);
  const { bots, daily, review } = await twoSessionsRunning(box);
  const from = await callCount(box);

  const result = await retire(box, '--bot', 'api-bot', '--session', 'daily');

  assert.equal(result.code, 0, result.stderr);
  const calls = await since(box, from);
  assert.deepEqual(closes(calls).map((call) => orcaFlag(call, '--terminal')), [daily.handle]);
  assert.deepEqual(deletes(calls), [], 'a session is retired, not the bot: its Orca project stays');
  assert.deepEqual((await tabsOfBot(box, bots, 'api-bot')).map((one) => one.tabId), [review.tabId]);
  for (const call of calls) {
    assert.ok(!call.args.includes('--all'), `orca ${call.args.join(' ')}: --all closes tabs the kit does not own`);
  }
});

test('RS2 the session comes off bot.yaml, and the rest of the file is as it was', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await twoSessionsRunning(box);
  const before = parse(await readFile(botYamlOf(bots, 'api-bot'), 'utf8'));

  const result = await retire(box, '--bot', 'api-bot', '--session', 'daily');

  assert.equal(result.code, 0, result.stderr);
  const after = parse(await readFile(botYamlOf(bots, 'api-bot'), 'utf8'));
  assert.deepEqual(after.sessions, before.sessions.filter((one) => one.name !== 'daily'));
  assert.deepEqual({ ...after, sessions: null }, { ...before, sessions: null }, 'nothing else in bot.yaml moves');
});

test('RS3 the book keeps the retired session\'s conversations under retired:, off the live list', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await twoSessionsRunning(box);
  const started = Math.floor(Date.now() / 1000) * 1000;

  const result = await retire(box, '--bot', 'api-bot', '--session', 'daily');

  assert.equal(result.code, 0, result.stderr);
  const book = parse(await readFile(bookOf(bots, 'api-bot'), 'utf8'));
  assert.equal(book.sessions?.daily, undefined, `daily is off the live list, got: ${JSON.stringify(book.sessions)}`);
  assert.equal(book.sessions?.review?.session, 'sess-review', 'and review is still on it');
  assert.ok(Array.isArray(book.retired), `the book should carry a retired list, got: ${JSON.stringify(book)}`);
  const entries = book.retired.filter((one) => one?.name === 'daily');
  assert.equal(entries.length, 1, `one retired entry for daily, got: ${JSON.stringify(book.retired)}`);
  const held = stringsIn(entries[0]);
  for (const id of ['sess-now', 'sess-old']) {
    assert.ok(held.includes(id), `the conversation ${id} is still in the book, got: ${JSON.stringify(entries[0])}`);
  }
  assert.ok(
    held.some((text) => /^\d{4}-\d{2}-\d{2}T/.test(text) && Date.parse(text) >= started),
    `and when it was retired, got: ${JSON.stringify(entries[0])}`,
  );
});

test('RS4 the kit\'s own start-prompt file for the session is deleted', async (t) => {
  const box = await createSandbox(t);
  const { prompt } = await twoSessionsRunning(box);
  assert.ok(await exists(prompt), `bringing daily up should have left its start prompt at ${prompt}`);

  const result = await retire(box, '--bot', 'api-bot', '--session', 'daily');

  assert.equal(result.code, 0, result.stderr);
  assert.equal(await exists(prompt), false, `${prompt} should be gone`);
});

test('RS5 afterwards roster does not list it, and health reports nothing about it', async (t) => {
  const box = await createSandbox(t);
  const { daily, prompt } = await twoSessionsRunning(box);
  assert.deepEqual(await findings(box), [], 'the fleet starts clean, or the check after means nothing');

  const result = await retire(box, '--bot', 'api-bot', '--session', 'daily');

  assert.equal(result.code, 0, result.stderr);
  const entry = (await roster(box)).find((one) => one.bot === 'api-bot');
  assert.deepEqual(entry.sessions.map((one) => one.name), ['review']);
  const found = await findings(box);
  assert.deepEqual(
    found.filter((one) => wordsOf(one).includes(daily.tabId) || wordsOf(one).includes(prompt) || wordsOf(one).includes('daily')),
    [],
    `no lost tab, no leftover prompt, nothing about daily, got: ${JSON.stringify(found, null, 2)}`,
  );
  assert.deepEqual(found, [], 'and the fleet is as clean as it was');
});

test('RS6 usage does not report the retired session\'s conversations as nobody\'s', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await twoSessionsRunning(box);
  const home = botHomeOf(bots, 'api-bot');
  for (const id of ['sess-old', 'sess-now', 'sess-review', 'conv-nobodys']) await plantClaude(box, home, id);
  assert.deepEqual(await unclaimed(box, 'api-bot'), ['conv-nobodys'], 'only the one no session had, before the retirement');

  const result = await retire(box, '--bot', 'api-bot', '--session', 'daily');

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await unclaimed(box, 'api-bot'), ['conv-nobodys'], 'and still only that one after it');
});

test('RS7 a session added later under the same name starts a new conversation', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await twoSessionsRunning(box);
  const retired = await retire(box, '--bot', 'api-bot', '--session', 'daily');
  assert.equal(retired.code, 0, `the retirement this test stands on did not happen: ${retired.stderr}`);

  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily']);
  assert.equal(added.code, 0, added.stderr);
  await up(box);

  const daily = await liveTab(box, bots, 'api-bot', 'daily');
  assert.deepEqual(
    typedInto(daily.terminal),
    [bareLaunch('claude', 'api-bot', 'daily')],
    'a fresh start, with no resume of the retired session\'s conversation',
  );
  assert.equal((await sessionIn(bots, 'api-bot', 'daily')).session, undefined);
});

test('RS8 retiring a session the bot does not have is refused, and nothing is done', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await twoSessionsRunning(box);
  const before = await snapshot(bots, skipGit);
  const terminals = await box.orca.terminals();

  const result = await retire(box, '--bot', 'api-bot', '--session', 'ghost');

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('ghost'), `got: ${result.stderr}`);
  assert.deepEqual(await snapshot(bots, skipGit), before);
  assert.deepEqual(await box.orca.terminals(), terminals);
});

// ------------------------------------------------------------ retiring a bot

/** api-bot with one session, up, its conversation known, and a note in its memory. */
async function botRunning(box) {
  const bots = await madeBot(box);
  await up(box);
  const daily = await liveTab(box, bots, 'api-bot', 'daily');
  await recordSession(box, { bots, bot: 'api-bot', tab: daily.tabId, session: 'sess-1' });
  const memory = path.join(botHomeOf(bots, 'api-bot'), 'memory', 'notes.md');
  await mkdir(path.dirname(memory), { recursive: true });
  await writeFile(memory, 'Remember: the release is on Friday.\n');
  const [setup] = (await box.orca.setups()).filter((one) => one.path === botHomeOf(bots, 'api-bot'));
  assert.ok(setup, 'up should have made the bot an Orca project');
  return { bots, daily, setup, retired: path.join(bots, 'retired', 'api-bot') };
}

test('RB1 a retired bot\'s tabs are closed by handle, then its Orca project is deleted', async (t) => {
  const box = await createSandbox(t);
  const { bots, daily, setup } = await botRunning(box);
  const from = await callCount(box);

  const result = await retire(box, '--bot', 'api-bot');

  assert.equal(result.code, 0, result.stderr);
  const calls = await since(box, from);
  const closed = closes(calls);
  const deleted = deletes(calls);
  assert.deepEqual(closed.map((call) => orcaFlag(call, '--terminal')), [daily.handle]);
  assert.deepEqual(deleted.map((call) => orcaFlag(call, '--setup')), [setup.id], 'the bot\'s own project, by its setup id');
  assert.ok(calls.indexOf(closed[0]) < calls.indexOf(deleted[0]), 'the tabs go first, the project after');
  assert.equal((await box.orca.setups()).some((one) => one.id === setup.id), false);
  assert.deepEqual(await tabsOfBot(box, bots, 'api-bot'), []);
  for (const call of calls) {
    assert.ok(!call.args.includes('--all'), `orca ${call.args.join(' ')}: --all closes tabs the kit does not own`);
    if (orcaCommand(call) === 'terminal close') assert.equal(orcaFlag(call, '--worktree'), undefined);
  }
});

test('RB7 every tab the book owns is closed before the project goes, even a session bot.yaml no longer lists', async (t) => {
  // From the review of PR 184. The user took daily out of bot.yaml by hand:
  // its tab is still live and the book still names it. The book is what says
  // which tabs are the kit's, so daily's goes too — deleting the project first
  // would leave a tab no command can reach.
  const box = await createSandbox(t);
  const bots = await madeBot(box, [['daily'], ['review']]);
  await up(box);
  const daily = await liveTab(box, bots, 'api-bot', 'daily');
  const review = await liveTab(box, bots, 'api-bot', 'review');
  await recordSession(box, { bots, bot: 'api-bot', tab: daily.tabId, session: 'sess-daily' });
  await recordSession(box, { bots, bot: 'api-bot', tab: review.tabId, session: 'sess-review' });
  const file = botYamlOf(bots, 'api-bot');
  const doc = parse(await readFile(file, 'utf8'));
  doc.sessions = doc.sessions.filter((one) => one.name !== 'daily');
  await writeFile(file, stringify(doc));
  assert.equal((await sessionIn(bots, 'api-bot', 'daily'))?.tab, daily.tabId, 'the book still names daily\'s tab');
  const from = await callCount(box);

  const result = await retire(box, '--bot', 'api-bot');

  assert.equal(result.code, 0, result.stderr);
  const calls = await since(box, from);
  const closed = closes(calls);
  const [deleted] = deletes(calls);
  assert.deepEqual(
    closed.map((call) => orcaFlag(call, '--terminal')).sort(),
    [daily.handle, review.handle].sort(),
    'both tabs the book names, each by its own handle',
  );
  assert.ok(deleted, 'the project is deleted');
  for (const call of closed) {
    assert.ok(calls.indexOf(call) < calls.indexOf(deleted), `${orcaFlag(call, '--terminal')} is closed before the project goes`);
  }
  assert.deepEqual(await tabsOfBot(box, bots, 'api-bot'), [], 'no tab of the bot is left in Orca');
});

test('RB2 the bot\'s folder moves to retired/ with its book, charter and memory in it', async (t) => {
  const box = await createSandbox(t);
  const { bots, retired } = await botRunning(box);
  const charter = parse(await readFile(botYamlOf(bots, 'api-bot'), 'utf8')).charter;

  const result = await retire(box, '--bot', 'api-bot');

  assert.equal(result.code, 0, result.stderr);
  assert.equal(await exists(botHomeOf(bots, 'api-bot')), false, 'the bot is gone from bots/');
  assert.equal(parse(await readFile(path.join(retired, 'bot.yaml'), 'utf8')).charter, charter);
  assert.equal(parse(await readFile(path.join(retired, 'sessions.yaml'), 'utf8')).sessions?.daily?.session, 'sess-1');
  assert.equal(await readFile(path.join(retired, 'memory', 'notes.md'), 'utf8'), 'Remember: the release is on Friday.\n');
});

test('RB3 afterwards roster and up do not know the bot, and health reports no leftover of it', async (t) => {
  const box = await createSandbox(t);
  const { bots, setup } = await botRunning(box);
  assert.deepEqual(await findings(box), [], 'the fleet starts clean, or the check after means nothing');

  const result = await retire(box, '--bot', 'api-bot');

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual((await roster(box)).map((one) => one.bot), ['bot-father']);

  const named = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);
  assertCleanFailure(named);
  assert.ok(named.stderr.includes('api-bot'), `got: ${named.stderr}`);
  const from = await callCount(box);
  const fleet = await box.run(['up', '--bots', 'bots']);
  assert.equal(fleet.code, 0, fleet.stderr);
  assert.deepEqual(orcaCallsOf(await since(box, from), 'terminal create'), [], 'the fleet is up; nothing to open');
  assert.deepEqual(orcaCallsOf(await since(box, from), 'repo add'), [], 'and no project is made for the retired bot');

  const found = await findings(box);
  assert.deepEqual(
    found.filter((one) => wordsOf(one).includes('api-bot') || wordsOf(one).includes(setup.id)),
    [],
    `nothing left over of api-bot, got: ${JSON.stringify(found, null, 2)}`,
  );
});

test('RB4 a bot never brought up is simply moved, and Orca is asked to close or delete nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = await madeBot(box);
  const from = await callCount(box);

  const result = await retire(box, '--bot', 'api-bot');

  assert.equal(result.code, 0, result.stderr);
  const calls = await since(box, from);
  assert.deepEqual(closes(calls), []);
  assert.deepEqual(deletes(calls), []);
  assert.equal(await exists(botHomeOf(bots, 'api-bot')), false);
  assert.ok(await exists(path.join(bots, 'retired', 'api-bot', 'bot.yaml')), 'it is in retired/ now');
});

test('RB5 a tab in the bot\'s project that the book does not name stops the whole retirement', async (t) => {
  const box = await createSandbox(t);
  const { bots, setup } = await botRunning(box);
  const stranger = await strangerIn(box, botHomeOf(bots, 'api-bot'));
  const terminals = await box.orca.terminals();
  const before = await snapshot(bots, skipGit);
  const from = await callCount(box);

  const result = await retire(box, '--bot', 'api-bot');

  assertCleanFailure(result);
  assert.ok(result.stderr.includes(stranger.tabId), `the refusal names the user's tab, got: ${result.stderr}`);
  const calls = await since(box, from);
  assert.deepEqual(closes(calls), [], 'not even the session tab is closed');
  assert.deepEqual(deletes(calls), []);
  assert.deepEqual(await box.orca.terminals(), terminals);
  assert.ok((await box.orca.setups()).some((one) => one.id === setup.id), 'the project is still there');
  assert.deepEqual(await snapshot(bots, skipGit), before, 'and nothing moved on disk');
});

test('RB6 a bot already in retired/ is refused, and nothing is done', async (t) => {
  const box = await createSandbox(t);
  const { bots, retired, setup } = await botRunning(box);
  await mkdir(retired, { recursive: true });
  await writeFile(path.join(retired, 'bot.yaml'), 'name: api-bot\nharness: codex\ncharter: an older api-bot\n');
  const terminals = await box.orca.terminals();
  const before = await snapshot(bots, skipGit);
  const from = await callCount(box);

  const result = await retire(box, '--bot', 'api-bot');

  assertCleanFailure(result);
  assert.ok(result.stderr.includes(retired), `the refusal names what is in the way, got: ${result.stderr}`);
  const calls = await since(box, from);
  assert.deepEqual(closes(calls), []);
  assert.deepEqual(deletes(calls), []);
  assert.deepEqual(await box.orca.terminals(), terminals);
  assert.ok((await box.orca.setups()).some((one) => one.id === setup.id));
  assert.deepEqual(await snapshot(bots, skipGit), before, 'the old retired bot and the live one are both as they were');
});

// ------------------------------------------------------------ both kinds

test('RT1 Bot Father is never retired, whole or a session of it, and nothing is done', async (t) => {
  const box = await createSandbox(t);
  const bots = await madeBot(box);
  const terminals = await box.orca.terminals();
  const setups = await box.orca.setups();
  const before = await snapshot(bots, skipGit);
  const from = await callCount(box);

  for (const args of [['--bot', 'bot-father'], ['--bot', 'bot-father', '--session', 'daily']]) {
    const result = await retire(box, ...args);
    assertCleanFailure(result);
    assert.ok(result.stderr.includes('bot-father'), `got: ${result.stderr}`);
  }
  const calls = await since(box, from);
  assert.deepEqual(closes(calls), []);
  assert.deepEqual(deletes(calls), []);
  assert.deepEqual(await box.orca.terminals(), terminals);
  assert.deepEqual(await box.orca.setups(), setups);
  assert.deepEqual(await snapshot(bots, skipGit), before);
});

test('RT2 retire refuses when Orca is not answering, and nothing is done', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await botRunning(box);
  await box.orca.set({ reachable: false });
  const before = await snapshot(bots, skipGit);

  for (const args of [['--bot', 'api-bot'], ['--bot', 'api-bot', '--session', 'daily']]) {
    const from = await callCount(box);
    const result = await retire(box, ...args);
    assertCleanFailure(result);
    assert.match(result.stderr, /not answering/i, `got: ${result.stderr}`);
    assert.deepEqual((await since(box, from)).map(orcaCommand), ['status']);
  }
  assert.deepEqual(await snapshot(bots, skipGit), before);
  assert.equal((await readdir(bots)).includes('retired'), false, 'and no retired/ folder was made');
});

test('RT3 retire answers --json with JSON and nothing else', async (t) => {
  const box = await createSandbox(t);
  await twoSessionsRunning(box);

  const result = await retire(box, '--bot', 'api-bot', '--session', 'daily', '--json');

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  try {
    JSON.parse(result.stdout);
  } catch (error) {
    assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  assert.ok(result.stdout.includes('api-bot'), `got: ${result.stdout}`);
});
