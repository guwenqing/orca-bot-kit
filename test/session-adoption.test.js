// A conversation the kit never heard about is not a conversation that never
// happened (round 2, finding 3).
//
// The reviewer's Codex run: the kit opened the tab, typed the launch line, and
// Codex came up — but its hooks file had not been trusted yet, so the hook never
// ran and nothing was recorded. The first `/new` afterwards recorded only the
// new id, kept no history of the conversation that had been there, and the bot
// answered UNKNOWN when asked what it was for. Trusting the file later does not
// replay the SessionStart it missed; that conversation is never reported, and
// nothing else says so.
//
// So the kit stops assuming that a session with no id in the book has no
// conversation. The book writes down `launched` — when the kit started a harness
// in that tab — and when the kit's own information is incomplete it asks the
// harness what it knows: Codex's rollouts and Claude Code's transcripts, whose
// places were both measured today. A conversation any session of this bot
// already claims, by its id or by its history, is never a candidate.
//
// Both harnesses' records are files under the user's home directory, and HOME is
// inside every sandbox, so the tests here plant them: a conversation the kit
// never heard about, sitting where the harness would have left it.

import assert from 'node:assert/strict';
import { mkdir, readFile, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  assertCleanFailure,
  bookIn,
  bookOf,
  botHomeOf,
  createSandbox,
  recordSession,
  sessionIn,
  tabsOfBot,
  typedInto,
} from './helpers/cli.js';

/** A bots folder with one bot on `harness` and the sessions named, brought up. */
async function started(box, harness, sessions = ['daily'], settings = []) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', harness])).code, 0);
  for (const name of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', name, ...settings]);
    assert.equal(added.code, 0, added.stderr);
  }
  const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot', '--json']);
  assert.equal(up.code, 0, up.stderr);
  const bots = box.path('bots');
  return { bots, harness, home: botHomeOf(bots, 'api-bot'), tabs: JSON.parse(up.stdout).tabs };
}

/** A bots folder written but never brought up, so a session has no tab yet. */
async function written(box, harness, sessions = ['daily']) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', harness])).code, 0);
  for (const name of sessions) {
    assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', name])).code, 0);
  }
  return { bots: box.path('bots'), harness, home: botHomeOf(box.path('bots'), 'api-bot') };
}

/** When the kit says it started a harness in this session's tab. */
async function launchedAt(bots, session = 'daily') {
  const entry = await sessionIn(bots, 'api-bot', session);
  const at = entry?.launched;
  assert.equal(typeof at, 'string', `the book should say when the session was launched, got: ${JSON.stringify(entry)}`);
  const when = Date.parse(at);
  assert.ok(Number.isFinite(when), `and as a time, got: ${at}`);
  return new Date(when);
}

/**
 * A conversation in the harness's own records, where that harness leaves them.
 *
 * Codex writes one rollout file per conversation, under the day it started, and
 * its first line is `session_meta` carrying the id, the folder and the time.
 * Claude Code keeps one file per conversation in a folder named after the
 * working directory, every character that is not a letter or a digit turned into
 * a dash. Both measured on this machine today, and both under the home
 * directory, which is inside the sandbox.
 *
 * The file's own time is set to match what is written inside it, so a kit that
 * reads either one finds the same answer.
 */
async function conversation(box, harness, { id, cwd, at }) {
  const stamp = at.toISOString();
  const file = harness === 'codex'
    ? path.join(box.home, '.codex', 'sessions', ...stamp.slice(0, 10).split('-'), `rollout-${stamp.replaceAll(':', '-').replace(/\..*$/, '')}-${id}.jsonl`)
    : path.join(box.home, '.claude', 'projects', cwd.replaceAll(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);

  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, harness === 'codex'
    ? `${JSON.stringify({ timestamp: stamp, type: 'session_meta', payload: { id, cwd, timestamp: stamp } })}\n`
    : `${JSON.stringify({ type: 'system', sessionId: id, cwd, timestamp: stamp })}\n`);
  await utimes(file, at, at);
  return file;
}

/** A few seconds after `when`, as a time a conversation could have started at. */
const after = (when, seconds) => new Date(when.getTime() + seconds * 1000);

