// A conversation the kit never recorded is never assigned to a session
// (round 3, finding 1).
//
// Round two had the kit pick the latest unclaimed conversation in the bot home
// and call it the session's. The review reproduced two ways that goes wrong, and
// both are the same mistake: a bot's sessions all live in one folder, and so do
// the harnesses they start inside themselves, so neither the folder nor the time
// a conversation began can say whose it is.
//
//   1. On real Codex: a parent conversation ran before the hooks file was
//      trusted, the parent then ran a `codex exec` child, and after the parent's
//      `/new` the kit put **the child's** conversation into the session's
//      history and left the parent's out of the book entirely.
//   2. Two sessions of one bot, neither recorded, reporting in reverse order:
//      each took the other's conversation.
//
// Nothing either harness writes down could have settled it. Claude Code's
// registry maps a live process to the conversation it is having now and keeps no
// earlier one; Codex records no pid at all; and neither ties a new conversation
// to the one the same process had before (tech notes, sections 2 and 3).
//
// So the kit assigns a conversation only when the report comes from that
// session's own top-level harness, which is what the hook's report is and
// nothing else is. When it cannot say, it writes down what it found instead:
// per session, `unclaimed` — the conversations of this bot home that began since
// the kit started a harness in that session's tab and that no session of the bot
// claims, now or in its history — and leaves it for a person or Bot Father. A
// session whose first id arrives with something in that list is handed its duty,
// because the kit cannot be sure the conversation reporting is the one the launch
// line spoke to, and a session without its duty is the failure this slice exists
// to prevent.
//
// Both harnesses' records are files under the user's home directory, and HOME is
// inside every sandbox, so the tests here plant them: a conversation the kit
// never heard about, sitting where the harness would have left it.

