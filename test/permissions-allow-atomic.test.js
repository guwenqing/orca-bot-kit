// `permission allow` changes nothing when it cannot finish (#383; moved out
// of `bot change --allow` by #527).
//
// `obk permission allow --bots <B> --bot <X> --rule <rule>`
// records the rule in bot.yaml `allow` and writes it at once into the files of
// the harnesses the bot runs on: `.claude/settings.json` for Claude,
// `.codex/rules/obk.rules` for Codex, both for a bot on both. It checks
// everything it will write before it writes anything, as `--disallow` does
// since #360. What is pinned, for a Claude bot, a Codex bot and a bot on both:
//
// - refused (not 0, a message rather than a crash, naming the file or folder
//   that stopped it), with the bots folder unchanged byte for byte: bot.yaml
//   above all, the other harness's file too, and the charter and AGENTS.md.
//   The ways it can fail, each at a file it would
//   write:
//   - the Claude settings file: not JSON, `permissions` not a mapping,
//     `permissions.allow` not a list, a file the kit cannot write, a folder it
//     cannot make the file in (one it cannot write, one it cannot enter, or a
//     file where the folder should be), a link outside the bot folder;
//   - the Codex obk.rules: a file the kit cannot write, a folder it cannot
//     make the file in (the same three), a link outside the bot folder
//     (`.codex`, `.codex/rules`, or the file itself), where nothing is written
//     either;
//   - bot.yaml: a file the kit cannot write, or an `allow` edit that cannot be
//     made (an anchor another key uses);
// - it can be run again: once the user has fixed the file, the same command
//   goes through, and bot.yaml `allow` and the harness files agree.
//
// Plain text is read only for file paths; the sentences around them are the
// implementer's. Repairing a broken file is not the kit's, so the fix is the
// test's, done by hand as the user would.
//
// Since #527 the bot's `allow` and harness files hold the kit's default set
// from the start, so the rules here are ones outside it, and the sets are
// compared in any order (helpers/permissions.js).
//
// Not covered here: the refusals `permission allow` already made before it wrote
// anything (a broad rule, no Codex form, an empty rule, a bad `allow` list);
// they live in permissions-allow, -broad and -codex.

import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse, parseDocument } from 'yaml';

import {
  botHomeOf,
  createSandbox,
  skipGit,
  snapshot,
} from './helpers/cli.js';
import {
  allowedIn,
  allowOf,
  assertSameRules,
  codexAllowedIn,
  codexDefaultLines,
  codexRulesOf,
  defaultRules,
  namesFile,
  OWN_RULE,
  permissionAllow,
  settingsOf,
} from './helpers/permissions.js';
import { botYamlOf } from './helpers/skills.js';

const BOT = 'api-bot';
const CHARTER = 'Api Bot owns the API. It merges pull requests and closes issues without asking.';

/** The rule the bot was allowed before the test, through the kit: one outside the kit's default set. */
const ADD_RULE = 'Bash(gh issue close:*)';

/** The lines ADD_RULE and OWN_RULE (`Bash(gh pr merge:*)`) become in obk.rules, worked out by hand. */
const ADD_LINE = 'prefix_rule(pattern=["gh", "issue", "close"], decision="allow")';
const OWN_LINE = 'prefix_rule(pattern=["gh", "pr", "merge"], decision="allow")';

/** The bots a failure is tried on: the harness and the sessions (`[name, ...settings]` each). */
const ON = {
  'a Claude bot': { harness: 'claude', sessions: [['daily']], claude: true, codex: false },
  'a Codex bot': { harness: 'codex', sessions: [['daily']], claude: false, codex: true },
  'a bot on both harnesses': { harness: 'codex', sessions: [['daily'], ['review', '--harness', 'claude']], claude: true, codex: true },
};

/** Root writes a file whatever its mode, so there would be nothing to refuse. */
const NEEDS_A_USER = process.getuid?.() === 0
  && 'runs as root, which writes a file whatever its mode, so no file can be made unwritable';

/**
 * A bots folder `init` made on Claude, with one more bot as `on` says, brought
 * up, and ADD_RULE allowed through the kit, so its harness files hold it, and
 * the kit's defaults, as the kit writes them.
 */
