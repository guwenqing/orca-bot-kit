// `obk health` says when Pi cannot run a bot's sessions (#660, H4).
//
// For each bot with at least one Pi session in bot.yaml (paused ones, and ones
// never brought up, included), health asks Pi, read only, with `pi --version`
// and `pi --list-models [search]`. It never runs `pi auth check`, and never
// reads ~/.pi/agent/auth.json: the kit never handles Pi's credentials. It
// gives a `config` finding, with `where` the bot's bot.yaml, when:
//
//   a. Pi does not run (no `pi` on PATH, or `pi --version` fails): the finding
//      says Pi is not installed or does not run, and to install Pi.
//   b. Pi lists no model at all (`No models available.`): it says Pi is signed
//      in to no provider, and that the user signs in to Pi themselves.
//   c. A session's model is one Pi does not list (`pi --list-models <model
//      without the :thinking suffix>` answers `No models matching …`): one
//      finding per such session, naming the bot, the session and the model,
//      and `pi --list-models`.
//   d. `pi --list-models <model>` itself fails (exit not 0, or killed): a
//      finding naming the session and the model, saying Pi could not answer.
//
// With (a) or (b), no finding for each model is given for that bot. A session
// with no model takes Pi's default and gets no model finding. Pi is asked at
// most once per question in one health run, however many bots or sessions
// name the same model. A fleet with no Pi session does not run `pi` at all.
// Health types nothing into any tab.
//
// The wording beyond the words named is the implementer's. The `pi` here is
// the fake in helpers/pi.js; the tests with no `pi` on PATH run every command
// with a PATH that holds no folder the real one is in. Nothing here reaches
// the real `pi`, the real ~/.pi or the real Orca.

import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { createSandbox, orcaCallsOf, repoRoot, sh } from './helpers/cli.js';
import { envWithoutPi, fakePi, PI_MODELS } from './helpers/pi.js';
import { botYamlOf } from './helpers/skills.js';

const KINDS = ['orca', 'config', 'skill', 'session', 'leftover', 'process', 'mail'];

/** A model no fake Pi lists. */
const NOSUCH = 'nosuch/model-660';

// ---------------------------------------------------------------- the fleet

/** Run one more `obk` command that has to work for the test to mean anything. */
async function obk(box, args, options) {
  const result = await box.run(args, options);
  assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return result;
}

/** A bots folder with Bot Father. */
const seeded = (box, options) => obk(box, ['init', '--bots', 'bots', '--harness', 'claude'], options);

/**
 * One more bot on `harness`, its sessions written into bot.yaml and not
 * brought up. Each session is `[name, ...flags]`, the flags as `session add`
 * takes them.
 */
async function botWritten(box, name, sessions, { harness = 'pi', options } = {}) {
  await obk(box, ['bot', 'create', '--bots', 'bots', '--name', name, '--harness', harness], options);
  for (const [session, ...flags] of sessions) {
    await obk(box, ['session', 'add', '--bots', 'bots', '--bot', name, '--name', session, ...flags], options);
  }
}

/** Open one bot in Orca. */
const opened = (box, name, options) => obk(box, ['up', '--bots', 'bots', '--bot', name], options);

// ------------------------------------------------------------- what it answers

/** Run the health check for JSON, and hold it to the shape every finding has and to the exit code. */
async function found(box, options) {
  const result = await box.run(['health', '--bots', 'bots', '--json'], options);
  assert.equal(result.stderr, '', `a health run reports on stdout, and put this on stderr: ${result.stderr}`);
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  for (const finding of answer.found) {
    assert.ok(KINDS.includes(finding.kind), `a finding's kind is one of ${KINDS.join(', ')}, got: ${JSON.stringify(finding)}`);
    assert.ok(typeof finding.where === 'string' && finding.where.trim() !== '', `a finding says what it is about, got: ${JSON.stringify(finding)}`);
    assert.ok(typeof finding.says === 'string' && finding.says.trim() !== '', `a finding says something, got: ${JSON.stringify(finding)}`);
  }
  assert.equal(result.code, answer.found.length === 0 ? 0 : 1, `${answer.found.length} findings, exit ${result.code}`);
  return { ...answer, stdout: result.stdout };
}

