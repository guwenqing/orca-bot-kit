// No session of a fleet stops on Claude Code's "Teach auto mode about your
// environment?" form (#708, request teach-form-off, R1).
//
// The kit does it with one setting in each Claude Code bot's own project
// settings file, `<bot home>/.claude/settings.json`, the file it already
// writes its hook into:
//
//   "skillOverrides": { "auto-mode-setup": "off" }
//
// What is held here, each test named by the point of the brief it covers:
//
//   P1. When `obk up` writes the kit's hook into a Claude Code bot's
//       `.claude/settings.json`, the file then has
//       `skillOverrides["auto-mode-setup"] === "off"`. That holds for a bot on
//       Claude Code, for Bot Father as `init` seeds it, for a Claude Code
//       session of a bot on another harness, and for a temporary Claude Code
//       session (its hook comes from the same write).
//   P2. Everything else in the file stays as the user had it, other
//       `skillOverrides` entries of the user's included.
//   P3. A second `obk up` changes nothing in the file.
//   P4. A Codex-only bot or a Pi-only bot gets no such entry in any file. A
//       Codex bot's `.codex/hooks.json` gets no `skillOverrides`.
//   P5. Nothing is written to user-level settings (the sandbox's empty HOME,
//       `assertHomeUntouched`).
//   P6. The kit types no key into any tab for this, and does not answer the
//       form (R1: "MUST NOT send any key to the form", "MUST NOT answer the
//       form with Continue").
//   P7. A user value of "auto-mode-setup" in `.claude/settings.json` that is
//       not "off" becomes "off". The kit never writes the bot's
//       `.claude/settings.local.json`, where a user turns the command back on.
//
// The expected value is the literal R1 names. Every run is in the sandbox
// (helpers/cli.js), with its own HOME and a fake Orca; nothing here reaches the
// real Orca or a real harness.

import assert from 'node:assert/strict';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  assertCleanFailure,
  assertHomeUntouched,
  botHomeOf,
  createSandbox,
  hookFileOf,
  hooksIn,
  kitDirsOf,
  kitHooksIn,
  kitLaunchMark,
  sentInto,
  sessionIn,
  TAB_SHELL,
  tabsOfBot,
} from './helpers/cli.js';
import { fakePi } from './helpers/pi.js';
import { CLAUDE_TEACH_FORM_302 } from './helpers/screens.js';

/** The one entry R1 names, as the literal it names. */
const OFF = { 'auto-mode-setup': 'off' };

/** `obk <args>` that must work. */
async function ok(box, args, options) {
  const result = await box.run(args, options);
  assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return result;
}

/**
 * A bots folder seeded on `fatherHarness`, with `bot` on `harness` and the
 * sessions given: `[name, settings]` each. Not brought up.
 */
