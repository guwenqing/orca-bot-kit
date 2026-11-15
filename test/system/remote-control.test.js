// A system test: Remote Control on for a Claude Code session the kit starts,
// and off once the session is set off (#755), against the real Claude Code in
// the real Orca on this machine. Run it alone with
// `npm run test:system -- --yes test/system/remote-control.test.js`;
// `npm test` cannot, and no CI machine could.
//
// The fakes prove the rules: the launch line, the report and what health reads
// (test/launch-command.test.js and the tests beside it). This proves what they
// cannot: that the real Claude Code takes the kit's launch line and starts.
//
// The test holds on the kit's part only: its launch line and its start. It
// only notes what Remote Control itself did. The kit turns the feature on or
// off; it does not test Claude Code's feature. So these fail the test: the
// tabs that up and restart open and close, the report's lines about Remote
// Control, the kit's hook writing the conversation into the book, bot.yaml's
// remote_control, and health's `asked` and `from`. The state that health reads
// from Claude Code's registry, and health's findings that follow from that
// state, are diagnostics only.
//
//   1. A throwaway fleet: Bot Father set off before init starts it
//      (helpers/remote-control-off.js), and one bot, `obk-rc-probe`, with one
//      Claude session, `daily`, added with no `remote_control`, so on by the
//      kit's default.
//   2. `obk up` brings it up. Its report says Remote Control is on by the
//      kit's default. `obk health --json` gives the session `asked: on`, from
//      the kit's default, and a state. Remote Control can fail to start for
//      reasons outside the kit (the account, the network), and the session then
//      still runs. So the state and health's findings about it are noted as a
//      diagnostic, with health's own reason when it cannot tell.
//   3. `obk session change --remote-control off`, then `obk restart` of the
//      session. Its report says off, set for this session. Health gives the
//      session `running: yes`, `asked: off` and from the session. The state
//      (`not enabled` when off as asked) and health's findings are noted only.
//
// **It connects to an account.** Step 2 starts a session with Remote Control
// on, so the claude.ai account of whoever runs it gets an entry for
// `obk-rc-probe` in its list of sessions. The kit cannot take it away. The test
// prints one line at its end that says so; archive those entries at
// claude.ai/code. It prints nothing about the account: no name, no plan and
// no list of sessions.
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
// past its first-run screens in `Obk Rc Probe daily`. The test answers those
// itself, in its own tab, and only through the allowlists in
// helpers/screens.js, as mailbox-run-gone.test.js does (`answerScreens`):
//
//   - Claude Code's folder trust, once for this bot's folder, only when it is
//     the plain one for that folder, or the one the kit's default rules in
//     its .claude/settings.json bring up (helpers/claude-trust.js
//     `claudeTrustAt`, #558): down and return, with no `--enter`; then the
//     trust rows go, or the test fails.
//   - Claude Code's "Teach auto mode about your environment?" form, at most
//     once in each tab, only when it is the captured form (`onlyTeachFormOf`):
//     Esc; then the form goes and autoModeEnvSetup stays as it was in the
//     .claude.json of the session's own config folder, which Claude Code's
//     registry of live sessions names (helpers/teach-record.js
//     `sessionRecordFiles`, #745), or the test fails.
//
// Any other question on the screen (`questionOn`) stops the run, with the
// screen in the failure message; it is never answered. `Bot Father daily`
// sits on its own trust question and is left alone. A few minutes.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry } from '../helpers/cli.js';
import { onlyTeachFormOf, questionOn } from '../helpers/screens.js';
import { claudeTrustAt, trustScreenMet } from '../helpers/claude-trust.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { withBotFatherOff } from '../helpers/remote-control-off.js';
import { autoModeState, sessionRecordFiles } from '../helpers/teach-record.js';
import { deleteOwnProject, placesOf, projectsInBots } from '../helpers/own-project.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/** The Orca CLI that works for a normal user (tech notes, section 1). */
const ORCA = process.env.OBK_ORCA || '/Applications/Orca.app/Contents/Resources/bin/orca';

/** How long the session is given to be past its first-run screens and have the kit's hook write the book. */
const HOOK_MS = 180000;

/** How long Claude Code is given to report its Remote Control state in its registry entry. */
const STATE_MS = 60000;

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

