// A system test, and the live check for #659: a Pi session follows its bot's
// rules and can use its bot's skills. It runs against the real Pi and the real
// Orca on this machine. Run it alone with
// `npm run test:system -- --yes test/system/pi-rules-skills.test.js`;
// `npm test` cannot, and no CI machine could.
//
// The rules under test (the request of #659, R1 and R2):
//
//   R1  A Pi session starts from its bot's AGENTS.md: its tab opens in the bot
//       folder, and Pi reads the AGENTS.md there whatever the project trust.
//   R2  A Pi session can use the skills its bot's lists name: the kit names
//       the bot's own `.agents/skills` on the Pi launch line with `--skill`.
//       A skill added later reaches the running session through
//       `obk skills build`, which types `/reload` into its idle tab.
//   The boundary: the kit writes nothing into ~/.pi/agent, and Pi's project
//       trust is left as it is (`--no-approve` on every Pi launch line).
//
// One throwaway bot on Pi, `pi-rs`, with one Pi session, `daily`. Its charter,
// and so its AGENTS.md, carries a probe word no other text here has. Its skills
// list names one skill of this test's own, from the throwaway bots folder's
// common skills folder, with a name and a description no other skill has. A
// second throwaway bot on Pi, `pi-rs-sender`, has one Pi session that does
// nothing but send one letter; it is there because `obk message send` needs a
// sender with a mailbox of its own, as in pi-mail.test.js.
//
//   1. After `obk up` and the first turn, Pi's session file for `pi-rs/daily`
//      holds a system message whose `sections` have `project_context` with the
//      probe word and `skills` with the first skill's name.
//   2. The test adds a second skill to the list with `obk skills add` and runs
//      `obk skills build` while the Pi tab is idle. The build's line for
//      `pi-rs/daily` says `reloaded`.
//   3. One letter from the sender gives the Pi session one more turn, by
//      Orca's own notice. A later system message in its session file has a
//      `skills` section that holds the second skill's name. Without the
//      `/reload`, Pi takes no new skill by itself (tech notes, section 6, seen
//      live), so this shows the reload took.
//   4. Nothing new appeared under ~/.pi/agent but the two sessions' own folders
//      and files, and ~/.pi/agent/trust.json is byte for byte what it was.
//
// What is ASSERTED is judged from Pi's own record of the session,
// `~/.pi/agent/sessions/--<folder>--/<timestamp>_<id>.jsonl`, found by the id
// the book holds, and from the build's plain output. Pi 1.3.0 writes the prompt
// into that file as a system message with `sections`, an object keyed by
// section name; a later change is a system message with only the sections that
// changed (Pi's docs/session-format.md, and the tech notes, section 6).
//
// What is OBSERVED, NOT JUDGED (printed as diagnostics): the outputs of
// `skills build` and of the send; whether Orca listed the Pi tab as orphaned;
// Pi session folders other Pi sessions on this machine made while it ran.
//
// **An orphaned tab.** Orca gives no notice to a tab it lists as orphaned, and
// the kit may not type into one. So before the build this test makes sure the
// Pi tab is real, by the same step and the same gate as pi-mail.test.js: one
// more throwaway project with one plain tab (helpers/newer-project.js), only
// when the local hour is 0 to 5 and the run named this file. Otherwise it
// opens nothing, fails, and says why.
//
// The machine it runs on is someone's working machine, with their own tabs
// open. So this test, like the ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory;
//   - writes down every terminal and workspace Orca already had, before it
//     creates anything;
//   - runs this checkout's `src/cli.js` by its full path, never the machine's
//     `obk`;
//   - types at no bot: the only keys that go into a tab are the kit's launch
//     lines, the kit's `/reload`, and Orca's own notice;
//   - closes only its own tabs, through the tab guard, then deletes its own
//     workspaces, whatever happened;
//   - removes Pi's session folders of its own two throwaway bot folders, and
//     nothing else under ~/.pi;
//   - signals no process.
//
// `orca terminal close --worktree … --all` is never run here, and the helper
// refuses to run it at all. The runner (scripts/test-system.js) backs up
// ~/.claude.json and ~/.codex/config.toml before the run and compares them
// after it.
//
// **Nobody answers anything by hand.** No Pi tab here should ask anything: Pi
// shows no trust screen with the kit's `--no-approve`. Bot Father's own tab is
// left as it comes up; nothing is sent to it. So the test answers no screen:
// any question on a Pi tab's screen (`questionOn`), and Pi's trust screen by
// its title, stops the run at once, with the screen in the failure message.
//
// The model: Pi on `openai/gpt-6-luna` at thinking `low`, as pi-mail.test.js.
// Each session is told to answer with one word and to use no tool.
//
// What it cannot clean up, and says so: the Run mailboxes it makes (Orca has
// no `run-delete`), and whatever Orca keeps of its own for these tabs.
//
// It takes about five minutes.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry } from '../helpers/cli.js';
import { questionOn, waitingOn } from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { deleteOwnProject } from '../helpers/own-project.js';
import { openNewerProject } from '../helpers/newer-project.js';
import { atNight, namedThisRun } from '../helpers/night-gate.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/** The Orca CLI that works for a normal user (tech notes, section 1). */
const ORCA = process.env.OBK_ORCA || '/Applications/Orca.app/Contents/Resources/bin/orca';

