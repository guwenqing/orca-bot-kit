// Nothing the kit types into a harness tab answers a question the harness
// itself is asking (#329). Above all, an update offer whose default is "Update
// now" never takes it.
//
// What happened: in a Codex tab, Codex 0.156.1 drew its update offer just as a
// line was typed with a return. The return took the default, "Update now", and
// Codex updated the machine. Orca did not report that screen: `terminal wait
// --for tui-idle` answered ok and satisfied with no `blockedReason`, and the
// kit's guard trusted only that reason.
//
// So the kit reads the screen itself, with `orca terminal read --terminal
// <handle> --screen --json`, and a harness's own question on it is a tab
// waiting on something, `question-on-screen`, reported where Orca's own reason
// goes. A harness's own question is a numbered choice list the harness draws
// and waits on: its selection pointer on one numbered choice, another numbered
// choice lined up with it right above or below, at the lowest row on the screen
// the pointer starts. The kit's ordinary ready screen is not one: both
// harnesses start their input line with the same pointer, and Codex puts a
// status row right under it. Neither is a draft in the input line, a numbered
// list in the conversation, a past turn echoed with the pointer (wrapped onto
// more rows when it is long, as a nudge is), or a question that is history with
// the input line back below it. A guard that took those for questions would
// swallow every nudge. The screens are in helpers/screens.js, most of them
// captured live, and it says which are captures and which are reconstructions.
//
// Claude Code's folder-trust list is unnumbered and is not asked of the kit's
// look: Orca names no agent in that tab, so the kit's gate already types
// nothing into it, and one test below holds it to that.
//
// Where Orca does name a reason, that reason stands. Where the screen cannot be
// read (Orca refuses, or answers with a `source` other than `screen`), the kit
// cannot tell: it types nothing and says so.
//
// The lines the kit types into a running session are all here: the mail
// nudge, and `/reload-skills` from a skills build. So is what `up` and
// `restart` report about a tab they just started, where the kit types nothing
// after the launch line but says plainly that a question is waiting.
//
// The fake Orca shows every tab its harness's idle screen, as captured, unless
// a test gives it one: `screen` for every tab, a terminal's own `screen` for
// one tab, and `screenSource` or a refusal of `terminal read` for a screen that
// cannot be read.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  botHomeOf,
  createSandbox,
  recordSession,
  sentInto,
  sessionIn,
  tabsOfBot,
  typedInto,
} from './helpers/cli.js';
import {
  CLAUDE_ANSWERED,
  CLAUDE_IDLE,
  CLAUDE_TEACH_AUTO,
  CLAUDE_TRUST,
  CLAUDE_TRUST_AS_ORCA_SAW_IT,
  CODEX_ANSWERED,
  CODEX_DRAFT,
  CODEX_HOOKS_REVIEW,
  CODEX_HOOKS_REVIEW_ON_TWO,
  CODEX_IDLE,
  CODEX_NEW_MENU,
  CODEX_TRUST,
  CODEX_UPDATE_OFFER,
  NUMBERED_ANSWER,
  QUESTION_IN_HISTORY,
  questionOn,
} from './helpers/screens.js';
import { addSkills, answerOf, botYamlOf, entryOf, SKILL_DIRS } from './helpers/skills.js';

/** The kit's word for a tab whose screen shows a harness's own question. */
const QUESTION = 'question-on-screen';

/** Orca refusing to read a screen, in words a test can look for. */
const READ_REFUSED = { fail: { 'terminal read': { code: 'runtime_error', message: 'the renderer did not answer' } } };

/** The tab one session lives in, as the book has it. */
const tabOf = async (bots, bot, session = 'daily') => (await sessionIn(bots, bot, session)).tab;

/**
 * Give one tab a screen of its own: `screen`, the rows it renders, and
 * `screenSource`, the source Orca names for them. Every other tab keeps the
 * screen it had.
 */
async function showIn(box, tab, shown) {
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((terminal) => (terminal.tabId === tab ? { ...terminal, ...shown } : terminal)),
  });
}

/** What was typed into every tab of the whole fleet, after the launch line each one got. */
async function typedSinceLaunch(box) {
  const after = {};
  for (const terminal of await box.orca.terminals()) {
    after[terminal.tabId] = typedInto(terminal).slice(1);
  }
  return after;
}

