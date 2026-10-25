// A session moves to another harness (#565).
//
// `obk session change --bots <b> --bot <bot> --session <s> --harness claude|codex`
// is accepted for any session, Bot Father's management session `daily`
// included, and writes `harness: <new>` into the session's entry in bot.yaml.
//
// When the new harness is not the one the session runs on now (its own
// `harness:`, or else the bot's), the session's `model`, `effort` and
// `context` come out of bot.yaml, so the new harness uses its own defaults; a
// setting the same call gives is kept, and judged by the rules `session add`
// judges a new session by. Every other key of the entry stays. The same
// harness changes nothing else. A kept extra argument that sets approval or
// permissions on the new harness is refused, as `--extra-arg` is today, and
// nothing is written.
//
// `session change` does not write the book: the running tab is untouched and
// the book still names the session's conversation. The next time a tab is
// opened for the session (`up`, `restart`, `unpause`), the kit finds that the
// book's conversation is on record with the old harness and not with the new
// one: the new harness starts fresh with the session's duty, and the old id
// goes into the session's history as
// `{ session: <id>, ended: 'harness changed', harness: <old>, at: <when> }`.
//
// HOME is inside every sandbox, so a harness's record of a conversation is a
// file the test plants there (helpers/cli.js `conversationOnRecord`), or leaves
// out.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import {
  addressPattern,
  assertCleanFailure,
  assertKeptWhatTheyWrote,
  bareLaunch,
  bookOf,
  botFatherTabs,
  botHomeOf,
  conversationOnRecord,
  createSandbox,
  nameOnLine,
  orcaCallsOf,
  orcaFlag,
  recordSession,
  sessionIn,
  skipGit,
  snapshot,
  tabsOfBot,
  tokenless,
  typedInto,
} from './helpers/cli.js';
import { listSession } from './helpers/claude-registry.js';
import { botYamlOf } from './helpers/skills.js';

const BOT = 'api-bot';
const PROMPT = 'Read your AGENTS.md and keep the queue moving.';
const OTHER = { claude: 'codex', codex: 'claude' };

/** Conversation ids shaped the way both harnesses shape them. */
const conv = (n) => `0199b2c0-${String(n).padStart(4, '0')}-4444-8888-cccccccccccc`;

// ------------------------------------------------ helpers: bot.yaml

/** A bots folder with api-bot on `harness` and its daily session added with `settings`. */
async function withSession(box, { harness = 'claude', settings = [] } = {}) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', harness]);
  assert.equal(made.code, 0, made.stderr);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily', ...settings]);
  assert.equal(added.code, 0, added.stderr);
  return box.path('bots');
}

/** `obk session change` of `bot`'s session `session`, with the rest of the arguments given. */
const change = (box, rest, { bot = BOT, session = 'daily' } = {}) =>
  box.run(['session', 'change', '--bots', 'bots', '--bot', bot, '--session', session, ...rest]);

/** The one session called `name` in the bot's bot.yaml, as it is written now. */
async function entryOf(bots, name = 'daily', bot = BOT) {
  const sessions = parse(await readFile(botYamlOf(bots, bot), 'utf8')).sessions ?? [];
  const found = sessions.filter((session) => session?.name === name);
  assert.equal(found.length, 1, `one session should be called ${name}, got: ${JSON.stringify(sessions)}`);
  return found[0];
}

/** Write `changes` into one session's entry in bot.yaml, the way a user edits the file by hand. */
async function editEntry(bots, name, changes, bot = BOT) {
  const file = botYamlOf(bots, bot);
  const written = parse(await readFile(file, 'utf8'));
  written.sessions = written.sessions.map((session) => (session.name === name ? { ...session, ...changes } : session));
  await writeFile(file, stringify(written));
}

