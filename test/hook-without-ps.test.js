// When `ps` cannot run, the kit's hook records nothing, and says why (#791).
//
// The kit's SessionStart hook (`obk session record`, src/record.js) reads the
// process table with the bare `ps` on PATH: `ps -Ao pid=,ppid=,comm=` to tell
// that the report comes from the tab's own harness, and `ps -o args= -p <pid>`
// to read the launch line. Where `ps` cannot run (a sandbox that refuses it, a
// machine with none), the hook cannot place the report. To record nothing then
// is the safe direction, and the check guards the book. The fault was that the
// hook said nothing: the session lost its conversation id in the book, and a
// Claude Code session lost its main units, with no word to the user.
//
// What the hook does now, as the brief gives it:
//
//   R1  When `ps -Ao pid=,ppid=,comm=` cannot read the process table (it does
//       not start, it exits non-zero, or it lists no process), and the tab
//       (ORCA_TAB_ID) belongs to a session of this bot in the book: the book
//       is not changed at all; the hook exits 0 and prints one JSON line,
//       `{"hookSpecificOutput":{"hookEventName":<event>,"additionalContext":<text>}}`.
//       The text starts with a notice: it names `ps`, the reason ps gave (the
//       first line of its stderr, or else its exit status or the error code),
//       the conversation id the harness reported, that the kit did not record
//       it in the book, and `obk restart` and `obk health`. For a Claude Code
//       session the notice is followed by a blank line and the bot's main
//       units, as the hook gives them when ps works; for Codex, the notice
//       alone. A cleared or compacted session is not given its start prompt.
//   R2  When ps cannot run but the tab belongs to no session of this bot, or
//       there is no ORCA_TAB_ID, or the event has no session_id: nothing is
//       printed, exit 0, the book as it was (as before).
//   R5  The helpers that run the hook under a process chain
//       (helpers/cli.js throughAHarness, throughATab, recordSession) first ask
//       whether a bare `ps` runs with the suite's own environment, once per
//       process, and throw saying so when it does not.
//
// The wording of the notice is not pinned: only the parts above are. Where ps
// works nothing changes, and session-record.test.js and
// claude-main-text.test.js hold that.
//
// `ps` is broken for the one run under test, by the PATH of the environment
// handed to it (helpers/no-ps.js): the fake ps of helpers/fake-tools.js stands
// in only for /bin/ps by its fixed path, and a bare `ps` is the real one.
// Every run is in the sandbox (helpers/cli.js): its own HOME and a fake Orca.

