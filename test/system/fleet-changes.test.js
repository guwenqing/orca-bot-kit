// A system test: changing, pausing and retiring a bot through the kit's own
// commands, against the real Orca and the real Claude Code on this machine. Run
// it with `npm run test:system`; `npm test` cannot, and no CI machine could.
//
// PRD 3.2 says the user asks Bot Father to change, pause or retire bots and
// sessions, and issue #158 gave that regular business commands, so the book and
// the fleet stay in step without anybody editing a file. What a fake Orca cannot
// prove is the part that is Orca's: that a pause really takes the tab away, that
// an unpause really brings the session back into a tab of its own, and that a
// retired bot really leaves no project and no tab behind. So this runs the
// commands Bot Father would run, in order, and after each one asks Orca, the
// book and `obk` itself what is now true.
//
// Whether the conversation that comes back is the one that went is proved in
// `restart.test.js`, with a passphrase only that conversation holds; an unpause
// hands the harness the same resume, so here it is enough that the book still
// holds the id and the run says it resumed it.
//
// The machine it runs on is someone's working machine, with their own tabs open.
// So this test, like the ones beside it: works in a throwaway bots folder under
// the system temp directory; writes down every terminal and workspace Orca
// already had before it creates anything; touches only what it created, matched
// by handle and by workspace path; closes its own tabs one by one and then
// deletes its own workspaces, in that order; and checks afterwards that every
// terminal that was there before is still there. `orca terminal close
// --worktree … --all` is never run, and the helper below refuses to run it.
//
// **It is attended**, for one screen: Claude Code's folder-trust list in the
// `Fleet Claude daily` tab, which takes a down-arrow and then return. The book
// learns the session's id only once that is answered, and a pause will not close
// a tab whose conversation the book cannot name. After the unpause the same
// folder is trusted and the session should come straight up. Leave `Bot Father
// daily` on its own trust question: nothing is asked of it here.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry } from '../helpers/cli.js';

/**
 * Remove the throwaway bots folder and everything the kit made beside it.
 *
 * `<bots>.prompts`, where a session's start prompt goes, and `<bots>.locks`,
 * where the book's writers take their turn, are **siblings** of the bots folder
 * and not children of it (PRD 6.3 keeps kit-made folders out of the user's
 * repo), so a teardown that removes `<bots>` alone leaves them on the disk of
 * whoever ran the test. Everything the kit puts beside it is named the same
 * way, so this takes the folder and every `<bots>.*` next to it, and then says
 * so if one is still there.
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

/**
 * How long the kit's hook is given to have written the book after a session
 * starts. Long, because a person answers the folder-trust screen first.
 */
const HOOK_MS = 180000;

/** Ask Orca something and read its JSON. Never the blanket close, on any road. */
function orca(args) {
  assert.ok(
    !(args.includes('--all') && args.includes('close')),
    `refusing to run \`orca ${args.join(' ')}\`: it would take away someone else's tabs`,
  );
  const done = spawnSync(ORCA, [...args, '--json'], { encoding: 'utf8' });
  assert.equal(done.error, undefined, `could not run ${ORCA}: ${done.error?.message}`);
  let answer;
  try {
    answer = JSON.parse(done.stdout);
  } catch {
    assert.fail(`orca ${args.join(' ')} did not answer JSON: ${done.stdout}${done.stderr}`);
  }
  return answer;
}

/** Every terminal Orca knows about right now. */
function allTerminals() {
  const answer = orca(['terminal', 'list']);
  assert.equal(answer.ok, true, `orca terminal list failed: ${JSON.stringify(answer.error)}`);
  return answer.result.terminals;
}

/** The terminals in one workspace, by the path they were opened in. */
const terminalsAt = (home) => allTerminals().filter((terminal) => terminal.worktreePath === home);

/**
 * The tabs Orca lists at `home` once it has caught up with what was closed.
 * `terminal close` answers ok before `terminal list` stops reporting the tab —
 * seen live, for a second or two on a busy machine — so the listing is read
 * again until the closed tabs are out of it, rather than read once and believed.
 *
 * By handle: a raw listing can show a tab under `pty:<ptyId>` rather than its
 * id while Orca calls it orphaned, and the handle is the same either way (#187).
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

/** Every workspace Orca knows about right now. */
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
  // The owner reads this output. Orca's word for a workspace must not be in it.
  assert.ok(!/worktree/i.test(done.stdout + done.stderr), `obk said "worktree": ${done.stdout}${done.stderr}`);
  return done;
}

