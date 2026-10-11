// `obk session trust-hooks --bots <path> --bot <bot> --session <name>`: Codex's
// "Hooks need review" on a long-lived session, answered through the kit with
// "Trust all and continue" (#506). It is the long-lived counterpart of `obk
// temp trust-hooks` (temp-trust-hooks.test.js), with the same checks. What is
// held here, by the numbers of the brief:
//
//   1. Who may run it. A long-lived session is Bot Father's. A session of
//      bot-father may run it, and so may a caller outside every bot's session:
//      no tab at all, or a tab that is no session of this fleet (the user, or
//      an assistant of theirs). A session of any other bot is refused: the
//      message names Bot Father, and nothing is typed into any tab.
//   2. The target is a session in the bot's bot.yaml. A bot or a session that
//      does not exist is refused, naming it. A temporary session is refused:
//      its maker answers it with `temp trust-hooks`, and the message says so
//      and names the maker. --bots, --bot and --session are required.
//   3. A session not on Codex is refused. Otherwise it is the temp command's
//      behaviour: it reads the screen and answers only Codex's hooks review,
//      going to "2. Trust all and continue" with arrows from wherever the
//      pointer is (down then return from 1, return alone on 2), never a digit
//      and never `--enter`; any other screen, or one it cannot read, is
//      refused, saying what it saw, with nothing typed; and a review still up
//      after the answer is a failure that says so.
//   5. On success it names the bot and the session, and says it chose "Trust
//      all and continue".
//
// The typing turn is typing-turn-session-first-run.test.js. The check that a
// review covers only the kit's own hooks (6) is
// codex-hooks-only-the-kits.test.js. Here the target is coder/daily, whose bot
// holds the kit's two Codex hooks, none trusted yet (the sandbox has no
// config.toml), so its review says "2 hooks are new or changed."
//
// Every run is in the sandbox (helpers/cli.js): the fake Orca shows each tab
// the screen a test gives it, and moves it on at the next key when told to
// (`screenAfterSend`).

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it as test } from 'node:test';

import { createSandbox, kitLaunchMark, sentInto, sessionIn } from './helpers/cli.js';
import { withoutCodexHome } from './helpers/codex-hooks.js';
import {
  CODEX_AFTER_TRUST,
  CODEX_HOOKS_REVIEW_TWO,
  CODEX_HOOKS_REVIEW_TWO_ON_TWO,
  CODEX_IDLE,
  CODEX_TRUST,
} from './helpers/screens.js';

const TASK = 'Read the open pull request and write down what it changes.';

/** Down one, then return: from the review's first choice to "Trust all and continue", taken. */
const DOWN_RETURN = '\x1b[B\r';
const RETURN = '\r';

/** The sandbox's environment with no CODEX_HOME, so the kit reads the sandbox home's `.codex`. */
const outside = (box) => withoutCodexHome(box.env);

/** The environment of a command a session's harness runs in `terminal`. */
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
 * A tab of the user's own in Orca, which no book in the fleet holds: where the
 * user, or an assistant of theirs, runs the command from.
 */
async function userTab(box) {
  const user = {
    handle: 'term_user',
    tabId: 'tab_user',
    paneKey: 'tab_user:leaf_user',
    ptyId: `setup_user::${path.join(box.root, 'elsewhere')}@@000000ff`,
    leafId: 'leaf_user',
    worktreeId: `repo_user::${path.join(box.root, 'elsewhere')}`,
    worktreePath: path.join(box.root, 'elsewhere'),
    title: 'my own shell',
    agentIdentity: null,
    typed: [],
  };
  await box.orca.set({ terminals: [...(await box.orca.terminals()), user] });
  return user;
}

/**
 * A bots folder with Bot Father (its session daily), coder on Codex with the
 * long-lived session daily, and writer on Claude Code with the long-lived
 * session lead, all brought up; and two temporary sessions lead made, scout on
 * Codex and drafter on Claude Code.
 */
