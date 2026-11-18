// The kit keeps some Claude Code tools and built-in skills out of every Claude
// Code session of a fleet (#767; request claude-session-trim, R1 and R2, the
// tool and skill part).
//
// Where the cut is written: the bot's own `<bot home>/.claude/settings.json`,
// the file `obk up` already writes the kit's hook into.
//
//   - a tool cut is the tool's exact name in `permissions.deny`;
//   - a skill cut is `"off"` under `skillOverrides[<skill name>]`.
//
// A name that starts with an upper-case letter, or with `mcp__`, is a tool.
// Any other name without the prefix `text:` is a skill. A `text:` name is a
// unit of the main text, which this slice does not cut yet.
//
// What is held here, each test named by the point of the brief it covers:
//
//   P1.  The default cuts: the tools Artifact, ArtifactComments, ArtifactData,
//        DesignSync; the skills artifact-design, artifact-diagramming,
//        artifact-capabilities, update-config, fewer-permission-prompts, init,
//        keybindings-help, plugin-authoring.
//   P2.  Where the cut goes, how a name is classed, and no write to
//        `.claude/settings.local.json` or to user-level settings.
//   P3.  `claude_cut` in defaults.yaml (every bot) and in bot.yaml (one bot);
//        `claude_keep` in bot.yaml wins over every cut list. Both are known
//        keys of bot.yaml. A list that is not a list of non-empty strings is
//        refused with a message that names the file, and no cut is written.
//   P4.  Workflow and workflow-authoring go together, cut or kept.
//   P5.  Every other entry of the file stays; a second up changes nothing.
//   P6.  A keep takes the cut entry out, and leaves the rest.
//   P7.  Only Claude Code sessions get cuts.
//   P8.  `text:` names: accepted, never written to the settings file. Health
//        names a name the recipe does not know (#769), and no longer says
//        that the kit does not cut them. A name of a part that Claude Code adds
//        by itself (the recipe's `back` list, #784) gets a finding that the
//        list does not change it, and not the finding of an unknown name.
//   P9.  Health findings: a missing cut (a), a kept name still cut (b), names
//        against the fleet's Claude Code records (c1, c2), and none for a bot
//        with no cut list trouble (d).
//   P10. A bot that keeps Artifact has none of the Artifact group's cuts, and
//        DesignSync is still denied (#781).
//   P11. The Artifact group (#781): the tools Artifact, ArtifactComments and
//        ArtifactData and the skills artifact-design and artifact-capabilities
//        go together, as the Workflow pair does: a cut or a keep of one of
//        them applies to all five. DesignSync and artifact-diagramming are not
//        in the group, and the Workflow pair still goes on its own. Health
//        reads a keep of one of the five as a keep of all five.
//
// No text of Claude Code is in this file. The fake transcripts hold only the
// record field names that health reads and lists of names. Every run is in the
// sandbox (helpers/cli.js), with its own HOME and a fake Orca.

