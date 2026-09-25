// The caller answers a tab's first-run screens itself (issue #221, PRD 6.5).
//
// When `obk up`, `obk restart` or `obk unpause` opens a tab and the harness in
// it is left waiting on a screen (folder trust, Codex's hooks review, an update
// offer, the shell's own update question), the caller answers it without going
// to the owner. The kit's report said only "Look at it", and a caller that read
// it went and asked the owner whether to trust the folder.
//
// So the report now tells the caller, among that tab's own lines, to answer the
// screen when it recognises it, where the answers are (the SETUP.md shipped with
// the running kit, by its absolute path, section 5, and the `obk-bot-building`
// skill), and that a screen it does not recognise goes to the user. The same
// holds for a tab where no harness came up: a shell question can have
// swallowed the launch line, and section 5 has that recovery too.
//
// The kit itself presses no key: the caller does. What it types into a waiting
// tab is exactly what it types into any other.
//
// A tab where Orca names no reason gets the same pointers (#288). Measured live
// on Orca 1.4.209, Codex on its "Trust this folder?" and "Hooks need review"
// screens answers `tui-idle` ok and satisfied with no `blockedReason`, and so
// does Claude Code's folder-trust screen (tech notes, section 1). So a harness
// running with no reason given is not reported as come up and ready: the lines
// say the kit cannot see whether a screen in it is waiting, where to look, and
// to answer it.
//
// The wording is the implementer's. What is pinned is what a reader must get:
// the line is part of that tab's lines, it names the SETUP.md path (and the
// file is there), section 5 and the skill, and it says answer it / unknown to
// the user, loosely.
//
// "That tab's lines" is the report's own structure, as it stands: a line at
// the left margin naming the tab (`opened  <title>  tab <id>  terminal
// <handle>`), then its indented lines under it, up to the next line at the
// margin.

import assert from 'node:assert/strict';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  bareLaunch,
  createSandbox,
  recordSession,
  repoRoot,
  sentInto,
  sessionIn,
  tabsOfBot,
  TAB_TITLES,
  tokenless,
  typedInto,
} from './helpers/cli.js';

/** The SETUP.md shipped with the kit under test: its package root is the repo root here. */
const SETUP = path.join(repoRoot, 'SETUP.md');
/** The same file by its resolved path, in case the kit resolves its own root through links. */
const SETUP_REAL = realpathSync(SETUP);

/** The skill the caller is sent to, by its name. */
const SKILL = 'obk-bot-building';

/**
 * The two ways a tab the kit opened is known to leave something to answer, and
 * the one where Orca calls the harness idle and names no reason, which a screen
 * waiting for an answer can look exactly like (#288).
 */
const BLOCKED = { waitIdle: 'blocked' };
const NO_HARNESS = { waitIdle: false };
const UP_AND_IDLE = { waitIdle: true };

/**
 * The lines the report gives one tab: the line at the margin that names it by
 * its handle, and every indented line under it up to the next line at the
 * margin. Fails the test when the report does not name the tab at all.
 */
function linesOfTab(stdout, handle) {
  const lines = stdout.split('\n');
  const named = new RegExp(`\\bterminal ${handle}(?:\\s|$)`);
  const at = lines.findIndex((line) => /^\S/.test(line) && named.test(line));
  assert.ok(at >= 0, `the report should have a line for the tab ${handle}, got:\n${stdout}`);
  const block = [lines[at]];
  for (const line of lines.slice(at + 1)) {
    if (!/^\s+\S/.test(line)) break;
    block.push(line);
  }
  return block.join('\n');
}

/** A tab's lines with the paths taken out, so no word inside a path is read as the kit's. */
const wordsOf = (block, box) => [SETUP, SETUP_REAL, box.orca.cli, box.root, repoRoot]
  .reduce((text, part) => text.split(part).join('<path>'), block);

const namesSetup = (text) => text.includes(SETUP) || text.includes(SETUP_REAL);

/**
 * Hold one tab's lines to carrying the answer-it line: the SETUP.md path,
 * section 5, the skill, "answer it" and "what you do not recognise goes to the
 * user". Loosely on the words, exactly on the path and the skill's name.
 */
