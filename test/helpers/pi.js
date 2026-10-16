// Pi as the tests of #578 see it: a fake `pi` on the sandbox's PATH, and Pi's
// own record of a session under the sandbox's HOME. No test reaches the real
// `pi` or the real ~/.pi.
//
// What the fake does is what Pi 1.1.0 was seen to do (the brief of #578,
// checked live by the architect):
//
//   pi --version              prints `1.1.0`, exit 0
//   pi --list-models          a table of the models Pi can use, exit 0; with
//                             no provider signed in, a line that starts
//                             `No models available.`, still exit 0
//   pi --list-models <search> the matching rows, or
//                             `No models matching "<search>"`, exit 0
//   anything else             a launch: it writes down its argv and exits 0
//
// A test can also make `--list-models` fail, the plain form and the search
// form each on its own: exit 1 with a message, or die by a signal (the kit
// then has no exit code at all to read). And the search form can answer
// `No models available.` with exit 0 while the plain form lists models: Pi
// 1.1.0 prints that line before it applies the search (the review of #583).
//
// The table's layout is this fake's own: the kit decides only on the two
// lines above, never on the rows. Which rows match a search is a plain
// case-insensitive substring of `<provider>/<model>`, which is narrower than
// whatever Pi really does, and enough for the models used here.
//
// Pi keeps a session as one file (the brief of #578):
//
//   $HOME/.pi/agent/sessions/--<folder>--/<timestamp>_<id>.jsonl
//
// <folder> is the working folder's real path without its leading `/`, with
// every `/`, `\` and `:` turned into `-`; <timestamp> is the ISO time with `:`
// and `.` turned into `-` (2026-10-16T18-42-43-786Z). The first line is the
// session header; a user turn is a `message` line whose message has
// `role: "user"`.

