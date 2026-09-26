// The kit's own hook, and where `obk up` puts it (ADR 0022).
//
// The book has to learn a session's harness session id whenever the session
// starts, resumes or is cleared, and the only thing that knows is the harness
// itself. Both harnesses fire a `SessionStart` hook out of the folder the
// session runs in — proven live on this machine, `<cwd>/.claude/settings.json`
// for Claude Code and `<cwd>/.codex/hooks.json` for Codex, with no user-level
// settings involved either side. So the hook goes in the bot's own folder,
// which is also where it is versioned with the bot and cannot collide with
// what Orca or anything else writes into the user's own settings file.
//
// What is pinned here is the contract, not the file format: the file a harness
// reads, one command under `SessionStart` — one event, the same on both — that
// calls `obk session record` for this bots folder and this bot, and — proved by
// running it — that the command does the work when `obk` is there and does
// nothing at all when it is not. How the JSON around it is arranged is the
// harness's business and the implementer's.
//
// Four rules matter as much as the writing. The user's own text in those files
// survives, because a bot folder's settings are theirs as much as the kit's.
// The kit's own entries come out of every event before its one entry goes back
// in, so a bot folder written by an older kit is not left calling the hook on an
// event this one no longer answers. A file the kit cannot write into without
// writing over what they put there is refused, by name, rather than cleared out
// of the way — the kit's hook is not worth one line of theirs (PRD 6.3). And
// nothing, ever, is written to user-level settings, which is what the empty HOME
// in every sandbox is watching for.

import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';

import {
  assertCleanFailure,
  assertHomeUntouched,
  botHomeOf,
  createSandbox,
  eventsIn,
  HOOK_FILES,
  hookFileOf,
  hooksIn,
  kitEventsIn,
  kitHooksIn,
  recordSession,
  sessionIn,
  skipGit,
  snapshot,
  tabsOfBot,
  throughAHarness,
} from './helpers/cli.js';

/** A seeded bots folder. Bot Father comes with it, and is left alone by these tests. */
async function seeded(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  return box.path('bots');
}

/** Write a bot with the sessions given: `[name, settings]` each. */
async function withBot(box, bot, harness, sessions) {
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness]);
  assert.equal(made.code, 0, made.stderr);
  for (const [name, settings = []] of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', name, ...settings]);
    assert.equal(added.code, 0, added.stderr);
  }
  return box.path('bots');
}

/** Bring one bot up, and say so when it did not come up. */
async function up(box, bot) {
  const result = await box.run(['up', '--bots', 'bots', '--bot', bot]);
  assert.equal(result.code, 0, result.stderr);
  return result;
}

/** The one command the kit wrote into a bot's `<harness>` hooks, and nothing less or more. */
async function kitHookOf(bots, bot, harness) {
  const found = kitHooksIn(await hooksIn(bots, bot, harness));
  assert.equal(
    found.length,
    1,
    `${hookFileOf(bots, bot, harness)} should hold exactly one obk session record command, got: ${JSON.stringify(found)}`,
  );
  return found[0];
}

/** Whether the kit wrote a bot a hook file for `harness` at all. */
const hasHook = async (bots, bot, harness) => (await hooksIn(bots, bot, harness)) !== undefined;

for (const [harness, other] of [['claude', 'codex'], ['codex', 'claude']]) {
  test(`up writes the ${harness} hook into the bot home, and only that harness's`, async (t) => {
    const box = await createSandbox(t);
    await seeded(box);
    const bots = await withBot(box, 'api-bot', harness, [['daily']]);

    await up(box, 'api-bot');

    assert.equal(await hasHook(bots, 'api-bot', harness), true, `the ${harness} hook file should be there`);
    assert.equal(
      await hasHook(bots, 'api-bot', other),
      false,
      `no session runs on ${other}, so ${hookFileOf(bots, 'api-bot', other)} has no reason to exist`,
    );
    // In the bot's own folder, where it is versioned with the bot (ADR 0022).
    assert.equal(
      path.relative(botHomeOf(bots, 'api-bot'), hookFileOf(bots, 'api-bot', harness)),
      HOOK_FILES[harness],
    );
  });
}

