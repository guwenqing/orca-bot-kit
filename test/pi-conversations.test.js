// Pi slice 1 (#578): what Pi itself has on record, and whether a Pi session
// got its start prompt.
//
// Pi keeps a session as one file, written after the first turn:
//
//   $HOME/.pi/agent/sessions/--<folder>--/<timestamp>_<id>.jsonl
//
// <folder> is the working folder's real path without its leading `/`, with
// every `/`, `\` and `:` turned into `-`. The first line is the session header
// (`type: "session"`, its `id`, `timestamp` and `cwd`). A user turn is a
// `message` line whose message has `role: "user"` and `content` as text
// blocks or a plain string; other lines have other types, or other roles.
//
// Through the exports of src/conversations.js:
//
//   hasConversation('pi', home, id)   Pi has a file for `id` in the session
//                                     folder of `home` (the bot home)
//   transcriptsIn('pi', home, since)  each { id, at, file, subagent: false },
//                                     oldest first, none older than `since`
//   heldAsUserTurn('pi', file, text)  true only for a user turn with that text
//
// And through `obk up`: after a fresh start the report says the prompt was
// received when the Pi file for the book's id holds it as a user turn, and
// says it is not confirmed when it does not.
//
// The exports read the user's HOME as the kit does, so this file points HOME
// at a throwaway folder before it loads them and gives it back at the end: the
// real ~/.pi is never read.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import { botHomeOf, createSandbox, orcaCallsOf, sessionIn } from './helpers/cli.js';
import { fakePi, PI_ID, piLines, piSessionOnRecord, yamlEntry } from './helpers/pi.js';

const BOT = 'pi-bot';
const PROMPT = 'Read your AGENTS.md and reply in one line with what this bot owns.';

/** The report's lines for each answer, as the other harnesses have them (test/prompt-received.test.js). */
const RECEIVED = 'the start prompt was received: the session\'s own record holds it.';
const NOT_CONFIRMED = 'the start prompt is not confirmed: the session\'s own record does not hold it yet.';

// The user's HOME for this file's own calls of the exports: a throwaway
// folder, set before src/conversations.js is loaded, so that a kit that reads
// HOME once as it loads reads this one too. Each test has a bot home of its
// own, so no two tests share a Pi session folder.
const userHome = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-pi-home-')));
const realHome = process.env.HOME;
process.env.HOME = userHome;
after(async () => {
  process.env.HOME = realHome;
  await rm(userHome, { recursive: true, force: true });
});
const { hasConversation, heldAsUserTurn, transcriptsIn } = await import('../src/conversations.js');

let homes = 0;

/** The user's HOME as `box.home`, and a bot home of this test's own. */
async function homeFor(t) {
  homes += 1;
  const root = path.join(userHome, `fleet-${homes}`);
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = botHomeOf(path.join(root, 'bots'), BOT);
  await mkdir(home, { recursive: true });
  return { box: { home: userHome, root }, home };
}

const at = (iso) => new Date(iso);

// ----------------------------------------------------------------- hasConversation

test('C9 hasConversation(\'pi\') is true for an id Pi has a file for in the bot home\'s session folder', async (t) => {
  const { box, home } = await homeFor(t);
  await piSessionOnRecord({ home: box.home, cwd: home, id: 'sess-1', lines: [piLines.user(PROMPT, new Date())] });

  assert.equal(hasConversation('pi', home, 'sess-1'), true);
});

test('C9 hasConversation(\'pi\') is false for an id Pi has no file for', async (t) => {
  const { box, home } = await homeFor(t);
  await piSessionOnRecord({ home: box.home, cwd: home, id: 'sess-1' });

  assert.equal(hasConversation('pi', home, 'sess-2'), false);
});

test('C9 hasConversation(\'pi\') is false for an id whose file is in another folder\'s session folder', async (t) => {
  const { box, home } = await homeFor(t);
  const other = path.join(box.root, 'elsewhere');
  await mkdir(other);
  await piSessionOnRecord({ home: box.home, cwd: other, id: 'sess-1' });

  assert.equal(hasConversation('pi', home, 'sess-1'), false);
});

