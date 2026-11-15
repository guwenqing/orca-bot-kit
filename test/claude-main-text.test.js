// Part 1: the main system text that the kit builds for a Claude Code session
// from Claude Code's own recorded text (#769; request claude-session-trim, R5;
// spec SP-10, SP-11; ADR 0055, sections 4 and 9).
//
// What the kit does, as the brief gives it:
//
//   - The SessionStart hook, on `startup` and `clear` only, notes a
//     conversation as a source when the session's launch line holds no
//     `--system-prompt` or `--system-prompt-file` and no appended text but the
//     kit's own `--append-system-prompt-file <bots>.prompts/<bot>/system-<sum>.md`.
//     The note is `<bots>.prompts/<bot>/sources/<conversation-id>.json`.
//   - At each launch of a Claude Code session, the kit asks `claude --version`
//     for the installed version. A noted conversation fits when it was noted
//     under the session's launch shape and the FIRST `prompt_snapshot` record
//     of its transcript has that version, and the record's last section is the
//     kit's appended text. The kit saves the record's other sections as
//     `<bots>.prompts/<bot>/originals/<version>-<shape>.json` and builds from
//     that copy: the recipe's drop and cut units out, the rest joined with a
//     blank line, written to `<bots>.prompts/<bot>/main-<sum>.md`. The line
//     names it with `--system-prompt-file`, directly before the appended file.
//     No fit: the line is as it was.
//   - The launch shape is what the session's launch words hold that does not
//     change with the conversation (model, effort, context, approval, extra
//     arguments, Remote Control, the memory folder), and the bot's tool and
//     skill cuts. A `text:` cut is not in it. `up` writes it into the book as
//     `shape`.
//   - The hook notes in the book `main`, the main file the line names, or
//     `own_text: true` for a line that names none; a resume changes neither.
//   - health names a session on its own text, and why; a session whose noted
//     main file is not the current one; a recipe unit a saved original of a
//     model the recipe names does not hold.
//   - retire of a bot removes its sources, originals and main files.
//
// The tests, each named by the brief's point it covers:
//
//   T1. No fitting record: no --system-prompt-file, the appended file given.
//   T2. The note: on startup and clear, not on resume or compact; never for a
//       line with a user's appended or replaced text, or with a main file of
//       the kit's.
//   T3. The build: only a noted conversation is a source, its appended section
//       out; the first record wins over a later resume with a user's text and
//       a compaction; a record whose last section is not the kit's text is no
//       source; the main file is outside the bots repo.
//   T4. The saved original: kept by version and shape, and a later launch
//       builds from it when the record is gone.
//   T5. The fit: another model, another extra argument, another tool cut or
//       another version does not fit; a `text:` cut does, and keeps the shape.
//   T6. The book: own_text and main, and a resume keeps both.
//   T7. Health.
//   T8. Retire.
//
// No text of Claude Code is in this file: the sections are made up. A fake
// `claude` on the sandbox's PATH answers `--version` in every test, so the real
// one on this machine is never run. Every run is in the sandbox
// (helpers/cli.js): its own HOME and a fake Orca. The hook runs under the
// stand-in processes whose argv carries the launch line, and the fake ps
// answers for them (helpers/cli.js recordSession, helpers/fake-ps.js).

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, appendFile, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { parse, stringify } from 'yaml';

import {
  botHomeOf,
  conversationOnRecord,
  createSandbox,
  fakeProgram,
  harnessWordsOf,
  launchLineInTab,
  recordSession,
  repoRoot,
  sessionIn,
  SYSTEM_FLAG,
  tabsOfBot,
} from './helpers/cli.js';

// ---------------------------------------------------------------- the texts

/** The installed version, as `claude --version` answers. */
const V = '2.1.325';
const VERSION_ANSWER = `${V} (Claude Code)\n`;

/** The model a record names. */
const MODEL = 'claude-test-model-1';

/** Made-up sections of the harness's own main text, one of them with lines. */
const SECTIONS = [
  'You keep the harbour ledger and answer in short lines.',
  'The tools you have:\n- ledger: read the ledger\n- bell: ring the bell',
  'Work in the folder you were started in.',
];

/** Other made-up sections, for a later record of the same conversation. */
const LATER = [
  'You keep the orchard ledger and answer at length.',
  'Walk the rows from east to west.',
];

