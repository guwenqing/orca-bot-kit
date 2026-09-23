// A value from outside the kit is never read as an option or a path (#177).
//
// Two places where the kit hands a value it did not write to something that
// would read it as more than a value:
//
//   - A source's `repo:` in `skills.yaml`, which is committed and may have come
//     from someone else, is given to `git clone`. A repository is all it may
//     ever be: a value that begins with `-` is still the name of a repository,
//     never a git option.
//   - A key in a bot's skills record (`.obk-skills.yaml`, local and gitignored)
//     names a skill the kit linked. A skill name is all it may ever be: a key
//     that climbs out with `..` must not lead the kit to remove a link that is
//     not in the bot's skills directory at all.
//
// Everything runs against real git in the sandbox, as the sources tests do.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, readlink, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import { botHomeOf, createSandbox } from './helpers/cli.js';
import { addSkills, botYamlOf, commonSkill, setSkills, SKILL_DIRS } from './helpers/skills.js';
import {
  answerOf,
  cloneOf,
  commitIn,
  putSkills,
  repoAt,
  sourceIn,
  sourcesYaml,
  writeSources,
} from './helpers/sources.js';

async function seeded(box) {
  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(result.code, 0, result.stderr);
  return box.path('bots');
}

/** No crash: a message, not a stack. */
const assertNoCrash = (result) => assert.ok(
  !/^\s+at /m.test(result.stdout + result.stderr),
  `expected a report, got a crash:\n${result.stdout}${result.stderr}`,
);

// ------------------------------------------------------ a source's repo

test('HD1 a repo value that looks like a git option is still a repository: one called -skills is cloned', async (t) => {
  // A repository whose path begins with a dash, given relative to where obk
  // runs, as a relative path in skills.yaml is. Read as a repository it clones
  // like any other. Read as an option, git takes `-skills` for its short
  // switches and the source is never fetched: that is the defect, seen from
  // the side a user can check.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const dashed = path.join(box.cwd, '-skills');
  await repoAt(dashed);
  await putSkills(dashed, { 'their-skill': 'From the repository whose name begins with a dash.' });
  const sha = await commitIn(dashed, 'the one version');
  await writeSources(bots, sourcesYaml({ name: 'dashed', repo: '-skills', ref: 'main' }));

  const result = await box.run(['skills', 'fetch', '--bots', 'bots', '--json']);

  assertNoCrash(result);
  const entry = sourceIn(answerOf(result), 'dashed');
  assert.ok(!('trouble' in entry), `-skills is a repository and should be fetched, got: ${JSON.stringify(entry)}`);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(existsSync(path.join(cloneOf(bots, 'dashed'), 'their-skill', 'SKILL.md')), 'its skill is in the clone');
  assert.equal(entry.sha, sha);
});

test('HD1 a repo value written as a git option has no effect as one, and the source is not fetched', async (t) => {
  // The case from the review: `--upload-pack=<a program>`, which git would run
  // on the far side of a clone. As a repository it names nothing there is, so
  // it is not fetched, and the program never runs.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const marker = path.join(box.root, 'the-option-ran');
  const program = path.join(box.root, 'leave-a-marker.sh');
  await writeFile(program, `#!/bin/sh\ntouch '${marker}'\nexec git-upload-pack "$@"\n`, { mode: 0o755 });
  await writeSources(bots, sourcesYaml({ name: 'hostile', repo: `--upload-pack=${program}`, ref: 'main' }));

  const result = await box.run(['skills', 'fetch', '--bots', 'bots', '--json']);

  assertNoCrash(result);
  assert.equal(existsSync(marker), false, 'the program the option names never ran');
  assert.equal(result.code, 1, 'a source that could not be fetched ends the run in 1');
  const entry = sourceIn(answerOf(result), 'hostile');
  assert.equal(typeof entry.trouble, 'string', `it is reported as not fetched, got: ${JSON.stringify(entry)}`);
  assert.equal(existsSync(cloneOf(bots, 'hostile')), false, 'and nothing was cloned');
  assert.equal(existsSync(`${cloneOf(bots, 'hostile')}.fetching`), false);
});

// ------------------------------------------------------ the skills record

test('HD2 a record key that climbs out with .. never leads the build to remove a link outside the bot', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude'])).code, 0);
  const home = botHomeOf(bots, 'api-bot');

  // A link of the user's, well outside the bot folder.
  const theirs = path.join(box.root, 'elsewhere', 'link');
  const pointsAt = path.join(box.root, 'elsewhere', 'what-it-points-at');
  await mkdir(pointsAt, { recursive: true });
  await symlink(pointsAt, theirs);

  // The contrast, made the ordinary way: a skill the kit linked, then taken off
  // the list. Its record entry is real and its link is the kit's to take back.
  await commonSkill(bots, 'house-style');
  await addSkills(botYamlOf(bots, 'api-bot'), 'house-style');
  const first = await box.run(['skills', 'build', '--bots', 'bots', '--bot', 'api-bot']);
  assert.equal(first.code, 0, first.stderr);
  const kitLink = path.join(home, SKILL_DIRS.claude, 'house-style');
  assert.ok((await lstat(kitLink)).isSymbolicLink(), 'the kit linked house-style first');
  await setSkills(botYamlOf(bots, 'api-bot'));

  // And the tampered entry: a key that is a path from the skills directory to
  // the user's link, vouched for with that link's own target.
  const recordFile = path.join(home, '.obk-skills.yaml');
  const record = parse(await readFile(recordFile, 'utf8'));
  for (const harness of Object.keys(SKILL_DIRS)) {
    const key = path.relative(path.join(home, SKILL_DIRS[harness]), theirs);
    assert.ok(key.startsWith('..'), `the key climbs out, got: ${key}`);
    record[harness] = { ...(record[harness] ?? {}), [key]: pointsAt };
  }
  await writeFile(recordFile, stringify(record));

  const result = await box.run(['skills', 'build', '--bots', 'bots', '--bot', 'api-bot']);

  assertNoCrash(result);
  assert.equal(await readlink(theirs).catch((error) => error.code), pointsAt, 'the user\'s link outside the bot is still there, pointing where it did');
  assert.equal(
    await lstat(kitLink).then(() => 'still there', (error) => error.code),
    'ENOENT',
    'the contrast: the skill the kit linked and the list no longer names is taken away, as today',
  );
});
