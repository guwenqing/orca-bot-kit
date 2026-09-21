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

/** A bare `orca` offered as the program of a command, rather than a path to one. */
const BARE_ORCA = /(?:^|[\s'"`(])orca\s+[a-z]/;

/** The lines of a report that offer the reader a way to look at a tab. */
const lookAtLines = (stdout) => stdout.split('\n').filter((line) => line.includes('terminal read'));

/**
 * The command a report line offers for pasting: the tail of the line after the
 * last run of two or more spaces before the Orca call. The report lays its lines
 * out in columns two spaces apart (`Look at it:  <command>`), so that gap is
 * where the label ends and the command begins, and a path with a single space in
 * it stays inside the command where it belongs.
 */
function pastedCommand(line) {
  const at = line.indexOf('terminal read');
  assert.ok(at > 0, `no Orca call on this line: ${line}`);

  let start = 0;
  for (const gap of line.slice(0, at).matchAll(/\s{2,}/g)) start = gap.index + gap[0].length;
  return line.slice(start).trim();
}

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

/** Paste one printed command and hold it to having run and reached Orca. */
async function assertRuns(paste, command) {
  const ran = await paste(command);
  assert.equal(
    ran.code,
    0,
    `pasted \`${command}\` and it exited ${ran.code}: ${ran.stderr.trim() || ran.stdout.trim()}`,
  );
  assert.match(
    ran.stdout,
    /terminal read/,
    `pasted \`${command}\` and it did not reach Orca's terminal read, got: ${ran.stdout}`,
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

    const offered = lookAtLines(init.stdout);
    assert.ok(offered.length > 0, `the report should say where to look, got: ${init.stdout}`);
    for (const line of offered) await assertRuns(paste, pastedCommand(line));
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

  const offered = lookAtLines(init.stdout);
  assert.equal(offered.length, 1, `one tab to look at, so one line, got: ${init.stdout}`);

  const command = pastedCommand(offered[0]);
  assert.ok(command.includes(box.orca.cli), `the command should name ${box.orca.cli}, got: ${command}`);
  assert.ok(command.includes(started[0].handle), `and the tab it is about, got: ${command}`);
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

  const offered = lookAtLines(init.stdout);
  assert.ok(offered.length > 0, `the report should say where to look, got: ${init.stdout}`);
  for (const line of offered) {
    const command = pastedCommand(line);
    assert.ok(command.includes(spaced), `the command should name ${spaced}, got: ${command}`);
    await assertRuns(paste, command);
  }
});

// Covers the acceptance as written: every command the kit prints, not only the
// two lines that were wrong. A sweep over what the kit says on the ordinary
// roads and the unhappy ones, held to offering no bare `orca` anywhere.
test('nothing the kit prints anywhere offers a bare orca', async (t) => {
  const box = await createSandbox(t);
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

  // The two roads that print a command at all, each in its own sandbox because
  // the state has to be set before the tabs are made.
  for (const state of [{ waitIdle: false }, { waitIdle: 'blocked' }]) {
    const other = await createSandbox(t);
    await other.orca.set(state);
    const init = await other.run(['init', '--bots', 'bots', '--harness', 'claude']);
    printed.push([`obk init with ${JSON.stringify(state)}`, init.stdout + init.stderr]);
  }

  // Without this the sweep could pass by never reaching a printed command at
  // all, which would prove nothing about any of them.
  assert.ok(
    printed.some(([, text]) => lookAtLines(text).length > 0),
    'the sweep must reach a run that prints a command, or it says nothing about printed commands',
  );

  for (const [what, text] of printed) {
    assert.notEqual(text, '', `${what} printed nothing at all`);
    assert.deepEqual(
      text.split('\n').filter((line) => BARE_ORCA.test(line)),
      [],
      `${what} offers a bare orca, which does not resolve for a normal user; name the CLI the kit uses`,
    );
  }
});
