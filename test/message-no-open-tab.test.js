// `obk message to` and `obk message send` to a receiver with no open tab
// (#841, R1).
//
// From Orca 1.4.262, Orca deletes the mailbox (a Run) of a session whose tab is
// not open, with every letter in it, a day after its last write (#820). So a
// letter to a paused session, or to one whose tab is gone, does not wait until
// the session starts. R1, as the owner signed it:
//
//   When the receiver of `obk message to` or `obk message send` has no open
//   tab (it is paused, or its tab is gone), the answer MUST say that Orca can
//   delete its mailbox, with the letters in it, 24 hours after the last letter
//   or read, unless the session starts first. It MUST name the command that
//   starts it. The letter still goes, by the same road as before.
//
//   The kit MAY give these words on every Orca version, and name Orca 1.4.262
//   in them, so that it does not have to read the version of Orca.
//
//   The kit MUST NOT keep a copy of a letter, write to a mailbox to keep it
//   alive, or open a tab to keep it alive.
//
// What is pinned:
//
//   - "No open tab": the book names a mailbox for the receiver, and Orca's tab
//     listing does not list the tab the book names for it. That is a paused
//     session (pause closes its tab), a session of a paused bot, and a session
//     whose tab is gone. A session marked paused whose tab Orca still lists has
//     an open tab, and gets no warning.
//   - On the Orca road, for such a receiver: the JSON answer has
//     `noOpenTab: true` and `start`, the start command. The plain report has a
//     line that says the receiver has no open tab, names Orca 1.4.262, says
//     that Orca can delete its mailbox, with the letters in it, 24 hours after
//     the last letter or read, unless the session starts first, and gives the
//     start command.
//   - The start command, `<cli>` the kit's own CLI and `<bots>` the bots
//     folder: `<cli> up --bots <bots> --bot <bot> --session <session>` for a
//     session that is not paused; `<cli> unpause --bots <bots> --bot <bot>
//     --session <session>` for a paused session; `<cli> unpause --bots <bots>
//     --bot <bot>` for a session of a paused bot; both, the bot's first, joined
//     by ", then ", when the session is also paused on its own. It is the one
//     `obk message check` gives for a session whose tab is not open.
//   - `message send` still sends, to the same `run:<id>`. Its plain report
//     does not say that Orca's notice tells the receiver to look once it is
//     idle: there is no tab for a notice.
//   - The send keeps no copy of the letter in the sandbox, writes nothing else
//     to the receiver's Run, makes no Run, opens no tab and types nothing.
//   - Unchanged: a receiver with an open tab (no `noOpenTab` key, none of the
//     words), a native-road answer, and a receiver with no mailbox yet.
//
// The words are the kit's; the facts are matched loosely, by key words and the
// command, with the kit's own CLI and the bots folder in either of the
// spellings a shell reads as one word (helpers/cli.js, spellingsOf). Every
// test runs through the CLI on a sandboxed bots folder against the fake Orca.
// The kit gives the words on every Orca version, so the fake's version is left
// as it is.

import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import {
  assertRefused,
  bookOf,
  botHomeOf,
  createSandbox,
  orcaCallsOf,
  orcaCommand,
  orcaFlag,
  sessionIn,
  spellingsOf,
} from './helpers/cli.js';
import { listSession } from './helpers/claude-registry.js';
import { addSession } from './helpers/permissions.js';

// ---------------------------------------------------------------- the fleet

/**
 * Bot Father, a Claude sender (writer), a Codex receiver (coder, with two
 * sessions), a Claude receiver in another approval class (skipper), and a
 * Claude receiver in the sender's own class (reader), all up.
 */
