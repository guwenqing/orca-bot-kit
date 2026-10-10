// A system test: temporary sessions made from roles in bot.yaml run on the
// model and effort their role's option names (#465, the issue's live check).
// Against the real Orca, a real Claude Code and a real Codex on this machine.
// Run it alone with `npm run test:system -- --yes test/system/temp-roles.test.js`;
// `npm test` cannot, and no CI machine could.
//
// What it proves, in a throwaway fleet:
//
//   1. A long-lived Claude Code session, lead, on a bot whose bot.yaml offers
//      two roles in `temp_roles`: developer, whose one option names a Claude
//      model and effort and no harness (so it is lead's Claude Code), and
//      reviewer, whose one option names harness codex, a Codex model and an
//      effort.
//   2. From lead's tab, `obk temp make --role developer --name 1` and
//      `obk temp make --role reviewer:sol --name 1`, each told to do nothing,
//      make developer-1 and reviewer-1. Neither command names a model or an
//      effort. The book records each with its maker, role and option.
//   3. Each runs on its option's model and effort, as its own record shows:
//      developer-1's Claude Code transcript, every assistant line of its own
//      (`message.model`, `effort`), and reviewer-1's Codex rollout, its latest
//      `turn_context` (helpers/codex-rollout.js `turnSettingsIn`). Only those
//      fields are read, never what was said. And `obk health --json`, which
//      reads the same records, says both settings match bot.yaml for each.
//   4. lead retires both with `obk temp retire` from its tab: their tabs closed
//      in Orca, off bot.yaml, on the book's retired list with their role.
//
// The models are ones the other system tests run on and found not to be this
// machine's defaults, so a launch line that dropped them would show:
// claude-sonnet-5 at medium (groom.test.js: a full id, as the transcript
// records it, and not haiku, since a haiku session given an effort records
// none, tech notes section 2), and gpt-6-sol at low (codex-groom-run.test.js:
// Codex's own default here is gpt-6-astra).
//
// "From a session's tab" is how the kit finds a caller: by `ORCA_TAB_ID`,
// matched against the tab the book records (#250). The test runs this
// checkout's CLI with lead's tab id and handle and none of the ORCA_ or OBK_
// variables of wherever the test itself was started. lead is a Claude Code
// session, for which the kit asks no more than that (#408). lead is asked to do
// nothing: the commands it would run are run for it, and nothing types into its
// tab.
//
// Two turns are spent, one per made session, each on its start prompt, which
// tells it to do nothing: a record names a model and an effort only once a turn
// has run.
//
// The screens. developer-1's tab shows Claude Code's folder trust for the bot
// home; this test answers it itself, `\x1b[B\r` as one payload, and only when
// it is the plain one for that folder (helpers/screens.js `onlyPlainTrustOf`,
// the ruling on #451), as send-outside-fleet does. Claude Code then records the
// folder in ~/.claude.json, and the runner takes that key out again (#240).
// reviewer-1's Codex is given its folder's trust and the hooks bypass at launch,
// tooltips off and its sleep tool off (helpers/codex-trust.js), through
// `--extra-arg` on the make, so it asks neither of its first-run screens and
// writes nothing into ~/.codex/config.toml; this test is not one of the
// runner's KNOWN_WRITERS and needs not be. A Codex update offer is dismissed
// with Esc, never taken. Any other screen in a made session's tab stops the
// test with the screen, and nothing is typed into it.
//
// The machine it runs on is someone's working machine. So this test, like the
// ones beside it: works in a throwaway bots folder under the system temp
// directory; writes down every terminal and workspace Orca already had; runs
// this checkout's `src/cli.js` by its full path, never the machine's `obk`
// (#220); types only into developer-1's and reviewer-1's tabs, its own; closes
// only its own tabs, through the tab guard, and deletes its own workspaces,
// whatever happened. `orca terminal close --worktree … --all` is never run, and
// the guard refuses it. Each run leaves the fleet's orchestration Runs behind,
// which Orca offers no way to delete; the runner lists them. Claude Code's and
// Codex's own records of the throwaway folder are read, never written, and stay
// under ~/.claude/projects and ~/.codex/sessions afterwards, as every system
// test's do.
//
// **It is attended, lightly.** lead's tab and Bot Father's show Claude Code's
// folder trust; nothing here waits on them, so leave them. It takes a few
// minutes.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse, stringify } from 'yaml';

