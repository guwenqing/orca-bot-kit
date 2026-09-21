// What it takes for a session to be reachable at all, and what `obk up`
// writes down about it (PRD 6.9, ADR 0008, and the brief's piece 1).
//
// Three things, and each one was forced by a live check on 2026-09-21:
//
//   1. A Claude session is launched under its own name, `<bot>.<session>`.
//      That name is the address native messaging uses, it survives a resume,
//      and the kit passes `-n` on every launch anyway (tech notes, section 2).
//   2. A Codex session is launched with `-c
//      sandbox_workspace_write.network_access=true`. Without it a Codex bot at
//      the kit's own approval level cannot reach the Orca CLI at all — every
//      call answers `runtime_unavailable` — so it could neither send nor read
//      fleet mail (tech notes, section 3). It is on by default and the user
//      can turn it off for a session, because it widens that session's sandbox
//      beyond localhost and there is no narrower setting.
//   3. Every session gets a Run mailbox, made once and kept for ever. A
//      terminal handle is not an address to keep: Orca calls it a legacy
//      mailbox that dies with the tab, and refuses a send to a handle whose
//      pane is gone. A Run is refused nothing, so `up` makes one per session
//      and writes it in the book beside the tab.
//
// A Run cannot be deleted — Orca has no command for it — so making one twice
// is a Run that belongs to nothing for ever. That is why `up` making exactly
// one, however often it runs, is a test of its own.

import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';
import { stringify } from 'yaml';

import {
  addressOf,
  assertOrcaCallsAllowed,
  bareLaunch,
  bookIn,
  bookOf,
  CODEX_NETWORK,
  createSandbox,
  orcaCallsOf,
  sessionIn,
  tabsOfBot,
  typedInto,
} from './helpers/cli.js';

/** A bots folder with one bot on `harness` and the sessions named, nothing brought up yet. */
async function withBot(box, harness, sessions, { bot = 'api-bot' } = {}) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness]);
  assert.equal(made.code, 0, made.stderr);
  for (const [name, ...settings] of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', name, ...settings]);
    assert.equal(added.code, 0, added.stderr);
  }
  return box.path('bots');
}

/** Bring one bot up, and give back the line typed into each of its tabs, by title. */
async function up(box, bots, bot = 'api-bot') {
  const result = await box.run(['up', '--bots', 'bots', '--bot', bot]);
  assert.equal(result.code, 0, result.stderr);
  const lines = {};
  for (const tab of await tabsOfBot(box, bots, bot)) {
    const typed = typedInto(tab);
    assert.equal(typed.length, 1, `one line per new session tab, got ${JSON.stringify(typed)}`);
    [lines[tab.title]] = typed;
  }
  return { result, lines };
}

test('a Claude session is launched under its own name: <bot>.<session>', async (t) => {
  // The name is the address. Two sessions of the one bot, so a name that
  // followed the bot alone — or a name that was written once and reused —
  // shows up as two sessions answering to the same address.
  const box = await createSandbox(t);
  const bots = await withBot(box, 'claude', [['daily'], ['night']]);

  const { lines } = await up(box, bots);

  assert.equal(lines['Api Bot daily'], bareLaunch('claude', 'api-bot', 'daily'));
  assert.equal(lines['Api Bot night'], bareLaunch('claude', 'api-bot', 'night'));
  assert.ok(lines['Api Bot night'].includes('-n api-bot.night'), `got: ${lines['Api Bot night']}`);
});

test('a Codex session is launched with the sandbox switch that lets it reach Orca', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'codex', [['daily']]);

  const { lines } = await up(box, bots);

  assert.equal(lines['Api Bot daily'], bareLaunch('codex'));
  assert.ok(lines['Api Bot daily'].includes(CODEX_NETWORK), `got: ${lines['Api Bot daily']}`);
});

test('a Codex session whose user turned the network off is launched without the switch', async (t) => {
  // The switch widens the sandbox beyond localhost, and a user who does not
  // want that says so per session. Nothing else about the line changes.
  const box = await createSandbox(t);
  const bots = await withBot(box, 'codex', [['daily', '--no-network'], ['night']]);

  const { lines } = await up(box, bots);

  assert.ok(
    !lines['Api Bot daily'].includes('sandbox_workspace_write'),
    `the session that said no should carry no sandbox setting, got: ${lines['Api Bot daily']}`,
  );
  assert.equal(lines['Api Bot daily'], `${bareLaunch('codex').replace(` ${CODEX_NETWORK}`, '')}`);
  assert.equal(lines['Api Bot night'], bareLaunch('codex'), 'and the session beside it is untouched');
});

