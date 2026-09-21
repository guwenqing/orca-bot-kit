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
// Orca. Orca's own settings file lives under the home directory, and HOME is
// inside every sandbox, so the tests plant it there.

import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import {
  assertCleanFailure,
  bookOf,
  botHomeOf,
  createSandbox,
  hookFileOf,
  orcaCommand,
  sessionIn,
  skipOrcaFake,
  snapshot,
} from './helpers/cli.js';
import { addRules, agentsIn, agentsOf, END_MARKER } from './helpers/rules.js';
import {
  addSkills,
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
 * Where Orca keeps its own settings on this machine: a file under the user's
 * home directory, which the kit reads and never writes. `settings.agentDefaultArgs`
 * maps an agent name to the extra launch arguments Orca starts it with.
 */
const orcaSettingsOf = (box) => path.join(
  box.home,
  'Library',
  'Application Support',
  'orca',
  'profiles',
  'local-default',
  'orca-data.json',
);

/** Say what Orca's own per-agent default launch arguments are. */
async function orcaSettings(box, agentDefaultArgs) {
  const file = orcaSettingsOf(box);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify({ settings: { agentDefaultArgs } }, null, 2)}\n`);
  return file;
}

/** What each harness's permission bypass is spelled, as Orca would record it. */
const BYPASS = {
  claude: '--dangerously-skip-permissions',
  codex: '--dangerously-bypass-approvals-and-sandbox',
};

/** The harnesses the kit cares about. */
const HARNESSES = Object.keys(BYPASS);

/** Arguments carrying no bypass, so a test about something else hears nothing about Orca. */
const HARMLESS = { claude: '', codex: '' };

/** A bots folder with Bot Father up in Orca, and Orca's own setting harmless. */
async function seeded(box, harness = 'claude') {
  await orcaSettings(box, HARMLESS);
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
  const box = await createSandbox(t);
  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(result.code, 0, result.stderr);

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
    assert.match(
      finding.says,
      /tabs?/i,
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

test('H13 a skills list the kit cannot follow is reported', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await botUp(box, 'api-bot');
  await addSkills(botYamlOf(bots, 'api-bot'), 'no-such-skill');

  const answer = await found(box);

  const mine = of(answer, { kind: 'skill', bot: 'api-bot' });
  oneNaming(mine, 'no-such-skill', 'the entry in the list is what the user has to put right');
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
