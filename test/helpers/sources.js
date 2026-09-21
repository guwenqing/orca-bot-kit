// The "online" repo a test fetches skills from, and reading back what the kit
// did with it.
//
// `git clone` takes a path, so an online source in a test is a real git
// repository in the sandbox: real commits, a real tag, a real branch that moves
// on afterwards. Nothing is faked and nothing reaches the network, and the
// thing that matters most can be pinned exactly — after the origin has moved,
// what the clone knows says whether anybody went and looked.
//
// Everything here reads the disk and git itself rather than the kit's own
// report: a report that says a source is at a sha is what a test is checking,
// not what it may believe.

import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';

import { git } from './cli.js';
import { writeSkill } from './skills.js';

/**
 * Who the commits in a test repository are by, and no signing: the owner's own
 * git config is his, and a test must not ask him for a passphrase.
 */
const BY_A_TEST = [
  '-c', 'user.name=A Test',
  '-c', 'user.email=test@example.invalid',
  '-c', 'commit.gpgsign=false',
];

/** Run git, and refuse to carry on when it did not work. Answers its output, trimmed. */
export async function gitOk(args, cwd) {
  const result = await git(args, cwd);
  assert.equal(result.code, 0, `git ${args.join(' ')} in ${cwd} should have worked: ${result.stderr}`);
  return result.stdout.trim();
}

/** A git repository at `dir`, on `main`, with nothing committed yet. */
export async function repoAt(dir) {
  await mkdir(dir, { recursive: true });
  await gitOk(['init', '--initial-branch=main'], dir);
  return dir;
}

/** Commit everything in a repository. Answers the sha it made. */
export async function commitIn(dir, message) {
  await gitOk(['add', '-A'], dir);
  await gitOk([...BY_A_TEST, 'commit', '-m', message], dir);
  return gitOk(['rev-parse', 'HEAD'], dir);
}

/** A lightweight tag, and a branch, on what the repository is at now. */
export const tagIn = (dir, name) => gitOk(['tag', name], dir);
export const branchIn = (dir, name) => gitOk(['branch', name], dir);

/** What a repository is at: the sha of HEAD, or of whatever `rev` names. */
export const shaIn = (dir, rev = 'HEAD') => gitOk(['rev-parse', rev], dir);

/** Which repository a clone was taken from: what its `origin` remote points at. */
export const originUrlOf = (dir) => gitOk(['remote', 'get-url', 'origin'], dir);

/**
 * Whether any ref in this repository knows that commit.
 *
 * The question a no-op has to answer. A `git fetch` moves the remote-tracking
 * refs, so a clone that has been fetched into knows the commits the origin has
 * made since — and one that has been left alone does not. Asked of the refs
 * rather than of the object store, because cloning a local repository shares
 * objects in ways that are the implementer's business.
 */
export async function refsKnow(dir, sha) {
  const seen = await gitOk(['rev-list', '--all'], dir);
  return seen.split('\n').includes(sha);
}

/** Skills written into a repository, `{ name: body }`, at `sub` inside it or at its root. */
export async function putSkills(dir, skills, sub = '') {
  for (const [name, body] of Object.entries(skills)) {
    await writeSkill(path.join(dir, sub, name), { body });
  }
  return dir;
}

/** A file inside a skill: what a source carrying scripts or hooks has in it. */
export async function putFile(dir, rel, text = 'echo "ran"\n') {
  const at = path.join(dir, rel);
  await mkdir(path.dirname(at), { recursive: true });
  await writeFile(at, text);
  return at;
}

/** Where the kit clones sources: the sibling of the bots folder, never inside it (ADR 0004). */
export const sourcesDirOf = (bots) => `${bots}.skill-sources`;

/** Where one source's clone goes. */
export const cloneOf = (bots, name) => path.join(sourcesDirOf(bots), name);

/** The user's own file that lists the sources. */
export const skillsYamlOf = (bots) => path.join(bots, 'skills.yaml');

/** Read it as text — what the user wrote — or as the mapping the kit reads. */
export const sourcesTextIn = (bots) => readFile(skillsYamlOf(bots), 'utf8');
export const sourcesIn = async (bots) => parse(await sourcesTextIn(bots)) ?? {};