test('C9 hasConversation(\'pi\') does not take a file for another id that ends the same', async (t) => {
  // Pi's ids may hold `_`, `.` and `-`, so the file of `old_sess-1` ends in `_sess-1.jsonl` too.
  const { box, home } = await homeFor(t);
  await piSessionOnRecord({ home: box.home, cwd: home, id: 'old_sess-1' });

  assert.equal(hasConversation('pi', home, 'sess-1'), false);
  assert.equal(hasConversation('pi', home, 'old_sess-1'), true);
});

test('C9 hasConversation(\'pi\') is false when Pi has no sessions at all', async (t) => {
  const { home } = await homeFor(t);

  assert.equal(hasConversation('pi', home, 'sess-1'), false);
});

// ----------------------------------------------------------------- transcriptsIn

test('C9 transcriptsIn(\'pi\') lists the bot home\'s Pi sessions, oldest first, as { id, at, file, subagent: false }', async (t) => {
  const { box, home } = await homeFor(t);
  // Written out of order, so the order is the kit's.
  const third = await piSessionOnRecord({ home: box.home, cwd: home, id: 'c-3', at: at('2026-10-16T12:00:00.000Z') });
  const first = await piSessionOnRecord({ home: box.home, cwd: home, id: 'a-1', at: at('2026-10-16T10:00:00.000Z') });
  const second = await piSessionOnRecord({ home: box.home, cwd: home, id: 'b-2', at: at('2026-10-16T11:00:00.000Z') });
  const other = path.join(box.root, 'elsewhere');
  await mkdir(other);
  await piSessionOnRecord({ home: box.home, cwd: other, id: 'not-mine', at: at('2026-10-16T11:30:00.000Z') });

  assert.deepEqual(transcriptsIn('pi', home), [
    { id: 'a-1', at: '2026-10-16T10:00:00.000Z', file: first, subagent: false },
    { id: 'b-2', at: '2026-10-16T11:00:00.000Z', file: second, subagent: false },
    { id: 'c-3', at: '2026-10-16T12:00:00.000Z', file: third, subagent: false },
  ]);
});

test('C9 transcriptsIn(\'pi\', home, since) leaves out every session older than since', async (t) => {
  const { box, home } = await homeFor(t);
  await piSessionOnRecord({ home: box.home, cwd: home, id: 'a-1', at: at('2026-10-16T10:00:00.000Z') });
  const second = await piSessionOnRecord({ home: box.home, cwd: home, id: 'b-2', at: at('2026-10-16T11:00:00.000Z') });
  const third = await piSessionOnRecord({ home: box.home, cwd: home, id: 'c-3', at: at('2026-10-16T12:00:00.000Z') });

  assert.deepEqual(
    transcriptsIn('pi', home, '2026-10-16T11:00:00.000Z').map(({ id, file }) => ({ id, file })),
    [{ id: 'b-2', file: second }, { id: 'c-3', file: third }],
    'one begun at since is not older than it',
  );
  assert.deepEqual(transcriptsIn('pi', home, '2026-10-16T11:00:00.001Z').map(({ id }) => id), ['c-3']);
});

test('C9 transcriptsIn(\'pi\') is empty when Pi has nothing for the bot home', async (t) => {
  const { home } = await homeFor(t);

  assert.deepEqual(transcriptsIn('pi', home), []);
});

// ----------------------------------------------------------------- heldAsUserTurn

/** A Pi session file in the sandbox holding `lines` after its header. */
async function fileHolding(t, lines) {
  const { box, home } = await homeFor(t);
  return piSessionOnRecord({ home: box.home, cwd: home, id: 'sess-1', lines });
}

test('C9 heldAsUserTurn(\'pi\') is true for a user turn with the text, as text blocks', async (t) => {
  const now = new Date();
  const file = await fileHolding(t, [
    piLines.sessionInfo('pi-bot.daily', now),
    piLines.modelChange(now),
    piLines.user(PROMPT, now, 1),
    piLines.assistant('This bot owns the API.', now, 2),
  ]);

  assert.equal(heldAsUserTurn('pi', file, PROMPT), true);
});

