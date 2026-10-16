// Pi slice 1 (#578): Pi not ready. The kit never handles Pi's credentials; the
// user signs in to Pi on their own. So before anything is made or changed in
// Orca (only the kit's read-only `status` check may come first), a run
// of `obk up`, `obk restart` or `obk unpause` that will start a Pi session
// asks Pi itself, and refuses with a plain sentence, a non-zero exit and no tab
// opened, when:
//
//   - `pi` cannot be run: not on PATH, or `pi --version` fails;
//   - `pi --list-models` says `No models available.`: nobody is signed in, and
//     the sentence tells the user to sign in to Pi themselves;
//   - the session names a model and `pi --list-models <model>` says
//     `No models matching`. A model written with a trailing `:<thinking
//     level>` (one of Pi's levels) is looked up without that suffix.
//
// A fleet with no Pi session never runs `pi` at all.
//
// The `pi` here is the fake in helpers/pi.js, in every sandbox. The one test
// with no `pi` on PATH runs the kit with a PATH that holds no folder the real
// one is in.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSandbox, orcaCommand, sh } from './helpers/cli.js';
import { envWithoutPi, fakePi } from './helpers/pi.js';

const BOT = 'pi-bot';
const PROMPT = 'Read your AGENTS.md and keep the queue moving.';

/** A bots folder with a Pi bot and one Pi session with `settings`, not yet brought up. */
async function withPiSession(box, settings = [], options = {}) {
  const init = await box.run(['init', '--bots', 'bots', '--harness', 'claude'], options);
  assert.equal(init.code, 0, init.stderr);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'pi'], options);
  assert.equal(made.code, 0, `${made.stdout}${made.stderr}`);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily', '--prompt', PROMPT, ...settings], options);
  assert.equal(added.code, 0, `${added.stdout}${added.stderr}`);
  return box.path('bots');
}

/** Where Orca stands before the run under test: every call so far, and every tab. */
const orcaNow = async (box) => ({
  calls: (await box.orca.calls()).length,
  terminals: await box.orca.terminals(),
  setups: await box.orca.setups(),
});

/**
 * A plain refusal, a non-zero exit, and nothing made or changed in Orca: no
 * call but the kit's read-only `status` check, which every up, restart and
 * unpause runs first, and so no project, no tab and no send.
 */
async function assertRefusedBeforeOrca(box, result, before) {
  assert.notEqual(result.code, 0, `this should have been refused, got:\n${result.stdout}${result.stderr}`);
  const said = result.stdout + result.stderr;
  assert.notEqual(said.trim(), '', 'a refusal with nothing said is no use to anybody');
  assert.ok(!/^\s+at /m.test(said), `expected a message, got a crash:\n${said}`);
  const asked = (await box.orca.calls()).slice(before.calls).filter((call) => orcaCommand(call) !== 'status');
  assert.deepEqual(asked.map((call) => call.args.join(' ')), [], `Orca should have been asked nothing but status; the run said:\n${said}`);
  assert.deepEqual(await box.orca.terminals(), before.terminals, 'no tab was opened or changed');
  assert.deepEqual(await box.orca.setups(), before.setups, 'no project was made or changed');
  return said;
}

const up = (box, options) => box.run(['up', '--bots', 'bots', '--bot', BOT], options);

// ----------------------------------------------------------------- pi cannot be run

test('R10 up refuses when pi is not on PATH, and opens no tab', async (t) => {
  // Every run of the kit here, the setup too, has a PATH with no pi on it.
  const box = await createSandbox(t);
  const env = await envWithoutPi(box);
  const where = await sh('command -v pi', { env });
  assert.notEqual(where.code, 0, `the test's PATH must hold no pi at all, found: ${where.stdout}`);
  await withPiSession(box, [], { env });
  const before = await orcaNow(box);

  const said = await assertRefusedBeforeOrca(box, await up(box, { env }), before);

  assert.match(said, /\bpi\b/i, `the refusal should name Pi, got:\n${said}`);
});

test('R10 up refuses when pi --version fails, and opens no tab', async (t) => {
  const box = await createSandbox(t);
  await fakePi(box, { version: 'fails' });
  await withPiSession(box);
  const before = await orcaNow(box);

  const said = await assertRefusedBeforeOrca(box, await up(box), before);

  assert.match(said, /\bpi\b/i, `the refusal should name Pi, got:\n${said}`);
});

// ----------------------------------------------------------------- nobody signed in

test('R10 up refuses when pi --list-models says No models available, and tells the user to sign in to Pi', async (t) => {
  const box = await createSandbox(t);
  const pi = await fakePi(box, { signedIn: false });
  await withPiSession(box);
  const before = await orcaNow(box);

  const said = await assertRefusedBeforeOrca(box, await up(box), before);

  assert.match(said, /\bPi\b/, `the refusal should name Pi, got:\n${said}`);
  assert.match(said, /sign in/i, `and tell the user to sign in to Pi, got:\n${said}`);
  assert.ok((await pi.calls()).some((call) => call.args.includes('--list-models')), 'it asked Pi which models it has');
  assert.equal((await pi.launches()).length, 0, 'and started no Pi session');
});

