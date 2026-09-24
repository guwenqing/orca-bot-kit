// When `obk skills build` changes a bot's skill links, the bot's running
// sessions are told, each through its own harness's means, and nothing is ever
// restarted (#231, PRD 6.5).
//
// The two harnesses differ, and both were proven live. Claude Code has its own
// command, `/reload-skills`: typed into the tab it runs as a command rather
// than reaching the model as text, and a busy tab queues it until its turn
// ends. Codex has none and needs none: it takes an added or removed skill at
// the start of its next turn by itself. So a Claude session gets one line typed
// into its own tab, and a Codex session gets nothing typed and a line in the
// kit's output saying when it takes the change, that a restart makes a missing
// skill appear, and which SKILL.md it can read meanwhile.
//
// Where the kit may type is the gate the mail nudge already uses: the tab the
// book holds for that session, listed by Orca, with a harness up in it and
// nothing on screen waiting to be answered. A busy harness counts as up
// (#232). Everything else is a session that is not told — not up, blocked, or
// unknown when Orca cannot be asked or the gate cannot tell — and the links
// are made all the same.
//
// Only `skills build` tells anyone, and only for a bot whose links that run
// changed. `skills add` and `skills remove` write a list and nothing more.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  assertOrcaCallsAllowed,
  bookOf,
  botHomeOf,
  createSandbox,
  orcaCallsOf,
  sentInto,
  sessionIn,
} from './helpers/cli.js';
import {
  addSkills,
  answerOf,
  assertLinked,
  botYamlOf,
  commonSkill,
  entryOf,
  heldBy,
  kitSkill,
  setSkills,
  SKILL_DIRS,
  skillsDirOf,
  writeSkill,
} from './helpers/skills.js';

/** One of the kit's own skills, named here so a test that meets it says which. */
const KIT_SKILL = 'obk-tdd';

/** Claude Code's own command for picking up skills changed on disk. */
const RELOAD = '/reload-skills';

/** The bot whose list the tests change, and the one beside it whose list they leave alone. */
const BOT = 'api-bot';
const OTHER = 'web-bot';

/**
 * A fleet that is up: Bot Father, `api-bot` with the sessions asked for (a
 * Claude one and a Codex one unless the test says otherwise), and `web-bot`
 * with one Claude session. Every tab has had its launch line and nothing since.
 */
async function fleetIn(box, { sessions = [['daily', 'claude'], ['reviewer', 'codex']] } = {}) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  for (const bot of [BOT, OTHER]) {
    const made = await box.run([
      'bot', 'create', '--bots', 'bots', '--name', bot, '--harness', 'claude',
      '--charter', `${bot} owns its own corner.`,
    ]);
    assert.equal(made.code, 0, made.stderr);
  }
  for (const [session, harness] of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', session, '--harness', harness]);
    assert.equal(added.code, 0, added.stderr);
  }
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', OTHER, '--name', 'daily']);
  assert.equal(added.code, 0, added.stderr);
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  return box.path('bots');
}

/** `obk skills build`, with whatever else the test wants to say. */
const build = (box, ...rest) => box.run(['skills', 'build', '--bots', 'bots', ...rest]);

/** The tab one session lives in, as the book has it. */
const tabOf = async (bots, bot, session) => (await sessionIn(bots, bot, session)).tab;

/** Each `terminal send` into every tab of the fleet since its launch line, `{ text, enter }`, by tab id. */
async function sentSinceLaunch(box) {
  const after = {};
  for (const terminal of await box.orca.terminals()) {
    after[terminal.tabId] = sentInto(terminal).slice(1);
  }
  return after;
}

/** What was typed into one session's tab since its launch line. */
const sentToSession = async (box, bots, bot, session) => (await sentSinceLaunch(box))[await tabOf(bots, bot, session)];

/** The SKILL.md a Codex session of `bot` can read for `name`: through the bot's own link. */
const codexSkillMd = (bots, bot, name) => path.join(botHomeOf(bots, bot), SKILL_DIRS.codex, name, 'SKILL.md');

/** The session entries of one bot in a `--json` answer. */
function sessionsOf(result, bot) {
  const entry = entryOf(answerOf(result), bot);
  assert.ok(Array.isArray(entry.sessions), `${bot}'s links changed, so its entry should list its sessions, got: ${JSON.stringify(entry)}`);
  return entry.sessions;
}

