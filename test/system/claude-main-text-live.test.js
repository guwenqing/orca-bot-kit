// A system test, and the live check for #769: the kit builds the main system
// text of a Claude Code session from Claude Code's own recorded text, and a
// later session of the same launch runs on it. Against the real Orca and real
// Claude Code on this machine. Run it alone with
// `npm run test:system -- --yes test/system/claude-main-text-live.test.js`,
// between midnight and 6 am local time, and only on the architect's go word;
// `npm test` cannot, and no CI machine could.
//
// The kit ships no word of Claude Code's text. Each conversation's transcript
// records the main text it runs on, as the sections of its first
// `prompt_snapshot` attachment. The kit's hook notes a conversation that
// starts on the kit's own launch line, with no system text on it but the
// kit's appended file, in `<bots>.claude-text/<bot>/sources/<id>.json`. At the
// next start of the same launch shape, the kit saves the record's sections,
// without the appended one, in `originals/<version>-<shape>.json`, cuts the
// units that its recipe names, writes `main-<sum>.md`, and the line gives it
// with `--system-prompt-file` (README, the kit's main text; ADR 0055;
// test/claude-main-text.test.js holds the rules against the fake). This test
// shows what the fake cannot: that real Claude Code records the text, and runs
// on the kit's text when the line names it.
//
// **No text of Claude Code is in this file, in what it prints, or in a failure
// message.** It compares texts by equality and by sha256, and it prints only
// sums, sizes, counts and the recipe's unit names. A screen that a first-run
// allowlist refuses is still in that failure's message, as in the tests
// beside it.
//
// The steps:
//
//   1. A throwaway fleet, by this checkout's CLI. `obk init` brings up Bot
//      Father, which gives the run a project in Orca.
//   2. THE PREMISE. A plain tab of the test's own in that project writes down
//      its CLAUDE_CONFIG_DIR. The kit reads a bot's transcripts in
//      ~/.claude/projects. When the tab's Claude Code writes its transcripts to
//      another folder, the test FAILS here and starts no session: the kit could
//      never read the record, and the run would prove nothing.
//   3. One bot, B, with two Claude sessions, FIRST and SECOND, of one launch
//      shape: model `claude-haiku-5-5`, effort `low`, approval `auto`, Remote
//      Control off. Each start prompt asks for one word and nothing else.
//      Nothing of theirs is up yet, and `<bots>.claude-text/<B>/` holds no note
//      and no saved original.
//   4. FIRST, brought up with `obk up`. It is the first start of its shape, so
//      it runs on Claude Code's own main text. ASSERTED:
//        a. the book has it `own_text`, with no main file, and a shape;
//        b. its start is noted as a source: `sources/<its conversation>.json`
//           names its shape, the kit's appended file, and a model;
//        c. it answers with its word;
//        d. its transcript has a first `prompt_snapshot`. Its model is the
//           note's model, its version is the one the kit's `claude --version`
//           gives, and its last section is the kit's appended text, by the sum
//           in the appended file's name. Each of these is what the build needs.
//      When the note or the record is not found, the test FAILS, with what it
//      found. It never skips on that.
//   5. SECOND, of the same bot and shape, brought up with `obk up`. ASSERTED:
//        a. the book gives SECOND the same shape as FIRST;
//        b. `originals/<version>-<shape>.json` is there, and names FIRST's
//           conversation, its model, the shape and the version. Its sections are
//           FIRST's first record without the appended one (by sha256). So the
//           build used the source that FIRST's start recorded;
//        c. the main file is `main-<sum>.md` of its own text, and its text is
//           what the kit's own `buildMainText` gives for that original and the
//           bot's text cuts (by sha256);
//        d. the book has SECOND on that main file, as the hook read it from
//           the real process's launch line, and not `own_text`;
//        e. it answers with its word;
//        f. its transcript's first `prompt_snapshot`: the last section is the
//           kit's appended text, and the sections before it, joined with a
//           blank line, are the main file's text (by sha256), as the tech notes
//           say a replaced text is recorded. It holds none of the units that
//           FIRST's own text held and the kit cuts: no section, and no line;
//        g. THE CONTROL, in the same run: the same check on FIRST's first
//           `prompt_snapshot` gives the other answer. Its text is not the main
//           file's, and it holds at least one of the bot's `text:` cuts, not
//           only the recipe's drop unit. So the check of f. can fail.
//   6. `obk health`: SECOND's line ends with `main text kit`, and health's JSON
//      has its `main_text` as `{ state: 'kit' }`.
//
// Printed as diagnostics, never failed on: the commit, the version the kit's
// `claude --version` gives and the version in each transcript, the model of
// each, the sizes of Claude Code's own main text, the kit's main text and the
// appended text, the units of the recipe that FIRST's text held and did not
// hold, FIRST's main text state in health, whether the kit's cut tools are in
// each transcript's tool list (by the kit's own tool names), and the notes left
// in `sources/`. The tool list is printed, not asserted: the tech notes do not
// say in which line and form a transcript records it.
//
// **Nobody answers anything by hand.** The test answers its own tabs' first-run
// screens, as memory-write.test.js does, and only through the allowlists:
// Claude Code's folder trust when it is the plain one or the one the kit's
// default rules bring up (helpers/claude-trust.js `claudeTrustAt`), and the
// captured Teach form with Esc (`onlyTeachFormOf`). Any other screen
// (`questionOn`) stops the run with the screen in the message. `Bot Father
// daily` may sit on its own trust screen: nothing waits on it, and nothing is
// typed into it.
//
// **The night gate.** helpers/system.js runs this test only in a run that names
// its file, between midnight and 6 am local time (#689). It reads the gate again
// before each `obk up`, which opens a session's tab (#687).
//
// The machine it runs on is someone's working machine, with their own tabs open.
// So this test, like the ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory,
//     `<tmp>/obk-system-main-text-live-*`; the probe's file and the kit's
//     `<bots>.claude-text` and `<bots>.prompts` are beside it, and go with it;
//   - writes down every terminal and project Orca already had, before it creates
//     anything;
//   - runs this checkout's `src/cli.js` by its full path, never the machine's
//     `obk`;
//   - types only into its own tabs: the probe's line, and the answers above;
//   - closes only its own tabs, through the tab guard, then deletes its own
//     projects, whatever happened;
//   - signals no process, and never writes to ~/.claude.json or to the profile's
//     .claude.json. The runner (scripts/test-system.js) backs up both before any
//     test, and takes the run's keys out after it.
//
// It writes nothing under the real ~/.claude/projects itself. Claude Code's own
// transcript folders for the throwaway bot stay there, as they do for every
// system test here.
//
// It takes a few minutes: two starts and two short turns.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry, shellWord } from '../helpers/cli.js';
import { claudeTrustAt, trustScreenMet } from '../helpers/claude-trust.js';
import { atNight, namedThisRun } from '../helpers/night-gate.js';
import { deleteOwnProject, placesOf, projectsInBots } from '../helpers/own-project.js';
import { onlyTeachFormOf, questionOn } from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { RC_OFF, withBotFatherOff } from '../helpers/remote-control-off.js';
import { autoModeState, sessionRecordFiles } from '../helpers/teach-record.js';
import { RELOAD_LINE } from '../../src/orca.js';
import { DEFAULT_TOOLS, cutsOf } from '../../src/cuts.js';
import { claudeTextFolder } from '../../src/launch.js';
import { buildMainText, claudeVersion, readRecipe, unitHash } from '../../src/main-text.js';