import { cliEntry } from '../helpers/cli.js';
import { codexTrustArgs } from '../helpers/codex-trust.js';
import { rolloutFilesOf, turnSettingsIn } from '../helpers/codex-rollout.js';
import { onlyPlainTrustOf, questionOn } from '../helpers/screens.js';
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

/** How long a real harness is given for its turn, and its record to show it. */
const ANSWER_MS = 240000;

/** How long a screen is given to move on after its answer. */
const MOVE_MS = 30000;

const BOT = 'role-bot';
const LEAD = 'lead';

/** The Claude role's option: a full model id, as the transcript records it, and an effort; not this machine's defaults. */
const CLAUDE_MODEL = 'claude-sonnet-5';
const CLAUDE_EFFORT = 'medium';

/** The Codex role's option: a model that is not this machine's Codex default, at an effort that is not Codex's. */
const CODEX_MODEL = 'gpt-6-sol';
const CODEX_EFFORT = 'low';

/** The roles, as the user writes them into bot.yaml. */
const ROLES = {
  developer: [
    { name: 'standard', model: CLAUDE_MODEL, effort: CLAUDE_EFFORT, for: 'most issues' },
  ],
  reviewer: {
    options: [
      { name: 'sol', harness: 'codex', model: CODEX_MODEL, effort: CODEX_EFFORT, for: 'most reviews' },
    ],
  },
};

const DEVELOPER = 'developer-1';
const REVIEWER = 'reviewer-1';

/** Each made session's task: asking for nothing. */
const TASK = 'You are a system test\'s session and you own nothing. Do not run any command, read or write any file,'
  + ' or use any tool. Say nothing now and wait.';

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

/** The bot's bot.yaml as it stands. */
const botYamlOf = (home) => parse(readFileSync(path.join(home, 'bot.yaml'), 'utf8')) ?? {};

/** One session's entry in bot.yaml, or undefined. */
const entryIn = (home, name) => (botYamlOf(home).sessions ?? []).find((one) => one?.name === name);

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

/** Where Claude Code keeps the conversations it had in one folder (tech notes, section 2). */
const transcriptsOf = (home) => path.join(os.homedir(), '.claude', 'projects', home.replaceAll(/[^A-Za-z0-9]/g, '-'));

/** One conversation's transcript, whole lines only, a JSON object per line; none when it has no file yet. */
function claudeLinesOf(home, id) {
  if (typeof id !== 'string') return [];
  const file = path.join(transcriptsOf(home), `${id}.jsonl`);
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8');
  return text.slice(0, text.lastIndexOf('\n') + 1).split('\n').flatMap((raw) => {
    try {
      return raw.trim() === '' ? [] : [JSON.parse(raw)];
    } catch {
      return [];
    }
  });
}

/** The session's own calls: assistant lines that are not a subagent's or Claude Code's synthetic ones. */
const ownCallsIn = (lines) => lines.filter((line) => line.type === 'assistant' && line.isSidechain !== true && line.message?.model !== '<synthetic>');

/** Where Codex keeps its rollouts (tech notes, section 3). */
const CODEX_SESSIONS = path.join(os.homedir(), '.codex', 'sessions');

/** Give the kit's own account of tabs it closed to the guard: a retire's `closed`, as an array of `{ terminal }`. */
function closedByKit(entries) {
  if (Array.isArray(entries)) guard.closedByKit(entries);
}