/** Whether `word` is in `text` as a word of its own, not inside another. */
const hasWord = (text, word) => new RegExp(`(^|[^A-Za-z0-9_-])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9_-])`).test(text);

/** The `config` findings whose `where` is one bot's bot.yaml. */
const configOf = (answer, bots, bot) => answer.found.filter((one) => one.kind === 'config' && one.where === botYamlOf(bots, bot));

/** Every finding that names `what` in what it says. */
const saying = (answer, what) => answer.found.filter((one) => one.says.includes(what));

/** The one `config` finding about one bot that says Pi does not run: Pi named, and to install it. */
function assertPiDoesNotRun(answer, bots, bot) {
  const mine = configOf(answer, bots, bot).filter((one) => /install/i.test(one.says));
  assert.equal(mine.length, 1, `one config finding at ${botYamlOf(bots, bot)} says to install Pi, got: ${JSON.stringify(answer.found, null, 2)}`);
  assert.match(mine[0].says, /\bPi\b/, `it names Pi, got: ${mine[0].says}`);
  return mine[0];
}

/** The one `config` finding about one session's model: the bot, the session, the model and `pi --list-models`. */
function assertModelFinding(answer, bots, bot, session, model) {
  const mine = configOf(answer, bots, bot).filter((one) => hasWord(one.says, session));
  assert.equal(mine.length, 1, `one config finding at ${botYamlOf(bots, bot)} names the session ${session}, got: ${JSON.stringify(answer.found, null, 2)}`);
  const [finding] = mine;
  assert.ok(finding.says.includes(model), `it names the model ${model}, got: ${finding.says}`);
  assert.equal(finding.bot, bot, `it is about ${bot}, got: ${JSON.stringify(finding)}`);
  return finding;
}

/** The `pi` calls made since `before` calls were made: `{ args }` each. */
const piCallsSince = async (pi, before) => (await pi.calls()).slice(before);

/** The search of each `--list-models` call in `calls`; undefined for one with none. */
const searchesIn = (calls) => calls
  .filter((call) => call.args.includes('--list-models'))
  .map((call) => {
    const next = call.args[call.args.indexOf('--list-models') + 1];
    return next !== undefined && !next.startsWith('-') ? next : undefined;
  });

// ---------------------------------------------------------------------------
// a. Pi does not run.
// ---------------------------------------------------------------------------

test('H4a with no pi on PATH, each Pi bot gets one config finding at its bot.yaml that says to install Pi, and no finding for a model', async (t) => {
  // Every run here, the setup too, has a PATH with no pi on it.
  const box = await createSandbox(t);
  const env = await envWithoutPi(box);
  const where = await sh('command -v pi', { env });
  assert.notEqual(where.code, 0, `the test's PATH must hold no pi at all, found: ${where.stdout}`);
  await seeded(box, { env });
  await botWritten(box, 'pier', [['daily', '--model', NOSUCH], ['review']], { options: { env } });
  await botWritten(box, 'pier-two', [['daily']], { options: { env } });
  const bots = box.path('bots');

  const answer = await found(box, { env });

  assertPiDoesNotRun(answer, bots, 'pier');
  assertPiDoesNotRun(answer, bots, 'pier-two');
  assert.deepEqual(saying(answer, NOSUCH), [], `Pi does not run, so no model of it is judged, got: ${JSON.stringify(answer.found, null, 2)}`);
  assert.deepEqual(configOf(answer, bots, 'bot-father').filter((one) => /\bPi\b/.test(one.says)), [], 'Bot Father has no Pi session');
});

test('H4a a pi whose --version fails: a running Pi bot gets the same finding, and no finding for a model', async (t) => {
  const box = await createSandbox(t);
  const pi = await fakePi(box);
  await seeded(box);
  await botWritten(box, 'pier', [['daily', '--model', 'anthropic/claude-opus-5-5']]);
  await opened(box, 'pier');
  await obk(box, ['session', 'add', '--bots', 'bots', '--bot', 'pier', '--name', 'later', '--model', NOSUCH]);
  await pi.set({ version: 'fails' });
  const bots = box.path('bots');

  const answer = await found(box);

  assertPiDoesNotRun(answer, bots, 'pier');
  assert.deepEqual(saying(answer, NOSUCH), [], `Pi does not run, so no model of it is judged, got: ${JSON.stringify(answer.found, null, 2)}`);
  assert.ok((await pi.calls()).some((call) => call.args[0] === '--version'), 'health asked pi --version');
});

