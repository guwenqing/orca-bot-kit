// Loaded with `node --import` ahead of the kit, by test/codex-work-dir-race.test.js:
// it watches the kit's reads of one file, so a test can stop a command
// between its reads and its write and run another command in that gap.
//
//   OBK_TEST_READ_GATE_FILE   the file whose reads are watched (absolute)
//   OBK_TEST_READ_GATE_LOG    each watched read appends one line here
//   OBK_TEST_READ_GATE_AT     the watched read to stop after: 1 is the first,
//                             0 or unset stops at none
//   OBK_TEST_READ_GATE_OPEN   the gate: once the stop is reached, the process
//                             writes `<gate>.reached` and waits, blocked, until
//                             a file is at this path, then hands the read back
//
// The read has happened when the process stops: what it read is what the file
// held before the other command ran. Both fs.readFileSync and the promise and
// callback forms of readFile are watched, so which one the kit uses does not
// matter. The variables are taken out of the environment at load, so a process
// the kit starts is not watched. Without them it changes nothing.

import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NAMES = ['OBK_TEST_READ_GATE_FILE', 'OBK_TEST_READ_GATE_LOG', 'OBK_TEST_READ_GATE_AT', 'OBK_TEST_READ_GATE_OPEN'];
const [target, log, at, gate] = NAMES.map((name) => process.env[name]);
for (const name of NAMES) delete process.env[name];

if (target !== undefined && target !== '') {
  const stopAt = Number(at ?? 0);
  const { appendFileSync, existsSync, writeFileSync } = fs;
  const cell = new Int32Array(new SharedArrayBuffer(4));
  let reads = 0;

  /** The file a read names, as an absolute path, or undefined for a descriptor or a handle. */
  const fileOf = (named) => {
    if (typeof named === 'string') return path.resolve(named);
    if (named instanceof URL) return fileURLToPath(named);
    if (Buffer.isBuffer(named)) return path.resolve(named.toString());
    return undefined;
  };

  /** After a read of the watched file: count it, write it down, and stop there when it is the one. */
  const watched = (named) => {
    if (fileOf(named) !== target) return;
    reads += 1;
    if (log) appendFileSync(log, `${reads}\n`);
    if (reads !== stopAt || !gate) return;
    writeFileSync(`${gate}.reached`, `${process.pid}\n`);
    // Blocked, not polled by the event loop: nothing else in the process runs
    // until the test opens the gate.
    while (!existsSync(gate)) Atomics.wait(cell, 0, 0, 10);
  };

  const readFileSync = fs.readFileSync;
  fs.readFileSync = function readFileSyncWatched(named, ...rest) {
    const content = readFileSync.call(this, named, ...rest);
    watched(named);
    return content;
  };

  const readFilePromise = fs.promises.readFile;
  fs.promises.readFile = async function readFileWatched(named, ...rest) {
    const content = await readFilePromise.call(this, named, ...rest);
    watched(named);
    return content;
  };

  const readFileCallback = fs.readFile;
  fs.readFile = function readFileCallbackWatched(named, ...rest) {
    const done = rest.pop();
    return readFileCallback.call(this, named, ...rest, (error, content) => {
      if (!error) watched(named);
      done(error, content);
    });
  };

  syncBuiltinESMExports();
}
