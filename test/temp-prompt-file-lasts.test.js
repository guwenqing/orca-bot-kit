// A temporary session's task outlives the file it was given from (#758).
//
//   obk temp make --bots <path> --name <session> --prompt-file <path>
//
// A maker often writes the task into a scratch folder under the system's temp
// folder, and a reboot empties it. The make reads the file once, when it is
// run, and the made session keeps the text of the task: brought up again after
// the file is gone, its launch line still carries the whole task as its start
// prompt, the work-dir note below it, and `obk up` does not refuse it. The same
// holds when the hook gives a Claude Code session its start prompt again after
// a /clear or a compaction. And the text is the one the file held at the make:
// a file written again later is not the task.
//
// How the kit keeps the text (which key, which file) is not pinned here, only
// that the task survives.
//
// A role's prompt file is another thing, on purpose: it is the bot's own file
// in the bot home, and the session reads it at each launch, so a change to it
// reaches the next fresh launch. That is pinned here too. What is already
// pinned elsewhere is not repeated:
//
//   - a prompt file that cannot be read at make time is refused and nothing is
//     made: TP3 in temp-sessions.test.js;
//   - a long-lived session's prompt file (`session add --prompt-file`) is read
//     at each launch: "the file is read when the session starts, not when it
//     was added" in prompt-file.test.js; `session change --prompt-file` writes
//     the same `prompt_file`: SC4 in session-change.test.js.
//
// The fleet is the one in helpers/temp-roles.js: temp-bot on Codex, its
// planner on Claude Code and its nightly on Codex, brought up. Every run is in
// the sandbox (helpers/cli.js): its own HOME, a fake Orca, and fake harnesses
// on its own PATH. Nothing here reaches the real Orca, a real harness, or
// anything outside the sandbox.

import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  botHomeOf,
  createSandbox,
  fakeProgram,
  recordSession,
  sessionIn,
  sh,
  typedInto,
} from './helpers/cli.js';
import { hookContext, mainUnitsText } from './helpers/rules.js';
import { BOT, fleet, liveTab, made, REVIEW_DUTY } from './helpers/temp-roles.js';

/**
 * A task as a maker writes one into a file: more than one line, a list, an
 * indent, quotes and a backtick. Every character of it has to arrive.
 */
const TASK = `Review pull request 758 against its issue.

Check:
  - that the task outlives its file
  - what "obk up" says

Don't run \`git push\` yourself.`;

/**
 * Write `text` into a scratch folder of the sandbox's own system temp folder,
 * the kind of place a reboot empties, and give back the file and its folder.
 */
async function scratchTask(box, text, name = 'task.md') {
  const folder = path.join(box.tmp, `scratch-${Math.random().toString(36).slice(2)}`);
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, name);
  await writeFile(file, `${text}\n`);
  return { file, folder };
}

/** What a reboot does to the scratch folder: it is gone, and the file with it. */
const emptied = (folder) => rm(folder, { recursive: true, force: true });

/** Close a session's tab the way a reboot or a crash does: Orca no longer has it. */
async function tabGone(box, terminal) {
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.tabId !== terminal.tabId) });
}

/**
 * The start prompt a shell running `line` hands the fake harness: its last
 * argument. The fake's log only grows, so the call is the one this run added.
 */
async function promptOf(box, line, harness) {
  const fake = await fakeProgram(box, harness, {});
  const before = (await fake.calls()).length;
  const ran = await sh(line, { cwd: box.cwd, env: box.env });
  assert.equal(ran.code, 0, `the line should run: ${line}\n${ran.stderr}`);
  const calls = await fake.calls();
  assert.equal(calls.length, before + 1, `the line should start the harness once, got: ${line}`);
  return calls.at(-1).args.at(-1);
}

/** The one launch line typed into a session's current tab. */
async function lineOf(box, bots, name) {
  const typed = typedInto(await liveTab(box, bots, name));
  assert.equal(typed.length, 1, `one launch line is typed into ${name}'s tab, got: ${JSON.stringify(typed)}`);
  return typed[0];
}

