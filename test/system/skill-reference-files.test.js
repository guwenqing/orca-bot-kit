// A system test, and the live check for #802: a session of each harness the
// kit serves (Claude Code, Codex, Pi) can open a reference file of a kit skill
// from the skill's body. It runs against the real harnesses in the real Orca on
// this machine. Run it alone with
// `npm run test:system -- --yes test/system/skill-reference-files.test.js`;
// `npm test` cannot, and no CI machine could.
//
// The requirement (#802): the kit moves detail out of two skill bodies into
// reference files beside SKILL.md, which the body links to. One of them is
// obk-arch's default format for a decision record (an ADR): after the change it
// is only in `skills/obk-arch/decision-records.md`, which obk-arch's SKILL.md
// links to as `[decision-records.md](decision-records.md)`, and its first line
// is exactly `# ADR NNNN: <the decision, as a short phrase>`. This is text
// written for a model, and the requirement is how the model behaves, so a
// representative use is the whole check (obk-tdd, "Away from code").
//
// One throwaway bots folder, and in it one bot on each harness: `arch-claude`,
// `arch-codex` and `arch-pi`. Each has the kit skill `kit:obk-arch` from this
// checkout in its skills list, linked by `obk skills build`, and one session,
// `daily`, which `obk up` brings up. Each harness is its own subtest, so a run
// names the harness that could not open the file. In each subtest:
//
//   1. The session's start turn answers a ready word, and its tab is idle at
//      its plain input prompt.
//   2. The test types one line into the session's own tab. The line names the
//      obk-arch skill and the question (the first line of the default format
//      for a decision record), and asks for a done word. It names no file.
//   3. The turn is over: the done word is in the session's reply, or the tab
//      sat idle with its record unchanged for SETTLED_MS.
//   4. ASSERTED, from the harness's own record of the conversation, found by
//      the id the book holds, read only:
//        a. a tool call after the line reads a path that ends in
//           `obk-arch/decision-records.md`, in one of the three places a link
//           can take it: the bot's own `.claude/skills`, the bot's own
//           `.agents/skills`, or this checkout's `skills/`, and the call's
//           result is not an error and holds the file's first line. So a
//           call that only checks the file is there (`ls`, `test -f`,
//           `stat`, `Path.exists()`) does not count: it shows none of the
//           file (the review of #838). Which place is printed.
//        b. the session's reply after the line holds the first line above.
//      A model's account that it read the file does not count: only the
//      record of the call does.
//
// How each record is read. Each is the harness's own file of the conversation:
//
//   - Claude Code: the transcript `<config>/projects/<slug>/<id>.jsonl`, where
//     `<config>` is ~/.claude or an Orca profile's `home`
//     (`<Orca data>/claude-profiles/<name>/home`, as restart-line.test.js
//     looks). A read is an `assistant` line's `tool_use` block: `Read` with
//     `input.file_path`, or `Bash` with `input.command`. Its result is the
//     `tool_result` block with that `tool_use_id`, failed when `is_error`.
//     The reply is the `text` blocks of the `assistant` lines.
//   - Codex: the rollout `~/.codex/sessions/…/rollout-…-<id>.jsonl`. A read is
//     a `response_item` that is a `function_call` (its `arguments`) or a
//     `custom_tool_call` (its `input`, the script it ran), the two shapes the
//     tests beside this one read (codex-sandbox-writes.test.js,
//     restart-mail-work.test.js). Its result is the `…_output` item with that
//     `call_id`. The reply is the `output_text` blocks of `message` items with
//     `role: "assistant"`.
//   - Pi: the session file `~/.pi/agent/sessions/--<folder>--/<stamp>_<id>.jsonl`
//     (tech notes, section 6). A read is a `toolCall` block in an assistant
//     message: `read` with `arguments.path`, or `bash` with
//     `arguments.command` (Pi 1.3.0's `docs/message-types.md` and
//     `dist/core/tools/read.js`). Its result is the `toolResult` message with
//     that `toolCallId`, failed when `isError`. The reply is the `text` blocks
//     of the assistant messages.
//
// The reading is test/helpers/reference-reads.js, run on fixtures by
// test/reference-reads.test.js. A path a call names is taken relative to the
// folder the call names (`workdir` on Codex), or to a `cd <folder>` before it
// in the same command, or else to the session's own folder. A read of only
// part of the file that leaves out its first line does not count either.
//
// What it cannot show:
//
//   - Every reference file. One file of one skill is asked for.
//   - Why the model opened the file. The body's link is the road this change
//     makes, but a model could find the file another way, by listing the
//     skill's folder. Either way it opened the file from the skill, which is
//     the requirement; the calls, printed, say how.
//   - A read by a road this test does not know: a tool other than the ones
//     named above, or a path made in a shell variable. Such a read fails the
//     test, and the calls printed in the failure show it.
//   - Today's tree: there `decision-records.md` does not exist and SKILL.md
//     holds the format itself, so step 4a fails, with no read of that path, and
//     step 4b may pass from SKILL.md alone.
//
// **Nobody answers anything by hand.** The test answers its own tabs'
// first-run screens, as mail-interrupt.test.js does, and only through the
// allowlists: Claude Code's folder trust when it is the plain one or the one
// the kit's default rules bring up (helpers/claude-trust.js `claudeTrustAt`),
// and the captured Teach form with Esc (`onlyTeachFormOf`). The Codex session
// is given its trust at launch (helpers/codex-trust.js), and Pi asks nothing
// with the kit's `--no-approve`. Any other screen (`questionOn`), a permission
// prompt or a harness's update offer included, and Pi's trust screen by its
// title, stops that harness's run at once, with the screen in the message.
// `Bot Father daily` may sit on its own trust screen: nothing waits on it, and
// nothing is typed into it.
//
// **The night gate.** helpers/system.js runs this test only in a run that names
// its file, between midnight and 6 am local time (#689). It reads the gate again
// before each `obk up`, which opens a session's tab (#687).
//
// The machine it runs on is someone's working machine, with their own tabs
// open. So this test, like the ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory,
//     `<tmp>/obk-system-skill-refs-*`;
//   - writes down every terminal and project Orca already had, before it
//     creates anything;
//   - runs this checkout's `src/cli.js` by its full path, never the machine's
//     `obk`;
//   - types only into its own three session tabs: one line each, only at the
//     harness's plain input prompt, and the answers above;
//   - closes only its own tabs, through the tab guard, then deletes its own
//     projects, whatever happened;
//   - removes Pi's session folder of its own Pi bot, and nothing else under
//     ~/.pi;
//   - signals no process.
//
// `orca terminal close --worktree … --all` is never run here, and the helper
// refuses to run it at all. The runner (scripts/test-system.js) backs up
// ~/.claude.json and ~/.codex/config.toml before the run and compares them
// after it.
//
// The models: the cheapest each harness has in the tests beside this one.
// Claude Code on `claude-haiku-5-5` at effort `low` (memory-write.test.js),
// Codex on `gpt-6-sol` at effort `low` (temp-roles.test.js), Pi on
// `openai/gpt-6-luna` at thinking `low` (pi-rules-skills.test.js).
//
// What it cannot clean up, and says so: the Run mailboxes it makes (Orca has
// no `run-delete`), and the harnesses' own records of its conversations
// outside ~/.pi.
//
// It takes about fifteen minutes: three harnesses, one start turn and one
// asked turn each, one after the other.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { claudeTrustAt, trustScreenMet } from '../helpers/claude-trust.js';
import { cliEntry, repoRoot } from '../helpers/cli.js';
import { codexTrustArgs } from '../helpers/codex-trust.js';
import { rolloutFilesOf } from '../helpers/codex-rollout.js';
import { afterTheAsk, callsIn, eventsOf, readsOf, replyIn, tailOf } from '../helpers/reference-reads.js';
import { onlyTeachFormOf, questionOn, waitingOn } from '../helpers/screens.js';
import { autoModeState, sessionRecordFiles } from '../helpers/teach-record.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { RC_OFF, withBotFatherOff } from '../helpers/remote-control-off.js';
import { deleteOwnProject, placesOf, projectsInBots } from '../helpers/own-project.js';
import { atNight, namedThisRun } from '../helpers/night-gate.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/** This file, as the runner names it in OBK_SYSTEM_NAMED. */
const THIS_FILE = fileURLToPath(import.meta.url);