/** The message is in the mailbox, and nothing at all was typed into any tab after its launch line. */
async function assertQueuedUntyped(box, what) {
  assert.equal((await box.orca.messages()).length, 1, `${what}: the message is in the mailbox`);
  assert.deepEqual(Object.values(await typedSinceLaunch(box)).flat(), [], `${what}: and nothing was typed into any tab`);
}

// ------------------------------------------------------------ message send

/** A Claude bot and a Codex bot, each with one session, both up, nothing typed since. */
async function fleetIn(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  for (const [bot, harness] of [['writer', 'claude'], ['coder', 'codex']]) {
    assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness])).code, 0);
    assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', 'daily'])).code, 0);
  }
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  return box.path('bots');
}

/** Each bot is written to by the other: the Codex bot by the Claude bot, and the other way round. */
const SENDER = { coder: 'writer/daily', writer: 'coder/daily' };

/** The arguments of one message to `to`, from the other bot. */
const sendArgs = (to) => [
  'message', 'send', '--bots', 'bots', '--to', to, '--from', SENDER[to],
  '--subject', 'the staging host', '--text', 'It is down again.',
];

/** Send one message to `to`, `--json`, and read the answer. The message goes whatever became of the nudge. */
async function send(box, to) {
  const result = await box.run([...sendArgs(to), '--json']);
  assert.equal(result.code, 0, `the message went whatever became of the nudge: ${result.stdout}${result.stderr}`);
  return JSON.parse(result.stdout);
}

// Covers acceptance 1, the screen of the issue: a Codex tab on its update
// offer, Orca calling it idle with no reason, gets nothing typed, and the
// answer says the tab is waiting on a question.
test('a Codex tab on its update offer, which Orca calls idle, gets no nudge, and the answer says a question is waiting', async (t) => {
  // Orca's answer is the one the issue saw: ok and satisfied, no reason, which
  // is what the fake gives unless told otherwise. A line typed here with a
  // return updates the machine.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await showIn(box, await tabOf(bots, 'coder'), { screen: CODEX_UPDATE_OFFER });

  const answer = await send(box, 'coder');

  assert.equal(answer.sent, true, `the message is in the mailbox, got: ${JSON.stringify(answer)}`);
  assert.equal(answer.nudged, false, `got: ${JSON.stringify(answer)}`);
  assert.equal(answer.blocked, QUESTION, `the answer should say the tab is waiting on a question, got: ${JSON.stringify(answer)}`);
  await assertQueuedUntyped(box, 'the update offer');
});

// Covers acceptance 1 for the other harness questions the issue names: Codex's
// trust, hooks and `/new` screens, and Claude Code's numbered menus, the
// selection on whichever choice. Orca names no reason in any of them here, so
// each is about the screen alone; live, it named none for the hooks review and
// the `/new` menu either.
for (const [label, bot, screen] of [
  ['Codex 0.157.1\'s /new menu, as captured, the answered turn above it', 'coder', CODEX_NEW_MENU],
  ['Codex 0.157.1\'s folder-trust question, as captured', 'coder', CODEX_TRUST],
  ['Codex 0.157.1\'s hooks review, as captured', 'coder', CODEX_HOOKS_REVIEW],
  ['Codex 0.157.1\'s hooks review, as captured, its selection moved to the second choice', 'coder', CODEX_HOOKS_REVIEW_ON_TWO],
  ['Claude Code\'s offer to teach auto mode', 'writer', CLAUDE_TEACH_AUTO],
]) {
  test(`a tab showing ${label} gets no nudge, and the answer says a question is waiting`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    await showIn(box, await tabOf(bots, bot), { screen });

    const answer = await send(box, bot);

    assert.equal(answer.nudged, false, `${label}: got ${JSON.stringify(answer)}`);
    assert.equal(answer.blocked, QUESTION, `${label}: the answer should say the tab is waiting on a question, got ${JSON.stringify(answer)}`);
    await assertQueuedUntyped(box, label);
  });
}

// Covers the intent on Claude Code's unnumbered trust list, as it really came:
// Orca's wait timed out with no reason and Orca named no agent in the tab. The
// kit's gate types nothing into a tab it cannot tell about, and this holds it
// there whatever the new look makes of the screen. Which reason the answer
// gives is not asked. Passes before the change too.
test('Claude Code\'s trust list, with Orca timing out and naming no agent as it did live, gets nothing typed', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await box.orca.set(CLAUDE_TRUST_AS_ORCA_SAW_IT);
  await showIn(box, await tabOf(bots, 'writer'), { screen: CLAUDE_TRUST });

  const answer = await send(box, 'writer');

  assert.equal(answer.nudged, false, `got: ${JSON.stringify(answer)}`);
  await assertQueuedUntyped(box, 'Claude Code\'s trust list as Orca saw it');
});

