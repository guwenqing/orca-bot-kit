// The launch report says what the kit put on the line for Remote Control
// (#755), section 4 of the test brief, for `up`, `restart` and `unpause`.
// `temp make` is test/remote-control-temp.test.js (RT6).
//
// As decided on #755:
//
//   RR1  For each Claude tab that the run launched (the tabs that get the
//        lines about the harness in the report), one line, indented like the
//        others (13 spaces):
//          remote control: on, the kit's default (--remote-control is on the launch line)
//          remote control: on, set for this session (--remote-control is on the launch line)
//          remote control: off, set for this session (the kit's --settings turns it off)
//        off with its own --settings:
//          remote control: off was asked for this session, but its own --settings replaces the kit's, so Claude Code's own settings decide
//        on with a hand-written --remote-control or --rc in extra_args:
//          remote control: on, by its own extra argument in bot.yaml
//   RR2  The JSON tab entry of such a tab gets
//        `remote_control: { value: 'on'|'off', from: 'session'|'kit default' }`,
//        and a Codex or Pi tab gets nothing.
//   RR3  A tab the run found open and did not launch gets no line and no key.
//
// Whether the session then connected is not the report's to say: that is
// `obk health` (test/remote-control-health.test.js).
//
// Every run is in the sandbox (helpers/cli.js): its own HOME, a fake Orca and
// fake harnesses on its own PATH.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import {
  botHomeOf,
  conversationOnRecord,
  createSandbox,
  recordSession,
  sessionIn,
} from './helpers/cli.js';
import { botYamlOf } from './helpers/skills.js';

const BOT = 'api-bot';
const PAD = ' '.repeat(13);

const LINE = {
  default: `${PAD}remote control: on, the kit's default (--remote-control is on the launch line)`,
  on: `${PAD}remote control: on, set for this session (--remote-control is on the launch line)`,
  off: `${PAD}remote control: off, set for this session (the kit's --settings turns it off)`,
  lost: `${PAD}remote control: off was asked for this session, but its own --settings replaces the kit's, so Claude Code's own settings decide`,
  own: `${PAD}remote control: on, by its own extra argument in bot.yaml`,
};

/** A run of `obk` that must go through. */
async function ok(box, args, options) {
  const result = await box.run(args, options);
  assert.equal(result.code, 0, `obk ${args.join(' ')} should have gone through:\n${result.stdout}${result.stderr}`);
  return result;
}

/**
 * Bot Father and api-bot on Claude Code with the sessions named, each
 * `[name, keys]`: `keys` are written into its entry in bot.yaml by hand.
 * Nothing of api-bot is up yet.
 */
async function fleetIn(box, sessions) {
  await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(box, ['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  for (const [name] of sessions) await ok(box, ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', name, '--prompt', 'Keep the queue moving.']);
  const bots = box.path('bots');
  const file = botYamlOf(bots, BOT);
  const doc = parse(await readFile(file, 'utf8'));
  const keysOf = Object.fromEntries(sessions);
  doc.sessions = doc.sessions.map((one) => ({ ...one, ...(keysOf[one.name] ?? {}) }));
  await writeFile(file, stringify(doc));
  return bots;
}

/** api-bot's `<command>`, plain and as JSON. */
const run = (box, command, json, flags = []) => ok(box, [command, '--bots', 'bots', '--bot', BOT, ...flags, ...(json ? ['--json'] : [])]);

/** The answer of a `--json` run. */
function answerOf(result) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
}

/** The JSON tab entry of one of api-bot's sessions. */
function tabOf(answer, name) {
  const found = (answer.tabs ?? []).filter((one) => one.bot === BOT && one.name === name);
  assert.equal(found.length, 1, `one tab entry for ${BOT} ${name}, got: ${JSON.stringify(answer.tabs)}`);
  return found[0];
}

/**
 * The lines of the plain report under one tab: from its `opened` line, which
 * names the tab's id, up to the next line that does not start with blanks.
 */
function blockOf(stdout, tabId) {
  const lines = stdout.split('\n');
  const at = lines.findIndex((line) => line.startsWith('opened') && line.includes(`tab ${tabId} `));
  assert.ok(at >= 0, `the report should have an opened line for tab ${tabId}, got:\n${stdout}`);
  const end = lines.findIndex((line, index) => index > at && !line.startsWith(' '));
  return lines.slice(at + 1, end < 0 ? undefined : end);
}

/** The lines of a report about Remote Control. */
const remoteLines = (stdout) => stdout.split('\n').filter((line) => /remote control/i.test(line));

/** The plain report holds `line` once, under the tab of `name`. */
async function assertUnderTab(result, bots, name, line) {
  const tab = (await sessionIn(bots, BOT, name))?.tab;
  const block = blockOf(result.stdout, tab);
  assert.deepEqual(block.filter((one) => /remote control/i.test(one)), [line], `under ${name}'s tab, one line about Remote Control, got:\n${block.join('\n')}`);
}

// ------------------------------------------------------------- RR1, RR2 up

for (const [label, keys, line, json] of [
  ['no setting: the kit\'s default', {}, LINE.default, { value: 'on', from: 'kit default' }],
  ['remote_control: on', { remote_control: 'on' }, LINE.on, { value: 'on', from: 'session' }],
  ['remote_control: off', { remote_control: 'off' }, LINE.off, { value: 'off', from: 'session' }],
  ['remote_control: off and its own --settings', { remote_control: 'off', extra_args: ['--settings', '/srv/my-settings.json'] }, LINE.lost, { value: 'off', from: 'session' }],
]) {
  test(`RR1 up of a Claude session with ${label}: one line under its tab says so`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box, [['daily', keys]]);

    const result = await run(box, 'up', false);

    await assertUnderTab(result, bots, 'daily', line);
  });

  test(`RR2 up --json of a Claude session with ${label}: its tab entry carries remote_control ${JSON.stringify(json)}`, async (t) => {
    const box = await createSandbox(t);
    await fleetIn(box, [['daily', keys]]);

    const answer = answerOf(await run(box, 'up', true));

    assert.deepEqual(tabOf(answer, 'daily').remote_control, json);
  });
}

