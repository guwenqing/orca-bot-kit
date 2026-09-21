// `obk groom --bots <path> [--at <HH:MM>] [--on | --off]`: the daily grooming
// automation, created, read and switched.
//
// Grooming is the optional daily pass that reads what the bots have been doing,
// works out what it cost, and tells Bot Father. It is woken by an Orca
// automation rather than by a tab of the kit's, because an Orca automation
// cannot wake a tab the kit made: `--reuse-session` only reuses a session the
// automation itself started (tech notes, section 1).
//
// It runs in Bot Father's Orca project, because that is where its rules and
// skills are, and the kit knows that project from Bot Father's book.
//
// Two things decide almost every test here:
//
//   1. **Orca does not deduplicate an automation by name.** The same `--name`
//      against the same workspace twice gives two automations, both listed and
//      both schedulable, measured live on this machine. So running this command
//      twice must leave exactly one grooming automation, and that is the kit's
//      doing and nothing else's. A user who ends up with two is groomed twice a
//      day for ever.
//   2. **It is created off.** It spends tokens every day, so it waits for one
//      explicit yes after a run the user has read.
//
// With no flag beyond `--bots` it only says what there is, and creates nothing.

import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import {
  assertCleanFailure,
  assertOrcaCallsAllowed,
  bookOf,
  botHomeOf,
  createSandbox,
  orcaCallsOf,
  orcaCommand,
  orcaFlag,
} from './helpers/cli.js';

/** A bots folder with Bot Father up in Orca, which is the whole setup this needs. */
async function seeded(box, harness = 'claude') {
  const result = await box.run(['init', '--bots', 'bots', '--harness', harness]);
  assert.equal(result.code, 0, result.stderr);
  return box.path('bots');
}

/** Every automation Orca has now, in the order it made them. */
const automationsIn = async (box) => (await box.orca.state()).automations ?? [];

/** The one automation Orca has, when the point of the test is that there is one. */
async function theAutomation(box) {
  const all = await automationsIn(box);
  assert.equal(all.length, 1, `Orca should hold exactly one automation, got: ${JSON.stringify(all)}`);
  return all[0];
}

/** Run the command and answer what it said as JSON. */
async function groom(box, ...rest) {
  const result = await box.run(['groom', '--bots', 'bots', ...rest, '--json']);
  assert.equal(result.code, 0, `groom should have answered: ${result.stderr}`);
  assert.equal(result.stderr, '');
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  assert.ok(
    answer.groom !== null && typeof answer.groom === 'object',
    `the answer should say what the grooming is, got: ${result.stdout}`,
  );
  return answer;
}

/** Every Orca call of one command since the run started, or since a mark. */
const callsOf = async (box, command, from = 0) =>
  orcaCallsOf((await box.orca.calls()).slice(from), command);

/** How many Orca calls have been made, as a mark to count from. */
const mark = async (box) => (await box.orca.calls()).length;

/** Bot Father's book, and a way to put a changed one back. */
const bookIn = async (bots) => parse(await readFile(bookOf(bots), 'utf8'));
const putBook = (bots, book) => writeFile(bookOf(bots), stringify(book));

/**
 * An automation of the user's own in Bot Father's project: something they set
 * up themselves, which the kit must find beside and never touch. Its name is
 * nothing like whatever the kit calls its own.
 */
async function theirOwnAutomation(box, bots) {
  const home = botHomeOf(bots);
  const setup = (await box.orca.setups()).find((one) => one.path === home);
  assert.ok(setup, `Bot Father should have an Orca project, got: ${JSON.stringify(await box.orca.setups())}`);
  const theirs = {
    id: 'auto_theirs',
    name: 'my own nightly note to self',
    enabled: true,
    rrule: 'FREQ=DAILY;BYHOUR=2;BYMINUTE=0',
    provider: 'claude',
    prompt: 'Write me a note about yesterday.',
    runContext: { path: home, projectId: setup.projectId, projectHostSetupId: setup.id },
  };
  await box.orca.set({ automations: [...(await automationsIn(box)), theirs] });
  return theirs;
}

// ------------------------------------------------------------------ the tests

