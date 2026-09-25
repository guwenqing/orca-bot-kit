// `obk health` names a session whose tab is live with only its shell in front
// as not running, with the restart that brings it back (#300).
//
// A tab stays open after its harness quits or crashes, and then the tab's shell
// is in front. Since #271 health reads each live tab's front the way the kit
// does before it types into one (ADR 0021): Orca's pane pid, then `ps`. With
// the shell in front the session gets no `sessions` entry and no settings or
// rules finding (S8 in test/session-settings.test.js), and until #300 nothing
// else either: the user is not told the session is down. `obk up` finds the
// tab live and types nothing, so the command that brings it back is `obk
// restart … --session <name>`, and the finding names it: with a conversation in
// the book the restart resumes it, and since #303 with none it closes the tab
// and starts the session fresh (D5). Health still does not bring it back
// itself.
//
// A front that cannot be read, or holds a program that is not the session's
// harness, is "cannot tell" (running: unknown), never down: no such finding and
// no such command. A paused session and a session whose tab is gone are not
// this finding's either; the gone tab has its own.
//
// The wording of the sentence is the implementer's. What is pinned is that it
// calls the session not running (or down), names the bot and the session, and
// carries the command for them: the kit's own CLI, as every command the kit
// prints does (#220), then `restart` or `up` with the bots folder, the bot and
// the session. Everything runs against the fake Orca and the fake `ps`.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import {
  bookOf,
  createSandbox,
  orcaCommand,
  sessionIn,
  shellWord,
  skipOrcaFake,
  snapshot,
  spellingsOf,
} from './helpers/cli.js';
import { botYamlOf } from './helpers/skills.js';

/** The kinds a finding can be. */
const KINDS = ['orca', 'config', 'skill', 'session', 'leftover'];

/** The two ways the fake puts a tab's shell in front: under `login`, and as the pane itself. */
const SHELLS = ['shell', 'bare-shell'];

/**
 * The fronts that are not the session's harness and not its shell: the ones
 * that cannot be read, and another program in front. Each is "cannot tell".
 */
const CANNOT_TELL = ['no-pid', 'ps-fails', 'garbage', 'no-tpgid', 'gone', 'program', 'other-harness'];

// ---------------------------------------------------------------- the fleet

/** A bots folder with Bot Father up in Orca. */
async function seeded(box) {
  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(result.code, 0, result.stderr);
  return box.path('bots');
}

/** Run one more `obk` command that has to work for the test to mean anything. */
async function obk(box, ...args) {
  const result = await box.run([...args]);
  assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stderr}${result.stdout}`);
  return result;
}

/** One more bot on `harness`, with the sessions named, brought up in Orca. */
async function botUp(box, name, { harness = 'claude', sessions = ['daily'] } = {}) {
  await obk(box, 'bot', 'create', '--bots', 'bots', '--name', name, '--harness', harness);
  for (const session of sessions) {
    await obk(box, 'session', 'add', '--bots', 'bots', '--bot', name, '--name', session);
  }
  await obk(box, 'up', '--bots', 'bots', '--bot', name);
}

/** Give every named session of a bot a conversation in the book, so that pause and restart will take it. */
async function conversationsFor(bots, bot, names) {
  const file = bookOf(bots, bot);
  const book = parse(await readFile(file, 'utf8'));
  for (const [n, name] of names.entries()) {
    book.sessions[name].session = `0199b2c0-${String(50 + n).padStart(4, '0')}-4444-8888-cccccccccccc`;
  }
  await writeFile(file, stringify(book));
}

/** Put `front` in front of one session's tab alone, in the fake Orca's world. */
async function frontOf(box, bots, bot, session, front) {
  const { tab } = await sessionIn(bots, bot, session);
  const terminals = await box.orca.terminals();
  assert.ok(terminals.some((one) => one.tabId === tab), `the premise: Orca has ${bot} ${session}'s tab ${tab}`);
  await box.orca.set({ terminals: terminals.map((one) => (one.tabId === tab ? { ...one, foreground: front } : one)) });
}

// ------------------------------------------------------------- what it answers

/** Run the health check. */
const health = (box, ...rest) => box.run(['health', '--bots', 'bots', ...rest]);

/**
 * Run the health check for JSON and hold it to its shape: findings of the
 * kinds there are, each saying where and what, a list of sessions, and the exit
 * code the findings call for (1 when there is one, 0 when there is none).
 */
