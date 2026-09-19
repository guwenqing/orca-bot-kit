// Runs the kit the way a user would: `obk` on PATH, in a throwaway directory.
//
// Every sandbox is its own temp tree under os.tmpdir():
//
//   <root>/bin/obk       symlink to the repo's src/cli.js (what `npm link` makes)
//   <root>/bin/orca      fake Orca; logs its arguments to <root>/orca.log
//   <root>/cwd           the working directory the CLI is spawned from
//   <root>/home          HOME, so a stray write to the home dir shows up here
//
// `bin` goes first on PATH, so the CLI under test is the real entry point and
// any call to `orca` is recorded instead of reaching the real Orca.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const cliEntry = path.join(repoRoot, 'src', 'cli.js');

/** The version the CLI is expected to print. */
export async function packageVersion() {
  const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  return pkg.version;
}

/** Spawn a program and capture its exit code and streams. Never rejects on a non-zero exit. */
function capture(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

/** Run git in `cwd` and report the result without throwing. */
export function git(args, cwd) {
  return capture('git', args, { cwd });
}

/**
 * Build a sandbox for one test. Cleaned up when the test ends.
 * Returns { root, cwd, home, env, path, run, orcaCalls }.
 */
export async function createSandbox(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-')));
  t.after(() => rm(root, { recursive: true, force: true }));

  const bin = path.join(root, 'bin');
  const cwd = path.join(root, 'cwd');
  const home = path.join(root, 'home');
  await mkdir(bin);
  await mkdir(cwd);
  await mkdir(home);

  // The bin entry is a symlink, so the CLI must carry its own shebang and exec bit.
  await symlink(cliEntry, path.join(bin, 'obk'));

  const orcaLog = path.join(root, 'orca.log');
  const fakeOrca = path.join(bin, 'orca');
  await writeFile(fakeOrca, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${orcaLog}'\nexit 0\n`);
  await chmod(fakeOrca, 0o755);

  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    HOME: home,
  };

  return {
    root,
    cwd,
    home,
    /** The environment the CLI is spawned with: `bin` first on PATH, HOME inside the sandbox. */
    env,
    /** Path inside the sandbox's working directory. */
    path: (...parts) => path.join(cwd, ...parts),
    /** Run `obk <args>` from the sandbox working directory (or `options.cwd`). */
    run: (args, options = {}) => capture('obk', args, { cwd: options.cwd ?? cwd, env }),
    /** One entry per call the CLI made to the fake `orca`. */
    async orcaCalls() {
      try {
        return (await readFile(orcaLog, 'utf8')).split('\n').filter((line) => line !== '');
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
    },
  };
}

/**
 * A handled failure: exit 1, a message on stderr, nothing on stdout, and no
 * crash — an uncaught exception would also exit 1 with text on stderr, so the
 * stack frames are what tells the two apart.
 */
export function assertCleanFailure(result) {
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.notEqual(result.stderr.trim(), '');
  assert.ok(!/^\s+at /m.test(result.stderr), `expected a message, got a crash:\n${result.stderr}`);
}

/** Skip a repo's `.git` when snapshotting or walking a tree. */
export const skipGit = (rel) => rel === '.git' || rel.startsWith('.git/');

/**
 * Map every path under `dir` to a description of its bytes:
 * 'dir', 'symlink:<target>' or 'file:<sha256>'. Used to prove a tree did not change.
 */
export async function snapshot(dir, skip = () => false) {
  const out = {};
  async function walk(rel) {
    const abs = rel === '' ? dir : path.join(dir, rel);
    const entries = await readdir(abs, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (skip(childRel)) continue;
      const childAbs = path.join(abs, entry.name);
      if (entry.isSymbolicLink()) {
        out[childRel] = `symlink:${await readlink(childAbs)}`;
      } else if (entry.isDirectory()) {
        out[childRel] = 'dir';
        await walk(childRel);
      } else {
        out[childRel] = `file:${createHash('sha256').update(await readFile(childAbs)).digest('hex')}`;
      }
    }
  }
  await walk('');
  return out;
}
