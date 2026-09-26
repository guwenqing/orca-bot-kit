// `obk groom --bots <path> [--at <HH:MM>] [--on | --off] [--now] [--compact] [--json]`:
// Bot Father's daily grooming, on Claude Code's own schedule (#237, PRD 6.8).
//
// The owner's decision of 2026-09-24: scheduled work does not use an Orca
// automation, because an automation cannot carry a model or an effort of its
// own. A Bot Father on Claude Code grooms on Claude Code's scheduler
// (`CronCreate`), inside a session in the book called `grooming`, whose launch
// line carries the model and effort chosen for it. The kit never makes, starts
// or closes that session; the user adds it like any other and brings it up.
//
// So the kit schedules nothing itself. It reads what is scheduled out of the
// grooming session's conversation, and when asked it types one line into the
// grooming tab asking the session to schedule, unschedule, run once, or
// compact. Four things decide almost every test here:
//
//   1. **A job lives in the Claude Code process, and only while its tab is
//      up.** Seen live (run 3, Claude Code 2.1.283): after `/clear` in the
//      grooming tab, CronList in the new conversation still answered the job
//      made before it. So the grooming jobs are the ones made in the
//      conversations that process has had: the one the book holds now, and
//      going back through its history each one that ended by `clear`,
//      stopping after the first whose transcript shows the process began
//      there (a SessionStart `startup` or `resume`). A conversation from
//      before a restart, a restore or a fresh start does not count.
//   2. **A recurring job ends 7 days after it was made** (604800000 ms, Claude
//      Code 2.1.282). One is alive from the answer to its CronCreate until a
//      later successful CronDelete of its id or those 7 days, whichever comes
//      first. Each run renews its own.
//   3. **What the kit types goes into a tab a person may be looking at.** It
//      types only into the grooming session's own tab, only with Claude Code in
//      front of it and nothing on screen waiting for an answer, and then
//      exactly one line, or nothing at all.
//   4. **No Orca automation, of any kind.** `obk groom` creates, edits and
//      removes none, whatever Orca holds. That includes the one an earlier kit
//      made, `obk grooming` in Bot Father's folder: the owner, 2026-09-25, "No
//      need to support cleaning up old way, this is only used by me." So the
//      kit does not look for it, report it, remove it or refuse on it.
//
// With no flag beyond `--bots` it only says what there is, and changes nothing.
//
// The transcripts written here are in Claude Code's own lines, as the brief for
// #237 records them from Claude Code 2.1.282: the CronCreate call as an
// assistant `tool_use`, its answer as a user `tool_result` line whose
// `toolUseResult` carries the job's id, a failure as `is_error: true` with a
// string for `toolUseResult`. What the tool says in words is abbreviated here.

import assert from 'node:assert/strict';
import { mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  assertOrcaCallsAllowed,
  botHomeOf,
  createSandbox,
  orcaCommand,
  recordSession,
  sentInto,
  sessionIn,
  skipGit,
  snapshot,
  spellingsOf,
} from './helpers/cli.js';

// ------------------------------------------------------------------ time

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** How long Claude Code keeps a recurring job after it was made: `recurringMaxAgeMs`. */
const WEEK = 604800000;

/** A moment `ms` before now, as Claude Code stamps its lines. */
const ago = (ms) => new Date(Date.now() - ms).toISOString();
/** A moment `ms` after another one. */
const after = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();

// ------------------------------------------------------------------ the fleet

/** Conversation ids in the shape Claude Code gives them. */
const CONV = '0199b2c0-0001-4444-8888-cccccccccccc';
const OLD_CONV = '0199b2c0-0002-4444-8888-cccccccccccc';
const STRAY_CONV = '0199b2c0-0003-4444-8888-cccccccccccc';
const OLDER_CONV = '0199b2c0-0004-4444-8888-cccccccccccc';
const OLDEST_CONV = '0199b2c0-0005-4444-8888-cccccccccccc';

/**
 * A bots folder with Bot Father on `father`, and a session of Bot Father's
 * called `grooming`, added the way a user adds one: on its own `harness` when
 * given, on Bot Father's otherwise. With `up` it is brought up, and with a
 * `conversation` its harness has reported that conversation through the kit's
 * hook, so the book holds it.
 */
async function fleet(box, { father = 'claude', harness, up = true, conversation = CONV } = {}) {
  const init = await box.run(['init', '--bots', 'bots', '--harness', father]);
  assert.equal(init.code, 0, init.stderr);
  const added = await box.run([
    'session', 'add', '--bots', 'bots', '--bot', 'bot-father', '--name', 'grooming',
    ...(harness === undefined ? [] : ['--harness', harness]),
  ]);
  assert.equal(added.code, 0, added.stderr);
  const bots = box.path('bots');
  if (!up) return bots;

  const brought = await box.run(['up', '--bots', 'bots']);
  assert.equal(brought.code, 0, brought.stderr);
  if (conversation !== null) await reports(box, bots, conversation);
  return bots;
}

/** The grooming session's harness reports `conversation` through the kit's hook, as a clear or a start does. */
async function reports(box, bots, conversation, source = 'startup') {
  const tab = (await sessionIn(bots, 'bot-father', 'grooming')).tab;
  const told = await recordSession(box, { bots, bot: 'bot-father', tab, session: conversation, source });
  assert.equal(told.code, 0, told.stderr);
  assert.equal(
    (await sessionIn(bots, 'bot-father', 'grooming'))?.session,
    conversation,
    'the book should hold the conversation the hook reported',
  );
}

/** The tab the book holds for the grooming session. */
const groomingTab = async (bots) => (await sessionIn(bots, 'bot-father', 'grooming'))?.tab;

// ------------------------------------------------------------ the transcript

/** What every grooming job's prompt starts with: the bots folder by its real path. */
const markerOf = (bots) => `obk grooming for ${bots}`;

/** A grooming job's prompt, as the session would have written it. */
const groomingPrompt = (bots) => `${markerOf(bots)}. Groom the fleet with obk-grooming and obk-finops, then renew this job.`;

let tools = 0;
/** A tool call's id, unique across every transcript this file writes. */
const toolId = () => `toolu_01${String(++tools).padStart(8, '0')}`;

/** The session calling a tool: an assistant line holding one `tool_use`. */
const toolCall = (tool, name, input, at) => ({
  type: 'assistant',
  message: { role: 'assistant', model: 'claude-sonnet-5', content: [{ type: 'tool_use', id: tool, name, input }] },
  timestamp: at,
});

/** The tool's answer: a user line holding one `tool_result`, and what Claude Code keeps of it in `toolUseResult`. */
const toolAnswer = (tool, content, toolUseResult, at, error = false) => ({
  type: 'user',
  message: {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: tool, content, ...(error ? { is_error: true } : {}) }],
  },
  toolUseResult,
  timestamp: at,
});

/**
 * What `created` takes as `recurring` for a call that leaves the key out, which
 * Claude Code takes as recurring. Not `undefined`: a default parameter replaces
 * that with the default, and the call would say `recurring: true` after all.
 */
const LEFT_OUT = Symbol('recurring left out');

/**
 * A job made: the CronCreate call three seconds before its answer, and the
 * answer at `at`, which is when the job was made. `recurring: LEFT_OUT` leaves
 * the key out of the call.
 */
function created({ id, cron, prompt, recurring = true, at }) {
  const tool = toolId();
  const input = recurring === LEFT_OUT ? { cron, prompt } : { cron, prompt, recurring };
  const kept = recurring !== false;
  return [
    toolCall(tool, 'CronCreate', input, after(at, -3000)),
    toolAnswer(
      tool,
      `Scheduled ${kept ? 'recurring' : 'one-shot'} job ${id} (${cron}).`,
      { id, humanSchedule: cron, recurring: kept, durable: false },
      at,
    ),
  ];
}

