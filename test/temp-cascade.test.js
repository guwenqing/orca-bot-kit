// Retiring a session retires, first, the temporary sessions it made, and
// theirs (#464). Once a temporary session can make one of its own
// (temp-nested.test.js), a maker retired on its own would leave its made
// session behind with no maker to retire it.
//
//   C5  Retiring a session also retires the temporary sessions it made, and
//       theirs: a long-lived session retired takes its temporary sessions and
//       the ones they made. Whichever road retires it: `obk temp retire`, run
//       by its maker in its tab, or `obk retire --bots … --bot … --session …`.
//       Each one retired along with it is retired as it would be on its own:
//       its tab closed, off bot.yaml, its book entry moved to the book's
//       retired list still carrying its `temporary` maker, its start-prompt
//       file beside the bots folder gone. "First": its tab is closed before
//       its maker's, as the fake Orca's call log shows. Nothing else goes: not
//       the maker's maker, not a sibling, not what a sibling made.
//   C6  The output names what went with it. Plain: a line per session retired
//       along with it, naming it and saying it was retired. `--json`: the
//       answer gains `retiredWith`, one entry per session retired along with
//       the one named, in the order they were retired, deepest first, each
//       `{ bot, session, maker, closed }`, plus `promptsLeft` when its prompt
//       file could not be removed; `[]` when nothing went along. The rest of
//       the answer stays as it was.
//   C7  `obk retire` still retires any session: one a temporary session made,
//       on its own.
//
// Read here, and said in the report to the architect: `closed` in an entry is
// read as it is at the top of today's answer, the tab records closed, so the
// entry is held to naming its session's tab somewhere under `closed`, and no
// more. "Deepest first" is held as: each session before its own maker, and
// the order of `retiredWith` the order the tabs were closed in.
//
// Every run is in the sandbox (helpers/cli.js): its own HOME, a fake Orca, and
// fake harnesses on its own PATH. Nothing here reaches the real Orca, a real
// harness, or anything outside the sandbox.

