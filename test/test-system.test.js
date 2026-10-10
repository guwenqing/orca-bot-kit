// `scripts/test-system.js` runs the system tests: the ones that drive the real
// `obk` against the real Orca, which no CI machine can do.
//
// Every test gets its own throwaway repo — a copy of the script under
// `scripts/`, a `test/system/` of its own — and a fake Orca that `OBK_ORCA`
// points at, so every answer the preflight can get is played back without Orca
// running anywhere. Each fixture test file prints a marker, which is how a test
// here can tell which files the run picked up.
//
// Driving this machine takes a deliberate step, so a fixture has two ways to
// run: `run` is the command on its own, which drives nothing, and `confirmed`
// is the same command with the confirmation flag. A test about what the system
// tests do uses `confirmed`; a test about who may start them uses both.
//
// A real run mints an orchestration Run per session it brings up, and Orca
// offers no way to delete one, so the pile grows. The fake Orca therefore
// answers `orchestration run-list` as well as `status`, out of a world file the
// fixture's own system test files write to while they run: that is how a test
// here makes a Run appear mid-run without anything real being brought up.

import assert from 'node:assert/strict';
import { lstatSync, realpathSync } from 'node:fs';
import { chmod, copyFile, mkdir, readdir, readFile, realpath, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test as nodeTest } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { assertRefused, createSandbox, node, orcaCallsOf, repoRoot } from './helpers/cli.js';

const scriptEntry = path.join(repoRoot, 'scripts', 'test-system.js');

/**
 * Why the runner cannot be loaded here, or false when it can. It imports
 * smol-toml (#240), a dev dependency, which a production-only install leaves
 * out: the publish workflow's floor job runs `npm ci --omit=dev` and then every
 * test shard. There every test that runs the runner would fail on its import,
 * so they skip and say why (the architect's ruling on #240, (b)); wherever the
 * package resolves, they run.
 *
 * Only a package that is not there skips: the resolve finds no module
 * (ERR_MODULE_NOT_FOUND) and there is no `smol-toml` at all in any node_modules
 * the resolve searched, this file's folder's and every folder's above it, a
 * dangling link counting as there. A smol-toml that is
 * there and broken (its package.json unreadable, or its entry file missing,
 * which Node reports as ERR_MODULE_NOT_FOUND too) is not skipped (review of
 * PR #453): the tests run, the runner fails to load, and they fail with its
 * error, rather than a run that passes quietly.
 */
const RUNNER_CANNOT_LOAD = (() => {
  try {
    import.meta.resolve('smol-toml');
    return false;
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') return false;
  }
  // Every folder Node's resolve looked in for it: node_modules/smol-toml beside
  // this file and in each folder above, up to the root of the file system. A
  // package found in any of them, broken or a dangling link, is there.
  for (let dir = path.dirname(fileURLToPath(import.meta.url)); ; dir = path.dirname(dir)) {
    try {
      lstatSync(path.join(dir, 'node_modules', 'smol-toml'));
      return false;
    } catch (error) {
      if (error?.code !== 'ENOENT') return false;
    }
    if (path.dirname(dir) === dir) break;
  }
  return 'the runner\'s dev dependency smol-toml is not installed, as in a production-only install (npm ci --omit=dev), so scripts/test-system.js cannot load';
})();

/**
 * This file's `test`: node:test's, skipped with that reason when the runner
 * cannot load. Every test here runs the runner unless it says it does not with
 * `{ loadsRunner: false }`, so a new one that does cannot slip past the skip.
 */
function test(name, options, fn) {
  const [given, body] = typeof options === 'function' ? [{}, options] : [options ?? {}, fn];
  const { loadsRunner = true, ...rest } = given;
  return nodeTest(name, { ...rest, skip: rest.skip ?? (loadsRunner ? RUNNER_CANNOT_LOAD : false) }, body);
}

/** The one deliberate step that lets the system tests drive this machine. */
const CONFIRM = '--yes';

/** The Orca CLI to fall back on when OBK_ORCA says nothing (tech notes, section 1). */
const BUILT_IN_ORCA = '/Applications/Orca.app/Contents/Resources/bin/orca';

/** What `orca status --json` prints, as the fake Orca's stdout. */
const status = (value) => ({ stdout: `${JSON.stringify(value)}\n` });

/** Orca up and reachable: the only answer that lets the system tests run. */
const READY = status({ ok: true, result: { runtime: { reachable: true } } });

/** The environment variable naming the fake Orca's world, for a fixture test file to write. */
const WORLD = 'OBK_FIXTURE_RUNS';

/**
 * How many Runs the listing hands back when the caller asked for no number.
 * Nobody has measured Orca's own default, and a cursor API always has one, so
 * the fake picks a small page: a kit that wants every Run on a machine has to
 * say how many it wants rather than hope the default is generous.
 */
const PAGE = 20;

/** The largest `--limit` Orca takes; above it the CLI refuses the call outright. */
const LIMIT_CAP = 100;

/** A count that outlives any one test: the listing behaves that way every time. */
const ALWAYS = 1e6;

/**
 * A fake Orca that answers two commands. `status` answers whatever the test
 * asked for, as before. `orchestration run-list --json` answers out of a world
 * file — `{ runs, runListFails, runListGarbles, runListEnvelope, appearsDuring }`
 * — which is read on every call,
 * so a Run written into it while the system tests are running is a Run that
 * appeared during the run.
 *
 * The listing is faithful where being faithful costs nothing: the answer is the
 * envelope every Orca call uses, `{ id, ok, result: { runs, nextCursor },
 * _meta }`, with Runs newest first; a `--limit` over 100 is refused the way the
 * real CLI refuses it; and a call that named no limit gets one page and is told
 * there is more. `runListEnvelope` spoils the envelope instead: `notOk` is an
 * answer that failed while still exiting 0, `notOkWithRuns` one that says it
 * failed while still carrying a list, and `noOk` one the kit has no way to read
 * as an answer at all.
 *
 * `appearsDuring` lands its Runs once the first listing has been answered, so
 * they are on the machine for the second and no test file made them: somebody
 * else's `obk up`, on a machine the tests do not have to themselves.
 *
 * It answers `project setups --json` too (#536), out of the same world file:
 * `{ setups, setupsFails, setupsGarbles, setupsEnvelope }`. The envelope is the
 * one read live on Orca 1.4.223 (#536): exactly `id`, `ok`, `result: { setups }`
 * and `_meta`, each setup as `setupNamed` makes it. `setupsFails` is a count of
 * calls refused with exit 1, `setupsGarbles` a count answered with text that is
 * not JSON, and `setupsEnvelope` spoils the envelope as `runListEnvelope` does:
 * `notOk`, `notOkWithSetups` or `noOk`. `setupsBefore` breaks the listing in
 * one of those ways (`fails`, `garbles`, or an envelope's name) only until the
 * run's system test file has run, which sets `testsRan`: a listing taken before
 * the tests is broken, and one after them is not. A system test file changes
 * the world while it runs, so a project can appear, or the listing break, mid-run.
 * Nothing else about projects is answered: a delete gets the `status` answer,
 * and is in the log.
 */