/** A CronCreate that failed: no job, and a string where the job would be. */
function failedCreate({ cron, prompt, at }) {
  const tool = toolId();
  return [
    toolCall(tool, 'CronCreate', { cron, prompt, recurring: true }, after(at, -3000)),
    toolAnswer(tool, 'Error: the scheduler would not take the job', 'Error: the scheduler would not take the job', at, true),
  ];
}

/** A CronCreate the session called and never got an answer to: it was stopped mid-call. */
const unanswered = ({ cron, prompt, at }) => [toolCall(toolId(), 'CronCreate', { cron, prompt, recurring: true }, at)];

/** A job deleted by its id. */
function deleted(id, at) {
  const tool = toolId();
  return [
    toolCall(tool, 'CronDelete', { id }, after(at, -2000)),
    toolAnswer(tool, `Cancelled job ${id}.`, { id }, at),
  ];
}

/** A CronDelete that failed: the job it named is still there. */
function failedDelete(id, at) {
  const tool = toolId();
  return [
    toolCall(tool, 'CronDelete', { id }, after(at, -2000)),
    toolAnswer(tool, `Error: could not cancel ${id}`, `Error: could not cancel ${id}`, at, true),
  ];
}

/** A turn somebody typed, as plain text. */
const said = (text, at) => ({ type: 'user', message: { role: 'user', content: text }, timestamp: at });

/** A turn the session answered in words. */
const replied = (text, at) => ({
  type: 'assistant',
  message: { role: 'assistant', model: 'claude-sonnet-5', content: [{ type: 'text', text }] },
  timestamp: at,
});

/**
 * Write `conversation`'s transcript where Claude Code keeps it: under the
 * sandbox's home, in `.claude/projects/<slug>/<id>.jsonl`, the slug being Bot
 * Father's real home with every character that is not a letter or a digit
 * turned into `-`. One JSON object per line, in the order given.
 */
async function transcriptOf(box, bots, conversation, lines) {
  const home = await realpath(botHomeOf(bots));
  const file = path.join(box.home, '.claude', 'projects', home.replaceAll(/[^A-Za-z0-9]/g, '-'), `${conversation}.jsonl`);
  await mkdir(path.dirname(file), { recursive: true });
  const all = [{ type: 'system', timestamp: ago(30 * DAY) }, ...lines.flat()];
  await writeFile(file, `${all
    .map((line) => JSON.stringify({ parentUuid: null, isSidechain: false, userType: 'external', cwd: home, sessionId: conversation, ...line }))
    .join('\n')}\n`);
  return file;
}

// ------------------------------------------------------------ automations in Orca

/**
 * An Orca automation, beside whatever Orca has. By default the one an earlier
 * kit made: named exactly `obk grooming`, in Bot Father's folder, daily at
 * 04:00, on. `name` or `folder` other than those make one of the user's own.
 * The kit leaves every one of them alone.
 */
async function automation(box, bots, { id = 'auto_old', name = 'obk grooming', folder = botHomeOf(bots), enabled = true } = {}) {
  const setup = (await box.orca.setups()).find((one) => one.path === folder);
  const made = {
    id,
    name,
    enabled,
    rrule: 'FREQ=DAILY;BYHOUR=4;BYMINUTE=0',
    provider: 'claude',
    prompt: 'Groom the fleet.',
    runContext: { path: folder, projectId: setup?.projectId ?? 'proj_elsewhere', projectHostSetupId: setup?.id ?? 'repo_elsewhere' },
  };
  await box.orca.set({ automations: [...await automationsIn(box), made] });
  return made;
}

/** Every automation Orca has now. */
const automationsIn = async (box) => (await box.orca.state()).automations ?? [];

/** How many Orca calls have been made, as a mark to count from. */
const mark = async (box) => (await box.orca.calls()).length;

/** Every call since `from` that makes, changes or removes an automation. */
const automationWritesSince = async (box, from) => (await box.orca.calls())
  .slice(from)
  .filter((call) => ['automations create', 'automations edit', 'automations remove'].includes(orcaCommand(call)));

// ------------------------------------------------------------ running it

/** `obk groom --bots <folder> <flags> --json`: exit 0, and one JSON document. */
async function groomIn(box, folder, ...flags) {
  const result = await box.run(['groom', '--bots', folder, ...flags, '--json']);
  assert.equal(result.code, 0, `groom ${flags.join(' ')} should have answered: ${result.stderr}`);
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  assert.ok(
    answer.groom !== null && typeof answer.groom === 'object',
    `the answer should say what the grooming is, got: ${result.stdout}`,
  );
  return answer;
}

/** The same, against the bots folder most tests here have. */
const groom = (box, ...flags) => groomIn(box, 'bots', ...flags);

/** The plain report, or a refusal: `obk groom --bots bots <flags>` without --json. */
const run = (box, ...flags) => box.run(['groom', '--bots', 'bots', ...flags]);

/** The fields the interface names, and only those, so a field added beside them does not matter. */
const pick = (object, keys) => Object.fromEntries(keys.map((key) => [key, object?.[key]]));

const sessionOf = (answer) => (answer.groom.session === null
  ? null
  : pick(answer.groom.session, ['name', 'harness', 'up', 'conversation']));

function jobsOf(answer) {
  assert.ok(Array.isArray(answer.groom.jobs), `jobs should be a list, got: ${JSON.stringify(answer.groom)}`);
  return answer.groom.jobs.map((job) => pick(job, ['id', 'at', 'cron', 'made', 'expires']));
}

const idsOf = (answer) => jobsOf(answer).map((job) => job.id);

/** One grooming job as the answer should give it: its end worked out from the requirement, made + 7 days. */
const job = (id, at, cron, made) => ({ id, at, cron, made, expires: after(made, WEEK) });

/**
 * A refusal: a non-zero exit, a sentence on stderr, and no crash (an uncaught
 * exception also exits non-zero with text on stderr, so the stack frames are
 * what tells the two apart).
 */
function assertRefused(result, what) {
  assert.equal(typeof result.code, 'number', `${what}: it should exit, not be killed`);
  assert.notEqual(result.code, 0, `${what} should have been refused, got:\n${result.stdout}${result.stderr}`);
  assert.notEqual(result.stderr.trim(), '', `${what}: a refusal says why, on stderr`);
  assert.ok(!/^\s+at /m.test(result.stderr), `${what}: expected a message, got a crash:\n${result.stderr}`);
}

// ------------------------------------------------------------ what was typed

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

/** Nothing sent into any tab since `before`. */
async function assertNothingTyped(box, before, what) {
  assert.deepEqual(await sentSince(box, before), {}, `${what}: nothing should be typed into any tab`);
}

/**
 * The one line typed since `before`: exactly one `terminal send`, into the
 * grooming session's own tab, sent off with return, and nothing anywhere else.
 */
async function theLineTyped(box, bots, before) {
  const sent = await sentSince(box, before);
  const tab = await groomingTab(bots);
  assert.deepEqual(Object.keys(sent), [tab], `one tab typed into, the grooming session's; got: ${JSON.stringify(sent)}`);
  assert.equal(sent[tab].length, 1, `exactly one line, got: ${JSON.stringify(sent[tab])}`);
  assert.equal(sent[tab][0].enter, true, 'sent off with return');
  return sent[tab][0].text;
}

/** A cron in a line, standing as itself: not the tail of a longer number, not the head of one. */
function assertCron(line, cron) {
  const escaped = cron.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(line, new RegExp(`(?:^|[^0-9])${escaped}(?![0-9])`), `the line should carry the cron ${cron}, got: ${line}`);
}

/**
 * The line asks the session, when it runs it, to list its jobs and delete
 * every one whose prompt starts with `obk grooming`: CronList, CronDelete and
 * that rule, whatever the kit read from the transcript when it typed. A line
 * waits in the tab until the session gets to it, so by then what the kit read
 * can be stale (review of PR #322).
 */
