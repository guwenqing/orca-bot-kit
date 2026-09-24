// Bot Father's two tabs, and how the daily one gets its harness.
//
// Both tabs are created plain. `orca terminal create --command <harness>` does
// not work for a project the kit has just made — proven live, eight
// combinations, all failing with `Timed out waiting for terminal handle after
// creation` and leaving a tab that never becomes live. So the harness is typed
// into the daily tab afterwards:
//
//   terminal create → terminal send --enter → terminal wait --for tui-idle
//
// The wait comes after, and it is a check rather than a gate. `tui-idle` asks
// about a TUI, not about a shell: a tab that is still a plain shell is refused
// with `timeout`, whatever the timeout, so waiting before typing would never
// let anything through. Afterwards the same call answers the useful question —
// did a TUI come up, which is to say did the harness start.
//
// An `ok` answer means it started, satisfied or not: a harness sitting on its
// folder-trust question answers `satisfied: false` with
// `blockedReason: agent-interactive-prompt`, and that is the first run of every
// new bot.
//
// The other tab is a plain shell: nothing is created for it but the tab, and
// nothing is ever typed into it.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertOrcaCallsAllowed,
  bareLaunch,
  botFatherTabs,
  createSandbox,
  orcaCallsOf,
  orcaCommand,
  orcaFlag,
  orcaFlags,
  plainCli,
  sentInto,
  TAB_TITLES,
  typedInto,
} from './helpers/cli.js';

const botHomeIn = (box) => box.path('bots', 'bots', 'bot-father');

/**
 * The two tabs, told apart the way the kit tells them apart: the daily session
 * by the id the book holds, and the plain tab as the one thing left over. The
 * kit keeps nothing about that one, so neither do these tests.
 */
async function tabsOf(box) {
  const { inBook, leftovers, terminals, book } = await botFatherTabs(box, box.path('bots'));
  assert.equal(inBook.length, 1, `one tab id should sit under a session, got ${book}`);
  assert.equal(leftovers.length, 1, `one tab should be left outside the book, got ${JSON.stringify(terminals)}`);
  assert.equal(terminals.length, 2, `Bot Father has two tabs and no more, got ${JSON.stringify(terminals)}`);
  return { daily: inBook[0], ops: leftovers[0] };
}

for (const harness of ['claude', 'codex']) {
  test(`init --harness ${harness} types the ${harness} launch command into the daily tab`, async (t) => {
    const box = await createSandbox(t);

    const result = await box.run(['init', '--bots', 'bots', '--harness', harness]);

    assert.equal(result.code, 0, result.stderr);
    const { daily, ops } = await tabsOf(box);
    // The harness and the approval level it takes, and nothing else: Bot
    // Father's seeded session names no model, no effort and no start prompt.
    assert.deepEqual(typedInto(daily), [bareLaunch(box, harness, 'bot-father', 'daily')]);
    assert.deepEqual(sentInto(daily), [{ text: bareLaunch(box, harness, 'bot-father', 'daily'), enter: true }], 'the line has to be sent off');
    assert.deepEqual(typedInto(ops), [], 'the ops tab is a plain shell');
    assert.equal(daily.worktreePath, botHomeIn(box));
    assert.equal(ops.worktreePath, botHomeIn(box));
  });
}

test('a tab is never created with a command on it', async (t) => {
  const box = await createSandbox(t);

  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);

  const botHome = botHomeIn(box);
  const creates = orcaCallsOf(await box.orca.calls(), 'terminal create');
  assert.equal(creates.length, 2, 'two tabs, two calls');
  assert.deepEqual(
    creates.map((call) => orcaFlag(call, '--title')).sort(),
    [TAB_TITLES.daily, TAB_TITLES.ops].sort(),
  );
  for (const call of creates) {
    assert.equal(orcaFlag(call, '--worktree'), `path:${botHome}`);
    // A create that carries a bare harness name never becomes live, and leaves
    // an orphan tab behind.
    assert.ok(!call.args.includes('--command'), `terminal create must not carry --command: ${call.args.join(' ')}`);
    // The owner is working in this Orca. A tab the kit made must not take his
    // focus away from what he is doing.
    assert.ok(!call.args.includes('--focus'), `terminal create must not carry --focus: ${call.args.join(' ')}`);
    assert.deepEqual(orcaFlags(call), ['--json', '--title', '--worktree']);
  }
});

test('the two tabs are given their titles at creation, exactly', async (t) => {
  const box = await createSandbox(t);

  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);

  // A person looking at Orca has to know which tab is which, and the titles are
  // what he reads. Case and spacing are part of them. The kit writes them and
  // never reads them back — except the ops tab's, which is how it is found.
  const { daily, ops } = await tabsOf(box);
  assert.equal(daily.title, 'Bot Father daily');
  assert.equal(ops.title, 'Bot Father ops');

  const creates = orcaCallsOf(await box.orca.calls(), 'terminal create');
  assert.deepEqual(
    creates.map((call) => orcaFlag(call, '--title')).sort(),
    ['Bot Father daily', 'Bot Father ops'].sort(),
    'every tab is named as it is made, not renamed afterwards',
  );
});

