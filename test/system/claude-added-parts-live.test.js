// A system test, and the live probe for #784: it gives the kit's recipe the
// sums of the parts that Claude Code adds by itself after a replaced main
// text. Against the real Orca and real Claude Code on this machine. Run it
// alone with
// `npm run test:system -- --yes test/system/claude-added-parts-live.test.js`,
// between midnight and 6 am local time, and only on the architect's go word;
// `npm test` cannot, and no CI machine could. Run it again for each new
// Claude Code version: which parts come back depends on the version, the
// model and the tools of the session.
//
// A session on the kit's main text starts with `--system-prompt-file`, which
// replaces Claude Code's main text. After a replaced text, Claude Code adds
// some parts again by itself: the paragraph of a tool that the session has,
// and more. The kit builds its main file from a record of Claude Code's own
// text, which holds those parts too, so a session on the kit's file gets them
// two times (#784; the live run of #769, test/system/claude-main-text-live.test.js,
// failed at its step 5f for this reason). The recipe can take such a part out
// of the build only when it knows the part's sum. This probe gives the sums.
//
// A fenced probe, against a stand-in for the API, cannot give them: the
// stand-in session has no first-party API and no Chrome extension, so the
// WebSearch part and the Chrome part do not come up (seen 2026-11-16).
//
// **It is a probe.** It asserts nothing about WHICH parts come back. It FAILS,
// with the model in the message, only when a step it needs does not happen: a
// session does not start or does not answer, or the kit leaves no note, no
// saved original, no main file, or a session leaves no record.
//
// **No text of Claude Code is in this file, in what it prints, or in a failure
// message.** It prints only sums, sizes, indexes, true or false, and the
// recipe's own names. A screen that a first-run allowlist refuses is still in
// that failure's message, as in the tests beside it.
//
// The steps:
//
//   1. A throwaway fleet, by this checkout's CLI. `obk init` brings up Bot
//      Father, which gives the run a project in Orca.
//   2. THE PREMISE. A plain tab of the test's own in that project writes down
//      its CLAUDE_CONFIG_DIR. The kit reads a bot's transcripts in
//      ~/.claude/projects. When the tab's Claude Code writes its transcripts to
//      another folder, the test FAILS here and starts no session.
//   3. Three Claude bots, one for each model that the recipe names
//      (src/claude-text-recipe.json, `units[].models`), and a fourth on
//      claude-haiku-5-5 that keeps the Artifact tool (`claude_keep:
//      [Artifact]` in its bot.yaml), named `ap-haiku-5-5-artifact`, with
//      `claude-haiku-5-5+keep:Artifact` in place of the model in what it
//      prints. Each has two sessions,
//      FIRST and SECOND, of one launch shape: effort `low`, approval `auto`,
//      Remote Control off. Each start prompt asks for one random word and
//      nothing else.
//   4. For each bot, one after the other, so that a failure names its model:
//        a. FIRST, brought up with `obk up`: the first start of its shape, on
//           Claude Code's own main text. The kit's note of its start, its
//           answer, and the first `prompt_snapshot` of its transcript;
//        b. SECOND, brought up with `obk up`: the kit's saved original, the
//           main file that the book names for SECOND, its answer, and the
//           first `prompt_snapshot` of its transcript.
//   5. Printed for each model, as diagnostics:
//        - each section of FIRST's own main text (its first record but the
//          kit's appended section): `own <model> <index> <size> <sha256>
//          <recipe names>`, where the names are those of a drop or unit hash
//          that matches the whole section or one of its lines;
//        - which section of SECOND's first record is the main file, by sha256;
//          and whether its last section is the kit's appended text, by the sum
//          in the appended file's name;
//        - each section of SECOND's first record between the main file and the
//          appended section: `added <model> <index> <size> <sha256>
//          in_main=<true|false> own_index=<index or none> <recipe names>`.
//          `in_main` says whether the main file's text holds the section's
//          text, and `own_index` which section of FIRST's own text has the
//          same sha256. With no section equal to the main file, every section
//          but the last is printed so;
//        - the Claude Code version and the model of each record, and the
//          version the kit reads;
//        - for the Artifact bot, each section of its own text that the plain
//          claude-haiku-5-5 bot's own text lacks, by sha256; or a line that
//          says its own text lacks the Artifact paragraph, when the account
//          or Claude Code gives it no Artifact tool. That is no failure;
//        - one line for a machine to read:
//          `added-parts <model> <version> <JSON list>`, each item
//          `{ sha256, size, own_index, in_main, recipe }`.
//
// **The bots' own settings.** A bot of a real fleet may carry tools from its
// own `.claude/settings.json`. The fleet's bots, read on 2026-11-16, hold only
// the keys that the kit writes there (hooks, permissions, skillOverrides,
// autoMemoryDirectory), and no `enabledPlugins` or `mcpServers`. The tools
// that MCP servers, plugins and the Chrome extension give come from the user's
// own settings and account, which a throwaway bot of this machine shares. So
// the probe's bots add nothing to their settings.
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
//     `<tmp>/obk-system-added-parts-live-*`; the probe's file and the kit's
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
// transcript folders for the throwaway bots stay there, as they do for every
// system test here.
//
// It takes several minutes: eight starts and eight short turns.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse, stringify } from 'yaml';

