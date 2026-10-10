// A temporary session makes one temporary session of its own (#464). PRD 6.4
// had said "a temporary session does not make one of its own" (#250, the
// builder's reading); the owner overruled it: a one-time developer session
// starts its own one-time reviewer, and retires it when it is done.
//
// What is held here (retiring, and the cascade it now carries, is in
// temp-cascade.test.js):
//
//   N1  A temporary session makes a temporary session of its own bot from its
//       own tab, with the same `obk temp make`. The book records it
//       `temporary: { maker: <the temporary session>, made }`, as for a
//       long-lived maker.
//   N2  One level only: a session a temporary session made makes none. Its
//       `temp make` is refused with the reason, and nothing is written:
//       bot.yaml, the book, Orca and the start-prompt files as they were.
//   N3  A temporary maker has at most one open temporary session at a time. A
//       second, made while the first is still there, is refused and nothing is
//       written; once the first is retired it can make another. The limit is
//       each temporary maker's own. A long-lived maker keeps no limit.
//   N4  The made session inherits from its temporary maker by today's rules:
//       on the same harness the harness, model, effort, context and approval;
//       on another harness only the approval (#238). `obk temp trust-hooks`
//       run in a temporary maker's tab answers its Codex session's hooks
//       review.
//   N7  Who may retire what does not change: a long-lived session cannot
//       `temp retire` a session its temporary session made.
//   N8  The rule every bot carries (rules/temporary.md, built into AGENTS.md)
//       tells a temporary session it may make one of its own, one at a time,
//       one level only. Its meaning is matched loosely; no sentence is pinned.
//
// The fleet is the one temp-sessions.test.js uses, cut down: temp-bot on
// Codex, its long-lived planner on Claude Code with settings of its own, and
// nightly on the bot's Codex with others. Every temporary maker here is given
// settings that differ from its own maker's, so a kit that walked up to the
// long-lived session for them gets a different session.
//
// Every run is in the sandbox (helpers/cli.js): its own HOME, a fake Orca, and
// fake harnesses on its own PATH. Nothing here reaches the real Orca, a real
// harness, or anything outside the sandbox.

import assert from 'node:assert/strict';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';
import { parse } from 'yaml';

import {
  assertRefused,
  bookIn,
  botHomeOf,
  createSandbox,
  fakeProgram,
  kitLaunchMark,
  orcaCallsOf,
  sentInto,
  sessionIn,
  sh,
  skipGit,
  snapshot,
  tabsOfBot,
  typedInto,
} from './helpers/cli.js';
import { agentsIn, blockIn, headingsIn, sectionsIn } from './helpers/rules.js';
import { CODEX_AFTER_TRUST, CODEX_HOOKS_REVIEW } from './helpers/screens.js';

const BOT = 'temp-bot';

/** The long-lived maker's own start prompt. */
const PLANNER_PROMPT = 'You plan the work on the API and hand it out.';
/** The task a made session is given. */
const TASK = 'Read the open pull request and write down what it changes.';
/** A task long enough that its start prompt goes to the harness from a file beside the bots folder. */
const LONG_TASK = 'Read the open pull request and write down what it changes. '.repeat(10).trim();

const botYaml = (bots, bot) => path.join(botHomeOf(bots, bot), 'bot.yaml');
const readBotYaml = async (bots, bot) => parse(await readFile(botYaml(bots, bot), 'utf8'));

/** One session's entry in a bot's bot.yaml, or undefined. */
async function entryIn(bots, bot, name) {
  const found = ((await readBotYaml(bots, bot)).sessions ?? []).filter((one) => one?.name === name);
  assert.ok(found.length <= 1, `${bot} should hold ${name} once at most, got: ${JSON.stringify(found)}`);
  return found[0];
}

/**
 * The five settings a session runs with, as bot.yaml has them: the harness
 * resolved to the bot's when the entry names none, and approval `auto` when
 * it names none (ADR 0015). A setting left out is left out.
 */