async function fleet(box, { bot = 'api-bot', harness = 'claude', sessions = [['daily']], fatherHarness = 'claude' } = {}) {
  await ok(box, ['init', '--bots', 'bots', '--harness', fatherHarness]);
  await ok(box, ['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness]);
  for (const [name, settings = []] of sessions) {
    await ok(box, ['session', 'add', '--bots', 'bots', '--bot', bot, '--name', name, ...settings]);
  }
  return box.path('bots');
}

/** Bring one bot up. */
const up = (box, bot = 'api-bot') => ok(box, ['up', '--bots', 'bots', '--bot', bot]);

/** The bot's `.claude/settings.json`, parsed, with the kit's own hook in it: the write R1 rides on. */
async function claudeSettingsWithHook(bots, bot = 'api-bot') {
  const held = await hooksIn(bots, bot, 'claude');
  assert.ok(held !== undefined, `${hookFileOf(bots, bot, 'claude')} should be there after up`);
  assert.equal(kitHooksIn(held).length, 1, `the premise: the kit wrote its hook there, got: ${JSON.stringify(held)}`);
  return held;
}

/** Write the user's own `.claude/settings.json` for a bot, before the kit touches it. */
async function theirClaudeSettings(bots, bot, theirs) {
  const file = hookFileOf(bots, bot, 'claude');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(theirs, null, 2)}\n`);
  return file;
}

/** Whether a path exists. */
const exists = (file) => access(file).then(() => true, () => false);

/** Every file under `dir` (none when it is not there), by its full path. */
async function filesUnder(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const found = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await filesUnder(abs));
    else if (entry.isFile()) found.push(abs);
  }
  return found;
}

/** The files of a bot (its home and the kit's folders for it) that name `auto-mode-setup` at all. */
async function filesNamingTheSkill(bots, bot) {
  const named = [];
  for (const dir of [botHomeOf(bots, bot), ...kitDirsOf(bots, bot)]) {
    for (const file of await filesUnder(dir)) {
      if ((await readFile(file, 'utf8')).includes('auto-mode-setup')) named.push(file);
    }
  }
  return named;
}

/** Whether a key named `name` sits anywhere in a parsed JSON value. */
function hasKeyAnywhere(value, name) {
  if (Array.isArray(value)) return value.some((one) => hasKeyAnywhere(one, name));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).some(([key, held]) => key === name || hasKeyAnywhere(held, name));
  }
  return false;
}

// ---------------------------------------------------------------- P1

test('P1 up writes skillOverrides auto-mode-setup "off" into a Claude Code bot\'s .claude/settings.json', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);

  await up(box);

  const held = await claudeSettingsWithHook(bots);
  assert.deepEqual(
    held.skillOverrides,
    OFF,
    `the file the kit writes its hook into should turn the Teach form off, got: ${JSON.stringify(held.skillOverrides)}`,
  );
});

test('P1 up gives Bot Father, seeded on Claude Code by init, the same setting', async (t) => {
  // Bot Father is a session of the fleet too, and the first one a user sees.
  const box = await createSandbox(t);
  await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);
  const bots = box.path('bots');

  await ok(box, ['up', '--bots', 'bots']);

  const held = await claudeSettingsWithHook(bots, 'bot-father');
  assert.deepEqual(held.skillOverrides, OFF, `got: ${JSON.stringify(held.skillOverrides)}`);
});

test('P1 P4 a Codex bot with a Claude Code session gets the setting in .claude/settings.json and none in .codex/hooks.json', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box, { harness: 'codex', sessions: [['daily'], ['review', ['--harness', 'claude']]] });

  await up(box);

  const claude = await claudeSettingsWithHook(bots);
  assert.deepEqual(claude.skillOverrides, OFF, `the Claude Code session's file, got: ${JSON.stringify(claude.skillOverrides)}`);
  const codex = await hooksIn(bots, 'api-bot', 'codex');
  assert.ok(codex !== undefined, `the premise: the kit wrote ${hookFileOf(bots, 'api-bot', 'codex')}`);
  assert.equal(
    hasKeyAnywhere(codex, 'skillOverrides'),
    false,
    `Codex has no such setting, so its hooks file gets none, got: ${JSON.stringify(codex)}`,
  );
});

test('P1 a temporary Claude Code session of a Codex bot gets the setting in the bot\'s .claude/settings.json', async (t) => {
  // The bot's own sessions are all on Codex, so before the temporary session
  // the bot has no Claude Code hook. `temp make` brings the Claude Code one in.
  const box = await createSandbox(t);
  const bots = await fleet(box, { harness: 'codex', sessions: [['planner']] });
  await up(box);
  const plannerTab = (await sessionIn(bots, 'api-bot', 'planner'))?.tab;
  const planner = (await tabsOfBot(box, bots, 'api-bot')).find((one) => one.tabId === plannerTab);
  assert.ok(planner, `the premise: planner has a tab, the book's ${plannerTab}`);
  assert.equal(await hooksIn(bots, 'api-bot', 'claude').then((held) => kitHooksIn(held ?? {}).length), 0, 'the premise: no Claude Code hook yet');
  const inTab = { ...box.env, ORCA_TERMINAL_HANDLE: planner.handle, ORCA_TAB_ID: planner.tabId, ...kitLaunchMark(box, planner) };

  await ok(box, ['temp', 'make', '--bots', 'bots', '--name', 'drafter', '--harness', 'claude', '--prompt', 'Write down what the PR changes.'], { env: inTab });

  const held = await claudeSettingsWithHook(bots);
  assert.deepEqual(held.skillOverrides, OFF, `got: ${JSON.stringify(held.skillOverrides)}`);
});

