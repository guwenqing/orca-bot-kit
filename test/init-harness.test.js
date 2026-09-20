// `--harness` on `init`: which harness Bot Father runs. There is no default and
// no question to answer — the caller is an LLM running a setup step, which asks
// the user once and passes the flag. The answer is kept in bot.yaml, and it is
// kept forever: a later run that says something else is refused, not obeyed.

import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import {
  assertCleanFailure,
  assertSeededBotsFolder,
  createSandbox,
  orcaCallsOf,
  skipGit,
  snapshot,
} from './helpers/cli.js';

/** The message must leave the caller able to fix the call, so it names both choices. */
function assertNamesBothHarnesses(stderr) {
  assert.ok(stderr.includes('claude'), `should name claude, got: ${stderr}`);
  assert.ok(stderr.includes('codex'), `should name codex, got: ${stderr}`);
}

test('init without --harness fails, names both choices, and creates nothing', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['init', '--bots', 'bots']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('--harness'), `should name --harness, got: ${result.stderr}`);
  assertNamesBothHarnesses(result.stderr);
  assert.deepEqual(await readdir(box.cwd), []);
  assert.deepEqual(orcaCallsOf(await box.orca.calls(), 'repo add'), []);
});

for (const [label, value] of [
  ['an unknown harness', 'gemini'],
  ['an empty harness', ''],
  ['a harness that is only whitespace', ' '],
  ['a harness in the wrong case', 'Claude'],
  ['a harness with a flag glued to it', 'claude --dangerously-skip-permissions'],
]) {
  test(`init with ${label} fails, names both choices, and creates nothing`, async (t) => {
    const box = await createSandbox(t);

    const result = await box.run(['init', '--bots', 'bots', '--harness', value]);

    assertCleanFailure(result);
    assertNamesBothHarnesses(result.stderr);
    assert.deepEqual(await readdir(box.cwd), [], 'a refused harness must write nothing');
    assert.deepEqual(await box.orca.terminals(), [], 'a refused harness must create no tab');
    assert.deepEqual(await box.orca.setups(), [], 'a refused harness must create no workspace');
  });
}

test('init --harness with nothing after it fails and creates nothing', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['init', '--bots', 'bots', '--harness']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('--harness'), `should name --harness, got: ${result.stderr}`);
  assert.deepEqual(await readdir(box.cwd), []);
});

for (const harness of ['claude', 'codex']) {
  test(`init --harness ${harness} records it in bot.yaml`, async (t) => {
    const box = await createSandbox(t);

    const result = await box.run(['init', '--bots', 'bots', '--harness', harness]);

    assert.equal(result.code, 0, result.stderr);
    await assertSeededBotsFolder(box.path('bots'), harness);
    const botFather = parse(await readFile(box.path('bots', 'bots', 'bot-father', 'bot.yaml'), 'utf8'));
    assert.equal(botFather.harness, harness);
  });
}

test('a second init with the same harness is fine and rewrites nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'codex'])).code, 0);
  const before = await snapshot(bots, skipGit);

  const second = await box.run(['init', '--bots', 'bots', '--harness', 'codex']);

  assert.equal(second.code, 0, second.stderr);
  assert.deepEqual(await snapshot(bots, skipGit), before);
});

test('a second init with the other harness is refused and rewrites nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);

  // The tabs are gone, so a run that got as far as the Orca work would create
  // them again: this proves the refusal comes before anything is done.
  await box.orca.set({ terminals: [] });
  const before = await snapshot(bots, skipGit);

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'codex']);

  assertCleanFailure(result);
  assertNamesBothHarnesses(result.stderr);
  assert.deepEqual(await snapshot(bots, skipGit), before, 'bot.yaml and the rest must be untouched');
  assert.equal(
    parse(await readFile(path.join(bots, 'bots', 'bot-father', 'bot.yaml'), 'utf8')).harness,
    'claude',
  );
  assert.deepEqual(await box.orca.terminals(), [], 'a refused init must create no tab');
});

test('a bot.yaml the user wrote by hand decides the harness', async (t) => {
  // The file is the record, not something the kit remembers elsewhere.
  const box = await createSandbox(t);
  const bots = box.path('bots');
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);

  const botFather = path.join(bots, 'bots', 'bot-father', 'bot.yaml');
  const edited = 'name: bot-father\nharness: codex\ncharter: mine\nrules: []\nskills: []\nsessions: []\n';
  await writeFile(botFather, edited);

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assertCleanFailure(result);
  assert.equal(await readFile(botFather, 'utf8'), edited, 'the file must not be rewritten');
});