import { cliEntry, shellWord } from '../helpers/cli.js';
import { claudeTrustAt, trustScreenMet } from '../helpers/claude-trust.js';
import { atNight, namedThisRun } from '../helpers/night-gate.js';
import { deleteOwnProject, placesOf, projectsInBots } from '../helpers/own-project.js';
import { onlyTeachFormOf, questionOn } from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { RC_OFF, withBotFatherOff } from '../helpers/remote-control-off.js';
import { autoModeState, sessionRecordFiles } from '../helpers/teach-record.js';
import { RELOAD_LINE } from '../../src/orca.js';
import { claudeTextFolder } from '../../src/launch.js';
import { claudeVersion, readRecipe, unitHash } from '../../src/main-text.js';

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

/** Each bot's two sessions of one launch shape. */
const FIRST = 'first';
const SECOND = 'second';

/** The model of the bot that keeps the Artifact tool. */
const ARTIFACT_MODEL = 'claude-haiku-5-5';

/** The start of every throwaway bots folder of this test. */
const RUN_PREFIX = 'obk-system-added-parts-live-';

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
    'Run it again in a night run, between midnight and 6 am local time: npm run test:system -- --yes test/system/claude-added-parts-live.test.js',
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
  assert.ok(holds, `${why} So the kit could never read a record of this run's sessions, this run would give the recipe nothing, and it starts no session.`);
}

/**
 * The folder where a tab's Claude Code writes its transcripts, read in a plain
 * tab of this test's own in the project at `place`: `$CLAUDE_CONFIG_DIR/projects`
 * when the tab has one, and ~/.claude/projects when not. It must be the folder
 * the kit reads, ~/.claude/projects, or the run stops. Gives back its real path.
 */
