// Pi slice 1 (#578): the line that starts a Pi session, and how `obk up` opens
// one fresh, resumes one, and starts over when Pi has nothing on record.
//
// Pi takes `--session-id <id>`: it opens the session with that id in the
// working folder's session folder, and makes one with that id when there is
// none. So the kit chooses the id itself on a fresh start, writes it into the
// book before it types the line, and hands the same id back on a resume. Pi
// writes the session's file only after the first turn, under
// $HOME/.pi/agent/sessions/--<folder>--/<timestamp>_<id>.jsonl, and that file
// is what tells a session that can be resumed from one that cannot.
//
// The line always carries `--no-approve` (Pi then shows no project-trust
// screen), the session's model as `--model`, its effort as `--thinking`, its
// name as `--name <bot>.<session>`, the user's extra arguments after the kit's
// own flags, and on a fresh start the prompt after `--`. It carries nothing of
// Claude Code's or Codex's approval flags: every Pi session runs as
// `dangerously-skip` (#547), and a Pi session whose bot.yaml says otherwise is
// refused before anything is made or changed in Orca: only the kit's
// read-only `status` check may come first.
//
// The tests read the line the kit typed and run it through a real shell
// against a fake `pi` (helpers/pi.js), so what is checked is the argv a real
// `pi` would get. HOME is the sandbox's, so every Pi session file is there.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { launchCommand } from '../src/launch.js';
import {
  assertOrcaCallsAllowed,
  bookOf,
  botHomeOf,
  cliOnLine,
  createSandbox,
  harnessPartOf,
  orcaCallsOf,
  orcaCommand,
  sessionIn,
  sh,
  TAB_SHELL,
  tabsOfBot,
  typedInto,
} from './helpers/cli.js';
import { fakePi, PI_ID, piSessionOnRecord, piLines, yamlEntry } from './helpers/pi.js';

const BOT = 'pi-bot';
const PROMPT = 'Read your AGENTS.md and keep the queue moving.';

/** The flags of Claude Code and Codex that must never reach Pi. */
const FOREIGN = [
  '--permission-mode', '--dangerously-skip-permissions', '--approve-for-me', '-a',
  '--dangerously-bypass-approvals-and-sandbox', '--no-daemon', '-c', '--add-dir', '--approve', '-n', '--resume',
];

/** A bots folder with a Pi bot and one Pi session, not yet brought up. */
async function withPiSession(box, settings = ['--prompt', PROMPT]) {
  const init = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(init.code, 0, init.stderr);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'pi']);
  assert.equal(made.code, 0, `${made.stdout}${made.stderr}`);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily', ...settings]);
  assert.equal(added.code, 0, `${added.stdout}${added.stderr}`);
  const bots = box.path('bots');
  return { bots, home: botHomeOf(bots, BOT) };
}

/** `obk <command>` for the Pi bot with --json; the session's one tab entry and the lines typed into it. */
async function broughtUp(box, command = 'up') {
  const result = await box.run([command, '--bots', 'bots', '--bot', BOT, '--json']);
  assert.equal(result.code, 0, `obk ${command}: ${result.stdout}${result.stderr}`);
  const answer = JSON.parse(result.stdout);
  const entries = answer.tabs.filter((entry) => entry.name === 'daily');
  assert.equal(entries.length, 1, `the session's tab should be reported once, got: ${result.stdout}`);
  const live = (await tabsOfBot(box, box.path('bots'), BOT)).find((terminal) => terminal.tabId === entries[0].tabId);
  assert.ok(live, `the tab reported should be one Orca has, got: ${result.stdout}`);
  return { entry: entries[0], typed: typedInto(live) };
}

/** The session's tab, closed the way a user closes one: Orca stops listing it. */
async function closeTab(box, tabId) {
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((terminal) => terminal.tabId !== tabId) });
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

/** The value a flag takes in an argv, or undefined. */
const valueOf = (argv, flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);