/** The answer of a `--json` run, parsed. */
function jsonOf(result) {
  assert.equal(result.code, 0, `the run should have gone through, got:\n${result.stdout}${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
}

// ------------------------------------------------ helpers: the running session

/**
 * A bots folder with api-bot on `harness` and a daily session with PROMPT as
 * its duty, brought up once. Its tab is reported.
 */
async function started(box, harness) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', harness])).code, 0);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily', '--prompt', PROMPT]);
  assert.equal(added.code, 0, added.stderr);
  const up = await box.run(['up', '--bots', 'bots', '--bot', BOT, '--json']);
  assert.equal(up.code, 0, up.stderr);
  const bots = box.path('bots');
  const tab = JSON.parse(up.stdout).tabs.find((entry) => entry.name === 'daily');
  return { bots, home: botHomeOf(bots, BOT), tab };
}

/** The hook's report of the conversation a session's tab is running, as the harness makes it. */
const reported = (box, bots, tab, id, { bot = BOT, source = 'startup' } = {}) =>
  recordSession(box, { bots, bot, tab, session: id, source });

/** The session's tab, closed the way a user closes one: Orca simply stops listing it. */
async function closeTab(box, tabId) {
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((terminal) => terminal.tabId !== tabId) });
}

/** Run `obk <command> --bots bots --bot <bot> [...more]`, which must succeed. */
async function ran(box, command, more = [], bot = BOT) {
  const result = await box.run([command, '--bots', 'bots', '--bot', bot, ...more]);
  assert.equal(result.code, 0, `obk ${command} should succeed: ${result.stderr}${result.stdout}`);
  return result;
}

/** The new tab a run's --json reports for `name`. */
function newTabOf(result, name = 'daily') {
  const found = JSON.parse(result.stdout).tabs.filter((entry) => entry.name === name && entry.created === true);
  assert.equal(found.length, 1, `the run should report ${name}'s new tab once, got: ${result.stdout}`);
  return found[0];
}

/** The one line the kit types after a Codex resume, so Orca lists the session (#226). */
const LIST_LINE = 'obk: this session was resumed in a new tab, and this line is only so Orca lists it. Reply "ok"; nothing else is asked.';

/**
 * The line typed into the tab the book now gives `name`, with the token of
 * its Claude address written as `bareLaunch` writes it. A Codex resume is
 * followed by LIST_LINE alone; every other start is that one line.
 */
async function lineOf(box, bots, { bot = BOT, name = 'daily' } = {}) {
  const entry = await sessionIn(bots, bot, name);
  const terminal = (await tabsOfBot(box, bots, bot)).find((one) => one.tabId === entry?.tab);
  assert.ok(terminal, `Orca should have ${name}'s tab ${entry?.tab}`);
  const typed = typedInto(terminal);
  const after = / codex resume /.test(typed[0] ?? '') ? [LIST_LINE] : [];
  assert.deepEqual(typed.slice(1), after, `one line per tab the kit opens, got: ${JSON.stringify(typed)}`);
  return tokenless(typed[0]);
}

/** The line api-bot's daily starts fresh on: its settings, then its duty. */
const freshLine = (box, harness) => `${bareLaunch(box, harness, BOT, 'daily')} -- '${PROMPT}'`;

/** The line api-bot's daily resumes `id` on. */
const resumeLine = (box, harness, id) => (harness === 'claude'
  ? `${bareLaunch(box, 'claude', BOT, 'daily')} --resume ${id}`
  : bareLaunch(box, 'codex', BOT, 'daily').replace(/ codex /, ' codex resume ') + ` ${id}`);

/**
 * The book's entry for `name` holds no conversation, and its history ends
 * with `id`, gone because the harness changed from `was`, stamped within the run.
 */
async function assertHarnessChangedInBook(bots, id, { was, from, to, bot = BOT, name = 'daily' }) {
  const entry = await sessionIn(bots, bot, name);
  assert.equal(entry?.session, undefined, `the book holds no conversation until the new harness reports one, got: ${JSON.stringify(entry)}`);
  const history = entry?.history;
  assert.ok(Array.isArray(history) && history.length > 0, `the old id should have gone into the session's history, got: ${JSON.stringify(entry)}`);
  const last = history.at(-1);
  assert.deepEqual(
    { session: last.session, ended: last.ended, harness: last.harness },
    { session: id, ended: 'harness changed', harness: was },
    `the history ends with the old conversation and the harness it ran on, got: ${JSON.stringify(history)}`,
  );
  const at = String(last.at);
  assert.match(at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, `the time should be ISO 8601, got: ${at}`);
  const stamp = Date.parse(at);
  assert.ok(stamp >= from - 1000 && stamp <= to + 1000, `and it should be the time of the run, got: ${at}`);
}

/** The tab's --json entry says it started fresh because `id` ran on the other harness. */
function assertReportedHarnessChanged(entry, id) {
  assert.equal(entry.resumed, false, `nothing was resumed, got: ${JSON.stringify(entry)}`);
  assert.equal(entry.harnessChanged, id, `the entry names the id that ran on the other harness, got: ${JSON.stringify(entry)}`);
  assert.equal('noConversation' in entry, false, `a conversation on the old harness is not reported as missing, got: ${JSON.stringify(entry)}`);
}

/** The plain report names the old id, the harness it ran on, and that it went into the history. */
function assertSaysHarnessChanged(result, id, was) {
  const lines = result.stdout.split('\n');
  const at = lines.findIndex((line) => line.includes(id));
  assert.ok(at >= 0, `the report should name the book's conversation ${id}, got:\n${result.stdout}`);
  // The id's own line and the one it wraps onto.
  const said = lines.slice(at, at + 2).join(' ');
  assert.ok(said.includes(was), `and say it ran on ${was}, got:\n${result.stdout}`);
  assert.match(said, /history/, `and that it went into the session's history, got:\n${result.stdout}`);
  assert.doesNotMatch(said, /nothing on record/, `it is on record with ${was}, so not reported as missing, got:\n${result.stdout}`);
}

// ================================================ point 1: accepted, written

for (const [from, to] of [['claude', 'codex'], ['codex', 'claude']]) {
  test(`HC1 session change --harness ${to} of a session on ${from} exits 0 and writes harness: ${to} into its entry`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withSession(box, { harness: from });

    const result = await change(box, ['--harness', to]);

    assert.equal(result.code, 0, result.stderr);
    assert.equal((await entryOf(bots)).harness, to);
  });
}

