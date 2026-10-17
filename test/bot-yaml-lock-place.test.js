// Where a kit command that changes bot.yaml keeps what it needs to keep the
// change safe (#595), and one more pair of commands at the same time.
//
// The requirement of #595: a kit command that reports success has made its
// change, and a change another command made at the same time is not lost.
// test/bot-yaml-lost-change.test.js holds that for ten pairs on a bot that is
// already there. This file holds two more things:
//
// LP1, LP2  `bot create` of a new bot beside `session add --name daily` of the
//           same bot. When a command exits 0, its change is in bot.yaml at the
//           end: for bot create, every one of the kit's default permission
//           rules in `allow` (the set test/permissions-defaults.test.js D1
//           holds bot create to, spelled in helpers/permissions.js); for
//           session add, the session daily. One of the two has to succeed.
//
//           LP1 forces the order with helpers/read-gate.js, as
//           bot-yaml-lost-change.test.js does: bot create is stopped after
//           each of its reads of the new bot.yaml in turn. In that gap
//           session add is run, and it is let run to the end (its read 0), or
//           it is stopped after one of its own reads of bot.yaml. When it is
//           stopped, bot create is let go first, so the rest of bot create
//           runs in session add's gap, between session add's read and its
//           write. Session add cannot read bot.yaml before bot create has
//           written it, so this is the only way to give session add a gap
//           with bot create in it.
//
//           LP2 holds the same claim with no gate: the two commands are
//           started at the same time, session add tried again until the new
//           bot is there to add a session to, six times over. It covers the
//           orders no read can stop: a bot create that writes bot.yaml twice
//           with no read between, or one that reads it no time at all, which
//           would leave LP1 with nothing to stop at. LP2 counts a try only
//           when the session add that exited 0 was started while bot create
//           was still running, and needs one such try at least, so it never
//           passes on two commands that ran one after the other.
//
// LP3       A kit command that changes an existing bot's bot.yaml leaves the
//           bots repo's `git status --porcelain` as it was, but for the files
//           it was asked to change: bot.yaml, and for `permission allow` also
//           the bot's Claude settings file, where the kit writes the rule for
//           the harness (permissions-defaults.test.js). What the kit keeps for
//           itself, beyond the command, must not show as a new or changed
//           file in the user's repo. Asked of git itself, never of an ignore
//           file's text.
//
// Every run is in the sandbox (helpers/cli.js): its own HOME, a fake Orca, and
// fake harnesses on its own PATH.

import assert from 'node:assert/strict';
import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';

import { botHomeOf, createSandbox, git, repoRoot } from './helpers/cli.js';
import { defaultRules, settingsOf, withoutSendMessage } from './helpers/permissions.js';
import { commitIn } from './helpers/sources.js';

const BOT = 'api-bot';
const GATE_ENTRY = path.join(repoRoot, 'test', 'helpers', 'read-gate.js');

/** How long one command may run while the other is stopped, before the stop is let go anyway. */
const GAP_MS = 1_500;

/** How many times LP2 starts the two commands at once. */
const RACES = 6;

/** How many times LP2 tries session add in one race before it gives up. */
const ADD_TRIES = 60;

const CREATE = ['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude'];
const ADD_DAILY = ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily'];

const botYamlOf = (bots) => path.join(botHomeOf(bots, BOT), 'bot.yaml');
const isThere = (file) => access(file).then(() => true, () => false);
const said = (result) => `${result.stdout}${result.stderr}`.trim();

