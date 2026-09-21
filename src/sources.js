// Skills from an online repo, at the version the user pinned (PRD 6.7, ADR 0004).
//
// A source is a git repository the user names in `<bots>/skills.yaml`. The kit
// clones it into `<bots>.skill-sources/<name>`, a sibling of the bots folder and
// never inside it, so the user's repo holds no copy of anybody else's work.
//
// The one thing this must never do is move a clone on its own. `fetch` gets
// what is missing and leaves what is there exactly where it is — even when the
// ref is a branch the origin has carried on past. `update` is the user asking,
// and it is the only thing that moves a clone. So the version a bot runs
// changes when they say so and at no other time.
//
// What they asked for is `ref` and what they got is `sha`, both in their own
// file, so the difference is theirs to see.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';

import { changesExactly, YAML_OUT } from './bot.js';

/** The user's file that lists where skills come from. */
const SKILLS_YAML = 'skills.yaml';

/** Where the clones go: beside the bots folder, named after it. */
export const sourcesDir = (bots) => `${bots}.skill-sources`;

/** Where one source's clone goes. */
export const cloneDir = (bots, name) => path.join(sourcesDir(bots), name);

/** A source's name, which is also the folder it is cloned into and the prefix a bot names it by. */
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The prefix issue #35 gave the kit's own shelf, and so not a name a source may take. */
const TAKEN = ['kit'];

/**
 * What looks like something that runs. Not a scan and not a gate: the user
 * takes the risk for a third-party skill (PRD 6.7), and what the kit owes them
 * is knowing there is a risk to take.
 */
const RUNS = /\.(sh|bash|zsh|py|rb|pl|js|mjs|cjs|ts)$/i;
const RUNS_DIR = /^(scripts?|hooks?|bin)$/i;

/**
 * Fetch what is missing, or move what the user asks to move.
 * Returns one entry per source: `{ name, state, ref, sha }`, or `{ name, trouble }`.
 *
 * `moving` is the whole difference between the two commands. Without it a
 * source already cloned is reported as it stands and nothing reaches the
 * network; with it the ref is resolved again and the clone follows.
 */
export function fetchSources(bots, { source: onlySource, moving = false } = {}) {
  const file = path.join(bots, SKILLS_YAML);
  const sources = readSources(file);

  if (onlySource !== undefined && !sources.some((source) => source.name === onlySource)) {
    throw new Error(`${file} lists no source called ${onlySource}. The sources it lists are: ${sources.map((one) => one.name).join(', ') || 'none'}.`);
  }

  const wanted = onlySource === undefined ? sources : sources.filter((source) => source.name === onlySource);
  const report = [];
  const got = new Map();

  for (const source of wanted) {
    try {
      const at = bring(bots, source, moving);
      got.set(source.name, at.sha);
      report.push({ name: source.name, state: at.state, ref: source.ref, sha: at.sha, ...(at.runs ? { runs: true } : {}) });
    } catch (error) {
      report.push({ name: source.name, trouble: error.message });
    }
  }

  writeShas(file, got);
  return report;
}

/**
 * Put one source's clone where it belongs, and say what that took.
 *
 * Three things this has to get right, because each is a way of running a
 * version nobody chose:
 *
 * - A directory under the sources folder means a source at the version that was
 *   asked for, and nothing else. The clone and the checkout happen out of the
 *   way and are moved into place once both have worked, so a checkout that
 *   fails leaves nothing for the next run to mistake for a source.
 * - A clone that has gone missing comes back at the commit the file records,
 *   not at whatever its ref points to today. Restoring is not moving.
 * - A clone is this source's only while it came from the repository the file
 *   names. Point a source somewhere else and the old clone is not an answer.
 */
