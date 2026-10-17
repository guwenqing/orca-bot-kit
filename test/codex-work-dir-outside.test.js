// A Codex session's work dir stays in its bot folder (#585).
//
// For a Codex session whose work dir is outside the bot folder, `obk up` puts
// `--add-dir <work dir>` on Codex's launch line, and that makes the folder
// writable in Codex's sandbox. `session add` and `session change` are in every
// bot's default permission set, and PRD 6.4 promises that no command in that
// set widens an approval. So:
//
//   R1  `session add` refuses a session that runs on Codex (its `--harness
//       codex`, or the bot's harness when it names none) when its work dir
//       leads outside the bot folder. A relative work dir is resolved against
//       the bot home. Outside is an absolute path elsewhere, a relative path
//       through `..`, a path inside by spelling that a link the user made
//       takes out, and a path whose spelling is outside even when a link takes
//       it back inside (the line names the spelling, and the link can change).
//       The bot home is spelled by its real path: a work dir spelled through
//       a link to the bots folder is outside.
//       Refused is: exit code not 0, a plain sentence on stderr that says
//       Codex would be allowed to write that folder, and nothing changed:
//       bot.yaml byte for byte as before, no session added. The refusal never
//       tells anyone to edit bot.yaml by hand.
//   R2  `session change --work-dir` refuses the same way when the session runs
//       on Codex after the change (it is a Codex session, or the same call
//       gives `--harness codex`) and the new work dir leads outside.
//   R3  `session change --harness codex` refuses the same way when it moves a
//       Claude or Pi session whose stored work dir leads outside to Codex.
//   R4  A change that widens nothing goes through, even for a Codex session
//       whose stored work dir is outside (a bot.yaml the user wrote by hand).
//   R5  The session's approval level does not matter: dangerously-skip is
//       refused too.
//   R6  Claude and Pi sessions stay as they are: an outside work dir is
//       written as given, with the work-dir finding of #222
//       (test/work-dir-outside.test.js).
//   R7  A Codex work dir inside the bot folder is accepted as before.
//   R9  `temp make` gives a Codex session `work/<name>`, never an outside one.
//
// R8, `up` on a Codex session with an outside work dir the user wrote by hand,
// is held where the launch line is: test/launch-command.test.js,
// test/sandbox-launch-dirs.test.js (SL2) and test/session-resume.test.js.
//
// The wording of the refusal is not pinned beyond what R1 asks: it names
// Codex, the folder, and writing.
//
// Every run is in the sandbox (helpers/cli.js): its own HOME, a fake Orca and
// fake harnesses on its own PATH.

import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, symlink } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import {
  botHomeOf,
  createSandbox,
  fakeProgram,
  harnessPartOf,
  kitDirsOf,
  kitLaunchMark,
  sessionIn,
  sh,
  snapshot,
  tabsOfBot,
  typedInto,
  workDirByHand,
} from './helpers/cli.js';
import { fakePi } from './helpers/pi.js';

const BOT = 'api-bot';

/** A bots folder at `bots` with api-bot on `harness` in it. Answers the folder. */
async function withBot(box, harness = 'codex') {
  if (harness === 'pi') await fakePi(box);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', harness]);
  assert.equal(made.code, 0, `${made.stdout}${made.stderr}`);
  return box.path('bots');
}

/** `obk session add` for api-bot, from the bots folder named `bots` unless told otherwise. */
const add = (box, name, rest, { bots = 'bots' } = {}) =>
  box.run(['session', 'add', '--bots', bots, '--bot', BOT, '--name', name, ...rest]);

/** `obk session change` for api-bot's session `name`. */
const change = (box, name, rest) =>
  box.run(['session', 'change', '--bots', 'bots', '--bot', BOT, '--session', name, ...rest]);

/** api-bot on `harness` with its daily session added with `settings`. Answers the bots folder. */
async function withSession(box, harness, settings = []) {
  const bots = await withBot(box, harness);
  const added = await add(box, 'daily', settings);
  assert.equal(added.code, 0, `${added.stdout}${added.stderr}`);
  return bots;
}

