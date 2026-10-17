// A session moves to Pi (#589).
//
// `obk session change --bots <b> --bot <bot> --session <s> --harness pi` is a
// supported move, as the moves between claude and codex are (#565): the usage
// line of `session change` names claude, codex and pi for --harness, and the
// move writes `harness: pi` into the session's entry in bot.yaml. The model,
// effort and context the session had come out, unless the same call gives
// them, and the answer says it moved from the old harness to pi.
//
// The rules of Pi slice 1 (#578) hold for a session that moves to Pi:
//
//   - every Pi session counts as `dangerously-skip` (#547). A move to Pi of a
//     session whose approval is `auto` or `ask` is refused, says why, and
//     writes nothing. `session change` does not widen an approval (ADR 0041),
//     so a session with no approval key, which counts as its old harness's
//     default (auto on Claude and on Codex), is refused too. That refusal
//     names the road: Bot Father runs `obk permission approval ...
//     --approval dangerously-skip` after the user's yes. Bot Father's own
//     `daily`, as `init` writes it, is the main case;
//   - a kept or given extra argument `-a` or `--approve` makes Pi trust
//     project files, so it refuses the move; `--no-approve` is taken;
//   - a start prompt that begins with `@` after the trim is refused (Pi reads
//     it as a file to attach);
//   - Pi has no context setting, so `--context` with `--harness pi` is refused;
//   - `obk up` of the moved session refuses before anything is made in Orca
//     when Pi does not run or has no model the session can use, and otherwise
//     types a Pi line that carries `--no-approve` and the kit's own new
//     `--session-id`, and the book keeps the old Claude conversation in the
//     session's history as `{ ended: 'harness changed', harness: 'claude' }`.
//
// Pi's other slices (mail, temp make on Pi, skills, health, session clear and
// compact on Pi) are out of scope here.
//
// Every run is in the sandbox (helpers/cli.js): its own HOME, a fake Orca, and
// a fake `pi` on its PATH (helpers/pi.js). Nothing here starts a real harness.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import {
  assertRefused,
  botHomeOf,
  conversationOnRecord,
  createSandbox,
  orcaCommand,
  recordSession,
  sessionIn,
  sh,
  skipGit,
  snapshot,
  tabsOfBot,
  typedInto,
} from './helpers/cli.js';
import { envWithoutPi, fakePi, PI_ID } from './helpers/pi.js';

const BOT = 'api-bot';
const PROMPT = 'Read your AGENTS.md and keep the queue moving.';
const PI_MODEL = 'anthropic/claude-opus-5-5';

/** A conversation id shaped the way Claude Code and Codex shape them. */
const conv = (n) => `0199b2c0-${String(n).padStart(4, '0')}-4444-8888-cccccccccccc`;

// ------------------------------------------------ helpers: the bots folder

const run = (box, args, options) => box.run(args, options);

/**
 * A bots folder `init` made, with api-bot on `harness` and its session daily
 * added with `settings`. A fake `pi` is on PATH unless `env` is given, so a kit
 * that asks Pi anything here asks the fake, never the real one.
 */