test('the book says when the kit started a harness in the tab', async (t) => {
  const box = await createSandbox(t);
  const when = Date.now();
  const { bots } = await started(box, 'claude');

  const daily = await sessionIn(bots, 'api-bot', 'daily');
  assert.match(String(daily.launched), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, `ISO 8601, got: ${daily.launched}`);
  const at = Date.parse(daily.launched);
  assert.ok(at >= when - 1000 && at <= Date.now() + 1000, `and it should be now, got: ${daily.launched}`);
  assert.equal(typeof daily.tab, 'string', 'and it goes in with the tab');
});

test('a session that never got a tab has no launched time either', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await written(box, 'claude');

  assert.equal((await bookIn(bots, 'api-bot')).sessions?.daily, undefined);
});

for (const harness of ['claude', 'codex']) {
  test(`the first ${harness} report keeps the conversation the kit never heard about`, async (t) => {
    // The reviewer's case, exactly. A conversation ran in the tab and was never
    // recorded; the user began another one; the hook reports that one. The one
    // before it is the launched conversation, so it goes into the history — and
    // the one reporting has no duty, because nothing ever told it one.
    const box = await createSandbox(t);
    const prompt = 'Read your AGENTS.md and keep the queue moving.';
    const { bots, home } = await started(box, harness, ['daily'], ['--prompt', prompt]);
    const launched = await launchedAt(bots);
    await conversation(box, harness, { id: 'the-lost-one', cwd: home, at: after(launched, 1) });
    await conversation(box, harness, { id: 'the-new-one', cwd: home, at: after(launched, 60) });

    const ran = await recordSession(box, {
      bots, bot: 'api-bot', tab: (await sessionIn(bots, 'api-bot', 'daily')).tab, session: 'the-new-one',
    });

    assert.equal(ran.code, 0, ran.stderr);
    const daily = await sessionIn(bots, 'api-bot', 'daily');
    assert.equal(daily.session, 'the-new-one', `got: ${JSON.stringify(daily)}`);
    assert.deepEqual(
      (daily.history ?? []).map((old) => old.session),
      ['the-lost-one'],
      `the conversation nobody recorded is still the session's history: ${JSON.stringify(daily)}`,
    );
    assert.equal(
      JSON.parse(ran.stdout).hookSpecificOutput.additionalContext,
      prompt,
      'and the session that came after it is handed the duty, because it was never given one',
    );
  });

  test(`a first ${harness} report with nothing before it is the launched one, and is told nothing`, async (t) => {
    // The ordinary first report. The records hold this conversation and no other,
    // so this is the one the launch line spoke to and it already has its duty.
    const box = await createSandbox(t);
    const prompt = 'Read your AGENTS.md and keep the queue moving.';
    const { bots, home } = await started(box, harness, ['daily'], ['--prompt', prompt]);
    const launched = await launchedAt(bots);
    await conversation(box, harness, { id: 'sess-1', cwd: home, at: after(launched, 1) });

    const ran = await recordSession(box, {
      bots, bot: 'api-bot', tab: (await sessionIn(bots, 'api-bot', 'daily')).tab, session: 'sess-1',
    });

    assert.equal(ran.code, 0, ran.stderr);
    assert.equal(ran.stdout, '', `it has its duty already: ${ran.stdout}`);
    const daily = await sessionIn(bots, 'api-bot', 'daily');
    assert.equal(daily.session, 'sess-1');
    assert.equal('history' in daily, false, `and nothing came before it: ${JSON.stringify(daily)}`);
  });

  test(`a ${harness} conversation from before the launch is nobody's business`, async (t) => {
    // The bot home has been used before — yesterday's run of the same session,
    // or another day's. Only what started after this tab was launched can be
    // what the launch line spoke to.
    const box = await createSandbox(t);
    const { bots, home } = await started(box, harness);
    const launched = await launchedAt(bots);
    await conversation(box, harness, { id: 'yesterdays', cwd: home, at: after(launched, -3600) });
    await conversation(box, harness, { id: 'sess-1', cwd: home, at: after(launched, 1) });

    await recordSession(box, {
      bots, bot: 'api-bot', tab: (await sessionIn(bots, 'api-bot', 'daily')).tab, session: 'sess-1',
    });

    const daily = await sessionIn(bots, 'api-bot', 'daily');
    assert.equal(daily.session, 'sess-1');
    assert.equal('history' in daily, false, `an older conversation is not this session's: ${JSON.stringify(daily)}`);
  });

  test(`a ${harness} conversation in another folder is nobody's business`, async (t) => {
    const box = await createSandbox(t);
    const { bots, home } = await started(box, harness);
    const launched = await launchedAt(bots);
    await conversation(box, harness, { id: 'someone-elses', cwd: path.join(box.root, 'elsewhere'), at: after(launched, 1) });
    await conversation(box, harness, { id: 'sess-1', cwd: home, at: after(launched, 60) });

    await recordSession(box, {
      bots, bot: 'api-bot', tab: (await sessionIn(bots, 'api-bot', 'daily')).tab, session: 'sess-1',
    });

    const daily = await sessionIn(bots, 'api-bot', 'daily');
    assert.equal(daily.session, 'sess-1');
    assert.equal('history' in daily, false, `a conversation in another folder is not this session's: ${JSON.stringify(daily)}`);
  });

  test(`a ${harness} conversation another session of the bot already claims is not a candidate`, async (t) => {
    // Two sessions of one bot share the folder, so the records hold both of
    // their conversations. What one session already claims — now or in its
    // history — can never become another's.
    const box = await createSandbox(t);
    const { bots, home } = await started(box, harness, ['daily', 'review']);
    const launched = await launchedAt(bots, 'daily');
    const book = await bookIn(bots, 'api-bot');
    await conversation(box, harness, { id: 'review-1', cwd: home, at: after(launched, 1) });
    await conversation(box, harness, { id: 'review-2', cwd: home, at: after(launched, 2) });
    await conversation(box, harness, { id: 'daily-1', cwd: home, at: after(launched, 3) });

    // review claims one now and one in its history.
    await recordSession(box, { bots, bot: 'api-bot', tab: book.sessions.review.tab, session: 'review-1' });
    await recordSession(box, {
      bots, bot: 'api-bot', tab: book.sessions.review.tab, session: 'review-2', source: 'clear',
    });
    await recordSession(box, { bots, bot: 'api-bot', tab: book.sessions.daily.tab, session: 'daily-1' });

    const daily = await sessionIn(bots, 'api-bot', 'daily');
    assert.equal(daily.session, 'daily-1');
    assert.equal(
      'history' in daily,
      false,
      `neither of review's conversations may become daily's: ${JSON.stringify(daily)}`,
    );
    assert.deepEqual((await sessionIn(bots, 'api-bot', 'review')).history.map((old) => old.session), ['review-1']);
  });
}

