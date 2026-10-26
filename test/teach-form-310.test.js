// Claude Code 2.1.310's "Teach auto mode about your environment?" form, as
// `obk temp answer` and `obk session answer` answer it (#701). Kit 0.34.0
// refused it: "its Teach screen is no shape the kit knows: it has a row the
// 2.1.283 form does not have: Claude Code reads this project, …", and typed
// nothing. The form is the 2.1.302 form with its description on one row
// (helpers/screens.js CLAUDE_TEACH_FORM_310; its rows as read live, its frame
// a reconstruction). Claude Code holds the description as one string and
// wraps it at word boundaries to the tab's width, so the row count of the
// description follows the tab, not the version.
//
// What is held here:
//
//   1. Both commands answer the issue's screen with Esc alone, as the 2.1.302
//      form: into the session's tab and no other, with no `--enter`, and never
//      a return, which is Continue and starts the scan. The pointer may sit on
//      any of the form's rows, Continue among them, and the values are free
//      (#646).
//   2. The architect's ruling: the description is matched by its words,
//      however the tab wraps them. The description rows, from the row below
//      the title to the row above the first setting row, trimmed and joined
//      with single spaces, must be exactly the description string. So the
//      2.1.283 and 2.1.302 forms are known with the description on one row,
//      on two rows broken at any word, or on three rows or more.
//   3. Everything else is still exact, so the near misses are refused: a word
//      of the description changed, missing or added, or broken inside a word;
//      a description row out of place (below a setting row), another row
//      between, the description rows out of order, no description, the
//      description twice; a row more or a row less, a row twice, two pointers
//      or none, and the form quoted in a turn without the frame. Each refusal
//      prints what the screen shows, and nothing is typed.
//   4. After Esc the form must go. If it is still there, the command fails
//      and says so. On success it says which session, that it sent Esc (Not
//      now) to the Teach auto mode screen, and that the screen has gone.
//   5. The kit's typing gate (`questionIn` in src/orca.js) counts the 2.1.310
//      form as a question, so no kit path types a line and a return into it.
//   6. SETUP.md section 5's screen table names 2.1.310, as well as 2.1.283
//      and 2.1.302, in the row of the form that gets Esc, and keeps two Teach
//      rows.
//
// Not held here: the 2.1.283 form, the 2.1.302 form and the 2.1.289 list as
// captured (temp-answer.test.js, session-answer.test.js, teach-form-302.test.js,
// teach-form-values.test.js, teach-list.test.js), which keep their answers;
// the 2.1.289 list with its description wrapped otherwise, which the ruling
// does not make known, so no test asks for either answer; a description with
// two spaces inside a row (the ruling does not speak of it); who may run each
// command; the typing turn; and the system tests' own look (`onlyTeachFormOf`).
//
// Every run is in the sandbox (helpers/cli.js): the fake Orca shows each tab
// the screen a test gives it, and moves it on at the next key when told to
// (`screenAfterSend`).

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it as test } from 'node:test';

import { questionIn } from '../src/orca.js';
import { createSandbox, kitLaunchMark, repoRoot, sentInto, sessionIn } from './helpers/cli.js';
import { CLAUDE_ANSWERED, CLAUDE_TEACH_FORM, CLAUDE_TEACH_FORM_302, CLAUDE_TEACH_FORM_310 } from './helpers/screens.js';

const BOT = 'temp-bot';
const TASK = 'Read the open pull request and write down what it changes.';

/** Esc, alone: "Not now" on the form. Never a return, which is Continue. */
const ESC = '\x1b';

/** The form's title row, as read. */
const TITLE = 'Teach auto mode about your environment?';

/** The form's description, as Claude Code 2.1.310 holds it: one string. */
const DESCRIPTION = 'Claude Code reads this project, your recent Claude sessions, and optionally your shell history and other repositories. Claude analyzes this data and customizes auto mode to make better decisions.';

/** The 2.1.302 and 2.1.310 forms' foot, as read. */
const FOOT_302 = '   ←/→ to change · Enter to continue · Esc to cancel';

/** The rows of the 2.1.310 fixture, as they are there. */
const DESCRIPTION_310 = `   ${DESCRIPTION}`;
const HOW = '     How you use Claude here     Mixed';
const SHELL = '   ❯ Also scan shell history     false';
const REPOS = '     Also scan your other repos  false';
const CONTINUE = '     Continue';

