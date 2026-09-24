// A work dir outside the bot home (#222). A bot's work dirs, and every clone
// its sessions need, belong inside the bot's own folder, under work/. When
// `session add` or `session change` is given a --work-dir that lands outside
// the bot home, it says so plainly: a warning, not a refusal. The setting is
// written exactly as the user gave it, nothing is moved or made, and Orca is
// not touched.
//
// The warning is a finding of the shape `obk health` already uses:
// `{ kind, where, says }`, with `kind` "work-dir" and `where` the work dir
// resolved to an absolute path (a relative one against the bot home). With
// --json it rides in `found`, which is an empty array when there is nothing to
// say; in plain output it is the kit's usual two lines. The wording of `says`
// is not pinned beyond it naming the folder.
//
// The criterion each test covers is in its name: W1 to W5 are the issue's
// acceptance criteria 1 to 5.

import assert from 'node:assert/strict';
import { readFile, stat, symlink } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import { botHomeOf, createSandbox } from './helpers/cli.js';

const BOT = 'api-bot';

/** A bots folder at `bots` with api-bot in it, ready for sessions. Answers the folder. */
async function withBot(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  assert.equal(made.code, 0, made.stderr);
  return box.path('bots');
}

/** `obk session add` for api-bot, from the bots folder named `bots` unless told otherwise. */
const add = (box, name, rest, { bots = 'bots' } = {}) =>
  box.run(['session', 'add', '--bots', bots, '--bot', BOT, '--name', name, ...rest]);

/** `obk session change` for api-bot's session `name`. */
const change = (box, name, rest) =>
  box.run(['session', 'change', '--bots', 'bots', '--bot', BOT, '--session', name, ...rest]);

/** The one session called `name` in api-bot's bot.yaml, as it is written now. */
async function sessionOf(bots, name) {
  const sessions = parse(await readFile(path.join(botHomeOf(bots, BOT), 'bot.yaml'), 'utf8')).sessions ?? [];
  const found = sessions.filter((session) => session?.name === name);
  assert.equal(found.length, 1, `one session should be called ${name}, got: ${JSON.stringify(sessions)}`);
  return found[0];
}

/** A run that worked and printed JSON and nothing else: the parsed answer. */
function answerOf(result) {
  assert.equal(result.code, 0, `a warning is not a failure, got ${result.code}: ${result.stderr}`);
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  assert.ok(Array.isArray(answer.found), `the answer should carry found, a list of findings, got: ${result.stdout}`);
  return answer;
}

/** The one work-dir finding an answer carries, held to the shape every finding has. */
function theWorkDirFinding(answer) {
  assert.equal(answer.found.length, 1, `one finding, about the work dir, got: ${JSON.stringify(answer.found)}`);
  const [finding] = answer.found;
  assert.equal(finding.kind, 'work-dir', `got: ${JSON.stringify(finding)}`);
  assert.equal(typeof finding.where, 'string', `got: ${JSON.stringify(finding)}`);
  assert.equal(typeof finding.says, 'string', `got: ${JSON.stringify(finding)}`);
  return finding;
}

/** The finding's two lines in plain output: `<kind padded to 9>  <where>`, then 13 spaces and `<says>`. */
function assertPlainFinding(stdout, where) {
  const lines = stdout.split('\n');
  const at = lines.indexOf(`work-dir   ${where}`);
  assert.ok(at >= 0, `a line "work-dir   ${where}" should be in the output, got:\n${stdout}`);
  const says = lines[at + 1] ?? '';
  assert.match(says, /^ {13}\S/, `the line after it is what the finding says, indented 13, got:\n${stdout}`);
  assert.ok(says.includes(where), `and it names the folder, got: ${says}`);
}

/** Plain output with no work-dir finding in it. */
function assertNoPlainFinding(stdout) {
  assert.ok(
    !stdout.split('\n').some((line) => line.startsWith('work-dir ')),
    `there is nothing to warn about, got:\n${stdout}`,
  );
}

const isThere = (target) => stat(target).then(() => true, () => false);

