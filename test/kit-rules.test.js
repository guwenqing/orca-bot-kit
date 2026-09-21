// The kit's rule units: the files under rules/ that the build pastes into every
// bot's AGENTS.md (PRD 6.6, ADR 0003). A malformed unit would reach a bot as
// broken instructions, and an oversized one is paid for on every turn of every
// session, so both are cheap to check here and expensive to find later.

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import { repoRoot } from './helpers/cli.js';

const rulesDir = path.join(repoRoot, 'rules');

/** A unit name has the shape an Agent Skills name has, and so does its file. */
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * What one unit may take. A rule is a few lines; a unit that wants more than
 * this is a technique, and a technique belongs in a skill. It is also the only
 * size check the applies: code units get, since the budget below counts only
 * what every bot carries.
 */
const MAX_BODY_LINES = 12;
const MAX_LINE = 100;

/**
 * What the applies: all bodies come to today, to the character: what every
 * session of every bot reads on every turn, around 930 tokens of it.
 *
 * This is a ratchet and not a budget, and the difference matters. It is set to
 * the exact total rather than to a round number with room in it, because room
 * in it is spent silently: the last unit to arrive fitted inside the slack and
 * nobody weighed it until the slack ran out. At the exact total, every
 * character the set gains trips this test, and moving the number is a line in a
 * diff that somebody chose to write.
 *
 * So it says nothing about what a bot can afford. It cannot: the kit's units
 * are built into AGENTS.md beside the user's own units and the bot's charter,
 * and none of that is visible from here. A rule the bots need is not trimmed to
 * fit this number. When the set no longer fits, ask first whether what grew is
 * a rule or depth that belongs in a skill; if it is a rule, weigh what those
 * tokens buy on every turn, move this number on purpose, and say in the change
 * what they bought.
 *
 * 3500 until mail.md (PRD 6.9) was added in slice 08; 3950 while that number
 * carried slack; set to the exact total from this slice, when profiles.md
 * (PRD 6.8) arrived and the slack turned out to be what let it land unweighed.
 */
const MAX_ALL_CHARS = 4129;