test('G1 with nothing but --bots it says there is no grooming, and creates none', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  const from = await mark(box);

  const answer = await groom(box);

  assert.equal(answer.groom.exists, false, 'nothing has been set up yet');
  assert.deepEqual(await automationsIn(box), [], 'and reading must not create one');
  assert.deepEqual(await callsOf(box, 'automations create', from), [], 'nothing was created');
});

test('G2 --at creates the daily grooming, off, in Bot Father\'s Orca project', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box, 'claude');
  const home = botHomeOf(bots);
  const setup = (await box.orca.setups()).find((one) => one.path === home);
  const from = await mark(box);

  const answer = await groom(box, '--at', '04:00');

  const automation = await theAutomation(box);
  assert.equal(automation.enabled, false, 'it spends tokens every day, so it waits for an explicit yes');
  assert.equal(automation.rrule, 'FREQ=DAILY;BYHOUR=4;BYMINUTE=0', 'daily, at the time asked for');
  assert.equal(automation.runContext.path, home, 'in Bot Father\'s folder, where its rules and skills are');
  assert.equal(automation.runContext.projectId, setup.projectId);

  assert.equal(answer.groom.exists, true);
  assert.equal(answer.groom.enabled, false);
  assert.equal(answer.groom.at, '04:00');
  assert.equal(answer.groom.id, automation.id, 'and the answer names the one Orca made');

  const created = await callsOf(box, 'automations create', from);
  assert.equal(created.length, 1, `one create, got: ${JSON.stringify(created)}`);
  assert.equal(orcaFlag(created[0], '--trigger'), 'daily');
  assert.equal(orcaFlag(created[0], '--time'), '04:00');
  assert.equal(orcaFlag(created[0], '--workspace'), `path:${home}`);
  assert.equal(orcaFlag(created[0], '--workspace-mode'), 'existing');
  assert.ok(created[0].args.includes('--disabled'), `it is created off, got: ${created[0].args.join(' ')}`);
  assert.notEqual((orcaFlag(created[0], '--name') ?? '').trim(), '', 'it is given a name of its own');
  assert.notEqual((orcaFlag(created[0], '--prompt') ?? '').trim(), '', 'and a prompt to run');
});

test('G2 the automation runs on Bot Father\'s harness', async (t) => {
  const box = await createSandbox(t);
  const codex = await createSandbox(t);
  await seeded(box, 'claude');
  await seeded(codex, 'codex');

  await groom(box, '--at', '04:00');
  await groom(codex, '--at', '04:00');

  assert.equal(orcaFlag((await callsOf(box, 'automations create'))[0], '--provider'), 'claude');
  assert.equal(orcaFlag((await callsOf(codex, 'automations create'))[0], '--provider'), 'codex');
});

test('G3 running it twice leaves exactly one grooming automation', async (t) => {
  // The one that matters most. Orca will happily make a second automation with
  // the same name against the same workspace, so nothing but the kit stops the
  // user being groomed twice a day for ever.
  const box = await createSandbox(t);
  await seeded(box);

  const first = await groom(box, '--at', '04:00');
  const second = await groom(box, '--at', '04:00');

  const automation = await theAutomation(box);
  assert.equal(first.groom.id, automation.id);
  assert.equal(second.groom.id, automation.id, 'the second run found the first one rather than making another');
  assert.equal((await callsOf(box, 'automations create')).length, 1, 'and only ever created once');
  assert.ok(
    (await callsOf(box, 'automations list')).length >= 1,
    'which it can only know by asking Orca what is there',
  );
});

test('G3 it finds its own beside the user\'s automations, and leaves theirs alone', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const theirs = await theirOwnAutomation(box, bots);

  const first = await groom(box, '--at', '04:00');
  const second = await groom(box, '--at', '04:00');

  const all = await automationsIn(box);
  assert.equal(all.length, 2, `theirs and one of ours, got: ${JSON.stringify(all)}`);
  assert.deepEqual(
    all.find((one) => one.id === theirs.id),
    theirs,
    'the user\'s own automation is untouched, down to the time it runs and whether it is on',
  );
  assert.notEqual(first.groom.id, theirs.id, 'the kit must not adopt an automation it did not make');
  assert.equal(second.groom.id, first.groom.id);
});

