// The launch line of a Claude Code session carries Remote Control (#755, R1),
// section 2 of the test brief.
//
// R1, as the owner signed it: "Every Claude Code session that the kit starts,
// temporary sessions included, MUST start with Claude Code's Remote Control on,
// unless the user set it off for that session. ... Codex and Pi sessions do not
// change." Its limit: off is off at a start and at a resume by the kit; it does
// not hold when the session's own extra arguments carry `--settings`, which
// replaces the kit's settings.
//
// The line, as decided on #755:
//
//   RL1  On (no remote_control, or remote_control: on): the word
//        `--remote-control` is the first word after `claude`, before the
//        approval flag. It takes an optional value of its own, so the word
//        after it is always a flag: the `-n` address is the remote title.
//   RL2  Off: no `--remote-control`, and the kit's `--settings` JSON carries
//        `"disableRemoteControl": true`.
//   RL3  The kit sends one `--settings` pair at most (ADR 0060). Its JSON holds
//        `autoMemoryDirectory`, the bot's own memory folder, unless a user
//        named a memory folder by hand (#752), and `disableRemoteControl: true`
//        when the session is off. With neither, no `--settings` at all. So an
//        on session's JSON is the memory folder alone, and an off session's
//        is the memory folder and the off key.
//   RL4  The session's own extra_args hold `--settings` or `--settings=…`: the
//        kit sends no `--settings` of its own, on or off. An on session still
//        gets `--remote-control`.
//   RL5  The session's own extra_args (hand-written in bot.yaml) hold
//        `--remote-control` or `--rc`, alone or with `=`: the kit leaves its
//        own `--remote-control` out. Off still sends `disableRemoteControl`.
//   RL6  A resume by the kit is a start like any other: on and off hold there.
//   RL7  Codex and Pi lines do not change at all.
//
// The setting is written into bot.yaml by hand here, as a user may, so the line
// is tested apart from the commands that write it
// (test/remote-control-setting.test.js).
//
// Each line is read at the level a user sees: the text the fake Orca received,
// run through a real shell against a fake `claude` that writes down its argv.

import assert from 'node:assert/strict';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import {
  bareLaunch,
  botHomeOf,
  conversationOnRecord,
  createSandbox,
  fakeProgram,
  memoryArgs,
  memoryFolderOf,
  recordSession,
  sessionIn,
  sh,
  tabsOfBot,
  tokenless,
  tokenlessWord,
  typedInto,
} from './helpers/cli.js';
import { botYamlOf } from './helpers/skills.js';

const BOT = 'api-bot';
const RC = '--remote-control';
const OFF_KEY = 'disableRemoteControl';
const MEMORY_KEY = 'autoMemoryDirectory';

// ------------------------------------------------------------- the fleet

/** A run of `obk` that must go through. */
async function ok(box, args, options) {
  const result = await box.run(args, options);
  assert.equal(result.code, 0, `obk ${args.join(' ')} should have gone through:\n${result.stdout}${result.stderr}`);
  return result;
}

/**
 * Bot Father and api-bot on `harness`, with one session `daily` added with
 * `flags`, and then `keys` written into its entry in bot.yaml by hand.
 */