// ---------------------------------------------------------------------------
// b. Pi is signed in to no provider. Read only.
// ---------------------------------------------------------------------------

test('H4b Pi lists no model: one config finding says to sign in to Pi, no finding for a model; health runs no pi auth, reads no auth.json and types nothing', async (t) => {
  const box = await createSandbox(t);
  const pi = await fakePi(box);
  await seeded(box);
  await botWritten(box, 'pier', [['daily', '--model', 'anthropic/claude-opus-5-5']]);
  await opened(box, 'pier');
  await obk(box, ['session', 'add', '--bots', 'bots', '--bot', 'pier', '--name', 'later', '--model', NOSUCH]);
  await pi.set({ signedIn: false });
  const bots = box.path('bots');
  // Pi's own credentials file, which the kit must never read. helpers/read-gate.js
  // writes one line to `log` for each read of it by the kit.
  const auth = path.join(box.home, '.pi', 'agent', 'auth.json');
  await mkdir(path.dirname(auth), { recursive: true });
  const secret = 'sk-zq-not-a-real-key-7731';
  await writeFile(auth, `${JSON.stringify({ openai: { type: 'api_key', key: secret } })}\n`);
  const log = path.join(box.root, 'auth-reads.log');
  const env = {
    ...box.env,
    NODE_OPTIONS: [box.env.NODE_OPTIONS, `--import=${pathToFileURL(path.join(repoRoot, 'test', 'helpers', 'read-gate.js')).href}`].filter(Boolean).join(' '),
    OBK_TEST_READ_GATE_FILE: auth,
    OBK_TEST_READ_GATE_LOG: log,
    OBK_TEST_READ_GATE_AT: '0',
  };
  const piBefore = (await pi.calls()).length;
  const orcaBefore = (await box.orca.calls()).length;

  const answer = await found(box, { env });

  const mine = configOf(answer, bots, 'pier').filter((one) => /sign/i.test(one.says));
  assert.equal(mine.length, 1, `one config finding at pier's bot.yaml says to sign in, got: ${JSON.stringify(answer.found, null, 2)}`);
  assert.match(mine[0].says, /\bPi\b/, `it names Pi, got: ${mine[0].says}`);
  assert.deepEqual(saying(answer, NOSUCH), [], `Pi lists nothing, so no model of it is judged, got: ${JSON.stringify(answer.found, null, 2)}`);
  assert.deepEqual(saying(answer, 'claude-opus-5-5'), [], `nor the model of the running session, got: ${JSON.stringify(answer.found, null, 2)}`);

  const asked = await piCallsSince(pi, piBefore);
  assert.ok(asked.some((call) => call.args.includes('--list-models')), `health asked Pi which models it has, got: ${JSON.stringify(asked)}`);
  assert.deepEqual(asked.filter((call) => call.args.includes('auth')), [], 'health never runs pi auth');
  assert.equal(await readFile(log, 'utf8').catch(() => ''), '', 'health never reads ~/.pi/agent/auth.json');
  assert.ok(!answer.stdout.includes(secret), 'nothing of Pi\'s credentials is in the report');
  const typed = orcaCallsOf((await box.orca.calls()).slice(orcaBefore), 'terminal send');
  assert.deepEqual(typed.map((call) => call.args), [], 'health types nothing into any tab');
});

// ---------------------------------------------------------------------------
// c. A model Pi does not list.
// ---------------------------------------------------------------------------

