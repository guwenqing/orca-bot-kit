// What it takes for a session to be reachable at all, and what `obk up`
// writes down about it (PRD 6.9, ADR 0018, and the brief's piece 1).
//
// Three things, and each one was forced by a live check on 2026-09-21:
//
//   1. A Claude session is launched under its own name, which is the address
//      native messaging uses. It survives a resume, and the kit passes `-n` on
//      every launch anyway (tech notes, section 2). The name is
//      `<bot>.<session>.<token>`, the token new each time the kit starts a
//      session on a fresh conversation (#286): Claude Code refuses a send to a
//      name more than one session answers to, and every fleet's Bot Father
//      used to answer to `bot-father.daily`. Whatever the line carries is what
//      the book holds.
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
import { parse, stringify } from 'yaml';

import {
  addressPattern,
  assertOrcaCallsAllowed,
  bareLaunch,
  bookIn,
  bookOf,
  CODEX_NETWORK,
  createSandbox,
  launchLine,
  nameOnLine,
  orcaCallsOf,
  sessionIn,
  tabsOfBot,
  tokenless,
  typedInto,
} from './helpers/cli.js';

/** What a user writes to turn the sandbox switch off for one session, and the words it becomes. */
const OFF_WORDS = `-c ${CODEX_NETWORK.split(' ')[1].replace('=true', '=false')}`;
const OFF = ['--extra-arg=-c', `--extra-arg=${CODEX_NETWORK.split(' ')[1].replace('=true', '=false')}`];

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

test('a Claude session is launched under its own name: <bot>.<session>.<token>', async (t) => {
  // The name is the address. Two sessions of the one bot, so a name that
  // followed the bot alone — or a name that was written once and reused —
  // shows up as two sessions answering to the same address.
  const box = await createSandbox(t);
  const bots = await withBot(box, 'claude', [['daily'], ['night']]);

  const { lines } = await up(box, bots);

  assert.equal(tokenless(lines['Api Bot daily']), bareLaunch(box, 'claude', 'api-bot', 'daily'));
  assert.equal(tokenless(lines['Api Bot night']), bareLaunch(box, 'claude', 'api-bot', 'night'));
  assert.match(nameOnLine(lines['Api Bot daily']), addressPattern('api-bot', 'daily'));
  assert.match(nameOnLine(lines['Api Bot night']), addressPattern('api-bot', 'night'));
  for (const session of ['daily', 'night']) {
    assert.equal(
      (await sessionIn(bots, 'api-bot', session)).address,
      nameOnLine(lines[`Api Bot ${session}`]),
      `the book holds the name the line carried, for ${session}`,
    );
  }
});

test('two bots folders with the same bot and session names give their sessions different addresses', async (t) => {
  // The case behind #286: every fleet has a Bot Father with a daily session,
  // and so does every throwaway fleet a system test brings up. Two fleets that
  // named their sessions alike must still not share an address, or Claude Code
  // refuses the send.
  const one = await createSandbox(t);
  const other = await createSandbox(t);
  const first = await withBot(one, 'claude', [['daily']]);
  const second = await withBot(other, 'claude', [['daily']]);

  const a = (await up(one, first)).lines['Api Bot daily'];
  const b = (await up(other, second)).lines['Api Bot daily'];

  assert.match(nameOnLine(a), addressPattern('api-bot', 'daily'));
  assert.match(nameOnLine(b), addressPattern('api-bot', 'daily'));
  assert.notEqual(nameOnLine(a), nameOnLine(b), 'two fleets, two addresses');
  assert.equal((await sessionIn(first, 'api-bot', 'daily')).address, nameOnLine(a));
  assert.equal((await sessionIn(second, 'api-bot', 'daily')).address, nameOnLine(b));
});

test('Bot Father\'s daily session in two fleets answers to two different addresses', async (t) => {
  // The very name the issue was reported against: `init` brings Bot Father up
  // itself, and the name it launches under is the fleet's own.
  const one = await createSandbox(t);
  const other = await createSandbox(t);
  for (const box of [one, other]) {
    const made = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
    assert.equal(made.code, 0, made.stderr);
  }

  const [a, b] = await Promise.all([one, other].map(async (box) => ({
    book: (await sessionIn(box.path('bots'), 'bot-father', 'daily')).address,
    line: nameOnLine(typedInto((await tabsOfBot(box, box.path('bots'), 'bot-father')).find((tab) => tab.typed?.length))[0]),
  })));

  assert.match(a.line, addressPattern('bot-father', 'daily'));
  assert.match(b.line, addressPattern('bot-father', 'daily'));
  assert.notEqual(a.line, b.line);
  assert.equal(a.book, a.line, 'and each book holds the name its own line carried');
  assert.equal(b.book, b.line);
});

