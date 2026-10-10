// What a session does when its harness refuses a native message (#521).
//
// `obk message to` answers `native` for a Claude session that writes to a
// Claude session in the same approval class: the sender writes with its own
// harness's messaging, and the kit carries nothing. That call can be refused,
// by a permission rule or by the harness itself. PRD-16 says what happens next:
// a message that is held or refused is not re-sent by another route; the
// sender waits, or the user decides. So the native answer says, in words:
//
//   - do not send it again by another road;
//   - tell your maker, or your user, that it was refused, with the harness's
//     reason;
//   - a refusal can mean a permission rule is missing, and whoever reads it can
//     fix that rule through the kit, after the user's yes.
//
// The same guidance is in the kit's rule unit `mail` ("Writing to another
// session", every bot's AGENTS.md), so a bot reads it before it needs it.
//
// The boundary is words only. The road and the address stay as they are, the
// native answer offers no `message send` command (that would be the second road
// PRD-16 forbids), and nothing is sent. An answer for the Orca road is not about
// a harness refusal and keeps its present form, `Send it:` line and all.
//
// The sentences are the implementer's to word and the reviewer's to read.
// These tests look for the meaning: a sentence about a refusal, a sentence that
// says no to another road, a sentence that tells the maker or user, and a
// sentence that ties a permission rule to the kit and the user's yes.

import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';
import { stringify } from 'yaml';

import {
  addressPattern,
  bookIn,
  bookOf,
  createSandbox,
  orcaCallsOf,
  sessionIn,
} from './helpers/cli.js';
import { agentsIn, blockIn, headingsIn, kitUnit, underIn } from './helpers/rules.js';

/** The kit's rule unit that tells a bot how to write to another session. */
const MAIL = 'mail';

/** A bots folder holding `fleet`, every session brought up, so every one has a mailbox and an address. */
async function fleetIn(box, fleet) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  for (const [bot, harness, settings = []] of fleet) {
    const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness]);
    assert.equal(made.code, 0, made.stderr);
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', 'daily', ...settings]);
    assert.equal(added.code, 0, added.stderr);
  }
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  return box.path('bots');
}

/** `obk message to` as a person reads it. */
async function plainTo(box, to, from) {
  const result = await box.run(['message', 'to', '--bots', 'bots', '--to', to, '--from', from]);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout;
}

/** `obk message to --json`, parsed. */
async function jsonTo(box, to, from) {
  const result = await box.run(['message', 'to', '--bots', 'bots', '--to', to, '--from', from, '--json']);
  assert.equal(result.code, 0, result.stderr);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
}

/** The first line of a plain answer: `<transport>  <bot>/<session>  <address>`. */
function roadLine(stdout) {
  const [transport, where, address] = stdout.split('\n')[0].trim().split(/\s+/);
  return { transport, where, address };
}

/**
 * The sentences of a text, whatever its line breaks: a sentence ends at `.`,
 * `!` or `?` before white space, at a blank line, or at a list item. A sentence
 * that runs on into the next only makes a check looser, never stricter.
 */
function sentencesOf(text) {
  return text
    .split(/\n\s*\n|\n\s*(?:[-*]|\d+\.)\s+/)
    .flatMap((part) => part.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/))
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/** Words that say a call was refused. */
const REFUSED = /\b(refus\w*|den(y|ies|ied)|reject\w*|block(s|ed)?)\b/i;

/** Words that say no. */
const NO = /\b(not|never|no|nor|don't|doesn't|without)\b/i;

/** Another road: a second route by name, the mailbox, the kit's own send, or sending it again. */
const ANOTHER_ROAD = /\b(another|other|second|different|alternative|fall ?back)\b.*\b(road|route|way|transport|channel|path)s?\b|\bre-?send|\bsend (it |the message )?again\b|\bmailbox\b|message send/i;

/** Words that pass news on to someone. */
const TELL = /\b(tell|report|inform|notify|say|let)\b/i;

/** Who is told: the session's maker or its user. */
const MAKER_OR_USER = /\b(maker|user|owner)\b|\bwho(ever)? (made|started) you\b|\bthe session that made\b/i;

