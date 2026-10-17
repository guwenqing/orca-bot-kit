// `obk groom --on --run-on codex`: each Codex run carries the grooming
// session's own start prompt (#566, on #238's runs, PRD 6.8).
//
// The grooming session can carry standing duties in its own prompt, such as
// "count the approvals that held a bot up". With `--run-on codex` the session
// does not do the grooming itself: each fire makes a temporary Codex session
// with `--prompt-file <the run's task>`, and that task held only the kit's own
// grooming text, so those duties were dropped without a word. Here the run's
// task carries the session's prompt as the user wrote it:
//
//   R1. the task file holds the grooming session's own start prompt, word for
//       word (its newlines and inner spacing kept; only its ends may be
//       trimmed, as the kit trims every start prompt): the `prompt` in Bot
//       Father's bot.yaml, or the text of the file its `prompt_file` names;
//   R2. it still holds all that #238 gave it (test C3 in
//       groom-codex-runs.test.js);
//   R3. it does not carry the work-dir note the kit adds to the session's own
//       launch ("Your work dir is ..."): the run has its own work dir;
//   R4. a session with no prompt gets a task with no part about one, as before;
//   R5. a move of a Codex job (`--at` with no `--run-on`) writes the task again,
//       from the prompt as bot.yaml has it then, so a `session change
//       --prompt` reaches the runs at the next `--on`;
//   R6. a `prompt_file` that cannot be read refuses the `--on`, names the file,
//       and types nothing into the grooming tab.
//
// Without `--run-on` nothing changes (R7): test C4 in groom-codex-runs.test.js
// covers that line.
//
// The interface these tests read is #238's (see groom-codex-runs.test.js): the
// typed `--on` line, the job's prompt after `Prompt: `, the one `temp make` in
// it by the kit's own path, and the file its `--prompt-file` names, resolved
// against Bot Father's home as the kit resolves a prompt file. The session's
// prompt is set only through the kit's own `session add` and `session change`.
//
// Every run is in the sandbox (helpers/cli.js): its own HOME, a fake Orca, and
// fake harnesses. Nothing here reaches the real Orca, a real harness, or
// anything outside the sandbox.

import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  botHomeOf,
  createSandbox,
  promptFileOf,
  recordSession,
  sentInto,
  sessionIn,
  spellingsOf,
} from './helpers/cli.js';
import { addSession } from './helpers/permissions.js';
import { commandsIn, flagValue } from './helpers/typed-command.js';

// ------------------------------------------------------------------ the prompts

/**
 * A grooming session's own prompt, with words found nowhere else, two blank
 * lines' worth of newlines, double spaces, an indented line, a dollar and a
 * single quote: a prompt that was flattened, re-wrapped or shell-expanded on
 * its way into the task does not match it.
 */
const PROMPT = [
  'Standing duties of the quokka-566 grooming:',
  '',
  '1. Count the approvals that held a bot up.  Name each bot, and the hours lost.',
  '2. Report temporary sessions left behind  (zebra-ledger-566).',
  '      Keep this indented line as it is: $HOME stays, it\'s plain.',
  '',
  'End with the word marmalade-566.',
].join('\n');

/** Another prompt, for a change: none of PROMPT's distinctive words. */
const NEW_PROMPT = [
  'Changed duties of the pelican-566 grooming:',
  '',
  '-  Check every bot\'s mailbox for mail older than a day.   Say which.',
  '   - and list each paused session (heron-ledger-566).',
].join('\n');

/** A prompt kept in a file in Bot Father's home, as `--prompt-file` names it. */
const FILE_PROMPT = [
  'Duties from the file, walrus-566:',
  '',
  '  * count the approvals that held a bot up;',
  '  * report temporary sessions left behind.    Both, every night.',
].join('\n');
const PROMPT_FILE = 'prompts/grooming-duties-566.md';

/** The note the kit adds to a session's own launch prompt when it has a work dir. */
const WORK_DIR_NOTE = 'Your work dir is';