/** The Orca CLI that works for a normal user (tech notes, section 1). */
const ORCA = process.env.OBK_ORCA || '/Applications/Orca.app/Contents/Resources/bin/orca';

/** Orca's own data folder, where its Claude Code profiles are. */
const ORCA_DATA = process.env.OBK_ORCA_DATA || path.join(os.homedir(), 'Library', 'Application Support', 'orca');

/** The harnesses' own records (tech notes, sections 2, 3 and 6). */
const CODEX_SESSIONS = path.join(os.homedir(), '.codex', 'sessions');
const PI_SESSIONS = path.join(os.homedir(), '.pi', 'agent', 'sessions');

/** The title of Pi's project-trust screen (tech notes, section 6), which --no-approve should keep away. */
const PI_TRUST_TITLE = 'Trust project folder?';

/** The title of Claude Code's "Teach auto mode" form (#416), as helpers/screens.js has it. */
const TEACH_TITLE = 'Teach auto mode about your environment?';

/** How long a tab is given to come up, answer its start turn and be idle. */
const READY_MS = 180000;

/** How long a real agent is given to answer the asked line. */
const ANSWER_MS = 300000;

/** How long a tab has to stay idle, its record unchanged, for a turn without the done word to count as over. */
const SETTLED_MS = 10000;

