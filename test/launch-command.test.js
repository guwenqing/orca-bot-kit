// The one line `obk up` types into a new session tab: the harness, the flags
// PRD 6.4 maps its settings to, and last the start prompt as the harness's own
// prompt argument.
//
// This is the contract with the two harnesses, so the text is pinned exactly.
// A flag named wrongly is the failure that matters most here: the harness
// starts anyway, on its own defaults, and the session runs for days at the
// wrong approval level or the wrong model with nothing to show for it.
//
// The order is fixed — the tab shell's pid, the kit's own CLI, harness,
// approval, model, effort, context, `--add-dir`, extra args, `--`, prompt — so a
// reader of an Orca tab sees the same shape for every session. The two in front
// are `OBK_TAB_SHELL` and `OBK_CLI`, which the tables below leave out and
// `launchLine` puts back: they say nothing about the flag mapping, which is
// what they are for. The `--` comes only with a prompt, and it is there
// because a prompt may begin with a dash: without it `claude` exits 1 with
// `unknown option` and `codex` exits 2 with `unexpected argument`.
//
// Flags checked live on Claude Code 2.1.278 and Codex 0.155.1: `--model
// 'sonnet[1m]'` is a real launch form, and Codex takes `-c key=value` with no
// quotes of its own around the value.
//
// And checked live again, in a real tab, that they do what they say rather
// than being taken and ignored: a session started with `--model 'sonnet[1m]'`
// reports `Model: sonnet[1m] (claude-sonnet-5[1m])` under Claude Code's
// `/status`, and one started with `-c model_context_window=<n>` has that
// window in its rollout, which reports 95% of the number given. A context
// Codex cannot read it refuses itself — `invalid type: string "1m", expected
// i64` — which is why the kit refuses it first.

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
  launchLine,
  sh,
  tabsOfBot,
  typedInto,
} from './helpers/cli.js';

/**
 * A bot with one session, brought up, and the line that was typed into its tab.
 * `--bot` keeps the run to this bot, so Bot Father's tabs stay out of the way.
 */
async function launchOf(box, harness, settings, { bot = 'api-bot' } = {}) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness])).code, 0);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', 'daily', ...settings]);
  assert.equal(added.code, 0, added.stderr);

  const up = await box.run(['up', '--bots', 'bots', '--bot', bot]);
  assert.equal(up.code, 0, up.stderr);

  const tabs = await tabsOfBot(box, box.path('bots'), bot);
  assert.equal(tabs.length, 1, `the bot should have the one session tab, got ${JSON.stringify(tabs)}`);
  const typed = typedInto(tabs[0]);
  assert.equal(typed.length, 1, `one send per new session tab, got ${JSON.stringify(typed)}`);
  return typed[0];
}

const CLAUDE = [
  ['nothing set at all', [], 'claude --permission-mode auto -n api-bot.daily'],
  ['approval auto', ['--approval', 'auto'], 'claude --permission-mode auto -n api-bot.daily'],
  ['approval ask', ['--approval', 'ask'], 'claude --permission-mode manual -n api-bot.daily'],
  ['approval dangerously-skip', ['--approval', 'dangerously-skip'], 'claude --dangerously-skip-permissions -n api-bot.daily'],
  ['a model', ['--model', 'sonnet'], 'claude --permission-mode auto -n api-bot.daily --model sonnet'],
  ['an effort', ['--effort', 'high'], 'claude --permission-mode auto -n api-bot.daily --effort high'],
  [
    // `[1m]` is a glob to the tab's zsh, so the model has to stay quoted.
    'a model with a context window',
    ['--model', 'sonnet', '--context', '1m'],
    "claude --permission-mode auto -n api-bot.daily --model 'sonnet[1m]'",
  ],
  [
    'extra args',
    ['--extra-arg=--verbose', '--extra-arg=--debug'],
    'claude --permission-mode auto -n api-bot.daily --verbose --debug',
  ],
  [
    'a start prompt, last of all',
    ['--prompt', 'Read your AGENTS.md.'],
    "claude --permission-mode auto -n api-bot.daily -- 'Read your AGENTS.md.'",
  ],
  [
    'everything at once',
    [
      '--approval', 'ask', '--model', 'opus', '--context', '1m', '--effort', 'xhigh',
      '--extra-arg=--verbose', '--prompt', 'Read your AGENTS.md.',
    ],
    "claude --permission-mode manual -n api-bot.daily --model 'opus[1m]' --effort xhigh --verbose -- 'Read your AGENTS.md.'",
  ],
];

