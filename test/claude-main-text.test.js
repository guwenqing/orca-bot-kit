// Part 1: the main system text that the kit builds for a Claude Code session
// from Claude Code's own recorded text (#769; request claude-session-trim, R5;
// spec SP-10, SP-11; ADR 0055, sections 4 and 9).
//
// What the kit does, as the brief gives it:
//
//   - The SessionStart hook, on `startup` and `clear` only, reads the whole
//     launch line and notes a
//     conversation as a source when the session's launch line holds no
//     `--system-prompt` or `--system-prompt-file` and no appended text but the
//     kit's own `--append-system-prompt-file <bots>.prompts/<bot>/system-<sum>.md`.
//     The note is `<bots>.claude-text/<bot>/sources/<conversation-id>.json`.
//   - At each launch of a Claude Code session, the kit asks `claude --version`
//     for the installed version. A noted conversation fits when it was noted
//     under the session's launch shape and the FIRST `prompt_snapshot` record
//     of its transcript has that version, and the record's last section is the
//     kit's appended text. The kit saves the record's other sections as
//     `<bots>.claude-text/<bot>/originals/<version>-<shape>.json` and builds from
//     that copy: the recipe's drop and cut units out, the rest joined with a
//     blank line, written to `<bots>.claude-text/<bot>/main-<sum>.md`. The line
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
//       builds from it when the record is gone. At a later launch, an
//       original or a note of another version goes, and a note with no
//       record goes once it is a week old.
//   T5. The fit: another model, another extra argument, another tool cut,
//       another memory folder named by hand, a change of a Claude Code
//       settings file the session reads, or another version does not fit; a
//       `text:` cut does, and keeps the shape. extra_args that name
//       --settings, in any form, give no shape: the session runs on its own
//       text, health's main_text names its --settings, and the own-settings
//       finding lists the kit's main text.
//   T6. The book: own_text and main, and a resume keeps both.
//   T7. Health. A paused session or bot is not running, so health names
//       nothing of its main text until it is unpaused and starts.
//   T8. Retire.
//   T9. The folders: sources, originals and main files are in
//       `<bots>.claude-text/<bot>/`, which no Codex launch line names.
//   T10. With units that cannot be built now, the line and the hook use the
//       kit's own copy of its last system text, never the newest
//       `system-*.md` by time.
//   T11. The model of a note: a start keeps the hook input's model, a clear
//       the line's; a record of another model is no source, and health names
//       both models. A clear on a line with no model is no note.
//   T12. The parts that Claude Code adds by itself after a replaced text
//       (#784, ADR 0061): health reads the first record of the main file in
//       the conversation of a session on the kit's main file (the first
//       snapshot whose first section is that file). A part it holds two
//       times goes on the session's line and in main_text's `twice`, by size
//       and sum, and fails nothing. A part that comes back is a recipe unit
//       like any other: health names it when a saved original lacks it.
//
// No text of Claude Code is in this file: the sections are made up. A fake
// `claude` on the sandbox's PATH answers `--version` in every test, so the real
// one on this machine is never run. Every run is in the sandbox
// (helpers/cli.js): its own HOME and a fake Orca. The hook runs under the
// stand-in processes whose argv carries the launch line, and the fake ps
// answers for them (helpers/cli.js recordSession, helpers/fake-ps.js).

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, appendFile, mkdir, readdir, readFile, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { parse, stringify } from 'yaml';

import {
  botHomeOf,
  conversationOnRecord,
  createSandbox,
  fakeProgram,
  harnessWordsOf,
  kitDirsOf,
  launchLineInTab,
  recordSession,
  repoRoot,
  sessionIn,
  sessionStart,
  SYSTEM_FLAG,
  tabsOfBot,
} from './helpers/cli.js';
import { addRules, mainUnitsText } from './helpers/rules.js';

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
/** The kit's folder for the bot's main text, beside the bots folder: its sources, originals and main files (#769). */
const textOf = (bots) => path.join(`${bots}.claude-text`, BOT);
const sourceOf = (bots, id) => path.join(textOf(bots), 'sources', `${id}.json`);
const originalsOf = (bots) => path.join(textOf(bots), 'originals');

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
const mainFiles = async (bots) => (await namesIn(textOf(bots)))
  .filter((name) => /^main-[0-9a-f]{16}\.md$/.test(name)).map((name) => path.join(textOf(bots), name));

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

