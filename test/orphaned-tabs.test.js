// A tab Orca lists as orphaned is still the session's tab (#187, #185).
//
// Proved live on Orca 1.4.207 (tech notes, section 1): once a harness runs in a
// tab of a project the Orca window has not loaded, `terminal list` can give that
// terminal the same handle and the same `ptyId`, but `tabId` and `leafId`
// `pty:<ptyId>` and `orphaned: true`, and later go back to the real tab id.
// Inside Orca nothing has changed, and `terminal close --terminal <h> --tab`
// closes it and answers with the real tab id.
//
// Only the listing substitutes the id. `terminal show --terminal <handle>`
// answers the real tab id for the same terminal, with `orphaned: true` still
// set (proved live on 1.4.207 in the review of PR #190). So the rule is the one
// PRD 6.2 already has, and it needs nothing new in the book: the tab id is the
// key, titles are never read, and a tab that is open is never taken for a lost
// one and never gets a second harness. A book written before any of this is
// recognised as well as a new one (OT2).
//
// Every test here puts a terminal into that state with `box.orca.orphan(handle)`.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import {
  assertCleanFailure,
  bareLaunch,
  bookOf,
  botFatherTabs,
  botHomeOf,
  conversationOnRecord,
  createSandbox,
  orcaCallsOf,
  orcaFlag,
  recordSession,
  sessionIn,
  sh,
  tabsOfBot,
  TAB_TITLES,
  tokenless,
  typedInto,
} from './helpers/cli.js';

/** A bots folder with Bot Father and api-bot (claude, one session `daily`), both up. */
async function fleet(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily'])).code, 0);
  const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);
  assert.equal(up.code, 0, up.stderr);
  return box.path('bots');
}

/** The session's tab as the book holds it and as the fake keeps it (its real id, whatever the listing says). */
async function tabOf(box, bots, bot = 'api-bot', name = 'daily') {
  const tabId = (await sessionIn(bots, bot, name))?.tab;
  const terminal = (await box.orca.terminals()).find((one) => one.tabId === tabId);
  assert.ok(terminal, `Orca should hold ${bot}/${name}'s tab ${tabId}`);
  return { tabId, handle: terminal.handle, terminal };
}

/**
 * A running api-bot/daily whose conversation the book knows, and Claude Code
 * has on record (#295), with its tab now listed as orphaned.
 */
async function orphanedSession(box) {
  const bots = await fleet(box);
  const before = await tabOf(box, bots);
  const recorded = await recordSession(box, { bots, bot: 'api-bot', tab: before.tabId, session: 'sess-1' });
  assert.equal(recorded.code, 0, recorded.stderr);
  await conversationOnRecord(box, { harness: 'claude', cwd: botHomeOf(bots, 'api-bot'), id: 'sess-1' });
  await box.orca.orphan(before.handle);
  return { bots, ...before };
}

const since = async (box, from) => (await box.orca.calls()).slice(from);
const callCount = async (box) => (await box.orca.calls()).length;
const creates = (calls) => orcaCallsOf(calls, 'terminal create');
const sends = (calls) => orcaCallsOf(calls, 'terminal send');
const closes = (calls) => orcaCallsOf(calls, 'terminal close');

/** A `--json` answer, parsed. */
function answerOf(result) {
  assert.equal(result.code, 0, result.stderr);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
}

/** The one entry of an up/restart answer about a named tab. */
function tabEntry(answer, bot, name) {
  const found = (answer.tabs ?? []).filter((one) => one.bot === bot && one.name === name);
  assert.equal(found.length, 1, `one entry about ${bot}/${name}, got: ${JSON.stringify(answer.tabs)}`);
  return found[0];
}

const resumeLine = (box, id) => `${bareLaunch(box, 'claude', 'api-bot', 'daily')} --resume ${id}`;

// -------------------------------------------------------------------- up

