// A system test: a book whose mailbox Run this Orca does not have, against the
// real Orca on this machine (issue #508). Run it with `npm run test:system`;
// `npm test` cannot, and no CI machine could.
//
// A fleet moved to a new machine keeps its books, and each book's `mailbox:`
// names a Run that only the old machine's Orca had. The launch line's mailbox
// step bound that Run, the new Orca refused it, and every start failed the same
// way. Since #508 the step asks `run-show`, and when Orca says the Run is not
// found it makes a new Run in the tab and writes it into the book; `obk health`
// names such a session and the restart that heals it.
//
// The fake proves the rules (test/mailbox-run-gone.test.js,
// test/health-mailbox-gone.test.js). This proves the one thing it cannot: that
// the real Orca refuses `run-show` of a Run it never made with `run_not_found`,
// as its bundle reads, so the kit really replaces it, and the new Run is really
// bound to the session's new tab. The machine move is played by writing a
// made-up Run id, one Orca never made, into the book.
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
// A Run cannot be deleted: Orca has no command for it. The Runs this test makes
// are left, as every system test that brings a session up leaves them.
//
// **It is not attended.** A restart closes a tab only when the book names the
// conversation in it, and the kit's hook writes that down once Claude Code is
// past its first-run screens in `Mailbox Gone daily`. By the architect's rule
// for every live run here, the test answers those itself, in its own tab, and
// only through the allowlists in helpers/screens.js, as mail-one-signal.test.js
// does (`answerScreens`):
//
//   - Claude Code's folder trust, once for this bot's folder, only when it is
//     the plain one for that folder (`onlyPlainTrustOf`): down and return, with
//     no `--enter`; then the trust rows go, or the test fails.
//   - Claude Code's "Teach auto mode about your environment?" form, at most
//     once, only when it is the captured form (`onlyTeachFormOf`): Esc; then
//     the form goes and ~/.claude.json's autoModeEnvSetup stays as it was, or
//     the test fails.
//
// Any other question on the screen (`questionOn`) stops the run, with the
// screen in the failure message; it is never answered. The new tab after the
// restart is the same folder and should ask nothing; it is looked at the same
// way. `Bot Father daily` sits on its own trust question and is left alone.
// Nothing is asked of any agent. A few minutes.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse, parseDocument } from 'yaml';

import { cliEntry, spellingsOf } from '../helpers/cli.js';
import { onlyPlainTrustOf, onlyTeachFormOf, questionOn } from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { deleteOwnProject } from '../helpers/own-project.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/** The Orca CLI that works for a normal user (tech notes, section 1). */
const ORCA = process.env.OBK_ORCA || '/Applications/Orca.app/Contents/Resources/bin/orca';

/** How long the session is given to be past its first-run screens and have the kit's hook write the book. */
const HOOK_MS = 180000;

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
    return guard.openedByKit(JSON.parse(done.stdout));
  } catch {
    assert.fail(`obk ${args.join(' ')} --json did not print JSON: ${done.stdout}`);
  }
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

/** What the tab is showing, for the message of a wait that ran out. */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  return `${blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`}\n  orca terminal read --terminal ${handle} --screen\n    ${(rowsOf(handle) ?? ['(unreadable)']).join('\n    ')}`;
}

/** The title of Claude Code's "Teach auto mode" form (#416), as helpers/screens.js has it. */
const TEACH_TITLE = 'Teach auto mode about your environment?';

/** ~/.claude.json's autoModeEnvSetup, which only the Teach form's accept path changes (tech notes, section 1). */
function autoModeState() {
  try {
    const held = JSON.parse(readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8')).autoModeEnvSetup;
    return held === undefined ? 'absent' : JSON.stringify(held);
  } catch (error) {
    return `unreadable (${error.message})`;
  }
}

/** The bot folders whose Claude folder trust this test answered, and the tabs whose Teach form it answered. */
const answered = { trust: new Set(), teach: new Set() };

/**
 * One look at a tab's own first-run screens, as mail-one-signal.test.js has
 * it: the plain folder trust of `home` answered once, the captured Teach form
 * answered at most once with Esc, and any other question a failure with the
 * screen in it. Never answered by hand.
 */
async function answerScreens(t, title, handle, home) {
  const rows = rowsOf(handle);
  if (rows === undefined) return;

  if (rows.some((row) => row.includes('Yes, I trust this folder'))) {
    assert.ok(!answered.trust.has(home), `${title} asked Claude Code's folder trust for ${home} again, which this test answered once and answers no more:\n    ${rows.join('\n    ')}`);
    const wrong = onlyPlainTrustOf(rows, home);
    assert.equal(wrong, undefined, `${title}'s folder trust is not one this test may answer, so it answered nothing: ${wrong}.\n  what it showed:\n    ${rows.join('\n    ')}`);
    const sent = orca(['terminal', 'send', '--terminal', handle, '--text', '\x1b[B\r']);
    assert.equal(sent.ok, true, `answering ${title}'s folder trust failed: ${JSON.stringify(sent.error)}`);
    answered.trust.add(home);
    await until(`${title}'s folder trust to go after it was answered`, 15000, async () => ((rowsOf(handle) ?? []).some((row) => row.includes('Yes, I trust this folder')) ? undefined : true), () => whatIsUp(handle));
    t.diagnostic(`answered ${title}'s plain folder trust`);
    return;
  }

  if (rows.some((row) => row.trim() === TEACH_TITLE)) {
    assert.ok(!answered.teach.has(handle), `the Teach form came up again in ${title}, and this test answers it at most once:\n    ${rows.join('\n    ')}`);
    const wrong = onlyTeachFormOf(rows);
    assert.equal(wrong, undefined, `${title}'s Teach form is not the captured one, so this test answered nothing: ${wrong}.\n  what it showed:\n    ${rows.join('\n    ')}`);
    const was = autoModeState();
    const sent = orca(['terminal', 'send', '--terminal', handle, '--text', '\x1b']);
    assert.equal(sent.ok, true, `answering ${title}'s Teach form with Esc failed: ${JSON.stringify(sent.error)}`);
    answered.teach.add(handle);
    await until(`${title}'s Teach form to go after Esc`, 15000, async () => ((rowsOf(handle) ?? []).some((row) => row.trim() === TEACH_TITLE) ? undefined : true), () => whatIsUp(handle));
    await setTimeout(2000);
    const now = autoModeState();
    assert.equal(now, was, `Esc on ${title}'s Teach form taught nothing: ~/.claude.json's autoModeEnvSetup should be as it was (before: ${was}, after: ${now})`);
    t.diagnostic(`answered ${title}'s Teach form with Esc; it went, and ~/.claude.json's autoModeEnvSetup stayed ${was}`);
    return;
  }

  const question = questionOn(rows);
  assert.equal(question, undefined, `${title} shows a screen this test does not know, and it answers nothing; the run stops here:\n    ${rows.join('\n    ')}`);
}

