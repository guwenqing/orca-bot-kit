// Pi slice 6 (#662): every Pi launch line loads the kit's Pi extension.
//
// The extension (src/pi-record.js, tested in test/pi-new-followed.test.js) is
// how the book follows a `/new` typed in a Pi tab. Pi loads it from
// `--extension <path>`. So every Pi line the kit types, fresh and resume, from
// `launchCommand` and so from `obk up` and `obk restart`, carries
// `--extension <the absolute path of the kit's src/pi-record.js>` as two
// words, and still `--no-approve`. The path is that of the kit that typed the
// line: this clone's own src/, as with OBK_CLI. Claude Code and Codex lines
// carry no such flag.
//
// The tests read the line the kit typed and run it through a real shell
// against a fake `pi` (helpers/pi.js), so what is checked is the argv a real
// `pi` would get. Where `--extension` sits among the flags is not pinned.
// Every run is in the sandbox (helpers/cli.js), with its own HOME.

import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { launchCommand } from '../src/launch.js';
import {
  botHomeOf,
  createSandbox,
  sessionIn,
  sh,
  tabsOfBot,
  typedInto,
} from './helpers/cli.js';
import { fakePi, piLines, piSessionOnRecord } from './helpers/pi.js';
import { PI_RECORD } from './helpers/pi-extension.js';

const BOT = 'pi-bot';
const PROMPT = 'Read your AGENTS.md and keep the queue moving.';

/** `obk <args>` that must work. */
async function ok(box, args, options) {
  const result = await box.run(args, options);
  assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return result;
}

