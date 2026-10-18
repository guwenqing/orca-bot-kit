// Claude Code's "Teach auto mode about your environment?" form with values
// the kit has not seen before, as `obk temp answer` and `obk session answer`
// answer it (#646). Kit 0.28.0 refused the form Claude Code 2.1.302 showed:
// the 2.1.302 form (helpers/screens.js CLAUDE_TEACH_FORM_302) with "Also scan
// shell history" on `true`, not `false`. The screen stopped the session until
// a person answered it.
//
// What is held here:
//
//   1. Both commands cancel the form with Esc alone, whatever values its
//      three settings rows show: "How you use Claude here", "Also scan shell
//      history" and "Also scan your other repos". A value is the text after
//      the row name and the spaces that follow it. No one fixed list of
//      values is needed: `true` or `false` on each scan row, and a word other
//      than `Mixed` on the first row, are all the form. Each of the two known
//      feet, 2.1.283's `←/→ to change usage · …` and 2.1.302's
//      `←/→ to change · …`, may come with any values. The Esc goes into the
//      session's tab and no other, with no `--enter`, and never a return,
//      which is Continue and starts the scan.
//   2. Only the values are free. The title, the description rows, the row
//      names, their order and the foot still match exactly, and the frame is
//      still the one the kit requires. So with values changed, these are
//      still refused: a row more or a row less, a row twice, rows out of
//      order, a changed row name, a value on the Continue row, a changed
//      title, description row or foot, two pointers or none, and the form in
//      the wrong frame (quoted in a turn). Each refusal prints what the
//      screen shows, and nothing is typed.
//   3. After Esc the form must go. If it is still there, with the same
//      values or with others, the command fails and says so.
//   4. SETUP.md section 5's screen table says, in the row of the form that
//      gets Esc, that the values can differ.
//
// Not held here: a settings row with no value at all (the issue gives no
// ruling on it, so no test asks for either answer); the forms as captured
// (teach-form-302.test.js, temp-answer.test.js, session-answer.test.js); the
// 2.1.289 list; the typing gate (`questionIn`); and the system tests' own look
// (`onlyTeachFormOf`, teach-form.test.js), which this issue does not change.
//
// Every run is in the sandbox (helpers/cli.js): the fake Orca shows each tab
// the screen a test gives it, and moves it on at the next key when told to
// (`screenAfterSend`).

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it as test } from 'node:test';

import { createSandbox, kitLaunchMark, repoRoot, sentInto, sessionIn } from './helpers/cli.js';
import { CLAUDE_ANSWERED, CLAUDE_TEACH_FORM, CLAUDE_TEACH_FORM_302 } from './helpers/screens.js';

const BOT = 'temp-bot';
const TASK = 'Read the open pull request and write down what it changes.';

/** Esc, alone: "Not now" on the form. Never a return, which is Continue. */
const ESC = '\x1b';

/** The form's title row, as read. */
const TITLE = 'Teach auto mode about your environment?';

/** The two known feet: 2.1.302's, as read (#604), and 2.1.283's, as captured. */
const FOOT_302 = '   ←/→ to change · Enter to continue · Esc to cancel';
const FOOT_283 = '   ←/→ to change usage · Enter to continue · Esc to cancel';

/**
 * `base` with each row that is a key of `swaps` given its value instead. Each
 * key must be a row of `base`, so a change to a fixture cannot make a case
 * the same as the fixture without anyone seeing it.
 */
function swapped(base, swaps) {
  for (const row of Object.keys(swaps)) assert.ok(base.includes(row), `the fixture has the row ${JSON.stringify(row)}`);
  return base.map((row) => (Object.hasOwn(swaps, row) ? swaps[row] : row));
}

/** The 2.1.302 fixture's rows, as they are there. */
const HOW_302 = '     How you use Claude here     Mixed';
const SHELL_302 = '   ❯ Also scan shell history     false';
const REPOS_302 = '     Also scan your other repos  false';
const CONTINUE = '     Continue';