const botYaml = (bots) => path.join(botHomeOf(bots, BOT), 'bot.yaml');

/** The sessions api-bot's bot.yaml holds, as they are written now. */
const sessionsOf = async (bots) => parse(await readFile(botYaml(bots), 'utf8')).sessions ?? [];

/** The one session called `name` in api-bot's bot.yaml. */
async function sessionOf(bots, name) {
  const found = (await sessionsOf(bots)).filter((session) => session?.name === name);
  assert.equal(found.length, 1, `one session should be called ${name}, got: ${JSON.stringify(await sessionsOf(bots))}`);
  return found[0];
}

/**
 * What a refusal must leave as it was: bot.yaml byte for byte, and every file
 * in the sandbox's working directory, the bots folder and the kit's folders
 * beside it, so a refusal that wrote anywhere shows. The bots repo's .git is
 * left out.
 */
async function stateOf(box, bots) {
  return {
    botYaml: await readFile(botYaml(bots), 'utf8'),
    files: await snapshot(box.cwd, (rel) => rel === 'bots/.git' || rel.startsWith('bots/.git/')),
  };
}

/**
 * The refusal R1 asks for: an exit code that is not 0, a plain message on
 * stderr that names Codex, the folder (as given, resolved against the bot
 * home, or its real path) and writing, no crash, and no word to edit bot.yaml
 * by hand.
 */
async function assertCodexRefusal(result, bots, workDir) {
  const said = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.code, 0, `a Codex session may not get ${workDir}, got exit 0:\n${said}`);
  assert.notEqual(result.stderr.trim(), '', `the refusal says why on stderr, got:\n${said}`);
  assert.ok(!/^\s+at /m.test(said), `expected a message, got a crash:\n${said}`);
  assert.match(result.stderr, /\bCodex\b/, `the refusal names Codex, got:\n${result.stderr}`);
  assert.match(result.stderr, /writ/i, `the refusal says Codex could write the folder, got:\n${result.stderr}`);
  const resolved = path.resolve(botHomeOf(bots, BOT), workDir);
  const spellings = [workDir, resolved, await realpath(resolved).catch(() => resolved)];
  assert.ok(
    spellings.some((spelling) => result.stderr.includes(spelling)),
    `the refusal names the folder, as given or resolved (${spellings.join(' or ')}), got:\n${result.stderr}`,
  );
  for (const line of said.split('\n').filter((one) => one.includes('bot.yaml'))) {
    assert.ok(
      !/\b(edit|open|by hand|yourself|write|add|put|set|change)\b/i.test(line),
      `the refusal never tells anyone to edit bot.yaml by hand, got: ${line}`,
    );
  }
  assert.ok(!/\bby hand\b/i.test(said), `the refusal never sends anyone to do it by hand, got:\n${said}`);
}

