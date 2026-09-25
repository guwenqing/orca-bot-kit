// Did the session get its duty? (#274)
//
// The start prompt is what tells one session's duty from another's (PRD 6.4).
// It rides on the launch line as the harness's own argument (src/launch.js),
// and a harness running in the tab used to be reported as `promptSent`. That is
// a stand-in: a harness held on a first-run screen — Claude Code's folder
// trust, Codex's hooks review — is running and has not been told anything yet,
// and neither has one that refused the argument.
//
// So `up`, `restart` and `unpause` now say `promptReceived: true` only when the
// session's own record holds the start prompt as a user turn, and
// `promptReceived: false` — not confirmed — when it cannot tell yet. "The
// session's own record" is the conversation the book names for the session,
// which the harness reports through the kit's SessionStart hook, in the file
// that harness keeps it in (tech notes, sections 2 and 3):
//
//   Claude Code  ~/.claude/projects/<cwd-slug>/<id>.jsonl; the user's turn is a
//                `type: "user"` line whose `message.content` is the text, or
//                text blocks. A line with `isMeta: true` is not the user's,
//                and neither is one whose content is `tool_result` blocks.
//   Codex        ~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-<stamp>-<id>.jsonl;
//                the user's turn is a `response_item` message with
//                `role: "user"` and `input_text` content, as Codex 0.156.1 wrote
//                a kit session's start prompt. It wrote no `user_message` event
//                for it, so none is written here. Its AGENTS.md instructions
//                are a `role: "user"` item too, whose text is
//                `# AGENTS.md instructions for <home>…`: not the user's turn.
//
// What happens in the tab is arranged the way a harness does it: while the kit
// is waiting on the tab it just typed into, "the harness" writes its record
// under the sandbox's home and runs the kit's hook, under the process chain the
// kit reads ownership from (helpers/cli.js `harnessChain`, helpers/fake-orca.js
// `runDuring`). Its records are stamped at the moment they are written, which
// is after the kit launched it, as a real one's are.

import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  botHomeOf,
  createSandbox,
  harnessChain,
  orcaCallsOf,
  sessionIn,
  sessionStart,
  shellWord,
} from './helpers/cli.js';

const BOT = 'heard-bot';
const PROMPT = 'Read your AGENTS.md and reply in one line with what this bot owns.';

/** What the report says, in the tab's own lines, for each answer. */
const RECEIVED = 'the start prompt was received: the session\'s own record holds it.';
const NOT_CONFIRMED = 'the start prompt is not confirmed: the session\'s own record does not hold it yet.';

/** The lines the report used to carry, which meant "a harness is running" and nothing more. */
const OLD_LINES = [
  'the start prompt was typed in.',
  'the start prompt was not typed in: the tab was not ready for it.',
];

/** Conversation ids shaped the way both harnesses shape them. */
const conv = (n) => `0199b2c0-${String(n).padStart(4, '0')}-4444-8888-cccccccccccc`;

/** A bots folder with one bot on `harness` and one session, not yet brought up. */
async function withSession(box, harness, settings = ['--prompt', PROMPT]) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', harness])).code, 0);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily', ...settings]);
  assert.equal(added.code, 0, added.stderr);
  const bots = box.path('bots');
  return { bots, home: botHomeOf(bots, BOT) };
}

// ------------------------------------------------------------ the records

/**
 * Lines of a Claude Code transcript. Every one carries the conversation's id,
 * its folder and a time; `__NOW__` is filled in when the harness writes it.
 */
const claude = {
  user: (id, home, content, extra = {}) => ({
    parentUuid: null,
    isSidechain: false,
    userType: 'external',
    cwd: home,
    sessionId: id,
    type: 'user',
    message: { role: 'user', content },
    timestamp: '__NOW__',
    ...extra,
  }),
  assistant: (id, home, text) => ({
    parentUuid: null,
    isSidechain: false,
    cwd: home,
    sessionId: id,
    type: 'assistant',
    message: { role: 'assistant', model: 'claude-sonnet-5', content: [{ type: 'text', text }] },
    timestamp: '__NOW__',
  }),
  system: (id, home) => ({ type: 'system', sessionId: id, cwd: home, timestamp: '__NOW__' }),
};

