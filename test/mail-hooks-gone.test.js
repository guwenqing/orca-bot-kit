// The kit's mail hooks are gone (#555, item 4).
//
// Fleet mail has one signal, Orca's own doorbell, so the two hooks the kit
// wrote for its own signals go:
//
//   H1  `installHook` (run by `obk up`) writes no Claude Code `Stop` entry that
//       runs `… session mail --bots … --bot … 2>/dev/null || true`, and no
//       Codex `PostToolUse` entry, matcher `Bash`, that runs `… session
//       nudge …`. The other kit hooks stay: SessionStart `session record`
//       (both), Claude `PostToolUse` `SendMessage` `session sent`, Codex
//       `Stop` `session name`.
//   H2  Where a hooks file already holds such a kit entry, `up` takes it out
//       and keeps the user's own hooks, in the same group or beside it.
//   H3  `obk health` (hookTrouble) does not report their absence.
//
// Every run is in the sandbox (helpers/cli.js). Nothing here reaches the real
// Orca or a real harness.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';

import { createSandbox, eventsIn, hookFileOf, hooksIn } from './helpers/cli.js';

/** Every hook command under one event, `matcher` the group's matcher or any when left out. */
function commandsUnder(hooks, event, matcher) {
  return (eventsIn(hooks)?.[event] ?? [])
    .filter((group) => matcher === undefined || group?.matcher === matcher)
    .flatMap((group) => (group?.hooks ?? []).map((one) => String(one?.command)));
}

/** Every hook command in the file. */
const allCommands = (hooks) => Object.keys(eventsIn(hooks) ?? {}).flatMap((event) => commandsUnder(hooks, event));

/** A bot `<harness>-bot` of that harness with a `daily` session, up. */
async function botUp(box, harness) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const bot = `${harness}-bot`;
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness])).code, 0);
  assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', 'daily'])).code, 0);
  const up = await box.run(['up', '--bots', 'bots', '--bot', bot]);
  assert.equal(up.code, 0, up.stderr);
  return { bots: box.path('bots'), bot };
}

/** The kit's own SessionStart command in the file, as `up` wrote it. */
function recordCommandIn(hooks) {
  const found = commandsUnder(hooks, 'SessionStart').filter((command) => /\bsession record\b/.test(command));
  assert.equal(found.length, 1, `the premise: the kit's session record hook, got: ${JSON.stringify(hooks)}`);
  return found[0];
}

/** The old kit command for `kind` (`mail` or `nudge`), as the kit before #555 wrote it beside its record hook. */
const oldKitCommand = (record, kind) => record.replace(' session record ', ` session ${kind} `);

// ------------------------------------------------------------- H1

test('H1 up writes a Claude bot\'s hooks with SessionStart session record and PostToolUse SendMessage session sent, and no Stop session mail', async (t) => {
  const box = await createSandbox(t);
  const { bots, bot } = await botUp(box, 'claude');
  const hooks = await hooksIn(bots, bot, 'claude');

  assert.equal(commandsUnder(hooks, 'SessionStart').filter((c) => /\bsession record\b/.test(c)).length, 1, `session record stays, got: ${JSON.stringify(hooks)}`);
  assert.equal(commandsUnder(hooks, 'PostToolUse', 'SendMessage').filter((c) => /\bsession sent\b/.test(c)).length, 1, `session sent stays, got: ${JSON.stringify(hooks)}`);
  assert.deepEqual(allCommands(hooks).filter((c) => /\bsession (mail|nudge)\b/.test(c)), [], `no session mail or nudge hook, got: ${JSON.stringify(hooks)}`);
  assert.deepEqual(commandsUnder(hooks, 'Stop'), [], `nothing of the kit's under Stop on Claude, got: ${JSON.stringify(hooks)}`);
});

