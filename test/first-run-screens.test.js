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
  sessionIn,
  tabsOfBot,
  TAB_TITLES,
} from './helpers/cli.js';

/** The SETUP.md shipped with the kit under test: its package root is the repo root here. */
const SETUP = path.join(repoRoot, 'SETUP.md');
/** The same file by its resolved path, in case the kit resolves its own root through links. */
const SETUP_REAL = realpathSync(SETUP);

/** The skill the caller is sent to, by its name. */
const SKILL = 'obk-bot-building';

/** The two ways a tab the kit opened can leave something to answer, and the one that does not. */
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

// ------------------------------------------------------------------ setups

/** Bot Father, and an api-bot with one claude session called daily. */
async function madeBot(box) {
  const init = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(init.code, 0, init.stderr);
  const created = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude']);
  assert.equal(created.code, 0, created.stderr);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily']);
  assert.equal(added.code, 0, added.stderr);
  return box.path('bots');
}

/** api-bot up in Orca, with the book holding its conversation `sess-1`. */
async function running(box) {
  const bots = await madeBot(box);
  const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);
  assert.equal(up.code, 0, up.stderr);
  const entry = await sessionIn(bots, 'api-bot', 'daily');
  await recordSession(box, { bots, bot: 'api-bot', tab: entry.tab, session: 'sess-1' });
  return bots;
}

/**
 * Each command that opens a tab, from a bots folder made with Orca behaving,
 * run with Orca in `state`: what it printed, and api-bot's daily tab as Orca
 * has it afterwards. `typed` is what every one of them types into that tab
 * with nothing on screen to answer: the launch line, a resume for the two that
 * bring a conversation back.
 */
const COMMANDS = {
  'obk up': {
    typed: [bareLaunch('claude', 'api-bot', 'daily')],
    async run(box, state) {
      const bots = await madeBot(box);
      await box.orca.set(state);
      return { bots, result: await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']) };
    },
  },
  'obk restart': {
    typed: [`${bareLaunch('claude', 'api-bot', 'daily')} --resume sess-1`],
    async run(box, state) {
      const bots = await running(box);
      await box.orca.set(state);
      return { bots, result: await box.run(['restart', '--bots', 'bots', '--bot', 'api-bot']) };
    },
  },
  'obk unpause': {
    typed: [`${bareLaunch('claude', 'api-bot', 'daily')} --resume sess-1`],
    async run(box, state) {
      const bots = await running(box);
      const paused = await box.run(['pause', '--bots', 'bots', '--bot', 'api-bot']);
      assert.equal(paused.code, 0, `the pause this test stands on did not happen: ${paused.stderr}`);
      await box.orca.set(state);
      return { bots, result: await box.run(['unpause', '--bots', 'bots', '--bot', 'api-bot']) };
    },
  },
};

/** Run one command with Orca in `state` and hand back its output and the daily tab it opened. */
async function opened(t, name, state) {
  const box = await createSandbox(t);
  const { bots, result } = await COMMANDS[name].run(box, state);
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

  // Covers: the line is not printed for a tab whose harness came up and is not
  // waiting, anywhere in the output. The same command with the harness waiting,
  // beside it, is what shows the line is the kit's and not missing for some
  // other reason.
  test(`${name}: a tab whose harness came up and is not waiting gets no such line`, async (t) => {
    const idle = await opened(t, name, UP_AND_IDLE);
    const blocked = await opened(t, name, BLOCKED);

    assertTellsToAnswer(blocked.block, blocked.box, `${name}, harness waiting`);
    assertDoesNotTellToAnswer(idle.block, `${name}, harness up and idle`);
    assert.ok(
      !namesSetup(idle.result.stdout),
      `${name}: with nothing to answer, nothing in the output should send the caller to SETUP.md, got:\n${idle.result.stdout}`,
    );
  });

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
      blocked.terminal.typed.map((entry) => entry.text),
      COMMANDS[name].typed,
      `${name}: only the launch line goes into a waiting tab`,
    );
    assert.deepEqual(blocked.terminal.typed, idle.terminal.typed, `${name}: and it goes in exactly as it does into an idle tab`);
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
