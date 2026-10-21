// A bot's tabs get Orca's window to load them (#676).
//
// Seen by the owner on Orca 1.4.225: `obk up` made two new bots' Orca projects,
// and Orca listed their tabs `orphaned: true`. Orca writes its mail notice only
// into a tab its window has loaded, so those bots got no fleet mail until Orca
// restarted. The window loads a project's tabs only once it fetches that
// project's worktrees, and `repo add`, `project setup-update` and the kit's
// quiet `project.update` do not make it fetch them. Live probes showed that
// `orca worktree set --worktree path:<bot home>`, with no field, makes the
// window load that project's tabs within 0.4 s and changes nothing the user
// can see (tech notes, section 1, #676).
//
// The requirement, as the architect accepted it, and as these tests hold it:
//
//   R1  Each bot that a run brings up gets one `orca worktree set --worktree
//       path:<bot home>`, with no field flag (only the `--json` every Orca call
//       carries): whether the run made its project, turned it into a folder
//       project, or found it already there as a folder project. In `obk init`
//       (Bot Father), `obk up`, `obk restart`, `obk unpause` and `obk temp
//       make`. When the run made or turned the project, the call comes after
//       that project's `project setup-update`. A bot the run does not bring up
//       (a paused one, one not named) gets no call, and a second `obk up` of
//       the same bot makes the call again.
//   R2  When that call fails (refused, a crash, or no JSON), the run succeeds
//       as today: the same exit code, tabs, book, launch lines and other lines.
//       And in addition:
//         - plain output: one line for that bot that starts with `window`
//           padded to 11 characters, with the bot's display title, saying the
//           bot's tabs may get no fleet mail until Orca's window loads its
//           project, and naming the step that tries again:
//           `<obk> up --bots <bots> --bot <name>`, `<obk>` the kit's own CLI as
//           its other hints print it, shell-quoted where needed;
//         - --json: that bot's `projects` entry carries a non-empty
//           `windowTrouble`. A bot whose project this run neither made nor
//           changed gets an entry `{ bot, project, windowTrouble }`, with no
//           `change`, only when its call failed;
//         - when the call works: no `windowTrouble` and no window line, and
//           today's entries as they are;
//         - neither output says "worktree" in any case, `windowTrouble`
//           included, although Orca's refusal here does.
//   R3  `obk message send`, finding the receiver's tab listed orphaned, runs
//       `orca worktree set --worktree path:<receiver's bot home>` once, with no
//       field, then reads the listing again for up to about 2 s. If the tab is
//       no longer orphaned, the send says the ordinary line, and --json has no
//       `orphaned: true`. If it still is, the send says today's two lines
//       exactly. It never runs `terminal switch` or `terminal focus`, runs no
//       `worktree set` for a receiver whose tab is not orphaned, and never
//       prints "worktree".
//
// Everything runs in the sandbox (helpers/cli.js) against the fake Orca
// (helpers/fake-orca.js), which answers `worktree set` as Orca 1.4.225 does,
// and, with `worktreeSetLoads`, loads the project's orphaned tabs as Orca's
// window did live. The fake writes each call down in order in calls.log, which
// is how the order of the calls is read here.

import assert from 'node:assert/strict';
import { mkdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  botHomeOf,
  cliEntry,
  createSandbox,
  kitLaunchMark,
  orcaCallsOf,
  orcaCommand,
  orcaFlag,
  orcaFlags,
  recordSession,
  sessionIn,
  shellWord,
  tabsOfBot,
} from './helpers/cli.js';
import { addSession } from './helpers/permissions.js';

/** How a plain report line about the window starts: the word padded to 11 characters, as `created    ` is. */
const WINDOW = 'window     ';

/** The display title of each bot here. */
const TITLES = { 'bot-father': 'Bot Father', 'api-bot': 'Api Bot', 'web-bot': 'Web Bot' };

// ------------------------------------------------------------- helpers

async function ok(box, args, options) {
  const result = await box.run(args, options);
  assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return result;
}

const init = (box, bots = 'bots', options) => ok(box, ['init', '--bots', bots, '--harness', 'claude'], options);

/** A bot with one session, `daily`, not yet up. */
async function newBot(box, bot = 'api-bot', bots = 'bots', options) {
  await ok(box, ['bot', 'create', '--bots', bots, '--name', bot, '--harness', 'claude'], options);
  await ok(box, ['session', 'add', '--bots', bots, '--bot', bot, '--name', 'daily'], options);
}

/** A bot up in Orca, its daily session running a conversation the book knows. */
async function runningBot(box, bot = 'api-bot') {
  await newBot(box, bot);
  await ok(box, ['up', '--bots', 'bots', '--bot', bot]);
  const bots = box.path('bots');
  await recordSession(box, { bots, bot, tab: (await sessionIn(bots, bot, 'daily')).tab, session: `sess-${bot}` });
}

/** Take a bot's project and its tabs out of Orca, as a cleared Orca profile or a user's own delete does. */
async function forgetProjectOf(box, bot) {
  const home = botHomeOf(box.path('bots'), bot);
  await box.orca.set({
    setups: (await box.orca.setups()).filter((setup) => setup.path !== home),
    terminals: (await box.orca.terminals()).filter((terminal) => terminal.worktreePath !== home),
  });
}