test('a bot with a session on each harness gets both hook files', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  const bots = await withBot(box, 'api-bot', 'codex', [['daily'], ['review', ['--harness', 'claude']]]);

  await up(box, 'api-bot');

  assert.equal(await hasHook(bots, 'api-bot', 'codex'), true, 'the bot\'s own harness');
  assert.equal(await hasHook(bots, 'api-bot', 'claude'), true, 'and the one a session of its own named');
});

test('a bot with no sessions gets neither hook file', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  const bots = await withBot(box, 'quiet-bot', 'claude', []);

  await up(box, 'quiet-bot');

  for (const harness of ['claude', 'codex']) {
    assert.equal(
      await hasHook(bots, 'quiet-bot', harness),
      false,
      `nothing runs in ${'quiet-bot'}, so ${hookFileOf(bots, 'quiet-bot', harness)} has no reason to exist`,
    );
  }
});

for (const harness of ['claude', 'codex']) {
  test(`the ${harness} hook runs obk session record for this bots folder and this bot`, async (t) => {
    const box = await createSandbox(t);
    await seeded(box);
    const bots = await withBot(box, 'api-bot', harness, [['daily']]);

    await up(box, 'api-bot');

    const command = await kitHookOf(bots, 'api-bot', harness);
    assert.ok(command.includes(bots), `the hook should name this bots folder, got: ${command}`);
    assert.ok(/\bapi-bot\b/.test(command), `the hook should name the bot it belongs to, got: ${command}`);
  });

  test(`the ${harness} hook, run as the harness runs it, writes the session into the book`, async (t) => {
    // The whole point of the file, end to end: the harness runs this line with
    // the event on standard input and Orca's `ORCA_TAB_ID` in its environment,
    // and afterwards the book knows what the session is running as.
    const box = await createSandbox(t);
    await seeded(box);
    const bots = await withBot(box, 'api-bot', harness, [['daily']]);
    await up(box, 'api-bot');
    const tab = (await tabsOfBot(box, bots, 'api-bot'))[0];

    // Under the chain a real harness makes, because that is where the kit
     // believes a report from (round 2, finding 2).
    const ran = await throughAHarness(box, await kitHookOf(bots, 'api-bot', harness), {
      tab: tab.tabId,
      stdin: `{"session_id":"sess-from-the-hook","transcript_path":"/nowhere","cwd":"${botHomeOf(bots, 'api-bot')}",`
        + '"hook_event_name":"SessionStart","source":"startup"}\n',
    });

    assert.equal(ran.code, 0, `the hook should not fail the session: ${ran.stderr}`);
    assert.equal(
      (await sessionIn(bots, 'api-bot', 'daily')).session,
      'sess-from-the-hook',
      'the book should hold the id the harness reported',
    );
  });

  test(`the ${harness} hook whose CLI is no longer there does nothing and disturbs nothing`, async (t) => {
    // ADR 0022: the hook must never block the session if the kit is missing.
    // The hook runs the kit by the path it was written with (#220), so a user
    // who uninstalls it, or whose install moved, or who runs a session on a
    // machine where it was never installed, must get a session that starts
    // anyway — and, above all, nothing on standard output, which is where the
    // harness looks for the hook's answer.
    const box = await createSandbox(t);
    await seeded(box);
    const bots = await withBot(box, 'api-bot', harness, [['daily']]);
    await up(box, 'api-bot');
    const tab = (await tabsOfBot(box, bots, 'api-bot'))[0];
    const hook = await kitHookOf(bots, 'api-bot', harness);

    // The link goes, not the checkout's file it leads to. And PATH holds node
    // and nothing else, so no other `obk` on this machine can stand in for it.
    await rm(box.cli);
    const nodeOnly = path.join(box.root, 'node-only');
    await mkdir(nodeOnly, { recursive: true });
    await symlink(process.execPath, path.join(nodeOnly, 'node'));
    const ran = await throughAHarness(box, hook, {
      env: { ...box.env, PATH: nodeOnly },
      tab: tab.tabId,
      stdin: '{"session_id":"sess-1","hook_event_name":"SessionStart","source":"clear"}\n',
    });

    assert.equal(ran.code, 0, `a missing obk must not fail the session: ${ran.stdout}${ran.stderr}`);
    assert.equal(ran.stdout, '', `and must say nothing the harness would read as its answer: ${ran.stdout}`);
  });
}

