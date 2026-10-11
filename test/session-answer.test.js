// `obk session answer --bots <path> --bot <bot> --session <name>`: Claude
// Code's "Teach auto mode about your environment?" on a long-lived session,
// answered through the kit (#506). It is the long-lived counterpart of `obk
// temp answer` (temp-answer.test.js), with the same checks. What is held here,
// by the numbers of the brief:
//
//   1. Who may run it. A long-lived session is Bot Father's. A session of
//      bot-father may run it, and so may a caller outside every bot's session:
//      no tab at all, or a tab that is no session of this fleet (the user, or
//      an assistant of theirs). A session of any other bot is refused: the
//      message names Bot Father, and nothing is typed into any tab.
//   2. The target is a session in the bot's bot.yaml. A bot or a session that
//      does not exist is refused, naming it. A temporary session is refused:
//      its maker answers it with `temp answer`, and the message says so and
//      names the maker. --bots, --bot and --session are required.
//   4. The temp command's behaviour on the two known shapes: the 2.1.283 form
//      (helpers/screens.js CLAUDE_TEACH_FORM) gets Esc alone; the 2.1.289 list
//      (CLAUDE_TEACH_LIST) gets arrows to "2. Not now", a second look, then a
//      return alone. Never a digit, never `--enter`. Any other screen, or one
//      it cannot read, is refused, saying what it saw, with nothing typed. A
//      form or list still up after the answer is a failure that says so.
//   5. On success it names the bot and the session, and what was sent.
//
// The typing turn is typing-turn-session-first-run.test.js. Here the target is
// writer/lead, a long-lived session on Claude Code.
//
// Every run is in the sandbox (helpers/cli.js): the fake Orca shows each tab
// the screen a test gives it, and moves it on at the next key when told to
// (`screenAfterSend`, `nextScreens`).

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it as test } from 'node:test';

import { createSandbox, kitLaunchMark, orcaCommand, orcaFlag, sentInto, sessionIn } from './helpers/cli.js';
import {
  CLAUDE_ANSWERED,
  CLAUDE_IDLE,
  CLAUDE_TEACH_FORM,
  CLAUDE_TEACH_FORM_ON_CONTINUE,
  CLAUDE_TEACH_LIST,
  CLAUDE_TEACH_LIST_ON_NOT_NOW,
  CLAUDE_TEACH_LIST_ON_THREE,
  CLAUDE_TRUST,
  CODEX_HOOKS_REVIEW_TWO,
  FORM_IN_HISTORY,
} from './helpers/screens.js';

const TASK = 'Read the open pull request and write down what it changes.';

/** Esc, alone: "Not now" on the 2.1.283 form. Never a return, which is Continue there. */
const ESC = '\x1b';
const DOWN = '\x1b[B';
const UP = '\x1b[A';
const RETURN = '\r';

/** The form's title row, as captured. */
const TITLE = 'Teach auto mode about your environment?';

/** The environment of a command a session's harness runs in `terminal`. */
const inTab = (box, terminal) => ({ ...box.env, ORCA_TERMINAL_HANDLE: terminal.handle, ORCA_TAB_ID: terminal.tabId, ...kitLaunchMark(box, terminal) });

/** The terminal Orca has for a session, by the book's tab. */
async function tabOf(box, bots, bot, name) {
  const tab = (await sessionIn(bots, bot, name))?.tab;
  const found = (await box.orca.terminals()).find((one) => one.tabId === tab);
  assert.ok(found, `Orca should have ${bot}/${name}'s tab ${tab}`);
  return found;
}

/** A tab of the user's own in Orca, which no book in the fleet holds. */
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
 * A bots folder with Bot Father (its session daily), writer on Claude Code with
 * the long-lived session lead, and coder on Codex with the long-lived session
 * daily, all brought up; and a temporary Claude session drafter that lead made.
 */
