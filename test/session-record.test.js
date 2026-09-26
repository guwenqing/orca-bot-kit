// `obk session record --bots <path> --bot <bot>`: the command the kit's hook
// calls, and the only one a harness runs rather than a person.
//
// It is handed the harness's SessionStart event on standard input — the same
// JSON on both harnesses, proven live: `session_id`, `transcript_path`, `cwd`,
// `hook_event_name` and `source`, where `source` is one of `startup`,
// `resume`, `clear` and `compact` — and it finds out which session it is in
// from `ORCA_TAB_ID`, which Orca puts in the environment of everything running
// in a tab. Those two together are the whole of its input: the book keys on
// the tab id (PRD 6.2), so the tab is what says which session reported.
//
// What it does with them is ADR 0012: the book is the authority for session
// ids. The id the harness gave becomes the session's current one, and the id
// the book held goes into that session's history with the reason it was
// replaced and when — a clear makes a new id every time, and the old ones are
// what recall, auditing and finops read later.
//
// And one thing more: a session that comes back with nothing is given its duty
// again (PRD 6.4). The start prompt is the only thing that says whose session
// it is, and the hook can hand it back through the harness's own
// `additionalContext` answer — proven live on both, a session answering from
// text only the hook gave it.
//
// What says a session came back with nothing is the id: the one it reported is
// not the one the book held for that tab. That is the rule that has to carry
// Codex, because the two harnesses do not agree on a word for it. Claude Code's
// `/clear` reports `source: "clear"` with a new id; Codex has no `/clear` at
// all, and its `/new` fires nothing until the first prompt of the new
// conversation, which arrives as an ordinary `source: "startup"` — with a new
// id (tech notes, section 3). So the source word can never be the test.
//
// It can still be an answer, though, and it is: a harness that says in as many
// words that it cleared is taken at its word, whatever the book held. That
// covers the one case the id cannot see — a book that never learned the first
// id, because the hook was installed late or `obk` was off PATH the once — and
// it cannot fire wrongly, since a clear always brings a new id anyway.
//
// The id rule cannot hand the duty over twice, which is why it needs no other
// guard. `up` puts the prompt on the launch line only when the book holds no
// id, so a session with an id in the book was told nothing by its launch line,
// and a session with none is told nothing here. A first start prints nothing;
// a resume prints nothing, because resuming keeps the id on both harnesses; a
// clear or a `/new` prints the prompt.
//
// The answer echoes the event it was sent rather than naming one itself.
//
// The rule over all of it is that it runs inside the user's own session and
// must never disturb it (ADR 0022). Every input a harness should not send, and
// every one it might, ends the same way: exit 0, nothing printed, the book as
// it was, and not a single call to Orca.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  bookOf,
  createSandbox,
  recordSession,
  sessionIn,
  sessionStart,
  tabsOfBot,
  typedInto,
} from './helpers/cli.js';

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

/** A run that said nothing and did nothing: the hook's only allowed way to fail. */
function assertQuiet(result) {
  assert.equal(result.code, 0, `the hook must never fail the session it runs in: ${result.stderr}`);
  assert.equal(result.stdout, '', `the harness reads standard output as the hook's answer: ${result.stdout}`);
  assert.equal(result.stderr, '', `and nothing belongs on the user's screen either: ${result.stderr}`);
}

/**
 * What the hook printed for the harness to read, or undefined when it printed
 * nothing. `event` is the event the harness sent, which the answer echoes.
 */
function answerOf(result, event = 'SessionStart') {
  assert.equal(result.code, 0, result.stderr);
  if (result.stdout === '') return undefined;
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    assert.fail(`the hook's answer must be the JSON the harness reads, got: ${result.stdout} (${error.message})`);
  }
  assert.deepEqual(
    Object.keys(answer),
    ['hookSpecificOutput'],
    `the answer carries the hook envelope and nothing else, got: ${result.stdout}`,
  );
  assert.equal(answer.hookSpecificOutput.hookEventName, event, 'the answer is about the event it was sent');
  return answer.hookSpecificOutput.additionalContext;
}

