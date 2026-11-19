// A harness that comes up during the kit's run (#792).
//
// `obk up`, `restart` and `unpause` type a launch line into a new tab, then
// wait up to 5 s for the session's own record to hold the start prompt as a
// user turn (test/prompt-received.test.js). A real harness writes that record
// and runs the kit's SessionStart hook as it comes up. In the sandbox nothing
// does, so every launch in a test waited the whole 5 s.
//
// `harnessComesUp` (helpers/cli.js) lets a test say before the run what the
// harness of the next launch of one session does as it comes up:
//
//   1a  it takes the words the tab's shell gives the harness for the line the
//       kit typed, the start prompt after `--` included, read from the kit's
//       file when the line has `"$(cat <file>)"`;
//   1b  it writes its record of conversation `id` under the sandbox home, in
//       the harness's own place and shape, and at the end of the record that
//       is there already;
//   1c  it runs the kit's hook under the harness process chain, with the
//       SessionStart input and the line's words as what ps shows;
//   2   once per call;
//   3   for that session of that bot only;
//   4   each start is listed by `box.orca.ranDuring()`, status 0.
//
// The shapes asserted here are the ones the requirement gives, from what
// Claude Code 2.1.328 and Codex 0.156.1 wrote for a start prompt. They are
// written out by hand, not taken from the helper.
//
// Not checked here: how long a run takes. A wall-clock bound is either loose
// enough to pass on a loaded CI machine, and then also passes with the 5 s
// wait in it, or tight enough to catch the wait, and then flaky. What is
// checked is the cause of the wait going away: the harness ran during the
// kit's `terminal wait` on the tab (4), so the record and the book's id are
// there before the kit first asks (up.js polls and returns at the first
// look that finds the turn), and the report says received.

import assert from 'node:assert/strict';
import { appendFile, readdir, readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  botHomeOf,
  conversationOnRecord,
  createSandbox,
  harnessComesUp,
  harnessWordsOf,
  launchLineInTab,
  recordSession,
  sessionIn,
  SYSTEM_FLAG,
} from './helpers/cli.js';

/** A short start prompt, typed on the line in single quotes: it has a quote of its own. */
const SHORT = 'Read your AGENTS.md and say in one line what this bot\'s owner wants.';

/**
 * A start prompt the kit puts in a file (over 200 characters, with newlines),
 * holding what a shell would change if it read it as shell text.
 */
const LONG = [
  'Your duty today:',
  '',
  '  1. Read the queue in $HOME/queue and "the list" in `notes`.',
  '  2. Answer each item in one line.',
  '',
  'Keep each answer short and plain, and say what you did not do. '.repeat(4).trim(),
].join('\n');

/** Conversation ids shaped the way both harnesses shape them. */
const conv = (n) => `0199b2c0-${String(n).padStart(4, '0')}-4444-8888-cccccccccccc`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const show = (value) => JSON.stringify(value, null, 2);

// ------------------------------------------------------------ the fleet

/** Init the bots folder. */
async function init(box) {
  const ran = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(ran.code, 0, ran.stderr);
  return box.path('bots');
}

/** Make `bot` on `harness` with `sessions` ([name, prompt] pairs), in that order; give back its home's real path. */
async function makeBot(box, bot, harness, sessions) {
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness]);
  assert.equal(made.code, 0, made.stderr);
  for (const [name, prompt] of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', name, '--prompt', prompt]);
    assert.equal(added.code, 0, added.stderr);
  }
  return realpath(botHomeOf(box.path('bots'), bot));
}

/** Run `args` with --json, and give back the run's tab entries and when it ran. */
async function runJson(box, args) {
  const from = Date.now();
  const result = await box.run([...args, '--json']);
  const to = Date.now();
  assert.equal(result.code, 0, result.stderr);
  return { tabs: JSON.parse(result.stdout).tabs, from, to, stdout: result.stdout };
}

/** The new tab entry of `bot`/`name` in a run's report. */
function entryOf(run, bot, name) {
  const found = run.tabs.filter((entry) => entry.bot === bot && entry.name === name && entry.created === true);
  assert.equal(found.length, 1, `the run should report one new tab for ${bot}/${name}, got: ${run.stdout}`);
  return found[0];
}