/** Lines of a Codex rollout: `{ timestamp, type, payload }`, the first one saying what the conversation is. */
const codex = {
  meta: (id, home) => ({ timestamp: '__NOW__', type: 'session_meta', payload: { id, cwd: home, timestamp: '__NOW__' } }),
  /** The user's turn: what Codex 0.156.1 wrote for a kit session's start prompt. */
  userItem: (text) => ({
    timestamp: '__NOW__',
    type: 'response_item',
    payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
  }),
  /** The user's turn itself. */
  agentMessage: (text) => ({
    timestamp: '__NOW__',
    type: 'response_item',
    payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] },
  }),
  /** The bot's AGENTS.md as Codex hands it to the model: a user-role item that nobody typed. */
  instructions: (home, text) => ({
    timestamp: '__NOW__',
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: `# AGENTS.md instructions for ${home}\n\n<INSTRUCTIONS>\n${text}\n</INSTRUCTIONS>` }],
    },
  }),
};

/** A whole conversation in which the user's first turn is `text`, in `harness`'s own lines. */
function saying(harness, id, home, text) {
  return harness === 'claude'
    ? [claude.user(id, home, text), claude.assistant(id, home, 'This bot owns the API.')]
    : [
      codex.meta(id, home),
      codex.instructions(home, 'Keep the API up.'),
      codex.userItem(text),
      codex.agentMessage('This bot owns the API.'),
    ];
}

/** A conversation that has started and holds no turn of the user's at all. */
function empty(harness, id, home) {
  return harness === 'claude' ? [claude.system(id, home)] : [codex.meta(id, home)];
}

/**
 * The harness's side of a launch: write its records where it keeps them, then
 * — when it has one to report — run the kit's hook under the process chain.
 * Node rather than shell, so the chain it starts is the one the kit believes.
 */
const HARNESS_START = `
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const now = new Date().toISOString();
for (const record of JSON.parse(process.env.OBK_TEST_RECORDS)) {
  const file = record.harness === 'codex'
    ? path.join(record.root, '.codex', 'sessions', ...now.slice(0, 10).split('-'),
      'rollout-' + now.replaceAll(':', '-').replace(/[.].*$/, '') + '-' + record.id + '.jsonl')
    : path.join(record.root, '.claude', 'projects', record.cwd.replace(/[^A-Za-z0-9]/g, '-'), record.id + '.jsonl');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, record.lines.map((line) => JSON.stringify(line).replaceAll('__NOW__', now)).join('\\n') + '\\n');
}
if (process.env.OBK_TEST_THEN !== undefined) {
  const [program, ...rest] = JSON.parse(process.env.OBK_TEST_THEN);
  const ran = spawnSync(program, rest, { stdio: 'inherit' });
  process.exit(ran.status ?? 1);
}
`;

/**
 * Arrange for the harness to come up during the next run's first look at the
 * tab it launched: it writes `records` ({ id, lines }) under the sandbox home,
 * and — when `reports` names one of them — tells the kit's hook that is the
 * conversation it is running. Leave `reports` out for a harness that has not
 * run its hook: held on a first-run screen, say.
 */
async function harnessDuring(box, { bots, home, harness, records, reports }) {
  const dir = path.join(box.root, 'harness');
  await mkdir(dir, { recursive: true });
  const start = path.join(dir, 'harness-start.cjs');
  await writeFile(start, `${HARNESS_START.trim()}\n`);

  const env = {
    OBK_TEST_RECORDS: JSON.stringify(records.map((one) => ({ harness, root: box.home, cwd: home, ...one }))),
  };
  if (reports !== undefined) {
    const hook = [box.cli, 'session', 'record', '--bots', bots, '--bot', BOT].map(shellWord).join(' ');
    const chain = await harnessChain(box, hook, { stdin: sessionStart({ session: reports, cwd: home }) });
    Object.assign(env, chain.env, { OBK_TEST_THEN: JSON.stringify(chain.argv) });
  }

  await box.orca.set({
    runDuring: {
      command: 'terminal wait',
      argv: [process.execPath, start],
      env,
      // The fake counts every wait since the sandbox began; this is the next one,
      // the first look at the tab the coming run launches.
      on: orcaCallsOf(await box.orca.calls(), 'terminal wait').length + 1,
    },
  });
}

/** The harness came up in the middle of the run, as arranged, and its hook did not fail. */
async function assertHarnessRan(box) {
  const ran = await box.orca.ranDuring();
  assert.equal(ran.length, 1, `the harness should have come up in the middle of the run, got: ${JSON.stringify(ran)}`);
  assert.equal(ran[0].status, 0, `and nothing it ran should have failed: ${ran[0].stderr}`);
}

/** The book names `id` for the session: the report reached it, so a "not confirmed" is not a lost hook. */
async function assertBookNames(bots, id) {
  const daily = await sessionIn(bots, BOT, 'daily');
  assert.equal(daily?.session, id, `the book should name the conversation the harness reported, got: ${JSON.stringify(daily)}`);
}

