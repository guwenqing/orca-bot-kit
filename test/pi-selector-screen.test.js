// A Pi tab that shows one of Pi's own selectors is not idle (#659, the
// architect's ruling after developer-660's live look at 02:15 EDT on
// 2026-10-19, Pi 1.3.0, Orca 1.4.225).
//
// What was seen: with Pi's /model selector open, Orca's `terminal wait --for
// tui-idle` gave no blockedReason, Orca named agent `pi`, and the kit's screen
// check did not see the selector. So `obk skills build` would have typed
// `/reload` into the selector's search box. Slice 1 saw the same for Pi's trust
// screen (tech notes, section 6).
//
// Why the check missed it: the kit knows a harness's question by its pointer,
// `›` on Codex and `❯` on Claude Code, or by Claude Code's form foot. Pi draws
// neither. Its selectors point with `→`, and each one ends with a foot built
// from its cancel key, whose default keys are escape and ctrl+c (read in Pi
// 1.3.0's code; the /model foot seen live).
//
// The interface (the ruling): `questionIn(rows, agent)` takes the agent Orca
// names in the tab as an optional second argument. With `'pi'`, a row holding
// one of Pi's cancel foots is a question. Without it, or with `'claude'` or
// `'codex'`, it answers as it always has, even for rows with those Pi words.
// The typing gate passes the agent through, so a Pi tab on a selector is
// `blocked` (`question-on-screen`), and `skills build` types nothing into it
// and says what to do, as for any tab that waits for an answer.
//
// The screens below are RECONSTRUCTIONS, not captures. Each foot's words are
// as the ruling quotes them from Pi's code with its default keys; where the
// ruling gives only the end of a foot (`… escape/ctrl+c cancel`), the words in
// front of it are this file's own. The rows around the foots (the chat, the
// selector's border, title and `→` list, Pi's own footer of the folder and the
// model) are laid out after the ruling's description of Pi's screens.
//
// Every run is in the sandbox (helpers/cli.js), with the fake Orca and a fake
// `pi` (helpers/pi.js). Nothing here reaches the real Orca or the real `pi`.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as orca from '../src/orca.js';
import { createSandbox, sentInto, sessionIn } from './helpers/cli.js';
import { fakePi } from './helpers/pi.js';
import { CLAUDE_IDLE, CLAUDE_TEACH_LIST, CLAUDE_TRUST, CODEX_IDLE, CODEX_TRUST, CODEX_UPDATE_OFFER } from './helpers/screens.js';
import { addSkills, botYamlOf } from './helpers/skills.js';

// ------------------------------------------------------------- Pi's screens (reconstructions)

const BORDER = '─'.repeat(72);

/** What a Pi session has drawn above its editor after its first turn. */
const PI_CHAT = [
  ' pi v1.3.0',
  ' [Context] AGENTS.md',
  ' [Skills] obk-tdd',
  '',
  ' Keep the queue moving.',
  '',
  ' ok',
  '',
];

/** Pi's editor box, empty. */
const PI_EDITOR = [BORDER, ' ', BORDER];

/** Pi's footer under the editor: the folder, then the cost, the context and the model. */
const PI_FOOTER = [
  ' ~/bots/bots/mixer',
  ' $0.000 (sub) 0.0%/272k (auto)   (openai) gpt-6-luna • low',
];

/** Pi at rest, waiting for a line. */
const PI_IDLE = [...PI_CHAT, ...PI_EDITOR, ...PI_FOOTER];

/** Pi at work on a turn: its spinner above the editor. */
const PI_BUSY = [...PI_CHAT, ' ⠹ Working...', '', ...PI_EDITOR, ...PI_FOOTER];

/** A selector in the editor's place: border, its title or search row, the `→` list, a blank, the foot, border. */
const selector = (head, list, foot) => [...PI_CHAT, BORDER, ...head, ...list, '', foot, BORDER, ...PI_FOOTER];

/** The /model selector, its foot as developer-660 saw it live. */
const MODEL_FOOT = '  Enter to select · Ctrl+S to set as default · Escape/Ctrl+C to cancel';
const PI_MODEL_SELECTOR = selector(
  [' Select model', ' Search: '],
  [' → gpt-6-luna                  openai', '   gpt-6.1-sol                 openai', '   claude-opus-5-5             anthropic'],
  MODEL_FOOT,
);

/** Pi's project-trust screen, with the foot of Pi 1.3.0's code. */
const PI_TRUST = selector(
  [' Trust project folder?', ' /Users/q/bots/bots/mixer'],
  [' → Trust', '   Trust parent folder', '   Trust (this session only)', '   Do not trust', '   Do not trust (this session only)'],
  ' ↑↓ navigate  enter save  escape/ctrl+c cancel',
);

