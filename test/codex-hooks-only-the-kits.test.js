// Trust only the kit's own hooks (#506, point 6 of the brief, and the
// architect's ruling on it). "Trust all and continue" lets every hook the
// review covers run outside Codex's sandbox, and a permission rule will allow
// the command with no person in the loop. So before any key goes in, `obk
// session trust-hooks` and `obk temp trust-hooks` (shared code) check that the
// review covers only the kit's own hooks:
//
//   a. The bot's `.codex/hooks.json` holds only the kit's own hooks, as `obk
//      up` writes them: SessionStart `session record`, PostToolUse for Bash
//      `session nudge`, Stop `session name`, each run by the kit that runs the
//      command, by its path. Any other hook, or a kit-shaped command that runs
//      another program, is refused, naming what was found.
//   b. The count row on the screen (`1 hook is new or changed.`, `N hooks are
//      new or changed.`) is the number of the kit's hooks in that file that
//      Codex does not trust yet. Any other count is refused, and so is a
//      review with no count row.
//   c. Where the kit cannot tell, it refuses. It reads only the
//      `[hooks.state."…"]` header lines of config.toml and the `trusted_hash`
//      lines under them. A header for one of the kit's keys with no
//      `trusted_hash` under it, or a kit key in any other form (an inline
//      table, a key line under `[hooks.state]`, a dotted key under `[hooks]`),
//      is "cannot tell". A missing config.toml is clean: nothing is trusted.
//      Other hooks' keys in the usual form are fine and do not count. A key
//      written with TOML's escapes (`\u002F` for `/`) is the key it decodes
//      to: in the usual form its trust counts, in any other form it is
//      "cannot tell".
//   d. It never prints any other part of config.toml, which can hold the
//      user's secrets.
//
// How Codex records trust, and the hash, are in helpers/codex-hooks.js, worked
// out from the brief and checked here against the one real entry it gives.
// config.toml is `$CODEX_HOME/config.toml`, else `~/.codex/config.toml`; in
// the sandbox the home is the sandbox's own, and CODEX_HOME is taken out of the
// environment unless a test sets it.
//
//   e. Codex also takes hook trust from the session's own `-c` flags, which
//      the kit does not read. At each launch (`up`, `restart`, `temp make`)
//      the kit writes into the session's book entry `launched_with`: its
//      extra_args as bot.yaml gave them for that launch line (a list, a
//      string, or `[]`). When it mentions `hooks` anywhere, in any letters,
//      the kit cannot tell, and refuses, saying why. When it is missing, the
//      kit cannot tell either, and says to restart the session. bot.yaml
//      changed after the launch does not count.
//
// Each refusal types nothing into any tab. The cases run for coder/daily, a
// long-lived session of a Codex bot, through `session trust-hooks`, and the
// ones marked `both` run for writer's temporary Codex session scout too,
// through `temp trust-hooks` in its maker lead's tab.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it as test } from 'node:test';

import YAML from 'yaml';

import { botHomeOf, conversationOnRecord, createSandbox, kitLaunchMark, recordSession, sentInto, sessionIn } from './helpers/cli.js';
import {
  codexHooksFileOf,
  codexHooksOf,
  ESCAPED_OTHER_FORMS,
  escapedTomlString,
  escapedTrustTablesFor,
  hookStateFlag,
  literalTrustTablesFor,
  stateKey,
  trustedHash,
  trustTablesFor,
  withoutCodexHome,
  writeCodexConfig,
} from './helpers/codex-hooks.js';
import { codexTrustArgs } from './helpers/codex-trust.js';
import { CODEX_AFTER_TRUST, CODEX_HOOKS_REVIEW_NO_COUNT, codexHooksReview } from './helpers/screens.js';

const TASK = 'Read the open pull request and write down what it changes.';

/** Down one, then return: from the review's first choice to "Trust all and continue", taken. */
const DOWN_RETURN = '\x1b[B\r';

/** The kit's three Codex hooks, by the event each sits under, in the order `obk up` writes them. */
const KIT_EVENTS = ['SessionStart', 'PostToolUse', 'Stop'];

/** The terminal Orca has for a session, by the book's tab. */
async function tabOf(box, bots, bot, name) {
  const tab = (await sessionIn(bots, bot, name))?.tab;
  const found = (await box.orca.terminals()).find((one) => one.tabId === tab);
  assert.ok(found, `Orca should have ${bot}/${name}'s tab ${tab}`);
  return found;
}

/**
 * A bots folder with coder on Codex (its long-lived session daily) and writer
 * on Claude Code (its long-lived session lead), brought up, and a temporary
 * Codex session scout that lead made. Both bots hold the kit's three Codex
 * hooks, by the sandbox's kit (the premise every count here rests on).
 * `dailyExtra`, when given, is the extra arguments daily is added with;
 * `scoutExtra(bots)` those scout is made with. `folder` is the bots folder's
 * name in the sandbox's working folder.
 */
async function fleet(box, { dailyExtra = [], scoutExtra, folder = 'bots' } = {}) {
  const env = withoutCodexHome(box.env);
  const ok = async (args, extra = {}) => {
    const result = await box.run(args, { env: { ...env, ...extra } });
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  };
  await ok(['init', '--bots', folder, '--harness', 'claude']);
  await ok(['bot', 'create', '--bots', folder, '--name', 'coder', '--harness', 'codex']);
  await ok(['session', 'add', '--bots', folder, '--bot', 'coder', '--name', 'daily', ...dailyExtra.map((arg) => `--extra-arg=${arg}`)]);
  await ok(['bot', 'create', '--bots', folder, '--name', 'writer', '--harness', 'claude']);
  await ok(['session', 'add', '--bots', folder, '--bot', 'writer', '--name', 'lead']);
  await ok(['up', '--bots', folder]);
  const bots = box.path(folder);
  const lead = await tabOf(box, bots, 'writer', 'lead');
  const extra = scoutExtra === undefined ? [] : (await scoutExtra(bots)).map((arg) => `--extra-arg=${arg}`);
  await ok(['temp', 'make', '--bots', folder, '--name', 'scout', '--harness', 'codex', '--prompt', TASK, ...extra], {
    ORCA_TERMINAL_HANDLE: lead.handle,
    ORCA_TAB_ID: lead.tabId,
    ...kitLaunchMark(box, lead),
  });
  for (const bot of ['coder', 'writer']) {
    const hooks = await codexHooksOf(bots, bot);
    assert.deepEqual(hooks.map((one) => one.event), KIT_EVENTS, `the premise: ${bot}'s .codex/hooks.json holds the kit's three hooks: ${JSON.stringify(hooks)}`);
    for (const one of hooks) assert.ok(one.command.startsWith(`${box.cli} session `), `the premise: each is run by the sandbox's kit, ${box.cli}: ${one.command}`);
  }
  return {
    bots,
    lead,
    daily: await tabOf(box, bots, 'coder', 'daily'),
    scout: await tabOf(box, bots, 'writer', 'scout'),
  };
}