/** How long the tab is given to take a line in before the return that goes after it. */
const KEY_GAP_MS = 1000;

/** The file the change makes, as a path ends, and the first line of the format it holds (#802). */
const REFERENCE = 'decision-records.md';
const REFERENCE_TAIL = `obk-arch/${REFERENCE}`;
const FIRST_LINE = '# ADR NNNN: <the decision, as a short phrase>';

/** The skill, as a bot's skills list names it. */
const SKILL = 'kit:obk-arch';

/**
 * In the start prompt and the asked line only, and asked for in lower case.
 * The ready word counts in any case: only the record's reply events are
 * searched, and the prompt's echo is a user event in all three harnesses
 * (helpers/reference-reads.js). A run of 2026-11-21 had Claude Code answer
 * READY-5316 in upper case.
 */
const READY = 'READY-5316';
const DONE = 'DONE-8042';

/** What every session here is told at its start. */
const startPrompt = [
  "You are a system test's bot and you own nothing.",
  `Reply now with ${READY} in lower case and nothing else, and then wait for the next message.`,
].join(' ');

/** The line typed into each session's tab: the skill and the question, and no file. */
const ASK = [
  'Use your obk-arch skill to answer this.',
  'What is the first line of the default format it gives for a decision record (an ADR)?',
  'Quote that line exactly as the skill writes it, on a line of its own.',
  `Then end your reply with ${DONE} in lower case.`,
].join(' ');

/**
 * The three bots, one on each harness: its name, the folder its harness takes
 * skills from, and the words that add its session. Each `session add` is one
 * array of its own that names its harness: the Claude one by `'--harness',
 * 'claude'` and its RC_OFF, the Codex one by its codexTrustArgs, and the Pi
 * one by `'--harness', 'pi'`. The guards read each array as text and cannot
 * follow a variable (test/repo-guards.test.js for Remote Control, #755;
 * test/system-codex-trust.test.js for Codex's trust, #240).
 */
const HARNESSES = {
  claude: {
    bot: 'arch-claude',
    linked: path.join('.claude', 'skills'),
    sessionAdd: (bots, bot) => ['session', 'add', '--bots', bots, '--bot', bot, '--name', 'daily', '--harness', 'claude', '--model', 'claude-haiku-5-5', '--effort', 'low', `--prompt=${startPrompt}`, ...RC_OFF],
  },
  codex: {
    bot: 'arch-codex',
    linked: path.join('.agents', 'skills'),
    sessionAdd: (bots, bot) => ['session', 'add', '--bots', bots, '--bot', bot, '--name', 'daily', '--model', 'gpt-6-sol', '--effort', 'low', `--prompt=${startPrompt}`, ...codexTrustArgs(bots)],
  },
  pi: {
    bot: 'arch-pi',
    linked: path.join('.agents', 'skills'),
    sessionAdd: (bots, bot) => ['session', 'add', '--bots', bots, '--bot', bot, '--name', 'daily', '--harness', 'pi', '--model', 'openai/gpt-6-luna', '--effort', 'low', `--prompt=${startPrompt}`],
  },
};

const guard = tabGuard(ORCA);
const { orca } = guard;

// ------------------------------------------------------------- Orca and the kit

/**
 * The night gate again, right before a kit command that opens a tab (#687).
 * When the night ended during the run, the test opens nothing more and fails
 * here, naming `step`, which did not run, so the run is not a pass.
 */
function gateStillOpen(step) {
  const now = new Date();
  const named = namedThisRun(THIS_FILE);
  assert.ok(atNight(now) && named, [
    `The night gate closed during this run: it is ${now.toTimeString().slice(0, 5)} local time${named ? '' : ', and this run does not name this file'}.`,
    `So this test opened nothing more: ${step} did not run. This run is not a pass.`,
    `Run it again in a night run, between midnight and 6 am local time: npm run test:system -- --yes test/system/${path.basename(THIS_FILE)}`,
  ].join('\n'));
}

/** Every terminal Orca knows about right now. */
function allTerminals() {
  const answer = orca(['terminal', 'list']);
  assert.equal(answer.ok, true, `orca terminal list failed: ${JSON.stringify(answer.error)}`);
  return answer.result.terminals;
}

