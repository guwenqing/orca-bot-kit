// Two `session change` commands at once never make a Codex session with a work
// dir outside its bot folder (#585, R10, from review).
//
// `session change` judges the session as it writes it. Two `session change`
// commands on the same session can run at the same time, and bot.yaml has no
// lock. Whatever order their reads and writes take, the bot.yaml that results
// never holds a Codex session with a work dir outside the bot folder that
// neither command alone would have been allowed to write. One command's change
// may be lost; that is a separate matter, and not held here.
//
// The pair: a Claude session `daily` at work/inside, and
//
//   A  session change --harness codex       allowed alone: the work dir is inside
//   B  session change --work-dir ../outside allowed alone: the session is Claude
//
// together they must not end as Codex at ../outside.
//
// How the order is forced: helpers/read-gate.js, loaded into one command with
// `node --import`, stops that command just after its k-th read of bot.yaml,
// until the test opens a gate. The test runs the other command to its end in
// that gap, then opens the gate. Every read of each command is tried as the
// stop, so the test does not depend on which read is the one the check makes.
// A run with no stop counts the reads first.
//
// One wait is bounded by time, and only as a fallback: a kit that takes a lock
// may make the other command wait for the stopped one, which waits for the
// gate. After OTHER_WAIT_MS the gate is opened anyway, and both are let finish.
// Without a lock the other command ends long before that.
//
// Every run is in the sandbox (helpers/cli.js): its own HOME, a fake Orca, and
// fake harnesses on its own PATH.

import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';

import { botHomeOf, createSandbox, repoRoot } from './helpers/cli.js';

const BOT = 'api-bot';
const GATE_ENTRY = path.join(repoRoot, 'test', 'helpers', 'read-gate.js');

/** How long the other command may take while one is stopped, before the gate is opened anyway. */
const OTHER_WAIT_MS = 30_000;

const COMMANDS = {
  A: ['--harness', 'codex'],
  B: ['--work-dir', '../outside'],
};

const botYamlOf = (bots) => path.join(botHomeOf(bots, BOT), 'bot.yaml');
const isThere = (file) => access(file).then(() => true, () => false);

/** api-bot on Claude, with its daily session at work/inside. Answers the bots folder. */
async function withSession(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  assert.equal(made.code, 0, `${made.stdout}${made.stderr}`);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily', '--work-dir', 'work/inside']);
  assert.equal(added.code, 0, `${added.stdout}${added.stderr}`);
  return box.path('bots');
}

/** `obk session change` of api-bot's daily, with `env` for its run. */
const change = (box, rest, env = box.env) =>
  box.run(['session', 'change', '--bots', 'bots', '--bot', BOT, '--session', 'daily', ...rest], { env });

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

/** How many times `command`, run alone, reads bot.yaml; and that it is allowed alone. */
async function readsOf(t, command) {
  const box = await createSandbox(t);
  const bots = await withSession(box);
  const log = box.path('reads.log');
  await writeFile(log, '');

  const alone = await change(box, COMMANDS[command], gated(box, bots, { at: 0, log, gate: box.path('gate') }));

  assert.equal(alone.code, 0, `the premise: ${command} alone is allowed, got:\n${alone.stdout}${alone.stderr}`);
  const reads = (await readFile(log, 'utf8')).split('\n').filter(Boolean).length;
  assert.ok(reads >= 1, `the premise: the gate sees ${command} read bot.yaml, got ${reads} reads`);
  return reads;
}

/** Wait until the stopped command has reached its stop, or has ended without reaching it. */
async function stopped(gate, run) {
  for (;;) {
    if (await isThere(`${gate}.reached`)) return true;
    if (run.ended) return false;
    await delay(20);
  }
}

/** The session daily as bot.yaml has it now, with the harness it runs on and where its work dir leads. */
async function dailyOf(bots) {
  const doc = parse(await readFile(botYamlOf(bots), 'utf8'));
  const session = (doc.sessions ?? []).find((one) => one?.name === 'daily');
  assert.ok(session, `daily is still in bot.yaml, got: ${JSON.stringify(doc.sessions)}`);
  const home = botHomeOf(bots, BOT);
  const resolved = session.work_dir === undefined ? home : path.resolve(home, String(session.work_dir));
  const inside = resolved === home || resolved.startsWith(`${home}${path.sep}`);
  return { session, harness: session.harness ?? doc.harness, inside };
}

for (const [stoppedOne, otherOne] of [['A', 'B'], ['B', 'A']]) {
  test(`R10 ${stoppedOne} stopped after each of its reads of bot.yaml while ${otherOne} runs: never Codex with a work dir outside`, async (t) => {
    const reads = await readsOf(t, stoppedOne);
    await readsOf(t, otherOne); // the premise: the other is allowed alone too

    for (let at = 1; at <= reads; at += 1) {
      const box = await createSandbox(t);
      const bots = await withSession(box);
      const gate = box.path('gate');
      const env = gated(box, bots, { at, log: box.path('reads.log'), gate });

      const run = { ended: false };
      run.result = change(box, COMMANDS[stoppedOne], env).then((result) => { run.ended = true; return result; });
      const reached = await stopped(gate, run);
      let other;
      if (reached) {
        other = change(box, COMMANDS[otherOne]);
        await Promise.race([other, delay(OTHER_WAIT_MS)]);
      }
      await writeFile(gate, '');
      const first = await run.result;
      const second = other === undefined ? await change(box, COMMANDS[otherOne]) : await other;

      const { session, harness, inside } = await dailyOf(bots);
      assert.ok(
        !(harness === 'codex' && !inside),
        `${stoppedOne} (${COMMANDS[stoppedOne].join(' ')}) stopped after read ${at} of ${reads}, `
        + `${otherOne} (${COMMANDS[otherOne].join(' ')}) run in the gap: `
        + `exit ${first.code} and ${second.code}, and bot.yaml now holds a Codex session with a work dir outside: ${JSON.stringify(session)}`,
      );
    }
  });
}
