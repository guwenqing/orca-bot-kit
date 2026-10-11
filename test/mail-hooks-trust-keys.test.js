// What the upgrade past #555 does to the keys Codex trusts a bot's hooks under
// (the review of PR #557).
//
// Codex keys its trust of a hook by `<file>:<event>:<group index>:<handler
// index>` (helpers/codex-hooks.js). #555 takes the kit's PostToolUse Bash
// `session nudge` entry out of a Codex bot's `.codex/hooks.json` on `obk up`.
//
//   K1  A hooks file of the kit's hooks only, as main wrote it (SessionStart
//       record, PostToolUse Bash nudge, Stop name): after the upgrade the two
//       kit hooks that stay keep their keys, session_start:0:0 and stop:0:0,
//       so the trust Codex saved for them before still matches, and the kit
//       finds none of them untrusted (`untrustedKitHooks`, src/hook-trust.js).
//   K2  A user's hook beside the old nudge entry survives the upgrade, and its
//       key changes: (a) in the same PostToolUse group, after the kit's entry,
//       post_tool_use:0:1 becomes :0:0; (b) in a PostToolUse group of its own
//       after the kit's group, post_tool_use:1:0 becomes :0:0. This is the
//       accepted cost recorded in ADR 0042: Codex asks about that hook again.
//
// Every run is in the sandbox (helpers/cli.js). Nothing here reaches the real
// Orca, a real Codex, or the user's own config.toml.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createSandbox, repoRoot } from './helpers/cli.js';
import {
  codexHooksFileOf,
  codexHooksOf,
  trustTablesFor,
  withoutCodexHome,
  writeCodexConfig,
} from './helpers/codex-hooks.js';

const BOT = 'coder';

/** A Codex bot `coder` with a `daily` session, up. */
async function botUp(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'codex'])).code, 0);
  assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily'])).code, 0);
  const up = await box.run(['up', '--bots', 'bots', '--bot', BOT]);
  assert.equal(up.code, 0, up.stderr);
  return box.path('bots');
}

/** The kit's hook in `found` (codexHooksOf) whose command runs `session <kind>`. */
function kitHook(found, kind) {
  const hooks = found.filter((one) => new RegExp(`\\bsession ${kind}\\b`).test(one.command));
  assert.equal(hooks.length, 1, `one session ${kind} hook, got: ${JSON.stringify(found)}`);
  return hooks[0];
}

/**
 * Rewrite the bot's hooks file as main wrote it: the kit's SessionStart and
 * Stop entries as `up` wrote them, and a PostToolUse event whose groups are
 * `postToolUse(nudge)`, where `nudge` is the kit's old nudge entry, made from
 * the record command as main made it.
 */
async function asMainWroteIt(bots, postToolUse) {
  const file = codexHooksFileOf(bots, BOT);
  const held = JSON.parse(await readFile(file, 'utf8'));
  const record = kitHook(await codexHooksOf(bots, BOT), 'record');
  const nudge = { type: 'command', command: record.command.replace(' session record ', ' session nudge '), timeout: 30 };
  const { SessionStart, Stop, ...rest } = held.hooks;
  assert.deepEqual(Object.keys(rest), [], `the premise: up wrote only SessionStart and Stop, got: ${JSON.stringify(held.hooks)}`);
  held.hooks = { SessionStart, PostToolUse: postToolUse(nudge), Stop };
  await writeFile(file, `${JSON.stringify(held, null, 2)}\n`);
  return codexHooksOf(bots, BOT);
}

/** `obk up` again: the upgrade. */
async function upgrade(box) {
  const up = await box.run(['up', '--bots', 'bots', '--bot', BOT]);
  assert.equal(up.code, 0, up.stderr);
}

/** The key's tail after the file: `<event>:<group>:<handler>`. */
const placeOf = (bots, key) => key.slice(codexHooksFileOf(bots, BOT).length + 1);

/**
 * `untrustedKitHooks` for the bot, run in a child with the sandbox's HOME, so
 * it reads the sandbox's config.toml, and with the sandbox's obk as argv[1],
 * the CLI the kit takes for its own when it tells its hooks from others.
 */
