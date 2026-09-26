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
// on the way. Byte for byte means the user's own text and no other: the kit
// neither folds its lines nor squeezes its spaces. It is an argument and not
// something typed at a TUI, so a newline in it submits nothing, and a prompt
// the kit tidied is a prompt the user did not write.
//
// `--` stands in front of it, on both harnesses. A start prompt is a sentence
// the user wrote and a sentence can start with a dash: without the separator
// `claude` exits 1 with `unknown option` and `codex` exits 2 with `unexpected
// argument`, the tab falls back to a shell, and the session never runs.
//
// A session with a work dir is told where it is, in a note carrying the
// absolute path, a blank line below the prompt in the same argument. A session
// with neither has no prompt word at all.

import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  assertOrcaCallsAllowed,
  bareLaunch,
  botHomeOf,
  createSandbox,
  fakeProgram,
  orcaCallsOf,
  orcaCommand,
  orcaFlag,
  orcaFlags,
  sentInto,
  sh,
  tabsOfBot,
  typedInto,
} from './helpers/cli.js';

const PROMPT = 'Read your AGENTS.md and reply in one line with what this bot owns.';

// The bot's name is this file's own. Anything longer than a line — a prompt
// with a work-dir note under it, for one — is handed to the session in a file
// the kit names after the bot and the session, under the system temp
// directory. The tests below read that file back through a shell, and another
// test file bringing up an `api-bot` `daily` at the same moment would be
// writing over it.

/** A bots folder holding one Codex bot with one session, not yet brought up. */
async function withSession(box, settings, { harness = 'codex' } = {}) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'prompt-bot', '--harness', harness])).code, 0);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'prompt-bot', '--name', 'daily', ...settings]);
  assert.equal(added.code, 0, added.stderr);
  return box.path('bots');
}

/** Bring the one bot up and give back its tab and what was typed into it. */
async function up(box, bots, args = []) {
  const result = await box.run(['up', '--bots', 'bots', '--bot', 'prompt-bot', ...args]);
  const tabs = await tabsOfBot(box, bots, 'prompt-bot');
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
  assert.deepEqual(typed, [`${bareLaunch(box, 'codex', 'prompt-bot', 'daily')} -- '${PROMPT}'`]);
  assert.deepEqual(sentInto(tab), [{ text: `${bareLaunch(box, 'codex', 'prompt-bot', 'daily')} -- '${PROMPT}'`, enter: true }], 'the line has to be sent off');

  const sends = orcaCallsOf(await box.orca.calls(), 'terminal send')
    .filter((call) => orcaFlag(call, '--terminal') === tab.handle);
  assert.equal(sends.length, 1, 'one send per new session tab: the prompt is not a send of its own');
  assert.deepEqual(orcaFlags(sends[0]), ['--enter', '--json', '--terminal', '--text']);
});

test('the tab is still asked afterwards whether a TUI came up', async (t) => {
  // The send goes first and the wait is the check on it, as it always was: a
  // tab still at a shell prompt is refused with `timeout` however long you wait.
  // How many times the kit looks is its own business — it looks more than once,
  // because a harness can come up and die — but nothing may come before the
  // send, and nothing but looking may come after it. Asking Orca what it knows
  // of the tab is looking too (#232), and so is reading what it shows (#329).
  const box = await createSandbox(t);
  const bots = await withSession(box, ['--prompt', PROMPT]);

  const { tab } = await up(box, bots);

  const mine = (await box.orca.calls())
    .filter((call) => orcaFlag(call, '--terminal') === tab.handle)
    .map(orcaCommand);
  assert.equal(mine[0], 'terminal send', `the line goes in first, got: ${JSON.stringify(mine)}`);
  assert.ok(mine.slice(1).includes('terminal wait'), `and then the kit waits on the tab, got: ${JSON.stringify(mine)}`);
  assert.deepEqual(
    mine.slice(1).filter((command) => !['terminal wait', 'terminal show', 'terminal read'].includes(command)),
    [],
    `and after it the kit only looks, got: ${JSON.stringify(mine)}`,
  );
});

test('the prompt reaches the harness byte for byte, whatever the user put in it', async (t) => {
  // Everything a shell would otherwise do to it: expand, split, run. The
  // prompt is the user's text and the harness has to get the user's text.
  const box = await createSandbox(t);
  const fake = await fakeProgram(box, 'codex', {});
  const nasty = 'it\'s "fine" $HOME `date` && rm -rf x; echo \'hi\'';
  const bots = await withSession(box, ['--prompt', nasty]);

  const { typed } = await up(box, bots);

  assert.deepEqual(await argvOf(box, typed[0], fake), ['--approve-for-me', '-c', 'sandbox_workspace_write.network_access=true', '--', nasty]);
});

