// A session's start prompt can live in a file: `prompt_file` names it, and the
// path is relative to the bot home, where the user keeps it beside AGENTS.md.
//
// A duty worth giving a bot is longer than a line, and a prompt written into
// `bot.yaml` has to be escaped, indented and re-indented every time it changes.
// In a file it is text — the user edits it, and git shows what changed.
//
// It reaches the session exactly as the prompt field does: read at launch,
// trimmed at the ends only, `--` in front of it, one shell-quoted argument, the
// work-dir note a blank line below it. Nothing downstream knows where the text
// came from.
//
// A session has one or the other. Both together is two duties for one session,
// and a file that cannot be read is a session with nothing to say — so both are
// refused where they are written and again before a tab is opened, because a
// bot.yaml can also be edited by hand.

import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import {
  assertCleanFailure,
  bookOf,
  botHomeOf,
  createSandbox,
  fakeProgram,
  orcaCallsOf,
  sh,
  skipGit,
  snapshot,
  tabsOfBot,
  typedInto,
} from './helpers/cli.js';

/**
 * A duty as a user writes one: paragraphs, a list, an indent under it, and the
 * punctuation of ordinary prose. Every character of it has to arrive.
 */
const DUTY = `You keep the API bot's day running.

Each morning:
  - read AGENTS.md
  - check what's "open" and say so in one line
  - ask before you touch main

Don't run \`git push\` yourself. Two spaces between  these  words are mine.
`;

/**
 * A bots folder with one Codex bot, nothing brought up yet. The bot's name is
 * this file's own: the kit leaves a long prompt in a file named after the bot
 * and the session, under the system temp directory, and two test files running
 * at once with the same names would read each other's.
 */
async function withBot(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'doc-bot', '--harness', 'codex']);
  assert.equal(made.code, 0, made.stderr);
  return box.path('bots');
}

/** Write `text` at `rel` inside the bot home, making the folders it needs. */
async function inBotHome(bots, rel, text) {
  const target = path.join(botHomeOf(bots, 'doc-bot'), rel);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, text);
  return target;
}

const add = (box, settings) =>
  box.run(['session', 'add', '--bots', 'bots', '--bot', 'doc-bot', '--name', 'daily', ...settings]);

/** Bring the one bot up and give back what was typed into its tab. */
async function up(box, bots) {
  const result = await box.run(['up', '--bots', 'bots', '--bot', 'doc-bot']);
  const tabs = await tabsOfBot(box, bots, 'doc-bot');
  return { result, tabs, typed: tabs.length === 1 ? typedInto(tabs[0]) : [] };
}

/** The arguments a shell running `line` hands the harness. */
async function argvOf(box, line, fake) {
  const ran = await sh(line, { cwd: box.cwd, env: box.env });
  assert.equal(ran.code, 0, `the line should run: ${line}\n${ran.stderr}`);
  const calls = await fake.calls();
  assert.equal(calls.length, 1, `the line should start the harness once, and only once: ${line}`);
  return calls[0].args;
}

/** A bot.yaml written by hand, with the sessions the test wants and no book. */
async function handEdited(bots, sessions) {
  await writeFile(
    path.join(botHomeOf(bots, 'doc-bot'), 'bot.yaml'),
    `name: doc-bot\nharness: codex\ncharter: mine\nrules: []\nskills: []\nsessions:\n${sessions}`,
  );
}

test('a prompt kept in a file is what the session is told, word for word', async (t) => {
  const box = await createSandbox(t);
  const fake = await fakeProgram(box, 'codex', {});
  const bots = await withBot(box);
  await inBotHome(bots, 'prompts/daily.md', DUTY);

  assert.equal((await add(box, ['--prompt-file', 'prompts/daily.md'])).code, 0);
  const { result, typed } = await up(box, bots);

  assert.equal(result.code, 0, result.stderr);
  // The end of a text file carries a newline the user did not type; everything
  // inside it — the blank lines, the indent under the list, the two spaces —
  // is theirs.
  assert.deepEqual(await argvOf(box, typed[0], fake), ['--approve-for-me', '--', DUTY.trimEnd()]);
});