/** Promise 4: the harness came up `count` times in all, each a `terminal wait`, and nothing it ran failed. */
async function assertStarts(box, count) {
  const ran = await box.orca.ranDuring();
  assert.equal(ran.length, count, `the harness should have come up ${count} time(s) during the kit's runs, got: ${show(ran)}`);
  for (const one of ran) {
    assert.equal(one.command, 'terminal wait', `it comes up at the kit's look at the tab, got: ${show(one)}`);
    assert.ok(Array.isArray(one.argv) && one.argv.length > 0, `the program it ran is listed, got: ${show(one)}`);
    assert.equal(typeof one.stdout, 'string', `got: ${show(one)}`);
    assert.equal(typeof one.stderr, 'string', `got: ${show(one)}`);
    assert.equal(one.status, 0, `nothing it ran should have failed: ${one.stderr}`);
  }
}

/** The book names `id` for `bot`/`session`: the kit took the hook's report as that session's. */
async function assertBookNames(bots, bot, session, id) {
  const entry = await sessionIn(bots, bot, session);
  assert.equal(entry?.session, id, `the book should name the conversation the harness reported, got: ${show(entry)}`);
}

// ------------------------------------------------------------ the records

/** Where Claude Code keeps conversation `id` of the bot home `home` (a real path). */
const claudeFileOf = (box, home, id) => path.join(box.home, '.claude', 'projects', home.replaceAll(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);

/** Every Codex rollout file of conversation `id` under the sandbox home, as paths relative to ~/.codex/sessions. */
async function codexFilesOf(box, id) {
  const root = path.join(box.home, '.codex', 'sessions');
  let names;
  try {
    names = await readdir(root, { recursive: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return names.filter((name) => name.endsWith(`-${id}.jsonl`)).sort();
}

/** The one Codex rollout file of `id`, its name checked against Codex's own: `<yyyy>/<mm>/<dd>/rollout-<yyyy-mm-ddThh-mm-ss>-<id>.jsonl`. */
async function codexFileOf(box, id) {
  const found = await codexFilesOf(box, id);
  assert.equal(found.length, 1, `Codex keeps one rollout file for ${id}, got: ${show(found)}`);
  const shape = new RegExp(`^(\\d{4})/(\\d{2})/(\\d{2})/rollout-(\\d{4})-(\\d{2})-(\\d{2})T\\d{2}-\\d{2}-\\d{2}-${id}\\.jsonl$`);
  const parts = shape.exec(found[0].split(path.sep).join('/'));
  assert.ok(parts, `the rollout file should be named as Codex names it, got: ${found[0]}`);
  assert.deepEqual(parts.slice(1, 4), parts.slice(4, 7), `it is filed under the day its name carries, got: ${found[0]}`);
  return path.join(box.home, '.codex', 'sessions', found[0]);
}

/** The JSON lines of a record. */
async function linesOf(file) {
  return (await readFile(file, 'utf8')).split('\n').filter((line) => line !== '').map((line) => JSON.parse(line));
}

/** A time the harness wrote: an ISO string, from inside the run. */
function assertWrittenDuring(stamp, run, what) {
  assert.equal(typeof stamp, 'string', `${what}: a timestamp, got: ${show(stamp)}`);
  assert.equal(new Date(stamp).toISOString(), stamp, `${what}: an ISO time, got: ${stamp}`);
  const at = Date.parse(stamp);
  assert.ok(at >= run.from && at <= run.to, `${what}: written during the kit's run (${new Date(run.from).toISOString()} to ${new Date(run.to).toISOString()}), got: ${stamp}`);
}

/** Claude Code's user turn for a start prompt, as 2.1.328 wrote it. */
function assertClaudeTurn(line, { id, home, prompt, run }) {
  const { uuid, timestamp, ...rest } = line ?? {};
  assert.deepEqual(rest, {
    parentUuid: null,
    isSidechain: false,
    type: 'user',
    message: { role: 'user', content: prompt },
    userType: 'external',
    cwd: home,
    sessionId: id,
  }, `the user turn in Claude Code's shape, got: ${show(line)}`);
  assert.match(String(uuid), UUID, `the line has a uuid of its own, got: ${show(line)}`);
  assertWrittenDuring(timestamp, run, 'the user turn');
}

/** Codex's user turn for a start prompt, as 0.156.1 wrote it. */
function assertCodexTurn(line, { prompt, run }) {
  const { timestamp, ...rest } = line ?? {};
  assert.deepEqual(rest, {
    type: 'response_item',
    payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] },
  }, `the user turn in Codex's shape, got: ${show(line)}`);
  assertWrittenDuring(timestamp, run, 'the user turn');
}

/** Codex's first line of a conversation. */
function assertCodexMeta(line, { id, home, run }) {
  const { timestamp, payload, ...rest } = line ?? {};
  assert.deepEqual(rest, { type: 'session_meta' }, `the first line is the session_meta line, got: ${show(line)}`);
  const { timestamp: started, ...said } = payload ?? {};
  assert.deepEqual(said, { id, cwd: home }, `it names the conversation and its folder, got: ${show(line)}`);
  assertWrittenDuring(timestamp, run, 'the session_meta line');
  assertWrittenDuring(started, run, 'the session_meta payload');
}

/** Promise 1b: the record of a fresh start, checked whole. */
async function assertFreshRecord(box, { harness, home, id, prompt, run }) {
  if (harness === 'claude') {
    const lines = await linesOf(claudeFileOf(box, home, id));
    assert.equal(lines.length, 1, `a fresh record holds the start prompt's turn, got: ${show(lines)}`);
    assertClaudeTurn(lines[0], { id, home, prompt, run });
  } else {
    const lines = await linesOf(await codexFileOf(box, id));
    assert.equal(lines.length, 2, `a fresh rollout holds its session_meta line and the turn, got: ${show(lines)}`);
    assertCodexMeta(lines[0], { id, home, run });
    assertCodexTurn(lines[1], { prompt, run });
  }
}

// ------------------------------------------------------------ a start

for (const harness of ['claude', 'codex']) {
  test(`on ${harness}, a short start prompt: the harness comes up in the run, writes its record and reports it (1a, 1b, 1c, 4)`, async (t) => {
    const box = await createSandbox(t);
    const bots = await init(box);
    const home = await makeBot(box, 'api-bot', harness, [['daily', SHORT]]);
    await harnessComesUp(box, { bots, bot: 'api-bot', session: 'daily', harness, id: conv(1) });

    const run = await runJson(box, ['up', '--bots', 'bots', '--bot', 'api-bot']);

    await assertStarts(box, 1);
    await assertBookNames(bots, 'api-bot', 'daily', conv(1));
    await assertFreshRecord(box, { harness, home, id: conv(1), prompt: SHORT, run });
    assert.equal(entryOf(run, 'api-bot', 'daily').promptReceived, true, `got: ${run.stdout}`);
  });

  test(`on ${harness}, a long start prompt from the kit's file reaches the record word for word (1a, 1b)`, async (t) => {
    const box = await createSandbox(t);
    const bots = await init(box);
    const home = await makeBot(box, 'api-bot', harness, [['daily', LONG]]);
    await harnessComesUp(box, { bots, bot: 'api-bot', session: 'daily', harness, id: conv(1) });

    const run = await runJson(box, ['up', '--bots', 'bots', '--bot', 'api-bot']);

    // The premise: this prompt goes on the line from a file, not as its text.
    const line = await launchLineInTab(box, entryOf(run, 'api-bot', 'daily').tabId);
    assert.match(String(line), / -- "\$\(cat [^)]+\)"$/, `the premise: the kit reads a long prompt from its file, got: ${line}`);

    await assertStarts(box, 1);
    await assertBookNames(bots, 'api-bot', 'daily', conv(1));
    await assertFreshRecord(box, { harness, home, id: conv(1), prompt: LONG, run });
    assert.equal(entryOf(run, 'api-bot', 'daily').promptReceived, true, `got: ${run.stdout}`);
  });
}

test('on claude, the harness carries the words of the kit\'s line, as ps shows them to the hook (1c)', async (t) => {
  // The hook reads the line of the Claude Code process above it through ps,
  // and notes in the book the kit's appended file that line names (`system`),
  // or `bare: true` when it names none. Only the line's own words give it the
  // right name.
  const box = await createSandbox(t);
  const bots = await init(box);
  await makeBot(box, 'api-bot', 'claude', [['daily', SHORT]]);
  await harnessComesUp(box, { bots, bot: 'api-bot', session: 'daily', id: conv(1) });

  const run = await runJson(box, ['up', '--bots', 'bots', '--bot', 'api-bot']);

  const words = harnessWordsOf(String(await launchLineInTab(box, entryOf(run, 'api-bot', 'daily').tabId)));
  const at = words.indexOf(SYSTEM_FLAG);
  assert.ok(at > 0, `the premise: the kit's line appends its system file, got: ${show(words)}`);

  await assertStarts(box, 1);
  const entry = await sessionIn(bots, 'api-bot', 'daily');
  assert.equal(entry?.session, conv(1), `got: ${show(entry)}`);
  assert.equal(entry?.system, path.basename(words[at + 1]), `the hook read the line's appended file off the harness, got: ${show(entry)}`);
  assert.equal(entry?.bare, undefined, `and did not take the line for one that appends nothing, got: ${show(entry)}`);
});

test('on claude, `input` reaches the hook: the model it names is noted with the conversation (1c)', async (t) => {
  // A start on the kit's line notes the conversation as a source of the bot's
  // main text, with the model from the SessionStart input; with no model in
  // the input it notes nothing (src/main-text.js noteSource). The note is the
  // kit's own file: <bots>.claude-text/<bot>/sources/<id>.json.
  const sourceOf = (bots, id) => path.join(`${bots}.claude-text`, 'api-bot', 'sources', `${id}.json`);

  const withModel = await createSandbox(t);
  const bots = await init(withModel);
  await makeBot(withModel, 'api-bot', 'claude', [['daily', SHORT]]);
  await harnessComesUp(withModel, { bots, bot: 'api-bot', session: 'daily', id: conv(1), input: { model: 'claude-test-model-7' } });
  await runJson(withModel, ['up', '--bots', 'bots', '--bot', 'api-bot']);

  await assertStarts(withModel, 1);
  await assertBookNames(bots, 'api-bot', 'daily', conv(1));
  let note;
  try {
    note = JSON.parse(await readFile(sourceOf(bots, conv(1)), 'utf8'));
  } catch (error) {
    assert.fail(`the start should be noted at ${sourceOf(bots, conv(1))}: ${error.message}`);
  }
  assert.equal(note.conversation, conv(1), `got: ${show(note)}`);
  assert.equal(note.model, 'claude-test-model-7', `the model came from the input, got: ${show(note)}`);

  // The control: the same start with no `input` gives the hook no model, so nothing is noted.
  const without = await createSandbox(t);
  const otherBots = await init(without);
  await makeBot(without, 'api-bot', 'claude', [['daily', SHORT]]);
  await harnessComesUp(without, { bots: otherBots, bot: 'api-bot', session: 'daily', id: conv(2) });
  await runJson(without, ['up', '--bots', 'bots', '--bot', 'api-bot']);

  await assertStarts(without, 1);
  await assertBookNames(otherBots, 'api-bot', 'daily', conv(2));
  await assert.rejects(readFile(sourceOf(otherBots, conv(2)), 'utf8'), { code: 'ENOENT' }, 'the input carries no model of its own');
});

// ------------------------------------------------------------ only that session

test('another session of the same bot in the same run has no harness coming up (3)', async (t) => {
  // The armed session is launched second, so the next look at any tab is not it.
  const box = await createSandbox(t);
  const bots = await init(box);
  const home = await makeBot(box, 'api-bot', 'claude', [['daily', SHORT], ['nightly', `${SHORT} At night.`]]);
  await harnessComesUp(box, { bots, bot: 'api-bot', session: 'nightly', id: conv(1) });

  const run = await runJson(box, ['up', '--bots', 'bots', '--bot', 'api-bot']);

  await assertStarts(box, 1);
  await assertBookNames(bots, 'api-bot', 'nightly', conv(1));
  await assertFreshRecord(box, { harness: 'claude', home, id: conv(1), prompt: `${SHORT} At night.`, run });
  assert.equal(entryOf(run, 'api-bot', 'nightly').promptReceived, true, `the armed session, got: ${run.stdout}`);

  assert.equal(entryOf(run, 'api-bot', 'daily').promptReceived, false, `the other session, got: ${run.stdout}`);
  assert.equal((await sessionIn(bots, 'api-bot', 'daily'))?.session, undefined, 'the book names no conversation for the other session');
});

test('a session of the same name in another bot, in the same run, has no harness coming up (3)', async (t) => {
  // alpha-bot comes up before zeta-bot, so the next look at any tab is not the armed one.
  const box = await createSandbox(t);
  const bots = await init(box);
  await makeBot(box, 'alpha-bot', 'claude', [['daily', SHORT]]);
  const home = await makeBot(box, 'zeta-bot', 'codex', [['daily', SHORT]]);
  await harnessComesUp(box, { bots, bot: 'zeta-bot', session: 'daily', harness: 'codex', id: conv(1) });

  const run = await runJson(box, ['up', '--bots', 'bots']);

  await assertStarts(box, 1);
  await assertBookNames(bots, 'zeta-bot', 'daily', conv(1));
  await assertFreshRecord(box, { harness: 'codex', home, id: conv(1), prompt: SHORT, run });
  assert.equal(entryOf(run, 'zeta-bot', 'daily').promptReceived, true, `the armed session, got: ${run.stdout}`);

  assert.equal(entryOf(run, 'alpha-bot', 'daily').promptReceived, false, `the other bot's session, got: ${run.stdout}`);
  assert.equal((await sessionIn(bots, 'alpha-bot', 'daily'))?.session, undefined, 'the book names no conversation for the other bot\'s session');
});

// ------------------------------------------------------------ once

test('once per call: a later launch of the same session has no harness coming up (2)', async (t) => {
  const box = await createSandbox(t);
  const bots = await init(box);
  const home = await makeBot(box, 'api-bot', 'claude', [['daily', SHORT]]);
  await harnessComesUp(box, { bots, bot: 'api-bot', session: 'daily', id: conv(1) });

  const first = await runJson(box, ['up', '--bots', 'bots', '--bot', 'api-bot']);
  assert.equal(entryOf(first, 'api-bot', 'daily').promptReceived, true, `the armed launch, got: ${first.stdout}`);
  await assertStarts(box, 1);

  // With its record gone, the conversation cannot be resumed, so the restart
  // starts the session again, its prompt on the line: a launch the harness
  // would come up for, had the test said so again.
  const file = claudeFileOf(box, home, conv(1));
  await rm(file);
  const again = await runJson(box, ['restart', '--bots', 'bots', '--bot', 'api-bot', '--session', 'daily']);
  const entry = entryOf(again, 'api-bot', 'daily');
  assert.equal(entry.resumed, false, `the premise: the restart starts the session again, got: ${again.stdout}`);

  await assertStarts(box, 1);
  assert.equal(entry.promptReceived, false, `no harness came up this time, got: ${again.stdout}`);
  await assert.rejects(readFile(file, 'utf8'), { code: 'ENOENT' }, 'and nothing wrote its record again');
});

// ------------------------------------------------------------ a record already there

for (const harness of ['claude', 'codex']) {
  test(`on ${harness}, a record of the conversation there already: the turn goes at its end and the earlier lines stay (1b)`, async (t) => {
    // The book names no conversation, so the launch carries the prompt; the
    // harness reports a conversation whose record is on disk already. A real
    // resume carries no prompt (see the next test), so this is the way to put
    // a prompt's turn at the end of a record that is there.
    const box = await createSandbox(t);
    const bots = await init(box);
    const home = await makeBot(box, 'api-bot', harness, [['daily', SHORT]]);
    const file = await conversationOnRecord(box, { harness, cwd: home, id: conv(1) });
    const earlier = harness === 'claude'
      ? { type: 'assistant', sessionId: conv(1), cwd: home, message: { role: 'assistant', content: [{ type: 'text', text: 'Earlier.' }] }, timestamp: '2026-11-01T08:00:00.000Z' }
      : { timestamp: '2026-11-01T08:00:00.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Earlier.' }] } };
    await appendFile(file, `${JSON.stringify(earlier)}\n`);
    const before = await readFile(file, 'utf8');
    await harnessComesUp(box, { bots, bot: 'api-bot', session: 'daily', harness, id: conv(1), source: 'resume' });

    const run = await runJson(box, ['up', '--bots', 'bots', '--bot', 'api-bot']);

    await assertStarts(box, 1);
    await assertBookNames(bots, 'api-bot', 'daily', conv(1));
    if (harness === 'codex') assert.deepEqual(await codexFilesOf(box, conv(1)), [path.relative(path.join(box.home, '.codex', 'sessions'), file)], 'no second rollout file for the same conversation');
    const after = await readFile(file, 'utf8');
    assert.ok(after.startsWith(before), `the earlier lines stay as they were, got:\n${after}`);
    const added = after.slice(before.length).split('\n').filter((line) => line !== '').map((line) => JSON.parse(line));
    assert.equal(added.length, 1, `one line is added: the user turn, got: ${show(added)}`);
    if (harness === 'claude') assertClaudeTurn(added[0], { id: conv(1), home, prompt: SHORT, run });
    else assertCodexTurn(added[0], { prompt: SHORT, run });
    // No promptReceived here: the kit counts only a record that began after
    // its launch (src/conversations.js transcriptsIn, from the book's
    // `launched`), and this one began before it. That is the kit's rule, not
    // the helper's.
  });
}