const CONV = '0199b2c0-0566-4444-8888-cccccccccccc';

// ------------------------------------------------------------------ the fleet

/**
 * A bots folder with Bot Father on Claude Code and its `grooming` session,
 * added with `settings`, brought up, and holding a conversation its hook
 * reported. `before` runs after init and before the session is added, for a
 * file the session's settings name.
 */
async function fleet(box, settings = [], before = async () => {}) {
  const init = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(init.code, 0, init.stderr);
  const bots = box.path('bots');
  await before(bots);
  const added = await addSession(box, { bot: 'bot-father', name: 'grooming', settings });
  assert.equal(added.code, 0, added.stderr);
  const brought = await box.run(['up', '--bots', 'bots']);
  assert.equal(brought.code, 0, brought.stderr);
  const tab = (await sessionIn(bots, 'bot-father', 'grooming')).tab;
  const told = await recordSession(box, { bots, bot: 'bot-father', tab, session: CONV, source: 'startup' });
  assert.equal(told.code, 0, told.stderr);
  return bots;
}

/** Write the prompt file the grooming session is to name, in Bot Father's home. */
const writePromptFile = (text) => async (bots) => {
  const file = path.join(botHomeOf(bots), PROMPT_FILE);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
};

/** Bot Father's home, as the file system knows it. */
const fatherOf = (bots) => realpath(botHomeOf(bots));

/** `obk session change` of the grooming session: exit 0. */
async function changeGrooming(box, ...flags) {
  const changed = await box.run(['session', 'change', '--bots', 'bots', '--bot', 'bot-father', '--session', 'grooming', ...flags]);
  assert.equal(changed.code, 0, `session change ${flags.join(' ')} should go through: ${changed.stdout}${changed.stderr}`);
}

// ------------------------------------------------------------------ what was typed

/** Every `terminal send` so far into every tab Orca has, by tab id. */
async function sendsByTab(box) {
  return Object.fromEntries((await box.orca.terminals()).map((terminal) => [terminal.tabId, sentInto(terminal)]));
}

/** What has been sent since `before`, by tab id, for the tabs that got anything. */
async function sentSince(box, before) {
  const sent = {};
  for (const [tab, sends] of Object.entries(await sendsByTab(box))) {
    const since = sends.slice((before[tab] ?? []).length);
    if (since.length > 0) sent[tab] = since;
  }
  return sent;
}

/** The one line typed since `before`: one send, into the grooming tab, sent off with return. */
async function theLineTyped(box, bots, before) {
  const sent = await sentSince(box, before);
  const tab = (await sessionIn(bots, 'bot-father', 'grooming'))?.tab;
  assert.deepEqual(Object.keys(sent), [tab], `one tab typed into, the grooming session's; got: ${JSON.stringify(sent)}`);
  assert.equal(sent[tab].length, 1, `exactly one line, got: ${JSON.stringify(sent[tab])}`);
  assert.equal(sent[tab][0].enter, true, 'sent off with return');
  return sent[tab][0].text;
}

/** The job's prompt in an `--on` line: everything after `Prompt: `. */
function jobIn(line) {
  const at = line.indexOf('Prompt: ');
  assert.ok(at >= 0, `the --on line should hand the session the job's prompt after "Prompt: ", got: ${line}`);
  return line.slice(at + 'Prompt: '.length);
}