for (const [label, args] of [
  ['obk up --bot', ['up', '--bots', 'bots', '--bot', 'api-bot', '--json']],
  ['obk up for the fleet', ['up', '--bots', 'bots', '--json']],
]) {
  test(`OT1 ${label}: a session whose tab is listed orphaned is found, not opened again`, async (t) => {
    // Also the proof that `up` kept what it needs to recognise the tab when it
    // opened it: the orphaned state came after that run, and nothing else ran.
    const box = await createSandbox(t);
    const { bots, tabId, handle, terminal } = await orphanedSession(box);
    const from = await callCount(box);

    const answer = answerOf(await box.run(args));

    const calls = await since(box, from);
    assert.deepEqual(creates(calls), [], 'no second tab: the session\'s own tab is open');
    assert.deepEqual(sends(calls), [], 'and nothing typed, so no second harness');
    const entry = tabEntry(answer, 'api-bot', 'daily');
    assert.equal(entry.tabId, tabId, 'reported under the book\'s tab id, not the pty: one Orca listed');
    assert.equal(entry.terminal, handle);
    assert.equal(entry.created, false);
    assert.equal((await sessionIn(bots, 'api-bot', 'daily')).tab, tabId, 'the book keeps the real tab id');
    assert.deepEqual(typedInto((await tabOf(box, bots)).terminal), typedInto(terminal));
  });
}

/**
 * The reviewer's reproduction (PR #190): a book written before any of this —
 * the tab, when it was launched, the conversation, nothing else — and the
 * session's tab listed as orphaned before any run of this version has seen it.
 */
async function oldBookOrphaned(box) {
  const { bots, tabId, handle, terminal } = await orphanedSession(box);
  const file = bookOf(bots, 'api-bot');
  const book = parse(await readFile(file, 'utf8'));
  const old = ['tab', 'launched', 'session', 'history', 'unclaimed'];
  book.sessions.daily = Object.fromEntries(Object.entries(book.sessions.daily).filter(([key]) => old.includes(key)));
  await writeFile(file, stringify(book));
  assert.equal(book.sessions.daily.session, 'sess-1', 'the conversation is in the book, so a duplicate would resume it');
  return { bots, tabId, handle, terminal };
}

test('OT2 up recognises an orphaned tab from a book written before this change: nothing opened, nothing typed', async (t) => {
  const box = await createSandbox(t);
  const { bots, tabId, handle, terminal } = await oldBookOrphaned(box);
  const from = await callCount(box);

  const answer = answerOf(await box.run(['up', '--bots', 'bots', '--bot', 'api-bot', '--json']));

  const calls = await since(box, from);
  assert.deepEqual(creates(calls), [], 'no second tab: the session\'s own tab is open');
  assert.deepEqual(sends(calls), [], 'and nothing typed, so no second harness on sess-1');
  const entry = tabEntry(answer, 'api-bot', 'daily');
  assert.equal(entry.tabId, tabId, 'reported under the book\'s tab id');
  assert.equal(entry.terminal, handle);
  assert.equal((await sessionIn(bots, 'api-bot', 'daily')).tab, tabId);
  assert.deepEqual(typedInto((await tabOf(box, bots)).terminal), typedInto(terminal));
});

test('OT2 health says nothing about an orphaned tab from a book written before this change', async (t) => {
  const box = await createSandbox(t);
  const { tabId, handle } = await oldBookOrphaned(box);
  const ownPty = (await box.orca.terminals()).find((one) => one.handle === handle).ptyId;

  const result = await box.run(['health', '--bots', 'bots', '--json']);

  const { found } = JSON.parse(result.stdout);
  const words = (one) => `${one.where} ${one.says}`;
  assert.deepEqual(
    found.filter((one) => one.kind === 'session' || words(one).includes(ownPty) || words(one).includes(tabId) || words(one).includes(handle)),
    [],
    `not lost, not a leftover, got: ${JSON.stringify(found, null, 2)}`,
  );
});

test('OT3 Bot Father: an orphaned session tab is not taken for the ops tab, and the real ops tab still is', async (t) => {
  const box = await createSandbox(t);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const bots = box.path('bots');
  const { inBook: [daily], leftovers: [ops] } = await botFatherTabs(box, bots);
  await box.orca.orphan(daily.handle);
  const from = await callCount(box);

  const answer = answerOf(await box.run(['up', '--bots', 'bots', '--json']));

  assert.deepEqual(creates(await since(box, from)), [], 'both tabs are there: nothing to open');
  assert.equal(tabEntry(answer, 'bot-father', 'daily').tabId, daily.tabId);
  assert.equal(tabEntry(answer, 'bot-father', null).tabId, ops.tabId, 'the ops tab is the plain one, as ever');
});