/** A run that worked and printed JSON: the parsed answer. */
function answerOf(result) {
  assert.equal(result.code, 0, `this should have gone through, got ${result.code}:\n${result.stdout}${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
}

/** The work-dir findings an answer carries (#222). */
const workDirFindings = (answer) => (answer.found ?? []).filter((finding) => finding?.kind === 'work-dir');

// Each case: a label, and the work dir as the user gives it, worked out by hand
// from the sandbox's own paths: the bots folder `<cwd>/bots`, the bot home
// `<bots>/bots/api-bot`, and the sandbox root around it all.
const OUTSIDE = [
  ['an absolute path elsewhere', (box) => path.join(box.root, 'clones', 'api')],
  ['a relative path that leads out', () => '../elsewhere'],
  ['a relative path that goes in under work/ and then out', () => 'work/../../elsewhere'],
  ['the folder that holds the bot home', () => '..'],
  // A folder whose name merely starts with the bot's is a sibling, not inside.
  ['a sibling whose name starts with the bot\'s, given absolute', (box, bots) => path.join(bots, 'bots', 'api-bot-clones')],
  ['a sibling whose name starts with the bot\'s, given relative', () => '../api-bot-clones'],
];

const INSIDE = [
  ['work/<name>, the default shape', () => 'work/api'],
  ['a deeper folder under work/', () => 'work/clones/deep'],
  ['an absolute path inside the bot home', (box, bots) => path.join(botHomeOf(bots, BOT), 'work', 'api')],
  // Codex's sandbox already covers the folder it is launched in.
  ['the bot home itself', () => '.'],
];

// ------------------------------------------------------- R1 session add

for (const [label, given] of OUTSIDE) {
  test(`R1 session add on a Codex bot refuses ${label}, and changes nothing`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, 'codex');
    const workDir = given(box, bots);
    const before = await stateOf(box, bots);

    const result = await add(box, 'daily', ['--work-dir', workDir]);

    await assertCodexRefusal(result, bots, workDir);
    assert.deepEqual(await stateOf(box, bots), before, 'bot.yaml byte for byte as before, and nothing else written');
    assert.deepEqual((await sessionsOf(bots)).map((one) => one.name), [], 'no session added');
  });
}

test('R1 session add --harness codex on a Claude bot refuses a work dir outside, and changes nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'claude');
  const workDir = path.join(box.root, 'clones', 'api');
  const before = await stateOf(box, bots);

  const result = await add(box, 'daily', ['--harness', 'codex', '--work-dir', workDir]);

  await assertCodexRefusal(result, bots, workDir);
  assert.deepEqual(await stateOf(box, bots), before);
  assert.deepEqual(await sessionsOf(bots), []);
});

test('R1 R6 on a Codex bot the same outside work dir is refused for its Codex session and taken for a --harness claude one', async (t) => {
  // The pair in one bot: the harness the session runs on decides, not the bot's.
  const box = await createSandbox(t);
  const bots = await withBot(box, 'codex');
  const workDir = path.join(box.root, 'clones', 'api');

  const codex = await add(box, 'far-codex', ['--work-dir', workDir]);
  const claude = await add(box, 'far-claude', ['--harness', 'claude', '--work-dir', workDir, '--json']);

  await assertCodexRefusal(codex, bots, workDir);
  assert.equal(workDirFindings(answerOf(claude)).length, 1, `the Claude session carries today's finding, got: ${claude.stdout}`);
  assert.deepEqual((await sessionsOf(bots)).map((one) => one.name), ['far-claude']);
  assert.equal((await sessionOf(bots, 'far-claude')).work_dir, workDir);
});

for (const [label, spelled] of [
  ['given relative', () => 'work/link'],
  ['given absolute', (bots) => path.join(botHomeOf(bots, BOT), 'work', 'link')],
]) {
  test(`R1 session add on a Codex bot refuses a work dir inside by spelling that a link the user made takes outside, ${label}`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, 'codex');
    const outside = path.join(box.root, 'clones', 'api');
    await mkdir(outside, { recursive: true });
    await mkdir(path.join(botHomeOf(bots, BOT), 'work'), { recursive: true });
    await symlink(outside, path.join(botHomeOf(bots, BOT), 'work', 'link'));
    const workDir = spelled(bots);
    const before = await stateOf(box, bots);

    const result = await add(box, 'daily', ['--work-dir', workDir]);

    await assertCodexRefusal(result, bots, workDir);
    assert.deepEqual(await stateOf(box, bots), before);
    assert.deepEqual(await sessionsOf(bots), []);
  });
}

