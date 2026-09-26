// Bringing a session back (PRD 4.5, 6.5): the tab was closed, or the machine
// was rebooted, and the conversation is still there in the harness. Orca cannot
// help — it drops its resume record with the tab — so the book is what knows
// the id (ADR 0012), and `up` hands it back to the harness.
//
// So a session whose tab is gone comes back two different ways, and which one
// depends only on whether the book holds a harness session for it:
//
//   it does     a new tab, and the launch line resumes that session
//   it does not a new tab, a fresh harness, and the start prompt on the line
//
// A resumed session is not told its duty again. It has not forgotten it: PRD
// 6.4 sends the start prompt once when the tab is created, never on a resume,
// and again only after a clear, which is the hook's work and not this run's.
// Sending it here would put the same instruction into a conversation that is
// already carrying out the last one.
//
// Everything else about the launch line is what it always was. The approval
// level, the model, the effort, the context window, the work dir and the user's
// own extra arguments are all still there, in the same order, because a
// resumed session runs at the same settings as the one it continues — and the
// two harnesses differ only in where the id goes: Claude Code takes
// `--resume <id>` as a flag, Codex takes `resume` as a subcommand.
//
// The tests read the line the kit typed and then run it through a real shell
// against a fake harness, so what is checked is the argv a real harness would
// have been handed.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  assertOrcaCallsAllowed,
  bareLaunch,
  botHomeOf,
  conversationOnRecord,
  createSandbox,
  fakeProgram,
  harnessPartOf,
  launchLine,
  orcaCallsOf,
  recordSession,
  sessionIn,
  sh,
  tabsOfBot,
  typedInto,
} from './helpers/cli.js';

const PROMPT = 'Read your AGENTS.md and keep the queue moving.';

/** A bots folder with one bot on `harness`, one session with `settings`, brought up once. */
async function started(box, harness, settings = ['--prompt', PROMPT]) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', harness])).code, 0);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily', ...settings]);
  assert.equal(added.code, 0, added.stderr);

  const bots = box.path('bots');
  const first = await up(box);
  return { bots, first };
}

/** Bring the bot up, and give back the one session tab's entry and the line typed into it. */
async function up(box, flags = []) {
  const result = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot', '--json', ...flags]);
  assert.equal(result.code, 0, result.stderr);
  const answer = JSON.parse(result.stdout);
  assert.equal(answer.tabs.length, 1, `the bot has one session tab, got: ${result.stdout}`);
  const tabs = await tabsOfBot(box, box.path('bots'), 'api-bot');
  const live = tabs.find((terminal) => terminal.tabId === answer.tabs[0].tabId);
  assert.ok(live, `the tab reported should be one Orca has, got: ${result.stdout}`);
  return { entry: answer.tabs[0], typed: typedInto(live), result };
}

/** The session's tab, closed the way a user closes one: Orca simply stops listing it. */
async function closeTab(box, tabId) {
  await box.orca.set({
    terminals: (await box.orca.terminals()).filter((terminal) => terminal.tabId !== tabId),
  });
}

/** Tell the book what the harness is running as, the way the kit's hook does. */
const reported = (box, bots, tab, session, source = 'startup') =>
  recordSession(box, { bots, bot: 'api-bot', tab, session, source });

/**
 * Leave the conversation on the harness's own record, as a session that has
 * had a turn has it: what a resume picks up, where an id with nothing behind
 * it is started fresh instead (#295).
 */
const onRecord = (box, harness, bots, id) =>
  conversationOnRecord(box, { harness, cwd: botHomeOf(bots, 'api-bot'), id });

/** The arguments a shell running `line` hands the harness. */
async function argvOf(box, line, fake) {
  const ran = await sh(line, { cwd: box.cwd, env: box.env });
  assert.equal(ran.code, 0, `the line should run: ${line}\n${ran.stderr}`);
  const calls = await fake.calls();
  assert.equal(calls.length, 1, `the line should start the harness once, and only once: ${line}`);
  return calls[0].args;
}

/** The settings part of a launch line's argv: everything before the prompt separator. */
function settingsOnly(argv) {
  const at = argv.indexOf('--');
  return at < 0 ? argv : argv.slice(0, at);
}