/** This file, as the runner names it in OBK_SYSTEM_NAMED. */
const THIS_FILE = fileURLToPath(import.meta.url);

/** The Orca CLI that works for a normal user (tech notes, section 1). */
const ORCA = process.env.OBK_ORCA || '/Applications/Orca.app/Contents/Resources/bin/orca';

/** How long the plain tab is given to run the probe's line. */
const PROBE_MS = 60000;

/** How long a session is given to be past its first-run screens and have the kit's hook write the book. */
const READY_MS = 180000;

/** How long a real agent is given to do its work. */
const ANSWER_MS = 240000;

/** How long the kit's hook is given to write its note once the book names the conversation. */
const NOTE_MS = 15000;

/** The title of Claude Code's "Teach auto mode" form (#416), as helpers/screens.js has it. */
const TEACH_TITLE = 'Teach auto mode about your environment?';

/** The bot, and its two sessions of one launch shape. */
const BOT = { name: 'main-text-live', display: 'Main Text Live' };
const FIRST = 'first';
const SECOND = 'second';

/** The model every session of this test runs on. */
const MODEL = 'claude-haiku-5-5';

/** The start of every throwaway bots folder of this test. */
const RUN_PREFIX = 'obk-system-main-text-live-';

const guard = tabGuard(ORCA);
const { orca } = guard;

const sha = (text) => createHash('sha256').update(text).digest('hex');

/** The short sum a kit file's name carries (src/main-text.js). */
const sum16 = (text) => sha(text).slice(0, 16);

/** Every terminal Orca knows about right now. */
function allTerminals() {
  const answer = orca(['terminal', 'list']);
  assert.equal(answer.ok, true, `orca terminal list failed: ${JSON.stringify(answer.error)}`);
  return answer.result.terminals;
}

/** The terminals in one Orca project, by the path it was opened at. */
const terminalsAt = (home) => allTerminals().filter((terminal) => terminal.worktreePath === home);

/** The tabs Orca lists at `home` once it has caught up with what was closed. */
async function terminalsAfterClosing(home, closed, within = 5000) {
  const stop = Date.now() + within;
  let left = terminalsAt(home);
  while (left.some((terminal) => closed.includes(terminal.handle)) && Date.now() < stop) {
    await setTimeout(250);
    left = terminalsAt(home);
  }
  return left;
}

/** Every Orca project Orca knows about right now. */
function allSetups() {
  const answer = orca(['project', 'setups']);
  assert.equal(answer.ok, true, `orca project setups failed: ${JSON.stringify(answer.error)}`);
  return answer.result.setups;
}

