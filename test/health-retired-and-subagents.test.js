// `obk health` names only conversations nobody accounts for (#287).
//
// On a real fleet the "does not name" finding listed many conversations that
// are accounted for, and the one that really belonged to no one got lost among
// them. Two causes were seen, and each is a conversation the kit already knows
// is not a loose end:
//
//   1. A retired session's conversations. `obk retire` keeps them in the book,
//      under the top-level `retired:` list (ADR 0012), because those ids are the
//      way back to that history. A conversation the book keeps there is named.
//   2. Codex's own auto-review runs, and subagents a Codex session spawns. Codex
//      writes a rollout for each in the bot's folder like any conversation, but
//      the first line says so: `payload.source` is `{ subagent: … }` rather than
//      a plain word (`cli`, `exec`, `vscode`). Shapes read on this machine, Codex
//      0.156.1. Such a conversation is not a session's, so it is neither
//      reported as one the book does not name, nor noted by the hook as
//      unclaimed, nor listed from an `unclaimed` note that already holds it.
//
// And the finding still has to mean something: a plain conversation the book
// names nowhere is still reported, and a real unclaimed one is still noted and
// still listed. Every test here has one of those beside what it leaves out, so
// a check that went quiet altogether fails too.
//
// Everything goes through the CLI on a sandboxed bots folder, against the fake
// Orca, with HOME inside the sandbox: the harnesses' records are planted there,
// the way test/health.test.js and test/session-unclaimed.test.js plant them.

import assert from 'node:assert/strict';
import { mkdir, readFile, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import {
  bookIn,
  bookOf,
  botHomeOf,
  createSandbox,
  recordSession,
  sessionIn,
  skipOrcaFake,
  snapshot,
} from './helpers/cli.js';

// ------------------------------------------------------------------ the shapes

/** What Codex writes under `payload.source` for an auto-review run. */
const GUARDIAN = { subagent: { other: 'guardian' } };

/** What Codex writes under `payload.source` for a subagent a session spawned. */
const SPAWNED = {
  subagent: {
    thread_spawn: {
      parent_thread_id: '0199b2c0-ffff-4444-8888-cccccccccccc',
      depth: 1,
      agent_nickname: 'Mendel',
      agent_role: 'default',
    },
  },
};

const SUBAGENTS = [['a Codex auto-review run', GUARDIAN], ['a subagent a Codex session spawned', SPAWNED]];

/** The ids a conversation is known by in these tests: shaped the way both harnesses shape them. */
const conv = (n) => `0199b2c0-${String(n).padStart(4, '0')}-4444-8888-cccccccccccc`;

/** A moment on the day these conversations are set, as both harnesses write one. */
const onTheDay = (hour, minute = 0) =>
  `2026-09-20T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;

/**
 * A conversation where its harness keeps it, for the folder `home`.
 *
 * Codex: one rollout per conversation, filed by the day it started, whose first
 * line is `session_meta` with the id, the folder, the time and the source.
 * Claude Code: one file per conversation in a folder named after the working
 * directory. The file's own time matches what is written in it, so a kit that
 * reads either one finds the same answer.
 */
async function plant(box, harness, home, id, started, source = 'cli') {
  const file = harness === 'codex'
    ? path.join(
      box.home, '.codex', 'sessions', ...started.slice(0, 10).split('-'),
      `rollout-${started.replaceAll(':', '-').replace(/\..*$/, '')}-${id}.jsonl`,
    )
    : path.join(box.home, '.claude', 'projects', home.replaceAll(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  const first = harness === 'codex'
    ? { timestamp: started, type: 'session_meta', payload: { id, cwd: home, timestamp: started, source } }
    : { type: 'system', sessionId: id, cwd: home, timestamp: started };

  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(first)}\n`);
  await utimes(file, new Date(started), new Date(started));
  return file;
}

// ----------------------------------------------------------------- the fleet

/** A bots folder with Bot Father, and api-bot on `harness` with the sessions named, brought up. */
async function fleet(box, harness, sessions = ['daily']) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', harness]);
  assert.equal(made.code, 0, made.stderr);
  for (const name of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', name]);
    assert.equal(added.code, 0, added.stderr);
  }
  const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);
  assert.equal(up.code, 0, up.stderr);
  const bots = box.path('bots');
  return { bots, home: botHomeOf(bots, 'api-bot') };
}

