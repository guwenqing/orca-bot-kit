// The start prompt: the one thing that tells one session's duty from another's
// when they come up in different tabs (PRD 6.4).
//
// It goes on the launch line, as the harness's own prompt argument, so there
// is exactly one send per new tab and the harness holds the prompt until it is
// ready for it. Proven live: a second send cannot be made safe. Orca reports
// Claude Code's folder-trust screen as `tui-idle`, `satisfied: true`, with no
// `blockedReason` — indistinguishable from a harness waiting for work — and
// that screen's selection starts on `No, exit`, so a prompt typed there
// confirms it and the harness quits.
//
// The prompt goes through the tab's shell, so quoting is the contract: it has
// to arrive at the harness byte for byte, with nothing expanded, split or run
// on the way. And it is one line — a newline in a harness TUI submits, and a
// newline in a shell word ends nothing useful either.
//
// A session with a work dir is told where it is, in a note carrying the
// absolute path, folded into the same word. A session with neither has no
// prompt word at all.

import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  assertOrcaCallsAllowed,
  BARE_LAUNCH,
  botHomeOf,
  createSandbox,
  fakeProgram,
  orcaCallsOf,
  orcaCommand,
  orcaFlag,
  orcaFlags,
  sh,
  tabsOfBot,
  typedInto,
} from './helpers/cli.js';

const PROMPT = 'Read your AGENTS.md and reply in one line with what this bot owns.';

/** A bots folder holding one Codex bot with one session, not yet brought up. */
async function withSession(box, settings, { harness = 'codex' } = {}) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', harness])).code, 0);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily', ...settings]);
  assert.equal(added.code, 0, added.stderr);
  return box.path('bots');
}

/** Bring the one bot up and give back its tab and what was typed into it. */
async function up(box, bots, args = []) {
  const result = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot', ...args]);
  const tabs = await tabsOfBot(box, bots, 'api-bot');
  assert.equal(tabs.length, 1, `the bot should have the one session tab, got ${JSON.stringify(tabs)}`);
  return { result, tab: tabs[0], typed: typedInto(tabs[0]) };
}

/** The one tab entry a `--json` run reported. */
function onlyTab(result) {
  assert.equal(result.code, 0, result.stderr);
  const answer = JSON.parse(result.stdout);
  assert.equal(answer.tabs.length, 1, `one tab should have been reported, got: ${result.stdout}`);
  return answer.tabs[0];
}

/** The arguments a shell running `line` hands the harness. */
async function argvOf(box, line, fake) {
  const ran = await sh(line, { cwd: box.cwd, env: box.env });
  assert.equal(ran.code, 0, `the line should run: ${line}\n${ran.stderr}`);
  const calls = await fake.calls();
  assert.equal(calls.length, 1, `the line should start the harness once, and only once: ${line}`);
  return calls[0].args;
}

test('the start prompt is the last word of the launch line, and the tab\'s one send', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSession(box, ['--prompt', PROMPT]);

  const { result, typed, tab } = await up(box, bots);

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(typed, [`${BARE_LAUNCH.codex} '${PROMPT}'`]);
  assert.deepEqual(tab.typed, [{ text: `${BARE_LAUNCH.codex} '${PROMPT}'`, enter: true }], 'the line has to be sent off');

  const sends = orcaCallsOf(await box.orca.calls(), 'terminal send')
    .filter((call) => orcaFlag(call, '--terminal') === tab.handle);
  assert.equal(sends.length, 1, 'one send per new session tab: the prompt is not a send of its own');
  assert.deepEqual(orcaFlags(sends[0]), ['--enter', '--json', '--terminal', '--text']);
});

test('the tab is still asked afterwards whether a TUI came up', async (t) => {
  // The send goes first and the wait is the check on it, as it always was: a
  // tab still at a shell prompt is refused with `timeout` however long you wait.
  const box = await createSandbox(t);
  const bots = await withSession(box, ['--prompt', PROMPT]);

  const { tab } = await up(box, bots);

  const mine = (await box.orca.calls())
    .filter((call) => orcaFlag(call, '--terminal') === tab.handle)
    .map(orcaCommand);
  assert.deepEqual(mine, ['terminal send', 'terminal wait']);
});

test('the prompt reaches the harness byte for byte, whatever the user put in it', async (t) => {
  // Everything a shell would otherwise do to it: expand, split, run. The
  // prompt is the user's text and the harness has to get the user's text.
  const box = await createSandbox(t);
  const fake = await fakeProgram(box, 'codex', {});
  const nasty = 'it\'s "fine" $HOME `date` && rm -rf x; echo \'hi\'';
  const bots = await withSession(box, ['--prompt', nasty]);

  const { typed } = await up(box, bots);

  assert.deepEqual(await argvOf(box, typed[0], fake), ['--approve-for-me', nasty]);
});

