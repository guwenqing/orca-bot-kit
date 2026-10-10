// A system test: a temporary session makes one of its own on another harness,
// answers its first-run screens, and both go when the first is retired (#464,
// the issue's live check). Against the real Orca, a real Claude Code and a
// real Codex on this machine. Run it alone with
// `npm run test:system -- --yes test/system/temp-of-temp.test.js`; `npm test`
// cannot, and no CI machine could.
//
// What it proves, in a throwaway fleet:
//
//   1. A long-lived Claude Code session, lead, makes a Claude Code temporary
//      session, dev, with `obk temp make`.
//   2. From dev's tab, `obk temp make --harness codex` makes a Codex temporary
//      session, review: the book records it `temporary: { maker: dev }`, and it
//      takes nothing of dev's but its approval (#238).
//   3. dev answers review's first-run screens: the hooks review through the
//      kit's `obk temp trust-hooks`, run from dev's tab, and whatever else the
//      screen table (SETUP.md step 5) has a row for, with the table's key, until
//      the kit's hook has told the book review's conversation.
//   4. lead runs `obk temp retire --name dev` from its tab, and both go, review
//      with dev: their tabs closed in Orca, off bot.yaml, their book entries on
//      the retired list with their makers (dev's lead, review's dev), their
//      start-prompt files beside the bots folder gone, and the answer's
//      `retiredWith` names review, made by dev. lead stays.
//
// "From a session's tab" is how the kit finds a caller: by `ORCA_TAB_ID`,
// matched against the tab the book records (#250). The test runs this
// checkout's CLI with that tab's id and handle and none of the ORCA_ or OBK_
// variables of wherever the test itself was started, so the caller is the
// session whose tab it names. Both callers are Claude Code sessions, for which
// the kit asks no more than that (a Codex caller needs the kit's launch line
// in its environment as well, #408). Neither Claude Code session is asked to
// do anything: the commands a maker would run are run for it, so the test
// spends no Claude turn, and nothing types into lead's or dev's tab.
//
// Codex is launched with this test's folder trusted at launch, tooltips off
// and its sleep tool off (helpers/codex-trust.js, `hooks: false`), and without
// the hooks bypass, so that the hooks review is shown and its maker has to
// answer it, which is the point. Trust all and continue makes Codex write a
// `[hooks.state."…"]` key under this test's folder into ~/.codex/config.toml.
// The runner removes keys a run added under its own folders, from that file
// and from ~/.claude.json alike, and fails a run whose Codex wrote keys unless
// the test is one of its known writers (scripts/test-system.js,
// KNOWN_WRITERS); this one is listed there, so its key is named and removed
// and does not fail the run (#464). Codex's one turn, on its start prompt, is
// told to do nothing.
//
// The machine it runs on is someone's working machine. So this test, like the
// ones beside it: works in a throwaway bots folder under the system temp
// directory; writes down every terminal and workspace Orca already had; runs
// this checkout's `src/cli.js` by its full path, never the machine's `obk`
// (#220); types only into review's tab, its own; closes only its own tabs,
// through the tab guard, and deletes its own workspaces, whatever happened.
// `orca terminal close --worktree … --all` is never run, and the guard refuses
// it. Each run leaves the fleet's orchestration Runs behind, which Orca offers
// no way to delete; the runner lists them.
//
// **It is attended, lightly.** lead's and dev's tabs and Bot Father's show
// Claude Code's folder trust; nothing here waits on them, so leave them. A
// screen in review's tab that the test does not know stops it with the screen,
// and nothing is typed into it. It takes a few minutes.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry } from '../helpers/cli.js';
import { codexTrustArgs } from '../helpers/codex-trust.js';
import { questionOn } from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { deleteOwnProject } from '../helpers/own-project.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/**
 * Remove the throwaway bots folder and everything the kit made beside it:
 * `<bots>.prompts`, `<bots>.locks` and the rest are siblings of it (PRD 6.3).
 */
async function removeBotsFolderAndSiblings(bots) {
  const parent = path.dirname(bots);
  const mine = path.basename(bots);
  const ours = async () => (await readdir(parent)).filter((name) => name === mine || name.startsWith(`${mine}.`));

  for (const name of await ours()) {
    await rm(path.join(parent, name), { recursive: true, force: true });
  }
  assert.deepEqual(await ours(), [], `this test left folders behind in ${parent}`);
}

/** The Orca CLI that works for a normal user (tech notes, section 1). */
const ORCA = process.env.OBK_ORCA || '/Applications/Orca.app/Contents/Resources/bin/orca';

/** How long a tab is given to show its next screen. */
const READY_MS = 180000;

/** How long a real harness is given for its turn, and the kit's hook to report it. */
const ANSWER_MS = 240000;

/** How long a screen is given to move on after its answer. */
const MOVE_MS = 30000;

