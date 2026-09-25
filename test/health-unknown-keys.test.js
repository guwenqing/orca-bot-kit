// `obk health` names a key in a bot's `bot.yaml` the kit does not know (#273).
//
// A hand edit with a typo in it (`efort: high`, `aproval: ask`) is dropped
// without a word today, and the session runs on the harness's own default while
// the user believes the setting is in force. Health names every such key, at the
// top of a bot's file and in a session entry: kind 'config', `bot` the bot's
// name, `where` that bot's bot.yaml, and `says` naming the key, and for a
// session key the session too. The wording of `says` is the implementer's and is
// not pinned; what is pinned is that it names those things.
//
// The keys the kit knows. At the top of bot.yaml: name, harness, charter, rules,
// skills, sessions, paused. In a session entry: name, harness, model, effort,
// context, approval, prompt, prompt_file, work_dir, extra_args, paused. Anything
// else is unknown.
//
// And the boundary: the kit does not refuse to start a bot over an unknown key,
// and does not rewrite the user's file.
//
// None of the typos used here is a substring of a key the kit knows (`efort` is
// not in `effort`, `aproval` is not in `approval`), so a finding that names the
// real key does not pass for one that names the typo.
//
// Everything goes through the CLI on a sandboxed bots folder, against the fake
// Orca, the way test/health.test.js does.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import { botHomeOf, createSandbox, sessionIn } from './helpers/cli.js';
import { botYamlOf } from './helpers/skills.js';

// ----------------------------------------------------------------- the fleet

/** A bots folder with Bot Father up in Orca. */
async function seeded(box) {
  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(result.code, 0, result.stderr);
  return box.path('bots');
}

/** One more bot with its sessions, added through the kit and brought up in Orca. */
async function botUp(box, name, sessions = [['daily']]) {
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', name, '--harness', 'claude']);
  assert.equal(made.code, 0, made.stderr);
  for (const [session, ...settings] of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', name, '--name', session, ...settings]);
    assert.equal(added.code, 0, added.stderr);
  }
  const up = await box.run(['up', '--bots', 'bots', '--bot', name]);
  assert.equal(up.code, 0, up.stderr);
  return botHomeOf(box.path('bots'), name);
}

/** Change one bot's `bot.yaml`, which is the user's file and theirs to edit. */
async function editBotYaml(bots, bot, change) {
  const file = botYamlOf(bots, bot);
  const doc = parse(await readFile(file, 'utf8')) ?? {};
  await writeFile(file, stringify(change(doc) ?? doc));
}

/** The session entry called `name` in a parsed bot.yaml, written as a mapping. */
function entry(doc, name) {
  const found = doc.sessions.find((one) => typeof one === 'object' && one?.name === name);
  assert.ok(found !== undefined, `bot.yaml should hold a session ${name}, got: ${JSON.stringify(doc.sessions)}`);
  return found;
}

// ---------------------------------------------------------------- the health check

/** Run the health check for JSON: findings, and exit 1 when there are any, 0 when none. */
async function found(box, ...rest) {
  const result = await box.run(['health', '--bots', 'bots', ...rest, '--json']);
  assert.equal(result.stderr, '', `a health run reports on stdout, and put this on stderr: ${result.stderr}`);
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  assert.ok(Array.isArray(answer.found), `the answer should carry a list of findings, got: ${result.stdout}`);
  assert.equal(result.code, answer.found.length === 0 ? 0 : 1, `exit code for ${answer.found.length} findings`);
  return answer;
}

/** The findings of one kind, or about one bot, or both. */
const of = (answer, { kind, bot } = {}) => answer.found.filter((one) => (
  (kind === undefined || one.kind === kind) && (bot === undefined || one.bot === bot)
));

/** The findings that name `what` in the sentence a reader is given. */
const saying = (findings, what) => findings.filter((one) => typeof one.says === 'string' && one.says.includes(what));

const show = (value) => JSON.stringify(value, null, 2);

/**
 * The one finding in the whole answer that names `key`, and it is the finding
 * the requirement describes: a config finding about `bot`, pointing at that
 * bot's bot.yaml, saying the key (and the session, when there is one).
 */
