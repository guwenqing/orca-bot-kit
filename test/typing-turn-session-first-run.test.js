// `obk session trust-hooks` and `obk session answer` wait their turn to type
// (#506, points 3 and 4 of the brief; the rule of #482).
//
// Every kit path that types into a session's tab takes that session's typing
// turn (#480, helpers/typing-turn.js), so two kit paths never type into one tab
// at once. The two commands answer a long-lived session's first-run screen, as
// `obk temp trust-hooks` and `obk temp answer` answer a temporary one's
// (typing-turn-trust-hooks.test.js, typing-turn-temp-answer.test.js), and take
// the session's turn the same way:
//
//   - not got: nothing is typed into any tab, and it is refused, a non-zero
//     exit with the reason on stderr, which says the kit is typing into it and
//     that nothing was typed;
//   - got within the wait (here let go after about 1 s): it answers;
//   - per session: one held for another session (here Bot Father's daily, the
//     caller's own) does not stop it.
//
// The turn is held from the test process, as typing-turn.test.js holds it.
// Every run is in the sandbox, with a fake Orca that shows the session's tab
// the screen and moves on at the next key (`screenAfterSend`). coder/daily is
// a fresh Codex bot's session, its two kit hooks not trusted yet, so its
// review says "2 hooks are new or changed."

import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, it } from 'node:test';

import { createSandbox, kitLaunchMark, sentInto, sessionIn } from './helpers/cli.js';
import { withoutCodexHome } from './helpers/codex-hooks.js';
import { CLAUDE_ANSWERED, CLAUDE_TEACH_FORM, CODEX_AFTER_TRUST, CODEX_HOOKS_REVIEW_TWO } from './helpers/screens.js';
import { withTypingTurnHeld } from './helpers/typing-turn.js';

/** The words the refusal gives for keys the turn kept out. */
const TYPING = /the kit is typing into it/;

/** A hard limit for each test, so a wait that never ends fails here rather than hangs the run. */
const LIMIT = { timeout: 120_000 };

/** The environment of a command a session's harness runs in `terminal`, with no CODEX_HOME. */
const inTab = (box, terminal) => withoutCodexHome({
  ...box.env,
  ORCA_TERMINAL_HANDLE: terminal.handle,
  ORCA_TAB_ID: terminal.tabId,
  ...kitLaunchMark(box, terminal),
});

/** The terminal Orca has for a session, by the book's tab. */
async function tabOf(box, bots, bot, name) {
  const tab = (await sessionIn(bots, bot, name))?.tab;
  const found = (await box.orca.terminals()).find((one) => one.tabId === tab);
  assert.ok(found, `Orca should have ${bot}/${name}'s tab ${tab}`);
  return found;
}

/**
 * Each command, the session it answers, and the screen that session shows:
 * coder/daily on Codex with its hooks review, writer/lead on Claude Code with
 * the captured Teach form. The keys are the answer each gets.
 */
const COMMANDS = {
  'session trust-hooks': { bot: 'coder', session: 'daily', screen: CODEX_HOOKS_REVIEW_TWO, after: CODEX_AFTER_TRUST, keys: '\x1b[B\r' },
  'session answer': { bot: 'writer', session: 'lead', screen: CLAUDE_TEACH_FORM, after: CLAUDE_ANSWERED, keys: '\x1b' },
};

/**
 * A bots folder with Bot Father (daily), coder on Codex (daily) and writer on
 * Claude Code (lead), all brought up, the target's tab showing its screen.
 */
