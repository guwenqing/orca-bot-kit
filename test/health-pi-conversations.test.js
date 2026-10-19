// `obk health` and the conversations Pi has on record (#660, H2 and H3).
//
// The kit names a Pi session's id itself, writes it into the book at `up`,
// and Pi keeps the conversation under that id (tech notes, section 6). Pi
// keeps each conversation as one file in the bot folder's Pi store:
//
//   $HOME/.pi/agent/sessions/--<real path without leading />--/<stamp>_<id>.jsonl
//
// H2. For a Pi session of a bot (not paused), when the book's `session:` id
//     has no Pi record in the bot folder's store, AND Pi has on record in
//     that folder a conversation the book does not name anywhere, health
//     gives a `session` finding. It names the bot, the session and the id the
//     book holds, and says Pi has no record of it. Its words do not mention a
//     hook: the kit has no hook in Pi. No such finding when the book's id has
//     a record, or when no unnamed Pi conversation is in the folder: a fresh
//     session before its first turn has no record yet.
//
// H3. The finding "The harness has conversations on record in <bot>'s folder
//     that the book does not name: <id> (begun …) …" also comes for Pi
//     conversations. For Pi its words carry no hook explanation: not "hook",
//     not "Codex", not "a clear it did not record". Since #662 the kit's Pi
//     extension tells the book of a /new, so the words do not say nothing
//     tells the book: they name the extension, and say why this one was
//     missed (the tab ran without the extension, or its record went wrong).
//     It still names each id, and tells how to give one to a session: write
//     it into the book under that session as `session: <id>`. For Claude Code and Codex conversations
//     the finding keeps its words, the hook explanation included.
//
// The wording beyond those words is the implementer's. Every run is in the
// sandbox (helpers/cli.js), with a fake `pi` on PATH (helpers/pi.js). Pi's
// records are planted under the sandbox's HOME. Nothing here reaches the real
// `pi`, the real ~/.pi or the real Orca.

import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import { bookOf, botHomeOf, createSandbox, sessionIn } from './helpers/cli.js';
import { fakePi, piLines, piSessionOnRecord } from './helpers/pi.js';

const KINDS = ['orca', 'config', 'skill', 'session', 'leftover', 'process', 'mail'];

// ---------------------------------------------------------------- the fleet

/** Run one more `obk` command that has to work for the test to mean anything. */
async function obk(box, ...args) {
  const result = await box.run([...args]);
  assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return result;
}

/** A bots folder with Bot Father up in Orca, and the fake `pi` on PATH. */
async function seeded(box) {
  await fakePi(box);
  await obk(box, 'init', '--bots', 'bots', '--harness', 'claude');
  return box.path('bots');
}

/** One more bot on `harness`, with the sessions named, brought up in Orca. Answers its folder. */
async function botUp(box, name, { harness = 'pi', sessions = ['daily'] } = {}) {
  await obk(box, 'bot', 'create', '--bots', 'bots', '--name', name, '--harness', harness);
  for (const session of sessions) await obk(box, 'session', 'add', '--bots', 'bots', '--bot', name, '--name', session);
  await obk(box, 'up', '--bots', 'bots', '--bot', name);
  return botHomeOf(box.path('bots'), name);
}

/** Change what one bot's book says about its sessions, as a person editing it by hand would. */
async function editBook(bots, bot, change) {
  const file = bookOf(bots, bot);
  const book = parse(await readFile(file, 'utf8'));
  change(book.sessions);
  await writeFile(file, stringify(book));
}

/** The id the book holds for one session: the one the kit chose for Pi at `up`. */
async function bookIdOf(bots, bot, session) {
  const id = (await sessionIn(bots, bot, session))?.session;
  assert.equal(typeof id, 'string', `the premise: the book holds an id for ${bot} ${session}, got: ${id}`);
  return id;
}

// ------------------------------------------------------------- the records