test('--no-network on a Claude session changes nothing: the switch is Codex\'s', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'claude', [['daily', '--no-network']]);

  const { lines } = await up(box, bots);

  assert.equal(lines['Api Bot daily'], bareLaunch('claude', 'api-bot', 'daily'));
});

test('up gives a Claude session a mailbox and writes both addresses in the book', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'claude', [['daily']]);

  await up(box, bots);

  const daily = await sessionIn(bots, 'api-bot', 'daily');
  const runs = await box.orca.runs();
  assert.equal(runs.length, 1, `one Run should have been made, got: ${JSON.stringify(runs)}`);
  assert.equal(daily.mailbox, runs[0].id, `the book should hold the Run Orca made, got: ${JSON.stringify(daily)}`);
  assert.equal(daily.address, addressOf('api-bot', 'daily'), `and the name it is launched under: ${JSON.stringify(daily)}`);
});

test('up gives a Codex session a mailbox too, and it is the only address it has', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'codex', [['daily']]);

  await up(box, bots);

  const daily = await sessionIn(bots, 'api-bot', 'daily');
  const runs = await box.orca.runs();
  assert.equal(daily.mailbox, runs[0].id, `got: ${JSON.stringify(daily)}`);
});

test('every session of a bot gets a mailbox, and no two share one', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'claude', [['daily'], ['night'], ['weekend']]);

  await up(box, bots);

  const { sessions } = await bookIn(bots, 'api-bot');
  const mailboxes = Object.values(sessions).map((session) => session.mailbox);
  assert.equal(mailboxes.length, 3);
  assert.ok(mailboxes.every((id) => typeof id === 'string' && id !== ''), `each one a Run: ${JSON.stringify(sessions)}`);
  assert.equal(new Set(mailboxes).size, 3, `three sessions, three mailboxes: ${JSON.stringify(sessions)}`);
});

test('a mailbox is made once and kept, however many times up runs', async (t) => {
  // A Run cannot be deleted: Orca has no command for it, and `orchestration
  // reset --messages` would empty the whole machine's mailbox. So a second one
  // is rubbish that stays on the user's machine for ever.
  const box = await createSandbox(t);
  const bots = await withBot(box, 'claude', [['daily']]);

  await up(box, bots);
  const first = await sessionIn(bots, 'api-bot', 'daily');
  await up(box, bots);
  await up(box, bots);

  assert.equal(
    orcaCallsOf(await box.orca.calls(), 'orchestration run-create').length,
    1,
    'three runs of up, one Run made',
  );
  assert.equal((await sessionIn(bots, 'api-bot', 'daily')).mailbox, first.mailbox, 'and the book still names it');
  assert.equal((await box.orca.runs()).length, 1);
});

test('a session whose book entry has no mailbox is given one at the next up', async (t) => {
  // The honest case behind "cannot be reached yet": a book written before this
  // existed, or by hand. `up` is what fills it in.
  const box = await createSandbox(t);
  const bots = await withBot(box, 'claude', [['daily']]);
  await up(box, bots);
  const book = await bookIn(bots, 'api-bot');
  delete book.sessions.daily.mailbox;
  await writeFile(bookOf(bots, 'api-bot'), stringify(book));

  const again = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(again.code, 0, again.stderr);
  const daily = await sessionIn(bots, 'api-bot', 'daily');
  assert.ok(typeof daily.mailbox === 'string' && daily.mailbox !== '', `got: ${JSON.stringify(daily)}`);
  assert.ok(
    (await box.orca.runs()).some((run) => run.id === daily.mailbox),
    `and it is a Run Orca really made: ${JSON.stringify(await box.orca.runs())}`,
  );
});

test('every Orca call an up that makes mailboxes makes is one of the allowed ones', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'codex', [['daily'], ['night']]);

  await up(box, bots);

  assertOrcaCallsAllowed(await box.orca.calls());
});
