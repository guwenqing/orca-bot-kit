// A system test: the daily grooming done by a temporary Codex session at each
// fire of the Claude grooming session's schedule (#238), against the real Orca,
// a real Claude Code and a real Codex on this machine. Run it with
// `npm run test:system -- --yes test/system/codex-groom-run.test.js`; `npm test`
// cannot, and no CI machine could.
//
// **It spends real tokens, and it takes from about ten minutes to a little over
// an hour.** A few short Claude turns (Sonnet, medium) to make the job, fire it
// and handle the run's report, and one grooming run by Codex (gpt-6-sol, low)
// on an empty throwaway fleet, with the real obk-grooming skill. Most of the
// time is Claude Code's own scheduler: the job is set two to three minutes
// ahead, and a recurring job is documented to fire up to thirty minutes after
// its time (tech notes, section 2). Every wait is bounded and says what it was
// waiting for when it runs out; the longest is the one that jitter needs:
//
//   the job made         4 min after --on, and before its own time
//   the fire             up to 32 min after its time: 30 of jitter, 2 to be written down
//   the run made         4 min after the fire
//   past its screens     4 min after the run was made: its maker answers them
//   its report arrives   20 min after the run was made
//   the report read      4 min after it arrived
//   the run retired      4 min after the report was read
//
// What it proves, one part per line of the issue's acceptance:
//
//   1. The Claude session's schedule, set a few minutes ahead with `--run-on
//      codex`, fires once and starts one Codex run: one temporary session
//      named groom-*, made by the grooming session, appears in Bot Father's
//      book.
//   2. The run's rollout records the chosen model and effort: its latest
//      `turn_context` says gpt-6-sol and low. gpt-6-sol, because Codex's own
//      default here is gpt-6-astra (tech notes, section 3: the context window a
//      session with no override gets is gpt-6-astra's), so a launch line that
//      dropped `-m` would show. Only those two fields of the rollout are read
//      (helpers/codex-rollout.js `turnSettingsIn`), never what was said.
//   3. The run's result reaches the Claude session by the kit's mail: the
//      kit's notice, `Fleet mail from bot-father/<the run>`, is a turn of the
//      grooming conversation, and after it that conversation runs the kit's
//      `message check`, which is it reading the mail.
//   4. After the run no temporary session is left: not in bot.yaml, not among
//      the book's sessions, and not in Orca. The book's retired list keeps the
//      run, with the grooming session as its maker.
//   5. The fire renewed its job, in its own turn: after the run is retired
//      `obk groom` lists one job, not the one `--on` made, ending later than
//      it, at the same time and with the same runs (review of PR #439).
//
// It runs the real flow, the job a user would have: `--run-on codex` with no
// `--extra-arg` at all, so no trust given at launch and no sleep flag (a
// grooming task does not tell the run to wait). The architect's ruling on #238:
// trust given at launch, by the bypass or by a precomputed hooks.state hash,
// starts a Codex agent with its trust bypassed, which Claude Code's auto mode
// refused when the grooming session was asked to schedule it (live run 1). So
// the run's Codex shows its folder trust and its hooks review, and the grooming
// session, the run's maker, answers them itself, from the table, as the kit's
// rules tell a maker to (rules/temporary.md, #251) and as the job's prompt says.
// If Claude Code's check refuses the maker that, that is the finding: the test
// fails and says so, with what was refused, rather than answering for it.
//
// The hooks review is answered through the kit's `temp trust-hooks`, not a raw
// `orca terminal send`: auto mode refused the raw send in live run 3, and the
// owner chose to allow the one answer by an explicit permission rule (#238,
// (b)). So the throwaway fleet's Bot Father is given that rule, `Bash(<the kit
// this test runs> temp trust-hooks:*)`, through `obk bot change --allow`, before
// its grooming session comes up, and the test checks that the grooming
// conversation answered the review through that command. This fleet's rule is
// the test's own; the owner's Bot Father gets it only on his yes.
//
// So the run's Codex writes this test's folder into the user's
// ~/.codex/config.toml: a `[projects."…"]` table and a `[hooks.state."…"]` one.
// The runner names keys under an `obk-system-codex-groom-*` folder as this
// test's known writes (#238), as it does codex-first-run-screens' (#240), and
// what to do about them is the owner's. This test prints, as a diagnostic and
// not a failure, which keys the file gained under its own folder and which
// elsewhere; the file is read by those table headers only
// (helpers/codex-trust.js `trustKeysIn`), never written.
//
// Not proved here, and said when it happens: whether the run found the
// obk-grooming skill by name (the architect's ruling (7)). What the run said is
// not read; the report the grooming session was sent is in its own transcript,
// which a person can read after a run.
//
// The machine it runs on is someone's working machine. So this test, like the
// ones beside it: works in a throwaway bots folder under the system temp
// directory; writes down every terminal and workspace Orca already had; runs
// this checkout's `src/cli.js` by its full path, never the machine's `obk`
// (#220); closes only its own tabs, through the tab guard, and deletes its own
// workspace, whatever happened. The run's tab is the kit's, opened for this
// test's fleet by the grooming session's `temp make`; the test counts it as its
// own once the book names it, so the teardown can close it if the run was never
// retired.
//
// Claude Code's transcripts of the throwaway folder are read, never written,
// and stay under `~/.claude/projects` afterwards, as every system test's do;
// the run's rollout stays under `~/.codex/sessions`. Each run also leaves Bot
// Father's orchestration Runs and the run's behind, which Orca offers no way to
// delete; the runner lists them.
//
// **It is attended, a little.** A bot folder nobody has opened before asks
// questions before the harness is running in it, and this test answers none of
// them (PRD 6.5), but two. The person answers only this:
//
//   - Either Claude tab, after a turn: "Teach auto mode about your
//     environment?". Esc cancels it (#416).
//
// The first exception: `Bot Father daily`'s folder trust, which this test
// answers itself. The grooming session sends its report to daily, and a daily
// with no conversation is not among the sessions Claude Code lists: in live run
// 6, with daily's trust unanswered, the grooming session sent its report to the
// nearest listed name instead, the owner's real `bot-father.daily`, whose bare
// name is from before #286 (#450). A test reached outside its space (#220). The
// architect's ruling on #238: the test answers "Yes, I trust this folder" in
// its own throwaway daily tab only, only when the screen is the plain folder
// trust for this test's `bots/bot-father` folder (since #539, pre-approving
// exactly the kit's default rules, read from the folder's own
// .claude/settings.json, as daily comes up before the test's rule is set:
// helpers/claude-trust.js `claudeTrustAt`, #558; the pointer on "No, exit";
// the "Yes" choice there), and at most once. Any other screen gets no answer, and
// the test fails saying what it saw. Then daily has to report its conversation
// and hold an address the kit made for it before the job is scheduled, and at
// the end every message the grooming session sent by Claude Code's own
// messaging since the fire has to have gone to that address and no other.
//
// The second exception: the grooming tab's folder trust, which this test answers
// itself. Bot Father's settings pre-approve the test's trust-hooks rule, set
// above through `obk bot change --allow`, so Claude Code asks for the folder's
// trust again when the grooming session starts, naming that permission (live
// run 4 stopped there). The architect's ruling (a) on #238: the test answers
// "Yes, I trust this folder" in its own throwaway grooming tab only, only
// when the screen's pre-approved permissions are exactly the test's rule, and
// at most once. Since #539 Bot Father's folder also holds the kit's default
// rules, so the architect's ruling on #558 widens that: Bot Father's
// `.claude/settings.json`, read before answering, has to allow exactly the
// kit's default rules for this bots folder and the test's rule; the screen's
// count has to be their number; and each rule it lists has to be one of them,
// whole, or the start of one where the screen cuts it short with "…"
// (helpers/claude-trust.js `claudeTrustAt`). The pointer has to be on "No,
// exit", where it starts, for the table's down-and-return to mean "Yes". Any
// other screen gets no answer, and the test fails saying what it saw.
//
// And not these, which are what the test is about:
//
//   - a permission question in the grooming tab, at the fire or after it: what
//     Claude Code's auto mode lets the grooming session do alone is the point;
//   - the run's Codex screens, its folder trust and its hooks review: its maker
//     answers them. If it does not, the run waits, and the test says so.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry } from '../helpers/cli.js';
import { trustKeysIn } from '../helpers/codex-trust.js';
import { rolloutFilesOf, turnSettingsIn } from '../helpers/codex-rollout.js';
import { waitingOn } from '../helpers/screens.js';
import { claudeTrustAt } from '../helpers/claude-trust.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { deleteOwnProject } from '../helpers/own-project.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/**
 * Remove the throwaway bots folder and everything the kit made beside it:
 * `<bots>.prompts`, `<bots>.locks` and the rest are siblings of it (PRD 6.3).
 */
