// Every command the kit prints for a person to paste has to run when pasted
// (issue #144).
//
// The defect: the report told the reader `orca terminal read --terminal …
// --screen`. A bare `orca` does not resolve for a normal user on this machine —
// /usr/local/bin/orca is a root-only symlink and answers "Unable to determine
// Orca.app path from symlink" (tech notes, section 1) — and the kit itself never
// calls one: `orcaCli()` in src/orca.js is OBK_ORCA or the path inside the app
// bundle. The kit was telling the user to run something it would not run itself.
//
// So these tests paste the line rather than read it. In a sandbox OBK_ORCA names
// the fake Orca, so the command the kit prints names the fake's path and pasting
// it reaches the fake; that is what makes the requirement checkable here at all.
//
// Which printed lines are commands: the ones the kit introduces as commands,
// with `Look at it:`. Nothing else here decides what a command is. An earlier
// version of this file scanned every printed line for something that looked
// like a bare `orca`, and that was not sound: with TMPDIR under a folder called
// `my orca tools`, an ordinary "is not a bots folder" message naming the
// sandbox path matched, and the suite went red on a kit behaving perfectly. A
// path may hold any words at all; only the kit's own structure says where a
// command is.
//
// The one thing the sandbox has to be talked out of: it also puts the fake on
// PATH under the name `orca`, so that no test can reach the real Orca whichever
// way the kit looks for it. A user's machine has no such `orca`. The shell these
// tests paste into is therefore given a PATH with node and the system
// directories and no `orca` on it anywhere, and each test proves that before it
// pastes anything.

import assert from 'node:assert/strict';
import { chmod, copyFile, mkdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createSandbox, sh } from './helpers/cli.js';

/** How the kit introduces a command it wants the reader to run. */
const OFFER = 'Look at it:';

/** The commands an output offers for pasting: the tail of each line that offers one. */
const offeredIn = (text) => text
  .split('\n')
  .filter((line) => line.includes(OFFER))
  .map((line) => line.slice(line.indexOf(OFFER) + OFFER.length).trim());

/**
 * A shell like the user's: node and the system directories, and no `orca`
 * reachable by name. Pasting into it is the whole check, so it asserts its own
 * premise before handing the paste back.
 */
async function pasteShell(box) {
  const bin = path.join(box.root, 'plain-bin');
  await mkdir(bin, { recursive: true });
  await symlink(process.execPath, path.join(bin, 'node'));

  const env = { PATH: [bin, '/usr/bin', '/bin'].join(path.delimiter), HOME: box.home };
  const bare = await sh('command -v orca', { env, cwd: box.cwd });
  assert.notEqual(bare.code, 0, `this shell must have no bare orca on it, but found: ${bare.stdout}`);

  return (command) => sh(command, { env, cwd: box.cwd });
}

/**
 * Paste one offered command and hold it to having run and reached Orca.
 *
 * Asked without `--json`, the fake answers `Orca <command words>: …`, which no
 * other program on that shell says: a command that merely exits 0, or one that
 * echoes its own arguments back, does not pass for an Orca that was reached.
 */
async function assertRuns(paste, command, from = 'the report') {
  const ran = await paste(command);
  assert.equal(
    ran.code,
    0,
    `${from} offers \`${command}\` and it exited ${ran.code}: ${ran.stderr.trim() || ran.stdout.trim()}`,
  );
  assert.match(
    ran.stdout,
    /^Orca terminal read: /m,
    `${from} offers \`${command}\` and it did not reach Orca's terminal read, got: ${ran.stdout}`,
  );
}

for (const [label, state] of [
  ['a harness that never came up', { waitIdle: false }],
  ['a harness waiting on something', { waitIdle: 'blocked' }],
]) {
  // Covers: the command the kit prints for the user to run, runs when pasted.
  test(`the line that says where to look after ${label} runs when it is pasted`, async (t) => {
    const box = await createSandbox(t);
    await box.orca.set(state);
    const paste = await pasteShell(box);

    const init = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
    assert.equal(init.code, 0, init.stderr);

    const offered = offeredIn(init.stdout);
    assert.ok(offered.length > 0, `the report should say where to look, got: ${init.stdout}`);
    for (const command of offered) await assertRuns(paste, command);
  });
}

// Covers: it names the Orca CLI the kit uses itself, not something else that
// happens to run, and the tab it is telling the reader about.
test('the line that says where to look names the kit\'s own Orca CLI and the tab it is about', async (t) => {
  const box = await createSandbox(t);
  await box.orca.set({ waitIdle: false });

  const init = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(init.code, 0, init.stderr);

  // The tab the reader is sent to is the one the harness was typed into; the
  // fake wrote down which that was, so the handle comes from it and not from
  // the report being checked.
  const started = (await box.orca.terminals()).filter((terminal) => (terminal.typed ?? []).length > 0);
  assert.equal(started.length, 1, 'the harness was typed into one tab');

  const offered = offeredIn(init.stdout);
  assert.equal(offered.length, 1, `one tab to look at, so one command offered, got: ${init.stdout}`);
  assert.ok(offered[0].includes(box.orca.cli), `it should name ${box.orca.cli}, got: ${offered[0]}`);
  assert.ok(offered[0].includes(started[0].handle), `and the tab it is about, got: ${offered[0]}`);
});

