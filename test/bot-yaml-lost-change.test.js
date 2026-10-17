// Two kit commands that change the same bot.yaml at the same time both keep
// their change (#595).
//
// Each command that changes a bot reads its bot.yaml, changes its own part and
// writes the file back. Two such commands at once can each read the same text,
// and the second write then drops the first command's change, while both report
// success. What is held here is the intent of the issue: a command that exits 0
// has made its change, and a change another command made at the same time is
// still in bot.yaml afterwards. A command that waits for the other and then
// fails, saying so, has lost nothing, because it did not report success. One
// of the two still has to succeed: a pair where both fail is reported too.
//
// The pairs, each of two commands on the bot api-bot, with its sessions daily
// and ops:
//
//   two `session change` calls on two sessions        (named in the issue)
//   two `session change` calls on one session         (named in the issue)
//   `session add` beside `permission allow`           (named in the issue)
//   `bot change --charter` beside `skills add`
//   `pause` of one session beside `session change` of the other
//   two `permission allow` calls with two rules
//   `permission disallow` of a rule allow holds, beside `session change`
//   `skills remove` of a skill on the list, beside `skills add`
//   `bot change --role-cap` beside `permission approval --temps`
//   `retire` of one session beside `session change` of the other
//
// So every kit command that changes bot.yaml and runs in the sandbox is in at
// least one pair. The fleet is made with a rule in allow and a skill on the
// list for the two commands that take one away, and with temp_roles written by
// hand, as a user writes them, for `--role-cap`.
//
// How the order is forced, as in codex-work-dir-race.test.js (#585):
// helpers/read-gate.js, loaded into one command with `node --import`, stops
// that command just after its k-th read of bot.yaml, until the test opens a
// gate. The test runs the other command in that gap, then opens the gate. Every
// read of each command is tried as the stop, and each command of a pair is
// tried as the stopped one. A run of each command alone counts its reads first,
// and is the premise: alone, it exits 0 and makes its change.
//
// One wait is bounded by time: a kit that takes a lock may make the other
// command wait for the stopped one, which waits for the gate. So the gate is
// opened once the other command has ended, or after GAP_MS, whichever comes
// first. Then both are let finish. Without a lock the other command ends long
// before GAP_MS.
//
// Only bot.yaml is judged. A command also writes other files (a Claude settings
// file, AGENTS.md); those are not held here.
//
// Every run is in the sandbox (helpers/cli.js): its own HOME, a fake Orca, and
// fake harnesses on its own PATH. One sandbox serves each pair: the fleet is
// made once, and its folders are put back as they were before each try.

import assert from 'node:assert/strict';
import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { parse, parseDocument } from 'yaml';

import { botHomeOf, createSandbox, repoRoot } from './helpers/cli.js';

const BOT = 'api-bot';
const GATE_ENTRY = path.join(repoRoot, 'test', 'helpers', 'read-gate.js');

/** How long the other command may run while one is stopped, before the gate is opened anyway. */
const GAP_MS = 1_500;

const CHARTER = 'Api Bot owns the API.';
const NEW_CHARTER = 'Api Bot owns the API and its docs.';
const RULE = 'Bash(npm test)';
const OTHER_RULE = 'Bash(gh issue close:*)';
/** A rule the fleet is made with, for `permission disallow` to take back. */
const HELD_RULE = 'Bash(git push origin main)';
const SKILL = 'kit:obk-debugging';
/** A skill the fleet is made with, for `skills remove` to take off. */
const HELD_SKILL = 'kit:obk-tdd';
/** The temp_roles the fleet is given by hand, as a user writes them: one role, no cap. */
const TEMP_ROLES = { developer: [{ name: 'standard', model: 'claude-opus-5-5', effort: 'high', for: 'most issues' }] };

const sessionOf = (doc, name) => (doc.sessions ?? []).find((one) => one?.name === name);

/**
 * The changes, each a command and how its change shows in bot.yaml. Every
 * expected value is the literal the command was given.
 */
