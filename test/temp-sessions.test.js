// Temporary sessions (PRD 6.4, #250): a session of a bot makes a session of its
// own bot for one piece of work, and retires it, one command each, without
// Bot Father.
//
//   obk temp make --bots <path> --name <session> (--prompt <text> | --prompt-file <path>)
//                 [--harness …] [--model …] [--effort …] [--context …] [--approval …]
//                 [--extra-arg=<arg>]… [--json]
//   obk temp retire --bots <path> --name <session> [--json]
//
// Both are run in a session's own Orca tab. The kit knows the caller from
// `ORCA_TAB_ID`, matched against the tab each bot's book records for its
// sessions: that session is the maker, and its bot is the bot. There is no
// `--bot`.
//
// A made session takes the maker's harness, model, effort, context and
// approval, as the maker's entry in bot.yaml has them (the harness being the
// session's own or else the bot's), unless a flag says otherwise. Not the
// maker's prompt, work dir or extra arguments: its prompt is the task, its
// work dir `work/<name>`. On a harness other than the maker's it takes only
// the approval: model, effort and context belong to a harness, so they fall to
// the new harness's own defaults unless a flag gives them (#238, the
// architect's ruling (3)). `--extra-arg`, once per argument, gives it extra
// arguments of its own, stored as `session add --extra-arg` stores them (#238,
// ruling (4)). It goes into bot.yaml and is brought up as
// `obk up --session` would bring it up, tab, mailbox and all, and the book
// records `temporary: { maker, made }` for it, which stays through later
// writes and onto its retired entry.
//
// The fleet below is built so that a wrong reading shows. The maker, planner,
// runs on its own harness (claude) where its bot runs on codex, and carries a
// model, effort, context and approval of its own, a prompt, a work dir and an
// extra argument. Its bot has a second session, nightly, set otherwise on
// every count. And a second bot has a session called planner as well, set
// otherwise again: a kit that found the maker by name rather than by tab, or
// took the bot's harness, or the other session's settings, gets a different
// session.
//
// Every run is in the sandbox (helpers/cli.js): its own HOME, a fake Orca, and
// fake harnesses on its own PATH. Nothing here reaches the real Orca, a real
// harness, or anything outside the sandbox.

import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import {
  addressPattern,
  assertRefused,
  conversationOnRecord,
  bookIn,
  botHomeOf,
  createSandbox,
  fakeProgram,
  harnessPartOf,
  kitLaunchMark,
  mailboxStep,
  orcaCallsOf,
  orcaFlag,
  recordSession,
  sessionIn,
  sh,
  skipGit,
  snapshot,
  tabsOfBot,
  typedInto,
} from './helpers/cli.js';

const BOT = 'temp-bot';
const OTHER = 'other-temp-bot';

/** The maker's own start prompt, which a session it makes must not be given. */
const PLANNER_PROMPT = 'You plan the work on the API and hand it out.';
/** The task a made session is given. It names neither its maker nor what it is. */
const TASK = 'Read the open pull request and write down what it changes.';

const botYaml = (bots, bot) => path.join(botHomeOf(bots, bot), 'bot.yaml');
const readBotYaml = async (bots, bot) => parse(await readFile(botYaml(bots, bot), 'utf8'));

/** One session's entry in a bot's bot.yaml, or undefined. */
async function entryIn(bots, bot, name) {
  const found = ((await readBotYaml(bots, bot)).sessions ?? []).filter((one) => one?.name === name);
  assert.ok(found.length <= 1, `${bot} should hold ${name} once at most, got: ${JSON.stringify(found)}`);
  return found[0];
}

/**
 * The five settings a session runs with, as bot.yaml has them: the harness
 * resolved to the bot's when the entry names none, and approval `auto` when
 * it names none (ADR 0015). A setting left out is left out.
 */
async function settingsOf(bots, bot, name) {
  const doc = await readBotYaml(bots, bot);
  const entry = (doc.sessions ?? []).find((one) => one?.name === name);
  assert.ok(entry, `${bot} should have a session called ${name}, got: ${JSON.stringify(doc.sessions)}`);
  return {
    harness: entry.harness ?? doc.harness,
    model: entry.model,
    effort: entry.effort,
    context: entry.context === undefined ? undefined : String(entry.context),
    approval: entry.approval ?? 'auto',
  };
}

const exists = (file) => stat(file).then(() => true, () => false);
const isDirectory = (file) => stat(file).then((found) => found.isDirectory(), () => false);

/**
 * The environment of a command run inside `terminal`, as Orca sets it in every
 * pane, and what the kit's launch line gave the harness there when that line
 * started the tab (#408): every command here is one a session's harness runs.
 */
const inTab = (box, terminal) => ({ ...box.env, ORCA_TERMINAL_HANDLE: terminal.handle, ORCA_TAB_ID: terminal.tabId, ...kitLaunchMark(box, terminal) });

/** The tab the book gives a session, and Orca's own record of it. */
async function liveTab(box, bots, bot, name) {
  const entry = await sessionIn(bots, bot, name);
  assert.equal(typeof entry?.tab, 'string', `the book should hold a tab for ${bot}/${name}, got: ${JSON.stringify(entry)}`);
  const terminal = (await tabsOfBot(box, bots, bot)).find((one) => one.tabId === entry.tab);
  assert.ok(terminal, `Orca should have ${bot}/${name}'s tab ${entry.tab}`);
  return terminal;
}

/**
 * Bot Father, temp-bot (codex) with planner and nightly, and other-temp-bot
 * (claude) with a planner of its own, all brought up.
 */