function bring(bots, source, moving) {
  const dir = cloneDir(bots, source.name);

  if (existsSync(dir)) {
    const from = originOf(dir);
    if (from !== source.repo) {
      if (!moving) {
        throw new Error(`${source.name}: the clone beside your bots folder came from ${from}, and skills.yaml now names ${source.repo}. Run obk skills update --source ${source.name} to take it from there instead.`);
      }
      rmSync(dir, { recursive: true, force: true });
      return clone(bots, source, source.ref, false);
    }

    if (!moving) return { state: 'there', sha: headOf(dir), runs: carriesScripts(skillsIn(bots, source)) };

    const was = headOf(dir);
    git(['fetch', '--quiet', '--tags', '--force', 'origin'], dir, `${source.name}: ${source.repo} could not be fetched from`);
    checkout(dir, source, source.ref, false);
    const now = headOf(dir);
    return { state: now === was ? 'there' : 'moved', sha: now, runs: carriesScripts(skillsIn(bots, source)) };
  }

  // Nothing there. A fetch puts back the version the file records; only the
  // asking takes what the ref names now.
  const recorded = typeof source.sha === 'string' && source.sha.trim() !== '';
  return clone(bots, source, !moving && recorded ? source.sha.trim() : source.ref, !moving && recorded);
}

/**
 * Clone a source and check it out out of the way, and put it in place only once
 * both have worked. `<name>.fetching` is where it happens; a run that cannot
 * finish leaves that behind and not a source.
 */
function clone(bots, source, rev, recorded) {
  mkdirSync(sourcesDir(bots), { recursive: true });
  const dir = cloneDir(bots, source.name);
  const fetching = `${dir}.fetching`;

  try {
    rmSync(fetching, { recursive: true, force: true });
    git(['clone', '--quiet', source.repo, fetching], undefined, `${source.name}: ${source.repo} could not be cloned`);
    checkout(fetching, source, rev, recorded);
    renameSync(fetching, dir);
  } finally {
    rmSync(fetching, { recursive: true, force: true });
  }

  return { state: 'cloned', sha: headOf(dir), runs: carriesScripts(skillsIn(bots, source)) };
}

/** Where a clone came from, as git itself has it written down. */
function originOf(dir) {
  const found = spawnSync('git', ['config', '--get', 'remote.origin.url'], { cwd: dir, encoding: 'utf8' });
  return found.status === 0 ? found.stdout.trim() : undefined;
}

/**
 * Check a clone out at `rev`. A branch, a tag and a sha all go the same way in,
 * which is why the kit does not ask which kind it was given.
 *
 * The origin's idea of a branch is the one that counts. A fetch moves
 * `origin/main` and leaves the local `main` where it was, so checking out the
 * bare name would quietly keep the old commit and report a move that never
 * happened. A tag or a sha has no `origin/` form and falls through to itself.
 */
function checkout(dir, source, rev, recorded) {
  const at = [`refs/remotes/origin/${rev}`, rev]
    .map((candidate) => resolve(dir, candidate))
    .find((sha) => sha !== undefined);

  if (at === undefined) {
    throw new Error(recorded
      ? `${source.name}: ${source.repo} no longer has the commit skills.yaml records for it (${rev.slice(0, 7)}), so the version you pinned cannot be put back. Run obk skills update --source ${source.name} to take what ${source.ref} names now, or point it at a version the repo still has.`
      : `${source.name}: ${source.repo} has nothing called ${rev}`);
  }
  git(['-c', 'advice.detachedHead=false', 'checkout', '--quiet', at], dir, `${source.name}: could not go to ${rev}`);
}

/** The commit a name stands for in this clone, or nothing when it stands for none. */
function resolve(dir, rev) {
  const found = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { cwd: dir, encoding: 'utf8' });
  return found.status === 0 && found.stdout.trim() !== '' ? found.stdout.trim() : undefined;
}

/** What a clone is at now. */
const headOf = (dir) => git(['rev-parse', 'HEAD'], dir, 'could not read what the clone is at');

/** Run git, and turn a refusal into a sentence the user can act on. */
function git(args, cwd, trouble) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.error) throw new Error(`could not run git: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${trouble}: ${(result.stderr || '').trim().split('\n').at(-1) ?? ''}`);
  return result.stdout.trim();
}

/** Where a source's skills sit inside its clone: its root, or the subfolder it names. */
export const skillsIn = (bots, source) => path.join(cloneDir(bots, source.name), source.path ?? '');

/**
 * Whether anything under a source's skills runs. One answer for the whole
 * source, because one line is what the user is owed, however much is in there.
 */