async function fleet(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  for (const [bot, harness, sessions, settings] of [
    ['writer', 'claude', ['daily'], []],
    ['coder', 'codex', ['daily', 'night'], []],
    ['skipper', 'claude', ['daily'], ['--approval', 'dangerously-skip']],
    ['reader', 'claude', ['daily'], []],
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

/** Run one more `obk` command that has to work for the test to mean anything. */
async function obk(box, args) {
  const result = await box.run(args);
  assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stderr}${result.stdout}`);
  return result;
}

/** A conversation id, shaped the way both harnesses shape one. */
const conv = (n) => `0199b2c0-${String(n).padStart(4, '0')}-4444-8888-cccccccccccc`;

/** Give every session of a bot a conversation in the book, so that a pause will take it. */
async function conversationsFor(bots, bot) {
  const file = bookOf(bots, bot);
  const book = parse(await readFile(file, 'utf8'));
  for (const [n, name] of Object.keys(book.sessions).entries()) book.sessions[name].session = conv(60 + n);
  await writeFile(file, stringify(book));
}

/** The Orca tab the book names for one session, as the fake Orca lists it, or undefined. */
async function listedTab(box, bots, bot, session) {
  const { tab } = (await sessionIn(bots, bot, session)) ?? {};
  return (await box.orca.terminals()).find((one) => one.tabId === tab);
}

/** The mailbox the book names for one session. */
async function mailboxOf(bots, bot, session) {
  const { mailbox } = (await sessionIn(bots, bot, session)) ?? {};
  assert.ok(typeof mailbox === 'string' && /^run_/.test(mailbox), `the premise: the book names a mailbox for ${bot}/${session}, got: ${mailbox}`);
  return mailbox;
}

/** Take one session's tab out of Orca's listing: its tab is gone. The book still names it. */
async function tabGone(box, bots, bot, session) {
  const terminal = await listedTab(box, bots, bot, session);
  assert.ok(terminal !== undefined, `the premise: Orca lists ${bot}/${session}'s tab before it goes`);
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.handle !== terminal.handle) });
}

/** Put a tab back into Orca's listing, as Orca had it: a pause closed it. */
async function stillListed(box, terminal) {
  const now = await box.orca.terminals();
  if (!now.some((one) => one.handle === terminal.handle)) await box.orca.set({ terminals: [...now, terminal] });
}

/** Each way the kit may spell `<cli> <verb> --bots <bots> --bot <bot>`. */
const commandsOf = (box, bots, verb, bot) => spellingsOf(box.cli)
  .flatMap((cli) => spellingsOf(bots).map((folder) => `${cli} ${verb} --bots ${folder} --bot ${bot}`));

/**
 * The ways a receiver has no open tab, each with how the test makes it so and
 * the start command, in every spelling the kit may give it. The receiver is
 * `<bot>/daily`.
 */
const NO_OPEN_TAB = {
  'its tab is gone': {
    make: (box, bots, bot) => tabGone(box, bots, bot, 'daily'),
    starts: (box, bots, bot) => commandsOf(box, bots, 'up', bot).map((one) => `${one} --session daily`),
  },
  'it is paused': {
    make: async (box, bots, bot) => {
      await conversationsFor(bots, bot);
      await obk(box, ['pause', '--bots', 'bots', '--bot', bot, '--session', 'daily']);
    },
    starts: (box, bots, bot) => commandsOf(box, bots, 'unpause', bot).map((one) => `${one} --session daily`),
  },
  'its bot is paused': {
    make: async (box, bots, bot) => {
      await conversationsFor(bots, bot);
      await obk(box, ['pause', '--bots', 'bots', '--bot', bot]);
    },
    starts: (box, bots, bot) => commandsOf(box, bots, 'unpause', bot),
  },
  'it is paused, and its bot is paused': {
    make: async (box, bots, bot) => {
      await conversationsFor(bots, bot);
      await obk(box, ['pause', '--bots', 'bots', '--bot', bot, '--session', 'daily']);
      await obk(box, ['pause', '--bots', 'bots', '--bot', bot]);
    },
    // The bot's unpause leaves the session's own mark: both, the bot's first.
    starts: (box, bots, bot) => spellingsOf(box.cli).flatMap((cli) => spellingsOf(bots).map((folder) => {
      const unpause = `${cli} unpause --bots ${folder} --bot ${bot}`;
      return `${unpause}, then ${unpause} --session daily`;
    })),
  },
};