test('a prompt written over several lines arrives as one line', async (t) => {
  // A newline typed into a harness TUI submits what is there, so a prompt of
  // three lines would arrive as three half-prompts. It is one shell word, and
  // one line.
  const box = await createSandbox(t);
  const fake = await fakeProgram(box, 'codex', {});
  const bots = await withSession(box, []);
  await writeFile(
    path.join(botHomeOf(bots, 'api-bot'), 'bot.yaml'),
    'name: api-bot\nharness: codex\ncharter: mine\nrules: []\nskills: []\n'
    + 'sessions:\n  - name: daily\n    approval: auto\n    prompt: |\n'
    + '      You keep the API bot\'s day running.\n\n      Ask before you touch main.\n',
  );

  const { typed } = await up(box, bots);

  assert.ok(!typed[0].includes('\n'), `the line carries no newline, got: ${JSON.stringify(typed[0])}`);
  assert.deepEqual(
    await argvOf(box, typed[0], fake),
    ['--approve-for-me', 'You keep the API bot\'s day running. Ask before you touch main.'],
  );
});

test('a session with a work dir is told where it is, in a note carrying the absolute path', async (t) => {
  const box = await createSandbox(t);
  const fake = await fakeProgram(box, 'codex', {});
  const bots = await withSession(box, ['--prompt', PROMPT, '--work-dir', 'work/api']);

  const { typed } = await up(box, bots);

  const argv = await argvOf(box, typed[0], fake);
  // A work dir under the bot home brings no `--add-dir`, so the prompt is the
  // one argument after the approval flag, note and all in the one word.
  assert.deepEqual(argv.slice(0, 1), ['--approve-for-me']);
  assert.equal(argv.length, 2, `the prompt is one argument, got: ${JSON.stringify(argv)}`);
  const said = argv[1];
  assert.ok(said.includes(PROMPT), `the user's own prompt is still in it, got: ${said}`);
  assert.ok(
    said.includes(path.join(botHomeOf(bots, 'api-bot'), 'work', 'api')),
    `the note should name the work dir by its absolute path, got: ${said}`,
  );
  // PRD 6.4: it is a plain folder and has nothing to do with git worktrees. The
  // session has to be told, or it will treat it as a checkout of something.
  assert.match(said, /plain folder/i, `the note should say what the folder is, got: ${said}`);
  assert.match(said, /not a git worktree/i, `and what it is not, got: ${said}`);
  assert.ok(!said.includes('\n'), `and it is one line like the rest, got: ${JSON.stringify(said)}`);
});

test('a session with a work dir and no prompt still has the note to say', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSession(box, ['--work-dir', 'work/api']);

  const { result, typed } = await up(box, bots, ['--json']);

  assert.ok(
    typed[0].startsWith(`${BARE_LAUNCH.codex} '`),
    `the note is something to say, got: ${JSON.stringify(typed)}`,
  );
  assert.ok(typed[0].includes(path.join(botHomeOf(bots, 'api-bot'), 'work', 'api')));
  assert.equal(onlyTab(result).promptSent, true);
});

test('an absolute work dir reaches the note as it is', async (t) => {
  const box = await createSandbox(t);
  const elsewhere = path.join(box.root, 'clones', 'api');
  const bots = await withSession(box, ['--prompt', PROMPT, '--work-dir', elsewhere]);

  const { typed } = await up(box, bots);

  assert.ok(typed[0].includes(elsewhere), `the note should name ${elsewhere}, got: ${typed[0]}`);
});

test('a session with nothing to say gets a launch line with no prompt word', async (t) => {
  const box = await createSandbox(t);
  const fake = await fakeProgram(box, 'codex', {});
  const bots = await withSession(box, []);

  const { result, typed } = await up(box, bots, ['--json']);

  assert.deepEqual(typed, [BARE_LAUNCH.codex], 'the launch line, and that is all there was to say');
  assert.deepEqual(await argvOf(box, typed[0], fake), ['--approve-for-me'], 'no empty word on the end either');
  assert.equal(
    'promptSent' in onlyTab(result),
    false,
    'a session with nothing to say has nothing to report about it',
  );
});

test('a prompt on a line the harness took is reported as sent', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSession(box, ['--prompt', PROMPT]);

  const { result } = await up(box, bots, ['--json']);

  const entry = onlyTab(result);
  assert.equal(entry.harnessStarted, true);
  assert.equal(entry.promptSent, true);
});