test('H4c each Pi session whose model Pi does not list gets one config finding naming it, the model and pi --list-models; a thinking suffix is left off, a model\'s own colon is not, and a session with no model gets none', async (t) => {
  const box = await createSandbox(t);
  const pi = await fakePi(box);
  await seeded(box);
  await botWritten(box, 'pier', [
    ['daily', '--model', 'anthropic/claude-opus-5-5'],
    ['lost', '--model', NOSUCH],
    ['lost-high', '--model', 'nosuch/model-661:high'],
    ['levelled', '--model', 'anthropic/claude-opus-5-5:high'],
    ['named', '--model', 'ollama/llama3:8b'],
    ['plain'],
  ]);
  const bots = box.path('bots');
  const before = (await pi.calls()).length;

  const answer = await found(box);

  const lost = assertModelFinding(answer, bots, 'pier', 'lost', NOSUCH);
  assert.ok(lost.says.includes('pi --list-models'), `it names pi --list-models, got: ${lost.says}`);
  const lostHigh = assertModelFinding(answer, bots, 'pier', 'lost-high', 'nosuch/model-661');
  assert.ok(lostHigh.says.includes('pi --list-models'), `it names pi --list-models, got: ${lostHigh.says}`);
  for (const session of ['daily', 'levelled', 'named', 'plain']) {
    assert.deepEqual(
      configOf(answer, bots, 'pier').filter((one) => hasWord(one.says, session)),
      [],
      `Pi lists ${session}'s model, or it names none, got: ${JSON.stringify(answer.found, null, 2)}`,
    );
  }

  const searches = searchesIn(await piCallsSince(pi, before));
  for (const asked of [NOSUCH, 'nosuch/model-661', 'anthropic/claude-opus-5-5', 'ollama/llama3:8b']) {
    assert.ok(searches.includes(asked), `health asked Pi for ${asked}, got: ${JSON.stringify(searches)}`);
  }
  for (const never of ['nosuch/model-661:high', 'anthropic/claude-opus-5-5:high', 'ollama/llama3', 'undefined', '']) {
    assert.ok(!searches.includes(never), `health never asks Pi for ${JSON.stringify(never)}, got: ${JSON.stringify(searches)}`);
  }
});

test('H4c a paused Pi session counts: Pi no longer lists its model, and it gets the finding; its running sibling, whose model Pi lists, does not', async (t) => {
  const box = await createSandbox(t);
  const pi = await fakePi(box);
  await seeded(box);
  await botWritten(box, 'pier', [['daily', '--model', 'anthropic/claude-sonnet-5'], ['night', '--model', 'anthropic/claude-opus-5-5']]);
  await opened(box, 'pier');
  await obk(box, ['pause', '--bots', 'bots', '--bot', 'pier', '--session', 'night']);
  await pi.set({ models: PI_MODELS.filter((model) => model !== 'anthropic/claude-opus-5-5') });
  const bots = box.path('bots');

  const answer = await found(box);

  assertModelFinding(answer, bots, 'pier', 'night', 'anthropic/claude-opus-5-5');
  assert.deepEqual(configOf(answer, bots, 'pier').filter((one) => hasWord(one.says, 'daily')), [], `Pi lists daily's model, got: ${JSON.stringify(answer.found, null, 2)}`);
});

// ---------------------------------------------------------------------------
// d. Pi cannot answer for a model.
// ---------------------------------------------------------------------------

