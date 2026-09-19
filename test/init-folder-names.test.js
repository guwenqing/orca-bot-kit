// A bots folder is whatever the user named it. Whitespace at either end of the
// name is part of the name, not something to tidy away: trimming it points the
// CLI at a different folder than the one the user asked for.
//
// These tests compare git's output with only its trailing newline removed. A
// `.trim()` here would strip the same whitespace the CLI must keep, and the
// assertion would agree with the bug.

import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { assertSeededBotsFolder, createSandbox, git, snapshot } from './helpers/cli.js';

/** git's answer, minus the one newline git adds. */
function line(stdout) {
  return stdout.replace(/\n$/, '');
}

async function assertRepoRootedAt(bots) {
  const toplevel = await git(['rev-parse', '--show-toplevel'], bots);
  assert.equal(toplevel.code, 0);
  assert.equal(line(toplevel.stdout), bots);
}

for (const [label, name] of [
  ['ends in a space', 'bots '],
  ['ends in a tab', 'bots\t'],
  ['begins with a space', ' bots'],
  ['contains a newline', 'bots\nline'],
]) {
  test(`init seeds a bots folder whose name ${label}`, async (t) => {
    const box = await createSandbox(t);
    const bots = box.path(name);

    const result = await box.run(['init', '--bots', name]);

    assert.equal(result.code, 0);
    await assertSeededBotsFolder(bots);
    await assertRepoRootedAt(bots);
    // Nothing was created at the tidied-up name the user did not ask for.
    assert.deepEqual(await readdir(box.cwd), [name]);
  });

  test(`a second init on a bots folder whose name ${label} changes nothing`, async (t) => {
    const box = await createSandbox(t);
    const bots = box.path(name);
    assert.equal((await box.run(['init', '--bots', name])).code, 0);

    const edited = 'rules:\n  - my-rule\nskills: []\n';
    await writeFile(path.join(bots, 'defaults.yaml'), edited);
    const before = await snapshot(bots);

    const second = await box.run(['init', '--bots', name]);

    assert.equal(second.code, 0);
    assert.deepEqual(await snapshot(bots), before);
    assert.equal(await readFile(path.join(bots, 'defaults.yaml'), 'utf8'), edited);
    assert.deepEqual(await readdir(box.cwd), [name]);
  });
}

test('an absolute path ending in a space is seeded at that exact path', async (t) => {
  const box = await createSandbox(t);
  const bots = path.join(box.root, 'elsewhere ');

  const result = await box.run(['init', '--bots', bots]);

  assert.equal(result.code, 0);
  await assertSeededBotsFolder(bots);
  await assertRepoRootedAt(bots);
  assert.ok((await readdir(box.root)).includes('elsewhere '));
  assert.ok(!(await readdir(box.root)).includes('elsewhere'));
});
