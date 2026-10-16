// Pi slice 1 (#578), from the review of PR #583: a start prompt that begins
// with `@`.
//
// Pi 1.1.0 reads every word after `--` that begins with `@` as a file to
// attach, not as text, and exits with "File not found" when there is no such
// file; it has no way to escape it (read in Pi's dist/cli/args.js). So the kit
// refuses a Pi session whose start prompt, after the kit trims its ends,
// begins with `@`, from `--prompt` and from `--prompt-file` alike:
//
//   - `obk session add` and `obk session change` refuse it and write nothing;
//   - `obk up` refuses it before anything is made in Orca (only the kit's
//     read-only `status` check may come first);
//   - the sentence names the session, says Pi would read the prompt as a file
//     to attach, and asks for a prompt that does not begin with `@`.
//
// A prompt with `@` later in it is taken, and a Claude or Codex session with a
// prompt that begins with `@` is still taken.
//
// Every run is in the sandbox (helpers/cli.js), with a fake `pi` on its PATH
// (helpers/pi.js).

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import { botHomeOf, createSandbox, orcaCommand, skipGit, snapshot } from './helpers/cli.js';
import { fakePi } from './helpers/pi.js';

const BOT = 'pi-bot';

/** Prompts that begin with `@` once their ends are trimmed. */
const AT_PROMPTS = [
  ['@notes.md read this first', 'at the very start'],
  ['  @notes.md read this first', 'after spaces'],
  ['\n\t@notes.md read this first\n', 'after a newline and a tab'],
];

/** A bots folder `init` made, with one bot on `harness` and a fake pi on PATH. */
async function withBot(box, harness = 'pi', bot = BOT) {
  await fakePi(box);
  const init = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(init.code, 0, init.stderr);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness]);
  assert.equal(made.code, 0, `${made.stdout}${made.stderr}`);
  return box.path('bots');
}

const sessionAdd = (box, bot, name, ...rest) => box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', name, ...rest]);
const sessionChange = (box, bot, name, ...rest) => box.run(['session', 'change', '--bots', 'bots', '--bot', bot, '--session', name, ...rest]);

const botFile = (bots, bot = BOT) => path.join(botHomeOf(bots, bot), 'bot.yaml');

/** One session's entry in a bot's bot.yaml. */
async function sessionOf(bots, name, bot = BOT) {
  const found = (parse(await readFile(botFile(bots, bot), 'utf8')).sessions ?? []).filter((one) => one?.name === name);
  assert.equal(found.length, 1, `one session should be called ${name}, got: ${JSON.stringify(found)}`);
  return found[0];
}

/** The refusal (#583 review, item 14): a non-zero exit, no crash, the session named, the attach reading, and the ask. */
function assertRefusedForAt(result, session = 'daily') {
  assert.notEqual(result.code, 0, `this should have been refused, got:\n${result.stdout}${result.stderr}`);
  const said = result.stdout + result.stderr;
  assert.ok(!/^\s+at /m.test(said), `expected a message, got a crash:\n${said}`);
  assert.ok(said.includes(session), `the refusal should name the session ${session}, got:\n${said}`);
  assert.match(said, /\bPi\b/, `it should name Pi, got:\n${said}`);
  assert.match(said, /attach/i, `it should say Pi would read the prompt as a file to attach, got:\n${said}`);
  assert.match(said, /file/i, `it should say Pi would read it as a file, got:\n${said}`);
  assert.ok(said.includes('@'), `it should ask for a prompt that does not begin with @, got:\n${said}`);
}

// ----------------------------------------------------------------- session add

for (const [prompt, label] of AT_PROMPTS) {
  test(`A14 session add of a Pi session refuses a --prompt that begins with @ ${label}, and writes nothing`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    const before = await snapshot(bots, skipGit);

    assertRefusedForAt(await sessionAdd(box, BOT, 'daily', '--prompt', prompt));
    assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
  });
}

test('A14 session add of a Pi session refuses a --prompt-file whose text begins with @, and writes nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  await writeFile(path.join(botHomeOf(bots, BOT), 'daily.md'), '\n  @notes.md read this first.\n\nThen keep the queue moving.\n');
  const before = await snapshot(bots, skipGit);

  assertRefusedForAt(await sessionAdd(box, BOT, 'daily', '--prompt-file', 'daily.md'));
  assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
});

test('A14 session add --harness pi on a Claude bot refuses a --prompt that begins with @', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'claude', 'api-bot');
  const before = await snapshot(bots, skipGit);

  assertRefusedForAt(await sessionAdd(box, 'api-bot', 'daily', '--harness', 'pi', '--prompt', '@notes.md read this first'));
  assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
});

for (const prompt of ['Ask @owner first.', 'Read notes.md@v2 and keep going.']) {
  test(`A14 session add of a Pi session takes a prompt with @ later in it: ${prompt}`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);

    const result = await sessionAdd(box, BOT, 'daily', '--prompt', prompt);

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    assert.equal(String((await sessionOf(bots, 'daily')).prompt).trim(), prompt);
  });
}

