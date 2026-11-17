// `obk rules build` says which running sessions still run on the older rules,
// and the step that brings each one the new rules (#757).
//
// A running session keeps the rules it read. `obk health` already knows which
// sessions those are: for each running session whose rules stamp in the book
// differs from the bot's AGENTS.md now, it gives a finding of kind `session`,
// about that AGENTS.md, that names `obk session clear` and `obk restart` for
// the session (S7 and S10 in test/session-settings.test.js). After this issue
// the build reports the same sessions with the same text, at the moment the
// user changes the rules:
//
//   --json   `older_rules`: one entry per running session on older rules,
//            { bot, session, harness, where, says }, `where` the bot's
//            AGENTS.md and `says` exactly health's finding for that session.
//            With Orca not up, and the book noting a session on rules that
//            are not AGENTS.md now, `older_rules` is null and `orca` says why.
//   lines    `older      <bot>/<session>`, then 13 spaces and the says; with
//            none, `No running session is on older rules.`; with Orca not up,
//            a line that says Orca `could not be asked which sessions run`.
//
// It is a report only: the exit code is the build's own, nothing is typed into
// a tab, no tab is opened or closed, and the book is not changed. `--bot`
// narrows it to that bot. Sessions health does not name are not named: paused,
// tab gone, only the shell in front, a stamp that matches, no stamp at all.
//
// Everything runs against the fake Orca and the fake `ps`; nothing here
// reaches the real Orca or a real harness.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import {
  bookOf,
  botHomeOf,
  createSandbox,
  orcaCommand,
  sessionIn,
  shellWord,
} from './helpers/cli.js';
import { addSession } from './helpers/permissions.js';
import { agentsIn, agentsOf } from './helpers/rules.js';
import { botYamlOf } from './helpers/skills.js';

// ---------------------------------------------------------------- the fleet

/** A bots folder with Bot Father up in Orca. */
async function seeded(box) {
  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(result.code, 0, result.stderr);
  return box.path('bots');
}

/** Run one more `obk` command that has to work for the test to mean anything. */
async function obk(box, ...args) {
  const result = await box.run([...args]);
  assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stderr}${result.stdout}`);
  return result;
}

/**
 * One more bot on Claude, with its sessions, brought up in Orca. Each session
 * is `[name, ...flags]`, the flags as `session add` takes them.
 */
async function botUp(box, name, { sessions = [['daily']] } = {}) {
  await obk(box, 'bot', 'create', '--bots', 'bots', '--name', name, '--harness', 'claude');
  for (const [session, ...settings] of sessions) {
    const added = await addSession(box, { bot: name, name: session, settings });
    assert.equal(added.code, 0, added.stderr);
  }
  await obk(box, 'up', '--bots', 'bots', '--bot', name);
  return botHomeOf(box.path('bots'), name);
}

/** Change what one bot's book says about its sessions, as a person editing it by hand would. */
async function editBook(bots, bot, change) {
  const file = bookOf(bots, bot);
  const book = parse(await readFile(file, 'utf8'));
  change(book.sessions);
  await writeFile(file, stringify(book));
}

/** Give every named session of a bot a conversation in the book, so that pause and unpause will take it. */
const conversationsFor = (bots, bot, names) => editBook(bots, bot, (sessions) => {
  for (const [n, name] of names.entries()) {
    sessions[name].session = `0199b2c0-${String(50 + n).padStart(4, '0')}-4444-8888-cccccccccccc`;
  }
});

/**
 * Give a bot a new charter in bot.yaml, the user's own file. Its AGENTS.md is
 * not rebuilt until the next `obk rules build`.
 */
async function newCharter(bots, bot, charter = `${bot} owns the billing API now, and asks before every release.`) {
  const file = botYamlOf(bots, bot);
  const doc = parse(await readFile(file, 'utf8')) ?? {};
  doc.charter = charter;
  await writeFile(file, stringify(doc));
}

/** Put `front` in front of one session's tab alone, in the fake Orca's world. */
async function frontOf(box, bots, bot, session, front) {
  const { tab } = await sessionIn(bots, bot, session);
  const terminals = await box.orca.terminals();
  assert.ok(terminals.some((one) => one.tabId === tab), `the premise: Orca has ${bot} ${session}'s tab ${tab}`);
  await box.orca.set({ terminals: terminals.map((one) => (one.tabId === tab ? { ...one, foreground: front } : one)) });
}