async function withBot(box, on) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', on.harness, '--charter', CHARTER]);
  assert.equal(made.code, 0, made.stderr);
  for (const [session, ...settings] of on.sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', session, ...settings]);
    assert.equal(added.code, 0, added.stderr);
  }
  const up = await box.run(['up', '--bots', 'bots', '--bot', BOT]);
  assert.equal(up.code, 0, up.stderr);
  const bots = box.path('bots');
  const allow = await permissionAllow(box, BOT, [ADD_RULE]);
  assert.equal(allow.code, 0, `the premise: ${ADD_RULE} allowed through the kit\n${allow.stdout}${allow.stderr}`);
  if (on.claude) assertSameRules(await allowedIn(bots, BOT), [...defaultRules(box, bots), ADD_RULE], `the premise: ${settingsOf(bots, BOT)} holds it and the defaults`);
  if (on.codex) assertSameRules(await codexAllowedIn(bots, BOT), [...codexDefaultLines(box, bots), ADD_LINE], `the premise: ${codexRulesOf(bots, BOT)} holds it and the defaults`);
  return bots;
}

/** Move `at` aside and put a link to `target` in its place; what comes back puts it back. */
async function linkInstead(box, at, target) {
  const kept = path.join(box.root, 'kept', path.basename(at));
  await mkdir(path.dirname(kept), { recursive: true });
  await rename(at, kept);
  await symlink(target, at);
  return async () => {
    await rm(at);
    await rename(kept, at);
  };
}

/** What sets `at` to `mode` when called, and answers what gives it back the mode it had. */
const locking = (at, mode) => async () => {
  const back = (await stat(at)).mode & 0o7777;
  await chmod(at, mode);
  return () => chmod(at, back);
};

/** Move the folder `at` aside and put a file of the user's, of `mode`, in its place; what comes back puts it back. */
async function fileInstead(box, at, mode = 0o644) {
  const kept = path.join(box.root, 'kept', path.basename(at));
  await mkdir(path.dirname(kept), { recursive: true });
  await rename(at, kept);
  await writeFile(at, 'a note of my own\n');
  await chmod(at, mode);
  return async () => {
    await rm(at);
    await rename(kept, at);
  };
}

/** A settings file the user wrote, of a shape the kit cannot put a rule in. */
const BROKEN_SETTINGS = [
  ['not valid JSON', `{ "permissions": { "allow": [${JSON.stringify(ADD_RULE)}] `],
  ['a permissions that is a list', `${JSON.stringify({ permissions: [ADD_RULE] }, null, 2)}\n`],
  ['a permissions that is a line of text', `${JSON.stringify({ permissions: ADD_RULE }, null, 2)}\n`],
  ['a permissions.allow that is a line of text', `${JSON.stringify({ permissions: { allow: ADD_RULE } }, null, 2)}\n`],
  ['a permissions.allow that is a mapping', `${JSON.stringify({ permissions: { allow: { rule: ADD_RULE } } }, null, 2)}\n`],
];

/**
 * Each way `--allow` can fail at a file it would write: which bots it is tried
 * on, and `spoil(box, bots)`, which spoils the file and answers `{ named,
 * fix, lock, outside }`: what the refusal names, how the user puts it right
 * by hand, a mode to set once the bots folder is snapshotted (a folder that
 * cannot be entered cannot be read) and to give back as soon as the run is
 * over (a snapshot reads bytes and not modes, and a locked folder would outlive
 * the sandbox), and a folder outside the bots folder that must be left as it
 * was.
 */
