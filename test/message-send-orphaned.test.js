// `obk message send` to a receiver whose tab Orca lists as orphaned (#579).
//
// Fleet mail on the Orca road goes into the receiver's mailbox, and Orca's own
// notice tells the receiver to look (PRD 6.9, ADR 0042). Orca writes that
// notice only into a pane its window has loaded (tech notes, section 1). A tab
// it lists as orphaned (`orphaned: true`, tab id `pty:<ptyId>`) is one the
// window has not loaded, so no notice comes. After an Orca window restart most
// of a fleet's tabs were orphaned, and mail to them waited for 45 hours while
// the send said that Orca's notice tells the receiver to look.
//
// So a send still puts the letter in the mailbox, and its answer says what is
// true: the receiver's tab is orphaned, the letter waits, and the window must
// load the tab first. It names the command that loads it,
// `orca terminal switch --terminal <handle>`, and says that this moves the
// user's view. The kit does not run that command itself: the user is working,
// and the kit does not take his screen. When the kit cannot read Orca's
// listing, it says that it could not tell, and does not claim the notice.
//
// Every receiver here is on the Orca road: a Codex session, and a Claude
// session in another approval class than the sender. Each test puts a tab into
// the orphaned state with `box.orca.orphan(handle)`, as
// test/orphaned-tabs.test.js does.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSandbox,
  orcaCallsOf,
  orcaCommand,
  orcaFlag,
  sentInto,
  sessionIn,
} from './helpers/cli.js';
import { addSession } from './helpers/permissions.js';

/** The line a send prints today when it trusts Orca's notice, in either form. */
const NOTICE_CLAIM = /notice tells it to look/i;

/**
 * Bot Father, a Claude sender (writer), a Codex receiver (coder, with two
 * sessions) and a Claude receiver in another approval class (skipper), all up.
 */
async function fleet(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  for (const [bot, harness, sessions, settings] of [
    ['writer', 'claude', ['daily'], []],
    ['coder', 'codex', ['daily', 'night'], []],
    ['skipper', 'claude', ['daily'], ['--approval', 'dangerously-skip']],
  ]) {
    const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness]);
    assert.equal(made.code, 0, made.stderr);
    for (const name of sessions) {
      const added = await addSession(box, { bot, name, settings });
      assert.equal(added.code, 0, added.stderr);
    }
  }
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  return box.path('bots');
}

/** The receivers on the Orca road, as `--to` names them. */
const RECEIVERS = [
  ['a Codex receiver', 'coder/daily'],
  ['a Claude receiver in another approval class', 'skipper/daily'],
];

/** The tab the book names for a session, with the handle Orca gives it. */
async function tabOf(box, bots, where) {
  const [bot, name] = where.split('/');
  const tabId = (await sessionIn(bots, bot, name))?.tab;
  const terminal = (await box.orca.terminals()).find((one) => one.tabId === tabId);
  assert.ok(terminal, `Orca should hold ${where}'s tab ${tabId}`);
  return { tabId, handle: terminal.handle, terminal };
}

/** A premise: the send to `where` takes the Orca road, not the native one. */
async function assertOrcaRoad(box, where) {
  const result = await box.run(['message', 'to', '--bots', 'bots', '--to', where, '--from', 'writer/daily', '--json']);
  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.equal(JSON.parse(result.stdout).transport, 'orca', `${where} should be on the Orca road`);
}

/** `obk message send` from writer/daily to `where`, with `more` after it. */
const send = (box, where, more = []) => box.run([
  'message', 'send', '--bots', 'bots', '--to', where, '--from', 'writer/daily',
  '--subject', 'the staging host', '--text', 'It is down again.', ...more,
]);

const callCount = async (box) => (await box.orca.calls()).length;
const since = async (box, from) => (await box.orca.calls()).slice(from);
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The text answer of a send that went through. */
function textOf(result) {
  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  return result.stdout;
}

/** The `--json` answer of a send that went through, parsed. */
function jsonOf(result) {
  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
}