async function withSession(box, { harness = 'claude', settings = [], env, pi = true } = {}) {
  if (pi) await fakePi(box);
  const options = env === undefined ? undefined : { env };
  const init = await run(box, ['init', '--bots', 'bots', '--harness', 'claude'], options);
  assert.equal(init.code, 0, init.stderr);
  const made = await run(box, ['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', harness], options);
  assert.equal(made.code, 0, `${made.stdout}${made.stderr}`);
  const added = await run(box, ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily', ...settings], options);
  assert.equal(added.code, 0, `${added.stdout}${added.stderr}`);
  return box.path('bots');
}

/** Set a session's approval through the public command, as Bot Father does after the user's yes. */
async function approve(box, level, { bot = BOT, session = 'daily', env } = {}) {
  const result = await run(
    box,
    ['permission', 'approval', '--bots', 'bots', '--bot', bot, '--session', session, '--approval', level],
    env === undefined ? undefined : { env },
  );
  assert.equal(result.code, 0, `obk permission approval --approval ${level}: ${result.stdout}${result.stderr}`);
}

/** A session at dangerously-skip on `harness`, added with `settings`, ready to move to Pi. */
async function skipping(box, { harness = 'claude', settings = [], env, pi } = {}) {
  const bots = await withSession(box, { harness, settings, env, pi });
  await approve(box, 'dangerously-skip', { env });
  assert.equal((await entryOf(bots)).approval, 'dangerously-skip', 'the premise: the session is at dangerously-skip');
  return bots;
}

/** `obk session change` of `bot`'s session `session`, with the rest of the arguments given. */
const change = (box, rest, { bot = BOT, session = 'daily', env } = {}) =>
  run(box, ['session', 'change', '--bots', 'bots', '--bot', bot, '--session', session, ...rest], env === undefined ? undefined : { env });

const botFile = (bots, bot = BOT) => path.join(botHomeOf(bots, bot), 'bot.yaml');

/** The one session called `name` in the bot's bot.yaml, as it is written now. */
async function entryOf(bots, name = 'daily', bot = BOT) {
  const sessions = parse(await readFile(botFile(bots, bot), 'utf8')).sessions ?? [];
  const found = sessions.filter((session) => session?.name === name);
  assert.equal(found.length, 1, `one session should be called ${name}, got: ${JSON.stringify(sessions)}`);
  return found[0];
}

/** Write `changes` into one session's entry in bot.yaml by hand; a key set to undefined is taken out. */
async function editEntry(bots, name, changes, bot = BOT) {
  const file = botFile(bots, bot);
  const written = parse(await readFile(file, 'utf8'));
  written.sessions = written.sessions.map((session) => {
    if (session.name !== name) return session;
    const next = { ...session, ...changes };
    for (const [key, value] of Object.entries(changes)) if (value === undefined) delete next[key];
    return next;
  });
  await writeFile(file, stringify(written));
}

/** The answer of a `--json` run, parsed. */
function jsonOf(result) {
  assert.equal(result.code, 0, `the run should have gone through, got:\n${result.stdout}${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
}

/** What a refusal of `auto` or `ask` on Pi says (#547), as test/pi-create-add.test.js checks it. */
function assertSaysWhyPiIsDangerouslySkip(result) {
  const said = result.stdout + result.stderr;
  assert.match(said, /\bPi\b/, `the refusal should name Pi, got:\n${said}`);
  assert.match(said, /approval prompt/i, `it should say Pi has no approval prompt, got:\n${said}`);
  assert.match(said, /permission rules/i, `it should say Pi has no permission rules, got:\n${said}`);
  assert.ok(said.includes('dangerously-skip'), `it should say every Pi session runs as dangerously-skip, got:\n${said}`);
}

/** The refusal of a prompt that begins with @, as test/pi-prompt-at.test.js checks it. */
function assertRefusedForAt(result, session = 'daily') {
  assert.notEqual(result.code, 0, `this should have been refused, got:\n${result.stdout}${result.stderr}`);
  const said = result.stdout + result.stderr;
  assert.ok(!/^\s+at /m.test(said), `expected a message, got a crash:\n${said}`);
  assert.ok(said.includes(session), `the refusal should name the session ${session}, got:\n${said}`);
  assert.match(said, /\bPi\b/, `it should name Pi, got:\n${said}`);
  assert.match(said, /attach/i, `it should say Pi would read the prompt as a file to attach, got:\n${said}`);
  assert.ok(said.includes('@'), `it should ask for a prompt that does not begin with @, got:\n${said}`);
}

// ------------------------------------------------ helpers: Orca and Pi

const orcaNow = async (box) => ({
  calls: (await box.orca.calls()).length,
  terminals: await box.orca.terminals(),
  setups: await box.orca.setups(),
});

/** A plain refusal, and nothing asked of Orca but its read-only `status`: no project, no tab, no send. */
async function assertRefusedBeforeOrca(box, result, before) {
  assert.notEqual(result.code, 0, `this should have been refused, got:\n${result.stdout}${result.stderr}`);
  const said = result.stdout + result.stderr;
  assert.notEqual(said.trim(), '', 'a refusal with nothing said is no use to anybody');
  assert.ok(!/^\s+at /m.test(said), `expected a message, got a crash:\n${said}`);
  const asked = (await box.orca.calls()).slice(before.calls).filter((call) => orcaCommand(call) !== 'status');
  assert.deepEqual(asked.map((call) => call.args.join(' ')), [], `Orca should have been asked nothing but status; the run said:\n${said}`);
  assert.deepEqual(await box.orca.terminals(), before.terminals, 'no tab was opened or changed');
  assert.deepEqual(await box.orca.setups(), before.setups, 'no project was made or changed');
  return said;
}

/** The argv a shell running `line` hands `pi`: the one launch it makes, and only one. */
async function piArgvOf(box, line, pi) {
  const before = (await pi.launches()).length;
  const ran = await sh(line, { cwd: box.cwd, env: box.env });
  assert.equal(ran.code, 0, `the line should run: ${line}\n${ran.stderr}`);
  const launches = (await pi.launches()).slice(before);
  assert.equal(launches.length, 1, `the line should start pi once, and only once: ${line}`);
  return launches[0].args;
}

const valueOf = (argv, flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
const flagsOf = (argv) => (argv.includes('--') ? argv.slice(0, argv.indexOf('--')) : argv);

/** The block of the usage that a command's line starts, up to the next command's line. */
function usageBlock(usage, command) {
  const lines = usage.split('\n');
  const at = lines.findIndex((line) => line.startsWith(`  obk ${command} `) || line === `  obk ${command}`);
  if (at < 0) return undefined;
  const next = lines.findIndex((line, index) => index > at && line.startsWith('  obk '));
  return lines.slice(at, next < 0 ? undefined : next).join('\n');
}

// ================================================ 1. the usage

test('MP1 --help: the block of obk session change names claude, codex and pi for --harness', async (t) => {
  const box = await createSandbox(t);

  const help = await run(box, ['--help']);

  assert.equal(help.code, 0, help.stderr);
  const block = usageBlock(help.stdout, 'session change');
  assert.notEqual(block, undefined, `usage lists obk session change, got:\n${help.stdout}`);
  const given = /--harness\s+([a-z|]+)/.exec(block)?.[1];
  assert.ok(given, `session change should list --harness with its values, got:\n${block}`);
  assert.deepEqual(given.split('|').sort(), ['claude', 'codex', 'pi'], `--harness should name claude, codex and pi, got:\n${block}`);
});

// ================================================ 2. a dangerously-skip session moves to Pi

for (const [from, settings, defaults] of [
  ['claude', ['--model', 'sonnet', '--effort', 'high', '--context', '1m'], ['model', 'effort', 'context']],
  ['codex', ['--model', 'gpt-5', '--effort', 'high', '--context', '200000'], ['model', 'effort', 'context']],
]) {
  test(`MP2 a ${from} session at dangerously-skip moves to Pi: harness: pi is written, and its model, effort and context come out`, async (t) => {
    const box = await createSandbox(t);
    const bots = await skipping(box, { harness: from, settings: [...settings, '--prompt', PROMPT] });

    const result = await change(box, ['--harness', 'pi', '--json']);

    const answer = jsonOf(result);
    const entry = await entryOf(bots);
    assert.equal(entry.harness, 'pi', `got: ${JSON.stringify(entry)}`);
    for (const key of ['model', 'effort', 'context']) {
      assert.equal(key in entry, false, `${key} goes back to Pi's own default, got: ${JSON.stringify(entry)}`);
    }
    assert.equal(entry.approval, 'dangerously-skip', 'the approval stays as it was');
    assert.equal(String(entry.prompt).trim(), PROMPT, 'the prompt stays as it was');
    assert.deepEqual(answer.moved, { from, to: 'pi', defaults });
  });

  test(`MP2 the plain answer of a move from ${from} says it moved from ${from} to pi`, async (t) => {
    const box = await createSandbox(t);
    await skipping(box, { harness: from });

    const result = await change(box, ['--harness', 'pi']);

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    assert.match(result.stdout, new RegExp(`from ${from} to pi\\b`), `the answer should say it moved from ${from} to pi, got:\n${result.stdout}`);
  });
}