test('the harness is typed into the daily tab only, and the tab is checked afterwards', async (t) => {
  const box = await createSandbox(t);

  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'codex'])).code, 0);

  const { daily, ops } = await tabsOf(box);
  const calls = await box.orca.calls();

  const sends = orcaCallsOf(calls, 'terminal send');
  assert.equal(sends.length, 1, 'one tab is told what to run, and it is one line');
  assert.equal(orcaFlag(sends[0], '--terminal'), daily.handle);
  assert.notEqual(orcaFlag(sends[0], '--terminal'), ops.handle);
  assert.equal(plainCli(orcaFlag(sends[0], '--text')), bareLaunch(box, 'codex'));
  assert.ok(sends[0].args.includes('--enter'), `the line has to be sent off: ${sends[0].args.join(' ')}`);
  assert.deepEqual(orcaFlags(sends[0]), ['--enter', '--json', '--terminal', '--text']);

  // The kit looks more than once — a harness can come up and die — so what is
  // pinned is that every look is at the tab that was typed into, and that each
  // one asks Orca the same question with a deadline on it.
  const waits = orcaCallsOf(calls, 'terminal wait');
  assert.ok(waits.length >= 1, 'the tab that was typed into has to be checked');
  for (const wait of waits) {
    assert.equal(orcaFlag(wait, '--terminal'), daily.handle, 'the tab that was typed into is the tab that is checked');
    assert.equal(orcaFlag(wait, '--for'), 'tui-idle');
    assert.ok(Number(orcaFlag(wait, '--timeout-ms')) > 0, `a look needs a deadline, got: ${wait.args.join(' ')}`);
    assert.deepEqual(orcaFlags(wait), ['--for', '--json', '--terminal', '--timeout-ms']);
  }

  // Order is the whole point. A wait before the send would be asking a plain
  // shell whether its TUI is idle, which is refused however long it waits.
  const order = calls.map(orcaCommand);
  assert.ok(
    order.indexOf('terminal send') < order.indexOf('terminal wait'),
    `the send must come before the wait, got: ${order.join(' → ')}`,
  );
});

test('a harness that came up on its trust question counts as started', async (t) => {
  // The first run of every new bot: the harness is up and asking whether it may
  // work in this folder. A TUI is there, so it started; `satisfied` is about
  // idleness and says nothing about that.
  const box = await createSandbox(t);
  await box.orca.set({ waitIdle: 'blocked' });

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude', '--json']);

  assert.equal(result.code, 0, result.stderr);
  const daily = JSON.parse(result.stdout).tabs.find((tab) => tab.name === 'daily');
  assert.equal(daily.harnessStarted, true, 'a TUI that is up is a harness that started');
  const { daily: tab } = await tabsOf(box);
  assert.deepEqual(typedInto(tab), [bareLaunch(box, 'claude', 'bot-father', 'daily')]);
});

test('a harness that never came up is reported, and the run still succeeds', async (t) => {
  // No TUI in the tab after the line was sent: the harness is not there. Orca
  // says so by refusing the wait with `timeout`, however long it was given.
  const box = await createSandbox(t);
  await box.orca.set({ waitIdle: false });

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assert.equal(result.code, 0, `a harness that did not come up is not a failure: ${result.stderr}`);
  const { daily, ops } = await tabsOf(box);
  assert.deepEqual(typedInto(daily), [bareLaunch(box, 'claude', 'bot-father', 'daily')], 'the line was still typed; it is the outcome that was checked');
  assert.deepEqual(typedInto(ops), [], 'and the other tab is still a plain shell');
  // The caller has to learn which tab it must look at itself.
  assert.ok(
    result.stdout.includes(TAB_TITLES.daily),
    `should name the tab whose harness did not come up, got: ${result.stdout}`,
  );
});

test('nothing is ever typed into a tab that was already live', async (t) => {
  const box = await createSandbox(t);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const before = await box.orca.terminals();
  const sofar = (await box.orca.calls()).length;

  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);
  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);

  assert.deepEqual(await box.orca.terminals(), before, 'a live session must not be typed into again');
  const later = (await box.orca.calls()).slice(sofar);
  assert.deepEqual(orcaCallsOf(later, 'terminal send'), []);
  assert.deepEqual(orcaCallsOf(later, 'terminal wait'), []);
});

test('the daily tab that comes back is the one that gets the harness', async (t) => {
  const box = await createSandbox(t);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'codex'])).code, 0);
  const { daily, ops } = await tabsOf(box);

  // The user closed the daily tab; the ops tab is still running.
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((terminal) => terminal.tabId !== daily.tabId) });
  const sofar = (await box.orca.calls()).length;

  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);

  const back = await tabsOf(box);
  assert.notEqual(back.daily.tabId, daily.tabId, 'a tab that comes back is a new tab');
  assert.deepEqual(typedInto(back.daily), [bareLaunch(box, 'codex')], 'the new tab runs the harness bot.yaml names');
  assert.deepEqual(back.ops, ops, 'the tab that was still there must be untouched');

  const sends = orcaCallsOf((await box.orca.calls()).slice(sofar), 'terminal send');
  assert.equal(sends.length, 1);
  assert.equal(orcaFlag(sends[0], '--terminal'), back.daily.handle);
});

test('no tab is ever closed, and every Orca call asks for --json', async (t) => {
  const box = await createSandbox(t);

  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);

  const calls = await box.orca.calls();
  assert.ok(calls.length > 0, 'the kit should have talked to Orca at all');
  assertOrcaCallsAllowed(calls);
});
