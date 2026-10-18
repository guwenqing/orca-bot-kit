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
//     whose NODE_OPTIONS lost the preload is refused before it starts;
//   - a call of another program that would reach a fixed path is refused: an
//     explicit shell with -c (by name or path), a wrapper (FT7, the review of
//     PR #656);
//   - kill, osascript and stty by another spelling, as programs or as words of
//     a shell line, are refused (FT8);
//   - process.kill() of a process or a group that this process did not start
//     is refused (FT9), and of its own child and that child's group it goes
//     through, which a runner needs to stop what it started (FT11, after
//     scripts/test-system.js of #653 met FT9's refusal);
//   - the preload reaches a grandchild whose environment keeps NODE_OPTIONS,
//     and not one whose environment drops it, as helpers/fake-tools.js says
//     (FT10).
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

/**
 * Run each of `calls`, a JavaScript expression, in a child node with the
 * sandbox's environment: `refused` when the preload refused it, else what it
 * gave. `marker` is a file a call that ran would make.
 */
async function eachOf(box, calls, env = box.env) {
  return inChild(box, env, [
    "import cp, { spawnSync, spawn, execFile, execFileSync, execSync, exec } from 'node:child_process';",
    `const calls = ${JSON.stringify(calls)};`,
    'const out = [];',
    'for (const call of calls) {',
    '  try { await eval(call); out.push("ran"); } catch (error) { out.push(error.message.includes("helpers/fake-tools.js") ? "refused" : `failed: ${error.message}`); }',
    '}',
    'process.stdout.write(JSON.stringify(out));',
  ]);
}

test('FT7 another program that would reach a fixed path is refused: a shell with -c, by name or by path, and a wrapper', async (t) => {
  const box = await createSandbox(t);
  const marker = box.path('ran');
  const touch = `/usr/bin/touch ${marker}`;

  const calls = [
    `spawnSync('/bin/sh', ['-c', '/bin/kill -l; ${touch}'])`,
    `spawnSync('sh', ['-c', '/bin/kill -0 $$ && ${touch}'])`,
    `spawnSync('/bin/bash', ['-c', 'true; /bin/ps -A > ${marker}'])`,
    `execFileSync('zsh', ['-lc', '/usr/sbin/lsof -v; ${touch}'])`,
    `spawn('/bin/dash', ['-c', '/usr/bin/osascript -e 1; ${touch}'])`,
    `execFile('ksh', ['-c', '/bin/stty -a; ${touch}'], () => {})`,
    `spawnSync('/usr/bin/env', ['/bin/kill', '-l'])`,
    `spawnSync('/usr/bin/xargs', ['/bin/kill', '-l'])`,
    `cp.spawnSync('/bin/sh', ['-c', '/bin/kill -l'])`,
  ];
  const said = await eachOf(box, calls);

  assert.deepEqual(said.map((one, at) => `${calls[at]}: ${one}`), calls.map((call) => `${call}: refused`));
  await assert.rejects(readFile(marker), { code: 'ENOENT' }, 'nothing of the refused calls ran');
});

test('FT8 kill, osascript and stty by any other spelling are refused, as programs and as words of a shell line', async (t) => {
  const box = await createSandbox(t);
  const marker = box.path('ran');
  const touch = `/usr/bin/touch ${marker}`;

  const calls = [
    "spawnSync('kill', ['-0', String(process.pid)])",
    "spawnSync('/usr/bin/kill', ['-0', String(process.pid)])",
    "execFileSync('osascript', ['-e', '1'])",
    "spawnSync('stty', ['-a'])",
    `spawnSync('/bin/sh', ['-c', 'kill -0 $$ && ${touch}'])`,
    `spawnSync('bash', ['-c', 'stty -a; ${touch}'])`,
    `execSync('kill -0 $$ && ${touch}')`,
    `exec('osascript -e 1; ${touch}', () => {})`,
    `spawnSync('kill -0 $$ && ${touch}', { shell: true })`,
  ];
  const said = await eachOf(box, calls);

  assert.deepEqual(said.map((one, at) => `${calls[at]}: ${one}`), calls.map((call) => `${call}: refused`));
  await assert.rejects(readFile(marker), { code: 'ENOENT' }, 'nothing of the refused calls ran');

  // A line or a path that only has the word inside another word is not refused.
  const plain = await eachOf(box, [
    `spawnSync('/bin/sh', ['-c', 'echo killing /x/kill/y'])`,
    `execSync('echo stty-like')`,
  ]);
  assert.deepEqual(plain, ['ran', 'ran']);
});