/** Run this checkout's `obk`, by its full path (#217, #220). */
function obk(args) {
  const done = spawnSync(process.execPath, [cliEntry, ...args], { encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(done.error, undefined, `could not run \`obk\`: ${done.error?.message}`);
  return done;
}

/** Run `obk ... --json` and read the answer it printed. A tab it says it opened is this test's own. */
function obkJson(args) {
  const done = obk([...args, '--json']);
  assert.equal(done.status, 0, `obk ${args.join(' ')} failed: ${done.stdout}${done.stderr}`);
  try {
    return guard.openedByKit(JSON.parse(done.stdout));
  } catch {
    return assert.fail(`obk ${args.join(' ')} --json did not print JSON: ${done.stdout}`);
  }
}

/** The entry for one tab in an `obk --json` answer. */
function tabOf(answer, name) {
  const found = (answer.tabs ?? []).filter((entry) => entry.name === name);
  assert.equal(found.length, 1, `one entry should be the ${name} tab, got: ${JSON.stringify(answer.tabs)}`);
  return found[0];
}

/**
 * The night gate again, right before a later kit command that can open a tab
 * (#687). When the night ended during the run, the test opens nothing more and
 * fails here, naming `step`. The teardown runs as before.
 */
function gateStillOpen(step) {
  const now = new Date();
  const named = namedThisRun(THIS_FILE);
  assert.ok(atNight(now) && named, [
    `The night gate closed during this run: it is ${now.toTimeString().slice(0, 5)} local time${named ? '' : ', and this run does not name this file'}.`,
    `So this test opened nothing more: ${step} did not run. This run is not a pass.`,
    'Run it again in a night run, between midnight and 6 am local time: npm run test:system -- --yes test/system/claude-main-text-live.test.js',
  ].join('\n'));
}

/**
 * Keep asking until `look` gives something other than undefined, or the time
 * runs out. `look` comes first: once the work is seen, a form that Claude Code
 * puts up after its turn has nothing to stop. `screen` is run after each look
 * that found nothing.
 */
async function until(what, within, look, note = () => '', screen = async () => {}) {
  const stop = Date.now() + within;
  for (;;) {
    const found = await look();
    if (found !== undefined) return found;
    await screen();
    assert.ok(Date.now() < stop, `gave up waiting for ${what} after ${within}ms.${note()}`);
    await setTimeout(1000);
  }
}

/** The rows the tab is rendering right now, or undefined when Orca rendered none. */
function rowsOf(handle) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  const tail = answer.ok === true && answer.result?.terminal?.source === 'screen' ? answer.result.terminal.tail : undefined;
  return Array.isArray(tail) ? tail.map(String) : undefined;
}

/**
 * What Orca says the tab waits on, for the message of a wait that ran out. The
 * screen itself is not put in the message: it can show Claude Code's text.
 */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  return `${blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`} Its screen is not shown here; the tab closes with the run.`;
}

/** The folder whose trust this test answered, and the tab whose Teach form it answered. */
const answered = { trust: new Set(), teach: new Set() };

/**
 * One look at a tab's screen. The folder trust of `home` is answered once, the
 * captured Teach form at most once with Esc, and any other question stops the
 * run with the screen in the message.
 */
async function lookAtScreen(t, { title, handle, home, bots }) {
  const rows = rowsOf(handle);
  if (rows === undefined) return;

  if (rows.some((row) => row.includes('Yes, I trust this folder'))) {
    assert.ok(!answered.trust.has(home), `${title} asked Claude Code's folder trust for ${home} again, which this test answered once and answers no more:\n    ${rows.join('\n    ')}`);
    const wrong = claudeTrustAt(rows, home, bots, cliEntry);
    assert.equal(wrong, undefined, `${title}'s folder trust is not one this test may answer, so it answered nothing: ${wrong}.\n  what it showed:\n    ${rows.join('\n    ')}`);
    const sent = orca(['terminal', 'send', '--terminal', handle, '--text', '\x1b[B\r']);
    assert.equal(sent.ok, true, `answering ${title}'s folder trust failed: ${JSON.stringify(sent.error)}`);
    answered.trust.add(home);
    await until(`${title}'s folder trust to go after it was answered`, 15000, async () => ((rowsOf(handle) ?? []).some((row) => row.includes('Yes, I trust this folder')) ? undefined : true), () => whatIsUp(handle));
    t.diagnostic(`answered ${title}'s ${trustScreenMet(rows)}`);
    return;
  }

  if (rows.some((row) => row.trim() === TEACH_TITLE)) {
    assert.ok(!answered.teach.has(handle), `the Teach form came up again in ${title}, and this test answers it at most once:\n    ${rows.join('\n    ')}`);
    const wrong = onlyTeachFormOf(rows);
    assert.equal(wrong, undefined, `${title}'s Teach form is not the captured one, so this test answered nothing: ${wrong}.\n  what it showed:\n    ${rows.join('\n    ')}`);
    const found = sessionRecordFiles(home);
    assert.ok(found.files !== undefined, `this test cannot tell which record ${title}'s session writes, so it answered nothing: ${found.why}`);
    const { files } = found;
    const was = autoModeState(files);
    const sent = orca(['terminal', 'send', '--terminal', handle, '--text', '\x1b']);
    assert.equal(sent.ok, true, `answering ${title}'s Teach form with Esc failed: ${JSON.stringify(sent.error)}`);
    answered.teach.add(handle);
    await until(`${title}'s Teach form to go after Esc`, 15000, async () => ((rowsOf(handle) ?? []).some((row) => row.trim() === TEACH_TITLE) ? undefined : true), () => whatIsUp(handle));
    await setTimeout(2000);
    const now = autoModeState(files);
    assert.equal(now, was, `Esc on ${title}'s Teach form taught nothing: autoModeEnvSetup should be as it was in each record the session may write (before: ${was}; after: ${now})`);
    t.diagnostic(`answered ${title}'s Teach form with Esc; it went, and autoModeEnvSetup stayed as it was: ${was}`);
    return;
  }

  const question = questionOn(rows);
  assert.equal(question, undefined, `${title} shows a screen this test does not know, and it answers nothing; the run stops here:\n    ${rows.join('\n    ')}`);
}