/** This file, as the runner names it in OBK_SYSTEM_NAMED. */
const THIS_FILE = fileURLToPath(import.meta.url);

/** How long a tab is given to come up, answer its first turn and be idle. */
const READY_MS = 180000;

/** How long `/reload` is given to finish before the next turn is asked for. */
const RELOAD_MS = 30000;

/**
 * How long Orca's notice and the turn after it are given: it reached an idle
 * Claude Code session about 3.5 min after its turn ended (ADR 0042, the probe
 * of 2026-10-11).
 */
const NOTICE_MS = 300000;

/** How long the tab is given to be listed as real after one more project is opened (#561: about 30 s). */
const REAL_MS = 30000;

/** Pi's model and thinking level here. */
const PI_MODEL = 'openai/gpt-6-luna';
const PI_THINKING = 'low';

/** Pi's own folder (tech notes, section 6), and its record of its sessions. */
const PI_AGENT = path.join(os.homedir(), '.pi', 'agent');
const PI_SESSIONS = path.join(PI_AGENT, 'sessions');
const PI_TRUST = path.join(PI_AGENT, 'trust.json');

/** The title of Pi's project-trust screen (tech notes, section 6), which --no-approve should keep away. */
const PI_TRUST_TITLE = 'Trust project folder?';

/** The words this run alone uses: the probe word in AGENTS.md, and the two skills' names and descriptions. */
const RUN = randomBytes(4).toString('hex');
const PROBE = `PROBE-PELICAN-${RUN.toUpperCase()}`;
const FIRST = { name: `rsk-first-${RUN}`, description: `Use this skill when the user mentions the word heron-${RUN}.` };
const SECOND = { name: `rsk-second-${RUN}`, description: `Use this skill when the user mentions the word egret-${RUN}.` };

const PI = 'pi-rs';
const SENDER = 'pi-rs-sender';

const guard = tabGuard(ORCA);
const { orca } = guard;

// ------------------------------------------------------------- Orca and the kit

/** Every terminal Orca knows about right now. */
function allTerminals() {
  const answer = orca(['terminal', 'list']);
  assert.equal(answer.ok, true, `orca terminal list failed: ${JSON.stringify(answer.error)}`);
  return answer.result.terminals;
}

/** The terminals in one workspace, by the path they were opened in. */
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

/** Every workspace Orca knows about right now. */
function allSetups() {
  const answer = orca(['project', 'setups']);
  assert.equal(answer.ok, true, `orca project setups failed: ${JSON.stringify(answer.error)}`);
  return answer.result.setups;
}

