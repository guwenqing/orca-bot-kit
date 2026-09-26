// Orca's sidebar keeps a removed project's row until its window is rebuilt
// (#343, seen live on Orca 1.4.212): `orca project setup-delete` leaves it
// under its old name, and the kit's `project.update` refresh only turns it into
// "Unknown". Orca's own menu item View › Force Reload removes it and keeps
// every terminal. So after every project removal the kit force-reloads Orca's
// window through that menu item, on macOS, with no keystrokes, by running
//
//   <osascript> <the kit's script file> <the Orca.app of the CLI in use>
//
// `reloadWindow()` in src/orca.js does it once and answers whether it was done:
// true only when osascript exits 0 and says `reloaded`. Anything else is a
// quiet false. `obk retire` is the kit's one path that removes a project:
// when the reload was done it says so in a `reloaded` line instead of the
// reload line, and `--json` answers `windowReloaded` beside `project`.
//
// Every run here is against fakes: the fake osascript (helpers/fake-osascript.js)
// writes down what it was asked and answers as a test tells it; the fake app
// (`orcaApp`) is the Orca.app the kit aims at; `asPlatform` says which platform
// the run is on, since CI is Linux.

import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import {
  asPlatform,
  botHomeOf,
  createSandbox,
  node,
  orcaApp,
  orcaCallsOf,
  recordSession,
  repoRoot,
  sessionIn,
} from './helpers/cli.js';
import { OSASCRIPT, OSASCRIPT_HANG_MS } from './helpers/fake-osascript.js';

/** The line the kit prints after a removal when it could not reload the window itself. */
const RELOAD = 'If Orca\'s sidebar does not show it, reload the window with Cmd+Shift+R.';

/** The line that says the window was reloaded: `reloaded`, its text in column 12 like `removed    Orca project <id>`, naming Orca's window. */
const RELOADED = /^reloaded {3}(?=\S).*\bOrca\b.*\bwindow\b/;

const linesOf = (result) => `${result.stdout}\n${result.stderr}`.split('\n');
const reloadLines = (result) => linesOf(result).filter((line) => line.trim() === RELOAD).length;
const reloadedLines = (result) => linesOf(result).filter((line) => RELOADED.test(line)).length;
const said = (result) => `${result.stdout}${result.stderr}`;

const exists = (file) => stat(file).then(() => true, () => false);
const isFile = (file) => stat(file).then((found) => found.isFile(), () => false);

/** The Orca.app `orcaApp` lays out in a sandbox. */
const appOf = (box) => path.join(box.root, 'Orca.app');

// ------------------------------------------------------------ reloadWindow()

const orcaModule = pathToFileURL(path.join(repoRoot, 'src', 'orca.js')).href;

/**
 * Call `reloadWindow()` once, in a process of its own with the sandbox's
 * environment, as the kit's own commands would: its answer and how long it took.
 * A throw ends that process in 1, which fails here: it never throws.
 */
async function reloadIn(box) {
  const ran = await node(['--input-type=module', '-e', [
    `const { reloadWindow } = await import(${JSON.stringify(orcaModule)});`,
    'const started = Date.now();',
    'const answer = await reloadWindow();',
    'process.stdout.write(JSON.stringify({ answer, took: Date.now() - started }));',
  ].join('\n')], { cwd: box.cwd, env: box.env });
  assert.equal(ran.code, 0, `reloadWindow() should answer and never throw, got:\n${ran.stdout}${ran.stderr}`);
  return JSON.parse(ran.stdout);
}

/** A sandbox that is a Mac with Orca installed, its osascript answering `answer`. */
async function aMac(t, answer = OSASCRIPT.reloaded) {
  const box = await createSandbox(t);
  await orcaApp(box);
  asPlatform(box, 'darwin');
  await box.osascript.answer(answer);
  return box;
}

