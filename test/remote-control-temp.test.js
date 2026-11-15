// A temporary session's Remote Control (#755, R1), sections 1 and 4 of the test
// brief for `obk temp make`.
//
// R1, as the owner signed it: "Every Claude Code session that the kit starts,
// temporary sessions included, MUST start with Claude Code's Remote Control on,
// unless the user set it off for that session."
//
// As decided on #755:
//
//   RT1  `obk temp make` takes `--remote-control on|off`. With no flag, a
//        Claude temporary session takes its maker's `remote_control` when the
//        maker runs on Claude. Otherwise it gets nothing, so it is on by the
//        kit's default.
//   RT2  The report and the JSON `chosen` carry it like the other inherited
//        settings: key `remote_control`; from `flag` (the text line says
//        `from --remote-control`), from `maker`, or `kit default` with the
//        value `on`.
//   RT3  The temp's entry in bot.yaml holds `remote_control` only when it
//        came from the flag or the maker.
//   RT4  A temporary session on Codex or Pi has no `remote_control` in
//        `chosen`, and `--remote-control` on such a temp make is refused.
//   RT5  A bad value is refused, with the values on and off named.
//   RT6  The launch line of a Claude temp is on or off as its setting says
//        (test/remote-control-launch.test.js holds the line itself), and the
//        temp make report says so in the line of each launched Claude tab
//        (test/remote-control-report.test.js holds the words for up).
//
// Every run is in the sandbox (helpers/cli.js): its own HOME, a fake Orca and
// fake harnesses on its own PATH. `temp make` runs in the maker's own tab.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import {
  assertRefused,
  createSandbox,
  fakeProgram,
  orcaCallsOf,
  sessionIn,
  sh,
  skipGit,
  snapshot,
  tabsOfBot,
  typedInto,
} from './helpers/cli.js';
import { fakePi } from './helpers/pi.js';
import { botYamlOf } from './helpers/skills.js';
import { answerIn, inTab, TASK } from './helpers/temp-roles.js';

const BOT = 'temp-bot';
const RC = '--remote-control';
const OFF_KEY = 'disableRemoteControl';

/** The report line of a launched Claude tab, as section 4 of the brief words it. */
const REPORT = {
  default: "             remote control: on, the kit's default (--remote-control is on the launch line)",
  on: '             remote control: on, set for this session (--remote-control is on the launch line)',
  off: "             remote control: off, set for this session (the kit's --settings turns it off)",
};

/** A run of `obk` that must go through. */
async function ok(box, args, options) {
  const result = await box.run(args, options);
  assert.equal(result.code, 0, `obk ${args.join(' ')} should have gone through:\n${result.stdout}${result.stderr}`);
  return result;
}

/**
 * Bot Father, and temp-bot on Claude Code with two makers brought up: lead on
 * the bot's Claude, with `lead` keys written into its entry by hand, and
 * nightly on Codex.
 */
