// A system test: daily grooming on Claude Code's own schedule (#237), against
// the real Orca and a real Claude Code on this machine. Run it with
// `npm run test:system -- --yes`; `npm test` cannot, and no CI machine could.
//
// **It spends real tokens, and it takes from about twenty minutes to a little
// over an hour.** A real grooming run on Sonnet at medium effort, Bot Father's
// management session reading the report it sends, a compaction, and a few short
// turns asking the session what Claude Code has scheduled. Most of the time is
// Claude Code's own scheduler: the job is set a few minutes ahead, and a
// recurring job is documented to fire up to thirty minutes after its time. Every
// wait is bounded and says what it was waiting for when it runs out, and the
// longest of them is the one that jitter needs.
//
// What it proves, one part per line of the issue's acceptance:
//
//   1. Turned on for a time a few minutes ahead, the job fires once, no earlier
//      than its time and no later than the documented jitter, and the run sends
//      one report to Bot Father's `daily` session. The fire is read out of the
//      grooming conversation's own transcript (a user turn carrying the marker,
//      after the job was made); the report out of `daily`'s transcript.
//   2. That run's assistant lines carry the model and effort the grooming session
//      was added with (`message.model`, `effort`). Sonnet, because a `haiku`
//      session given an effort records none (tech notes, section 2), and a full
//      model id, because that is what the transcript records.
//   3. After the run `obk groom` still lists one job, made by the run itself, and
//      its expiry is later than the one it had before the run.
//   4. After `obk restart` of the grooming session the job is still listed, by
//      `obk groom` and by Claude Code itself: the session is asked to call
//      CronList and the answer is read from its transcript. After a `/clear`,
//      what `obk groom` lists and what CronList answers in the new conversation
//      are the same thing: either the job is still there and the kit says so, or
//      it is gone and the kit says grooming is off. Then two resumes of the
//      conversation the `/clear` began, each leaving a new `SessionStart:resume`
//      line and each held to the same agreement: `obk restart`, and a bare
//      `claude --resume <id>` typed into the tab's shell after `/exit`, which is
//      how Orca's own cold restore starts a tab (#318).
//   5. Nothing is scheduled before `--on`: the session is added and brought up,
//      `obk groom` is asked, `--at` on its own is refused, and through all of it
//      the grooming conversation makes no job and `daily` hears nothing.
//   6. Dropped by the owner on 2026-09-25: the Orca automation earlier kits made
//      is not the kit's business any more, so nothing here makes or checks one.
//   7. `obk groom --compact` compacts the grooming conversation (a
//      `compact_boundary` line, tech notes section 2), and afterwards the job is
//      still there, by CronList and by `obk groom`.
//
// The machine it runs on is someone's working machine, with their own tabs and
// perhaps their own automations. So this test, like the ones beside it:
//
//   - works in a throwaway bots folder under the system temp directory;
//   - writes down every terminal, workspace and automation Orca already had,
//     before it creates anything;
//   - runs this checkout's `src/cli.js` by its full path, never the machine's
//     `obk` (#220);
//   - closes its own tabs one by one (`--terminal <handle> --tab`) and deletes
//     its own workspace, whatever happened;
//   - checks afterwards that it closed nothing but its own: every tab it closed
//     is one the kit said it opened for this run, and each `obk restart` closed
//     only the grooming tab the test held. A tab from before that is gone is
//     reported, not failed: other sessions on this machine open and close their
//     own tabs during a run this long;
//   - checks that Orca's automations are as it found them, and that no
//     automation was made in its folder: the kit creates, edits and removes
//     none. One that was made anyway is removed by its id, and the test says so.
//
// `orca terminal close --worktree … --all` is never run here, and the helper
// below refuses to run it at all.
//
// Claude Code's own transcripts of the throwaway folder are read, never written,
// and stay under `~/.claude/projects` afterwards, as every system test's do. Each
// run also leaves Bot Father's two orchestration Runs behind, which Orca offers no
// way to delete; the runner lists them.
//
// **It is attended.** A bot folder nobody has opened before asks questions
// before the harness is running in it, and this test answers none of them —
// answering them is the caller's job and not the kit's (PRD 6.5), which is why
// no test in `test/system/` does it. What to expect on this machine:
//
//   1. `Bot Father daily`: Claude Code's folder-trust list. Its selection starts
//      on `No, exit`, so it takes a down-arrow and then return. Answer it: the
//      report is sent to this session, and a session still on its first screen
//      can be told nothing.
//   2. The grooming tab, the same list: answer it the same way, if it asks.
//   3. Either tab, if Claude Code offers an update: accept it (PRD 6.5).
//   4. `Bot Father ops` is a plain shell. If zsh asks to update itself, `n`.
//
// After that nobody needs to be there: the restart comes up in a folder that is
// already trusted. The keys, measured live and written down in
// `session-identity.test.js`: the folder trust takes `\x1b[B\r`, sent as one
// payload with no `--enter`. Nothing here sends it.
//
// What is read where, and why there. Whether a job fired, what a run ran on, and
// whether a report arrived are facts only the harness's own record holds, so they
// are read from the transcripts: one JSON object per line, under
// `~/.claude/projects/<the folder with everything but letters and digits made a
// dash>/<conversation id>.jsonl`. The conversation is always the one Bot Father's
// book holds for the session now. How a fired job and an arriving message are
// written there was seen in this test's first two live runs (see `firesIn` and
// `reportsIn`). Every wait on either prints the lines it was looking through
// when it runs out.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry } from '../helpers/cli.js';

/**
 * Remove the throwaway bots folder and everything the kit made beside it.
 *
 * `<bots>.prompts` and `<bots>.locks` are **siblings** of the bots folder and
 * not children of it (PRD 6.3), so a teardown that removes `<bots>` alone leaves
 * them on the disk of whoever ran the test. Everything the kit puts beside it is
 * named the same way, so this takes the folder and every `<bots>.*` next to it,
 * and then says so if one is still there.
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

/** How long a real agent is given to act on one line before the test gives up on it. */
const ANSWER_MS = 240000;

/** And how long the kit's hook is given to have written the book once a session is past its screens. */
const HOOK_MS = 60000;

/**
 * How long a tab is given to be ready for a question. A first run has a screen
 * on it and a person answering it, so this waits rather than races.
 */
const READY_MS = 180000;

