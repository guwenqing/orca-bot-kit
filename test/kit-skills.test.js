// The kit's own skills: the directories under skills/ that the package ships and
// that later slices symlink into a bot's .claude/skills and .agents/skills
// (ADR 0019, tech notes 4). A SKILL.md with the wrong shape silently fails to
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

// ------------------------------------------------------------ a body a session can take in (#802)
//
// The common guidance of Claude Code and the Agent Skills spec: "Keep SKILL.md
// under 500 lines. Move detailed reference material to separate files", and
// "Keep file references one level deep from SKILL.md". So a SKILL.md, its
// frontmatter included, has fewer than 500 lines; and every reference file of a
// skill is linked from that skill's own SKILL.md, so a session reaches it in one
// step from the body. A reference file is any .md in the skill's folder but
// SKILL.md, NOTICE.md and LICENSES.md.

/** Fewer lines than this in a SKILL.md, frontmatter included. */
const MAX_SKILL_LINES = 500;

/** The lines of a file as an editor counts them: a last newline ends a line and starts none. */
const lineCount = (text) => (text === '' ? 0 : text.replace(/\n$/, '').split('\n').length);

/** What is wrong with the length of one SKILL.md, or undefined. */
function lengthTrouble(manifest) {
  const lines = lineCount(manifest.text);
  if (lines < MAX_SKILL_LINES) return undefined;
  return `${manifest.file} has ${lines} lines`;
}

/** The files in a skill's folder that are not reference files, by their path inside it. */
const NOT_REFERENCES = ['SKILL.md', 'NOTICE.md', 'LICENSES.md'];

/** A skill's reference files: each .md in its folder that is not one of NOT_REFERENCES. */
const referencesOf = (skill) => skill.files.filter((file) => !NOT_REFERENCES.includes(path.relative(skill.dir, file.abs)));

/**
 * The reference files of one skill that its SKILL.md does not link to itself,
 * by their `file`. A link from another reference file is two steps from the
 * body, and a link inside a code block is text, so neither one counts.
 */
function unlinkedReferences(skill) {
  const body = skill.files.find((file) => file.abs === path.join(skill.dir, 'SKILL.md'));
  const linked = new Set((body === undefined ? [] : linksIn(body.text))
    .filter((link) => !/^[a-z][a-z0-9+.-]*:/i.test(link) && !link.startsWith('#') && !link.startsWith('/'))
    .map((link) => path.resolve(skill.dir, link.split('#')[0])));
  return referencesOf(skill).filter((file) => !linked.has(file.abs)).map((file) => file.file).sort();
}

test('every SKILL.md has fewer than 500 lines, frontmatter included (#802 R1)', async () => {
  const all = await manifests();
  assert.ok(all.length > 0, 'the kit\'s skills have SKILL.md files to count');

  const long = all.flatMap((manifest) => lengthTrouble(manifest) ?? []);

  assert.deepEqual(long, [], `a SKILL.md should stay under ${MAX_SKILL_LINES} lines; move detail into a reference file it links`);
});

test('the length check counts every line of a SKILL.md, and 500 is one too many (#802 R1)', () => {
  const file = 'skills/obk-x/SKILL.md';
  const lines = (n, end = '\n') => `---\nname: obk-x\ndescription: X.\n---\n${'Text.\n'.repeat(n - 5)}Last.${end}`;

  assert.equal(lengthTrouble({ file, text: lines(499) }), undefined, '499 lines, frontmatter included, is under the bound');
  assert.equal(lengthTrouble({ file, text: lines(499, '') }), undefined, 'a last line without its newline is still one line');
  assert.equal(lengthTrouble({ file, text: lines(500) }), `${file} has 500 lines`, 'the four frontmatter lines count too');
  assert.equal(lengthTrouble({ file, text: lines(500, '') }), `${file} has 500 lines`, 'with or without the last newline');
  assert.equal(lengthTrouble({ file, text: lines(614) }), `${file} has 614 lines`);
});

test('every reference file of a skill is linked from its own SKILL.md (#802 R2)', async () => {
  const all = await skills();
  assert.ok(
    all.some((skill) => referencesOf(skill).length > 0),
    'the kit\'s skills have reference files to check (obk-tdd has mutation-tools.md)',
  );

  const unlinked = all.flatMap(unlinkedReferences);

  assert.deepEqual(unlinked, [], 'each reference file should be one step from the body: a relative link in its skill\'s own SKILL.md');
});

