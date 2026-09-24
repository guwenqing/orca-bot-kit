// A system test: `obk health` against the real Orca on this machine. Run it
// with `npm run test:system`; `npm test` cannot, and no CI machine could.
//
// Three of the health check's findings are about the world outside the kit, and
// a fake Orca proves none of them:
//
//   1. A session the book knows that Orca does not. Orca is asked what tabs it
//      has; a tab the person closed is simply not in the answer, and the book
//      still names it (ADR 0012). Here the tab is really closed, through Orca.
//   2. An Orca project no book owns. Orca keeps its own record of every folder
//      it has been given, and a bot folder that goes away does not take that
//      record with it. Here the folder really goes away.
//   3. Orca's own per-agent default launch arguments. The kit reads them out of
//      Orca's profile settings file under the home directory, and when they
//      carry a permission bypass every session Orca relaunches or resumes runs
//      in that mode whatever the kit asked for (PRD 6.5). Here the real file is
//      read — by the kit, and separately by this test, which then holds the kit
//      to what the file actually says. The test never writes to it and never
//      assumes which way round it is: on a machine with harmless arguments
//      recorded it proves the kit says nothing, and on a machine with a bypass
//      it proves the kit says so.
//
// Everything else the check finds is proved against the fake in
// `test/health.test.js`, which is where the wording, the shape and the rule
// that the command writes nothing at all are pinned. This file is only the part
// that needs the real Orca.
//
// The machine it runs on is someone's working machine, with their own tabs
// open. So this test, like the ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory;
//   - writes down every terminal and Orca project Orca already had, before it
//     creates anything;
//   - touches only what it created, matched by handle and by project path;
//   - closes its own tabs one by one (`--terminal <handle> --tab`) and then
//     deletes its own Orca projects — that order, because a project deleted
//     first leaves tabs no command line can reach;
//   - checks afterwards that every terminal that was there before is still
//     there.
//
// `orca terminal close --worktree … --all` is never run here, and the helper
// below refuses to run it at all.
//
// It is short: two Orca projects, two tabs, no question put to any agent, and
// no waiting on one. Under a minute.
//
// **It is attended, but it asks nothing of you.** `obk init` opens Bot Father's
// two tabs and types Claude Code into the first of them, so on a folder nobody
// has opened before you will see Claude Code's folder-trust list come up in
// `Bot Father daily`. This test answers it — like every test in `test/system/`
// — not at all, and does not need it answered: what it needs is that the tab
// existed and that the book wrote its id down, and the test then closes that
// tab itself. The second tab, `Bot Father ops`, is a plain shell and asks
// nothing. The bot called `gone-bot` opens no tab at all: it has no sessions,
// so bringing it up makes its Orca project and stops there, which is exactly
// the leftover this test is about. Both tabs are closed and both Orca projects
// deleted when the test ends, however it ends.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';

import { cliEntry } from '../helpers/cli.js';

/** The Orca CLI that works for a normal user (tech notes, section 1). */
const ORCA = process.env.OBK_ORCA || '/Applications/Orca.app/Contents/Resources/bin/orca';

/** Where Orca keeps its own settings, one folder per profile. */
const ORCA_PROFILES = path.join(os.homedir(), 'Library', 'Application Support', 'orca', 'profiles');

/**
 * What a permission bypass is spelled on each harness (PRD 6.5, and Orca's own
 * defaults). These are the two arguments that take the approval level out of
 * the kit's hands whatever a session asked for.
 */
const BYPASS = {
  claude: '--dangerously-skip-permissions',
  codex: '--dangerously-bypass-approvals-and-sandbox',
};

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

/** The terminals in one Orca project, by the path it was opened at. */
const terminalsAt = (home) => allTerminals().filter((terminal) => terminal.worktreePath === home);

/**
 * The tabs Orca lists at `home` once it has caught up with what was closed.
 * `terminal close` answers ok before `terminal list` stops reporting the tab,
 * so the listing is read again until the closed tabs are out of it rather than
 * read once and believed.
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
  // The owner reads this output. Orca's word for a workspace must not be in it.
  assert.ok(!/worktree/i.test(done.stdout + done.stderr), `obk said "worktree": ${done.stdout}${done.stderr}`);
  return done;
}

/** Run `obk ... --json`, expect `status`, and read the answer it printed. */
function obkJson(args, status = 0) {
  const done = obk([...args, '--json']);
  assert.equal(done.status, status, `obk ${args.join(' ')} should have exited ${status}: ${done.stdout}${done.stderr}`);
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

/** Everything one finding puts in front of a reader. */
const wordsOf = (finding) => `${finding.where} ${finding.says}`;

/** The findings of one kind. */
const kindOf = (answer, kind) => (answer.found ?? []).filter((one) => one.kind === kind);

/**
 * What Orca's own settings say the default launch arguments are, read straight
 * off this machine. Read only: this file is Orca's and the kit never writes it,
 * and neither does this test.
 *
 * One profile is the ordinary case and the one the tech notes recorded
 * (`local-default`). A machine with several is not something to guess at, so it
 * says so rather than picking one and reporting whatever follows from that.
 */
async function recordedLaunchArgs() {
  let entries = [];
  try {
    entries = await readdir(ORCA_PROFILES, { withFileTypes: true });
  } catch (error) {
    assert.fail(`could not read Orca's profiles at ${ORCA_PROFILES} (${error.code}), so this test cannot say what Orca's settings hold`);
  }

  const files = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(ORCA_PROFILES, entry.name, 'orca-data.json');
    try {
      files.push({ file, settings: JSON.parse(await readFile(file, 'utf8')) });
    } catch {
      // A profile folder with no readable settings in it is not this machine's
      // settings; only one that has them counts.
    }
  }

  assert.equal(
    files.length,
    1,
    `this machine has ${files.length} Orca profiles with settings in them under ${ORCA_PROFILES}`
    + ', and the test cannot say which one Orca is running on. Look at it before trusting this run.',
  );
  return { file: files[0].file, args: files[0].settings?.settings?.agentDefaultArgs };
}