async function found(box, ...rest) {
  const result = await health(box, ...rest, '--json');
  assert.equal(result.stderr, '', `a health run reports on stdout, and put this on stderr: ${result.stderr}`);
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  assert.ok(Array.isArray(answer.found), `the answer should carry a list of findings, got: ${result.stdout}`);
  for (const finding of answer.found) {
    assert.ok(KINDS.includes(finding.kind), `a finding's kind is one of ${KINDS.join(', ')}, got: ${JSON.stringify(finding)}`);
    assert.ok(typeof finding.where === 'string' && finding.where.trim() !== '', `a finding says what it is about, got: ${JSON.stringify(finding)}`);
    assert.ok(typeof finding.says === 'string' && finding.says.trim() !== '', `a finding says something, got: ${JSON.stringify(finding)}`);
  }
  assert.ok(Array.isArray(answer.sessions), `the answer should carry a list of sessions, got: ${result.stdout}`);
  assert.equal(
    result.code,
    answer.found.length === 0 ? 0 : 1,
    `${answer.found.length} findings should exit ${answer.found.length === 0 ? 0 : 1}, got ${result.code}`,
  );
  return answer;
}

/** Everything one finding puts in front of a reader. */
const wordsOf = (finding) => `${finding.where} ${finding.says}`;

/** Whether `word` is in `text` as a word of its own, not inside another. */
const hasWord = (text, word) => new RegExp(`(^|[^A-Za-z0-9_-])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9_-])`).test(text);

/** The findings about one session of one bot: the bot's own, naming the session. */
const about = (answer, bot, session) => answer.found.filter((one) => one.bot === bot && hasWord(wordsOf(one), session));

