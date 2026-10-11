// The kit never types into a session that shows a question of its harness's
// own, wherever the harness draws it on the screen (#491).
//
// Claude Code 2.1.289 shows its "Teach auto mode about your environment?" list
// ABOVE the input box, after the session's first turn in auto mode
// (helpers/screens.js CLAUDE_TEACH_LIST, a live capture from #489). The input
// box stays below it, and its own empty `❯` input line is the lowest pointer
// row on the screen. A return typed into that screen confirms the selected
// "1. Yes" and starts auto mode's teach scan.
//
// The requirement, as these tests hold it:
//
//   1. The kit's gate (`questionIn` in src/orca.js) counts a question drawn
//      above the input box as a question: a numbered choice list with the
//      harness's pointer on a choice, or a form's foot such as "Enter to
//      confirm · Esc to cancel".
//   2. Every kit path that types a line into a running session refuses while
//      such a question is up, and types nothing, as it already refuses a
//      question at the bottom of the screen (`question-on-screen`). This file
//      holds the mail Escape and the skills reload; the session naming, the
//      list line, session clear and compact, and the grooming line are held
//      in their own files, beside the tests of those paths.
//   3. Claude Code 2.1.283's "Teach auto mode" form (CLAUDE_TEACH_FORM) stays
//      refused.
//   4. What stays NOT a question: the ordinary idle and answered screens, a
//      draft in the input line, the slash-command menu Claude Code draws above
//      its box, a numbered list in the conversation, past turns echoed with
//      the pointer, and a question's words that are history (quoted in the
//      conversation, other conversation rows after them, the input line back
//      below). A guard that took those for questions would swallow every
//      key.
//   5. The system tests' own look, `questionOn` and `waitingOn` in
//      helpers/screens.js, sees the list too, and still not the history.
//
// Every absence here has its presence beside it: the same path, on the same
// capture with the list taken out (CLAUDE_TEACH_LIST_GONE), types its line.
// Expected values are the requirement's: true and false, the kit's word
// `question-on-screen`, and the keys the paths type.
//
// Since #555 fleet mail types nothing else. Its one key is the Escape of
// `obk message send --interrupt`, into a busy receiver whose tab passes the
// gate. So the mail tests below send with --interrupt to a busy receiver.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { questionIn } from '../src/orca.js';
import {
  botHomeOf,
  createSandbox,
  sentInto,
  sessionIn,
} from './helpers/cli.js';
import {
  CLAUDE_ANSWERED,
  CLAUDE_CLEAR_AFTER_DRAFT,
  CLAUDE_CLEAR_TYPED,
  CLAUDE_COMPACT_TYPED,
  CLAUDE_IDLE,
  CLAUDE_TEACH_FORM,
  CLAUDE_TEACH_FORM_ON_CONTINUE,
  CLAUDE_TEACH_LIST,
  CLAUDE_TEACH_LIST_BLANK_UNDER,
  CLAUDE_TEACH_LIST_FOOT_WRAPPED,
  CLAUDE_TEACH_LIST_GONE,
  CLAUDE_TEACH_LIST_NO_FOOT_BLANK_UNDER,
  CODEX_ANSWERED,
  CODEX_DRAFT,
  CODEX_IDLE,
  CODEX_NEW_TYPED,
  CODEX_SLASH_TYPED,
  FORM_IN_HISTORY,
  LIST_IN_HISTORY,
  NUMBERED_ANSWER,
  NUMBERED_TURN_ECHOED,
  QUESTION_IN_HISTORY,
  questionOn,
  waitingOn,
} from './helpers/screens.js';
import { addSkills, answerOf, botYamlOf, entryOf, SKILL_DIRS } from './helpers/skills.js';

/** The kit's word for a tab whose screen shows a harness's own question. */
const QUESTION = 'question-on-screen';

/** The list's title, as captured. */
const TITLE = 'Teach auto mode about your environment?';

/** The list's foot, as captured. */
const FOOT = 'Enter to confirm · Esc to cancel';

/**
 * CLAUDE_TEACH_LIST with its pointer on `choice` and off "1. Yes", nothing
 * else changed: a reconstruction. The pointer moves with the arrow keys before
 * a return (#489).
 */