async function fleet(box) {
  const ok = async (args, env) => {
    const result = await box.run(args, env === undefined ? {} : { env });
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  };
  await ok(['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(['bot', 'create', '--bots', 'bots', '--name', 'writer', '--harness', 'claude']);
  await ok(['session', 'add', '--bots', 'bots', '--bot', 'writer', '--name', 'lead']);
  await ok(['bot', 'create', '--bots', 'bots', '--name', 'coder', '--harness', 'codex']);
  await ok(['session', 'add', '--bots', 'bots', '--bot', 'coder', '--name', 'daily']);
  await ok(['up', '--bots', 'bots']);
  const bots = box.path('bots');
  const lead = await tabOf(box, bots, 'writer', 'lead');
  await ok(['temp', 'make', '--bots', 'bots', '--name', 'drafter', '--prompt', TASK], inTab(box, lead));
  return {
    bots,
    lead,
    father: await tabOf(box, bots, 'bot-father', 'daily'),
    daily: await tabOf(box, bots, 'coder', 'daily'),
    drafter: await tabOf(box, bots, 'writer', 'drafter'),
  };
}

/** Give one session's tab a screen of its own, and what it moves on to, if anything. */
async function showIn(box, bots, bot, name, shown) {
  const tab = (await sessionIn(bots, bot, name)).tab;
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

/** `obk session answer --bots bots --bot <bot> --session <name>`, with `env` (outside any tab when left out). */
const answer = (box, bot, name, env) => box.run(
  ['session', 'answer', '--bots', 'bots', '--bot', bot, '--session', name],
  env === undefined ? {} : { env },
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

/** The texts sent into one tab, in order, each send made with no `--enter`. */
function textsSent(sent, tab) {
  const sends = sent[tab] ?? [];
  assert.ok(sends.length > 0, `keys should have been sent into the session's tab, got: ${JSON.stringify(sent)}`);
  assert.ok(sends.every((one) => one.enter === false), `with no --enter: ${JSON.stringify(sends)}`);
  return sends.map((one) => one.text);
}

/** The form answered: exit 0, and Esc alone into `tab` and no other. */
async function assertEscInto(box, result, before, tab, what) {
  assert.equal(result.code, 0, `${what}: it answers the form:\n${result.stdout}${result.stderr}`);
  const sent = await sentSince(box, before);
  assert.deepEqual(Object.keys(sent), [tab], `${what}: keys go into the session's tab and no other: ${JSON.stringify(sent)}`);
  assert.equal(textsSent(sent, tab).join(''), ESC, `${what}: Esc alone, never a return`);
}

/** The kit's reads of one tab's screen and its sends into it, from Orca's call `from` on, in order. */
async function readsAndSendsOf(box, tab, from) {
  const handle = (await box.orca.terminals()).find((terminal) => terminal.tabId === tab).handle;
  return (await box.orca.calls()).slice(from)
    .filter((call) => orcaFlag(call, '--terminal') === handle)
    .map((call) => ({ command: orcaCommand(call), text: orcaFlag(call, '--text') }))
    .filter((call) => call.command === 'terminal read' || call.command === 'terminal send');
}

/**
 * The list answered: exit 0, keys into `tab` and no other, the `arrows` and
 * then a return alone as the last send, with a read of the screen between the
 * last arrow and the return; with no arrows, two reads before the return.
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
  assert.ok(looks >= (arrows === '' ? 2 : 1), `${what}: the screen is read again before the return: ${JSON.stringify(calls)}`);
}

/** How many of the tests below run at once: each brings up a fleet of its own in its own sandbox. */
const AT_ONCE = { concurrency: 8 };

describe('obk session answer', AT_ONCE, () => {
  // ------------------------------------------------------------ 1. who may run it

  for (const [label, callerEnv] of [
    ['run outside any tab, as the user in a plain terminal', async () => undefined],
    ['run in Bot Father\'s session daily', async (box, ours) => inTab(box, ours.father)],
    ['run in a tab of the user\'s own that is no session of this fleet', async (box) => {
      const user = await userTab(box);
      return { ...box.env, ORCA_TERMINAL_HANDLE: user.handle, ORCA_TAB_ID: user.tabId };
    }],
  ]) {
    test(`SA1 ${label}: it answers writer/lead's form with Esc, into its tab alone`, async (t) => {
      const box = await createSandbox(t);
      const ours = await fleet(box);
      await showIn(box, ours.bots, 'writer', 'lead', FORM_THAT_GOES);
      const env = await callerEnv(box, ours);
      const before = await sendsByTab(box);

      await assertEscInto(box, await answer(box, 'writer', 'lead', env), before, ours.lead.tabId, label);
    });
  }

  for (const [label, caller] of [
    ['coder\'s long-lived session daily, a session of another bot', (ours) => ours.daily],
    ['writer\'s own session lead, the target itself', (ours) => ours.lead],
    ['writer\'s temporary session drafter', (ours) => ours.drafter],
  ]) {
    test(`SA1 run in ${label} it is refused, names Bot Father, and nothing is typed`, async (t) => {
      const box = await createSandbox(t);
      const ours = await fleet(box);
      await showIn(box, ours.bots, 'writer', 'lead', FORM_THAT_GOES);
      const before = await sendsByTab(box);

      const said = await assertRefusedUntyped(box, await answer(box, 'writer', 'lead', inTab(box, caller(ours))), before, label);
      assert.match(said, /Bot Father|bot-father/i, `it names Bot Father, whose the session is: ${said}`);
    });
  }

  // ------------------------------------------------------------ 2. the target

  for (const [label, bot, name] of [
    ['a bot that does not exist', 'ghost', 'lead'],
    ['a session writer does not have', 'writer', 'ghost'],
  ]) {
    test(`SA2 ${label} is refused, names it, and nothing is typed`, async (t) => {
      const box = await createSandbox(t);
      const ours = await fleet(box);
      await showIn(box, ours.bots, 'writer', 'lead', FORM_THAT_GOES);
      const before = await sendsByTab(box);

      const said = await assertRefusedUntyped(box, await answer(box, bot, name), before, label);
      assert.ok(said.includes('ghost'), `it names what was asked for: ${said}`);
    });
  }

  test('SA2 a temporary session is refused, says its maker answers it with temp answer, names the maker, and nothing is typed', async (t) => {
    const box = await createSandbox(t);
    const ours = await fleet(box);
    await showIn(box, ours.bots, 'writer', 'drafter', FORM_THAT_GOES);
    const before = await sendsByTab(box);

    const said = await assertRefusedUntyped(box, await answer(box, 'writer', 'drafter', inTab(box, ours.father)), before, 'a temporary session');
    assert.ok(said.includes('lead'), `it names the maker, lead: ${said}`);
    assert.match(said, /temp answer/, `it says the maker answers it with temp answer: ${said}`);
  });

  for (const flag of ['--bots', '--bot', '--session']) {
    test(`SA2 without ${flag} it is refused, names ${flag}, and nothing is typed`, async (t) => {
      const box = await createSandbox(t);
      const ours = await fleet(box);
      await showIn(box, ours.bots, 'writer', 'lead', FORM_THAT_GOES);
      const before = await sendsByTab(box);
      const all = { '--bots': 'bots', '--bot': 'writer', '--session': 'lead' };
      const args = ['session', 'answer', ...Object.entries(all).filter(([name]) => name !== flag).flat()];

      const said = await assertRefusedUntyped(box, await box.run(args), before, `a call without ${flag}`);
      assert.ok(said.includes(flag), `it names the flag it needs: ${said}`);
    });
  }

  // ------------------------------------------------------------ 4. the two known shapes

  for (const [label, screen] of [
    ['the captured 2.1.283 form, the pointer on "Also scan shell history"', CLAUDE_TEACH_FORM],
    ['the 2.1.283 form with its pointer on Continue, the row a return would take', CLAUDE_TEACH_FORM_ON_CONTINUE],
  ]) {
    test(`SA4 ${label}: Esc alone, into the session's tab alone`, async (t) => {
      const box = await createSandbox(t);
      const ours = await fleet(box);
      await showIn(box, ours.bots, 'writer', 'lead', { screen, screenAfterSend: CLAUDE_ANSWERED });
      const before = await sendsByTab(box);

      await assertEscInto(box, await answer(box, 'writer', 'lead'), before, ours.lead.tabId, label);
    });
  }

  for (const [label, screen, after, arrows] of [
    ['the captured 2.1.289 list, the pointer on "1. Yes": down, a look, then return', CLAUDE_TEACH_LIST, [CLAUDE_TEACH_LIST_ON_NOT_NOW, CLAUDE_ANSWERED], DOWN],
    ['the list with its pointer on "3. Don\'t show again": up, a look, then return', CLAUDE_TEACH_LIST_ON_THREE, [CLAUDE_TEACH_LIST_ON_NOT_NOW, CLAUDE_ANSWERED], UP],
    ['the list with its pointer already on "2. Not now": two looks, then return alone', CLAUDE_TEACH_LIST_ON_NOT_NOW, [CLAUDE_ANSWERED], ''],
  ]) {
    test(`SA4 ${label}, into the session's tab alone`, async (t) => {
      const box = await createSandbox(t);
      const ours = await fleet(box);
      await showIn(box, ours.bots, 'writer', 'lead', { screen, nextScreens: after });
      const before = await sendsByTab(box);
      const from = (await box.orca.calls()).length;

      await assertNotNowInto(box, await answer(box, 'writer', 'lead'), before, ours.lead.tabId, arrows, label, from);
    });
  }

  test('SA4 the guard: after the down arrow the pointer did not move, so no return goes in, and it says what it saw', async (t) => {
    const box = await createSandbox(t);
    const ours = await fleet(box);
    await showIn(box, ours.bots, 'writer', 'lead', { screen: CLAUDE_TEACH_LIST, nextScreens: [CLAUDE_TEACH_LIST, CLAUDE_ANSWERED] });
    const before = await sendsByTab(box);

    const result = await answer(box, 'writer', 'lead');

    const said = `${result.stdout}${result.stderr}`;
    assert.notEqual(result.code, 0, `it should be refused, got:\n${said}`);
    assert.ok(!/^\s+at /m.test(said), `a message, not a crash:\n${said}`);
    const sent = await sentSince(box, before);
    assert.deepEqual(Object.keys(sent), [ours.lead.tabId], `keys went into the session's tab alone: ${JSON.stringify(sent)}`);
    assert.deepEqual(textsSent(sent, ours.lead.tabId), [DOWN], 'the down arrow went in, and nothing after it');
    assert.match(said, /❯ 1\. Yes/, `it says what it saw: ${said}`);
  });

  for (const [label, screen, row] of [
    ['Claude Code idle at its input line', CLAUDE_IDLE, /Try "fix typecheck errors"/],
    ['Claude Code\'s folder trust', CLAUDE_TRUST, /Yes, I trust this folder/],
    ['the 2.1.283 form with a row more', [...CLAUDE_TEACH_FORM.slice(0, -1), '     Also scan your home folder  false', CLAUDE_TEACH_FORM.at(-1)], /Also scan your home folder/],
    ['the 2.1.283 form quoted in history, the input line below it', FORM_IN_HISTORY, /Enter on it is Continue, which starts the scan\./],
    ['the 2.1.289 list with a row changed', CLAUDE_TEACH_LIST.map((one) => (one === '    2. Not now' ? '    2. Later' : one)), /2\. Later/],
  ]) {
    test(`SA4 ${label} is refused, says what the screen shows, and nothing is typed`, async (t) => {
      const box = await createSandbox(t);
      const ours = await fleet(box);
      await showIn(box, ours.bots, 'writer', 'lead', { screen, nextScreens: [CLAUDE_TEACH_LIST_ON_NOT_NOW, CLAUDE_ANSWERED] });
      const before = await sendsByTab(box);

      const said = await assertRefusedUntyped(box, await answer(box, 'writer', 'lead'), before, label);
      assert.match(said, row, `it prints what the screen shows, this row among it: ${said}`);
    });
  }

  test('SA4 a Codex session on its hooks review is refused, says what it saw, and nothing is typed', async (t) => {
    const box = await createSandbox(t);
    const ours = await fleet(box);
    await showIn(box, ours.bots, 'coder', 'daily', { screen: CODEX_HOOKS_REVIEW_TWO });
    const before = await sendsByTab(box);

    const said = await assertRefusedUntyped(box, await answer(box, 'coder', 'daily'), before, 'Codex\'s hooks review');
    assert.match(said, /Hooks need review/, `it says what the screen shows: ${said}`);
  });

  for (const [label, change] of [
    ['Orca refuses to read it', { fail: { 'terminal read': { code: 'runtime_error', message: 'the renderer did not answer' } } }],
    ['Orca answers with no rendered screen', null],
  ]) {
    test(`SA4 a session whose screen cannot be read (${label}) is refused, says so, and nothing is typed`, async (t) => {
      const box = await createSandbox(t);
      const ours = await fleet(box);
      if (change === null) await showIn(box, ours.bots, 'writer', 'lead', { ...FORM_THAT_GOES, screenSource: 'screen-unavailable' });
      else {
        await showIn(box, ours.bots, 'writer', 'lead', FORM_THAT_GOES);
        await box.orca.set(change);
      }
      const before = await sendsByTab(box);

      const said = await assertRefusedUntyped(box, await answer(box, 'writer', 'lead'), before, label);
      assert.match(said, /could not|cannot|can't|unreadable|not be read/i, `it says the screen could not be read: ${said}`);
    });
  }

  for (const [label, shown, keys] of [
    ['a 2.1.283 form still on screen a few seconds after Esc', { screen: CLAUDE_TEACH_FORM }, ESC],
    ['a 2.1.289 list still on screen a few seconds after "2. Not now"', { screen: CLAUDE_TEACH_LIST, nextScreens: [CLAUDE_TEACH_LIST_ON_NOT_NOW] }, `${DOWN}${RETURN}`],
  ]) {
    test(`SA4 ${label} is a failure, and it says so`, async (t) => {
      const box = await createSandbox(t);
      const ours = await fleet(box);
      await showIn(box, ours.bots, 'writer', 'lead', shown);
      const before = await sendsByTab(box);

      const result = await answer(box, 'writer', 'lead');

      const said = `${result.stdout}${result.stderr}`;
      assert.notEqual(result.code, 0, `it did not go, so it did not work:\n${said}`);
      assert.ok(!/^\s+at /m.test(said), `a message, not a crash:\n${said}`);
      assert.equal(textsSent(await sentSince(box, before), ours.lead.tabId).join(''), keys, 'the answer was sent, and nothing more');
      assert.match(said, /still/i, `it says the screen is still there: ${said}`);
      assert.ok(said.includes(TITLE), `naming it: ${said}`);
    });
  }

  // ------------------------------------------------------------ 5. what it says

  test('SA5 on success with the 2.1.283 form it names the bot and the session, and says it sent Esc (Not now)', async (t) => {
    const box = await createSandbox(t);
    const ours = await fleet(box);
    await showIn(box, ours.bots, 'writer', 'lead', FORM_THAT_GOES);

    const result = await answer(box, 'writer', 'lead');

    assert.equal(result.code, 0, `it answers the form:\n${result.stdout}${result.stderr}`);
    const said = result.stdout;
    assert.ok(said.includes('writer'), `it names the bot: ${said}`);
    assert.ok(said.includes('lead'), `it names the session: ${said}`);
    assert.match(said, /\bEsc\b/, `that it sent Esc: ${said}`);
    assert.match(said, /Not now/, `which is Not now: ${said}`);
    assert.match(said, /Teach auto mode/, `to the Teach auto mode screen: ${said}`);
  });

  test('SA5 on success with the 2.1.289 list it names the bot and the session, and says it chose Not now', async (t) => {
    const box = await createSandbox(t);
    const ours = await fleet(box);
    await showIn(box, ours.bots, 'writer', 'lead', { screen: CLAUDE_TEACH_LIST, nextScreens: [CLAUDE_TEACH_LIST_ON_NOT_NOW, CLAUDE_ANSWERED] });

    const result = await answer(box, 'writer', 'lead');

    assert.equal(result.code, 0, `it answers the list:\n${result.stdout}${result.stderr}`);
    const said = result.stdout;
    assert.ok(said.includes('writer'), `it names the bot: ${said}`);
    assert.ok(said.includes('lead'), `it names the session: ${said}`);
    assert.match(said, /Not now/, `that it chose Not now: ${said}`);
    assert.match(said, /Teach auto mode/, `on the Teach auto mode screen: ${said}`);
  });

  test('SA obk --help lists obk session answer', async (t) => {
    const box = await createSandbox(t);

    const result = await box.run(['--help']);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /obk session answer --bots <path> --bot <bot> --session </, `usage lists session answer: ${result.stdout}`);
  });
});
