// `obk message to`: which road a message between two sessions takes, and the
// address at the end of it. Nothing is sent.
//
// This is PRD 6.9's rule that the bot never picks the transport, made into a
// command: a bot asks, and is told. Two things decide it and nothing else
// (ADR 0018):
//
//   native   both ends are Claude sessions in the same approval class. Claude
//            Code has two classes, bypassing (`--dangerously-skip-permissions`)
//            and prompting (everything else), and a message across them is
//            held for approval — so the kit calls that pair `orca` in advance
//            rather than letting it hang. The address is the receiver's own
//            session name, `<bot>.<session>.<token>`: the one its launch line
//            carried and its book holds, whatever the token is (#286).
//   orca     everything else: Codex at either end, or a mixed-approval pair.
//            The address is the receiver's mailbox, `run:<id>`.
//
// The refusals matter as much as the answers. A bot that is told an address
// for a session that was never brought up would send into nowhere and never
// hear about it, and "the target does not exist" and "which of this bot's
// sessions did you mean" are the two ways a name goes wrong.
//
// A Codex session whose user turned the sandbox switch off is a third: it is a
// real session with a real mailbox, and it cannot reach the Orca CLI to read
// it (tech notes, section 3). Fleet mail cannot reach it, and the kit says so
// rather than queueing messages nobody will ever read.

import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';
import { stringify } from 'yaml';

import {
  addressPattern,
  assertRefused,
  bookIn,
  bookOf,
  createSandbox,
  nameOnLine,
  orcaCallsOf,
  recordSession,
  sessionIn,
  tabsOfBot,
  typedInto,
} from './helpers/cli.js';

/**
 * What a user writes to keep one Codex session's sandbox off the network. It
 * is the same switch the kit sets, set the other way, and theirs wins.
 */
const NETWORK_OFF = ['--extra-arg=-c', '--extra-arg=sandbox_workspace_write.network_access=false'];

/**
 * The bots the tables below talk between: one per harness and approval level
 * that changes the answer, each with one session called `daily`.
 */
const FLEET = [
  ['auto-one', 'claude', ['--approval', 'auto']],
  ['auto-two', 'claude', ['--approval', 'auto']],
  ['ask-bot', 'claude', ['--approval', 'ask']],
  ['skip-one', 'claude', ['--approval', 'dangerously-skip']],
  ['skip-two', 'claude', ['--approval', 'dangerously-skip']],
  ['codex-one', 'codex', ['--approval', 'auto']],
  ['codex-two', 'codex', ['--approval', 'auto']],
];

/** A bots folder holding `fleet`, every session brought up, so every one has a mailbox. */
async function fleetIn(box, fleet = FLEET) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  for (const [bot, harness, settings = [], sessions = ['daily']] of fleet) {
    const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness]);
    assert.equal(made.code, 0, made.stderr);
    for (const session of sessions) {
      const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', session, ...settings]);
      assert.equal(added.code, 0, added.stderr);
    }
  }
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  return box.path('bots');
}

/**
 * `obk message to`, asked for its answer as JSON. `tab` runs it the way a
 * session runs it: inside its own Orca tab, which is where `--from` comes from
 * when it is left out.
 */
async function askTo(box, args, { tab } = {}) {
  const result = await box.run(['message', 'to', '--bots', 'bots', ...args, '--json'], {
    env: tab === undefined ? undefined : { ...box.env, ORCA_TAB_ID: tab },
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
}

/** The Orca tab one session sits in, which is how a command run inside it knows who it is. */
async function tabOf(box, bots, bot, session = 'daily') {
  const tabs = await tabsOfBot(box, bots, bot);
  const wanted = (await sessionIn(bots, bot, session)).tab;
  const found = tabs.find((terminal) => terminal.tabId === wanted);
  assert.ok(found, `${bot}/${session} should have a tab, got ${JSON.stringify(tabs)}`);
  return found;
}

const PAIRS = [
  ['two auto Claude sessions', 'auto-one', 'auto-two', 'native'],
  ['an auto and an ask Claude session, both prompting', 'auto-one', 'ask-bot', 'native'],
  ['two dangerously-skip Claude sessions, both bypassing', 'skip-one', 'skip-two', 'native'],
  ['an auto sender and a dangerously-skip receiver', 'auto-one', 'skip-one', 'orca'],
  ['a dangerously-skip sender and an auto receiver', 'skip-one', 'auto-one', 'orca'],
  ['a Claude sender and a Codex receiver', 'auto-one', 'codex-one', 'orca'],
  ['a Codex sender and a Claude receiver', 'codex-one', 'auto-one', 'orca'],
  ['two Codex sessions', 'codex-one', 'codex-two', 'orca'],
];

for (const [label, from, to, transport] of PAIRS) {
  test(`${label}: ${transport}`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);

    const answer = await askTo(box, ['--to', to, '--from', `${from}/daily`]);

    assert.equal(answer.transport, transport, `got: ${JSON.stringify(answer)}`);
    const receiver = await sessionIn(bots, to, 'daily');
    assert.equal(
      answer.address,
      transport === 'native' ? receiver.address : `run:${receiver.mailbox}`,
      `the address is the receiver's, not the sender's: ${JSON.stringify(answer)}`,
    );
    if (transport === 'native') assert.match(answer.address, addressPattern(to, 'daily'));
  });
}

