// `obk health --bots <path> [--bot <bot>] [--json]`: the one command that says
// plainly what is wrong with a setup (PRD 4.12) — conflicting or broken
// configuration, a broken skill link, a session the book knows that Orca does
// not, leftovers no book owns — and Orca's own default launch arguments on top
// (PRD 6.5).
//
// Two things hold it together, and everything here is written to catch either
// one breaking.
//
// It reports and never repairs. PRD 6.8: the kit's code reports facts; judging
// them and proposing a fix is the skill's job. So the command writes nothing,
// anywhere: no AGENTS.md built, no skill linked, no book touched, no Orca
// project and no tab. A health check that quietly fixes what it finds is not a
// health check, and the run that proves it is the one that matters most here.
//
// And a finding has to be actionable. The wording of every sentence is the
// implementer's and is not pinned; what is pinned is that the sentence names
// the thing it is about — the file, the skill, the session, the tab id, the
// conversation id — so that a person who cannot read code can go and look.
//
// Everything goes through the CLI on a sandboxed bots folder, against the fake
// Orca. Orca's own settings live under the home directory, and HOME is inside
// every sandbox: `box.orca.settings` is what says what they hold, and every
// sandbox starts with harmless launch arguments in them, so a test about
// anything else hears nothing about Orca's setting.
//
// The same Orca-setting finding is part of `obk init`'s report too, because
// PRD 6.5 has the kit check it during setup as well as here, and remind the
// user "in plain words, every time". That is H23, at the end.

import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import {
  assertCleanFailure,
  bookOf,
  botHomeOf,
  cliEntry,
  createSandbox,
  hookFileOf,
  orcaCommand,
  sessionIn,
  shellWord,
  skipOrcaFake,
  snapshot,
} from './helpers/cli.js';
import { addRules, agentsIn, agentsOf, END_MARKER } from './helpers/rules.js';
import {
  addSkills,
  assertLinked,
  botYamlOf,
  commonSkill,
  linkByHand,
  setSkills,
  skillsDirOf,
  writeSkill,
} from './helpers/skills.js';
import {
  commitIn,
  putSkills,
  repoAt,
  sourcesYaml,
  writeSources,
} from './helpers/sources.js';

/** The kinds a finding can be. */
const KINDS = ['orca', 'config', 'skill', 'session', 'leftover'];

/**
 * Say what Orca's own per-agent default launch arguments are. They live in
 * Orca's settings file under the user's home directory, which the kit reads and
 * never writes, and `agentDefaultArgs` maps an agent name to the extra launch
 * arguments Orca starts it with.
 */
const orcaSettings = (box, agentDefaultArgs) => box.orca.settings.set({ agentDefaultArgs });

/** What each harness's permission bypass is spelled, as Orca would record it. */
const BYPASS = {
  claude: '--dangerously-skip-permissions',
  codex: '--dangerously-bypass-approvals-and-sandbox',
};

/** The harnesses the kit cares about. */
const HARNESSES = Object.keys(BYPASS);

/**
 * A bots folder with Bot Father up in Orca. Orca's own default launch arguments
 * are the sandbox's own: recorded for both harnesses and carrying no bypass, so
 * a test about anything else gets no finding about them.
 */
async function seeded(box, harness = 'claude') {
  const result = await box.run(['init', '--bots', 'bots', '--harness', harness]);
  assert.equal(result.code, 0, result.stderr);
  return box.path('bots');
}

/** One more bot with its sessions, written but not yet opened in Orca. */
async function botWritten(box, name, { harness = 'claude', sessions = [['daily']] } = {}) {
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', name, '--harness', harness]);
  assert.equal(made.code, 0, made.stderr);
  for (const [session, ...settings] of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', name, '--name', session, ...settings]);
    assert.equal(added.code, 0, added.stderr);
  }
  return botHomeOf(box.path('bots'), name);
}

/** Open a bot in Orca, which is also when its rules, skills and hooks are put in place. */
async function opened(box, name) {
  const result = await box.run(['up', '--bots', 'bots', '--bot', name]);
  assert.equal(result.code, 0, result.stderr);
}

/** One more bot, written and opened: everything the kit makes for a bot is in place. */
async function botUp(box, name, options) {
  const home = await botWritten(box, name, options);
  await opened(box, name);
  return home;
}

/** Run the health check. */
const health = (box, ...rest) => box.run(['health', '--bots', 'bots', ...rest]);

/** What a `--json` run answered, with nothing but JSON on the way out. */
function answerOf(result) {
  assert.equal(result.stderr, '', `a health run reports on stdout, and put this on stderr: ${result.stderr}`);

  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }

  assert.ok(Array.isArray(answer.found), `the answer should carry a list of findings, got: ${result.stdout}`);
  for (const finding of answer.found) {
    assert.ok(KINDS.includes(finding.kind), `a finding's kind is one of ${KINDS.join(', ')}, got: ${JSON.stringify(finding)}`);
    assert.ok(
      typeof finding.where === 'string' && finding.where.trim() !== '',
      `a finding says what it is about, got: ${JSON.stringify(finding)}`,
    );
    assert.ok(
      typeof finding.says === 'string' && finding.says.trim() !== '',
      `a finding says something a person can act on, got: ${JSON.stringify(finding)}`,
    );
  }
  return answer;
}

/**
 * Run the health check for JSON, and hold it to the exit code the findings call
 * for: 0 when it found nothing, 1 when it found something. Finding trouble is
 * not an error, so the JSON is printed either way.
 */
async function found(box, ...rest) {
  const result = await health(box, ...rest, '--json');
  const answer = answerOf(result);
  assert.equal(
    result.code,
    answer.found.length === 0 ? 0 : 1,
    `${answer.found.length} findings should exit ${answer.found.length === 0 ? 0 : 1}, got ${result.code}`,
  );
  return answer;
}

/** The findings of one kind, or about one bot, or both. */
const of = (answer, { kind, bot } = {}) => answer.found.filter((one) => (
  (kind === undefined || one.kind === kind) && (bot === undefined || one.bot === bot)
));

/** Everything one finding puts in front of a reader. */
const wordsOf = (finding) => `${finding.where} ${finding.says}`;

/** The findings that name `what` anywhere a reader would see it. */
const naming = (findings, what) => findings.filter((one) => wordsOf(one).includes(what));

/** One finding, and it names `what`: the thing a person has to go and look at. */
function oneNaming(findings, what, why) {
  const said = naming(findings, what);
  assert.equal(said.length, 1, `${why}: one finding should name ${what}, got: ${JSON.stringify(findings, null, 2)}`);
  return said[0];
}

/** Nothing here names `what`, which is a fact about what the check left alone. */
function noneNaming(findings, what, why) {
  assert.deepEqual(naming(findings, what), [], `${why}: nothing should name ${what}`);
}

/** Every run of whitespace as one space, so an indented or re-wrapped sentence still reads the same. */
const flat = (text) => text.replace(/\s+/g, ' ').trim();

/** Plant an Orca project Orca holds and the kit did not make. */
async function plantProject(box, at, displayName) {
  const setups = await box.orca.setups();
  const n = setups.length + 90;
  await box.orca.set({
    setups: [...setups, {
      id: `repo_${n}`,
      projectId: `proj_${n}`,
      hostId: 'host_local',
      repoId: `repo_${n}`,
      path: at,
      displayName,
      kind: 'folder',
      setupState: 'ready',
      setupMethod: 'repo-add',
    }],
  });
}

/** Plant a tab in an Orca project, as though somebody had opened one by hand. */
async function plantTab(box, home, tabId, title) {
  const setup = (await box.orca.setups()).find((one) => one.path === home);
  assert.ok(setup !== undefined, `Orca should hold a project for ${home} before a tab is put in it`);
  const terminals = await box.orca.terminals();
  await box.orca.set({
    terminals: [...terminals, {
      handle: `term_${tabId}`,
      tabId,
      paneKey: `${tabId}:pane_x`,
      ptyId: `pty_${tabId}`,
      leafId: `leaf_${tabId}`,
      worktreeId: `${setup.repoId}::${setup.path}`,
      worktreePath: home,
      title,
      agentIdentity: null,
      typed: [],
    }],
  });
}

/** Take one tab away from Orca, the way closing it in the app would. */
async function closeTab(box, tabId) {
  const terminals = await box.orca.terminals();
  assert.ok(terminals.some((one) => one.tabId === tabId), `Orca should have had the tab ${tabId}`);
  await box.orca.set({ terminals: terminals.filter((one) => one.tabId !== tabId) });
}