async function fleetIn(box, { harness = 'claude', flags = [], keys = {} } = {}) {
  await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(box, ['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', harness]);
  await ok(box, ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily', ...flags]);
  const bots = box.path('bots');
  if (Object.keys(keys).length > 0) await handSet(bots, keys);
  return bots;
}

/** Set keys of daily's entry in api-bot's bot.yaml, as a user edits the file by hand. */
async function handSet(bots, keys) {
  const file = botYamlOf(bots, BOT);
  const doc = parse(await readFile(file, 'utf8'));
  doc.sessions = doc.sessions.map((one) => (one.name === 'daily' ? { ...one, ...keys } : one));
  await writeFile(file, stringify(doc));
  const entry = parse(await readFile(file, 'utf8')).sessions.find((one) => one.name === 'daily');
  for (const [key, value] of Object.entries(keys)) assert.deepEqual(entry[key], value, `the premise: bot.yaml holds ${key} as written`);
}

/** `obk up` for api-bot, and the one line typed into daily's tab. */
async function upLine(box, bots) {
  await ok(box, ['up', '--bots', 'bots', '--bot', BOT]);
  return lineOf(box, bots);
}

/** The launch line in daily's tab, as the book names it now. */
async function lineOf(box, bots) {
  const entry = await sessionIn(bots, BOT, 'daily');
  const terminal = (await tabsOfBot(box, bots, BOT)).find((one) => one.tabId === entry?.tab);
  assert.ok(terminal, `daily should have a tab, got: ${JSON.stringify(entry)}`);
  const typed = typedInto(terminal);
  assert.ok(typed.length >= 1, `a line was typed into daily's tab, got: ${JSON.stringify(typed)}`);
  return typed[0];
}

/** The arguments a real shell hands the fake harness when it runs `line`. */
async function argvOf(box, line, harness = 'claude') {
  const fake = await fakeProgram(box, harness, {});
  const from = (await fake.calls()).length;
  const ran = await sh(line, { cwd: box.cwd, env: box.env });
  assert.equal(ran.code, 0, `the line should run: ${line}\n${ran.stderr}`);
  const calls = (await fake.calls()).slice(from);
  assert.equal(calls.length, 1, `the line should start the harness once: ${line}`);
  return calls[0].args;
}

/** The harness's options: everything before the prompt separator. */
const flagsOf = (argv) => (argv.includes('--') ? argv.slice(0, argv.indexOf('--')) : argv);

const isSettingsWord = (word) => word === '--settings' || word.startsWith('--settings=');

/** How many times `word` is a whole word of the options. */
const countOf = (argv, word) => flagsOf(argv).filter((one) => one === word).length;

/**
 * The kit's `--settings` JSON: exactly one `--settings` word among the
 * options, a word of its own, and the next word a JSON object. Gives back the
 * object.
 */
function settingsJsonIn(argv) {
  const flags = flagsOf(argv);
  assert.deepEqual(flags.filter(isSettingsWord), ['--settings'], `one --settings, as a word of its own, got: ${JSON.stringify(argv)}`);
  const json = flags[flags.indexOf('--settings') + 1];
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    assert.fail(`the word after --settings should be JSON, got ${json}: ${error.message}`);
  }
  assert.ok(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed), `the JSON should be an object, got: ${json}`);
  return parsed;
}

/** The argv with the kit's `--settings` pair taken out. */
function withoutSettingsPair(argv) {
  const at = argv.indexOf('--settings');
  return at < 0 ? [...argv] : [...argv.slice(0, at), ...argv.slice(at + 2)];
}

/**
 * The words of a line with nothing set, after the pid, the CLI and `claude`,
 * and before the memory folder's `--settings` pair, which `kitJson` and
 * `memoryArgs` give.
 */
const bareArgv = (box) => {
  const line = bareLaunch(box, 'claude', BOT, 'daily', { memory: false });
  return line.slice(line.indexOf(' claude ') + ' claude '.length).split(' ');
};

/**
 * The kit's `--settings` JSON for daily (ADR 0060): the bot's own memory
 * folder, and for a session set off `"disableRemoteControl": true` as well.
 */
const kitJson = (bots, { off = false } = {}) => ({
  [MEMORY_KEY]: memoryFolderOf(bots, BOT),
  ...(off ? { [OFF_KEY]: true } : {}),
});

/** The argv with the token of the address written as `bareLaunch` writes it. */
const tokenlessArgv = (argv) => argv.map((word, at) => (argv[at - 1] === '-n' ? tokenlessWord(word) : word));

/** Neither the word nor the key anywhere on the line. */
function assertNoRemoteControl(line, what) {
  assert.ok(!/--remote-control\b/.test(line), `${what}: no --remote-control on the line, got: ${line}`);
  assert.ok(!line.includes(OFF_KEY), `${what}: no ${OFF_KEY} on the line, got: ${line}`);
}

// ------------------------------------------------------------- a memory folder (#722)