import assert from 'node:assert/strict';
import { mkdir, readFile, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
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
 * a dash. Both measured on this machine, and both under the home directory,
 * which is inside the sandbox.
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

/** The ids one session's `unclaimed` note holds, in no particular order. */
async function unclaimedIn(bots, session = 'daily') {
  const entry = await sessionIn(bots, 'api-bot', session) ?? {};
  const listed = entry.unclaimed ?? [];
  assert.ok(Array.isArray(listed), `unclaimed should be a list of ids, got: ${JSON.stringify(entry)}`);
  for (const id of listed) {
    assert.equal(typeof id, 'string', `and every one of them a plain id, got: ${JSON.stringify(listed)}`);
  }
  return [...listed].sort();
}

/** The duty a hook's answer hands the session, or undefined when it said nothing. */
function dutyIn(ran) {
  if (ran.stdout === '') return undefined;
  return JSON.parse(ran.stdout).hookSpecificOutput.additionalContext;
}

/** The one line typed into the session's tab: what the kit launched it with. */
async function launchLineOf(box, bots) {
  const tabs = await tabsOfBot(box, bots, 'api-bot');
  assert.equal(tabs.length, 1, `one tab for the session, got: ${JSON.stringify(tabs)}`);
  return typedInto(tabs[0])[0];
}

const DUTY = 'Read your AGENTS.md and keep the queue moving.';

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
  test(`a conversation the kit never heard about is written down, not made the ${harness} session's history`, async (t) => {
    // The reviewer's case, half of it: a conversation ran in the tab and was
    // never recorded, the user began another one, and the hook reports that one.
    // The one before it is a conversation of this folder that nobody claims —
    // which is all anything can say about it — so it goes on the record, and the
    // session is handed its duty because the kit cannot be sure the conversation
    // reporting is the one the launch line spoke to.
    const box = await createSandbox(t);
    const { bots, home } = await started(box, harness, ['daily'], ['--prompt', DUTY]);
    const launched = await launchedAt(bots);
    await conversation(box, harness, { id: 'the-lost-one', cwd: home, at: after(launched, 1) });
    await conversation(box, harness, { id: 'the-new-one', cwd: home, at: after(launched, 60) });

    const ran = await recordSession(box, {
      bots, bot: 'api-bot', tab: (await sessionIn(bots, 'api-bot', 'daily')).tab, session: 'the-new-one',
    });

    assert.equal(ran.code, 0, ran.stderr);
    const daily = await sessionIn(bots, 'api-bot', 'daily');
    assert.equal(daily.session, 'the-new-one', `got: ${JSON.stringify(daily)}`);
    assert.equal(
      'history' in daily,
      false,
      `nothing the kit never recorded may become this session's history: ${JSON.stringify(daily)}`,
    );
    assert.deepEqual(await unclaimedIn(bots), ['the-lost-one'], `got: ${JSON.stringify(daily)}`);
    assert.equal(dutyIn(ran), DUTY, 'and a session the kit cannot be sure about is handed its duty');
  });

  test(`a child ${harness}'s conversation never reaches the session's history`, async (t) => {
    // The reviewer's case in full, and the one that caught this on real Codex.
    // Two conversations nobody recorded sit in the folder: the session's own,
    // from before its hooks file was trusted, and the one the `codex exec` it ran
    // had — which is the later of the two, so picking by time picked the child's.
    // Neither is assigned to anything. Both are written down.
    const box = await createSandbox(t);
    const { bots, home } = await started(box, harness, ['daily'], ['--prompt', DUTY]);
    const launched = await launchedAt(bots);
    const tab = (await sessionIn(bots, 'api-bot', 'daily')).tab;
    await conversation(box, harness, { id: 'the-parents-own', cwd: home, at: after(launched, 1) });
    await conversation(box, harness, { id: 'the-childs', cwd: home, at: after(launched, 30) });

    // The child reports through a harness of its own, under the session's: the
    // tab id is the same, and the report is ignored all the same.
    const child = await recordSession(box, { bots, bot: 'api-bot', tab, session: 'the-childs', nested: true });
    assert.equal(child.code, 0, child.stderr);
    assert.equal(child.stdout, '', `a child's report is answered with nothing: ${child.stdout}`);

    // Then the parent's `/new`, reported by the session's own harness.
    await conversation(box, harness, { id: 'the-new-one', cwd: home, at: after(launched, 60) });
    const ran = await recordSession(box, { bots, bot: 'api-bot', tab, session: 'the-new-one' });

    assert.equal(ran.code, 0, ran.stderr);
    const daily = await sessionIn(bots, 'api-bot', 'daily');
    assert.equal(daily.session, 'the-new-one', `got: ${JSON.stringify(daily)}`);
    assert.equal(
      'history' in daily,
      false,
      `the child's conversation must not be in this session's history, nor anything else's: ${JSON.stringify(daily)}`,
    );
    assert.deepEqual(
      await unclaimedIn(bots),
      ['the-childs', 'the-parents-own'],
      `both are conversations of this folder that nobody claims: ${JSON.stringify(daily)}`,
    );
    assert.equal(dutyIn(ran), DUTY);
  });

  test(`two unrecorded ${harness} sessions reporting in reverse order keep their own conversation`, async (t) => {
    // The other half of the review's finding. Two sessions of one bot, neither
    // recorded, each now running a conversation of its own, and the second one
    // in the book reports first. Each keeps what its own harness said and nothing
    // of the other's, and the two nobody recorded are written down for both.
    const box = await createSandbox(t);
    const { bots, home } = await started(box, harness, ['daily', 'review'], ['--prompt', DUTY]);
    const book = await bookIn(bots, 'api-bot');
    const launched = await launchedAt(bots, 'daily');
    await conversation(box, harness, { id: 'ran-and-was-never-reported', cwd: home, at: after(launched, 1) });
    await conversation(box, harness, { id: 'ran-too-and-was-never-reported', cwd: home, at: after(launched, 2) });
    await conversation(box, harness, { id: 'review-is-running-this', cwd: home, at: after(launched, 60) });
    await conversation(box, harness, { id: 'daily-is-running-this', cwd: home, at: after(launched, 61) });

    const second = await recordSession(box, {
      bots, bot: 'api-bot', tab: book.sessions.review.tab, session: 'review-is-running-this',
    });
    const first = await recordSession(box, {
      bots, bot: 'api-bot', tab: book.sessions.daily.tab, session: 'daily-is-running-this',
    });

    assert.equal(second.code, 0, second.stderr);
    assert.equal(first.code, 0, first.stderr);
    const now = await bookIn(bots, 'api-bot');
    assert.equal(now.sessions.review.session, 'review-is-running-this', `got: ${JSON.stringify(now.sessions)}`);
    assert.equal(now.sessions.daily.session, 'daily-is-running-this', `got: ${JSON.stringify(now.sessions)}`);
    for (const name of ['daily', 'review']) {
      assert.equal(
        'history' in now.sessions[name],
        false,
        `${name} was handed nobody's conversation: ${JSON.stringify(now.sessions[name])}`,
      );
      assert.deepEqual(
        await unclaimedIn(bots, name),
        ['ran-and-was-never-reported', 'ran-too-and-was-never-reported'],
        `${name} should hold the two nobody claims, and only those: ${JSON.stringify(now.sessions[name])}`,
      );
    }
    assert.equal(dutyIn(second), DUTY, 'and both are handed their duty');
    assert.equal(dutyIn(first), DUTY);
  });

  test(`a first ${harness} report with nothing unclaimed beside it is told nothing`, async (t) => {
    // The ordinary first report. The records hold this conversation and no other,
    // so there is nothing the kit is unsure about: the id goes in, no note is
    // written, and the session already has the duty its launch line carried.
    const box = await createSandbox(t);
    const { bots, home } = await started(box, harness, ['daily'], ['--prompt', DUTY]);
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
    assert.equal('unclaimed' in daily, false, `and there is nothing to write down: ${JSON.stringify(daily)}`);
  });

  test(`a ${harness} conversation from before the launch is nobody's business`, async (t) => {
    // The bot home has been used before — yesterday's run of the same session,
    // or another day's. Only what started after this tab was launched can have
    // anything to do with it.
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
    assert.deepEqual(await unclaimedIn(bots), [], `nor is it unclaimed: ${JSON.stringify(daily)}`);
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
    assert.deepEqual(await unclaimedIn(bots), [], `nor is it unclaimed: ${JSON.stringify(daily)}`);
  });

  test(`a ${harness} conversation another session of the bot claims is not unclaimed`, async (t) => {
    // Two sessions of one bot share the folder, so the records hold both of
    // their conversations. What one session claims — now or in its history — is
    // not something nobody claims, so it is on nobody's note.
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
    assert.deepEqual(
      await unclaimedIn(bots),
      [],
      `and neither is unclaimed: ${JSON.stringify(daily)}`,
    );
    assert.deepEqual((await sessionIn(bots, 'api-bot', 'review')).history.map((old) => old.session), ['review-1']);
  });
}