/** The tab the book holds for one session. */
async function tabOf(bots, bot, session) {
  const entry = await sessionIn(bots, bot, session);
  assert.equal(typeof entry?.tab, 'string', `the book should hold a tab for ${bot} ${session}, got: ${JSON.stringify(entry)}`);
  return entry.tab;
}

/** Change one bot's `bot.yaml`, which is the user's file and theirs to edit. */
async function editBotYaml(bots, bot, change) {
  const file = botYamlOf(bots, bot);
  const doc = parse(await readFile(file, 'utf8')) ?? {};
  await writeFile(file, stringify(change(doc) ?? doc));
}

// ---------------------------------------------------------------------------
// H1, H2, H3 — Orca's own default launch arguments.
// ---------------------------------------------------------------------------

for (const [label, agentDefaultArgs, bypassed] of [
  ['claude alone', { claude: BYPASS.claude, codex: '' }, ['claude']],
  ['codex alone', { claude: '', codex: BYPASS.codex }, ['codex']],
  ['both harnesses', { claude: BYPASS.claude, codex: BYPASS.codex }, ['claude', 'codex']],
  ['a bypass among other arguments', { claude: `--model opus ${BYPASS.claude}`, codex: '' }, ['claude']],
]) {
  test(`H1 a bypass Orca records for ${label} is reported, once per harness`, async (t) => {
    const box = await createSandbox(t);
    await seeded(box);
    await orcaSettings(box, agentDefaultArgs);

    const answer = await found(box);

    const orca = of(answer, { kind: 'orca' });
    assert.equal(orca.length, bypassed.length, `one finding per harness with a bypass, got: ${JSON.stringify(orca, null, 2)}`);
    for (const harness of bypassed) {
      const finding = oneNaming(orca, harness, `${harness} runs with a permission bypass whatever the kit asked for`);
      // Fleet-wide: it is Orca's setting, not one bot's.
      assert.equal(finding.bot, undefined, 'Orca\'s own setting is about the whole fleet, not one bot');
      assert.ok(
        wordsOf(finding).includes(BYPASS[harness]),
        `the user has to know which argument to change, got: ${JSON.stringify(finding, null, 2)}`,
      );
    }
    for (const harness of HARNESSES.filter((one) => !bypassed.includes(one))) {
      noneNaming(orca, harness, `${harness} carries no bypass`);
    }
  });
}

test('H1 a harness Orca records no arguments for at all carries the bypass it defaults to', async (t) => {
  // Verified from Orca's own code: with no string for an agent, Orca starts it
  // with its built-in default, and that default is the bypass argument itself.
  // So a missing entry is a bypass, and silence here would be the worst kind of
  // clean bill of health.
  const box = await createSandbox(t);
  await seeded(box);
  await orcaSettings(box, { codex: '' });

  const answer = await found(box);

  const orca = of(answer, { kind: 'orca' });
  assert.equal(orca.length, 1, `claude has no entry, so claude is reported, got: ${JSON.stringify(orca, null, 2)}`);
  oneNaming(orca, 'claude', 'a missing entry is the bypass Orca falls back to');
  noneNaming(orca, 'codex', 'codex is recorded with no arguments at all');
});

test('H1 a settings file with no default launch arguments at all reports both harnesses', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  await orcaSettings(box, {});

  const answer = await found(box);

  const orca = of(answer, { kind: 'orca' });
  assert.equal(orca.length, 2, `neither harness has an entry, got: ${JSON.stringify(orca, null, 2)}`);
  for (const harness of HARNESSES) oneNaming(orca, harness, `${harness} has no entry of its own`);
});

for (const [label, agentDefaultArgs] of [
  ['no arguments at all', { claude: '', codex: '' }],
  ['arguments that carry no bypass', { claude: '--model opus', codex: '--search' }],
]) {
  test(`H2 ${label} is nothing to report`, async (t) => {
    const box = await createSandbox(t);
    await seeded(box);
    await orcaSettings(box, agentDefaultArgs);

    const answer = await found(box);

    assert.deepEqual(
      of(answer, { kind: 'orca' }),
      [],
      'Orca\'s setting is only worth a word when it takes the permission level out of the kit\'s hands',
    );
  });
}

test('H3 Orca settings the kit cannot read are said plainly, and claimed as neither safe nor a bypass', async (t) => {
  // The dangerous answer is silence: a user who hears nothing reads it as "no
  // bypass". The other dangerous answer is to report one anyway. So the check
  // says what it could not read, and the sentence is not the bypass sentence.
  //
  // A machine in this state is one Orca has never run on, and the kit refuses
  // every command when Orca is down, so a user should never meet it. That is
  // exactly why the honest report matters when they do.
  const box = await createSandbox(t);
  await seeded(box);
  await box.orca.settings.remove();

  const answer = await found(box);

  const orca = of(answer, { kind: 'orca' });
  assert.equal(orca.length, 1, `one finding, about the settings it could not read, got: ${JSON.stringify(orca, null, 2)}`);
  assert.ok(
    /Application Support\/orca/.test(wordsOf(orca[0])),
    `it should say where it looked for Orca's settings, got: ${JSON.stringify(orca[0], null, 2)}`,
  );

  const other = await createSandbox(t);
  await seeded(other);
  await orcaSettings(other, { claude: BYPASS.claude, codex: BYPASS.codex });
  const bypassed = of(await found(other), { kind: 'orca' });

  assert.deepEqual(
    bypassed.map((one) => one.says).filter((says) => says === orca[0].says),
    [],
    'a setting it could not read must not read like a bypass it found',
  );
});

// ---------------------------------------------------------------------------
// H4, H5, H6 — leftovers beside the bots folder and in Orca.
// ---------------------------------------------------------------------------

for (const [label, make] of [
  ['a folder that is gone', async () => {}],
  ['a folder with no bot in it', async (at) => {
    await mkdir(at, { recursive: true });
    await writeFile(path.join(at, 'README.md'), 'I moved the bot out of here.\n');
  }],
]) {
  test(`H4 an Orca project for ${label} is a leftover, and says the tabs go first`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    const ghost = path.join(bots, 'bots', 'ghost-bot');
    await make(ghost);
    await plantProject(box, ghost, 'Ghost Bot');

    // A project of the user's own, outside the bots folder: not the kit's
    // business, and the check must not sweep it up with the leftovers.
    const mine = path.join(box.root, 'my-own-project');
    await mkdir(mine, { recursive: true });
    await plantProject(box, mine, 'My Own Project');

    const answer = await found(box);

    const leftovers = of(answer, { kind: 'leftover' });
    const finding = oneNaming(leftovers, ghost, 'Orca still holds a project where there is no bot');
    assert.equal(finding.bot, undefined, 'a project with no bot belongs to no bot');
    // The order, not the word: a sentence that has the project go first
    // mentions tabs too. Tabs, then "first" or "before", then the project; or
    // the project "after" the tabs.
    assert.match(
      finding.says,
      /\btabs?\b[^.]*\b(first|before)\b[^.]*\bproject|\bproject\b[^.]*\bafter\b[^.]*\btabs?\b/i,
      `removing the project first leaves tabs nothing can close, so the sentence has to say the tabs go first, got: ${finding.says}`,
    );
    noneNaming(answer.found, mine, 'a project of the user\'s own, outside the bots folder');
  });
}

test('H5 a start-prompt file no session owns is a leftover, and a live one is not', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  // Long enough that the kit writes it to a file beside the bots folder rather
  // than typing it into the tab.
  await botUp(box, 'api-bot', { sessions: [['daily', '--prompt', 'Watch the queue and say what you see. '.repeat(10)]] });

  const live = path.join(`${bots}.prompts`, 'api-bot.daily.txt');
  assert.equal(
    (await readFile(live, 'utf8')).includes('Watch the queue'),
    true,
    `bringing the session up should have left its start prompt at ${live}`,
  );
  const gone = path.join(`${bots}.prompts`, 'api-bot.gone.txt');
  await writeFile(gone, 'What the session I deleted was told to do.\n');

  const answer = await found(box);

  oneNaming(of(answer, { kind: 'leftover' }), gone, 'no session of any bot is called gone');
  noneNaming(answer.found, live, 'the daily session is still there, and so is the file it starts with');
});