/**
 * An Orca Claude profile as Orca keeps one in the sandbox: its home has
 * `projects` as a link to `~/.claude/projects`, and `selected-host` names it
 * (test/memory-folder-flag.test.js, M1). Since #752 every launch has a memory
 * folder, profile or not; the cases under a profile show that it changes
 * nothing here.
 */
async function withProfile(box) {
  const data = path.join(box.home, 'Library', 'Application Support', 'orca');
  const home = path.join(data, 'claude-profiles', 'profile-one', 'home');
  const projects = path.join(box.home, '.claude', 'projects');
  await mkdir(home, { recursive: true });
  await mkdir(projects, { recursive: true });
  await symlink(projects, path.join(home, 'projects'));
  await writeFile(path.join(data, 'claude-profiles', 'selected-host'), home);
  return { home, projects };
}

// ------------------------------------------------------------- RL1 on

for (const [label, keys] of [['no remote_control: the kit\'s default', {}], ['remote_control: on', { remote_control: 'on' }]]) {
  for (const [approval, flag] of [['auto', '--permission-mode'], ['ask', '--permission-mode'], ['dangerously-skip', '--dangerously-skip-permissions']]) {
    test(`RL1 ${label}, approval ${approval}: --remote-control is the first word after claude, and the next word is the approval flag`, async (t) => {
      const box = await createSandbox(t);
      const bots = await fleetIn(box, { keys: { ...keys, approval } });

      const line = await upLine(box, bots);

      assert.match(line, / claude --remote-control -/, `--remote-control straight after claude, a flag after it, got: ${line}`);
      const argv = await argvOf(box, line);
      assert.equal(argv[0], RC, `the first argument is --remote-control, got: ${JSON.stringify(argv)}`);
      assert.equal(argv[1], flag, `the next one is the approval flag, so --remote-control takes no value, got: ${JSON.stringify(argv)}`);
      assert.ok(argv[1].startsWith('-'), 'the word after --remote-control is a flag');
      assert.equal(countOf(argv, RC), 1, `once, got: ${JSON.stringify(argv)}`);
      assert.deepEqual(settingsJsonIn(argv), kitJson(bots), `on, so the kit's --settings holds the memory folder alone, got: ${JSON.stringify(argv)}`);
    });
  }
}

test('RL1 a session with nothing set: the line is today\'s with --remote-control after claude, and nothing else moved', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);

  const line = await upLine(box, bots);

  assert.equal(tokenless(line), bareLaunch(box, 'claude', BOT, 'daily'));
  assert.deepEqual(bareArgv(box).slice(0, 4), [RC, '--permission-mode', 'auto', '-n'], 'the premise: bareLaunch spells the line with --remote-control after claude');
});

test('RL1 an on session with every setting and a prompt keeps every word where it was, with --remote-control first', async (t) => {
  const box = await createSandbox(t);
  const prompt = 'Read your AGENTS.md.';
  const bots = await fleetIn(box, { flags: ['--model', 'opus', '--context', '1m', '--effort', 'xhigh', '--extra-arg=--verbose', '--prompt', prompt] });

  const argv = tokenlessArgv(await argvOf(box, await upLine(box, bots)));

  assert.deepEqual(argv, [...bareArgv(box), '--model', 'opus[1m]', '--effort', 'xhigh', ...memoryArgs(bots, BOT), '--verbose', '--', prompt]);
});

// ------------------------------------------------------------- RL2 off

test('RL2 remote_control: off: no --remote-control, and the kit\'s --settings JSON is exactly the memory folder and "disableRemoteControl": true', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box, { keys: { remote_control: 'off' } });

  const line = await upLine(box, bots);

  const argv = await argvOf(box, line);
  assert.equal(countOf(argv, RC), 0, `no --remote-control, got: ${JSON.stringify(argv)}`);
  assert.ok(!argv.some((word) => word.startsWith(`${RC}=`) || word === '--rc'), `no form of it, got: ${JSON.stringify(argv)}`);
  assert.deepEqual(settingsJsonIn(argv), kitJson(bots, { off: true }));
  assert.deepEqual(
    tokenlessArgv(withoutSettingsPair(argv)),
    bareArgv(box).filter((word) => word !== RC),
    'with the pair taken out, the line is the on line without --remote-control',
  );
});