async function removeBotsFolderAndSiblings(bots) {
  const parent = path.dirname(bots);
  const mine = path.basename(bots);
  const ours = async () => (await readdir(parent)).filter((name) => name === mine || name.startsWith(`${mine}.`));

  for (const name of await ours()) {
    await rm(path.join(parent, name), { recursive: true, force: true });
  }
  assert.deepEqual(await ours(), [], `this test left folders behind in ${parent}`);
}

/** The Orca CLI that works for a normal user (tech notes, section 1). */
const ORCA = process.env.OBK_ORCA || '/Applications/Orca.app/Contents/Resources/bin/orca';

/** The grooming session: the clock and the reader. A full model id, as its transcript records it. */
const MODEL = 'claude-sonnet-5';
const EFFORT = 'medium';

/** The job's runs: a Codex model that is not this machine's default, at an effort that is not Codex's. */
const CODEX_MODEL = 'gpt-6-sol';
const CODEX_EFFORT = 'low';

/** How long a real agent is given to act on one line. */
const ANSWER_MS = 240000;

/** How long a tab is given to be ready for a question: a person may be answering a screen on it. */
const READY_MS = 180000;

/**
 * How long Bot Father daily is given, once its folder trust is answered, to
 * report its conversation: the kit's hook runs as soon as the folder is
 * trusted, so this is short, and a daily not live by then fails the test
 * before anything is scheduled.
 */
const LIVE_MS = 60000;

/** An address the kit made for Bot Father's daily (src/launch.js `addressOf`). */
const DAILY_ADDRESS = /^bot-father\.daily\.[a-z0-9]{8}$/;

/** How long a recurring job may fire late: Claude Code's documentation says up to thirty minutes. */
const JITTER_MS = 30 * 60000;

/** And a little more, for the fired turn to be written down. */
const LATE_MS = 2 * 60000;

/** How long the run is given to groom an empty fleet and send its report. */
const RUN_MS = 20 * 60000;