/**
 * Run `obk ...` for its plain report, the lines a person reads, and expect 0.
 * Each tab it says it opened is this test's own, and each tab it says it
 * closed is counted as closed by this test, as `obkJson` and `closedByKit` do.
 * Gives the lines and the tabs it named.
 */
function obkReport(args) {
  const done = obk(args);
  assert.equal(done.status, 0, `obk ${args.join(' ')} should have exited 0: ${done.stdout}${done.stderr}`);
  const lines = done.stdout.split('\n');
  const opened = [];
  const closed = [];
  for (const line of lines) {
    const open = line.match(/^opened {5}(.+?) {2}tab (\S+) {2}terminal (\S+)$/);
    if (open !== null) opened.push({ title: open[1], tabId: open[2], terminal: open[3] });
    const shut = line.match(/^closed {5}(\S+) (\S+) {2}tab (\S+) {2}terminal (\S+)$/);
    if (shut !== null) closed.push({ bot: shut[1], name: shut[2], tabId: shut[3], terminal: shut[4] });
  }
  guard.openedByKit({ tabs: opened.map((tab) => ({ created: true, terminal: tab.terminal })) });
  guard.closedByKit(closed);
  return { lines, opened, closed };
}

/**
 * The report's lines about the tab titled `title`: from its `opened` line up
 * to the next tab's line, or to the end. Fails when the run did not open it.
 */
function linesAbout(report, title) {
  const at = report.lines.findIndex((line) => line.startsWith('opened     ') && line.includes(` ${title}  tab `));
  assert.notEqual(at, -1, `the run should have opened ${title}, and said:\n  ${report.lines.join('\n  ')}`);
  const next = report.lines.findIndex((line, index) => index > at && /^(opened|found ) {5}/.test(line));
  return report.lines.slice(at, next === -1 ? undefined : next);
}

/** The lines about Remote Control in a block of the report. */
const remoteControlLines = (block) => block.filter((line) => line.trimStart().startsWith('remote control'));

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

/** The bot folders whose Claude folder trust this test answered, and the tabs whose Teach form it answered. */
const answered = { trust: new Set(), teach: new Set() };

/**
 * One look at a tab's own first-run screens, as mailbox-run-gone.test.js has
 * it: the plain folder trust of `home` answered once, the captured Teach form
 * answered at most once with Esc, and any other question a failure with the
 * screen in it. Never answered by hand.
 */