/**
 * The arguments a bare launch line hands its harness: the line without the
 * mailbox step, `OBK_TAB_SHELL=…` and `OBK_CLI=…` in front of it and without
 * the harness word itself.
 */
const bareArgvOf = (box, harness) => harnessPartOf(bareLaunch(box, harness, 'api-bot', 'daily')).split(' ').slice(3);

/**
 * The launch arguments with the resume words taken out, whichever harness's
 * form they took: Codex's `resume` subcommand, Claude Code's `--resume` flag,
 * and the id itself. What is left has to be exactly the settings a fresh
 * session is started with.
 */
function withoutResume(argv, id) {
  const left = [];
  for (let at = 0; at < argv.length; at += 1) {
    if (argv[at] === '--resume') {
      at += 1;
      continue;
    }
    if (argv[at] === id || (at === 0 && argv[at] === 'resume')) continue;
    left.push(argv[at]);
  }
  return left;
}

test('claude resumes the session the book holds, and is not told its duty again', async (t) => {
  const box = await createSandbox(t);
  const fake = await fakeProgram(box, 'claude', {});
  const { bots, first } = await started(box, 'claude');
  await reported(box, bots, first.entry.tabId, 'sess-1');
  await onRecord(box, 'claude', bots, 'sess-1');
  await closeTab(box, first.entry.tabId);

  const again = await up(box);

  assert.equal(again.typed.length, 1, `one send per tab the kit opens, got: ${JSON.stringify(again.typed)}`);
  const line = again.typed[0];
  assert.ok(line.includes('--resume sess-1'), `Claude Code resumes through the flag, got: ${line}`);
  assert.ok(!line.includes(PROMPT), `the session already has its duty, got: ${line}`);

  const argv = await argvOf(box, line, fake);
  assert.equal(argv[argv.indexOf('sess-1') - 1], '--resume', 'the id belongs to the flag that asks for it');
  assert.deepEqual(
    withoutResume(argv, 'sess-1'),
    settingsOnly(bareArgvOf(box, 'claude')),
    'and every other setting is the one a fresh session is started with',
  );
  assert.equal(argv.includes('--'), false, 'and there is no prompt argument at all');
});

test('codex resumes the session the book holds, and is not told its duty again', async (t) => {
  const box = await createSandbox(t);
  const fake = await fakeProgram(box, 'codex', {});
  const { bots, first } = await started(box, 'codex');
  await reported(box, bots, first.entry.tabId, 'sess-1');
  await onRecord(box, 'codex', bots, 'sess-1');
  await closeTab(box, first.entry.tabId);

  const again = await up(box);

  assert.equal(again.typed.length, 1, `one send per tab the kit opens, got: ${JSON.stringify(again.typed)}`);
  const line = again.typed[0];
  assert.ok(line.startsWith(launchLine(box, 'codex resume ', { bot: 'api-bot', session: 'daily' })), `Codex resumes through the subcommand, got: ${line}`);
  assert.ok(!line.includes(PROMPT), `the session already has its duty, got: ${line}`);

  const argv = await argvOf(box, line, fake);
  assert.equal(argv[0], 'resume', `the subcommand comes first, got: ${JSON.stringify(argv)}`);
  assert.ok(argv.includes('sess-1'), `the id is handed over, got: ${JSON.stringify(argv)}`);
  assert.deepEqual(
    withoutResume(argv, 'sess-1'),
    settingsOnly(bareArgvOf(box, 'codex')),
    'and every other setting is where it was',
  );
  assert.equal(argv.includes('--'), false, 'and there is no prompt argument at all');
});