function theFinding(answer, bots, { bot, key, session }) {
  const said = saying(answer.found, key);
  assert.equal(said.length, 1, `one finding should name the key ${key}, got: ${show(answer.found)}`);
  const [finding] = said;
  assert.equal(finding.kind, 'config', `an unknown key is a finding about configuration, got: ${show(finding)}`);
  assert.equal(finding.bot, bot, `the finding is about the bot whose file holds the key, got: ${show(finding)}`);
  assert.equal(finding.where, botYamlOf(bots, bot), `the finding points at the file to open, got: ${show(finding)}`);
  if (session !== undefined) {
    assert.ok(finding.says.includes(session), `the finding names the session the key is written in (${session}), got: ${show(finding)}`);
  }
  return finding;
}

// ---------------------------------------------------------------------------
// Acceptance criterion 1: a session with `efort: high`.
// ---------------------------------------------------------------------------

test('AC1 a session with efort: high gives exactly one config finding naming the bot.yaml, the session and the key', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', [['nightly']]);
  await editBotYaml(bots, 'api-bot', (doc) => { entry(doc, 'nightly').efort = 'high'; });

  const answer = await found(box);

  theFinding(answer, bots, { bot: 'api-bot', key: 'efort', session: 'nightly' });
});

test('AC1 the plain report names the key, the session and the file, and exits 1', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', [['nightly']]);
  await editBotYaml(bots, 'api-bot', (doc) => { entry(doc, 'nightly').efort = 'high'; });

  const result = await box.run(['health', '--bots', 'bots']);

  assert.equal(result.code, 1, `a health run that found something exits 1, got ${result.code}: ${result.stdout}${result.stderr}`);
  for (const what of ['efort', 'nightly', botYamlOf(bots, 'api-bot')]) {
    assert.ok(result.stdout.includes(what), `the report a person reads should name ${what}, got:\n${result.stdout}`);
  }
});

// ---------------------------------------------------------------------------
// Acceptance criterion 2: a file with only known keys.
// ---------------------------------------------------------------------------

test('AC2 a bot.yaml the kit wrote, with only known keys, gives no config finding; one typo in it gives one', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', [['nightly']]);
  // Round-tripped through the same edit the other cases use, so the only thing
  // the contrast below changes is the key.
  await editBotYaml(bots, 'api-bot', () => undefined);

  const clean = await found(box);
  assert.deepEqual(of(clean, { kind: 'config', bot: 'api-bot' }), [], `a file with only known keys has nothing to report, got: ${show(clean.found)}`);

  await editBotYaml(bots, 'api-bot', (doc) => { entry(doc, 'nightly').efort = 'high'; });
  const typo = await found(box);
  theFinding(typo, bots, { bot: 'api-bot', key: 'efort', session: 'nightly' });
});

test('AC2 every key the kit knows, at the top and in sessions, gives no config finding', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude']);
  assert.equal(made.code, 0, made.stderr);
  const home = botHomeOf(bots, 'api-bot');
  await writeFile(path.join(home, 'duty.md'), 'Do the nightly run.\n');
  // Through the kit, so every value is one the kit takes.
  for (const settings of [
    ['--name', 'nightly', '--harness', 'claude', '--model', 'opus', '--effort', 'high', '--context', '1m',
      '--approval', 'ask', '--prompt-file', 'duty.md', '--work-dir', bots, '--extra-arg=--verbose'],
    ['--name', 'brief', '--harness', 'claude', '--prompt', 'Say what changed.'],
  ]) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', ...settings]);
    assert.equal(added.code, 0, added.stderr);
  }
  // `paused` at both levels, the one known key the commands above do not write.
  await editBotYaml(bots, 'api-bot', (doc) => {
    doc.paused = false;
    entry(doc, 'nightly').paused = false;
    entry(doc, 'brief').paused = false;
    return doc;
  });
  const written = parse(await readFile(botYamlOf(bots, 'api-bot'), 'utf8'));
  assert.deepEqual(
    Object.keys(written).sort(),
    ['charter', 'harness', 'name', 'paused', 'rules', 'sessions', 'skills'],
    'the file under test holds every top-level key the kit knows',
  );
  assert.deepEqual(
    [...new Set(written.sessions.flatMap((one) => Object.keys(one)))].sort(),
    ['approval', 'context', 'effort', 'extra_args', 'harness', 'model', 'name', 'paused', 'prompt', 'prompt_file', 'work_dir'],
    'and between its sessions every session key the kit knows',
  );
  const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);
  assert.equal(up.code, 0, up.stderr);

  const clean = await found(box);
  assert.deepEqual(of(clean, { kind: 'config', bot: 'api-bot' }), [], `every key here is one the kit knows, got: ${show(clean.found)}`);

  await editBotYaml(bots, 'api-bot', (doc) => { entry(doc, 'brief').aproval = 'ask'; });
  const typo = await found(box);
  theFinding(typo, bots, { bot: 'api-bot', key: 'aproval', session: 'brief' });
});

