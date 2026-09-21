// `obk rules build --bots <path> [--bot <bot>]` writes a bot's `AGENTS.md` from
// its charter and the rule units it carries (PRD 6.6, ADR 0003). It is the one
// place the kit's own text lands inside the user's repo, so the promise around
// it is narrow and worth pinning hard: the build owns a marked block and
// nothing else in the file, what the user wrote outside it comes back exactly,
// and a hand edit inside it stops the build rather than being overwritten.
//
// Everything here goes through the CLI on a sandboxed bots folder. The command
// writes files and never talks to Orca, so the fake Orca is only ever asked to
// prove it was not called.

import assert from 'node:assert/strict';
import { readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  assertCleanFailure,
  assertNoTrailingSpace,
  botHomeOf,
  createSandbox,
  skipGit,
  snapshot,
} from './helpers/cli.js';
import {
  addRules,
  agentsIn,
  agentsOf,
  answerOf,
  assertEntryFile,
  blockIn,
  botsIn,
  defaultUnits,
  dropKey,
  END_MARKER,
  entryOf,
  hasBlock,
  headingsIn,
  kitUnit,
  plainEntry,
  titleIn,
  underIn,
  unitText,
  writeUnit,
} from './helpers/rules.js';

/** A bots folder `init` made, with Bot Father in it. */
async function seeded(box) {
  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(result.code, 0, result.stderr);
  return box.path('bots');
}

/** One more bot, with a charter of its own. */
async function makeBot(box, name, charter = `${name} owns its own corner.`) {
  const result = await box.run([
    'bot', 'create', '--bots', 'bots', '--name', name, '--harness', 'claude', '--charter', charter,
  ]);
  assert.equal(result.code, 0, result.stderr);
}

/** `obk rules build`, with whatever else the test wants to say. */
const build = (box, ...rest) => box.run(['rules', 'build', '--bots', 'bots', ...rest]);

/** A build a test needs to have happened before the part it is about. */
async function buildOk(box, ...rest) {
  const result = await build(box, ...rest);
  assert.equal(result.code, 0, `the build should have gone through, got: ${result.stderr}`);
  return result;
}

/** The titles of the units every bot carries by default, in the order they belong in. */
const defaultTitles = async () => (await defaultUnits()).map((unit) => unit.title);

/** The names of those same units. */
const defaultNames = async () => (await defaultUnits()).map((unit) => unit.name);

/**
 * A rule change every bot in the folder feels. `bot create` writes a built
 * file of its own, so a bot nothing has happened to is already up to date; a
 * test that wants to watch a build happen changes a rule first.
 */
async function changeARule(box, bots, body = 'Say it in one line.') {
  await writeUnit(bots, 'house', unitText('The house style', body));
  await addRules(path.join(bots, 'defaults.yaml'), 'house');
}

/** A bot's `bot.yaml`. */
const botYamlOf = (bots, bot) => path.join(botHomeOf(bots, bot), 'bot.yaml');

test('a bot\'s AGENTS.md is built from its charter and the kit\'s default units', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot', 'Api Bot owns the API. Good is a green build. Ask before a release.');
  // What `rules build` writes, not what `bot create` left behind: the file it
  // finds has no block of the kit's in it at all.
  await writeFile(agentsOf(bots, 'api-bot'), 'Nothing here but this line.\n');

  const result = await build(box, '--bot', 'api-bot');

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');

  const block = blockIn(await agentsIn(bots, 'api-bot'));
  assert.equal(titleIn(block.body), 'Api Bot', 'the block opens with the bot\'s name');
  assert.equal(
    underIn(block.body, 'Charter'),
    'Api Bot owns the API. Good is a green build. Ask before a release.',
    `the charter from bot.yaml is a section of its own, got:\n${block.body}`,
  );
  assert.deepEqual(
    headingsIn(block.body),
    ['Charter', ...await defaultTitles()],
    'the charter, then every kit unit that applies to all bots, in name order',
  );
  for (const unit of await defaultUnits()) {
    assert.equal(underIn(block.body, unit.title), unit.body, `the body of ${unit.name} should be written out under its title`);
  }
  assertNoTrailingSpace(block.body);
});