const CODEX = [
  ['nothing set at all', [], 'codex --approve-for-me -c sandbox_workspace_write.network_access=true'],
  ['approval auto', ['--approval', 'auto'], 'codex --approve-for-me -c sandbox_workspace_write.network_access=true'],
  ['approval ask', ['--approval', 'ask'], 'codex -a on-request -c sandbox_workspace_write.network_access=true'],
  [
    'approval dangerously-skip',
    ['--approval', 'dangerously-skip'],
    'codex --dangerously-bypass-approvals-and-sandbox -c sandbox_workspace_write.network_access=true',
  ],
  ['a model', ['--model', 'gpt-5.4'], 'codex --approve-for-me -c sandbox_workspace_write.network_access=true -m gpt-5.4'],
  ['an effort', ['--effort', 'high'], 'codex --approve-for-me -c sandbox_workspace_write.network_access=true -c model_reasoning_effort=high'],
  [
    'a context window, with no model to hang it on',
    ['--context', '200000'],
    'codex --approve-for-me -c sandbox_workspace_write.network_access=true -c model_context_window=200000',
  ],
  [
    'a model and a context window',
    ['--model', 'gpt-5.4', '--context', '200000'],
    'codex --approve-for-me -c sandbox_workspace_write.network_access=true -m gpt-5.4 -c model_context_window=200000',
  ],
  ['extra args', ['--extra-arg=--search'], 'codex --approve-for-me -c sandbox_workspace_write.network_access=true --search'],
  [
    'a start prompt, last of all',
    ['--prompt', 'Read your AGENTS.md.'],
    "codex --approve-for-me -c sandbox_workspace_write.network_access=true -- 'Read your AGENTS.md.'",
  ],
  [
    'everything at once',
    [
      '--approval', 'ask', '--model', 'gpt-5.4', '--effort', 'high', '--context', '200000',
      '--extra-arg=--search', '--prompt', 'Read your AGENTS.md.',
    ],
    'codex -a on-request -c sandbox_workspace_write.network_access=true -m gpt-5.4 -c model_reasoning_effort=high -c model_context_window=200000 '
    + "--search -- 'Read your AGENTS.md.'",
  ],
];

for (const [harness, cases] of [['claude', CLAUDE], ['codex', CODEX]]) {
  for (const [label, settings, expected] of cases) {
    test(`${harness}, ${label}: ${expected}`, async (t) => {
      const box = await createSandbox(t);

      assert.equal(await launchOf(box, harness, settings), launchLine(box, expected));
    });
  }
}

test('a session runs on its own harness, whatever the bot runs on', async (t) => {
  const box = await createSandbox(t);

  assert.equal(await launchOf(box, 'codex', ['--harness', 'claude']), bareLaunch(box, 'claude', 'api-bot', 'daily'));
});

test('a session with no harness of its own runs on the bot\'s', async (t) => {
  const box = await createSandbox(t);

  assert.equal(await launchOf(box, 'codex', []), bareLaunch(box, 'codex'));
});

test('Codex gets --add-dir for a work dir outside the bot home, and nothing for one inside', async (t) => {
  // PRD 6.4 and ADR 0015: Codex's auto mode sandboxes writes to the folder it
  // was launched in, so a work dir anywhere else has to be named. A work dir
  // always brings its note with it, which is the prompt word at the end.
  const box = await createSandbox(t);
  const outside = path.join(box.root, 'clones', 'api');
  const inside = await createSandbox(t);

  const far = await launchOf(box, 'codex', ['--work-dir', outside]);
  const near = await launchOf(inside, 'codex', ['--work-dir', 'work/api']);

  assert.ok(
    far.startsWith(launchLine(box, `codex --approve-for-me -c sandbox_workspace_write.network_access=true --add-dir ${outside} -- '`)),
    `--add-dir should come after the settings and before the prompt, got: ${far}`,
  );
  assert.ok(
    near.startsWith(`${bareLaunch(inside, 'codex')} -- '`),
    `a work dir under the bot home is already inside the sandbox, got: ${near}`,
  );
});

test('a work dir that is the bot home itself brings no --add-dir', async (t) => {
  // `--work-dir .`: the session works where it was started. Codex's sandbox
  // already covers the folder it was launched in, so naming that folder again
  // says nothing — and a line that reads `--add-dir <the folder I am in>` is
  // a line a reader has to stop and think about.
  const box = await createSandbox(t);

  const typed = await launchOf(box, 'codex', ['--work-dir', '.']);

  assert.ok(!typed.includes('--add-dir'), `the bot home is already inside the sandbox, got: ${typed}`);
  assert.ok(typed.startsWith(bareLaunch(box, 'codex')), `got: ${typed}`);
});

test('--add-dir is given the absolute path, even when the work dir was written relative', async (t) => {
  // A relative work dir is relative to the bot home, and `..` can climb out of
  // it. What Codex is given is a path, not the user's shorthand.
  const box = await createSandbox(t);

  const typed = await launchOf(box, 'codex', ['--work-dir', '../shared-clones']);

  const home = botHomeOf(box.path('bots'), 'api-bot');
  assert.ok(
    typed.startsWith(launchLine(box, `codex --approve-for-me -c sandbox_workspace_write.network_access=true --add-dir ${path.resolve(home, '../shared-clones')} -- '`)),
    `got: ${typed}`,
  );
});