test('MP2 a model and an effort the same call gives are kept on the move to Pi, and the context still comes out', async (t) => {
  const box = await createSandbox(t);
  const bots = await skipping(box, { settings: ['--model', 'sonnet', '--effort', 'low', '--context', '1m'] });

  const result = await change(box, ['--harness', 'pi', '--model', PI_MODEL, '--effort', 'high', '--json']);

  const answer = jsonOf(result);
  const entry = await entryOf(bots);
  assert.equal(entry.harness, 'pi');
  assert.equal(entry.model, PI_MODEL, 'given in the same call, so written');
  assert.equal(entry.effort, 'high', 'given in the same call, so written');
  assert.equal('context' in entry, false, `not given, so out, got: ${JSON.stringify(entry)}`);
  assert.deepEqual(answer.moved, { from: 'claude', to: 'pi', defaults: ['context'] });
});

// ================================================ 3. auto and ask are refused

for (const [harness, level] of [['claude', 'auto'], ['claude', 'ask'], ['codex', 'auto'], ['codex', 'ask']]) {
  test(`MP3 a move to Pi of a ${harness} session at approval ${level} is refused, says why, and writes nothing`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withSession(box, { harness, settings: ['--prompt', PROMPT] });
    if (level !== 'auto') await approve(box, level);
    assert.equal((await entryOf(bots)).approval, level, `the premise: the session is written at ${level}`);
    const before = await snapshot(bots, skipGit);

    const result = await change(box, ['--harness', 'pi']);

    assertRefused(result);
    assertSaysWhyPiIsDangerouslySkip(result);
    assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
  });
}

