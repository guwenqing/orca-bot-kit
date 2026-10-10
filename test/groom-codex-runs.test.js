// `obk groom --on [--at HH:MM] --run-on codex [--model M] [--effort E] [--extra-arg=A]…`:
// the daily grooming done by a temporary Codex session at each fire (#238, PRD
// 6.8).
//
// The owner's decision (#238): the long-lived session that holds the schedule
// and receives the results is always a Claude Code session, Bot Father's
// `grooming`, as in #237. For a Codex job each run is a temporary Codex session
// (#227) with the job's model and effort on its launch line, which does the
// work, sends its result back by the kit's mail and is retired. So with
// `--run-on codex` the job's prompt, the one the kit types for the session to
// schedule, tells the session at each fire to:
//
//   1. retire any of its own `groom-*` temporary sessions still in the book
//      (`<the kit> temp retire --bots B --name …`), so a run that never
//      reported is cleared at the next fire (the architect's ruling, (5));
//   2. make the run: `<the kit> temp make --bots B --name groom-<YYYYMMDD-HHMM>
//      --harness codex [--model M] [--effort E] [--extra-arg=…]… --prompt-file
//      <the run's task>`, and end its turn;
//   3. when the run's report comes by the kit's mail, read it and retire the
//      run (`<the kit> temp retire …` again);
//   4. renew the job, word for word, as #237's job does.
//
// The run's task is a file the kit writes: do the daily grooming for B with the
// obk-grooming skill, send the report to bot-father/grooming by the kit's mail,
// and stop. `obk groom` reports the run's harness, model and effort for a job
// that has them, read out of the job as it reads the rest. Without `--run-on`
// everything is as #237 has it, and `--model`, `--effort` and `--extra-arg`
// without `--run-on codex` are refused.
//
// The commands in the job are read out of the typed line
// (helpers/typed-command.js) and run the way the session would run them at a
// fire: by a real shell, in the grooming session's own tab, against this
// sandbox's kit. That is what says the words are the right ones and quoted as
// the shell needs, rather than that the line has them in it. The name the
// session gives each run is filled in by the session when it fires, so it is
// put in here.
//
// The interface these tests read, beyond #237's (test/groom.test.js):
//
//   - the job's prompt is everything after `Prompt: ` in the typed `--on` line,
//     as #237's line already asks the session to take it;
//   - each job in `obk groom --json` carries `run: { harness, model, effort }`
//     when it makes runs, with what it was not given left out; a job that does
//     not has no `run`;
//   - the kit in the job is named by its own path, as #237's run names it
//     (`shellWord(ownCli())`): a Claude Code allow rule matches a command as
//     written, not after `$OBK_CLI` is expanded (src/rules.js, #344).
//
// Every run is in the sandbox (helpers/cli.js): its own HOME, a fake Orca, and
// fake harnesses. Nothing here reaches the real Orca, a real harness, or
// anything outside the sandbox.

import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import {
  botHomeOf,
  createSandbox,
  fakeProgram,
  kitLaunchMark,
  recordSession,
  sentInto,
  sessionIn,
  sh,
  spellingsOf,
  typedInto,
} from './helpers/cli.js';
import { addSession } from './helpers/permissions.js';
import { commandsIn, flagValue, withWord } from './helpers/typed-command.js';

// ------------------------------------------------------------------ the job

/** The Codex model and effort a job's runs are to use: neither Codex's default. */
const MODEL = 'gpt-6-sol';
const EFFORT = 'low';

/**
 * Extra arguments for each run's launch line, chosen so that a word quoted the
 * wrong way shows: a value that starts with a dash, one with spaces and double
 * quotes, a `$` that must stay a dollar, and a single quote.
 */
const EXTRA = ['-c', 'projects={"/tmp/a b"={trust_level="trusted"}}', '$HOME stays', 'it\'s'];
const extraFlags = (args) => args.map((arg) => `--extra-arg=${arg}`);

/** A name the grooming session could give a run when it fires. */
const RUN = 'groom-20260929-0400';
const NEXT_RUN = 'groom-20260930-0400';