import assert from 'node:assert/strict';
import { chmod, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import {
  bookIn,
  botHomeOf,
  createSandbox,
  kitLaunchMark,
  orcaCallsOf,
  orcaFlag,
  recordSession,
  sessionIn,
  tabsOfBot,
} from './helpers/cli.js';

const BOT = 'temp-bot';

/** A task long enough that its start prompt goes to the harness from a file beside the bots folder. */
const LONG_TASK = 'Read the open pull request and write down what it changes. '.repeat(10).trim();

const readBotYaml = async (bots, bot) => parse(await readFile(path.join(botHomeOf(bots, bot), 'bot.yaml'), 'utf8'));

/** The names in a bot's bot.yaml. */
const namesIn = async (bots, bot) => ((await readBotYaml(bots, bot)).sessions ?? []).map((one) => one?.name);

const exists = (file) => stat(file).then(() => true, () => false);

/**
 * Where the kit keeps temp-bot's start-prompt files, its own folder beside the
 * bots folder (#534), and one session's file there.
 */
const promptsOf = (bots) => path.join(`${bots}.prompts`, BOT);
const promptFileOf = (bots, bot, name) => path.join(`${bots}.prompts`, bot, `${name}.txt`);

/** Root removes a file whatever its folder's mode, so no prompt file can be left. */
const NEEDS_A_USER = process.getuid?.() === 0
  && 'runs as root, which removes a file whatever its folder\'s mode, so no prompt file can be left';

/** The environment of a command a session's harness runs in `terminal`. */
const inTab = (box, terminal) => ({ ...box.env, ORCA_TERMINAL_HANDLE: terminal.handle, ORCA_TAB_ID: terminal.tabId, ...kitLaunchMark(box, terminal) });

/** The tab the book gives a session, and Orca's own record of it. */
async function liveTab(box, bots, bot, name) {
  const entry = await sessionIn(bots, bot, name);
  assert.equal(typeof entry?.tab, 'string', `the book should hold a tab for ${bot}/${name}, got: ${JSON.stringify(entry)}`);
  const terminal = (await tabsOfBot(box, bots, bot)).find((one) => one.tabId === entry.tab);
  assert.ok(terminal, `Orca should have ${bot}/${name}'s tab ${entry.tab}`);
  return terminal;
}

/** `obk temp make` from `terminal`, which must work. */
async function made(box, terminal, name) {
  const result = await box.run(['temp', 'make', '--bots', 'bots', '--name', name, '--prompt', LONG_TASK], { env: inTab(box, terminal) });
  assert.equal(result.code, 0, `obk temp make --name ${name} should have worked:\n${result.stdout}${result.stderr}`);
}

/** `obk temp retire`, run inside `terminal`. */
const retireTemp = (box, terminal, args) => box.run(['temp', 'retire', '--bots', 'bots', ...args], { env: inTab(box, terminal) });

/** `obk retire`, run from outside any tab. */
const retire = (box, ...args) => box.run(['retire', '--bots', 'bots', '--bot', BOT, ...args]);

/**
 * Bot Father, and temp-bot with two long-lived sessions, planner and nightly,
 * brought up. planner made scout and drafter; scout made reviewer. Each
 * temporary one has a conversation in the book and a start-prompt file.
 *
 *   planner ─┬─ scout ── reviewer
 *            └─ drafter
 *   nightly
 */
async function family(box) {
  const ok = async (args) => {
    const result = await box.run(args);
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  };
  await ok(['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  for (const name of ['planner', 'nightly']) await ok(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', name]);
  await ok(['up', '--bots', 'bots', '--bot', BOT]);
  const bots = box.path('bots');
  const planner = await liveTab(box, bots, BOT, 'planner');
  await made(box, planner, 'scout');
  await made(box, planner, 'drafter');
  const scout = await liveTab(box, bots, BOT, 'scout');
  await made(box, scout, 'reviewer');
  const tabs = { planner, scout, nightly: await liveTab(box, bots, BOT, 'nightly') };
  for (const name of ['drafter', 'reviewer']) tabs[name] = await liveTab(box, bots, BOT, name);
  for (const name of ['scout', 'drafter', 'reviewer']) {
    const reported = await recordSession(box, { bots, bot: BOT, tab: tabs[name].tabId, session: `sess-${name}` });
    assert.equal(reported.code, 0, reported.stderr);
    assert.ok(await exists(promptFileOf(bots, BOT, name)), `${name} should have a start-prompt file, or its going proves nothing`);
  }
  const temporary = {};
  for (const name of ['scout', 'drafter', 'reviewer']) temporary[name] = (await sessionIn(bots, BOT, name)).temporary;
  assert.equal(temporary.reviewer?.maker, 'scout', 'reviewer is scout\'s, or this is not the family at hand');
  return { bots, tabs, temporary };
}

const callCount = async (box) => (await box.orca.calls()).length;

/** The handles of the tabs closed since `from`, in the order they were closed. */
const closedSince = async (box, from) => orcaCallsOf((await box.orca.calls()).slice(from), 'terminal close')
  .map((call) => orcaFlag(call, '--terminal'));

/** The session names of `handles`, by the family's tabs. */
const namesOf = (tabs, handles) => handles.map((handle) => Object.keys(tabs).find((name) => tabs[name].handle === handle) ?? handle);

/** Every string anywhere under a value. */
function stringsIn(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(stringsIn);
  return [];
}

/** The --json answer, which is JSON and nothing else. */
function answerIn(result) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout}${result.stderr} (${error.message})`);
  }
}

/**
 * One session retired in full, as retiring it on its own does: its tab gone
 * from Orca, off bot.yaml, off the book's live list and on its retired list
 * once, with its conversation and its `temporary` as they were, and its
 * start-prompt file gone.
 */
async function assertRetiredInFull(box, bots, { name, tab, temporary, prompt = true }) {
  assert.equal((await box.orca.terminals()).some((one) => one.tabId === tab.tabId), false, `${name}'s tab is closed`);
  assert.ok(!(await namesIn(bots, BOT)).includes(name), `${name} is off bot.yaml`);
  const book = await bookIn(bots, BOT);
  assert.equal(book.sessions?.[name], undefined, `${name} is off the book's live list, got: ${JSON.stringify(book.sessions?.[name])}`);
  const entries = (book.retired ?? []).filter((one) => one?.name === name);
  assert.equal(entries.length, 1, `one retired entry for ${name}, got: ${JSON.stringify(book.retired)}`);
  assert.deepEqual(entries[0].temporary, temporary, `${name}'s retired entry still carries its maker`);
  if (temporary !== undefined) {
    assert.ok(stringsIn(entries[0]).includes(`sess-${name}`), `and keeps its conversation, got: ${JSON.stringify(entries[0])}`);
  }
  if (prompt) assert.equal(await exists(promptFileOf(bots, BOT, name)), false, `${name}'s start-prompt file is gone`);
}