test('RL2 remote_control: off with every setting and a prompt: the pair goes before the separator, and the prompt is last', async (t) => {
  const box = await createSandbox(t);
  const prompt = 'Read your AGENTS.md.';
  const bots = await fleetIn(box, { flags: ['--model', 'opus', '--effort', 'high', '--extra-arg=--verbose', '--prompt', prompt], keys: { remote_control: 'off' } });

  const argv = await argvOf(box, await upLine(box, bots));

  assert.deepEqual(settingsJsonIn(argv), kitJson(bots, { off: true }));
  assert.deepEqual(argv.slice(-2), ['--', prompt], `the prompt is last, after --, got: ${JSON.stringify(argv)}`);
  assert.equal(countOf(argv, RC), 0);
});

test('RL2 remote_control: off, with a memory folder named by hand: the kit\'s --settings JSON is exactly { "disableRemoteControl": true }', async (t) => {
  // A user who named a folder by hand gets no autoMemoryDirectory from the kit
  // (ADR 0060), so the off key is the one key the kit still needs.
  const box = await createSandbox(t);
  const bots = await fleetIn(box, { keys: { remote_control: 'off' } });
  const local = path.join(botHomeOf(bots, BOT), '.claude', 'settings.local.json');
  await mkdir(path.dirname(local), { recursive: true });
  await writeFile(local, `${JSON.stringify({ [MEMORY_KEY]: '/somewhere/of/my/own' })}\n`);

  const argv = await argvOf(box, await upLine(box, bots));

  assert.equal(countOf(argv, RC), 0, `no --remote-control, got: ${JSON.stringify(argv)}`);
  assert.deepEqual(settingsJsonIn(argv), { [OFF_KEY]: true });
});

// ------------------------------------------------------------- RL3 one --settings, with the memory folder

test('RL3 off with a memory folder: one --settings, its JSON holds autoMemoryDirectory and disableRemoteControl: true, and nothing else', async (t) => {
  const box = await createSandbox(t);
  await withProfile(box);
  const bots = await fleetIn(box, { keys: { remote_control: 'off' } });

  const argv = await argvOf(box, await upLine(box, bots));

  const json = settingsJsonIn(argv);
  assert.deepEqual(Object.keys(json).sort(), [MEMORY_KEY, OFF_KEY].sort(), `both keys and no other, got: ${JSON.stringify(json)}`);
  assert.equal(json[OFF_KEY], true);
  assert.equal(typeof json[MEMORY_KEY], 'string', `the memory folder is a path, got: ${JSON.stringify(json)}`);
  assert.equal(countOf(argv, RC), 0);
});

test('RL3 on with a memory folder: --remote-control first, and one --settings whose JSON holds autoMemoryDirectory alone', async (t) => {
  const box = await createSandbox(t);
  await withProfile(box);
  const bots = await fleetIn(box);

  const argv = await argvOf(box, await upLine(box, bots));

  assert.equal(argv[0], RC, `got: ${JSON.stringify(argv)}`);
  assert.deepEqual(Object.keys(settingsJsonIn(argv)), [MEMORY_KEY], 'no disableRemoteControl for an on session');
});

// ------------------------------------------------------------- RL4 the session's own --settings