/**
 * Whether what Orca records for a harness is a bypass. A harness with no string
 * recorded for it is one too: Orca then starts it with its own built-in
 * default, and that default is the bypass argument itself.
 */
const isBypass = (recorded, harness) => typeof recorded !== 'string' || recorded.includes(BYPASS[harness]);

/**
 * Remove the throwaway bots folder and everything the kit made beside it.
 * `<bots>.prompts` and `<bots>.locks` are siblings of the bots folder and not
 * children of it (PRD 6.3), so a teardown that removes `<bots>` alone leaves
 * the kit's folders on the disk of whoever ran the test.
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

test('health reports a tab Orca has lost, an Orca project no bot owns, and what Orca launches with', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-health-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', 'gone-bot'].map(homeOf);

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    const closed = [];
    for (const home of homes) {
      for (const terminal of terminalsAt(home)) {
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

    // The point of all the care above: everything that was open is still open.
    const left = new Set(allTerminals().map((terminal) => terminal.handle));
    for (const handle of before.handles) {
      assert.ok(left.has(handle), `${handle} was open before this test and is gone now`);
    }
    for (const home of homes) {
      assert.deepEqual(await terminalsAfterClosing(home, closed), [], `this test left tabs behind in ${home}`);
    }
  });

  // Bot Father, really up: an Orca project and two real tabs, one of them with
  // Claude Code typed into it. Nothing here answers what that tab asks.
  const daily = tabOf(obkJson(['init', '--bots', bots, '--harness', 'claude']), 'daily');
  assert.equal(daily.created, true);

  // And a bot with no sessions at all, so bringing it up makes its Orca project
  // and opens nothing. That project is what is about to be left behind.
  obkJson(['bot', 'create', '--bots', bots, '--name', 'gone-bot', '--harness', 'claude']);
  obkJson(['up', '--bots', bots, '--bot', 'gone-bot']);
  assert.ok(
    allSetups().some((setup) => setup.path === homeOf('gone-bot')),
    `Orca should hold a project for ${homeOf('gone-bot')} before this test takes the bot away`,
  );
  assert.deepEqual(terminalsAt(homeOf('gone-bot')), [], 'a bot with no sessions opens no tab');

  // 1. The tab the book knows, closed the way a person closes one.
  orca(['terminal', 'close', '--terminal', daily.terminal, '--tab']);
  const stillOpen = await terminalsAfterClosing(homeOf('bot-father'), [daily.terminal]);
  assert.ok(
    !stillOpen.some((one) => one.handle === daily.terminal),
    `Orca should not have ${daily.terminal} (tab ${daily.tabId}) any more, and has: ${JSON.stringify(stillOpen)}`,
  );
  assert.notEqual(stillOpen.length, 0, 'and Bot Father\'s ops tab is still open, so this is one tab lost and not the project');

  // 2. The bot folder taken away, with Orca's record of it left behind.
  await rm(homeOf('gone-bot'), { recursive: true, force: true });

  // 3. What Orca really launches agents with on this machine, read by the test
  //    itself, so the kit is held to the file rather than to an expectation.
  const recorded = await recordedLaunchArgs();

  const answer = obkJson(['health', '--bots', bots], 1);

  // 1. The session the book holds and Orca has not got.
  const sessions = kindOf(answer, 'session');
  assert.equal(sessions.length, 1, `one session is missing its tab, got: ${JSON.stringify(sessions, null, 2)}`);
  assert.ok(
    wordsOf(sessions[0]).includes(daily.tabId),
    `it should name the tab id the book holds (${daily.tabId}), got: ${JSON.stringify(sessions[0], null, 2)}`,
  );
  assert.ok(
    wordsOf(sessions[0]).includes('daily'),
    `and the session it belongs to, got: ${JSON.stringify(sessions[0], null, 2)}`,
  );

  // 2. The Orca project with no bot behind it any more.
  const leftovers = kindOf(answer, 'leftover');
  assert.ok(
    leftovers.some((one) => wordsOf(one).includes(homeOf('gone-bot'))),
    `Orca still holds a project at ${homeOf('gone-bot')} and no bot is there, got: ${JSON.stringify(leftovers, null, 2)}`,
  );

  // 3. Orca's own default launch arguments, either way round.
  const said = kindOf(answer, 'orca');
  for (const harness of Object.keys(BYPASS)) {
    const about = said.filter((one) => wordsOf(one).includes(harness));
    const what = `${recorded.file} records ${JSON.stringify(recorded.args?.[harness])} for ${harness}`;
    if (isBypass(recorded.args?.[harness], harness)) {
      assert.equal(about.length, 1, `${what}, which is a bypass, so it should be reported once, got: ${JSON.stringify(said, null, 2)}`);
      assert.ok(
        wordsOf(about[0]).includes(BYPASS[harness]),
        `and say which argument to change, got: ${JSON.stringify(about[0], null, 2)}`,
      );
    } else {
      assert.deepEqual(about, [], `${what}, which carries no bypass, so there is nothing to say about it`);
    }
  }
});