/** The harness's own reason for the refusal. */
const REASON = /\b(reason|why)\b/i;

/** The kit's way to a permission rule. */
const THROUGH_THE_KIT = /\bkit\b|\bobk\b|--allow|bot change/i;

/** The user's yes. */
const YES = /\byes\b|\bapprov\w*|\bconsent\w*|\bagree\w*/i;

/**
 * What the guidance has to mean, in any words: each part is checked on its own,
 * so a failure names the part that is missing.
 */
function assertRefusalGuidance(text, where) {
  const sentences = sentencesOf(text);
  const shown = `\n--- ${where} ---\n${text}`;

  assert.ok(
    sentences.some((sentence) => REFUSED.test(sentence)),
    `${where} should say what to do when the harness refuses the call${shown}`,
  );
  assert.ok(
    sentences.some((sentence) => NO.test(sentence) && ANOTHER_ROAD.test(sentence)),
    `${where} should say not to send it again by another road (PRD-16)${shown}`,
  );
  assert.ok(
    sentences.some((sentence) => TELL.test(sentence) && MAKER_OR_USER.test(sentence)),
    `${where} should say to tell the maker or the user that it was refused${shown}`,
  );
  assert.ok(REASON.test(text), `${where} should say to pass on the harness's reason${shown}`);

  const aboutRules = sentences.filter((sentence) => /\brules?\b/i.test(sentence)).join(' ');
  assert.ok(
    /\bpermission|\ballow/i.test(aboutRules),
    `${where} should say that a refusal can mean a permission rule is missing${shown}`,
  );
  assert.ok(
    THROUGH_THE_KIT.test(aboutRules),
    `${where} should say that the rule is fixed through the kit${shown}`,
  );
  assert.ok(YES.test(text), `${where} should say that the rule is fixed only after the user's yes${shown}`);
}

/** The three ways two Claude sessions share an approval class, so the road is native. */
const NATIVE_PAIRS = [
  ['two auto Claude sessions', ['--approval', 'auto'], ['--approval', 'auto']],
  ['an auto and an ask Claude session', ['--approval', 'auto'], ['--approval', 'ask']],
  ['two dangerously-skip Claude sessions', ['--approval', 'dangerously-skip'], ['--approval', 'dangerously-skip']],
];

for (const [label, sender, receiver] of NATIVE_PAIRS) {
  test(`${label}: the native answer says what to do when the harness refuses the call (#521)`, async (t) => {
    const box = await createSandbox(t);
    await fleetIn(box, [['one-bot', 'claude', sender], ['two-bot', 'claude', receiver]]);

    const stdout = await plainTo(box, 'two-bot', 'one-bot/daily');

    const road = roadLine(stdout);
    assert.equal(road.transport, 'native', `the pair should take the native road for this test to mean anything:\n${stdout}`);
    assertRefusalGuidance(stdout, 'the native answer');
  });
}

test('the native answer offers no second road: no message send command (#521)', async (t) => {
  // PRD-16: a refused message is not re-sent by another route. A `Send it:`
  // line under a native answer would be that route, handed to the sender.
  const box = await createSandbox(t);
  await fleetIn(box, [['one-bot', 'claude'], ['two-bot', 'claude']]);

  const stdout = await plainTo(box, 'two-bot', 'one-bot/daily');

  assert.equal(roadLine(stdout).transport, 'native', `got:\n${stdout}`);
  assert.ok(!/message send/.test(stdout), `the native answer should offer no message send command, got:\n${stdout}`);
  assert.ok(!/Send it:/.test(stdout), `nor a Send it line, got:\n${stdout}`);
});