/** The slug as Claude Code makes it: the folder in NFC, each character that is not an ASCII letter or digit changed to `-`. */
const slugOf = (root) => root.normalize('NFC').replaceAll(/[^A-Za-z0-9]/g, '-');

/** A premise that does not hold: this run would prove nothing, and it says so as a failure. */
function premise(holds, why) {
  assert.ok(holds, `${why} So the kit could never read a record of this run's sessions, this run would prove nothing about the kit's main text, and it starts no session.`);
}

/**
 * The folder where a tab's Claude Code writes its transcripts, read in a plain
 * tab of this test's own in the project at `place`: `$CLAUDE_CONFIG_DIR/projects`
 * when the tab has one, and ~/.claude/projects when not. It must be the folder
 * the kit reads, ~/.claude/projects, or the run stops. Gives back its real path.
 */
async function transcriptsOfATab(t, { bots, place }) {
  const file = `${bots}.probe-config-dir`;
  const answer = orca(['terminal', 'create', '--worktree', `path:${place}`, '--title', `${BOT.display} probe`]);
  assert.equal(answer.ok, true, `opening the probe's tab failed: ${JSON.stringify(answer.error)}`);
  const { handle } = answer.result.terminal;

  let sentAt = 0;
  await until(
    'the probe\'s tab to write down its CLAUDE_CONFIG_DIR',
    PROBE_MS,
    async () => (existsSync(file) ? true : undefined),
    () => whatIsUp(handle),
    async () => {
      // A shell still starting may not take a first line, and sending it again in this tab of our own costs nothing.
      if (Date.now() - sentAt < 15000) return;
      sentAt = Date.now();
      orca(['terminal', 'send', '--terminal', handle, '--text', `printenv CLAUDE_CONFIG_DIR > ${shellWord(file)}`, '--enter']);
    },
  );
  await setTimeout(500);
  const configDir = readFileSync(file, 'utf8').trim();
  t.diagnostic(`a tab here starts with CLAUDE_CONFIG_DIR=${configDir === '' ? '(unset)' : configDir}`);

  const kitReads = path.join(os.homedir(), '.claude', 'projects');
  const tabWrites = configDir === '' ? kitReads : path.join(configDir, 'projects');
  premise(existsSync(kitReads), `The folder the kit reads transcripts in, ${kitReads}, is not there.`);
  premise(existsSync(tabWrites), `The folder a tab's Claude Code writes transcripts in, ${tabWrites}, is not there.`);
  premise(
    realpathSync(tabWrites) === realpathSync(kitReads),
    `A tab's Claude Code writes its transcripts in ${tabWrites} (${realpathSync(tabWrites)}), and the kit reads them in ${kitReads} (${realpathSync(kitReads)}).`,
  );
  return realpathSync(tabWrites);
}

/** Remove the throwaway bots folder and every `<bots>.*` beside it (PRD 6.3): the kit's own, and the probe's file. */
async function removeBotsFolderAndSiblings(bots) {
  const parent = path.dirname(bots);
  const mine = path.basename(bots);
  const ours = async () => (await readdir(parent)).filter((name) => name === mine || name.startsWith(`${mine}.`));
  for (const name of await ours()) await rm(path.join(parent, name), { recursive: true, force: true });
  assert.deepEqual(await ours(), [], `this test left folders behind in ${parent}`);
}

/** One conversation's transcript, whole lines only, a JSON object each. */
function linesOf(projects, home, id) {
  if (typeof id !== 'string') return [];
  const file = path.join(projects, slugOf(home), `${id}.jsonl`);
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8');
  const lines = [];
  for (const raw of text.slice(0, text.lastIndexOf('\n') + 1).split('\n')) {
    if (raw.trim() === '') continue;
    try {
      lines.push(JSON.parse(raw));
    } catch {
      // Not a line Claude Code finished writing as JSON; nothing here reads it.
    }
  }
  return lines;
}