/** The grooming session's own settings: Claude's, every one of them, and an approval that is not the default. */
const GROOMING_SETTINGS = ['--model', 'opus', '--effort', 'high', '--context', '1m', '--approval', 'ask'];

const CONV = '0199b2c0-0001-4444-8888-cccccccccccc';

// ------------------------------------------------------------------ the fleet

/**
 * A bots folder with Bot Father on Claude Code and its `grooming` session,
 * added with `settings`, brought up, and holding a conversation its hook
 * reported.
 */
async function fleet(box, settings = GROOMING_SETTINGS) {
  const init = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(init.code, 0, init.stderr);
  // #527: the approval in `settings` is set by `obk permission approval`, after session add.
  const added = await addSession(box, { bot: 'bot-father', name: 'grooming', settings });
  assert.equal(added.code, 0, added.stderr);
  const brought = await box.run(['up', '--bots', 'bots']);
  assert.equal(brought.code, 0, brought.stderr);
  const bots = box.path('bots');
  const tab = (await sessionIn(bots, 'bot-father', 'grooming')).tab;
  const told = await recordSession(box, { bots, bot: 'bot-father', tab, session: CONV, source: 'startup' });
  assert.equal(told.code, 0, told.stderr);
  return bots;
}

/** Bot Father's home, as the file system knows it. */
const fatherOf = (bots) => realpath(botHomeOf(bots));

/** The grooming session's tab, as Orca has it. */
async function groomingTerminal(box, bots) {
  const tab = (await sessionIn(bots, 'bot-father', 'grooming'))?.tab;
  const found = (await box.orca.terminals()).find((one) => one.tabId === tab);
  assert.ok(found, `Orca should have the grooming tab ${tab}`);
  return found;
}

/** A session's tab, by the book, as Orca has it. */
async function tabOf(box, bots, name) {
  const tab = (await sessionIn(bots, 'bot-father', name))?.tab;
  assert.equal(typeof tab, 'string', `the book should hold a tab for ${name}`);
  const found = (await box.orca.terminals()).find((one) => one.tabId === tab);
  assert.ok(found, `Orca should have ${name}'s tab ${tab}`);
  return found;
}