/** The lines of a plain report that name `<bot>/<session>`; at least one. */
function linesNaming(stdout, bot, session) {
  const lines = stdout.split('\n').filter((line) => line.includes(`${bot}/${session}`));
  assert.notEqual(lines.length, 0, `the report should name ${bot}/${session}, got:\n${stdout}`);
  return lines.join('\n');
}

test('a running Claude session of a changed bot gets /reload-skills in its own tab, and no other tab gets anything', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await addSkills(botYamlOf(bots, BOT), `kit:${KIT_SKILL}`);

  const result = await build(box);

  assert.equal(result.code, 0, result.stderr);
  const sent = await sentSinceLaunch(box);
  const own = await tabOf(bots, BOT, 'daily');
  assert.deepEqual(sent[own], [{ text: RELOAD, enter: true }], 'one line, the reload command, sent off with return');
  // The Codex session's tab, the other bots' tabs and Bot Father's ops tab,
  // which the book does not hold at all.
  for (const [tab, lines] of Object.entries(sent)) {
    if (tab === own) continue;
    assert.deepEqual(lines, [], `nothing may be typed into ${tab}: it is not a running Claude session of ${BOT}`);
  }
});

test('the --json answer says the Claude session was reloaded and the Codex session takes it next turn, with the SKILL.md to read', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await addSkills(botYamlOf(bots, BOT), `kit:${KIT_SKILL}`);

  const result = await build(box, '--json');

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(sessionsOf(result, BOT), [
    { session: 'daily', harness: 'claude', state: 'reloaded' },
    { session: 'reviewer', harness: 'codex', state: 'next-turn', read: [codexSkillMd(bots, BOT, KIT_SKILL)] },
  ]);
});

test('the Codex session gets nothing typed; the report names it, says next turn and restart, and gives the SKILL.md path', async (t) => {
  // The kit cannot see the session's next turn, so this line is the whole of
  // what it can do: say when the change lands, what fixes a skill that did not,
  // and what the session can read in the meantime.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await addSkills(botYamlOf(bots, BOT), `kit:${KIT_SKILL}`);

  const result = await build(box);

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await sentToSession(box, bots, BOT, 'reviewer'), [], 'Codex has no reload command, so nothing is typed');
  const line = linesNaming(result.stdout, BOT, 'reviewer');
  assert.match(line, /next turn/i, `the Codex line should say it takes the change at its next turn, got: ${line}`);
  assert.match(line, /restart/i, `and that a restart makes a missing skill appear, got: ${line}`);
  assert.ok(
    result.stdout.includes(codexSkillMd(bots, BOT, KIT_SKILL)),
    `and the SKILL.md it can read meanwhile, by its path, got:\n${result.stdout}`,
  );
  // The Claude session is named too: told sessions are reported as well as untold ones.
  linesNaming(result.stdout, BOT, 'daily');
});

test('the Codex session is given one SKILL.md for each skill the run linked in', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await commonSkill(bots, 'house-style');
  await writeSkill(path.join(box.root, 'elsewhere', 'deploy-notes'));
  await addSkills(botYamlOf(bots, BOT), 'house-style', path.join(box.root, 'elsewhere', 'deploy-notes'));

  const result = await build(box, '--json');

  assert.equal(result.code, 0, result.stderr);
  const reviewer = sessionsOf(result, BOT).find((entry) => entry.session === 'reviewer');
  assert.equal(reviewer?.state, 'next-turn', `got: ${JSON.stringify(reviewer)}`);
  assert.deepEqual(
    [...reviewer.read].sort(),
    [codexSkillMd(bots, BOT, 'deploy-notes'), codexSkillMd(bots, BOT, 'house-style')],
  );
});

test('every session of the bot is reported in the bot\'s own order, and each Claude tab gets its own one line', async (t) => {
  // Not name order: `night` was added first. And two Claude sessions, so a
  // line meant for one that lands in the other's tab shows up as two and none.
  const sessions = [['night', 'claude'], ['reviewer', 'codex'], ['daily', 'claude']];
  const box = await createSandbox(t);
  const bots = await fleetIn(box, { sessions });
  await addSkills(botYamlOf(bots, BOT), `kit:${KIT_SKILL}`);

  const result = await build(box, '--json');

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(
    sessionsOf(result, BOT).map((entry) => [entry.session, entry.harness, entry.state]),
    [['night', 'claude', 'reloaded'], ['reviewer', 'codex', 'next-turn'], ['daily', 'claude', 'reloaded']],
  );
  for (const session of ['night', 'daily']) {
    assert.deepEqual(await sentToSession(box, bots, BOT, session), [{ text: RELOAD, enter: true }], `${session}'s own tab, once`);
  }
});