async function fleet(box) {
  const ok = async (args, env) => {
    const result = await box.run(args, { env: env ?? outside(box) });
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  };
  await ok(['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(['bot', 'create', '--bots', 'bots', '--name', 'coder', '--harness', 'codex']);
  await ok(['session', 'add', '--bots', 'bots', '--bot', 'coder', '--name', 'daily']);
  await ok(['bot', 'create', '--bots', 'bots', '--name', 'writer', '--harness', 'claude']);
  await ok(['session', 'add', '--bots', 'bots', '--bot', 'writer', '--name', 'lead']);
  await ok(['up', '--bots', 'bots']);
  const bots = box.path('bots');
  const lead = await tabOf(box, bots, 'writer', 'lead');
  await ok(['temp', 'make', '--bots', 'bots', '--name', 'scout', '--harness', 'codex', '--prompt', TASK], inTab(box, lead));
  await ok(['temp', 'make', '--bots', 'bots', '--name', 'drafter', '--prompt', TASK], inTab(box, lead));
  return {
    bots,
    lead,
    father: await tabOf(box, bots, 'bot-father', 'daily'),
    daily: await tabOf(box, bots, 'coder', 'daily'),
    scout: await tabOf(box, bots, 'writer', 'scout'),
  };
}

/** Give one session's tab a screen of its own, and what it moves on to at the next key, if anything. */
async function showIn(box, bots, bot, name, shown) {
  const tab = (await sessionIn(bots, bot, name)).tab;
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((terminal) => (terminal.tabId === tab ? { ...terminal, ...shown } : terminal)),
  });
}

/** The review a fresh coder brings up, which goes at the next key. */
const REVIEW_THAT_GOES = { screen: CODEX_HOOKS_REVIEW_TWO, screenAfterSend: CODEX_AFTER_TRUST };

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