async function fleet(box) {
  const ok = async (args) => {
    const result = await box.run(args);
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stderr}`);
  };
  await ok(['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'codex']);
  await ok([
    'session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'planner',
    '--harness', 'claude', '--model', 'opus', '--effort', 'xhigh', '--context', '1m',
    '--prompt', PLANNER_PROMPT, '--work-dir', 'work/planner', '--extra-arg=--verbose',
  ]);
  // #527: a session's approval is set by `obk permission approval`, not by session add.
  await ok(['permission', 'approval', '--bots', 'bots', '--bot', BOT, '--session', 'planner', '--approval', 'ask']);
  await ok([
    'session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'nightly',
    '--model', 'gpt-6-sol', '--effort', 'low', '--context', '200000',
    '--prompt', 'You watch the nightly build.',
  ]);
  await ok(['permission', 'approval', '--bots', 'bots', '--bot', BOT, '--session', 'nightly', '--approval', 'auto']);
  await ok(['bot', 'create', '--bots', 'bots', '--name', OTHER, '--harness', 'claude']);
  await ok([
    'session', 'add', '--bots', 'bots', '--bot', OTHER, '--name', 'planner',
    '--model', 'sonnet', '--effort', 'medium', '--prompt', 'You plan the other bot\'s work.',
  ]);
  await ok(['permission', 'approval', '--bots', 'bots', '--bot', OTHER, '--session', 'planner', '--approval', 'auto']);
  await ok(['up', '--bots', 'bots', '--bot', BOT]);
  await ok(['up', '--bots', 'bots', '--bot', OTHER]);
  const bots = box.path('bots');
  return {
    bots,
    planner: await liveTab(box, bots, BOT, 'planner'),
    nightly: await liveTab(box, bots, BOT, 'nightly'),
    otherPlanner: await liveTab(box, bots, OTHER, 'planner'),
  };
}

/** `obk temp make`, run inside `terminal`, or with no tab at all when it is null. */
const make = (box, terminal, args) => box.run(
  ['temp', 'make', '--bots', 'bots', ...args],
  terminal === null ? {} : { env: inTab(box, terminal) },
);

/** `obk temp retire`, the same way. */
const retireTemp = (box, terminal, args) => box.run(
  ['temp', 'retire', '--bots', 'bots', ...args],
  terminal === null ? {} : { env: inTab(box, terminal) },
);

/** `obk temp make` that must work. */
async function made(box, terminal, args) {
  const result = await make(box, terminal, args);
  assert.equal(result.code, 0, `obk temp make ${args.join(' ')} should have worked:\n${result.stdout}${result.stderr}`);
  return result;
}

/** A tab in temp-bot's own project that no book names: one the user opened there. */
async function strangerIn(box, bots) {
  const home = botHomeOf(bots, BOT);
  const stranger = {
    handle: 'term_stranger',
    tabId: 'tab_stranger',
    paneKey: 'tab_stranger:pane_1',
    ptyId: 'pty_stranger',
    leafId: 'leaf_stranger',
    worktreeId: `repo_x::${home}`,
    worktreePath: home,
    title: 'my own shell',
    agentIdentity: null,
    typed: [],
  };
  await box.orca.set({ terminals: [...await box.orca.terminals(), stranger] });
  return stranger;
}

/** Everything a refusal must leave as it was: the bots folder, and Orca's tabs, mailboxes and projects. */
async function world(box, bots) {
  return {
    files: await snapshot(bots, skipGit),
    terminals: await box.orca.terminals(),
    runs: await box.orca.runs(),
    setups: await box.orca.setups(),
  };
}

const callCount = async (box) => (await box.orca.calls()).length;
const since = async (box, from) => (await box.orca.calls()).slice(from);

/** The arguments a shell running `line` hands the fake harness. */
async function argvOf(box, line, fake) {
  const ran = await sh(line, { cwd: box.cwd, env: box.env });
  assert.equal(ran.code, 0, `the line should run: ${line}\n${ran.stderr}`);
  const calls = await fake.calls();
  assert.equal(calls.length, 1, `the line should start the harness once, got: ${line}`);
  return calls[0].args;
}

/** The --json answer, which is JSON and nothing else. */
function answerIn(result) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout}${result.stderr} (${error.message})`);
  }
}

/** Every object anywhere under a value. */
function objectsIn(value) {
  if (Array.isArray(value)) return value.flatMap(objectsIn);
  if (value !== null && typeof value === 'object') return [value, ...Object.values(value).flatMap(objectsIn)];
  return [];
}

/** Every string anywhere under a value. */
function stringsIn(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(stringsIn);
  return [];
}

/** A time the kit wrote, as an ISO string no earlier than `from` and no later than `to`. */
function assertWhen(value, from, to, what) {
  assert.equal(typeof value, 'string', `${what} should be an ISO time, got: ${JSON.stringify(value)}`);
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, `${what} should be an ISO time, got: ${value}`);
  const at = Date.parse(value);
  assert.ok(at >= from && at <= to, `${what} should be the time of the run (${new Date(from).toISOString()} to ${new Date(to).toISOString()}), got: ${value}`);
}

/** Now, to the whole second below, which is as fine as an ISO time the kit writes may be. */
const nowFloor = () => Math.floor(Date.now() / 1000) * 1000;

// ------------------------------------------------------------------ making

test('TM1 a session made from the maker\'s tab takes the maker\'s harness, model, effort, context and approval', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);

  await made(box, planner, ['--name', 'scout', '--prompt', TASK]);

  assert.deepEqual(
    await settingsOf(bots, BOT, 'scout'),
    { harness: 'claude', model: 'opus', effort: 'xhigh', context: '1m', approval: 'ask' },
    'planner\'s own settings: not nightly\'s, not the bot\'s harness, not the other bot\'s planner',
  );
  assert.equal(await entryIn(bots, OTHER, 'scout'), undefined, 'the session belongs to the maker\'s bot, and no other');
});

test('TM1 a maker that names no harness passes on its bot\'s', async (t) => {
  const box = await createSandbox(t);
  const { bots, nightly } = await fleet(box);

  await made(box, nightly, ['--name', 'sweeper', '--prompt', TASK]);

  assert.deepEqual(
    await settingsOf(bots, BOT, 'sweeper'),
    { harness: 'codex', model: 'gpt-6-sol', effort: 'low', context: '200000', approval: 'auto' },
    'nightly\'s settings, on the bot\'s harness: not planner\'s claude',
  );
  const [line] = typedInto(await liveTab(box, bots, BOT, 'sweeper'));
  assert.match(harnessPartOf(line ?? ''), / codex /, `the tab runs Codex, got: ${line}`);
});

test('TM2 a flag given overrides the maker\'s setting, and only that one', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);
  // #527: planner's own approval is ask, and a temporary session wider than its
  // maker's needs the bot's temp_approval to be that wide.
  const widened = await box.run(['permission', 'approval', '--bots', 'bots', '--bot', BOT, '--temps', '--approval', 'auto']);
  assert.equal(widened.code, 0, `temp_approval should be set: ${widened.stdout}${widened.stderr}`);

  await made(box, planner, ['--name', 'scout', '--prompt', TASK, '--model', 'sonnet', '--approval', 'auto']);

  assert.deepEqual(
    await settingsOf(bots, BOT, 'scout'),
    { harness: 'claude', model: 'sonnet', effort: 'xhigh', context: '1m', approval: 'auto' },
  );
});

test('TM2 every setting can be overridden, the harness included', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);
  // #527: planner's own approval is ask, and a temporary session wider than its
  // maker's needs the bot's temp_approval to be that wide.
  const widened = await box.run(['permission', 'approval', '--bots', 'bots', '--bot', BOT, '--temps', '--approval', 'auto']);
  assert.equal(widened.code, 0, `temp_approval should be set: ${widened.stdout}${widened.stderr}`);

  await made(box, planner, [
    '--name', 'scout', '--prompt', TASK,
    '--harness', 'codex', '--model', 'gpt-6-sol', '--effort', 'high', '--context', '200000', '--approval', 'auto',
  ]);

  assert.deepEqual(
    await settingsOf(bots, BOT, 'scout'),
    { harness: 'codex', model: 'gpt-6-sol', effort: 'high', context: '200000', approval: 'auto' },
  );
});

