// No kit command hangs on one slow Orca reply while deciding whether it may
// type into a tab (#422).
//
// Every line the kit types into a running session goes through one gate first:
// the Escape of `obk message send --interrupt`, `/reload-skills` after `obk
// skills build`, grooming's lines and the line a resumed Codex session is
// given (#226). Since #555 fleet mail types nothing else. Its one key is the
// Escape of --interrupt into a busy receiver whose tab passes the gate, so
// the mail tests here send with --interrupt to a busy receiver. Seen in the review of PR #421: with one Orca screen read made to hang
// for 35 s, the command waited the whole 35 s out, because the gate's own
// Orca calls had no time bound.
//
// The contract, from the issue:
//
//   - every Orca call the gate makes has a bound;
//   - when one runs out, the gate ends in bounded time and types nothing, and
//     the caller says, in plain words, that it could not tell: Orca did not
//     answer in time. That holds for every caller.
//
// Out of scope: what the gate decides when Orca does answer (#232, #261, #329,
// #416), and #226's 20 s cutoff for its own line.
//
// How it is tested. The fake Orca's `hang` answers every call of one command
// HANG_MS late, and then as it would have answered (helpers/fake-orca.js). The
// Orca calls each caller below makes into a running session's tab were read
// off the fake's call log for a plain run, and every one of them is the gate's:
//
//   message send   with --interrupt: terminal list, terminal wait, terminal
//                  show, diagnostics memory, terminal read (the gate), then
//                  terminal send (the Escape) and the post
//   skills build   status, then the same five of the gate's, and terminal send
//
// So each of those five is made to hang in turn, for each caller, and nothing
// outside the gate is slowed. `diagnostics memory` is how the gate finds the
// pane behind a tab, to read who is in front of it with `ps`; it is one of the
// gate's Orca calls as much as the others.
//
// The margin: the command has to return in under half of HANG_MS. The bound is
// the builder's to choose; half a 30 s hang leaves 15 s for a bound and the
// rest of the run, which in the fake takes a second or two. A gate whose calls
// are unbounded waits the whole hang out and misses it by more than 15 s.
//
// A timed-out call is a "could not tell" even where the gate has another way
// to learn the same thing (the review of PR #424). When `ps` cannot read a tab,
// the gate asks Orca's runtime who is in front instead (ADR 0034); a
// `diagnostics memory` that ran out is no reason to ask it, and an answer from
// it is no reason to type. So the last tests have the fake app's runtime
// client there and answering (`orcaApp`, as in test/front-without-ps.test.js),
// and `diagnostics memory` hung.
//
// The #226 resume line is not a caller here: `up` lists a project's tabs and
// looks at a new tab through the same Orca commands outside the gate, so a
// hang on any of them would slow `up` wherever the gate stands.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSandbox, orcaApp, typedInto } from './helpers/cli.js';
import { addSkills, answerOf, botYamlOf, entryOf } from './helpers/skills.js';

/** How late a hung Orca call answers. */
const HANG_MS = 30000;

/** The most a command may take with one gate call hung: half the hang. */
const WITHIN_MS = HANG_MS / 2;

/** The Orca calls the gate makes, each hung in turn. */
const GATE_CALLS = ['terminal list', 'terminal wait', 'terminal show', 'diagnostics memory', 'terminal read'];

/**
 * A reason that says the kit could not tell because Orca was slow: Orca not
 * answering, or a time. Read loosely; the words are the builder's.
 */
const NOT_IN_TIME = /\b(?:did not|didn't|does not|doesn't|not|no)\s+(?:answer|reply|respond)|\btim(?:e|ed)\s*out\b|\bin time\b|\bseconds?\b|\b\d+(?:\.\d+)?\s*s\b/i;

/** Whatever was typed into any tab of the fleet after its launch line, by tab title. */
async function typedSinceLaunch(box) {
  return Object.fromEntries((await box.orca.terminals()).map((terminal) => [terminal.title, typedInto(terminal).slice(1)]));
}

/** Nothing at all was typed into any tab after its launch line. */
async function assertNothingTyped(box, what) {
  const typed = await typedSinceLaunch(box);
  assert.deepEqual(Object.values(typed).flat(), [], `${what}: nothing is typed into any tab, got: ${JSON.stringify(typed)}`);
}

/** Run a kit command and time it. */
async function timed(box, args) {
  const began = Date.now();
  const result = await box.run(args);
  return { result, ms: Date.now() - began };
}

/** The command came back well within the hang. */
function assertWithin(ms, what) {
  assert.ok(ms < WITHIN_MS, `${what}: the command returns in under ${WITHIN_MS} ms with one Orca call hung for ${HANG_MS} ms, took ${ms} ms`);
}

// ------------------------------------------------------------- the mail interrupt

/** A Claude bot that writes and a Codex bot that reads, both up and busy by Orca's tui-idle wait, nothing typed since. */
async function mailFleetIn(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  for (const [bot, harness] of [['writer', 'claude'], ['coder', 'codex']]) {
    assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness])).code, 0);
    assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', 'daily'])).code, 0);
  }
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  await box.orca.set({ waitIdle: 'busy' });
}

const sendArgs = [
  'message', 'send', '--bots', 'bots', '--to', 'coder/daily', '--from', 'writer/daily',
  '--subject', 'the staging host', '--text', 'It is down again.', '--interrupt',
];