test('H6 a skill-source clone skills.yaml no longer lists is a leftover, and a listed one is not', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);

  const origin = await repoAt(path.join(box.root, 'origin'));
  await putSkills(origin, { 'their-skill': 'Do it their way.\n' });
  await commitIn(origin, 'the skills');
  await writeSources(bots, sourcesYaml({ name: 'theirs', repo: origin, ref: 'main' }));
  const fetched = await box.run(['skills', 'fetch', '--bots', 'bots']);
  assert.equal(fetched.code, 0, fetched.stderr);

  const listed = path.join(`${bots}.skill-sources`, 'theirs');
  const ghost = path.join(`${bots}.skill-sources`, 'someone-else');
  await mkdir(ghost, { recursive: true });
  await writeFile(path.join(ghost, 'README.md'), 'I took this source out of skills.yaml.\n');

  const answer = await found(box);

  oneNaming(of(answer, { kind: 'leftover' }), ghost, 'skills.yaml lists no source called someone-else');
  noneNaming(answer.found, listed, 'theirs is still listed, and its clone is where it belongs');
});

// ---------------------------------------------------------------------------
// H7, H8, H9, H10 — a bot's configuration.
// ---------------------------------------------------------------------------

for (const [label, text] of [
  ['YAML nothing can read', 'name: api-bot\n  harness: [claude\n: :\n'],
  ['something that is not a mapping', '- api-bot\n- claude\n'],
]) {
  test(`H7 a bot.yaml that is ${label} is reported, and the rest of the fleet with it`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await botUp(box, 'api-bot');
    // Something wrong with the other bot too, so the answer shows this one bot
    // being skipped rather than the whole run stopping.
    await rm(hookFileOf(bots, 'bot-father', 'claude'));
    await writeFile(botYamlOf(bots, 'api-bot'), text);

    const answer = await found(box);

    const mine = of(answer, { bot: 'api-bot' });
    assert.equal(mine.length, 1, `a bot.yaml nothing can read stops that bot's other checks, got: ${JSON.stringify(mine, null, 2)}`);
    assert.equal(mine[0].kind, 'config');
    oneNaming(mine, botYamlOf(bots, 'api-bot'), 'the file to go and open');
    oneNaming(
      of(answer, { bot: 'bot-father' }),
      hookFileOf(bots, 'bot-father', 'claude'),
      'one bot the kit cannot read does not stop the others being reported',
    );
  });
}

// Only YAML that cannot be parsed at all. A book that parses into something
// other than a mapping is a different case with a different answer already
// decided: the kit reads it as a book that says nothing, and `up` then makes
// what is missing (src/book.js). That is not a file the kit cannot read, and
// pinning it here would be settling a question nobody asked.
for (const [label, text] of [
  ['a list that is never closed', 'sessions: [broken\n'],
  ['indented with a tab', 'sessions:\n\t- daily\n'],
]) {
  test(`H24 a book that is YAML ${label} is reported, and the rest of the fleet with it`, async (t) => {
    // The book is a file of the user's repo like any other — committed,
    // readable, and theirs to edit (ADR 0002) — so it can be in exactly the
    // state a bot.yaml can be in, and it is owed the same answer: one finding
    // naming the file, that bot's other checks skipped, every other bot still
    // reported. A check that falls over on one unreadable file takes the whole
    // report with it, including the findings it had already collected, which is
    // the worst way for this command in particular to fail.
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await botUp(box, 'api-bot');
    // Something wrong with the other bot too, so the answer shows this one bot
    // being skipped rather than the whole run stopping.
    await rm(hookFileOf(bots, 'bot-father', 'claude'));
    await writeFile(bookOf(bots, 'api-bot'), text);

    const answer = await found(box);

    const mine = of(answer, { bot: 'api-bot' });
    assert.equal(mine.length, 1, `a book nothing can read stops that bot's other checks, got: ${JSON.stringify(mine, null, 2)}`);
    assert.equal(mine[0].kind, 'config');
    oneNaming(mine, bookOf(bots, 'api-bot'), 'the file to go and open');
    oneNaming(
      of(answer, { bot: 'bot-father' }),
      hookFileOf(bots, 'bot-father', 'claude'),
      'one book the kit cannot read does not stop the others being reported',
    );
  });
}

for (const [label, session] of [
  ['both a prompt and a prompt file', { name: 'broken', approval: 'auto', prompt: 'Do the thing.', prompt_file: 'duty.md' }],
  ['an approval level that does not exist', { name: 'broken', approval: 'yolo' }],
]) {
  test(`H8 a session with ${label} is reported in the same words up refuses with`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await botUp(box, 'api-bot');
    await editBotYaml(bots, 'api-bot', (doc) => { doc.sessions = [...(doc.sessions ?? []), session]; });

    // The words are `up`'s: a session the kit will not start is said the same
    // way whether the user ran into it by bringing the fleet up or by asking
    // what is wrong. `obk: ` and the bot's name are how the refusal is framed,
    // not what it says.
    const refused = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);
    assertCleanFailure(refused);
    const sentence = refused.stderr.trim().replace(/^obk: /, '').replace(/^api-bot: /, '');

    const answer = await found(box);

    const mine = of(answer, { kind: 'config', bot: 'api-bot' });
    const finding = oneNaming(mine, botYamlOf(bots, 'api-bot'), 'the file the session is written in');
    assert.ok(
      flat(finding.says).includes(flat(sentence)),
      `health should say what up says, got:\n${finding.says}\nand up said:\n${sentence}`,
    );
  });
}

/** A bot whose `AGENTS.md` the kit built and the test is about to spoil. */
async function withAgents(box) {
  const bots = await seeded(box);
  await botUp(box, 'api-bot');
  return bots;
}

test('H9a a bot with no AGENTS.md at all is reported', async (t) => {
  const box = await createSandbox(t);
  const bots = await withAgents(box);
  await rm(agentsOf(bots, 'api-bot'));
  await rm(path.join(botHomeOf(bots, 'api-bot'), 'CLAUDE.md'));

  const answer = await found(box);

  const mine = of(answer, { kind: 'config', bot: 'api-bot' });
  oneNaming(mine, agentsOf(bots, 'api-bot'), 'a bot with no instructions is a bot with no boundary');
});

test('H9b an obk block somebody edited by hand is reported', async (t) => {
  const box = await createSandbox(t);
  const bots = await withAgents(box);
  const lines = (await agentsIn(bots, 'api-bot')).split('\n');
  const end = lines.indexOf(END_MARKER);
  assert.notEqual(end, -1, 'the built file should carry the end marker');
  lines.splice(end, 0, 'And one more thing I typed in myself.');
  await writeFile(agentsOf(bots, 'api-bot'), lines.join('\n'));

  const answer = await found(box);

  oneNaming(of(answer, { kind: 'config', bot: 'api-bot' }), agentsOf(bots, 'api-bot'), 'only the person who edited it can settle it');
});

test('H9b an obk block whose markers are broken is reported', async (t) => {
  const box = await createSandbox(t);
  const bots = await withAgents(box);
  const text = await agentsIn(bots, 'api-bot');
  await writeFile(agentsOf(bots, 'api-bot'), text.split('\n').filter((line) => line !== END_MARKER).join('\n'));

  const answer = await found(box);

  oneNaming(of(answer, { kind: 'config', bot: 'api-bot' }), agentsOf(bots, 'api-bot'), 'a block with no end is a block the build will not write');
});

test('H9c a rules list naming a unit that is not there is reported', async (t) => {
  const box = await createSandbox(t);
  const bots = await withAgents(box);
  await addRules(botYamlOf(bots, 'api-bot'), 'no-such-unit');

  const answer = await found(box);

  const mine = of(answer, { kind: 'config', bot: 'api-bot' });
  oneNaming(mine, 'no-such-unit', 'the name in the list is what the user has to put right');
});

test('H9d an AGENTS.md over the 32 KiB Codex reads is reported', async (t) => {
  const box = await createSandbox(t);
  const bots = await withAgents(box);
  // The user's own text, below the end marker, where the build leaves it alone.
  // Codex stops reading at 32 KiB and says nothing about having stopped.
  await writeFile(agentsOf(bots, 'api-bot'), `${await agentsIn(bots, 'api-bot')}\n${'Notes of my own.\n'.repeat(2500)}`);

  const answer = await found(box);

  oneNaming(of(answer, { kind: 'config', bot: 'api-bot' }), agentsOf(bots, 'api-bot'), 'a Codex session will not see all of it');
});

test('H9e a CLAUDE.md that is not this bot\'s AGENTS.md is reported', async (t) => {
  // Claude Code reads CLAUDE.md in place of AGENTS.md, so the two harnesses
  // would start the same bot from different rules.
  const box = await createSandbox(t);
  const bots = await withAgents(box);
  const claude = path.join(botHomeOf(bots, 'api-bot'), 'CLAUDE.md');
  await rm(claude);
  await writeFile(claude, '# Api Bot\n\nRules I wrote for Claude alone.\n');

  const answer = await found(box);

  oneNaming(of(answer, { kind: 'config', bot: 'api-bot' }), claude, 'the file Claude Code reads instead');
});