/** What the file says about one source, named once however many are listed. */
export async function sourceEntryIn(bots, name) {
  const doc = await sourcesIn(bots);
  const found = (doc.sources ?? []).filter((source) => source?.name === name);
  assert.equal(found.length, 1, `skills.yaml should hold one source called ${name}, got: ${JSON.stringify(doc.sources)}`);
  return found[0];
}

/**
 * A `skills.yaml` as a user writes one: comments and all, and each source's
 * keys in the order the test gives them. `comment` goes on the source's first
 * line, which is where a user puts one.
 */
export const sourcesYaml = (...sources) => [
  '# Where this fleet gets its skills. My file, and it stays mine.',
  '',
  'sources:',
  ...sources.flatMap(({ comment, ...fields }) => Object.entries(fields).map(([key, value], at) => {
    const line = `${at === 0 ? '  - ' : '    '}${key}: ${value}`;
    return at === 0 && comment !== undefined ? `${line}  # ${comment}` : line;
  })),
  '',
].join('\n');

/** Write that file into a bots folder, in place of the one `init` seeded. */
export const writeSources = (bots, text) => writeFile(skillsYamlOf(bots), text);

/** A full sha, which is what a version the kit wrote down has to be. */
export function assertFullSha(sha, what) {
  assert.ok(
    typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha),
    `${what} should be a full sha, got: ${JSON.stringify(sha)}`,
  );
}

/** The answer of a `--json` run of fetch or update, parsed, with the list it carries. */
export function answerOf(result) {
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  assert.ok(Array.isArray(answer.sources), `the answer should carry a list of sources, got: ${result.stdout}`);
  return answer;
}

/** The one entry about one source. */
export function sourceIn(answer, name) {
  const found = answer.sources.filter((source) => source.name === name);
  assert.equal(found.length, 1, `one entry should be about ${name}, got: ${JSON.stringify(answer.sources)}`);
  return found[0];
}

/** The sources an answer reported, in the order it reported them. */
export const sourceNamesIn = (answer) => answer.sources.map((source) => source.name);

/**
 * The line of a plain report that is about one source, and what it has to say:
 * what became of it, the ref the user asked for and the sha it is at. The sha
 * may be shortened, as git shortens one, so it is looked for by its first
 * seven characters — which a full sha carries too.
 */
export function assertReported(stdout, name, { state, ref, sha }) {
  const lines = stdout.split('\n').filter((line) => line.includes(name));
  assert.notEqual(lines.length, 0, `the report should say something about ${name}, got:\n${stdout}`);
  const said = lines.filter((line) => line.includes(state) && line.includes(ref) && line.includes(sha.slice(0, 7)));
  assert.equal(
    said.length,
    1,
    `one line should say ${name} is ${state}, at ${ref}, and which sha that is, got:\n${lines.join('\n')}`,
  );
}

/**
 * Nothing under the bots folder holds the source's content: the repo holds no
 * copy (ADR 0004, and the acceptance for this slice).
 *
 * Only real files are read. A symlink into the clone is exactly what a bot is
 * given, so following one would read the source through the link the kit is
 * supposed to have made and call it a copy.
 */
export async function assertNoCopyIn(bots, marker) {
  const found = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const at = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(at);
      } else if (entry.isFile() && (await readFile(at, 'utf8').catch(() => '')).includes(marker)) {
        found.push(path.relative(bots, at));
      }
    }
  }
  await walk(bots);
  assert.deepEqual(found, [], 'the bots repo holds no copy of a source: a bot is given a link to the clone beside it');
}

/** The clone is beside the bots folder, and not inside it. */
export function assertBesideTheBots(bots, name) {
  const sources = sourcesDirOf(bots);
  assert.equal(path.dirname(sources), path.dirname(bots), `${sources} should sit beside ${bots}`);
  assert.ok(
    path.relative(bots, cloneOf(bots, name)).startsWith('..'),
    `${cloneOf(bots, name)} should be outside ${bots} altogether`,
  );
}