/** Whether `word` is in `text` as a word of its own, not inside another. */
const hasWord = (text, word) => new RegExp(`(^|[^A-Za-z0-9_-])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9_-])`).test(text);

/** The findings that name `what` as a word of its own. */
const naming = (answer, what) => (answer.found ?? []).filter((one) => hasWord(`${one.where} ${one.says}`, what));

/** A Run id Orca never made: the shape Orca gives its own, with random digits. */
const madeUpRun = () => `run_${randomBytes(6).toString('hex')}`;

/** Remove the throwaway bots folder and every `<bots>.*` the kit made beside it (PRD 6.3). */
async function removeBotsFolderAndSiblings(bots) {
  const parent = path.dirname(bots);
  const mine = path.basename(bots);
  const ours = async () => (await readdir(parent)).filter((name) => name === mine || name.startsWith(`${mine}.`));
  for (const name of await ours()) await rm(path.join(parent, name), { recursive: true, force: true });
  assert.deepEqual(await ours(), [], `this test left folders behind in ${parent}`);
}

const BOT = { name: 'mailbox-gone', display: 'Mailbox Gone' };

test('a mailbox Run this Orca never made is named by health, and the restart it names gives the session a new Run bound to its new tab', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-mailbox-gone-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', BOT.name].map(homeOf);
  const home = homeOf(BOT.name);
  const bookFile = path.join(home, 'sessions.yaml');
  const book = async () => parse(await readFile(bookFile, 'utf8')) ?? {};

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
    // Orca's sidebar keeps a deleted project's row until its window is rebuilt (#343).
    if (deleted > 0 && !(await reloadWindow())) t.diagnostic(RELOAD_LINE);
    assert.deepEqual(foreign, [], `tabs this test did not create are open at its homes, so it closed only its own and left those projects and ${bots} in place`);
    await removeBotsFolderAndSiblings(bots);

    const { closedNotOurs, goneElsewhere } = guard.verdict(before.handles);
    assert.deepEqual(closedNotOurs, [], 'this test closed tabs it did not create');
    if (goneElsewhere.length > 0) t.diagnostic(`tabs open before this test and closed elsewhere meanwhile: ${goneElsewhere.join(', ')}`);
    for (const each of homes) {
      assert.deepEqual(await terminalsAfterClosing(each, closed), [], `this test left tabs behind in ${each}`);
    }
    assert.deepEqual(failedDeletes, [], 'projects this test could not remove, left in Orca');
  });

  // 1. A throwaway fleet with one Claude session, brought up by this checkout,
  //    so its tab's step gives it a real mailbox.
  obkJson(['init', '--bots', bots, '--harness', 'claude']);
  obkJson(['bot', 'create', '--bots', bots, '--name', BOT.name, '--harness', 'claude', '--charter', `${BOT.display} exists for one system test run and owns nothing.`]);
  obkJson(['session', 'add', '--bots', bots, '--bot', BOT.name, '--name', 'daily', '--prompt=You are a system test\'s bot and own nothing. Do not run any command or use any tool. Say nothing and wait.']);
  const opened = tabOf(obkJson(['up', '--bots', bots, '--bot', BOT.name]), 'daily');
  assert.equal(opened.created, true);
  const real = (await book()).sessions?.daily?.mailbox;
  assert.match(String(real), /^run_/, `the premise: the step gave the session a Run, got: ${JSON.stringify((await book()).sessions?.daily)}`);
  assert.equal(orca(['orchestration', 'run-show', '--id', real]).ok, true, `the premise: Orca has ${real}`);

  // The restart below closes the tab only when the book names its conversation,
  // which the kit's hook writes once Claude Code is past its first-run screens.
  // Those are answered here, through the allowlists, and nowhere else.
  await until(
    `${BOT.name}'s hook to write its conversation into the book`,
    HOOK_MS,
    async () => {
      const id = (await book()).sessions?.daily?.session;
      if (id !== undefined) return id;
      await answerScreens(t, opened.title, opened.terminal, home);
      return undefined;
    },
    () => whatIsUp(opened.terminal),
  );

  // 2. The machine move: a Run id Orca never made, written into the session's
  //    `mailbox:` with every other key and the book's comments kept, and a
  //    retired entry with a made-up mailbox of its own.
  const gone = madeUpRun();
  const refused = orca(['orchestration', 'run-show', '--id', gone]);
  assert.equal(refused.ok, false, `the premise: Orca never made ${gone}, got: ${JSON.stringify(refused)}`);
  assert.equal(refused.error?.code, 'run_not_found', `and says so in the code the kit acts on, got: ${JSON.stringify(refused.error)}`);
  const doc = parseDocument(await readFile(bookFile, 'utf8'));
  doc.setIn(['sessions', 'daily', 'mailbox'], gone);
  const retired = [...(doc.toJS().retired ?? []), { name: 'old', mailbox: madeUpRun(), retired: '2026-09-30T08:00:00.000Z' }];
  doc.set('retired', retired);
  await writeFile(bookFile, String(doc));
  const moved = await book();
  assert.equal(moved.sessions.daily.mailbox, gone);

  // 3. Health names the session, the made-up Run and the restart.
  const said = naming(obkJson(['health', '--bots', bots], [1]), gone);
  assert.equal(said.length, 1, `one finding names ${gone}, got: ${JSON.stringify(said, null, 2)}`);
  const [finding] = said;
  assert.equal(finding.kind, 'session', `a finding about a session, got: ${JSON.stringify(finding)}`);
  assert.equal(finding.bot, BOT.name);
  assert.ok(hasWord(finding.says, 'daily'), `naming the session, got: ${finding.says}`);
  assert.ok(spellingsOf(cliEntry).some((cli) => finding.says.includes(`${cli} restart `)), `the command is this checkout's CLI running restart, got: ${finding.says}`);
  assert.ok(spellingsOf(bots).some((word) => finding.says.includes(`--bots ${word}`)), `naming the bots folder, got: ${finding.says}`);
  assert.ok(hasWord(finding.says, `--bot ${BOT.name} --session daily`), `naming the bot and the session, got: ${finding.says}`);

  // 4. The restart it names. The new tab's step finds Orca does not have the
  //    Run, makes a new one there, and writes it into the book.
  const restarted = obkJson(['restart', '--bots', bots, '--bot', BOT.name, '--session', 'daily']);
  guard.closedByKit(restarted.closed);
  const back = tabOf(restarted, 'daily');
  assert.equal(back.created, true, 'a new tab was opened for it');
  // The same folder, trusted a moment ago, so it should ask nothing. It is
  // looked at for ten seconds all the same, and answered the same way.
  for (const stop = Date.now() + 10000; Date.now() < stop;) {
    await answerScreens(t, back.title, back.terminal, home);
    await setTimeout(2000);
  }

  const after = await book();
  const now = after.sessions?.daily?.mailbox;
  assert.match(String(now), /^run_/, `the book names a Run, got: ${JSON.stringify(after.sessions?.daily)}`);
  assert.notEqual(now, gone, 'a new one, not the made-up one');
  assert.equal(after.sessions.daily.tab, back.tabId, 'and the new tab');
  const shown = orca(['orchestration', 'run-show', '--id', now]);
  assert.equal(shown.ok, true, `Orca has the new Run ${now}, got: ${JSON.stringify(shown)}`);
  assert.equal(shown.result.run.coordinator_handle, back.terminal, 'bound to the session\'s new tab');
  assert.deepEqual(after.retired, moved.retired, 'the retired entries are as they were');

  // What the step printed went to the tab before Claude Code took the screen,
  // so it may or may not still be in what Orca can read; said, not failed.
  const stream = orca(['terminal', 'read', '--terminal', back.terminal]);
  const text = JSON.stringify(stream.result ?? {});
  t.diagnostic(text.includes(gone) && text.includes(now)
    ? `the tab shows the step's line naming ${gone} and ${now}`
    : `the step's line is no longer in what Orca reads of ${back.terminal}; the book and run-show above are the proof`);

  // And health no longer names it.
  assert.deepEqual(naming(obkJson(['health', '--bots', bots], [0, 1]), gone), [], `health no longer names ${gone}`);
});
