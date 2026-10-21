// A process that ignores SIGTERM, for a system test of the kit's process stops
// (test/system/retire-stops-processes.test.js).
//
// The test starts it in a process group of its own, out of reach of the
// runner's hard stop (#653), and AGENTS.md forbids a kill by an id from ps. So
// the process bounds its own life: when a hard stop takes the test's teardown,
// it still ends by itself (#655).

/**
 * The program, for `node -e`: it ignores SIGTERM, says `ready` on its own line
 * once it does, and ends by itself, with code 0, after `seconds` seconds.
 */
export const stubbornProgram = (seconds) => 'process.on("SIGTERM", () => {}); process.stdout.write("ready\\n");'
  + ` setTimeout(() => process.exit(0), ${seconds * 1000});`;