test('the user\'s own claude settings survive, and the file is still JSON', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  const bots = await withBot(box, 'api-bot', 'claude', [['daily']]);
  const file = hookFileOf(bots, 'api-bot', 'claude');
  const theirs = {
    permissions: { allow: ['Bash(git status:*)'] },
    env: { MY_KEY: 'mine' },
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: 'echo mine' }] }],
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo before' }] }],
    },
  };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(theirs, null, 2)}\n`);

  await up(box, 'api-bot');

  const now = await hooksIn(bots, 'api-bot', 'claude');
  assert.deepEqual(now.permissions, theirs.permissions, 'the user\'s permissions are the user\'s');
  assert.deepEqual(now.env, theirs.env, 'and so is anything else they put in the file');
  assert.deepEqual(now.hooks.PreToolUse, theirs.hooks.PreToolUse, 'a hook of theirs on another event is untouched');
  assert.ok(
    JSON.stringify(now.hooks.SessionStart).includes('echo mine'),
    `their own SessionStart hook should still be there, got: ${JSON.stringify(now.hooks.SessionStart)}`,
  );
  await kitHookOf(bots, 'api-bot', 'claude');
});

test('the user\'s own codex hooks survive, and the file is still JSON', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  const bots = await withBot(box, 'api-bot', 'codex', [['daily']]);
  const file = hookFileOf(bots, 'api-bot', 'codex');
  const theirs = { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(theirs, null, 2)}\n`);

  await up(box, 'api-bot');

  const text = await readFile(file, 'utf8');
  assert.doesNotThrow(() => JSON.parse(text), `the file must stay JSON a harness can read, got:\n${text}`);
  assert.ok(text.includes('echo mine'), `the user's own hook should still be there, got:\n${text}`);
  await kitHookOf(bots, 'api-bot', 'codex');
});

for (const harness of ['claude', 'codex']) {
  test(`a second up adds no second copy of the ${harness} hook, and changes nothing else`, async (t) => {
    const box = await createSandbox(t);
    await seeded(box);
    const bots = await withBot(box, 'api-bot', harness, [['daily']]);
    const file = hookFileOf(bots, 'api-bot', harness);

    await up(box, 'api-bot');
    const first = await readFile(file, 'utf8');
    await up(box, 'api-bot');
    const second = await readFile(file, 'utf8');

    await kitHookOf(bots, 'api-bot', harness);
    assert.deepEqual(
      JSON.parse(second),
      JSON.parse(first),
      `a run with nothing to do must leave the file saying what it said:\n--- first ---\n${first}\n--- second ---\n${second}`,
    );
  });

  test(`a second up leaves the user's own ${harness} hooks alone`, async (t) => {
    const box = await createSandbox(t);
    await seeded(box);
    const bots = await withBot(box, 'api-bot', harness, [['daily']]);
    const file = hookFileOf(bots, 'api-bot', harness);

    await up(box, 'api-bot');
    const mine = JSON.parse(await readFile(file, 'utf8'));
    mine.theUsersOwnKey = 'mine';
    await writeFile(file, `${JSON.stringify(mine, null, 2)}\n`);

    await up(box, 'api-bot');

    assert.equal((await hooksIn(bots, 'api-bot', harness)).theUsersOwnKey, 'mine');
    await kitHookOf(bots, 'api-bot', harness);
  });
}