const listOn = (choice) => CLAUDE_TEACH_LIST.map((row) => {
  if (row === '  ❯ 1. Yes') return '    1. Yes';
  if (row === `    ${choice}`) return `  ❯ ${choice}`;
  return row;
});

/** The list with its pointer on "2. Not now": a reconstruction. */
const LIST_ON_NOT_NOW = listOn('2. Not now');

/** The list with its pointer on "3. Don't show again": a reconstruction. */
const LIST_ON_THREE = listOn('3. Don\'t show again');

/** The list with its foot row taken out: the numbered choices and the pointer alone. A reconstruction. */
const LIST_WITHOUT_FOOT = CLAUDE_TEACH_LIST.filter((row) => row.trim() !== FOOT);

/**
 * The list's choices with their numbers taken out, the pointer on the first,
 * and its foot kept: a form above the input box, known by its foot. A
 * reconstruction made up to test the rule: no such screen was seen.
 */
const FORM_ABOVE_THE_BOX = CLAUDE_TEACH_LIST.map((row) => row.replace(/^( {2}(?:❯ | {2}))[123]\. /, '$1'));

// The premises of the reconstructions: each changed what it says, and only that.
test('the reconstructions here are the capture with one change each', () => {
  assert.deepEqual(LIST_ON_NOT_NOW.filter((row) => row.includes('❯ ') && /\d\. /.test(row)), ['  ❯ 2. Not now']);
  assert.deepEqual(LIST_ON_THREE.filter((row) => row.includes('❯ ') && /\d\. /.test(row)), ['  ❯ 3. Don\'t show again']);
  assert.equal(LIST_WITHOUT_FOOT.length, CLAUDE_TEACH_LIST.length - 1);
  assert.deepEqual(FORM_ABOVE_THE_BOX.filter((row) => /^ {2}(?:❯ | {2})\S/.test(row) && !row.includes(TITLE)).slice(0, 3), ['  ❯ Yes', '    Not now', '    Don\'t show again']);
  assert.ok(CLAUDE_TEACH_LIST_GONE.every((row) => CLAUDE_TEACH_LIST.includes(row)), 'the list gone is the capture with rows taken out');
  assert.ok(!CLAUDE_TEACH_LIST_GONE.some((row) => row.includes(TITLE) || row.includes('1. Yes') || row.includes(FOOT)), 'and none of the list\'s rows is left');
  assert.equal(CLAUDE_TEACH_LIST_GONE.at(-3), '❯', 'its input line is the captured one');
});

// ------------------------------------------------------------- the gate itself

// Covers criterion 1: the capture of issue #491 is a question to the kit's gate.
test('questionIn: Claude Code 2.1.289\'s Teach list, as captured, above the input box, is a question', () => {
  assert.equal(questionIn(CLAUDE_TEACH_LIST), true);
});

// Covers criterion 1: whichever choice the pointer is on.
test('questionIn: the Teach list with its pointer moved to "2. Not now" or "3. Don\'t show again" is a question', () => {
  assert.equal(questionIn(LIST_ON_NOT_NOW), true, 'the pointer on "2. Not now"');
  assert.equal(questionIn(LIST_ON_THREE), true, 'the pointer on "3. Don\'t show again"');
});

// Covers criterion 1, the first of its two signs: a numbered choice list with
// the harness's pointer on a choice, above the box, needs no foot row.
test('questionIn: the Teach list without its foot row, its numbered choices and pointer above the input box, is a question', () => {
  assert.equal(questionIn(LIST_WITHOUT_FOOT), true);
});

// Covers criterion 1, the second of its two signs: a form's foot above the box
// is a question with no numbers on its choices.
test('questionIn: a form above the input box, its choices unnumbered and its foot "Enter to confirm · Esc to cancel", is a question', () => {
  assert.equal(questionIn(FORM_ABOVE_THE_BOX), true);
});

