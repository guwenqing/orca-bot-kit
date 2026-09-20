// How the start prompt gets from the kit to the harness (PRD 6.4, issue #32).
//
// A prompt that is one short line is typed into the launch line as it stands.
// Anything longer, or with a newline in it, is written by the kit to a file of
// its own and the line reads it back: `-- "$(cat <file>)"`. A page of text
// typed into a tab's shell is a page of text in that shell's history, in its
// scrollback and in whatever the shell does to a line it is still reading.
//
// The two roads end in the same place, which is the point: the harness is
// handed one argument, after `--`, holding the user's text and nothing else.
// So the tests here read what was typed into the tab, and then run that line
// through a real shell against a fake harness and read its argv.
//
// The file is the kit's own, under the system temp directory. A `prompt_file`
// the user wrote is theirs: it stays in the bot home, and nothing here moves or
// rewrites it.
//
// The bots in this file have names of their own. The kit's file is named after
// the bot and the session, so two test files running at once under the same
// names would read each other's prompt.

import assert from 'node:assert/strict';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertCleanFailure,
  botHomeOf,
  createSandbox,
  fakeProgram,
  sh,
  tabsOfBot,
  typedInto,
} from './helpers/cli.js';

/** The longest prompt still typed into the line: one line, this many characters. */
const FITS = 200;

const line = (length) => 'x'.repeat(length);

/**
 * The kit's prompt files for this bot's sessions, gone before the test runs
 * and gone again after it. They live under the system temp directory, named
 * after the bot and the session and never cleaned up, so one left by an
 * earlier run would answer for this one: a test that asks whether the kit
 * wrote a file would pass without the kit writing anything.
 */
async function freshPrompts(t, bot, sessions = ['daily']) {
  const clear = () => Promise.all(sessions.map((session) => rm(promptPathOf(bot, session), { force: true })));
  await clear();
  t.after(clear);
}

/** A bots folder with one Codex bot, and one session with the settings given. */
async function withSession(t, box, bot, settings, { session = 'daily' } = {}) {
  await freshPrompts(t, bot, [session]);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', 'codex']);
  assert.equal(made.code, 0, made.stderr);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', session, ...settings]);
  assert.equal(added.code, 0, added.stderr);
  return box.path('bots');
}

/** Bring the bot up and give back the one tab, what was typed into it, and the answer. */
async function up(box, bots, bot) {
  const result = await box.run(['up', '--bots', 'bots', '--bot', bot, '--json']);
  assert.equal(result.code, 0, result.stderr);
  const tabs = await tabsOfBot(box, bots, bot);
  assert.equal(tabs.length, 1, `the bot should have the one session tab, got ${JSON.stringify(tabs)}`);
  const answer = JSON.parse(result.stdout);
  assert.equal(answer.tabs.length, 1, `one tab should have been reported, got: ${result.stdout}`);
  return { typed: typedInto(tabs[0])[0], tab: answer.tabs[0] };
}

/** The arguments a shell running `text` hands the harness. */
async function argvOf(box, text, fake) {
  const ran = await sh(text, { cwd: box.cwd, env: box.env });
  assert.equal(ran.code, 0, `the line should run: ${text}\n${ran.stderr}`);
  const calls = await fake.calls();
  assert.equal(calls.length, 1, `the line should start the harness once, and only once: ${text}`);
  return calls[0].args;
}

/**
 * The launch line reads the kit's file back: `-- "$(cat <file>)"`. The path is
 * quoted the way a shell needs it and no more, so what is pinned here is the
 * shape around it and the path inside it, not the quotes.
 */
function assertReadsBack(typed, file) {
  assert.match(
    typed,
    /^codex --approve-for-me -- "\$\(cat .+\)"$/,
    `the line should read the prompt back inside one double-quoted word, got: ${typed}`,
  );
  assert.ok(typed.includes(file), `and read it from ${file}, got: ${typed}`);
}

/** Whether there is a file at `target`. */
const isThere = (target) => stat(target).then(() => true, () => false);

/** Where the kit would leave a prompt for this bot's session, if it left one. */
const promptPathOf = (bot, session = 'daily') =>
  path.join(os.tmpdir(), 'obk-prompts', `${bot}.${session}.txt`);

test('a short prompt of one line is typed into the launch line as it stands', async (t) => {
  const box = await createSandbox(t);
  const fake = await fakeProgram(box, 'codex', {});
  const short = 'Read your AGENTS.md and say in one line what this bot owns.';
  const bots = await withSession(t, box, 'short-bot', ['--prompt', short]);

  const { typed, tab } = await up(box, bots, 'short-bot');

  assert.equal(typed, `codex --approve-for-me -- '${short}'`, 'the text itself, quoted, after the separator');
  assert.ok(!typed.includes('cat '), `nothing to read back, got: ${typed}`);
  assert.equal('promptFile' in tab, false, 'a prompt that went in on the line was not handed over in a file');
  assert.equal(await isThere(promptPathOf('short-bot')), false, 'and no file was written for it');
  assert.deepEqual(await argvOf(box, typed, fake), ['--approve-for-me', '--', short]);
});

