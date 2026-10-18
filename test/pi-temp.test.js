// A temporary session on Pi (#648, R1). `obk temp make` makes one, as it makes
// one on Claude Code or Codex, and `obk temp retire` retires it:
//
//   P1  Where Pi comes from: `--harness pi` on a Claude Code or Codex maker; a
//       role option that names `harness: pi`; a maker that runs on Pi itself.
//       The new session is in bot.yaml (on pi, where its maker is not), in the
//       book as temporary with its maker, works in work/<name>, and gets its
//       own tab with a Pi launch line behind its own mailbox step, as `obk up`
//       gives any Pi session (pi-launch.test.js): `pi --no-approve
//       --session-id <id> --name <…> [--model <m>] [--thinking <effort>] --
//       <prompt>`, the book holding the id. The answer's `chosen.harness` says
//       where the harness came from: `flag`, `role` or `maker`.
//   P2  Model and effort come from a flag, the role's option, or a maker on Pi.
//       A Claude Code or Codex maker's model, effort and context do not carry
//       to a Pi session. A context is refused: Pi has no context setting.
//   P3  Every Pi session runs as dangerously-skip. So a Pi temporary session is
//       written with `approval: dangerously-skip`, and `chosen.approval` says
//       so (`from: 'flag'` when `--approval dangerously-skip` was given, else
//       `from: 'harness'`). `--approval auto|ask` with Pi is refused. A maker
//       whose own approval is narrower (ask, auto, or none, which is auto) is
//       refused unless the bot's `temp_approval` is dangerously-skip, and the
//       refusal names `permission approval … --temps --approval
//       dangerously-skip`, the command the user runs.
//   P4  Pi not ready (no `pi` on PATH, nobody signed in, the model not found,
//       `pi --list-models` failing): refused before anything is written.
//   P5  A start prompt that begins with `@` once trimmed, from --prompt,
//       --prompt-file or a role's prompt file, and the extra arguments
//       `--approve` and `-a`: refused, nothing written.
//   P6  `temp retire` retires a Pi temporary session as any other; a temporary
//       Pi session makes one of its own on the usual nesting rules.
//   P7  `temp answer` on a Pi session types nothing, ever: the kit starts Pi
//       with `--no-approve`, and Pi 1.3.0 then asks nothing at start (tech
//       notes, section 6). It exits non-zero and says, naming Pi, what is on
//       the screen, quoting it: Pi's project-trust question, a Pi warning that
//       waits for a key, a question from an extension of Pi's, or no
//       first-run screen of Pi's at all. `temp trust-hooks` stays Codex's.
//   P8  `obk --help` lists `--harness claude|codex|pi` under `obk temp make`.
//
// Every refusal here: a non-zero exit, a plain sentence (no stack trace), and
// nothing changed: bot.yaml, the book, the work dir, the kit's prompt file for
// the session, and Orca's tabs, mailboxes and projects (helpers/temp-roles.js
// `world`). Each refusal has a control beside it, the same make done right, so
// that a kit refusing every Pi make does not pass.
//
// The Pi screens in P7 are this file's own sketches of what tech notes section
// 6 describes, not captures: the trust question's rows are as seen live, the
// others as read in Pi's code. The words the kit says are the implementer's;
// what is pinned is the meaning, loosely, in the kit's own words with the
// screen's rows taken out of them, the quote of a row, the exit, and no send.
//
// Every run is in the sandbox (helpers/cli.js): its own HOME, a fake Orca, a
// fake `pi` first on its PATH (helpers/pi.js), or a PATH with no `pi` at all.
// Nothing here reaches the real Orca, the real `pi` or the real ~/.pi.

import assert from 'node:assert/strict';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it as test } from 'node:test';

import {
  bookIn,
  botHomeOf,
  cliOnLine,
  createSandbox,
  harnessPartOf,
  mailboxStep,
  orcaCallsOf,
  orcaFlag,
  promptFileOf,
  sentInto,
  sessionIn,
  sh,
  TAB_SHELL,
  typedInto,
} from './helpers/cli.js';
import { envWithoutPi, fakePi, PI_ID } from './helpers/pi.js';
import { CODEX_HOOKS_REVIEW_TWO } from './helpers/screens.js';
import {
  answerIn,
  BOT,
  chosenIn,
  editBotYaml,
  entryIn,
  inTab,
  liveTab,
  readBotYaml,
  retireTemp,
  setRoles,
  settingsOf,
  TASK,
  world,
} from './helpers/temp-roles.js';

/** The long-lived makers' own prompts, which a made session must not be given. */
const PLANNER_PROMPT = 'You plan the work on the API and hand it out.';
const DAILY_PROMPT = 'Read your AGENTS.md and keep the queue moving.';

/** A task long enough that the kit hands it to the harness from its prompt file. */
const LONG_TASK = 'Read the open pull request and write down what it changes. '.repeat(10).trim();

/** The Pi maker's own model and effort: models the fake `pi` has. */
const PI_MAKER_MODEL = 'anthropic/claude-opus-5-5';
const PI_MAKER_EFFORT = 'high';

/** Prompts that begin with `@` once their ends are trimmed. */
const AT_PROMPTS = [
  ['@notes.md read this first', 'at the very start'],
  ['  @notes.md read this first', 'after spaces'],
  ['\n\t@notes.md read this first\n', 'after a newline and a tab'],
];

const exists = (file) => stat(file).then(() => true, () => false);

/** Every string anywhere under a value. */
function stringsIn(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(stringsIn);
  return [];
}

/** The value a flag takes in an argv, or undefined. */
const valueOf = (argv, flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);

/** The argv before `--`: the flags, without the prompt. */
const flagsOf = (argv) => (argv.includes('--') ? argv.slice(0, argv.indexOf('--')) : argv);

/** `obk` that must work, in the sandbox's env unless `env` is given. */
async function ok(box, args, env) {
  const result = await box.run(args, env === undefined ? {} : { env });
  assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return result;
}