for (const [harness, settings, fresh] of [
  [
    'claude',
    ['--approval', 'ask', '--model', 'opus', '--context', '1m', '--effort', 'xhigh', '--extra-arg=--verbose'],
    ['--permission-mode', 'manual', '-n', 'api-bot.daily', '--model', 'opus[1m]', '--effort', 'xhigh', '--verbose'],
  ],
  [
    'codex',
    ['--approval', 'ask', '--model', 'gpt-5.4', '--effort', 'high', '--context', '200000', '--extra-arg=--search'],
    ['-a', 'on-request', '-c', 'sandbox_workspace_write.network_access=true', '-m', 'gpt-5.4', '-c', 'model_reasoning_effort=high', '-c', 'model_context_window=200000', '--search'],
  ],
]) {
  test(`a resumed ${harness} session keeps every setting, in the same order`, async (t) => {
    // The session that comes back is the one that went away: same approval
    // level, same model, same effort, same context, same extra arguments. A
    // resume that quietly dropped one would run for days at the harness's own
    // defaults with nothing to show for it.
    const box = await createSandbox(t);
    const fake = await fakeProgram(box, harness, {});
    const { bots, first } = await started(box, harness, [...settings, '--prompt', PROMPT]);
    await reported(box, bots, first.entry.tabId, 'sess-1');
    await onRecord(box, harness, bots, 'sess-1');
    await closeTab(box, first.entry.tabId);

    const again = await up(box);

    const argv = await argvOf(box, again.typed[0], fake);
    assert.deepEqual(withoutResume(argv, 'sess-1'), fresh);
  });
}

test('a resumed Codex session keeps its --add-dir for a work dir outside the bot home', async (t) => {
  // The work dir is a setting like any other, and Codex's auto-mode sandbox
  // still stops at the folder it was launched in.
  const box = await createSandbox(t);
  const fake = await fakeProgram(box, 'codex', {});
  const outside = path.join(box.root, 'clones', 'api');
  const { bots, first } = await started(box, 'codex', ['--work-dir', outside]);
  await reported(box, bots, first.entry.tabId, 'sess-1');
  await onRecord(box, 'codex', bots, 'sess-1');
  await closeTab(box, first.entry.tabId);

  const again = await up(box);

  assert.deepEqual(
    withoutResume(await argvOf(box, again.typed[0], fake), 'sess-1'),
    ['--approve-for-me', '-c', 'sandbox_workspace_write.network_access=true', '--add-dir', outside],
  );
});

test('the session that came back is the one the book named, and the book follows it', async (t) => {
  const box = await createSandbox(t);
  const { bots, first } = await started(box, 'claude');
  await reported(box, bots, first.entry.tabId, 'sess-1');
  await onRecord(box, 'claude', bots, 'sess-1');
  await closeTab(box, first.entry.tabId);

  const again = await up(box);

  const daily = await sessionIn(bots, 'api-bot', 'daily');
  assert.equal(daily.tab, again.entry.tabId, 'the new tab is the session\'s tab');
  assert.notEqual(again.entry.tabId, first.entry.tabId, 'a tab that comes back is a new tab');
  assert.equal(daily.session, 'sess-1', 'and the harness session it resumed is still the one it is running');
});

test('a session the book holds no id for comes up fresh, with its start prompt', async (t) => {
  // Nothing has ever reported for this session — the hook never ran, or the
  // book is new — so there is nothing to resume and the session starts over,
  // exactly as it did before this slice.
  const box = await createSandbox(t);
  const { first } = await started(box, 'codex');
  await closeTab(box, first.entry.tabId);

  const again = await up(box);

  assert.deepEqual(again.typed, [`${bareLaunch(box, 'codex', 'api-bot', 'daily')} -- '${PROMPT}'`]);
  assert.ok(!again.typed[0].includes('resume'), `there is nothing to resume, got: ${again.typed[0]}`);
});

test('a session whose tab is still open is left alone, id in the book or not', async (t) => {
  const box = await createSandbox(t);
  const { bots, first } = await started(box, 'claude');
  await reported(box, bots, first.entry.tabId, 'sess-1');
  const soFar = (await box.orca.calls()).length;

  const again = await up(box);

  assert.equal(again.entry.tabId, first.entry.tabId, 'the same tab');
  assert.deepEqual(again.typed, first.typed, 'nothing new was typed into a session in the middle of its work');
  assert.deepEqual(
    orcaCallsOf((await box.orca.calls()).slice(soFar), 'terminal send'),
    [],
    'a live session is never sent anything, resume or no resume',
  );
});