async function settingsOf(bots, bot, name) {
  const doc = await readBotYaml(bots, bot);
  const entry = (doc.sessions ?? []).find((one) => one?.name === name);
  assert.ok(entry, `${bot} should have a session called ${name}, got: ${JSON.stringify(doc.sessions)}`);
  return {
    harness: entry.harness ?? doc.harness,
    model: entry.model,
    effort: entry.effort,
    context: entry.context === undefined ? undefined : String(entry.context),
    approval: entry.approval ?? 'auto',
  };
}

const exists = (file) => stat(file).then(() => true, () => false);

/** The start-prompt file the kit keeps for one session, beside the bots folder. */
const promptFileOf = (bots, bot, name) => path.join(`${bots}.prompts`, `${bot}.${name}.txt`);

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

/**
 * Bot Father, and temp-bot (codex) with planner (claude, opus, xhigh, 1m, ask)
 * and nightly (the bot's codex, gpt-6-sol, low, 200000, auto), brought up.
 */
async function fleet(box) {
  const ok = async (args) => {
    const result = await box.run(args);
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  };
  await ok(['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'codex']);
  await ok([
    'session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'planner',
    '--harness', 'claude', '--model', 'opus', '--effort', 'xhigh', '--context', '1m',
    '--prompt', PLANNER_PROMPT,
  ]);
  // #527: a session's approval is set by `obk permission approval`, not by session add.
  await ok(['permission', 'approval', '--bots', 'bots', '--bot', BOT, '--session', 'planner', '--approval', 'ask']);
  await ok([
    'session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'nightly',
    '--model', 'gpt-6-sol', '--effort', 'low', '--context', '200000',
    '--prompt', 'You watch the nightly build.',
  ]);
  await ok(['permission', 'approval', '--bots', 'bots', '--bot', BOT, '--session', 'nightly', '--approval', 'auto']);
  await ok(['up', '--bots', 'bots', '--bot', BOT]);
  const bots = box.path('bots');
  return {
    bots,
    planner: await liveTab(box, bots, BOT, 'planner'),
    nightly: await liveTab(box, bots, BOT, 'nightly'),
  };
}

/** `obk temp make`, run inside `terminal`. */
const make = (box, terminal, args) => box.run(['temp', 'make', '--bots', 'bots', ...args], { env: inTab(box, terminal) });

/** `obk temp retire`, the same way. */
const retireTemp = (box, terminal, args) => box.run(['temp', 'retire', '--bots', 'bots', ...args], { env: inTab(box, terminal) });

/** `obk temp make` that must work. */
async function made(box, terminal, args) {
  const result = await make(box, terminal, args);
  assert.equal(result.code, 0, `obk temp make ${args.join(' ')} should have worked:\n${result.stdout}${result.stderr}`);
  return result;
}

/** The fleet, with scout made by planner and reviewer made by scout. */
async function nested(box) {
  const found = await fleet(box);
  const { bots, planner } = found;
  await made(box, planner, ['--name', 'scout', '--prompt', LONG_TASK]);
  const scout = await liveTab(box, bots, BOT, 'scout');
  await made(box, scout, ['--name', 'reviewer', '--prompt', LONG_TASK]);
  return { ...found, scout, reviewer: await liveTab(box, bots, BOT, 'reviewer') };
}

/** Everything a refusal must leave as it was: the bots folder, and Orca's tabs, mailboxes and projects. */
async function world(box, bots) {
  return {
    files: await snapshot(bots, skipGit),
    terminals: await box.orca.terminals(),
    runs: await box.orca.runs(),
    setups: await box.orca.setups(),
  };
}

const callCount = async (box) => (await box.orca.calls()).length;
const since = async (box, from) => (await box.orca.calls()).slice(from);

/**
 * A make that is refused writes nothing and opens nothing, and leaves no
 * start-prompt file for the name it was asked for. Returns what it said.
 */
async function assertMakeRefused(box, bots, { terminal, name, named = [] }) {
  const before = await world(box, bots);
  const from = await callCount(box);

  const result = await make(box, terminal, ['--name', name, '--prompt', LONG_TASK]);

  assertRefused(result, ...named);
  assert.deepEqual(await world(box, bots), before, 'bot.yaml, the book and Orca are as they were');
  assert.deepEqual(orcaCallsOf(await since(box, from), 'terminal create'), [], 'no tab was opened');
  assert.equal(await exists(promptFileOf(bots, BOT, name)), false, `no start-prompt file is left for ${name}`);
  return `${result.stdout}${result.stderr}`;
}

/** The --json answer, which is JSON and nothing else. */
function answerIn(result) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout}${result.stderr} (${error.message})`);
  }
}

/** Every object anywhere under a value. */
function objectsIn(value) {
  if (Array.isArray(value)) return value.flatMap(objectsIn);
  if (value !== null && typeof value === 'object') return [value, ...Object.values(value).flatMap(objectsIn)];
  return [];
}

/** A time the kit wrote, as an ISO string no earlier than `from` and no later than `to`. */
function assertWhen(value, from, to, what) {
  assert.equal(typeof value, 'string', `${what} should be an ISO time, got: ${JSON.stringify(value)}`);
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, `${what} should be an ISO time, got: ${value}`);
  const at = Date.parse(value);
  assert.ok(at >= from && at <= to, `${what} should be the time of the run, got: ${value}`);
}

/** Now, to the whole second below, which is as fine as an ISO time the kit writes may be. */
const nowFloor = () => Math.floor(Date.now() / 1000) * 1000;

/** The arguments a shell running `line` hands the fake harness. */
async function argvOf(box, line, fake) {
  const ran = await sh(line, { cwd: box.cwd, env: box.env });
  assert.equal(ran.code, 0, `the line should run: ${line}\n${ran.stderr}`);
  const calls = await fake.calls();
  assert.equal(calls.length, 1, `the line should start the harness once, got: ${line}`);
  return calls[0].args;
}

// ------------------------------------------------------------ N1 making one

test('N1 a temporary session makes one of its own from its own tab: in bot.yaml, its own tab and mailbox, and the book names the temporary session as its maker', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);
  await made(box, planner, ['--name', 'scout', '--prompt', TASK]);
  const scout = await liveTab(box, bots, BOT, 'scout');
  const scoutBefore = await sessionIn(bots, BOT, 'scout');
  const from = nowFloor();

  const result = await made(box, scout, ['--name', 'reviewer', '--prompt', TASK, '--json']);

  const to = Date.now() + 1000;
  const answer = answerIn(result);
  assert.equal(answer.bot, BOT, `got: ${result.stdout}`);
  assert.equal(answer.session, 'reviewer', `got: ${result.stdout}`);
  assert.equal(answer.maker, 'scout', `the answer names scout as the maker, got: ${result.stdout}`);
  assert.ok(await entryIn(bots, BOT, 'reviewer'), 'reviewer is in temp-bot\'s bot.yaml');

  const entry = await sessionIn(bots, BOT, 'reviewer');
  assert.deepEqual(Object.keys(entry?.temporary ?? {}).sort(), ['made', 'maker'], `got: ${JSON.stringify(entry)}`);
  assert.equal(entry.temporary.maker, 'scout', 'its maker is the temporary session that made it, not the long-lived one above it');
  assertWhen(entry.temporary.made, from, to, 'made');
  assert.deepEqual((await sessionIn(bots, BOT, 'scout')).temporary, scoutBefore.temporary, 'scout is still planner\'s, as it was');

  const reviewer = await liveTab(box, bots, BOT, 'reviewer');
  assert.ok(![scout.tabId, planner.tabId].includes(reviewer.tabId), 'a tab of its own');
  assert.equal(typedInto(reviewer).length, 1, `it is started in its tab, got: ${JSON.stringify(typedInto(reviewer))}`);
  const run = (await box.orca.runs()).find((one) => one.id === entry.mailbox);
  assert.equal(run?.coordinator_handle, reviewer.handle, `a mailbox bound to its own tab, got: ${JSON.stringify(run)}`);
  assert.ok(
    objectsIn(answer).some((one) => one.tabId === reviewer.tabId && one.created === true),
    `the answer reports reviewer's tab as made, got: ${result.stdout}`,
  );
});