for (const [label, extra] of [
  ['--settings <file>, two words', ['--settings', '/srv/my-settings.json']],
  ['--settings=<file>, one word', ['--settings=/srv/my-settings.json']],
  ['--settings <json>', ['--settings', '{"model":"opus"}']],
]) {
  for (const memory of [false, true]) {
    const where = memory ? ', under an Orca profile' : '';
    test(`RL4 own ${label} in bot.yaml${where}, on: --remote-control still goes on, and the kit sends no --settings of its own`, async (t) => {
      const box = await createSandbox(t);
      if (memory) await withProfile(box);
      const bots = await fleetIn(box, { keys: { extra_args: extra } });

      const line = await upLine(box, bots);

      const argv = await argvOf(box, line);
      assert.equal(argv[0], RC, `on, so --remote-control first, got: ${JSON.stringify(argv)}`);
      assert.deepEqual(flagsOf(argv).filter(isSettingsWord), extra.filter(isSettingsWord), `only the user's own --settings, got: ${JSON.stringify(argv)}`);
      assert.ok(!line.includes(MEMORY_KEY) && !line.includes(OFF_KEY), `nothing of the kit's JSON on the line, got: ${line}`);
    });

    test(`RL4 own ${label} in bot.yaml${where}, off: no --remote-control, and the kit sends no --settings of its own, so no disableRemoteControl`, async (t) => {
      const box = await createSandbox(t);
      if (memory) await withProfile(box);
      const bots = await fleetIn(box, { keys: { remote_control: 'off', extra_args: extra } });

      const line = await upLine(box, bots);

      const argv = await argvOf(box, line);
      assert.equal(countOf(argv, RC), 0, `off, so no --remote-control, got: ${JSON.stringify(argv)}`);
      assert.deepEqual(flagsOf(argv).filter(isSettingsWord), extra.filter(isSettingsWord), `only the user's own --settings, got: ${JSON.stringify(argv)}`);
      assert.ok(!line.includes(MEMORY_KEY) && !line.includes(OFF_KEY), `nothing of the kit's JSON on the line, got: ${line}`);
    });
  }
}

test('RL4 own --settings written as one string of shell text in bot.yaml: the kit sends no --settings of its own, on or off', async (t) => {
  for (const remote of ['on', 'off']) {
    await t.test(remote, async (tt) => {
      const box = await createSandbox(tt);
      const bots = await fleetIn(box, { keys: { remote_control: remote, extra_args: '--settings /srv/my-settings.json' } });

      const line = await upLine(box, bots);

      const argv = await argvOf(box, line);
      assert.deepEqual(flagsOf(argv).filter(isSettingsWord), ['--settings'], `only the user's own, got: ${JSON.stringify(argv)}`);
      assert.equal(argv[argv.indexOf('--settings') + 1], '/srv/my-settings.json');
      assert.equal(argv[0] === RC, remote === 'on', `--remote-control first only when on, got: ${JSON.stringify(argv)}`);
      assert.ok(!line.includes(OFF_KEY), `got: ${line}`);
    });
  }
});

// ------------------------------------------------------------- RL5 the session's own --remote-control or --rc

const OWN_RC = [
  ['--remote-control', ['--remote-control']],
  ['--remote-control=<name>', ['--remote-control=my-title']],
  ['--rc', ['--rc']],
  ['--rc=<name>', ['--rc=my-title']],
  ['--rc in a string of shell text', '--verbose --rc'],
];

for (const [label, extra] of OWN_RC) {
  test(`RL5 own ${label} in bot.yaml, on: the kit leaves out its own --remote-control, and the user's word stays`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box, { keys: { extra_args: extra } });

    const argv = await argvOf(box, await upLine(box, bots));

    assert.notEqual(argv[0], RC, `the kit's own --remote-control is left out, got: ${JSON.stringify(argv)}`);
    assert.equal(argv[0], '--permission-mode', `the approval flag comes straight after claude, got: ${JSON.stringify(argv)}`);
    const own = Array.isArray(extra) ? extra : extra.split(' ');
    assert.equal(countOf(argv, RC), own.filter((word) => word === RC).length, `only the user's own --remote-control, got: ${JSON.stringify(argv)}`);
    for (const word of own) assert.ok(argv.includes(word), `the user's ${word} is there, got: ${JSON.stringify(argv)}`);
  });

  test(`RL5 own ${label} in bot.yaml, off: no --remote-control of the kit's, and the kit's --settings still says disableRemoteControl: true`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box, { keys: { remote_control: 'off', extra_args: extra } });

    const argv = await argvOf(box, await upLine(box, bots));

    assert.equal(argv[0], '--permission-mode', `the kit's own --remote-control is left out, got: ${JSON.stringify(argv)}`);
    assert.deepEqual(settingsJsonIn(argv), kitJson(bots, { off: true }));
  });
}

