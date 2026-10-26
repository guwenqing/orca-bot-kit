// The send hook says nothing after a message to a subagent or a teammate in
// the same session, on the Claude Code versions the fleet runs, and still warns
// after a message to another session that no book of the bots folder names
// (#705, by the owner; #451, ADR 0032).
//
// On Claude Code 2.1.310 the hook warned "That message went to <name>, which is
// not one of the sessions of your bots folder" after a SendMessage that resumed
// a finished subagent of the same session. Since 2.1.281, Claude Code hands the
// hook more in-process shapes than the `routing` one that ADR 0032 was proven
// on (2.1.283). The shapes below are copied from the `toolUseResult` of every
// SendMessage in this machine's Claude Code transcripts, 2.1.281 to 2.1.310
// (the developer of #705 read them; ids shortened only where marked):
//
//   in-process, the same session (nothing to say):
//     a finished subagent resumed, 2.1.301-2.1.310   { success, message, resumedAgentId, revivedAgentId, pin: { id, name, ref } }
//     the same, 2.1.283-2.1.296                      { success, message, resumedAgentId, pin: { id, name, ref } }
//     a running subagent, 2.1.281-2.1.309            { success, message, pin: { id, name, ref } }
//     a running named teammate, 2.1.283              { success, message, msg_id, pin: { id, name, ref } }
//     a team teammate's inbox, 2.1.281-2.1.291       { success, message, msg_id, routing: { … } }
//     a subagent to its parent, 2.1.288-2.1.296      { success, message }                       (`to` is `main`)
//
//   another Claude session, every version 2.1.281-2.1.310 (warned when no book names it):
//                                                    { success, message, display, msg_id }      (never `pin`, never `routing`)
//
//   a send that failed (nothing to say):             { success: false, message, display }
//
// Claude Code keeps two copies of each result (seen by the same developer, on
// disk, 2.1.281 to 2.1.310). The transcript's copy is the one above. The copy
// the model reads drops `display` and `revivedAgentId` and keeps every other
// field: another session's is { success, message, msg_id }, a failed send's
// { success: false, message }, and the 2.1.301-2.1.310 resume's is the
// 2.1.283-2.1.296 one. Which copy the hook gets is not known, so each case
// that differs is pinned for both copies.
//
// What the requirement pins, through the public interface only
// (`obk session sent --bots <bots> --bot <bot>`, the PostToolUse event on
// standard input, the result under `tool_output` or `tool_response`, as an
// object or a JSON string):
//
//   - After each in-process shape the hook says nothing: empty standard output,
//     exit 0. This holds whatever `tool_input.to` names: the agent's id,
//     `main`, or a name that looks like a session address of another fleet or
//     of this one. The kind of send is in the result, not in the target's name.
//   - After the cross-session shape to an address that no book of this bots
//     folder names, the hook still warns, under each field and as each
//     encoding, and still names the road for a `<bot>.<session>` that this
//     fleet has. To an address of this fleet, it says nothing, as before.
//   - The hook reads the send from its fields, never from its words (the
//     issue's boundary): a cross-session result whose `message` and `display`
//     carry an in-process result's words is still warned about, and an
//     in-process result whose `message` carries a cross-session result's words
//     still gets nothing. No test here depends on the real words.
//   - A warning is a warning and never a decision, and the hook never fails a
//     turn (ADR 0022, ADR 0032): `assertWarned` and `assertSilent` check it.
//   - The line that `obk up` installs behaves the same way.
//
// What is not known, so not pinned: what a later Claude Code version hands the
// hook. Every run is in the sandbox: its own HOME, a fake Orca.
//
// The existing cases for the hook, its install and its health stay in
// test/session-sent.test.js. The helpers below copy that file's, since a test
// file exports nothing; that file already runs close to its time limit.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSandbox, hooksIn, sessionIn, sh } from './helpers/cli.js';

// ---------------------------------------------------------------- the fleet

/**
 * Bot Father and api-bot (Claude Code), each with daily, brought up, so that
 * each book holds the address the kit gave the session.
 */
