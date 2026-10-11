// A Codex tab whose trust question has been answered, and which Orca still
// reports as sitting on it, is not reported as waiting for an answer (#342).
//
// What happened: after Codex's folder-trust screen had been answered, Orca
// 1.4.212 went on answering `terminal wait --for tui-idle` with `blockedReason:
// "agent-trust-workspace"` while the tab showed Codex 0.157.1's idle input line,
// and after a finished turn too (tech notes, section 1). The kit's one gate for
// typing into a running session took Orca's reason as it came, typed nothing,
// and told the user to settle a question that was not there.
//
// What the kit does now, where Orca names that reason, Orca names `codex` as
// the agent in the tab, and the kit's own read of the rendered screen shows no
// question of the harness's own: it still types nothing, and it says what it
// saw: Orca still reports the trust screen (naming `agent-trust-workspace`),
// and the tab's screen shows no question. That is the kit being unable to
// tell, not the tab being blocked:
//
//   - `message send --interrupt` sends no Escape, and its plain output says
//     the kit could not tell, with the sentence.
//   - `skills build` reports the session `unknown`, the sentence its trouble,
//     "not told" in the plain report.
//   - grooming's typed line refuses with an error carrying the sentence.
//
// Unchanged, and held here so the new rule stays narrow: the same reason with
// Codex's trust question really on screen; any other reason Orca names on a
// screen that looks idle; a Claude Code tab with the trust reason, whose trust
// list is unnumbered and so invisible to the kit's look; a screen Orca will
// not read. Nothing is typed in any of them.
//
// Since #555 fleet mail types nothing else. Its one key is the Escape of
// --interrupt, into a busy receiver whose tab passes the gate. The mail tests
// below send with --interrupt. They keep Orca's own blocked wait, since Orca's
// reason is what they are about.
//
// The tests assert the facts of the sentence (it names the reason, it says the
// screen shows no question, it does not ask the user to settle or answer
// anything), not its words.
//
// Where the screens come from: CODEX_AFTER_TRUST and CODEX_TRUST are captures,
// the first from #342's own live run; CODEX_IDLE and CODEX_ANSWERED are
// captures from #329 (helpers/screens.js). Orca's reason beside an idle screen
// is a reconstruction: in #342's captured runs Orca's wait on those screens
// named no reason (the stale reason did not come back there), so the pairing
// is taken from the tech notes' live sighting, and the reason's name from the
// captured wait on the trust screen (`agent-trust-workspace`).

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSandbox,
  recordSession,
  sentInto,
  sessionIn,
} from './helpers/cli.js';
import {
  CLAUDE_IDLE,
  CLAUDE_TRUST,
  CODEX_AFTER_TRUST,
  CODEX_ANSWERED,
  CODEX_IDLE,
  CODEX_TRUST,
} from './helpers/screens.js';
import { addSkills, answerOf, botYamlOf, entryOf, linesAbout } from './helpers/skills.js';

/** Orca's reason for a tab on a harness's folder-trust question, as captured on Codex's (#342, A-wait). */
const TRUST = 'agent-trust-workspace';

/** A sentence saying the tab's screen shows no question. */
const NO_QUESTION = /\bno question\b/i;

/** A sentence telling the user there is something in the tab to settle or answer. */
const SETTLE = /Settle that|waiting to be answered|waiting for an answer|Answer it/i;

/** Orca refusing to read a screen. */
const READ_REFUSED = { fail: { 'terminal read': { code: 'runtime_error', message: 'the renderer did not answer' } } };

/** Orca's wait on every tab: a TUI that is up, with `reason` named for it. */
const ORCA_NAMES = (reason) => ({ waitIdle: 'blocked', blockedReason: reason });

/** The tab one session lives in, as the book has it. */
const tabOf = async (bots, bot, session = 'daily') => (await sessionIn(bots, bot, session)).tab;

/** Give one tab fields of its own (its `screen`, its `agentIdentity`, who is in front); every other tab keeps its own. */
async function giveTab(box, tab, fields) {
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((terminal) => (terminal.tabId === tab ? { ...terminal, ...fields } : terminal)),
  });
}

/** Each `terminal send` into every tab since its launch line. */
async function sentSinceLaunch(box) {
  return (await box.orca.terminals()).flatMap((terminal) => sentInto(terminal).slice(1));
}