test('a unit the kit keeps for code-writing bots is not carried unless it is asked for', async (t) => {
  // `applies: code` is the whole reason the frontmatter carries `applies`: a
  // bot that writes no code pays nothing for the units about writing it.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  const review = await kitUnit('review');

  await buildOk(box);

  const before = blockIn(await agentsIn(bots, 'api-bot')).body;
  assert.ok(!headingsIn(before).includes(review.title), `${review.name} should not be carried by default, got: ${headingsIn(before)}`);

  await addRules(botYamlOf(bots, 'api-bot'), `kit:${review.name}`);
  await buildOk(box);

  const after = blockIn(await agentsIn(bots, 'api-bot')).body;
  assert.deepEqual(headingsIn(after), ['Charter', ...await defaultTitles(), review.title]);
  assert.equal(underIn(after, review.title), review.body);
});

test('every bot is reported, in name order, and --json says the same', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'zebra-bot');
  await makeBot(box, 'api-bot');
  await changeARule(box, bots);

  const plain = await build(box);

  assert.equal(plain.code, 0, plain.stderr);
  const order = ['api-bot', 'bot-father', 'zebra-bot'];
  for (const bot of order) {
    const entry = plainEntry(plain.stdout, bot);
    assert.match(entry, /\bbuilt\b/, `${bot} should be reported as built, got: ${entry}`);
    assert.ok(entry.includes('AGENTS.md'), `the entry for ${bot} should name the file it is about, got: ${entry}`);
  }
  assert.deepEqual(
    order.slice().sort((one, other) => plain.stdout.indexOf(one) - plain.stdout.indexOf(other)),
    order,
    `the bots should be reported in name order, got:\n${plain.stdout}`,
  );

  const other = await createSandbox(t);
  await seeded(other);
  await makeBot(other, 'zebra-bot');
  await makeBot(other, 'api-bot');
  await changeARule(other, other.path('bots'));
  const asJson = await build(other, '--json');

  assert.equal(asJson.code, 0, asJson.stderr);
  const answer = answerOf(asJson);
  assert.deepEqual(botsIn(answer), order, 'the same bots, in the same order');
  for (const bot of order) {
    const entry = entryOf(answer, bot);
    assert.equal(entry.state, 'built');
    await assertEntryFile(entry, other, other.path('bots'), bot);
    assert.deepEqual(
      entry.units,
      [...await defaultNames(), 'house'],
      `${bot} should say what it carries, named in file order`,
    );
    assert.ok(!('trouble' in entry), `a bot that built has nothing to say about trouble, got: ${JSON.stringify(entry)}`);
  }
});

test('a unit the user rewrote is rebuilt into the file', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  await changeARule(box, bots);
  await buildOk(box, '--bot', 'api-bot');
  const before = blockIn(await agentsIn(bots, 'api-bot'));

  await writeUnit(bots, 'house', unitText('The house style', 'Say it in two lines, and stop.'));
  const result = await build(box, '--bot', 'api-bot', '--json');

  assert.equal(result.code, 0, result.stderr);
  assert.equal(entryOf(answerOf(result), 'api-bot').state, 'built', 'a changed unit is a rebuild, not an unchanged file');
  const after = blockIn(await agentsIn(bots, 'api-bot'));
  assert.equal(underIn(after.body, 'The house style'), 'Say it in two lines, and stop.');
  assert.notEqual(after.checksum, before.checksum, 'the checksum follows the block it is over');
});

test('a name added to defaults.yaml reaches every bot', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  await buildOk(box);

  await changeARule(box, bots);
  const result = await build(box, '--json');

  assert.equal(result.code, 0, result.stderr);
  const answer = answerOf(result);
  for (const bot of ['api-bot', 'bot-father']) {
    assert.equal(entryOf(answer, bot).state, 'built');
    const body = blockIn(await agentsIn(bots, bot)).body;
    assert.deepEqual(headingsIn(body), ['Charter', ...await defaultTitles(), 'The house style']);
    assert.deepEqual(entryOf(answer, bot).units, [...await defaultNames(), 'house']);
  }
});