test('TM3 the made session gets its task as its prompt and work/<name> as its work dir, and nothing else of the maker\'s', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);
  const home = botHomeOf(bots, BOT);

  await made(box, planner, ['--name', 'scout', '--prompt', TASK]);

  const entry = await entryIn(bots, BOT, 'scout');
  assert.ok(entry, 'scout is in bot.yaml');
  assert.equal(typeof entry.work_dir, 'string', `scout has a work dir, got: ${JSON.stringify(entry)}`);
  assert.equal(path.resolve(home, entry.work_dir), path.join(home, 'work', 'scout'));
  assert.ok(await isDirectory(path.join(home, 'work', 'scout')), 'and it is there for the session to walk into');
  assert.equal('extra_args' in entry, false, `the maker's extra arguments are not passed on, got: ${JSON.stringify(entry)}`);
  const held = stringsIn(entry).join('\n');
  for (const maker of [PLANNER_PROMPT, 'work/planner', '--verbose']) {
    assert.ok(!held.includes(maker), `nothing of the maker's ${maker} is in the entry, got: ${JSON.stringify(entry)}`);
  }
});

test('TM3 the made session is started on the maker\'s settings with the task as its start prompt, and its work dir under it', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);
  const home = botHomeOf(bots, BOT);

  await made(box, planner, ['--name', 'scout', '--prompt', TASK]);

  const typed = typedInto(await liveTab(box, bots, BOT, 'scout'));
  assert.equal(typed.length, 1, `one launch line is typed into the new tab, got: ${JSON.stringify(typed)}`);
  const fake = await fakeProgram(box, 'claude', {});
  const argv = await argvOf(box, typed[0], fake);
  assert.deepEqual(argv.slice(0, 3), ['--permission-mode', 'manual', '-n'], `got: ${JSON.stringify(argv)}`);
  assert.match(argv[3], addressPattern(BOT, 'scout'));
  assert.deepEqual(
    argv.slice(4, -1),
    ['--model', 'opus[1m]', '--effort', 'xhigh', '--'],
    `planner's model, context and effort, and none of its extra arguments, got: ${JSON.stringify(argv)}`,
  );
  const prompt = argv.at(-1);
  assert.ok(prompt.startsWith(`${TASK}\n\n`), `the task is the start prompt, the work-dir note below it, got: ${JSON.stringify(prompt)}`);
  assert.ok(prompt.includes(path.join(home, 'work', 'scout')), `the note names work/scout, got: ${JSON.stringify(prompt)}`);
  assert.ok(!prompt.includes(PLANNER_PROMPT), 'the maker\'s own prompt is not passed on');
});

test('TM3 --prompt-file gives the task from a file', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);
  const home = botHomeOf(bots, BOT);
  const task = 'Check the release notes against the changelog.\n\n- every entry\n- every link';
  // An absolute path, so it is the same file whatever the path is read against.
  const file = path.join(home, 'tasks', 'scout.md');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, task);

  await made(box, planner, ['--name', 'scout', '--prompt-file', file]);

  const [line] = typedInto(await liveTab(box, bots, BOT, 'scout'));
  const fake = await fakeProgram(box, 'claude', {});
  const prompt = (await argvOf(box, line, fake)).at(-1);
  assert.ok(prompt.startsWith(`${task}\n\n`), `the file's text is the start prompt, whole, got: ${JSON.stringify(prompt)}`);
  assert.ok(prompt.includes(path.join(home, 'work', 'scout')));
});

test('TM4 the made session is brought up: its own tab in the bot\'s project, a mailbox bound to that tab, and the maker\'s tab untouched', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);
  const plannerRun = (await sessionIn(bots, BOT, 'planner')).mailbox;

  await made(box, planner, ['--name', 'scout', '--prompt', TASK]);

  const scout = await liveTab(box, bots, BOT, 'scout');
  assert.notEqual(scout.tabId, planner.tabId, 'a tab of its own');
  assert.equal(scout.worktreePath, botHomeOf(bots, BOT), 'in the bot\'s project, at the bot home');
  const [line] = typedInto(scout);
  assert.ok(
    line?.startsWith(`${mailboxStep(box, { bot: BOT, session: 'scout' })}; `),
    `the launch line starts with scout's own mailbox step, got: ${line}`,
  );
  const mailbox = (await sessionIn(bots, BOT, 'scout')).mailbox;
  assert.equal(typeof mailbox, 'string', 'the book holds scout\'s mailbox');
  assert.notEqual(mailbox, plannerRun, 'not the maker\'s');
  const run = (await box.orca.runs()).find((one) => one.id === mailbox);
  assert.equal(run?.coordinator_handle, scout.handle, `scout's mailbox is bound to scout's own tab, got: ${JSON.stringify(run)}`);
  const runOfPlanner = (await box.orca.runs()).find((one) => one.id === plannerRun);
  assert.equal(runOfPlanner?.coordinator_handle, planner.handle, 'and the maker\'s mailbox is still bound to the maker\'s tab');
  const plannerNow = (await box.orca.terminals()).find((one) => one.tabId === planner.tabId);
  assert.deepEqual(typedInto(plannerNow), typedInto(planner), 'nothing was typed into the maker\'s tab');
});

test('TM5 the book records the session as temporary, with its maker and when it was made', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);
  const from = nowFloor();

  await made(box, planner, ['--name', 'scout', '--prompt', TASK]);

  const to = Date.now() + 1000;
  const entry = await sessionIn(bots, BOT, 'scout');
  assert.equal(typeof entry?.tab, 'string', `the entry is the one the bring-up wrote, with the tab, got: ${JSON.stringify(entry)}`);
  assert.deepEqual(Object.keys(entry.temporary ?? {}).sort(), ['made', 'maker'], `got: ${JSON.stringify(entry)}`);
  assert.equal(entry.temporary.maker, 'planner');
  assertWhen(entry.temporary.made, from, to, 'made');
  assert.equal((await sessionIn(bots, BOT, 'planner')).temporary, undefined, 'the maker itself is not temporary');
  assert.equal((await sessionIn(bots, BOT, 'nightly')).temporary, undefined);
});