// ---------------------------------------------------------------- P2

for (const [label, theirOverrides, expected] of [
  ['no skillOverrides of theirs', undefined, OFF],
  ['skillOverrides entries of theirs', { 'some-skill': 'name-only', 'other-skill': 'on' }, { 'some-skill': 'name-only', 'other-skill': 'on', ...OFF }],
]) {
  test(`P2 up keeps everything the user had in .claude/settings.json, with ${label}`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    const theirs = {
      model: 'sonnet',
      env: { MY_KEY: 'mine' },
      permissions: { allow: ['Bash(git status:*)'] },
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo before' }] }] },
      ...(theirOverrides === undefined ? {} : { skillOverrides: theirOverrides }),
    };
    await theirClaudeSettings(bots, 'api-bot', theirs);

    await up(box);

    const now = await claudeSettingsWithHook(bots);
    assert.deepEqual(now.skillOverrides, expected, `their entries and the kit's one, got: ${JSON.stringify(now.skillOverrides)}`);
    assert.equal(now.model, theirs.model, 'a setting of theirs stays');
    assert.deepEqual(now.env, theirs.env, 'and their env');
    assert.deepEqual(now.hooks.PreToolUse, theirs.hooks.PreToolUse, 'and their hook on another event');
    assert.deepEqual(
      now.permissions.allow.slice(0, theirs.permissions.allow.length),
      theirs.permissions.allow,
      'and their own allow entries, first and in their order',
    );
  });
}

// ---------------------------------------------------------------- P3

test('P3 a second up leaves .claude/settings.json byte for byte as the first left it, the setting in it once', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const file = hookFileOf(bots, 'api-bot', 'claude');

  await up(box);
  const first = await readFile(file, 'utf8');
  assert.deepEqual(JSON.parse(first).skillOverrides, OFF, `the first up writes the setting, got: ${JSON.stringify(JSON.parse(first).skillOverrides)}`);
  await up(box);
  const second = await readFile(file, 'utf8');

  assert.equal(second, first, `a run with nothing to do changes nothing:\n--- first ---\n${first}\n--- second ---\n${second}`);
  assert.equal(second.split('auto-mode-setup').length - 1, 1, `the entry is there once, got:\n${second}`);
});

test('P3 a second up keeps a skillOverrides entry the user added after the first', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const file = hookFileOf(bots, 'api-bot', 'claude');
  await up(box);
  const held = JSON.parse(await readFile(file, 'utf8'));
  held.skillOverrides = { ...(held.skillOverrides ?? {}), 'some-skill': 'name-only' };
  await writeFile(file, `${JSON.stringify(held, null, 2)}\n`);

  await up(box);

  assert.deepEqual(
    (await hooksIn(bots, 'api-bot', 'claude')).skillOverrides,
    { ...OFF, 'some-skill': 'name-only' },
    `got: ${JSON.stringify((await hooksIn(bots, 'api-bot', 'claude')).skillOverrides)}`,
  );
});

// ---------------------------------------------------------------- P4
//
// These two pass before the change too: no code wrote the entry anywhere. They
// stand as a description of what holds today, and as a guard on a change that
// writes it for every bot. The kit's hook (Codex) or the bot's tab (Pi) is the
// positive half: the up did run for that bot.

test('P4 a Codex-only bot gets no auto-mode-setup entry in any file, and no skillOverrides in .codex/hooks.json', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box, { harness: 'codex', fatherHarness: 'codex' });

  await up(box);

  const codex = await hooksIn(bots, 'api-bot', 'codex');
  assert.equal(kitHooksIn(codex).length, 1, `the premise: up wrote the kit's Codex hook, got: ${JSON.stringify(codex)}`);
  assert.equal(hasKeyAnywhere(codex, 'skillOverrides'), false, `got: ${JSON.stringify(codex)}`);
  assert.deepEqual(await filesNamingTheSkill(bots, 'api-bot'), [], 'no file of the Codex bot names the skill');
});

