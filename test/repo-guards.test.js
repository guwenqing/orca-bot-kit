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
const stepsOf = (doc) => jobsOf(doc).flatMap((job) => job?.steps ?? []);
const runsOf = (doc) => stepsOf(doc).map((step) => step?.run).filter((run) => typeof run === 'string');
/** Everything a workflow reuses: the actions its steps use, and any reusable workflow. */
const usesOf = (doc) => [
  ...jobsOf(doc).map((job) => job?.uses),
  ...stepsOf(doc).map((step) => step?.uses),
].filter((uses) => uses !== undefined);

/** The workflow that runs the suite: the one CI stands or falls by. */
async function ciWorkflow() {
  const found = (await workflows()).filter((workflow) => runsOf(workflow.doc).some((run) => /\bnpm test\b/.test(run)));
  assert.ok(found.length > 0, `no workflow under .github/workflows runs \`npm test\``);
  return found[0].doc;
}

/** A version with any range operator dropped: `>=20.19.0` and `20.19.0` are the same version. */
const versionOf = (value) => String(value).replace(/^[^0-9]*/, '');

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

test('CI uses the Node version package.json declares', async () => {
  const declared = (await readPackage()).engines.node;
  const step = stepsOf(await ciWorkflow())
    .find((entry) => typeof entry?.uses === 'string' && entry.uses.startsWith('actions/setup-node@'));

  assert.ok(step, 'the workflow should set up Node with actions/setup-node');
  const asked = step.with?.['node-version'];
  // Either the version is named, or setup-node is pointed at the file that declares it.
  if (asked === undefined) {
    assert.equal(step.with?.['node-version-file'], 'package.json');
  } else {
    assert.equal(versionOf(asked), versionOf(declared));
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