/** Take one session's tab out of the fake Orca's world, as a tab closed by hand or a machine restarted. */
async function tabGone(box, bots, bot, session) {
  const { tab } = await sessionIn(bots, bot, session);
  const terminals = await box.orca.terminals();
  assert.ok(terminals.some((one) => one.tabId === tab), `the premise: Orca has ${bot} ${session}'s tab ${tab}`);
  await box.orca.set({ terminals: terminals.filter((one) => one.tabId !== tab) });
}

// ------------------------------------------------------------- what it answers

/** Run the rules build. */
const build = (box, ...rest) => box.run(['rules', 'build', '--bots', 'bots', ...rest]);

/** Run the rules build for JSON, and parse what it printed. */
async function built(box, ...rest) {
  const result = await build(box, ...rest, '--json');
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  assert.ok(Array.isArray(answer.rules), `the answer still carries the build's rules entries, got: ${result.stdout}`);
  return { result, answer };
}

/** The `older_rules` of an answer, held to its shape: a list of entries, each with the five fields. */
function olderOf(answer) {
  const older = answer.older_rules;
  assert.ok(Array.isArray(older), `the answer should carry older_rules as a list, got: ${JSON.stringify(answer, null, 2)}`);
  for (const entry of older) {
    const shown = JSON.stringify(entry);
    for (const field of ['bot', 'session', 'harness', 'where', 'says']) {
      assert.equal(typeof entry[field], 'string', `every older_rules entry carries ${field} as text, got: ${shown}`);
    }
  }
  return older;
}

/** Which sessions an `older_rules` names, as `<bot>/<session>`, sorted. */
const namedIn = (older) => older.map((one) => `${one.bot}/${one.session}`).sort();

/** Run the health check for JSON, and parse what it printed. */
async function healthOf(box, ...rest) {
  const result = await box.run(['health', '--bots', 'bots', ...rest, '--json']);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`health --json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
}

/** Health's findings that a session is on older rules: kind `session`, about a bot's AGENTS.md. */
const healthOlder = (answer, bots, names) => answer.found.filter((one) => (
  one.kind === 'session' && names.some((bot) => one.where === agentsOf(bots, bot))
));

/**
 * The text that ends a finding about a session on older rules: the two steps
 * that bring it the new rules, each with the kit's own CLI and the bots folder
 * in front, as the requirement quotes health's finding.
 */
function stepsFor(box, bots, bot, session) {
  const cli = shellWord(box.cli);
  const folder = shellWord(bots);
  return `A session reads it again when it is cleared: ${cli} session clear --bots ${folder} --bot ${bot} --session ${session}, or when it starts: ${cli} restart --bots ${folder} --bot ${bot} --session ${session}`;
}

/** Hold one older_rules entry to what the requirement says it is for this session. */
function assertEntry(entry, box, bots, { bot, session, harness }) {
  const shown = JSON.stringify(entry);
  assert.equal(entry.harness, harness, `${bot}/${session} runs on ${harness}, got: ${shown}`);
  assert.equal(entry.where, agentsOf(bots, bot), `where is ${bot}'s AGENTS.md, got: ${shown}`);
  assert.ok(
    entry.says.startsWith(`${bot}'s session ${session} is running on older rules: `),
    `says names the session as running on older rules, got: ${entry.says}`,
  );
  assert.ok(entry.says.endsWith(stepsFor(box, bots, bot, session)), `says ends with the clear and the restart for it, got: ${entry.says}`);
}

/** The Orca commands that change something: a tab made, typed into, renamed or closed, a project or a Run made. */
const CHANGING = [
  'repo add',
  'project setup-update',
  'terminal create',
  'terminal rename',
  'terminal send',
  'terminal close',
  'orchestration run-create',
  'orchestration send',
  'automations create',
  'automations edit',
  'worktree set',
];

// ---------------------------------------------------------------------------
// The core case: a Claude and a Codex session on older rules.
// ---------------------------------------------------------------------------

test('757 after a charter change, rules build --json names the running Claude and Codex sessions on older rules, with health\'s step for each, and exits 0', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['daily'], ['nightly', '--harness', 'codex']] });
  await botUp(box, 'web-bot');
  const was = await agentsIn(bots, 'api-bot');
  await newCharter(bots, 'api-bot');

  const { result, answer } = await built(box);

  assert.notEqual(await agentsIn(bots, 'api-bot'), was, 'the premise: the build rewrote api-bot\'s AGENTS.md');
  assert.equal(result.code, 0, `the build itself is fine, and older sessions do not change its exit code, got ${result.code}: ${result.stderr}`);
  const older = olderOf(answer);
  assert.deepEqual(namedIn(older), ['api-bot/daily', 'api-bot/nightly'], `both api-bot sessions, and nothing of web-bot or Bot Father, got: ${JSON.stringify(older, null, 2)}`);
  assertEntry(older.find((one) => one.session === 'daily'), box, bots, { bot: 'api-bot', session: 'daily', harness: 'claude' });
  assertEntry(older.find((one) => one.session === 'nightly'), box, bots, { bot: 'api-bot', session: 'nightly', harness: 'codex' });
});