function assertClearsEveryGroomingJob(line) {
  assert.match(line, /CronList/, `the line should ask the session to call CronList when it runs it, got: ${line}`);
  assert.match(line, /CronDelete/, `and to CronDelete, got: ${line}`);
  assert.ok(line.includes('obk grooming'), `every job whose prompt starts with obk grooming, got: ${line}`);
}

/**
 * The same, asked before the line's CronCreate: the listing, the deleting and
 * the `obk grooming` rule all come ahead of it in the line, so the rule is not
 * only the new job's own marker, which follows it.
 */
function assertClearsBeforeCreating(line) {
  assertClearsEveryGroomingJob(line);
  const create = line.indexOf('CronCreate');
  assert.ok(create >= 0, `the line should ask for a CronCreate, got: ${line}`);
  for (const asked of ['CronList', 'CronDelete', 'obk grooming']) {
    assert.ok(line.indexOf(asked) < create, `${asked} should come before the CronCreate, got: ${line}`);
  }
}

/** The line names the CLI that is running, by its own path, in either spelling. */
function assertNamesCli(box, line) {
  assert.ok(
    spellingsOf(box.cli).some((word) => line.includes(word)),
    `the line should name the CLI that typed it, ${box.cli}, got: ${line}`,
  );
}

/** Put `foreground` in front of the grooming tab alone, for the fake ps (helpers/fake-ps.js). */
async function inFrontOfGrooming(box, bots, foreground) {
  const tab = await groomingTab(bots);
  const terminals = await box.orca.terminals();
  assert.ok(terminals.some((one) => one.tabId === tab), 'the grooming tab should be one Orca has');
  await box.orca.set({ terminals: terminals.map((one) => (one.tabId === tab ? { ...one, foreground } : one)) });
}

/**
 * Every command in `said` that starts with the running CLI (either spelling)
 * and then `rest`, each up to the end of its line.
 */
function commandsIn(said, cli, rest) {
  const found = [];
  for (const line of said.split('\n')) {
    for (const word of spellingsOf(cli)) {
      const at = line.indexOf(`${word} ${rest}`);
      if (at >= 0) found.push(line.slice(at).trim());
    }
  }
  assert.notEqual(found.length, 0, `there should be a command starting ${cli} ${rest}, got:\n${said}`);
  return found;
}

/** The flags that type into the grooming tab, each of which would type a line with a grooming job at 04:00 there. */
const TYPING = [['--on', '--at', '04:00'], ['--on'], ['--at', '06:30'], ['--off'], ['--now'], ['--compact']];

/** A grooming job at 04:00, made a day ago, in the conversation the book holds. */
async function oneJob(box, bots, id = 'a1b2c3d4') {
  const made = ago(DAY);
  await transcriptOf(box, bots, CONV, [created({ id, cron: '0 4 * * *', prompt: groomingPrompt(bots), at: made })]);
  return made;
}

// ================================================================== the report

test('G1 with no grooming session the answer says so: no session, no jobs, nothing asked', async (t) => {
  const box = await createSandbox(t);
  const init = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(init.code, 0, init.stderr);

  const answer = await groom(box);

  assert.equal(answer.groom.session, null, `Bot Father has only its daily session, got: ${JSON.stringify(answer.groom)}`);
  assert.deepEqual(answer.groom.jobs, []);
  assert.equal(answer.groom.asked, null);
});

test('G1 the plain report with no grooming session gives the command that adds one, by the CLI that is running', async (t) => {
  const box = await createSandbox(t);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);

  const result = await run(box);

  assert.equal(result.code, 0, result.stderr);
  const commands = commandsIn(result.stdout, box.cli, 'session add --bots ');
  assert.ok(
    commands.some((command) => command.includes('--bot bot-father') && command.includes('--name grooming')),
    `the command should add Bot Father a session called grooming, got: ${JSON.stringify(commands)}`,
  );
});

test('G2 the grooming session is reported as the book has it: its name, its harness, its tab up, its conversation', async (t) => {
  const box = await createSandbox(t);
  await fleet(box);

  const answer = await groom(box);

  assert.deepEqual(sessionOf(answer), { name: 'grooming', harness: 'claude', up: true, conversation: CONV });
});

test('G2 the grooming session runs on its own harness when it names one, and on Bot Father\'s when it does not', async (t) => {
  for (const [father, own, expected] of [['claude', 'codex', 'codex'], ['codex', undefined, 'codex'], ['codex', 'claude', 'claude']]) {
    const box = await createSandbox(t);
    await fleet(box, { father, harness: own, conversation: null });

    const answer = await groom(box);

    assert.equal(
      answer.groom.session?.harness,
      expected,
      `Bot Father on ${father}, grooming ${own === undefined ? 'naming no harness' : `on ${own}`}: got ${JSON.stringify(answer.groom.session)}`,
    );
  }
});

test('G2 a grooming session never brought up is not up and has no conversation', async (t) => {
  const box = await createSandbox(t);
  await fleet(box, { up: false });

  const answer = await groom(box);

  assert.deepEqual(sessionOf(answer), { name: 'grooming', harness: 'claude', up: false, conversation: null });
});

test('G2 a grooming session whose tab Orca no longer lists is not up, and keeps its conversation', async (t) => {
  // A pause closes the tab and the book keeps both the tab id and the
  // conversation: the tab the book holds is one Orca no longer lists.
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const tab = await groomingTab(bots);
  const paused = await box.run(['pause', '--bots', 'bots', '--bot', 'bot-father', '--session', 'grooming']);
  assert.equal(paused.code, 0, paused.stderr);
  assert.equal((await box.orca.terminals()).some((one) => one.tabId === tab), false, 'the tab should be gone from Orca');

  const answer = await groom(box);

  assert.deepEqual(sessionOf(answer), { name: 'grooming', harness: 'claude', up: false, conversation: CONV });
});

test('G2 the plain report on a Codex grooming session says it has to be a Claude Code one', async (t) => {
  const box = await createSandbox(t);
  await fleet(box, { harness: 'codex', conversation: null });

  const result = await run(box);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Claude Code/, `it should say grooming runs on Claude Code's schedule, got:\n${result.stdout}`);
  assert.ok(result.stdout.includes('--harness claude'), `and how to make it a Claude Code session, got:\n${result.stdout}`);
});

test('G2 the plain report on a grooming session that is not up gives the up command, by the CLI that is running', async (t) => {
  const box = await createSandbox(t);
  await fleet(box, { up: false });

  const result = await run(box);

  assert.equal(result.code, 0, result.stderr);
  commandsIn(result.stdout, box.cli, 'up --bots ');
});

test('G2 the plain report says grooming fires only while its tab is up in Orca, and a missed run is not made up', async (t) => {
  // Substance only: that the report speaks of the tab being up, and of a run
  // that is missed. How it puts it is the kit's.
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await oneJob(box, bots);

  const result = await run(box);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /\bup\b/, `it should say it fires only while its tab is up, got:\n${result.stdout}`);
  assert.match(result.stdout, /\bOrca\b/, `in Orca, got:\n${result.stdout}`);
  assert.match(result.stdout, /miss/i, `and that a run it misses is not made up, got:\n${result.stdout}`);
});

// ------------------------------------------------------------------ the jobs

test('G3 a grooming job in its conversation is reported: id, time, cron, when it was made, and 7 days after that', async (t) => {
  // Made is the answer's time, three seconds after the call's.
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const made = ago(DAY);
  await transcriptOf(box, bots, CONV, [
    said('Turn grooming on for 04:00.', ago(DAY + MINUTE)),
    created({ id: 'a1b2c3d4', cron: '0 4 * * *', prompt: groomingPrompt(bots), at: made }),
    replied('Grooming is scheduled daily at 04:00.', after(made, 1000)),
  ]);

  const answer = await groom(box);

  assert.deepEqual(jobsOf(answer), [job('a1b2c3d4', '04:00', '0 4 * * *', made)]);
  assert.equal(
    Date.parse(answer.groom.jobs[0].expires) - Date.parse(answer.groom.jobs[0].made),
    604800000,
    'it ends exactly 7 days after it was made',
  );
});