/** `obk groom --bots bots <flags> --json`: exit 0, and the answer. */
async function groom(box, ...flags) {
  const result = await box.run(['groom', '--bots', 'bots', ...flags, '--json']);
  assert.equal(result.code, 0, `groom ${flags.join(' ')} should have answered: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

/** Turn a Codex job on at 04:00 and give back the job's prompt the kit typed. */
async function codexJob(box, bots) {
  const before = await sendsByTab(box);
  const answer = await groom(box, '--on', '--at', '04:00', '--run-on', 'codex', '--model', 'gpt-6-sol', '--effort', 'low');
  assert.equal(answer.groom.asked, 'on');
  return jobIn(await theLineTyped(box, bots, before));
}

/** A refusal: a non-zero exit, a sentence on stderr, and no crash. */
function assertRefused(result, what) {
  assert.equal(typeof result.code, 'number', `${what}: it should exit, not be killed`);
  assert.notEqual(result.code, 0, `${what} should have been refused, got:\n${result.stdout}${result.stderr}`);
  assert.notEqual(result.stderr.trim(), '', `${what}: a refusal says why, on stderr`);
  assert.ok(!/^\s+at /m.test(result.stderr), `${what}: expected a message, got a crash:\n${result.stderr}`);
}

// ------------------------------------------------------------------ the run's task

/** The one `temp make` in a job, by the running kit. */
function theMake(box, job) {
  const makes = commandsIn(job, spellingsOf(box.cli), 'temp make');
  assert.equal(makes.length, 1, `the job should name one temp make, by the kit's own path ${box.cli}, got ${makes.length}: ${job}`);
  return makes[0];
}

/** The text of the file the job's make gives as the run's task, read against Bot Father's home as the kit reads a prompt file. */
async function taskOf(box, bots, job) {
  const given = flagValue(theMake(box, job).words, '--prompt-file');
  assert.equal(typeof given, 'string', `the make should give the run's task with --prompt-file, got: ${job}`);
  const file = path.resolve(await fatherOf(bots), given);
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    return assert.fail(`the run's task should be a file the kit wrote when it typed the line, ${file}: ${error.message}`);
  }
}

/** What #238 gave the task, all of which it keeps (test C3 in groom-codex-runs.test.js). */
async function assertGroomingTask(box, bots, task) {
  assert.ok(task.includes('obk-grooming'), `it names the obk-grooming skill: ${task}`);
  assert.ok(task.includes(await realpath(bots)), `and this bots folder: ${task}`);
  assert.ok(spellingsOf(box.cli).some((word) => task.includes(word)), `and the kit by its own path, ${box.cli}: ${task}`);
  assert.ok(task.includes('message send'), `the report goes by the kit's mail: ${task}`);
  assert.ok(task.includes('bot-father/grooming'), `to the grooming session: ${task}`);
  assert.ok(!task.includes('CronCreate'), `and the run schedules nothing, the schedule being the grooming session's: ${task}`);
}

/** The prompt, word for word, in the task: said with where it is missing or bent. */
function assertCarries(task, prompt, what) {
  assert.ok(
    task.includes(prompt),
    `the run's task should hold ${what}, word for word with its newlines and spacing:\n--- the prompt\n${prompt}\n--- the task\n${task}`,
  );
}

// ------------------------------------------------------------------ an existing Codex job, for a move

let tools = 0;
const toolId = () => `toolu_01${String(++tools).padStart(8, '0')}`;

/** A job made, in Claude Code's own lines: the CronCreate call, and its answer at `at`. */
function created({ id, cron, prompt, at }) {
  const tool = toolId();
  return [
    { type: 'assistant', message: { role: 'assistant', model: 'claude-sonnet-5', content: [{ type: 'tool_use', id: tool, name: 'CronCreate', input: { cron, prompt, recurring: true } }] }, timestamp: at },
    {
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tool, content: `Scheduled recurring job ${id} (${cron}).` }] },
      toolUseResult: { id, humanSchedule: cron, recurring: true, durable: false },
      timestamp: at,
    },
  ];
}

/** Write the grooming conversation's transcript where Claude Code keeps it. */
async function transcriptOf(box, bots, lines) {
  const home = await fatherOf(bots);
  const file = path.join(box.home, '.claude', 'projects', home.replaceAll(/[^A-Za-z0-9]/g, '-'), `${CONV}.jsonl`);
  await mkdir(path.dirname(file), { recursive: true });
  const all = [{ type: 'system', timestamp: new Date(Date.now() - 86400000).toISOString() }, ...lines.flat()];
  await writeFile(file, `${all.map((line) => JSON.stringify({ cwd: home, sessionId: CONV, ...line })).join('\n')}\n`);
}