test('the harness session id reported for a tab goes into that session in the book', async (t) => {
  const box = await createSandbox(t);
  const { bots, tabs } = await fleet(box);

  const ran = await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, session: 'sess-1' });

  assert.equal(ran.code, 0, ran.stderr);
  const daily = await sessionIn(bots, 'api-bot', 'daily');
  assert.equal(daily.session, 'sess-1');
  assert.equal(daily.tab, tabs.daily.tabId, 'and the tab it belongs to is still the key');
  assert.equal('history' in daily, false, 'there is no old id yet, so there is nothing to keep');
});

test('a session that has never reported an id has neither key', async (t) => {
  const box = await createSandbox(t);
  const { bots, tabs } = await fleet(box);

  const daily = await sessionIn(bots, 'api-bot', 'daily');
  assert.equal(daily.tab, tabs.daily.tabId);
  assert.equal('session' in daily, false, 'nothing has reported one, so the key is not there');
  assert.equal('history' in daily, false);
});

test('a new id puts the old one in that session\'s history, with why it ended and when', async (t) => {
  const box = await createSandbox(t);
  const { bots, tabs } = await fleet(box);
  const when = Date.now();

  await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, session: 'sess-1', source: 'startup' });
  await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, session: 'sess-2', source: 'clear' });

  const daily = await sessionIn(bots, 'api-bot', 'daily');
  assert.equal(daily.session, 'sess-2', 'the book holds the id the session runs under now');
  assert.equal(daily.history.length, 1, `and one old id, got: ${JSON.stringify(daily.history)}`);
  assert.equal(daily.history[0].session, 'sess-1');
  assert.equal(daily.history[0].ended, 'clear', 'the reason it ended is what the harness said replaced it');

  const at = String(daily.history[0].at);
  assert.match(at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, `the time should be ISO 8601, got: ${at}`);
  const stamp = Date.parse(at);
  assert.ok(Number.isFinite(stamp), `the time should be a real one, got: ${at}`);
  assert.ok(stamp >= when - 1000 && stamp <= Date.now() + 1000, `and it should be now, got: ${at}`);
});

test('every old id is kept, oldest first', async (t) => {
  // History, auditing and finops all read backwards through these, so none of
  // them may be dropped and the order has to be the order they happened in.
  const box = await createSandbox(t);
  const { bots, tabs } = await fleet(box);

  for (const [session, source] of [['a', 'startup'], ['b', 'clear'], ['c', 'clear'], ['d', 'startup']]) {
    await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, session, source });
  }

  const daily = await sessionIn(bots, 'api-bot', 'daily');
  assert.equal(daily.session, 'd');
  assert.deepEqual(
    daily.history.map((old) => [old.session, old.ended]),
    [['a', 'clear'], ['b', 'clear'], ['c', 'startup']],
    'each old id, in the order it was replaced, with the source that replaced it',
  );
});

test('the same id come back is a resume, and the book does not change', async (t) => {
  const box = await createSandbox(t);
  const { bots, tabs } = await fleet(box);
  await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, session: 'sess-1', source: 'startup' });
  const before = await readFile(bookOf(bots, 'api-bot'), 'utf8');

  const ran = await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, session: 'sess-1', source: 'resume' });

  assert.equal(ran.code, 0, ran.stderr);
  assert.equal(
    await readFile(bookOf(bots, 'api-bot'), 'utf8'),
    before,
    'a session that came back as itself has no old id and nothing to write',
  );
});