test('the link check finds a reference file nobody links, and one linked only from another reference file (#802 R2)', () => {
  const dir = path.join(path.sep, 'kit', 'skills', 'obk-x');
  const skill = (files) => ({
    dir,
    name: 'obk-x',
    files: Object.entries(files).map(([name, text]) => ({
      file: path.posix.join('skills', 'obk-x', name),
      abs: path.join(dir, ...name.split('/')),
      text,
    })),
  });
  const notice = { 'NOTICE.md': 'Sources.\n', 'LICENSES.md': 'Licences.\n' };

  assert.deepEqual(unlinkedReferences(skill({
    'SKILL.md': 'Read [the tools](tools.md), then [bugs](./bugs.md#a-bug) and [more](deep/more.md "More").\n',
    'tools.md': 'Tools.\n',
    'bugs.md': 'Bugs.\n',
    'deep/more.md': 'More.\n',
    ...notice,
  })), [], 'three reference files, each linked from SKILL.md; NOTICE.md and LICENSES.md need no link');

  assert.deepEqual(unlinkedReferences(skill({
    'SKILL.md': 'Read [the tools](tools.md).\n',
    'tools.md': 'Tools, and then [bugs](bugs.md).\n',
    'bugs.md': 'Bugs.\n',
    'alone.md': 'Nobody links me.\n',
    ...notice,
  })), ['skills/obk-x/alone.md', 'skills/obk-x/bugs.md'], 'one linked from nowhere, one linked only from tools.md');

  assert.deepEqual(unlinkedReferences(skill({
    'SKILL.md': [
      'See [ours](../obk-y/tools.md) and [the web](https://example.com/tools.md).',
      '',
      '```',
      '[tools](tools.md)',
      '```',
      '',
    ].join('\n'),
    'tools.md': 'Tools.\n',
  })), ['skills/obk-x/tools.md'], 'a link to another skill\'s file of that name, a URL, or a link in a code block is not a link to it');

  assert.deepEqual(unlinkedReferences(skill({
    'tools.md': 'Tools.\n',
  })), ['skills/obk-x/tools.md'], 'with no SKILL.md, nothing links the reference file');
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

// ------------------------------------------------------------ the revision of each source (#280)
//
// A NOTICE says what was taken from each source; it also says which revision
// was read, so a later refresh can tell what changed upstream since. Each
// source entry, a `- **…**` bullet anywhere under "# Sources and licences",
// carries lines of its own among its continuation lines, each one of:
//
//   Revision: <owner/repo>@<40-hex commit> (<how>)   a repository source
//   Read: <YYYY-MM-DD> (<how>)                        a page
//   Revision: none (<why>)                            neither: the kit's own
//                                                     earlier skill, a research
//                                                     pack, a built-in behaviour
//
// `<how>` and `<why>` are free text and may wrap onto the entry's next lines.
// An entry has at least one such line, and no more than the sources it names in
// bold: pages read together on one date may share one Read: line. Every
// repository an entry names in bold as `owner/repo` has a Revision: line of its
// own in that entry naming it, so a second repository's commit cannot hide in
// the first one's parentheses (review of PR #446, P2 1).
//
// A repository credited outside any entry, named in bold as `owner/repo` in a
// plain bullet or in prose, needs a Revision: line for it somewhere in the same
// NOTICE, which in practice means an entry of its own (review of PR #446, P2 2).
// A source named only in words, such as "Trail of Bits' skill" or a web site's
// name, cannot be told from the rest of the prose by a pattern; review covers
// those. Which sources are repositories is otherwise the NOTICE's to say, not
// this test's.

const SOURCES_HEADING = /^# Sources and licences\s*$/m;

/**
 * The source entries of a NOTICE's text: each `- **…**` bullet under "# Sources
 * and licences", with its continuation lines (indented, up to a blank line or
 * a line that is not), as `{ name, line, lines }`, `line` its line number in
 * the file, since one NOTICE can name the same source in several entries.
 * `outside` is every other line under the heading, with its line number: what
 * the NOTICE says around its entries.
 */
function sourceEntries(text) {
  const heading = SOURCES_HEADING.exec(text);
  if (heading === null) return Object.assign([], { outside: [] });
  const first = text.slice(0, heading.index).split('\n').length;
  const lines = text.slice(heading.index).split('\n');
  const entries = [];
  const outside = [];
  let current;
  for (const [index, line] of lines.entries()) {
    if (/^- \*\*/.test(line)) {
      const name = /^- \*\*(.+?)\*\*/.exec(line)?.[1] ?? line.slice(4);
      current = { name, line: first + index, lines: [line] };
      entries.push(current);
    } else if (current !== undefined && /^\s+\S/.test(line)) {
      current.lines.push(line);
    } else {
      current = undefined;
      outside.push({ line: first + index, text: line });
    }
  }
  return Object.assign(entries, { outside });
}

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COMMIT = /^[0-9a-f]{40}$/;

/**
 * Every span a text puts in bold, and the repository each names, when it begins
 * with one written `owner/repo` (in backticks or not): `**mattpocock/skills**`,
 * `` **`citypaul/.dotfiles`, `claude/…`** ``. A name that is not in that form,
 * `**Cursor pstack**` or `**The GDS Way**`, names no repository here.
 */
function boldIn(text) {
  return [...text.matchAll(/\*\*(.+?)\*\*/g)].map((match) => ({
    text: match[1],
    repo: /^`?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)`?(?=$|[\s,;:'’`)])/.exec(match[1])?.[1],
  }));
}

/** Whether `text` is a real calendar date written YYYY-MM-DD. */
function isDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

/** What is wrong with one `Revision:` or `Read:` statement, read whole, or undefined; and the repository it names. */
function statementTrouble(said) {
  const read = /^Read: (\S+) \((.+?)\)/.exec(said);
  if (said.startsWith('Read:')) {
    if (read === null) return { trouble: `has a Read: line not in the form "Read: <YYYY-MM-DD> (<how>)": ${said}` };
    if (!isDate(read[1])) return { trouble: `has a Read: line whose date is not a real YYYY-MM-DD: ${read[1]}` };
    if (read[2].trim() === '') return { trouble: 'has a Read: line with nothing said in its parentheses' };
    return {};
  }
  const revision = /^Revision: (\S+) \((.+?)\)/.exec(said);
  if (revision === null) return { trouble: `has a Revision: line not in the form "Revision: <owner/repo>@<commit> (<how>)" or "Revision: none (<why>)": ${said}` };
  if (revision[2].trim() === '') return { trouble: 'has a Revision: line with nothing said in its parentheses' };
  if (revision[1] === 'none') return {};
  const [repo, commit, ...rest] = revision[1].split('@');
  if (rest.length > 0 || commit === undefined) return { trouble: `has a Revision: that is not <owner/repo>@<commit>: ${revision[1]}` };
  if (!REPO.test(repo)) return { trouble: `has a Revision: whose repository is not owner/repo: ${repo}` };
  if (!COMMIT.test(commit)) return { trouble: `has a Revision: whose commit is not a full 40-hex sha: ${commit}` };
  return { repo };
}

/** The repositories named by the Revision: lines anywhere in a NOTICE, lower-cased, as GitHub reads them. */
const revisedIn = (text) => new Set([...text.matchAll(/^\s+Revision: ([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@/gm)].map((match) => match[1].toLowerCase()));

/**
 * What is wrong with one source entry's revisions: each line starting
 * `Revision:` or `Read:` is read with the lines after it, up to the next such
 * line, so that a wrapped `(<how>)` is whole.
 */
function revisionTroubles(entry) {
  const at = entry.lines.flatMap((line, index) => (/^\s+(?:Revision|Read):/.test(line) ? [index] : []));
  if (at.length === 0) return ['has no Revision: or Read: line'];
  const troubles = [];
  const named = new Set();
  at.forEach((from, n) => {
    const said = entry.lines.slice(from, at[n + 1]).join(' ').replace(/\s+/g, ' ').trim();
    const { trouble, repo } = statementTrouble(said);
    if (trouble !== undefined) troubles.push(trouble);
    if (repo !== undefined) named.add(repo.toLowerCase());
  });
  const head = entry.lines.slice(0, at[0]).join('\n');
  const bold = boldIn(head);
  if (at.length > bold.length) {
    troubles.push(`has ${at.length} Revision: or Read: lines for ${bold.length} source${bold.length === 1 ? '' : 's'} named in bold`);
  }
  for (const repo of new Set(bold.flatMap((one) => (one.repo === undefined ? [] : [one.repo])))) {
    if (!named.has(repo.toLowerCase())) troubles.push(`names ${repo} in bold, and has no Revision: line of its own naming it`);
  }
  return troubles;
}

/** Every NOTICE problem, as `<file>:<line>, <entry or repository>: <what>`. */
function noticeTrouble(file, text) {
  const entries = sourceEntries(text);
  const inEntries = entries.flatMap((entry) => revisionTroubles(entry).map((trouble) => `${file}:${entry.line}, ${entry.name}: ${trouble}`));
  const revised = revisedIn(text);
  const credited = entries.outside.flatMap(({ line, text: said }) => boldIn(said)
    .filter((one) => one.repo !== undefined && !revised.has(one.repo.toLowerCase()))
    .map((one) => `${file}:${line}, ${one.repo}: is credited in bold outside any source entry, and this NOTICE has no Revision: line naming it`));
  return [...inEntries, ...credited];
}

test('every source in every skill\'s NOTICE names the revision read: a commit, a date, or none with why (#280)', async () => {
  const notices = (await skills()).flatMap((skill) => skill.files.filter((file) => path.basename(file.abs) === 'NOTICE.md'));
  assert.ok(notices.length > 0, 'the kit\'s skills have NOTICE files to check');

  const trouble = notices.flatMap((notice) => noticeTrouble(notice.file, notice.text));

  assert.deepEqual(trouble, [], 'each source needs a Revision: or Read: line of its own (see the comment above this test)');
});

test('the NOTICE check finds a source with no revision, a short sha, a date that is not one, and more lines than sources (#280)', () => {
  const sha = 'a'.repeat(40);
  const notice = (...entries) => ['# Sources and licences', '', 'From these:', '', ...entries, '', '## Later', '', 'Prose.', ''].join('\n');

  assert.deepEqual(noticeTrouble('N.md', notice(
    '- **mattpocock/skills**, `tdd`: what was taken, over',
    '  two lines.',
    `  Revision: mattpocock/skills@${sha} (reconstructed: the repo's head when this`,
    '  notice was written, 2026-09-20; the revision read was not recorded)',
    '- **A blog post**, "Its title".',
    '  Read: 2026-09-20 (read by)',
    '- **The research pack**, our own notes.',
    '  Revision: none (a research pack of our own, not a repository)',
  )), [], 'three good entries, one with its reason wrapped');

  assert.deepEqual(noticeTrouble('N.md', notice(
    '- **obra/superpowers**, `debugging`: what was taken.',
    '- **garrytan/gstack**, `investigate`.',
    '  Revision: garrytan/gstack@abc1234 (checked 2026-09-29)',
    '- **A page**, somewhere.',
    '  Read: 2026-02-30 (read by)',
    '- **citypaul/.dotfiles**, `tdd`.',
    `  Revision: citypaul/.dotfiles@${sha} (checked 2026-09-29)`,
    '  Read: 2026-09-20 (read by)',
    '- **A built-in**, observed.',
    '  Revision: none',
    '- **nizos/tdd-guard**.',
    `  Revision: ${sha} (no repository named)`,
  )), [
    'N.md:5, obra/superpowers: has no Revision: or Read: line',
    'N.md:6, garrytan/gstack: has a Revision: whose commit is not a full 40-hex sha: abc1234',
    'N.md:6, garrytan/gstack: names garrytan/gstack in bold, and has no Revision: line of its own naming it',
    'N.md:8, A page: has a Read: line whose date is not a real YYYY-MM-DD: 2026-02-30',
    'N.md:10, citypaul/.dotfiles: has 2 Revision: or Read: lines for 1 source named in bold',
    'N.md:13, A built-in: has a Revision: line not in the form "Revision: <owner/repo>@<commit> (<how>)" or "Revision: none (<why>)": Revision: none',
    `N.md:15, nizos/tdd-guard: has a Revision: that is not <owner/repo>@<commit>: ${sha}`,
    'N.md:15, nizos/tdd-guard: names nizos/tdd-guard in bold, and has no Revision: line of its own naming it',
  ]);

  assert.deepEqual(noticeTrouble('N.md', '# Something else\n\n- **Not a source**, here.\n'), [], 'bullets outside "# Sources and licences" are not sources');
  assert.deepEqual(
    noticeTrouble('N.md', notice('- **One**, then a paragraph.', '', '  Revision: none (too late: after a blank line it is not the entry\'s)')),
    ['N.md:5, One: has no Revision: or Read: line'],
    'a line after the entry has ended is not the entry\'s',
  );
  assert.deepEqual(
    noticeTrouble('N.md', `<!-- a comment\n     of two lines -->\n\n${notice('- **Two**, here.')}`),
    ['N.md:8, Two: has no Revision: or Read: line'],
    'the line number is the file\'s, counted from its top',
  );
});

test('the NOTICE check wants a Revision: line for each repository an entry names in bold (#280, review of PR #446)', () => {
  const [first, second] = ['a'.repeat(40), 'b'.repeat(40)];
  const notice = (...entries) => ['# Sources and licences', '', ...entries, ''].join('\n');
  const twoRepos = [
    '- **`addyosmani/agent-skills`, `skills/doubt-driven-development`** and',
    '  **`citypaul/.dotfiles`, `claude/.claude/skills/double-check`**: MIT. What was taken.',
    `  Revision: addyosmani/agent-skills@${first}`,
  ];

  assert.deepEqual(noticeTrouble('N.md', notice(
    ...twoRepos,
    `  (reconstructed; and citypaul/.dotfiles@${second}, the same way)`,
  )), [
    'N.md:3, `addyosmani/agent-skills`, `skills/doubt-driven-development`: names citypaul/.dotfiles in bold, and has no Revision: line of its own naming it',
  ], 'the second repository\'s commit in the first one\'s parentheses does not count');

  assert.deepEqual(noticeTrouble('N.md', notice(
    ...twoRepos,
    '  (reconstructed)',
    `  Revision: citypaul/.dotfiles@${second} (reconstructed)`,
  )), [], 'a Revision: line of its own for each repository named');

  assert.deepEqual(noticeTrouble('N.md', notice(
    '- **mattpocock/skills**, `tdd`.',
    `  Revision: MattPocock/Skills@${first} (checked 2026-09-29)`,
  )), [], 'a repository is named the way GitHub reads it, whatever its case');

  assert.deepEqual(noticeTrouble('N.md', notice(
    '- **The GDS Way**, "Documenting architecture decisions", and **GOV.UK**, "A framework",',
    '  and **Google Cloud Architecture Center**, "An overview". What was taken.',
    '  Read: 2026-09-24 (read by)',
  )), [], 'pages read together on one date may share one Read: line');

  assert.deepEqual(noticeTrouble('N.md', notice(
    '- **mattpocock/skills**, `tdd`. It quotes **obra/superpowers** by name.',
    `  Revision: mattpocock/skills@${first} (checked 2026-09-29)`,
  )), [
    'N.md:3, mattpocock/skills: names obra/superpowers in bold, and has no Revision: line of its own naming it',
  ], 'a repository named in bold anywhere before the entry\'s first Revision: line is one of its sources');
});

test('the NOTICE check finds a repository credited in bold outside any source entry with no Revision: line in the NOTICE (#280, review of PR #446)', () => {
  const sha = 'a'.repeat(40);
  const around = (...lines) => [
    '# Sources and licences',
    '',
    '- **mattpocock/skills**, `tdd`.',
    `  Revision: mattpocock/skills@${sha} (checked 2026-09-29)`,
    '',
    'Two things come from the research pack rather than from a repository:',
    '',
    ...lines,
    '',
  ].join('\n');

  assert.deepEqual(noticeTrouble('N.md', around(
    '- The label pair is quoted there from **tw93/Waza**\'s `rules/anti-patterns.md`,',
    '  taken from the book\'s verbatim quote.',
  )), ['N.md:8, tw93/Waza: is credited in bold outside any source entry, and this NOTICE has no Revision: line naming it']);

  assert.deepEqual(noticeTrouble('N.md', around(
    'As the entry above says, **mattpocock/skills** is where the ladder is from.',
  )), [], 'a repository that has its Revision: line in the NOTICE is credited already');

  assert.deepEqual(noticeTrouble('N.md', around(
    '**Left out on a licence.** Trail of Bits\' skill and alexop.dev, named in words.',
  )), [], 'bold that names no owner/repo, and sources named only in words, are review\'s to find');
});