for (const [label, extra] of [['--remote-control', ['--remote-control']], ['--rc=<name>', ['--rc=my-title']]]) {
  test(`RR1 up of a Claude session with its own ${label} in bot.yaml: the line says on, by its own extra argument`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box, [['daily', { extra_args: extra }]]);

    const plain = await run(box, 'up', false);

    await assertUnderTab(plain, bots, 'daily', LINE.own);
  });
}

test('RR2 up --json of a Claude session with its own --rc in bot.yaml: its tab entry says on', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box, [['daily', { extra_args: ['--rc'] }]]);

  const answer = answerOf(await run(box, 'up', true));

  assert.equal(tabOf(answer, 'daily').remote_control?.value, 'on', `got: ${JSON.stringify(tabOf(answer, 'daily'))}`);
});

test('RR1 up of three sessions, on, off and the kit\'s default: one line under each tab, each its own', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box, [['daily', {}], ['nightly', { remote_control: 'off' }], ['review', { remote_control: 'on' }]]);

  const result = await run(box, 'up', false);

  await assertUnderTab(result, bots, 'daily', LINE.default);
  await assertUnderTab(result, bots, 'nightly', LINE.off);
  await assertUnderTab(result, bots, 'review', LINE.on);
  assert.equal(remoteLines(result.stdout).length, 3, `one line for each launched tab, got:\n${result.stdout}`);
});

/** Bot Father and api-bot on Codex, with daily on the bot's Codex and review on Claude Code. */
async function mixedFleet(box) {
  await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(box, ['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'codex']);
  await ok(box, ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily']);
  await ok(box, ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'review', '--harness', 'claude']);
}

test('RR1 a Codex tab gets no line about Remote Control, beside a Claude tab that does', async (t) => {
  const box = await createSandbox(t);
  await mixedFleet(box);

  const plain = await run(box, 'up', false);

  const lines = remoteLines(plain.stdout);
  assert.deepEqual(lines, [LINE.default], `the Claude tab's line alone, got:\n${plain.stdout}`);
});

test('RR2 a Codex tab gets no remote_control in its JSON entry, beside a Claude tab that does', async (t) => {
  const box = await createSandbox(t);
  await mixedFleet(box);

  const answer = answerOf(await run(box, 'up', true));

  assert.equal('remote_control' in tabOf(answer, 'daily'), false, `got: ${JSON.stringify(tabOf(answer, 'daily'))}`);
  assert.deepEqual(tabOf(answer, 'review').remote_control, { value: 'on', from: 'kit default' }, 'the presence beside it');
});

// ------------------------------------------------------------- RR3 a tab found, not launched

test('RR3 a second up finds the tab open and launches nothing: no line about Remote Control and no remote_control key', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box, [['daily', { remote_control: 'off' }]]);
  const first = answerOf(await run(box, 'up', true));
  assert.deepEqual(tabOf(first, 'daily').remote_control, { value: 'off', from: 'session' }, 'the premise: the first up launched it');

  const plain = await run(box, 'up', false);
  const again = answerOf(await run(box, 'up', true));

  assert.deepEqual(remoteLines(plain.stdout), [], `got:\n${plain.stdout}`);
  assert.equal('remote_control' in tabOf(again, 'daily'), false, `got: ${JSON.stringify(tabOf(again, 'daily'))}`);
});

// ------------------------------------------------------------- restart and unpause

/** daily up once, with a conversation the book holds and Claude Code has on record: what restart and unpause resume. */
async function running(box, bots) {
  await run(box, 'up', true);
  const tab = (await sessionIn(bots, BOT, 'daily')).tab;
  const heard = await recordSession(box, { bots, bot: BOT, tab, session: 'sess-daily' });
  assert.equal(heard.code, 0, heard.stderr);
  await conversationOnRecord(box, { harness: 'claude', cwd: botHomeOf(bots, BOT), id: 'sess-daily' });
}

for (const [label, keys, line, json] of [
  ['no setting', {}, LINE.default, { value: 'on', from: 'kit default' }],
  ['remote_control: off', { remote_control: 'off' }, LINE.off, { value: 'off', from: 'session' }],
]) {
  test(`RR1 restart of a Claude session with ${label}: the new tab's block says so, and its JSON entry carries remote_control`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box, [['daily', keys]]);
    await running(box, bots);

    const plain = await run(box, 'restart', false, ['--session', 'daily']);
    await assertUnderTab(plain, bots, 'daily', line);
    const answer = answerOf(await run(box, 'restart', true, ['--session', 'daily']));

    assert.deepEqual(tabOf(answer, 'daily').remote_control, json);
  });

  test(`RR1 unpause of a Claude session with ${label}: the new tab's block says so, and its JSON entry carries remote_control`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box, [['daily', keys]]);
    await running(box, bots);
    await ok(box, ['pause', '--bots', 'bots', '--bot', BOT]);

    const plain = await run(box, 'unpause', false);
    await assertUnderTab(plain, bots, 'daily', line);
    await ok(box, ['pause', '--bots', 'bots', '--bot', BOT]);
    const answer = answerOf(await run(box, 'unpause', true));

    assert.deepEqual(tabOf(answer, 'daily').remote_control, json);
  });
}