/** The terminals in one workspace, by the path they were opened in. */
const terminalsAt = (home) => allTerminals().filter((terminal) => terminal.worktreePath === home);

/** The tabs Orca lists at `home` once it has caught up with what was closed. */
async function terminalsAfterClosing(home, closed, within = 5000) {
  const stop = Date.now() + within;
  let left = terminalsAt(home);
  while (left.some((terminal) => closed.includes(terminal.handle)) && Date.now() < stop) {
    await setTimeout(250);
    left = terminalsAt(home);
  }
  return left;
}

/** Every workspace Orca knows about right now. */
function allSetups() {
  const answer = orca(['project', 'setups']);
  assert.equal(answer.ok, true, `orca project setups failed: ${JSON.stringify(answer.error)}`);
  return answer.result.setups;
}

/** Run this checkout's `obk`, by its full path (#217, #220). */
function obk(args) {
  const done = spawnSync(process.execPath, [cliEntry, ...args], { encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(done.error, undefined, `could not run \`obk\`: ${done.error?.message}`);
  assert.ok(!/worktree/i.test(done.stdout + done.stderr), `obk said "worktree": ${done.stdout}${done.stderr}`);
  return done;
}

/** Run `obk ... --json` and read the answer it printed. A tab it says it opened is this test's own. */
function obkJson(args) {
  const done = obk([...args, '--json']);
  assert.equal(done.status, 0, `obk ${args.join(' ')} failed: ${done.stdout}${done.stderr}`);
  try {
    return guard.openedByKit(JSON.parse(done.stdout));
  } catch {
    return assert.fail(`obk ${args.join(' ')} --json did not print JSON: ${done.stdout}`);
  }
}

/** The entry for one tab in an `obk --json` answer. */
function tabOf(answer, name) {
  const found = (answer.tabs ?? []).filter((entry) => entry.name === name);
  assert.equal(found.length, 1, `one entry should be the ${name} tab, got: ${JSON.stringify(answer.tabs)}`);
  return found[0];
}

/** What the book says about one session right now. */
async function sessionIn(home, name) {
  const book = parse(await readFile(path.join(home, 'sessions.yaml'), 'utf8')) ?? {};
  return book.sessions?.[name] ?? {};
}

/**
 * Keep asking until `look` gives something other than undefined, or the time
 * runs out; `note` says what was seen. `screen` is run before each look: the
 * tab's screens, answered or stopped at.
 */
async function until(what, within, look, note = () => '', screen = async () => {}) {
  const stop = Date.now() + within;
  for (;;) {
    await screen();
    const found = await look();
    if (found !== undefined) return found;
    assert.ok(Date.now() < stop, `gave up waiting for ${what} after ${within}ms.${note()}`);
    await setTimeout(1000);
  }
}

/** The rows the tab is rendering right now, or undefined when Orca rendered none. */
function rowsOf(handle) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  const tail = answer.ok === true && answer.result?.terminal?.source === 'screen' ? answer.result.terminal.tail : undefined;
  return Array.isArray(tail) ? tail.map(String) : undefined;
}

/** What the tab is showing, for the message of a wait that ran out. */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  return `${blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`}\n  orca terminal read --terminal ${handle} --screen\n    ${(rowsOf(handle) ?? ['(unreadable)']).join('\n    ')}`;
}

/** Whether Orca calls the tab idle right now, with nothing to answer on it. */
function idleNow(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  return answer.ok === true && answer.result?.wait?.satisfied === true && answer.result?.wait?.blockedReason === undefined
    && waitingOn(orca, handle) === undefined;
}

/** A row of Claude Code's input box's rules: nothing but `─`, a name set into it aside. */
const CLAUDE_RULE_ROW = /^\s*─{8,}/;

/**
 * Why the tab is not at its harness's plain input prompt, or undefined when it
 * is. Every harness: Orca calls it idle, and the suite's shared look finds no
 * question on it. Claude Code: its lowest `❯` row is the input line, between
 * the input box's two rules (skill-reaches-cli.test.js). Codex: it does not say
 * how to interrupt it. Pi: no trust screen.
 */
function notAtPrompt(harness, handle) {
  if (!idleNow(handle)) return 'Orca does not call it idle with nothing to answer';
  const rows = rowsOf(handle);
  if (rows === undefined) return 'its screen could not be read';
  const screen = `\n    ${rows.join('\n    ')}`;
  if (questionOn(rows) !== undefined) return `a question, form or menu is up:${screen}`;
  if (harness === 'claude') {
    const at = rows.findLastIndex((row) => row.trimStart().startsWith('❯'));
    if (at < 0) return `no input line is on it:${screen}`;
    if (!CLAUDE_RULE_ROW.test(rows[at - 1] ?? '') || !CLAUDE_RULE_ROW.test(rows[at + 1] ?? '')) {
      return `its lowest ❯ row is not the input line between the input box's rules:${screen}`;
    }
  }
  if (harness === 'codex' && rows.some((row) => /esc to interrupt/i.test(row))) return `Codex is at work:${screen}`;
  if (harness === 'pi' && rows.some((row) => row.includes(PI_TRUST_TITLE))) return `Pi's trust screen is up:${screen}`;
  return undefined;
}

