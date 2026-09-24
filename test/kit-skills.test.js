// The kit's own skills: the directories under skills/ that the package ships and
// that later slices symlink into a bot's .claude/skills and .agents/skills
// (ADR 0009, tech notes 4). A SKILL.md with the wrong shape silently fails to
// load in one or both harnesses, and a skill left out of `files` exists in the
// repo and nowhere a user installs it — both are cheap to catch here and
// expensive to find on someone else's machine.

import assert from 'node:assert/strict';
import { readFile, readdir, readlink, realpath, stat } from 'node:fs/promises';
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

/**
 * Where the kit's own skills are loaded from while the kit is built: one
 * directory per harness, each holding a link per skill (AGENTS.md). Both are
 * checked in, so a clone gets what is tested here.
 */
const LINK_DIRS = ['.claude/skills', '.agents/skills'];

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

/**
 * A file without its fenced code blocks: markdown renders no links inside one,
 * so a link there is text for the reader to copy, not a link in the skill. A
 * fence closes on a line of its own character at least as long; one left open
 * runs to the end of the file.
 */
function outsideFences(text) {
  let fence = null;
  return text.split('\n').filter((line) => {
    if (fence === null) {
      const open = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/.exec(line);
      if (open) fence = open[1];
      return !open;
    }
    if (new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*$`).test(line)) fence = null;
    return false;
  }).join('\n');
}

/** The targets of the inline markdown links in a file, outside code blocks, without the titles. */
const linksIn = (text) => [...outsideFences(text).matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)]
  .map((match) => match[1]);

const exists = (file) => stat(file).then(() => true, () => false);

/** What one harness's skills directory holds, links and strays alike. */
async function linkEntries(dir) {
  try {
    return await readdir(path.join(repoRoot, dir), { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return assert.fail(`${dir} should hold a link to every kit skill, and that directory does not exist`);
  }
}

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

test('every skill is linked into both harness skill directories, and nothing else is', async () => {
  // A skill nobody linked is in the repo, reads fine, and loads in neither
  // harness; a link left behind by a skill that went, or one that resolves to
  // another skill, looks right and is worse, because it loads nothing or the
  // wrong thing. Both directions are one check: the names in each directory are
  // the names in skills/, and each link lands on the skill it is named after.
  // Both directories are reported together, so one run says all of what to fix.
  const names = (await skills()).map((skill) => skill.name).sort();
  const found = new Map();
  for (const dir of LINK_DIRS) found.set(dir, await linkEntries(dir));

  assert.deepEqual(
    Object.fromEntries([...found].map(([dir, entries]) => [dir, entries.map((entry) => entry.name).sort()])),
    Object.fromEntries(LINK_DIRS.map((dir) => [dir, names])),
    'each harness skills directory should hold one link per skill directory, named after it, and nothing else',
  );

  const astray = [];
  for (const [dir, entries] of found) {
    for (const entry of entries) {
      const link = path.join(repoRoot, dir, entry.name);
      const skill = await realpath(path.join(skillsDir, entry.name));
      if (!entry.isSymbolicLink()) {
        astray.push(`${dir}/${entry.name} is not a link`);
      } else if (await realpath(link).catch(() => null) !== skill) {
        astray.push(`${dir}/${entry.name} -> ${await readlink(link)}`);
      }
    }
  }

  assert.deepEqual(astray, [], 'each link should be a symlink resolving to the skill of its own name under skills/');
});

test('the published package ships the skills directory', async () => {
  // Left out of `files`, the skills exist in the repo and nowhere a user installs.
  const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));

  assert.ok(
    pkg.files.some((entry) => entry.replace(/\/$/, '') === 'skills'),
    `package.json files should include the skills directory, got: ${pkg.files.join(', ')}`,
  );
});