test('a run that only takes links away tells the sessions too, and gives the Codex session nothing to read', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await addSkills(botYamlOf(bots, BOT), `kit:${KIT_SKILL}`);
  assert.equal((await build(box)).code, 0);
  const before = await sentToSession(box, bots, BOT, 'daily');

  await setSkills(botYamlOf(bots, BOT));
  const result = await build(box, '--json');

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(sessionsOf(result, BOT), [
    { session: 'daily', harness: 'claude', state: 'reloaded' },
    { session: 'reviewer', harness: 'codex', state: 'next-turn', read: [] },
  ]);
  assert.deepEqual(
    (await sentToSession(box, bots, BOT, 'daily')).slice(before.length),
    [{ text: RELOAD, enter: true }],
    'a skill taken away is a change the Claude session has to pick up as well',
  );
});

test('a link repointed at another directory tells the sessions', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const one = await writeSkill(path.join(box.root, 'one', 'road-map'), { body: 'Version one.' });
  const two = await writeSkill(path.join(box.root, 'two', 'road-map'), { body: 'Version two.' });
  await addSkills(botYamlOf(bots, BOT), one);
  assert.equal((await build(box)).code, 0);
  const before = await sentToSession(box, bots, BOT, 'daily');

  await setSkills(botYamlOf(bots, BOT), two);
  const result = await build(box, '--json');

  assert.equal(result.code, 0, result.stderr);
  await assertLinked(bots, BOT, 'road-map', two);
  assert.deepEqual(
    sessionsOf(result, BOT).map((entry) => [entry.session, entry.state]),
    [['daily', 'reloaded'], ['reviewer', 'next-turn']],
  );
  assert.deepEqual((await sentToSession(box, bots, BOT, 'daily')).slice(before.length), [{ text: RELOAD, enter: true }]);
});

test('a bot whose links did not change gets nothing typed and no session report', async (t) => {
  // The whole fleet is built; only api-bot's list moved. Bot Father and
  // web-bot are up, and their links are exactly what they were.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await addSkills(botYamlOf(bots, BOT), `kit:${KIT_SKILL}`);

  const result = await build(box, '--json');

  assert.equal(result.code, 0, result.stderr);
  const answer = answerOf(result);
  assert.ok(Array.isArray(entryOf(answer, BOT).sessions), 'the bot that changed is reported with its sessions');
  for (const bot of [OTHER, 'bot-father']) {
    assert.ok(!('sessions' in entryOf(answer, bot)), `${bot}'s links did not change, got: ${JSON.stringify(entryOf(answer, bot))}`);
  }
  assert.deepEqual(await sentToSession(box, bots, OTHER, 'daily'), []);
  assert.deepEqual(await sentToSession(box, bots, 'bot-father', 'daily'), []);
  assert.deepEqual(await sentToSession(box, bots, BOT, 'daily'), [{ text: RELOAD, enter: true }], 'while the one that changed is told');
});

test('a build that changes nothing tells nobody, the second time round', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await addSkills(botYamlOf(bots, BOT), `kit:${KIT_SKILL}`);
  assert.equal((await build(box)).code, 0);
  const before = await sentSinceLaunch(box);
  assert.deepEqual(before[await tabOf(bots, BOT, 'daily')], [{ text: RELOAD, enter: true }], 'the first build told the session');

  const result = await build(box, '--json');

  assert.equal(result.code, 0, result.stderr);
  assert.ok(!('sessions' in entryOf(answerOf(result), BOT)), `nothing changed, got: ${JSON.stringify(entryOf(answerOf(result), BOT))}`);
  assert.deepEqual(await sentSinceLaunch(box), before, 'and nothing more is typed anywhere');
  assert.doesNotMatch(result.stdout, new RegExp(`${BOT}/`), 'and no session is named');
});