function carriesScripts(dir) {
  let found = false;
  const look = (at, depth) => {
    if (found || depth > 4) return;
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (found) return;
      if (entry.isDirectory()) {
        if (RUNS_DIR.test(entry.name)) found = true;
        else look(path.join(at, entry.name), depth + 1);
      } else if (RUNS.test(entry.name)) {
        found = true;
      }
    }
  };

  try {
    // The skills themselves, and not the repository around them: every clone
    // carries a `.git/hooks`, and a question about what a source runs that
    // answers yes for all of them answers nothing.
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !existsSync(path.join(dir, entry.name, 'SKILL.md'))) continue;
      look(path.join(dir, entry.name), 1);
    }
  } catch {
    // A source whose skills cannot be walked is not a source to make claims
    // about. Saying nothing is the honest answer.
    return false;
  }
  return found;
}

/**
 * The sources the user listed, checked far enough that the kit knows what it is
 * being asked for. A file it cannot read is refused whole rather than half
 * followed, and nothing is written to it.
 */
export function readSources(file) {
  if (!existsSync(file)) return [];

  const doc = parseDocument(readFileSync(file, 'utf8'));
  if (doc.errors.length > 0) {
    throw new Error(`${file} is not readable as YAML: ${doc.errors[0].message.split('\n')[0]}`);
  }

  const listed = doc.toJS()?.sources;
  if (listed === undefined || listed === null) return [];
  if (!Array.isArray(listed)) {
    throw new Error(`${file} has a sources entry that is not a list of sources.`);
  }

  const names = new Set();
  return listed.map((source) => {
    if (source === null || typeof source !== 'object' || Array.isArray(source)) {
      throw new Error(`${file} has a source that is not a mapping: a source has a name, a repo and a ref.`);
    }
    const { name, repo, ref } = source;
    if (typeof name !== 'string' || !NAME.test(name)) {
      throw new Error(`${file} has a source called ${JSON.stringify(name)}, and a source is named in lower-case letters, digits and single hyphens.`);
    }
    if (TAKEN.includes(name)) {
      throw new Error(`${file} has a source called ${name}, and that name is the kit's own shelf: a bot names one of the kit's skills kit:<name>. Call it something else.`);
    }
    if (names.has(name)) throw new Error(`${file} lists ${name} more than once.`);
    names.add(name);

    if (typeof repo !== 'string' || repo.trim() === '') {
      throw new Error(`${file}: the source ${name} has no repo to clone.`);
    }
    if (typeof ref !== 'string' || ref.trim() === '') {
      throw new Error(`${file}: the source ${name} has no ref, so there is no version to pin it at.`);
    }
    if (source.path !== undefined && typeof source.path !== 'string') {
      throw new Error(`${file}: the source ${name} has a path that is not a subfolder inside the repo.`);
    }
    return source;
  });
}

/**
 * Write each source's resolved sha back into the user's own file, and change
 * nothing else in it. The file is theirs: the comments, the order and every
 * value they wrote come back as they wrote them, and a file the kit cannot
 * edit that narrowly is left alone and said so.
 */
function writeShas(file, got) {
  if (got.size === 0) return;

  const source = readFileSync(file, 'utf8');
  const doc = parseDocument(source);
  const listed = doc.get('sources', true);
  let changed = false;

  for (const entry of listed?.items ?? []) {
    const name = entry?.get?.('name');
    if (!got.has(name) || entry.get('sha') === got.get(name)) continue;
    entry.set('sha', got.get(name));
    changed = true;
  }
  if (!changed) return;

  const text = doc.toString(YAML_OUT);
  if (!changesExactly(source, text, (was) => ({
    ...was,
    sources: was.sources.map((one) => (got.has(one.name) ? { ...one, sha: got.get(one.name) } : one)),
  }))) {
    throw new Error(`${file} cannot have the versions written into it without changing something else in it, so nothing was written. Add a sha to each source by hand, or let the kit rewrite the file.`);
  }
  writeFileSync(file, text);
}

/** Whether a bots folder has a clone of this source yet. */
export const isCloned = (bots, name) => statSync(cloneDir(bots, name), { throwIfNoEntry: false })?.isDirectory() === true;