test('a prompt too long for a line is handed over in a file the kit writes', async (t) => {
  const box = await createSandbox(t);
  const fake = await fakeProgram(box, 'codex', {});
  const long = `Read your AGENTS.md. ${line(FITS)}`;
  const bots = await withSession(t, box, 'long-bot', [`--prompt=${long}`]);

  const { typed, tab } = await up(box, bots, 'long-bot');

  assert.equal(tab.promptFile, promptPathOf('long-bot'), 'the answer names the file the session was handed');
  assertReadsBack(typed, tab.promptFile);
  assert.equal(await readFile(tab.promptFile, 'utf8'), long, 'the file holds what the session is to be told, and only that');
  // The line is the contract: what the harness gets has to be the same either
  // way, so the shell reading the file back must hand it the one argument.
  assert.deepEqual(await argvOf(box, typed, fake), ['--approve-for-me', '--', long]);
});

test('a prompt of more than one line goes by file however short it is', async (t) => {
  // The other half of the rule. Six characters, and a newline in the middle of
  // them: a line is a line, and this is two.
  const box = await createSandbox(t);
  const fake = await fakeProgram(box, 'codex', {});
  const bots = await withSession(t, box, 'two-line-bot', ['--prompt=Read.\nThen wait.']);

  const { typed, tab } = await up(box, bots, 'two-line-bot');

  assert.equal(tab.promptFile, promptPathOf('two-line-bot'));
  assertReadsBack(typed, tab.promptFile);
  assert.deepEqual(await argvOf(box, typed, fake), ['--approve-for-me', '--', 'Read.\nThen wait.']);
});

for (const [label, length, byFile] of [
  ['a prompt of exactly the length that fits is still typed in', FITS, false],
  ['one character more and it goes by file', FITS + 1, true],
]) {
  test(label, async (t) => {
    const box = await createSandbox(t);
    const bot = `edge-${length}-bot`;
    const prompt = line(length);
    const bots = await withSession(t, box, bot, [`--prompt=${prompt}`]);

    const { typed, tab } = await up(box, bots, bot);

    assert.equal('promptFile' in tab, byFile, `${length} characters: got ${JSON.stringify(typed)}`);
    assert.equal(typed.includes('cat '), byFile, `${length} characters: got ${JSON.stringify(typed)}`);
    if (!byFile) assert.ok(typed.endsWith(`-- ${prompt}`), `the text itself, got: ${typed}`);
  });
}

test('the work-dir note goes into the file with the prompt', async (t) => {
  // The session is told one thing, from one place. A note delivered any other
  // way would be a second send, and a second send is what the launch line
  // exists to avoid.
  const box = await createSandbox(t);
  const fake = await fakeProgram(box, 'codex', {});
  const long = `Read your AGENTS.md. ${line(FITS)}`;
  const bots = await withSession(t, box, 'note-bot', [`--prompt=${long}`, '--work-dir', 'work/api']);

  const { typed, tab } = await up(box, bots, 'note-bot');

  const held = await readFile(tab.promptFile, 'utf8');
  const work = path.join(botHomeOf(bots, 'note-bot'), 'work', 'api');
  assert.ok(held.startsWith(`${long}\n\n`), `the user's prompt first, the note a blank line below it, got: ${held}`);
  assert.ok(held.includes(work), `the note should name the work dir, got: ${held}`);
  assert.deepEqual(await argvOf(box, typed, fake), ['--approve-for-me', '--', held]);
});

test('whatever is in the file reaches the harness as one argument, unread by the shell', async (t) => {
  // The file is read back by the tab's own shell, so everything a shell does
  // to text has to not happen: no expanding, no splitting, no running. This is
  // the same text the inline road is pinned on, and it has to arrive the same.
  const box = await createSandbox(t);
  const fake = await fakeProgram(box, 'codex', {});
  const nasty = `it's "fine" $HOME \`date\` && rm -rf x; echo 'hi'
  - a line that starts with a dash
  two  spaces, a tab\tand  $(echo no)
${line(FITS)}`;
  const bots = await withSession(t, box, 'nasty-bot', [`--prompt=${nasty}`]);

  const { typed, tab } = await up(box, bots, 'nasty-bot');

  assert.equal(await readFile(tab.promptFile, 'utf8'), nasty, 'the file holds the user\'s text, byte for byte');
  assert.deepEqual(await argvOf(box, typed, fake), ['--approve-for-me', '--', nasty]);
});