test('a session started fresh again is given a new address, not the one it had', async (t) => {
  // No harness session in the book, so the next start is a new conversation.
  // The old address may still be answered by the harness that is gone — a
  // tab closed with its harness still running, or a conversation the user
  // opens again by hand — so the new one must not share it.
  const box = await createSandbox(t);
  const bots = await withBot(box, 'claude', [['daily']]);
  const before = (await up(box, bots)).lines['Api Bot daily'];
  assert.equal((await sessionIn(bots, 'api-bot', 'daily')).session, undefined, 'nothing to resume');
  // The user closed the tab, so the next run opens another and types the line.
  await box.orca.set({ terminals: [] });

  const after = (await up(box, bots)).lines['Api Bot daily'];

  assert.ok(!after.includes('--resume'), `a fresh start, got: ${after}`);
  assert.match(nameOnLine(after), addressPattern('api-bot', 'daily'));
  assert.notEqual(nameOnLine(after), nameOnLine(before), 'a fresh start is a new address');
  assert.equal((await sessionIn(bots, 'api-bot', 'daily')).address, nameOnLine(after), 'and the book follows it');
});

test('a Codex session is launched with the sandbox switch that lets it reach Orca', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'codex', [['daily']]);

  const { lines } = await up(box, bots);

  assert.equal(lines['Api Bot daily'], bareLaunch(box, 'codex'));
  assert.ok(lines['Api Bot daily'].includes(CODEX_NETWORK), `got: ${lines['Api Bot daily']}`);
});

test('a Codex session whose user turned the network off is launched without the switch', async (t) => {
  // The switch widens that session's sandbox beyond localhost and there is no
  // narrower setting, so a user who does not want it says so for that session.
  // Their own setting wins and the kit adds nothing beside it; nothing else
  // about the line changes, and the session beside it is untouched.
  const box = await createSandbox(t);
  const bots = await withBot(box, 'codex', [['daily', ...OFF], ['night']]);

  const { lines } = await up(box, bots);

  assert.equal(lines['Api Bot daily'], launchLine(box, `codex --approve-for-me ${OFF_WORDS}`));
  assert.ok(
    !lines['Api Bot daily'].includes(CODEX_NETWORK),
    `the kit must not put its own switch back beside theirs, got: ${lines['Api Bot daily']}`,
  );
  assert.equal(lines['Api Bot night'], bareLaunch(box, 'codex'), 'and the session beside it is untouched');
});

test('a session that asks for the switch itself is not given it twice', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'codex', [['daily', '--extra-arg=-c', `--extra-arg=${CODEX_NETWORK.split(' ')[1]}`]]);

  const { lines } = await up(box, bots);

  assert.equal(lines['Api Bot daily'], launchLine(box, `codex --approve-for-me ${CODEX_NETWORK}`));
});

test('up gives a Claude session a mailbox and writes both addresses in the book', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'claude', [['daily']]);

  await up(box, bots);

  const daily = await sessionIn(bots, 'api-bot', 'daily');
  assert.ok(
    (await box.orca.runs()).some((run) => run.id === daily.mailbox),
    `the book should hold a Run Orca really made, got: ${JSON.stringify(daily)}`,
  );
  assert.match(String(daily.address), addressPattern('api-bot', 'daily'), `and the name it is launched under: ${JSON.stringify(daily)}`);
  assert.equal(
    daily.address,
    nameOnLine(typedInto((await tabsOfBot(box, bots, 'api-bot'))[0])[0]),
    'which is the name on the line the tab was started with',
  );
});

test('up gives a Codex session a mailbox too, and it is the only address it has', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'codex', [['daily']]);

  await up(box, bots);

  const daily = await sessionIn(bots, 'api-bot', 'daily');
  assert.ok(
    (await box.orca.runs()).some((run) => run.id === daily.mailbox),
    `a Codex session's mailbox is a Run like any other, got: ${JSON.stringify(daily)}`,
  );
  assert.equal(daily.address, undefined, `Codex has no session name to be reached at: ${JSON.stringify(daily)}`);
});