/** Run this checkout's `obk`, by its full path (#217, #220). */
function obk(args) {
  const done = spawnSync(process.execPath, [cliEntry, ...args], { encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(done.error, undefined, `could not run \`obk\`: ${done.error?.message}`);
  assert.ok(!/worktree/i.test(done.stdout + done.stderr), `obk said "worktree": ${done.stdout}${done.stderr}`);
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

/** What the book says about one session right now. */
async function sessionIn(home, name) {
  const book = parse(await readFile(path.join(home, 'sessions.yaml'), 'utf8')) ?? {};
  return book.sessions?.[name] ?? {};
}

/**
 * Keep asking until `look` gives something other than undefined, or the time
 * runs out; `note` says what was seen. `screen`, when given, is run before each
 * look: the tab's screens, stopped at.
 */
async function until(what, within, look, note = () => '', screen = async () => {}) {
  const stop = Date.now() + within;
  for (;;) {
    await screen();
    const found = await look();
    if (found !== undefined) return found;
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

/** The tab as Orca lists it now, or undefined when Orca does not list it. */
const listed = (handle) => allTerminals().find((terminal) => terminal.handle === handle);

/** Whether Orca lists the tab as real: `orphaned: false` and a tab id that does not start with `pty:` (#561). */
const realTab = (entry) => entry?.orphaned === false && typeof entry.tabId === 'string' && !entry.tabId.startsWith('pty:');

/** Whether Orca lists the tab as orphaned now, in words. */
function orphanWords(handle) {
  const entry = listed(handle);
  if (entry === undefined) return 'not listed by Orca at all';
  return realTab(entry)
    ? `listed as real (orphaned: false, tab id ${entry.tabId})`
    : `listed as ORPHANED (orphaned: ${entry.orphaned}, tab id ${entry.tabId}): Orca gives an orphaned tab no notice`;
}

/** What the tab is showing, for the message of a wait that ran out, with whether it is orphaned. */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  return `${blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`}\n  The tab ${handle} is ${orphanWords(handle)}.\n  orca terminal read --terminal ${handle} --screen\n    ${(rowsOf(handle) ?? ['(unreadable)']).join('\n    ')}`;
}

/** Whether Orca calls the tab idle right now, with nothing to answer on it. */
function idleNow(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  return answer.ok === true && answer.result?.wait?.satisfied === true && answer.result?.wait?.blockedReason === undefined
    && waitingOn(orca, handle) === undefined;
}

/**
 * One look at a tab's screen. No tab here should ask anything, and this test
 * answers nothing: Pi's trust screen, which its `→` pointer keeps from
 * `questionOn`, or any other question stops the run, with the screen.
 */
function stopAtScreens(title, handle) {
  const rows = rowsOf(handle);
  if (rows === undefined) return;
  assert.ok(!rows.some((row) => row.includes(PI_TRUST_TITLE)), `${title} shows Pi's project-trust screen, which the kit's --no-approve should keep away; this test answers nothing, and the run stops here:\n    ${rows.join('\n    ')}`);
  const question = questionOn(rows);
  assert.equal(question, undefined, `${title} shows a screen this test does not know, and it answers nothing; the run stops here:\n    ${rows.join('\n    ')}`);
}

// ------------------------------------------------------------- an orphaned tab

/**
 * Before the build: the Pi tab is real, or this test opens one more project,
 * at night in a run that names this file, and the tab is real within REAL_MS;
 * or the test fails and says why. The extra project's home goes into `homes`,
 * the teardown's list, before it is made. The same step as pi-mail.test.js.
 */
async function loadedForNotice(t, { title, handle }, why, { bots, homes }) {
  const entry = listed(handle);
  assert.ok(entry !== undefined, `${title}: Orca no longer lists its tab ${handle}`);
  t.diagnostic(`${title} (${handle}) before ${why}: ${orphanWords(handle)}`);
  if (realTab(entry)) return;

  const now = new Date();
  const night = atNight(now);
  const named = namedThisRun(THIS_FILE);
  if (!(night && named)) {
    t.diagnostic(`opened no extra project for ${title} (night: ${night}, this file named: ${named})`);
    assert.fail([
      `Orca lists ${title}'s tab (${handle}) as orphaned before ${why}.`,
      'Orca gives no notice to an orphaned tab, so this test cannot pass.',
      'This test opens one more project and one plain tab in the Orca window only in a night run, between midnight and 6 am local time, that names this file:',
      '  npm run test:system -- --yes test/system/pi-rules-skills.test.js',
      `This run is at ${now.toTimeString().slice(0, 5)} local time and ${named ? 'names this file' : 'does not name this file'}, so it opened nothing.`,
    ].join('\n'));
  }

  const count = homes.filter((home) => path.basename(home).startsWith('newer-')).length + 1;
  const home = path.join(bots, 'bots', `newer-${count}`);
  homes.push(home);
  const newer = await openNewerProject(guard, home, `pi-rules-skills newer ${count}`);
  t.diagnostic(`opened one more project at ${home} at ${now.toISOString()} for ${title}: tellWindow ${newer.told ? 'taken' : 'not taken'}, plain tab ${newer.handle}`);
  const stop = Date.now() + REAL_MS;
  while (!realTab(listed(handle)) && Date.now() < stop) await setTimeout(500);
  t.diagnostic(`${title} (${handle}) after one more project: ${orphanWords(handle)}`);
  assert.ok(realTab(listed(handle)), `Orca still lists ${title}'s tab (${handle}) as orphaned ${REAL_MS} ms after this test opened one more project at ${home}`);
}