test('G4 --on turns it on and --off turns it back off', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  await groom(box, '--at', '04:00');
  const id = (await theAutomation(box)).id;
  const from = await mark(box);

  const on = await groom(box, '--on');
  const wasOn = (await theAutomation(box)).enabled;
  const off = await groom(box, '--off');

  assert.equal(wasOn, true, 'Orca has it on');
  assert.equal(on.groom.enabled, true, 'and the answer says so');
  assert.equal((await theAutomation(box)).enabled, false, '--off puts it back');
  assert.equal(off.groom.enabled, false);
  assert.deepEqual(await callsOf(box, 'automations create', from), [], 'switching one makes no new one');
  for (const call of await callsOf(box, 'automations edit', from)) {
    assert.equal(orcaFlag(call, '--id'), id, 'every edit names the automation the kit made');
  }
});

test('G4 --at and --on together create it and turn it on in one command', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);

  const answer = await groom(box, '--at', '05:15', '--on');

  const automation = await theAutomation(box);
  assert.equal(automation.enabled, true, 'the user asked for both, so both happened');
  assert.equal(automation.rrule, 'FREQ=DAILY;BYHOUR=5;BYMINUTE=15');
  assert.equal(answer.groom.enabled, true);
  assert.equal(answer.groom.at, '05:15');
});

test('G5 --at on one that exists changes that one rather than adding another', async (t) => {
  // Orca refuses `--time` on an edit unless `--trigger` or `--schedule` comes
  // with it, so this also proves the kit sends the pair.
  const box = await createSandbox(t);
  await seeded(box);
  await groom(box, '--at', '04:00');
  const id = (await theAutomation(box)).id;
  const from = await mark(box);

  const answer = await groom(box, '--at', '06:30');

  const automation = await theAutomation(box);
  assert.equal(automation.id, id, 'the same automation, moved');
  assert.equal(automation.rrule, 'FREQ=DAILY;BYHOUR=6;BYMINUTE=30');
  assert.equal(answer.groom.at, '06:30');
  assert.deepEqual(await callsOf(box, 'automations create', from), [], 'and no second one was made');
});

test('G5 changing the time leaves it as off as it was', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  await groom(box, '--at', '04:00');

  const answer = await groom(box, '--at', '06:30');

  assert.equal((await theAutomation(box)).enabled, false, 'moving it is not a yes to running it');
  assert.equal(answer.groom.enabled, false);
});

test('G6 it reports what Orca says now, not what the kit last asked for', async (t) => {
  // The user can move it or switch it in Orca's own interface. What the command
  // prints has to be what is there.
  const box = await createSandbox(t);
  await seeded(box);
  await groom(box, '--at', '04:00');
  const automation = await theAutomation(box);
  await box.orca.set({
    automations: [{ ...automation, enabled: true, rrule: 'FREQ=DAILY;BYHOUR=7;BYMINUTE=5' }],
  });

  const answer = await groom(box);

  assert.equal(answer.groom.exists, true);
  assert.equal(answer.groom.at, '07:05', 'read back out of Orca\'s own recurrence');
  assert.equal(answer.groom.enabled, true);
});

test('G7 a time that is not a time is refused, and nothing is created or changed', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  await groom(box, '--at', '04:00');
  const before = await automationsIn(box);
  const from = await mark(box);

  for (const wrong of ['25:00', '04:60', '9', 'teatime', '']) {
    const result = await box.run(['groom', '--bots', 'bots', '--at', wrong]);

    assertCleanFailure(result);
    assert.ok(
      result.stderr.includes('--at'),
      `the refusal should name the flag that was wrong, got: ${result.stderr}`,
    );
  }
  assert.deepEqual(await automationsIn(box), before, 'a refused run changes nothing in Orca');
  assert.deepEqual(await callsOf(box, 'automations create', from), []);
  assert.deepEqual(await callsOf(box, 'automations edit', from), []);
});

test('G7 --on and --off together is refused, and nothing is changed', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  await groom(box, '--at', '04:00');
  const before = await automationsIn(box);
  const from = await mark(box);

  const result = await box.run(['groom', '--bots', 'bots', '--on', '--off']);

  assertCleanFailure(result);
  for (const flag of ['--on', '--off']) {
    assert.ok(result.stderr.includes(flag), `the refusal should name both, got: ${result.stderr}`);
  }
  assert.deepEqual(await automationsIn(box), before, 'it is still exactly as off as it was');
  assert.deepEqual(await callsOf(box, 'automations edit', from), []);
});