/**
 * How long a refused command is given to show that it typed nothing. A line
 * typed into a running Claude Code reaches its transcript within seconds (tech
 * notes, section 2: the start prompt was there 4.4 to 7.1 seconds after the
 * launch line, harness start included).
 */
const SETTLE_MS = 15000;

/**
 * How far ahead the job is set. It has to be made before its time comes round,
 * or it first fires tomorrow: the kit's line is answered within `ANSWER_MS` or
 * the test has already failed, and this is more than that.
 */
const LEAD_MS = 5 * 60000;

/**
 * How late a recurring job may fire. Claude Code's documentation says up to
 * thirty minutes; the tool's own description in 2.1.282 says up to a tenth of
 * the period and at most fifteen. The larger is the bound, since both are
 * documented.
 */
const JITTER_MS = 30 * 60000;

/**
 * And how far past that a fire still counts as within it. The scheduler looks
 * for due jobs once a second (docs), so a job given the most jitter fires up to a
 * second after it, and its prompt is written down a moment after that. Seen live
 * on 2026-09-26 (Claude Code 2.1.283): a job due at 04:11:00Z fired at
 * 04:41:01.000Z and its prompt was written at 04:41:01.059Z. Ten seconds is that
 * with room for a busy machine, and still well short of a minute.
 */
const FIRE_SLACK_MS = 10000;

/** And a little more, for the fired turn to be written down after it fired. */
const LATE_MS = 2 * 60000;

/** How long a fired run is given to send its report, renew its job and finish. */
const RUN_MS = 20 * 60000;

/** How long a compaction is given to be written down. */
const COMPACT_MS = 5 * 60000;

/** How often the long waits look again. */
const POLL_MS = 5000;

/** A recurring job's life in Claude Code: seven days from when it was made (the brief; `recurringMaxAgeMs`). */
const WEEK_MS = 604800000;

/**
 * What the grooming session is added with, and what its transcript must then
 * record. A full model id, since that is what `message.model` holds (tech notes,
 * section 2: `sonnet[1m]` recorded `claude-sonnet-5`), and neither is Claude
 * Code's default on this machine, so a launch line that dropped them would show.
 */
const MODEL = 'claude-sonnet-5';
const EFFORT = 'medium';

/** What the kit's nudge says when a message from the grooming session comes by the Orca mailbox (src/message.js). */
const MAIL_FROM_GROOMING = 'Fleet mail from bot-father/grooming';

/** What a message by Claude Code's own messaging arrives wrapped in. */
const CROSS_SESSION = '<cross-session-message';

/** Ask Orca something and read its JSON. Never the blanket close, on any road. */
function orca(args) {
  assert.ok(
    !(args.includes('--all') && args.includes('close')),
    `refusing to run \`orca ${args.join(' ')}\`: it would take away someone else's tabs`,
  );
  const done = spawnSync(ORCA, [...args, '--json'], { encoding: 'utf8' });
  assert.equal(done.error, undefined, `could not run ${ORCA}: ${done.error?.message}`);
  let answer;
  try {
    answer = JSON.parse(done.stdout);
  } catch {
    assert.fail(`orca ${args.join(' ')} did not answer JSON: ${done.stdout}${done.stderr}`);
  }
  return answer;
}

/** Every terminal Orca knows about right now. */
function allTerminals() {
  const answer = orca(['terminal', 'list']);
  assert.equal(answer.ok, true, `orca terminal list failed: ${JSON.stringify(answer.error)}`);
  return answer.result.terminals;
}

/** The terminals in one workspace, by the path they were opened in. */
const terminalsAt = (home) => allTerminals().filter((terminal) => terminal.worktreePath === home);

/**
 * The tabs Orca lists at `home` once it has caught up with what was closed.
 * `terminal close` answers ok before `terminal list` stops reporting the tab, so
 * the listing is read again until the closed tabs are out of it. By handle
 * (#187).
 */
