// The suite's way to the fake ps, lsof, stty, osascript and kill (#652).
//
// The kit runs `/bin/ps`, `/usr/sbin/lsof`, `/bin/stty`, `/usr/bin/osascript`
// and `/bin/kill` by those fixed paths and reads no setting that changes them.
// Every process a sandbox starts loads helpers/fake-tools.js through
// NODE_OPTIONS, and that test code sends each fixed path to the fake that the
// suite's own variable names: OBK_TEST_PS, OBK_TEST_LSOF, OBK_TEST_STTY,
// OBK_TEST_OSASCRIPT, OBK_TEST_KILL.
//
// What can break is the safety of the suite: a sandboxed run that reaches a
// real program reads the machine's process table, clicks the real Orca's menu,
// or sends a real signal. So these hold that:
//
//   - each fixed path, called the ways the kit can call it, runs its fake;
//   - with no fake named, the call does not reach the real program;
//   - a shell line that names a fixed path is refused, not run;
//   - any other program runs as it is;
//   - a sandbox's environment carries the preload and every fake, and a run
//     whose NODE_OPTIONS lost the preload is refused before it starts.
//
// Every check runs a child `node` with the sandbox's environment. Nothing here
// imports helpers/fake-tools.js into the suite's own process.

import assert from 'node:assert/strict';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';

import { createSandbox, FAKE_TOOLS_IMPORT, node } from './helpers/cli.js';

const TOOLS = [
  ['/bin/ps', 'OBK_TEST_PS'],
  ['/usr/sbin/lsof', 'OBK_TEST_LSOF'],
  ['/bin/stty', 'OBK_TEST_STTY'],
  ['/usr/bin/osascript', 'OBK_TEST_OSASCRIPT'],
  ['/bin/kill', 'OBK_TEST_KILL'],
];

/** A fake of our own that prints its name and its arguments, one JSON line. */
async function recorder(box, name) {
  const file = box.path(`recorder-${name}`);
  await writeFile(file, `#!/bin/sh\nprintf '%s\\n' "{\\"fake\\":\\"${name}\\",\\"args\\":\\"$*\\"}"\n`);
  await chmod(file, 0o755);
  return file;
}

/** Run `lines` as an ES module in a child node, with `env`; its stdout parsed as JSON. */
async function inChild(box, env, lines) {
  const ran = await node(['--input-type=module', '-e', lines.join('\n')], { cwd: box.cwd, env });
  assert.equal(ran.code, 0, `the child should run, got:\n${ran.stdout}${ran.stderr}`);
  return JSON.parse(ran.stdout);
}

test('FT1 the sandbox env loads the preload, and names a fake for each of the five fixed paths', async (t) => {
  const box = await createSandbox(t);

  assert.ok(box.env.NODE_OPTIONS.split(' ').includes(FAKE_TOOLS_IMPORT), `NODE_OPTIONS should load helpers/fake-tools.js, got: ${box.env.NODE_OPTIONS}`);
  assert.equal(box.env.OBK_TEST_PS, box.ps.cli);
  assert.equal(box.env.OBK_TEST_LSOF, box.lsof.cli);
  assert.equal(box.env.OBK_TEST_STTY, box.stty.cli);
  assert.equal(box.env.OBK_TEST_OSASCRIPT, box.osascript.cli);
  assert.equal(box.env.OBK_TEST_KILL, box.kill.cli);
  for (const name of ['OBK_PS', 'OBK_LSOF', 'OBK_STTY', 'OBK_OSASCRIPT', 'OBK_KILL', 'OBK_POLICY_ROOT']) {
    assert.equal(box.env[name], undefined, `the sandbox sets no ${name}: the kit reads none of them (#652)`);
  }
});