test('TM5 temporary stays in the book through later writes to the entry: a conversation reported, and another bring-up', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);
  await made(box, planner, ['--name', 'scout', '--prompt', TASK]);
  const { temporary } = await sessionIn(bots, BOT, 'scout');
  assert.ok(temporary, 'scout is temporary, or this proves nothing');

  const first = await liveTab(box, bots, BOT, 'scout');
  const reported = await recordSession(box, { bots, bot: BOT, tab: first.tabId, session: 'sess-scout' });
  assert.equal(reported.code, 0, reported.stderr);
  const afterReport = await sessionIn(bots, BOT, 'scout');
  assert.equal(afterReport.session, 'sess-scout', 'the hook wrote the conversation into the entry');
  assert.deepEqual(afterReport.temporary, temporary, 'and temporary is still there');

  // The tab is gone, so up starts the session again in a new one.
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.tabId !== first.tabId) });
  const up = await box.run(['up', '--bots', 'bots', '--bot', BOT]);
  assert.equal(up.code, 0, up.stderr);
  const afterUp = await sessionIn(bots, BOT, 'scout');
  assert.notEqual(afterUp.tab, first.tabId, 'up wrote a new tab into the entry');
  assert.deepEqual(afterUp.temporary, temporary, 'and temporary is still there');
});

test('TM6 --json names the bot, the new session, its maker, and the tab that was made', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);

  const result = await made(box, planner, ['--name', 'scout', '--prompt', TASK, '--json']);

  const answer = answerIn(result);
  assert.equal(answer.bot, BOT, `got: ${result.stdout}`);
  assert.equal(answer.session, 'scout', `got: ${result.stdout}`);
  assert.equal(answer.maker, 'planner', `got: ${result.stdout}`);
  const { tab } = await sessionIn(bots, BOT, 'scout');
  assert.ok(
    objectsIn(answer).some((one) => one.tabId === tab && one.created === true),
    `the answer reports scout's tab ${tab} as made, the way obk up --json does, got: ${result.stdout}`,
  );
});

// --------------------------------------------------------- making, refused

/**
 * A make that is refused writes nothing and opens nothing. Each case is
 * followed by the same make done right, so that a kit refusing every make
 * does not pass.
 */
async function assertMakeRefused(box, bots, { terminal, args, named = [] }) {
  const before = await world(box, bots);
  const from = await callCount(box);

  const result = await make(box, terminal, args);

  assertRefused(result, ...named);
  assert.deepEqual(await world(box, bots), before, 'bot.yaml, the book and Orca are as they were');
  assert.deepEqual(orcaCallsOf(await since(box, from), 'terminal create'), [], 'no tab was opened');
}

test('TM7 make run outside any tab is refused, and nothing is written', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);

  await assertMakeRefused(box, bots, { terminal: null, args: ['--name', 'scout', '--prompt', TASK] });

  await made(box, planner, ['--name', 'scout', '--prompt', TASK]);
  assert.ok(await entryIn(bots, BOT, 'scout'), 'the same make from the maker\'s tab works');
});

test('TM7 make run in a tab no book names is refused, even one in the bot\'s own project, and nothing is written', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);
  const stranger = await strangerIn(box, bots);

  await assertMakeRefused(box, bots, { terminal: stranger, args: ['--name', 'scout', '--prompt', TASK] });

  await made(box, planner, ['--name', 'scout', '--prompt', TASK]);
  assert.ok(await entryIn(bots, BOT, 'scout'), 'the same make from the maker\'s tab works');
});

test('TM7 make with a name the bot already has is refused, names it, and nothing is written', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);
  const nightlyBefore = await entryIn(bots, BOT, 'nightly');

  await assertMakeRefused(box, bots, { terminal: planner, args: ['--name', 'nightly', '--prompt', TASK], named: ['nightly'] });

  assert.deepEqual(await entryIn(bots, BOT, 'nightly'), nightlyBefore);
  await made(box, planner, ['--name', 'scout', '--prompt', TASK]);
  assert.ok(await entryIn(bots, BOT, 'scout'), 'a name the bot does not have works');
});

test('TM7 make with no prompt is refused, and nothing is written', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);

  await assertMakeRefused(box, bots, { terminal: planner, args: ['--name', 'scout'] });

  await made(box, planner, ['--name', 'scout', '--prompt', TASK]);
  assert.ok(await entryIn(bots, BOT, 'scout'), 'the same make with a prompt works');
});

// A temporary session making one of its own, one level and one at a time
// (#464, which overruled TM8's "no nesting"): temp-nested.test.js.

// ------------------------------------------- making on another harness (#238)

test('TM9 a session made on a harness other than the maker\'s takes only its approval: model, effort and context are the harness\'s own', async (t) => {
  // planner is Claude on opus, xhigh, a 1m context and approval ask. A 1m
  // context on Codex is refused outright, so a make that carried it over could
  // not make a Codex session from planner at all.
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);

  await made(box, planner, ['--name', 'scout', '--prompt', TASK, '--harness', 'codex']);

  assert.deepEqual(
    await settingsOf(bots, BOT, 'scout'),
    { harness: 'codex', model: undefined, effort: undefined, context: undefined, approval: 'ask' },
    'planner\'s approval, and none of its Claude settings',
  );
  const [line] = typedInto(await liveTab(box, bots, BOT, 'scout'));
  const fake = await fakeProgram(box, 'codex', {});
  const argv = await argvOf(box, line, fake);
  assert.ok(argv.join('\n').includes('-a\non-request'), `Codex asks, as planner does: ${JSON.stringify(argv)}`);
  for (const claude of ['opus', 'xhigh', '1m']) {
    assert.ok(!argv.some((word) => word.includes(claude)), `nothing of planner's ${claude} on the launch line: ${JSON.stringify(argv)}`);
  }
});

test('TM9 on another harness, a model, effort or context given is used, and what is not given is still not the maker\'s', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);

  await made(box, planner, ['--name', 'scout', '--prompt', TASK, '--harness', 'codex', '--model', 'gpt-6-sol', '--effort', 'high']);

  assert.deepEqual(
    await settingsOf(bots, BOT, 'scout'),
    { harness: 'codex', model: 'gpt-6-sol', effort: 'high', context: undefined, approval: 'ask' },
  );
});

test('TM9 a Codex maker making a Claude session passes on none of its Codex model, effort or context', async (t) => {
  // nightly is on its bot's Codex, with gpt-6-sol, low and a 200000 context.
  const box = await createSandbox(t);
  const { bots, nightly } = await fleet(box);

  await made(box, nightly, ['--name', 'sweeper', '--prompt', TASK, '--harness', 'claude']);

  assert.deepEqual(
    await settingsOf(bots, BOT, 'sweeper'),
    { harness: 'claude', model: undefined, effort: undefined, context: undefined, approval: 'auto' },
  );
});