// ================================================ 4. no approval key counts as auto

/** The road the refusal of a session with no approval key names (the architect, #589). */
function assertNamesTheRoad(result) {
  const said = result.stdout + result.stderr;
  assert.ok(said.includes('permission approval'), `the refusal should name obk permission approval, got:\n${said}`);
  assert.ok(said.includes('dangerously-skip'), `and the level it sets, dangerously-skip, got:\n${said}`);
  assert.match(said, /Bot Father/, `and say Bot Father runs it, got:\n${said}`);
  assert.match(said, /user['’]s yes/i, `and say it takes the user's yes, got:\n${said}`);
}

test('MP4 Bot Father\'s daily, as init writes it with no approval key, is refused a move to Pi, names the road, and nothing is written', async (t) => {
  const box = await createSandbox(t);
  await fakePi(box);
  assert.equal((await run(box, ['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const bots = box.path('bots');
  const daily = await entryOf(bots, 'daily', 'bot-father');
  assert.equal('approval' in daily, false, `the premise: init writes Bot Father's daily with no approval key, got: ${JSON.stringify(daily)}`);
  const before = await snapshot(bots, skipGit);

  const result = await change(box, ['--harness', 'pi'], { bot: 'bot-father' });

  assertRefused(result);
  assertNamesTheRoad(result);
  assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
});

for (const harness of ['claude', 'codex']) {
  test(`MP4 a hand-written session with no approval key on a ${harness} bot counts as auto: the move to Pi is refused, names the road, and nothing is written`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withSession(box, { harness, settings: ['--prompt', PROMPT] });
    await editEntry(bots, 'daily', { approval: undefined });
    assert.equal('approval' in (await entryOf(bots)), false, 'the premise: the entry has no approval key');
    const before = await snapshot(bots, skipGit);

    const result = await change(box, ['--harness', 'pi']);

    assertRefused(result);
    assertNamesTheRoad(result);
    assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
  });
}

test('MP4 the same hand-written session moves once Bot Father sets it to dangerously-skip through permission approval', async (t) => {
  // The control for the refusals above: the road the refusal names is the one that works.
  const box = await createSandbox(t);
  const bots = await withSession(box, { settings: ['--prompt', PROMPT] });
  await editEntry(bots, 'daily', { approval: undefined });
  await approve(box, 'dangerously-skip');

  const result = await change(box, ['--harness', 'pi']);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.equal((await entryOf(bots)).harness, 'pi');
});