test('one session\'s report never touches another\'s', async (t) => {
  const box = await createSandbox(t);
  const { bots, tabs } = await fleet(box, { sessions: [['daily', []], ['review', []]] });

  await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, session: 'sess-daily' });
  await recordSession(box, { bots, bot: 'api-bot', tab: tabs.review.tabId, session: 'sess-review' });

  assert.equal((await sessionIn(bots, 'api-bot', 'daily')).session, 'sess-daily');
  assert.equal((await sessionIn(bots, 'api-bot', 'review')).session, 'sess-review');
});

test('a tab of another bot\'s is not this bot\'s session, and nothing moves', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await fleet(box, { bot: 'one-bot' });
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'two-bot', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', 'two-bot', '--name', 'daily'])).code, 0);
  assert.equal((await box.run(['up', '--bots', 'bots', '--bot', 'two-bot'])).code, 0);
  const theirs = (await tabsOfBot(box, bots, 'two-bot'))[0];
  const books = {
    one: await readFile(bookOf(bots, 'one-bot'), 'utf8'),
    two: await readFile(bookOf(bots, 'two-bot'), 'utf8'),
  };

  const ran = await recordSession(box, { bots, bot: 'one-bot', tab: theirs.tabId, session: 'sess-1' });

  assertQuiet(ran);
  assert.equal(await readFile(bookOf(bots, 'one-bot'), 'utf8'), books.one, 'the bot it was called for keeps its book');
  assert.equal(await readFile(bookOf(bots, 'two-bot'), 'utf8'), books.two, 'and the bot that owns the tab is not reached into');
});

test('a session that comes back under a new id is handed its start prompt again', async (t) => {
  // PRD 6.4: the start prompt is sent once at creation and again after a clear,
  // because it is the only thing that tells one session's duty from another's.
  // The same text, by both roads: what `up` typed on the launch line is what
  // the hook gives back.
  const box = await createSandbox(t);
  const prompt = 'Read your AGENTS.md and keep the queue moving.';
  const { bots, tabs } = await fleet(box, { sessions: [['daily', ['--prompt', prompt]]] });
  const typed = typedInto((await tabsOfBot(box, bots, 'api-bot'))[0])[0];
  assert.ok(typed.endsWith(`-- '${prompt}'`), `the launch line carried the prompt, got: ${typed}`);
  await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, session: 'sess-1', source: 'startup' });

  const ran = await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, session: 'sess-2', source: 'clear' });

  assert.equal(answerOf(ran), prompt);
});

test('a harness that says it cleared is handed the prompt back, whatever the book held', async (t) => {
  // The case the id alone cannot see. A hook that missed the session starting —
  // it was installed late, or `obk` was not on PATH that once — leaves the book
  // with no id to compare against, and a session that has just been cleared is
  // still a session with no duty. Claude Code says so in as many words, so when
  // it does, that is enough on its own.
  const box = await createSandbox(t);
  const prompt = 'Read your AGENTS.md and keep the queue moving.';
  const { bots, tabs } = await fleet(box, { sessions: [['daily', ['--prompt', prompt]]] });

  const ran = await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, session: 'sess-2', source: 'clear' });

  assert.equal(answerOf(ran), prompt);
});

test('a new id under any source at all is a session that came back with nothing', async (t) => {
  // Codex's shape: `/new` fires nothing of its own, and the first prompt of the
  // new conversation arrives as an ordinary start carrying the new id. Reading
  // the source word here would leave every cleared Codex session without a duty.
  const box = await createSandbox(t);
  const prompt = 'Read your AGENTS.md and keep the queue moving.';
  const { bots, tabs } = await fleet(box, { sessions: [['daily', ['--prompt', prompt]]] });
  await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, session: 'sess-1', source: 'startup' });

  const ran = await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, session: 'sess-2', source: 'startup' });

  assert.equal(answerOf(ran), prompt);
});