// Covers criterion 1, any layout above the box: a blank row between the
// question and the input box's top rule does not hide it, from the gate or
// from the system tests' own look. Asked by the implementer's hand mutation
// check (a gate that reads only the row right above the rule).
test('a blank row between the Teach list and the input box\'s top rule: questionIn is true and questionOn gives the list, with its foot and with its foot taken out', () => {
  for (const [label, screen] of [
    ['the captured list, a blank row under its foot', CLAUDE_TEACH_LIST_BLANK_UNDER],
    ['the list without its foot, a blank row under its last choice', CLAUDE_TEACH_LIST_NO_FOOT_BLANK_UNDER],
  ]) {
    const rule = screen.findIndex((row) => row.includes('answer-bot.helper.vm2yc5b2'));
    assert.equal(screen[rule - 1], '', `${label}: the premise, a blank row right above the input box's top rule`);
    assert.equal(questionIn(screen), true, `${label}: a question to the gate`);
    const rows = questionOn(screen);
    assert.ok(Array.isArray(rows), `${label}: a question to the look, got: ${JSON.stringify(rows)}`);
    const trimmed = rows.map((row) => row.trim());
    for (const row of [TITLE, '❯ 1. Yes', '3. Don\'t show again']) {
      assert.ok(trimmed.includes(row), `${label}: what the look gives back holds "${row}", got:\n${rows.join('\n')}`);
    }
  }
});

// Covers criterion 1, any form: in a narrow pane the list's foot wraps onto
// two rows above the input box's top rule, and the numbered choices with the
// pointer above them still make it a question, to the gate and to the system
// tests' own look. Asked by the review of the change.
test('the Teach list with its foot wrapped onto two rows above the input box\'s top rule: questionIn is true and questionOn gives the list', () => {
  const screen = CLAUDE_TEACH_LIST_FOOT_WRAPPED;
  const rule = screen.findIndex((row) => row.includes('answer-bot.helper.vm2yc5b2'));
  assert.deepEqual(screen.slice(rule - 2, rule), ['  Enter to confirm ·', '  Esc to cancel'], 'the premise: the wrapped foot right above the top rule');

  assert.equal(questionIn(screen), true, 'a question to the gate');
  const rows = questionOn(screen);
  assert.ok(Array.isArray(rows), `a question to the look, got: ${JSON.stringify(rows)}`);
  const trimmed = rows.map((row) => row.trim());
  for (const row of [TITLE, '❯ 1. Yes', '3. Don\'t show again']) {
    assert.ok(trimmed.includes(row), `what the look gives back holds "${row}", got:\n${rows.join('\n')}`);
  }
});

// Covers criterion 3. Passes before the change: it holds the change to keeping it.
test('questionIn: Claude Code 2.1.283\'s Teach form, as captured and with its pointer on Continue, is still a question', () => {
  assert.equal(questionIn(CLAUDE_TEACH_FORM), true, 'the form as captured');
  assert.equal(questionIn(CLAUDE_TEACH_FORM_ON_CONTINUE), true, 'the form on Continue');
});

// Covers criterion 4. These pass before the change: they hold the new rule to
// leaving every one of them alone. The presence is the first row: the same
// capture with the list taken out is no question, so a true above comes from
// the list and not from the rest of the screen.
for (const [label, screen] of [
  ['the 2.1.289 capture with the list taken out, its input box left', CLAUDE_TEACH_LIST_GONE],
  ['Claude Code 2.1.283\'s idle input line, captured', CLAUDE_IDLE],
  ['Claude Code 2.1.283 after an answered turn, a numbered pair in its wrapped echo, captured', CLAUDE_ANSWERED],
  ['Codex 0.157.1\'s idle input line and its status rows, captured', CODEX_IDLE],
  ['Codex 0.157.1 with a long draft wrapped in its input line, captured', CODEX_DRAFT],
  ['Codex 0.157.1 after an answered turn, captured', CODEX_ANSWERED],
  ['Claude Code 2.1.288\'s slash menu above its input box, /clear typed', CLAUDE_CLEAR_TYPED],
  ['Claude Code\'s slash menu above its input box, /compact typed', CLAUDE_COMPACT_TYPED],
  ['Claude Code\'s slash menu above its input box over a draft and /clear', CLAUDE_CLEAR_AFTER_DRAFT],
  ['Codex 0.160.0\'s slash popup above its input line, "/" typed, its pointer on /model', CODEX_SLASH_TYPED],
  ['Codex 0.160.0\'s slash popup above its input line, /new typed and selected', CODEX_NEW_TYPED],
  ['a numbered list in the model\'s answer, the input line below it', NUMBERED_ANSWER],
  ['a past turn of the user\'s own, a numbered list echoed with the pointer, an answer after it', NUMBERED_TURN_ECHOED],
  ['Codex\'s update offer quoted in history, the input line back below it', QUESTION_IN_HISTORY],
  ['the 2.1.283 Teach form\'s words quoted in history, the input line back below them', FORM_IN_HISTORY],
  ['the 2.1.289 Teach list\'s words quoted in history, a row after them, the input line back below', LIST_IN_HISTORY],
]) {
  test(`questionIn: ${label} is no question`, () => {
    assert.equal(questionIn(screen), false);
  });
}