test('C9 heldAsUserTurn(\'pi\') is true for a user turn whose content is a plain string', async (t) => {
  const file = await fileHolding(t, [piLines.userString(PROMPT, new Date(), 1)]);

  assert.equal(heldAsUserTurn('pi', file, PROMPT), true);
});

test('C9 heldAsUserTurn(\'pi\') is false for a user turn with other text', async (t) => {
  const file = await fileHolding(t, [piLines.user('What is on the queue today?', new Date(), 1)]);

  assert.equal(heldAsUserTurn('pi', file, PROMPT), false);
});

test('C9 heldAsUserTurn(\'pi\') is false when only an assistant or a system message holds the text', async (t) => {
  const now = new Date();
  const file = await fileHolding(t, [
    piLines.system(PROMPT, now, 1),
    piLines.user('What is on the queue today?', now, 2),
    piLines.assistant(PROMPT, now, 3),
  ]);

  assert.equal(heldAsUserTurn('pi', file, PROMPT), false);
});

test('C9 heldAsUserTurn(\'pi\') is false for a file that is not there', async (t) => {
  const { box } = await homeFor(t);

  assert.equal(heldAsUserTurn('pi', path.join(box.home, '.pi', 'nothing.jsonl'), PROMPT), false);
});

// ----------------------------------------------------------------- the prompt received, through up

/**
 * A script the fake Orca runs while the kit first waits on the new tab: Pi has
 * had its first turn, and writes its file for the id the book names, under the
 * sandbox's home, holding `lines` (`__NOW__` filled in).
 */
const PI_TURN = `
const { mkdirSync, readFileSync, realpathSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { parse } = require(process.env.OBK_TEST_YAML);
const book = parse(readFileSync(process.env.OBK_TEST_BOOK, 'utf8'));
const id = book.sessions.daily.session;
const now = new Date();
const cwd = realpathSync(process.env.OBK_TEST_CWD);
const dir = path.join(process.env.OBK_TEST_HOME, '.pi', 'agent', 'sessions', '--' + cwd.replace(/^\\//, '').replace(/[/\\\\:]/g, '-') + '--');
mkdirSync(dir, { recursive: true });
const header = { type: 'session', version: 3, id, timestamp: now.toISOString(), cwd };
const lines = JSON.parse(process.env.OBK_TEST_LINES).map((line) => JSON.parse(JSON.stringify(line).replaceAll('"__NOW__"', JSON.stringify(now.toISOString()))));
writeFileSync(path.join(dir, now.toISOString().replace(/[:.]/g, '-') + '_' + id + '.jsonl'), [header, ...lines].map((line) => JSON.stringify(line)).join('\\n') + '\\n');
process.stdout.write(id);
`;

/** A bots folder with a Pi bot and one Pi session with the start prompt, not yet brought up. */
async function withPiSession(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'pi']);
  assert.equal(made.code, 0, `${made.stdout}${made.stderr}`);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily', '--prompt', PROMPT]);
  assert.equal(added.code, 0, `${added.stdout}${added.stderr}`);
  const bots = box.path('bots');
  return { bots, home: botHomeOf(bots, BOT) };
}

/** Have Pi write its file holding `lines` during the coming run's first look at the tab it launched. */
async function piTurnDuring(box, { bots, home }, lines) {
  const dir = path.join(box.root, 'pi-test');
  await mkdir(dir, { recursive: true });
  const script = path.join(dir, 'pi-turn.cjs');
  await writeFile(script, `${PI_TURN.trim()}\n`);
  await box.orca.set({
    runDuring: {
      command: 'terminal wait',
      argv: [process.execPath, script],
      env: {
        OBK_TEST_YAML: yamlEntry,
        OBK_TEST_BOOK: path.join(botHomeOf(bots, BOT), 'sessions.yaml'),
        OBK_TEST_HOME: box.home,
        OBK_TEST_CWD: home,
        OBK_TEST_LINES: JSON.stringify(lines),
      },
      on: orcaCallsOf(await box.orca.calls(), 'terminal wait').length + 1,
    },
  });
}