/** The issue's screen. */
const ISSUE = CLAUDE_TEACH_FORM_310;

/** Where the issue screen's title row and foot row are. */
const TITLE_AT = ISSUE.findIndex((row) => row.trim() === TITLE);
const FOOT_AT = ISSUE.indexOf(FOOT_302);

/** The issue screen's own rows, from its title to its foot. */
const issueRows = ISSUE.slice(TITLE_AT, FOOT_AT + 1);

/**
 * `base` with each row that is a key of `swaps` given its value instead. Each
 * key must be a row of `base`, so a change to a fixture cannot make a case
 * the same as the fixture without anyone seeing it.
 */
function swapped(base, swaps) {
  for (const row of Object.keys(swaps)) assert.ok(base.includes(row), `the fixture has the row ${JSON.stringify(row)}`);
  return base.map((row) => (Object.hasOwn(swaps, row) ? swaps[row] : row));
}

/** `screen` with `line` put in at row `at`. */
const lineAt = (screen, at, line) => [...screen.slice(0, at), line, ...screen.slice(at)];

/** `screen` with `rows` put in right above its foot row. */
function withAboveFoot(screen, ...rows) {
  const at = screen.indexOf(FOOT_302);
  assert.notEqual(at, -1, 'the screen has the 2.1.302 foot');
  return [...screen.slice(0, at), ...rows, ...screen.slice(at)];
}

/**
 * `base` with its description rows (the rows below the title and above "How
 * you use Claude here") given as `rows` instead, each with the forms' left
 * margin of three spaces. The premise is checked: `base`'s own description
 * rows, trimmed and joined, are the description string.
 */
function withDescription(base, rows) {
  const title = base.findIndex((row) => row.trim() === TITLE);
  const how = base.findIndex((row) => row.trim().startsWith('How you use Claude here'));
  assert.ok(title !== -1 && how > title, 'the fixture has a title row and a "How you use Claude here" row below it');
  const own = base.slice(title + 1, how).map((row) => row.trim()).join(' ');
  assert.equal(own, DESCRIPTION, 'the premise: the fixture\'s description rows are the description string');
  return [...base.slice(0, title + 1), ...rows.map((row) => `   ${row}`), ...base.slice(how)];
}

/** The description's words, and the description in rows broken after each word whose index is in `breaks`. */
const WORDS = DESCRIPTION.split(' ');
function brokenAfter(...breaks) {
  const rows = [];
  let from = 0;
  for (const at of [...breaks, WORDS.length]) {
    rows.push(WORDS.slice(from, at).join(' '));
    from = at;
  }
  return rows;
}

/** The two rows of the 2.1.302 capture: broken after "and other". */
const AFTER_AND_OTHER = WORDS.indexOf('repositories.');

/** A turn's input box, a draft in it, as the reviewer's probes on PR #490 put it below a quotation. */
const INPUT_WITH_DRAFT = ['─'.repeat(200), '❯ run the pending command', '─'.repeat(200), '  ⏵⏵ auto mode on'];

/** The environment of a command a session's harness runs in `terminal`. */
const inTab = (box, terminal) => ({ ...box.env, ORCA_TERMINAL_HANDLE: terminal.handle, ORCA_TAB_ID: terminal.tabId, ...kitLaunchMark(box, terminal) });

/** The terminal Orca has for a session of the bot, by the book's tab. */
async function tabOf(box, bots, name) {
  const tab = (await sessionIn(bots, BOT, name))?.tab;
  const found = (await box.orca.terminals()).find((one) => one.tabId === tab);
  assert.ok(found, `Orca should have ${BOT}/${name}'s tab ${tab}`);
  return found;
}

/**
 * A bots folder with temp-bot on Claude Code, its long-lived session planner
 * brought up, and a temporary Claude session drafter that planner made.
 */
async function fleet(box) {
  const ok = async (args, env) => {
    const result = await box.run(args, env === undefined ? {} : { env });
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  };
  await ok(['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  await ok(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'planner']);
  await ok(['up', '--bots', 'bots', '--bot', BOT]);
  const bots = box.path('bots');
  const planner = await tabOf(box, bots, 'planner');
  await ok(['temp', 'make', '--bots', 'bots', '--name', 'drafter', '--prompt', TASK], inTab(box, planner));
  return { bots, planner, drafter: await tabOf(box, bots, 'drafter') };
}

/** Give one session's tab a screen of its own, and what it moves on to at the next key, if anything. */
async function showIn(box, bots, name, shown) {
  const tab = (await sessionIn(bots, BOT, name)).tab;
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((terminal) => (terminal.tabId === tab ? { ...terminal, ...shown } : terminal)),
  });
}

