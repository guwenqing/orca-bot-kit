// `obk temp answer --bots <path> --name <session>`: a maker answers a first-run
// screen of a temporary session it made (#489). Claude Code's auto mode refuses
// a maker's raw `orca terminal send`, so a new Claude session sat on "Teach auto
// mode about your environment?" until a person answered it. As with `obk temp
// trust-hooks` (#238), the kit has one command for the answer, which one narrow
// permission rule can allow. For now it answers that one form, with Esc ("Not
// now", which teaches nothing), and never with a return: Enter on the form is
// Continue, which starts a scan (#416).
//
// What is held here, by the numbers of the requirement in the brief:
//
//   1. It is run by the session's maker in the maker's own tab, found as
//      `temp trust-hooks` and `temp retire` find it. It refuses a call from
//      outside a fleet tab, a name the bot has no session of, a long-lived
//      session, and a temporary session another session made. Both --bots and
//      --name are required.
//   2. It refuses when the session has no tab open in Orca, or its screen
//      cannot be read.
//   3. It sends Esc only when the screen holds the Teach form matched exactly
//      against the captured CLAUDE_TEACH_FORM, by `onlyTeachFormOf`'s rule
//      (helpers/screens.js): every non-blank row from the title down is one of
//      the captured form's rows, the pointer ❯ on exactly one of them,
//      whichever; nothing missing, nothing added. Anything else is refused: no
//      key into any tab, and it prints what the screen shows. For Codex's hooks
//      review, the refusal points to `temp trust-hooks`.
//   4. The typing turn: typing-turn-temp-answer.test.js.
//   5. After the key it reads the screen again; if the form's title row is
//      still there after a few seconds, it fails and says so.
//   6. On success it says which session, that it sent Esc (Not now) to the
//      Teach auto mode form, and that the form has gone. `--json` has at least
//      bot, session and maker.
//   7. Its output and SETUP.md section 5 name the one rule a maker's bot needs.
//      Since #527 it is the default set's `Bash(<kit> temp answer --bots
//      <folder>:*)`, <kit> the running kit's CLI path and <folder> the bots
//      folder, each as `shellWord` spells it (`kitRule`, helpers/permissions.js).
//   8. `obk --help` lists `obk temp answer --bots <path> --name <session>`.
//
// And Claude Code 2.1.289's Teach list (the architect's ruling on #489's live
// run, its letters here): two known forms, the 2.1.283 form and the 2.1.289
// list (A); the match runs from the title to the foot row, `Enter to … · Esc
// to cancel`, and the rows below the foot do not count (B); the 2.1.283 form
// still gets Esc alone (C); the list gets "2. Not now", by arrows from
// wherever the pointer is, then a look that finds the pointer on 2 and the
// list otherwise as it was, and only then a return alone; never a digit,
// never --enter, never Esc, never 1 or 3 (D); and the title must go after
// (E). Tests TB, TD and TE.
//
// And the ruling on the review of PR #490: the rows between title and foot in
// the known order (H); a form or list counts only framed as Claude Code draws
// it, a rule of `─` or `▔` right above the title and, below the foot, nothing
// or the input box's rule starting with `─`, so one quoted in a turn is
// refused (I); the second look before the return on the list even when the
// pointer starts on "2. Not now" (J); and the guard after the arrows finds the
// first look's rows in the same order, only the pointer moved (K). Tests TH,
// TI, TJ, and cases added to TD.
//
// Every run is in the sandbox (helpers/cli.js): the fake Orca shows each tab
// the screen a test gives it, and moves it on at the next key when told to
// (`screenAfterSend`, `nextScreens`).

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it as test } from 'node:test';

import {
  createSandbox,
  kitLaunchMark,
  orcaCommand,
  orcaFlag,
  repoRoot,
  sentInto,
  sessionIn,
} from './helpers/cli.js';
import { kitRule } from './helpers/permissions.js';
import {
  CLAUDE_ANSWERED,
  CLAUDE_IDLE,
  CLAUDE_TEACH_AUTO,
  CLAUDE_TEACH_FORM,
  CLAUDE_TEACH_FORM_ON_CONTINUE,
  CLAUDE_TEACH_LIST,
  CLAUDE_TEACH_LIST_ON_NOT_NOW,
  CLAUDE_TEACH_LIST_ON_THREE,
  CLAUDE_TRUST,
  CODEX_HOOKS_REVIEW,
  FORM_IN_HISTORY,
} from './helpers/screens.js';

const BOT = 'temp-bot';
const TASK = 'Read the open pull request and write down what it changes.';

/** Esc, alone: "Not now" on the Teach form. Never a return, which is Continue. */
const ESC = '\x1b';

/** The form's title row, as captured. */
const TITLE = 'Teach auto mode about your environment?';

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
 * A bots folder with temp-bot on Claude Code, its long-lived sessions planner
 * and nightly brought up, and two temporary sessions planner made: drafter on
 * Claude Code and scout on Codex.
 */
