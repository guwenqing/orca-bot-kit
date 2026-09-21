// `obk roster --bots <path> [--bot <bot>]`: the fleet as facts, for every bot in
// name order or for the one named. It is what Bot Father reads when the user
// asks what they have.
//
// It reads files only. No Orca call, nothing written anywhere, exit 0 — so a
// user can ask what their fleet is while it is running, and while it is half
// broken, and nothing about either changes.
//
// And it judges nothing. The charter comes back as it was written, not
// summarised; a list comes back as it stands, not checked; no line says whether
// a bot is well. Deciding any of that belongs to the skill that reads this and
// to `obk health`, and a roster that started doing it would make the two
// disagree in front of the user.
//
// What it reports about a session is the two halves of it: what `bot.yaml` says
// the session is, with the per-session harness override resolved, and what the
// book holds about the session that has been running — its tab, when the kit
// last started a harness in it, the conversation it is in, the conversations it
// was in before, and any conversation of this bot's folder that no session
// claims. A bot the kit has never brought up has no book at all, and still
// appears.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import {
  assertCleanFailure,
  assertHomeUntouched,
  bookOf,
  botHomeOf,
  createSandbox,
  recordSession,
  skipOrcaFake,
  snapshot,
  tabsOfBot,
} from './helpers/cli.js';
import { botYamlOf, commonSkill } from './helpers/skills.js';

/** The charter written into the bot the tests make, word for word. */
const CHARTER = 'Api Bot owns the API. Good is a green build. Ask before a release.';

/** A bots folder `init` made, with Bot Father up in Orca. */
async function seeded(box, harness = 'claude') {
  const result = await box.run(['init', '--bots', 'bots', '--harness', harness]);
  assert.equal(result.code, 0, result.stderr);
  return box.path('bots');
}

/** One more bot with its sessions, written but not opened in Orca. */
async function botWritten(box, name, { harness = 'claude', charter = CHARTER, sessions = [['daily']] } = {}) {
  const made = await box.run([
    'bot', 'create', '--bots', 'bots', '--name', name, '--harness', harness, '--charter', charter,
  ]);
  assert.equal(made.code, 0, made.stderr);
  for (const [session, ...settings] of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', name, '--name', session, ...settings]);
    assert.equal(added.code, 0, added.stderr);
  }
  return botHomeOf(box.path('bots'), name);
}

/** Open a bot in Orca, which is when its book gets the project and the tabs. */
async function opened(box, name) {
  const result = await box.run(['up', '--bots', 'bots', '--bot', name]);
  assert.equal(result.code, 0, result.stderr);
}

/** One more bot, written and brought up. */
async function botUp(box, name, options) {
  const home = await botWritten(box, name, options);
  await opened(box, name);
  return home;
}

/** Run the roster and answer what it said as JSON. */
async function roster(box, ...rest) {
  const result = await box.run(['roster', '--bots', 'bots', ...rest, '--json']);
  assert.equal(result.code, 0, `the roster reports and never fails: ${result.stderr}`);
  assert.equal(result.stderr, '');
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  assert.ok(Array.isArray(answer.roster), `the answer should carry a list of bots, got: ${result.stdout}`);
  return answer;
}

/** The bots the answer reported, in the order it reported them. */
const namesIn = (answer) => answer.roster.map((entry) => entry.bot);

/** The one entry about one bot. */
function entryOf(answer, bot) {
  const found = answer.roster.filter((entry) => entry.bot === bot);
  assert.equal(found.length, 1, `one entry should be about ${bot}, got: ${JSON.stringify(answer.roster)}`);
  return found[0];
}

/** The one entry about one of a bot's sessions. */
function sessionOf(entry, name) {
  const found = (entry.sessions ?? []).filter((session) => session.name === name);
  assert.equal(found.length, 1, `${entry.bot} should say one thing about ${name}, got: ${JSON.stringify(entry.sessions)}`);
  return found[0];
}

/** What the answer holds from the book, for a bot and for one of its sessions. */
const orcaOf = (entry) => entry.orca ?? {};
const bookFactsOf = (session) => session.book ?? {};

/** The book on disk, which is where the facts about a running session come from. */
const bookIn = async (bots, bot) => parse(await readFile(bookOf(bots, bot), 'utf8'));

test('R3 the roster reports every bot in the folder, in name order', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  await botWritten(box, 'zebra-bot');
  await botWritten(box, 'api-bot');

  const answer = await roster(box);

  assert.deepEqual(namesIn(answer), ['api-bot', 'bot-father', 'zebra-bot']);
});