test('a resume: a restart that resumes the conversation, source resume, keeps the record\'s lines (1b, 1c, 4)', async (t) => {
  // The book names a conversation with a record, so the restart resumes it.
  // A resume line carries no start prompt (src/up.js gives a prompt only to a
  // fresh start), so the report has no promptReceived for it to say; what the
  // harness must still do is come up, report, and leave the record whole.
  const box = await createSandbox(t);
  const bots = await init(box);
  const home = await makeBot(box, 'api-bot', 'claude', [['daily', SHORT]]);
  await runJson(box, ['up', '--bots', 'bots', '--bot', 'api-bot']);
  const tab = (await sessionIn(bots, 'api-bot', 'daily'))?.tab;
  const reported = await recordSession(box, { bots, bot: 'api-bot', tab, session: conv(1), source: 'startup', cwd: home });
  assert.equal(reported.code, 0, reported.stderr);
  await assertBookNames(bots, 'api-bot', 'daily', conv(1));
  const file = await conversationOnRecord(box, { harness: 'claude', cwd: home, id: conv(1) });
  await appendFile(file, `${JSON.stringify({ parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: SHORT }, uuid: '11111111-2222-4333-8444-555555555555', timestamp: '2026-11-01T08:00:00.000Z', userType: 'external', cwd: home, sessionId: conv(1) })}\n`);
  const before = await readFile(file, 'utf8');
  await harnessComesUp(box, { bots, bot: 'api-bot', session: 'daily', id: conv(1), source: 'resume' });

  const run = await runJson(box, ['restart', '--bots', 'bots', '--bot', 'api-bot', '--session', 'daily']);

  assert.equal(entryOf(run, 'api-bot', 'daily').resumed, true, `the premise: the restart resumes the conversation, got: ${run.stdout}`);
  await assertStarts(box, 1);
  await assertBookNames(bots, 'api-bot', 'daily', conv(1));
  const after = await readFile(file, 'utf8');
  assert.ok(after.startsWith(before), `the earlier lines stay as they were, got:\n${after}`);
});

