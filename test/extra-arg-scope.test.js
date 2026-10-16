// Extra arguments cannot widen what a session may write (#567).
//
// `session add`, `session change`, `temp make` and `groom --on --run-on codex`
// already refuse an extra argument that sets approval or permissions (ADR
// 0041, test/approval-moved.test.js). This adds the arguments that widen a
// session's write scope, or change what it runs, judged by the session's
// harness, as the architect ruled on #567. Each refusal is like today's: exit
// 1, the output names `obk permission approval`, and nothing is written.
//
// Codex, refused (alone with its value as the next extra arg, with `=value`,
// and the short ones also with the value glued on):
//   --add-dir; -C, --cd; -p, --profile; --enable, --disable; --remote,
//   --remote-auth-token-env.
//   -c / --config fails closed: its value is `key=value`, the key the text
//   before the first `=`, blanks at either end trimmed. It is accepted only
//   when the key is a plain dotted key (letters, digits, `_` and `-` in each
//   part, single dots between parts, no quotes, no blanks inside) and is
//   exactly one on the ALLOWED_KEYS list below. Besides those, with the value
//   exactly as named (blanks around it trimmed):
//   sandbox_workspace_write.network_access, .exclude_tmpdir_env_var and
//   .exclude_slash_tmp with `true` or `false`; features.sleep_tool with
//   `false` only; and `projects=` in one TOML shape only: an inline table with
//   one key, an absolute path as a TOML basic string with no backslash and no
//   `..` segment, whose value is exactly `{trust_level="trusted"}`, blanks
//   around `=`, `{` and `}` allowed. Every other -c is refused, a -c with no
//   value (the last extra arg) included.
// Claude Code, refused (alone with the value as the next extra arg, or with
// `=value`): --add-dir, --settings, --setting-sources, --plugin-dir,
// --plugin-url, --mcp-config, --agents, --agent, --debug-file; and --bare,
// which takes no value, alone and as --bare=<anything>.
//
// Both shapes of extra_args count: a list is read word by word, a value word
// after -c belongs to it; a hand-written string is read by the kit's strict
// shell-word reader (#565, test/session-change-harness.test.js).
//
// Every CLI run is in the sandbox (helpers/cli.js): its own HOME, a fake Orca,
// and fake harnesses on its own PATH. The expected values are taken from the
// requirement, not from the code.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import {
  assertRefused,
  createSandbox,
  orcaCallsOf,
  recordSession,
  sentInto,
  sessionIn,
  skipGit,
  snapshot,
} from './helpers/cli.js';
import { botYamlOf } from './helpers/skills.js';
import { codexTrustArgs } from './helpers/codex-trust.js';
import { liveTab, made, make, TASK, world } from './helpers/temp-roles.js';
import { refuseApprovalArgs } from '../src/launch.js';

const POINTER = 'permission approval';

// ================================================================ the cases

/** The `-c` keys a Codex session may set, any value, as the architect listed them. */
const ALLOWED_KEYS = [
  'model', 'model_reasoning_effort', 'model_reasoning_summary', 'model_verbosity', 'model_context_window',
  'model_auto_compact_token_limit', 'plan_mode_reasoning_effort', 'service_tier', 'hide_agent_reasoning',
  'show_raw_agent_reasoning', 'tool_output_token_limit',
  'tui.animations', 'tui.show_tooltips', 'tui.notifications', 'tui.notification_method', 'tui.notification_condition',
  'tui.alternate_screen', 'tui.theme', 'tui.vim_mode_default', 'tui.status_line', 'tui.terminal_title',
  'tui.raw_output_mode', 'tui.disable_paste_burst', 'tui.fullscreen_transcript', 'tui.mouse_scroll_speed',
  'tui.show_server_version_notice',
];

