// A system test: a letter to a session with no open tab, against the real Orca
// on this machine (issue #841, R1). Run it with `npm run test:system`;
// `npm test` cannot, and no CI machine could.
//
// From Orca 1.4.262, Orca deletes the mailbox (a Run) of a session whose tab is
// not open, with every letter in it, a day after its last write (#820). Since
// #841, `obk message to` and `obk message send` to such a session say that,
// with the command that starts it, and `obk health` names such a session whose
// mailbox holds unread letters, with how many and the earliest time Orca may
// delete them.
//
// The fake proves the rules (test/message-no-open-tab.test.js,
// test/health-mail-no-open-tab.test.js). This shows, once, what a user sees on
// the real Orca, and proves the one thing the fake cannot: that once a tab is
// closed, the real Orca's tab listing no longer lists it, so the kit sees that
// the session has no open tab. It also reads the letters back from the real
// Run, with the `created_at` the real Orca gives them, so health's time is
// checked against Orca's own clock. This machine's Orca may be older than
// 1.4.262: the kit gives the words on every version, and nothing here waits
// for a deletion.
//
//   1. A throwaway Claude bot with two sessions, `daily` and `night`, brought
//      up by this checkout, so each tab's step gives its session a real Run.
//   2. The test closes `night`'s own tab, by its handle, and waits until Orca's
//      listing no longer lists it.
//   3. `message to` and `message send` from `daily` to `night`, with `--json`
//      and plain: `noOpenTab: true`, `start` the kit's `up` of `night`, the
//      plain line with every fact, `sent: true`, and both letters in `night`'s
//      Run, read back with `orchestration inbox`.
//   4. `obk health --json` names `night`: kind `mail`, its Run as `where`, at
//      least 2 unread letters, and the newest letter's `created_at` plus 24
//      hours. No subject or body shows in either report.
//
// The machine it runs on is someone's working machine, with their own tabs
// open. So this test, like the ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory;
//   - writes down every terminal and Orca project Orca already had, before it
//     creates anything;
//   - touches only what it created, matched by handle and by project path;
//   - closes its own tabs one by one (`--terminal <handle> --tab`) and then
//     deletes its own Orca projects, in that order;
//   - checks afterwards that it closed no tab it did not create.
//
// The kit has no command to delete a Run. The Runs this test makes are left,
// as every system test that brings a session up leaves them.
//
// **It is not attended.** Nothing here needs a harness to be past its first-run
// screens: the mailbox comes from the tab's step, before the harness, and
// `night`'s tab is closed whatever it shows. `daily` is only the sender, by
// `--from`, and nothing is typed into it. So the test types nothing into any
// tab. Each tab of its own is read once before the close and before the end,
// and a screen that is not Claude Code's plain folder trust for its own folder
// or the captured Teach form (helpers/claude-trust.js `claudeTrustAt`,
// helpers/screens.js `onlyTeachFormOf`), and is a question (`questionOn`),
// stops the run with the screen in the failure. Those two are left as they are:
// nothing here needs them answered, and a tab left on them is closed at the
// end. `Bot Father daily` sits on its own trust question and is left alone.
// Nothing is asked of any agent. A minute or two.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry, spellingsOf } from '../helpers/cli.js';
import { onlyTeachFormOf, questionOn } from '../helpers/screens.js';
import { claudeTrustAt } from '../helpers/claude-trust.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { RC_OFF, withBotFatherOff } from '../helpers/remote-control-off.js';
import { deleteOwnProject, placesOf, projectsInBots } from '../helpers/own-project.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/** The Orca CLI that works for a normal user (tech notes, section 1). */
const ORCA = process.env.OBK_ORCA || '/Applications/Orca.app/Contents/Resources/bin/orca';

/** How long Orca's listing and Claude Code's registry are given to catch up with a closed tab. */
const SETTLE_MS = 20000;

/**
 * Ask Orca something and read its JSON. Never the blanket close, on any road.
 * Every tab it closes is counted as this test's, for the check at the end (#246).
 */
const guard = tabGuard(ORCA);
const { orca } = guard;

/** Every terminal Orca knows about right now. */
function allTerminals() {
  const answer = orca(['terminal', 'list']);
  assert.equal(answer.ok, true, `orca terminal list failed: ${JSON.stringify(answer.error)}`);
  return answer.result.terminals;
}