test('HC1 Bot Father\'s management session daily moves to Codex, and the rest of its bot.yaml is kept', async (t) => {
  const box = await createSandbox(t);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const bots = box.path('bots');
  const before = await readFile(botYamlOf(bots, 'bot-father'), 'utf8');

  const result = await change(box, ['--harness', 'codex'], { bot: 'bot-father' });

  assert.equal(result.code, 0, result.stderr);
  assert.equal((await entryOf(bots, 'daily', 'bot-father')).harness, 'codex');
  assertKeptWhatTheyWrote(before, await readFile(botYamlOf(bots, 'bot-father'), 'utf8'), { changed: ['sessions'] });
});

// ================================================ point 2: settings go back to the harness's defaults

test('HC2 a move to another harness takes the session\'s model, effort and context out of bot.yaml', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSession(box, { settings: ['--model', 'sonnet', '--effort', 'high', '--context', '1m'] });

  const result = await change(box, ['--harness', 'codex']);

  assert.equal(result.code, 0, result.stderr);
  const entry = await entryOf(bots);
  for (const key of ['model', 'effort', 'context']) {
    assert.equal(key in entry, false, `${key} goes back to Codex's own default, got: ${JSON.stringify(entry)}`);
  }
});

test('HC2 every other key of the entry stays: prompt, work dir, extra args, approval, a pause mark, a key of the user\'s own', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSession(box);
  await editEntry(bots, 'daily', {
    model: 'sonnet',
    effort: 'high',
    approval: 'ask',
    prompt: PROMPT,
    work_dir: 'work/api',
    extra_args: ['--verbose'],
    paused: true,
    notes: 'keep me',
  });
  const file = botYamlOf(bots, BOT);
  const written = parse(await readFile(file, 'utf8'));
  written.sessions.push({ name: 'review', model: 'opus', effort: 'low' });
  await writeFile(file, stringify(written));

  const result = await change(box, ['--harness', 'codex']);

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await entryOf(bots), {
    name: 'daily',
    harness: 'codex',
    approval: 'ask',
    prompt: PROMPT,
    work_dir: 'work/api',
    extra_args: ['--verbose'],
    paused: true,
    notes: 'keep me',
  });
  assert.deepEqual(await entryOf(bots, 'review'), { name: 'review', model: 'opus', effort: 'low' }, 'the other session is not touched');
});

test('HC2 a setting the same call gives is kept, and the others go back to the default', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSession(box, { settings: ['--model', 'sonnet', '--effort', 'high', '--context', '1m'] });

  const result = await change(box, ['--harness', 'codex', '--model', 'gpt-5', '--context', '200000', '--json']);

  const answer = jsonOf(result);
  const entry = await entryOf(bots);
  assert.equal(entry.harness, 'codex');
  assert.equal(entry.model, 'gpt-5', 'given in the same call, so written');
  assert.equal(entry.context, 200000, 'given in the same call, and written as a number, as session add writes a Codex context');
  assert.equal('effort' in entry, false, `not given, so back to Codex's default, got: ${JSON.stringify(entry)}`);
  assert.deepEqual(answer.moved, { from: 'claude', to: 'codex', defaults: ['effort'] });
});

test('HC2 a setting given with the move is judged by the new harness\'s rules: --context 1m on Codex is refused, and nothing is written', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSession(box, { settings: ['--model', 'sonnet', '--context', '1m'] });
  const before = await snapshot(bots, skipGit);

  const result = await change(box, ['--harness', 'codex', '--context', '1m']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('1m'), `the refusal should name 1m, got: ${result.stderr}`);
  assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
  // The move on its own goes through, so the refusal was about the context.
  const moved = await change(box, ['--harness', 'codex']);
  assert.equal(moved.code, 0, `the move without the context should go through: ${moved.stderr}`);
});

test('HC2 the same harness changes nothing else, and the answer carries no move', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSession(box, { settings: ['--model', 'sonnet', '--effort', 'high', '--context', '1m'] });

  const result = await change(box, ['--harness', 'claude', '--json']);

  const answer = jsonOf(result);
  const entry = await entryOf(bots);
  assert.equal(entry.harness, 'claude');
  assert.equal(entry.model, 'sonnet');
  assert.equal(entry.effort, 'high');
  assert.equal(entry.context, '1m');
  assert.equal('moved' in answer, false, `the harness did not change, so nothing moved, got: ${result.stdout}`);
});

test('HC2 the session\'s own harness, not the bot\'s, is the one it runs on now', async (t) => {
  const box = await createSandbox(t);
  // A Claude bot with a session of its own on Codex.
  const bots = await withSession(box, { harness: 'claude', settings: ['--harness', 'codex', '--model', 'gpt-5', '--effort', 'high'] });

  const same = await change(box, ['--harness', 'codex', '--json']);

  const kept = jsonOf(same);
  assert.equal('moved' in kept, false, `the session already runs on Codex, got: ${same.stdout}`);
  assert.equal((await entryOf(bots)).model, 'gpt-5', 'and its settings stay');

  const back = await change(box, ['--harness', 'claude', '--json']);

  const moved = jsonOf(back);
  assert.deepEqual(moved.moved, { from: 'codex', to: 'claude', defaults: ['model', 'effort'] });
  const entry = await entryOf(bots);
  assert.equal(entry.harness, 'claude');
  assert.equal('model' in entry || 'effort' in entry, false, `got: ${JSON.stringify(entry)}`);
});

