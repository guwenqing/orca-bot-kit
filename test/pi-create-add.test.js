// Pi slice 1 (#578), the files a Pi bot and a Pi session are written as:
// `obk bot create --harness pi`, `obk session add` on Pi, `obk permission
// approval` on a Pi session, and the extra arguments a Pi session refuses.
//
// The owner's decision (#547): Pi has no approval prompt and no permission
// rules, so every Pi session counts as `dangerously-skip`, and the kit refuses
// `auto` and `ask` for Pi and says why. Pi has no context setting either: a
// model's name carries it (cursor/claude-opus-5-5@1m). And `--approve` (or
// `-a`) makes Pi trust project-local files, so an extra argument may not carry
// it; the kit puts `--no-approve` on every Pi launch line itself.
//
// Every run is in the sandbox (helpers/cli.js): its own HOME, a fake Orca, and
// a fake `pi` on its PATH (helpers/pi.js). Nothing here starts Pi.

import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import { refuseApprovalArgs } from '../src/launch.js';
import {
  assertRefused,
  botHomeOf,
  createSandbox,
  skipGit,
  snapshot,
} from './helpers/cli.js';
import { fakePi } from './helpers/pi.js';

const PROMPT = 'You keep the API bot\'s day running.';

const exists = (file) => access(file).then(() => true, () => false);

/**
 * A bots folder `init` made, with one bot on `harness`. A fake `pi` is on
 * PATH, so a kit that asks Pi anything here asks the fake, never the real one.
 */
async function withBot(box, harness = 'pi', bot = 'pi-bot') {
  await fakePi(box);
  const init = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(init.code, 0, init.stderr);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness]);
  assert.equal(made.code, 0, `obk bot create --harness ${harness}: ${made.stdout}${made.stderr}`);
  return box.path('bots');
}

const botFile = (bots, bot = 'pi-bot') => path.join(botHomeOf(bots, bot), 'bot.yaml');
const botDoc = async (bots, bot = 'pi-bot') => parse(await readFile(botFile(bots, bot), 'utf8'));

/** One session's entry, and a clear failure when there is not exactly one. */
async function sessionOf(bots, name, bot = 'pi-bot') {
  const sessions = (await botDoc(bots, bot)).sessions ?? [];
  const found = sessions.filter((one) => one?.name === name);
  assert.equal(found.length, 1, `one session should be called ${name}, got: ${JSON.stringify(sessions)}`);
  return found[0];
}

const sessionAdd = (box, bot, name, ...rest) => box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', name, ...rest]);
const sessionChange = (box, bot, name, ...rest) => box.run(['session', 'change', '--bots', 'bots', '--bot', bot, '--session', name, ...rest]);
const approval = (box, bot, name, level) => box.run(['permission', 'approval', '--bots', 'bots', '--bot', bot, '--session', name, '--approval', level]);

/** What a refusal of `auto` or `ask` on Pi says (#547): why, and what every Pi session runs as. */
function assertSaysWhyPiIsDangerouslySkip(result) {
  const said = result.stdout + result.stderr;
  assert.match(said, /\bPi\b/, `the refusal should name Pi, got:\n${said}`);
  assert.match(said, /approval prompt/i, `it should say Pi has no approval prompt, got:\n${said}`);
  assert.match(said, /permission rules/i, `it should say Pi has no permission rules, got:\n${said}`);
  assert.ok(said.includes('dangerously-skip'), `it should say every Pi session runs as dangerously-skip, got:\n${said}`);
}

// ----------------------------------------------------------------- 1. bot create

test('P1 bot create --harness pi writes a bot on Pi', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);

  const doc = await botDoc(bots);
  assert.equal(doc.name, 'pi-bot');
  assert.equal(doc.harness, 'pi', `bot.yaml should say harness: pi, got: ${JSON.stringify(doc)}`);
  assert.deepEqual(doc.sessions, [], 'a new bot has no sessions until one is added');
});

test('P1 a Pi bot gets no permission rules file for either harness', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const home = botHomeOf(bots, 'pi-bot');

  assert.equal(await exists(path.join(home, '.codex', 'rules', 'obk.rules')), false, 'no Codex rules file for a Pi bot');
  const claudeSettings = path.join(home, '.claude', 'settings.json');
  if (await exists(claudeSettings)) {
    const settings = JSON.parse(await readFile(claudeSettings, 'utf8'));
    assert.deepEqual(settings?.permissions?.allow ?? [], [], `no Claude permission rules for a Pi bot, got: ${JSON.stringify(settings)}`);
  }
});

test('P1 the usage text names pi beside claude and codex for bot create', async (t) => {
  const box = await createSandbox(t);

  const help = await box.run(['--help']);

  assert.equal(help.code, 0, help.stderr);
  const line = help.stdout.split('\n').find((one) => one.includes('obk bot create'));
  assert.ok(line, `the usage should have a bot create line, got:\n${help.stdout}`);
  for (const harness of ['claude', 'codex', 'pi']) {
    assert.match(line, new RegExp(`\\b${harness}\\b`), `the bot create line should name ${harness}, got: ${line}`);
  }
});

