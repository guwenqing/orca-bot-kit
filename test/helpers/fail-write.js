// Loaded with `node --import` ahead of the kit, by a test that needs one file,
// and that file alone, to be one the kit cannot write: the way a folder the
// user cannot write refuses it, but with every other file beside it writable.
//
//   OBK_TEST_FAIL_WRITE_TO  the file (absolute)
//
// Refused, with EACCES as the system gives it: a write of the file or of a new
// file beside it named after it (`<file>.<anything>`, as a write through a new
// file and a rename makes), opening any of them for writing, and a rename onto
// the file. Reading it, and everything else, goes through as it is. The
// variable stays in the environment, so a process the kit starts is refused
// the same. Without it this changes nothing.

import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const target = process.env.OBK_TEST_FAIL_WRITE_TO;

if (target !== undefined && target !== '') {
  /** The file a call names, as an absolute path, or undefined for a descriptor or a handle. */
  const fileOf = (named) => {
    if (typeof named === 'string') return path.resolve(named);
    if (named instanceof URL) return fileURLToPath(named);
    if (Buffer.isBuffer(named)) return path.resolve(named.toString());
    return undefined;
  };
  const refused = (named) => {
    const file = fileOf(named);
    return file !== undefined && (file === target || file.startsWith(`${target}.`));
  };
  const writes = (flags) => flags !== undefined && flags !== 'r' && flags !== 'rs' && flags !== fs.constants.O_RDONLY;
  const denied = (syscall, named, to) => {
    const where = to === undefined ? `'${fileOf(named)}'` : `'${fileOf(named)}' -> '${fileOf(to)}'`;
    return Object.assign(new Error(`EACCES: permission denied, ${syscall} ${where}`), {
      errno: -13, code: 'EACCES', syscall, path: fileOf(named), ...(to === undefined ? {} : { dest: fileOf(to) }),
    });
  };

  const { openSync, renameSync, writeFileSync } = fs;
  const { open, rename, writeFile } = fs.promises;

  fs.writeFileSync = function writeFileSyncRefused(named, ...rest) {
    if (refused(named)) throw denied('open', named);
    return writeFileSync.call(this, named, ...rest);
  };
  fs.openSync = function openSyncRefused(named, flags, ...rest) {
    if (refused(named) && writes(flags)) throw denied('open', named);
    return openSync.call(this, named, flags, ...rest);
  };
  fs.renameSync = function renameSyncRefused(from, to) {
    if (fileOf(to) === target) throw denied('rename', from, to);
    return renameSync.call(this, from, to);
  };
  fs.promises.writeFile = async function writeFileRefused(named, ...rest) {
    if (refused(named)) throw denied('open', named);
    return writeFile.call(this, named, ...rest);
  };
  fs.promises.open = async function openRefused(named, flags, ...rest) {
    if (refused(named) && writes(flags)) throw denied('open', named);
    return open.call(this, named, flags, ...rest);
  };
  fs.promises.rename = async function renameRefused(from, to) {
    if (fileOf(to) === target) throw denied('rename', from, to);
    return rename.call(this, from, to);
  };

  syncBuiltinESMExports();
}
