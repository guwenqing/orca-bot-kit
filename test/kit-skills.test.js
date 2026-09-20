// The kit's own skills: the directories under skills/ that the package ships and
// that later slices symlink into a bot's .claude/skills and .agents/skills
// (ADR 0009, tech notes 4). A SKILL.md with the wrong shape silently fails to
// load in one or both harnesses, and a skill left out of `files` exists in the
// repo and nowhere a user installs it — both are cheap to catch here and
// expensive to find on someone else's machine.

import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import { repoRoot } from './helpers/cli.js';

const skillsDir = path.join(repoRoot, 'skills');

/** An Agent Skills name: lowercase letters, digits and single inner hyphens. */
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_NAME = 64;

/** Every kit skill carries the prefix, so none of them can shadow anything. */
const PREFIX = 'obk-';

/** Claude Code's built-in commands: a user skill of that name replaces one, silently. */
const BUILT_IN = ['debug', 'design', 'review', 'simplify', 'run', 'verify', 'loop'];

/** The only frontmatter both harnesses read; anything else does nothing, or does it on one. */
const KEYS = ['description', 'name'];

const MAX_LINE = 100;

/** Everything in skills/, whatever it is: the shape test needs to see the strays too. */
async function entries() {
  try {
    return await readdir(skillsDir, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return assert.fail('the kit ships its skills in skills/ at the repo root, and that directory does not exist');
  }
}

/** Every skill directory: where it is, the name the directory gives it, and its markdown. */
async function skills() {
  const dirs = (await entries()).filter((entry) => entry.isDirectory());
  return Promise.all(dirs.map(async (entry) => {
    const dir = path.join(skillsDir, entry.name);
    const names = (await readdir(dir, { recursive: true })).filter((name) => name.endsWith('.md')).sort();
    const files = await Promise.all(names.map(async (name) => ({
      file: path.posix.join('skills', entry.name, ...name.split(path.sep)),
      abs: path.join(dir, name),
      text: await readFile(path.join(dir, name), 'utf8'),
    })));
    return { dir, name: entry.name, files, skill: files.find((file) => file.abs === path.join(dir, 'SKILL.md')) };
  }));
}

/** The SKILL.md of every skill, with the file that is missing named rather than crashed on. */
async function manifests() {
  return (await skills()).map((skill) => {
    assert.ok(skill.skill !== undefined, `skills/${skill.name} has no SKILL.md; a skill is its SKILL.md`);
    return { ...skill.skill, skill };
  });
}

/**
 * One SKILL.md split into the two things a harness reads: the parsed frontmatter
 * and the body after it. A file that is not a delimited YAML document fails
 * here, once, in whichever test asked for it.
 */
function parts(manifest) {
  const match = /^---\n([\s\S]*?)\n---(?:\n([\s\S]*))?$/.exec(manifest.text);
  assert.ok(match !== null, `${manifest.file} should begin with YAML frontmatter: a line ---, the keys, then a line ---`);
  try {
    return { data: parse(match[1]), body: match[2] ?? '' };
  } catch (error) {
    return assert.fail(`${manifest.file}: the frontmatter is not valid YAML: ${error.message}`);
  }
}

/** The targets of the inline markdown links in a file, without the titles. */
const linksIn = (text) => [...text.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((match) => match[1]);

const exists = (file) => stat(file).then(() => true, () => false);

test('skills/ holds one directory per skill and nothing else', async () => {
  const all = await entries();
  assert.ok(all.length > 0, 'skills/ should hold the kit skills, and it is empty');

  const strays = all.filter((entry) => !entry.isDirectory()).map((entry) => entry.name);
  assert.deepEqual(strays, [], `skills/ should hold only skill directories, one per skill; found: ${strays.join(', ')}`);
});

test('every skill carries the two frontmatter keys both harnesses read', async () => {
  for (const manifest of await manifests()) {
    const { data } = parts(manifest);

    assert.deepEqual(
      Object.keys(data ?? {}).sort(),
      KEYS,
      `${manifest.file} should carry exactly name and description; anything else is ignored on one harness and changes behaviour on the other`,
    );

    const name = data.name;
    assert.equal(name, manifest.skill.name, `${manifest.file}: name should be the directory name, got ${JSON.stringify(name)}`);
    assert.match(
      String(name),
      NAME,
      `${manifest.file}: name ${JSON.stringify(name)} should be lowercase letters, digits and single inner hyphens`,
    );
    assert.ok(
      String(name).length <= MAX_NAME,
      `${manifest.file}: name ${JSON.stringify(name)} is ${String(name).length} characters, over the ${MAX_NAME} a skill name may take`,
    );
    assert.ok(
      String(name).startsWith(PREFIX),
      `${manifest.file}: a kit skill is named ${PREFIX}<name>, got ${JSON.stringify(name)}`,
    );
    assert.ok(
      !BUILT_IN.includes(String(name)),
      `${manifest.file}: ${JSON.stringify(name)} is a Claude Code built-in command, and a skill of that name replaces it silently`,
    );

    assert.equal(typeof data.description, 'string', `${manifest.file}: description should be a string, got ${JSON.stringify(data.description)}`);
    assert.ok(
      data.description.trim() !== '' && !data.description.includes('\n'),
      `${manifest.file}: description is what a harness reads to decide whether to load the skill, so it should be a non-empty single line, got ${JSON.stringify(data.description)}`,
    );
  }
});

test('every skill has a body', async () => {
  // The frontmatter gets the skill loaded; the body is the skill.
  for (const manifest of await manifests()) {
    const { body } = parts(manifest);
    assert.notEqual(body.trim(), '', `${manifest.file} has nothing after the frontmatter; a skill is its body`);
  }
});

test('a skill links only to files inside its own directory, and they are there', async () => {
  // A skill is installed alone, by a symlink to its directory: a link that
  // leaves the directory, or names a file that is not there, is a dead end on
  // the bot's disk even though it resolves in the repo.
  for (const skill of await skills()) {
    for (const file of skill.files) {
      for (const link of linksIn(file.text)) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(link) || link.startsWith('#')) continue;

        assert.ok(
          !link.startsWith('/'),
          `${file.file}: the link ${JSON.stringify(link)} is absolute; a skill's links are relative to the file`,
        );

        const target = path.resolve(path.dirname(file.abs), link.split('#')[0]);
        assert.ok(
          target === skill.dir || target.startsWith(`${skill.dir}${path.sep}`),
          `${file.file}: the link ${JSON.stringify(link)} leaves skills/${skill.name}, which is all a bot gets when the skill is installed`,
        );
        assert.ok(
          await exists(target),
          `${file.file}: the link ${JSON.stringify(link)} points at a file that does not exist`,
        );
      }
    }
  }
});

test('every line in a skill file stays inside 100 columns', async () => {
  // The skills are hard-wrapped like the rest of the repo's markdown, so a long
  // line is a line that got away, not a style choice.
  for (const skill of await skills()) {
    for (const file of skill.files) {
      const long = file.text.split('\n')
        .map((line, at) => ({ at: at + 1, line }))
        .filter((entry) => entry.line.length > MAX_LINE);

      assert.deepEqual(
        long.map((entry) => `${file.file}:${entry.at} (${entry.line.length})`),
        [],
        `no line in a skill may run past ${MAX_LINE} characters`,
      );
    }
  }
});

test('the published package ships the skills directory', async () => {
  // Left out of `files`, the skills exist in the repo and nowhere a user installs.
  const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));

  assert.ok(
    pkg.files.some((entry) => entry.replace(/\/$/, '') === 'skills'),
    `package.json files should include the skills directory, got: ${pkg.files.join(', ')}`,
  );
});
