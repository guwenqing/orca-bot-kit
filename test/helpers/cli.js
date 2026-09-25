// Runs the kit the way a user would: `obk` on PATH, in a throwaway directory.
//
// Every sandbox is its own temp tree under os.tmpdir():
//
//   <root>/bin/obk       symlink to the repo's src/cli.js (what `npm link` makes)
//   <root>/bin/orca      fake Orca (helpers/fake-orca.js), what OBK_ORCA names
//   <root>/bin/fake-ps   fake ps (helpers/fake-ps.js), what OBK_PS names
//   <root>/orca-fake/    the fake Orca's world: state.json and calls.log
//   <root>/cwd           the working directory the CLI is spawned from
//   <root>/home          HOME, so a stray write to the home dir shows up here
//   <root>/Orca.app      only after `orcaApp`: a fake of the installed app, with
//                        Orca's runtime client in it, and bin/orca linked into it
//
//   <root>/home/Library/Application Support/orca/profiles/local-default/orca-data.json
//                        Orca's own settings, where Orca keeps them on this
//                        machine (tech notes, section 1)
//
// `bin` goes first on PATH, so the CLI under test is the real entry point, and
// `<root>/bin/obk` is the path the kit is started by: the one it names itself
// by wherever it calls itself back (#220), link and all. The
// kit resolves the Orca CLI through OBK_ORCA, which every sandbox points at its
// own fake, and the same fake is on PATH as well: no test can reach the real
// Orca, whichever of the two ways it looks for it.
//
// That last file is there because a sandbox invents a home directory, and a
// home directory with no Orca settings in it is a machine Orca has never run
// on. No user is in that state while the kit is working — the kit refuses
// every command when Orca is down — so leaving it out would be the sandbox
// lying, and every run would carry a finding about settings that could not be
// read. Each sandbox is therefore given the file, holding default launch
// arguments that carry no permission bypass, and a test that is about that
// setting says what it holds through `orca.settings`.
//
// The kit reads it and must never write it (PRD 6.5), which is what
// `assertHomeUntouched` is for.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, chmod, constants, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';

export const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
/** This checkout's own CLI, by its full path: what the tests run, whatever `obk` is on PATH. */
export const cliEntry = path.join(repoRoot, 'src', 'cli.js');
const fakeOrcaEntry = fileURLToPath(new URL('./fake-orca.js', import.meta.url));
const fakePsEntry = fileURLToPath(new URL('./fake-ps.js', import.meta.url));

/** Where the fake Orca keeps its world, inside a sandbox. */
const FAKE_ORCA_DIR = 'orca-fake';

/** What the fake Orca knows before a test says otherwise: an Orca that is up and empty. */
const FRESH_ORCA = { reachable: true, waitIdle: true, setups: [], terminals: [], fail: {}, nextId: 1 };

/** Where Orca keeps its own settings, inside a home directory (tech notes, section 1). */
const ORCA_SETTINGS = path.join('Library', 'Application Support', 'orca', 'profiles', 'local-default', 'orca-data.json');

/**
 * What those settings say before a test says otherwise: a default set of launch
 * arguments for each harness Orca starts, neither carrying a permission bypass,
 * so an ordinary run hears nothing about them.
 */
const FRESH_ORCA_SETTINGS = { agentDefaultArgs: { claude: '', codex: '' } };

/** Orca's settings file is JSON with everything under one `settings` key. */
const writeSettings = (file, settings) => writeFile(file, `${JSON.stringify({ settings }, null, 2)}\n`);

/** The version the CLI is expected to print. */
export async function packageVersion() {
  const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  return pkg.version;
}

/**
 * Spawn a program and capture its exit code and streams. Never rejects on a
 * non-zero exit.
 *
 * With no `stdin` the child gets none at all, which is how a command run from
 * a script gets it and how every command but one is used here. `stdin: <text>`
 * gives it a pipe carrying that text and closes it, the way a harness runs a
 * hook and hands it the event on standard input. An empty string is a pipe
 * that closes with nothing in it, which is not the same as no pipe.
 */
