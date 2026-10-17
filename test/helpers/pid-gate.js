// Loaded with `node --import` ahead of the kit, by test/bot-yaml-write-link.test.js:
// before the kit runs at all, the process says its pid and waits, so a test
// can lay out files named after that pid first, as another program that
// guesses close-to-sequential pids could.
//
//   OBK_TEST_PID_GATE  the gate: the process writes its pid to `<gate>.pid`,
//                      then waits, blocked, until a file is at `<gate>.go`
//
// The pid is the process's own; nothing about the process is changed. The
// variable is taken out of the environment at load, so a process the kit
// starts does not wait. Without it this changes nothing.

import { existsSync, writeFileSync } from 'node:fs';

const gate = process.env.OBK_TEST_PID_GATE;
delete process.env.OBK_TEST_PID_GATE;

if (gate !== undefined && gate !== '') {
  writeFileSync(`${gate}.pid`, `${process.pid}\n`);
  const cell = new Int32Array(new SharedArrayBuffer(4));
  while (!existsSync(`${gate}.go`)) Atomics.wait(cell, 0, 0, 10);
}