// ------------------------------------------------------------ the runs

/** Run `command` for the one bot with --json and give back the session's new tab entry. */
async function entryOf(box, command = 'up') {
  const result = await box.run([command, '--bots', 'bots', '--bot', BOT, '--json']);
  assert.equal(result.code, 0, result.stderr);
  const found = JSON.parse(result.stdout).tabs.filter((entry) => entry.name === 'daily' && entry.created === true);
  assert.equal(found.length, 1, `the session's new tab should be reported, got: ${result.stdout}`);
  return found[0];
}

/** Every line of a plain report, without the indent. */
const linesOf = (stdout) => stdout.split('\n').map((line) => line.trim());

for (const harness of ['claude', 'codex']) {
  test(`on ${harness}, a prompt the session's own record holds as a user turn is received`, async (t) => {
    const box = await createSandbox(t);
    const { bots, home } = await withSession(box, harness);
    await harnessDuring(box, { bots, home, harness, records: [{ id: conv(1), lines: saying(harness, conv(1), home, PROMPT) }], reports: conv(1) });

    const entry = await entryOf(box);

    await assertHarnessRan(box);
    await assertBookNames(bots, conv(1));
    assert.equal(entry.harnessStarted, true);
    assert.equal(entry.promptReceived, true, `the record holds the prompt as the user's turn, got: ${JSON.stringify(entry)}`);
    assert.equal('promptSent' in entry, false, 'the old field, which meant only that a harness was running, is gone');
  });

  test(`on ${harness}, a running harness whose record holds no such turn is not confirmed`, async (t) => {
    // The stand-in this issue removes: the harness is up and has a conversation
    // the book names, and the user's turn in it is something else.
    const box = await createSandbox(t);
    const { bots, home } = await withSession(box, harness);
    await harnessDuring(box, {
      bots,
      home,
      harness,
      records: [{ id: conv(1), lines: saying(harness, conv(1), home, 'What is on the queue today?') }],
      reports: conv(1),
    });

    const entry = await entryOf(box);

    await assertHarnessRan(box);
    await assertBookNames(bots, conv(1));
    assert.equal(entry.harnessStarted, true, 'the harness is running');
    assert.equal(entry.promptReceived, false, `and running is not received, got: ${JSON.stringify(entry)}`);
  });

  test(`on ${harness}, a conversation with no user turn yet is not confirmed`, async (t) => {
    const box = await createSandbox(t);
    const { bots, home } = await withSession(box, harness);
    await harnessDuring(box, { bots, home, harness, records: [{ id: conv(1), lines: empty(harness, conv(1), home) }], reports: conv(1) });

    const entry = await entryOf(box);

    await assertHarnessRan(box);
    await assertBookNames(bots, conv(1));
    assert.equal(entry.promptReceived, false, `got: ${JSON.stringify(entry)}`);
  });

  test(`on ${harness}, the prompt in another conversation of the bot's folder is not this session's`, async (t) => {
    // Every session of a bot, and every harness a session starts inside itself,
    // shares the bot home. A conversation the book does not name for this
    // session is not this session's record, however well it matches.
    const box = await createSandbox(t);
    const { bots, home } = await withSession(box, harness);
    await harnessDuring(box, {
      bots,
      home,
      harness,
      records: [
        { id: conv(1), lines: empty(harness, conv(1), home) },
        { id: conv(2), lines: saying(harness, conv(2), home, PROMPT) },
      ],
      reports: conv(1),
    });

    const entry = await entryOf(box);

    await assertHarnessRan(box);
    await assertBookNames(bots, conv(1));
    assert.equal(entry.promptReceived, false, `the conversation the book names does not hold it, got: ${JSON.stringify(entry)}`);
  });

  test(`on ${harness}, a record the book names that is not on disk yet is not confirmed, and the run still reports`, async (t) => {
    const box = await createSandbox(t);
    const { bots, home } = await withSession(box, harness);
    await harnessDuring(box, { bots, home, harness, records: [], reports: conv(1) });

    const entry = await entryOf(box);

    await assertHarnessRan(box);
    await assertBookNames(bots, conv(1));
    assert.equal(entry.promptReceived, false, `got: ${JSON.stringify(entry)}`);
  });

  test(`on ${harness}, a harness held on a first-run screen, with no conversation in the book, is not confirmed`, async (t) => {
    // Claude Code's folder trust or Codex's hooks review: the harness is up and
    // has not run the hook, so the book names nothing. Another conversation in
    // the bot's folder that holds the prompt — something a session started
    // inside itself, say — does not stand in for it.
    const box = await createSandbox(t);
    const { bots, home } = await withSession(box, harness);
    await box.orca.set({ waitIdle: 'blocked' });
    await harnessDuring(box, { bots, home, harness, records: [{ id: conv(2), lines: saying(harness, conv(2), home, PROMPT) }] });

    const entry = await entryOf(box);

    await assertHarnessRan(box);
    assert.equal((await sessionIn(bots, BOT, 'daily'))?.session, undefined, 'no hook ran, so the book names no conversation');
    assert.equal(entry.harnessStarted, true, 'a TUI waiting on a question is a harness that started');
    assert.equal(entry.blockedReason, 'agent-interactive-prompt');
    assert.equal(entry.promptReceived, false, `got: ${JSON.stringify(entry)}`);
  });

  test(`on ${harness}, a harness that never came up is not confirmed`, async (t) => {
    const box = await createSandbox(t);
    await withSession(box, harness);
    await box.orca.set({ waitIdle: false, foreground: 'shell' });

    const entry = await entryOf(box);

    assert.equal(entry.harnessStarted, false);
    assert.equal(entry.promptReceived, false, `got: ${JSON.stringify(entry)}`);
  });
}

