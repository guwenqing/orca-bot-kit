// A system test, and the live check for #660: `obk health` knows a Pi session.
// It runs against the real Pi and the real Orca on this machine, and this
// checkout's `src/cli.js` by its full path. Run it alone with
// `npm run test:system -- --yes test/system/pi-health.test.js`;
// `npm test` cannot, and no CI machine could.
//
// One throwaway fleet: init (Bot Father on claude), and one Pi bot,
// `pi-health`, with one session, `daily`, on openai/gpt-6-luna at thinking
// low. Its prompt only answers OK and runs no command. Four checks:
//
//   1. `daily` up and idle after its start turn: health's `sessions` entry for
//      it has model `match` (observed openai/gpt-6-luna) and effort `match`
//      (observed low), read from Pi's own record, and no finding is about the
//      Pi bot.
//   2. The book given another id than Pi's, written into sessions.yaml by
//      this test: health names the book's id as one Pi has no record of, and
//      names Pi's real id as a conversation the book does not name. Neither
//      finding says anything of a hook. The book gets Pi's id back after.
//   3. A session `nomodel` added with model nosuch/model-660 and never
//      brought up: a config finding at the bot's bot.yaml names the session,
//      the model and `pi --list-models`.
//   4. Health run with no `pi` on PATH: a config finding at the bot's bot.yaml
//      says to install Pi, and no finding judges a model.
//
// What is ASSERTED is read from health's `--json` answer, and from Pi's own
// record of `daily`, `~/.pi/agent/sessions/--<folder>--/<stamp>_<id>.jsonl`
// (tech notes, section 6), found by the id the book holds and read only: the
// start turn was answered, and no health run added a turn to it. What health
// said about other bots, and every answer whole, is printed as diagnostics.
//
// The machine it runs on is someone's working machine, with their own tabs
// open. So this test, like the ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory;
//   - writes down every terminal and project Orca already had, before it
//     creates anything;
//   - runs this checkout's `src/cli.js` by its full path, never the machine's
//     `obk`;
//   - types into no tab at all: the only keys that go into a tab are the
//     kit's launch lines;
//   - closes only its own tabs, through the tab guard, then deletes its own
//     projects, in a teardown registered before anything is created;
//   - signals no process.
//
// `orca terminal close --worktree … --all` is never run here, and the guard
// refuses to run it at all. The runner (scripts/test-system.js) backs up
// ~/.claude.json and ~/.codex/config.toml before the run and compares them
// after it.
//
// **Nobody answers anything by hand.** No tab of this test's should ask
// anything: Pi shows no trust screen with the kit's `--no-approve` (tech
// notes, section 6). So it answers no screen, and needs neither
// `onlyPlainTrustOf` nor `onlyTeachFormOf`: Pi's trust screen by its title, or
// any other question on the Pi tab's screen (`questionOn`), stops the run at
// once, with the screen in the failure message. Bot Father's own tab is left
// as it comes up; nothing is sent to it, and what health says of it is not
// judged.
//
// What it cannot clean up, and says so: the Run mailbox it makes (Orca has no
// `run-delete`), Pi's session file under ~/.pi/agent/sessions/ for this test's
// throwaway bot folder, which this test only reads, and whatever Orca keeps of
// its own for the tab. None of them is used again.
//
// It takes about two minutes: one Pi start turn and five health runs. It
// stays under five.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { parse, stringify } from 'yaml';

import test from '../helpers/system.js';
import { cliEntry } from '../helpers/cli.js';
import { questionOn } from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { deleteOwnProject } from '../helpers/own-project.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/** The Orca CLI that works for a normal user (tech notes, section 1). */
const ORCA = process.env.OBK_ORCA || '/Applications/Orca.app/Contents/Resources/bin/orca';

/** How long the Pi tab is given to come up, answer its start turn and be idle. */
const READY_MS = 180000;

/** Pi's model and thinking level here, what slice 1's live probe used. */
const PI_MODEL = 'openai/gpt-6-luna';
const PI_THINKING = 'low';

/** A model no Pi lists. */
const NOSUCH = 'nosuch/model-660';

const BOT = 'pi-health';
const SESSION = 'daily';

/** Pi's own record of its sessions (tech notes, section 6): read only. */
const PI_SESSIONS = path.join(os.homedir(), '.pi', 'agent', 'sessions');

/** The title of Pi's project-trust screen (tech notes, section 6), which --no-approve should keep away. */
const PI_TRUST_TITLE = 'Trust project folder?';

/** Words a Pi finding must not carry: the kit has no hook in Pi. */
const HOOK_WORDS = [/hook/i, /codex/i, /a clear it did not record/i];

const guard = tabGuard(ORCA);
const { orca } = guard;

// ------------------------------------------------------------- Orca and the kit