test('H1 up writes a Codex bot\'s hooks with SessionStart session record and Stop session name, and no PostToolUse Bash session nudge', async (t) => {
  const box = await createSandbox(t);
  const { bots, bot } = await botUp(box, 'codex');
  const hooks = await hooksIn(bots, bot, 'codex');

  assert.equal(commandsUnder(hooks, 'SessionStart').filter((c) => /\bsession record\b/.test(c)).length, 1, `session record stays, got: ${JSON.stringify(hooks)}`);
  assert.equal(commandsUnder(hooks, 'Stop').filter((c) => /\bsession name\b/.test(c)).length, 1, `session name stays, got: ${JSON.stringify(hooks)}`);
  assert.deepEqual(allCommands(hooks).filter((c) => /\bsession (mail|nudge)\b/.test(c)), [], `no session mail or nudge hook, got: ${JSON.stringify(hooks)}`);
  assert.deepEqual(commandsUnder(hooks, 'PostToolUse'), [], `nothing of the kit's under PostToolUse on Codex, got: ${JSON.stringify(hooks)}`);
});

// ------------------------------------------------------------- H2

const OLD = {
  claude: { kind: 'mail', event: 'Stop', matcher: undefined },
  codex: { kind: 'nudge', event: 'PostToolUse', matcher: 'Bash' },
};

for (const [harness, { kind, event, matcher }] of Object.entries(OLD)) {
  test(`H2 a ${harness} hooks file that holds the old kit ${event} session ${kind} entry loses it on up, and the user's own hooks beside it stay`, async (t) => {
    const box = await createSandbox(t);
    const { bots, bot } = await botUp(box, harness);
    const file = hookFileOf(bots, bot, harness);
    const held = JSON.parse(await readFile(file, 'utf8'));
    const events = eventsIn(held);
    const old = oldKitCommand(recordCommandIn(held), kind);
    const mineInGroup = { type: 'command', command: "echo 'my own hook, in the old kit group'" };
    const mineAlone = { type: 'command', command: "logger 'my own hook, alone'" };
    // As the kit before #555 wrote it, with the user's hook put in its group,
    // and a group of the user's own under the same event.
    events[event] = [
      ...(events[event] ?? []),
      { ...(matcher === undefined ? {} : { matcher }), hooks: [{ type: 'command', command: old, timeout: 30 }, mineInGroup] },
      { ...(matcher === undefined ? {} : { matcher }), hooks: [mineAlone] },
    ];
    await writeFile(file, `${JSON.stringify(held, null, 2)}\n`);

    const up = await box.run(['up', '--bots', 'bots', '--bot', bot]);
    assert.equal(up.code, 0, up.stderr);

    const after = await hooksIn(bots, bot, harness);
    const text = await readFile(file, 'utf8');
    assert.deepEqual(allCommands(after).filter((c) => new RegExp(`\\bsession ${kind}\\b`).test(c)), [], `the old kit entry is gone, got:\n${text}`);
    const under = (eventsIn(after)?.[event] ?? []).flatMap((group) => group?.hooks ?? []);
    assert.ok(under.some((one) => one.command === mineInGroup.command), `the user's hook that shared the kit's group stays, got:\n${text}`);
    assert.ok(under.some((one) => one.command === mineAlone.command), `the user's own group stays, got:\n${text}`);
    assert.equal(allCommands(after).filter((c) => /\bsession record\b/.test(c)).length, 1, `the kit's session record hook stays, once, got:\n${text}`);
  });
}

// ------------------------------------------------------------- H3

for (const harness of ['claude', 'codex']) {
  test(`H3 health does not report a ${harness} bot's hooks file for lacking a session mail or nudge hook`, async (t) => {
    const box = await createSandbox(t);
    const { bots, bot } = await botUp(box, harness);
    const file = hookFileOf(bots, bot, harness);
    const hooks = await hooksIn(bots, bot, harness);
    assert.deepEqual(allCommands(hooks).filter((c) => /\bsession (mail|nudge)\b/.test(c)), [], 'the premise: no mail or nudge hook in the file');

    const health = await box.run(['health', '--bots', 'bots']);

    const said = health.stdout + health.stderr;
    assert.ok(!said.includes(file), `health names nothing wrong with ${file}, got:\n${said}`);
    assert.ok(!/session (mail|nudge)|unread|nudge/i.test(said), `health asks for no mail or nudge hook, got:\n${said}`);
  });
}
