// The fleet and the moves the closed-tab tests share (#733): a bot brought up
// against the fake Orca, a temporary session made from one of its sessions, and
// a close that Orca answers while its listing keeps the tab.
//
// The listing that keeps the tab is the fake's `closeLag`; how the kept row
// looks, `connected` and whether `diagnostics memory` still lists its pty, is
// the fake's `closingAs` (helpers/fake-orca.js).
//
// Every run is in the sandbox (helpers/cli.js): its own HOME, a fake Orca, and
// fake harnesses on its own PATH. Nothing here reaches the real Orca or a real
// harness.

import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';

import { bookIn, botHomeOf, conversationOnRecord, kitLaunchMark, orcaCallsOf, recordSession, sessionIn, tabsOfBot } from './cli.js';

export const BOT = 'api-bot';

/** The task a temporary session is given. */
export const TASK = 'Read the open pull request and write down what it changes.';

/** A listing that never stops listing a closed tab, in the kit's whole wait. */
export const FOREVER = 100000;

/** Bot Father, and api-bot on Claude Code with the sessions named, brought up. Returns the bots folder. */
export async function fleet(box, sessions) {
  const ok = async (args) => {
    const result = await box.run(args);
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  };
  await ok(['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  for (const name of sessions) await ok(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', name]);
  await ok(['up', '--bots', 'bots', '--bot', BOT]);
  return box.path('bots');
}

/** The tab the book gives a session, as the fake Orca has it. */
export async function liveTab(box, bots, name) {
  const entry = await sessionIn(bots, BOT, name);
  assert.equal(typeof entry?.tab, 'string', `the book should hold a tab for ${name}, got: ${JSON.stringify(entry)}`);
  const terminal = (await tabsOfBot(box, bots, BOT)).find((one) => one.tabId === entry.tab);
  assert.ok(terminal, `Orca should have ${name}'s tab ${entry.tab}`);
  return terminal;
}

/**
 * Tell the book which conversation a session runs, the way the kit's hook does,
 * and leave that conversation on Claude Code's own record: what a restart or an
 * unpause resumes.
 */
export async function reported(box, bots, terminal, session) {
  const ran = await recordSession(box, { bots, bot: BOT, tab: terminal.tabId, session });
  assert.equal(ran.code, 0, `the hook should record ${session}: ${ran.stderr}`);
  await conversationOnRecord(box, { harness: 'claude', cwd: botHomeOf(bots, BOT), id: session });
}

/** The environment of a command a session's harness runs in `terminal`. */
export const inTab = (box, terminal) => ({ ...box.env, ORCA_TERMINAL_HANDLE: terminal.handle, ORCA_TAB_ID: terminal.tabId, ...kitLaunchMark(box, terminal) });

/** `obk temp make` from `maker`'s tab, which must work. */
export async function tempMade(box, bots, maker, name) {
  const result = await box.run(['temp', 'make', '--bots', 'bots', '--name', name, '--prompt', TASK], { env: inTab(box, await liveTab(box, bots, maker)) });
  assert.equal(result.code, 0, `obk temp make --name ${name}: ${result.stdout}${result.stderr}`);
  return liveTab(box, bots, name);
}

/** `obk temp retire --name <name>` from `maker`'s tab. */
export async function tempRetire(box, bots, maker, name) {
  return box.run(['temp', 'retire', '--bots', 'bots', '--name', name], { env: inTab(box, await liveTab(box, bots, maker)) });
}

/** `obk retire --bot api-bot ...`, from outside any tab. */
export const retire = (box, ...rest) => box.run(['retire', '--bots', 'bots', '--bot', BOT, ...rest]);

/**
 * From now on a closed tab stays in Orca's listing for the whole of the kit's
 * wait, looking as `closingAs` says (left out, as the fake always kept one).
 */
export async function closesLinger(box, closingAs) {
  await box.orca.set({ closeLag: FOREVER, ...(closingAs === undefined ? {} : { closingAs }) });
}

/**
 * Orca refuses both forms of the close of this one tab, `--tab` and without
 * it, in words that name no session (the fake's `refuseClose`). The code is
 * the one the review of PR #740 reproduced; not a refusal seen live.
 */
export async function closeRefused(box, handle) {
  const refusal = { code: 'permission_denied', message: 'the close was refused' };
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((one) => (one.handle === handle ? { ...one, refuseClose: { tab: refusal, pane: refusal } } : one)),
  });
}

/** How many calls the fake Orca has had so far. */
export const callCount = async (box) => (await box.orca.calls()).length;

/** The handles of the `terminal close` calls made after the first `from` calls. */
export const closedSince = async (box, from) => orcaCallsOf((await box.orca.calls()).slice(from), 'terminal close')
  .map((call) => call.args[call.args.indexOf('--terminal') + 1]);

/** The `terminal create` calls made after the first `from` calls. */
export const createdSince = async (box, from) => orcaCallsOf((await box.orca.calls()).slice(from), 'terminal create');

/** The session names in api-bot's bot.yaml. */
export const namesInBotYaml = async (bots) => (parse(await readFile(path.join(botHomeOf(bots, BOT), 'bot.yaml'), 'utf8')).sessions ?? []).map((one) => one?.name);

/** One session retired as a retire does it: off bot.yaml, off the book's live list, and on its retired list once. */
export async function assertRetired(bots, name) {
  assert.ok(!(await namesInBotYaml(bots)).includes(name), `${name} should be off bot.yaml`);
  const book = await bookIn(bots, BOT);
  assert.equal(book.sessions?.[name], undefined, `${name} should be off the book's live list, got: ${JSON.stringify(book.sessions)}`);
  assert.equal((book.retired ?? []).filter((one) => one?.name === name).length, 1, `${name} should be on the book's retired list once, got: ${JSON.stringify(book.retired)}`);
}

/** One session not retired at all: still in bot.yaml, still on the book's live list with its tab, and not on its retired list. */
export async function assertNotRetired(bots, name, tabId) {
  assert.ok((await namesInBotYaml(bots)).includes(name), `${name} should still be in bot.yaml`);
  const book = await bookIn(bots, BOT);
  assert.equal(book.sessions?.[name]?.tab, tabId, `${name} should still be on the book's live list with its tab, got: ${JSON.stringify(book.sessions)}`);
  assert.equal((book.retired ?? []).some((one) => one?.name === name), false, `${name} should not be on the book's retired list, got: ${JSON.stringify(book.retired)}`);
}

export const exists = (file) => stat(file).then(() => true, () => false);

/** Where a retired bot's folder goes. */
export const retiredHome = (bots) => path.join(bots, 'retired', BOT);

/**
 * A refusal that names the tab it waits on: exit 1, no crash, nothing on
 * stdout, and the tab id in the message.
 */
export function assertWaitRefusal(result, tabId) {
  assert.equal(result.code, 1, `this should have been refused, got exit ${result.code}:\n${result.stdout}${result.stderr}`);
  assert.equal(result.stdout, '', `a refusal prints nothing on stdout, got: ${result.stdout}`);
  assert.ok(!/^\s+at /m.test(result.stderr), `expected a message, got a crash:\n${result.stderr}`);
  assert.ok(result.stderr.includes(tabId), `the refusal should name the tab it is waiting on, ${tabId}, got: ${result.stderr}`);
}