const itemsOf = (line, type) => (Array.isArray(line.message?.content) ? line.message.content.filter((item) => item?.type === type) : []);
const saidBySession = (lines) => lines.filter((line) => line.type === 'assistant').flatMap((line) => itemsOf(line, 'text')).map((item) => String(item.text ?? '')).join('\n');

/**
 * The last lines of a transcript, for the message of a wait that ran out: the
 * time, the type and the size of each, and no word of what it holds.
 */
function tailOf(lines, count = 15) {
  if (lines.length === 0) return '    (nothing)';
  return lines.slice(-count).map((line) => `    ${line.timestamp ?? '-'}  ${line.type}${line.type === 'attachment' ? ` ${line.attachment?.type ?? '-'}` : ''}  ${JSON.stringify(line).length} characters`).join('\n');
}

/** The first `prompt_snapshot` of a transcript: its sections and its version, or undefined. */
function firstSnapshot(lines) {
  const line = lines.find((one) => one.type === 'attachment' && one.attachment?.type === 'prompt_snapshot');
  const sections = line?.attachment?.systemPrompt;
  if (!Array.isArray(sections) || !sections.every((one) => typeof one === 'string')) return undefined;
  return { sections, version: typeof line.version === 'string' ? line.version : undefined };
}

/** The model a transcript names first, in a `model` attachment, or undefined. */
const modelOf = (lines) => lines.find((one) => one.type === 'attachment' && one.attachment?.type === 'model')?.attachment?.identity?.modelId;

/** The version each line of a transcript records, once each. */
const versionsOf = (lines) => [...new Set(lines.map((line) => line.version).filter((one) => typeof one === 'string'))];

/** The names of the tools a transcript lists, from any attachment that holds a `tools` list of named items, or undefined. */
function toolNamesOf(lines) {
  for (const line of lines) {
    const tools = line.type === 'attachment' ? line.attachment?.tools : undefined;
    if (Array.isArray(tools) && tools.some((one) => typeof one?.name === 'string')) return tools.map((one) => one?.name).filter((one) => typeof one === 'string');
  }
  return undefined;
}

/**
 * The names of the units in `units` that `sections` hold, as a whole section
 * or as one line of a section, by the sha256 of their text (src/main-text.js).
 */
function unitsIn(sections, units) {
  const held = new Set(sections.flatMap((section) => [unitHash(section), ...section.split('\n').map(unitHash)]));
  return units.filter((unit) => held.has(unit.hash)).map((unit) => unit.name);
}

/**
 * The check of step 5f, on one first record: whether the sections before the
 * appended one, joined with a blank line, are the main file's text, and which
 * of `units` they hold. Gives back sums and names only.
 */
function againstMain(sections, mainText, units) {
  const body = sections.slice(0, -1).join('\n\n');
  return { same: sha(body) === sha(mainText), size: body.length, held: unitsIn(sections.slice(0, -1), units) };
}

/** The commit of the checkout this test runs from, or why it could not be read. */
function commitRun() {
  const done = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: path.dirname(path.dirname(cliEntry)) });
  if (done.error !== undefined) return `(git did not run: ${done.error.message})`;
  return done.status === 0 ? done.stdout.trim() : `(git rev-parse HEAD failed: ${done.stderr.trim()})`;
}

/** The names in a folder, sorted, or none when it is not there. */
const namesIn = (dir) => (existsSync(dir) ? readdirSync(dir).sort() : []);