async function terminalsAfterClosing(home, closed, within = 5000) {
  const until = Date.now() + within;
  let left = terminalsAt(home);
  while (left.some((terminal) => closed.includes(terminal.handle)) && Date.now() < until) {
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

/** Every automation Orca knows about right now, as Orca lists it. */
function allAutomations() {
  const answer = orca(['automations', 'list']);
  assert.equal(answer.ok, true, `orca automations list failed: ${JSON.stringify(answer.error)}`);
  return answer.result.automations ?? [];
}

/**
 * The automations that are new since `before` and belong to `where`. Read off
 * the whole entry rather than one field, so this finds what was made there
 * whichever field Orca keeps the folder in.
 */
const newAutomationsAt = (before, where) =>
  allAutomations().filter((one) => !before.has(one.id) && JSON.stringify(one).includes(where));

/**
 * What a kit could change about someone's automation: what it is called, whether
 * it is on, what it asks, when it runs (the rule and what it is read against),
 * which harness runs it, and where. Nothing Orca writes when the automation runs
 * — a status, a count, a time — is in it, so an automation of the owner's that
 * happens to run while this test does is not taken for one the kit touched.
 * The provider is under whichever of the two names Orca keeps it; a field Orca
 * does not have drops out of both sides alike.
 */
const STEADY = ['id', 'name', 'enabled', 'prompt', 'rrule', 'dtstart', 'timezone', 'provider', 'agentId', 'runContext'];
const steady = (one) => JSON.stringify(Object.fromEntries(STEADY.map((key) => [key, one[key]])));

/** Every automation Orca lists, by id, as it stands. */
const automationsNow = () => new Map(allAutomations().map((one) => [one.id, steady(one)]));

/**
 * Run this checkout's `obk`, by its full path. The `obk` on PATH is the
 * published release this machine uses, not the code under test (#217).
 */
function obk(args) {
  const done = spawnSync(process.execPath, [cliEntry, ...args], { encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(done.error, undefined, `could not run \`obk\`: ${done.error?.message}`);
  // The owner reads this output. Orca's word for a workspace must not be in it.
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

/** What Bot Father's book says about one of its sessions right now. */
function sessionIn(home, name) {
  const book = parse(readFileSync(path.join(home, 'sessions.yaml'), 'utf8')) ?? {};
  return book.sessions?.[name] ?? {};
}

/**
 * Keep asking until `look` gives something other than undefined, or the time
 * runs out. `note` is added to the message when it does, so a run left alone
 * says what it was looking at rather than only that it waited.
 */
async function until(what, within, look, note = () => '', every = 1000) {
  const stop = Date.now() + within;
  for (;;) {
    const found = await look();
    if (found !== undefined) return found;
    assert.ok(Date.now() < stop, `gave up waiting for ${what} after ${within}ms.${note()}`);
    await setTimeout(every);
  }
}

/** Everything the tab is rendering right now, as one piece of text to look through. */
function screenOf(handle) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  return answer.ok === true ? JSON.stringify(answer.result) : '';
}

/**
 * What the tab is showing, for the message of a wait that ran out: Orca's own
 * word for whatever is waiting to be answered when it gave one, and then the
 * screen itself, which is the only thing that catches the rest.
 */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  return [
    blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`,
    ' This test answers nothing a tab asks; answer it in Orca and run again.',
    `\n  orca terminal read --terminal ${handle} --screen\n  ${screenOf(handle).slice(0, 2000)}`,
  ].join('');
}

/**
 * Wait until the tab will take a question: a TUI is up, and the tab is not
 * waiting on a screen of its own. The wait is long because a person may be
 * answering one. `hint` says what that screen is likely to be, when it is known.
 */
async function readyForAQuestion(handle, within = READY_MS, hint = '') {
  await until(
    `${handle} to be past the questions of its own`,
    within,
    async () => {
      const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '5000']);
      if (answer.ok !== true) return undefined;
      return answer.result?.wait?.blockedReason === undefined ? true : undefined;
    },
    () => `${hint}${whatIsUp(handle)}`,
  );
}

/**
 * Whether the tab is idle right now, with nothing of its own waiting: the same
 * question `readyForAQuestion` keeps asking, asked once.
 */
function idleNow(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '5000']);
  return answer.ok === true
    && answer.result?.wait?.blockedReason === undefined
    && answer.result?.wait?.satisfied !== false;
}

/**
 * Type a line into this test's own tab, once it is ready to take one, with
 * `--enter` to submit it. `hint` is for the message of a wait that runs out.
 */
async function askIn(handle, text, hint = '') {
  await readyForAQuestion(handle, READY_MS, hint);
  sendLine(handle, text);
}

/**
 * Send one line into this test's own tab, with `--enter`, whatever is in front
 * of it. Orca gates `--enter` as an agent prompt now and then, and a reissue was
 * refused when it was tried live, so a gated line fails with the screen and the
 * id rather than retrying (see `session-identity.test.js`).
 */
function sendLine(handle, text) {
  const sent = orca(['terminal', 'send', '--terminal', handle, '--text', text, '--enter']);
  if (sent.ok === true) return;

  const gated = requestIdIn(sent.error);
  assert.fail(
    `orca terminal send --enter failed: ${JSON.stringify(sent.error)}.`
    + (gated === undefined
      ? ''
      : ' Orca gated it as an agent prompt. Submit the line yourself in the tab, or reissue the'
        + ` same command with --retry-request ${gated} --wait-submit 30 — which was refused when it`
        + ' was tried live, so the tab is where this ends.')
    + whatIsUp(handle),
  );
}

/** The request id an `agent_prompt_blocked` carries, read out of the whole error. */
function requestIdIn(error) {
  const found = /"orchestrationRequestId"\s*:\s*"([^"]+)"/.exec(JSON.stringify(error ?? null));
  return found === null ? undefined : found[1];
}

/** Where Claude Code keeps the conversations it had in one folder (tech notes, section 2). */
const transcriptsOf = (home) => path.join(os.homedir(), '.claude', 'projects', home.replaceAll(/[^A-Za-z0-9]/g, '-'));

/**
 * One conversation's transcript, a JSON object per line; a conversation with no
 * file yet has no lines. Only whole lines are read: the last one may still be
 * being written, and it is read next time.
 */
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

/** The lines of every conversation named, each read once. */
const linesAcross = (home, ids) => [...new Set(ids)].flatMap((id) => linesOf(home, id));

/** The conversation Bot Father's book holds for one of its sessions now, and its lines. */
function conversationOf(home, name) {
  const id = sessionIn(home, name).session;
  return { id, lines: linesOf(home, id) };
}

/** The lines written at or after a moment, by the time each carries. */
const after = (lines, moment) => lines.filter((line) => Date.parse(line.timestamp ?? '') >= moment);

/** The turns in a conversation: what was said to the harness and what it said back. */
const turnsIn = (lines) => lines.filter((line) => line.type === 'user' || line.type === 'assistant');

/** The text a line says, where it says it as text: not a tool's answer. */
function textsOf(line) {
  const content = line.message?.content;
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  return content.filter((item) => item?.type === 'text' && typeof item.text === 'string').map((item) => item.text);
}

/** The tool calls an assistant line makes, and the tool answers a user line carries. */
const itemsOf = (line, type) => (Array.isArray(line.message?.content) ? line.message.content.filter((item) => item?.type === type) : []);
const toolUses = (line) => (line.type === 'assistant' ? itemsOf(line, 'tool_use') : []);
const toolResults = (line) => (line.type === 'user' ? itemsOf(line, 'tool_result') : []);

/**
 * The grooming jobs a stretch of transcript made, in the brief's own words: a
 * successful CronCreate whose `recurring` is true or absent and whose prompt
 * starts with the marker. Each with the id Claude Code gave it, and when it was
 * made, which is the answer line's time.
 *
 * Read here, from the raw transcript, and not from `obk groom`, because this is
 * what the kit's listing is checked against.
 */
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
      made.push({ id: answer.id, cron: input.cron, prompt: input.prompt, made: line.timestamp });
    }
  }
  return made;
}

/** Whether a stretch of transcript calls one of Claude Code's scheduling tools at all. */
const schedulesIn = (lines) => lines.flatMap(toolUses).filter((use) => /^Cron/.test(use.name));

/**
 * The times the grooming job fired, after `since`: a turn said to the harness,
 * as text, that carries the marker. The job's prompt starts with it, and a fire
 * is Claude Code handing that prompt to the session. Seen live on 2026-09-26
 * (2.1.283): a `{"type":"system","subtype":"scheduled_task_fire"}` line, then the
 * prompt as a `type: "user"` line with string content 59 ms later. The prompt's
 * line is the one read, because it is the one that says which job fired.
 *
 * Not a fire: a tool's answer (a CronCreate or CronList answer may repeat the
 * prompt), the summary a compaction writes, and a message from another session,
 * which may quote the report and the job in it. The kit's own `--on` line also
 * carries the marker, which is why `since` is the moment the job was made.
 */
function firesIn(lines, marker, since) {
  return lines.filter((line) => line.type === 'user'
    && line.isCompactSummary !== true
    && Date.parse(line.timestamp ?? '') > since
    && textsOf(line).some((text) => text.includes(marker) && !text.includes(CROSS_SESSION) && !text.includes('Fleet mail from')));
}

/**
 * The messages that reached a session's conversation from `since` on, by either
 * road the kit knows. Claude Code to Claude Code in one approval class is the
 * harness's own messaging, and arrives wrapped as a `<cross-session-message>`;
 * anything else goes through the Orca mailbox, and what reaches the conversation
 * is the kit's nudge naming who wrote. In this fleet only the grooming session
 * writes to `daily`; which one it was is checked on what is found.
 *
 * Seen live on 2026-09-26 (2.1.283): a `type: "user"` line with string content,
 * `Another Claude session sent a message:\n<cross-session-message
 * from="uds:/tmp/cc-socks/<pid>.sock" from-name="<the sender's session name>"
 * from-mode="prompting">\n…`. So the sender's address is `from-name`.
 */
function reportsIn(lines, since) {
  return lines.filter((line) => line.type === 'user'
    && Date.parse(line.timestamp ?? '') >= since
    && textsOf(line).some((text) => text.includes(CROSS_SESSION) || text.includes(MAIL_FROM_GROOMING)));
}

/** The last lines of a stretch of transcript, short, for the message of a wait that ran out. */
function tailOf(lines, count = 15) {
  if (lines.length === 0) return '    (nothing)';
  return lines.slice(-count).map((line) => {
    const said = line.message?.content ?? line.toolUseResult ?? line.compactMetadata ?? line.attachment ?? '';
    return `    ${line.timestamp ?? '-'}  ${line.type}${line.subtype ? `/${line.subtype}` : ''}  ${JSON.stringify(said).slice(0, 200)}`;
  }).join('\n');
}

/**
 * The lines the kit's SessionStart hook left for a `--resume` (tech notes,
 * section 2: an `attachment` whose `hookName` is `SessionStart:resume`). One is
 * written each time a process resumes the conversation.
 */
const resumesIn = (lines) => lines.filter((line) => line.type === 'attachment' && line.attachment?.hookName === 'SessionStart:resume');

/** Claude Code's registry of running processes, one file each, `<pid>.json` (tech notes, section 2). */
const REGISTRY = path.join(os.homedir(), '.claude', 'sessions');

/**
 * The Claude Code processes having conversation `id` right now: the registry's
 * entries for it whose process is still there. A file left behind by a process
 * that was killed with its tab is not one, which is why the process itself is
 * looked at as well. That look is `ps -p`, which only reads: nothing here
 * signals any process.
 */
function processesIn(id) {
  return registry()
    .filter((entry) => entry.sessionId === id && Number.isInteger(entry.pid) && entry.pid > 0)
    .filter((entry) => spawnSync('ps', ['-p', String(entry.pid), '-o', 'pid='], { encoding: 'utf8' }).status === 0)
    .map((entry) => entry.pid);
}

/** Every entry in the registry, read as it is; one being written or removed as it is read is left out. */
function registry() {
  let names;
  try {
    names = readdirSync(REGISTRY);
  } catch {
    return [];
  }
  const entries = [];
  for (const name of names.filter((one) => one.endsWith('.json'))) {
    try {
      entries.push(JSON.parse(readFileSync(path.join(REGISTRY, name), 'utf8')));
    } catch {
      // The next look reads it again.
    }
  }
  return entries.filter((entry) => entry !== null && typeof entry === 'object');
}

/**
 * Ask the grooming session to call CronList, and read what Claude Code answered
 * out of the transcript (`toolUseResult.jobs`). The question carries no marker,
 * so it is never taken for a fire. `hint` is for the message of a wait that runs
 * out.
 */
async function cronListIn(home, handle, hint = '') {
  const asked = Date.now();
  await askIn(handle, 'Use your CronList tool to list the jobs scheduled in this session, then reply with the single word listed.', hint);
  return until(
    'the grooming session to answer a CronList',
    ANSWER_MS,
    async () => {
      const lines = after(conversationOf(home, 'grooming').lines, asked);
      const calls = new Set(lines.flatMap(toolUses).filter((use) => use.name === 'CronList').map((use) => use.id));
      const answer = lines.find((line) => toolResults(line).some((result) => calls.has(result.tool_use_id)));
      if (answer === undefined) return undefined;
      assert.ok(Array.isArray(answer.toolUseResult?.jobs), `CronList answered without a list of jobs: ${JSON.stringify(answer.toolUseResult)}`);
      return answer.toolUseResult.jobs;
    },
    () => `${hint}\n  its conversation since the question:\n${tailOf(after(conversationOf(home, 'grooming').lines, asked))}${whatIsUp(handle)}`,
    POLL_MS,
  );
}

/** The one grooming job in a CronList answer, and a failure that says what was listed when it is not one. */
function theGroomingJob(jobs, marker, when) {
  const ours = jobs.filter((job) => String(job.prompt ?? '').startsWith(marker));
  assert.equal(ours.length, 1, `Claude Code itself should hold one grooming job ${when}, and CronList answered: ${JSON.stringify(jobs)}`);
  return ours[0];
}

/** A time of day as the kit takes it: 24 hours, two digits each, in this machine's own time. */
const hhmm = (date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

test('grooming runs on Claude Code\'s own schedule in the grooming session: off until --on, then once a day, renewed, reported, and still there after a restart and a compact', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
    automations: automationsNow(),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-groom-')));
  const home = path.join(bots, 'bots', 'bot-father');
  // The marker a grooming job's prompt starts with: the bots folder's real
  // path, which `bots` already is.
  const marker = `obk grooming for ${bots}`;

  // Every tab the kit said it opened for this run, by handle, from each answer
  // that opens one: init, up and the restarts.
  const ourTabs = new Set();
  const openedBy = (answer) => {
    for (const entry of answer.tabs ?? []) {
      if (entry.created === true && typeof entry.terminal === 'string') ourTabs.add(entry.terminal);
    }
    return answer;
  };

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    // The kit creates, edits and removes no Orca automation. One made in this
    // test's own folder all the same was made by this run, so it goes, by its
    // id, and the check below says it was there.
    const strays = newAutomationsAt(before.automations, bots);
    for (const one of strays) orca(['automations', 'remove', '--id', one.id]);

    const closed = [];
    for (const terminal of terminalsAt(home)) {
      if (before.handles.has(terminal.handle)) continue;
      orca(['terminal', 'close', '--terminal', terminal.handle, '--tab']);
      closed.push(terminal.handle);
    }
    for (const setup of allSetups()) {
      if (setup.path !== home || before.setups.has(setup.id)) continue;
      orca(['project', 'setup-delete', '--setup', setup.id]);
    }
    await removeBotsFolderAndSiblings(bots);

    // It closed nothing but its own. Every tab this teardown closed is one the
    // kit said it opened for this run, and each restart closed only the grooming
    // tab it held (checked where it ran); nothing else here closes a tab, and
    // `orca` refuses the blanket close.
    assert.deepEqual(
      closed.filter((one) => !ourTabs.has(one)),
      [],
      `this test closed tabs in its own folder that the kit never said it opened for it; it opened: ${JSON.stringify([...ourTabs])}`,
    );

    // A tab that was open before and is gone now was closed by someone else: the
    // machine is shared, and other sessions open and close their own tabs while
    // this runs. So it is said, not failed.
    const left = new Set(allTerminals().map((terminal) => terminal.handle));
    const goneElsewhere = [...before.handles].filter((one) => !left.has(one));
    if (goneElsewhere.length > 0) {
      t.diagnostic(
        `${goneElsewhere.length} tab(s) open before this test are gone now, and this test did not close them`
        + ` (it closed only ${JSON.stringify(closed)}, in its own folder): ${goneElsewhere.join(', ')}`,
      );
    }
    // Orca's automations as this test found them: none gone, none edited. What
    // is compared is only what a kit could change about one, not what Orca
    // writes when it runs (see `steady`).
    const automations = automationsNow();
    for (const [id, was] of before.automations) {
      assert.ok(automations.has(id), `automation ${id} was there before this test and is gone now`);
      assert.equal(automations.get(id), was, `automation ${id} was changed while this test ran`);
    }
    assert.deepEqual(
      strays.map((one) => one.id),
      [],
      `an automation was made in this test's folder, and the kit makes none; it has been removed: ${JSON.stringify(strays)}`,
    );
    assert.deepEqual(newAutomationsAt(before.automations, bots), [], 'this test left an automation behind');
    assert.deepEqual(await terminalsAfterClosing(home, closed), [], 'this test left tabs behind');
  });

  // ---------------------------------------------------------------------------
  // The fleet: Bot Father on Claude Code, and the grooming session the user adds
  // like any other, with the model and effort it is to run at. No `--harness`:
  // Bot Father's own is Claude Code, and the session takes it.
  const init = openedBy(obkJson(['init', '--bots', bots, '--harness', 'claude']));
  const daily = tabOf(init, 'daily');
  assert.equal(
    daily.harnessStarted,
    true,
    `no claude came up in ${daily.title}, and the report is sent to it: look at it with `
    + `\`orca terminal read --terminal ${daily.terminal} --screen\``,
  );

  obkJson([
    'session', 'add', '--bots', bots, '--bot', 'bot-father', '--name', 'grooming',
    '--model', MODEL, '--effort', EFFORT,
  ]);

  // 5. Nothing before --on, from the first moment: a session that exists and is
  // not up yet, no job, and this call typed nothing.
  let groom = obkJson(['groom', '--bots', bots]).groom;
  assert.deepEqual(
    groom.session,
    { name: 'grooming', harness: 'claude', up: false, conversation: null },
    `obk groom should see the grooming session, on Bot Father's harness and not up yet: ${JSON.stringify(groom)}`,
  );
  assert.deepEqual(groom.jobs, [], 'there is no job before --on');
  assert.equal(groom.asked, null, 'and a question with no flag types nothing');

  const opened = tabOf(openedBy(obkJson(['up', '--bots', bots, '--bot', 'bot-father'])), 'grooming');
  assert.equal(opened.created, true, 'up opened a tab for the grooming session');
  assert.equal(
    opened.harnessStarted,
    true,
    `no claude came up in ${opened.title}: look at it with \`orca terminal read --terminal ${opened.terminal} --screen\``,
  );
  let handle = opened.terminal;

  // Both of Bot Father's Claude tabs past their first screens. On Claude Code the
  // kit's hook runs once the folder is trusted, so an id in the book says the
  // trust list was answered; Orca reports that list as idle with nothing
  // blocking, so its own word is not enough (see `restart.test.js`).
  await until(
    'Bot Father daily to report its session id',
    READY_MS,
    async () => sessionIn(home, 'daily').session,
    () => ` Answer Claude Code's folder trust in ${daily.title}: the report goes to it.${whatIsUp(daily.terminal)}`,
  );
  await until(
    'the grooming session to report its session id',
    READY_MS,
    async () => sessionIn(home, 'grooming').session,
    () => ` Answer Claude Code's folder trust in ${opened.title}.${whatIsUp(handle)}`,
  );
  await readyForAQuestion(handle);

  const turnsNow = () => turnsIn(conversationOf(home, 'grooming').lines).length;
  const quiet = turnsNow();

  // Asked, as a person would, while it is up: still nothing scheduled.
  groom = obkJson(['groom', '--bots', bots]).groom;
  assert.equal(groom.session?.up, true, `the grooming tab is up now: ${JSON.stringify(groom.session)}`);
  assert.deepEqual(groom.jobs, []);
  assert.equal(groom.asked, null);
  assert.equal(obk(['groom', '--bots', bots]).status, 0, 'the plain report answers 0');

  // And the one road to a schedule that does not say --on is refused while
  // grooming is off: a time goes with the yes. Half a day away, so that a kit
  // that took it anyway makes a job that cannot fire while this test runs.
  const early = obk(['groom', '--bots', bots, '--at', hhmm(new Date(Date.now() + 12 * 3600000))]);
  assert.notEqual(early.status, 0, `--at with no job and no --on should be refused: ${early.stdout}${early.stderr}`);
  assert.ok(early.stderr.includes('--on'), `and the refusal should say the time goes with --on: ${early.stderr}`);

  await setTimeout(SETTLE_MS);
  assert.equal(
    turnsNow(),
    quiet,
    'obk groom with no flag, and a refused --at, typed nothing into the grooming tab:'
    + `\n${tailOf(conversationOf(home, 'grooming').lines)}`,
  );

  // 5, the end of it: from the moment it came up to here, the grooming
  // conversation called none of Claude Code's scheduling tools and ran no
  // grooming, and daily heard nothing.
  const beforeOn = conversationOf(home, 'grooming').lines;
  assert.deepEqual(schedulesIn(beforeOn), [], `nothing was scheduled before --on:\n${tailOf(beforeOn)}`);
  assert.deepEqual(firesIn(beforeOn, marker, 0), [], `and no grooming ran:\n${tailOf(beforeOn)}`);
  assert.deepEqual(reportsIn(conversationOf(home, 'daily').lines, 0), [], 'and daily was sent no report');

  // ---------------------------------------------------------------------------
  // 1. The yes: --on, for a time a few minutes ahead, in this machine's own time.
  // The cron is written from the time the way the brief does it, plain numbers.
  const due = new Date(Math.ceil((Date.now() + LEAD_MS) / 60000) * 60000);
  const at = hhmm(due);
  const cron = `${due.getMinutes()} ${due.getHours()} * * *`;

  const onAt = Date.now();
  const on = obkJson(['groom', '--bots', bots, '--on', '--at', at]).groom;
  assert.equal(on.asked, 'on', `--on types the line that schedules it: ${JSON.stringify(on)}`);
  assert.deepEqual(on.jobs, [], 'and the job it asked for is not listed by the same call');

  // The session makes it, from the line the kit typed.
  const first = await until(
    `the grooming session to make its job for ${at}`,
    ANSWER_MS,
    async () => jobsMadeIn(after(conversationOf(home, 'grooming').lines, onAt), marker)[0],
    () => `\n  its conversation since --on:\n${tailOf(after(conversationOf(home, 'grooming').lines, onAt))}${whatIsUp(handle)}`,
    POLL_MS,
  );
  const onId = sessionIn(home, 'grooming').session;
  const madeAt = Date.parse(first.made);
  assert.equal(first.cron, cron, `the job is for ${at}: ${JSON.stringify(first)}`);
  assert.ok(madeAt < due.getTime(), `the job was made at ${first.made}, after its own time ${due.toISOString()}, so it would first fire tomorrow`);
  assert.ok(
    after(conversationOf(home, 'grooming').lines, onAt).some((line) => line.type === 'user'
      && textsOf(line).some((text) => text.includes(marker) && text.includes(cron))),
    'the line the kit typed carries the marker and the cron',
  );

  // And the kit lists it, as the transcript has it.
  groom = obkJson(['groom', '--bots', bots]).groom;
  assert.equal(groom.session?.conversation, onId, `the conversation the book holds: ${JSON.stringify(groom.session)}`);
  assert.equal(groom.jobs.length, 1, `obk groom should list the one job: ${JSON.stringify(groom.jobs)}`);
  const [listedOn] = groom.jobs;
  assert.equal(listedOn.id, first.id, 'the job Claude Code made');
  assert.equal(listedOn.at, at);
  assert.equal(listedOn.cron, cron);
  assert.equal(Date.parse(listedOn.made), madeAt, `made when Claude Code answered: ${JSON.stringify(listedOn)}`);
  assert.equal(Date.parse(listedOn.expires), madeAt + WEEK_MS, `and it ends seven days after: ${JSON.stringify(listedOn)}`);
  const expiresBefore = Date.parse(listedOn.expires);

  // The fire. Nothing is typed into the tab from here until the run is over:
  // the job fires only while Claude Code is idle in it. This is the longest wait
  // in the file, and it is as long as the documented jitter makes it.
  const fire = await until(
    `the job to fire, due at ${at} (${due.toISOString()}); Claude Code documents up to ${JITTER_MS / 60000} minutes late`,
    Math.max(0, due.getTime() + JITTER_MS + LATE_MS - Date.now()),
    async () => firesIn(conversationOf(home, 'grooming').lines, marker, madeAt)[0],
    () => ' It fires only while its tab is up and Claude Code is idle in it.'
      + `\n  its conversation since the job was made:\n${tailOf(after(conversationOf(home, 'grooming').lines, madeAt))}`
      + whatIsUp(handle),
    POLL_MS,
  );
  const firedAt = Date.parse(fire.timestamp);
  assert.ok(firedAt >= due.getTime(), `it fired at ${fire.timestamp}, before its time ${due.toISOString()}`);
  assert.ok(
    firedAt <= due.getTime() + JITTER_MS + FIRE_SLACK_MS,
    `it fired at ${fire.timestamp}, more than the documented ${JITTER_MS / 60000} minutes after ${due.toISOString()},`
    + ` and more than ${FIRE_SLACK_MS / 1000} seconds past them for the scheduler's once-a-second look`,
  );

  // The run: it reports to daily, renews its job, and finishes. Finished is the
  // tab idle on two looks in a row, so a pause between two tool calls is not
  // taken for the end.
  let idleLooks = 0;
  const ran = await until(
    'the run to send its report to daily, renew its job, and finish',
    RUN_MS,
    async () => {
      if (reportsIn(conversationOf(home, 'daily').lines, firedAt).length === 0) return undefined;
      const { jobs } = obkJson(['groom', '--bots', bots]).groom;
      if (!jobs.some((job) => Date.parse(job.expires) > expiresBefore)) return undefined;
      idleLooks = idleNow(handle) ? idleLooks + 1 : 0;
      return idleLooks >= 2 ? { at: Date.now() } : undefined;
    },
    () => {
      let jobs;
      try {
        jobs = JSON.stringify(obkJson(['groom', '--bots', bots]).groom.jobs);
      } catch (error) {
        jobs = `(obk groom failed: ${error.message})`;
      }
      return ` Reports at daily: ${reportsIn(conversationOf(home, 'daily').lines, firedAt).length}.`
        + ` Jobs obk groom lists: ${jobs}; the one before the run ended ${new Date(expiresBefore).toISOString()}.`
        + `\n  daily's conversation since the fire:\n${tailOf(after(conversationOf(home, 'daily').lines, firedAt))}`
        + `\n  grooming's conversation since the fire:\n${tailOf(after(conversationOf(home, 'grooming').lines, firedAt))}`
        + whatIsUp(handle);
    },
    POLL_MS,
  );

  const groomingLines = conversationOf(home, 'grooming').lines;
  const runLines = groomingLines.filter((line) => {
    const when = Date.parse(line.timestamp ?? '');
    return when >= firedAt && when <= ran.at;
  });

  // It fired once, from the one job --on made.
  assert.equal(firesIn(groomingLines, marker, madeAt).length, 1, `the job fired once:\n${tailOf(firesIn(groomingLines, marker, madeAt))}`);
  assert.equal(
    jobsMadeIn(groomingLines.filter((line) => Date.parse(line.timestamp ?? '') < firedAt), marker).length,
    1,
    '--on made one job',
  );

  // And sent one report, to daily, from the grooming session.
  const reports = reportsIn(conversationOf(home, 'daily').lines, firedAt);
  assert.equal(reports.length, 1, `the run should send daily one report, and daily's conversation has ${reports.length}:\n${tailOf(reports)}`);
  const address = sessionIn(home, 'grooming').address;
  // By Claude Code's own messaging the sender's name is `from-name`; `from` is
  // the socket it wrote from (see `reportsIn`).
  if (textsOf(reports[0]).some((text) => text.includes(CROSS_SESSION))) {
    assert.ok(
      textsOf(reports[0]).some((text) => text.includes(`from-name="${address}"`)),
      `the message daily got should be from the grooming session's address ${address}:\n${tailOf(reports)}`,
    );
  }

  // 2. What the run ran on, as its own lines record it. A subagent's lines and
  // Claude Code's own synthetic ones are not the session's calls.
  const calls = runLines.filter((line) => line.type === 'assistant' && line.isSidechain !== true && line.message?.model !== '<synthetic>');
  assert.ok(calls.length > 0, `the run should have made calls of its own:\n${tailOf(runLines)}`);
  assert.deepEqual(
    [...new Set(calls.map((line) => line.message?.model))],
    [MODEL],
    `every call in the run should be on ${MODEL}`,
  );
  assert.deepEqual(
    [...new Set(calls.map((line) => line.effort).filter((effort) => effort !== undefined))],
    [EFFORT],
    `and the run's calls should record ${EFFORT} effort, and no other`,
  );

  // 3. After the run: still listed, once, at the same time, renewed by the run
  // itself, and ending later than it did.
  groom = obkJson(['groom', '--bots', bots]).groom;
  assert.equal(groom.jobs.length, 1, `after the run there should be one job, not a second beside the first: ${JSON.stringify(groom.jobs)}`);
  const [kept] = groom.jobs;
  assert.ok(
    Date.parse(kept.expires) > expiresBefore,
    `and it should end later than ${new Date(expiresBefore).toISOString()}: ${JSON.stringify(kept)}`,
  );
  assert.equal(kept.cron, cron, 'at the same time');
  assert.equal(kept.at, at);
  assert.ok(
    jobsMadeIn(runLines, marker).some((job) => job.id === kept.id),
    `and made by the run itself: ${JSON.stringify(jobsMadeIn(runLines, marker))}`,
  );

  // ---------------------------------------------------------------------------
  // 4. The restart the user asks for. The kit closes the grooming tab and brings
  // the conversation back in a new one; the job has to come back with it.
  const restarted = openedBy(obkJson(['restart', '--bots', bots, '--bot', 'bot-father', '--session', 'grooming']));
  assert.deepEqual(
    (restarted.closed ?? []).map((one) => one.name),
    ['grooming'],
    `the restart should close the grooming tab and no other: ${JSON.stringify(restarted.closed)}`,
  );
  assert.equal(restarted.closed[0].terminal, handle, 'and it is the grooming tab this test had');
  const back = tabOf(restarted, 'grooming');
  assert.equal(back.resumed, true, 'and bring its conversation back');
  assert.equal(
    back.harnessStarted,
    true,
    `no claude came up in ${back.title}: look at it with \`orca terminal read --terminal ${back.terminal} --screen\``,
  );
  handle = back.terminal;
  await readyForAQuestion(handle);
  assert.equal(sessionIn(home, 'grooming').session, onId, 'it is the same conversation');

  groom = obkJson(['groom', '--bots', bots]).groom;
  assert.equal(groom.session?.up, true, `the new tab is up: ${JSON.stringify(groom.session)}`);
  assert.deepEqual(groom.jobs.map((job) => job.id), [kept.id], `obk groom still lists the job after the restart: ${JSON.stringify(groom.jobs)}`);

  // And Claude Code itself still holds it, which the transcript alone cannot say.
  const afterRestart = theGroomingJob(await cronListIn(home, handle), marker, 'after the restart');
  assert.equal(afterRestart.id, kept.id, 'the job the kit lists');
  assert.equal(afterRestart.cron, cron);

  // ---------------------------------------------------------------------------
  // 7. The compact, which the management session types between runs.
  const compactAt = Date.now();
  const compacted = obkJson(['groom', '--bots', bots, '--compact']).groom;
  assert.equal(compacted.asked, 'compact', `--compact types /compact: ${JSON.stringify(compacted)}`);

  // The marker Claude Code writes for a compaction (tech notes, section 2),
  // looked for in the conversation the book held and in the one it holds now,
  // in case the compaction moved it.
  await until(
    'the grooming conversation to be compacted',
    COMPACT_MS,
    async () => after(linesAcross(home, [onId, sessionIn(home, 'grooming').session]), compactAt)
      .find((line) => line.type === 'system' && line.subtype === 'compact_boundary'),
    () => `\n  its conversation since --compact:\n${tailOf(after(conversationOf(home, 'grooming').lines, compactAt))}${whatIsUp(handle)}`,
    POLL_MS,
  );

  const afterCompact = theGroomingJob(await cronListIn(home, handle), marker, 'after the compact');
  assert.equal(afterCompact.id, kept.id, 'the schedule is still in place after the compact');
  groom = obkJson(['groom', '--bots', bots]).groom;
  assert.deepEqual(groom.jobs.map((job) => job.id), [kept.id], `and obk groom still lists it: ${JSON.stringify(groom.jobs)}`);

  // Across the restart and the compact it fired no more: once, all told.
  const current = sessionIn(home, 'grooming').session;
  assert.equal(
    firesIn(linesAcross(home, [onId, current]), marker, madeAt).length,
    1,
    'the job fired once from --on to here, restart and compact included',
  );

  // ---------------------------------------------------------------------------
  // 4, the other half: a /clear in its tab starts a new conversation. Either the
  // job still runs, and then the kit lists it, or it is gone, and then the kit
  // says grooming is off. What must not happen is the two disagreeing: a job the
  // kit does not see is a fleet groomed twice once the user turns it on again.
  await askIn(handle, '/clear');
  const cleared = await until(
    'the grooming session to report the conversation /clear began',
    HOOK_MS,
    async () => {
      const id = sessionIn(home, 'grooming').session;
      return id !== undefined && id !== current ? id : undefined;
    },
    () => whatIsUp(handle),
  );
  await readyForAQuestion(handle);

  const stillHeld = (await cronListIn(home, handle)).filter((job) => String(job.prompt ?? '').startsWith(marker));
  groom = obkJson(['groom', '--bots', bots]).groom;
  assert.deepEqual(
    groom.jobs.map((job) => job.id),
    stillHeld.map((job) => job.id),
    `after /clear, obk groom should list what Claude Code still holds: CronList answered ${JSON.stringify(stillHeld)},`
    + ` obk groom listed ${JSON.stringify(groom.jobs)}`,
  );
  if (stillHeld.length === 0) {
    const gone = obk(['groom', '--bots', bots]);
    assert.equal(gone.status, 0);
    assert.match(gone.stdout, /\boff\b/i, `with no job, obk groom says grooming is off: ${gone.stdout}`);
    assert.ok(gone.stdout.includes('--on'), `and how to turn it on again: ${gone.stdout}`);
  }

  // What obk groom lists against what Claude Code itself holds, said both ways
  // when they differ: which jobs came back, and whether the one made before the
  // /clear was among them. Neither side is assumed; they only have to agree.
  const agrees = (jobs, when) => {
    const held = jobs.filter((job) => String(job.prompt ?? '').startsWith(marker)).map((job) => job.id).sort();
    const listed = obkJson(['groom', '--bots', bots]).groom.jobs.map((job) => job.id).sort();
    assert.deepEqual(
      listed,
      held,
      `${when}, obk groom should list exactly the grooming jobs Claude Code holds. CronList held ${JSON.stringify(held)}:`
      + ` the job made before the /clear, ${kept.id}, ${held.includes(kept.id) ? 'came back' : 'did not come back'}.`
      + ` obk groom listed ${JSON.stringify(listed)}.`,
    );
  };

  // ---------------------------------------------------------------------------
  // 4, after the /clear: a resume. The kit reads a Claude Code process's jobs
  // from every conversation it has had since it began, back through the book's
  // `clear` history to the transcript with the hook's `startup` or `resume`
  // line. Which jobs a resume of a conversation that began with a /clear brings
  // back has not been seen live (tech notes, section 2), so this finds out, and
  // holds the kit to whatever Claude Code does.
  const resumedBefore = resumesIn(linesOf(home, cleared)).length;
  const reopened = openedBy(obkJson(['restart', '--bots', bots, '--bot', 'bot-father', '--session', 'grooming']));
  assert.deepEqual(
    (reopened.closed ?? []).map((one) => one.name),
    ['grooming'],
    `the restart should close the grooming tab and no other: ${JSON.stringify(reopened.closed)}`,
  );
  assert.equal(reopened.closed[0].terminal, handle, 'and it is the grooming tab this test had');
  const again = tabOf(reopened, 'grooming');
  assert.equal(again.resumed, true, 'and bring back the conversation the /clear began');
  assert.equal(
    again.harnessStarted,
    true,
    `no claude came up in ${again.title}: look at it with \`orca terminal read --terminal ${again.terminal} --screen\``,
  );
  handle = again.terminal;
  await readyForAQuestion(handle);
  assert.equal(sessionIn(home, 'grooming').session, cleared, 'the book still holds the conversation the /clear began');
  agrees(await cronListIn(home, handle), 'After a restart that resumed the conversation the /clear began');

  // Looked for after the question rather than before it: whether the hook's
  // line is written as the process starts or with its first turn has not been
  // seen, and after a turn it is there either way.
  await until(
    'the resumed conversation to carry a new SessionStart:resume line',
    HOOK_MS,
    async () => (resumesIn(linesOf(home, cleared)).length > resumedBefore ? true : undefined),
    () => `\n  the conversation ${cleared}, at its end:\n${tailOf(linesOf(home, cleared))}${whatIsUp(handle)}`,
  );

  // ---------------------------------------------------------------------------
  // 4, a bare resume: how Orca's own cold restore starts a tab again (#318). A
  // new process, `claude --resume <id>` in Bot Father's folder, with none of the
  // kit's launch line: no OBK_* variables, no -n, no --permission-mode. The
  // kit's hook is in the folder's own settings, so it should still run and leave
  // its `resume` line; that has not been seen live either.
  //
  // In this test's own tab: the running harness is ended with /exit, and the
  // line typed into the shell that is then in front.
  const bareHint = ' The session was started bare, so it runs on this machine\'s own settings'
    + ' and not the kit\'s launch line: manual approval, and it may be asking something on'
    + ' screen first. Answer it in Orca.';
  const running = processesIn(cleared);
  assert.equal(
    running.length,
    1,
    `the premise: one running Claude Code process is having the conversation ${cleared}, and there are ${running.length}.`
    + ` The registry in ${REGISTRY} holds, for this folder: ${JSON.stringify(registry()
      .filter((entry) => entry.cwd === home)
      .map((entry) => ({ pid: entry.pid, sessionId: entry.sessionId })))}`,
  );
  await askIn(handle, '/exit');
  await until(
    `the grooming session's Claude Code (pid ${running[0]}) to exit, so the shell is in front`,
    ANSWER_MS,
    async () => (processesIn(cleared).includes(running[0]) ? undefined : true),
    () => whatIsUp(handle),
  );

  const resumedBeforeBare = resumesIn(linesOf(home, cleared)).length;
  sendLine(handle, `claude --resume ${cleared}`);
  await until(
    `a new Claude Code process to resume ${cleared} from the bare command`,
    READY_MS,
    async () => processesIn(cleared).find((pid) => pid !== running[0]),
    () => `${bareHint}${whatIsUp(handle)}`,
  );
  await readyForAQuestion(handle, READY_MS, bareHint);
  agrees(await cronListIn(home, handle, bareHint), 'After a bare `claude --resume`');

  // And the kit's hook ran for it, with no launch line of the kit's: a new
  // `resume` line (looked for after the question, as above), and the book still
  // on the same conversation.
  await until(
    'the bare resume to leave a new SessionStart:resume line',
    HOOK_MS,
    async () => (resumesIn(linesOf(home, cleared)).length > resumedBeforeBare ? true : undefined),
    () => `${bareHint}\n  the conversation ${cleared}, at its end:\n${tailOf(linesOf(home, cleared))}${whatIsUp(handle)}`,
  );
  assert.equal(sessionIn(home, 'grooming').session, cleared, 'the book still holds the same conversation after the bare resume');
});