/** One session still as it was: in bot.yaml, on the book's live list, its tab open. */
async function assertStillThere(box, bots, { name, tab }) {
  assert.ok((await namesIn(bots, BOT)).includes(name), `${name} is still in bot.yaml`);
  assert.equal((await sessionIn(bots, BOT, name))?.tab, tab.tabId, `${name} is still on the book's live list, in its tab`);
  assert.ok((await box.orca.terminals()).some((one) => one.tabId === tab.tabId), `${name}'s tab is still open`);
}

/** Whether plain output has a line naming `name` as retired. */
const linesRetiring = (stdout, name) => stdout.split('\n').filter((line) => new RegExp(`\\b${name}\\b`).test(line) && /retir/i.test(line));

// ------------------------------------------------------------ C5 the cascade, both roads

test('C5 temp retire of a temporary session retires the one it made first: its tab closed before its maker\'s, each retired in full', async (t) => {
  const box = await createSandbox(t);
  const { bots, tabs, temporary } = await family(box);
  const from = await callCount(box);

  const result = await retireTemp(box, tabs.planner, ['--name', 'scout']);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.deepEqual(
    namesOf(tabs, await closedSince(box, from)),
    ['reviewer', 'scout'],
    'reviewer\'s tab is closed first, then scout\'s, and no other',
  );
  await assertRetiredInFull(box, bots, { name: 'reviewer', tab: tabs.reviewer, temporary: temporary.reviewer });
  await assertRetiredInFull(box, bots, { name: 'scout', tab: tabs.scout, temporary: temporary.scout });
  for (const name of ['planner', 'nightly', 'drafter']) await assertStillThere(box, bots, { name, tab: tabs[name] });

  assert.ok(linesRetiring(result.stdout, 'reviewer').length > 0, `the output names reviewer as retired with it, got:\n${result.stdout}`);
});

test('C5 obk retire --session of a temporary session retires the one it made first, the same way', async (t) => {
  const box = await createSandbox(t);
  const { bots, tabs, temporary } = await family(box);
  const from = await callCount(box);

  const result = await retire(box, '--session', 'scout');

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.deepEqual(
    namesOf(tabs, await closedSince(box, from)),
    ['reviewer', 'scout'],
    'reviewer\'s tab is closed first, then scout\'s, and no other',
  );
  await assertRetiredInFull(box, bots, { name: 'reviewer', tab: tabs.reviewer, temporary: temporary.reviewer });
  await assertRetiredInFull(box, bots, { name: 'scout', tab: tabs.scout, temporary: temporary.scout });
  for (const name of ['planner', 'nightly', 'drafter']) await assertStillThere(box, bots, { name, tab: tabs[name] });

  assert.ok(linesRetiring(result.stdout, 'reviewer').length > 0, `the output names reviewer as retired with it, got:\n${result.stdout}`);
});