/** Codex flags that widen the write scope or change what runs, in every form, as lists of extra args. */
const CODEX_FLAGS_REFUSED = [
  ['--add-dir', '/srv/wide'], ['--add-dir=/srv/wide'],
  ['-C', '/srv/wide'], ['-C=/srv/wide'], ['-C/Users'],
  ['--cd', '/srv/wide'], ['--cd=/srv/wide'],
  ['-p', 'wide'], ['-p=wide'], ['-pwide'],
  ['--profile', 'wide'], ['--profile=wide'],
  ['--enable', 'web_search'], ['--enable=web_search'],
  ['--disable', 'sleep_tool'], ['--disable=sleep_tool'],
  ['--remote', 'ws://127.0.0.1:4500'], ['--remote=ws://127.0.0.1:4500'],
  ['--remote-auth-token-env', 'MY_TOKEN'], ['--remote-auth-token-env=MY_TOKEN'],
];

/** One refused key in each way a -c or --config can carry its value. */
const CODEX_CONFIG_FORMS_REFUSED = [
  ['-c', 'sandbox_mode=workspace-write'],
  ['--config', 'sandbox_mode=danger-full-access'],
  ['--config=sandbox_mode=danger-full-access'],
  ['-c=sandbox_mode=danger-full-access'],
  ['-csandbox_mode=read-only'],
  ['-c', ' sandbox_mode = "x"'],
];

/** `-c` values refused: every key not on the list, and every malformed one. */
const CODEX_CONFIG_VALUES_REFUSED = [
  // keys not on the list
  'sandbox_mode=danger-full-access',
  'sandbox_workspace_write.writable_roots=["/srv/wide"]',
  'sandbox_workspace_write={writable_roots=["/srv/wide"]}',
  'approval_policy=never',
  'approvals_reviewer=user',
  'auto_review.policy=allow',
  'default_permissions=wide',
  'permissions.wide.filesystem={}',
  'profile=wide',
  'profiles.wide.model=o3',
  'projects."/Users/x".trust_level=trusted',
  'projects./x.trust_level=trusted',
  'hooks.x=1',
  'mcp_servers.x.command=sh',
  'notify=["sh"]',
  'shell_environment_policy.inherit=all',
  'features.x=true',
  'tui.resume_cwd=true',
  'log_dir=/srv/logs',
  // near a listed key, not one
  'model.x=1',
  'models=o3',
  'tui.show_tooltipsx=false',
  'tui..show_tooltips=false',
  'sandbox_workspace_write.network_accessible=true',
  'sandbox_workspace_write.network_access.x=true',
  // quoted keys and blanks inside a key
  '"model"=o3',
  '"sandbox_mode"=read-only',
  'sandbox_workspace_write . writable_roots=["/srv/wide"]',
  'tui. show_tooltips=false',
  // no = at all, an empty key
  'model',
  '=x',
  ' =x',
  // network_access with a value other than true or false
  'sandbox_workspace_write.network_access=1',
  'sandbox_workspace_write.network_access="true"',
  'sandbox_workspace_write.network_access={}',
  'sandbox_workspace_write.network_access=',
  'sandbox_workspace_write.network_access=TRUE',
  // the two exclude keys with a value other than true or false
  'sandbox_workspace_write.exclude_tmpdir_env_var=1',
  'sandbox_workspace_write.exclude_tmpdir_env_var="true"',
  'sandbox_workspace_write.exclude_tmpdir_env_var=TRUE',
  'sandbox_workspace_write.exclude_tmpdir_env_var=',
  'sandbox_workspace_write.exclude_tmpdir_env_var={}',
  'sandbox_workspace_write.exclude_slash_tmp=1',
  'sandbox_workspace_write.exclude_slash_tmp="false"',
  'sandbox_workspace_write.exclude_slash_tmp=',
  'sandbox_workspace_write.exclude_slash_tmpx=true',
  // features.sleep_tool with anything but false
  'features.sleep_tool=true',
  'features.sleep_tool=1',
  'features.sleep_tool="false"',
  'features.sleep_tool=FALSE',
  'features.sleep_tool=',
  'features.sleep_tool={}',
  'features.sleep_tool.x=false',
  // projects in any shape but the one trust table
  'projects."/x".trust_level=trusted',
  'projects.x=1',
  'projects={}',
  'projects={"relative/x"={trust_level="trusted"}}',
  'projects={"/srv/../etc"={trust_level="trusted"}}',
  'projects={"/srv/bots/.."={trust_level="trusted"}}',
  'projects={"/a\\\\b"={trust_level="trusted"}}',
  'projects={"/a\\b"={trust_level="trusted"}}',
  "projects={'/srv/bots'={trust_level=\"trusted\"}}",
  'projects={"/srv/bots"={trust_level="untrusted"}}',
  'projects={"/srv/bots"={trust_level="trusted",x=1}}',
  'projects={"/srv/bots"={trust_level=\'trusted\'}}',
  'projects={"/srv/a"={trust_level="trusted"},"/srv/b"={trust_level="trusted"}}',
  'projects={"/srv/bots"={trust_level="trusted"}} x',
  'projects={"/srv/bots"="trusted"}',
];

