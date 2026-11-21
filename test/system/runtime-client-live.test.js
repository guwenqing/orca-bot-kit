// A system test, and the live check for #844: the kit reaches Orca's runtime
// client where the real Orca on this machine has it. Run it alone with
// `npm run test:system -- --yes test/system/runtime-client-live.test.js`;
// `npm test` cannot, and no CI machine could.
//
// The kit asks Orca's runtime two things through Orca's own runtime client,
// loaded from the installed app and run by the app's binary as plain Node
// (ADR 0057): the window call after a project is made or renamed, and, where
// `ps` cannot run, `terminal.inspectProcess` for who is in front of a tab.
// Until #844 the kit looked for the client at `out/cli/runtime-client.js`,
// which Orca stopped shipping at 1.4.259; both calls failed quietly, and the
// unit tests passed, because the fake Orca had the client at the same wrong
// place. This test fails when the place the kit expects and this machine's
// Orca disagree.
//
// How it reaches the front-process question. The kit reads the process table
// with `/bin/ps` by its fixed path, and asks Orca's runtime only where that
// cannot run, as inside Codex's sandbox. Nothing in the kit's core is added
// for this (core is core, test is test): the test runs `obk health` under
// macOS `sandbox-exec`, with a profile that allows everything except starting
// `/bin/ps`. There `/bin/ps` fails with "Operation not permitted", as it does
// in Codex's sandbox. Health then reads each session's tab through Orca's
// runtime (test/front-without-ps.test.js, F11, has the rule on the fake).
//
// What it proves, in a throwaway fleet of Bot Father alone:
//
//   0. Before anything is made: the profile really stops `/bin/ps`
//      ("Operation not permitted"), and lets another program run. Otherwise
//      the run fails at once, and makes nothing.
//   1. `obk init` brings Bot Father up: its `daily` tab with Claude Code in
//      it. Health, run plainly, with `ps`, says `daily` is running (`yes`).
//      It is read again every 2 s, for READY_MS, until it says so.
//   2. Health run again at once, under the profile. Its answer carries its own
//      finding about `ps` (where `ps`), so the kit really ran without `ps`.
//      Its output does not say that Orca's runtime client is not there
//      (helpers/client-missing.js): the client is where the kit looks. And it
//      says `daily` is running (`yes`), as with `ps`: the kit read the tab
//      through Orca's runtime and got Orca's answer, and did not fall back to
//      "cannot tell" (`unknown`).
//
// What it does NOT prove. The window call (`project.update` with no changes)
// is not checked: its output is the same whether it worked or not (ADR 0057),
// and nothing Orca shows tells whether the window was told. It shares the
// client and its place with the call checked here, so a client the kit cannot
// find shows in step 2 for both. Nor does it judge whether the kit's typing
// gate (`obk message send --interrupt`) passes a tab: that needs a busy
// harness, and test/front-without-ps.test.js holds it on the fake. And it does
// not show that the kit looks at the place for the reason the unit tests pin;
// only that, on this Orca, the runtime answered.
//
// What is printed as diagnostics, not judged: where the installed app keeps
// its client (the new place and the old one, there or not), and every health
// answer.
//
// The machine it runs on is someone's working machine, with their own tabs
// open. So this test, like the ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory;
//   - writes down every terminal and Orca project Orca already had, before it
//     creates anything;
//   - runs this checkout's `src/cli.js` by its full path, never the machine's
//     `obk`;
//   - types into no tab: the only keys that go into a tab are the kit's launch
//     lines;
//   - closes only its own tabs, through the tab guard, then deletes its own
//     Orca projects, in a teardown registered before anything is created;
//   - signals no process. `sandbox-exec` runs in the foreground and ends with
//     the health run it holds.
//
// `orca terminal close --worktree … --all` is never run here, and the guard
// refuses to run it at all. The runner (scripts/test-system.js) backs up
// ~/.claude.json and ~/.codex/config.toml before the run and compares them
// after it.
//
// **Nobody answers anything by hand.** `obk init` types Claude Code into
// `Bot Father daily`, which on a folder nobody has opened before shows Claude
// Code's folder-trust list. This test answers it not at all, as
// test/system/health.test.js does not, and does not need it answered: what it
// needs is Claude Code in front of the tab, and the trust list is Claude Code.
// Nothing is typed into the tab. `Bot Father ops` is a plain shell and asks
// nothing.
//
// The night gate (helpers/system.js) holds: `obk init` makes Bot Father's tabs
// real in the owner's Orca window, so the test runs only in a run that names
// its file, between midnight and 6 am local time. It takes under two minutes.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';