test('a name added to a bot.yaml reaches that bot and no other', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  await writeUnit(bots, 'api-only', unitText('What the API bot alone is told', 'Version every endpoint.'));
  await addRules(botYamlOf(bots, 'api-bot'), 'api-only');

  await buildOk(box);

  assert.deepEqual(
    headingsIn(blockIn(await agentsIn(bots, 'api-bot')).body),
    ['Charter', ...await defaultTitles(), 'What the API bot alone is told'],
  );
  assert.deepEqual(
    headingsIn(blockIn(await agentsIn(bots, 'bot-father')).body),
    ['Charter', ...await defaultTitles()],
    'a bot\'s own list is its own',
  );
});

test('kit:<name> takes the kit\'s unit and a bare name the user\'s, spelled the same', async (t) => {
  // The prefix is the whole difference between the two shelves, so the case
  // that proves it is a user unit whose file is named after a kit one.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  const review = await kitUnit('review');
  await writeUnit(bots, review.name, unitText('How we review here', 'Two reviewers, one round.'));
  await addRules(path.join(bots, 'defaults.yaml'), `kit:${review.name}`, review.name);

  await buildOk(box, '--bot', 'api-bot');

  const body = blockIn(await agentsIn(bots, 'api-bot')).body;
  assert.deepEqual(
    headingsIn(body),
    ['Charter', ...await defaultTitles(), review.title, 'How we review here'],
    'both units are carried, in the order the list names them',
  );
  assert.equal(underIn(body, review.title), review.body, 'kit:<name> is the unit the package ships');
  assert.equal(underIn(body, 'How we review here'), 'Two reviewers, one round.', 'the bare name is the user\'s own file');
});

test('the lists are written in order, and a unit named twice is written once', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  const tests = await kitUnit('tests-first');
  await writeUnit(bots, 'house', unitText('The house style', 'Say it in one line.'));
  await writeUnit(bots, 'deploys', unitText('Deploys', 'Never on a Friday.'));
  // `house` is named in both lists, and in the bot's list it comes before a
  // unit nothing else names.
  await addRules(path.join(bots, 'defaults.yaml'), 'house', `kit:${tests.name}`);
  await addRules(botYamlOf(bots, 'api-bot'), 'house', 'deploys');

  const result = await build(box, '--bot', 'api-bot', '--json');

  assert.equal(result.code, 0, result.stderr);
  const body = blockIn(await agentsIn(bots, 'api-bot')).body;
  assert.deepEqual(
    headingsIn(body),
    ['Charter', ...await defaultTitles(), 'The house style', tests.title, 'Deploys'],
    'the kit\'s defaults, then defaults.yaml in the order written, then the bot\'s own',
  );
  assert.deepEqual(
    entryOf(answerOf(result), 'api-bot').units,
    [...await defaultNames(), 'house', tests.name, 'deploys'],
    'the units are named once each, in file order',
  );
});

test('what the user wrote outside the block comes back byte for byte', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  await changeARule(box, bots);
  await buildOk(box, '--bot', 'api-bot');

  const file = agentsOf(bots, 'api-bot');
  const built = await readFile(file, 'utf8');
  await writeFile(file, [
    '<!-- mine, above -->',
    '',
    built.trimEnd(),
    '',
    '## What I keep here',
    '',
    'My own notes.   ',
    'And a second line.',
    '',
  ].join('\n'));
  const was = blockIn(await readFile(file, 'utf8'));
  assert.notEqual(was.head.trim(), '', 'the test should have written something above the block');
  assert.notEqual(was.tail.trim(), '', 'and something below it');
  // A rule changes, so the build has real work to do rather than nothing.
  await writeUnit(bots, 'house', unitText('The house style', 'Say it in two lines, and stop.'));

  const result = await build(box, '--bot', 'api-bot');

  assert.equal(result.code, 0, result.stderr);
  const after = blockIn(await readFile(file, 'utf8'));
  assert.equal(after.head, was.head, 'everything above the begin marker is the user\'s');
  assert.equal(after.tail, was.tail, 'and so is everything below the end marker, whitespace and all');
  assert.equal(underIn(after.body, 'The house style'), 'Say it in two lines, and stop.', 'while the block itself was rebuilt');
});