/** A -c or --config with no value: the last extra arg. */
const CODEX_CONFIG_WITHOUT_VALUE = [['-c'], ['--config'], ['--search', '-c']];

/** Every refused Codex case, as lists. */
const CODEX_REFUSED = [
  ...CODEX_FLAGS_REFUSED,
  ...CODEX_CONFIG_FORMS_REFUSED,
  ...CODEX_CONFIG_VALUES_REFUSED.map((value) => ['-c', value]),
  ...CODEX_CONFIG_WITHOUT_VALUE,
];

/** Codex extra args that stay accepted: allowed -c forms, near misses, and other flags. */
const CODEX_ACCEPTED = [
  ['-c', 'model_reasoning_effort=high'],
  ['-c', 'tui.show_tooltips=false'],
  ['-c', ' model = o3 '],
  ['--config=model=o3'],
  ['--config', 'model=o3'],
  ['-c=model=o3'],
  ['-cmodel=o3'],
  ['-c', 'sandbox_workspace_write.network_access=false'],
  ['-c', 'sandbox_workspace_write.network_access=true'],
  ['-c', ' sandbox_workspace_write.network_access = false '],
  ['-c', 'sandbox_workspace_write.exclude_tmpdir_env_var=true'],
  ['-c', 'sandbox_workspace_write.exclude_tmpdir_env_var=false'],
  ['-c', 'sandbox_workspace_write.exclude_slash_tmp=true'],
  ['-c', ' sandbox_workspace_write.exclude_slash_tmp = false '],
  ['-c', 'features.sleep_tool=false'],
  ['-c', 'projects={"/srv/bots"={trust_level="trusted"}}'],
  ['-c', 'projects = { "/srv/bots" = { trust_level = "trusted" } }'],
  ['-c', 'projects={\t"/srv/bots"\t=\t{trust_level="trusted"}}'],
  ['-c', 'projects={"/tmp/a b.c/x"={trust_level="trusted"}}'],
  ['--config=projects={"/srv/bots"={trust_level="trusted"}}'],
  // every word a system test's Codex session is launched with
  codexTrustArgs('/srv/bots').map((arg) => arg.replace(/^--extra-arg=/, '')),
  ['--search'],
  ['--worktree'],
  ['-m', 'o3'],
  ['--no-alt-screen'],
  ['--dangerously-bypass-hook-trust'],
  ['--add-dirs'],
  ['--enabled'],
  ['--configs'],
  // Claude's flags are not Codex's
  ['--settings', '/srv/settings.json'],
  ['--plugin-dir', '/srv/plugins'],
  ['--bare'],
];

/** Claude Code's flags that widen what a session may reach. */
const CLAUDE_VALUE_FLAGS = [
  '--add-dir', '--settings', '--setting-sources', '--plugin-dir', '--plugin-url',
  '--mcp-config', '--agents', '--agent', '--debug-file',
];

/** Claude refused cases, as lists. */
const CLAUDE_REFUSED = [
  ...CLAUDE_VALUE_FLAGS.flatMap((flag) => [[flag, '/srv/wide'], [`${flag}=/srv/wide`]]),
  ['--bare'],
  ['--bare=1'],
];