test('RL5 own --remote-control-session-name-prefix in bot.yaml is not --remote-control: the kit still puts its own first', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box, { keys: { extra_args: ['--remote-control-session-name-prefix', 'fleet'] } });

  const argv = await argvOf(box, await upLine(box, bots));

  assert.equal(argv[0], RC, `got: ${JSON.stringify(argv)}`);
  assert.equal(countOf(argv, RC), 1);
});

// ------------------------------------------------------------- RL6 a resume by the kit

/**
 * daily brought up once and given a conversation the book holds and Claude
 * Code has on record, then its tab closed the way a user closes one, and
 * brought up again: the line of that second `up` resumes the conversation.
 */
async function resumedLine(box, bots) {
  await upLine(box, bots);
  const entry = await sessionIn(bots, BOT, 'daily');
  const heard = await recordSession(box, { bots, bot: BOT, tab: entry.tab, session: 'sess-1', source: 'startup' });
  assert.equal(heard.code, 0, heard.stderr);
  await conversationOnRecord(box, { harness: 'claude', cwd: botHomeOf(bots, BOT), id: 'sess-1' });
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((terminal) => terminal.tabId !== entry.tab) });
  const line = await upLine(box, bots);
  assert.ok(line.includes(' --resume sess-1'), `the premise: the second up resumes the conversation, got: ${line}`);
  return line;
}

test('RL6 an on session resumed by the kit: --remote-control first, the approval flag after it, and --resume with the id', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box, { flags: ['--prompt', 'Keep the queue moving.'] });

  const argv = await argvOf(box, await resumedLine(box, bots));

  assert.deepEqual(argv.slice(0, 2), [RC, '--permission-mode'], `got: ${JSON.stringify(argv)}`);
  assert.equal(argv[argv.indexOf('--resume') + 1], 'sess-1');
  assert.deepEqual(settingsJsonIn(argv), kitJson(bots), 'on, so the kit\'s --settings holds the memory folder alone');
});

test('RL6 an off session resumed by the kit: no --remote-control, disableRemoteControl: true, and --resume with the id', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box, { flags: ['--prompt', 'Keep the queue moving.'], keys: { remote_control: 'off' } });

  const argv = await argvOf(box, await resumedLine(box, bots));

  assert.equal(countOf(argv, RC), 0, `got: ${JSON.stringify(argv)}`);
  assert.deepEqual(settingsJsonIn(argv), kitJson(bots, { off: true }));
  assert.equal(argv[argv.indexOf('--resume') + 1], 'sess-1');
});

test('RL6 a session set off after it ran on, then resumed by the kit, is off on the resume line', async (t) => {
  // The on-to-off move of part 3 of the design: the conversation ran with
  // Remote Control on, and only the kit's --settings keeps a resume off.
  const box = await createSandbox(t);
  const bots = await fleetIn(box, { flags: ['--prompt', 'Keep the queue moving.'] });
  const first = await upLine(box, bots);
  assert.ok(first.includes(` claude ${RC} `), `the premise: it started on, got: ${first}`);
  const entry = await sessionIn(bots, BOT, 'daily');
  const heard = await recordSession(box, { bots, bot: BOT, tab: entry.tab, session: 'sess-1', source: 'startup' });
  assert.equal(heard.code, 0, heard.stderr);
  await conversationOnRecord(box, { harness: 'claude', cwd: botHomeOf(bots, BOT), id: 'sess-1' });
  await handSet(bots, { remote_control: 'off' });
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((terminal) => terminal.tabId !== entry.tab) });

  const argv = await argvOf(box, await upLine(box, bots));

  assert.equal(argv[argv.indexOf('--resume') + 1], 'sess-1', `the premise: a resume, got: ${JSON.stringify(argv)}`);
  assert.equal(countOf(argv, RC), 0);
  assert.deepEqual(settingsJsonIn(argv), kitJson(bots, { off: true }));
});

// ------------------------------------------------------------- RL7 Codex is as it was

test('RL7 a Codex session\'s line is exactly today\'s: no --remote-control and no disableRemoteControl', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box, { harness: 'codex' });

  const line = await upLine(box, bots);

  assert.equal(line, bareLaunch(box, 'codex', BOT, 'daily'));
  assertNoRemoteControl(line, 'a Codex session');
});