/** Words that call a session not running. */
const NOT_RUNNING = /\b(?:not|isn't|is no longer|no longer)\s+running\b|\bdown\b/i;

/** Every run of whitespace as one space, so an indented or re-wrapped sentence still reads the same. */
const flat = (text) => text.replace(/\s+/g, ' ').trim();

/** Whether `says` carries the kit's own CLI running `verb` (`restart`, `up`). */
const commandIn = (says, box, verb) => spellingsOf(box.cli).some((cli) => says.includes(`${cli} ${verb} `));

/**
 * Hold `says` to carrying the command that brings one session back: the kit's
 * own CLI running `verb`, with the bots folder, the bot and the session.
 */
function assertCommandIn(says, box, bots, bot, session, verb) {
  assert.ok(commandIn(says, box, verb), `the command is the kit's own CLI, ${shellWord(box.cli)}, running ${verb}, got: ${says}`);
  assert.ok(
    spellingsOf(bots).some((word) => says.includes(`--bots ${word}`)),
    `the ${verb} names the bots folder, ${shellWord(bots)}, got: ${says}`,
  );
  assert.ok(says.includes(`--bot ${bot}`), `the ${verb} names the bot, got: ${says}`);
  assert.ok(hasWord(says, `--session ${session}`), `the ${verb} names the session, got: ${says}`);
}

/**
 * The one finding that calls a session not running, with the restart that
 * brings it back, and its plain lines: a line with its kind and where, then
 * what it says.
 */
function assertReportedDown(answer, plain, box, bots, bot, session) {
  const mine = about(answer, bot, session);
  assert.equal(mine.length, 1, `one finding about ${bot} ${session}, whose harness quit, got: ${JSON.stringify(answer.found, null, 2)}`);
  const { says } = mine[0];
  assert.ok(hasWord(says, session), `it names the session, got: ${says}`);
  assert.ok(says.includes(bot), `and the bot, got: ${says}`);
  assert.match(says, NOT_RUNNING, `it says the session is not running, got: ${says}`);
  assertCommandIn(says, box, bots, bot, session, 'restart');
  assert.ok(!commandIn(says, box, 'up'), `the restart brings it back, so no up is offered, got: ${says}`);
  assert.ok(
    !answer.sessions.some((one) => one.bot === bot && one.session === session && one.running === 'yes'),
    `a session with its shell in front is not said to be running, got: ${JSON.stringify(answer.sessions, null, 2)}`,
  );

  assert.equal(plain.code, 1, `the plain run finds the same, got: ${plain.stdout}${plain.stderr}`);
  assert.equal(plain.stderr, '');
  assert.ok(
    plain.stdout.split('\n').some((line) => line.includes(mine[0].kind) && line.includes(mine[0].where)),
    `one plain line holds the finding's kind and where, got:\n${plain.stdout}`,
  );
  assert.ok(flat(plain.stdout).includes(flat(says)), `and the plain lines say what the JSON says, got:\n${plain.stdout}`);
}

/** Words that say the kit cannot tell, as S8 in test/session-settings.test.js reads them. */
const CANNOT_TELL_WORDS = /\b(whether|cannot|can't|could not|couldn't|unknown|unable)\b/i;

/**
 * Nothing health says, in JSON or in plain lines, calls one session not
 * running or offers its restart. A sentence that says it cannot tell whether
 * the session is running or down is not calling it down.
 */
function assertNotCalledDown(answer, plain, bot, session) {
  const why = `${bot} ${session} is not known to be down`;
  for (const one of about(answer, bot, session).filter((finding) => !CANNOT_TELL_WORDS.test(finding.says))) {
    assert.doesNotMatch(one.says, NOT_RUNNING, `${why}, got: ${JSON.stringify(one)}`);
  }
  const restart = answer.found.filter((one) => one.bot === bot && /\brestart\b/.test(one.says) && hasWord(one.says, `--session ${session}`));
  assert.deepEqual(restart, [], `${why}, so no finding offers its restart`);
  for (const line of plain.stdout.split('\n').filter((one) => hasWord(one, session) && !CANNOT_TELL_WORDS.test(one))) {
    assert.doesNotMatch(line, NOT_RUNNING, `${why}: no plain line about it says so, got: ${line}`);
  }
  assert.deepEqual(
    plain.stdout.split('\n').filter((line) => line.includes(`--bot ${bot}`) && hasWord(line, `--session ${session}`)),
    [],
    `${why}: the plain lines offer no command for it`,
  );
}

// ---------------------------------------------------------------------------
// D1 — the shell in front is not running, with the restart, on both harnesses.
// ---------------------------------------------------------------------------

for (const harness of ['claude', 'codex']) {
  for (const shell of SHELLS) {
    test(`D1 ${harness}: a session whose tab has its ${shell} in front is reported not running, with its restart, in JSON and plain lines, and health exits 1`, async (t) => {
      const box = await createSandbox(t);
      const bots = await seeded(box);
      await botUp(box, 'api-bot', { harness, sessions: ['daily', 'review'] });
      await conversationsFor(bots, 'api-bot', ['daily', 'review']);
      await frontOf(box, bots, 'api-bot', 'review', shell);

      const answer = await found(box);
      const plain = await health(box);

      assertReportedDown(answer, plain, box, bots, 'api-bot', 'review');

      // The sibling beside it has its harness in front, and nothing else is wrong
      // with this fleet: the one finding is review's.
      const daily = answer.sessions.find((one) => one.bot === 'api-bot' && one.session === 'daily');
      assert.equal(daily?.running, 'yes', `daily's harness is in front, got: ${JSON.stringify(answer.sessions, null, 2)}`);
      assertNotCalledDown(answer, plain, 'api-bot', 'daily');
      assert.equal(answer.found.length, 1, `review's is the only finding, got: ${JSON.stringify(answer.found, null, 2)}`);
    });
  }
}

test('D1 two sessions of one bot with their shells in front are each reported, each with its own restart', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: ['daily', 'review', 'nightly'] });
  await conversationsFor(bots, 'api-bot', ['daily', 'review', 'nightly']);
  await frontOf(box, bots, 'api-bot', 'daily', 'shell');
  await frontOf(box, bots, 'api-bot', 'nightly', 'bare-shell');

  const answer = await found(box);
  const plain = await health(box);

  assertReportedDown(answer, plain, box, bots, 'api-bot', 'daily');
  assertReportedDown(answer, plain, box, bots, 'api-bot', 'nightly');
  assertNotCalledDown(answer, plain, 'api-bot', 'review');
});

// ---------------------------------------------------------------------------
// D2 — a front that cannot be read, or another program, is never down.
// ---------------------------------------------------------------------------

for (const front of CANNOT_TELL) {
  test(`D2 a tab whose front is ${front} stays running: unknown and is never called down, beside a sibling whose shell is in front and is`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await botUp(box, 'api-bot', { sessions: ['daily', 'review'] });
    await conversationsFor(bots, 'api-bot', ['daily', 'review']);
    await frontOf(box, bots, 'api-bot', 'daily', front);
    await frontOf(box, bots, 'api-bot', 'review', 'shell');

    const answer = await found(box);
    const plain = await health(box);

    // The contrast: the same run does report a session that is down.
    assertReportedDown(answer, plain, box, bots, 'api-bot', 'review');

    const daily = answer.sessions.filter((one) => one.bot === 'api-bot' && one.session === 'daily');
    assert.equal(daily.length, 1, `daily keeps its entry, got: ${JSON.stringify(answer.sessions, null, 2)}`);
    assert.equal(daily[0].running, 'unknown', `nothing says whether daily's harness is there, got: ${JSON.stringify(daily[0])}`);
    assertNotCalledDown(answer, plain, 'api-bot', 'daily');
  });
}