test('R1 when osascript answers reloaded, reloadWindow() is true, having run osascript once with a script file and the Orca.app in use', async (t) => {
  const box = await aMac(t);

  const { answer } = await reloadIn(box);

  assert.equal(answer, true);
  const calls = await box.osascript.calls();
  assert.equal(calls.length, 1, `osascript once, got: ${JSON.stringify(calls)}`);
  const [script, app] = calls[0].args;
  assert.equal(calls[0].args.length, 2, `<script file> <Orca.app path> and nothing else, got: ${JSON.stringify(calls[0].args)}`);
  assert.ok(path.isAbsolute(script) && await isFile(script), `the first argument is the kit's script file, got: ${script}`);
  // OBK_ORCA is <root>/bin/orca, a link into the app: its real path is
  // <root>/Orca.app/Contents/Resources/bin/orca, four levels below the app.
  assert.equal(app, appOf(box), 'the second is the .app of the Orca CLI in use, found through its link, with no trailing slash');
});

test('R2 the Orca.app is the one the Orca CLI in use sits in, wherever it is and whatever it is called', async (t) => {
  const box = await aMac(t);
  // A second install, under another name in another folder, and OBK_ORCA
  // reaching its CLI through a link of its own.
  const other = path.join(box.root, 'Other Apps', 'Orca Nightly.app');
  const cli = path.join(other, 'Contents', 'Resources', 'bin', 'orca');
  await mkdir(path.dirname(cli), { recursive: true });
  await writeFile(cli, await readFile(box.orca.cli, 'utf8'));
  await chmod(cli, 0o755);
  const link = path.join(box.root, 'links', 'orca');
  await mkdir(path.dirname(link));
  await symlink(cli, link);
  box.env.OBK_ORCA = link;

  const { answer } = await reloadIn(box);

  assert.equal(answer, true);
  assert.deepEqual((await box.osascript.calls()).map((call) => call.args[1]), [other]);
});

test('R3 the answer is read trimmed: reloaded with blank lines and spaces around it is true', async (t) => {
  for (const stdout of ['reloaded', '  reloaded  \n', '\nreloaded\n\n']) {
    const box = await aMac(t, { stdout, code: 0 });
    assert.equal((await reloadIn(box)).answer, true, `stdout ${JSON.stringify(stdout)}`);
  }
});

test('R4 anything but exactly reloaded on a clean exit is false, tried once and never again', async (t) => {
  const answers = [
    { name: 'macOS refused', told: OSASCRIPT.refused },
    { name: 'Orca or its menu item not found', told: OSASCRIPT.notFound },
    { name: 'nothing said', told: OSASCRIPT.silent },
    { name: 'reloaded, but a failing exit', told: { stdout: 'reloaded\n', code: 1 } },
    { name: 'another word', told: { stdout: 'Reloaded\n', code: 0 } },
    { name: 'more than the word', told: { stdout: 'reloaded.\n', code: 0 } },
    { name: 'the word inside a sentence', told: { stdout: 'not reloaded\n', code: 0 } },
    { name: 'the word twice', told: { stdout: 'reloaded\nreloaded\n', code: 0 } },
  ];
  for (const { name, told } of answers) {
    const box = await aMac(t, told);
    assert.equal((await reloadIn(box)).answer, false, name);
    assert.equal((await box.osascript.calls()).length, 1, `${name}: tried once`);
  }
});

test('R5 with no osascript where OBK_OSASCRIPT points, reloadWindow() is false', async (t) => {
  const box = await aMac(t);
  box.env.OBK_OSASCRIPT = box.path('no-such-osascript');

  assert.equal((await reloadIn(box)).answer, false);

  // The same Mac with the fake back in place: the reload is done.
  box.env.OBK_OSASCRIPT = box.osascript.cli;
  assert.equal((await reloadIn(box)).answer, true);
});

test('R6 off macOS, reloadWindow() is false and runs no osascript at all', async (t) => {
  const box = await aMac(t);
  asPlatform(box, 'linux');

  assert.equal((await reloadIn(box)).answer, false);
  assert.deepEqual(await box.osascript.calls(), [], 'osascript is macOS\'s: nothing was run');

  asPlatform(box, 'darwin');
  assert.equal((await reloadIn(box)).answer, true, 'the same sandbox on macOS reloads');
  assert.equal((await box.osascript.calls()).length, 1);
});

