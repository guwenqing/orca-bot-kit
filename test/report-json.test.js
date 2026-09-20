// What `init` and `up` report back. The caller is an LLM running a setup step:
// once the tabs exist it looks at the daily tab itself and answers whatever the
// harness or the shell is asking. To do that it needs the handles, so the two
// commands take `--json` and answer with the facts about every tab — the ones
// this run made and the ones it found already there.
//
// `tabs` lists every tab of Bot Father's Orca project. `name` is the session's
// name for a tab the book knows, and `null` for every tab it does not — the
// plain shell tab included, on the run that made it and on every run after,
// because the kit cannot tell its own plain tab from one the user opened.
//
// `harnessStarted` is a checked fact, not an intention: the run typed the
// harness into the tab it made and then asked Orca whether a TUI had come up.
// It is false for every tab this run did not create, because the kit did not
// type into those and did not look.
//
// The shape asserted here:
//
//   { "tabs": [ { "bot": "bot-father", "name": "daily",
//                 "title": "Bot Father daily", "tabId": "...",
//                 "terminal": "term_...", "created": true,
//                 "harnessStarted": true }, ... ] }
//
// Without --json the same facts are printed as plain lines.

import assert from 'node:assert/strict';
import test from 'node:test';

import { assertCleanFailure, BARE_LAUNCH, createSandbox, TAB_TITLES } from './helpers/cli.js';

/** The answer of a run that was asked for JSON: parsed, and nothing but JSON on the way out. */
function answerOf(result) {
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  assert.ok(Array.isArray(answer.tabs), `the answer should carry a list of tabs, got: ${result.stdout}`);
  return answer;
}

/** The entry for one tab, by the name it has in the book — `null` for a tab the book does not know. */
function tab(answer, name) {
  const found = answer.tabs.filter((entry) => entry.name === name);
  assert.equal(found.length, 1, `one entry should be the ${name} tab, got: ${JSON.stringify(answer.tabs)}`);
  return found[0];
}

/** The names the run reported, in a stable order, with the nameless ones as null. */
const namesIn = (answer) => answer.tabs.map((entry) => entry.name).sort();

test('init --json answers with every tab of the project, as Orca really made them', async (t) => {
  const box = await createSandbox(t);

  const answer = answerOf(await box.run(['init', '--bots', 'bots', '--harness', 'claude', '--json']));

  // The session is named; the plain tab is not, because the kit keeps nothing
  // about it and could not tell it from a tab the user opened.
  assert.deepEqual(namesIn(answer), ['daily', null]);

  const terminals = await box.orca.terminals();
  for (const [name, title] of [['daily', TAB_TITLES.daily], [null, TAB_TITLES.ops]]) {
    const entry = tab(answer, name);
    const real = terminals.find((terminal) => terminal.title === title);
    assert.equal(entry.bot, 'bot-father');
    assert.equal(entry.title, title, 'the title is there to read either way');
    assert.equal(entry.tabId, real.tabId, `the ${title} tab id should be the one Orca gave`);
    assert.equal(entry.terminal, real.handle, `the ${title} handle should be the one Orca gave`);
    assert.equal(entry.created, true, 'this run made both tabs');
  }
  assert.equal(tab(answer, 'daily').harnessStarted, true);
  assert.equal(tab(answer, null).harnessStarted, false, 'nothing is typed into a plain shell');
});

test('up --json answers about the tabs it found, not only the ones it made', async (t) => {
  const box = await createSandbox(t);
  const first = answerOf(await box.run(['init', '--bots', 'bots', '--harness', 'codex', '--json']));

  const answer = answerOf(await box.run(['up', '--bots', 'bots', '--json']));

  assert.deepEqual(namesIn(answer), ['daily', null]);
  for (const name of ['daily', null]) {
    assert.equal(tab(answer, name).tabId, tab(first, name).tabId, 'the same tabs, with the ids they had');
    assert.equal(tab(answer, name).terminal, tab(first, name).terminal);
    assert.equal(tab(answer, name).created, false, 'this run made nothing');
    assert.equal(tab(answer, name).harnessStarted, false, 'this run typed into nothing and looked at nothing');
  }
});