test('H25 a CLAUDE.md that is not there at all is reported', async (t) => {
  // The link is the kit's to make and to keep (PRD 6.6, ADR 0003): it is the
  // one way Claude Code is certain to read a bot's rules, and whether it reads
  // AGENTS.md without it turns on conditions the kit does not control (tech
  // notes, section 2). A wrong link is reported, so a missing one cannot be
  // passed over — the bot is in the same state either way, and this is the half
  // a check that only inspects what is there never sees.
  const box = await createSandbox(t);
  const bots = await withAgents(box);
  const claude = path.join(botHomeOf(bots, 'api-bot'), 'CLAUDE.md');
  await rm(claude);

  const answer = await found(box);

  // The bot's AGENTS.md is untouched and everything else about the fleet is in
  // order, so this is the one thing wrong with it.
  const mine = of(answer, { bot: 'api-bot' });
  assert.equal(mine.length, 1, `the missing link is the only thing wrong here, got: ${JSON.stringify(mine, null, 2)}`);
  assert.equal(mine[0].kind, 'config');
  oneNaming(mine, claude, 'the link that is not there');
  assert.equal(answer.found.length, 1, `and nothing else in the fleet, got: ${JSON.stringify(answer.found, null, 2)}`);
});

test('H9f an AGENTS.md that is not what the charter says now is reported', async (t) => {
  const box = await createSandbox(t);
  const bots = await withAgents(box);
  await editBotYaml(bots, 'api-bot', (doc) => {
    doc.charter = 'Api Bot owns the billing API now, and asks before every release.';
  });

  const answer = await found(box);

  const mine = of(answer, { kind: 'config', bot: 'api-bot' });
  oneNaming(mine, agentsOf(bots, 'api-bot'), 'the charter moved and nothing rebuilt the file');
});

for (const [label, spoil] of [
  ['is not there', (file) => rm(file)],
  ['holds none of the kit\'s hooks', (file) => writeFile(file, `${JSON.stringify({ hooks: { SessionStart: [] } }, null, 2)}\n`)],
  ['cannot be read', (file) => writeFile(file, '{ this is not JSON at all\n')],
]) {
  test(`H10 a hooks file that ${label} is reported, for the harness whose sessions run on it`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await botUp(box, 'api-bot', { sessions: [['daily'], ['nightly', '--harness', 'codex']] });
    await spoil(hookFileOf(bots, 'api-bot', 'codex'));

    const answer = await found(box);

    const mine = of(answer, { kind: 'config', bot: 'api-bot' });
    const finding = oneNaming(mine, hookFileOf(bots, 'api-bot', 'codex'), 'the file the harness reads its hooks from');
    // The sentence has to carry the consequence, not only the fact: without the
    // hook the book never learns that harness's session ids and goes stale.
    assert.match(
      finding.says,
      /\b(book|record|session ids|stale)\b/i,
      `it should say what goes wrong, got: ${finding.says}`,
    );
    noneNaming(mine, hookFileOf(bots, 'api-bot', 'claude'), 'the Claude hook is where it belongs');
  });
}

/** The one command the kit wrote into a hooks file it has just written, and the file parsed. */
async function kitLineIn(file) {
  const held = JSON.parse(await readFile(file, 'utf8'));
  const commands = held.hooks.SessionStart.flatMap((group) => group.hooks.map((hook) => hook.command));
  assert.equal(commands.length, 1, `the kit wrote one line into ${file}, got: ${JSON.stringify(commands)}`);
  return { held, kit: commands[0] };
}

/** A line of the user's that mentions the kit's command and is not the line the kit writes. */
const lookAlikeOf = (kit) => `my-wrapper && ${kit}`;

test('H10 a hooks file holding only a line of the user\'s that mentions obk session record is reported as missing the kit\'s hook', async (t) => {
  // #165: a line that only mentions the kit's command is the user's, not the kit's hook.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['daily'], ['nightly', '--harness', 'codex']] });
  const file = hookFileOf(bots, 'api-bot', 'codex');
  const { kit } = await kitLineIn(file);
  await writeFile(file, `${JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: lookAlikeOf(kit) }] }] } }, null, 2)}\n`);

  const answer = await found(box);

  const mine = of(answer, { kind: 'config', bot: 'api-bot' });
  const finding = oneNaming(mine, file, 'the kit\'s hook is not in the file, whatever else mentions it');
  assert.match(finding.says, /\b(does not hold|missing|is not there)\b/i, `it should say the kit's hook is missing, got: ${finding.says}`);
});

test('H10 a line of the user\'s that mentions obk session record, beside the kit\'s hook, is not reported', async (t) => {
  // The other half: the kit's hook is there, and the user's look-alike ahead of
  // it is theirs, so there is nothing to put back.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['daily'], ['nightly', '--harness', 'codex']] });
  const file = hookFileOf(bots, 'api-bot', 'codex');
  const { held, kit } = await kitLineIn(file);
  held.hooks.SessionStart = [{ hooks: [{ type: 'command', command: lookAlikeOf(kit) }] }, ...held.hooks.SessionStart];
  await writeFile(file, `${JSON.stringify(held, null, 2)}\n`);

  const answer = await found(box);

  noneNaming(of(answer, { bot: 'api-bot' }), file, 'the kit\'s hook is where it belongs, and the line beside it is the user\'s');
  assert.deepEqual(answer.found, [], `nothing else is wrong in the fleet, got: ${JSON.stringify(answer.found, null, 2)}`);
});

test('H10 a hook of the kit\'s in the bare obk form an earlier kit wrote is in order', async (t) => {
  // Every bot folder on a machine today holds this form. It still records
  // sessions, through the `obk` the machine has installed, and the next `up`
  // writes it in the new form (#220). A health check that reported it would
  // nag every existing user about something that works.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['daily'], ['nightly', '--harness', 'codex']] });
  const file = hookFileOf(bots, 'api-bot', 'codex');
  const bare = `obk session record --bots ${shellWord(bots)} --bot api-bot 2>/dev/null || true`;
  await writeFile(file, `${JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: bare, timeout: 10 }] }] } }, null, 2)}\n`);

  const answer = await found(box);

  noneNaming(of(answer, { bot: 'api-bot' }), file, 'the kit\'s hook is there, in the form an earlier kit wrote');
  assert.deepEqual(answer.found, [], `nothing else is wrong in the fleet, got: ${JSON.stringify(answer.found, null, 2)}`);
});

test('H10 a hook that runs the kit by its own path is the kit\'s hook, and in order', async (t) => {
  // #220: the kit's hook names the CLI that wrote it, quoted as a shell needs,
  // where it used to say the bare `obk`. Written here by hand in that form, so
  // the check is held to the form and not to whatever the last `up` wrote.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['daily'], ['nightly', '--harness', 'codex']] });
  const file = hookFileOf(bots, 'api-bot', 'codex');
  const kit = `${shellWord(box.cli)} session record --bots ${shellWord(bots)} --bot api-bot 2>/dev/null || true`;
  await writeFile(file, `${JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: kit, timeout: 10 }] }] } }, null, 2)}\n`);

  const answer = await found(box);

  noneNaming(of(answer, { bot: 'api-bot' }), file, 'the kit\'s hook is where it belongs');
  assert.deepEqual(answer.found, [], `nothing else is wrong in the fleet, got: ${JSON.stringify(answer.found, null, 2)}`);
});

/**
 * A line of the user's that ends the way the kit's does, under a program that
 * is not the kit. It is theirs (PRD 6.5, #165): the review of PR #247 found
 * health reporting it as the kit's hook running a missing program `echo`.
 */
const theirEcho = (bots) => `echo session record --bots ${shellWord(bots)} --bot api-bot 2>/dev/null || true`;

