// The kit's removed hooks go from every hooks file a bot has (#613).
//
// Since #555 the kit has no `obk session mail` and no `obk session nudge`.
// Before #555 it wrote a hook entry for each, beside its `session record` hook:
//
//   - Claude Code (`<bot>/.claude/settings.json`): a `Stop` group with
//     `<kit> session mail --bots <bots> --bot <bot> 2>/dev/null || true`,
//     timeout 30;
//   - Codex (`<bot>/.codex/hooks.json`): a `PostToolUse` group, matcher
//     `Bash`, with `<kit> session nudge --bots <bots> --bot <bot> 2>/dev/null
//     || true`, timeout 30.
//
// A file of a harness that no session of the bot runs now kept that entry: a
// bot whose sessions moved off the harness, and a paused bot. What is pinned:
//
//   R1  `obk rules build --bots <bots>`, and with `--bot <bot>`, takes the
//       kit's old entry out of every hooks file the bot has, whether or not a
//       session runs on that harness.
//   R2  It does so for a paused bot too, in both files.
//   R3  `obk up --bots <bots> --bot <bot>` takes it out of every hooks file of
//       the bot it brings up, the file of a harness no session runs on
//       included. (`up` leaves a paused bot closed; that is not asked of it.)
//   R4  Only the kit's entry goes. The user's hooks stay as written: one in the
//       same group as the old entry, a group of the user's beside it, and a
//       command that only looks like the kit's (another program, or a line
//       that just names the command).
//   R5  A group that held only the old entry goes, an event left with no group
//       goes, and the kit's current hooks stay as they were.
//   R6  `rules build` leaves the kit's current hooks as they were in a file
//       that holds no old entry.
//   R7  A bot with no hooks file for a harness gets none from `rules build`
//       (nor from `up`, which never wrote one for a harness the bot does not
//       run).
//   R8  A hooks file that is a link leading outside the bot folder is not
//       written through: the file it leads to stays byte for byte (ADR 0022).
//
// The old entry is built from the kit's current `session record` command in
// the same file, the way #555's test builds it. Every run is in the sandbox
// (helpers/cli.js). Nothing here reaches the real Orca or a real harness.

import assert from 'node:assert/strict';
import { mkdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { botHomeOf, createSandbox, eventsIn, hookFileOf, hooksIn } from './helpers/cli.js';

const BOT = 'mix-bot';

/** The old kit entry of each harness, as the kit before #555 wrote it. */
const OLD = {
  claude: { kind: 'mail', event: 'Stop', matcher: undefined },
  codex: { kind: 'nudge', event: 'PostToolUse', matcher: 'Bash' },
};

const OTHER = { claude: 'codex', codex: 'claude' };

/** Every hook command under one event. */
const commandsUnder = (hooks, event) => (eventsIn(hooks)?.[event] ?? [])
  .flatMap((group) => (group?.hooks ?? []).map((one) => String(one?.command)));

/** Every hook command in the file. */
const allCommands = (hooks) => Object.keys(eventsIn(hooks) ?? {}).flatMap((event) => commandsUnder(hooks, event));

/** The kit's own SessionStart command in the file. */
function recordCommandIn(hooks) {
  const found = commandsUnder(hooks, 'SessionStart').filter((command) => /\bsession record\b/.test(command));
  assert.equal(found.length, 1, `the premise: the kit's session record hook, got: ${JSON.stringify(hooks)}`);
  return found[0];
}

/** The old kit command for `kind`, as the kit before #555 wrote it beside its record hook. */
const oldKitCommand = (record, kind) => record.replace(' session record ', ` session ${kind} `);

/** `{ matcher }` for a matcher, nothing for none. */
const matched = (matcher) => (matcher === undefined ? {} : { matcher });

const run = async (box, args) => {
  const result = await box.run(args);
  assert.equal(result.code, 0, `${args.join(' ')}\n${result.stdout}${result.stderr}`);
  return result;
};

/** Close the bot's tabs in the fake Orca, as a restart of Orca leaves them. */
async function closeTabs(box, bots, bot) {
  const home = botHomeOf(bots, bot);
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.worktreePath !== home) });
}