// ------------------------------------------------- the system tests' own look

// Covers criterion 5: the look gives back the question's rows for the capture.
test('questionOn: Claude Code 2.1.289\'s Teach list, as captured, is a question, and what it gives back holds the list', () => {
  const rows = questionOn(CLAUDE_TEACH_LIST);

  assert.ok(Array.isArray(rows), `the capture is a question to the look, got: ${JSON.stringify(rows)}`);
  const trimmed = rows.map((row) => row.trim());
  for (const row of [TITLE, '❯ 1. Yes', '2. Not now', FOOT]) {
    assert.ok(trimmed.includes(row), `what it gives back, for a wait that ran out to show, holds "${row}", got:\n${rows.join('\n')}`);
  }
});

// Covers criterion 5 on the other choices and the two signs.
test('questionOn: the Teach list on its other choices, without its foot, and a form above the box by its foot alone, are questions', () => {
  for (const [label, screen] of [
    ['the pointer on "2. Not now"', LIST_ON_NOT_NOW],
    ['the pointer on "3. Don\'t show again"', LIST_ON_THREE],
    ['no foot row', LIST_WITHOUT_FOOT],
    ['unnumbered choices and the foot', FORM_ABOVE_THE_BOX],
  ]) {
    assert.ok(Array.isArray(questionOn(screen)), `${label}: a question to the look`);
  }
});

// Covers criterion 5, the side the look must keep. These pass before the
// change. The first is the presence for the test above: the same capture with
// the list taken out.
test('questionOn: the capture with the list taken out, and every history screen, are no question', () => {
  for (const [label, screen] of [
    ['the 2.1.289 capture with the list taken out', CLAUDE_TEACH_LIST_GONE],
    ['the 2.1.289 Teach list\'s words in history', LIST_IN_HISTORY],
    ['the 2.1.283 Teach form\'s words in history', FORM_IN_HISTORY],
    ['Codex\'s update offer in history', QUESTION_IN_HISTORY],
    ['a numbered list in an answer', NUMBERED_ANSWER],
    ['a numbered past turn echoed with the pointer', NUMBERED_TURN_ECHOED],
    ['Claude Code after an answered turn, captured', CLAUDE_ANSWERED],
    ['Claude Code\'s slash menu above its box, /clear typed', CLAUDE_CLEAR_TYPED],
    ['Codex\'s slash popup above its input line, /new typed', CODEX_NEW_TYPED],
  ]) {
    assert.equal(questionOn(screen), undefined, `${label} is no question`);
  }
});

/** A stand-in for a system test's own way of asking Orca: it answers every `terminal read` with `rows` as the rendered screen, and keeps what it was asked. */
function orcaShowing(rows) {
  const asked = [];
  const ask = (args) => {
    asked.push(args);
    return { ok: true, result: { terminal: { handle: args[args.indexOf('--terminal') + 1], source: 'screen', tail: rows } } };
  };
  return { ask, asked };
}