test('H10 a hooks file holding only a user\'s line that ends like the kit\'s is reported as not holding the kit\'s hook', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['daily'], ['nightly', '--harness', 'codex']] });
  const file = hookFileOf(bots, 'api-bot', 'codex');
  await writeFile(file, `${JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: theirEcho(bots) }] }] } }, null, 2)}\n`);

  const answer = await found(box);

  const mine = of(answer, { kind: 'config', bot: 'api-bot' });
  const finding = oneNaming(mine, file, 'the kit\'s hook is not in the file, whatever the user\'s line looks like');
  assert.match(finding.says, /does not hold the kit's session hook/, `it should say the kit's hook is not there, got: ${finding.says}`);
  assert.ok(!/\becho\b/.test(finding.says), `the user's echo is not the kit's hook, and not a program it runs, got: ${finding.says}`);
});

test('H10 a user\'s line that ends like the kit\'s, beside the kit\'s own hook, is not reported', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['daily'], ['nightly', '--harness', 'codex']] });
  const file = hookFileOf(bots, 'api-bot', 'codex');
  const { held } = await kitLineIn(file);
  held.hooks.SessionStart = [{ hooks: [{ type: 'command', command: theirEcho(bots) }] }, ...held.hooks.SessionStart];
  await writeFile(file, `${JSON.stringify(held, null, 2)}\n`);

  const answer = await found(box);

  noneNaming(of(answer, { bot: 'api-bot' }), file, 'the kit\'s hook is where it belongs, and the line beside it is the user\'s');
  assert.deepEqual(answer.found, [], `nothing else is wrong in the fleet, got: ${JSON.stringify(answer.found, null, 2)}`);
});

/** A hooks file holding one line of the kit's, in the form `obk up` writes it, naming `cli`. */
async function kitHookNaming(file, cli, bots) {
  const kit = `${shellWord(cli)} session record --bots ${shellWord(bots)} --bot api-bot 2>/dev/null || true`;
  await writeFile(file, `${JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: kit, timeout: 10 }] }] } }, null, 2)}\n`);
}

test('H10 a hook of the kit\'s naming another CLI that is there is in order', async (t) => {
  // Brought up by another copy of the kit — the checkout a system test ran,
  // or an install at another path — and still a CLI that answers. It records
  // sessions, so there is nothing to report.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['daily'], ['nightly', '--harness', 'codex']] });
  const file = hookFileOf(bots, 'api-bot', 'codex');
  await kitHookNaming(file, cliEntry, bots);

  const answer = await found(box);

  noneNaming(of(answer, { bot: 'api-bot' }), file, 'the kit\'s hook runs a CLI that is there');
  assert.deepEqual(answer.found, [], `nothing else is wrong in the fleet, got: ${JSON.stringify(answer.found, null, 2)}`);
});

for (const [label, folder] of [['', 'uninstalled'], [' with a space in it', 'un installed'], [', a checkout\'s src/cli.js', 'gone checkout']]) {
  test(`H10 a hook of the kit's naming a CLI that is not there${label} is reported, by that path, with obk up to put it right`, async (t) => {
    // The failure this change makes possible (#220): the hook names the CLI by
    // its path, the install at that path went, and `|| true` keeps the hook
    // quiet while the book goes stale. Nothing else would ever say so. The
    // missing path is what makes this finding and not "the file holds no hook
    // of the kit's", which also ends in obk up.
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await botUp(box, 'api-bot', { sessions: [['daily'], ['nightly', '--harness', 'codex']] });
    const file = hookFileOf(bots, 'api-bot', 'codex');
    const gone = folder === 'gone checkout' ? path.join(box.root, folder, 'src', 'cli.js') : path.join(box.root, folder, 'bin', 'obk');
    await kitHookNaming(file, gone, bots);

    const answer = await found(box);

    const mine = of(answer, { kind: 'config', bot: 'api-bot' });
    const finding = oneNaming(mine, gone, 'the CLI the hook runs is not there');
    assert.ok(wordsOf(finding).includes(file), `it should name the hooks file, got: ${JSON.stringify(finding)}`);
    assert.match(finding.says, /obk up/, `it should say obk up puts the right one back, got: ${finding.says}`);
  });
}

// ---------------------------------------------------------------------------
// H11, H12, H13 — skills.
// ---------------------------------------------------------------------------

/** A bot whose lists name one skill of the user's own, linked into both harnesses. */
async function withSkill(box, name = 'my-skill') {
  const bots = await seeded(box);
  await commonSkill(bots, name);
  await botWritten(box, 'api-bot');
  await addSkills(botYamlOf(bots, 'api-bot'), name);
  await opened(box, 'api-bot');
  return bots;
}

for (const gone of [['claude'], ['codex'], ['claude', 'codex']]) {
  test(`H11 a listed skill missing from ${gone.join(' and ')} is reported, and says which`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withSkill(box);
    for (const harness of gone) await rm(path.join(skillsDirOf(bots, 'api-bot', harness), 'my-skill'));

    const answer = await found(box);

    const mine = of(answer, { kind: 'skill', bot: 'api-bot' });
    const said = naming(mine, 'my-skill');
    assert.notEqual(said.length, 0, `the skill should be named, got: ${JSON.stringify(mine, null, 2)}`);
    const words = said.map(wordsOf).join('\n');
    for (const harness of gone) {
      assert.match(words, new RegExp(harness, 'i'), `the finding should say which harness is missing it, got:\n${words}`);
    }
    for (const harness of HARNESSES.filter((one) => !gone.includes(one))) {
      assert.doesNotMatch(words, new RegExp(harness, 'i'), `${harness} still has the skill the list names`);
    }
  });
}

test('H11 a skill of the user\'s own where the list wants the kit\'s is reported', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSkill(box);
  const at = path.join(skillsDirOf(bots, 'api-bot', 'codex'), 'my-skill');
  await rm(at);
  // Theirs, under the name the list asks for: the kit never writes over it, so
  // what they have to be told is that the list did not take effect.
  await writeSkill(at, { body: 'My own version, and it stays mine.\n' });

  const answer = await found(box);

  const mine = of(answer, { kind: 'skill', bot: 'api-bot' });
  const said = naming(mine, 'my-skill');
  assert.notEqual(said.length, 0, `the skill should be named, got: ${JSON.stringify(mine, null, 2)}`);
  assert.match(said.map(wordsOf).join('\n'), /codex|\.agents/i, 'it should say which harness reads something else under that name');
});

test('H12 a link whose target is gone is reported, with the target it points at', async (t) => {
  const box = await createSandbox(t);
  const bots = await withSkill(box);
  const target = path.join(bots, 'skills', 'my-skill');
  // Taken out of the list and off the disk, so what is left is two links that
  // lead nowhere and nothing asking for them to be there.
  await setSkills(botYamlOf(bots, 'api-bot'));
  await rm(target, { recursive: true });

  const answer = await found(box);

  const mine = of(answer, { kind: 'skill', bot: 'api-bot' });
  const said = naming(mine, 'my-skill');
  assert.notEqual(said.length, 0, `a link that leads nowhere is a skill the session cannot read, got: ${JSON.stringify(mine, null, 2)}`);
  assert.ok(
    said.some((one) => wordsOf(one).includes(target)),
    `it should say what the link points at, got: ${JSON.stringify(said, null, 2)}`,
  );
});

test('H12 a link the user made themselves that leads nowhere is reported too', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot');
  const target = path.join(box.root, 'somewhere', 'ghost-skill');
  await linkByHand(bots, 'api-bot', 'ghost-skill', target);

  const answer = await found(box);

  const mine = of(answer, { kind: 'skill', bot: 'api-bot' });
  const said = naming(mine, 'ghost-skill');
  assert.notEqual(said.length, 0, `the kit reports the fact; whose link it is does not change it, got: ${JSON.stringify(mine, null, 2)}`);
  assert.ok(
    said.some((one) => wordsOf(one).includes(target)),
    `it should say what the link points at, got: ${JSON.stringify(said, null, 2)}`,
  );
});

test('H26 a link pointing at a different skill of the same name is reported, per harness', async (t) => {
  // The question is whether a link is what the list names now, not whether the
  // kit is the one who wrote it. Both directories here are real skills called
  // my-skill, both valid, and the lists have been pointed from one to the
  // other; until something relinks them, both harnesses go on reading the old
  // one while every list in the repo says the new one. Ownership answers what
  // the kit may do about it, not whether it is worth saying.
  const box = await createSandbox(t);
  const bots = await withSkill(box);
  const linked = path.join(bots, 'skills', 'my-skill');
  const wanted = await writeSkill(path.join(box.root, 'other-skills', 'my-skill'), {
    body: 'The version the list names now.\n',
  });
  await setSkills(botYamlOf(bots, 'api-bot'), wanted);

  // The premise, read off the disk rather than out of any report: nothing has
  // moved the links, so both harnesses still read the skill the list has left.
  await assertLinked(bots, 'api-bot', 'my-skill', linked);

  const answer = await found(box);

  const mine = of(answer, { kind: 'skill', bot: 'api-bot' });
  const said = naming(mine, 'my-skill');
  assert.notEqual(said.length, 0, `the skill should be named, got: ${JSON.stringify(mine, null, 2)}`);
  const words = said.map(wordsOf).join('\n');
  assert.ok(words.includes(linked), `it should say what the link points at, got:\n${words}`);
  assert.ok(words.includes(wanted), `and what the list names instead, got:\n${words}`);
  for (const harness of HARNESSES) {
    assert.match(words, new RegExp(harness, 'i'), `both harnesses read the wrong skill, so both are named, got:\n${words}`);
  }
});