test('TM9 naming the maker\'s own harness changes nothing: the maker\'s settings are taken as before', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);

  await made(box, planner, ['--name', 'scout', '--prompt', TASK, '--harness', 'claude']);

  assert.deepEqual(
    await settingsOf(bots, BOT, 'scout'),
    { harness: 'claude', model: 'opus', effort: 'xhigh', context: '1m', approval: 'ask' },
  );
});

// ------------------------------------------- extra arguments of its own (#238)

/** Extra arguments that show a word quoted or split the wrong way: a dash first, spaces and quotes, a dollar. */
const EXTRA = ['-c', 'projects={"/tmp/a b"={trust_level="trusted"}}', '$HOME stays'];

test('TM10 --extra-arg, once per argument, gives the made session extra arguments of its own, stored as session add stores them', async (t) => {
  // Made by nightly, on its own Codex, so that nothing but the extra arguments
  // is new here.
  const box = await createSandbox(t);
  const { bots, nightly } = await fleet(box);
  const flags = EXTRA.map((arg) => `--extra-arg=${arg}`);

  await made(box, nightly, ['--name', 'scout', '--prompt', TASK, ...flags]);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'by-hand', '--prompt', TASK, ...flags]);
  assert.equal(added.code, 0, added.stderr);

  const entry = await entryIn(bots, BOT, 'scout');
  assert.deepEqual(entry.extra_args, EXTRA, `each argument whole and in order, got: ${JSON.stringify(entry)}`);
  assert.deepEqual(entry.extra_args, (await entryIn(bots, BOT, 'by-hand')).extra_args, 'as session add stores the same flags');
  const [line] = typedInto(await liveTab(box, bots, BOT, 'scout'));
  const fake = await fakeProgram(box, 'codex', {});
  const argv = await argvOf(box, line, fake);
  assert.ok(argv.join('\n').includes(EXTRA.join('\n')), `the launch line hands Codex each one, in order: ${JSON.stringify(argv)}`);
});

test('TM10 the made session\'s extra arguments are its own: the maker\'s are not added to them', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);

  await made(box, planner, ['--name', 'scout', '--prompt', TASK, '--extra-arg=--search']);

  assert.deepEqual((await entryIn(bots, BOT, 'scout')).extra_args, ['--search'], 'not planner\'s --verbose beside it');
});

// ------------------------------------------- making, when the bring-up fails

// A start prompt too long for the launch line goes to the harness from a file
// in `<bots>.prompts`, beside the bots folder. Seen live: under Codex's sandbox
// that file could not be written (EPERM), after the session had been written,
// and the retry was refused for a name the bot already had. So a make writes
// that file first: when it cannot, the make is refused and changes nothing,
// and the same command run again, once it can, works. TP1 below makes the
// folder read-only for the first make, and gives it its mode back after.
//
// A bring-up that fails for another reason, once the session is written, says
// the session was made and how to go on, every command with its `--bots`. TP2
// gets there by having the fake Orca refuse every tab asked of it during the
// make (one refusal is not enough: a bring-up asks again).

/** Root writes a file whatever its folder's mode, so no start prompt can be kept from being written. */
const NEEDS_A_USER = process.getuid?.() === 0
  && 'runs as root, which writes a file whatever its folder\'s mode, so the start prompt cannot be kept from being written';

/** A task long enough that its start prompt goes to the harness from a file. */
const LONG_TASK = 'Read the open pull request and write down what it changes. '.repeat(10).trim();

/** Where the kit keeps start-prompt files, beside the bots folder. */
const promptsOf = (bots) => `${bots}.prompts`;

/** The start-prompt file the kit keeps for one session. */
const promptFileOf = (bots, bot, name) => path.join(promptsOf(bots), `${bot}.${name}.txt`);

/** A make run with the prompts folder read-only, its mode given back whatever happens. */
async function makeLocked(box, bots, terminal, args) {
  const folder = promptsOf(bots);
  assert.ok((await stat(folder)).isDirectory(), `the fleet should have a prompts folder at ${folder}, or nothing is locked`);
  const mode = (await stat(folder)).mode & 0o7777;
  await chmod(folder, 0o555);
  try {
    return await make(box, terminal, args);
  } finally {
    await chmod(folder, mode);
  }
}

/** A make run while Orca refuses every tab asked of it, and Orca opening tabs again after it. */
async function makeTabRefused(box, terminal, args) {
  await box.orca.set({ fail: { 'terminal create': { code: 'runtime_error', message: 'no room for another tab' } } });
  try {
    return await make(box, terminal, args);
  } finally {
    await box.orca.set({ fail: {} });
  }
}

/**
 * Each `obk` command in a text, from the subcommand on to the next one: what
 * follows `obk ` wherever it is a word of its own, however the CLI's path in
 * front of it is spelled. A sandbox's folder is called `obk-…`, which is not.
 */
const commandsIn = (text) => text.split(/\bobk (?=[a-z])/).slice(1);

const SCOUT = ['--name', 'scout', '--prompt', LONG_TASK];

test('TP1 a make whose start prompt file cannot be written is refused, says why, and changes nothing; run again once it can, it works', { skip: NEEDS_A_USER }, async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);
  const before = await world(box, bots);
  const from = await callCount(box);

  const result = await makeLocked(box, bots, planner, SCOUT);

  assertRefused(result);
  const said = `${result.stdout}${result.stderr}`;
  assert.ok(said.includes(promptsOf(bots)), `the refusal names the prompts folder or the file in it, got:\n${said}`);
  assert.match(said, /EACCES|EPERM|permission/i, `and the permission failure, got:\n${said}`);
  assert.deepEqual(await world(box, bots), before, 'bot.yaml, the book and Orca are as they were');
  assert.deepEqual(orcaCallsOf(await since(box, from), 'terminal create'), [], 'no tab was opened');
  assert.equal(await exists(promptFileOf(bots, BOT, 'scout')), false, 'and no prompt file was left');

  const again = await make(box, planner, SCOUT);

  assert.equal(again.code, 0, `the same make with the folder writable works:\n${again.stdout}${again.stderr}`);
  const scout = await liveTab(box, bots, BOT, 'scout');
  assert.equal(typedInto(scout).length, 1, `scout is started in its tab, got: ${JSON.stringify(typedInto(scout))}`);
  assert.equal((await sessionIn(bots, BOT, 'scout')).temporary?.maker, 'planner', 'and the book has it as temporary, with its maker');
});