/** The two commands, the session each answers, and how each is run. */
const TARGETS = {
  'session trust-hooks': {
    bot: 'coder',
    tab: (ours) => ours.daily,
    args: ['session', 'trust-hooks', '--bots', 'bots', '--bot', 'coder', '--session', 'daily'],
    caller: () => ({}),
  },
  'temp trust-hooks': {
    bot: 'writer',
    tab: (ours) => ours.scout,
    args: ['temp', 'trust-hooks', '--bots', 'bots', '--name', 'scout'],
    caller: (box, ours) => ({ ORCA_TERMINAL_HANDLE: ours.lead.handle, ORCA_TAB_ID: ours.lead.tabId, ...kitLaunchMark(box, ours.lead) }),
  },
};

/** Run the target's command, with CODEX_HOME only when `codexHome` names one. */
const trust = (box, ours, target, codexHome) => box.run(target.args, {
  env: { ...withoutCodexHome(box.env), ...target.caller(box, ours), ...(codexHome === undefined ? {} : { CODEX_HOME: codexHome }) },
});

/** Show the target's tab a review: `count` hooks (or `rows` as given), moving on at the next key when `goes`. */
async function showReview(box, ours, target, count, { goes = false, rows } = {}) {
  const tab = target.tab(ours).tabId;
  const screen = rows ?? codexHooksReview(count);
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((terminal) => {
      if (terminal.tabId !== tab) return terminal;
      const { screenAfterSend: _gone, ...rest } = terminal;
      return goes ? { ...rest, screen, screenAfterSend: CODEX_AFTER_TRUST } : { ...rest, screen };
    }),
  });
}

/** Every `terminal send` so far into every tab, by tab id. */
async function sendsByTab(box) {
  return Object.fromEntries((await box.orca.terminals()).map((terminal) => [terminal.tabId, sentInto(terminal)]));
}

/** What was sent since `before`, by tab id, for the tabs that got anything. */
async function sentSince(box, before) {
  const sent = {};
  for (const [tab, sends] of Object.entries(await sendsByTab(box))) {
    const since = sends.slice((before[tab] ?? []).length);
    if (since.length > 0) sent[tab] = since;
  }
  return sent;
}

/** A refusal: a non-zero exit, something said, no crash, and nothing typed into any tab. */
async function assertRefusedUntyped(box, result, before, what) {
  const said = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.code, 0, `${what} should be refused, got:\n${said}`);
  assert.notEqual(said.trim(), '', `${what}: a refusal says why`);
  assert.ok(!/^\s+at /m.test(said), `${what}: a message, not a crash:\n${said}`);
  assert.deepEqual(await sentSince(box, before), {}, `${what}: nothing is typed into any tab`);
  return said;
}

/** Answered: exit 0, down and return into the target's tab and no other, with no --enter. */
async function assertAnswered(box, result, before, tab, what) {
  assert.equal(result.code, 0, `${what}: it answers the review:\n${result.stdout}${result.stderr}`);
  const sent = await sentSince(box, before);
  assert.deepEqual(Object.keys(sent), [tab], `${what}: keys go into the session's tab and no other: ${JSON.stringify(sent)}`);
  assert.ok(sent[tab].every((one) => one.enter === false), `${what}: with no --enter: ${JSON.stringify(sent[tab])}`);
  assert.equal(sent[tab].map((one) => one.text).join(''), DOWN_RETURN, `${what}: down, then return`);
}

/** The count row a review of `count` hooks shows, as the refusal may quote it. */
const countWords = (count) => new RegExp(`\\b${count} hooks?\\b`);

/**
 * Each count in `refused` is refused, saying the count it saw, with nothing
 * typed; then, when `answered` is a count, a review of that many is answered.
 */
async function assertCounts(box, ours, target, { refused, answered, codexHome, what }) {
  const tab = target.tab(ours).tabId;
  for (const count of refused) {
    await showReview(box, ours, target, count);
    const before = await sendsByTab(box);
    const said = await assertRefusedUntyped(box, await trust(box, ours, target, codexHome), before, `${what}: a review of ${count}`);
    assert.match(said, countWords(count), `${what}: it says the count it saw, ${count}: ${said}`);
  }
  if (answered === undefined) return;
  await showReview(box, ours, target, answered, { goes: true });
  const before = await sendsByTab(box);
  await assertAnswered(box, await trust(box, ours, target, codexHome), before, tab, `${what}: a review of ${answered}`);
}

/** The target bot's three kit hooks, by event: `{ SessionStart: { key, hash, command }, … }`. */
async function kitHooks(ours, target) {
  return Object.fromEntries((await codexHooksOf(ours.bots, target.bot)).map((one) => [one.event, one]));
}

/** The sandbox home's Codex folder, where config.toml is read when CODEX_HOME is not set. */
const homeCodex = (box) => path.join(box.home, '.codex');

/** A hash that is no hook's. */
const WRONG_HASH = `sha256:${'0'.repeat(64)}`;

/** How many of the tests below run at once: each brings up a fleet of its own in its own sandbox. */
const AT_ONCE = { concurrency: 8 };