/** Make Orca hold a bot's project as `git` kind: a registration that is not a folder project. */
async function turnToGit(box, bot) {
  const home = botHomeOf(box.path('bots'), bot);
  await box.orca.set({
    setups: (await box.orca.setups()).map((setup) => (setup.path === home ? { ...setup, kind: 'git', displayName: bot } : setup)),
  });
}

/** The one project Orca holds for a bot's folder. */
async function setupOf(box, bot, bots = box.path('bots')) {
  const home = botHomeOf(bots, bot);
  const found = (await box.orca.setups()).filter((setup) => setup.path === home);
  assert.equal(found.length, 1, `Orca should hold one project for ${bot}, got: ${JSON.stringify(await box.orca.setups())}`);
  return found[0];
}

/** The environment of a command run inside `terminal`, as Orca sets it in every pane. */
const inTab = (box, terminal) => ({ ...box.env, ORCA_TERMINAL_HANDLE: terminal.handle, ORCA_TAB_ID: terminal.tabId, ...kitLaunchMark(box, terminal) });

/** `obk temp make` of `helper`, from api-bot/daily's own tab. */
async function tempMake(box, more = []) {
  const bots = box.path('bots');
  const tabId = (await sessionIn(bots, 'api-bot', 'daily')).tab;
  const maker = (await tabsOfBot(box, bots, 'api-bot')).find((terminal) => terminal.tabId === tabId);
  assert.ok(maker, `the premise: api-bot/daily's tab ${tabId} is in Orca`);
  return box.run(['temp', 'make', '--bots', 'bots', '--name', 'helper', '--prompt', 'Look at the build.', ...more], { env: inTab(box, maker) });
}

/** The calls a run made: everything calls.log holds after `from`. */
const callsSince = async (box, from) => (await box.orca.calls()).slice(from);
const callCount = async (box) => (await box.orca.calls()).length;

/** The `--worktree` of each `worktree set` among `calls`, sorted. */
const setPaths = (calls) => orcaCallsOf(calls, 'worktree set').map((call) => orcaFlag(call, '--worktree')).sort();

/** `path:<home>` for each bot, sorted: what `setPaths` should be when exactly those bots were brought up. */
const pathsOf = (bots, names) => names.map((bot) => `path:${botHomeOf(bots, bot)}`).sort();

/** Every `worktree set` among `calls` carries `--worktree` and `--json` and nothing else. */
function assertNoField(calls) {
  for (const call of orcaCallsOf(calls, 'worktree set')) {
    assert.deepEqual(orcaFlags(call), ['--json', '--worktree'], `no field flag, only --worktree and --json, got: ${call.args.join(' ')}`);
    assert.equal(call.args.length, 5, `nothing else on the call, got: ${call.args.join(' ')}`);
  }
}

/** The bot's one `worktree set` comes after the `project setup-update --setup <setupId>` of the same run. */
function assertAfterUpdate(calls, { home, setupId, label }) {
  const at = calls.findIndex((call) => orcaCommand(call) === 'worktree set' && orcaFlag(call, '--worktree') === `path:${home}`);
  const update = calls.findIndex((call) => orcaCommand(call) === 'project setup-update' && orcaFlag(call, '--setup') === setupId);
  assert.ok(update >= 0, `${label}: the premise, a \`project setup-update --setup ${setupId}\` in the run`);
  assert.ok(at >= 0, `${label}: a \`worktree set --worktree path:${home}\` in the run`);
  assert.ok(at > update, `${label}: the \`worktree set\` comes after the \`project setup-update\` for that project (calls ${update} and ${at})`);
}

/** The answer of a run asked for JSON: exit 0 and nothing but JSON. */
function answerOf(result) {
  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
}

/** The lines of a run's plain output that start with the padded word `window`. */
const windowLines = (result) => `${result.stdout}\n${result.stderr}`.split('\n').filter((line) => line.startsWith(WINDOW));

/** Nothing the run printed says "worktree", in any case (PRD 6, the kit says "Orca project"). */
function assertNoWorktreeWord(result, label = 'the run') {
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /worktree/i, `${label} printed "worktree":\n${result.stdout}${result.stderr}`);
}

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The ways a shell word can be written so a POSIX shell reads it back as
 * `word`: in single quotes, in double quotes, or with each special character
 * escaped by a backslash, which for a word that needs no quoting is the word
 * itself.
 */
const spellingsOf = (word) => [...new Set([
  `'${word.replaceAll("'", "'\\''")}'`,
  `"${word.replace(/(["\\$`])/g, '\\$1')}"`,
  word.replace(/([^A-Za-z0-9,._+:@%/=-])/g, '\\$1'),
])];

/** Whether `line` names the step that tries again: `<cli> up --bots <bots> --bot <bot>`, each path in a spelling a shell reads back. */
function namesUpStep(line, cli, bots, bot) {
  for (const one of spellingsOf(cli)) {
    for (const folder of spellingsOf(bots)) {
      if (new RegExp(`(?:^|\\s)${escapeRe(`${one} up --bots ${folder} --bot ${bot}`)}(?![\\w-])`).test(line)) return true;
    }
  }
  return false;
}