/** Make `<bot>/daily` have no open tab in the way `way` names, and check the premise. */
async function noOpenTab(box, bots, bot, way) {
  await NO_OPEN_TAB[way].make(box, bots, bot);
  await mailboxOf(bots, bot, 'daily');
  assert.equal(await listedTab(box, bots, bot, 'daily'), undefined, `the premise: Orca does not list ${bot}/daily's tab once ${way}`);
}

// --------------------------------------------------------------- the asking

/** `obk message to` from writer/daily to `where`, with `more` after it. */
const to = (box, where, more = []) => box.run(['message', 'to', '--bots', 'bots', '--to', where, '--from', 'writer/daily', ...more]);

/** `obk message send` from writer/daily to `where`, with `more` after it. */
const send = (box, where, more = [], { text = 'It is down again.' } = {}) => box.run([
  'message', 'send', '--bots', 'bots', '--to', where, '--from', 'writer/daily',
  '--subject', 'the staging host', '--text', text, ...more,
]);

/** The text answer of a run that went through. */
function textOf(result) {
  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  return result.stdout;
}

/** The `--json` answer of a run that went through, parsed. */
function jsonOf(result) {
  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
}

// ---------------------------------------------------------------- the words

/** That the receiver has no open tab. */
const NO_OPEN_TAB_WORDS = /\bno open tab\b|\btab is not open\b|\bno tab (is )?open\b|\bnot have an open tab\b|\bhas no tab\b/i;

/** The line a send prints today when it trusts Orca's notice. */
const NOTICE_CLAIM = /notice tells it to look/i;

/** Whether `text` gives one of `starts` as a command of its own: nothing of a word or a `--session` runs on after it. */
const givesStart = (text, starts) => starts.some((command) => {
  for (let at = text.indexOf(command); at >= 0; at = text.indexOf(command, at + 1)) {
    const rest = text.slice(at + command.length);
    if (!/^[A-Za-z0-9_-]/.test(rest) && !/^\s*--session\b/.test(rest)) return true;
  }
  return false;
});

/**
 * The facts of R1's first sentence, one by one, that `line` misses: the
 * receiver has no open tab; Orca 1.4.262; Orca can delete its mailbox, with
 * the letters in it; 24 hours after the last letter or read; unless the
 * session starts first; and the start command.
 */
function missingFacts(line, starts) {
  const facts = [
    ['that it has no open tab', NO_OPEN_TAB_WORDS.test(line)],
    ['Orca 1.4.262', /\bOrca 1\.4\.262\b/.test(line)],
    ['that Orca can delete its mailbox', /\bdelet/i.test(line) && /\bmailbox\b/i.test(line)],
    ['with the letters in it', /\bletters\b/i.test(line)],
    ['24 hours', /\b24 hours\b/i.test(line)],
    ['after the last letter or read', /\blast letter\b/i.test(line) && /\bread\b/i.test(line)],
    ['unless the session starts first', /\bunless\b.{0,80}\bstart/i.test(line)],
    ['the start command', givesStart(line, starts)],
  ];
  return facts.filter(([, ok]) => !ok).map(([name]) => name);
}

/** The plain report has one line with every fact of R1's first sentence. */
function assertSaysNoOpenTab(text, starts) {
  const lines = text.split('\n');
  const best = lines
    .map((line) => ({ line, missing: missingFacts(line, starts) }))
    .sort((a, b) => a.missing.length - b.missing.length)[0];
  assert.deepEqual(
    best.missing,
    [],
    `one line of the report should say the receiver has no open tab, name Orca 1.4.262, say that Orca can delete its mailbox, `
      + `with the letters in it, 24 hours after the last letter or read, unless the session starts first, and give the start command `
      + `(one of: ${starts.join(' | ')}). The nearest line misses ${best.missing.join(', ')}. The report:\n${text}`,
  );
}