test('skills add and skills remove only write the list: they type nothing into any tab', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);

  const added = await box.run(['skills', 'add', '--bots', 'bots', '--bot', BOT, '--skill', `kit:${KIT_SKILL}`]);
  assert.equal(added.code, 0, added.stderr);
  assert.deepEqual(Object.values(await sentSinceLaunch(box)).flat(), [], 'skills add typed nothing');

  const removed = await box.run(['skills', 'remove', '--bots', 'bots', '--bot', BOT, '--skill', `kit:${KIT_SKILL}`]);
  assert.equal(removed.code, 0, removed.stderr);
  assert.deepEqual(Object.values(await sentSinceLaunch(box)).flat(), [], 'skills remove typed nothing');

  // The same list change, built, is told: the two above were quiet because
  // they are not the build, not because nothing would have been sent.
  await addSkills(botYamlOf(bots, BOT), `kit:${KIT_SKILL}`);
  assert.equal((await build(box)).code, 0);
  assert.deepEqual(await sentToSession(box, bots, BOT, 'daily'), [{ text: RELOAD, enter: true }]);
});

test('a session that has never been up is reported not up, and the running one beside it is still told', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'night']);
  assert.equal(added.code, 0, added.stderr);
  await addSkills(botYamlOf(bots, BOT), `kit:${KIT_SKILL}`);

  const result = await build(box, '--json');

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(sessionsOf(result, BOT), [
    { session: 'daily', harness: 'claude', state: 'reloaded' },
    { session: 'reviewer', harness: 'codex', state: 'next-turn', read: [codexSkillMd(bots, BOT, KIT_SKILL)] },
    { session: 'night', harness: 'claude', state: 'not-up' },
  ]);
  // Only daily's tab: `night` has none, and no other tab stands in for it.
  const sent = await sentSinceLaunch(box);
  const own = await tabOf(bots, BOT, 'daily');
  for (const [tab, lines] of Object.entries(sent)) {
    assert.deepEqual(lines, tab === own ? [{ text: RELOAD, enter: true }] : [], `what was typed into ${tab}`);
  }
});

test('a session whose tab Orca no longer lists is reported not up, and nothing is typed for it', async (t) => {
  // The user closed it. The book still holds the tab id, and nothing is there.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const closed = await tabOf(bots, BOT, 'daily');
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((terminal) => terminal.tabId !== closed) });
  await addSkills(botYamlOf(bots, BOT), `kit:${KIT_SKILL}`);

  const result = await build(box, '--json');

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(sessionsOf(result, BOT), [
    { session: 'daily', harness: 'claude', state: 'not-up' },
    { session: 'reviewer', harness: 'codex', state: 'next-turn', read: [codexSkillMd(bots, BOT, KIT_SKILL)] },
  ]);
  assert.deepEqual(Object.values(await sentSinceLaunch(box)).flat(), [], 'nothing typed into anybody else\'s tab in its place');
});

test('a tab with only a shell in it is not typed into, and both sessions are reported not up', async (t) => {
  // Orca refuses the wait with `timeout` when there is no TUI in the tab: a
  // plain shell prompt, or a harness that died. Nobody is there to reload.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await box.orca.set({ waitIdle: false });
  await addSkills(botYamlOf(bots, BOT), `kit:${KIT_SKILL}`);

  const result = await build(box, '--json');

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(sessionsOf(result, BOT), [
    { session: 'daily', harness: 'claude', state: 'not-up' },
    { session: 'reviewer', harness: 'codex', state: 'not-up' },
  ]);
  assert.deepEqual(Object.values(await sentSinceLaunch(box)).flat(), []);
  await assertLinked(bots, BOT, KIT_SKILL, await kitSkill(KIT_SKILL));
});

test('a tab with something on screen to answer is not typed into, and is reported blocked with Orca\'s reason', async (t) => {
  // The next return in such a tab answers the question on screen. Slice 03
  // saw a line typed onto Claude's folder-trust list confirm `No, exit`.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await box.orca.set({ waitIdle: 'blocked' });
  await addSkills(botYamlOf(bots, BOT), `kit:${KIT_SKILL}`);

  const result = await build(box, '--json');

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(sessionsOf(result, BOT), [
    { session: 'daily', harness: 'claude', state: 'blocked', blocked: 'agent-interactive-prompt' },
    { session: 'reviewer', harness: 'codex', state: 'blocked', blocked: 'agent-interactive-prompt' },
  ]);
  assert.deepEqual(Object.values(await sentSinceLaunch(box)).flat(), []);
});