// ------------------------------------------------------------ N2 one level only

test('N2 a session made by a temporary session makes none: refused with the reason, and nothing is written', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner, reviewer } = await nested(box);
  // drafter is planner's too, and has made nothing: the contrast below.
  await made(box, planner, ['--name', 'drafter', '--prompt', TASK]);
  const drafter = await liveTab(box, bots, BOT, 'drafter');

  const said = await assertMakeRefused(box, bots, { terminal: reviewer, name: 'helper', named: ['reviewer'] });

  assert.match(said, /temporar/i, `the reason says the caller is itself a temporary session's, got:\n${said}`);
  await made(box, drafter, ['--name', 'helper', '--prompt', LONG_TASK]);
  assert.equal((await sessionIn(bots, BOT, 'helper'))?.temporary?.maker, 'drafter', 'the same make from a temporary session one level up works');
});

// ------------------------------------------------------------ N3 one at a time

test('N3 a temporary maker with one open is refused a second, naming the open one, and nothing is written; once that one is retired, it makes another', async (t) => {
  const box = await createSandbox(t);
  const { bots, scout } = await nested(box);

  await assertMakeRefused(box, bots, { terminal: scout, name: 'checker', named: ['reviewer'] });

  const retired = await retireTemp(box, scout, ['--name', 'reviewer']);
  assert.equal(retired.code, 0, `scout retires its own reviewer:\n${retired.stdout}${retired.stderr}`);
  assert.equal(await entryIn(bots, BOT, 'reviewer'), undefined, 'reviewer is off bot.yaml, or the limit has nothing to lift');
  await made(box, scout, ['--name', 'checker', '--prompt', LONG_TASK]);
  assert.equal((await sessionIn(bots, BOT, 'checker'))?.temporary?.maker, 'scout', 'with reviewer retired, scout makes checker');
});