test('C5 obk retire --session of a long-lived session takes its temporary sessions and the ones they made, each before its maker', async (t) => {
  const box = await createSandbox(t);
  const { bots, tabs, temporary } = await family(box);
  const from = await callCount(box);

  const result = await retire(box, '--session', 'planner');

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  const order = namesOf(tabs, await closedSince(box, from));
  assert.deepEqual([...order].sort(), ['drafter', 'planner', 'reviewer', 'scout'], `these four tabs are closed, and no other, got: ${order}`);
  for (const [first, then] of [['reviewer', 'scout'], ['scout', 'planner'], ['drafter', 'planner']]) {
    assert.ok(order.indexOf(first) < order.indexOf(then), `${first}'s tab is closed before ${then}'s, got: ${order}`);
  }
  for (const name of ['reviewer', 'scout', 'drafter']) {
    await assertRetiredInFull(box, bots, { name, tab: tabs[name], temporary: temporary[name] });
  }
  await assertRetiredInFull(box, bots, { name: 'planner', tab: tabs.planner, temporary: undefined, prompt: false });
  await assertStillThere(box, bots, { name: 'nightly', tab: tabs.nightly });

  for (const name of ['reviewer', 'scout', 'drafter']) {
    assert.ok(linesRetiring(result.stdout, name).length > 0, `the output names ${name} as retired with planner, got:\n${result.stdout}`);
  }
});

test('C5 C7 the cascade goes down only: a session that made nothing goes alone, by either road, and its maker stays', async (t) => {
  // obk retire still retires any session, reviewer included; temp retire of
  // drafter, which made nothing, takes nothing with it.
  const box = await createSandbox(t);
  const { bots, tabs, temporary } = await family(box);
  let from = await callCount(box);

  const byRetire = await retire(box, '--session', 'reviewer');

  assert.equal(byRetire.code, 0, `${byRetire.stdout}${byRetire.stderr}`);
  assert.deepEqual(namesOf(tabs, await closedSince(box, from)), ['reviewer'], 'reviewer\'s tab alone is closed');
  await assertRetiredInFull(box, bots, { name: 'reviewer', tab: tabs.reviewer, temporary: temporary.reviewer });
  for (const name of ['planner', 'nightly', 'scout', 'drafter']) await assertStillThere(box, bots, { name, tab: tabs[name] });

  from = await callCount(box);
  const byTemp = await retireTemp(box, tabs.planner, ['--name', 'drafter']);

  assert.equal(byTemp.code, 0, `${byTemp.stdout}${byTemp.stderr}`);
  assert.deepEqual(namesOf(tabs, await closedSince(box, from)), ['drafter'], 'drafter\'s tab alone is closed');
  for (const name of ['planner', 'nightly', 'scout']) await assertStillThere(box, bots, { name, tab: tabs[name] });
});