async function fleet(box) {
  const ok = async (args, env) => {
    const result = await box.run(args, env === undefined ? {} : { env });
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  };
  await ok(['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  for (const name of ['planner', 'nightly']) await ok(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', name]);
  await ok(['up', '--bots', 'bots', '--bot', BOT]);
  const bots = box.path('bots');
  const planner = await tabOf(box, bots, 'planner');
  await ok(['temp', 'make', '--bots', 'bots', '--name', 'drafter', '--prompt', TASK], inTab(box, planner));
  await ok(['temp', 'make', '--bots', 'bots', '--name', 'scout', '--harness', 'codex', '--prompt', TASK], inTab(box, planner));
  return { bots, planner, nightly: await tabOf(box, bots, 'nightly') };
}

/** Give one session's tab a screen of its own, and what it moves on to at the next key, if anything. */
async function showIn(box, bots, name, shown) {
  const tab = (await sessionIn(bots, BOT, name)).tab;
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((terminal) => (terminal.tabId === tab ? { ...terminal, ...shown } : terminal)),
  });
}

/** The captured form, which goes at the next key, as Claude Code's does on Esc. */
const FORM_THAT_GOES = { screen: CLAUDE_TEACH_FORM, screenAfterSend: CLAUDE_ANSWERED };

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

/** `obk temp answer --bots bots --name <name>`, run in `terminal`, or outside any tab when it is null. */
const answer = (box, terminal, name, extra = []) => box.run(
  ['temp', 'answer', '--bots', 'bots', '--name', name, ...extra],
  terminal === null ? {} : { env: inTab(box, terminal) },
);

/** A refusal: a non-zero exit, something said, no crash, and nothing typed into any tab. */
async function assertRefusedUntyped(box, result, before, what) {
  const said = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.code, 0, `${what} should be refused, got:\n${said}`);
  assert.notEqual(said.trim(), '', `${what}: a refusal says why`);
  assert.ok(!/^\s+at /m.test(said), `${what}: a message, not a crash:\n${said}`);
  assert.deepEqual(await sentSince(box, before), {}, `${what}: nothing is typed into any tab`);
  return said;
}

/**
 * The keys the command sent into one tab, all together, and each send made
 * with no `--enter`: a return of any kind would be Continue.
 */
function keysSent(sent, tab) {
  const sends = sent[tab] ?? [];
  assert.ok(sends.length > 0, `keys should have been sent into the session's tab, got: ${JSON.stringify(sent)}`);
  assert.ok(sends.every((one) => one.enter === false), `with no --enter: ${JSON.stringify(sends)}`);
  return sends.map((one) => one.text).join('');
}

/** The answer went: exit 0, and Esc alone into drafter's tab and no other. */
async function assertEscInto(box, result, before, tab, what) {
  assert.equal(result.code, 0, `${what}: it answers the form:\n${result.stdout}${result.stderr}`);
  const sent = await sentSince(box, before);
  assert.deepEqual(Object.keys(sent), [tab], `${what}: keys go into the session's tab and no other: ${JSON.stringify(sent)}`);
  assert.equal(keysSent(sent, tab), ESC, `${what}: Esc alone, never a return`);
}

/** The captured form with each row `change` gives back. */
const changed = (change) => CLAUDE_TEACH_FORM.map(change);

/** The form's own rows, from its title down, as captured. */
const formRows = CLAUDE_TEACH_FORM.slice(CLAUDE_TEACH_FORM.findIndex((row) => row.trim() === TITLE));

// Claude Code 2.1.289's Teach list (#489, the architect's ruling on the
// 2.1.289 list): answered with "2. Not now", by arrows from wherever the
// pointer is, then a look at the screen that finds the pointer on "2. Not now"
// and the list otherwise as it was, and only then a return alone. Never a
// digit, never --enter, never Esc, and never a return on 1 or 3.

/** The arrow keys and the return the list's answer is made of. */
const DOWN = '\x1b[B';
const UP = '\x1b[A';
const RETURN = '\r';

/** The captured list with each row `change` gives back. */
const listChanged = (rows, change) => rows.map(change);

/** The captured list with `rows` put in right above its foot row. */
const listWithAboveFoot = (...rows) => {
  const foot = CLAUDE_TEACH_LIST.findIndex((row) => row.includes('Enter to confirm · Esc to cancel'));
  return [...CLAUDE_TEACH_LIST.slice(0, foot), ...rows, ...CLAUDE_TEACH_LIST.slice(foot)];
};

/** A draft in the input box below the list's foot, where the bare `❯` was. */
const withDraft = (rows) => rows.map((row) => (row === '❯' ? '❯ fix the flaky test' : row));

/** The texts sent into one tab, in order, each send made with no `--enter`. */
function textsSent(sent, tab) {
  const sends = sent[tab] ?? [];
  assert.ok(sends.every((one) => one.enter === false), `with no --enter: ${JSON.stringify(sends)}`);
  return sends.map((one) => one.text);
}

