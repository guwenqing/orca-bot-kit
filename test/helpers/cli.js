// Runs the kit the way a user would: `obk` on PATH, in a throwaway directory.
//
// Every sandbox is its own temp tree under os.tmpdir():
//
//   <root>/bin/obk       symlink to the repo's src/cli.js (what `npm link` makes)
//   <root>/bin/orca      fake Orca (helpers/fake-orca.js), what OBK_ORCA names
//   <root>/orca-fake/    the fake Orca's world: state.json and calls.log
//   <root>/cwd           the working directory the CLI is spawned from
//   <root>/home          HOME, so a stray write to the home dir shows up here
//
// `bin` goes first on PATH, so the CLI under test is the real entry point. The
// kit resolves the Orca CLI through OBK_ORCA, which every sandbox points at its
// own fake, and the same fake is on PATH as well: no test can reach the real
// Orca, whichever of the two ways it looks for it.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, chmod, constants, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';

export const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const cliEntry = path.join(repoRoot, 'src', 'cli.js');
const fakeOrcaEntry = fileURLToPath(new URL('./fake-orca.js', import.meta.url));

/** Where the fake Orca keeps its world, inside a sandbox. */
const FAKE_ORCA_DIR = 'orca-fake';

/** What the fake Orca knows before a test says otherwise: an Orca that is up and empty. */
const FRESH_ORCA = { reachable: true, waitIdle: true, setups: [], terminals: [], fail: {}, nextId: 1 };

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
 * Run `text` as a shell command line, the way the tab's own shell runs what the
 * kit types into it. Used to prove a launch command means what it says: the
 * harness it starts is a fake on PATH that writes down the arguments it got, so
 * the test reads the argv a real harness would have been given.
 */
export function sh(text, options) {
  return capture('/bin/sh', ['-c', text], options);
}

/**
 * Build a sandbox for one test. Cleaned up when the test ends.
 * Returns { root, cwd, home, env, path, run, orca }.
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

  // The fake Orca: a shim with the fake's world baked into it, so it answers
  // the same whatever environment the CLI hands its child.
  const fakeDir = path.join(root, FAKE_ORCA_DIR);
  await mkdir(fakeDir);
  const stateFile = path.join(fakeDir, 'state.json');
  await writeFile(stateFile, `${JSON.stringify(FRESH_ORCA, null, 2)}\n`);

  const fakeOrca = path.join(bin, 'orca');
  await writeFile(fakeOrca, [
    '#!/usr/bin/env node',
    `process.env.OBK_FAKE_ORCA_DIR = ${JSON.stringify(fakeDir)};`,
    `import(${JSON.stringify(pathToFileURL(fakeOrcaEntry).href)}).catch((error) => {`,
    "  process.stderr.write(`fake orca: ${error && error.stack || error}\\n`);",
    '  process.exit(70);',
    '});',
    '',
  ].join('\n'));
  await chmod(fakeOrca, 0o755);

  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    HOME: home,
    OBK_ORCA: fakeOrca,
  };

  const readState = async () => JSON.parse(await readFile(stateFile, 'utf8'));

  return {
    root,
    cwd,
    home,
    /** The environment the CLI is spawned with: `bin` first on PATH, HOME and OBK_ORCA inside the sandbox. */
    env,
    /** Path inside the sandbox's working directory. */
    path: (...parts) => path.join(cwd, ...parts),
    /** Run `obk <args>` from the sandbox working directory (or `options.cwd`), with `options.env`. */
    run: (args, options = {}) => capture('obk', args, {
      cwd: options.cwd ?? cwd,
      env: options.env ?? env,
    }),
    /** The fake Orca: what it is, what it knows, and what it was asked. */
    orca: {
      /** The CLI path OBK_ORCA names. */
      cli: fakeOrca,
      /** Everything the fake Orca knows right now. */
      state: readState,
      /** The workspaces Orca has, newest last. */
      async setups() {
        return (await readState()).setups;
      },
      /** The tabs Orca has, newest last. Each carries what was typed into it. */
      async terminals() {
        return (await readState()).terminals;
      },
      /** Change what the fake Orca knows or how it misbehaves; see helpers/fake-orca.js. */
      async set(changes) {
        await writeFile(stateFile, `${JSON.stringify({ ...await readState(), ...changes }, null, 2)}\n`);
      },
      /** One entry per call the CLI made to Orca: { args, cwd }, in order. */
      async calls() {
        try {
          return (await readFile(path.join(fakeDir, 'calls.log'), 'utf8'))
            .split('\n')
            .filter((line) => line !== '')
            .map((line) => JSON.parse(line));
        } catch (error) {
          if (error.code === 'ENOENT') return [];
          throw error;
        }
      },
    },
  };
}