test('an id leaves the note the moment a session claims it', async (t) => {
  // The note says what nobody claims, and that changes: a conversation the kit
  // could not place may turn out to be another session's, by its own harness
  // reporting it or by the user writing it into the book. Once it is claimed it
  // is no longer a loose end, and the next write of the book takes it off every
  // session's note.
  const box = await createSandbox(t);
  const { bots, home } = await started(box, 'codex', ['daily', 'review']);
  const book = await bookIn(bots, 'api-bot');
  const launched = await launchedAt(bots, 'daily');
  await conversation(box, 'codex', { id: 'one-of-them', cwd: home, at: after(launched, 1) });
  await conversation(box, 'codex', { id: 'the-other-one', cwd: home, at: after(launched, 2) });

  await recordSession(box, { bots, bot: 'api-bot', tab: book.sessions.daily.tab, session: 'daily-1' });
  assert.deepEqual(
    await unclaimedIn(bots, 'daily'),
    ['one-of-them', 'the-other-one'],
    'both are loose ends to begin with',
  );

  // And then review turns out to be the session that was having one of them.
  await recordSession(box, { bots, bot: 'api-bot', tab: book.sessions.review.tab, session: 'one-of-them' });

  assert.equal((await sessionIn(bots, 'api-bot', 'review')).session, 'one-of-them');
  assert.deepEqual(
    await unclaimedIn(bots, 'daily'),
    ['the-other-one'],
    'a conversation a session claims is nobody\'s loose end any more',
  );
});