test('R7 with no Orca CLI where OBK_ORCA points, reloadWindow() is false and does not throw', async (t) => {
  const box = await aMac(t);
  box.env.OBK_ORCA = box.path('no-such-orca');

  assert.equal((await reloadIn(box)).answer, false);
});

test('R8 an answer that takes a few seconds is still waited for', async (t) => {
  const box = await aMac(t, { ...OSASCRIPT.reloaded, delayMs: 3000 });

  const { answer, took } = await reloadIn(box);

  assert.equal(answer, true, `an osascript that answered after 3 s, in ${took} ms`);
});

test('R9 an osascript that does not answer within 5 seconds is killed, and reloadWindow() is false', async (t) => {
  // It would answer reloaded, but only after 8 s: past the 5 s the kit waits.
  const box = await aMac(t, { ...OSASCRIPT.reloaded, delayMs: 8000 });
  const started = Date.now();

  const { answer, took } = await reloadIn(box);

  assert.equal(answer, false);
  assert.ok(took < 7500, `it stopped waiting before the answer came at 8 s, took ${took} ms`);
  assert.equal((await box.osascript.calls()).length, 1, 'tried once, not again');
  // Past the time it would have answered: a killed osascript never does.
  await sleep(Math.max(0, 10_000 - (Date.now() - started)));
  assert.deepEqual(await box.osascript.answered(), [], 'the osascript was killed, and never answered');
});

// ------------------------------------------------------------------- retire

async function ok(box, args) {
  const result = await box.run(args);
  assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stderr}`);
  return result;
}

/** A bot with one session, `daily`, not yet up. */
async function newBot(box, bot = 'api-bot') {
  await ok(box, ['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', 'claude']);
  await ok(box, ['session', 'add', '--bots', 'bots', '--bot', bot, '--name', 'daily']);
}

/** A bot up in Orca, its daily session running a conversation the book knows. */
async function runningBot(box, bot = 'api-bot') {
  await newBot(box, bot);
  await ok(box, ['up', '--bots', 'bots', '--bot', bot]);
  const bots = box.path('bots');
  await recordSession(box, { bots, bot, tab: (await sessionIn(bots, bot, 'daily')).tab, session: 'sess-daily' });
}

/**
 * A Mac with Orca, Bot Father and a running api-bot whose project retire will
 * remove, the fake osascript answering `answer`. `id` is api-bot's project, as
 * retire names it.
 */
async function aBotToRetire(t, answer = OSASCRIPT.reloaded) {
  const box = await aMac(t, answer);
  await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);
  await runningBot(box);
  const home = botHomeOf(box.path('bots'), 'api-bot');
  const [setup] = (await box.orca.setups()).filter((one) => one.path === home);
  assert.ok(setup, 'up should have made api-bot an Orca project');
  return { box, id: setup.id, retired: path.join(box.path('bots'), 'retired', 'api-bot') };
}

const retire = (box, ...rest) => box.run(['retire', '--bots', 'bots', ...rest]);

/** The --json answer: JSON and nothing else, whatever the exit code. */
function answerIn(result) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${said(result)} (${error.message})`);
  }
}

test('X1 retire of a bot force-reloads Orca\'s window once, after the removal, aimed at this Orca\'s app', async (t) => {
  const { box, id } = await aBotToRetire(t);
  const from = (await box.orca.calls()).length;

  const result = await retire(box, '--bot', 'api-bot');

  assert.equal(result.code, 0, said(result));
  assert.equal(orcaCallsOf((await box.orca.calls()).slice(from), 'project setup-delete').length, 1, 'api-bot\'s project was removed');
  assert.equal((await box.orca.setups()).some((setup) => setup.id === id), false);
  const calls = await box.osascript.calls();
  assert.equal(calls.length, 1, `one reload, got: ${JSON.stringify(calls)}`);
  assert.equal(calls[0].args.length, 2);
  assert.ok(await isFile(calls[0].args[0]), `the kit's script file, got: ${calls[0].args[0]}`);
  assert.equal(calls[0].args[1], appOf(box));
});