test('K0 the helper\'s hash agrees with the entry Codex wrote for a real kit hook (the brief\'s example)', () => {
  const hash = trustedHash({
    event: 'SessionStart',
    command: '/opt/homebrew/bin/obk session record --bots /Volumes/DevData/projects/ai/mybots --bot amc-tutor 2>/dev/null || true',
    timeout: 10,
  });
  assert.equal(hash, 'sha256:2f8ef3e0ee8c9652b6838816fa5c2ea4998031c2e1378ea505b96ab31792dd77');
});

// The K0 premises that need a TOML reader are in
// dev/codex-hooks-toml-premises.test.js. The reader, smol-toml, is a dev
// dependency, and the floor runs this file where only the kit's own
// dependencies are installed (#533).

test('K0 the premise: a shell reads "-c \'h\'\'ooks.state={…}\'" as the same two words as "-c \'hooks.state={…}\'"', () => {
  const flag = hookStateFlag({ key: '/b/bots/coder/.codex/hooks.json:session_start:0:0', hash: WRONG_HASH });
  const words = (text) => execFileSync('/bin/sh', ['-c', `printf '%s\\n' ${text}`], { encoding: 'utf8' }).split('\n').slice(0, -1);
  assert.deepEqual(words(`-c '${flag}'`), ['-c', flag]);
  assert.deepEqual(words(splitHooks(`-c '${flag}'`)), ['-c', flag]);
  assert.ok(!/hooks/i.test(splitHooks(`-c '${flag}'`)), 'the premise: the split string has no "hooks" in it');
});