test('R3 --bot reports the one bot named and no other', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  await botWritten(box, 'api-bot');

  const answer = await roster(box, '--bot', 'api-bot');

  assert.deepEqual(namesIn(answer), ['api-bot']);
});

test('R3 a bot\'s own facts: its name, its home, its harness, its charter and its two lists', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botWritten(box, 'api-bot', { harness: 'codex' });
  // Written by hand, because what the roster reports is the lists as they
  // stand: whether a rule unit or a skill is really there is another command's
  // question.
  const doc = parse(await readFile(botYamlOf(bots, 'api-bot'), 'utf8'));
  doc.rules = ['my-rule', 'kit:obk-tdd'];
  doc.skills = ['house-style', 'kit:obk-reviewing', 'someones-skills:their-skill'];
  await writeFile(botYamlOf(bots, 'api-bot'), stringify(doc));

  const entry = entryOf(await roster(box), 'api-bot');

  assert.equal(entry.bot, 'api-bot');
  assert.equal(entry.home, botHomeOf(bots, 'api-bot'));
  assert.equal(entry.harness, 'codex', 'the harness its bot.yaml names');
  assert.equal(entry.charter.trim(), CHARTER);
  assert.deepEqual(entry.rules, ['my-rule', 'kit:obk-tdd']);
  assert.deepEqual(entry.skills, ['house-style', 'kit:obk-reviewing', 'someones-skills:their-skill']);
});

test('R3 the charter comes back whole, as it was written', async (t) => {
  // The roster does not summarise it and does not pick a line out of it. The
  // skill that reads this is what turns a charter into two lines for a card.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botWritten(box, 'api-bot');
  const charter = 'Api Bot owns the API and its deployments.\n\nGood looks like a green build on main.\n\nAsk first before: a release, or a change to the schema.\n';
  const doc = parse(await readFile(botYamlOf(bots, 'api-bot'), 'utf8'));
  doc.charter = charter;
  await writeFile(botYamlOf(bots, 'api-bot'), stringify(doc));

  const entry = entryOf(await roster(box), 'api-bot');

  assert.equal(entry.charter, charter, `got: ${JSON.stringify(entry.charter)}`);
});

test('R3 one entry per session, each with the harness it actually runs on', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botWritten(box, 'api-bot', {
    harness: 'codex',
    sessions: [['daily'], ['review', '--harness', 'claude']],
  });
  // A harness set to nothing is a harness not set: the session runs on the
  // bot's, exactly as `harnessOf` reads it when the run starts.
  const doc = parse(await readFile(botYamlOf(bots, 'api-bot'), 'utf8'));
  doc.sessions.push({ name: 'watch', harness: '' });
  await writeFile(botYamlOf(bots, 'api-bot'), stringify(doc));

  const entry = entryOf(await roster(box), 'api-bot');

  assert.deepEqual((entry.sessions ?? []).map((session) => session.name), ['daily', 'review', 'watch']);
  assert.equal(sessionOf(entry, 'daily').harness, 'codex', 'a session that names none runs on the bot\'s');
  assert.equal(sessionOf(entry, 'review').harness, 'claude', 'and one that names its own runs on that');
  assert.equal(sessionOf(entry, 'watch').harness, 'codex', 'a harness set to nothing is the bot\'s harness');
});

test('R3 every setting a session carries is reported', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botWritten(box, 'api-bot', { sessions: [] });
  const doc = parse(await readFile(botYamlOf(bots, 'api-bot'), 'utf8'));
  doc.sessions = [{
    name: 'daily',
    model: 'sonnet',
    effort: 'high',
    context: '1m',
    approval: 'ask',
    prompt: 'Watch the build and say what broke.',
    work_dir: 'work/api',
    extra_args: ['--search'],
  }];
  await writeFile(botYamlOf(bots, 'api-bot'), stringify(doc));

  const session = sessionOf(entryOf(await roster(box), 'api-bot'), 'daily');

  assert.equal(session.model, 'sonnet');
  assert.equal(session.effort, 'high');
  assert.equal(session.context, '1m');
  assert.equal(session.approval, 'ask');
  assert.equal(session.prompt, 'Watch the build and say what broke.');
  assert.equal(session.work_dir, 'work/api');
  assert.deepEqual(session.extra_args, ['--search']);
});

