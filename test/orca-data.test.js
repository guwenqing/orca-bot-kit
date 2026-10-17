// OBK_ORCA_DATA: where another build of Orca keeps its own data (#551).
//
// OBK_ORCA points the kit at another build of Orca, such as the owner's fork
// "Orca Lean" at `<Orca Lean.app>/Contents/Resources/bin/orca`. That build
// keeps its data (its Electron userData folder) in
// `~/Library/Application Support/orca-lean`, not `.../orca`. OBK_ORCA_DATA
// names that folder, and the kit then reads Orca's profiles, and so Orca's
// default launch arguments, from `<OBK_ORCA_DATA>/profiles`.
//
// What is held here, and the tests that hold each part:
//
//   1. OBK_ORCA_DATA set and not empty: `profilesDir()` is
//      `<OBK_ORCA_DATA>/profiles`, `orcaDefaultArgs()` reads both stores there
//      (`profile-state.db` and the older `orca-data.json`), and the profiles in
//      the default folder are not read.                               D1, D2
//   2. `obk health` reports on the files under OBK_ORCA_DATA: a bypass finding
//      names the file there, and a folder with no profiles gives the "could
//      not read" finding, naming that folder.                         D3, D4
//   3. OBK_ORCA_DATA unset or empty: everything is as before, the profiles
//      come from `<home>/Library/Application Support/orca/profiles`, also when
//      OBK_ORCA names another app.                                    D5, D6
//   4. `obk --help` and SETUP.md name OBK_ORCA_DATA.                  D7, D8
//
// Out of scope, and so not pinned: the wording of the findings and of the
// help text, and how the kit spells the folder beyond its path.
//
// Every run is in a sandbox (helpers/cli.js) whose HOME is its own, against the
// fake Orca. Nothing here reads the real Orca profiles on this machine.

import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { createSandbox, node, repoRoot } from './helpers/cli.js';
import { orcaDataJson, orcaProfileDb, profilesOf } from './helpers/orca-profile.js';

/** What each harness's permission bypass is spelled, as Orca would record it. */
const BYPASS = {
  claude: '--dangerously-skip-permissions',
  codex: '--dangerously-bypass-approvals-and-sandbox',
};

/** Where the fork keeps its data in a sandbox: the place the owner's Orca Lean keeps it, under the sandbox's home. */
const leanDataOf = (box) => path.join(box.home, 'Library', 'Application Support', 'orca-lean');

/** The default profiles folder in the sandbox, which the sandbox seeds with `local-default/orca-data.json`. */
const defaultProfilesOf = (box) => profilesOf(box);

const show = (value) => JSON.stringify(value, null, 2);

// ------------------------------------------------------- profilesDir(), orcaDefaultArgs()

const orcaModule = pathToFileURL(path.join(repoRoot, 'src', 'orca.js')).href;

/**
 * Call `profilesDir()` and `orcaDefaultArgs()` once, in a process of their own
 * with the sandbox's environment: they read process.env and the home folder at
 * call time, as the kit's own commands would.
 */
async function profilesIn(box) {
  const ran = await node(['--input-type=module', '-e', [
    `const { profilesDir, orcaDefaultArgs } = await import(${JSON.stringify(orcaModule)});`,
    'process.stdout.write(JSON.stringify({ dir: profilesDir(), read: orcaDefaultArgs() }));',
  ].join('\n')], { cwd: box.cwd, env: box.env });
  assert.equal(ran.code, 0, `profilesDir() and orcaDefaultArgs() should answer, got:\n${ran.stdout}${ran.stderr}`);
  return JSON.parse(ran.stdout);
}

/** A sandbox whose OBK_ORCA_DATA is unset, whatever the shell that runs the suite has. */
async function aSandbox(t) {
  const box = await createSandbox(t);
  delete box.env.OBK_ORCA_DATA;
  return box;
}

/** Default launch arguments in the default folder that no test expects from the fork's folder. */
const IN_DEFAULT = { claude: '--from-the-default-folder', codex: '' };

test('D1 with OBK_ORCA_DATA set, profilesDir() is <OBK_ORCA_DATA>/profiles', async (t) => {
  const box = await aSandbox(t);
  const data = leanDataOf(box);
  await mkdir(path.join(data, 'profiles'), { recursive: true });
  box.env.OBK_ORCA_DATA = data;

  const { dir, read } = await profilesIn(box);

  assert.equal(dir, path.join(data, 'profiles'));
  assert.equal(read.dir, path.join(data, 'profiles'), 'orcaDefaultArgs() says it looked in the same folder');
});