/** Everything in rules/, whatever it is: the shape test needs to see the strays too. */
async function entries() {
  try {
    return await readdir(rulesDir, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return assert.fail('the kit ships its rule units in rules/ at the repo root, and that directory does not exist');
  }
}

/** Every unit file: the path CI output should name, the name its file gives it, and its bytes. */
async function units() {
  const files = (await entries()).filter((entry) => entry.isFile() && entry.name.endsWith('.md'));
  return Promise.all(files.map(async (entry) => ({
    file: path.posix.join('rules', entry.name),
    basename: entry.name.slice(0, -'.md'.length),
    text: await readFile(path.join(rulesDir, entry.name), 'utf8'),
  })));
}

/**
 * One unit split into the two things the compiler reads: the parsed frontmatter
 * and the body after it. A file that is not a delimited YAML document fails
 * here, once, in whichever test asked for it.
 */
function parts(unit) {
  const match = /^---\n([\s\S]*?)\n---(?:\n([\s\S]*))?$/.exec(unit.text);
  assert.ok(match !== null, `${unit.file} should begin with YAML frontmatter: a line ---, the keys, then a line ---`);
  try {
    return { data: parse(match[1]), body: match[2] ?? '' };
  } catch (error) {
    return assert.fail(`${unit.file}: the frontmatter is not valid YAML: ${error.message}`);
  }
}

/** What a body costs to carry: the lines that are not blank. */
const bodyLines = (body) => body.split('\n').filter((line) => line.trim() !== '');

test('rules/ holds one markdown file per unit and nothing else', async () => {
  const all = await entries();
  assert.ok(all.length > 0, 'rules/ should hold the kit rule units, and it is empty');

  const strays = all.filter((entry) => !(entry.isFile() && entry.name.endsWith('.md'))).map((entry) => entry.name);
  assert.deepEqual(strays, [], `rules/ should hold only *.md files, one per unit; found: ${strays.join(', ')}`);
});

test('every unit carries the three frontmatter keys the compiler reads', async () => {
  const names = [];
  for (const unit of await units()) {
    const { data } = parts(unit);

    assert.deepEqual(
      Object.keys(data ?? {}).sort(),
      ['applies', 'name', 'title'],
      `${unit.file} should carry exactly name, title and applies`,
    );
    assert.equal(data.name, unit.basename, `${unit.file}: name should be the file's basename, got ${JSON.stringify(data.name)}`);
    assert.match(
      String(data.name),
      NAME,
      `${unit.file}: name ${JSON.stringify(data.name)} should be lowercase letters, digits and single inner hyphens`,
    );
    assert.equal(typeof data.title, 'string', `${unit.file}: title should be a string, got ${JSON.stringify(data.title)}`);
    assert.ok(
      data.title.trim() !== '' && !data.title.includes('\n'),
      `${unit.file}: title becomes the unit's heading, so it should be a non-empty single line, got ${JSON.stringify(data.title)}`,
    );
    assert.ok(
      data.applies === 'all' || data.applies === 'code',
      `${unit.file}: applies should be all or code, got ${JSON.stringify(data.applies)}`,
    );

    names.push(data.name);
  }

  const twice = names.filter((name, at) => names.indexOf(name) !== at);
  assert.deepEqual(twice, [], `a unit name is used more than once: ${twice.join(', ')}`);
});

test('every unit has a body, and no heading of its own', async () => {
  // The compiler writes the heading from `title`; one in the body would land
  // under it at whatever level the author happened to type.
  for (const unit of await units()) {
    const { body } = parts(unit);

    assert.notEqual(body.trim(), '', `${unit.file} has nothing after the frontmatter; a unit is its body`);

    const headings = body.split('\n').filter((line) => line.startsWith('#'));
    assert.deepEqual(headings, [], `${unit.file} should carry no markdown heading, the compiler supplies it: ${headings.join(' | ')}`);
  }
});

test('the units stay inside the budget a bot pays on every turn', async () => {
  // A unit that needs more room than one unit may take is a skill, not a rule.
  // The default set is counted in characters, because the bodies are
  // hard-wrapped and a line count would measure the wrapping rather than the
  // reading.
  let byDefault = 0;
  for (const unit of await units()) {
    const { data, body } = parts(unit);
    const lines = bodyLines(body).length;

    assert.ok(lines <= MAX_BODY_LINES, `${unit.file} is ${lines} non-empty lines, over the ${MAX_BODY_LINES} a unit may take`);
    if (data.applies === 'all') byDefault += body.trim().length;
  }

  assert.ok(
    byDefault <= MAX_ALL_CHARS,
    `the applies: all units come to ${byDefault} characters, over the ${MAX_ALL_CHARS} every bot may be given by default`,
  );
});

test('every line in a unit file stays inside 100 columns', async () => {
  // The bodies are hard-wrapped like the rest of the repo's markdown, so a long
  // line is a line that got away, not a style choice.
  for (const unit of await units()) {
    const long = unit.text.split('\n')
      .map((line, at) => ({ at: at + 1, line }))
      .filter((entry) => entry.line.length > MAX_LINE);

    assert.deepEqual(
      long.map((entry) => `${unit.file}:${entry.at} (${entry.line.length})`),
      [],
      `no line in a unit may run past ${MAX_LINE} characters`,
    );
  }
});

test('the kit ships rules for every bot and rules for the code-writing ones', async () => {
  const applies = (await units()).map((unit) => parts(unit).data?.applies);

  assert.ok(applies.includes('all'), 'no unit has applies: all, so a bot would start with none of the kit rules');
  assert.ok(applies.includes('code'), 'no unit has applies: code, so a developer bot would get nothing of its own');
});

test('the published package ships the rules directory', async () => {
  // Left out of `files`, the units exist in the repo and nowhere a user installs.
  const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));

  assert.ok(
    pkg.files.some((entry) => entry.replace(/\/$/, '') === 'rules'),
    `package.json files should include the rules directory, got: ${pkg.files.join(', ')}`,
  );
});
