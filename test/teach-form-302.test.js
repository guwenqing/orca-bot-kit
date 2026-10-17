// Claude Code 2.1.302's "Teach auto mode about your environment?" form, as
// `obk temp answer` and `obk session answer` answer it (#604). The kit refused
// it: "its Teach screen is no shape the kit knows", and the screen stopped the
// session until a person answered it. The form is the 2.1.283 form with
// "Also scan shell history" on `false` and the foot
// `←/→ to change · Enter to continue · Esc to cancel` (helpers/screens.js
// CLAUDE_TEACH_FORM_302; its rows as read live, its frame a reconstruction).
//
// What is held here:
//
//   1. Both commands know the 2.1.302 shape exactly and answer it with Esc
//      alone, as the 2.1.283 form: into the session's tab and no other, with
//      no `--enter`, and never a return, which is Continue and starts the
//      scan. The pointer may sit on any of the form's rows, Continue among
//      them. The frame is the one the kit already requires: a full-width rule
//      right above the title and, below the foot, nothing or the input box.
//   2. The architect's ruling: the new shape is one more exact match, never a
//      looser one. A mix of the 2.1.283 form's rows and the 2.1.302 form's
//      rows is neither shape and is refused, as are the near misses: a value
//      changed, a row more or a row less, a row twice, rows out of order, two
//      pointers or none, and the form quoted in a turn without the frame.
//      Each refusal prints what the screen shows, and nothing is typed.
//   3. After Esc the form must go. If it is still there, the command fails
//      and says so. On success it says which session, that it sent Esc (Not
//      now) to the Teach auto mode screen, and that the screen has gone.
//   4. The kit's typing gate (`questionIn` in src/orca.js) counts the 2.1.302
//      form as a question, so no kit path types a line and a return into it.
//   5. SETUP.md section 5's screen table names 2.1.302 in the row of the form
//      that gets Esc.
//
// Not held here: the 2.1.283 form and the 2.1.289 list themselves
// (temp-answer.test.js, session-answer.test.js); who may run each command;
// the typing turn; and the number of Teach rows in the table, which
// setup-first-run-guidance.test.js holds at two. The system tests' own look
// (`onlyTeachFormOf`) is not extended: no system test needs this form.
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
import { CLAUDE_ANSWERED, CLAUDE_TEACH_FORM, CLAUDE_TEACH_FORM_302 } from './helpers/screens.js';

const BOT = 'temp-bot';
const TASK = 'Read the open pull request and write down what it changes.';

/** Esc, alone: "Not now" on the form. Never a return, which is Continue. */
const ESC = '\x1b';

/** The form's title row, as read. */
const TITLE = 'Teach auto mode about your environment?';

/** The 2.1.302 form's foot, as read, and the 2.1.283 form's, as captured. */
const FOOT_302 = '   ←/→ to change · Enter to continue · Esc to cancel';
const FOOT_283 = '   ←/→ to change usage · Enter to continue · Esc to cancel';

/** Where the fixture's title row and foot row are. */
const TITLE_AT = CLAUDE_TEACH_FORM_302.findIndex((row) => row.trim() === TITLE);
const FOOT_AT = CLAUDE_TEACH_FORM_302.indexOf(FOOT_302);

/** The 2.1.302 form's own rows, from its title to its foot, as read (#604). */
const formRows = CLAUDE_TEACH_FORM_302.slice(TITLE_AT, FOOT_AT + 1);

/** The fixture with `line` put in at row `at`: right above the title (under the rule), or right below the foot. */
const lineAt = (at, line) => [...CLAUDE_TEACH_FORM_302.slice(0, at), line, ...CLAUDE_TEACH_FORM_302.slice(at)];

/** The fixture with each row `change` gives back. */
const changed = (change) => CLAUDE_TEACH_FORM_302.map(change);

/** The fixture with `rows` put in right above its foot row. */
const withAboveFoot = (...rows) => [...CLAUDE_TEACH_FORM_302.slice(0, FOOT_AT), ...rows, ...CLAUDE_TEACH_FORM_302.slice(FOOT_AT)];

/** The fixture with the pointer taken off "Also scan shell history" and put on the row that ends `row`. */
const pointerOn = (row) => changed((one) => {
  if (one === '   ❯ Also scan shell history     false') return '     Also scan shell history     false';
  if (one === `     ${row}`) return `   ❯ ${row}`;
  return one;
});

/** A turn's input box, a draft in it, as the reviewer's probes on PR #490 put it below a quotation. */
const INPUT_WITH_DRAFT = ['─'.repeat(120), '❯ run the pending command', '─'.repeat(120), '  ⏵⏵ auto mode on'];

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

