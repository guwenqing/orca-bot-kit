// `obk retire --bots <path> --bot <bot>` on the two Orcas its project delete
// meets (#528). Both are read in Orca's code, not seen live, and modelled in
// helpers/fake-orca.js:
//
//   - Orca's next release (commit cb69d52455, stablyai/orca#27172, in no tag
//     yet) refuses `project setup-delete` of a project that still has live
//     terminals or saved workspace details, unless `--force` is given. A project
//     with a workspace normally has saved details even with every tab closed,
//     so a plain delete of a bot's project is refused there (`deleteGuard`).
//   - Orca 1.4.223, installed now, does not take `--force` on that command: its
//     CLI refuses the unknown flag and changes nothing, and the same delete
//     without it goes ahead (`forceUnknown`).
//
// On both, retiring a bot removes its project and finishes. The care stays as
// it is: the kit deletes only its own project, only after it has closed the
// tabs the book names, and not at all when the project holds a tab the book
// does not name (RB5 in retire.test.js, whose `deletes` counts every
// `setup-delete` call, with any flags). A refusal that is not the old CLI's
// unknown flag is reported in Orca's own words, and the bot stays. A session's
// retirement and `obk temp retire` delete no project (RS1 in retire.test.js,
// TR1 in temp-sessions.test.js).

import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  botHomeOf,
  createSandbox,
  orcaCallsOf,
  orcaFlag,
  recordSession,
  sessionIn,
  tabsOfBot,
} from './helpers/cli.js';

/** What the fake Orca is set to for each of the two Orcas. */
const GUARDED = { deleteGuard: { workspaces: 1 } };
const OLD_CLI = { forceUnknown: true };
const ORCAS = [
  { label: 'the Orca that guards the delete, with saved details for the bot\'s workspace', orca: GUARDED },
  {
    label: 'the Orca that guards the delete, still counting a terminal of the bot\'s project open after the closes',
    orca: { deleteGuard: { workspaces: 0, terminals: 1 } },
  },
  { label: 'the Orca that guards the delete, with both', orca: { deleteGuard: { workspaces: 1, terminals: 1 } } },
  { label: 'Orca 1.4.223, whose CLI refuses --force as an unknown flag', orca: OLD_CLI },
];

/** A bots folder with Bot Father and an api-bot carrying the sessions given, both up. */
async function botRunning(box, sessions = ['daily']) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude'])).code, 0);
  for (const name of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', name]);
    assert.equal(added.code, 0, added.stderr);
  }
  const brought = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);
  assert.equal(brought.code, 0, brought.stderr);
  const bots = box.path('bots');
  const tabs = {};
  for (const name of sessions) {
    const entry = await sessionIn(bots, 'api-bot', name);
    assert.equal(typeof entry?.tab, 'string', `the book should hold a tab for ${name}, got: ${JSON.stringify(entry)}`);
    const terminal = (await tabsOfBot(box, bots, 'api-bot')).find((one) => one.tabId === entry.tab);
    assert.ok(terminal, `Orca should have ${name}'s tab ${entry.tab}`);
    await recordSession(box, { bots, bot: 'api-bot', tab: entry.tab, session: `sess-${name}` });
    tabs[name] = { tabId: entry.tab, handle: terminal.handle };
  }
  const home = botHomeOf(bots, 'api-bot');
  const [setup] = (await box.orca.setups()).filter((one) => one.path === home);
  assert.ok(setup, 'up should have made the bot an Orca project');
  return { bots, home, setup, tabs, retired: path.join(bots, 'retired', 'api-bot') };
}

const callCount = async (box) => (await box.orca.calls()).length;
const since = async (box, from) => (await box.orca.calls()).slice(from);
const closes = (calls) => orcaCallsOf(calls, 'terminal close');
const deletes = (calls) => orcaCallsOf(calls, 'project setup-delete');
const retire = (box, ...rest) => box.run(['retire', '--bots', 'bots', ...rest]);
const exists = (file) => stat(file).then(() => true, () => false);
const saidBy = (result) => `${result.stdout}${result.stderr}`;