test('a session fleet mail cannot reach is given no mailbox at all', async (t) => {
  // A Codex session whose sandbox cannot reach Orca could never read a Run of
  // its own, and a Run cannot be taken back: there is no `run-delete`, and the
  // one command that empties mailboxes empties the whole machine's. So the
  // choice is between rubbish that stays on the user's machine for ever and
  // saying plainly that this session is out of reach.
  const box = await createSandbox(t);
  const bots = await withBot(box, 'codex', [['daily', ...OFF], ['night']]);

  await up(box, bots);

  assert.equal((await sessionIn(bots, 'api-bot', 'daily')).mailbox, undefined, 'the one that cannot read gets none');
  assert.ok(
    typeof (await sessionIn(bots, 'api-bot', 'night')).mailbox === 'string',
    'and the session beside it, which can, gets one as usual',
  );
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
  // Bot Father was brought up by `init` and has a mailbox of its own already.
  const before = (await box.orca.runs()).length;
  const made = orcaCallsOf(await box.orca.calls(), 'orchestration run-create').length;

  await up(box, bots);
  const first = await sessionIn(bots, 'api-bot', 'daily');
  await up(box, bots);
  await up(box, bots);

  assert.equal((await box.orca.runs()).length, before + 1, 'three runs of up, one Run made');
  assert.equal(
    orcaCallsOf(await box.orca.calls(), 'orchestration run-create').length,
    made + 1,
    'and it was asked for once, not asked for and thrown away',
  );
  assert.equal((await sessionIn(bots, 'api-bot', 'daily')).mailbox, first.mailbox, 'and the book still names it');
});

test('two runs at the same moment leave the session with the mailbox that was written first', async (t) => {
  // The case running `up` twice in a row cannot reach. Both runs read a book
  // with no mailbox in it and both ask Orca for a Run, because the Orca call is
  // made outside the book's lock; what must not happen is the later one writing
  // its Run over the one already in the book. A session whose mailbox is
  // replaced is a session that no longer reads the mailbox its fleet has been
  // writing to, and whatever was waiting in the first one is unreachable — Orca
  // has no way to hand a Run's mail to another Run, or to delete either.
  //
  // The overlap is arranged rather than hoped for: the fake runs the second
  // `up` to completion in the middle of the first one's `run-create`, so the
  // second one has read, made its Run and written the book before the first one
  // has its own Run in hand.
  const box = await createSandbox(t);
  const bots = await withBot(box, 'claude', [['daily']]);
  await up(box, bots);
  const book = await bookIn(bots, 'api-bot');
  delete book.sessions.daily.mailbox;
  await writeFile(bookOf(bots, 'api-bot'), stringify(book));
  const runsBefore = (await box.orca.runs()).length;
  await box.orca.set({
    runDuring: {
      command: 'orchestration run-create',
      on: orcaCallsOf(await box.orca.calls(), 'orchestration run-create').length + 1,
      // The second run, and then the book as it left it: what the first run
      // must not undo.
      argv: ['/bin/sh', '-c', `obk up --bots ${bots} --bot api-bot > /dev/null && cat ${bookOf(bots, 'api-bot')}`],
    },
  });

  const first = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(first.code, 0, first.stderr);
  const ran = await box.orca.ranDuring();
  assert.equal(ran.length, 1, `the second run should have gone through the middle of the first, got: ${JSON.stringify(ran)}`);
  assert.equal(ran[0].status, 0, `and it should not have failed: ${ran[0].stderr}`);

  const wonIt = (parse(ran[0].stdout) ?? {}).sessions?.daily?.mailbox;
  assert.ok(typeof wonIt === 'string', `the second run should have written a mailbox, got: ${ran[0].stdout}`);
  assert.equal(
    (await sessionIn(bots, 'api-bot', 'daily')).mailbox,
    wonIt,
    'the book keeps the mailbox that was there, and the later run leaves its own Run unused',
  );
  assert.equal(
    (await box.orca.runs()).length,
    runsBefore + 2,
    'both runs did ask Orca for one, which is what makes this worth guarding: the ask is outside the lock',
  );
});