const FAILURES = [
  ...BROKEN_SETTINGS.map(([label, text]) => ({
    label: `a Claude settings file with ${label}`,
    on: ['a Claude bot', 'a bot on both harnesses'],
    async spoil(box, bots) {
      const file = settingsOf(bots, BOT);
      const was = await readFile(file);
      await writeFile(file, text);
      return { named: file, fix: () => writeFile(file, was) };
    },
  })),
  {
    label: 'a Claude settings file the kit cannot write',
    on: ['a Claude bot', 'a bot on both harnesses'],
    skip: NEEDS_A_USER,
    async spoil(box, bots) {
      const file = settingsOf(bots, BOT);
      return { named: file, lock: locking(file, 0o444) };
    },
  },
  {
    label: 'no Claude settings file, in a .claude folder the kit cannot write',
    on: ['a Claude bot', 'a bot on both harnesses'],
    skip: NEEDS_A_USER,
    async spoil(box, bots) {
      const file = settingsOf(bots, BOT);
      await rm(file);
      return { named: path.dirname(file), lock: locking(path.dirname(file), 0o555) };
    },
  },
  {
    label: 'no Claude settings file, in a .claude folder the kit cannot enter',
    on: ['a Claude bot', 'a bot on both harnesses'],
    skip: NEEDS_A_USER,
    async spoil(box, bots) {
      const file = settingsOf(bots, BOT);
      await rm(file);
      return { named: path.dirname(file), lock: locking(path.dirname(file), 0o666) };
    },
  },
  {
    label: 'a .claude that is a file of the user\'s, not a folder',
    on: ['a Claude bot', 'a bot on both harnesses'],
    async spoil(box, bots) {
      const folder = path.dirname(settingsOf(bots, BOT));
      return { named: folder, fix: await fileInstead(box, folder) };
    },
  },
  {
    label: 'a Claude settings file that links outside the bot folder',
    on: ['a Claude bot', 'a bot on both harnesses'],
    async spoil(box, bots) {
      const file = settingsOf(bots, BOT);
      // The user's own settings, outside every bot.
      const target = path.join(box.home, '.claude', 'settings.json');
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, `${JSON.stringify({ permissions: { allow: ['Bash(git status)'] }, theme: 'dark' }, null, 2)}\n`);
      return { named: file, fix: await linkInstead(box, file, target), outside: path.dirname(target) };
    },
  },
  {
    label: 'an obk.rules the kit cannot write',
    on: ['a Codex bot', 'a bot on both harnesses'],
    skip: NEEDS_A_USER,
    async spoil(box, bots) {
      const file = codexRulesOf(bots, BOT);
      return { named: file, lock: locking(file, 0o444) };
    },
  },
  {
    label: 'no obk.rules, in a .codex/rules folder the kit cannot write',
    on: ['a Codex bot', 'a bot on both harnesses'],
    skip: NEEDS_A_USER,
    async spoil(box, bots) {
      const file = codexRulesOf(bots, BOT);
      await rm(file);
      return { named: path.dirname(file), lock: locking(path.dirname(file), 0o555) };
    },
  },
  {
    label: 'no obk.rules, in a .codex/rules folder the kit cannot enter',
    on: ['a Codex bot', 'a bot on both harnesses'],
    skip: NEEDS_A_USER,
    async spoil(box, bots) {
      const file = codexRulesOf(bots, BOT);
      await rm(file);
      return { named: path.dirname(file), lock: locking(path.dirname(file), 0o666) };
    },
  },
  {
    label: 'a .codex/rules that is a file of the user\'s, not a folder',
    on: ['a Codex bot', 'a bot on both harnesses'],
    async spoil(box, bots) {
      const folder = path.dirname(codexRulesOf(bots, BOT));
      return { named: folder, fix: await fileInstead(box, folder) };
    },
  },
  {
    // A file the kit may write and whose execute bit reads like a folder's
    // search bit: only a check that it is a folder stops it.
    label: 'a .codex/rules that is an executable file of the user\'s, not a folder',
    on: ['a bot on both harnesses', 'a Codex bot'],
    async spoil(box, bots) {
      const folder = path.dirname(codexRulesOf(bots, BOT));
      return { named: folder, fix: await fileInstead(box, folder, 0o755) };
    },
  },
  ...['.codex', path.join('.codex', 'rules'), path.join('.codex', 'rules', 'obk.rules')].map((linked) => ({
    label: `a ${linked} that links outside the bot folder`,
    on: ['a Codex bot', 'a bot on both harnesses'],
    async spoil(box, bots) {
      const at = path.join(botHomeOf(bots, BOT), linked);
      // Somewhere of the user's own outside every bot, shaped like what the link stands for.
      const elsewhere = path.join(box.root, 'elsewhere');
      const target = path.join(elsewhere, linked);
      const own = linked.endsWith('obk.rules') ? target : path.join(target, ...(linked === '.codex' ? ['rules'] : []), 'default.rules');
      await mkdir(path.dirname(own), { recursive: true });
      await writeFile(own, 'prefix_rule(pattern=["ls"], decision="allow")\n');
      return { named: at, fix: await linkInstead(box, at, target), outside: elsewhere };
    },
  })),
  {
    label: 'a bot.yaml the kit cannot write',
    on: ['a Claude bot', 'a Codex bot', 'a bot on both harnesses'],
    skip: NEEDS_A_USER,
    async spoil(box, bots) {
      const file = botYamlOf(bots, BOT);
      return { named: file, lock: locking(file, 0o444) };
    },
  },
  {
    label: 'a bot.yaml whose allow carries an anchor another key uses',
    on: ['a Claude bot', 'a Codex bot'],
    async spoil(box, bots) {
      // A valid bot.yaml, edited by hand: allow is anchored and a key of the user's own is an alias of it.
      const file = botYamlOf(bots, BOT);
      const was = await readFile(file);
      const doc = parseDocument(String(was));
      const allowNode = doc.get('allow', true);
      allowNode.anchor = 'grants';
      doc.set('notes', doc.createAlias(allowNode, 'grants'));
      await writeFile(file, String(doc));
      const text = await readFile(file, 'utf8');
      assert.ok(text.includes('&grants') && text.includes('*grants'), `the premise: an anchor and its alias, got:\n${text}`);
      assert.deepEqual(parse(text).notes, parse(text).allow, 'the premise: the file is valid and the alias reads as allow');
      return { named: file, fix: () => writeFile(file, was) };
    },
  },
];