/** The letter is in the mailbox, and nothing at all went into any tab after its launch line. */
async function assertQueuedUntyped(box, what) {
  assert.equal((await box.orca.messages()).length, 1, `${what}: the letter is in the mailbox`);
  assert.deepEqual(await sentSinceLaunch(box), [], `${what}: and nothing went into any tab`);
}

/** The sentence says what the kit saw: Orca's trust reason, by name, and a screen with no question on it. */
function assertSaysWhatItSaw(sentence, what) {
  assert.equal(typeof sentence, 'string', `${what}: a sentence saying what the kit saw, got ${JSON.stringify(sentence)}`);
  assert.ok(sentence.includes(TRUST), `${what}: it names Orca's reason, ${TRUST}, got: ${sentence}`);
  assert.match(sentence, /screen/i, `${what}: it is about the tab's screen, got: ${sentence}`);
  assert.match(sentence, NO_QUESTION, `${what}: it says the screen shows no question, got: ${sentence}`);
  assert.doesNotMatch(sentence, SETTLE, `${what}: it does not tell the user to settle or answer anything, got: ${sentence}`);
}

// ------------------------------------------------------------ message send --interrupt

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

/** Each bot is written to by the other. */
const SENDER = { coder: 'writer/daily', writer: 'coder/daily' };

/** Send one urgent letter to `to`, from the other bot, with --interrupt, plain, and answer what it printed. */
async function send(box, to) {
  const result = await box.run([
    'message', 'send', '--bots', 'bots', '--to', to, '--from', SENDER[to],
    '--subject', 'the staging host', '--text', 'It is down again.', '--interrupt',
  ]);
  assert.equal(result.code, 0, `the letter went whatever became of the interrupt: ${result.stdout}${result.stderr}`);
  return (result.stdout + result.stderr).replace(/\s+/g, ' ');
}

// Covers the new behaviour, message send: Orca names agent-trust-workspace,
// Orca names codex in the tab, and the screen shows Codex's idle input line or
// Codex after a turn. No Escape; the output names the reason and says the
// screen shows no question.
for (const [label, screen] of [
  ['Codex 0.157.1 idle right after its trust and hooks screens were answered, as captured in #342', CODEX_AFTER_TRUST],
  ['Codex 0.157.1\'s idle input line, as captured', CODEX_IDLE],
  ['Codex 0.157.1 after an answered turn, as captured', CODEX_ANSWERED],
]) {
  test(`${label}, with Orca still naming ${TRUST}: no Escape, and the output says what the kit saw`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    await box.orca.set(ORCA_NAMES(TRUST));
    await giveTab(box, await tabOf(bots, 'coder'), { screen });

    const said = await send(box, 'coder');

    assertSaysWhatItSaw(said, label);
    await assertQueuedUntyped(box, label);
  });
}

// Covers the new behaviour, message send's plain output: the kit could not
// tell, with the sentence, and nothing to settle.
test(`the plain report on a Codex tab with a stale ${TRUST} says the kit could not tell, and asks nothing to be settled`, async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await box.orca.set(ORCA_NAMES(TRUST));
  await giveTab(box, await tabOf(bots, 'coder'), { screen: CODEX_AFTER_TRUST });

  const said = await send(box, 'coder');

  assert.match(said, /tell/i, `the kit could not tell, got:\n${said}`);
  assert.ok(said.includes(TRUST), `it names Orca's reason, got:\n${said}`);
  assert.match(said, NO_QUESTION, `it says the screen shows no question, got:\n${said}`);
  assert.doesNotMatch(said, SETTLE, `it tells the user to settle nothing, got:\n${said}`);
  await assertQueuedUntyped(box, 'the plain report');
});

// Unchanged: the same reason with Codex's trust question really on screen is
// blocked with the reason.
test(`a Codex tab showing its trust question, Orca naming ${TRUST}, is still reported blocked with that reason`, async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await box.orca.set(ORCA_NAMES(TRUST));
  await giveTab(box, await tabOf(bots, 'coder'), { screen: CODEX_TRUST });

  const said = await send(box, 'coder');

  assert.ok(said.includes(TRUST), `Orca's reason stands, got:\n${said}`);
  await assertQueuedUntyped(box, 'the trust question on screen');
});