/** Every terminal Orca knows about right now. */
function allTerminals() {
  const answer = orca(['terminal', 'list']);
  assert.equal(answer.ok, true, `orca terminal list failed: ${JSON.stringify(answer.error)}`);
  return answer.result.terminals;
}

/** The tabs Orca lists at `home` once it has caught up with what was closed. */
async function terminalsAfterClosing(home, closed, within = 5000) {
  const stop = Date.now() + within;
  let left = allTerminals().filter((terminal) => terminal.worktreePath === home);
  while (left.some((terminal) => closed.includes(terminal.handle)) && Date.now() < stop) {
    await setTimeout(250);
    left = allTerminals().filter((terminal) => terminal.worktreePath === home);
  }
  return left;
}

/** Every project Orca knows about right now. */
function allSetups() {
  const answer = orca(['project', 'setups']);
  assert.equal(answer.ok, true, `orca project setups failed: ${JSON.stringify(answer.error)}`);
  return answer.result.setups;
}

/** Run this checkout's `obk`, by its full path (#217, #220), with `env`. */
function obk(args, env = process.env) {
  const done = spawnSync(process.execPath, [cliEntry, ...args], { encoding: 'utf8', cwd: os.tmpdir(), env });
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

/**
 * `obk health --json` for the throwaway fleet, with `env`: the answer, held to
 * its exit code, and printed for this bot as diagnostics.
 */
function health(t, bots, label, env) {
  const done = obk(['health', '--bots', bots, '--json'], env);
  let answer;
  try {
    answer = JSON.parse(done.stdout);
  } catch {
    return assert.fail(`${label}: health --json did not print JSON (exit ${done.status}):\n${done.stdout}${done.stderr}`);
  }
  t.diagnostic(`===== health: ${label} (exit ${done.status})`);
  for (const one of answer.found) t.diagnostic(`  [${one.kind}] ${one.bot ?? '-'} ${one.where}\n      ${one.says}`);
  for (const one of answer.sessions.filter((entry) => entry.bot === BOT)) {
    t.diagnostic(`  session ${one.session}: harness ${one.harness}, running ${one.running}, conversation ${one.conversation}, settings ${JSON.stringify(one.settings)}`);
  }
  assert.equal(done.status, answer.found.length === 0 ? 0 : 1, `${label}: ${answer.found.length} findings, exit ${done.status}`);
  return answer;
}

/** Everything one finding puts in front of a reader. */
const wordsOf = (finding) => `${finding.where} ${finding.says}`;

/** Whether `word` is in `text` as a word of its own, not inside another. */
const hasWord = (text, word) => new RegExp(`(^|[^A-Za-z0-9_-])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9_-])`).test(text);

/** The findings shown whole, for a failure message. */
const shown = (answer) => JSON.stringify(answer.found, null, 2);

/** A finding about Pi says nothing of a hook. */
function assertNoHookWords(finding, what) {
  for (const words of HOOK_WORDS) {
    assert.doesNotMatch(wordsOf(finding), words, `${what}: the kit has no hook in Pi, so it says nothing like ${words}, got: ${finding.says}`);
  }
}

/** What the book says about one session right now. */
async function bookOf(home) {
  return parse(await readFile(path.join(home, 'sessions.yaml'), 'utf8')) ?? {};
}

/** Write the book's `session:` for one session, as a person editing it by hand would. */
async function bookIdIs(home, session, id) {
  const book = await bookOf(home);
  book.sessions[session].session = id;
  await writeFile(path.join(home, 'sessions.yaml'), stringify(book));
}

/** Keep asking until `look` gives something other than undefined, or the time runs out. `screen` runs before each look. */
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

/**
 * One look at the Pi tab's screen. It should ask nothing, and this test
 * answers nothing: Pi's trust screen, which its `→` pointer keeps from
 * `questionOn`, or any other question stops the run, with the screen.
 */
function stopAtScreens(handle) {
  const rows = rowsOf(handle);
  if (rows === undefined) return;
  assert.ok(!rows.some((row) => row.includes(PI_TRUST_TITLE)), `the Pi tab shows Pi's project-trust screen, which the kit's --no-approve should keep away; this test answers nothing, and the run stops here:\n    ${rows.join('\n    ')}`);
  const question = questionOn(rows);
  assert.equal(question, undefined, `the Pi tab shows a screen this test does not know, and it answers nothing; the run stops here:\n    ${rows.join('\n    ')}`);
}

/** Whether Orca calls the tab idle right now, with nothing waiting on it. */
function idleNow(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  return answer.ok === true && answer.result?.wait?.satisfied === true && answer.result?.wait?.blockedReason === undefined;
}

/** What the tab is showing, for the message of a wait that ran out. */
const screenOf = (handle) => `\n  orca terminal read --terminal ${handle} --screen\n    ${(rowsOf(handle) ?? ['(unreadable)']).join('\n    ')}`;

// ------------------------------------------------------------- Pi's record

/** Pi's session folder for a working folder (tech notes, section 6): its real path, `/`, `\` and `:` as `-`. */
const piFolderOf = (cwd) => path.join(PI_SESSIONS, `--${realpathSync(cwd).replace(/^\//, '').replaceAll(/[/\\:]/g, '-')}--`);

/** The Pi session file of the session `id` that ran in `cwd`, or undefined before Pi has written one. */
function piRecordOf(cwd, id) {
  let names = [];
  try {
    names = readdirSync(piFolderOf(cwd));
  } catch {
    return undefined;
  }
  const found = names.filter((name) => name.endsWith(`_${id}.jsonl`)).sort();
  return found.length === 0 ? undefined : path.join(piFolderOf(cwd), found.at(-1));
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

/** How many messages of one role a Pi record holds. */
const turnsOf = (entries, role) => entries.filter((entry) => entry?.type === 'message' && entry.message?.role === role).length;

// ------------------------------------------------------------- the test

test('obk health knows a Pi session: its settings from Pi\'s record, an id Pi has no record of, a model Pi does not list, and no pi at all (#660)', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };
  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-pi-health-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', BOT].map(homeOf);
  const home = homeOf(BOT);
  const botYaml = path.join(home, 'bot.yaml');

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
    assert.deepEqual(foreign, [], `tabs this test did not create are open at its homes, so it closed only its own and left those projects and ${bots} in place`);
    const parent = path.dirname(bots);
    const mine = path.basename(bots);
    for (const name of (await readdir(parent)).filter((one) => one === mine || one.startsWith(`${mine}.`))) {
      await rm(path.join(parent, name), { recursive: true, force: true });
    }
    const { closedNotOurs, goneElsewhere } = guard.verdict(before.handles);
    assert.deepEqual(closedNotOurs, [], 'this test closed tabs it did not create');
    if (goneElsewhere.length > 0) t.diagnostic(`tabs open before this test and closed elsewhere meanwhile: ${goneElsewhere.join(', ')}`);
    for (const one of homes) assert.deepEqual(await terminalsAfterClosing(one, closed), [], `this test left tabs behind in ${one}`);
    assert.deepEqual(failedDeletes, [], 'projects this test could not remove, left in Orca');
  });

  obkJson(['init', '--bots', bots, '--harness', 'claude']);
  obkJson(['bot', 'create', '--bots', bots, '--name', BOT, '--harness', 'pi', '--charter', 'Pi Health exists for one system test run and owns nothing.']);
  const prompt = 'You are a system test\'s bot and you own nothing. Run no command and read no file. Answer only: OK. Then wait.';
  obkJson(['session', 'add', '--bots', bots, '--bot', BOT, '--name', SESSION, '--model', PI_MODEL, '--effort', PI_THINKING, `--prompt=${prompt}`]);

  // ----------------------------------------------------------- 1. up and idle
  const up = obkJson(['up', '--bots', bots, '--bot', BOT, '--session', SESSION]);
  const entry = (up.tabs ?? []).find((one) => one.name === SESSION);
  assert.equal(entry?.created, true, `the premise: up opened ${SESSION}, got: ${JSON.stringify(up.tabs)}`);
  const handle = entry.terminal;
  const screen = async () => stopAtScreens(handle);
  const piId = await until('the book to hold the Pi session\'s id', READY_MS, async () => {
    const id = (await bookOf(home)).sessions?.[SESSION]?.session;
    return typeof id === 'string' ? id : undefined;
  }, () => screenOf(handle), screen);
  const record = () => entriesOf(piRecordOf(home, piId));
  await until('the start turn to be answered and the Pi tab idle', READY_MS, async () => (
    turnsOf(record(), 'assistant') > 0 && idleNow(handle) ? true : undefined
  ), () => screenOf(handle), screen);
  const userTurns = turnsOf(record(), 'user');

  const healthy = health(t, bots, 'the Pi session up and idle');
  const daily = healthy.sessions.find((one) => one.bot === BOT && one.session === SESSION);
  assert.ok(daily !== undefined, `health has an entry for ${BOT} ${SESSION}, got: ${JSON.stringify(healthy.sessions)}`);
  assert.equal(daily.harness, 'pi', `the entry names the harness, got: ${JSON.stringify(daily)}`);
  assert.equal(daily.running, 'yes', `pi is in front of its tab, got: ${JSON.stringify(daily)}`);
  assert.equal(daily.conversation, piId, `the conversation is the one the book holds, got: ${JSON.stringify(daily)}`);
  assert.deepEqual(
    { state: daily.settings.model.state, observed: daily.settings.model.observed },
    { state: 'match', observed: PI_MODEL },
    `the model from Pi's record matches bot.yaml, got: ${JSON.stringify(daily.settings.model)}`,
  );
  assert.deepEqual(
    { state: daily.settings.effort.state, observed: daily.settings.effort.observed },
    { state: 'match', observed: PI_THINKING },
    `the thinking level from Pi's record matches bot.yaml, got: ${JSON.stringify(daily.settings.effort)}`,
  );
  assert.deepEqual(healthy.found.filter((one) => one.bot === BOT), [], `nothing is wrong with the Pi bot, got: ${shown(healthy)}`);

  // ----------------------------------------------------------- 2. another id in the book
  const other = randomUUID();
  await bookIdIs(home, SESSION, other);
  t.diagnostic(`the book held ${piId}, now ${other}`);
  const moved = health(t, bots, 'the book holds another id than Pi\'s');
  await bookIdIs(home, SESSION, piId);

  const noRecord = moved.found.filter((one) => one.bot === BOT && wordsOf(one).includes(other));
  assert.equal(noRecord.length, 1, `one finding names the id the book holds, ${other}, got: ${shown(moved)}`);
  assert.equal(noRecord[0].kind, 'session', `it is about a session, got: ${JSON.stringify(noRecord[0])}`);
  assert.ok(hasWord(noRecord[0].says, SESSION), `it names the session, got: ${noRecord[0].says}`);
  assert.match(noRecord[0].says, /\bPi\b/, `it says it is Pi that has no record, got: ${noRecord[0].says}`);
  assert.match(noRecord[0].says, /record/i, `and that Pi has no record of the id, got: ${noRecord[0].says}`);
  assertNoHookWords(noRecord[0], 'the id Pi has no record of');
  const unnamed = moved.found.filter((one) => one.kind === 'session' && one.bot === BOT && wordsOf(one).includes(piId));
  assert.equal(unnamed.length, 1, `one finding names Pi's real id, ${piId}, as a conversation the book does not name, got: ${shown(moved)}`);
  assert.match(wordsOf(unnamed[0]), /session:/, `it says to write the id in the book as session: <id>, got: ${unnamed[0].says}`);
  assertNoHookWords(unnamed[0], 'Pi\'s conversation the book does not name');

  // ----------------------------------------------------------- 3. a model Pi does not list
  obkJson(['session', 'add', '--bots', bots, '--bot', BOT, '--name', 'nomodel', '--model', NOSUCH, `--prompt=${prompt}`]);
  const lost = health(t, bots, 'a session whose model Pi does not list, never brought up');
  const model = lost.found.filter((one) => one.kind === 'config' && one.where === botYaml && hasWord(one.says, 'nomodel'));
  assert.equal(model.length, 1, `one config finding at ${botYaml} names the session nomodel, got: ${shown(lost)}`);
  assert.ok(model[0].says.includes(NOSUCH), `it names the model, got: ${model[0].says}`);
  assert.ok(model[0].says.includes('pi --list-models'), `and pi --list-models, got: ${model[0].says}`);
  assert.deepEqual(
    lost.found.filter((one) => one.kind === 'config' && one.where === botYaml && hasWord(one.says, SESSION)),
    [],
    `Pi lists ${SESSION}'s model, got: ${shown(lost)}`,
  );

  // ----------------------------------------------------------- 4. no pi on PATH
  // Node and the system folders only: the real pi sits beside the machine's
  // Node, so that folder is left out. The folder sits beside the bots folder,
  // and the teardown removes it with it.
  const bare = `${bots}.bare-bin`;
  await mkdir(bare, { recursive: true });
  await symlink(process.execPath, path.join(bare, 'node'));
  const noPath = { ...process.env, PATH: [bare, '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(path.delimiter) };
  const where = spawnSync('/bin/sh', ['-c', 'command -v pi'], { encoding: 'utf8', env: noPath });
  assert.notEqual(where.status, 0, `the premise: this PATH holds no pi, found: ${where.stdout}`);
  const missing = health(t, bots, 'no pi on PATH', noPath);
  const install = missing.found.filter((one) => one.kind === 'config' && one.where === botYaml && /install/i.test(one.says));
  assert.equal(install.length, 1, `one config finding at ${botYaml} says to install Pi, got: ${shown(missing)}`);
  assert.match(install[0].says, /\bPi\b/, `it names Pi, got: ${install[0].says}`);
  assert.deepEqual(missing.found.filter((one) => one.says.includes(NOSUCH)), [], `Pi does not run, so no model of it is judged, got: ${shown(missing)}`);

  // Health only reads: no run of it added a turn to the Pi session's record.
  assert.equal(turnsOf(record(), 'user'), userTurns, 'nothing was typed into the Pi tab while health ran');
});
