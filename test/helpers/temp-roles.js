// The fleet and the moves the temp-roles tests share (#465): a bot whose
// bot.yaml offers roles for its temporary sessions, two long-lived makers set
// otherwise on every count, and `obk temp make` / `obk temp roles` run in a
// maker's own tab.
//
// temp-bot runs on Codex. planner is its Claude Code session (opus, xhigh, a
// 1m context, approval ask); nightly is on the bot's Codex (gpt-6-sol, low, a
// 200000 context, approval auto). The roles are written into bot.yaml by hand,
// as the user would: a developer role as a plain list whose options name no
// harness, and a reviewer role as a mapping with a cap, a prompt file and two
// Codex options. No value in an option is one of the makers' own, and the two
// options of each role differ on every setting they give, so a kit that took
// the maker's setting, the other option's, or the bot's harness gets a
// different session.
//
// Every run is in the sandbox (helpers/cli.js): its own HOME, a fake Orca, and
// fake harnesses on its own PATH.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';

import { botHomeOf, kitLaunchMark, sessionIn, sh, skipGit, snapshot, tabsOfBot } from './cli.js';

export const BOT = 'temp-bot';

/** The task a made session is given. */
export const TASK = 'Read the open pull request and write down what it changes.';

/** What the reviewer role's prompt file says. */
export const REVIEW_DUTY = 'You review one pull request against its issue and say what can break.';

/** The roles the fleet's bot.yaml offers, as the user writes them. */
export const ROLES = {
  developer: [
    { name: 'standard', model: 'claude-opus-5-5', effort: 'high', for: 'most issues' },
    { name: 'deep', model: 'claude-fable-5-1', effort: 'max', context: '1m', for: 'hard causes, wide changes' },
  ],
  reviewer: {
    cap: 2,
    prompt_file: 'reviewer.md',
    options: [
      { name: 'deep', harness: 'codex', model: 'gpt-6.1-sol', effort: 'xhigh', context: 400000, for: 'most reviews' },
      { name: 'light', harness: 'codex', model: 'gpt-6.1-mini', effort: 'medium', for: 'small diffs' },
    ],
  },
};

/** A fresh copy of ROLES, to break one part of it. */
export const rolesCopy = () => structuredClone(ROLES);

export const botYaml = (bots, bot = BOT) => path.join(botHomeOf(bots, bot), 'bot.yaml');
export const readBotYaml = async (bots, bot = BOT) => parse(await readFile(botYaml(bots, bot), 'utf8'));

/** Change the bot's bot.yaml, which is the user's file and theirs to edit. */
export async function editBotYaml(bots, change, bot = BOT) {
  const doc = parse(await readFile(botYaml(bots, bot), 'utf8')) ?? {};
  await writeFile(botYaml(bots, bot), stringify(change(doc) ?? doc));
}

/** Give the bot these roles, or take its roles away with `undefined`. */
export const setRoles = (bots, roles) => editBotYaml(bots, (doc) => {
  if (roles === undefined) delete doc.temp_roles;
  else doc.temp_roles = roles;
  return doc;
});

/** One session's entry in the bot's bot.yaml, or undefined. */
export async function entryIn(bots, name) {
  const found = ((await readBotYaml(bots)).sessions ?? []).filter((one) => one?.name === name);
  assert.ok(found.length <= 1, `${BOT} should hold ${name} once at most, got: ${JSON.stringify(found)}`);
  return found[0];
}

/**
 * The five settings a session runs with, as bot.yaml has them: the harness
 * resolved to the bot's when the entry names none, approval `auto` when it
 * names none (ADR 0015). A setting left out is left out.
 */
export async function settingsOf(bots, name) {
  const doc = await readBotYaml(bots);
  const entry = (doc.sessions ?? []).find((one) => one?.name === name);
  assert.ok(entry, `${BOT} should have a session called ${name}, got: ${JSON.stringify(doc.sessions)}`);
  return {
    harness: entry.harness ?? doc.harness,
    model: entry.model,
    effort: entry.effort,
    context: entry.context === undefined ? undefined : String(entry.context),
    approval: entry.approval ?? 'auto',
  };
}

/** The environment of a command a session's harness runs in `terminal`. */
export const inTab = (box, terminal) => ({
  ...box.env, ORCA_TERMINAL_HANDLE: terminal.handle, ORCA_TAB_ID: terminal.tabId, ...kitLaunchMark(box, terminal),
});