for (const harness of ['claude', 'codex']) {
  test(`up adopts the one unclaimed ${harness} conversation and resumes it`, async (t) => {
    // The tab is gone and the book has no id, but the harness's own records hold
    // one conversation that can only be this session's. Starting fresh would
    // throw it away, so it is adopted and resumed instead.
    const box = await createSandbox(t);
    const prompt = 'Read your AGENTS.md and keep the queue moving.';
    const { bots, home, tabs } = await started(box, harness, ['daily'], ['--prompt', prompt]);
    const launched = await launchedAt(bots);
    await conversation(box, harness, { id: 'the-lost-one', cwd: home, at: after(launched, 1) });
    await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.tabId !== tabs[0].tabId) });

    const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot', '--json']);

    assert.equal(up.code, 0, up.stderr);
    const entry = JSON.parse(up.stdout).tabs[0];
    assert.equal(entry.created, true);
    assert.equal(entry.resumed, true, 'the conversation the harness still had is picked up');
    assert.equal((await sessionIn(bots, 'api-bot', 'daily')).session, 'the-lost-one', 'and written down as the session\'s');
    const line = typedInto((await tabsOfBot(box, bots, 'api-bot'))[0])[0];
    assert.ok(line.includes('the-lost-one'), `the launch line resumes it, got: ${line}`);
    assert.ok(!line.includes(prompt), `and does not tell it its duty again, got: ${line}`);
  });

  test(`up says plainly when the ${harness} had no conversation for the session`, async (t) => {
    // Nothing in the records, so there is nothing to adopt: a new conversation,
    // and the reader is told that is what happened rather than left to assume it.
    const box = await createSandbox(t);
    const { bots, tabs } = await started(box, harness);
    await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.tabId !== tabs[0].tabId) });

    // One run only: a second would find the tab it had just made, and a tab that
    // was already there is not a tab this run started anything in.
    const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

    assert.equal(up.code, 0, up.stderr);
    assert.match(up.stdout, /no conversation|none|nothing/i, `the reader should be told, got: ${up.stdout}`);
    assert.ok(!up.stdout.includes('undefined'), `and told it in words, got: ${up.stdout}`);
    assert.equal('session' in (await sessionIn(bots, 'api-bot', 'daily')), false, 'and nothing was adopted');
  });

  test(`up refuses the session when the ${harness} had more than one conversation for it`, async (t) => {
    // Two conversations, both unclaimed, both since the launch. Either could be
    // the session's and picking one would be a guess — so the session is refused
    // with the ids named, and the rest of the fleet still comes up.
    const box = await createSandbox(t);
    const { bots, home, tabs } = await started(box, harness);
    assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'other-bot', '--harness', 'claude'])).code, 0);
    assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', 'other-bot', '--name', 'daily'])).code, 0);
    const launched = await launchedAt(bots);
    await conversation(box, harness, { id: 'could-be-this-one', cwd: home, at: after(launched, 1) });
    await conversation(box, harness, { id: 'or-this-one', cwd: home, at: after(launched, 2) });
    await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.tabId !== tabs[0].tabId) });

    const up = await box.run(['up', '--bots', 'bots']);

    assertCleanFailure(up);
    for (const named of ['api-bot', 'daily', 'could-be-this-one', 'or-this-one']) {
      assert.ok(up.stderr.includes(named), `the message should name ${named}, got: ${up.stderr}`);
    }
    assert.deepEqual(await tabsOfBot(box, bots, 'api-bot'), [], 'the session it could not place gets no tab');
    assert.equal(
      (await tabsOfBot(box, bots, 'other-bot')).length,
      1,
      'and the rest of the fleet comes up all the same',
    );
    assert.equal('session' in (await sessionIn(bots, 'api-bot', 'daily')), false, 'and nothing was guessed into the book');
  });
}