import assert from 'node:assert/strict';
import { access, appendFile, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { parse, stringify } from 'yaml';

import {
  assertHomeUntouched,
  botHomeOf,
  createSandbox,
  hookFileOf,
  hooksIn,
  kitDirsOf,
  kitHooksIn,
  repoRoot,
  tabsOfBot,
} from './helpers/cli.js';
import { fakePi } from './helpers/pi.js';
import { botYamlOf } from './helpers/skills.js';

// ---------------------------------------------------------------- the names

/** The default tool cuts, as R1 names them. */
const DEFAULT_TOOLS = ['Artifact', 'ArtifactComments', 'ArtifactData', 'DesignSync'];

/** The default skill cuts, as R1 names them. */
const DEFAULT_SKILLS = [
  'artifact-design', 'artifact-diagramming', 'artifact-capabilities', 'update-config',
  'fewer-permission-prompts', 'init', 'keybindings-help', 'plugin-authoring',
];

/** The Artifact group's tools and skills (#781): a cut or a keep of one applies to all five. */
const GROUP_TOOLS = ['Artifact', 'ArtifactComments', 'ArtifactData'];
const GROUP_SKILLS = ['artifact-design', 'artifact-capabilities'];
const GROUP = [...GROUP_TOOLS, ...GROUP_SKILLS];

/** The entry the kit already writes for the Teach form (#708). */
const TEACH = { 'auto-mode-setup': 'off' };

/** `skillOverrides` as the kit writes it for a bot with the defaults only. */
const DEFAULT_OVERRIDES = { ...TEACH, ...Object.fromEntries(DEFAULT_SKILLS.map((name) => [name, 'off'])) };

/** The health text of c1 and c2, as the brief gives it, and the P8 text that #769 took out. */
const NOT_SEEN = 'not seen in any Claude Code record of this fleet';
const notNewest = (bot) => `not in the newest Claude Code record of ${bot}`;
const START_AGAIN = 'start the session again';
const NO_TEXT_CUTS = 'the kit does not cut text: units yet';

// ---------------------------------------------------------------- the fleet

/** `obk <args>` that must work. */
async function ok(box, args, options) {
  const result = await box.run(args, options);
  assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return result;
}

/**
 * A bots folder seeded on `fatherHarness`, with each bot of `bots` on its
 * harness and its sessions: `[name, settings]` each. Not brought up.
 */
async function fleet(box, { bots: made = [{ bot: 'api-bot' }], fatherHarness = 'claude' } = {}) {
  await ok(box, ['init', '--bots', 'bots', '--harness', fatherHarness]);
  for (const { bot, harness = 'claude', sessions = [['daily']] } of made) {
    await ok(box, ['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness]);
    for (const [name, settings = []] of sessions) {
      await ok(box, ['session', 'add', '--bots', 'bots', '--bot', bot, '--name', name, ...settings]);
    }
  }
  return box.path('bots');
}

/** Bring one bot up. */
const up = (box, bot = 'api-bot') => ok(box, ['up', '--bots', 'bots', '--bot', bot]);

/** Set keys of a bot's `bot.yaml`, the user's file, as a user edits it. */
async function editBotYaml(bots, bot, keys) {
  const file = botYamlOf(bots, bot);
  const doc = parse(await readFile(file, 'utf8')) ?? {};
  await writeFile(file, stringify({ ...doc, ...keys }));
}

/** The fleet's `defaults.yaml`. */
const defaultsOf = (bots) => path.join(bots, 'defaults.yaml');

/** Add `claude_cut` to `defaults.yaml`, below what init wrote, its comments kept. */
async function defaultsCut(bots, value) {
  await appendFile(defaultsOf(bots), `claude_cut: ${JSON.stringify(value)}\n`);
}

/** The bot's `.claude/settings.json`, parsed, with the kit's hook in it: the premise that up wrote it. */
async function settingsOf(bots, bot = 'api-bot') {
  const held = await hooksIn(bots, bot, 'claude');
  assert.ok(held !== undefined, `${hookFileOf(bots, bot, 'claude')} should be there after up`);
  assert.equal(kitHooksIn(held).length, 1, `the premise: the kit wrote its hook there, got: ${JSON.stringify(held)}`);
  return held;
}

/** `permissions.deny` of a parsed settings file, or [] when it has none. */
const denyOf = (held) => held?.permissions?.deny ?? [];

/** Assert that a parsed settings file cuts none of the Artifact group: no deny entry, and no "off". */
function assertGroupKept(held, label) {
  for (const name of GROUP_TOOLS) {
    assert.ok(!denyOf(held).includes(name), `${label}: the tool ${name} stays, got: ${show(held.permissions)}`);
  }
  for (const name of GROUP_SKILLS) {
    assert.notEqual(held.skillOverrides?.[name], 'off', `${label}: the skill ${name} stays, got: ${show(held.skillOverrides)}`);
  }
}

/** Assert that a parsed settings file cuts all of the Artifact group. */
function assertGroupCut(held, label) {
  for (const name of GROUP_TOOLS) {
    assert.ok(denyOf(held).includes(name), `${label}: the tool ${name} is denied, got: ${show(held.permissions)}`);
  }
  for (const name of GROUP_SKILLS) {
    assert.equal(held.skillOverrides?.[name], 'off', `${label}: the skill ${name} is off, got: ${show(held.skillOverrides)}`);
  }
}

/** Assert that DesignSync and artifact-diagramming, which are not in the group, are still cut. */
function assertOutsideGroupCut(held, label) {
  assert.ok(denyOf(held).includes('DesignSync'), `${label}: DesignSync is not in the group and is still denied, got: ${show(held.permissions)}`);
  assert.equal(held.skillOverrides?.['artifact-diagramming'], 'off', `${label}: artifact-diagramming is not in the group and is still off, got: ${show(held.skillOverrides)}`);
}

/** Write the user's own `.claude/settings.json` for a bot, before the kit touches it. */
async function theirSettings(bots, bot, theirs) {
  const file = hookFileOf(bots, bot, 'claude');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(theirs, null, 2)}\n`);
  return file;
}

/** Change the bot's `.claude/settings.json` by hand, as a user does after up. */
async function editSettings(bots, bot, change) {
  const file = hookFileOf(bots, bot, 'claude');
  const held = JSON.parse(await readFile(file, 'utf8'));
  change(held);
  await writeFile(file, `${JSON.stringify(held, null, 2)}\n`);
  return file;
}

const sorted = (list) => [...list].sort();
const show = (value) => JSON.stringify(value, null, 2);

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

/** The files of a bot (its home and the kit's folders for it) whose text holds any of `needles`. */
async function filesNaming(bots, bot, needles) {
  const named = [];
  for (const dir of [botHomeOf(bots, bot), ...kitDirsOf(bots, bot)]) {
    for (const file of await filesUnder(dir)) {
      const text = await readFile(file, 'utf8');
      if (needles.some((needle) => text.includes(needle))) named.push(file);
    }
  }
  return named;
}

// ---------------------------------------------------------------- the records

/**
 * A fake Claude Code record (a transcript) of a bot, where Claude Code keeps
 * it: `$HOME/.claude/projects/<slug of the bot home>/<id>.jsonl`. The slug is
 * the bot home with every character outside A-Z, a-z and 0-9 turned into `-`.
 *
 * The first line carries the start time. The lines after it carry the names:
 * `skills` in a skill listing, `deferred` in a deferred tools delta, and
 * `shaped` in a request shape. Field names and name lists only.
 *
 * `pad` puts that many plain filler lines between the first line and the
 * names, so the names sit deep in the record: a name anywhere in a record
 * counts, not only in its first lines (the review of #767).
 */
async function claudeRecord(box, bots, bot, { id, at, skills = [], deferred = [], shaped = [], pad = 0 }) {
  const home = await realpath(botHomeOf(bots, bot));
  const file = path.join(box.home, '.claude', 'projects', home.replaceAll(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  const lines = [{ type: 'user', timestamp: at.toISOString(), message: { content: 'x' } }];
  for (let line = 0; line < pad; line += 1) lines.push({ type: 'user', timestamp: at.toISOString(), message: { content: 'x' } });
  if (skills.length > 0) lines.push({ type: 'attachment', attachment: { type: 'skill_listing', names: skills } });
  if (deferred.length > 0) lines.push({ type: 'attachment', attachment: { type: 'deferred_tools_delta', addedNames: deferred } });
  if (shaped.length > 0) lines.push({ type: 'api-request-shape', shape: { tools: shaped.map((name) => ({ name })) } });
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, lines.map((line) => `${JSON.stringify(line)}\n`).join(''));
  return file;
}

const HOUR = 60 * 60 * 1000;
const hoursAgo = (hours) => new Date(Date.now() - hours * HOUR);

// ---------------------------------------------------------------- health

/** `obk health --json`: its findings. */
async function findings(box) {
  const result = await box.run(['health', '--bots', 'bots', '--json']);
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`health --json should print JSON, got (${error.message}):\n${result.stdout}${result.stderr}`);
  }
  assert.ok(Array.isArray(answer.found), `the answer should carry a list of findings, got: ${result.stdout}`);
  return answer.found;
}

const escape = (text) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether `text` names `name` as a word of its own: `Artifact` is not named by
 * `ArtifactData`, and `init` is not named by `initial`.
 */
const names = (text, name) => new RegExp(`(^|[^A-Za-z0-9_-])${escape(name)}($|[^A-Za-z0-9_-])`).test(text);

/** The findings whose sentence names `name` and holds every one of `phrases`. */
const naming = (found, name, ...phrases) => found.filter((one) => typeof one.says === 'string'
  && names(one.says, name) && phrases.every((phrase) => one.says.includes(phrase)));

/** The findings whose sentence holds `phrase`. */
const saying = (found, phrase) => found.filter((one) => typeof one.says === 'string' && one.says.includes(phrase));

/** Whether a finding points at `file`: as where it is, or in what it says. */
const pointsAt = (one, file) => one.where === file || (typeof one.says === 'string' && one.says.includes(file));

// Every test makes its own sandbox and runs the CLI several times, so four run
// at once: one after the other, the file takes about five minutes.
describe('claude cuts', { concurrency: 4 }, () => {

  // ================================================================ P1, P2

  test('P1 P2 up writes the default tool cuts into permissions.deny and the default skill cuts as "off" in skillOverrides', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);

    await up(box);

    const held = await settingsOf(bots);
    assert.deepEqual(sorted(denyOf(held)), sorted(DEFAULT_TOOLS), `permissions.deny holds the four default tools and nothing else, got: ${show(held.permissions)}`);
    assert.deepEqual(held.skillOverrides, DEFAULT_OVERRIDES, `skillOverrides holds the eight default skills "off" beside the Teach entry, got: ${show(held.skillOverrides)}`);
  });

  test('P1 Bot Father, seeded on Claude Code by init, gets the default cuts too', async (t) => {
    const box = await createSandbox(t);
    await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);
    const bots = box.path('bots');

    await ok(box, ['up', '--bots', 'bots']);

    const held = await settingsOf(bots, 'bot-father');
    assert.deepEqual(sorted(denyOf(held)), sorted(DEFAULT_TOOLS), `got: ${show(held.permissions)}`);
    assert.deepEqual(held.skillOverrides, DEFAULT_OVERRIDES, `got: ${show(held.skillOverrides)}`);
  });

  test('P2 a name is classed by its first letter: upper case or mcp__ is a tool, any other name is a skill', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await editBotYaml(bots, 'api-bot', { claude_cut: ['FakeTool', 'mcp__fake__thing', 'house-notes', 'fake-skill-a'] });

    await up(box);

    const held = await settingsOf(bots);
    assert.deepEqual(
      sorted(denyOf(held)),
      sorted([...DEFAULT_TOOLS, 'FakeTool', 'mcp__fake__thing']),
      `the two tools are denied by their exact names, and no skill is, got: ${show(held.permissions)}`,
    );
    assert.deepEqual(
      held.skillOverrides,
      { ...DEFAULT_OVERRIDES, 'house-notes': 'off', 'fake-skill-a': 'off' },
      `the two skills are "off", and no tool is in skillOverrides, got: ${show(held.skillOverrides)}`,
    );
  });

  test('P2 up writes no .claude/settings.local.json and nothing to user-level settings', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await editBotYaml(bots, 'api-bot', { claude_cut: ['FakeTool', 'house-notes'], claude_keep: ['Artifact'] });
    const local = path.join(botHomeOf(bots, 'api-bot'), '.claude', 'settings.local.json');

    await ok(box, ['up', '--bots', 'bots']);

    assert.ok(denyOf(await settingsOf(bots)).includes('FakeTool'), 'the premise: the cuts went into the project file');
    assert.equal(await exists(local), false, `no ${local} appears`);
    await assertHomeUntouched(box);
  });

  test('P2 up leaves the user\'s .claude/settings.local.json byte for byte as they wrote it', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    const local = path.join(botHomeOf(bots, 'api-bot'), '.claude', 'settings.local.json');
    const theirs = `${JSON.stringify({ permissions: { deny: ['Bash(rm:*)'] }, skillOverrides: { 'update-config': 'on' } }, null, 2)}\n`;
    await mkdir(path.dirname(local), { recursive: true });
    await writeFile(local, theirs);

    await up(box);

    assert.ok(denyOf(await settingsOf(bots)).includes('Artifact'), 'the premise: the cuts went into the project file');
    assert.equal(await readFile(local, 'utf8'), theirs);
  });

  // ================================================================ P3

  test('P3 claude_cut in defaults.yaml cuts for every bot', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box, { bots: [{ bot: 'api-bot' }, { bot: 'web-bot' }] });
    await defaultsCut(bots, ['FakeTool', 'house-notes']);

    await up(box, 'api-bot');
    await up(box, 'web-bot');

    for (const bot of ['api-bot', 'web-bot']) {
      const held = await settingsOf(bots, bot);
      assert.ok(denyOf(held).includes('FakeTool'), `${bot}: the tool from defaults.yaml is denied, got: ${show(held.permissions)}`);
      assert.equal(held.skillOverrides?.['house-notes'], 'off', `${bot}: the skill from defaults.yaml is off, got: ${show(held.skillOverrides)}`);
      assert.ok(DEFAULT_TOOLS.every((name) => denyOf(held).includes(name)), `${bot}: and the default cuts are still there, got: ${show(held.permissions)}`);
    }
  });

  test('P3 claude_cut in a bot.yaml cuts for that bot only', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box, { bots: [{ bot: 'api-bot' }, { bot: 'web-bot' }] });
    await editBotYaml(bots, 'api-bot', { claude_cut: ['FakeTool', 'house-notes'] });

    await up(box, 'api-bot');
    await up(box, 'web-bot');

    const api = await settingsOf(bots, 'api-bot');
    assert.ok(denyOf(api).includes('FakeTool'), `api-bot: got: ${show(api.permissions)}`);
    assert.equal(api.skillOverrides?.['house-notes'], 'off', `api-bot: got: ${show(api.skillOverrides)}`);
    const web = await settingsOf(bots, 'web-bot');
    assert.deepEqual(sorted(denyOf(web)), sorted(DEFAULT_TOOLS), `web-bot gets the defaults only, got: ${show(web.permissions)}`);
    assert.deepEqual(web.skillOverrides, DEFAULT_OVERRIDES, `web-bot gets the defaults only, got: ${show(web.skillOverrides)}`);
  });

  test('P3 claude_keep in a bot.yaml wins over the default cuts, defaults.yaml and the bot\'s own claude_cut', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await defaultsCut(bots, ['FakeTool', 'house-notes']);
    await editBotYaml(bots, 'api-bot', {
      claude_cut: ['OtherTool', 'fake-skill-a', 'Kept'],
      claude_keep: ['DesignSync', 'init', 'FakeTool', 'house-notes', 'Kept', 'fake-skill-a'],
    });

    await up(box);

    const held = await settingsOf(bots);
    assert.deepEqual(
      sorted(denyOf(held)),
      sorted(['Artifact', 'ArtifactComments', 'ArtifactData', 'OtherTool']),
      `a kept tool is denied by no list, got: ${show(held.permissions)}`,
    );
    const off = Object.keys(held.skillOverrides ?? {}).filter((name) => held.skillOverrides[name] === 'off');
    assert.deepEqual(
      sorted(off),
      sorted(['auto-mode-setup', ...DEFAULT_SKILLS.filter((name) => name !== 'init')]),
      `a kept skill is off by no list, got: ${show(held.skillOverrides)}`,
    );
  });

  test('P3 health does not call claude_cut or claude_keep unknown keys of bot.yaml', async (t) => {
    // Only default names and a keep with no record, so no other finding of this
    // slice names either key.
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await editBotYaml(bots, 'api-bot', { claude_cut: ['Artifact'], claude_keep: ['init'] });
    await ok(box, ['up', '--bots', 'bots']);

    const found = await findings(box);

    const said = found.filter((one) => typeof one.says === 'string' && (one.says.includes('claude_cut') || one.says.includes('claude_keep')));
    assert.deepEqual(said, [], `no finding names the two keys, got: ${show(said)}`);
  });

  // A list that is not a list of non-empty strings: refused with a message that
  // names the file and the key, by up (a non-zero exit) or by health (a
  // finding), as the kit refuses a bad `allow` or `rules` list. And no cut is
  // written for the bot: not the bad list's names, and not the defaults either,
  // since a broken keep list may hold a name the user wants kept.

  /**
   * The words of the kit's unknown-key finding (src/bot.js, unknownKeys). That
   * finding names the file and the key too, so it must not pass for a refusal
   * of a bad list: the two keys are known keys (P3).
   */
  const UNKNOWN_KEY = 'a key the kit does not know';

  const BAD_LISTS = [
    ['a line of text', 'house-notes'],
    ['a list holding a number', ['house-notes', 42]],
    ['a list holding an empty string', ['house-notes', '']],
    ['a list holding a mapping', ['house-notes', { name: 'FakeTool' }]],
    ['a mapping', { name: 'house-notes' }],
  ];

  /** Assert that a bad list was refused, naming `file` and `key`, and that no cut reached the bot's settings. */
  async function assertBadListRefused(box, bots, { file, key, label }) {
    const result = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);
    const said = result.stdout + result.stderr;
    assert.ok(!/^\s+at /m.test(said), `${label}: a message, not a crash, got:\n${said}`);
    const byUp = result.code !== 0 && said.includes(file) && said.includes(key);
    let byHealth = false;
    let found = [];
    if (!byUp) {
      found = await findings(box);
      byHealth = found.some((one) => pointsAt(one, file) && typeof one.says === 'string' && one.says.includes(key)
        && !one.says.includes(UNKNOWN_KEY));
    }
    assert.ok(
      byUp || byHealth,
      `${label}: up should refuse naming ${file} and ${key}, or health should name them; up said (exit ${result.code}):\n${said}\nhealth found: ${show(found)}`,
    );
    const held = await hooksIn(bots, 'api-bot', 'claude');
    const cutTools = denyOf(held).filter((name) => [...DEFAULT_TOOLS, 'FakeTool'].includes(name));
    assert.deepEqual(cutTools, [], `${label}: no tool cut is written for the bot, got: ${show(held)}`);
    const cutSkills = Object.keys(held?.skillOverrides ?? {}).filter((name) => [...DEFAULT_SKILLS, 'house-notes'].includes(name));
    assert.deepEqual(cutSkills, [], `${label}: no skill cut is written for the bot, got: ${show(held)}`);
  }

  for (const key of ['claude_cut', 'claude_keep']) {
    test(`P3 a ${key} in bot.yaml that is not a list of non-empty strings is refused naming the bot.yaml, and no cut is written`, async (t) => {
      for (const [label, value] of BAD_LISTS) {
        const box = await createSandbox(t);
        const bots = await fleet(box);
        await editBotYaml(bots, 'api-bot', { [key]: value });

        await assertBadListRefused(box, bots, { file: botYamlOf(bots, 'api-bot'), key, label });
      }
    });
  }

  test('P3 a claude_cut in defaults.yaml that is not a list of non-empty strings is refused naming defaults.yaml, and no cut is written', async (t) => {
    for (const [label, value] of BAD_LISTS) {
      const box = await createSandbox(t);
      const bots = await fleet(box);
      await defaultsCut(bots, value);

      await assertBadListRefused(box, bots, { file: defaultsOf(bots), key: 'claude_cut', label });
    }
  });

  // ================================================================ P4

  test('P4 a cut of the Workflow tool in bot.yaml cuts the workflow-authoring skill too', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await editBotYaml(bots, 'api-bot', { claude_cut: ['Workflow'] });

    await up(box);

    const held = await settingsOf(bots);
    assert.ok(denyOf(held).includes('Workflow'), `got: ${show(held.permissions)}`);
    assert.equal(held.skillOverrides?.['workflow-authoring'], 'off', `got: ${show(held.skillOverrides)}`);
  });

  test('P4 a cut of the workflow-authoring skill in defaults.yaml cuts the Workflow tool too', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await defaultsCut(bots, ['workflow-authoring']);

    await up(box);

    const held = await settingsOf(bots);
    assert.equal(held.skillOverrides?.['workflow-authoring'], 'off', `got: ${show(held.skillOverrides)}`);
    assert.ok(denyOf(held).includes('Workflow'), `got: ${show(held.permissions)}`);
  });

  for (const [kept, cut] of [['workflow-authoring', 'Workflow'], ['Workflow', 'workflow-authoring']]) {
    test(`P4 a keep of ${kept} keeps both, where a list cuts ${cut}`, async (t) => {
      const box = await createSandbox(t);
      const bots = await fleet(box);
      await defaultsCut(bots, [cut]);
      await editBotYaml(bots, 'api-bot', { claude_keep: [kept] });

      await up(box);

      const held = await settingsOf(bots);
      assert.ok(!denyOf(held).includes('Workflow'), `the tool stays, got: ${show(held.permissions)}`);
      assert.ok(!('workflow-authoring' in (held.skillOverrides ?? {})), `the skill stays, got: ${show(held.skillOverrides)}`);
      assert.ok(denyOf(held).includes('Artifact'), `the premise: the cuts were written, got: ${show(held.permissions)}`);
    });
  }

  // ================================================================ P5

  test('P5 up keeps every other entry of .claude/settings.json, and a second up changes nothing', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await editBotYaml(bots, 'api-bot', { claude_cut: ['FakeTool', 'house-notes'], claude_keep: ['init'] });
    const theirs = {
      model: 'sonnet',
      myOwnKey: { nested: [1, 'two'] },
      permissions: { allow: ['Bash(git status:*)'], deny: ['Bash(rm -rf:*)', 'WebFetch'] },
      skillOverrides: { 'some-skill': 'name-only', 'other-skill': 'on' },
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo before' }] }] },
    };
    const file = await theirSettings(bots, 'api-bot', theirs);

    await up(box);

    const held = await settingsOf(bots);
    assert.equal(held.model, theirs.model, 'a setting of theirs stays');
    assert.deepEqual(held.myOwnKey, theirs.myOwnKey, 'a key the kit does not know stays');
    assert.deepEqual(held.hooks.PreToolUse, theirs.hooks.PreToolUse, 'their hook stays');
    assert.ok(theirs.permissions.allow.every((rule) => held.permissions.allow.includes(rule)), `their allow entries stay, got: ${show(held.permissions)}`);
    assert.deepEqual(
      sorted(denyOf(held)),
      sorted([...theirs.permissions.deny, ...DEFAULT_TOOLS, 'FakeTool']),
      `their deny entries stay beside the kit's cuts, got: ${show(held.permissions)}`,
    );
    assert.deepEqual(
      held.skillOverrides,
      {
        ...theirs.skillOverrides,
        ...TEACH,
        ...Object.fromEntries(DEFAULT_SKILLS.filter((name) => name !== 'init').map((name) => [name, 'off'])),
        'house-notes': 'off',
      },
      `their skillOverrides stay beside the kit's, got: ${show(held.skillOverrides)}`,
    );

    const first = await readFile(file, 'utf8');
    await up(box);
    const second = await readFile(file, 'utf8');
    assert.equal(second, first, `a second up changes nothing:\n--- first ---\n${first}\n--- second ---\n${second}`);
  });

  test('P5 a second up on a bot with the defaults only leaves the file byte for byte, each cut in it once', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    const file = hookFileOf(bots, 'api-bot', 'claude');

    await up(box);
    const first = await readFile(file, 'utf8');
    assert.deepEqual(sorted(denyOf(JSON.parse(first))), sorted(DEFAULT_TOOLS), `the premise: the first up wrote the cuts, got:\n${first}`);
    await up(box);
    const second = await readFile(file, 'utf8');

    assert.equal(second, first, `--- first ---\n${first}\n--- second ---\n${second}`);
    assert.equal(denyOf(JSON.parse(second)).filter((name) => name === 'Artifact').length, 1, `Artifact is denied once, got:\n${second}`);
  });

  // ================================================================ P6

  test('P6 P11 a keep takes out an Artifact deny entry and an "update-config": "off" that the file held, and leaves the rest', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await editBotYaml(bots, 'api-bot', { claude_keep: ['Artifact', 'update-config', 'init'] });
    await theirSettings(bots, 'api-bot', {
      permissions: { deny: ['Bash(rm:*)', 'Artifact'] },
      skillOverrides: { 'update-config': 'off', init: 'name-only', 'other-skill': 'on' },
    });

    await up(box);

    const held = await settingsOf(bots);
    // A keep of Artifact keeps the whole Artifact group (#781), so of the
    // default tools only DesignSync is denied.
    assert.deepEqual(
      sorted(denyOf(held)),
      sorted(['Bash(rm:*)', 'DesignSync']),
      `the Artifact entry goes, the group's other tools are not denied, the user's other entry stays, got: ${show(held.permissions)}`,
    );
    assertGroupKept(held, 'a keep of Artifact');
    assert.equal(held.skillOverrides['artifact-diagramming'], 'off', `artifact-diagramming is not in the group, got: ${show(held.skillOverrides)}`);
    assert.ok(!('update-config' in held.skillOverrides), `the "off" of a kept skill goes, got: ${show(held.skillOverrides)}`);
    assert.equal(held.skillOverrides.init, 'name-only', `a kept skill's user value that is not "off" stays, got: ${show(held.skillOverrides)}`);
    assert.equal(held.skillOverrides['other-skill'], 'on', `another entry of theirs stays, got: ${show(held.skillOverrides)}`);
    assert.equal(held.skillOverrides['auto-mode-setup'], 'off', `the Teach entry stays, got: ${show(held.skillOverrides)}`);
  });

  test('P6 P10 P11 a keep added after an up takes the cut the kit wrote back out on the next up', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await up(box);
    const before = await settingsOf(bots);
    assert.ok(denyOf(before).includes('Artifact') && before.skillOverrides['update-config'] === 'off', `the premise: the first up cut both, got: ${show(before)}`);

    await editBotYaml(bots, 'api-bot', { claude_keep: ['Artifact', 'update-config'] });
    await up(box);

    // A keep of Artifact keeps the whole Artifact group (#781): the cuts that
    // the first up wrote for all five go.
    const held = await settingsOf(bots);
    assert.deepEqual(sorted(denyOf(held)), ['DesignSync'], `got: ${show(held.permissions)}`);
    assert.deepEqual(
      held.skillOverrides,
      { ...TEACH, ...Object.fromEntries(DEFAULT_SKILLS.filter((name) => name !== 'update-config' && !GROUP_SKILLS.includes(name)).map((name) => [name, 'off'])) },
      `got: ${show(held.skillOverrides)}`,
    );
  });

  // ================================================================ P7

  test('P7 a Codex-only bot gets no deny entry and no cut skillOverrides in any file', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box, { bots: [{ bot: 'api-bot', harness: 'codex' }], fatherHarness: 'codex' });
    await defaultsCut(bots, ['FakeTool', 'house-notes']);

    await up(box);

    const codex = await hooksIn(bots, 'api-bot', 'codex');
    assert.equal(kitHooksIn(codex).length, 1, `the premise: up wrote the kit's Codex hook, got: ${show(codex)}`);
    assert.deepEqual(denyOf(await hooksIn(bots, 'api-bot', 'claude')), [], 'no Claude Code deny entries');
    assert.deepEqual(
      await filesNaming(bots, 'api-bot', ['DesignSync', 'keybindings-help', 'artifact-diagramming', 'FakeTool', 'house-notes']),
      [],
      'no file of the Codex bot names a cut',
    );
  });

  test('P7 a Pi-only bot gets no deny entry and no cut skillOverrides in any file', async (t) => {
    const box = await createSandbox(t);
    await fakePi(box);
    const bots = await fleet(box, { bots: [{ bot: 'pi-bot', harness: 'pi' }] });
    await defaultsCut(bots, ['FakeTool', 'house-notes']);

    await up(box, 'pi-bot');

    assert.equal((await tabsOfBot(box, bots, 'pi-bot')).length, 1, 'the premise: up started the Pi session');
    assert.deepEqual(denyOf(await hooksIn(bots, 'pi-bot', 'claude')), [], 'no Claude Code deny entries');
    assert.deepEqual(
      await filesNaming(bots, 'pi-bot', ['DesignSync', 'keybindings-help', 'artifact-diagramming', 'FakeTool', 'house-notes']),
      [],
      'no file of the Pi bot names a cut',
    );
  });

  test('P7 a Codex bot with one Claude Code session gets the cuts in .claude/settings.json, and none in .codex/hooks.json', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box, { bots: [{ bot: 'api-bot', harness: 'codex', sessions: [['daily'], ['review', ['--harness', 'claude']]] }] });

    await up(box);

    const held = await settingsOf(bots);
    assert.deepEqual(sorted(denyOf(held)), sorted(DEFAULT_TOOLS), `got: ${show(held.permissions)}`);
    assert.deepEqual(held.skillOverrides, DEFAULT_OVERRIDES, `got: ${show(held.skillOverrides)}`);
    const codex = await readFile(hookFileOf(bots, 'api-bot', 'codex'), 'utf8');
    assert.ok(!codex.includes('DesignSync') && !codex.includes('keybindings-help'), `the Codex hooks file holds no cut, got:\n${codex}`);
  });

  // ================================================================ P8

  test('P8 text: names are accepted in both lists and never written to the settings file; health names only the ones the recipe does not know', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await defaultsCut(bots, ['text:product-channels', 'text:no-such-unit']);
    await editBotYaml(bots, 'api-bot', { claude_cut: ['text:fast-mode', 'text:not-a-unit'], claude_keep: ['text:ultrareview', 'text:never-heard-of'] });

    await up(box);
    // A record of the bot that holds none of the names, so c2 could apply.
    await claudeRecord(box, bots, 'api-bot', { id: 'rec-1', at: hoursAgo(1), skills: ['some-other-skill'], shaped: ['SomeOtherTool'] });

    const text = await readFile(hookFileOf(bots, 'api-bot', 'claude'), 'utf8');
    assert.ok(!text.includes('text:'), `no text: name is written to the settings file, got:\n${text}`);
    assert.ok(denyOf(JSON.parse(text)).includes('Artifact'), `the premise: the other cuts were written, got:\n${text}`);

    const found = await findings(box);
    assert.deepEqual(saying(found, NO_TEXT_CUTS), [], `the kit cuts text: units now (#769), got: ${show(found)}`);
    for (const name of ['text:no-such-unit', 'text:not-a-unit', 'text:never-heard-of']) {
      assert.ok(naming(found, name, 'recipe').length >= 1, `health names ${name}, which the recipe does not know, got: ${show(found)}`);
    }
    for (const name of ['text:fast-mode', 'text:product-channels', 'text:ultrareview']) {
      assert.deepEqual(naming(found, name, 'recipe'), [], `${name} is a unit of the recipe, got: ${show(found)}`);
      assert.deepEqual(naming(found, name, NOT_SEEN), [], `${name} gets no finding about the records of the fleet, got: ${show(found)}`);
      assert.deepEqual(naming(found, name, notNewest('api-bot')), [], `${name} gets no finding about the newest record, got: ${show(found)}`);
    }
  });

  /** The names of the parts that Claude Code adds by itself, from the shipped recipe (#784). */
  async function backNames() {
    const recipe = JSON.parse(await readFile(path.join(repoRoot, 'src', 'claude-text-recipe.json'), 'utf8'));
    assert.ok(Array.isArray(recipe.back) && recipe.back.length > 0, `the premise: the shipped recipe names the parts that come back (#784), got the lists: ${show(Object.keys(recipe))}`);
    return recipe.back.map((part) => part.name);
  }

  for (const list of ['claude_cut', 'claude_keep']) {
    test(`P8 a ${list} that names a part Claude Code adds by itself: health says it comes back by itself, so the list does not change it, and not that the recipe does not know it`, async (t) => {
      const box = await createSandbox(t);
      const bots = await fleet(box);
      const [name] = await backNames();
      await editBotYaml(bots, 'api-bot', { [list]: [name] });

      await up(box);
      const found = await findings(box);

      assert.deepEqual(naming(found, name, 'does not know'), [], `the recipe knows ${name}, got: ${show(found)}`);
      assert.ok(naming(found, name, 'by itself').length >= 1, `health says ${name} comes back by itself, got: ${show(found)}`);
    });
  }

  // ================================================================ P9 a, b

  test('P9a a default tool cut deleted from the file gives a finding naming it, the file and obk up', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await up(box);
    assert.ok(denyOf(await settingsOf(bots)).includes('Artifact'), 'the premise: up denied Artifact');
    const file = await editSettings(bots, 'api-bot', (held) => {
      held.permissions.deny = held.permissions.deny.filter((name) => name !== 'Artifact');
    });

    const found = await findings(box);

    const said = naming(found, 'Artifact', 'obk up').filter((one) => pointsAt(one, file));
    assert.equal(said.length, 1, `one finding names Artifact, ${file} and obk up, got: ${show(found)}`);
  });

  test('P9a a skill cut deleted from the file gives a finding naming it, the file and obk up', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await editBotYaml(bots, 'api-bot', { claude_cut: ['house-notes'] });
    await up(box);
    const was = (await settingsOf(bots)).skillOverrides ?? {};
    assert.ok(was['keybindings-help'] === 'off' && was['house-notes'] === 'off', `the premise: up cut both skills, got: ${show(was)}`);
    const file = await editSettings(bots, 'api-bot', (held) => {
      delete held.skillOverrides['keybindings-help'];
      held.skillOverrides['house-notes'] = 'on';
    });

    const found = await findings(box);

    assert.equal(naming(found, 'keybindings-help', 'obk up').filter((one) => pointsAt(one, file)).length, 1, `a default skill, got: ${show(found)}`);
    assert.equal(naming(found, 'house-notes', 'obk up').filter((one) => pointsAt(one, file)).length, 1, `a skill of the bot's own list, got: ${show(found)}`);
  });

  test('P9b a kept name that the file still cuts gives a finding naming it and the file', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await editBotYaml(bots, 'api-bot', { claude_keep: ['Artifact', 'update-config'] });
    await up(box);
    // DesignSync, not ArtifactData: a keep of Artifact keeps ArtifactData too now (#781).
    assert.ok(denyOf(await settingsOf(bots)).includes('DesignSync'), 'the premise: up wrote the cuts it was not told to keep');
    const file = await editSettings(bots, 'api-bot', (held) => {
      held.permissions.deny.push('Artifact');
      held.skillOverrides['update-config'] = 'off';
    });

    const found = await findings(box);

    assert.ok(naming(found, 'Artifact').some((one) => pointsAt(one, file)), `a kept tool still denied, got: ${show(found)}`);
    assert.ok(naming(found, 'update-config').some((one) => pointsAt(one, file)), `a kept skill still off, got: ${show(found)}`);
  });

  test('P9b P11 a name of the Artifact group that the file still cuts is named, where the bot keeps another name of the group', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await editBotYaml(bots, 'api-bot', { claude_keep: ['Artifact'] });
    await up(box);
    // The file cuts the two, by hand or as the kit wrote it before the group.
    const file = await editSettings(bots, 'api-bot', (held) => {
      held.permissions ??= {};
      held.permissions.deny ??= [];
      if (!held.permissions.deny.includes('ArtifactData')) held.permissions.deny.push('ArtifactData');
      held.skillOverrides ??= {};
      held.skillOverrides['artifact-capabilities'] = 'off';
    });

    const found = await findings(box);

    assert.ok(naming(found, 'ArtifactData').some((one) => pointsAt(one, file)), `a tool kept with Artifact is still denied, got: ${show(found)}`);
    assert.ok(naming(found, 'artifact-capabilities').some((one) => pointsAt(one, file)), `a skill kept with Artifact is still off, got: ${show(found)}`);
  });

  // ================================================================ P9 c1

  test('P9c1 a user cut that no Claude Code record of the fleet holds is named; a default cut is not', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await editBotYaml(bots, 'api-bot', { claude_cut: ['fake-skill-a', 'FakeTool', 'mcp__fake__thing', 'DesignSync'] });
    await ok(box, ['up', '--bots', 'bots']);

    const found = await findings(box);

    for (const name of ['fake-skill-a', 'FakeTool', 'mcp__fake__thing']) {
      assert.ok(naming(found, name, NOT_SEEN).length >= 1, `${name} is named as not seen, got: ${show(found)}`);
    }
    for (const name of [...DEFAULT_TOOLS, ...DEFAULT_SKILLS]) {
      assert.deepEqual(naming(found, name, NOT_SEEN), [], `the default cut ${name} is never named as not seen, got: ${show(found)}`);
    }
  });

  test('P9c1 a user cut that a record of another bot of the fleet holds is not named', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box, { bots: [{ bot: 'api-bot' }, { bot: 'web-bot' }] });
    await editBotYaml(bots, 'api-bot', { claude_cut: ['fake-skill-a', 'FakeTool', 'mcp__fake__thing', 'fake-skill-b'] });
    await ok(box, ['up', '--bots', 'bots']);
    await claudeRecord(box, bots, 'web-bot', {
      id: 'rec-web',
      at: hoursAgo(1),
      skills: ['fake-skill-a'],
      shaped: ['FakeTool'],
      deferred: ['mcp__fake__thing'],
    });

    const found = await findings(box);

    for (const name of ['fake-skill-a', 'FakeTool', 'mcp__fake__thing']) {
      assert.deepEqual(naming(found, name, NOT_SEEN), [], `${name} is in web-bot's record, got: ${show(found)}`);
    }
    assert.ok(naming(found, 'fake-skill-b', NOT_SEEN).length >= 1, `the premise: a name in no record is still named, got: ${show(found)}`);
  });

  test('P9c1 a claude_cut of defaults.yaml is named when no record holds it, and not when a record holds it', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await defaultsCut(bots, ['other-skill-b', 'held-skill-c', 'HeldTool']);
    await ok(box, ['up', '--bots', 'bots']);
    await claudeRecord(box, bots, 'api-bot', { id: 'rec-api', at: hoursAgo(1), skills: ['held-skill-c'], deferred: ['HeldTool'] });

    const found = await findings(box);

    assert.ok(naming(found, 'other-skill-b', NOT_SEEN).length >= 1, `got: ${show(found)}`);
    assert.deepEqual(naming(found, 'held-skill-c', NOT_SEEN), [], `got: ${show(found)}`);
    assert.deepEqual(naming(found, 'HeldTool', NOT_SEEN), [], `got: ${show(found)}`);
  });

  // ================================================================ P9 c2

  test('P9c2 a kept tool that only an older record holds is named, and start the session again is said when that record is older than the file', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    // DesignSync is in no group, so its finding is the only one this keep gives.
    await editBotYaml(bots, 'api-bot', { claude_keep: ['DesignSync'] });
    await up(box);
    await claudeRecord(box, bots, 'api-bot', { id: 'rec-old', at: hoursAgo(2), deferred: ['DesignSync'], shaped: ['DesignSync'] });
    await claudeRecord(box, bots, 'api-bot', { id: 'rec-new', at: hoursAgo(1), deferred: ['SomeOtherTool'], shaped: ['SomeOtherTool'] });

    const found = await findings(box);

    const said = naming(found, 'DesignSync', notNewest('api-bot'));
    assert.equal(said.length, 1, `one finding names DesignSync as not in the newest record, got: ${show(found)}`);
    assert.ok(said[0].says.includes(START_AGAIN), `the newest record started before up wrote the file, got: ${show(said[0])}`);
  });

  test('P9c2 P11 a keep of Artifact that only an older record holds names each of the five as not in the newest record, with start the session again', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await editBotYaml(bots, 'api-bot', { claude_keep: ['Artifact'] });
    await up(box);
    await claudeRecord(box, bots, 'api-bot', { id: 'rec-old', at: hoursAgo(2), skills: GROUP_SKILLS, deferred: ['ArtifactComments', 'ArtifactData'], shaped: ['Artifact'] });
    await claudeRecord(box, bots, 'api-bot', { id: 'rec-new', at: hoursAgo(1), skills: ['some-other-skill'], shaped: ['SomeOtherTool'] });

    const found = await findings(box);

    // How many findings carry the five is the kit's choice: one each, or one for all.
    for (const name of GROUP) {
      const said = naming(found, name, notNewest('api-bot'));
      assert.ok(said.length >= 1, `${name} is kept with Artifact and is not in the newest record, got: ${show(found)}`);
      assert.ok(said.every((one) => one.says.includes(START_AGAIN)), `the newest record started before up wrote the file, got: ${show(said)}`);
    }
    assert.deepEqual(naming(found, 'DesignSync', notNewest('api-bot')), [], `DesignSync is not in the group, and the bot does not keep it, got: ${show(found)}`);
    assert.deepEqual(naming(found, 'artifact-diagramming', notNewest('api-bot')), [], `artifact-diagramming is not in the group, and the bot does not keep it, got: ${show(found)}`);
  });

  test('P9c2 a kept skill missing from a newest record that started after the file was written is named, without start the session again', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await editBotYaml(bots, 'api-bot', { claude_keep: ['update-config'] });
    await up(box);
    await claudeRecord(box, bots, 'api-bot', { id: 'rec-old', at: hoursAgo(2), skills: ['update-config'] });
    // Started after up wrote the file: the time is taken after up finished.
    await claudeRecord(box, bots, 'api-bot', { id: 'rec-new', at: new Date(Date.now() + 1000), skills: ['some-other-skill'] });

    const found = await findings(box);

    const said = naming(found, 'update-config', notNewest('api-bot'));
    assert.equal(said.length, 1, `got: ${show(found)}`);
    assert.ok(!said[0].says.includes(START_AGAIN), `the newest record started after the file was written, got: ${show(said[0])}`);
  });

  test('P9c2 a kept name that the newest record holds is not named, though an older record lacks it', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await editBotYaml(bots, 'api-bot', { claude_keep: ['Artifact', 'update-config'] });
    await up(box);
    await claudeRecord(box, bots, 'api-bot', { id: 'rec-old', at: hoursAgo(2), skills: ['some-other-skill'], shaped: ['SomeOtherTool'] });
    // The newest record holds the whole Artifact group, which the keep of Artifact keeps (#781).
    await claudeRecord(box, bots, 'api-bot', {
      id: 'rec-new',
      at: hoursAgo(1),
      skills: ['update-config', ...GROUP_SKILLS],
      deferred: ['ArtifactComments', 'ArtifactData'],
      shaped: ['Artifact'],
    });

    const found = await findings(box);

    for (const name of [...GROUP, 'update-config']) {
      assert.deepEqual(naming(found, name, notNewest('api-bot')), [], `${name}: got: ${show(found)}`);
    }
  });

  for (const kept of ['artifact-design', 'ArtifactComments']) {
    test(`P9c2 P11 a keep of ${kept} whose newest record holds all five of the Artifact group gets no finding that one is not in the newest record`, async (t) => {
      const box = await createSandbox(t);
      const bots = await fleet(box);
      await editBotYaml(bots, 'api-bot', { claude_keep: [kept] });
      await up(box);
      await claudeRecord(box, bots, 'api-bot', { id: 'rec-new', at: hoursAgo(1), skills: GROUP_SKILLS, deferred: ['ArtifactComments', 'ArtifactData'], shaped: ['Artifact'] });

      const found = await findings(box);

      assert.deepEqual(saying(found, 'not in the newest Claude Code record'), [], `the newest record holds every kept name, got: ${show(found)}`);
    });
  }

  for (const [kept, record] of [['Artifact', { shaped: ['Artifact'] }], ['artifact-design', { skills: ['artifact-design'] }]]) {
    test(`P9c2 P11 a keep of ${kept} whose newest record holds only ${kept} names the other four of the Artifact group as not in the newest record`, async (t) => {
      const box = await createSandbox(t);
      const bots = await fleet(box);
      await editBotYaml(bots, 'api-bot', { claude_keep: [kept] });
      await up(box);
      await claudeRecord(box, bots, 'api-bot', { id: 'rec-new', at: hoursAgo(1), ...record });

      const found = await findings(box);

      for (const name of GROUP.filter((one) => one !== kept)) {
        assert.ok(naming(found, name, notNewest('api-bot')).length >= 1, `${name} is kept with ${kept} and the newest record lacks it, got: ${show(found)}`);
      }
      for (const name of ['DesignSync', 'artifact-diagramming']) {
        assert.deepEqual(naming(found, name, notNewest('api-bot')), [], `${name} is not in the group, and the bot does not keep it, got: ${show(found)}`);
      }
    });
  }

  test('P9c2 a kept tool named in the newest record\'s deferred tools is not named', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await editBotYaml(bots, 'api-bot', { claude_keep: ['ArtifactData'] });
    await up(box);
    // The rest of the Artifact group, which the keep of ArtifactData keeps too (#781), is in the record as well.
    await claudeRecord(box, bots, 'api-bot', { id: 'rec-new', at: hoursAgo(1), deferred: ['ArtifactData'], skills: GROUP_SKILLS, shaped: ['Artifact', 'ArtifactComments'] });

    const found = await findings(box);

    assert.deepEqual(naming(found, 'ArtifactData', notNewest('api-bot')), [], `got: ${show(found)}`);
  });

  test('P9c2 a bot with no record at all gets no finding for its kept names', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await editBotYaml(bots, 'api-bot', { claude_keep: ['Artifact', 'update-config', 'house-notes'] });
    await up(box);

    const found = await findings(box);

    // The whole Artifact group is kept by the keep of Artifact (#781).
    for (const name of [...GROUP, 'update-config', 'house-notes']) {
      assert.deepEqual(naming(found, name, notNewest('api-bot')), [], `got: ${show(found)}`);
    }
  });

  // ================================================================ P9 c1, c2: names deep in a record
  //
  // The review of #767 found that health read only the first 400 lines of a
  // record. A name anywhere in a record counts. These records put 450 filler
  // lines before the names.

  const DEEP = 450;

  test('P9c1 a user cut that a record of another bot holds only after line 400 is not named', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box, { bots: [{ bot: 'api-bot' }, { bot: 'web-bot' }] });
    await editBotYaml(bots, 'api-bot', { claude_cut: ['late-skill', 'LateTool', 'LateShapedTool', 'never-held-skill'] });
    await ok(box, ['up', '--bots', 'bots']);
    const file = await claudeRecord(box, bots, 'web-bot', {
      id: 'rec-web',
      at: hoursAgo(1),
      pad: DEEP,
      skills: ['late-skill'],
      deferred: ['LateTool'],
      shaped: ['LateShapedTool'],
    });
    const lines = (await readFile(file, 'utf8')).split('\n');
    assert.ok(lines.findIndex((line) => line.includes('late-skill')) >= 400, 'the premise: the names are after line 400');

    const found = await findings(box);

    assert.deepEqual(naming(found, 'late-skill', NOT_SEEN), [], `a skill in a skill listing deep in the record, got: ${show(found)}`);
    assert.deepEqual(naming(found, 'LateTool', NOT_SEEN), [], `a tool in a deferred tools delta deep in the record, got: ${show(found)}`);
    assert.deepEqual(naming(found, 'LateShapedTool', NOT_SEEN), [], `a tool in a request shape deep in the record, got: ${show(found)}`);
    assert.ok(naming(found, 'never-held-skill', NOT_SEEN).length >= 1, `the premise: a name in no record is still named, got: ${show(found)}`);
  });

  test('P9c2 a kept name that the newest record holds only after line 400 is not named', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await editBotYaml(bots, 'api-bot', { claude_keep: ['Artifact', 'ArtifactData', 'update-config'] });
    await up(box);
    await claudeRecord(box, bots, 'api-bot', { id: 'rec-old', at: hoursAgo(2), skills: ['some-other-skill'], shaped: ['SomeOtherTool'] });
    // The rest of the Artifact group, which the keep of Artifact keeps too (#781), is deep in the record as well.
    await claudeRecord(box, bots, 'api-bot', {
      id: 'rec-new',
      at: hoursAgo(1),
      pad: DEEP,
      skills: ['update-config', ...GROUP_SKILLS],
      deferred: ['ArtifactData', 'ArtifactComments'],
      shaped: ['Artifact'],
    });

    const found = await findings(box);

    assert.deepEqual(naming(found, 'Artifact', notNewest('api-bot')), [], `a tool in a request shape deep in the newest record, got: ${show(found)}`);
    assert.deepEqual(naming(found, 'ArtifactData', notNewest('api-bot')), [], `a tool in a deferred tools delta deep in the newest record, got: ${show(found)}`);
    assert.deepEqual(naming(found, 'update-config', notNewest('api-bot')), [], `a skill in a skill listing deep in the newest record, got: ${show(found)}`);
  });

  // ================================================================ P9 d

  /** Every finding of this slice: one that names a default cut, or holds a phrase of c1, c2 or P8. */
  function cutFindings(found) {
    // `init` is left out of the scan: "obk init" is a word of other findings.
    const scanned = [...DEFAULT_TOOLS, ...DEFAULT_SKILLS.filter((name) => name !== 'init')];
    return found.filter((one) => typeof one.says === 'string' && (
      scanned.some((name) => names(one.says, name))
      || [NOT_SEEN, 'not in the newest Claude Code record', NO_TEXT_CUTS].some((phrase) => one.says.includes(phrase))
    ));
  }

  test('P9d a fleet with the defaults only, as up wrote them, has none of these findings', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await ok(box, ['up', '--bots', 'bots']);
    assert.deepEqual(sorted(denyOf(await settingsOf(bots))), sorted(DEFAULT_TOOLS), 'the premise: up wrote the cuts');

    const found = await findings(box);

    assert.deepEqual(cutFindings(found), [], `got: ${show(found)}`);
  });

  test('P9d a fleet with the defaults only and a record that holds none of their names has none of these findings', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await ok(box, ['up', '--bots', 'bots']);
    await claudeRecord(box, bots, 'api-bot', { id: 'rec-1', at: hoursAgo(1), skills: ['some-other-skill'], shaped: ['SomeOtherTool'] });

    const found = await findings(box);

    assert.deepEqual(cutFindings(found), [], `got: ${show(found)}`);
  });

  // ================================================================ P10

  test('P10 P11 a bot that keeps Artifact has none of the Artifact group\'s cuts, and DesignSync is still denied', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await editBotYaml(bots, 'api-bot', { claude_keep: ['Artifact'] });

    await up(box);

    const held = await settingsOf(bots);
    assert.deepEqual(denyOf(held), ['DesignSync'], `of the default tools only DesignSync is denied, got: ${show(held.permissions)}`);
    assertGroupKept(held, 'a keep of Artifact');
    assertOutsideGroupCut(held, 'a keep of Artifact');
  });

  // ================================================================ P11

  for (const kept of GROUP) {
    test(`P11 a keep of ${kept} alone keeps all five of the Artifact group, which the defaults cut, and nothing outside it`, async (t) => {
      const box = await createSandbox(t);
      const bots = await fleet(box);
      await editBotYaml(bots, 'api-bot', { claude_keep: [kept] });

      await up(box);

      const held = await settingsOf(bots);
      assertGroupKept(held, `a keep of ${kept}`);
      assertOutsideGroupCut(held, `a keep of ${kept}`);
      const off = Object.keys(held.skillOverrides ?? {}).filter((name) => held.skillOverrides[name] === 'off');
      assert.deepEqual(
        sorted(off),
        sorted(['auto-mode-setup', ...DEFAULT_SKILLS.filter((name) => !GROUP_SKILLS.includes(name))]),
        `every default skill outside the group is still off, got: ${show(held.skillOverrides)}`,
      );
    });
  }

  test('P11 with nothing kept, a user cut of one name of the Artifact group leaves all five cut', async (t) => {
    // The defaults cut all five already, so this holds today too. It guards a
    // cut of one name from taking the others out of the file.
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await defaultsCut(bots, ['ArtifactData']);
    await editBotYaml(bots, 'api-bot', { claude_cut: ['artifact-capabilities'] });

    await up(box);

    const held = await settingsOf(bots);
    assertGroupCut(held, 'a user cut of ArtifactData and artifact-capabilities');
    assertOutsideGroupCut(held, 'a user cut of ArtifactData and artifact-capabilities');
  });

  for (const [where, cut, kept] of [['defaults.yaml', 'artifact-design', 'ArtifactComments'], ['bot.yaml', 'ArtifactData', 'artifact-capabilities']]) {
    test(`P11 a keep of ${kept} wins over a cut of ${cut} in ${where}: all five of the Artifact group stay`, async (t) => {
      const box = await createSandbox(t);
      const bots = await fleet(box);
      if (where === 'defaults.yaml') {
        await defaultsCut(bots, [cut]);
        await editBotYaml(bots, 'api-bot', { claude_keep: [kept] });
      } else {
        await editBotYaml(bots, 'api-bot', { claude_cut: [cut], claude_keep: [kept] });
      }

      await up(box);

      const held = await settingsOf(bots);
      assertGroupKept(held, `a keep of ${kept} beside a cut of ${cut}`);
      assertOutsideGroupCut(held, `a keep of ${kept} beside a cut of ${cut}`);
    });
  }

  for (const kept of ['DesignSync', 'artifact-diagramming']) {
    test(`P11 a keep of ${kept}, which is not in the Artifact group, keeps it alone: all five of the group stay cut`, async (t) => {
      // This holds today too. It guards the group from growing past its five names.
      const box = await createSandbox(t);
      const bots = await fleet(box);
      await editBotYaml(bots, 'api-bot', { claude_keep: [kept] });

      await up(box);

      const held = await settingsOf(bots);
      assertGroupCut(held, `a keep of ${kept}`);
      assert.ok(!denyOf(held).includes(kept), `the kept ${kept} is not denied, got: ${show(held.permissions)}`);
      assert.notEqual(held.skillOverrides?.[kept], 'off', `the kept ${kept} is not off, got: ${show(held.skillOverrides)}`);
    });
  }

  test('P11 P4 the Workflow pair and the Artifact group go apart: a keep of one leaves the other cut', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box, { bots: [{ bot: 'api-bot' }, { bot: 'web-bot' }] });
    await defaultsCut(bots, ['Workflow']);
    await editBotYaml(bots, 'api-bot', { claude_keep: ['artifact-capabilities'] });
    await editBotYaml(bots, 'web-bot', { claude_keep: ['workflow-authoring'] });

    await up(box, 'api-bot');
    await up(box, 'web-bot');

    const api = await settingsOf(bots, 'api-bot');
    assertGroupKept(api, 'api-bot keeps artifact-capabilities');
    assert.ok(denyOf(api).includes('Workflow'), `api-bot: the Workflow tool is still cut, got: ${show(api.permissions)}`);
    assert.equal(api.skillOverrides?.['workflow-authoring'], 'off', `api-bot: the workflow-authoring skill is still cut, got: ${show(api.skillOverrides)}`);

    const web = await settingsOf(bots, 'web-bot');
    assert.ok(!denyOf(web).includes('Workflow'), `web-bot: the Workflow tool stays, got: ${show(web.permissions)}`);
    assert.ok(!('workflow-authoring' in (web.skillOverrides ?? {})), `web-bot: the workflow-authoring skill stays, got: ${show(web.skillOverrides)}`);
    assertGroupCut(web, 'web-bot keeps workflow-authoring');
  });

});