const CHANGES = {
  dailyModel: {
    args: ['session', 'change', '--bots', 'bots', '--bot', BOT, '--session', 'daily', '--model', 'opus'],
    what: 'daily has model opus',
    made: (doc) => sessionOf(doc, 'daily')?.model === 'opus',
  },
  dailyEffort: {
    args: ['session', 'change', '--bots', 'bots', '--bot', BOT, '--session', 'daily', '--effort', 'high'],
    what: 'daily has effort high',
    made: (doc) => sessionOf(doc, 'daily')?.effort === 'high',
  },
  opsEffort: {
    args: ['session', 'change', '--bots', 'bots', '--bot', BOT, '--session', 'ops', '--effort', 'high'],
    what: 'ops has effort high',
    made: (doc) => sessionOf(doc, 'ops')?.effort === 'high',
  },
  addReview: {
    args: ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'review'],
    what: 'the session review is there',
    made: (doc) => sessionOf(doc, 'review') !== undefined,
  },
  allowRule: {
    args: ['permission', 'allow', '--bots', 'bots', '--bot', BOT, '--rule', RULE],
    what: `allow holds ${RULE}`,
    made: (doc) => Array.isArray(doc.allow) && doc.allow.includes(RULE),
  },
  allowOtherRule: {
    args: ['permission', 'allow', '--bots', 'bots', '--bot', BOT, '--rule', OTHER_RULE],
    what: `allow holds ${OTHER_RULE}`,
    made: (doc) => Array.isArray(doc.allow) && doc.allow.includes(OTHER_RULE),
  },
  disallowRule: {
    args: ['permission', 'disallow', '--bots', 'bots', '--bot', BOT, '--rule', HELD_RULE],
    what: `allow no longer holds ${HELD_RULE}`,
    made: (doc) => Array.isArray(doc.allow) && !doc.allow.includes(HELD_RULE),
  },
  tempApproval: {
    args: ['permission', 'approval', '--bots', 'bots', '--bot', BOT, '--temps', '--approval', 'ask'],
    what: 'temp_approval is ask',
    made: (doc) => doc.temp_approval === 'ask',
  },
  charter: {
    args: ['bot', 'change', '--bots', 'bots', '--bot', BOT, '--charter', NEW_CHARTER],
    what: `the charter is "${NEW_CHARTER}"`,
    made: (doc) => typeof doc.charter === 'string' && doc.charter.trim() === NEW_CHARTER,
  },
  addSkill: {
    args: ['skills', 'add', '--bots', 'bots', '--bot', BOT, '--skill', SKILL],
    what: `skills holds ${SKILL}`,
    made: (doc) => Array.isArray(doc.skills) && doc.skills.includes(SKILL),
  },
  removeSkill: {
    args: ['skills', 'remove', '--bots', 'bots', '--bot', BOT, '--skill', HELD_SKILL],
    what: `skills no longer holds ${HELD_SKILL}`,
    made: (doc) => Array.isArray(doc.skills) && !doc.skills.includes(HELD_SKILL),
  },
  roleCap: {
    args: ['bot', 'change', '--bots', 'bots', '--bot', BOT, '--role-cap', 'developer=2'],
    what: 'the role developer has cap 2',
    made: (doc) => doc.temp_roles?.developer?.cap === 2,
  },
  retireOps: {
    args: ['retire', '--bots', 'bots', '--bot', BOT, '--session', 'ops'],
    what: 'the session ops is off the bot',
    made: (doc) => Array.isArray(doc.sessions) && sessionOf(doc, 'ops') === undefined,
  },
  pauseOps: {
    args: ['pause', '--bots', 'bots', '--bot', BOT, '--session', 'ops'],
    what: 'ops is paused',
    made: (doc) => sessionOf(doc, 'ops')?.paused === true,
  },
};