/** Change what api-bot's book says about its sessions, as a person editing it by hand would. */
async function editBook(bots, change) {
  const file = bookOf(bots, 'api-bot');
  const book = parse(await readFile(file, 'utf8'));
  change(book.sessions);
  await writeFile(file, stringify(book));
}

/** Every string anywhere under a value. */
function stringsIn(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(stringsIn);
  return [];
}

// ---------------------------------------------------------------- the health check

/** Run the health check for JSON: findings, and exit 1 when there are any, 0 when none. */
async function found(box) {
  const result = await box.run(['health', '--bots', 'bots', '--json']);
  assert.equal(result.stderr, '', `a health run reports on stdout, and put this on stderr: ${result.stderr}`);
  const answer = JSON.parse(result.stdout);
  assert.ok(Array.isArray(answer.found), `the answer should carry a list of findings, got: ${result.stdout}`);
  assert.equal(result.code, answer.found.length === 0 ? 0 : 1, `exit code for ${answer.found.length} findings`);
  return answer;
}

/** The findings of one kind about api-bot. */
const ofApi = (answer, kind) => answer.found.filter((one) => one.kind === kind && one.bot === 'api-bot');

/** Everything one finding puts in front of a reader. */
const wordsOf = (finding) => `${finding.where} ${finding.says}`;

/** The findings that name `what` anywhere a reader would see it. */
const naming = (findings, what) => findings.filter((one) => wordsOf(one).includes(what));

/** Nothing here names `what`. */
function noneNaming(findings, what, why) {
  assert.deepEqual(naming(findings, what), [], `${why}: nothing should name ${what}, got: ${JSON.stringify(findings, null, 2)}`);
}

/**
 * The one "does not name" finding for api-bot, and it names `what`. There is one
 * such finding per bot however many conversations it lists (H27).
 */
function theNotNamedFinding(answer, what, why) {
  const mine = ofApi(answer, 'session');
  assert.equal(mine.length, 1, `${why}: one finding for what the book does not name, got: ${JSON.stringify(answer.found, null, 2)}`);
  assert.ok(wordsOf(mine[0]).includes(what), `${why}: it should name ${what}, got: ${wordsOf(mine[0])}`);
  return mine;
}

// ---------------------------------------------------------------------------
// 1. A retired session's conversations are named by the book.
// ---------------------------------------------------------------------------

for (const harness of ['claude', 'codex']) {
  test(`HR1 a retired ${harness} session's conversation, now and in its history, is not reported; a stray beside it is`, async (t) => {
    const box = await createSandbox(t);
    const { bots, home } = await fleet(box, harness, ['daily', 'review']);
    const [before, now, reviews, stray] = [conv(1), conv(2), conv(3), conv(4)];
    const book = await bookIn(bots, 'api-bot');
    await recordSession(box, { bots, bot: 'api-bot', tab: book.sessions.daily.tab, session: before, source: 'startup' });
    await recordSession(box, { bots, bot: 'api-bot', tab: book.sessions.daily.tab, session: now, source: 'clear' });
    await recordSession(box, { bots, bot: 'api-bot', tab: book.sessions.review.tab, session: reviews });

    const retired = await box.run(['retire', '--bots', 'bots', '--bot', 'api-bot', '--session', 'daily']);
    assert.equal(retired.code, 0, `the retirement this test stands on did not happen: ${retired.stderr}`);
    // The premise: the book keeps both of daily's conversations under retired:,
    // and on no live session.
    const after = await bookIn(bots, 'api-bot');
    assert.equal(after.sessions?.daily, undefined, `daily is off the live list, got: ${JSON.stringify(after)}`);
    const kept = stringsIn(after.retired ?? []);
    for (const id of [before, now]) {
      assert.ok(kept.includes(id), `the book should keep ${id} under retired:, got: ${JSON.stringify(after.retired)}`);
    }

    // The harness has every one of them on record in the bot's folder, and one
    // more that nobody ever had.
    for (const [n, id] of [before, now, reviews, stray].entries()) {
      await plant(box, harness, home, id, onTheDay(9 + n));
    }

    const answer = await found(box);

    const mine = theNotNamedFinding(answer, stray, 'no session, live or retired, ever had it');
    noneNaming(mine, now, 'the book names it as the retired session\'s last conversation');
    noneNaming(mine, before, 'the book names it in the retired session\'s history');
    noneNaming(mine, reviews, 'the book names it as review\'s conversation');
    noneNaming(answer.found, now, 'nothing else reports the retired session\'s conversation either');
    noneNaming(answer.found, before, 'nor the one in its history');
  });
}

