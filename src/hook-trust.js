// Which of a Codex bot's hooks Codex does not trust yet, so that the kit
// trusts only its own (#506).
//
// "Trust all and continue" on Codex's hooks review trusts every hook the
// review counts, from every source Codex reads: the user's own files, Orca's
// hooks among them, `-c` flags, plugins, and each `.codex/` folder from the git
// root down (tech notes, section 3). So the kit answers a review only when the
// bot's `.codex/hooks.json` holds the kit's hooks and nothing else, and the
// count on the screen is the number of those that Codex does not trust yet.
//
// Codex keeps its trust in the user's config.toml, one table a hook, keyed by
// the file, the event and the hook's place in it, with a hash of the hook. The
// kit reads only those tables' headers and their `trusted_hash` lines: the
// rest of the file can hold the user's secrets, and nothing of it is kept or
// said. A file it cannot read that way for one of its hooks is one where it
// cannot tell, and it refuses (the architect's ruling on #506).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { hooksFileOf, readSettings, runsThisKit } from './hooks.js';

/** The events whose hooks Codex hashes with no matcher, whatever the group says. */
const NO_MATCHER = new Set(['user_prompt_submit', 'stop', 'interrupt']);

/** A hook's timeout when its entry gives none, in seconds, as Codex takes it. */
const DEFAULT_TIMEOUT = 600;

/**
 * How many of the hooks in the bot at `home`'s `.codex/hooks.json` Codex does
 * not trust yet: `{ untrusted, file }`. It throws, with `nothing` at the end,
 * when the file holds a hook that is not the kit's own as this kit writes it,
 * or when the kit cannot tell whether Codex trusts one.
 */
export function untrustedKitHooks(home, run, nothing) {
  const file = hooksFileOf(home, 'codex');
  const settings = readSettings(file, "the kit's hooks");
  const hooks = settings.hooks ?? {};
  if (hooks === null || typeof hooks !== 'object' || Array.isArray(hooks)) {
    throw new Error(`${run}: ${file} has a hooks entry that is not a mapping of events, so the kit cannot tell which hooks its review covers. ${nothing}`);
  }
  const ours = [];
  const foreign = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      foreign.push(`${event}: ${JSON.stringify(groups)}`);
      continue;
    }
    groups.forEach((group, at) => {
      if (!Array.isArray(group?.hooks)) {
        foreign.push(`${event}: ${JSON.stringify(group)}`);
        return;
      }
      group.hooks.forEach((hook, handler) => {
        if (runsThisKit(hook)) ours.push({ event: snake(event), at, handler, hash: hashOf(snake(event), group.matcher, hook) });
        else foreign.push(`${event}: ${typeof hook?.command === 'string' ? hook.command : JSON.stringify(hook)}`);
      });
    });
  }
  if (foreign.length > 0) {
    throw new Error(`${run}: ${file} holds hooks that are not the kit's own as this kit writes them, and "Trust all and continue" would let them run outside the sandbox: ${foreign.join('; ')}. ${nothing}`);
  }

  // Codex names the file by the path it found it at; the kit knows the bot
  // home by its real path, and looks under both.
  const files = [...new Set([file, realOr(file)])];
  const keysOf = (hook) => files.map((one) => `${one}:${hook.event}:${hook.at}:${hook.handler}`);
  const trusted = trustedHashes(ours.flatMap(keysOf), run, nothing);
  const untrusted = ours.filter((hook) => !keysOf(hook).some((key) => trusted.get(key) === hook.hash)).length;
  return { untrusted, file };
}

/** An event's name as Codex writes it in a key and a hash: `SessionStart` is `session_start`. */
const snake = (event) => event.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

/**
 * The hash Codex trusts a command hook at: SHA-256, in hex, of its event, its
 * group's matcher and the hook as Codex reads it, as JSON with every key
 * sorted (Codex 0.162.0, tech notes, section 3).
 */
function hashOf(event, matcher, hook) {
  const handler = {
    type: 'command',
    command: hook.command,
    timeout: hook.timeout ?? DEFAULT_TIMEOUT,
    async: hook.async === true,
    ...(hook.statusMessage === undefined ? {} : { statusMessage: hook.statusMessage }),
  };
  const identity = {
    event_name: event,
    ...(matcher === undefined || matcher === null || NO_MATCHER.has(event) ? {} : { matcher }),
    hooks: [handler],
  };
  return `sha256:${createHash('sha256').update(sorted(identity)).digest('hex')}`;
}

/** A value as JSON with every object's keys sorted, and no spaces. */
const sorted = (value) => {
  if (Array.isArray(value)) return `[${value.map(sorted).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${sorted(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const realOr = (file) => {
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
};

const HEADER = /^\s*\[\s*hooks\.state\."((?:[^"\\]|\\.)*)"\s*\]\s*(?:#.*)?$/;
const TRUSTED = /^\s*trusted_hash\s*=\s*"(sha256:[0-9a-f]{64})"\s*(?:#.*)?$/;
const ANY_TABLE = /^\s*\[/;

/** The short escapes of a TOML basic string. */
const SHORT = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', e: '\x1b', '"': '"', '\\': '\\' };

/**
 * Text with a TOML basic string's escapes decoded, as Codex reads them: a key
 * written `\u002f` is the key with a `/` in it (the review of PR #517). An
 * escape TOML does not have is left as it is.
 */
const unescaped = (text) => text.replace(/\\(?:u([0-9A-Fa-f]{4})|U([0-9A-Fa-f]{8})|x([0-9A-Fa-f]{2})|(.))/g, (all, u4, u8, x2, one) => {
  const code = u4 ?? u8 ?? x2;
  if (code === undefined) return SHORT[one] ?? all;
  const point = parseInt(code, 16);
  return point <= 0x10ffff ? String.fromCodePoint(point) : all;
});

/**
 * The `trusted_hash` for each of `keys` that has one, by key, from the
 * config.toml the session's Codex uses: `$CODEX_HOME`'s, or else
 * `~/.codex`'s. No file is no trust. A key the file holds in any other form
 * than a `[hooks.state."<key>"]` table with a `trusted_hash` line, or holds
 * twice, is one the kit cannot tell, and it throws.
 */
function trustedHashes(keys, run, nothing) {
  const file = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');
  if (!existsSync(file)) return new Map();
  const wanted = new Set(keys);
  const text = readFileSync(file, 'utf8');
  const cannotTell = (key, how) =>
    new Error(`${run}: ${file} holds Codex's trust for the kit's hook ${key} ${how}, so the kit cannot tell whether Codex trusts it. ${nothing}`);

  const found = new Map();
  const headers = new Set();
  let table;
  for (const line of text.split(/\r?\n/)) {
    const header = HEADER.exec(line);
    if (header !== null) {
      table = unescaped(header[1]);
      if (wanted.has(table)) {
        if (headers.has(table)) throw cannotTell(table, 'twice');
        headers.add(table);
      }
      continue;
    }
    if (ANY_TABLE.test(line)) {
      table = undefined;
      continue;
    }
    const hash = TRUSTED.exec(line);
    if (hash !== null && wanted.has(table)) found.set(table, hash[1]);
  }
  // A key in any other form is one the kit cannot read: as it stands, which
  // a literal string keeps, backslashes and all, or with a basic string's
  // escapes decoded (the review of PR #517).
  const decoded = unescaped(text);
  for (const key of wanted) {
    if (headers.has(key) && !found.has(key)) throw cannotTell(key, 'in a table with no trusted_hash line the kit reads');
    if (!headers.has(key) && (text.includes(key) || decoded.includes(key))) throw cannotTell(key, 'in a form the kit does not read');
  }
  return found;
}