test('P4 a Pi-only bot gets no auto-mode-setup entry in any file', async (t) => {
  const box = await createSandbox(t);
  await fakePi(box);
  const bots = await fleet(box, { bot: 'pi-bot', harness: 'pi' });

  await up(box, 'pi-bot');

  assert.equal((await tabsOfBot(box, bots, 'pi-bot')).length, 1, 'the premise: up started the Pi session');
  assert.deepEqual(await filesNamingTheSkill(bots, 'pi-bot'), [], 'no file of the Pi bot names the skill');
});

// ---------------------------------------------------------------- P5

test('P5 the setting goes into the bot\'s own file and nothing reaches user-level settings', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);

  await ok(box, ['up', '--bots', 'bots']);

  assert.deepEqual((await claudeSettingsWithHook(bots)).skillOverrides, OFF, 'the bot\'s own file has it');
  await assertHomeUntouched(box);
});

// ---------------------------------------------------------------- P6

test('P6 up types no key for this: each Claude Code tab gets its launch line alone, and the setting is in the file', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box, { sessions: [['daily'], ['review']] });

  await up(box);

  const tabs = await tabsOfBot(box, bots, 'api-bot');
  assert.equal(tabs.length, 2, `the premise: one tab for each session, got: ${JSON.stringify(tabs)}`);
  for (const tab of tabs) {
    const sends = sentInto(tab);
    assert.equal(sends.length, 1, `one send into ${tab.title}, the launch line, and no key after it, got: ${JSON.stringify(sends)}`);
    assert.ok(sends[0].text.includes(TAB_SHELL), `that send is the launch line, got: ${JSON.stringify(sends[0])}`);
    assert.ok(!/auto-mode/.test(sends[0].text), `and it carries nothing of the setting, got: ${sends[0].text}`);
  }
  assert.deepEqual((await claudeSettingsWithHook(bots)).skillOverrides, OFF, 'the setting does it, in the file');
});

test('P6 a second up types nothing into a tab that shows the Teach form', async (t) => {
  // R1: the kit MUST NOT send any key to the form, and MUST NOT answer it with
  // Continue. This passes before the change too: up already left a live tab
  // alone. It is kept as a guard on a change that answers the form on up.
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await up(box);
  const tab = (await sessionIn(bots, 'api-bot', 'daily')).tab;
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((one) => (one.tabId === tab ? { ...one, screen: CLAUDE_TEACH_FORM_302 } : one)),
  });
  const before = Object.fromEntries((await box.orca.terminals()).map((one) => [one.tabId, sentInto(one).length]));

  await up(box);

  const after = Object.fromEntries((await box.orca.terminals()).map((one) => [one.tabId, sentInto(one).length]));
  assert.deepEqual(after, before, 'nothing typed into any tab, the one with the form included');
});

// ---------------------------------------------------------------- P7

for (const theirValue of ['on', 'name-only']) {
  test(`P7 a user's "auto-mode-setup": "${theirValue}" in .claude/settings.json becomes "off", and their other entries stay`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await theirClaudeSettings(bots, 'api-bot', { skillOverrides: { 'auto-mode-setup': theirValue, 'some-skill': 'name-only' } });

    await up(box);

    assert.deepEqual(
      (await claudeSettingsWithHook(bots)).skillOverrides,
      { 'auto-mode-setup': 'off', 'some-skill': 'name-only' },
    );
  });
}

test('P7 up leaves the user\'s .claude/settings.local.json byte for byte as they wrote it', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const local = path.join(botHomeOf(bots, 'api-bot'), '.claude', 'settings.local.json');
  const theirs = `${JSON.stringify({ skillOverrides: { 'auto-mode-setup': 'on' } }, null, 2)}\n`;
  await mkdir(path.dirname(local), { recursive: true });
  await writeFile(local, theirs);

  await up(box);

  assert.deepEqual((await claudeSettingsWithHook(bots)).skillOverrides, OFF, 'the kit\'s entry goes in the project file');
  assert.equal(await readFile(local, 'utf8'), theirs, 'and the local file, which wins over it, is the user\'s');
});