/** A JSON file, or undefined when it is not there or not JSON. */
function jsonOf(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

test('a later session of a launch runs on the main text that the kit built from the first start\'s own recorded text, with the cut units out', async (t) => {
  t.diagnostic(`the commit this run ran: ${commitRun()}`);
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), RUN_PREFIX)));
  const home = path.join(bots, 'bots', BOT.name);
  const homes = [path.join(bots, 'bots', 'bot-father'), home];
  const text = claudeTextFolder(bots, BOT.name);
  const sources = path.join(text, 'sources');
  const originals = path.join(text, 'originals');
  const entryInBook = (name) => {
    const file = path.join(home, 'sessions.yaml');
    return existsSync(file) ? parse(readFileSync(file, 'utf8'))?.sessions?.[name] ?? {} : {};
  };

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    const { closed, foreign } = guard.closeOwnAt(placesOf(homes, allSetups(), bots));
    const held = new Set(foreign.map((one) => one.home));
    let deleted = 0;
    const failedDeletes = [];
    for (const setup of projectsInBots(allSetups(), bots)) {
      if (before.setups.has(setup.id) || held.has(setup.path)) continue;
      try {
        await deleteOwnProject(setup, bots);
        deleted += 1;
      } catch (error) {
        failedDeletes.push(`${setup.path}: ${error.message}`);
      }
    }
    // Orca's sidebar keeps a deleted project's row until its window is rebuilt
    // (#343). This test does not reload the owner's window: it says so.
    if (deleted > 0) t.diagnostic(RELOAD_LINE);
    assert.deepEqual(foreign, [], `tabs this test did not create are open at its homes, so it closed only its own and left those projects and ${bots} in place`);
    // The kit's <bots>.claude-text and <bots>.prompts are beside the bots folder, and go with it.
    await removeBotsFolderAndSiblings(bots);

    const { closedNotOurs, goneElsewhere } = guard.verdict(before.handles);
    assert.deepEqual(closedNotOurs, [], 'this test closed tabs it did not create');
    if (goneElsewhere.length > 0) t.diagnostic(`tabs open before this test and closed elsewhere meanwhile: ${goneElsewhere.join(', ')}`);
    for (const each of homes) {
      assert.deepEqual(await terminalsAfterClosing(each, closed), [], `this test left tabs behind in ${each}`);
    }
    assert.deepEqual(failedDeletes, [], 'projects this test could not remove, left in Orca');
  });

  // ----------------------------------------------------- 1. the throwaway fleet

  const initialised = obkJson(withBotFatherOff(['init', '--bots', bots, '--harness', 'claude']));
  const fatherTab = (initialised.tabs ?? []).find((entry) => entry.created === true);
  assert.ok(fatherTab !== undefined, `the premise: init opened Bot Father's tab, got: ${JSON.stringify(initialised.tabs)}`);
  const place = allTerminals().find((terminal) => terminal.handle === fatherTab.terminal)?.worktreePath;
  assert.equal(typeof place, 'string', `the premise: Orca lists Bot Father's tab ${fatherTab.terminal}`);

  // ------------------------------------------------------------- 2. the premise

  const projects = await transcriptsOfATab(t, { bots, place });

  // --------------------------------------------------- 3. the bot, and its two sessions

  const token = randomBytes(5).toString('hex');
  const WORD = { [FIRST]: `harbour${token}`, [SECOND]: `beacon${token}` };
  const promptOf = (name) => `You are a system test's throwaway session and you own nothing. Run no command, use no tool and change no file. Answer with the one word ${WORD[name]}, and stop.`;

  obkJson(['bot', 'create', '--bots', bots, '--name', BOT.name, '--harness', 'claude', '--charter', `${BOT.display} exists for one system test run and owns nothing.`]);
  for (const name of [FIRST, SECOND]) {
    obkJson(['session', 'add', '--bots', bots, '--bot', BOT.name, '--name', name, '--model', MODEL, '--effort', 'low', `--prompt=${promptOf(name)}`, ...RC_OFF]);
    obkJson(['permission', 'approval', '--bots', bots, '--bot', BOT.name, '--session', name, '--approval', 'auto']);
  }
  assert.deepEqual([namesIn(sources), namesIn(originals)], [[], []], `the premise: ${text} holds no note and no saved original before the first start`);

  const recipe = readRecipe();
  assert.ok(recipe !== undefined, 'the premise: the kit\'s recipe can be read');
  const cut = cutsOf(bots, home).text;
  // The units the kit takes out of its main text: the recipe's drop units, and the units its text cuts name.
  const taken = [
    ...recipe.drop.map((one, at) => ({ name: `drop ${at + 1}`, hash: one.hash })),
    ...recipe.units.filter((unit) => cut.includes(unit.name)),
  ];
  t.diagnostic(`the bot's text cuts: ${cut.join(', ') || '(none)'}`);
  const installed = claudeVersion();
  t.diagnostic(`the Claude Code version the kit reads: ${installed.version ?? installed.why}`);

  /** Bring up the session `name` with `obk up`. Gives back its tab, a look at its screen, and its transcript. */
  function upOf(name) {
    gateStillOpen(`obk up of the throwaway session ${name}`);
    const entry = tabOf(obkJson(['up', '--bots', bots, '--bot', BOT.name, '--session', name]), name);
    assert.equal(entry.created, true, `up opened ${name}'s tab`);
    assert.equal(entry.harnessStarted, true, `no claude came up in ${entry.title}: \`orca terminal read --terminal ${entry.terminal} --screen\``);
    const tab = { title: entry.title, handle: entry.terminal, home, bots };
    return { tab, screen: () => lookAtScreen(t, tab), lines: () => linesOf(projects, home, entryInBook(name).session) };
  }

  /** Wait until the kit's hook has named the session's conversation in the book. Gives back the entry. */
  const hooked = (name, up) => until(
    `the kit's hook to name ${name}'s conversation in ${path.join(home, 'sessions.yaml')}`,
    READY_MS,
    async () => (typeof entryInBook(name).session === 'string' ? entryInBook(name) : undefined),
    () => whatIsUp(up.tab.handle),
    up.screen,
  );

  /** Wait for the session's answer with its word. */
  const answers = (name, up) => until(
    `${name} to answer with its word ${WORD[name]}`,
    ANSWER_MS,
    async () => (saidBySession(up.lines()).includes(WORD[name]) ? true : undefined),
    () => `\n  the conversation:\n${tailOf(up.lines())}${whatIsUp(up.tab.handle)}`,
    up.screen,
  );

  /** Wait for the first `prompt_snapshot` of the session's transcript. */
  const recorded = (name, up) => until(
    `a first prompt_snapshot in ${name}'s transcript`,
    30000,
    async () => firstSnapshot(up.lines()),
    () => `\n  the conversation:\n${tailOf(up.lines())}`,
    up.screen,
  );

  // --------------------------------------------------------------- 4. FIRST

  const first = upOf(FIRST);
  const firstEntry = await hooked(FIRST, first);
  const firstId = firstEntry.session;

  // a. On Claude Code's own main text, with a shape.
  assert.equal(firstEntry.own_text, true, `the book has ${FIRST} on Claude Code's own main text, got: ${JSON.stringify(firstEntry)}`);
  assert.equal(firstEntry.main, undefined, `the book names no main file for ${FIRST}, got: ${JSON.stringify(firstEntry)}`);
  assert.equal(typeof firstEntry.shape, 'string', `the book gives ${FIRST} a launch shape, got: ${JSON.stringify(firstEntry)}`);

  // b. Its start, noted as a source.
  const noteFile = path.join(sources, `${firstId}.json`);
  const note = await until(
    `the kit's note of ${FIRST}'s start at ${noteFile}`,
    NOTE_MS,
    async () => jsonOf(noteFile),
    () => `\n  ${sources} holds: ${namesIn(sources).join(', ') || '(nothing)'}`,
    first.screen,
  );
  assert.equal(note.conversation, firstId, `the note names ${FIRST}'s conversation, got: ${JSON.stringify(note)}`);
  assert.equal(note.shape, firstEntry.shape, `the note names ${FIRST}'s launch shape, got: ${JSON.stringify(note)}`);
  const appendedSum = /^system-([0-9a-f]{16})\.md$/.exec(String(note.appended))?.[1];
  assert.equal(typeof appendedSum, 'string', `the note names the kit's appended file, system-<sum>.md, got: ${JSON.stringify(note)}`);
  assert.ok(typeof note.model === 'string' && note.model !== '', `the note names the model the conversation must run on, got: ${JSON.stringify(note)}`);
  t.diagnostic(`${FIRST}'s note: model ${note.model}, appended file ${note.appended}`);

  // c. It answers.
  await answers(FIRST, first);

  // d. Its first record, as the build needs it.
  const firstRecord = await recorded(FIRST, first);
  const firstLines = first.lines();
  const firstModel = modelOf(firstLines);
  t.diagnostic(`${FIRST}'s transcript: model ${firstModel ?? '(none named)'}, versions ${versionsOf(firstLines).join(', ') || '(none recorded)'}, first record of ${firstRecord.version ?? '(no version)'}, ${firstRecord.sections.length} sections`);
  assert.equal(firstModel, note.model, `${FIRST}'s transcript names the model the note expects, so the build takes the record`);
  assert.equal(firstRecord.version, installed.version, `${FIRST}'s first record is of the Claude Code version the kit reads (${installed.version ?? installed.why}), so the build takes it. A tab whose shell finds another Claude Code records another version (README)`);
  assert.equal(sum16(firstRecord.sections.at(-1) ?? ''), appendedSum, `the last section of ${FIRST}'s first record is the kit's appended text, by the sum in ${note.appended}`);

  // --------------------------------------------------------------- 5. SECOND

  const second = upOf(SECOND);

  // a. The same launch shape as FIRST.
  assert.equal(entryInBook(SECOND).shape, firstEntry.shape, `obk up gives ${SECOND} the same launch shape as ${FIRST}`);

  // b. The original the build saved: FIRST's first record, without the appended section.
  const originalName = `${installed.version}-${firstEntry.shape}.json`;
  assert.deepEqual(namesIn(originals), [originalName], `the build saved one original, ${originalName}, in ${originals}`);
  const original = jsonOf(path.join(originals, originalName));
  assert.ok(Array.isArray(original?.sections), `${originalName} holds a list of sections`);
  assert.deepEqual(
    { conversation: original.conversation, model: original.model, shape: original.shape, version: original.version },
    { conversation: firstId, model: note.model, shape: firstEntry.shape, version: installed.version },
    `the original names ${FIRST}'s conversation, its model, the shape and the version`,
  );
  const ownBody = firstRecord.sections.slice(0, -1);
  assert.equal(original.sections.length, ownBody.length, `the original holds ${FIRST}'s first record but its appended section, by count`);
  assert.equal(sha(JSON.stringify(original.sections)), sha(JSON.stringify(ownBody)), `the original's sections are ${FIRST}'s first record without its appended section, by sha256`);
  t.diagnostic(`notes left in ${sources} after the build: ${namesIn(sources).join(', ') || '(none)'}`);

  // c. The main file: built from that original by the kit's own recipe and the bot's cuts.
  const built = buildMainText(original.sections, { recipe, cut });
  const mainName = `main-${sum16(built.text)}.md`;
  const mainFile = path.join(text, mainName);
  assert.ok(existsSync(mainFile), `the build wrote ${mainName} in ${text}, which holds: ${namesIn(text).join(', ')}`);
  const mainText = readFileSync(mainFile, 'utf8');
  assert.equal(sha(mainText), sha(built.text), `${mainName} holds what buildMainText gives for the original and the bot's text cuts, by sha256`);
  t.diagnostic(`the build cut: ${built.found.join(', ') || '(none)'}; the recipe's cut units it did not find: ${built.missing.join(', ') || '(none)'}`);

  // d. SECOND on that main file, as the hook read its real launch line.
  const secondEntry = await hooked(SECOND, second);
  assert.equal(path.basename(String(secondEntry.main)), mainName, `the book has ${SECOND} on ${mainName}, as its launch line named it, got: ${JSON.stringify(secondEntry)}`);
  assert.notEqual(secondEntry.own_text, true, `the book does not have ${SECOND} on Claude Code's own text, got: ${JSON.stringify(secondEntry)}`);

  // e. It answers.
  await answers(SECOND, second);

  // f. Its first record holds the kit's text, and none of the units the kit cuts.
  const secondRecord = await recorded(SECOND, second);
  const secondLines = second.lines();
  t.diagnostic(`${SECOND}'s transcript: model ${modelOf(secondLines) ?? '(none named)'}, versions ${versionsOf(secondLines).join(', ') || '(none recorded)'}, first record of ${secondRecord.version ?? '(no version)'}, ${secondRecord.sections.length} sections`);
  const ownHeld = unitsIn(ownBody, taken);
  const kit = againstMain(secondRecord.sections, mainText, taken.filter((unit) => ownHeld.includes(unit.name)));
  t.diagnostic(`sizes in characters: Claude Code's own main text ${ownBody.join('\n\n').length}, the kit's main text ${mainText.length}, ${SECOND}'s recorded main text ${kit.size}, the appended text ${(secondRecord.sections.at(-1) ?? '').length}`);
  assert.equal(sum16(secondRecord.sections.at(-1) ?? ''), appendedSum, `the last section of ${SECOND}'s first record is the kit's appended text, by the sum in ${note.appended}`);
  assert.ok(kit.same, `${SECOND}'s first record, but its appended section, joined with a blank line, is ${mainName}'s text, by sha256: ${kit.size} characters recorded, ${mainText.length} in the file`);
  assert.deepEqual(kit.held, [], `${SECOND}'s first record holds none of the units that ${FIRST}'s own text held and the kit cuts`);

  // g. The control: the same check on FIRST's first record gives the other answer.
  const control = againstMain(firstRecord.sections, mainText, taken);
  t.diagnostic(`the units the kit takes out that ${FIRST}'s own text held: ${control.held.join(', ') || '(none)'}; that it did not hold: ${taken.map((unit) => unit.name).filter((name) => !control.held.includes(name)).join(', ') || '(none)'}`);
  assert.equal(control.same, false, `the control: ${FIRST}'s own first record is not ${mainName}'s text, so the check of ${SECOND}'s record can fail`);
  assert.ok(control.held.some((name) => cut.includes(name)), `the control: ${FIRST}'s own first record holds at least one of the bot's text cuts (${cut.join(', ')}), so the check that ${SECOND}'s holds none can fail`);

  for (const [name, lines] of [[FIRST, firstLines], [SECOND, secondLines]]) {
    const tools = toolNamesOf(lines);
    t.diagnostic(tools === undefined
      ? `${name}'s transcript: no tool list found in an attachment`
      : `${name}'s transcript lists ${tools.length} tools; of the kit's cut tools, in it: ${DEFAULT_TOOLS.filter((one) => tools.includes(one)).join(', ') || '(none)'}; not in it: ${DEFAULT_TOOLS.filter((one) => !tools.includes(one)).join(', ') || '(none)'}`);
  }

  // ----------------------------------------------------------------- 6. health

  const health = obk(['health', '--bots', bots]);
  const line = health.stdout.split('\n').find((one) => one.includes(` ${BOT.name} ${SECOND} `));
  assert.equal(typeof line, 'string', `obk health prints a line for ${BOT.name} ${SECOND}, got:\n${health.stdout}${health.stderr}`);
  assert.ok(line.endsWith('main text kit'), `${SECOND}'s line in obk health ends with "main text kit", got: ${line}`);
  const asJson = obk(['health', '--bots', bots, '--json']);
  let answer;
  try {
    answer = JSON.parse(asJson.stdout);
  } catch {
    assert.fail(`obk health --json did not print JSON: ${asJson.stdout}${asJson.stderr}`);
  }
  const of = (name) => (answer.sessions ?? []).find((one) => one.bot === BOT.name && one.session === name);
  assert.deepEqual(of(SECOND)?.main_text, { state: 'kit' }, `health's JSON has ${SECOND}'s main_text as kit, got: ${JSON.stringify(of(SECOND))}`);
  t.diagnostic(`${FIRST}'s main_text in health: ${JSON.stringify(of(FIRST)?.main_text)}`);
});