/** A moment on the day these records are set. */
const onTheDay = (hour, minute = 0) =>
  `2026-10-19T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;

/** A conversation id, shaped as the kit chooses one. */
const conv = (n) => `0199c0de-${String(n).padStart(4, '0')}-4444-8888-dddddddddddd`;

/** Leave a Pi conversation on record in `home`'s Pi store, begun at `at`, after one turn. */
const piOnRecord = (box, home, id, at = onTheDay(9)) => piSessionOnRecord({
  home: box.home,
  cwd: home,
  id,
  at: new Date(at),
  lines: [piLines.user('Carry on with the queue.', new Date(at), 1), piLines.assistant('OK', new Date(at), 2)],
});

/** Plant a Claude Code or Codex conversation where its harness keeps it, as test/health.test.js (H27) does. */
async function plantConversation(box, harness, home, id, started) {
  const file = harness === 'codex'
    ? path.join(box.home, '.codex', 'sessions', ...started.slice(0, 10).split('-'), `rollout-${started.replaceAll(':', '-').replace(/\..*$/, '')}-${id}.jsonl`)
    : path.join(box.home, '.claude', 'projects', home.replaceAll(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  const first = harness === 'codex'
    ? { timestamp: started, type: 'session_meta', payload: { id, cwd: home, timestamp: started } }
    : { type: 'system', sessionId: id, cwd: home, timestamp: started };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(first)}\n`);
}

// ------------------------------------------------------------- what it answers

/** Run the health check for JSON, and hold it to the shape every finding has and to the exit code. */
async function found(box) {
  const result = await box.run(['health', '--bots', 'bots', '--json']);
  assert.equal(result.stderr, '', `a health run reports on stdout, and put this on stderr: ${result.stderr}`);
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  for (const finding of answer.found) {
    assert.ok(KINDS.includes(finding.kind), `a finding's kind is one of ${KINDS.join(', ')}, got: ${JSON.stringify(finding)}`);
    assert.ok(typeof finding.where === 'string' && finding.where.trim() !== '', `a finding says what it is about, got: ${JSON.stringify(finding)}`);
    assert.ok(typeof finding.says === 'string' && finding.says.trim() !== '', `a finding says something, got: ${JSON.stringify(finding)}`);
  }
  assert.equal(result.code, answer.found.length === 0 ? 0 : 1, `${answer.found.length} findings, exit ${result.code}`);
  return answer;
}

/** Everything one finding puts in front of a reader. */
const wordsOf = (finding) => `${finding.where} ${finding.says}`;

/** Whether `word` is in `text` as a word of its own, not inside another. */
const hasWord = (text, word) => new RegExp(`(^|[^A-Za-z0-9_-])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9_-])`).test(text);

/** The findings that name `what` anywhere a reader would see it. */
const naming = (findings, what) => findings.filter((one) => wordsOf(one).includes(what));

/** Words a Pi finding must not carry: the kit has no hook in Pi. */
const HOOK_WORDS = [/hook/i, /codex/i, /a clear it did not record/i];

function assertNoHookWords(finding, what) {
  for (const words of HOOK_WORDS) {
    assert.doesNotMatch(wordsOf(finding), words, `${what}: the kit has no hook in Pi, so it says nothing like ${words}, got: ${finding.says}`);
  }
}

/**
 * The one H2 finding about one Pi session: kind `session`, the bot, and words
 * that name the session and the id the book holds, and say Pi has no record
 * of it, with no hook in them.
 */
function assertNoRecordOf(answer, bot, session, id) {
  const mine = naming(answer.found.filter((one) => one.bot === bot), id);
  assert.equal(mine.length, 1, `one finding names ${bot} ${session}'s book id ${id}, got: ${JSON.stringify(answer.found, null, 2)}`);
  const [finding] = mine;
  assert.equal(finding.kind, 'session', `it is a finding about a session, got: ${JSON.stringify(finding)}`);
  assert.ok(hasWord(finding.says, session), `it names the session ${session}, got: ${finding.says}`);
  assert.ok(wordsOf(finding).includes(bot), `and the bot ${bot}, got: ${finding.says}`);
  assert.match(finding.says, /\bPi\b/, `it says it is Pi that has no record, got: ${finding.says}`);
  assert.match(finding.says, /record/i, `and that Pi has no record of that id, got: ${finding.says}`);
  assert.match(finding.says, /\b(?:no|not|none|never)\b/i, `it says the record is not there, got: ${finding.says}`);
  assertNoHookWords(finding, `${bot} ${session}'s id with no record`);
  return finding;
}