test('P7 up writes no .claude/settings.local.json where the user has none', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const local = path.join(botHomeOf(bots, 'api-bot'), '.claude', 'settings.local.json');

  await up(box);

  assert.deepEqual((await claudeSettingsWithHook(bots)).skillOverrides, OFF, 'the kit\'s entry goes in the project file');
  assert.equal(await exists(local), false, `and no ${local} appears`);
});

// ---------------------------------------------------------------- P2, a skillOverrides the kit cannot write into
//
// The coordinator's decision (#708): a `skillOverrides` that is not a mapping
// leaves the kit nowhere to put its entry without writing over what the user
// wrote. So `obk up` refuses, as it refuses a `hooks` entry that is not a
// mapping of events (session-hooks.test.js): its output names the file and
// says that `skillOverrides` is not a mapping, and the file stays byte for
// byte as the user wrote it. Like that refusal, it opens no tab for the bot.

test('P2 up refuses a .claude/settings.json whose skillOverrides is not a mapping, and leaves the file as it was', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const file = hookFileOf(bots, 'api-bot', 'claude');
  await mkdir(path.dirname(file), { recursive: true });

  for (const [label, contents] of [
    ['a string', '{\n  "skillOverrides": "auto-mode-setup=on"\n}\n'],
    ['a list', '{\n  "skillOverrides": ["auto-mode-setup"]\n}\n'],
    ['null', '{\n  "skillOverrides": null\n}\n'],
  ]) {
    await writeFile(file, contents);
    const open = await box.orca.terminals();

    const result = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

    assertCleanFailure(result);
    assert.ok(result.stderr.includes(file), `${label}: the message should name the file, got: ${result.stderr}`);
    assert.match(result.stderr, /skillOverrides/, `${label}: and name skillOverrides, got: ${result.stderr}`);
    assert.match(result.stderr, /not a mapping/i, `${label}: and say it is not a mapping, got: ${result.stderr}`);
    assert.equal(await readFile(file, 'utf8'), contents, `${label}: what the user wrote is untouched`);
    assert.deepEqual(await box.orca.terminals(), open, `${label}: and no tab opens for the bot it refused`);
  }
});

test('P2 up refuses a skillOverrides of null beside an old kit hook, and takes nothing out of the file first', async (t) => {
  // The review of #708: the kit takes its removed hooks out of a bot's files on
  // up (#555, #613), and the `Stop` `session mail` entry is one of them. A file
  // that holds that entry and a `skillOverrides` that is not a mapping is
  // refused as the one above is, and the refusal writes nothing: the old entry
  // stays too, byte for byte, until the user puts the file right.
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await up(box);
  const home = botHomeOf(bots, 'api-bot');
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.worktreePath !== home) });
  const file = hookFileOf(bots, 'api-bot', 'claude');
  const held = JSON.parse(await readFile(file, 'utf8'));
  const record = kitHooksIn(held)[0];
  assert.ok(typeof record === 'string' && record.includes(' session record '), `the premise: the kit's record hook, got: ${record}`);
  // The kit's old entry, as the kit before #555 wrote it beside its record hook.
  const old = record.replace(' session record ', ' session mail ');
  held.hooks.Stop = [...(held.hooks.Stop ?? []), { hooks: [{ type: 'command', command: old, timeout: 30 }] }];
  held.skillOverrides = null;
  const contents = `${JSON.stringify(held, null, 2)}\n`;
  await writeFile(file, contents);
  const open = await box.orca.terminals();

  const result = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes(file), `the message should name the file, got: ${result.stderr}`);
  assert.match(result.stderr, /skillOverrides/, `and name skillOverrides, got: ${result.stderr}`);
  assert.match(result.stderr, /not a mapping/i, `and say it is not a mapping, got: ${result.stderr}`);
  assert.equal(await readFile(file, 'utf8'), contents, 'the file is byte for byte as written, the old entry in it');
  assert.deepEqual(await box.orca.terminals(), open, 'and no tab opens for the bot it refused');
});