/** Every `terminal send` so far into every tab, by tab id. */
async function sendsByTab(box) {
  return Object.fromEntries((await box.orca.terminals()).map((terminal) => [terminal.tabId, sentInto(terminal)]));
}

/** What was sent since `before`, by tab id, for the tabs that got anything. */
async function sentSince(box, before) {
  const sent = {};
  for (const [tab, sends] of Object.entries(await sendsByTab(box))) {
    const since = sends.slice((before[tab] ?? []).length);
    if (since.length > 0) sent[tab] = since;
  }
  return sent;
}

/**
 * The two commands, each with the session it answers: `obk temp answer` on
 * drafter, run in its maker planner's tab, and `obk session answer` on
 * planner, run outside any tab, as the user in a plain terminal.
 */
const COMMANDS = [
  {
    name: 'obk temp answer',
    target: 'drafter',
    run: (box, ours) => box.run(['temp', 'answer', '--bots', 'bots', '--name', 'drafter'], { env: inTab(box, ours.planner) }),
    tabOf: (ours) => ours.drafter.tabId,
  },
  {
    name: 'obk session answer',
    target: 'planner',
    run: (box) => box.run(['session', 'answer', '--bots', 'bots', '--bot', BOT, '--session', 'planner']),
    tabOf: (ours) => ours.planner.tabId,
  },
];

/** The keys sent into one tab, all together, each send made with no `--enter`: a return of any kind would be Continue. */
function keysSent(sent, tab) {
  const sends = sent[tab] ?? [];
  assert.ok(sends.length > 0, `keys should have been sent into the session's tab, got: ${JSON.stringify(sent)}`);
  assert.ok(sends.every((one) => one.enter === false), `with no --enter: ${JSON.stringify(sends)}`);
  return sends.map((one) => one.text).join('');
}

/** The answer went: exit 0, and Esc alone into `tab` and no other. */
async function assertEscInto(box, result, before, tab, what) {
  assert.equal(result.code, 0, `${what}: it answers the form:\n${result.stdout}${result.stderr}`);
  const sent = await sentSince(box, before);
  assert.deepEqual(Object.keys(sent), [tab], `${what}: keys go into the session's tab and no other: ${JSON.stringify(sent)}`);
  assert.equal(keysSent(sent, tab), ESC, `${what}: Esc alone, never a return`);
}

/** A refusal: a non-zero exit, something said, no crash, and nothing typed into any tab. */
async function assertRefusedUntyped(box, result, before, what) {
  const said = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.code, 0, `${what} should be refused, got:\n${said}`);
  assert.notEqual(said.trim(), '', `${what}: a refusal says why`);
  assert.ok(!/^\s+at /m.test(said), `${what}: a message, not a crash:\n${said}`);
  assert.deepEqual(await sentSince(box, before), {}, `${what}: nothing is typed into any tab`);
  return said;
}

/** A small seeded generator (a linear congruential one), so a failing case can be run again exactly. */
function seeded(seed) {
  let state = seed >>> 0;
  return (below) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % below;
  };
}

/** `count` distinct word indexes in 1 … WORDS.length - 1, in order, from `next`: where the rows break. */
function breaksFrom(next, count) {
  const picked = new Set();
  while (picked.size < count) picked.add(1 + next(WORDS.length - 1));
  return [...picked].sort((a, b) => a - b);
}

/** How many of the tests below run at once: each brings up a fleet of its own in its own sandbox. */
const AT_ONCE = { concurrency: 8 };