test('--json says a tab was resumed, and says so only of the tabs it opened', async (t) => {
  const box = await createSandbox(t);
  const { bots, first } = await started(box, 'claude');
  assert.equal(first.entry.resumed, false, 'the first run started a fresh harness');

  await reported(box, bots, first.entry.tabId, 'sess-1');
  await onRecord(box, 'claude', bots, 'sess-1');
  await closeTab(box, first.entry.tabId);
  const again = await up(box);

  assert.equal(again.entry.created, true);
  assert.equal(again.entry.resumed, true, 'this one picked the conversation up again');
  assert.equal('promptReceived' in again.entry, false, 'and told it nothing, so it has nothing to report');
});

test('--json says a tab was not resumed when it started a fresh session', async (t) => {
  const box = await createSandbox(t);
  const { first } = await started(box, 'codex');
  await closeTab(box, first.entry.tabId);

  const again = await up(box);

  assert.equal(again.entry.created, true);
  assert.equal(again.entry.resumed, false, 'nothing was in the book to come back to');
  assert.equal(
    again.entry.promptReceived,
    false,
    'so it was given its duty, as a new session is, and there is something to report: nothing on record holds it yet',
  );
});

test('the plain report tells a session that came back from one that started over', async (t) => {
  // The person reading the output is deciding whether to go and look at the
  // tab. "It is carrying on where it left off" and "it started again from
  // nothing" are different pieces of news, and the two must not read alike.
  const box = await createSandbox(t);
  const { bots, first } = await started(box, 'claude');
  await reported(box, bots, first.entry.tabId, 'sess-1');
  await onRecord(box, 'claude', bots, 'sess-1');
  await closeTab(box, first.entry.tabId);
  const resumed = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  const other = await createSandbox(t);
  const fresh = await started(other, 'claude');
  await closeTab(other, fresh.first.entry.tabId);
  const overAgain = await other.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(resumed.code, 0, resumed.stderr);
  assert.equal(overAgain.code, 0, overAgain.stderr);
  const said = (result, root) => result.stdout
    .split(root).join('<root>')
    .replaceAll(/\b(tab|term)_\d+\b/g, '<id>');
  assert.notEqual(
    said(resumed, box.root),
    said(overAgain, other.root),
    'a session that came back must not read like one that started over',
  );
  for (const result of [resumed, overAgain]) {
    assert.ok(!result.stdout.includes('undefined'), `nothing should be undefined, got: ${result.stdout}`);
  }
});

test('two sessions each come back as themselves', async (t) => {
  const box = await createSandbox(t);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude'])).code, 0);
  for (const name of ['daily', 'review']) {
    assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', name])).code, 0);
  }
  const bots = box.path('bots');
  assert.equal((await box.run(['up', '--bots', 'bots', '--bot', 'api-bot'])).code, 0);

  const book = await sessionIn(bots, 'api-bot', 'daily');
  const review = await sessionIn(bots, 'api-bot', 'review');
  await reported(box, bots, book.tab, 'sess-daily');
  await onRecord(box, 'claude', bots, 'sess-daily');
  await reported(box, bots, review.tab, 'sess-review');
  await onRecord(box, 'claude', bots, 'sess-review');
  await box.orca.set({ terminals: [] });
  assert.equal((await box.run(['up', '--bots', 'bots', '--bot', 'api-bot'])).code, 0);

  const lines = Object.fromEntries((await tabsOfBot(box, bots, 'api-bot')).map((tab) => [tab.title, typedInto(tab)[0]]));
  assert.ok(lines['Api Bot daily'].includes('sess-daily'), `got: ${JSON.stringify(lines)}`);
  assert.ok(!lines['Api Bot daily'].includes('sess-review'), 'one session must never be given another\'s conversation');
  assert.ok(lines['Api Bot review'].includes('sess-review'), `got: ${JSON.stringify(lines)}`);
});

test('a resume keeps to the allowed Orca commands, and closes nothing', async (t) => {
  const box = await createSandbox(t);
  const { bots, first } = await started(box, 'codex', ['--prompt', PROMPT, '--work-dir', 'work/api']);
  await reported(box, bots, first.entry.tabId, 'sess-1');
  await onRecord(box, 'codex', bots, 'sess-1');
  await closeTab(box, first.entry.tabId);

  const again = await up(box);

  assert.ok(again.typed[0].includes('sess-1'), `the run should have resumed, got: ${again.typed[0]}`);
  assertOrcaCallsAllowed(await box.orca.calls());
});