test('on claude, the prompt only in lines that are not the user\'s turn is not received', async (t) => {
  // A meta line is the harness talking to itself, and the assistant quoting the
  // prompt back is not the user having said it. A search for the text anywhere
  // in the file would find both.
  const box = await createSandbox(t);
  const { bots, home } = await withSession(box, 'claude');
  const id = conv(1);
  await harnessDuring(box, {
    bots,
    home,
    harness: 'claude',
    records: [{
      id,
      lines: [
        claude.user(id, home, PROMPT, { isMeta: true }),
        claude.user(id, home, 'What is on the queue today?'),
        claude.assistant(id, home, `You asked me: ${PROMPT}`),
      ],
    }],
    reports: id,
  });

  const entry = await entryOf(box);

  await assertHarnessRan(box);
  await assertBookNames(bots, id);
  assert.equal(entry.promptReceived, false, `got: ${JSON.stringify(entry)}`);
});

test('on claude, the prompt only in a tool result is not received', async (t) => {
  // Claude Code writes a tool's answer as a `type: "user"` line whose content is
  // `tool_result` blocks. The user did not say it.
  const box = await createSandbox(t);
  const { bots, home } = await withSession(box, 'claude');
  const id = conv(1);
  await harnessDuring(box, {
    bots,
    home,
    harness: 'claude',
    records: [{
      id,
      lines: [
        claude.user(id, home, 'What is on the queue today?'),
        claude.user(id, home, [{ type: 'tool_result', tool_use_id: 'toolu_01', content: [{ type: 'text', text: PROMPT }] }]),
        claude.user(id, home, [{ type: 'tool_result', tool_use_id: 'toolu_02', content: PROMPT }]),
      ],
    }],
    reports: id,
  });

  const entry = await entryOf(box);

  await assertHarnessRan(box);
  await assertBookNames(bots, id);
  assert.equal(entry.promptReceived, false, `got: ${JSON.stringify(entry)}`);
});

test('on claude, a user turn written as text blocks is a user turn', async (t) => {
  // Claude Code writes a user's words either as a string or as an array of
  // `{ type: "text", text }` blocks.
  const box = await createSandbox(t);
  const { bots, home } = await withSession(box, 'claude');
  const id = conv(1);
  await harnessDuring(box, {
    bots,
    home,
    harness: 'claude',
    records: [{
      id,
      lines: [claude.user(id, home, [{ type: 'text', text: PROMPT }]), claude.assistant(id, home, 'This bot owns the API.')],
    }],
    reports: id,
  });

  const entry = await entryOf(box);

  await assertHarnessRan(box);
  await assertBookNames(bots, id);
  assert.equal(entry.promptReceived, true, `got: ${JSON.stringify(entry)}`);
});

test('on codex, the prompt only in its AGENTS.md item and the agent\'s reply is not received', async (t) => {
  // Codex hands the model the bot's instructions as a user-role item nobody
  // typed, and here the prompt is only quoted inside it and in the reply.
  const box = await createSandbox(t);
  const { bots, home } = await withSession(box, 'codex');
  const id = conv(1);
  await harnessDuring(box, {
    bots,
    home,
    harness: 'codex',
    records: [{
      id,
      lines: [
        codex.meta(id, home),
        codex.instructions(home, `Every session starts from this: ${PROMPT}`),
        codex.agentMessage(`You asked me: ${PROMPT}`),
      ],
    }],
    reports: id,
  });

  const entry = await entryOf(box);

  await assertHarnessRan(box);
  await assertBookNames(bots, id);
  assert.equal(entry.promptReceived, false, `got: ${JSON.stringify(entry)}`);
});