test('the answer is about the event the harness sent, not one of the kit\'s own', async (t) => {
  // The harnesses name their events, and a harness that renames one, or fires a
  // second, would read an answer about an event it did not ask about as an
  // answer to nothing.
  const box = await createSandbox(t);
  const prompt = 'Read your AGENTS.md and keep the queue moving.';
  const { bots, tabs } = await fleet(box, { sessions: [['daily', ['--prompt', prompt]]] });
  await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, session: 'sess-1' });

  const ran = await recordSession(box, {
    bots, bot: 'api-bot', tab: tabs.daily.tabId, session: 'sess-2', event: 'SessionResumed',
  });

  assert.equal(answerOf(ran, 'SessionResumed'), prompt);
});

test('the prompt handed back carries the work-dir note too', async (t) => {
  // A long prompt goes to the harness out of a file at creation. What the file
  // holds is what the session was told, note and all, and a cleared session is
  // told exactly that again — not the user's prompt with the note lost.
  const box = await createSandbox(t);
  const prompt = `Read your AGENTS.md. ${'x'.repeat(200)}`;
  const { bots, tabs } = await fleet(box, { sessions: [['daily', [`--prompt=${prompt}`, '--work-dir', 'work/api']]] });
  const held = await readFile(tabs.daily.promptFile, 'utf8');
  assert.ok(held.includes(path.join('work', 'api')), `the file should carry the note, got: ${held}`);
  await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, session: 'sess-1', source: 'startup' });

  const ran = await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, session: 'sess-2', source: 'clear' });

  assert.equal(answerOf(ran), held);
});

test('a session with a work dir and no prompt still gets its note back', async (t) => {
  const box = await createSandbox(t);
  const { bots, tabs } = await fleet(box, { sessions: [['daily', ['--work-dir', 'work/api']]] });
  await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, session: 'sess-1', source: 'startup' });

  const ran = await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, session: 'sess-2', source: 'clear' });

  const said = answerOf(ran);
  assert.ok(said !== undefined && said.includes(path.join('work', 'api')), `got: ${JSON.stringify(said)}`);
});

test('a session with nothing to say is told nothing when it comes back new', async (t) => {
  const box = await createSandbox(t);
  const { bots, tabs } = await fleet(box);
  await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, session: 'sess-1', source: 'startup' });

  const ran = await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, session: 'sess-2', source: 'clear' });

  assert.equal(ran.code, 0, ran.stderr);
  assert.equal(ran.stdout, '', `a session that was never given a duty has none to be given back: ${ran.stdout}`);
  assert.equal((await sessionIn(bots, 'api-bot', 'daily')).session, 'sess-2', 'the id was still written down');
});

for (const source of ['startup', 'resume', 'compact']) {
  test(`the first id a session reports, on ${source}, is told nothing`, async (t) => {
    // The session `up` just started already has its duty: it went in on the
    // launch line, as the harness's own prompt argument. Handing it over again
    // would be the same instruction twice in a session already carrying it out.
    const box = await createSandbox(t);
    const prompt = 'Read your AGENTS.md and keep the queue moving.';
    const { bots, tabs } = await fleet(box, { sessions: [['daily', ['--prompt', prompt]]] });

    const ran = await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, session: 'sess-1', source });

    assert.equal(ran.code, 0, ran.stderr);
    assert.equal(ran.stdout, '', `nothing to say on ${source}, got: ${ran.stdout}`);
    assert.equal((await sessionIn(bots, 'api-bot', 'daily')).session, 'sess-1', 'the id is written down all the same');
  });

  test(`a session reporting the same id again, on ${source}, is told nothing`, async (t) => {
    // It never lost the conversation, so it never lost the duty.
    const box = await createSandbox(t);
    const prompt = 'Read your AGENTS.md and keep the queue moving.';
    const { bots, tabs } = await fleet(box, { sessions: [['daily', ['--prompt', prompt]]] });
    await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, session: 'sess-1', source: 'startup' });

    const ran = await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, session: 'sess-1', source });

    assert.equal(ran.code, 0, ran.stderr);
    assert.equal(ran.stdout, '', `nothing to say on ${source}, got: ${ran.stdout}`);
  });
}