test('H13 a skills list the kit cannot follow is reported', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot');
  await addSkills(botYamlOf(bots, 'api-bot'), 'no-such-skill');

  const answer = await found(box);

  const mine = of(answer, { kind: 'skill', bot: 'api-bot' });
  oneNaming(mine, 'no-such-skill', 'the entry in the list is what the user has to put right');
});

test('H13 a source whose clone came from another repository than skills.yaml names is reported', async (t) => {
  // The bot was linked while the source was the first repository, and its
  // links still land on a skill; what is wrong is that the clone they land in
  // is not the source the user registered now (#167).
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const first = await repoAt(path.join(box.root, 'their-repo'));
  await putSkills(first, { 'their-skill': 'Do it their way.\n' });
  await commitIn(first, 'the skills');
  const other = await repoAt(path.join(box.root, 'other-repo'));
  await putSkills(other, { 'their-skill': 'Do it the fork\'s way.\n' });
  await commitIn(other, 'the fork\'s skills');
  await writeSources(bots, sourcesYaml({ name: 'theirs', repo: first, ref: 'main' }));
  const fetched = await box.run(['skills', 'fetch', '--bots', 'bots']);
  assert.equal(fetched.code, 0, fetched.stderr);
  await botWritten(box, 'api-bot');
  await addSkills(botYamlOf(bots, 'api-bot'), 'theirs:their-skill');
  await opened(box, 'api-bot');
  await writeSources(bots, sourcesYaml({ name: 'theirs', repo: other, ref: 'main' }));

  const answer = await found(box);

  const mine = of(answer, { kind: 'skill', bot: 'api-bot' });
  const said = oneNaming(mine, 'skills update --source theirs', 'the user has to take the source from the repository the file names');
  assert.ok(said.says.includes(first), `it should name the repository the clone came from, got: ${said.says}`);
  assert.ok(said.says.includes(other), `and the one skills.yaml names now, got: ${said.says}`);
});

// ---------------------------------------------------------------------------
// H14, H15, H16 — sessions, conversations and tabs.
// ---------------------------------------------------------------------------

test('H14 a session whose tab Orca does not have is reported', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot');
  const tab = await tabOf(bots, 'api-bot', 'daily');
  await closeTab(box, tab);

  const answer = await found(box);

  const mine = of(answer, { kind: 'session', bot: 'api-bot' });
  const finding = oneNaming(mine, tab, 'the tab id the book holds');
  assert.ok(
    wordsOf(finding).includes('daily'),
    `it should name the session as well as the tab, got: ${JSON.stringify(finding, null, 2)}`,
  );
  noneNaming(
    of(answer, { bot: 'bot-father' }),
    await tabOf(bots, 'bot-father', 'daily'),
    'Bot Father\'s tab is still open',
  );
});

test('H15 conversations the book notes as unclaimed are reported, by session and by id', async (t) => {
  // The kit will not guess whose a conversation was, so it writes down what it
  // found and leaves it for a person or Bot Father. Nobody reads the book by
  // hand, so the health check is where that note is meant to surface.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot');
  const ids = ['0199a1f0-1111-4444-8888-aaaaaaaaaaaa', '0199a1f0-2222-4444-8888-bbbbbbbbbbbb'];
  const file = bookOf(bots, 'api-bot');
  const book = parse(await readFile(file, 'utf8'));
  book.sessions.daily.unclaimed = ids;
  await writeFile(file, stringify(book));

  const answer = await found(box);

  const mine = of(answer, { kind: 'leftover', bot: 'api-bot' });
  const said = naming(mine, 'daily');
  assert.notEqual(said.length, 0, `the session the note sits under, got: ${JSON.stringify(mine, null, 2)}`);
  const words = said.map(wordsOf).join('\n');
  for (const id of ids) {
    assert.ok(words.includes(id), `a person can only settle a conversation they can name, got:\n${words}`);
  }
});

test('H16 a tab in a bot\'s Orca project that the book does not name is reported', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const home = await botUp(box, 'api-bot');
  await plantTab(box, home, 'tab_stray', 'Api Bot something');

  const answer = await found(box);

  const mine = of(answer, { kind: 'leftover', bot: 'api-bot' });
  oneNaming(mine, 'tab_stray', 'a tab nothing in the book accounts for');
  noneNaming(answer.found, await tabOf(bots, 'api-bot', 'daily'), 'the session\'s own tab is in the book');
});

test('H16 the tab outside Bot Father\'s book is the ops tab, and is never reported', async (t) => {
  // PRD 6.2: Bot Father's project has one tab that is deliberately not tracked
  // — no id, no title, nothing. To the kit it is simply a tab outside the book,
  // so a check that reports tabs outside the book must make this one exception.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const home = await botUp(box, 'api-bot');
  await plantTab(box, home, 'tab_stray', 'Api Bot something');

  const answer = await found(box);

  const book = parse(await readFile(bookOf(bots, 'bot-father'), 'utf8'));
  const known = new Set(Object.values(book.sessions ?? {}).map((one) => one?.tab));
  const ops = (await box.orca.terminals())
    .filter((one) => one.worktreePath === botHomeOf(bots, 'bot-father') && !known.has(one.tabId));
  assert.equal(ops.length, 1, `Bot Father should have its one untracked tab, got: ${JSON.stringify(ops)}`);

  noneNaming(answer.found, ops[0].tabId, 'the ops tab is the one tab the kit deliberately does not track');
  // And the same state in another bot's project is reported, so this is an
  // exception that was made and not a check that never ran.
  oneNaming(of(answer, { kind: 'leftover', bot: 'api-bot' }), 'tab_stray', 'no other bot has an ops tab');
});

// ---------------------------------------------------------------------------
// H27 — conversations the harness has on record and the book does not.
//
// The book learns a session's conversation from the kit's hook, and the hook
// can miss one: a clear it did not record, a Codex hooks file trusted after the
// event it would have caught (ADR 0002, ADR 0010). Then the book is stale, and
// the only other record is the harness's own. So health reads what each
// harness keeps for the bot's folder, the way `obk usage` does, and says which
// conversations the book does not name.
//
// Transcripts are planted in the sandbox's home the way test/usage.test.js
// plants them: Claude Code's under a folder named after the working directory,
// Codex's by the day it started, with the folder in its first line. They are
// planted after `up`, so that `up` has no chance to read them first.
// ---------------------------------------------------------------------------

/** A moment on the day these conversations are set, as both harnesses write one. */
const onTheDay = (hour, minute = 0) =>
  `2026-09-20T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;

/** Plant a conversation where its harness keeps it, for the folder `home`. */
async function plantConversation(box, harness, home, id, started) {
  const file = harness === 'codex'
    ? path.join(
      box.home, '.codex', 'sessions', ...started.slice(0, 10).split('-'),
      `rollout-${started.replaceAll(':', '-').replace(/\..*$/, '')}-${id}.jsonl`,
    )
    : path.join(box.home, '.claude', 'projects', home.replaceAll(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  const first = harness === 'codex'
    ? { timestamp: started, type: 'session_meta', payload: { id, cwd: home, timestamp: started } }
    : { type: 'system', sessionId: id, cwd: home, timestamp: started };

  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(first)}\n`);
}

/** Change what one bot's book says about its sessions, as a person editing it by hand would. */
async function editBook(bots, bot, change) {
  const file = bookOf(bots, bot);
  const book = parse(await readFile(file, 'utf8'));
  change(book.sessions);
  await writeFile(file, stringify(book));
}

/** The ids a conversation is known by in these tests: shaped the way both harnesses shape them. */
const conv = (n) => `0199b2c0-${String(n).padStart(4, '0')}-4444-8888-cccccccccccc`;

test('H27 a Claude conversation on record in a bot\'s folder that the book does not name is reported, with when it began', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  const home = await botUp(box, 'api-bot');
  await plantConversation(box, 'claude', home, conv(1), onTheDay(9, 15));

  const answer = await found(box);

  const mine = of(answer, { kind: 'session', bot: 'api-bot' });
  const finding = oneNaming(mine, conv(1), 'the harness has it on record in this bot\'s folder and the book does not');
  const words = wordsOf(finding);
  assert.ok(words.includes('2026-09-20T09:15'), `it should say when the conversation began, got: ${words}`);
  // What to do about it, in the terms the book and the kit use.
  assert.match(words, /session:/, `it should say how to give it to a session in the book, got: ${words}`);
  assert.match(words, /obk up/, `and what to run after, got: ${words}`);
  assert.doesNotMatch(words, /worktree/i, 'obk never says "worktree"');
  noneNaming(of(answer, { bot: 'bot-father' }), conv(1), 'it ran in api-bot\'s folder, not Bot Father\'s');
});