// A start prompt is a sentence the user wrote, and a sentence can begin with a
// dash: a list item, a flag they want explained, or the separator itself. Each
// of these was tried against the installed CLIs without `--` in front of it:
// Claude Code exits 1 with `unknown option`, Codex exits 2 with `unexpected
// argument`, and the tab is left at a shell with nothing running in it.
//
// They go in as `--prompt=<text>`: `--prompt <text>` is refused by the kit's
// own parser when the text starts with a dash, before any of this is reached.
const DASHED = [
  ['a list item', '- Read your AGENTS.md and wait.'],
  ['a long flag the session is asked about', '--verbose is the flag to explain today.'],
  ['a short flag the session is asked about', '-m is the flag to explain today.'],
  ['nothing but the separator', '--'],
];

for (const harness of ['claude', 'codex']) {
  for (const [label, prompt] of DASHED) {
    test(`on ${harness}, a prompt that starts with ${label} is still the prompt`, async (t) => {
      const box = await createSandbox(t);
      const fake = await fakeProgram(box, harness, {});
      const bots = await withSession(box, [`--prompt=${prompt}`], { harness });

      const { typed } = await up(box, bots);

      const argv = await argvOf(box, typed[0], fake);
      assert.equal(
        argv.at(-1),
        prompt,
        `the harness should be handed the sentence, got: ${JSON.stringify(argv)}`,
      );
      assert.equal(
        argv.at(-2),
        '--',
        `and told where its own flags stop, or it reads the sentence as one: ${JSON.stringify(argv)}`,
      );
    });
  }
}

test('a block scalar\'s own trailing newline is not part of the prompt', async (t) => {
  // `prompt: |` in YAML ends every prompt with a newline, whether the user
  // typed one or not. Left on, it is a line of its own by the time the harness
  // reads it — and here it would also push a one-line prompt off the launch
  // line and into a file, for a character nobody wrote.
  const box = await createSandbox(t);
  const bots = await withSession(box, []);
  await writeFile(
    path.join(botHomeOf(bots, 'prompt-bot'), 'bot.yaml'),
    'name: prompt-bot\nharness: codex\ncharter: mine\nrules: []\nskills: []\n'
    + 'sessions:\n  - name: daily\n    approval: auto\n    prompt: |\n      Read your AGENTS.md.\n',
  );

  const { typed } = await up(box, bots);

  assert.deepEqual(
    typed,
    [`${bareLaunch(box, 'codex', 'prompt-bot', 'daily')} -- 'Read your AGENTS.md.'`],
    'one short line, typed in as one short line',
  );
});

test('a prompt written over several lines keeps every one of them', async (t) => {
  // The prompt is an argument, so its newlines are the user's paragraphs and
  // nothing else: nothing submits on them and nothing reads them but the
  // harness. A kit that folded them into one line would be rewriting the
  // instruction the session is given.
  const box = await createSandbox(t);
  const fake = await fakeProgram(box, 'codex', {});
  const bots = await withSession(box, []);
  await writeFile(
    path.join(botHomeOf(bots, 'prompt-bot'), 'bot.yaml'),
    'name: prompt-bot\nharness: codex\ncharter: mine\nrules: []\nskills: []\n'
    + 'sessions:\n  - name: daily\n    approval: auto\n    prompt: |\n'
    + '      You keep the API bot\'s day running.\n\n      Each morning:\n'
    + '        - read AGENTS.md\n        - ask before you touch main\n',
  );

  const { typed } = await up(box, bots);

  const argv = await argvOf(box, typed[0], fake);
  assert.deepEqual(argv.slice(0, 4), ['--approve-for-me', '-c', 'sandbox_workspace_write.network_access=true', '--']);
  assert.equal(argv.length, 5, `the prompt is one argument, got: ${JSON.stringify(argv)}`);
  assert.deepEqual(
    argv.at(-1).split('\n'),
    [
      'You keep the API bot\'s day running.',
      '',
      'Each morning:',
      '  - read AGENTS.md',
      '  - ask before you touch main',
    ],
    'the blank line between the paragraphs and the indent under the list both belong to the user',
  );
});

test('two spaces in a prompt reach the harness as two spaces', async (t) => {
  // The smallest form of the same rule, and the one that hid the bug: a kit
  // that squeezes runs of whitespace is a kit that edits the user's sentences.
  const box = await createSandbox(t);
  const fake = await fakeProgram(box, 'codex', {});
  const bots = await withSession(box, []);
  const spaced = 'Read AGENTS.md.  Then wait.\tThen ask.';
  await writeFile(
    path.join(botHomeOf(bots, 'prompt-bot'), 'bot.yaml'),
    'name: prompt-bot\nharness: codex\ncharter: mine\nrules: []\nskills: []\n'
    + `sessions:\n  - name: daily\n    approval: auto\n    prompt: ${JSON.stringify(spaced)}\n`,
  );

  const { typed } = await up(box, bots);

  assert.deepEqual(await argvOf(box, typed[0], fake), ['--approve-for-me', '-c', 'sandbox_workspace_write.network_access=true', '--', spaced]);
});

