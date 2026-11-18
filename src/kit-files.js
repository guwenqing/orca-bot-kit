/**
 * The files and folders that only the kit writes and reads: its folders beside
 * the bots folder (its locks, its start prompts, its mail bodies, a Claude
 * bot's main text) and what is in them (#764).
 *
 * The kit writes many of these again at a later start. So a start must not
 * depend on the umask it runs under: under a umask that takes away the owner's
 * write bit, a folder the kit makes has mode 555 and a file 444, and the kit's
 * next write there fails. What the kit makes here therefore gets the owner's
 * bits. Group and other bits stay as the umask gives them: the kit widens
 * nothing for anyone else.
 *
 * A file that a user reads or edits by hand (bot.yaml, the book, AGENTS.md,
 * the rules) is not one of these, and keeps the mode the umask gives it.
 */

import { chmodSync, closeSync, existsSync, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** The owner's read, write and search bits, which a folder of the kit's gets. */
const FOLDER_BITS = 0o700;

/** The owner's read and write bits, which a file of the kit's gets. */
const FILE_BITS = 0o600;

/**
 * Make the kit's folder `dir`, with each folder above it that is not there.
 * Each folder that this call made gets the owner's bits. A folder that was
 * there already keeps its mode. The folders are made one at a time, from the
 * top: a recursive mkdir under such a umask cannot make the second level, as
 * the first has no write bit.
 *
 * A Codex session may write a kit folder of its bot's, and so could put a link
 * where the kit has just made a folder. The kit makes no folder inside those,
 * so the folders it gives its bits to here are not ones a session can replace.
 */
export function makeKitFolder(dir) {
  const missing = [];
  for (let at = path.resolve(dir); !existsSync(at) && at !== path.dirname(at); at = path.dirname(at)) missing.unshift(at);
  for (const at of missing) {
    try {
      mkdirSync(at);
    } catch (error) {
      // Made by another process in between: that one's, so its mode stays.
      if (error.code === 'EEXIST') continue;
      throw error;
    }
    const { mode } = lstatSync(at);
    if ((mode & FOLDER_BITS) !== FOLDER_BITS) chmodSync(at, (mode & 0o7777) | FOLDER_BITS);
  }
}

/** Give the file open at `fd` the owner's read and write bits, if it lacks one. */
export function ownerMayWrite(fd) {
  const { mode } = fstatSync(fd);
  if ((mode & FILE_BITS) !== FILE_BITS) fchmodSync(fd, (mode & 0o7777) | FILE_BITS);
}

/** Whether a plain file is at `file` that its owner may not write. */
export function ownerCannotWrite(file) {
  try {
    const stat = lstatSync(file);
    return stat.isFile() && (stat.mode & 0o200) === 0;
  } catch {
    return false;
  }
}

/**
 * Write `text` to the kit's file `file`, in its kit folder, which this makes
 * if it is not there. A file the kit makes gets the owner's bits. A file that
 * an earlier start left without the owner's write bit is the kit's own, so it
 * is made again; any other file there is written over as it is.
 */
export function writeKitFile(file, text) {
  makeKitFolder(path.dirname(file));
  let fd;
  try {
    fd = openSync(file, 'w');
  } catch (error) {
    if (error.code !== 'EACCES' || !ownerCannotWrite(file)) throw error;
    rmSync(file);
    fd = openSync(file, 'wx');
  }
  try {
    ownerMayWrite(fd);
    writeFileSync(fd, text);
  } finally {
    closeSync(fd);
  }
}

/**
 * Run `work` with the owner's bits taken out of the umask, and give the umask
 * back after. For what the kit makes that another program fills: the `.git`
 * the kit makes in a bot home for one `orca repo add` and takes away after,
 * which git cannot fill under a umask that takes away the owner's write bit.
 * The group and other bits of the umask stay. `work` is synchronous, so
 * nothing else of the kit's runs under this umask.
 */
export function withOwnerBits(work) {
  const was = process.umask(0);
  process.umask(was & ~FOLDER_BITS);
  try {
    return work();
  } finally {
    process.umask(was);
  }
}