test('a prompt file of the user\'s own is left where they put it', async (t) => {
  // Their file is theirs: the kit reads it and writes its own copy elsewhere,
  // so a session that is restarted twice a day never touches the file the user
  // is editing.
  const box = await createSandbox(t);
  const fake = await fakeProgram(box, 'codex', {});
  const duty = `You keep the day running.\n\n  - read AGENTS.md\n${line(FITS)}\n`;
  await freshPrompts(t, 'own-bot');
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'own-bot', '--harness', 'codex'])).code, 0);
  const bots = box.path('bots');
  const theirs = path.join(botHomeOf(bots, 'own-bot'), 'prompts', 'daily.md');
  await mkdir(path.dirname(theirs), { recursive: true });
  await writeFile(theirs, duty);
  // A session may only point at a file that is there, so it is written first.
  assert.equal((await box.run([
    'session', 'add', '--bots', 'bots', '--bot', 'own-bot', '--name', 'daily', '--prompt-file', 'prompts/daily.md',
  ])).code, 0);

  const { typed, tab } = await up(box, bots, 'own-bot');

  assert.equal(await readFile(theirs, 'utf8'), duty, 'the user\'s file is not rewritten');
  assert.notEqual(tab.promptFile, theirs, 'and it is not the file the launch line reads');
  assert.ok(!tab.promptFile.startsWith(bots), `the kit's file belongs outside the bots folder, got: ${tab.promptFile}`);
  assert.deepEqual(await argvOf(box, typed, fake), ['--approve-for-me', '--', duty.trimEnd()]);
});

test('the blank lines a format leaves at the ends are taken off, and nothing else', async (t) => {
  // A text file ends with a newline because text files do, and a `prompt: |`
  // in YAML carries one for the same reason. Neither is something the user
  // typed, and the harness would read either as an empty last instruction.
  // What lies between them is theirs: the paragraphs, the indent, the two
  // spaces, all of it.
  const box = await createSandbox(t);
  const fake = await fakeProgram(box, 'codex', {});
  const duty = `\n\nYou keep the day running.\n\n  - read AGENTS.md\n\n${line(FITS)}\n\n\n`;
  await freshPrompts(t, 'ends-bot');
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'ends-bot', '--harness', 'codex'])).code, 0);
  const bots = box.path('bots');
  const theirs = path.join(botHomeOf(bots, 'ends-bot'), 'prompts', 'daily.md');
  await mkdir(path.dirname(theirs), { recursive: true });
  await writeFile(theirs, duty);
  assert.equal((await box.run([
    'session', 'add', '--bots', 'bots', '--bot', 'ends-bot', '--name', 'daily', '--prompt-file', 'prompts/daily.md',
  ])).code, 0);

  const { typed, tab } = await up(box, bots, 'ends-bot');

  // Read from the file the kit wrote, not from argv: `"$(cat …)"` drops
  // trailing newlines of its own accord, so argv alone would not notice one
  // the kit had left in.
  assert.equal(
    await readFile(tab.promptFile, 'utf8'),
    duty.trim(),
    'the ends are the format\'s and go; the blank lines inside are the user\'s and stay',
  );
  assert.deepEqual(await argvOf(box, typed, fake), ['--approve-for-me', '--', duty.trim()]);
});

test('the prompt is in its file before the tab is opened', async (t) => {
  // The line is typed the moment the tab exists, and a line that reads a file
  // that is not there yet starts a harness with an empty prompt.
  const box = await createSandbox(t);
  const long = `Read your AGENTS.md. ${line(FITS)}`;
  const bots = await withSession(t, box, 'early-bot', [`--prompt=${long}`]);
  await box.orca.set({ fail: { 'terminal create': { code: 'runtime_error', message: 'no tab for you' } } });

  const result = await box.run(['up', '--bots', 'bots', '--bot', 'early-bot']);

  assertCleanFailure(result);
  assert.deepEqual(await tabsOfBot(box, bots, 'early-bot'), [], 'there is no tab at all');
  assert.equal(
    await readFile(promptPathOf('early-bot'), 'utf8'),
    long,
    'the prompt was written before Orca was asked for the tab',
  );
});

test('two sessions of one bot are handed two files', async (t) => {
  const box = await createSandbox(t);
  const first = `Read your AGENTS.md. ${line(FITS)}`;
  const second = `Watch the queue. ${line(FITS)}`;
  const bots = await withSession(t, box, 'pair-bot', [`--prompt=${first}`]);
  await freshPrompts(t, 'pair-bot', ['review']);
  assert.equal((await box.run([
    'session', 'add', '--bots', 'bots', '--bot', 'pair-bot', '--name', 'review', `--prompt=${second}`,
  ])).code, 0);

  const result = await box.run(['up', '--bots', 'bots', '--bot', 'pair-bot', '--json']);

  assert.equal(result.code, 0, result.stderr);
  const files = Object.fromEntries(JSON.parse(result.stdout).tabs.map((tab) => [tab.name, tab.promptFile]));
  assert.notEqual(files.daily, files.review, 'one session must not be told the other\'s duty');
  assert.equal(await readFile(files.daily, 'utf8'), first);
  assert.equal(await readFile(files.review, 'utf8'), second);
});

test('a session with nothing to say is handed nothing at all', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSession(t, box, 'quiet-bot', []);

  const { typed, tab } = await up(box, bots, 'quiet-bot');

  assert.equal(typed, 'codex --approve-for-me', 'no separator, no prompt, no file');
  assert.equal('promptFile' in tab, false);
  assert.equal(await isThere(promptPathOf('quiet-bot')), false);
});
