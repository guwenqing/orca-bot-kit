// The kit's Pi extension: what a Claude Code or Codex session's SessionStart
// hook does, for a Pi session (#662).
//
// Pi has no hooks; it has extensions. Every Pi launch line names this file with
// `--extension`, and Pi loads it even with `--no-approve`. At each session_start,
// a `/new` in the tab included, it runs the kit's own `session record`, as the
// hooks do (src/hooks.js), and hands Pi the start prompt when the kit answers
// with one. Seen live on Pi 1.3.0 (tech notes, section 6): the extension runs in
// Pi's own process, so the command it starts is Pi's child, as a hook is the
// harness's, and it has Pi's environment, the tab's id included.
//
// It runs inside the user's session, so it stays out of the way: whatever goes
// wrong, it goes wrong quietly, and a book left stale is for the health check
// to find (ADR 0022). It handles no credentials, types into no tab and reaches
// no network.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The CLI beside this file: the kit whose launch line named it (#220). */
const CLI = fileURLToPath(new URL('./cli.js', import.meta.url));

/** How long the kit is given to answer, as the hooks' TIMEOUT gives a harness. */
const WAIT_MS = 10_000;

/** What Pi calls the start prompt the kit hands it. */
const CUSTOM_TYPE = 'obk-start-prompt';

export default function piRecord(pi) {
  pi.on('session_start', async (event, ctx) => {
    try {
      const bot = botAbove(ctx.cwd);
      if (bot === undefined) return;

      const said = { session_id: ctx.sessionManager.getSessionId(), source: event.reason, hook_event_name: event.type };
      const duty = (await record(bot, said))?.hookSpecificOutput?.additionalContext;
      // Into the conversation for its next turn, as Claude Code's
      // additionalContext is: no turn is started for it.
      if (typeof duty === 'string' && duty !== '') pi.sendMessage({ customType: CUSTOM_TYPE, content: duty, display: true });
    } catch {
      // Nothing: see above.
    }
  });
}

/**
 * The bot whose home is `cwd` or the nearest folder above it, as
 * `{ bots, bot }`, or undefined. A bot lives at `<bots>/bots/<bot>` with its
 * `bot.yaml` (botDir in src/bot.js). A kit tab starts at the bot home; a folder
 * below it holds too.
 */
function botAbove(cwd) {
  if (typeof cwd !== 'string' || cwd === '') return undefined;
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    const parent = path.dirname(dir);
    if (path.basename(parent) === 'bots' && existsSync(path.join(dir, 'bot.yaml'))) {
      return { bots: path.dirname(parent), bot: path.basename(dir) };
    }
    if (parent === dir) return undefined;
  }
}

/** The kit's answer to what Pi said, or undefined when it has none or none could be had. */
function record({ bots, bot }, said) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(CLI, ['session', 'record', '--bots', bots, '--bot', bot], {
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: WAIT_MS,
        killSignal: 'SIGKILL',
      });
    } catch {
      resolve(undefined);
      return;
    }
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.on('error', () => resolve(undefined));
    child.on('close', (code) => {
      if (code !== 0) return resolve(undefined);
      try {
        resolve(JSON.parse(out));
      } catch {
        resolve(undefined);
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(said));
  });
}