/** The text says the tab is orphaned and how to load it, and makes no claim of a notice. */
function assertSaysOrphaned(text, handle) {
  assert.match(text, /orphaned/i, `the answer should say the receiver's tab is orphaned, got:\n${text}`);
  assert.match(text, /wait/i, `and that the letter waits, got:\n${text}`);
  assert.match(text, /load/i, `and that it waits for the window to load the tab, got:\n${text}`);
  assert.match(
    text,
    new RegExp(`terminal switch --terminal ${escapeRe(handle)}(?![\\w-])`),
    `and name the command that loads the tab, by the receiver's handle ${handle}, got:\n${text}`,
  );
  assert.match(text, /\b(view|screen|focus)\b/i, `and say that the switch moves the user's view, got:\n${text}`);
  assert.doesNotMatch(text, NOTICE_CLAIM, `and must not claim Orca's notice tells the receiver, got:\n${text}`);
}

/** No call that changes the window: no switch, no focus, no window reload. */
async function assertWindowLeftAlone(box, calls) {
  const moved = calls.filter((call) => ['terminal switch', 'terminal focus'].includes(orcaCommand(call))
    || call.args.includes('switch') || call.args.includes('focus') || call.args.includes('--focus'));
  assert.deepEqual(moved.map((call) => call.args), [], 'the kit must not switch to or focus any tab');
  assert.deepEqual(await box.osascript.calls(), [], 'and must not ask the Orca window to reload');
}

// -------------------------------------------------------------- orphaned

for (const [label, where] of RECEIVERS) {
  test(`MO1 ${label} whose tab is orphaned: the letter is still in its mailbox, and the send exits 0`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await assertOrcaRoad(box, where);
    const { handle } = await tabOf(box, bots, where);
    await box.orca.orphan(handle);

    const result = await send(box, where);

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    const queued = await box.orca.messages();
    assert.equal(queued.length, 1, `one letter, got: ${JSON.stringify(queued)}`);
    const [bot, name] = where.split('/');
    assert.equal(queued[0].to, `run:${(await sessionIn(bots, bot, name)).mailbox}`, 'in the receiver\'s own mailbox');
  });

  test(`MO2 ${label} whose tab is orphaned: the answer says so, names the switch by its handle, and claims no notice`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await assertOrcaRoad(box, where);
    const { handle } = await tabOf(box, bots, where);
    await box.orca.orphan(handle);

    const text = textOf(await send(box, where));

    assertSaysOrphaned(text, handle);
  });

  test(`MO3 ${label} whose tab is orphaned: the kit types nothing and does not switch to the tab itself`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await assertOrcaRoad(box, where);
    const { handle } = await tabOf(box, bots, where);
    await box.orca.orphan(handle);
    const from = await callCount(box);

    textOf(await send(box, where));

    const calls = await since(box, from);
    await assertWindowLeftAlone(box, calls);
    assert.deepEqual(orcaCallsOf(calls, 'terminal send').map((call) => call.args), [], 'nothing typed into any tab');
  });

  test(`MO4 ${label} whose tab is orphaned: --json carries orphaned: true`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await assertOrcaRoad(box, where);
    const { handle } = await tabOf(box, bots, where);
    await box.orca.orphan(handle);

    const answer = jsonOf(await send(box, where, ['--json']));

    assert.equal(answer.sent, true, `the letter went, got: ${JSON.stringify(answer)}`);
    assert.equal(answer.orphaned, true, `the answer should carry orphaned: true, got: ${JSON.stringify(answer)}`);
  });
}

// ---------------------------------------------------------- not orphaned

test('MO5 a receiver whose own tab is not orphaned gets today\'s answer, while other tabs, its own bot\'s among them, are', async (t) => {
  // Only the tab the book names for the receiving session counts: the sender's
  // tab, Bot Father's, and another session of the receiver's own bot (in the
  // same Orca project) are all orphaned here.
  const box = await createSandbox(t);
  const bots = await fleet(box);
  for (const other of ['writer/daily', 'coder/night', 'bot-father/daily']) {
    await box.orca.orphan((await tabOf(box, bots, other)).handle);
  }
  const { handle } = await tabOf(box, bots, 'coder/daily');

  const text = textOf(await send(box, 'coder/daily'));
  const answer = jsonOf(await send(box, 'coder/daily', ['--json']));

  assert.match(text, NOTICE_CLAIM, `today's line, that Orca's notice tells it to look, got:\n${text}`);
  assert.doesNotMatch(text, /orphaned/i, `nothing about an orphaned tab, got:\n${text}`);
  assert.doesNotMatch(text, new RegExp(`terminal switch --terminal ${escapeRe(handle)}`), `and no switch to name, got:\n${text}`);
  assert.notEqual(answer.orphaned, true, `no orphaned: true, got: ${JSON.stringify(answer)}`);
  assert.equal((await box.orca.messages()).length, 2, 'both letters are in the mailbox');
});

