// `obk session add` adds one session to a bot's `bot.yaml`, with the settings
// PRD 6.4 gives a session: harness, model, effort, context, approval level,
// start prompt, work dir and extra args.
//
// Three rules run through all of it:
//
//   - the approval level is always written, and it is `auto` unless the user
//     asked for another one in plain words (ADR 0015);
//   - every other setting is written only when it was given, because absent
//     means the harness's own default and the kit hardcodes no model id;
//   - the rest of the file is the user's: every value they wrote and every
//     comment survives, whatever the YAML library does about layout.
//
// Like `bot create`, it writes a file and nothing else: no tab, no Orca.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import {
  assertCleanFailure,
  assertKeptWhatTheyWrote,
  assertNoTrailingSpace,
  botHomeOf,
  createSandbox,
  skipGit,
  snapshot,
} from './helpers/cli.js';

/** A bots folder with one bot in it beside Bot Father, ready for sessions. */
async function withBot(box, { harness = 'claude', bot = 'api-bot' } = {}) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness]);
  assert.equal(made.code, 0, made.stderr);
  return box.path('bots');
}

const botFile = (bots, bot = 'api-bot') => path.join(botHomeOf(bots, bot), 'bot.yaml');

/** The sessions a bot.yaml holds, as they were written. */
async function sessionsOf(bots, bot = 'api-bot') {
  return parse(await readFile(botFile(bots, bot), 'utf8')).sessions ?? [];
}

/** One session by name, and a clear failure when the bot has no such session. */
async function sessionOf(bots, name, bot = 'api-bot') {
  const sessions = await sessionsOf(bots, bot);
  const found = sessions.filter((session) => session?.name === name);
  assert.equal(found.length, 1, `one session should be called ${name}, got: ${JSON.stringify(sessions)}`);
  return found[0];
}

test('a session with nothing said about it is a name and the default approval level', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const calls = (await box.orca.calls()).length;

  const result = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily']);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  // Nothing else is written: absent is the harness's own default, and a model
  // id the kit chose would be one the user never asked for.
  assert.deepEqual(await sessionOf(bots, 'daily'), { name: 'daily', approval: 'auto' });
  assert.equal((await box.orca.calls()).length, calls, 'session add must not talk to Orca at all');
});

test('every setting given is written down, and nothing else is', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { harness: 'codex' });

  const result = await box.run([
    'session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily',
    '--harness', 'claude',
    '--model', 'sonnet',
    '--effort', 'high',
    '--context', '1m',
    '--approval', 'ask',
    '--prompt', 'You keep the API bot\'s day running.',
    '--work-dir', 'work/api',
    '--extra-arg=--verbose',
    '--extra-arg=--debug',
  ]);

  assert.equal(result.code, 0, result.stderr);
  const session = await sessionOf(bots, 'daily');
  assert.deepEqual(
    Object.keys(session).sort(),
    ['approval', 'context', 'effort', 'extra_args', 'harness', 'model', 'name', 'prompt', 'work_dir'],
  );
  assert.equal(session.name, 'daily');
  assert.equal(session.harness, 'claude', 'the harness is per session, and this one is not the bot\'s');
  assert.equal(session.model, 'sonnet');
  assert.equal(session.effort, 'high');
  assert.equal(String(session.context), '1m');
  assert.equal(session.approval, 'ask');
  assert.equal(session.prompt.trim(), 'You keep the API bot\'s day running.');
  assert.equal(session.work_dir, 'work/api');
  assert.deepEqual(session.extra_args, ['--verbose', '--debug'], 'every --extra-arg, in the order they were given');
});

test('a context is written as it was given', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { harness: 'codex' });

  assert.equal((await box.run([
    'session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily', '--context', '200000',
  ])).code, 0);

  assert.equal(String((await sessionOf(bots, 'daily')).context), '200000');
});

for (const approval of ['auto', 'ask', 'dangerously-skip']) {
  test(`--approval ${approval} is written down as it was asked for`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);

    const result = await box.run([
      'session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily', '--approval', approval,
    ]);

    assert.equal(result.code, 0, result.stderr);
    assert.equal((await sessionOf(bots, 'daily')).approval, approval);
  });
}

test('dangerously-skip is never reached by any other road', async (t) => {
  // ADR 0015: the dangerous level is written only when the user asked for it in
  // those words. Nothing a user can leave out may land on it.
  const box = await createSandbox(t);
  const bots = await withBot(box);

  for (const [name, args] of [
    ['plain', []],
    ['with a model', ['--model', 'sonnet']],
    ['with an effort', ['--effort', 'high']],
    ['with extras', ['--extra-arg=--verbose']],
  ]) {
    assert.equal(
      (await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', name, ...args])).code,
      0,
    );
    assert.equal((await sessionOf(bots, name)).approval, 'auto', `${name} should have taken the default`);
  }
});

test('an approval level the kit does not know is refused, and the three are named', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const before = await snapshot(bots, skipGit);

  const result = await box.run([
    'session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily', '--approval', 'yolo',
  ]);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('yolo'), `should name what it got, got: ${result.stderr}`);
  for (const level of ['auto', 'ask', 'dangerously-skip']) {
    assert.ok(result.stderr.includes(level), `the reader has to be told the levels; ${level} is missing: ${result.stderr}`);
  }
  assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
});