test('R3 a setting a session does not carry is absent, not guessed', async (t) => {
  // The kit never invents a model or an effort: not set means the harness's
  // own default, and a roster that filled one in would have the user reading a
  // model nobody chose.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botWritten(box, 'api-bot', { sessions: [['daily']] });

  const session = sessionOf(entryOf(await roster(box), 'api-bot'), 'daily');

  assert.equal(session.approval, 'auto', 'the one setting session add writes is there');
  for (const setting of ['model', 'effort', 'context', 'prompt', 'prompt_file', 'work_dir', 'extra_args']) {
    assert.equal(
      setting in session,
      false,
      `${setting} is not set, and absent is what not set looks like, got: ${JSON.stringify(session)}`,
    );
  }
});

test('R3 what the book records under orca: the Orca project and the setup', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot');
  // Orca's own record of the workspace, which is where those two ids came from.
  const setups = (await box.orca.setups()).filter((setup) => setup.path === botHomeOf(bots, 'api-bot'));
  assert.equal(setups.length, 1, `Orca should hold one workspace for the bot, got: ${JSON.stringify(setups)}`);

  const entry = entryOf(await roster(box), 'api-bot');

  assert.equal(orcaOf(entry).setup, setups[0].id);
  assert.equal(orcaOf(entry).project, setups[0].projectId);
});

test('R3 what the book holds for a session: its tab and when it was launched', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot');
  const tabs = await tabsOfBot(box, bots, 'api-bot');
  assert.equal(tabs.length, 1, `the bot should have its one session tab, got: ${JSON.stringify(tabs)}`);
  const book = await bookIn(bots, 'api-bot');

  const facts = bookFactsOf(sessionOf(entryOf(await roster(box), 'api-bot'), 'daily'));

  assert.equal(facts.tab, tabs[0].tabId, 'the tab Orca made for this session');
  assert.equal(facts.launched, book.sessions.daily.launched, 'and when the kit last started a harness in it');
  assert.match(
    facts.launched,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    `a time a person can read, got: ${JSON.stringify(facts.launched)}`,
  );
});

test('R3 the conversation the session is in, and the ones it was in before', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot');
  const tab = (await tabsOfBot(box, bots, 'api-bot'))[0].tabId;
  await recordSession(box, { bots, bot: 'api-bot', tab, session: 'sess-1', source: 'startup' });
  await recordSession(box, { bots, bot: 'api-bot', tab, session: 'sess-2', source: 'clear' });

  const facts = bookFactsOf(sessionOf(entryOf(await roster(box), 'api-bot'), 'daily'));

  assert.equal(facts.session, 'sess-2', 'the conversation it is in now');
  assert.deepEqual(
    (facts.history ?? []).map((was) => was.session),
    ['sess-1'],
    `and the one it was in before, got: ${JSON.stringify(facts.history)}`,
  );
});

test('R3 the conversations of a bot\'s folder that no session claims are reported', async (t) => {
  // The note the kit writes and never settles itself. Nobody reads the book by
  // hand, so the roster is one of the two places it can surface.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot');
  const ids = ['0199a1f0-1111-4444-8888-aaaaaaaaaaaa', '0199a1f0-2222-4444-8888-bbbbbbbbbbbb'];
  const book = await bookIn(bots, 'api-bot');
  book.sessions.daily.unclaimed = ids;
  await writeFile(bookOf(bots, 'api-bot'), stringify(book));

  const facts = bookFactsOf(sessionOf(entryOf(await roster(box), 'api-bot'), 'daily'));

  assert.deepEqual(facts.unclaimed, ids);
});

test('R3 a bot whose book does not exist yet still appears, with the facts that do exist', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botWritten(box, 'api-bot', { harness: 'codex', sessions: [['daily', '--model', 'gpt-5.4']] });
  assert.equal(
    await readFile(bookOf(bots, 'api-bot'), 'utf8').then(() => true, (error) => error.code),
    'ENOENT',
    'a bot nothing has brought up has no book',
  );

  const entry = entryOf(await roster(box), 'api-bot');

  assert.equal(entry.harness, 'codex');
  assert.equal(entry.charter.trim(), CHARTER);
  assert.equal(orcaOf(entry).setup, undefined, 'there is no Orca project to name yet');
  const session = sessionOf(entry, 'daily');
  assert.equal(session.model, 'gpt-5.4', 'what bot.yaml says about it is all there');
  assert.equal(bookFactsOf(session).tab, undefined, 'and the book has nothing to add');
});