function capture(command, args, options = {}) {
  const { stdin, ...rest } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...rest, stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
    if (stdin !== undefined) {
      // A hook that never reads its input leaves the pipe to be broken when it
      // exits; that is the hook's business, not a failure of the run.
      child.stdin.on('error', () => {});
      child.stdin.end(stdin);
    }
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
 *
 * `options.stdin` gives the line an input to read, which is how a harness runs
 * the kit's hook: the event goes in on standard input.
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

  // Orca's own settings, as they are on a machine Orca is running on.
  const settingsFile = path.join(home, ORCA_SETTINGS);
  await mkdir(path.dirname(settingsFile), { recursive: true });
  await writeSettings(settingsFile, FRESH_ORCA_SETTINGS);

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

  // The fake ps, reading the same world: who is in front of each tab is part
  // of what Orca's tabs hold (#232). Not called `ps`, so nothing that looks for
  // `ps` on PATH finds it; only the kit's OBK_PS names it.
  const fakePs = path.join(bin, 'fake-ps');
  await writeFile(fakePs, [
    '#!/usr/bin/env node',
    `process.env.OBK_FAKE_ORCA_DIR = ${JSON.stringify(fakeDir)};`,
    `import(${JSON.stringify(pathToFileURL(fakePsEntry).href)}).then((ps) => ps.runPs()).catch((error) => {`,
    "  process.stderr.write(`fake ps: ${error && error.stack || error}\\n`);",
    '  process.exit(70);',
    '});',
    '',
  ].join('\n'));
  await chmod(fakePs, 0o755);

  // The suite is often run from an Orca tab of its own, and Orca puts that
  // tab's variables in everything started there. None of them names a terminal
  // in the fake's world, and a kit that read them would behave one way on a
  // laptop and another in CI. So the kit starts as a plain shell outside Orca
  // does, with none, and a test that means it to run in a tab says which.
  //
  // A tab the kit launched also has OBK_CLI from its launch line (#220). A
  // sandbox starts without that too; a test that is about it sets it.
  const outsideOrca = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => !name.startsWith('ORCA_') && name !== 'OBK_CLI'));
  const env = {
    ...outsideOrca,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    HOME: home,
    OBK_ORCA: fakeOrca,
    OBK_PS: fakePs,
  };

  const readState = async () => JSON.parse(await readFile(stateFile, 'utf8'));

  /** How many times the fake Orca has answered `terminal wait` so far. */
  const waitsSoFar = async () => {
    try {
      return (await readFile(path.join(fakeDir, 'calls.log'), 'utf8'))
        .split('\n')
        .filter((line) => line !== '')
        .filter((line) => orcaCommand(JSON.parse(line)) === 'terminal wait')
        .length;
    } catch (error) {
      if (error.code === 'ENOENT') return 0;
      throw error;
    }
  };

  /** What Orca's settings say now, or nothing at all when the file has been taken away. */
  const readSettings = async () => {
    try {
      return JSON.parse(await readFile(settingsFile, 'utf8')).settings ?? {};
    } catch {
      return {};
    }
  };

  return {
    root,
    cwd,
    home,
    /** The home directory as the sandbox seeded it: what `assertHomeUntouched` holds it to. */
    homeSeeded: await snapshot(home),
    /** The environment the CLI is spawned with: `bin` first on PATH, HOME and OBK_ORCA inside the sandbox. */
    env,
    /**
     * The path `run` starts the kit by: the link in `bin`, not the file it
     * leads to. It is what the kit names itself by wherever it calls itself
     * back — its hook, its launch line, the commands it gives a bot (#220).
     */
    cli: obk,
    /** Path inside the sandbox's working directory. */
    path: (...parts) => path.join(cwd, ...parts),
    /**
     * Run `obk <args>` from the sandbox working directory (or `options.cwd`),
     * with `options.env`. `options.stdin` hands the run that text on standard
     * input; with nothing given it gets no input at all, as a command run from
     * a script does.
     */
    run: (args, options = {}) => capture('obk', args, {
      cwd: options.cwd ?? cwd,
      env: options.env ?? env,
      stdin: options.stdin,
    }),
    /** The fake ps: what it is, and every argv the kit handed it, `{ args }` in order. */
    ps: {
      cli: fakePs,
      async calls() {
        try {
          return (await readFile(path.join(fakeDir, 'ps.log'), 'utf8'))
            .split('\n')
            .filter((line) => line !== '')
            .map((line) => JSON.parse(line));
        } catch (error) {
          if (error.code === 'ENOENT') return [];
          throw error;
        }
      },
    },
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
      /** The Run mailboxes Orca has made, oldest first. */
      async runs() {
        return (await readState()).runs ?? [];
      },
      /**
       * Every message queued in the mailbox, oldest first, with the `acked`
       * flag a read takes off: whether a message was acknowledged is the whole
       * difference between a check and a `--peek`.
       */
      async messages() {
        return (await readState()).messages ?? [];
      },
      /**
       * Put one terminal, by its handle, into the orphaned state Orca 1.4.207
       * lists it in (`tabId: pty:<ptyId>`, `orphaned: true`), or with
       * `orphaned: false` back out of it. Every other terminal is left as it is.
       */
      async orphan(handle, orphaned = true) {
        const state = await readState();
        const terminal = state.terminals.find((entry) => entry.handle === handle);
        if (terminal === undefined) throw new Error(`the fake Orca has no terminal ${handle} to orphan`);
        terminal.orphaned = orphaned;
        await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
      },
      /**
       * Change what the fake Orca knows or how it misbehaves; see
       * helpers/fake-orca.js. A `waitIdle` given here starts from the next
       * `terminal wait`, however many were answered before it.
       */
      async set(changes) {
        const from = 'waitIdle' in changes ? { waitIdleFrom: await waitsSoFar() } : {};
        await writeFile(stateFile, `${JSON.stringify({ ...await readState(), ...changes, ...from }, null, 2)}\n`);
      },
      /**
       * Orca's own settings file in the sandbox home — its per-agent default
       * launch arguments and whatever else it keeps there. The kit reads it and
       * never writes it (PRD 6.5).
       *
       * `set` changes what it says, the way `set` above changes what the fake
       * knows: the keys given are merged into `settings` and the rest stay.
       * `remove` takes the file away, which is a machine whose Orca settings
       * the kit cannot read at all.
       */
      settings: {
        /** Where it is. */
        file: settingsFile,
        /** What it says now. */
        read: readSettings,
        async set(changes) {
          await mkdir(path.dirname(settingsFile), { recursive: true });
          await writeSettings(settingsFile, { ...await readSettings(), ...changes });
        },
        remove: () => rm(settingsFile, { force: true }),
      },
      /**
       * One entry per program the fake ran in the middle of a call, from
       * `runDuring`: { command, argv, status, stdout, stderr }. A test that
       * means to overlap two writers reads this to be sure the second one
       * really ran, rather than passing because it never did.
       */
      async ranDuring() {
        try {
          return (await readFile(path.join(fakeDir, 'ran-during.log'), 'utf8'))
            .split('\n')
            .filter((line) => line !== '')
            .map((line) => JSON.parse(line));
        } catch (error) {
          if (error.code === 'ENOENT') return [];
          throw error;
        }
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

/** How long a fake runtime client told to hang keeps its process alive: far past any wait the kit should make. */
export const CLIENT_HANG_MS = 30_000;

/**
 * Lay out a fake Orca app in `box`, the way the installed one is laid out, and
 * make it the Orca the kit runs:
 *
 *   <root>/Orca.app/Contents/Resources/bin/orca     the fake Orca CLI, moved in here
 *   <root>/Orca.app/Contents/MacOS/Orca             the app's binary (`executable`)
 *   <root>/Orca.app/Contents/Resources/app.asar.unpacked/out/cli/runtime-client.js
 *                                                   Orca's own runtime client (`client`)
 *
 * `<root>/bin/orca`, which OBK_ORCA names, becomes a symlink to the CLI in the
 * app, the way an install links it onto PATH: the kit finds `Contents` by
 * following it to its real path and going three levels up.
 *
 * The binary acts as plain Node only with ELECTRON_RUN_AS_NODE=1, as the real
 * one does; without it the real one would open Orca's window, so the fake stops
 * there and says so.
 *
 * `client` is how the runtime client behaves:
 *   'answers'            as Orca's runtime does: `project.update` on a project
 *                        Orca has resolves `{ id, ok: true, result, _meta }`, on
 *                        one it has not rejects with `Project not found`
 *   'missing'            there is no client file at all
 *   'no-export'          the file loads but exports no `RuntimeClient`
 *   'method-not-found'   `call` rejects with an error whose code is `method_not_found`
 *   'project-not-found'  `call` rejects with `Project not found`, whatever it was given
 *   'never-settles'      `call` never settles, and nothing else holds the process
 *   'hangs'              `call` never settles, and the process stays up for
 *                        CLIENT_HANG_MS before it ends by itself
 *
 * The client writes one line per load and per call to a log in the fake's
 * world, which `loads()` and `calls()` read back. A load carries the variables
 * of its environment the kit is meant to set or leave out.
 */
export async function orcaApp(box, { client = 'answers', executable = true } = {}) {
  const contents = path.join(box.root, 'Orca.app', 'Contents');
  const cli = path.join(contents, 'Resources', 'bin', 'orca');
  const binary = path.join(contents, 'MacOS', 'Orca');
  const clientFile = path.join(contents, 'Resources', 'app.asar.unpacked', 'out', 'cli', 'runtime-client.js');
  const fakeDir = path.join(box.root, FAKE_ORCA_DIR);
  const log = path.join(fakeDir, 'runtime-client.log');

  await mkdir(path.dirname(cli), { recursive: true });
  await writeFile(cli, await readFile(box.orca.cli, 'utf8'));
  await chmod(cli, 0o755);
  await rm(box.orca.cli);
  await symlink(cli, box.orca.cli);

  if (executable) {
    await mkdir(path.dirname(binary), { recursive: true });
    await writeFile(binary, [
      '#!/bin/sh',
      'if [ "$ELECTRON_RUN_AS_NODE" != 1 ]; then',
      '  echo "fake Orca: started without ELECTRON_RUN_AS_NODE=1, which would open Orca\'s window" >&2',
      '  exit 70',
      'fi',
      `exec '${process.execPath.replaceAll("'", "'\\''")}' "$@"`,
      '',
    ].join('\n'));
    await chmod(binary, 0o755);
  }

  if (client !== 'missing') {
    await mkdir(path.dirname(clientFile), { recursive: true });
    await writeFile(clientFile, [
      "'use strict';",
      "const { appendFileSync, readFileSync } = require('node:fs');",
      `const LOG = ${JSON.stringify(log)};`,
      `const STATE = ${JSON.stringify(path.join(fakeDir, 'state.json'))};`,
      `const MODE = ${JSON.stringify(client)};`,
      "const note = (entry) => appendFileSync(LOG, JSON.stringify(entry) + '\\n');",
      'const { ELECTRON_RUN_AS_NODE, NODE_OPTIONS, NODE_REPL_EXTERNAL_MODULE } = process.env;',
      "note({ event: 'load', env: { ELECTRON_RUN_AS_NODE, NODE_OPTIONS, NODE_REPL_EXTERNAL_MODULE } });",
      'const refusal = (message, code) => Object.assign(new Error(message), code === undefined ? {} : { code });',
      'let answered = 0;',
      'class RuntimeClient {',
      '  constructor(profile, timeoutMs) {',
      '    this.profile = profile;',
      '    this.timeoutMs = timeoutMs;',
      '  }',
      '  call(method, params) {',
      "    note({ event: 'call', method, params });",
      "    if (MODE === 'method-not-found') return Promise.reject(refusal(`Unknown method: ${method}`, 'method_not_found'));",
      "    if (MODE === 'project-not-found') return Promise.reject(refusal('Project not found'));",
      "    if (MODE === 'never-settles') return new Promise(() => {});",
      `    if (MODE === 'hangs') { setTimeout(() => {}, ${CLIENT_HANG_MS}); return new Promise(() => {}); }`,
      "    if (method !== 'project.update') return Promise.reject(refusal(`Unknown method: ${method}`, 'method_not_found'));",
      "    const setups = JSON.parse(readFileSync(STATE, 'utf8')).setups || [];",
      '    const setup = setups.find((one) => params != null && one.projectId === params.projectId);',
      "    if (setup === undefined) return Promise.reject(refusal('Project not found'));",
      '    answered += 1;',
      '    // The envelope is the one the real call answers with; what is inside `result` is this fake\'s own.',
      '    return Promise.resolve({ id: `rpc_${answered}`, ok: true, result: { project: { id: setup.projectId } }, _meta: { durationMs: 1 } });',
      '  }',
      '}',
      "module.exports = MODE === 'no-export' ? {} : { RuntimeClient };",
      '',
    ].join('\n'));
  }

  const entries = async (event) => {
    try {
      return (await readFile(log, 'utf8'))
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line))
        .filter((entry) => entry.event === event);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  };

  return {
    contents,
    /** Every call made through the client, in order: { method, params }. */
    calls: async () => (await entries('call')).map(({ method, params }) => ({ method, params })),
    /** Every time the client file was loaded, with the environment it was loaded in. */
    loads: () => entries('load'),
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
 * What every launch line puts in front of the harness word: the pid of the
 * shell the line is running in, which the tab's own shell fills in as it reads
 * the line.
 *
 * It is how the kit later tells the session's own harness from one the session
 * started inside itself. A `codex exec` a session runs inherits `ORCA_TAB_ID`
 * and reports its own conversation through the same hook; without this, the
 * book took the child's id for the session's and `up` resumed the child's
 * conversation (round 2, finding 2).
 */
export const TAB_SHELL = 'OBK_TAB_SHELL=$$';

/**
 * One word of a shell line as the kit writes it: bare when it holds nothing a
 * shell would read as more than letters, and otherwise in single quotes, with
 * each quote inside written `'\''`. The same form the kit has always given a
 * bots folder in its hook.
 */
export const shellWord = (text) => (/^[A-Za-z0-9,._+:@%/=-]+$/.test(text)
  ? text
  : `'${text.replaceAll("'", "'\\''")}'`);

/**
 * Every way a shell line can spell `text` as one word that the kit may write:
 * its own `shellWord` form, and in single quotes whether it needs them or not.
 * Which one the kit picks is its own business; both reach a shell as the same
 * word, and the tests that run the lines prove it.
 */
export const spellingsOf = (text) => [...new Set([shellWord(text), `'${text.replaceAll("'", "'\\''")}'`])];

/** A path of nothing but the characters `shellWord` leaves bare, in single quotes it does not need. */
const NEEDLESSLY_QUOTED = String.raw`'([A-Za-z0-9,._+:@%/=-]+)'`;

/**
 * A line the kit typed or wrote, with the CLI it names spelled the `shellWord`
 * way: `OBK_CLI='/a/b/obk'` read as `OBK_CLI=/a/b/obk`, and a hook's leading
 * `'/a/b/obk' session record` as `/a/b/obk session record`. The two spellings
 * are the same word to a shell, so a test that pins the rest of a line
 * exactly does not pin which of them the kit chose (#220).
 */
export const plainCli = (line) => line
  .replace(new RegExp(String.raw`^(OBK_TAB_SHELL=\$\$ OBK_CLI=)${NEEDLESSLY_QUOTED}(?= )`), '$1$2')
  .replace(new RegExp(String.raw`^${NEEDLESSLY_QUOTED}(?= session record )`), '$1');

/**
 * What a launch line carries after the pid: the CLI that typed it, for every
 * `obk` the session runs to reach the same one (#220). A variable set on the
 * line survives into both harnesses' shells where a PATH does not: Codex's
 * shell reads the user's startup files again and puts the machine's own `obk`
 * ahead of anything the line put first (measured, #220).
 */
export const cliOnLine = (cli) => `OBK_CLI=${shellWord(cli)}`;

/**
 * A launch line: the tab shell's pid, the CLI that typed it, then the harness
 * and its flags. `box` is the sandbox whose `obk` ran the `up`; a line typed
 * by the kit started some other way takes `{ cli }` instead.
 */
export const launchLine = (box, rest) => `${TAB_SHELL} ${cliOnLine(box.cli)} ${rest}`;

/**
 * A session's name, which is also the address a Claude session is reached at:
 * `<bot>.<session>` (PRD 6.9, ADR 0018). Proved live that the name survives a
 * resume, and the kit passes it on every launch anyway (tech notes, section 2).
 */
export const addressOf = (bot, session) => `${bot}.${session}`;

/**
 * The one Codex setting that lets a sandboxed session reach the Orca CLI at
 * all. Proved live: at the kit's default approval level Codex answers
 * `runtime_unavailable` for every Orca call without it, and reaches the
 * mailbox with it (tech notes, section 3).
 */
export const CODEX_NETWORK = '-c sandbox_workspace_write.network_access=true';

/**
 * The launch command a session with nothing set is started with. Every session
 * carries an explicit approval flag (ADR 0015), so a user's global harness
 * defaults cannot leak into a bot, and `auto` is what a session that named no
 * level takes. What makes the session reachable comes straight after
 * it: a Claude session's own name, and on Codex the switch that widens the
 * sandbox that flag chose far enough to reach Orca.
 */
export const bareLaunch = (box, harness, bot, session) => launchLine(box, harness === 'claude'
  ? `claude --permission-mode auto -n ${addressOf(bot, session)}`
  : `codex --approve-for-me ${CODEX_NETWORK}`);

/** Where a bot lives inside a bots folder. */
export const botHomeOf = (bots, bot = 'bot-father') => path.join(bots, 'bots', bot);

/** The tabs Orca holds for one bot's Orca project, in the order it made them. */
export async function tabsOfBot(box, bots, bot) {
  const home = botHomeOf(bots, bot);
  return (await box.orca.terminals()).filter((terminal) => terminal.worktreePath === home);
}

/** The book: what the kit knows about one bot's Orca project and its sessions. */
export const bookOf = (bots, bot = 'bot-father') => path.join(bots, 'bots', bot, 'sessions.yaml');

/** The book, parsed, or an empty mapping when the run never wrote one. */
export async function bookIn(bots, bot = 'bot-father') {
  try {
    return parse(await readFile(bookOf(bots, bot), 'utf8')) ?? {};
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

/** What the book says about one session of one bot: its tab, its harness session, its history. */
export const sessionIn = async (bots, bot, session) => (await bookIn(bots, bot)).sessions?.[session];

/**
 * What a harness hands a SessionStart hook on standard input. Proven live on
 * both harnesses (Claude Code 2.1.278, Codex 0.155.1): the same JSON, the same
 * five keys, and `source` one of `startup`, `resume`, `clear`, `compact`.
 * Each harness adds a key or two of its own; nothing the kit does reads them.
 *
 * `event` is there because the kit's answer echoes the event it was sent rather
 * than naming one of its own.
 */
export const sessionStart = ({
  session,
  source = 'startup',
  event = 'SessionStart',
  cwd = '/nowhere',
  transcript = '/nowhere/transcript.jsonl',
}) => `${JSON.stringify({
  session_id: session,
  transcript_path: transcript,
  cwd,
  hook_event_name: event,
  source,
})}\n`;

/**
 * The stand-ins that build the process chain a real harness makes, so a test can
 * run the kit's hook where the kit will believe it.
 *
 * The kit decides whose conversation a report is about from the process tree
 * (round 2, finding 2): the tab id says which session, and the ancestry says
 * whether this is that session's own harness or one the session started for
 * itself. Measured live on both harnesses, the chain is
 *
 *     the hook       /bin/sh <the hook command>   parent: the harness
 *     the harness    claude … / codex …           parent: the tab's shell
 *
 * and the tab's shell is the one whose pid the launch line carries. So a hook
 * run any other way is ignored, and a test that ran it any other way would pass
 * or fail for a reason that has nothing to do with what it meant to check.
 *
 * Node rather than shell, because a shell asked to run one command often
 * replaces itself with it, and then the parent the chain needs is never there.
 */
const CHAIN = {
  'tab-shell.cjs': `
    const { spawnSync } = require('node:child_process');
    const ran = spawnSync(process.execPath, [process.env.OBK_TEST_HARNESS], {
      stdio: 'inherit',
      env: { ...process.env, OBK_TAB_SHELL: String(process.pid) },
    });
    process.exit(ran.status ?? 0);
  `,
  'harness.cjs': `
    const { spawnSync } = require('node:child_process');
    // A session that starts a harness of its own: the same environment, one
    // generation further from the tab's shell.
    if (process.env.OBK_TEST_NESTED === '1') {
      const env = { ...process.env };
      delete env.OBK_TEST_NESTED;
      const inner = spawnSync(process.execPath, [__filename], { stdio: 'inherit', env });
      process.exit(inner.status ?? 0);
    }
    const ran = spawnSync('/bin/sh', ['-c', process.env.OBK_TEST_HOOK], {
      input: process.env.OBK_TEST_PAYLOAD ?? '',
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    process.exit(ran.status ?? 0);
  `,
};

/**
 * The chain's files, written into the sandbox, and what it takes to drive them:
 * the program to run and the environment it needs.
 *
 * Split out because the chain has to be startable from somewhere other than
 * this helper — the fake Orca runs a hook in the middle of a call, to put a
 * writer inside a run, and what it starts has to be the chain and not the hook
 * command on its own, or the kit rightly ignores the report.
 */
export async function harnessChain(box, command, { stdin = '', nested = false } = {}) {
  const dir = path.join(box.root, 'harness');
  await mkdir(dir, { recursive: true });
  for (const [name, body] of Object.entries(CHAIN)) {
    await writeFile(path.join(dir, name), `${body.trim()}\n`);
  }

  return {
    argv: [process.execPath, path.join(dir, 'tab-shell.cjs')],
    env: {
      OBK_TEST_HARNESS: path.join(dir, 'harness.cjs'),
      OBK_TEST_HOOK: command,
      OBK_TEST_PAYLOAD: stdin,
      ...(nested ? { OBK_TEST_NESTED: '1' } : {}),
    },
  };
}

/**
 * Run `command` — one shell line — the way a harness runs its hook, under the
 * chain above. `tab` is the Orca tab the session lives in, `stdin` the event,
 * and `nested: true` puts a second harness under the first, which is what a
 * session running `codex exec` does.
 *
 * Answers like `box.run`: the hook's own exit code, stdout and stderr, because
 * every process in the chain passes them straight through.
 */
export async function throughAHarness(box, command, { env, tab, stdin = '', nested = false } = {}) {
  const chain = await harnessChain(box, command, { stdin, nested });
  const [program, ...rest] = chain.argv;

  return capture(program, rest, {
    cwd: box.cwd,
    env: {
      ...(env ?? box.env),
      ...(tab === undefined ? {} : { ORCA_TAB_ID: tab }),
      ...chain.env,
    },
  });
}

/**
 * Run the kit's hook the way a harness runs it: the event on standard input,
 * the Orca pane's own `ORCA_TAB_ID` in the environment (proven live: Orca's
 * variables reach a program started in a tab and its children), and under the
 * process chain the kit reads ownership from.
 *
 * `tab` left out is a hook that ran somewhere Orca did not set one. `stdin`
 * overrides the event, for the inputs a harness should never send but might.
 * `nested` is a harness the session started for itself. `raw` runs the command
 * on its own, with no chain at all, which is how a test reaches the case of a
 * report whose owner cannot be established.
 */
export function recordSession(box, { bots, bot, tab, env, stdin, raw = false, nested = false, ...payload }) {
  const args = ['session', 'record', '--bots', bots, '--bot', bot];
  const input = stdin ?? sessionStart(payload);
  if (raw) {
    return box.run(args, {
      env: { ...(env ?? box.env), ...(tab === undefined ? {} : { ORCA_TAB_ID: tab }) },
      stdin: input,
    });
  }
  return throughAHarness(box, [box.cli, ...args].map(shellWord).join(' '), { env, tab, stdin: input, nested });
}

/**
 * Leave a conversation on the harness's own record, the way the harness does
 * once the conversation has had a turn: a file under the sandbox's home, named
 * by the id (tech notes, sections 2 and 3). A session whose book id has one
 * behind it is resumed; an id with none has nothing to resume (#295).
 *
 *   claude  ~/.claude/projects/<slug>/<id>.jsonl, where <slug> is `cwd`'s real
 *           path with everything but a letter or a digit turned into a dash
 *   codex   ~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-<stamp>-<id>.jsonl,
 *           filed under the day `at` falls on
 *
 * `cwd` is the folder the conversation ran in: the bot home, for a session.
 * The file's first line is the one each harness starts it with. Returns its path.
 */
export async function conversationOnRecord(box, { harness, cwd, id, at = new Date() }) {
  const real = await realpath(cwd);
  const stamp = at.toISOString();
  const file = harness === 'codex'
    ? path.join(box.home, '.codex', 'sessions', ...stamp.slice(0, 10).split('-'), `rollout-${stamp.replaceAll(':', '-').replace(/\..*$/, '')}-${id}.jsonl`)
    : path.join(box.home, '.claude', 'projects', real.replaceAll(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, harness === 'codex'
    ? `${JSON.stringify({ timestamp: stamp, type: 'session_meta', payload: { id, cwd: real, timestamp: stamp } })}\n`
    : `${JSON.stringify({ type: 'system', sessionId: id, cwd: real, timestamp: stamp })}\n`);
  return file;
}

/**
 * Where each harness reads a project's hooks from, inside a bot home. Both
 * were proven live on this machine: Claude Code fires a `SessionStart` hook
 * out of `<cwd>/.claude/settings.json` and Codex out of `<cwd>/.codex/hooks.json`,
 * with no user-level settings involved either side (ADR 0020).
 */
export const HOOK_FILES = {
  claude: path.join('.claude', 'settings.json'),
  codex: path.join('.codex', 'hooks.json'),
};

/** The file a bot's `<harness>` hooks live in. */
export const hookFileOf = (bots, bot, harness) => path.join(botHomeOf(bots, bot), HOOK_FILES[harness]);

/** The parsed hook file, or undefined when the kit wrote none. */
export async function hooksIn(bots, bot, harness) {
  let text;
  try {
    text = await readFile(hookFileOf(bots, bot, harness), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${hookFileOf(bots, bot, harness)} should be JSON a harness can read, got (${error.message}):\n${text}`);
  }
}

/**
 * The object in a parsed hook file that holds the events, wherever the harness
 * keeps it: the one with a `SessionStart` key. Every hook file the kit writes
 * has one, because `SessionStart` is the one event it asks about.
 */
export function eventsIn(hooks) {
  if (hooks === null || typeof hooks !== 'object' || Array.isArray(hooks)) return undefined;
  if ('SessionStart' in hooks) return hooks;
  for (const held of Object.values(hooks)) {
    const found = eventsIn(held);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * The kit's own hook commands in a parsed hook file, by the event each sits
 * under: `{ SessionStart: ['<the command>'] }` for a file the kit has written.
 * An event carrying none of them is not in the answer at all.
 *
 * How the file is arranged is the implementer's — a harness's hook format is
 * the harness's — but two things are not. The kit's entry is a shell line that
 * runs `<cli> session record`, and it belongs to one named event.
 */
export function kitEventsIn(hooks) {
  const events = eventsIn(hooks) ?? {};
  return Object.fromEntries(
    Object.entries(events)
      .map(([event, held]) => [event, stringsIn(held).filter((text) => /\bsession record\b/.test(text))])
      .filter(([, commands]) => commands.length > 0),
  );
}

/** The kit's own hook commands under `SessionStart`, which is where they belong. */
export const kitHooksIn = (hooks) => kitEventsIn(hooks).SessionStart ?? [];

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

/**
 * What was typed into a tab, in order: the text of each `terminal send`, with
 * the kit's own CLI spelled one way (`plainCli`).
 */
export const typedInto = (terminal) => (terminal.typed ?? []).map((entry) => plainCli(entry.text));

/** Each `terminal send` into a tab, `{ text, enter }`, the text as `typedInto` gives it. */
export const sentInto = (terminal) => (terminal.typed ?? []).map((entry) => ({ ...entry, text: plainCli(entry.text) }));

/**
 * The only Orca commands the kit may use (the slice interface, amendment 5,
 * and the mailbox commands PRD 6.9 needs). `orchestration reply` is not one of
 * them: proved live, a reply is filed under the replier's own Run and the
 * recipient's read never returns it (tech notes, section 1).
 */
export const ALLOWED_ORCA_COMMANDS = [
  'status',
  'project setups',
  'repo add',
  'project setup-update',
  'terminal list',
  'terminal show',
  'terminal create',
  'terminal rename',
  'terminal wait',
  'terminal send',
  // Read-only: each pane's pid, the one place Orca gives it (#232).
  'diagnostics memory',
  'orchestration run-create',
  'orchestration run-use',
  // Read-only: Orca's record of one Run, its coordinator among it (1.4.209).
  'orchestration run-show',
  'orchestration send',
  'orchestration check',
  'automations list',
  'automations create',
  'automations edit',
];

/**
 * The rules that hold for every Orca call the kit makes: one of the commands
 * above, `--json` on all of them because the human text is never parsed,
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
 * The kit wrote nothing in the user's home directory: it holds exactly what the
 * sandbox seeded there and no more, byte for byte.
 *
 * Orca's own settings file is in there, so "the home directory is empty" is no
 * longer the question. This one is stricter than that was: it catches a kit
 * that leaves a file of its own in the home directory, and it catches a kit
 * that writes back into Orca's settings, which is the one thing PRD 6.5 says
 * it must not do.
 */
export async function assertHomeUntouched(box) {
  assert.deepEqual(
    await snapshot(box.home),
    box.homeSeeded,
    'nothing of the kit\'s belongs in the user\'s home directory, and Orca\'s own settings are Orca\'s',
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
 * A refusal a person can act on: exit 1, no crash, and a reason that names
 * what they asked about. Which stream the reason comes out on is the command's
 * own business — the message commands answer in the same report shape whether
 * they could do it or not — so both are read here.
 */
export function assertRefused(result, ...named) {
  assert.equal(result.code, 1, `this should have been refused, got:\n${result.stdout}${result.stderr}`);
  const said = result.stdout + result.stderr;
  assert.notEqual(said.trim(), '', 'a refusal with nothing said is no use to anybody');
  assert.ok(!/^\s+at /m.test(said), `expected a message, got a crash:\n${said}`);
  for (const word of named) {
    assert.ok(said.includes(word), `the refusal should name ${word}, got:\n${said}`);
  }
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