// Covers acceptance 1 where Orca's wait times out: a busy harness is nudged
// (#232), but not while its screen shows a question.
test('a harness Orca finds busy is not typed into while its screen shows a question', async (t) => {
  // A busy harness takes a typed line as its next turn, which is why it is
  // nudged at all (harness-in-tab.test.js). One with a question on its screen
  // takes the line as the answer, whatever Orca's wait made of the tab.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await box.orca.set({ waitIdle: 'busy' });
  await showIn(box, await tabOf(bots, 'coder'), { screen: CODEX_UPDATE_OFFER });

  const answer = await send(box, 'coder');

  assert.equal(answer.nudged, false, `got: ${JSON.stringify(answer)}`);
  assert.equal(answer.blocked, QUESTION, `got: ${JSON.stringify(answer)}`);
  await assertQueuedUntyped(box, 'busy, with the update offer');
});

// Covers the interface: where Orca names a reason, that reason stays the
// `blocked` value. It describes what the kit does today and passes before the
// change; it holds the new look to leaving Orca's word in place.
test('where Orca names a reason, that reason is the answer\'s, question on screen or not', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await box.orca.set({ waitIdle: 'blocked' });
  await showIn(box, await tabOf(bots, 'coder'), { screen: CODEX_UPDATE_OFFER });

  const answer = await send(box, 'coder');

  assert.equal(answer.nudged, false, `got: ${JSON.stringify(answer)}`);
  assert.equal(answer.blocked, 'agent-interactive-prompt', `Orca's own word, got: ${JSON.stringify(answer)}`);
  await assertQueuedUntyped(box, 'Orca\'s reason and the update offer');
});

// Covers acceptance 1, "says": the plain report of the blocked case.
test('the plain report says the tab has something waiting to be answered, names it, and says nothing was typed', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await showIn(box, await tabOf(bots, 'coder'), { screen: CODEX_UPDATE_OFFER });

  const result = await box.run(sendArgs('coder'));

  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout.includes(`(${QUESTION})`), `the report should name what the tab is waiting on, got:\n${result.stdout}`);
  assert.match(result.stdout, /nothing was typed/, `and say nothing was typed, got:\n${result.stdout}`);
  await assertQueuedUntyped(box, 'the plain report');
});

// Covers the boundary: screens that ask nothing are nudged as ever. These pass
// before the change too; they hold the new guard to not swallowing every nudge.
for (const [label, bot, screen] of [
  ['Claude Code 2.1.283\'s idle input line with its placeholder, as captured', 'writer', CLAUDE_IDLE],
  ['Claude Code 2.1.283 after an answered turn, a numbered pair in its wrapped echo, as captured', 'writer', CLAUDE_ANSWERED],
  ['Codex 0.157.1\'s idle input line, a status row lined up under it, as captured', 'coder', CODEX_IDLE],
  ['Codex 0.157.1 with a long draft wrapped in its input line, as captured', 'coder', CODEX_DRAFT],
  ['Codex 0.157.1 after an answered turn, its wrapped echo above the input line, as captured', 'coder', CODEX_ANSWERED],
  ['a numbered list in the model\'s answer, the input line below it', 'writer', NUMBERED_ANSWER],
  ['a question that is history, the input line back below it', 'writer', QUESTION_IN_HISTORY],
]) {
  test(`${label}: no question, and the tab is nudged as ever`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    const reader = await tabOf(bots, bot);
    await showIn(box, reader, { screen });

    const answer = await send(box, bot);

    assert.equal(answer.nudged, true, `${label}: the tab should have been told, got ${JSON.stringify(answer)}`);
    assert.equal('blocked' in answer, false, `${label}: nothing is waiting, got ${JSON.stringify(answer)}`);
    const typed = await typedSinceLaunch(box);
    assert.equal(typed[reader].length, 1, `${label}: one line into the receiver's tab, got ${JSON.stringify(typed[reader])}`);
    assert.match(typed[reader][0], /message check/, `${label}: the nudge, got ${typed[reader][0]}`);
  });
}