/** How often the long waits look again. */
const POLL_MS = 5000;

/** What the kit's mail notice from Bot Father's session `name` says (src/message.js). */
const mailFrom = (name) => `Fleet mail from bot-father/${name}`;

/** Every close goes through the guard, which counts it for the check at the end (#246). */
const guard = tabGuard(ORCA);
const { orca } = guard;

/** Every terminal Orca knows about right now. */
function allTerminals() {
  const answer = orca(['terminal', 'list']);
  assert.equal(answer.ok, true, `orca terminal list failed: ${JSON.stringify(answer.error)}`);
  return answer.result.terminals;
}

/** The terminals in one workspace, by the path they were opened in. */
const terminalsAt = (home) => allTerminals().filter((terminal) => terminal.worktreePath === home);

/** The tabs Orca lists at `home` once it has caught up with what was closed (#187). */
async function terminalsAfterClosing(home, closed, within = 5000) {
  const until = Date.now() + within;
  let left = terminalsAt(home);
  while (left.some((terminal) => closed.includes(terminal.handle)) && Date.now() < until) {
    await setTimeout(250);
    left = terminalsAt(home);
  }
  return left;
}

/**
 * A terminal's real tab id. Orca lists a tab whose pane the window has not
 * loaded as orphaned, under `pty:<ptyId>` rather than its id, and a tab the kit
 * opens from inside another session is one (tech notes, section 1); `terminal
 * show` still answers with the real id, as src/orca.js `tabs` asks it. The
 * handle stays the same either way, so once a tab is found it is followed by
 * its handle.
 */
function tabIdOf(terminal) {
  if (terminal.orphaned !== true) return terminal.tabId;
  const answer = orca(['terminal', 'show', '--terminal', terminal.handle]);
  return answer.ok === true ? answer.result?.terminal?.tabId : undefined;
}

/** The terminal Orca has at `home` for the tab id a book holds, orphaned or not; undefined when there is none. */
const terminalOfTab = (home, tabId) => terminalsAt(home).find((one) => tabIdOf(one) === tabId);

/** Every workspace Orca knows about right now. */
function allSetups() {
  const answer = orca(['project', 'setups']);
  assert.equal(answer.ok, true, `orca project setups failed: ${JSON.stringify(answer.error)}`);
  return answer.result.setups;
}

/** Run this checkout's `obk`, by its full path (#217). */
function obk(args) {
  const done = spawnSync(process.execPath, [cliEntry, ...args], { encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(done.error, undefined, `could not run \`obk\`: ${done.error?.message}`);
  assert.ok(!/worktree/i.test(done.stdout + done.stderr), `obk said "worktree": ${done.stdout}${done.stderr}`);
  return done;
}

/** Run `obk ... --json` and read the answer it printed. */
function obkJson(args) {
  const done = obk([...args, '--json']);
  assert.equal(done.status, 0, `obk ${args.join(' ')} failed: ${done.stdout}${done.stderr}`);
  try {
    return JSON.parse(done.stdout);
  } catch {
    assert.fail(`obk ${args.join(' ')} --json did not print JSON: ${done.stdout}`);
  }
}

/** The entry for one tab in an `obk --json` answer. */
function tabOf(answer, name) {
  const found = (answer.tabs ?? []).filter((entry) => entry.name === name);
  assert.equal(found.length, 1, `one entry should be the ${name} tab, got: ${JSON.stringify(answer.tabs)}`);
  return found[0];
}

/** Bot Father's book as it stands. */
const bookOf = (home) => parse(readFileSync(path.join(home, 'sessions.yaml'), 'utf8')) ?? {};

/** What Bot Father's book says about one of its sessions right now. */
const sessionIn = (home, name) => bookOf(home).sessions?.[name] ?? {};

/** The names of Bot Father's sessions in bot.yaml right now. */
const sessionsInBotYaml = (home) => (parse(readFileSync(path.join(home, 'bot.yaml'), 'utf8'))?.sessions ?? []).map((one) => one?.name);

/** The temporary sessions the book holds now: `[name, entry]`. */
const temporaries = (home) => Object.entries(bookOf(home).sessions ?? {}).filter(([, entry]) => entry?.temporary !== undefined);

/** Keep asking until `look` gives something other than undefined, or the time runs out. */
async function until(what, within, look, note = () => '', every = 1000) {
  const stop = Date.now() + within;
  for (;;) {
    const found = await look();
    if (found !== undefined) return found;
    assert.ok(Date.now() < stop, `gave up waiting for ${what} after ${within}ms.${note()}`);
    await setTimeout(every);
  }
}

/** Everything the tab is rendering right now, as one piece of text. */
function screenOf(handle) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  return answer.ok === true ? JSON.stringify(answer.result) : '';
}

/** The rows the tab renders now, or undefined when Orca will not say. */
function rowsOf(handle) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  const tail = answer.ok === true && answer.result?.terminal?.source === 'screen' ? answer.result.terminal.tail : undefined;
  return Array.isArray(tail) ? tail : undefined;
}