/** The session made the Codex job the kit typed: it is in its transcript, made an hour ago. */
async function codexJobMade(box, bots, id) {
  const job = await codexJob(box, bots);
  await transcriptOf(box, bots, created({ id, cron: '0 4 * * *', prompt: job, at: new Date(Date.now() - 3600000).toISOString() }));
}

/** Move the job to 06:30, with no --run-on, and give back the job's prompt the kit typed. */
async function moveJob(box, bots) {
  const before = await sendsByTab(box);
  const answer = await groom(box, '--at', '06:30');
  assert.equal(answer.groom.asked, 'on', 'a move is typed as an --on');
  const line = await theLineTyped(box, bots, before);
  assert.match(line, /(?:^|[^0-9])30 6 \* \* \*(?![0-9])/, `at the new time, 06:30: ${line}`);
  return jobIn(line);
}

// ================================================================== R1, R2: the session's prompt is in the run's task

test('R1 the run\'s task holds the grooming session\'s --prompt word for word, newlines and double spaces kept', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box, ['--prompt', PROMPT]);

  const task = await taskOf(box, bots, await codexJob(box, bots));

  assertCarries(task, PROMPT, 'the grooming session\'s prompt from bot.yaml');
});

test('R1 the run\'s task holds the text of the grooming session\'s --prompt-file word for word, its ends trimmed at most', async (t) => {
  const box = await createSandbox(t);
  // The file ends with a newline, as a file usually does; the kit may trim it.
  const bots = await fleet(box, ['--prompt-file', PROMPT_FILE], writePromptFile(`${FILE_PROMPT}\n`));

  const task = await taskOf(box, bots, await codexJob(box, bots));

  assertCarries(task, FILE_PROMPT, `the text of the grooming session's prompt file, ${PROMPT_FILE}`);
  assert.ok(!task.includes(PROMPT_FILE), `the text itself, not a pointer to the file the run may not read: ${task}`);
});

test('R2 a task that carries the session\'s prompt still holds all #238 gave it: obk-grooming, the folder, the kit, the report by mail to bot-father/grooming, no CronCreate', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box, ['--prompt', PROMPT]);

  const task = await taskOf(box, bots, await codexJob(box, bots));

  await assertGroomingTask(box, bots, task);
  assertCarries(task, PROMPT, 'the grooming session\'s prompt beside it');
});

// ================================================================== R3: not the work-dir note

test('R3 the run\'s task carries the session\'s prompt but not the work-dir note the kit adds to the session\'s own launch', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box, ['--prompt', PROMPT, '--work-dir', 'work/grooming']);
  const workDir = path.join(await fatherOf(bots), 'work', 'grooming');

  // The session's own start prompt has the note: so the note is there to leak.
  const own = await readFile(promptFileOf(bots, 'bot-father', 'grooming'), 'utf8');
  assert.ok(own.includes(WORK_DIR_NOTE), `the grooming session's own start prompt names its work dir, as the kit adds it: ${own}`);

  const task = await taskOf(box, bots, await codexJob(box, bots));

  assertCarries(task, PROMPT, 'the grooming session\'s prompt');
  assert.ok(!task.includes(WORK_DIR_NOTE), `but not the session's work-dir note: the run has its own work dir: ${task}`);
  assert.ok(!task.includes(workDir), `nor the session's work dir, ${workDir}: ${task}`);
});

// ================================================================== R4: no prompt, no part about one

test('R4 a grooming session with no prompt gets #238\'s task, with no part about a session prompt', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);

  const task = await taskOf(box, bots, await codexJob(box, bots));

  await assertGroomingTask(box, bots, task);
  assert.ok(!/prompt/i.test(task), `no part about a session prompt: ${task}`);
});