/** One session's entry in Bot Father's bot.yaml, or undefined. */
async function entryIn(bots, name) {
  const doc = parse(await readFile(path.join(botHomeOf(bots), 'bot.yaml'), 'utf8'));
  return (doc.sessions ?? []).find((one) => one?.name === name);
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
async function codexJob(box, bots, flags = ['--model', MODEL, '--effort', EFFORT, ...extraFlags(EXTRA)]) {
  const before = await sendsByTab(box);
  const answer = await groom(box, '--on', '--at', '04:00', '--run-on', 'codex', ...flags);
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

// ------------------------------------------------------------------ the commands in the job

/** The `temp make` and `temp retire` commands in a job, by the running kit, each where it stands. */
function commandsOf(box, job) {
  return {
    makes: commandsIn(job, spellingsOf(box.cli), 'temp make'),
    retires: commandsIn(job, spellingsOf(box.cli), 'temp retire'),
  };
}

/** The one `temp make` in a job. */
function theMake(box, job) {
  const { makes } = commandsOf(box, job);
  assert.equal(makes.length, 1, `the job should name one temp make, by the kit's own path ${box.cli}, got ${makes.length}: ${job}`);
  return makes[0];
}

/** The arguments a real shell hands the kit for a command of the job, with `name` put in for `--name`. */
async function argvOf(command, name) {
  const ran = await sh(`printf '%s\\0' ${withWord(command.words, '--name', name)}`, {});
  assert.equal(ran.code, 0, `a shell should read the command: ${ran.stderr}`);
  return ran.stdout.split('\0').slice(0, -1);
}

/** Every value given to `flag` in an argv, glued or apart. */
function valuesOf(argv, flag) {
  const found = [];
  for (let one = 0; one < argv.length; one += 1) {
    if (argv[one] === flag) found.push(argv[one + 1]);
    else if (argv[one].startsWith(`${flag}=`)) found.push(argv[one].slice(flag.length + 1));
  }
  return found;
}

/**
 * Run a command of the job as the grooming session would at a fire: by a
 * shell, in its own tab, `--name` filled in as `name`.
 */
async function runInGroomingTab(box, bots, command, name) {
  const terminal = await groomingTerminal(box, bots);
  const env = { ...box.env, ORCA_TERMINAL_HANDLE: terminal.handle, ORCA_TAB_ID: terminal.tabId, ...kitLaunchMark(box, terminal) };
  return sh(withWord(command.words, '--name', name), { cwd: await fatherOf(bots), env });
}

/** The file the job's make gives as the run's task, read as the kit reads a prompt file: against Bot Father's home. */
async function taskFileOf(box, bots, job) {
  const given = flagValue(theMake(box, job).words, '--prompt-file');
  assert.equal(typeof given, 'string', `the make should give the run's task with --prompt-file, got: ${job}`);
  return path.resolve(await fatherOf(bots), given);
}

// ================================================================== the job's prompt

test('C1 --run-on codex types one line, whose job starts with the marker and is scheduled as #237 schedules one', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const before = await sendsByTab(box);

  const answer = await groom(box, '--on', '--at', '04:00', '--run-on', 'codex', '--model', MODEL, '--effort', EFFORT);

  const line = await theLineTyped(box, bots, before);
  assert.equal(answer.groom.asked, 'on');
  const create = line.indexOf('CronCreate');
  assert.ok(create >= 0, `the line asks for a job to be made, got: ${line}`);
  for (const asked of ['CronList', 'CronDelete', 'obk grooming']) {
    assert.ok(line.indexOf(asked) >= 0 && line.indexOf(asked) < create, `${asked} before the CronCreate, as #237's line clears first, got: ${line}`);
  }
  assert.match(line, /(?:^|[^0-9])0 4 \* \* \*(?![0-9])/, `at 04:00, got: ${line}`);
  assert.ok(jobIn(line).startsWith(`obk grooming for ${bots}`), `the job's prompt starts with the marker, so obk groom finds it: ${jobIn(line)}`);
});

test('C1 the job retires the session\'s own groom-* runs, then makes the run, then retires it, then renews itself', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);

  const job = await codexJob(box, bots);

  const make = theMake(box, job);
  const { retires } = commandsOf(box, job);
  assert.ok(retires.some((one) => one.at < make.at), `a temp retire by the kit before the make, for what an earlier run left: ${job}`);
  assert.ok(job.indexOf('groom-') >= 0 && job.indexOf('groom-') < make.at, `and it names the groom- runs as the ones to retire: ${job}`);
  assert.ok(retires.some((one) => one.at > make.at), `and a temp retire by the kit after it, for the run once it has reported: ${job}`);
  const renew = job.lastIndexOf('CronCreate');
  assert.ok(renew > make.at, `then the renewal, a CronCreate after the make, as #237's job ends: ${job}`);
  assert.ok(/(?:^|[^0-9])0 4 \* \* \*(?![0-9])/.test(job.slice(renew)), `with the job's own cron: ${job.slice(renew)}`);
  for (const one of [make, ...retires]) {
    const folder = flagValue(one.words, '--bots');
    assert.equal(typeof folder, 'string', `every command names the bots folder: ${one.words.map((word) => word.raw).join(' ')}`);
    assert.equal(await realpath(folder), await realpath(bots), 'this bots folder');
  }
});

test('C1 the job tells the session to answer its run\'s first-run screens itself, after making it and before the report', async (t) => {
  // The run's Codex starts on its folder trust and its hooks review, which its
  // maker answers, as the kit's rules tell a maker to (rules/temporary.md,
  // #251): no trust is given at launch (#238, the architect's ruling).
  const box = await createSandbox(t);
  const bots = await fleet(box);

  const job = await codexJob(box, bots, ['--model', MODEL, '--effort', EFFORT]);

  const make = theMake(box, job);
  const reported = commandsOf(box, job).retires.find((one) => one.at > make.at);
  assert.ok(reported, `a temp retire after the make, for the run once it has reported: ${job}`);
  const between = job.slice(make.at, reported.at);
  const screens = between.search(/first-run/i);
  assert.ok(screens >= 0, `between the make and the run's retire, the job names the run's first-run screens: ${between}`);
  const sentence = between.slice(screens).split(/[.!?](?:\s|$)/)[0];
  assert.match(sentence, /yourself|answer/i, `and tells the session to answer them itself: ${sentence}`);
});

