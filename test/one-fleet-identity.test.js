// One fleet has one identity, whatever spelling of its path a command was given
// (#164). A bots folder reached through a link is the same fleet as the folder
// itself, so the things the kit keeps beside it — the skill-source clones, the
// start-prompt files — are the same things through either spelling, and a pin
// set through one holds through the other.
//
// `init` is the exception only until the folder exists: it may be given a path
// that is not there yet, and its refusals name what the user gave it (pinned in
// init-bots-link.test.js). Once the folder is there, it is the fleet's folder too.
//
// What is printed is not pinned here: which spelling a command reports back is
// not the point. What is on disk and in the user's own skills.yaml is.

import assert from 'node:assert/strict';
import { readdir, stat, symlink } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createSandbox } from './helpers/cli.js';
import { answerOf as skillsAnswerOf, assertLinked, entryOf } from './helpers/skills.js';
import {
  answerOf,
  cloneOf,
  commitIn,
  putSkills,
  repoAt,
  shaIn,
  sourceEntryIn,
  sourceIn,
} from './helpers/sources.js';

const SOURCE = 'someones-skills';
const SKILL = 'their-skill';

/**
 * A bots folder `init` made at `bots`, and a second way in to it: `linked-bots`,
 * a link to it. Answers the folder itself.
 */
async function fleetWithTwoNames(box) {
  const made = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(made.code, 0, made.stderr);
  await symlink(box.path('bots'), box.path('linked-bots'));
  return box.path('bots');
}

/** A source repository on `main` with one commit. Answers the dir and that commit. */
async function origin(box) {
  const dir = path.join(box.root, 'their-repo');
  await repoAt(dir);
  await putSkills(dir, { [SKILL]: 'Version one.' });
  return { dir, first: await commitIn(dir, 'the first version') };
}

/** Run a command and require it to work. */
async function ok(box, args) {
  const result = await box.run(args);
  assert.equal(result.code, 0, `obk ${args.join(' ')} should have worked, got: ${result.stderr}${result.stdout}`);
  return result;
}

/** The kit's folders beside the bots folder whose names end in `suffix`. */
const siblings = async (box, suffix) => (await readdir(box.cwd)).filter((name) => name.endsWith(suffix)).sort();

const isThere = (target) => stat(target).then(() => true, () => false);

test('a pin moved by update through one spelling is not put back by fetch through the other', async (t) => {
  // The reviewer's reproduction. `update` is the user asking for the newer
  // version and recording it; a `fetch` afterwards must leave that alone,
  // whichever name for the folder it was given.
  const box = await createSandbox(t);
  const bots = await fleetWithTwoNames(box);
  const made = await origin(box);
  await ok(box, ['source', 'add', '--bots', 'linked-bots', '--name', SOURCE, '--repo', made.dir, '--ref', 'main']);
  await ok(box, ['skills', 'fetch', '--bots', 'linked-bots']);
  assert.equal((await sourceEntryIn(bots, SOURCE)).sha, made.first, 'the first fetch pins the first commit');

  await putSkills(made.dir, { [SKILL]: 'Version two.' });
  const second = await commitIn(made.dir, 'the second version');
  await ok(box, ['skills', 'update', '--bots', 'bots']);
  assert.equal((await sourceEntryIn(bots, SOURCE)).sha, second, 'update moves the pin to what main names now');

  await ok(box, ['skills', 'fetch', '--bots', 'linked-bots']);

  assert.equal((await sourceEntryIn(bots, SOURCE)).sha, second, 'fetch leaves the pin where update put it');
  assert.equal(await shaIn(cloneOf(bots, SOURCE)), second, 'and the clone is at the pinned version');
  assert.deepEqual(await siblings(box, '.skill-sources'), ['bots.skill-sources'], 'one clone folder, beside the real folder');
});

test('a source fetched through the link is already there when fetched through the folder', async (t) => {
  // One clone for one fleet: the second fetch finds the first one's clone and
  // leaves it, rather than cloning again beside the other name.
  const box = await createSandbox(t);
  const bots = await fleetWithTwoNames(box);
  const made = await origin(box);
  await ok(box, ['source', 'add', '--bots', 'bots', '--name', SOURCE, '--repo', made.dir, '--ref', 'main']);
  await ok(box, ['skills', 'fetch', '--bots', 'linked-bots']);

  const again = await ok(box, ['skills', 'fetch', '--bots', 'bots', '--json']);

  assert.equal(sourceIn(answerOf(again), SOURCE).state, 'there', 'the clone the link made is this fleet\'s clone');
  assert.equal(await shaIn(cloneOf(bots, SOURCE)), made.first);
  assert.deepEqual(await siblings(box, '.skill-sources'), ['bots.skill-sources'], 'and no second folder beside the link');
});

test('a start-prompt file written through the folder is the one retire through the link deletes', async (t) => {
  // `up` leaves a long duty in `<bots>.prompts`; retiring the session deletes
  // it. Done through the two names, both have to mean the one folder, or the
  // file outlives its session beside a name retire never looked at.
  const box = await createSandbox(t);
  await fleetWithTwoNames(box);
  await ok(box, ['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude']);
  await ok(box, ['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily',
    '--prompt', 'Watch the queue and say what you see. '.repeat(10)]);
  await ok(box, ['up', '--bots', 'bots', '--bot', 'api-bot']);
  const prompt = path.join(box.path('bots.prompts'), 'api-bot.daily.txt');
  assert.equal(await isThere(prompt), true, 'up left the duty in a file beside the folder');

  await ok(box, ['retire', '--bots', 'linked-bots', '--bot', 'api-bot', '--session', 'daily']);

  assert.equal(await isThere(prompt), false, 'retire through the link deletes the file the session was handed');
  assert.deepEqual(await siblings(box, '.prompts'), ['bots.prompts'], 'and made no prompts folder beside the link');
});

test('init through the link links a source skill fetched through the folder', async (t) => {
  // init on a folder that is already there brings Bot Father up, and that links
  // the skills bot.yaml names — a source skill among them. The clone it links
  // from is the fleet's one clone, whichever name the fetch was given.
  const box = await createSandbox(t);
  const bots = await fleetWithTwoNames(box);
  const made = await origin(box);
  await ok(box, ['source', 'add', '--bots', 'linked-bots', '--name', SOURCE, '--repo', made.dir, '--ref', 'main']);
  await ok(box, ['skills', 'fetch', '--bots', 'linked-bots']);
  await ok(box, ['skills', 'add', '--bots', 'linked-bots', '--bot', 'bot-father', '--skill', `${SOURCE}:${SKILL}`]);

  const result = await ok(box, ['init', '--bots', 'linked-bots', '--harness', 'claude', '--json']);

  const entry = entryOf(skillsAnswerOf(result), 'bot-father');
  assert.equal(entry.trouble, undefined, `Bot Father's skills should link without trouble, got: ${entry.trouble}`);
  await assertLinked(bots, 'bot-father', SKILL, path.join(cloneOf(bots, SOURCE), SKILL));
});