test('a prompt file is read where the user keeps it: in the bot home', async (t) => {
  // The path is the bot's, not the working directory's. A user running `obk`
  // from anywhere has to get the same session.
  const box = await createSandbox(t);
  const fake = await fakeProgram(box, 'codex', {});
  const bots = await withBot(box);
  await inBotHome(bots, 'daily.md', 'The one in the bot home.');
  await writeFile(box.path('daily.md'), 'The one in the working directory.');

  assert.equal((await add(box, ['--prompt-file', 'daily.md'])).code, 0);
  const { typed } = await up(box, bots);

  assert.deepEqual(await argvOf(box, typed[0], fake), ['--approve-for-me', '--', 'The one in the bot home.']);
});

test('the file is read when the session starts, not when it was added', async (t) => {
  // Which is the point of keeping it in a file: the user edits the duty and
  // the next tab is started with it, with no `session add` to run again.
  const box = await createSandbox(t);
  const fake = await fakeProgram(box, 'codex', {});
  const bots = await withBot(box);
  await inBotHome(bots, 'prompts/daily.md', 'What it said when the session was added.');
  assert.equal((await add(box, ['--prompt-file', 'prompts/daily.md'])).code, 0);

  await inBotHome(bots, 'prompts/daily.md', 'What it says now.');
  const { typed } = await up(box, bots);

  assert.deepEqual(await argvOf(box, typed[0], fake), ['--approve-for-me', '--', 'What it says now.']);
});

test('a session with a prompt file and a work dir gets the note under it', async (t) => {
  const box = await createSandbox(t);
  const fake = await fakeProgram(box, 'codex', {});
  const bots = await withBot(box);
  await inBotHome(bots, 'prompts/daily.md', DUTY);

  assert.equal((await add(box, ['--prompt-file', 'prompts/daily.md', '--work-dir', 'work/api'])).code, 0);
  const { typed } = await up(box, bots);

  const argv = await argvOf(box, typed[0], fake);
  assert.equal(argv.length, 3, `the prompt is one argument, got: ${JSON.stringify(argv)}`);
  assert.ok(
    argv[2].startsWith(`${DUTY.trimEnd()}\n\n`),
    `the file's text comes first and whole, the note a blank line below it, got: ${JSON.stringify(argv[2])}`,
  );
  assert.ok(argv[2].includes(path.join(botHomeOf(bots, 'doc-bot'), 'work', 'api')));
});

test('session add writes the path the user gave, and no prompt beside it', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  await inBotHome(bots, 'prompts/daily.md', DUTY);

  const result = await add(box, ['--prompt-file', 'prompts/daily.md']);

  assert.equal(result.code, 0, result.stderr);
  const session = parse(await readFile(path.join(botHomeOf(bots, 'doc-bot'), 'bot.yaml'), 'utf8')).sessions[0];
  assert.equal(session.prompt_file, 'prompts/daily.md', 'written as the user wrote it, not resolved to an absolute path');
  assert.equal('prompt' in session, false, 'a session is told its duty once, and this one is told it from a file');
});