async function transcriptsOfATab(t, { bots, place }) {
  const file = `${bots}.probe-config-dir`;
  const answer = orca(['terminal', 'create', '--worktree', `path:${place}`, '--title', 'Added Parts probe']);
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

/** The recipe's names for a section: those of each drop or unit hash that matches the whole section or one of its lines. */
function recipeNamesOf(section, recipe) {
  const held = new Set([unitHash(section), ...section.split('\n').map(unitHash)]);
  return [
    ...recipe.drop.map((one, at) => ({ name: `drop-${at + 1}`, hash: one.hash })),
    ...recipe.units,
  ].filter((unit) => held.has(unit.hash)).map((unit) => unit.name);
}

/** The recipe's names for a printed line: the names, or `-` for none. */
const namesText = (names) => (names.length === 0 ? '-' : names.join(','));

test('for each model the recipe names, the parts that Claude Code adds by itself after the kit\'s main file, by their sums', async (t) => {
  t.diagnostic(`the commit this run ran: ${commitRun()}`);
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const recipe = readRecipe();
  assert.ok(recipe !== undefined, 'the premise: the kit\'s recipe can be read');
  const models = [...new Set(recipe.units.flatMap((unit) => unit.models))];
  assert.ok(models.length > 0, 'the premise: the recipe names at least one model');
  t.diagnostic(`the models the recipe names: ${models.join(', ')}`);
  const botOf = (model) => ({ model, name: `ap-${model.replace(/^claude-/, '')}`, label: model });
  // One more bot keeps the Artifact tool, so a run shows whether its paragraph comes back (the architect, #784).
  const artifact = { model: ARTIFACT_MODEL, name: `ap-${ARTIFACT_MODEL.replace(/^claude-/, '')}-artifact`, label: `${ARTIFACT_MODEL}+keep:Artifact`, keep: ['Artifact'] };
  const fleet = [...models.map(botOf), artifact];

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), RUN_PREFIX)));
  const homeOf = (bot) => path.join(bots, 'bots', bot.name);
  const homes = [path.join(bots, 'bots', 'bot-father'), ...fleet.map(homeOf)];
  const entryInBook = (bot, name) => {
    const file = path.join(homeOf(bot), 'sessions.yaml');
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
  const installed = claudeVersion();
  t.diagnostic(`the Claude Code version the kit reads: ${installed.version ?? installed.why}`);

  // ----------------------------------------------------------------- 3. the bots

  const token = randomBytes(5).toString('hex');
  const wordOf = (bot, name) => `${name === FIRST ? 'harbour' : 'beacon'}${bot.name.replaceAll('-', '')}${token}`;
  const promptOf = (bot, name) => `You are a system test's throwaway session and you own nothing. Run no command, use no tool and change no file. Answer with the one word ${wordOf(bot, name)}, and stop.`;
  for (const bot of fleet) {
    obkJson(['bot', 'create', '--bots', bots, '--name', bot.name, '--harness', 'claude', '--charter', `${bot.name} exists for one system test run and owns nothing.`]);
    for (const name of [FIRST, SECOND]) {
      obkJson(['session', 'add', '--bots', bots, '--bot', bot.name, '--name', name, '--model', bot.model, '--effort', 'low', `--prompt=${promptOf(bot, name)}`, ...RC_OFF]);
      obkJson(['permission', 'approval', '--bots', bots, '--bot', bot.name, '--session', name, '--approval', 'auto']);
    }
    if (bot.keep !== undefined) {
      // The bot's keep list, as a user writes it in bot.yaml, before its first up.
      const file = path.join(homeOf(bot), 'bot.yaml');
      writeFileSync(file, stringify({ ...(parse(readFileSync(file, 'utf8')) ?? {}), claude_keep: bot.keep }));
    }
  }
  /** The sums of each bot's own text, by bot name, for the Artifact bot's line below. */
  const ownOf = {};

  // ------------------------------------------------------ 4. each bot in turn

  for (const bot of fleet) {
    const home = homeOf(bot);
    const text = claudeTextFolder(bots, bot.name);
    const sources = path.join(text, 'sources');
    const originals = path.join(text, 'originals');
    const of = `${bot.model} (bot ${bot.name})`;

    /** Bring up the session `name` with `obk up`. Gives back its tab, a look at its screen, and its transcript. */
    const upOf = (name) => {
      gateStillOpen(`obk up of the throwaway session ${name} of ${of}`);
      const entry = tabOf(obkJson(['up', '--bots', bots, '--bot', bot.name, '--session', name]), name);
      assert.equal(entry.created, true, `${of}: up opened ${name}'s tab`);
      assert.equal(entry.harnessStarted, true, `${of}: no claude came up in ${entry.title}: \`orca terminal read --terminal ${entry.terminal} --screen\``);
      const tab = { title: entry.title, handle: entry.terminal, home, bots };
      return { tab, screen: () => lookAtScreen(t, tab), lines: () => linesOf(projects, home, entryInBook(bot, name).session) };
    };

    /** Wait until the kit's hook has named the session's conversation in the book. Gives back the entry. */
    const hooked = (name, up) => until(
      `${of}: the kit's hook to name ${name}'s conversation in ${path.join(home, 'sessions.yaml')}`,
      READY_MS,
      async () => (typeof entryInBook(bot, name).session === 'string' ? entryInBook(bot, name) : undefined),
      () => whatIsUp(up.tab.handle),
      up.screen,
    );

    /** Wait for the session's answer with its word. */
    const answers = (name, up) => until(
      `${of}: ${name} to answer with its word ${wordOf(bot, name)}`,
      ANSWER_MS,
      async () => (saidBySession(up.lines()).includes(wordOf(bot, name)) ? true : undefined),
      () => `\n  the conversation:\n${tailOf(up.lines())}${whatIsUp(up.tab.handle)}`,
      up.screen,
    );

    /** Wait for the first `prompt_snapshot` of the session's transcript. */
    const recorded = (name, up) => until(
      `${of}: a first prompt_snapshot in ${name}'s transcript`,
      30000,
      async () => firstSnapshot(up.lines()),
      () => `\n  the conversation:\n${tailOf(up.lines())}`,
      up.screen,
    );

    // a. FIRST: Claude Code's own main text, noted and recorded.
    const first = upOf(FIRST);
    const firstEntry = await hooked(FIRST, first);
    assert.equal(firstEntry.own_text, true, `${of}: the book has ${FIRST} on Claude Code's own main text, got: ${JSON.stringify(firstEntry)}`);
    const noteFile = path.join(sources, `${firstEntry.session}.json`);
    const note = await until(
      `${of}: the kit's note of ${FIRST}'s start at ${noteFile}`,
      NOTE_MS,
      async () => jsonOf(noteFile),
      () => `\n  ${sources} holds: ${namesIn(sources).join(', ') || '(nothing)'}`,
      first.screen,
    );
    const appendedSum = /^system-([0-9a-f]{16})\.md$/.exec(String(note.appended))?.[1];
    assert.equal(typeof appendedSum, 'string', `${of}: the note names the kit's appended file, system-<sum>.md, got: ${JSON.stringify(note)}`);
    await answers(FIRST, first);
    const firstRecord = await recorded(FIRST, first);
    const firstLines = first.lines();
    t.diagnostic(`${of}: ${FIRST}'s record: model ${modelOf(firstLines) ?? '(none named)'}, the note's model ${note.model}, first record of ${firstRecord.version ?? '(no version)'}, versions ${versionsOf(firstLines).join(', ') || '(none recorded)'}, ${firstRecord.sections.length} sections, last section the kit's appended text: ${sum16(firstRecord.sections.at(-1) ?? '') === appendedSum}`);
    const own = firstRecord.sections.slice(0, -1);
    const ownSums = own.map(sha);
    ownOf[bot.name] = ownSums;
    own.forEach((section, at) => t.diagnostic(`own ${bot.label} ${at} ${section.length} ${ownSums[at]} ${namesText(recipeNamesOf(section, recipe))}`));

    // b. SECOND: the kit's main file, and what Claude Code adds after it.
    const second = upOf(SECOND);
    const shape = entryInBook(bot, SECOND).shape;
    const saved = namesIn(originals);
    assert.ok(saved.length > 0, `${of}: the build saved no original in ${originals}: the kit reads ${installed.version ?? installed.why}, ${FIRST}'s record is of ${firstRecord.version ?? '(no version)'}, its model ${modelOf(firstLines) ?? '(none named)'} and the note's ${note.model}; ${FIRST}'s shape ${firstEntry.shape}, ${SECOND}'s ${shape}`);
    t.diagnostic(`${of}: saved originals: ${saved.join(', ')}`);
    const secondEntry = await hooked(SECOND, second);
    assert.equal(typeof secondEntry.main, 'string', `${of}: the book has ${SECOND} on a main file of the kit's, got: ${JSON.stringify(secondEntry)}`);
    const mainFile = path.join(text, path.basename(secondEntry.main));
    assert.ok(existsSync(mainFile), `${of}: the main file the book names for ${SECOND}, ${mainFile}, is there; ${text} holds: ${namesIn(text).join(', ')}`);
    const mainText = readFileSync(mainFile, 'utf8');
    await answers(SECOND, second);
    const secondRecord = await recorded(SECOND, second);
    const secondLines = second.lines();
    const sections = secondRecord.sections;
    const version = secondRecord.version ?? '(no version)';
    const mainAt = sections.findIndex((section) => sha(section) === sha(mainText));
    t.diagnostic(`${of}: ${SECOND}'s record: model ${modelOf(secondLines) ?? '(none named)'}, first record of ${version}, versions ${versionsOf(secondLines).join(', ') || '(none recorded)'}, ${sections.length} sections; the main file (${mainText.length} characters) is section ${mainAt === -1 ? 'none' : mainAt}; the last section is the kit's appended text: ${sum16(sections.at(-1) ?? '') === appendedSum}`);
    const between = mainAt === -1 ? sections.slice(0, -1).map((section, at) => [section, at]) : sections.slice(mainAt + 1, -1).map((section, at) => [section, mainAt + 1 + at]);
    const parts = between.map(([section, at]) => {
      const sum = sha(section);
      const ownIndex = ownSums.indexOf(sum);
      const names = recipeNamesOf(section, recipe);
      t.diagnostic(`added ${bot.label} ${at} ${section.length} ${sum} in_main=${mainText.includes(section)} own_index=${ownIndex === -1 ? 'none' : ownIndex} ${namesText(names)}`);
      return { sha256: sum, size: section.length, own_index: ownIndex === -1 ? null : ownIndex, in_main: mainText.includes(section), recipe: names };
    });
    t.diagnostic(`added-parts ${bot.label} ${version} ${JSON.stringify(parts)}`);
  }

  // The Artifact bot's own text against the plain bot's of the same model: what keeping Artifact adds to it.
  const plain = ownOf[botOf(ARTIFACT_MODEL).name];
  const kept = ownOf[artifact.name];
  if (plain !== undefined && kept !== undefined) {
    const extra = kept.map((sum, at) => [sum, at]).filter(([sum]) => !plain.includes(sum));
    if (extra.length === 0) t.diagnostic(`artifact ${artifact.label}: its own text holds no section that the plain ${ARTIFACT_MODEL} bot's lacks, so it lacks the Artifact paragraph: this account or Claude Code gives the session no Artifact tool`);
    for (const [sum, at] of extra) t.diagnostic(`artifact ${artifact.label}: own section ${at} is not in the plain bot's own text: ${sum}`);
  }
});