test('TP2 a make whose bring-up fails after the session is written says it was made and the way on, every command with --bots', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);

  const result = await makeTabRefused(box, planner, SCOUT);

  const said = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.code, 0, `the bring-up failed, and the run says so in its exit code, got:\n${said}`);
  assert.ok(!/^\s+at /m.test(said), `expected a message, got a crash:\n${said}`);
  assert.ok(await entryIn(bots, BOT, 'scout'), `scout is written into bot.yaml, or this is not the case at hand, got:\n${said}`);
  assert.equal((await sessionIn(bots, BOT, 'scout'))?.temporary?.maker, 'planner', 'and into the book as temporary, with its maker');
  assert.ok(said.includes('scout'), `the error names the session, got:\n${said}`);
  assert.match(said, /\bmade\b/, `and says it was made, got:\n${said}`);
  const commands = commandsIn(said);
  assert.ok(
    commands.some((one) => /^up\b/.test(one) && /--bot\s+'?temp-bot\b/.test(one) && /--session\s+'?scout\b/.test(one)),
    `it gives obk up for scout, got:\n${said}`,
  );
  assert.ok(
    commands.some((one) => /^temp retire\b/.test(one) && /--name\s+'?scout\b/.test(one)),
    `and obk temp retire for scout, got:\n${said}`,
  );
  for (const one of commands) assert.match(one, /--bots\s+\S+/, `every command it prints carries --bots <path>, got: obk ${one}`);
});

/**
 * Makes `session add` would refuse, each with a start prompt long enough to
 * go through a file, so a kit that writes that file first has written it by
 * the time it finds out.
 */
const REFUSED_SETTINGS = [
  ['an approval the kit does not know', [...SCOUT, '--approval', 'sometimes']],
  ['a harness the kit does not know', [...SCOUT, '--harness', 'emacs']],
  // A context of 1m is Claude's; Codex counts tokens, and cannot read it.
  ['Codex given a context of 1m, which it cannot take', [...SCOUT, '--harness', 'codex', '--context', '1m']],
  ['a prompt file that is not there', ['--name', 'scout', '--prompt-file', '/nowhere/obk-temp-sessions/no-such-task.md']],
];

for (const [label, args] of REFUSED_SETTINGS) {
  test(`TP3 a make refused for ${label} changes nothing and leaves no prompt file`, async (t) => {
    const box = await createSandbox(t);
    const { bots, planner } = await fleet(box);

    await assertMakeRefused(box, bots, { terminal: planner, args });

    assert.equal(await exists(promptFileOf(bots, BOT, 'scout')), false, `no prompt file is left at ${promptFileOf(bots, BOT, 'scout')}`);
    await made(box, planner, SCOUT);
    assert.ok(await entryIn(bots, BOT, 'scout'), 'the same make with nothing wrong in it works');
  });
}

// ------------------------------------------------ making, from the review of PR 404

/**
 * Everything in the sandbox's working directory: the bots folder and every
 * folder of the kit's beside it, so a make that wrote anywhere at all shows.
 * The bots repo's own .git is left out.
 */
const everything = (box) => snapshot(box.cwd, (rel) => rel === 'bots/.git' || rel.startsWith('bots/.git/'));

/**
 * Hold a bot's book lock, the way another writer of the book does, until
 * `release` is called: the file SQLite locks, beside the bots folder in
 * `<bots>.locks/<bot home's name>.lock`, taken with `BEGIN IMMEDIATE`.
 */
async function holdBookLock(bots, bot) {
  const file = path.join(`${bots}.locks`, `${encodeURIComponent(bot)}.lock`);
  await mkdir(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('BEGIN IMMEDIATE');
  return {
    release() {
      try {
        db.exec('COMMIT');
      } finally {
        db.close();
      }
    },
  };
}

test('TQ1 a make that cannot write the book leaves nothing of the session, says so and why, and works once the book can be written', async (t) => {
  // Seen in the review: bot.yaml had the session and the book did not, so it
  // was neither temporary nor its maker's, and nothing could retire it but
  // Bot Father.
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);
  const before = await world(box, bots);
  const from = await callCount(box);

  const lock = await holdBookLock(bots, BOT);
  let result;
  try {
    result = await make(box, planner, SCOUT);
  } finally {
    lock.release();
  }

  const said = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.code, 0, `the make failed, and says so in its exit code, got:\n${said}`);
  assert.ok(!/^\s+at /m.test(said), `expected a message, got a crash:\n${said}`);
  assert.match(said, /nothing/i, `it says nothing was made, got:\n${said}`);
  assert.match(said, /book|sessions\.yaml/i, `and that the book could not be written, got:\n${said}`);
  assert.equal(await entryIn(bots, BOT, 'scout'), undefined, 'scout is not left in bot.yaml');
  assert.equal(await sessionIn(bots, BOT, 'scout'), undefined, 'nor in the book');
  assert.equal(await exists(promptFileOf(bots, BOT, 'scout')), false, 'nor is its prompt file');
  assert.deepEqual(orcaCallsOf(await since(box, from), 'terminal create'), [], 'and no tab was opened');
  assert.deepEqual(await world(box, bots), before, 'bot.yaml, the book and Orca are as they were');

  await made(box, planner, SCOUT);
  assert.equal((await sessionIn(bots, BOT, 'scout'))?.temporary?.maker, 'planner', 'with the lock let go, the same make works');
});

test('TQ4 a make whose book write fails and whose prompt file cannot be removed says the session was taken back and names the file left, with rm', { skip: NEEDS_A_USER }, async (t) => {
  // From round 2 of the review of PR 404: bot.yaml was put back as it was, the
  // prompt file could not be removed, and the message said the session was
  // still in bot.yaml and to retire it, which then refused a session that was
  // not there. A leftover prompt file of the same name can be written over but
  // not removed, in a prompts folder that is read-only for the run.
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);
  const file = promptFileOf(bots, BOT, 'scout');
  await writeFile(file, 'left over from an earlier run\n');
  const folder = promptsOf(bots);
  const mode = (await stat(folder)).mode & 0o7777;
  const from = await callCount(box);

  await chmod(folder, 0o555);
  const lock = await holdBookLock(bots, BOT);
  let result;
  try {
    result = await make(box, planner, SCOUT);
  } finally {
    lock.release();
    await chmod(folder, mode);
  }

  const said = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.code, 0, `the make failed, and says so in its exit code, got:\n${said}`);
  assert.ok(!/^\s+at /m.test(said), `expected a message, got a crash:\n${said}`);
  assert.ok(await exists(file), 'the prompt file is still there, or this is not the case at hand');
  assert.equal(await entryIn(bots, BOT, 'scout'), undefined, 'scout is not in bot.yaml');
  assert.equal(await sessionIn(bots, BOT, 'scout'), undefined, 'nor in the book');
  assert.deepEqual(orcaCallsOf(await since(box, from), 'terminal create'), [], 'and no tab was opened');
  assert.match(said, /nothing|taken back|taken off/i, `it says the session was taken back, nothing made, got:\n${said}`);
  assert.ok(said.includes(file), `it names the prompt file left, got:\n${said}`);
  assert.match(said, /EACCES|EPERM|permission/i, `and why it could not be removed, got:\n${said}`);
  assert.ok(
    said.split('\n').some((line) => /\brm\b/.test(line) && line.includes(file)),
    `and a command that removes it, got:\n${said}`,
  );
  assert.deepEqual(
    commandsIn(said).filter((one) => /^(temp )?retire\b/.test(one)),
    [],
    `it does not send the user to retire a session that is not there, got:\n${said}`,
  );
});