test('a context on a Claude session with no model is refused, because there is nothing to put it on', async (t) => {
  // On Claude the context window is a suffix on the model (`sonnet[1m]`), so a
  // context without a model could not be passed to the harness at all.
  const box = await createSandbox(t);
  const bots = await withBot(box, { harness: 'claude' });
  const before = await snapshot(bots, skipGit);

  const result = await box.run([
    'session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily', '--context', '1m',
  ]);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('--model'), `should say what is missing, got: ${result.stderr}`);
  assert.deepEqual(await snapshot(bots, skipGit), before);
});

// Codex takes `-c model_context_window=<number>`, and a whole number is a
// whole number all the way through. `1m` is the Claude form, and copying a
// session from a Claude bot is the ordinary way to make a second one; `x200000`
// is the same number with a finger slip in front of it. Either way Codex
// starts, says `invalid type: string "…", expected i64` and exits.
for (const context of ['1m', 'x200000']) {
  test(`a Codex context of ${context} is refused, because Codex counts tokens`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, { harness: 'codex' });
    const before = await snapshot(bots, skipGit);

    const result = await box.run([
      'session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily', '--context', context,
    ]);

    assertCleanFailure(result);
    assert.ok(result.stderr.includes(context), `should name what it got, got: ${result.stderr}`);
    assert.ok(result.stderr.includes('context'), `should name the setting, got: ${result.stderr}`);
    assert.deepEqual(await snapshot(bots, skipGit), before);
  });
}

test('it is the session\'s own harness that decides, not the bot\'s', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { harness: 'codex' });

  // A Codex bot, so a context with no model is fine — until the session says
  // it runs on Claude.
  const onCodex = await box.run([
    'session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'codex-one', '--context', '200000',
  ]);
  const onClaude = await box.run([
    'session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'claude-one',
    '--harness', 'claude', '--context', '1m',
  ]);

  assert.equal(onCodex.code, 0, onCodex.stderr);
  assertCleanFailure(onClaude);
  assert.deepEqual((await sessionsOf(bots)).map((session) => session.name), ['codex-one']);
});

test('a Claude session with a model takes its context', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { harness: 'claude' });

  const result = await box.run([
    'session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily', '--model', 'sonnet', '--context', '1m',
  ]);

  assert.equal(result.code, 0, result.stderr);
  const session = await sessionOf(bots, 'daily');
  assert.equal(session.model, 'sonnet');
  assert.equal(String(session.context), '1m');
});

test('a prompt of several lines is kept as the user wrote it', async (t) => {
  // A start prompt is normally a few lines. Folding them into one would change
  // what the session is told, and nobody asked for that.
  const box = await createSandbox(t);
  const bots = await withBot(box);

  const result = await box.run([
    'session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily',
    '--prompt', 'You keep the day running.\n\nStart by reading AGENTS.md.',
  ]);

  assert.equal(result.code, 0, result.stderr);
  assert.equal((await sessionOf(bots, 'daily')).prompt.trim(), 'You keep the day running.\n\nStart by reading AGENTS.md.');
});

test('a work dir may be relative to the bot home or absolute', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const elsewhere = path.join(box.root, 'clones', 'api');

  assert.equal((await box.run([
    'session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'near', '--work-dir', 'work/api',
  ])).code, 0);
  assert.equal((await box.run([
    'session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'far', '--work-dir', elsewhere,
  ])).code, 0);

  assert.equal((await sessionOf(bots, 'near')).work_dir, 'work/api', 'written as the user wrote it');
  assert.equal((await sessionOf(bots, 'far')).work_dir, elsewhere);
});

test('sessions pile up in the order they were added', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);

  for (const name of ['daily', 'review', 'watch']) {
    assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', name])).code, 0);
  }

  assert.deepEqual((await sessionsOf(bots)).map((session) => session.name), ['daily', 'review', 'watch']);
});

test('everything already in bot.yaml still says what the user wrote', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const mine = `# my own notes about this bot
name: api-bot
harness: codex
charter: |
  Mine, and unchanged.
notes: keep me            # a key the kit knows nothing about
rules: [my-rule]
skills: []
sessions:
  - name: mine
    approval: ask
`;
  await writeFile(botFile(bots), mine);

  const result = await box.run([
    'session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily', '--model', 'gpt-5.4',
  ]);

  assert.equal(result.code, 0, result.stderr);
  const after = await readFile(botFile(bots), 'utf8');
  assert.ok(
    after.includes('# a key the kit knows nothing about'),
    `the user's comment should have survived: ${after}`,
  );
  assertKeptWhatTheyWrote(mine, after, { changed: ['sessions'] });
  assertNoTrailingSpace(after);

  const parsed = parse(after);
  assert.equal(parsed.notes, 'keep me');
  assert.deepEqual(parsed.rules, ['my-rule']);
  assert.equal(parsed.charter, 'Mine, and unchanged.\n');
  assert.deepEqual(parsed.sessions, [
    { name: 'mine', approval: 'ask' },
    { name: 'daily', approval: 'auto', model: 'gpt-5.4' },
  ]);
});