test('C1 the Codex job renews itself at the fire, after making the run and before the part about its mail; the run is retired after that part', async (t) => {
  // The run's report comes in a later turn than the fire's, and may never come,
  // so a renewal that waits on it can be left undone (review of PR #439, P2-2:
  // the live run made no second CronCreate). So the job renews in the fire's own
  // turn, once the run is made, and the mail's turn only reads it and retires.
  const box = await createSandbox(t);
  const bots = await fleet(box);

  const job = await codexJob(box, bots, ['--model', MODEL, '--effort', EFFORT]);

  const make = theMake(box, job);
  const mail = job.search(/fleet mail/i);
  assert.ok(mail > make.at, `the job has a part about the run's mail, after the make: ${job}`);
  const renew = job.indexOf('CronCreate', make.at);
  assert.ok(renew > make.at && renew < mail, `the renewal's CronCreate comes after the make and before the mail part, got it at ${renew} (make ${make.at}, mail ${mail}): ${job}`);
  const reported = commandsOf(box, job).retires.find((one) => one.at > make.at);
  assert.ok(reported !== undefined && reported.at > mail, `the run's retire comes after the mail part: ${job}`);
  assert.equal(job.indexOf('CronCreate', mail), -1, `and nothing is renewed after the mail part, or it would be renewed twice: ${job}`);
});

test('C1 the job tells the session to answer its run\'s hooks review with the kit\'s temp trust-hooks, for this fleet and the run it made', async (t) => {
  // Claude Code's auto mode refused a raw `orca terminal send` of that answer,
  // so the kit has one command for it, under a permission rule of its own
  // (#238, the owner's choice (b)).
  const box = await createSandbox(t);
  const bots = await fleet(box);

  const job = await codexJob(box, bots, ['--model', MODEL, '--effort', EFFORT]);

  const make = theMake(box, job);
  const trusts = commandsIn(job, spellingsOf(box.cli), 'temp trust-hooks');
  assert.equal(trusts.length, 1, `the job names the kit's temp trust-hooks once, by the kit's own path ${box.cli}: ${job}`);
  const [trust] = trusts;
  assert.ok(trust.at > make.at, `after the make, whose run it answers: ${job}`);
  const folder = flagValue(trust.words, '--bots');
  assert.equal(typeof folder, 'string', `with --bots: ${trust.words.map((word) => word.raw).join(' ')}`);
  assert.equal(await realpath(folder), await realpath(bots), 'this bots folder');
  assert.equal(typeof flagValue(trust.words, '--name'), 'string', `and --name, the run: ${trust.words.map((word) => word.raw).join(' ')}`);
});

test('C1 the make, read by a real shell, asks for a Codex run with the model, the effort and every extra argument as given', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);

  const argv = await argvOf(theMake(box, await codexJob(box, bots)), RUN);

  assert.deepEqual(argv.slice(1, 3), ['temp', 'make']);
  assert.deepEqual(valuesOf(argv, '--name'), [RUN]);
  assert.deepEqual(valuesOf(argv, '--harness'), ['codex']);
  assert.deepEqual(valuesOf(argv, '--model'), [MODEL]);
  assert.deepEqual(valuesOf(argv, '--effort'), [EFFORT]);
  assert.deepEqual(valuesOf(argv, '--extra-arg'), EXTRA, 'each extra argument whole, in order, its quotes and dollar kept');
  assert.deepEqual(valuesOf(argv, '--context'), [], 'no context: that is the grooming session\'s, a Claude one');
  assert.equal(valuesOf(argv, '--prompt-file').length, 1, `the run's task from a file: ${JSON.stringify(argv)}`);
});

test('C1 the make with no model, effort or extra argument asks for a Codex run on Codex\'s own defaults', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);

  const argv = await argvOf(theMake(box, await codexJob(box, bots, [])), RUN);

  assert.deepEqual(valuesOf(argv, '--harness'), ['codex']);
  for (const flag of ['--model', '--effort', '--context', '--extra-arg']) {
    assert.deepEqual(valuesOf(argv, flag), [], `${flag} not given, so not asked for: ${JSON.stringify(argv)}`);
  }
});