for (const harness of ['claude', 'codex']) {
  test(`up starts the session fresh and writes down what the ${harness} still had`, async (t) => {
    // The tab is gone and the book has no id, and the harness's own records hold
    // one conversation nobody claims. Round two adopted it. It cannot: a
    // conversation in this folder may be another session's or a child's, and the
    // kit taking it would be the same guess by another road. So the session
    // comes up as a new conversation with its duty, and what was found goes on
    // the record for someone to reattach.
    const box = await createSandbox(t);
    const { bots, home, tabs } = await started(box, harness, ['daily'], ['--prompt', DUTY]);
    const launched = await launchedAt(bots);
    await conversation(box, harness, { id: 'the-lost-one', cwd: home, at: after(launched, 1) });
    await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.tabId !== tabs[0].tabId) });

    const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

    assert.equal(up.code, 0, up.stderr);
    const daily = await sessionIn(bots, 'api-bot', 'daily');
    assert.equal('session' in daily, false, `nothing is adopted: ${JSON.stringify(daily)}`);
    assert.deepEqual(await unclaimedIn(bots), ['the-lost-one'], `and what was found is written down: ${JSON.stringify(daily)}`);

    const line = await launchLineOf(box, bots);
    assert.ok(!line.includes('the-lost-one'), `the launch line does not resume it, got: ${line}`);
    assert.ok(line.includes(DUTY), `and the session is told its duty, got: ${line}`);

    assert.ok(up.stdout.includes('the-lost-one'), `the report names what was found, got: ${up.stdout}`);
    assert.match(
      up.stdout,
      /which conversation|does not know|cannot say|cannot tell/i,
      `and says plainly that the kit cannot say which conversation this session had, got: ${up.stdout}`,
    );
    assert.ok(!up.stdout.includes('undefined'), `in words, got: ${up.stdout}`);
  });

  test(`up says plainly when the ${harness} had no conversation for the session`, async (t) => {
    // Nothing in the records, so there is nothing to write down either: a new
    // conversation, and the reader is told that is what happened rather than
    // left to assume it.
    const box = await createSandbox(t);
    const { bots, tabs } = await started(box, harness);
    await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.tabId !== tabs[0].tabId) });

    // One run only: a second would find the tab it had just made, and a tab that
    // was already there is not a tab this run started anything in.
    const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

    assert.equal(up.code, 0, up.stderr);
    assert.match(up.stdout, /no conversation|none|nothing/i, `the reader should be told, got: ${up.stdout}`);
    assert.ok(!up.stdout.includes('undefined'), `and told it in words, got: ${up.stdout}`);
    const daily = await sessionIn(bots, 'api-bot', 'daily');
    assert.equal('session' in daily, false, 'and nothing was adopted');
    assert.equal('unclaimed' in daily, false, `and nothing was written down: ${JSON.stringify(daily)}`);
  });

  test(`up brings the session up all the same when the ${harness} had more than one conversation for it`, async (t) => {
    // Round two refused the session here, and that is the wrong shape now: with
    // nothing ever adopted the ambiguous case is the ordinary case, and a fleet
    // that will not come up because the kit is unsure is worse than one that
    // comes up, says so, and leaves the conversations on record.
    const box = await createSandbox(t);
    const { bots, home, tabs } = await started(box, harness, ['daily'], ['--prompt', DUTY]);
    assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'other-bot', '--harness', 'claude'])).code, 0);
    assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', 'other-bot', '--name', 'daily'])).code, 0);
    const launched = await launchedAt(bots);
    await conversation(box, harness, { id: 'could-be-this-one', cwd: home, at: after(launched, 1) });
    await conversation(box, harness, { id: 'or-this-one', cwd: home, at: after(launched, 2) });
    await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.tabId !== tabs[0].tabId) });

    const up = await box.run(['up', '--bots', 'bots']);

    assert.equal(up.code, 0, up.stderr);
    assert.equal((await tabsOfBot(box, bots, 'api-bot')).length, 1, 'the session comes up');
    assert.equal((await tabsOfBot(box, bots, 'other-bot')).length, 1, 'and so does the rest of the fleet');
    const daily = await sessionIn(bots, 'api-bot', 'daily');
    assert.equal('session' in daily, false, `and nothing was guessed into the book: ${JSON.stringify(daily)}`);
    assert.deepEqual(await unclaimedIn(bots), ['could-be-this-one', 'or-this-one'], `got: ${JSON.stringify(daily)}`);

    const line = await launchLineOf(box, bots);
    for (const id of ['could-be-this-one', 'or-this-one']) {
      assert.ok(!line.includes(id), `neither is resumed, got: ${line}`);
      assert.ok(up.stdout.includes(id), `and both are named in the report, got: ${up.stdout}`);
    }
    assert.ok(line.includes(DUTY), `the session is told its duty, got: ${line}`);
  });
}