/** None of R1's words: no open tab, Orca 1.4.262, 24 hours. */
function assertSaysNothingOfIt(text) {
  assert.doesNotMatch(text, NO_OPEN_TAB_WORDS, `nothing about no open tab, got:\n${text}`);
  assert.ok(!text.includes('1.4.262'), `no Orca 1.4.262, got:\n${text}`);
  assert.doesNotMatch(text, /\b24 hours\b/i, `no 24 hours, got:\n${text}`);
}

/** The JSON answer of a receiver with no open tab: noOpenTab true, and the start command as one of its spellings. */
function assertJsonNoOpenTab(answer, starts) {
  assert.equal(answer.noOpenTab, true, `the answer should carry noOpenTab: true, got: ${JSON.stringify(answer)}`);
  assert.ok(starts.includes(answer.start), `and start, the command that starts the receiver, one of:\n${starts.join('\n')}\ngot: ${JSON.stringify(answer.start)}`);
}

// ---------------------------------------------------------------------------
// R1 sentence 1: the answer says it, and names the start command
// ---------------------------------------------------------------------------

for (const way of Object.keys(NO_OPEN_TAB)) {
  test(`#841 R1 "the answer MUST say that Orca can delete its mailbox ... and MUST name the command that starts it": message to a Codex receiver when ${way}`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await noOpenTab(box, bots, 'coder', way);
    const starts = NO_OPEN_TAB[way].starts(box, bots, 'coder');

    const answer = jsonOf(await to(box, 'coder/daily', ['--json']));
    const plain = textOf(await to(box, 'coder/daily'));

    assert.equal(answer.transport, 'orca', `the premise: the Orca road, got: ${JSON.stringify(answer)}`);
    assert.equal(answer.address, `run:${await mailboxOf(bots, 'coder', 'daily')}`, `the address is the receiver's mailbox as before, got: ${JSON.stringify(answer)}`);
    assertJsonNoOpenTab(answer, starts);
    assertSaysNoOpenTab(plain, starts);
  });

  test(`#841 R1 "the answer MUST say ... MUST name the command that starts it. The letter still goes, by the same road as before": message send to a Codex receiver when ${way}`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await noOpenTab(box, bots, 'coder', way);
    const starts = NO_OPEN_TAB[way].starts(box, bots, 'coder');
    const mailbox = await mailboxOf(bots, 'coder', 'daily');

    const answer = jsonOf(await send(box, 'coder/daily', ['--json']));
    const plain = textOf(await send(box, 'coder/daily'));

    assert.equal(answer.sent, true, `the letter went, got: ${JSON.stringify(answer)}`);
    const queued = await box.orca.messages();
    assert.deepEqual(queued.map((one) => one.to), [`run:${mailbox}`, `run:${mailbox}`], 'both letters are in the receiver\'s own mailbox, run:<id>, as before');
    assertJsonNoOpenTab(answer, starts);
    assertSaysNoOpenTab(plain, starts);
    assert.doesNotMatch(plain, NOTICE_CLAIM, `with no tab there is no notice, so the report must not say Orca's notice tells it to look, got:\n${plain}`);
  });
}

test('#841 R1 "the answer MUST say ... MUST name the command that starts it": message to and send to a Claude receiver in another approval class whose tab is gone', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await noOpenTab(box, bots, 'skipper', 'its tab is gone');
  const starts = NO_OPEN_TAB['its tab is gone'].starts(box, bots, 'skipper');

  const asked = jsonOf(await to(box, 'skipper/daily', ['--json']));
  const sent = jsonOf(await send(box, 'skipper/daily', ['--json']));
  const plain = textOf(await send(box, 'skipper/daily'));

  assert.equal(asked.transport, 'orca', `the premise: the Orca road, got: ${JSON.stringify(asked)}`);
  assertJsonNoOpenTab(asked, starts);
  assert.equal(sent.sent, true, `the letter went, got: ${JSON.stringify(sent)}`);
  assertJsonNoOpenTab(sent, starts);
  assertSaysNoOpenTab(plain, starts);
  assert.doesNotMatch(plain, NOTICE_CLAIM, `no claim of Orca's notice, got:\n${plain}`);
});