test('OT3 Bot Father: with the ops tab gone, an orphaned session tab does not stand in for it', async (t) => {
  const box = await createSandbox(t);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const bots = box.path('bots');
  const { inBook: [daily], leftovers: [ops] } = await botFatherTabs(box, bots);
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.tabId !== ops.tabId) });
  await box.orca.orphan(daily.handle);
  const from = await callCount(box);

  const result = await box.run(['up', '--bots', 'bots']);

  assert.equal(result.code, 0, result.stderr);
  const made = creates(await since(box, from));
  assert.equal(made.length, 1, `one tab, the ops tab, got: ${JSON.stringify(made.map((call) => call.args))}`);
  assert.equal(orcaFlag(made[0], '--title'), TAB_TITLES.ops);
  const after = (await box.orca.terminals()).find((one) => one.handle === daily.handle);
  assert.deepEqual(typedInto(after), typedInto(daily), 'the session tab is left as it was');
  assert.equal((await sessionIn(bots, 'bot-father', 'daily')).tab, daily.tabId);
});

// -------------------------------------------------------------------- health

test('OT4 health does not call an orphaned session tab lost or a leftover, and still reports an orphaned stranger', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const { tabId, handle } = await tabOf(box, bots);
  const clean = JSON.parse((await box.run(['health', '--bots', 'bots', '--json'])).stdout);
  assert.deepEqual(clean.found, [], 'the fleet starts clean, or this proves nothing');
  await box.orca.orphan(handle);
  // The contrast: an orphaned terminal in the same project that is no session's.
  const home = botHomeOf(bots, 'api-bot');
  const [setup] = (await box.orca.setups()).filter((one) => one.path === home);
  const strangerPty = `${setup.id}::${home}@@0badcafe`;
  await box.orca.set({
    terminals: [...await box.orca.terminals(), {
      handle: 'term_stranger',
      tabId: 'tab_stranger',
      paneKey: 'tab_stranger:leaf_stranger',
      ptyId: strangerPty,
      leafId: 'leaf_stranger',
      worktreeId: `${setup.id}::${home}`,
      worktreePath: home,
      title: 'someone else',
      agentIdentity: null,
      orphaned: true,
      typed: [],
    }],
  });
  const ownPty = (await box.orca.terminals()).find((one) => one.handle === handle).ptyId;

  const result = await box.run(['health', '--bots', 'bots', '--json']);

  const { found } = JSON.parse(result.stdout);
  const words = (one) => `${one.where} ${one.says}`;
  assert.deepEqual(
    found.filter((one) => words(one).includes(ownPty) || words(one).includes(tabId) || words(one).includes(handle)),
    [],
    `nothing about the session's own tab, got: ${JSON.stringify(found, null, 2)}`,
  );
  assert.deepEqual(found.filter((one) => one.kind === 'session'), [], 'no lost session');
  // Named by whichever id the finding uses: the one Orca lists, or the real one.
  const strays = found.filter((one) => one.kind === 'leftover'
    && ['tab_stranger', strangerPty, 'term_stranger'].some((id) => words(one).includes(id)));
  assert.equal(strays.length, 1, `the stranger is still a leftover, got: ${JSON.stringify(found, null, 2)}`);
});

// -------------------------------------------------------------------- restart

test('OT5 restart closes an orphaned session tab by its handle and brings the session back in a new one', async (t) => {
  const box = await createSandbox(t);
  const { bots, tabId, handle } = await orphanedSession(box);
  const from = await callCount(box);

  const answer = answerOf(await box.run(['restart', '--bots', 'bots', '--bot', 'api-bot', '--json']));

  const calls = await since(box, from);
  const closed = closes(calls);
  assert.equal(closed.length, 1, `one close, got: ${JSON.stringify(calls.map((call) => call.args))}`);
  assert.equal(orcaFlag(closed[0], '--terminal'), handle);
  assert.ok(closed[0].args.includes('--tab'));
  assert.ok(calls.every((call) => !call.args.includes('--all')), 'never the whole-project close');
  assert.deepEqual(
    answer.closed,
    [{ bot: 'api-bot', name: 'daily', tabId, terminal: handle }],
    'reported under the book\'s tab id, not the pty: one',
  );
  const made = creates(calls);
  assert.equal(made.length, 1);
  assert.ok(calls.indexOf(closed[0]) < calls.indexOf(made[0]), 'the old tab goes first');
  const after = await tabOf(box, bots);
  assert.notEqual(after.tabId, tabId);
  assert.deepEqual(typedInto(after.terminal).map(tokenless), [resumeLine(box, 'sess-1')]);
  assert.equal((await box.orca.terminals()).some((one) => one.handle === handle), false, 'the old tab is gone');
});