/** Every selector screen whose foot `questionIn(rows, 'pi')` must know, by what it is. */
const PI_QUESTIONS = [
  ['the /model selector', PI_MODEL_SELECTOR],
  ['the /thinking selector', selector(
    [' Select thinking level'],
    ['   off', '   minimal', ' → low', '   medium', '   high'],
    '  Enter to select · Ctrl+S to set as default · Escape/Ctrl+C to cancel',
  )],
  ['the trust selector, as Pi 1.3.0\'s code draws it', PI_TRUST],
  ['the trust selector, as slice 1 saw it on Pi 1.1.0', selector(
    [' Trust project folder?', ' /Users/q/bots/bots/mixer'],
    [' → Trust', '   Trust parent folder', '   Trust (this session only)', '   Do not trust', '   Do not trust (this session only)'],
    ' ↑↓ navigate  enter select  escape/ctrl+c cancel',
  )],
  ['an extension\'s select dialog', selector([' Pick a branch'], [' → main', '   release'], ' ↑↓ navigate  enter select  escape/ctrl+c cancel')],
  ['an extension\'s input dialog', selector([' Name the branch', ' > '], [], ' enter submit  escape/ctrl+c cancel')],
  ['an extension\'s editor dialog', selector([' Edit the message'], [' first line', ' second line'], ' ctrl+enter save  escape/ctrl+c cancel')],
  ['the tree selector', selector([' Session tree'], [' → user: Keep the queue moving.', '   assistant: ok'], ' ↑↓ navigate  enter select  escape/ctrl+c cancel')],
  ['a loader', selector([' Loading models'], [' ⠹ Working...'], ' escape/ctrl+c cancel')],
  ['the login dialog', selector([' Log in to openai', ' Open this link in your browser.'], [], ' (escape/ctrl+c to cancel)')],
  ['the login dialog with a field', selector([' Log in to openai', ' Paste the code: '], [], ' (escape/ctrl+c to cancel, enter to submit)')],
  ['the login dialog when it is done', selector([' Logged in to openai'], [], ' (escape/ctrl+c to close)')],
  ['first-time setup', selector([' Welcome to pi', ' Choose a theme'], [' → dark', '   light'], ' ↑↓ navigate  enter select  escape/ctrl+c skip setup')],
  ['the session selector', selector([' Resume a session'], [' → pier.daily', '   pier.night'], ' enter to save · escape/ctrl+c to cancel')],
  ['the session selector asking to delete', selector([' Resume a session'], [' → pier.daily'], ' Delete session? enter confirm · escape/ctrl+c cancel')],
];

// ------------------------------------------------------------- questionIn

describe('questionIn knows Pi\'s selectors by their cancel foot, and only for Pi', () => {
  for (const [what, rows] of PI_QUESTIONS) {
    it(`Q1 ${what}, with agent pi, is a question`, () => {
      assert.equal(orca.questionIn(rows, 'pi'), true, `a Pi tab showing ${what} waits for an answer:\n${rows.join('\n')}`);
    });
  }

  it('Q1 Pi at rest, with agent pi, is no question', () => {
    assert.equal(orca.questionIn(PI_IDLE, 'pi'), false);
  });

  it('Q1 Pi at work, with agent pi, is no question', () => {
    assert.equal(orca.questionIn(PI_BUSY, 'pi'), false);
  });

  for (const agent of [undefined, 'claude', 'codex']) {
    const label = agent === undefined ? 'with no agent' : `with agent ${agent}`;
    it(`Q2 every one of those Pi screens, ${label}, gives what it always gave: no question`, () => {
      for (const [what, rows] of [...PI_QUESTIONS, ['Pi at rest', PI_IDLE], ['Pi at work', PI_BUSY]]) {
        const answer = agent === undefined ? orca.questionIn(rows) : orca.questionIn(rows, agent);
        assert.equal(answer, false, `${what}, ${label}: Pi's words count only in a tab Orca says runs Pi`);
      }
    });
  }

  for (const [what, rows, agent] of [
    ['Codex\'s update offer', CODEX_UPDATE_OFFER, 'codex'],
    ['Codex\'s trust question', CODEX_TRUST, 'codex'],
    ['Claude Code\'s Teach list', CLAUDE_TEACH_LIST, 'claude'],
  ]) {
    it(`Q2 ${what}, with agent ${agent}, is still a question, and so it is with no agent`, () => {
      assert.equal(orca.questionIn(rows, agent), true);
      assert.equal(orca.questionIn(rows), true);
    });
  }

  for (const [what, rows, agent] of [['Claude Code at rest', CLAUDE_IDLE, 'claude'], ['Codex at rest', CODEX_IDLE, 'codex']]) {
    it(`Q2 ${what}, with agent ${agent}, is still no question`, () => {
      assert.equal(orca.questionIn(rows, agent), false);
    });
  }

  it('Q2 the premise: Claude Code\'s folder-trust screen is what main says it is, with or without its agent', () => {
    // Not asked of the look in a live tab (question-on-screen.test.js), but
    // the second argument changes nothing about it.
    assert.equal(orca.questionIn(CLAUDE_TRUST, 'claude'), orca.questionIn(CLAUDE_TRUST));
  });
});