/** A Pi bot with its Pi session daily, not yet brought up. */
async function piBot(box) {
  await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(box, ['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'pi']);
  await ok(box, ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily', '--prompt', PROMPT]);
  const bots = box.path('bots');
  return { bots, home: await realpath(botHomeOf(bots, BOT)) };
}

/** The Orca terminal that holds `session`'s tab. */
async function terminalOf(box, bots, session) {
  const tab = (await sessionIn(bots, BOT, session))?.tab;
  const terminal = (await tabsOfBot(box, bots, BOT)).find((one) => one.tabId === tab);
  assert.ok(terminal, `${session} should have a tab in Orca, got the book's ${tab}`);
  return terminal;
}

/** The argv a shell running `line` hands `pi`: the one launch it makes. */
async function piArgvOf(box, line, pi) {
  const before = (await pi.launches()).length;
  const ran = await sh(line, { cwd: box.cwd, env: box.env });
  assert.equal(ran.code, 0, `the line should run: ${line}\n${ran.stderr}`);
  const launches = (await pi.launches()).slice(before);
  assert.equal(launches.length, 1, `the line should start pi once: ${line}`);
  return launches[0].args;
}

const flagsOf = (argv) => (argv.includes('--') ? argv.slice(0, argv.indexOf('--')) : argv);

/** The argv loads the kit's own src/pi-record.js, by its absolute path, as two words, once; and keeps --no-approve. */
async function assertKitExtension(argv) {
  const flags = flagsOf(argv);
  const at = flags.indexOf('--extension');
  assert.ok(at >= 0, `a Pi line carries --extension, got: ${JSON.stringify(argv)}`);
  assert.equal(flags.filter((word) => word === '--extension').length, 1, `once, got: ${JSON.stringify(argv)}`);
  assert.ok(!flags.some((word) => word.startsWith('--extension=')), `as two words, got: ${JSON.stringify(argv)}`);
  const value = flags[at + 1];
  assert.ok(typeof value === 'string' && path.isAbsolute(value), `by an absolute path, got: ${JSON.stringify(argv)}`);
  await access(value).catch(() => assert.fail(`the extension file should be there: ${value}`));
  assert.equal(await realpath(value), await realpath(PI_RECORD), `the kit's own src/pi-record.js, got: ${value}`);
  assert.ok(flags.includes('--no-approve'), `and still --no-approve, got: ${JSON.stringify(argv)}`);
}

/** A folder to stand for a bot home, for launchCommand called directly. */
async function aHome(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-pi-ext-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'bots', 'bots', BOT);
  await mkdir(home, { recursive: true });
  return home;
}

test('X1 launchCommand: a fresh Pi line and a Pi resume line each carry --extension <the kit\'s src/pi-record.js>', async (t) => {
  const box = await createSandbox(t);
  const pi = await fakePi(box);
  const home = await aHome(t);
  const session = { name: 'daily', approval: 'dangerously-skip' };

  await assertKitExtension(await piArgvOf(box, launchCommand(session, { harness: 'pi', home, sessionId: 'fresh-id-1', prompt: PROMPT }), pi));
  await assertKitExtension(await piArgvOf(box, launchCommand(session, { harness: 'pi', home, resume: 'old-id-7' }), pi));
});

test('X2 launchCommand: Claude Code and Codex lines carry no --extension', async (t) => {
  const home = await aHome(t);

  for (const harness of ['claude', 'codex']) {
    for (const extra of [{ prompt: PROMPT }, { resume: 'old-id-7' }]) {
      const line = launchCommand({ name: 'daily', approval: 'auto' }, { harness, home, ...extra });
      assert.ok(!line.includes('--extension'), `a ${harness} line carries no --extension, got: ${line}`);
      assert.ok(!line.includes('pi-record'), `nor the Pi extension, got: ${line}`);
    }
  }
  // The control: the same call for Pi does carry it.
  const pi = launchCommand({ name: 'daily', approval: 'dangerously-skip' }, { harness: 'pi', home, sessionId: 'fresh-id-2', prompt: PROMPT });
  assert.ok(pi.includes('--extension') && pi.includes('pi-record'), `a Pi line carries the extension, got: ${pi}`);
});

/** Whether a typed line starts pi. */
const startsPi = (line) => / pi /.test(line) || / pi$/.test(line);

/** The last line typed into `session`'s tab that starts pi. */
async function lastPiLine(box, bots, session) {
  const typed = typedInto(await terminalOf(box, bots, session));
  const lines = typed.filter(startsPi);
  assert.ok(lines.length > 0, `a pi line should have been typed into ${session}'s tab, got: ${JSON.stringify(typed)}`);
  return lines.at(-1);
}

test('X3 obk up, fresh and resumed, types a Pi line that carries the extension', async (t) => {
  const box = await createSandbox(t);
  const pi = await fakePi(box);
  const { bots, home } = await piBot(box);
  await ok(box, ['up', '--bots', 'bots', '--bot', BOT]);
  const { tab, session: id } = await sessionIn(bots, BOT, 'daily');

  await assertKitExtension(await piArgvOf(box, await lastPiLine(box, bots, 'daily'), pi));

  // Pi has the id on record, and the tab is closed, as a user closes one: the next up resumes.
  await piSessionOnRecord({ home: box.home, cwd: home, id, lines: [piLines.user(PROMPT, new Date(), 1)] });
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((terminal) => terminal.tabId !== tab) });
  await ok(box, ['up', '--bots', 'bots', '--bot', BOT]);

  const argv = await piArgvOf(box, await lastPiLine(box, bots, 'daily'), pi);
  assert.equal(argv[argv.indexOf('--session-id') + 1], id, `the up should have resumed, got: ${JSON.stringify(argv)}`);
  await assertKitExtension(argv);
});

test('X4 obk restart types a Pi line that carries the extension', async (t) => {
  const box = await createSandbox(t);
  const pi = await fakePi(box);
  const { bots } = await piBot(box);

  // A session never brought up: restart starts it.
  await ok(box, ['restart', '--bots', 'bots', '--bot', BOT]);
  await assertKitExtension(await piArgvOf(box, await lastPiLine(box, bots, 'daily'), pi));

  // And a session that is up: restart starts it again, with a new line.
  const was = await terminalOf(box, bots, 'daily');
  await ok(box, ['restart', '--bots', 'bots', '--bot', BOT]);
  const now = await terminalOf(box, bots, 'daily');
  assert.ok(
    now.tabId !== was.tabId || typedInto(now).filter(startsPi).length > typedInto(was).filter(startsPi).length,
    `the restart typed a new Pi line, got: ${JSON.stringify(typedInto(now))}`,
  );
  await assertKitExtension(await piArgvOf(box, await lastPiLine(box, bots, 'daily'), pi));
});