test('MO5 a receiver whose tab is not orphaned, with nothing orphaned at all: today\'s answer, and no orphaned: true', async (t) => {
  const box = await createSandbox(t);
  await fleet(box);

  const text = textOf(await send(box, 'skipper/daily'));
  const answer = jsonOf(await send(box, 'skipper/daily', ['--json']));

  assert.match(text, NOTICE_CLAIM, `today's line, that Orca's notice tells it to look, got:\n${text}`);
  assert.doesNotMatch(text, /orphaned/i, `nothing about an orphaned tab, got:\n${text}`);
  assert.notEqual(answer.orphaned, true, `no orphaned: true, got: ${JSON.stringify(answer)}`);
});

// -------------------------------------------------------------- interrupt

test('MO6 --interrupt to a busy receiver whose tab is orphaned: the Escape goes in, and the answer says the tab is orphaned', async (t) => {
  // The Escape of --interrupt still goes into the orphaned tab, by its handle,
  // as OT6 in test/orphaned-tabs.test.js holds. It ends the receiver's turn,
  // but the window still has not loaded the tab, so no notice comes now either.
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await box.orca.set({ waitIdle: 'busy' });
  const { handle } = await tabOf(box, bots, 'coder/daily');
  await box.orca.orphan(handle);
  const from = await callCount(box);

  const text = textOf(await send(box, 'coder/daily', ['--interrupt']));

  assert.equal((await box.orca.messages()).length, 1, 'the letter is in the mailbox');
  const calls = await since(box, from);
  const keys = orcaCallsOf(calls, 'terminal send');
  assert.deepEqual(keys.map((call) => orcaFlag(call, '--terminal')), [handle], 'one send, into the receiver\'s tab by its handle');
  for (const terminal of await box.orca.terminals()) {
    const sent = sentInto(terminal).slice(1).map((one) => ({ text: one.text, enter: one.enter }));
    const want = terminal.handle === handle ? [{ text: '\x1b', enter: false }] : [];
    assert.deepEqual(sent, want, `since its launch line, into ${terminal.handle}: the Escape and nothing more`);
  }
  assertSaysOrphaned(text, handle);
  await assertWindowLeftAlone(box, calls);
});

// ------------------------------------------------------ listing unreadable

for (const [label, where] of RECEIVERS) {
  test(`MO7 ${label}, and Orca refuses the tab listing: the letter goes, and the answer says the kit could not tell`, async (t) => {
    const box = await createSandbox(t);
    await fleet(box);
    await assertOrcaRoad(box, where);
    await box.orca.set({ fail: { 'terminal list': { code: 'runtime_error', message: 'the listing is not there' } } });
    const from = await callCount(box);

    const text = textOf(await send(box, where));

    assert.equal((await box.orca.messages()).length, 1, 'the letter is in the mailbox');
    assert.doesNotMatch(text, NOTICE_CLAIM, `no claim that Orca's notice will come, got:\n${text}`);
    assert.match(
      text,
      /\b(could ?n[o']t|cannot|can't|unable to|did not|does not|do not) (tell|know|read|see|say)\b|\bnot known\b|\bunknown\b/i,
      `the answer should say the kit could not tell, got:\n${text}`,
    );
    assert.match(text, /load/i, `whether Orca's window has loaded the receiver's tab, got:\n${text}`);
    // Last, so a send that never looks fails on what it claims, above.
    assert.ok(
      orcaCallsOf(await since(box, from), 'terminal list').length > 0,
      'the send should have asked Orca for its tab listing, which is the call refused here',
    );
  });
}