/** The captured 2.1.283 form's rows, as they are there. */
const HOW_283 = '     How you use Claude here     Mixed';
const SHELL_283 = '   ❯ Also scan shell history     true';
const REPOS_283 = '     Also scan your other repos  false';

/**
 * The screen of issue #646: the 2.1.302 fixture with "Also scan shell
 * history" on `true`. Its rows from the title to the foot are the issue's,
 * word for word; the frame is the fixture's reconstruction.
 */
const ISSUE = swapped(CLAUDE_TEACH_FORM_302, { [SHELL_302]: '   ❯ Also scan shell history     true' });

/** Where the issue screen's title row and foot row are. */
const TITLE_AT = ISSUE.findIndex((row) => row.trim() === TITLE);
const FOOT_AT = ISSUE.indexOf(FOOT_302);

/** The issue screen's own rows, from its title to its foot. */
const issueRows = ISSUE.slice(TITLE_AT, FOOT_AT + 1);

/** `screen` with `rows` put in right above its foot row, whichever foot it has. */
function withAboveFoot(screen, ...rows) {
  const at = screen.findIndex((row) => row === FOOT_302 || row === FOOT_283);
  assert.notEqual(at, -1, 'the screen has a known foot');
  return [...screen.slice(0, at), ...rows, ...screen.slice(at)];
}