/** The terminals in one Orca project, by the path it was opened at. */
const terminalsAt = (home) => allTerminals().filter((terminal) => terminal.worktreePath === home);

/**
 * The tabs Orca lists at `home` once it has caught up with what was closed:
 * `terminal close` answers ok before `terminal list` stops reporting the tab.
 */
async function terminalsAfterClosing(home, closed, within = 5000) {
  const until = Date.now() + within;
  let left = terminalsAt(home);
  while (left.some((terminal) => closed.includes(terminal.handle)) && Date.now() < until) {
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

/**
 * Run this checkout's `obk`, by its full path. The `obk` on PATH is the
 * published release this machine uses, not the code under test (#217).
 */
function obk(args) {
  const done = spawnSync(process.execPath, [cliEntry, ...args], { encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(done.error, undefined, `could not run \`obk\`: ${done.error?.message}`);
  return done;
}

/** Run `obk ... --json`, expect one of `statuses`, and read the answer it printed. A tab it says it opened is this test's own. */
function obkJson(args, statuses = [0]) {
  const done = obk([...args, '--json']);
  assert.ok(statuses.includes(done.status), `obk ${args.join(' ')} should have exited ${statuses.join(' or ')}: ${done.stdout}${done.stderr}`);
  try {
    return { ...guard.openedByKit(JSON.parse(done.stdout)), stdout: done.stdout, stderr: done.stderr };
  } catch {
    assert.fail(`obk ${args.join(' ')} --json did not print JSON: ${done.stdout}`);
  }
}

/** Run `obk ...` plain, expect one of `statuses`, and give what it printed. */
function obkPlain(args, statuses = [0]) {
  const done = obk(args);
  assert.ok(statuses.includes(done.status), `obk ${args.join(' ')} should have exited ${statuses.join(' or ')}: ${done.stdout}${done.stderr}`);
  return done;
}

/** The entry for one tab in an `obk --json` answer. */
function tabOf(answer, name) {
  const found = (answer.tabs ?? []).filter((entry) => entry.name === name);
  assert.equal(found.length, 1, `one entry should be the ${name} tab, got: ${JSON.stringify(answer.tabs)}`);
  return found[0];
}

/** Keep asking until `look` gives something other than undefined, or the time runs out. */
async function until(what, within, look, note = () => '') {
  const stop = Date.now() + within;
  for (;;) {
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

/** The title of Claude Code's "Teach auto mode" form (#416), as helpers/screens.js has it. */
const TEACH_TITLE = 'Teach auto mode about your environment?';

/**
 * One look at a tab of this test's own. It answers nothing: nothing here needs
 * a harness past its first-run screens. Claude Code's plain folder trust for
 * `home` and the captured Teach form are let be; any other question stops the
 * run, with the screen in the failure.
 */
function lookAt(title, handle, home) {
  const rows = rowsOf(handle);
  if (rows === undefined) return;
  if (rows.some((row) => row.includes('Yes, I trust this folder'))) {
    const wrong = claudeTrustAt(rows, home, path.dirname(path.dirname(home)), cliEntry);
    assert.equal(wrong, undefined, `${title} shows a folder trust that is not the plain one for its own folder, and the run stops here: ${wrong}.\n    ${rows.join('\n    ')}`);
    return;
  }
  if (rows.some((row) => row.trim() === TEACH_TITLE)) {
    const wrong = onlyTeachFormOf(rows);
    assert.equal(wrong, undefined, `${title} shows a Teach form that is not the captured one, and the run stops here: ${wrong}.\n    ${rows.join('\n    ')}`);
    return;
  }
  const question = questionOn(rows);
  assert.equal(question, undefined, `${title} shows a screen this test does not know, and it answers nothing; the run stops here:\n    ${rows.join('\n    ')}`);
}

/** Whether `word` is in `text` as a word of its own, not inside another. */
const hasWord = (text, word) => new RegExp(`(^|[^A-Za-z0-9_-])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9_-])`).test(text);

/** That the receiver has no open tab, as test/message-no-open-tab.test.js matches it. */
const NO_OPEN_TAB_WORDS = /\bno open tab\b|\btab is not open\b|\bno tab (is )?open\b|\bnot have an open tab\b|\bhas no tab\b/i;

/** Whether `text` gives one of `starts` as a command of its own: nothing of a word or a `--session` runs on after it. */
const givesStart = (text, starts) => starts.some((command) => {
  for (let at = text.indexOf(command); at >= 0; at = text.indexOf(command, at + 1)) {
    const rest = text.slice(at + command.length);
    if (!/^[A-Za-z0-9_-]/.test(rest) && !/^\s*--session\b/.test(rest)) return true;
  }
  return false;
});

/** The facts of R1's first sentence that `line` misses. */
function missingFacts(line, starts) {
  const facts = [
    ['that it has no open tab', NO_OPEN_TAB_WORDS.test(line)],
    ['Orca 1.4.262', /\bOrca 1\.4\.262\b/.test(line)],
    ['that Orca can delete its mailbox', /\bdelet/i.test(line) && /\bmailbox\b/i.test(line)],
    ['with the letters in it', /\bletters\b/i.test(line)],
    ['24 hours', /\b24 hours\b/i.test(line)],
    ['after the last letter or read', /\blast letter\b/i.test(line) && /\bread\b/i.test(line)],
    ['unless the session starts first', /\bunless\b.{0,80}\bstart/i.test(line)],
    ['the start command', givesStart(line, starts)],
  ];
  return facts.filter(([, ok]) => !ok).map(([name]) => name);
}

/** One line of a plain report has every fact of R1's first sentence. Gives that line. */
function assertSaysNoOpenTab(what, text, starts) {
  const best = text.split('\n')
    .map((line) => ({ line, missing: missingFacts(line, starts) }))
    .sort((a, b) => a.missing.length - b.missing.length)[0];
  assert.deepEqual(best.missing, [], `${what}: one line should hold every fact of R1 and the start command (one of: ${starts.join(' | ')}). The nearest line misses ${best.missing.join(', ')}. The report:\n${text}`);
  return best.line;
}

/**
 * The letters in Run `run`, newest first, as the real Orca answers them: with
 * `--full` where it takes it (1.4.246 and later answer short without it), and
 * without it where it refuses the flag.
 */
function lettersIn(run) {
  const full = orca(['orchestration', 'inbox', '--terminal', `run:${run}`, '--limit', '100', '--full']);
  const answer = full.ok === true ? full : orca(['orchestration', 'inbox', '--terminal', `run:${run}`, '--limit', '100']);
  assert.equal(answer.ok, true, `orca orchestration inbox of run:${run} failed: ${JSON.stringify(answer.error)} (with --full: ${JSON.stringify(full.error)})`);
  return answer.result.messages ?? [];
}

/** Remove the throwaway bots folder and every `<bots>.*` the kit made beside it (PRD 6.3). */
async function removeBotsFolderAndSiblings(bots) {
  const parent = path.dirname(bots);
  const mine = path.basename(bots);
  const ours = async () => (await readdir(parent)).filter((name) => name === mine || name.startsWith(`${mine}.`));
  for (const name of await ours()) await rm(path.join(parent, name), { recursive: true, force: true });
  assert.deepEqual(await ours(), [], `this test left folders behind in ${parent}`);
}

const BOT = { name: 'no-open-tab', display: 'No Open Tab' };

/** The subject and the bodies of the two letters: words no report of the kit may show. */
const SUBJECT = 'zq-subject-mulberry-4470';
const BODIES = ['zq-body-damson-8812', 'zq-body-medlar-3307'];

test('#841 R1: a letter to a session whose tab was closed says that Orca can delete its mailbox, names its start, goes to its Run, and health names it with the time 24 hours after the newest letter', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-mail-no-open-tab-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', BOT.name].map(homeOf);
  const home = homeOf(BOT.name);
  const book = async () => parse(await readFile(path.join(home, 'sessions.yaml'), 'utf8')) ?? {};

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
    // Orca's sidebar keeps a deleted project's row until its window is rebuilt (#343).
    if (deleted > 0 && !(await reloadWindow())) t.diagnostic(RELOAD_LINE);
    assert.deepEqual(foreign, [], `tabs this test did not create are open at its homes, so it closed only its own and left those projects and ${bots} in place`);
    await removeBotsFolderAndSiblings(bots);

    const { closedNotOurs, goneElsewhere } = guard.verdict(before.handles);
    assert.deepEqual(closedNotOurs, [], 'this test closed tabs it did not create');
    if (goneElsewhere.length > 0) t.diagnostic(`tabs open before this test and closed elsewhere meanwhile: ${goneElsewhere.join(', ')}`);
    for (const each of homes) {
      assert.deepEqual(await terminalsAfterClosing(each, [...closed, ...guard.closed()]), [], `this test left tabs behind in ${each}`);
    }
    assert.deepEqual(failedDeletes, [], 'projects this test could not remove, left in Orca');
  });

  // 1. A throwaway fleet: one Claude bot with two sessions, brought up by this
  //    checkout, so each tab's step gives its session a real Run.
  obkJson(withBotFatherOff(['init', '--bots', bots, '--harness', 'claude']));
  obkJson(['bot', 'create', '--bots', bots, '--name', BOT.name, '--harness', 'claude', '--charter', `${BOT.display} exists for one system test run and owns nothing.`]);
  for (const name of ['daily', 'night']) {
    obkJson(['session', 'add', '--bots', bots, '--bot', BOT.name, '--name', name, '--prompt=You are a system test\'s bot and own nothing. Do not run any command or use any tool. Say nothing and wait.', ...RC_OFF]);
  }
  const up = obkJson(['up', '--bots', bots, '--bot', BOT.name]);
  const daily = tabOf(up, 'daily');
  const night = tabOf(up, 'night');
  assert.equal(daily.created, true);
  assert.equal(night.created, true);
  const run = (await book()).sessions?.night?.mailbox;
  assert.match(String(run), /^run_/, `the premise: night's step gave it a Run, got: ${JSON.stringify((await book()).sessions?.night)}`);
  assert.equal(orca(['orchestration', 'run-show', '--id', run]).ok, true, `the premise: Orca has ${run}`);
  assert.deepEqual(lettersIn(run), [], `the premise: night's Run holds no letter yet`);
  lookAt(daily.title, daily.terminal, home);
  lookAt(night.title, night.terminal, home);

  // 2. Night's own tab is closed, by its handle. The part only a live run
  //    shows: the real Orca's listing stops listing it.
  const closing = orca(['terminal', 'close', '--terminal', night.terminal, '--tab']);
  assert.equal(closing.ok, true, `closing night's own tab ${night.terminal} failed: ${JSON.stringify(closing.error)}`);
  const left = await terminalsAfterClosing(home, [night.terminal], SETTLE_MS);
  assert.ok(!left.some((terminal) => terminal.handle === night.terminal || terminal.tabId === night.tabId), `Orca still lists night's closed tab ${night.tabId} after ${SETTLE_MS}ms: ${JSON.stringify(left)}`);
  assert.equal((await book()).sessions?.night?.tab, night.tabId, 'the book still names the tab that was closed');

  const starts = spellingsOf(cliEntry).flatMap((cli) => spellingsOf(bots).map((folder) => `${cli} up --bots ${folder} --bot ${BOT.name} --session night`));
  const toArgs = ['message', 'to', '--bots', bots, '--to', `${BOT.name}/night`, '--from', `${BOT.name}/daily`];

  // Claude to Claude in one approval class is native only while the receiver
  // is listed live (#700); with its tab closed it goes by the mailbox. Claude
  // Code's registry may take a moment to drop the closed tab's process.
  const asked = await until(
    `message to ${BOT.name}/night to take the Orca road once its tab is closed`,
    SETTLE_MS,
    async () => {
      const answer = obkJson(toArgs);
      return answer.transport === 'orca' ? answer : undefined;
    },
  );

  // 3. message to and message send, with --json and plain.
  assert.equal(asked.address, `run:${run}`, `the address is night's Run, got: ${JSON.stringify(asked)}`);
  assert.equal(asked.noOpenTab, true, `message to: noOpenTab: true, got: ${JSON.stringify(asked)}`);
  assert.ok(starts.includes(asked.start), `message to: start is the kit's up of night, one of:\n${starts.join('\n')}\ngot: ${JSON.stringify(asked.start)}`);
  const toLine = assertSaysNoOpenTab('message to', obkPlain(toArgs).stdout, starts);
  t.diagnostic(`message to said: ${toLine.trim()}`);

  const sendArgs = (body) => ['message', 'send', '--bots', bots, '--to', `${BOT.name}/night`, '--from', `${BOT.name}/daily`, '--subject', SUBJECT, '--text', body];
  const sent = obkJson(sendArgs(BODIES[0]));
  assert.equal(sent.sent, true, `message send: sent: true, got: ${JSON.stringify(sent)}`);
  assert.equal(sent.address, `run:${run}`, `by the same road as before, to night's Run, got: ${JSON.stringify(sent)}`);
  assert.equal(sent.noOpenTab, true, `message send: noOpenTab: true, got: ${JSON.stringify(sent)}`);
  assert.ok(starts.includes(sent.start), `message send: start is the kit's up of night, got: ${JSON.stringify(sent.start)}`);
  const sentPlain = obkPlain(sendArgs(BODIES[1])).stdout;
  const sendLine = assertSaysNoOpenTab('message send', sentPlain, starts);
  assert.doesNotMatch(sentPlain, /notice tells it to look/i, `with no tab there is no notice to claim, got:\n${sentPlain}`);
  t.diagnostic(`message send said: ${sendLine.trim()}`);

  // Both letters are in night's Run, as the real Orca has them, and unread.
  const letters = lettersIn(run);
  const ours = letters.filter((one) => one.subject === SUBJECT);
  assert.equal(ours.length, 2, `both letters are in night's Run ${run}, got: ${JSON.stringify(letters.map((one) => ({ id: one.id, subject: one.subject, read: one.read, created_at: one.created_at })))}`);
  assert.deepEqual(ours.map((one) => one.read), [0, 0], `and both are unread, got: ${JSON.stringify(ours.map((one) => one.read))}`);
  const times = letters.map((one) => Date.parse(one.created_at));
  assert.ok(times.every(Number.isFinite), `the premise: Orca gives each letter a created_at, got: ${JSON.stringify(letters.map((one) => one.created_at))}`);
  const deletes = new Date(Math.max(...times) + 24 * 60 * 60 * 1000).toISOString();
  t.diagnostic(`night's Run ${run} holds ${letters.length} letters; the newest was written ${new Date(Math.max(...times)).toISOString()}, so Orca may delete them from ${deletes}`);

  // 4. Health names night: kind mail, its Run, at least 2 unread letters, and
  //    the newest letter's created_at plus 24 hours.
  const health = obkJson(['health', '--bots', bots], [1]);
  const healthPlain = obkPlain(['health', '--bots', bots], [1]);
  const mine = (health.found ?? []).filter((one) => one.kind === 'mail' && one.where === run);
  assert.equal(mine.length, 1, `one finding of kind mail, where ${run}, got: ${JSON.stringify(health.found, null, 2)}`);
  const [finding] = mine;
  assert.equal(finding.bot, BOT.name, `about ${BOT.name}, got: ${JSON.stringify(finding)}`);
  assert.ok(hasWord(finding.says, 'night'), `it names the session, got: ${finding.says}`);
  assert.match(finding.says, NO_OPEN_TAB_WORDS, `it says night has no open tab, got: ${finding.says}`);
  assert.match(finding.says, /\bat least 2 unread letters\b/i, `at least 2 unread letters, got: ${finding.says}`);
  assert.match(finding.says, /\bOrca 1\.4\.262\b/, `it names Orca 1.4.262, got: ${finding.says}`);
  assert.ok(finding.says.includes(deletes), `from ${deletes}, the newest letter's created_at as Orca gave it and 24 hours, got: ${finding.says}`);
  assert.ok(givesStart(finding.says, starts), `and the kit's up of night, got: ${finding.says}`);
  assert.ok(healthPlain.stdout.replace(/\s+/g, ' ').includes(finding.says.replace(/\s+/g, ' ').trim()), `the plain report says what the JSON says, got:\n${healthPlain.stdout}`);
  for (const [name, text] of [['--json', `${health.stdout}${health.stderr}`], ['plain', `${healthPlain.stdout}${healthPlain.stderr}`]]) {
    for (const secret of [SUBJECT, ...BODIES]) assert.ok(!text.includes(secret), `the ${name} health report shows ${secret}, a letter's subject or body:\n${text}`);
  }
  t.diagnostic(`health said: ${finding.says}`);

  // Daily's tab is looked at once more before the end; night's is closed.
  lookAt(daily.title, daily.terminal, home);
});