// ---------------------------------------------------------------------------
// An open tab: no warning
// ---------------------------------------------------------------------------

test('#841 R1 "has no open tab": a receiver whose tab Orca lists gets today\'s answer and none of the words, while its sibling with no tab gets them', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  // coder/night's tab is gone; coder/daily's is open.
  await tabGone(box, bots, 'coder', 'night');
  const nightStarts = commandsOf(box, bots, 'up', 'coder').map((one) => `${one} --session night`);

  const asked = jsonOf(await to(box, 'coder/daily', ['--json']));
  const askedPlain = textOf(await to(box, 'coder/daily'));
  const sent = jsonOf(await send(box, 'coder/daily', ['--json']));
  const sentPlain = textOf(await send(box, 'coder/daily'));
  const sibling = jsonOf(await send(box, 'coder/night', ['--json']));

  for (const [what, answer] of [['message to', asked], ['message send', sent]]) {
    assert.ok(!Object.hasOwn(answer, 'noOpenTab'), `${what}: no noOpenTab key for a receiver whose tab is open, got: ${JSON.stringify(answer)}`);
    assert.ok(!JSON.stringify(answer).includes('1.4.262'), `${what}: none of the words in the JSON, got: ${JSON.stringify(answer)}`);
  }
  assertSaysNothingOfIt(askedPlain);
  assertSaysNothingOfIt(sentPlain);
  assert.match(sentPlain, NOTICE_CLAIM, `today's line, that Orca's notice tells it to look, got:\n${sentPlain}`);
  assertJsonNoOpenTab(sibling, nightStarts);
});

test('#841 R1 "has no open tab": a receiver marked paused whose tab Orca still lists has an open tab, and gets no warning; a paused one with no tab does', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await conversationsFor(bots, 'coder');
  const kept = await listedTab(box, bots, 'coder', 'daily');
  await obk(box, ['pause', '--bots', 'bots', '--bot', 'coder', '--session', 'daily']);
  await obk(box, ['pause', '--bots', 'bots', '--bot', 'coder', '--session', 'night']);
  // Orca still lists daily's tab; night's is closed.
  await stillListed(box, kept);
  assert.ok(await listedTab(box, bots, 'coder', 'daily'), 'the premise: Orca lists daily\'s tab');
  assert.equal(await listedTab(box, bots, 'coder', 'night'), undefined, 'the premise: Orca does not list night\'s tab');
  const nightStarts = commandsOf(box, bots, 'unpause', 'coder').map((one) => `${one} --session night`);

  const daily = jsonOf(await send(box, 'coder/daily', ['--json']));
  const dailyPlain = textOf(await send(box, 'coder/daily'));
  const night = jsonOf(await send(box, 'coder/night', ['--json']));

  assert.equal(daily.sent, true, `the letter went, got: ${JSON.stringify(daily)}`);
  assert.ok(!Object.hasOwn(daily, 'noOpenTab'), `no noOpenTab key while Orca lists the tab, got: ${JSON.stringify(daily)}`);
  assertSaysNothingOfIt(dailyPlain);
  assertJsonNoOpenTab(night, nightStarts);
});

// ---------------------------------------------------------------------------
// R1 sentence 5: no copy, no write to keep it alive, no tab
// ---------------------------------------------------------------------------

/** Every file under `dir`, at any depth, but the fake Orca's own world. */
async function filesUnder(dir, root = dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const at = path.join(dir, entry.name);
    if (path.relative(root, at) === 'orca-fake') continue;
    if (entry.isDirectory()) found.push(...await filesUnder(at, root));
    else if (entry.isFile()) found.push(at);
  }
  return found;
}