test('P1 the refusal of an unknown harness names claude, codex and pi', async (t) => {
  const box = await createSandbox(t);
  await withBot(box, 'claude', 'api-bot');

  const result = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'other-bot', '--harness', 'gemini']);

  assertRefused(result, 'gemini');
  for (const harness of ['claude', 'codex', 'pi']) {
    assert.match(result.stderr, new RegExp(`\\b${harness}\\b`), `the refusal should name ${harness}, got: ${result.stderr}`);
  }
});

// ----------------------------------------------------------------- 2. session add

test('P2 session add --harness pi on a Claude bot writes the session with approval: dangerously-skip', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'claude', 'api-bot');

  const result = await sessionAdd(box, 'api-bot', 'daily', '--harness', 'pi');

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.deepEqual(await sessionOf(bots, 'daily', 'api-bot'), { name: 'daily', harness: 'pi', approval: 'dangerously-skip' });
});

test('P2 a session added to a Pi bot with no --harness is written with approval: dangerously-skip', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);

  const result = await sessionAdd(box, 'pi-bot', 'daily');

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  const session = await sessionOf(bots, 'daily');
  assert.equal(session.approval, 'dangerously-skip', `got: ${JSON.stringify(session)}`);
  assert.ok(session.harness === undefined || session.harness === 'pi', `the session runs on the bot's Pi, got: ${JSON.stringify(session)}`);
});

test('P2 a session on a Codex bot is still written with approval: auto', async (t) => {
  // The Pi default is Pi's alone: the other harnesses keep theirs (ADR 0015).
  const box = await createSandbox(t);
  const bots = await withBot(box, 'codex', 'api-bot');

  assert.equal((await sessionAdd(box, 'api-bot', 'daily')).code, 0);

  assert.equal((await sessionOf(bots, 'daily', 'api-bot')).approval, 'auto');
});

test('P2 a Pi session takes --model, --effort, --prompt, --work-dir and --extra-arg as the other harnesses do', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);

  const result = await sessionAdd(
    box, 'pi-bot', 'daily',
    '--model', 'anthropic/claude-opus-5-5',
    '--effort', 'high',
    '--prompt', PROMPT,
    '--work-dir', 'work/api',
    '--extra-arg=--verbose',
    '--extra-arg=--no-tools',
  );

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  const session = await sessionOf(bots, 'daily');
  assert.deepEqual(
    { ...session, prompt: String(session.prompt).trim() },
    {
      name: 'daily',
      approval: 'dangerously-skip',
      model: 'anthropic/claude-opus-5-5',
      effort: 'high',
      prompt: PROMPT,
      work_dir: 'work/api',
      extra_args: ['--verbose', '--no-tools'],
    },
  );
});

test('P2 a Pi session takes --prompt-file', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  await writeFile(path.join(botHomeOf(bots, 'pi-bot'), 'daily.md'), `${PROMPT}\n`);

  const result = await sessionAdd(box, 'pi-bot', 'daily', '--prompt-file', 'daily.md');

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  const session = await sessionOf(bots, 'daily');
  assert.equal(session.prompt_file, 'daily.md');
  assert.equal(session.approval, 'dangerously-skip');
});