// ------------------------------------------------------------ unpause

test('on codex, an unpause that starts the session fresh: the harness comes up in the run (1b, 4)', async (t) => {
  const box = await createSandbox(t);
  const bots = await init(box);
  const home = await makeBot(box, 'api-bot', 'codex', [['daily', SHORT]]);
  const paused = await box.run(['pause', '--bots', 'bots', '--bot', 'api-bot']);
  assert.equal(paused.code, 0, `the pause this test stands on did not happen: ${paused.stderr}`);
  await harnessComesUp(box, { bots, bot: 'api-bot', session: 'daily', harness: 'codex', id: conv(1) });

  const run = await runJson(box, ['unpause', '--bots', 'bots', '--bot', 'api-bot']);

  await assertStarts(box, 1);
  await assertBookNames(bots, 'api-bot', 'daily', conv(1));
  await assertFreshRecord(box, { harness: 'codex', home, id: conv(1), prompt: SHORT, run });
  assert.equal(entryOf(run, 'api-bot', 'daily').promptReceived, true, `got: ${run.stdout}`);
});

// ------------------------------------------------------------ the harness's version

/** The versions each harness writes into its record, as the real ones do. */
const VERSIONS = { claude: '2.1.328', codex: '0.156.1' };

test('on codex, `version` is the cli_version of the session_meta line of a new rollout', async (t) => {
  // The kit reads Codex's `cli_version` (#391). Without `version`, the payload
  // has no such key: the tests above pin the payload whole.
  const box = await createSandbox(t);
  const bots = await init(box);
  const home = await makeBot(box, 'api-bot', 'codex', [['daily', SHORT]]);
  await harnessComesUp(box, { bots, bot: 'api-bot', session: 'daily', harness: 'codex', id: conv(1), version: VERSIONS.codex });

  const run = await runJson(box, ['up', '--bots', 'bots', '--bot', 'api-bot']);

  await assertStarts(box, 1);
  await assertBookNames(bots, 'api-bot', 'daily', conv(1));
  const lines = await linesOf(await codexFileOf(box, conv(1)));
  assert.equal(lines.length, 2, `a fresh rollout holds its session_meta line and the turn, got: ${show(lines)}`);
  const { cli_version: version, ...payload } = lines[0]?.payload ?? {};
  assert.equal(version, VERSIONS.codex, `the session_meta payload carries the version, got: ${show(lines[0])}`);
  assertCodexMeta({ ...lines[0], payload }, { id: conv(1), home, run });
  assertCodexTurn(lines[1], { prompt: SHORT, run });
  assert.equal(entryOf(run, 'api-bot', 'daily').promptReceived, true, `got: ${run.stdout}`);
});

