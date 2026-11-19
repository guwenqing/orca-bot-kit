// #824: the charter `obk init` gives Bot Father names each of its skills, at
// the step where that skill applies.
//
// `obk init` puts four kit management skills on Bot Father's `skills:` list
// (test/init-bot-father-skills.test.js holds the list and the links). On
// Claude Code a session loads a skill when the text where its work starts
// names the skill at that step, and seldom from the skill listing alone. So a
// skill on the list that no text names is a skill the session seldom uses.
//
// What is held here, each test tagged with the point of the issue it covers:
//
//   C1. On each harness, every skill on Bot Father's list is named in the
//       charter as the session reads it: the `## Charter` section of
//       CLAUDE.md for Claude Code, and of AGENTS.md for Codex and Pi (tech
//       notes, "Which instruction file Pi and Codex read (#751)").
//   C2. Every skill that charter names is on the list, and is a skill the kit
//       ships.
//   C3. Each skill is named at its own step, not in one general order to use
//       them all. A step is read as a sentence (see `stepsIn`); that is a
//       proxy, and it cannot say whether the step is the right one for the
//       skill. What it does say: no sentence names every skill on the list,
//       and each skill is named in a sentence that names at most one other.
//   C4. The charter names none of the utilities that run only when someone
//       asks for them.
//
//   C5 (a Bot Father bot.yaml that is already there keeps its charter on a
//   second init) is held elsewhere and not repeated here:
//   test/init-idempotence.test.js "a second init keeps the user's edits" and
//   "a second init leaves alone a Bot Father bot.yaml the user edited ...",
//   test/init-completes-bot-yaml.test.js "completing a bot.yaml keeps
//   everything the user wrote", and test/init-bot-father-skills.test.js
//   "R4 a second init leaves the list as it is ..." (bot.yaml byte for byte)
//   and "R4 a Bot Father that predates this keeps the list it has" (an older
//   charter that names no skill is kept).
//
// Every run is in the sandbox (helpers/cli.js) with a fake Orca, and a fake
// Pi (helpers/pi.js) for the Pi fleet. The expected names come from the issue,
// never from src/.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import { botHomeOf, createSandbox } from './helpers/cli.js';
import { fakePi } from './helpers/pi.js';
import { botYamlOf, kitSkill, MANAGEMENT_SKILLS as MANAGEMENT } from './helpers/skills.js';

/**
 * The file each harness reads as the bot's instructions, in the folder its
 * session starts in. Claude Code reads CLAUDE.md (a file the kit builds from
 * AGENTS.md, or a link to it); Codex and Pi read AGENTS.md and never a
 * CLAUDE.md beside it.
 */
const READS = { claude: 'CLAUDE.md', codex: 'AGENTS.md', pi: 'AGENTS.md' };

/** The kit's utilities that run only when someone asks for them (#824, point 4). */
const ON_REQUEST = ['obk-handoff', 'obk-recall', 'obk-teach', 'obk-why'];

/** A bots folder `obk init --harness <harness>` made. */
async function seeded(box, harness) {
  if (harness === 'pi') await fakePi(box);
  const result = await box.run(['init', '--bots', 'bots', '--harness', harness]);
  assert.equal(result.code, 0, `init --harness ${harness} should succeed:\n${result.stdout}${result.stderr}`);
  return box.path('bots');
}

/**
 * The skill names on Bot Father's `skills:` list, without the `kit:` source,
 * in name order. The list is held to the four of the issue first, so a check
 * against it cannot pass because the list is empty.
 */
async function listedSkills(bots) {
  const text = await readFile(botYamlOf(bots, 'bot-father'), 'utf8');
  const listed = (parse(text)?.skills ?? []).map((entry) => String(entry).replace(/^kit:/, '')).sort();
  assert.deepEqual(listed, MANAGEMENT, `Bot Father's list should be the four management skills, got:\n${text}`);
  return listed;
}

/**
 * The charter as the session on `harness` reads it: the `## Charter` section
 * of that harness's file, up to the next `## ` heading or the kit's end
 * marker. It must hold the charter bot.yaml says, so that what is read here is
 * the charter and not some other text.
 */