for (const command of COMMANDS) {
  describe(`${command.name} on Claude Code 2.1.310's Teach form`, AT_ONCE, () => {
    // ------------------------------------------------------------ 1. the 2.1.310 form gets Esc

    for (const [label, screen] of [
      ['the screen of issue #701, the pointer on "Also scan shell history", above the input box', ISSUE],
      ['the issue\'s form with its pointer on Continue, the row a return would take', swapped(ISSUE, { [SHELL]: '     Also scan shell history     false', [CONTINUE]: '   ❯ Continue' })],
      ['the issue\'s form with its pointer on "Also scan your other repos"', swapped(ISSUE, { [SHELL]: '     Also scan shell history     false', [REPOS]: '   ❯ Also scan your other repos  false' })],
      ['the issue\'s form with "Also scan shell history" on true, which is a value (#646)', swapped(ISSUE, { [SHELL]: '   ❯ Also scan shell history     true' })],
      ['the issue\'s form with a draft in the input box below its foot, which does not count', swapped(ISSUE, { '❯': '❯ fix the flaky test' })],
      ['the issue\'s form\'s own rows alone under a rule of ▔, as 2.1.283 drew its form, nothing below', ['▔'.repeat(200), ...issueRows]],
    ]) {
      test(`F310-1 ${label}: Esc alone, into the session's tab alone`, async (t) => {
        const box = await createSandbox(t);
        const ours = await fleet(box);
        await showIn(box, ours.bots, command.target, { screen, screenAfterSend: CLAUDE_ANSWERED });
        const before = await sendsByTab(box);

        await assertEscInto(box, await command.run(box, ours), before, command.tabOf(ours), label);
      });
    }

    // ------------------------------------------------------------ 2. the description by its words, however it wraps

    for (const [label, screen] of [
      ['the 2.1.302 form with its description on one row', withDescription(CLAUDE_TEACH_FORM_302, [DESCRIPTION])],
      ['the captured 2.1.283 form, its own foot, with its description on one row', withDescription(CLAUDE_TEACH_FORM, [DESCRIPTION])],
      ['the 2.1.302 form with its description broken after its first word', withDescription(CLAUDE_TEACH_FORM_302, brokenAfter(1))],
      ['the 2.1.302 form with its description broken before its last word', withDescription(CLAUDE_TEACH_FORM_302, brokenAfter(WORDS.length - 1))],
      ['the 2.1.302 form with its description broken after "repositories.", at the sentence', withDescription(CLAUDE_TEACH_FORM_302, brokenAfter(AFTER_AND_OTHER + 1))],
      ['the 2.1.302 form with its description on three rows', withDescription(CLAUDE_TEACH_FORM_302, brokenAfter(10, 20))],
      ['the captured 2.1.283 form with its description on three rows', withDescription(CLAUDE_TEACH_FORM, brokenAfter(12, 22))],
      ['the 2.1.310 form with its description on five rows, as a narrow tab draws it', withDescription(ISSUE, brokenAfter(6, 13, 19, 25))],
    ]) {
      test(`F310-2 ${label}: Esc alone, into the session's tab alone`, async (t) => {
        const box = await createSandbox(t);
        const ours = await fleet(box);
        await showIn(box, ours.bots, command.target, { screen, screenAfterSend: CLAUDE_ANSWERED });
        const before = await sendsByTab(box);

        await assertEscInto(box, await command.run(box, ours), before, command.tabOf(ours), label);
      });
    }

    test('F310-2 the 2.1.302 form with its description in two rows broken at each word in turn, and in three to six rows broken at generated words: Esc alone each time', async (t) => {
      // The property: wherever the tab breaks the description between words,
      // the form is the form. Every two-row break is tried, on the 2.1.302
      // frame; then generated breaks into three to six rows, on the 2.1.283
      // and 2.1.302 frames by turns. One fleet serves every case, its tab
      // given each screen in turn.
      const seed = 701;
      t.diagnostic(`seed ${seed}`);
      const next = seeded(seed);
      const cases = [];
      for (let at = 1; at < WORDS.length; at += 1) cases.push({ breaks: [at], base: CLAUDE_TEACH_FORM_302, frame: '2.1.302' });
      for (let one = 0; one < 8; one += 1) {
        const breaks = breaksFrom(next, 2 + next(4));
        cases.push({ breaks, base: one % 2 === 0 ? CLAUDE_TEACH_FORM : CLAUDE_TEACH_FORM_302, frame: one % 2 === 0 ? '2.1.283' : '2.1.302' });
      }

      const box = await createSandbox(t);
      const ours = await fleet(box);
      for (const { breaks, base, frame } of cases) {
        const rows = brokenAfter(...breaks);
        const label = `the ${frame} form, its description in ${rows.length} rows broken after words ${breaks.join(', ')} (seed ${seed}): ${JSON.stringify(rows)}`;
        await showIn(box, ours.bots, command.target, { screen: withDescription(base, rows), screenAfterSend: CLAUDE_ANSWERED });
        const before = await sendsByTab(box);

        await assertEscInto(box, await command.run(box, ours), before, command.tabOf(ours), label);
      }
    });

    // ------------------------------------------------------------ 3. everything else is still exact

    // Each screen that is none of the known forms, with a row of it the
    // refusal has to print: what the screen shows.
    for (const [label, screen, row] of [
      // The description's words.
      ['the issue\'s form with a word of its description changed', swapped(ISSUE, { [DESCRIPTION_310]: DESCRIPTION_310.replace('and optionally', 'and always') }), /and always your shell history/],
      ['the issue\'s form with a word of its description missing, no "optionally"', swapped(ISSUE, { [DESCRIPTION_310]: DESCRIPTION_310.replace(' optionally', '') }), /and your shell history/],
      ['the issue\'s form with a word added to its description, "whole"', swapped(ISSUE, { [DESCRIPTION_310]: DESCRIPTION_310.replace('this project', 'this whole project') }), /reads this whole project/],
      ['the issue\'s form with the last word of its description missing, no "decisions."', swapped(ISSUE, { [DESCRIPTION_310]: DESCRIPTION_310.replace(' decisions.', '') }), /to make better(?! decisions)/],
      ['the issue\'s form with its description cut short after its first sentence', swapped(ISSUE, { [DESCRIPTION_310]: `   ${DESCRIPTION.slice(0, DESCRIPTION.indexOf('repositories.') + 'repositories.'.length)}` }), /Teach auto mode about your environment\?/],
      ['the 2.1.302 form with its description broken inside a word, "reposi" and "tories."', withDescription(CLAUDE_TEACH_FORM_302, [
        DESCRIPTION.slice(0, DESCRIPTION.indexOf('tories.')),
        DESCRIPTION.slice(DESCRIPTION.indexOf('tories.')),
      ]), /reposi/],
      ['the issue\'s form with the 2.1.289 list\'s description in place of its own', swapped(ISSUE, { [DESCRIPTION_310]: '   Auto mode works better when it knows your environment. Takes about a minute.' }), /Auto mode works better when it knows your environment/],
      // The description rows' place.
      ['the 2.1.302 form with the second row of its description moved below "How you use Claude here"', (() => {
        const rows = withDescription(CLAUDE_TEACH_FORM_302, brokenAfter(AFTER_AND_OTHER));
        const second = `   ${brokenAfter(AFTER_AND_OTHER)[1]}`;
        const without = rows.filter((one) => one !== second);
        return lineAt(without, without.indexOf(HOW) + 1, second);
      })(), /How you use Claude here[\s\S]*Claude analyzes this data/],
      ['the issue\'s form with its whole description below "How you use Claude here"', (() => {
        const without = ISSUE.filter((one) => one !== DESCRIPTION_310);
        return lineAt(without, without.indexOf(HOW) + 1, DESCRIPTION_310);
      })(), /How you use Claude here[\s\S]*Claude analyzes this data/],
      ['the 2.1.302 form with another row between the two rows of its description', withDescription(CLAUDE_TEACH_FORM_302, [
        brokenAfter(AFTER_AND_OTHER)[0], 'Takes about a minute.', brokenAfter(AFTER_AND_OTHER)[1],
      ]), /Takes about a minute/],
      ['the issue\'s form with another row between its description and "How you use Claude here"', lineAt(ISSUE, ISSUE.indexOf(HOW), '   Takes about a minute.'), /Takes about a minute/],
      ['the 2.1.302 form with the two rows of its description swapped', withDescription(CLAUDE_TEACH_FORM_302, brokenAfter(AFTER_AND_OTHER).reverse()), /better decisions\.[\s\S]*Claude Code reads this project/],
      ['the issue\'s form with its description above its title', swapped(ISSUE, { [`   ${TITLE}`]: DESCRIPTION_310, [DESCRIPTION_310]: `   ${TITLE}` }), /better decisions\.[\s\S]*Teach auto mode about your environment\?/],
      ['the issue\'s form with no description', ISSUE.filter((one) => one !== DESCRIPTION_310), /Teach auto mode about your environment\?/],
      ['the issue\'s form with its description twice', lineAt(ISSUE, ISSUE.indexOf(HOW), DESCRIPTION_310), /Teach auto mode about your environment\?/],
      // The rest of the form, as for the 2.1.302 form.
      ['the issue\'s form with a row more', withAboveFoot(ISSUE, '     Also scan your home folder  false'), /Also scan your home folder/],
      ['the issue\'s form with a row less, no "Also scan your other repos"', ISSUE.filter((one) => one !== REPOS), /Also scan shell history\s+false/],
      ['the issue\'s form with Continue twice', withAboveFoot(ISSUE, CONTINUE), /Teach auto mode about your environment\?/],
      ['the issue\'s form with its two scan rows swapped', swapped(ISSUE, { [SHELL]: REPOS, [REPOS]: SHELL }), /Also scan your other repos[\s\S]*Also scan shell history/],
      ['the issue\'s form with two pointers', swapped(ISSUE, { [CONTINUE]: '   ❯ Continue' }), /❯ Continue/],
      ['the issue\'s form with no pointer', swapped(ISSUE, { [SHELL]: '     Also scan shell history     false' }), /Also scan shell history\s+false/],
      ['the issue\'s whole form quoted in a turn, a line of the turn below it, then the input box with a draft', ['❯ What was the form?', '⏺ The form Claude Code 2.1.310 showed was:', ...issueRows, '  This is a quotation from the previous run.', ...INPUT_WITH_DRAFT], /This is a quotation from the previous run/],
      ['the issue\'s form with a line of a turn right above its title, under the rule', lineAt(ISSUE, TITLE_AT, '⏺ The form Claude Code 2.1.310 showed was:'), /The form Claude Code 2\.1\.310 showed was:/],
      ['the issue\'s form with a line of a turn right below its foot, above the input box', lineAt(ISSUE, FOOT_AT + 1, '  This is a quotation from the previous run.'), /This is a quotation from the previous run/],
    ]) {
      test(`F310-3 ${label} is refused, says what the screen shows, and nothing is typed`, async (t) => {
        const box = await createSandbox(t);
        const ours = await fleet(box);
        await showIn(box, ours.bots, command.target, { screen, screenAfterSend: CLAUDE_ANSWERED });
        const before = await sendsByTab(box);

        const said = await assertRefusedUntyped(box, await command.run(box, ours), before, label);
        assert.match(said, row, `it prints what the screen shows, this row among it: ${said}`);
      });
    }

    // ------------------------------------------------------------ 4. the form gone, and what it says

    test('F310-4 a 2.1.310 form still on screen a few seconds after Esc is a failure, and it says so', async (t) => {
      // The key went in and Claude Code did not move on: every read after it
      // still shows the form.
      const box = await createSandbox(t);
      const ours = await fleet(box);
      await showIn(box, ours.bots, command.target, { screen: ISSUE });
      const before = await sendsByTab(box);

      const result = await command.run(box, ours);

      const said = `${result.stdout}${result.stderr}`;
      assert.notEqual(result.code, 0, `the form did not go, so it did not work:\n${said}`);
      assert.ok(!/^\s+at /m.test(said), `a message, not a crash:\n${said}`);
      assert.equal(keysSent(await sentSince(box, before), command.tabOf(ours)), ESC, 'Esc was sent, and nothing more');
      assert.match(said, /still/i, `it says the form is still there: ${said}`);
      assert.ok(said.includes(TITLE), `naming it: ${said}`);
    });

    test('F310-4 a 2.1.310 form that comes back after Esc with its description wrapped on two rows is still there: a failure, and it says so', async (t) => {
      // The tab narrowed as the key went in: the same form, drawn again with
      // its description on two rows, is still the form.
      const box = await createSandbox(t);
      const ours = await fleet(box);
      await showIn(box, ours.bots, command.target, { screen: ISSUE, screenAfterSend: withDescription(CLAUDE_TEACH_FORM_302, brokenAfter(AFTER_AND_OTHER)) });
      const before = await sendsByTab(box);

      const result = await command.run(box, ours);

      const said = `${result.stdout}${result.stderr}`;
      assert.notEqual(result.code, 0, `the form did not go, so it did not work:\n${said}`);
      assert.ok(!/^\s+at /m.test(said), `a message, not a crash:\n${said}`);
      assert.equal(keysSent(await sentSince(box, before), command.tabOf(ours)), ESC, 'Esc was sent, and nothing more');
      assert.match(said, /still/i, `it says the form is still there: ${said}`);
    });

    test('F310-4 on success it says which session, that it sent Esc (Not now) to the Teach auto mode screen, and that the screen has gone', async (t) => {
      const box = await createSandbox(t);
      const ours = await fleet(box);
      await showIn(box, ours.bots, command.target, { screen: ISSUE, screenAfterSend: CLAUDE_ANSWERED });

      const result = await command.run(box, ours);

      assert.equal(result.code, 0, `it answers the form:\n${result.stdout}${result.stderr}`);
      const said = result.stdout;
      assert.ok(said.includes(command.target), `it says which session: ${said}`);
      assert.match(said, /\bEsc\b/, `that it sent Esc: ${said}`);
      assert.match(said, /Not now/, `which is Not now: ${said}`);
      assert.match(said, /Teach auto mode/, `to the Teach auto mode screen: ${said}`);
      assert.match(said, /\bgone\b|\bclosed\b|no longer/i, `and that the screen has gone: ${said}`);
    });
  });
}

