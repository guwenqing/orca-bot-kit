// `obk health` finds a conversation no book names in a retired session's harness too (#573).
//
// Health reports the conversations a harness has on record in a bot's folder
// that the book names nowhere (PRD check 12). It read only the stores of the
// harnesses the bot's current sessions run on. A retired session's entry in the
// book, under the top-level `retired:` list, does not say which harness it ran
// on, so a conversation in the store of a harness that only a retired session
// used was never read, and an orphan there was never reported. On a real fleet
// a Claude-only bot with retired entries had Codex rollouts in its folder that
// no book entry named, and health said nothing about them.
//
// `obk usage` already reads every harness's store when the book has any retired
// entry, because any harness could be the retired one's. Health has to do the
// same. Both directions are pinned here: a Codex bot with a retired Claude
// session, and a Claude bot with a retired Codex session.
//
// What must not change, so a fix that reports too much fails:
//
//   - the retired session's own conversations are still named by the book;
//   - a Codex subagent or auto-review rollout found through the extra harness
//     is still no session's conversation;
//   - a bot with no retired entry still reads only its current sessions'
//     harnesses, so a conversation in another harness's store is not reported.
//
// Everything goes through the CLI on a sandboxed bots folder, against the fake
// Orca, with HOME inside the sandbox, the way
// test/health-retired-and-subagents.test.js plants the harnesses' records.

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
} from './helpers/cli.js';

// ------------------------------------------------------------------ the shapes

/** What Codex writes under `payload.source` for an auto-review run. */
const GUARDIAN = { subagent: { other: 'guardian' } };

/** What Codex writes under `payload.source` for a subagent a session spawned. */
const SPAWNED = {
  subagent: {
    thread_spawn: {
      parent_thread_id: '0199b2c0-ffff-4444-8888-dddddddddddd',
      depth: 1,
      agent_nickname: 'Mendel',
      agent_role: 'default',
    },
  },
};

/** The ids a conversation is known by in these tests: shaped the way both harnesses shape them. */
const conv = (n) => `0199b2c0-${String(n).padStart(4, '0')}-4444-8888-dddddddddddd`;

