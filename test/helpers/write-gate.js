// Loaded with `node --import` ahead of the kit, by test/codex-work-dir-race.test.js:
// it holds the kit's writes of one file at the two steps a plain write is made
// of, opening the file (which empties it) and writing into it, so a test can
// put two commands' steps in the order it wants.
//
//   OBK_TEST_WRITE_GATE_FILE  the file whose writes are held (absolute)
//   OBK_TEST_WRITE_GATE       the gate: a write of the file writes
//                             `<gate>.ready` and waits for `<gate>.open`; it
//                             then opens the file for writing, empty, writes
//                             `<gate>.opened`, and waits for `<gate>.write`
//                             before it writes the text and closes the file
//
// The two steps are the ones fs.writeFileSync(path, text) and
// fs.promises.writeFile(path, text) make themselves: open with truncation, then
// write. Only a write that names the file is held; a write to another file, a
// rename over it, or a write through a descriptor goes through as it is. The
// variables are taken out of the environment at load, so a process the kit
// starts is not held. Without them it changes nothing.

import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NAMES = ['OBK_TEST_WRITE_GATE_FILE', 'OBK_TEST_WRITE_GATE'];
const [target, gate] = NAMES.map((name) => process.env[name]);
for (const name of NAMES) delete process.env[name];

if (target !== undefined && target !== '' && gate !== undefined && gate !== '') {
  const { closeSync, existsSync, openSync } = fs;
  const writeFileSync = fs.writeFileSync;
  const writeFilePromise = fs.promises.writeFile;
  const cell = new Int32Array(new SharedArrayBuffer(4));
  // Blocked, not polled by the event loop: nothing else in the process runs.
  const waitFor = (file) => { while (!existsSync(file)) Atomics.wait(cell, 0, 0, 10); };
  const mark = (step) => writeFileSync(`${gate}.${step}`, `${process.pid}\n`);

  /** Whether a write names the held file. */
  const held = (named) => {
    if (typeof named === 'string') return path.resolve(named) === target;
    if (named instanceof URL) return fileURLToPath(named) === target;
    if (Buffer.isBuffer(named)) return path.resolve(named.toString()) === target;
    return false;
  };

  /** Open the held file the way the write would, empty, once the test says so. */
  const opened = (named, options) => {
    mark('ready');
    waitFor(`${gate}.open`);
    const flag = (typeof options === 'object' && options?.flag) || 'w';
    const mode = (typeof options === 'object' && options?.mode) || 0o666;
    const fd = openSync(named, flag, mode);
    mark('opened');
    waitFor(`${gate}.write`);
    return fd;
  };

  fs.writeFileSync = function writeFileSyncHeld(named, data, options) {
    if (!held(named)) return writeFileSync.call(this, named, data, options);
    const fd = opened(named, options);
    try {
      return writeFileSync.call(this, fd, data, options);
    } finally {
      closeSync(fd);
    }
  };

  fs.promises.writeFile = async function writeFileHeld(named, data, options) {
    if (!held(named)) return writeFilePromise.call(this, named, data, options);
    const fd = opened(named, options);
    try {
      return writeFileSync(fd, data, options);
    } finally {
      closeSync(fd);
    }
  };

  syncBuiltinESMExports();
}