test('a session whose id the book already holds does not go asking the harness', async (t) => {
  // The kit's own information is complete, so there is nothing to find out: the
  // book's id is resumed, whatever else the records happen to hold.
  const box = await createSandbox(t);
  const { bots, home, tabs } = await started(box, 'codex');
  const launched = await launchedAt(bots);
  await recordSession(box, { bots, bot: 'api-bot', tab: tabs[0].tabId, session: 'sess-1' });
  await conversation(box, 'codex', { id: 'sess-1', cwd: home, at: after(launched, 1) });
  await conversation(box, 'codex', { id: 'a-stranger', cwd: home, at: after(launched, 2) });
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.tabId !== tabs[0].tabId) });

  const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(up.code, 0, up.stderr);
  const line = typedInto((await tabsOfBot(box, bots, 'api-bot'))[0])[0];
  assert.ok(line.includes('sess-1'), `the book's own id is what is resumed, got: ${line}`);
  assert.ok(!line.includes('a-stranger'), `and a conversation nobody claimed is not picked up, got: ${line}`);
});

test('a bot whose harness left no records at all still comes up', async (t) => {
  // A machine where the harness has never written anything, or a home directory
  // the kit cannot read: nothing to ask, so nothing is adopted, and the session
  // comes up as it always did.
  const box = await createSandbox(t);
  const { bots, tabs } = await started(box, 'claude');
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.tabId !== tabs[0].tabId) });

  const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot', '--json']);

  assert.equal(up.code, 0, up.stderr);
  assert.equal(JSON.parse(up.stdout).tabs[0].resumed, false);
  assert.equal('session' in (await sessionIn(bots, 'api-bot', 'daily')), false);
  await readFile(bookOf(bots, 'api-bot'), 'utf8');
});

// What the report says about where a tab's conversation came from. There are four
// answers and a person reading the output has to be able to tell them apart:
// resumed from the book, resumed from what the harness still had, started new
// because the book holds nothing yet, and started new because the harness had
// nothing on record either. The last one is the interesting one — it is the kit
// saying "I looked, and there was nothing there" rather than assuming it.

/** One session, its tab gone, with whatever the harness is supposed to have on record. */
async function comingBack(box, { recorded = false, adoptable = false } = {}) {
  const { bots, home, tabs } = await started(box, 'codex', ['daily'], ['--prompt', 'Keep the queue moving.']);
  if (recorded) {
    await recordSession(box, { bots, bot: 'api-bot', tab: tabs[0].tabId, session: 'from-the-book' });
  }
  if (adoptable) {
    await conversation(box, 'codex', { id: 'from-the-harness', cwd: home, at: after(await launchedAt(bots), 1) });
  }
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.tabId !== tabs[0].tabId) });
  return bots;
}

