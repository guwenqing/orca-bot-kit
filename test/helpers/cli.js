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
import { access, chmod, constants, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

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
  const obk = path.join(bin, 'obk');
  await symlink(cliEntry, obk);

  // A bin entry that cannot be executed does not stop the PATH search: the
  // tests would walk on and silently run whatever `obk` is installed on this
  // machine. Refuse here, once per sandbox, rather than test the wrong CLI.
  try {
    await access(obk, constants.X_OK);
  } catch (error) {
    throw new Error(
      `the sandbox cannot run ${cliEntry} (${error.code}), so \`obk\` on PATH would fall through ` +
      'to another copy of the CLI; give the entry point its exec bit back (chmod +x)',
    );
  }

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

async function readYaml(file) {
  return parse(await readFile(file, 'utf8'));
}

/** Everything `init` must leave at <path>. Shared: later slices seed more here. */
export async function assertSeededBotsFolder(bots) {
  assert.ok((await lstat(bots)).isDirectory(), `${bots} should be a directory`);
  assert.ok((await lstat(path.join(bots, '.git'))).isDirectory(), '.git should be a directory');

  const defaults = await readYaml(path.join(bots, 'defaults.yaml'));
  assert.deepEqual(defaults, { rules: [], skills: [] });

  const skills = await readYaml(path.join(bots, 'skills.yaml'));
  assert.deepEqual(skills, { sources: [] });

  assert.deepEqual(await readdir(path.join(bots, 'rules')), ['.gitkeep']);
  assert.deepEqual(await readdir(path.join(bots, 'skills')), ['.gitkeep']);

  const botFather = await readYaml(path.join(bots, 'bots', 'bot-father', 'bot.yaml'));
  assert.deepEqual(
    Object.keys(botFather).sort(),
    ['charter', 'name', 'rules', 'sessions', 'skills'],
  );
  assert.equal(botFather.name, 'bot-father');
  assert.equal(typeof botFather.charter, 'string');
  assert.notEqual(botFather.charter.trim(), '');
  assert.ok(Array.isArray(botFather.rules), 'bot.yaml rules should be a list');
  assert.ok(Array.isArray(botFather.skills), 'bot.yaml skills should be a list');
  assert.ok(Array.isArray(botFather.sessions), 'bot.yaml sessions should be a list');
}

/** Run `node <args>` in `cwd` and report the result without throwing. */
export function node(args, options) {
  return capture(process.execPath, args, options);
}

/**
 * Put a fake `<name>` first on PATH in `box`, in place of the real program.
 * Every call appends what it was given to a log; `calls()` reads them back, one
 * `{ args, cwd }` per call. The fake writes `stdout` and `stderr` on the way
 * out — which only reaches the caller if it was spawned so it could — and exits
 * with `exitCode`.
 */
export async function fakeProgram(box, name, { exitCode = 0, stdout = '', stderr = '' } = {}) {
  const log = path.join(box.root, `${name}.log`);
  const file = path.join(box.root, 'bin', name);
  await writeFile(file, [
    '#!/usr/bin/env node',
    "const { appendFileSync, writeSync } = require('node:fs');",
    `appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + '\\n');`,
    `writeSync(1, ${JSON.stringify(stdout)});`,
    `writeSync(2, ${JSON.stringify(stderr)});`,
    `process.exit(${exitCode});`,
    '',
  ].join('\n'));
  await chmod(file, 0o755);

  return {
    async calls() {
      try {
        return (await readFile(log, 'utf8')).split('\n').filter((line) => line !== '').map((line) => JSON.parse(line));
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
    },
  };
}