/** Claude extra args that stay accepted: other flags, near misses, and Codex's flags. */
const CLAUDE_ACCEPTED = [
  ['--verbose'],
  ['--strict-mcp-config'],
  ['--model', 'sonnet'],
  ['--append-system-prompt', 'Be brief.'],
  ['-w'],
  ['--safe-mode'],
  ['--restricted'],
  ['--agentsx'],
  ['--settings-file'],
  ['-c', 'sandbox_mode=danger-full-access'],
  ['-C', '/srv/wide'],
  ['-p'],
  ['--profile', 'wide'],
  ['--enable', 'web_search'],
];

/** Hand-written extra_args strings the strict reader can read, by harness: refused, then accepted. */
const STRINGS = {
  codex: {
    refused: [
      '--add-dir /srv/wide',
      '--add-dir=/srv/wide',
      '-C /srv/wide',
      '-p wide',
      '--enable web_search',
      '--remote ws://127.0.0.1:4500',
      '-c sandbox_mode=read-only',
      "--config 'sandbox_workspace_write.writable_roots=[\"/srv/wide\"]'",
      '--search -c approval_policy=never',
      "-c '\"model\"=o3'",
      '--search -c',
    ],
    accepted: [
      '-c sandbox_workspace_write.network_access=false',
      '--search -c model_reasoning_effort=high',
      "-c ' model = o3 '",
    ],
  },
  claude: {
    refused: ['--add-dir /srv/wide', '--settings /srv/settings.json', '--verbose --bare'],
    accepted: ['--verbose --model sonnet', '-c sandbox_mode=danger-full-access'],
  },
};

const show = (args) => (Array.isArray(args) ? JSON.stringify(args) : `the string ${JSON.stringify(args)}`);

// ================================================================ refuseApprovalArgs, a table

test('XS1 Codex: each flag that widens the write scope or changes what runs is refused, in every form', () => {
  for (const args of CODEX_FLAGS_REFUSED) {
    assert.throws(() => refuseApprovalArgs('codex', args), Error, `codex should refuse ${show(args)}`);
  }
});

test('XS2 Codex: a -c or --config with a key off the list is refused, however it carries its value', () => {
  for (const args of CODEX_CONFIG_FORMS_REFUSED) {
    assert.throws(() => refuseApprovalArgs('codex', args), Error, `codex should refuse ${show(args)}`);
  }
});

test('XS3 Codex: -c fails closed: a key off the list, a near miss, a quoted or spaced key, no key, no =, a value other than the one named for network_access, the exclude keys and features.sleep_tool, and projects in any shape but the one trust table are refused', () => {
  for (const value of CODEX_CONFIG_VALUES_REFUSED) {
    assert.throws(() => refuseApprovalArgs('codex', ['-c', value]), Error, `codex should refuse -c ${JSON.stringify(value)}`);
  }
});

test('XS4 Codex: a -c or --config that is the last extra arg, with no value, is refused', () => {
  for (const args of CODEX_CONFIG_WITHOUT_VALUE) {
    assert.throws(() => refuseApprovalArgs('codex', args), Error, `codex should refuse ${show(args)}`);
  }
});

test('XS5 Codex: every key on the list is accepted in a -c, and network_access with true or false', () => {
  for (const key of ALLOWED_KEYS) {
    assert.equal(refuseApprovalArgs('codex', ['-c', `${key}=x`]), undefined, `codex should accept -c ${key}=x`);
  }
});

test('XS6 Codex: the allowed -c forms (the named values, the one trust table, a system test\'s launch words), near misses and other flags are accepted, Claude\'s refused flags among them', () => {
  for (const args of CODEX_ACCEPTED) {
    assert.equal(refuseApprovalArgs('codex', args), undefined, `codex should accept ${show(args)}`);
  }
});

test('XS7 Codex: the value word after -c belongs to it: an allowed one passes, a refused one among good args is refused', () => {
  assert.equal(refuseApprovalArgs('codex', ['--search', '-c', 'model=o3', '-m', 'o3']), undefined);
  assert.throws(() => refuseApprovalArgs('codex', ['--search', '-c', 'model=o3', '-c', 'sandbox_mode=read-only']), Error);
  assert.throws(() => refuseApprovalArgs('codex', ['-c', 'model=o3', '--add-dir', '/srv/wide']), Error);
});

