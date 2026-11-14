// An extra argument does not set Remote Control (#755), section 3 of the test
// brief.
//
// The setting `remote_control: on|off` is the one road to Remote Control
// (test/remote-control-setting.test.js), so a session that is off cannot be
// turned on by an argument. As decided on #755:
//
//   RX1  `session add`, `session change` and `temp make` refuse an
//        `--extra-arg` of `--remote-control`, `--remote-control=<x>`, `--rc`
//        or `--rc=<x>` on a Claude session. The message names
//        `--remote-control on|off` as the way to set it. Nothing is written.
//   RX2  `--remote-control-session-name-prefix` is not refused.
//   RX3  Codex and Pi extra arguments are not judged by this rule.
//
// What `up` does with such an argument written into bot.yaml by hand is
// test/remote-control-launch.test.js (RL5), and what health says of it is
// test/remote-control-health.test.js.
//
// Every run is in the sandbox (helpers/cli.js): its own HOME, a fake Orca and
// fake harnesses on its own PATH.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';

import {
  assertRefused,
  createSandbox,
  orcaCallsOf,
  sessionIn,
  skipGit,
  snapshot,
  tabsOfBot,
} from './helpers/cli.js';
import { fakePi } from './helpers/pi.js';
import { botYamlOf } from './helpers/skills.js';
import { inTab, TASK } from './helpers/temp-roles.js';

const POINTER = '--remote-control on|off';

/** The extra arguments refused on a Claude session, each as the list of --extra-arg values. */
const REFUSED = [
  ['--remote-control'],
  ['--remote-control=my-title'],
  ['--remote-control', 'my-title'],
  ['--rc'],
  ['--rc=my-title'],
  ['--verbose', '--rc'],
];

/** Extra arguments that are not Remote Control's switch, taken on a Claude session. */
const ACCEPTED = [
  ['--remote-control-session-name-prefix', 'fleet'],
  ['--remote-control-session-name-prefix=fleet'],
];

const asExtraArgs = (args) => args.map((arg) => `--extra-arg=${arg}`);

/** A run of `obk` that must go through. */
async function ok(box, args, options) {
  const result = await box.run(args, options);
  assert.equal(result.code, 0, `obk ${args.join(' ')} should have gone through:\n${result.stdout}${result.stderr}`);
  return result;
}

/** Bot Father, claude-bot, codex-bot and pi-bot, each with a daily session. */
async function fleet(box) {
  await fakePi(box);
  await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);
  for (const harness of ['claude', 'codex', 'pi']) {
    await ok(box, ['bot', 'create', '--bots', 'bots', '--name', `${harness}-bot`, '--harness', harness]);
    await ok(box, ['session', 'add', '--bots', 'bots', '--bot', `${harness}-bot`, '--name', 'daily']);
  }
  return box.path('bots');
}

const sessionAdd = (box, bot, name, ...rest) => box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', name, ...rest]);
const sessionChange = (box, bot, ...rest) => box.run(['session', 'change', '--bots', 'bots', '--bot', bot, '--session', 'daily', ...rest]);

/** One session's entry in a bot's bot.yaml. */
async function entryOf(bots, bot, name) {
  const doc = parse(await readFile(botYamlOf(bots, bot), 'utf8'));
  return doc.sessions.find((one) => one.name === name);
}

/** A refusal that names the setting as the road, and leaves the bots folder as it was. */
async function assertRefusedUntouched(result, bots, before) {
  assertRefused(result, POINTER);
  assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
}

// ------------------------------------------------------------- session add

test('RX1 session add refuses --remote-control and --rc as an extra argument of a Claude session, names --remote-control on|off, and writes nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const before = await snapshot(bots, skipGit);

  for (const [at, args] of REFUSED.entries()) {
    await t.test(args.join(' '), async () => {
      await assertRefusedUntouched(await sessionAdd(box, 'claude-bot', `review-${at}`, ...asExtraArgs(args)), bots, before);
    });
  }
});

test('RX1 session add judges the session\'s own harness: --harness claude on a Codex bot is refused too', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const before = await snapshot(bots, skipGit);

  await assertRefusedUntouched(await sessionAdd(box, 'codex-bot', 'review', '--harness', 'claude', '--extra-arg=--rc'), bots, before);
});

test('RX1 session add with --remote-control off and --extra-arg=--remote-control is refused too: the setting does not make the argument allowed', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const before = await snapshot(bots, skipGit);

  await assertRefusedUntouched(await sessionAdd(box, 'claude-bot', 'review', '--remote-control', 'off', '--extra-arg=--remote-control'), bots, before);
});