// Covers criterion 5 for `waitingOn`: what stands between a live tab and a
// line is the list, named with its rows; with the list gone, nothing is.
test('waitingOn: a tab showing the Teach list is waiting on a question, and the sentence shows the list; with the list gone, nothing is in the way', () => {
  const handle = 'term_teach_list';

  const up = orcaShowing(CLAUDE_TEACH_LIST);
  const said = waitingOn(up.ask, handle);
  assert.equal(typeof said, 'string', `the list is in the way of a line, got: ${JSON.stringify(said)}`);
  assert.ok(said.includes(TITLE), `the sentence shows the list's title, got: ${said}`);
  assert.ok(said.includes('❯ 1. Yes'), `and its selected choice, got: ${said}`);
  assert.ok(up.asked.some((args) => args.includes('read') && args.includes(handle) && args.includes('--screen')), `it read that tab's screen, got: ${JSON.stringify(up.asked)}`);

  const gone = orcaShowing(CLAUDE_TEACH_LIST_GONE);
  assert.equal(waitingOn(gone.ask, handle), undefined, 'the same screen with the list gone has nothing in the way');
});

// Covers criterion 5's other side for `waitingOn`. Passes before the change.
test('waitingOn: a tab whose screen holds the list\'s words as history has nothing in the way', () => {
  assert.equal(waitingOn(orcaShowing(LIST_IN_HISTORY).ask, 'term_history'), undefined);
});

// ---------------------------------------------------- the mail Escape of --interrupt

/** Give one tab a screen of its own; every other tab keeps the screen it had. */
async function showIn(box, tab, shown) {
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((terminal) => (terminal.tabId === tab ? { ...terminal, ...shown } : terminal)),
  });
}

/** Give one tab what `showIn` gives it, and make it busy by Orca's tui-idle wait. */
const busyIn = (box, tab, shown = {}) => showIn(box, tab, { tuiIdle: 'busy', ...shown });

/** The tab one session lives in, as the book has it. */
const tabOf = async (bots, bot, session = 'daily') => (await sessionIn(bots, bot, session)).tab;

/** Each `terminal send` into every tab since its launch line, by tab id. */
async function sentSinceLaunch(box) {
  const after = {};
  for (const terminal of await box.orca.terminals()) after[terminal.tabId] = sentInto(terminal).slice(1);
  return after;
}

/** A Claude bot `writer` and a Codex bot `coder`, each with one session, both up, nothing typed since. */
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

/** Send one urgent letter to the Claude bot `writer`, from the Codex bot, with --interrupt, plain, and answer what it printed. */
async function send(box) {
  const result = await box.run([
    'message', 'send', '--bots', 'bots', '--to', 'writer', '--from', 'coder/daily',
    '--subject', 'the staging host', '--text', 'It is down again.', '--interrupt',
  ]);
  assert.equal(result.code, 0, `the letter went whatever became of the interrupt: ${result.stdout}${result.stderr}`);
  return result.stdout + result.stderr;
}

/** The letter is in the mailbox, and nothing at all went into any tab after its launch line. */
async function assertQueuedUntyped(box, what) {
  assert.equal((await box.orca.messages()).length, 1, `${what}: the letter is in the mailbox`);
  assert.deepEqual(Object.values(await sentSinceLaunch(box)).flat(), [], `${what}: and nothing went into any tab`);
}

// Covers criteria 1 and 2 for the mail Escape, and criterion 3 beside them.
for (const [label, screen] of [
  ['Claude Code 2.1.289\'s Teach list above its input box, as captured', CLAUDE_TEACH_LIST],
  ['the Teach list with its pointer on "2. Not now"', LIST_ON_NOT_NOW],
  ['the Teach list with its pointer on "3. Don\'t show again"', LIST_ON_THREE],
  ['Claude Code 2.1.283\'s Teach form, as captured', CLAUDE_TEACH_FORM],
]) {
  test(`a busy Claude tab showing ${label} gets no Escape, and the output says a question is waiting`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    await busyIn(box, await tabOf(bots, 'writer'), { screen });

    const said = await send(box);

    assert.ok(said.includes(QUESTION), `${label}: the output says the tab is waiting on a question, got:\n${said}`);
    await assertQueuedUntyped(box, label);
  });
}

// Covers criterion 2, "says": the plain report for the list, as for any question.
test('the plain report for a busy Claude tab on the Teach list names question-on-screen', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await busyIn(box, await tabOf(bots, 'writer'), { screen: CLAUDE_TEACH_LIST });

  const said = await send(box);

  assert.ok(said.includes(`(${QUESTION})`), `the report names what the tab is waiting on, got:\n${said}`);
  await assertQueuedUntyped(box, 'the plain report, Teach list');
});