test('H27 a conversation the book names now, before, or as unclaimed is not reported; one it does not name beside them is', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const home = await botUp(box, 'api-bot', { sessions: [['daily'], ['nightly']] });
  const [now, before, unclaimed, stray] = [conv(1), conv(2), conv(3), conv(4)];
  for (const [n, id] of [now, before, unclaimed, stray].entries()) {
    await plantConversation(box, 'claude', home, id, onTheDay(9 + n));
  }
  await editBook(bots, 'api-bot', (sessions) => {
    sessions.daily.session = now;
    sessions.daily.history = [{ session: before, ended: 'clear', at: onTheDay(10, 30) }];
    sessions.nightly.unclaimed = [unclaimed];
  });

  const answer = await found(box);

  const mine = of(answer, { kind: 'session', bot: 'api-bot' });
  assert.equal(mine.length, 1, `one finding for the one conversation the book does not name, got: ${JSON.stringify(mine, null, 2)}`);
  oneNaming(mine, stray, 'no session of the book names it');
  noneNaming(mine, now, 'the book names it as daily\'s conversation now');
  noneNaming(mine, before, 'the book names it in daily\'s history');
  noneNaming(mine, unclaimed, 'the book names it as unclaimed, which is reported on its own already');
});

test('H27 every harness the bot\'s sessions run on is read, and what neither names makes one finding for the bot', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  const home = await botUp(box, 'api-bot', { sessions: [['daily'], ['nightly', '--harness', 'codex']] });
  await plantConversation(box, 'claude', home, conv(1), onTheDay(9));
  await plantConversation(box, 'codex', home, conv(2), onTheDay(11, 40));

  const answer = await found(box);

  const mine = of(answer, { kind: 'session', bot: 'api-bot' });
  assert.equal(mine.length, 1, `one finding per bot, however many conversations, got: ${JSON.stringify(mine, null, 2)}`);
  const words = wordsOf(mine[0]);
  assert.ok(words.includes(conv(1)), `the Claude Code conversation, got: ${words}`);
  assert.ok(words.includes(conv(2)), `the Codex conversation, got: ${words}`);
  assert.ok(words.includes('2026-09-20T11:40'), `and when the Codex one began, got: ${words}`);
});

test('H27 a Codex conversation belongs to the bot whose folder it ran in', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  const api = await botUp(box, 'api-bot', { harness: 'codex' });
  const web = await botUp(box, 'web-bot', { harness: 'codex' });
  await plantConversation(box, 'codex', api, conv(1), onTheDay(9));
  await plantConversation(box, 'codex', web, conv(2), onTheDay(10));

  const answer = await found(box);

  const apiSaid = of(answer, { kind: 'session', bot: 'api-bot' });
  const webSaid = of(answer, { kind: 'session', bot: 'web-bot' });
  oneNaming(apiSaid, conv(1), 'it ran in api-bot\'s folder');
  noneNaming(apiSaid, conv(2), 'it ran in web-bot\'s folder');
  oneNaming(webSaid, conv(2), 'it ran in web-bot\'s folder');
  noneNaming(webSaid, conv(1), 'it ran in api-bot\'s folder');
});

test('H27 a bot whose every conversation on record is in the book reports nothing about them', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const home = await botUp(box, 'api-bot', { sessions: [['daily'], ['nightly', '--harness', 'codex']] });
  await plantConversation(box, 'claude', home, conv(1), onTheDay(9));
  await plantConversation(box, 'claude', home, conv(2), onTheDay(10));
  await plantConversation(box, 'codex', home, conv(3), onTheDay(11));
  await editBook(bots, 'api-bot', (sessions) => {
    sessions.daily.session = conv(2);
    sessions.daily.history = [{ session: conv(1), ended: 'clear', at: onTheDay(9, 30) }];
    sessions.nightly.session = conv(3);
  });

  const answer = await found(box);

  assert.deepEqual(answer.found, [], `the book names every conversation the harnesses have, got: ${JSON.stringify(answer.found, null, 2)}`);
});

// ---------------------------------------------------------------------------
// H17 to H22 — the command itself.
// ---------------------------------------------------------------------------

test('H17 a fleet with nothing wrong reports nothing, says so, and exits 0', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot');

  const answer = await found(box);
  const plain = await health(box);

  assert.deepEqual(answer.found, [], `a fleet the kit made and opened itself has nothing wrong with it, got: ${JSON.stringify(answer.found, null, 2)}`);
  assert.equal(plain.code, 0, plain.stderr);
  assert.equal(plain.stderr, '');
  assert.notEqual(plain.stdout.trim(), '', 'a clean fleet is told so, not answered with silence');
  assert.ok(plain.stdout.includes(bots), `and the report names the bots folder, got: ${plain.stdout}`);
});

test('H18 --bot narrows the bot checks and leaves the fleet-wide findings alone', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot');
  await orcaSettings(box, { claude: BYPASS.claude, codex: '' });
  const ghost = path.join(bots, 'bots', 'ghost-bot');
  await plantProject(box, ghost, 'Ghost Bot');
  await addSkills(botYamlOf(bots, 'api-bot'), 'no-such-skill');
  await rm(hookFileOf(bots, 'bot-father', 'claude'));

  const answer = await found(box, '--bot', 'api-bot');

  oneNaming(of(answer, { bot: 'api-bot' }), 'no-such-skill', 'the bot that was asked about');
  assert.deepEqual(of(answer, { bot: 'bot-father' }), [], 'nothing about the bot that was not asked about');
  oneNaming(of(answer, { kind: 'orca' }), 'claude', 'Orca\'s setting is the fleet\'s, whichever bot was named');
  oneNaming(of(answer, { kind: 'leftover' }), ghost, 'and so is a project no bot owns');
});

test('H19 the plain lines carry every fact the JSON carries', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot');
  await orcaSettings(box, { claude: BYPASS.claude, codex: '' });
  await plantProject(box, path.join(bots, 'bots', 'ghost-bot'), 'Ghost Bot');
  await addSkills(botYamlOf(bots, 'api-bot'), 'no-such-skill');
  await rm(hookFileOf(bots, 'bot-father', 'claude'));

  const answer = await found(box);
  const plain = await health(box);

  assert.ok(answer.found.length >= 4, `this fleet should have several things wrong with it, got: ${JSON.stringify(answer.found, null, 2)}`);
  assert.equal(plain.code, 1, 'the same run, so the same answer');
  assert.equal(plain.stderr, '');

  const lines = plain.stdout.split('\n');
  for (const finding of answer.found) {
    assert.ok(
      lines.some((line) => line.includes(finding.kind) && line.includes(finding.where)),
      `one line should hold the kind and the where of ${JSON.stringify(finding)}, got:\n${plain.stdout}`,
    );
    assert.ok(
      flat(plain.stdout).includes(flat(finding.says)),
      `and the lines under it should say what the JSON says, got:\n${plain.stdout}`,
    );
  }
  assert.ok(
    plain.stdout.trimEnd().split('\n').at(-1).includes(bots),
    `the last line names the bots folder this was about, got:\n${plain.stdout}`,
  );
});

test('the findings come in one order: Orca, then leftovers, then the bots by name', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot');
  await orcaSettings(box, { claude: BYPASS.claude, codex: '' });
  await plantProject(box, path.join(bots, 'bots', 'ghost-bot'), 'Ghost Bot');
  await addSkills(botYamlOf(bots, 'api-bot'), 'no-such-skill');
  await rm(hookFileOf(bots, 'bot-father', 'claude'));

  const answer = await found(box);

  const fleet = answer.found.filter((one) => one.bot === undefined);
  const perBot = answer.found.filter((one) => one.bot !== undefined);
  assert.notEqual(fleet.length, 0);
  assert.notEqual(perBot.length, 0);
  assert.deepEqual(answer.found, [...fleet, ...perBot], 'the fleet-wide findings come first');
  assert.deepEqual(
    fleet.map((one) => one.kind),
    [...fleet.filter((one) => one.kind === 'orca'), ...fleet.filter((one) => one.kind !== 'orca')].map((one) => one.kind),
    'Orca\'s own setting before the leftovers',
  );
  assert.deepEqual(
    perBot.map((one) => one.bot),
    [...perBot].sort((one, other) => (one.bot < other.bot ? -1 : 1)).map((one) => one.bot),
    'and the bots in name order',
  );
});