// ---------------------------------------------------------------------------
// The cases the requirement implies.
// ---------------------------------------------------------------------------

test('an unknown key at the top of bot.yaml gives one config finding naming the file and the key', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', [['nightly']]);
  await editBotYaml(bots, 'api-bot', (doc) => { doc.skils = ['obk-tdd']; });

  const answer = await found(box);

  theFinding(answer, bots, { bot: 'api-bot', key: 'skils' });
});

test('two sessions with an unknown key each give their own finding, naming the right session', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', [['nightly'], ['weekly']]);
  await editBotYaml(bots, 'api-bot', (doc) => {
    entry(doc, 'nightly').efort = 'high';
    entry(doc, 'weekly').aproval = 'ask';
  });

  const answer = await found(box);

  const efort = theFinding(answer, bots, { bot: 'api-bot', key: 'efort', session: 'nightly' });
  const aproval = theFinding(answer, bots, { bot: 'api-bot', key: 'aproval', session: 'weekly' });
  assert.ok(!efort.says.includes('weekly'), `the efort finding is about nightly, not weekly, got: ${show(efort)}`);
  assert.ok(!aproval.says.includes('nightly'), `the aproval finding is about weekly, not nightly, got: ${show(aproval)}`);
});

test('two unknown keys in one session are both named, with that session', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', [['nightly']]);
  await editBotYaml(bots, 'api-bot', (doc) => {
    Object.assign(entry(doc, 'nightly'), { efort: 'high', aproval: 'ask' });
  });

  const answer = await found(box);

  // One finding per key or one naming both is the implementer's call; what is
  // pinned is that neither key goes unnamed.
  for (const key of ['efort', 'aproval']) {
    const said = saying(of(answer, { kind: 'config', bot: 'api-bot' }), key);
    assert.ok(said.length >= 1, `a config finding about api-bot should name ${key}, got: ${show(answer.found)}`);
    for (const finding of said) {
      assert.equal(finding.where, botYamlOf(bots, 'api-bot'), `the finding points at the file to open, got: ${show(finding)}`);
      assert.ok(finding.says.includes('nightly'), `the finding names the session, got: ${show(finding)}`);
    }
  }
});

test('a session written as a bare name has no keys and gives nothing, beside one that has a typo', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', [['nightly'], ['weekly']]);
  await editBotYaml(bots, 'api-bot', (doc) => {
    doc.sessions = ['nightly', { ...entry(doc, 'weekly'), efort: 'high' }];
  });
  const text = await readFile(botYamlOf(bots, 'api-bot'), 'utf8');
  assert.match(text, /^\s*- nightly\s*$/m, `nightly should be written as a bare name, got:\n${text}`);

  const answer = await found(box);

  theFinding(answer, bots, { bot: 'api-bot', key: 'efort', session: 'weekly' });
  const config = of(answer, { kind: 'config', bot: 'api-bot' });
  assert.deepEqual(saying(config, 'nightly'), [], `a bare-name session has nothing unknown in it, got: ${show(config)}`);
});

