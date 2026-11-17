// A `ps` that cannot run, for one run only (#791).
//
// The kit's SessionStart hook (src/record.js) and `obk health` read the
// process table with the bare `ps` they find on PATH. The fake ps of
// helpers/fake-tools.js does not stand in for it: only `/bin/ps` by its fixed
// path goes to the fake. So a test breaks the bare `ps` through the PATH of
// the environment it hands the run, and nothing else sees it:
//
//   refusingPs   a folder first on PATH with a `ps` of its own, which writes
//                `stderr` and exits `code` (by default as a sandbox that
//                refuses it: "ps: operation not permitted", exit 1), or exits
//                0 having listed nothing
//   withoutPs    a PATH whose folders hold the sandbox's own bin and `node`
//                (a link to this Node: the CLI's shebang is
//                `#!/usr/bin/env node`), and no `ps` at all
//
// Each answers the sandbox's environment with that PATH, the rest as it was:
// its NODE_OPTIONS keeps the preload, which helpers/cli.js asks for.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** The single-quoted shell word for `text`. */
const quoted = (text) => `'${text.replaceAll("'", "'\\''")}'`;

/**
 * `box.env` with a `ps` first on PATH that writes `stderr` (and `stdout`) and
 * exits `code`. `name` keeps two such folders of one sandbox apart.
 */
export async function refusingPs(box, { stderr = 'ps: operation not permitted\n', stdout = '', code = 1, name = 'ps-refused' } = {}) {
  const dir = path.join(box.root, name);
  await mkdir(dir, { recursive: true });
  const ps = path.join(dir, 'ps');
  await writeFile(ps, [
    '#!/bin/sh',
    `printf '%s' ${quoted(stdout)}`,
    `printf '%s' ${quoted(stderr)} >&2`,
    `exit ${code}`,
    '',
  ].join('\n'));
  await chmod(ps, 0o755);
  const env = { ...box.env, PATH: `${dir}${path.delimiter}${box.env.PATH}` };
  assertPsFails(env, `the ps in ${dir}`);
  return env;
}

/** `box.env` with no `ps` anywhere on its PATH: the sandbox's bin, and a folder with `node` in it. */
export async function withoutPs(box) {
  const dir = path.join(box.root, 'node-only');
  await mkdir(dir, { recursive: true });
  await symlink(process.execPath, path.join(dir, 'node'));
  const env = { ...box.env, PATH: [path.dirname(box.cli), dir].join(path.delimiter) };
  const found = spawnSync('ps', ['-Ao', 'pid=,ppid=,comm='], { env, encoding: 'utf8' });
  assert.equal(found.error?.code, 'ENOENT', `the premise: no ps on the PATH ${env.PATH}, got status ${found.status}: ${found.stdout}${found.stderr}`);
  return env;
}

/** The premise: a bare `ps` with `env` gives no process table. */
function assertPsFails(env, what) {
  const listed = spawnSync('ps', ['-Ao', 'pid=,ppid=,comm='], { env, encoding: 'utf8' });
  assert.ok(
    listed.error !== undefined || listed.status !== 0 || listed.stdout.trim() === '',
    `the premise: ${what} gives no process table, got status ${listed.status}: ${listed.stdout}`,
  );
}