/** The one window line about `bot`, checked against R2: its title, the cost, and the step. */
function assertWindowLine(line, { cli, bots, bot }) {
  assert.match(line, new RegExp(`\\b${TITLES[bot]}\\b`), `it names the bot by its display title, ${TITLES[bot]}, got: ${line}`);
  assert.match(line, /\bmail\b/i, `it says the bot's tabs may get no fleet mail, got: ${line}`);
  assert.match(line, /\bload/i, `until Orca's window loads its project, got: ${line}`);
  assert.ok(namesUpStep(line, cli, bots, bot), `it names the step that tries again: ${shellWord(cli)} up --bots ${shellWord(bots)} --bot ${bot}, got: ${line}`);
}

// ------------------------------------------------------------- the commands that bring a bot up

/**
 * Each command that brings a bot up, set up so the run makes the bot's Orca
 * project (the fake Orca has no project at its folder) or turns one that is
 * not a folder project into one. `bot` is that bot; `brought` is every bot the
 * run brings up.
 */
const MAKERS = {
  'init (Bot Father)': {
    bot: 'bot-father',
    brought: ['bot-father'],
    async arrange() {},
    act: (box, more = []) => box.run(['init', '--bots', 'bots', '--harness', 'claude', ...more]),
  },
  up: {
    bot: 'api-bot',
    // The whole fleet: Bot Father's project is there already as a folder project.
    brought: ['api-bot', 'bot-father'],
    async arrange(box) {
      await init(box);
      await newBot(box);
    },
    act: (box, more = []) => box.run(['up', '--bots', 'bots', ...more]),
  },
  restart: {
    bot: 'api-bot',
    brought: ['api-bot'],
    async arrange(box) {
      await init(box);
      await runningBot(box);
      await forgetProjectOf(box, 'api-bot');
    },
    act: (box, more = []) => box.run(['restart', '--bots', 'bots', '--bot', 'api-bot', ...more]),
  },
  unpause: {
    bot: 'api-bot',
    brought: ['api-bot'],
    async arrange(box) {
      await init(box);
      await runningBot(box);
      await ok(box, ['pause', '--bots', 'bots', '--bot', 'api-bot']);
      await forgetProjectOf(box, 'api-bot');
    },
    act: (box, more = []) => box.run(['unpause', '--bots', 'bots', '--bot', 'api-bot', ...more]),
  },
  'temp make': {
    bot: 'api-bot',
    brought: ['api-bot'],
    // A temporary session is made from its maker's own tab, so the bot's
    // project is there; here Orca holds it as a git-kind registration, which
    // the run turns into a folder project.
    async arrange(box) {
      await init(box);
      await newBot(box);
      await ok(box, ['up', '--bots', 'bots', '--bot', 'api-bot']);
      await turnToGit(box, 'api-bot');
    },
    act: (box, more = []) => tempMake(box, more),
  },
};

/** The same commands, set up so the bot's folder project is already there, as Orca holds it after an earlier run. */
const FINDERS = {
  'init (Bot Father) again': {
    bot: 'bot-father',
    async arrange(box) {
      await init(box);
    },
    act: (box, more = []) => box.run(['init', '--bots', 'bots', '--harness', 'claude', ...more]),
  },
  'up of a bot already up': {
    bot: 'api-bot',
    async arrange(box) {
      await init(box);
      await newBot(box);
      await ok(box, ['up', '--bots', 'bots', '--bot', 'api-bot']);
    },
    act: (box, more = []) => box.run(['up', '--bots', 'bots', '--bot', 'api-bot', ...more]),
  },
  'restart with its project there': {
    bot: 'api-bot',
    async arrange(box) {
      await init(box);
      await runningBot(box);
    },
    act: (box, more = []) => box.run(['restart', '--bots', 'bots', '--bot', 'api-bot', ...more]),
  },
  'unpause with its project there': {
    bot: 'api-bot',
    async arrange(box) {
      await init(box);
      await runningBot(box);
      await ok(box, ['pause', '--bots', 'bots', '--bot', 'api-bot']);
    },
    act: (box, more = []) => box.run(['unpause', '--bots', 'bots', '--bot', 'api-bot', ...more]),
  },
  'temp make with its project there': {
    bot: 'api-bot',
    async arrange(box) {
      await init(box);
      await newBot(box);
      await ok(box, ['up', '--bots', 'bots', '--bot', 'api-bot']);
    },
    act: (box, more = []) => tempMake(box, more),
  },
};

// ------------------------------------------------------------- R1

for (const [command, maker] of Object.entries(MAKERS)) {
  test(`R1 ${command} that makes or turns the bot's project: one worktree set for each bot it brings up, with no field, the bot's after its setup-update`, async (t) => {
    const box = await createSandbox(t);
    await maker.arrange(box);
    const from = await callCount(box);

    const result = await maker.act(box);

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    const calls = await callsSince(box, from);
    const setup = await setupOf(box, maker.bot);
    assert.equal(setup.kind, 'folder', 'the premise: the project is a folder project now');
    assert.deepEqual(setPaths(calls), pathsOf(box.path('bots'), maker.brought), `one worktree set for each bot brought up: ${maker.brought.join(', ')}`);
    assertNoField(calls);
    assertAfterUpdate(calls, { home: setup.path, setupId: setup.id, label: command });
  });
}