/** bot.yaml of the bot as it is now, parsed, or undefined when there is none. */
async function botYaml(bots) {
  try {
    return parse(await readFile(botYamlOf(bots), 'utf8')) ?? {};
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/** The kit's default rules that bot.yaml's allow does not hold. */
const missingDefaults = (box, bots, doc) => {
  const allow = Array.isArray(doc?.allow) ? doc.allow : [];
  return withoutSendMessage(defaultRules(box, bots)).filter((rule) => !allow.includes(rule));
};

const hasDaily = (doc) => Array.isArray(doc?.sessions) && doc.sessions.some((one) => one?.name === 'daily');

/** What the sandbox holds that a command may change: put back before each try. */
const PARTS = ['cwd', 'home', 'orca-fake'];

/**
 * A bots folder `init` made, with no bot api-bot yet, in a sandbox of its own.
 * Answers the bots folder and `fresh`, which puts the sandbox back as it was
 * now.
 */
async function beforeTheBot(t) {
  const box = await createSandbox(t);
  const made = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(made.code, 0, `the setup: obk init\n${said(made)}`);

  const seed = path.join(box.root, 'seed');
  const copy = (from, to) => cp(from, to, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
  for (const part of PARTS) await copy(path.join(box.root, part), path.join(seed, part));
  const fresh = async () => {
    for (const part of PARTS) {
      await rm(path.join(box.root, part), { recursive: true, force: true });
      await copy(path.join(seed, part), path.join(box.root, part));
    }
  };
  return { box, bots: box.path('bots'), fresh };
}

/** The environment that loads the read gate on the new bot.yaml, stopping after read `at` (0: none). */
function gated(box, bots, { at, log, gate }) {
  return {
    ...box.env,
    NODE_OPTIONS: [box.env.NODE_OPTIONS, `--import=${pathToFileURL(GATE_ENTRY).href}`].filter(Boolean).join(' '),
    OBK_TEST_READ_GATE_FILE: botYamlOf(bots),
    OBK_TEST_READ_GATE_LOG: log,
    OBK_TEST_READ_GATE_AT: String(at),
    OBK_TEST_READ_GATE_OPEN: gate,
  };
}

/** How many reads a gate log holds. */
const readsIn = async (log) => (await readFile(log, 'utf8')).split('\n').filter(Boolean).length;

/** Run `obk <args>`, with `ended` set once it has. */
function started(box, args, env) {
  const run = { ended: false };
  run.result = box.run(args, { env }).then((result) => { run.ended = true; return result; });
  return run;
}

/**
 * Wait until a gated command has reached its stop ('reached'), has ended
 * ('ended'), or `ms` have gone by ('running'). With no `ms`, no time limit.
 */
async function stopOrEnd(gate, run, ms) {
  const until = ms === undefined ? Infinity : Date.now() + ms;
  for (;;) {
    if (await isThere(`${gate}.reached`)) return 'reached';
    if (run.ended) return 'ended';
    if (Date.now() >= until) return 'running';
    await delay(10);
  }
}

/**
 * The premise of LP1: bot create alone makes the bot with every default rule,
 * and session add alone then adds daily and keeps them. Answers how many times
 * each read bot.yaml. Leaves the sandbox as it was.
 */
async function alone({ box, bots, fresh }) {
  await fresh();
  const logs = path.join(box.root, 'alone');
  await mkdir(logs, { recursive: true });
  const createLog = path.join(logs, 'create.log');
  const addLog = path.join(logs, 'add.log');
  await writeFile(createLog, '');
  await writeFile(addLog, '');
  const noGate = path.join(logs, 'no-gate');

  assert.equal(await botYaml(bots), undefined, 'the premise: there is no bot api-bot before bot create');
  const created = await box.run(CREATE, { env: gated(box, bots, { at: 0, log: createLog, gate: noGate }) });
  assert.equal(created.code, 0, `the premise: bot create alone exits 0, got:\n${said(created)}`);
  assert.deepEqual(missingDefaults(box, bots, await botYaml(bots)), [], 'the premise: alone, bot create writes every default rule into allow');
  assert.ok(!hasDaily(await botYaml(bots)), 'the premise: bot create alone gives the bot no session daily');

  const added = await box.run(ADD_DAILY, { env: gated(box, bots, { at: 0, log: addLog, gate: noGate }) });
  assert.equal(added.code, 0, `the premise: session add after bot create exits 0, got:\n${said(added)}`);
  const doc = await botYaml(bots);
  assert.ok(hasDaily(doc), 'the premise: session add alone adds daily');
  assert.deepEqual(missingDefaults(box, bots, doc), [], 'the premise: session add alone keeps the default rules');

  const reads = { create: await readsIn(createLog), add: await readsIn(addLog) };
  assert.ok(reads.add >= 1, `the premise: the gate sees session add read bot.yaml, got ${reads.add} reads`);
  await fresh();
  return reads;
}

/**
 * The claim of LP1 and LP2 on one try: one of the two succeeded, and each that
 * exited 0 has its change in bot.yaml.
 */
function assertBothKept(box, bots, told, { create, add, doc }) {
  const exits = `bot create exit ${create.code}${create.code === 0 ? '' : `, saying: ${said(create)}`}; `
    + `session add exit ${add.code}${add.code === 0 ? '' : `, saying: ${said(add)}`}`;
  assert.ok(create.code === 0 || add.code === 0, `${told}: ${exits}. Neither command succeeded.`);
  if (create.code === 0) {
    const missing = missingDefaults(box, bots, doc);
    assert.deepEqual(
      missing,
      [],
      `${told}: ${exits}. bot create exited 0, and ${missing.length} of its default rules are not in allow. `
      + `bot.yaml allow: ${JSON.stringify(doc?.allow)}`,
    );
  }
  if (add.code === 0) {
    assert.ok(
      hasDaily(doc),
      `${told}: ${exits}. session add exited 0, and bot.yaml has no session daily. `
      + `bot.yaml sessions: ${JSON.stringify(doc?.sessions)}`,
    );
  }
}

test('#595 LP1 bot create stopped after each of its reads of the new bot.yaml, session add of daily run or stopped in that gap: a command that exits 0 keeps its change', async (t) => {
  const space = await beforeTheBot(t);
  const { box, bots, fresh } = space;
  const reads = await alone(space);
  if (reads.create === 0) {
    // Nothing of bot create to stop at: LP2 holds the claim on its own.
    t.diagnostic('bot create reads the new bot.yaml no time; LP2 holds this pair');
    return;
  }

  let forced = 0;
  for (let at = 1; at <= reads.create; at += 1) {
    for (let addAt = 0; addAt <= reads.add; addAt += 1) {
      await fresh();
      const gates = path.join(box.root, 'gates');
      await mkdir(gates, { recursive: true });
      const createGate = path.join(gates, `create-${at}-${addAt}`);
      const addGate = path.join(gates, `add-${at}-${addAt}`);

      const create = started(box, CREATE, gated(box, bots, { at, log: `${createGate}.log`, gate: createGate }));
      const createStop = await stopOrEnd(createGate, create);
      let add;
      let addStop = 'not started in the gap';
      if (createStop === 'reached') {
        forced += 1;
        add = started(box, ADD_DAILY, gated(box, bots, { at: addAt, log: `${addGate}.log`, gate: addGate }));
        addStop = await stopOrEnd(addGate, add, GAP_MS);
      }
      // Let bot create go on: into session add's gap when session add is stopped there.
      await writeFile(createGate, '');
      let createAfter = '';
      if (add !== undefined) {
        await Promise.race([create.result, delay(GAP_MS)]);
        createAfter = create.ended ? ', and bot create ended while session add was held' : `, and bot create still running after ${GAP_MS} ms`;
      }
      await writeFile(addGate, '');
      const createResult = await create.result;
      if (add === undefined) add = started(box, ADD_DAILY, box.env);
      const addResult = await add.result;

      const told = createStop !== 'reached'
        ? `bot create ended before its read ${at} of ${reads.create}, so session add ran after it`
        : `bot create stopped after its read ${at} of ${reads.create} of bot.yaml; session add in the gap, `
          + (addAt === 0 ? 'let run' : `to stop after its read ${addAt} of ${reads.add}`)
          + `: it ${addStop === 'reached' ? 'stopped there' : addStop === 'ended' ? 'ended' : `was still running after ${GAP_MS} ms`}`
          + createAfter;
      assertBothKept(box, bots, told, { create: createResult, add: addResult, doc: await botYaml(bots) });
    }
  }
  assert.ok(forced > 0, 'the gate stopped bot create at none of its reads, so no order was forced and this proves nothing');
});

test('#595 LP2 bot create and session add of daily started at the same time, six times: a command that exits 0 keeps its change', async (t) => {
  const space = await beforeTheBot(t);
  const { box, bots, fresh } = space;

  let overlapped = 0;
  const seen = [];
  for (let race = 1; race <= RACES; race += 1) {
    await fresh();
    const create = started(box, CREATE, box.env);
    let add;
    let addStartedWhileCreateRan = false;
    for (let tries = 0; tries < ADD_TRIES; tries += 1) {
      const createWasRunning = !create.ended;
      add = await box.run(ADD_DAILY);
      addStartedWhileCreateRan = createWasRunning;
      // Before bot create has written bot.yaml, session add finds no bot and
      // fails: try again. Once bot create has ended, one more try is the last.
      if (add.code === 0 || !createWasRunning) break;
    }
    const createResult = await create.result;
    const doc = await botYaml(bots);
    const one = addStartedWhileCreateRan && add.code === 0;
    if (one) overlapped += 1;
    seen.push(`race ${race}: bot create exit ${createResult.code}, session add exit ${add.code}, `
      + `${addStartedWhileCreateRan ? 'started while bot create ran' : 'started after bot create ended'}`);
    assertBothKept(box, bots, `race ${race} of ${RACES}, the two started at the same time`, { create: createResult, add, doc });
  }
  assert.ok(
    overlapped > 0,
    `in no race did a session add that exited 0 start while bot create was still running, so the two never ran at the same time and this proves nothing:\n${seen.join('\n')}`,
  );
});

// ------------------------------------------------- the bots repo

const RULE = 'Bash(npm test)';
const SKILL = 'kit:obk-debugging';

/** api-bot made by bot create and given the session daily, all of it committed. */
async function botWithSession(t) {
  const box = await createSandbox(t);
  const ran = async (args) => {
    const result = await box.run(args);
    assert.equal(result.code, 0, `the setup: obk ${args.join(' ')}\n${said(result)}`);
  };
  await ran(['init', '--bots', 'bots', '--harness', 'claude']);
  await ran(CREATE);
  await ran(ADD_DAILY);
  const bots = box.path('bots');
  await commitIn(bots, 'my bots');
  return { box, bots };
}

/** The bots repo's path of a file in it, as git status names it. */
const inRepo = (bots, file) => path.relative(bots, file).split(path.sep).join('/');

/**
 * The commands, each a change to api-bot's bot.yaml, and the files of the repo
 * it is asked to change.
 */
const EDITS = [
  {
    label: 'session add of ops',
    args: ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'ops'],
    files: (bots) => [botYamlOf(bots)],
  },
  {
    label: `permission allow --rule ${RULE}`,
    args: ['permission', 'allow', '--bots', 'bots', '--bot', BOT, '--rule', RULE],
    // The rule goes into the harness's own settings too: the user's file, not the kit's state.
    files: (bots) => [botYamlOf(bots), settingsOf(bots, BOT)],
  },
  {
    label: `skills add --skill ${SKILL}`,
    args: ['skills', 'add', '--bots', 'bots', '--bot', BOT, '--skill', SKILL],
    files: (bots) => [botYamlOf(bots)],
  },
  {
    label: 'session change of daily',
    args: ['session', 'change', '--bots', 'bots', '--bot', BOT, '--session', 'daily', '--model', 'opus'],
    files: (bots) => [botYamlOf(bots)],
  },
];

/** What the bots repo would offer to commit, one line per file, untracked files each on their own. */
async function waiting(bots) {
  const status = await git(['status', '--porcelain', '--untracked-files=all'], bots);
  assert.equal(status.code, 0, status.stderr);
  return status.stdout.split('\n').filter(Boolean);
}

for (const edit of EDITS) {
  test(`#595 LP3 ${edit.label} leaves git status of the bots repo as it was, but for the files it changes`, async (t) => {
    const { box, bots } = await botWithSession(t);
    assert.deepEqual(await waiting(bots), [], 'the premise: the bots repo has nothing to commit before the command');

    const result = await box.run(edit.args);

    assert.equal(result.code, 0, `the premise: obk ${edit.args.join(' ')} exits 0, got:\n${said(result)}`);
    const lines = await waiting(bots);
    const asked = edit.files(bots).map((file) => inRepo(bots, file));
    assert.ok(
      lines.some((line) => line.slice(3) === inRepo(bots, botYamlOf(bots))),
      `the premise: the command changed bot.yaml, and git status says:\n${lines.join('\n')}`,
    );
    const others = lines.filter((line) => !asked.includes(line.slice(3)));
    assert.deepEqual(
      others,
      [],
      `obk ${edit.args.slice(0, 2).join(' ')} changed or left in the bots repo more than ${asked.join(' and ')}; git status says:\n${lines.join('\n')}`,
    );
  });
}