test('757 the plain report gives each older session a line of its own, then its says on a line of 13 spaces, and exits 0', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['daily'], ['nightly', '--harness', 'codex']] });
  await newCharter(bots, 'api-bot');

  const result = await build(box);

  assert.equal(result.code, 0, `the build itself is fine, and older sessions do not change its exit code, got ${result.code}: ${result.stderr}${result.stdout}`);
  const lines = result.stdout.split('\n');
  for (const session of ['daily', 'nightly']) {
    const at = lines.indexOf(`older      api-bot/${session}`);
    assert.notEqual(at, -1, `a line "older      api-bot/${session}", got:\n${result.stdout}`);
    const next = lines[at + 1] ?? '';
    assert.ok(next.startsWith(`             api-bot's session ${session} is running on older rules: `), `the next line is 13 spaces and its says, got: ${JSON.stringify(next)}`);
    assert.ok(next.endsWith(stepsFor(box, bots, 'api-bot', session)), `and the says ends with its two steps, got: ${JSON.stringify(next)}`);
  }
  assert.equal(lines.filter((line) => line.startsWith('older ')).length, 2, `one older line per session, got:\n${result.stdout}`);
  assert.ok(!result.stdout.includes('No running session is on older rules.'), `there are older sessions, got:\n${result.stdout}`);
});

// ---------------------------------------------------------------------------
// The same sessions, and the same text, as health.
// ---------------------------------------------------------------------------

test('757 the build\'s older_rules carry exactly the says texts of health\'s older-rules findings for the same fleet', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['daily'], ['nightly', '--harness', 'codex']] });
  await botUp(box, 'web-bot', { sessions: [['daily'], ['review']] });
  // One session whose tab is gone: health names that one as gone, not as on older rules.
  await tabGone(box, bots, 'web-bot', 'review');
  await newCharter(bots, 'api-bot');
  await newCharter(bots, 'web-bot', 'web-bot owns the shop front now.');

  const { result, answer } = await built(box);
  assert.equal(result.code, 0, `the build itself is fine, got ${result.code}: ${result.stderr}`);
  const health = await healthOf(box);

  const fromHealth = healthOlder(health, bots, ['bot-father', 'api-bot', 'web-bot']);
  assert.equal(fromHealth.length, 3, `the premise: health names three sessions on older rules, got: ${JSON.stringify(health.found, null, 2)}`);
  const older = olderOf(answer);
  assert.deepEqual(
    older.map((one) => one.says).sort(),
    fromHealth.map((one) => one.says).sort(),
    'the build names the sessions health names, with the same text',
  );
  assert.deepEqual(
    older.map((one) => `${one.bot} ${one.where}`).sort(),
    fromHealth.map((one) => `${one.bot} ${one.where}`).sort(),
    'each about the same bot and the same AGENTS.md as health\'s finding',
  );
});

// ---------------------------------------------------------------------------
// --bot narrows the report.
// ---------------------------------------------------------------------------

test('757 rules build --bot X names only X\'s older sessions, though another bot has some too', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['daily'], ['nightly', '--harness', 'codex']] });
  await botUp(box, 'web-bot');
  // web-bot's rules change first, so its session runs on older rules too.
  await newCharter(bots, 'web-bot', 'web-bot owns the shop front now.');
  await obk(box, 'rules', 'build', '--bots', 'bots', '--bot', 'web-bot');
  await newCharter(bots, 'api-bot');

  const narrowed = await built(box, '--bot', 'api-bot');

  assert.equal(narrowed.result.code, 0, `the build itself is fine, got ${narrowed.result.code}: ${narrowed.result.stderr}`);
  assert.deepEqual(namedIn(olderOf(narrowed.answer)), ['api-bot/daily', 'api-bot/nightly'], 'only api-bot\'s sessions');

  // The contrast: the whole fleet's build names web-bot's session as well.
  const whole = await built(box);
  assert.deepEqual(namedIn(olderOf(whole.answer)), ['api-bot/daily', 'api-bot/nightly', 'web-bot/daily'], 'without --bot, every bot\'s');
});