test('only the bot whose file has the unknown key is reported, not the others', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', [['nightly']]);
  await botUp(box, 'web-bot', [['nightly']]);
  await editBotYaml(bots, 'api-bot', (doc) => { entry(doc, 'nightly').efort = 'high'; });
  // web-bot's file goes through the same edit with nothing changed in it.
  await editBotYaml(bots, 'web-bot', () => undefined);

  const answer = await found(box);

  theFinding(answer, bots, { bot: 'api-bot', key: 'efort', session: 'nightly' });
  assert.deepEqual(of(answer, { kind: 'config', bot: 'web-bot' }), [], `web-bot's file holds only known keys, got: ${show(answer.found)}`);
  assert.deepEqual(of(answer, { kind: 'config', bot: 'bot-father' }), [], `and so does Bot Father's, got: ${show(answer.found)}`);
  assert.ok(
    answer.found.every((one) => !one.where.includes(botYamlOf(bots, 'web-bot'))),
    `nothing points at web-bot's bot.yaml, got: ${show(answer.found)}`,
  );
});

test('--bot narrows the unknown-key finding as it does the other per-bot findings', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', [['nightly']]);
  await editBotYaml(bots, 'api-bot', (doc) => { entry(doc, 'nightly').efort = 'high'; });

  const asked = await found(box, '--bot', 'api-bot');
  theFinding(asked, bots, { bot: 'api-bot', key: 'efort', session: 'nightly' });

  const other = await found(box, '--bot', 'bot-father');
  assert.deepEqual(saying(other.found, 'efort'), [], `a run about Bot Father says nothing about api-bot's file, got: ${show(other.found)}`);
  assert.deepEqual(of(other, { bot: 'api-bot' }), [], `nor anything else about api-bot, got: ${show(other.found)}`);
});

// ---------------------------------------------------------------------------
// The boundary: report, never refuse and never rewrite.
// ---------------------------------------------------------------------------

/** A bot.yaml written by hand, comment and spacing and all, with a typo in a session. */
const HAND_WRITTEN = [
  '# Api Bot, written by hand.',
  '',
  'name: api-bot',
  'harness: claude',
  'charter: |',
  '  api-bot answers the API questions.',
  'rules: []',
  'skills: []',
  'sessions:',
  '  - name: nightly',
  '    approval: auto',
  '    efort:   high    # the typo',
  '',
].join('\n');

test('health leaves a bot.yaml with an unknown key exactly as the user wrote it', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude']);
  assert.equal(made.code, 0, made.stderr);
  await writeFile(botYamlOf(bots, 'api-bot'), HAND_WRITTEN);
  // Up after the edit, so AGENTS.md is built from this charter and the only
  // thing left to report about this file is the key.
  const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);
  assert.equal(up.code, 0, up.stderr);
  assert.equal(await readFile(botYamlOf(bots, 'api-bot'), 'utf8'), HAND_WRITTEN, 'the file is as written before health runs');

  const answer = await found(box);

  theFinding(answer, bots, { bot: 'api-bot', key: 'efort', session: 'nightly' });
  assert.equal(await readFile(botYamlOf(bots, 'api-bot'), 'utf8'), HAND_WRITTEN, 'health reports the key and does not touch the file');
});

// Describes existing behaviour: up already starts such a bot and leaves the file
// alone, so this passes before the change. It guards the boundary (#273: do not
// refuse, do not rewrite) against the change.
test('up still starts a bot whose bot.yaml has an unknown key, and leaves the file as written', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude']);
  assert.equal(made.code, 0, made.stderr);
  await writeFile(botYamlOf(bots, 'api-bot'), HAND_WRITTEN);

  const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);

  assert.equal(up.code, 0, `up does not refuse a bot over an unknown key, got: ${up.stderr}`);
  const nightly = await sessionIn(bots, 'api-bot', 'nightly');
  assert.equal(typeof nightly?.tab, 'string', `the session is open in a tab, got: ${show(nightly)}`);
  assert.equal(await readFile(botYamlOf(bots, 'api-bot'), 'utf8'), HAND_WRITTEN, 'up does not rewrite the user\'s file');
});