/** The leading words of an Orca call: 'status', 'repo add', 'terminal create'. */
export function orcaCommand(call) {
  const words = [];
  for (const arg of call.args) {
    if (arg.startsWith('-')) break;
    words.push(arg);
  }
  return words.join(' ');
}

/** Every Orca call of one command, in order. */
export const orcaCallsOf = (calls, command) => calls.filter((call) => orcaCommand(call) === command);

/** The value an Orca call gave a flag, or undefined when the flag is not there. */
export function orcaFlag(call, name) {
  const at = call.args.indexOf(name);
  return at >= 0 && at + 1 < call.args.length ? call.args[at + 1] : undefined;
}

/** The flags an Orca call carries, sorted: what it asked for, without the values. */
export const orcaFlags = (call) => call.args.filter((arg) => arg.startsWith('--')).sort();

/**
 * The titles Bot Father's two tabs carry, exactly. The kit always writes them —
 * at creation and again on every `up` — and reads only the ops tab's, because
 * the ops tab is the one tab that is not in the book. A session is its tab id.
 */
export const TAB_TITLES = { daily: 'Bot Father daily', ops: 'Bot Father ops' };

/**
 * The launch command a session with nothing set is started with. Every session
 * carries an explicit approval flag (ADR 0005), so a user's global harness
 * defaults cannot leak into a bot, and `auto` is what a session that named no
 * level takes.
 */
export const BARE_LAUNCH = { claude: 'claude --permission-mode auto', codex: 'codex --approve-for-me' };

/** Where a bot lives inside a bots folder. */
export const botHomeOf = (bots, bot = 'bot-father') => path.join(bots, 'bots', bot);

/** The tabs Orca holds for one bot's Orca project, in the order it made them. */
export async function tabsOfBot(box, bots, bot) {
  const home = botHomeOf(bots, bot);
  return (await box.orca.terminals()).filter((terminal) => terminal.worktreePath === home);
}

/** The book: what the kit knows about one bot's Orca project and its sessions. */
export const bookOf = (bots, bot = 'bot-father') => path.join(bots, 'bots', bot, 'sessions.yaml');

/** Every string anywhere under a value, however the shape around it is arranged. */
function stringsIn(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(stringsIn);
  return [];
}

/**
 * The tab ids the book holds, as sessions. The shape around them is the
 * implementer's; that they are sessions is not, because a session is what
 * grooming and the later slices read.
 */
export function sessionTabIds(book) {
  const parsed = parse(book) ?? {};
  return { parsed, sessions: new Set(stringsIn(parsed.sessions)) };
}

/**
 * Bot Father's tabs, split the only way the kit can tell them apart: the ones
 * whose ids are in the book, and the leftovers. The kit tracks nothing about
 * the ops tab — no id, no title — so to the kit it is simply a tab outside the
 * book, and so it is here. No title is read, because the kit reads none.
 */
export async function botFatherTabs(box, bots) {
  const book = await readFile(bookOf(bots), 'utf8');
  const { parsed, sessions } = sessionTabIds(book);
  const terminals = await box.orca.terminals();
  return {
    book,
    parsed,
    terminals,
    inBook: terminals.filter((terminal) => sessions.has(terminal.tabId)),
    leftovers: terminals.filter((terminal) => !sessions.has(terminal.tabId)),
  };
}

/** What was typed into a tab, in order: the text of each `terminal send`. */
export const typedInto = (terminal) => (terminal.typed ?? []).map((entry) => entry.text);

/** The only Orca commands this slice may use (the slice interface, amendment 5). */
export const ALLOWED_ORCA_COMMANDS = [
  'status',
  'project setups',
  'repo add',
  'project setup-update',
  'terminal list',
  'terminal create',
  'terminal rename',
  'terminal wait',
  'terminal send',
];

/**
 * The rules that hold for every Orca call the kit makes: one of the six
 * commands, `--json` on all of them because the human text is never parsed,
 * and never a close — closing a tab drops the user's work and Orca's resume
 * record with it.
 */