/** The one session tab of a `--json` run. */
async function entryOf(box, flags = []) {
  const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot', '--json', ...flags]);
  assert.equal(up.code, 0, up.stderr);
  return JSON.parse(up.stdout).tabs[0];
}

test('--json says a conversation was adopted from what the harness still had', async (t) => {
  const box = await createSandbox(t);
  await comingBack(box, { adoptable: true });

  const entry = await entryOf(box);

  assert.equal(entry.resumed, true);
  assert.equal(entry.adopted, true, 'the book held none, so this one came from the harness\'s own record');
  assert.equal('conversationLost' in entry, false);
});

test('a conversation the book itself holds is resumed without being called adopted', async (t) => {
  const box = await createSandbox(t);
  await comingBack(box, { recorded: true });

  const entry = await entryOf(box);

  assert.equal(entry.resumed, true);
  assert.equal('adopted' in entry, false, 'nothing was adopted: the kit knew this one all along');
  assert.equal('conversationLost' in entry, false);
});

test('--json says the harness had no conversation on record for the session', async (t) => {
  // The kit looked, because the book held nothing and the tab had been launched.
  // Saying so is the difference between a session that never ran and one whose
  // conversation nobody can find.
  const box = await createSandbox(t);
  await comingBack(box);

  const entry = await entryOf(box);

  assert.equal(entry.resumed, false);
  assert.equal(entry.conversationLost, true);
  assert.equal('adopted' in entry, false);
});

test('a session coming up for the very first time has lost nothing', async (t) => {
  // Nothing was ever launched in a tab for it, so there was nothing to look for
  // and nothing is missing.
  const box = await createSandbox(t);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'codex'])).code, 0);
  assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily'])).code, 0);

  const entry = await entryOf(box);

  assert.equal(entry.resumed, false);
  assert.equal('conversationLost' in entry, false, 'a session with no history has nothing to have lost');
  assert.equal('adopted' in entry, false);
});

test('the plain report reads differently for each of the four', async (t) => {
  // The JSON is for the caller; this is for the person. Four different things
  // happened and the lines have to say four different things, or the output is
  // no use for deciding whether to go and look at a tab.
  const said = [];
  for (const [what, set] of [
    ['from the book', (box) => comingBack(box, { recorded: true })],
    ['from the harness', (box) => comingBack(box, { adoptable: true })],
    ['nothing on record', (box) => comingBack(box)],
    ['never launched', async (box) => {
      assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
      assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'codex'])).code, 0);
      assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily'])).code, 0);
    }],
  ]) {
    const box = await createSandbox(t);
    await set(box);
    const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);
    assert.equal(up.code, 0, `${what}: ${up.stderr}`);
    assert.ok(!up.stdout.includes('undefined'), `${what}: nothing should be undefined, got: ${up.stdout}`);
    // Ids, paths and handles are not what tells the four apart.
    said.push([what, up.stdout
      .split(box.root).join('<root>')
      .replaceAll(/\b(tab|term|proj|repo|fake)_[0-9a-z-]+\b/g, '<id>')
      .replaceAll(/\bfrom-the-\w+\b/g, '<id>')]);
  }

  const lines = new Set(said.map(([, text]) => text));
  assert.equal(
    lines.size,
    4,
    `each of the four should read differently:\n${said.map(([what, text]) => `--- ${what} ---\n${text}`).join('\n')}`,
  );
});

test('the refusal tells the user how to settle it themselves', async (t) => {
  // Which conversation is which is the user's to say, so the message has to leave
  // them able to say it: the file to write it in, and the session to write it
  // under. A message that only says "cannot tell" leaves the session down.
  const box = await createSandbox(t);
  const { bots, home, tabs } = await started(box, 'codex');
  const launched = await launchedAt(bots);
  await conversation(box, 'codex', { id: 'could-be-this-one', cwd: home, at: after(launched, 1) });
  await conversation(box, 'codex', { id: 'or-this-one', cwd: home, at: after(launched, 2) });
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.tabId !== tabs[0].tabId) });

  const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  assertCleanFailure(up);
  assert.ok(up.stderr.includes(bookOf(bots, 'api-bot')), `it should name the book, got: ${up.stderr}`);
  assert.match(up.stderr, /obk up/, `and say to run the command again, got: ${up.stderr}`);
});