// ================================================ point 3: the book is not written

test('HC3 session change --harness leaves the book and the running tab alone, and the book still names the conversation', async (t) => {
  const box = await createSandbox(t);
  const { bots, home, tab } = await started(box, 'claude');
  await reported(box, bots, tab.tabId, conv(1));
  await conversationOnRecord(box, { harness: 'claude', cwd: home, id: conv(1) });
  const book = await readFile(bookOf(bots, BOT), 'utf8');
  const terminals = await box.orca.terminals();
  const calls = (await box.orca.calls()).length;

  const result = await change(box, ['--harness', 'codex']);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(await readFile(bookOf(bots, BOT), 'utf8'), book, 'session change does not write the book');
  assert.equal((await box.orca.calls()).length, calls, 'and does not talk to Orca');
  assert.deepEqual(await box.orca.terminals(), terminals, 'the running tab is untouched');
  assert.equal((await sessionIn(bots, BOT, 'daily')).session, conv(1));
});

// ================================================ point 4: the answer

test('HC4 --json: the session as it now reads, and moved with the settings that went back to the default, in order', async (t) => {
  const box = await createSandbox(t);
  // Given out of order, so the order of the answer is the kit's own.
  const bots = await withSession(box, { settings: ['--context', '1m', '--effort', 'high', '--model', 'sonnet', '--prompt', PROMPT] });
  // What session add wrote (its default approval included), less the three that go back to the default.
  const { model, effort, context, ...kept } = await entryOf(bots);
  assert.deepEqual([model, effort, context], ['sonnet', 'high', '1m'], 'the premise: the session had all three');

  const result = await change(box, ['--harness', 'codex', '--json']);

  const answer = jsonOf(result);
  assert.deepEqual(answer.session, { ...kept, harness: 'codex' });
  assert.deepEqual(answer.moved, { from: 'claude', to: 'codex', defaults: ['model', 'effort', 'context'] });
});

test('HC4 --json: a session with none of those settings moves with an empty list of defaults', async (t) => {
  const box = await createSandbox(t);
  await withSession(box, { harness: 'codex' });

  const result = await change(box, ['--harness', 'claude', '--json']);

  assert.deepEqual(jsonOf(result).moved, { from: 'codex', to: 'claude', defaults: [] });
});

test('HC4 plain text names the new harness, the new conversation, the history, each default and obk restart', async (t) => {
  const box = await createSandbox(t);
  await withSession(box, { settings: ['--model', 'sonnet', '--effort', 'high'] });

  const result = await change(box, ['--harness', 'codex']);

  assert.equal(result.code, 0, result.stderr);
  const said = result.stdout;
  assert.ok(said.includes('codex'), `the report should name the new harness, got:\n${said}`);
  assert.match(said, /new conversation/, `and say the session starts a new conversation there, got:\n${said}`);
  assert.match(said, /history/, `and that the book keeps the old one in the session's history, got:\n${said}`);
  for (const key of ['model', 'effort']) {
    assert.ok(said.includes(key), `and name ${key}, which went back to the default, got:\n${said}`);
  }
  assert.match(said, /obk restart --bots .* --bot api-bot --session daily/, `and give the restart command, got:\n${said}`);
  assert.ok(!said.includes('undefined'), `nothing should be undefined, got:\n${said}`);
});

test('HC4 a harness the kit does not know is refused, and nothing is written', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSession(box, { settings: ['--model', 'sonnet'] });
  const before = await snapshot(bots, skipGit);

  const result = await change(box, ['--harness', 'gemini']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('gemini'), `the refusal should name gemini, got: ${result.stderr}`);
  assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
});

// ================================================ point 5: the next start

/**
 * Bring api-bot up on `was`, have its daily report conv(1) with a record of it
 * on `was`, set the session's harness to `now` in bot.yaml, and leave the
 * session as `command` finds it: tab closed for `up`, paused for `unpause`,
 * running for `restart`.
 */
async function movedThen(box, command, was, now) {
  const { bots, home, tab } = await started(box, was);
  await reported(box, bots, tab.tabId, conv(1));
  await conversationOnRecord(box, { harness: was, cwd: home, id: conv(1) });
  if (command === 'up') await closeTab(box, tab.tabId);
  if (command === 'unpause') await ran(box, 'pause');
  await editEntry(bots, 'daily', { harness: now });
  return { bots, home, tab };
}

for (const [was, now] of [['claude', 'codex'], ['codex', 'claude']]) {
  for (const command of ['up', 'restart', 'unpause']) {
    test(`HC5 ${command} after a move from ${was} to ${now} starts ${now} fresh with the duty, and the old id goes into history`, async (t) => {
      const box = await createSandbox(t);
      const { bots } = await movedThen(box, command, was, now);

      const from = Date.now();
      const result = await ran(box, command, ['--json']);
      const to = Date.now();

      const line = await lineOf(box, bots);
      assert.equal(line, freshLine(box, now), `a fresh ${now} start, told its duty`);
      assert.ok(!line.includes(conv(1)), `the old id is nowhere on the line, got: ${line}`);
      await assertHarnessChangedInBook(bots, conv(1), { was, from, to });
      assertReportedHarnessChanged(newTabOf(result), conv(1));
    });
  }
}