function untrustedNow(box, bots) {
  const script = [
    `import { untrustedKitHooks } from ${JSON.stringify(path.join(repoRoot, 'src', 'hook-trust.js'))};`,
    "const answer = untrustedKitHooks(process.argv[2], 'the test', 'Nothing was done.');",
    'process.stdout.write(JSON.stringify(answer));',
  ].join('\n');
  const ran = spawnSync(process.execPath, ['--input-type=module', '-e', script, box.cli, path.join(bots, 'bots', BOT)], {
    env: withoutCodexHome(box.env),
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.equal(ran.status, 0, `untrustedKitHooks ran: ${ran.stdout}${ran.stderr}`);
  return JSON.parse(ran.stdout);
}

// ------------------------------------------------------------- K1

test('K1 a kit-only Codex hooks file as main wrote it: after the upgrade the record and name hooks keep their keys, and the trust saved for them still matches', async (t) => {
  const box = await createSandbox(t);
  const bots = await botUp(box);
  const before = await asMainWroteIt(bots, (nudge) => [{ matcher: 'Bash', hooks: [nudge] }]);
  const oldRecord = kitHook(before, 'record');
  const oldName = kitHook(before, 'name');
  assert.equal(placeOf(bots, oldRecord.key), 'session_start:0:0', 'the premise: main\'s record key');
  assert.equal(placeOf(bots, oldName.key), 'stop:0:0', 'the premise: main\'s name key');
  // Codex trusted the two hooks that stay, as it saved them before the upgrade.
  await writeCodexConfig(path.join(box.home, '.codex'), trustTablesFor([oldRecord, oldName]));

  await upgrade(box);

  const after = await codexHooksOf(bots, BOT);
  assert.deepEqual(after.filter((one) => /\bsession nudge\b/.test(one.command)), [], 'the nudge entry is gone');
  const record = kitHook(after, 'record');
  const name = kitHook(after, 'name');
  assert.equal(record.key, oldRecord.key, 'the record hook keeps its key');
  assert.equal(record.hash, oldRecord.hash, 'and its hash');
  assert.equal(name.key, oldName.key, 'the name hook keeps its key');
  assert.equal(name.hash, oldName.hash, 'and its hash');
  assert.deepEqual(untrustedNow(box, bots).untrusted, 0, 'so the trust saved before still matches: none of the kit\'s hooks is untrusted');
});

// ------------------------------------------------------------- K2

const USER_HOOK = { type: 'command', command: "echo 'my own PostToolUse hook'" };

for (const [what, postToolUse, oldPlace] of [
  ['in the same PostToolUse group, after the kit\'s nudge entry', (nudge) => [{ matcher: 'Bash', hooks: [nudge, USER_HOOK] }], 'post_tool_use:0:1'],
  ['in a PostToolUse group of its own, after the kit\'s group', (nudge) => [{ matcher: 'Bash', hooks: [nudge] }, { matcher: 'Bash', hooks: [USER_HOOK] }], 'post_tool_use:1:0'],
]) {
  test(`K2 a user's hook ${what} survives the upgrade, and its key moves from ${oldPlace} to post_tool_use:0:0 (the accepted cost, ADR 0042)`, async (t) => {
    const box = await createSandbox(t);
    const bots = await botUp(box);
    const before = await asMainWroteIt(bots, postToolUse);
    const mineBefore = before.filter((one) => one.command === USER_HOOK.command);
    assert.equal(mineBefore.length, 1, `the premise: the user's hook is there once, got: ${JSON.stringify(before)}`);
    assert.equal(placeOf(bots, mineBefore[0].key), oldPlace, 'the premise: where the user\'s hook was');

    await upgrade(box);

    const after = await codexHooksOf(bots, BOT);
    assert.deepEqual(after.filter((one) => /\bsession nudge\b/.test(one.command)), [], 'the nudge entry is gone');
    const mine = after.filter((one) => one.command === USER_HOOK.command);
    assert.equal(mine.length, 1, `the user's hook survives, once, got: ${JSON.stringify(after)}`);
    assert.equal(placeOf(bots, mine[0].key), 'post_tool_use:0:0', 'its key changes: Codex will ask about it again');
    assert.notEqual(mine[0].key, mineBefore[0].key);
    assert.equal(placeOf(bots, kitHook(after, 'record').key), 'session_start:0:0', 'the kit\'s record hook keeps its key');
    assert.equal(placeOf(bots, kitHook(after, 'name').key), 'stop:0:0', 'the kit\'s name hook keeps its key');
  });
}