test('HR2 a session retired with history hand-written in the book is named by every id it holds', async (t) => {
  // Real books carry retired entries written by earlier kits and by people, with
  // more than one conversation in the history. Every id there is named.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, 'codex', ['daily']);
  const [first, second, last, stray] = [conv(11), conv(12), conv(13), conv(14)];
  const file = bookOf(bots, 'api-bot');
  const book = parse(await readFile(file, 'utf8'));
  book.retired = [...(book.retired ?? []), {
    name: 'nightly',
    tab: 'tab_long_gone',
    launched: onTheDay(8),
    mailbox: 'api-bot.nightly',
    session: last,
    history: [
      { session: first, ended: 'clear', at: onTheDay(9, 30) },
      { session: second, ended: 'clear', at: onTheDay(10, 30) },
    ],
    retired: onTheDay(12),
  }];
  await writeFile(file, stringify(book));
  for (const [n, id] of [first, second, last, stray].entries()) {
    await plant(box, 'codex', home, id, onTheDay(9 + n));
  }

  const answer = await found(box);

  const mine = theNotNamedFinding(answer, stray, 'no session, live or retired, ever had it');
  for (const id of [first, second, last]) {
    noneNaming(mine, id, 'the retired entry in the book names it');
  }
});

// ---------------------------------------------------------------------------
// 2. A conversation Codex marks as a subagent's is not a session's.
// ---------------------------------------------------------------------------

for (const [label, source] of SUBAGENTS) {
  test(`HS1 ${label} is not reported as a conversation the book does not name; a plain one beside it is`, async (t) => {
    const box = await createSandbox(t);
    const { home } = await fleet(box, 'codex');
    const [subagent, plain] = [conv(21), conv(22)];
    await plant(box, 'codex', home, subagent, onTheDay(9), source);
    await plant(box, 'codex', home, plain, onTheDay(10), 'cli');

    const answer = await found(box);

    theNotNamedFinding(answer, plain, 'a plain conversation nobody accounts for');
    noneNaming(answer.found, subagent, `${label} is no session's conversation`);
  });
}

test('HS2 every plain source Codex writes is still a session\'s conversation, and reported when nobody has it', async (t) => {
  // `cli`, `exec` and `vscode` are the plain words seen on this machine. Only a
  // source that says `subagent` is left out; a plain word is an ordinary
  // conversation, a `codex exec` child's included.
  const box = await createSandbox(t);
  const { home } = await fleet(box, 'codex');
  const plain = [['cli', conv(31)], ['exec', conv(32)], ['vscode', conv(33)]];
  for (const [n, [source, id]] of plain.entries()) {
    await plant(box, 'codex', home, id, onTheDay(9 + n), source);
  }
  await plant(box, 'codex', home, conv(34), onTheDay(13), GUARDIAN);

  const answer = await found(box);

  const [finding] = theNotNamedFinding(answer, conv(31), 'a cli conversation nobody accounts for');
  for (const [source, id] of plain) {
    assert.ok(wordsOf(finding).includes(id), `the ${source} conversation ${id} is nobody's, got: ${wordsOf(finding)}`);
  }
  noneNaming(answer.found, conv(34), 'the auto-review run is no session\'s');
});

test('HS3 a bot whose only conversations the book does not name are subagents\' reports nothing', async (t) => {
  // Nothing is left over once they are out, so there is no finding at all, not
  // an empty one, and the run exits 0.
  const box = await createSandbox(t);
  const { home } = await fleet(box, 'codex');
  await plant(box, 'codex', home, conv(41), onTheDay(9), GUARDIAN);
  await plant(box, 'codex', home, conv(42), onTheDay(10), SPAWNED);
  await plant(box, 'codex', home, conv(43), onTheDay(11), GUARDIAN);

  const answer = await found(box);

  assert.deepEqual(answer.found, [], `nothing is wrong with this fleet, got: ${JSON.stringify(answer.found, null, 2)}`);
});

// ---------------------------------------------------------------------------
// 3. A subagent's id already in an `unclaimed` note is not listed as a leftover.
// ---------------------------------------------------------------------------