test('G3 several grooming jobs are reported oldest first, each one\'s time read back from its cron as HH:MM', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const prompt = groomingPrompt(bots);
  const [first, second, third] = [ago(3 * DAY), ago(2 * DAY), ago(DAY)];
  await transcriptOf(box, bots, CONV, [
    created({ id: 'b0000001', cron: '5 23 * * *', prompt, at: first }),
    created({ id: 'b0000002', cron: '0 0 * * *', prompt, at: second }),
    created({ id: 'b0000003', cron: '59 9 * * *', prompt, at: third }),
  ]);

  const answer = await groom(box);

  assert.deepEqual(jobsOf(answer), [
    job('b0000001', '23:05', '5 23 * * *', first),
    job('b0000002', '00:00', '0 0 * * *', second),
    job('b0000003', '09:59', '59 9 * * *', third),
  ]);
});

test('G3 only a successful recurring CronCreate whose prompt starts with the marker makes a grooming job', async (t) => {
  // Beside two that are grooming jobs (recurring said, and recurring left to
  // its default), everything that looks like one and is not: the request as
  // it was typed, a one-shot, a job of the user's own, a prompt with the marker
  // later on, a CronCreate that failed and one that was never answered.
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const marker = markerOf(bots);
  const prompt = groomingPrompt(bots);
  await transcriptOf(box, bots, CONV, [
    said(`CronCreate a recurring job, cron 0 4 * * *, prompt "${prompt}"`, ago(6 * DAY)),
    created({ id: 'c0000001', cron: '0 4 * * *', prompt, recurring: true, at: ago(5 * DAY) }),
    created({ id: 'c0000002', cron: '0 4 * * *', prompt, recurring: LEFT_OUT, at: ago(4 * DAY) }),
    created({ id: 'c0000003', cron: '0 4 26 9 *', prompt, recurring: false, at: ago(3 * DAY) }),
    created({ id: 'c0000004', cron: '0 9 * * *', prompt: 'Remind me to stretch.', at: ago(3 * DAY) }),
    created({ id: 'c0000005', cron: '0 4 * * *', prompt: `Every morning: ${marker}. Groom the fleet.`, at: ago(2 * DAY) }),
    failedCreate({ cron: '0 4 * * *', prompt, at: ago(DAY) }),
    unanswered({ cron: '0 4 * * *', prompt, at: ago(HOUR) }),
  ]);

  const answer = await groom(box);

  assert.deepEqual(idsOf(answer), ['c0000001', 'c0000002']);
});

test('G3 a grooming job ends at a successful CronDelete of its id or 7 days after it was made; a failed delete ends nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const prompt = groomingPrompt(bots);
  const cron = '0 4 * * *';
  const justUnderAWeek = ago(WEEK - 10 * MINUTE);
  const threeDays = ago(3 * DAY);
  await transcriptOf(box, bots, CONV, [
    created({ id: 'd0000001', cron, prompt, at: ago(WEEK + 10 * MINUTE) }),
    created({ id: 'd0000002', cron, prompt, at: justUnderAWeek }),
    created({ id: 'd0000003', cron, prompt, at: ago(6 * DAY) }),
    deleted('d0000003', ago(5 * DAY)),
    created({ id: 'd0000004', cron, prompt, at: threeDays }),
    failedDelete('d0000004', ago(2 * DAY)),
  ]);

  const answer = await groom(box);

  assert.deepEqual(jobsOf(answer), [
    job('d0000002', '04:00', cron, justUnderAWeek),
    job('d0000004', '04:00', cron, threeDays),
  ], 'd0000001 is past its 7 days and d0000003 was deleted');
});

// Which conversations count. A job lives in the Claude Code process, so the
// grooming jobs are those of every conversation the current process has had:
// the book's current one, then back through its history while each ended by a
// clear, stopping after the first whose transcript shows the process began
// there (a SessionStart `startup` or `resume` marker). The book's history is
// written the way the kit writes it, by the hook (`clear`, `startup`); the
// markers the way the kit's hook leaves them in the transcript. Each
// transcript is written at the point in the session's life where its calls
// happen, stamped with the clock as it is then.

/**
 * What the kit's SessionStart hook leaves in a transcript, seen live on Claude
 * Code 2.1.283: `startup` on a fresh start, `resume` on `--resume`, `clear` in
 * the conversation a /clear began, `compact` after a compact.
 */
const started = (how, at = ago(0)) => ({
  type: 'attachment',
  attachment: { type: 'hook_success', hookEvent: 'SessionStart', hookName: `SessionStart:${how}` },
  timestamp: at,
});

/** A grooming job at 04:00 made now, in the grooming session's words. */
const madeNow = (bots, id) => created({ id, cron: '0 4 * * *', prompt: groomingPrompt(bots), at: ago(0) });

test('G3 a job made before a /clear counts while the conversation after it began by the clear; a stray transcript never counts', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box, { conversation: OLD_CONV });
  await transcriptOf(box, bots, OLD_CONV, [started('startup'), madeNow(bots, 'e0000001')]);
  await transcriptOf(box, bots, STRAY_CONV, [started('startup'), madeNow(bots, 'e0000002')]);
  await reports(box, bots, CONV, 'clear');
  await transcriptOf(box, bots, CONV, [started('clear'), madeNow(bots, 'e0000003')]);

  const answer = await groom(box);

  assert.equal(answer.groom.session?.conversation, CONV);
  assert.deepEqual(idsOf(answer), ['e0000001', 'e0000003'], 'the cleared conversation\'s job and the current one\'s, oldest first');
});

test('G3 once the current conversation shows a resume, a job made before its /clear no longer counts', async (t) => {
  // A restart by the kit, or Orca restoring the tab with a bare --resume,
  // starts a new process in the current conversation: it has that
  // conversation's jobs back, and none of the one before the clear.
  const box = await createSandbox(t);
  const bots = await fleet(box, { conversation: OLD_CONV });
  await transcriptOf(box, bots, OLD_CONV, [started('startup'), madeNow(bots, 'g0000001')]);
  await reports(box, bots, CONV, 'clear');
  const current = [started('clear'), madeNow(bots, 'g0000002')];
  await transcriptOf(box, bots, CONV, current);
  const beforeResume = await groom(box);

  await transcriptOf(box, bots, CONV, [...current, started('resume')]);
  const afterResume = await groom(box);

  assert.deepEqual(idsOf(beforeResume), ['g0000001', 'g0000002'], 'while the process is the one the clear ran in');
  assert.equal(afterResume.groom.session?.conversation, CONV);
  assert.deepEqual(idsOf(afterResume), ['g0000002'], 'after the resume, only the conversation it resumed');
});

test('G3 a job made before a /clear and deleted after it is gone; one made beside it and not deleted is not', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box, { conversation: OLD_CONV });
  await transcriptOf(box, bots, OLD_CONV, [started('startup'), madeNow(bots, 'f0000001'), madeNow(bots, 'f0000002')]);
  await reports(box, bots, CONV, 'clear');
  await transcriptOf(box, bots, CONV, [started('clear'), deleted('f0000001', ago(0))]);

  const answer = await groom(box);

  assert.deepEqual(idsOf(answer), ['f0000002']);
});