// The cascade with no temporary session of a temporary session in it, so that
// it can be built on a kit from before #464, where a long-lived session retired
// leaves its temporary sessions behind.
test('C5 C6 obk retire --session of a long-lived session with only temporary sessions of its own takes them too, each before it, and names them in retiredWith', async (t) => {
  const box = await createSandbox(t);
  const ok = async (args) => {
    const result = await box.run(args);
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  };
  await ok(['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  for (const name of ['planner', 'nightly']) await ok(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', name]);
  await ok(['up', '--bots', 'bots', '--bot', BOT]);
  const bots = box.path('bots');
  const tabs = { planner: await liveTab(box, bots, BOT, 'planner'), nightly: await liveTab(box, bots, BOT, 'nightly') };
  const temporary = {};
  for (const name of ['scout', 'drafter']) {
    await made(box, tabs.planner, name);
    tabs[name] = await liveTab(box, bots, BOT, name);
    const reported = await recordSession(box, { bots, bot: BOT, tab: tabs[name].tabId, session: `sess-${name}` });
    assert.equal(reported.code, 0, reported.stderr);
    assert.ok(await exists(promptFileOf(bots, BOT, name)), `${name} should have a start-prompt file, or its going proves nothing`);
    temporary[name] = (await sessionIn(bots, BOT, name)).temporary;
  }
  const from = await callCount(box);

  const result = await retire(box, '--session', 'planner', '--json');

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  const order = namesOf(tabs, await closedSince(box, from));
  assert.deepEqual([...order].sort(), ['drafter', 'planner', 'scout'], `planner's tab and its temporary sessions' are closed, and no other, got: ${order}`);
  for (const name of ['scout', 'drafter']) {
    assert.ok(order.indexOf(name) < order.indexOf('planner'), `${name}'s tab is closed before planner's, got: ${order}`);
    await assertRetiredInFull(box, bots, { name, tab: tabs[name], temporary: temporary[name] });
  }
  await assertRetiredInFull(box, bots, { name: 'planner', tab: tabs.planner, temporary: undefined, prompt: false });
  await assertStillThere(box, bots, { name: 'nightly', tab: tabs.nightly });
  const answer = answerIn(result);
  assert.deepEqual(
    (answer.retiredWith ?? []).map((one) => [one.session, one.maker]),
    order.filter((name) => name !== 'planner').map((name) => [name, 'planner']),
    `retiredWith names scout and drafter, planner's, in the order they were retired, got: ${result.stdout}`,
  );
});

// ------------------------------------------------------------ C6 --json

test('C6 temp retire --json carries retiredWith: [] when nothing went along, and one entry per session that did', async (t) => {
  const box = await createSandbox(t);
  const { tabs } = await family(box);

  const alone = await retireTemp(box, tabs.planner, ['--name', 'drafter', '--json']);

  assert.equal(alone.code, 0, alone.stderr);
  assert.equal(alone.stderr, '');
  assert.deepEqual(answerIn(alone).retiredWith, [], `drafter made nothing, got: ${alone.stdout}`);

  const result = await retireTemp(box, tabs.planner, ['--name', 'scout', '--json']);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  const answer = answerIn(result);
  assert.equal(answer.bot, BOT, `the rest of the answer is as it was, got: ${result.stdout}`);
  assert.equal(answer.session, 'scout', `got: ${result.stdout}`);
  assert.equal(answer.maker, 'planner', `got: ${result.stdout}`);
  assert.ok(Array.isArray(answer.retiredWith), `the answer carries retiredWith, got: ${result.stdout}`);
  assert.equal(answer.retiredWith.length, 1, `one entry, for reviewer, got: ${JSON.stringify(answer.retiredWith)}`);
  const [entry] = answer.retiredWith;
  assert.equal(entry.bot, BOT);
  assert.equal(entry.session, 'reviewer');
  assert.equal(entry.maker, 'scout');
  assert.ok(stringsIn(entry.closed).includes(tabs.reviewer.tabId), `its closed names reviewer's tab ${tabs.reviewer.tabId}, got: ${JSON.stringify(entry)}`);
  assert.equal('promptsLeft' in entry, false, `its prompt file went, so no promptsLeft, got: ${JSON.stringify(entry)}`);
});