test('C2 the job\'s make, run in the grooming tab at a fire, makes the run: a Codex temporary session of the grooming session\'s, on the job\'s settings', async (t) => {
  // The grooming session is Claude with opus, high, a 1m context and approval
  // ask. The run takes only the approval (#238, the architect's ruling (3)):
  // the rest is Claude's, and the job's model and effort are given.
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const job = await codexJob(box, bots);

  const made = await runInGroomingTab(box, bots, theMake(box, job), RUN);

  assert.equal(made.code, 0, `the make should work as the session runs it:\n${made.stdout}${made.stderr}`);
  const entry = await entryIn(bots, RUN);
  assert.ok(entry, `${RUN} is in Bot Father's bot.yaml`);
  assert.deepEqual(
    { harness: entry.harness, model: entry.model, effort: entry.effort, context: entry.context, approval: entry.approval },
    { harness: 'codex', model: MODEL, effort: EFFORT, context: undefined, approval: 'ask' },
  );
  assert.deepEqual(entry.extra_args, EXTRA, 'the extra arguments stored as given');
  assert.equal((await sessionIn(bots, 'bot-father', RUN))?.temporary?.maker, 'grooming', 'a temporary session of the grooming session\'s');

  // And its tab starts Codex on them.
  const typed = typedInto(await tabOf(box, bots, RUN));
  assert.equal(typed.length, 1, `one launch line in the run's tab, got: ${JSON.stringify(typed)}`);
  const fake = await fakeProgram(box, 'codex', {});
  const ran = await sh(typed[0], { cwd: box.cwd, env: box.env });
  assert.equal(ran.code, 0, `the launch line should run: ${typed[0]}\n${ran.stderr}`);
  const [call] = await fake.calls();
  const words = call.args.join('\n');
  assert.ok(words.includes(`-m\n${MODEL}`), `Codex is started on ${MODEL}: ${JSON.stringify(call.args)}`);
  assert.ok(words.includes(`-c\nmodel_reasoning_effort=${EFFORT}`), `at ${EFFORT} effort: ${JSON.stringify(call.args)}`);
  assert.ok(words.includes(EXTRA.join('\n')), `with the extra arguments, in order: ${JSON.stringify(call.args)}`);
  assert.ok(!words.includes('model_context_window'), `and no context window: ${JSON.stringify(call.args)}`);
  assert.ok(words.includes('-a\non-request'), `and the grooming session's approval, ask: ${JSON.stringify(call.args)}`);
  const task = await readFile(await taskFileOf(box, bots, job), 'utf8');
  assert.ok(call.args.at(-1).startsWith(task.trimEnd()), `its start prompt is the run's task: ${JSON.stringify(call.args.at(-1))}`);
});

test('C2 the job\'s retires, run in the grooming tab, retire the run once it reports, and clear one left from the fire before', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const job = await codexJob(box, bots);
  const make = theMake(box, job);
  const { retires } = commandsOf(box, job);
  const leftover = retires.find((one) => one.at < make.at);
  const reported = retires.find((one) => one.at > make.at);

  // A fire makes a run, which reports, and is retired.
  assert.equal((await runInGroomingTab(box, bots, make, RUN)).code, 0);
  const retired = await runInGroomingTab(box, bots, reported, RUN);
  assert.equal(retired.code, 0, `the run's retire should work:\n${retired.stdout}${retired.stderr}`);
  assert.equal(await entryIn(bots, RUN), undefined, `${RUN} is off bot.yaml`);

  // The next fire's run never reports; the fire after that clears it first.
  assert.equal((await runInGroomingTab(box, bots, make, NEXT_RUN)).code, 0);
  assert.ok(await entryIn(bots, NEXT_RUN), `${NEXT_RUN} was made`);
  const cleared = await runInGroomingTab(box, bots, leftover, NEXT_RUN);
  assert.equal(cleared.code, 0, `the leftover retire should work:\n${cleared.stdout}${cleared.stderr}`);
  assert.equal(await entryIn(bots, NEXT_RUN), undefined, `${NEXT_RUN}, left by the fire before, is off bot.yaml`);
});