for (const [command, finder] of Object.entries(FINDERS)) {
  test(`R1 ${command}: the folder project is there, and the run still makes one worktree set for it, with no field`, async (t) => {
    const box = await createSandbox(t);
    await finder.arrange(box);
    const before = await setupOf(box, finder.bot);
    assert.equal(before.kind, 'folder', 'the premise: a folder project is there before the run');
    const from = await callCount(box);

    const result = await finder.act(box);

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    const calls = await callsSince(box, from);
    assert.deepEqual(orcaCallsOf(calls, 'repo add').map((call) => call.args), [], 'the premise: no project was made');
    assert.deepEqual(orcaCallsOf(calls, 'project setup-update').map((call) => call.args), [], 'and none was changed');
    assert.deepEqual(setPaths(calls), pathsOf(box.path('bots'), [finder.bot]), `one worktree set, for ${finder.bot}`);
    assertNoField(calls);
  });
}

test('R1 up that turns a git-kind registration into a folder project runs its worktree set after its setup-update', async (t) => {
  const box = await createSandbox(t);
  await init(box);
  await newBot(box);
  const home = botHomeOf(box.path('bots'), 'api-bot');
  await box.orca.set({
    setups: [...await box.orca.setups(), {
      id: 'repo_77', projectId: 'proj_77', hostId: 'host_local', repoId: 'repo_77',
      path: home, displayName: 'api-bot', kind: 'git', setupState: 'ready', setupMethod: 'repo-add',
    }],
  });
  const from = await callCount(box);

  await ok(box, ['up', '--bots', 'bots', '--bot', 'api-bot']);

  const calls = await callsSince(box, from);
  assert.deepEqual(orcaCallsOf(calls, 'repo add'), [], 'the premise: the registration was there, so nothing was made');
  assert.deepEqual(setPaths(calls), [`path:${home}`]);
  assertNoField(calls);
  assertAfterUpdate(calls, { home, setupId: 'repo_77', label: 'up of a git-kind registration' });
});

test('R1 a second up of the same bot makes the call again', async (t) => {
  const box = await createSandbox(t);
  await init(box);
  await newBot(box);
  const first = await callCount(box);
  await ok(box, ['up', '--bots', 'bots', '--bot', 'api-bot']);
  const second = await callCount(box);

  await ok(box, ['up', '--bots', 'bots', '--bot', 'api-bot']);

  const all = await box.orca.calls();
  const want = pathsOf(box.path('bots'), ['api-bot']);
  assert.deepEqual(setPaths(all.slice(first, second)), want, 'the first up, which made the project');
  assert.deepEqual(setPaths(all.slice(second)), want, 'and the second, which found it');
});

test('R1 a paused bot that up leaves closed gets no call; the bots it brings up get one each', async (t) => {
  const box = await createSandbox(t);
  await init(box);
  await runningBot(box, 'api-bot');
  await ok(box, ['pause', '--bots', 'bots', '--bot', 'api-bot']);
  await newBot(box, 'web-bot');
  const from = await callCount(box);

  await ok(box, ['up', '--bots', 'bots']);

  assert.deepEqual(setPaths(await callsSince(box, from)), pathsOf(box.path('bots'), ['bot-father', 'web-bot']), 'Bot Father and web-bot, and not the paused api-bot');
});

test('R1 up --bot names one bot: only that bot gets a call', async (t) => {
  const box = await createSandbox(t);
  await init(box);
  await newBot(box, 'api-bot');
  await ok(box, ['up', '--bots', 'bots', '--bot', 'api-bot']);
  await newBot(box, 'web-bot');
  const from = await callCount(box);

  await ok(box, ['up', '--bots', 'bots', '--bot', 'web-bot']);

  assert.deepEqual(setPaths(await callsSince(box, from)), pathsOf(box.path('bots'), ['web-bot']), 'web-bot alone: not Bot Father, not api-bot');
});

test('R1 several bots made in one up: one call for each bot, each made one after its own setup-update', async (t) => {
  const box = await createSandbox(t);
  await init(box);
  await newBot(box, 'api-bot');
  await newBot(box, 'web-bot');
  const from = await callCount(box);

  await ok(box, ['up', '--bots', 'bots']);

  const calls = await callsSince(box, from);
  assert.deepEqual(setPaths(calls), pathsOf(box.path('bots'), ['api-bot', 'bot-father', 'web-bot']));
  assertNoField(calls);
  for (const bot of ['api-bot', 'web-bot']) {
    const setup = await setupOf(box, bot);
    assertAfterUpdate(calls, { home: setup.path, setupId: setup.id, label: bot });
  }
});

// ------------------------------------------------------------- R2

/** The ways Orca can let the `worktree set` call down, each with the word "worktree" in what Orca says. */
const FAILURES = {
  'Orca refuses it': { fail: { 'worktree set': { code: 'selector_not_found', message: 'no worktree matches that path; the worktree set was refused' } } },
  'Orca crashes': { crash: { command: 'worktree set', exitCode: 3, stdout: 'worktree set: partial\n', stderr: 'orca: worktree set crashed: the worktree record broke\n' } },
  'Orca answers no JSON': { garbage: { command: 'worktree set', text: 'Worktree updated, but this is not JSON\n' } },
};