/** `screen` with `line` put in at row `at`. */
const lineAt = (screen, at, line) => [...screen.slice(0, at), line, ...screen.slice(at)];

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
  describe(`${command.name} on Claude Code's Teach form with other values`, AT_ONCE, () => {
    // ------------------------------------------------------------ 1. any values get Esc

    for (const [label, screen] of [
      // The 2.1.302 rows and frame, values changed.
      ['the screen of issue #646: the 2.1.302 form with "Also scan shell history" on true', ISSUE],
      ['the 2.1.302 form with "Also scan your other repos" on true', swapped(CLAUDE_TEACH_FORM_302, { [REPOS_302]: '     Also scan your other repos  true' })],
      ['the 2.1.302 form with both scan rows on true', swapped(ISSUE, { [REPOS_302]: '     Also scan your other repos  true' })],
      ['the 2.1.302 form with "How you use Claude here" on Work', swapped(CLAUDE_TEACH_FORM_302, { [HOW_302]: '     How you use Claude here     Work' })],
      ['the 2.1.302 form with "How you use Claude here" on Personal, both scan rows on true, the pointer on Continue', swapped(CLAUDE_TEACH_FORM_302, {
        [HOW_302]: '     How you use Claude here     Personal',
        [SHELL_302]: '     Also scan shell history     true',
        [REPOS_302]: '     Also scan your other repos  true',
        [CONTINUE]: '   ❯ Continue',
      })],
      ['the issue\'s form with its pointer on "Also scan your other repos", which is on true', swapped(ISSUE, {
        '   ❯ Also scan shell history     true': '     Also scan shell history     true',
        [REPOS_302]: '   ❯ Also scan your other repos  true',
      })],
      ['the issue\'s form with a draft in the input box below its foot, which does not count', swapped(ISSUE, { '❯': '❯ fix the flaky test' })],
      // The 2.1.283 foot with other values than the captured form's.
      ['the 2.1.302 rows with the 2.1.283 foot: the 2.1.283 form with "Also scan shell history" on false', swapped(CLAUDE_TEACH_FORM_302, { [FOOT_302]: FOOT_283 })],
      ['the 2.1.302 rows with the 2.1.283 foot, "How you use Claude here" on Work and "Also scan your other repos" on true', swapped(CLAUDE_TEACH_FORM_302, {
        [FOOT_302]: FOOT_283,
        [HOW_302]: '     How you use Claude here     Work',
        [REPOS_302]: '     Also scan your other repos  true',
      })],
      // The captured 2.1.283 form, under its rule of ▔ with nothing below, values or foot changed.
      ['the captured 2.1.283 form with the 2.1.302 foot: the 2.1.302 form with "Also scan shell history" on true', swapped(CLAUDE_TEACH_FORM, { [FOOT_283]: FOOT_302 })],
      ['the captured 2.1.283 form with "Also scan shell history" on false', swapped(CLAUDE_TEACH_FORM, { [SHELL_283]: '   ❯ Also scan shell history     false' })],
      ['the captured 2.1.283 form with every value changed: Work, false, true', swapped(CLAUDE_TEACH_FORM, {
        [HOW_283]: '     How you use Claude here     Work',
        [SHELL_283]: '   ❯ Also scan shell history     false',
        [REPOS_283]: '     Also scan your other repos  true',
      })],
    ]) {
      test(`FV-1 ${label}: Esc alone, into the session's tab alone`, async (t) => {
        const box = await createSandbox(t);
        const ours = await fleet(box);
        await showIn(box, ours.bots, command.target, { screen, screenAfterSend: CLAUDE_ANSWERED });
        const before = await sendsByTab(box);

        await assertEscInto(box, await command.run(box, ours), before, command.tabOf(ours), label);
      });
    }

    // ------------------------------------------------------------ 2. only the values are free

    // Each screen that is not the form, its values changed too, so that a
    // match loosened past the values lets it through. With a row of it the
    // refusal has to print: what the screen shows.
    for (const [label, screen, row] of [
      ['the issue\'s form with a row more', withAboveFoot(ISSUE, '     Also scan your home folder  true'), /Also scan your home folder/],
      ['the issue\'s form with a row less, no "Also scan your other repos"', ISSUE.filter((one) => one !== REPOS_302), /Also scan shell history\s+true/],
      ['the issue\'s form with a row less, no "How you use Claude here"', ISSUE.filter((one) => one !== HOW_302), /Also scan shell history\s+true/],
      ['the issue\'s form with "Also scan shell history" twice, once on true and once on false', lineAt(ISSUE, ISSUE.indexOf(REPOS_302), '     Also scan shell history     false'), /Also scan shell history\s+true[\s\S]*Also scan shell history\s+false/],
      ['the issue\'s form with Continue twice', withAboveFoot(ISSUE, CONTINUE), /Also scan shell history\s+true/],
      ['the issue\'s form with its two scan rows swapped', swapped(ISSUE, {
        '   ❯ Also scan shell history     true': '     Also scan your other repos  false',
        [REPOS_302]: '   ❯ Also scan shell history     true',
      }), /Also scan your other repos[\s\S]*Also scan shell history\s+true/],
      ['the issue\'s form with "How you use Claude here" below the scan rows', swapped(ISSUE, {
        [HOW_302]: '   ❯ Also scan shell history     true',
        '   ❯ Also scan shell history     true': REPOS_302,
        [REPOS_302]: HOW_302,
      }), /Also scan your other repos[\s\S]*How you use Claude here/],
      ['the issue\'s form with a row name changed, "Also scan shell logs"', swapped(ISSUE, { '   ❯ Also scan shell history     true': '   ❯ Also scan shell logs        true' }), /Also scan shell logs/],
      ['the issue\'s form with a row name changed, "How you use Claude there"', swapped(ISSUE, { [HOW_302]: '     How you use Claude there    Mixed' }), /How you use Claude there/],
      ['the issue\'s form with a value on its Continue row, which is no setting', swapped(ISSUE, { [CONTINUE]: '     Continue                    true' }), /Continue\s+true/],
      ['the issue\'s form with its title changed', swapped(ISSUE, { [`   ${TITLE}`]: '   Teach auto mode about your projects?' }), /Teach auto mode about your projects\?/],
      ['the issue\'s form with a row of its description changed', ISSUE.map((one) => (one.includes('and optionally your shell history') ? one.replace('and optionally', 'and always') : one)), /and always your shell history/],
      ['the issue\'s form with a third foot, "←/→ to change values"', swapped(ISSUE, { [FOOT_302]: '   ←/→ to change values · Enter to continue · Esc to cancel' }), /to change values/],
      ['the issue\'s form with two pointers', swapped(ISSUE, { [CONTINUE]: '   ❯ Continue' }), /❯ Continue/],
      ['the issue\'s form with no pointer', swapped(ISSUE, { '   ❯ Also scan shell history     true': '     Also scan shell history     true' }), /Also scan shell history\s+true/],
      ['the captured 2.1.283 form with the 2.1.302 foot and a row less, no "How you use Claude here"', swapped(CLAUDE_TEACH_FORM, { [FOOT_283]: FOOT_302 }).filter((one) => one !== HOW_283), /Also scan shell history\s+true/],
      ['the issue\'s whole form quoted in a turn, a line of the turn below it, then the input box with a draft', ['❯ What was the form?', '⏺ The form Claude Code 2.1.302 showed was:', ...issueRows, '  This is a quotation from the previous run.', ...INPUT_WITH_DRAFT], /This is a quotation from the previous run/],
      ['the issue\'s form with a line of a turn right above its title, under the rule', lineAt(ISSUE, TITLE_AT, '⏺ The form Claude Code 2.1.302 showed was:'), /The form Claude Code 2\.1\.302 showed was:/],
      ['the issue\'s form with a line of a turn right below its foot, above the input box', lineAt(ISSUE, FOOT_AT + 1, '  This is a quotation from the previous run.'), /This is a quotation from the previous run/],
    ]) {
      test(`FV-2 ${label} is refused, says what the screen shows, and nothing is typed`, async (t) => {
        const box = await createSandbox(t);
        const ours = await fleet(box);
        await showIn(box, ours.bots, command.target, { screen, screenAfterSend: CLAUDE_ANSWERED });
        const before = await sendsByTab(box);

        const said = await assertRefusedUntyped(box, await command.run(box, ours), before, label);
        assert.match(said, row, `it prints what the screen shows, this row among it: ${said}`);
      });
    }

    // ------------------------------------------------------------ 3. the form must go

    for (const [label, after] of [
      ['the issue\'s form still on screen a few seconds after Esc', undefined],
      ['the issue\'s form still on screen after Esc, its "Also scan shell history" back on false', CLAUDE_TEACH_FORM_302],
    ]) {
      test(`FV-3 ${label} is a failure, and it says so`, async (t) => {
        // The key went in and Claude Code did not move on: every read after it
        // still shows the form, with the same values or with others.
        const box = await createSandbox(t);
        const ours = await fleet(box);
        await showIn(box, ours.bots, command.target, after === undefined ? { screen: ISSUE } : { screen: ISSUE, screenAfterSend: after });
        const before = await sendsByTab(box);

        const result = await command.run(box, ours);

        const said = `${result.stdout}${result.stderr}`;
        assert.notEqual(result.code, 0, `the form did not go, so it did not work:\n${said}`);
        assert.ok(!/^\s+at /m.test(said), `a message, not a crash:\n${said}`);
        assert.equal(keysSent(await sentSince(box, before), command.tabOf(ours)), ESC, 'Esc was sent, and nothing more');
        assert.match(said, /still/i, `it says the form is still there: ${said}`);
        assert.ok(said.includes(TITLE), `naming it: ${said}`);
      });
    }
  });
}

// ------------------------------------------------------------ 4. SETUP.md

test('FV-4 SETUP.md section 5\'s screen table says, in the Teach auto mode row whose answer is Esc, that the values can differ', async () => {
  // The rows are found as teach-form-302.test.js F302-5 finds them: a Claude
  // Code row that names `Teach auto mode`, and of those the one that says the
  // kit sends Esc. In that row, a sentence names the values and says they can
  // differ, vary or be any.
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
  assert.match(
    esc[0],
    /\bvalues?\b[^.|]*\b(?:differ|differs|vary|varies|any)\b|\b(?:any|other|whatever)\b[^.|]*\bvalues?\b/i,
    `the row of the form that gets Esc says the values can differ: ${esc[0]}`,
  );
});