// ------------------------------------------------------------ 5. the typing gate

test('F310-5 questionIn: the 2.1.310 form is a question, above the input box or under a rule of ▔; quoted in a turn it is not', () => {
  // A line typed with a return into this form is Continue, which starts the
  // scan, so the kit's gate has to see it. The quotation beside it, with the
  // input line back below, is history: a gate that took it for a question
  // would swallow every key.
  assert.equal(questionIn(ISSUE), true, 'the form above the input box, the pointer on "Also scan shell history"');
  assert.equal(questionIn(swapped(ISSUE, { [SHELL]: '     Also scan shell history     false', [CONTINUE]: '   ❯ Continue' })), true, 'the form above the input box, the pointer on Continue');
  assert.equal(questionIn(['▔'.repeat(200), ...issueRows]), true, 'the form\'s own rows under a rule of ▔, nothing below');
  assert.equal(
    questionIn(['❯ What was the form?', '⏺ The form Claude Code 2.1.310 showed was:', ...issueRows, '  This is a quotation from the previous run.', ...INPUT_WITH_DRAFT.map((row) => (row.startsWith('❯') ? '❯' : row))]),
    false,
    'the form quoted in a turn, a line of the turn after it, the empty input box below',
  );
});

// ------------------------------------------------------------ 6. SETUP.md