test('temporary sessions made from a Claude role and a Codex role run on the model and effort their option names, as their own records show', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-temp-roles-')));
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
  // 1. The fleet: Bot Father, and role-bot on Claude Code with one long-lived
  // session, lead, and the two roles written into its bot.yaml by hand, as the
  // user would.
  obkJson(['init', '--bots', bots, '--harness', 'claude']);
  obkJson([
    'bot', 'create', '--bots', bots, '--name', BOT, '--harness', 'claude',
    '--charter', `${BOT} exists for one system test run and owns nothing.`,
  ]);
  obkJson(['session', 'add', '--bots', bots, '--bot', BOT, '--name', LEAD, '--prompt', 'You are a system test\'s session and you own nothing. Say nothing and wait.']);
  const leadTab = openedIn(obkJson(['up', '--bots', bots, '--bot', BOT]), 'up');
  const lead = { tabId: sessionIn(home, LEAD).tab, handle: leadTab.terminal };
  assert.equal(typeof lead.tabId, 'string', `the premise: the book holds lead's tab, got: ${JSON.stringify(sessionIn(home, LEAD))}`);
  const doc = botYamlOf(home);
  doc.temp_roles = ROLES;
  writeFileSync(path.join(home, 'bot.yaml'), stringify(doc));
  const leadEntry = entryIn(home, LEAD);
  for (const setting of ['model', 'effort']) {
    assert.equal(leadEntry?.[setting], undefined, `the premise: lead names no ${setting}, so only the role can give one: ${JSON.stringify(leadEntry)}`);
  }

  // ---------------------------------------------------------------------------
  // 2a. lead makes developer-1 from the Claude role, naming no model or effort.
  const devMade = obkJson(['temp', 'make', '--bots', bots, '--role', 'developer', '--name', '1', '--prompt', TASK], inTab(lead));
  assert.equal(devMade.session, DEVELOPER, `--role developer --name 1 makes ${DEVELOPER}: ${JSON.stringify(devMade)}`);
  assert.equal(devMade.maker, LEAD, `${DEVELOPER} is lead's: ${JSON.stringify(devMade)}`);
  const developer = { handle: openedIn(devMade, `temp make of ${DEVELOPER}`).terminal };
  assert.deepEqual(
    { ...sessionIn(home, DEVELOPER).temporary, made: undefined },
    { maker: LEAD, made: undefined, role: 'developer', option: 'standard' },
    `the book has ${DEVELOPER} as lead's, from developer:standard: ${JSON.stringify(sessionIn(home, DEVELOPER))}`,
  );
  const devEntry = entryIn(home, DEVELOPER);
  assert.deepEqual(
    { harness: devEntry?.harness ?? botYamlOf(home).harness, model: devEntry?.model, effort: devEntry?.effort },
    { harness: 'claude', model: CLAUDE_MODEL, effort: CLAUDE_EFFORT },
    `bot.yaml has ${DEVELOPER} on the option's settings: ${JSON.stringify(devEntry)}`,
  );

  // Its folder trust, which this test answers itself, once, and only when it
  // is the plain one for the bot home (the ruling on #451).
  const asked = await until(
    `${DEVELOPER} to show Claude Code's folder trust, or report its conversation`,
    READY_MS,
    async () => {
      if (typeof sessionIn(home, DEVELOPER).session === 'string') return { rows: null };
      const rows = rowsOf(developer.handle);
      return rows !== undefined && rows.some((row) => row.includes('Yes, I trust this folder')) ? { rows } : undefined;
    },
    () => whatIsUp(developer.handle),
  );
  if (asked.rows !== null) {
    const wrong = onlyPlainTrustOf(asked.rows, home);
    assert.equal(
      wrong,
      undefined,
      `${DEVELOPER}'s folder trust is not one this test may answer, so it answered nothing: ${wrong}.`
      + `\n  what it showed:\n    ${asked.rows.join('\n    ')}`,
    );
    sendKeys(developer.handle, '\x1b[B\r');
    t.diagnostic(`answered ${DEVELOPER}'s plain folder trust (the ruling on #451)`);
  }

  // 3a. Its own record: every call of its own on the option's model and effort.
  const devCalls = await until(
    `${DEVELOPER}'s transcript to hold a call of its own, from its start prompt`,
    ANSWER_MS,
    async () => {
      const calls = ownCallsIn(claudeLinesOf(home, sessionIn(home, DEVELOPER).session));
      return calls.length > 0 ? calls : undefined;
    },
    () => ` The book's entry: ${JSON.stringify(sessionIn(home, DEVELOPER))}.${whatIsUp(developer.handle)}`,
  );
  assert.deepEqual(
    [...new Set(devCalls.map((line) => line.message?.model))],
    [CLAUDE_MODEL],
    `every call of ${DEVELOPER}'s is on the option's model, as its transcript records it`,
  );
  assert.deepEqual(
    [...new Set(devCalls.map((line) => line.effort).filter((effort) => effort !== undefined))],
    [CLAUDE_EFFORT],
    `and records the option's effort, and no other`,
  );

  // ---------------------------------------------------------------------------
  // 2b. lead makes reviewer-1 from the Codex role's named option, naming no
  // model or effort; the trust it is launched with is the test's own.
  const reviewMade = obkJson([
    'temp', 'make', '--bots', bots, '--role', 'reviewer:sol', '--name', '1', '--prompt', TASK,
    ...codexTrustArgs(bots),
  ], inTab(lead));
  assert.equal(reviewMade.session, REVIEWER, `--role reviewer:sol --name 1 makes ${REVIEWER}: ${JSON.stringify(reviewMade)}`);
  assert.equal(reviewMade.maker, LEAD, `${REVIEWER} is lead's: ${JSON.stringify(reviewMade)}`);
  const reviewer = { handle: openedIn(reviewMade, `temp make of ${REVIEWER}`).terminal };
  assert.deepEqual(
    { ...sessionIn(home, REVIEWER).temporary, made: undefined },
    { maker: LEAD, made: undefined, role: 'reviewer', option: 'sol' },
    `the book has ${REVIEWER} as lead's, from reviewer:sol: ${JSON.stringify(sessionIn(home, REVIEWER))}`,
  );
  const reviewEntry = entryIn(home, REVIEWER);
  assert.deepEqual(
    { harness: reviewEntry?.harness, model: reviewEntry?.model, effort: reviewEntry?.effort },
    { harness: 'codex', model: CODEX_MODEL, effort: CODEX_EFFORT },
    `bot.yaml has ${REVIEWER} on the option's Codex settings: ${JSON.stringify(reviewEntry)}`,
  );

  // Its Codex is trusted at launch, so it asks nothing; an update offer is
  // dismissed, never taken, and any other screen stops the test untouched.
  const dismissed = [];
  await until(
    `${REVIEWER}'s Codex to report its conversation`,
    READY_MS,
    async () => {
      if (typeof sessionIn(home, REVIEWER).session === 'string') return true;
      const rows = rowsOf(reviewer.handle);
      const question = rows === undefined ? undefined : questionOn(rows);
      if (question === undefined) return undefined;
      if (!question.some((row) => /\bUpdate now\b/.test(row))) {
        assert.fail(`a question is up in ${REVIEWER}'s tab though its Codex was trusted at launch, and nothing was typed into it.${whatIsUp(reviewer.handle)}`);
      }
      // Never Update now: it would update this machine's Codex.
      sendKeys(reviewer.handle, '\x1b');
      dismissed.push('update offer');
      await until('the update offer to move on', MOVE_MS, async () => {
        const now = rowsOf(reviewer.handle);
        return now === undefined || !(questionOn(now) ?? []).some((row) => /\bUpdate now\b/.test(row)) ? true : undefined;
      }, () => whatIsUp(reviewer.handle));
      return undefined;
    },
    () => ` The book's entry: ${JSON.stringify(sessionIn(home, REVIEWER))}.${whatIsUp(reviewer.handle)}`,
  );
  if (dismissed.length > 0) t.diagnostic(`dismissed in ${REVIEWER}'s tab: ${dismissed.join(', ')}`);

  // 3b. Its own record: the latest turn on the option's model and effort.
  const turn = await until(
    `${REVIEWER}'s rollout to record a turn, from its start prompt`,
    ANSWER_MS,
    async () => {
      const id = sessionIn(home, REVIEWER).session;
      const turns = rolloutFilesOf(CODEX_SESSIONS, id).flatMap((file) => turnSettingsIn(readFileSync(file, 'utf8')));
      return turns.length === 0 ? undefined : turns.sort((left, right) => left.at - right.at).at(-1);
    },
    () => ` The book's entry: ${JSON.stringify(sessionIn(home, REVIEWER))}.${whatIsUp(reviewer.handle)}`,
  );
  assert.deepEqual(
    { model: turn.model, effort: turn.effort },
    { model: CODEX_MODEL, effort: CODEX_EFFORT },
    `${REVIEWER}'s latest turn ran on the option's model and effort, as its rollout records it`,
  );

  // 3c. The kit's own reading of the same records: health finds both settings
  // matching bot.yaml for each. It may find other things in this fleet (the
  // trust lead's and Bot Father's tabs still show), so its exit is not read.
  const health = obk(['health', '--bots', bots, '--bot', BOT, '--json']);
  let report;
  try {
    report = JSON.parse(health.stdout);
  } catch {
    assert.fail(`obk health --json did not print JSON: ${health.stdout}${health.stderr}`);
  }
  for (const [name, model, effort] of [[DEVELOPER, CLAUDE_MODEL, CLAUDE_EFFORT], [REVIEWER, CODEX_MODEL, CODEX_EFFORT]]) {
    const seen = (report.sessions ?? []).find((one) => one.bot === BOT && one.session === name);
    assert.ok(seen, `health reports on ${name}: ${JSON.stringify(report.sessions)}`);
    const judged = (setting) => ({ state: seen.settings?.[setting]?.state, configured: seen.settings?.[setting]?.configured });
    assert.deepEqual(
      { model: judged('model'), effort: judged('effort') },
      { model: { state: 'match', configured: model }, effort: { state: 'match', configured: effort } },
      `health reads ${name}'s record as running on what bot.yaml asks for: ${JSON.stringify(seen)}`,
    );
  }

  // ---------------------------------------------------------------------------
  // 4. lead retires both, from its tab.
  for (const [name, handle] of [[DEVELOPER, developer.handle], [REVIEWER, reviewer.handle]]) {
    const retired = obkJson(['temp', 'retire', '--bots', bots, '--name', name], inTab(lead));
    closedByKit(retired.closed);
    for (const entry of retired.retiredWith ?? []) closedByKit(entry.closed);
    assert.equal(retired.session, name, `the answer names ${name}: ${JSON.stringify(retired)}`);
    const left = await terminalsAfterClosing(home, [handle]);
    assert.equal(left.some((one) => one.handle === handle), false, `${name}'s tab is closed in Orca`);
  }
  assert.ok(terminalsAt(home).some((one) => one.handle === lead.handle), 'and lead\'s is still open');
  assert.deepEqual((botYamlOf(home).sessions ?? []).map((one) => one?.name), [LEAD], 'bot.yaml has lead, and neither made session');
  const book = bookOf(home);
  assert.deepEqual(Object.keys(book.sessions ?? {}), [LEAD], `the book's live list has lead alone: ${JSON.stringify(Object.keys(book.sessions ?? {}))}`);
  for (const [name, role] of [[DEVELOPER, 'developer'], [REVIEWER, 'reviewer']]) {
    const entries = (book.retired ?? []).filter((one) => one?.name === name);
    assert.equal(entries.length, 1, `one retired entry for ${name}: ${JSON.stringify(book.retired)}`);
    assert.deepEqual(
      { maker: entries[0].temporary?.maker, role: entries[0].temporary?.role },
      { maker: LEAD, role },
      `${name}'s retired entry still names its maker and role: ${JSON.stringify(entries[0])}`,
    );
  }
});