test('Claude never gets --add-dir, wherever its work dir is', async (t) => {
  // PRD 6.4 gives the work dir flag to Codex only: Claude's auto mode is not a
  // sandbox around the launch folder, and the work dir reaches it in the start
  // prompt like every other instruction.
  const box = await createSandbox(t);
  const outside = path.join(box.root, 'clones', 'api');

  const typed = await launchOf(box, 'claude', ['--work-dir', outside]);

  assert.ok(!typed.includes('--add-dir'), `Claude should get no --add-dir, got: ${typed}`);
  assert.ok(typed.startsWith(`${bareLaunch(box, 'claude', 'api-bot', 'daily')} -- '`), `got: ${typed}`);
});

test('an extra_args written by hand as one string is typed as it stands', async (t) => {
  // The escape hatch: what the user wrote is shell text, and the kit passes it
  // through rather than quoting it into a single argument.
  const box = await createSandbox(t);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'codex'])).code, 0);
  await writeFile(
    path.join(botHomeOf(box.path('bots'), 'api-bot'), 'bot.yaml'),
    'name: api-bot\nharness: codex\ncharter: mine\nrules: []\nskills: []\n'
    + 'sessions:\n  - name: daily\n    approval: auto\n    extra_args: --search --profile mine\n',
  );

  assert.equal((await box.run(['up', '--bots', 'bots', '--bot', 'api-bot'])).code, 0);

  const tabs = await tabsOfBot(box, box.path('bots'), 'api-bot');
  assert.deepEqual(typedInto(tabs[0]), [launchLine(box, 'codex --approve-for-me -c sandbox_workspace_write.network_access=true --search --profile mine')]);
});

for (const harness of ['claude', 'codex']) {
  test(`the ${harness} launch line means what it says when a shell runs it`, async (t) => {
    // Pinned text is only half of it: the tab's own shell reads the line, so a
    // value with a space or a quote in it has to come out the other side as one
    // argument. The harness here is a fake on PATH that writes down its argv.
    const box = await createSandbox(t);
    const fake = await fakeProgram(box, harness, {});

    const typed = await launchOf(box, harness, [
      '--model', 'my model',
      '--extra-arg=--note',
      '--extra-arg=it\'s a "quoted" one',
    ]);

    const ran = await sh(typed, { cwd: box.cwd, env: box.env });
    assert.equal(ran.code, 0, `the line should run: ${typed}\n${ran.stderr}`);
    const calls = await fake.calls();
    assert.equal(calls.length, 1, `the line should start ${harness} once, got: ${typed}`);
    assert.deepEqual(calls[0].args.slice(-3), ['my model', '--note', 'it\'s a "quoted" one']);
  });
}

test('a model with a context window reaches the harness as one word, unglobbed', async (t) => {
  // `sonnet[1m]` is a glob pattern to zsh. Unquoted it would be swallowed or
  // replaced by a file name, and the session would run on the wrong model.
  const box = await createSandbox(t);
  const fake = await fakeProgram(box, 'claude', {});

  const typed = await launchOf(box, 'claude', ['--model', 'sonnet', '--context', '1m']);

  const ran = await sh(typed, { cwd: box.cwd, env: box.env });
  assert.equal(ran.code, 0, `${typed}\n${ran.stderr}`);
  assert.deepEqual((await fake.calls())[0].args, ['--permission-mode', 'auto', '-n', 'api-bot.daily', '--model', 'sonnet[1m]']);
});

test('Codex\'s -c settings reach codex as one argument each', async (t) => {
  // `-c key=value` is two arguments, and the value is one of them. Checked
  // live under `--strict-config`, which refuses a setting it cannot read.
  const box = await createSandbox(t);
  const fake = await fakeProgram(box, 'codex', {});

  const typed = await launchOf(box, 'codex', ['--effort', 'high', '--context', '200000']);

  const ran = await sh(typed, { cwd: box.cwd, env: box.env });
  assert.equal(ran.code, 0, `the line should run: ${typed}\n${ran.stderr}`);
  const calls = await fake.calls();
  assert.equal(calls.length, 1, `the line should start codex once, got: ${typed}`);
  assert.deepEqual(calls[0].args, [
    '--approve-for-me',
    '-c', 'sandbox_workspace_write.network_access=true',
    '-c', 'model_reasoning_effort=high',
    '-c', 'model_context_window=200000',
  ]);
});

test('every Orca call a launch makes is one of the allowed ones, and no tab is closed', async (t) => {
  const box = await createSandbox(t);

  await launchOf(box, 'codex', ['--model', 'gpt-5.4', '--effort', 'high', '--work-dir', 'work/api']);

  assertOrcaCallsAllowed(await box.orca.calls());
});