test('a harness sitting on its trust question has the prompt already in its argv', async (t) => {
  // The first run of every new bot, and the whole point of the change: the
  // prompt is an argument the harness holds until the question is answered.
  const box = await createSandbox(t);
  const bots = await withSession(box, ['--prompt', PROMPT]);
  await box.orca.set({ waitIdle: 'blocked' });

  const { result, typed } = await up(box, bots, ['--json']);

  assert.deepEqual(typed, [`${BARE_LAUNCH.codex} '${PROMPT}'`], 'the line went in whole');
  const entry = onlyTab(result);
  assert.equal(entry.harnessStarted, true, 'a TUI that is up is a harness that started');
  assert.equal(entry.blockedReason, 'agent-interactive-prompt');
  assert.equal(entry.promptSent, true, 'the prompt is with the harness, waiting behind the question');
});

test('a harness that never came up took the duty with it, and the run says so', async (t) => {
  // No TUI in the tab: the shell swallowed the line, prompt and all.
  const box = await createSandbox(t);
  const bots = await withSession(box, ['--prompt', PROMPT]);
  await box.orca.set({ waitIdle: false });

  const { result, typed } = await up(box, bots, ['--json']);

  assert.deepEqual(typed, [`${BARE_LAUNCH.codex} '${PROMPT}'`], 'the line was still typed; it is the outcome that failed');
  const entry = onlyTab(result);
  assert.equal(entry.harnessStarted, false);
  assert.equal(entry.promptSent, false);
});

test('a tab that was already there is never typed into, launch line and prompt both', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSession(box, ['--prompt', PROMPT]);
  const first = await up(box, bots);
  assert.equal(first.result.code, 0, first.result.stderr);
  const soFar = (await box.orca.calls()).length;

  const again = await up(box, bots, ['--json']);
  const third = await up(box, bots);

  assert.equal(third.result.code, 0, third.result.stderr);
  assert.deepEqual(again.typed, [`${BARE_LAUNCH.codex} '${PROMPT}'`], 'the session was told its duty once, and once only');
  assert.deepEqual(third.typed, again.typed);
  assert.equal(again.tab.tabId, first.tab.tabId, 'it is the same tab throughout');

  const later = (await box.orca.calls()).slice(soFar);
  assert.deepEqual(orcaCallsOf(later, 'terminal send'), [], 'nothing typed into a tab that was already live');
  assert.deepEqual(orcaCallsOf(later, 'terminal wait'), [], 'and nothing to wait for either');
  assert.equal(
    'promptSent' in onlyTab(again.result),
    false,
    'this run typed nothing, so it has nothing to say about a prompt',
  );
});

test('a session tab that came back is told its duty again', async (t) => {
  // The tab is gone, so the harness in it is gone: the session that comes back
  // is a new one and starts from nothing.
  const box = await createSandbox(t);
  const bots = await withSession(box, ['--prompt', PROMPT]);
  const first = await up(box, bots);
  assert.equal(first.result.code, 0, first.result.stderr);
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((one) => one.tabId !== first.tab.tabId) });

  const again = await up(box, bots);

  assert.equal(again.result.code, 0, again.result.stderr);
  assert.notEqual(again.tab.tabId, first.tab.tabId, 'a tab that comes back is a new tab');
  assert.deepEqual(again.typed, [`${BARE_LAUNCH.codex} '${PROMPT}'`]);
});

test('the plain report says the prompt went with the line, and says so only when it did', async (t) => {
  const box = await createSandbox(t);
  await withSession(box, ['--prompt', PROMPT]);

  const sent = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  const other = await createSandbox(t);
  await withSession(other, ['--prompt', PROMPT]);
  await other.orca.set({ waitIdle: false });
  const lost = await other.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(sent.code, 0, sent.stderr);
  assert.equal(lost.code, 0, lost.stderr);
  assert.notEqual(
    sent.stdout.split(box.root).join('<root>'),
    lost.stdout.split(other.root).join('<root>'),
    'a session that was told its duty must not read like one that was not',
  );
  assert.match(sent.stdout, /prompt/i, `the reader should be told the duty went in, got: ${sent.stdout}`);
  for (const result of [sent, lost]) {
    assert.ok(!result.stdout.includes('undefined'), `nothing should be undefined, got: ${result.stdout}`);
  }
});

test('a launch line with a prompt on it keeps to the allowed Orca commands, and closes nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSession(box, ['--prompt', PROMPT, '--work-dir', 'work/api']);

  await up(box, bots);

  assertOrcaCallsAllowed(await box.orca.calls());
});