test('D2 with OBK_ORCA_DATA set, orcaDefaultArgs() reads both stores of the profiles there, and none in the default folder', async (t) => {
  const box = await aSandbox(t);
  await box.orca.settings.set({ agentDefaultArgs: IN_DEFAULT });
  const data = leanDataOf(box);
  const fromDb = { claude: BYPASS.claude, codex: '--search' };
  const fromJson = { claude: '--model opus', codex: BYPASS.codex };
  // One profile as Orca 1.4.223 keeps it, one as an older Orca does.
  const { file: db } = await orcaProfileDb(t, path.join(data, 'profiles', 'lean-new'), { settledSettings: fromDb });
  await orcaDataJson(path.join(data, 'profiles', 'lean-old'), fromJson);
  box.env.OBK_ORCA_DATA = data;

  const { read } = await profilesIn(box);

  assert.equal(read.dir, path.join(data, 'profiles'));
  const byFile = Object.fromEntries(read.profiles.map(({ file, args }) => [file, args]));
  assert.deepEqual(byFile, {
    [db]: fromDb,
    [path.join(data, 'profiles', 'lean-old', 'orca-data.json')]: fromJson,
  }, `the two profiles under OBK_ORCA_DATA and nothing else, got: ${show(read)}`);
  assert.deepEqual(
    read.profiles.filter(({ file }) => file.startsWith(`${defaultProfilesOf(box)}${path.sep}`)),
    [],
    'the profiles in the default folder are not read',
  );
});

// ------------------------------------------------------------------ obk health

/** A bots folder with Bot Father up in the fake Orca. */
async function seeded(box) {
  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(result.code, 0, result.stderr);
}

/** The Orca findings of `obk health --json`, held to JSON alone on stdout. */
async function orcaFindings(box) {
  const result = await box.run(['health', '--bots', 'bots', '--json']);
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout}${result.stderr} (${error.message})`);
  }
  assert.ok(Array.isArray(answer.found), `the answer should carry a list of findings, got: ${result.stdout}`);
  return answer.found.filter((one) => one.kind === 'orca');
}

/** Everything one finding puts in front of a reader. */
const wordsOf = (finding) => `${finding.where} ${finding.says}`;

test('D3 with OBK_ORCA_DATA set, obk health reports the bypass in the profile there, naming that file, and not the one in the default folder', async (t) => {
  const box = await aSandbox(t);
  await seeded(box);
  // The default folder gives codex a bypass, the fork's folder claude: only
  // claude's is the fork's.
  await box.orca.settings.set({ agentDefaultArgs: { claude: '', codex: BYPASS.codex } });
  const data = leanDataOf(box);
  const { file: db } = await orcaProfileDb(t, path.join(data, 'profiles', 'local-default'), {
    settledSettings: { claude: BYPASS.claude, codex: '' },
  });
  box.env.OBK_ORCA_DATA = data;

  const orca = await orcaFindings(box);

  assert.equal(orca.length, 1, `one finding, for claude in the fork's profile, got: ${show(orca)}`);
  assert.equal(orca[0].where, db, 'the finding names the file under OBK_ORCA_DATA');
  assert.ok(wordsOf(orca[0]).includes('claude') && wordsOf(orca[0]).includes(BYPASS.claude), `it is about claude's bypass, got: ${show(orca[0])}`);
  assert.ok(!wordsOf(orca[0]).includes(defaultProfilesOf(box)), `it says nothing of the default folder, got: ${show(orca[0])}`);
});

for (const [label, lay] of [
  ['an empty folder', (data) => mkdir(data, { recursive: true })],
  ['a folder with an empty profiles folder', (data) => mkdir(path.join(data, 'profiles'), { recursive: true })],
  ['no folder at all', async () => {}],
]) {
  test(`D4 with OBK_ORCA_DATA naming ${label}, obk health says it could not read Orca's settings there, and reads nothing in the default folder`, async (t) => {
    const box = await aSandbox(t);
    await seeded(box);
    // A bypass in the default folder, which a kit that fell back to it would report.
    await box.orca.settings.set({ agentDefaultArgs: { claude: BYPASS.claude, codex: BYPASS.codex } });
    const data = leanDataOf(box);
    await lay(data);
    box.env.OBK_ORCA_DATA = data;

    const orca = await orcaFindings(box);

    assert.equal(orca.length, 1, `one finding, about the settings it could not read, got: ${show(orca)}`);
    assert.ok(wordsOf(orca[0]).includes(data), `it names the folder under OBK_ORCA_DATA it looked in, got: ${show(orca[0])}`);
    assert.ok(!wordsOf(orca[0]).includes(defaultProfilesOf(box)), `it says nothing of the default folder, got: ${show(orca[0])}`);
    for (const flag of Object.values(BYPASS)) {
      assert.ok(!wordsOf(orca[0]).includes(flag), `nothing it could not read is reported as a bypass, got: ${show(orca[0])}`);
    }
  });
}