// Covers the boundary: the screen read is the receiver's own. A question in
// another tab of the fleet stops nothing. Passes before the change too.
test('a question on another tab of the fleet does not stop the receiver\'s nudge', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const reader = await tabOf(bots, 'coder');
  await showIn(box, await tabOf(bots, 'writer'), { screen: CLAUDE_TEACH_AUTO });

  const answer = await send(box, 'coder');

  assert.equal(answer.nudged, true, `the receiver's own screen asks nothing, got: ${JSON.stringify(answer)}`);
  const typed = await typedSinceLaunch(box);
  assert.equal(typed[reader].length, 1, `one line into the receiver's tab, got: ${JSON.stringify(typed[reader])}`);
  assert.deepEqual(typed[await tabOf(bots, 'writer')], [], 'and nothing into the tab with the question');
});

// Covers the interface: a screen that cannot be read. The rows that come back
// with a `source` other than `screen` look idle here, so a kit that did not
// look at `source` would type.
for (const [label, steer] of [
  ['Orca refuses to read the screen', (box) => box.orca.set(READ_REFUSED)],
  ['Orca could render no screen and answers with accumulated output instead', (box, tab) => showIn(box, tab, { screenSource: 'screen-unavailable' })],
  ['Orca answers with the stream rather than the screen', (box, tab) => showIn(box, tab, { screenSource: 'stream' })],
]) {
  test(`when ${label}, the kit cannot tell: no nudge, and the answer says so`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    await steer(box, await tabOf(bots, 'coder'));

    const answer = await send(box, 'coder');

    assert.equal(answer.nudged, false, `${label}: got ${JSON.stringify(answer)}`);
    assert.equal('blocked' in answer, false, `${label}: nothing was seen waiting; the kit does not know, got ${JSON.stringify(answer)}`);
    assert.equal(typeof answer.nudgeTrouble, 'string', `${label}: a sentence saying the kit could not tell, got ${JSON.stringify(answer)}`);
    assert.match(answer.nudgeTrouble, /screen|question/i, `${label}: about the screen, got ${JSON.stringify(answer)}`);
    await assertQueuedUntyped(box, label);
  });
}

// ------------------------------------------------------------ skills build

/** One of the kit's own skills, and Claude Code's command for picking up skills changed on disk. */
const KIT_SKILL = 'obk-tdd';
const RELOAD = '/reload-skills';

/** The bot whose skills change. */
const BOT = 'api-bot';

/** Bot Father, and api-bot with a Claude session `daily` and a Codex session `reviewer`, all up, nothing typed since. */
async function skillsFleetIn(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude', '--charter', `${BOT} owns its own corner.`]);
  assert.equal(made.code, 0, made.stderr);
  for (const [session, harness] of [['daily', 'claude'], ['reviewer', 'codex']]) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', session, '--harness', harness]);
    assert.equal(added.code, 0, added.stderr);
  }
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  return box.path('bots');
}

/** A skills build that links one more skill into api-bot, `--json`. */
async function build(box, bots) {
  await addSkills(botYamlOf(bots, BOT), `kit:${KIT_SKILL}`);
  const result = await box.run(['skills', 'build', '--bots', 'bots', '--json']);
  assert.equal(result.code, 0, `the links were made whatever became of the telling: ${result.stdout}${result.stderr}`);
  const entry = entryOf(answerOf(result), BOT);
  assert.ok(Array.isArray(entry.sessions), `${BOT}'s links changed, so its sessions are reported, got: ${JSON.stringify(entry)}`);
  return entry.sessions;
}

/** What the Codex session is told to read meanwhile: the SKILL.md through the bot's own link. */
const codexSkillMd = (bots) => path.join(botHomeOf(bots, BOT), SKILL_DIRS.codex, KIT_SKILL, 'SKILL.md');

/** Each `terminal send` into every tab since its launch line, by tab id. */
async function sentSinceLaunch(box) {
  const after = {};
  for (const terminal of await box.orca.terminals()) {
    after[terminal.tabId] = sentInto(terminal).slice(1);
  }
  return after;
}