test('a file with no block gets one at the top, and keeps what was already there', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  const file = agentsOf(bots, 'api-bot');
  const mine = '# Api Bot\n\nEverything I wrote before the kit ever built this.\n';
  await writeFile(file, mine);

  const result = await build(box, '--bot', 'api-bot');

  assert.equal(result.code, 0, result.stderr);
  const after = blockIn(await readFile(file, 'utf8'));
  assert.equal(after.head, '', 'the block goes at the top of a file that had none');
  assert.equal(after.tail.trim(), mine.trim(), `what was in the file is kept below the block, got: ${after.tail}`);
  assert.deepEqual(headingsIn(after.body), ['Charter', ...await defaultTitles()]);
});

test('a hand edit inside the block is a conflict: nothing is written, and the trouble says so', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  await makeBot(box, 'web-bot');
  await buildOk(box);

  const file = agentsOf(bots, 'api-bot');
  const built = await readFile(file, 'utf8');
  const edited = built.replace(END_MARKER, `A line I typed in myself.\n\n${END_MARKER}`);
  assert.ok(blockIn(edited).body.includes('A line I typed in myself.'), 'the test should have edited inside the block');
  await writeFile(file, edited);
  const before = await snapshot(bots, skipGit);

  const result = await build(box, '--json');

  assert.equal(result.code, 1, 'a run with a conflict in it ends in 1');
  const answer = answerOf(result);
  const entry = entryOf(answer, 'api-bot');
  assert.equal(entry.state, 'conflict');
  assert.equal(typeof entry.trouble, 'string', `a conflict says what to do, got: ${JSON.stringify(entry)}`);
  assert.notEqual(entry.trouble.trim(), '', 'and the sentence is not empty');
  assert.equal(entryOf(answer, 'web-bot').state, 'unchanged', 'every other bot is reported as it is');
  assert.equal(entryOf(answer, 'bot-father').state, 'unchanged');
  assert.deepEqual(await snapshot(bots, skipGit), before, 'the user\'s own words are never overwritten');
});

for (const [label, edit] of [
  ['a begin marker with no end', (text) => text.replace(END_MARKER, '')],
  ['two begin markers', (text) => `${text.split('\n')[0]}\n${text}`],
  ['an end marker before the begin', (text) => `${END_MARKER}\n${text}`],
]) {
  test(`${label} stops that bot's build and says what is wrong`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await makeBot(box, 'api-bot');
    await makeBot(box, 'web-bot');
    await buildOk(box);

    const file = agentsOf(bots, 'api-bot');
    const built = await readFile(file, 'utf8');
    const broken = edit(built);
    assert.notEqual(broken, built, 'the test should have broken the markers');
    await writeFile(file, broken);
    const before = await snapshot(bots, skipGit);

    const result = await build(box, '--json');

    assert.equal(result.code, 1, `${label} is trouble, and the run ends in 1`);
    const entry = entryOf(answerOf(result), 'api-bot');
    assert.ok(
      entry.state === 'conflict' || entry.state === 'failed',
      `a file the build cannot read is conflict or failed, got: ${JSON.stringify(entry)}`,
    );
    assert.equal(typeof entry.trouble, 'string', `it should say what is wrong, got: ${JSON.stringify(entry)}`);
    assert.notEqual(entry.trouble.trim(), '');
    assert.equal(entryOf(answerOf(result), 'web-bot').state, 'unchanged', 'the bots beside it are built as usual');
    assert.deepEqual(await snapshot(bots, skipGit), before, 'and the file itself is left for the user to fix');
  });
}

test('a build that would write the same block writes nothing at all', async (t) => {
  // Not "the bytes are the same": a rewrite every run would touch the mtime of
  // every bot's file on every `up`, and a git repo would see it.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  await buildOk(box, '--bot', 'api-bot');

  const file = agentsOf(bots, 'api-bot');
  const when = new Date('2020-01-01T00:00:00Z');
  await utimes(file, when, when);
  const result = await build(box, '--bot', 'api-bot', '--json');

  assert.equal(result.code, 0, result.stderr);
  const entry = entryOf(answerOf(result), 'api-bot');
  assert.equal(entry.state, 'unchanged');
  assert.deepEqual(entry.units, await defaultNames(), 'an unchanged file still says what it carries');
  assert.equal((await stat(file)).mtimeMs, when.getTime(), 'the file was not written again');
});