test('G8 a bots folder with no Bot Father is refused, and nothing is created', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await rm(botHomeOf(bots), { recursive: true, force: true });
  const from = await mark(box);

  const result = await box.run(['groom', '--bots', 'bots', '--at', '04:00']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('bot-father'), `the refusal should name what is missing, got: ${result.stderr}`);
  assert.deepEqual(await callsOf(box, 'automations create', from), []);
});

test('G8 a Bot Father never brought up in Orca is refused: there is no project to attach to', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  // The book as it stands before anything has been opened in Orca: it knows the
  // sessions and no Orca project at all.
  const book = await bookIn(bots);
  await putBook(bots, { ...book, orca: {} });
  const from = await mark(box);

  const result = await box.run(['groom', '--bots', 'bots', '--at', '04:00']);

  assertCleanFailure(result);
  assert.ok(
    /bot-father|obk up/i.test(result.stderr),
    `the refusal should say whose project is missing or how to make it, got: ${result.stderr}`,
  );
  assert.deepEqual(await callsOf(box, 'automations create', from), [], 'nothing is attached to nothing');
});

test('G9 groom refuses when Orca is not answering, and stops asking it for things', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  await box.orca.set({ reachable: false });
  const from = await mark(box);

  const result = await box.run(['groom', '--bots', 'bots', '--at', '04:00']);

  assertCleanFailure(result);
  assert.match(result.stderr, /orca/i, `the message should name Orca, got: ${result.stderr}`);
  assert.deepEqual(
    (await box.orca.calls()).slice(from).map(orcaCommand),
    ['status'],
    'once Orca is out, the kit must stop asking it for things',
  );
});

test('G9 groom without --bots is refused and says so', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['groom']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('--bots'), `should name --bots, got: ${result.stderr}`);
});

test('G10 every Orca call groom makes is one it is allowed to make, and it touches no tab', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  const from = await mark(box);

  await groom(box, '--at', '04:00');
  await groom(box, '--on');
  await groom(box);

  const calls = (await box.orca.calls()).slice(from);
  assertOrcaCallsAllowed(calls);
  assert.deepEqual(
    [...new Set(calls.map(orcaCommand))].filter((command) => command.startsWith('terminal')),
    [],
    'grooming is an automation, not a tab: it opens none, types in none and closes none',
  );
});

test('G10 --json answers with bots as the resolved absolute path', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);

  const answer = await groom(box);

  assert.equal(answer.bots, bots, '--bots was given as a relative path and comes back resolved');
  assert.equal(path.isAbsolute(answer.bots), true);
});

test('G10 the plain report says when it runs and whether it is on', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);

  await groom(box, '--at', '06:30');
  const whileOff = await box.run(['groom', '--bots', 'bots']);
  await groom(box, '--on');
  const whileOn = await box.run(['groom', '--bots', 'bots']);

  assert.equal(whileOff.code, 0, whileOff.stderr);
  assert.equal(whileOn.code, 0, whileOn.stderr);
  assert.ok(whileOff.stdout.includes('06:30'), `the report should say when it runs, got:\n${whileOff.stdout}`);
  assert.match(whileOff.stdout, /\boff\b/i, `and that it is off, got:\n${whileOff.stdout}`);
  assert.ok(!/\boff\b/i.test(whileOn.stdout), `and not say off once it is on, got:\n${whileOn.stdout}`);
  for (const report of [whileOff.stdout, whileOn.stdout]) {
    assert.ok(!report.includes('undefined'), `nothing should be undefined, got:\n${report}`);
  }
});

test('G10 the plain report says plainly when there is no grooming yet', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);

  const result = await box.run(['groom', '--bots', 'bots']);

  assert.equal(result.code, 0, result.stderr);
  assert.notEqual(result.stdout.trim(), '', 'it answers rather than saying nothing at all');
  assert.ok(!result.stdout.includes('undefined'), `nothing should be undefined, got:\n${result.stdout}`);
  assert.deepEqual(await automationsIn(box), [], 'and it still created nothing');
});