test('R1 session add on a Codex bot refuses a work dir spelled outside even when a link takes it back inside the bot home', async (t) => {
  // The launch line would name the spelled path with --add-dir, and the link
  // can be pointed elsewhere later.
  const box = await createSandbox(t);
  const bots = await withBot(box, 'codex');
  const inside = path.join(botHomeOf(bots, BOT), 'work', 'x');
  await mkdir(inside, { recursive: true });
  await mkdir(path.join(box.root, 'elsewhere'), { recursive: true });
  const workDir = path.join(box.root, 'elsewhere', 'l');
  await symlink(inside, workDir);
  const before = await stateOf(box, bots);

  const result = await add(box, 'daily', ['--work-dir', workDir]);

  await assertCodexRefusal(result, bots, workDir);
  assert.deepEqual(await stateOf(box, bots), before);
  assert.deepEqual(await sessionsOf(bots), []);
});

// ------------------------------------------------------- R7 inside is accepted

for (const [label, given] of INSIDE) {
  test(`R7 session add on a Codex bot takes ${label}, as written`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, 'codex');
    const workDir = given(box, bots);

    const result = await add(box, 'daily', ['--work-dir', workDir]);

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    assert.equal((await sessionOf(bots, 'daily')).work_dir, workDir);
  });
}

test('R7 session add on a Codex bot takes a link inside the bot home to another folder inside it', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'codex');
  const home = botHomeOf(bots, BOT);
  await mkdir(path.join(home, 'work', 'real'), { recursive: true });
  await symlink(path.join(home, 'work', 'real'), path.join(home, 'work', 'link'));

  const result = await add(box, 'daily', ['--work-dir', 'work/link']);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.equal((await sessionOf(bots, 'daily')).work_dir, 'work/link');
});

test('R1 through a link to the bots folder, a Codex work dir spelled through that link is refused, and changes nothing', async (t) => {
  // The kit takes the bots folder by its real path, so this spelling is not
  // in the bot home: the launch line would name it with --add-dir, and the
  // link can be pointed elsewhere later.
  const box = await createSandbox(t);
  const bots = await withBot(box, 'codex');
  await symlink(box.path('bots'), box.path('linked-bots'));
  const workDir = path.join(box.path('linked-bots'), 'bots', BOT, 'work', 'api');
  const before = await stateOf(box, bots);

  const result = await add(box, 'daily', ['--work-dir', workDir], { bots: 'linked-bots' });

  await assertCodexRefusal(result, bots, workDir);
  assert.deepEqual(await stateOf(box, bots), before);
  assert.deepEqual(await sessionsOf(bots), []);
});

test('R7 through a link to the bots folder, a Codex session with a relative work dir inside is taken', async (t) => {
  // #164: a bots folder reached through a link is the same fleet.
  const box = await createSandbox(t);
  const bots = await withBot(box, 'codex');
  await symlink(box.path('bots'), box.path('linked-bots'));

  const result = await add(box, 'daily', ['--work-dir', 'work/api'], { bots: 'linked-bots' });

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.equal((await sessionOf(bots, 'daily')).work_dir, 'work/api');
});

// ------------------------------------------------------- R2 session change --work-dir

for (const [label, given] of OUTSIDE) {
  test(`R2 session change --work-dir on a Codex session refuses ${label}, and changes nothing`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withSession(box, 'codex', ['--work-dir', 'work/api']);
    const workDir = given(box, bots);
    const before = await stateOf(box, bots);

    const result = await change(box, 'daily', ['--work-dir', workDir]);

    await assertCodexRefusal(result, bots, workDir);
    assert.deepEqual(await stateOf(box, bots), before, 'bot.yaml byte for byte as before');
    assert.equal((await sessionOf(bots, 'daily')).work_dir, 'work/api');
  });
}

test('R2 session change --work-dir refuses for a Codex session of a Claude bot, whose own harness is codex', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSession(box, 'claude', ['--harness', 'codex']);
  const workDir = path.join(box.root, 'clones', 'api');
  const before = await stateOf(box, bots);

  const result = await change(box, 'daily', ['--work-dir', workDir]);

  await assertCodexRefusal(result, bots, workDir);
  assert.deepEqual(await stateOf(box, bots), before);
});

