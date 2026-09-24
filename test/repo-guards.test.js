// Facts about the repo itself that a green test run cannot prove: that every
// test file is actually run by something, and that the workflow which runs them
// in CI is set up the way it must be.

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import { repoRoot, snapshot } from './helpers/cli.js';

/** Trees that hold copies of other people's files, or of our own. */
const IGNORED = new Set(['node_modules', '.git', '.stryker-tmp', 'reports']);

const workflowsDir = path.join(repoRoot, '.github', 'workflows');

const readPackage = async () => JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));

/** Every file under the repo, as paths relative to it. */
async function repoFiles() {
  const tree = await snapshot(repoRoot, (rel) => IGNORED.has(path.basename(rel)));
  return Object.keys(tree).filter((rel) => tree[rel].startsWith('file:'));
}

/** A shell glob as a regular expression over a path. `*` stops at a slash. */
function globToRegExp(glob) {
  const source = glob
    .split('/')
    .map((segment) => segment
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*'))
    .join('/');
  return new RegExp(`^${source}$`);
}

/** Every workflow in the repo, parsed. Empty when there are none at all. */
async function workflows() {
  let names;
  try {
    names = await readdir(workflowsDir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return Promise.all(
    names
      .filter((name) => /\.ya?ml$/.test(name))
      .map(async (name) => ({
        name,
        // The `yaml` parser reads YAML 1.2, where `on` is the string key it
        // looks like; under YAML 1.1 rules it would have been the boolean true.
        doc: parse(await readFile(path.join(workflowsDir, name), 'utf8')),
      })),
  );
}

const jobsOf = (doc) => Object.values(doc?.jobs ?? {});
const stepsOfJob = (job) => job?.steps ?? [];
const stepsOf = (doc) => jobsOf(doc).flatMap(stepsOfJob);
const runsOf = (doc) => stepsOf(doc).map((step) => step?.run).filter((run) => typeof run === 'string');
/** Everything a workflow reuses: the actions its steps use, and any reusable workflow. */
const usesOf = (doc) => [
  ...jobsOf(doc).map((job) => job?.uses),
  ...stepsOf(doc).map((step) => step?.uses),
].filter((uses) => uses !== undefined);

/**
 * The workflow that runs the suite on pull requests: the one CI stands or falls
 * by. Other workflows may run the suite too (publishing does, before it
 * publishes), and the order a directory lists its files in is not a rule.
 */
async function ciWorkflow() {
  const found = (await workflows()).filter((workflow) => workflow.doc?.on?.pull_request !== undefined
    && runsOf(workflow.doc).some((run) => /\bnpm test\b/.test(run)));
  assert.equal(
    found.length,
    1,
    `exactly one workflow should run \`npm test\` on pull requests, got: ${found.map((workflow) => workflow.name).join(', ') || 'none'}`,
  );
  return found[0].doc;
}

/** A version with any range operator dropped: `>=20.19.0` and `20.19.0` are the same version. */
const versionOf = (value) => String(value).replace(/^[^0-9]*/, '');

/** Compare two `x.y.z` versions the way a person reads them: 20.19.0 is below 24.8.0. */
function compareVersions(left, right) {
  const parts = (version) => version.split('.').map(Number);
  const [a, b] = [parts(left), parts(right)];
  for (let at = 0; at < 3; at += 1) {
    if (a[at] !== b[at]) return a[at] - b[at];
  }
  return 0;
}

/** Whether a job runs the suite. */
const runsTheSuite = (job) => stepsOfJob(job).some((step) => /\bnpm test\b/.test(String(step?.run ?? '')));

/**
 * The Node versions one job runs on: the one it hands `actions/setup-node`, or
 * the list a matrix hands it. A job that sets Node up in neither way reports
 * `undefined`, which is an answer the guards can fail on and name.
 */
function nodeVersionsOf(job) {
  const step = stepsOfJob(job).find((entry) => String(entry?.uses ?? '').startsWith('actions/setup-node@'));
  const asked = step?.with?.['node-version'];
  const fromMatrix = /^\$\{\{\s*matrix\.([\w-]+)\s*\}\}$/.exec(String(asked));
  if (fromMatrix === null) return [asked];
  const values = job?.strategy?.matrix?.[fromMatrix[1]];
  return Array.isArray(values) ? values : [undefined];
}

/** Every Node version CI runs the suite on, however the workflow is arranged. */
async function ciNodeVersions() {
  const jobs = jobsOf(await ciWorkflow()).filter(runsTheSuite);
  assert.ok(jobs.length > 0, 'no job in the CI workflow runs the suite');
  return jobs.flatMap(nodeVersionsOf).map((version) => String(version));
}

test('every test file in the repo is run by something', async () => {
  // The point is a test file dropped in a folder nobody runs, so what counts as
  // covered comes from package.json rather than from a list kept here.
  const pkg = await readPackage();
  const globs = pkg.scripts.test.split(/\s+/).slice(1).filter((word) => !word.startsWith('-'));
  const covered = globs.map(globToRegExp);
  const hasSystemCommand = typeof pkg.scripts['test:system'] === 'string';

  const testFiles = (await repoFiles()).filter((rel) => rel.endsWith('.test.js'));

  assert.ok(testFiles.length > 0, 'there should be test files to check');
  for (const file of testFiles) {
    const run = covered.some((pattern) => pattern.test(file))
      || (hasSystemCommand && file.startsWith('test/system/'));
    assert.ok(run, `${file} is run by neither \`npm test\` nor \`npm run test:system\``);
  }
});

test('CI runs the suite on pull requests and on pushes to main', async () => {
  const on = (await ciWorkflow()).on;

  assert.ok(on?.pull_request !== undefined, 'the workflow should trigger on pull requests');
  assert.ok(on?.push !== undefined, 'the workflow should trigger on pushes');
  // `push:` with no filter takes main with everything else; a filter must name it.
  const branches = on.push?.branches;
  assert.ok(branches === undefined || branches.includes('main'), `pushes to main should be covered, got: ${branches}`);
});

test('CI installs with npm ci and runs npm test', async () => {
  // `npm install` would quietly build against something other than the lock file.
  const runs = runsOf(await ciWorkflow());

  assert.ok(runs.some((run) => /\bnpm ci\b/.test(run)), `no step runs \`npm ci\`, got: ${runs.join(' | ')}`);
  assert.ok(runs.some((run) => /\bnpm test\b/.test(run)), `no step runs \`npm test\`, got: ${runs.join(' | ')}`);
});

test('every Node version CI runs the suite on is an exact one', async () => {
  // `lts/*`, `24` and `>=20.19.0` all mean "whatever is current on the day the
  // job runs", so a green run says nothing about the next one, and a red one
  // cannot be reproduced. Only x.y.z pins what was actually tested. That holds
  // for every workflow that runs the suite, not only the one on pull requests.
  const all = await workflows();
  const jobs = all.flatMap((workflow) => Object.entries(workflow.doc?.jobs ?? {})
    .filter(([, job]) => runsTheSuite(job))
    .map(([id, job]) => ({ where: `${workflow.name}: ${id}`, job })));
  assert.ok(jobs.length > 0, 'no job in any workflow runs the suite');

  for (const { where, job } of jobs) {
    for (const version of nodeVersionsOf(job).map(String)) {
      assert.match(version, /^\d+\.\d+\.\d+$/, `${where} runs the suite on \`${version}\`, which is not an exact version`);
    }
  }
});

test('CI runs the suite on a current Node, and also on the floor package.json promises', async () => {
  // The floor is what users are promised, so one job stays on it. But the kit
  // is run on the Node people actually have, and a kit only ever tested on its
  // oldest supported version breaks there first. Stated as a rule rather than a
  // number, so bumping the pinned version later needs no change here.
  const declared = (await readPackage()).engines.node;
  assert.match(declared, /^>=\d/, `engines.node should stay the floor users are promised, got: ${declared}`);
  const floor = versionOf(declared);

  const versions = await ciNodeVersions();
  const shown = versions.join(', ');

  assert.ok(versions.includes(floor), `CI should keep a job on the floor ${floor}, got: ${shown}`);
  assert.ok(
    versions.some((version) => compareVersions(version, floor) > 0),
    `CI should run the suite on a Node newer than the floor ${floor}, got: ${shown}`,
  );
});

test('the README says the same about Node as the package and the workflow do', async () => {
  // The floor lives in three places a person writes by hand — `engines.node`, the
  // workflow, and the sentence a user reads before installing anything — and a
  // reader has no way to tell which of them is stale. The other guards hold the
  // first two together; this holds the third to them.
  const declared = (await readPackage()).engines.node;
  const floor = versionOf(declared);
  const readme = await readFile(path.join(repoRoot, 'README.md'), 'utf8');

  const promised = /Node(?:\.js)?\s*>=\s*(\d+\.\d+\.\d+)/.exec(readme);
  assert.notEqual(promised, null, 'the README should say which Node the kit needs, as >= x.y.z');
  assert.equal(promised[1], floor, `the README promises Node ${promised[1]} and package.json ${floor}`);

  // And every exact version it names in the same breath as Node is one this repo
  // still stands behind: the floor, or a version CI actually runs the suite on.
  const running = await ciNodeVersions();
  const allowed = new Set([floor, ...running]);
  for (const line of readme.split('\n').filter((text) => /\bnode\b/i.test(text))) {
    for (const named of line.match(/\d+\.\d+\.\d+/g) ?? []) {
      assert.ok(
        allowed.has(named),
        `the README says Node ${named}, which is neither the floor ${floor} nor a version CI runs`
        + ` (${running.join(', ')}): ${line.trim()}`,
      );
    }
  }
});

test('every action a workflow uses is pinned to a full commit SHA', async () => {
  // A tag can be moved to point at someone else's code; a SHA cannot.
  const all = await workflows();
  assert.ok(all.length > 0, 'there should be a workflow under .github/workflows');

  const uses = all.flatMap((workflow) => usesOf(workflow.doc).map((entry) => `${workflow.name}: ${entry}`));
  assert.ok(uses.length > 0, 'a workflow that uses no action at all cannot be checking out and testing this repo');
  for (const entry of uses) {
    assert.match(entry, /@[0-9a-f]{40}$/, `${entry} is not pinned to a full commit SHA`);
  }
});

// Publishing (#213): a GitHub Release publishes the package to npm through
// trusted publishing, so no token is stored anywhere and only the one job that
// publishes can ask for the short-lived one.

const publishPath = path.join(workflowsDir, 'publish.yml');

/** The publishing workflow, parsed. */
async function publishWorkflow() {
  let text;
  try {
    text = await readFile(publishPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') assert.fail('there should be a publishing workflow at .github/workflows/publish.yml');
    throw error;
  }
  return parse(text);
}

/** Whether a set of permissions, workflow or job, grants an OIDC token. */
const grantsIdToken = (permissions) => permissions === 'write-all' || permissions?.['id-token'] === 'write';

const runOf = (step) => String(step?.run ?? '');
const npmPublishes = (step) => /\bnpm publish\b/.test(runOf(step));
const installs = (step) => /\bnpm (?:ci|install|i|add)\b/.test(runOf(step));

/** The one job that may ask for an OIDC token, with its id. */
async function publishJob() {
  const doc = await publishWorkflow();
  const granted = Object.entries(doc?.jobs ?? {}).filter(([, job]) => grantsIdToken(job?.permissions));
  assert.equal(
    granted.length,
    1,
    `exactly one job should have \`id-token: write\`, got: ${granted.map(([id]) => id).join(', ') || 'none'}`,
  );
  const [id, job] = granted[0];
  return { doc, id, job };
}

/** The repository the README's "Start here" line sends people to, as owner/name. */
async function readmeRepo() {
  const readme = await readFile(path.join(repoRoot, 'README.md'), 'utf8');
  const section = /^## Start here\n([\s\S]*?)(?=^## )/m.exec(readme);
  assert.notEqual(section, null, 'the README should have a "Start here" section');
  const repos = [...new Set([...section[1].matchAll(/https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)[.,]?(?=[\s)]|$)/g)]
    .map((match) => match[1]))];
  assert.equal(repos.length, 1, `the "Start here" section should name this repo once, got: ${repos.join(', ')}`);
  return repos[0];
}

test('package.json is the public package @assuredloop/orca-bot-kit, and still installs obk', async () => {
  const pkg = await readPackage();

  assert.equal(pkg.name, '@assuredloop/orca-bot-kit');
  // `private: true` makes npm refuse to publish at all.
  assert.notEqual(pkg.private, true, 'package.json should not be private, or npm refuses to publish it');
  // A scoped package is published restricted unless it says otherwise.
  assert.equal(pkg.publishConfig?.access, 'public', 'a scoped package needs publishConfig.access "public"');
  assert.equal(typeof pkg.bin?.obk, 'string', 'the package should still install the obk command');
});

test('package.json names the same GitHub repo the README sends people to', async () => {
  // Trusted publishing refuses a package whose repository.url is not the repo
  // the workflow runs in, and it compares them exactly.
  const repo = await readmeRepo();
  const url = (await readPackage()).repository?.url;

  assert.equal(typeof url, 'string', 'package.json should have repository.url');
  const named = /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(url);
  assert.notEqual(named, null, `repository.url should point at a GitHub repo, got: ${url}`);
  assert.equal(named[1], repo, `repository.url names ${named[1]} and the README ${repo}`);
});

test('the publishing workflow runs when a release is published, and on nothing else', async () => {
  // A push or a pull request that could publish would put whatever is on a
  // branch on npm; a release is the one deliberate act that should.
  const on = (await publishWorkflow())?.on;

  assert.equal(typeof on, 'object', `publish.yml should list its triggers with their types, got: ${JSON.stringify(on)}`);
  assert.deepEqual(Object.keys(on ?? {}), ['release'], 'publish.yml should be triggered by `release` only');
  assert.deepEqual(on.release?.types, ['published'], 'publish.yml should run on a release being published, and no other release event');
});

test('only the publishing job can ask for an OIDC token', async () => {
  // A token granted at the top of the workflow reaches every job in it,
  // including the one that runs other people's install scripts.
  const { doc } = await publishJob();

  assert.ok(!grantsIdToken(doc.permissions), `the workflow-level permissions should grant no id-token, got: ${JSON.stringify(doc.permissions)}`);
});

test('the job that holds the token installs nothing and runs npm publish', async () => {
  // Install scripts are other people's code; they must not run where the token is.
  const { id, job } = await publishJob();
  const steps = stepsOfJob(job);

  assert.deepEqual(steps.filter(installs).map(runOf), [], `${id} holds the token and should install no dependencies`);
  assert.ok(steps.some(npmPublishes), `${id} holds the token and should be the job that runs \`npm publish\``);
});

test('nothing is published before the suite has passed on a clean install', async () => {
  const { doc, id, job } = await publishJob();
  const needs = [job.needs ?? []].flat();
  const runsCiAndTest = (other) => {
    const runs = stepsOfJob(other).map(runOf);
    return runs.some((run) => /\bnpm ci\b/.test(run)) && runs.some((run) => /\bnpm test\b/.test(run));
  };

  assert.ok(
    needs.some((name) => runsCiAndTest(doc.jobs?.[name])),
    `${id} should need a job that runs \`npm ci\` and \`npm test\`, got needs: ${JSON.stringify(job.needs)}`,
  );
});

test('the release tag is checked against the package version before publishing', async () => {
  // A release tagged v0.2.0 over a package.json still at 0.1.0 would publish
  // 0.1.0 again, or fail after the release is already out. How the check is
  // written is the workflow's business; what is pinned is that a step before
  // `npm publish` looks at both.
  const { id, job } = await publishJob();
  const steps = stepsOfJob(job);
  const at = steps.findIndex(npmPublishes);
  assert.ok(at >= 0, `${id} should run \`npm publish\``);

  const checks = steps.slice(0, at)
    .filter((step) => typeof step?.run === 'string')
    .map((step) => JSON.stringify({ run: step.run, env: step.env }))
    .filter((text) => /release\.tag_name|GITHUB_REF/.test(text) && /(?<!node-)\bversion\b|package\.json/.test(text));
  assert.ok(checks.length > 0, `no step in ${id} before \`npm publish\` compares the release tag with the package version`);
});

// Testing a checkout (#217): the `obk` on a developer's PATH is the published
// release, as any user has it. A system test that starts `obk` from PATH tests
// that release rather than the checkout it lives in, and still passes. Each one
// starts this checkout's own `src/cli.js` by its full path instead.

const systemTestsDir = path.join(repoRoot, 'test', 'system');

/** The child_process calls that take a command to start, and what they start. */
const START = /\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync)\s*\(\s*(?:(['"`])((?:(?!\1)[^\\]|\\.)*)\1|([A-Za-z_$][\w$]*))/g;

/** Whether a command, or a shell line, starts the bare `obk` that PATH finds. */
const isBareObk = (command) => /^obk(?:\s|$)/.test(command);

/**
 * Every place a source starts a process, with the line it is on and whether
 * what it starts is the bare `obk`. A command named by a constant is followed
 * to the string the file gives it. The word `obk` in a message or a comment is
 * not a call and is not looked at.
 */
function startsIn(source) {
  const constants = new Map([...source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])((?:(?!\2)[^\\]|\\.)*)\2/g)]
    .map((match) => [match[1], match[3]]));
  return [...source.matchAll(START)].map((match) => {
    const command = match[3] === undefined ? match[2] : constants.get(match[3]);
    return {
      line: source.slice(0, match.index).split('\n').length,
      bareObk: command !== undefined && isBareObk(command),
    };
  });
}

test('the check for a bare `obk` sees a spawn of it, and not the word', () => {
  const flagged = (source) => startsIn(source).filter((start) => start.bareObk).length;

  assert.equal(flagged("spawnSync('obk', args);"), 1, 'a spawn of the bare `obk`');
  assert.equal(flagged("execSync(`obk up --bots ${bots}`);"), 1, 'a shell line that starts with `obk`');
  assert.equal(flagged("const OBK = 'obk';\nspawnSync(OBK, args);"), 1, 'the bare `obk` named by a constant');

  assert.equal(flagged("spawnSync(process.execPath, [CLI, ...args]);"), 0, 'this checkout\'s CLI by its full path');
  assert.equal(flagged("execFileSync('/work/obk-dev/src/cli.js', args);"), 0, 'a full path through a clone named after the kit');
  assert.equal(flagged("/** Run the real `obk`. */\nconst done = spawnSync(ORCA, args);"), 0, 'the word in a comment');
  assert.equal(flagged("assert.fail(`obk ${args.join(' ')} failed`);"), 0, 'the word in a message');
  assert.equal(flagged("spawnSync('git', ['-C', dir, 'obk']);"), 0, 'the word as an argument to something else');
});

test('no system test starts `obk` from PATH instead of this checkout\'s own CLI', async () => {
  const tree = await snapshot(systemTestsDir);
  const files = Object.keys(tree).filter((rel) => rel.endsWith('.js') && tree[rel].startsWith('file:'));
  assert.ok(files.length > 0, 'there should be system tests to check');

  const found = [];
  let starts = 0;
  for (const rel of files) {
    const source = await readFile(path.join(systemTestsDir, rel), 'utf8');
    for (const start of startsIn(source)) {
      starts += 1;
      if (start.bareObk) found.push(`test/system/${rel}:${start.line}`);
    }
  }
  // The system tests start Orca, at the least; finding no call at all means
  // the check has stopped seeing them, not that they have stopped.
  assert.ok(starts > 0, 'no process start was found in the system tests, so the check sees nothing');
  assert.deepEqual(
    found,
    [],
    'these start the `obk` on PATH, which is the published release, not this checkout;'
    + ` start src/cli.js by its full path instead:\n  ${found.join('\n  ')}`,
  );
});