/**
 * Type one line into the test's own tab, only at the harness's plain input
 * prompt, or fail having typed nothing: the line, then a return as a send of
 * its own (session-harness-change.test.js: on Codex a return inside the text
 * lands in the draft).
 */
async function typeLine(harness, handle, text) {
  const why = notAtPrompt(harness, handle);
  assert.equal(why, undefined, `this test would type ${JSON.stringify(text)} into ${handle}, but ${why}\n  Nothing was typed.`);
  for (const keys of [text, '\r']) {
    const sent = orca(['terminal', 'send', '--terminal', handle, '--text', keys]);
    assert.equal(sent.ok, true, `typing ${JSON.stringify(keys)} into ${handle} failed: ${JSON.stringify(sent.error)}.${whatIsUp(handle)}`);
    await setTimeout(KEY_GAP_MS);
  }
}

// ------------------------------------------------------------- first-run screens

/** The bot folders whose Claude folder trust this test answered, and the tabs whose Teach form it answered. */
const answered = { trust: new Set(), teach: new Set() };

/**
 * One look at a tab's screen. Claude Code's folder trust of `home` is answered
 * once, the captured Teach form at most once with Esc, both only on a Claude
 * tab and only when the suite's allowlist takes them. Pi's trust screen, and
 * any other question, stops the run with the screen in the message.
 */
async function lookAtScreen(t, { harness, title, handle, home, bots }) {
  const rows = rowsOf(handle);
  if (rows === undefined) return;

  assert.ok(!rows.some((row) => row.includes(PI_TRUST_TITLE)), `${title} shows Pi's project-trust screen, which the kit's --no-approve should keep away; this test answers nothing, and the run stops here:\n    ${rows.join('\n    ')}`);

  if (harness === 'claude' && rows.some((row) => row.includes('Yes, I trust this folder'))) {
    assert.ok(!answered.trust.has(home), `${title} asked Claude Code's folder trust for ${home} again, which this test answered once and answers no more:\n    ${rows.join('\n    ')}`);
    const wrong = claudeTrustAt(rows, home, bots, cliEntry);
    assert.equal(wrong, undefined, `${title}'s folder trust (${trustScreenMet(rows)}) is not one this test may answer, so it answered nothing: ${wrong}.\n  what it showed:\n    ${rows.join('\n    ')}`);
    const sent = orca(['terminal', 'send', '--terminal', handle, '--text', '\x1b[B\r']);
    assert.equal(sent.ok, true, `answering ${title}'s folder trust failed: ${JSON.stringify(sent.error)}`);
    answered.trust.add(home);
    await until(`${title}'s folder trust to go after it was answered`, 15000, async () => ((rowsOf(handle) ?? []).some((row) => row.includes('Yes, I trust this folder')) ? undefined : true), () => whatIsUp(handle));
    t.diagnostic(`answered ${title}'s ${trustScreenMet(rows)}`);
    return;
  }

  if (harness === 'claude' && rows.some((row) => row.trim() === TEACH_TITLE)) {
    assert.ok(!answered.teach.has(handle), `the Teach form came up again in ${title}, and this test answers it at most once:\n    ${rows.join('\n    ')}`);
    const wrong = onlyTeachFormOf(rows);
    assert.equal(wrong, undefined, `${title}'s Teach form is not the captured one, so this test answered nothing: ${wrong}.\n  what it showed:\n    ${rows.join('\n    ')}`);
    const found = sessionRecordFiles(home);
    assert.ok(found.files !== undefined, `this test cannot tell which record ${title}'s session writes, so it answered nothing: ${found.why}`);
    const { files } = found;
    const was = autoModeState(files);
    const sent = orca(['terminal', 'send', '--terminal', handle, '--text', '\x1b']);
    assert.equal(sent.ok, true, `answering ${title}'s Teach form with Esc failed: ${JSON.stringify(sent.error)}`);
    answered.teach.add(handle);
    await until(`${title}'s Teach form to go after Esc`, 15000, async () => ((rowsOf(handle) ?? []).some((row) => row.trim() === TEACH_TITLE) ? undefined : true), () => whatIsUp(handle));
    await setTimeout(2000);
    const now = autoModeState(files);
    assert.equal(now, was, `Esc on ${title}'s Teach form taught nothing: autoModeEnvSetup should be as it was in each record the session may write (before: ${was}; after: ${now})`);
    t.diagnostic(`answered ${title}'s Teach form with Esc; it went, and autoModeEnvSetup stayed as it was: ${was}`);
    return;
  }

  const question = questionOn(rows);
  assert.equal(question, undefined, `${title} shows a screen this test does not know, and it answers nothing; the run stops here:\n    ${rows.join('\n    ')}`);
}