import test from '../helpers/system.js';
import { RUNTIME_CLIENT_IN_CONTENTS, cliEntry } from '../helpers/cli.js';
import { saysClientMissing } from '../helpers/client-missing.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { withBotFatherOff } from '../helpers/remote-control-off.js';
import { deleteOwnProject, placesOf, projectsInBots } from '../helpers/own-project.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/** The Orca CLI that works for a normal user (tech notes, section 1). */
const ORCA = process.env.OBK_ORCA || '/Applications/Orca.app/Contents/Resources/bin/orca';

/** macOS's own sandbox runner, by its fixed path. */
const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

/** The program the kit reads the process table with, by its fixed path. */
const PS = '/bin/ps';

/**
 * A sandbox profile that allows everything except starting `/bin/ps`: what
 * Codex's sandbox does to `ps` (seen live, codex-cli 0.156.1), and nothing
 * else.
 */
const NO_PS = `(version 1)(allow default)(deny process-exec (literal "${PS}"))`;

/** How long Bot Father's daily tab is given to have Claude Code in front, as health with `ps` reads it. */
const READY_MS = 90000;

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
 * The tabs Orca lists at `home` once it has caught up with what was closed.
 * `terminal close` answers ok before `terminal list` stops reporting the tab,
 * so the listing is read again until the closed tabs are out of it.
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
 * Run this checkout's `obk`, by its full path; with `withoutPs`, under the
 * profile that stops `/bin/ps`. The `obk` on PATH is the published release
 * this machine uses, not the code under test (#217).
 */
function obk(args, { withoutPs = false } = {}) {
  const done = withoutPs
    ? spawnSync(SANDBOX_EXEC, ['-p', NO_PS, process.execPath, cliEntry, ...args], { encoding: 'utf8', cwd: os.tmpdir() })
    : spawnSync(process.execPath, [cliEntry, ...args], { encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(done.error, undefined, `could not run \`obk\`: ${done.error?.message}`);
  // The owner reads this output. Orca's word for a workspace must not be in it.
  assert.ok(!/worktree/i.test(done.stdout + done.stderr), `obk said "worktree": ${done.stdout}${done.stderr}`);
  return done;
}

/** Run `obk ... --json`, and read the answer it printed, whatever it exited with. */
function obkAnswer(args, options) {
  const done = obk([...args, '--json'], options);
  try {
    return { done, answer: guard.openedByKit(JSON.parse(done.stdout)) };
  } catch {
    return assert.fail(`obk ${args.join(' ')} --json did not print JSON (exit ${done.status}): ${done.stdout}${done.stderr}`);
  }
}

/** The entry for one tab in an `obk --json` answer. */
function tabOf(answer, name) {
  const found = (answer.tabs ?? []).filter((entry) => entry.name === name);
  assert.equal(found.length, 1, `one entry should be the ${name} tab, got: ${JSON.stringify(answer.tabs)}`);
  return found[0];
}

/** What a health answer says of whether one session's harness is running. */
const runningOf = (answer, bot, session) => (answer.sessions ?? []).find((one) => one.bot === bot && one.session === session)?.running;

/**
 * Remove the throwaway bots folder and everything the kit made beside it.
 * `<bots>.prompts` and `<bots>.locks` are siblings of the bots folder and not
 * children of it (PRD 6.3).
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

test('where ps cannot run, health reads a session\'s tab through Orca\'s runtime client where this Orca has it', async (t) => {
  // 0. The profile stops /bin/ps and nothing else. Checked before anything is made.
  const psDenied = spawnSync(SANDBOX_EXEC, ['-p', NO_PS, PS, '-p', String(process.pid)], { encoding: 'utf8' });
  assert.notEqual(psDenied.status, 0, `the premise: ${PS} must not run under the profile, and it ran: ${psDenied.stdout}${psDenied.stderr}`);
  assert.match(psDenied.stderr, /Operation not permitted/, `the premise: ${PS} is refused as in Codex's sandbox, got: ${psDenied.stderr}`);
  const echoRuns = spawnSync(SANDBOX_EXEC, ['-p', NO_PS, '/bin/echo', 'runs'], { encoding: 'utf8' });
  assert.equal(echoRuns.status, 0, `the premise: another program runs under the profile, got: ${echoRuns.stdout}${echoRuns.stderr}`);
  assert.equal(echoRuns.stdout.trim(), 'runs');

  // Where this machine's Orca keeps its client: printed, not judged.
  const contents = path.resolve(path.dirname(realpathSync(ORCA)), '..', '..');
  const newPlace = path.join(contents, ...RUNTIME_CLIENT_IN_CONTENTS);
  const oldPlace = path.join(contents, 'Resources', 'app.asar.unpacked', 'out', 'cli', 'runtime-client.js');
  t.diagnostic(`Orca's runtime client: ${newPlace} ${existsSync(newPlace) ? 'is there' : 'is not there'}; ${oldPlace} ${existsSync(oldPlace) ? 'is there' : 'is not there'}`);

  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-runtime-client-')));
  const homes = [path.join(bots, 'bots', 'bot-father')];

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    // Only this test's own tabs are closed. A tab it did not create at one of
    // its homes is not its to close: that project and the bots folder stay
    // where they are, and the test fails naming the tab (#426).
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
    // Orca's sidebar keeps a deleted project's row until its window is
    // rebuilt (#343): the kit's own reload, as after a retire.
    if (deleted > 0 && !(await reloadWindow())) t.diagnostic(RELOAD_LINE);
    assert.deepEqual(foreign, [], `tabs this test did not create are open at its homes, so it closed only its own and left those projects and ${bots} in place`);
    await removeBotsFolderAndSiblings(bots);

    // This test closed no tab but its own. A tab open before it and gone now
    // that it did not close was closed by someone else on this shared machine,
    // so that is said, not failed (#246).
    const { closedNotOurs, goneElsewhere } = guard.verdict(before.handles);
    assert.deepEqual(closedNotOurs, [], 'this test closed tabs it did not create');
    if (goneElsewhere.length > 0) t.diagnostic(`tabs open before this test and closed elsewhere meanwhile: ${goneElsewhere.join(', ')}`);
    for (const home of homes) {
      assert.deepEqual(await terminalsAfterClosing(home, closed), [], `this test left tabs behind in ${home}`);
    }
    assert.deepEqual(failedDeletes, [], 'projects this test could not remove, left in Orca');
  });

  // 1. Bot Father, really up: its daily tab with Claude Code typed into it.
  const init = obkAnswer(withBotFatherOff(['init', '--bots', bots, '--harness', 'claude']));
  assert.equal(init.done.status, 0, `obk init should have exited 0: ${init.done.stdout}${init.done.stderr}`);
  assert.equal(tabOf(init.answer, 'daily').created, true, 'init opened Bot Father\'s daily tab');

  // Health with ps, until it finds Claude Code in front of daily.
  const until = Date.now() + READY_MS;
  let plain = obkAnswer(['health', '--bots', bots]);
  while (runningOf(plain.answer, 'bot-father', 'daily') !== 'yes' && Date.now() < until) {
    await setTimeout(2000);
    plain = obkAnswer(['health', '--bots', bots]);
  }
  t.diagnostic(`health with ps: ${JSON.stringify(plain.answer)}`);
  assert.equal(
    runningOf(plain.answer, 'bot-father', 'daily'),
    'yes',
    `the premise: with ps, health finds Claude Code in front of Bot Father's daily tab within ${READY_MS} ms, got: ${JSON.stringify(plain.answer.sessions, null, 2)}`,
  );

  // 2. The same health at once, where /bin/ps cannot run.
  const sandboxed = obkAnswer(['health', '--bots', bots], { withoutPs: true });
  const said = `${sandboxed.done.stdout}${sandboxed.done.stderr}`;
  t.diagnostic(`health without ps (exit ${sandboxed.done.status}): ${said}`);

  assert.ok(
    (sandboxed.answer.found ?? []).some((one) => one.where === 'ps'),
    `the premise: health ran where ps cannot, and says so in its own finding about ps, got: ${JSON.stringify(sandboxed.answer.found, null, 2)}`,
  );
  assert.equal(
    saysClientMissing(said),
    false,
    `the kit says Orca's runtime client is not where it looks: the kit's place and this Orca's layout disagree (${newPlace} ${existsSync(newPlace) ? 'is there' : 'is not there'}), got: ${said}`,
  );
  assert.equal(
    runningOf(sandboxed.answer, 'bot-father', 'daily'),
    'yes',
    'without ps, health reads Bot Father\'s daily tab through Orca\'s runtime and finds Claude Code in front, as with ps;'
    + ` "unknown" is the kit unable to ask Orca's runtime, got: ${JSON.stringify(sandboxed.answer.sessions, null, 2)}`,
  );
});