/** The kit's reads of one tab's screen and its sends into it, from Orca's call `from` on, in the order Orca got them. */
async function readsAndSendsOf(box, tab, from) {
  const handle = (await box.orca.terminals()).find((terminal) => terminal.tabId === tab).handle;
  return (await box.orca.calls()).slice(from)
    .filter((call) => orcaFlag(call, '--terminal') === handle)
    .map((call) => ({ command: orcaCommand(call), text: orcaFlag(call, '--text') }))
    .filter((call) => call.command === 'terminal read' || call.command === 'terminal send');
}

/**
 * The list answered: exit 0, keys into drafter's tab and no other, the arrows
 * `arrows` first and then a return alone as the last send, and a read of the
 * screen between the last arrow and the return, which is the guard's look.
 * With no arrows, the second look is still there (J): two reads before the
 * return. `from` is how many calls Orca had before the command ran.
 */
async function assertNotNowInto(box, result, before, tab, arrows, what, from) {
  assert.equal(result.code, 0, `${what}: it answers the list:\n${result.stdout}${result.stderr}`);
  const sent = await sentSince(box, before);
  assert.deepEqual(Object.keys(sent), [tab], `${what}: keys go into the session's tab and no other: ${JSON.stringify(sent)}`);
  const texts = textsSent(sent, tab);
  assert.equal(texts.at(-1), RETURN, `${what}: the last send is a return alone: ${JSON.stringify(texts)}`);
  assert.equal(texts.join(''), `${arrows}${RETURN}`, `${what}: the arrows to "2. Not now", then the return, and nothing else: ${JSON.stringify(texts)}`);
  const calls = await readsAndSendsOf(box, tab, from);
  const back = calls.findLastIndex((call) => call.command === 'terminal send' && call.text === RETURN);
  const lastArrow = calls.findLastIndex((call, at) => at < back && call.command === 'terminal send');
  const looks = calls.slice(lastArrow + 1, back).filter((call) => call.command === 'terminal read').length;
  assert.ok(
    looks >= (arrows === '' ? 2 : 1),
    arrows === ''
      ? `${what}: the screen is read twice before the return, the first look and the second: ${JSON.stringify(calls)}`
      : `${what}: the screen is read again after the arrows and before the return: ${JSON.stringify(calls)}`,
  );
}

/** The captured list's own rows, from its title to its foot. */
const listBlockOf = (rows) => rows.slice(
  rows.findIndex((row) => row.trim() === TITLE),
  rows.findIndex((row) => row.includes('Enter to confirm · Esc to cancel')) + 1,
);

/** A turn's input box, a draft in it, as the reviewer's probes put it below a quotation. */
const INPUT_WITH_DRAFT = ['─'.repeat(120), '❯ run the pending command', '─'.repeat(120), '  ⏵⏵ auto mode on'];