// ================================================ 6. extra arguments that trust project files

for (const arg of ['-a', '--approve']) {
  test(`MP6 a move to Pi of a session that keeps ${arg} in its extra_args is refused, and nothing is written`, async (t) => {
    const box = await createSandbox(t);
    const bots = await skipping(box);
    await editEntry(bots, 'daily', { extra_args: ['--verbose', arg] });
    const before = await snapshot(bots, skipGit);

    const result = await change(box, ['--harness', 'pi']);

    assertRefused(result, arg);
    assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
  });

  test(`MP6 a move to Pi with --extra-arg=${arg} in the same call is refused, and nothing is written`, async (t) => {
    const box = await createSandbox(t);
    const bots = await skipping(box);
    const before = await snapshot(bots, skipGit);

    const result = await change(box, ['--harness', 'pi', `--extra-arg=${arg}`]);

    assertRefused(result, arg);
    assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
  });
}

test('MP6 a move to Pi of a session that keeps --no-approve in its extra_args goes through, and keeps it', async (t) => {
  const box = await createSandbox(t);
  const bots = await skipping(box);
  await editEntry(bots, 'daily', { extra_args: ['--no-approve'] });

  const result = await change(box, ['--harness', 'pi']);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  const entry = await entryOf(bots);
  assert.equal(entry.harness, 'pi');
  assert.deepEqual(entry.extra_args, ['--no-approve']);
});

// ================================================ 7. a prompt that begins with @

test('MP7 a move to Pi of a session whose prompt begins with @ after the trim is refused, and nothing is written', async (t) => {
  const box = await createSandbox(t);
  const bots = await skipping(box, { settings: ['--prompt', '  @notes.md read this first'] });
  const before = await snapshot(bots, skipGit);

  assertRefusedForAt(await change(box, ['--harness', 'pi']));
  assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
});

