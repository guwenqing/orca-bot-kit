// Bot Father on Pi (#674). The owner's decision (2026-10-20): the harness Bot
// Father runs on is the user's choice, and Pi is one of the choices. So
// `obk init` takes `--harness pi` as it takes `claude` and `codex`:
//
//   I1  init --harness pi makes the bots folder, writes Bot Father with
//       `harness: pi`, and opens its daily tab and the ops tab. The daily
//       tab's line starts Pi, as any Pi session's line does.
//   I2  Pi has no permission rules and no hooks, so the kit writes no Claude
//       settings, no Codex hooks and no Codex rules file for a Bot Father on Pi.
//   I3  A second init with pi changes nothing. An init that names another
//       harness than the one Bot Father is on is refused, both ways.
//   I4  The usage text names pi among init's harnesses.
//
// Other bots and temporary sessions on Pi are the other pi-*.test.js files'.
//
// Every run is in the sandbox (helpers/cli.js), with the fake Orca and a fake
// `pi` on its PATH (helpers/pi.js). The line the daily tab got is run through
// a real shell against the fake `pi`, so the check is the argv a real `pi`
// would get. Nothing here reaches the real Orca or the real `pi`.

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import {
  assertCleanFailure,
  botFatherTabs,
  botHomeOf,
  cliOnLine,
  createSandbox,
  harnessPartOf,
  hookFileOf,
  sessionIn,
  sh,
  skipGit,
  snapshot,
  TAB_SHELL,
  TAB_TITLES,
  typedInto,
} from './helpers/cli.js';
import { fakePi } from './helpers/pi.js';

/** The flags of Claude Code and Codex that must never reach Pi. */
const FOREIGN = [
  '--permission-mode', '--dangerously-skip-permissions', '--approve-for-me', '-a',
  '--dangerously-bypass-approvals-and-sandbox', '--no-daemon', '-c', '--add-dir', '--approve', '-n', '--resume',
];

const exists = (file) => access(file).then(() => true, () => false);

const initWith = (box, harness) => box.run(['init', '--bots', 'bots', '--harness', harness]);

const botFatherFile = (bots) => path.join(botHomeOf(bots), 'bot.yaml');
const botFatherDoc = async (bots) => parse(await readFile(botFatherFile(bots), 'utf8'));

/** The name of each session in a bot.yaml, whether written as a string or a mapping. */
const sessionNames = (doc) => (doc.sessions ?? []).map((session) => (typeof session === 'string' ? session : session?.name));

/** The value a flag takes in an argv, or undefined. */
const valueOf = (argv, flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);

/** The argv before `--`: the flags, without any prompt. */
const flagsOf = (argv) => (argv.includes('--') ? argv.slice(0, argv.indexOf('--')) : argv);

/** A bots folder `init --harness pi` made, with a fake `pi` on PATH. */
async function piBotFather(box) {
  const pi = await fakePi(box);
  const init = await initWith(box, 'pi');
  assert.equal(init.code, 0, `obk init --harness pi should succeed, got:\n${init.stdout}${init.stderr}`);
  return { pi, bots: box.path('bots') };
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

// ----------------------------------------------------------------- I1. init on Pi

test('I1 init --harness pi succeeds and writes Bot Father with harness: pi and its daily session', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await piBotFather(box);

  const doc = await botFatherDoc(bots);
  assert.equal(doc.name, 'bot-father');
  assert.equal(doc.harness, 'pi', `bot.yaml should say harness: pi, got: ${JSON.stringify(doc)}`);
  assert.deepEqual(sessionNames(doc), ['daily'], `Bot Father gets its daily session, got: ${JSON.stringify(doc.sessions)}`);
  assert.ok(await exists(path.join(bots, 'defaults.yaml')), 'the bots folder is seeded as for the other harnesses');
});

test('I1 init --harness pi opens Bot Father\'s daily tab and the ops tab, and the daily tab starts Pi', async (t) => {
  const box = await createSandbox(t);
  const { pi, bots } = await piBotFather(box);

  const { inBook, leftovers, terminals } = await botFatherTabs(box, bots);
  assert.equal(terminals.length, 2, `a daily tab and the ops tab, got ${JSON.stringify(terminals)}`);
  assert.equal(inBook.length, 1, 'the daily tab is in the book');
  assert.equal(inBook[0].title, TAB_TITLES.daily);
  assert.equal(leftovers.length, 1, 'and the ops tab is the other one');

  const typed = typedInto(inBook[0]);
  assert.equal(typed.length, 1, `one line typed into the daily tab, got: ${JSON.stringify(typed)}`);
  assert.ok(
    harnessPartOf(typed[0]).startsWith(`${TAB_SHELL} ${cliOnLine(box.cli)} pi `),
    `the daily tab's line should start pi, not claude or codex, got: ${typed[0]}`,
  );
  const argv = await piArgvOf(box, typed[0], pi);
  // Without --no-approve Pi trusts the folder's own files (#547).
  assert.ok(flagsOf(argv).includes('--no-approve'), `got: ${JSON.stringify(argv)}`);
  // Pi has no hook to report its id, so the book must hold the id the line carries.
  const id = valueOf(argv, '--session-id');
  assert.ok(id, `a Pi line names its session id, got: ${JSON.stringify(argv)}`);
  assert.equal((await sessionIn(bots, 'bot-father', 'daily'))?.session, id, 'the book holds the id the line carries');
  for (const flag of FOREIGN) {
    assert.equal(flagsOf(argv).includes(flag), false, `a Pi line carries no ${flag}, got: ${JSON.stringify(argv)}`);
  }
});