test('R3 a session the book has nothing for still appears beside the ones it knows', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot');
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'review']);
  assert.equal(added.code, 0, added.stderr);

  const entry = entryOf(await roster(box), 'api-bot');

  assert.deepEqual((entry.sessions ?? []).map((session) => session.name), ['daily', 'review']);
  assert.notEqual(bookFactsOf(sessionOf(entry, 'daily')).tab, undefined, 'the one that has run has a tab');
  assert.equal(
    bookFactsOf(sessionOf(entry, 'review')).tab,
    undefined,
    'and the one that never has is reported without one, rather than left out',
  );
});

test('R3 a bot that is not there is refused, and the bots there are named', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  await botWritten(box, 'api-bot');

  const result = await box.run(['roster', '--bots', 'bots', '--bot', 'no-such-bot']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('no-such-bot'), `the refusal should name what was asked for, got: ${result.stderr}`);
  for (const there of ['api-bot', 'bot-father']) {
    assert.ok(result.stderr.includes(there), `and say which bots there are, got: ${result.stderr}`);
  }
});

test('R3 roster without --bots is refused and says so', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['roster']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('--bots'), `should name --bots, got: ${result.stderr}`);
});

test('R3 it reads and nothing else: nothing on disk moves and Orca is asked nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot');
  await commonSkill(bots, 'house-style');
  const before = await snapshot(box.root, skipOrcaFake);
  const calls = (await box.orca.calls()).length;

  const result = await box.run(['roster', '--bots', 'bots']);

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await snapshot(box.root, skipOrcaFake), before, 'a roster changes nothing, anywhere');
  assert.equal((await box.orca.calls()).length, calls, 'and it does not talk to Orca');
  await assertHomeUntouched(box);
});

test('R3 an Orca that is down is nothing to the roster', async (t) => {
  // The proof that it needs no Orca at all: the thing every command that opens
  // a tab checks first is out, and this one still answers.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot');
  const tab = (await tabsOfBot(box, bots, 'api-bot'))[0].tabId;
  await box.orca.set({ reachable: false });

  const answer = await roster(box);

  assert.deepEqual(namesIn(answer), ['api-bot', 'bot-father']);
  assert.equal(bookFactsOf(sessionOf(entryOf(answer, 'api-bot'), 'daily')).tab, tab);
});

test('R3 it judges nothing: a setup health has findings about is reported all the same', async (t) => {
  // The two commands look at the same fleet and answer different questions.
  // Health says what is wrong and ends in 1; the roster says what is there and
  // ends in 0, whatever health thinks of it.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot');
  const doc = parse(await readFile(botYamlOf(bots, 'api-bot'), 'utf8'));
  doc.skills = ['no-such-skill-anywhere'];
  await writeFile(botYamlOf(bots, 'api-bot'), stringify(doc));

  const health = await box.run(['health', '--bots', 'bots']);
  const result = await box.run(['roster', '--bots', 'bots']);

  assert.equal(health.code, 1, `health should have something to say about this setup: ${health.stdout}`);
  assert.equal(result.code, 0, `and the roster reports it all the same: ${result.stderr}`);
  const entry = entryOf(await roster(box), 'api-bot');
  assert.deepEqual(entry.skills, ['no-such-skill-anywhere'], 'the list as it stands, unchecked');
});

test('R3 the plain report names the facts the answer carries', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { harness: 'codex', sessions: [['daily', '--model', 'gpt-5.4', '--effort', 'high']] });
  const tab = (await tabsOfBot(box, bots, 'api-bot'))[0].tabId;
  await recordSession(box, { bots, bot: 'api-bot', tab, session: 'sess-1' });

  const result = await box.run(['roster', '--bots', 'bots']);

  assert.equal(result.code, 0, result.stderr);
  for (const fact of ['api-bot', 'bot-father', 'codex', 'daily', 'gpt-5.4', 'high', tab, 'sess-1', CHARTER]) {
    assert.ok(result.stdout.includes(fact), `the report should name ${fact}, got:\n${result.stdout}`);
  }
  assert.ok(!result.stdout.includes('undefined'), `nothing should be undefined, got:\n${result.stdout}`);
});

test('R3 --json answers with bots as the resolved absolute path', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);

  const answer = await roster(box);

  assert.equal(answer.bots, bots, '--bots was given as a relative path and comes back resolved');
  assert.equal(path.isAbsolute(answer.bots), true);
});
