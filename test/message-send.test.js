// `obk message send`: the one road the kit can carry, which is the Orca
// mailbox (PRD 6.9, ADR 0008).
//
// It carries what it can and answers the rest with an address. A native pair —
// two Claude sessions in one approval class — can only be written to by a
// Claude session itself, through the harness's own messaging; no CLI can send
// one. So `send` refuses that pair and names the address to write to, which is
// as far as code can take "the bot never picks the transport".
//
// Every message goes to a Run and comes from one. The sender's own mailbox is
// the from, because a reply has to have somewhere to go: proved live, a
// terminal handle is a mailbox that dies with the tab, and `reply --id` is
// filed under the replier's own Run where the recipient's read never finds it
// (tech notes, section 1). So a reply is an ordinary send back, carrying the
// thread it belongs to.
//
// And one rule about size, with no judgement in it (PRD 6.9): a body over 4 KiB
// is written to a file beside the bots folder and the message names it. The
// reason is not Orca's limit — 200 KB goes through the mailbox whole — but the
// receiving session's context, and the command line, which dies near 1 MB.

import assert from 'node:assert/strict';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  assertOrcaCallsAllowed,
  assertRefused,
  createSandbox,
  sessionIn,
} from './helpers/cli.js';

/** The longest body that still travels as itself: 4 KiB of it. */
const FITS = 4096;

const body = (length) => 'x'.repeat(length);

/**
 * A bots folder with two Claude bots and one Codex bot, one session each,
 * everything brought up: so every session has a mailbox and an address.
 */
async function fleetIn(box, bots = [['writer', 'claude'], ['reader', 'claude'], ['coder', 'codex']]) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  for (const [bot, harness, settings = []] of bots) {
    const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness]);
    assert.equal(made.code, 0, made.stderr);
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', 'daily', ...settings]);
    assert.equal(added.code, 0, added.stderr);
  }
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  return box.path('bots');
}

/** `obk message send`, with the sender named. */
const send = (box, args) => box.run(['message', 'send', '--bots', 'bots', ...args]);

/** The one message waiting in the whole fake mailbox. */
async function theMessage(box) {
  const queued = await box.orca.messages();
  assert.equal(queued.length, 1, `one message should have been queued, got: ${JSON.stringify(queued)}`);
  return queued[0];
}

/** The mailbox address of one session, as a send writes it. */
const addressOfMailbox = async (bots, bot, session = 'daily') => `run:${(await sessionIn(bots, bot, session)).mailbox}`;

/**
 * Every file the kit has beside the bots folder right now: PRD 6.3 keeps what
 * the kit writes for itself out of the user's repo, so everything it writes is
 * in some `<bots>.<something>` next to it — start prompts already are, and
 * the book's locks live there too. A test asks what one send added by reading
 * this before and after.
 */
async function besideTheBotsFolder(bots) {
  const parent = path.dirname(bots);
  const mine = path.basename(bots);
  const found = [];
  for (const name of await readdir(parent)) {
    if (!name.startsWith(`${mine}.`)) continue;
    const dir = path.join(parent, name);
    if (!(await stat(dir)).isDirectory()) continue;
    for (const entry of await readdir(dir)) found.push(path.join(dir, entry));
  }
  return found;
}

/** What is there now that was not there before. */
const addedBy = (before, now) => now.filter((file) => !before.includes(file));

test('a message is queued to the receiver\'s mailbox, and comes from the sender\'s own', async (t) => {
  // Both ends are addresses that outlive a tab, so the message can be read
  // after a restart and the reply has somewhere to go.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);

  const result = await send(box, [
    '--to', 'coder', '--from', 'writer/daily',
    '--subject', 'the API bot is stuck', '--text', 'It cannot reach the staging host.',
  ]);

  assert.equal(result.code, 0, result.stderr);
  const message = await theMessage(box);
  assert.equal(message.to, await addressOfMailbox(bots, 'coder'));
  assert.equal(message.from, await addressOfMailbox(bots, 'writer'));
  assert.equal(message.subject, 'the API bot is stuck');
  assert.ok(message.body.includes('It cannot reach the staging host.'), `the text itself, got: ${message.body}`);
});

test('the sender is the session whose tab the command is running in, when none is named', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const writer = await sessionIn(bots, 'writer', 'daily');

  const result = await box.run(
    ['message', 'send', '--bots', 'bots', '--to', 'coder', '--subject', 'hello', '--text', 'from my own tab'],
    { env: { ...box.env, ORCA_TAB_ID: writer.tab } },
  );

  assert.equal(result.code, 0, result.stderr);
  assert.equal((await theMessage(box)).from, await addressOfMailbox(bots, 'writer'));
});

test('a native pair is refused, the address to write to is named, and nothing is sent', async (t) => {
  // Two Claude sessions in one approval class: the harness delivers that one
  // itself, and no CLI can. The refusal is the answer — it carries the address.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const before = await box.orca.terminals();

  const result = await send(box, [
    '--to', 'reader', '--from', 'writer/daily', '--subject', 'about the review', '--text', 'have you started?',
  ]);

  assertRefused(result, 'reader.daily');
  assert.deepEqual(await box.orca.messages(), [], 'nothing may be queued for a pair the mailbox does not carry');
  assert.deepEqual(await box.orca.terminals(), before, 'and nothing may be typed into anybody\'s tab');
});