export function assertOrcaCallsAllowed(calls) {
  for (const call of calls) {
    const command = orcaCommand(call);
    const shown = call.args.join(' ');
    assert.ok(ALLOWED_ORCA_COMMANDS.includes(command), `orca ${shown}: this slice may not use that command`);
    assert.ok(call.args.includes('--json'), `orca ${shown}: every Orca call must ask for --json`);
  }
  assert.deepEqual(
    calls.filter((call) => call.args.includes('close')).map((call) => call.args),
    [],
    'orca terminal close must never be called, with any argument',
  );
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

/**
 * Everything the user put in the file is still theirs: every key they wrote
 * still carries the value they gave it, and every comment is still there, in
 * order. `changed` names the keys this edit was allowed to touch, which the
 * caller checks itself.
 *
 * Not byte for byte. The file is edited through the YAML library, which writes
 * the document back in its own hand — an inline list comes back spaced, the
 * padding in front of a comment goes — and how it lays a file out is its
 * business. What is the user's is what they said, not how it was printed.
 */
export function assertKeptWhatTheyWrote(before, after, { changed = [] } = {}) {
  const was = parse(before) ?? {};
  const now = parse(after) ?? {};
  assert.ok(now !== null && typeof now === 'object' && !Array.isArray(now), `the file should still be a mapping, got:\n${after}`);

  for (const [key, value] of Object.entries(was)) {
    if (changed.includes(key)) continue;
    assert.deepEqual(
      now[key],
      value,
      `the user's ${key} should still say what they wrote:\n--- before ---\n${before}\n--- after ---\n${after}`,
    );
  }

  const theirs = commentsIn(before);
  assert.deepEqual(
    commentsIn(after).filter((comment) => theirs.includes(comment)),
    theirs,
    `every comment the user wrote should still be there, in order:\n--- before ---\n${before}\n--- after ---\n${after}`,
  );
}

/**
 * The comments in a YAML file, in order: what follows a `#` on each line.
 * A `#` inside a quoted value would be read as one too, so the files here are
 * written without one.
 */
const commentsIn = (text) => text
  .split('\n')
  .map((line) => /(?:^|\s)#(.*)$/.exec(line)?.[1].trim())
  .filter((comment) => comment !== undefined);

/** Nothing the kit writes leaves whitespace hanging at the end of a line. */
export function assertNoTrailingSpace(text) {
  const loose = text.split('\n').filter((line) => line !== line.trimEnd());
  assert.deepEqual(loose, [], `no line should end in whitespace, got: ${JSON.stringify(loose)}`);
}

/** Skip a repo's `.git` when snapshotting or walking a tree. */
export const skipGit = (rel) => rel === '.git' || rel.startsWith('.git/');

/**
 * Skip the fake Orca's own world when snapshotting a whole sandbox. What Orca
 * remembers is Orca's, not something the kit wrote to the user's disk.
 */
export const skipOrcaFake = (rel) => rel === FAKE_ORCA_DIR || rel.startsWith(`${FAKE_ORCA_DIR}/`);

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

/**
 * Everything `init --harness <harness>` must leave at <path>. Shared: later
 * slices seed more here.
 */
export async function assertSeededBotsFolder(bots, harness) {
  assert.ok(harness === 'claude' || harness === 'codex', `the test must say which harness it seeded with, got: ${harness}`);
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
    ['charter', 'harness', 'name', 'rules', 'sessions', 'skills'],
  );
  assert.equal(botFather.name, 'bot-father');
  assert.equal(botFather.harness, harness);
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
 * `{ args, cwd, env }` per call. The fake writes `stdout` and `stderr` on the
 * way out — which only reaches the caller if it was spawned so it could — and
 * exits with `exitCode`.
 *
 * `createsFileNamedBy` is the name of an environment variable: the fake creates
 * the file it names, so a test can prove the caller cleans up after itself.
 */
export async function fakeProgram(box, name, { exitCode = 0, stdout = '', stderr = '', createsFileNamedBy = null } = {}) {
  const log = path.join(box.root, `${name}.log`);
  const file = path.join(box.root, 'bin', name);
  await writeFile(file, [
    '#!/usr/bin/env node',
    "const { appendFileSync, writeFileSync, writeSync } = require('node:fs');",
    `appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), env: process.env }) + '\\n');`,
    `const creates = ${JSON.stringify(createsFileNamedBy)};`,
    "if (creates && process.env[creates]) writeFileSync(process.env[creates], '{}\\n');",
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