test('D2 a Codex tab with claude in front is never called down, beside a Codex sibling whose shell is in front', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { harness: 'codex', sessions: ['daily', 'review'] });
  await conversationsFor(bots, 'api-bot', ['daily', 'review']);
  await frontOf(box, bots, 'api-bot', 'daily', 'other-harness');
  await frontOf(box, bots, 'api-bot', 'review', 'bare-shell');

  const answer = await found(box);
  const plain = await health(box);

  assertReportedDown(answer, plain, box, bots, 'api-bot', 'review');
  assert.equal(answer.sessions.find((one) => one.bot === 'api-bot' && one.session === 'daily')?.running, 'unknown');
  assertNotCalledDown(answer, plain, 'api-bot', 'daily');
});

// ---------------------------------------------------------------------------
// D3 — a paused session and a gone tab are not this finding's.
// ---------------------------------------------------------------------------

test('D3 a paused session and a session whose tab is gone are not reported as not running, beside one whose shell is in front', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: ['daily', 'review', 'nightly'] });
  await conversationsFor(bots, 'api-bot', ['daily', 'review', 'nightly']);
  await obk(box, 'pause', '--bots', 'bots', '--bot', 'api-bot', '--session', 'daily');
  const gone = (await sessionIn(bots, 'api-bot', 'nightly')).tab;
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.tabId !== gone) });
  await frontOf(box, bots, 'api-bot', 'review', 'shell');

  const answer = await found(box);
  const plain = await health(box);

  assertReportedDown(answer, plain, box, bots, 'api-bot', 'review');

  assertNotCalledDown(answer, plain, 'api-bot', 'daily');
  assert.deepEqual(about(answer, 'api-bot', 'daily'), [], 'a paused session is not reported at all');

  assertNotCalledDown(answer, plain, 'api-bot', 'nightly');
  const nightly = about(answer, 'api-bot', 'nightly');
  assert.equal(nightly.length, 1, `the gone tab keeps its one finding, and gets no second, got: ${JSON.stringify(nightly, null, 2)}`);
  assert.ok(wordsOf(nightly[0]).includes(gone), `and that finding names the tab, got: ${JSON.stringify(nightly[0])}`);
});

test('D3 a session paused in bot.yaml by hand, its tab still open with the shell in front, is not reported as not running', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: ['daily', 'review'] });
  await conversationsFor(bots, 'api-bot', ['daily', 'review']);
  // What `obk pause` writes into bot.yaml, with the book and the tab left as
  // they were: a person who paused daily by editing bot.yaml.
  const book = await readFile(bookOf(bots, 'api-bot'), 'utf8');
  const terminals = await box.orca.terminals();
  const unpaused = await readFile(botYamlOf(bots, 'api-bot'), 'utf8');
  await obk(box, 'pause', '--bots', 'bots', '--bot', 'api-bot', '--session', 'daily');
  assert.notEqual(await readFile(botYamlOf(bots, 'api-bot'), 'utf8'), unpaused, 'the premise: the pause is written in bot.yaml');
  await writeFile(bookOf(bots, 'api-bot'), book);
  await box.orca.set({ terminals });
  await frontOf(box, bots, 'api-bot', 'daily', 'shell');
  await frontOf(box, bots, 'api-bot', 'review', 'shell');

  const answer = await found(box);
  const plain = await health(box);

  assertReportedDown(answer, plain, box, bots, 'api-bot', 'review');
  assertNotCalledDown(answer, plain, 'api-bot', 'daily');
});

// ---------------------------------------------------------------------------
// D4 — the restart it names brings the session back, and health writes nothing.
// ---------------------------------------------------------------------------

test('D4 after the restart the finding names, the session runs again and the finding is gone', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: ['daily', 'review'] });
  await conversationsFor(bots, 'api-bot', ['daily', 'review']);
  await frontOf(box, bots, 'api-bot', 'review', 'shell');

  const before = await found(box);
  assertReportedDown(before, await health(box), box, bots, 'api-bot', 'review');

  await obk(box, 'restart', '--bots', 'bots', '--bot', 'api-bot', '--session', 'review');
  const after = await found(box);

  assert.equal(
    after.sessions.find((one) => one.bot === 'api-bot' && one.session === 'review')?.running,
    'yes',
    `review's harness is in front of its new tab, got: ${JSON.stringify(after.sessions, null, 2)}`,
  );
  assert.deepEqual(after.found, [], `nothing is left to report, got: ${JSON.stringify(after.found, null, 2)}`);
});

