// The physical memory folder of a Claude session, when the path Claude Code
// would use leads through a link (#722, ADR 0054).
//
// Orca starts a Claude tab with CLAUDE_CONFIG_DIR at a profile of its own,
// where `projects` is a link to `~/.claude/projects`. Claude Code names its
// memory folder through that link, and a write there stops on a dialog that
// only a person can answer (tech notes, section 2). Named by its real path, the
// same folder has no dialog. Whenever the answer is not sure, there is no
// answer, and the session runs as it did: a dialog costs a wait, and a wrong
// folder costs the session its memory.

import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

import { slug } from './conversations.js';
import { selectedClaudeProfile } from './orca.js';

/** The longest slug Claude Code uses as it is. Past this it adds a hash of its own. */
const LONGEST_SLUG = 200;

/**
 * The folder to name for a session of the bot at `home`, or undefined when the
 * kit should name none: no profile is routed, its `projects` is no link, the
 * bot or the profile names a folder of its own, the project root is not sure,
 * or the slug is too long.
 */
export function physicalMemoryFolder(home) {
  const profile = selectedClaudeProfile();
  if (profile === undefined) return undefined;
  const projects = linkedFolder(path.join(profile, 'projects'));
  if (projects === undefined) return undefined;
  const root = projectRoot(home);
  if (root === undefined) return undefined;
  // Claude Code reads a project's local settings from the top of its repository as well as from the bot's folder.
  const named = [
    path.join(home, '.claude', 'settings.json'),
    path.join(home, '.claude', 'settings.local.json'),
    path.join(root, '.claude', 'settings.local.json'),
    path.join(profile, 'settings.json'),
  ];
  if (named.some(namesMemoryFolder)) return undefined;
  // Claude Code holds its project root in NFC, whatever form the disk has.
  const name = slug(root.normalize('NFC'));
  return name.length > LONGEST_SLUG ? undefined : path.join(projects, name, 'memory');
}

/** The real path of the folder the link `entry` leads to, or undefined when it is not such a link. */
function linkedFolder(entry) {
  try {
    if (!lstatSync(entry).isSymbolicLink()) return undefined;
    return statSync(entry).isDirectory() ? realpathSync(entry) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether the settings file `file` may name a memory folder of its own: it has
 * the key, or it is there and cannot be read, so the kit cannot tell.
 */
function namesMemoryFolder(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    return error.code !== 'ENOENT' && error.code !== 'ENOTDIR';
  }
  try {
    const settings = JSON.parse(text);
    return settings !== null && typeof settings === 'object' && Object.hasOwn(settings, 'autoMemoryDirectory');
  } catch {
    return true;
  }
}

/**
 * The folder Claude Code keys memory by: the top of the git repository that
 * holds `home`, the main repository's for a linked worktree, since every
 * worktree of a repository shares one memory (tech notes, section 2). With no
 * repository, it is `home` itself. Undefined when the kit is not sure: a `.git`
 * is on the way and git cannot say what it is, a linked worktree's shared git
 * folder is not named `.git`, or the `.git` at the top is a link.
 */
function projectRoot(home) {
  const shared = revParse(home, '--git-common-dir');
  if (shared === undefined) return gitOnTheWay(home) ? undefined : realpathSync(home);
  const own = revParse(home, '--git-dir');
  if (own === undefined) return undefined;
  const main = realpathSync(path.resolve(home, shared));
  const linked = realpathSync(path.resolve(home, own)) !== main;
  // Only a linked worktree tells its main repository by the shared git folder:
  // `--separate-git-dir` puts a repository's own git folder away from its top.
  const top = !linked ? revParse(home, '--show-toplevel') : path.basename(main) === '.git' ? path.dirname(main) : undefined;
  if (top === undefined) return undefined;
  return lstatSync(path.join(top, '.git'), { throwIfNoEntry: false })?.isSymbolicLink() ? undefined : top;
}

/** Whether `folder` or a folder above it holds a `.git` entry. */
function gitOnTheWay(folder) {
  for (let at = realpathSync(folder); ; at = path.dirname(at)) {
    if (existsSync(path.join(at, '.git'))) return true;
    if (path.dirname(at) === at) return false;
  }
}

/** One answer of `git rev-parse` in `folder`, or undefined when git gives none. */
function revParse(folder, question) {
  const asked = spawnSync('git', ['-C', folder, 'rev-parse', question], { encoding: 'utf8' });
  // Only git's record terminator comes off: trailing whitespace may be part of the folder's name.
  const answer = (asked.stdout ?? '').replace(/\n$/, '');
  return asked.status === 0 && answer !== '' ? answer : undefined;
}