/** The files in the sandbox, the fake Orca's world aside, that hold `text`. */
async function filesHolding(box, text) {
  const holding = [];
  for (const file of await filesUnder(box.root)) {
    if ((await readFile(file)).includes(text)) holding.push(file);
  }
  return holding;
}

/** The Orca calls a send may not make: a Run made or bound, mail read or acked, a tab made, typed into or moved. */
const NOT_A_SEND = [
  'orchestration run-create', 'orchestration run-use', 'orchestration check', 'orchestration reply',
  'terminal create', 'terminal send', 'terminal switch', 'terminal focus',
];

/** What one send to `where` with body `text` added, against what was there before it: the guard of R1's last sentence. */
async function assertSendKeptNothing(box, where, mailbox, text) {
  const runs = await box.orca.runs();
  const handles = (await box.orca.terminals()).map((one) => one.handle);
  const letters = (await box.orca.messages()).length;
  const from = (await box.orca.calls()).length;

  const answer = jsonOf(await send(box, where, ['--json'], { text }));

  assert.equal(answer.sent, true, `${where}: the letter went, got: ${JSON.stringify(answer)}`);
  const added = (await box.orca.messages()).slice(letters);
  assert.deepEqual(added.map((one) => ({ to: one.to, body: one.body })), [{ to: `run:${mailbox}`, body: text }], `${where}: exactly one letter, in the receiver's Run, and nothing else written to it`);
  assert.deepEqual(await filesHolding(box, text), [], `${where}: no copy of the letter is kept anywhere in the sandbox`);
  assert.deepEqual(await box.orca.runs(), runs, `${where}: no Run made, bound or changed`);
  assert.deepEqual((await box.orca.terminals()).map((one) => one.handle), handles, `${where}: no tab opened or closed`);
  const calls = (await box.orca.calls()).slice(from);
  assert.deepEqual(calls.filter((call) => NOT_A_SEND.includes(orcaCommand(call))).map((call) => call.args), [], `${where}: no Run made or bound, no mail read or acked, no tab made, typed into or moved`);
  assert.deepEqual(orcaCallsOf(calls, 'orchestration send').map((call) => orcaFlag(call, '--to')), [`run:${mailbox}`], `${where}: one send, to run:<id>`);
  return answer;
}

for (const way of ['its tab is gone', 'it is paused']) {
  test(`#841 R1 "the kit MUST NOT keep a copy of a letter, write to a mailbox to keep it alive, or open a tab to keep it alive": a send to a receiver with no open tab (${way}), beside one with an open tab`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await noOpenTab(box, bots, 'coder', way);
    assert.ok(await listedTab(box, bots, 'coder', 'night'), 'the premise: coder/night\'s tab is open');

    const open = await assertSendKeptNothing(box, 'coder/night', await mailboxOf(bots, 'coder', 'night'), 'zq-letter-body-crowberry-5162');
    const none = await assertSendKeptNothing(box, 'coder/daily', await mailboxOf(bots, 'coder', 'daily'), 'zq-letter-body-wolfberry-3381');

    // Last, so the guard above is read first: the send did see which receiver has no open tab.
    assert.ok(!Object.hasOwn(open, 'noOpenTab'), `an open tab: no noOpenTab, got: ${JSON.stringify(open)}`);
    assert.equal(none.noOpenTab, true, `no open tab: the answer says so, got: ${JSON.stringify(none)}`);
  });
}

// ---------------------------------------------------------------------------
// Unchanged: the native road, and a receiver with no mailbox yet
// ---------------------------------------------------------------------------