async function fleet(box, target) {
  const ok = async (args) => {
    const result = await box.run(args, { env: withoutCodexHome(box.env) });
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  };
  await ok(['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(['bot', 'create', '--bots', 'bots', '--name', 'coder', '--harness', 'codex']);
  await ok(['session', 'add', '--bots', 'bots', '--bot', 'coder', '--name', 'daily']);
  await ok(['bot', 'create', '--bots', 'bots', '--name', 'writer', '--harness', 'claude']);
  await ok(['session', 'add', '--bots', 'bots', '--bot', 'writer', '--name', 'lead']);
  await ok(['up', '--bots', 'bots']);
  const bots = box.path('bots');
  const tab = (await tabOf(box, bots, target.bot, target.session)).tabId;
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((terminal) => (terminal.tabId === tab
      ? { ...terminal, screen: target.screen, screenAfterSend: target.after }
      : terminal)),
  });
  return { bots, tab, father: await tabOf(box, bots, 'bot-father', 'daily') };
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

/** `obk <command> --bots bots --bot <bot> --session <session>`, run in Bot Father's daily. */
const run = (box, command, target, father) => box.run(
  [...command.split(' '), '--bots', 'bots', '--bot', target.bot, '--session', target.session],
  { env: inTab(box, father) },
);

/** Answered: exit 0, the command's keys into the target's tab and no other, with no --enter. */
async function assertAnswered(box, result, before, tab, keys, what) {
  assert.equal(result.code, 0, `${what}: it answers:\n${result.stdout}${result.stderr}`);
  const sent = await sentSince(box, before);
  assert.deepEqual(Object.keys(sent), [tab], `${what}: keys go into the session's tab and no other: ${JSON.stringify(sent)}`);
  assert.ok(sent[tab].every((one) => one.enter === false), `${what}: with no --enter: ${JSON.stringify(sent[tab])}`);
  assert.equal(sent[tab].map((one) => one.text).join(''), keys, `${what}: its answer and nothing else`);
}

for (const [command, target] of Object.entries(COMMANDS)) {
  const who = `${target.bot}/${target.session}`;

  describe(`${command} and the typing turn, side by side`, { concurrency: true }, () => {
    it(`${who}'s typing turn held for the whole run: refused, nothing typed into any tab, and stderr says the kit is typing into it and nothing was typed`, LIMIT, async (t) => {
      const box = await createSandbox(t);
      const { bots, father } = await fleet(box, target);
      const before = await sendsByTab(box);

      const started = Date.now();
      const result = await withTypingTurnHeld(bots, target.bot, target.session, () => run(box, command, target, father));
      const took = Date.now() - started;

      assert.deepEqual(await sentSince(box, before), {}, `nothing may be typed into any tab while ${who}'s turn is held`);
      assert.equal(typeof result.code, 'number', 'it should exit, not be killed');
      assert.notEqual(result.code, 0, `it should be refused, got:\n${result.stdout}${result.stderr}`);
      assert.ok(!/^\s+at /m.test(result.stderr), `expected a reason, got a crash:\n${result.stderr}`);
      assert.match(result.stderr, TYPING, `the refusal says the kit is typing into it, got:\n${result.stderr}`);
      assert.match(result.stderr, /nothing was typed/i, `and that nothing was typed, got:\n${result.stderr}`);
      assert.ok(took < 30_000, `the wait for the turn is bounded; it took ${took} ms`);
    });

    it(`${who}'s typing turn let go after about 1 s: nothing typed while it was held, then it answers`, LIMIT, async (t) => {
      const box = await createSandbox(t);
      const { bots, tab, father } = await fleet(box, target);
      const before = await sendsByTab(box);

      let whileHeld;
      const result = await withTypingTurnHeld(bots, target.bot, target.session, async (release) => {
        const running = run(box, command, target, father);
        await sleep(1_000);
        whileHeld = await sentSince(box, before);
        release();
        return running;
      });

      assert.deepEqual(whileHeld, {}, `nothing was typed while ${who}'s turn was held`);
      await assertAnswered(box, result, before, tab, target.keys, 'the turn let go');
    });

    it(`Bot Father's daily's typing turn held does not hold up the answer to ${who}`, LIMIT, async (t) => {
      const box = await createSandbox(t);
      const { bots, tab, father } = await fleet(box, target);
      const before = await sendsByTab(box);

      const result = await withTypingTurnHeld(bots, 'bot-father', 'daily', () => run(box, command, target, father));

      await assertAnswered(box, result, before, tab, target.keys, `Bot Father's turn is not ${who}'s`);
    });
  });
}