test('G3 a chain of /clears counts back to the conversation where the process began, and nothing before it', async (t) => {
  // OLDER was resumed (a restore) and then cleared twice: OLDER, OLD and CONV
  // are one process. OLDEST, cleared into OLDER before that resume, is not.
  // A `clear` or `compact` marker does not stop the walk; a `resume` does.
  const box = await createSandbox(t);
  const bots = await fleet(box, { conversation: OLDEST_CONV });
  await transcriptOf(box, bots, OLDEST_CONV, [started('startup'), madeNow(bots, 'i0000000')]);
  await reports(box, bots, OLDER_CONV, 'clear');
  await transcriptOf(box, bots, OLDER_CONV, [started('clear'), started('resume'), madeNow(bots, 'i0000001')]);
  await reports(box, bots, OLD_CONV, 'clear');
  await transcriptOf(box, bots, OLD_CONV, [started('clear'), madeNow(bots, 'i0000002'), started('compact')]);
  await reports(box, bots, CONV, 'clear');
  await transcriptOf(box, bots, CONV, [started('clear'), madeNow(bots, 'i0000003')]);

  const answer = await groom(box);

  assert.deepEqual(idsOf(answer), ['i0000001', 'i0000002', 'i0000003']);
});

test('G3 a history entry that ended other than by a clear stops the walk, whatever its transcript says', async (t) => {
  // The current transcript carries no start marker of its own here, so only
  // the history's `ended` can stop the walk: OLD ended by a fresh start, and
  // neither it nor OLDER, cleared into it, counts.
  const box = await createSandbox(t);
  const bots = await fleet(box, { conversation: OLDER_CONV });
  await transcriptOf(box, bots, OLDER_CONV, [started('startup'), madeNow(bots, 'h0000001')]);
  await reports(box, bots, OLD_CONV, 'clear');
  await transcriptOf(box, bots, OLD_CONV, [started('clear'), madeNow(bots, 'h0000002')]);
  await reports(box, bots, CONV, 'startup');
  await transcriptOf(box, bots, CONV, [madeNow(bots, 'h0000003')]);

  const answer = await groom(box);

  assert.deepEqual(idsOf(answer), ['h0000003']);
});

test('G3 --on and --off name by id a job made before a /clear in the same process', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box, { conversation: OLD_CONV });
  await transcriptOf(box, bots, OLD_CONV, [started('startup'), madeNow(bots, 'j0000001')]);
  await reports(box, bots, CONV, 'clear');
  await transcriptOf(box, bots, CONV, [started('clear')]);

  for (const [flags, asked] of [[['--on', '--at', '06:30'], 'on'], [['--off'], 'off']]) {
    const before = await sendsByTab(box);
    const answer = await groom(box, ...flags);
    const line = await theLineTyped(box, bots, before);
    assert.ok(line.includes('j0000001'), `groom ${flags.join(' ')} should name the job the process still has, got: ${line}`);
    assert.deepEqual(idsOf(answer), ['j0000001']);
    assert.equal(answer.groom.asked, asked);
  }
});

test('G3 no conversation yet, or one with no transcript yet, has no grooming jobs, and the report still answers', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box, { conversation: null });

  const none = await groom(box);
  await reports(box, bots, CONV);
  const noTranscript = await groom(box);
  const plain = await run(box);

  assert.equal(none.groom.session?.conversation, null);
  assert.deepEqual(none.groom.jobs, []);
  assert.equal(noTranscript.groom.session?.conversation, CONV);
  assert.deepEqual(noTranscript.groom.jobs, []);
  assert.equal(plain.code, 0, plain.stderr);
});

test('G3 reached through a symlink the bots folder is its real path: in the answer, in the jobs, in the marker typed', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await oneJob(box, bots, 'f0000001');
  await symlink(bots, box.path('another-way-in'));
  const before = await sendsByTab(box);

  const read = await groomIn(box, 'another-way-in');
  const asked = await groomIn(box, 'another-way-in', '--on', '--at', '04:00');

  assert.equal(read.bots, bots, 'bots comes back as the folder itself, not the way in');
  assert.deepEqual(idsOf(read), ['f0000001'], 'the job made under the real path is found');
  const line = await theLineTyped(box, bots, before);
  assert.ok(line.includes(markerOf(bots)), `the marker names the real path, got: ${line}`);
  assert.ok(!line.includes(markerOf(box.path('another-way-in'))), `and not the way in, got: ${line}`);
  assert.equal(asked.groom.asked, 'on');
});

test('G3 the plain report with no grooming job says grooming is off, and how to turn it on with --on --at', async (t) => {
  const box = await createSandbox(t);
  await fleet(box);

  const result = await run(box);

  assert.equal(result.code, 0, result.stderr);
  assert.match(
    result.stdout.replaceAll(/--[a-z-]+/g, ' '),
    /\boff\b/i,
    `it should say grooming is off in a word, got:\n${result.stdout}`,
  );
  const commands = commandsIn(result.stdout, box.cli, 'groom --bots ');
  assert.ok(
    commands.some((command) => command.includes('--on') && command.includes('--at')),
    `one of them should turn it on at a time, got: ${JSON.stringify(commands)}`,
  );
});

test('G3 the plain report on one grooming job says when it runs and which job it is', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await oneJob(box, bots, 'a1b2c3d4');

  const result = await run(box);

  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout.includes('04:00'), `it should say when it runs, got:\n${result.stdout}`);
  assert.ok(result.stdout.includes('a1b2c3d4'), `and which job it is, got:\n${result.stdout}`);
});

test('G3 the plain report on two grooming jobs says there are two, and how to get back to one with --on', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const prompt = groomingPrompt(bots);
  await transcriptOf(box, bots, CONV, [
    created({ id: 'a0000001', cron: '0 4 * * *', prompt, at: ago(2 * DAY) }),
    created({ id: 'a0000002', cron: '0 4 * * *', prompt, at: ago(DAY) }),
  ]);

  const result = await run(box);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /\b(?:2|two|twice)\b/i, `it should say there are two, got:\n${result.stdout}`);
  const commands = commandsIn(result.stdout, box.cli, 'groom --bots ');
  assert.ok(
    commands.some((command) => command.includes('--on')),
    `and give the --on that gets back to one, got: ${JSON.stringify(commands)}`,
  );
});

// ------------------------------------------------------------ automations in Orca

test('G4 whatever automations Orca holds, no groom call makes, edits or removes one, and none stops a line being typed', async (t) => {
  // The one an earlier kit made, on, in Bot Father's folder, and two of the
  // user's own. Every flag that types still types its one line beside them,
  // and a refused call leaves them as they are too.
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await oneJob(box, bots, 'a1b2c3d4');
  await automation(box, bots, { id: 'auto_old', enabled: true });
  await automation(box, bots, { id: 'auto_theirs', name: 'my own nightly note to self', enabled: true });
  await automation(box, bots, { id: 'auto_elsewhere', folder: path.join(box.root, 'other', 'bots', 'bots', 'bot-father'), enabled: true });
  const automations = await automationsIn(box);
  const from = await mark(box);

  assert.equal((await run(box)).code, 0);
  await groom(box);
  for (const [flags, asked] of [
    [['--on', '--at', '04:00'], 'on'],
    [['--at', '06:30'], 'on'],
    [['--on'], 'on'],
    [['--off'], 'off'],
    [['--now'], 'now'],
    [['--compact'], 'compact'],
  ]) {
    const before = await sendsByTab(box);
    const answer = await groom(box, ...flags);
    await theLineTyped(box, bots, before);
    assert.equal(answer.groom.asked, asked, `groom ${flags.join(' ')}`);
  }
  assertRefused(await run(box, '--on', '--off'), '--on --off');

  assert.deepEqual(await automationsIn(box), automations, 'every automation is left exactly as it was');
  assert.deepEqual(await automationWritesSince(box, from), [], 'no automation is made, edited or removed');
});

// ------------------------------------------------------------ reading changes nothing

