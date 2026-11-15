// The session setting `remote_control` (#755, R1), section 1 of the test brief.
//
// R1, as the owner signed it: "Every Claude Code session that the kit starts,
// temporary sessions included, MUST start with Claude Code's Remote Control on,
// unless the user set it off for that session. ... Codex and Pi sessions do not
// change."
//
// The setting, as decided on #755:
//
//   RS1  `remote_control` in a session's entry in bot.yaml, `on` or `off`, as
//        YAML strings. Absent is on, the kit's default.
//   RS2  Any other value (true, false, yes, a number, any other text) is a
//        session trouble: `obk up` refuses that session with a message that
//        names the session and says the values are on and off.
//   RS3  On a session that runs on Codex or Pi, `remote_control` is a session
//        trouble: the message says that Remote Control is a Claude Code
//        setting, and tells the user to leave it out.
//   RS4  `obk session add` and `obk session change` take `--remote-control
//        on|off`. `session change --remote-control=` takes the key out. A bad
//        value, or a session that is not on Claude Code, is refused, and
//        nothing is written.
//   RS5  `obk --help` names `--remote-control on|off` for session add, session
//        change and temp make.
//
// The launch line is test/remote-control-launch.test.js; temp make is
// test/remote-control-temp.test.js.
//
// Every run is in the sandbox (helpers/cli.js): its own HOME, a fake Orca and
// fake harnesses on its own PATH.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import {
  assertRefused,
  createSandbox,
  skipGit,
  snapshot,
  tabsOfBot,
} from './helpers/cli.js';
import { fakePi } from './helpers/pi.js';
import { botYamlOf } from './helpers/skills.js';

const BOT = 'api-bot';

/** A bots folder with Bot Father and api-bot on `harness`, with no session yet. */
async function withBot(box, { harness = 'claude' } = {}) {
  if (harness === 'pi') await fakePi(box);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', harness]);
  assert.equal(made.code, 0, `${made.stdout}${made.stderr}`);
  return box.path('bots');
}

const sessionAdd = (box, name, ...rest) => box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', name, ...rest]);
const sessionChange = (box, name, ...rest) => box.run(['session', 'change', '--bots', 'bots', '--bot', BOT, '--session', name, ...rest]);

/** One session's entry in api-bot's bot.yaml, as written. */
async function entryOf(bots, name) {
  const doc = parse(await readFile(botYamlOf(bots, BOT), 'utf8'));
  const found = (doc.sessions ?? []).filter((one) => one?.name === name);
  assert.equal(found.length, 1, `one session should be called ${name}, got: ${JSON.stringify(doc.sessions)}`);
  return found[0];
}

/** Set keys of one session's entry in bot.yaml by hand, as a user edits the file. */
async function handSet(bots, name, keys) {
  const file = botYamlOf(bots, BOT);
  const doc = parse(await readFile(file, 'utf8'));
  doc.sessions = doc.sessions.map((one) => (one.name === name ? { ...one, ...keys } : one));
  await writeFile(file, stringify(doc));
}

/** The words of a refusal of a bad value: the two values, together. */
const NAMES_ON_AND_OFF = /\bon\b[^.\n]{0,12}\boff\b/;

/** A refusal that says Remote Control is Claude Code's, and to leave the setting out. */
function assertClaudeOnly(result) {
  assertRefused(result);
  const said = `${result.stdout}${result.stderr}`;
  assert.match(said, /Remote Control/, `the refusal names Remote Control, got:\n${said}`);
  assert.match(said, /Claude Code/, `the refusal says Remote Control is a Claude Code setting, got:\n${said}`);
  assert.match(said, /leave [^.\n]*out/i, `the refusal tells the user to leave it out, got:\n${said}`);
}

/** A refusal of a value that is neither on nor off: it names the values. */
function assertBadValue(result, ...named) {
  assertRefused(result, ...named);
  const said = `${result.stdout}${result.stderr}`;
  assert.match(said, NAMES_ON_AND_OFF, `the refusal says the values are on and off, got:\n${said}`);
}

// ------------------------------------------------------------- RS4 session add