for (const hung of GATE_CALLS) {
  test(`message send --interrupt: with \`${hung}\` hung, the look gives up in bounded time, sends no Escape, and says Orca did not answer in time`, async (t) => {
    const box = await createSandbox(t);
    await mailFleetIn(box);
    await box.orca.set({ hang: { command: hung, ms: HANG_MS } });

    const { result, ms } = await timed(box, sendArgs);

    assertWithin(ms, hung);
    assert.equal(result.code, 0, `${hung}: the letter went whatever became of the interrupt: ${result.stdout}${result.stderr}`);
    assert.equal((await box.orca.messages()).length, 1, `${hung}: and Orca holds it`);
    assert.match(result.stdout + result.stderr, NOT_IN_TIME, `${hung}: the output says Orca did not answer in time, got:\n${result.stdout}${result.stderr}`);
    await assertNothingTyped(box, hung);
  });
}

test('message send --interrupt, plain: with the screen read hung, a line of the report says Orca did not answer in time', async (t) => {
  const box = await createSandbox(t);
  await mailFleetIn(box);
  await box.orca.set({ hang: { command: 'terminal read', ms: HANG_MS } });

  const { result, ms } = await timed(box, sendArgs);

  assertWithin(ms, 'plain');
  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  const lines = result.stdout.split('\n').filter((line) => NOT_IN_TIME.test(line));
  assert.ok(lines.length > 0, `a line says Orca did not answer in time, got:\n${result.stdout}`);
  await assertNothingTyped(box, 'plain');
});

// ------------------------------------------------------------- the skills reload

/** api-bot with one running Claude session, `daily`, nothing typed since its launch. */
async function skillsFleetIn(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily'])).code, 0);
  const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);
  assert.equal(up.code, 0, up.stderr);
  await addSkills(botYamlOf(box.path('bots'), 'api-bot'), 'kit:obk-tdd');
}

for (const hung of GATE_CALLS) {
  test(`skills build: with \`${hung}\` hung, the reload gives up in bounded time, types nothing, and says Orca did not answer in time`, async (t) => {
    const box = await createSandbox(t);
    await skillsFleetIn(box);
    await box.orca.set({ hang: { command: hung, ms: HANG_MS } });

    const { result, ms } = await timed(box, ['skills', 'build', '--bots', 'bots', '--bot', 'api-bot', '--json']);

    assertWithin(ms, hung);
    assert.equal(result.code, 0, `${hung}: the links were made whatever became of the telling: ${result.stdout}${result.stderr}`);
    const sessions = entryOf(answerOf(result), 'api-bot').sessions;
    assert.equal(sessions?.length, 1, `${hung}: daily is reported, got: ${JSON.stringify(sessions)}`);
    const [daily] = sessions;
    assert.equal(daily.state, 'unknown', `${hung}: the kit could not tell, got: ${JSON.stringify(daily)}`);
    assert.match(String(daily.trouble), NOT_IN_TIME, `${hung}: because Orca did not answer in time, got: ${daily.trouble}`);
    await assertNothingTyped(box, hung);
  });
}

// ------------------------------------------------------------- with Orca's runtime there

test('message send --interrupt: with `diagnostics memory` hung and Orca\'s runtime answering, the look still gives up, sends no Escape, and says Orca did not answer in time', async (t) => {
  const box = await createSandbox(t);
  await mailFleetIn(box);
  // The runtime answers from the fake's world: Codex in front of the reader's
  // tab. A gate that asked it after the timeout would send the Escape.
  await orcaApp(box);
  await box.orca.set({ hang: { command: 'diagnostics memory', ms: HANG_MS } });

  const { result, ms } = await timed(box, sendArgs);

  assertWithin(ms, 'runtime there');
  assert.equal(result.code, 0, `the letter went whatever became of the interrupt: ${result.stdout}${result.stderr}`);
  assert.equal((await box.orca.messages()).length, 1, 'the letter is in the mailbox');
  assert.match(result.stdout + result.stderr, NOT_IN_TIME, `the output says Orca did not answer in time, got:\n${result.stdout}${result.stderr}`);
  await assertNothingTyped(box, 'runtime there');
});

test('skills build: with `diagnostics memory` hung and Orca\'s runtime answering, the reload still gives up, types nothing, and says Orca did not answer in time', async (t) => {
  const box = await createSandbox(t);
  await skillsFleetIn(box);
  await orcaApp(box);
  await box.orca.set({ hang: { command: 'diagnostics memory', ms: HANG_MS } });

  const { result, ms } = await timed(box, ['skills', 'build', '--bots', 'bots', '--bot', 'api-bot', '--json']);

  assertWithin(ms, 'runtime there');
  assert.equal(result.code, 0, `the links were made whatever became of the telling: ${result.stdout}${result.stderr}`);
  const [daily] = entryOf(answerOf(result), 'api-bot').sessions ?? [];
  assert.equal(daily?.state, 'unknown', `the kit could not tell, got: ${JSON.stringify(daily)}`);
  assert.match(String(daily.trouble), NOT_IN_TIME, `because Orca did not answer in time, got: ${daily.trouble}`);
  await assertNothingTyped(box, 'runtime there');
});