async function answerScreens(t, title, handle, home) {
  const rows = rowsOf(handle);
  if (rows === undefined) return;

  if (rows.some((row) => row.includes('Yes, I trust this folder'))) {
    assert.ok(!answered.trust.has(home), `${title} asked Claude Code's folder trust for ${home} again, which this test answered once and answers no more:\n    ${rows.join('\n    ')}`);
    const wrong = claudeTrustAt(rows, home, path.dirname(path.dirname(home)), cliEntry);
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

/** Remove the throwaway bots folder and every `<bots>.*` the kit made beside it (PRD 6.3). */
async function removeBotsFolderAndSiblings(bots) {
  const parent = path.dirname(bots);
  const mine = path.basename(bots);
  const ours = async () => (await readdir(parent)).filter((name) => name === mine || name.startsWith(`${mine}.`));
  for (const name of await ours()) await rm(path.join(parent, name), { recursive: true, force: true });
  assert.deepEqual(await ours(), [], `this test left folders behind in ${parent}`);
}

const BOT = { name: 'obk-rc-probe', display: 'Obk Rc Probe' };
const SESSION = 'daily';
const TITLE = `${BOT.display} ${SESSION}`;

/** The report's line for a Claude session left on by the kit's default, and for one set off (#755). */
const ON_LINE = '             remote control: on, the kit\'s default (--remote-control is on the launch line)';
const OFF_LINE = '             remote control: off, set for this session (the kit\'s --settings turns it off)';

/** The states health gives a Claude session's Remote Control. */
const STATES = ['enabled', 'not enabled', 'unknown'];

/**
 * `obk health --json` for the probe bot: the session's entry in `sessions`,
 * and the findings about Remote Control in this session. Health exits 1 when
 * it finds anything, and this machine's own Orca settings may be something it
 * finds, so 0 and 1 are both an answer.
 */
function healthOfProbe(bots) {
  const answer = obkJson(['health', '--bots', bots, '--bot', BOT.name], [0, 1]);
  const entries = (answer.sessions ?? []).filter((one) => one.bot === BOT.name && one.session === SESSION);
  assert.equal(entries.length, 1, `one health entry for ${BOT.name} ${SESSION}, got: ${JSON.stringify(answer.sessions)}`);
  const about = (answer.found ?? []).filter((one) => `${one.where ?? ''} ${one.says ?? ''}`.includes('Remote Control')
    && `${one.where ?? ''} ${one.says ?? ''}`.includes(`${BOT.name}'s session ${SESSION}`));
  return { entry: entries[0], about };
}

test('a Claude session the kit starts has Remote Control on by the kit\'s default, and off once it is set off and restarted', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-remote-control-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', BOT.name].map(homeOf);
  const home = homeOf(BOT.name);
  const book = async () => parse(await readFile(path.join(home, 'sessions.yaml'), 'utf8')) ?? {};
  const entryInBotYaml = async () => (parse(await readFile(path.join(home, 'bot.yaml'), 'utf8'))?.sessions ?? []).find((one) => one?.name === SESSION) ?? {};
  let startedOn = false;

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    // First, so it is said however the rest of the teardown goes.
    if (startedOn) t.diagnostic(`this run started ${BOT.name} ${SESSION} with Remote Control on: archive the ${BOT.name} entries in your list of sessions at claude.ai/code`);

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
      assert.deepEqual(await terminalsAfterClosing(each, closed), [], `this test left tabs behind in ${each}`);
    }
    assert.deepEqual(failedDeletes, [], 'projects this test could not remove, left in Orca');
  });

  // ---------------------------------------------------------------------------
  // 1. A throwaway fleet: Bot Father off, and one Claude session with no
  //    remote_control, so on by the kit's default.
  obkJson(withBotFatherOff(['init', '--bots', bots, '--harness', 'claude']));
  obkJson(['bot', 'create', '--bots', bots, '--name', BOT.name, '--harness', 'claude', '--charter', `${BOT.display} exists for one system test run and owns nothing.`]);
  obkJson(['session', 'add', '--bots', bots, '--bot', BOT.name, '--name', SESSION, '--prompt=You are a system test\'s bot and own nothing. Do not run any command or use any tool. Say nothing and wait.']);
  assert.equal('remote_control' in (await entryInBotYaml()), false, `the premise: ${BOT.name} ${SESSION} has no remote_control, got: ${JSON.stringify(await entryInBotYaml())}`);

  // ---------------------------------------------------------------------------
  // 2. Up, on by the kit's default.
  startedOn = true;
  const up = obkReport(['up', '--bots', bots, '--bot', BOT.name]);
  const opened = up.opened.find((tab) => tab.title === TITLE);
  assert.ok(opened !== undefined, `up should have opened ${TITLE}, and said:\n  ${up.lines.join('\n  ')}`);
  assert.deepEqual(remoteControlLines(linesAbout(up, TITLE)), [ON_LINE], `up's report on ${TITLE} says Remote Control is on by the kit's default:\n  ${up.lines.join('\n  ')}`);

  // The restart below closes the tab only when the book names its conversation,
  // which the kit's hook writes once Claude Code is past its first-run screens.
  // Those are answered here, through the allowlists, and nowhere else.
  await until(
    `${TITLE}'s hook to write its conversation into the book`,
    HOOK_MS,
    async () => {
      const id = (await book()).sessions?.[SESSION]?.session;
      if (id !== undefined) return id;
      await answerScreens(t, TITLE, opened.terminal, home);
      return undefined;
    },
    () => whatIsUp(opened.terminal),
  );

  // What health reads from Claude Code's own registry entry. Remote Control
  // may take a moment to come on, so health is asked again until it says
  // enabled, or the time runs out; what it said last is what is noted. The
  // state is Claude Code's part, so it is a diagnostic and never a failure.
  let on;
  for (const stop = Date.now() + STATE_MS; ;) {
    on = healthOfProbe(bots);
    if (on.entry.remote_control?.state === 'enabled' || Date.now() >= stop) break;
    await answerScreens(t, TITLE, opened.terminal, home);
    await setTimeout(3000);
  }
  const asked = on.entry.remote_control;
  assert.equal(asked?.asked, 'on', `health gives ${TITLE} asked: on, got: ${JSON.stringify(asked)}`);
  assert.equal(asked.from, 'kit default', `from the kit's default, got: ${JSON.stringify(asked)}`);
  assert.ok(STATES.includes(asked.state), `and a state, one of ${STATES.join(', ')}, got: ${JSON.stringify(asked)}`);
  const onFindings = JSON.stringify(on.about.map((one) => one.says));
  if (asked.state === 'enabled') {
    t.diagnostic(`Remote Control came on in ${TITLE}. health says: enabled; its findings about it (none expected): ${onFindings}`);
  } else if (asked.state === 'not enabled') {
    t.diagnostic(`Remote Control did not come on in ${TITLE} within ${STATE_MS}ms. health says: not enabled; its findings about it (one expected): ${onFindings}`);
  } else {
    t.diagnostic(`health cannot tell whether Remote Control is on in ${TITLE}. health says: unknown, because ${asked.why}; its findings about it (none expected): ${onFindings}`);
  }

  // ---------------------------------------------------------------------------
  // 3. Set off, and restarted: the kit's --settings turns it off.
  const change = obk(['session', 'change', '--bots', bots, '--bot', BOT.name, '--session', SESSION, '--remote-control', 'off']);
  assert.equal(change.status, 0, `session change --remote-control off should go through: ${change.stdout}${change.stderr}`);
  assert.equal((await entryInBotYaml()).remote_control, 'off', `bot.yaml gives ${SESSION} remote_control: off, got: ${JSON.stringify(await entryInBotYaml())}`);

  const restarted = obkReport(['restart', '--bots', bots, '--bot', BOT.name, '--session', SESSION]);
  assert.deepEqual(restarted.closed.map((tab) => tab.terminal), [opened.terminal], `the restart closes ${TITLE}'s own tab and nothing else:\n  ${restarted.lines.join('\n  ')}`);
  const back = restarted.opened.find((tab) => tab.title === TITLE);
  assert.ok(back !== undefined, `the restart should have opened ${TITLE} again, and said:\n  ${restarted.lines.join('\n  ')}`);
  assert.deepEqual(remoteControlLines(linesAbout(restarted, TITLE)), [OFF_LINE], `the restart's report on ${TITLE} says Remote Control is off, set for this session:\n  ${restarted.lines.join('\n  ')}`);

  // The same folder, trusted a moment ago, so it should ask nothing. It is
  // looked at for ten seconds all the same, and answered the same way.
  for (const stop = Date.now() + 10000; Date.now() < stop;) {
    await answerScreens(t, TITLE, back.terminal, home);
    await setTimeout(2000);
  }

  // The session came up again: health gives running: yes once claude is the
  // program in front of its tab, which can take a few seconds after the
  // restart. The new Claude Code writes its registry entry as it starts; until
  // health finds it, the state is unknown. Health is asked again until both
  // are in, or the time runs out; what it said last is what counts.
  let off;
  for (const stop = Date.now() + STATE_MS; ;) {
    off = healthOfProbe(bots);
    if ((off.entry.running === 'yes' && off.entry.remote_control?.state !== 'unknown') || Date.now() >= stop) break;
    await answerScreens(t, TITLE, back.terminal, home);
    await setTimeout(3000);
  }
  assert.equal(off.entry.running, 'yes', `health gives ${TITLE} running: yes after the restart, so Claude Code took the launch line and started, got: ${JSON.stringify(off.entry)}`);
  const offAsked = off.entry.remote_control;
  assert.equal(offAsked?.asked, 'off', `health gives ${TITLE} asked: off, got: ${JSON.stringify(offAsked)}`);
  assert.equal(offAsked.from, 'session', `set for this session, got: ${JSON.stringify(offAsked)}`);
  // What Remote Control itself did is Claude Code's part: noted, never a failure.
  t.diagnostic(`Remote Control in ${TITLE} after the restart: health says ${offAsked.state}${offAsked.state === 'unknown' ? `, because ${offAsked.why}` : ''} (not enabled expected); its findings about it (none expected): ${JSON.stringify(off.about.map((one) => one.says))}`);
});
