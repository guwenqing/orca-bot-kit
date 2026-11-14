// Remote Control off for every Claude Code session a live test starts (#755).
//
// Since #755 the kit starts each Claude Code session with Remote Control on,
// unless the session's entry in bot.yaml says `remote_control: off`. A session
// with Remote Control on connects to the claude.ai account of whoever runs the
// test, and leaves an entry in that account's list of sessions. A throwaway
// fleet is not that person's work, so each Claude session in it is set off,
// through the kit's own user setting. Nothing is added to the kit for the
// tests: no option, command or environment variable (core is core, test is
// test).
//
// - RC_OFF: the words that set a Claude session off, for `obk session add` and
//   `obk temp make`. Never on a Codex or Pi session: the kit refuses the
//   setting there.
// - withBotFatherOff(args): `obk init` starts Bot Father at once, so Bot
//   Father's bot.yaml must hold the setting before init runs. Init keeps a
//   bot.yaml that is already there, and writes Bot Father's charter and skills
//   only into a bot.yaml it makes itself (src/init.js). So the folder is seeded
//   first by the kit's own `initBots`, which writes only files and runs
//   `git init`, and the `daily` entry is then given `remote_control: off`.
//   Bot Father gets the same file init would write, plus that one key. Init
//   then finds everything there: its `created` and `completed` are empty.
// - hardRemoteControlOff(home): the kit's off rides only on its own launch
//   line, as `"disableRemoteControl": true` in its `--settings`. A test that
//   starts Claude Code by hand in a bot's folder (a bare `claude`, `claude
//   --resume <id>` to stand in for Orca's cold restore, or a `claude -p` child)
//   does not get that line, and runs on the settings of whoever runs it, which
//   can have Claude Code's own auto-connect on. So before such a start the test
//   writes Claude Code's own hard off, `"disableRemoteControl": true`, into the
//   bot's `.claude/settings.local.json`, which Claude Code reads for a session
//   started in that folder. The kit never writes that file (ADR 0058), so here
//   it belongs to the test. Anything already in it stays.
//
// test/repo-guards.test.js checks that every system test uses these, except
// that test/system/remote-control.test.js adds its own session with Remote
// Control on, because it tests the setting itself.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse, parseDocument } from 'yaml';

import { DAILY_SESSION, initBots } from '../../src/init.js';

/** The words that set a Claude session's Remote Control off: `--remote-control off`. */
export const RC_OFF = Object.freeze(['--remote-control', 'off']);

/**
 * Seed `bots` with Bot Father's daily session set off, and give `args` back as
 * they were. `args` are the words of `obk init --bots <folder> --harness
 * claude`, so a call reads `obkJson(withBotFatherOff(['init', ...]))`.
 */
export function withBotFatherOff(args) {
  const valueOf = (flag) => {
    const at = args.indexOf(flag);
    return at === -1 ? undefined : args[at + 1];
  };
  const bots = valueOf('--bots');
  if (args[0] !== 'init' || typeof bots !== 'string' || valueOf('--harness') !== 'claude') {
    throw new Error(`withBotFatherOff takes the words of \`obk init --bots <folder> --harness claude\`, got: ${JSON.stringify(args)}`);
  }
  seedBotFatherOff(bots);
  return args;
}

/** Seed the bots folder as init would, then set Bot Father's daily session off in its bot.yaml. */
function seedBotFatherOff(bots) {
  const seeded = initBots(bots, 'claude');
  const file = path.join(seeded.bots, 'bots', 'bot-father', 'bot.yaml');
  const source = readFileSync(file, 'utf8');
  const doc = parseDocument(source);
  const daily = doc.get('sessions')?.items?.find((item) => item.get?.('name') === DAILY_SESSION);
  if (daily === undefined) throw new Error(`${file} has no ${DAILY_SESSION} session to set off:\n${source}`);
  daily.set('remote_control', 'off');
  writeFileSync(file, doc.toString({ lineWidth: 0 }));

  // The file says what init wrote, plus the one key, and nothing else.
  const was = parse(source);
  const text = readFileSync(file, 'utf8');
  assert.deepEqual(
    parse(text),
    { ...was, sessions: was.sessions.map((one) => (one.name === DAILY_SESSION ? { ...one, remote_control: 'off' } : one)) },
    `${file} should be init's own bot.yaml with remote_control: off on ${DAILY_SESSION}, and is:\n${text}`,
  );
}

/**
 * Write Claude Code's own hard off for Remote Control, `"disableRemoteControl":
 * true`, into `<home>/.claude/settings.local.json`, before a test starts Claude
 * Code in `home` without the kit's launch line. A file already there is kept:
 * the key is merged into it, and a file that is not a JSON object is refused
 * rather than written over. Gives back the file's path.
 */
export function hardRemoteControlOff(home) {
  const file = path.join(home, '.claude', 'settings.local.json');
  const source = existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  let was = {};
  if (source !== undefined) {
    try {
      was = JSON.parse(source);
    } catch (error) {
      throw new Error(`${file} is not JSON, so Remote Control's hard off is not written into it (${error.message}):\n${source}`);
    }
    if (was === null || typeof was !== 'object' || Array.isArray(was)) {
      throw new Error(`${file} does not hold a JSON object, so Remote Control's hard off is not written into it:\n${source}`);
    }
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...was, disableRemoteControl: true }, null, 2)}\n`);

  // The file says what it said before, plus the one key, and nothing else.
  const text = readFileSync(file, 'utf8');
  assert.deepEqual(JSON.parse(text), { ...was, disableRemoteControl: true }, `${file} should hold what it held before with "disableRemoteControl": true, and is:\n${text}`);
  return file;
}