import { appendFile, chmod, mkdir, readFile, realpath, symlink, utimes, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

/** The models the fake Pi can use when a test says nothing else, as `<provider>/<model>`. */
export const PI_MODELS = [
  'anthropic/claude-opus-5-5',
  'anthropic/claude-sonnet-5',
  'openai/gpt-6.1-sol',
  'ollama/llama3:8b',
];

/** Pi's thinking levels, which `--thinking` takes and a model may carry as a `:<level>` suffix. */
export const PI_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/** An id Pi takes for `--session-id`. */
export const PI_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

const FAKE = `
const { appendFileSync, readFileSync } = require('node:fs');
const LOG = __LOG__;
const CONFIG = __CONFIG__;
appendFileSync(LOG, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + '\\n');
const told = JSON.parse(readFileSync(CONFIG, 'utf8'));
const args = process.argv.slice(2);
const out = (text) => process.stdout.write(text);
if (args[0] === '--version') {
  if (told.version === 'fails') {
    process.stderr.write('pi: something is broken in this install\\n');
    process.exit(1);
  }
  out('1.1.0\\n');
  process.exit(0);
}
const at = args.indexOf('--list-models');
if (at >= 0) {
  const searching = args[at + 1] !== undefined && !args[at + 1].startsWith('-');
  const how = searching ? told.search : told.listModels;
  if (how === 'fails') {
    process.stderr.write('pi: could not reach the model registry\\n');
    process.exit(1);
  }
  if (how === 'killed') process.kill(process.pid, 'SIGKILL');
  if (!told.signedIn || how === 'no-models') {
    out('No models available. Use /login, or set an API key, to sign in to a provider.\\n');
    process.exit(0);
  }
  const search = searching ? args[at + 1] : undefined;
  const rows = told.models.filter((id) => search === undefined || id.toLowerCase().includes(search.toLowerCase()));
  if (rows.length === 0) {
    out('No models matching "' + search + '"\\n');
    process.exit(0);
  }
  out('provider   model                     context  thinking\\n');
  for (const id of rows) {
    const [provider, ...model] = id.split('/');
    out(provider.padEnd(11) + model.join('/').padEnd(26) + '200K     yes\\n');
  }
  process.exit(0);
}
process.exit(0);
`;

/**
 * Put a fake `pi` first on `box`'s PATH. `told` says how it behaves:
 * `{ version: 'ok' | 'fails', signedIn: true | false, models: [...],
 * listModels: 'ok' | 'fails' | 'killed', search: 'ok' | 'fails' | 'killed' | 'no-models' }`,
 * `listModels` for a plain `--list-models` and `search` for one with a search.
 *
 * Gives back `calls()`, every argv it was run with, `{ args, cwd }` in order;
 * `launches()`, only the calls that start a session (not `--version` or
 * `--list-models`); `searches()`, the search of each `--list-models` call,
 * `undefined` for one with none; and `set(changes)`, which changes how it
 * behaves from its next call on.
 */
export async function fakePi(box, told = {}) {
  const file = path.join(box.root, 'bin', 'pi');
  const log = path.join(box.root, 'pi.log');
  const config = path.join(box.root, 'pi-fake.json');
  const state = { version: 'ok', signedIn: true, models: PI_MODELS, listModels: 'ok', search: 'ok', ...told };
  await writeFile(config, `${JSON.stringify(state)}\n`);
  await writeFile(file, `#!/usr/bin/env node\n${FAKE.trim()
    .replace('__LOG__', JSON.stringify(log))
    .replace('__CONFIG__', JSON.stringify(config))}\n`);
  await chmod(file, 0o755);

  const calls = async () => {
    try {
      return (await readFile(log, 'utf8')).split('\n').filter((line) => line !== '').map((line) => JSON.parse(line));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  };
  const isCheck = (args) => args[0] === '--version' || args.includes('--list-models');
  return {
    cli: file,
    calls,
    launches: async () => (await calls()).filter((call) => !isCheck(call.args)),
    async searches() {
      return (await calls())
        .filter((call) => call.args.includes('--list-models'))
        .map((call) => {
          const next = call.args[call.args.indexOf('--list-models') + 1];
          return next !== undefined && !next.startsWith('-') ? next : undefined;
        });
    },
    async set(changes) {
      Object.assign(state, changes);
      await writeFile(config, `${JSON.stringify(state)}\n`);
    },
  };
}

/**
 * An environment for `box` in which no `pi` can be found on PATH at all: the
 * sandbox's own bin, a folder holding only a link to this Node (the fakes and
 * the kit start with `#!/usr/bin/env node`), and the system folders. The
 * machine's own Node folder is left out on purpose: the real `pi` sits beside
 * it (/opt/homebrew/bin).
 */
export async function envWithoutPi(box) {
  const nodeOnly = path.join(box.root, 'node-only');
  await mkdir(nodeOnly, { recursive: true });
  await symlink(process.execPath, path.join(nodeOnly, 'node')).catch((error) => {
    if (error.code !== 'EEXIST') throw error;
  });
  return { ...box.env, PATH: [path.join(box.root, 'bin'), nodeOnly, '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(path.delimiter) };
}

/** Pi's session folder for a working folder, under `home` (the user's HOME, not the bot home). */
export async function piSessionDir(home, cwd) {
  const real = await realpath(cwd);
  return path.join(home, '.pi', 'agent', 'sessions', `--${real.replace(/^\//, '').replaceAll(/[/\\:]/g, '-')}--`);
}

/** A time as Pi writes it in a session file's name: 2026-10-16T18-42-43-786Z. */
export const piStamp = (at) => at.toISOString().replaceAll(/[:.]/g, '-');

/** Pi's lines for a session, each a JSON object. */
export const piLines = {
  header: (id, cwd, at) => ({ type: 'session', version: 3, id, timestamp: at.toISOString(), cwd }),
  message: (role, content, at, n = 1) => ({
    type: 'message',
    id: `m${n}`,
    parentId: n === 1 ? null : `m${n - 1}`,
    timestamp: at.toISOString(),
    message: { role, content, timestamp: at.getTime() },
  }),
  /** A user turn, its text as Pi's text blocks. */
  user: (text, at, n) => piLines.message('user', [{ type: 'text', text }], at, n),
  /** A user turn whose content is a plain string, which Pi may also write. */
  userString: (text, at, n) => piLines.message('user', text, at, n),
  assistant: (text, at, n) => piLines.message('assistant', [{ type: 'text', text }], at, n),
  system: (text, at, n) => piLines.message('system', [{ type: 'text', text }], at, n),
  sessionInfo: (name, at) => ({ type: 'session_info', name, timestamp: at.toISOString() }),
  modelChange: (at) => ({ type: 'model_change', provider: 'anthropic', modelId: 'claude-opus-5-5', timestamp: at.toISOString() }),
};

/**
 * Leave a Pi session on record, as Pi does after the first turn: the file for
 * `id` in the session folder of `cwd`, under `home`, begun at `at`, its header
 * first and then `lines` (built with `piLines`). Its modified time is `at`
 * too. Returns the file's path.
 */
export async function piSessionOnRecord({ home, cwd, id, at = new Date(), lines = [] }) {
  const dir = await piSessionDir(home, cwd);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${piStamp(at)}_${id}.jsonl`);
  const real = await realpath(cwd);
  await writeFile(file, `${[piLines.header(id, real, at), ...lines].map((line) => JSON.stringify(line)).join('\n')}\n`);
  await utimes(file, at, at);
  return file;
}

/** Add lines to a Pi session file, as Pi does turn by turn. */
export const appendPiLines = (file, lines) => appendFile(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);

/** Where the `yaml` package is, for a script the fake Orca runs outside the repo. */
export const yamlEntry = createRequire(import.meta.url).resolve('yaml');