test('and the same when neither run has opened the session\'s tab yet', async (t) => {
  // The same requirement one branch over. The book is written in two places —
  // beside the tab a run has just opened, and on its own for a session whose
  // tab was already there — and a session that has never been up goes through
  // the first of them. Both runs open a tab and both make a Run; the book ends
  // up naming the tab of whichever run wrote last, which is a real tab, and the
  // mailbox of whichever wrote first, which is where the fleet's mail is.
  const box = await createSandbox(t);
  const bots = await withBot(box, 'claude', [['daily']]);
  const runsBefore = (await box.orca.runs()).length;
  await box.orca.set({
    runDuring: {
      command: 'orchestration run-create',
      on: orcaCallsOf(await box.orca.calls(), 'orchestration run-create').length + 1,
      argv: ['/bin/sh', '-c', `obk up --bots ${bots} --bot api-bot > /dev/null && cat ${bookOf(bots, 'api-bot')}`],
    },
  });

  const first = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(first.code, 0, first.stderr);
  const ran = await box.orca.ranDuring();
  assert.equal(ran.length, 1, `the second run should have gone through the middle of the first, got: ${JSON.stringify(ran)}`);
  assert.equal(ran[0].status, 0, `and it should not have failed: ${ran[0].stderr}`);

  const wonIt = (parse(ran[0].stdout) ?? {}).sessions?.daily?.mailbox;
  assert.ok(typeof wonIt === 'string', `the second run should have written a mailbox, got: ${ran[0].stdout}`);
  const daily = await sessionIn(bots, 'api-bot', 'daily');
  assert.equal(daily.mailbox, wonIt, 'the mailbox the session already had is the one it keeps, tab or no tab');
  assert.equal((await box.orca.runs()).length, runsBefore + 2, 'and both runs did ask Orca for one');
  assert.ok(
    (await tabsOfBot(box, bots, 'api-bot')).some((tab) => tab.tabId === daily.tab),
    `and the tab the book names is one Orca really has: ${JSON.stringify(daily)}`,
  );
});

test('a session that was already running is given a mailbox and no name', async (t) => {
  // The upgrade: a session started by a kit that did not name sessions, its tab
  // still live. Nothing renames a live harness — the name is what `-n` put on
  // the line that started it — so a run that finds the tab already there may
  // write the mailbox and must not write a name. A name in the book that no
  // harness answers to is worse than none: it is an address the fleet would be
  // told to write to, and nothing would ever arrive.
  const box = await createSandbox(t);
  const bots = await withBot(box, 'claude', [['daily']]);
  await up(box, bots);
  const book = await bookIn(bots, 'api-bot');
  delete book.sessions.daily.address;
  delete book.sessions.daily.mailbox;
  await writeFile(bookOf(bots, 'api-bot'), stringify(book));

  const again = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(again.code, 0, again.stderr);
  const daily = await sessionIn(bots, 'api-bot', 'daily');
  assert.ok(typeof daily.mailbox === 'string', `it can be written to: ${JSON.stringify(daily)}`);
  assert.equal(daily.address, undefined, `and it answers to no name: ${JSON.stringify(daily)}`);
  assert.deepEqual(
    typedInto((await tabsOfBot(box, bots, 'api-bot'))[0]).slice(1),
    [],
    'and the run typed nothing into a tab that was already live',
  );
});

test('a session whose tab this run opened is given its name, because the line carried it', async (t) => {
  // The other side of it, and the reason the two can be told apart: this run
  // typed the launch line, so it knows what name the harness came up under.
  const box = await createSandbox(t);
  const bots = await withBot(box, 'claude', [['daily']]);
  await up(box, bots);
  const book = await bookIn(bots, 'api-bot');
  delete book.sessions.daily.address;
  await writeFile(bookOf(bots, 'api-bot'), stringify(book));
  // The user closed the tab, so the next run opens another and types the line.
  await box.orca.set({ terminals: [] });

  const again = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(again.code, 0, again.stderr);
  const daily = await sessionIn(bots, 'api-bot', 'daily');
  assert.match(String(daily.address), addressPattern('api-bot', 'daily'), `got: ${JSON.stringify(daily)}`);
  assert.equal(
    daily.address,
    nameOnLine(typedInto((await tabsOfBot(box, bots, 'api-bot'))[0])[0]),
    'and that is the name the line it typed carried',
  );
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
