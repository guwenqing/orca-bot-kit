// A session that is up but has no mailbox is told how to get one, and `up`
// says which sessions came up without one (#317, the architect's review of PR
// #320).
//
// Since #317 a session's mailbox is made by the step its launch line starts
// with, run in the session's own tab, and by nothing else: `up` makes none for
// a session whose tab is already running. So a session whose step Orca refused
// is up and has no mailbox, and the old advice, "it has never been brought up,
// run `obk up`", changes nothing. What does is a new launch: `obk restart` of
// that session, or `obk up` once its tab is closed. And the refusal is shown
// only in the new tab, above the harness's screen, so the person who ran `up`
// has to be told by `up` itself.
//
// What these tests pin, and only this, since the wording is the kit's:
//
//   - `message send`, `message to` and `message check` about a session whose
//     book names a tab but no mailbox name the session and give
//     `<cli> restart --bots <bots> --bot <bot> --session <name>` and an
//     `<cli> up --bots <bots> --bot <bot>` command. A session whose book names
//     no tab gets the `up` command and no restart command, as before.
//   - `up`, `init`, `restart` and `unpause` mark each session tab they report,
//     opened or found, whose session could have a mailbox and has none once
//     the tab is up: `noMailbox: true` in the JSON, and a line under the tab
//     with the restart command in the plain report. Nothing for a session that
//     has its mailbox, for Bot Father's ops tab, or for a Codex session whose
//     sandbox switch is off, which can have none.
//
// Orca's refusal is the fake's `fail` on `orchestration run-create`, for the
// next call only, so the step of one tab is refused and every other goes on.

import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';
import { stringify } from 'yaml';

import {
  bookIn,
  bookOf,
  createSandbox,
  orcaCallsOf,
  recordSession,
  sessionIn,
  sh,
  shellWord,
} from './helpers/cli.js';

/** Run `obk <args>` from a plain shell and insist it worked. */
async function ok(box, args) {
  const result = await box.run(args);
  assert.equal(result.code, 0, `obk ${args.join(' ')} should have worked:\n${result.stdout}${result.stderr}`);
  return result;
}

/**
 * Run `obk <args>` from a plain shell where a session may come up without its
 * mailbox: whether that run exits 0 is the kit's to decide, so all this asks
 * is a report and no crash.
 */
async function reported(box, args) {
  const result = await box.run(args);
  assert.notEqual(result.stdout.trim(), '', `obk ${args.join(' ')} should report what it did:\n${result.stderr}`);
  assert.ok(!/^\s+at /m.test(result.stderr), `expected a report, got a crash:\n${result.stderr}`);
  return result;
}

/** Bot Father up, and coder, a Codex bot with the sessions named, none of them brought up yet. */
async function fleet(box, sessions = [['daily']]) {
  await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);
  const bots = box.path('bots');
  await ok(box, ['bot', 'create', '--bots', bots, '--name', 'coder', '--harness', 'codex']);
  for (const [session, ...settings] of sessions) {
    await ok(box, ['session', 'add', '--bots', bots, '--bot', 'coder', '--name', session, ...settings]);
  }
  return bots;
}

/** Orca's refusal of a Run, as the fake gives it. */
const REFUSAL = 'the orchestration runtime is restarting; try again in a moment';

/** Orca refuses the next `run-create`, and only that one: one tab's step is refused. */
async function refuseNextMailbox(box) {
  const made = orcaCallsOf(await box.orca.calls(), 'orchestration run-create').length;
  await box.orca.set({ fail: { 'orchestration run-create': { code: 'runtime_error', message: REFUSAL, after: made, times: 1 } } });
}

/** Take a session's mailbox out of its book, as a hand edit or an older kit leaves it. */
async function forgetMailbox(bots, bot, session) {
  const book = await bookIn(bots, bot);
  delete book.sessions[session].mailbox;
  await writeFile(bookOf(bots, bot), stringify(book));
}

/** The command that gives a session that is up a new launch, and with it a mailbox. */
const restartOf = (box, bots, bot, session) =>
  [box.cli, 'restart', '--bots', bots, '--bot', bot, '--session', session].map(shellWord).join(' ');

/** The start of the command that brings a session up. */
const upOf = (box, bots, bot) => [box.cli, 'up', '--bots', bots, '--bot', bot].map(shellWord).join(' ');

/** The tab entry a `--json` report of `up` and its kind gives for one session. */
function entryOf(result, bot, session) {
  const answer = JSON.parse(result.stdout);
  const found = answer.tabs.find((tab) => tab.bot === bot && tab.name === session);
  assert.ok(found !== undefined, `the report should have a tab for ${bot}/${session}, got: ${result.stdout}`);
  return found;
}