for (const args of ACCEPTED) {
  test(`RX2 session add takes ${args.join(' ')} as an extra argument of a Claude session`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);

    const result = await sessionAdd(box, 'claude-bot', 'review', ...asExtraArgs(args));

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    assert.deepEqual((await entryOf(bots, 'claude-bot', 'review')).extra_args, args);
  });
}

for (const harness of ['codex', 'pi']) {
  test(`RX3 session add of a ${harness} session does not judge --rc or --remote-control by this rule`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);

    for (const [at, args] of [['--rc'], ['--remote-control']].entries()) {
      const result = await sessionAdd(box, `${harness}-bot`, `review-${at}`, ...asExtraArgs(args));
      assert.equal(result.code, 0, `${args.join(' ')}: ${result.stdout}${result.stderr}`);
      assert.deepEqual((await entryOf(bots, `${harness}-bot`, `review-${at}`)).extra_args, args);
    }
  });
}

// ------------------------------------------------------------- session change

test('RX1 session change refuses --remote-control and --rc as an extra argument of a Claude session, names --remote-control on|off, and writes nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const before = await snapshot(bots, skipGit);

  for (const args of REFUSED) {
    await t.test(args.join(' '), async () => {
      await assertRefusedUntouched(await sessionChange(box, 'claude-bot', ...asExtraArgs(args)), bots, before);
    });
  }
});

test('RX2 session change takes --remote-control-session-name-prefix as an extra argument of a Claude session', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);

  const result = await sessionChange(box, 'claude-bot', ...asExtraArgs(ACCEPTED[0]));

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.deepEqual((await entryOf(bots, 'claude-bot', 'daily')).extra_args, ACCEPTED[0]);
});

test('RX3 session change of a Codex session does not judge --rc by this rule', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);

  const result = await sessionChange(box, 'codex-bot', '--extra-arg=--rc');

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.deepEqual((await entryOf(bots, 'codex-bot', 'daily')).extra_args, ['--rc']);
});

// ------------------------------------------------------------- temp make

/** claude-bot's daily, brought up, as the maker: its tab in the fake Orca. */
async function makerTab(box, bots) {
  await ok(box, ['up', '--bots', 'bots', '--bot', 'claude-bot']);
  const entry = await sessionIn(bots, 'claude-bot', 'daily');
  const terminal = (await tabsOfBot(box, bots, 'claude-bot')).find((one) => one.tabId === entry?.tab);
  assert.ok(terminal, `the premise: claude-bot's daily has a tab, got: ${JSON.stringify(entry)}`);
  return terminal;
}

const make = (box, terminal, args) => box.run(['temp', 'make', '--bots', 'bots', ...args], { env: inTab(box, terminal) });

/** What a refused make must leave as it was: the bots folder and Orca's tabs. */
const worldOf = async (box, bots) => ({ files: await snapshot(bots, skipGit), terminals: await box.orca.terminals() });

test('RX1 temp make refuses --remote-control and --rc as an extra argument of a Claude temp, names --remote-control on|off, and makes nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const lead = await makerTab(box, bots);
  const before = await worldOf(box, bots);
  const from = (await box.orca.calls()).length;

  for (const [at, args] of REFUSED.entries()) {
    await t.test(args.join(' '), async () => {
      const result = await make(box, lead, ['--name', `scout-${at}`, '--prompt', TASK, ...asExtraArgs(args)]);

      assertRefused(result, POINTER);
      assert.deepEqual(await worldOf(box, bots), before, 'bot.yaml, the book and Orca are as they were');
      assert.deepEqual(orcaCallsOf((await box.orca.calls()).slice(from), 'terminal create'), [], 'no tab was opened');
    });
  }
});

test('RX2 temp make takes --remote-control-session-name-prefix as an extra argument of a Claude temp', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const lead = await makerTab(box, bots);

  const result = await make(box, lead, ['--name', 'scout', '--prompt', TASK, ...asExtraArgs(ACCEPTED[1])]);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.deepEqual((await entryOf(bots, 'claude-bot', 'scout')).extra_args, ACCEPTED[1]);
});

test('RX3 temp make of a Codex temp does not judge --rc by this rule', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const lead = await makerTab(box, bots);

  const result = await make(box, lead, ['--name', 'scout', '--prompt', TASK, '--harness', 'codex', '--extra-arg=--rc']);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.deepEqual((await entryOf(bots, 'claude-bot', 'scout')).extra_args, ['--rc']);
});