/** The one finding that names the conversations the book does not name in one bot's folder. */
function unnamedFinding(answer, bot, ids) {
  const mine = answer.found.filter((one) => one.kind === 'session' && one.bot === bot && ids.some((id) => wordsOf(one).includes(id)));
  assert.equal(mine.length, 1, `one finding names ${bot}'s conversations the book does not name, got: ${JSON.stringify(answer.found, null, 2)}`);
  for (const id of ids) assert.ok(wordsOf(mine[0]).includes(id), `it names ${id}, got: ${mine[0].says}`);
  return mine[0];
}

// ---------------------------------------------------------------------------
// H2 — the book holds an id Pi has no record of.
// ---------------------------------------------------------------------------

test('H2 a Pi session whose book id has no record, in a folder where Pi has a conversation the book does not name, is named with that id; a fresh Pi bot beside it, with no record at all, is not', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const pier = await botUp(box, 'pier');
  await botUp(box, 'fresh');
  // pier's conversation went on under another id than the book's. The
  // unnamed conversation is in pier's folder only: fresh has none of its own.
  await piOnRecord(box, pier, conv(1));
  const held = await bookIdOf(bots, 'pier', 'daily');

  const answer = await found(box);

  assertNoRecordOf(answer, 'pier', 'daily', held);
  const fresh = await bookIdOf(bots, 'fresh', 'daily');
  assert.deepEqual(naming(answer.found, fresh), [], `fresh has had no first turn yet, which is not a finding, got: ${JSON.stringify(answer.found, null, 2)}`);
  assert.deepEqual(answer.found.filter((one) => one.bot === 'fresh'), [], `nothing at all is wrong with fresh, got: ${JSON.stringify(answer.found, null, 2)}`);
});

test('H2 a Pi session whose book id has a record gets no such finding, though Pi has another conversation the book does not name', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const pier = await botUp(box, 'pier', { sessions: ['daily', 'review'] });
  const daily = await bookIdOf(bots, 'pier', 'daily');
  const review = await bookIdOf(bots, 'pier', 'review');
  await piOnRecord(box, pier, daily, onTheDay(9));
  await piOnRecord(box, pier, conv(1), onTheDay(10));

  const answer = await found(box);

  assert.deepEqual(naming(answer.found, daily), [], `daily's id has a record, got: ${JSON.stringify(answer.found, null, 2)}`);
  // The contrast: review's id has none, beside the same unnamed conversation.
  assertNoRecordOf(answer, 'pier', 'review', review);
});

test('H2 a conversation the book names in a session\'s history is not one it leaves unnamed: no such finding; the same conversation unnamed in another bot is', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const pier = await botUp(box, 'pier', { sessions: ['daily', 'review'] });
  const other = await botUp(box, 'other');
  const daily = await bookIdOf(bots, 'pier', 'daily');
  const review = await bookIdOf(bots, 'pier', 'review');
  // The same state in both bots, but for the one line of history in pier's book.
  await piOnRecord(box, pier, conv(1));
  await piOnRecord(box, other, conv(2));
  await editBook(bots, 'pier', (sessions) => {
    sessions.review.history = [{ session: conv(1), ended: 'clear', at: onTheDay(9, 30) }];
  });

  const answer = await found(box);

  assert.deepEqual(naming(answer.found, daily), [], `the only conversation on record is one the book names, got: ${JSON.stringify(answer.found, null, 2)}`);
  assert.deepEqual(naming(answer.found, review), [], `the same for review, got: ${JSON.stringify(answer.found, null, 2)}`);
  assert.deepEqual(naming(answer.found, conv(1)), [], `and the book names conv(1), got: ${JSON.stringify(answer.found, null, 2)}`);
  assertNoRecordOf(answer, 'other', 'daily', await bookIdOf(bots, 'other', 'daily'));
});