test('HS4 the leftover finding leaves out a subagent\'s id in an unclaimed note, and still lists a real one beside it', async (t) => {
  // Real books already hold such ids under a session's `unclaimed:` note. They
  // stay there (nothing is deleted from the book or the harness's records);
  // health just does not report them.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, 'codex');
  const [review, spawned, real] = [conv(51), conv(52), conv(53)];
  await plant(box, 'codex', home, review, onTheDay(9), GUARDIAN);
  await plant(box, 'codex', home, spawned, onTheDay(10), SPAWNED);
  await plant(box, 'codex', home, real, onTheDay(11), 'cli');
  await editBook(bots, (sessions) => {
    sessions.daily.unclaimed = [review, real, spawned];
  });
  const before = await snapshot(box.root, skipOrcaFake);

  const answer = await found(box);

  const leftovers = ofApi(answer, 'leftover');
  const said = naming(leftovers, real);
  assert.equal(said.length, 1, `the real unclaimed conversation is still listed, got: ${JSON.stringify(answer.found, null, 2)}`);
  assert.ok(wordsOf(said[0]).includes('daily'), `under the session the note sits under, got: ${wordsOf(said[0])}`);
  noneNaming(answer.found, review, 'an auto-review run is nobody\'s loose end');
  noneNaming(answer.found, spawned, 'a spawned subagent is nobody\'s loose end');
  assert.deepEqual(
    await snapshot(box.root, skipOrcaFake),
    before,
    'the note and the rollouts are left exactly as they were: health reports, it does not tidy',
  );
});

test('HS5 an unclaimed note holding only subagents\' ids makes no finding at all', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, 'codex');
  await plant(box, 'codex', home, conv(61), onTheDay(9), GUARDIAN);
  await plant(box, 'codex', home, conv(62), onTheDay(10), SPAWNED);
  await editBook(bots, (sessions) => {
    sessions.daily.unclaimed = [conv(61), conv(62)];
  });

  const answer = await found(box);

  assert.deepEqual(answer.found, [], `nothing is left over, got: ${JSON.stringify(answer.found, null, 2)}`);
  assert.deepEqual(
    (await sessionIn(bots, 'api-bot', 'daily')).unclaimed,
    [conv(61), conv(62)],
    'and the note is still in the book as it was written',
  );
});

// ---------------------------------------------------------------------------
// 4. The SessionStart hook does not note a subagent's conversation as unclaimed.
// ---------------------------------------------------------------------------

/** When the kit says it started a harness in daily's tab. */
async function launchedAt(bots) {
  const at = (await sessionIn(bots, 'api-bot', 'daily'))?.launched;
  assert.equal(typeof at, 'string', `the book should say when daily was launched, got: ${at}`);
  return new Date(Date.parse(at));
}

/** A few seconds after `when`, as the time a conversation began. */
const after = (when, seconds) => new Date(when.getTime() + seconds * 1000).toISOString();

/** The ids daily's `unclaimed` note holds, sorted. */
async function unclaimedIn(bots) {
  const listed = (await sessionIn(bots, 'api-bot', 'daily'))?.unclaimed ?? [];
  assert.ok(Array.isArray(listed), `unclaimed should be a list of ids, got: ${JSON.stringify(listed)}`);
  return [...listed].sort();
}

test('HS6 the hook notes a real unclaimed conversation and leaves subagents\' out of the note', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, 'codex');
  const launched = await launchedAt(bots);
  await plant(box, 'codex', home, 'the-lost-one', after(launched, 1), 'cli');
  await plant(box, 'codex', home, 'an-auto-review', after(launched, 2), GUARDIAN);
  await plant(box, 'codex', home, 'a-spawned-helper', after(launched, 3), SPAWNED);
  await plant(box, 'codex', home, 'the-new-one', after(launched, 60), 'cli');

  const ran = await recordSession(box, {
    bots, bot: 'api-bot', tab: (await sessionIn(bots, 'api-bot', 'daily')).tab, session: 'the-new-one',
  });

  assert.equal(ran.code, 0, ran.stderr);
  const daily = await sessionIn(bots, 'api-bot', 'daily');
  assert.equal(daily.session, 'the-new-one', `got: ${JSON.stringify(daily)}`);
  assert.deepEqual(
    await unclaimedIn(bots),
    ['the-lost-one'],
    `the plain conversation nobody claims is noted, and no subagent's is: ${JSON.stringify(daily)}`,
  );
});