test('FT2 each fixed path runs its fake, through spawnSync, execFileSync, spawn and execFile, imported by name or from the module', async (t) => {
  const box = await createSandbox(t);
  const env = { ...box.env };
  for (const [, name] of TOOLS) env[name] = await recorder(box, name);

  const said = await inChild(box, env, [
    "import cp, { spawnSync, execFileSync, spawn, execFile } from 'node:child_process';",
    `const tools = ${JSON.stringify(TOOLS.map(([file]) => file))};`,
    'const out = {};',
    'const viaSpawn = (file) => new Promise((resolve) => { let text = ""; const child = spawn(file, ["three"]); child.stdout.on("data", (d) => { text += d; }); child.on("close", () => resolve(text)); });',
    'const viaExecFile = (file) => new Promise((resolve) => execFile(file, ["four"], (error, stdout) => resolve(stdout)));',
    'for (const file of tools) {',
    '  out[file] = [',
    '    spawnSync(file, ["one"], { encoding: "utf8" }).stdout,',
    '    execFileSync(file, ["two"], { encoding: "utf8" }),',
    '    await viaSpawn(file),',
    '    await viaExecFile(file),',
    '    cp.spawnSync(file, ["five"], { encoding: "utf8" }).stdout,',
    '  ].map((line) => JSON.parse(line));',
    '}',
    'process.stdout.write(JSON.stringify(out));',
  ]);

  for (const [file, name] of TOOLS) {
    assert.deepEqual(said[file], ['one', 'two', 'three', 'four', 'five'].map((args) => ({ fake: name, args })), `${file} should run the fake ${name} each way`);
  }
});

test('FT3 with no fake named, a fixed path does not start: the real program is never run', async (t) => {
  const box = await createSandbox(t);
  const env = { ...box.env };
  for (const [, name] of TOOLS) env[name] = '';

  const said = await inChild(box, env, [
    "import { spawnSync } from 'node:child_process';",
    `const tools = ${JSON.stringify(TOOLS.map(([file]) => file))};`,
    'const out = {};',
    // `kill -0 <own pid>` would succeed on the real kill; `-l` lists signals on it.
    'for (const file of tools) {',
    '  const ran = spawnSync(file, file === "/bin/kill" ? ["-0", String(process.pid)] : ["-l"], { encoding: "utf8" });',
    '  out[file] = { error: ran.error?.code ?? null, status: ran.status, stdout: ran.stdout ?? null };',
    '}',
    'process.stdout.write(JSON.stringify(out));',
  ]);

  for (const [file] of TOOLS) {
    assert.equal(said[file].error, 'ENOENT', `${file} with no fake named should not start at all, got: ${JSON.stringify(said[file])}`);
  }
});

test('FT4 a shell line that names a fixed path is refused, and does not run', async (t) => {
  const box = await createSandbox(t);
  const marker = box.path('ran');

  const said = await inChild(box, box.env, [
    "import { execSync, exec, spawnSync } from 'node:child_process';",
    'const out = [];',
    `const lines = ['/bin/kill -0 $$ && touch ${marker}', 'true; /bin/ps -A > ${marker}'];`,
    'for (const line of lines) {',
    '  try { execSync(line); out.push("ran"); } catch (error) { out.push(error.message.includes("fake-tools") ? "refused" : `failed: ${error.message}`); }',
    '  try { exec(line, () => {}); out.push("ran"); } catch (error) { out.push(error.message.includes("fake-tools") ? "refused" : `failed: ${error.message}`); }',
    '  try { spawnSync(line, { shell: true }); out.push("ran"); } catch (error) { out.push(error.message.includes("fake-tools") ? "refused" : `failed: ${error.message}`); }',
    '}',
    'process.stdout.write(JSON.stringify(out));',
  ]);

  assert.deepEqual(said, Array(6).fill('refused'));
  await assert.rejects(readFile(marker), { code: 'ENOENT' }, 'nothing of the refused lines ran');
});

test('FT5 any other program runs as it is', async (t) => {
  const box = await createSandbox(t);

  const said = await inChild(box, box.env, [
    "import { spawnSync, execSync } from 'node:child_process';",
    'process.stdout.write(JSON.stringify([spawnSync("/bin/echo", ["plain"], { encoding: "utf8" }).stdout, execSync("echo shell", { encoding: "utf8" })]));',
  ]);

  assert.deepEqual(said, ['plain\n', 'shell\n']);
});

test('FT6 a sandboxed run whose NODE_OPTIONS lost the preload is refused before it starts', async (t) => {
  const box = await createSandbox(t);

  await assert.rejects(
    box.run(['--version'], { env: { ...box.env, NODE_OPTIONS: '--no-deprecation' } }),
    /fake-tools/,
  );
  const kept = await box.run(['--version'], { env: { ...box.env, NODE_OPTIONS: `${box.env.NODE_OPTIONS} --no-deprecation` } });
  assert.equal(kept.code, 0, `adding to NODE_OPTIONS keeps the preload, and the run goes: ${kept.stderr}`);
});