test('MP7 a move to Pi of a session whose prompt file begins with @ after the trim is refused, and nothing is written', async (t) => {
  const box = await createSandbox(t);
  await fakePi(box);
  assert.equal((await run(box, ['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await run(box, ['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude'])).code, 0);
  const bots = box.path('bots');
  await writeFile(path.join(botHomeOf(bots, BOT), 'daily.md'), '\n  @notes.md read this first.\n\nThen keep the queue moving.\n');
  const added = await run(box, ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily', '--prompt-file', 'daily.md']);
  assert.equal(added.code, 0, `the premise: a Claude session takes such a prompt file: ${added.stdout}${added.stderr}`);
  await approve(box, 'dangerously-skip');
  const before = await snapshot(bots, skipGit);

  assertRefusedForAt(await change(box, ['--harness', 'pi']));
  assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
});

test('MP7 a move to Pi of a session whose prompt has @ later in it goes through', async (t) => {
  const box = await createSandbox(t);
  const bots = await skipping(box, { settings: ['--prompt', 'Ask @owner first.'] });

  const result = await change(box, ['--harness', 'pi']);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  const entry = await entryOf(bots);
  assert.equal(entry.harness, 'pi');
  assert.equal(String(entry.prompt).trim(), 'Ask @owner first.');
});

test('MP7 a new prompt that begins with @, given in the same call as --harness pi, is refused, and nothing is written', async (t) => {
  const box = await createSandbox(t);
  const bots = await skipping(box, { settings: ['--prompt', PROMPT] });
  const before = await snapshot(bots, skipGit);

  assertRefusedForAt(await change(box, ['--harness', 'pi', '--prompt', '@notes.md read this first']));
  assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
});

// ================================================ 8. context

test('MP8 a move to Pi drops the context the session had', async (t) => {
  const box = await createSandbox(t);
  const bots = await skipping(box, { settings: ['--model', 'sonnet', '--context', '1m'] });

  const result = await change(box, ['--harness', 'pi']);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  const entry = await entryOf(bots);
  assert.equal(entry.harness, 'pi');
  assert.equal('context' in entry, false, `Pi has no context setting, got: ${JSON.stringify(entry)}`);
});

test('MP8 --context given in the same call as --harness pi is refused, says Pi has no context setting, and writes nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = await skipping(box, { settings: ['--model', 'sonnet', '--context', '1m'] });
  const before = await snapshot(bots, skipGit);

  const result = await change(box, ['--harness', 'pi', '--model', PI_MODEL, '--context', '1m']);

  assertRefused(result);
  const said = result.stdout + result.stderr;
  assert.match(said, /\bPi\b/, `the refusal should name Pi, got:\n${said}`);
  assert.match(said, /no context setting/i, `it should say Pi has no context setting, got:\n${said}`);
  assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
  // The move without the context goes through, so the refusal was the context's.
  const moved = await change(box, ['--harness', 'pi', '--model', PI_MODEL]);
  assert.equal(moved.code, 0, `the move without the context should go through: ${moved.stdout}${moved.stderr}`);
});

// ================================================ 5. the next up starts Pi fresh

test('MP5 up after a move from Claude to Pi types a Pi line with --no-approve and the kit\'s new --session-id, and the book keeps the Claude conversation in history', async (t) => {
  const box = await createSandbox(t);
  const pi = await fakePi(box);
  const bots = await skipping(box, { settings: ['--prompt', PROMPT] });
  const home = botHomeOf(bots, BOT);
  // Up once on Claude: the tab reports its conversation, which Claude has on record.
  const first = await run(box, ['up', '--bots', 'bots', '--bot', BOT, '--json']);
  assert.equal(first.code, 0, `${first.stdout}${first.stderr}`);
  const tab = JSON.parse(first.stdout).tabs.find((entry) => entry.name === 'daily');
  const reported = await recordSession(box, { bots, bot: BOT, tab: tab.tabId, session: conv(1), source: 'startup' });
  assert.equal(reported.code, 0, reported.stderr);
  await conversationOnRecord(box, { harness: 'claude', cwd: home, id: conv(1) });
  assert.equal((await sessionIn(bots, BOT, 'daily'))?.session, conv(1), 'the premise: the book names the Claude conversation');
  // The user closes the tab; the session moves to Pi.
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((terminal) => terminal.tabId !== tab.tabId) });
  const moved = await change(box, ['--harness', 'pi']);
  assert.equal(moved.code, 0, `${moved.stdout}${moved.stderr}`);

  const result = await run(box, ['up', '--bots', 'bots', '--bot', BOT, '--json']);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  const entries = JSON.parse(result.stdout).tabs.filter((entry) => entry.name === 'daily' && entry.created === true);
  assert.equal(entries.length, 1, `the run should report daily's new tab once, got: ${result.stdout}`);
  const live = (await tabsOfBot(box, bots, BOT)).find((terminal) => terminal.tabId === entries[0].tabId);
  assert.ok(live, `the tab reported should be one Orca has, got: ${result.stdout}`);
  const typed = typedInto(live);
  assert.equal(typed.length, 1, `one send into the new tab, got: ${JSON.stringify(typed)}`);
  assert.ok(!typed[0].includes(conv(1)), `the Claude id is nowhere on the line, got: ${typed[0]}`);
  const argv = await piArgvOf(box, typed[0], pi);
  assert.ok(flagsOf(argv).includes('--no-approve'), `the Pi line carries --no-approve, got: ${JSON.stringify(argv)}`);
  const id = valueOf(argv, '--session-id');
  assert.match(String(id), PI_ID, `the line names a new Pi conversation, got: ${JSON.stringify(argv)}`);
  assert.notEqual(id, conv(1), 'a new conversation, not the Claude one');
  assert.deepEqual(argv.slice(-2), ['--', PROMPT], `a fresh start is told its duty, got: ${JSON.stringify(argv)}`);

  const daily = await sessionIn(bots, BOT, 'daily');
  assert.equal(daily?.session, id, `the book holds the id the line carries, got: ${JSON.stringify(daily)}`);
  const last = (daily?.history ?? []).at(-1);
  assert.deepEqual(
    { session: last?.session, ended: last?.ended, harness: last?.harness },
    { session: conv(1), ended: 'harness changed', harness: 'claude' },
    `the history ends with the Claude conversation, set aside because the harness changed, got: ${JSON.stringify(daily)}`,
  );
});

// ================================================ 9. Pi not ready

test('MP9 up after a move to Pi refuses when pi is not on PATH, before anything is made in Orca', async (t) => {
  const box = await createSandbox(t);
  const env = await envWithoutPi(box);
  const where = await sh('command -v pi', { env });
  assert.notEqual(where.code, 0, `the test's PATH must hold no pi at all, found: ${where.stdout}`);
  await skipping(box, { settings: ['--prompt', PROMPT], env, pi: false });
  assert.equal((await change(box, ['--harness', 'pi'], { env })).code, 0, 'the premise: the move goes through');
  const before = await orcaNow(box);

  const said = await assertRefusedBeforeOrca(box, await run(box, ['up', '--bots', 'bots', '--bot', BOT], { env }), before);

  assert.match(said, /\bpi\b/i, `the refusal should name Pi, got:\n${said}`);
});

test('MP9 up after a move to Pi refuses when pi --version fails, before anything is made in Orca', async (t) => {
  const box = await createSandbox(t);
  const bots = await skipping(box, { settings: ['--prompt', PROMPT] });
  await fakePi(box, { version: 'fails' });
  assert.equal((await change(box, ['--harness', 'pi'])).code, 0, 'the premise: the move goes through');
  assert.equal((await entryOf(bots)).harness, 'pi');
  const before = await orcaNow(box);

  const said = await assertRefusedBeforeOrca(box, await run(box, ['up', '--bots', 'bots', '--bot', BOT]), before);

  assert.match(said, /\bpi\b/i, `the refusal should name Pi, got:\n${said}`);
});

test('MP9 up after a move to Pi refuses when Pi lists no model, and tells the user to sign in, before anything is made in Orca', async (t) => {
  const box = await createSandbox(t);
  await skipping(box, { settings: ['--prompt', PROMPT] });
  const pi = await fakePi(box, { signedIn: false });
  assert.equal((await change(box, ['--harness', 'pi'])).code, 0, 'the premise: the move goes through');
  const before = await orcaNow(box);

  const said = await assertRefusedBeforeOrca(box, await run(box, ['up', '--bots', 'bots', '--bot', BOT]), before);

  assert.match(said, /sign in/i, `the refusal should tell the user to sign in to Pi, got:\n${said}`);
  assert.equal((await pi.launches()).length, 0, 'and started no Pi session');
});

test('MP9 up after a move to Pi with a model Pi has none matching refuses, names the model, before anything is made in Orca', async (t) => {
  const box = await createSandbox(t);
  const pi = await fakePi(box);
  await skipping(box, { settings: ['--prompt', PROMPT], pi: false });
  assert.equal((await change(box, ['--harness', 'pi', '--model', 'nosuch/model-x'])).code, 0, 'the premise: the move goes through');
  const before = await orcaNow(box);

  const said = await assertRefusedBeforeOrca(box, await run(box, ['up', '--bots', 'bots', '--bot', BOT]), before);

  assert.ok(said.includes('nosuch/model-x'), `the refusal should name the model, got:\n${said}`);
  assert.ok((await pi.searches()).includes('nosuch/model-x'), `it asked Pi for that model, got: ${JSON.stringify(await pi.searches())}`);
  assert.equal((await pi.launches()).length, 0, 'and started no Pi session');
});

test('MP9 up after a move to Pi with a model Pi has goes up', async (t) => {
  // The control for the refusals above: the same fleet, a Pi that is ready.
  const box = await createSandbox(t);
  const pi = await fakePi(box);
  await skipping(box, { settings: ['--prompt', PROMPT], pi: false });
  assert.equal((await change(box, ['--harness', 'pi', '--model', PI_MODEL])).code, 0, 'the premise: the move goes through');

  const result = await run(box, ['up', '--bots', 'bots', '--bot', BOT]);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.ok((await pi.searches()).includes(PI_MODEL), `it asked Pi for the model, got: ${JSON.stringify(await pi.searches())}`);
});