for (const harness of ['claude', 'codex']) {
  test(`A14 a ${harness} session with a prompt that begins with @ is still taken`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, harness, 'api-bot');

    const result = await sessionAdd(box, 'api-bot', 'daily', '--prompt', '@notes.md read this first');

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    assert.equal(String((await sessionOf(bots, 'daily', 'api-bot')).prompt).trim(), '@notes.md read this first');
  });
}

test('A14 a Claude session of a Pi bot with a prompt that begins with @ is still taken', async (t) => {
  // The session's own harness decides, not the bot's.
  const box = await createSandbox(t);
  const bots = await withBot(box);

  const result = await sessionAdd(box, BOT, 'review', '--harness', 'claude', '--prompt', '@notes.md read this first');

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.equal(String((await sessionOf(bots, 'review')).prompt).trim(), '@notes.md read this first');
});

// ----------------------------------------------------------------- session change

test('A14 session change of a Pi session refuses a --prompt that begins with @, and writes nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  assert.equal((await sessionAdd(box, BOT, 'daily', '--prompt', 'Keep the queue moving.')).code, 0);
  const before = await snapshot(bots, skipGit);

  assertRefusedForAt(await sessionChange(box, BOT, 'daily', '--prompt', '  @notes.md read this first'));
  assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
});

test('A14 session change of a Pi session refuses a --prompt-file whose text begins with @, and writes nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  assert.equal((await sessionAdd(box, BOT, 'daily', '--prompt', 'Keep the queue moving.')).code, 0);
  await writeFile(path.join(botHomeOf(bots, BOT), 'daily.md'), '@notes.md read this first.\n');
  const before = await snapshot(bots, skipGit);

  assertRefusedForAt(await sessionChange(box, BOT, 'daily', '--prompt-file', 'daily.md'));
  assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
});

test('A14 session change of a Pi session takes a prompt with @ later in it', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  assert.equal((await sessionAdd(box, BOT, 'daily', '--prompt', 'Keep the queue moving.')).code, 0);

  const result = await sessionChange(box, BOT, 'daily', '--prompt', 'Ask @owner first.');

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.equal(String((await sessionOf(bots, 'daily')).prompt).trim(), 'Ask @owner first.');
});

// ----------------------------------------------------------------- up

/** Nothing made or changed in Orca since `before`: no call but `status`, and the same tabs and projects. */
async function assertNothingInOrca(box, before) {
  const asked = (await box.orca.calls()).slice(before.calls).filter((call) => orcaCommand(call) !== 'status');
  assert.deepEqual(asked.map((call) => call.args.join(' ')), [], 'Orca was asked nothing but the read-only status check');
  assert.deepEqual(await box.orca.terminals(), before.terminals, 'no tab was opened or changed');
  assert.deepEqual(await box.orca.setups(), before.setups, 'no project was made or changed');
}

const orcaNow = async (box) => ({
  calls: (await box.orca.calls()).length,
  terminals: await box.orca.terminals(),
  setups: await box.orca.setups(),
});

test('A14 up refuses a Pi session whose bot.yaml prompt, written by hand, begins with @, before anything is made in Orca', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  assert.equal((await sessionAdd(box, BOT, 'daily', '--prompt', 'Keep the queue moving.')).code, 0);
  const doc = parse(await readFile(botFile(bots), 'utf8'));
  doc.sessions[0].prompt = ' @notes.md read this first';
  await writeFile(botFile(bots), stringify(doc));
  const before = await orcaNow(box);

  assertRefusedForAt(await box.run(['up', '--bots', 'bots', '--bot', BOT]));
  await assertNothingInOrca(box, before);
});

test('A14 up refuses a Pi session whose prompt file was changed to begin with @, before anything is made in Orca', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const file = path.join(botHomeOf(bots, BOT), 'daily.md');
  await writeFile(file, 'Keep the queue moving.\n');
  assert.equal((await sessionAdd(box, BOT, 'daily', '--prompt-file', 'daily.md')).code, 0);
  await writeFile(file, '\n@notes.md read this first.\n');
  const before = await orcaNow(box);

  assertRefusedForAt(await box.run(['up', '--bots', 'bots', '--bot', BOT]));
  await assertNothingInOrca(box, before);
});

test('A14 up takes a Pi session whose prompt has @ later in it', async (t) => {
  // The control for the two refusals above: the same fleet, the same fake, a prompt Pi reads as text.
  const box = await createSandbox(t);
  await withBot(box);
  assert.equal((await sessionAdd(box, BOT, 'daily', '--prompt', 'Ask @owner first.')).code, 0);

  const result = await box.run(['up', '--bots', 'bots', '--bot', BOT]);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
});