async function fleet(box, { lead = {} } = {}) {
  await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(box, ['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  await ok(box, ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'lead', '--prompt', 'You lead the work on the API.']);
  await ok(box, ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'nightly', '--harness', 'codex', '--prompt', 'You watch the nightly build.']);
  const bots = box.path('bots');
  if (Object.keys(lead).length > 0) {
    const file = botYamlOf(bots, BOT);
    const doc = parse(await readFile(file, 'utf8'));
    doc.sessions = doc.sessions.map((one) => (one.name === 'lead' ? { ...one, ...lead } : one));
    await writeFile(file, stringify(doc));
  }
  await ok(box, ['up', '--bots', 'bots', '--bot', BOT]);
  return { bots, lead: await tabOf(box, bots, 'lead'), nightly: await tabOf(box, bots, 'nightly') };
}

/** The tab the book gives one of temp-bot's sessions, as the fake Orca has it. */
async function tabOf(box, bots, name) {
  const entry = await sessionIn(bots, BOT, name);
  const terminal = (await tabsOfBot(box, bots, BOT)).find((one) => one.tabId === entry?.tab);
  assert.ok(terminal, `${BOT}/${name} should have a tab, got: ${JSON.stringify(entry)}`);
  return terminal;
}

const make = (box, terminal, args) => box.run(['temp', 'make', '--bots', 'bots', ...args], { env: inTab(box, terminal) });

/** `temp make` that must work. */
async function made(box, terminal, args) {
  const result = await make(box, terminal, args);
  assert.equal(result.code, 0, `obk temp make ${args.join(' ')} should have worked:\n${result.stdout}${result.stderr}`);
  return result;
}

/** One session's entry in temp-bot's bot.yaml. */
async function entryOf(bots, name) {
  const doc = parse(await readFile(botYamlOf(bots, BOT), 'utf8'));
  const found = (doc.sessions ?? []).filter((one) => one?.name === name);
  assert.equal(found.length, 1, `one session should be called ${name}, got: ${JSON.stringify(doc.sessions)}`);
  return found[0];
}

/** The argv the launch line of `name` hands the fake harness. */
async function argvOf(box, bots, name, harness = 'claude') {
  const [line] = typedInto(await tabOf(box, bots, name));
  const fake = await fakeProgram(box, harness, {});
  const from = (await fake.calls()).length;
  const ran = await sh(line, { cwd: box.cwd, env: box.env });
  assert.equal(ran.code, 0, `the line should run: ${line}\n${ran.stderr}`);
  const calls = (await fake.calls()).slice(from);
  assert.equal(calls.length, 1, `the line should start the harness once: ${line}`);
  return calls[0].args;
}

/** The JSON of the kit's own `--settings` among the options, or undefined when there is none. */
function settingsJsonIn(argv) {
  const flags = argv.includes('--') ? argv.slice(0, argv.indexOf('--')) : argv;
  const at = flags.indexOf('--settings');
  return at < 0 ? undefined : JSON.parse(flags[at + 1]);
}

/** The `remote_control` line of the temp make report, from `<value>, from <source>`. */
const chosenLine = (value, from) => new RegExp(`^remote[_ ]control\\s+${value}, from ${from}\\s*$`, 'm');

/** What a refused make must leave as it was: the bots folder and Orca's tabs. */
const worldOf = async (box, bots) => ({ files: await snapshot(bots, skipGit), terminals: await box.orca.terminals() });

// ------------------------------------------------------------- RT1, RT2, RT3 inheritance

test('RT1 a Claude temp of a Claude maker with no setting, no flag: on from the kit default, nothing in bot.yaml, --remote-control on its line', async (t) => {
  const box = await createSandbox(t);
  const { bots, lead } = await fleet(box);

  const result = await made(box, lead, ['--name', 'scout', '--prompt', TASK, '--json']);

  assert.deepEqual(answerIn(result).chosen.remote_control, { value: 'on', from: 'kit default' }, `got: ${result.stdout}`);
  assert.equal('remote_control' in await entryOf(bots, 'scout'), false, 'the kit default is not written into bot.yaml');
  const argv = await argvOf(box, bots, 'scout');
  assert.equal(argv[0], RC, `temporary sessions included: --remote-control first, got: ${JSON.stringify(argv)}`);
  assert.ok(argv[1].startsWith('-'), 'a flag after it');
});

test('RT2 the plain report of that make says remote_control on, from the kit default', async (t) => {
  const box = await createSandbox(t);
  const { lead } = await fleet(box);

  const result = await made(box, lead, ['--name', 'scout', '--prompt', TASK]);

  assert.match(result.stdout, chosenLine('on', 'the kit default'), `got:\n${result.stdout}`);
});

test('RT1 a Claude temp of a Claude maker set off, no flag: off from the maker, written into bot.yaml, and off on its line', async (t) => {
  const box = await createSandbox(t);
  const { bots, lead } = await fleet(box, { lead: { remote_control: 'off' } });

  const result = await made(box, lead, ['--name', 'scout', '--prompt', TASK, '--json']);

  assert.deepEqual(answerIn(result).chosen.remote_control, { value: 'off', from: 'maker' }, `got: ${result.stdout}`);
  assert.equal((await entryOf(bots, 'scout')).remote_control, 'off');
  const argv = await argvOf(box, bots, 'scout');
  assert.ok(!argv.includes(RC), `off, so no --remote-control, got: ${JSON.stringify(argv)}`);
  assert.equal(settingsJsonIn(argv)?.[OFF_KEY], true, `the kit's --settings turns it off, got: ${JSON.stringify(argv)}`);
});

test('RT2 the plain report of a make from a maker set off says remote_control off, from the maker', async (t) => {
  const box = await createSandbox(t);
  const { lead } = await fleet(box, { lead: { remote_control: 'off' } });

  const result = await made(box, lead, ['--name', 'scout', '--prompt', TASK]);

  assert.match(result.stdout, chosenLine('off', 'the maker'), `got:\n${result.stdout}`);
});

test('RT1 a Claude temp of a Claude maker set on, no flag: on from the maker, written into bot.yaml', async (t) => {
  const box = await createSandbox(t);
  const { bots, lead } = await fleet(box, { lead: { remote_control: 'on' } });

  const result = await made(box, lead, ['--name', 'scout', '--prompt', TASK, '--json']);

  assert.deepEqual(answerIn(result).chosen.remote_control, { value: 'on', from: 'maker' }, `got: ${result.stdout}`);
  assert.equal((await entryOf(bots, 'scout')).remote_control, 'on');
});

test('RT1 --remote-control off on a temp of a maker with no setting: off from the flag, written into bot.yaml, and the text says from --remote-control', async (t) => {
  const box = await createSandbox(t);
  const { bots, lead } = await fleet(box);

  const asJson = await made(box, lead, ['--name', 'scout', '--prompt', TASK, '--remote-control', 'off', '--json']);
  const plain = await made(box, lead, ['--name', 'scout-two', '--prompt', TASK, '--remote-control', 'off']);

  assert.deepEqual(answerIn(asJson).chosen.remote_control, { value: 'off', from: 'flag' }, `got: ${asJson.stdout}`);
  assert.equal((await entryOf(bots, 'scout')).remote_control, 'off');
  assert.match(plain.stdout, chosenLine('off', '--remote-control'), `got:\n${plain.stdout}`);
  assert.ok(!(await argvOf(box, bots, 'scout')).includes(RC));
});

test('RT1 --remote-control on wins over a maker set off: on from the flag, written into bot.yaml, and on on its line', async (t) => {
  const box = await createSandbox(t);
  const { bots, lead } = await fleet(box, { lead: { remote_control: 'off' } });

  const result = await made(box, lead, ['--name', 'scout', '--prompt', TASK, '--remote-control', 'on', '--json']);

  assert.deepEqual(answerIn(result).chosen.remote_control, { value: 'on', from: 'flag' }, `got: ${result.stdout}`);
  assert.equal((await entryOf(bots, 'scout')).remote_control, 'on');
  const argv = await argvOf(box, bots, 'scout');
  assert.equal(argv[0], RC, `got: ${JSON.stringify(argv)}`);
  assert.equal(settingsJsonIn(argv)?.[OFF_KEY], undefined, `no disableRemoteControl for an on session, got: ${JSON.stringify(argv)}`);
});

test('RT1 a Claude temp of a Codex maker gets nothing from it: on from the kit default, nothing in bot.yaml', async (t) => {
  const box = await createSandbox(t);
  const { bots, nightly } = await fleet(box);

  const result = await made(box, nightly, ['--name', 'scout', '--prompt', TASK, '--harness', 'claude', '--json']);

  assert.deepEqual(answerIn(result).chosen.remote_control, { value: 'on', from: 'kit default' }, `got: ${result.stdout}`);
  assert.equal('remote_control' in await entryOf(bots, 'scout'), false);
  assert.equal((await argvOf(box, bots, 'scout'))[0], RC);
});

// ------------------------------------------------------------- RT4 Codex and Pi temps

test('RT4 a Codex temp of a Claude maker set off: no remote_control in chosen or in bot.yaml, and its line is Codex\'s own', async (t) => {
  const box = await createSandbox(t);
  const { bots, lead } = await fleet(box, { lead: { remote_control: 'off' } });

  const asJson = await made(box, lead, ['--name', 'scout', '--prompt', TASK, '--harness', 'codex', '--json']);
  const plain = await made(box, lead, ['--name', 'scout-two', '--prompt', TASK, '--harness', 'codex']);

  assert.equal('remote_control' in answerIn(asJson).chosen, false, `got: ${asJson.stdout}`);
  assert.equal('remote_control' in await entryOf(bots, 'scout'), false, 'nothing of the maker\'s Remote Control on a Codex temp');
  assert.doesNotMatch(plain.stdout, /remote[_ ]control/i, `got:\n${plain.stdout}`);
  const [line] = typedInto(await tabOf(box, bots, 'scout'));
  assert.ok(!line.includes(RC) && !line.includes(OFF_KEY), `got: ${line}`);
});

for (const harness of ['codex', 'pi']) {
  test(`RT4 temp make --harness ${harness} --remote-control off is refused: Remote Control is a Claude Code setting; nothing is made`, async (t) => {
    const box = await createSandbox(t);
    if (harness === 'pi') await fakePi(box);
    const { bots, lead } = await fleet(box);
    const before = await worldOf(box, bots);
    const from = (await box.orca.calls()).length;

    const result = await make(box, lead, ['--name', 'scout', '--prompt', TASK, '--harness', harness, '--remote-control', 'off']);

    assertRefused(result);
    const said = `${result.stdout}${result.stderr}`;
    assert.match(said, /Remote Control/, `got:\n${said}`);
    assert.match(said, /Claude Code/, `got:\n${said}`);
    assert.deepEqual(await worldOf(box, bots), before, 'bot.yaml, the book and Orca are as they were');
    assert.deepEqual(orcaCallsOf((await box.orca.calls()).slice(from), 'terminal create'), [], 'no tab was opened');
  });
}

// ------------------------------------------------------------- RT5 a bad value

for (const value of ['true', 'yes', 'maybe']) {
  test(`RT5 temp make --remote-control ${value} is refused, names on and off, and makes nothing`, async (t) => {
    const box = await createSandbox(t);
    const { bots, lead } = await fleet(box);
    const before = await worldOf(box, bots);

    const result = await make(box, lead, ['--name', 'scout', '--prompt', TASK, '--remote-control', value]);

    assertRefused(result);
    assert.match(`${result.stdout}${result.stderr}`, /\bon\b[^.\n]{0,12}\boff\b/, `the values are named, got:\n${result.stdout}${result.stderr}`);
    assert.deepEqual(await worldOf(box, bots), before);
  });
}

// ------------------------------------------------------------- RT6 the launch report of temp make

test('RT6 the temp make report says, under the temp\'s tab, that Remote Control is on by the kit\'s default; its JSON tab entry says so too', async (t) => {
  const box = await createSandbox(t);
  const { lead } = await fleet(box);

  const plain = await made(box, lead, ['--name', 'scout', '--prompt', TASK]);
  const asJson = await made(box, lead, ['--name', 'scout-two', '--prompt', TASK, '--json']);

  assert.ok(plain.stdout.split('\n').includes(REPORT.default), `got:\n${plain.stdout}`);
  const tab = answerIn(asJson).tabs.find((one) => one.name === 'scout-two');
  assert.deepEqual(tab?.remote_control, { value: 'on', from: 'kit default' }, `got: ${asJson.stdout}`);
});

test('RT6 the temp make report of a temp off from its maker says off, set for this session; its JSON says from the session', async (t) => {
  const box = await createSandbox(t);
  const { lead } = await fleet(box, { lead: { remote_control: 'off' } });

  const plain = await made(box, lead, ['--name', 'scout', '--prompt', TASK]);
  const asJson = await made(box, lead, ['--name', 'scout-two', '--prompt', TASK, '--json']);

  assert.ok(plain.stdout.split('\n').includes(REPORT.off), `got:\n${plain.stdout}`);
  const tab = answerIn(asJson).tabs.find((one) => one.name === 'scout-two');
  assert.deepEqual(tab?.remote_control, { value: 'off', from: 'session' }, `got: ${asJson.stdout}`);
});

test('RT6 the temp make report of a temp on from the flag says on, set for this session', async (t) => {
  const box = await createSandbox(t);
  const { lead } = await fleet(box);

  const plain = await made(box, lead, ['--name', 'scout', '--prompt', TASK, '--remote-control', 'on']);

  assert.ok(plain.stdout.split('\n').includes(REPORT.on), `got:\n${plain.stdout}`);
});