/**
 * The plain report's lines under one tab: from the line that names the tab to
 * the next line that names another. `tab` is the tab's id, as the book has it.
 */
function linesUnder(stdout, tab) {
  const lines = stdout.split('\n');
  const header = /^(opened|found)\s/;
  const at = lines.findIndex((line) => header.test(line) && line.includes(`tab ${tab} `));
  assert.ok(at >= 0, `the report should name the tab ${tab}, got:\n${stdout}`);
  const after = lines.slice(at + 1);
  const next = after.findIndex((line) => header.test(line));
  return next < 0 ? after : after.slice(0, next);
}

/** Whether any of `lines` gives this session's restart command. */
const givesRestart = (lines, command) => lines.some((line) => line.includes(command));

// ---------------------------------------------------------------------------
// What up reports
// ---------------------------------------------------------------------------

test('#317 review: up marks the session whose tab could not make its mailbox, and not the one beside it', async (t) => {
  // Two sessions launched in one run; Orca refuses the first mailbox it is
  // asked for and makes the second. Whichever tab was refused is the one
  // marked, and its sister, which has its mailbox, carries no mark at all.
  const box = await createSandbox(t);
  const bots = await fleet(box, [['daily'], ['night']]);
  await refuseNextMailbox(box);

  const result = await reported(box, ['up', '--bots', 'bots', '--bot', 'coder', '--json']);

  const without = ['daily', 'night'].filter((session) => entryOf(result, 'coder', session).noMailbox === true);
  assert.equal(without.length, 1, `one session came up without its mailbox, and it is marked, got: ${result.stdout}`);
  const [lost] = without;
  const [kept] = ['daily', 'night'].filter((session) => session !== lost);
  assert.equal((await sessionIn(bots, 'coder', lost)).mailbox, undefined, `the marked one is the one with no mailbox in its book: ${lost}`);
  assert.ok(typeof (await sessionIn(bots, 'coder', kept)).mailbox === 'string', `and its sister has one: ${kept}`);
  assert.equal('noMailbox' in entryOf(result, 'coder', kept), false, `so it carries no mark, got: ${JSON.stringify(entryOf(result, 'coder', kept))}`);
});

test('#317 review: up says under that tab, in the plain report, that it has no mailbox, and gives its restart command', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box, [['daily'], ['night']]);
  await refuseNextMailbox(box);

  const result = await reported(box, ['up', '--bots', 'bots', '--bot', 'coder']);

  const books = { daily: await sessionIn(bots, 'coder', 'daily'), night: await sessionIn(bots, 'coder', 'night') };
  const [without] = Object.keys(books).filter((session) => books[session].mailbox === undefined);
  const [withIt] = Object.keys(books).filter((session) => books[session].mailbox !== undefined);
  assert.ok(without !== undefined && withIt !== undefined, `one of the two should have been refused its mailbox: ${JSON.stringify(books)}`);
  assert.ok(
    givesRestart(linesUnder(result.stdout, books[without].tab), restartOf(box, bots, 'coder', without)),
    `under coder/${without}'s tab, its restart command, got:\n${result.stdout}`,
  );
  assert.ok(
    !givesRestart(linesUnder(result.stdout, books[withIt].tab), restartOf(box, bots, 'coder', withIt)),
    `and nothing of the kind under coder/${withIt}'s, which has its mailbox, got:\n${result.stdout}`,
  );
});

/** Each command that brings a session up in a new tab, set up so that session's step is refused. */
const LAUNCHES = [
  ['init', async (box) => {
    await refuseNextMailbox(box);
    return { args: ['init', '--bots', 'bots', '--harness', 'claude', '--json'], bot: 'bot-father' };
  }],
  ['restart', async (box) => {
    const bots = await fleet(box);
    await ok(box, ['up', '--bots', 'bots', '--bot', 'coder']);
    const hooked = await recordSession(box, { bots, bot: 'coder', tab: (await sessionIn(bots, 'coder', 'daily')).tab, session: 'sess-1' });
    assert.equal(hooked.code, 0, hooked.stderr);
    await forgetMailbox(bots, 'coder', 'daily');
    await refuseNextMailbox(box);
    return { args: ['restart', '--bots', 'bots', '--bot', 'coder', '--json'], bot: 'coder' };
  }],
  ['unpause', async (box) => {
    const bots = await fleet(box);
    await ok(box, ['up', '--bots', 'bots', '--bot', 'coder']);
    const hooked = await recordSession(box, { bots, bot: 'coder', tab: (await sessionIn(bots, 'coder', 'daily')).tab, session: 'sess-1' });
    assert.equal(hooked.code, 0, hooked.stderr);
    await ok(box, ['pause', '--bots', 'bots', '--bot', 'coder']);
    await forgetMailbox(bots, 'coder', 'daily');
    await refuseNextMailbox(box);
    return { args: ['unpause', '--bots', 'bots', '--bot', 'coder', '--json'], bot: 'coder' };
  }],
];