test('XS8 Claude: each flag that widens what a session reaches is refused, alone with its value and with =; --bare alone and with =', () => {
  for (const args of CLAUDE_REFUSED) {
    assert.throws(() => refuseApprovalArgs('claude', args), Error, `claude should refuse ${show(args)}`);
  }
});

test('XS9 Claude: other flags, near misses and Codex\'s flags are accepted', () => {
  for (const args of CLAUDE_ACCEPTED) {
    assert.equal(refuseApprovalArgs('claude', args), undefined, `claude should accept ${show(args)}`);
  }
});

for (const harness of ['codex', 'claude']) {
  test(`XS10 ${harness}: a hand-written extra_args string the kit can read is judged word by word, as a list is`, () => {
    for (const text of STRINGS[harness].refused) {
      assert.throws(() => refuseApprovalArgs(harness, text), Error, `${harness} should refuse ${show(text)}`);
    }
    for (const text of STRINGS[harness].accepted) {
      assert.equal(refuseApprovalArgs(harness, text), undefined, `${harness} should accept ${show(text)}`);
    }
  });
}

// ================================================================ the CLI

/** A bots folder `init` made, with a Claude bot and a Codex bot, each with a daily session. */
async function fleet(box) {
  const ok = async (args) => {
    const result = await box.run(args);
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  };
  await ok(['init', '--bots', 'bots', '--harness', 'claude']);
  for (const harness of ['claude', 'codex']) {
    await ok(['bot', 'create', '--bots', 'bots', '--name', `${harness}-bot`, '--harness', harness]);
    await ok(['session', 'add', '--bots', 'bots', '--bot', `${harness}-bot`, '--name', 'daily']);
  }
  return box.path('bots');
}

const asExtraArgs = (args) => args.map((arg) => `--extra-arg=${arg}`);
const sessionAdd = (box, bot, name, ...rest) => box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', name, ...rest]);
const sessionChange = (box, bot, ...rest) => box.run(['session', 'change', '--bots', 'bots', '--bot', bot, '--session', 'daily', ...rest]);

/** A refusal that names the road, and leaves the bots folder as it was. */
async function assertRefusedUntouched(result, bots, before) {
  assertRefused(result, POINTER);
  assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
}

/** One session's entry in a bot's bot.yaml. */
async function entryOf(bots, bot, name) {
  const doc = parse(await readFile(botYamlOf(bots, bot), 'utf8'));
  return doc.sessions.find((one) => one.name === name);
}

/** Write `extra` as one session's extra_args in bot.yaml, the way a user edits the file by hand. */
async function writeExtraArgs(bots, bot, name, extra) {
  const file = botYamlOf(bots, bot);
  const doc = parse(await readFile(file, 'utf8'));
  doc.sessions = doc.sessions.map((one) => (one.name === name ? { ...one, extra_args: extra } : one));
  await writeFile(file, stringify(doc));
  assert.deepEqual((await entryOf(bots, bot, name)).extra_args, extra, 'the premise: bot.yaml holds extra_args as written');
}

const CLI_REFUSED = { codex: CODEX_REFUSED, claude: CLAUDE_REFUSED };
const CLI_ACCEPTED = { codex: CODEX_ACCEPTED, claude: CLAUDE_ACCEPTED };

// ------------------------------------------------------------- session add

for (const harness of ['codex', 'claude']) {
  test(`XS11 session add of a ${harness} session refuses each extra arg that widens its scope, naming obk permission approval, and writes nothing`, async (t) => {
    // One fleet for every case: each refusal must leave it as it was.
    const box = await createSandbox(t);
    const bots = await fleet(box);
    const before = await snapshot(bots, skipGit);

    // A name of its own for each case, so one that goes through does not make the next fail for another reason.
    for (const [at, args] of CLI_REFUSED[harness].entries()) {
      await t.test(args.join(' '), async () => {
        await assertRefusedUntouched(await sessionAdd(box, `${harness}-bot`, `review-${at}`, ...asExtraArgs(args)), bots, before);
        assert.equal(await entryOf(bots, `${harness}-bot`, `review-${at}`), undefined, 'no session was added');
      });
    }
  });

  test(`XS12 session add of a ${harness} session takes the extra args that stay accepted, and writes them as given`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);

    for (const [at, args] of CLI_ACCEPTED[harness].entries()) {
      await t.test(args.join(' '), async () => {
        const name = `ok-${at}`;
        const result = await sessionAdd(box, `${harness}-bot`, name, ...asExtraArgs(args));
        assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
        assert.deepEqual((await entryOf(bots, `${harness}-bot`, name)).extra_args, args);
      });
    }
  });
}