test('G5 the report types nothing, writes nothing in the bots folder and touches no automation, in every state', async (t) => {
  // One fleet taken through the states in turn: no grooming session, one not
  // up, one up with nothing scheduled, one with a job and automations in Orca.
  // Then the same fleet does take a line when asked, which is what shows the
  // check above it could have seen one.
  const box = await createSandbox(t);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const bots = box.path('bots');

  const states = [
    ['no grooming session', async () => {}],
    ['a grooming session not up', async () => {
      assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', 'bot-father', '--name', 'grooming'])).code, 0);
    }],
    ['a grooming session up with nothing scheduled', async () => {
      assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);
      await reports(box, bots, CONV);
    }],
    ['a grooming job, and automations in Orca', async () => {
      await oneJob(box, bots);
      await automation(box, bots, { enabled: true });
      await automation(box, bots, { id: 'auto_theirs', name: 'my own nightly note to self', enabled: true });
    }],
  ];
  for (const [state, arrange] of states) {
    await arrange();
    const tree = await snapshot(bots, skipGit);
    const sends = await sendsByTab(box);
    const automations = await automationsIn(box);
    const from = await mark(box);

    const plain = await run(box);
    const answer = await groom(box);

    assert.equal(plain.code, 0, `${state}: ${plain.stderr}`);
    assert.ok(!plain.stdout.includes('undefined'), `${state}: nothing should be undefined, got:\n${plain.stdout}`);
    assert.equal(answer.groom.asked, null, `${state}: nothing was asked`);
    assert.deepEqual(await snapshot(bots, skipGit), tree, `${state}: no file in the bots folder is written`);
    await assertNothingTyped(box, sends, state);
    assert.deepEqual(await automationsIn(box), automations, `${state}: no automation changes`);
    assert.deepEqual(await automationWritesSince(box, from), [], `${state}: no automation is made, edited or removed`);
  }

  const before = await sendsByTab(box);
  await groom(box, '--now');
  await theLineTyped(box, bots, before);
});

// ================================================================== typing into the grooming tab

test('G6 --on --at types one line into the grooming tab asking for one recurring job at that time, under the marker', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const before = await sendsByTab(box);

  const answer = await groom(box, '--on', '--at', '04:00');

  const line = await theLineTyped(box, bots, before);
  assert.match(line, /CronCreate/, `it asks for a job to be made, got: ${line}`);
  assertCron(line, '0 4 * * *');
  assert.ok(line.includes(markerOf(bots)), `and carries the marker ${markerOf(bots)}, got: ${line}`);
  assert.equal(answer.groom.asked, 'on');
  assert.deepEqual(answer.groom.jobs, [], 'jobs is read before the line, so the job it asked for is not there yet');
});

test('G6 --on --at twice before either has run: each line clears every grooming job before it creates one', async (t) => {
  // The second is typed while the first still waits in the tab, so the kit
  // sees no job either time. A second line that only created would leave the
  // fleet with two jobs, groomed twice a day (review of PR #322).
  const box = await createSandbox(t);
  const bots = await fleet(box);

  for (const time of ['first', 'second']) {
    const before = await sendsByTab(box);
    const answer = await groom(box, '--on', '--at', '04:00');
    const line = await theLineTyped(box, bots, before);
    assertClearsBeforeCreating(line);
    assertCron(line, '0 4 * * *');
    assert.equal(answer.groom.asked, 'on', `the ${time} --on`);
  }
});

test('G6 the time becomes a cron of plain numbers, minute then hour, every day', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);

  for (const [at, cron] of [['04:00', '0 4 * * *'], ['23:05', '5 23 * * *'], ['00:00', '0 0 * * *'], ['23:59', '59 23 * * *'], ['09:30', '30 9 * * *']]) {
    const before = await sendsByTab(box);
    await groom(box, '--on', '--at', at);
    assertCron(await theLineTyped(box, bots, before), cron);
  }
});

test('G6 the run the line hands over names obk-grooming, obk-finops and the CLI that typed it', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const before = await sendsByTab(box);

  await groom(box, '--on', '--at', '04:00');

  const line = await theLineTyped(box, bots, before);
  for (const skill of ['obk-grooming', 'obk-finops']) {
    assert.ok(line.includes(skill), `the run should be told to use ${skill}, got: ${line}`);
  }
  assertNamesCli(box, line);
});

test('G6 with grooming jobs listed, --on --at asks for each to be deleted by id, and names no other job', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const prompt = groomingPrompt(bots);
  await transcriptOf(box, bots, CONV, [
    created({ id: 'dead0001', cron: '0 4 * * *', prompt, at: ago(WEEK + HOUR) }),
    created({ id: 'dead0002', cron: '0 4 * * *', prompt, at: ago(4 * DAY) }),
    deleted('dead0002', ago(3 * DAY)),
    created({ id: 'cafe0001', cron: '0 9 * * *', prompt: 'Remind me to stretch.', at: ago(3 * DAY) }),
    created({ id: 'a0000001', cron: '0 4 * * *', prompt, at: ago(2 * DAY) }),
    created({ id: 'a0000002', cron: '0 4 * * *', prompt, at: ago(DAY) }),
  ]);
  const before = await sendsByTab(box);

  const answer = await groom(box, '--on', '--at', '06:30');

  const line = await theLineTyped(box, bots, before);
  assert.match(line, /CronDelete/, `it asks for the jobs there to be deleted, got: ${line}`);
  for (const id of ['a0000001', 'a0000002']) {
    assert.ok(line.includes(id), `each grooming job by its id, ${id} among them, got: ${line}`);
  }
  for (const id of ['cafe0001', 'dead0001', 'dead0002']) {
    assert.ok(!line.includes(id), `${id} is not a grooming job alive now, and has no place in the line, got: ${line}`);
  }
  assert.match(line, /CronCreate/);
  assertCron(line, '30 6 * * *');
  assert.ok(line.includes(markerOf(bots)), `got: ${line}`);
  assert.deepEqual(idsOf(answer), ['a0000001', 'a0000002']);
  assert.equal(answer.groom.asked, 'on');
});

test('G6 --at alone with a grooming job moves it: the same line as --on --at', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await oneJob(box, bots, 'a1b2c3d4');
  const before = await sendsByTab(box);

  const answer = await groom(box, '--at', '06:30');

  const line = await theLineTyped(box, bots, before);
  assert.match(line, /CronDelete/, `got: ${line}`);
  assert.ok(line.includes('a1b2c3d4'), `the job there, by its id, got: ${line}`);
  assert.match(line, /CronCreate/, `got: ${line}`);
  assertCron(line, '30 6 * * *');
  assert.ok(line.includes(markerOf(bots)), `got: ${line}`);
  assert.equal(answer.groom.asked, 'on');
});

test('G6 --at alone with no grooming job is refused and types nothing; --on --at on the same fleet types the line', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const before = await sendsByTab(box);
  const from = await mark(box);

  const refused = await run(box, '--at', '04:00');

  assertRefused(refused, '--at with grooming off');
  await assertNothingTyped(box, before, '--at with grooming off');
  assert.deepEqual(await automationWritesSince(box, from), []);

  await groom(box, '--on', '--at', '04:00');
  assertCron(await theLineTyped(box, bots, before), '0 4 * * *');
});

test('G6 --on alone renews at the one time every job has: two jobs at 04:00 go back to one', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const prompt = groomingPrompt(bots);
  await transcriptOf(box, bots, CONV, [
    created({ id: 'a0000001', cron: '0 4 * * *', prompt, at: ago(2 * DAY) }),
    created({ id: 'a0000002', cron: '0 4 * * *', prompt, at: ago(DAY) }),
  ]);
  const before = await sendsByTab(box);

  const answer = await groom(box, '--on');

  const line = await theLineTyped(box, bots, before);
  assert.match(line, /CronDelete/, `got: ${line}`);
  for (const id of ['a0000001', 'a0000002']) assert.ok(line.includes(id), `${id} is deleted, got: ${line}`);
  assert.match(line, /CronCreate/, `got: ${line}`);
  assertCron(line, '0 4 * * *');
  assert.ok(line.includes(markerOf(bots)), `got: ${line}`);
  assert.equal(answer.groom.asked, 'on');
});