/** Pi wrote its file in the middle of the run, for the id the book names. */
async function assertPiWrote(box, bots) {
  const ran = await box.orca.ranDuring();
  assert.equal(ran.length, 1, `Pi should have had its turn in the middle of the run, got: ${JSON.stringify(ran)}`);
  assert.equal(ran[0].status, 0, `and nothing it ran should have failed: ${ran[0].stderr}`);
  assert.match(ran[0].stdout, PI_ID);
  assert.equal((await sessionIn(bots, BOT, 'daily'))?.session, ran[0].stdout, 'the file is for the id the book names');
}

const NOW = '__NOW__';
const userTurn = (text, n = 1) => ({ type: 'message', id: `m${n}`, parentId: null, timestamp: NOW, message: { role: 'user', content: [{ type: 'text', text }], timestamp: 0 } });
const assistantTurn = (text, n = 2) => ({ type: 'message', id: `m${n}`, parentId: `m${n - 1}`, timestamp: NOW, message: { role: 'assistant', content: [{ type: 'text', text }], timestamp: 0 } });

/** `obk up` for the Pi bot with --json; the session's new tab entry. */
async function entryOfUp(box) {
  const result = await box.run(['up', '--bots', 'bots', '--bot', BOT, '--json']);
  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  const found = JSON.parse(result.stdout).tabs.filter((entry) => entry.name === 'daily' && entry.created === true);
  assert.equal(found.length, 1, `the session's new tab should be reported, got: ${result.stdout}`);
  return found[0];
}

test('C9 on pi, a fresh up whose Pi file for the book\'s id holds the prompt as a user turn says it was received', async (t) => {
  const box = await createSandbox(t);
  await fakePi(box);
  const where = await withPiSession(box);
  await piTurnDuring(box, where, [userTurn(PROMPT), assistantTurn('This bot owns the API.')]);

  const entry = await entryOfUp(box);

  await assertPiWrote(box, where.bots);
  assert.equal(entry.promptReceived, true, `got: ${JSON.stringify(entry)}`);
});

test('C9 on pi, a fresh up whose Pi file holds another user turn says it is not confirmed', async (t) => {
  const box = await createSandbox(t);
  await fakePi(box);
  const where = await withPiSession(box);
  await piTurnDuring(box, where, [userTurn('What is on the queue today?'), assistantTurn(PROMPT)]);

  const entry = await entryOfUp(box);

  await assertPiWrote(box, where.bots);
  assert.equal(entry.promptReceived, false, `got: ${JSON.stringify(entry)}`);
});

test('C9 on pi, a fresh up with no Pi file yet says it is not confirmed', async (t) => {
  const box = await createSandbox(t);
  await fakePi(box);
  await withPiSession(box);

  const entry = await entryOfUp(box);

  assert.equal(entry.promptReceived, false, `got: ${JSON.stringify(entry)}`);
});

test('C9 on pi, the plain report says received, or not confirmed, in the tab\'s lines', async (t) => {
  const heard = await createSandbox(t);
  await fakePi(heard);
  await piTurnDuring(heard, await withPiSession(heard), [userTurn(PROMPT)]);
  const unheard = await createSandbox(t);
  await fakePi(unheard);
  await withPiSession(unheard);

  for (const [label, box, says, not] of [
    ['a Pi file that holds the prompt', heard, RECEIVED, NOT_CONFIRMED],
    ['no Pi file yet', unheard, NOT_CONFIRMED, RECEIVED],
  ]) {
    const result = await box.run(['up', '--bots', 'bots', '--bot', BOT]);
    assert.equal(result.code, 0, `${label}: ${result.stdout}${result.stderr}`);
    const lines = result.stdout.split('\n').map((line) => line.trim());
    assert.equal(lines.filter((line) => line === says).length, 1, `${label}: the report should say "${says}" once, got:\n${result.stdout}`);
    assert.ok(!lines.includes(not), `${label}: and not "${not}", got:\n${result.stdout}`);
  }
});