/** The argv before `--`: the flags, without the prompt. */
const flagsOf = (argv) => (argv.includes('--') ? argv.slice(0, argv.indexOf('--')) : argv);

/** The line starts Pi, after the tab shell's pid and the kit's own CLI. */
function assertStartsPi(box, line) {
  assert.ok(
    harnessPartOf(line).startsWith(`${TAB_SHELL} ${cliOnLine(box.cli)} pi `),
    `the line should start pi, got: ${line}`,
  );
}

/** Nothing of another harness's on a Pi argv. */
function assertNoForeignFlags(argv) {
  const flags = flagsOf(argv);
  for (const flag of FOREIGN) {
    assert.equal(flags.includes(flag), false, `a Pi line carries no ${flag}, got: ${JSON.stringify(argv)}`);
  }
}

/**
 * Arrange for the fake Orca to read the book at the moment the kit types its
 * next line (the next `terminal send`), before that send is answered. What it
 * read comes back from `bookAtSend`.
 */
async function readBookAtNextSend(box, bots) {
  const dir = path.join(box.root, 'pi-test');
  await mkdir(dir, { recursive: true });
  const script = path.join(dir, 'read-book.cjs');
  await writeFile(script, [
    "const { readFileSync } = require('node:fs');",
    `const { parse } = require(${JSON.stringify(yamlEntry)});`,
    `let book = {};`,
    `try { book = parse(readFileSync(${JSON.stringify(bookOf(bots, BOT))}, 'utf8')) ?? {}; } catch {}`,
    "process.stdout.write(JSON.stringify(book));",
    '',
  ].join('\n'));
  await box.orca.set({
    runDuring: {
      command: 'terminal send',
      argv: [process.execPath, script],
      on: orcaCallsOf(await box.orca.calls(), 'terminal send').length + 1,
    },
  });
}

async function bookAtSend(box) {
  const ran = await box.orca.ranDuring();
  assert.equal(ran.length, 1, `the book should have been read once, as the line was typed, got: ${JSON.stringify(ran)}`);
  assert.equal(ran[0].status, 0, ran[0].stderr);
  return JSON.parse(ran[0].stdout);
}

/** A folder to stand for a bot home, for launchCommand called directly. */
async function aHome(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-pi-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'bots', 'bots', BOT);
  await mkdir(home, { recursive: true });
  return { root, home };
}

// ----------------------------------------------------------------- 5. launchCommand

test('L5 a fresh Pi start: the line starts pi with --session-id <id>, --no-approve, and the prompt after --', async (t) => {
  const box = await createSandbox(t);
  const pi = await fakePi(box);
  const { home } = await aHome(t);

  const line = launchCommand({ name: 'daily', approval: 'dangerously-skip' }, { harness: 'pi', home, sessionId: 'fresh-id-1', prompt: PROMPT });

  // The fake `pi` on PATH is what the line ran, once: the line starts Pi.
  const argv = await piArgvOf(box, line, pi);
  assert.equal(valueOf(argv, '--session-id'), 'fresh-id-1', `got: ${JSON.stringify(argv)}`);
  assert.ok(flagsOf(argv).includes('--no-approve'), `got: ${JSON.stringify(argv)}`);
  assert.deepEqual(argv.slice(-2), ['--', PROMPT], `the prompt comes last, after --, got: ${JSON.stringify(argv)}`);
  assertNoForeignFlags(argv);
});

test('L5 a Pi resume: the line carries --session-id <id> and no prompt', async (t) => {
  const box = await createSandbox(t);
  const pi = await fakePi(box);
  const { home } = await aHome(t);

  const line = launchCommand({ name: 'daily', approval: 'dangerously-skip' }, { harness: 'pi', home, resume: 'old-id-7' });

  const argv = await piArgvOf(box, line, pi);
  assert.equal(valueOf(argv, '--session-id'), 'old-id-7', `got: ${JSON.stringify(argv)}`);
  assert.ok(argv.includes('--no-approve'), `got: ${JSON.stringify(argv)}`);
  assert.equal(argv.includes('--'), false, `a resume carries no prompt, got: ${JSON.stringify(argv)}`);
  assertNoForeignFlags(argv);
});