/** A run's stdout lines, not counting `window` lines, with the sandbox's own root taken out so two sandboxes compare. */
const otherLines = (box, result) => `${result.stdout}`
  .replaceAll(box.root, '<root>')
  .split('\n')
  .filter((line) => !line.startsWith(WINDOW));

/** A fleet with Bot Father up and api-bot made but not up, in a fresh sandbox. */
async function readyToUp(t) {
  const box = await createSandbox(t);
  await init(box);
  await newBot(box);
  return box;
}

/** `obk up` of api-bot alone, with `more` after it. */
const upApi = (box, more = []) => box.run(['up', '--bots', 'bots', '--bot', 'api-bot', ...more]);

for (const [how, steer] of Object.entries(FAILURES)) {
  test(`R2 ${how} at worktree set: up exits as before, opens the same tab, types its launch line, prints the same other lines`, async (t) => {
    const plain = await readyToUp(t);
    const before = await upApi(plain);
    const box = await readyToUp(t);
    await box.orca.set(steer);
    const from = await callCount(box);

    const result = await upApi(box);

    assert.ok(orcaCallsOf(await callsSince(box, from), 'worktree set').length > 0, 'the premise: the run called worktree set, which failed');
    assert.equal(result.code, before.code, `the same exit code as a run where it worked, got:\n${result.stdout}${result.stderr}`);
    assert.equal(result.code, 0);
    const bots = box.path('bots');
    const tabs = await tabsOfBot(box, bots, 'api-bot');
    assert.equal(tabs.length, 1, 'api-bot\'s tab was opened');
    assert.equal((await sessionIn(bots, 'api-bot', 'daily'))?.tab, tabs[0].tabId, 'and the book holds it');
    const typedBefore = (await tabsOfBot(plain, plain.path('bots'), 'api-bot'))[0].typed ?? [];
    assert.equal((tabs[0].typed ?? []).length, typedBefore.length, 'and its launch line was typed in, as in a run where the call worked');
    assert.ok(typedBefore.length > 0, 'the premise: a run where it worked types the launch line');
    assert.deepEqual(otherLines(box, result), otherLines(plain, before), 'every other line is the same as in a run where the call worked');
  });

  test(`R2 ${how} at worktree set: one window line for the bot, with its title, the cost and the up step, and no "worktree"`, async (t) => {
    const box = await readyToUp(t);
    await box.orca.set(steer);

    const result = await upApi(box);

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    const lines = windowLines(result);
    assert.equal(lines.length, 1, `one line that starts "${WINDOW}", got:\n${result.stdout}${result.stderr}`);
    assertWindowLine(lines[0], { cli: box.cli, bots: box.path('bots'), bot: 'api-bot' });
    assertNoWorktreeWord(result);
  });

  test(`R2 ${how} at worktree set: --json gives the made project's entry a windowTrouble, with no "worktree" in it`, async (t) => {
    const box = await readyToUp(t);
    await box.orca.set(steer);

    const result = await upApi(box, ['--json']);

    const answer = answerOf(result);
    const setup = await setupOf(box, 'api-bot');
    assert.ok(Array.isArray(answer.projects), `got: ${JSON.stringify(answer)}`);
    assert.equal(answer.projects.length, 1, `one project changed, got: ${JSON.stringify(answer.projects)}`);
    const [entry] = answer.projects;
    assert.equal(entry.bot, 'api-bot');
    assert.equal(entry.project, setup.projectId);
    assert.equal(entry.change, 'made');
    assert.equal(typeof entry.windowTrouble, 'string', `windowTrouble is a string, got: ${JSON.stringify(entry)}`);
    assert.notEqual(entry.windowTrouble.trim(), '', `and says what went wrong, got: ${JSON.stringify(entry)}`);
    assertNoWorktreeWord(result, 'the --json answer');
  });

  test(`R2 ${how} at worktree set for a project already there: --json adds { bot, project, windowTrouble }, with no change key`, async (t) => {
    const box = await readyToUp(t);
    await ok(box, ['up', '--bots', 'bots', '--bot', 'api-bot']);
    await box.orca.set(steer);

    const result = await upApi(box, ['--json']);

    const answer = answerOf(result);
    const setup = await setupOf(box, 'api-bot');
    assert.equal(answer.projects?.length, 1, `one entry, for the bot whose call failed, got: ${JSON.stringify(answer.projects)}`);
    const [entry] = answer.projects;
    assert.deepEqual(Object.keys(entry).sort(), ['bot', 'project', 'windowTrouble'], `only bot, project and windowTrouble, got: ${JSON.stringify(entry)}`);
    assert.equal(entry.bot, 'api-bot');
    assert.equal(entry.project, setup.projectId);
    assert.equal(typeof entry.windowTrouble, 'string');
    assert.notEqual(entry.windowTrouble.trim(), '', `and says what went wrong, got: ${JSON.stringify(entry)}`);
    assertNoWorktreeWord(result, 'the --json answer');
  });
}

/** Today's reload line, printed after a run that made or changed a project (#224). */
const RELOAD = "If Orca's sidebar does not show it, reload the window with Cmd+Shift+R.";