// Covers acceptance 3, `/reload-skills`: a running Claude session whose screen
// shows a question, Orca naming no reason, is reported blocked on
// `question-on-screen`, and nothing is typed.
test('a Claude session whose screen shows a question gets no /reload-skills, and is reported blocked on it', async (t) => {
  // `/reload-skills` goes in with a return, and a return on a choice screen
  // picks whatever the selection is on. Only the Claude session's tab shows
  // the question; the Codex session's asks nothing.
  const box = await createSandbox(t);
  const bots = await skillsFleetIn(box);
  await showIn(box, await tabOf(bots, BOT, 'daily'), { screen: CLAUDE_TEACH_AUTO });

  const sessions = await build(box, bots);

  assert.deepEqual(sessions, [
    { session: 'daily', harness: 'claude', state: 'blocked', blocked: QUESTION },
    { session: 'reviewer', harness: 'codex', state: 'next-turn', read: [codexSkillMd(bots)] },
  ]);
  assert.deepEqual(Object.values(await sentSinceLaunch(box)).flat(), [], `no ${RELOAD}, and nothing else, typed anywhere`);
});

// Covers acceptance 3, `/reload-skills`, with a screen that cannot be read:
// the Claude session is unknown, with why, and nothing is typed.
for (const [label, steer, codexScreenRead] of [
  ['Orca could render no screen for the Claude session\'s tab', (box, tab) => showIn(box, tab, { screenSource: 'screen-unavailable' }), true],
  ['Orca refuses to read any screen', (box) => box.orca.set(READ_REFUSED), false],
]) {
  test(`when ${label}, the Claude session gets no /reload-skills and is reported unknown, with why`, async (t) => {
    const box = await createSandbox(t);
    const bots = await skillsFleetIn(box);
    await steer(box, await tabOf(bots, BOT, 'daily'));

    const sessions = await build(box, bots);

    const daily = sessions.find((one) => one.session === 'daily');
    assert.equal(daily?.state, 'unknown', `${label}: the kit cannot tell, got ${JSON.stringify(sessions)}`);
    assert.equal(typeof daily.trouble, 'string', `${label}: and says why, got ${JSON.stringify(daily)}`);
    assert.notEqual(daily.trouble.trim(), '');
    assert.equal('blocked' in daily, false, `${label}: nothing was seen waiting, got ${JSON.stringify(daily)}`);
    if (codexScreenRead) {
      // Only the Claude tab's screen was unreadable; the Codex session's reads, and asks nothing.
      assert.deepEqual(
        sessions.find((one) => one.session === 'reviewer'),
        { session: 'reviewer', harness: 'codex', state: 'next-turn', read: [codexSkillMd(bots)] },
      );
    }
    assert.deepEqual(Object.values(await sentSinceLaunch(box)).flat(), [], `${label}: no ${RELOAD}, and nothing else, typed anywhere`);
  });
}

// --------------------------------------------------------------------- up

const PROMPT = 'Read your AGENTS.md and reply in one line with what this bot owns.';

/** A bots folder holding one Codex bot, `tab-bot`, with one session and a start prompt; Bot Father's tabs are up from init. */
async function withSession(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'tab-bot', '--harness', 'codex'])).code, 0);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'tab-bot', '--name', 'daily', '--prompt', PROMPT]);
  assert.equal(added.code, 0, added.stderr);
  return box.path('bots');
}

/** tab-bot's entry in a `--json` answer, for the tab the run started. */
function startedIn(result) {
  assert.equal(result.code, 0, result.stderr);
  const found = JSON.parse(result.stdout).tabs.filter((entry) => entry.bot === 'tab-bot' && entry.name === 'daily' && entry.created === true);
  assert.equal(found.length, 1, `the tab the run started should be reported, got: ${result.stdout}`);
  return found[0];
}

/**
 * "The kit cannot see whether a screen is waiting", loosely, as
 * first-run-screens.test.js reads it (#288): what `up` says of a harness
 * running with no reason from Orca. A tab the kit saw a question on is not one.
 */
const CANNOT_SEE = /(?:cannot|can't|can not|unable to|no way to|does not|doesn't|did not|didn't|could not|couldn't)\s+(?:\S+\s+){0,3}?(?:see|tell|know|detect)\b[^.]{0,120}?\b(?:wait|answer|screen|prompt|question)/i;

/** A report's words on one line, with the sandbox's paths out of it, so a wrapped sentence reads as one. */
const sentenceOf = (box, stdout) => stdout.split(box.root).join('<root>').replace(/\s+/g, ' ');