import assert from 'node:assert/strict';
import { access, chmod, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import {
  bookOf,
  createSandbox,
  node,
  recordSession,
  repoRoot,
  sessionIn,
} from './helpers/cli.js';
import { refusingPs, withoutPs } from './helpers/no-ps.js';
import { mainUnitsText } from './helpers/rules.js';

const BOT = 'api-bot';
const PROMPT = 'Read your AGENTS.md and keep the harbour ledger.';

/** A bots folder holding one bot on `harness` with its session daily (with the start prompt), brought up. */
async function fleet(box, { harness = 'claude' } = {}) {
  const ok = async (args) => {
    const result = await box.run(args);
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
    return result;
  };
  await ok(['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', harness]);
  await ok(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily', '--prompt', PROMPT]);
  const up = await ok(['up', '--bots', 'bots', '--bot', BOT, '--json']);
  const bots = box.path('bots');
  const tab = JSON.parse(up.stdout).tabs.find((entry) => entry.name === 'daily').tabId;
  return { bots, tab };
}

const bookText = (bots) => readFile(bookOf(bots, BOT), 'utf8');

/**
 * What the hook printed: exactly one JSON line with the envelope, about
 * `event`, and nothing on stderr. Answers its text.
 */
function contextOf(result, event = 'SessionStart') {
  assert.equal(result.code, 0, `the hook never fails the session it runs in: ${result.stderr}`);
  assert.equal(result.stderr, '', `the hook prints its answer on stdout and nothing on stderr, got: ${result.stderr}`);
  assert.notEqual(result.stdout, '', 'when ps cannot run in a tab of this bot, the hook should say so in its answer, and it printed nothing');
  assert.ok(result.stdout.endsWith('\n') && !result.stdout.slice(0, -1).includes('\n'), `the answer is exactly one line, got: ${JSON.stringify(result.stdout)}`);
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    assert.fail(`the hook's answer must be the JSON the harness reads, got: ${result.stdout} (${error.message})`);
  }
  assert.deepEqual(Object.keys(answer), ['hookSpecificOutput'], `the envelope and nothing else, got: ${result.stdout}`);
  assert.deepEqual(Object.keys(answer.hookSpecificOutput).sort(), ['additionalContext', 'hookEventName'], `got: ${result.stdout}`);
  assert.equal(answer.hookSpecificOutput.hookEventName, event, 'the answer is about the event it was sent');
  const text = answer.hookSpecificOutput.additionalContext;
  assert.equal(typeof text, 'string', `got: ${result.stdout}`);
  return text;
}

/** The notice of a Claude Code session's text: all before a blank line and the main units, which end it. */
function noticeBeforeMain(text, main) {
  assert.ok(text.endsWith(`\n\n${main}`), `a Claude Code session's text is the notice, a blank line, then its main units as the hook gives them, got:\n${text}`);
  const notice = text.slice(0, text.length - main.length - 2);
  assert.notEqual(notice.trim(), '', `the text starts with a notice, got:\n${text}`);
  return notice;
}

/**
 * The parts every notice holds: `ps`, the reason (`reason`, a pattern, when
 * the test knows it), the conversation id, that it is not in the book, and the
 * two commands.
 */
function assertNotice(notice, { id, reason }) {
  assert.match(notice, /\bps\b/, `the notice names ps:\n${notice}`);
  if (reason !== undefined) assert.match(notice, reason, `the notice gives the reason ps gave:\n${notice}`);
  assert.ok(notice.includes(id), `the notice names the conversation id ${id} the harness reported:\n${notice}`);
  assert.match(notice, /\bbook\b/i, `the notice says the book did not get it:\n${notice}`);
  assert.match(notice, /\b(?:not|never|cannot|could not|did not|didn't)\b[^.]*\brecord/i, `the notice says the kit did not record it:\n${notice}`);
  assert.match(notice, /obk restart/, `the notice names obk restart, which cannot bring the conversation back:\n${notice}`);
  assert.match(notice, /obk health/, `the notice names obk health:\n${notice}`);
}

/** The premise: ps works here, so a first report fills the book as it should. */
async function recordedWithPs(box, bots, tab, session, source = 'startup') {
  const ran = await recordSession(box, { bots, bot: BOT, tab, session, source });
  assert.equal(ran.code, 0, ran.stderr);
  assert.equal((await sessionIn(bots, BOT, 'daily')).session, session, `the premise: with ps working the hook records ${session}`);
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- R1

test('HP1 ps refused: a Claude Code session gets the notice and its main units, and the book is as it was', async (t) => {
  const box = await createSandbox(t);
  const { bots, tab } = await fleet(box);
  const env = await refusingPs(box);
  const before = await bookText(bots);
  const id = 'conv-refused-first';

  const ran = await recordSession(box, { bots, bot: BOT, tab, env, session: id, source: 'startup' });

  const notice = noticeBeforeMain(contextOf(ran), await mainUnitsText(bots, BOT));
  assertNotice(notice, { id, reason: /operation not permitted/ });
  assert.equal(await bookText(bots), before, 'the book is not changed at all: no session id, no history, no notes');
  assert.equal(
    await exists(path.join(`${bots}.claude-text`, BOT, 'sources', `${id}.json`)),
    false,
    'and no note of the conversation as a source of the main text',
  );
});

test('HP2 ps exits non-zero with nothing on stderr: the notice gives its exit status, about the event it was sent', async (t) => {
  const box = await createSandbox(t);
  const { bots, tab } = await fleet(box);
  const env = await refusingPs(box, { stderr: '', code: 42 });
  const before = await bookText(bots);
  const id = 'conv-status-only';

  const ran = await recordSession(box, { bots, bot: BOT, tab, env, session: id, source: 'startup', event: 'SessionResumed' });

  const notice = noticeBeforeMain(contextOf(ran, 'SessionResumed'), await mainUnitsText(bots, BOT));
  assertNotice(notice, { id, reason: /\b42\b/ });
  assert.equal(await bookText(bots), before, 'the book is not changed at all');
});

test('HP3 no ps on PATH: the notice gives the error code ENOENT', async (t) => {
  const box = await createSandbox(t);
  const { bots, tab } = await fleet(box);
  const env = await withoutPs(box);
  const starts = await box.run(['--version'], { env });
  assert.equal(starts.code, 0, `the premise: the CLI starts with no ps on PATH: ${starts.stderr}`);
  const before = await bookText(bots);
  const id = 'conv-no-ps-there';

  const ran = await recordSession(box, { bots, bot: BOT, tab, env, session: id, source: 'startup' });

  const notice = noticeBeforeMain(contextOf(ran), await mainUnitsText(bots, BOT));
  assertNotice(notice, { id, reason: /ENOENT/ });
  assert.equal(await bookText(bots), before, 'the book is not changed at all');
});

test('HP4 ps lists no process: the hook says so all the same, and the book is as it was', async (t) => {
  const box = await createSandbox(t);
  const { bots, tab } = await fleet(box);
  const env = await refusingPs(box, { stderr: '', code: 0 });
  const before = await bookText(bots);
  const id = 'conv-empty-table';

  const ran = await recordSession(box, { bots, bot: BOT, tab, env, session: id, source: 'startup' });

  // The reason for an empty table is not pinned: the brief names stderr, the
  // exit status or the error code, and an empty table has none of them.
  assertNotice(noticeBeforeMain(contextOf(ran), await mainUnitsText(bots, BOT)), { id });
  assert.equal(await bookText(bots), before, 'the book is not changed at all');
});

for (const [name, source, id] of [['cleared', 'clear', 'conv-after-clear'], ['compacted', 'compact', 'conv-kept']]) {
  test(`HP5 a ${name} Claude Code session with ps refused gets no start prompt, only the notice and its main units`, async (t) => {
    const box = await createSandbox(t);
    const { bots, tab } = await fleet(box);
    await recordedWithPs(box, bots, tab, 'conv-kept');
    const env = await refusingPs(box);
    const before = await bookText(bots);

    const ran = await recordSession(box, { bots, bot: BOT, tab, env, session: id, source });

    const text = contextOf(ran);
    assert.equal(text.includes(PROMPT), false, `a ${name} session is not given its start prompt when ps cannot run, got:\n${text}`);
    assertNotice(noticeBeforeMain(text, await mainUnitsText(bots, BOT)), { id, reason: /operation not permitted/ });
    assert.equal(await bookText(bots), before, 'the book is not changed at all: the old id stays, and no history entry is added');
  });
}

for (const [name, first] of [['a first report', undefined], ['a new id after /new', 'conv-codex-before']]) {
  test(`HP6 a Codex session with ps refused, on ${name}, gets the notice alone`, async (t) => {
    const box = await createSandbox(t);
    const { bots, tab } = await fleet(box, { harness: 'codex' });
    if (first !== undefined) await recordedWithPs(box, bots, tab, first);
    const env = await refusingPs(box);
    const before = await bookText(bots);
    const id = 'conv-codex-now';

    const ran = await recordSession(box, { bots, bot: BOT, tab, env, session: id, source: 'startup' });

    const text = contextOf(ran);
    assertNotice(text, { id, reason: /operation not permitted/ });
    assert.equal(text.includes(PROMPT), false, `the notice alone: no start prompt, got:\n${text}`);
    assert.equal(/^## /m.test(text), false, `the notice alone: no rule unit, got:\n${text}`);
    assert.equal(await bookText(bots), before, 'the book is not changed at all');
  });
}

// ---------------------------------------------------------------- R2

test('HP7 ps refused, and the report is no session of this bot: nothing printed, the book as it was', async (t) => {
  const box = await createSandbox(t);
  const { bots, tab } = await fleet(box);
  const env = await refusingPs(box);
  const botFatherTab = (await sessionIn(bots, 'bot-father', 'daily'))?.tab;
  assert.equal(typeof botFatherTab, 'string', 'the premise: Bot Father daily has a tab in its book');

  const cases = [
    ['a tab no session holds', { tab: 'tab-of-nobody', session: 'conv-x' }],
    ["Bot Father's tab, for this bot", { tab: botFatherTab, session: 'conv-x' }],
    ['no ORCA_TAB_ID', { session: 'conv-x' }],
    ['an event with no session_id', { tab, stdin: `${JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', cwd: '/nowhere' })}\n` }],
  ];
  for (const [what, call] of cases) {
    const before = await bookText(bots);
    const ran = await recordSession(box, { bots, bot: BOT, env, ...call });
    assert.equal(ran.code, 0, `${what}: the hook never fails: ${ran.stderr}`);
    assert.equal(ran.stdout, '', `${what}: nothing to say, so nothing printed`);
    assert.equal(ran.stderr, '', `${what}: and nothing on the user's screen`);
    assert.equal(await bookText(bots), before, `${what}: the book as it was`);
  }
});

// ---------------------------------------------------------------- R5

/**
 * Run the three chain helpers in a Node process of their own, whose PATH is
 * `PATH`, and answer what each threw and how many times its `ps` ran. The box
 * is a stub: the check comes before any use of it.
 */
async function helpersUnder(box, { PATH, log }) {
  const helpers = pathToFileURL(path.join(repoRoot, 'test', 'helpers', 'cli.js')).href;
  const script = `
    import { readFileSync } from 'node:fs';
    import { recordSession, throughAHarness, throughATab } from ${JSON.stringify(helpers)};
    const box = {};
    const said = {};
    for (const [name, call] of [
      ['recordSession', () => recordSession(box, { bots: '/nowhere', bot: 'x', line: null, session: 's' })],
      ['recordSession again', () => recordSession(box, { bots: '/nowhere', bot: 'x', line: null, session: 's' })],
      ['throughAHarness', () => throughAHarness(box, 'true')],
      ['throughATab', () => throughATab(box, 'true')],
    ]) {
      try { await call(); said[name] = null; } catch (error) { said[name] = String(error && error.message); }
    }
    let runs = 0;
    try { runs = readFileSync(${JSON.stringify(log)}, 'utf8').split('\\n').filter(Boolean).length; } catch {}
    process.stdout.write(JSON.stringify({ said, runs }));
  `;
  const env = { HOME: box.home, TMPDIR: box.tmp, PATH };
  const ran = await node(['--input-type=module', '-e', script], { cwd: box.cwd, env });
  assert.equal(ran.code, 0, `the helper run: ${ran.stdout}${ran.stderr}`);
  return JSON.parse(ran.stdout);
}

/** A folder with a `ps` that writes a line to `log` at each run, then `stderr`, `stdout` and `code`. */
async function countingPs(box, { stderr = '', stdout = '', code }) {
  const dir = path.join(box.root, 'counting-ps');
  const log = path.join(box.root, 'counting-ps.log');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'ps'), [
    '#!/bin/sh',
    `echo ran >> '${log}'`,
    `printf '%s' '${stdout}'`,
    `printf '%s' '${stderr}' >&2`,
    `exit ${code}`,
    '',
  ].join('\n'));
  await chmod(path.join(dir, 'ps'), 0o755);
  return { dir, log };
}

/** Each helper threw, saying that ps cannot run here, why, and that the hook needs it. */
function assertSaidNoPs(said, reason) {
  for (const [name, message] of Object.entries(said)) {
    assert.notEqual(message, null, `${name} should refuse to run where ps cannot run`);
    assert.match(message, /`?ps`? cannot run/, `${name} says that ps cannot run here, got: ${message}`);
    assert.match(message, reason, `${name} gives ps's reason, got: ${message}`);
    assert.match(message, /hook/i, `${name} says that the kit's hook needs it, got: ${message}`);
  }
}

test('HP8 where ps is refused, the chain helpers say so first, and ask ps once per process', async (t) => {
  const box = await createSandbox(t);
  const { dir, log } = await countingPs(box, { stderr: 'ps: operation not permitted\n', code: 1 });

  const { said, runs } = await helpersUnder(box, { PATH: `${dir}${path.delimiter}/usr/bin${path.delimiter}/bin`, log });

  assertSaidNoPs(said, /operation not permitted/);
  assert.equal(runs, 1, `the check runs once per process and keeps its answer, and ps ran ${runs} times`);
});

test('HP9 where ps lists no process, the chain helpers say ps cannot run', async (t) => {
  const box = await createSandbox(t);
  const { dir, log } = await countingPs(box, { code: 0 });

  const { said } = await helpersUnder(box, { PATH: `${dir}${path.delimiter}/usr/bin${path.delimiter}/bin`, log });

  assertSaidNoPs(said, /no process/);
});

test('HP10 where there is no ps, the chain helpers give ENOENT', async (t) => {
  const box = await createSandbox(t);
  const dir = path.join(box.root, 'only-node');
  await mkdir(dir, { recursive: true });
  await symlink(process.execPath, path.join(dir, 'node'));

  const { said } = await helpersUnder(box, { PATH: dir, log: path.join(box.root, 'none.log') });

  assertSaidNoPs(said, /ENOENT/);
});