/**
 * Bot Father, and temp-bot (codex) with planner (its own Claude Code: opus,
 * xhigh, a 1m context, approval ask) and nightly (the bot's Codex: gpt-6-sol,
 * low, a 200000 context, approval auto), brought up. `planner` sets planner's
 * approval by hand in bot.yaml instead, as a user would; `null` takes it out.
 * `temps` is the bot's temp_approval, set by `obk permission approval --temps`.
 * `env` is the environment every setup command runs in.
 */
async function fleet(box, { planner, temps, env } = {}) {
  await ok(box, ['init', '--bots', 'bots', '--harness', 'claude'], env);
  await ok(box, ['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'codex'], env);
  await ok(box, [
    'session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'planner',
    '--harness', 'claude', '--model', 'opus', '--effort', 'xhigh', '--context', '1m', '--prompt', PLANNER_PROMPT,
  ], env);
  await ok(box, ['permission', 'approval', '--bots', 'bots', '--bot', BOT, '--session', 'planner', '--approval', 'ask'], env);
  await ok(box, [
    'session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'nightly',
    '--model', 'gpt-6-sol', '--effort', 'low', '--context', '200000', '--prompt', 'You watch the nightly build.',
  ], env);
  await ok(box, ['permission', 'approval', '--bots', 'bots', '--bot', BOT, '--session', 'nightly', '--approval', 'auto'], env);
  const bots = box.path('bots');
  if (planner !== undefined) {
    await editBotYaml(bots, (doc) => {
      const entry = doc.sessions.find((one) => one.name === 'planner');
      if (planner === null) delete entry.approval;
      else entry.approval = planner;
      return doc;
    });
  }
  if (temps !== undefined) await ok(box, ['permission', 'approval', '--bots', 'bots', '--bot', BOT, '--temps', '--approval', temps], env);
  await ok(box, ['up', '--bots', 'bots', '--bot', BOT], env);
  return {
    bots,
    planner: await liveTab(box, bots, 'planner'),
    nightly: await liveTab(box, bots, 'nightly'),
  };
}

/**
 * Bot Father, and temp-bot on Pi with one long-lived Pi session, daily, on
 * the Pi maker's model and effort, brought up. session add writes it at
 * dangerously-skip, as every Pi session runs (pi-launch.test.js L3).
 */
async function piFleet(box) {
  await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(box, ['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'pi']);
  await ok(box, [
    'session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily',
    '--model', PI_MAKER_MODEL, '--effort', PI_MAKER_EFFORT, '--prompt', DAILY_PROMPT,
  ]);
  await ok(box, ['up', '--bots', 'bots', '--bot', BOT]);
  const bots = box.path('bots');
  return { bots, daily: await liveTab(box, bots, 'daily') };
}

/** `obk temp make`, run inside `terminal`, in `env` when it is given. */
const make = (box, terminal, args, env) => box.run(
  ['temp', 'make', '--bots', 'bots', ...args],
  { env: env ?? inTab(box, terminal) },
);

/** `obk temp make` that must work. */
async function made(box, terminal, args, env) {
  const result = await make(box, terminal, args, env);
  assert.equal(result.code, 0, `obk temp make ${args.join(' ')} should have worked:\n${result.stdout}${result.stderr}`);
  return result;
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

/** The one launch line typed into a session's tab, checked to start Pi behind that session's own mailbox step. */
async function piLineOf(box, bots, name) {
  const typed = typedInto(await liveTab(box, bots, name));
  assert.equal(typed.length, 1, `one launch line is typed into ${name}'s tab, got: ${JSON.stringify(typed)}`);
  const [line] = typed;
  assert.ok(
    line.startsWith(`${mailboxStep(box, { bot: BOT, session: name })}; `),
    `the line starts with ${name}'s own mailbox step, got: ${line}`,
  );
  assert.ok(
    harnessPartOf(line).startsWith(`${TAB_SHELL} ${cliOnLine(box.cli)} pi `),
    `the line starts pi, got: ${line}`,
  );
  return line;
}

/** A refusal in plain words that says it is about Pi: a non-zero exit, a sentence naming Pi, no crash. */
function assertRefusedForPi(result) {
  const said = result.stdout + result.stderr;
  assert.notEqual(result.code, 0, `this should have been refused, got:\n${said}`);
  assert.notEqual(said.trim(), '', 'a refusal with nothing said is no use to anybody');
  assert.ok(!/^\s+at /m.test(said), `expected a message, got a crash:\n${said}`);
  assert.match(said, /\bpi\b/i, `the refusal should say it is about Pi, got:\n${said}`);
  return said;
}

/**
 * A make that is refused for Pi and changes nothing: bot.yaml, the book, the
 * work dir, Orca, and no prompt file for the session left behind.
 */
async function assertPiMakeRefused(box, bots, terminal, args, { name, env } = {}) {
  const before = await world(box, bots);
  const from = (await box.orca.calls()).length;

  const result = await make(box, terminal, args, env);

  const said = assertRefusedForPi(result);
  assert.deepEqual(await world(box, bots), before, 'bot.yaml, the book, the work dir and Orca are as they were');
  assert.deepEqual(orcaCallsOf((await box.orca.calls()).slice(from), 'terminal create'), [], 'no tab was opened');
  const session = name ?? valueOf(args, '--name');
  assert.equal(await exists(promptFileOf(bots, BOT, session)), false, `no prompt file was left for ${session}`);
  return said;
}

// =================================================================== P1 where Pi comes from

describe('a temporary session on Pi', { concurrency: 4 }, () => {
  test('P1 temp make --harness pi from a Claude Code maker makes a Pi session: in bot.yaml on pi, in the book as temporary with its maker, in work/<name>', async (t) => {
    const box = await createSandbox(t);
    await fakePi(box);
    const { bots, planner } = await fleet(box, { temps: 'dangerously-skip' });
    const home = botHomeOf(bots, BOT);

    await made(box, planner, ['--name', 'scout', '--prompt', TASK, '--harness', 'pi']);

    const entry = await entryIn(bots, 'scout');
    assert.equal(entry?.harness, 'pi', `scout is written on pi, its bot being on codex: ${JSON.stringify(entry)}`);
    assert.equal(entry.approval, 'dangerously-skip', `every Pi session runs as dangerously-skip: ${JSON.stringify(entry)}`);
    assert.equal(path.resolve(home, entry.work_dir ?? ''), path.join(home, 'work', 'scout'), `its work dir is work/scout: ${JSON.stringify(entry)}`);
    assert.ok((await stat(path.join(home, 'work', 'scout'))).isDirectory(), 'and it is there to walk into');
    const booked = await sessionIn(bots, BOT, 'scout');
    assert.equal(booked?.temporary?.maker, 'planner', `the book has scout as planner's: ${JSON.stringify(booked)}`);
    assert.equal(typeof booked.tab, 'string', `and its tab: ${JSON.stringify(booked)}`);
    assert.notEqual(booked.tab, planner.tabId, 'a tab of its own, not its maker\'s');
    assert.notEqual(booked.mailbox, (await sessionIn(bots, BOT, 'planner')).mailbox, 'and a mailbox of its own');
  });

  test('P1 the Pi session\'s tab gets a Pi launch line behind its mailbox step: --no-approve, the book\'s session id, its name, and the task after --', async (t) => {
    const box = await createSandbox(t);
    const pi = await fakePi(box);
    const { bots, planner } = await fleet(box, { temps: 'dangerously-skip' });
    const home = botHomeOf(bots, BOT);

    await made(box, planner, ['--name', 'scout', '--prompt', TASK, '--harness', 'pi']);

    const argv = await piArgvOf(box, await piLineOf(box, bots, 'scout'), pi);
    const id = valueOf(argv, '--session-id');
    assert.match(String(id), PI_ID, `a session id Pi takes, got: ${JSON.stringify(argv)}`);
    assert.equal((await sessionIn(bots, BOT, 'scout'))?.session, id, 'the book holds the id the line carries');
    assert.ok(flagsOf(argv).includes('--no-approve'), `got: ${JSON.stringify(argv)}`);
    assert.ok(String(valueOf(argv, '--name')).includes('scout'), `its name is on the line, got: ${JSON.stringify(argv)}`);
    assert.equal(argv.at(-2), '--', `the prompt comes last, after --, got: ${JSON.stringify(argv)}`);
    const prompt = argv.at(-1);
    assert.ok(prompt.startsWith(TASK), `the task is the start prompt, got: ${JSON.stringify(prompt)}`);
    assert.ok(prompt.includes(path.join(home, 'work', 'scout')), `and the note names work/scout, got: ${JSON.stringify(prompt)}`);
    assert.ok(!prompt.includes(PLANNER_PROMPT), 'the maker\'s own prompt is not passed on');
    for (const foreign of ['--permission-mode', '--dangerously-skip-permissions', '-a', '--approve', '-n']) {
      assert.equal(flagsOf(argv).includes(foreign), false, `a Pi line carries no ${foreign}, got: ${JSON.stringify(argv)}`);
    }
  });

  test('P1 temp make --harness pi --json: chosen says the harness came from the flag, approval dangerously-skip from the harness, and no model or effort', async (t) => {
    const box = await createSandbox(t);
    await fakePi(box);
    const { bots, planner } = await fleet(box, { temps: 'dangerously-skip' });

    const result = await made(box, planner, ['--name', 'scout', '--prompt', TASK, '--harness', 'pi', '--json']);

    const answer = answerIn(result);
    assert.equal(answer.session, 'scout', `got: ${result.stdout}`);
    assert.equal(answer.maker, 'planner', `got: ${result.stdout}`);
    const chosen = chosenIn(answer);
    assert.deepEqual(chosen.harness, { value: 'pi', from: 'flag' }, `got: ${result.stdout}`);
    assert.deepEqual(chosen.approval, { value: 'dangerously-skip', from: 'harness' }, `got: ${result.stdout}`);
    assert.deepEqual(chosen.model, { from: 'harness default' }, `planner's opus is Claude's, got: ${result.stdout}`);
    assert.deepEqual(chosen.effort, { from: 'harness default' }, `planner's xhigh is Claude's, got: ${result.stdout}`);
    const { tab } = await sessionIn(bots, BOT, 'scout');
    assert.ok((answer.tabs ?? []).some((one) => one.tabId === tab && one.created === true), `the answer reports scout's tab as made, got: ${result.stdout}`);
  });

  test('P1 a role option with harness: pi makes a Pi session on the option\'s model and effort, and chosen says they came from the role', async (t) => {
    const box = await createSandbox(t);
    const pi = await fakePi(box);
    const { bots, nightly } = await fleet(box, { temps: 'dangerously-skip' });
    await setRoles(bots, { tinker: [{ name: 'pi', harness: 'pi', model: 'anthropic/claude-sonnet-5', effort: 'medium', for: 'small chores' }] });

    const result = await made(box, nightly, ['--role', 'tinker', '--name', '1', '--prompt', TASK, '--json']);

    const answer = answerIn(result);
    assert.equal(answer.session, 'tinker-1', `got: ${result.stdout}`);
    const chosen = chosenIn(answer);
    assert.deepEqual(
      { harness: chosen.harness, model: chosen.model, effort: chosen.effort, approval: chosen.approval },
      {
        harness: { value: 'pi', from: 'role' },
        model: { value: 'anthropic/claude-sonnet-5', from: 'role' },
        effort: { value: 'medium', from: 'role' },
        approval: { value: 'dangerously-skip', from: 'harness' },
      },
      `got: ${result.stdout}`,
    );
    const settings = await settingsOf(bots, 'tinker-1');
    assert.deepEqual(
      { harness: settings.harness, model: settings.model, effort: settings.effort, approval: settings.approval },
      { harness: 'pi', model: 'anthropic/claude-sonnet-5', effort: 'medium', approval: 'dangerously-skip' },
    );
    assert.equal((await sessionIn(bots, BOT, 'tinker-1'))?.temporary?.maker, 'nightly');
    const argv = await piArgvOf(box, await piLineOf(box, bots, 'tinker-1'), pi);
    assert.equal(valueOf(argv, '--model'), 'anthropic/claude-sonnet-5', `got: ${JSON.stringify(argv)}`);
    assert.equal(valueOf(argv, '--thinking'), 'medium', `got: ${JSON.stringify(argv)}`);
    assert.ok(flagsOf(argv).includes('--no-approve'), `got: ${JSON.stringify(argv)}`);
  });

  test('P1 a maker on Pi makes a Pi session with no --harness, on its own model and effort, and chosen says they came from the maker', async (t) => {
    const box = await createSandbox(t);
    const pi = await fakePi(box);
    const { bots, daily } = await piFleet(box);

    const result = await made(box, daily, ['--name', 'helper', '--prompt', TASK, '--json']);

    const chosen = chosenIn(answerIn(result));
    assert.deepEqual(
      { harness: chosen.harness, model: chosen.model, effort: chosen.effort },
      {
        harness: { value: 'pi', from: 'maker' },
        model: { value: PI_MAKER_MODEL, from: 'maker' },
        effort: { value: PI_MAKER_EFFORT, from: 'maker' },
      },
      `got: ${result.stdout}`,
    );
    // Both a maker on dangerously-skip and Pi itself say why; either is a true account.
    assert.equal(chosen.approval?.value, 'dangerously-skip', `got: ${result.stdout}`);
    assert.ok(['harness', 'maker'].includes(chosen.approval?.from), `got: ${result.stdout}`);
    const settings = await settingsOf(bots, 'helper');
    assert.deepEqual(
      { harness: settings.harness, model: settings.model, effort: settings.effort, approval: settings.approval },
      { harness: 'pi', model: PI_MAKER_MODEL, effort: PI_MAKER_EFFORT, approval: 'dangerously-skip' },
    );
    assert.equal((await sessionIn(bots, BOT, 'helper'))?.temporary?.maker, 'daily');
    const argv = await piArgvOf(box, await piLineOf(box, bots, 'helper'), pi);
    assert.equal(valueOf(argv, '--model'), PI_MAKER_MODEL, `got: ${JSON.stringify(argv)}`);
    assert.equal(valueOf(argv, '--thinking'), PI_MAKER_EFFORT, `got: ${JSON.stringify(argv)}`);
    assert.equal((await sessionIn(bots, BOT, 'helper'))?.session, valueOf(argv, '--session-id'), 'the book holds the id the line carries');
    assert.notEqual(valueOf(argv, '--session-id'), (await sessionIn(bots, BOT, 'daily'))?.session, 'an id of its own, not its maker\'s');
    assert.ok(argv.at(-1).startsWith(TASK) && !argv.at(-1).includes(DAILY_PROMPT), `the task, not the maker's prompt, got: ${JSON.stringify(argv)}`);
  });

  // ================================================================= P2 model, effort, context

  for (const [maker, own] of [['planner', ['opus', 'xhigh', '1m']], ['nightly', ['gpt-6-sol', 'low', '200000']]]) {
    test(`P2 a ${maker === 'planner' ? 'Claude Code' : 'Codex'} maker's model, effort and context do not carry to a Pi session`, async (t) => {
      const box = await createSandbox(t);
      const pi = await fakePi(box);
      const fleetOf = await fleet(box, { temps: 'dangerously-skip' });
      const { bots } = fleetOf;

      await made(box, fleetOf[maker], ['--name', 'scout', '--prompt', TASK, '--harness', 'pi']);

      assert.deepEqual(
        await settingsOf(bots, 'scout'),
        { harness: 'pi', model: undefined, effort: undefined, context: undefined, approval: 'dangerously-skip' },
        `only the harness and Pi's approval, nothing of ${maker}'s`,
      );
      const argv = await piArgvOf(box, await piLineOf(box, bots, 'scout'), pi);
      assert.equal(argv.includes('--model'), false, `got: ${JSON.stringify(argv)}`);
      assert.equal(argv.includes('--thinking'), false, `got: ${JSON.stringify(argv)}`);
      for (const value of own) assert.equal(flagsOf(argv).includes(value), false, `nothing of ${maker}'s ${value} on the line: ${JSON.stringify(argv)}`);
    });
  }

  test('P2 --model and --effort given go into bot.yaml and onto the line as --model and --thinking', async (t) => {
    const box = await createSandbox(t);
    const pi = await fakePi(box);
    const { bots, planner } = await fleet(box, { temps: 'dangerously-skip' });

    await made(box, planner, ['--name', 'scout', '--prompt', TASK, '--harness', 'pi', '--model', 'openai/gpt-6.1-sol', '--effort', 'low']);

    const settings = await settingsOf(bots, 'scout');
    assert.deepEqual({ model: settings.model, effort: settings.effort }, { model: 'openai/gpt-6.1-sol', effort: 'low' });
    const argv = await piArgvOf(box, await piLineOf(box, bots, 'scout'), pi);
    assert.equal(valueOf(argv, '--model'), 'openai/gpt-6.1-sol', `got: ${JSON.stringify(argv)}`);
    assert.equal(valueOf(argv, '--thinking'), 'low', `got: ${JSON.stringify(argv)}`);
  });

  test('P2 --context on a Pi session is refused, names Pi, and changes nothing; without it the same make works', async (t) => {
    const box = await createSandbox(t);
    await fakePi(box);
    const { bots, planner } = await fleet(box, { temps: 'dangerously-skip' });

    await assertPiMakeRefused(box, bots, planner, ['--name', 'scout', '--prompt', TASK, '--harness', 'pi', '--context', '1m']);

    await made(box, planner, ['--name', 'scout', '--prompt', TASK, '--harness', 'pi']);
  });

  test('P2 a role option on Pi that gives a context is refused, names Pi, and changes nothing', async (t) => {
    const box = await createSandbox(t);
    await fakePi(box);
    const { bots, planner } = await fleet(box, { temps: 'dangerously-skip' });
    await setRoles(bots, {
      tinker: [
        { name: 'wide', harness: 'pi', model: 'anthropic/claude-sonnet-5', context: '1m' },
        { name: 'plain', harness: 'pi', model: 'anthropic/claude-sonnet-5' },
      ],
    });

    await assertPiMakeRefused(box, bots, planner, ['--role', 'tinker:wide', '--name', '1', '--prompt', TASK], { name: 'tinker-1' });

    await made(box, planner, ['--role', 'tinker:plain', '--name', '1', '--prompt', TASK]);
  });

  // ================================================================= P3 approval

  test('P3 --approval dangerously-skip with Pi is taken, and chosen says it came from the flag', async (t) => {
    const box = await createSandbox(t);
    await fakePi(box);
    const { bots, planner } = await fleet(box, { temps: 'dangerously-skip' });

    const result = await made(box, planner, ['--name', 'scout', '--prompt', TASK, '--harness', 'pi', '--approval', 'dangerously-skip', '--json']);

    assert.deepEqual(chosenIn(answerIn(result)).approval, { value: 'dangerously-skip', from: 'flag' }, `got: ${result.stdout}`);
    assert.equal((await settingsOf(bots, 'scout')).approval, 'dangerously-skip');
  });

  for (const level of ['auto', 'ask']) {
    test(`P3 --approval ${level} with Pi is refused, names Pi, and changes nothing; without it the same make works`, async (t) => {
      const box = await createSandbox(t);
      await fakePi(box);
      const { bots, planner } = await fleet(box, { temps: 'dangerously-skip' });

      const said = await assertPiMakeRefused(box, bots, planner, ['--name', 'scout', '--prompt', TASK, '--harness', 'pi', '--approval', level]);
      assert.ok(said.includes('dangerously-skip'), `it says a Pi session runs as dangerously-skip, got:\n${said}`);

      await made(box, planner, ['--name', 'scout', '--prompt', TASK, '--harness', 'pi']);
    });
  }

  for (const [label, options, maker] of [
    ['ask', {}, 'planner'],
    ['auto', {}, 'nightly'],
    ['no approval (auto)', { planner: null }, 'planner'],
  ]) {
    test(`P3 a maker at ${label} with no temp_approval making a Pi session is refused, names permission approval --temps --approval dangerously-skip, and changes nothing`, async (t) => {
      const box = await createSandbox(t);
      await fakePi(box);
      const fleetOf = await fleet(box, options);
      const { bots } = fleetOf;

      const said = await assertPiMakeRefused(box, bots, fleetOf[maker], ['--name', 'scout', '--prompt', TASK, '--harness', 'pi']);
      for (const word of ['permission approval', '--temps', 'dangerously-skip']) {
        assert.ok(said.includes(word), `the refusal names the command the user runs, ${word} in it, got:\n${said}`);
      }
    });
  }

  test('P3 a maker at ask with temp_approval auto, narrower than Pi, is refused, and changes nothing', async (t) => {
    const box = await createSandbox(t);
    await fakePi(box);
    const { bots, planner } = await fleet(box, { temps: 'auto' });

    const said = await assertPiMakeRefused(box, bots, planner, ['--name', 'scout', '--prompt', TASK, '--harness', 'pi']);
    assert.ok(said.includes('--temps'), `it names the road, got:\n${said}`);
  });

  test('P3 a maker at dangerously-skip makes a Pi session, with no temp_approval', async (t) => {
    const box = await createSandbox(t);
    await fakePi(box);
    const { bots, planner } = await fleet(box, { planner: 'dangerously-skip' });
    assert.equal((await readBotYaml(bots)).temp_approval, undefined, 'the premise: the bot has no temp_approval');

    await made(box, planner, ['--name', 'scout', '--prompt', TASK, '--harness', 'pi']);

    assert.equal((await settingsOf(bots, 'scout')).approval, 'dangerously-skip');
  });

  test('P3 temp_approval dangerously-skip set by obk permission approval --temps lets a maker at ask make a Pi session', async (t) => {
    const box = await createSandbox(t);
    await fakePi(box);
    const { bots, planner } = await fleet(box);
    await assertPiMakeRefused(box, bots, planner, ['--name', 'scout', '--prompt', TASK, '--harness', 'pi']);

    await ok(box, ['permission', 'approval', '--bots', 'bots', '--bot', BOT, '--temps', '--approval', 'dangerously-skip']);
    await made(box, planner, ['--name', 'scout', '--prompt', TASK, '--harness', 'pi']);

    const settings = await settingsOf(bots, 'scout');
    assert.deepEqual({ harness: settings.harness, approval: settings.approval }, { harness: 'pi', approval: 'dangerously-skip' });
  });

  test('P3 a Claude Code temporary session made with no --harness by a maker at ask still takes ask, with temp_approval dangerously-skip', async (t) => {
    // The control for P3: Pi's dangerously-skip is Pi's alone.
    const box = await createSandbox(t);
    await fakePi(box);
    const { bots, planner } = await fleet(box, { temps: 'dangerously-skip' });

    await made(box, planner, ['--name', 'scout', '--prompt', TASK]);

    const settings = await settingsOf(bots, 'scout');
    assert.deepEqual({ harness: settings.harness, approval: settings.approval }, { harness: 'claude', approval: 'ask' });
  });

  // ================================================================= P4 Pi not ready

  test('P4 temp make of a Pi session with no pi on PATH is refused before anything is written', async (t) => {
    const box = await createSandbox(t);
    const env = await envWithoutPi(box);
    const where = await sh('command -v pi', { env });
    assert.notEqual(where.code, 0, `the test's PATH must hold no pi at all, found: ${where.stdout}`);
    const { bots, planner } = await fleet(box, { temps: 'dangerously-skip', env });

    await assertPiMakeRefused(box, bots, planner, ['--name', 'scout', '--prompt', TASK, '--harness', 'pi'], { env: { ...inTab(box, planner), PATH: env.PATH } });

    await fakePi(box);
    await made(box, planner, ['--name', 'scout', '--prompt', TASK, '--harness', 'pi']);
  });

  test('P4 temp make of a Pi session when nobody is signed in to Pi is refused before anything is written, and says to sign in', async (t) => {
    const box = await createSandbox(t);
    const pi = await fakePi(box, { signedIn: false });
    const { bots, planner } = await fleet(box, { temps: 'dangerously-skip' });

    const said = await assertPiMakeRefused(box, bots, planner, ['--name', 'scout', '--prompt', TASK, '--harness', 'pi']);
    assert.match(said, /sign in/i, `it tells the user to sign in to Pi, got:\n${said}`);

    await pi.set({ signedIn: true });
    await made(box, planner, ['--name', 'scout', '--prompt', TASK, '--harness', 'pi']);
  });

  test('P4 temp make of a Pi session on a model Pi does not have is refused before anything is written, and names the model', async (t) => {
    const box = await createSandbox(t);
    const pi = await fakePi(box);
    const { bots, planner } = await fleet(box, { temps: 'dangerously-skip' });

    const said = await assertPiMakeRefused(box, bots, planner, ['--name', 'scout', '--prompt', TASK, '--harness', 'pi', '--model', 'nosuch/model-x']);
    assert.ok(said.includes('nosuch/model-x'), `the refusal names the model, got:\n${said}`);
    assert.ok((await pi.searches()).includes('nosuch/model-x'), `it asked Pi for that model, got: ${JSON.stringify(await pi.searches())}`);

    await made(box, planner, ['--name', 'scout', '--prompt', TASK, '--harness', 'pi', '--model', 'openai/gpt-6.1-sol']);
  });

  test('P4 temp make from a role option on a model Pi does not have is refused before anything is written', async (t) => {
    const box = await createSandbox(t);
    await fakePi(box);
    const { bots, planner } = await fleet(box, { temps: 'dangerously-skip' });
    await setRoles(bots, { tinker: [{ name: 'pi', harness: 'pi', model: 'nosuch/model-y' }] });

    const said = await assertPiMakeRefused(box, bots, planner, ['--role', 'tinker', '--name', '1', '--prompt', TASK], { name: 'tinker-1' });
    assert.ok(said.includes('nosuch/model-y'), `the refusal names the model, got:\n${said}`);
  });

  test('P4 temp make from a Pi maker when pi --list-models fails is refused before anything is written', async (t) => {
    const box = await createSandbox(t);
    const pi = await fakePi(box);
    const { bots, daily } = await piFleet(box);
    await pi.set({ listModels: 'fails', search: 'fails' });

    await assertPiMakeRefused(box, bots, daily, ['--name', 'helper', '--prompt', TASK]);

    await pi.set({ listModels: 'ok', search: 'ok' });
    await made(box, daily, ['--name', 'helper', '--prompt', TASK]);
  });

  // ================================================================= P5 a prompt that begins with @, and --approve

  for (const [prompt, label] of AT_PROMPTS) {
    test(`P5 a Pi session whose --prompt begins with @ ${label} is refused, changes nothing, and leaves no prompt file`, async (t) => {
      const box = await createSandbox(t);
      await fakePi(box);
      const { bots, planner } = await fleet(box, { temps: 'dangerously-skip' });

      const said = await assertPiMakeRefused(box, bots, planner, ['--name', 'scout', '--prompt', prompt, '--harness', 'pi']);
      assert.ok(said.includes('@'), `it says the prompt may not begin with @, got:\n${said}`);
    });
  }

  test('P5 a Pi session whose --prompt-file text begins with @ is refused, changes nothing, and leaves no prompt file', async (t) => {
    const box = await createSandbox(t);
    await fakePi(box);
    const { bots, planner } = await fleet(box, { temps: 'dangerously-skip' });
    const file = path.join(box.root, 'tasks', 'scout.md');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '\n  @notes.md read this first.\n\nThen write down what it changes.\n');

    const said = await assertPiMakeRefused(box, bots, planner, ['--name', 'scout', '--prompt-file', file, '--harness', 'pi']);
    assert.ok(said.includes('@'), `it says the prompt may not begin with @, got:\n${said}`);

    await writeFile(file, 'Read the pull request, then write down what it changes.\n');
    await made(box, planner, ['--name', 'scout', '--prompt-file', file, '--harness', 'pi']);
  });

  test('P5 a Pi session from a role whose prompt file begins with @ is refused, changes nothing, and leaves no prompt file', async (t) => {
    const box = await createSandbox(t);
    await fakePi(box);
    const { bots, planner } = await fleet(box, { temps: 'dangerously-skip' });
    await writeFile(path.join(botHomeOf(bots, BOT), 'tinker.md'), '@notes.md read this first.\n');
    await setRoles(bots, { tinker: { prompt_file: 'tinker.md', options: [{ name: 'pi', harness: 'pi' }] } });

    const said = await assertPiMakeRefused(box, bots, planner, ['--role', 'tinker', '--name', '1'], { name: 'tinker-1' });
    assert.ok(said.includes('@'), `it says the prompt may not begin with @, got:\n${said}`);

    await writeFile(path.join(botHomeOf(bots, BOT), 'tinker.md'), 'Read the pull request, then write down what it changes.\n');
    await made(box, planner, ['--role', 'tinker', '--name', '1']);
  });

  test('P5 a Pi session whose prompt has @ later in it is made, and a Claude Code one whose prompt begins with @ still is', async (t) => {
    // The controls for P5: only a Pi prompt that begins with @ is refused.
    const box = await createSandbox(t);
    const pi = await fakePi(box);
    const { bots, planner } = await fleet(box, { temps: 'dangerously-skip' });

    await made(box, planner, ['--name', 'scout', '--prompt', 'Ask @owner first, then read the pull request.', '--harness', 'pi']);
    await made(box, planner, ['--name', 'drafter', '--prompt', '@notes.md read this first']);

    const argv = await piArgvOf(box, await piLineOf(box, bots, 'scout'), pi);
    assert.ok(argv.at(-1).startsWith('Ask @owner first'), `got: ${JSON.stringify(argv)}`);
    assert.equal((await settingsOf(bots, 'drafter')).harness, 'claude');
  });

  for (const arg of ['--approve', '-a']) {
    test(`P5 a Pi session with --extra-arg=${arg} is refused, names Pi, and changes nothing`, async (t) => {
      const box = await createSandbox(t);
      await fakePi(box);
      const { bots, planner } = await fleet(box, { temps: 'dangerously-skip' });

      const said = await assertPiMakeRefused(box, bots, planner, ['--name', 'scout', '--prompt', TASK, '--harness', 'pi', `--extra-arg=${arg}`]);
      assert.ok(said.includes(arg), `it names the argument it refuses, got:\n${said}`);
    });
  }

  test('P5 a Pi session with an extra argument of its own gets it on its line, after the kit\'s flags and before the prompt', async (t) => {
    // The control for the two refusals above.
    const box = await createSandbox(t);
    const pi = await fakePi(box);
    const { bots, planner } = await fleet(box, { temps: 'dangerously-skip' });

    await made(box, planner, ['--name', 'scout', '--prompt', TASK, '--harness', 'pi', '--extra-arg=--verbose']);

    const argv = await piArgvOf(box, await piLineOf(box, bots, 'scout'), pi);
    const at = argv.indexOf('--verbose');
    assert.ok(at > argv.indexOf('--session-id') && at > argv.indexOf('--no-approve') && at < argv.indexOf('--'), `got: ${JSON.stringify(argv)}`);
  });

  // ================================================================= P6 retire, and nesting

  test('P6 temp retire of a Pi session from its maker\'s tab: its tab closed, off bot.yaml, retired in the book with its Pi session id, and its prompt file gone', async (t) => {
    const box = await createSandbox(t);
    await fakePi(box);
    const { bots, planner, nightly } = await fleet(box, { temps: 'dangerously-skip' });
    await made(box, planner, ['--name', 'scout', '--prompt', LONG_TASK, '--harness', 'pi']);
    const scout = await liveTab(box, bots, 'scout');
    const { session: id, temporary } = await sessionIn(bots, BOT, 'scout');
    assert.match(String(id), PI_ID, `the premise: the book holds scout's Pi session id, got: ${id}`);
    const file = promptFileOf(bots, BOT, 'scout');
    assert.equal(await exists(file), true, `the premise: the long task is in ${file}`);
    const from = (await box.orca.calls()).length;

    const result = await retireTemp(box, planner, ['--name', 'scout']);

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    assert.deepEqual(
      orcaCallsOf((await box.orca.calls()).slice(from), 'terminal close').map((call) => orcaFlag(call, '--terminal')),
      [scout.handle],
      'scout\'s tab is closed by its own handle, and no other',
    );
    assert.equal((await box.orca.terminals()).some((one) => one.tabId === scout.tabId), false, 'its tab is gone');
    assert.ok((await box.orca.terminals()).some((one) => one.tabId === planner.tabId), 'and planner\'s is still open');
    assert.ok((await box.orca.terminals()).some((one) => one.tabId === nightly.tabId), 'and nightly\'s');
    assert.equal(await entryIn(bots, 'scout'), undefined, 'scout is off bot.yaml');
    const book = await bookIn(bots, BOT);
    assert.equal(book.sessions?.scout, undefined, 'and off the book\'s live list');
    const entries = (book.retired ?? []).filter((one) => one?.name === 'scout');
    assert.equal(entries.length, 1, `one retired entry for scout, got: ${JSON.stringify(book.retired)}`);
    assert.ok(stringsIn(entries[0]).includes(id), `its Pi session id is kept, got: ${JSON.stringify(entries[0])}`);
    assert.deepEqual(entries[0].temporary, temporary, 'still marked temporary, with its maker');
    assert.equal(await exists(file), false, `${file} goes with the session`);
  });

  test('P6 a temporary Pi session makes one Pi session of its own, one at a time, and that one makes none', async (t) => {
    const box = await createSandbox(t);
    await fakePi(box);
    const { bots, daily } = await piFleet(box);
    await made(box, daily, ['--name', 'helper', '--prompt', TASK]);
    const helper = await liveTab(box, bots, 'helper');

    await made(box, helper, ['--name', 'sub', '--prompt', TASK]);

    assert.equal((await sessionIn(bots, BOT, 'sub'))?.temporary?.maker, 'helper', 'the book has sub as helper\'s');
    assert.equal((await settingsOf(bots, 'sub')).harness, 'pi');
    const sub = await liveTab(box, bots, 'sub');
    const second = await world(box, bots);
    const twice = await make(box, helper, ['--name', 'sub2', '--prompt', TASK]);
    assert.notEqual(twice.code, 0, `a second while sub is open is refused, got:\n${twice.stdout}${twice.stderr}`);
    assert.deepEqual(await world(box, bots), second, 'and changes nothing');
    const deeper = await make(box, sub, ['--name', 'subsub', '--prompt', TASK]);
    assert.notEqual(deeper.code, 0, `a session a temporary session made makes none, got:\n${deeper.stdout}${deeper.stderr}`);
    assert.deepEqual(await world(box, bots), second, 'and changes nothing');

    const retired = await retireTemp(box, helper, ['--name', 'sub']);
    assert.equal(retired.code, 0, `helper retires sub: ${retired.stdout}${retired.stderr}`);
    await made(box, helper, ['--name', 'sub2', '--prompt', TASK]);
  });

  // ================================================================= P7 temp answer

  test('P7 temp trust-hooks on a Pi session is refused, says it is for Codex, and types nothing', async (t) => {
    const box = await createSandbox(t);
    await fakePi(box);
    const { bots, planner } = await fleet(box, { temps: 'dangerously-skip' });
    await made(box, planner, ['--name', 'scout', '--prompt', TASK, '--harness', 'pi']);
    await showIn(box, bots, 'scout', CODEX_HOOKS_REVIEW_TWO);
    const before = await sendsByTab(box);

    const result = await box.run(['temp', 'trust-hooks', '--bots', 'bots', '--name', 'scout'], { env: inTab(box, planner) });

    const said = `${result.stdout}${result.stderr}`;
    assert.notEqual(result.code, 0, `this should be refused, got:\n${said}`);
    assert.ok(!/^\s+at /m.test(said), `a message, not a crash:\n${said}`);
    assert.match(said, /codex/i, `it says the command is for a Codex session: ${said}`);
    assert.deepEqual(await sentSince(box, before), {}, 'nothing is typed into any tab');
  });

  for (const { label, screen, quote, means } of PI_SCREENS()) {
    test(`P7 temp answer on a Pi session showing ${label} types nothing, exits non-zero, and says what it is, quoting it`, async (t) => {
      const box = await createSandbox(t);
      await fakePi(box);
      const { bots, planner } = await fleet(box, { temps: 'dangerously-skip' });
      await made(box, planner, ['--name', 'scout', '--prompt', TASK, '--harness', 'pi']);
      await showIn(box, bots, 'scout', screen);
      const before = await sendsByTab(box);
      const calls = (await box.orca.calls()).length;

      const result = await box.run(['temp', 'answer', '--bots', 'bots', '--name', 'scout'], { env: inTab(box, planner) });

      const said = `${result.stdout}${result.stderr}`;
      assert.notEqual(result.code, 0, `nothing of Pi's is the kit's to answer, so it does not end in 0:\n${said}`);
      assert.ok(!/^\s+at /m.test(said), `a message, not a crash:\n${said}`);
      assert.deepEqual(await sentSince(box, before), {}, 'nothing is typed into any tab');
      assert.deepEqual(orcaCallsOf((await box.orca.calls()).slice(calls), 'terminal send'), [], 'not one terminal send');
      assert.ok(said.includes(quote), `it shows what is on the screen, ${JSON.stringify(quote)} among it:\n${said}`);
      const own = ownWords(said, screen);
      assert.match(own, /\bPi\b/, `in its own words it names Pi:\n${own}`);
      for (const pattern of means) assert.match(own, pattern, `in its own words it says what the screen is (${pattern}):\n${own}`);
    });
  }

  // ================================================================= P8 help

  test('P8 obk --help lists --harness claude|codex|pi under obk temp make', async (t) => {
    const box = await createSandbox(t);

    const { stdout: usage } = await box.run(['--help']);

    const lines = usage.split('\n');
    const at = lines.findIndex((line) => /^\s*obk temp make\b/.test(line));
    assert.ok(at >= 0, `the usage has obk temp make, got:\n${usage}`);
    const end = lines.findIndex((line, index) => index > at && /^\s*obk /.test(line));
    const block = lines.slice(at, end < 0 ? undefined : end).join('\n');
    assert.ok(block.includes('--harness claude|codex|pi'), `obk temp make lists Pi among its harnesses, got:\n${block}`);
  });
});

// =================================================================== the Pi screens P7 shows

/**
 * The screens P7 puts in a Pi tab, each with a row the kit must quote and what
 * its own words must say. A function, so each test gets rows of its own.
 */
function PI_SCREENS() {
  /** A row of the input box's rules in this file's sketch of Pi's screen. */
  const rule = '─'.repeat(100);
  const trust = [
    '',
    ' Trust project folder?',
    ' /Users/someone/bots/bots/temp-bot',
    '',
    ' → Trust',
    '   Trust parent folder (/Users/someone/bots/bots)',
    '   Trust (this session only)',
    '   Do not trust',
    '   Do not trust (this session only)',
    '',
    ' ↑↓ navigate  enter select  escape/ctrl+c cancel',
  ];
  const warning = [
    '',
    ' Warning: ~/.pi/agent/hooks is deprecated. Hooks are extensions now.',
    ' Move each hook in it into ~/.pi/agent/extensions.',
    '',
    ' Press any key to continue...',
  ];
  const extension = [
    '',
    ' Choose a workspace profile for this session',
    '',
    ' → default',
    '   minimal',
    '   none',
    '',
    ' ↑↓ navigate  enter select  escape/ctrl+c cancel',
  ];
  const idle = [
    ' pi v1.3.0',
    ' escape interrupt · ctrl+c clear · ctrl+d exit · / commands · ! bash',
    ' Model scope: openai/gpt-6.1-sol',
    ' [Skills]',
    '   obk-tdd, obk-reviewing',
    ' [Extensions]',
    '   orca-agent-status, orca-prefill, orca-titlebar-spinner',
    '',
    rule,
    ' >',
    rule,
    ' ~/bots/bots/temp-bot   openai/gpt-6.1-sol • low',
  ];
  const shell = ['Last login: Sun Oct 18 09:12:40 on ttys004', 'someone@mac temp-bot % '];
  const firstRun = /first[- ]run/i;
  const none = /\b(no|not|nothing|none)\b/i;
  return [
    { label: 'Pi\'s project-trust question', screen: trust, quote: 'Do not trust (this session only)', means: [/trust/i] },
    { label: 'a Pi warning that waits for a key', screen: warning, quote: 'Press any key to continue...', means: [/warning/i, /\bkey\b/i] },
    { label: 'a question from an extension of Pi\'s', screen: extension, quote: 'Choose a workspace profile for this session', means: [/extension/i] },
    { label: 'Pi idle at its input line', screen: idle, quote: 'Model scope: openai/gpt-6.1-sol', means: [firstRun, none] },
    { label: 'a shell prompt where Pi has quit', screen: shell, quote: 'someone@mac temp-bot %', means: [firstRun, none] },
  ];
}

/** What the kit said in its own words: its output with every row of the screen taken out. */
function ownWords(said, screen) {
  return screen.map((row) => row.trim()).filter((row) => row !== '')
    .sort((one, other) => other.length - one.length)
    .reduce((text, row) => text.replaceAll(row, ''), said);
}

/** Give one session's tab a screen of its own. */
async function showIn(box, bots, name, screen) {
  const tab = (await sessionIn(bots, BOT, name)).tab;
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((terminal) => (terminal.tabId === tab ? { ...terminal, screen } : terminal)),
  });
}

/** Every `terminal send` so far into every tab, by tab id. */
async function sendsByTab(box) {
  return Object.fromEntries((await box.orca.terminals()).map((terminal) => [terminal.tabId, sentInto(terminal)]));
}

/** What was sent since `before`, by tab id, for the tabs that got anything. */
async function sentSince(box, before) {
  const sent = {};
  for (const [tab, sends] of Object.entries(await sendsByTab(box))) {
    const since = sends.slice((before[tab] ?? []).length);
    if (since.length > 0) sent[tab] = since;
  }
  return sent;
}