/** The plain report of `up` for tab-bot alone, with Orca in `state`, from a sandbox of its own, its root taken out. */
async function plainUp(t, state) {
  const box = await createSandbox(t);
  await withSession(box);
  await box.orca.set(state);
  const result = await box.run(['up', '--bots', 'bots', '--bot', 'tab-bot']);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout.split(box.root).join('<root>');
}

// Covers acceptance 3, `obk up`: a tab the run started whose harness came up
// on a question, Orca naming no reason, carries `blockedReason:
// question-on-screen`; the tabs it found are reported as ever; nothing more is
// typed after the launch line.
test('up reports a tab it started whose harness came up on a question with question-on-screen, and types nothing more', async (t) => {
  // The question is Codex's hooks review, as captured: what a fresh kit-made
  // Codex tab comes up on, and Orca named no reason for it live. Every tab
  // shows it here, Bot Father's too. Only the tab this run started was looked
  // at: the found ones say "looked at nothing", as ever.
  const box = await createSandbox(t);
  const bots = await withSession(box);
  await box.orca.set({ screen: CODEX_HOOKS_REVIEW });

  const result = await box.run(['up', '--bots', 'bots', '--json']);

  const entry = startedIn(result);
  assert.equal(entry.harnessStarted, true, 'the harness came up: it is the one asking');
  assert.equal(entry.blockedReason, QUESTION, `the entry should say the tab is waiting on a question, got: ${JSON.stringify(entry)}`);
  const found = JSON.parse(result.stdout).tabs.filter((one) => one.created === false);
  assert.ok(found.length > 0, `Bot Father's tabs should have been found, or the next check proves nothing, got: ${result.stdout}`);
  for (const one of found) {
    assert.equal('blockedReason' in one, false, `${one.title} was found, not started, so nothing was looked at: ${JSON.stringify(one)}`);
  }
  const [tab] = await tabsOfBot(box, bots, 'tab-bot');
  assert.equal(typedInto(tab).length, 1, `the launch line and nothing after it, got: ${JSON.stringify(typedInto(tab))}`);
});

// Covers acceptance 3, `obk up`, "say plainly": the plain line.
test('up\'s plain report says the harness came up waiting on question-on-screen, and not that it cannot see', async (t) => {
  const box = await createSandbox(t);
  await withSession(box);
  await box.orca.set({ screen: CODEX_HOOKS_REVIEW });

  const result = await box.run(['up', '--bots', 'bots', '--bot', 'tab-bot']);

  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout.includes(`waiting on: ${QUESTION}`), `the report should say what the tab waits on, got:\n${result.stdout}`);
  assert.doesNotMatch(
    sentenceOf(box, result.stdout),
    CANNOT_SEE,
    `the kit saw the question, so it should not say it cannot see one, got:\n${result.stdout}`,
  );
});

// Covers the interface for `obk up`: an unreadable screen changes nothing in
// the report, no blockedReason and today's lines, even where what Orca hands
// back instead of a screen holds a question. These pass before the change too;
// they hold the new look to leaving the report alone when it cannot see.
for (const [label, state] of [
  ['Orca refuses to read the screen', READ_REFUSED],
  ['Orca could render no screen, and the output it gives instead holds a question', { screen: CODEX_HOOKS_REVIEW, screenSource: 'screen-unavailable' }],
]) {
  test(`when ${label}, up reports as it did before: no blockedReason, and the same lines`, async (t) => {
    const box = await createSandbox(t);
    await withSession(box);
    await box.orca.set(state);

    const entry = startedIn(await box.run(['up', '--bots', 'bots', '--bot', 'tab-bot', '--json']));

    assert.equal(entry.harnessStarted, true, `${label}: got ${JSON.stringify(entry)}`);
    assert.equal('blockedReason' in entry, false, `${label}: nothing was seen waiting, got ${JSON.stringify(entry)}`);
    assert.equal(
      await plainUp(t, state),
      await plainUp(t, {}),
      `${label}: the lines should be those of a run whose screen was read and asks nothing`,
    );
  });
}

// ----------------------------------------------------------------- restart

/** tab-bot brought up, with the conversation its session runs known to the book: something to restart. */
async function running(box) {
  const bots = await withSession(box);
  const up = await box.run(['up', '--bots', 'bots', '--bot', 'tab-bot']);
  assert.equal(up.code, 0, up.stderr);
  const { tab } = await sessionIn(bots, 'tab-bot', 'daily');
  const recorded = await recordSession(box, { bots, bot: 'tab-bot', tab, session: 'sess-daily' });
  assert.equal(recorded.code, 0, recorded.stderr);
  return bots;
}