for (const [how, steer] of Object.entries(FAILURES)) {
  test(`R2 ${how} at worktree set for a project already there: apart from the window line, the plain output is a working run's, with no reload line`, async (t) => {
    // The run found the project and changed nothing in it, so today it says
    // nothing about reloading the window; a failed call adds only its window line.
    const plain = await readyToUp(t);
    await ok(plain, ['up', '--bots', 'bots', '--bot', 'api-bot']);
    const before = await upApi(plain);
    const box = await readyToUp(t);
    await ok(box, ['up', '--bots', 'bots', '--bot', 'api-bot']);
    await box.orca.set(steer);
    const from = await callCount(box);

    const result = await upApi(box);

    assert.ok(orcaCallsOf(await callsSince(box, from), 'worktree set').length > 0, 'the premise: the run called worktree set, which failed');
    assert.equal(windowLines(result).length, 1, `the premise: the run printed its window line, got:\n${result.stdout}${result.stderr}`);
    assert.equal(result.code, before.code, `the same exit code as a run where it worked, got:\n${result.stdout}${result.stderr}`);
    assert.ok(!`${before.stdout}\n${before.stderr}`.includes(RELOAD), `the premise: a working run that found the project prints no reload line, got:\n${before.stdout}`);
    assert.ok(!`${result.stdout}\n${result.stderr}`.includes(RELOAD), `no reload line: no project was made or changed, got:\n${result.stdout}`);
    assert.deepEqual(otherLines(box, result), otherLines(plain, before), 'every other line is the same as in a run where the call worked');
  });
}

test('R2 a project already there, and Orca refuses worktree set: a window line for the bot in the plain output', async (t) => {
  const box = await readyToUp(t);
  await ok(box, ['up', '--bots', 'bots', '--bot', 'api-bot']);
  await box.orca.set(FAILURES['Orca refuses it']);

  const result = await upApi(box);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  const lines = windowLines(result);
  assert.equal(lines.length, 1, `one window line, got:\n${result.stdout}${result.stderr}`);
  assertWindowLine(lines[0], { cli: box.cli, bots: box.path('bots'), bot: 'api-bot' });
  assertNoWorktreeWord(result);
});

test('R2 when worktree set works: no window line, and --json as today: the made project\'s entry with no windowTrouble, and no entry for a project found', async (t) => {
  const plainBox = await readyToUp(t);
  const jsonBox = await readyToUp(t);
  const from = await callCount(plainBox);

  const plain = await upApi(plainBox);
  const made = answerOf(await upApi(jsonBox, ['--json']));
  const found = answerOf(await upApi(jsonBox, ['--json']));

  assert.equal(orcaCallsOf(await callsSince(plainBox, from), 'worktree set').length, 1, 'the premise: the run called worktree set');
  assert.equal(plain.code, 0, `${plain.stdout}${plain.stderr}`);
  assert.deepEqual(windowLines(plain), [], `no window line, got:\n${plain.stdout}${plain.stderr}`);
  assert.deepEqual(
    made.projects,
    [{ bot: 'api-bot', project: (await setupOf(jsonBox, 'api-bot')).projectId, change: 'made' }],
    'the made project\'s entry as today, with no windowTrouble key',
  );
  assert.deepEqual(found.projects, [], 'and a run that found the project has no entry, as today');
});

/** The fleet of three, Bot Father up, api-bot and web-bot made, and only the second `worktree set` of the next run refused. */
async function secondRefused(t) {
  const box = await createSandbox(t);
  await init(box);
  await newBot(box, 'api-bot');
  await newBot(box, 'web-bot');
  // The fake's `after` counts every `worktree set` it has answered, and the
  // setup's own runs made some (init brings Bot Father up): count past those.
  const earlier = orcaCallsOf(await box.orca.calls(), 'worktree set').length;
  await box.orca.set({ fail: { 'worktree set': { code: 'selector_not_found', message: 'no worktree matches that path', after: earlier + 1, times: 1 } } });
  return box;
}

/** Which bot the second `worktree set` among `calls` was for. */
function botOfSecond(box, calls) {
  const sets = orcaCallsOf(calls, 'worktree set');
  assert.equal(sets.length, 3, `the premise: one call for each of the three bots, got: ${JSON.stringify(sets.map((call) => call.args))}`);
  const bots = box.path('bots');
  return Object.keys(TITLES).find((bot) => orcaFlag(sets[1], '--worktree') === `path:${botHomeOf(bots, bot)}`);
}

test('R2 three bots brought up, worktree set refused for the second only: a window line for that bot alone', async (t) => {
  const box = await secondRefused(t);
  const from = await callCount(box);

  const result = await box.run(['up', '--bots', 'bots']);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  const failed = botOfSecond(box, await callsSince(box, from));
  const lines = windowLines(result);
  assert.equal(lines.length, 1, `one window line, for ${failed}, got:\n${result.stdout}`);
  assertWindowLine(lines[0], { cli: box.cli, bots: box.path('bots'), bot: failed });
  for (const other of Object.keys(TITLES).filter((bot) => bot !== failed)) {
    assert.doesNotMatch(lines[0], new RegExp(`\\b${TITLES[other]}\\b`), `and not ${other}, got: ${lines[0]}`);
  }
});