test('C3 the run\'s task is a file the kit wrote: the daily grooming for this fleet with obk-grooming, reported to bot-father/grooming by the kit\'s mail', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);

  const file = await taskFileOf(box, bots, await codexJob(box, bots));

  let task;
  try {
    task = await readFile(file, 'utf8');
  } catch (error) {
    assert.fail(`the run's task should be a file the kit wrote when it typed the line, ${file}: ${error.message}`);
  }
  assert.ok(task.includes('obk-grooming'), `it names the obk-grooming skill: ${task}`);
  assert.ok(task.includes(await realpath(bots)), `and this bots folder: ${task}`);
  assert.ok(spellingsOf(box.cli).some((word) => task.includes(word)), `and the kit by its own path, ${box.cli}: ${task}`);
  assert.ok(task.includes('message send'), `the report goes by the kit's mail: ${task}`);
  assert.ok(task.includes('bot-father/grooming'), `to the grooming session: ${task}`);
  assert.ok(!task.includes('CronCreate'), `and the run schedules nothing, the schedule being the grooming session's: ${task}`);
});

// ================================================================== without --run-on

test('C4 without --run-on the --on line is #237\'s: no temporary session in it', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const before = await sendsByTab(box);

  await groom(box, '--on', '--at', '04:00');

  const line = await theLineTyped(box, bots, before);
  assert.deepEqual(commandsIn(line, spellingsOf(box.cli), 'temp make'), [], `no run is made: ${line}`);
  assert.ok(!/codex/i.test(line), `and nothing of Codex: ${line}`);
  const job = jobIn(line);
  const report = job.search(/report/i);
  assert.ok(report >= 0 && report < job.lastIndexOf('CronCreate'), `and its renewal still comes after its report, as #237 has it: ${job}`);
});

test('C5 --model, --effort or --extra-arg without --run-on codex is refused, says --run-on, and types nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);

  for (const flags of [['--model', MODEL], ['--effort', EFFORT], ['--extra-arg=-c']]) {
    const before = await sendsByTab(box);
    const result = await box.run(['groom', '--bots', 'bots', '--on', '--at', '04:00', ...flags]);
    assertRefused(result, `--on --at ${flags.join(' ')}`);
    assert.ok(result.stderr.includes('--run-on'), `the refusal says it goes with --run-on codex: ${result.stderr}`);
    assert.deepEqual(await sentSince(box, before), {}, `${flags[0]}: nothing typed`);
  }

  // The same fleet takes the flags with --run-on codex.
  const before = await sendsByTab(box);
  await groom(box, '--on', '--at', '04:00', '--run-on', 'codex', '--model', MODEL);
  await theLineTyped(box, bots, before);
});

test('C5 --run-on with anything but codex is refused and types nothing', async (t) => {
  const box = await createSandbox(t);
  await fleet(box);

  for (const harness of ['gpt', 'CODEX', '']) {
    const before = await sendsByTab(box);
    const result = await box.run(['groom', '--bots', 'bots', '--on', '--at', '04:00', `--run-on=${harness}`]);
    assertRefused(result, `--run-on=${harness}`);
    assert.ok(result.stderr.includes('codex'), `the refusal says codex is what it takes: ${result.stderr}`);
    assert.deepEqual(await sentSince(box, before), {}, `--run-on=${harness}: nothing typed`);
  }
});

// ================================================================== the report

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

/** The session made the job the kit asked for with `flags`: the prompt it typed, taken as the session takes it. */
async function jobMadeWith(box, bots, id, flags) {
  const job = flags === null
    ? await (async () => {
      const before = await sendsByTab(box);
      await groom(box, '--on', '--at', '04:00');
      return jobIn(await theLineTyped(box, bots, before));
    })()
    : await codexJob(box, bots, flags);
  return created({ id, cron: '0 4 * * *', prompt: job, at: new Date(Date.now() - 3600000).toISOString() });
}