/** `obk session trust-hooks --bots bots --bot <bot> --session <name>`, with `env` (outside any tab when left out). */
const trustHooks = (box, bot, name, env) => box.run(
  ['session', 'trust-hooks', '--bots', 'bots', '--bot', bot, '--session', name],
  { env: env ?? outside(box) },
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

/** The keys the command sent into one tab, all together, each send made with no `--enter`. */
function keysSent(sent, tab) {
  const sends = sent[tab] ?? [];
  assert.ok(sends.length > 0, `keys should have been sent into the session's tab, got: ${JSON.stringify(sent)}`);
  assert.ok(sends.every((one) => one.enter === false), `with no --enter, the return inside the text: ${JSON.stringify(sends)}`);
  return sends.map((one) => one.text).join('');
}

/** The review answered: exit 0, `keys` into coder/daily's tab and no other. */
async function assertAnswered(box, result, before, tab, keys, what) {
  assert.equal(result.code, 0, `${what}: it answers the review:\n${result.stdout}${result.stderr}`);
  const sent = await sentSince(box, before);
  assert.deepEqual(Object.keys(sent), [tab], `${what}: keys go into the session's tab and no other: ${JSON.stringify(sent)}`);
  assert.equal(keysSent(sent, tab), keys, `${what}: arrows and a return, never a digit`);
}

/** How many of the tests below run at once: each brings up a fleet of its own in its own sandbox. */
const AT_ONCE = { concurrency: 8 };

describe('obk session trust-hooks', AT_ONCE, () => {
  // ------------------------------------------------------------ 1. who may run it

  for (const [label, callerEnv] of [
    ['run outside any tab, as the user in a plain terminal', async (box) => outside(box)],
    ['run in Bot Father\'s session daily', async (box, ours) => inTab(box, ours.father)],
    ['run in a tab of the user\'s own that is no session of this fleet', async (box) => {
      const user = await userTab(box);
      return withoutCodexHome({ ...box.env, ORCA_TERMINAL_HANDLE: user.handle, ORCA_TAB_ID: user.tabId });
    }],
  ]) {
    test(`ST1 ${label}: it answers coder/daily's review, into its tab alone`, async (t) => {
      const box = await createSandbox(t);
      const ours = await fleet(box);
      await showIn(box, ours.bots, 'coder', 'daily', REVIEW_THAT_GOES);
      const env = await callerEnv(box, ours);
      const before = await sendsByTab(box);

      await assertAnswered(box, await trustHooks(box, 'coder', 'daily', env), before, ours.daily.tabId, DOWN_RETURN, label);
    });
  }

  for (const [label, caller] of [
    ['writer\'s long-lived session lead, a session of another bot', (ours) => ours.lead],
    ['coder\'s own session daily, the target itself', (ours) => ours.daily],
    ['writer\'s temporary session scout', (ours) => ours.scout],
  ]) {
    test(`ST1 run in ${label} it is refused, names Bot Father, and nothing is typed`, async (t) => {
      const box = await createSandbox(t);
      const ours = await fleet(box);
      await showIn(box, ours.bots, 'coder', 'daily', REVIEW_THAT_GOES);
      const before = await sendsByTab(box);

      const result = await trustHooks(box, 'coder', 'daily', inTab(box, caller(ours)));

      const said = await assertRefusedUntyped(box, result, before, label);
      assert.match(said, /Bot Father|bot-father/i, `it names Bot Father, whose the session is: ${said}`);
    });
  }

  // ------------------------------------------------------------ 2. the target

  for (const [label, bot, name] of [
    ['a bot that does not exist', 'ghost', 'daily'],
    ['a session coder does not have', 'coder', 'ghost'],
  ]) {
    test(`ST2 ${label} is refused, names it, and nothing is typed`, async (t) => {
      const box = await createSandbox(t);
      const ours = await fleet(box);
      await showIn(box, ours.bots, 'coder', 'daily', REVIEW_THAT_GOES);
      const before = await sendsByTab(box);

      const said = await assertRefusedUntyped(box, await trustHooks(box, bot, name), before, label);
      assert.ok(said.includes('ghost'), `it names what was asked for: ${said}`);
    });
  }

  test('ST2 a temporary session is refused, says its maker answers it with temp trust-hooks, names the maker, and nothing is typed', async (t) => {
    const box = await createSandbox(t);
    const ours = await fleet(box);
    await showIn(box, ours.bots, 'writer', 'scout', REVIEW_THAT_GOES);
    const before = await sendsByTab(box);

    const said = await assertRefusedUntyped(box, await trustHooks(box, 'writer', 'scout', inTab(box, ours.father)), before, 'a temporary session');
    assert.ok(said.includes('lead'), `it names the maker, lead: ${said}`);
    assert.match(said, /temp trust-hooks/, `it says the maker answers it with temp trust-hooks: ${said}`);
  });

  for (const flag of ['--bots', '--bot', '--session']) {
    test(`ST2 without ${flag} it is refused, names ${flag}, and nothing is typed`, async (t) => {
      const box = await createSandbox(t);
      const ours = await fleet(box);
      await showIn(box, ours.bots, 'coder', 'daily', REVIEW_THAT_GOES);
      const before = await sendsByTab(box);
      const all = { '--bots': 'bots', '--bot': 'coder', '--session': 'daily' };
      const args = ['session', 'trust-hooks', ...Object.entries(all).filter(([name]) => name !== flag).flat()];

      const said = await assertRefusedUntyped(box, await box.run(args, { env: outside(box) }), before, `a call without ${flag}`);
      assert.ok(said.includes(flag), `it names the flag it needs: ${said}`);
    });
  }

  // ------------------------------------------------------------ 3. only a Codex session, only the review

  test('ST3 a session that is not on Codex is refused, whatever its screen shows, and nothing is typed', async (t) => {
    const box = await createSandbox(t);
    const ours = await fleet(box);
    await showIn(box, ours.bots, 'writer', 'lead', REVIEW_THAT_GOES);
    const before = await sendsByTab(box);

    const said = await assertRefusedUntyped(box, await trustHooks(box, 'writer', 'lead'), before, 'a session on Claude Code');
    assert.match(said, /codex/i, `it says the command is for a Codex session: ${said}`);
  });

  for (const [label, shown, words] of [
    ['its idle input line', { screen: CODEX_IDLE }, 'Ask Codex to do anything'],
    ['its folder trust, which is not the hooks review', { screen: CODEX_TRUST }, 'Trust this folder?'],
  ]) {
    test(`ST3 a Codex session showing ${label} is refused, says what it saw, and nothing is typed`, async (t) => {
      const box = await createSandbox(t);
      const ours = await fleet(box);
      await showIn(box, ours.bots, 'coder', 'daily', shown);
      const before = await sendsByTab(box);

      const said = await assertRefusedUntyped(box, await trustHooks(box, 'coder', 'daily'), before, label);
      assert.ok(said.includes(words), `it says what the screen showed: ${said}`);
    });
  }

  for (const [label, change] of [
    ['Orca refuses to read it', { fail: { 'terminal read': { code: 'runtime_error', message: 'the renderer did not answer' } } }],
    ['Orca answers with no rendered screen', null],
  ]) {
    test(`ST3 a Codex session whose screen cannot be read (${label}) is refused, says so, and nothing is typed`, async (t) => {
      const box = await createSandbox(t);
      const ours = await fleet(box);
      if (change === null) await showIn(box, ours.bots, 'coder', 'daily', { screen: CODEX_HOOKS_REVIEW_TWO, screenSource: 'screen-unavailable' });
      else {
        await showIn(box, ours.bots, 'coder', 'daily', { screen: CODEX_HOOKS_REVIEW_TWO });
        await box.orca.set(change);
      }
      const before = await sendsByTab(box);

      const said = await assertRefusedUntyped(box, await trustHooks(box, 'coder', 'daily'), before, label);
      assert.match(said, /could not|cannot|can't|unreadable|not be read/i, `it says the screen could not be read: ${said}`);
    });
  }

  // ------------------------------------------------------------ 3, 5. the answer, and what it says

  test('ST3 ST5 with the pointer on "1. Review hooks": down, then return, and it names the bot, the session and what it chose', async (t) => {
    const box = await createSandbox(t);
    const ours = await fleet(box);
    await showIn(box, ours.bots, 'coder', 'daily', REVIEW_THAT_GOES);
    const before = await sendsByTab(box);

    const result = await trustHooks(box, 'coder', 'daily');

    await assertAnswered(box, result, before, ours.daily.tabId, DOWN_RETURN, 'pointer on 1');
    assert.ok(result.stdout.includes('coder'), `it names the bot: ${result.stdout}`);
    assert.ok(result.stdout.includes('daily'), `it names the session: ${result.stdout}`);
    assert.match(result.stdout, /Trust all and continue/, `and says it chose Trust all and continue: ${result.stdout}`);
  });

  test('ST3 with the pointer already on "2. Trust all and continue": return alone', async (t) => {
    const box = await createSandbox(t);
    const ours = await fleet(box);
    await showIn(box, ours.bots, 'coder', 'daily', { screen: CODEX_HOOKS_REVIEW_TWO_ON_TWO, screenAfterSend: CODEX_AFTER_TRUST });
    const before = await sendsByTab(box);

    const result = await trustHooks(box, 'coder', 'daily');

    await assertAnswered(box, result, before, ours.daily.tabId, RETURN, 'pointer on 2');
    assert.match(result.stdout, /Trust all and continue/, `it says what it chose: ${result.stdout}`);
  });

  test('ST3 a review still on screen after the answer is a failure, and it says so', async (t) => {
    const box = await createSandbox(t);
    const ours = await fleet(box);
    await showIn(box, ours.bots, 'coder', 'daily', { screen: CODEX_HOOKS_REVIEW_TWO });
    const before = await sendsByTab(box);

    const result = await trustHooks(box, 'coder', 'daily');

    const said = `${result.stdout}${result.stderr}`;
    assert.notEqual(result.code, 0, `the review did not go, so it did not work:\n${said}`);
    assert.ok(!/^\s+at /m.test(said), `a message, not a crash:\n${said}`);
    assert.equal(keysSent(await sentSince(box, before), ours.daily.tabId), DOWN_RETURN, 'the answer was sent');
    assert.match(said, /still/i, `it says the review is still there: ${said}`);
    assert.ok(said.includes('Hooks need review'), `naming it: ${said}`);
  });

  test('ST obk --help lists obk session trust-hooks', async (t) => {
    const box = await createSandbox(t);

    const result = await box.run(['--help']);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /obk session trust-hooks --bots <path> --bot <bot> --session </, `usage lists session trust-hooks: ${result.stdout}`);
  });
});