/** Run `obk ... --json` and read the answer it printed. */
function obkJson(args) {
  const done = obk([...args, '--json']);
  assert.equal(done.status, 0, `obk ${args.join(' ')} failed: ${done.stdout}${done.stderr}`);
  try {
    return JSON.parse(done.stdout);
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

/** What the book says about one session right now. */
async function sessionIn(home, name) {
  const book = parse(await readFile(path.join(home, 'sessions.yaml'), 'utf8')) ?? {};
  return book.sessions?.[name] ?? {};
}

/**
 * Keep asking until `look` gives something other than undefined, or the time
 * runs out. `note` is added to the message when it does, so a run left alone
 * says which screen was waiting rather than only that it waited.
 */
async function until(what, within, look, note = () => '') {
  const stop = Date.now() + within;
  for (;;) {
    const found = await look();
    if (found !== undefined) return found;
    assert.ok(Date.now() < stop, `gave up waiting for ${what} after ${within}ms.${note()}`);
    await setTimeout(1000);
  }
}

/** Everything the tab is rendering right now, as one piece of text to look through. */
function screenOf(handle) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  return answer.ok === true ? JSON.stringify(answer.result) : '';
}

/**
 * What the tab is showing, for the message of a wait that ran out: Orca's own
 * word for whatever is waiting to be answered when it gave one, and then the
 * screen itself, which is the only thing that catches the rest.
 */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  return [
    blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`,
    ' This test answers nothing a tab asks; answer it in Orca and run again.',
    `\n  orca terminal read --terminal ${handle} --screen\n  ${screenOf(handle).slice(0, 2000)}`,
  ].join('');
}


/** The bot: one Claude session with a short duty. */
const BOT = { name: 'fleet-claude', display: 'Fleet Claude' };

/** The roster entry for one bot, or undefined when the roster has none. */
const rosterOf = (bots, name) => obkJson(['roster', '--bots', bots]).roster.find((entry) => entry.bot === name);

test('a bot is changed, paused, brought back and retired through the kit\'s commands alone', async (t) => {
  // Before a person is asked to answer anything: the CLI has to know the
  // commands at all.
  for (const command of ['pause', 'retire']) {
    const knows = obk([command]);
    assert.ok(
      !/there is no ".*" command/.test(knows.stderr),
      `this \`obk\` has no ${command} command yet, so there is nothing live to check: ${knows.stderr}`,
    );
  }

  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-fleet-')));
  const home = path.join(bots, 'bots', BOT.name);
  const homes = [path.join(bots, 'bots', 'bot-father'), home];

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    const closed = [];
    for (const each of homes) {
      for (const terminal of terminalsAt(each)) {
        if (before.handles.has(terminal.handle)) continue;
        orca(['terminal', 'close', '--terminal', terminal.handle, '--tab']);
        closed.push(terminal.handle);
      }
    }
    for (const setup of allSetups()) {
      if (!homes.includes(setup.path) || before.setups.has(setup.id)) continue;
      orca(['project', 'setup-delete', '--setup', setup.id]);
    }
    await removeBotsFolderAndSiblings(bots);

    const left = new Set(allTerminals().map((terminal) => terminal.handle));
    for (const handle of before.handles) {
      assert.ok(left.has(handle), `${handle} was open before this test and is gone now`);
    }
    for (const each of homes) {
      assert.deepEqual(await terminalsAfterClosing(each, closed), [], `this test left tabs behind in ${each}`);
    }
  });

  obkJson(['init', '--bots', bots, '--harness', 'claude']);
  obkJson([
    'bot', 'create', '--bots', bots, '--name', BOT.name, '--harness', 'claude',
    '--charter', `${BOT.display} exists for one system test run and owns nothing.`,
  ]);
  obkJson([
    'session', 'add', '--bots', bots, '--bot', BOT.name, '--name', 'daily',
    '--prompt=You are a system test\'s bot. Do not run anything or use any tool. Say nothing and wait.',
  ]);

  const opened = tabOf(obkJson(['up', '--bots', bots, '--bot', BOT.name]), 'daily');
  assert.equal(opened.harnessStarted, true, `no claude came up in ${opened.title}:${whatIsUp(opened.terminal)}`);
  const id = await until(
    `${BOT.name} to report its session id`,
    HOOK_MS,
    async () => (await sessionIn(home, 'daily')).session,
    () => ` The kit's hook has not run.${whatIsUp(opened.terminal)}`,
  );

  // Changed: the charter reaches AGENTS.md, a setting reaches bot.yaml, and the
  // running tab is left alone.
  obkJson(['bot', 'change', '--bots', bots, '--bot', BOT.name, '--charter', `${BOT.display} now owns one changed charter.`]);
  assert.ok((await readFile(path.join(home, 'AGENTS.md'), 'utf8')).includes('now owns one changed charter'));
  obkJson(['session', 'change', '--bots', bots, '--bot', BOT.name, '--session', 'daily', '--effort', 'low']);
  const card = rosterOf(bots, BOT.name);
  assert.equal(card.sessions.find((session) => session.name === 'daily').effort, 'low');
  const still = terminalsAt(home);
  assert.ok(
    still.some((terminal) => terminal.handle === opened.terminal),
    `a change closes nothing: ${opened.terminal} should still be listed at ${home}, got: ${JSON.stringify(still)}`,
  );

  // Paused: the tab is gone from Orca, the book keeps the conversation, `up`
  // leaves it closed and health does not call it lost.
  const paused = obkJson(['pause', '--bots', bots, '--bot', BOT.name]);
  assert.deepEqual(paused.closed.map((tab) => tab.tabId), [opened.tabId]);
  assert.deepEqual(await terminalsAfterClosing(home, [opened.terminal]), [], 'the paused bot has no tab in Orca');
  assert.equal(rosterOf(bots, BOT.name).paused, true);
  assert.equal((await sessionIn(home, 'daily')).session, id, 'the book keeps the conversation');
  const upAgain = obkJson(['up', '--bots', bots]);
  assert.equal(upAgain.tabs.filter((tab) => tab.bot === BOT.name).length, 0, 'up opens nothing for a paused bot');
  assert.deepEqual(terminalsAt(home), []);
  const health = obk(['health', '--bots', bots, '--bot', BOT.name, '--json']);
  const found = JSON.parse(health.stdout).found.filter((one) => one.bot === BOT.name);
  assert.deepEqual(found, [], `health has nothing to say about a paused bot, got: ${JSON.stringify(found)}`);

  // Unpaused: a new tab, told to resume the conversation the book held.
  const unpaused = obkJson(['unpause', '--bots', bots, '--bot', BOT.name]);
  const back = tabOf(unpaused, 'daily');
  assert.equal(back.created, true);
  assert.equal(back.resumed, true, 'the session comes back with its conversation');
  assert.equal(back.harnessStarted, true, `no claude came up in ${back.title}:${whatIsUp(back.terminal)}`);
  assert.notEqual(rosterOf(bots, BOT.name).paused, true);

  // Retired: no tab, no Orca project, the folder in retired/ with its book, and
  // nothing left for health to find.
  const retired = obkJson(['retire', '--bots', bots, '--bot', BOT.name]);
  assert.deepEqual(retired.closed.map((tab) => tab.tabId), [back.tabId]);
  await terminalsAfterClosing(home, [back.terminal]);
  assert.ok(!allSetups().some((setup) => setup.path === home), 'the bot\'s Orca project is gone');
  const archived = parse(await readFile(path.join(bots, 'retired', BOT.name, 'sessions.yaml'), 'utf8'));
  assert.ok(typeof archived.sessions?.daily?.session === 'string', 'the retired bot keeps its book');
  assert.equal(rosterOf(bots, BOT.name), undefined, 'the roster no longer knows it');
  const after = JSON.parse(obk(['health', '--bots', bots, '--json']).stdout).found;
  assert.deepEqual(
    after.filter((one) => JSON.stringify(one).includes(BOT.name)),
    [],
    'health finds nothing the retired bot left behind',
  );
});