/** Names that are not one plain name: not a single folder under work/, or not a name the kit gives anything. */
const NOT_A_NAME = ['../../escaped-work', 'a/b', 'Upper', '..'];

for (const name of NOT_A_NAME) {
  test(`TQ2 a make named ${name} is refused with the naming rule, and nothing is written anywhere`, async (t) => {
    const box = await createSandbox(t);
    const { bots, planner } = await fleet(box);
    const before = await everything(box);

    await assertMakeRefused(box, bots, { terminal: planner, args: ['--name', name, '--prompt', LONG_TASK] });

    const result = await make(box, planner, ['--name', name, '--prompt', LONG_TASK]);
    const said = `${result.stdout}${result.stderr}`;
    for (const rule of [/lower-?case/i, /digit/i, /hyphen/i]) {
      assert.match(said, rule, `the refusal says what a name is, got:\n${said}`);
    }
    assert.deepEqual(await everything(box), before, 'nothing was written anywhere, inside the bots folder or beside it');

    await made(box, planner, ['--name', 'scout-2', '--prompt', LONG_TASK]);
    assert.ok(await isDirectory(path.join(botHomeOf(bots, BOT), 'work', 'scout-2')), 'a plain name such as scout-2 works');
  });
}

test('TQ3 a make given both --prompt and --prompt-file is refused, says to give the task one way, and nothing is written', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);
  const file = path.join(botHomeOf(bots, BOT), 'tasks', 'scout.md');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, 'Check the release notes against the changelog.');
  const before = await everything(box);
  const args = ['--name', 'scout', '--prompt', TASK, '--prompt-file', file];

  await assertMakeRefused(box, bots, { terminal: planner, args });

  const said = await make(box, planner, args).then((result) => `${result.stdout}${result.stderr}`);
  assert.ok(said.includes('--prompt-file'), `the refusal names the two ways the task was given, got:\n${said}`);
  assert.deepEqual(await everything(box), before, 'nothing was written anywhere');

  await made(box, planner, ['--name', 'scout', '--prompt', TASK]);
  assert.ok(await entryIn(bots, BOT, 'scout'), 'one of them alone works');
});

// ------------------------------------------------------------------ retiring

/** The fleet, with scout made by planner and given a conversation, and helper made by the other bot's planner. */
async function withTemps(box) {
  const found = await fleet(box);
  const { bots, planner, otherPlanner } = found;
  await made(box, planner, ['--name', 'scout', '--prompt', TASK]);
  await made(box, otherPlanner, ['--name', 'helper', '--prompt', TASK]);
  const scout = await liveTab(box, bots, BOT, 'scout');
  const reported = await recordSession(box, { bots, bot: BOT, tab: scout.tabId, session: 'sess-scout' });
  assert.equal(reported.code, 0, reported.stderr);
  return { ...found, scout, helper: await liveTab(box, bots, OTHER, 'helper') };
}

test('TR1 the maker retires its own temporary session: its tab closed, off bot.yaml, into the book\'s retired list with its maker', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner, nightly, scout } = await withTemps(box);
  const yamlBefore = await readBotYaml(bots, BOT);
  const { temporary } = await sessionIn(bots, BOT, 'scout');
  const started = nowFloor();
  const from = await callCount(box);

  const result = await retireTemp(box, planner, ['--name', 'scout']);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  const calls = await since(box, from);
  assert.deepEqual(
    orcaCallsOf(calls, 'terminal close').map((call) => orcaFlag(call, '--terminal')),
    [scout.handle],
    'scout\'s tab is closed by its own handle, and no other',
  );
  assert.deepEqual(orcaCallsOf(calls, 'project setup-delete'), [], 'the bot\'s project stays');
  assert.deepEqual(
    (await tabsOfBot(box, bots, BOT)).map((one) => one.tabId).sort(),
    [planner.tabId, nightly.tabId].sort(),
  );

  const yamlAfter = await readBotYaml(bots, BOT);
  assert.deepEqual(yamlAfter.sessions, yamlBefore.sessions.filter((one) => one.name !== 'scout'));
  assert.deepEqual({ ...yamlAfter, sessions: null }, { ...yamlBefore, sessions: null }, 'nothing else in bot.yaml moves');

  const book = await bookIn(bots, BOT);
  assert.equal(book.sessions?.scout, undefined, `scout is off the live list, got: ${JSON.stringify(book.sessions)}`);
  assert.ok(book.sessions?.planner && book.sessions?.nightly, 'and the long-lived sessions are still on it');
  const entries = (book.retired ?? []).filter((one) => one?.name === 'scout');
  assert.equal(entries.length, 1, `one retired entry for scout, got: ${JSON.stringify(book.retired)}`);
  const held = stringsIn(entries[0]);
  assert.ok(held.includes('sess-scout'), `its conversation is kept, got: ${JSON.stringify(entries[0])}`);
  assert.ok(
    held.some((text) => /^\d{4}-\d{2}-\d{2}T/.test(text) && Date.parse(text) >= started),
    `and when it was retired, got: ${JSON.stringify(entries[0])}`,
  );
  assert.deepEqual(entries[0].temporary, temporary, 'still marked temporary, with its maker');
});

test('TR1 temp retire answers --json with JSON and nothing else', async (t) => {
  const box = await createSandbox(t);
  const { planner } = await withTemps(box);

  const result = await retireTemp(box, planner, ['--name', 'scout', '--json']);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.ok(stringsIn(answerIn(result)).some((text) => text.includes('scout')), `the answer names scout, got: ${result.stdout}`);
});

// --------------------------------------------------------- retiring, refused

/**
 * A retire that is refused writes nothing and closes nothing: bot.yaml, the
 * book, and every tab, mailbox and project in Orca as they were.
 */
async function assertRetireRefused(box, bots, { terminal, name }) {
  const before = await world(box, bots);
  const from = await callCount(box);

  const result = await retireTemp(box, terminal, ['--name', name]);

  assertRefused(result);
  const calls = await since(box, from);
  assert.deepEqual(orcaCallsOf(calls, 'terminal close'), [], 'no tab was closed');
  assert.deepEqual(orcaCallsOf(calls, 'project setup-delete'), []);
  assert.deepEqual(await world(box, bots), before, 'bot.yaml, the book and Orca are as they were');
}

