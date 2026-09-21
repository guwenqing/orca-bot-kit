// `obk source add --bots <path> --name <name> --repo <url> --ref <ref>
// [--path <subfolder>]`: one online skill source written into the user's own
// `skills.yaml`, so that nobody has to open the file to add one.
//
// It writes one entry and stops. It clones nothing — `obk skills fetch` is what
// goes and looks — and it touches Orca not at all.
//
// The file is the user's: the comments the seed wrote, the sources they already
// listed and anything they added by hand all come back as they wrote them, with
// the new entry after them. A file the kit cannot add to that narrowly is left
// alone and said so, which is the failure this file is mostly about: a command
// that writes, exits 0, and quietly drops half of somebody's file.
//
// And the name it accepts has to be a name `readSources` accepts, or the entry
// it writes is one the next command cannot read. The proof of that is a fetch
// run against what it wrote, at the end.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import {
  assertCleanFailure,
  assertHomeUntouched,
  assertKeptWhatTheyWrote,
  assertNoTrailingSpace,
  createSandbox,
  skipGit,
  snapshot,
} from './helpers/cli.js';
import {
  cloneOf,
  commitIn,
  putSkills,
  repoAt,
  shaIn,
  skillsYamlOf,
  sourceEntryIn,
  sourcesDirOf,
  sourcesIn,
  sourcesTextIn,
  sourcesYaml,
  writeSources,
} from './helpers/sources.js';

/** The source a test adds, unless it says otherwise. */
const NAME = 'someones-skills';
const REPO = 'https://github.com/someone/skills';
const REF = 'v1.2.0';

/** A bots folder `init` made, with the `skills.yaml` it seeds. */
async function seeded(box) {
  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(result.code, 0, result.stderr);
  return box.path('bots');
}

/** Add one source. Anything after the four flags is given as it stands. */
const add = (box, ...rest) =>
  box.run(['source', 'add', '--bots', 'bots', '--name', NAME, '--repo', REPO, '--ref', REF, ...rest]);

/** The sources the file lists now, in the order it lists them. */
const listed = async (bots) => (await sourcesIn(bots)).sources ?? [];

/** The answer of a `--json` run, parsed, and nothing but JSON on the way out. */
function answerOf(result) {
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
}

test('R1 source add writes the one source into skills.yaml and changes nothing else', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const before = await snapshot(bots, skipGit);
  const calls = (await box.orca.calls()).length;

  const result = await add(box, '--path', 'skills');

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(await listed(bots), [{ name: NAME, repo: REPO, ref: REF, path: 'skills' }]);
  // skills.yaml and nothing else: no clone, no folder beside the bots folder.
  const after = await snapshot(bots, skipGit);
  assert.deepEqual(
    Object.keys(after).filter((rel) => after[rel] !== before[rel]),
    ['skills.yaml'],
    'the one file it writes is the one the sources are listed in',
  );
  assert.equal(existsSync(sourcesDirOf(bots)), false, 'source add clones nothing: skills fetch is what goes and looks');
  assert.equal((await box.orca.calls()).length, calls, 'and it asks Orca nothing at all');
  await assertHomeUntouched(box);
});

test('R1 the four flags are written as the user gave them, and --path only when given', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);

  const withPath = await add(box, '--path', 'shelf/skills');
  const without = await box.run([
    'source', 'add', '--bots', 'bots', '--name', 'other-skills', '--repo', 'git@example.invalid:team/shelf.git', '--ref', 'main',
  ]);

  assert.equal(withPath.code, 0, withPath.stderr);
  assert.equal(without.code, 0, without.stderr);
  assert.deepEqual(await listed(bots), [
    { name: NAME, repo: REPO, ref: REF, path: 'shelf/skills' },
    { name: 'other-skills', repo: 'git@example.invalid:team/shelf.git', ref: 'main' },
  ]);
  const plain = await sourceEntryIn(bots, 'other-skills');
  assert.equal('path' in plain, false, 'a source with no subfolder carries no path key to explain away');
  assertNoTrailingSpace(await sourcesTextIn(bots));
});

test('R1 a new source goes after the ones already listed, and theirs are untouched', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const theirs = [
    { name: 'first-shelf', repo: 'https://example.invalid/first', ref: 'v1.0.0' },
    { name: 'second-shelf', repo: 'https://example.invalid/second', path: 'skills', ref: 'stable' },
  ];
  await writeSources(bots, sourcesYaml(...theirs));

  const result = await add(box);

  assert.equal(result.code, 0, result.stderr);
  const now = await listed(bots);
  assert.deepEqual(
    now.slice(0, 2),
    theirs,
    `the sources the user listed should say exactly what they said:\n${await sourcesTextIn(bots)}`,
  );
  assert.deepEqual(now[2], { name: NAME, repo: REPO, ref: REF }, 'and the new one is after them');
  assert.equal(now.length, 3);
});