/** A moment on the day these conversations are set, as both harnesses write one. */
const onTheDay = (hour, minute = 0) =>
  `2026-09-20T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;

/** The other harness of the two whose stores these tests plant. */
const otherThan = (harness) => (harness === 'claude' ? 'codex' : 'claude');

/** Both directions: the harness the bot runs on now, and the one only a retired session ran on. */
const DIRECTIONS = [['codex', 'claude'], ['claude', 'codex']];

/**
 * A conversation where its harness keeps it, for the folder `home`.
 *
 * Codex: one rollout per conversation, filed by the day it started, whose first
 * line is `session_meta` with the id, the folder, the time and the source.
 * Claude Code: one file per conversation in a folder named after the working
 * directory. The file's own time matches what is written in it.
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

/**
 * A bots folder with Bot Father, and api-bot on `harness`, brought up. Each of
 * `sessions` is `[name]` on the bot's harness, or `[name, other]` on a harness
 * of its own (`session add --harness`).
 */
async function fleet(box, harness, sessions = [['daily']]) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', harness]);
  assert.equal(made.code, 0, made.stderr);
  for (const [name, own] of sessions) {
    const added = await box.run([
      'session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', name,
      ...(own === undefined ? [] : ['--harness', own]),
    ]);
    assert.equal(added.code, 0, added.stderr);
  }
  const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);
  assert.equal(up.code, 0, up.stderr);
  const bots = box.path('bots');
  return { bots, home: botHomeOf(bots, 'api-bot') };
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
// 1. A session on another harness is retired: its harness's store is still read.
// ---------------------------------------------------------------------------

for (const [now, then] of DIRECTIONS) {
  test(`RH1 a ${now} bot whose retired session ran on ${then}: an orphan in ${then}'s store is reported, the retired one's own is not`, async (t) => {
    const box = await createSandbox(t);
    const { bots, home } = await fleet(box, now, [['daily'], ['old', then]]);
    const [dailys, olds, orphan] = [conv(1), conv(2), conv(3)];
    const book = await bookIn(bots, 'api-bot');
    await recordSession(box, { bots, bot: 'api-bot', tab: book.sessions.daily.tab, session: dailys });
    await recordSession(box, { bots, bot: 'api-bot', tab: book.sessions.old.tab, session: olds });

    const retired = await box.run(['retire', '--bots', 'bots', '--bot', 'api-bot', '--session', 'old']);
    assert.equal(retired.code, 0, `the retirement this test stands on did not happen: ${retired.stderr}`);
    // The premise: old is off the live list, so no current session runs on its
    // harness, and the book keeps old's conversation under retired:.
    const after = await bookIn(bots, 'api-bot');
    assert.equal(after.sessions?.old, undefined, `old is off the live list, got: ${JSON.stringify(after)}`);
    assert.ok(stringsIn(after.retired ?? []).includes(olds), `the book should keep ${olds} under retired:, got: ${JSON.stringify(after.retired)}`);

    await plant(box, now, home, dailys, onTheDay(9));
    await plant(box, then, home, olds, onTheDay(10));
    await plant(box, then, home, orphan, onTheDay(11));

    const answer = await found(box);

    const mine = theNotNamedFinding(answer, orphan, `the ${then} conversation no session, live or retired, ever had`);
    noneNaming(mine, olds, 'the book names it as the retired session\'s conversation');
    noneNaming(mine, dailys, 'the book names it as daily\'s conversation');
    noneNaming(answer.found, olds, 'nothing else reports the retired session\'s conversation either');
  });
}

// ---------------------------------------------------------------------------
// 2. A retired entry hand-written in the book, as real books carry them: every
//    harness's store is read, and subagents found there are still nobody's.
// ---------------------------------------------------------------------------

test('RH2 a claude bot with a retired entry in its book: unclaimed Codex rollouts are reported, the retired one\'s and subagents\' are not', async (t) => {
  // The case seen live: a Claude-only bot, retired entries in the book, and
  // Codex rollouts in its folder that health did not report.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, 'claude', [['daily']]);
  const [first, last, orphan, review, spawned] = [conv(11), conv(12), conv(13), conv(14), conv(15)];
  const file = bookOf(bots, 'api-bot');
  const book = parse(await readFile(file, 'utf8'));
  book.retired = [...(book.retired ?? []), {
    name: 'nightly',
    tab: 'tab_long_gone',
    launched: onTheDay(8),
    mailbox: 'api-bot.nightly',
    session: last,
    history: [{ session: first, ended: 'clear', at: onTheDay(9, 30) }],
    retired: onTheDay(12),
  }];
  await writeFile(file, stringify(book));
  await plant(box, 'codex', home, first, onTheDay(9));
  await plant(box, 'codex', home, last, onTheDay(10));
  await plant(box, 'codex', home, orphan, onTheDay(11));
  await plant(box, 'codex', home, review, onTheDay(13), GUARDIAN);
  await plant(box, 'codex', home, spawned, onTheDay(14), SPAWNED);

  const answer = await found(box);

  theNotNamedFinding(answer, orphan, 'a Codex rollout no session, live or retired, ever had');
  for (const id of [first, last]) {
    noneNaming(answer.found, id, 'the retired entry in the book names it');
  }
  noneNaming(answer.found, review, 'a Codex auto-review run is no session\'s conversation');
  noneNaming(answer.found, spawned, 'a subagent a Codex session spawned is no session\'s conversation');
});

// ---------------------------------------------------------------------------
// 3. With no retired entry, health reads only the current sessions' harnesses.
// ---------------------------------------------------------------------------

for (const [now] of DIRECTIONS) {
  const other = otherThan(now);
  test(`RH3 a ${now} bot with no retired entry: a conversation in ${other}'s store is not reported; a stray in ${now}'s still is`, async (t) => {
    // Nothing in the book points at another harness, so its store is not this
    // bot's to read. The stray on the bot's own harness keeps the finding
    // honest: a check that went quiet altogether fails here too.
    const box = await createSandbox(t);
    const { bots, home } = await fleet(box, now, [['daily']]);
    const book = await bookIn(bots, 'api-bot');
    assert.equal((book.retired ?? []).length, 0, `the premise: no retired entry, got: ${JSON.stringify(book.retired)}`);
    const [elsewhere, stray] = [conv(21), conv(22)];
    await plant(box, other, home, elsewhere, onTheDay(9));
    await plant(box, now, home, stray, onTheDay(10));

    const answer = await found(box);

    theNotNamedFinding(answer, stray, `a ${now} conversation nobody accounts for`);
    noneNaming(answer.found, elsewhere, `no session of this bot, live or retired, runs on ${other}`);
  });
}