// --------------------------------------------------- OBK_ORCA_DATA unset or empty

/**
 * The fork's folder laid out with settings of its own, so a kit that read it
 * without being told to would show it.
 */
async function aForkFolderBeside(t, box) {
  const data = leanDataOf(box);
  await orcaProfileDb(t, path.join(data, 'profiles', 'local-default'), {
    settledSettings: { claude: BYPASS.claude, codex: BYPASS.codex },
  });
  await orcaDataJson(path.join(data, 'profiles', 'lean-old'), { claude: BYPASS.claude, codex: BYPASS.codex });
  return data;
}

/**
 * Another build of Orca, laid out as the owner's fork is installed, with
 * OBK_ORCA naming its CLI: a copy of the sandbox's fake Orca, as R2 in
 * orca-reload.test.js lays one out.
 */
async function anotherApp(box) {
  const cli = path.join(box.root, 'Other Apps', 'Orca Lean.app', 'Contents', 'Resources', 'bin', 'orca');
  await mkdir(path.dirname(cli), { recursive: true });
  await writeFile(cli, await readFile(box.orca.cli, 'utf8'));
  await chmod(cli, 0o755);
  box.env.OBK_ORCA = cli;
}

for (const [label, set] of [
  ['unset', (box) => { delete box.env.OBK_ORCA_DATA; }],
  ['empty', (box) => { box.env.OBK_ORCA_DATA = ''; }],
  ['unset, with OBK_ORCA naming another app', async (box) => { await anotherApp(box); delete box.env.OBK_ORCA_DATA; }],
]) {
  test(`D5 with OBK_ORCA_DATA ${label}, profilesDir() and orcaDefaultArgs() are the default folder under the home, as before`, async (t) => {
    const box = await aSandbox(t);
    await box.orca.settings.set({ agentDefaultArgs: IN_DEFAULT });
    await aForkFolderBeside(t, box);
    await set(box);

    const { dir, read } = await profilesIn(box);

    const defaults = path.join(box.home, 'Library', 'Application Support', 'orca', 'profiles');
    assert.equal(dir, defaults);
    assert.equal(read.dir, defaults);
    assert.deepEqual(read.profiles, [
      { file: path.join(defaults, 'local-default', 'orca-data.json'), args: IN_DEFAULT },
    ], 'the default profile alone, and nothing from the fork\'s folder');
  });

  test(`D6 with OBK_ORCA_DATA ${label}, obk health reports on the default folder, as before`, async (t) => {
    const box = await aSandbox(t);
    await seeded(box);
    await box.orca.settings.set({ agentDefaultArgs: { claude: BYPASS.claude, codex: '' } });
    await aForkFolderBeside(t, box);
    await set(box);

    const orca = await orcaFindings(box);

    const file = path.join(box.home, 'Library', 'Application Support', 'orca', 'profiles', 'local-default', 'orca-data.json');
    assert.equal(orca.length, 1, `claude's bypass in the default folder alone, got: ${show(orca)}`);
    assert.equal(orca[0].where, file);
    assert.ok(wordsOf(orca[0]).includes(BYPASS.claude), `it is claude's bypass, got: ${show(orca[0])}`);
  });
}

// ------------------------------------------------------------- --help, SETUP.md

test('D7 obk --help names OBK_ORCA_DATA and says it is the folder Orca keeps its data in', async (t) => {
  const box = await aSandbox(t);

  const result = await box.run(['--help']);

  assert.equal(result.code, 0);
  const lines = result.stdout.split('\n');
  const at = lines.findIndex((line) => line.includes('OBK_ORCA_DATA'));
  assert.ok(at >= 0, `--help should name OBK_ORCA_DATA, got:\n${result.stdout}`);
  // What it is for: the words around the name, the name itself taken out.
  const around = lines.slice(Math.max(0, at - 2), at + 4).join('\n').replaceAll('OBK_ORCA_DATA', '');
  assert.match(around, /folder|director|profile|settings|Application Support|userData/i, `--help should say what OBK_ORCA_DATA is for, got:\n${around}`);
});

test('D8 SETUP.md names OBK_ORCA_DATA', async () => {
  const page = await readFile(path.join(repoRoot, 'SETUP.md'), 'utf8');

  assert.ok(page.includes('OBK_ORCA_DATA'), 'SETUP.md should name OBK_ORCA_DATA');
});