/** What the tab is showing, for the message of a wait that ran out. */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  return [
    blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`,
    ' This test answers nothing a tab asks; answer it in Orca and run again.',
    `\n  orca terminal read --terminal ${handle} --screen\n  ${screenOf(handle).slice(0, 2000)}`,
  ].join('');
}

/** Wait until the tab will take a question: a TUI up, and nothing of its own waiting (helpers/screens.js). */
async function readyForAQuestion(handle, within = READY_MS) {
  await until(
    `${handle} to be past the questions of its own`,
    within,
    async () => {
      const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '5000']);
      if (answer.ok !== true) return undefined;
      if (answer.result?.wait?.blockedReason !== undefined) return undefined;
      return waitingOn(orca, handle) === undefined ? true : undefined;
    },
    () => `${waitingOn(orca, handle) ?? ''}${whatIsUp(handle)}`,
  );
}

/** Where Claude Code keeps the conversations it had in one folder (tech notes, section 2). */
const transcriptsOf = (home) => path.join(os.homedir(), '.claude', 'projects', home.replaceAll(/[^A-Za-z0-9]/g, '-'));

/** One conversation's transcript, whole lines only, a JSON object each. */
function linesOf(home, id) {
  if (typeof id !== 'string') return [];
  const file = path.join(transcriptsOf(home), `${id}.jsonl`);
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8');
  const lines = [];
  for (const raw of text.slice(0, text.lastIndexOf('\n') + 1).split('\n')) {
    if (raw.trim() === '') continue;
    try {
      lines.push(JSON.parse(raw));
    } catch {
      // Not a line Claude Code finished writing as JSON; nothing here reads it.
    }
  }
  return lines;
}

/** The grooming conversation the book holds now, and its lines. */
const groomingLines = (home) => linesOf(home, sessionIn(home, 'grooming').session);

/** The lines written at or after a moment. */
const after = (lines, moment) => lines.filter((line) => Date.parse(line.timestamp ?? '') >= moment);

/** The text a line says, where it says it as text. */
function textsOf(line) {
  const content = line.message?.content;
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  return content.filter((item) => item?.type === 'text' && typeof item.text === 'string').map((item) => item.text);
}

const itemsOf = (line, type) => (Array.isArray(line.message?.content) ? line.message.content.filter((item) => item?.type === type) : []);
const toolUses = (line) => (line.type === 'assistant' ? itemsOf(line, 'tool_use') : []);
const toolResults = (line) => (line.type === 'user' ? itemsOf(line, 'tool_result') : []);

/** The grooming jobs a stretch of transcript made: a successful recurring CronCreate under the marker. */
function jobsMadeIn(lines, marker) {
  const calls = new Map();
  for (const line of lines) {
    for (const use of toolUses(line)) if (use.name === 'CronCreate') calls.set(use.id, use.input ?? {});
  }
  const made = [];
  for (const line of lines) {
    for (const result of toolResults(line)) {
      const input = calls.get(result.tool_use_id);
      if (input === undefined || result.is_error === true) continue;
      const answer = line.toolUseResult;
      if (answer === null || typeof answer !== 'object' || typeof answer.id !== 'string') continue;
      if (input.recurring === false || !String(input.prompt ?? '').startsWith(marker)) continue;
      made.push({ id: answer.id, cron: input.cron, made: line.timestamp });
    }
  }
  return made;
}

/**
 * The times the job fired after `since`: a user turn, as text, carrying the
 * marker (seen live for #237: Claude Code hands the job's prompt to the session
 * as a `type: "user"` line). Not a tool's answer, a compaction's summary, or a
 * mail notice.
 */
const firesIn = (lines, marker, since) => lines.filter((line) => line.type === 'user'
  && line.isCompactSummary !== true
  && Date.parse(line.timestamp ?? '') > since
  && textsOf(line).some((text) => text.includes(marker) && !text.includes('Fleet mail from')));

/** The last lines of a stretch of transcript, short, for the message of a wait that ran out. */
function tailOf(lines, count = 15) {
  if (lines.length === 0) return '    (nothing)';
  return lines.slice(-count).map((line) => {
    const said = line.message?.content ?? line.toolUseResult ?? line.attachment ?? '';
    return `    ${line.timestamp ?? '-'}  ${line.type}${line.subtype ? `/${line.subtype}` : ''}  ${JSON.stringify(said).slice(0, 200)}`;
  }).join('\n');
}

/**
 * The last lines of one conversation's transcript as the file has them, of any
 * type and with or without a time of their own (a `file-history-snapshot` or a
 * `queue-operation` line keeps its time inside), each cut short: for the
 * message of a wait that ran out, where what Claude Code wrote last matters
 * whatever it was.
 */
function lastLinesOf(home, id, count = 12) {
  if (typeof id !== 'string') return '    (no conversation in the book)';
  const file = path.join(transcriptsOf(home), `${id}.jsonl`);
  if (!existsSync(file)) return `    (no transcript at ${file})`;
  const raw = readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '');
  if (raw.length === 0) return '    (the transcript is empty)';
  return raw.slice(-count).map((line) => `    ${line.slice(0, 300)}${line.length > 300 ? '…' : ''}`).join('\n');
}

/** What a tab renders now, one row a line, or that Orca would not say. */
function shownIn(handle) {
  const rows = rowsOf(handle);
  return rows === undefined ? '    (Orca did not give its rendered screen)' : rows.map((row) => `    ${row}`).join('\n');
}

/** A time of day as the kit takes it: 24 hours, in this machine's own time. */
const hhmm = (date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

/** Codex's own folder of rollouts, read only. */
const CODEX_SESSIONS = path.join(os.homedir(), '.codex', 'sessions');

/** The user's own Codex config: read by its table headers only, never written. */
const CODEX_CONFIG = path.join(os.homedir(), '.codex', 'config.toml');

/** Its `[projects."…"]` and `[hooks.state."…"]` keys right now; none when there is no file. */
const trustNow = () => trustKeysIn(existsSync(CODEX_CONFIG) ? readFileSync(CODEX_CONFIG, 'utf8') : '');

/** Whether a key names `folder` or a path under it, in either spelling of a macOS temp path. */
function isUnder(key, folder) {
  const bare = folder.replace(/^\/private(?=\/)/, '');
  return [...new Set([folder, bare, `/private${bare}`])].some((one) => key === one || key.startsWith(`${one}/`));
}

/**
 * The tool calls in a stretch of transcript that came back as errors, a
 * refusal by Claude Code's permission check among them, each with what was
 * asked and the answer's words: for the message of a wait that ran out.
 */
function refusedIn(lines) {
  const uses = new Map(lines.flatMap(toolUses).map((use) => [use.id, use]));
  const refused = lines.flatMap((line) => toolResults(line).filter((result) => result.is_error === true).map((result) => {
    const use = uses.get(result.tool_use_id);
    const asked = use === undefined ? '(call not seen)' : `${use.name} ${JSON.stringify(use.input?.command ?? use.input ?? '').slice(0, 300)}`;
    const said = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
    return `    ${line.timestamp ?? '-'}  ${asked}\n      refused or failed: ${String(said).slice(0, 600)}`;
  }));
  return refused.length === 0 ? '\n  no tool call of the grooming session\'s was refused or failed.' : `\n  tool calls of the grooming session\'s that were refused or failed:\n${refused.join('\n')}`;
}