test('N3 the limit is each temporary maker\'s own: two temporary sessions of one maker each have one open at the same time', async (t) => {
  // planner, long-lived, has scout and drafter open; scout has reviewer open.
  const box = await createSandbox(t);
  const { bots, planner } = await nested(box);
  await made(box, planner, ['--name', 'drafter', '--prompt', TASK]);
  const drafter = await liveTab(box, bots, BOT, 'drafter');

  await made(box, drafter, ['--name', 'checker', '--prompt', TASK]);

  const book = await bookIn(bots, BOT);
  assert.equal(book.sessions?.checker?.temporary?.maker, 'drafter');
  assert.equal(book.sessions?.reviewer?.temporary?.maker, 'scout', 'and scout\'s reviewer is still open beside it');
  assert.ok(await entryIn(bots, BOT, 'reviewer') && await entryIn(bots, BOT, 'checker'), 'both are in bot.yaml');
});

// Passes before #464 too: it guards that the limit did not reach long-lived makers.
test('N3 a long-lived maker keeps no limit: it has three temporary sessions open at once', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);

  for (const name of ['scout', 'drafter', 'checker']) await made(box, planner, ['--name', name, '--prompt', TASK]);

  for (const name of ['scout', 'drafter', 'checker']) {
    assert.ok(await entryIn(bots, BOT, name), `${name} is in bot.yaml`);
    assert.equal((await sessionIn(bots, BOT, name))?.temporary?.maker, 'planner');
    await liveTab(box, bots, BOT, name);
  }
});

// ------------------------------------------------------------ N4 what it inherits

test('N4 on its maker\'s harness, it takes its temporary maker\'s harness, model, effort, context and approval, not the long-lived session\'s above it', async (t) => {
  // Two chains, one per harness. scout is planner's on Claude Code with a
  // model, effort and approval of its own; sweeper is nightly's on Codex with
  // a model, effort, context and approval of its own.
  const box = await createSandbox(t);
  const { bots, planner, nightly } = await fleet(box);
  // #527: planner's own approval is ask, and a temporary session wider than its
  // maker's needs the bot's temp_approval to be that wide.
  const widened = await box.run(['permission', 'approval', '--bots', 'bots', '--bot', BOT, '--temps', '--approval', 'auto']);
  assert.equal(widened.code, 0, `temp_approval should be set: ${widened.stdout}${widened.stderr}`);
  await made(box, planner, ['--name', 'scout', '--prompt', TASK, '--model', 'sonnet', '--effort', 'high', '--approval', 'auto']);
  await made(box, nightly, ['--name', 'sweeper', '--prompt', TASK, '--model', 'gpt-6-luna', '--effort', 'medium', '--context', '300000', '--approval', 'ask']);
  assert.deepEqual(
    await settingsOf(bots, BOT, 'scout'),
    { harness: 'claude', model: 'sonnet', effort: 'high', context: '1m', approval: 'auto' },
    'scout is set as asked, or this proves nothing',
  );

  await made(box, await liveTab(box, bots, BOT, 'scout'), ['--name', 'reviewer', '--prompt', TASK]);
  await made(box, await liveTab(box, bots, BOT, 'sweeper'), ['--name', 'helper', '--prompt', TASK]);

  assert.deepEqual(
    await settingsOf(bots, BOT, 'reviewer'),
    { harness: 'claude', model: 'sonnet', effort: 'high', context: '1m', approval: 'auto' },
    'scout\'s settings: not planner\'s opus, xhigh and ask, and not the bot\'s Codex',
  );
  assert.deepEqual(
    await settingsOf(bots, BOT, 'helper'),
    { harness: 'codex', model: 'gpt-6-luna', effort: 'medium', context: '300000', approval: 'ask' },
    'sweeper\'s settings: not nightly\'s gpt-6-sol, low, 200000 and auto',
  );
});