test('R1 every comment and key the user wrote is still there afterwards', async (t) => {
  // Their file. The kit adds one entry to one list and gives everything else
  // back as they wrote it — the seed's own comments included, because those are
  // what tell a person what the file is for.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const seed = await sourcesTextIn(bots);
  assert.ok(seed.includes('#'), `init should seed skills.yaml with comments, got:\n${seed}`);
  const mine = `${seed.trimEnd().replace('sources: []', [
    'sources:',
    '  - name: first-shelf            # the team shelf, do not remove',
    '    repo: https://example.invalid/first',
    '    ref: v1.0.0',
  ].join('\n'))}\nnotes: keep me                    # a key the kit knows nothing about\n`;
  await writeFile(skillsYamlOf(bots), mine);

  const result = await add(box, '--path', 'skills');

  assert.equal(result.code, 0, result.stderr);
  const after = await sourcesTextIn(bots);
  assertKeptWhatTheyWrote(mine, after, { changed: ['sources'] });
  assertNoTrailingSpace(after);
  assert.equal(parse(after).notes, 'keep me');
  for (const comment of ['the team shelf, do not remove', 'a key the kit knows nothing about']) {
    assert.ok(after.includes(comment), `the comment "${comment}" should have survived:\n${after}`);
  }
  assert.deepEqual(await listed(bots), [
    { name: 'first-shelf', repo: 'https://example.invalid/first', ref: 'v1.0.0' },
    { name: NAME, repo: REPO, ref: REF, path: 'skills' },
  ]);
});

/** The ways a user writes a sources list. */
const STYLES = [
  ['the empty list init seeds', 'sources: []\n'],
  ['a block list of their own', 'sources:\n  - name: first-shelf\n    repo: https://example.invalid/first\n    ref: v1.0.0\n'],
  ['an indentless block list', 'sources:\n- name: first-shelf\n  repo: https://example.invalid/first\n  ref: v1.0.0\n'],
  ['a flow list all on one line', 'sources: [{ name: first-shelf, repo: "https://example.invalid/first", ref: v1.0.0 }]\n'],
  ['a sources key with nothing under it', 'sources:\n'],
  ['no sources key at all', ''],
];

for (const [label, tail] of STYLES) {
  test(`R1 a source added to ${label} leaves a file that still lists them all`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    const mine = `# Where this fleet gets its skills.\n\n${tail}`;
    await writeFile(skillsYamlOf(bots), mine);
    const were = parse(mine)?.sources ?? [];

    const result = await add(box);

    assert.equal(result.code, 0, result.stderr);
    const text = await sourcesTextIn(bots);
    assert.deepEqual(
      parse(text)?.sources,
      [...were, { name: NAME, repo: REPO, ref: REF }],
      `every source that was there should be untouched, with the new one after them:\n${text}`,
    );
    assertNoTrailingSpace(text);
  });
}

test('R1 a skills.yaml the kit cannot add to safely is refused and left exactly as it was', async (t) => {
  // An anchor on the list and an alias to it elsewhere: one document where
  // adding an entry in one place adds it in two, so the change is not the one
  // the kit meant to make and the file is not written at all.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const mine = [
    '# The shelf, and a copy of the list I keep for myself.',
    '',
    'sources: &shared',
    '  - name: first-shelf',
    '    repo: https://example.invalid/first',
    '    ref: v1.0.0',
    'backup: *shared',
    '',
  ].join('\n');
  await writeSources(bots, mine);
  const before = await snapshot(bots, skipGit);

  const result = await add(box);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('skills.yaml'), `the refusal should name the file the user has to open, got: ${result.stderr}`);
  assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing at all');
  assert.equal(await sourcesTextIn(bots), mine, 'and the file is the user\'s, byte for byte');
});

test('R1 a name already listed is refused, and the source that is there is left alone', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  assert.equal((await add(box, '--path', 'skills')).code, 0);
  const before = await sourcesTextIn(bots);

  const again = await box.run([
    'source', 'add', '--bots', 'bots', '--name', NAME, '--repo', 'https://example.invalid/somewhere-else', '--ref', 'main',
  ]);

  assertCleanFailure(again);
  assert.ok(again.stderr.includes(NAME), `the refusal should name the source, got: ${again.stderr}`);
  assert.equal(await sourcesTextIn(bots), before, 'the entry that is there is the user\'s and does not move');
  assert.deepEqual(await listed(bots), [{ name: NAME, repo: REPO, ref: REF, path: 'skills' }]);
});

for (const [label, name] of [
  ['an upper-case letter', 'Someones-Skills'],
  ['an underscore', 'someones_skills'],
  ['a space', 'someones skills'],
  ['a leading hyphen', '-shelf'],
  ['a trailing hyphen', 'shelf-'],
  ['two hyphens together', 'shelf--two'],
  ['a trailing dot', 'shelf.'],
  ['a slash', 'someones/skills'],
  ['a walk up the tree', '..'],
]) {
  test(`R1 a source name with ${label} is refused, and nothing is written`, async (t) => {
    // A name this command accepts has to be one readSources accepts, or the
    // entry it wrote is one the next command refuses to read.
    const box = await createSandbox(t);
    const bots = await seeded(box);
    const before = await snapshot(bots, skipGit);

    // `--name=<value>` so a name starting with a hyphen reaches the CLI as a name.
    const result = await box.run(['source', 'add', '--bots', 'bots', `--name=${name}`, '--repo', REPO, '--ref', REF]);

    assertCleanFailure(result);
    assert.ok(result.stderr.includes(name), `the refusal should name what it got, got: ${result.stderr}`);
    assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing');
  });
}