test('R2 session change --harness codex --work-dir <outside> on a Claude session is refused, and changes nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSession(box, 'claude');
  const workDir = path.join(box.root, 'clones', 'api');
  const before = await stateOf(box, bots);

  const result = await change(box, 'daily', ['--harness', 'codex', '--work-dir', workDir]);

  await assertCodexRefusal(result, bots, workDir);
  assert.deepEqual(await stateOf(box, bots), before);
  const session = await sessionOf(bots, 'daily');
  assert.equal(session.harness ?? 'claude', 'claude', 'still on Claude');
  assert.equal('work_dir' in session, false);
});

test('R2 R6 session change --harness claude --work-dir <outside> on a Codex session goes through: after it, the session is not on Codex', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSession(box, 'codex', ['--work-dir', 'work/api']);
  const workDir = path.join(box.root, 'clones', 'api');

  const result = await change(box, 'daily', ['--harness', 'claude', '--work-dir', workDir]);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  const session = await sessionOf(bots, 'daily');
  assert.equal(session.harness, 'claude');
  assert.equal(session.work_dir, workDir);
});

// ------------------------------------------------------- R3 session change --harness codex

for (const was of ['claude', 'pi']) {
  test(`R3 session change --harness codex refuses to move a ${was} session whose work dir is outside, and changes nothing`, async (t) => {
    const box = await createSandbox(t);
    const workDir = path.join(box.root, 'clones', 'api');
    const bots = await withSession(box, was, ['--work-dir', workDir]);
    const before = await stateOf(box, bots);

    const result = await change(box, 'daily', ['--harness', 'codex']);

    await assertCodexRefusal(result, bots, workDir);
    assert.deepEqual(await stateOf(box, bots), before, 'bot.yaml byte for byte as before');
    assert.equal((await sessionOf(bots, 'daily')).harness ?? was, was, `still on ${was}`);
  });

  test(`R3 session change --harness codex moves a ${was} session whose work dir is inside, as today`, async (t) => {
    // The contrast: the move itself is allowed, so the refusal above is about the work dir.
    const box = await createSandbox(t);
    const bots = await withSession(box, was, ['--work-dir', 'work/api']);

    const result = await change(box, 'daily', ['--harness', 'codex']);

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    const session = await sessionOf(bots, 'daily');
    assert.equal(session.harness, 'codex');
    assert.equal(session.work_dir, 'work/api');
  });
}

test('R3 session change --harness codex refuses a relative outside work dir, resolved against the bot home', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSession(box, 'claude', ['--work-dir', '../shared-clones']);
  const before = await stateOf(box, bots);

  const result = await change(box, 'daily', ['--harness', 'codex']);

  await assertCodexRefusal(result, bots, '../shared-clones');
  assert.deepEqual(await stateOf(box, bots), before);
});

test('R3 R7 session change --harness codex with a --work-dir inside, on a session whose work dir was outside, goes through', async (t) => {
  // After the change the session is on Codex with a work dir inside: nothing widens.
  const box = await createSandbox(t);
  const bots = await withSession(box, 'claude', ['--work-dir', path.join(box.root, 'clones', 'api')]);

  const result = await change(box, 'daily', ['--harness', 'codex', '--work-dir', 'work/api']);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  const session = await sessionOf(bots, 'daily');
  assert.equal(session.harness, 'codex');
  assert.equal(session.work_dir, 'work/api');
});

// ------------------------------------------------------- R4 nothing widens

/** api-bot on Codex with its daily session, whose outside work dir the user wrote into bot.yaml by hand. */
async function handWrittenOutside(box, workDir) {
  const bots = await withSession(box, 'codex', ['--model', 'gpt-5.4']);
  await workDirByHand(bots, BOT, 'daily', workDir);
  return bots;
}