test('L5 a Pi line carries the model as --model and the effort as --thinking', async (t) => {
  const box = await createSandbox(t);
  const pi = await fakePi(box);
  const { home } = await aHome(t);

  const line = launchCommand(
    { name: 'daily', approval: 'dangerously-skip', model: 'cursor/claude-opus-5-5@1m', effort: 'xhigh' },
    { harness: 'pi', home, sessionId: 'fresh-id-2', prompt: PROMPT },
  );

  const argv = await piArgvOf(box, line, pi);
  assert.equal(valueOf(argv, '--model'), 'cursor/claude-opus-5-5@1m', `got: ${JSON.stringify(argv)}`);
  assert.equal(valueOf(argv, '--thinking'), 'xhigh', `got: ${JSON.stringify(argv)}`);
});

test('L5 a Pi line with no model and no effort carries neither --model nor --thinking', async (t) => {
  const box = await createSandbox(t);
  const pi = await fakePi(box);
  const { home } = await aHome(t);

  const argv = await piArgvOf(box, launchCommand({ name: 'daily', approval: 'dangerously-skip' }, { harness: 'pi', home, sessionId: 'fresh-id-3' }), pi);

  assert.equal(argv.includes('--model'), false, `got: ${JSON.stringify(argv)}`);
  assert.equal(argv.includes('--thinking'), false, `got: ${JSON.stringify(argv)}`);
  assert.equal(argv.includes('--'), false, `no prompt, no --, got: ${JSON.stringify(argv)}`);
});

test('L5 the user\'s extra arguments come after the kit\'s own flags and before the prompt', async (t) => {
  const box = await createSandbox(t);
  const pi = await fakePi(box);
  const { home } = await aHome(t);

  const argv = await piArgvOf(box, launchCommand(
    { name: 'daily', approval: 'dangerously-skip', model: 'anthropic/claude-opus-5-5', effort: 'high', extra_args: ['--verbose', '--tools', 'read,bash'] },
    { harness: 'pi', home, sessionId: 'fresh-id-4', prompt: PROMPT },
  ), pi);

  const extra = argv.indexOf('--verbose');
  assert.ok(extra >= 0, `the extra args reach pi, got: ${JSON.stringify(argv)}`);
  assert.deepEqual(argv.slice(extra, extra + 3), ['--verbose', '--tools', 'read,bash'], 'as given, in order');
  for (const kitFlag of ['--session-id', '--no-approve', '--model', '--thinking']) {
    assert.ok(argv.indexOf(kitFlag) >= 0 && argv.indexOf(kitFlag) < extra, `${kitFlag} comes before the user's own, got: ${JSON.stringify(argv)}`);
  }
  assert.deepEqual(argv.slice(extra + 3), ['--', PROMPT], `and the prompt after them, got: ${JSON.stringify(argv)}`);
});

test('L5 a Pi line gets no --add-dir, whatever its work dir and the kit\'s folders', async (t) => {
  const box = await createSandbox(t);
  const pi = await fakePi(box);
  const { root, home } = await aHome(t);
  const kit = { messages: path.join(root, 'bots.messages', BOT), prompts: path.join(root, 'bots.prompts', BOT), locks: path.join(root, 'bots.locks', BOT) };

  const argv = await piArgvOf(box, launchCommand(
    { name: 'daily', approval: 'dangerously-skip', work_dir: path.join(root, 'clones', 'api') },
    { harness: 'pi', home, workDir: path.join(root, 'clones', 'api'), kit, sessionId: 'fresh-id-5', prompt: PROMPT },
  ), pi);

  assertNoForeignFlags(argv);
});