// ---------------------------------------------------------------------------
// Sessions health does not name are not named.
// ---------------------------------------------------------------------------

test('757 a paused session is not named, beside a running one on older rules that is', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['daily'], ['nightly']] });
  await conversationsFor(bots, 'api-bot', ['daily', 'nightly']);
  await obk(box, 'pause', '--bots', 'bots', '--bot', 'api-bot', '--session', 'daily');
  await newCharter(bots, 'api-bot');

  const { answer } = await built(box);

  assert.deepEqual(namedIn(olderOf(answer)), ['api-bot/nightly'], 'nightly runs on older rules; daily is paused and runs nothing');
});

test('757 a session whose tab is gone is not named, beside a running one on older rules that is', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['daily'], ['nightly']] });
  await tabGone(box, bots, 'api-bot', 'daily');
  await newCharter(bots, 'api-bot');

  const { answer } = await built(box);

  assert.deepEqual(namedIn(olderOf(answer)), ['api-bot/nightly'], 'nightly runs on older rules; daily has no tab to run in');
});

for (const shell of ['shell', 'bare-shell']) {
  test(`757 a tab with only the shell in front (${shell}) is not named, beside a running one on older rules that is`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await botUp(box, 'api-bot', { sessions: [['daily'], ['nightly']] });
    await frontOf(box, bots, 'api-bot', 'daily', shell);
    await newCharter(bots, 'api-bot');

    const { answer } = await built(box);

    assert.deepEqual(namedIn(olderOf(answer)), ['api-bot/nightly'], 'nightly runs on older rules; daily\'s harness is gone from its tab');
  });
}

test('757 a session started on the AGENTS.md there is now is not named, beside one still running on the older that is', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['daily'], ['nightly']] });
  await conversationsFor(bots, 'api-bot', ['daily', 'nightly']);
  await obk(box, 'pause', '--bots', 'bots', '--bot', 'api-bot', '--session', 'daily');
  await newCharter(bots, 'api-bot');
  await obk(box, 'rules', 'build', '--bots', 'bots', '--bot', 'api-bot');
  // daily comes back up after the change, so it starts on the rules there are now.
  await obk(box, 'unpause', '--bots', 'bots', '--bot', 'api-bot', '--session', 'daily');
  const now = await agentsIn(bots, 'api-bot');

  const { answer } = await built(box);

  assert.equal(await agentsIn(bots, 'api-bot'), now, 'the premise: this build changed nothing in AGENTS.md');
  assert.deepEqual(namedIn(olderOf(answer)), ['api-bot/nightly'], 'nightly ran on through the change; daily\'s stamp matches AGENTS.md now');
});

test('757 a book entry with no rules stamp is not named, beside a stamped one on older rules that is', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['daily'], ['nightly']] });
  // A session started by an older kit, or a book edited by hand.
  await editBook(bots, 'api-bot', (sessions) => { delete sessions.daily.rules; });
  await newCharter(bots, 'api-bot');

  const { answer } = await built(box);

  assert.deepEqual(namedIn(olderOf(answer)), ['api-bot/nightly'], 'nightly is older; daily is unknown, and unknown is not named');
});

// ---------------------------------------------------------------------------
// None, and Orca not up.
// ---------------------------------------------------------------------------

test('757 with no running session on older rules, older_rules is empty and the plain report says so in one line', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['daily'], ['nightly', '--harness', 'codex']] });
  const was = await agentsIn(bots, 'api-bot');

  const { result, answer } = await built(box);
  assert.equal(await agentsIn(bots, 'api-bot'), was, 'the premise: nothing changed the rules');
  assert.equal(result.code, 0, `the build itself is fine, got ${result.code}: ${result.stderr}`);
  assert.deepEqual(olderOf(answer), [], 'every running session started on the AGENTS.md there is now');

  const plain = await build(box);
  assert.equal(plain.code, 0, `the build itself is fine, got ${plain.code}: ${plain.stderr}`);
  const lines = plain.stdout.split('\n');
  assert.equal(lines.filter((line) => line === 'No running session is on older rules.').length, 1, `one line that says so, got:\n${plain.stdout}`);
  assert.deepEqual(lines.filter((line) => line.startsWith('older ')), [], `and no session line, got:\n${plain.stdout}`);
});