for (const [label, rest, expected] of [
  ['only --model', () => ['--model', 'gpt-5.5'], { model: 'gpt-5.5' }],
  ['--work-dir with the same path it already has', (workDir) => ['--work-dir', workDir], { model: 'gpt-5.4' }],
  ['--harness codex, the harness it already runs on', () => ['--harness', 'codex'], { model: 'gpt-5.4' }],
]) {
  test(`R4 session change with ${label} on a Codex session whose hand-written work dir is outside goes through`, async (t) => {
    const box = await createSandbox(t);
    const workDir = path.join(box.root, 'clones', 'api');
    const bots = await handWrittenOutside(box, workDir);

    const result = await change(box, 'daily', rest(workDir));

    assert.equal(result.code, 0, `nothing widens, so nothing is refused, got:\n${result.stdout}${result.stderr}`);
    const session = await sessionOf(bots, 'daily');
    assert.equal(session.work_dir, workDir, 'the work dir the user wrote stays');
    assert.equal(session.model, expected.model);
  });
}

test('R4 session change --work-dir= on a Codex session whose hand-written work dir is outside clears it', async (t) => {
  const box = await createSandbox(t);
  const bots = await handWrittenOutside(box, path.join(box.root, 'clones', 'api'));

  const result = await change(box, 'daily', ['--work-dir=']);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.equal('work_dir' in (await sessionOf(bots, 'daily')), false);
});

test('R4 R7 session change --work-dir work/api on a Codex session whose hand-written work dir is outside goes through', async (t) => {
  const box = await createSandbox(t);
  const bots = await handWrittenOutside(box, path.join(box.root, 'clones', 'api'));

  const result = await change(box, 'daily', ['--work-dir', 'work/api']);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.equal((await sessionOf(bots, 'daily')).work_dir, 'work/api');
});

test('R2 R4 a Codex session whose hand-written work dir is outside may not be given another folder outside', async (t) => {
  // R4 is about the same path; a different outside folder is a new write scope.
  const box = await createSandbox(t);
  const bots = await handWrittenOutside(box, path.join(box.root, 'clones', 'api'));
  const workDir = path.join(box.root, 'clones', 'web');
  const before = await stateOf(box, bots);

  const result = await change(box, 'daily', ['--work-dir', workDir]);

  await assertCodexRefusal(result, bots, workDir);
  assert.deepEqual(await stateOf(box, bots), before);
});

// ------------------------------------------------------- R5 approval does not matter

/** Set api-bot's daily to `approval`, as the owner does. */
async function approve(box, approval) {
  const set = await box.run(['permission', 'approval', '--bots', 'bots', '--bot', BOT, '--session', 'daily', '--approval', approval]);
  assert.equal(set.code, 0, `${set.stdout}${set.stderr}`);
}

test('R5 a Codex session at dangerously-skip is refused a work dir outside by session change --work-dir', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSession(box, 'codex', ['--work-dir', 'work/api']);
  await approve(box, 'dangerously-skip');
  assert.equal((await sessionOf(bots, 'daily')).approval, 'dangerously-skip', 'the premise');
  const workDir = path.join(box.root, 'clones', 'api');
  const before = await stateOf(box, bots);

  const result = await change(box, 'daily', ['--work-dir', workDir]);

  await assertCodexRefusal(result, bots, workDir);
  assert.deepEqual(await stateOf(box, bots), before);
});

test('R5 a Claude session at dangerously-skip with a work dir outside is refused the move to Codex', async (t) => {
  const box = await createSandbox(t);
  const workDir = path.join(box.root, 'clones', 'api');
  const bots = await withSession(box, 'claude', ['--work-dir', workDir]);
  await approve(box, 'dangerously-skip');
  const before = await stateOf(box, bots);

  const result = await change(box, 'daily', ['--harness', 'codex']);

  await assertCodexRefusal(result, bots, workDir);
  assert.deepEqual(await stateOf(box, bots), before);
});

// ------------------------------------------------------- R6 Claude and Pi stay as today