test('I1 up after init --harness pi succeeds and has nothing left to do', async (t) => {
  // A Bot Father that init wrote and up cannot bring up (for example a Pi
  // session set to an approval Pi does not have) fails here.
  const box = await createSandbox(t);
  const { bots } = await piBotFather(box);
  const terminals = await box.orca.terminals();
  const before = await snapshot(bots, skipGit);

  const up = await box.run(['up', '--bots', 'bots']);

  assert.equal(up.code, 0, `${up.stdout}${up.stderr}`);
  assert.deepEqual(await box.orca.terminals(), terminals, 'no tab opened, closed or typed into');
  assert.deepEqual(await snapshot(bots, skipGit), before, 'and nothing in the bots folder changed');
});

// ----------------------------------------------------------------- I2. no permission rules, no hooks

test('I2 a Bot Father on Pi gets its AGENTS.md, and no Claude settings, no Codex hooks and no Codex rules file', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await piBotFather(box);
  const home = botHomeOf(bots);

  assert.ok(await exists(path.join(home, 'AGENTS.md')), 'Bot Father gets its rules as any bot does');
  assert.equal(await exists(hookFileOf(bots, 'bot-father', 'claude')), false, 'no .claude/settings.json for a Bot Father no Claude session runs in');
  assert.equal(await exists(hookFileOf(bots, 'bot-father', 'codex')), false, 'no .codex/hooks.json');
  assert.equal(await exists(path.join(home, '.codex', 'rules', 'obk.rules')), false, 'no Codex rules file');
});

// ----------------------------------------------------------------- I3. a second init

test('I3 a second init --harness pi is fine and rewrites nothing', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await piBotFather(box);
  const before = await snapshot(bots, skipGit);
  const terminals = await box.orca.terminals();

  const second = await initWith(box, 'pi');

  assert.equal(second.code, 0, `${second.stdout}${second.stderr}`);
  assert.deepEqual(await snapshot(bots, skipGit), before, 'the second init writes nothing');
  assert.deepEqual(await box.orca.terminals(), terminals, 'and opens or types into no tab');
});

for (const other of ['claude', 'codex']) {
  test(`I3 init --harness ${other} on a Bot Father on pi is refused, says it is on pi, and rewrites nothing`, async (t) => {
    const box = await createSandbox(t);
    const { bots } = await piBotFather(box);
    // The tabs are gone, so a run that got as far as the Orca work would open
    // them again: this proves the refusal comes before anything is done.
    await box.orca.set({ terminals: [] });
    const before = await snapshot(bots, skipGit);

    const result = await initWith(box, other);

    assertCleanFailure(result);
    assert.match(result.stderr, /\bpi\b/, `the refusal should say Bot Father is on pi, got: ${result.stderr}`);
    assert.deepEqual(await snapshot(bots, skipGit), before, 'bot.yaml and the rest must be untouched');
    assert.equal((await botFatherDoc(bots)).harness, 'pi');
    assert.deepEqual(await box.orca.terminals(), [], 'a refused init must create no tab');
  });

  test(`I3 init --harness pi on a Bot Father on ${other} is refused, says it is on ${other}, and rewrites nothing`, async (t) => {
    const box = await createSandbox(t);
    await fakePi(box);
    assert.equal((await initWith(box, other)).code, 0);
    const bots = box.path('bots');
    await box.orca.set({ terminals: [] });
    const before = await snapshot(bots, skipGit);

    const result = await initWith(box, 'pi');

    assertCleanFailure(result);
    assert.match(result.stderr, new RegExp(`\\b${other}\\b`), `the refusal should say Bot Father is on ${other}, got: ${result.stderr}`);
    assert.deepEqual(await snapshot(bots, skipGit), before, 'bot.yaml and the rest must be untouched');
    assert.equal((await botFatherDoc(bots)).harness, other);
    assert.deepEqual(await box.orca.terminals(), [], 'a refused init must create no tab');
  });
}

// ----------------------------------------------------------------- I4. the usage text

test('I4 the usage text names pi beside claude and codex for init', async (t) => {
  const box = await createSandbox(t);

  const help = await box.run(['--help']);

  assert.equal(help.code, 0, help.stderr);
  const line = help.stdout.split('\n').find((one) => one.includes('obk init'));
  assert.ok(line, `the usage should have an init line, got:\n${help.stdout}`);
  for (const harness of ['claude', 'codex', 'pi']) {
    assert.match(line, new RegExp(`\\b${harness}\\b`), `the init line should name ${harness}, got: ${line}`);
  }
});
