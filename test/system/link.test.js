// A system test: it runs against this machine as it really is, which is why it
// is not part of `npm test`. Run it with `npm run test:system`.
//
// What it proves is that `npm link` did what the README says it does — `obk` is
// this repo's CLI, reachable from anywhere. It only reads: it starts the CLI in
// a temp directory, and creates, changes and deletes nothing.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, constants, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { packageVersion, repoRoot } from '../helpers/cli.js';

const LINK = 'run `npm link` in this repo first';

/** The first `name` PATH would run, the way a shell finds it. */
async function onPath(name) {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (dir === '') continue;
    const candidate = path.join(dir, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not here; keep walking PATH.
    }
  }
  return undefined;
}

test('the `obk` on PATH is this repo\'s CLI', async () => {
  const found = await onPath('obk');
  assert.ok(found, `there is no \`obk\` on PATH: ${LINK}`);

  assert.equal(
    await realpath(found),
    await realpath(path.join(repoRoot, 'src', 'cli.js')),
    `the \`obk\` on PATH is ${found}, which is not this repo's CLI: ${LINK}`,
  );
});

test('`obk --version` runs from anywhere and prints this repo\'s version', async () => {
  // From a temp directory, so nothing about the repo's own folder can help it.
  const result = spawnSync('obk', ['--version'], { cwd: os.tmpdir(), encoding: 'utf8' });

  assert.ok(!result.error, `could not run \`obk\`: ${result.error?.message}: ${LINK}`);
  assert.equal(result.status, 0, `\`obk --version\` failed: ${result.stderr}`);
  assert.equal(result.stdout, `${await packageVersion()}\n`);
  assert.equal(result.stderr, '');
});