/**
 * Everything a hook can be handed that is not a session of this bot reporting
 * an id. Each one changes the ordinary call into the awkward one; `elsewhere`
 * is a path that is no bots folder.
 */
const NOTHING_TO_DO = {
  'the tab is one no session owns': (call) => ({ ...call, tab: 'tab_nobodys', session: 'sess-1' }),
  'Orca set no tab id at all': (call) => ({ ...call, tab: undefined, session: 'sess-1' }),
  'the tab id is empty': (call) => ({ ...call, tab: '', session: 'sess-1' }),
  'there is nothing on standard input': (call) => ({ ...call, stdin: '' }),
  'standard input is not JSON': (call) => ({ ...call, stdin: 'claude: something went wrong\n' }),
  'the event carries no session id': (call) => ({
    ...call, stdin: '{"hook_event_name":"SessionStart","source":"startup"}\n',
  }),
  'the session id is empty': (call) => ({ ...call, session: '' }),
  'there is no such bot': (call) => ({ ...call, bot: 'no-such-bot', session: 'sess-1' }),
  'the bots folder is not one': (call) => ({ ...call, bots: call.elsewhere, session: 'sess-1' }),
};

for (const [label, twist] of Object.entries(NOTHING_TO_DO)) {
  test(`nothing happens when ${label}`, async (t) => {
    const box = await createSandbox(t);
    const { bots, tabs } = await fleet(box, { sessions: [['daily', ['--prompt', 'Read your AGENTS.md.']]] });
    const before = await readFile(bookOf(bots, 'api-bot'), 'utf8');
    const calls = (await box.orca.calls()).length;

    const { elsewhere: _elsewhere, ...call } = twist({
      bots,
      bot: 'api-bot',
      tab: tabs.daily.tabId,
      elsewhere: path.join(box.root, 'not-a-bots-folder'),
    });
    const ran = await recordSession(box, call);

    assertQuiet(ran);
    assert.equal(await readFile(bookOf(bots, 'api-bot'), 'utf8'), before, 'the book must be exactly as it was');
    assert.equal((await box.orca.calls()).length, calls, 'the hook has no business with Orca at all');
  });
}

test('recording makes no Orca call, even when it does the work', async (t) => {
  // The hook runs on every session start, every resume and every clear. Orca is
  // not in that road at all: the book is the authority (ADR 0012) and the tab
  // id came in on the environment.
  const box = await createSandbox(t);
  const { bots, tabs } = await fleet(box);
  const calls = (await box.orca.calls()).length;

  await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, session: 'sess-1', source: 'clear' });

  assert.equal((await box.orca.calls()).length, calls);
});

test('a bad event never loses the id the book already held', async (t) => {
  const box = await createSandbox(t);
  const { bots, tabs } = await fleet(box);
  await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, session: 'sess-1' });

  assertQuiet(await recordSession(box, { bots, bot: 'api-bot', tab: tabs.daily.tabId, stdin: 'not json\n' }));

  assert.equal((await sessionIn(bots, 'api-bot', 'daily')).session, 'sess-1');
});

test('up is not a command that reads standard input', async (t) => {
  // `session record` is the one command a harness runs, and the only one that
  // takes anything on standard input. A run of `up` handed an event must go on
  // exactly as if it had been handed nothing.
  const box = await createSandbox(t);
  const { bots, tabs } = await fleet(box);

  const plain = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);
  const fed = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot'], {
    stdin: sessionStart({ session: 'sess-from-nowhere', source: 'clear' }),
    env: { ...box.env, ORCA_TAB_ID: tabs.daily.tabId },
  });

  assert.equal(fed.code, 0, fed.stderr);
  assert.equal(fed.stdout, plain.stdout, 'what is on standard input is nothing to up');
  assert.equal('session' in (await sessionIn(bots, 'api-bot', 'daily')), false, 'and it reported no id');
});