test('#841 R1 "when the road is the Orca mailbox": a native-road answer is unchanged, while an Orca-road receiver with no tab gets the words', async (t) => {
  // A native receiver is listed live in the sender's Claude registry (#700),
  // and the fake ps knows a live harness only in a tab Orca lists. So with its
  // tab gone the same receiver is on the Orca road, and gets the words too.
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await listSession(box, bots, 'reader');
  await tabGone(box, bots, 'coder', 'daily');
  const coderStarts = NO_OPEN_TAB['its tab is gone'].starts(box, bots, 'coder');

  const native = jsonOf(await to(box, 'reader/daily', ['--json']));
  const nativePlain = textOf(await to(box, 'reader/daily'));
  const orca = jsonOf(await to(box, 'coder/daily', ['--json']));
  await tabGone(box, bots, 'reader', 'daily');
  const unlisted = jsonOf(await to(box, 'reader/daily', ['--json']));

  assert.equal(native.transport, 'native', `the premise: the native road, got: ${JSON.stringify(native)}`);
  assert.equal(native.address, (await sessionIn(bots, 'reader', 'daily')).address, `at the receiver's own address, got: ${JSON.stringify(native)}`);
  assert.ok(!Object.hasOwn(native, 'noOpenTab'), `no noOpenTab on the native road, got: ${JSON.stringify(native)}`);
  assertSaysNothingOfIt(nativePlain);
  assertJsonNoOpenTab(orca, coderStarts);
  assert.equal(unlisted.transport, 'orca', `the premise: with its tab gone the receiver is not listed live, and goes by the mailbox, got: ${JSON.stringify(unlisted)}`);
  assertJsonNoOpenTab(unlisted, NO_OPEN_TAB['its tab is gone'].starts(box, bots, 'reader'));
});

test('#841 R1 "the receiver has no open tab": a receiver with no mailbox yet keeps its refusal, and has none of the words; a sibling with a mailbox and no tab gets them', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await obk(box, ['session', 'add', '--bots', 'bots', '--bot', 'coder', '--name', 'weekend']);
  assert.equal((await sessionIn(bots, 'coder', 'weekend'))?.mailbox, undefined, 'the premise: coder/weekend was never brought up, and has no mailbox');
  await tabGone(box, bots, 'coder', 'daily');
  const dailyStarts = NO_OPEN_TAB['its tab is gone'].starts(box, bots, 'coder');

  const refused = await to(box, 'coder/weekend');
  const sibling = jsonOf(await to(box, 'coder/daily', ['--json']));

  assertRefused(refused, 'weekend', 'obk up');
  assertSaysNothingOfIt(`${refused.stdout}${refused.stderr}`);
  assertJsonNoOpenTab(sibling, dailyStarts);
});


// ---------------------------------------------------------------------------
// A receiver whose bot has no Orca project any more (review of PR #842)
// ---------------------------------------------------------------------------
//
// The book still names the receiver's mailbox and tab, but Orca has no project
// for the bot's folder: `terminal list --worktree path:<home>` is refused
// `selector_not_found` (the fake does so for a path none of its setups has),
// and the tab is not there. That receiver has no open tab. A listing that
// fails for another reason, the project still there, says nothing of the tab,
// and the answer stays as it is today (test/message-send-orphaned.test.js, MO7).

/** Take the Orca project of `bot`'s folder away, and the tabs in it: Orca has no project for it any more. */
async function projectGone(box, bots, bot) {
  const home = botHomeOf(bots, bot);
  const setups = await box.orca.setups();
  assert.ok(setups.some((one) => one.path === home), `the premise: Orca has a project for ${home}, got: ${JSON.stringify(setups.map((one) => one.path))}`);
  const state = await box.orca.state();
  await box.orca.set({
    setups: setups.filter((one) => one.path !== home),
    terminals: state.terminals.filter((one) => one.worktreePath !== home),
  });
}