test('H2 a paused Pi session gets no such finding; its running sibling does', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const pier = await botUp(box, 'pier', { sessions: ['daily', 'night'] });
  const daily = await bookIdOf(bots, 'pier', 'daily');
  const night = await bookIdOf(bots, 'pier', 'night');
  await obk(box, 'pause', '--bots', 'bots', '--bot', 'pier', '--session', 'night');
  assert.equal(await bookIdOf(bots, 'pier', 'night'), night, 'the premise: the pause kept night\'s id in the book');
  await piOnRecord(box, pier, conv(1));

  const answer = await found(box);

  assertNoRecordOf(answer, 'pier', 'daily', daily);
  assert.deepEqual(naming(answer.found, night), [], `night is paused, got: ${JSON.stringify(answer.found, null, 2)}`);
});

// ---------------------------------------------------------------------------
// H3 — Pi conversations the book does not name.
// ---------------------------------------------------------------------------

test('H3 Pi conversations the book does not name are named, each id with when it began, with how to give one to a session, and no word of a hook', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const pier = await botUp(box, 'pier');
  // The book's own id has its record, so only the unnamed ones are at issue.
  const held = await bookIdOf(bots, 'pier', 'daily');
  await piOnRecord(box, pier, held, onTheDay(8));
  await piOnRecord(box, pier, conv(1), onTheDay(9, 15));
  await piOnRecord(box, pier, conv(2), onTheDay(11, 40));

  const answer = await found(box);

  const finding = unnamedFinding(answer, 'pier', [conv(1), conv(2)]);
  const words = wordsOf(finding);
  assert.ok(words.includes('2026-10-19T09:15') && words.includes('2026-10-19T11:40'), `it says when each began, got: ${words}`);
  assert.match(words, /session:/, `it says to write the id in the book as session: <id>, got: ${words}`);
  assert.match(words, /sessions\.yaml|\bbook\b/, `in the book, got: ${words}`);
  assertNoHookWords(finding, 'the Pi conversations the book does not name');
  // Since #662 the kit's Pi extension tells the book of a /new. So the words
  // do not say nothing tells the book; they name the extension, and say why
  // this one was missed: the tab ran without the extension (Orca brought it
  // back by itself, or the kit started it before it had the extension), or
  // the extension's record went wrong.
  assert.doesNotMatch(words, /nothing tells the book/i, `the kit's Pi extension tells the book of a /new now, got: ${words}`);
  assert.match(words, /extension/i, `it names the kit's Pi extension as what tells the book of a /new, got: ${words}`);
  assert.match(
    words,
    /without (?:the |its |that |the kit's |a )?(?:Pi )?extension|no extension|not have (?:the |its )?extension|(?:Orca|by itself)[^.]*(?:brought|restor|resum|reopen)/i,
    `it says the tab may have run without the extension, as one Orca brought back by itself, got: ${words}`,
  );
  assert.match(
    words,
    /(?:record|extension)[^.]*(?:went wrong|failed|fail|error|did not work|didn't work)/i,
    `it says the extension's record may have gone wrong, got: ${words}`,
  );
  assert.ok(!words.includes(held), `the book names ${held}, so it is not one of them, got: ${words}`);
  assert.deepEqual(naming(answer.found.filter((one) => one.bot === 'bot-father'), conv(1)), [], 'it ran in pier\'s folder, not Bot Father\'s');
});

for (const harness of ['claude', 'codex']) {
  test(`H3 a ${harness} conversation the book does not name keeps the finding's words, the hook explanation included`, async (t) => {
    // A description of what the kit does today, kept so the Pi change does
    // not take the explanation from the harnesses that have a hook.
    const box = await createSandbox(t);
    await seeded(box);
    const home = await botUp(box, 'api-bot', { harness });
    await plantConversation(box, harness, home, conv(1), onTheDay(9, 15));

    const answer = await found(box);

    const finding = unnamedFinding(answer, 'api-bot', [conv(1)]);
    assert.match(finding.says, /hook/i, `the kit's hook may have missed it, and the finding says so, got: ${finding.says}`);
    assert.match(wordsOf(finding), /session:/, `it says how to give it to a session, got: ${finding.says}`);
  });
}