async function fleet(box) {
  const ok = async (args) => {
    const result = await box.run(args);
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  };
  await ok(['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude']);
  await ok(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily']);
  await ok(['up', '--bots', 'bots', '--bot', 'api-bot']);
  const bots = box.path('bots');
  const addressOf = async (bot) => {
    const address = (await sessionIn(bots, bot, 'daily'))?.address;
    assert.match(String(address), new RegExp(`^${bot}\\.daily\\.[a-z0-9]{8}$`), `the premise: the kit gave ${bot} daily an address, got: ${address}`);
    return address;
  };
  return { bots, api: await addressOf('api-bot'), father: await addressOf('bot-father') };
}

// ------------------------------------------------- what Claude Code hands the hook

/** The in-process results, verbatim from the transcripts, with the `to` each one was sent to. */
const IN_PROCESS = [
  {
    label: 'a finished subagent resumed, Claude Code 2.1.301 to 2.1.310 (the case in #705)',
    to: 'a36d03de8ea1ea79f',
    result: {
      success: true,
      message: 'Resuming agent a36d03d',
      resumedAgentId: 'a36d03de8ea1ea79f',
      revivedAgentId: 'a36d03de8ea1ea79f',
      pin: { id: 'a36d03de8ea1ea79f', name: 'a36d03de8ea1ea79f', ref: 'df31f8' },
    },
  },
  {
    // Also the model's copy of the 2.1.301 to 2.1.310 resume above.
    label: 'a finished subagent resumed, Claude Code 2.1.283 to 2.1.296, with no revivedAgentId',
    to: 'a36d03de8ea1ea79f',
    result: {
      success: true,
      message: 'Resuming agent a36d03d',
      resumedAgentId: 'a36d03de8ea1ea79f',
      pin: { id: 'a36d03de8ea1ea79f', name: 'a36d03de8ea1ea79f', ref: 'df31f8' },
    },
  },
  {
    label: 'a running subagent, Claude Code 2.1.281 to 2.1.309',
    to: 'a623e11f759bc0dd3',
    result: {
      success: true,
      message: 'Message queued for delivery to a623e11f759bc0dd3 at its next tool round. If it finishes first, it is resumed with the message and notifies again, so wait for that notification before resending.',
      pin: { id: 'a623e11f759bc0dd3', name: 'a623e11f759bc0dd3', ref: '02bd11' },
    },
  },
  {
    label: 'a running named teammate, Claude Code 2.1.283',
    to: 'c10v32-judge',
    result: {
      success: true,
      message: 'Teammate "c10v32-judge" is already running; queued your message for its next turn.',
      msg_id: '5e10c5bc-9c39-4aac-9e8d-474087170dfc',
      pin: { id: 'ac10v32-judge-231a2d035e3a5c4f', name: 'c10v32-judge', ref: 'a7b8bf' },
    },
  },
  {
    label: 'a team teammate\'s inbox, Claude Code 2.1.281 to 2.1.291',
    to: 'test-author-235',
    result: {
      success: true,
      message: 'Message sent to test-author-235\'s inbox',
      // The transcript's msg_id was shortened; any id stands in.
      msg_id: 'e6df39d7-0000-4000-8000-000000000000',
      routing: { sender: 'team-lead', target: '@test-author-235', targetColor: 'cyan', summary: 'the tests', content: 'Here are the tests.' },
    },
  },
  {
    label: 'a subagent to its parent, Claude Code 2.1.288 to 2.1.296',
    to: 'main',
    result: { success: true, message: 'Message queued for the main conversation\'s next turn.' },
  },
];

/** Another Claude session's result, verbatim from a 2.1.310 transcript: `display` and `msg_id`, no `pin`, no `routing`. */
const ANOTHER_SESSION = {
  success: true,
  message: '“PR 702 open, reviewer started” → kit-dev.architect.4snmt1e7 (another Claude session on this machine; in that session\'s inbox, not yet read by its Claude — a [Cross-session delivery notice] follows if that session holds it (usually a different permission mode) or refuses it)',
  display: '“PR 702 open, reviewer started” → sent to kit-dev.architect.4snmt1e7 — another Claude session on this machine',
  msg_id: '79b8abec-372f-4bfb-a962-36da4b5e99ab',
};

/** A send that did not go, in the shape of the transcripts: `success: false`, with `display`. */
const FAILED = {
  success: false,
  message: 'No agent named \'someone-else.daily.ab12cd34\' is reachable.',
  display: 'Not sent — no agent by that name',
};

/** The model's copies of the two results above: the same, without `display`. */
const { display: _shown, ...ANOTHER_SESSION_MODEL } = ANOTHER_SESSION;
const { display: _failShown, ...FAILED_MODEL } = FAILED;

/** An address that no book of the sandbox's bots folder names. */
const OUTSIDE_ADDRESS = 'kit-dev.architect.4snmt1e7';

/** The four ways the result reaches the hook: under either field, as an object or as its JSON. */
const ENCODINGS = ['tool_output', 'tool_response'].flatMap((field) => [false, true].map((asString) => ({ field, asString })));

const encodingLabel = ({ field, asString }) => `${field}, ${asString ? 'a JSON string' : 'an object'}`;

/** The PostToolUse event after a SendMessage to `to` that answered `result`, under `field`, as an object or a string. */
const sent = (to, result, { field = 'tool_output', asString = false } = {}) => `${JSON.stringify({
  session_id: 'sess-sender',
  transcript_path: '/nowhere',
  cwd: '/nowhere',
  hook_event_name: 'PostToolUse',
  tool_name: 'SendMessage',
  tool_input: { to, summary: 'the report', message: 'Here is the report.' },
  [field]: asString ? JSON.stringify(result) : result,
})}\n`;

/** Run the hook as Claude Code runs it: `obk session sent` for api-bot, the event on standard input. */
const hook = (box, stdin) => box.run(['session', 'sent', '--bots', 'bots', '--bot', 'api-bot'], { stdin });

/** Every key anywhere in a value. */
const keysIn = (value) => (value !== null && typeof value === 'object'
  ? Object.entries(value).flatMap(([key, held]) => [key, ...keysIn(held)])
  : []);

/** The fields that would make the hook a decision rather than a warning. */
const DECISIONS = ['permissionDecision', 'decision', 'continue', 'permissionDecisionReason', 'stopReason'];

/**
 * The hook warned: exit 0, and standard output Claude Code's PostToolUse
 * context and nothing else, with no decision anywhere in it. Returns the text.
 */
function assertWarned(ran, what) {
  assert.equal(ran.code, 0, `${what}: the hook never fails the turn: ${ran.stderr}`);
  let answer;
  try {
    answer = JSON.parse(ran.stdout);
  } catch (error) {
    return assert.fail(`${what}: the warning is JSON on standard output, got: ${JSON.stringify(ran.stdout)} (${error.message})`);
  }
  assert.equal(answer?.hookSpecificOutput?.hookEventName, 'PostToolUse', `${what}: a PostToolUse answer, got: ${ran.stdout}`);
  const text = answer.hookSpecificOutput.additionalContext;
  assert.equal(typeof text, 'string', `${what}: its words in additionalContext, got: ${ran.stdout}`);
  assert.deepEqual(keysIn(answer).filter((key) => DECISIONS.includes(key)), [], `${what}: a warning, never a decision: ${ran.stdout}`);
  return text;
}

/** The hook said nothing: exit 0, nothing on standard output. */
function assertSilent(ran, what) {
  assert.equal(ran.code, 0, `${what}: the hook never fails the turn: ${ran.stderr}`);
  assert.equal(ran.stdout, '', `${what}: nothing to say, so nothing on standard output, got: ${ran.stdout}`);
}

/** Words that say the address is not one of this bots folder's. */
const OUTSIDE = /outside|not (?:one )?of (?:this|the) (?:bots )?folder|isn't one of|is not one of|none of/i;

// ------------------------------------------------- in-process: nothing to say

for (const { label, to, result } of IN_PROCESS) {
  test(`P1 a message to ${label}: nothing said, whatever to names, under each field and encoding`, async (t) => {
    const box = await createSandbox(t);
    const { api } = await fleet(box);
    // Its real target, the parent, an address no book names, the bare name of
    // a session this fleet has (which the warning would give a road for), and
    // an address of this fleet.
    const targets = [...new Set([to, 'main', OUTSIDE_ADDRESS, 'someone-else.daily.ab12cd34', 'bot-father.daily [f7d95e]', api])];

    // The control: the same target, answered as another session, is warned
    // about, so the silence below comes from the result and not from `to`.
    assertWarned(await hook(box, sent(OUTSIDE_ADDRESS, ANOTHER_SESSION)), `the premise: a send to ${OUTSIDE_ADDRESS} as another session`);

    for (const target of targets) {
      for (const encoding of ENCODINGS) {
        assertSilent(await hook(box, sent(target, result, encoding)), `${label}, to ${target}, ${encodingLabel(encoding)}`);
      }
    }
  });
}

// ------------------------------------------------- another session: still warned

test('X1 a message to another session at an address no book names, in the shape of 2.1.310, the transcript\'s copy and the model\'s: warned about under each field and encoding, never decided on', async (t) => {
  const box = await createSandbox(t);
  await fleet(box);

  for (const [copy, result] of [['the transcript\'s copy', ANOTHER_SESSION], ['the model\'s copy, without display', ANOTHER_SESSION_MODEL]]) {
    for (const encoding of ENCODINGS) {
      const what = `another session, ${copy}, ${encodingLabel(encoding)}`;
      const text = assertWarned(await hook(box, sent(OUTSIDE_ADDRESS, result, encoding)), what);
      assert.ok(text.includes(OUTSIDE_ADDRESS), `${what}: it names the address it went to: ${text}`);
      assert.match(text, OUTSIDE, `${what}: and says it is outside this bots folder: ${text}`);
    }
  }
});

test('X2 a message to another session at the bare name of a session this fleet has, in the shape of 2.1.310: warned about, with the fleet\'s own address for it', async (t) => {
  const box = await createSandbox(t);
  const { father } = await fleet(box);

  for (const to of ['bot-father.daily [f7d95e]', 'bot-father.daily']) {
    const text = assertWarned(await hook(box, sent(to, ANOTHER_SESSION)), to);
    assert.ok(text.includes(father), `${to}: it names the fleet's own address for bot-father daily, ${father}: ${text}`);
    assert.match(text, OUTSIDE, `${to}: and says it is outside this bots folder: ${text}`);
  }
});

test('X3 in the shape of 2.1.310, a message to an address of this fleet, and a send that failed, the transcript\'s copy and the model\'s: nothing said', async (t) => {
  const box = await createSandbox(t);
  const { api, father } = await fleet(box);

  for (const to of [api, `${father} [f7d95e]`]) {
    assertSilent(await hook(box, sent(to, ANOTHER_SESSION)), `${to}, an address of this fleet`);
  }
  for (const [copy, result] of [['the transcript\'s copy', FAILED], ['the model\'s copy, without display', FAILED_MODEL]]) {
    for (const encoding of ENCODINGS) {
      assertSilent(await hook(box, sent('someone-else.daily.ab12cd34', result, encoding)), `a send that failed, ${copy}, ${encodingLabel(encoding)}`);
    }
  }
});

// ------------------------------------------------- fields, never words

test('F1 the hook reads the kind of send from the result\'s fields, never from its words', async (t) => {
  const box = await createSandbox(t);
  await fleet(box);

  // Another session's fields, with the words of each in-process result, and
  // with words that say nothing at all.
  const inProcessWords = [...IN_PROCESS.map(({ result }) => result.message), 'ok', ''];
  for (const words of inProcessWords) {
    const reworded = { ...ANOTHER_SESSION, message: words, display: words };
    const text = assertWarned(await hook(box, sent(OUTSIDE_ADDRESS, reworded)), `another session's fields, worded ${JSON.stringify(words)}`);
    assert.ok(text.includes(OUTSIDE_ADDRESS), `it names the address it went to: ${text}`);
  }

  // Each in-process result's fields, with another session's words.
  for (const { label, result } of IN_PROCESS) {
    const reworded = { ...result, message: ANOTHER_SESSION.message };
    assertSilent(await hook(box, sent(OUTSIDE_ADDRESS, reworded)), `${label}, worded as a send to another session`);
  }
});

// ------------------------------------------------- the line up installs

test('I3 the installed hook, run as Claude Code runs it, says nothing after a resumed subagent and still warns after a send to another session outside the books', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await fleet(box);
  const command = (((await hooksIn(bots, 'api-bot', 'claude'))?.hooks?.PostToolUse ?? [])
    .filter((group) => group?.matcher === 'SendMessage')
    .flatMap((group) => (group.hooks ?? []).map((one) => one.command))
    .find((line) => /\bsession sent\b/.test(String(line))));
  assert.equal(typeof command, 'string', 'the premise: up wrote the kit\'s SendMessage hook');
  const [resumed] = IN_PROCESS;

  assertSilent(await sh(command, { cwd: box.cwd, env: box.env, stdin: sent(resumed.to, resumed.result) }), 'the installed line, a resumed subagent');
  assertWarned(await sh(command, { cwd: box.cwd, env: box.env, stdin: sent(OUTSIDE_ADDRESS, ANOTHER_SESSION) }), 'the installed line, another session outside the books');
});