test('a grooming job with --run-on codex starts one Codex run at its fire, on the chosen model and effort, whose report reaches the grooming session, and which is retired', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
    trust: trustNow(),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-codex-groom-')));
  const home = path.join(bots, 'bots', 'bot-father');
  const marker = `obk grooming for ${bots}`;
  const openedBy = (answer) => guard.openedByKit(answer);

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    // What the run's Codex wrote into the user's config: the run's keys are
    // expected under this test's folder, and are the runner's to name (#238).
    // Said, not judged: another session on this machine may write the file
    // while this runs.
    try {
      const now = trustNow();
      for (const kind of ['projects', 'hooks']) {
        const added = now[kind].filter((key) => !before.trust[kind].includes(key));
        const mine = added.filter((key) => isUnder(key, bots));
        const elsewhere = added.filter((key) => !isUnder(key, bots));
        t.diagnostic(`${CODEX_CONFIG} gained ${mine.length} ${kind} key(s) under this test's folder${mine.length === 0 ? '' : `: ${mine.join(', ')}`}`);
        if (elsewhere.length > 0) t.diagnostic(`and ${elsewhere.length} ${kind} key(s) elsewhere, not this test's to answer for: ${elsewhere.join(', ')}`);
      }
    } catch (error) {
      t.diagnostic(`${CODEX_CONFIG} could not be read by its table headers: ${error.message}`);
    }

    const { closed, foreign } = guard.closeOwnAt([home]);
    const held = new Set(foreign.map((one) => one.home));
    let deleted = 0;
    const failedDeletes = [];
    for (const setup of allSetups()) {
      if (setup.path !== home || before.setups.has(setup.id) || held.has(setup.path)) continue;
      try {
        await deleteOwnProject(setup, bots);
        deleted += 1;
      } catch (error) {
        failedDeletes.push(`${setup.path}: ${error.message}`);
      }
    }
    if (deleted > 0 && !(await reloadWindow())) t.diagnostic(RELOAD_LINE);
    assert.deepEqual(foreign, [], `tabs this test did not create are open at its home, so it closed only its own and left that project and ${bots} in place`);
    await removeBotsFolderAndSiblings(bots);

    const { closedNotOurs, goneElsewhere } = guard.verdict(before.handles);
    assert.deepEqual(closedNotOurs, [], 'this test closed tabs it did not create');
    if (goneElsewhere.length > 0) t.diagnostic(`tabs open before this test and closed elsewhere meanwhile: ${goneElsewhere.join(', ')}`);
    assert.deepEqual(await terminalsAfterClosing(home, closed), [], 'this test left tabs behind');
    assert.deepEqual(failedDeletes, [], 'projects this test could not remove, left in Orca');
  });

  // ---------------------------------------------------------------------------
  // The fleet: Bot Father on Claude Code, and its grooming session, added as
  // the obk-grooming skill says, on Claude Code, which holds the schedule.
  const init = openedBy(obkJson(['init', '--bots', bots, '--harness', 'claude']));
  const daily = tabOf(init, 'daily');
  assert.equal(daily.harnessStarted, true, `no claude came up in ${daily.title}: \`orca terminal read --terminal ${daily.terminal} --screen\``);

  // The first screen this test answers itself (see the header): daily's plain
  // folder trust. Daily is where the report goes, and it has to be live, under
  // an address of its own, before anything is scheduled (#450).
  const dailyAsked = await until(
    'Bot Father daily to show Claude Code\'s folder trust, or report its session id',
    READY_MS,
    async () => {
      if (typeof sessionIn(home, 'daily').session === 'string') return { rows: null };
      const rows = rowsOf(daily.terminal);
      return rows !== undefined && rows.some((row) => row.includes('Yes, I trust this folder')) ? { rows } : undefined;
    },
    () => whatIsUp(daily.terminal),
  );
  if (dailyAsked.rows !== null) {
    const wrong = claudeTrustAt(dailyAsked.rows, home, bots, cliEntry);
    assert.equal(
      wrong,
      undefined,
      `Bot Father daily's folder trust is not one this test may answer, so it answered nothing: ${wrong}.`
      + `\n  what it showed:\n    ${dailyAsked.rows.join('\n    ')}`,
    );
    const sent = orca(['terminal', 'send', '--terminal', daily.terminal, '--text', '\x1b[B\r']);
    assert.equal(sent.ok, true, `answering Bot Father daily's folder trust failed: ${JSON.stringify(sent.error)}`);
    t.diagnostic('answered Bot Father daily\'s folder trust (the ruling on #238 after #450, and #558)');
  }
  const dailyEntry = await until(
    'Bot Father daily to report its conversation and hold an address the kit made for it',
    LIVE_MS,
    async () => {
      const entry = sessionIn(home, 'daily');
      return typeof entry.session === 'string' && DAILY_ADDRESS.test(String(entry.address)) ? entry : undefined;
    },
    () => ` The book's entry for daily: ${JSON.stringify(sessionIn(home, 'daily'))}.${whatIsUp(daily.terminal)}`,
    POLL_MS,
  );
  const dailyAddress = dailyEntry.address;

  // The one permission the owner chose to allow (#238, (b)), in this fleet's
  // own Bot Father, before the grooming session starts and reads its settings.
  const trustRule = `Bash(${cliEntry} temp trust-hooks:*)`;
  // #527: permission rules are written by `obk permission allow`, not `bot change --allow`.
  obkJson(['permission', 'allow', '--bots', bots, '--bot', 'bot-father', '--rule', trustRule]);

  obkJson(['session', 'add', '--bots', bots, '--bot', 'bot-father', '--name', 'grooming', '--model', MODEL, '--effort', EFFORT]);
  const opened = tabOf(openedBy(obkJson(['up', '--bots', bots, '--bot', 'bot-father'])), 'grooming');
  assert.equal(opened.created, true, 'up opened a tab for the grooming session');
  assert.equal(opened.harnessStarted, true, `no claude came up in ${opened.title}: \`orca terminal read --terminal ${opened.terminal} --screen\``);
  const handle = opened.terminal;

  // The one screen this test answers itself (see the header): the grooming
  // tab's folder trust, asking only about the kit's default rules and the
  // test's own rule. Until either it shows or the session reports its id,
  // nothing is typed.
  const trustAsked = await until(
    'the grooming tab to show Claude Code\'s folder trust, or its session to report its id',
    READY_MS,
    async () => {
      if (typeof sessionIn(home, 'grooming').session === 'string') return { rows: null };
      const rows = rowsOf(handle);
      return rows !== undefined && rows.some((row) => row.includes('Yes, I trust this folder')) ? { rows } : undefined;
    },
    () => whatIsUp(handle),
  );
  if (trustAsked.rows !== null) {
    const wrong = claudeTrustAt(trustAsked.rows, home, bots, cliEntry, [trustRule]);
    assert.equal(
      wrong,
      undefined,
      `the grooming tab's folder trust is not the one this test may answer, so it answered nothing: ${wrong}.`
      + `\n  what it showed:\n    ${trustAsked.rows.join('\n    ')}`,
    );
    const sent = orca(['terminal', 'send', '--terminal', handle, '--text', '\x1b[B\r']);
    assert.equal(sent.ok, true, `answering the grooming tab's folder trust failed: ${JSON.stringify(sent.error)}`);
    t.diagnostic(`answered the grooming tab's folder trust, which pre-approved only the kit's default rules and ${trustRule} (ruling (a) on #238, and #558)`);
  }

  await until(
    'the grooming session to report its session id',
    READY_MS,
    async () => sessionIn(home, 'grooming').session,
    () => ` Answer Claude Code's folder trust in ${opened.title}.${whatIsUp(handle)}`,
  );
  await readyForAQuestion(handle);

  // ---------------------------------------------------------------------------
  // 1. --on --run-on codex, two to three minutes ahead, in this machine's time.
  const due = new Date(Math.ceil((Date.now() + 2 * 60000) / 60000) * 60000);
  const at = hhmm(due);
  const cron = `${due.getMinutes()} ${due.getHours()} * * *`;
  const onAt = Date.now();
  const on = obkJson([
    'groom', '--bots', bots, '--on', '--at', at,
    '--run-on', 'codex', '--model', CODEX_MODEL, '--effort', CODEX_EFFORT,
  ]).groom;
  assert.equal(on.asked, 'on', `--on types the line that schedules it: ${JSON.stringify(on)}`);

  const made = await until(
    `the grooming session to make its job for ${at}`,
    ANSWER_MS,
    async () => jobsMadeIn(after(groomingLines(home), onAt), marker)[0],
    () => `${refusedIn(after(groomingLines(home), onAt))}\n  its conversation since --on:\n${tailOf(after(groomingLines(home), onAt))}${whatIsUp(handle)}`,
    POLL_MS,
  );
  const madeAt = Date.parse(made.made);
  assert.equal(made.cron, cron, `the job is for ${at}: ${JSON.stringify(made)}`);
  assert.ok(madeAt < due.getTime(), `the job was made at ${made.made}, after its own time ${due.toISOString()}, so it first fires tomorrow; run again`);

  const [listed] = obkJson(['groom', '--bots', bots]).groom.jobs;
  assert.equal(listed?.id, made.id, 'obk groom lists the job Claude Code made');
  assert.deepEqual(listed.run, { harness: 'codex', model: CODEX_MODEL, effort: CODEX_EFFORT }, `and its runs: ${JSON.stringify(listed)}`);

  // The fire. Nothing is typed into the grooming tab from here on.
  const fire = await until(
    `the job to fire, due at ${at} (${due.toISOString()}); Claude Code documents up to ${JITTER_MS / 60000} minutes late`,
    Math.max(0, due.getTime() + JITTER_MS + LATE_MS - Date.now()),
    async () => firesIn(groomingLines(home), marker, madeAt)[0],
    () => ' It fires only while its tab is up and Claude Code is idle in it.'
      + `\n  its conversation since the job was made:\n${tailOf(after(groomingLines(home), madeAt))}${whatIsUp(handle)}`,
    POLL_MS,
  );
  const firedAt = Date.parse(fire.timestamp);
  assert.ok(firedAt >= due.getTime(), `it fired at ${fire.timestamp}, before its time ${due.toISOString()}`);

  // One run, made by the grooming session, in the book with its tab. Its tab is
  // the kit's, for this test's fleet: counted as this test's own from here.
  const [runName, runEntry] = await until(
    'the grooming session to make one groom-* run',
    ANSWER_MS,
    async () => {
      const runs = temporaries(home).filter(([name]) => name.startsWith('groom-'));
      if (runs.length === 0) return undefined;
      assert.equal(runs.length, 1, `one run per fire: ${JSON.stringify(runs)}`);
      const [, entry] = runs[0];
      return typeof entry.tab === 'string' && terminalOfTab(home, entry.tab) !== undefined ? runs[0] : undefined;
    },
    () => ` Temporary sessions in the book: ${JSON.stringify(temporaries(home))}.${refusedIn(after(groomingLines(home), firedAt))}`
      + `\n  the grooming conversation since the fire:\n${tailOf(after(groomingLines(home), firedAt))}${whatIsUp(handle)}`,
    POLL_MS,
  );
  const runTab = terminalOfTab(home, runEntry.tab);
  guard.openedByKit({ tabs: [{ created: true, terminal: runTab.handle }] });
  assert.equal(runEntry.temporary.maker, 'grooming', `the run is the grooming session's: ${JSON.stringify(runEntry)}`);
  assert.equal(firesIn(groomingLines(home), marker, madeAt).length, 1, 'the job fired once');

  // Its Codex starts on its folder trust and its hooks review, and the grooming
  // session, its maker, answers them. The kit's hook runs once both are past,
  // and the book then names the run's conversation.
  const madeRunAt = Date.now();
  await until(
    `the run ${runName}'s Codex to be past its first-run screens, which its maker, the grooming session, is to answer`,
    ANSWER_MS,
    async () => (typeof sessionIn(home, runName).session === 'string' ? true : undefined),
    () => ' This test answers none of them: that the maker does is part of what it checks.'
      + `${refusedIn(after(groomingLines(home), firedAt))}`
      + `\n  the grooming conversation since the fire:\n${tailOf(after(groomingLines(home), firedAt))}`
      + `\n  the run's tab:${whatIsUp(runTab.handle)}`,
    POLL_MS,
  );
  t.diagnostic(`${runName}'s Codex was past its first-run screens ${Math.round((Date.now() - madeRunAt) / 1000)} s after the test saw it made`);

  // And the hooks review was answered through the kit's command, under the
  // rule: a Bash call of `temp trust-hooks` for this run that did not fail.
  const sinceFire = after(groomingLines(home), firedAt);
  const trustCalls = new Map(sinceFire.flatMap(toolUses)
    .filter((use) => use.name === 'Bash' && String(use.input?.command ?? '').includes('temp trust-hooks') && String(use.input?.command ?? '').includes(runName))
    .map((use) => [use.id, use]));
  const trusted = sinceFire.some((line) => toolResults(line).some((result) => trustCalls.has(result.tool_use_id) && result.is_error !== true));
  assert.ok(
    trusted,
    `the grooming session should have answered ${runName}'s hooks review with the kit's temp trust-hooks, allowed by ${trustRule}.`
    + ` Its calls of it since the fire: ${JSON.stringify([...trustCalls.values()].map((use) => use.input?.command))}.`
    + `${refusedIn(sinceFire)}\n  the grooming conversation since the fire:\n${tailOf(sinceFire)}`,
  );

  // 2. What the run ran on, from its rollout's turn_context and nothing else.
  const settings = await until(
    `the run ${runName}'s rollout to record a turn`,
    ANSWER_MS,
    async () => {
      const id = sessionIn(home, runName).session;
      if (typeof id !== 'string') return undefined;
      const turns = rolloutFilesOf(CODEX_SESSIONS, id).flatMap((file) => turnSettingsIn(readFileSync(file, 'utf8')));
      return turns.length === 0 ? undefined : turns.sort((left, right) => left.at - right.at).at(-1);
    },
    () => ` The book's entry for the run: ${JSON.stringify(sessionIn(home, runName))}.${whatIsUp(runTab.handle)}`,
    POLL_MS,
  );
  assert.deepEqual(
    { model: settings.model, effort: settings.effort },
    { model: CODEX_MODEL, effort: CODEX_EFFORT },
    'the run\'s latest turn ran on the job\'s model and effort',
  );

  // 3. Its report, by the kit's mail: the notice in the grooming conversation.
  const notice = await until(
    `the run ${runName} to send its report to the grooming session`,
    RUN_MS,
    async () => after(groomingLines(home), firedAt)
      .find((line) => line.type === 'user' && textsOf(line).some((text) => text.includes(mailFrom(runName)))),
    () => `\n  the grooming conversation since the fire:\n${tailOf(after(groomingLines(home), firedAt))}`
      + `\n  the grooming transcript's last lines, of any type:\n${lastLinesOf(home, sessionIn(home, 'grooming').session)}`
      + `\n  the grooming tab (${handle}) shows:\n${shownIn(handle)}`
      + `\n  the run's tab:${whatIsUp(runTab.handle)}`,
    POLL_MS,
  );
  const noticeAt = Date.parse(notice.timestamp);

  // And read with the kit's check, after the notice.
  await until(
    'the grooming session to read its mail with the kit\'s message check',
    ANSWER_MS,
    async () => {
      const lines = after(groomingLines(home), noticeAt);
      const checks = new Set(lines.flatMap(toolUses)
        .filter((use) => String(use.input?.command ?? '').includes('message check'))
        .map((use) => use.id));
      return lines.some((line) => toolResults(line).some((result) => checks.has(result.tool_use_id) && result.is_error !== true)) ? true : undefined;
    },
    () => `\n  the grooming conversation since the notice:\n${tailOf(after(groomingLines(home), noticeAt))}${whatIsUp(handle)}`,
    POLL_MS,
  );

  // 4. And retired: nothing temporary left in bot.yaml, the book or Orca.
  await until(
    `the grooming session to retire ${runName}`,
    ANSWER_MS,
    async () => (temporaries(home).length === 0
      && !sessionsInBotYaml(home).includes(runName)
      && !terminalsAt(home).some((one) => one.handle === runTab.handle) ? true : undefined),
    () => ` Temporary sessions in the book: ${JSON.stringify(temporaries(home))}; bot.yaml's sessions: ${JSON.stringify(sessionsInBotYaml(home))}.`
      + `\n  the grooming conversation since the notice:\n${tailOf(after(groomingLines(home), noticeAt))}${whatIsUp(handle)}`,
    POLL_MS,
  );
  // Where the report went: every message the grooming session sent by Claude
  // Code's own messaging since the fire went to daily's own address, the one
  // the kit gave it, and to no other session on this machine (#450, #220). A
  // name Claude Code lists may carry a ` [xxxxxx]` after it; the name is what
  // counts.
  const sends = after(groomingLines(home), firedAt).flatMap(toolUses).filter((use) => use.name === 'SendMessage');
  const elsewhere = sends.map((use) => String(use.input?.to ?? '')).filter((to) => to.replace(/\s*\[[^\]]*\]\s*$/, '').trim() !== dailyAddress);
  assert.deepEqual(
    elsewhere,
    [],
    `the grooming session sent by Claude Code's own messaging to somewhere other than this test's daily, ${dailyAddress}: `
    + 'a test reached outside its own fleet (#450, #220)',
  );
  t.diagnostic(`the grooming session's messages since the fire by Claude Code's own messaging: ${sends.length}, all to ${dailyAddress}`);

  const retired = (bookOf(home).retired ?? []).filter((entry) => entry?.name === runName);
  assert.equal(retired.length, 1, `the book's retired list keeps the run: ${JSON.stringify(bookOf(home).retired)}`);
  assert.equal(retired[0].temporary?.maker, 'grooming', `as the grooming session's: ${JSON.stringify(retired[0])}`);
  assert.deepEqual(
    terminalsAt(home).filter((one) => one.handle === runTab.handle || String(one.title ?? '').includes('groom-')),
    [],
    'and no groom-* tab in Orca',
  );

  // 5. Renewed: the fire replaced its job with a new one, in its own turn,
  // right after making the run (review of PR #439, P2-2: a renewal left to the
  // report's turn was never made). One job, not the one --on made, ending later
  // than it, with the same runs. By now it is long made; the wait is for the
  // listing to catch up, and for a fire whose turn was slow.
  const replaced = await until(
    'the fire to renew its job: one job, a new one, ending later than the first',
    Math.max(ANSWER_MS, firedAt + ANSWER_MS - Date.now()),
    async () => {
      const { jobs } = obkJson(['groom', '--bots', bots]).groom;
      return jobs.length === 1 && jobs[0].id !== made.id && Date.parse(jobs[0].expires) > Date.parse(listed.expires) ? jobs[0] : undefined;
    },
    () => ` obk groom lists: ${JSON.stringify(obkJson(['groom', '--bots', bots]).groom.jobs)}; the first was ${made.id}, ending ${listed.expires}.`
      + ` CronCreates since the fire: ${JSON.stringify(jobsMadeIn(after(groomingLines(home), firedAt), marker))}.`
      + `${refusedIn(after(groomingLines(home), firedAt))}\n  the grooming conversation since the fire:\n${tailOf(after(groomingLines(home), firedAt))}`,
    POLL_MS,
  );
  assert.deepEqual(replaced.run, { harness: 'codex', model: CODEX_MODEL, effort: CODEX_EFFORT }, `with the same runs: ${JSON.stringify(replaced)}`);
  assert.equal(replaced.cron, cron, 'at the same time');
});