test('the native road and address are unchanged, and nothing is sent (#521)', async (t) => {
  // Words only: the same road, the receiver's own session name as the address,
  // in the plain answer and in --json alike, and no call that sends.
  const box = await createSandbox(t);
  const bots = await fleetIn(box, [['one-bot', 'claude'], ['two-bot', 'claude']]);
  const address = (await sessionIn(bots, 'two-bot', 'daily')).address;
  assert.match(String(address), addressPattern('two-bot', 'daily'));
  const terminals = await box.orca.terminals();

  const stdout = await plainTo(box, 'two-bot', 'one-bot/daily');
  const answer = await jsonTo(box, 'two-bot', 'one-bot/daily');

  assert.deepEqual(roadLine(stdout), { transport: 'native', where: 'two-bot/daily', address }, `got:\n${stdout}`);
  assert.deepEqual(
    { transport: answer.transport, address: answer.address },
    { transport: 'native', address },
    `got: ${JSON.stringify(answer)}`,
  );
  assert.deepEqual(orcaCallsOf(await box.orca.calls(), 'orchestration send'), [], 'nothing is sent');
  assert.deepEqual(await box.orca.messages(), [], 'and nothing is in a mailbox');
  assert.deepEqual(await box.orca.terminals(), terminals, 'and nothing was typed into a tab');
});

/**
 * The Orca road, each way a pair comes to it: Codex at either end, a pair across
 * approval classes, and a Claude receiver that answers to no name the kit gave.
 */
const ORCA_ROADS = [
  ['a Claude sender and a Codex receiver', [['one-bot', 'claude'], ['two-bot', 'codex']], {}],
  ['a Codex sender and a Claude receiver', [['one-bot', 'codex'], ['two-bot', 'claude']], {}],
  ['a pair across approval classes', [['one-bot', 'claude', ['--approval', 'auto']], ['two-bot', 'claude', ['--approval', 'dangerously-skip']]], {}],
  ['a Claude receiver that answers to no name', [['one-bot', 'claude'], ['two-bot', 'claude']], { unnamed: true }],
];

for (const [label, fleet, { unnamed = false }] of ORCA_ROADS) {
  test(`${label}: the Orca answer keeps its present form, Send it line and all (#521)`, async (t) => {
    // Current behaviour to protect. This answer is not about a harness refusal,
    // so the new words stay out of it and its command stays in.
    const box = await createSandbox(t);
    const bots = await fleetIn(box, fleet);
    if (unnamed) {
      const book = await bookIn(bots, 'two-bot');
      delete book.sessions.daily.address;
      await writeFile(bookOf(bots, 'two-bot'), stringify(book));
    }
    const mailbox = `run:${(await sessionIn(bots, 'two-bot', 'daily')).mailbox}`;

    const stdout = await plainTo(box, 'two-bot', 'one-bot/daily');

    assert.deepEqual(roadLine(stdout), { transport: 'orca', where: 'two-bot/daily', address: mailbox }, `got:\n${stdout}`);
    const send = stdout.split('\n').filter((line) => /Send it:/.test(line));
    assert.equal(send.length, 1, `the answer should carry one Send it line, got:\n${stdout}`);
    assert.match(send[0], /message send --bots \S+ --to two-bot\/daily --subject <text> --text <text>/, `got:\n${stdout}`);
    assert.ok(!REFUSED.test(stdout), `the Orca answer is not about a harness refusal, got:\n${stdout}`);
    assert.ok(!/permission/i.test(stdout), `nor about a permission rule, got:\n${stdout}`);
  });
}

test('the kit\'s mail rule unit carries the refusal guidance (#521)', async () => {
  const unit = await kitUnit(MAIL);

  assert.equal(unit.title, 'Writing to another session');
  assert.equal(unit.applies, 'all');
  assertRefusalGuidance(unit.body, 'rules/mail.md');
});

for (const harness of ['claude', 'codex']) {
  test(`a new ${harness} bot's AGENTS.md carries the refusal guidance under Writing to another session (#521)`, async (t) => {
    // The unit is compiled into every bot's AGENTS.md, so the bot reads the
    // guidance before a refusal happens, not after.
    const box = await createSandbox(t);
    const bots = box.path('bots');
    assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
    const unit = await kitUnit(MAIL);

    const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', harness]);

    assert.equal(made.code, 0, made.stderr);
    const body = blockIn(await agentsIn(bots, 'api-bot')).body;
    const section = underIn(body, unit.title);
    assert.ok(section !== undefined, `the AGENTS.md should carry "${unit.title}", got headings: ${headingsIn(body)}`);
    assertRefusalGuidance(section, `${harness} bot's AGENTS.md`);
  });
}