for (const { label, on: where, skip, spoil } of FAILURES) {
  for (const name of where) {
    test(`N1 ${name}, ${label}: permission allow is refused naming it, and nothing changes; fixed, the same command goes through`, { skip }, async (t) => {
      const on = ON[name];
      const box = await createSandbox(t);
      const bots = await withBot(box, on);
      const kept = await allowOf(bots, BOT);
      const { named, fix, lock, outside } = await spoil(box, bots);
      const before = await snapshot(bots, skipGit);
      const theirs = outside === undefined ? undefined : await snapshot(outside);
      const unlock = await lock?.();

      const result = await permissionAllow(box, BOT, [OWN_RULE]).finally(() => unlock?.());

      const said = `${result.stdout}${result.stderr}`;
      assert.notEqual(result.code, 0, `this should have been refused, got:\n${said}`);
      assert.ok(!/^\s+at /m.test(said), `expected a message, got a crash:\n${said}`);
      assert.ok(namesFile(said, box, named), `the refusal should name ${named}, got:\n${said}`);
      const yaml = parse(await readFile(botYamlOf(bots, BOT), 'utf8'));
      assert.deepEqual(yaml.allow, kept, `bot.yaml records no yes the harness files did not get:\n${JSON.stringify(yaml, null, 2)}`);
      assert.equal(yaml.charter.trim(), CHARTER, 'the charter is the one it had');
      const now = await snapshot(bots, skipGit);
      const changed = Object.keys({ ...before, ...now }).filter((rel) => before[rel] !== now[rel]);
      assert.deepEqual(changed, [], 'a refusal changes nothing in the bots folder');
      if (theirs !== undefined) assert.deepEqual(await snapshot(outside), theirs, 'nothing was written where the link leads');

      await fix?.();
      const retry = await permissionAllow(box, BOT, [OWN_RULE]);

      assert.equal(retry.code, 0, `with the file fixed, the same command should go through, got:\n${retry.stdout}${retry.stderr}`);
      assert.deepEqual(await allowOf(bots, BOT), [...kept, OWN_RULE]);
      assert.equal(parse(await readFile(botYamlOf(bots, BOT), 'utf8')).charter.trim(), CHARTER);
      if (on.claude) assertSameRules(await allowedIn(bots, BOT), [...defaultRules(box, bots), ADD_RULE, OWN_RULE], `${settingsOf(bots, BOT)} agrees with bot.yaml`);
      if (on.codex) assertSameRules(await codexAllowedIn(bots, BOT), [...codexDefaultLines(box, bots), ADD_LINE, OWN_LINE], `${codexRulesOf(bots, BOT)} agrees with bot.yaml`);
    });
  }
}