test('a busy session is told as a running one is: Claude gets /reload-skills, Codex takes it next turn', async (t) => {
  // Orca's wait times out on a harness at work just as on a shell, but the
  // harness is in front of its tab (#232). Proven live: a busy Claude tab
  // queues the command and runs it when its turn ends.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await box.orca.set({ waitIdle: 'busy' });
  await addSkills(botYamlOf(bots, BOT), `kit:${KIT_SKILL}`);

  const result = await build(box, '--json');

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(sessionsOf(result, BOT), [
    { session: 'daily', harness: 'claude', state: 'reloaded' },
    { session: 'reviewer', harness: 'codex', state: 'next-turn', read: [codexSkillMd(bots, BOT, KIT_SKILL)] },
  ]);
  const sent = await sentSinceLaunch(box);
  const own = await tabOf(bots, BOT, 'daily');
  for (const [tab, lines] of Object.entries(sent)) {
    assert.deepEqual(lines, tab === own ? [{ text: RELOAD, enter: true }] : [], `what was typed into ${tab}`);
  }
});

test('a tab with a program in front that is not the harness Orca names is not typed into, and is reported unknown', async (t) => {
  // Seen live (PR #260): the harness quit and the user ran `less`; Orca still
  // named the harness and called the tab idle. A line typed there goes into
  // `less`. The gate cannot tell whether a harness is running, so nothing is
  // typed and nobody is called not up.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await box.orca.set({ waitIdle: true, foreground: 'program' });
  await addSkills(botYamlOf(bots, BOT), `kit:${KIT_SKILL}`);

  const result = await build(box, '--json');

  assert.equal(result.code, 0, `the links were made; only the telling did not happen: ${result.stderr}`);
  await assertLinked(bots, BOT, KIT_SKILL, await kitSkill(KIT_SKILL));
  const sessions = sessionsOf(result, BOT);
  assert.deepEqual(
    sessions.map((entry) => [entry.session, entry.harness, entry.state]),
    [['daily', 'claude', 'unknown'], ['reviewer', 'codex', 'unknown']],
  );
  for (const entry of sessions) {
    assert.equal(typeof entry.trouble, 'string', `why ${entry.session} was not told, got: ${JSON.stringify(entry)}`);
    assert.notEqual(entry.trouble.trim(), '');
  }
  assert.deepEqual(Object.values(await sentSinceLaunch(box)).flat(), []);
});

test('untold sessions are named in the plain report as well', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await box.orca.set({ waitIdle: 'blocked' });
  await addSkills(botYamlOf(bots, BOT), `kit:${KIT_SKILL}`);

  const result = await build(box);

  assert.equal(result.code, 0, result.stderr);
  linesNaming(result.stdout, BOT, 'daily');
  linesNaming(result.stdout, BOT, 'reviewer');
});

for (const [label, steer] of [
  ['cannot be reached', { reachable: false }],
  ['refuses to list the tabs', { fail: { 'terminal list': { code: 'runtime_error', message: 'orca would not list the tabs' } } }],
]) {
  test(`when Orca ${label}, nothing is typed, the links are made, and every session is reported unknown with why`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    await box.orca.set(steer);
    await addSkills(botYamlOf(bots, BOT), `kit:${KIT_SKILL}`);

    const result = await build(box, '--json');

    assert.equal(result.code, 0, `the build did its job; only the telling did not happen: ${result.stderr}`);
    await assertLinked(bots, BOT, KIT_SKILL, await kitSkill(KIT_SKILL));
    const sessions = sessionsOf(result, BOT);
    assert.deepEqual(
      sessions.map((entry) => [entry.session, entry.harness, entry.state]),
      [['daily', 'claude', 'unknown'], ['reviewer', 'codex', 'unknown']],
    );
    for (const entry of sessions) {
      assert.equal(typeof entry.trouble, 'string', `why ${entry.session} was not told, got: ${JSON.stringify(entry)}`);
      assert.notEqual(entry.trouble.trim(), '');
    }
    assert.deepEqual(Object.values(await sentSinceLaunch(box)).flat(), []);
  });
}