/** The tab the book gives a session, and Orca's own record of it. */
export async function liveTab(box, bots, name) {
  const entry = await sessionIn(bots, BOT, name);
  assert.equal(typeof entry?.tab, 'string', `the book should hold a tab for ${BOT}/${name}, got: ${JSON.stringify(entry)}`);
  const terminal = (await tabsOfBot(box, bots, BOT)).find((one) => one.tabId === entry.tab);
  assert.ok(terminal, `Orca should have ${BOT}/${name}'s tab ${entry.tab}`);
  return terminal;
}

/**
 * Bot Father, and temp-bot (codex) with planner and nightly, brought up; then
 * the roles written into its bot.yaml, unless `roles` is false, and the
 * reviewer's prompt file beside it.
 */
export async function fleet(box, { roles = true } = {}) {
  const ok = async (args) => {
    const result = await box.run(args);
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  };
  await ok(['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'codex']);
  await ok([
    'session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'planner',
    '--harness', 'claude', '--model', 'opus', '--effort', 'xhigh', '--context', '1m',
    '--prompt', 'You plan the work on the API and hand it out.',
  ]);
  // #527: a session's approval is set by `obk permission approval`, not by session add.
  await ok(['permission', 'approval', '--bots', 'bots', '--bot', BOT, '--session', 'planner', '--approval', 'ask']);
  await ok([
    'session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'nightly',
    '--model', 'gpt-6-sol', '--effort', 'low', '--context', '200000',
    '--prompt', 'You watch the nightly build.',
  ]);
  await ok(['permission', 'approval', '--bots', 'bots', '--bot', BOT, '--session', 'nightly', '--approval', 'auto']);
  await ok(['up', '--bots', 'bots', '--bot', BOT]);
  const bots = box.path('bots');
  await writeFile(path.join(botHomeOf(bots, BOT), 'reviewer.md'), `${REVIEW_DUTY}\n`);
  if (roles) await setRoles(bots, rolesCopy());
  return {
    bots,
    planner: await liveTab(box, bots, 'planner'),
    nightly: await liveTab(box, bots, 'nightly'),
  };
}

/** `obk temp make`, run inside `terminal`, or with no tab at all when it is null. */
export const make = (box, terminal, args) => box.run(
  ['temp', 'make', '--bots', 'bots', ...args],
  terminal === null ? {} : { env: inTab(box, terminal) },
);

/** `obk temp make` that must work. */
export async function made(box, terminal, args) {
  const result = await make(box, terminal, args);
  assert.equal(result.code, 0, `obk temp make ${args.join(' ')} should have worked:\n${result.stdout}${result.stderr}`);
  return result;
}

/** `obk temp roles`, the same way. */
export const roles = (box, terminal, args = []) => box.run(
  ['temp', 'roles', '--bots', 'bots', ...args],
  terminal === null ? {} : { env: inTab(box, terminal) },
);

/** `obk temp retire`, the same way. */
export const retireTemp = (box, terminal, args) => box.run(
  ['temp', 'retire', '--bots', 'bots', ...args],
  terminal === null ? {} : { env: inTab(box, terminal) },
);

/** Everything a refusal must leave as it was: the bots folder, and Orca's tabs, mailboxes and projects. */
export async function world(box, bots) {
  return {
    files: await snapshot(bots, skipGit),
    terminals: await box.orca.terminals(),
    runs: await box.orca.runs(),
    setups: await box.orca.setups(),
  };
}

/** The --json answer, which is JSON and nothing else. */
export function answerIn(result) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout}${result.stderr} (${error.message})`);
  }
}

/**
 * The answer's `chosen`, with each value as text: a context may come back as
 * the number the user wrote, and that is not what is under test.
 */
export function chosenIn(answer) {
  assert.ok(answer.chosen && typeof answer.chosen === 'object', `the answer should carry chosen, got: ${JSON.stringify(answer)}`);
  return Object.fromEntries(Object.entries(answer.chosen).map(([setting, one]) => [
    setting,
    one !== null && typeof one === 'object' && one.value !== undefined ? { ...one, value: String(one.value) } : one,
  ]));
}

/** The arguments a shell running `line` hands the fake harness. */
export async function argvOf(box, line, fake) {
  const ran = await sh(line, { cwd: box.cwd, env: box.env });
  assert.equal(ran.code, 0, `the line should run: ${line}\n${ran.stderr}`);
  const calls = await fake.calls();
  assert.equal(calls.length, 1, `the line should start the harness once, got: ${line}`);
  return calls[0].args;
}