test('N4 on another harness than its temporary maker\'s, it takes only that maker\'s approval (#238)', async (t) => {
  // drafter is nightly's (Codex, gpt-6-sol, low, 200000, auto), made on Claude
  // Code with settings of its own and approval ask; its reviewer goes back to
  // Codex, where it takes none of drafter's Claude settings and none of
  // nightly's Codex ones.
  const box = await createSandbox(t);
  const { bots, nightly } = await fleet(box);
  await made(box, nightly, ['--name', 'drafter', '--prompt', TASK, '--harness', 'claude', '--model', 'sonnet', '--effort', 'high', '--context', '1m', '--approval', 'ask']);

  await made(box, await liveTab(box, bots, BOT, 'drafter'), ['--name', 'reviewer', '--prompt', TASK, '--harness', 'codex']);

  assert.deepEqual(
    await settingsOf(bots, BOT, 'reviewer'),
    { harness: 'codex', model: undefined, effort: undefined, context: undefined, approval: 'ask' },
    'drafter\'s approval, and nothing else of drafter\'s or nightly\'s',
  );
  const [line] = typedInto(await liveTab(box, bots, BOT, 'reviewer'));
  const fake = await fakeProgram(box, 'codex', {});
  const argv = await argvOf(box, line, fake);
  assert.ok(argv.join('\n').includes('-a\non-request'), `Codex asks, as drafter does: ${JSON.stringify(argv)}`);
  const settings = argv.slice(0, -1).join(' ');
  for (const word of [/\bsonnet\b/, /\bhigh\b/, /\b1m\b/, /gpt-6-sol/, /\blow\b/, /\b200000\b/]) {
    assert.doesNotMatch(settings, word, `nothing of drafter's or nightly's settings on the launch line: ${JSON.stringify(argv)}`);
  }
});

/** Down one, then return: from the review's first choice to "Trust all and continue", taken. */
const DOWN_RETURN = '\x1b[B\r';

test('N4 temp trust-hooks run in a temporary maker\'s tab answers its Codex session\'s hooks review', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);
  await made(box, planner, ['--name', 'scout', '--prompt', TASK]);
  const scout = await liveTab(box, bots, BOT, 'scout');
  await made(box, scout, ['--name', 'reviewer', '--prompt', TASK, '--harness', 'codex']);
  const reviewer = await liveTab(box, bots, BOT, 'reviewer');
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((one) => (one.tabId === reviewer.tabId
      ? { ...one, screen: CODEX_HOOKS_REVIEW, screenAfterSend: CODEX_AFTER_TRUST }
      : one)),
  });
  const before = Object.fromEntries((await box.orca.terminals()).map((one) => [one.tabId, sentInto(one).length]));

  const result = await box.run(['temp', 'trust-hooks', '--bots', 'bots', '--name', 'reviewer'], { env: inTab(box, scout) });

  assert.equal(result.code, 0, `scout answers its reviewer's review:\n${result.stdout}${result.stderr}`);
  const sent = Object.fromEntries((await box.orca.terminals())
    .map((one) => [one.tabId, sentInto(one).slice(before[one.tabId] ?? 0)])
    .filter(([, sends]) => sends.length > 0));
  assert.deepEqual(Object.keys(sent), [reviewer.tabId], `keys go into reviewer's tab and no other: ${JSON.stringify(sent)}`);
  assert.equal(sent[reviewer.tabId].map((one) => one.text).join(''), DOWN_RETURN, 'one down, then return');
  assert.match(result.stdout, /Trust all and continue/, `it says what it chose: ${result.stdout}`);
});