test('a session with a work dir is told where it is, in a note carrying the absolute path', async (t) => {
  const box = await createSandbox(t);
  const fake = await fakeProgram(box, 'codex', {});
  const bots = await withSession(box, ['--prompt', PROMPT, '--work-dir', 'work/api']);

  const { typed } = await up(box, bots);

  const argv = await argvOf(box, typed[0], fake);
  // A work dir under the bot home brings no `--add-dir`, so the prompt is the
  // one argument after the separator, note and all in the one word.
  assert.deepEqual(argv.slice(0, 4), ['--approve-for-me', '-c', 'sandbox_workspace_write.network_access=true', '--']);
  assert.equal(argv.length, 5, `the prompt is one argument, got: ${JSON.stringify(argv)}`);
  const said = argv.at(-1);
  assert.ok(
    said.startsWith(`${PROMPT}\n\n`),
    `the user's own prompt comes first and whole, with the note a blank line below it, got: ${JSON.stringify(said)}`,
  );
  assert.ok(
    said.includes(path.join(botHomeOf(bots, 'prompt-bot'), 'work', 'api')),
    `the note should name the work dir by its absolute path, got: ${said}`,
  );
  // PRD 6.4: it is a plain folder and has nothing to do with git worktrees. The
  // session has to be told, or it will treat it as a checkout of something.
  assert.match(said, /plain folder/i, `the note should say what the folder is, got: ${said}`);
  assert.match(said, /not a git worktree/i, `and what it is not, got: ${said}`);
});

test('a work dir whose name has two spaces in it is named as it is', async (t) => {
  // The note is built out of a path, and a path is not prose: a folder called
  // `two  spaces` is a different folder from `two spaces`, so a kit that
  // tidied the note would send the session somewhere that is not there.
  const box = await createSandbox(t);
  const fake = await fakeProgram(box, 'codex', {});
  const bots = await withSession(box, ['--prompt', PROMPT, '--work-dir', 'work/two  spaces']);

  const { typed } = await up(box, bots);

  const argv = await argvOf(box, typed[0], fake);
  assert.equal(argv.length, 5, `the prompt is one argument, got: ${JSON.stringify(argv)}`);
  assert.ok(
    argv.at(-1).includes(path.join(botHomeOf(bots, 'prompt-bot'), 'work', 'two  spaces')),
    `the note should name the folder that was made, got: ${JSON.stringify(argv.at(-1))}`,
  );
});

test('a session with a work dir and no prompt still has the note to say', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSession(box, ['--work-dir', 'work/api']);

  const { result, typed } = await up(box, bots, ['--json']);

  assert.ok(
    typed[0].startsWith(`${bareLaunch(box, 'codex', 'prompt-bot', 'daily')} -- '`),
    `the note is something to say, got: ${JSON.stringify(typed)}`,
  );
  assert.ok(typed[0].includes(path.join(botHomeOf(bots, 'prompt-bot'), 'work', 'api')));
  assert.equal(
    onlyTab(result).promptReceived,
    false,
    'the note is a duty to report on, and nothing on record holds it yet (#274)',
  );
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

  assert.deepEqual(typed, [bareLaunch(box, 'codex', 'prompt-bot', 'daily')], 'the launch line, and that is all there was to say');
  assert.deepEqual(await argvOf(box, typed[0], fake), ['--approve-for-me', '-c', 'sandbox_workspace_write.network_access=true'], 'no empty word on the end either');
  assert.equal(
    'promptReceived' in onlyTab(result),
    false,
    'a session with nothing to say has nothing to report about it',
  );
});

test('a prompt on a line the harness took is not confirmed while no record holds it', async (t) => {
  // A harness running in the tab is not a conversation that got its duty
  // (#274): here no hook ran, so the book names no conversation to look in.
  const box = await createSandbox(t);
  const bots = await withSession(box, ['--prompt', PROMPT]);

  const { result } = await up(box, bots, ['--json']);

  const entry = onlyTab(result);
  assert.equal(entry.harnessStarted, true);
  assert.equal(entry.promptReceived, false);
  assert.equal('promptSent' in entry, false, 'the old field is gone');
});

