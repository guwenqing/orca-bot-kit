// Reading what a bot has in its two skills directories, and putting a skill
// where each of the three kinds of entry looks for one.
//
// Two test files link skills into bots — the `skills build` command and the
// commands that link without being asked — and both need the same reading, so
// it lives here rather than twice.
//
// What a link is made of is read through `lstat`/`readlink`/`realpath` rather
// than through the kit's own report: a report that says a skill is linked is
// what a test is trying to check, not what it may believe.

import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, readlink, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';

import { botHomeOf, repoRoot } from './cli.js';

/**
 * Where each harness reads a project's skills from, inside the folder the
 * session starts in: Claude Code `.claude/skills`, Codex `.agents/skills`, and
 * symlinked skill folders are followed on both (tech notes, sections 2 and 3).
 */
export const SKILL_DIRS = {
  claude: path.join('.claude', 'skills'),
  codex: path.join('.agents', 'skills'),
};

/** The harnesses, so a check that must hold on both says so once. */
export const HARNESSES = Object.keys(SKILL_DIRS);

/** One harness's skills directory inside a bot home. */
export const skillsDirOf = (bots, bot, harness) => path.join(botHomeOf(bots, bot), SKILL_DIRS[harness]);

/**
 * What one harness's skills directory holds, by name:
 * `{ at, link, target, resolved }`. `target` is what a link says and
 * `resolved` where it lands, or null for a link that lands nowhere. A bot with
 * no such directory holds nothing, which is not an error.
 */
export async function heldBy(bots, bot, harness) {
  const dir = skillsDirOf(bots, bot, harness);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return new Map();
    throw error;
  }
  return new Map(await Promise.all(entries.map(async (entry) => {
    const at = path.join(dir, entry.name);
    return [entry.name, {
      at,
      link: entry.isSymbolicLink(),
      target: entry.isSymbolicLink() ? await readlink(at) : undefined,
      resolved: await realpath(at).then((found) => found, () => null),
    }];
  })));
}

/** The names one harness would find, in order. */
export const namesIn = async (bots, bot, harness) => [...(await heldBy(bots, bot, harness)).keys()].sort();

/**
 * The skill both harnesses read at `name` is a link to `dir`. A link, not a
 * copy (ADR 0004): what the harness loads is the skill directory itself, so an
 * edit to it is what the running session reads.
 */
export async function assertLinked(bots, bot, name, dir) {
  const want = await realpath(dir);
  for (const harness of HARNESSES) {
    const held = (await heldBy(bots, bot, harness)).get(name);
    assert.ok(
      held !== undefined,
      `${bot} should read ${name} from its ${SKILL_DIRS[harness]}, which holds: ${(await namesIn(bots, bot, harness)).join(', ') || 'nothing'}`,
    );
    assert.ok(held.link, `${SKILL_DIRS[harness]}/${name} should be a symlink to the skill, and is not`);
    assert.equal(
      held.resolved,
      want,
      `${SKILL_DIRS[harness]}/${name} should point at ${dir}, and points at ${held.target}`,
    );
  }
}

/** Neither harness has anything at `name`. */
export async function assertNotThere(bots, bot, name) {
  for (const harness of HARNESSES) {
    assert.equal(
      (await heldBy(bots, bot, harness)).get(name),
      undefined,
      `${SKILL_DIRS[harness]}/${name} should not be there any more`,
    );
  }
}

/** A skill directory anywhere on disk: the folder, and the SKILL.md that makes it one. */
export async function writeSkill(dir, { description, body = 'Do the thing, then say what happened.' } = {}) {
  const name = path.basename(dir);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description ?? `What ${name} is for.`}\n---\n\n${body}\n`,
  );
  return dir;
}

/** A skill in the user's own common folder, `<bots>/skills/<name>`. */
export const commonSkill = (bots, name, options) => writeSkill(path.join(bots, 'skills', name), options);

/** One of the kit's own skills, as the package ships it. */
export async function kitSkill(name) {
  const dir = path.join(repoRoot, 'skills', name);
  const there = await readFile(path.join(dir, 'SKILL.md'), 'utf8').then(() => true, () => false);
  assert.ok(there, `the kit should ship a skill called ${name}`);
  return dir;
}

/** The SKILL.md of a skill, read through one harness's link to it. */
export const readThrough = (bots, bot, harness, name) =>
  readFile(path.join(skillsDirOf(bots, bot, harness), name, 'SKILL.md'), 'utf8');

/** A bots folder's `defaults.yaml`, and a bot's `bot.yaml`. */
export const defaultsOf = (bots) => path.join(bots, 'defaults.yaml');
export const botYamlOf = (bots, bot) => path.join(botHomeOf(bots, bot), 'bot.yaml');

/** Add names to the `skills:` list of a `defaults.yaml` or a `bot.yaml`. */
export async function addSkills(file, ...names) {
  const doc = parse(await readFile(file, 'utf8')) ?? {};
  await setSkills(file, ...(doc.skills ?? []), ...names);
}

/** Say what the `skills:` list is, which is how a test takes a name out of one. */
export async function setSkills(file, ...names) {
  const doc = parse(await readFile(file, 'utf8')) ?? {};
  doc.skills = names;
  await writeFile(file, stringify(doc));
}

/** The answer of a `--json` run, parsed, with the list every skills answer carries. */
export function answerOf(result) {
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  assert.ok(Array.isArray(answer.skills), `the answer should carry a list of skills entries, got: ${result.stdout}`);
  return answer;
}

/** The one entry about one bot. */
export function entryOf(answer, bot) {
  const found = answer.skills.filter((entry) => entry.bot === bot);
  assert.equal(found.length, 1, `one entry should be about ${bot}, got: ${JSON.stringify(answer.skills)}`);
  return found[0];
}

/** The bots an answer reported, in the order it reported them. */
export const botsIn = (answer) => answer.skills.map((entry) => entry.bot);

/** What one bot's entry says about one skill, named once however the entry is laid out. */
export function skillIn(entry, name) {
  const found = (entry.skills ?? []).filter((skill) => skill.name === name);
  assert.equal(found.length, 1, `${entry.bot} should say one thing about ${name}, got: ${JSON.stringify(entry.skills)}`);
  return found[0];
}

/** The names one bot's entry carries, in the order it carries them. */
export const skillNamesIn = (entry) => (entry.skills ?? []).map((skill) => skill.name);

/** The lines of a plain report that mention a word: the entry about it, however it is laid out. */
export function linesAbout(stdout, word) {
  const lines = stdout.split('\n').filter((line) => line.includes(word));
  assert.notEqual(lines.length, 0, `the report should say something about ${word}, got:\n${stdout}`);
  return lines.join('\n');
}