// Covers: the same requirement for an Orca kept where the path has a space in
// it. An unquoted path the shell splits in two is the same defect in another
// coat: the line does not run when pasted.
test('the line still runs when the Orca CLI sits under a path with a space in it', async (t) => {
  const box = await createSandbox(t);
  await box.orca.set({ waitIdle: false });
  const paste = await pasteShell(box);

  // OBK_ORCA may name anything. The fake is copied rather than linked, so the
  // copy is a program in its own right; it keeps the fake's world baked into it
  // and answers exactly as the original does.
  const spaced = path.join(box.root, 'orca cli', 'orca');
  await mkdir(path.dirname(spaced), { recursive: true });
  await copyFile(box.orca.cli, spaced);
  await chmod(spaced, 0o755);

  const init = await box.run(['init', '--bots', 'bots', '--harness', 'claude'], {
    env: { ...box.env, OBK_ORCA: spaced },
  });
  assert.equal(init.code, 0, init.stderr);

  const offered = offeredIn(init.stdout);
  assert.ok(offered.length > 0, `the report should say where to look, got: ${init.stdout}`);
  for (const command of offered) {
    assert.ok(command.includes(spaced), `it should name ${spaced}, got: ${command}`);
    await assertRuns(paste, command);
  }
});

// Covers the acceptance more widely than the two lines that were wrong: a sweep
// of the kit's ordinary and unhappy roads, where every command any of them
// offers is pasted rather than read.
//
// What it reaches: any command offered the way the kit offers one. A new offer
// written like the existing ones is checked here without anyone remembering to
// come back and add it. What it does not reach: an offer introduced some other
// way, which the sweep does not see as a command at all, and the `obk …` lines
// in the help, which resolve as the kit is installed and whose side effects
// have no business running inside an assertion. The count below is what keeps
// the first limit honest: if the wording moves, this finds nothing and says so
// rather than passing on an empty sweep.
test('every command the kit offers on any of its roads runs when it is pasted', async (t) => {
  const box = await createSandbox(t);
  const paste = await pasteShell(box);

  const printed = [];
  const record = async (args, options) => {
    const result = await box.run(args, options);
    printed.push([`obk ${args.join(' ')}`.trim(), result.stdout + result.stderr]);
    return result;
  };

  await record(['--help']);
  await record([]);
  await record(['init', '--bots', 'bots']);
  await record(['up', '--bots', 'bots']);
  await record(['init', '--bots', 'bots', '--harness', 'claude']);
  await record(['up', '--bots', 'bots']);
  await record(['health', '--bots', 'bots']);
  await record(['roster', '--bots', 'bots']);
  await record(['usage', '--bots', 'bots']);
  await record(['groom', '--bots', 'bots']);
  await record(['rules', 'build', '--bots', 'bots']);
  await record(['skills', 'build', '--bots', 'bots']);
  await record(['bot', 'create', '--bots', 'bots', '--name', 'scout', '--harness', 'codex']);
  await record(['session', 'add', '--bots', 'bots', '--bot', 'scout', '--name', 'watch']);
  await record(['message', 'to', '--bots', 'bots', '--to', 'bot-father']);
  await record(['message', 'check', '--bots', 'bots', '--bot', 'bot-father']);
  await record(['restart', '--bots', 'bots', '--bot', 'bot-father']);
  await box.orca.set({ reachable: false });
  await record(['up', '--bots', 'bots']);

  // The two roads that have something to offer, each in its own sandbox because
  // the state has to be set before the tabs are made. They are the sweep's
  // anchor: a sweep that offers nothing at all proves nothing about offers.
  for (const state of [{ waitIdle: false }, { waitIdle: 'blocked' }]) {
    const other = await createSandbox(t);
    await other.orca.set(state);
    const init = await other.run(['init', '--bots', 'bots', '--harness', 'claude']);
    const what = `obk init with ${JSON.stringify(state)}`;
    assert.equal(
      offeredIn(init.stdout).length,
      1,
      `${what} leaves a tab to look at, so it should offer one command, got: ${init.stdout}`,
    );
    printed.push([what, init.stdout + init.stderr]);
  }

  for (const [what, text] of printed) {
    for (const command of offeredIn(text)) await assertRuns(paste, command, what);
  }
});