/** `obk up` for one session, which must work. */
async function upAgain(box, name, args = ['--bot', BOT, '--session', name]) {
  const result = await box.run(['up', '--bots', 'bots', ...args]);
  assert.equal(result.code, 0, `obk up ${args.join(' ')} should bring ${name} up again:\n${result.stdout}${result.stderr}`);
  return result;
}

/** A start prompt that is the task, whole, with the work-dir note a blank line below it. */
function assertTaskPrompt(prompt, task, workDir, what) {
  assert.equal(typeof prompt, 'string', `${what}: the launch line should end with the start prompt, got: ${JSON.stringify(prompt)}`);
  assert.ok(prompt.startsWith(`${task}\n\n`), `${what}: the task is the start prompt, whole, the work-dir note below it, got: ${JSON.stringify(prompt)}`);
  assert.ok(prompt.includes(workDir), `${what}: the note names the work dir ${workDir}, got: ${JSON.stringify(prompt)}`);
}

/** The additionalContext the hook gave, or undefined when it printed nothing. */
function contextOf(result) {
  assert.equal(result.code, 0, `the hook must never fail the session it runs in: ${result.stderr}`);
  if (result.stdout === '') return undefined;
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`the hook's answer must be JSON, got: ${result.stdout} (${error.message})`);
  }
  return answer?.hookSpecificOutput?.additionalContext;
}

// ------------------------------------------------- the task outlives its file

test('PL1 a session made with --prompt-file, its file gone and its tab gone, comes up again with the whole task as its start prompt', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box, { roles: false });
  const workDir = path.join(botHomeOf(bots, BOT), 'work', 'scout');
  const { file, folder } = await scratchTask(box, TASK);

  await made(box, planner, ['--name', 'scout', '--prompt-file', file]);
  const first = await liveTab(box, bots, 'scout');
  assertTaskPrompt(await promptOf(box, await lineOf(box, bots, 'scout'), 'claude'), TASK, workDir, 'at the make');

  await emptied(folder);
  await tabGone(box, first);
  await upAgain(box, 'scout');

  const again = await liveTab(box, bots, 'scout');
  assert.notEqual(again.tabId, first.tabId, 'scout is in a new tab');
  assertTaskPrompt(await promptOf(box, await lineOf(box, bots, 'scout'), 'claude'), TASK, workDir, 'brought up again');
});

test('PL1 the whole fleet brought up again, a temporary session\'s task file gone, is not refused and starts that session with its task', async (t) => {
  // After a reboot the user runs obk up for the whole bots folder.
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box, { roles: false });
  const workDir = path.join(botHomeOf(bots, BOT), 'work', 'scout');
  const { file, folder } = await scratchTask(box, TASK);
  await made(box, planner, ['--name', 'scout', '--prompt-file', file]);
  const first = await liveTab(box, bots, 'scout');

  await emptied(folder);
  await tabGone(box, first);
  await upAgain(box, 'scout', []);

  assert.notEqual((await liveTab(box, bots, 'scout')).tabId, first.tabId, 'scout is in a new tab');
  assertTaskPrompt(await promptOf(box, await lineOf(box, bots, 'scout'), 'claude'), TASK, workDir, 'brought up again');
});

test('PL1 a Codex temporary session made with --prompt-file comes up again with its task after the file is gone', async (t) => {
  const box = await createSandbox(t);
  const { bots, nightly } = await fleet(box, { roles: false });
  const workDir = path.join(botHomeOf(bots, BOT), 'work', 'sweeper');
  const { file, folder } = await scratchTask(box, TASK);
  await made(box, nightly, ['--name', 'sweeper', '--prompt-file', file]);
  const first = await liveTab(box, bots, 'sweeper');
  assertTaskPrompt(await promptOf(box, await lineOf(box, bots, 'sweeper'), 'codex'), TASK, workDir, 'at the make');

  await emptied(folder);
  await tabGone(box, first);
  await upAgain(box, 'sweeper');

  assertTaskPrompt(await promptOf(box, await lineOf(box, bots, 'sweeper'), 'codex'), TASK, workDir, 'brought up again');
});