for (const harness of ['claude', 'codex']) {
  test(`the kit asks the ${harness} hook about one event, and it is SessionStart`, async (t) => {
    // One event, the same on both. Every id the book learns — a start, a
    // resume, a clear — arrives on this one, so a second event would be the
    // same report twice or a report nobody reads.
    const box = await createSandbox(t);
    await seeded(box);
    const bots = await withBot(box, 'api-bot', harness, [['daily']]);

    await up(box, 'api-bot');

    const events = kitEventsIn(await hooksIn(bots, 'api-bot', harness));
    assert.deepEqual(Object.keys(events), ['SessionStart'], `got: ${JSON.stringify(events)}`);
    assert.equal(events.SessionStart.length, 1);
  });

  test(`an entry of the kit's under another ${harness} event is taken out, and the empty event with it`, async (t) => {
    // The bug this is written against: the kit asked about an event, stopped
    // asking, and every bot folder written while it did kept calling the hook
    // on an event the kit no longer answers. So the kit's own entries come out
    // of every event before its one entry goes back in, and an event left
    // holding nothing is not left behind as an empty key either.
    const box = await createSandbox(t);
    await seeded(box);
    const bots = await withBot(box, 'api-bot', harness, [['daily']]);
    const file = hookFileOf(bots, 'api-bot', harness);
    await up(box, 'api-bot');

    // The kit's own entry, copied whole onto an event it no longer asks about.
    const planted = JSON.parse(await readFile(file, 'utf8'));
    eventsIn(planted).SessionEnd = structuredClone(eventsIn(planted).SessionStart);
    await writeFile(file, `${JSON.stringify(planted, null, 2)}\n`);
    assert.deepEqual(Object.keys(kitEventsIn(planted)).sort(), ['SessionEnd', 'SessionStart']);

    await up(box, 'api-bot');

    const now = await hooksIn(bots, 'api-bot', harness);
    assert.deepEqual(Object.keys(kitEventsIn(now)), ['SessionStart'], 'the kit answers one event and asks about one');
    assert.equal(
      'SessionEnd' in (eventsIn(now) ?? {}),
      false,
      `an event that held nothing but the kit's entry goes with it, got: ${JSON.stringify(eventsIn(now))}`,
    );
  });

  test(`an event holding the user's entry beside the kit's keeps theirs, on ${harness}`, async (t) => {
    // The other half of the same rule. Taking the kit's entry out of an event
    // is not a licence to take the event, or anything of the user's in it.
    const box = await createSandbox(t);
    await seeded(box);
    const bots = await withBot(box, 'api-bot', harness, [['daily']]);
    const file = hookFileOf(bots, 'api-bot', harness);
    await up(box, 'api-bot');

    const planted = JSON.parse(await readFile(file, 'utf8'));
    const kit = eventsIn(planted).SessionStart;
    assert.ok(Array.isArray(kit), `an event should hold a list of entries, got: ${JSON.stringify(kit)}`);
    eventsIn(planted).SessionEnd = [...structuredClone(kit), { hooks: [{ type: 'command', command: 'echo mine' }] }];
    await writeFile(file, `${JSON.stringify(planted, null, 2)}\n`);

    await up(box, 'api-bot');

    const now = await hooksIn(bots, 'api-bot', harness);
    assert.deepEqual(Object.keys(kitEventsIn(now)), ['SessionStart'], `got: ${JSON.stringify(now)}`);
    assert.deepEqual(
      eventsIn(now).SessionEnd,
      [{ hooks: [{ type: 'command', command: 'echo mine' }] }],
      'the user\'s own entry stays, and the event stays with it',
    );
  });
}

/** A hook of the user's own, to sit beside the kit's and be left alone. */
const THEIRS = { type: 'command', command: 'echo mine' };

/**
 * The kit's entry and the user's, in one group, under `event`. Planting it means
 * taking the group the kit actually wrote and adding to it, so what is beside
 * the kit's entry is beside the real thing rather than a guess at it.
 */
async function planted(bots, harness, event, { settings = {} } = {}) {
  const file = hookFileOf(bots, 'api-bot', harness);
  const held = JSON.parse(await readFile(file, 'utf8'));
  const events = eventsIn(held);
  const group = structuredClone(events.SessionStart[0]);
  assert.ok(Array.isArray(group.hooks), `a group should hold a list of hooks, got: ${JSON.stringify(group)}`);
  events[event] = [{ ...group, ...settings, hooks: [...group.hooks, THEIRS] }];
  await writeFile(file, `${JSON.stringify(held, null, 2)}\n`);
  return file;
}

/** Every hook, of anybody's, under one event of a parsed file. */
const hooksUnder = (held, event) => (eventsIn(held)?.[event] ?? []).flatMap((group) => group.hooks ?? []);