// ------------------------------------------------------------- the records

/** The whole lines of a JSONL file, as JSON; a line being written, or not JSON, is left out. */
function entriesOf(file) {
  if (file === undefined) return [];
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  return text.split('\n').flatMap((raw) => {
    try {
      return raw.trim() === '' ? [] : [JSON.parse(raw)];
    } catch {
      return [];
    }
  });
}

/** The slug Claude Code names a folder's transcripts by: the folder in NFC, each character that is not an ASCII letter or digit changed to `-`. */
const slugOf = (folder) => folder.normalize('NFC').replaceAll(/[^A-Za-z0-9]/g, '-');

/**
 * Claude Code's transcript of the conversation `id` that ran in `home`, or
 * undefined before there is one: under ~/.claude, or under one of Orca's
 * Claude Code profiles. Read only.
 */
function claudeRecordOf(home, id) {
  const configs = [path.join(os.homedir(), '.claude')];
  try {
    for (const name of readdirSync(path.join(ORCA_DATA, 'claude-profiles')).sort()) configs.push(path.join(ORCA_DATA, 'claude-profiles', name, 'home'));
  } catch {
    // No Orca profiles here: ~/.claude is the only config folder.
  }
  return configs.map((config) => path.join(config, 'projects', slugOf(home), `${id}.jsonl`)).find((file) => existsSync(file));
}

/** Pi's session folder name for a working folder (tech notes, section 6): its real path, `/`, `\` and `:` as `-`. */
const piFolderNameOf = (cwd) => `--${realpathSync(cwd).replace(/^\//, '').replaceAll(/[/\\:]/g, '-')}--`;

/** The Pi session file of the session `id` that ran in `cwd`, or undefined before Pi has written one. */
function piRecordOf(cwd, id) {
  const folder = path.join(PI_SESSIONS, piFolderNameOf(cwd));
  let names = [];
  try {
    names = readdirSync(folder);
  } catch {
    return undefined;
  }
  const found = names.filter((name) => name.endsWith(`_${id}.jsonl`)).sort();
  return found.length === 0 ? undefined : path.join(folder, found.at(-1));
}

/** The harness's own record of the conversation `id` that ran in `home`, or undefined before there is one. */
const recordOf = (harness, home, id) => ({
  claude: () => claudeRecordOf(home, id),
  codex: () => rolloutFilesOf(CODEX_SESSIONS, id)[0],
  pi: () => piRecordOf(home, id),
})[harness]();

/**
 * The places a link can take a read of the reference file to, by name: the
 * bot's own `.claude/skills`, the bot's own `.agents/skills`, and this
 * checkout's `skills/`.
 */
const placesOfReference = (home) => ({
  'the bot\'s own .claude/skills': path.join(home, '.claude', 'skills', REFERENCE_TAIL),
  'the bot\'s own .agents/skills': path.join(home, '.agents', 'skills', REFERENCE_TAIL),
  'this checkout\'s skills/': path.join(repoRoot, 'skills', REFERENCE_TAIL),
});

// ------------------------------------------------------------- one harness

/**
 * One harness's whole check (the header's steps 1 to 4), in its own subtest
 * `t`: its bot made, the skill linked, its session up, the line typed and the
 * record read.
 */