// From the review of PR #467: two makes started at once from one temporary
// session both went through, once the book's lock was let go. The race is
// forced the way the reviewer forced it: another writer holds the bot's book
// lock while both makes start, and lets it go a few seconds later, inside the
// ten seconds a writer waits for it (src/book.js), so that both are past their
// start and waiting on the book when it does.

/**
 * How long the lock is held while both makes start: long enough for both to
 * reach it on a loaded machine, short of a writer's 10 s wait. A make cannot
 * finish while the lock is held, so both must still be running when it is let
 * go; one that has already exited means the race was not tried, and the test
 * says so rather than pass.
 */
const HOLD_MS = 8000;

/**
 * Hold a bot's book lock, the way another writer of the book does, until
 * `release` is called: the file SQLite locks, beside the bots folder in
 * `<bots>.locks/<bot home's name>.lock`, taken with `BEGIN IMMEDIATE`.
 */
async function holdBookLock(bots, bot) {
  const file = path.join(`${bots}.locks`, `${encodeURIComponent(bot)}.lock`);
  await mkdir(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('BEGIN IMMEDIATE');
  return {
    release() {
      try {
        db.exec('COMMIT');
      } finally {
        db.close();
      }
    },
  };
}

test('N3 two makes started at once from one temporary session: one is made, the other is refused one at a time and leaves nothing', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);
  await made(box, planner, ['--name', 'dev', '--prompt', TASK]);
  const dev = await liveTab(box, bots, BOT, 'dev');
  const tabsBefore = (await box.orca.terminals()).map((one) => one.tabId);
  const from = await callCount(box);

  const lock = await holdBookLock(bots, BOT);
  let results;
  try {
    const exited = [];
    const both = ['checker-a', 'checker-b'].map((name) => make(box, dev, ['--name', name, '--prompt', LONG_TASK])
      .finally(() => exited.push(name)));
    await sleep(HOLD_MS);
    const early = [...exited];
    lock.release();
    results = await Promise.all(both);
    assert.deepEqual(
      early,
      [],
      `the race was not tried: these makes exited while the book's lock was still held, so they did not wait on it:\n${results.map((result) => `${result.stdout}${result.stderr}`).join('\n----\n')}`,
    );
  } finally {
    try {
      lock.release();
    } catch {
      // Let go already.
    }
  }

  const said = results.map((result) => `${result.stdout}${result.stderr}`);
  const codes = results.map((result) => result.code);
  assert.deepEqual([...codes].sort(), [0, 1], `one make works and the other is refused, got exit codes ${codes}:\n${said.join('\n----\n')}`);
  const [winner, loser] = codes[0] === 0 ? ['checker-a', 'checker-b'] : ['checker-b', 'checker-a'];
  const refused = results[codes.indexOf(1)];
  assertRefused(refused, winner);

  assert.ok(await entryIn(bots, BOT, winner), `${winner} is in bot.yaml`);
  assert.equal((await sessionIn(bots, BOT, winner))?.temporary?.maker, 'dev', `and in the book as dev's`);
  assert.equal(await entryIn(bots, BOT, loser), undefined, `${loser} is not left in bot.yaml`);
  const book = await bookIn(bots, BOT);
  assert.equal(book.sessions?.[loser], undefined, `nor on the book's live list, got: ${JSON.stringify(book.sessions?.[loser])}`);
  assert.deepEqual((book.retired ?? []).filter((one) => one?.name === loser), [], 'nor on its retired list');
  assert.equal(await exists(promptFileOf(bots, BOT, loser)), false, `nor is its start-prompt file, ${promptFileOf(bots, BOT, loser)}`);
  const opened = (await box.orca.terminals()).filter((one) => !tabsBefore.includes(one.tabId));
  assert.deepEqual(opened.map((one) => one.tabId), [(await sessionIn(bots, BOT, winner)).tab], `one new tab in Orca, ${winner}'s`);
  assert.equal(orcaCallsOf(await since(box, from), 'terminal create').length, 1, `and only ${winner}'s tab was ever opened`);
});