for (const harness of ['claude', 'codex']) {
  test(`a hook of the user's beside the kit's own survives a second ${harness} up`, async (t) => {
    // The review put a valid hook of theirs in the same group as the kit's and
    // watched the next `up` delete the whole group. The kit owns its one entry
    // and not the group it sits in.
    const box = await createSandbox(t);
    await seeded(box);
    const bots = await withBot(box, 'api-bot', harness, [['daily']]);
    await up(box, 'api-bot');
    const file = await planted(bots, harness, 'SessionStart');

    await up(box, 'api-bot');

    const held = await hooksIn(bots, 'api-bot', harness);
    assert.ok(
      hooksUnder(held, 'SessionStart').some((hook) => hook.command === THEIRS.command),
      `their hook should still be there, got:\n${await readFile(file, 'utf8')}`,
    );
    assert.equal(kitHooksIn(held).length, 1, 'and the kit still has its one entry');
  });

  test(`the kit's ${harness} entry is brought up to date where it sits`, async (t) => {
    // A bots folder that moved, so the path in the entry is stale. The entry is
    // corrected in place: not a second one beside it, and not at the cost of the
    // group it shares or of what the user set on that group.
    const box = await createSandbox(t);
    await seeded(box);
    const bots = await withBot(box, 'api-bot', harness, [['daily']]);
    await up(box, 'api-bot');
    const file = await planted(bots, harness, 'SessionStart', { settings: { matcher: 'mine' } });
    const stale = JSON.parse(await readFile(file, 'utf8'));
    const group = eventsIn(stale).SessionStart[0];
    group.hooks = group.hooks.map((hook) => (typeof hook.command === 'string' && hook.command.includes('session record')
      ? { ...hook, command: hook.command.replace(bots, '/somewhere/else') }
      : hook));
    await writeFile(file, `${JSON.stringify(stale, null, 2)}\n`);

    await up(box, 'api-bot');

    const held = await hooksIn(bots, 'api-bot', harness);
    assert.equal(eventsIn(held).SessionStart.length, 1, 'one group, the one that was there');
    assert.equal(eventsIn(held).SessionStart[0].matcher, 'mine', 'and what the user set on it');
    assert.ok(
      hooksUnder(held, 'SessionStart').some((hook) => hook.command === THEIRS.command),
      'and their hook in it',
    );
    const kit = kitHooksIn(held);
    assert.equal(kit.length, 1, `one entry of the kit's, got: ${JSON.stringify(kit)}`);
    assert.ok(kit[0].includes(bots), `naming this bots folder, got: ${kit[0]}`);
    assert.ok(!kit[0].includes('/somewhere/else'), `and not the one it used to, got: ${kit[0]}`);
  });

  test(`an old ${harness} entry of the kit's goes without taking the group's other hooks`, async (t) => {
    // The event the kit no longer asks about. Its own entry comes out; a hook of
    // the user's in the same group is not the kit's to take, so the group and the
    // event both stay.
    const box = await createSandbox(t);
    await seeded(box);
    const bots = await withBot(box, 'api-bot', harness, [['daily']]);
    await up(box, 'api-bot');
    await planted(bots, harness, 'SessionEnd');

    await up(box, 'api-bot');

    const held = await hooksIn(bots, 'api-bot', harness);
    assert.deepEqual(Object.keys(kitEventsIn(held)), ['SessionStart'], 'the kit asks about the one event');
    assert.deepEqual(
      hooksUnder(held, 'SessionEnd'),
      [THEIRS],
      `their hook stays and the kit's goes, got: ${JSON.stringify(eventsIn(held).SessionEnd)}`,
    );
  });

  test(`a ${harness} group left with no hooks at all goes, and its neighbours stay`, async (t) => {
    // The kit's entry alone in its group, beside a group that is entirely the
    // user's. The empty group goes; the event stays because something is left in
    // it.
    const box = await createSandbox(t);
    await seeded(box);
    const bots = await withBot(box, 'api-bot', harness, [['daily']]);
    await up(box, 'api-bot');
    const file = hookFileOf(bots, 'api-bot', harness);
    const held = JSON.parse(await readFile(file, 'utf8'));
    const events = eventsIn(held);
    events.SessionEnd = [structuredClone(events.SessionStart[0]), { hooks: [THEIRS] }];
    await writeFile(file, `${JSON.stringify(held, null, 2)}\n`);

    await up(box, 'api-bot');

    const now = await hooksIn(bots, 'api-bot', harness);
    assert.deepEqual(Object.keys(kitEventsIn(now)), ['SessionStart']);
    assert.deepEqual(
      eventsIn(now).SessionEnd,
      [{ hooks: [THEIRS] }],
      `the group that held nothing but the kit's entry goes, got: ${JSON.stringify(eventsIn(now).SessionEnd)}`,
    );
  });
}

/**
 * Everything a hooks file can already hold that leaves the kit nowhere to put
 * its entry without writing over what the user wrote. The kit's hook is not
 * worth one line of theirs (PRD 6.3), so each of these is refused rather than
 * cleared out of the way.
 */
