// How Codex records the hooks it trusts, for the tests of the kit's check that
// a hooks review covers only the kit's own hooks (#506, point 6 of the brief).
//
// Read in the Codex 0.162.0 source and checked against real entries (the
// brief): in `$CODEX_HOME/config.toml`, else `~/.codex/config.toml`, one table
// per trusted hook,
//
//   [hooks.state."<hooks.json absolute path>:<event>:<group>:<handler>"]
//   trusted_hash = "sha256:<hex>"
//
// `<event>` is snake_case (`session_start`, `post_tool_use`, `stop`), `<group>`
// the 0-based index of the matcher group in that event's array in the file,
// and `<handler>` the 0-based index in that group's `hooks` array. The hash is
// SHA-256, lowercase hex, of the JSON, every object's keys sorted and no
// spaces, of
//
//   {"event_name": <snake event>, "matcher": <the group's matcher, left out
//    when it has none, and always for stop>, "hooks": [{"type": "command",
//    "command": <the command>, "timeout": <timeout>, "async": <true|false,
//    always there>}]}
//
// A hook with no entry is new; one with another hash is changed. Everything
// here is worked out from that description, never from the kit's own code;
// codex-hooks-only-the-kits.test.js checks `trustedHash` against the one real
// entry the brief gives.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Codex's snake_case name for each event the kit's hooks sit under. */
const SNAKE = { SessionStart: 'session_start', PostToolUse: 'post_tool_use', Stop: 'stop' };

/** A value as JSON with every object's keys sorted, at every depth, and no spaces. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * The `trusted_hash` Codex writes for one hook: `event` as hooks.json names it
 * (`SessionStart`, …), the group's `matcher` or undefined, and the hook's
 * `command`, `timeout` and `async`.
 */
export function trustedHash({ event, matcher, command, timeout, async = false }) {
  const snake = SNAKE[event] ?? event;
  const identity = {
    event_name: snake,
    ...(matcher === undefined || snake === 'stop' ? {} : { matcher }),
    hooks: [{ type: 'command', command, timeout, async: async === true }],
  };
  return `sha256:${createHash('sha256').update(canonicalJson(identity)).digest('hex')}`;
}

/** The `hooks.state` key Codex trusts one hook under. */
export const stateKey = (file, event, group, handler) => `${file}:${SNAKE[event] ?? event}:${group}:${handler}`;

/** A bot's Codex hooks file, inside its bot home. */
export const codexHooksFileOf = (bots, bot) => path.join(bots, 'bots', bot, '.codex', 'hooks.json');

/**
 * Every hook in a bot's `.codex/hooks.json`, in the file's order: its event,
 * its group's matcher, its command, timeout and async, the key Codex trusts it
 * under and the hash it trusts it at.
 * `bots` is the bots folder's real path, as the sandbox's already is.
 */
export async function codexHooksOf(bots, bot) {
  const file = codexHooksFileOf(bots, bot);
  const parsed = JSON.parse(await readFile(file, 'utf8'));
  const found = [];
  for (const [event, groups] of Object.entries(parsed.hooks ?? {})) {
    groups.forEach((group, at) => {
      (group.hooks ?? []).forEach((hook, handler) => {
        found.push({
          event,
          matcher: group.matcher,
          command: hook.command,
          timeout: hook.timeout,
          async: hook.async,
          key: stateKey(file, event, at, handler),
          hash: trustedHash({ event, matcher: group.matcher, command: hook.command, timeout: hook.timeout, async: hook.async }),
        });
      });
    });
  }
  return found;
}

/** A TOML basic string: the same escapes JSON uses, which TOML reads alike. */
const tomlString = (text) => JSON.stringify(text);

/** config.toml tables trusting each `{ key, hash }`, written as Codex writes them. */
export const trustTablesFor = (entries) => entries
  .map(({ key, hash }) => `[hooks.state.${tomlString(key)}]\ntrusted_hash = ${tomlString(hash)}\n`)
  .join('\n');

/**
 * A TOML basic string of `text` with TOML's Unicode escapes in it: each `/` as
 * `/` and each `:` as `\U0000003a`. Any TOML reader decodes it to `text`,
 * so to Codex it is the same key as `tomlString(text)`.
 */
export const escapedTomlString = (text) => tomlString(text)
  .replaceAll('/', '\\u002F')
  .replaceAll(':', '\\U0000003a');

/** As `trustTablesFor`, with each key written by `escapedTomlString`. */
export const escapedTrustTablesFor = (entries) => entries
  .map(({ key, hash }) => `[hooks.state.${escapedTomlString(key)}]\ntrusted_hash = ${tomlString(hash)}\n`)
  .join('\n');

/** Write `text` as the config.toml in Codex's folder `dir`: `<home>/.codex`, or what CODEX_HOME names. */
export async function writeCodexConfig(dir, text) {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'config.toml'), text);
}

/**
 * An environment with no CODEX_HOME: the sandbox starts from the test
 * process's own, and one set there would point the kit at a real Codex folder
 * instead of the sandbox home's `.codex`.
 */
export const withoutCodexHome = (env) => Object.fromEntries(Object.entries(env).filter(([name]) => name !== 'CODEX_HOME'));