test('G6 --on alone is refused with no grooming job, and with jobs at different times, and types nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const before = await sendsByTab(box);

  const none = await run(box, '--on');
  const prompt = groomingPrompt(bots);
  await transcriptOf(box, bots, CONV, [
    created({ id: 'a0000001', cron: '0 4 * * *', prompt, at: ago(2 * DAY) }),
    created({ id: 'a0000002', cron: '5 23 * * *', prompt, at: ago(DAY) }),
  ]);
  const twoTimes = await run(box, '--on');

  assertRefused(none, '--on with no grooming job');
  assertRefused(twoTimes, '--on with jobs at 04:00 and 23:05');
  await assertNothingTyped(box, before, 'a refused --on');

  await groom(box, '--on', '--at', '04:00');
  const line = await theLineTyped(box, bots, before);
  for (const id of ['a0000001', 'a0000002']) assert.ok(line.includes(id), `with a time given it goes through, got: ${line}`);
});

test('G7 --off asks for each grooming job to be deleted by id, and for none to be made', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const prompt = groomingPrompt(bots);
  await transcriptOf(box, bots, CONV, [
    created({ id: 'cafe0001', cron: '0 9 * * *', prompt: 'Remind me to stretch.', at: ago(3 * DAY) }),
    created({ id: 'a0000001', cron: '0 4 * * *', prompt, at: ago(2 * DAY) }),
    created({ id: 'a0000002', cron: '0 4 * * *', prompt, at: ago(DAY) }),
  ]);
  const before = await sendsByTab(box);

  const answer = await groom(box, '--off');

  const line = await theLineTyped(box, bots, before);
  assert.match(line, /CronDelete/, `got: ${line}`);
  for (const id of ['a0000001', 'a0000002']) assert.ok(line.includes(id), `${id} by its id, got: ${line}`);
  assert.ok(!line.includes('cafe0001'), `the user's own job is not grooming's to delete, got: ${line}`);
  assert.doesNotMatch(line, /CronCreate/, `turning it off makes no job, got: ${line}`);
  assert.equal(answer.groom.asked, 'off');
});

/**
 * `--off` where there is no tab to tell and no job to see: nothing typed,
 * grooming said to be off, exit 0, nothing asked.
 */
async function offWithNothingToTell(box, state) {
  const before = await sendsByTab(box);

  const plain = await run(box, '--off');
  const answer = await groom(box, '--off');

  assert.equal(plain.code, 0, `${state}: ${plain.stderr}`);
  assert.match(plain.stdout.replaceAll(/--[a-z-]+/g, ' '), /\boff\b/i, `${state}: it should say grooming is off, got:\n${plain.stdout}`);
  assert.equal(answer.groom.asked, null, `${state}: nothing was typed, so nothing was asked`);
  await assertNothingTyped(box, before, `${state}: --off`);
}

test('G7 --off with no job listed types its line into an up Claude grooming tab; with no tab to tell, nothing, off, exit 0', async (t) => {
  // An --on typed a moment before may still be waiting in the tab, and the
  // transcript shows no job until the session has run it. So an up Claude
  // grooming tab is told to clear every grooming job whether or not the kit
  // sees one. Where there is no such tab and no job to see, grooming is off.
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const before = await sendsByTab(box);

  const answer = await groom(box, '--off');

  const line = await theLineTyped(box, bots, before);
  assertClearsEveryGroomingJob(line);
  assert.doesNotMatch(line, /CronCreate/, `turning it off makes no job, got: ${line}`);
  assert.equal(answer.groom.asked, 'off');
  assert.deepEqual(answer.groom.jobs, [], 'no job was listed when it typed');

  const paused = await box.run(['pause', '--bots', 'bots', '--bot', 'bot-father', '--session', 'grooming']);
  assert.equal(paused.code, 0, paused.stderr);
  await offWithNothingToTell(box, 'a grooming tab Orca no longer lists');

  const other = await createSandbox(t);
  assert.equal((await other.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  await offWithNothingToTell(other, 'no grooming session');
  assert.equal((await other.run(['session', 'add', '--bots', 'bots', '--bot', 'bot-father', '--name', 'grooming'])).code, 0);
  await offWithNothingToTell(other, 'a grooming session never brought up');

  const codex = await createSandbox(t);
  await fleet(codex, { harness: 'codex', conversation: null });
  await offWithNothingToTell(codex, 'a Codex grooming session');
});

test('G7 --on --at, --off, --on --at with nothing run between: three lines, each clearing every grooming job, only the on lines creating one', async (t) => {
  // The review of PR #322: typed one after another, none of them run yet, the
  // transcript shows no job at any of the three. An --off that went by the
  // transcript typed nothing, and grooming stayed on after the user said off.
  // Run in order in the tab, these three leave exactly one job.
  const box = await createSandbox(t);
  const bots = await fleet(box);

  const lines = [];
  for (const [flags, asked] of [[['--on', '--at', '04:00'], 'on'], [['--off'], 'off'], [['--on', '--at', '04:00'], 'on']]) {
    const before = await sendsByTab(box);
    const answer = await groom(box, ...flags);
    lines.push(await theLineTyped(box, bots, before));
    assert.equal(answer.groom.asked, asked, `groom ${flags.join(' ')}`);
    assert.deepEqual(answer.groom.jobs, [], `groom ${flags.join(' ')}: nothing has run in the tab, so no job is listed`);
  }

  const [on, off, again] = lines;
  assertClearsEveryGroomingJob(off);
  assert.doesNotMatch(off, /CronCreate/, `the off line makes no job, got: ${off}`);
  for (const line of [on, again]) {
    assertClearsBeforeCreating(line);
    assertCron(line, '0 4 * * *');
    assert.ok(line.includes(markerOf(bots)), `got: ${line}`);
  }
});

test('G8 --now asks for one grooming run now, the run a job would do, and schedules nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const before = await sendsByTab(box);

  const answer = await groom(box, '--now');

  const line = await theLineTyped(box, bots, before);
  for (const skill of ['obk-grooming', 'obk-finops']) {
    assert.ok(line.includes(skill), `the run should be told to use ${skill}, got: ${line}`);
  }
  assertNamesCli(box, line);
  assert.ok(line.includes(bots), `and which bots folder it grooms, ${bots}, got: ${line}`);
  assert.doesNotMatch(line, /CronCreate/, `a run now schedules nothing, got: ${line}`);
  assert.equal(answer.groom.asked, 'now');
});

test('G8 --compact types /compact, exactly, into the grooming tab', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const before = await sendsByTab(box);

  const answer = await groom(box, '--compact');

  assert.equal(await theLineTyped(box, bots, before), '/compact');
  assert.equal(answer.groom.asked, 'compact');
});

// ------------------------------------------------------------------ refusals

test('G9 flags that cannot go together are refused, type nothing and touch no automation', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await oneJob(box, bots);
  const before = await sendsByTab(box);
  const from = await mark(box);

  for (const flags of [
    ['--on', '--off'],
    ['--off', '--at', '04:00'],
    ['--now', '--compact'],
    ['--now', '--on'],
    ['--now', '--off'],
    ['--now', '--at', '04:00'],
    ['--compact', '--on'],
    ['--compact', '--off'],
    ['--compact', '--at', '04:00'],
  ]) {
    assertRefused(await run(box, ...flags), flags.join(' '));
  }

  await assertNothingTyped(box, before, 'a refused pair of flags');
  assert.deepEqual(await automationWritesSince(box, from), []);
  for (const flags of [['--now'], ['--compact'], ['--off']]) {
    const each = await sendsByTab(box);
    await groom(box, ...flags);
    await theLineTyped(box, bots, each);
  }
});

test('G9 a time that is not HH:MM is refused and types nothing; 04:00 on the same fleet types the line', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await oneJob(box, bots);
  const before = await sendsByTab(box);

  for (const wrong of ['4:00', '24:00', '12:60', 'noon', '04:0', '']) {
    assertRefused(await run(box, '--on', '--at', wrong), `--on --at ${JSON.stringify(wrong)}`);
  }
  assertRefused(await run(box, '--at', '4:00'), '--at 4:00 alone, with a job to move');

  await assertNothingTyped(box, before, 'a time that is not a time');
  await groom(box, '--on', '--at', '04:00');
  assertCron(await theLineTyped(box, bots, before), '0 4 * * *');
});