test('HC5 the plain reports of up, restart and unpause say the old conversation ran on the old harness and went into history', async (t) => {
  for (const command of ['up', 'restart', 'unpause']) {
    const box = await createSandbox(t);
    await movedThen(box, command, 'claude', 'codex');

    const result = await ran(box, command);

    assertSaysHarnessChanged(result, conv(1), 'claude');
  }
});

test('HC5 once the new harness reports its own id, the book takes it and the old one stays in history', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await movedThen(box, 'up', 'claude', 'codex');
  const from = Date.now();
  const back = newTabOf(await ran(box, 'up', ['--json']));
  const to = Date.now();

  const own = await reported(box, bots, back.tabId, conv(2));

  assert.equal(own.code, 0, own.stderr);
  const entry = await sessionIn(bots, BOT, 'daily');
  assert.equal(entry.session, conv(2), `the book takes the new harness's id, got: ${JSON.stringify(entry)}`);
  const last = entry.history?.at(-1);
  assert.deepEqual(
    { session: last?.session, ended: last?.ended, harness: last?.harness },
    { session: conv(1), ended: 'harness changed', harness: 'claude' },
    `the old id stays in history, got: ${JSON.stringify(entry)}`,
  );
  const stamp = Date.parse(String(last.at));
  assert.ok(stamp >= from - 1000 && stamp <= to + 1000, `with the time of the up, got: ${last.at}`);
});

test('HC5 an id on record with neither harness keeps today\'s no-conversation path', async (t) => {
  const box = await createSandbox(t);
  const { bots, tab } = await started(box, 'claude');
  await reported(box, bots, tab.tabId, conv(1));
  await closeTab(box, tab.tabId);
  await editEntry(bots, 'daily', { harness: 'codex' });

  const result = await ran(box, 'up', ['--json']);

  assert.equal(await lineOf(box, bots), freshLine(box, 'codex'));
  const entry = newTabOf(result);
  assert.equal(entry.resumed, false);
  assert.equal(entry.noConversation, conv(1), `got: ${JSON.stringify(entry)}`);
  assert.equal('harnessChanged' in entry, false, `nothing on record anywhere is not a harness change, got: ${JSON.stringify(entry)}`);
  const history = (await sessionIn(bots, BOT, 'daily')).history ?? [];
  assert.equal(history.at(-1)?.ended, 'no conversation', `got: ${JSON.stringify(history)}`);
});

for (const [label, records] of [
  ['on record with the session\'s own harness', ['codex']],
  ['on record with both harnesses', ['claude', 'codex']],
]) {
  test(`HC5 an id ${label} is resumed on the session's harness, as today`, async (t) => {
    const box = await createSandbox(t);
    const { bots, home, tab } = await started(box, 'claude');
    await reported(box, bots, tab.tabId, conv(1));
    for (const harness of records) await conversationOnRecord(box, { harness, cwd: home, id: conv(1) });
    await closeTab(box, tab.tabId);
    await editEntry(bots, 'daily', { harness: 'codex' });

    const result = await ran(box, 'up', ['--json']);

    assert.equal(await lineOf(box, bots), resumeLine(box, 'codex', conv(1)));
    const entry = newTabOf(result);
    assert.equal(entry.resumed, true, `got: ${JSON.stringify(entry)}`);
    assert.equal('harnessChanged' in entry, false, `got: ${JSON.stringify(entry)}`);
    const book = await sessionIn(bots, BOT, 'daily');
    assert.equal(book.session, conv(1));
    assert.equal('history' in book, false, `nothing went into history, got: ${JSON.stringify(book)}`);
  });
}

// ================================================ point 6: the whole road

test('HC6 Bot Father daily on Claude: session change --harness codex, then restart, ends on Codex, fresh, with the Claude id in history', async (t) => {
  const box = await createSandbox(t);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const bots = box.path('bots');
  const { inBook: [daily] } = await botFatherTabs(box, bots);
  assert.ok(daily, 'init brings Bot Father\'s daily up');
  const handle = (await box.orca.terminals()).find((one) => one.tabId === daily.tabId)?.handle;
  const ok = await reported(box, bots, daily.tabId, conv(1), { bot: 'bot-father' });
  assert.equal(ok.code, 0, ok.stderr);
  await conversationOnRecord(box, { harness: 'claude', cwd: botHomeOf(bots, 'bot-father'), id: conv(1) });

  const changed = await change(box, ['--harness', 'codex'], { bot: 'bot-father' });
  assert.equal(changed.code, 0, `session change --harness codex should go through: ${changed.stderr}`);
  const calls = (await box.orca.calls()).length;
  const from = Date.now();
  const result = await ran(box, 'restart', ['--session', 'daily', '--json'], 'bot-father');
  const to = Date.now();

  const closed = orcaCallsOf((await box.orca.calls()).slice(calls), 'terminal close');
  assert.equal(closed.length, 1, 'the running tab is closed: the book still named its conversation');
  assert.equal(orcaFlag(closed[0], '--terminal'), handle, 'by its own handle');
  assert.equal((await entryOf(bots, 'daily', 'bot-father')).harness, 'codex');
  const tab = newTabOf(result);
  assert.notEqual(tab.tabId, daily.tabId, 'a new tab');
  // Bot Father's daily has no start prompt: a fresh Codex start is the bare line.
  assert.equal(await lineOf(box, bots, { bot: 'bot-father' }), bareLaunch(box, 'codex', 'bot-father', 'daily'));
  await assertHarnessChangedInBook(bots, conv(1), { was: 'claude', from, to, bot: 'bot-father' });
  assertReportedHarnessChanged(tab, conv(1));
});