for (const [label, bot, harness, extra] of [
  ['on a Pi bot', 'pi-bot', 'pi', []],
  ['with --harness pi on a Claude bot', 'api-bot', 'claude', ['--harness', 'pi']],
]) {
  test(`P2 --context on a Pi session ${label} is refused, says Pi has no context setting and the model's name carries it, and writes nothing`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, harness, bot);
    const before = await snapshot(bots, skipGit);

    const result = await sessionAdd(box, bot, 'daily', ...extra, '--model', 'anthropic/claude-opus-5-5', '--context', '1m');

    assertRefused(result);
    const said = result.stdout + result.stderr;
    assert.match(said, /\bPi\b/, `the refusal should name Pi, got:\n${said}`);
    assert.match(said, /no context setting/i, `it should say Pi has no context setting, got:\n${said}`);
    assert.match(said, /model's name|model name|name of the model/i, `it should say the model's name carries it, got:\n${said}`);
    assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
  });
}

// ----------------------------------------------------------------- 4. permission approval

for (const level of ['auto', 'ask']) {
  test(`P4 permission approval --approval ${level} on a Pi session is refused, says why, and changes nothing`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    assert.equal((await sessionAdd(box, 'pi-bot', 'daily')).code, 0);
    const before = await snapshot(bots, skipGit);

    const result = await approval(box, 'pi-bot', 'daily', level);

    assertRefused(result);
    assertSaysWhyPiIsDangerouslySkip(result);
    assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
  });

  test(`P4 permission approval --approval ${level} on a Pi session of a Claude bot is refused too`, async (t) => {
    // The session's own harness decides, not the bot's.
    const box = await createSandbox(t);
    const bots = await withBot(box, 'claude', 'api-bot');
    assert.equal((await sessionAdd(box, 'api-bot', 'daily', '--harness', 'pi')).code, 0);
    const before = await snapshot(bots, skipGit);

    const result = await approval(box, 'api-bot', 'daily', level);

    assertRefused(result);
    assertSaysWhyPiIsDangerouslySkip(result);
    assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
  });
}

test('P4 permission approval --approval dangerously-skip on a Pi session is taken', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  assert.equal((await sessionAdd(box, 'pi-bot', 'daily')).code, 0);

  const result = await approval(box, 'pi-bot', 'daily', 'dangerously-skip');

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.equal((await sessionOf(bots, 'daily')).approval, 'dangerously-skip');
});

test('P4 permission approval --approval ask on a Claude session of a Pi bot is still taken', async (t) => {
  // The refusal is the Pi session's, not the Pi bot's: a Claude session there keeps its three levels.
  const box = await createSandbox(t);
  const bots = await withBot(box);
  assert.equal((await sessionAdd(box, 'pi-bot', 'review', '--harness', 'claude')).code, 0);

  const result = await approval(box, 'pi-bot', 'review', 'ask');

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.equal((await sessionOf(bots, 'review')).approval, 'ask');
});

// ----------------------------------------------------------------- 12. extra args that trust project files

for (const arg of ['--approve', '-a']) {
  test(`P12 session add of a Pi session refuses --extra-arg=${arg}, and writes nothing`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    const before = await snapshot(bots, skipGit);

    const result = await sessionAdd(box, 'pi-bot', 'daily', `--extra-arg=${arg}`);

    assertRefused(result);
    assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
  });

  test(`P12 session add --harness pi on a Claude bot refuses --extra-arg=${arg}, and writes nothing`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, 'claude', 'api-bot');
    const before = await snapshot(bots, skipGit);

    const result = await sessionAdd(box, 'api-bot', 'daily', '--harness', 'pi', `--extra-arg=${arg}`);

    assertRefused(result);
    assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
    // The refusal is the argument's: the same session with another extra argument goes through.
    const other = await sessionAdd(box, 'api-bot', 'daily', '--harness', 'pi', '--extra-arg=--verbose');
    assert.equal(other.code, 0, `${other.stdout}${other.stderr}`);
  });

  test(`P12 session change of a Pi session refuses --extra-arg=${arg}, and writes nothing`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    assert.equal((await sessionAdd(box, 'pi-bot', 'daily', '--extra-arg=--verbose')).code, 0);
    const before = await snapshot(bots, skipGit);

    const result = await sessionChange(box, 'pi-bot', 'daily', `--extra-arg=${arg}`);

    assertRefused(result);
    assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
  });
}

test('P12 session add of a Pi session takes --extra-arg=--no-approve', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);

  const result = await sessionAdd(box, 'pi-bot', 'daily', '--extra-arg=--no-approve');

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.deepEqual((await sessionOf(bots, 'daily')).extra_args, ['--no-approve']);
});

test('P12 session change of a Pi session takes --extra-arg=--no-approve', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  assert.equal((await sessionAdd(box, 'pi-bot', 'daily')).code, 0);

  const result = await sessionChange(box, 'pi-bot', 'daily', '--extra-arg=--no-approve');

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.deepEqual((await sessionOf(bots, 'daily')).extra_args, ['--no-approve']);
});

test('P12 --extra-arg=-a stays a Claude session\'s own: session add --harness claude on a Pi bot takes it', async (t) => {
  // The refusal is judged by the session's harness: `-a` is Pi's and Codex's, not Claude Code's.
  const box = await createSandbox(t);
  const bots = await withBot(box);

  const result = await sessionAdd(box, 'pi-bot', 'review', '--harness', 'claude', '--extra-arg=-a');

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.deepEqual((await sessionOf(bots, 'review')).extra_args, ['-a']);
});

test('P12 refuseApprovalArgs(\'pi\', …) throws for --approve and -a', () => {
  assert.throws(() => refuseApprovalArgs('pi', ['--approve']));
  assert.throws(() => refuseApprovalArgs('pi', ['-a']));
  assert.throws(() => refuseApprovalArgs('pi', ['--verbose', '--approve']), 'among other args too');
});

test('P12 refuseApprovalArgs(\'pi\', …) lets --no-approve and --thinking high through', () => {
  assert.doesNotThrow(() => refuseApprovalArgs('pi', ['--no-approve']));
  assert.doesNotThrow(() => refuseApprovalArgs('pi', ['--thinking', 'high']));
});
