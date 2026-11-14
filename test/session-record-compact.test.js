// `obk session record` after a compaction (#765).
//
// The requirement: after a compaction of a session, the kit gives the session
// its start prompt again, as it does after a clear, and the prompt is in the
// session's context once, not twice.
//
// A compaction keeps the session id, so the id rule of session-record.test.js
// cannot see it. The harness says it in its `source` word: `compact`. The
// compaction drops the first message, which is the start prompt, and the hook
// fires once after it. So the prompt given on `compact` is the one copy in the
// context.
//
// A resume keeps the conversation and its first message, so it still gets
// nothing. A clear still gets the prompt. The book keeps the same id and the
// same history, because a compaction ends no conversation.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  bookOf,
  createSandbox,
  recordSession,
  sessionIn,
  tabsOfBot,
} from './helpers/cli.js';

const PROMPT = 'Read your AGENTS.md and keep the queue moving.';

/** A bots folder holding one bot on `harness` with the sessions given, brought up. */
async function fleet(box, { bot = 'api-bot', harness = 'claude', sessions = [['daily', []]] } = {}) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness])).code, 0);
  for (const [name, settings = []] of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', name, ...settings]);
    assert.equal(added.code, 0, added.stderr);
  }
  const up = await box.run(['up', '--bots', 'bots', '--bot', bot, '--json']);
  assert.equal(up.code, 0, up.stderr);

  const bots = box.path('bots');
  const answer = JSON.parse(up.stdout);
  return { bots, bot, tabs: Object.fromEntries(answer.tabs.map((entry) => [entry.name, entry])) };
}

/** A run that said nothing and did nothing. */
function assertQuiet(result) {
  assert.equal(result.code, 0, `the hook must never fail the session it runs in: ${result.stderr}`);
  assert.equal(result.stdout, '', `the hook must print no answer here, got: ${result.stdout}`);
  assert.equal(result.stderr, '', `the hook must print nothing on the screen, got: ${result.stderr}`);
}

/**
 * The additionalContext the hook gave, or undefined when it printed nothing.
 * `event` is the event the harness sent; the answer must echo it.
 */
function answerOf(result, event = 'SessionStart') {
  assert.equal(result.code, 0, result.stderr);
  if (result.stdout === '') return undefined;
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    assert.fail(`the hook's answer must be JSON, got: ${result.stdout} (${error.message})`);
  }
  assert.deepEqual(Object.keys(answer), ['hookSpecificOutput'], `got: ${result.stdout}`);
  assert.equal(answer.hookSpecificOutput.hookEventName, event, 'the answer names the event the harness sent');
  return answer.hookSpecificOutput.additionalContext;
}

test('a compaction under the same id gives back the same start prompt that a clear gives, work-dir note included', async (t) => {
  const box = await createSandbox(t);
  const prompt = `Read your AGENTS.md. ${'x'.repeat(200)}`;
  const { bots, tabs } = await fleet(box, { sessions: [['daily', [`--prompt=${prompt}`, '--work-dir', 'work/api']]] });
  const held = await readFile(tabs.daily.promptFile, 'utf8');
  assert.ok(held.includes(path.join('work', 'api')), `the prompt file should carry the work-dir note, got: ${held}`);
  const tab = tabs.daily.tabId;
  await recordSession(box, { bots, bot: 'api-bot', tab, session: 'sess-A', source: 'startup' });

  const compacted = await recordSession(box, { bots, bot: 'api-bot', tab, session: 'sess-A', source: 'compact' });
  const cleared = await recordSession(box, { bots, bot: 'api-bot', tab, session: 'sess-B', source: 'clear' });

  const afterCompact = answerOf(compacted);
  assert.notEqual(afterCompact, undefined, 'a compacted session lost its start prompt and must get it back');
  assert.equal(afterCompact, answerOf(cleared), 'the text is the same one a clear gives');
  assert.equal(afterCompact, held, 'and it is the start prompt once, with its work-dir note');
});