test('HC6 a running api-bot session: session change --harness codex, then restart --session, starts Codex fresh with its duty', async (t) => {
  const box = await createSandbox(t);
  const { bots, home, tab } = await started(box, 'claude');
  await reported(box, bots, tab.tabId, conv(1));
  await conversationOnRecord(box, { harness: 'claude', cwd: home, id: conv(1) });

  const changed = await change(box, ['--harness', 'codex']);
  assert.equal(changed.code, 0, `session change --harness codex should go through: ${changed.stderr}`);
  const calls = (await box.orca.calls()).length;
  const from = Date.now();
  const result = await ran(box, 'restart', ['--session', 'daily', '--json']);
  const to = Date.now();

  assert.equal(orcaCallsOf((await box.orca.calls()).slice(calls), 'terminal close').length, 1, 'the running tab is closed');
  assert.equal(await lineOf(box, bots), freshLine(box, 'codex'));
  await assertHarnessChangedInBook(bots, conv(1), { was: 'claude', from, to });
  assertReportedHarnessChanged(newTabOf(result), conv(1));
});

// ================================================ point 7: the usage

/** The block of the usage that a command's line starts, up to the next command's line. */
function usageBlock(usage, command) {
  const lines = usage.split('\n');
  const at = lines.findIndex((line) => line.startsWith(`  obk ${command} `) || line === `  obk ${command}`);
  if (at < 0) return undefined;
  const next = lines.findIndex((line, index) => index > at && line.startsWith('  obk '));
  return lines.slice(at, next < 0 ? undefined : next).join('\n');
}

test('HC7 --help shows --harness on session change, and no longer says a session keeps its harness', async (t) => {
  const box = await createSandbox(t);

  const { stdout: usage } = await box.run(['--help']);

  const block = usageBlock(usage, 'session change');
  assert.notEqual(block, undefined, `usage lists obk session change, got:\n${usage}`);
  assert.ok(block.includes('--harness'), `session change should list --harness, got:\n${block}`);
  assert.ok(!block.replace(/\s+/g, ' ').includes('keeps its harness'), `and not say a session keeps its harness, got:\n${block}`);
});

// ================================================ point 8: kept extra args on the new harness

for (const [from, to, args, named] of [
  ['claude', 'codex', ['--extra-arg=--sandbox', '--extra-arg=workspace-write'], '--sandbox'],
  ['codex', 'claude', ['--extra-arg=--permission-mode', '--extra-arg=plan'], '--permission-mode'],
]) {
  test(`HC8 a kept extra argument that sets approval on ${to} (${named}) refuses the move from ${from}, and nothing is written`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withSession(box, { harness: from, settings: args });
    const before = await snapshot(bots, skipGit);

    const result = await change(box, ['--harness', to]);

    assertCleanFailure(result);
    assert.ok(result.stderr.includes(named), `the refusal should name ${named}, got: ${result.stderr}`);
    assert.ok(result.stderr.includes('permission approval'), `and name obk permission approval, got: ${result.stderr}`);
    assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
  });
}

// An extra_args written by hand as one string is shell text, typed as it
// stands (test/launch-command.test.js). On `session change --harness`, the
// approval check of the extra args a session keeps fails closed on a string
// (the architect's ruling on #565). It takes the string only when the kit
// reads it exactly as a shell will, and then judges its words as it judges a
// list:
//
//   - plain words separated by spaces, each made of letters, digits and
//     , . _ + : @ % / = -, with no = as a word's first character;
//   - text in single quotes, with no control character in it;
//   - text in double quotes, with none of $ ` \ ! and no control character.
//
// Words and quotes may join, as --x='a b'. Anything else is shell syntax the
// kit cannot be sure of: the move is refused with a sentence that says to
// write extra_args as a list, one --extra-arg for each argument, and nothing
// is written. A list is read item by item, as before.

/** A Claude bot's daily, its extra_args set by hand in bot.yaml to `extra`. */
async function withExtraArgs(box, extra) {
  const bots = await withSession(box);
  await editEntry(bots, 'daily', { extra_args: extra });
  assert.deepEqual((await entryOf(bots)).extra_args, extra, 'the premise: bot.yaml holds extra_args as written');
  return bots;
}