const PAIRS = [
  ['two session change calls on two sessions', 'dailyModel', 'opsEffort'],
  ['two session change calls on one session, two settings', 'dailyModel', 'dailyEffort'],
  ['session add beside permission allow', 'addReview', 'allowRule'],
  ['bot change --charter beside skills add', 'charter', 'addSkill'],
  ['pause of ops beside session change of daily', 'pauseOps', 'dailyModel'],
  ['two permission allow calls with two rules', 'allowRule', 'allowOtherRule'],
  ['permission disallow beside session change', 'disallowRule', 'opsEffort'],
  ['skills remove beside skills add', 'removeSkill', 'addSkill'],
  ['bot change --role-cap beside permission approval --temps', 'roleCap', 'tempApproval'],
  ['retire of ops beside session change of daily', 'retireOps', 'dailyModel'],
];

const botYamlOf = (bots) => path.join(botHomeOf(bots, BOT), 'bot.yaml');
const isThere = (file) => access(file).then(() => true, () => false);
const said = (result) => `${result.stdout}${result.stderr}`.trim();

/** What the sandbox holds that a command may change: put back before each try. */
const PARTS = ['cwd', 'home', 'orca-fake'];

/**
 * api-bot on Claude, with the sessions daily and ops, in a sandbox of its own.
 * Answers the bots folder and `fresh`, which puts the sandbox back as it was
 * now.
 */