/**
 * A bot that once ran on `harness` and now runs no session on it: made on
 * `harness` with a `daily` session, brought up (so the kit wrote its `harness`
 * hooks file), its tab closed, and the session moved to the other harness.
 * With `harness` codex this is the issue's first bot: default harness codex,
 * every session on Claude.
 */
async function movedOff(box, harness) {
  await run(box, ['init', '--bots', 'bots', '--harness', 'claude']);
  await run(box, ['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', harness]);
  await run(box, ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily']);
  await run(box, ['up', '--bots', 'bots', '--bot', BOT]);
  const bots = box.path('bots');
  assert.notEqual(await hooksIn(bots, BOT, harness), undefined, `the premise: up wrote the ${harness} hooks file`);
  await closeTabs(box, bots, BOT);
  await run(box, ['session', 'change', '--bots', 'bots', '--bot', BOT, '--session', 'daily', '--harness', OTHER[harness]]);
  return bots;
}

/**
 * A paused bot with both hooks files: on Claude, a `daily` session on Claude
 * and an `ops` session on Codex, brought up, its tabs closed, then paused.
 */
async function pausedWithBoth(box) {
  await run(box, ['init', '--bots', 'bots', '--harness', 'claude']);
  await run(box, ['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  await run(box, ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily']);
  await run(box, ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'ops', '--harness', 'codex']);
  await run(box, ['up', '--bots', 'bots', '--bot', BOT]);
  const bots = box.path('bots');
  for (const harness of ['claude', 'codex']) {
    assert.notEqual(await hooksIn(bots, BOT, harness), undefined, `the premise: up wrote the ${harness} hooks file`);
  }
  await closeTabs(box, bots, BOT);
  await run(box, ['pause', '--bots', 'bots', '--bot', BOT]);
  return bots;
}

/**
 * Put the kit's old `harness` entry in the bot's `harness` hooks file, in a
 * group of its own (`withUser` undefined) or with the user's hook after it,
 * then any more groups. Returns the file as it was before, and the old command.
 */
async function withOld(bots, harness, { withUser, more = [] } = {}) {
  const file = hookFileOf(bots, BOT, harness);
  const text = await readFile(file, 'utf8');
  const before = JSON.parse(text);
  const held = JSON.parse(text);
  const events = eventsIn(held);
  const { kind, event, matcher } = OLD[harness];
  const old = oldKitCommand(recordCommandIn(held), kind);
  const oldEntry = { type: 'command', command: old, timeout: 30 };
  events[event] = [
    ...(events[event] ?? []),
    { ...matched(matcher), hooks: withUser === undefined ? [oldEntry] : [oldEntry, withUser] },
    ...more,
  ];
  await writeFile(file, `${JSON.stringify(held, null, 2)}\n`);
  return { file, before, old };
}

/** The old kit command is nowhere in the bot's `harness` hooks file. */
async function assertOldGone(bots, harness, old) {
  const file = hookFileOf(bots, BOT, harness);
  const text = await readFile(file, 'utf8');
  assert.ok(!allCommands(JSON.parse(text)).includes(old), `the kit's old session ${OLD[harness].kind} entry should be gone from ${file}, got:\n${text}`);
}

const RULES_BUILDS = [
  ['rules build --bots', ['rules', 'build', '--bots', 'bots']],
  ['rules build --bot', ['rules', 'build', '--bots', 'bots', '--bot', BOT]],
];

// ------------------------------------------------------------- R1

for (const harness of ['codex', 'claude']) {
  for (const [name, args] of RULES_BUILDS) {
    test(`R1 ${name} takes the old ${OLD[harness].event} session ${OLD[harness].kind} entry out of the ${harness} hooks file of a bot whose sessions all moved to ${OTHER[harness]}`, async (t) => {
      const box = await createSandbox(t);
      const bots = await movedOff(box, harness);
      const { old } = await withOld(bots, harness);

      await run(box, args);

      await assertOldGone(bots, harness, old);
    });
  }
}

// ------------------------------------------------------------- R2