for (const { label, orca } of ORCAS) {
  test(`RG1 on ${label}, retire removes the bot's project and finishes`, async (t) => {
    const box = await createSandbox(t);
    const { bots, home, setup, retired } = await botRunning(box);
    await box.orca.set(orca);

    const result = await retire(box, '--bot', 'api-bot');

    assert.equal(result.code, 0, `the retirement finishes, got:\n${saidBy(result)}`);
    assert.ok(result.stdout.split('\n').includes(`removed    Orca project ${setup.id}`), `the project is reported removed, got:\n${saidBy(result)}`);
    assert.doesNotMatch(saidBy(result), /^trouble/m);
    const left = await box.orca.setups();
    assert.equal(left.some((one) => one.id === setup.id || one.path === home), false, `Orca no longer lists the bot's project, got: ${JSON.stringify(left)}`);
    assert.equal(await exists(home), false, 'the bot is gone from bots/');
    assert.ok(await exists(path.join(retired, 'bot.yaml')), 'it is in retired/ now');
    assert.ok(await exists(path.join(retired, 'sessions.yaml')), 'with its book');
    assert.deepEqual(await tabsOfBot(box, bots, 'api-bot'), [], 'and no tab of the bot is left in Orca');
  });

  test(`RG2 on ${label}, every project delete, with --force or without, is of the bot's own project and comes after every tab the book names is closed`, async (t) => {
    const box = await createSandbox(t);
    const { setup, tabs } = await botRunning(box, ['daily', 'review']);
    await box.orca.set(orca);
    const from = await callCount(box);

    const result = await retire(box, '--bot', 'api-bot');

    assert.equal(result.code, 0, saidBy(result));
    const calls = await since(box, from);
    const closed = closes(calls);
    assert.deepEqual(
      closed.map((call) => orcaFlag(call, '--terminal')).sort(),
      [tabs.daily.handle, tabs.review.handle].sort(),
      'both tabs the book names are closed, each by its own handle',
    );
    const deleted = deletes(calls);
    assert.ok(deleted.length > 0, 'the project is deleted');
    const lastClose = Math.max(...closed.map((call) => calls.indexOf(call)));
    for (const call of deleted) {
      const shown = call.args.join(' ');
      assert.equal(orcaFlag(call, '--setup'), setup.id, `orca ${shown}: only the bot's own project`);
      assert.ok(calls.indexOf(call) > lastClose, `orca ${shown}: made before every tab of the bot was closed`);
    }
    for (const call of calls) {
      assert.ok(!call.args.includes('--all'), `orca ${call.args.join(' ')}: --all closes tabs the kit does not own`);
    }
  });
}

// A refusal that is not the old CLI's unknown `--force`. The fake refuses only
// the first delete, so a kit that went on to delete some other way would find
// the second one carried out, and the project gone.
for (const { label, orca } of [
  { label: 'an Orca with no guard', orca: {} },
  { label: 'the Orca that guards the delete', orca: GUARDED },
  { label: 'Orca 1.4.223', orca: OLD_CLI },
]) {
  test(`RG3 on ${label}, a delete refused for another reason is reported in Orca's words, the bot stays, and the delete is not carried out some other way`, async (t) => {
    const box = await createSandbox(t);
    const { home, setup, retired } = await botRunning(box);
    await box.orca.set({
      ...orca,
      fail: { 'project setup-delete': { code: 'runtime_error', message: 'the store is locked', times: 1 } },
    });

    const result = await retire(box, '--bot', 'api-bot');

    assert.equal(result.code, 1, `the retirement stops, got:\n${saidBy(result)}`);
    assert.ok(!/^\s+at /m.test(saidBy(result)), `expected a message, got a crash:\n${saidBy(result)}`);
    assert.ok(saidBy(result).includes('the store is locked'), `Orca's own words, got:\n${saidBy(result)}`);
    assert.ok(!saidBy(result).includes('removed    Orca project'), `nothing is reported removed, got:\n${saidBy(result)}`);
    assert.ok((await box.orca.setups()).some((one) => one.id === setup.id), 'Orca still has the project');
    assert.ok(await exists(path.join(home, 'bot.yaml')), 'the bot is where it was');
    assert.equal(await exists(retired), false, `${retired} should not exist`);
  });
}