test('when Orca cannot be reached, the plain report still names the sessions it did not tell', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await box.orca.set({ reachable: false });
  await addSkills(botYamlOf(bots, BOT), `kit:${KIT_SKILL}`);

  const result = await build(box);

  assert.equal(result.code, 0, result.stderr);
  linesNaming(result.stdout, BOT, 'daily');
  linesNaming(result.stdout, BOT, 'reviewer');
});

test('a /reload-skills Orca refuses to send is reported unknown, not reloaded', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await box.orca.set({ fail: { 'terminal send': { code: 'agent_prompt_blocked', message: 'orca would not take the line' } } });
  await addSkills(botYamlOf(bots, BOT), `kit:${KIT_SKILL}`);

  const result = await build(box, '--json');

  assert.equal(result.code, 0, result.stderr);
  const [daily, reviewer] = sessionsOf(result, BOT);
  assert.equal(daily.session, 'daily');
  assert.equal(daily.state, 'unknown', `a line Orca refused was not typed, got: ${JSON.stringify(daily)}`);
  assert.equal(typeof daily.trouble, 'string', `and it should say why, got: ${JSON.stringify(daily)}`);
  assert.equal(reviewer.state, 'next-turn', 'the Codex session needed nothing sent, so a refused send is nothing to it');
  await assertLinked(bots, BOT, KIT_SKILL, await kitSkill(KIT_SKILL));
});

test('telling the sessions restarts nothing: no tab is opened or closed, and nothing interrupts', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await addSkills(botYamlOf(bots, BOT), `kit:${KIT_SKILL}`);
  const from = (await box.orca.calls()).length;

  const result = await build(box);

  assert.equal(result.code, 0, result.stderr);
  const calls = (await box.orca.calls()).slice(from);
  assert.equal(orcaCallsOf(calls, 'terminal send').length, 1, 'the one reload, so the build did reach Orca');
  assertOrcaCallsAllowed(calls);
  assert.deepEqual(orcaCallsOf(calls, 'terminal create'), [], 'no tab is opened, so no session is started again');
  assert.deepEqual(
    orcaCallsOf(calls, 'terminal send').filter((call) => call.args.includes('--interrupt')),
    [],
    'a busy Claude tab queues the command; interrupting would cut its turn short',
  );
});

test('a tab that now runs the other harness is not typed into, and is reported unknown, both ways round', async (t) => {
  // The book's tab for the Claude session now has Codex in front of it, and
  // Orca names codex there; the Codex session's tab has Claude. `/reload-skills`
  // typed into Codex is text to a model, and a Codex session that is not
  // running Codex takes nothing at its next turn.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const swapped = {
    [await tabOf(bots, BOT, 'daily')]: 'codex',
    [await tabOf(bots, BOT, 'reviewer')]: 'claude',
  };
  await box.orca.set({
    foreground: 'other-harness',
    terminals: (await box.orca.terminals()).map((terminal) => (terminal.tabId in swapped
      ? { ...terminal, agentIdentity: swapped[terminal.tabId] }
      : terminal)),
  });
  await addSkills(botYamlOf(bots, BOT), `kit:${KIT_SKILL}`);

  const result = await build(box, '--json');

  assert.equal(result.code, 0, `the links were made; only the telling did not happen: ${result.stderr}`);
  await assertLinked(bots, BOT, KIT_SKILL, await kitSkill(KIT_SKILL));
  const sessions = sessionsOf(result, BOT);
  assert.deepEqual(
    sessions.map((entry) => [entry.session, entry.harness, entry.state]),
    [['daily', 'claude', 'unknown'], ['reviewer', 'codex', 'unknown']],
  );
  for (const entry of sessions) {
    assert.equal(typeof entry.trouble, 'string', `why ${entry.session} was not told, got: ${JSON.stringify(entry)}`);
    assert.notEqual(entry.trouble.trim(), '');
  }
  assert.deepEqual(Object.values(await sentSinceLaunch(box)).flat(), [], 'no /reload-skills into a tab running Codex');
});