/** `rows` with the rows of 1 and 3 swapped, the pointer staying with its row. */
const oneAndThreeSwapped = (rows) => {
  const one = rows.findIndex((row) => /1\. Yes$/.test(row));
  const three = rows.findIndex((row) => /3\. Don't show again$/.test(row));
  return rows.map((row, at) => (at === one ? rows[three] : at === three ? rows[one] : row));
};

/** `rows` with `line` put in right above the title, or right below the foot. */
const lineAboveTitle = (rows, line) => {
  const at = rows.findIndex((row) => row.trim() === TITLE);
  return [...rows.slice(0, at), line, ...rows.slice(at)];
};
const lineBelowFoot = (rows, line) => {
  const at = rows.findIndex((row) => / · Esc to cancel$/.test(row));
  return [...rows.slice(0, at + 1), line, ...rows.slice(at + 1)];
};

/** How many of the tests below run at once: each brings up a fleet of its own in its own sandbox. */
const AT_ONCE = { concurrency: 8 };

describe('obk temp answer', AT_ONCE, () => {
  // ------------------------------------------------------------ 1. who may ask

  test('TA1 a name the bot has no session of is refused, names it, and nothing is typed', async (t) => {
    const box = await createSandbox(t);
    const { planner } = await fleet(box);
    const before = await sendsByTab(box);

    const said = await assertRefusedUntyped(box, await answer(box, planner, 'nobody'), before, 'a name the bot has no session of');
    assert.ok(said.includes('nobody'), `it names what was asked for: ${said}`);
  });

  test('TA1 a long-lived session is refused, even with the captured form on its screen, and nothing is typed', async (t) => {
    const box = await createSandbox(t);
    const { bots, planner } = await fleet(box);
    await showIn(box, bots, 'nightly', FORM_THAT_GOES);
    const before = await sendsByTab(box);

    const said = await assertRefusedUntyped(box, await answer(box, planner, 'nightly'), before, 'a long-lived session');
    assert.match(said, /long-lived/i, `it says the session is long-lived: ${said}`);
  });

  test('TA1 a temporary session another session made is refused, and nothing is typed; from its maker\'s tab the same ask is answered', async (t) => {
    const box = await createSandbox(t);
    const { bots, planner, nightly } = await fleet(box);
    await showIn(box, bots, 'drafter', FORM_THAT_GOES);
    const drafter = (await sessionIn(bots, BOT, 'drafter')).tab;
    const before = await sendsByTab(box);

    const said = await assertRefusedUntyped(box, await answer(box, nightly, 'drafter'), before, 'a session another session made');
    assert.ok(said.includes('planner'), `it names the maker, whose it is: ${said}`);

    await assertEscInto(box, await answer(box, planner, 'drafter'), before, drafter, 'from its maker\'s tab');
  });

  test('TA1 run outside any tab it is refused, and nothing is typed', async (t) => {
    const box = await createSandbox(t);
    const { bots } = await fleet(box);
    await showIn(box, bots, 'drafter', FORM_THAT_GOES);
    const before = await sendsByTab(box);

    const said = await assertRefusedUntyped(box, await answer(box, null, 'drafter'), before, 'a call from outside any tab');
    assert.match(said, /\btab\b/i, `it says it is run in a session's own tab, as temp retire says: ${said}`);
  });

  for (const [flag, args] of [
    ['--name', ['temp', 'answer', '--bots', 'bots']],
    ['--bots', ['temp', 'answer', '--name', 'drafter']],
  ]) {
    test(`TA1 without ${flag} it is refused, names ${flag}, and nothing is typed`, async (t) => {
      const box = await createSandbox(t);
      const { bots, planner } = await fleet(box);
      await showIn(box, bots, 'drafter', FORM_THAT_GOES);
      const before = await sendsByTab(box);

      const result = await box.run(args, { env: inTab(box, planner) });

      const said = await assertRefusedUntyped(box, result, before, `a call without ${flag}`);
      assert.ok(said.includes(flag), `it names the flag it needs: ${said}`);
    });
  }

  test('TA1 a temporary maker answers the form of a temporary session it made itself', async (t) => {
    // A temporary session may make one of its own (ADR 0033); it is that one's
    // maker, as temp trust-hooks takes it (temp-nested.test.js N4).
    const box = await createSandbox(t);
    const { bots } = await fleet(box);
    const drafter = await tabOf(box, bots, 'drafter');
    const made = await box.run(['temp', 'make', '--bots', 'bots', '--name', 'helper', '--prompt', TASK], { env: inTab(box, drafter) });
    assert.equal(made.code, 0, `drafter makes helper:\n${made.stdout}${made.stderr}`);
    await showIn(box, bots, 'helper', FORM_THAT_GOES);
    const helper = (await sessionIn(bots, BOT, 'helper')).tab;
    const before = await sendsByTab(box);

    await assertEscInto(box, await answer(box, drafter, 'helper'), before, helper, 'drafter answers its helper');
  });

  // ------------------------------------------------------------ 2. a tab and a screen to read

  test('TA2 a session with no tab open in Orca is refused, says so, and nothing is typed', async (t) => {
    const box = await createSandbox(t);
    const { bots, planner } = await fleet(box);
    const drafter = (await sessionIn(bots, BOT, 'drafter')).tab;
    await box.orca.set({ terminals: (await box.orca.terminals()).filter((terminal) => terminal.tabId !== drafter) });
    const before = await sendsByTab(box);

    const said = await assertRefusedUntyped(box, await answer(box, planner, 'drafter'), before, 'a session with no tab');
    assert.match(said, /\btab\b/i, `it says there is no tab: ${said}`);
  });

  for (const [label, change] of [
    ['Orca refuses to read it', { fail: { 'terminal read': { code: 'runtime_error', message: 'the renderer did not answer' } } }],
    ['Orca answers with no rendered screen', null],
  ]) {
    test(`TA2 a session whose screen cannot be read (${label}) is refused, says so, and nothing is typed`, async (t) => {
      const box = await createSandbox(t);
      const { bots, planner } = await fleet(box);
      if (change === null) await showIn(box, bots, 'drafter', { ...FORM_THAT_GOES, screenSource: 'screen-unavailable' });
      else {
        await showIn(box, bots, 'drafter', FORM_THAT_GOES);
        await box.orca.set(change);
      }
      const before = await sendsByTab(box);

      const said = await assertRefusedUntyped(box, await answer(box, planner, 'drafter'), before, label);
      assert.match(said, /could not|cannot|can't|unreadable|not be read/i, `it says the screen could not be read: ${said}`);
    });
  }

  // ------------------------------------------------------------ 3. the captured form, and nothing else

  for (const [label, screen] of [
    ['the captured form, the pointer on "Also scan shell history"', CLAUDE_TEACH_FORM],
    ['the captured form with its pointer on Continue, the row a return would take', CLAUDE_TEACH_FORM_ON_CONTINUE],
    ['the captured form with its pointer on "Also scan your other repos"', changed((row) => {
      if (row.includes('❯ Also scan shell history')) return row.replace('❯', ' ');
      if (row.includes('Also scan your other repos')) return row.replace('  Also', '❯ Also');
      return row;
    })],
    ['the form\'s own rows alone under its rule, other history gone, a blank row below', ['▔'.repeat(120), ...formRows, '']],
  ]) {
    test(`TA3 ${label}: Esc alone, into the session's tab alone`, async (t) => {
      const box = await createSandbox(t);
      const { bots, planner } = await fleet(box);
      await showIn(box, bots, 'drafter', { screen, screenAfterSend: CLAUDE_ANSWERED });
      const drafter = (await sessionIn(bots, BOT, 'drafter')).tab;
      const before = await sendsByTab(box);

      await assertEscInto(box, await answer(box, planner, 'drafter'), before, drafter, label);
    });
  }

  // Each screen that is not the captured form, with a row of it the refusal has
  // to print: what the screen shows.
  for (const [label, screen, row] of [
    ['the form with a row more', [...CLAUDE_TEACH_FORM.slice(0, -1), '     Also scan your home folder  false', CLAUDE_TEACH_FORM.at(-1)], /Also scan your home folder/],
    ['the form with a row less', CLAUDE_TEACH_FORM.filter((one) => !one.includes('Also scan your other repos')), /Teach auto mode about your environment\?/],
    ['the form with a value changed, false to true', changed((one) => (one.includes('Also scan your other repos') ? one.replace('false', 'true') : one)), /Also scan your other repos\s+true/],
    ['the form with one of its rows shown twice', [...CLAUDE_TEACH_FORM.slice(0, -1), '     Continue', CLAUDE_TEACH_FORM.at(-1)], /Teach auto mode about your environment\?/],
    ['the form with two pointers', changed((one) => (one === '     Continue' ? '   ❯ Continue' : one)), /❯ Continue/],
    ['the form with no pointer', changed((one) => one.replace('❯', ' ')), /Also scan shell history\s+true/],
    ['the form quoted in history, the input line below it', FORM_IN_HISTORY, /Enter on it is Continue, which starts the scan\./],
    ['Claude Code idle at its input line', CLAUDE_IDLE, /Try "fix typecheck errors"/],
    ['Claude Code\'s folder trust', CLAUDE_TRUST, /Yes, I trust this folder/],
    ['the older numbered teach list', CLAUDE_TEACH_AUTO, /2\. Not now/],
  ]) {
    test(`TA3 ${label} is refused, says what the screen shows, and nothing is typed`, async (t) => {
      const box = await createSandbox(t);
      const { bots, planner } = await fleet(box);
      await showIn(box, bots, 'drafter', { screen, screenAfterSend: CLAUDE_ANSWERED });
      const before = await sendsByTab(box);

      const said = await assertRefusedUntyped(box, await answer(box, planner, 'drafter'), before, label);
      assert.match(said, row, `it prints what the screen shows, this row among it: ${said}`);
    });
  }

  test('TA3 a Codex session on its hooks review is refused, nothing is typed, and the refusal points to temp trust-hooks', async (t) => {
    const box = await createSandbox(t);
    const { bots, planner } = await fleet(box);
    await showIn(box, bots, 'scout', { screen: CODEX_HOOKS_REVIEW });
    const before = await sendsByTab(box);

    const said = await assertRefusedUntyped(box, await answer(box, planner, 'scout'), before, 'Codex\'s hooks review');
    assert.match(said, /Hooks need review/, `it says what the screen shows: ${said}`);
    assert.match(said, /temp trust-hooks/, `it points to temp trust-hooks: ${said}`);
  });

  // ------------------------------------------------------------ the 2.1.289 list (A, B, D)

  for (const [label, screen, after, arrows] of [
    ['the captured list, the pointer on "1. Yes": down, then return', CLAUDE_TEACH_LIST, [CLAUDE_TEACH_LIST_ON_NOT_NOW, CLAUDE_ANSWERED], DOWN],
    ['the list with its pointer on "3. Don\'t show again": up, then return', CLAUDE_TEACH_LIST_ON_THREE, [CLAUDE_TEACH_LIST_ON_NOT_NOW, CLAUDE_ANSWERED], UP],
    ['the list with its pointer already on "2. Not now": return alone', CLAUDE_TEACH_LIST_ON_NOT_NOW, [CLAUDE_ANSWERED], ''],
    ['the list with a draft in the input box below its foot, which does not count', withDraft(CLAUDE_TEACH_LIST), [withDraft(CLAUDE_TEACH_LIST_ON_NOT_NOW), CLAUDE_ANSWERED], DOWN],
  ]) {
    test(`TD ${label}, into the session's tab alone`, async (t) => {
      const box = await createSandbox(t);
      const { bots, planner } = await fleet(box);
      await showIn(box, bots, 'drafter', { screen, nextScreens: after });
      const drafter = (await sessionIn(bots, BOT, 'drafter')).tab;
      const before = await sendsByTab(box);
      const from = (await box.orca.calls()).length;

      await assertNotNowInto(box, await answer(box, planner, 'drafter'), before, drafter, arrows, label, from);
    });
  }

  test('TB the 2.1.283 form with a draft in the input box below its foot, which does not count: Esc alone', async (t) => {
    const box = await createSandbox(t);
    const { bots, planner } = await fleet(box);
    const below = [`${'─'.repeat(92)} temp-bot.drafter.abcd1234 ─`, '❯ fix the flaky test', '─'.repeat(120), '  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents'];
    await showIn(box, bots, 'drafter', { screen: [...CLAUDE_TEACH_FORM, ...below], screenAfterSend: CLAUDE_ANSWERED });
    const drafter = (await sessionIn(bots, BOT, 'drafter')).tab;
    const before = await sendsByTab(box);

    await assertEscInto(box, await answer(box, planner, 'drafter'), before, drafter, 'the form with an input box below it');
  });

  // The guard: after the arrows, the screen read again must show the pointer
  // on "2. Not now" and the list otherwise as it was. When it does not, no
  // return goes in, and the command says what it saw.
  for (const [label, afterArrow, row] of [
    ['the pointer did not move', CLAUDE_TEACH_LIST, /❯ 1\. Yes/],
    ['the pointer went on to "3. Don\'t show again"', CLAUDE_TEACH_LIST_ON_THREE, /❯ 3\. Don't show again/],
    ['the pointer is on "2. Not now" but 1 and 3 have swapped places (K)', oneAndThreeSwapped(CLAUDE_TEACH_LIST_ON_NOT_NOW), /3\. Don't show again[\s\S]*❯ 2\. Not now[\s\S]*1\. Yes/],
    ['the pointer is on "2. Not now" but another row changed', listChanged(CLAUDE_TEACH_LIST_ON_NOT_NOW, (one) => (one === '    3. Don\'t show again' ? '    3. Never ask again' : one)), /3\. Never ask again/],
  ]) {
    test(`TD the guard: after the down arrow ${label}, so no return goes in, and it says what it saw`, async (t) => {
      const box = await createSandbox(t);
      const { bots, planner } = await fleet(box);
      await showIn(box, bots, 'drafter', { screen: CLAUDE_TEACH_LIST, nextScreens: [afterArrow, CLAUDE_ANSWERED] });
      const drafter = (await sessionIn(bots, BOT, 'drafter')).tab;
      const before = await sendsByTab(box);

      const result = await answer(box, planner, 'drafter');

      const said = `${result.stdout}${result.stderr}`;
      assert.notEqual(result.code, 0, `${label}: it should be refused, got:\n${said}`);
      assert.ok(!/^\s+at /m.test(said), `${label}: a message, not a crash:\n${said}`);
      const sent = await sentSince(box, before);
      assert.deepEqual(Object.keys(sent), [drafter], `${label}: keys went into the session's tab alone: ${JSON.stringify(sent)}`);
      assert.deepEqual(textsSent(sent, drafter), [DOWN], `${label}: the down arrow went in, and nothing after it`);
      assert.match(said, row, `${label}: it says what it saw: ${said}`);
    });
  }

  for (const [label, screen, row] of [
    ['the list with a row changed', listChanged(CLAUDE_TEACH_LIST, (one) => (one === '    2. Not now' ? '    2. Later' : one)), /2\. Later/],
    ['the list with a row more', listWithAboveFoot('    4. Ask me every time'), /4\. Ask me every time/],
    ['the list with a row less', CLAUDE_TEACH_LIST.filter((one) => one !== '    3. Don\'t show again'), /Teach auto mode about your environment\?/],
    ['the list with a row of the 2.1.283 form among it', listWithAboveFoot('     Continue'), /Teach auto mode about your environment\?/],
    ['the list with two pointers between its title and its foot', listChanged(CLAUDE_TEACH_LIST, (one) => (one === '    2. Not now' ? '  ❯ 2. Not now' : one)), /❯ 2\. Not now/],
    ['the list with no pointer between its title and its foot', listChanged(CLAUDE_TEACH_LIST, (one) => (one === '  ❯ 1. Yes' ? '    1. Yes' : one)), /Auto mode works better when it knows your environment/],
    ['the list with no foot row', CLAUDE_TEACH_LIST.filter((one) => !one.includes('Esc to cancel')), /Auto mode works better when it knows your environment/],
  ]) {
    test(`TD ${label} is refused, says what the screen shows, and nothing is typed`, async (t) => {
      const box = await createSandbox(t);
      const { bots, planner } = await fleet(box);
      await showIn(box, bots, 'drafter', { screen, nextScreens: [CLAUDE_TEACH_LIST_ON_NOT_NOW, CLAUDE_ANSWERED] });
      const before = await sendsByTab(box);

      const said = await assertRefusedUntyped(box, await answer(box, planner, 'drafter'), before, label);
      assert.match(said, row, `it prints what the screen shows, this row among it: ${said}`);
    });
  }

  // H: the known rows in their order. I: framed as Claude Code draws it, a
  // rule right above the title and, below the foot, nothing or the input box's
  // rule; a whole form or list quoted in a turn is not drawn there (the
  // reviewer's probes on PR #490).
  for (const [label, screen, row] of [
    ['H the list with "1. Yes" and "3. Don\'t show again" swapped', oneAndThreeSwapped(CLAUDE_TEACH_LIST), /3\. Don't show again[\s\S]*2\. Not now[\s\S]*❯ 1\. Yes/],
    ['H the 2.1.283 form with its two scan rows swapped', CLAUDE_TEACH_FORM.map((one) => {
      if (one.includes('Also scan shell history')) return '     Also scan your other repos  false';
      if (one.includes('Also scan your other repos')) return '   ❯ Also scan shell history     true';
      return one;
    }), /Also scan your other repos[\s\S]*Also scan shell history/],
    ['I the whole list quoted in a turn, a line of the turn below it, then the input box with a draft', ['❯ What was the list?', '⏺ The captured list was:', ...listBlockOf(CLAUDE_TEACH_LIST_ON_NOT_NOW), '  This is a quotation from the previous run.', ...INPUT_WITH_DRAFT], /This is a quotation from the previous run/],
    ['I the whole 2.1.283 form quoted in a turn, a line of the turn below it, then the input box with a draft', ['❯ What was the form?', '⏺ The captured form was:', ...formRows, '  This is a quotation from the previous run.', ...INPUT_WITH_DRAFT], /This is a quotation from the previous run/],
    ['I the list with a line of a turn right above its title, under the rule', lineAboveTitle(CLAUDE_TEACH_LIST_ON_NOT_NOW, '⏺ The captured list was:'), /The captured list was:/],
    ['I the list with a line of a turn right below its foot, above the input box', lineBelowFoot(CLAUDE_TEACH_LIST_ON_NOT_NOW, '  This is a quotation from the previous run.'), /This is a quotation from the previous run/],
    ['I the 2.1.283 form with a line of a turn right above its title, under the rule', lineAboveTitle(CLAUDE_TEACH_FORM, '⏺ The captured form was:'), /The captured form was:/],
    ['I the 2.1.283 form with a line of a turn right below its foot', [...CLAUDE_TEACH_FORM, '  This is a quotation from the previous run.', ...INPUT_WITH_DRAFT], /This is a quotation from the previous run/],
  ]) {
    test(`T${label} is refused on the first look, says what the screen shows, and nothing is typed`, async (t) => {
      const box = await createSandbox(t);
      const { bots, planner } = await fleet(box);
      await showIn(box, bots, 'drafter', { screen, nextScreens: [CLAUDE_TEACH_LIST_ON_NOT_NOW, CLAUDE_ANSWERED] });
      const before = await sendsByTab(box);

      const said = await assertRefusedUntyped(box, await answer(box, planner, 'drafter'), before, label);
      assert.match(said, row, `it prints what the screen shows, this among it: ${said}`);
    });
  }

  test('TJ the list on "2. Not now" at the first look and on "1. Yes" at the second: refused, and no key at all, not even the return', async (t) => {
    // The pointer starts on 2, so no arrow is due; the second look comes all
    // the same, finds the screen changed, and the return does not go in.
    const box = await createSandbox(t);
    const { bots, planner } = await fleet(box);
    await showIn(box, bots, 'drafter', { screen: CLAUDE_TEACH_LIST_ON_NOT_NOW, thenScreen: CLAUDE_TEACH_LIST, readsBeforeThen: 1, nextScreens: [CLAUDE_ANSWERED] });
    const before = await sendsByTab(box);

    const said = await assertRefusedUntyped(box, await answer(box, planner, 'drafter'), before, 'the list changed between the two looks');
    assert.match(said, /❯ 1\. Yes/, `it says what it saw at the second look: ${said}`);
  });

  test('TE a list still on screen a few seconds after "2. Not now" is a failure, and it says so', async (t) => {
    const box = await createSandbox(t);
    const { bots, planner } = await fleet(box);
    await showIn(box, bots, 'drafter', { screen: CLAUDE_TEACH_LIST, nextScreens: [CLAUDE_TEACH_LIST_ON_NOT_NOW] });
    const drafter = (await sessionIn(bots, BOT, 'drafter')).tab;
    const before = await sendsByTab(box);

    const result = await answer(box, planner, 'drafter');

    const said = `${result.stdout}${result.stderr}`;
    assert.notEqual(result.code, 0, `the list did not go, so it did not work:\n${said}`);
    assert.ok(!/^\s+at /m.test(said), `a message, not a crash:\n${said}`);
    assert.equal(textsSent(await sentSince(box, before), drafter).join(''), `${DOWN}${RETURN}`, 'the answer was sent, and nothing more');
    assert.match(said, /still/i, `it says the list is still there: ${said}`);
    assert.ok(said.includes(TITLE), `naming it: ${said}`);
  });

  test('TD on success with the list it says which session, that it chose Not now on the Teach auto mode list, and that the list has gone', async (t) => {
    const box = await createSandbox(t);
    const { bots, planner } = await fleet(box);
    await showIn(box, bots, 'drafter', { screen: CLAUDE_TEACH_LIST, nextScreens: [CLAUDE_TEACH_LIST_ON_NOT_NOW, CLAUDE_ANSWERED] });

    const result = await answer(box, planner, 'drafter');

    assert.equal(result.code, 0, `it answers the list:\n${result.stdout}${result.stderr}`);
    const said = result.stdout;
    assert.ok(said.includes('drafter'), `it says which session: ${said}`);
    assert.match(said, /Not now/, `that it chose Not now: ${said}`);
    assert.match(said, /Teach auto mode/, `on the Teach auto mode list: ${said}`);
    assert.match(said, /\bgone\b|\bclosed\b|no longer/i, `and that the list has gone: ${said}`);
  });

  // ------------------------------------------------------------ 5. the form gone

  test('TA5 a form still on screen a few seconds after Esc is a failure, and it says so', async (t) => {
    // The key went in and Claude Code did not move on: every read after it
    // still shows the form.
    const box = await createSandbox(t);
    const { bots, planner } = await fleet(box);
    await showIn(box, bots, 'drafter', { screen: CLAUDE_TEACH_FORM });
    const drafter = (await sessionIn(bots, BOT, 'drafter')).tab;
    const before = await sendsByTab(box);

    const result = await answer(box, planner, 'drafter');

    const said = `${result.stdout}${result.stderr}`;
    assert.notEqual(result.code, 0, `the form did not go, so it did not work:\n${said}`);
    assert.ok(!/^\s+at /m.test(said), `a message, not a crash:\n${said}`);
    assert.equal(keysSent(await sentSince(box, before), drafter), ESC, 'Esc was sent, and nothing more');
    assert.match(said, /still/i, `it says the form is still there: ${said}`);
    assert.ok(said.includes(TITLE), `naming it: ${said}`);
  });

  test('TA5 a form that takes a moment to go after Esc is answered', async (t) => {
    // The first two reads after the key still show the form, as a screen that
    // redraws late would; every read after them shows the answered turn.
    const box = await createSandbox(t);
    const { bots, planner } = await fleet(box);
    await showIn(box, bots, 'drafter', { screen: CLAUDE_TEACH_FORM, nextScreens: [{ screen: CLAUDE_TEACH_FORM, then: CLAUDE_ANSWERED, reads: 2 }] });
    const drafter = (await sessionIn(bots, BOT, 'drafter')).tab;
    const before = await sendsByTab(box);

    await assertEscInto(box, await answer(box, planner, 'drafter'), before, drafter, 'a form that goes late');
  });

  // ------------------------------------------------------------ 6, 7. what it says

  test('TA6 TA7 on success it says which session, that it sent Esc (Not now) to the Teach auto mode form, that the form has gone, and the rule a maker needs', async (t) => {
    const box = await createSandbox(t);
    const { bots, planner } = await fleet(box);
    await showIn(box, bots, 'drafter', FORM_THAT_GOES);

    const result = await answer(box, planner, 'drafter');

    assert.equal(result.code, 0, `it answers the form:\n${result.stdout}${result.stderr}`);
    const said = result.stdout;
    assert.ok(said.includes('drafter'), `it says which session: ${said}`);
    assert.match(said, /\bEsc\b/, `that it sent Esc: ${said}`);
    assert.match(said, /Not now/, `which is Not now: ${said}`);
    assert.match(said, /Teach auto mode/, `to the Teach auto mode form: ${said}`);
    assert.match(said, /\bgone\b|\bclosed\b|no longer/i, `and that the form has gone: ${said}`);
    const rule = kitRule(box, bots, 'temp answer');
    assert.ok(said.includes(rule), `it names the one rule a maker's bot needs, the default set's ${rule}: ${said}`);
  });

  test('TA6 --json answers with the bot, the session and its maker', async (t) => {
    const box = await createSandbox(t);
    const { bots, planner } = await fleet(box);
    await showIn(box, bots, 'drafter', FORM_THAT_GOES);

    const result = await answer(box, planner, 'drafter', ['--json']);

    assert.equal(result.code, 0, `it answers the form:\n${result.stdout}${result.stderr}`);
    let answered;
    try {
      answered = JSON.parse(result.stdout);
    } catch {
      assert.fail(`--json should print JSON, got: ${result.stdout}`);
    }
    assert.deepEqual(
      { bot: answered.bot, session: answered.session, maker: answered.maker },
      { bot: BOT, session: 'drafter', maker: 'planner' },
      `the answer names them: ${result.stdout}`,
    );
  });

  test('TA7 SETUP.md section 5 names temp answer and the rule a maker\'s bot needs for it', async () => {
    const setup = await readFile(path.join(repoRoot, 'SETUP.md'), 'utf8');
    const start = setup.indexOf('\n## 5.');
    assert.ok(start >= 0, 'SETUP.md has a section 5');
    const end = setup.indexOf('\n## ', start + 1);
    const section = setup.slice(start, end < 0 ? undefined : end);
    assert.match(section, /temp answer/, 'section 5 names temp answer');
    assert.match(section, /Bash\([^)\n]* temp answer --bots [^)\n]*:\*\)/, 'section 5 names the rule, Bash(<kit> temp answer --bots <folder>:*)');
  });

  // ------------------------------------------------------------ 8. the usage

  test('TA8 obk --help lists obk temp answer --bots <path> --name <session>', async (t) => {
    const box = await createSandbox(t);

    const result = await box.run(['--help']);

    assert.equal(result.code, 0);
    assert.ok(result.stdout.includes('obk temp answer --bots <path> --name <session>'), `usage lists temp answer: ${result.stdout}`);
  });
});