test('R4 a prompt taken off the grooming session leaves the task it got before it had one', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const without = await taskOf(box, bots, await codexJob(box, bots));

  // Given a prompt, the task carries it; taken off again, the task is as it was.
  await changeGrooming(box, '--prompt', PROMPT);
  const withPrompt = await taskOf(box, bots, await codexJob(box, bots));
  assertCarries(withPrompt, PROMPT, 'the prompt once it is given');
  await changeGrooming(box, '--prompt=');
  const again = await taskOf(box, bots, await codexJob(box, bots));
  assert.equal(again, without, 'with the prompt taken off, the task is the one a session with no prompt gets');
});

// ================================================================== R5: a move takes the prompt as bot.yaml has it then

test('R5 a move of a Codex job writes the task again, with the prompt a session change gave the session since', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box, ['--prompt', PROMPT]);
  await codexJobMade(box, bots, 'c0de0566');

  await changeGrooming(box, '--prompt', NEW_PROMPT);
  const task = await taskOf(box, bots, await moveJob(box, bots));

  assertCarries(task, NEW_PROMPT, 'the session\'s prompt as bot.yaml has it at the move');
  assert.ok(!task.includes('quokka-566') && !task.includes('marmalade-566'), `and nothing of the prompt it had before: ${task}`);
  await assertGroomingTask(box, bots, task);
});

test('R5 a move of a Codex job takes a prompt the session was given only after the job was made', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await codexJobMade(box, bots, 'c0de0567');

  await changeGrooming(box, '--prompt', PROMPT);
  const task = await taskOf(box, bots, await moveJob(box, bots));

  assertCarries(task, PROMPT, 'the prompt the session has now');
});

test('R5 an --on reads the prompt file as it is then: an edit to the file reaches the next run\'s task', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box, ['--prompt-file', PROMPT_FILE], writePromptFile(`${FILE_PROMPT}\n`));
  assertCarries(await taskOf(box, bots, await codexJob(box, bots)), FILE_PROMPT, 'the file\'s first text');

  await writePromptFile(`${NEW_PROMPT}\n`)(bots);
  const task = await taskOf(box, bots, await codexJob(box, bots));

  assertCarries(task, NEW_PROMPT, 'the file\'s text at the second --on');
  assert.ok(!task.includes('walrus-566'), `and not the text it had before: ${task}`);
});

// ================================================================== R6: a prompt file that cannot be read

test('R6 --on --run-on codex with a prompt file that cannot be read is refused, names the file, and types nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box, ['--prompt-file', PROMPT_FILE], writePromptFile(`${FILE_PROMPT}\n`));
  // The kit's session add and up want the file there, so it goes after up.
  await rm(path.join(botHomeOf(bots), PROMPT_FILE));
  const before = await sendsByTab(box);

  const result = await box.run(['groom', '--bots', 'bots', '--on', '--at', '04:00', '--run-on', 'codex']);

  assertRefused(result, '--on --run-on codex with the prompt file gone');
  assert.ok(result.stderr.includes(path.basename(PROMPT_FILE)), `the refusal names the file, ${PROMPT_FILE}: ${result.stderr}`);
  assert.deepEqual(await sentSince(box, before), {}, 'nothing typed into any tab');
});

test('R6 a move of a Codex job whose session\'s prompt file cannot be read is refused, names the file, and types nothing', async (t) => {
  // A move writes the run's task again (R5), so it meets the same file.
  const box = await createSandbox(t);
  const bots = await fleet(box, ['--prompt-file', PROMPT_FILE], writePromptFile(`${FILE_PROMPT}\n`));
  await codexJobMade(box, bots, 'c0de0568');
  await rm(path.join(botHomeOf(bots), PROMPT_FILE));
  const before = await sendsByTab(box);

  const result = await box.run(['groom', '--bots', 'bots', '--at', '06:30']);

  assertRefused(result, 'a move with the prompt file gone');
  assert.ok(result.stderr.includes(path.basename(PROMPT_FILE)), `the refusal names the file, ${PROMPT_FILE}: ${result.stderr}`);
  assert.deepEqual(await sentSince(box, before), {}, 'nothing typed into any tab');
});