// Each case: a label, the work dir as the user gives it, and where it lands
// (worked out by hand from the sandbox's own paths: the bots folder, its bot
// home at <bots>/bots/api-bot, and the sandbox root beside it).
const OUTSIDE = [
  ['an absolute path elsewhere', (box) => path.join(box.root, 'clones', 'api'), (box) => path.join(box.root, 'clones', 'api')],
  ['a relative path that leads out', () => '../elsewhere', (box, bots) => path.join(bots, 'bots', 'elsewhere')],
  ['a relative path that goes in under work/ and then out', () => 'work/../../elsewhere', (box, bots) => path.join(bots, 'bots', 'elsewhere')],
  ['the folder that holds the bot home', () => '..', (box, bots) => path.join(bots, 'bots')],
  // A folder whose name merely starts with the bot's is a sibling, not inside.
  ['a sibling whose name starts with the bot\'s, given absolute', (box, bots) => path.join(bots, 'bots', 'api-bot-clones'), (box, bots) => path.join(bots, 'bots', 'api-bot-clones')],
  ['a sibling whose name starts with the bot\'s, given relative', () => '../api-bot-clones', (box, bots) => path.join(bots, 'bots', 'api-bot-clones')],
];

const INSIDE = [
  ['work/<name>, the default shape', () => 'work/api', (bots) => path.join(botHomeOf(bots, BOT), 'work', 'api')],
  ['a deeper folder under work/', () => 'work/clones/deep', (bots) => path.join(botHomeOf(bots, BOT), 'work', 'clones', 'deep')],
  ['a relative folder in the bot home outside work/', () => 'notes/x', (bots) => path.join(botHomeOf(bots, BOT), 'notes', 'x')],
  ['an absolute path inside the bot home', (bots) => path.join(botHomeOf(bots, BOT), 'work', 'api'), (bots) => path.join(botHomeOf(bots, BOT), 'work', 'api')],
];

for (const [label, given, landsAt] of OUTSIDE) {
  test(`W2 W3 W5 session add warns about ${label}, writes it as given, and makes nothing`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    const workDir = given(box, bots);
    const where = landsAt(box, bots);
    const wasThere = await isThere(where);
    const calls = (await box.orca.calls()).length;

    const answer = answerOf(await add(box, 'daily', ['--work-dir', workDir, '--json']));

    const finding = theWorkDirFinding(answer);
    assert.equal(finding.where, where, 'where is the work dir resolved to an absolute path');
    assert.ok(finding.says.includes(where), `what it says names the folder, got: ${finding.says}`);
    assert.equal((await sessionOf(bots, 'daily')).work_dir, workDir, 'written exactly as the user wrote it');
    assert.equal(await isThere(where), wasThere, `${where} is not made: a warning moves and makes nothing`);
    assert.equal((await box.orca.calls()).length, calls, 'session add does not talk to Orca');
  });

  test(`W2 W3 session add says so in plain output for ${label}: the two lines of a finding`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    const workDir = given(box, bots);

    const result = await add(box, 'daily', ['--work-dir', workDir]);

    assert.equal(result.code, 0, result.stderr);
    assertPlainFinding(result.stdout, landsAt(box, bots));
    assert.equal((await sessionOf(bots, 'daily')).work_dir, workDir);
  });
}

for (const [label, given, landsAt] of INSIDE) {
  test(`W1 W2 W3 session add finds nothing to say about ${label}`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    const workDir = given(bots);
    const calls = (await box.orca.calls()).length;

    const answer = answerOf(await add(box, 'daily', ['--work-dir', workDir, '--json']));
    const plain = await add(box, 'plain', ['--work-dir', workDir]);

    assert.deepEqual(answer.found, [], 'nothing to warn about is an empty list');
    assert.equal(plain.code, 0, plain.stderr);
    assertNoPlainFinding(plain.stdout);
    assert.equal((await sessionOf(bots, 'daily')).work_dir, workDir, 'written exactly as the user wrote it');
    assert.equal(await isThere(landsAt(bots)), false, 'session add makes no folder; obk up does');
    assert.equal((await box.orca.calls()).length, calls, 'session add does not talk to Orca');
  });
}

test('W2 session add with no work dir at all has an empty found', async (t) => {
  const box = await createSandbox(t);
  await withBot(box);

  const answer = answerOf(await add(box, 'daily', ['--json']));

  assert.deepEqual(answer.found, []);
});

test('W1 W2 the same bot warns about the one outside and not the one inside, side by side', async (t) => {
  // The pair in one bot, so an empty found cannot pass by accident: the same
  // command, the same bot, one path in and one out.
  const box = await createSandbox(t);
  const bots = await withBot(box);

  const inside = answerOf(await add(box, 'near', ['--work-dir', 'work/near', '--json']));
  const outside = answerOf(await add(box, 'far', ['--work-dir', '../api-bot-far', '--json']));

  assert.deepEqual(inside.found, []);
  assert.equal(theWorkDirFinding(outside).where, path.join(bots, 'bots', 'api-bot-far'));
});