test('C6 obk groom reports the run\'s harness, model and effort for a job that makes Codex runs, and no run for one that does not', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await transcriptOf(box, bots, await jobMadeWith(box, bots, 'c0de0001', ['--model', MODEL, '--effort', EFFORT, ...extraFlags(EXTRA)]));

  const [job] = (await groom(box)).groom.jobs;
  assert.equal(job?.id, 'c0de0001', 'the job is listed as #237 lists one');
  // The extra arguments too, since each run is given them (review of PR #439, P2-1).
  assert.deepEqual(job.run, { harness: 'codex', model: MODEL, effort: EFFORT, extra_args: EXTRA }, `read from the job: ${JSON.stringify(job)}`);

  const plain = await box.run(['groom', '--bots', 'bots']);
  assert.equal(plain.code, 0, plain.stderr);
  for (const word of ['codex', MODEL, EFFORT]) {
    assert.ok(plain.stdout.includes(word), `the plain report says the runs are on ${word}: ${plain.stdout}`);
  }

  // Beside it: a job without --run-on has no run, and the report says nothing of Codex.
  const other = await createSandbox(t);
  const otherBots = await fleet(other);
  await transcriptOf(other, otherBots, await jobMadeWith(other, otherBots, 'c1a0de01', null));
  const [claudeJob] = (await groom(other)).groom.jobs;
  assert.equal(claudeJob?.id, 'c1a0de01');
  assert.equal(claudeJob.run ?? null, null, `a job the session runs itself makes no run: ${JSON.stringify(claudeJob)}`);
  const otherPlain = await other.run(['groom', '--bots', 'bots']);
  assert.ok(!/codex/i.test(otherPlain.stdout), `and the report says nothing of Codex: ${otherPlain.stdout}`);
});

test('C6 a Codex job given no model or effort reports its runs on Codex with neither', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await transcriptOf(box, bots, await jobMadeWith(box, bots, 'c0de0002', []));

  const [job] = (await groom(box)).groom.jobs;
  assert.equal(job?.run?.harness, 'codex', `got: ${JSON.stringify(job)}`);
  assert.equal(job.run.model ?? null, null, 'no model: Codex\'s own');
  assert.equal(job.run.effort ?? null, null, 'no effort: Codex\'s own');
});

test('C7 moving a Codex job keeps every extra argument, as given and in order, and takes the new time', async (t) => {
  // Review of PR #439, P2-1: the move retyped the job from what the report
  // reads out of it, which kept the harness, the model and the effort and lost
  // the extra arguments.
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await transcriptOf(box, bots, await jobMadeWith(box, bots, 'c0de0007', ['--model', MODEL, '--effort', EFFORT, ...extraFlags(EXTRA)]));
  const before = await sendsByTab(box);

  const answer = await groom(box, '--at', '06:30');

  assert.equal(answer.groom.asked, 'on', 'a move is typed as an --on');
  const line = await theLineTyped(box, bots, before);
  assert.match(line, /(?:^|[^0-9])30 6 \* \* \*(?![0-9])/, `at the new time, 06:30: ${line}`);
  const argv = await argvOf(theMake(box, jobIn(line)), RUN);
  assert.deepEqual(valuesOf(argv, '--harness'), ['codex']);
  assert.deepEqual(valuesOf(argv, '--model'), [MODEL]);
  assert.deepEqual(valuesOf(argv, '--effort'), [EFFORT]);
  assert.deepEqual(valuesOf(argv, '--extra-arg'), EXTRA, 'every extra argument whole, in order, its quotes and dollar kept');
});

test('C7 a Codex job with no extra arguments reports none, and a move of it adds none', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await transcriptOf(box, bots, await jobMadeWith(box, bots, 'c0de0008', ['--model', MODEL]));

  const [job] = (await groom(box)).groom.jobs;
  assert.equal(job.run.extra_args ?? null, null, `no extra arguments were given: ${JSON.stringify(job)}`);
  const before = await sendsByTab(box);
  await groom(box, '--at', '06:30');
  const argv = await argvOf(theMake(box, jobIn(await theLineTyped(box, bots, before))), RUN);
  assert.deepEqual(valuesOf(argv, '--extra-arg'), [], `and the move adds none: ${JSON.stringify(argv)}`);
  assert.deepEqual(valuesOf(argv, '--model'), [MODEL]);
});