/** The words of today's send when the kit cannot read Orca's tab listing (MO7). */
const COULD_NOT_TELL = /\b(could ?n[o']t|cannot|can't|unable to|did not|does not|do not) (tell|know|read|see|say)\b|\bnot known\b|\bunknown\b/i;

test('#841 R1 "the receiver has no open tab (it is paused, or its tab is gone)": message to a receiver whose bot has no Orca project any more says it, with its start command', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await projectGone(box, bots, 'coder');
  const starts = NO_OPEN_TAB['its tab is gone'].starts(box, bots, 'coder');

  const answer = jsonOf(await to(box, 'coder/daily', ['--json']));
  const plain = textOf(await to(box, 'coder/daily'));

  assert.equal(answer.transport, 'orca', `the premise: the Orca road, got: ${JSON.stringify(answer)}`);
  assert.equal(answer.address, `run:${await mailboxOf(bots, 'coder', 'daily')}`, `the address is the receiver's mailbox as before, got: ${JSON.stringify(answer)}`);
  assertJsonNoOpenTab(answer, starts);
  assertSaysNoOpenTab(plain, starts);
});

test('#841 R1 "The letter still goes, by the same road as before": message send to a receiver whose bot has no Orca project any more is sent, and says it has no open tab, not that the kit could not tell', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await projectGone(box, bots, 'coder');
  const starts = NO_OPEN_TAB['its tab is gone'].starts(box, bots, 'coder');
  const mailbox = await mailboxOf(bots, 'coder', 'daily');

  const answer = jsonOf(await send(box, 'coder/daily', ['--json']));
  const plain = textOf(await send(box, 'coder/daily'));

  assert.equal(answer.sent, true, `the letter went, got: ${JSON.stringify(answer)}`);
  assert.deepEqual((await box.orca.messages()).map((one) => one.to), [`run:${mailbox}`, `run:${mailbox}`], 'both letters are in the receiver\'s own mailbox, run:<id>, as before');
  assertJsonNoOpenTab(answer, starts);
  assertSaysNoOpenTab(plain, starts);
  assert.doesNotMatch(plain, /could not tell whether the Orca window has loaded its tab/i, `the kit knows there is no tab: not that it could not tell, got:\n${plain}`);
  assert.doesNotMatch(plain, NOTICE_CLAIM, `no claim of Orca's notice, got:\n${plain}`);
});

test('#841 R1 "has no open tab": a tab listing that fails for another reason, the project still there, gives today\'s answer; a receiver whose project is gone gets the words', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await projectGone(box, bots, 'coder');
  const starts = NO_OPEN_TAB['its tab is gone'].starts(box, bots, 'coder');

  // The project gone: the words.
  const gone = jsonOf(await send(box, 'coder/daily', ['--json']));
  // Skipper's project is there, and every tab listing fails another way.
  await box.orca.set({ fail: { 'terminal list': { code: 'runtime_error', message: 'the listing is not there' } } });
  const asked = jsonOf(await to(box, 'skipper/daily', ['--json']));
  const askedPlain = textOf(await to(box, 'skipper/daily'));
  const sent = jsonOf(await send(box, 'skipper/daily', ['--json']));
  const sentPlain = textOf(await send(box, 'skipper/daily'));

  for (const [what, answer] of [['message to', asked], ['message send', sent]]) {
    assert.ok(!Object.hasOwn(answer, 'noOpenTab'), `${what}: a listing that failed says nothing of the tab, so no noOpenTab, got: ${JSON.stringify(answer)}`);
  }
  assert.equal(sent.sent, true, `the letter went, got: ${JSON.stringify(sent)}`);
  assertSaysNothingOfIt(askedPlain);
  assertSaysNothingOfIt(sentPlain);
  assert.match(sentPlain, COULD_NOT_TELL, `the send keeps its line that the kit could not tell, got:\n${sentPlain}`);
  assert.match(sentPlain, /load/i, `whether the Orca window has loaded the receiver's tab, got:\n${sentPlain}`);
  // Last: the receiver whose project is gone has no open tab.
  assertJsonNoOpenTab(gone, starts);
});