test('R2 --json, three bots brought up, worktree set refused for the second only: windowTrouble for that bot alone', async (t) => {
  const box = await secondRefused(t);
  const from = await callCount(box);

  const answer = answerOf(await box.run(['up', '--bots', 'bots', '--json']));

  const failed = botOfSecond(box, await callsSince(box, from));
  const byBot = Object.fromEntries((answer.projects ?? []).map((entry) => [entry.bot, entry]));
  assert.equal(typeof byBot[failed]?.windowTrouble, 'string', `${failed}'s entry has windowTrouble, got: ${JSON.stringify(answer.projects)}`);
  assert.notEqual(byBot[failed].windowTrouble.trim(), '');
  for (const bot of ['api-bot', 'web-bot'].filter((one) => one !== failed)) {
    assert.ok(byBot[bot] !== undefined, `${bot}'s project was made, so it has an entry, got: ${JSON.stringify(answer.projects)}`);
    assert.equal('windowTrouble' in byBot[bot], false, `${bot}'s entry has no windowTrouble, got: ${JSON.stringify(byBot[bot])}`);
  }
  if (failed !== 'bot-father') {
    assert.equal(byBot['bot-father'], undefined, `Bot Father's project was found and its call worked: no entry, got: ${JSON.stringify(answer.projects)}`);
  }
});

for (const [command, maker] of Object.entries(MAKERS)) {
  test(`R2 ${command}, and Orca refuses worktree set: exit 0, one window line for each bot it brings up, and no "worktree"`, async (t) => {
    const box = await createSandbox(t);
    await maker.arrange(box);
    await box.orca.set(FAILURES['Orca refuses it']);
    const from = await callCount(box);

    const result = await maker.act(box);

    assert.ok(orcaCallsOf(await callsSince(box, from), 'worktree set').length > 0, 'the premise: the run called worktree set, which failed');
    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    const lines = windowLines(result);
    assert.equal(lines.length, maker.brought.length, `one window line for each of ${maker.brought.join(', ')}, got:\n${result.stdout}${result.stderr}`);
    for (const bot of maker.brought) {
      const mine = lines.filter((line) => new RegExp(`\\b${TITLES[bot]}\\b`).test(line));
      assert.equal(mine.length, 1, `one window line names ${TITLES[bot]}, got:\n${lines.join('\n')}`);
      assertWindowLine(mine[0], { cli: box.cli, bots: box.path('bots'), bot });
    }
    assertNoWorktreeWord(result);
  });
}

test('R2 the up step is shell-quoted where it needs it: an obk path and a bots folder with spaces', async (t) => {
  const box = await createSandbox(t);
  const bots = path.join(box.cwd, 'my bots');
  await mkdir(bots);
  // This checkout's CLI, by a path with a space in it, first on PATH: the kit
  // names itself by the path it was started by.
  const spacedBin = path.join(box.root, 'my bin');
  await mkdir(spacedBin);
  const spacedCli = path.join(spacedBin, 'obk');
  await symlink(cliEntry, spacedCli);
  const env = { ...box.env, PATH: `${spacedBin}${path.delimiter}${box.env.PATH}` };
  await init(box, bots, { env });
  await newBot(box, 'api-bot', bots, { env });
  await box.orca.set(FAILURES['Orca refuses it']);

  const result = await box.run(['up', '--bots', bots, '--bot', 'api-bot'], { env });

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  const lines = windowLines(result);
  assert.equal(lines.length, 1, `one window line, got:\n${result.stdout}${result.stderr}`);
  assertWindowLine(lines[0], { cli: spacedCli, bots, bot: 'api-bot' });
});

// ------------------------------------------------------------- R3

/**
 * Bot Father, a Claude sender (writer), a Codex receiver (coder) and a Claude
 * receiver in another approval class (skipper), all up: both receivers take
 * the Orca road, as in test/message-send-orphaned.test.js.
 */