/** How many of the tests below run at once: each brings up a fleet of its own in its own sandbox. */
const AT_ONCE = { concurrency: 8 };

for (const command of COMMANDS) {
  describe(`${command.name} on Claude Code 2.1.302's Teach form`, AT_ONCE, () => {
    // ------------------------------------------------------------ 1. the 2.1.302 form gets Esc

    for (const [label, screen] of [
      ['the form as read, the pointer on "Also scan shell history", above the input box', CLAUDE_TEACH_FORM_302],
      ['the form with its pointer on Continue, the row a return would take', pointerOn('Continue')],
      ['the form with its pointer on "Also scan your other repos"', pointerOn('Also scan your other repos  false')],
      ['the form with a draft in the input box below its foot, which does not count', changed((row) => (row === '❯' ? '❯ fix the flaky test' : row))],
      ['the form\'s own rows alone under a rule of ▔, as 2.1.283 drew its form, nothing below', ['▔'.repeat(120), ...formRows]],
    ]) {
      test(`F302-1 ${label}: Esc alone, into the session's tab alone`, async (t) => {
        const box = await createSandbox(t);
        const ours = await fleet(box);
        await showIn(box, ours.bots, command.target, { screen, screenAfterSend: CLAUDE_ANSWERED });
        const before = await sendsByTab(box);

        await assertEscInto(box, await command.run(box, ours), before, command.tabOf(ours), label);
      });
    }

    // ------------------------------------------------------------ 2. one more exact match, never a looser one

    // Each screen that is neither the 2.1.283 form nor the 2.1.302 form, with
    // a row of it the refusal has to print: what the screen shows.
    for (const [label, screen, row] of [
      ['a mix: the 2.1.302 form with the 2.1.283 row "Also scan shell history     true"', changed((one) => (one === '   ❯ Also scan shell history     false' ? '   ❯ Also scan shell history     true' : one)), /Also scan shell history\s+true/],
      ['a mix: the 2.1.302 rows with the 2.1.283 foot "←/→ to change usage"', changed((one) => (one === FOOT_302 ? FOOT_283 : one)), /to change usage/],
      ['a mix: the captured 2.1.283 form with the 2.1.302 foot', CLAUDE_TEACH_FORM.map((one) => (one === FOOT_283 ? FOOT_302 : one)), /Also scan shell history\s+true/],
      ['the form with a value changed, "Also scan your other repos" on true', changed((one) => (one === '     Also scan your other repos  false' ? '     Also scan your other repos  true' : one)), /Also scan your other repos\s+true/],
      ['the form with "How you use Claude here" on another value', changed((one) => (one === '     How you use Claude here     Mixed' ? '     How you use Claude here     Work' : one)), /How you use Claude here\s+Work/],
      ['the form with a row more', withAboveFoot('     Also scan your home folder  false'), /Also scan your home folder/],
      ['the form with a row less, no "Also scan your other repos"', CLAUDE_TEACH_FORM_302.filter((one) => one !== '     Also scan your other repos  false'), /Teach auto mode about your environment\?/],
      ['the form with a row less, no second row of its description', CLAUDE_TEACH_FORM_302.filter((one) => !one.startsWith('   repositories.')), /Teach auto mode about your environment\?/],
      ['the form with one of its rows shown twice', withAboveFoot('     Continue'), /Teach auto mode about your environment\?/],
      ['the form with its two scan rows swapped', changed((one) => {
        if (one === '   ❯ Also scan shell history     false') return '     Also scan your other repos  false';
        if (one === '     Also scan your other repos  false') return '   ❯ Also scan shell history     false';
        return one;
      }), /Also scan your other repos[\s\S]*Also scan shell history/],
      ['the form with two pointers', changed((one) => (one === '     Continue' ? '   ❯ Continue' : one)), /❯ Continue/],
      ['the form with no pointer', changed((one) => (one === '   ❯ Also scan shell history     false' ? '     Also scan shell history     false' : one)), /Also scan shell history\s+false/],
      ['the whole form quoted in a turn, a line of the turn below it, then the input box with a draft', ['❯ What was the form?', '⏺ The form Claude Code 2.1.302 showed was:', ...formRows, '  This is a quotation from the previous run.', ...INPUT_WITH_DRAFT], /This is a quotation from the previous run/],
      ['the form with a line of a turn right above its title, under the rule', lineAt(TITLE_AT, '⏺ The form Claude Code 2.1.302 showed was:'), /The form Claude Code 2\.1\.302 showed was:/],
      ['the form with a line of a turn right below its foot, above the input box', lineAt(FOOT_AT + 1, '  This is a quotation from the previous run.'), /This is a quotation from the previous run/],
    ]) {
      test(`F302-2 ${label} is refused, says what the screen shows, and nothing is typed`, async (t) => {
        const box = await createSandbox(t);
        const ours = await fleet(box);
        await showIn(box, ours.bots, command.target, { screen, screenAfterSend: CLAUDE_ANSWERED });
        const before = await sendsByTab(box);

        const said = await assertRefusedUntyped(box, await command.run(box, ours), before, label);
        assert.match(said, row, `it prints what the screen shows, this row among it: ${said}`);
      });
    }

    // ------------------------------------------------------------ 3. the form gone, and what it says

    test('F302-3 a 2.1.302 form still on screen a few seconds after Esc is a failure, and it says so', async (t) => {
      // The key went in and Claude Code did not move on: every read after it
      // still shows the form.
      const box = await createSandbox(t);
      const ours = await fleet(box);
      await showIn(box, ours.bots, command.target, { screen: CLAUDE_TEACH_FORM_302 });
      const before = await sendsByTab(box);

      const result = await command.run(box, ours);

      const said = `${result.stdout}${result.stderr}`;
      assert.notEqual(result.code, 0, `the form did not go, so it did not work:\n${said}`);
      assert.ok(!/^\s+at /m.test(said), `a message, not a crash:\n${said}`);
      assert.equal(keysSent(await sentSince(box, before), command.tabOf(ours)), ESC, 'Esc was sent, and nothing more');
      assert.match(said, /still/i, `it says the form is still there: ${said}`);
      assert.ok(said.includes(TITLE), `naming it: ${said}`);
    });

    test('F302-3 on success it says which session, that it sent Esc (Not now) to the Teach auto mode screen, and that the screen has gone', async (t) => {
      const box = await createSandbox(t);
      const ours = await fleet(box);
      await showIn(box, ours.bots, command.target, { screen: CLAUDE_TEACH_FORM_302, screenAfterSend: CLAUDE_ANSWERED });

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

// ------------------------------------------------------------ 4. the typing gate

test('F302-4 questionIn: the 2.1.302 form is a question, above the input box or under a rule of ▔; quoted in a turn it is not', () => {
  // A line typed with a return into this form is Continue, which starts the
  // scan, so the kit's gate has to see it. The quotation beside it, with the
  // input line back below, is history: a gate that took it for a question
  // would swallow every key.
  assert.equal(questionIn(CLAUDE_TEACH_FORM_302), true, 'the form above the input box, the pointer on "Also scan shell history"');
  assert.equal(questionIn(pointerOn('Continue')), true, 'the form above the input box, the pointer on Continue');
  assert.equal(questionIn(['▔'.repeat(120), ...formRows]), true, 'the form\'s own rows under a rule of ▔, nothing below');
  assert.equal(
    questionIn(['❯ What was the form?', '⏺ The form Claude Code 2.1.302 showed was:', ...formRows, '  This is a quotation from the previous run.', ...INPUT_WITH_DRAFT.map((row) => (row.startsWith('❯') ? '❯' : row))]),
    false,
    'the form quoted in a turn, a line of the turn after it, the empty input box below',
  );
});

// ------------------------------------------------------------ 5. SETUP.md

test('F302-5 SETUP.md section 5\'s screen table names 2.1.302 in the Teach auto mode row whose answer is Esc', async () => {
  // The rows are found as setup-first-run-guidance.test.js finds them: a
  // Claude Code row that names `Teach auto mode`. The row of the form is the
  // one that says the kit sends Esc. The table keeps its two Teach rows; this
  // test does not ask for a third.
  const setup = await readFile(path.join(repoRoot, 'SETUP.md'), 'utf8');
  const lines = setup.split('\n');
  const start = lines.findIndex((line) => line.startsWith('## 5.'));
  assert.notEqual(start, -1, 'SETUP.md has a section 5');
  let end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  if (end === -1) end = lines.length;
  const rows = lines.slice(start + 1, end).filter((line) => line.trim().startsWith('|'));
  const teach = rows.filter((line) => /Claude Code/.test(line.split('|')[1] ?? '') && /Teach auto mode/.test(line.split('|')[1] ?? ''));
  const esc = teach.filter((line) => /\bEsc\b/.test(line.split('|')[3] ?? ''));
  assert.equal(esc.length, 1, `one Teach auto mode row of the table says the kit sends Esc, found ${esc.length}:\n${teach.join('\n')}`);
  assert.match(esc[0], /2\.1\.302/, `the row of the form that gets Esc names 2.1.302: ${esc[0]}`);
});