async function charterAsRead(bots, harness) {
  const file = path.join(botHomeOf(bots, 'bot-father'), READS[harness]);
  const text = await readFile(file, 'utf8');
  const start = text.indexOf('\n## Charter\n');
  assert.notEqual(start, -1, `${READS[harness]} should have a "## Charter" section, got:\n${text}`);
  const rest = text.slice(start + '\n## Charter\n'.length);
  const end = rest.search(/^(## |<!-- obk:rules end)/m);
  const section = end === -1 ? rest : rest.slice(0, end);

  const charter = parse(await readFile(botYamlOf(bots, 'bot-father'), 'utf8'))?.charter;
  assert.equal(typeof charter, 'string', 'Bot Father\'s bot.yaml should have a charter');
  assert.ok(
    section.includes(charter.trim()),
    `the charter in ${READS[harness]} should be the charter bot.yaml says.\n--- bot.yaml ---\n${charter}\n--- ${READS[harness]} ---\n${section}`,
  );
  return section;
}

/**
 * Every kit skill name in a text, in name order: a word that starts `obk-`,
 * with no letter, digit or dash just before it. The sandbox's own paths are
 * taken out first: the sandbox lives under a temporary folder called
 * `obk-<something>`, and that is a folder, not a skill.
 */
const skillsNamedIn = (text, box) => [
  ...new Set(
    text
      .replaceAll(box.root, ' ')
      .match(/(?<![A-Za-z0-9-])obk-[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [],
  ),
].sort();

/**
 * The steps of a charter, read as its sentences: the text is cut at a blank
 * line, and after a `.`, `!`, `?` or `;` that has white space after it. A list
 * of names with no full stop between them stays one step.
 */
const stepsIn = (text) => text
  .split(/\n\s*\n/)
  .flatMap((paragraph) => paragraph.replace(/\s+/g, ' ').split(/(?<=[.!?;])\s+/))
  .map((step) => step.trim())
  .filter((step) => step !== '');

for (const harness of Object.keys(READS)) {
  test(`#824 C1 on ${harness}, every skill on Bot Father's list is named in the charter its session reads`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box, harness);

    const listed = await listedSkills(bots);
    const charter = await charterAsRead(bots, harness);
    const named = skillsNamedIn(charter, box);

    const unnamed = listed.filter((name) => !named.includes(name));
    assert.deepEqual(
      unnamed,
      [],
      `on ${harness}, Bot Father's list holds skills its charter (${READS[harness]}) never names: `
      + `${unnamed.join(', ')}. The charter names: ${named.join(', ') || 'nothing'}.\n--- charter ---\n${charter}`,
    );
  });

  test(`#824 C2 on ${harness}, every skill the charter names is on Bot Father's list and ships with the kit`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box, harness);

    const listed = await listedSkills(bots);
    const charter = await charterAsRead(bots, harness);
    const named = skillsNamedIn(charter, box);

    // Not a rule of its own: a note that the relation below says something
    // only while the charter names skills at all. C1 is what asks for them.
    assert.ok(named.length > 0, `the charter names no kit skill, so this test proves nothing yet.\n--- charter ---\n${charter}`);
    for (const name of named) {
      assert.ok(
        listed.includes(name),
        `the charter tells Bot Father to use ${name}, and its list holds only ${listed.join(', ')}`,
      );
      await kitSkill(name);
    }
  });

  test(`#824 C3 on ${harness}, each skill is named at its own step, not in one order to use them all`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box, harness);

    const listed = await listedSkills(bots);
    const steps = stepsIn(await charterAsRead(bots, harness));
    const namedAt = steps.map((step) => ({ step, names: skillsNamedIn(step, box).filter((name) => listed.includes(name)) }));
    const show = namedAt.filter((one) => one.names.length > 0).map((one) => `  [${one.names.join(', ')}] ${one.step}`).join('\n')
      || '  (no step names a skill)';

    const general = namedAt.filter((one) => listed.every((name) => one.names.includes(name)));
    assert.deepEqual(
      general.map((one) => one.step),
      [],
      `one step of the charter names every skill on the list, which is a general order, not a step:\n${show}`,
    );
    for (const name of listed) {
      const own = namedAt.filter((one) => one.names.includes(name) && one.names.length <= 2);
      assert.ok(
        own.length > 0,
        `${name} should be named at a step of its own (a sentence that names at most one other skill), `
        + `and no such step names it. The steps that name skills:\n${show}`,
      );
    }
  });

  test(`#824 C4 on ${harness}, the charter names none of the utilities that run only when asked`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box, harness);

    // The names are real kit skills, so this cannot pass on a name that no
    // longer exists.
    for (const name of ON_REQUEST) await kitSkill(name);
    const listed = await listedSkills(bots);
    const charter = await charterAsRead(bots, harness);
    const named = skillsNamedIn(charter, box);

    // The contrast: the same reading finds the skills the charter does name,
    // so an empty reading cannot pass for "names no utility".
    assert.ok(
      named.some((name) => listed.includes(name)),
      `the charter should name Bot Father's own skills, and names: ${named.join(', ') || 'nothing'}.\n--- charter ---\n${charter}`,
    );
    assert.deepEqual(
      named.filter((name) => ON_REQUEST.includes(name)),
      [],
      `the charter should not name a utility that runs only when someone asks.\n--- charter ---\n${charter}`,
    );
  });
}