test('G10 with no grooming session every flag that types is refused; once one is up, the same flag types', async (t) => {
  const box = await createSandbox(t);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const bots = box.path('bots');
  const before = await sendsByTab(box);
  const from = await mark(box);

  for (const flags of [['--on', '--at', '04:00'], ['--at', '04:00'], ['--now'], ['--compact']]) {
    assertRefused(await run(box, ...flags), `${flags.join(' ')} with no grooming session`);
  }

  await assertNothingTyped(box, before, 'no grooming session');
  assert.deepEqual(await automationWritesSince(box, from), []);
  assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', 'bot-father', '--name', 'grooming'])).code, 0);
  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);
  const up = await sendsByTab(box);
  await groom(box, '--now');
  await theLineTyped(box, bots, up);
});

test('G10 a grooming session on Codex is refused every flag that types; a Claude one under a Codex Bot Father is not', async (t) => {
  const box = await createSandbox(t);
  await fleet(box, { harness: 'codex', conversation: null });
  const before = await sendsByTab(box);

  for (const flags of [['--on', '--at', '04:00'], ['--now'], ['--compact']]) {
    assertRefused(await run(box, ...flags), `${flags.join(' ')} on a Codex grooming session`);
  }
  await assertNothingTyped(box, before, 'a Codex grooming session');

  const other = await createSandbox(t);
  const bots = await fleet(other, { father: 'codex', harness: 'claude', conversation: null });
  const ready = await sendsByTab(other);
  await groom(other, '--now');
  await theLineTyped(other, bots, ready);
});

test('G10 a grooming session never brought up is refused every flag that types; brought up, the same flag types', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box, { up: false });
  const before = await sendsByTab(box);

  for (const flags of [['--on', '--at', '04:00'], ['--now'], ['--compact']]) {
    assertRefused(await run(box, ...flags), `${flags.join(' ')} with no tab in the book`);
  }
  await assertNothingTyped(box, before, 'a grooming session never up');

  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);
  const up = await sendsByTab(box);
  await groom(box, '--now');
  await theLineTyped(box, bots, up);
});

test('G10 a grooming session whose tab Orca no longer lists is refused every flag that types; unpaused, it types', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await oneJob(box, bots, 'a1b2c3d4');
  const paused = await box.run(['pause', '--bots', 'bots', '--bot', 'bot-father', '--session', 'grooming']);
  assert.equal(paused.code, 0, paused.stderr);
  const before = await sendsByTab(box);

  for (const flags of TYPING) {
    assertRefused(await run(box, ...flags), `${flags.join(' ')} with the grooming tab gone`);
  }
  await assertNothingTyped(box, before, 'a grooming tab Orca no longer lists');

  const unpaused = await box.run(['unpause', '--bots', 'bots', '--bot', 'bot-father', '--session', 'grooming']);
  assert.equal(unpaused.code, 0, unpaused.stderr);
  const back = await sendsByTab(box);
  await groom(box, '--off');
  assert.ok((await theLineTyped(box, bots, back)).includes('a1b2c3d4'));
});

test('G10 a grooming tab with something on screen waiting for an answer is refused every flag that types', async (t) => {
  // The next return in such a tab answers the question on screen.
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await oneJob(box, bots);
  await box.orca.set({ waitIdle: 'blocked' });
  const before = await sendsByTab(box);

  for (const flags of TYPING) {
    assertRefused(await run(box, ...flags), `${flags.join(' ')} with a question on the grooming tab's screen`);
  }
  await assertNothingTyped(box, before, 'a blocked grooming tab');

  await box.orca.set({ waitIdle: true });
  await groom(box, '--now');
  await theLineTyped(box, bots, before);
});

test('G10 a grooming tab with no harness in front, or one the kit cannot read, is refused every flag that types', async (t) => {
  // A shell at its prompt runs the line as a command; `less` in front takes it
  // as keys. The kit types only where it can see Claude Code in front.
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await oneJob(box, bots);
  const before = await sendsByTab(box);

  // Every flag against a shell in front; one of each kind against the rest.
  const cases = [
    ...TYPING.map((flags) => ['shell', flags]),
    ...['bare-shell', 'program', 'other-harness', 'ps-fails', 'no-pid'].flatMap((foreground) => [
      [foreground, ['--on', '--at', '04:00']],
      [foreground, ['--off']],
      [foreground, ['--compact']],
    ]),
  ];
  for (const [foreground, flags] of cases) {
    await inFrontOfGrooming(box, bots, foreground);
    assertRefused(await run(box, ...flags), `${flags.join(' ')} with ${foreground} in front of the grooming tab`);
  }
  await assertNothingTyped(box, before, 'no harness the kit can see in front');

  await inFrontOfGrooming(box, bots, 'harness');
  await groom(box, '--now');
  await theLineTyped(box, bots, before);
});

test('G10 a busy Claude Code in front of the grooming tab is typed into: it is up, and nothing is waiting for an answer', async (t) => {
  // Orca's wait times out on a harness at work just as on a shell, but the
  // harness is in front of the tab (#232), and Claude Code queues a line typed
  // while it works.
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await box.orca.set({ waitIdle: 'busy' });
  const before = await sendsByTab(box);

  const answer = await groom(box, '--now');

  await theLineTyped(box, bots, before);
  assert.equal(answer.groom.asked, 'now');
});

// ------------------------------------------------------------------ unchanged

test('G12 a bots folder with no Bot Father is refused, and nothing is typed', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box, { conversation: null });
  await rm(botHomeOf(bots), { recursive: true, force: true });
  const before = await sendsByTab(box);

  for (const flags of [[], ['--now']]) {
    const result = await run(box, ...flags);
    assertRefused(result, `groom ${flags.join(' ')} with no Bot Father`);
    assert.ok(result.stderr.includes('bot-father'), `the refusal should name what is missing, got: ${result.stderr}`);
  }
  await assertNothingTyped(box, before, 'no Bot Father');
});

test('G12 groom refuses when Orca is not answering, and stops asking it for things', async (t) => {
  const box = await createSandbox(t);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  await box.orca.set({ reachable: false });

  for (const flags of [[], ['--now']]) {
    const from = await mark(box);
    const result = await run(box, ...flags);
    assertRefused(result, `groom ${flags.join(' ')} with Orca down`);
    assert.match(result.stderr, /orca/i, `the message should name Orca, got: ${result.stderr}`);
    assert.deepEqual(
      (await box.orca.calls()).slice(from).map(orcaCommand),
      ['status'],
      'once Orca is out, the kit must stop asking it for things',
    );
  }
});

test('G12 groom without --bots is refused and says so', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['groom']);

  assertRefused(result, 'groom with no --bots');
  assert.ok(result.stderr.includes('--bots'), `should name --bots, got: ${result.stderr}`);
});

test('G12 --json answers with bots as the resolved absolute path', async (t) => {
  const box = await createSandbox(t);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);

  const answer = await groom(box);

  assert.equal(answer.bots, box.path('bots'), '--bots was given as a relative path and comes back resolved');
  assert.equal(path.isAbsolute(answer.bots), true);
});

test('G12 every Orca call groom makes is one it is allowed to make, and none makes, edits or removes an automation', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await oneJob(box, bots);
  await automation(box, bots, { enabled: false });
  const from = await mark(box);

  await run(box);
  await groom(box, '--on', '--at', '04:00');
  await groom(box, '--now');
  await groom(box, '--compact');
  await groom(box, '--off');

  const calls = (await box.orca.calls()).slice(from);
  assertOrcaCallsAllowed(calls);
  assert.deepEqual(await automationWritesSince(box, from), []);
});