/** The move to Codex goes through, and the kept extra_args read as written. */
async function assertMovesAsWritten(box, bots, extra, to = 'codex') {
  const result = await change(box, ['--harness', to]);
  assert.equal(result.code, 0, result.stderr);
  const entry = await entryOf(bots);
  assert.equal(entry.harness, to);
  assert.deepEqual(entry.extra_args, extra, `extra_args are kept as they were written, got: ${JSON.stringify(entry.extra_args)}`);
}

/** Codex's flag that bypasses its approvals and its sandbox. */
const BYPASS = '--dangerously-bypass-approvals-and-sandbox';

// ------------------------------------------------ strings the kit reads for sure

test('HC8a a kept extra_args written as one harmless plain string moves with the session, and stays as written', async (t) => {
  const box = await createSandbox(t);
  const bots = await withExtraArgs(box, '--verbose');

  await assertMovesAsWritten(box, bots, '--verbose');
});

test('HC8d --harness the same as now, with a kept extra_args string, goes through', async (t) => {
  const box = await createSandbox(t);
  const bots = await withExtraArgs(box, '--verbose');

  await assertMovesAsWritten(box, bots, '--verbose', 'claude');
});

for (const [id, form, extra] of [
  ['HC8h', 'a single-quoted path that holds the text --sandbox', "--add-dir '/tmp/a --sandbox b'"],
  ['HC8m', 'a double-quoted value', '--profile "my profile"'],
  ['HC8n', 'a word joined to a quoted value', "--profile='my profile'"],
  // The = is quoted, so zsh does not expand it.
  ['HC8o', 'a quoted = at the start of a word', "--profile '=sh'"],
]) {
  // #567: --add-dir and --profile widen a Codex session's scope, so the kit,
  // once it has read the string, refuses the move.
  test(`${id} a kept extra_args string with ${form} is read, and its --add-dir or --profile refuses the move to Codex, naming obk permission approval, and nothing is written`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withExtraArgs(box, extra);
    const before = await snapshot(bots, skipGit);

    const result = await change(box, ['--harness', 'codex']);

    assertCleanFailure(result);
    assert.ok(result.stderr.includes('permission approval'), `the refusal should name obk permission approval, got: ${result.stderr}`);
    assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
  });
}

for (const [id, form, extra, flag] of [
  ['HC8b', 'in plain words', '--sandbox workspace-write', '--sandbox'],
  ['HC8e', 'in single quotes', `'${BYPASS}'`, BYPASS],
  ['HC8f', 'in double quotes', `"${BYPASS}"`, BYPASS],
  ['HC8l', 'joined to a quoted value', "--ask-for-approval='never'", '--ask-for-approval'],
]) {
  test(`${id} a kept extra_args string with a Codex approval flag ${form} refuses the move by the flag's name, and nothing is written`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withExtraArgs(box, extra);
    const before = await snapshot(bots, skipGit);

    const result = await change(box, ['--harness', 'codex']);

    assertCleanFailure(result);
    assert.ok(result.stderr.includes(flag), `the refusal should name ${flag}, got: ${result.stderr}`);
    assert.ok(result.stderr.includes('permission approval'), `and name obk permission approval, got: ${result.stderr}`);
    assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
  });
}

// ------------------------------------------------ shell syntax the kit cannot be sure of

// One sample of each kind. Those marked "flag" are the bypass flag once a
// shell has read them; the others look harmless. All are refused alike.
for (const [id, kind, extra] of [
  ['HC8g', 'a backslash outside quotes (flag)', `${BYPASS.slice(0, -1)}\\${BYPASS.at(-1)}`],
  ['HC8i', 'a line continuation (flag)', `${BYPASS.slice(0, -1)}\\\n${BYPASS.at(-1)}`],
  ['HC8j', 'a backslash inside double quotes (flag)', `"${BYPASS.slice(0, -1)}\\\n${BYPASS.at(-1)}"`],
  ['HC8k', 'a control character inside single quotes', `'${BYPASS.slice(0, -1)}\\\n${BYPASS.at(-1)}'`],
  ['HC8s1', 'ANSI-C quoting (flag)', `$'${BYPASS.slice(0, -1)}\\x78'`],
  ['HC8s2', 'brace expansion (flag)', '--{dangerously-bypass-approvals-and-sandbox,verbose}'],
  ['HC8s3', 'a command separator (flag)', `--verbose; codex ${BYPASS}`],
  ['HC8s4', 'a variable', '--profile $USER'],
  ['HC8s5', 'a variable inside double quotes', '--profile "$USER"'],
  ['HC8s6', 'a command substitution', '--profile $(whoami)'],
  ['HC8s7', 'backticks', '--profile `whoami`'],
  ['HC8s8', 'a glob', '--add-dir /tmp/*'],
  ['HC8s9', 'a tilde', '--add-dir ~/notes'],
  ['HC8s10', 'a word that starts with =', '--verbose =notes'],
  ['HC8s11', 'a ! inside double quotes', '--profile "mine!"'],
  ['HC8s12', 'a comment', '--verbose # mine'],
  ['HC8s13', 'a tab between words', '--verbose\t--search'],
  ['HC8s14', 'a quote left open', "--profile 'mine"],
  // zsh expands an unquoted = with no character of its word before it, empty
  // quotes included: ''=sh and ""=sh both become /bin/sh.
  ['HC8s15', 'an unquoted = after empty single quotes', "--profile ''=sh"],
  ['HC8s16', 'an unquoted = after empty double quotes', '--profile ""=sh'],
]) {
  test(`${id} a kept extra_args string with ${kind} refuses the move, says to write a list of --extra-arg, and writes nothing`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withExtraArgs(box, extra);
    const before = await snapshot(bots, skipGit);

    const result = await change(box, ['--harness', 'codex']);

    assertCleanFailure(result);
    assert.match(result.stderr, /\blist\b/, `the refusal should say to write extra_args as a list, got: ${result.stderr}`);
    assert.ok(result.stderr.includes('--extra-arg'), `and name --extra-arg, got: ${result.stderr}`);
    assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
  });
}