test('the report says how to give the session its conversation back', async (t) => {
  // Which conversation is which is the user's to say, so the report has to leave
  // them able to say it: the file to write it in, the session to write it under,
  // and the key it goes in as.
  const box = await createSandbox(t);
  const { bots, home, tabs } = await started(box, 'codex');
  const launched = await launchedAt(bots);
  await conversation(box, 'codex', { id: 'could-be-this-one', cwd: home, at: after(launched, 1) });
  await conversation(box, 'codex', { id: 'or-this-one', cwd: home, at: after(launched, 2) });
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.tabId !== tabs[0].tabId) });

  const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(up.code, 0, up.stderr);
  assert.ok(up.stdout.includes(bookOf(bots, 'api-bot')), `it should name the book, got: ${up.stdout}`);
  assert.match(up.stdout, /session:/, `and the key to write the id under, got: ${up.stdout}`);
  assert.ok(up.stdout.includes('daily'), `and which session, got: ${up.stdout}`);
});

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
  const line = await launchLineOf(box, bots);
  assert.ok(line.includes('sess-1'), `the book's own id is what is resumed, got: ${line}`);
  assert.ok(!line.includes('a-stranger'), `and a conversation nobody claimed is not picked up, got: ${line}`);
});

test('a bot whose harness left no records at all still comes up', async (t) => {
  // A machine where the harness has never written anything, or a home directory
  // the kit cannot read: nothing to find, so nothing to write down, and the
  // session comes up as it always did.
  const box = await createSandbox(t);
  const { bots, tabs } = await started(box, 'claude');
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.tabId !== tabs[0].tabId) });

  const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot', '--json']);

  assert.equal(up.code, 0, up.stderr);
  assert.equal(JSON.parse(up.stdout).tabs[0].resumed, false);
  const daily = await sessionIn(bots, 'api-bot', 'daily');
  assert.equal('session' in daily, false);
  assert.equal('unclaimed' in daily, false, `an empty note is not written: ${JSON.stringify(daily)}`);
  await readFile(bookOf(bots, 'api-bot'), 'utf8');
});

test('nothing a run finds in the records is ever called adopted', async (t) => {
  // Round two had `up` take a conversation over and say so. There is no adoption
  // any more, so nothing may claim there was one — a caller that acts on it
  // would be acting on a guess the kit no longer makes.
  const box = await createSandbox(t);
  const { bots, home, tabs } = await started(box, 'codex');
  const launched = await launchedAt(bots);
  await conversation(box, 'codex', { id: 'the-lost-one', cwd: home, at: after(launched, 1) });
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.tabId !== tabs[0].tabId) });

  const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot', '--json']);

  assert.equal(up.code, 0, up.stderr);
  const entry = JSON.parse(up.stdout).tabs[0];
  assert.equal(entry.created, true);
  assert.equal(entry.resumed, false, 'a conversation nobody can place is not resumed');
  assert.equal('adopted' in entry, false, `nothing is adopted any more: ${JSON.stringify(entry)}`);
});

// What the report says about where a tab's conversation came from. There are four
// answers and a person reading the output has to be able to tell them apart:
// resumed from the book, started new with conversations on record that nobody can
// place, started new because the harness had nothing on record either, and
// started new because nothing was ever launched here. The third one is the
// interesting one — it is the kit saying "I looked, and there was nothing there"
// rather than assuming it.

/** One session, its tab gone, with whatever the harness is supposed to have on record. */
async function comingBack(box, { recorded = false, unplaceable = false } = {}) {
  const { bots, home, tabs } = await started(box, 'codex', ['daily'], ['--prompt', 'Keep the queue moving.']);
  if (recorded) {
    await recordSession(box, { bots, bot: 'api-bot', tab: tabs[0].tabId, session: 'from-the-book' });
  }
  if (unplaceable) {
    await conversation(box, 'codex', { id: 'from-the-harness', cwd: home, at: after(await launchedAt(bots), 1) });
  }
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.tabId !== tabs[0].tabId) });
  return bots;
}

test('the plain report reads differently for each of the four', async (t) => {
  // The JSON is for the caller; this is for the person. Four different things
  // happened and the lines have to say four different things, or the output is
  // no use for deciding whether to go and look at a tab.
  const said = [];
  for (const [what, set] of [
    ['from the book', (box) => comingBack(box, { recorded: true })],
    ['one nobody can place', (box) => comingBack(box, { unplaceable: true })],
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
