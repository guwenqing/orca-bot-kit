// Claude Code's registry of live sessions, in a sandbox (#700).
//
// Claude Code's SendMessage reaches only a session listed in the sender's own
// registry: the folder `sessions` in the sender's Claude config dir, which is
// `$CLAUDE_CONFIG_DIR` when that is set and not empty, and `$HOME/.claude`
// otherwise. Each live session has one file there, `<pid>.json`, for example
// (seen live, Claude Code 2.1.310, 2026-10-25, #700):
//
//   { "pid": 65837, "sessionId": "…", "cwd": "…", "name": "kit-dev.developer-700.9nuifipk",
//     "messagingSocketPath": "/tmp/cc-socks/65837.sock", "status": "busy", … }
//
// and beside it a `<pid>.<hex>.key` file, which is not JSON and which the kit
// ignores. Orca starts some Claude tabs with CLAUDE_CONFIG_DIR set to a
// profile folder of its own, so two sessions can sit in two registries, and
// then the native road between them does not exist (#700).
//
// So `obk message to` names the native road only for a receiver whose address
// is the `name` of an entry there whose `pid` is live: one the kit's read of
// one process, `ps -o pid=,ppid=,tpgid=,comm= -p <pid>`, answers for. In the
// sandbox that is the fake ps (helpers/fake-ps.js), which knows the pids of the
// fake Orca's tabs alone: a tab's pane is 40000 plus ten times its terminal's
// number, its shell one above, and the harness the shell started two above.
//
// Everything here writes under the sandbox's own HOME, or under a folder the
// test names inside the sandbox, never under the machine's ~/.claude. The
// sandbox starts without the CLAUDE_CONFIG_DIR of whoever runs the suite
// (helpers/cli.js), so the registry a run reads is the sandbox's own.

import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { sessionIn } from './cli.js';
import { panePid } from './fake-ps.js';

/** The Claude config dir a sandboxed run takes when CLAUDE_CONFIG_DIR is not set: `<sandbox home>/.claude`. */
export const defaultConfigDir = (box) => path.join(box.home, '.claude');

/** The registry folder of a Claude config dir: `<config dir>/sessions`. */
export const registryIn = (configDir) => path.join(configDir, 'sessions');

/**
 * The pid of the harness in one session's tab, as the fake ps answers for it:
 * a live process, while the harness is in front of the tab (the fake Orca's
 * default after `up`).
 */
export async function livePidOf(box, bots, bot, session = 'daily') {
  const held = await sessionIn(bots, bot, session);
  const state = await box.orca.state();
  const terminal = (state.terminals ?? []).find((one) => one.tabId === held?.tab);
  assert.ok(terminal, `the premise: ${bot}/${session} has a tab in the fake Orca, got ${JSON.stringify(held)}`);
  return panePid(state, terminal) + 2;
}

/**
 * Write one entry into a Claude registry: `<config dir>/sessions/<pid>.json`,
 * with `name` the address and `pid` the process, as Claude Code writes it, and
 * its `.key` file beside it. `configDir` is the sandbox's `$HOME/.claude` when
 * left out; `file` names the entry's file when it is not `<pid>.json`;
 * `entry` replaces the whole JSON (a test of what the kit ignores). Returns
 * the path of the entry's file.
 */
export async function listInRegistry(box, address, { pid, configDir = defaultConfigDir(box), file, entry } = {}) {
  const dir = registryIn(configDir);
  await mkdir(dir, { recursive: true });
  const written = entry ?? {
    pid,
    sessionId: '0199b2c0-0318-4444-8888-aaaaaaaaaaaa',
    cwd: box.cwd,
    startedAt: Date.UTC(2026, 9, 25, 14, 50, 0),
    kind: 'interactive',
    name: address,
    messagingSocketPath: `/tmp/cc-socks/${pid}.sock`,
    status: 'busy',
  };
  const at = path.join(dir, file ?? `${pid}.json`);
  await writeFile(at, typeof written === 'string' ? written : `${JSON.stringify(written)}\n`);
  if (file === undefined && Number.isInteger(pid)) await writeFile(path.join(dir, `${pid}.3f9a1c2b.key`), 'not-json-key-material\n');
  return at;
}

/**
 * List one session of the fleet in a registry, as Claude Code lists a live
 * session: its address from its book, its harness's pid from its tab. The
 * same options as `listInRegistry`. Returns `{ address, pid, file }`.
 */
export async function listSession(box, bots, bot, session = 'daily', options = {}) {
  const held = await sessionIn(bots, bot, session);
  assert.equal(typeof held?.address, 'string', `the premise: ${bot}/${session} has an address in its book, got ${JSON.stringify(held)}`);
  const pid = options.pid ?? await livePidOf(box, bots, bot, session);
  const file = await listInRegistry(box, held.address, { ...options, pid });
  return { address: held.address, pid, file };
}