test('F310-6 SETUP.md section 5\'s screen table names 2.1.310, 2.1.283 and 2.1.302 in the Teach auto mode row whose answer is Esc, and keeps two Teach rows', async () => {
  // The rows are found as teach-form-302.test.js F302-5 finds them: a Claude
  // Code row that names `Teach auto mode`, and of those the one that says the
  // kit sends Esc.
  const setup = await readFile(path.join(repoRoot, 'SETUP.md'), 'utf8');
  const lines = setup.split('\n');
  const start = lines.findIndex((line) => line.startsWith('## 5.'));
  assert.notEqual(start, -1, 'SETUP.md has a section 5');
  let end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  if (end === -1) end = lines.length;
  const rows = lines.slice(start + 1, end).filter((line) => line.trim().startsWith('|'));
  const teach = rows.filter((line) => /Claude Code/.test(line.split('|')[1] ?? '') && /Teach auto mode/.test(line.split('|')[1] ?? ''));
  assert.equal(teach.length, 2, `the table keeps two Teach auto mode rows, found ${teach.length}:\n${teach.join('\n')}`);
  const esc = teach.filter((line) => /\bEsc\b/.test(line.split('|')[3] ?? ''));
  assert.equal(esc.length, 1, `one Teach auto mode row of the table says the kit sends Esc, found ${esc.length}:\n${teach.join('\n')}`);
  assert.match(esc[0], /2\.1\.310/, `the row of the form that gets Esc names 2.1.310: ${esc[0]}`);
  assert.match(esc[0], /2\.1\.283/, `and still names 2.1.283: ${esc[0]}`);
  assert.match(esc[0], /2\.1\.302/, `and still names 2.1.302: ${esc[0]}`);
});