// Covers acceptance 3, `obk restart`: the tab it opened again carries
// `blockedReason: question-on-screen` when its harness came up on a question
// and Orca named no reason.
test('restart reports the new tab\'s harness come up on a question with question-on-screen', async (t) => {
  const box = await createSandbox(t);
  await running(box);
  await box.orca.set({ screen: CODEX_HOOKS_REVIEW });

  const entry = startedIn(await box.run(['restart', '--bots', 'bots', '--bot', 'tab-bot', '--json']));

  assert.equal(entry.harnessStarted, true);
  assert.equal(entry.blockedReason, QUESTION, `the entry should say the tab is waiting on a question, got: ${JSON.stringify(entry)}`);
});

// Covers acceptance 3, `obk restart`, "say plainly": the plain line.
test('restart\'s plain report says the harness came up waiting on question-on-screen', async (t) => {
  const box = await createSandbox(t);
  await running(box);
  await box.orca.set({ screen: CODEX_HOOKS_REVIEW });

  const result = await box.run(['restart', '--bots', 'bots', '--bot', 'tab-bot']);

  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout.includes(`waiting on: ${QUESTION}`), `the report should say what the tab waits on, got:\n${result.stdout}`);
});

// Covers the interface for `obk restart`: an unreadable screen changes nothing.
// Passes before the change too, as the ones for `up` above do.
test('when Orca refuses to read the screen, restart reports as it did before: no blockedReason', async (t) => {
  const box = await createSandbox(t);
  await running(box);
  await box.orca.set(READ_REFUSED);

  const entry = startedIn(await box.run(['restart', '--bots', 'bots', '--bot', 'tab-bot', '--json']));

  assert.equal(entry.harnessStarted, true, `got: ${JSON.stringify(entry)}`);
  assert.equal('blockedReason' in entry, false, `nothing was seen waiting, got: ${JSON.stringify(entry)}`);
});

// ------------------------------------------------- the system tests' own look

// Covers acceptance 2, the part that can run here. The system tests' waits
// before a first line use helpers/screens.js's `questionOn`, not the kit's
// code. They run only live, and an update offer cannot be brought up on
// demand, so this is the one place that look is held to the screens. It tests
// the suite's own helper, so it passes before the kit changes.
test('the system tests\' look finds every harness question here, and none on a screen that asks nothing', () => {
  // Claude Code's unnumbered trust list is in neither list: the look is not
  // asked to find it, since the waits never pass it anyway (`tui-idle` times
  // out on it, seen live).
  for (const [label, screen] of [
    ['the update offer', CODEX_UPDATE_OFFER],
    ['Codex 0.157.1\'s /new menu, captured, the answered turn above it', CODEX_NEW_MENU],
    ['Codex 0.157.1\'s folder trust, captured', CODEX_TRUST],
    ['Codex 0.157.1\'s hooks review, captured', CODEX_HOOKS_REVIEW],
    ['Codex 0.157.1\'s hooks review on its second choice, captured', CODEX_HOOKS_REVIEW_ON_TWO],
    ['Claude Code\'s offer to teach auto mode', CLAUDE_TEACH_AUTO],
  ]) {
    assert.notEqual(questionOn(screen), undefined, `${label} is a question`);
  }
  for (const [label, screen] of [
    ['Claude Code 2.1.283\'s idle input line, captured', CLAUDE_IDLE],
    ['Claude Code 2.1.283 after an answered turn, captured', CLAUDE_ANSWERED],
    ['Codex 0.157.1\'s idle input line and its status rows, captured', CODEX_IDLE],
    ['Codex 0.157.1 with a wrapped draft, captured', CODEX_DRAFT],
    ['Codex 0.157.1 after an answered turn, captured', CODEX_ANSWERED],
    ['a numbered list in an answer', NUMBERED_ANSWER],
    ['a question that is history', QUESTION_IN_HISTORY],
  ]) {
    assert.equal(questionOn(screen), undefined, `${label} is no question`);
  }
  assert.ok(
    questionOn(CODEX_UPDATE_OFFER).some((row) => row.includes('1. Update now')),
    'what it gives back is the question itself, for a wait that ran out to show',
  );
});