test('L5 a Pi launch with neither a session id nor a resume throws', async (t) => {
  const { home } = await aHome(t);

  // What is missing is the id: the same launch with one is a line.
  assert.equal(typeof launchCommand({ name: 'daily', approval: 'dangerously-skip' }, { harness: 'pi', home, sessionId: 'fresh-id-6', prompt: PROMPT }), 'string');
  assert.throws(() => launchCommand({ name: 'daily', approval: 'dangerously-skip' }, { harness: 'pi', home, prompt: PROMPT }));
  assert.throws(() => launchCommand({ name: 'daily', approval: 'dangerously-skip' }, { harness: 'pi', home }));
});

// ----------------------------------------------------------------- 6. a fresh up

test('L6 up of a Pi session with no id in the book types pi --session-id <new id> --no-approve --name <bot>.<session> and the prompt', async (t) => {
  const box = await createSandbox(t);
  const pi = await fakePi(box);
  const { bots } = await withPiSession(box);

  const { typed, entry } = await broughtUp(box);

  assert.equal(typed.length, 1, `one send into the new tab, got: ${JSON.stringify(typed)}`);
  assertStartsPi(box, typed[0]);
  const argv = await piArgvOf(box, typed[0], pi);
  const id = valueOf(argv, '--session-id');
  assert.match(String(id), PI_ID, `the id is one Pi takes, got: ${JSON.stringify(argv)}`);
  assert.ok(flagsOf(argv).includes('--no-approve'), `got: ${JSON.stringify(argv)}`);
  assert.equal(valueOf(argv, '--name'), `${BOT}.daily`, `got: ${JSON.stringify(argv)}`);
  assert.deepEqual(argv.slice(-2), ['--', PROMPT], `the start prompt comes last, got: ${JSON.stringify(argv)}`);
  assertNoForeignFlags(argv);
  assert.equal((await sessionIn(bots, BOT, 'daily'))?.session, id, 'the book holds the id the line carries');
  assert.equal(entry.created, true);
  assert.equal(entry.resumed, false);
});

test('L6 the book holds the new id before the line is typed', async (t) => {
  // Pi has no hook to report its id: the kit names it, so it has to be in the
  // book before Pi can start with it.
  const box = await createSandbox(t);
  const pi = await fakePi(box);
  const { bots } = await withPiSession(box);
  await readBookAtNextSend(box, bots);

  const { typed } = await broughtUp(box);

  const id = valueOf(await piArgvOf(box, typed[0], pi), '--session-id');
  const book = await bookAtSend(box);
  assert.equal(book?.sessions?.daily?.session, id, `as the line was typed, the book held: ${JSON.stringify(book)}`);
});

test('L6 the id is new for each fresh start', async (t) => {
  // Two fleets alike in every way: an id made from the bot and the session would be the same in both.
  const ids = [];
  for (let n = 0; n < 2; n += 1) {
    const box = await createSandbox(t);
    const pi = await fakePi(box);
    await withPiSession(box);
    const { typed } = await broughtUp(box);
    ids.push(valueOf(await piArgvOf(box, typed[0], pi), '--session-id'));
  }
  assert.notEqual(ids[0], ids[1], `two fresh starts, two ids, got: ${JSON.stringify(ids)}`);
});

test('L6 the Pi line carries the session\'s model, effort and extra args through up', async (t) => {
  const box = await createSandbox(t);
  const pi = await fakePi(box);
  await withPiSession(box, ['--model', 'anthropic/claude-opus-5-5', '--effort', 'high', '--extra-arg=--verbose', '--prompt', PROMPT]);

  const { typed } = await broughtUp(box);

  const argv = await piArgvOf(box, typed[0], pi);
  assert.equal(valueOf(argv, '--model'), 'anthropic/claude-opus-5-5', `got: ${JSON.stringify(argv)}`);
  assert.equal(valueOf(argv, '--thinking'), 'high', `got: ${JSON.stringify(argv)}`);
  assert.ok(argv.indexOf('--verbose') > argv.indexOf('--session-id'), `got: ${JSON.stringify(argv)}`);
  assert.deepEqual(argv.slice(-2), ['--', PROMPT]);
});