for (const [name, args] of RULES_BUILDS) {
  test(`R2 ${name} takes the old entries out of both hooks files of a paused bot`, async (t) => {
    const box = await createSandbox(t);
    const bots = await pausedWithBoth(box);
    const olds = {};
    for (const harness of ['claude', 'codex']) olds[harness] = (await withOld(bots, harness)).old;

    await run(box, args);

    for (const harness of ['claude', 'codex']) await assertOldGone(bots, harness, olds[harness]);
  });
}

// ------------------------------------------------------------- R3

for (const harness of ['codex', 'claude']) {
  test(`R3 up takes the old ${OLD[harness].event} session ${OLD[harness].kind} entry out of the ${harness} hooks file of a bot whose sessions all moved to ${OTHER[harness]}`, async (t) => {
    const box = await createSandbox(t);
    const bots = await movedOff(box, harness);
    const { old } = await withOld(bots, harness);

    await run(box, ['up', '--bots', 'bots', '--bot', BOT]);

    await assertOldGone(bots, harness, old);
  });
}

// ------------------------------------------------------------- R4

/**
 * The user's hooks under the old entry's event: one put in the old entry's
 * group, a group of their own, and a group of commands that only look like the
 * kit's. Returns the groups the event must hold afterwards, exactly as written.
 */
function usersOwn(bots, harness) {
  const { kind, matcher } = OLD[harness];
  const inGroup = { type: 'command', command: "echo 'my own hook, in the old kit group'", timeout: 5 };
  const alone = { ...matched(matcher), hooks: [{ type: 'command', command: "logger 'my own hook, alone'" }] };
  const lookalike = {
    ...matched(matcher),
    hooks: [
      { type: 'command', command: `my-tool session ${kind} --bots ${bots} --bot ${BOT} 2>/dev/null || true`, timeout: 30 },
      { type: 'command', command: `echo 'obk session ${kind} is gone' >/dev/null` },
    ],
  };
  return {
    inGroup,
    more: [alone, lookalike],
    after: [{ ...matched(matcher), hooks: [inGroup] }, alone, lookalike],
  };
}

/** The event holds exactly the user's groups, each as written. */
async function assertUsersKept(bots, harness, after) {
  const file = hookFileOf(bots, BOT, harness);
  const text = await readFile(file, 'utf8');
  const groups = eventsIn(JSON.parse(text))?.[OLD[harness].event] ?? [];
  for (const group of after) {
    assert.ok(groups.some((one) => { try { assert.deepEqual(one, group); return true; } catch { return false; } }),
      `the user's group ${JSON.stringify(group)} should stay as written in ${file}, got:\n${text}`);
  }
  assert.equal(groups.length, after.length, `only the user's groups stay under ${OLD[harness].event} in ${file}, got:\n${text}`);
}

for (const harness of ['codex', 'claude']) {
  test(`R4 rules build takes out only the kit's old entry from the ${harness} hooks file: the user's hooks in its group, beside it and lookalikes stay as written`, async (t) => {
    const box = await createSandbox(t);
    const bots = await movedOff(box, harness);
    const mine = usersOwn(bots, harness);
    const { old } = await withOld(bots, harness, { withUser: mine.inGroup, more: mine.more });

    await run(box, ['rules', 'build', '--bots', 'bots']);

    await assertOldGone(bots, harness, old);
    await assertUsersKept(bots, harness, mine.after);
  });
}

test('R4 up takes out only the kit\'s old entry from the codex hooks file of a bot on Claude: the user\'s hooks stay as written', async (t) => {
  const box = await createSandbox(t);
  const bots = await movedOff(box, 'codex');
  const mine = usersOwn(bots, 'codex');
  const { old } = await withOld(bots, 'codex', { withUser: mine.inGroup, more: mine.more });

  await run(box, ['up', '--bots', 'bots', '--bot', BOT]);

  await assertOldGone(bots, 'codex', old);
  await assertUsersKept(bots, 'codex', mine.after);
});