// A harness can quit to the shell before any conversation exists, and right
// after `up` the book has the session's tab and no conversation until the kit's
// hook reports one. Until #303 `obk restart` refused that tab, and the finding
// had the user close it by hand and run `obk up` (#300). Since #303 restart
// closes a tab with its shell in front and starts the session fresh, so the
// finding for such a session gives the restart as what brings it back, as it
// does for one whose book names its conversation, and no longer says restart
// would refuse or has the user close the tab.

for (const harness of ['claude', 'codex']) {
  test(`D5 ${harness}: following the finding brings a session back with the restart it names, with or without a conversation in the book`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await botUp(box, 'api-bot', { harness, sessions: ['daily', 'review'] });
    await conversationsFor(bots, 'api-bot', ['daily']);
    assert.equal((await sessionIn(bots, 'api-bot', 'review')).session, undefined, 'the premise: the book names no conversation for review');
    await frontOf(box, bots, 'api-bot', 'daily', 'shell');
    await frontOf(box, bots, 'api-bot', 'review', 'shell');
    const book = bookOf(bots, 'api-bot');

    const answer = await found(box);
    const plain = await health(box);

    assertReportedDown(answer, plain, box, bots, 'api-bot', 'review');
    assertReportedDown(answer, plain, box, bots, 'api-bot', 'daily');
    const [daily] = about(answer, 'api-bot', 'daily');
    assert.ok(!spellingsOf(book).some((spelling) => daily.says.includes(spelling)), `the book names daily's conversation, so its finding says nothing about the book, got: ${daily.says}`);
    const [review] = about(answer, 'api-bot', 'review');
    assert.doesNotMatch(review.says, /\b(refuse|refuses|refused)\b/i, `restart brings review back, so the finding does not say it would refuse, got: ${review.says}`);
    assert.doesNotMatch(review.says, /\bclose (the|its|that) tab\b/i, `and does not have the user close the tab by hand, got: ${review.says}`);

    // Doing what the findings say, and nothing more: each session's restart.
    // No tab is closed by hand and no conversation id is written anywhere.
    await obk(box, 'restart', '--bots', 'bots', '--bot', 'api-bot', '--session', 'review');
    await obk(box, 'restart', '--bots', 'bots', '--bot', 'api-bot', '--session', 'daily');
    const after = await found(box);

    for (const session of ['daily', 'review']) {
      assert.equal(
        after.sessions.find((one) => one.bot === 'api-bot' && one.session === session)?.running,
        'yes',
        `${session} runs again, got: ${JSON.stringify(after.sessions, null, 2)}`,
      );
      assert.deepEqual(about(after, 'api-bot', session), [], `nothing is left to report about ${session}, got: ${JSON.stringify(after.found, null, 2)}`);
    }
    assert.deepEqual(after.found, [], `nothing is left to report, got: ${JSON.stringify(after.found, null, 2)}`);
  });
}

test('D4 health writes nothing and types nothing when a session\'s shell is in front: it only reports', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: ['daily', 'review'] });
  await botUp(box, 'web-bot', { harness: 'codex' });
  await conversationsFor(bots, 'api-bot', ['daily', 'review']);
  await frontOf(box, bots, 'api-bot', 'review', 'shell');
  await frontOf(box, bots, 'web-bot', 'daily', 'bare-shell');

  const before = await snapshot(box.root, skipOrcaFake);
  const setups = await box.orca.setups();
  const terminals = await box.orca.terminals();
  const asked = (await box.orca.calls()).length;

  const answer = await found(box);
  const plain = await health(box);

  assertReportedDown(answer, plain, box, bots, 'api-bot', 'review');
  assert.equal(about(answer, 'web-bot', 'daily').length, 1, `web-bot's daily is down too, got: ${JSON.stringify(answer.found, null, 2)}`);
  assert.deepEqual(await snapshot(box.root, skipOrcaFake), before, 'every file and every link is as it was');
  assert.deepEqual(await box.orca.setups(), setups, 'no Orca project made, changed or taken away');
  assert.deepEqual(await box.orca.terminals(), terminals, 'no tab opened, closed, retitled or typed into: health does not bring it back');
  assert.deepEqual(
    [...new Set((await box.orca.calls()).slice(asked).map(orcaCommand))].sort(),
    ['diagnostics memory', 'project setups', 'status', 'terminal list', 'terminal show'],
    'the only things health asks Orca are the ones that tell it something',
  );
});
