// A long message body is written in the sender's own bot folder of
// `<bots>.messages` (#534).
//
// A body over 4 KiB is written to a file beside the bots folder and the message
// names the file (PRD 6.9). A Codex session may write only in its bot home and
// in the folders its launch line names (test/sandbox-launch-dirs.test.js), and
// those are its own bot's: `<bots>.messages/<bot>`. So the body file of a send
// goes inside `<bots>.messages/<sender's bot>/`, never directly in
// `<bots>.messages`, and never under another bot's folder there. Everything
// else stays as it was: a body of 4 KiB or less travels as itself and writes
// nothing, and the Read rule a Claude bot is offered for `<bots>.messages`
// still covers the file, wherever in that folder it is.
//
// Every run is in the sandbox (helpers/cli.js): its own HOME and a fake Orca.

import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createSandbox } from './helpers/cli.js';

/** The longest body that still travels as itself (INLINE_LIMIT in src/message.js). */
const FITS = 4096;

const body = (length) => 'x'.repeat(length);

/** A Claude bot `writer` and a Codex bot `coder`, one daily session each, both up. */
async function fleetIn(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  for (const [bot, harness] of [['writer', 'claude'], ['coder', 'codex']]) {
    const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness]);
    assert.equal(made.code, 0, made.stderr);
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', 'daily']);
    assert.equal(added.code, 0, added.stderr);
  }
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  return box.path('bots');
}

/** `obk message send --json` from `from` to `to`, which must be sent; the answer. */
async function send(box, from, to, text) {
  const result = await box.run([
    'message', 'send', '--bots', 'bots', '--from', from, '--to', to, '--subject', 'the log', '--text', text, '--json',
  ]);
  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  const answer = JSON.parse(result.stdout);
  assert.equal(answer.sent, true, `the premise: the message went, got: ${result.stdout}`);
  return answer;
}

/** The one message waiting in the whole fake mailbox. */
async function theMessage(box) {
  const queued = await box.orca.messages();
  assert.equal(queued.length, 1, `one message should have been queued, got: ${JSON.stringify(queued)}`);
  return queued[0];
}

/** Every file under `dir`, at any depth, or none when it is not there. */
async function filesUnder(dir) {
  let names;
  try {
    names = await readdir(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const found = [];
  for (const name of names) {
    const at = path.join(dir, name);
    if ((await stat(at)).isDirectory()) found.push(...await filesUnder(at));
    else found.push(at);
  }
  return found;
}

/** What is there now that was not there before. */
const addedBy = (before, now) => now.filter((file) => !before.includes(file));

for (const [sender, senderBot, receiver, label] of [
  ['writer/daily', 'writer', 'coder', 'a Claude session'],
  ['coder/daily', 'coder', 'writer', 'a Codex session'],
]) {
  test(`SM1 a body over 4 KiB from ${label} is written inside <bots>.messages/${senderBot}/, and the message names that file`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    const messages = `${bots}.messages`;
    const before = await filesUnder(messages);
    const text = body(FITS + 1);

    const answer = await send(box, sender, receiver, text);

    const written = addedBy(before, await filesUnder(messages));
    assert.equal(written.length, 1, `one file should have been written in ${messages}, got: ${JSON.stringify(written)}`);
    assert.equal(path.dirname(written[0]), path.join(messages, senderBot), `it is in the sender's own bot folder, got: ${written[0]}`);
    assert.equal(await readFile(written[0], 'utf8'), text, 'and holds the text word for word');
    assert.equal(answer.file, written[0], `the answer names the file, got: ${JSON.stringify(answer)}`);
    const message = await theMessage(box);
    assert.ok(message.body.includes(written[0]), `the message names the file, got: ${message.body}`);
    assert.ok(!message.body.includes(text), 'and does not carry the text as well');
  });
}

test('SM2 a long body is never written directly in <bots>.messages nor under another bot\'s folder there', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const messages = `${bots}.messages`;

  await send(box, 'coder/daily', 'writer', body(FITS + 1));
  await send(box, 'writer/daily', 'coder', body(FITS + 2));

  const files = await filesUnder(messages);
  assert.equal(files.length, 2, `the premise: two body files, got: ${JSON.stringify(files)}`);
  for (const file of files) {
    assert.notEqual(path.dirname(file), messages, `nothing is written directly in ${messages}, got: ${file}`);
  }
  assert.equal((await filesUnder(path.join(messages, 'coder'))).length, 1, 'coder\'s folder holds coder\'s one body and nothing of writer\'s');
  assert.equal((await filesUnder(path.join(messages, 'writer'))).length, 1, 'writer\'s folder holds writer\'s one body and nothing of coder\'s');
  assert.equal((await readFile((await filesUnder(path.join(messages, 'coder')))[0], 'utf8')).length, FITS + 1, 'the body in coder\'s folder is the one coder sent');
  assert.equal((await readFile((await filesUnder(path.join(messages, 'writer')))[0], 'utf8')).length, FITS + 2, 'the body in writer\'s folder is the one writer sent');
});

test('SM3 a body of exactly 4 KiB from a Codex session travels as itself, and nothing is written for it', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const text = body(FITS);
  const before = await filesUnder(`${bots}.messages`);

  const answer = await send(box, 'coder/daily', 'writer', text);

  assert.ok((await theMessage(box)).body.includes(text), 'the whole of it is in the message');
  assert.equal(answer.file, undefined, `no file is named, got: ${JSON.stringify(answer)}`);
  assert.deepEqual(addedBy(before, await filesUnder(`${bots}.messages`)), [], 'and nothing is written to the disk for it');
});

test('SM4 the Read rule a Claude bot is offered for <bots>.messages covers a body file in a bot\'s own folder there', async (t) => {
  // Claude Code's `**` matches at any depth, so the rule as it is reads a body
  // file one folder down. This holds before #534 and after; it is here so the
  // move does not quietly put the file where the rule does not reach.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const created = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'reader', '--harness', 'claude', '--json']);
  assert.equal(created.code, 0, created.stderr);
  const said = JSON.parse(created.stdout);
  const rules = JSON.stringify(said).match(/Read\(\/[^"]*?\/\*\*\)/g) ?? [];
  const covering = rules.map((rule) => rule.slice('Read(/'.length, -'/**)'.length)).filter((folder) => folder === `${bots}.messages`);
  assert.equal(covering.length >= 1, true, `the premise: the kit offers Read(/${bots}.messages/**), got: ${JSON.stringify(rules)}`);

  const answer = await send(box, 'coder/daily', 'writer', body(FITS + 1));

  assert.equal(typeof answer.file, 'string', `the premise: the body went to a file, got: ${JSON.stringify(answer)}`);
  assert.ok(answer.file.startsWith(`${covering[0]}/`), `${answer.file} is under ${covering[0]}, which the rule reads at any depth`);
});