test('H20 health refuses when Orca is not answering, and reports nothing', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  const asked = (await box.orca.calls()).length;
  await box.orca.set({ reachable: false });

  const result = await health(box);

  assertCleanFailure(result);
  assert.match(result.stderr, /not answering/i, `the kit's own sentence about an Orca that is out, got: ${result.stderr}`);
  assert.deepEqual(
    (await box.orca.calls()).slice(asked).map(orcaCommand),
    ['status'],
    'once Orca is out, the kit must stop asking it for things',
  );
});

test('H21 health names a bot that is not there, and says which bots there are', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);

  const result = await health(box, '--bot', 'no-such-bot');

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('no-such-bot'), `should name what was asked for, got: ${result.stderr}`);
  assert.ok(result.stderr.includes('bot-father'), `and the bots there are, got: ${result.stderr}`);
});

test('health without --bots fails and says which flag it wanted', async (t) => {
  const box = await createSandbox(t);

  const missing = await box.run(['health']);
  const empty = await box.run(['health', '--bots', '']);

  for (const result of [missing, empty]) {
    assertCleanFailure(result);
    assert.ok(result.stderr.includes('--bots'), `should name --bots, got: ${result.stderr}`);
  }
});

test('H22 health changes nothing at all: not a file, not a link, not a tab', async (t) => {
  // The one that matters more than any other. A check that repairs what it
  // finds is not a check: the user asked what is wrong, and every answer here
  // is something only they can decide about (PRD 6.8).
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot', { sessions: [['daily'], ['nightly', '--harness', 'codex']] });

  // A fleet with several things wrong with it, and one of each kind: every
  // finding is a chance to write something back.
  await orcaSettings(box, { claude: BYPASS.claude, codex: '' });
  await plantProject(box, path.join(bots, 'bots', 'ghost-bot'), 'Ghost Bot');
  await mkdir(`${bots}.prompts`, { recursive: true });
  await writeFile(path.join(`${bots}.prompts`, 'api-bot.gone.txt'), 'A duty nobody has.\n');
  await addSkills(botYamlOf(bots, 'api-bot'), 'no-such-skill');
  await rm(hookFileOf(bots, 'api-bot', 'codex'));
  await rm(agentsOf(bots, 'bot-father'));
  await closeTab(box, await tabOf(bots, 'api-bot', 'daily'));
  await plantTab(box, botHomeOf(bots, 'api-bot'), 'tab_stray', 'Api Bot something');
  // Conversations on record that the book does not name, one per harness: the
  // harnesses' own files are read, and neither they nor the book are written.
  await plantConversation(box, 'claude', botHomeOf(bots, 'api-bot'), conv(1), onTheDay(9));
  await plantConversation(box, 'codex', botHomeOf(bots, 'api-bot'), conv(2), onTheDay(10));

  // The whole sandbox: the bots folder, everything beside it, and the home
  // directory, where Orca's own settings live.
  const before = await snapshot(box.root, skipOrcaFake);
  const setups = await box.orca.setups();
  const terminals = await box.orca.terminals();
  const asked = (await box.orca.calls()).length;

  const answer = await found(box);
  const plain = await health(box);

  assert.ok(answer.found.length >= 5, `the fleet should be in trouble, or this proves nothing, got: ${JSON.stringify(answer.found, null, 2)}`);
  assert.equal(plain.code, 1, plain.stderr);
  assert.deepEqual(await snapshot(box.root, skipOrcaFake), before, 'every file and every link should be exactly as it was found');
  assert.deepEqual(await box.orca.setups(), setups, 'no Orca project made, changed or taken away');
  assert.deepEqual(await box.orca.terminals(), terminals, 'no tab opened, retitled or typed into');
  assert.deepEqual(
    [...new Set((await box.orca.calls()).slice(asked).map(orcaCommand))].sort(),
    ['project setups', 'status', 'terminal list'],
    'the only things a check may ask Orca are the ones that tell it something',
  );
});

// ---------------------------------------------------------------------------
// H23 — the same reminder in `obk init`, which is the kit's setup command.
//
// PRD 6.5: the kit "checks it during setup and in its health check, and when it
// finds a bypass there it reminds the user to change it to something safer, in
// plain words, every time". Setup is where a user is standing when they can
// still put it right, and a permission bypass they were never told about is the
// whole reason that sentence is in the PRD.
// ---------------------------------------------------------------------------

/**
 * A first `obk init` twice over, plainly and as JSON, on two sandboxes in the
 * same state. Answers the second sandbox too, because anything read out of one
 * run and looked for in the other has to have the sandbox taken out of it.
 *
 * Two sandboxes rather than two runs in one: a first init and a second one
 * report different things, and this is about the first.
 */
async function initBoth(box, t, agentDefaultArgs) {
  await orcaSettings(box, agentDefaultArgs);
  const plain = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  const other = await createSandbox(t);
  await orcaSettings(other, agentDefaultArgs);
  const asJson = await other.run(['init', '--bots', 'bots', '--harness', 'claude', '--json']);

  return { plain, asJson, other };
}

/**
 * A report with everything that differs between sandboxes taken out of it, so
 * a sentence from one run can be looked for in the other's lines. The findings
 * here name the files they are about, and every one of those paths is inside
 * the sandbox that produced it.
 */
const withoutTheSandbox = (box, text) => text.split(box.root).join('<sandbox>');

for (const [label, agentDefaultArgs] of [
  ['records a bypass for claude', { claude: BYPASS.claude, codex: '' }],
  ['records nothing for claude, which is the bypass it falls back to', { codex: '' }],
]) {
  test(`H23 init reminds the user when Orca ${label}, and still exits 0`, async (t) => {
    const box = await createSandbox(t);

    const { plain, asJson, other } = await initBoth(box, t, agentDefaultArgs);

    // A reminder is not a failure of init: the setup worked, and what is left
    // is a setting only the user can change.
    assert.equal(plain.code, 0, plain.stderr);
    assert.equal(plain.stderr, '');
    assert.equal(asJson.code, 0, asJson.stderr);

    const answer = JSON.parse(asJson.stdout);
    assert.ok(Array.isArray(answer.found), `init should carry what it found, got: ${asJson.stdout}`);
    const finding = oneNaming(answer.found, 'claude', 'the harness Orca would start with a bypass');
    assert.equal(finding.kind, 'orca');
    assert.ok(
      wordsOf(finding).includes(BYPASS.claude),
      `the user has to know which argument to change, got: ${JSON.stringify(finding, null, 2)}`,
    );
    // Setup checks Orca's setting and nothing else: a folder init has just made
    // has nothing else to say about itself.
    assert.deepEqual(
      [...new Set(answer.found.map((one) => one.kind))],
      ['orca'],
      `init carries the Orca setting alone, got: ${JSON.stringify(answer.found, null, 2)}`,
    );

    // In the plain lines as well, because most people never ask for JSON. The
    // sentence names the settings file it read, which is inside whichever
    // sandbox produced it, so both sides lose their own sandbox first.
    assert.ok(
      flat(withoutTheSandbox(box, plain.stdout)).includes(flat(withoutTheSandbox(other, finding.says))),
      `the plain report should carry the reminder too, got:\n${plain.stdout}`,
    );
    // And everything init already answered is still there.
    assert.ok(Array.isArray(answer.tabs) && answer.tabs.length > 0, `init still answers about its tabs, got: ${asJson.stdout}`);
    assert.ok(plain.stdout.includes('Bot Father daily'), `and still names the tab it opened, got: ${plain.stdout}`);
    assert.ok(plain.stdout.includes(box.path('bots')), `and the bots folder it made, got: ${plain.stdout}`);
  });
}

test('H23 init says nothing about Orca\'s setting when the recorded arguments are harmless', async (t) => {
  const box = await createSandbox(t);

  const { plain, asJson } = await initBoth(box, t, { claude: '--model opus', codex: '' });

  assert.equal(plain.code, 0, plain.stderr);
  assert.equal(asJson.code, 0, asJson.stderr);
  assert.deepEqual(
    (JSON.parse(asJson.stdout).found ?? []).filter((one) => one.kind === 'orca'),
    [],
    'nothing has taken the permission level out of the kit\'s hands',
  );
  for (const bypass of Object.values(BYPASS)) {
    assert.ok(!plain.stdout.includes(bypass), `and the lines say nothing about a bypass, got:\n${plain.stdout}`);
  }
  assert.ok(plain.stdout.includes('Bot Father daily'), `init reports what it always did, got: ${plain.stdout}`);
});