for (const [command, setUp] of LAUNCHES) {
  test(`#317 review: ${command} marks a session whose new tab could not make its mailbox`, async (t) => {
    const box = await createSandbox(t);
    const { args, bot } = await setUp(box);

    const result = await reported(box, args);

    assert.equal((await sessionIn(box.path('bots'), bot, 'daily')).mailbox, undefined, `${bot}/daily's step was refused, so it has no mailbox`);
    assert.equal(entryOf(result, bot, 'daily').noMailbox, true, `and ${command} says so, got: ${result.stdout}`);
  });
}

test('#317 review: a normal launch marks nothing, on the tabs it opens or on the tabs it finds, the ops tab included', async (t) => {
  const box = await createSandbox(t);
  const init = await ok(box, ['init', '--bots', 'bots', '--harness', 'claude', '--json']);
  const bots = box.path('bots');
  await ok(box, ['bot', 'create', '--bots', bots, '--name', 'coder', '--harness', 'codex']);
  await ok(box, ['session', 'add', '--bots', bots, '--bot', 'coder', '--name', 'daily']);

  const opened = await ok(box, ['up', '--bots', 'bots', '--json']);
  const found = await ok(box, ['up', '--bots', 'bots']);

  for (const [what, result] of [['init', init], ['up', opened]]) {
    const tabs = JSON.parse(result.stdout).tabs;
    assert.ok(tabs.length > 0, `${what} should have reported its tabs`);
    for (const tab of tabs) {
      assert.equal('noMailbox' in tab, false, `${what}: ${tab.title} has its mailbox, or is no session at all, got: ${JSON.stringify(tab)}`);
    }
  }
  assert.ok(typeof (await sessionIn(bots, 'coder', 'daily')).mailbox === 'string', 'coder/daily has its mailbox');
  assert.ok(
    !found.stdout.includes(' restart --bots '),
    `the plain report of tabs that are all as they should be gives no restart command, got:\n${found.stdout}`,
  );
});

test('#317 review: up marks a running session whose book has lost its mailbox, in the JSON and in the plain report', async (t) => {
  // The tab is found, not opened: nothing is typed into it, so nothing gives
  // it a mailbox this time, and `up` says so rather than passing over it.
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await ok(box, ['up', '--bots', 'bots', '--bot', 'coder']);
  await forgetMailbox(bots, 'coder', 'daily');

  const json = await reported(box, ['up', '--bots', 'bots', '--bot', 'coder', '--json']);
  const plain = await reported(box, ['up', '--bots', 'bots', '--bot', 'coder']);

  const entry = entryOf(json, 'coder', 'daily');
  assert.equal(entry.created, false, 'the tab was found, not opened');
  assert.equal(entry.noMailbox, true, `and it is marked, got: ${json.stdout}`);
  assert.ok(
    givesRestart(linesUnder(plain.stdout, (await sessionIn(bots, 'coder', 'daily')).tab), restartOf(box, bots, 'coder', 'daily')),
    `under its tab, its restart command, got:\n${plain.stdout}`,
  );
});

test('#317 review: a Codex session whose sandbox switch is off is never marked: it can have no mailbox', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box, [['daily', '--extra-arg=-c', '--extra-arg=sandbox_workspace_write.network_access=false']]);

  const opened = await ok(box, ['up', '--bots', 'bots', '--bot', 'coder', '--json']);
  const found = await ok(box, ['up', '--bots', 'bots', '--bot', 'coder']);

  assert.equal((await sessionIn(bots, 'coder', 'daily')).mailbox, undefined, 'it has no mailbox, rightly');
  assert.equal('noMailbox' in entryOf(opened, 'coder', 'daily'), false, `and is not marked for it, got: ${opened.stdout}`);
  assert.ok(
    !givesRestart(found.stdout.split('\n'), restartOf(box, bots, 'coder', 'daily')),
    `nor told to restart for it, got:\n${found.stdout}`,
  );
});

// ---------------------------------------------------------------------------
// What the message commands advise
// ---------------------------------------------------------------------------

/** The three commands that answer about a session's mailbox, each asked about coder/daily. */
const ASKS = [
  ['message send', (bots) => ['message', 'send', '--bots', bots, '--to', 'coder/daily', '--from', 'bot-father/daily', '--subject', 'hello', '--text', 'hi']],
  ['message to', (bots) => ['message', 'to', '--bots', bots, '--to', 'coder/daily', '--from', 'bot-father/daily']],
  ['message check', (bots) => ['message', 'check', '--bots', bots, '--bot', 'coder', '--session', 'daily']],
];