const NOT_THE_KIT_S_TO_TOUCH = {
  'the hooks entry is a line of text': '{\n  "hooks": "run my own thing"\n}\n',
  'the hooks entry is a list': '{\n  "hooks": ["run my own thing"]\n}\n',
  'the hooks entry is null': '{\n  "hooks": null\n}\n',
  'the hooks entry is a number': '{\n  "hooks": 42\n}\n',
  'the file is not JSON at all': '# my settings, in the wrong format\nhooks: mine\n',
  'the file is a list': '["mine"]\n',
  'the file is a bare string': '"mine"\n',
};

for (const [label, contents] of Object.entries(NOT_THE_KIT_S_TO_TOUCH)) {
  test(`up refuses and writes nothing when ${label}`, async (t) => {
    const box = await createSandbox(t);
    await seeded(box);
    const bots = await withBot(box, 'api-bot', 'claude', [['daily']]);
    const file = hookFileOf(bots, 'api-bot', 'claude');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
    const before = await snapshot(bots, skipGit);
    const open = await box.orca.terminals();

    const result = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

    assertCleanFailure(result);
    assert.ok(result.stderr.includes(file), `the message should name the file, got: ${result.stderr}`);
    assert.equal(await readFile(file, 'utf8'), contents, 'what the user wrote is untouched');
    assert.deepEqual(await snapshot(bots, skipGit), before, 'and a refusal writes nothing at all');
    assert.deepEqual(await box.orca.terminals(), open, 'and opens no tab for the bot it refused');
  });
}

test('up refuses a codex hooks file it cannot write into either', async (t) => {
  // The same rule, the other file: it is the user's text in both.
  const box = await createSandbox(t);
  await seeded(box);
  const bots = await withBot(box, 'api-bot', 'codex', [['daily']]);
  const file = hookFileOf(bots, 'api-bot', 'codex');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, '{\n  "hooks": "run my own thing"\n}\n');
  const before = await snapshot(bots, skipGit);

  const result = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes(file), `the message should name the file, got: ${result.stderr}`);
  assert.deepEqual(await snapshot(bots, skipGit), before);
});

test('two bots each get their own hook, naming their own bot', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  await withBot(box, 'one-bot', 'claude', [['daily']]);
  const bots = await withBot(box, 'two-bot', 'claude', [['daily']]);

  await up(box, 'one-bot');
  await up(box, 'two-bot');

  const one = await kitHookOf(bots, 'one-bot', 'claude');
  const two = await kitHookOf(bots, 'two-bot', 'claude');
  assert.notEqual(one, two, 'a bot\'s hook records that bot, and no other');
  assert.ok(/\bone-bot\b/.test(one), `got: ${one}`);
  assert.ok(/\btwo-bot\b/.test(two), `got: ${two}`);
});

test('no command of the kit writes anything to user-level settings', async (t) => {
  // The rule ADR 0022 exists for: Orca writes its hooks into `~/.claude` and
  // the user had to take that file out of version control because of it. HOME
  // is inside the sandbox, so anything reaching for it lands here.
  const box = await createSandbox(t);
  await seeded(box);
  const bots = await withBot(box, 'api-bot', 'claude', [['daily', ['--prompt', 'Read your AGENTS.md.']]]);

  await up(box, 'api-bot');
  const tab = (await tabsOfBot(box, bots, 'api-bot'))[0];
  await recordSession(box, { bots, bot: 'api-bot', tab: tab.tabId, session: 'sess-1', source: 'clear' });
  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);

  await assertHomeUntouched(box);
});

// ---------------------------------------------------------------------------
// Which entries are the kit's (#165). The kit changes or removes only what it
// wrote (PRD 6.5, ADR 0022). An entry is the kit's when its command is the
// line the kit writes, `obk session record --bots <word> --bot <word> 2>/dev/null
// || true`, for whatever bots folder and bot it was written for. A line of the
// user's that only mentions `obk session record` is theirs, however close it
// comes to the kit's.
// ---------------------------------------------------------------------------

/**
 * The user's own lines that mention the kit's command without being the line the
 * kit writes, built from `kit`, the line the kit wrote for this bot.
 */
