// `--bots` is given once (#527, from the review).
//
// The kit's default rules narrow each kit command to one bots folder,
// `Bash(<kit> <command> --bots <folder>:*)` (and a Codex prefix rule of the
// same words), and a rule matches a command's first words whatever follows
// them. A command with a second `--bots` after the first would match the first
// folder's rule and act on the second. So every obk command refuses `--bots`
// given more than once, in any form (`--bots X`, `--bots=X`, or both mixed),
// before it reads, writes or runs anything: not 0, a refusal that names
// `--bots` and says it is given once, and nothing written in either folder.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { botHomeOf, createSandbox, skipGit, snapshot } from './helpers/cli.js';

/** Two bots folders `init` made, side by side. */
async function twoFolders(box) {
  for (const folder of ['first', 'second']) {
    const made = await box.run(['init', '--bots', folder, '--harness', 'claude']);
    assert.equal(made.code, 0, made.stderr);
  }
  return { first: box.path('first'), second: box.path('second') };
}

/** Each way to give `--bots` twice, for the two folders. */
const TWICE = (first, second) => [
  ['the plain form', ['--bots', first, '--bots', second]],
  ['the = form', [`--bots=${first}`, `--bots=${second}`]],
  ['the two forms mixed', ['--bots', first, `--bots=${second}`]],
  ['the same folder twice', ['--bots', second, '--bots', second]],
];

/** A refusal about `--bots` given more than once. */
function assertRefusedTwice(result, what) {
  assert.notEqual(result.code, 0, `${what} should be refused, got:\n${result.stdout}${result.stderr}`);
  const said = result.stdout + result.stderr;
  assert.ok(!/^\s+at /m.test(said), `${what}: expected a message, got a crash:\n${said}`);
  assert.ok(said.includes('--bots'), `${what}: the refusal should name --bots, got:\n${said}`);
  assert.match(said, /\bonce\b/i, `${what}: the refusal should say --bots is given once, got:\n${said}`);
}

test('BO1 bot create with --bots given twice, in any form, is refused, and nothing is made in either folder', async (t) => {
  const box = await createSandbox(t);
  const { first, second } = await twoFolders(box);
  const before = { first: await snapshot(first, skipGit), second: await snapshot(second, skipGit) };

  for (const [label, bots] of TWICE('first', 'second')) {
    await t.test(label, async () => {
      const result = await box.run(['bot', 'create', ...bots, '--name', 'x', '--harness', 'claude']);

      assertRefusedTwice(result, `bot create with ${label}`);
      assert.ok(!existsSync(botHomeOf(first, 'x')), 'no bot x in the first folder');
      assert.ok(!existsSync(botHomeOf(second, 'x')), 'no bot x in the second folder');
      assert.deepEqual(await snapshot(first, skipGit), before.first, 'the first folder is as it was');
      assert.deepEqual(await snapshot(second, skipGit), before.second, 'the second folder is as it was');
    });
  }
});

for (const command of [['roster'], ['health'], ['rules', 'build']]) {
  test(`BO2 ${command.join(' ')} with --bots given twice is refused, and changes nothing`, async (t) => {
    const box = await createSandbox(t);
    const { first, second } = await twoFolders(box);
    const before = { first: await snapshot(first, skipGit), second: await snapshot(second, skipGit) };

    for (const [label, bots] of TWICE('first', 'second')) {
      await t.test(label, async () => {
        const result = await box.run([...command, ...bots]);

        assertRefusedTwice(result, `${command.join(' ')} with ${label}`);
        assert.deepEqual(await snapshot(first, skipGit), before.first);
        assert.deepEqual(await snapshot(second, skipGit), before.second);
      });
    }
  });
}

test('BO3 a single --bots still works as today, in either form', async (t) => {
  const box = await createSandbox(t);
  const { first, second } = await twoFolders(box);

  const plain = await box.run(['bot', 'create', '--bots', 'first', '--name', 'x', '--harness', 'claude']);
  const glued = await box.run(['bot', 'create', '--bots=second', '--name', 'y', '--harness', 'claude']);
  const roster = await box.run(['roster', '--bots', 'first']);

  assert.equal(plain.code, 0, `${plain.stdout}${plain.stderr}`);
  assert.equal(glued.code, 0, `${glued.stdout}${glued.stderr}`);
  assert.equal(roster.code, 0, `${roster.stdout}${roster.stderr}`);
  assert.ok(existsSync(path.join(botHomeOf(first, 'x'), 'bot.yaml')), 'x is made in the folder named');
  assert.ok(existsSync(path.join(botHomeOf(second, 'y'), 'bot.yaml')), 'y is made in the folder named');
  assert.ok(!existsSync(botHomeOf(second, 'x')) && !existsSync(botHomeOf(first, 'y')), 'and in no other');
});