test('an entry that resolves to nothing fails that bot and not the others', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  await makeBot(box, 'web-bot');
  await changeARule(box, bots);
  await addRules(botYamlOf(bots, 'api-bot'), 'ghost');
  const before = await snapshot(bots, skipGit);

  const result = await build(box, '--json');

  assert.equal(result.code, 1, 'a bot that failed ends the run in 1');
  const answer = answerOf(result);
  const entry = entryOf(answer, 'api-bot');
  assert.equal(entry.state, 'failed');
  assert.ok(entry.trouble.includes('ghost'), `the trouble should name the entry, got: ${entry.trouble}`);
  assert.ok(entry.trouble.includes('ghost.md'), `and the file it looked for, got: ${entry.trouble}`);
  assert.equal(entryOf(answer, 'web-bot').state, 'built', 'one bot\'s bad list is not another bot\'s problem');
  assert.equal(entryOf(answer, 'bot-father').state, 'built');

  const its = path.relative(bots, agentsOf(bots, 'api-bot'));
  assert.equal(
    (await snapshot(bots, skipGit))[its],
    before[its],
    'nothing is written for the bot that failed',
  );
});

for (const [label, text] of [
  ['no frontmatter at all', 'Just some words, no frontmatter.\n'],
  ['frontmatter with no title', '---\nname: nameless\n---\n\nA body nobody can head.\n'],
  ['frontmatter that is not YAML', '---\ntitle: [unclosed\n---\n\nA body.\n'],
]) {
  test(`a unit with ${label} fails the bot that names it, by name`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await makeBot(box, 'api-bot');
    await changeARule(box, bots);
    await writeUnit(bots, 'broken', text);
    await addRules(botYamlOf(bots, 'api-bot'), 'broken');

    const result = await build(box, '--json');

    assert.equal(result.code, 1);
    const entry = entryOf(answerOf(result), 'api-bot');
    assert.equal(entry.state, 'failed');
    assert.ok(entry.trouble.includes('broken'), `the trouble should name the entry and its file, got: ${entry.trouble}`);
    assert.equal(entryOf(answerOf(result), 'bot-father').state, 'built');
  });
}

test('--bot builds the one bot, and leaves the others where they were', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  await makeBot(box, 'web-bot');
  await changeARule(box, bots);

  const result = await build(box, '--bot', 'api-bot', '--json');

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(botsIn(answerOf(result)), ['api-bot'], 'only the bot that was asked for is reported');
  assert.ok(headingsIn(blockIn(await agentsIn(bots, 'api-bot')).body).includes('The house style'));
  assert.ok(
    !headingsIn(blockIn(await agentsIn(bots, 'web-bot')).body).includes('The house style'),
    'the bot nobody asked about is not rebuilt',
  );
});

test('a bot with no charter gets no charter section, and its units all the same', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  await dropKey(botYamlOf(bots, 'api-bot'), 'charter');

  const result = await build(box, '--bot', 'api-bot');

  assert.equal(result.code, 0, result.stderr);
  const body = blockIn(await agentsIn(bots, 'api-bot')).body;
  assert.deepEqual(headingsIn(body), await defaultTitles(), 'no charter, no Charter heading');
  assert.equal(titleIn(body), 'Api Bot', 'the bot is still named');
});

test('a built file over 32 KiB is remarked on, and still built', async (t) => {
  // Codex reads 32 KiB of instructions and no more (tech notes, section 3), so
  // a file over it quietly loses rules on one of the two harnesses.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  const plain = await build(box, '--bot', 'api-bot');
  assert.equal(plain.code, 0, plain.stderr);
  assert.ok(!/codex/i.test(plain.stdout), `an ordinary build says nothing about Codex, got: ${plain.stdout}`);

  const huge = Array.from({ length: 700 }, () => 'A line of a rule unit that went on and on and on and on and on.').join('\n');
  await writeUnit(bots, 'huge', unitText('Everything, at length', huge));
  await addRules(path.join(bots, 'defaults.yaml'), 'huge');
  const result = await build(box, '--bot', 'api-bot');

  assert.equal(result.code, 0, `an oversized file is a remark, not a failure: ${result.stderr}`);
  assert.ok((await stat(agentsOf(bots, 'api-bot'))).size > 32 * 1024, 'the test should have built a file over the cap');
  assert.match(result.stdout, /\bbuilt\b/, 'it is built like any other');
  assert.match(result.stdout, /codex/i, `and the report says Codex will not read all of it, got: ${result.stdout}`);
});