// ------------------------------------------------------------ N7 who may retire

/**
 * A `temp retire` that is refused writes nothing and closes nothing: bot.yaml,
 * the book, and every tab, mailbox and project in Orca as they were.
 */
async function assertRetireRefused(box, bots, { terminal, name }) {
  const before = await world(box, bots);
  const from = await callCount(box);

  const result = await retireTemp(box, terminal, ['--name', name]);

  assertRefused(result);
  assert.deepEqual(orcaCallsOf(await since(box, from), 'terminal close'), [], 'no tab was closed');
  assert.deepEqual(await world(box, bots), before, 'bot.yaml, the book and Orca are as they were');
}

test('N7 a long-lived session cannot temp retire the session its temporary session made; that one\'s own maker can', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner, scout } = await nested(box);

  await assertRetireRefused(box, bots, { terminal: planner, name: 'reviewer' });

  const own = await retireTemp(box, scout, ['--name', 'reviewer']);
  assert.equal(own.code, 0, `scout, its maker, retires it:\n${own.stdout}${own.stderr}`);
  assert.equal(await entryIn(bots, BOT, 'reviewer'), undefined, 'reviewer is off bot.yaml');
  assert.ok(await entryIn(bots, BOT, 'scout'), 'and scout, who retired it, is still there');
});

// ------------------------------------------------------------ N8 the rule

/** Text with every run of white space made one space, so a wrapped line reads as one. */
const flat = (text) => text.replace(/\s+/g, ' ').trim();

/** The sentences of a text, wrapped lines joined. */
const sentencesOf = (text) => flat(text).split(/(?<=[.!?])\s+/);

/** A sentence in which a temporary session may make one: "temporary" before the may or can, before "make". */
const TEMPORARY_MAY_MAKE = /\btemporary\b[^.]*\b(?:may|can|is free to|is allowed to)\b[^.]*\bmake\b/i;
/** One at a time, loosely. */
const ONE_AT_A_TIME = /\bone at a time\b|\bat most one\b|\bonly one\b|\bno more than one\b|\bone open\b|\ba single\b/i;
/** One level only, loosely: the one it made makes none. */
const ONE_LEVEL = /\bone level\b|\blevels?\b|\bdeeper\b|\bnest(?:ed|ing)?\b|\bmade by a temporary\b|\bmade by one\b/i;
/** The rule as it stood: a temporary session makes none, said of every temporary session. */
const OLD_BAN = (sentence) => /\ba temporary session makes none\b/i.test(sentence) && !/\bmade by\b/i.test(sentence);

test('N8 the rule every bot carries tells a temporary session it may make one of its own: one at a time, one level only', async (t) => {
  const box = await createSandbox(t);
  for (const args of [
    ['init', '--bots', 'bots', '--harness', 'claude'],
    ['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude'],
  ]) {
    const result = await box.run(args);
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  }

  const body = blockIn(await agentsIn(box.path('bots'), 'api-bot')).body;
  const rule = sectionsIn(body).find((section) => section.heading !== 'Charter' && /\btemp make\b/.test(flat(section.body)));
  assert.ok(rule, `api-bot's AGENTS.md should carry the rule that names temp make, got headings: ${JSON.stringify(headingsIn(body))}`);
  const shown = `## ${rule.heading}\n${rule.body}`;
  const sentences = sentencesOf(rule.body);
  assert.ok(sentences.some((one) => TEMPORARY_MAY_MAKE.test(one)), `the rule should tell a temporary session it may make one of its own, got:\n${shown}`);
  assert.match(flat(rule.body), ONE_AT_A_TIME, `the rule should say one at a time, got:\n${shown}`);
  assert.ok(sentences.some((one) => ONE_LEVEL.test(one)), `the rule should say one level only, got:\n${shown}`);
  assert.deepEqual(sentences.filter(OLD_BAN), [], 'and no longer say that every temporary session makes none');
});