// ------------------------------------------------ a list

test('HC8c a kept extra_args list with a number in it does not crash the move', async (t) => {
  const box = await createSandbox(t);
  const bots = await withExtraArgs(box, ['--max-turns', 5]);

  await assertMovesAsWritten(box, bots, ['--max-turns', 5]);
});

// ================================================ point 9: no Claude address on another harness

// A Claude session's address (`<bot>.<session>.<token>`, ADR 0053) is the name
// its Claude Code runs under. Once a tab opens the session on another harness,
// nothing answers to that name, so the book holds no address for it, and a
// Claude sender is told the Orca road to its mailbox. Back on Claude, the
// session gets an address of its own again.

/**
 * api-bot's daily brought up on Claude, with a Claude sender beside it in the
 * same approval class, then moved to Codex with `session change` and
 * restarted. Returns the Claude address the book held before the move.
 */
async function movedToCodex(box) {
  const { bots, home, tab } = await started(box, 'claude');
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'sender-bot', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', 'sender-bot', '--name', 'daily'])).code, 0);
  assert.equal((await box.run(['up', '--bots', 'bots', '--bot', 'sender-bot'])).code, 0);
  await reported(box, bots, tab.tabId, conv(1));
  await conversationOnRecord(box, { harness: 'claude', cwd: home, id: conv(1) });
  const address = (await sessionIn(bots, BOT, 'daily')).address;
  assert.match(String(address), addressPattern(BOT, 'daily'), 'the premise: on Claude the book holds an address');

  const changed = await change(box, ['--harness', 'codex']);
  assert.equal(changed.code, 0, `session change --harness codex should go through: ${changed.stderr}`);
  await ran(box, 'restart', ['--session', 'daily']);
  return { bots, home, address };
}

/** `obk message to --to api-bot/daily --from sender-bot/daily`, as JSON. */
async function roadToDaily(box) {
  const result = await box.run(['message', 'to', '--bots', 'bots', '--to', `${BOT}/daily`, '--from', 'sender-bot/daily', '--json']);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('HC9a after the move to Codex and the restart, the book holds no address for the session', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await movedToCodex(box);

  const entry = await sessionIn(bots, BOT, 'daily');

  assert.equal('address' in entry, false, `Codex runs in the tab, so no Claude name answers for it, got: ${JSON.stringify(entry)}`);
});

test('HC9b moved to Codex, restarted, then changed back to Claude with no restart: message to answers the Orca road', async (t) => {
  const box = await createSandbox(t);
  const { bots, address } = await movedToCodex(box);
  const back = await change(box, ['--harness', 'claude']);
  assert.equal(back.code, 0, back.stderr);

  const answer = await roadToDaily(box);

  const entry = await sessionIn(bots, BOT, 'daily');
  assert.deepEqual(
    { transport: answer.transport, address: answer.address },
    { transport: 'orca', address: `run:${entry.mailbox}` },
    `Codex still runs in the tab, so mail to ${address} would reach nobody, got: ${JSON.stringify(answer)}`,
  );
});

test('HC9c a session that then restarts on Claude gets an address of its own again', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await movedToCodex(box);
  // Codex reports its own conversation, so the book names one and restart may close the tab.
  await reported(box, bots, (await sessionIn(bots, BOT, 'daily')).tab, conv(2));
  await conversationOnRecord(box, { harness: 'codex', cwd: home, id: conv(2) });
  assert.equal((await change(box, ['--harness', 'claude'])).code, 0);

  await ran(box, 'restart', ['--session', 'daily']);

  const entry = await sessionIn(bots, BOT, 'daily');
  assert.match(String(entry.address), addressPattern(BOT, 'daily'), `back on Claude the session has an address, got: ${JSON.stringify(entry)}`);
  const terminal = (await tabsOfBot(box, bots, BOT)).find((one) => one.tabId === entry.tab);
  assert.equal(entry.address, nameOnLine(typedInto(terminal)[0]), 'and it is the name its launch line carried');
  // Its new harness is listed live in the sender's Claude registry under that name (#700).
  await listSession(box, bots, BOT);
  const answer = await roadToDaily(box);
  assert.deepEqual({ transport: answer.transport, address: answer.address }, { transport: 'native', address: entry.address });
});