test('the first id a session reports, on compact, gets the start prompt with its work-dir note, and the id is written down', async (t) => {
  // The book holds no id yet: the hook missed the start. The compaction still
  // dropped the first message, the launch-line prompt included.
  const box = await createSandbox(t);
  const prompt = `Read your AGENTS.md. ${'x'.repeat(200)}`;
  const { bots, tabs } = await fleet(box, { sessions: [['daily', [`--prompt=${prompt}`, '--work-dir', 'work/api']]] });
  const held = await readFile(tabs.daily.promptFile, 'utf8');
  assert.ok(held.includes(path.join('work', 'api')), `the prompt file should carry the work-dir note, got: ${held}`);
  assert.equal('session' in (await sessionIn(bots, 'api-bot', 'daily')), false, 'the book holds no id yet');

  const ran = await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, session: 'sess-A', source: 'compact' });

  assert.equal(answerOf(ran), held, 'the start prompt once, with its work-dir note');
  const daily = await sessionIn(bots, 'api-bot', 'daily');
  assert.equal(daily.session, 'sess-A', 'the id is written down');
  assert.equal('history' in daily, false, `there is no old id to keep, got: ${JSON.stringify(daily.history)}`);
});

test('a compaction answer names the event the harness sent', async (t) => {
  const box = await createSandbox(t);
  const { bots, tabs } = await fleet(box, { sessions: [['daily', ['--prompt', PROMPT]]] });
  const tab = tabs.daily.tabId;
  await recordSession(box, { bots, bot: 'api-bot', tab, session: 'sess-A', source: 'startup' });

  const ran = await recordSession(box, {
    bots, bot: 'api-bot', tab, session: 'sess-A', source: 'compact', event: 'SessionResumed',
  });

  assert.equal(answerOf(ran, 'SessionResumed'), PROMPT);
});

test('a resume under the same id after a startup gives nothing', async (t) => {
  const box = await createSandbox(t);
  const { bots, tabs } = await fleet(box, { sessions: [['daily', ['--prompt', PROMPT]]] });
  const tab = tabs.daily.tabId;
  await recordSession(box, { bots, bot: 'api-bot', tab, session: 'sess-A', source: 'startup' });

  const ran = await recordSession(box, { bots, bot: 'api-bot', tab, session: 'sess-A', source: 'resume' });

  assert.equal(ran.code, 0, ran.stderr);
  assert.equal(ran.stdout, '', `a resumed session still holds its start prompt, got: ${ran.stdout}`);
});

test('a resume after a compaction gives nothing', async (t) => {
  // The compaction already put the prompt back once. A resume of that
  // conversation keeps it, so a second copy would be the prompt twice.
  const box = await createSandbox(t);
  const { bots, tabs } = await fleet(box, { sessions: [['daily', ['--prompt', PROMPT]]] });
  const tab = tabs.daily.tabId;
  await recordSession(box, { bots, bot: 'api-bot', tab, session: 'sess-A', source: 'startup' });
  await recordSession(box, { bots, bot: 'api-bot', tab, session: 'sess-A', source: 'compact' });

  const ran = await recordSession(box, { bots, bot: 'api-bot', tab, session: 'sess-A', source: 'resume' });

  assert.equal(ran.code, 0, ran.stderr);
  assert.equal(ran.stdout, '', `got: ${ran.stdout}`);
});

test('a clear still gives the start prompt', async (t) => {
  const box = await createSandbox(t);
  const { bots, tabs } = await fleet(box, { sessions: [['daily', ['--prompt', PROMPT]]] });
  const tab = tabs.daily.tabId;
  await recordSession(box, { bots, bot: 'api-bot', tab, session: 'sess-A', source: 'startup' });

  const ran = await recordSession(box, { bots, bot: 'api-bot', tab, session: 'sess-B', source: 'clear' });

  assert.equal(answerOf(ran), PROMPT);
  assert.equal((await sessionIn(bots, 'api-bot', 'daily')).session, 'sess-B');
});

test('a compaction under the same id keeps the book id and adds no history entry', async (t) => {
  const box = await createSandbox(t);
  const { bots, tabs } = await fleet(box, { sessions: [['daily', ['--prompt', PROMPT]]] });
  const tab = tabs.daily.tabId;
  await recordSession(box, { bots, bot: 'api-bot', tab, session: 'sess-A', source: 'startup' });

  const ran = await recordSession(box, { bots, bot: 'api-bot', tab, session: 'sess-A', source: 'compact' });

  assert.equal(ran.code, 0, ran.stderr);
  const daily = await sessionIn(bots, 'api-bot', 'daily');
  assert.equal(daily.session, 'sess-A', 'a compaction ends no conversation, so the id stays');
  assert.equal('history' in daily, false, `a compaction has no old id to keep, got: ${JSON.stringify(daily.history)}`);
});