function lookAlikes(kit) {
  const alikes = {
    'a wrapper script that calls it': 'my-wrapper && obk session record --bots x --bot y',
    'a log line that names it': "logger 'obk session record ran'",
    'the kit\'s line after something of theirs': `my-wrapper && ${kit}`,
    'the kit\'s line with something of theirs after it': `${kit}; echo done`,
    'the kit\'s line with its errors kept in a log': kit.replace(' 2>/dev/null', ' 2>>/tmp/obk.log'),
    'the kit\'s line without the part that keeps a failure quiet': kit.replace(/ \|\| true$/, ''),
    'the kit\'s line with the folder in double quotes': kit.replace(/ --bots \S+ /, ' --bots "/their place/bots" '),
  };
  for (const [label, command] of Object.entries(alikes)) {
    assert.notEqual(command, kit, `the look-alike "${label}" should differ from the kit's own line`);
    assert.ok(command.includes('obk session record'), `the look-alike "${label}" should mention the kit's command`);
  }
  return alikes;
}

/** Every hook command under one event of a parsed file. */
const commandsUnder = (held, event) => hooksUnder(held, event).map((hook) => hook.command);

/** Every hook command in a parsed file, under every event. */
const allCommands = (held) => Object.keys(eventsIn(held) ?? {}).flatMap((event) => commandsUnder(held, event));