test('R4 rules build takes out only the kit\'s old entries from a paused bot\'s files: the user\'s hooks stay as written', async (t) => {
  const box = await createSandbox(t);
  const bots = await pausedWithBoth(box);
  const kept = {};
  const olds = {};
  for (const harness of ['claude', 'codex']) {
    const mine = usersOwn(bots, harness);
    kept[harness] = mine.after;
    olds[harness] = (await withOld(bots, harness, { withUser: mine.inGroup, more: mine.more })).old;
  }

  await run(box, ['rules', 'build', '--bots', 'bots']);

  for (const harness of ['claude', 'codex']) {
    await assertOldGone(bots, harness, olds[harness]);
    await assertUsersKept(bots, harness, kept[harness]);
  }
});

// ------------------------------------------------------------- R5

for (const harness of ['codex', 'claude']) {
  test(`R5 rules build on a ${harness} hooks file whose old entry sat alone: its group and the empty ${OLD[harness].event} go, and the kit's current hooks stay as they were`, async (t) => {
    const box = await createSandbox(t);
    const bots = await movedOff(box, harness);
    const { file, before } = await withOld(bots, harness);

    await run(box, ['rules', 'build', '--bots', 'bots']);

    const text = await readFile(file, 'utf8');
    assert.deepEqual(JSON.parse(text).hooks, before.hooks, `the hooks should be as the kit wrote them before the old entry, got:\n${text}`);
  });
}

// ------------------------------------------------------------- R6

for (const harness of ['codex', 'claude']) {
  test(`R6 rules build leaves the kit's current hooks in a ${harness} bot's hooks file as they were`, async (t) => {
    const box = await createSandbox(t);
    await run(box, ['init', '--bots', 'bots', '--harness', 'claude']);
    await run(box, ['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', harness]);
    await run(box, ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily']);
    await run(box, ['up', '--bots', 'bots', '--bot', BOT]);
    const bots = box.path('bots');
    const before = await hooksIn(bots, BOT, harness);
    assert.notEqual(before?.hooks, undefined, 'the premise: up wrote the kit\'s hooks');

    await run(box, ['rules', 'build', '--bots', 'bots']);

    assert.deepEqual((await hooksIn(bots, BOT, harness)).hooks, before.hooks);
  });
}

// ------------------------------------------------------------- R7

test('R7 a bot that runs only on Claude and has no codex hooks file gets none from rules build or up', async (t) => {
  const box = await createSandbox(t);
  await run(box, ['init', '--bots', 'bots', '--harness', 'claude']);
  await run(box, ['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  await run(box, ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily']);
  const bots = box.path('bots');
  const file = hookFileOf(bots, BOT, 'codex');

  for (const args of [
    ['rules', 'build', '--bots', 'bots'],
    ['rules', 'build', '--bots', 'bots', '--bot', BOT],
    ['up', '--bots', 'bots', '--bot', BOT],
    ['rules', 'build', '--bots', 'bots'],
    ['rules', 'build', '--bots', 'bots', '--bot', BOT],
  ]) {
    await run(box, args);
    assert.equal(await hooksIn(bots, BOT, 'codex'), undefined, `${args.join(' ')} should make no ${file}`);
  }
});

test('R7 a paused bot that runs only on Claude gets no codex hooks file from rules build', async (t) => {
  const box = await createSandbox(t);
  await run(box, ['init', '--bots', 'bots', '--harness', 'claude']);
  await run(box, ['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  await run(box, ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily']);
  await run(box, ['pause', '--bots', 'bots', '--bot', BOT]);
  const bots = box.path('bots');

  await run(box, ['rules', 'build', '--bots', 'bots']);

  assert.equal(await hooksIn(bots, BOT, 'codex'), undefined);
});

// ------------------------------------------------------------- R8

test('R8 rules build does not write through a codex hooks file that links outside the bot folder', async (t) => {
  const box = await createSandbox(t);
  const bots = await movedOff(box, 'codex');
  await withOld(bots, 'codex');
  const file = hookFileOf(bots, BOT, 'codex');
  const held = await readFile(file, 'utf8');
  const target = path.join(box.home, '.codex', 'hooks.json');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, held);
  await rm(file);
  await symlink(target, file);

  await box.run(['rules', 'build', '--bots', 'bots']);

  assert.equal(await readFile(target, 'utf8'), held, 'the file outside the bot folder, byte for byte');
  assert.equal(await readlink(file), target, 'and the link is left as it was');
});