function assertTellsToAnswer(block, box, what) {
  assert.ok(
    namesSetup(block),
    `${what}: the tab's lines should name the kit's SETUP.md by its absolute path (${SETUP}), got:\n${block}`,
  );
  assert.ok(existsSync(SETUP), `and the file is there: ${SETUP}`);
  assert.ok(block.includes(SKILL), `${what}: the tab's lines should name the ${SKILL} skill, got:\n${block}`);

  const words = wordsOf(block, box);
  assert.match(
    words,
    /(?:section|§|step|part|#)\s*5\b|\b5\.\s+Answer what the tabs ask/i,
    `${what}: the tab's lines should point at section 5 of SETUP.md, got:\n${block}`,
  );
  assert.match(words, /\banswer/i, `${what}: the tab's lines should tell the caller to answer the screen, got:\n${block}`);
  assert.match(
    words,
    /un(?:recogni[sz]|known|familiar)|(?:not|n't)\s+(?:\w+\s+){0,2}(?:recogni[sz]e|know)|anything else|any other/i,
    `${what}: the tab's lines should say what to do with a screen the caller does not recognise, got:\n${block}`,
  );
  assert.match(words, /\b(?:user|owner)\b/i, `${what}: and that such a screen goes to the user, got:\n${block}`);
}

/** Hold one tab's lines to carrying nothing of the answer-it line. */
function assertDoesNotTellToAnswer(block, what) {
  assert.ok(!namesSetup(block), `${what}: the tab's lines should not send the caller to SETUP.md, got:\n${block}`);
  assert.ok(!block.includes(SKILL), `${what}: the tab's lines should not name ${SKILL}, got:\n${block}`);
}

/** A tab's words on one line, so a sentence the report wraps still reads as one. */
const sentenceOf = (block, box) => wordsOf(block, box).replace(/\s+/g, ' ');

/**
 * "The kit cannot see whether a screen is waiting", loosely: a not-knowing
 * verb, then within the same sentence what it cannot know about.
 */
const CANNOT_SEE = /(?:cannot|can't|can not|unable to|no way to|does not|doesn't|did not|didn't|could not|couldn't)\s+(?:\S+\s+){0,3}?(?:see|tell|know|detect)\b[^.]{0,120}?\b(?:wait|answer|screen|prompt|question)/i;

/**
 * Hold one tab's lines to what #288 asks of a harness running with no reason
 * from Orca: it says the harness is running, not bare "came up" as though it
 * were ready; it says the kit cannot see whether a screen is waiting; and it
 * says where to look, and to answer it.
 */
function assertCannotSeeAScreen(block, box, handle, what) {
  const words = sentenceOf(block, box);
  assert.match(
    words,
    /\b(?:running|is up|came up|started)\b/i,
    `${what}: the tab's lines should say the harness is running, got:\n${block}`,
  );
  assert.doesNotMatch(
    words,
    /\b(?:no|not|never)\s+(?:\w+\s+){0,2}(?:running|came up|started)\b/i,
    `${what}: and not read as a tab where no harness came up, got:\n${block}`,
  );
  assert.doesNotMatch(
    words,
    /\bcame up\s*\./i,
    `${what}: the tab's lines should not claim the harness came up, full stop, as though it were ready, got:\n${block}`,
  );
  assert.match(
    words,
    CANNOT_SEE,
    `${what}: the tab's lines should say the kit cannot see whether a screen in it is waiting for an answer, got:\n${block}`,
  );
  assert.ok(
    block.includes(`Look at it:  ${box.orca.cli} terminal read --terminal ${handle} --screen`),
    `${what}: the tab's lines should say where to look, got:\n${block}`,
  );
  assertTellsToAnswer(block, box, what);
}

// ------------------------------------------------------------------ setups

/** Bot Father, and an api-bot on `harness` with one session called daily. */
async function madeBot(box, harness = 'claude') {
  const init = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(init.code, 0, init.stderr);
  const created = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', harness]);
  assert.equal(created.code, 0, created.stderr);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily']);
  assert.equal(added.code, 0, added.stderr);
  return box.path('bots');
}

/** api-bot up in Orca, with the book holding its conversation `sess-1`. */
async function running(box, harness) {
  const bots = await madeBot(box, harness);
  const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);
  assert.equal(up.code, 0, up.stderr);
  const entry = await sessionIn(bots, 'api-bot', 'daily');
  await recordSession(box, { bots, bot: 'api-bot', tab: entry.tab, session: 'sess-1' });
  return bots;
}

/**
 * Each command that opens a tab, from a bots folder made with Orca behaving,
 * run with Orca in `state`: what it printed, and api-bot's daily tab as Orca
 * has it afterwards. `typed(box)` is what every one of them types into that
 * tab with nothing on screen to answer: the launch line, carrying the CLI that
 * ran it in `box` (#220), and a resume for the two that bring a conversation
 * back. `harness` is api-bot's, claude when left out.
 */
const COMMANDS = {
  'obk up': {
    typed: (box) => [bareLaunch(box, 'claude', 'api-bot', 'daily')],
    async run(box, state, harness) {
      const bots = await madeBot(box, harness);
      await box.orca.set(state);
      return { bots, result: await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']) };
    },
  },
  'obk restart': {
    typed: (box) => [`${bareLaunch(box, 'claude', 'api-bot', 'daily')} --resume sess-1`],
    async run(box, state, harness) {
      const bots = await running(box, harness);
      await box.orca.set(state);
      return { bots, result: await box.run(['restart', '--bots', 'bots', '--bot', 'api-bot']) };
    },
  },
  'obk unpause': {
    typed: (box) => [`${bareLaunch(box, 'claude', 'api-bot', 'daily')} --resume sess-1`],
    async run(box, state, harness) {
      const bots = await running(box, harness);
      const paused = await box.run(['pause', '--bots', 'bots', '--bot', 'api-bot']);
      assert.equal(paused.code, 0, `the pause this test stands on did not happen: ${paused.stderr}`);
      await box.orca.set(state);
      return { bots, result: await box.run(['unpause', '--bots', 'bots', '--bot', 'api-bot']) };
    },
  },
};

/** Run one command with Orca in `state` and hand back its output and the daily tab it opened. */
async function opened(t, name, state, harness = 'claude') {
  const box = await createSandbox(t);
  const { bots, result } = await COMMANDS[name].run(box, state, harness);
  assert.equal(result.code, 0, `${name}: ${result.stderr}`);
  const entry = await sessionIn(bots, 'api-bot', 'daily');
  const terminal = (await tabsOfBot(box, bots, 'api-bot')).find((one) => one.tabId === entry?.tab);
  assert.ok(terminal, `${name} should have opened api-bot's daily tab, the book says: ${JSON.stringify(entry)}`);
  return { box, bots, result, terminal, block: linesOfTab(result.stdout, terminal.handle) };
}

// ------------------------------------------------------------ the blocked tab

for (const name of Object.keys(COMMANDS)) {
  // Covers: a tab the run opened whose harness came up waiting on a screen
  // gets, among its own lines, the line that says answer it, where the answers
  // are (SETUP.md by absolute path, section 5, obk-bot-building), and that an
  // unknown screen goes to the user.
  test(`${name}: a tab whose harness came up waiting on a screen tells the caller to answer it and where the answers are`, async (t) => {
    const { box, block } = await opened(t, name, BLOCKED);

    assertTellsToAnswer(block, box, `${name}, harness waiting`);
  });

  // Covers: a tab the run opened where no harness came up gets the same line
  // among its own lines (a shell question can have swallowed the launch line;
  // section 5 has that recovery).
  test(`${name}: a tab where no harness came up tells the caller the same`, async (t) => {
    const { box, block } = await opened(t, name, NO_HARNESS);

    assertTellsToAnswer(block, box, `${name}, no harness came up`);
  });

  // Covers #288, on both harnesses: a tab the run opened whose harness is
  // running and for which Orca gave no blockedReason is not reported as come up
  // and ready. Its lines say the kit cannot see whether a screen in it is
  // waiting, where to look, and to answer it (SETUP.md section 5,
  // obk-bot-building, unknown to the user). Before #288 this tab got none of
  // that, which is what hid Codex's trust and hooks screens.
  for (const harness of ['claude', 'codex']) {
    test(`${name}: a ${harness} tab running with no reason from Orca says the kit cannot see whether a screen waits, where to look, and to answer it`, async (t) => {
      const { box, block, terminal } = await opened(t, name, UP_AND_IDLE, harness);

      assertCannotSeeAScreen(block, box, terminal.handle, `${name}, ${harness} running, no blockedReason`);
    });
  }

  // Covers: the kit types nothing more into a waiting tab than into any other:
  // no keypress of its own for the screen. Both tabs get exactly the launch
  // line, sent the same way.
  //
  // This one describes what the kit does today as well as what it must go on
  // doing: it is a guard on the "the caller presses the keys, not the kit"
  // half of the requirement, and it is expected to pass before the change.
  test(`${name}: the kit types nothing more into a waiting tab than into an idle one`, async (t) => {
    const idle = await opened(t, name, UP_AND_IDLE);
    const blocked = await opened(t, name, BLOCKED);

    assert.deepEqual(
      typedInto(blocked.terminal).map(tokenless),
      COMMANDS[name].typed(blocked.box),
      `${name}: only the launch line goes into a waiting tab`,
    );
    // Two sandboxes, each with its own `obk` and its own session name, so each
    // line names its own CLI and token (#286): those are set aside and the
    // rest has to match exactly.
    const sent = (run) => sentInto(run.terminal).map((entry) => ({ ...entry, text: tokenless(entry.text).replaceAll(run.box.cli, '<cli>') }));
    assert.deepEqual(sent(blocked), sent(idle), `${name}: and it goes in exactly as it does into an idle tab`);
  });
}

// Covers: the lines already printed for a waiting tab stay as they are; the
// new line joins them rather than replacing them.
test('obk up: a waiting tab keeps what it said before: what it waits on, and where to look', async (t) => {
  const { box, block, terminal } = await opened(t, 'obk up', BLOCKED);

  assert.ok(
    block.includes('waiting on: agent-interactive-prompt'),
    `the tab's lines should still pass on Orca's own reason, got:\n${block}`,
  );
  assert.ok(
    block.includes(`Look at it:  ${box.orca.cli} terminal read --terminal ${terminal.handle} --screen`),
    `and still say where to look, got:\n${block}`,
  );
  assertTellsToAnswer(block, box, 'obk up, harness waiting');
  // #288 leaves this tab as it was: Orca named what it waits on, so the kit
  // does not say it cannot see.
  assert.doesNotMatch(
    sentenceOf(block, box),
    CANNOT_SEE,
    `Orca said what the tab waits on, so the lines should not say the kit cannot see it, got:\n${block}`,
  );
});

// Covers: the line is not printed for a tab that was already there (found,
// not opened), even when Orca would report it waiting, while in the same run
// the tab that was opened and is waiting does get it.
test('obk up: a tab that was found rather than opened gets no such line, while the one opened in the same run does', async (t) => {
  const box = await createSandbox(t);
  const bots = await madeBot(box);
  const botFather = await tabsOfBot(box, bots, 'bot-father');
  const daily = botFather.find((one) => one.title === TAB_TITLES.daily);
  const ops = botFather.find((one) => one.title === TAB_TITLES.ops);
  assert.ok(daily && ops, 'Bot Father\'s tabs should be up from init, or this proves nothing');
  await box.orca.set(BLOCKED);

  const result = await box.run(['up', '--bots', 'bots']);

  assert.equal(result.code, 0, result.stderr);
  const entry = await sessionIn(bots, 'api-bot', 'daily');
  const opened = (await tabsOfBot(box, bots, 'api-bot')).find((one) => one.tabId === entry?.tab);
  assert.ok(opened, `up should have opened api-bot's daily tab, the book says: ${JSON.stringify(entry)}`);
  assertTellsToAnswer(linesOfTab(result.stdout, opened.handle), box, 'the tab up opened, harness waiting');
  assertDoesNotTellToAnswer(linesOfTab(result.stdout, daily.handle), 'Bot Father daily, found');
  assertDoesNotTellToAnswer(linesOfTab(result.stdout, ops.handle), 'Bot Father ops, found');
});

// Covers: a run where every tab is found, with Orca reporting waiting, prints
// the line nowhere, where the run that opened those tabs did.
test('obk up: when every tab was already there, nothing in the output sends the caller to SETUP.md', async (t) => {
  const box = await createSandbox(t);
  await box.orca.set(BLOCKED);
  const first = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(first.code, 0, first.stderr);
  assert.ok(namesSetup(first.stdout), `the run that opened the waiting tab should send the caller to SETUP.md, got:\n${first.stdout}`);

  const again = await box.run(['up', '--bots', 'bots']);

  assert.equal(again.code, 0, again.stderr);
  assert.ok(!namesSetup(again.stdout), `every tab was found, so nothing to answer is reported, got:\n${again.stdout}`);
});

// Covers: `obk init` prints its tabs through the same report, so its waiting
// Bot Father daily tab gets the line; the ops tab, which has no harness typed
// into it at all, does not.
test('obk init: Bot Father\'s waiting daily tab tells the caller to answer it; the ops tab does not', async (t) => {
  const box = await createSandbox(t);
  await box.orca.set(BLOCKED);

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assert.equal(result.code, 0, result.stderr);
  const tabs = await tabsOfBot(box, box.path('bots'), 'bot-father');
  const daily = tabs.find((one) => one.title === TAB_TITLES.daily);
  const ops = tabs.find((one) => one.title === TAB_TITLES.ops);
  assert.ok(daily && ops, `init should have opened both of Bot Father's tabs, got: ${JSON.stringify(tabs)}`);
  assertTellsToAnswer(linesOfTab(result.stdout, daily.handle), box, 'Bot Father daily, harness waiting');
  assertDoesNotTellToAnswer(linesOfTab(result.stdout, ops.handle), 'Bot Father ops, no harness typed in');
});

// Covers #288's boundary: with Orca naming no reason, only the tab the run
// opened and typed a harness into says the kit cannot see whether a screen
// waits. Bot Father's tabs, found in the same run, get none of it.
test('obk up: with no reason from Orca, the tab it opened says it cannot see a screen; the tabs it found say nothing of it', async (t) => {
  const box = await createSandbox(t);
  const bots = await madeBot(box);
  const botFather = await tabsOfBot(box, bots, 'bot-father');
  const daily = botFather.find((one) => one.title === TAB_TITLES.daily);
  const ops = botFather.find((one) => one.title === TAB_TITLES.ops);
  assert.ok(daily && ops, 'Bot Father\'s tabs should be up from init, or this proves nothing');
  await box.orca.set(UP_AND_IDLE);

  const result = await box.run(['up', '--bots', 'bots']);

  assert.equal(result.code, 0, result.stderr);
  const entry = await sessionIn(bots, 'api-bot', 'daily');
  const opened = (await tabsOfBot(box, bots, 'api-bot')).find((one) => one.tabId === entry?.tab);
  assert.ok(opened, `up should have opened api-bot's daily tab, the book says: ${JSON.stringify(entry)}`);
  assertCannotSeeAScreen(linesOfTab(result.stdout, opened.handle), box, opened.handle, 'the tab up opened, no blockedReason');
  for (const [tab, what] of [[daily, 'Bot Father daily, found'], [ops, 'Bot Father ops, found']]) {
    const block = linesOfTab(result.stdout, tab.handle);
    assertDoesNotTellToAnswer(block, what);
    assert.doesNotMatch(sentenceOf(block, box), CANNOT_SEE, `${what}: nothing about a screen it cannot see, got:\n${block}`);
    assert.ok(!block.includes('Look at it:'), `${what}: and nowhere to look, got:\n${block}`);
  }
});

// Covers #288 for `obk init`: its Bot Father daily tab, harness running with no
// reason from Orca, says the kit cannot see whether a screen waits; the plain
// ops tab, with no harness typed into it, says nothing of it.
test('obk init: with no reason from Orca, Bot Father\'s daily tab says it cannot see a screen; the ops tab says nothing of it', async (t) => {
  const box = await createSandbox(t);
  await box.orca.set(UP_AND_IDLE);

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assert.equal(result.code, 0, result.stderr);
  const tabs = await tabsOfBot(box, box.path('bots'), 'bot-father');
  const daily = tabs.find((one) => one.title === TAB_TITLES.daily);
  const ops = tabs.find((one) => one.title === TAB_TITLES.ops);
  assert.ok(daily && ops, `init should have opened both of Bot Father's tabs, got: ${JSON.stringify(tabs)}`);
  assertCannotSeeAScreen(linesOfTab(result.stdout, daily.handle), box, daily.handle, 'Bot Father daily, no blockedReason');
  const block = linesOfTab(result.stdout, ops.handle);
  assertDoesNotTellToAnswer(block, 'Bot Father ops, no harness typed in');
  assert.doesNotMatch(sentenceOf(block, box), CANNOT_SEE, `Bot Father ops: nothing about a screen it cannot see, got:\n${block}`);
});