test('L6 a Pi up keeps to the allowed Orca commands, and closes nothing', async (t) => {
  const box = await createSandbox(t);
  await fakePi(box);
  await withPiSession(box);

  await broughtUp(box);

  assertOrcaCallsAllowed(await box.orca.calls());
});

// ----------------------------------------------------------------- 7. a resume

/** Up once fresh, then leave Pi's file for the book's id in `cwd`'s session folder, and close the tab. */
async function upThenRecorded(box, { bots, home }, cwd = home) {
  const first = await broughtUp(box);
  const id = (await sessionIn(bots, BOT, 'daily'))?.session;
  assert.match(String(id), PI_ID, `the first up should have put an id in the book, got: ${id}`);
  await piSessionOnRecord({ home: box.home, cwd, id, lines: [piLines.user(PROMPT, new Date(), 1)] });
  await closeTab(box, first.entry.tabId);
  return { id, first };
}

test('L7 up of a Pi session whose id Pi has on record resumes it with --session-id <id>, and no start prompt', async (t) => {
  const box = await createSandbox(t);
  const pi = await fakePi(box);
  const where = await withPiSession(box);
  const { id, first } = await upThenRecorded(box, where);

  const again = await broughtUp(box);

  assert.notEqual(again.entry.tabId, first.entry.tabId, 'a new tab');
  assert.equal(again.typed.length, 1, `one send into the new tab, got: ${JSON.stringify(again.typed)}`);
  assertStartsPi(box, again.typed[0]);
  assert.ok(!again.typed[0].includes(PROMPT), `the session already has its duty, got: ${again.typed[0]}`);
  const argv = await piArgvOf(box, again.typed[0], pi);
  assert.equal(valueOf(argv, '--session-id'), id, `the same conversation, got: ${JSON.stringify(argv)}`);
  assert.ok(argv.includes('--no-approve'), `got: ${JSON.stringify(argv)}`);
  assert.equal(valueOf(argv, '--name'), `${BOT}.daily`, `got: ${JSON.stringify(argv)}`);
  assert.equal(argv.includes('--'), false, `no prompt at all, got: ${JSON.stringify(argv)}`);
  assertNoForeignFlags(argv);
  assert.equal(again.entry.resumed, true, `the report says it was resumed, got: ${JSON.stringify(again.entry)}`);
  assert.equal((await sessionIn(where.bots, BOT, 'daily'))?.session, id, 'and the book still names it');
});

test('L7 the plain report says a Pi session was resumed', async (t) => {
  const box = await createSandbox(t);
  await fakePi(box);
  const where = await withPiSession(box);
  await upThenRecorded(box, where);

  const result = await box.run(['up', '--bots', 'bots', '--bot', BOT]);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.match(result.stdout, /resum/i, `the report should say it was resumed, got:\n${result.stdout}`);
});

test('L7 a Pi file for the id in another folder\'s session folder is not this session\'s: it starts over', async (t) => {
  // Pi files a session under the folder it ran in, and the bot's session runs at its bot home.
  const box = await createSandbox(t);
  const pi = await fakePi(box);
  const where = await withPiSession(box);
  const elsewhere = path.join(box.root, 'elsewhere');
  await mkdir(elsewhere);
  const { id } = await upThenRecorded(box, where, elsewhere);

  const again = await broughtUp(box);

  const argv = await piArgvOf(box, again.typed[0], pi);
  assert.notEqual(valueOf(argv, '--session-id'), id, `nothing of this bot's to resume, got: ${JSON.stringify(argv)}`);
  assert.deepEqual(argv.slice(-2), ['--', PROMPT], `a fresh start carries its prompt, got: ${JSON.stringify(argv)}`);
  assert.equal(again.entry.resumed, false);
});