// Everything a session can ask for here that cannot be done. Each is refused
// where it is written and again before a tab is opened, because `bot.yaml` is
// the user's file and they are invited to edit it.
const TROUBLE = [
  {
    label: 'a prompt and a prompt file together',
    flags: ['--prompt', 'Read your AGENTS.md.', '--prompt-file', 'prompts/daily.md'],
    yaml: '  - name: daily\n    approval: auto\n    prompt: Read your AGENTS.md.\n    prompt_file: prompts/daily.md\n',
    async setUp(bots) {
      await inBotHome(bots, 'prompts/daily.md', DUTY);
    },
    says: ['daily', 'prompt'],
  },
  {
    label: 'a prompt file that is not there',
    flags: ['--prompt-file', 'prompts/daily.md'],
    yaml: '  - name: daily\n    approval: auto\n    prompt_file: prompts/daily.md\n',
    async setUp() {},
    says: ['daily', 'prompts/daily.md'],
  },
  {
    label: 'a prompt file that is a folder',
    flags: ['--prompt-file', 'prompts'],
    yaml: '  - name: daily\n    approval: auto\n    prompt_file: prompts\n',
    async setUp(bots) {
      await mkdir(path.join(botHomeOf(bots, 'doc-bot'), 'prompts'), { recursive: true });
    },
    says: ['daily', 'prompts'],
  },
  {
    label: 'a prompt file nobody may read',
    flags: ['--prompt-file', 'prompts/daily.md'],
    yaml: '  - name: daily\n    approval: auto\n    prompt_file: prompts/daily.md\n',
    async setUp(bots) {
      await chmod(await inBotHome(bots, 'prompts/daily.md', DUTY), 0o000);
    },
    says: ['daily', 'prompts/daily.md'],
    // The file cannot be hashed either, so it stays out of the snapshot below;
    // what that is watching is whether the kit wrote anything of its own.
    unreadable: 'bots/doc-bot/prompts/daily.md',
    // Root reads a file whatever its mode, so there would be nothing to refuse.
    skip: process.getuid?.() === 0,
  },
];

for (const { label, flags, yaml, setUp, says, skip, unreadable } of TROUBLE) {
  const untouched = (rel) => skipGit(rel) || rel === unreadable;
  test(`session add refuses ${label}, and writes nothing`, { skip }, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    await setUp(bots);
    const before = await snapshot(bots, untouched);

    const result = await add(box, flags);

    assertCleanFailure(result);
    for (const fact of says) {
      assert.ok(result.stderr.includes(fact), `the refusal should name ${fact}, got: ${result.stderr}`);
    }
    assert.deepEqual(await snapshot(bots, untouched), before, 'a refusal writes nothing');
  });

  test(`up refuses ${label}, written by hand, before it opens a tab`, { skip }, async (t) => {
    // The session never reaches a tab: a tab opened for a session that cannot
    // be started is worse than no tab, because the book claims it and the next
    // run walks past it.
    const box = await createSandbox(t);
    const bots = await withBot(box);
    await setUp(bots);
    await handEdited(bots, `${yaml}    work_dir: work/api\n`);

    const result = await box.run(['up', '--bots', 'bots', '--bot', 'doc-bot']);

    assertCleanFailure(result);
    for (const fact of says) {
      assert.ok(result.stderr.includes(fact), `the refusal should name ${fact}, got: ${result.stderr}`);
    }
    assert.deepEqual(await tabsOfBot(box, bots, 'doc-bot'), [], 'no tab for a session the kit cannot start');
    assert.deepEqual(
      orcaCallsOf(await box.orca.calls(), 'terminal create').filter((call) => call.args.join(' ').includes('Doc Bot')),
      [],
      'and Orca was never asked for one',
    );
    const book = await readFile(bookOf(bots, 'doc-bot'), 'utf8').catch(() => '');
    assert.equal((book === '' ? {} : parse(book) ?? {}).sessions?.daily, undefined, 'and the book claims no tab');
    await assert.rejects(
      () => rm(path.join(botHomeOf(bots, 'doc-bot'), 'work', 'api'), { recursive: false }),
      'and no work dir was made for it',
    );
  });
}

test('a session whose prompt file was fixed comes up on the next run', async (t) => {
  // The way out of the refusal, and the only one the user should need: write
  // the file the session points at, and run `up` again.
  const box = await createSandbox(t);
  const fake = await fakeProgram(box, 'codex', {});
  const bots = await withBot(box);
  await handEdited(bots, '  - name: daily\n    approval: auto\n    prompt_file: prompts/daily.md\n');
  assertCleanFailure(await box.run(['up', '--bots', 'bots', '--bot', 'doc-bot']));

  await inBotHome(bots, 'prompts/daily.md', 'Written after the first run failed.');
  const { result, typed } = await up(box, bots);

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(
    await argvOf(box, typed[0], fake),
    ['--approve-for-me', '--', 'Written after the first run failed.'],
  );
});