for (const value of ['on', 'off']) {
  test(`RS4 session add --remote-control ${value} writes remote_control: ${value} into bot.yaml, as a string`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);

    const result = await sessionAdd(box, 'daily', '--remote-control', value);

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    const entry = await entryOf(bots, 'daily');
    assert.equal(entry.remote_control, value, `got: ${JSON.stringify(entry)}`);
    assert.equal(typeof entry.remote_control, 'string', 'the value is a YAML string, not a boolean');
  });
}

test('RS1 session add with no --remote-control writes no remote_control: absent is on, the kit\'s default', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);

  const result = await sessionAdd(box, 'daily');

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.equal('remote_control' in await entryOf(bots, 'daily'), false);
});

for (const value of ['true', 'false', 'yes', 'no', '1', 'maybe', 'enabled']) {
  test(`RS4 session add --remote-control ${value} is refused, names on and off, and writes nothing`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    const before = await snapshot(bots, skipGit);

    const result = await sessionAdd(box, 'daily', '--remote-control', value);

    assertBadValue(result);
    assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
  });
}

for (const [label, harness, extra] of [
  ['a Codex bot', 'codex', []],
  ['a Claude bot, the session on --harness codex', 'claude', ['--harness', 'codex']],
  ['a Pi bot', 'pi', []],
  ['a Claude bot, the session on --harness pi', 'claude', ['--harness', 'pi']],
]) {
  for (const value of ['on', 'off']) {
    test(`RS3 session add --remote-control ${value} on ${label} is refused: Remote Control is a Claude Code setting; nothing is written`, async (t) => {
      const box = await createSandbox(t);
      if (harness !== 'pi' && extra.includes('pi')) await fakePi(box);
      const bots = await withBot(box, { harness });
      const before = await snapshot(bots, skipGit);

      const result = await sessionAdd(box, 'daily', ...extra, '--remote-control', value);

      assertClaudeOnly(result);
      assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
    });
  }
}

test('RS4 session add --harness claude --remote-control off on a Codex bot is taken: the session runs on Claude Code', async (t) => {
  // The presence beside the refusals above: it is the session's harness that counts.
  const box = await createSandbox(t);
  const bots = await withBot(box, { harness: 'codex' });

  const result = await sessionAdd(box, 'daily', '--harness', 'claude', '--remote-control', 'off');

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.equal((await entryOf(bots, 'daily')).remote_control, 'off');
});

// ------------------------------------------------------------- RS4 session change

for (const [from, to] of [[undefined, 'off'], [undefined, 'on'], ['on', 'off'], ['off', 'on']]) {
  test(`RS4 session change --remote-control ${to} on a session with ${from === undefined ? 'no setting' : `remote_control: ${from}`} writes ${to}`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    assert.equal((await sessionAdd(box, 'daily', '--model', 'opus')).code, 0);
    if (from !== undefined) await handSet(bots, 'daily', { remote_control: from });

    const result = await sessionChange(box, 'daily', '--remote-control', to);

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    const entry = await entryOf(bots, 'daily');
    assert.equal(entry.remote_control, to, `got: ${JSON.stringify(entry)}`);
    assert.equal(entry.model, 'opus', 'what the change left out stays as it was');
  });
}

test('RS4 session change --remote-control= takes remote_control out, as for the other settings', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  assert.equal((await sessionAdd(box, 'daily', '--model', 'opus')).code, 0);
  await handSet(bots, 'daily', { remote_control: 'off' });

  const result = await sessionChange(box, 'daily', '--remote-control=');

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  const entry = await entryOf(bots, 'daily');
  assert.equal('remote_control' in entry, false, `the key is gone, got: ${JSON.stringify(entry)}`);
  assert.equal(entry.model, 'opus');
});

test('RS4 session change with no --remote-control leaves remote_control as it was', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  assert.equal((await sessionAdd(box, 'daily')).code, 0);
  await handSet(bots, 'daily', { remote_control: 'off' });

  const result = await sessionChange(box, 'daily', '--model', 'sonnet');

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.equal((await entryOf(bots, 'daily')).remote_control, 'off');
});

for (const value of ['true', 'yes', '0', 'maybe']) {
  test(`RS4 session change --remote-control ${value} is refused, names on and off, and writes nothing`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    assert.equal((await sessionAdd(box, 'daily')).code, 0);
    const before = await snapshot(bots, skipGit);

    const result = await sessionChange(box, 'daily', '--remote-control', value);

    assertBadValue(result);
    assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
  });
}