test('a bot.yaml whose sessions list is empty gets its first session', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const mine = 'name: api-bot\nharness: claude\ncharter: mine\nrules: []\nskills: []\nsessions: []\n';
  await writeFile(botFile(bots), mine);

  const result = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily']);

  assert.equal(result.code, 0, result.stderr);
  const after = await readFile(botFile(bots), 'utf8');
  assertNoTrailingSpace(after);
  assert.deepEqual(parse(after).sessions, [{ name: 'daily', approval: 'auto' }]);
});

test('a session name the bot already has is refused, and nothing is written', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  assert.equal((await box.run([
    'session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily', '--model', 'sonnet',
  ])).code, 0);
  const before = await snapshot(bots, skipGit);

  const result = await box.run([
    'session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily', '--model', 'opus',
  ]);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('daily'), `the refusal should name the session, got: ${result.stderr}`);
  assert.deepEqual(await snapshot(bots, skipGit), before, 'the session that is there keeps its settings');
});

test('the same session name under another bot is fine', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'web-bot', '--harness', 'claude'])).code, 0);

  assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily'])).code, 0);
  const other = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'web-bot', '--name', 'daily']);

  assert.equal(other.code, 0, other.stderr);
  assert.deepEqual((await sessionsOf(bots, 'web-bot')).map((session) => session.name), ['daily']);
  assert.deepEqual((await sessionsOf(bots, 'api-bot')).map((session) => session.name), ['daily']);
});

test('a bot that is not there is refused, and nothing is written', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const before = await snapshot(bots, skipGit);
  const calls = (await box.orca.calls()).length;

  const result = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'ghost-bot', '--name', 'daily']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('ghost-bot'), `the refusal should name the bot, got: ${result.stderr}`);
  assert.deepEqual(await snapshot(bots, skipGit), before, 'a bot that is not there is not a bot to make');
  assert.equal((await box.orca.calls()).length, calls);
});

test('a bots folder init never made sends the user to obk init', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily']);

  assertCleanFailure(result);
  assert.match(result.stderr, /obk init/, `should send the user to init, got: ${result.stderr}`);
});

for (const [label, args] of [
  ['--bots', ['session', 'add', '--bot', 'api-bot', '--name', 'daily']],
  ['--bot', ['session', 'add', '--bots', 'bots', '--name', 'daily']],
  ['--name', ['session', 'add', '--bots', 'bots', '--bot', 'api-bot']],
]) {
  test(`session add without ${label} fails and says which one`, async (t) => {
    const box = await createSandbox(t);
    await withBot(box);

    const result = await box.run(args);

    assertCleanFailure(result);
    assert.ok(result.stderr.includes(label), `should name ${label}, got: ${result.stderr}`);
  });
}

test('session add with an extra argument fails and names it', async (t) => {
  const box = await createSandbox(t);
  await withBot(box);

  const result = await box.run(['session', 'add', 'stray', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('stray'), `should name the argument, got: ${result.stderr}`);
});

test('a harness the kit does not know is refused and named', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const before = await snapshot(bots, skipGit);

  const result = await box.run([
    'session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily', '--harness', 'gemini',
  ]);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('gemini'), `should name what it got, got: ${result.stderr}`);
  assert.deepEqual(await snapshot(bots, skipGit), before);
});

test('session add says what it wrote, and --json says the same', async (t) => {
  const box = await createSandbox(t);
  await withBot(box);

  const plain = await box.run([
    'session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily', '--model', 'sonnet',
  ]);

  assert.equal(plain.code, 0, plain.stderr);
  for (const fact of ['api-bot', 'daily', 'sonnet', 'auto']) {
    assert.ok(plain.stdout.includes(fact), `the report should say ${fact}, got: ${plain.stdout}`);
  }
  assert.ok(!plain.stdout.includes('undefined'), `nothing should be undefined, got: ${plain.stdout}`);

  const other = await createSandbox(t);
  await withBot(other);
  const asJson = await other.run([
    'session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily', '--model', 'sonnet', '--json',
  ]);

  assert.equal(asJson.code, 0, asJson.stderr);
  let answer;
  try {
    answer = JSON.parse(asJson.stdout);
  } catch (error) {
    assert.fail(`--json should print JSON and nothing else, got: ${asJson.stdout} (${error.message})`);
  }
  const facts = JSON.stringify(answer);
  for (const fact of ['api-bot', 'daily', 'sonnet', 'auto']) {
    assert.ok(facts.includes(fact), `the answer should carry ${fact}, got: ${facts}`);
  }
});
