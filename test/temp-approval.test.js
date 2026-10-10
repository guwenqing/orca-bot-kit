// How wide an approval a temporary session may be made at (#527).
//
// `temp make --approval <level>` is refused when the level is wider than the
// maker's own approval (ask < auto < dangerously-skip; a session with no
// approval set is auto), unless the bot's `temp_approval` is that wide or
// wider: the widest a temp may take is the wider of the maker's own and
// `temp_approval`. A refusal names `obk permission approval --temps` and makes
// nothing. A temp made with no `--approval` still takes its maker's.
//
// The maker's approval and `temp_approval` are set here by hand in bot.yaml,
// as a user editing the file would, so these tests read `temp make` alone; one
// test sets `temp_approval` through `obk permission approval --temps`.
//
// Every run is in the sandbox (helpers/cli.js): its own HOME, a fake Orca, and
// fake harnesses on its own PATH.

import assert from 'node:assert/strict';
import test from 'node:test';

import { assertRefused, createSandbox, orcaCallsOf } from './helpers/cli.js';
import {
  BOT,
  editBotYaml,
  liveTab,
  made,
  make,
  settingsOf,
  TASK,
  world,
} from './helpers/temp-roles.js';

/**
 * Bot Father, and temp-bot (Claude) with one long-lived session, lead, brought
 * up. lead's approval is `approval` (none at all when undefined), and the
 * bot's temp_approval is `temps` (none when undefined), both written by hand.
 */
async function fleet(box, { approval, temps } = {}) {
  const ok = async (args) => {
    const result = await box.run(args);
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  };
  await ok(['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  await ok(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'lead', '--prompt', 'You lead the work on the API.']);
  const bots = box.path('bots');
  await editBotYaml(bots, (doc) => {
    const lead = doc.sessions.find((one) => one.name === 'lead');
    if (approval === undefined) delete lead.approval;
    else lead.approval = approval;
    if (temps !== undefined) doc.temp_approval = temps;
    return doc;
  });
  await ok(['up', '--bots', 'bots', '--bot', BOT]);
  return { bots, lead: await liveTab(box, bots, 'lead') };
}

/** A make that is refused, names the road, and makes nothing. */
async function assertWidthRefused(box, bots, lead, level) {
  const before = await world(box, bots);
  const from = (await box.orca.calls()).length;

  const result = await make(box, lead, ['--name', 'scout', '--prompt', TASK, '--approval', level]);

  assertRefused(result, 'permission approval', '--temps');
  assert.deepEqual(await world(box, bots), before, 'bot.yaml, the book and Orca are as they were');
  assert.deepEqual(orcaCallsOf((await box.orca.calls()).slice(from), 'terminal create'), [], 'no tab was opened');
}

/** A make that goes through, and the temp's approval in bot.yaml. */
async function madeAt(box, bots, lead, args) {
  await made(box, lead, ['--name', 'scout', '--prompt', TASK, ...args]);
  return (await settingsOf(bots, 'scout')).approval;
}

// ----------------------------------------------------------------- wider than the maker's: refused

for (const [maker, level] of [
  ['ask', 'auto'],
  ['ask', 'dangerously-skip'],
  ['auto', 'dangerously-skip'],
  [undefined, 'dangerously-skip'],
]) {
  test(`TA1 a maker at ${maker ?? 'no approval (auto)'} asking for ${level} is refused, names obk permission approval --temps, and makes nothing`, async (t) => {
    const box = await createSandbox(t);
    const { bots, lead } = await fleet(box, { approval: maker });

    await assertWidthRefused(box, bots, lead, level);
  });
}

// ----------------------------------------------------------------- as wide or narrower: made

for (const [maker, level] of [
  ['ask', 'ask'],
  ['auto', 'auto'],
  ['auto', 'ask'],
  [undefined, 'auto'],
  [undefined, 'ask'],
  ['dangerously-skip', 'dangerously-skip'],
  ['dangerously-skip', 'auto'],
]) {
  test(`TA2 a maker at ${maker ?? 'no approval (auto)'} makes a temp at ${level}`, async (t) => {
    const box = await createSandbox(t);
    const { bots, lead } = await fleet(box, { approval: maker });

    assert.equal(await madeAt(box, bots, lead, ['--approval', level]), level);
  });
}

// ----------------------------------------------------------------- temp_approval widens it

for (const [maker, temps, level] of [
  ['ask', 'auto', 'auto'],
  ['ask', 'dangerously-skip', 'dangerously-skip'],
  ['auto', 'dangerously-skip', 'dangerously-skip'],
  [undefined, 'dangerously-skip', 'dangerously-skip'],
  ['auto', 'ask', 'auto'],
]) {
  test(`TA3 a maker at ${maker ?? 'no approval (auto)'} with temp_approval ${temps} makes a temp at ${level}`, async (t) => {
    const box = await createSandbox(t);
    const { bots, lead } = await fleet(box, { approval: maker, temps });

    assert.equal(await madeAt(box, bots, lead, ['--approval', level]), level);
  });
}

for (const [maker, temps, level] of [
  ['ask', 'auto', 'dangerously-skip'],
  ['auto', 'ask', 'dangerously-skip'],
  ['ask', 'ask', 'auto'],
]) {
  test(`TA3 a maker at ${maker} with temp_approval ${temps} asking for ${level}, wider than both, is refused`, async (t) => {
    const box = await createSandbox(t);
    const { bots, lead } = await fleet(box, { approval: maker, temps });

    await assertWidthRefused(box, bots, lead, level);
  });
}

test('TA3 temp_approval set by obk permission approval --temps lets a maker make a temp wider than its own', async (t) => {
  const box = await createSandbox(t);
  const { bots, lead } = await fleet(box, { approval: 'ask' });
  await assertWidthRefused(box, bots, lead, 'dangerously-skip');

  const set = await box.run(['permission', 'approval', '--bots', 'bots', '--bot', BOT, '--temps', '--approval', 'dangerously-skip']);
  assert.equal(set.code, 0, `${set.stdout}${set.stderr}`);

  assert.equal(await madeAt(box, bots, lead, ['--approval', 'dangerously-skip']), 'dangerously-skip');
});

// ----------------------------------------------------------------- no --approval: the maker's

for (const [maker, temps] of [['ask', 'dangerously-skip'], ['dangerously-skip', undefined], ['ask', undefined]]) {
  test(`TA4 a temp made with no --approval takes its maker's ${maker}, whatever temp_approval says (${temps ?? 'none'})`, async (t) => {
    const box = await createSandbox(t);
    const { bots, lead } = await fleet(box, { approval: maker, temps });

    assert.equal(await madeAt(box, bots, lead, []), maker);
  });
}