for (const harness of ['claude', 'codex']) {
  test(`a hook of the user's that only mentions obk session record stays theirs, and the kit adds its own, on ${harness}`, async (t) => {
    const box = await createSandbox(t);
    await seeded(box);
    const bots = await withBot(box, 'api-bot', harness, [['daily']]);
    await up(box, 'api-bot');
    const kit = await kitHookOf(bots, 'api-bot', harness);
    const file = hookFileOf(bots, 'api-bot', harness);

    // The user's file as they keep it: their look-alikes, and no entry of the kit's.
    const alikes = lookAlikes(kit);
    const theirs = Object.values(alikes).map((command) => ({ hooks: [{ type: 'command', command }] }));
    await writeFile(file, `${JSON.stringify({ hooks: { SessionStart: theirs } }, null, 2)}\n`);

    await up(box, 'api-bot');

    const held = await hooksIn(bots, 'api-bot', harness);
    const groups = eventsIn(held).SessionStart;
    for (const [label, command] of Object.entries(alikes)) {
      assert.ok(
        groups.some((group) => isDeepStrictEqual(group, { hooks: [{ type: 'command', command }] })),
        `their hook (${label}) should stay exactly as they wrote it: ${command}\ngot:\n${await readFile(file, 'utf8')}`,
      );
    }
    assert.deepEqual(
      allCommands(held).filter((command) => command === kit),
      [kit],
      `and the kit's own line should be there once, beside theirs, got:\n${await readFile(file, 'utf8')}`,
    );
    assert.equal(
      allCommands(held).length,
      Object.keys(alikes).length + 1,
      `their hooks and the kit's, and nothing else, got:\n${await readFile(file, 'utf8')}`,
    );
  });

  test(`the user's look-alikes beside the kit's own entry leave the ${harness} file as it was`, async (t) => {
    // Their lines placed ahead of the kit's, where a kit that took the first
    // match for its own would write over one and drop the rest, and one under
    // an event the kit does not ask about, where it would take it out.
    const box = await createSandbox(t);
    await seeded(box);
    const bots = await withBot(box, 'api-bot', harness, [['daily']]);
    await up(box, 'api-bot');
    const kit = await kitHookOf(bots, 'api-bot', harness);
    const file = hookFileOf(bots, 'api-bot', harness);

    const held = JSON.parse(await readFile(file, 'utf8'));
    const events = eventsIn(held);
    const alikes = Object.values(lookAlikes(kit));
    events.SessionStart = [{ hooks: alikes.map((command) => ({ type: 'command', command })) }, ...events.SessionStart];
    events.PreToolUse = [{ matcher: 'Bash', hooks: [{ type: 'command', command: "logger 'obk session record ran'" }] }];
    await writeFile(file, `${JSON.stringify(held, null, 2)}\n`);
    const before = await readFile(file, 'utf8');

    await up(box, 'api-bot');

    const after = await readFile(file, 'utf8');
    assert.deepEqual(
      JSON.parse(after),
      JSON.parse(before),
      `nothing in the file is the kit's to change:\n--- before ---\n${before}\n--- after ---\n${after}`,
    );
  });

  test(`the kit's ${harness} entry written for another bots folder or bot is still the kit's, and is replaced`, async (t) => {
    // The kit wrote these, for a bots folder that has since moved (a bare path,
    // one with a space, one with a quote in it) or for a bot since renamed. Each
    // is the kit's and is put right in place, not left beside a new one; the
    // same line under an event the kit no longer asks about comes out.
    const box = await createSandbox(t);
    await seeded(box);
    const bots = await withBot(box, 'api-bot', harness, [['daily']]);
    await up(box, 'api-bot');
    const kit = await kitHookOf(bots, 'api-bot', harness);
    const file = hookFileOf(bots, 'api-bot', harness);
    assert.ok(kit.includes(` --bots ${bots} --bot api-bot `), `this test builds on the kit's line naming ${bots} bare, got: ${kit}`);

    const written = {
      'a bots folder that moved': kit.replace(` --bots ${bots} `, ' --bots /somewhere/else '),
      'a bots folder with a space in it': kit.replace(` --bots ${bots} `, " --bots '/old place/bots' "),
      'a bots folder with a quote in it': kit.replace(` --bots ${bots} `, " --bots '/it'\\''s here/bots' "),
      'a bot since renamed': kit.replace(' --bot api-bot ', ' --bot old-name '),
      'a bot name that needed quoting': kit.replace(' --bot api-bot ', " --bot 'old name' "),
    };
    for (const [label, old] of Object.entries(written)) {
      assert.notEqual(old, kit, `the old line for ${label} should differ from today's`);
      const theirs = { type: 'command', command: 'echo mine' };
      const planted = {
        hooks: {
          SessionStart: [{ matcher: 'mine', hooks: [{ type: 'command', command: old, timeout: 10 }, theirs] }],
          SessionEnd: [{ hooks: [{ type: 'command', command: old, timeout: 10 }] }],
        },
      };
      await writeFile(file, `${JSON.stringify(planted, null, 2)}\n`);

      await up(box, 'api-bot');

      const held = await hooksIn(bots, 'api-bot', harness);
      const now = await readFile(file, 'utf8');
      assert.equal(eventsIn(held).SessionStart.length, 1, `${label}: one group, the one that was there, got:\n${now}`);
      assert.equal(eventsIn(held).SessionStart[0].matcher, 'mine', `${label}: and what the user set on it, got:\n${now}`);
      assert.deepEqual(
        commandsUnder(held, 'SessionStart').sort(),
        [kit, 'echo mine'].sort(),
        `${label}: the old line becomes today's, beside their hook, got:\n${now}`,
      );
      assert.equal('SessionEnd' in eventsIn(held), false, `${label}: and the old line under SessionEnd goes, got:\n${now}`);
    }
  });

  test(`a bots folder with a space in its path keeps one ${harness} entry of the kit's across runs`, async (t) => {
    // The kit's own line quotes that path, and is still the kit's the next time.
    const box = await createSandbox(t);
    assert.equal((await box.run(['init', '--bots', 'my bots', '--harness', 'claude'])).code, 0);
    const made = await box.run(['bot', 'create', '--bots', 'my bots', '--name', 'api-bot', '--harness', harness]);
    assert.equal(made.code, 0, made.stderr);
    const added = await box.run(['session', 'add', '--bots', 'my bots', '--bot', 'api-bot', '--name', 'daily']);
    assert.equal(added.code, 0, added.stderr);
    const bots = box.path('my bots');
    const file = hookFileOf(bots, 'api-bot', harness);

    const first = await box.run(['up', '--bots', 'my bots', '--bot', 'api-bot']);
    assert.equal(first.code, 0, first.stderr);
    const once = await readFile(file, 'utf8');
    const second = await box.run(['up', '--bots', 'my bots', '--bot', 'api-bot']);
    assert.equal(second.code, 0, second.stderr);
    const twice = await readFile(file, 'utf8');

    const kit = await kitHookOf(bots, 'api-bot', harness);
    assert.ok(kit.includes(`'${bots}'`), `the kit's line should carry the path quoted, got: ${kit}`);
    assert.deepEqual(JSON.parse(twice), JSON.parse(once), `a second run changes nothing:\n--- first ---\n${once}\n--- second ---\n${twice}`);
  });
}