test('PL2 the task is the text the file held at the make: the file written again later does not change it', async (t) => {
  // The make reads the file once. A maker that reuses the same scratch file
  // for its next task does not give that task to this session.
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box, { roles: false });
  const workDir = path.join(botHomeOf(bots, BOT), 'work', 'scout');
  const { file } = await scratchTask(box, TASK);
  await made(box, planner, ['--name', 'scout', '--prompt-file', file]);
  const first = await liveTab(box, bots, 'scout');

  const later = 'Some other task, for the next session the maker makes.';
  await writeFile(file, `${later}\n`);
  await tabGone(box, first);
  await upAgain(box, 'scout');

  const prompt = await promptOf(box, await lineOf(box, bots, 'scout'), 'claude');
  assertTaskPrompt(prompt, TASK, workDir, 'brought up again');
  assert.ok(!prompt.includes(later), `the file's later text is not the task, got: ${JSON.stringify(prompt)}`);
});

// --------------------------------- the task outlives its file: clear, compact

for (const [label, next] of [
  ['a /clear', { session: 'sess-scout-2', source: 'clear' }],
  ['a compaction', { session: 'sess-scout-1', source: 'compact' }],
]) {
  test(`PL3 after ${label}, the hook gives a Claude Code temporary session its whole task again, its file gone`, async (t) => {
    const box = await createSandbox(t);
    const { bots, planner } = await fleet(box, { roles: false });
    const { file, folder } = await scratchTask(box, TASK);
    await made(box, planner, ['--name', 'scout', '--prompt-file', file]);
    const scout = await liveTab(box, bots, 'scout');
    // The start prompt the session was launched with: what the hook gives back.
    const launched = await promptOf(box, await lineOf(box, bots, 'scout'), 'claude');
    assertTaskPrompt(launched, TASK, path.join(botHomeOf(bots, BOT), 'work', 'scout'), 'at the make');
    const started = await recordSession(box, { bots, bot: BOT, tab: scout.tabId, session: 'sess-scout-1', source: 'startup' });
    assert.equal(started.code, 0, started.stderr);
    assert.equal((await sessionIn(bots, BOT, 'scout'))?.session, 'sess-scout-1', 'the book holds scout\'s conversation, or this proves nothing');
    assert.notEqual(contextOf(started), undefined, `the hook answers for scout's tab at its start, or this proves nothing:\n${started.stdout}${started.stderr}`);

    await emptied(folder);
    const ran = await recordSession(box, { bots, bot: BOT, tab: scout.tabId, ...next });

    assert.equal(
      contextOf(ran),
      hookContext(launched, await mainUnitsText(bots, BOT)),
      `after ${label}, the start prompt it was launched with, whole, then the main units:\n${ran.stdout}${ran.stderr}`,
    );
  });
}

// ------------------------------------- a role's prompt file is read at launch

test('PL4 a role\'s prompt file is read at each launch: changed after the make, the next fresh launch carries the changed text', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);
  const home = botHomeOf(bots, BOT);
  await made(box, planner, ['--role', 'reviewer', '--name', 'reviewer-1']);
  const first = await liveTab(box, bots, 'reviewer-1');
  const before = await promptOf(box, await lineOf(box, bots, 'reviewer-1'), 'codex');
  assert.ok(before.startsWith(REVIEW_DUTY), `the premise: the role's text is the start prompt at the make, got: ${JSON.stringify(before)}`);

  const changed = 'You review one pull request and check its tests first.';
  await writeFile(path.join(home, 'reviewer.md'), `${changed}\n`);
  await tabGone(box, first);
  await upAgain(box, 'reviewer-1');

  const prompt = await promptOf(box, await lineOf(box, bots, 'reviewer-1'), 'codex');
  assertTaskPrompt(prompt, changed, path.join(home, 'work', 'reviewer-1'), 'brought up again');
  assert.ok(!prompt.includes(REVIEW_DUTY), `the role's old text is gone, got: ${JSON.stringify(prompt)}`);
});