async function checkHarness(t, harness, bots) {
  const setup = HARNESSES[harness];
  const home = path.join(bots, 'bots', setup.bot);

  // The bot, with kit:obk-arch on its skills list, linked for its harness.
  obkJson(['bot', 'create', '--bots', bots, '--name', setup.bot, '--harness', harness, '--charter', `${setup.bot} exists for one system test run and owns nothing.`]);
  const botYaml = path.join(home, 'bot.yaml');
  const withSkill = (await readFile(botYaml, 'utf8')).replace(/^skills: \[\]$/m, `skills:\n  - ${SKILL}`);
  assert.match(withSkill, new RegExp(`- ${SKILL}`), `the premise: ${setup.bot}'s bot.yaml takes the skill`);
  await writeFile(botYaml, withSkill);
  obkJson(['skills', 'build', '--bots', bots, '--bot', setup.bot]);
  assert.ok(existsSync(path.join(home, setup.linked, 'obk-arch', 'SKILL.md')), `the premise: obk-arch is linked in ${setup.bot}'s ${setup.linked}`);
  t.diagnostic(`${setup.bot}'s ${setup.linked}/obk-arch is ${realpathSync(path.join(home, setup.linked, 'obk-arch'))}; ${REFERENCE} ${existsSync(path.join(home, setup.linked, REFERENCE_TAIL)) ? 'is' : 'is not'} there (observed, not judged)`);
  obkJson(setup.sessionAdd(bots, setup.bot));

  // 1. Up, and its start turn answered with the tab idle at its prompt.
  gateStillOpen(`obk up of ${setup.bot}/daily`);
  const entry = tabOf(obkJson(['up', '--bots', bots, '--bot', setup.bot, '--session', 'daily']), 'daily');
  assert.equal(entry.created, true, `the premise: up opened ${setup.bot}'s daily tab`);
  const { title } = entry;
  const handle = entry.terminal;
  const screen = () => lookAtScreen(t, { harness, title, handle, home, bots });
  const id = await until(`${title} to report its conversation in the book`, READY_MS, async () => {
    const found = await sessionIn(home, 'daily');
    return typeof found.session === 'string' ? found.session : undefined;
  }, () => whatIsUp(handle), screen);
  const entries = () => entriesOf(recordOf(harness, home, id));
  await until(`${title}'s start turn to answer ${READY}, in any case,`, READY_MS, async () => (
    eventsOf(harness, entries()).events.some((one) => one.kind === 'reply' && one.text.toLowerCase().includes(READY.toLowerCase())) ? true : undefined
  ), () => `\n  its record (${recordOf(harness, home, id) ?? 'not found'}), last events:\n  ${tailOf(eventsOf(harness, entries()).events)}${whatIsUp(handle)}`, screen);
  await until(`${title} to be at its plain input prompt`, READY_MS, async () => (notAtPrompt(harness, handle) === undefined ? true : undefined), () => ` ${notAtPrompt(harness, handle) ?? ''}${whatIsUp(handle)}`, screen);

  // 2. The line, typed at its plain prompt.
  await typeLine(harness, handle, ASK);

  // 3. The turn is over: the done word in the reply, or idle with the record unchanged.
  let since;
  let count;
  const ended = await until(`${title}'s turn after the asked line to be over`, ANSWER_MS, async () => {
    const now = entries();
    const after = afterTheAsk(eventsOf(harness, now).events, DONE);
    if (after === undefined) return undefined;
    if (replyIn(after).includes(DONE.toLowerCase()) && idleNow(handle)) return 'with the done word';
    if (notAtPrompt(harness, handle) !== undefined) {
      since = undefined;
      return undefined;
    }
    if (since === undefined || now.length !== count) {
      since = Date.now();
      count = now.length;
      return undefined;
    }
    return Date.now() - since >= SETTLED_MS ? `idle at its prompt for ${SETTLED_MS / 1000}s, without the done word` : undefined;
  }, () => `\n  its record's last events:\n  ${tailOf(eventsOf(harness, entries()).events)}${whatIsUp(handle)}`, screen);
  t.diagnostic(`${title}'s turn ended ${ended}`);

  // 4. The harness's own record: a read of the reference file, and the reply.
  const record = recordOf(harness, home, id);
  t.diagnostic(`${title}'s record: ${record}`);
  const { events, cwd } = eventsOf(harness, entriesOf(record));
  const after = afterTheAsk(events, DONE) ?? [];
  const { reads, others } = readsOf(after, { cwd: cwd ?? home, places: placesOfReference(home), name: REFERENCE, holds: FIRST_LINE });
  for (const call of callsIn(after)) t.diagnostic(`${title} called ${call}`);
  for (const { call, file, place } of reads) t.diagnostic(`${title} read ${file}, through ${place}, by ${call.tool}: ${call.named}`);
  for (const { call, file, why } of others) t.diagnostic(`${title} named ${file} by ${call.tool}, which does not count: ${why}`);
  const reply = replyIn(after);
  t.diagnostic(`${title}'s reply after the asked line:\n  ${reply.slice(0, 2000).replaceAll('\n', '\n  ')}`);

  assert.ok(
    reads.length > 0,
    [
      `${title}: no tool call after the asked line read a path that ends in ${REFERENCE_TAIL} in one of ${JSON.stringify(Object.values(placesOfReference(home)))}, with a result that is not an error and holds the file's first line, ${JSON.stringify(FIRST_LINE)} (#802, the harness's own record ${record}).`,
      `  the calls after the line:\n    ${callsIn(after).join('\n    ') || '(none)'}`,
      ...(others.length === 0 ? [] : [`  calls that name ${REFERENCE} and do not count:\n    ${others.map(({ call, file, why }) => `${call.tool} ${file}: ${why}`).join('\n    ')}`]),
    ].join('\n'),
  );
  assert.ok(
    reply.includes(FIRST_LINE),
    `${title}: the reply after the asked line holds the first line of the format, ${JSON.stringify(FIRST_LINE)} (#802). The reply:\n  ${reply.slice(0, 2000).replaceAll('\n', '\n  ')}`,
  );
}