/** The words of `words` without the appended file's flag and its value: a bare resume's line. */
function withoutSystem(words) {
  const at = words.indexOf(SYSTEM_FLAG);
  return at < 0 ? words : words.filter((word, index) => index !== at && index !== at + 1);
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
async function hook(box, bots, { session, source, line, name = 'daily', model = MODEL }) {
  const tab = (await liveTab(box, bots, name)).tabId;
  // The SessionStart input, with the model the session runs on, as Claude Code
  // gives it (the architect's ruling on #783); `model: null` leaves it out.
  const input = JSON.parse(sessionStart({
    session,
    source,
    cwd: await realpath(botHomeOf(bots, BOT)),
    transcript: await transcriptOf(box, bots, session),
  }));
  const ran = await recordSession(box, {
    bots,
    bot: BOT,
    tab,
    stdin: `${JSON.stringify(model === null ? input : { ...input, model })}\n`,
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
  await hook(box, bots, { session: id, source: 'startup', model });
  assert.ok(await exists(sourceOf(bots, id)), `the premise: the start on the kit's line is noted at ${sourceOf(bots, id)}`);
  await onRecord(box, bots, id, [{ sections: [...sections, text], version }], { model });
  return { bots, words, appended: text };
}

/**
 * The control for a test that expects no main file: a start on the kit's line
 * then notes a new conversation, its record fits, and the next restart gives
 * a main file. So the test cannot pass only because nothing is built at all.
 */
async function thenAFit(box, bots, why) {
  const { text } = await appendedOf(await wordsOf(box, bots));
  await hook(box, bots, { session: 'conv-fit', source: 'startup' });
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

/** `obk health --json` whole: its findings, its sessions, and its exit code. */
async function healthOf(box) {
  const result = await box.run(['health', '--bots', 'bots', '--json']);
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`health --json should print JSON, got (${error.message}):\n${result.stdout}${result.stderr}`);
  }
  assert.ok(Array.isArray(answer.found) && Array.isArray(answer.sessions), `health answers with findings and sessions, got: ${result.stdout}`);
  return { found: answer.found, sessions: answer.sessions, code: result.code };
}

/** The entry of `sessions` for api-bot's `session`, or undefined. */
const entryOf = (sessions, session) => sessions.find((one) => one.bot === BOT && one.session === session);

/** The `main_text` of api-bot's `session` in health's sessions, with the premise that the entry is there. */
function mainTextIn(sessions, session, why) {
  const entry = entryOf(sessions, session);
  assert.ok(entry, `${why}: health's sessions should list ${BOT}/${session}, got: ${show(sessions)}`);
  return entry.main_text;
}

/** Health's findings on api-bot/<session>'s main text: its own text, a restart for the kit's text, or an older main file. */
const mainTextOf = (found, session) => found.filter((one) => typeof one.says === 'string'
  && one.says.startsWith(`${BOT}/${session}`) && one.says.includes('main text'));

/** The text line of `obk health` for api-bot's `session`. */
async function textLineOf(box, session) {
  const result = await box.run(['health', '--bots', 'bots']);
  const line = result.stdout.split('\n').find((one) => one.includes(`${BOT} ${session} `));
  assert.equal(typeof line, 'string', `health should print a line for ${BOT} ${session}, got:\n${result.stdout}`);
  return line;
}

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
    // The line names the model, so a clear is a source (the architect's ruling on #783).
    const bots = await started(box, { daily: ['--model', MODEL] });

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
      'kit-main': withBefore(words, [MAIN_FLAG, path.join(textOf(bots), 'main-0123456789abcdef.md')]),
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

describe('T2 the whole launch line', () => {
  /** The kit's line with `extra` put in directly before its prompt separator `--`. */
  function beforePrompt(words, extra) {
    const at = words.indexOf('--');
    assert.ok(at > 0, `the premise: the kit's line has a prompt after --, got: ${show(words)}`);
    return [...words.slice(0, at), ...extra, ...words.slice(at)];
  }

  test('T2 a --settings value that holds " -- ", then a real --system-prompt: the start is not noted', async (t) => {
    const box = await createSandbox(t);
    const bots = await started(box);
    const words = await wordsOf(box, bots);
    const line = beforePrompt(words, [
      '--settings', JSON.stringify({ env: { DOC_NOTE: 'A note -- with a separator' } }),
      '--system-prompt', 'CUSTOM',
    ]);

    await hook(box, bots, { session: 'conv-1', source: 'startup', line });

    assert.equal(await exists(sourceOf(bots, 'conv-1')), false, `a replaced text after a " -- " in a value is still read, got a note for: ${show(line)}`);
    await hook(box, bots, { session: 'conv-kit', source: 'startup' });
    assert.ok(await exists(sourceOf(bots, 'conv-kit')), 'the control: the kit\'s own line is noted');
  });

  test('T2 a prompt after the kit\'s " -- " that names --system-prompt: the start is not noted, the safe way', async (t) => {
    const box = await createSandbox(t);
    const bots = await started(box);
    const words = await wordsOf(box, bots);
    const at = words.indexOf('--');
    assert.ok(at > 0 && at === words.length - 2, `the premise: the kit's line ends with -- and its prompt, got: ${show(words)}`);
    const line = [...words.slice(0, -1), 'Read the notes on --system-prompt before you start.'];

    await hook(box, bots, { session: 'conv-1', source: 'startup', line });

    assert.equal(await exists(sourceOf(bots, 'conv-1')), false, `the whole line is read, its prompt too, got a note for: ${show(line)}`);
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
    assert.equal(path.dirname(real), await realpath(textOf(bots)), `the main file is in the bot's main text folder beside the bots repo, got: ${main}`);
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

  test('T4 at a later launch, a saved original of another version goes; one of the installed version stays, also of a shape no session has', async (t) => {
    // A temporary role between two temporary sessions has a shape that no book entry holds.
    const box = await createSandbox(t);
    const { bots } = await noted(box);
    await restart(box);
    assertMainNamed(await wordsOf(box, bots), 'the premise: the first build');
    const { shape } = await sessionIn(bots, BOT, 'daily');
    const saved = path.join(originalsOf(bots), `${V}-${shape}.json`);
    assert.ok(await exists(saved), `the premise: the original is saved at ${saved}`);
    const foreign = `${shape.slice(0, -1)}${shape.endsWith('0') ? '1' : '0'}`;
    const older = `2.1.300-${shape}.json`;
    const unheld = `${V}-${foreign}.json`;
    const copy = await readFile(saved, 'utf8');
    await writeFile(path.join(originalsOf(bots), older), copy);
    await writeFile(path.join(originalsOf(bots), unheld), copy);

    await restart(box);

    const names = await namesIn(originalsOf(bots));
    assert.ok(!names.includes(older), `the original of another version is gone, got: ${show(names)}`);
    assert.ok(names.includes(`${V}-${shape}.json`), `the session's own stays, got: ${show(names)}`);
    assert.ok(names.includes(unheld), `one of the installed version stays, though no session has its shape, got: ${show(names)}`);
  });

  test('T4 at a later launch, a note whose first record is of another version goes; one of the installed version stays; one with no record goes once a week old', async (t) => {
    const box = await createSandbox(t);
    const bots = await started(box, { more: [['nightly', ['--model', 'sonnet']]] });
    const { text } = await appendedOf(await wordsOf(box, bots));
    // nightly: a note of the installed version, of a shape daily's launch does not use.
    await hook(box, bots, { session: 'conv-night', source: 'startup', name: 'nightly' });
    await onRecord(box, bots, 'conv-night', [[...LATER, text]]);
    // daily: a note whose first record is of another version, then one with no record at all.
    await hook(box, bots, { session: 'conv-old', source: 'startup' });
    await onRecord(box, bots, 'conv-old', [{ sections: [...SECTIONS, text], version: '2.1.300' }]);
    await hook(box, bots, { session: 'conv-none', source: 'startup' });
    for (const id of ['conv-night', 'conv-old', 'conv-none']) assert.ok(await exists(sourceOf(bots, id)), `the premise: ${id} is noted`);

    await restart(box);

    assert.equal(await exists(sourceOf(bots, 'conv-old')), false, 'the note of another version is gone');
    assert.ok(await exists(sourceOf(bots, 'conv-night')), 'the note of the installed version stays');
    assert.ok(await exists(sourceOf(bots, 'conv-none')), 'a note with no record, under a week old, stays');
    // The restart started daily fresh (conv-none has nothing to resume): its start, as the hook reports it.
    await hook(box, bots, { session: 'conv-after', source: 'startup' });
    await onRecord(box, bots, 'conv-after', []);

    const note = JSON.parse(await readFile(sourceOf(bots, 'conv-none'), 'utf8'));
    await writeFile(sourceOf(bots, 'conv-none'), `${JSON.stringify({ ...note, at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() })}\n`);
    await restart(box);

    assert.equal(await exists(sourceOf(bots, 'conv-none')), false, 'a note with no record, a week old, is gone');
    assert.ok(await exists(sourceOf(bots, 'conv-night')), 'the note of the installed version still stays');
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
  async function changed(box, change, options = {}) {
    const { bots } = await noted(box, options);
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

  /** The Claude Code settings files a session of the bot reads, each by who writes it. */
  const SETTINGS = {
    'the bot\'s .claude/settings.local.json': (box, bots) => path.join(botHomeOf(bots, BOT), '.claude', 'settings.local.json'),
    'the repository root\'s .claude/settings.local.json': (box, bots) => path.join(bots, '.claude', 'settings.local.json'),
    'the user\'s ~/.claude/settings.json': (box) => path.join(box.home, '.claude', 'settings.json'),
  };

  /** Put `keys` into a settings file, as a user edits it: what it held stays. */
  async function setIn(file, keys) {
    let held = {};
    try {
      held = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify({ ...held, ...keys }, null, 2)}\n`);
  }

  /** Note a start on the session's current line, and put its record on file with the kit's appended text last. */
  async function noteNow(box, bots, id) {
    const { text } = await appendedOf(await wordsOf(box, bots));
    await hook(box, bots, { session: id, source: 'startup' });
    assert.ok(await exists(sourceOf(bots, id)), `the premise: the start on the kit's line is noted at ${sourceOf(bots, id)}`);
    await onRecord(box, bots, id, [[...SECTIONS, text]]);
  }

  test('T5 a memory folder the user names by hand does not fit a record of the kit\'s folder, and is another shape', async (t) => {
    const box = await createSandbox(t);
    const { bots, words, before, after } = await changed(box, (bots) => setIn(
      SETTINGS['the bot\'s .claude/settings.local.json'](box, bots),
      { autoMemoryDirectory: path.join(box.root, 'own-memory', 'first') },
    ));

    assertOwnText(words, 'a memory folder named by hand');
    assert.notEqual(after, before, 'the shape changed');
    assert.deepEqual(await mainFiles(bots), []);
  });

  test('T5 a change of the memory folder the user names by hand does not fit a record of the folder before, and is another shape', async (t) => {
    const box = await createSandbox(t);
    const bots = await started(box);
    // A conversation the book knows, so the restart can close the tab.
    await hook(box, bots, { session: 'conv-0', source: 'startup' });
    await onRecord(box, bots, 'conv-0', []);
    const local = SETTINGS['the bot\'s .claude/settings.local.json'](box, bots);
    await setIn(local, { autoMemoryDirectory: path.join(box.root, 'own-memory', 'first') });
    await restart(box);
    await noteNow(box, bots, 'conv-first');
    await restart(box);
    assertMainNamed(await wordsOf(box, bots), 'the premise: a record under the first folder fits');
    const before = (await sessionIn(bots, BOT, 'daily')).shape;

    await setIn(local, { autoMemoryDirectory: path.join(box.root, 'own-memory', 'second') });
    await restart(box);

    assertOwnText(await wordsOf(box, bots), 'another memory folder named by hand');
    assert.notEqual((await sessionIn(bots, BOT, 'daily')).shape, before, 'the shape changed');
  });

  for (const [which, fileOf] of Object.entries(SETTINGS)) {
    test(`T5 a change of ${which} that names no memory folder does not fit, and is another shape`, async (t) => {
      const box = await createSandbox(t);
      const { bots, words, before, after } = await changed(box, (bots) => setIn(fileOf(box, bots), { outputStyle: 'Explanatory' }));

      assertOwnText(words, `a change of ${which}`);
      assert.notEqual(after, before, 'the shape changed');
      assert.deepEqual(await mainFiles(bots), []);
    });
  }

  test('T5 a change of only permissions.allow in the bot\'s .claude/settings.local.json keeps the shape and the main file', async (t) => {
    // A fenced probe on 2.1.325: allow and ask do not change the main text, so the shape leaves them out.
    const box = await createSandbox(t);
    const { bots, words, before, after } = await changed(box, (bots) => setIn(
      SETTINGS['the bot\'s .claude/settings.local.json'](box, bots),
      { permissions: { allow: ['Bash(ls:*)'] } },
    ));

    const main = assertMainNamed(words, 'a change of permissions.allow');
    assert.equal(after, before, 'the shape is the same');
    assert.equal(await readFile(main, 'utf8'), SECTIONS.join('\n\n'));
  });

  test('T5 a change of permissions.deny in the bot\'s .claude/settings.local.json does not fit, and is another shape', async (t) => {
    const box = await createSandbox(t);
    const { bots, words, before, after } = await changed(box, (bots) => setIn(
      SETTINGS['the bot\'s .claude/settings.local.json'](box, bots),
      { permissions: { deny: ['Bash(rm:*)'] } },
    ));

    assertOwnText(words, 'a change of permissions.deny');
    assert.notEqual(after, before, 'the shape changed');
    assert.deepEqual(await mainFiles(bots), []);
  });

  /** Set keys of daily's entry in the bot's bot.yaml, as a user edits the file by hand. */
  async function handSet(bots, keys) {
    const file = botYamlOf(bots);
    const doc = parse(await readFile(file, 'utf8'));
    doc.sessions = doc.sessions.map((one) => (one.name === 'daily' ? { ...one, ...keys } : one));
    await writeFile(file, stringify(doc));
    const entry = parse(await readFile(file, 'utf8')).sessions.find((one) => one.name === 'daily');
    for (const [key, value] of Object.entries(keys)) assert.deepEqual(entry[key], value, `the premise: bot.yaml holds ${key} as written`);
  }

  test('T5 another extra_args string, which the kit types as shell text, does not fit, and is another shape', async (t) => {
    const box = await createSandbox(t);
    const bots = await started(box);
    // A conversation the book knows, so the restart can close the tab.
    await hook(box, bots, { session: 'conv-0', source: 'startup' });
    await onRecord(box, bots, 'conv-0', []);
    await handSet(bots, { extra_args: '--verbose' });
    await restart(box);
    await noteNow(box, bots, 'conv-1');
    await restart(box);
    assertMainNamed(await wordsOf(box, bots), 'the premise: a record under extra_args "--verbose" fits');
    const before = (await sessionIn(bots, BOT, 'daily')).shape;

    await handSet(bots, { extra_args: '--no-chrome' });
    await restart(box);

    assertOwnText(await wordsOf(box, bots), 'another extra_args string');
    assert.notEqual((await sessionIn(bots, BOT, 'daily')).shape, before, 'the shape changed');
  });

  /** The settings files where a user may set Claude Code's default model. */
  const MODEL_SETTINGS = {
    'the user\'s ~/.claude/settings.json': SETTINGS['the user\'s ~/.claude/settings.json'],
    'the bot\'s .claude/settings.local.json': SETTINGS['the bot\'s .claude/settings.local.json'],
  };

  for (const [which, fileOf] of Object.entries(MODEL_SETTINGS)) {
    test(`T5 for a session that names its model, a change of only model in ${which} keeps the shape and the main file`, async (t) => {
      const box = await createSandbox(t);
      const { words, before, after } = await changed(
        box,
        (bots) => setIn(fileOf(box, bots), { model: 'claude-default-model-3' }),
        { daily: ['--model', MODEL] },
      );

      const main = assertMainNamed(words, `a default model in ${which}, under the session's own`);
      assert.equal(after, before, 'the shape is the same');
      assert.equal(await readFile(main, 'utf8'), SECTIONS.join('\n\n'));
    });

    test(`T5 for a session that names no model, a change of only model in ${which} is another shape, and does not fit`, async (t) => {
      const box = await createSandbox(t);
      const { bots, words, before, after } = await changed(box, (bots) => setIn(fileOf(box, bots), { model: 'claude-default-model-3' }));

      assertOwnText(words, `a default model in ${which}, with none of the session's own`);
      assert.notEqual(after, before, 'the shape changed');
      assert.deepEqual(await mainFiles(bots), []);
    });
  }

  /** extra_args that name --settings, in each form the kit may meet. Each gives the words, from a settings file's path. */
  const OWN_SETTINGS = {
    'a list, --settings <file>': (file) => ['--settings', file],
    'a list, --settings=<file>': (file) => [`--settings=${file}`],
    'a list, --settings with inline JSON': () => ['--settings', '{"env":{}}'],
    'a string, --settings <file>': (file) => `--settings ${file}`,
  };

  for (const [form, extra] of Object.entries(OWN_SETTINGS)) {
    test(`T5 extra_args that name --settings (${form}): no main file, not even from a record that fit before; main_text own, whose why names its --settings; no main-text finding; the own-settings finding names the kit's main text`, async (t) => {
      const box = await createSandbox(t);
      const bots = await started(box);
      const { text } = await appendedOf(await wordsOf(box, bots));
      // A note and a record that fit the launch before the setting.
      await hook(box, bots, { session: 'conv-0', source: 'startup' });
      assert.ok(await exists(sourceOf(bots, 'conv-0')), 'the premise: the start before the setting is noted');
      await onRecord(box, bots, 'conv-0', [[...SECTIONS, text]]);
      const file = path.join(box.root, 'own-settings', 'daily.json');
      await setIn(file, { outputStyle: 'Concise' });
      await handSet(bots, { extra_args: extra(file) });

      await restart(box);

      assertOwnText(await wordsOf(box, bots), `its own --settings (${form}), at the first launch`);
      // A start and a record under that launch.
      await hook(box, bots, { session: 'conv-1', source: 'startup' });
      await onRecord(box, bots, 'conv-1', [[...SECTIONS, text]]);
      await restart(box);
      assertOwnText(await wordsOf(box, bots), `its own --settings (${form}), after a start and a record`);
      assert.deepEqual(await mainFiles(bots), []);
      const { found, sessions } = await healthOf(box);
      const state = mainTextIn(sessions, 'daily', `its own --settings (${form})`);
      assert.equal(state?.state, 'own', `main_text is own, got: ${show(state)}`);
      assert.ok(typeof state.why === 'string' && state.why.includes('--settings'), `its why names its own --settings, got: ${show(state)}`);
      assert.deepEqual(mainTextOf(found, 'daily'), [], `no finding on its main text: it is no new failing finding, got: ${show(found)}`);
      const own = found.filter((one) => typeof one.says === 'string'
        && one.says.startsWith(`${BOT}'s session daily `) && one.says.includes('carries its own --settings'));
      assert.equal(own.length, 1, `one own-settings finding for daily, got: ${show(found)}`);
      assert.ok(own[0].says.includes('the kit\'s main text'), `it lists the kit's main text as what it runs without, got: ${own[0].says}`);
    });
  }

  test('T5 health\'s main_text is of the recorded launch: --settings put into extra_args, then taken out, with no restart, leaves a session on the kit\'s main file kit', async (t) => {
    const box = await createSandbox(t);
    const { bots } = await noted(box);
    await restart(box);
    assertMainNamed(await wordsOf(box, bots), 'the premise: the kit gives its main text');
    await hook(box, bots, { session: 'conv-2', source: 'clear' });
    assert.deepEqual(mainTextIn((await healthOf(box)).sessions, 'daily', 'the premise'), { state: 'kit' }, 'the premise: the session runs on the kit\'s main file');
    const file = path.join(box.root, 'own-settings', 'daily.json');
    await setIn(file, { outputStyle: 'Concise' });

    await handSet(bots, { extra_args: ['--settings', file] });

    const set = await healthOf(box);
    assert.deepEqual(mainTextIn(set.sessions, 'daily', 'its own --settings in bot.yaml, no restart'), { state: 'kit' },
      'until its restart, the session still runs on the kit\'s main file');
    assert.deepEqual(mainTextOf(set.found, 'daily'), [], `no finding on its main text, got: ${show(set.found)}`);

    await handSet(bots, { extra_args: undefined });

    const unset = await healthOf(box);
    assert.deepEqual(mainTextIn(unset.sessions, 'daily', 'its own --settings taken out again, no restart'), { state: 'kit' },
      'the session still runs on the kit\'s main file');
    assert.deepEqual(mainTextOf(unset.found, 'daily'), [], `no finding on its main text, got: ${show(unset.found)}`);
  });

  test('T5 health\'s main_text is of the recorded launch: --settings put into extra_args, then taken out, with no restart, leaves a session on an older main file older', async (t) => {
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
    const before = mainTextIn((await healthOf(box)).sessions, 'daily', 'the premise');
    assert.equal(before?.state, 'older', `the premise: the session runs on an older main file, got: ${show(before)}`);
    assert.ok(typeof before.why === 'string' && before.why.includes('compaction'), `the premise: its why names the next compaction, got: ${show(before)}`);
    const file = path.join(box.root, 'own-settings', 'daily.json');
    await setIn(file, { outputStyle: 'Concise' });

    await handSet(bots, { extra_args: ['--settings', file] });

    const set = await healthOf(box);
    assert.deepEqual(mainTextIn(set.sessions, 'daily', 'its own --settings in bot.yaml, no restart'), before,
      'until its restart, the session still runs on the older main file, with the same why');
    assert.deepEqual(mainTextOf(set.found, 'daily'), [], `no finding on its main text, got: ${show(set.found)}`);

    await handSet(bots, { extra_args: undefined });

    const unset = await healthOf(box);
    assert.deepEqual(mainTextIn(unset.sessions, 'daily', 'its own --settings taken out again, no restart'), before,
      'the session still runs on the older main file, with the same why');
    assert.deepEqual(mainTextOf(unset.found, 'daily'), [], `no finding on its main text, got: ${show(unset.found)}`);
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

    await hook(box, bots, { session: 'conv-1', source: 'resume', line: withBefore(words, [MAIN_FLAG, path.join(textOf(bots), 'main-0123456789abcdef.md')]) });
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

  test('T7 no fitting record yet is a normal wait: no finding, exit 0, and main_text own, whose why names a resume and a clear', async (t) => {
    const box = await createSandbox(t);
    const bots = await started(box);
    await hook(box, bots, { session: 'conv-1', source: 'startup' });

    const { found, sessions, code } = await healthOf(box);

    assert.deepEqual(mainTextOf(found, 'daily'), [], `no finding, got: ${show(found)}`);
    const text = mainTextIn(sessions, 'daily', 'a session on its own text');
    assert.equal(text?.state, 'own', `got: ${show(text)}`);
    assert.ok(typeof text.why === 'string' && text.why.includes('resume') && text.why.includes('clear'), `the why says a resume records nothing, and names a start and a clear, got: ${show(text)}`);
    assert.deepEqual(found, [], `nothing else is wrong, got: ${show(found)}`);
    assert.equal(code, 0);
    const line = await textLineOf(box, 'daily');
    assert.ok(line.endsWith(`main text own: ${text.why}`), `the line ends with the state and the why, got: ${line}`);
  });

  test('T7 the kit\'s text ready for a restart is a normal wait: no finding, and main_text own, whose why names obk restart', async (t) => {
    const box = await createSandbox(t);
    await noted(box);

    const { found, sessions, code } = await healthOf(box);

    assert.deepEqual(mainTextOf(found, 'daily'), [], `no finding, got: ${show(found)}`);
    const text = mainTextIn(sessions, 'daily', 'a session whose record now fits');
    assert.equal(text?.state, 'own', `got: ${show(text)}`);
    assert.ok(typeof text.why === 'string' && text.why.includes('obk restart') && text.why.includes('compaction'), `the why names obk restart, and a resumed conversation's next compaction, got: ${show(text)}`);
    assert.deepEqual(found, [], `nothing else is wrong, got: ${show(found)}`);
    assert.equal(code, 0);
  });

  for (const [what, scope] of [['a paused session', ['--session', 'daily']], ['a paused bot', []]]) {
    test(`T7 ${what} on its own text has no main_text while paused, and has it again once unpaused and started`, async (t) => {
      const box = await createSandbox(t);
      const bots = await started(box, { more: [['review', []]] });
      await hook(box, bots, { session: 'conv-1', source: 'startup' });
      await onRecord(box, bots, 'conv-1', []);
      await hook(box, bots, { session: 'conv-r', source: 'startup', name: 'review' });
      await onRecord(box, bots, 'conv-r', []);
      assert.equal(mainTextIn((await healthOf(box)).sessions, 'daily', 'the premise')?.state, 'own', 'the premise: daily runs on its own text');

      await ok(box, ['pause', '--bots', 'bots', '--bot', BOT, ...scope]);
      const { found, sessions } = await healthOf(box);

      assert.equal(entryOf(sessions, 'daily')?.main_text, undefined, `paused, daily is not running, got: ${show(sessions)}`);
      assert.deepEqual(mainTextOf(found, 'daily'), [], `and no finding, got: ${show(found)}`);
      if (scope.length > 0) assert.equal(mainTextIn(sessions, 'review', 'review is not paused')?.state, 'own', `review still has its main_text, got: ${show(sessions)}`);
      else assert.equal(entryOf(sessions, 'review')?.main_text, undefined, `the whole bot is paused, review too, got: ${show(sessions)}`);

      await ok(box, ['unpause', '--bots', 'bots', '--bot', BOT, ...scope]);
      await hook(box, bots, { session: 'conv-1', source: 'resume' });

      assert.equal(mainTextIn((await healthOf(box)).sessions, 'daily', 'unpaused and started')?.state, 'own', 'daily has its main_text again');
    });
  }

  test('T7 a session that cleared on the kit\'s current main file has main_text kit, and no finding', async (t) => {
    const box = await createSandbox(t);
    const { bots } = await noted(box);
    await restart(box);
    assertMainNamed(await wordsOf(box, bots), 'the premise: the kit gives its main text');
    await hook(box, bots, { session: 'conv-2', source: 'clear' });

    const { found, sessions } = await healthOf(box);

    assert.deepEqual(mainTextIn(sessions, 'daily', 'a session on the kit\'s text'), { state: 'kit' });
    assert.deepEqual(mainTextOf(found, 'daily'), [], `got: ${show(found)}`);
    assert.ok((await textLineOf(box, 'daily')).endsWith('main text kit'), 'the line ends with the state');
  });

  test('T7 a session whose noted main file is not the current one has main_text older, whose why names the next compaction', async (t) => {
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

    const { found, sessions } = await healthOf(box);

    const text = mainTextIn(sessions, 'daily', 'a session on an older main file');
    assert.equal(text?.state, 'older', `got: ${show(text)}`);
    assert.ok(typeof text.why === 'string' && text.why.includes('compaction'), `got: ${show(text)}`);
    assert.deepEqual(mainTextOf(found, 'daily'), [], `no finding, got: ${show(found)}`);
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

// ================================================================ T9

describe('T9 the folders', () => {
  test('T9 no Codex launch line names the main text folder: a Codex session of the same bot gets --add-dir for messages, prompts and locks only', async (t) => {
    const box = await createSandbox(t);
    const { bots } = await noted(box, { more: [['nightly', ['--harness', 'codex']]] });
    await restart(box);
    assertMainNamed(await wordsOf(box, bots), 'the premise: the Claude Code session gets the kit\'s main text');
    assert.ok(await exists(textOf(bots)), `the premise: the main text folder is there, ${textOf(bots)}`);
    await hook(box, bots, { session: 'conv-night', source: 'startup', name: 'nightly' });
    await conversationOnRecord(box, { harness: 'codex', cwd: botHomeOf(bots, BOT), id: 'conv-night' });

    await restart(box, 'nightly');

    const words = await wordsOf(box, bots, 'nightly');
    assert.equal(words[0], 'codex', `the premise: nightly starts on Codex, got: ${show(words)}`);
    const text = `${bots}.claude-text`;
    assert.deepEqual(words.filter((word) => word.includes(text)), [], `no word of the Codex line names ${text}, got: ${show(words)}`);
    const added = words.flatMap((word, at) => (words[at - 1] === '--add-dir' ? [path.resolve(word)] : []));
    assert.deepEqual(added.sort(), kitDirsOf(bots, BOT).map((dir) => path.resolve(dir)).sort(), `--add-dir for messages, prompts and locks, got: ${show(words)}`);
  });
});

// ================================================================ T10

describe('T10 units that cannot be built now', () => {
  test('T10 the line and the hook use the kit\'s own copy of its last system text, not the newest system file in the prompts folder', async (t) => {
    const box = await createSandbox(t);
    const bots = await started(box);
    await hook(box, bots, { session: 'conv-0', source: 'startup' });
    await onRecord(box, bots, 'conv-0', []);
    const { file: kitFile, text: kitText } = await appendedOf(await wordsOf(box, bots));
    const main = await mainUnitsText(bots, BOT);
    assert.ok(kitText.includes(main), 'the premise: the kit\'s system text holds the main units');
    const tab = (await liveTab(box, bots)).tabId;

    // A unit with a placement the kit refuses: the bot's units cannot be built now.
    await mkdir(path.join(bots, 'rules'), { recursive: true });
    await writeFile(path.join(bots, 'rules', 'crooked.md'), '---\ntitle: Crooked Unit\nplacement: sideways\n---\n\nA unit with a placement no one knows.\n');
    await addRules(botYamlOf(bots), 'crooked');
    // And a system file the kit did not write, newer than the kit's.
    const PLANTED = '## Planted Unit\n\nA text that the kit never wrote.\n';
    const planted = path.join(promptsOf(bots), 'system-0123456789abcdef.md');
    await writeFile(planted, PLANTED);
    const later = new Date(Date.now() + 60_000);
    await utimes(planted, later, later);

    await box.run(['restart', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);

    const after = await liveTab(box, bots);
    assert.notEqual(after.tabId, tab, 'the premise: the session was started again in a new tab');
    const named = valueOf(await wordsOf(box, bots), SYSTEM_FLAG);
    assert.equal(typeof named, 'string', 'the line still appends the kit\'s system text');
    assert.notEqual(path.resolve(named), planted, `the line does not name the planted file, got: ${named} (the kit's was ${kitFile})`);
    assert.equal(await readFile(path.resolve(named), 'utf8'), kitText, 'the line names a file with the kit\'s last system text');

    const ran = await hook(box, bots, { session: 'conv-2', source: 'startup', line: withoutSystem(await wordsOf(box, bots)) });
    const context = ran.stdout === '' ? undefined : JSON.parse(ran.stdout).hookSpecificOutput?.additionalContext;
    assert.equal(typeof context, 'string', `the hook gives the main units as context, got: ${ran.stdout}`);
    assert.ok(context.includes(main), `the context holds the kit's main units, got:\n${context}`);
    assert.ok(!context.includes('A text that the kit never wrote.'), `and not the planted text, got:\n${context}`);
  });
});

// ================================================================ T11

describe('T11 the model of a note', () => {
  const OTHER = 'claude-other-model-2';

  test('T11 a start notes the model of the hook input: a record of that model fits, though bot.yaml names the model by a short name', async (t) => {
    const box = await createSandbox(t);
    const bots = await started(box, { daily: ['--model', 'opus'] });
    const { text } = await appendedOf(await wordsOf(box, bots));
    await hook(box, bots, { session: 'conv-1', source: 'startup', model: MODEL });
    await onRecord(box, bots, 'conv-1', [[...SECTIONS, text]], { model: MODEL });

    await restart(box);

    const main = assertMainNamed(await wordsOf(box, bots), 'a start of the hook input\'s model');
    assert.equal(await readFile(main, 'utf8'), SECTIONS.join('\n\n'));
  });

  /** daily on the line's model MODEL, started (no record to build from), then cleared with `model` in the hook input and a record of `recorded`. */
  async function cleared(box, { model, recorded }) {
    const bots = await started(box, { daily: ['--model', MODEL] });
    const { text } = await appendedOf(await wordsOf(box, bots));
    await hook(box, bots, { session: 'conv-0', source: 'startup', model: MODEL });
    await onRecord(box, bots, 'conv-0', []);
    await hook(box, bots, { session: 'conv-2', source: 'clear', model });
    await onRecord(box, bots, 'conv-2', [[...SECTIONS, text]], { model: recorded });
    await restart(box);
    return bots;
  }

  test('T11 a clear notes the model the line names: a record of that model fits', async (t) => {
    const box = await createSandbox(t);
    const bots = await cleared(box, { model: MODEL, recorded: MODEL });

    const main = assertMainNamed(await wordsOf(box, bots), 'a clear on the line\'s model');
    assert.equal(await readFile(main, 'utf8'), SECTIONS.join('\n\n'));
  });

  test('T11 a clear whose record names another model than the line (a /model switch, then a clear) gives no main file', async (t) => {
    const box = await createSandbox(t);
    const bots = await cleared(box, { model: OTHER, recorded: OTHER });

    assertOwnText(await wordsOf(box, bots), 'a clear after a /model switch');
    assert.deepEqual(await mainFiles(bots), []);
  });

  test('T11 a clear keeps the model of the launch, not the model bot.yaml names at the clear', async (t) => {
    const OPUS = 'claude-opus-test-9';
    const FABLE = 'claude-fable-test-9';
    const box = await createSandbox(t);
    const bots = await started(box, { daily: ['--model', OPUS] });
    const { text } = await appendedOf(await wordsOf(box, bots));
    await hook(box, bots, { session: 'conv-0', source: 'startup', model: OPUS });
    await onRecord(box, bots, 'conv-0', []);
    // bot.yaml names Fable now, with no restart: the session still runs the launch's Opus.
    await ok(box, ['session', 'change', '--bots', 'bots', '--bot', BOT, '--session', 'daily', '--model', FABLE]);
    // A /model switch to Fable, then a clear: its record is Fable's.
    await hook(box, bots, { session: 'conv-2', source: 'clear', model: FABLE });
    await onRecord(box, bots, 'conv-2', [[...SECTIONS, text]], { model: FABLE });
    await ok(box, ['session', 'change', '--bots', 'bots', '--bot', BOT, '--session', 'daily', '--model', OPUS]);

    await restart(box);

    assertOwnText(await wordsOf(box, bots), 'the only record is Fable\'s, and the launch was Opus');
    assert.deepEqual(await mainFiles(bots), []);
  });

  test('T11 with no model on the line, a start with a model in the hook input is a source, and a clear is no note', async (t) => {
    const box = await createSandbox(t);
    const bots = await started(box);
    const { text } = await appendedOf(await wordsOf(box, bots));

    await hook(box, bots, { session: 'conv-1', source: 'startup', model: MODEL });
    await hook(box, bots, { session: 'conv-2', source: 'clear', model: MODEL });

    assert.ok(await exists(sourceOf(bots, 'conv-1')), 'the start is noted');
    assert.equal(await exists(sourceOf(bots, 'conv-2')), false, 'the clear is not noted: no model on the line to hold it to');
    await onRecord(box, bots, 'conv-1', [[...SECTIONS, text]], { model: MODEL });
    await onRecord(box, bots, 'conv-2', []);
    await restart(box);
    assertMainNamed(await wordsOf(box, bots), 'the start is a source');
  });

  test('T11 health names both models when the build declined a note for its model', async (t) => {
    const box = await createSandbox(t);
    const bots = await started(box);
    const { text } = await appendedOf(await wordsOf(box, bots));
    await hook(box, bots, { session: 'conv-1', source: 'startup', model: MODEL });
    await onRecord(box, bots, 'conv-1', [[...SECTIONS, text]], { model: OTHER });
    await restart(box);
    assertOwnText(await wordsOf(box, bots), 'the premise: the record is of another model than the note');

    const found = await findings(box);

    assert.ok(aboutSession(found, 'daily', MODEL, OTHER).length >= 1, `one finding names ${MODEL} and ${OTHER}, got: ${show(found)}`);
  });
});

// ================================================================ T12

describe('T12 the parts that Claude Code adds by itself (#784)', () => {
  /**
   * daily on the kit's main file: a noted record, a restart on the kit's line,
   * and a clear, so the book has `main` and the conversation conv-2. Gives back
   * the bots folder, the main file's text and the appended text.
   */
  async function onKitFile(box) {
    const { bots, appended } = await noted(box);
    await restart(box);
    const main = assertMainNamed(await wordsOf(box, bots), 'the premise: the kit gives its main text');
    await hook(box, bots, { session: 'conv-2', source: 'clear' });
    const entry = await sessionIn(bots, BOT, 'daily');
    assert.equal(path.basename(String(entry.main)), path.basename(main), `the premise: the book has daily on the main file, got: ${show(entry)}`);
    assert.equal(entry.session, 'conv-2', `the premise: the book has daily's conversation conv-2, got: ${show(entry)}`);
    return { bots, mainText: await readFile(main, 'utf8'), appended };
  }

  /** A part as health's JSON gives it: its size, and the first 16 hex of its sha256. */
  const partOf = (text) => ({ size: text.length, sum: sha(text).slice(0, 16) });

  /** The words of the health line for parts two times, as the architect gives them (#785). */
  const twiceWords = (parts) => `${parts.length} ${parts.length === 1 ? 'part' : 'parts'} two times (${parts.map((part) => `${part.length} characters, sum ${sha(part).slice(0, 16)}`).join('; ')})`;

  /** A part two times fails nothing: no finding says it (#785). */
  const assertNoTwiceFinding = (found) => assert.deepEqual(saying(found, 'two times'), [], `a part two times is on the session's line, not a finding, got: ${show(found)}`);

  test('T12 a first record of the main file, then a section the file also holds: main_text kit has it in twice, by size and 16-hex sum; the line says main text kit, 1 part two times; health exits 0, and no finding says it', async (t) => {
    const box = await createSandbox(t);
    const { bots, mainText, appended } = await onKitFile(box);
    const part = SECTIONS[1];
    assert.ok(mainText.includes(part), 'the premise: the main file holds the part');
    await onRecord(box, bots, 'conv-2', [[mainText, part, appended]]);

    const { found, sessions, code } = await healthOf(box);
    const line = await textLineOf(box, 'daily');

    assert.deepEqual(mainTextIn(sessions, 'daily', 'a session on the kit\'s text'), { state: 'kit', twice: [partOf(part)] });
    assert.ok(line.endsWith(`main text kit, ${twiceWords([part])}`), `got: ${line}`);
    assert.equal(code, 0, 'a part two times fails nothing');
    assertNoTwiceFinding(found);
    const said = `${line}\n${JSON.stringify(entryOf(sessions, 'daily'))}`;
    for (const words of [...part.split('\n'), SECTIONS[0], SECTIONS[2], appended]) assert.ok(!said.includes(words), `no word of a section, got: ${said}`);
  });

  test('T12 two later sections that the main file holds: twice holds both, in their order, and the line says 2 parts two times, joined by a semicolon', async (t) => {
    const box = await createSandbox(t);
    const { bots, mainText, appended } = await onKitFile(box);
    await onRecord(box, bots, 'conv-2', [[mainText, SECTIONS[2], LATER[0], SECTIONS[0], appended]]);

    const { found, sessions } = await healthOf(box);

    assert.deepEqual(mainTextIn(sessions, 'daily', 'a session on the kit\'s text'), { state: 'kit', twice: [partOf(SECTIONS[2]), partOf(SECTIONS[0])] });
    const line = await textLineOf(box, 'daily');
    assert.ok(line.endsWith(`main text kit, ${twiceWords([SECTIONS[2], SECTIONS[0]])}`), `got: ${line}`);
    assertNoTwiceFinding(found);
  });

  test('T12 a first record of the main file whose later sections the file does not hold: main_text is exactly kit, the line says main text kit and nothing after, and no finding says two times or runs without', async (t) => {
    const box = await createSandbox(t);
    const { bots, mainText, appended } = await onKitFile(box);
    await onRecord(box, bots, 'conv-2', [[mainText, LATER[0], appended]]);

    const { found, sessions } = await healthOf(box);

    assert.deepEqual(mainTextIn(sessions, 'daily', 'a session on the kit\'s text'), { state: 'kit' }, 'no twice and no without key when there is none');
    assert.ok((await textLineOf(box, 'daily')).endsWith('main text kit'), 'the line ends with the state, and nothing after it');
    assertNoTwiceFinding(found);
    assert.deepEqual(saying(found, 'runs without'), [], `a part that did not come back is no finding (#785), got: ${show(found)}`);
  });

  test('T12 a session on an older main file is checked against its own file: main_text older keeps its why and has the part in twice, and the line says main text older, 1 part two times, then the why', async (t) => {
    const box = await createSandbox(t);
    const { bots, appended } = await noted(box);
    await restart(box);
    const words = await wordsOf(box, bots);
    const current = assertMainNamed(words, 'the premise: the kit gives its main text');
    // An older main file of the kit's, of made-up sections, which the book names for daily.
    const part = LATER[1];
    const olderText = [LATER[0], part].join('\n\n');
    const older = path.join(path.dirname(current), `main-${sha(olderText).slice(0, 16)}.md`);
    await writeFile(older, olderText);
    const at = words.indexOf(MAIN_FLAG);
    await hook(box, bots, { session: 'conv-2', source: 'clear', line: words.map((word, index) => (index === at + 1 ? older : word)) });
    assert.equal(path.basename(String((await sessionIn(bots, BOT, 'daily')).main)), path.basename(older), 'the premise: the book notes the older main file');
    await onRecord(box, bots, 'conv-2', [[olderText, part, appended]]);

    const { found, sessions, code } = await healthOf(box);

    const text = mainTextIn(sessions, 'daily', 'a session on an older main file');
    assert.equal(text?.state, 'older', `got: ${show(text)}`);
    assert.ok(typeof text.why === 'string' && text.why.includes('compaction'), `its why stays, got: ${show(text)}`);
    assert.deepEqual(text.twice, [partOf(part)], `the part two times, from the session's own file, got: ${show(text)}`);
    const line = await textLineOf(box, 'daily');
    assert.ok(line.endsWith(`main text older, ${twiceWords([part])}: ${text.why}`), `got: ${line}`);
    assert.equal(code, 0, 'a part two times fails nothing');
    assertNoTwiceFinding(found);
  });

  test('T12 a session on the main file with no transcript yet: main_text is exactly kit, and health answers', async (t) => {
    const box = await createSandbox(t);
    await onKitFile(box);

    const { found, sessions } = await healthOf(box);

    assert.deepEqual(mainTextIn(sessions, 'daily', 'a session on the kit\'s text'), { state: 'kit' });
    assertNoTwiceFinding(found);
  });

  test('T12 a conversation that began on Claude Code\'s own text, then a record of the main file with a part two times: main_text has the part in twice, from that first record of the main file', async (t) => {
    // A resume on the kit's line keeps the conversation's own text until a
    // compaction, whose next request records the kit's text (tech notes, the
    // snapshot): that later record is the first one of the main file.
    const box = await createSandbox(t);
    const { bots, mainText, appended } = await onKitFile(box);
    const part = SECTIONS[1];
    await onRecord(box, bots, 'conv-2', [[...SECTIONS, appended], [mainText, part, appended]]);

    const { found, sessions } = await healthOf(box);

    assert.deepEqual(mainTextIn(sessions, 'daily', 'a session on the kit\'s text'), { state: 'kit', twice: [partOf(part)] });
    assertNoTwiceFinding(found);
  });

  test('T12 two records of the main file, the first with no part two times and the second with one: main_text is exactly kit, since only the first record of the main file counts', async (t) => {
    const box = await createSandbox(t);
    const { bots, mainText, appended } = await onKitFile(box);
    await onRecord(box, bots, 'conv-2', [[mainText, appended], [mainText, SECTIONS[1], appended]]);

    const { found, sessions } = await healthOf(box);

    assert.deepEqual(mainTextIn(sessions, 'daily', 'a session on the kit\'s text'), { state: 'kit' });
    assertNoTwiceFinding(found);
  });

  test('T12 a part that comes back is a recipe unit under R5: health names it, with the model, for a saved original of one of its models that lacks it', async (t) => {
    const box = await createSandbox(t);
    const recipe = await shippedRecipe();
    assert.ok(Array.isArray(recipe.back) && recipe.back.length > 0, `the premise: the shipped recipe names the parts that come back (#784), got the lists: ${show(Object.keys(recipe))}`);
    const model = recipe.back[0].models[0];
    const { bots } = await noted(box, { model });
    await restart(box);
    assert.equal((await namesIn(originalsOf(bots))).length, 1, 'the premise: an original was saved, of made-up sections that hold no part of the recipe');

    const found = await findings(box);

    for (const part of recipe.back.filter((one) => one.models.includes(model))) {
      assert.ok(saying(found, part.name).some((one) => one.says.includes(model)), `${part.name} is named for ${model}, like any unit of the recipe, got: ${show(found)}`);
    }
  });
});

// ================================================================ T8

describe('T8 retire', () => {
  test('T8 retiring the bot removes its sources, its originals and its main files', async (t) => {
    const box = await createSandbox(t);
    const { bots } = await noted(box);
    await restart(box);
    // The save spends the notes of its shape, so a later start on a line with no main file leaves a new one.
    await hook(box, bots, { session: 'conv-3', source: 'startup', line: withoutMain(await wordsOf(box, bots)) });
    const mains = await mainFiles(bots);
    assert.equal(mains.length, 1, 'the premise: a main file');
    assert.equal((await namesIn(originalsOf(bots))).length, 1, 'the premise: an original');
    assert.ok((await namesIn(path.join(textOf(bots), 'sources'))).length >= 1, 'the premise: a source');

    await ok(box, ['retire', '--bots', 'bots', '--bot', BOT]);

    assert.equal(await exists(path.join(textOf(bots), 'sources')), false, 'sources/ is gone');
    assert.equal(await exists(originalsOf(bots)), false, 'originals/ is gone');
    for (const file of mains) assert.equal(await exists(file), false, `${file} is gone`);
  });
});