// Unchanged: any other reason Orca names on a Codex screen that looks idle is
// blocked as today. Only the trust reason is known to go stale.
for (const reason of ['agent-interactive-prompt', 'agent-update-prompt', 'agent-hooks-review-prompt']) {
  test(`a Codex tab on its idle input line, Orca naming ${reason}, is still reported blocked with that reason`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    await box.orca.set(ORCA_NAMES(reason));
    await giveTab(box, await tabOf(bots, 'coder'), { screen: CODEX_AFTER_TRUST });

    const said = await send(box, 'coder');

    assert.ok(said.includes(reason), `${reason}: Orca's reason stands, got:\n${said}`);
    await assertQueuedUntyped(box, reason);
  });
}

// Unchanged: a Claude Code tab with the trust reason stays blocked. Its trust
// list is unnumbered, so the kit's look sees no question on it, and "no
// question on screen" would be wrong. Its idle screen too: the rule is for a
// tab where Orca names codex.
for (const [label, screen] of [
  ['its unnumbered trust list, as captured', CLAUDE_TRUST],
  ['its idle input line, as captured', CLAUDE_IDLE],
]) {
  test(`a Claude Code tab showing ${label}, Orca naming ${TRUST}, is still reported blocked with that reason`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    await box.orca.set(ORCA_NAMES(TRUST));
    await giveTab(box, await tabOf(bots, 'writer'), { screen });

    const said = await send(box, 'writer');

    assert.ok(said.includes(TRUST), `${label}: Orca's reason stands, got:\n${said}`);
    await assertQueuedUntyped(box, label);
  });
}

// Unchanged: where Orca names no agent in the tab, the rule does not apply
// (it is for a tab where Orca names codex; tech notes: Orca named no agent in a
// Claude Code tab on its trust list). No Escape, and the output does not say
// the screen shows no question. Which of blocked or unsure it gives is not
// asked.
test(`a Codex tab where Orca names no agent, Orca naming ${TRUST}, gets no Escape and is not said to show no question`, async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await box.orca.set({ ...ORCA_NAMES(TRUST), agentIdentity: null });
  await giveTab(box, await tabOf(bots, 'coder'), { screen: CODEX_AFTER_TRUST });

  const said = await send(box, 'coder');

  assert.ok(said.includes(TRUST) || /tell/i.test(said), `the output says why no Escape went, got:\n${said}`);
  assert.doesNotMatch(said, NO_QUESTION, `Orca names no codex here, got:\n${said}`);
  await assertQueuedUntyped(box, 'no agent named');
});

// Unchanged: a screen Orca will not read, or reads only as something other
// than the rendered screen, is no evidence that no question is up. No Escape,
// and the output does not say the screen shows no question. Whether it gives
// Orca's reason as blocked or says it cannot tell is not asked.
for (const [label, steer] of [
  ['Orca refuses to read the screen', (box) => box.orca.set(READ_REFUSED)],
  ['Orca could render no screen and answers with accumulated output instead', (box, tab) => giveTab(box, tab, { screen: CODEX_AFTER_TRUST, screenSource: 'screen-unavailable' })],
]) {
  test(`when ${label}, a Codex tab with Orca naming ${TRUST} gets no Escape and is not said to show no question`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    await box.orca.set(ORCA_NAMES(TRUST));
    await steer(box, await tabOf(bots, 'coder'));

    const said = await send(box, 'coder');

    assert.ok(said.includes(TRUST) || /tell/i.test(said), `${label}: the output says why no Escape went, got:\n${said}`);
    assert.doesNotMatch(said, NO_QUESTION, `${label}: the kit did not see the screen, got:\n${said}`);
    await assertQueuedUntyped(box, label);
  });
}

// ------------------------------------------------------------ skills build

const KIT_SKILL = 'obk-tdd';
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

