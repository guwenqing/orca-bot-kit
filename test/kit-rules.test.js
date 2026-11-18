// The kit's rule units: the files under rules/ that the build pastes into every
// bot's AGENTS.md (PRD 6.6, ADR 0013). A malformed unit would reach a bot as
// broken instructions, and an oversized set is paid for on every turn of every
// session, so both are cheap to check here and expensive to find later.
//
// The shape of a unit is read here, out of the directory. What the set costs is
// not: it is measured where a bot pays it, by building a bot's AGENTS.md through
// the CLI and reading the size of the file its sessions are given. Counting the
// bodies in this directory instead measures the part of the cost that happens to
// live here and misses the charter, the headings and the user's own units the
// kit's are built beside (issue #140).

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import { createSandbox, repoRoot } from './helpers/cli.js';
import { answerOf, assertEntryFile, defaultUnits, entryOf } from './helpers/rules.js';

const rulesDir = path.join(repoRoot, 'rules');

/** A unit name has the shape an Agent Skills name has, and so does its file. */
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * What one unit may take. A rule is a few lines; a unit that wants more than
 * this is a technique, and a technique belongs in a skill. It holds for every
 * unit, the applies: code ones included, which a new bot does not carry and the
 * size guard below therefore never sees.
 *
 * It was 12. It is 18 because of the six rule lines of request
 * claude-session-trim, R4, signed on 2026-11-14: they took the limits and mail
 * units past 12, and every bot must carry them word for word.
 *
 * It did not come down in #803. The longest unit, limits, is at 18 lines, and
 * each of its lines guards safety, is owner-signed (claude-session-trim, R4), or
 * is a PRD default.
 */
const MAX_BODY_LINES = 18;
const MAX_LINE = 100;

/** All Codex reads of an instructions file (tech notes, section 3). */
const CODEX_CAP = 32 * 1024;

/**
 * What the kit's own contribution to a bot's instructions may take, in bytes,
 * of the 32 KiB a Codex session will read. The rest is for the charter its
 * owner writes and the units they add.
 *
 * It measures the real file a new bot is given, not the bodies in rules/,
 * which are only a part of what a bot pays (issue #140).
 *
 * It was 8 KiB, then 9 KiB for the six rule lines of request
 * claude-session-trim, R4. Issue #803 cut two sentences and set it to the
 * measured size plus the room for about one rule line: a new bot's file was
 * 8683 bytes (8851 at 0682f8a, less the 168 bytes of the two sentences), and
 * 117 bytes of room make 8800. The room is small on purpose: the next rule line
 * that is added meets this cap, and that forces a decision on whether every
 * bot must carry it.
 *
 * A pass here never says that a rule earns its place in every session. That
 * question is settled where the unit is written and reviewed (issue #140). The
 * small room only makes growth visible: a change that adds a rule line must
 * also change this number, and say why.
 *
 * The room is not zero, because some bytes of the file are no rule's: the
 * sentence in the begin marker and the headings around the units. They are the
 * implementer's to word, and a small rewording of them must not fail this test.
 */
const KIT_SHARE = 8800;

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
      Object.keys(data ?? {}).filter((key) => key !== 'placement').sort(),
      ['applies', 'name', 'title'],
      `${unit.file} should carry exactly name, title and applies, and placement or not`,
    );
    if ('placement' in data) {
      assert.ok(
        ['all', 'main', 'both'].includes(data.placement),
        `${unit.file}: placement should be all, main or both, got ${JSON.stringify(data.placement)}`,
      );
    }
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

test('no unit takes more room than a rule takes', async () => {
  // A unit that needs more room than one unit may take is a skill, not a rule.
  for (const unit of await units()) {
    const lines = bodyLines(parts(unit).body).length;

    assert.ok(lines <= MAX_BODY_LINES, `${unit.file} is ${lines} non-empty lines, over the ${MAX_BODY_LINES} a unit may take`);
  }
});

test('the instructions a new bot is given stay inside the kit\'s share of them', async (t) => {
  // Through the CLI, on a bot the kit has just made, because that file is the
  // kit's whole contribution and nothing else: every unit every bot carries,
  // the headings the build writes around them, and a charter whose owner has
  // not written a word of it yet.
  const box = await createSandbox(t);
  const init = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(init.code, 0, init.stderr);
  const created = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude']);
  assert.equal(created.code, 0, created.stderr);

  const result = await box.run(['rules', 'build', '--bots', 'bots', '--bot', 'api-bot', '--json']);
  assert.equal(result.code, 0, result.stderr);

  const entry = entryOf(answerOf(result), 'api-bot');
  await assertEntryFile(entry, box, box.path('bots'), 'api-bot');
  assert.deepEqual(
    entry.units,
    (await defaultUnits()).map((unit) => unit.name),
    'the built file should carry every unit every bot gets, or the size below is of something else',
  );

  assert.ok(
    entry.bytes <= KIT_SHARE,
    `a new bot's AGENTS.md is ${entry.bytes} bytes before its owner has written a word of it, over the `
    + `${KIT_SHARE} bytes the kit allows itself of the ${CODEX_CAP / 1024} KiB Codex reads. If what grew `
    + 'is depth, it belongs in a skill; if it is a rule every bot needs, weigh what it buys on every turn, '
    + 'move the number, and say in the change what it bought.',
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