/** coder/daily brought up with its step refused: a tab in the book, and no mailbox. */
async function upWithoutMailbox(box) {
  const bots = await fleet(box);
  await refuseNextMailbox(box);
  await reported(box, ['up', '--bots', 'bots', '--bot', 'coder']);
  const daily = await sessionIn(bots, 'coder', 'daily');
  assert.ok(typeof daily.tab === 'string', `coder/daily is up, in a tab the book names: ${JSON.stringify(daily)}`);
  assert.equal(daily.mailbox, undefined, `and has no mailbox, since Orca refused it: ${JSON.stringify(daily)}`);
  return bots;
}

for (const [command, argsFor] of ASKS) {
  test(`#317 review: ${command} about a session that is up with no mailbox names it and gives its restart command`, async (t) => {
    const box = await createSandbox(t);
    const bots = await upWithoutMailbox(box);

    const result = await box.run(argsFor(bots));

    const said = result.stdout + result.stderr;
    assert.equal(result.code, 1, `it cannot be done, got:\n${said}`);
    assert.ok(said.includes('coder/daily'), `it names the session, got:\n${said}`);
    assert.ok(said.includes(restartOf(box, bots, 'coder', 'daily')), `it gives the restart command, got:\n${said}`);
    assert.ok(said.includes(upOf(box, bots, 'coder')), `and the up command, for when its tab is closed, got:\n${said}`);
  });

  test(`#317 review: ${command} about a session never brought up gives the up command, and no restart command`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    assert.equal((await sessionIn(bots, 'coder', 'daily'))?.tab, undefined, 'coder/daily has never had a tab');

    const result = await box.run(argsFor(bots));

    const said = result.stdout + result.stderr;
    assert.equal(result.code, 1, `it cannot be done, got:\n${said}`);
    assert.ok(said.includes('coder/daily'), `it names the session, got:\n${said}`);
    assert.ok(said.includes(upOf(box, bots, 'coder')), `it gives the up command, got:\n${said}`);
    assert.ok(!said.includes(' restart --bots '), `and no restart command: there is nothing to restart, got:\n${said}`);
  });
}

test('#317 review: message send from a session that is up with no mailbox gives that session\'s restart command', async (t) => {
  // The sender's side of the same thing: a reply would have nowhere to go, and
  // bringing it up again changes nothing while its tab is running.
  const box = await createSandbox(t);
  const bots = await upWithoutMailbox(box);

  const result = await box.run(['message', 'send', '--bots', bots, '--to', 'bot-father', '--from', 'coder/daily', '--subject', 'hello', '--text', 'hi']);

  const said = result.stdout + result.stderr;
  assert.equal(result.code, 1, `it cannot be sent, got:\n${said}`);
  assert.ok(said.includes('coder/daily'), `it names the sender, got:\n${said}`);
  assert.ok(said.includes(restartOf(box, bots, 'coder', 'daily')), `and gives its restart command, got:\n${said}`);
});

test('#317 review: the restart command given for a session with no mailbox, run as given, gets it one in its new tab', async (t) => {
  // The point of the advice: following it works. Restart closes a tab only
  // when the book can name its conversation, which a running session's own
  // hook has written by now.
  const box = await createSandbox(t);
  const bots = await upWithoutMailbox(box);
  const old = (await sessionIn(bots, 'coder', 'daily')).tab;
  const hooked = await recordSession(box, { bots, bot: 'coder', tab: old, session: 'sess-1' });
  assert.equal(hooked.code, 0, hooked.stderr);
  const asked = await box.run(['message', 'to', '--bots', bots, '--to', 'coder/daily', '--from', 'bot-father/daily']);
  const command = restartOf(box, bots, 'coder', 'daily');
  assert.ok((asked.stdout + asked.stderr).includes(command), `the advice should be the restart command, got:\n${asked.stdout}${asked.stderr}`);

  const ran = await sh(command, { cwd: box.root, env: box.env });

  assert.equal(ran.code, 0, `${command}\n${ran.stdout}${ran.stderr}`);
  const daily = await sessionIn(bots, 'coder', 'daily');
  assert.notEqual(daily.tab, old, 'the session is in a new tab');
  const run = (await box.orca.runs()).find((one) => one.id === daily.mailbox);
  assert.ok(run !== undefined, `and has a mailbox Orca made, got: ${JSON.stringify(daily)}`);
  const tab = (await box.orca.terminals()).find((terminal) => terminal.tabId === daily.tab);
  assert.equal(run.coordinator_handle, tab?.handle, 'bound to that new tab');
});