// ----------------------------------------------------------------- the session's model

test('R10 up refuses a session whose model pi --list-models <model> does not match, and names the model', async (t) => {
  const box = await createSandbox(t);
  const pi = await fakePi(box);
  await withPiSession(box, ['--model', 'nosuch/model-x']);
  const before = await orcaNow(box);

  const said = await assertRefusedBeforeOrca(box, await up(box), before);

  assert.ok(said.includes('nosuch/model-x'), `the refusal should name the model, got:\n${said}`);
  assert.ok((await pi.searches()).includes('nosuch/model-x'), `it asked Pi for that model, got: ${JSON.stringify(await pi.searches())}`);
});

test('R10 a session whose model Pi has goes up', async (t) => {
  const box = await createSandbox(t);
  const pi = await fakePi(box);
  await withPiSession(box, ['--model', 'anthropic/claude-opus-5-5']);

  const result = await up(box);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.ok((await pi.searches()).includes('anthropic/claude-opus-5-5'), `it asked Pi for the model, got: ${JSON.stringify(await pi.searches())}`);
});

for (const level of ['high', 'off']) {
  test(`R10 a model written with :${level} is looked up without the suffix, and goes up`, async (t) => {
    const box = await createSandbox(t);
    const pi = await fakePi(box);
    await withPiSession(box, ['--model', `anthropic/claude-opus-5-5:${level}`]);

    const result = await up(box);

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    const searches = (await pi.searches()).filter((search) => search !== undefined);
    assert.ok(searches.includes('anthropic/claude-opus-5-5'), `the search leaves the level off, got: ${JSON.stringify(searches)}`);
    assert.ok(!searches.includes(`anthropic/claude-opus-5-5:${level}`), `and never searches with it, got: ${JSON.stringify(searches)}`);
  });
}

test('R10 a model whose :suffix is not one of Pi\'s levels is looked up whole', async (t) => {
  // `ollama/llama3:8b` is a model's own name; `8b` is no thinking level.
  const box = await createSandbox(t);
  const pi = await fakePi(box);
  await withPiSession(box, ['--model', 'ollama/llama3:8b']);

  const result = await up(box);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  const searches = (await pi.searches()).filter((search) => search !== undefined);
  assert.ok(searches.includes('ollama/llama3:8b'), `got: ${JSON.stringify(searches)}`);
  assert.ok(!searches.includes('ollama/llama3'), `the name is not cut, got: ${JSON.stringify(searches)}`);
});

test('R10 a session with a level suffix on a model Pi does not have is refused, naming the model', async (t) => {
  const box = await createSandbox(t);
  await fakePi(box);
  await withPiSession(box, ['--model', 'nosuch/model-x:high']);
  const before = await orcaNow(box);

  const said = await assertRefusedBeforeOrca(box, await up(box), before);

  assert.ok(said.includes('nosuch/model-x'), `the refusal should name the model, got:\n${said}`);
});

// ----------------------------------------------------------------- restart and unpause

test('R10 restart refuses as up does when pi --version fails, and opens no tab', async (t) => {
  // A session that has never had a tab is started fresh by a restart (test/restart.test.js, R8).
  const box = await createSandbox(t);
  await fakePi(box, { version: 'fails' });
  await withPiSession(box);
  const before = await orcaNow(box);

  const said = await assertRefusedBeforeOrca(box, await box.run(['restart', '--bots', 'bots', '--bot', BOT]), before);

  assert.match(said, /\bpi\b/i, `the refusal should name Pi, got:\n${said}`);
});

test('R10 unpause refuses as up does when nobody is signed in to Pi, and opens no tab', async (t) => {
  const box = await createSandbox(t);
  const pi = await fakePi(box);
  await withPiSession(box);
  const paused = await box.run(['pause', '--bots', 'bots', '--bot', BOT]);
  assert.equal(paused.code, 0, `the pause this test stands on did not happen: ${paused.stdout}${paused.stderr}`);
  await pi.set({ signedIn: false });
  const before = await orcaNow(box);

  const said = await assertRefusedBeforeOrca(box, await box.run(['unpause', '--bots', 'bots', '--bot', BOT]), before);

  assert.match(said, /sign in/i, `the refusal should tell the user to sign in to Pi, got:\n${said}`);
});

// ----------------------------------------------------------------- no Pi session, no pi

test('R10 a fleet with no Pi session never runs pi', async (t) => {
  // The fake is there to be run, and writes down every run.
  const box = await createSandbox(t);
  const pi = await fakePi(box);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  for (const [bot, harness] of [['api-bot', 'claude'], ['web-bot', 'codex']]) {
    assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness])).code, 0);
    assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', 'daily', '--prompt', PROMPT])).code, 0);
  }

  const result = await box.run(['up', '--bots', 'bots']);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.deepEqual(await pi.calls(), [], 'pi was never run');
});