for (const how of ['fails', 'killed']) {
  test(`H4d pi --list-models <model> that ${how === 'fails' ? 'exits non-zero' : 'dies by a signal'} gives a config finding naming the session and the model, saying Pi could not answer`, async (t) => {
    const box = await createSandbox(t);
    const pi = await fakePi(box, { search: how });
    await seeded(box);
    await botWritten(box, 'pier', [['daily', '--model', 'anthropic/claude-opus-5-5'], ['plain']]);
    const bots = box.path('bots');

    const answer = await found(box);

    const finding = assertModelFinding(answer, bots, 'pier', 'daily', 'anthropic/claude-opus-5-5');
    // Pi gave no answer about the model, which is not the same as Pi saying it
    // does not list it (H4c). So the words say Pi could not answer, and they do
    // not say the model is not listed.
    assert.match(finding.says, /could not answer|couldn't answer|cannot answer|can't answer|did not answer|didn't answer|gave no answer|no answer|failed|exited|killed|signal/i, `it says Pi could not answer, got: ${finding.says}`);
    assert.doesNotMatch(finding.says, /none matching|no models? match|not list|n't list|lists none|lists no|unknown to Pi/i, `Pi did not say it lacks the model, so the finding does not say so, got: ${finding.says}`);
    assert.ok((await pi.searches()).includes('anthropic/claude-opus-5-5'), `health asked Pi for the model, got: ${JSON.stringify(await pi.searches())}`);
    assert.deepEqual(configOf(answer, bots, 'pier').filter((one) => hasWord(one.says, 'plain')), [], 'plain names no model, so Pi is not asked for one');
  });
}

// ---------------------------------------------------------------------------
// Pi is asked once per question; a fleet with no Pi session never runs pi.
// ---------------------------------------------------------------------------

test('H4 one health run asks pi --version once, and --list-models once for each model, however many bots and sessions name it; each session Pi does not list is still named', async (t) => {
  const box = await createSandbox(t);
  const pi = await fakePi(box);
  await seeded(box);
  for (const bot of ['pier', 'pier-two']) {
    await botWritten(box, bot, [
      ['daily', '--model', 'anthropic/claude-opus-5-5'],
      ['review', '--model', 'anthropic/claude-opus-5-5:low'],
      ['lost', '--model', NOSUCH],
    ]);
  }
  const bots = box.path('bots');
  const before = (await pi.calls()).length;

  const answer = await found(box);

  const asked = await piCallsSince(pi, before);
  assert.equal(asked.filter((call) => call.args[0] === '--version').length, 1, `pi --version once, got: ${JSON.stringify(asked)}`);
  const searches = searchesIn(asked);
  assert.equal(searches.filter((one) => one === 'anthropic/claude-opus-5-5').length, 1, `--list-models anthropic/claude-opus-5-5 once, got: ${JSON.stringify(searches)}`);
  assert.equal(searches.filter((one) => one === NOSUCH).length, 1, `--list-models ${NOSUCH} once, got: ${JSON.stringify(searches)}`);
  assert.ok(searches.filter((one) => one === undefined).length <= 1, `the plain --list-models at most once, got: ${JSON.stringify(searches)}`);
  assertModelFinding(answer, bots, 'pier', 'lost', NOSUCH);
  assertModelFinding(answer, bots, 'pier-two', 'lost', NOSUCH);
});

test('H4 a fleet with no Pi session never runs pi; once a Pi session is written, health asks Pi', async (t) => {
  const box = await createSandbox(t);
  const pi = await fakePi(box);
  await seeded(box);
  for (const [bot, harness] of [['api-bot', 'claude'], ['web-bot', 'codex']]) {
    await botWritten(box, bot, [['daily']], { harness });
    await opened(box, bot);
  }

  const answer = await found(box);

  assert.deepEqual(answer.found, [], `the premise: nothing is wrong with this fleet, got: ${JSON.stringify(answer.found, null, 2)}`);
  assert.deepEqual(await pi.calls(), [], 'pi was never run');

  // The contrast: the same fleet with one Pi session written, not brought up.
  await botWritten(box, 'pier', [['daily']]);
  await found(box);
  assert.ok((await pi.calls()).some((call) => call.args[0] === '--version'), `health asked pi --version, got: ${JSON.stringify(await pi.calls())}`);
});

test('H4 a Pi bot whose pi runs, lists models and lists its session\'s model gets no config finding', async (t) => {
  const box = await createSandbox(t);
  await fakePi(box);
  await seeded(box);
  await botWritten(box, 'pier', [['daily', '--model', 'anthropic/claude-opus-5-5'], ['plain']]);
  await opened(box, 'pier');
  const bots = box.path('bots');
  // Then Pi goes missing: the same fleet, the finding.
  const answer = await found(box);
  await rm(path.join(box.root, 'bin', 'pi'));
  const missing = await found(box, { env: await envWithoutPi(box) });

  assert.deepEqual(configOf(answer, bots, 'pier'), [], `Pi can run pier's sessions, got: ${JSON.stringify(answer.found, null, 2)}`);
  assertPiDoesNotRun(missing, bots, 'pier');
});
