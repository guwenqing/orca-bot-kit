// The window reload finds the Orca to reload by its app path alone (#551).
//
// OBK_ORCA can name another build of Orca, such as the owner's fork, whose
// macOS process is named "Orca Lean", not "Orca". The kit runs
// `osascript src/orca-reload.applescript <Orca.app path>` (`reloadWindow()` in
// src/orca.js, tested with a fake osascript in orca-reload.test.js). The script
// must find the application process running from that path, whatever the
// process is called, and so must not pick processes by name first.
//
// The real script cannot run here: CI is Linux, and on a Mac System Events
// would act on the owner's real apps. So S1 and S2 judge the script's text,
// with its comments taken out. A live probe on a Mac, against a throwaway
// app, stands in for what the script does; these tests cannot show it.
//
// S3 is `reloadWindow()` with no OBK_ORCA, which R1 and R2 do not cover: it
// still aims at the Orca.app the built-in CLI path belongs to. Against the fake
// osascript only; the real Orca CLI is never run.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { asPlatform, createSandbox, node, repoRoot } from './helpers/cli.js';
import { OSASCRIPT } from './helpers/fake-osascript.js';

const SCRIPT = path.join(repoRoot, 'src', 'orca-reload.applescript');

/** The script's code: AppleScript's `--` and `#` line comments and `(* *)` block comments taken out. */
async function codeOfScript() {
  const text = await readFile(SCRIPT, 'utf8');
  return text
    .replaceAll(/\(\*[\s\S]*?\*\)/g, '')
    .split('\n')
    .map((line) => line.replace(/(--|#).*$/, ''))
    .join('\n');
}

test('S1 the reload script picks no application process by its name', async () => {
  const code = await codeOfScript();

  assert.doesNotMatch(code, /whose\s+name\b/i, 'no `whose name ...` filter on the processes');
  assert.doesNotMatch(code, /application process(es)?\s+"/i, 'no process asked for by a name such as "Orca"');
  assert.doesNotMatch(
    code,
    /\bname\b[^\n]*\b(is|=|contains|starts with|begins with|ends with)\s+"Orca/i,
    'no process name held to "Orca", so a process named "Orca Lean" running from the path is found as well',
  );
});

test('S2 the reload script still finds the process by the app path it is given', async () => {
  const code = await codeOfScript();

  assert.match(code, /item 1 of argv/, 'the app path is still the script\'s one argument');
  assert.match(code, /application file/, 'the process is still matched by the app file it runs from');
});

// ------------------------------------------------------------- no OBK_ORCA

const orcaModule = pathToFileURL(path.join(repoRoot, 'src', 'orca.js')).href;

/** The CLI the kit uses when OBK_ORCA is not set (src/orca.js). */
const BUILT_IN_CLI = '/Applications/Orca.app/Contents/Resources/bin/orca';

test('S3 with no OBK_ORCA, reloadWindow() aims at the Orca.app of the built-in CLI path, as before', async (t) => {
  const box = await createSandbox(t);
  asPlatform(box, 'darwin');
  await box.osascript.answer(OSASCRIPT.reloaded);
  delete box.env.OBK_ORCA;

  const ran = await node(['--input-type=module', '-e', [
    `const { reloadWindow } = await import(${JSON.stringify(orcaModule)});`,
    'process.stdout.write(JSON.stringify(await reloadWindow()));',
  ].join('\n')], { cwd: box.cwd, env: box.env });
  assert.equal(ran.code, 0, `reloadWindow() should answer and never throw, got:\n${ran.stdout}${ran.stderr}`);
  const answer = JSON.parse(ran.stdout);
  const calls = await box.osascript.calls();

  // The kit only follows the built-in path to its real place; it never runs
  // that CLI. Whether Orca is installed there depends on the machine: on the
  // Linux CI it is not, and the reload is a quiet false with no osascript run.
  if (existsSync(BUILT_IN_CLI)) {
    assert.equal(answer, true);
    assert.deepEqual(calls.map((call) => call.args[1]), ['/Applications/Orca.app']);
  } else {
    assert.equal(answer, false);
    assert.deepEqual(calls, []);
  }
});