test('XS13 a Codex session of a Claude bot is judged as Codex: session add --harness codex refuses -C/Users and -c sandbox_mode, and takes --settings', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const before = await snapshot(bots, skipGit);

  await assertRefusedUntouched(await sessionAdd(box, 'claude-bot', 'review', '--harness', 'codex', '--extra-arg=-C/Users'), bots, before);
  await assertRefusedUntouched(await sessionAdd(box, 'claude-bot', 'review', '--harness', 'codex', '--extra-arg=-c', '--extra-arg=sandbox_mode=read-only'), bots, before);

  const taken = await sessionAdd(box, 'claude-bot', 'review', '--harness', 'codex', '--extra-arg=--settings', '--extra-arg=/srv/settings.json');
  assert.equal(taken.code, 0, `${taken.stdout}${taken.stderr}`);
  assert.deepEqual((await entryOf(bots, 'claude-bot', 'review')).extra_args, ['--settings', '/srv/settings.json']);
});

test('XS13 a Claude session of a Codex bot is judged as Claude: session add --harness claude refuses --add-dir, and takes -c sandbox_mode', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const before = await snapshot(bots, skipGit);

  await assertRefusedUntouched(await sessionAdd(box, 'codex-bot', 'review', '--harness', 'claude', '--extra-arg=--add-dir', '--extra-arg=/srv/wide'), bots, before);

  const taken = await sessionAdd(box, 'codex-bot', 'review', '--harness', 'claude', '--extra-arg=-c', '--extra-arg=sandbox_mode=danger-full-access');
  assert.equal(taken.code, 0, `${taken.stdout}${taken.stderr}`);
  assert.deepEqual((await entryOf(bots, 'codex-bot', 'review')).extra_args, ['-c', 'sandbox_mode=danger-full-access']);
});

// ------------------------------------------------------------- session change

for (const harness of ['codex', 'claude']) {
  test(`XS14 session change of a ${harness} session refuses each extra arg that widens its scope, and writes nothing`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    const before = await snapshot(bots, skipGit);

    for (const args of CLI_REFUSED[harness]) {
      await t.test(args.join(' '), async () => {
        await assertRefusedUntouched(await sessionChange(box, `${harness}-bot`, ...asExtraArgs(args)), bots, before);
      });
    }
  });
}

test('XS15 session change of a Codex session takes an allowed -c and writes it', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);

  const result = await sessionChange(box, 'codex-bot', '--extra-arg=-c', '--extra-arg=model_reasoning_effort=high');

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.deepEqual((await entryOf(bots, 'codex-bot', 'daily')).extra_args, ['-c', 'model_reasoning_effort=high']);
});

// A session moved to the other harness with `session change --harness` keeps
// its extra_args, and the kit judges them on the new harness (#565): a list
// or a hand-written string bot.yaml holds. Each one here is accepted on the
// harness the session leaves and refused on the one it moves to.
const OTHER = { claude: 'codex', codex: 'claude' };
for (const [to, extra] of [
  ['codex', '-p wide'],
  ['codex', '-C /srv/wide'],
  ['codex', '-c sandbox_mode=read-only'],
  ['codex', "-c 'sandbox_workspace_write.writable_roots=[\"/srv/wide\"]'"],
  ['codex', ['-c', 'sandbox_workspace_write.writable_roots=["/srv/wide"]']],
  ['codex', ['--enable', 'web_search']],
  ['codex', ['-c']],
  ['claude', '--settings /srv/settings.json'],
  ['claude', ['--plugin-dir', '/srv/plugins']],
  ['claude', ['--bare']],
]) {
  const from = OTHER[to];
  test(`XS16 session change --harness ${to} of a ${from} session whose bot.yaml holds ${show(extra)} as extra_args is refused, and writes nothing`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await writeExtraArgs(bots, `${from}-bot`, 'daily', extra);
    const before = await snapshot(bots, skipGit);

    await assertRefusedUntouched(await sessionChange(box, `${from}-bot`, '--harness', to), bots, before);
  });
}