test('TR2 temp retire run outside any tab is refused, and nothing is written or closed', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await withTemps(box);

  await assertRetireRefused(box, bots, { terminal: null, name: 'scout' });

  const own = await retireTemp(box, planner, ['--name', 'scout']);
  assert.equal(own.code, 0, `the same retire from the maker's tab works: ${own.stderr}`);
});

test('TR2 temp retire run in a tab no book names is refused, and nothing is written or closed', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await withTemps(box);
  const stranger = await strangerIn(box, bots);

  await assertRetireRefused(box, bots, { terminal: stranger, name: 'scout' });
});

test('TR3 a session that is not the caller\'s bot\'s is refused, even a temporary one whose maker has the caller\'s name', async (t) => {
  // helper is other-temp-bot's, made by its planner; temp-bot's planner asks.
  const box = await createSandbox(t);
  const { bots, planner, otherPlanner } = await withTemps(box);

  await assertRetireRefused(box, bots, { terminal: planner, name: 'helper' });
  await assertRetireRefused(box, bots, { terminal: planner, name: 'ghost' });

  const own = await retireTemp(box, otherPlanner, ['--name', 'helper']);
  assert.equal(own.code, 0, `its own maker can retire it: ${own.stderr}`);
});

test('TR4 a long-lived session is refused, and nothing is written or closed', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await withTemps(box);

  await assertRetireRefused(box, bots, { terminal: planner, name: 'nightly' });
});

test('TR5 a temporary session another session made is refused, and nothing is written or closed', async (t) => {
  // scout is planner's; nightly, of the same bot, asks.
  const box = await createSandbox(t);
  const { bots, planner, nightly } = await withTemps(box);

  await assertRetireRefused(box, bots, { terminal: nightly, name: 'scout' });

  const own = await retireTemp(box, planner, ['--name', 'scout']);
  assert.equal(own.code, 0, `its own maker can retire it: ${own.stderr}`);
});

test('TR6 the maker is known by its session name, not its tab: after a restart gives it a new tab, it still retires what it made', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner, scout } = await withTemps(box);
  assert.equal((await sessionIn(bots, BOT, 'scout')).temporary?.maker, 'planner', 'the book names the maker by its session name');
  // A restart resumes the conversation the book holds, so planner has one, on
  // Claude Code's own record as well (#295).
  const reported = await recordSession(box, { bots, bot: BOT, tab: planner.tabId, session: 'sess-planner' });
  assert.equal(reported.code, 0, reported.stderr);
  await conversationOnRecord(box, { harness: 'claude', cwd: botHomeOf(bots, BOT), id: 'sess-planner' });
  const restarted = await box.run(['restart', '--bots', 'bots', '--bot', BOT, '--session', 'planner']);
  assert.equal(restarted.code, 0, `${restarted.stdout}${restarted.stderr}`);
  const moved = await liveTab(box, bots, BOT, 'planner');
  assert.notEqual(moved.tabId, planner.tabId, 'planner is in a new tab, or this proves nothing');
  assert.equal((await sessionIn(bots, BOT, 'scout')).temporary?.maker, 'planner', 'and scout\'s maker is still planner');

  const result = await retireTemp(box, moved, ['--name', 'scout']);

  assert.equal(result.code, 0, `from planner's new tab, scout is still planner's to retire: ${result.stdout}${result.stderr}`);
  assert.equal(await entryIn(bots, BOT, 'scout'), undefined, 'scout is off bot.yaml');
  assert.equal((await box.orca.terminals()).some((one) => one.tabId === scout.tabId), false, 'and its tab is closed');
});

// ------------------------------------------------------------------ roster

test('TS1 roster --json carries temporary, with its maker and when it was made, in the session\'s book', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);
  await made(box, planner, ['--name', 'scout', '--prompt', TASK]);
  const { temporary } = await sessionIn(bots, BOT, 'scout');

  const result = await box.run(['roster', '--bots', 'bots', '--bot', BOT, '--json']);

  assert.equal(result.code, 0, result.stderr);
  const [entry] = answerIn(result).roster;
  const session = (name) => entry.sessions.find((one) => one.name === name);
  assert.equal(session('scout')?.book?.temporary?.maker, 'planner', `got: ${JSON.stringify(session('scout'))}`);
  assert.equal(session('scout').book.temporary.made, temporary.made);
  assert.equal(session('planner')?.book?.temporary, undefined, 'a long-lived session carries none');
  assert.equal(session('nightly')?.book?.temporary, undefined);
});

test('TS2 the plain roster says a temporary session is temporary and names its maker, and says it of no other', async (t) => {
  const box = await createSandbox(t);
  const { planner } = await fleet(box);
  await made(box, planner, ['--name', 'scout', '--prompt', TASK]);

  const result = await box.run(['roster', '--bots', 'bots', '--bot', BOT]);

  assert.equal(result.code, 0, result.stderr);
  // A session's block: its `session` line and the indented lines under it.
  const lines = result.stdout.split('\n');
  const blockOf = (name) => {
    const at = lines.findIndex((line) => new RegExp(`^session\\s+${name}(\\s|$)`).test(line));
    assert.ok(at >= 0, `the roster should have a session line for ${name}, got:\n${result.stdout}`);
    const end = lines.findIndex((line, index) => index > at && !/^\s/.test(line));
    return lines.slice(at, end < 0 ? undefined : end).join('\n');
  };
  const scout = blockOf('scout');
  assert.match(scout, /temporary/, `scout is said to be temporary, got:\n${scout}`);
  assert.match(scout, /\bplanner\b/, `and its maker is named, got:\n${scout}`);
  for (const name of ['planner', 'nightly']) {
    assert.doesNotMatch(blockOf(name), /temporary/, `${name} is long-lived, got:\n${blockOf(name)}`);
  }
});

// ------------------------------------------------------------ obk retire

test('TB1 obk retire --session still retires a temporary session, run from outside any tab', async (t) => {
  const box = await createSandbox(t);
  const { bots, scout } = await withTemps(box);

  const result = await box.run(['retire', '--bots', 'bots', '--bot', BOT, '--session', 'scout']);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.equal(await entryIn(bots, BOT, 'scout'), undefined, 'scout is off bot.yaml');
  assert.equal((await box.orca.terminals()).some((one) => one.tabId === scout.tabId), false, 'its tab is closed');
  const book = await bookIn(bots, BOT);
  assert.equal(book.sessions?.scout, undefined);
  assert.equal((book.retired ?? []).filter((one) => one?.name === 'scout').length, 1, `got: ${JSON.stringify(book.retired)}`);
  assert.ok(await exists(botHomeOf(bots, BOT)), 'and the bot is where it was');
});