test('the answer is about the receiver, whichever of its sessions was named', async (t) => {
  // Two sessions of one bot have two mailboxes, and an answer that named the
  // bot's first session for both would be a message delivered to the wrong one.
  const box = await createSandbox(t);
  const bots = await fleetIn(box, [['codex-one', 'codex', [], ['daily', 'night']], ['auto-one', 'claude', []]]);

  const day = await askTo(box, ['--to', 'codex-one/daily', '--from', 'auto-one/daily']);
  const night = await askTo(box, ['--to', 'codex-one/night', '--from', 'auto-one/daily']);

  assert.equal(day.address, `run:${(await sessionIn(bots, 'codex-one', 'daily')).mailbox}`);
  assert.equal(night.address, `run:${(await sessionIn(bots, 'codex-one', 'night')).mailbox}`);
  assert.notEqual(day.address, night.address);
});

test('the native address is the name the receiver\'s harness was launched under', async (t) => {
  // #286: the address has to reach the live session on the first try, so it is
  // the very name on the line that started it, token and all.
  const box = await createSandbox(t);
  const bots = await fleetIn(box, [['auto-one', 'claude', []], ['auto-two', 'claude', []]]);
  const launched = nameOnLine(typedInto(await tabOf(box, bots, 'auto-two'))[0]);

  const answer = await askTo(box, ['--to', 'auto-two', '--from', 'auto-one/daily']);

  assert.equal(answer.transport, 'native', `got: ${JSON.stringify(answer)}`);
  assert.match(String(launched), addressPattern('auto-two', 'daily'));
  assert.equal(answer.address, launched);
});

test('a session a resume gave a new address is answered at the new one, not the bare name it had', async (t) => {
  // The upgrade: a book written before #286 holds `<bot>.<session>`, the name
  // every fleet's session of that name answers to. The resume launches it under
  // a name of its own, and the answer is that name.
  const box = await createSandbox(t);
  const bots = await fleetIn(box, [['auto-one', 'claude', []], ['auto-two', 'claude', []]]);
  const { tab } = await sessionIn(bots, 'auto-two', 'daily');
  const hook = await recordSession(box, { bots, bot: 'auto-two', tab, session: 'sess-1' });
  assert.equal(hook.code, 0, hook.stderr);
  const book = await bookIn(bots, 'auto-two');
  book.sessions.daily.address = 'auto-two.daily';
  await writeFile(bookOf(bots, 'auto-two'), stringify(book));
  // The tab was closed, so the next up resumes the conversation in a new one.
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((terminal) => terminal.tabId !== tab) });
  const up = await box.run(['up', '--bots', 'bots', '--bot', 'auto-two']);
  assert.equal(up.code, 0, up.stderr);
  const line = typedInto(await tabOf(box, bots, 'auto-two'))[0];
  assert.ok(line.includes('--resume sess-1'), `the run should have resumed, got: ${line}`);

  const answer = await askTo(box, ['--to', 'auto-two', '--from', 'auto-one/daily']);

  assert.equal(answer.transport, 'native', `got: ${JSON.stringify(answer)}`);
  assert.notEqual(answer.address, 'auto-two.daily', 'not the name every fleet shares');
  assert.match(answer.address, addressPattern('auto-two', 'daily'));
  assert.equal(answer.address, nameOnLine(line), 'the name the resumed harness came up under');
});

test('a bot named on its own is its one session', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);

  const named = await askTo(box, ['--to', 'codex-one/daily', '--from', 'auto-one/daily']);
  const alone = await askTo(box, ['--to', 'codex-one', '--from', 'auto-one']);

  assert.deepEqual(alone, named);
});

test('with no --from it answers for the session whose Orca tab it is running in', async (t) => {
  // The same way `session record` knows which session reported: `ORCA_TAB_ID`
  // is in the environment of everything running in a tab.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const tab = await tabOf(box, bots, 'skip-one');

  const answer = await askTo(box, ['--to', 'auto-one'], { tab: tab.tabId });

  assert.equal(answer.transport, 'orca', `the sender is the skip session, so this pair is mixed: ${JSON.stringify(answer)}`);
  assert.equal(answer.address, `run:${(await sessionIn(bots, 'auto-one', 'daily')).mailbox}`);
});

test('message to sends nothing and types nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const before = await box.orca.terminals();

  await askTo(box, ['--to', 'codex-one', '--from', 'auto-one/daily']);

  assert.deepEqual(orcaCallsOf(await box.orca.calls(), 'orchestration send'), [], 'nothing is sent');
  assert.deepEqual(await box.orca.messages(), [], 'and nothing is in the mailbox');
  assert.deepEqual(await box.orca.terminals(), before, 'and nothing was typed into anybody\'s tab');
});