test('rules build never talks to Orca, and works with Orca down', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  await box.orca.set({ reachable: false, setups: [], terminals: [] });
  const calls = (await box.orca.calls()).length;

  const result = await build(box);

  assert.equal(result.code, 0, `an Orca that is down is nothing to rules build: ${result.stderr}`);
  assert.ok(hasBlock(await agentsIn(bots, 'api-bot')), 'the file is built all the same');
  assert.equal((await box.orca.calls()).length, calls, 'rules build must not call Orca at all');
});

// A bot's two harnesses read one file through two names: Codex reads
// `AGENTS.md` and Claude Code reads `CLAUDE.md`, which is a link to it (PRD
// 6.6, tech notes section 2). Anything else at that name and the two harnesses
// are reading different instructions in the same bot — the split ADR 0003
// exists to prevent. The kit does not touch what the user put there; it says so
// and ends in 1, and the build of `AGENTS.md` itself is reported as what it
// was, because that file really was written.
for (const [label, put] of [
  ['a file of the user\'s own', (home) => writeFile(path.join(home, 'CLAUDE.md'), 'My own instructions, not the bot\'s.\n')],
  ['a link to some other file', async (home) => {
    await writeFile(path.join(home, 'mine.md'), 'The instructions I want Claude to read.\n');
    await symlink('mine.md', path.join(home, 'CLAUDE.md'));
  }],
  ['a link to nothing at all', (home) => symlink('AGENTS.md.gone', path.join(home, 'CLAUDE.md'))],
]) {
  test(`CLAUDE.md as ${label} is reported, and left alone`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await makeBot(box, 'api-bot');
    await makeBot(box, 'web-bot');
    const home = botHomeOf(bots, 'api-bot');
    await rm(path.join(home, 'CLAUDE.md'));
    await put(home);
    const its = path.relative(bots, path.join(home, 'CLAUDE.md'));
    const before = await snapshot(bots, skipGit);
    await changeARule(box, bots);

    const result = await build(box, '--json');

    assert.equal(result.code, 1, 'a bot whose two harnesses would read different rules ends the run in 1');
    const answer = answerOf(result);
    const entry = entryOf(answer, 'api-bot');
    assert.ok(
      entry.state === 'built' || entry.state === 'unchanged',
      `the AGENTS.md itself was written, so that is what the state is about, got: ${JSON.stringify(entry)}`,
    );
    assert.equal(typeof entry.trouble, 'string', `it should say what is in the way, got: ${JSON.stringify(entry)}`);
    assert.ok(entry.trouble.includes('CLAUDE.md'), `and name the file, got: ${entry.trouble}`);
    assert.ok(hasBlock(await agentsIn(bots, 'api-bot')), 'the bot\'s own rules are built all the same');
    assert.equal((await snapshot(bots, skipGit))[its], before[its], 'what the user put there is never touched');
    assert.ok(!('trouble' in entryOf(answer, 'web-bot')), 'and the bot beside it has nothing to report');
  });
}

test('a CLAUDE.md that is the link it should be is reported as nothing at all', async (t) => {
  // The other side of the three above: the ordinary case must stay quiet, or
  // the report cries wolf on every bot in the fleet.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  await changeARule(box, bots);

  const result = await build(box, '--json');

  assert.equal(result.code, 0, result.stderr);
  const entry = entryOf(answerOf(result), 'api-bot');
  assert.equal(entry.state, 'built');
  assert.ok(!('trouble' in entry), `a bot whose link is right says nothing about it, got: ${JSON.stringify(entry)}`);
  assert.equal(
    await readFile(path.join(botHomeOf(bots, 'api-bot'), 'CLAUDE.md'), 'utf8'),
    await agentsIn(bots, 'api-bot'),
    'reading CLAUDE.md is reading AGENTS.md',
  );
});

test('rules build without --bots fails and says so', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['rules', 'build']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('--bots'), `should name --bots, got: ${result.stderr}`);
});