async function fleet(t) {
  const box = await createSandbox(t);
  const ran = async (args) => {
    const result = await box.run(args);
    assert.equal(result.code, 0, `the setup: obk ${args.join(' ')}\n${said(result)}`);
  };
  await ran(['init', '--bots', 'bots', '--harness', 'claude']);
  await ran(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude', '--charter', CHARTER]);
  await ran(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily']);
  await ran(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'ops']);
  await ran(['permission', 'allow', '--bots', 'bots', '--bot', BOT, '--rule', HELD_RULE]);
  await ran(['skills', 'add', '--bots', 'bots', '--bot', BOT, '--skill', HELD_SKILL]);
  // temp_roles has no command of its own: a user writes it by hand.
  const doc = parseDocument(await readFile(botYamlOf(box.path('bots')), 'utf8'));
  doc.set('temp_roles', TEMP_ROLES);
  await writeFile(botYamlOf(box.path('bots')), doc.toString());

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

/** The environment that loads the read gate on bot.yaml, stopping after read `at` (0: none). */
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

/** bot.yaml as it is now, parsed. */
const botYaml = async (bots) => parse(await readFile(botYamlOf(bots), 'utf8'));

/** The part of bot.yaml a reader needs to see what was lost: all but the allow list's defaults. */
async function shown(bots) {
  const { allow, ...rest } = await botYaml(bots);
  return JSON.stringify({ ...rest, allow: (allow ?? []).filter((rule) => !String(rule).includes('/obk ')) });
}

/**
 * The premise: `name` alone, on the fleet as it was made, exits 0 and makes its
 * change. Answers how many times it read bot.yaml. Leaves the fleet as it was.
 */
async function alone({ box, bots, fresh }, name) {
  await fresh();
  const log = path.join(box.root, `reads-${name}.log`);
  await writeFile(log, '');
  assert.ok(!CHANGES[name].made(await botYaml(bots)), `the premise: before ${name} runs, bot.yaml does not yet say ${CHANGES[name].what}`);
  const result = await box.run(CHANGES[name].args, { env: gated(box, bots, { at: 0, log, gate: path.join(box.root, 'no-gate') }) });
  assert.equal(result.code, 0, `the premise: ${CHANGES[name].args.join(' ')} alone exits 0, got:\n${said(result)}`);
  assert.ok(CHANGES[name].made(await botYaml(bots)), `the premise: alone, ${CHANGES[name].args.join(' ')} makes its change (${CHANGES[name].what}); bot.yaml: ${await shown(bots)}`);
  const reads = (await readFile(log, 'utf8')).split('\n').filter(Boolean).length;
  assert.ok(reads >= 1, `the premise: the gate sees ${name} read bot.yaml, got ${reads} reads`);
  await fresh();
  return reads;
}

/** Run `obk <args>`, with `ended` set once it has. */
function started(box, args, env) {
  const run = { ended: false };
  run.result = box.run(args, { env }).then((result) => { run.ended = true; return result; });
  return run;
}

/** Wait until the stopped command has reached its stop (true), or has ended without reaching it (false). */
async function reachedStop(gate, run) {
  for (;;) {
    if (await isThere(`${gate}.reached`)) return true;
    if (run.ended) return false;
    await delay(10);
  }
}

/**
 * One try: `stopped` stopped after its read `at`, `other` run in that gap, then
 * both let finish. Answers what each command exited with and what bot.yaml
 * holds.
 */
async function tryOnce({ box, bots, fresh }, stopped, other, at) {
  await fresh();
  const gate = path.join(box.root, 'gates', `${stopped}-${other}-${at}`);
  await mkdir(path.dirname(gate), { recursive: true });
  const env = gated(box, bots, { at, log: path.join(box.root, 'gates', `${stopped}-${other}-${at}.log`), gate });

  const first = started(box, CHANGES[stopped].args, env);
  const reached = await reachedStop(gate, first);
  let second;
  let inGap = false;
  if (reached) {
    second = started(box, CHANGES[other].args, box.env);
    await Promise.race([second.result, delay(GAP_MS)]);
    inGap = second.ended;
  }
  await writeFile(gate, '');
  const one = await first.result;
  if (second === undefined) second = started(box, CHANGES[other].args, box.env);
  const two = await second.result;
  return { reached, inGap, one, two, doc: await botYaml(bots) };
}

/** What a try says when it fails: the order forced, each exit, and what bot.yaml lost. */
function story(stopped, other, at, reads, { reached, inGap, one, two }) {
  const order = !reached
    ? `${stopped} ended before its read ${at} of ${reads}, so ${other} ran after it`
    : `${stopped} stopped after its read ${at} of ${reads} of bot.yaml, ${other} run in the gap`
      + (inGap ? ' and ended there' : ` and still running after ${GAP_MS} ms, when the gate was opened`);
  const command = (name) => CHANGES[name].args.slice(0, CHANGES[name].args.indexOf('--bots')).join(' ');
  const exit = (name, result) => `${name} (${command(name)}) exit ${result.code}`
    + (result.code === 0 ? '' : `, saying: ${said(result)}`);
  return `${order}: ${exit(stopped, one)}; ${exit(other, two)}`;
}

test('#595 the premise: each command here, alone, exits 0 and makes its change in bot.yaml', async (t) => {
  const space = await fleet(t);
  for (const name of Object.keys(CHANGES)) await alone(space, name);
});

for (const [label, a, b] of PAIRS) {
  test(`#595 ${label}: each command stopped after each of its reads of bot.yaml while the other runs, and a command that exits 0 keeps its change`, async (t) => {
    const space = await fleet(t);
    const reads = { [a]: await alone(space, a), [b]: await alone(space, b) };

    let forced = 0;
    for (const [stopped, other] of [[a, b], [b, a]]) {
      for (let at = 1; at <= reads[stopped]; at += 1) {
        const ran = await tryOnce(space, stopped, other, at);
        if (ran.reached) forced += 1;
        const told = story(stopped, other, at, reads[stopped], ran);
        const kept = JSON.stringify(ran.doc.sessions);

        assert.ok(
          ran.one.code === 0 || ran.two.code === 0,
          `${told}. Neither command succeeded. bot.yaml sessions: ${kept}`,
        );
        for (const [name, result] of [[stopped, ran.one], [other, ran.two]]) {
          assert.ok(
            result.code !== 0 || CHANGES[name].made(ran.doc),
            `${told}. ${name} exited 0, and its change is lost: bot.yaml does not say ${CHANGES[name].what}. `
            + `bot.yaml now: ${await shown(space.bots)}`,
          );
        }
      }
    }
    assert.ok(forced > 0, `the gate stopped no command of the pair ${a} and ${b}, so no order was forced and this proves nothing`);
  });
}