// Covers the new behaviour, skills build: the Codex session, Orca naming the
// trust reason and codex, its screen idle, is `unknown` with the sentence as
// its trouble, not `blocked`. Beside it, the Claude session with the same
// reason on its idle screen stays `blocked` (unchanged). Nothing typed.
test(`skills build reports a Codex session with a stale ${TRUST} as unknown, with what the kit saw; a Claude one stays blocked`, async (t) => {
  const box = await createSandbox(t);
  const bots = await skillsFleetIn(box);
  await box.orca.set(ORCA_NAMES(TRUST));
  await giveTab(box, await tabOf(bots, BOT, 'reviewer'), { screen: CODEX_AFTER_TRUST });
  await addSkills(botYamlOf(bots, BOT), `kit:${KIT_SKILL}`);

  const result = await box.run(['skills', 'build', '--bots', 'bots', '--json']);

  assert.equal(result.code, 0, `the links were made whatever became of the telling: ${result.stdout}${result.stderr}`);
  const sessions = entryOf(answerOf(result), BOT).sessions;
  assert.ok(Array.isArray(sessions), `${BOT}'s links changed, so its sessions are reported, got: ${result.stdout}`);
  const reviewer = sessions.find((one) => one.session === 'reviewer');
  assert.equal(reviewer?.state, 'unknown', `the Codex session: the kit cannot tell, got ${JSON.stringify(sessions)}`);
  assert.equal('blocked' in reviewer, false, `the Codex session is not reported blocked, got ${JSON.stringify(reviewer)}`);
  assertSaysWhatItSaw(reviewer.trouble, 'the Codex session\'s trouble');
  assert.deepEqual(
    sessions.find((one) => one.session === 'daily'),
    { session: 'daily', harness: 'claude', state: 'blocked', blocked: TRUST },
    'the Claude session with the same reason stays blocked on it',
  );
  assert.deepEqual(await sentSinceLaunch(box), [], 'nothing typed anywhere');
});

// Covers the new behaviour, skills build's plain report: "not told", with the
// sentence, and nothing to settle.
test(`skills build's plain report on a Codex session with a stale ${TRUST} says not told, with what the kit saw`, async (t) => {
  const box = await createSandbox(t);
  const bots = await skillsFleetIn(box);
  await box.orca.set(ORCA_NAMES(TRUST));
  await giveTab(box, await tabOf(bots, BOT, 'reviewer'), { screen: CODEX_AFTER_TRUST });
  await addSkills(botYamlOf(bots, BOT), `kit:${KIT_SKILL}`);

  const result = await box.run(['skills', 'build', '--bots', 'bots']);

  assert.equal(result.code, 0, result.stderr);
  const line = linesAbout(result.stdout, `${BOT}/reviewer`);
  assert.match(line, /not told/, `got:\n${line}`);
  assertSaysWhatItSaw(line, 'the Codex session\'s line');
  assert.deepEqual(await sentSinceLaunch(box), [], 'nothing typed anywhere');
});

// ------------------------------------------------------------------ grooming

// Covers the new behaviour, grooming's typed line: a grooming tab with Codex
// in front, Orca naming codex there and the trust reason, the screen idle, is
// refused with an error carrying the sentence, not one asking for an answer.
// Grooming runs on Claude Code, so this tab is an odd one; the gate is the same.
test(`groom refuses a grooming tab with Codex in it and a stale ${TRUST}, saying what the kit saw, and types nothing`, async (t) => {
  const box = await createSandbox(t);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'bot-father', '--name', 'grooming']);
  assert.equal(added.code, 0, added.stderr);
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  const bots = box.path('bots');
  const tab = await tabOf(bots, 'bot-father', 'grooming');
  const told = await recordSession(box, { bots, bot: 'bot-father', tab, session: '0199b2c0-0001-4444-8888-cccccccccccc' });
  assert.equal(told.code, 0, told.stderr);
  await box.orca.set(ORCA_NAMES(TRUST));
  await giveTab(box, tab, { foreground: 'other-harness', agentIdentity: 'codex', screen: CODEX_AFTER_TRUST });
  const before = (await box.orca.terminals()).flatMap((terminal) => sentInto(terminal));

  const result = await box.run(['groom', '--bots', 'bots', '--compact']);

  assert.notEqual(result.code, 0, `refused, got:\n${result.stdout}${result.stderr}`);
  assert.ok(!/^\s+at /m.test(result.stderr), `a message, not a crash:\n${result.stderr}`);
  assertSaysWhatItSaw(result.stderr.replace(/\s+/g, ' '), 'the refusal');
  assert.deepEqual((await box.orca.terminals()).flatMap((terminal) => sentInto(terminal)), before, 'nothing typed anywhere');
});