async function fleet(box) {
  await init(box);
  for (const [bot, harness, settings] of [
    ['writer', 'claude', []],
    ['coder', 'codex', []],
    ['skipper', 'claude', ['--approval', 'dangerously-skip']],
  ]) {
    await ok(box, ['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness]);
    const added = await addSession(box, { bot, name: 'daily', settings });
    assert.equal(added.code, 0, added.stderr);
  }
  await ok(box, ['up', '--bots', 'bots']);
  return box.path('bots');
}

const RECEIVERS = [
  ['a Codex receiver', 'coder'],
  ['a Claude receiver in another approval class', 'skipper'],
];

/** The receiver's tab handle, by the tab the book names. */
async function handleOf(box, bots, bot) {
  const tabId = (await sessionIn(bots, bot, 'daily'))?.tab;
  const terminal = (await box.orca.terminals()).find((one) => one.tabId === tabId);
  assert.ok(terminal, `Orca should hold ${bot}/daily's tab ${tabId}`);
  return terminal.handle;
}

const send = (box, to, more = []) => box.run([
  'message', 'send', '--bots', 'bots', '--to', `${to}/daily`, '--from', 'writer/daily',
  '--subject', 'the staging host', '--text', 'It is down again.', ...more,
]);

/** The ordinary line, for a receiver whose tab Orca has loaded. */
const ORDINARY = "it is in its Orca mailbox, and Orca's own notice tells it to look once it is idle.";

/** Today's first line for an orphaned receiver (#579). */
const FIRST_LINE = 'it is in its Orca mailbox, and it waits there: Orca lists its tab as orphaned, because the Orca window has not loaded that tab, and Orca will not tell it of the letter until the window loads it.';

/** Today's second line for an orphaned receiver (#579), for its handle. */
const switchLine = (box, handle) => `${shellWord(box.orca.cli)} terminal switch --terminal ${shellWord(handle)} loads the tab. It also moves the user's view to that tab, so what the user types can land in it.`;

/** The send's calls that move the user's view: a switch or a focus. */
const moves = (calls) => calls.filter((call) => ['terminal switch', 'terminal focus'].includes(orcaCommand(call))
  || call.args.includes('switch') || call.args.includes('focus') || call.args.includes('--focus'));

for (const [label, bot] of RECEIVERS) {
  test(`R3 ${label} whose tab is orphaned, and the window loads it at the kit's worktree set: one call, then the ordinary line`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    const handle = await handleOf(box, bots, bot);
    await box.orca.orphan(handle);
    await box.orca.set({ worktreeSetLoads: true });
    const from = await callCount(box);

    const result = await send(box, bot);

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    const calls = await callsSince(box, from);
    assert.deepEqual(setPaths(calls), [`path:${botHomeOf(bots, bot)}`], 'one worktree set, for the receiver\'s own bot home');
    assertNoField(calls);
    const at = calls.findIndex((call) => orcaCommand(call) === 'worktree set');
    assert.ok(calls.slice(0, at).some((call) => orcaCommand(call) === 'terminal list'), 'after the listing that found the tab orphaned');
    assert.ok(calls.slice(at + 1).some((call) => orcaCommand(call) === 'terminal list'), 'and the listing is read again after it');
    assert.ok(result.stdout.split('\n').some((line) => line.trim() === ORDINARY), `the ordinary line, got:\n${result.stdout}`);
    assert.doesNotMatch(result.stdout, /orphaned/i, `nothing about an orphaned tab, got:\n${result.stdout}`);
    assert.doesNotMatch(result.stdout, /terminal switch/, `and no switch to name, got:\n${result.stdout}`);
    assertNoWorktreeWord(result);
    assert.deepEqual(moves(calls).map((call) => call.args), [], 'no switch and no focus');
    assert.equal((await box.orca.messages()).length, 1, 'and the letter is in the mailbox');
  });

  test(`R3 ${label} whose tab is orphaned, and the window loads it: --json has no orphaned: true`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await box.orca.orphan(await handleOf(box, bots, bot));
    await box.orca.set({ worktreeSetLoads: true });
    const from = await callCount(box);

    const result = await send(box, bot, ['--json']);

    const answer = answerOf(result);
    assert.equal(orcaCallsOf(await callsSince(box, from), 'worktree set').length, 1, 'the premise: the send ran its worktree set');
    assert.equal(answer.sent, true, `the letter went, got: ${result.stdout}`);
    assert.notEqual(answer.orphaned, true, `no orphaned: true once the tab is loaded, got: ${result.stdout}`);
    assertNoWorktreeWord(result, 'the --json answer');
  });

  test(`R3 ${label} whose tab stays orphaned after the kit's worktree set: one call, then today's two lines exactly`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    const handle = await handleOf(box, bots, bot);
    await box.orca.orphan(handle);
    const from = await callCount(box);

    const result = await send(box, bot);

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    const calls = await callsSince(box, from);
    assert.deepEqual(setPaths(calls), [`path:${botHomeOf(bots, bot)}`], 'one worktree set, for the receiver\'s own bot home');
    assertNoField(calls);
    const lines = result.stdout.split('\n').map((line) => line.trim());
    const first = lines.indexOf(FIRST_LINE);
    assert.ok(first >= 0, `today's first line, as it is, got:\n${result.stdout}`);
    assert.equal(lines[first + 1], switchLine(box, handle), `then today's switch line, as it is, got:\n${result.stdout}`);
    assertNoWorktreeWord(result);
    assert.deepEqual(moves(calls).map((call) => call.args), [], 'the kit names the switch and runs no switch and no focus');

    const answer = answerOf(await send(box, bot, ['--json']));
    assert.equal(answer.orphaned, true, `--json carries orphaned: true, got: ${JSON.stringify(answer)}`);
  });
}

test('R3 a receiver whose tab is not orphaned: no worktree set; an orphaned one beside it gets one', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await box.orca.orphan(await handleOf(box, bots, 'skipper'));
  const from = await callCount(box);

  const loaded = await send(box, 'coder');
  const middle = await callCount(box);
  const orphaned = await send(box, 'skipper');

  assert.equal(loaded.code, 0, `${loaded.stdout}${loaded.stderr}`);
  const all = await box.orca.calls();
  assert.deepEqual(orcaCallsOf(all.slice(from, middle), 'worktree set').map((call) => call.args), [], 'no worktree set for a tab Orca lists as loaded');
  assert.ok(loaded.stdout.split('\n').some((line) => line.trim() === ORDINARY), `the ordinary line, got:\n${loaded.stdout}`);
  assert.equal(orphaned.code, 0, `${orphaned.stdout}${orphaned.stderr}`);
  assert.deepEqual(setPaths(all.slice(middle)), [`path:${botHomeOf(bots, 'skipper')}`], 'while the orphaned receiver gets one');
});