test('C6 obk retire --json carries retiredWith in the order they were retired, deepest first', async (t) => {
  const box = await createSandbox(t);
  const { tabs } = await family(box);

  const alone = await retire(box, '--session', 'nightly', '--json');

  assert.equal(alone.code, 0, alone.stderr);
  assert.deepEqual(answerIn(alone).retiredWith, [], `nightly made nothing, got: ${alone.stdout}`);

  const from = await callCount(box);
  const result = await retire(box, '--session', 'planner', '--json');

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  const answer = answerIn(result);
  assert.equal(answer.bot, BOT, `the rest of the answer is as it was, got: ${result.stdout}`);
  assert.equal(answer.session, 'planner', `got: ${result.stdout}`);
  const closed = namesOf(tabs, await closedSince(box, from)).filter((name) => name !== 'planner');
  const sessions = (answer.retiredWith ?? []).map((one) => one.session);
  assert.deepEqual([...sessions].sort(), ['drafter', 'reviewer', 'scout'], `one entry per session retired along, got: ${JSON.stringify(answer.retiredWith)}`);
  assert.deepEqual(sessions, closed, 'in the order their tabs were closed');
  assert.ok(sessions.indexOf('reviewer') < sessions.indexOf('scout'), `reviewer before scout, its maker, got: ${sessions}`);
  const makers = { reviewer: 'scout', scout: 'planner', drafter: 'planner' };
  for (const entry of answer.retiredWith) {
    assert.equal(entry.bot, BOT);
    assert.equal(entry.maker, makers[entry.session], `${entry.session}'s maker, got: ${JSON.stringify(entry)}`);
    assert.ok(stringsIn(entry.closed).includes(tabs[entry.session].tabId), `${entry.session}'s closed names its tab, got: ${JSON.stringify(entry)}`);
  }
});

test('C6 a session retired along whose prompt file cannot be removed is still retired, and its entry carries promptsLeft', { skip: NEEDS_A_USER }, async (t) => {
  const box = await createSandbox(t);
  const { bots, tabs, temporary } = await family(box);
  const folder = promptsOf(bots);
  const mode = (await stat(folder)).mode & 0o7777;

  await chmod(folder, 0o555);
  let result;
  try {
    result = await retire(box, '--session', 'scout', '--json');
  } finally {
    await chmod(folder, mode);
  }

  assert.equal(result.code, 0, `a prompt file left does not stop the retirement:\n${result.stdout}${result.stderr}`);
  const entry = (answerIn(result).retiredWith ?? []).find((one) => one.session === 'reviewer');
  assert.ok(entry, `reviewer is in retiredWith, got: ${result.stdout}`);
  assert.ok(Array.isArray(entry.promptsLeft), `its entry carries promptsLeft, got: ${JSON.stringify(entry)}`);
  assert.deepEqual(entry.promptsLeft.map((one) => one.file), [promptFileOf(bots, BOT, 'reviewer')]);
  assert.equal(typeof entry.promptsLeft[0].reason, 'string');
  await assertRetiredInFull(box, bots, { name: 'reviewer', tab: tabs.reviewer, temporary: temporary.reviewer, prompt: false });
});

// ------------------------------------------------------------ a retire that fails partway

// From the review of PR #467 (P2): a retire whose own close Orca refuses has
// already retired, in full, what went along with it. The run fails, but says
// so: it names each session already retired along with it, and any of their
// prompt files it could not remove, as the run that worked would have. Nothing
// is put back: that session stays retired, the maker stays, and the same
// retire run again, once the close works, finishes.

/**
 * Bot Father, and temp-bot with long-lived lead brought up; lead made
 * dev-two, and dev-two made review-single, which has a conversation and a
 * start-prompt file.
 */
async function chain(box) {
  const ok = async (args) => {
    const result = await box.run(args);
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  };
  await ok(['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  await ok(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'lead']);
  await ok(['up', '--bots', 'bots', '--bot', BOT]);
  const bots = box.path('bots');
  const tabs = { lead: await liveTab(box, bots, BOT, 'lead') };
  await made(box, tabs.lead, 'dev-two');
  tabs['dev-two'] = await liveTab(box, bots, BOT, 'dev-two');
  await made(box, tabs['dev-two'], 'review-single');
  tabs['review-single'] = await liveTab(box, bots, BOT, 'review-single');
  const reported = await recordSession(box, { bots, bot: BOT, tab: tabs['review-single'].tabId, session: 'sess-review-single' });
  assert.equal(reported.code, 0, reported.stderr);
  assert.ok(await exists(promptFileOf(bots, BOT, 'review-single')), 'review-single should have a start-prompt file, or its going proves nothing');
  return { bots, tabs, temporary: (await sessionIn(bots, BOT, 'review-single')).temporary };
}

/** Have the fake Orca refuse every close of one tab, with `--tab` or without, or close it again when `refuse` is false. */
async function refuseClosing(box, tab, refuse = true) {
  const refusal = { code: 'runtime_error', message: 'the tab would not close' };
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((one) => {
      if (one.handle !== tab.handle) return one;
      const { refuseClose: _refuseClose, ...rest } = one;
      return refuse ? { ...rest, refuseClose: { tab: refusal, pane: refusal } } : rest;
    }),
  });
}