// ------------------------------------------------------------- Pi's record

/** Pi's session folder name for a working folder (tech notes, section 6): its real path, `/`, `\` and `:` as `-`. */
const piFolderNameOf = (cwd) => `--${realpathSync(cwd).replace(/^\//, '').replaceAll(/[/\\:]/g, '-')}--`;

/** The Pi session file of the session `id` that ran in `cwd`, or undefined before Pi has written one. */
function piRecordOf(cwd, id) {
  const folder = path.join(PI_SESSIONS, piFolderNameOf(cwd));
  let names = [];
  try {
    names = readdirSync(folder);
  } catch {
    return undefined;
  }
  const found = names.filter((name) => name.endsWith(`_${id}.jsonl`)).sort();
  return found.length === 0 ? undefined : path.join(folder, found.at(-1));
}

/** The whole lines of a JSONL file, as JSON; a line being written, or not JSON, is left out. */
function entriesOf(file) {
  if (file === undefined) return [];
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  return text.split('\n').flatMap((raw) => {
    try {
      return [JSON.parse(raw)];
    } catch {
      return [];
    }
  });
}

/** The text of a Pi message: a string, or its text blocks. */
const textOf = (content) => (typeof content === 'string'
  ? content
  : Array.isArray(content) ? content.filter((block) => block?.type === 'text').map((block) => String(block.text)).join('\n') : '');

/** The messages of one role in a Pi record, `{ index, message }`. */
const messagesOf = (entries, role) => entries.flatMap((entry, index) => (
  entry?.type === 'message' && entry.message?.role === role ? [{ index, message: entry.message }] : []
));

/** One section of a Pi system message, as text, or undefined when the message does not carry it. */
const sectionOf = (message, name) => (typeof message?.sections?.[name] === 'string' ? message.sections[name] : undefined);

/** The system messages of a record, short, for a failure message: their index and the names of their sections. */
const systemsIn = (entries) => messagesOf(entries, 'system')
  .map(({ index, message }) => `#${index}: sections ${JSON.stringify(Object.keys(message.sections ?? {}))}`)
  .join('\n  ') || '(none)';

/** The last lines of a record, short, for a failure message. */
function tailOf(entries, count = 20) {
  return entries.slice(-count).map((entry) => `${entry?.timestamp ?? '?'} ${entry?.type}/${entry?.message?.role ?? '-'}: ${textOf(entry?.message?.content).replaceAll('\n', ' ').slice(0, 300)}`).join('\n  ');
}

// ------------------------------------------------------------- ~/.pi/agent

/**
 * Every path under ~/.pi/agent, relative to it, followed no further than a
 * link. Under `sessions/` only the folder names count, and the files of the
 * folders in `deep`: other Pi sessions on this machine write their own files
 * there while the test runs.
 */