for (const extra of ['-c sandbox_workspace_write.network_access=false', ['-c', 'tui.show_tooltips=false', '--search']]) {
  test(`XS17 session change of a Codex session whose bot.yaml holds ${show(extra)} as extra_args goes through`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await writeExtraArgs(bots, 'codex-bot', 'daily', extra);

    const result = await sessionChange(box, 'codex-bot', '--prompt', 'You keep the queue moving.');

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    const entry = await entryOf(bots, 'codex-bot', 'daily');
    assert.equal(entry.prompt, 'You keep the queue moving.');
    assert.deepEqual(entry.extra_args, extra, 'the extra_args stay as written');
  });
}

// The strict reader still takes quoted words with no false refusal: the
// quoted shapes HC8h, HC8m, HC8n and HC8o used (test/session-change-harness.test.js),
// on -m, a flag that stays accepted on Codex. A Claude session whose bot.yaml
// holds the string moves to Codex, and the string stays as written.
for (const [form, extra] of [
  ['a single-quoted value', "-m 'my model'"],
  ['a double-quoted value that holds the text --sandbox', '-m "my --sandbox model"'],
  ['a word joined to a quoted value', "-m='my model'"],
  ['a quoted = at the start of a word', "-m '=sh'"],
]) {
  test(`XS22 a Claude session whose bot.yaml holds the extra_args string ${JSON.stringify(extra)}, ${form}, moves to Codex with session change --harness codex, and the string stays as written`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await writeExtraArgs(bots, 'claude-bot', 'daily', extra);

    const result = await sessionChange(box, 'claude-bot', '--harness', 'codex');

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    const entry = await entryOf(bots, 'claude-bot', 'daily');
    assert.equal(entry.harness, 'codex');
    assert.deepEqual(entry.extra_args, extra, 'the extra_args stay as written');
  });
}

// ------------------------------------------------------------- temp make

