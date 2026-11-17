// `obk health` says when `ps` cannot run, and what that costs (#791).
//
// The kit's SessionStart hook reads the process table with the bare `ps` on
// PATH (src/record.js), and where `ps` cannot run it records no session: the
// book then holds no conversation for `obk restart` to resume. The hook says
// so in the session (hook-without-ps.test.js). Health says it too, so that a
// user who runs it learns of it outside a session.
//
//   R4  When `ps -Ao pid=,ppid=,comm=` cannot run in health's own environment
//       (a bare `ps` on PATH): one finding of kind `process`, with no `bot`
//       field and `where` equal to `ps`. Its text names `ps`, the reason ps
//       gave (the first line of its stderr, or else its exit status or the
//       error code), and says that the hook cannot record sessions where ps
//       cannot run, naming `obk restart`. Health exits 1 for it, and `--json`
//       carries it. When ps runs, there is no such finding.
//
//   R4, after the review of PR 799: the finding must not say that obk restart
//       or obk up cannot recover a conversation that the book holds. It speaks
//       only of a new conversation, one the hook does not record, and it still
//       names obk restart.
//
// The wording is not pinned: only the parts above are.
//
// `ps` is broken for the one run under test, by the PATH of the environment
// handed to it (helpers/no-ps.js); a bare `ps` is not the fake of
// helpers/fake-tools.js, which stands in only for /bin/ps. The fleet is the
// one health.test.js H17 finds clean: Bot Father and api-bot, made and opened
// by the kit. Every run is in the sandbox (helpers/cli.js).

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSandbox } from './helpers/cli.js';
import { refusingPs, withoutPs } from './helpers/no-ps.js';

/** Bot Father and api-bot, made and opened by the kit: a fleet with nothing wrong. */
async function cleanFleet(box) {
  for (const args of [
    ['init', '--bots', 'bots', '--harness', 'claude'],
    ['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude'],
    ['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily'],
    ['up', '--bots', 'bots', '--bot', 'api-bot'],
  ]) {
    const result = await box.run(args);
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  }
}

/** `obk health --json` with `env`: the run and its parsed answer. */
async function healthJson(box, env) {
  const result = await box.run(['health', '--bots', 'bots', '--json'], { env });
  assert.equal(result.stderr, '', `health reports on stdout, and put this on stderr: ${result.stderr}`);
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  return { result, answer };
}

const show = (value) => JSON.stringify(value, null, 2);

/** The one finding about ps, held to its shape; `reason` is the pattern ps's reason must match. */
function psFinding(answer, reason) {
  const about = answer.found.filter((one) => one.where === 'ps');
  assert.equal(about.length, 1, `one finding whose where is ps, got: ${show(answer.found)}`);
  const [finding] = about;
  assert.equal(finding.kind, 'process', `the finding about ps is of kind process, got: ${show(finding)}`);
  assert.equal('bot' in finding, false, `it is about the machine, not a bot, so it has no bot field, got: ${show(finding)}`);
  assert.match(finding.says, /\bps\b/, `it names ps: ${finding.says}`);
  assert.match(finding.says, reason, `it gives the reason ps gave: ${finding.says}`);
  assert.match(finding.says, /hook/i, `it says that the hook is what needs ps: ${finding.says}`);
  assert.match(finding.says, /record/i, `it says that the hook cannot record sessions where ps cannot run: ${finding.says}`);
  assert.match(finding.says, /obk restart/, `it names obk restart: ${finding.says}`);
  return finding;
}

test('HW1 ps works: no finding about ps, and the clean fleet exits 0', async (t) => {
  const box = await createSandbox(t);
  await cleanFleet(box);

  const { result, answer } = await healthJson(box);

  assert.deepEqual(answer.found.filter((one) => one.where === 'ps' || (one.kind === 'process' && !('bot' in one))), [], 'where ps runs there is nothing to say about it');
  assert.equal(result.code, 0, `the premise: this fleet is clean, got: ${show(answer.found)}`);
});

test('HW2 ps refused: one process finding at ps, with its reason, the only finding, and health exits 1', async (t) => {
  const box = await createSandbox(t);
  await cleanFleet(box);
  const env = await refusingPs(box);

  const { result, answer } = await healthJson(box, env);

  const finding = psFinding(answer, /operation not permitted/);
  assert.deepEqual(answer.found, [finding], `a clean fleet with ps refused has that finding alone, got: ${show(answer.found)}`);
  assert.equal(result.code, 1, 'a finding is something to look at, so health exits 1');

  const plain = await box.run(['health', '--bots', 'bots'], { env });
  assert.equal(plain.code, 1, plain.stderr);
  assert.match(plain.stdout, /operation not permitted/, `the plain report says it too, got: ${plain.stdout}`);
});

test('HW3 ps exits non-zero with nothing on stderr: the finding gives its exit status', async (t) => {
  const box = await createSandbox(t);
  await cleanFleet(box);
  const env = await refusingPs(box, { stderr: '', code: 42 });

  const { result, answer } = await healthJson(box, env);

  psFinding(answer, /\b42\b/);
  assert.equal(result.code, 1);
});

test('HW4 no ps on PATH: the finding gives the error code ENOENT', async (t) => {
  const box = await createSandbox(t);
  await cleanFleet(box);
  const env = await withoutPs(box);

  const { result, answer } = await healthJson(box, env);

  psFinding(answer, /ENOENT/);
  assert.equal(result.code, 1);
});

test('HW5 ps lists no process: there is a finding about ps all the same', async (t) => {
  // Its reason is not pinned: an empty table gives no stderr, a status of 0,
  // and no error code.
  const box = await createSandbox(t);
  await cleanFleet(box);
  const env = await refusingPs(box, { stderr: '', code: 0 });

  const { result, answer } = await healthJson(box, env);

  psFinding(answer, /./);
  assert.equal(result.code, 1);
});

test('HW6 ps refused: the finding speaks of a new conversation the hook does not record, never of one the book holds', async (t) => {
  const box = await createSandbox(t);
  await cleanFleet(box);
  const env = await refusingPs(box);

  const { answer } = await healthJson(box, env);

  const { says } = psFinding(answer, /operation not permitted/);
  const sentences = says.split(/(?<=\.)\s+/);
  const aboutRestart = sentences.filter((one) => /obk restart/.test(one));
  assert.ok(aboutRestart.length > 0, `the finding names obk restart: ${says}`);
  for (const sentence of aboutRestart) {
    assert.match(sentence, /\bnew conversation/i, `what it says of obk restart is about a new conversation, one the hook does not record: ${sentence}`);
  }
  assert.doesNotMatch(
    says,
    /\b(?:cannot|can't|can not|could not|do not|does not|don't|doesn't|never)\b[^.;]*\b(?:bring|recover|resume)\b[^.;]*\b(?:book holds|in the book|held)\b/i,
    `the finding must not say that obk restart or obk up cannot recover a conversation the book holds: ${says}`,
  );
});