test('when one harness\'s link fails, the sessions are still told about the one that was made', async (t) => {
  // Codex's skills directory cannot be written into, so its link fails and
  // Claude's is made. Claude Code reads the change, so its session is told;
  // the bot's trouble and the run's exit code stay what linking gave.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await addSkills(botYamlOf(bots, BOT), `kit:${KIT_SKILL}`);
  const locked = skillsDirOf(bots, BOT, 'codex');
  await mkdir(locked, { recursive: true });
  await chmod(locked, 0o555);

  let result;
  try {
    result = await build(box, '--json');
  } finally {
    await chmod(locked, 0o755);
  }

  assert.equal(result.code, 1, `a bot that could not be given its skills ends the run in 1, got:\n${result.stdout}${result.stderr}`);
  const entry = entryOf(answerOf(result), BOT);
  assert.equal(typeof entry.trouble, 'string', `the failed link is the bot's trouble, got: ${JSON.stringify(entry)}`);
  assert.ok((await heldBy(bots, BOT, 'claude')).get(KIT_SKILL)?.link, 'the test meant Claude\'s link to be made');
  assert.ok(Array.isArray(entry.linked) && entry.linked.includes(KIT_SKILL), `what was linked is listed, got: ${JSON.stringify(entry)}`);
  const daily = sessionsOf(result, BOT).find((one) => one.session === 'daily');
  assert.equal(daily?.state, 'reloaded', `Claude's link was made, so its session is told, got: ${JSON.stringify(daily)}`);
  assert.deepEqual(await sentToSession(box, bots, BOT, 'daily'), [{ text: RELOAD, enter: true }]);
});

for (const [label, arrange] of [
  ['one harness\'s link failed', async (box, bots) => {
    const locked = skillsDirOf(bots, BOT, 'codex');
    await mkdir(locked, { recursive: true });
    await chmod(locked, 0o555);
    return () => chmod(locked, 0o755);
  }],
  ['the bot\'s .agents/skills is the user\'s own link to a folder outside the bot', async (box, bots) => {
    const outside = path.join(box.root, 'elsewhere', 'agents-skills');
    await mkdir(outside, { recursive: true });
    await rm(skillsDirOf(bots, BOT, 'codex'), { recursive: true, force: true });
    await symlink(outside, skillsDirOf(bots, BOT, 'codex'));
    return async () => {};
  }],
]) {
  test(`a Codex session is never given a SKILL.md to read that is not there: ${label}`, async (t) => {
    // The kit linked the skill for Claude only. A path handed to a session
    // that leads nowhere sends it looking for a skill it cannot read.
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    await addSkills(botYamlOf(bots, BOT), `kit:${KIT_SKILL}`);
    const undo = await arrange(box, bots);

    let result;
    try {
      result = await build(box, '--json');
    } finally {
      await undo();
    }

    const reviewer = sessionsOf(result, BOT).find((one) => one.session === 'reviewer');
    assert.ok(reviewer !== undefined, `the Codex session is reported, got: ${result.stdout}`);
    const missing = (reviewer.read ?? []).filter((file) => !existsSync(file));
    assert.deepEqual(missing, [], `every SKILL.md in read should be on disk, got: ${JSON.stringify(reviewer)}`);
    assert.ok((await heldBy(bots, BOT, 'claude')).get(KIT_SKILL)?.link, 'the kit linked the skill for Claude');
    assert.ok(!existsSync(codexSkillMd(bots, BOT, KIT_SKILL)), 'the test meant Codex\'s link not to be there');
  });
}

test('an unreadable book: the links are made, nothing is typed, and every session is unknown with the book named', async (t) => {
  // bot.yaml names the sessions; the book only says which tab each lives in.
  // Without it the kit cannot find a tab to type into, and not telling is no
  // reason to fail a build whose links were made.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await writeFile(bookOf(bots, BOT), 'sessions: [this is: not: yaml\n');
  await addSkills(botYamlOf(bots, BOT), `kit:${KIT_SKILL}`);

  const result = await build(box, '--json');

  assert.equal(result.code, 0, `linking needs no book, so it goes through: ${result.stdout}${result.stderr}`);
  await assertLinked(bots, BOT, KIT_SKILL, await kitSkill(KIT_SKILL));
  const sessions = sessionsOf(result, BOT);
  assert.deepEqual(
    sessions.map((entry) => [entry.session, entry.harness, entry.state]),
    [['daily', 'claude', 'unknown'], ['reviewer', 'codex', 'unknown']],
  );
  for (const entry of sessions) {
    assert.match(entry.trouble ?? '', /sessions\.yaml/, `the trouble should name the book, got: ${JSON.stringify(entry)}`);
  }
  assert.deepEqual(Object.values(await sentSinceLaunch(box)).flat(), []);
});