/** temp-bot (Claude) with one long-lived session, lead, brought up. */
async function tempFleet(box) {
  const ok = async (args) => {
    const result = await box.run(args);
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  };
  await ok(['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(['bot', 'create', '--bots', 'bots', '--name', 'temp-bot', '--harness', 'claude']);
  await ok(['session', 'add', '--bots', 'bots', '--bot', 'temp-bot', '--name', 'lead', '--prompt', 'You lead the work on the API.']);
  await ok(['up', '--bots', 'bots', '--bot', 'temp-bot']);
  const bots = box.path('bots');
  return { bots, lead: await liveTab(box, bots, 'lead') };
}

const TEMP_REFUSED = [
  ['a Codex temp, --add-dir /srv/wide', ['--harness', 'codex', '--extra-arg=--add-dir', '--extra-arg=/srv/wide']],
  ['a Codex temp, -C/Users', ['--harness', 'codex', '--extra-arg=-C/Users']],
  ['a Codex temp, -pwide', ['--harness', 'codex', '--extra-arg=-pwide']],
  ['a Codex temp, --enable=web_search', ['--harness', 'codex', '--extra-arg=--enable=web_search']],
  ['a Codex temp, -c sandbox_workspace_write.writable_roots', ['--harness', 'codex', '--extra-arg=-c', '--extra-arg=sandbox_workspace_write.writable_roots=["/srv/wide"]']],
  ['a Codex temp, --config=approval_policy=never', ['--harness', 'codex', '--extra-arg=--config=approval_policy=never']],
  ['a Codex temp, -c with no value', ['--harness', 'codex', '--extra-arg=-c']],
  ['a Claude temp, --add-dir=/srv/wide', ['--extra-arg=--add-dir=/srv/wide']],
  ['a Claude temp, --settings /srv/settings.json', ['--extra-arg=--settings', '--extra-arg=/srv/settings.json']],
  ['a Claude temp, --bare', ['--extra-arg=--bare']],
];

test('XS18 temp make refuses an extra arg that widens the temp\'s scope, judged by the temp\'s harness, names obk permission approval, and makes nothing', async (t) => {
  const box = await createSandbox(t);
  const { bots, lead } = await tempFleet(box);
  const before = await world(box, bots);
  const from = (await box.orca.calls()).length;

  for (const [at, [label, args]] of TEMP_REFUSED.entries()) {
    await t.test(label, async () => {
      const result = await make(box, lead, ['--name', `scout-${at}`, '--prompt', TASK, ...args]);

      assertRefused(result, POINTER);
      assert.deepEqual(await world(box, bots), before, 'bot.yaml, the book and Orca are as they were');
      assert.deepEqual(orcaCallsOf((await box.orca.calls()).slice(from), 'terminal create'), [], 'no tab was opened');
    });
  }
});

test('XS19 temp make of a Codex temp takes -c sandbox_workspace_write.network_access=false, as README says', async (t) => {
  const box = await createSandbox(t);
  const { bots, lead } = await tempFleet(box);

  await made(box, lead, ['--name', 'scout', '--prompt', TASK, '--harness', 'codex', '--extra-arg=-c', '--extra-arg=sandbox_workspace_write.network_access=false']);

  assert.deepEqual((await entryOf(bots, 'temp-bot', 'scout')).extra_args, ['-c', 'sandbox_workspace_write.network_access=false']);
});

// ------------------------------------------------------------- groom --on --run-on codex

/** Bot Father with its grooming session, brought up, with a conversation its hook reported. */
async function groomFleet(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'bot-father', '--name', 'grooming', '--model', 'opus']);
  assert.equal(added.code, 0, added.stderr);
  assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);
  const bots = box.path('bots');
  const tab = (await sessionIn(bots, 'bot-father', 'grooming')).tab;
  const told = await recordSession(box, { bots, bot: 'bot-father', tab, session: '0199b2c0-0001-4444-8888-cccccccccccc', source: 'startup' });
  assert.equal(told.code, 0, told.stderr);
  return bots;
}

/** Everything typed into every tab so far, by tab id. */
const sends = async (box) => Object.fromEntries((await box.orca.terminals()).map((terminal) => [terminal.tabId, sentInto(terminal).length]));

test('XS20 groom --on --run-on codex refuses an extra arg that widens the run\'s scope, names obk permission approval, and types nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = await groomFleet(box);
  const before = await snapshot(bots, skipGit);
  const typed = await sends(box);

  for (const args of [
    ['--add-dir', '/srv/wide'],
    ['-C', '/srv/wide'],
    ['--profile=wide'],
    ['--disable', 'sleep_tool'],
    ['--remote', 'ws://127.0.0.1:4500'],
    ['-csandbox_mode=read-only'],
    ['--config=approval_policy=never'],
    ['-c', 'sandbox_workspace_write.writable_roots=["/srv/wide"]'],
    ['-c', 'projects./srv.trust_level=trusted'],
    ['-c'],
  ]) {
    await t.test(args.join(' '), async () => {
      const result = await box.run(['groom', '--bots', 'bots', '--on', '--at', '04:00', '--run-on', 'codex', '--model', 'gpt-6-sol', ...asExtraArgs(args)]);

      assertRefused(result, POINTER);
      assert.deepEqual(await sends(box), typed, 'nothing typed into any tab');
      assert.deepEqual(await snapshot(bots, skipGit), before, 'nothing written');
    });
  }
});

test('XS21 groom --on --run-on codex takes -c sandbox_workspace_write.network_access=false, as today', async (t) => {
  const box = await createSandbox(t);
  await groomFleet(box);
  const typed = await sends(box);

  const result = await box.run(['groom', '--bots', 'bots', '--on', '--at', '04:00', '--run-on', 'codex', '--extra-arg=-c', '--extra-arg=sandbox_workspace_write.network_access=false', '--json']);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.notDeepEqual(await sends(box), typed, 'the --on line was typed');
});