const MAIN_FLAG = '--system-prompt-file';
const DUTY = 'Read your instructions and keep the harbour records.';
const BOT = 'api-bot';

const sha = (text) => createHash('sha256').update(text).digest('hex');
const show = (value) => JSON.stringify(value, null, 2);

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- the fleet

/** `obk <args>` that must work. */
async function ok(box, args, options) {
  const result = await box.run(args, options);
  assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return result;
}

/** A fake `claude` first on PATH, answering `--version` with `answer` (or failing). */
const claudeAnswers = (box, answer = VERSION_ANSWER, exitCode = 0) => fakeProgram(box, 'claude', { stdout: answer, exitCode });

/**
 * A bots folder on Claude Code with api-bot and its session daily (and the
 * sessions of `more`, `[name, settings]` each), a fake `claude` that answers
 * `version`, and the bot brought up. The kit's talk and profiles units are
 * `main`, so the bot has an appended file.
 */
async function started(box, { answer = VERSION_ANSWER, exitCode = 0, daily = [], more = [] } = {}) {
  await claudeAnswers(box, answer, exitCode);
  await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(box, ['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  for (const [name, settings] of [['daily', daily], ...more]) {
    await ok(box, ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', name, '--prompt', DUTY, ...settings]);
  }
  await ok(box, ['up', '--bots', 'bots', '--bot', BOT, '--json']);
  return box.path('bots');
}

const restart = (box, session = 'daily') => ok(box, ['restart', '--bots', 'bots', '--bot', BOT, '--session', session]);

const botYamlOf = (bots) => path.join(botHomeOf(bots, BOT), 'bot.yaml');

/** Change the bot's bot.yaml, as a user edits it. */
async function editBotYaml(bots, change) {
  const file = botYamlOf(bots);
  const doc = parse(await readFile(file, 'utf8')) ?? {};
  await writeFile(file, stringify({ ...doc, ...change }));
}

// ---------------------------------------------------------------- the kit's folders

const promptsOf = (bots) => path.join(`${bots}.prompts`, BOT);
const sourceOf = (bots, id) => path.join(promptsOf(bots), 'sources', `${id}.json`);
const originalsOf = (bots) => path.join(promptsOf(bots), 'originals');

/** The names in a folder, or none when it is not there. */
async function namesIn(dir) {
  try {
    return (await readdir(dir)).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

/** The bot's main files, `main-<hex>.md` in its prompts folder, by full path. */
const mainFiles = async (bots) => (await namesIn(promptsOf(bots)))
  .filter((name) => /^main-[0-9a-f]{16}\.md$/.test(name)).map((name) => path.join(promptsOf(bots), name));

// ---------------------------------------------------------------- the lines

/** The tab the book gives a session, as Orca lists it. */
async function liveTab(box, bots, name = 'daily') {
  const entry = await sessionIn(bots, BOT, name);
  assert.equal(typeof entry?.tab, 'string', `the book should hold a tab for ${BOT}/${name}, got: ${show(entry)}`);
  const terminal = (await tabsOfBot(box, bots, BOT)).find((one) => one.tabId === entry.tab);
  assert.ok(terminal, `Orca should have ${BOT}/${name}'s tab ${entry.tab}`);
  return terminal;
}

/** The words of the last launch line the kit typed into a session's tab, as the harness gets them. */
async function wordsOf(box, bots, name = 'daily') {
  const terminal = await liveTab(box, bots, name);
  const line = await launchLineInTab(box, terminal.tabId);
  assert.equal(typeof line, 'string', `the kit should have typed a launch line into ${BOT}/${name}'s tab, got: ${show(terminal.typed)}`);
  return harnessWordsOf(line);
}

/** The value after `flag` in `words`, or undefined; the flag at most once. */
function valueOf(words, flag) {
  const at = words.flatMap((word, index) => (word === flag ? [index] : []));
  assert.ok(at.length <= 1, `${flag} should be on the line once at most, got: ${show(words)}`);
  return at.length === 0 ? undefined : words[at[0] + 1];
}

/** The appended file a line names, and its text; the premise that its name is the sum of its text. */
async function appendedOf(words) {
  const file = valueOf(words, SYSTEM_FLAG);
  assert.equal(typeof file, 'string', `the premise: the kit's line names the appended file, got: ${show(words)}`);
  const text = await readFile(path.resolve(file), 'utf8');
  assert.equal(path.basename(file), `system-${sha(text).slice(0, 16)}.md`, 'the premise: the appended file is named by the sum of its text');
  return { file, text };
}

/** A line carries no main file, and still the appended file. */
function assertOwnText(words, why) {
  assert.equal(valueOf(words, MAIN_FLAG), undefined, `${why}: no ${MAIN_FLAG} on the line, got: ${show(words)}`);
  assert.notEqual(valueOf(words, SYSTEM_FLAG), undefined, `${why}: the appended file is still given, got: ${show(words)}`);
}

/** A line names a main file directly before the appended file; gives back the main file's path. */
function assertMainNamed(words, why) {
  const main = valueOf(words, MAIN_FLAG);
  assert.notEqual(main, undefined, `${why}: the line should carry ${MAIN_FLAG}, got: ${show(words)}`);
  const at = words.indexOf(MAIN_FLAG);
  assert.equal(words[at + 2], SYSTEM_FLAG, `${why}: ${MAIN_FLAG} and its file come directly before ${SYSTEM_FLAG}, got: ${show(words)}`);
  return path.resolve(main);
}

/** The words of `words` with `extra` put in directly before the appended file's flag. */
function withBefore(words, extra) {
  const at = words.indexOf(SYSTEM_FLAG);
  assert.ok(at > 0, `the premise: the kit's line has ${SYSTEM_FLAG}, got: ${show(words)}`);
  return [...words.slice(0, at), ...extra, ...words.slice(at)];
}

/** The words of `words` without the main file's flag and its value. */
function withoutMain(words) {
  const at = words.indexOf(MAIN_FLAG);
  return at < 0 ? words : words.filter((word, index) => index !== at && index !== at + 1);
}

// ---------------------------------------------------------------- the hook and the record

/** Where Claude Code keeps a conversation of the bot's sessions. */
async function transcriptOf(box, bots, id) {
  const home = await realpath(botHomeOf(bots, BOT));
  return path.join(box.home, '.claude', 'projects', home.replaceAll(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
}

/** Run the kit's hook in a session's tab; `line` is the words its harness carries (the tab's launch line when left out). */
async function hook(box, bots, { session, source, line, name = 'daily' }) {
  const tab = (await liveTab(box, bots, name)).tabId;
  const ran = await recordSession(box, {
    bots,
    bot: BOT,
    tab,
    session,
    source,
    cwd: await realpath(botHomeOf(bots, BOT)),
    transcript: await transcriptOf(box, bots, session),
    ...(line === undefined ? {} : { line }),
  });
  assert.equal(ran.code, 0, `the hook must never fail the session: ${ran.stderr}`);
  return ran;
}

/** A snapshot record of the main text, as Claude Code writes one: a list of sections. */
const snapshot = (id, sections, version = V) => ({
  type: 'attachment', version, sessionId: id, attachment: { type: 'prompt_snapshot', systemPrompt: sections },
});

/** A record of the model, as Claude Code writes one. */
const modelLine = (id, model = MODEL) => ({ type: 'attachment', sessionId: id, attachment: { type: 'model', identity: { modelId: model } } });

/**
 * The conversation `id` on Claude Code's own record, as a session of the bot
 * left it: its first line, then the model and each snapshot of `snapshots`
 * (lists of sections, or `{ sections, version }`).
 */
async function onRecord(box, bots, id, snapshots, { model = MODEL } = {}) {
  const file = await conversationOnRecord(box, { harness: 'claude', cwd: botHomeOf(bots, BOT), id });
  const lines = [modelLine(id, model)];
  for (const one of snapshots) {
    lines.push(Array.isArray(one) ? snapshot(id, one) : snapshot(id, one.sections, one.version));
  }
  await appendFile(file, lines.map((line) => `${JSON.stringify(line)}\n`).join(''));
  return file;
}

/**
 * The usual way to a source: the bot up, its daily session started on the
 * kit's line and noted, and its conversation on record with the harness's own
 * sections and the kit's appended text last. Gives back the bots folder, the
 * line's words and the appended text.
 */
async function noted(box, { id = 'conv-1', sections = SECTIONS, model = MODEL, version = V, ...options } = {}) {
  const bots = await started(box, options);
  const words = await wordsOf(box, bots);
  const { text } = await appendedOf(words);
  await hook(box, bots, { session: id, source: 'startup' });
  assert.ok(await exists(sourceOf(bots, id)), `the premise: the start on the kit's line is noted at ${sourceOf(bots, id)}`);
  await onRecord(box, bots, id, [{ sections: [...sections, text], version }], { model });
  return { bots, words, appended: text };
}

/**
 * The control for a test that expects no main file: a clear on the kit's line
 * then notes a new conversation, its record fits, and the next restart gives
 * a main file. So the test cannot pass only because nothing is built at all.
 */
async function thenAFit(box, bots, why) {
  const { text } = await appendedOf(await wordsOf(box, bots));
  await hook(box, bots, { session: 'conv-fit', source: 'clear' });
  await onRecord(box, bots, 'conv-fit', [[...SECTIONS, text]]);
  await restart(box);
  const main = assertMainNamed(await wordsOf(box, bots), `the control after ${why}: a fitting record`);
  assert.equal(await readFile(main, 'utf8'), SECTIONS.join('\n\n'), `the control after ${why}: built from the fitting record`);
}

// ---------------------------------------------------------------- health

/** `obk health --json`: its findings. */
async function findings(box) {
  const result = await box.run(['health', '--bots', 'bots', '--json']);
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`health --json should print JSON, got (${error.message}):\n${result.stdout}${result.stderr}`);
  }
  assert.ok(Array.isArray(answer.found), `health should answer with a list of findings, got: ${result.stdout}`);
  return answer.found;
}

/** The findings that name api-bot's session `session` and say every one of `phrases`. */
const aboutSession = (found, session, ...phrases) => found.filter((one) => typeof one.says === 'string'
  && one.says.includes(BOT) && one.says.includes(session) && phrases.every((phrase) => one.says.includes(phrase)));

/** The findings whose sentence holds every one of `phrases`. */
const saying = (found, ...phrases) => found.filter((one) => typeof one.says === 'string' && phrases.every((phrase) => one.says.includes(phrase)));

/** The shipped recipe. */
const shippedRecipe = async () => JSON.parse(await readFile(path.join(repoRoot, 'src', 'claude-text-recipe.json'), 'utf8'));

// ================================================================ T1

describe('T1 no fitting record', () => {
  test('T1 with no record at all, the line carries no main file, and the appended file is still given', async (t) => {
    const box = await createSandbox(t);
    const bots = await started(box);

    assertOwnText(await wordsOf(box, bots), 'a first launch');
    assert.deepEqual(await mainFiles(bots), [], 'no main file is written');
  });

  test('T1 a claude that gives no version: a noted record that would fit gives no main file', async (t) => {
    const box = await createSandbox(t);
    const { bots } = await noted(box, { answer: '', exitCode: 1 });

    await restart(box);

    assertOwnText(await wordsOf(box, bots), 'no version');
    assert.deepEqual(await mainFiles(bots), [], 'no main file is written');
  });
});

// ================================================================ T2

describe('T2 the note', () => {
  test('T2 a start and a clear on the kit\'s line are noted; a resume and a compaction are not', async (t) => {
    const box = await createSandbox(t);
    const bots = await started(box);

    await hook(box, bots, { session: 'conv-start', source: 'startup' });
    await hook(box, bots, { session: 'conv-clear', source: 'clear' });
    await hook(box, bots, { session: 'conv-resume', source: 'resume' });
    await hook(box, bots, { session: 'conv-compact', source: 'compact' });

    assert.ok(await exists(sourceOf(bots, 'conv-start')), 'startup is noted');
    assert.ok(await exists(sourceOf(bots, 'conv-clear')), 'clear is noted');
    assert.equal(await exists(sourceOf(bots, 'conv-resume')), false, 'resume is not noted');
    assert.equal(await exists(sourceOf(bots, 'conv-compact')), false, 'compact is not noted');
  });

  test('T2 a start on a line with a user\'s appended or replaced text, or with a main file of the kit\'s, is not noted', async (t) => {
    const box = await createSandbox(t);
    const bots = await started(box);
    const words = await wordsOf(box, bots);
    const lines = {
      'own-append': withBefore(words, ['--append-system-prompt', 'Answer every question in rhyme.']),
      'own-system': withBefore(words, ['--system-prompt', 'You are a lighthouse keeper.']),
      'own-system-file': withBefore(words, [MAIN_FLAG, path.join(box.root, 'elsewhere', 'own-text.md')]),
      'kit-main': withBefore(words, [MAIN_FLAG, path.join(promptsOf(bots), 'main-0123456789abcdef.md')]),
    };

    for (const [id, line] of Object.entries(lines)) await hook(box, bots, { session: id, source: 'startup', line });
    await hook(box, bots, { session: 'own-clear', source: 'clear', line: lines['own-append'] });

    for (const id of [...Object.keys(lines), 'own-clear']) {
      assert.equal(await exists(sourceOf(bots, id)), false, `${id}: no note at ${sourceOf(bots, id)}`);
    }
    await hook(box, bots, { session: 'kit-line', source: 'startup' });
    assert.ok(await exists(sourceOf(bots, 'kit-line')), 'the control: the kit\'s own line is noted');
  });
});

// ================================================================ T3

describe('T3 the build', () => {
  test('T3 a noted record gives the next launch a main file of its sections, without the appended one, before the appended file', async (t) => {
    const box = await createSandbox(t);
    const { bots } = await noted(box);

    await restart(box);

    const words = await wordsOf(box, bots);
    const main = assertMainNamed(words, 'after a noted record');
    assert.equal(await readFile(main, 'utf8'), SECTIONS.join('\n\n'), 'the main file is the harness\'s sections joined by a blank line, the kit\'s appended text out');
    const real = await realpath(main);
    assert.equal(path.dirname(real), await realpath(promptsOf(bots)), `the main file is in the bot's prompts folder beside the bots repo, got: ${main}`);
    assert.ok(!real.startsWith(`${await realpath(bots)}${path.sep}`), `the main file is outside the bots repo, got: ${main}`);
    assert.match(path.basename(main), /^main-[0-9a-f]{16}\.md$/);
    await appendedOf(words);
  });

  test('T3 a record whose last section is not the kit\'s appended text is no source', async (t) => {
    const box = await createSandbox(t);
    const bots = await started(box);
    await hook(box, bots, { session: 'conv-1', source: 'startup' });
    await onRecord(box, bots, 'conv-1', [[...SECTIONS, 'Some other text appended by someone else.']]);

    await restart(box);

    assertOwnText(await wordsOf(box, bots), 'the last section is not the kit\'s');
    assert.deepEqual(await mainFiles(bots), []);
    await thenAFit(box, bots, 'a record with another last section');
  });

  test('T3 a record of a conversation that was never noted is no source', async (t) => {
    const box = await createSandbox(t);
    const bots = await started(box);
    const { text } = await appendedOf(await wordsOf(box, bots));
    // The session's own conversation, started on a user's text, so not noted; and on record with nothing to build from.
    await hook(box, bots, { session: 'conv-1', source: 'startup', line: withBefore(await wordsOf(box, bots), ['--append-system-prompt', 'Answer in rhyme.']) });
    assert.equal(await exists(sourceOf(bots, 'conv-1')), false, 'the premise: conv-1 is not noted');
    await onRecord(box, bots, 'conv-1', [[...SECTIONS, text]]);
    // Another conversation of the bot, on record with the kit's text last, never noted.
    await onRecord(box, bots, 'conv-other', [[...SECTIONS, text]]);

    await restart(box);

    assertOwnText(await wordsOf(box, bots), 'no noted conversation');
    assert.deepEqual(await mainFiles(bots), []);
    await thenAFit(box, bots, 'records that were never noted');
  });

  test('T3 a noted start, then a resume with a user\'s text and a compaction, still builds from the first record', async (t) => {
    const box = await createSandbox(t);
    const bots = await started(box);
    const words = await wordsOf(box, bots);
    const { text } = await appendedOf(words);
    const own = withBefore(words, ['--append-system-prompt', 'Answer in rhyme.']);
    await hook(box, bots, { session: 'conv-1', source: 'startup' });
    await hook(box, bots, { session: 'conv-1', source: 'resume', line: own });
    await hook(box, bots, { session: 'conv-1', source: 'compact', line: own });
    await onRecord(box, bots, 'conv-1', [
      [...SECTIONS, text],
      [...LATER, 'Answer in rhyme.', text],
      [...LATER, 'Answer in rhyme.', text],
    ]);

    await restart(box);

    const main = assertMainNamed(await wordsOf(box, bots), 'a noted start');
    assert.equal(await readFile(main, 'utf8'), SECTIONS.join('\n\n'), 'the first record, not a later one');
  });
});

// ================================================================ T4

describe('T4 the saved original', () => {
  test('T4 the original is saved by version and shape, and a later launch builds from it when the record is gone', async (t) => {
    const box = await createSandbox(t);
    const { bots } = await noted(box);
    await restart(box);
    const first = assertMainNamed(await wordsOf(box, bots), 'the premise: the first build');
    const { shape } = await sessionIn(bots, BOT, 'daily');
    assert.equal(typeof shape, 'string', `the book holds the launch shape, got: ${show(await sessionIn(bots, BOT, 'daily'))}`);
    assert.deepEqual(await namesIn(originalsOf(bots)), [`${V}-${shape}.json`], 'the original is saved by version and shape');

    await rm(await transcriptOf(box, bots, 'conv-1'));
    await restart(box);

    const again = assertMainNamed(await wordsOf(box, bots), 'with the record gone');
    assert.equal(await readFile(again, 'utf8'), SECTIONS.join('\n\n'), 'built from the saved original');
    assert.equal(path.basename(again), path.basename(first), 'the same text, so the same file');
  });

  test('T4 a record of a conversation that ran on the kit\'s main text is no source', async (t) => {
    const box = await createSandbox(t);
    const { bots } = await noted(box);
    await restart(box);
    const words = await wordsOf(box, bots);
    assertMainNamed(words, 'the premise: the kit gives its main text');
    const { text } = await appendedOf(words);

    // A clear on the kit's line, now with the kit's main file: never noted.
    await hook(box, bots, { session: 'conv-2', source: 'clear' });

    assert.equal(await exists(sourceOf(bots, 'conv-2')), false, 'a conversation on the kit\'s main text is not noted');
    // And so its record, newer and with the kit's text last, does not change what is built.
    await onRecord(box, bots, 'conv-2', [[...LATER, text]]);
    await rm(originalsOf(bots), { recursive: true, force: true });
    await rm(await transcriptOf(box, bots, 'conv-1'));
    await restart(box);
    assertOwnText(await wordsOf(box, bots), 'the only record left ran on the kit\'s text');
  });
});

// ================================================================ T5

describe('T5 the fit', () => {
  /** A noted record, then a change, then a restart: the change's line and the shapes before and after. */
  async function changed(box, change) {
    const { bots } = await noted(box);
    const before = (await sessionIn(bots, BOT, 'daily')).shape;
    assert.equal(typeof before, 'string', `the premise: up wrote the shape into the book, got: ${show(await sessionIn(bots, BOT, 'daily'))}`);
    await change(bots);
    await restart(box);
    return { bots, words: await wordsOf(box, bots), before, after: (await sessionIn(bots, BOT, 'daily')).shape };
  }

  test('T5 another model does not fit, and is another shape', async (t) => {
    const box = await createSandbox(t);
    const { bots, words, before, after } = await changed(box, () => ok(box, ['session', 'change', '--bots', 'bots', '--bot', BOT, '--session', 'daily', '--model', 'sonnet']));

    assertOwnText(words, 'another model');
    assert.notEqual(after, before, 'the shape changed');
    assert.deepEqual(await mainFiles(bots), []);
  });

  test('T5 another extra argument does not fit, and is another shape', async (t) => {
    const box = await createSandbox(t);
    const { bots, words, before, after } = await changed(box, () => ok(box, ['session', 'change', '--bots', 'bots', '--bot', BOT, '--session', 'daily', '--extra-arg=--verbose']));

    assertOwnText(words, 'another extra argument');
    assert.notEqual(after, before, 'the shape changed');
    assert.deepEqual(await mainFiles(bots), []);
  });

  test('T5 another tool cut does not fit, and is another shape', async (t) => {
    const box = await createSandbox(t);
    const { bots, words, before, after } = await changed(box, (bots) => editBotYaml(bots, { claude_cut: ['WebFetch'] }));

    assertOwnText(words, 'another tool cut');
    assert.notEqual(after, before, 'the shape changed');
    assert.deepEqual(await mainFiles(bots), []);
  });

  test('T5 a text: cut is not in the shape: the record still fits', async (t) => {
    const box = await createSandbox(t);
    const { bots, words, before, after } = await changed(box, (bots) => editBotYaml(bots, { claude_cut: ['text:fast-mode'] }));

    const main = assertMainNamed(words, 'a text: cut');
    assert.equal(after, before, 'the shape is the same');
    assert.equal(await readFile(main, 'utf8'), SECTIONS.join('\n\n'), 'the made-up sections hold no unit of the recipe, so all stay');
  });

  test('T5 a record of another version does not fit', async (t) => {
    const box = await createSandbox(t);
    const { bots } = await noted(box, { version: '2.1.300' });

    await restart(box);

    assertOwnText(await wordsOf(box, bots), 'another version');
    assert.deepEqual(await mainFiles(bots), []);
  });

  test('T5 the first record decides the version: a later record of the installed version in the same conversation does not fit', async (t) => {
    const box = await createSandbox(t);
    const bots = await started(box);
    const { text } = await appendedOf(await wordsOf(box, bots));
    await hook(box, bots, { session: 'conv-1', source: 'startup' });
    await onRecord(box, bots, 'conv-1', [{ sections: [...SECTIONS, text], version: '2.1.300' }, { sections: [...SECTIONS, text], version: V }]);

    await restart(box);

    assertOwnText(await wordsOf(box, bots), 'the first record is of another version');
    await thenAFit(box, bots, 'a first record of another version');
  });
});

// ================================================================ T6

describe('T6 the book', () => {
  test('T6 a start on the kit\'s line with no main file is noted own_text, and a resume keeps it', async (t) => {
    const box = await createSandbox(t);
    const bots = await started(box);
    const words = await wordsOf(box, bots);

    await hook(box, bots, { session: 'conv-1', source: 'startup' });
    const entry = await sessionIn(bots, BOT, 'daily');
    assert.equal(entry.own_text, true, `got: ${show(entry)}`);
    assert.equal(entry.main, undefined, `no main file, got: ${show(entry)}`);

    await hook(box, bots, { session: 'conv-1', source: 'resume', line: withBefore(words, [MAIN_FLAG, path.join(promptsOf(bots), 'main-0123456789abcdef.md')]) });
    const resumed = await sessionIn(bots, BOT, 'daily');
    assert.equal(resumed.own_text, true, `a resume keeps own_text, got: ${show(resumed)}`);
    assert.equal(resumed.main, undefined, `and notes no main file, got: ${show(resumed)}`);
  });

  test('T6 a clear on a line with the kit\'s main file notes main and not own_text, and a resume on a bare line keeps them', async (t) => {
    const box = await createSandbox(t);
    const { bots } = await noted(box);
    await restart(box);
    const words = await wordsOf(box, bots);
    const main = assertMainNamed(words, 'the premise: the kit gives its main text');

    await hook(box, bots, { session: 'conv-2', source: 'clear' });
    const entry = await sessionIn(bots, BOT, 'daily');
    assert.equal(path.basename(String(entry.main)), path.basename(main), `the book names the main file, got: ${show(entry)}`);
    assert.notEqual(entry.own_text, true, `not own_text, got: ${show(entry)}`);

    await hook(box, bots, { session: 'conv-2', source: 'resume', line: withoutMain(words) });
    const resumed = await sessionIn(bots, BOT, 'daily');
    assert.equal(path.basename(String(resumed.main)), path.basename(main), `a resume keeps main, got: ${show(resumed)}`);
    assert.notEqual(resumed.own_text, true, `and does not note own_text, got: ${show(resumed)}`);
  });

  test('T6 up writes the launch shape into the book', async (t) => {
    const box = await createSandbox(t);
    const bots = await started(box);

    const { shape } = await sessionIn(bots, BOT, 'daily');
    assert.equal(typeof shape, 'string', `got: ${show(await sessionIn(bots, BOT, 'daily'))}`);
    assert.notEqual(shape, '');
  });
});

// ================================================================ T7

describe('T7 health', () => {
  test('T7 a session on its own text because claude --version gave nothing is named, with claude --version', async (t) => {
    const box = await createSandbox(t);
    const bots = await started(box, { answer: '', exitCode: 1 });
    await hook(box, bots, { session: 'conv-1', source: 'startup' });

    const found = await findings(box);

    assert.ok(aboutSession(found, 'daily', 'claude --version').length >= 1, `got: ${show(found)}`);
  });

  test('T7 a session on its own text with no fitting record yet is named with the version, and not told to restart', async (t) => {
    const box = await createSandbox(t);
    const bots = await started(box);
    await hook(box, bots, { session: 'conv-1', source: 'startup' });

    const found = await findings(box);

    const said = aboutSession(found, 'daily', V);
    assert.ok(said.length >= 1, `health names daily with ${V}, got: ${show(found)}`);
    assert.deepEqual(said.filter((one) => one.says.includes('obk restart')), [], `a restart would not help yet, got: ${show(said)}`);
    assert.deepEqual(aboutSession(found, 'daily', 'claude --version'), [], `claude answered, got: ${show(found)}`);
  });

  test('T7 a session on its own text whose record now fits is told to restart', async (t) => {
    const box = await createSandbox(t);
    await noted(box);

    const found = await findings(box);

    assert.ok(aboutSession(found, 'daily', 'obk restart').length >= 1, `got: ${show(found)}`);
  });

  test('T7 a session that cleared on the kit\'s current main file is not told to restart', async (t) => {
    const box = await createSandbox(t);
    const { bots } = await noted(box);
    await restart(box);
    assertMainNamed(await wordsOf(box, bots), 'the premise: the kit gives its main text');
    await hook(box, bots, { session: 'conv-2', source: 'clear' });

    const found = await findings(box);

    assert.deepEqual(aboutSession(found, 'daily', 'obk restart'), [], `got: ${show(found)}`);
  });

  test('T7 a session whose noted main file is not the current one is named, with a restart and the next compaction', async (t) => {
    const box = await createSandbox(t);
    const { bots } = await noted(box);
    await restart(box);
    const words = await wordsOf(box, bots);
    const current = assertMainNamed(words, 'the premise: the kit gives its main text');
    const older = path.join(path.dirname(current), 'main-0123456789abcdef.md');
    await writeFile(older, 'An older main text.');
    const at = words.indexOf(MAIN_FLAG);
    await hook(box, bots, { session: 'conv-2', source: 'clear', line: words.map((word, index) => (index === at + 1 ? older : word)) });
    assert.equal(path.basename(String((await sessionIn(bots, BOT, 'daily')).main)), path.basename(older), 'the premise: the book notes the older main file');

    const found = await findings(box);

    assert.ok(aboutSession(found, 'daily', 'obk restart', 'compaction').length >= 1, `got: ${show(found)}`);
  });

  test('T7 each recipe unit that a saved original of a model it is named for does not hold is named, with the model', async (t) => {
    const box = await createSandbox(t);
    const recipe = await shippedRecipe();
    const model = recipe.units.find((unit) => unit.name === 'text:ultrareview')?.models?.[0];
    assert.equal(typeof model, 'string', `the premise: the recipe names a model for text:ultrareview, got: ${show(recipe)}`);
    const { bots } = await noted(box, { model });
    await restart(box);
    assert.equal((await namesIn(originalsOf(bots))).length, 1, 'the premise: an original was saved');

    const found = await findings(box);

    for (const unit of recipe.units) {
      const said = saying(found, unit.name);
      if (unit.models.includes(model)) {
        assert.ok(said.some((one) => one.says.includes(model)), `${unit.name} is named for ${model}, got: ${show(found)}`);
      } else {
        assert.deepEqual(said, [], `${unit.name} is not named for ${model}, got: ${show(said)}`);
      }
    }
  });
});

// ================================================================ T8

describe('T8 retire', () => {
  test('T8 retiring the bot removes its sources, its originals and its main files', async (t) => {
    const box = await createSandbox(t);
    const { bots } = await noted(box);
    await restart(box);
    const mains = await mainFiles(bots);
    assert.equal(mains.length, 1, 'the premise: a main file');
    assert.equal((await namesIn(originalsOf(bots))).length, 1, 'the premise: an original');
    assert.ok((await namesIn(path.join(promptsOf(bots), 'sources'))).length >= 1, 'the premise: a source');

    await ok(box, ['retire', '--bots', 'bots', '--bot', BOT]);

    assert.equal(await exists(path.join(promptsOf(bots), 'sources')), false, 'sources/ is gone');
    assert.equal(await exists(originalsOf(bots)), false, 'originals/ is gone');
    for (const file of mains) assert.equal(await exists(file), false, `${file} is gone`);
  });
});