for (const harness of ['codex', 'pi']) {
  test(`RS3 session change --remote-control off on a ${harness} session is refused: Remote Control is a Claude Code setting; nothing is written`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, { harness });
    assert.equal((await sessionAdd(box, 'daily')).code, 0);
    const before = await snapshot(bots, skipGit);

    const result = await sessionChange(box, 'daily', '--remote-control', 'off');

    assertClaudeOnly(result);
    assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
  });
}

// ------------------------------------------------------------- RS2, RS3 obk up

/** No tab was opened for api-bot's daily. */
async function assertNoTab(box, bots) {
  assert.deepEqual(await tabsOfBot(box, bots, BOT), [], 'the session the kit will not start gets no tab');
}

for (const [label, value] of [
  ['true, a YAML boolean', true],
  ['false, a YAML boolean', false],
  ['yes', 'yes'],
  ['the number 1', 1],
  ['maybe', 'maybe'],
]) {
  test(`RS2 obk up refuses a Claude session whose bot.yaml says remote_control: ${label}, names the session and the values on and off`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    assert.equal((await sessionAdd(box, 'nightly')).code, 0);
    await handSet(bots, 'nightly', { remote_control: value });
    assert.deepEqual((await entryOf(bots, 'nightly')).remote_control, value, 'the premise: bot.yaml holds the value as written');

    const result = await box.run(['up', '--bots', 'bots', '--bot', BOT]);

    assertBadValue(result, 'nightly');
    await assertNoTab(box, bots);
  });
}

for (const value of ['on', 'off']) {
  test(`RS1 obk up starts a Claude session whose bot.yaml says remote_control: ${value}`, async (t) => {
    // The presence beside the refusals above.
    const box = await createSandbox(t);
    const bots = await withBot(box);
    assert.equal((await sessionAdd(box, 'nightly')).code, 0);
    await handSet(bots, 'nightly', { remote_control: value });

    const result = await box.run(['up', '--bots', 'bots', '--bot', BOT]);

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    assert.equal((await tabsOfBot(box, bots, BOT)).length, 1, 'the session has its tab');
  });
}

for (const value of ['on', 'off']) {
  test(`RS3 obk up refuses a Codex session whose bot.yaml says remote_control: ${value}: Remote Control is a Claude Code setting`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, { harness: 'codex' });
    assert.equal((await sessionAdd(box, 'nightly')).code, 0);
    await handSet(bots, 'nightly', { remote_control: value });

    const result = await box.run(['up', '--bots', 'bots', '--bot', BOT]);

    assertClaudeOnly(result);
    assert.ok(`${result.stdout}${result.stderr}`.includes('nightly'), `the refusal names the session, got:\n${result.stdout}${result.stderr}`);
    await assertNoTab(box, bots);
  });
}

test('RS3 obk up refuses a Pi session whose bot.yaml says remote_control: off: Remote Control is a Claude Code setting', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { harness: 'pi' });
  assert.equal((await sessionAdd(box, 'nightly')).code, 0);
  await handSet(bots, 'nightly', { remote_control: 'off' });

  const result = await box.run(['up', '--bots', 'bots', '--bot', BOT]);

  assertClaudeOnly(result);
  await assertNoTab(box, bots);
});

// ------------------------------------------------------------- RS5 the usage text

/** The block of `obk --help` that starts with `  obk <command>`, up to the next command. */
function usageBlock(text, command) {
  const lines = text.split('\n');
  const at = lines.findIndex((line) => line.startsWith(`  obk ${command} `));
  assert.ok(at >= 0, `obk --help should have a block for ${command}, got:\n${text}`);
  const next = lines.findIndex((line, index) => index > at && /^ {2}obk /.test(line));
  return lines.slice(at, next < 0 ? undefined : next).join('\n');
}

for (const command of ['session add', 'session change', 'temp make']) {
  test(`RS5 obk --help names --remote-control on|off for ${command}`, async (t) => {
    const box = await createSandbox(t);

    const result = await box.run(['--help']);

    assert.equal(result.code, 0, result.stderr);
    const block = usageBlock(result.stdout, command);
    assert.ok(block.includes('--remote-control on|off'), `the ${command} block should name --remote-control on|off, got:\n${block}`);
  });
}