// The presence beside the tests above: the same capture with the list taken
// out, and the history screens of criterion 4, get the Escape as ever, one
// key into the receiver's tab.
for (const [label, screen] of [
  ['the 2.1.289 capture with the list taken out', CLAUDE_TEACH_LIST_GONE],
  ['the Teach list\'s words quoted in history, the input line back below', LIST_IN_HISTORY],
  ['a numbered past turn echoed with the pointer, an answer after it', NUMBERED_TURN_ECHOED],
]) {
  test(`a busy Claude tab showing ${label}: no question, and it gets its one Escape`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    const reader = await tabOf(bots, 'writer');
    await busyIn(box, reader, { screen });

    const said = await send(box);

    assert.ok(!said.includes(QUESTION), `${label}: nothing is waiting, got:\n${said}`);
    assert.equal((await box.orca.messages()).length, 1, `${label}: the letter is in the mailbox`);
    const sent = await sentSinceLaunch(box);
    assert.deepEqual(sent[reader].map(({ text, enter }) => ({ text, enter })), [{ text: '\x1b', enter: false }], `${label}: one Escape into the receiver's tab, got ${JSON.stringify(sent[reader])}`);
    for (const [tab, sends] of Object.entries(sent)) {
      if (tab !== reader) assert.deepEqual(sends, [], `${label}: nothing into ${tab}`);
    }
  });
}

// ----------------------------------------------------------- the skills reload

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

/** A skills build that links one more skill into api-bot, `--json`: what it says of each session. */
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

// Covers criteria 1 and 2 for the skills reload, and criterion 3 beside them.
// The list fails before the change; the 2.1.283 form passes before it too.
for (const [label, screen] of [
  ['Claude Code 2.1.289\'s Teach list above its input box, as captured', CLAUDE_TEACH_LIST],
  ['Claude Code 2.1.283\'s Teach form, as captured', CLAUDE_TEACH_FORM],
]) {
  test(`a Claude session showing ${label} gets no /reload-skills, and is reported blocked on question-on-screen`, async (t) => {
    // `/reload-skills` goes in with a return, and a return on the list takes
    // "1. Yes". Only the Claude session's tab shows it.
    const box = await createSandbox(t);
    const bots = await skillsFleetIn(box);
    await showIn(box, await tabOf(bots, BOT, 'daily'), { screen });

    const sessions = await build(box, bots);

    assert.deepEqual(sessions, [
      { session: 'daily', harness: 'claude', state: 'blocked', blocked: QUESTION },
      { session: 'reviewer', harness: 'codex', state: 'next-turn', read: [codexSkillMd(bots)] },
    ]);
    assert.deepEqual(Object.values(await sentSinceLaunch(box)).flat(), [], `${label}: no ${RELOAD}, and nothing else, typed anywhere`);
  });
}

// The presence beside the test above: the same capture with the list taken
// out gets `/reload-skills`, with a return, into the Claude session's tab
// alone. Passes before the change.
test('a Claude session on the 2.1.289 capture with the list taken out gets /reload-skills, and is reported reloaded', async (t) => {
  const box = await createSandbox(t);
  const bots = await skillsFleetIn(box);
  const daily = await tabOf(bots, BOT, 'daily');
  await showIn(box, daily, { screen: CLAUDE_TEACH_LIST_GONE });

  const sessions = await build(box, bots);

  assert.deepEqual(sessions, [
    { session: 'daily', harness: 'claude', state: 'reloaded' },
    { session: 'reviewer', harness: 'codex', state: 'next-turn', read: [codexSkillMd(bots)] },
  ]);
  const sent = await sentSinceLaunch(box);
  assert.deepEqual(sent[daily].map(({ text, enter }) => ({ text, enter })), [{ text: RELOAD, enter: true }], `one ${RELOAD} with a return into daily's tab`);
  for (const [tab, sends] of Object.entries(sent)) {
    if (tab !== daily) assert.deepEqual(sends, [], `nothing into ${tab}`);
  }
});