test('without --json it says the same two things in plain words', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);

  const result = await box.run(['message', 'to', '--bots', 'bots', '--to', 'codex-one', '--from', 'auto-one/daily']);

  assert.equal(result.code, 0, result.stderr);
  const address = `run:${(await sessionIn(bots, 'codex-one', 'daily')).mailbox}`;
  assert.ok(result.stdout.includes(address), `the address should be there to read, got: ${result.stdout}`);
  assert.ok(/\borca\b/i.test(result.stdout), `and which road it is, got: ${result.stdout}`);
});

test('a Claude pair whose receiver answers to no name goes by the mailbox, and is told why', async (t) => {
  // The upgrade, end to end. A session started before the kit named sessions is
  // a Claude session like any other, in the same approval class as the sender,
  // and the native road cannot reach it: its harness came up with no `-n`, and
  // nothing renames a live one. Answering `native` here would hand the sender an
  // address no harness answers to, and the message would go nowhere with nothing
  // said. So the road is the mailbox, and the answer says which session it is
  // about rather than leaving the caller to wonder why it is not the usual one.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const book = await bookIn(bots, 'auto-two');
  delete book.sessions.daily.address;
  await writeFile(bookOf(bots, 'auto-two'), stringify(book));

  const answer = await askTo(box, ['--to', 'auto-two', '--from', 'auto-one/daily']);
  const plain = await box.run(['message', 'to', '--bots', 'bots', '--to', 'auto-two', '--from', 'auto-one/daily']);

  assert.equal(answer.transport, 'orca', `got: ${JSON.stringify(answer)}`);
  assert.equal(answer.address, `run:${(await sessionIn(bots, 'auto-two', 'daily')).mailbox}`);
  assert.equal(plain.code, 0, plain.stderr);
  assert.ok(
    plain.stdout.includes('auto-two/daily'),
    `the report should name the session this is about, got: ${plain.stdout}`,
  );
});

test('a bot that does not exist is refused, and named', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);

  const result = await box.run(['message', 'to', '--bots', 'bots', '--to', 'ghost-bot', '--from', 'auto-one/daily']);

  assertRefused(result, 'ghost-bot');
});

test('a session that does not exist is refused, and named', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);

  const result = await box.run(['message', 'to', '--bots', 'bots', '--to', 'auto-one/weekend', '--from', 'auto-one/daily']);

  assertRefused(result, 'weekend');
});

test('a bot with several sessions, named without one, is refused and the choices are listed', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box, [['auto-one', 'claude', []], ['busy-bot', 'claude', [], ['daily', 'night']]]);

  const result = await box.run(['message', 'to', '--bots', 'bots', '--to', 'busy-bot', '--from', 'auto-one/daily']);

  assertRefused(result, 'daily', 'night');
});

test('a session that was never brought up has no address, and is refused plainly', async (t) => {
  // It has no mailbox, because a mailbox is made at `up`. That is the honest
  // meaning of "cannot be reached yet", and the way out is in the message.
  const box = await createSandbox(t);
  await fleetIn(box);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'auto-one', '--name', 'night']);
  assert.equal(added.code, 0, added.stderr);

  const result = await box.run(['message', 'to', '--bots', 'bots', '--to', 'auto-one/night', '--from', 'auto-one/daily']);

  assertRefused(result, 'night', 'obk up');
});

test('a Codex session with the network turned off is reported unreachable by fleet mail', async (t) => {
  // It has a mailbox like any other session and cannot reach the Orca CLI to
  // read it. Saying so is the whole point: the alternative is a message that
  // is queued, acknowledged by nobody, and never read.
  const box = await createSandbox(t);
  const bots = await fleetIn(box, [['auto-one', 'claude', []], ['quiet-bot', 'codex', NETWORK_OFF]]);

  const result = await box.run(['message', 'to', '--bots', 'bots', '--to', 'quiet-bot', '--from', 'auto-one/daily']);

  assertRefused(result, 'quiet-bot', 'sandbox_workspace_write.network_access');
  assert.equal(
    (await sessionIn(bots, 'quiet-bot', 'daily')).mailbox,
    undefined,
    'and it was given no Run: a Run cannot be deleted, and this one could never be read',
  );
});

test('a --from that names nothing is refused', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);

  const result = await box.run(['message', 'to', '--bots', 'bots', '--to', 'auto-one', '--from', 'ghost-bot/daily']);

  assertRefused(result, 'ghost-bot');
});

test('no --from and no tab to read it from is refused', async (t) => {
  // Run from a plain shell rather than from a session's tab: the kit cannot
  // know who is asking, and a guess would pick the transport for the wrong pair.
  const box = await createSandbox(t);
  await fleetIn(box);

  const result = await box.run(['message', 'to', '--bots', 'bots', '--to', 'auto-one']);

  assertRefused(result, '--from');
});