test('FT9 process.kill() of a process or a group this process did not start is refused; with signal 0, or of this one, it goes through', async (t) => {
  const box = await createSandbox(t);

  const said = await inChild(box, box.env, [
    "import { spawn } from 'node:child_process';",
    // A sleeper that this child did not start: its own child (a node with the
    // preload) starts it, as the leader of a group of its own, and prints its
    // pid. A refusal that failed would stop only the sleeper.
    'const keeper = spawn(process.execPath, ["-e", [',
    '  "const { spawn } = require(\'node:child_process\');",',
    '  "const sleeper = spawn(\'/bin/sleep\', [\'30\'], { stdio: \'ignore\', detached: true });",',
    '  "process.stdout.write(String(sleeper.pid) + \'\\\\n\');",',
    '  "process.stdin.on(\'data\', () => { process.kill(sleeper.pid, \'SIGKILL\'); process.exit(0); });",',
    '].join("\\n")], { stdio: ["pipe", "pipe", "inherit"] });',
    'const pid = await new Promise((resolve) => keeper.stdout.once("data", (d) => resolve(Number(String(d).trim()))));',
    'const out = {};',
    'try { process.kill(pid, "SIGTERM"); out.other = "ran"; } catch (error) { out.other = error.message.includes("helpers/fake-tools.js") ? "refused" : error.message; }',
    'try { process.kill(-pid); out.group = "ran"; } catch (error) { out.group = error.message.includes("helpers/fake-tools.js") ? "refused" : error.message; }',
    'out.probe = process.kill(pid, 0);',
    'out.own = process.kill(process.pid, 0);',
    // Its parent, which started it, stops the sleeper.
    'const ended = new Promise((resolve) => keeper.once("exit", (code) => resolve(code)));',
    'keeper.stdin.write("stop\\n");',
    'out.keeper = await ended;',
    'process.stdout.write(JSON.stringify(out));',
  ]);

  assert.deepEqual(said, { other: 'refused', group: 'refused', probe: true, own: true, keeper: 0 });
});

test('FT10 the preload reaches a grandchild whose environment keeps NODE_OPTIONS, and not one whose environment drops it', async (t) => {
  const box = await createSandbox(t);
  // Whether a node process has the preload, read without running any tool.
  const loaded = "import('node:child_process').then((cp) => process.stdout.write(String(cp.spawnSync.name === 'fakeTools')))";

  const said = await inChild(box, box.env, [
    "import { execFileSync } from 'node:child_process';",
    `const ask = (env) => execFileSync(process.execPath, ['-e', ${JSON.stringify(loaded)}], { env, encoding: 'utf8' });`,
    'process.stdout.write(JSON.stringify({',
    '  inherited: ask(undefined),',
    '  kept: ask({ ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS} --no-deprecation` }),',
    "  emptied: ask({ ...process.env, NODE_OPTIONS: '' }),",
    '  dropped: ask(Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== "NODE_OPTIONS"))),',
    '}));',
  ]);

  assert.deepEqual(said, { inherited: 'true', kept: 'true', emptied: 'false', dropped: 'false' },
    'the preload goes as far as NODE_OPTIONS carries it: helpers/fake-tools.js names this limit, and the kit drops NODE_OPTIONS only for Orca\'s runtime client');
});

test('FT11 a process may signal a child it started and that child\'s group, through spawn, execFile and exec; after the child ends, its group only', async (t) => {
  const box = await createSandbox(t);

  const said = await inChild(box, box.env, [
    "import { spawn, execFile, exec } from 'node:child_process';",
    'const out = {};',
    'const exited = (child) => new Promise((resolve) => (child.exitCode !== null || child.signalCode !== null ? resolve(child.signalCode) : child.once("exit", (code, signal) => resolve(signal))));',
    'const tryKill = (pid, signal) => { try { process.kill(pid, signal); return "ran"; } catch (error) { return error.message.includes("helpers/fake-tools.js") ? "refused" : error.code ?? error.message; } };',
    // A refused signal leaves the child running, so it is stopped through its
    // own handle and the check goes on.
    'const stopped = async (said, child) => [said, said === "ran" ? await exited(child) : (child.kill("SIGKILL"), "not stopped")];',
    // A child by its own pid, from each of spawn, execFile and exec.
    'const one = spawn("/bin/sleep", ["30"], { stdio: "ignore" });',
    'out.spawn = await stopped(tryKill(one.pid, "SIGTERM"), one);',
    'const two = execFile("/bin/sleep", ["30"], () => {});',
    'out.execFile = await stopped(tryKill(two.pid, "SIGTERM"), two);',
    'const three = exec("exec /bin/sleep 30", () => {});',
    'out.exec = await stopped(tryKill(three.pid, "SIGTERM"), three);',
    // A child that leads a group of its own, with a child of its own in it,
    // as scripts/test-system.js starts node --test: the whole group stops.
    'const leader = spawn("/bin/sh", ["-c", "/bin/sleep 30 & echo $!; wait"], { stdio: ["ignore", "pipe", "inherit"], detached: true });',
    'const inner = await new Promise((resolve) => leader.stdout.once("data", (d) => resolve(Number(String(d).trim()))));',
    'out.group = await stopped(tryKill(-leader.pid, "SIGKILL"), leader);',
    'let gone = false;',
    'for (let i = 0; i < 40 && !gone; i += 1) { try { process.kill(inner, 0); await new Promise((r) => setTimeout(r, 50)); } catch { gone = true; } }',
    'out.innerGone = gone;',
    // After the exit is seen: the group is still the child\'s (the runner
    // stops what it left there), its own pid is not.
    'out.afterGroupProbe = tryKill(-leader.pid, 0);',
    'out.afterGroup = tryKill(-leader.pid, "SIGKILL");',
    'out.afterOwn = tryKill(leader.pid, "SIGTERM");',
    'process.stdout.write(JSON.stringify(out));',
  ]);

  assert.deepEqual(said, {
    spawn: ['ran', 'SIGTERM'],
    execFile: ['ran', 'SIGTERM'],
    exec: ['ran', 'SIGTERM'],
    group: ['ran', 'SIGKILL'],
    innerGone: true,
    afterGroupProbe: 'ESRCH',
    afterGroup: 'ESRCH',
    afterOwn: 'refused',
  });
});