for (const [name, target] of Object.entries(TARGETS)) {
  const sessionOnly = name === 'session trust-hooks';

  describe(`${name}: only the kit's own hooks`, AT_ONCE, () => {
    // ---------------------------------------------------------- b. the count, with no config.toml

    test(`K1 ${name}: a fresh bot, no config.toml: "3 hooks are new or changed." is answered`, async (t) => {
      const box = await createSandbox(t);
      const ours = await fleet(box);

      await assertCounts(box, ours, target, { refused: [], answered: 3, what: 'no config.toml' });
    });

    test(`K1 ${name}: a fresh bot, no config.toml: a review of 1, 2 or 4 hooks is refused, saying the count, and nothing is typed`, async (t) => {
      const box = await createSandbox(t);
      const ours = await fleet(box);

      await assertCounts(box, ours, target, { refused: [1, 2, 4], what: 'no config.toml' });
    });

    test(`K1 ${name}: a review with no count row is refused, and nothing is typed; with its count row it is answered`, async (t) => {
      const box = await createSandbox(t);
      const ours = await fleet(box);
      await showReview(box, ours, target, undefined, { rows: CODEX_HOOKS_REVIEW_NO_COUNT });
      const before = await sendsByTab(box);

      await assertRefusedUntyped(box, await trust(box, ours, target), before, 'a review with no count row');
      await assertCounts(box, ours, target, { refused: [], answered: 3, what: 'the same review with its count row' });
    });

    // ---------------------------------------------------------- b. the count, with hooks trusted

    for (const { label, inBoth, config, answered, refused } of [
      {
        label: 'PostToolUse and Stop trusted at their right hashes: 1 is not trusted yet',
        inBoth: true,
        config: (k) => trustTablesFor([k.PostToolUse, k.Stop]),
        answered: 1,
        refused: [3, 2],
      },
      {
        label: 'SessionStart trusted at its right hash: 2 are not trusted yet',
        config: (k) => trustTablesFor([k.SessionStart]),
        answered: 2,
        refused: [3, 1],
      },
      {
        label: 'all three trusted at their right hashes: none is new, so any review is refused',
        inBoth: true,
        config: (k) => trustTablesFor([k.SessionStart, k.PostToolUse, k.Stop]),
        answered: undefined,
        refused: [1, 3],
      },
      {
        label: 'SessionStart trusted at a wrong hash, which counts as changed: 3',
        inBoth: true,
        config: (k) => trustTablesFor([{ key: k.SessionStart.key, hash: WRONG_HASH }]),
        answered: 3,
        refused: [2],
      },
      {
        label: 'PostToolUse and Stop right, SessionStart at a wrong hash: 1',
        config: (k) => trustTablesFor([{ key: k.SessionStart.key, hash: WRONG_HASH }, k.PostToolUse, k.Stop]),
        answered: 1,
        refused: [2, 3],
      },
      {
        label: 'Stop trusted at the hash it would have without "async": true, a near miss that counts as changed: 3',
        config: (k) => trustTablesFor([{ key: k.Stop.key, hash: trustedHash({ event: 'Stop', command: k.Stop.command, timeout: k.Stop.timeout, async: false }) }]),
        answered: 3,
        refused: [2],
      },
      {
        label: 'PostToolUse trusted at the hash it would have without its matcher, a near miss that counts as changed: 3',
        config: (k) => trustTablesFor([{ key: k.PostToolUse.key, hash: trustedHash({ event: 'PostToolUse', command: k.PostToolUse.command, timeout: k.PostToolUse.timeout, async: k.PostToolUse.async }) }]),
        answered: 3,
        refused: [2],
      },
      {
        label: 'the right hashes of PostToolUse and Stop under keys with group index 1, which are other hooks\' keys: 3',
        config: (k) => trustTablesFor([
          { key: k.PostToolUse.key.replace(/:0:0$/, ':1:0'), hash: k.PostToolUse.hash },
          { key: k.Stop.key.replace(/:0:0$/, ':1:0'), hash: k.Stop.hash },
        ]),
        answered: 3,
        refused: [1],
      },
      {
        label: 'the right hashes of PostToolUse and Stop under another hooks.json\'s path, which are other hooks\' keys: 3',
        config: (k, box) => {
          const other = path.join(box.root, 'elsewhere', '.codex', 'hooks.json');
          return trustTablesFor([
            { key: stateKey(other, 'PostToolUse', 0, 0), hash: k.PostToolUse.hash },
            { key: stateKey(other, 'Stop', 0, 0), hash: k.Stop.hash },
          ]);
        },
        answered: 3,
        refused: [1],
      },
      {
        label: 'other hooks\' keys and a folder\'s trust in the usual form, which do not count: 3',
        config: (k, box) => [
          `[projects.${JSON.stringify(path.join(box.root, 'elsewhere'))}]\ntrust_level = "trusted"\n`,
          trustTablesFor([{ key: stateKey(path.join(box.root, 'elsewhere', '.codex', 'hooks.json'), 'SessionStart', 0, 0), hash: WRONG_HASH }]),
        ].join('\n'),
        answered: 3,
        refused: [2],
      },
      {
        label: 'PostToolUse and Stop trusted at their right hashes, their keys written with TOML\'s Unicode escapes, which are the same keys: 1 is not trusted yet',
        inBoth: true,
        config: (k) => escapedTrustTablesFor([k.PostToolUse, k.Stop]),
        answered: 1,
        refused: [3, 2],
      },
    ]) {
      if (!sessionOnly && !inBoth) continue;
      test(`K2 ${name}: ${label}`, async (t) => {
        const box = await createSandbox(t);
        const ours = await fleet(box);
        await writeCodexConfig(homeCodex(box), config(await kitHooks(ours, target), box));

        await assertCounts(box, ours, target, { refused, answered, what: label });
      });
    }

    // ---------------------------------------------------------- where config.toml is

    test(`K3 ${name}: with CODEX_HOME set, its config.toml is read: PostToolUse and Stop trusted there and none in ~/.codex, so 1`, async (t) => {
      const box = await createSandbox(t);
      const ours = await fleet(box);
      const k = await kitHooks(ours, target);
      const codexHome = path.join(box.root, 'codex-home');
      await writeCodexConfig(codexHome, trustTablesFor([k.PostToolUse, k.Stop]));

      await assertCounts(box, ours, target, { refused: [3], answered: 1, codexHome, what: 'CODEX_HOME\'s config.toml' });
    });

    if (sessionOnly) {
      test(`K3 ${name}: with CODEX_HOME set, ~/.codex/config.toml is not read: PostToolUse and Stop trusted there, CODEX_HOME's empty, so 3`, async (t) => {
        const box = await createSandbox(t);
        const ours = await fleet(box);
        const k = await kitHooks(ours, target);
        await writeCodexConfig(homeCodex(box), trustTablesFor([k.PostToolUse, k.Stop]));
        const codexHome = path.join(box.root, 'codex-home');
        await writeCodexConfig(codexHome, '');

        await assertCounts(box, ours, target, { refused: [1], answered: 3, codexHome, what: '~/.codex beside CODEX_HOME' });
      });
    }

    // ---------------------------------------------------------- a. only the kit's hooks in hooks.json

    for (const { label, inBoth, change, found, counts } of [
      {
        label: 'a hook of the user\'s own in a group of its own under PostToolUse',
        inBoth: true,
        change: (hooks) => ({ ...hooks, PostToolUse: [...hooks.PostToolUse, { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo not-the-kit-506', timeout: 5 }] }] }),
        found: 'not-the-kit-506',
        counts: [4, 3],
      },
      {
        label: 'a hook of the user\'s own under an event the kit does not use',
        change: (hooks) => ({ ...hooks, UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo not-the-kit-506', timeout: 5 }] }] }),
        found: 'not-the-kit-506',
        counts: [4, 3],
      },
      {
        label: 'a hook of the user\'s own in the kit\'s SessionStart group, after the kit\'s',
        change: (hooks) => ({ ...hooks, SessionStart: [{ ...hooks.SessionStart[0], hooks: [...hooks.SessionStart[0].hooks, { type: 'command', command: 'echo not-the-kit-506', timeout: 5 }] }] }),
        found: 'not-the-kit-506',
        counts: [4, 3],
      },
      {
        label: 'the kit\'s SessionStart command run by an obk that is not the kit running the command',
        inBoth: true,
        change: (hooks, box) => withProgram(hooks, 'SessionStart', box.cli, path.join(box.root, 'elsewhere', 'obk')),
        found: (box) => path.join(box.root, 'elsewhere', 'obk'),
        counts: [3],
      },
      {
        label: 'the kit\'s Stop command run by another checkout\'s src/cli.js',
        change: (hooks, box) => withProgram(hooks, 'Stop', box.cli, '/opt/not-the-kit/src/cli.js'),
        found: '/opt/not-the-kit/src/cli.js',
        counts: [3],
      },
    ]) {
      if (!sessionOnly && !inBoth) continue;
      test(`K4 ${name}: ${label} is refused, naming what it found, and nothing is typed`, async (t) => {
        const box = await createSandbox(t);
        const ours = await fleet(box);
        const file = codexHooksFileOf(ours.bots, target.bot);
        const parsed = JSON.parse(await readFile(file, 'utf8'));
        await writeFile(file, `${JSON.stringify({ ...parsed, hooks: change(parsed.hooks, box) }, null, 2)}\n`);
        const named = typeof found === 'function' ? found(box) : found;

        for (const count of counts) {
          await showReview(box, ours, target, count, { goes: true });
          const before = await sendsByTab(box);
          const said = await assertRefusedUntyped(box, await trust(box, ours, target), before, `${label}, a review of ${count}`);
          assert.ok(said.includes(named), `it names what it found, ${named}: ${said}`);
        }
      });
    }

    // ---------------------------------------------------------- c. where the kit cannot tell

    // Each case beside its counterpart in the usual form, which the kit reads:
    // `clean`, under which a review of `answered` is answered.
    for (const { label, inBoth, config, clean, answered } of [
      {
        label: 'a header for the kit\'s SessionStart key with no trusted_hash under it, another table after it',
        inBoth: true,
        config: (k) => `[hooks.state.${JSON.stringify(k.SessionStart.key)}]\n\n${trustTablesFor([k.PostToolUse, k.Stop])}`,
        clean: (k) => trustTablesFor([k.PostToolUse, k.Stop]),
        answered: 1,
      },
      {
        label: 'a header for the kit\'s SessionStart key with no trusted_hash under it, at the end of the file',
        config: (k) => `${trustTablesFor([k.PostToolUse])}\n[hooks.state.${JSON.stringify(k.SessionStart.key)}]\n`,
        clean: (k) => trustTablesFor([k.PostToolUse]),
        answered: 2,
      },
      {
        label: 'the kit\'s SessionStart key in an inline table, hooks.state = { "<key>" = { trusted_hash = … } }',
        inBoth: true,
        config: (k) => `hooks.state = { ${JSON.stringify(k.SessionStart.key)} = { trusted_hash = ${JSON.stringify(k.SessionStart.hash)} } }\n`,
        clean: (k) => trustTablesFor([k.SessionStart]),
        answered: 2,
      },
      {
        label: 'the kit\'s SessionStart key as a key line under a [hooks.state] table',
        config: (k) => `[hooks.state]\n${JSON.stringify(k.SessionStart.key)} = { trusted_hash = ${JSON.stringify(k.SessionStart.hash)} }\n`,
        clean: (k) => trustTablesFor([k.SessionStart]),
        answered: 2,
      },
      {
        label: 'the kit\'s SessionStart key as a dotted key under a [hooks] table',
        config: (k) => `[hooks]\nstate.${JSON.stringify(k.SessionStart.key)}.trusted_hash = ${JSON.stringify(k.SessionStart.hash)}\n`,
        clean: (k) => trustTablesFor([k.SessionStart]),
        answered: 2,
      },
      {
        label: 'the kit\'s SessionStart key in a literal-string table, [hooks.state.\'<key>\']',
        config: (k) => literalTrustTablesFor([k.SessionStart]),
        clean: (k) => trustTablesFor([k.SessionStart]),
        answered: 2,
      },
      ...Object.entries(ESCAPED_OTHER_FORMS).map(([form, write]) => ({
        label: `the kit's SessionStart key written with TOML's Unicode escapes, in ${form}`,
        config: (k) => write(k.SessionStart),
        clean: (k) => trustTablesFor([k.SessionStart]),
        answered: 2,
      })),
      {
        label: 'a header for the kit\'s SessionStart key written with TOML\'s Unicode escapes, with no trusted_hash under it, another table after it',
        config: (k) => `[hooks.state.${escapedTomlString(k.SessionStart.key)}]\n\n${trustTablesFor([k.PostToolUse, k.Stop])}`,
        clean: (k) => trustTablesFor([k.PostToolUse, k.Stop]),
        answered: 1,
      },
    ]) {
      if (!sessionOnly && !inBoth) continue;
      test(`K5 ${name}: ${label}: the kit cannot tell, so a review of 1, 2 or 3 is refused, and nothing is typed; in the usual form, ${answered} is answered`, async (t) => {
        const box = await createSandbox(t);
        const ours = await fleet(box);
        const k = await kitHooks(ours, target);
        await writeCodexConfig(homeCodex(box), config(k));

        for (const count of [1, 2, 3]) {
          await showReview(box, ours, target, count, { goes: true });
          const before = await sendsByTab(box);
          await assertRefusedUntyped(box, await trust(box, ours, target), before, `${label}, a review of ${count}`);
        }

        await writeCodexConfig(homeCodex(box), clean(k));
        await assertCounts(box, ours, target, { refused: [], answered, what: `${label}, written in the usual form` });
      });
    }

    // ---------------------------------------------------------- e. what the session was launched with

    if (sessionOnly) {
      for (const { label, extra } of [
        { label: 'a list, -c hooks.state={…}', extra: (entry) => ['-c', hookStateFlag(entry)] },
        { label: 'a list, --config hooks.state={…}', extra: (entry) => ['--config', hookStateFlag(entry)] },
        { label: 'a plain string of shell text, -c \'hooks.state={…}\'', extra: (entry) => `-c '${hookStateFlag(entry)}'` },
      ]) {
        test(`K7 ${name}: daily restarted with extra_args ${label}, trusting the kit's SessionStart hook at its right hash: the kit cannot tell, so a review of 1, 2 or 3 is refused, saying why, and nothing is typed`, async (t) => {
          const box = await createSandbox(t);
          const ours = await fleet(box);
          await setExtraArgs(box, ours, extra((await kitHooks(ours, target)).SessionStart));
          await relaunchDaily(box, ours);

          await assertExtraArgsRefused(box, ours, target, label);
        });
      }

      test(`K7 ${name}: daily's book entry says it was launched with "-c 'Hooks.state=…'", hooks in other letters, and bot.yaml has none: the kit cannot tell, so a review of 1, 2 or 3 is refused, saying why, and nothing is typed`, async (t) => {
        const box = await createSandbox(t);
        const ours = await fleet(box);
        const k = await kitHooks(ours, target);
        await setLaunchedWith(ours, `-c '${hookStateFlag(k.SessionStart).replace(/^hooks/, 'Hooks')}'`);

        await assertExtraArgsRefused(box, ours, target, 'launched_with naming Hooks');
      });

      test(`K5 ${name}: a bots folder named bots\\trust, PostToolUse and Stop trusted in literal-string tables [hooks.state.'<key>'] at their right hashes: the kit cannot tell, so a review of 1, 2 or 3 is refused, and nothing is typed; in the usual form, 1 is answered`, async (t) => {
        const box = await createSandbox(t);
        const folder = 'bots\\trust';
        const ours = await fleet(box, { folder });
        const here = { ...target, args: target.args.map((arg) => (arg === 'bots' ? folder : arg)) };
        const k = await kitHooks(ours, here);
        assert.ok(k.PostToolUse.key.includes('bots\\trust'), `the premise: the kit's keys hold the backslash: ${k.PostToolUse.key}`);
        await writeCodexConfig(homeCodex(box), literalTrustTablesFor([k.PostToolUse, k.Stop]));

        for (const count of [3, 2, 1]) {
          await showReview(box, ours, here, count, { goes: true });
          const before = await sendsByTab(box);
          await assertRefusedUntyped(box, await trust(box, ours, here), before, `literal-string tables under bots\\trust, a review of ${count}`);
        }

        await writeCodexConfig(homeCodex(box), trustTablesFor([k.PostToolUse, k.Stop]));
        await assertCounts(box, ours, here, { refused: [], answered: 1, what: 'bots\\trust, written in the usual form' });
      });

      for (const { label, record } of [
        { label: 'with each "hooks" split by adjacent quotes, "-c \'h\'\'ooks.state={…/.codex/h\'\'ooks.json…}\'", which the shell reads as the hooks.state flag', record: (k) => splitHooks(`-c '${hookStateFlag(k.SessionStart)}'`) },
        { label: 'with a quote in it and no hooks at all, "-c \'tui.show_tooltips=false\'"', record: () => "-c 'tui.show_tooltips=false'" },
      ]) {
        test(`K7 ${name}: daily's book entry says it was launched with a plain string ${label}: the kit cannot tell, so a review of 1, 2 or 3 is refused, and nothing is typed`, async (t) => {
          const box = await createSandbox(t);
          const ours = await fleet(box);
          await setLaunchedWith(ours, record(await kitHooks(ours, target)));

          for (const count of [3, 2, 1]) {
            await showReview(box, ours, target, count, { goes: true });
            const before = await sendsByTab(box);
            await assertRefusedUntyped(box, await trust(box, ours, target), before, `${label}, a review of ${count}`);
          }
        });
      }

      // Codex's --profile <name> (-p <name>) loads a second user config,
      // <name>.config.toml, whose hook trust the kit does not read.
      for (const record of [['--profile', 'work'], ['-p', 'work'], ['-pwork'], '--profile=work', ['-c', 'profile=work']]) {
        test(`K7 ${name}: daily's book entry says it was launched with ${JSON.stringify(record)}, a profile: the kit cannot tell, so a review of 1, 2 or 3 is refused, and nothing is typed`, async (t) => {
          const box = await createSandbox(t);
          const ours = await fleet(box);
          await setLaunchedWith(ours, record);

          await assertRefusedAtEveryCount(box, ours, target, `launched with ${JSON.stringify(record)}`);
        });
      }

      test(`K7 ${name}: daily's book entry says it was launched with ["-m","gpt-x","--add-dir","/tmp/x"], no profile and no hooks: "3 hooks are new or changed." is answered`, async (t) => {
        const box = await createSandbox(t);
        const ours = await fleet(box);
        await setLaunchedWith(ours, ['-m', 'gpt-x', '--add-dir', '/tmp/x']);

        await assertCounts(box, ours, target, { refused: [1], answered: 3, what: 'a record with no profile' });
      });

      test(`K7 ${name}: daily's book entry says it was launched with a system test's words, codexTrustArgs with hooks: false and -m gpt-6.1-sol, which hold a p but no profile: "3 hooks are new or changed." is answered`, async (t) => {
        const box = await createSandbox(t);
        const ours = await fleet(box);
        const record = [...codexTrustArgs(ours.bots, { hooks: false }).map((arg) => arg.replace(/^--extra-arg=/, '')), '-m', 'gpt-6.1-sol'];
        assert.deepEqual(record.slice(0, 2), ['-c', `projects={${JSON.stringify(ours.bots)}={trust_level="trusted"}}`], `the premise: the folder's trust comes first: ${JSON.stringify(record)}`);
        assert.ok(record.some((word) => word.includes('p')) && !record.some((word) => /profile/i.test(word)), `the premise: a p, and no profile: ${JSON.stringify(record)}`);
        await setLaunchedWith(ours, record);

        await assertCounts(box, ours, target, { refused: [1], answered: 3, what: 'a system test\'s launch words' });
      });

      test(`K7 ${name}: daily's book entry says it was launched with the plain string "-c tui.show_tooltips=false", every character safe and no hooks: "3 hooks are new or changed." is answered`, async (t) => {
        const box = await createSandbox(t);
        const ours = await fleet(box);
        await setLaunchedWith(ours, '-c tui.show_tooltips=false');

        await assertCounts(box, ours, target, { refused: [1], answered: 3, what: 'a safe string record with no hooks' });
      });

      test(`K7 ${name}: daily's book entry has no launched_with, as for a session launched before the kit wrote one: the kit cannot tell, so a review of 1, 2 or 3 is refused, saying to restart it, and nothing is typed`, async (t) => {
        const box = await createSandbox(t);
        const ours = await fleet(box);
        await setLaunchedWith(ours, undefined);

        for (const count of [3, 2, 1]) {
          await showReview(box, ours, target, count, { goes: true });
          const before = await sendsByTab(box);
          const said = await assertRefusedUntyped(box, await trust(box, ours, target), before, `no launched_with, a review of ${count}`);
          assert.match(said, /\brestart\b/, `no launched_with: the refusal says to restart the session with the kit: ${said}`);
        }
      });

      test(`K7 ${name}: bot.yaml's extra_args for daily name hooks, but only after its launch, with no restart: "3 hooks are new or changed." is answered`, async (t) => {
        const box = await createSandbox(t);
        const ours = await fleet(box);
        await setExtraArgs(box, ours, ['-c', hookStateFlag((await kitHooks(ours, target)).SessionStart)]);

        await assertCounts(box, ours, target, { refused: [1], answered: 3, what: 'hooks in bot.yaml after the launch' });
        assert.deepEqual((await sessionIn(ours.bots, 'coder', 'daily'))?.launched_with, [], 'the premise: daily was launched with no extra arguments');
      });

      test(`K7 ${name}: daily restarted with extra_args -c tui.show_tooltips=false, which do not mention hooks: "3 hooks are new or changed." is answered`, async (t) => {
        const box = await createSandbox(t);
        const ours = await fleet(box);
        await setExtraArgs(box, ours, ['-c', 'tui.show_tooltips=false']);
        await relaunchDaily(box, ours);

        await assertCounts(box, ours, target, { refused: [1], answered: 3, what: 'extra_args with no hooks in them' });
      });

      // ---------------------------------------------------------- e. the launch record itself

      test(`K8 ${name}: the book's launched_with for daily is [] after up with no extra_args, then each restart replaces it with bot.yaml's extra_args, a list or a string`, async (t) => {
        const box = await createSandbox(t);
        const ours = await fleet(box);
        const entry = () => sessionIn(ours.bots, 'coder', 'daily');
        const first = await entry();
        assert.equal(typeof first?.launched, 'string', `the premise: up set launched: ${JSON.stringify(first)}`);
        assert.deepEqual(first.launched_with, [], `after up with no extra_args: ${JSON.stringify(first)}`);

        const list = ['-c', 'tui.show_tooltips=false', '--search'];
        await setExtraArgs(box, ours, list);
        assert.deepEqual((await entry()).launched_with, [], 'bot.yaml changed but daily not launched again: the record stays');
        await relaunchDaily(box, ours);
        const second = await entry();
        assert.deepEqual(second.launched_with, list, `after a restart with a list: ${JSON.stringify(second)}`);
        assert.notEqual(second.launched, first.launched, 'the premise: the restart launched it again');

        const text = "-c 'tui.show_tooltips=false' --search";
        await setExtraArgs(box, ours, text);
        await relaunchDaily(box, ours);
        assert.deepEqual((await entry()).launched_with, text, `after a restart with a string: ${JSON.stringify(await entry())}`);
      });
    }

    if (!sessionOnly) {
      test(`K7 ${name}: scout's book entry says it was launched with ["-p","work"], a profile: the kit cannot tell, so a review of 1, 2 or 3 is refused, and nothing is typed`, async (t) => {
        const box = await createSandbox(t);
        const ours = await fleet(box);
        await setLaunchedWith(ours, ['-p', 'work'], { bot: target.bot, session: 'scout' });

        await assertRefusedAtEveryCount(box, ours, target, 'scout launched with -p work');
      });

      test(`K8 ${name}: a session given extra_args before its first launch, by session add or temp make --extra-arg, has them as launched_with in its book entry`, async (t) => {
        const box = await createSandbox(t);
        const extra = ['-c', 'tui.show_tooltips=false'];
        const ours = await fleet(box, { dailyExtra: extra, scoutExtra: async () => extra });

        assert.deepEqual((await sessionIn(ours.bots, 'coder', 'daily'))?.launched_with, extra, `coder/daily, after up: ${JSON.stringify(await sessionIn(ours.bots, 'coder', 'daily'))}`);
        assert.deepEqual((await sessionIn(ours.bots, 'writer', 'scout'))?.launched_with, extra, `writer/scout, after temp make: ${JSON.stringify(await sessionIn(ours.bots, 'writer', 'scout'))}`);
      });

      test(`K7 ${name}: scout made with --extra-arg -c hooks.state={…}: the kit cannot tell, so a review of 1, 2 or 3 is refused, saying why, and nothing is typed`, async (t) => {
        const box = await createSandbox(t);
        // writer's .codex/hooks.json is only written when scout is made, so
        // the flag names the kit's SessionStart key with a hash that is no
        // hook's: what counts is that the launch mentions hooks.
        const ours = await fleet(box, {
          scoutExtra: async (bots) => ['-c', hookStateFlag({ key: stateKey(codexHooksFileOf(bots, target.bot), 'SessionStart', 0, 0), hash: WRONG_HASH })],
        });

        await assertExtraArgsRefused(box, ours, target, 'scout made with --extra-arg -c hooks.state={…}');
      });
    }

    // ---------------------------------------------------------- d. nothing else of config.toml is printed

    test(`K6 ${name}: no output, refused or answered, holds any part of config.toml but the kit's trust keys`, async (t) => {
      const box = await createSandbox(t);
      const ours = await fleet(box);
      const k = await kitHooks(ours, target);
      await writeCodexConfig(homeCodex(box), [SECRETS, trustTablesFor([k.PostToolUse, k.Stop])].join('\n'));
      const outputs = [];
      const keep = async (result) => {
        outputs.push(`${result.stdout}${result.stderr}`);
        return result;
      };

      await showReview(box, ours, target, 3);
      let before = await sendsByTab(box);
      await assertRefusedUntyped(box, await keep(await trust(box, ours, target)), before, 'a review of 3, where 1 is not trusted yet');
      await showReview(box, ours, target, 1, { goes: true });
      before = await sendsByTab(box);
      await assertAnswered(box, await keep(await trust(box, ours, target)), before, target.tab(ours).tabId, 'a review of 1');

      assertNoSecret(outputs);
    });

    if (sessionOnly) {
      test(`K6 ${name}: a refusal because the kit cannot tell holds no part of config.toml but the kit's trust keys, nor does the answer once it can`, async (t) => {
        const box = await createSandbox(t);
        const ours = await fleet(box);
        const k = await kitHooks(ours, target);
        await writeCodexConfig(homeCodex(box), [SECRETS, `[hooks.state.${JSON.stringify(k.SessionStart.key)}]\n`, trustTablesFor([k.PostToolUse, k.Stop])].join('\n'));
        await showReview(box, ours, target, 1, { goes: true });
        const before = await sendsByTab(box);

        const said = await assertRefusedUntyped(box, await trust(box, ours, target), before, 'a header with no trusted_hash, among secrets');

        // The same file without that header: the same review is answered, and says nothing of the secrets either.
        await writeCodexConfig(homeCodex(box), [SECRETS, trustTablesFor([k.PostToolUse, k.Stop])].join('\n'));
        const after = await sendsByTab(box);
        const result = await trust(box, ours, target);
        await assertAnswered(box, result, after, target.tab(ours).tabId, 'the same file without the bare header');
        assertNoSecret([said, `${result.stdout}${result.stderr}`]);
      });

      test(`K6 ${name}: a refusal for a hook that is not the kit's holds no part of config.toml but the kit's trust keys, nor does the answer once it is gone`, async (t) => {
        const box = await createSandbox(t);
        const ours = await fleet(box);
        await writeCodexConfig(homeCodex(box), SECRETS);
        const file = codexHooksFileOf(ours.bots, target.bot);
        const parsed = JSON.parse(await readFile(file, 'utf8'));
        const hooks = { ...parsed.hooks, UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo not-the-kit-506', timeout: 5 }] }] };
        await writeFile(file, `${JSON.stringify({ ...parsed, hooks }, null, 2)}\n`);
        await showReview(box, ours, target, 4, { goes: true });
        const before = await sendsByTab(box);

        const said = await assertRefusedUntyped(box, await trust(box, ours, target), before, 'a hook of the user\'s own, among secrets');

        // The kit's hooks alone again: a review of 3 is answered, and says nothing of the secrets either.
        await writeFile(file, `${JSON.stringify(parsed, null, 2)}\n`);
        await showReview(box, ours, target, 3, { goes: true });
        const after = await sendsByTab(box);
        const result = await trust(box, ours, target);
        await assertAnswered(box, result, after, target.tab(ours).tabId, 'the kit\'s hooks alone');
        assertNoSecret([said, `${result.stdout}${result.stderr}`]);
      });
    }
  });
}

/**
 * Shell text `-c '<value>'` with each "hooks" in the single-quoted value (the
 * table's name, and hooks.json in the key) split by adjacent quotes,
 * `h''ooks`: the same word to a shell, with no "hooks" left in the text.
 */
const splitHooks = (text) => {
  assert.match(text, /^-c '[^']*'$/, 'the premise: one single-quoted word after -c');
  return text.replaceAll('hooks', "h''ooks");
};

const readYaml = async (file) => YAML.parse(await readFile(file, 'utf8'));

/**
 * Give coder/daily `extra` as its extra_args: a list through `obk session
 * change`, a plain string written into bot.yaml by hand, as a user may.
 */
async function setExtraArgs(box, ours, extra) {
  if (Array.isArray(extra)) {
    const result = await box.run(['session', 'change', '--bots', 'bots', '--bot', 'coder', '--session', 'daily', ...extra.map((arg) => `--extra-arg=${arg}`)], { env: withoutCodexHome(box.env) });
    assert.equal(result.code, 0, `obk session change: ${result.stdout}${result.stderr}`);
  } else {
    const file = path.join(botHomeOf(ours.bots, 'coder'), 'bot.yaml');
    const book = await readYaml(file);
    const daily = book.sessions.find((one) => one.name === 'daily');
    assert.ok(daily, `the premise: coder's bot.yaml holds daily: ${JSON.stringify(book)}`);
    daily.extra_args = extra;
    await writeFile(file, YAML.stringify(book));
  }
  const daily = (await readYaml(path.join(botHomeOf(ours.bots, 'coder'), 'bot.yaml'))).sessions.find((one) => one.name === 'daily');
  assert.deepEqual(daily.extra_args, extra, `the premise: daily's extra_args are as set: ${JSON.stringify(daily)}`);
}

/**
 * coder/daily launched again by `obk restart`, and `ours.daily` its new tab.
 * Restart closes only a tab whose conversation the book names, so daily is
 * first given one, as a session that has had a turn has it.
 */
async function relaunchDaily(box, ours) {
  if ((await sessionIn(ours.bots, 'coder', 'daily'))?.session === undefined) {
    await recordSession(box, { bots: ours.bots, bot: 'coder', tab: ours.daily.tabId, session: 'sess-daily' });
    await conversationOnRecord(box, { harness: 'codex', cwd: botHomeOf(ours.bots, 'coder'), id: 'sess-daily' });
  }
  const result = await box.run(['restart', '--bots', 'bots', '--bot', 'coder', '--session', 'daily'], { env: withoutCodexHome(box.env) });
  assert.equal(result.code, 0, `obk restart: ${result.stdout}${result.stderr}`);
  ours.daily = await tabOf(box, ours.bots, 'coder', 'daily');
}

/** Write a session's `launched_with` (coder/daily's unless named) in its book entry, or take it out when `value` is undefined. */
async function setLaunchedWith(ours, value, { bot = 'coder', session = 'daily' } = {}) {
  const file = path.join(botHomeOf(ours.bots, bot), 'sessions.yaml');
  const book = await readYaml(file);
  assert.ok(book?.sessions?.[session], `the premise: the book holds ${session}: ${JSON.stringify(book)}`);
  if (value === undefined) delete book.sessions[session].launched_with;
  else book.sessions[session].launched_with = value;
  await writeFile(file, YAML.stringify(book));
  assert.deepEqual((await sessionIn(ours.bots, bot, session))?.launched_with, value, 'the premise: the book entry is as written');
}

/** Reviews of 3, 2 and 1 are each refused, with nothing typed. */
async function assertRefusedAtEveryCount(box, ours, target, what) {
  for (const count of [3, 2, 1]) {
    await showReview(box, ours, target, count, { goes: true });
    const before = await sendsByTab(box);
    await assertRefusedUntyped(box, await trust(box, ours, target), before, `${what}, a review of ${count}`);
  }
}

/** Reviews of 3, 2 and 1 are each refused, naming the session's extra arguments as why, with nothing typed. */
async function assertExtraArgsRefused(box, ours, target, what) {
  for (const count of [3, 2, 1]) {
    await showReview(box, ours, target, count, { goes: true });
    const before = await sendsByTab(box);
    const said = await assertRefusedUntyped(box, await trust(box, ours, target), before, `${what}, a review of ${count}`);
    assert.match(said, /extra[ _-]?arg/i, `${what}: the refusal says it is the session's extra arguments: ${said}`);
  }
}

/** The hooks with `event`'s first command run by `to` where it ran `from`. */
function withProgram(hooks, event, from, to) {
  const [group, ...rest] = hooks[event];
  const [hook, ...others] = group.hooks;
  assert.ok(hook.command.startsWith(`${from} `), `the premise: ${event}'s command starts with ${from}: ${hook.command}`);
  return { ...hooks, [event]: [{ ...group, hooks: [{ ...hook, command: `${to}${hook.command.slice(from.length)}` }, ...others] }, ...rest] };
}

/** Lines of config.toml that are the user's, and secret: none of their text may be printed. */
const SECRETS = [
  'model = "gpt-6-luna"',
  'api_key = "sk-SECRET-506"',
  '',
  '[model_providers.x]',
  'name = "secret provider 506"',
  'base_url = "https://secret-506.example/v1"',
  'env_key = "SECRET_506_KEY"',
  '',
].join('\n');

/** Each output holds none of SECRETS' words. */
function assertNoSecret(outputs) {
  for (const said of outputs) {
    for (const secret of ['SECRET-506', 'secret-506', 'SECRET_506', 'secret provider 506', 'model_providers', 'gpt-6-luna']) {
      assert.ok(!said.includes(secret), `the output holds ${JSON.stringify(secret)} from config.toml, which is the user's: ${said}`);
    }
  }
}