test('W3 through a link to the bots folder, an absolute work dir through that link into the bot home is inside', async (t) => {
  // #164: a bots folder reached through a link is the same fleet. A work dir
  // spelled through the same link into the bot home is in the bot home.
  const box = await createSandbox(t);
  await withBot(box);
  await symlink(box.path('bots'), box.path('linked-bots'));
  const workDir = path.join(box.path('linked-bots'), 'bots', BOT, 'work', 'api');

  const answer = answerOf(await add(box, 'daily', ['--work-dir', workDir, '--json'], { bots: 'linked-bots' }));

  assert.deepEqual(answer.found, [], `inside the bot home, whichever spelling reaches it, got: ${JSON.stringify(answer.found)}`);
});

test('W3 through a link to the bots folder, an absolute work dir through that link to a folder outside the bot home is outside', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  await symlink(box.path('bots'), box.path('linked-bots'));
  const workDir = path.join(box.path('linked-bots'), 'bots', 'elsewhere');

  const answer = answerOf(await add(box, 'daily', ['--work-dir', workDir, '--json'], { bots: 'linked-bots' }));

  // Which spelling of the folder `where` gives is not the point here.
  const { where } = theWorkDirFinding(answer);
  assert.ok(
    [workDir, path.join(bots, 'bots', 'elsewhere')].includes(where),
    `where names the folder by either spelling, got: ${where}`,
  );
});

// session change: the same, for a --work-dir given on this command.

/** api-bot with its daily session, added with the settings given. Answers the bots folder. */
async function withSession(box, settings = []) {
  const bots = await withBot(box);
  const added = await add(box, 'daily', settings);
  assert.equal(added.code, 0, added.stderr);
  return bots;
}

for (const [label, given, landsAt] of OUTSIDE) {
  test(`W4 W5 session change warns about ${label}, writes it as given, and makes nothing`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withSession(box, ['--work-dir', 'work/api']);
    const workDir = given(box, bots);
    const where = landsAt(box, bots);
    const wasThere = await isThere(where);
    const calls = (await box.orca.calls()).length;

    const answer = answerOf(await change(box, 'daily', ['--work-dir', workDir, '--json']));

    const finding = theWorkDirFinding(answer);
    assert.equal(finding.where, where);
    assert.ok(finding.says.includes(where), `what it says names the folder, got: ${finding.says}`);
    assert.equal((await sessionOf(bots, 'daily')).work_dir, workDir, 'written exactly as the user wrote it');
    assert.equal(await isThere(where), wasThere, `${where} is not made`);
    assert.equal((await box.orca.calls()).length, calls, 'session change does not talk to Orca');
  });
}

test('W4 session change says so in plain output: the two lines of a finding', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSession(box, ['--work-dir', 'work/api']);

  const result = await change(box, 'daily', ['--work-dir', '../api-bot-clones']);

  assert.equal(result.code, 0, result.stderr);
  assertPlainFinding(result.stdout, path.join(bots, 'bots', 'api-bot-clones'));
  assert.equal((await sessionOf(bots, 'daily')).work_dir, '../api-bot-clones');
});

for (const [label, given, landsAt] of INSIDE) {
  test(`W4 W5 session change finds nothing to say about ${label}`, async (t) => {
    // It starts outside, so the change is what makes the difference.
    const box = await createSandbox(t);
    const bots = await withSession(box, ['--work-dir', '../elsewhere']);
    const workDir = given(bots);
    const calls = (await box.orca.calls()).length;

    const answer = answerOf(await change(box, 'daily', ['--work-dir', workDir, '--json']));
    const plain = await change(box, 'daily', ['--work-dir', workDir]);

    assert.deepEqual(answer.found, [], 'nothing to warn about is an empty list');
    assert.equal(plain.code, 0, plain.stderr);
    assertNoPlainFinding(plain.stdout);
    assert.equal((await sessionOf(bots, 'daily')).work_dir, workDir);
    assert.equal(await isThere(landsAt(bots)), false, 'session change makes no folder');
    assert.equal((await box.orca.calls()).length, calls, 'session change does not talk to Orca');
  });
}

test('W4 session change --work-dir= clears the setting and gives no finding, even from a work dir that was outside', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSession(box, ['--work-dir', '../elsewhere']);

  const answer = answerOf(await change(box, 'daily', ['--work-dir=', '--json']));

  assert.deepEqual(answer.found, [], `clearing it is nothing to warn about, got: ${JSON.stringify(answer.found)}`);
  assert.equal('work_dir' in (await sessionOf(bots, 'daily')), false, 'the setting is taken away');
});