test('a body of 4 KiB travels as itself', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const text = body(FITS);
  const before = await besideTheBotsFolder(bots);

  const result = await send(box, ['--to', 'coder', '--from', 'writer/daily', '--subject', 'the log', '--text', text]);

  assert.equal(result.code, 0, result.stderr);
  assert.ok((await theMessage(box)).body.includes(text), 'the whole of it should be in the message');
  assert.deepEqual(addedBy(before, await besideTheBotsFolder(bots)), [], 'and nothing should have been written to the disk for it');
});

test('a body over 4 KiB goes to a file beside the bots folder, and the message names it', async (t) => {
  // One rule, no judgement: above the limit the text is a file the message
  // points at. The file sits beside the bots folder, never inside the user's
  // repo, the way a long start prompt already does.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const text = body(FITS + 1);
  const before = await besideTheBotsFolder(bots);

  const result = await send(box, ['--to', 'coder', '--from', 'writer/daily', '--subject', 'the log', '--text', text]);

  assert.equal(result.code, 0, result.stderr);
  const written = addedBy(before, await besideTheBotsFolder(bots));
  assert.equal(written.length, 1, `one file should have been written, got: ${JSON.stringify(written)}`);
  assert.equal(await readFile(written[0], 'utf8'), text, 'and it holds the text word for word');

  const message = await theMessage(box);
  assert.ok(message.body.includes(written[0]), `the message must name the file, got: ${message.body}`);
  assert.ok(!message.body.includes(text), `and must not carry the text as well, got ${message.body.length} characters`);
  assert.ok(message.body.length < FITS, `a message that names a file is short, got ${message.body.length} characters`);
});

test('a long body given in a file is copied beside the bots folder, not pointed at where it was', async (t) => {
  // The user's own file is theirs to change or delete, and a message that
  // outlives it would name a path with nothing behind it.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const text = body(FITS + 1);
  const theirs = box.path('notes.txt');
  await writeFile(theirs, text);
  const before = await besideTheBotsFolder(bots);

  const result = await send(box, ['--to', 'coder', '--from', 'writer/daily', '--subject', 'the log', '--text-file', theirs]);

  assert.equal(result.code, 0, result.stderr);
  const written = addedBy(before, await besideTheBotsFolder(bots));
  assert.equal(written.length, 1, `one file should have been written, got: ${JSON.stringify(written)}`);
  assert.notEqual(written[0], theirs);
  assert.equal(await readFile(written[0], 'utf8'), text);
  assert.ok((await theMessage(box)).body.includes(written[0]));
});

test('a short body given in a file travels as itself', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const theirs = box.path('notes.txt');
  await writeFile(theirs, 'Two lines.\nThe second one.\n');
  const before = await besideTheBotsFolder(bots);

  const result = await send(box, ['--to', 'coder', '--from', 'writer/daily', '--subject', 'the log', '--text-file', theirs]);

  assert.equal(result.code, 0, result.stderr);
  assert.ok((await theMessage(box)).body.includes('Two lines.\nThe second one.'), 'the file\'s text, whole');
  assert.deepEqual(addedBy(before, await besideTheBotsFolder(bots)), []);
});

test('a reply carries the thread it belongs to', async (t) => {
  // `reply --id` is filed under the replier's own Run and never reaches the
  // recipient's read (proved live), so a reply is an ordinary send back with
  // the thread id on it.
  const box = await createSandbox(t);
  await fleetIn(box);

  const result = await send(box, [
    '--to', 'coder', '--from', 'writer/daily', '--subject', 'about the staging host',
    '--text', 'It is back up.', '--thread', 'thread-7',
  ]);

  assert.equal(result.code, 0, result.stderr);
  assert.equal((await theMessage(box)).threadId, 'thread-7');
});

test('a message with no thread carries none', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);

  assert.equal((await send(box, ['--to', 'coder', '--from', 'writer/daily', '--subject', 'hello', '--text', 'hi'])).code, 0);

  assert.equal((await theMessage(box)).threadId, null);
});

test('a target that does not exist is refused, and nothing is queued', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);

  const result = await send(box, ['--to', 'ghost-bot', '--from', 'writer/daily', '--subject', 'hello', '--text', 'hi']);

  assertRefused(result, 'ghost-bot');
  assert.deepEqual(await box.orca.messages(), []);
});

test('a session that was never brought up is refused, and nothing is queued', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);
  assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', 'coder', '--name', 'night'])).code, 0);

  const result = await send(box, ['--to', 'coder/night', '--from', 'writer/daily', '--subject', 'hello', '--text', 'hi']);

  assertRefused(result, 'night');
  assert.deepEqual(await box.orca.messages(), []);
});

test('a sender that was never brought up is refused: a reply would have nowhere to go', async (t) => {
  // The from is the sender's own mailbox, and a session that has never been up
  // has none. A message with no from would reach the receiver and leave it
  // with nobody to answer.
  const box = await createSandbox(t);
  await fleetIn(box);
  assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', 'writer', '--name', 'night'])).code, 0);

  const result = await send(box, ['--to', 'coder', '--from', 'writer/night', '--subject', 'hello', '--text', 'hi']);

  assertRefused(result, 'writer/night');
  assert.deepEqual(await box.orca.messages(), []);
});

test('a send with no body at all is refused', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);

  const result = await send(box, ['--to', 'coder', '--from', 'writer/daily', '--subject', 'hello']);

  assertRefused(result, '--text', '--text-file');
  assert.deepEqual(await box.orca.messages(), []);
});

test('every Orca call a send makes is one of the allowed ones, and no tab is closed', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);

  assert.equal((await send(box, ['--to', 'coder', '--from', 'writer/daily', '--subject', 'hello', '--text', 'hi'])).code, 0);

  assertOrcaCallsAllowed(await box.orca.calls());
});