/** The ways Orca is not up for these tests: a runtime that is not there, and no Orca CLI at all. */
const DOWN = {
  'Orca\'s runtime is not reachable': async (box) => {
    await box.orca.set({ reachable: false });
    return box.env;
  },
  'the Orca CLI is not there': async (box) => ({ ...box.env, OBK_ORCA: path.join(box.root, 'no-such-place', 'orca') }),
};

for (const [label, down] of Object.entries(DOWN)) {
  test(`757 when ${label}, the build still builds and exits 0, older_rules is null, orca says why, and the plain report says Orca could not be asked`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await botUp(box, 'api-bot', { sessions: [['daily'], ['nightly', '--harness', 'codex']] });
    const was = await agentsIn(bots, 'api-bot');
    await newCharter(bots, 'api-bot');
    const env = await down(box);

    const json = await box.run(['rules', 'build', '--bots', 'bots', '--json'], { env });

    assert.equal(json.code, 0, `the build itself is fine, and Orca being down does not change its exit code, got ${json.code}: ${json.stderr}${json.stdout}`);
    assert.notEqual(await agentsIn(bots, 'api-bot'), was, 'the build still wrote the new AGENTS.md');
    let answer;
    try {
      answer = JSON.parse(json.stdout);
    } catch (error) {
      assert.fail(`--json should print JSON and nothing else, got: ${json.stdout} (${error.message})`);
    }
    assert.ok(Array.isArray(answer.rules), `the answer still carries the build's rules entries, got: ${json.stdout}`);
    // The book notes api-bot's sessions on rules that are not AGENTS.md now,
    // and Orca cannot say whether they run: that is not "none".
    assert.equal(answer.older_rules, null, `older_rules is null when Orca cannot be asked, got: ${JSON.stringify(answer.older_rules)}`);
    assert.equal(typeof answer.orca, 'string', `orca gives the reason as text, got: ${JSON.stringify(answer.orca)}`);
    assert.notEqual(answer.orca.trim(), '', 'and the reason is not empty');

    // The book still notes the older stamps, so the plain run is the same case.
    const plain = await box.run(['rules', 'build', '--bots', 'bots'], { env });
    assert.equal(plain.code, 0, `the plain build exits 0 too, got ${plain.code}: ${plain.stderr}${plain.stdout}`);
    const lines = plain.stdout.split('\n');
    assert.equal(lines.filter((line) => line.includes('could not be asked which sessions run')).length, 1, `one line says Orca could not be asked, got:\n${plain.stdout}`);
    assert.ok(!lines.includes('No running session is on older rules.'), `it does not say there are none, got:\n${plain.stdout}`);
    assert.deepEqual(lines.filter((line) => line.startsWith('older ')), [], `and names no session, got:\n${plain.stdout}`);
  });
}

// ---------------------------------------------------------------------------
// A report only.
// ---------------------------------------------------------------------------

test('757 the report types nothing into any tab, opens or closes no tab, stops nothing, and leaves the book as it was', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['daily'], ['nightly', '--harness', 'codex']] });
  await newCharter(bots, 'api-bot');
  const tabsBefore = (await box.orca.terminals()).map((one) => ({ tabId: one.tabId, handle: one.handle, typed: one.typed ?? [] }));
  const books = {};
  for (const bot of ['bot-father', 'api-bot']) books[bot] = await readFile(bookOf(bots, bot), 'utf8');
  const callsBefore = (await box.orca.calls()).length;
  const killsBefore = (await box.kill.calls()).length;

  const { result, answer } = await built(box);

  assert.equal(result.code, 0, `the build itself is fine, got ${result.code}: ${result.stderr}`);
  // The premise: the report ran, and had sessions it could have acted on.
  assert.deepEqual(namedIn(olderOf(answer)), ['api-bot/daily', 'api-bot/nightly'], 'both sessions are named as on older rules');

  const tabsAfter = (await box.orca.terminals()).map((one) => ({ tabId: one.tabId, handle: one.handle, typed: one.typed ?? [] }));
  assert.deepEqual(tabsAfter, tabsBefore, 'the same tabs, with nothing more typed into any of them');
  const changing = (await box.orca.calls()).slice(callsBefore).filter((call) => CHANGING.includes(orcaCommand(call)));
  assert.deepEqual(changing.map((call) => call.args.join(' ')), [], 'no Orca call that types, opens, closes or makes anything');
  assert.deepEqual((await box.kill.calls()).slice(killsBefore), [], 'no process was signalled');
  for (const bot of ['bot-father', 'api-bot']) {
    assert.equal(await readFile(bookOf(bots, bot), 'utf8'), books[bot], `${bot}'s book is as it was`);
  }
});