/** How long the tab is given to take a key before the next one. */
const KEY_GAP_MS = 1000;

const BOT = 'nest-bot';
const LEAD = 'lead';
const DEV = 'dev';
const REVIEW = 'review';

/**
 * Each temporary session's task: long enough that the kit keeps it in a file
 * beside the bots folder, so the file's going can be seen, and asking for
 * nothing.
 */
const TASK = 'You are a system test\'s session and you own nothing. Do not run any command, read or write any file,'
  + ' or use any tool. Say nothing now and wait. '
  + 'This session exists only to be made and retired by the test that made it. '.repeat(6);

/** Every close goes through the guard, which counts it for the check at the end (#246). */
const guard = tabGuard(ORCA);
const { orca } = guard;

/** Every terminal Orca knows about right now. */
function allTerminals() {
  const answer = orca(['terminal', 'list']);
  assert.equal(answer.ok, true, `orca terminal list failed: ${JSON.stringify(answer.error)}`);
  return answer.result.terminals;
}

/** The terminals in one workspace, by the path they were opened in. */
const terminalsAt = (home) => allTerminals().filter((terminal) => terminal.worktreePath === home);

/** The tabs Orca lists at `home` once it has caught up with what was closed (#187). */
async function terminalsAfterClosing(home, closed, within = 5000) {
  const until = Date.now() + within;
  let left = terminalsAt(home);
  while (left.some((terminal) => closed.includes(terminal.handle)) && Date.now() < until) {
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

/**
 * The environment of wherever this test was started, without anything that
 * names an Orca tab or the kit's launch line: the test may itself run in an
 * Orca tab, and a command of the kit's must not take that tab for its caller.
 */
const outsideAnyTab = Object.fromEntries(Object.entries(process.env)
  .filter(([name]) => !name.startsWith('ORCA_') && name !== 'OBK_CLI' && name !== 'OBK_TAB_SHELL'));

/** What a command run in a session's tab sees of it: the tab's id, as the book holds it, and its handle. */
const inTab = ({ tabId, handle }) => ({ ...outsideAnyTab, ORCA_TAB_ID: tabId, ORCA_TERMINAL_HANDLE: handle });

/**
 * Run this checkout's `obk`, by its full path (#217, #220), outside any tab
 * unless `env` says which.
 */
function obk(args, env = outsideAnyTab) {
  const done = spawnSync(process.execPath, [cliEntry, ...args], { encoding: 'utf8', cwd: os.tmpdir(), env });
  assert.equal(done.error, undefined, `could not run \`obk\`: ${done.error?.message}`);
  assert.ok(!/worktree/i.test(done.stdout + done.stderr), `obk said "worktree": ${done.stdout}${done.stderr}`);
  return done;
}

/** Run `obk ... --json` and read the answer it printed; every tab it says it opened is counted as this test's. */
function obkJson(args, env) {
  const done = obk([...args, '--json'], env);
  assert.equal(done.status, 0, `obk ${args.join(' ')} failed: ${done.stdout}${done.stderr}`);
  try {
    return guard.openedByKit(JSON.parse(done.stdout));
  } catch {
    assert.fail(`obk ${args.join(' ')} --json did not print JSON: ${done.stdout}`);
  }
}

/** The one tab an `obk --json` answer says it opened. */
function openedIn(answer, what) {
  const found = (answer.tabs ?? []).filter((entry) => entry.created === true);
  assert.equal(found.length, 1, `${what} should have opened one tab, got: ${JSON.stringify(answer.tabs)}`);
  return found[0];
}

/** The bot's book as it stands. */
const bookOf = (home) => parse(readFileSync(path.join(home, 'sessions.yaml'), 'utf8')) ?? {};

/** What the book says about one of the bot's sessions right now. */
const sessionIn = (home, name) => bookOf(home).sessions?.[name] ?? {};

/** The names of the bot's sessions in bot.yaml right now. */
const sessionsInBotYaml = (home) => (parse(readFileSync(path.join(home, 'bot.yaml'), 'utf8'))?.sessions ?? []).map((one) => one?.name);

/** One session's start-prompt file, beside the bots folder. */
const promptFileOf = (bots, name) => path.join(`${bots}.prompts`, `${BOT}.${name}.txt`);

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

/** The rows the tab renders right now, or undefined when Orca gives no rendered screen. */
function rowsOf(handle) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  const shown = answer.ok === true ? answer.result?.terminal : undefined;
  return shown?.source === 'screen' && Array.isArray(shown.tail) ? shown.tail : undefined;
}

/** What the tab is showing, for the message of a wait that ran out. */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  return `${blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`}`
    + `\n  orca terminal read --terminal ${handle} --screen\n  ${(rowsOf(handle) ?? ['(no rendered screen)']).join('\n  ')}`;
}

/** Send keys into the test's own tab exactly as given, with no `--enter`. */
function sendKeys(handle, keys) {
  const sent = orca(['terminal', 'send', '--terminal', handle, '--text', keys]);
  assert.equal(sent.ok, true, `sending ${JSON.stringify(keys)} into ${handle} failed: ${JSON.stringify(sent.error)}.${whatIsUp(handle)}`);
}

/** The question up in the tab now, as its rows, or undefined when none is up (the suite's shared look). */
function questionIn(handle) {
  const rows = rowsOf(handle);
  return rows === undefined ? undefined : questionOn(rows);
}

/** The choice the selection is on: the label of the lowest `›` row that starts a numbered choice. */
function selectionIn(question) {
  const row = question.findLast((one) => /^\s*›\s*\d+\.\s+\S/.test(one));
  return row === undefined ? undefined : row.replace(/^\s*›\s*\d+\.\s+/, '').split(/\s{2,}/)[0].trim();
}

/** The Codex screens the table has a row for, as codex-first-run-screens.test.js knows them. */
const SCREENS = {
  trust: { name: 'directory trust', choices: /\b(?:Trust and continue|Yes, continue)\b/, takes: /^(?:Trust and continue|Yes, continue)\b/ },
  hooks: { name: 'Hooks need review', choices: /\bTrust all and continue\b|\bReview hooks\b/ },
  update: { name: 'update offer', choices: /\bUpdate now\b/ },
};

/** Which of them the question on screen is, by its choices, or null for one the test does not know. */
const kindOf = (question) => Object.keys(SCREENS).find((kind) => question.some((row) => SCREENS[kind].choices.test(row))) ?? null;

/** Give the kit's own account of tabs it closed to the guard: a retire's `closed`, as an array of `{ terminal }`. */
function closedByKit(entries) {
  if (Array.isArray(entries)) guard.closedByKit(entries);
}

test('a Claude temporary session makes a Codex one of its own, answers its first-run screens, and both are gone when it is retired', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-temp-of-temp-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', BOT].map(homeOf);
  const home = homeOf(BOT);

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    // Only this test's own tabs are closed. A tab it did not create at one of
    // its homes is not its to close: that project and the bots folder stay
    // where they are, and the test fails naming the tab (review of PR #425).
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

  // ---------------------------------------------------------------------------
  // The fleet: Bot Father, and nest-bot on Claude Code with one long-lived
  // session, lead.
  obkJson(['init', '--bots', bots, '--harness', 'claude']);
  obkJson([
    'bot', 'create', '--bots', bots, '--name', BOT, '--harness', 'claude',
    '--charter', `${BOT} exists for one system test run and owns nothing.`,
  ]);
  obkJson(['session', 'add', '--bots', bots, '--bot', BOT, '--name', LEAD, '--prompt', 'You are a system test\'s session and you own nothing. Say nothing and wait.']);
  const leadTab = openedIn(obkJson(['up', '--bots', bots, '--bot', BOT]), 'up');
  const lead = { tabId: sessionIn(home, LEAD).tab, handle: leadTab.terminal };
  assert.equal(typeof lead.tabId, 'string', `the premise: the book holds lead's tab, got: ${JSON.stringify(sessionIn(home, LEAD))}`);

  // 1. lead makes dev, on its own Claude Code.
  const devMade = obkJson(['temp', 'make', '--bots', bots, '--name', DEV, '--prompt', TASK], inTab(lead));
  assert.equal(devMade.maker, LEAD, `dev is lead's: ${JSON.stringify(devMade)}`);
  const dev = { tabId: sessionIn(home, DEV).tab, handle: openedIn(devMade, 'temp make of dev').terminal };
  assert.equal(sessionIn(home, DEV).temporary?.maker, LEAD, `the book has dev as lead's: ${JSON.stringify(sessionIn(home, DEV))}`);

  // 2. dev makes review, on Codex, from its own tab.
  const reviewMade = obkJson([
    'temp', 'make', '--bots', bots, '--name', REVIEW, '--prompt', TASK, '--harness', 'codex',
    ...codexTrustArgs(bots, { hooks: false }),
  ], inTab(dev));
  assert.equal(reviewMade.maker, DEV, `review is dev's: ${JSON.stringify(reviewMade)}`);
  const review = { tabId: sessionIn(home, REVIEW).tab, handle: openedIn(reviewMade, 'temp make of review').terminal };
  assert.equal(sessionIn(home, REVIEW).temporary?.maker, DEV, `the book has review as dev's: ${JSON.stringify(sessionIn(home, REVIEW))}`);
  const reviewEntry = (parse(readFileSync(path.join(home, 'bot.yaml'), 'utf8'))?.sessions ?? []).find((one) => one?.name === REVIEW);
  assert.equal(reviewEntry?.harness, 'codex', `review runs on Codex: ${JSON.stringify(reviewEntry)}`);
  for (const setting of ['model', 'effort', 'context']) {
    assert.equal(reviewEntry[setting], undefined, `review takes no ${setting} of dev's Claude Code (#238): ${JSON.stringify(reviewEntry)}`);
  }
  for (const name of [DEV, REVIEW]) {
    assert.ok(existsSync(promptFileOf(bots, name)), `the premise: ${name}'s start prompt is in ${promptFileOf(bots, name)}, or its going proves nothing`);
  }

  // 3. dev answers review's first-run screens: the hooks review through the
  // kit's command from its own tab, anything else the table has a row for with
  // the table's key, until the kit's hook has told the book review's
  // conversation. A screen the table does not know gets nothing.
  const answered = [];
  await until(
    'review\'s Codex to be past its first-run screens, with its conversation in the book',
    READY_MS + ANSWER_MS,
    async () => {
      if (typeof sessionIn(home, REVIEW).session === 'string') return true;
      const question = questionIn(review.handle);
      if (question === undefined) return undefined;
      const kind = kindOf(question);
      if (kind === null) assert.fail(`a question the screen table does not know is up in review's tab, and nothing was typed into it.${whatIsUp(review.handle)}`);
      if (kind === 'hooks') {
        const trusted = obk(['temp', 'trust-hooks', '--bots', bots, '--name', REVIEW], inTab(dev));
        assert.equal(trusted.status, 0, `dev's temp trust-hooks for review should answer its hooks review:\n${trusted.stdout}${trusted.stderr}`);
      } else if (kind === 'update') {
        // Never Update now: it would update this machine's Codex.
        sendKeys(review.handle, '\x1b');
      } else {
        const on = selectionIn(question);
        assert.ok(on !== undefined && SCREENS.trust.takes.test(on), `before the return on ${SCREENS.trust.name}, the selection should be on what the table takes, and is on ${JSON.stringify(on ?? null)}. Nothing was sent.${whatIsUp(review.handle)}`);
        sendKeys(review.handle, '\r');
      }
      answered.push(SCREENS[kind].name);
      await setTimeout(KEY_GAP_MS);
      await until(`${SCREENS[kind].name} to move on`, MOVE_MS, async () => {
        const now = questionIn(review.handle);
        return now === undefined || kindOf(now) !== kind ? true : undefined;
      }, () => whatIsUp(review.handle));
      return undefined;
    },
    () => `${answered.length === 0 ? ' Nothing was answered yet.' : ` Answered so far: ${answered.join(', ')}.`}${whatIsUp(review.handle)}`,
  );
  t.diagnostic(`review's screens answered for dev: ${answered.length === 0 ? 'none came up' : answered.join(', ')}`);
  assert.ok(answered.includes(SCREENS.hooks.name), `the hooks review came up and dev answered it with temp trust-hooks; answered: ${JSON.stringify(answered)}`);

  // 4. lead retires dev, from its tab, and review goes with it.
  const retired = obkJson(['temp', 'retire', '--bots', bots, '--name', DEV], inTab(lead));
  closedByKit(retired.closed);
  for (const entry of retired.retiredWith ?? []) closedByKit(entry.closed);
  assert.equal(retired.session, DEV, `the answer names dev: ${JSON.stringify(retired)}`);
  assert.deepEqual(
    (retired.retiredWith ?? []).map((one) => [one.bot, one.session, one.maker]),
    [[BOT, REVIEW, DEV]],
    `retiredWith names review, dev's: ${JSON.stringify(retired)}`,
  );

  const left = await terminalsAfterClosing(home, [dev.handle, review.handle]);
  assert.deepEqual(
    left.filter((one) => [dev.handle, review.handle].includes(one.handle)).map((one) => one.handle),
    [],
    'dev\'s and review\'s tabs are closed in Orca',
  );
  assert.ok(left.some((one) => one.handle === lead.handle), 'and lead\'s is still open');
  assert.deepEqual(sessionsInBotYaml(home), [LEAD], 'bot.yaml has lead, and neither dev nor review');
  const book = bookOf(home);
  assert.deepEqual(Object.keys(book.sessions ?? {}), [LEAD], `the book's live list has lead alone: ${JSON.stringify(Object.keys(book.sessions ?? {}))}`);
  for (const [name, maker] of [[DEV, LEAD], [REVIEW, DEV]]) {
    const entries = (book.retired ?? []).filter((one) => one?.name === name);
    assert.equal(entries.length, 1, `one retired entry for ${name}: ${JSON.stringify(book.retired)}`);
    assert.equal(entries[0].temporary?.maker, maker, `${name}'s retired entry still names its maker, ${maker}: ${JSON.stringify(entries[0])}`);
    assert.equal(existsSync(promptFileOf(bots, name)), false, `${name}'s start-prompt file is gone`);
  }
});