test('a harness sitting on its trust question has the prompt already in its argv', async (t) => {
  // The first run of every new bot, and the whole point of the change: the
  // prompt is an argument the harness holds until the question is answered.
  const box = await createSandbox(t);
  const bots = await withSession(box, ['--prompt', PROMPT]);
  await box.orca.set({ waitIdle: 'blocked' });

  const { result, typed } = await up(box, bots, ['--json']);

  assert.deepEqual(typed, [`${bareLaunch(box, 'codex', 'prompt-bot', 'daily')} -- '${PROMPT}'`], 'the line went in whole');
  const entry = onlyTab(result);
  assert.equal(entry.harnessStarted, true, 'a TUI that is up is a harness that started');
  assert.equal(entry.blockedReason, 'agent-interactive-prompt');
  assert.equal(entry.promptReceived, false, 'the prompt is waiting behind the question, so the conversation does not hold it yet');
});

test('a harness that never came up took the duty with it, and the run says so', async (t) => {
  // No TUI in the tab: the shell swallowed the line, prompt and all.
  const box = await createSandbox(t);
  const bots = await withSession(box, ['--prompt', PROMPT]);
  await box.orca.set({ waitIdle: false });

  const { result, typed } = await up(box, bots, ['--json']);

  assert.deepEqual(typed, [`${bareLaunch(box, 'codex', 'prompt-bot', 'daily')} -- '${PROMPT}'`], 'the line was still typed; it is the outcome that failed');
  const entry = onlyTab(result);
  assert.equal(entry.harnessStarted, false);
  assert.equal(entry.promptReceived, false);
});

test('a harness that came up and then died is not reported as running', async (t) => {
  // The failure one look cannot see. A harness started with a setting it
  // cannot take draws its screen, prints what is wrong and exits, and the tab
  // is back at a shell a moment later. Reporting that as a session that is up
  // is the worst of the three answers: the user reads `harnessStarted: true`,
  // leaves it alone, and the bot does nothing for as long as nobody looks.
  const box = await createSandbox(t);
  const bots = await withSession(box, ['--prompt', PROMPT]);
  await box.orca.set({ waitIdle: [true, false] });

  const { result, typed } = await up(box, bots, ['--json']);

  assert.deepEqual(typed, [`${bareLaunch(box, 'codex', 'prompt-bot', 'daily')} -- '${PROMPT}'`], 'the line went in; it is what became of it that failed');
  const entry = onlyTab(result);
  assert.equal(entry.harnessStarted, false, 'a harness that is gone is not a harness that started');
  assert.equal(entry.promptReceived, false, 'and it took the duty with it when it went');
});

test('a harness still up on the second look is reported as running', async (t) => {
  // The other side of it: looking twice must not turn every good run into a
  // failure. A TUI that is there both times is a session that is up.
  const box = await createSandbox(t);
  const bots = await withSession(box, ['--prompt', PROMPT]);
  await box.orca.set({ waitIdle: [true, true] });

  const { result } = await up(box, bots, ['--json']);

  const entry = onlyTab(result);
  assert.equal(entry.harnessStarted, true);
  assert.equal(entry.promptReceived, false, 'running is not received: no record holds the prompt (#274)');
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
  assert.deepEqual(again.typed, [`${bareLaunch(box, 'codex', 'prompt-bot', 'daily')} -- '${PROMPT}'`], 'the session was told its duty once, and once only');
  assert.deepEqual(third.typed, again.typed);
  assert.equal(again.tab.tabId, first.tab.tabId, 'it is the same tab throughout');

  const later = (await box.orca.calls()).slice(soFar);
  assert.deepEqual(orcaCallsOf(later, 'terminal send'), [], 'nothing typed into a tab that was already live');
  assert.deepEqual(orcaCallsOf(later, 'terminal wait'), [], 'and nothing to wait for either');
  assert.equal(
    'promptReceived' in onlyTab(again.result),
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
  assert.deepEqual(again.typed, [`${bareLaunch(box, 'codex', 'prompt-bot', 'daily')} -- '${PROMPT}'`]);
});

test('the plain report says what became of the prompt, and a harness that came up does not read like one that did not', async (t) => {
  const box = await createSandbox(t);
  await withSession(box, ['--prompt', PROMPT]);

  const sent = await box.run(['up', '--bots', 'bots', '--bot', 'prompt-bot']);

  const other = await createSandbox(t);
  await withSession(other, ['--prompt', PROMPT]);
  await other.orca.set({ waitIdle: false });
  const lost = await other.run(['up', '--bots', 'bots', '--bot', 'prompt-bot']);

  assert.equal(sent.code, 0, sent.stderr);
  assert.equal(lost.code, 0, lost.stderr);
  assert.notEqual(
    sent.stdout.split(box.root).join('<root>'),
    lost.stdout.split(other.root).join('<root>'),
    'a session that was told its duty must not read like one that was not',
  );
  assert.match(sent.stdout, /prompt/i, `the reader should be told about the duty, got: ${sent.stdout}`);
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