test('X2 when the reload was done, retire says so in one reloaded line, and not the reload line', async (t) => {
  const { box, id } = await aBotToRetire(t);

  const result = await retire(box, '--bot', 'api-bot');

  assert.equal(result.code, 0, said(result));
  assert.equal(reloadedLines(result), 1, `one line starting \`reloaded   \` and naming Orca's window, got:\n${said(result)}`);
  assert.equal(reloadLines(result), 0, `the window is reloaded, so no reload line, got:\n${said(result)}`);
  assert.ok(result.stdout.split('\n').includes(`removed    Orca project ${id}`), `the removal is still reported, got:\n${said(result)}`);
});

test('X3 retire --json answers windowReloaded: true beside project when the reload was done', async (t) => {
  const { box, id, retired } = await aBotToRetire(t);

  const result = await retire(box, '--bot', 'api-bot', '--json');

  assert.equal(result.code, 0, said(result));
  assert.equal(result.stderr, '');
  const answer = answerIn(result);
  assert.equal(answer.project, id);
  assert.equal(answer.windowReloaded, true);
  assert.equal(answer.moved, retired);
  assert.deepEqual(Object.keys(answer).sort(), ['bot', 'bots', 'closed', 'moved', 'project', 'windowReloaded']);
});

/**
 * The ways the reload cannot be done, each set up on a sandbox that would
 * otherwise reload, and how many times osascript is run on the way.
 */
const CANNOT = [
  { name: 'this is not macOS', arrange: (box) => asPlatform(box, 'linux'), tries: 0 },
  { name: 'macOS refuses Accessibility or Automation', arrange: (box) => box.osascript.answer(OSASCRIPT.refused), tries: 1 },
  { name: 'Orca or its menu item is not found', arrange: (box) => box.osascript.answer(OSASCRIPT.notFound), tries: 1 },
  { name: 'osascript says nothing', arrange: (box) => box.osascript.answer(OSASCRIPT.silent), tries: 1 },
  { name: 'osascript fails', arrange: (box) => box.osascript.answer({ stdout: 'reloaded\n', code: 1 }), tries: 1 },
  { name: 'there is no osascript', arrange: (box) => { box.env.OBK_OSASCRIPT = box.path('no-such-osascript'); }, tries: 0 },
];

for (const { name, arrange, tries } of CANNOT) {
  test(`X4 when ${name}, retire still succeeds, quietly, and prints the reload line instead`, async (t) => {
    const { box, id, retired } = await aBotToRetire(t);
    await arrange(box);

    const result = await retire(box, '--bot', 'api-bot');

    assert.equal(result.code, 0, said(result));
    assert.equal(result.stderr, '', 'nothing of the failed reload is shown');
    assert.equal(reloadLines(result), 1, `the reload line, once, got:\n${said(result)}`);
    assert.equal(reloadedLines(result), 0, `no reloaded line, got:\n${said(result)}`);
    assert.ok(result.stdout.split('\n').includes(`removed    Orca project ${id}`), `got:\n${said(result)}`);
    assert.ok(await exists(path.join(retired, 'bot.yaml')), 'the bot moved to retired/ all the same');
    assert.equal((await box.osascript.calls()).length, tries, 'tried at most once');
  });

  test(`X5 when ${name}, retire --json answers windowReloaded: false beside project`, async (t) => {
    const { box, id } = await aBotToRetire(t);
    await arrange(box);

    const result = await retire(box, '--bot', 'api-bot', '--json');

    assert.equal(result.code, 0, said(result));
    assert.equal(result.stderr, '');
    const answer = answerIn(result);
    assert.equal(answer.project, id);
    assert.equal(answer.windowReloaded, false);
    assert.equal((await box.osascript.calls()).length, tries, 'tried at most once');
  });
}

test('X6 an osascript that never answers holds retire up no more than the 5 s wait, and the reload line is printed', async (t) => {
  const { box } = await aBotToRetire(t, { ...OSASCRIPT.reloaded, delayMs: OSASCRIPT_HANG_MS });
  const started = Date.now();

  const result = await retire(box, '--bot', 'api-bot');
  const took = Date.now() - started;

  assert.equal(result.code, 0, said(result));
  assert.equal(reloadLines(result), 1, `got:\n${said(result)}`);
  assert.equal(reloadedLines(result), 0, `got:\n${said(result)}`);
  assert.equal((await box.osascript.calls()).length, 1, 'tried once');
  assert.ok(took < 15_000, `an osascript that hangs for ${OSASCRIPT_HANG_MS} ms held retire ${took} ms`);
});