// ----------------------------------------------------------------- 8. no conversation

test('L8 up of a Pi session whose id Pi has no file for: the old id goes into history, a new id is chosen and the prompt goes on the line', async (t) => {
  const box = await createSandbox(t);
  const pi = await fakePi(box);
  const { bots } = await withPiSession(box);
  const first = await broughtUp(box);
  const old = (await sessionIn(bots, BOT, 'daily'))?.session;
  assert.match(String(old), PI_ID, `the first up should have put an id in the book, got: ${old}`);
  await closeTab(box, first.entry.tabId);
  await readBookAtNextSend(box, bots);

  const again = await broughtUp(box);

  const argv = await piArgvOf(box, again.typed[0], pi);
  const id = valueOf(argv, '--session-id');
  assert.match(String(id), PI_ID, `got: ${JSON.stringify(argv)}`);
  assert.notEqual(id, old, 'a new id, not the one Pi has nothing for');
  assert.deepEqual(argv.slice(-2), ['--', PROMPT], `told its duty again, got: ${JSON.stringify(argv)}`);
  assert.equal(again.entry.resumed, false);

  const daily = await sessionIn(bots, BOT, 'daily');
  assert.equal(daily.session, id, `the book holds the new id, got: ${JSON.stringify(daily)}`);
  assert.deepEqual(
    (daily.history ?? []).map(({ session, ended }) => ({ session, ended })),
    [{ session: old, ended: 'no conversation' }],
    `the old id went into history as having no conversation, got: ${JSON.stringify(daily)}`,
  );
  assert.equal((await bookAtSend(box))?.sessions?.daily?.session, id, 'and the book held the new id before the line was typed');
});

// ----------------------------------------------------------------- 3. approval in bot.yaml

for (const level of ['auto', 'ask']) {
  test(`L3 up refuses a Pi session whose bot.yaml says approval: ${level}, before anything is made in Orca`, async (t) => {
    const box = await createSandbox(t);
    await fakePi(box);
    const { bots } = await withPiSession(box);
    const file = path.join(botHomeOf(bots, BOT), 'bot.yaml');
    const text = await readFile(file, 'utf8');
    assert.match(text, /approval: dangerously-skip/, `session add should have written dangerously-skip, got:\n${text}`);
    await writeFile(file, text.replace('approval: dangerously-skip', `approval: ${level}`));
    const calls = (await box.orca.calls()).length;
    const terminals = await box.orca.terminals();
    const setups = await box.orca.setups();

    const result = await box.run(['up', '--bots', 'bots', '--bot', BOT]);

    assert.notEqual(result.code, 0, `this should have been refused, got:\n${result.stdout}${result.stderr}`);
    const said = result.stdout + result.stderr;
    assert.ok(!/^\s+at /m.test(said), `expected a message, got a crash:\n${said}`);
    assert.ok(said.includes('daily'), `the refusal should name the session, got:\n${said}`);
    assert.match(said, /\bPi\b/, `and name Pi, got:\n${said}`);
    assert.match(said, /approval prompt/i, `and say Pi has no approval prompt, got:\n${said}`);
    assert.match(said, /permission rules/i, `and no permission rules, got:\n${said}`);
    assert.ok(said.includes('dangerously-skip'), `so every Pi session runs as dangerously-skip, got:\n${said}`);
    const asked = (await box.orca.calls()).slice(calls).filter((call) => orcaCommand(call) !== 'status');
    assert.deepEqual(asked.map((call) => call.args.join(' ')), [], 'Orca was asked nothing but the read-only status check: no project, no tab, no send');
    assert.deepEqual(await box.orca.terminals(), terminals, 'no tab was opened or changed');
    assert.deepEqual(await box.orca.setups(), setups, 'no project was made or changed');
  });
}