for (const harness of ['claude', 'pi']) {
  test(`R6 session add on a ${harness} bot takes a work dir outside, as written, with the work-dir finding`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, harness);
    const workDir = path.join(box.root, 'clones', 'api');

    const json = answerOf(await add(box, 'daily', ['--work-dir', workDir, '--json']));
    const plain = await add(box, 'plain', ['--work-dir', workDir]);

    const found = workDirFindings(json);
    assert.equal(found.length, 1, `one work-dir finding, got: ${JSON.stringify(json.found)}`);
    assert.equal(found[0].where, workDir);
    assert.equal(plain.code, 0, `${plain.stdout}${plain.stderr}`);
    assert.ok(plain.stdout.split('\n').includes(`work-dir   ${workDir}`), `the plain finding line, got:\n${plain.stdout}`);
    assert.equal((await sessionOf(bots, 'daily')).work_dir, workDir);
    assert.equal((await sessionOf(bots, 'plain')).work_dir, workDir);
  });

  test(`R6 session change --work-dir on a ${harness} session takes a work dir outside, with the work-dir finding`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withSession(box, harness, ['--work-dir', 'work/api']);

    const answer = answerOf(await change(box, 'daily', ['--work-dir', '../shared-clones', '--json']));

    const found = workDirFindings(answer);
    assert.equal(found.length, 1, `one work-dir finding, got: ${JSON.stringify(answer.found)}`);
    assert.equal(found[0].where, path.join(bots, 'bots', 'shared-clones'));
    assert.equal((await sessionOf(bots, 'daily')).work_dir, '../shared-clones');
  });
}

// ------------------------------------------------------- R9 temp make

test('R9 a temporary session a Codex session makes gets work/<name>, and its line names no --add-dir for it, even when its maker\'s work dir is outside', async (t) => {
  const box = await createSandbox(t);
  const codex = await fakeProgram(box, 'codex', {});
  const outside = path.join(box.root, 'clones', 'api');
  const bots = await withSession(box, 'codex');
  await workDirByHand(bots, BOT, 'daily', outside);
  const up = await box.run(['up', '--bots', 'bots', '--bot', BOT]);
  assert.equal(up.code, 0, `${up.stdout}${up.stderr}`);
  const maker = (await tabsOfBot(box, bots, BOT))[0];
  const env = { ...box.env, ORCA_TERMINAL_HANDLE: maker.handle, ORCA_TAB_ID: maker.tabId, ...kitLaunchMark(box, maker) };

  const made = await box.run(['temp', 'make', '--bots', 'bots', '--name', 'scout', '--prompt', 'Read the open pull request.'], { env });

  assert.equal(made.code, 0, `${made.stdout}${made.stderr}`);
  const home = botHomeOf(bots, BOT);
  const entry = await sessionOf(bots, 'scout');
  assert.equal(path.resolve(home, entry.work_dir), path.join(home, 'work', 'scout'), `its work dir is work/scout, got: ${JSON.stringify(entry)}`);
  const tab = (await sessionIn(bots, BOT, 'scout'))?.tab;
  const terminal = (await tabsOfBot(box, bots, BOT)).find((one) => one.tabId === tab);
  assert.ok(terminal, 'the premise: scout has a tab');
  const line = typedInto(terminal)[0];
  const before = (await codex.calls()).length;
  const ran = await sh(harnessPartOf(line), { cwd: box.cwd, env: box.env });
  assert.equal(ran.code, 0, `the line should run: ${line}\n${ran.stderr}`);
  const argv = (await codex.calls()).slice(before)[0]?.args ?? [];
  const addDirs = argv.flatMap((word, at) => (word === '--add-dir' ? [argv[at + 1]] : []));
  assert.ok(argv.length > 0, `the line started Codex, got: ${line}`);
  assert.deepEqual([...addDirs].sort(), [...kitDirsOf(bots, BOT)].sort(), `only the kit's own three folders: not the maker's ${outside}, got: ${JSON.stringify(argv)}`);
});
