// The memory folder of a Claude bot: `claude-memory/` in the bot's own folder,
// one for each bot and shared by its sessions (#752, ADR 0056).
//
// Claude Code keys its memory by the top of the git repository, so every bot of
// a bots repo would share one folder, and the notes of one bot would load in
// every bot. So the kit names a folder in each bot's own folder on the launch
// line, by its physical path: a memory write to a path named as it lands opens
// no dialog (#722, tech notes, section 2). The kit makes the folder with a
// `.gitignore` of `*`, because a note can hold the user's words, and a push
// would publish it. It writes that file only when it makes the folder, so a
// user who deletes it keeps the notes in git.
//
// Whenever the answer is not sure, there is no answer, and the session runs on
// Claude Code's own default.

import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { slug } from './conversations.js';
import { selectedClaudeProfile } from './orca.js';

/** The folder's name in the bot folder. Not `memory`: a bot may keep a `memory.md` of its own there, and a disk that ignores case takes it for `MEMORY.md`. */
export const MEMORY_FOLDER = 'claude-memory';

/** The index Claude Code keeps in a memory folder, and writes with the first note. */
const INDEX = 'MEMORY.md';

/**
 * The folder to name for a Claude session of the bot at `home`, or undefined
 * when the kit names none: the bot, its repository or the user names a folder
 * of their own, or something that is not a plain folder is at the path. It
 * makes nothing; `madeMemoryFolder` does.
 */
export function physicalMemoryFolder(home) {
  let bot;
  try {
    bot = realpathSync(home);
  } catch {
    return undefined;
  }
  const folder = path.join(bot, MEMORY_FOLDER);
  const there = lstatSync(folder, { throwIfNoEntry: false });
  if (there !== undefined && !there.isDirectory()) return undefined;
  // Claude Code reads a project's local settings from the top of its repository
  // as well as from the bot's folder, and the user's from the profile Orca
  // routes the tab to, or from the user's own folder with none.
  const profile = selectedClaudeProfile();
  const root = projectRoot(home);
  const named = [
    path.join(home, '.claude', 'settings.json'),
    path.join(home, '.claude', 'settings.local.json'),
    ...(root === undefined ? [] : [path.join(root, '.claude', 'settings.local.json')]),
    profile === undefined ? path.join(homedir(), '.claude', 'settings.json') : path.join(profile, 'settings.json'),
  ];
  return named.some(namesMemoryFolder) ? undefined : folder;
}

/**
 * The folder to name for a Claude session of the bot at `home`, made with its
 * `.gitignore` when nothing is there yet; undefined when the kit names none or
 * cannot make it. A folder that is there is left as it is.
 */
export function madeMemoryFolder(home) {
  const folder = physicalMemoryFolder(home);
  if (folder === undefined || existsSync(folder)) return folder;
  // mkdir refuses a folder that someone else made in the meantime, so the kit
  // writes the ignore file only into a folder it made itself.
  try {
    mkdirSync(folder);
  } catch {
    return undefined;
  }
  const ignore = path.join(folder, '.gitignore');
  let opened;
  try {
    // Opened here with wx, so the kit knows the file is its own: one that
    // another process made in the meantime refuses the open.
    opened = openSync(ignore, 'wx');
    writeFileSync(opened, '*\n');
    closeSync(opened);
    return folder;
  } catch {
    // A folder the kit made stays only with its ignore file (reviews of PR
    // #762). The kit takes back only its own ignore file, a write of which
    // may have failed after the open, and then the folder, which rmdir takes
    // only while it is empty, so no note goes.
    if (opened !== undefined) {
      try {
        closeSync(opened);
      } catch {
        // Closed already, or not closable: the file is unlinked all the same.
      }
      try {
        unlinkSync(ignore);
      } catch {
        // Then rmdir below fails too, and the folder is named nowhere.
      }
    }
    try {
      rmdirSync(folder);
    } catch {
      // Something was written into it at once; it is left, and named nowhere.
    }
    return undefined;
  }
}

/**
 * The notes the bots shared before #752, when the bot at `home` has none of its
 * own yet: `{ own, shared }`, or undefined. The shared folder is Claude Code's
 * default from before: under the real projects folder, the `memory` folder of
 * the first folder above the bot folder, nearest first, whose index exists.
 * Read only.
 */
export function sharedNotes(home) {
  const own = physicalMemoryFolder(home);
  if (own === undefined || existsSync(path.join(own, INDEX))) return undefined;
  const projects = projectsFolder();
  if (projects === undefined) return undefined;
  for (let at = path.dirname(path.dirname(own)); ; at = path.dirname(at)) {
    const shared = path.join(projects, slug(at.normalize('NFC')), 'memory');
    if (isFile(path.join(shared, INDEX))) return { own, shared };
    if (path.dirname(at) === at) return undefined;
  }
}

/** The real path of the projects folder Claude Code used: the selected profile's, or the user's own with none. */
function projectsFolder() {
  const profile = selectedClaudeProfile();
  const entry = profile === undefined ? path.join(homedir(), '.claude', 'projects') : path.join(profile, 'projects');
  try {
    return realpathSync(entry);
  } catch {
    return undefined;
  }
}

function isFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
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
 * The project root whose `.claude/settings.local.json` Claude Code reads: the
 * top of the git repository that holds `home`, the main repository's for a
 * linked worktree (tech notes, section 2). With no repository, it is `home`
 * itself. Undefined when the kit is not sure: a `.git`
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