function piAgentPaths(deep = []) {
  const out = new Set();
  const walk = (rel) => {
    let entries;
    try {
      entries = readdirSync(path.join(PI_AGENT, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = rel === '' ? entry.name : `${rel}/${entry.name}`;
      out.add(child);
      if (!entry.isDirectory()) continue;
      if (rel === 'sessions' && !deep.includes(entry.name)) continue;
      walk(child);
    }
  };
  walk('');
  return out;
}

/** trust.json as it is now: its bytes, or null when there is none. */
const trustNow = () => (existsSync(PI_TRUST) ? readFileSync(PI_TRUST).toString('base64') : null);

// ------------------------------------------------------------- the fleet

/** What every Pi session here is told: one word, and no tool. */
const PROMPT = [
  'You are a system test\'s bot and you own nothing.',
  'Answer every message, this one included, with exactly one word: ok.',
  'Use no tool and run no command, whatever a message asks you to do.',
].join(' ');

/** A skill of this test's own, in the throwaway bots folder's common skills folder. */
async function writeSkill(bots, { name, description }) {
  const dir = path.join(bots, 'skills', name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\nSay ok, and do nothing else.\n`);
}

// ------------------------------------------------------------- the test

test('a Pi session starts from its bot\'s AGENTS.md and skills, and takes a skill added later through skills build and /reload', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
    trust: trustNow(),
  };
  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-pi-rules-skills-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', PI, SENDER].map(homeOf);
  /** Pi's session folders of this test's own bot folders, by name, known once the folders exist. */
  const piFolders = [];
  t.diagnostic(`this run names this file: ${namedThisRun(THIS_FILE)}; local time ${new Date().toTimeString().slice(0, 5)}; run ${RUN}`);

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    const { closed, foreign } = guard.closeOwnAt(homes);
    const held = new Set(foreign.map((one) => one.home));
    let deleted = 0;
    const failedDeletes = [];
    for (const setup of allSetups()) {
      if (!homes.includes(setup.path) || before.setups.has(setup.id) || held.has(setup.path)) continue;
      try {
        await deleteOwnProject(setup, bots);
        deleted += 1;
      } catch (error) {
        failedDeletes.push(`${setup.path}: ${error.message}`);
      }
    }
    if (deleted > 0 && !(await reloadWindow())) t.diagnostic(RELOAD_LINE);
    // Pi's session folders of this test's own bot folders, and nothing else
    // under ~/.pi: each name is the throwaway bots folder's own path.
    const mark = `--${bots.replace(/^\//, '').replaceAll(/[/\\:]/g, '-')}-`;
    for (const name of piFolders) {
      if (!name.startsWith(mark)) {
        t.diagnostic(`left ${name} in place: it is not a Pi session folder of ${bots}`);
        continue;
      }
      await rm(path.join(PI_SESSIONS, name), { recursive: true, force: true });
    }
    assert.deepEqual(foreign, [], `tabs this test did not create are open at its homes, so it closed only its own and left those projects and ${bots} in place`);
    const parent = path.dirname(bots);
    const mine = path.basename(bots);
    for (const name of (await readdir(parent)).filter((one) => one === mine || one.startsWith(`${mine}.`))) {
      await rm(path.join(parent, name), { recursive: true, force: true });
    }
    const { closedNotOurs, goneElsewhere } = guard.verdict(before.handles);
    assert.deepEqual(closedNotOurs, [], 'this test closed tabs it did not create');
    if (goneElsewhere.length > 0) t.diagnostic(`tabs open before this test and closed elsewhere meanwhile: ${goneElsewhere.join(', ')}`);
    for (const home of homes) assert.deepEqual(await terminalsAfterClosing(home, closed), [], `this test left tabs behind in ${home}`);
    assert.deepEqual(failedDeletes, [], 'projects this test could not remove, left in Orca');
  });

  obkJson(['init', '--bots', bots, '--harness', 'claude']);
  obkJson(['bot', 'create', '--bots', bots, '--name', PI, '--harness', 'pi', '--charter', `Pi RS exists for one system test run and owns nothing. Its probe word is ${PROBE}.`]);
  obkJson(['bot', 'create', '--bots', bots, '--name', SENDER, '--harness', 'pi', '--charter', 'Pi RS Sender exists for one system test run and owns nothing.']);
  for (const bot of [PI, SENDER]) piFolders.push(piFolderNameOf(homeOf(bot)));
  const agentBefore = piAgentPaths();

  // The first skill, listed before up: up links it before it opens the tab.
  await writeSkill(bots, FIRST);
  await writeSkill(bots, SECOND);
  const listed1 = obk(['skills', 'add', '--bots', bots, '--bot', PI, '--skill', FIRST.name]);
  assert.equal(listed1.status, 0, `obk skills add ${FIRST.name}: ${listed1.stdout}${listed1.stderr}`);
  for (const bot of [PI, SENDER]) {
    obkJson(['session', 'add', '--bots', bots, '--bot', bot, '--name', 'daily', '--harness', 'pi', '--model', PI_MODEL, '--effort', PI_THINKING, `--prompt=${PROMPT}`]);
  }

  /** One session up, its conversation and mailbox in the book, and its first turn answered with its tab idle. */
  const bringUp = async (bot) => {
    const entry = tabOf(obkJson(['up', '--bots', bots, '--bot', bot, '--session', 'daily']), 'daily');
    assert.equal(entry.created, true, `the premise: up opened ${entry.title}`);
    const { title } = entry;
    const handle = entry.terminal;
    const screen = async () => stopAtScreens(title, handle);
    const held = await until(`the book to hold ${title}'s conversation and mailbox`, READY_MS, async () => {
      const found = await sessionIn(homeOf(bot), 'daily');
      return typeof found.session === 'string' && typeof found.mailbox === 'string' ? found : undefined;
    }, () => whatIsUp(handle), screen);
    const record = () => entriesOf(piRecordOf(homeOf(bot), held.session));
    await until(`${title}'s first turn to be answered and its tab idle`, READY_MS, async () => (
      messagesOf(record(), 'assistant').length > 0 && idleNow(handle) ? true : undefined
    ), () => `\n  its Pi record's tail:\n  ${tailOf(record())}${whatIsUp(handle)}`, screen);
    t.diagnostic(`${title} (${handle}) once it was up: ${orphanWords(handle)}`);
    return { title, handle, screen, id: held.session, record };
  };

  const sender = await bringUp(SENDER);
  const pi = await bringUp(PI);

  // ----------------------------------------------------------- 1. AGENTS.md and the first skill
  const first = messagesOf(pi.record(), 'system');
  const started = first.find(({ message }) => (sectionOf(message, 'project_context') ?? '').includes(PROBE));
  assert.ok(started, `${pi.title}: a system message's project_context holds the probe word of its AGENTS.md (R1).\n  system messages:\n  ${systemsIn(pi.record())}\n  tail:\n  ${tailOf(pi.record())}`);
  assert.ok(
    first.some(({ message }) => (sectionOf(message, 'skills') ?? '').includes(FIRST.name)),
    `${pi.title}: a system message's skills section names ${FIRST.name}, the skill its list names (R2).\n  system messages:\n  ${systemsIn(pi.record())}`,
  );
  assert.ok(
    !first.some(({ message }) => (sectionOf(message, 'skills') ?? '').includes(SECOND.name)),
    `the premise: ${SECOND.name}, not yet on the list, is not among its skills`,
  );

  // ----------------------------------------------------------- 2. a skill added, built, and /reload
  await loadedForNotice(t, pi, 'the skills build', { bots, homes });
  const listed2 = obk(['skills', 'add', '--bots', bots, '--bot', PI, '--skill', SECOND.name]);
  assert.equal(listed2.status, 0, `obk skills add ${SECOND.name}: ${listed2.stdout}${listed2.stderr}`);
  await until(`${pi.title} to be idle before the build`, READY_MS, async () => (idleNow(pi.handle) ? true : undefined), () => whatIsUp(pi.handle), pi.screen);
  const mark = pi.record().length;
  const built = obk(['skills', 'build', '--bots', bots, '--bot', PI]);
  t.diagnostic(`obk skills build said (exit ${built.status}):\n  ${`${built.stdout}${built.stderr}`.trim().replaceAll('\n', '\n  ')}`);
  assert.equal(built.status, 0, `obk skills build: ${built.stdout}${built.stderr}`);
  const told = built.stdout.split('\n').filter((line) => line.includes(` ${PI}/daily `) || line.endsWith(` ${PI}/daily`));
  assert.equal(told.length, 1, `the build has one line about ${PI}/daily, got:\n${built.stdout}`);
  assert.match(told[0], /^ {2}reloaded {2,}/, `the idle Pi session was reloaded, got: ${told[0]}`);
  const reloaded = await until(`${pi.title} to be idle again after /reload`, RELOAD_MS, async () => (idleNow(pi.handle) ? true : undefined), () => whatIsUp(pi.handle), pi.screen).then(() => rowsOf(pi.handle) ?? []);
  t.diagnostic(`${pi.title}'s screen after the build (observed, not judged):\n    ${reloaded.slice(-12).join('\n    ')}`);

  // ----------------------------------------------------------- 3. one more turn, and the second skill
  const sent = obk([
    'message', 'send', '--bots', bots, '--to', `${PI}/daily`, '--from', `${SENDER}/daily`,
    '--subject', 'one more turn', '--text', 'Answer with one word: ok.',
  ]);
  t.diagnostic(`the send said (exit ${sent.status}):\n  ${`${sent.stdout}${sent.stderr}`.trim().replaceAll('\n', '\n  ')}`);
  assert.equal(sent.status, 0, `the letter went: ${sent.stdout}${sent.stderr}`);
  const later = await until(`a system message after the build in ${pi.title}'s record whose skills section names ${SECOND.name}`, NOTICE_MS, async () => (
    messagesOf(pi.record(), 'system').find(({ index, message }) => index >= mark && (sectionOf(message, 'skills') ?? '').includes(SECOND.name))
  ), () => `\n  system messages:\n  ${systemsIn(pi.record())}\n  tail:\n  ${tailOf(pi.record())}${whatIsUp(pi.handle)}`, pi.screen);
  t.diagnostic(`${pi.title}: the second skill came in the system message at line ${later.index} of its record`);

  // ----------------------------------------------------------- 4. ~/.pi/agent
  assert.equal(trustNow(), before.trust, '~/.pi/agent/trust.json is byte for byte what it was: Pi\'s project trust is left as it is');
  const ours = piFolders.map((name) => `sessions/${name}`);
  const agentAfter = piAgentPaths(piFolders);
  const added = [...agentAfter].filter((one) => !agentBefore.has(one));
  const outside = added.filter((one) => !one.startsWith('sessions/'));
  assert.deepEqual(outside, [], 'nothing new under ~/.pi/agent outside its sessions folder: the kit writes nothing there');
  const sessionFolders = added.filter((one) => one.split('/').length === 2 && one.startsWith('sessions/'));
  const mineMark = `sessions/--${bots.replace(/^\//, '').replaceAll(/[/\\:]/g, '-')}-`;
  assert.deepEqual(
    sessionFolders.filter((one) => one.startsWith(mineMark) && !ours.includes(one)),
    [],
    'no Pi session folder of this test\'s bots folder but its two sessions\' own',
  );
  const others = sessionFolders.filter((one) => !one.startsWith(mineMark));
  if (others.length > 0) t.diagnostic(`Pi session folders other Pi sessions on this machine made meanwhile (not judged): ${others.join(', ')}`);
  const ids = { [`sessions/${piFolders[0]}`]: pi.id, [`sessions/${piFolders[1]}`]: sender.id };
  const files = added.filter((one) => one.split('/').length === 3);
  assert.deepEqual(
    files.filter((one) => !one.endsWith(`_${ids[path.dirname(one)]}.jsonl`)),
    [],
    'in the two sessions\' folders, nothing but each session\'s own file',
  );
});