test('OT5 restart waits for an orphaned tab to leave the listing, and never opens a new one beside it', async (t) => {
  // A listing that keeps the closed tab for ever, orphaned. Looking for the
  // tab by the id Orca lists it under would find nothing and open a second
  // harness beside the first; the run has to stop instead.
  const box = await createSandbox(t);
  const { bots, tabId, handle } = await orphanedSession(box);
  await box.orca.set({ closeLag: 100000 });
  const from = await callCount(box);

  const result = await box.run(['restart', '--bots', 'bots', '--bot', 'api-bot']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes(tabId) || result.stderr.includes(handle), `name the tab it waits on, got: ${result.stderr}`);
  const calls = await since(box, from);
  assert.equal(closes(calls).length, 1);
  assert.deepEqual(creates(calls), [], 'no second tab while the first is still listed');
  assert.equal((await sessionIn(bots, 'api-bot', 'daily')).session, 'sess-1');
});

// -------------------------------------------------------------------- message

test('OT6 message send still tells an orphaned tab to look, by its handle', async (t) => {
  const box = await createSandbox(t);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  for (const [bot, harness] of [['writer', 'claude'], ['coder', 'codex']]) {
    assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness])).code, 0);
    assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', 'daily'])).code, 0);
  }
  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);
  const bots = box.path('bots');
  const reader = await tabOf(box, bots, 'coder');
  await box.orca.orphan(reader.handle);
  const from = await callCount(box);

  const result = await box.run([
    'message', 'send', '--bots', 'bots', '--to', 'coder', '--from', 'writer/daily',
    '--subject', 'the staging host', '--text', 'It is down again.',
  ]);

  assert.equal(result.code, 0, result.stderr);
  const typed = sends(await since(box, from));
  assert.deepEqual(typed.map((call) => orcaFlag(call, '--terminal')), [reader.handle], 'one line, into the reader\'s tab');
  const after = (await box.orca.terminals()).find((one) => one.handle === reader.handle);
  assert.equal(typedInto(after).length, typedInto(reader.terminal).length + 1);
  assert.ok(typedInto(after).at(-1).includes('obk message check'), `the nudge, got: ${typedInto(after).at(-1)}`);
});

// Sanity for the fake itself: the orphaned state is how Orca lists the tab, not
// something the fake keeps to itself.
test('OT0 the fake lists an orphaned terminal as Orca 1.4.207 does, and only that one', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const { tabId, handle } = await tabOf(box, bots);
  const bf = (await tabsOfBot(box, bots, 'bot-father')).map((one) => one.handle);
  await box.orca.orphan(handle);

  const { result } = JSON.parse((await sh(`'${box.orca.cli}' terminal list --json`, { env: box.env })).stdout);

  const mine = result.terminals.find((one) => one.handle === handle);
  assert.equal(mine.tabId, `pty:${mine.ptyId}`);
  assert.equal(mine.leafId, `pty:${mine.ptyId}`);
  assert.equal(mine.orphaned, true);
  assert.match(mine.ptyId, /::.*@@[0-9a-f]{8}$/);
  for (const other of result.terminals.filter((one) => bf.includes(one.handle))) {
    assert.equal(other.orphaned, false);
    assert.ok(!other.tabId.startsWith('pty:'));
  }

  const shown = JSON.parse((await sh(`'${box.orca.cli}' terminal show --terminal ${handle} --json`, { env: box.env })).stdout);
  assert.equal(shown.result.terminal.tabId, tabId, 'show gives the real tab id while list gives pty:');
  assert.equal(shown.result.terminal.orphaned, true, 'and still says it is orphaned');
  assert.equal(shown.result.terminal.handle, handle);

  await box.orca.orphan(handle, false);
  const back = JSON.parse((await sh(`'${box.orca.cli}' terminal list --json`, { env: box.env })).stdout);
  assert.equal(back.result.terminals.find((one) => one.handle === handle).tabId, tabId, 'and back to its real id');
});