async function fakeOrca(box, { stdout = '', stderr = '', exitCode = 0 }, world) {
  const log = path.join(box.root, 'orca.log');
  const file = path.join(box.root, 'bin', 'orca');
  await writeFile(file, [
    '#!/usr/bin/env node',
    "const { appendFileSync, readFileSync, writeFileSync, writeSync } = require('node:fs');",
    `const WORLD = ${JSON.stringify(world)};`,
    'const args = process.argv.slice(2);',
    `appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, cwd: process.cwd(), env: process.env }) + '\\n');`,
    'const words = [];',
    "for (const arg of args) { if (arg.startsWith('-')) break; words.push(arg); }",
    "if (words.join(' ') === 'orchestration run-list') {",
    "  const state = JSON.parse(readFileSync(WORLD, 'utf8'));",
    '  const spend = (name) => { state[name] -= 1; writeFileSync(WORLD, JSON.stringify(state)); };',
    '  if (state.runListFails > 0) {',
    "    spend('runListFails');",
    "    writeSync(2, 'runtime_unavailable: Could not connect to the running Orca app\\n');",
    '    process.exit(1);',
    '  }',
    '  if (state.runListGarbles > 0) {',
    "    spend('runListGarbles');",
    "    writeSync(1, 'orca: this CLI cannot run for this user\\n');",
    '    process.exit(0);',
    '  }',
    "  const at = args.indexOf('--limit');",
    '  const asked = at >= 0 ? Number(args[at + 1]) : null;',
    `  if (asked !== null && !(asked >= 1 && asked <= ${LIMIT_CAP})) {`,
    `    writeSync(2, 'invalid_argument: Too big: expected number to be <=${LIMIT_CAP}\\n');`,
    '    process.exit(1);',
    '  }',
    '  const newest = state.runs.slice().reverse();',
    `  const page = newest.slice(0, asked === null ? ${PAGE} : asked);`,
    '  const nextCursor = page.length < newest.length ? String(page.length) : null;',
    "  const answer = { id: 'orc_fixture', ok: true, result: { runs: page, nextCursor }, _meta: {} };",
    "  if (state.runListEnvelope.startsWith('notOk')) {",
    '    answer.ok = false;',
    "    answer.error = { code: 'runtime_unavailable', message: 'Could not connect to the running Orca app' };",
    "    if (state.runListEnvelope === 'notOk') delete answer.result;",
    '  }',
    "  if (state.runListEnvelope === 'noOk') delete answer.ok;",
    '  if (state.appearsDuring.length > 0) {',
    '    state.runs = state.runs.concat(state.appearsDuring);',
    '    state.appearsDuring = [];',
    '    writeFileSync(WORLD, JSON.stringify(state));',
    '  }',
    "  writeSync(1, JSON.stringify(answer) + '\\n');",
    '  process.exit(0);',
    '}',
    "if (words.join(' ') === 'project setups') {",
    "  const state = JSON.parse(readFileSync(WORLD, 'utf8'));",
    '  const spend = (name) => { state[name] -= 1; writeFileSync(WORLD, JSON.stringify(state)); };',
    '  const before = state.testsRan === true ? undefined : state.setupsBefore;',
    "  if (before === 'fails') {",
    "    writeSync(2, 'runtime_unavailable: Could not connect to the running Orca app\\n');",
    '    process.exit(1);',
    '  }',
    "  if (before === 'garbles') {",
    "    writeSync(1, 'orca: this CLI cannot run for this user\\n');",
    '    process.exit(0);',
    '  }',
    "  const envelope = before ?? state.setupsEnvelope;",
    '  if (state.setupsFails > 0) {',
    "    spend('setupsFails');",
    "    writeSync(2, 'runtime_unavailable: Could not connect to the running Orca app\\n');",
    '    process.exit(1);',
    '  }',
    '  if (state.setupsGarbles > 0) {',
    "    spend('setupsGarbles');",
    "    writeSync(1, 'orca: this CLI cannot run for this user\\n');",
    '    process.exit(0);',
    '  }',
    "  const answer = { id: 'f3a9c2d1-7b4e-4c55-9e0a-5d6b7c8e9f01', ok: true, result: { setups: state.setups }, _meta: { runtimeId: '72e0c281-ca3f-448c-a9e5-0f31fff8de45' } };",
    "  if (envelope.startsWith('notOk')) {",
    '    answer.ok = false;',
    "    answer.error = { code: 'runtime_unavailable', message: 'Could not connect to the running Orca app' };",
    "    if (envelope === 'notOk') delete answer.result;",
    '  }',
    "  if (envelope === 'noOk') delete answer.ok;",
    "  writeSync(1, JSON.stringify(answer) + '\\n');",
    '  process.exit(0);',
    '}',
    `writeSync(1, ${JSON.stringify(stdout)});`,
    `writeSync(2, ${JSON.stringify(stderr)});`,
    `process.exit(${exitCode});`,
    '',
  ].join('\n'));
  await chmod(file, 0o755);

  return {
    async calls() {
      try {
        return (await readFile(log, 'utf8')).split('\n').filter((line) => line !== '').map((line) => JSON.parse(line));
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
    },
  };
}

/**
 * What a report says when its count of Runs is a floor rather than a total.
 * One list, used both ways: the report that must hedge says one of these, and
 * the report that must not says none of them, so a runner cannot pass the
 * second with a hedge the first would have counted.
 */
const HEDGE = /at least|incomplete|not all|may be more|might be more|could not reach/i;

/** A Run as `orchestration run-list` hands it over, named so a test can spot it. */
const runNamed = (name, at) => ({
  id: `run_${name}`,
  objective: `obk fixture-bot/${name}`,
  created_at: `2026-09-21T${at}:00Z`,
});

/** Runs that were on the machine before this run was ever started. */
const ALREADY_THERE = [runNamed('oldest', '08:00'), runNamed('older', '09:00')];

/** Runs a run brings into being by bringing sessions up. */
const MINTED = [runNamed('freshone', '11:00'), runNamed('freshtwo', '11:01')];

/** A system test file that passes and says so. */
const marker = (name) => [
  "import test from 'node:test';",
  '',
  `test(${JSON.stringify(name)}, () => {`,
  `  process.stdout.write(${JSON.stringify(`${name}\n`)});`,
  '});',
  '',
].join('\n');

/**
 * A system test file that mints Runs, the way a real one does by bringing
 * sessions up: it writes them into the fake Orca's world, so the listing after
 * the run answers with them and the listing before it did not. `thenFails`
 * makes the test fail afterwards, which is a run that both left Runs behind and
 * has bad news of its own.
 */
const mintsRuns = (name, runs, { thenFails = false } = {}) => [
  "import { readFileSync, writeFileSync } from 'node:fs';",
  "import test from 'node:test';",
  '',
  `test(${JSON.stringify(name)}, () => {`,
  `  const file = process.env[${JSON.stringify(WORLD)}];`,
  "  const world = JSON.parse(readFileSync(file, 'utf8'));",
  `  world.runs.push(...${JSON.stringify(runs)});`,
  '  writeFileSync(file, JSON.stringify(world));',
  `  process.stdout.write(${JSON.stringify(`${name}\n`)});`,
  ...(thenFails ? [`  throw new Error(${JSON.stringify(`${name} failed`)});`] : []),
  '});',
  '',
].join('\n');

/**
 * The files every fixture repo starts with: one system test, one file next to
 * it that is not a test, and one test outside `test/system/`. The last two
 * catch a run that reaches wider than the system tests.
 */
const DEFAULT_FILES = {
  'test/system/alpha.test.js': marker('ALPHA'),
  'test/system/helper.js': "process.stdout.write('HELPER\\n');\n",
  'test/other.test.js': marker('OTHER'),
};

/**
 * A system test file that writes down that it ran, in `ran.log` beside the
 * repo, as well as printing its marker. The log says which files ran and how
 * many times each, which the output cannot: the test runner prints a test's
 * name beside whatever the test wrote.
 *
 * Built on `process.getBuiltinModule` rather than `import` or `require`, so the
 * same file runs inside the fixture repo, which is an ES module package, and
 * outside it, where nothing says what a `.js` file is.
 */
const tallies = (name) => [
  "const { appendFileSync } = process.getBuiltinModule('node:fs');",
  "const path = process.getBuiltinModule('node:path');",
  "const { test } = process.getBuiltinModule('node:test');",
  '',
  `test(${JSON.stringify(name)}, () => {`,
  `  appendFileSync(path.join(path.dirname(process.env[${JSON.stringify(WORLD)}]), 'ran.log'), ${JSON.stringify(`${name}\n`)});`,
  `  process.stdout.write(${JSON.stringify(`${name}\n`)});`,
  '});',
  '',
].join('\n');

/**
 * Three system test files, two at the top of test/system/ and one a folder
 * down, so that naming some of them leaves others that must not run. Beside them
 * a file in test/system/ that is not a test, a test folder beside test/system/
 * whose name begins the same, and a test outside test/system/ altogether: each
 * of them writes down that it ran, should anything run it.
 */
const NAMED_FILES = {
  'test/system/alpha.test.js': tallies('ALPHA'),
  'test/system/beta.test.js': tallies('BETA'),
  'test/system/nested/gamma.test.js': tallies('GAMMA'),
  'test/system/helper.js': tallies('HELPER'),
  'test/system-extra/sneaky.test.js': tallies('SNEAKY'),
  'test/other.test.js': tallies('OTHER'),
};

// A system test drives the real Orca only when this command started it (#328).
// Loaded any other way — `node --test <file>`, `node -e "import('<file>')"`, an
// editor's runner — it touches nothing and says how to run it. The runner says
// so to the files it starts through one variable, and the files take their
// `test` from test/helpers/system.js, which skips unless the variable says so.

/** The variable the runner sets for the system tests it starts. */
const GATE = 'OBK_SYSTEM_TESTS';

/** What a system test loaded any other way tells the developer to run instead. */
const HOW_TO_RUN = 'npm run test:system -- --yes';

/** The helper every system test takes its `test` from. */
const helperEntry = path.join(repoRoot, 'test', 'helpers', 'system.js');

/**
 * A system test file that writes down what it saw of the gate, `<name>:<value>`,
 * in `ran.log` beside the repo: the value of OBK_SYSTEM_TESTS its process was
 * started with, or `unset`.
 */
const seesGate = (name) => [
  "const { appendFileSync } = process.getBuiltinModule('node:fs');",
  "const path = process.getBuiltinModule('node:path');",
  "const { test } = process.getBuiltinModule('node:test');",
  '',
  `test(${JSON.stringify(name)}, () => {`,
  `  const seen = process.env[${JSON.stringify(GATE)}] ?? 'unset';`,
  `  appendFileSync(path.join(path.dirname(process.env[${JSON.stringify(WORLD)}]), 'ran.log'), ${JSON.stringify(`${name}:`)} + seen + '\\n');`,
  '});',
  '',
].join('\n');

/**
 * A system test file written the way the real ones are: its `test` comes from
 * `../helpers/system.js`, and nothing of node:test is loaded by the file itself.
 * Its body writes its name in `ran.log` beside the repo, so a body that never
 * ran leaves nothing there.
 */
const behindTheGate = (name) => [
  "import { appendFileSync } from 'node:fs';",
  "import path from 'node:path';",
  '',
  "import test from '../helpers/system.js';",
  '',
  `test(${JSON.stringify(name)}, () => {`,
  `  appendFileSync(path.join(path.dirname(process.env[${JSON.stringify(WORLD)}]), 'ran.log'), ${JSON.stringify(`${name}\n`)});`,
  '});',
  '',
].join('\n');

/**
 * A reporter for the test runner that prints one JSON line per test: whether it
 * passed or failed, its name, and its skip reason exactly as the runner was
 * given it (null when it was not skipped). The human reporters print the reason
 * among other things; this one lets a test read it whole.
 */
const REPORTER = [
  'export default async function* report(source) {',
  '  for await (const event of source) {',
  "    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;",
  '    const { name, skip = null } = event.data;',
  "    yield JSON.stringify({ type: event.type, name, skip }) + '\\n';",
  '  }',
  '}',
  '',
].join('\n');

/** What the JSON reporter said, one entry per test, from a run's stdout. */
const reported = (result) => result.stdout
  .split('\n')
  .filter((line) => line.startsWith('{'))
  .map((line) => JSON.parse(line));

/**
 * A test file outside test/system/, in a throwaway folder, whose `test` is the
 * real helper's: never a system test, so loading it drives nothing whatever the
 * helper does. Its body writes `typeof t.after` into `ran.log` — `function` when
 * it was handed node:test's own test context, as the system tests' bodies use it
 * — and then throws when `fails` asks it to.
 *
 * It can be loaded the two ways #318's accident took: `viaTest`, as
 * `node --test <file>` (and an editor's runner) does, and `viaImport`, as
 * `node -e "import('<file>')"` did. Each takes the value of OBK_SYSTEM_TESTS to
 * start it with, and none at all when `gate` is undefined, whatever the shell
 * running this suite has; `reporter: false` gives the runner's own reporter,
 * what a developer sees.
 */
async function guardedFile(t, { fails = false } = {}) {
  const box = await createSandbox(t);
  const file = path.join(box.root, 'guarded.test.mjs');
  const ranLog = path.join(box.root, 'ran.log');
  const reporter = path.join(box.root, 'reporter.mjs');
  await writeFile(file, [
    "import { appendFileSync } from 'node:fs';",
    '',
    `import test from ${JSON.stringify(pathToFileURL(helperEntry).href)};`,
    '',
    "test('GUARDED', (t) => {",
    `  appendFileSync(${JSON.stringify(ranLog)}, typeof t.after + '\\n');`,
    ...(fails ? ["  throw new Error('GUARDED failed');"] : []),
    '});',
    '',
  ].join('\n'));
  await writeFile(reporter, REPORTER);

  // NODE_TEST_CONTEXT is set in every process this suite's runner starts, and a
  // `node --test` that inherits it runs nothing (see createRepo).
  const { NODE_TEST_CONTEXT: _context, [GATE]: _gate, ...bare } = box.env;
  const envWith = (gate) => (gate === undefined ? bare : { ...bare, [GATE]: gate });
  const reporterFlag = (wanted) => (wanted ? [`--test-reporter=${reporter}`] : []);

  return {
    viaTest: ({ gate, reporter: wanted = true } = {}) => node(
      [...reporterFlag(wanted), '--test', file],
      { cwd: box.cwd, env: envWith(gate) },
    ),
    viaImport: ({ gate, reporter: wanted = true } = {}) => node(
      [...reporterFlag(wanted), '-e', `import(${JSON.stringify(pathToFileURL(file).href)})`],
      { cwd: box.cwd, env: envWith(gate) },
    ),
    /** What the body wrote, once per time it ran: empty when it never did. */
    async ran() {
      try {
        return (await readFile(ranLog, 'utf8')).split('\n').filter((line) => line !== '');
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
    },
  };
}

/**
 * The test was skipped, and says how to run it: one test, reported as a skip
 * rather than a pass or a failure, whose reason is one line naming the command.
 */
function assertGated(result, what) {
  const tests = reported(result);
  assert.equal(tests.length, 1, `${what}: one test should be reported, got:\n${result.stdout}${result.stderr}`);
  const [only] = tests;
  assert.equal(only.type, 'test:pass', `${what}: a skip is not a failure, got:\n${result.stdout}${result.stderr}`);
  assert.equal(typeof only.skip, 'string', `${what}: it should be skipped with a reason, got: ${JSON.stringify(only)}`);
  assert.ok(!only.skip.includes('\n'), `${what}: the reason should be one line, got: ${JSON.stringify(only.skip)}`);
  assert.ok(only.skip.includes(HOW_TO_RUN), `${what}: the reason should name \`${HOW_TO_RUN}\`, got: ${JSON.stringify(only.skip)}`);
}

async function write(dir, rel, text) {
  const file = path.join(dir, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

/** The arguments of each call to a fake program, when the rest of the call does not matter. */
const argsOf = (calls) => calls.map((call) => call.args);

/**
 * A fresh repo holding a copy of the script, and a fake Orca for `OBK_ORCA` to
 * name. The fake is not found through PATH: the script resolves the CLI itself.
 */
async function createRepo(t, {
  orca: orcaOptions = READY,
  files = DEFAULT_FILES,
  runs = [],
  runListFails = 0,
  runListGarbles = 0,
  runListEnvelope = 'ok',
  appearsDuring = [],
  setups = [],
} = {}) {
  const box = await createSandbox(t);
  const world = path.join(box.root, 'orca-runs.json');
  await writeFile(world, JSON.stringify({
    runs, runListFails, runListGarbles, runListEnvelope, appearsDuring,
    setups, setupsFails: 0, setupsGarbles: 0, setupsEnvelope: 'ok',
  }));
  const orca = await fakeOrca(box, orcaOptions, world);
  const orcaPath = path.join(box.root, 'bin', 'orca');

  const repo = path.join(box.root, 'repo');
  await mkdir(path.join(repo, 'scripts'), { recursive: true });
  await copyFile(scriptEntry, path.join(repo, 'scripts', 'test-system.js'));
  // The script imports packages of the kit's (smol-toml, #240), resolved from
  // node_modules beside it: the kit's own, linked, as the worktrees link theirs.
  await symlink(path.join(repoRoot, 'node_modules'), path.join(repo, 'node_modules'));
  await write(repo, 'package.json', '{"name": "fixture", "type": "module"}\n');
  for (const [rel, text] of Object.entries(files)) await write(repo, rel, text);

  // This machine may have OBK_ORCA set for its own reasons; the fixture decides.
  // NODE_TEST_CONTEXT goes too: it is set in every process the test runner
  // starts, and a `node --test` that inherits it refuses to run any file. A
  // developer's shell does not have it, so neither does the script here.
  // OBK_SYSTEM_TESTS goes as well: it is the runner's to set (#328), and one
  // left over in this shell would make a test of that pass whatever it did.
  const { OBK_ORCA: _override, NODE_TEST_CONTEXT: _context, [GATE]: _gate, ...bare } = box.env;

  // The world goes into the environment as well as into the fake, because the
  // fixture's system test files are spawned by the script and read it from there.
  const env = { ...bare, OBK_ORCA: orcaPath, [WORLD]: world };

  const runScript = (args, options) => node(
    [path.join(repo, 'scripts', 'test-system.js'), ...args],
    { cwd: options.cwd ?? repo, env: options.env ?? env },
  );

  return {
    repo,
    orca,
    orcaPath,
    /** The environment the script is run with: the fake Orca as the CLI. */
    env,
    /** The same environment with no override at all, so the built-in path is used. */
    envWithoutOverride: bare,
    /**
     * Run it the way `npm run test:system` on its own does: no confirmation.
     * From the repo (or `options.cwd`, with `options.env`), naming the files in
     * `options.names` when there are any.
     */
    run: (options = {}) => runScript(options.names ?? [], options),
    /** Run it the way the developer who means it does: with the confirmation flag. */
    confirmed: (options = {}) => runScript([CONFIRM, ...(options.names ?? [])], options),
    /** The sandbox directory outside the repo, for running from elsewhere. */
    outside: box.cwd,
  };
}

/**
 * What the announcement has to carry before anything is driven: the machine it
 * is about to drive, the Orca CLI it will drive it through, and every system
 * test file it would run, by name. The wording around them is the writer's.
 *
 * Read from stdout alone, because everything the runner says about itself goes
 * there on every path; stderr belongs to the run it starts.
 */
function assertAnnounces(result, fixture, files = [], cli = fixture.orcaPath) {
  const output = result.stdout;
  // As the machine reports itself, spelling and all. Matched as it is written
  // rather than loosely: this one answers `Mac`, and a loose match would take
  // the word `macOS` in a sentence about the machine for the name of it.
  const machine = os.hostname();

  assert.ok(
    output.includes(machine),
    `it should name the machine it will drive (${machine}), got: ${output}`,
  );
  assert.ok(
    output.includes(cli),
    `it should name the Orca CLI it asked (${cli}), got: ${output}`,
  );
  for (const file of files) {
    assert.ok(output.includes(file), `it should name ${file}, got: ${output}`);
  }
}

/**
 * The Orca the run asked is said to come from OBK_ORCA, not from the default.
 * The default's own wording names OBK_ORCA too ("OBK_ORCA names another"), so
 * the word alone tells nothing: what tells them apart is the line naming the
 * Orca asked, which says OBK_ORCA chose it and does not call it the default.
 */
function assertFromObkOrca(result, cli) {
  const told = result.stdout.split('\n').filter((line) => line.includes(cli));
  assert.ok(
    told.some((line) => /OBK_ORCA/.test(line) && !/default/i.test(line)),
    `the line naming ${cli} should say OBK_ORCA chose it, not the default, got: ${result.stdout}`,
  );
}

/** Each way of invoking it, for a fact that has to hold on both. */
const eitherWay = async (fixture) => [await fixture.run(), await fixture.confirmed()];

/**
 * What the runner said for itself once the system tests were over: stdout past
 * the last thing the run printed. A report about what the run left has to be
 * read apart from the announcement, because the announcement already warns that
 * the tests will leave Runs Orca cannot delete — every word of a report would
 * otherwise be matched before a single test had run.
 */
function afterTheRun(result, lastPrinted = 'ALPHA') {
  const at = result.stdout.lastIndexOf(lastPrinted);
  assert.ok(at >= 0, `the run's own output should reach stdout, got: ${result.stdout}`);
  const tail = result.stdout.slice(at + lastPrinted.length);

  // The test runner's own summary comes between the two, and it is full of the
  // words a report would use — `fail 0` alone would answer half of what is
  // asked below. It is the runner counting, not the command speaking for
  // itself, so a report is read from past the end of it. Its last line is the
  // duration, whichever reporter wrote it.
  const counted = tail.lastIndexOf('duration_ms');
  const ends = counted < 0 ? -1 : tail.indexOf('\n', counted);
  return ends < 0 ? tail : tail.slice(ends + 1);
}

/**
 * The report as one line. Every check below is on prose, and the runner hard
 * wraps its prose, so a phrase can be split by a line break that says nothing
 * about what the sentence means: "anything else" is one phrase whether or not
 * "else" begins a new line. Matching the wrapped text makes a check depend on
 * where the writer's lines happened to end.
 */
const unwrapped = (report) => report.replace(/\s+/g, ' ');

/**
 * It told the developer it could not find something out, rather than guessing
 * or dying.
 *
 * Naming no Run is the half that carries the weight. A report that lists Runs
 * is a report that knows which ones are new, and it will say they could not be
 * removed while it does so — words a wording check alone would take for this
 * one. What separates the two is whether anything is named at all.
 */
function assertSaidItCouldNotTell(report, runs = [...ALREADY_THERE, ...MINTED]) {
  for (const run of runs) {
    assert.ok(
      !report.includes(run.id),
      `it should name no Run when it could not find out which were left, got: ${report}`,
    );
  }
  assert.match(unwrapped(report), /run/i, `it should still speak of Runs, got: ${report}`);
  assert.match(
    unwrapped(report),
    /could ?n[o']t|cannot|can't|unable|did not|failed/i,
    `it should say it could not find out what was left, got: ${report}`,
  );
}

/** Orca is not ready: it says so on stdout, exits 0, and no system test ran. */
function assertSkipped(result) {
  assert.equal(result.code, 0);
  assert.match(result.stdout, /orca/i, `the message should name Orca, got: ${result.stdout}`);
  assert.match(result.stdout, /skip/i, `the message should say it skipped, got: ${result.stdout}`);
  assert.doesNotMatch(result.stdout + result.stderr, /ALPHA/);
}

/** Which of the files built by `tallies` ran, once per run of each, sorted: empty when none did. */
async function ranIn(fixture) {
  try {
    return (await readFile(path.join(path.dirname(fixture.repo), 'ran.log'), 'utf8'))
      .split('\n')
      .filter((line) => line !== '')
      .sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * The ways out of test/system/ that a name could take: a package.json and a
 * test file beside the repo, a folder of tests beside it too, and two symlinks
 * in test/system/ that lead out, `leak.test.js` to the test file and `linked`
 * to the folder.
 *
 * And the ways in that are not a name of a system test file: `alias.test.js`
 * links to beta from outside test/system/, in test/ and beside the repo;
 * `alias.js` links to it from inside under a name that is not a test's; and
 * two folders in test/system/ are named like test files, one empty and one
 * holding a test.
 */
async function withWaysOut(fixture) {
  const beside = path.dirname(fixture.repo);
  const beta = path.join(fixture.repo, 'test', 'system', 'beta.test.js');
  await write(beside, 'package.json', '{"name": "outside"}\n');
  await write(beside, 'outside.test.js', tallies('OUTSIDE'));
  await write(beside, 'elsewhere/escaped.test.js', tallies('ESCAPED'));
  await symlink(path.join(beside, 'outside.test.js'), path.join(fixture.repo, 'test', 'system', 'leak.test.js'));
  await symlink(path.join(beside, 'elsewhere'), path.join(fixture.repo, 'test', 'system', 'linked'));
  await symlink(beta, path.join(fixture.repo, 'test', 'alias.test.js'));
  await symlink(beta, path.join(beside, 'alias.test.js'));
  await symlink('beta.test.js', path.join(fixture.repo, 'test', 'system', 'alias.js'));
  await mkdir(path.join(fixture.repo, 'test', 'system', 'empty.test.js'));
  await write(fixture.repo, 'test/system/suite.test.js/inner.test.js', tallies('INNER'));
  return fixture;
}

/**
 * Names that are not a system test file, each with why it is not. A name
 * is a path from the repo, or an absolute one, and what counts is where it
 * really leads once every symlink is followed: to a `*.test.js` file inside
 * test/system/, or it is refused.
 */
const REFUSED = [
  ['a `..` that leaves the repo', () => '../package.json'],
  ['a `..` that leaves test/system/ and the repo', () => 'test/system/../../package.json'],
  ['a `..` that leaves test/system/ and comes back into the folder beside it', () => 'test/system/../system-extra/sneaky.test.js'],
  ['a folder beside test/system/ whose name begins the same', () => 'test/system-extra/sneaky.test.js'],
  ['a `..` that leaves the repo and comes back in to a test outside test/system/', (fixture) => `../${path.basename(fixture.repo)}/test/other.test.js`],
  ['an absolute path outside the repo', (fixture) => path.join(path.dirname(fixture.repo), 'outside.test.js')],
  ['an absolute path into the repo but outside test/system/', (fixture) => path.join(fixture.repo, 'test', 'other.test.js')],
  ['a test file that is not a system test', () => 'test/other.test.js'],
  ['a file under test/system/ that is not a test file', () => 'test/system/helper.js'],
  ['a test file symlinked into test/system/ from outside it', () => 'test/system/leak.test.js'],
  ['a symlinked folder in test/system/ that leads outside it', () => 'test/system/linked'],
  ['a test file reached through a symlinked folder that leads outside', () => 'test/system/linked/escaped.test.js'],
  ['a name that does not exist', () => 'test/system/missing.test.js'],
  ['test/system/ itself', () => 'test/system'],
  ['a folder under test/system/', () => 'test/system/nested'],
  ['a test file outside test/system/ that links to a system test', () => 'test/alias.test.js'],
  ['a test file beside the repo that links to a system test', () => '../alias.test.js'],
  ['an absolute path to a test file beside the repo that links to a system test', (fixture) => path.join(path.dirname(fixture.repo), 'alias.test.js')],
  ['a file in test/system/ that is not a test file but links to one', () => 'test/system/alias.js'],
  ['an empty folder in test/system/ named like a test file', () => 'test/system/empty.test.js'],
  ['a folder in test/system/ named like a test file, holding a test', () => 'test/system/suite.test.js'],
];

// Each test owns a throwaway repo, so they can all run at the same time.
describe('test-system', { concurrency: true }, () => {
  test('the system tests are wired up as `npm run test:system`', { loadsRunner: false }, async () => {
    const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));

    assert.match(pkg.scripts['test:system'] ?? '', /scripts\/test-system\.js/);
  });

  test('the preflight asks the Orca CLI for its status as JSON, once', async (t) => {
    const fixture = await createRepo(t);

    await fixture.confirmed();

    assert.deepEqual(argsOf(orcaCallsOf(await fixture.orca.calls(), 'status')), [['status', '--json']]);
  });

  test('Orca ready: the system tests run and it exits with their exit code', async (t) => {
    const fixture = await createRepo(t);

    const result = await fixture.confirmed();

    assert.equal(result.code, 0);
    assert.match(result.stdout, /ALPHA/);
  });

  test('only the files in test/system/ that are test files are run', async (t) => {
    // A bare `node --test` would go hunting through the whole tree instead.
    const fixture = await createRepo(t);

    const result = await fixture.confirmed();

    const output = result.stdout + result.stderr;
    assert.match(output, /ALPHA/);
    assert.doesNotMatch(output, /OTHER/);
    assert.doesNotMatch(output, /HELPER/);
  });

  test('every system test file is run, not just the first', async (t) => {
    const fixture = await createRepo(t, {
      files: {
        'test/system/alpha.test.js': marker('ALPHA'),
        'test/system/beta.test.js': marker('BETA'),
      },
    });

    const result = await fixture.confirmed();

    assert.match(result.stdout, /ALPHA/);
    assert.match(result.stdout, /BETA/);
  });

  test('a system test in a folder under test/system/ is run, and a file that is not a test is not', async (t) => {
    // A folder under test/system/ is the obvious place to group system tests,
    // and a runner that only reads the top level loses them without a word:
    // `npm test` does not match them either, so both layers report success
    // while nobody runs the file.
    const fixture = await createRepo(t, {
      files: {
        'test/system/alpha.test.js': marker('ALPHA'),
        'test/system/nested/forgotten.test.js': marker('FORGOTTEN'),
        'test/system/nested/support.js': "process.stdout.write('NOT-A-TEST\\n');\n",
      },
    });

    const result = await fixture.confirmed();

    const output = result.stdout + result.stderr;
    assert.match(output, /ALPHA/);
    assert.match(output, /FORGOTTEN/);
    assert.doesNotMatch(output, /NOT-A-TEST/);
  });

  test('a failing system test under test/system/ fails the command from any depth', async (t) => {
    const fixture = await createRepo(t, {
      files: {
        'test/system/nested/forgotten.test.js': [
          "import test from 'node:test';",
          '',
          "test('forgotten', () => { throw new Error('FORGOTTEN failed'); });",
          '',
        ].join('\n'),
      },
    });

    const result = await fixture.confirmed();

    assert.equal(result.code, 1);
  });

  test('a failing system test makes the command fail', async (t) => {
    const fixture = await createRepo(t, {
      files: {
        'test/system/alpha.test.js': [
          "import test from 'node:test';",
          '',
          "test('alpha', () => { throw new Error('ALPHA failed'); });",
          '',
        ].join('\n'),
      },
    });

    const result = await fixture.confirmed();

    assert.equal(result.code, 1);
  });

  test('the run\'s output reaches the developer on both streams', async (t) => {
    // Nothing is swallowed: the test runner folds a test file's stderr into its
    // own stdout, so what matters is that both markers come out somewhere.
    const fixture = await createRepo(t, {
      files: {
        'test/system/alpha.test.js': [
          "import test from 'node:test';",
          '',
          "test('alpha', () => {",
          "  process.stdout.write('ALPHA out\\n');",
          "  process.stderr.write('ALPHA err\\n');",
          '});',
          '',
        ].join('\n'),
      },
    });

    const result = await fixture.confirmed();

    const output = result.stdout + result.stderr;
    assert.match(output, /ALPHA out/);
    assert.match(output, /ALPHA err/);
  });

  // Which `obk` the system tests run is the tests' own business: each starts
  // its checkout's `src/cli.js` by its full path (#220). The runner has no say
  // in what `obk` on PATH is — the machine's own release, for the owner's own
  // fleet — so it neither checks it, nor needs one, nor changes it.

  test('the system tests run whatever `obk` is on PATH, and the runner never runs it', async (t) => {
    const fixture = await createRepo(t);
    const dir = path.join(path.dirname(fixture.outside), 'decoy');
    const log = path.join(path.dirname(fixture.outside), 'decoy.log');
    await mkdir(dir);
    await writeFile(path.join(dir, 'obk'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexit 1\n`);
    await chmod(path.join(dir, 'obk'), 0o755);

    const result = await fixture.confirmed({ env: { ...fixture.env, PATH: `${dir}${path.delimiter}${fixture.env.PATH}` } });

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /ALPHA/);
    await assert.rejects(readFile(log, 'utf8'), { code: 'ENOENT' }, 'the obk on PATH should never have been run');
  });

  test('the system tests run with no `obk` on PATH at all', async (t) => {
    const fixture = await createRepo(t);
    // Node, for the fake Orca's own `#!/usr/bin/env node`, and the system's
    // own tools; no folder that could hold an `obk`.
    const nodeOnly = path.join(path.dirname(fixture.outside), 'node-only');
    await mkdir(nodeOnly);
    await symlink(process.execPath, path.join(nodeOnly, 'node'));

    const result = await fixture.confirmed({ env: { ...fixture.env, PATH: [nodeOnly, '/usr/bin', '/bin'].join(path.delimiter) } });

    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /ALPHA/);
  });

  test('it works on the repo the script lives in, whatever the working directory', async (t) => {
    const fixture = await createRepo(t);

    const result = await fixture.confirmed({ cwd: fixture.outside });

    assert.match(result.stdout, /ALPHA/);
  });

  test('the system tests are run in the repo, whatever the working directory', async (t) => {
    // Anywhere else they would resolve the wrong files and the wrong package.
    const fixture = await createRepo(t, {
      files: {
        'test/system/alpha.test.js': [
          "import test from 'node:test';",
          '',
          "test('alpha', () => {",
          "  process.stdout.write(`CWD:${process.cwd()}\\n`);",
          '});',
          '',
        ].join('\n'),
      },
    });

    const result = await fixture.confirmed({ cwd: fixture.outside });

    assert.match(result.stdout, new RegExp(`CWD:${fixture.repo}\\n`));
  });

  test('no system test files: it says so, exits 0 and runs no test at all', async (t) => {
    // Nothing to drive is nothing to confirm, so the command on its own is
    // still the right way to ask this one.
    const fixture = await createRepo(t, { files: { 'test/other.test.js': marker('OTHER') } });

    const result = await fixture.run();

    assert.equal(result.code, 0);
    assert.match(result.stdout, /system test/i);
    assert.doesNotMatch(result.stdout + result.stderr, /OTHER/);
  });

  test('an empty test/system folder counts as no system test files', async (t) => {
    const fixture = await createRepo(t, { files: { 'test/other.test.js': marker('OTHER') } });
    await mkdir(path.join(fixture.repo, 'test', 'system'), { recursive: true });

    const result = await fixture.run();

    assert.equal(result.code, 0);
    assert.match(result.stdout, /system test/i);
    assert.doesNotMatch(result.stdout + result.stderr, /OTHER/);
  });

  test('no Orca CLI to run: it skips and says what to do about it', async (t) => {
    const fixture = await createRepo(t);
    const missing = path.join(path.dirname(fixture.orcaPath), 'not-installed');

    const result = await fixture.confirmed({ env: { ...fixture.env, OBK_ORCA: missing } });

    assertSkipped(result);
    // A skip is not a failure, and the reader is told how to turn it into a run.
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /start|open|launch|run/i);
  });

  test('the status command failing is a skip', async (t) => {
    const fixture = await createRepo(t, { orca: { ...READY, exitCode: 1 } });

    assertSkipped(await fixture.confirmed());
  });

  test('status printing something that is not JSON is a skip', async (t) => {
    // `/usr/local/bin/orca` on the owner's Mac exits 0 and prints an error:
    // reading the exit code alone would take that for a running Orca.
    const fixture = await createRepo(t, {
      orca: { stdout: 'orca: this CLI cannot run for this user\n' },
    });

    assertSkipped(await fixture.confirmed());
  });

  test('`ok: false` is a skip', async (t) => {
    const fixture = await createRepo(t, {
      orca: status({ ok: false, result: { runtime: { reachable: true } } }),
    });

    assertSkipped(await fixture.confirmed());
  });

  test('a runtime that is not reachable is a skip', async (t) => {
    const fixture = await createRepo(t, {
      orca: status({ ok: true, result: { runtime: { reachable: false } } }),
    });

    assertSkipped(await fixture.confirmed());
  });

  test('a status that says nothing about a reachable runtime is a skip, not a crash', async (t) => {
    // Orca is entitled to answer in any of these shapes; only the one shape
    // that says a runtime is reachable may start a run.
    for (const value of [null, { ok: true }, { ok: true, result: {} }, { ok: true, result: { runtime: {} } }]) {
      const fixture = await createRepo(t, { orca: status(value) });

      assertSkipped(await fixture.confirmed());
    }
  });

  test('with no OBK_ORCA it asks the Orca in /Applications, and an empty one is the same', async (t) => {
    // No sandbox can stand in for an absolute path into /Applications. What can
    // be checked is that leaving OBK_ORCA out, setting it empty, and naming that
    // path outright all reach the same answer on this machine — and that none of
    // them settles for an `orca` found on PATH.
    const fixture = await createRepo(t);

    const decisions = [];
    for (const override of [undefined, '', BUILT_IN_ORCA]) {
      const env = { ...fixture.envWithoutOverride };
      if (override !== undefined) env.OBK_ORCA = override;
      const result = await fixture.confirmed({ env });
      decisions.push({ code: result.code, skipped: /skip/i.test(result.stdout), ran: /ALPHA/.test(result.stdout) });
    }

    assert.deepEqual(decisions[1], decisions[0]);
    assert.deepEqual(decisions[2], decisions[0]);
    assert.deepEqual(argsOf(await fixture.orca.calls()), []);
  });

  // A test author once ran `npm run test:system` taking it for an ordinary
  // check, and it started driving the machine it was typed on without a word.
  describe('nobody drives this machine by accident', { concurrency: true }, () => {
    test('the command on its own drives nothing, and does not read as a pass', async (t) => {
      const fixture = await createRepo(t);

      const result = await fixture.run();

      assert.equal(result.signal, null, `it should decide and exit, not die: ${result.signal}`);
      assert.notEqual(result.code, 0, 'a run that ran no system test must not exit 0');
      assert.doesNotMatch(result.stdout + result.stderr, /ALPHA/);
      // Asking Orca how it is drives nothing; anything past that would.
      assert.deepEqual(argsOf(await fixture.orca.calls()), [['status', '--json']]);
    });

    test('the command on its own says what it would have driven, and how to drive it', async (t) => {
      const fixture = await createRepo(t);

      const result = await fixture.run();

      assertAnnounces(result, fixture, ['test/system/alpha.test.js']);
      assert.ok(
        result.stdout.includes(CONFIRM),
        `it should say how to run them for real, got: ${result.stdout}`,
      );
      // It has a whole stdout to say this on, and nothing was driven that
      // could own stderr.
      assert.equal(result.stderr, '');
    });

    test('the announcement says which Orca CLI, and that OBK_ORCA chose it', async (t) => {
      const fixture = await createRepo(t);

      for (const result of await eitherWay(fixture)) {
        assert.ok(
          result.stdout.includes(fixture.orcaPath),
          `it should name the CLI in use, got: ${result.stdout}`,
        );
        assertFromObkOrca(result, fixture.orcaPath);
      }
    });

    test('the announcement names every file it would run, one in a subfolder included', async (t) => {
      // The reader is agreeing to what these files do; a file left out of the
      // list is a thing driven that nobody agreed to.
      const fixture = await createRepo(t, {
        files: {
          'test/system/alpha.test.js': marker('ALPHA'),
          'test/system/nested/forgotten.test.js': marker('FORGOTTEN'),
          'test/system/nested/support.js': "process.stdout.write('NOT-A-TEST\\n');\n",
          'test/other.test.js': marker('OTHER'),
        },
      });

      const result = await fixture.run();

      assertAnnounces(result, fixture, [
        'test/system/alpha.test.js',
        'test/system/nested/forgotten.test.js',
      ]);
      const output = result.stdout + result.stderr;
      assert.ok(!output.includes('support.js'), `it should not name a file it will not run, got: ${output}`);
      assert.ok(!output.includes('other.test.js'), `it should not name a file it will not run, got: ${output}`);
    });

    test('the confirmed run announces first, then drives, then answers with their exit code', async (t) => {
      const fixture = await createRepo(t);

      const result = await fixture.confirmed();

      assertAnnounces(result, fixture, ['test/system/alpha.test.js']);
      assert.equal(result.code, 0);
      assert.match(result.stdout, /ALPHA/);
      // Said before it happens, not reported after: the order is the whole
      // point, so the announcement has to share the stream the run comes out on.
      const announced = result.stdout.indexOf(fixture.orcaPath);
      assert.ok(announced >= 0, `the announcement should reach stdout, got: ${result.stdout}`);
      assert.ok(
        announced < result.stdout.indexOf('ALPHA'),
        `the announcement should come before the run, got: ${result.stdout}`,
      );
    });

    test('Orca not answering is a skip that drives nothing, and still says which Orca it asked', async (t) => {
      // The skip itself this design leaves alone, so half of this is a guard.
      // The other half is new: whether a skip is the right answer is the
      // developer's to judge, and they cannot judge it without knowing which
      // Orca went unanswered.
      const fixture = await createRepo(t, {
        orca: status({ ok: true, result: { runtime: { reachable: false } } }),
      });

      for (const result of await eitherWay(fixture)) {
        assertSkipped(result);
        assertAnnounces(result, fixture);
        assertFromObkOrca(result, fixture.orcaPath);
      }
    });

    test('a skip names the Orca CLI it actually asked, not the one it would have preferred', async (t) => {
      const fixture = await createRepo(t);
      const missing = path.join(path.dirname(fixture.orcaPath), 'not-installed');

      const result = await fixture.confirmed({ env: { ...fixture.env, OBK_ORCA: missing } });

      assertSkipped(result);
      assertAnnounces(result, fixture, [], missing);
    });
  });

  // 99 Runs named `obk …` piled up on the owner's machine in a day of running
  // these. A Run is a session's address and outlives its tab, Orca offers no
  // way to delete one, and the only reset would empty the whole machine's
  // mailbox. So the pile cannot be cleared; what it can be is admitted, by the
  // run that made it, at the moment it made it.
  describe('what a run leaves behind', { concurrency: true }, () => {
    test('a run that made Runs names each one, and says why it could not remove them', async (t) => {
      const fixture = await createRepo(t, {
        runs: ALREADY_THERE,
        files: { 'test/system/alpha.test.js': mintsRuns('ALPHA', MINTED) },
      });

      const result = await fixture.confirmed();

      assert.equal(result.code, 0);
      const report = afterTheRun(result);
      for (const run of MINTED) {
        assert.ok(report.includes(run.id), `it should name ${run.id}, got: ${report}`);
        assert.ok(
          report.includes(run.objective),
          `it should say what ${run.id} is for (${run.objective}), got: ${report}`,
        );
      }
      // An id alone is not actionable. Why it is still there is the other half.
      assert.match(unwrapped(report), /delet|remov/i, `it should say they were not deleted, got: ${report}`);
      assert.match(
        unwrapped(report),
        /could ?n[o']t|cannot|can't|no way|unable|offers no|does not/i,
        `it should say why they are still there, got: ${report}`,
      );
    });

    test('a run that made no Runs says so, rather than saying nothing', async (t) => {
      // Silence reads as "the runner forgot", and a developer who has seen the
      // pile grow cannot tell the two apart.
      const fixture = await createRepo(t, { runs: ALREADY_THERE });

      const result = await fixture.confirmed();

      assert.equal(result.code, 0);
      const report = afterTheRun(result);
      assert.match(unwrapped(report), /run/i, `it should still speak of Runs, got: ${report}`);
      assert.match(
        unwrapped(report),
        /\b(no|none|nothing|zero)\b/i,
        `it should say there were none, got: ${report}`,
      );
    });

    test('Runs that were already there are not reported as left by this run', async (t) => {
      const fixture = await createRepo(t, {
        runs: ALREADY_THERE,
        files: { 'test/system/alpha.test.js': mintsRuns('ALPHA', MINTED) },
      });

      const result = await fixture.confirmed();

      const report = afterTheRun(result);
      // The half that makes the other half mean something: a report that names
      // nothing at all leaves out the old ones too, and proves nothing.
      for (const run of MINTED) {
        assert.ok(report.includes(run.id), `it should name ${run.id}, got: ${report}`);
      }
      for (const run of ALREADY_THERE) {
        assert.ok(!report.includes(run.id), `${run.id} was there before the run, got: ${report}`);
        assert.ok(!report.includes(run.objective), `${run.id} was there before the run, got: ${report}`);
      }
    });

    test('it names every Run it left, not just the first page of the listing', async (t) => {
      // The machine this came from was 99 Runs deep. A report that stops at
      // whatever one call hands back is a report that understates the pile
      // exactly when the pile is worth knowing about.
      const many = Array.from({ length: PAGE + 5 }, (_, n) => runNamed(`many${String(n).padStart(2, '0')}`, '12:00'));
      const fixture = await createRepo(t, {
        runs: ALREADY_THERE,
        files: { 'test/system/alpha.test.js': mintsRuns('ALPHA', many) },
      });

      const result = await fixture.confirmed();

      assert.equal(result.code, 0);
      const report = afterTheRun(result);
      for (const run of many) {
        assert.ok(report.includes(run.id), `it should name ${run.id}, got: ${report}`);
      }
    });

    test('a passing run still passes and a failing run still fails, report and all', async (t) => {
      // The report is an aside. What the command answers is the tests' verdict,
      // and nothing about what they left may move it either way.
      for (const thenFails of [false, true]) {
        const fixture = await createRepo(t, {
          runs: ALREADY_THERE,
          files: { 'test/system/alpha.test.js': mintsRuns('ALPHA', MINTED, { thenFails }) },
        });

        const result = await fixture.confirmed();

        assert.equal(result.code, thenFails ? 1 : 0);
        assert.equal(result.signal, null, `it should exit, not die: ${result.signal}`);
        assert.ok(
          result.stdout.includes(MINTED[0].id),
          `it should name what it left however the tests went, got: ${result.stdout}`,
        );
      }
    });

    test('the command on its own lists no Runs: nothing was driven, so nothing was left', async (t) => {
      const fixture = await createRepo(t, { runs: ALREADY_THERE });

      const result = await fixture.run();

      assert.notEqual(result.code, 0);
      assert.deepEqual(orcaCallsOf(await fixture.orca.calls(), 'orchestration run-list'), []);
    });

    test('a skip lists no Runs: nothing was driven, so nothing was left', async (t) => {
      const fixture = await createRepo(t, {
        orca: status({ ok: true, result: { runtime: { reachable: false } } }),
        runs: ALREADY_THERE,
      });

      for (const result of await eitherWay(fixture)) assertSkipped(result);

      assert.deepEqual(orcaCallsOf(await fixture.orca.calls(), 'orchestration run-list'), []);
    });

    test('Orca refusing the listing does not fail the run, and does not hide the tests\' verdict', async (t) => {
      for (const thenFails of [false, true]) {
        const fixture = await createRepo(t, {
          runs: ALREADY_THERE,
          runListFails: ALWAYS,
          files: { 'test/system/alpha.test.js': mintsRuns('ALPHA', MINTED, { thenFails }) },
        });

        const result = await fixture.confirmed();

        assert.equal(result.code, thenFails ? 1 : 0);
        assert.equal(result.signal, null, `it should exit, not die: ${result.signal}`);
        assertSaidItCouldNotTell(afterTheRun(result));
      }
    });

    test('Orca answering the listing with something that is not JSON is the same as refusing it', async (t) => {
      // `/usr/local/bin/orca` on the owner's Mac exits 0 and prints an error.
      const fixture = await createRepo(t, {
        runs: ALREADY_THERE,
        runListGarbles: ALWAYS,
        files: { 'test/system/alpha.test.js': mintsRuns('ALPHA', MINTED) },
      });

      const result = await fixture.confirmed();

      assert.equal(result.code, 0);
      assert.equal(result.signal, null, `it should exit, not die: ${result.signal}`);
      assertSaidItCouldNotTell(afterTheRun(result));
    });

    test('a Run that appeared is not by that fact one of the tests\'', async (t) => {
      // The machine is shared. An ordinary `obk up` — the owner's, another
      // developer's, Bot Father's — mints a mailbox through `run-create` at any
      // moment, and the runner cannot tell that Run from one of its own: the
      // tests work in throwaway folders whose names it never learns. So
      // "appeared while the tests ran" is all the two listings establish.
      //
      // Saying more is not a stylistic matter. Telling the owner that the live
      // mailbox of a session they are working in belongs to the tests and can
      // be ignored is the one line here that can cost them something.
      // Written out rather than built by `runNamed`, because the whole point of
      // it is that it is nobody in this fixture: another bot, another session.
      const live = { id: 'run_ownerlive', objective: 'obk owner-live/daily', created_at: '2026-09-21T13:00:00Z' };
      const fixture = await createRepo(t, {
        runs: ALREADY_THERE,
        appearsDuring: [live],
        // The tests themselves make nothing at all.
        files: { 'test/system/alpha.test.js': marker('ALPHA') },
      });

      const result = await fixture.confirmed();

      assert.equal(result.code, 0);
      const report = afterTheRun(result);
      assert.ok(report.includes(live.id), `it should still name ${live.id}, got: ${report}`);
      assert.ok(report.includes(live.objective), `it should say what ${live.id} is, got: ${report}`);
      assert.doesNotMatch(
        unwrapped(report),
        /ignore/i,
        `it should not tell the reader to disregard a Run it cannot account for, got: ${report}`,
      );
      // Asserted as something the report must say, not as words it must avoid.
      // The honest sentence here contains "the tests made" — inside "which of
      // them the tests made is not established" — so a report that denies the
      // attribution and one that asserts it share their words, and only the
      // denial can be looked for.
      assert.match(
        unwrapped(report),
        /not established|not known|do(es)? not know|cannot say|can't say|unknown|\bmay\b|\bmight\b|anything else|somebody else|someone else|another session/i,
        `it should say whose the Run is was not established, got: ${report}`,
      );
    });

    test('a window that cannot reach back past the run does not state a total', async (t) => {
      // Both listings are the newest hundred. The subtraction is exact as long
      // as the window reaches back past the start of the run — but the listing
      // covers every actor on the machine, not only the tests, so a hundred
      // Runs can appear from elsewhere and push the window off its own
      // beginning. Here the oldest new Run falls out of it unseen, and a bare
      // total would be a completeness two snapshots cannot establish.
      const appeared = Array.from({ length: LIMIT_CAP + 1 }, (_, n) => runNamed(`new${String(n).padStart(3, '0')}`, '12:00'));
      const fixture = await createRepo(t, {
        runs: Array.from({ length: 200 }, (_, n) => runNamed(`old${String(n).padStart(3, '0')}`, '09:00')),
        files: { 'test/system/alpha.test.js': mintsRuns('ALPHA', appeared) },
      });

      const result = await fixture.confirmed();

      assert.equal(result.code, 0);
      const report = afterTheRun(result);
      assert.match(
        unwrapped(report),
        HEDGE,
        `it should say the count is a floor, not a total, got: ${report}`,
      );
      // The gap is real, and it is the oldest of the new ones: the window never
      // reached it. What the runner did see, it still names.
      assert.ok(report.includes(appeared.at(-1).id), `it should name what it did see, got: ${report}`);
      assert.ok(!report.includes(appeared[0].id), `it never saw ${appeared[0].id}, got: ${report}`);
    });

    test('a full listing that still reaches back past the run is complete, and is not hedged', async (t) => {
      // The other side of it. This machine already carries a hundred Runs, so a
      // listing comes back full on every ordinary day; a runner that hedges
      // whenever it is full hedges always, and a qualifier that is always there
      // is one nobody reads. Full is not the test — overlap is.
      const fixture = await createRepo(t, {
        runs: Array.from({ length: 150 }, (_, n) => runNamed(`old${String(n).padStart(3, '0')}`, '09:00')),
        files: { 'test/system/alpha.test.js': mintsRuns('ALPHA', MINTED) },
      });

      const result = await fixture.confirmed();

      assert.equal(result.code, 0);
      const report = afterTheRun(result);
      for (const run of MINTED) {
        assert.ok(report.includes(run.id), `it should name ${run.id}, got: ${report}`);
      }
      assert.doesNotMatch(
        unwrapped(report),
        HEDGE,
        `the window reached back past the run, so nothing needs hedging, got: ${report}`,
      );
    });

    test('a listing that exits 0 without saying `ok` is not an empty machine', async (t) => {
      // The quiet one. Every Orca answer is `{ id, ok, result, _meta }`, and a
      // refusal exits 0 just the same, carrying an error where the result would
      // be. Reaching for `result.runs` and finding nothing there reads as a
      // machine with no new Runs on it — the runner would report the good news
      // it was never told, on the one path where it knows least.
      //
      // `ok` is the only thing that says whether an answer is one. An envelope
      // that carries a list while saying it failed, and one that carries a list
      // and says nothing either way, are both answers nobody has vouched for.
      for (const runListEnvelope of ['notOk', 'notOkWithRuns', 'noOk']) {
        const fixture = await createRepo(t, {
          runs: ALREADY_THERE,
          runListEnvelope,
          files: { 'test/system/alpha.test.js': mintsRuns('ALPHA', MINTED) },
        });

        const result = await fixture.confirmed();

        assert.equal(result.code, 0);
        assert.equal(result.signal, null, `it should exit, not die: ${result.signal}`);
        assertSaidItCouldNotTell(afterTheRun(result));
      }
    });

    test('the listing before the run failing does not make every Run look new', async (t) => {
      // Without a before, there is no new. Naming the Runs a developer already
      // had under "what this run left" is worse than saying nothing: it is the
      // opposite of the truth, at the length of the whole pile.
      const fixture = await createRepo(t, {
        runs: ALREADY_THERE,
        runListFails: 1,
        files: { 'test/system/alpha.test.js': mintsRuns('ALPHA', MINTED) },
      });

      const result = await fixture.confirmed();

      assert.equal(result.code, 0);
      const report = afterTheRun(result);
      assertSaidItCouldNotTell(report);
    });
  });

  // One system test file takes 20 to 70 minutes of attended running, and a
  // developer checking one feature live needs that one file, not all of them
  // (#325). The names are also the one way into this command from outside: the
  // owner allowed kit-dev's sessions to run it so the kit's own reviewed system
  // tests can run, and a name must never turn it into a way to run anything else.
  describe('naming the files to run', { concurrency: true }, () => {
    const BETA_FILE = 'test/system/beta.test.js';
    const GAMMA_FILE = 'test/system/nested/gamma.test.js';

    test('a named system test file runs alone', async (t) => {
      const fixture = await createRepo(t, { files: NAMED_FILES });

      const result = await fixture.confirmed({ names: [BETA_FILE] });

      assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
      assert.deepEqual(await ranIn(fixture), ['BETA']);
    });

    test('the named files\' verdict is the command\'s, not the verdict of the files left out', async (t) => {
      const fixture = await createRepo(t, {
        files: {
          ...NAMED_FILES,
          'test/system/alpha.test.js': [
            "import test from 'node:test';",
            '',
            "test('alpha', () => { throw new Error('ALPHA failed'); });",
            '',
          ].join('\n'),
        },
      });

      const passing = await fixture.confirmed({ names: [BETA_FILE] });
      const failing = await fixture.confirmed({ names: ['test/system/alpha.test.js'] });

      assert.equal(passing.code, 0, `alpha fails but was not named, got:\n${passing.stdout}${passing.stderr}`);
      assert.equal(failing.code, 1, `alpha was named and fails, got:\n${failing.stdout}${failing.stderr}`);
    });

    test('the confirmed run announces only the named files, before it runs them', async (t) => {
      const fixture = await createRepo(t, { files: NAMED_FILES });

      const result = await fixture.confirmed({ names: [BETA_FILE] });

      assertAnnounces(result, fixture, [BETA_FILE]);
      assert.ok(!result.stdout.includes('alpha.test.js'), `alpha was not named, got: ${result.stdout}`);
      assert.ok(!result.stdout.includes('gamma.test.js'), `gamma was not named, got: ${result.stdout}`);
      const ran = result.stdout.indexOf('BETA');
      assert.ok(ran >= 0, `the run's own output should reach stdout, got: ${result.stdout}`);
      assert.ok(result.stdout.indexOf(BETA_FILE) < ran, `the announcement should come before the run, got: ${result.stdout}`);
    });

    test('named without the confirmation: it announces those files and how many, drives nothing, and exits 2', async (t) => {
      const fixture = await createRepo(t, { files: NAMED_FILES });

      const result = await fixture.run({ names: [BETA_FILE, GAMMA_FILE] });

      assert.equal(result.code, 2, `${result.stdout}${result.stderr}`);
      assertAnnounces(result, fixture, [BETA_FILE, GAMMA_FILE]);
      assert.ok(!result.stdout.includes('alpha.test.js'), `alpha was not named, got: ${result.stdout}`);
      assert.match(result.stdout, /^.*\b2\b.*\bfiles?\b/im, `it should say how many files, got: ${result.stdout}`);
      assert.deepEqual(await ranIn(fixture), []);
      assert.deepEqual(orcaCallsOf(await fixture.orca.calls(), 'orchestration run-list'), []);
    });

    test('a named run is accounted for: the Runs that appeared are named, and those already there are not', async (t) => {
      const fixture = await createRepo(t, {
        runs: ALREADY_THERE,
        files: { ...NAMED_FILES, [BETA_FILE]: mintsRuns('BETA', MINTED) },
      });

      const result = await fixture.confirmed({ names: [BETA_FILE] });

      assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
      const report = afterTheRun(result, 'BETA');
      for (const run of MINTED) {
        assert.ok(report.includes(run.id), `it should name ${run.id}, got: ${report}`);
      }
      for (const run of ALREADY_THERE) {
        assert.ok(!report.includes(run.id), `${run.id} was there before the run, got: ${report}`);
      }
    });

    test('a name given twice runs once', async (t) => {
      const fixture = await createRepo(t, { files: NAMED_FILES });

      const result = await fixture.confirmed({ names: [BETA_FILE, BETA_FILE] });

      assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
      assert.deepEqual(await ranIn(fixture), ['BETA']);
    });

    test('an absolute name runs the file it names', async (t) => {
      const fixture = await createRepo(t, { files: NAMED_FILES });

      const result = await fixture.confirmed({ names: [path.join(fixture.repo, 'test', 'system', 'beta.test.js')] });

      assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
      assert.deepEqual(await ranIn(fixture), ['BETA']);
    });

    test('an absolute name spelled through a link above the repo runs the file it names', async (t) => {
      // A repo is often reached through a link above it: on macOS the temp
      // folder is /var/…, and its real path /private/var/…. The fixture repo is
      // known by its real path, so a link of the test's own stands in for that
      // on any machine, and the temp folder's own spelling is tried as well.
      const fixture = await createRepo(t, { files: NAMED_FILES });
      const through = path.join(fixture.outside, 'through');
      await symlink(path.dirname(fixture.repo), through);
      const tmpSpelling = path.join(os.tmpdir(), path.relative(await realpath(os.tmpdir()), fixture.repo));

      const viaLink = await fixture.confirmed({ names: [path.join(through, path.basename(fixture.repo), BETA_FILE)] });

      assert.equal(viaLink.code, 0, `${viaLink.stdout}${viaLink.stderr}`);
      assert.deepEqual(await ranIn(fixture), ['BETA']);

      const viaTmp = await fixture.confirmed({ names: [path.join(tmpSpelling, BETA_FILE)] });

      assert.equal(viaTmp.code, 0, `${viaTmp.stdout}${viaTmp.stderr}`);
      assert.deepEqual(await ranIn(fixture), ['BETA', 'BETA']);
    });

    test('a name that leaves test/system/ and comes straight back runs that file alone', async (t) => {
      const fixture = await createRepo(t, { files: NAMED_FILES });

      const result = await fixture.confirmed({ names: ['test/system/../system/beta.test.js'] });

      assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
      assert.deepEqual(await ranIn(fixture), ['BETA']);
    });

    test('the announcement names the file it will run, not the spelling it was named by', async (t) => {
      // What runs is the listed file's own path, so that is what the reader
      // is asked to agree to.
      const fixture = await createRepo(t, { files: NAMED_FILES });

      const result = await fixture.run({ names: ['test/system/../system/beta.test.js'] });

      assert.equal(result.code, 2, `${result.stdout}${result.stderr}`);
      assertAnnounces(result, fixture, [BETA_FILE]);
    });

    test('a file in a folder under test/system/ can be named', async (t) => {
      const fixture = await createRepo(t, { files: NAMED_FILES });

      const result = await fixture.confirmed({ names: [GAMMA_FILE] });

      assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
      assert.deepEqual(await ranIn(fixture), ['GAMMA']);
    });

    test('a relative name is read from the repo, whatever the working directory', async (t) => {
      const fixture = await createRepo(t, { files: NAMED_FILES });

      const result = await fixture.confirmed({ cwd: fixture.outside, names: [BETA_FILE] });

      assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
      assert.deepEqual(await ranIn(fixture), ['BETA']);
    });

    test('with no names every system test file still runs, and nothing else', async (t) => {
      const fixture = await createRepo(t, { files: NAMED_FILES });

      const result = await fixture.confirmed();

      assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
      assert.deepEqual(await ranIn(fixture), ['ALPHA', 'BETA', 'GAMMA']);
    });

    test('named, with Orca not ready: the same skip, exit 0, nothing run', async (t) => {
      const fixture = await createRepo(t, {
        files: NAMED_FILES,
        orca: status({ ok: true, result: { runtime: { reachable: false } } }),
      });

      const result = await fixture.confirmed({ names: [BETA_FILE] });

      assertSkipped(result);
      assert.deepEqual(await ranIn(fixture), []);
    });

    describe('a name that is not a system test file is refused, and nothing runs', { concurrency: true }, () => {
      for (const [what, nameIn] of REFUSED) {
        test(`${what} is refused before Orca is asked anything`, async (t) => {
          const fixture = await withWaysOut(await createRepo(t, { files: NAMED_FILES }));
          const name = nameIn(fixture);

          const refused = await fixture.confirmed({ names: [name] });

          assertRefused(refused, name);
          assert.deepEqual(await ranIn(fixture), [], `nothing should have run, got:\n${refused.stdout}${refused.stderr}`);
          assert.deepEqual(argsOf(await fixture.orca.calls()), []);

          // The same repo with a name it runs: the log and the fake Orca both
          // hear of it, so their silence above was the refusal's doing.
          const accepted = await fixture.confirmed({ names: [BETA_FILE] });

          assert.equal(accepted.code, 0, `${accepted.stdout}${accepted.stderr}`);
          assert.deepEqual(await ranIn(fixture), ['BETA']);
          assert.deepEqual(argsOf(orcaCallsOf(await fixture.orca.calls(), 'status')), [['status', '--json']]);
        });
      }

      test('the refusal says that only files under test/system/ can be run', async (t) => {
        // The name has no `test/system` in it, so the words are the reason and
        // not the name said back.
        const fixture = await createRepo(t, { files: NAMED_FILES });

        const result = await fixture.confirmed({ names: ['test/other.test.js'] });

        assertRefused(result, 'test/other.test.js', 'test/system');
      });

      test('one refused name among several refuses them all: none of them runs', async (t) => {
        const fixture = await createRepo(t, { files: NAMED_FILES });

        const refused = await fixture.confirmed({ names: [BETA_FILE, 'test/other.test.js', GAMMA_FILE] });

        assertRefused(refused, 'test/other.test.js');
        assert.deepEqual(await ranIn(fixture), [], `nothing should have run, got:\n${refused.stdout}${refused.stderr}`);
        assert.deepEqual(argsOf(await fixture.orca.calls()), []);

        const accepted = await fixture.confirmed({ names: [BETA_FILE, GAMMA_FILE] });

        assert.equal(accepted.code, 0, `${accepted.stdout}${accepted.stderr}`);
        assert.deepEqual(await ranIn(fixture), ['BETA', 'GAMMA']);
      });

      test('without the confirmation a refused name is still refused: 1, not the 2 of a run not confirmed', async (t) => {
        const fixture = await createRepo(t, { files: NAMED_FILES });

        const refused = await fixture.run({ names: ['test/other.test.js'] });

        assertRefused(refused, 'test/other.test.js');
        assert.deepEqual(argsOf(await fixture.orca.calls()), []);

        const unconfirmed = await fixture.run({ names: [BETA_FILE] });

        assert.equal(unconfirmed.code, 2, `${unconfirmed.stdout}${unconfirmed.stderr}`);
      });

      test('with Orca not ready a refused name is still refused, not skipped', async (t) => {
        // The refusal comes before the readiness check: a name outside
        // test/system/ is wrong whatever state Orca is in.
        const fixture = await createRepo(t, {
          files: NAMED_FILES,
          orca: status({ ok: true, result: { runtime: { reachable: false } } }),
        });

        const refused = await fixture.confirmed({ names: ['test/other.test.js'] });

        assertRefused(refused, 'test/other.test.js');
        assert.deepEqual(argsOf(await fixture.orca.calls()), []);

        const accepted = await fixture.confirmed({ names: [BETA_FILE] });

        assertSkipped(accepted);
        assert.deepEqual(argsOf(await fixture.orca.calls()), [['status', '--json']]);
      });
    });
  });

  // #318's accident: a test author checked that a new system test loads with
  // `node -e "import('./test/system/…')"`, and loading a node:test file runs it,
  // so it ran once against the real Orca. The runner is the one reviewed way
  // in, and a system test loaded any other way must drive nothing (#328).
  describe('a system test drives the machine only when this command started it', { concurrency: true }, () => {
    describe('the helper a system test takes its `test` from', { concurrency: true }, () => {
      test('loaded by `node --test` without OBK_SYSTEM_TESTS, the test is skipped, its body never runs, and it says how to run it', { loadsRunner: false }, async (t) => {
        const file = await guardedFile(t);

        const result = await file.viaTest();

        assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
        assertGated(result, 'node --test');
        assert.deepEqual(await file.ran(), [], 'the body should never have run');
      });

      test('loaded by `node --test` with the runner\'s own reporter, the developer is told the command', { loadsRunner: false }, async (t) => {
        const file = await guardedFile(t);

        const result = await file.viaTest({ reporter: false });

        assert.ok(
          `${result.stdout}${result.stderr}`.includes(HOW_TO_RUN),
          `the output should name \`${HOW_TO_RUN}\`, got:\n${result.stdout}${result.stderr}`,
        );
        assert.deepEqual(await file.ran(), [], 'the body should never have run');
      });

      test('loaded by `node -e "import(...)"` without OBK_SYSTEM_TESTS, the same: skipped, body never run, the command named', { loadsRunner: false }, async (t) => {
        const file = await guardedFile(t);

        const result = await file.viaImport();
        const plain = await file.viaImport({ reporter: false });

        assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
        assertGated(result, 'node -e import');
        assert.ok(
          `${plain.stdout}${plain.stderr}`.includes(HOW_TO_RUN),
          `the output should name \`${HOW_TO_RUN}\`, got:\n${plain.stdout}${plain.stderr}`,
        );
        assert.deepEqual(await file.ran(), [], 'the body should never have run');
      });

      test('OBK_SYSTEM_TESTS set to anything but exactly 1 is the same as not set', { loadsRunner: false }, async (t) => {
        const file = await guardedFile(t);

        for (const gate of ['', '0', 'true', 'yes', '01', '1 ', ' 1', '11']) {
          const result = await file.viaTest({ gate });

          assertGated(result, `OBK_SYSTEM_TESTS=${JSON.stringify(gate)}`);
        }
        assert.deepEqual(await file.ran(), [], 'the body should never have run');
      });

      test('with OBK_SYSTEM_TESTS=1 it is node:test\'s test: the body runs, with its test context, and passes', { loadsRunner: false }, async (t) => {
        const file = await guardedFile(t);

        const tested = await file.viaTest({ gate: '1' });
        const imported = await file.viaImport({ gate: '1' });

        for (const [what, result] of [['node --test', tested], ['node -e import', imported]]) {
          assert.equal(result.code, 0, `${what}: ${result.stdout}${result.stderr}`);
          assert.deepEqual(
            reported(result),
            [{ type: 'test:pass', name: 'GUARDED', skip: null }],
            `${what}: it should run and pass, not skip, got:\n${result.stdout}${result.stderr}`,
          );
        }
        // Once for each load, and each time handed a test context with `after`,
        // which is what the system tests clean up with.
        assert.deepEqual(await file.ran(), ['function', 'function']);
      });

      test('with OBK_SYSTEM_TESTS=1 a body that fails fails the test, as node:test\'s own would', { loadsRunner: false }, async (t) => {
        const file = await guardedFile(t, { fails: true });

        const result = await file.viaTest({ gate: '1' });

        assert.equal(result.code, 1, `${result.stdout}${result.stderr}`);
        assert.deepEqual(
          reported(result).map(({ type, name }) => ({ type, name })),
          [{ type: 'test:fail', name: 'GUARDED' }],
          `${result.stdout}${result.stderr}`,
        );
        assert.deepEqual(await file.ran(), ['function']);
      });
    });

    describe('the runner', { concurrency: true }, () => {
      test('the confirmed run starts the system tests with OBK_SYSTEM_TESTS=1, a folder down as well', async (t) => {
        const fixture = await createRepo(t, {
          files: {
            'test/system/alpha.test.js': seesGate('ALPHA'),
            'test/system/nested/gamma.test.js': seesGate('GAMMA'),
          },
        });

        const result = await fixture.confirmed();

        assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
        assert.deepEqual(await ranIn(fixture), ['ALPHA:1', 'GAMMA:1']);
      });

      test('the confirmed run sets OBK_SYSTEM_TESTS=1 whatever the developer\'s shell had in it', async (t) => {
        const fixture = await createRepo(t, { files: { 'test/system/alpha.test.js': seesGate('ALPHA') } });

        const result = await fixture.confirmed({ env: { ...fixture.env, [GATE]: '0' } });

        assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
        assert.deepEqual(await ranIn(fixture), ['ALPHA:1']);
      });

      test('a named run starts the named file with OBK_SYSTEM_TESTS=1 too', async (t) => {
        const fixture = await createRepo(t, {
          files: {
            'test/system/alpha.test.js': seesGate('ALPHA'),
            'test/system/beta.test.js': seesGate('BETA'),
          },
        });

        const result = await fixture.confirmed({ names: ['test/system/beta.test.js'] });

        assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
        assert.deepEqual(await ranIn(fixture), ['BETA:1']);
      });
    });

    test('a system test on the real helper runs under the confirmed command, and loaded any other way runs nothing and says how to run it', async (t) => {
      // End to end, in a throwaway repo: a copy of the real helper beside a
      // system test written the way the real ones are. Loaded directly first,
      // so that anything in ran.log afterwards is the confirmed run's.
      const fixture = await createRepo(t, {
        files: {
          'test/helpers/system.js': await readFile(helperEntry, 'utf8'),
          'test/system/alpha.test.js': behindTheGate('ALPHA'),
        },
      });

      const direct = await node(['--test', 'test/system/alpha.test.js'], { cwd: fixture.repo, env: fixture.env });
      const imported = await node(['-e', "import('./test/system/alpha.test.js')"], { cwd: fixture.repo, env: fixture.env });

      for (const [what, result] of [['node --test', direct], ['node -e import', imported]]) {
        assert.ok(
          `${result.stdout}${result.stderr}`.includes(HOW_TO_RUN),
          `${what}: it should name \`${HOW_TO_RUN}\`, got:\n${result.stdout}${result.stderr}`,
        );
      }
      assert.deepEqual(await ranIn(fixture), [], 'loaded directly, the system test\'s body should never have run');

      const confirmed = await fixture.confirmed();

      assert.equal(confirmed.code, 0, `${confirmed.stdout}${confirmed.stderr}`);
      assert.deepEqual(await ranIn(fixture), ['ALPHA'], 'under the confirmed command it should have run once');
    });
  });
});

// ---------------------------------------------------------------------------
// What a run leaves in the harnesses' own configs (#240, the architect's
// rulings of 2026-09-28).
//
// A system test's Codex session is given its folder's trust at launch, so Codex
// writes nothing about it into the user's own ~/.codex/config.toml; Claude Code
// writes a `projects` entry for its folder into ~/.claude.json on every start,
// and what to do about that is the owner's call. So the runner reads, before
// the system tests and again after, whatever their result:
//
//   Codex   `${CODEX_HOME || <HOME>/.codex}/config.toml`: the keys of its
//           `[projects."…"]` and `[hooks.state."…"]` table headers, nothing else
//   Claude  `${CLAUDE_CONFIG_DIR ? <it>/.claude.json : <HOME>/.claude.json}`: the
//           keys of its `projects` object, nothing else
//
// and looks at the keys added during the run that are the run's own: a path,
// in either spelling of a macOS temp path, whose folder directly under the temp
// folder is named `obk-system-*` (for a hooks.state key, the path is the part
// before the hooks file's `:<event>:…`). Such a Codex key fails the run, but
// for one under an `obk-system-codex-screens-*` folder (#240), an
// `obk-system-codex-groom-*` one (#238) or an `obk-system-temp-of-temp-*` one
// (#464), the three tests known to write them,
// which is named and does not change the exit code. Such a
// Claude key is named and never changes the exit code, pending the owner. A key
// that was there before, or one that is not the run's, is never named: the
// owner's own sessions write both files while a run goes on.
//
// Here HOME and TMPDIR are the sandbox's own (helpers/cli.js), so <HOME> and the
// temp folder are the fixture's, and CODEX_HOME and CLAUDE_CONFIG_DIR are set or
// left out by each test. The fixture's system test files write the configs
// mid-run, as other fixtures write the fake Orca's world.

/** A value in the configs that the runner must never print: they may hold secrets. */
const SECRET = 'sk-SECRET-7731-never-print';

/**
 * Where the sandbox's temp folder is: `real` and `bare`, both of a macOS temp
 * path's spellings, for keys to name; `dir`, the folder as it is, where a
 * folder can be made on any system; and `other`, the other spelling of `dir`
 * when it names the same folder (macOS's `/private/var` and `/var`), or
 * undefined where it does not (Linux, whose temp folder has no `/private` form).
 */
function tempSpellings(fixture) {
  const dir = fixture.env.TMPDIR;
  const bare = dir.replace(/^\/private(?=\/)/, '');
  const candidate = dir.startsWith('/private/') ? bare : `/private${dir}`;
  let other;
  try {
    if (realpathSync(candidate) === realpathSync(dir)) other = candidate;
  } catch {
    other = undefined;
  }
  return { real: `/private${bare}`, bare, dir, other };
}

/**
 * A system test file that writes the harness configs while it runs: `removes`
 * is files (or folders where a file should be) it takes away first, `writes` is
 * `[{ file, text }]`, each file then written whole (its folder made first), and
 * `makes` is folders it makes after that, a run's own throwaway folder or a
 * folder where a config file was. It prints its marker, and fails afterwards
 * when `thenFails` says so.
 */
const writesConfigs = (name, { writes = [], removes = [], makes = [], thenFails = false } = {}) => [
  "import { mkdirSync, rmSync, writeFileSync } from 'node:fs';",
  "import path from 'node:path';",
  "import test from 'node:test';",
  '',
  `test(${JSON.stringify(name)}, () => {`,
  `  for (const file of ${JSON.stringify(removes)}) rmSync(file, { force: true, recursive: true });`,
  `  for (const { file, text } of ${JSON.stringify(writes)}) {`,
  '    mkdirSync(path.dirname(file), { recursive: true });',
  '    writeFileSync(file, text);',
  '  }',
  `  for (const folder of ${JSON.stringify(makes)}) mkdirSync(folder, { recursive: true });`,
  `  process.stdout.write(${JSON.stringify(`${name}\n`)});`,
  ...(thenFails ? [`  throw new Error(${JSON.stringify(`${name} failed`)});`] : []),
  '});',
  '',
].join('\n');

/**
 * A config.toml holding these trust tables, among a secret and Codex's
 * new-model notice counter, `[tui.model_availability_nux]`: a model name and a
 * count, which is no secret (#456), so not the secret here either.
 */
const codexConfig = ({ projects = [], hooks = [] }) => [
  'model = "gpt-6-luna"',
  `api_key = "${SECRET}"`,
  '',
  ...projects.flatMap((key) => [`[projects.${JSON.stringify(key)}]`, 'trust_level = "trusted"', '']),
  ...hooks.flatMap((key) => [`[hooks.state.${JSON.stringify(key)}]`, `trusted_hash = "${SECRET}"`, '']),
  '[tui.model_availability_nux]',
  '"gpt-6-luna" = 3',
  '',
].join('\n');

/** A .claude.json holding these projects, and a secret beside them and in each. */
const claudeConfig = (projects) => `${JSON.stringify({
  numStartups: 12,
  oauthAccount: { accessToken: SECRET },
  projects: Object.fromEntries(projects.map((key) => [key, { allowedTools: [SECRET], hasTrustDialogAccepted: true }])),
}, null, 2)}\n`;

/**
 * A fixture repo, and where its harness configs are: the defaults under the
 * sandbox's HOME, or CODEX_HOME's and CLAUDE_CONFIG_DIR's when `codexHome` or
 * `claudeDir` asks for them. `build` is given the fixture's temp folder, in
 * both spellings, and answers `{ before, during, codexHome, claudeDir,
 * thenFails }`: `before` is written into those files before the run, and its
 * `makes` are folders made before it; `during` is what the run's one system
 * test writes, removes and makes. `env` is the
 * environment to run with, the machine's own CODEX_HOME and CLAUDE_CONFIG_DIR
 * taken out whatever this shell has.
 */
async function withConfigs(t, build = () => ({})) {
  const probe = await createRepo(t);
  const temp = tempSpellings(probe);
  const { before = {}, during = {}, codexHome = false, claudeDir = false, thenFails = false } = build(temp);
  const box = path.dirname(probe.repo);
  const home = probe.env.HOME;
  const codexDir = codexHome ? path.join(box, 'codex-home') : path.join(home, '.codex');
  const claudeFolder = claudeDir ? path.join(box, 'claude-config') : home;
  const files = {
    codex: path.join(codexDir, 'config.toml'),
    claude: path.join(claudeFolder, '.claude.json'),
  };
  const writes = [];
  if (during.codex !== undefined) writes.push({ file: files.codex, text: during.codex });
  if (during.claude !== undefined) writes.push({ file: files.claude, text: during.claude });
  const removes = (during.removes ?? []).map((which) => files[which]);
  // A folder the run makes: a path, or `codex` / `claude` for a folder where that config file is.
  const makes = (during.makes ?? []).map((one) => files[one] ?? one);
  await write(probe.repo, 'test/system/alpha.test.js', writesConfigs('ALPHA', { writes, removes, makes, thenFails }));
  if (before.codex !== undefined) await write(path.dirname(files.codex), 'config.toml', before.codex);
  if (before.claude !== undefined) await write(path.dirname(files.claude), '.claude.json', before.claude);
  // Folders already there when the run starts: another session's throwaway folder, say.
  for (const folder of before.makes ?? []) await mkdir(folder, { recursive: true });

  const { CODEX_HOME: _codex, CLAUDE_CONFIG_DIR: _claude, ...rest } = probe.env;
  const env = {
    ...rest,
    ...(codexHome ? { CODEX_HOME: codexDir } : {}),
    ...(claudeDir ? { CLAUDE_CONFIG_DIR: claudeFolder } : {}),
  };
  return { fixture: probe, files, env, temp, home };
}

/** Everything the run printed, both streams: what must never hold a secret or another key. */
const everything = (result) => `${result.stdout}${result.stderr}`;

/** The report on the harness configs, after the run, and it names the key whole. */
function assertNamed(result, key, what) {
  const report = afterTheRun(result);
  assert.ok(report.includes(key), `${what}: the report should name ${key} whole, got:\n${report}`);
}

/** The key is named nowhere in what the run printed. */
function assertNotNamed(result, key, what) {
  assert.ok(!everything(result).includes(key), `${what}: ${key} should be named nowhere, got:\n${everything(result)}`);
}

/** Nothing secret and no key but the named ones reached the output. */
function assertNoSecrets(result, others = []) {
  assert.ok(!everything(result).includes(SECRET), `no value from either file should be printed, got:\n${everything(result)}`);
  for (const key of others) assertNotNamed(result, key, 'a key that is not the run\'s');
}

describe('test-system: what a run leaves in the harness configs (#240)', { concurrency: true }, () => {
  test('a Codex folder-trust key the run added under an obk-system folder fails a run whose tests passed, and is named', async (t) => {
    const owner = '/Users/owner/work/app';
    let key;
    const { fixture, env } = await withConfigs(t, ({ real }) => {
      key = `${real}/obk-system-alpha-Ab12/bots`;
      return {
        before: { codex: codexConfig({ projects: [owner] }) },
        during: { codex: codexConfig({ projects: [owner, key] }) },
      };
    });

    const result = await fixture.confirmed({ env });

    assert.equal(result.code, 1, `the run should fail on it though its tests passed:\n${everything(result)}`);
    assertNamed(result, key, 'a Codex projects key');
    assertNoSecrets(result, [owner]);
  });

  test('a Codex hooks.state key the run added fails the run, and is named by its hooks file', async (t) => {
    let hooksFile;
    const { fixture, env } = await withConfigs(t, ({ real }) => {
      hooksFile = `${real}/obk-system-alpha-Cd34/bots/bots/coder/.codex/hooks.json`;
      return {
        before: { codex: codexConfig({}) },
        during: { codex: codexConfig({ hooks: [`${hooksFile}:SessionStart:0:0`] }) },
      };
    });

    const result = await fixture.confirmed({ env });

    assert.equal(result.code, 1, `the run should fail on it though its tests passed:\n${everything(result)}`);
    assertNamed(result, hooksFile, 'a Codex hooks.state key');
    assertNoSecrets(result);
  });

  test('a run key in the /var spelling of the temp folder is the run\'s too', async (t) => {
    let key;
    const { fixture, env } = await withConfigs(t, ({ bare }) => {
      key = `${bare}/obk-system-alpha-Ef56/bots`;
      return { during: { codex: codexConfig({ projects: [key] }) } };
    });

    const result = await fixture.confirmed({ env });

    assert.equal(result.code, 1, `the run should fail on it:\n${everything(result)}`);
    assertNamed(result, key, 'the /var spelling');
  });

  test('a Codex key under an obk-system-codex-screens folder is named as that test\'s known writes, and the exit code stays the tests\'', async (t) => {
    let key;
    let hooksFile;
    const { fixture, env } = await withConfigs(t, ({ real }) => {
      key = `${real}/obk-system-codex-screens-Gh78/bots`;
      hooksFile = `${real}/obk-system-codex-screens-Gh78/bots/bots/screens-codex/.codex/hooks.json`;
      return { during: { codex: codexConfig({ projects: [key], hooks: [`${hooksFile}:SessionStart:0:0`] }) } };
    });

    const result = await fixture.confirmed({ env });

    assert.equal(result.code, 0, `the known writes do not fail a run whose tests passed:\n${everything(result)}`);
    assertNamed(result, key, 'a codex-screens projects key');
    assertNamed(result, hooksFile, 'a codex-screens hooks.state key');
    assert.match(unwrapped(afterTheRun(result)), /#240/, `it should say these are the test's known writes (#240), got:\n${afterTheRun(result)}`);
    assertNoSecrets(result);
  });

  test('a Claude projects key the run added is named as a report, and never changes the exit code', async (t) => {
    const owner = '/Users/owner/work/other';
    let key;
    const { fixture, env } = await withConfigs(t, ({ real }) => {
      key = `${real}/obk-system-alpha-Ij90/bots/bots/bot-father`;
      return {
        before: { claude: claudeConfig([owner]) },
        during: { claude: claudeConfig([owner, key]) },
      };
    });

    const result = await fixture.confirmed({ env });

    assert.equal(result.code, 0, `a Claude key is reported, not failed:\n${everything(result)}`);
    assertNamed(result, key, 'a Claude projects key');
    assertNoSecrets(result, [owner]);
  });

  // Holds before the runner reads the configs at all, and is here so that it
  // goes on holding once it does: the check's quiet side.
  test('a key that was there before is never named, even the run\'s own kind, and neither is an added key that is not the run\'s', async (t) => {
    let quiet;
    const { fixture, env } = await withConfigs(t, ({ real }) => {
      const earlier = `${real}/obk-system-alpha-Kl12/bots`;
      const earlierHooks = `${real}/obk-system-alpha-Kl12/bots/bots/x/.codex/hooks.json:SessionStart:0:0`;
      const notTheRuns = [
        '/Users/owner/work/new-app',
        `${real}/obk-other-Mn34/bots`,
        `${real}/work/obk-system-alpha-Op56/bots`,
        '/Users/owner/obk-system-alpha-Qr78/bots',
      ];
      quiet = [earlier, earlierHooks, ...notTheRuns];
      return {
        before: {
          codex: codexConfig({ projects: [earlier], hooks: [earlierHooks] }),
          claude: claudeConfig([earlier]),
        },
        during: {
          codex: codexConfig({ projects: [earlier, ...notTheRuns], hooks: [earlierHooks] }),
          claude: claudeConfig([earlier, ...notTheRuns]),
        },
      };
    });

    const result = await fixture.confirmed({ env });

    assert.equal(result.code, 0, `nothing of the run's own was added:\n${everything(result)}`);
    for (const key of quiet) assertNotNamed(result, key, 'not added by the run, or not the run\'s');
    assertNoSecrets(result);
  });

  for (const thenFails of [false, true]) {
    test(`the report comes whatever the tests did, and a Claude key does not change the exit code (${thenFails ? 'tests failed' : 'tests passed'})`, async (t) => {
      let key;
      const { fixture, env } = await withConfigs(t, ({ real }) => {
        key = `${real}/obk-system-alpha-St90/bots`;
        return { during: { claude: claudeConfig([key]) }, thenFails };
      });

      const result = await fixture.confirmed({ env });

      assert.equal(result.code, thenFails ? 1 : 0, everything(result));
      assertNamed(result, key, 'the report after the run, whatever its result');
    });
  }

  test('a failing run with a Codex key added still names it, and exits 1', async (t) => {
    let key;
    const { fixture, env } = await withConfigs(t, ({ real }) => {
      key = `${real}/obk-system-alpha-Uv12/bots`;
      return { during: { codex: codexConfig({ projects: [key] }) }, thenFails: true };
    });

    const result = await fixture.confirmed({ env });

    assert.equal(result.code, 1, everything(result));
    assertNamed(result, key, 'a Codex key after failing tests');
  });

  test('CODEX_HOME and CLAUDE_CONFIG_DIR say where the configs are, and the defaults under HOME are then not read', async (t) => {
    let codexKey;
    let claudeKey;
    let ignored;
    const { fixture, env, home } = await withConfigs(t, ({ real }) => {
      codexKey = `${real}/obk-system-alpha-Wx34/bots`;
      claudeKey = `${real}/obk-system-alpha-Yz56/bots`;
      ignored = [`${real}/obk-system-alpha-Ignored1/bots`, `${real}/obk-system-alpha-Ignored2/bots`];
      return {
        codexHome: true,
        claudeDir: true,
        during: { codex: codexConfig({ projects: [codexKey] }), claude: claudeConfig([claudeKey]) },
      };
    });
    // The same kind of key in the files at the defaults, which are not the ones in use.
    await write(fixture.repo, 'test/system/beta.test.js', writesConfigs('BETA', {
      writes: [
        { file: path.join(home, '.codex', 'config.toml'), text: codexConfig({ projects: [ignored[0]] }) },
        { file: path.join(home, '.claude.json'), text: claudeConfig([ignored[1]]) },
      ],
    }));

    const result = await fixture.confirmed({ env });

    assert.equal(result.code, 1, `the Codex key in CODEX_HOME fails the run:\n${everything(result)}`);
    const report = afterTheRun(result, 'BETA');
    assert.ok(report.includes(codexKey), `CODEX_HOME's config.toml is read, got:\n${report}`);
    assert.ok(report.includes(claudeKey), `CLAUDE_CONFIG_DIR's .claude.json is read, got:\n${report}`);
    assertNotNamed(result, ignored[0], 'the default config.toml, with CODEX_HOME set');
    assertNotNamed(result, ignored[1], 'the default .claude.json, with CLAUDE_CONFIG_DIR set');
  });

  test('no config files at all, before or after, is no keys: no crash, and a short line that nothing was added', async (t) => {
    const { fixture, env } = await withConfigs(t);

    const result = await fixture.confirmed({ env });

    assert.equal(result.code, 0, everything(result));
    const lines = afterTheRun(result).split('\n').filter((line) => /harness|config/i.test(line) && /\b(?:no|none|nothing)\b/i.test(line));
    assert.ok(lines.length > 0, `one line should say the harness configs gained no keys under the run's folders, got:\n${afterTheRun(result)}`);
  });

  test('a config that appears during the run is read after it, and one that goes is no keys, with no crash', async (t) => {
    let key;
    const { fixture, env } = await withConfigs(t, ({ real }) => {
      key = `${real}/obk-system-alpha-Ab90/bots`;
      return {
        before: { claude: claudeConfig([`${real}/obk-system-alpha-Gone1/bots`]) },
        during: { codex: codexConfig({ projects: [key] }), removes: ['claude'] },
      };
    });

    const result = await fixture.confirmed({ env });

    assert.equal(result.code, 1, `the Codex key in a config.toml made during the run fails it:\n${everything(result)}`);
    assertNamed(result, key, 'a key in a file that was not there before');
  });

  for (const [which, broken] of [
    ['.claude.json that is not JSON', { claude: `{ "projects": { "${SECRET}": ` }],
    ['.claude.json whose projects is not an object', { claude: `${JSON.stringify({ projects: [SECRET] })}\n` }],
  ]) {
    test(`an unreadable config says so in one line, and is not a failure: a ${which}`, async (t) => {
      const { fixture, env } = await withConfigs(t, () => ({ before: broken, during: broken }));

      const result = await fixture.confirmed({ env });

      assert.equal(result.code, 0, everything(result));
      const lines = afterTheRun(result).split('\n').filter((line) => line.includes('.claude.json'));
      assert.ok(
        lines.some((line) => /could ?n[o']t|cannot|can't|unable|unreadable|not (?:be )?read|invalid|not json/i.test(line)),
        `a line should say the .claude.json could not be read, got:\n${afterTheRun(result)}`,
      );
      assertNoSecrets(result);
    });
  }

  test('a config.toml that cannot be read says so in one line, and is not a failure', async (t) => {
    const { fixture, env, files } = await withConfigs(t);
    // A folder where the file should be: there, and not readable as a file.
    await mkdir(files.codex, { recursive: true });

    const result = await fixture.confirmed({ env });

    assert.equal(result.code, 0, everything(result));
    const lines = afterTheRun(result).split('\n').filter((line) => line.includes('config.toml'));
    assert.ok(
      lines.some((line) => /could ?n[o']t|cannot|can't|unable|unreadable|not (?:be )?read/i.test(line)),
      `a line should say config.toml could not be read, got:\n${afterTheRun(result)}`,
    );
  });

  // The review of PR #433: any <tmp>/obk-system-* folder was taken for the run's
  // own, so a key another session's system test added mid-run, under a folder
  // that was there before this run began, failed this run. A folder is the
  // run's only if it was not under the temp folder when the run started; the
  // fixtures above name folders that never exist, and so were not there before.
  test('a key added mid-run under an obk-system folder that was there before the run is not the run\'s: not named, not failed', async (t) => {
    let key;
    const { fixture, env } = await withConfigs(t, ({ dir }) => {
      const theirs = `${dir}/obk-system-other-session-123`;
      key = `${theirs}/bots`;
      return { before: { makes: [theirs] }, during: { codex: codexConfig({ projects: [key] }) } };
    });

    const result = await fixture.confirmed({ env });

    assert.equal(result.code, 0, `a key under another session's folder does not fail this run:\n${everything(result)}`);
    assertNotNamed(result, key, 'a key under a folder that was there before the run');
  });

  test('a Claude key added mid-run under an obk-system folder that was there before the run is not reported as the run\'s', async (t) => {
    let key;
    const { fixture, env } = await withConfigs(t, ({ dir }) => {
      const theirs = `${dir}/obk-system-other-session-456`;
      key = `${theirs}/bots/bots/bot-father`;
      return { before: { makes: [theirs] }, during: { claude: claudeConfig([key]) } };
    });

    const result = await fixture.confirmed({ env });

    assert.equal(result.code, 0, everything(result));
    assertNotNamed(result, key, 'a Claude key under a folder that was there before the run');
  });

  test('a codex-screens key under a folder that was there before the run is not named as the run\'s known writes either', async (t) => {
    let key;
    const { fixture, env } = await withConfigs(t, ({ dir }) => {
      const theirs = `${dir}/obk-system-codex-screens-Other9`;
      key = `${theirs}/bots`;
      return { before: { makes: [theirs] }, during: { codex: codexConfig({ projects: [key] }) } };
    });

    const result = await fixture.confirmed({ env });

    assert.equal(result.code, 0, everything(result));
    assertNotNamed(result, key, 'another session\'s codex-screens key');
  });

  test('a Codex key under an obk-system-codex-groom folder made mid-run is named as that test\'s known writes (#238), and the exit code stays the tests\'', async (t) => {
    // codex-groom-run's Codex run is started with no trust given at launch, and
    // its maker answers its folder trust and its hooks review, so Codex writes
    // both for its folder (#238, the architect's ruling).
    let key;
    let hooksFile;
    const { fixture, env } = await withConfigs(t, ({ dir }) => {
      const mine = `${dir}/obk-system-codex-groom-Kl12`;
      key = `${mine}/bots/bots/bot-father`;
      hooksFile = `${mine}/bots/bots/bot-father/.codex/hooks.json`;
      return {
        before: { codex: codexConfig({}) },
        during: { makes: [mine], codex: codexConfig({ projects: [key], hooks: [`${hooksFile}:session_start:0:0`] }) },
      };
    });

    const result = await fixture.confirmed({ env });

    assert.equal(result.code, 0, `codex-groom's known writes do not fail a run whose tests passed:\n${everything(result)}`);
    assertNamed(result, key, 'a codex-groom projects key');
    assertNamed(result, hooksFile, 'a codex-groom hooks.state key');
    assert.match(unwrapped(afterTheRun(result)), /#238/, `it should say these are that test's known writes (#238), got:\n${afterTheRun(result)}`);
    assertNoSecrets(result);
  });

  test('a Codex key under an obk-system-temp-of-temp folder made mid-run is that test\'s known write (#464): named, removed, and the exit code stays the tests\'', async (t) => {
    // temp-of-temp's Codex session is started with its folder trusted at launch
    // and its hooks review left to its maker, a temporary Claude session, which
    // answers it with Trust all and continue: Codex writes the hooks' trust for
    // its folder (#464).
    let hooksFile;
    let key;
    const built = await withConfigs(t, ({ dir }) => {
      const mine = `${dir}/obk-system-temp-of-temp-Tt64`;
      hooksFile = `${mine}/bots/bots/nest-bot/.codex/hooks.json`;
      key = `${hooksFile}:session_start:0:0`;
      return {
        before: { codex: codexConfig({}) },
        during: { makes: [mine], codex: codexConfig({ hooks: [key] }) },
      };
    });

    const result = await built.fixture.confirmed({ env: built.env });

    assert.equal(result.code, 0, `temp-of-temp's known write does not fail a run whose tests passed:\n${everything(result)}`);
    assertNamed(result, hooksFile, 'a temp-of-temp hooks.state key');
    assert.match(unwrapped(afterTheRun(result)), /#464/, `it should say this is that test's known write (#464), got:\n${afterTheRun(result)}`);
    assert.equal(await readFile(built.files.codex, 'utf8'), codexConfig({}), 'and the key is removed again');
    assertRemovedIn(result, built.files.codex, [key]);
    assertNoSecrets(result);
  });

  test('a Codex key under an obk-system-session-first-run folder made mid-run is that test\'s known write (#506): named with its writer, removed, and the exit code stays the tests\'', async (t) => {
    // session-first-run answers its long-lived Codex session's hooks review on
    // purpose, with `obk session trust-hooks`: Codex writes the hooks' trust for
    // its bot's folder (#506). Its bots folder is the throwaway folder itself.
    let hooksFile;
    let key;
    const built = await withConfigs(t, ({ dir }) => {
      const mine = `${dir}/obk-system-session-first-run-Sf06`;
      hooksFile = `${mine}/bots/first-codex/.codex/hooks.json`;
      key = `${hooksFile}:session_start:0:0`;
      return {
        before: { codex: codexConfig({}) },
        during: { makes: [mine], codex: codexConfig({ hooks: [key] }) },
      };
    });

    const result = await built.fixture.confirmed({ env: built.env });

    assert.equal(result.code, 0, `session-first-run's known write does not fail a run whose tests passed:\n${everything(result)}`);
    assertNamed(result, hooksFile, 'a session-first-run hooks.state key');
    const report = unwrapped(afterTheRun(result));
    // Its folder's name holds the words too; the test's own name is the one
    // that is not part of an obk-system-* folder.
    assert.match(report, /(?<!obk-system-)session-first-run/, `it should name the test that wrote it (session-first-run), not only its folder, got:\n${afterTheRun(result)}`);
    assert.match(report, /#506/, `it should say this is that test's known write (#506), got:\n${afterTheRun(result)}`);
    assert.equal(await readFile(built.files.codex, 'utf8'), codexConfig({}), 'and the key is removed again');
    assertRemovedIn(result, built.files.codex, [key]);
    assertNoSecrets(result);
  });

  test('a codex-groom key under a folder that was there before the run is not named as the run\'s known writes', async (t) => {
    let key;
    const { fixture, env } = await withConfigs(t, ({ dir }) => {
      const theirs = `${dir}/obk-system-codex-groom-Other8`;
      key = `${theirs}/bots/bots/bot-father`;
      return { before: { makes: [theirs] }, during: { codex: codexConfig({ projects: [key] }) } };
    });

    const result = await fixture.confirmed({ env });

    assert.equal(result.code, 0, everything(result));
    assertNotNamed(result, key, 'another session\'s codex-groom key');
  });

  test('a Codex key under another codex test\'s folder made mid-run still fails the run: only codex-screens, codex-groom and temp-of-temp are known writers', async (t) => {
    // codex-sleep's Codex is given its trust at launch, so a key of its is a
    // write no test is allowed.
    let key;
    const { fixture, env } = await withConfigs(t, ({ dir }) => {
      const mine = `${dir}/obk-system-codex-sleep-Mn34`;
      key = `${mine}/bots`;
      return { during: { makes: [mine], codex: codexConfig({ projects: [key] }) } };
    });

    const result = await fixture.confirmed({ env });

    assert.equal(result.code, 1, `the run should fail on it though its tests passed:\n${everything(result)}`);
    assertNamed(result, key, 'a codex-sleep projects key');
  });

  test('a folder the run makes mid-run is the run\'s, and a Codex key under it still fails the run', async (t) => {
    let key;
    const { fixture, env } = await withConfigs(t, ({ dir }) => {
      const mine = `${dir}/obk-system-alpha-Made1`;
      key = `${mine}/bots`;
      return { during: { makes: [mine], codex: codexConfig({ projects: [key] }) } };
    });

    const result = await fixture.confirmed({ env });

    assert.equal(result.code, 1, `the run's own folder, made mid-run, fails it:\n${everything(result)}`);
    assertNamed(result, key, 'a key under a folder made mid-run');
  });

  test('keys under a folder that was there before and under a new one: only the new one is named, and it fails the run', async (t) => {
    let theirsKey;
    let mineKey;
    const { fixture, env } = await withConfigs(t, ({ dir, other }) => {
      // Both folders made where the temp folder is. The key under the one that
      // was there before is written in the temp folder's other spelling where
      // it has one naming the same folder (macOS: made as /private/var…, named
      // as /var…), so the runner has to know the folder by either; where it has
      // none (Linux), in the one spelling there is.
      const theirs = `${dir}/obk-system-other-session-789`;
      theirsKey = `${other ?? dir}/obk-system-other-session-789/bots`;
      mineKey = `${dir}/obk-system-alpha-New2/bots`;
      return {
        before: { makes: [theirs] },
        during: { makes: [`${dir}/obk-system-alpha-New2`], codex: codexConfig({ projects: [theirsKey, mineKey] }) },
      };
    });

    const result = await fixture.confirmed({ env });

    assert.equal(result.code, 1, `the new folder's key fails the run:\n${everything(result)}`);
    assertNamed(result, mineKey, 'the new folder\'s key');
    assertNotNamed(result, theirsKey, 'the key under the folder that was there before, in its other spelling where it has one');
  });

  // The review of PR #433, its P3: a config that could not be read was not
  // compared, so the run cannot say the configs gained nothing.
  /** A line that says what the run left came to nothing: a claim about both configs unless it names Claude's record alone. */
  const claimsBothClean = (report) => report.split('\n').filter((line) => /\b(?:gained|added|left)\b[^.]*\b(?:no|none|nothing)\b|\b(?:no|none|nothing)\b[^.]*\b(?:gained|added|left)\b/i.test(line)
    && !/\bclaude\b/i.test(line));

  /** The run's report said config.toml could not be read, and did not say the configs gained no keys. */
  function assertNoCleanClaim(result) {
    const report = afterTheRun(result);
    assert.ok(
      report.split('\n').some((line) => line.includes('config.toml') && /could ?n[o']t|cannot|can't|unable|unreadable|not (?:be )?read/i.test(line)),
      `a line should say config.toml could not be read, got:\n${report}`,
    );
    assert.doesNotMatch(report, /gained no keys/i, `with config.toml not compared, the run must not say the configs gained no keys, got:\n${report}`);
    assert.deepEqual(claimsBothClean(report), [], `no line may claim both configs came clean, got:\n${report}`);
  }

  test('a Codex config that cannot be read before and after, nothing added to Claude\'s: no claim that the configs gained no keys', async (t) => {
    const { fixture, env, files } = await withConfigs(t);
    // A folder where the file should be: there, and not readable as a file.
    await mkdir(files.codex, { recursive: true });

    const result = await fixture.confirmed({ env });

    assert.equal(result.code, 0, everything(result));
    assertNoCleanClaim(result);
  });

  test('a Codex config that becomes unreadable during the run, nothing added to Claude\'s: no claim that the configs gained no keys', async (t) => {
    const { fixture, env } = await withConfigs(t, () => ({
      before: { codex: codexConfig({}) },
      during: { removes: ['codex'], makes: ['codex'] },
    }));

    const result = await fixture.confirmed({ env });

    assert.equal(result.code, 0, everything(result));
    assertNoCleanClaim(result);
  });

  test('both configs readable, and nothing of the run\'s added: the line that the configs gained no keys', async (t) => {
    const { fixture, env } = await withConfigs(t, () => ({
      before: { codex: codexConfig({ projects: ['/Users/owner/work/app'] }), claude: claudeConfig(['/Users/owner/work/app']) },
      during: { codex: codexConfig({ projects: ['/Users/owner/work/app', '/Users/owner/work/new'] }) },
    }));

    const result = await fixture.confirmed({ env });

    assert.equal(result.code, 0, everything(result));
    const lines = afterTheRun(result).split('\n').filter((line) => /harness|config/i.test(line) && /\b(?:no|none|nothing)\b/i.test(line));
    assert.ok(lines.length > 0, `one line should say the harness configs gained no keys under the run's folders, got:\n${afterTheRun(result)}`);
  });
});

// ---------------------------------------------------------------------------
// The run takes back exactly what it added (#240, the owner's choice (b))
// ---------------------------------------------------------------------------
//
// The owner chose (b) on 2026-09-29: each system-test run cleans up after
// itself. After the tests, the runner removes from both harness configs exactly
// the keys that were not there before the run and that name a path under one of
// the run's own new folders (the keys the block above names), the known
// writers' included, and leaves everything else as it was:
//
//   config.toml    every other table, key, value, comment and blank line, byte
//                  for byte. A removed table runs from its header to just
//                  before the next table header, except that a comment directly
//                  above that header is the next table's and stays; at the end
//                  of the file it runs to the end, and takes the blank lines
//                  directly above its header with it, the file keeping one
//                  final newline: Codex appends a table as a blank line, the
//                  header and its key (seen live, #240's first cleaning run).
//   .claude.json   every other key and value, in their order, written back in
//                  the file's own layout: its indentation as found, and a final
//                  newline only if it had one.
//
// Each file is read, changed and written straight away, through a temp file in
// its own folder and a rename, keeping its mode. The runner says what it
// removed, per file, by key. A key added during the run outside the run's
// folders, and one under a folder that was there before the run, stay. A file
// that cannot be read or parsed is not written, and the report says so. Not
// ruled, the lead's reading: a Codex key from a test that is not a known writer
// is removed and still fails the run.
//
// Expected files are written out here in full, by hand, never computed from
// what the runner wrote.

/** The report says it removed `keys` from `file`: the file named, each key whole, and a word for removing. */
function assertRemovedIn(result, file, keys) {
  const report = afterTheRun(result);
  assert.ok(report.includes(file), `the report names ${file}, got:\n${report}`);
  for (const key of keys) assert.ok(report.includes(key), `and the key it removed, ${key}, whole, got:\n${report}`);
  assert.match(unwrapped(report), /\bremov/i, `and says it removed them, got:\n${report}`);
}

describe('test-system: a run removes exactly the config keys it added (#240, the owner\'s (b))', { concurrency: true }, () => {
  test('config.toml: the run\'s new tables go, whole, and every other byte stays, comments, blank lines and a table at the end included', async (t) => {
    const owner = '/Users/owner/work/app';
    const added = '/Users/owner/work/added-while-it-ran';
    let files;
    let during;
    let expected;
    let runKeys;
    let old;
    const built = await withConfigs(t, ({ dir }) => {
      const mine = `${dir}/obk-system-codex-screens-Rm01`;
      const theirs = `${dir}/obk-system-old-Aa11`;
      old = `${theirs}/bots`;
      const hooks = `${mine}/bots/bots/screens-codex/.codex/hooks.json:session_start:0:0`;
      const last = `${mine}/bots/bots/other/.codex/hooks.json:session_start:0:0`;
      runKeys = [`${mine}/bots`, hooks, last];
      const before = [
        '# the owner\'s own settings',
        'model = "gpt-6-luna"',
        `api_key = "${SECRET}"`,
        '',
        `[projects.${JSON.stringify(owner)}]`,
        'trust_level = "trusted"',
        '',
        `[projects.${JSON.stringify(old)}]`,
        'trust_level = "trusted"',
        '',
        '# my notes on the tui',
        '[tui]',
        'show_tooltips = false',
        '',
      ].join('\n');
      during = [
        '# the owner\'s own settings',
        'model = "gpt-6-luna"',
        `api_key = "${SECRET}"`,
        '',
        `[projects.${JSON.stringify(owner)}]`,
        'trust_level = "trusted"',
        '',
        `[projects.${JSON.stringify(`${mine}/bots`)}]`,
        'trust_level = "trusted"',
        '',
        `[projects.${JSON.stringify(old)}]`,
        'trust_level = "trusted"',
        '',
        '# my notes on the tui',
        '[tui]',
        'show_tooltips = false',
        '',
        `[hooks.state.${JSON.stringify(hooks)}]`,
        `trusted_hash = "sha256:${SECRET}"`,
        '',
        '  # a note of the owner\'s, directly above the next table',
        `[projects.${JSON.stringify(added)}]`,
        'trust_level = "trusted"',
        '',
        `[hooks.state.${JSON.stringify(last)}]`,
        `trusted_hash = "sha256:${SECRET}"`,
        '',
      ].join('\n');
      expected = [
        '# the owner\'s own settings',
        'model = "gpt-6-luna"',
        `api_key = "${SECRET}"`,
        '',
        `[projects.${JSON.stringify(owner)}]`,
        'trust_level = "trusted"',
        '',
        `[projects.${JSON.stringify(old)}]`,
        'trust_level = "trusted"',
        '',
        '# my notes on the tui',
        '[tui]',
        'show_tooltips = false',
        '',
        '  # a note of the owner\'s, directly above the next table',
        `[projects.${JSON.stringify(added)}]`,
        'trust_level = "trusted"',
        '',
      ].join('\n');
      return { before: { codex: before, makes: [theirs] }, during: { makes: [mine], codex: during } };
    });
    ({ files } = built);
    await chmod(files.codex, 0o600);

    const result = await built.fixture.confirmed({ env: built.env });

    assert.equal(result.code, 0, `codex-screens is a known writer, so its keys do not fail the run:\n${everything(result)}`);
    assert.equal(await readFile(files.codex, 'utf8'), expected, 'exactly the run\'s three tables are gone, and every other byte is as it was');
    assert.equal((await stat(files.codex)).mode & 0o777, 0o600, 'and the file keeps its mode');
    assert.deepEqual((await readdir(path.dirname(files.codex))).sort(), ['config.toml'], 'with nothing left beside it');
    assertRemovedIn(result, files.codex, runKeys.map((key) => key.replace(/:session_start:.*$/, '')));
    assertNoSecrets(result, [owner, added, old]);
    assert.ok(during.includes(runKeys[0]), 'the premise: the run wrote its keys');
  });

  // Seen live on #240's first cleaning run: Codex appends a new trust table
  // at the end of config.toml as a blank line, the header and its key, so a
  // cut from the header to the end left one blank line more than the file had.
  // What the run appended has to go whole: the file ends as it did before.
  for (const [label, appended] of [
    ['one projects table', (mine) => [`[projects.${JSON.stringify(`${mine}/bots`)}]`, 'trust_level = "trusted"']],
    ['two projects tables, one after the other', (mine) => [
      `[projects.${JSON.stringify(`${mine}/bots`)}]`, 'trust_level = "trusted"', '',
      `[projects.${JSON.stringify(`${mine}/bots/bots/bot-father`)}]`, 'trust_level = "trusted"',
    ]],
    ['a projects table and then a hooks.state table, as a Codex run whose trust and hooks review were answered writes them', (mine) => [
      `[projects.${JSON.stringify(`${mine}/bots`)}]`, 'trust_level = "trusted"', '',
      `[hooks.state.${JSON.stringify(`${mine}/bots/bots/bot-father/.codex/hooks.json:session_start:0:0`)}]`, `trusted_hash = "sha256:${SECRET}"`,
    ]],
  ]) {
    test(`config.toml: ${label} appended at the end the way Codex does is taken back to the byte, the file ending as it did`, async (t) => {
      const before = [
        'model = "gpt-6-luna"',
        '',
        '[projects."/Users/owner/work/app"]',
        'trust_level = "trusted"',
        '',
      ].join('\n');
      const built = await withConfigs(t, ({ dir }) => {
        const mine = `${dir}/obk-system-codex-screens-Ap01`;
        return { before: { codex: before }, during: { makes: [mine], codex: `${before}\n${[...appended(mine), ''].join('\n')}` } };
      });

      const result = await built.fixture.confirmed({ env: built.env });

      assert.equal(result.code, 0, everything(result));
      assert.equal(await readFile(built.files.codex, 'utf8'), before, 'byte for byte what it was before the run: no blank line left at the end');
    });
  }

  test('config.toml whose owner ended it with a blank line of their own keeps that blank line when a run\'s table appended after it goes', async (t) => {
    // Not in the lead's rule as stated: "the blank lines directly above its
    // header go too" would take the owner's own last blank line as well. What
    // the run appended was one blank line and the table; the file ends as it did.
    const before = [
      'model = "gpt-6-luna"',
      '',
      '[projects."/Users/owner/work/app"]',
      'trust_level = "trusted"',
      '',
      '',
    ].join('\n');
    const built = await withConfigs(t, ({ dir }) => {
      const mine = `${dir}/obk-system-codex-screens-Ap02`;
      return { before: { codex: before }, during: { makes: [mine], codex: `${before}\n[projects.${JSON.stringify(`${mine}/bots`)}]\ntrust_level = "trusted"\n` } };
    });

    const result = await built.fixture.confirmed({ env: built.env });

    assert.equal(result.code, 0, everything(result));
    assert.equal(await readFile(built.files.codex, 'utf8'), before, 'byte for byte what it was, the owner\'s own blank line at the end included');
  });

  test('.claude.json in 2-space JSON: the run\'s new projects go, and the file is byte for byte the same otherwise, key order kept', async (t) => {
    const owner = '/Users/owner/work/one';
    const other = '/Users/owner/work/two';
    const added = '/Users/owner/work/added-while-it-ran';
    const record = (projects) => ({
      numStartups: 12,
      projects: Object.fromEntries(projects.map((key) => [key, { allowedTools: [SECRET], hasTrustDialogAccepted: true }])),
      oauthAccount: { accessToken: SECRET },
      tipsHistory: { 'a-tip': 3 },
    });
    let runKey;
    const built = await withConfigs(t, ({ dir }) => {
      const mine = `${dir}/obk-system-alpha-Cl01`;
      runKey = `${mine}/bots/bots/bot-father`;
      return {
        before: { claude: `${JSON.stringify(record([owner, other]), null, 2)}\n` },
        during: { makes: [mine], claude: `${JSON.stringify(record([owner, runKey, other, added]), null, 2)}\n` },
      };
    });
    await chmod(built.files.claude, 0o600);

    const result = await built.fixture.confirmed({ env: built.env });

    assert.equal(result.code, 0, `a Claude key never fails the run:\n${everything(result)}`);
    assert.equal(
      await readFile(built.files.claude, 'utf8'),
      `${JSON.stringify(record([owner, other, added]), null, 2)}\n`,
      'the run\'s project is gone; the rest, the one added while it ran included, as it was',
    );
    assert.equal((await stat(built.files.claude)).mode & 0o777, 0o600, 'and the file keeps its mode');
    const beside = (await readdir(path.dirname(built.files.claude))).filter((name) => name.startsWith('.claude.json') && name !== '.claude.json');
    assert.deepEqual(beside, [], 'with nothing left beside it');
    assertRemovedIn(result, built.files.claude, [runKey]);
    assertNoSecrets(result, [owner, other, added]);
  });

  test('.claude.json in 4-space JSON with no final newline is written back the same way', async (t) => {
    const owner = '/Users/owner/work/one';
    const record = (projects) => ({ projects: Object.fromEntries(projects.map((key) => [key, { hasTrustDialogAccepted: true }])), numStartups: 3 });
    let runKey;
    const built = await withConfigs(t, ({ dir }) => {
      const mine = `${dir}/obk-system-alpha-Cl02`;
      runKey = `${mine}/bots/bots/bot-father`;
      return {
        before: { claude: JSON.stringify(record([owner]), null, 4) },
        during: { makes: [mine], claude: JSON.stringify(record([runKey, owner]), null, 4) },
      };
    });

    const result = await built.fixture.confirmed({ env: built.env });

    assert.equal(result.code, 0, everything(result));
    assert.equal(await readFile(built.files.claude, 'utf8'), JSON.stringify(record([owner]), null, 4), '4 spaces, and no final newline, as it was');
  });

  test('a run key under a folder that was there before the run stays, in both files, and so does a key the owner added while it ran', async (t) => {
    const added = '/Users/owner/work/added-while-it-ran';
    let codex;
    let claude;
    const built = await withConfigs(t, ({ dir }) => {
      const theirs = `${dir}/obk-system-codex-groom-Old9`;
      codex = codexConfig({ projects: [`${theirs}/bots`, added] });
      claude = `${JSON.stringify({ projects: { [`${theirs}/bots/bots/bot-father`]: {}, [added]: {} } }, null, 2)}\n`;
      return { before: { makes: [theirs] }, during: { codex, claude } };
    });

    const result = await built.fixture.confirmed({ env: built.env });

    assert.equal(result.code, 0, everything(result));
    assert.equal(await readFile(built.files.codex, 'utf8'), codex, 'config.toml is not touched: nothing in it is the run\'s');
    assert.equal(await readFile(built.files.claude, 'utf8'), claude, 'nor is .claude.json');
  });

  test('a Codex key from a test that is not a known writer is removed, and the run still fails (the lead\'s reading, not ruled)', async (t) => {
    let key;
    const built = await withConfigs(t, ({ dir }) => {
      const mine = `${dir}/obk-system-alpha-Nk01`;
      key = `${mine}/bots`;
      return { before: { codex: codexConfig({}) }, during: { makes: [mine], codex: codexConfig({ projects: [key] }) } };
    });

    const result = await built.fixture.confirmed({ env: built.env });

    assert.equal(result.code, 1, `a test that is not a known writer wrote a Codex key: a failure, cleaned or not:\n${everything(result)}`);
    assert.equal(await readFile(built.files.codex, 'utf8'), codexConfig({}), 'and the key is gone all the same');
    assertRemovedIn(result, built.files.codex, [key]);
  });

  test('a .claude.json that is not JSON after the run is not written, and the report says it could not be read', async (t) => {
    let broken;
    const built = await withConfigs(t, ({ dir }) => {
      const mine = `${dir}/obk-system-alpha-Bj01`;
      broken = `{ "projects": { "${mine}/bots/bots/bot-father": { "hasTrustDialogAccepted": tr`;
      return { before: { claude: `${JSON.stringify({ projects: {} }, null, 2)}\n` }, during: { makes: [mine], claude: broken } };
    });

    const result = await built.fixture.confirmed({ env: built.env });

    assert.equal(await readFile(built.files.claude, 'utf8'), broken, 'a file that cannot be parsed is left exactly as it is');
    const lines = afterTheRun(result).split('\n').filter((line) => line.includes('.claude.json'));
    assert.ok(
      lines.some((line) => /could ?n[o']t|cannot|can't|unable|unreadable|not (?:be )?read|not JSON/i.test(line)),
      `a line says .claude.json could not be read, got:\n${afterTheRun(result)}`,
    );
  });

  // The review of PR #453 (review-240), and the architect's ruling on #240:
  // config.toml is parsed, not only read as lines. A line inside a multi-line
  // string that looks exactly like a run table's header is text, not a table,
  // and stays; a real run table elsewhere still goes. A config.toml that is not
  // valid TOML is left as it is, said, and fails the run, since a run key may
  // be left in it.
  for (const [label, open] of [['a multi-line basic string', '"""'], ['a multi-line literal string', "'''"]]) {
    test(`config.toml: a line in ${label} (${open}) shaped like a run table's header stays, and a real run table elsewhere goes`, async (t) => {
      let expected;
      const built = await withConfigs(t, ({ dir }) => {
        const mine = `${dir}/obk-system-codex-screens-Ts${open === '"""' ? '01' : '02'}`;
        const header = `[projects.${JSON.stringify(`${mine}/bots`)}]`;
        const head = [
          'model = "gpt-6-luna"',
          `developer_instructions = ${open}`,
          'Keep this example literally:',
          header,
          'trust_level = "trusted"',
          open,
          '',
          '[projects."/Users/owner/work/app"]',
          'trust_level = "trusted"',
          '',
        ];
        expected = head.join('\n');
        const during = [...head, header, 'trust_level = "trusted"', ''].join('\n');
        return { before: { codex: 'model = "gpt-6-luna"\n' }, during: { makes: [mine], codex: during } };
      });

      const result = await built.fixture.confirmed({ env: built.env });

      assert.equal(result.code, 0, `codex-screens is a known writer:\n${everything(result)}`);
      assert.equal(
        await readFile(built.files.codex, 'utf8'),
        expected,
        'the string is byte for byte as it was, and only the real run table, with the blank line above it, is gone',
      );
    });
  }

  test('config.toml that is not valid TOML after the run is left byte for byte, said, and the run fails', async (t) => {
    let during;
    const built = await withConfigs(t, ({ dir }) => {
      const mine = `${dir}/obk-system-codex-screens-Iv01`;
      during = [
        'model = "gpt-6-luna"',
        'developer_instructions = """',
        'never closed',
        '',
        `[projects.${JSON.stringify(`${mine}/bots`)}]`,
        'trust_level = "trusted"',
        '',
      ].join('\n');
      return { before: { codex: 'model = "gpt-6-luna"\n' }, during: { makes: [mine], codex: during } };
    });

    const result = await built.fixture.confirmed({ env: built.env });

    assert.equal(await readFile(built.files.codex, 'utf8'), during, 'a file that does not parse is not written');
    const lines = afterTheRun(result).split('\n').filter((line) => line.includes('config.toml'));
    assert.ok(
      lines.some((line) => /could ?n[o']t|cannot|can't|unable|unreadable|not (?:be )?(?:read|parsed)|not (?:valid )?TOML|parse/i.test(line)),
      `a line says config.toml could not be read or parsed, got:\n${afterTheRun(result)}`,
    );
    assert.equal(result.code, 1, `a run key may be left in it, so the run fails:\n${everything(result)}`);
  });

  // The review of PR #453: a key is the run's only when its path, normalised,
  // lies under one of the run's new folders. `..` can lead out of the folder a
  // key's first segment names.
  test('a key that names the run\'s folder and then leaves it with .. is not the run\'s, and stays in both files', async (t) => {
    let codex;
    let claude;
    let key;
    const built = await withConfigs(t, ({ dir }) => {
      const mine = `${dir}/obk-system-codex-screens-Op01`;
      key = `${mine}/../owner-project`;
      codex = `model = "gpt-6-luna"\n\n[projects.${JSON.stringify(key)}]\ntrust_level = "trusted"\n`;
      claude = `${JSON.stringify({ projects: { [key]: { hasTrustDialogAccepted: true } } }, null, 2)}\n`;
      return { before: { codex: 'model = "gpt-6-luna"\n', claude: '{\n  "projects": {}\n}\n' }, during: { makes: [mine], codex, claude } };
    });

    const result = await built.fixture.confirmed({ env: built.env });

    assert.equal(result.code, 0, `nothing of the run's is left, and nothing that is not the run's is taken:\n${everything(result)}`);
    assert.equal(await readFile(built.files.codex, 'utf8'), codex, `${key} lies outside the run's folder: config.toml keeps it`);
    assert.equal(await readFile(built.files.claude, 'utf8'), claude, 'and so does .claude.json');
  });

  test('keys spelled with ./ or // that, normalised, lie under the run\'s folder are the run\'s, and go', async (t) => {
    // The other side of the same rule: a spelling does not hide a run key.
    const before = 'model = "gpt-6-luna"\n';
    const built = await withConfigs(t, ({ dir }) => {
      const mine = `${dir}/obk-system-codex-screens-Op02`;
      return {
        before: { codex: before },
        during: {
          makes: [mine],
          codex: [
            'model = "gpt-6-luna"',
            '',
            `[projects.${JSON.stringify(`${dir}/./obk-system-codex-screens-Op02/bots`)}]`,
            'trust_level = "trusted"',
            '',
            `[projects.${JSON.stringify(`${dir}//obk-system-codex-screens-Op02/bots/bots/bot-father`)}]`,
            'trust_level = "trusted"',
            '',
          ].join('\n'),
        },
      };
    });

    const result = await built.fixture.confirmed({ env: built.env });

    assert.equal(result.code, 0, everything(result));
    assert.equal(await readFile(built.files.codex, 'utf8'), before, 'both are under the run\'s folder once normalised, so both go');
  });
});

// ---------------------------------------------------------------------------
// Codex's new-model notice counter, reported and left (#456)
// ---------------------------------------------------------------------------
//
// With tooltips on, Codex 0.160.0 counts each showing of its new-model notice
// in config.toml, `[tui.model_availability_nux]`, a model name and a count, at
// most 4 showings a model (read in its source). Every system test's Codex is
// launched with tooltips off but one: codex-groom-run's run is made inside the
// grooming job. So a run that changed that table is told so, by the table and
// each key added or changed, as a known write of the harness's; the run does
// not fail for it, and nothing is taken out of it (the architect's ruling (b)
// on #456). No change, nothing said. The counts are printed nowhere: only the
// key names.

/** A config.toml with only Codex's notice counter in it, besides a model line, its keys and counts as given. */
const nuxConfig = (counts) => [
  'model = "gpt-6-luna"',
  '',
  ...(counts === null ? [] : ['[tui.model_availability_nux]', ...Object.entries(counts).map(([model, count]) => `${JSON.stringify(model)} = ${count}`), '']),
].join('\n');

/** The lines of the report after the run that name the notice counter's table. */
const nuxLines = (result) => afterTheRun(result).split('\n').filter((line) => line.includes('model_availability_nux'));

describe('test-system: Codex\'s new-model notice counter is reported, not failed and not removed (#456)', { concurrency: true }, () => {
  for (const [label, before, during, keys] of [
    ['gains a key', { 'gpt-6-luna': 3 }, { 'gpt-6-luna': 3, 'gpt-6.1-sol': 1 }, ['gpt-6.1-sol']],
    ['has a key\'s count go up', { 'gpt-6-luna': 2 }, { 'gpt-6-luna': 3 }, ['gpt-6-luna']],
    ['is not there before and is after', null, { 'gpt-6.1-sol': 1 }, ['gpt-6.1-sol']],
  ]) {
    test(`a run during which the notice counter ${label} is told so by the table and the key, does not fail for it, and leaves it`, async (t) => {
      const after = nuxConfig(during);
      const built = await withConfigs(t, () => ({ before: { codex: nuxConfig(before) }, during: { codex: after } }));

      const result = await built.fixture.confirmed({ env: built.env });

      assert.equal(result.code, 0, `a change to the notice counter does not fail a run whose tests passed:\n${everything(result)}`);
      const lines = nuxLines(result);
      assert.ok(lines.length > 0, `the report names the table [tui.model_availability_nux], got:\n${afterTheRun(result)}`);
      const said = unwrapped(afterTheRun(result));
      for (const key of keys) assert.ok(said.includes(key), `and the key added or changed, ${key}, got:\n${afterTheRun(result)}`);
      assert.match(said, /notice|harness/i, `and says it is Codex's notice counter, a write of the harness's, got:\n${afterTheRun(result)}`);
      for (const [model, count] of Object.entries(during)) {
        assert.ok(!said.includes(`${model}" = ${count}`) && !said.includes(`${model} = ${count}`), `only the key names, not the counts, got:\n${afterTheRun(result)}`);
      }
      assert.equal(await readFile(built.files.codex, 'utf8'), after, 'and the counter is left as Codex wrote it');
    });
  }

  test('a run that leaves the notice counter as it was says nothing about it, though other keys came and went', async (t) => {
    let after;
    const built = await withConfigs(t, ({ dir }) => {
      const mine = `${dir}/obk-system-codex-screens-Nx01`;
      after = `${nuxConfig({ 'gpt-6-luna': 3 })}\n[projects.${JSON.stringify(`${mine}/bots`)}]\ntrust_level = "trusted"\n`;
      return { before: { codex: nuxConfig({ 'gpt-6-luna': 3 }) }, during: { makes: [mine], codex: after } };
    });

    const result = await built.fixture.confirmed({ env: built.env });

    assert.equal(result.code, 0, everything(result));
    assert.deepEqual(nuxLines(result), [], `no word of the notice counter, which did not change, got:\n${afterTheRun(result)}`);
    assert.equal(await readFile(built.files.codex, 'utf8'), nuxConfig({ 'gpt-6-luna': 3 }), 'the run\'s own table taken out as before, the counter as it was');
  });

  // The review of PR #460: a config.toml that is not there before the run is a
  // known empty start, not one that could not be read, so a counter Codex
  // creates with the file is named like any other.
  test('a config.toml that is not there before the run and is made during it with a notice counter: the table and its key are named, and the file is left', async (t) => {
    const after = '[tui.model_availability_nux]\n"gpt-6.1-sol" = 1\n';
    const built = await withConfigs(t, () => ({ during: { codex: after } }));

    const result = await built.fixture.confirmed({ env: built.env });

    assert.equal(result.code, 0, `a new notice counter does not fail a run whose tests passed:\n${everything(result)}`);
    assert.ok(nuxLines(result).length > 0, `the report names the table [tui.model_availability_nux], got:\n${afterTheRun(result)}`);
    const said = unwrapped(afterTheRun(result));
    assert.ok(said.includes('gpt-6.1-sol'), `and its key, got:\n${afterTheRun(result)}`);
    assert.match(said, /notice|harness/i, `and says it is Codex's notice counter, got:\n${afterTheRun(result)}`);
    assert.equal(await readFile(built.files.codex, 'utf8'), after, 'the file is left as the run made it');
  });

  test('a config.toml that cannot be read before the run, and holds a notice counter after: no claim about the counter, and no crash', async (t) => {
    // A folder where the file should be: there, and not readable as a file.
    // Nothing is known of the counter before, so no change can be told.
    const after = '[tui.model_availability_nux]\n"gpt-6.1-sol" = 1\n';
    const built = await withConfigs(t, () => ({ during: { removes: ['codex'], codex: after } }));
    await mkdir(built.files.codex, { recursive: true });

    const result = await built.fixture.confirmed({ env: built.env });

    assert.equal(result.code, 0, `nothing here fails the run:\n${everything(result)}`);
    assert.ok(!/^\s+at /m.test(everything(result)), `a report, not a crash:\n${everything(result)}`);
    assert.deepEqual(nuxLines(result), [], `no claim about a counter whose start could not be read, got:\n${afterTheRun(result)}`);
    assert.equal(await readFile(built.files.codex, 'utf8'), after, 'and the file is left as the run made it');
  });
});

// #536: the Orca projects a run leaves behind. A system test removes its own
// throwaway projects in its teardown; one it could not remove stays in the
// owner's Orca. So after the tests the runner lists Orca's projects, and names
// each one whose path is in an obk-system-* folder under the temp folder that
// appeared while the run went on (the rule the trust keys use, #240): by its
// path and its setup id, on one line. A left project fails the run, as a left
// Codex trust key does; the runner deletes nothing. A project anywhere else, or
// in an obk-system-* folder that was there before the run, is not the run's,
// and is never named. When Orca cannot list its projects, the runner says so,
// does not say that nothing was left, and the exit code stays the tests' own.

/** A setup as `orca project setups --json` lists it, in the shape read live on Orca 1.4.223 (#536). */
const setupNamed = (id, home) => ({
  id,
  projectId: `repo:${id}`,
  hostId: 'local',
  repoId: id,
  path: home,
  displayName: path.basename(home),
  kind: 'folder',
  setupState: 'ready',
  setupMethod: 'legacy-repo',
  createdAt: 1791579240303,
  updatedAt: 1791579240303,
});

/** A setup id in Orca's shape, told apart by `n`. */
const setupIdOf = (n) => `8c1e0f52-c397-425c-bcfb-${String(n).padStart(12, '0')}`;

/**
 * A system test file that changes Orca's projects while it runs, as a system
 * test does: it makes the folders in `makes`, adds the setups in `adds` to the
 * fake Orca's world, sets the `world` keys given (a listing that breaks from
 * now on), and then removes the folders in `removes`, as its teardown removes
 * its bots folder. It prints its marker, and fails afterwards when `thenFails`
 * says so.
 */
const changesProjects = (name, { makes = [], adds = [], world = {}, removes = [], thenFails = false } = {}) => [
  "import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';",
  "import test from 'node:test';",
  '',
  `test(${JSON.stringify(name)}, () => {`,
  `  for (const folder of ${JSON.stringify(makes)}) mkdirSync(folder, { recursive: true });`,
  `  const file = process.env[${JSON.stringify(WORLD)}];`,
  "  const state = JSON.parse(readFileSync(file, 'utf8'));",
  `  state.setups.push(...${JSON.stringify(adds)});`,
  `  Object.assign(state, ${JSON.stringify(world)}, { testsRan: true });`,
  '  writeFileSync(file, JSON.stringify(state));',
  `  for (const folder of ${JSON.stringify(removes)}) rmSync(folder, { recursive: true, force: true });`,
  `  process.stdout.write(${JSON.stringify(`${name}\n`)});`,
  ...(thenFails ? [`  throw new Error(${JSON.stringify(`${name} failed`)});`] : []),
  '});',
  '',
].join('\n');

/**
 * A fixture repo whose one system test changes Orca's projects. `build` is
 * given the fixture's temp folder in both spellings (tempSpellings), and
 * answers `{ setups, makes, during, world }`: `setups` Orca has before the run,
 * `makes` folders already there when it starts, `during` what its system
 * test does (changesProjects), and `world` other keys of the fake's world
 * before the run (`setupsBefore`).
 */
async function withProjects(t, build) {
  const fixture = await createRepo(t);
  const temp = tempSpellings(fixture);
  const { setups = [], makes = [], during = {}, world: keys = {} } = build(temp);
  const world = fixture.env[WORLD];
  await writeFile(world, JSON.stringify({ ...JSON.parse(await readFile(world, 'utf8')), ...keys, setups }));
  for (const folder of makes) await mkdir(folder, { recursive: true });
  await write(fixture.repo, 'test/system/alpha.test.js', changesProjects('ALPHA', during));
  return fixture;
}

/** The setups the fake Orca has now. */
const setupsNow = async (fixture) => JSON.parse(await readFile(fixture.env[WORLD], 'utf8')).setups;

/** The sentences of the report after the run, its hard wraps undone. */
const sentencesOf = (result) => unwrapped(afterTheRun(result)).split(/(?<=[.!?])\s+/);

/** A sentence that says no project was left. */
const NO_PROJECT_LEFT = /\bno\b(?:\s+[\w'-]+){0,2}\s+projects?\b|\bprojects?\b[^.]*\b(?:none|nothing)\b/i;

/** A sentence that says the runner could not find something out. */
const COULD_NOT = /could ?n[o']t|cannot|can't|unable|did not|failed|not known|unknown/i;

/** The report names the left project by its path and its setup id, on one line. */
function assertLeftNamed(result, setup) {
  const report = afterTheRun(result);
  assert.ok(
    report.split('\n').some((line) => line.includes(setup.path) && line.includes(setup.id)),
    `the report should name the left project ${setup.path} and its setup id ${setup.id} on one line, got:\n${report}`,
  );
}

/** The project is named nowhere in what the run printed: not its path, not its id. */
function assertProjectNotNamed(result, setup, what) {
  assert.ok(!everything(result).includes(setup.path), `${what}: ${setup.path} should be named nowhere, got:\n${everything(result)}`);
  assert.ok(!everything(result).includes(setup.id), `${what}: ${setup.id} should be named nowhere, got:\n${everything(result)}`);
}

/** The runner deleted no project, and Orca still has every one it had after the run. */
async function assertDeletedNothing(fixture, setups) {
  assert.deepEqual(orcaCallsOf(await fixture.orca.calls(), 'project setup-delete'), [], 'the runner deletes no project');
  const now = (await setupsNow(fixture)).map((one) => one.id);
  for (const setup of setups) assert.ok(now.includes(setup.id), `${setup.path} should still be in Orca`);
}

/** No sentence of the report says that no project was left. */
function assertNoClaimNothingLeft(result) {
  const claims = sentencesOf(result).filter((sentence) => NO_PROJECT_LEFT.test(sentence));
  assert.deepEqual(claims, [], `the report should not say that no project was left, got:\n${afterTheRun(result)}`);
}

describe('test-system: the Orca projects a run leaves behind (#536)', { concurrency: true }, () => {
  test('a project the run left in the obk-system folder it made fails a run whose tests passed, is named by path and setup id, and is not deleted, though the teardown removed the folder', async (t) => {
    const owner = setupNamed(setupIdOf(1), '/Users/owner/work/app');
    let left;
    const fixture = await withProjects(t, ({ dir, real }) => {
      const folder = `${dir}/obk-system-alpha-Pj01`;
      left = setupNamed(setupIdOf(2), `${real}/obk-system-alpha-Pj01/bots/bots/bot-father`);
      return { setups: [owner], during: { makes: [folder], adds: [left], removes: [folder] } };
    });

    const result = await fixture.confirmed();

    assert.equal(result.code, 1, `a left project fails the run though its tests passed:\n${everything(result)}`);
    assertLeftNamed(result, left);
    assertProjectNotNamed(result, owner, 'the owner\'s project');
    assertNoClaimNothingLeft(result);
    await assertDeletedNothing(fixture, [owner, left]);
  });

  test('a project the run left in the /var spelling of the temp folder, its folder still there, is the run\'s too', async (t) => {
    let left;
    const fixture = await withProjects(t, ({ dir, bare }) => {
      left = setupNamed(setupIdOf(3), `${bare}/obk-system-alpha-Pj02/bots/bots/coder`);
      return { during: { makes: [`${dir}/obk-system-alpha-Pj02`], adds: [left] } };
    });

    const result = await fixture.confirmed();

    assert.equal(result.code, 1, `a left project fails the run:\n${everything(result)}`);
    assertLeftNamed(result, left);
    await assertDeletedNothing(fixture, [left]);
  });

  test('a run whose tests failed and that left two projects names each with its own setup id, deletes neither, and exits 1', async (t) => {
    let left;
    const fixture = await withProjects(t, ({ dir, real }) => {
      left = [
        setupNamed(setupIdOf(4), `${real}/obk-system-alpha-Pj03/bots/bots/bot-father`),
        setupNamed(setupIdOf(5), `${real}/obk-system-beta-Pj04/bots/bots/coder`),
      ];
      const folders = [`${dir}/obk-system-alpha-Pj03`, `${dir}/obk-system-beta-Pj04`];
      return { during: { makes: folders, adds: left, removes: folders, thenFails: true } };
    });

    const result = await fixture.confirmed();

    assert.equal(result.code, 1, everything(result));
    for (const setup of left) assertLeftNamed(result, setup);
    await assertDeletedNothing(fixture, left);
  });

  test('projects that are not the run\'s are never named and do not fail the run, an obk-system folder there before the run included', async (t) => {
    let quiet;
    const fixture = await withProjects(t, ({ dir, real }) => {
      const earlier = `${dir}/obk-system-alpha-Kl12`;
      const before = [
        setupNamed(setupIdOf(11), '/Users/owner/work/app'),
        setupNamed(setupIdOf(12), `${real}/obk-system-alpha-Kl12/bots/bots/bot-father`),
      ];
      const during = [
        setupNamed(setupIdOf(13), '/Users/owner/work/new-app'),
        setupNamed(setupIdOf(14), `${real}/obk-other-Mn34/bots`),
        setupNamed(setupIdOf(15), `${real}/work/obk-system-alpha-Op56/bots`),
        setupNamed(setupIdOf(16), '/Users/owner/obk-system-alpha-Qr78/bots'),
        // Another session's run, in its folder that was there before this run began.
        setupNamed(setupIdOf(17), `${real}/obk-system-alpha-Kl12/bots/bots/coder`),
      ];
      quiet = [...before, ...during];
      return {
        setups: before,
        makes: [earlier],
        during: { makes: [`${dir}/obk-other-Mn34`, `${dir}/work/obk-system-alpha-Op56`], adds: during },
      };
    });

    const result = await fixture.confirmed();

    assert.equal(result.code, 0, `nothing of the run's own was left:\n${everything(result)}`);
    for (const setup of quiet) assertProjectNotNamed(result, setup, 'not the run\'s');
    assert.ok(
      sentencesOf(result).some((sentence) => NO_PROJECT_LEFT.test(sentence)),
      `it should say the run left no project, got:\n${afterTheRun(result)}`,
    );
    await assertDeletedNothing(fixture, quiet);
  });

  for (const thenFails of [false, true]) {
    test(`a run that left no project says so in one line, and the exit code is the tests' own (${thenFails ? 'tests failed' : 'tests passed'})`, async (t) => {
      const fixture = await withProjects(t, ({ dir }) => {
        const folder = `${dir}/obk-system-alpha-Nn01`;
        return { during: { makes: [folder], removes: [folder], thenFails } };
      });

      const result = await fixture.confirmed();

      assert.equal(result.code, thenFails ? 1 : 0, everything(result));
      const said = sentencesOf(result).filter((sentence) => NO_PROJECT_LEFT.test(sentence));
      assert.equal(said.length, 1, `one sentence should say the run left no project, got:\n${afterTheRun(result)}`);
      assert.ok(orcaCallsOf(await fixture.orca.calls(), 'project setups').length > 0, 'the premise: it asked Orca for its projects');
    });
  }

  for (const [how, world] of [
    ['refuses the listing', { setupsFails: ALWAYS }],
    ['answers with text that is not JSON', { setupsGarbles: ALWAYS }],
    ['answers ok: false', { setupsEnvelope: 'notOk' }],
    ['answers ok: false with a list in it', { setupsEnvelope: 'notOkWithSetups' }],
    ['answers with no ok at all', { setupsEnvelope: 'noOk' }],
  ]) {
    test(`when Orca ${how} after the run, the runner says it could not tell which projects were left, does not say none was, and the exit code stays the tests'`, async (t) => {
      let left;
      const fixture = await withProjects(t, ({ dir, real }) => {
        const folder = `${dir}/obk-system-alpha-Cn01`;
        left = setupNamed(setupIdOf(21), `${real}/obk-system-alpha-Cn01/bots/bots/bot-father`);
        return { during: { makes: [folder], adds: [left], removes: [folder], world } };
      });

      const result = await fixture.confirmed();

      assert.equal(result.code, 0, `the listing alone does not change the exit code:\n${everything(result)}`);
      assert.equal(result.signal, null, `it should exit, not die: ${result.signal}`);
      assert.ok(!/^\s+at /m.test(everything(result)), `a report, not a crash:\n${everything(result)}`);
      assert.ok(
        sentencesOf(result).some((sentence) => /project/i.test(sentence) && COULD_NOT.test(sentence)),
        `it should say it could not tell which projects the run left, got:\n${afterTheRun(result)}`,
      );
      assertNoClaimNothingLeft(result);
      assertProjectNotNamed(result, left, 'an answer nobody vouched for');
      await assertDeletedNothing(fixture, [left]);
    });
  }

  // The review of PR #546: an earlier run's teardown could not remove its
  // project but did remove its bots folder. The next run finds no such folder
  // before it starts, so a check by folder alone takes that old project for
  // its own. A project counts as left only when Orca did not have it before the
  // run (by setup id) and it is in an obk-system folder the run made.

  test('a project an earlier run left, its obk-system folder gone before this run and after it, is not this run\'s: never named, and the run passes', async (t) => {
    let earlier;
    const fixture = await withProjects(t, ({ dir, real }) => {
      earlier = setupNamed(setupIdOf(31), `${real}/obk-system-earlier-123/bots/bot-father`);
      const folder = `${dir}/obk-system-alpha-Ea01`;
      return { setups: [earlier], during: { makes: [folder], removes: [folder] } };
    });

    const result = await fixture.confirmed();

    assert.equal(result.code, 0, `a project that was in Orca before the run does not fail it:\n${everything(result)}`);
    assertProjectNotNamed(result, earlier, 'a project from an earlier run');
    assert.ok(
      sentencesOf(result).some((sentence) => NO_PROJECT_LEFT.test(sentence)),
      `this run left nothing, and it should say so, got:\n${afterTheRun(result)}`,
    );
    await assertDeletedNothing(fixture, [earlier]);
  });

  test('beside a project an earlier run left, the one this run left is named, and only it', async (t) => {
    let earlier;
    let left;
    const fixture = await withProjects(t, ({ dir, real }) => {
      earlier = setupNamed(setupIdOf(32), `${real}/obk-system-earlier-456/bots/bot-father`);
      left = setupNamed(setupIdOf(33), `${real}/obk-system-alpha-Ea02/bots/bots/bot-father`);
      const folder = `${dir}/obk-system-alpha-Ea02`;
      return { setups: [earlier], during: { makes: [folder], adds: [left], removes: [folder] } };
    });

    const result = await fixture.confirmed();

    assert.equal(result.code, 1, `the run's own left project fails it:\n${everything(result)}`);
    assertLeftNamed(result, left);
    assertProjectNotNamed(result, earlier, 'a project from an earlier run');
    await assertDeletedNothing(fixture, [earlier, left]);
  });

  test('a project that was in Orca before the run is not named even when the run makes a folder of the same name', async (t) => {
    // Not likely with mkdtemp's random names, and the plainest case of the rule:
    // what Orca had before the run is never the run's.
    let earlier;
    const fixture = await withProjects(t, ({ dir, real }) => {
      earlier = setupNamed(setupIdOf(34), `${real}/obk-system-alpha-Same01/bots/bot-father`);
      return { setups: [earlier], during: { makes: [`${dir}/obk-system-alpha-Same01`] } };
    });

    const result = await fixture.confirmed();

    assert.equal(result.code, 0, everything(result));
    assertProjectNotNamed(result, earlier, 'a project that was there before the run');
  });

  for (const [how, setupsBefore] of [
    ['refuses the listing', 'fails'],
    ['answers with text that is not JSON', 'garbles'],
    ['answers ok: false', 'notOk'],
    ['answers ok: false with a list in it', 'notOkWithSetups'],
    ['answers with no ok at all', 'noOk'],
  ]) {
    test(`when Orca ${how} before the run, the runner cannot tell new projects from old: it says so, names none, does not say none was left, and the exit code stays the tests'`, async (t) => {
      let earlier;
      let left;
      const fixture = await withProjects(t, ({ dir, real }) => {
        earlier = setupNamed(setupIdOf(41), `${real}/obk-system-earlier-789/bots/bot-father`);
        left = setupNamed(setupIdOf(42), `${real}/obk-system-alpha-Bf01/bots/bots/bot-father`);
        const folder = `${dir}/obk-system-alpha-Bf01`;
        return { setups: [earlier], world: { setupsBefore }, during: { makes: [folder], adds: [left], removes: [folder] } };
      });

      const result = await fixture.confirmed();

      assert.equal(result.code, 0, `the listing alone does not change the exit code:\n${everything(result)}`);
      assert.equal(result.signal, null, `it should exit, not die: ${result.signal}`);
      assert.ok(!/^\s+at /m.test(everything(result)), `a report, not a crash:\n${everything(result)}`);
      assert.ok(
        sentencesOf(result).some((sentence) => /project/i.test(sentence) && COULD_NOT.test(sentence)),
        `it should say it could not tell which projects the run left, got:\n${afterTheRun(result)}`,
      );
      assertNoClaimNothingLeft(result);
      assertProjectNotNamed(result, left, 'with nothing to tell new from old');
      assertProjectNotNamed(result, earlier, 'with nothing to tell new from old');
      await assertDeletedNothing(fixture, [earlier, left]);
    });
  }
});