// ------------------------------------------------- restart and unpause, through up

test('restart says received when the new session\'s record holds the prompt, and not confirmed when it does not', async (t) => {
  // A session that has never had a tab is started fresh by a restart, with its
  // duty on the line (test/restart.test.js, R8).
  for (const [records, expected] of [
    [(home) => [{ id: conv(1), lines: saying('claude', conv(1), home, PROMPT) }], true],
    [(home) => [{ id: conv(1), lines: empty('claude', conv(1), home) }], false],
  ]) {
    const box = await createSandbox(t);
    const { bots, home } = await withSession(box, 'claude');
    await harnessDuring(box, { bots, home, harness: 'claude', records: records(home), reports: conv(1) });

    const entry = await entryOf(box, 'restart');

    await assertHarnessRan(box);
    await assertBookNames(bots, conv(1));
    assert.equal(entry.resumed, false, 'there was nothing to resume');
    assert.equal(entry.promptReceived, expected, `got: ${JSON.stringify(entry)}`);
  }
});

test('unpause says received when the new session\'s record holds the prompt, and not confirmed when it does not', async (t) => {
  // Paused before it ever had a tab, so the unpause starts it fresh, told its duty.
  for (const [records, expected] of [
    [(home) => [{ id: conv(1), lines: saying('codex', conv(1), home, PROMPT) }], true],
    [(home) => [{ id: conv(1), lines: saying('codex', conv(1), home, 'What is on the queue today?') }], false],
  ]) {
    const box = await createSandbox(t);
    const { bots, home } = await withSession(box, 'codex');
    const paused = await box.run(['pause', '--bots', 'bots', '--bot', BOT]);
    assert.equal(paused.code, 0, `the pause this test stands on did not happen: ${paused.stderr}`);
    await harnessDuring(box, { bots, home, harness: 'codex', records: records(home), reports: conv(1) });

    const entry = await entryOf(box, 'unpause');

    await assertHarnessRan(box);
    await assertBookNames(bots, conv(1));
    assert.equal(entry.promptReceived, expected, `got: ${JSON.stringify(entry)}`);
  }
});

// ------------------------------------------------------------ the plain report

test('the plain report says received, or not confirmed, in the tab\'s lines, and never the old lines', async (t) => {
  const heard = await createSandbox(t);
  {
    const { bots, home } = await withSession(heard, 'claude');
    await harnessDuring(heard, { bots, home, harness: 'claude', records: [{ id: conv(1), lines: saying('claude', conv(1), home, PROMPT) }], reports: conv(1) });
  }
  const unheard = await createSandbox(t);
  {
    const { bots, home } = await withSession(unheard, 'claude');
    await harnessDuring(unheard, { bots, home, harness: 'claude', records: [{ id: conv(1), lines: empty('claude', conv(1), home) }], reports: conv(1) });
  }
  const never = await createSandbox(t);
  await withSession(never, 'codex');
  await never.orca.set({ waitIdle: false, foreground: 'shell' });

  for (const [label, box, says, not] of [
    ['a record that holds the prompt', heard, RECEIVED, NOT_CONFIRMED],
    ['a record that does not hold it', unheard, NOT_CONFIRMED, RECEIVED],
    ['a harness that never came up', never, NOT_CONFIRMED, RECEIVED],
  ]) {
    const result = await box.run(['up', '--bots', 'bots', '--bot', BOT]);
    assert.equal(result.code, 0, result.stderr);
    const lines = linesOf(result.stdout);
    assert.equal(lines.filter((line) => line === says).length, 1, `${label}: the report should say "${says}" once, got:\n${result.stdout}`);
    assert.ok(!lines.includes(not), `${label}: and not "${not}", got:\n${result.stdout}`);
    for (const old of OLD_LINES) {
      assert.ok(!lines.includes(old), `${label}: the old line "${old}" is gone, got:\n${result.stdout}`);
    }
  }
});

test('the plain report says nothing about a prompt for a session that was told nothing', async (t) => {
  const box = await createSandbox(t);
  await withSession(box, 'claude', []);

  const result = await box.run(['up', '--bots', 'bots', '--bot', BOT]);

  assert.equal(result.code, 0, result.stderr);
  const lines = linesOf(result.stdout);
  for (const line of [RECEIVED, NOT_CONFIRMED, ...OLD_LINES]) {
    assert.ok(!lines.includes(line), `no prompt, nothing to say about one; got:\n${result.stdout}`);
  }
});