test('a compaction keeps the history that a clear made, as it was', async (t) => {
  const box = await createSandbox(t);
  const { bots, tabs } = await fleet(box, { sessions: [['daily', ['--prompt', PROMPT]]] });
  const tab = tabs.daily.tabId;
  await recordSession(box, { bots, bot: 'api-bot', tab, session: 'sess-A', source: 'startup' });
  await recordSession(box, { bots, bot: 'api-bot', tab, session: 'sess-B', source: 'clear' });
  const before = await sessionIn(bots, 'api-bot', 'daily');

  await recordSession(box, { bots, bot: 'api-bot', tab, session: 'sess-B', source: 'compact' });

  const after = await sessionIn(bots, 'api-bot', 'daily');
  assert.equal(after.session, 'sess-B');
  assert.deepEqual(after.history, before.history, 'the history is the same, with no entry for the compaction');
  assert.deepEqual(after.history.map((old) => [old.session, old.ended]), [['sess-A', 'clear']]);
});

test('two compactions in a row each give the start prompt', async (t) => {
  // Each compaction drops the copy that the one before it put back.
  const box = await createSandbox(t);
  const { bots, tabs } = await fleet(box, { sessions: [['daily', ['--prompt', PROMPT]]] });
  const tab = tabs.daily.tabId;
  await recordSession(box, { bots, bot: 'api-bot', tab, session: 'sess-A', source: 'startup' });

  const first = await recordSession(box, { bots, bot: 'api-bot', tab, session: 'sess-A', source: 'compact' });
  const second = await recordSession(box, { bots, bot: 'api-bot', tab, session: 'sess-A', source: 'compact' });

  assert.equal(answerOf(first), PROMPT, 'the first compaction');
  assert.equal(answerOf(second), PROMPT, 'the second compaction');
  const daily = await sessionIn(bots, 'api-bot', 'daily');
  assert.equal(daily.session, 'sess-A');
  assert.equal('history' in daily, false, `got: ${JSON.stringify(daily.history)}`);
});

test('a compaction in a tab that no session owns gives nothing and changes nothing', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await fleet(box, { sessions: [['daily', ['--prompt', PROMPT]]] });
  const before = await readFile(bookOf(bots, 'api-bot'), 'utf8');
  const calls = (await box.orca.calls()).length;

  const ran = await recordSession(box, { bots, bot: 'api-bot', tab: 'tab_nobodys', session: 'sess-A', source: 'compact' });

  assertQuiet(ran);
  assert.equal(await readFile(bookOf(bots, 'api-bot'), 'utf8'), before, 'the book is exactly as it was');
  assert.equal((await box.orca.calls()).length, calls, 'and the hook made no Orca call');
});

test('a compaction in a tab of another bot gives nothing and changes neither book', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await fleet(box, { bot: 'one-bot', sessions: [['daily', ['--prompt', PROMPT]]] });
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'two-bot', '--harness', 'claude'])).code, 0);
  assert.equal(
    (await box.run(['session', 'add', '--bots', 'bots', '--bot', 'two-bot', '--name', 'daily', '--prompt', PROMPT])).code,
    0,
  );
  assert.equal((await box.run(['up', '--bots', 'bots', '--bot', 'two-bot'])).code, 0);
  const theirs = (await tabsOfBot(box, bots, 'two-bot'))[0];
  await recordSession(box, { bots, bot: 'two-bot', tab: theirs.tabId, session: 'sess-A', source: 'startup' });
  const books = {
    one: await readFile(bookOf(bots, 'one-bot'), 'utf8'),
    two: await readFile(bookOf(bots, 'two-bot'), 'utf8'),
  };

  const ran = await recordSession(box, { bots, bot: 'one-bot', tab: theirs.tabId, session: 'sess-A', source: 'compact' });

  assertQuiet(ran);
  assert.equal(await readFile(bookOf(bots, 'one-bot'), 'utf8'), books.one, 'the bot it was called for keeps its book');
  assert.equal(await readFile(bookOf(bots, 'two-bot'), 'utf8'), books.two, 'and the bot that owns the tab is not reached into');
});