/** The lines of a run's output, either stream, that name `name` as retired. */
const retiringLines = (result, name) => `${result.stdout}${result.stderr}`.split('\n')
  .filter((line) => new RegExp(`\\b${name}\\b`).test(line) && /retir/i.test(line));

for (const [road, retireDevTwo] of [
  ['temp retire', (box, tabs) => retireTemp(box, tabs.lead, ['--name', 'dev-two'])],
  ['obk retire --session', (box) => retire(box, '--session', 'dev-two')],
]) {
  test(`C6 ${road} of dev-two that fails on dev-two's own close still names review-single, retired along with it; nothing is put back, and run again it finishes`, async (t) => {
    const box = await createSandbox(t);
    const { bots, tabs, temporary } = await chain(box);
    await refuseClosing(box, tabs['dev-two']);

    const failed = await retireDevTwo(box, tabs);

    const said = `${failed.stdout}${failed.stderr}`;
    assert.notEqual(failed.code, 0, `dev-two's tab would not close, so the run fails, got:\n${said}`);
    assert.ok(!/^\s+at /m.test(said), `a message, not a crash:\n${said}`);
    await assertRetiredInFull(box, bots, { name: 'review-single', tab: tabs['review-single'], temporary });
    await assertStillThere(box, bots, { name: 'dev-two', tab: tabs['dev-two'] });
    assert.ok(
      retiringLines(failed, 'review-single').length > 0,
      `the failed run names review-single as retired along with dev-two, got:\n${said}`,
    );

    await refuseClosing(box, tabs['dev-two'], false);
    const again = await retireDevTwo(box, tabs);

    assert.equal(again.code, 0, `run again with the close working, it finishes:\n${again.stdout}${again.stderr}`);
    assert.ok(!(await namesIn(bots, BOT)).includes('dev-two'), 'dev-two is off bot.yaml');
    assert.equal((await sessionIn(bots, BOT, 'dev-two')), undefined, 'and off the book\'s live list');
    await assertRetiredInFull(box, bots, { name: 'review-single', tab: tabs['review-single'], temporary });
    await assertStillThere(box, bots, { name: 'lead', tab: tabs.lead });
  });
}

test('C6 a temp retire that fails on the maker\'s own close names the prompt file of the session retired along with it that could not be removed', { skip: NEEDS_A_USER }, async (t) => {
  const box = await createSandbox(t);
  const { bots, tabs } = await chain(box);
  await refuseClosing(box, tabs['dev-two']);
  const folder = promptsOf(bots);
  const mode = (await stat(folder)).mode & 0o7777;

  await chmod(folder, 0o555);
  let failed;
  try {
    failed = await retireTemp(box, tabs.lead, ['--name', 'dev-two']);
  } finally {
    await chmod(folder, mode);
  }

  const said = `${failed.stdout}${failed.stderr}`;
  assert.notEqual(failed.code, 0, `dev-two's tab would not close, so the run fails, got:\n${said}`);
  assert.ok(!(await namesIn(bots, BOT)).includes('review-single'), 'review-single was retired along with it, or this is not the case at hand');
  assert.ok(retiringLines(failed, 'review-single').length > 0, `the failed run names review-single as retired, got:\n${said}`);
  assert.ok(said.includes(promptFileOf(bots, BOT, 'review-single')), `and names its prompt file, which could not be removed, got:\n${said}`);
});