// ------------------------------------------------------------- the test

test('a session of each harness the kit serves opens obk-arch\'s decision-records.md from the skill body, by the harness\'s own record (#802)', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };
  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-skill-refs-')));
  const homeOf = (bot) => path.join(bots, 'bots', bot);
  const homes = ['bot-father', ...Object.values(HARNESSES).map((one) => one.bot)].map(homeOf);
  t.diagnostic(`local time ${new Date().toTimeString().slice(0, 5)}; bots folder ${bots}`);
  t.diagnostic(`this checkout's skills/${REFERENCE_TAIL} ${existsSync(path.join(repoRoot, 'skills', REFERENCE_TAIL)) ? 'exists' : 'does not exist'}; its obk-arch SKILL.md ${readFileSync(path.join(repoRoot, 'skills', 'obk-arch', 'SKILL.md'), 'utf8').includes(`[${REFERENCE}](${REFERENCE})`) ? 'links' : 'does not link'} to it (observed, not judged)`);

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    const { closed, foreign } = guard.closeOwnAt(placesOf(homes, allSetups(), bots));
    const held = new Set(foreign.map((one) => one.home));
    let deleted = 0;
    const failedDeletes = [];
    for (const setup of projectsInBots(allSetups(), bots)) {
      if (before.setups.has(setup.id) || held.has(setup.path)) continue;
      try {
        await deleteOwnProject(setup, bots);
        deleted += 1;
      } catch (error) {
        failedDeletes.push(`${setup.path}: ${error.message}`);
      }
    }
    if (deleted > 0 && !(await reloadWindow())) t.diagnostic(RELOAD_LINE);
    // Pi's session folder of this test's own Pi bot, and nothing else under ~/.pi.
    const piHome = homeOf(HARNESSES.pi.bot);
    if (existsSync(piHome)) {
      const name = piFolderNameOf(piHome);
      const mark = `--${bots.replace(/^\//, '').replaceAll(/[/\\:]/g, '-')}-`;
      if (name.startsWith(mark)) await rm(path.join(PI_SESSIONS, name), { recursive: true, force: true });
      else t.diagnostic(`left ${name} in place: it is not a Pi session folder of ${bots}`);
    }
    assert.deepEqual(foreign, [], `tabs this test did not create are open at its homes, so it closed only its own and left those projects and ${bots} in place`);
    const parent = path.dirname(bots);
    const mine = path.basename(bots);
    for (const name of (await readdir(parent)).filter((one) => one === mine || one.startsWith(`${mine}.`))) {
      await rm(path.join(parent, name), { recursive: true, force: true });
    }
    const { closedNotOurs, goneElsewhere } = guard.verdict(before.handles);
    assert.deepEqual(closedNotOurs, [], 'this test closed tabs it did not create');
    if (goneElsewhere.length > 0) t.diagnostic(`tabs open before this test and closed elsewhere meanwhile: ${goneElsewhere.join(', ')}`);
    for (const home of homes) assert.deepEqual(await terminalsAfterClosing(home, closed), [], `this test left tabs behind in ${home}`);
    assert.deepEqual(failedDeletes, [], 'projects this test could not remove, left in Orca');
  });

  gateStillOpen('obk init');
  obkJson(withBotFatherOff(['init', '--bots', bots, '--harness', 'claude']));

  // Each harness passes or fails on its own, by its own name (A4).
  await t.test('claude: a Claude Code session opens obk-arch/decision-records.md from the skill body, by its transcript', (st) => checkHarness(st, 'claude', bots));
  await t.test('codex: a Codex session opens obk-arch/decision-records.md from the skill body, by its rollout', (st) => checkHarness(st, 'codex', bots));
  await t.test('pi: a Pi session opens obk-arch/decision-records.md from the skill body, by its session file', (st) => checkHarness(st, 'pi', bots));
});