test('R1 kit is not a name a source may take: it is the kit\'s own shelf', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const before = await snapshot(bots, skipGit);

  const result = await box.run(['source', 'add', '--bots', 'bots', '--name', 'kit', '--repo', REPO, '--ref', REF]);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('kit'), `the refusal should say which name it is about, got: ${result.stderr}`);
  assert.deepEqual(await snapshot(bots, skipGit), before);
  assert.deepEqual(await listed(bots), [], 'and nothing reaches the file');
});

for (const [label, args, missing] of [
  ['no --name', ['--repo', REPO, '--ref', REF], '--name'],
  ['no --repo', ['--name', NAME, '--ref', REF], '--repo'],
  ['no --ref', ['--name', NAME, '--repo', REPO], '--ref'],
  ['an empty --name', ['--name=', '--repo', REPO, '--ref', REF], '--name'],
  ['an empty --repo', ['--name', NAME, '--repo=', '--ref', REF], '--repo'],
  ['an empty --ref', ['--name', NAME, '--repo', REPO, '--ref='], '--ref'],
]) {
  test(`R1 source add with ${label} is refused, names the flag, and writes nothing`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    const before = await snapshot(bots, skipGit);

    const result = await box.run(['source', 'add', '--bots', 'bots', ...args]);

    assertCleanFailure(result);
    assert.ok(result.stderr.includes(missing), `should name ${missing}, got: ${result.stderr}`);
    assert.ok(
      result.stderr.includes('source add'),
      `and say which command needs it, as every other refusal of a missing flag does, got: ${result.stderr}`,
    );
    assert.deepEqual(await snapshot(bots, skipGit), before);
  });
}

test('R1 source add without --bots is refused and says so', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['source', 'add', '--name', NAME, '--repo', REPO, '--ref', REF]);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('--bots'), `should name --bots, got: ${result.stderr}`);
  assert.deepEqual(await readdir(box.cwd), [], 'and it seeds nothing, not even the folder');
});

test('R1 a folder that is not a bots folder is refused, and nothing is made there', async (t) => {
  const box = await createSandbox(t);

  const result = await add(box);

  assertCleanFailure(result);
  assert.match(result.stderr, /obk init/, `should send the user to init, as its neighbours do, got: ${result.stderr}`);
  assert.deepEqual(await readdir(box.cwd), [], 'source add makes no bots folder of its own');
});

test('R1 it says what it added and names the command that fetches it', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);

  const result = await add(box, '--path', 'skills');

  assert.equal(result.code, 0, result.stderr);
  for (const fact of [NAME, REPO, REF, 'skills']) {
    assert.ok(result.stdout.includes(fact), `the report should name ${fact}, got: ${result.stdout}`);
  }
  assert.ok(
    result.stdout.includes('skills fetch'),
    `it should name the command that goes and gets it, got: ${result.stdout}`,
  );
  assert.ok(!result.stdout.includes('undefined'), `nothing should be undefined, got: ${result.stdout}`);
});

test('R1 --json answers the same facts, with bots as the resolved absolute path', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);

  const result = await add(box, '--path', 'skills', '--json');

  const answer = answerOf(result);
  assert.equal(answer.bots, box.path('bots'), '--bots was given as a relative path and comes back resolved');
  assert.deepEqual(answer.source, { name: NAME, repo: REPO, ref: REF, path: 'skills' });
});

test('R1 what it wrote is a source the kit can read: skills fetch clones it', async (t) => {
  // The end of it. An entry the kit writes and then refuses to read is a
  // command that looks like it worked and leaves the fleet stuck.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const origin = path.join(box.root, 'their-repo');
  await repoAt(origin);
  await putSkills(origin, { 'their-skill': 'Version one.' }, 'shelf');
  const first = await commitIn(origin, 'the first version');

  const added = await box.run([
    'source', 'add', '--bots', 'bots', '--name', NAME, '--repo', origin, '--ref', 'main', '--path', 'shelf',
  ]);
  const fetched = await box.run(['skills', 'fetch', '--bots', 'bots']);

  assert.equal(added.code, 0, added.stderr);
  assert.equal(fetched.code, 0, `${fetched.stderr}${fetched.stdout}`);
  assert.equal(await shaIn(cloneOf(bots, NAME)), first, 'the clone is at what the ref names');
  assert.ok(
    (await readFile(path.join(cloneOf(bots, NAME), 'shelf', 'their-skill', 'SKILL.md'), 'utf8')).includes('Version one.'),
    'and the subfolder the entry names is where the skills are',
  );
});