// ------------------------------------------------------------- skills build

/** Claude Code's own command for changed skills, which never goes to a Pi tab. */
const CLAUDE_RELOAD = '/reload-skills';

const KIT_SKILL = 'obk-tdd';

/** A hard limit for each test, so a wait that never ends fails here rather than hangs the run. */
const LIMIT = { timeout: 120_000 };

/** A bot on Claude with a Claude session and a Pi session, up, every tab with its launch line and nothing since. */
async function fleetIn(box) {
  await fakePi(box);
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'mixer', '--harness', 'claude', '--charter', 'mixer owns its own corner.']);
  assert.equal(made.code, 0, `${made.stdout}${made.stderr}`);
  for (const [session, harness] of [['daily', 'claude'], ['pier', 'pi']]) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'mixer', '--name', session, '--harness', harness, ...(harness === 'pi' ? ['--prompt', 'Keep the queue moving.'] : [])]);
    assert.equal(added.code, 0, `${added.stdout}${added.stderr}`);
  }
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, `obk up: ${up.stdout}${up.stderr}`);
  return box.path('bots');
}

/** One session's tab as the fake Orca holds it, by the tab the book names. */
async function terminalOf(box, bots, session) {
  const tab = (await sessionIn(bots, 'mixer', session))?.tab;
  const terminal = (await box.orca.terminals()).find((one) => one.tabId === tab);
  assert.ok(terminal, `the premise: Orca holds mixer/${session}'s tab ${tab}`);
  return terminal;
}

/** The one line of a plain `skills build` report about `mixer/<session>`, and its first word. */
function toldLine(stdout, session) {
  const who = `mixer/${session}`;
  const lines = stdout.split('\n').filter((line) => line.includes(` ${who} `) || line.endsWith(` ${who}`));
  assert.equal(lines.length, 1, `the report should have one line about ${who}, got:\n${stdout}`);
  return { line: lines[0], word: /^ {2}(.+?) {2,}/.exec(lines[0])?.[1] };
}

describe('skills build types nothing into a Pi tab that shows one of Pi\'s selectors', { concurrency: 2 }, () => {
  for (const [what, screen] of [['the /model selector', PI_MODEL_SELECTOR], ['the trust screen', PI_TRUST]]) {
    it(`S2 a Pi session whose idle tab shows ${what}: nothing typed, not told, it waits for an answer, type /reload after; the Claude session still gets /reload-skills`, LIMIT, async (t) => {
      const box = await createSandbox(t);
      const bots = await fleetIn(box);
      const pier = await terminalOf(box, bots, 'pier');
      // Orca says what it said live: tui-idle ok with no reason, agent pi.
      assert.equal(pier.agentIdentity, 'pi', 'the premise: Orca names pi in the Pi tab');
      await box.orca.set({ terminals: (await box.orca.terminals()).map((one) => (one.tabId === pier.tabId ? { ...one, screen } : one)) });
      await addSkills(botYamlOf(bots, 'mixer'), `kit:${KIT_SKILL}`);

      const result = await box.run(['skills', 'build', '--bots', 'bots']);

      assert.equal(result.code, 0, `a session not told is not a failure: ${result.stdout}${result.stderr}`);
      const typed = sentInto(await terminalOf(box, bots, 'pier')).slice(1);
      assert.deepEqual(typed, [], `nothing may be typed into a Pi tab on ${what}: /reload would go into it`);
      const { line, word } = toldLine(result.stdout, 'pier');
      assert.equal(word, 'not told', `got: ${line}`);
      assert.match(line, /answer|question|selector|screen/i, `it says the tab waits for an answer, got: ${line}`);
      assert.match(line, /\/reload(?![-\w])/, `and to type /reload afterwards, got: ${line}`);
      assert.ok(!line.includes(CLAUDE_RELOAD), `never Claude's command, got: ${line}`);
      assert.deepEqual(
        sentInto(await terminalOf(box, bots, 'daily')).slice(1),
        [{ text: CLAUDE_RELOAD, enter: true }],
        'the idle Claude session of the same bot is told as before',
      );
      assert.equal(toldLine(result.stdout, 'daily').word, 'reloaded');
    });
  }
});