test('X7 retire of a bot that had no Orca project tries no reload, and answers no windowReloaded', async (t) => {
  const box = await aMac(t);
  await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);
  await newBot(box, 'idle-bot');
  await runningBot(box, 'api-bot');

  const plain = await retire(box, '--bot', 'idle-bot');
  assert.equal(plain.code, 0, said(plain));
  assert.equal(reloadedLines(plain), 0, `got:\n${said(plain)}`);
  assert.equal(reloadLines(plain), 0, `got:\n${said(plain)}`);

  await newBot(box, 'quiet-bot');
  const json = answerIn(await retire(box, '--bot', 'quiet-bot', '--json'));
  assert.equal('project' in json, false, `the premise: no project, got: ${JSON.stringify(json)}`);
  assert.equal('windowReloaded' in json, false, `got: ${JSON.stringify(json)}`);
  assert.deepEqual(await box.osascript.calls(), [], 'nothing was removed, so no reload was tried');

  // Beside them, a bot that did have one: the reload, once.
  const had = answerIn(await retire(box, '--bot', 'api-bot', '--json'));
  assert.equal(had.windowReloaded, true);
  assert.equal((await box.osascript.calls()).length, 1);
});

test('X8 retire of a session removes no project, and tries no reload', async (t) => {
  const { box } = await aBotToRetire(t);
  await ok(box, ['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'review']);

  const session = await retire(box, '--bot', 'api-bot', '--session', 'daily');

  assert.equal(session.code, 0, said(session));
  assert.equal(reloadedLines(session), 0, `got:\n${said(session)}`);
  assert.deepEqual(await box.osascript.calls(), []);

  // The bot itself, after it: its project goes, so the reload.
  const bot = await retire(box, '--bot', 'api-bot');
  assert.equal(bot.code, 0, said(bot));
  assert.equal((await box.osascript.calls()).length, 1);
  assert.equal(reloadedLines(bot), 1, `got:\n${said(bot)}`);
});

/** The ways Orca answers the delete and the removal is still not confirmed (retire.test.js, RB10). */
const UNCONFIRMED = [
  { label: 'Orca still lists the project', orca: { keepOnDelete: true } },
  { label: 'Orca lists a project at the bot\'s folder under another id', orca: { readdOnDelete: true } },
  { label: 'Orca\'s project list cannot be read', orca: { fail: { 'project setups': { since: 'project setup-delete' } } } },
];

for (const { label, orca } of UNCONFIRMED) {
  test(`X9 when ${label} after the delete, retire tries no reload`, async (t) => {
    const { box, id } = await aBotToRetire(t);
    await box.orca.set(orca);

    const result = await retire(box, '--bot', 'api-bot');

    assert.equal(result.code, 1, `the premise: the removal is not confirmed, got:\n${said(result)}`);
    assert.deepEqual(await box.osascript.calls(), [], 'no removal confirmed, so no reload');
    assert.equal(reloadedLines(result), 0, `got:\n${said(result)}`);
  });

  test(`X10 when ${label} after the delete, retire --json tries no reload and does not answer windowReloaded: true`, async (t) => {
    const { box, id } = await aBotToRetire(t);
    await box.orca.set(orca);

    const result = await retire(box, '--bot', 'api-bot', '--json');

    assert.equal(result.code, 1, `the premise: the removal is not confirmed, got:\n${said(result)}`);
    const answer = answerIn(result);
    assert.equal(answer.project, id);
    assert.equal(typeof answer.trouble, 'string', `got: ${JSON.stringify(answer)}`);
    assert.notEqual(answer.windowReloaded, true, `got: ${JSON.stringify(answer)}`);
    assert.deepEqual(await box.osascript.calls(), [], 'no removal confirmed, so no reload');
  });
}