test('on claude, `version` is the version of the user-turn line', async (t) => {
  // Claude Code writes `version` on its lines. Without `version`, the line has
  // no such key: the tests above pin the line whole.
  const box = await createSandbox(t);
  const bots = await init(box);
  const home = await makeBot(box, 'api-bot', 'claude', [['daily', SHORT]]);
  await harnessComesUp(box, { bots, bot: 'api-bot', session: 'daily', id: conv(1), version: VERSIONS.claude });

  const run = await runJson(box, ['up', '--bots', 'bots', '--bot', 'api-bot']);

  await assertStarts(box, 1);
  await assertBookNames(bots, 'api-bot', 'daily', conv(1));
  const lines = await linesOf(claudeFileOf(box, home, conv(1)));
  assert.equal(lines.length, 1, `a fresh record holds the start prompt's turn, got: ${show(lines)}`);
  const { version, ...line } = lines[0] ?? {};
  assert.equal(version, VERSIONS.claude, `the user turn carries the version, got: ${show(lines[0])}`);
  assertClaudeTurn(line, { id: conv(1), home, prompt: SHORT, run });
  assert.equal(entryOf(run, 'api-bot', 'daily').promptReceived, true, `got: ${run.stdout}`);
});

for (const harness of ['claude', 'codex']) {
  test(`on ${harness}, with \`version\` and a record there already, the lines there stay and no session_meta line is added`, async (t) => {
    // The conversation goes on in the same file: the turn goes at its end, and
    // only Claude Code's turn carries a version of its own.
    const box = await createSandbox(t);
    const bots = await init(box);
    const home = await makeBot(box, 'api-bot', harness, [['daily', SHORT]]);
    const file = await conversationOnRecord(box, { harness, cwd: home, id: conv(1), ...(harness === 'codex' ? { cliVersion: '0.150.0' } : {}) });
    const before = await readFile(file, 'utf8');
    await harnessComesUp(box, { bots, bot: 'api-bot', session: 'daily', harness, id: conv(1), source: 'resume', version: VERSIONS[harness] });

    const run = await runJson(box, ['up', '--bots', 'bots', '--bot', 'api-bot']);

    await assertStarts(box, 1);
    await assertBookNames(bots, 'api-bot', 'daily', conv(1));
    if (harness === 'codex') assert.deepEqual(await codexFilesOf(box, conv(1)), [path.relative(path.join(box.home, '.codex', 'sessions'), file)], 'no second rollout file for the same conversation');
    const after = await readFile(file, 'utf8');
    assert.ok(after.startsWith(before), `the lines there stay as they were, the version of the first one included, got:\n${after}`);
    const added = after.slice(before.length).split('\n').filter((one) => one !== '').map((one) => JSON.parse(one));
    assert.equal(added.length, 1, `one line is added, the user turn, and no session_meta line, got: ${show(added)}`);
    if (harness === 'claude') {
      const { version, ...line } = added[0];
      assert.equal(version, VERSIONS.claude, `the user turn carries the version, got: ${show(added[0])}`);
      assertClaudeTurn(line, { id: conv(1), home, prompt: SHORT, run });
    } else {
      assertCodexTurn(added[0], { prompt: SHORT, run });
    }
  });
}