test('a tab that came back is reported as made, beside the one that was found', async (t) => {
  const box = await createSandbox(t);
  const first = answerOf(await box.run(['init', '--bots', 'bots', '--harness', 'claude', '--json']));
  const daily = tab(first, 'daily');
  await box.orca.set({
    terminals: (await box.orca.terminals()).filter((terminal) => terminal.tabId !== daily.tabId),
  });

  const answer = answerOf(await box.run(['up', '--bots', 'bots', '--json']));

  assert.equal(tab(answer, 'daily').created, true);
  assert.equal(tab(answer, 'daily').harnessStarted, true);
  assert.notEqual(tab(answer, 'daily').tabId, daily.tabId, 'a tab that comes back is a new tab');
  assert.equal(tab(answer, null).created, false);
  assert.equal(tab(answer, null).tabId, tab(first, null).tabId);
});

test('a harness on its trust question is started, and carries Orca\'s own words through', async (t) => {
  // What the live check hits on the first run of every new bot: the harness is
  // up and asking whether it may work in this folder. The kit passes Orca's
  // reason on for the caller to act on; it does not read it itself.
  const box = await createSandbox(t);
  await box.orca.set({ waitIdle: 'blocked' });

  const answer = answerOf(await box.run(['init', '--bots', 'bots', '--harness', 'claude', '--json']));

  const daily = tab(answer, 'daily');
  assert.equal(daily.harnessStarted, true, 'a TUI that is up is a harness that started');
  assert.equal(daily.blockedReason, 'agent-interactive-prompt');
  assert.equal('blockedReason' in tab(answer, null), false, 'nothing was started in the plain tab');
});

test('an entry carries no blockedReason when Orca gave none', async (t) => {
  const box = await createSandbox(t);

  const answer = answerOf(await box.run(['init', '--bots', 'bots', '--harness', 'claude', '--json']));

  for (const entry of answer.tabs) {
    assert.equal('blockedReason' in entry, false, `nothing to pass on, so no key: ${JSON.stringify(entry)}`);
  }
  assert.equal(tab(answer, 'daily').harnessStarted, true);
});

test('a harness that did not come up says so, and the run still succeeds', async (t) => {
  const box = await createSandbox(t);
  await box.orca.set({ waitIdle: false });

  const answer = answerOf(await box.run(['init', '--bots', 'bots', '--harness', 'claude', '--json']));

  assert.equal(tab(answer, 'daily').created, true);
  assert.equal(tab(answer, 'daily').harnessStarted, false, 'no TUI came up in the tab');
  assert.equal('blockedReason' in tab(answer, 'daily'), false, 'there was nothing on screen to report');
  // The caller needs the handle to go and look at that tab itself.
  const real = (await box.orca.terminals()).find((terminal) => terminal.title === TAB_TITLES.daily);
  assert.equal(tab(answer, 'daily').terminal, real.handle);
  assert.deepEqual(
    real.typed,
    [{ text: BARE_LAUNCH.claude, enter: true }],
    'the line was typed; only the outcome was missing',
  );
});

test('without --json the same facts are printed as plain lines', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assert.equal(result.code, 0, result.stderr);
  assert.throws(() => JSON.parse(result.stdout), 'plain output is for a person to read');
  for (const terminal of await box.orca.terminals()) {
    assert.ok(result.stdout.includes(terminal.title), `should name ${terminal.title}, got: ${result.stdout}`);
    assert.ok(result.stdout.includes(terminal.tabId), `should name ${terminal.tabId}, got: ${result.stdout}`);
    assert.ok(result.stdout.includes(terminal.handle), `should name ${terminal.handle}, got: ${result.stdout}`);
  }
});

test('--json says nothing on stdout when the run fails', async (t) => {
  const box = await createSandbox(t);
  await box.orca.set({ reachable: false });

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude', '--json']);

  assertCleanFailure(result);
});