test('HS7 a first report with only subagents\' conversations beside it writes no note', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, 'codex');
  const launched = await launchedAt(bots);
  await plant(box, 'codex', home, 'an-auto-review', after(launched, 1), GUARDIAN);
  await plant(box, 'codex', home, 'a-spawned-helper', after(launched, 2), SPAWNED);
  await plant(box, 'codex', home, 'sess-1', after(launched, 60), 'cli');

  const ran = await recordSession(box, {
    bots, bot: 'api-bot', tab: (await sessionIn(bots, 'api-bot', 'daily')).tab, session: 'sess-1',
  });

  assert.equal(ran.code, 0, ran.stderr);
  const daily = await sessionIn(bots, 'api-bot', 'daily');
  assert.equal(daily.session, 'sess-1', `got: ${JSON.stringify(daily)}`);
  assert.equal('unclaimed' in daily, false, `there is nothing nobody claims: ${JSON.stringify(daily)}`);
});

test('HS8 up notes a real unclaimed conversation for a session it relaunches, and leaves subagents\' out', async (t) => {
  // `up`'s own scan writes the same note: the session's tab ran a harness, the
  // book never learned its conversation, the tab is gone, and `up` brings it
  // back as a new conversation and writes down what the harness still had.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, 'codex');
  const launched = await launchedAt(bots);
  await plant(box, 'codex', home, 'the-lost-one', after(launched, 1), 'cli');
  await plant(box, 'codex', home, 'an-auto-review', after(launched, 2), GUARDIAN);
  await plant(box, 'codex', home, 'a-spawned-helper', after(launched, 3), SPAWNED);
  const tab = (await sessionIn(bots, 'api-bot', 'daily')).tab;
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.tabId !== tab) });

  const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(up.code, 0, up.stderr);
  const daily = await sessionIn(bots, 'api-bot', 'daily');
  assert.equal('session' in daily, false, `nothing is adopted: ${JSON.stringify(daily)}`);
  assert.deepEqual(
    await unclaimedIn(bots),
    ['the-lost-one'],
    `the plain conversation nobody claims is noted, and no subagent's is: ${JSON.stringify(daily)}`,
  );
  assert.ok(up.stdout.includes('the-lost-one'), `the report offers the plain one, got: ${up.stdout}`);
  for (const id of ['an-auto-review', 'a-spawned-helper']) {
    assert.ok(!up.stdout.includes(id), `and does not offer ${id}, got: ${up.stdout}`);
  }
});

// ---------------------------------------------------------------------------
// 5. Done when: a fleet with a retired session and auto-review runs reports
//    none of them, and still reports the conversation that belongs to no one.
// ---------------------------------------------------------------------------

test('HD1 on a fleet with a retired session and Codex auto-review runs, health names only the orphan', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, 'codex', ['daily', 'review']);
  const book = await bookIn(bots, 'api-bot');
  const [oldDaily, lastDaily, reviews] = [conv(71), conv(72), conv(73)];
  const reviewRuns = [conv(74), conv(75), conv(76)];
  const [helper, noted, orphan] = [conv(77), conv(78), conv(79)];
  await recordSession(box, { bots, bot: 'api-bot', tab: book.sessions.daily.tab, session: oldDaily });
  await recordSession(box, { bots, bot: 'api-bot', tab: book.sessions.daily.tab, session: lastDaily, source: 'clear' });
  await recordSession(box, { bots, bot: 'api-bot', tab: book.sessions.review.tab, session: reviews });
  const retired = await box.run(['retire', '--bots', 'bots', '--bot', 'api-bot', '--session', 'daily']);
  assert.equal(retired.code, 0, `the retirement this test stands on did not happen: ${retired.stderr}`);

  for (const [n, id] of [oldDaily, lastDaily, reviews, orphan].entries()) {
    await plant(box, 'codex', home, id, onTheDay(9 + n), 'cli');
  }
  for (const [n, id] of reviewRuns.entries()) await plant(box, 'codex', home, id, onTheDay(14, n), GUARDIAN);
  await plant(box, 'codex', home, helper, onTheDay(15), SPAWNED);
  await plant(box, 'codex', home, noted, onTheDay(16), GUARDIAN);
  await editBook(bots, (sessions) => {
    sessions.review.unclaimed = [noted];
  });

  const answer = await found(box);

  const all = answer.found.map(wordsOf).join('\n');
  assert.ok(all.includes(orphan), `the conversation that belongs to no one is still reported, got:\n${all}`);
  for (const id of [oldDaily, lastDaily, reviews, ...reviewRuns, helper, noted]) {
    assert.ok(!all.includes(id), `${id} is accounted for and should not be reported, got:\n${all}`);
  }
  assert.equal(
    answer.found.length,
    1,
    `the orphan is the one thing wrong with this fleet, got: ${JSON.stringify(answer.found, null, 2)}`,
  );
});
