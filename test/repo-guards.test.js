// Facts about the repo itself that a green test run cannot prove: that every
// test file is actually run by something, and that the workflow which runs them
// in CI is set up the way it must be.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import { repoRoot, snapshot } from './helpers/cli.js';

/** Trees that hold copies of other people's files, or of our own. */
const IGNORED = new Set(['node_modules', '.git', '.stryker-tmp', 'reports']);

const workflowsDir = path.join(repoRoot, '.github', 'workflows');

const readPackage = async () => JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));

/** The files package.json's test script hands `node --test`: what the suite is. */
const testGlobsOf = (pkg) => pkg.scripts.test.split(/\s+/).slice(1).filter((word) => !word.startsWith('-'));

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
/** Everything a workflow reuses: the actions its steps use, and any reusable workflow. */
const usesOf = (doc) => [
  ...jobsOf(doc).map((job) => job?.uses),
  ...stepsOf(doc).map((step) => step?.uses),
].filter((uses) => uses !== undefined);
/** The events a workflow runs on, however `on` is written: one name, a list, or a map. */
function triggersOf(doc) {
  const on = doc?.on;
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on;
  return Object.keys(on ?? {});
}
/** The jobs a job needs, however `needs` is written. */
const needsOf = (job) => [job?.needs ?? []].flat();
/** Every job a job waits for, directly or through a job it needs. */
function ancestorsOf(doc, id) {
  const seen = new Set();
  const visit = (at) => {
    for (const need of needsOf(doc?.jobs?.[at])) {
      if (!seen.has(need)) {
        seen.add(need);
        visit(need);
      }
    }
  };
  visit(id);
  return seen;
}
const setupNodeOf = (job) => stepsOfJob(job).find((step) => String(step?.uses ?? '').startsWith('actions/setup-node@'));

// How CI runs the suite (#364): a pull request runs it split into shards on the
// Node the kit targets, a release runs every shard on that Node and on the floor
// before anything is published, and a push runs nothing. Node shards a run
// itself with `--test-shard=<index>/<total>`, but only when the flag comes before
// the files: `npm test -- --test-shard=1/3` runs the whole suite. So package.json
// keeps a second script, `test:shard`, that takes the shard from SHARD, and a
// workflow sets SHARD and runs that. The workflows hold no list of files of
// their own that could drift from package.json's.
//
// The floor (#533) installs only what a user installs, so it runs a third
// script, `test:floor`: the shard SHARD names of the suite less test/dev/,
// whose tests need the dev dependencies. Pull requests run test/dev/ too.

/**
 * The ways a step runs the suite package.json defines, one entry each: `npm
 * test` is the whole suite, `npm run test:shard` the one shard SHARD names,
 * and `npm run test:floor` the floor's shard SHARD names, marked `floor: true`.
 * `shard` is what SHARD is set to, in front of the command or in the step's,
 * job's or workflow's `env`, and undefined where nothing sets it. A command
 * counts only where it starts a line: `echo npm test` runs nothing.
 */
function suiteCommandsIn(step, job = {}, doc = {}) {
  if (typeof step?.run !== 'string') return [];
  // An expression can hold spaces; it is held aside while the line is split.
  const held = [];
  const text = step.run.replace(/\\\n/g, ' ').replace(/\$\{\{[\s\S]*?\}\}/g, (expression) => `\0${held.push(expression) - 1}\0`);
  const back = (word) => word.replace(/\0(\d+)\0/g, (_, at) => held[Number(at)]);
  const found = [];
  for (const command of text.split(/\n|&&|\|\||;|\|/)) {
    const words = command.replace(/(^|\s)#.*$/, '').trim().split(/\s+/).map(back);
    const at = words.indexOf('npm');
    if (at < 0 || !words.slice(0, at).every((word) => /^[A-Za-z_]\w*=/.test(word))) continue;
    if (words[at + 1] === 'test') found.push({ whole: true });
    if (words[at + 1] === 'run' && (words[at + 2] === 'test:shard' || words[at + 2] === 'test:floor')) {
      const inline = words.slice(0, at).map((word) => /^SHARD=(.*)$/.exec(word)?.[1]).find((value) => value !== undefined);
      const shard = inline ?? step.env?.SHARD ?? job?.env?.SHARD ?? doc?.env?.SHARD;
      found.push(words[at + 2] === 'test:floor' ? { whole: false, shard, floor: true } : { whole: false, shard });
    }
  }
  return found;
}

/** Whether a job runs the suite, whole or a shard of it. */
const runsTheSuite = (job) => stepsOfJob(job).some((step) => suiteCommandsIn(step, job).length > 0);

/**
 * The workflow that runs the suite on pull requests: the one CI stands or falls
 * by. Other workflows may run the suite too (publishing does, before it
 * publishes), and the order a directory lists its files in is not a rule.
 */
async function ciWorkflow() {
  const found = (await workflows()).filter((workflow) => triggersOf(workflow.doc).includes('pull_request')
    && jobsOf(workflow.doc).some(runsTheSuite));
  assert.equal(
    found.length,
    1,
    'exactly one workflow should run the suite (`npm test`, or `npm run test:shard`) on pull requests,'
    + ` got: ${found.map((workflow) => workflow.name).join(', ') || 'none'}`,
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

/** The floor package.json's engines promises users, as x.y.z. */
async function engineFloor() {
  const declared = (await readPackage()).engines.node;
  assert.match(declared, /^>=\d/, `engines.node should stay the floor users are promised, got: ${declared}`);
  return versionOf(declared);
}

// A GitHub Actions expression, `${{ ... }}`, evaluated here: as much of the
// language as the parts of a workflow the guards read use (a matrix value, a
// job's result, the status functions), and an error naming the expression for
// anything past that, so a guard fails saying what it could not read rather
// than guessing.

/** A list made by `.*`, whose properties are read off each item. */
class Filtered extends Array {}

const cannotRead = (expression) => new Error(`the guard cannot read the expression \`${expression}\``);

/** What an expression's value reads as when it is written into text. */
function shown(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

const truthy = (value) => !(value === false || value === null || value === undefined || value === '' || value === 0 || Number.isNaN(value));

function toNumber(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') return value.trim() === '' ? 0 : Number(value);
  return typeof value === 'number' ? value : Number.NaN;
}

/** `==` as GitHub has it: strings ignore case, and mixed types compare as numbers. */
function looseEqual(left, right) {
  if (typeof left === 'string' && typeof right === 'string') return left.toLowerCase() === right.toLowerCase();
  if (typeof left !== typeof right || left === null || right === null) return toNumber(left) === toNumber(right);
  return left === right;
}

function property(value, name) {
  if (value instanceof Filtered) return Filtered.from(value, (item) => item?.[name] ?? null);
  if (value !== null && typeof value === 'object') return value[name] ?? null;
  return null;
}

function callFunction(name, args, context, expression) {
  const fn = name.toLowerCase();
  if (['success', 'failure', 'cancelled', 'always'].includes(fn)) {
    if (context.status === undefined) throw cannotRead(expression);
    return context.status[fn]();
  }
  const [first, second] = args;
  const text = (value) => shown(value).toLowerCase();
  if (fn === 'contains') return Array.isArray(first) ? first.some((item) => looseEqual(item, second)) : text(first).includes(text(second));
  if (fn === 'startswith') return text(first).startsWith(text(second));
  if (fn === 'endswith') return text(first).endsWith(text(second));
  if (fn === 'join') return Array.isArray(first) ? first.map(shown).join(second === undefined ? ',' : shown(second)) : shown(first);
  if (fn === 'tojson') return JSON.stringify(first ?? null, null, 2);
  if (fn === 'format') return shown(first).replace(/\{(\d+)\}/g, (_, at) => shown(args[Number(at) + 1]));
  throw cannotRead(expression);
}

/** The value of one expression, the part inside `${{ }}`, over `context`. */
function evaluate(expression, context) {
  const TOKEN = /\s*(?:'((?:[^']|'')*)'|(\d+(?:\.\d+)?)|(==|!=|<=|>=|&&|\|\||[!<>().,*[\]])|([A-Za-z_][\w-]*))\s*/y;
  const tokens = [];
  const source = expression.trim();
  for (let at = 0; at < source.length;) {
    TOKEN.lastIndex = at;
    const match = TOKEN.exec(source);
    if (match === null) throw cannotRead(expression);
    at = TOKEN.lastIndex;
    if (match[1] !== undefined) tokens.push({ value: match[1].replace(/''/g, "'") });
    else if (match[2] !== undefined) tokens.push({ value: Number(match[2]) });
    else if (match[3] !== undefined) tokens.push({ op: match[3] });
    else tokens.push({ name: match[4] });
  }

  let next = 0;
  const isOp = (op) => tokens[next]?.op === op;
  const expect = (op) => {
    if (!isOp(op)) throw cannotRead(expression);
    next += 1;
  };
  const primary = () => {
    const token = tokens[next];
    next += 1;
    if (token === undefined) throw cannotRead(expression);
    if ('value' in token) return token.value;
    if (token.op === '(') {
      const value = or();
      expect(')');
      return value;
    }
    if (token.name === undefined) throw cannotRead(expression);
    const literal = { true: true, false: false, null: null }[token.name];
    if (literal !== undefined) return literal;
    if (isOp('(')) {
      next += 1;
      const args = [];
      while (!isOp(')')) {
        args.push(or());
        if (!isOp(')')) expect(',');
      }
      next += 1;
      return callFunction(token.name, args, context, expression);
    }
    if (!Object.hasOwn(context, token.name) || token.name === 'status') throw cannotRead(expression);
    return context[token.name];
  };
  const postfix = () => {
    let value = primary();
    for (;;) {
      if (isOp('.')) {
        next += 1;
        const token = tokens[next];
        next += 1;
        if (token?.op === '*') value = value instanceof Filtered ? Filtered.from(value.flatMap((item) => Object.values(item ?? {}))) : Filtered.from(Object.values(value ?? {}));
        else if (token?.name !== undefined) value = property(value, token.name);
        else throw cannotRead(expression);
      } else if (isOp('[')) {
        next += 1;
        const key = or();
        expect(']');
        value = property(value, String(key));
      } else {
        return value;
      }
    }
  };
  const unary = () => {
    if (!isOp('!')) return postfix();
    next += 1;
    return !truthy(unary());
  };
  const compare = () => {
    const left = unary();
    const op = tokens[next]?.op;
    if (!['==', '!=', '<', '>', '<=', '>='].includes(op)) return left;
    next += 1;
    const right = unary();
    if (op === '==') return looseEqual(left, right);
    if (op === '!=') return !looseEqual(left, right);
    const [a, b] = [toNumber(left), toNumber(right)];
    return { '<': a < b, '>': a > b, '<=': a <= b, '>=': a >= b }[op];
  };
  const and = () => {
    let left = compare();
    while (isOp('&&')) {
      next += 1;
      const right = compare();
      left = truthy(left) ? right : left;
    }
    return left;
  };
  function or() {
    let left = and();
    while (isOp('||')) {
      next += 1;
      const right = and();
      left = truthy(left) ? left : right;
    }
    return left;
  }

  const value = or();
  if (next !== tokens.length) throw cannotRead(expression);
  return value;
}

/** A value from a workflow with every `${{ }}` in it filled in. */
const interpolate = (text, context) => String(text).replace(/\$\{\{([\s\S]*?)\}\}/g, (_, expression) => shown(evaluate(expression, context)));

/** A value from a workflow, filled in; undefined where it is missing or cannot be read. */
function readValue(value, context) {
  if (value === undefined || value === null) return undefined;
  try {
    return interpolate(value, context);
  } catch {
    return undefined;
  }
}

/**
 * The legs of a job's matrix, as GitHub expands it: every combination of its
 * lists, less `exclude`, with `include` added to the legs it fits or as legs of
 * its own. One empty leg for a job with no matrix; null for a matrix the YAML
 * does not spell out (an expression, say), which the guards cannot read.
 */
function legsOf(job) {
  const matrix = job?.strategy?.matrix;
  if (matrix === undefined) return [{}];
  if (matrix === null || typeof matrix !== 'object' || Array.isArray(matrix)) return null;
  const { include = [], exclude = [], ...lists } = matrix;
  if (!Array.isArray(include) || !Array.isArray(exclude) || !Object.values(lists).every(Array.isArray)) return null;
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

  let legs = Object.keys(lists).length === 0
    ? []
    : Object.entries(lists).reduce((sofar, [key, values]) => sofar.flatMap((leg) => values.map((value) => ({ ...leg, [key]: value }))), [{}]);
  legs = legs.filter((leg) => !exclude.some((out) => Object.entries(out).every(([key, value]) => same(leg[key], value))));
  const original = legs.map((leg) => ({ ...leg }));
  for (const extra of include) {
    let fitted = false;
    legs.forEach((leg, at) => {
      if (Object.entries(extra).every(([key, value]) => !(key in original[at]) || same(original[at][key], value))) {
        Object.assign(leg, extra);
        fitted = true;
      }
    });
    if (!fitted) {
      legs.push({ ...extra });
      original.push({ ...extra });
    }
  }
  return legs;
}

/** What a job reads its matrix and strategy from, on one leg. */
const legContext = (matrix, legs) => ({ matrix, strategy: { 'job-total': legs.length } });

/**
 * The Node versions one job runs on: the one it hands `actions/setup-node`, on
 * every leg of its matrix. A job whose Node the YAML does not say reports
 * `undefined`, which is an answer the guards can fail on and name.
 */
function nodeVersionsOf(job) {
  const legs = legsOf(job);
  if (legs === null) return [undefined];
  return [...new Set(legs.map((matrix) => readValue(setupNodeOf(job)?.with?.['node-version'], legContext(matrix, legs))))];
}

/** Every Node version CI runs the suite on, however the workflow is arranged. */
async function ciNodeVersions() {
  const jobs = jobsOf(await ciWorkflow()).filter(runsTheSuite);
  assert.ok(jobs.length > 0, 'no job in the CI workflow runs the suite');
  return jobs.flatMap(nodeVersionsOf).map((version) => String(version));
}

/**
 * Every run of the suite a workflow makes: one for each leg of a job's matrix
 * and each step on it that runs the suite, with the job, the leg, the Node and
 * the shard, `index` of `total`, the whole suite being shard 1 of 1. A run the
 * YAML does not say enough about has a `problem` instead of a shard.
 */
function suiteRunsIn(doc) {
  return Object.entries(doc?.jobs ?? {}).flatMap(([id, job]) => {
    const commands = stepsOfJob(job).flatMap((step) => suiteCommandsIn(step, job, doc));
    if (commands.length === 0) return [];
    const legs = legsOf(job);
    if (legs === null) return [{ id, problem: `${id} has a matrix that is not written out as lists` }];
    return legs.flatMap((matrix, leg) => {
      const context = legContext(matrix, legs);
      const node = readValue(setupNodeOf(job)?.with?.['node-version'], context);
      return commands.map((command) => {
        if (command.whole) return { id, leg, node, index: 1, total: 1 };
        const shard = /^(\d+)\/(\d+)$/.exec(readValue(command.shard, context) ?? '');
        if (shard === null) {
          return {
            id,
            leg,
            node,
            problem: `${id} ${JSON.stringify(matrix)} runs \`npm run ${command.floor ? 'test:floor' : 'test:shard'}\` with SHARD`
              + ` ${command.shard === undefined ? 'unset' : `\`${command.shard}\``}, not <index>/<total>`,
          };
        }
        return { id, leg, node, index: Number(shard[1]), total: Number(shard[2]) };
      });
    });
  });
}

/** The runs of the suite in a workflow, failing the guard on any it cannot read. */
function readRuns(doc, name) {
  const runs = suiteRunsIn(doc);
  const unread = runs.filter((run) => run.problem !== undefined).map((run) => run.problem);
  assert.deepEqual(unread, [], `${name}: the guards cannot tell which shard these run:\n  ${unread.join('\n  ')}`);
  return runs;
}

/** Runs grouped by the Node they run on. */
function byNode(runs) {
  const groups = new Map();
  for (const run of runs) groups.set(String(run.node), [...(groups.get(String(run.node)) ?? []), run]);
  return groups;
}

/**
 * Why the runs of one Node do not, between them, run every file once: empty
 * when they do. Node sorts the files and deals them out, so shards 1 to n of
 * one total n run each file exactly once, and any gap drops the files it held.
 */
function shardGaps(runs) {
  const totals = [...new Set(runs.map((run) => run.total))];
  if (totals.length !== 1) return [`the shards name different totals: ${totals.join(', ')}`];
  const [total] = totals;
  const indexes = runs.map((run) => run.index).sort((a, b) => a - b);
  const want = Array.from({ length: total }, (_, at) => at + 1);
  if (indexes.join() !== want.join()) return [`shards ${indexes.join(', ')} of ${total} run, where 1 to ${total} should each run once`];
  return [];
}

// Whether a job starts, and how it ends, when the jobs it waits for end one
// way or another. GitHub skips a job whose needs did not all succeed unless its
// `if` asks for it with a status function, and a skipped check reads as passing,
// so what a summary or the publishing job does on a failed shard is not
// something the YAML's shape shows: the guards play it out. A job's steps are
// run for real, in bash, as a runner would run them, in an empty folder.

/** Whether an `if` holds. With no status function in it, success() is implied, as GitHub has it. */
function condition(value, context) {
  if (value === undefined) return context.status.success();
  const expression = String(value).replace(/^\s*\$\{\{([\s\S]*)\}\}\s*$/, '$1');
  const holds = truthy(evaluate(expression, context));
  return /\b(?:success|failure|cancelled|always)\s*\(/.test(expression) ? holds : context.status.success() && holds;
}

/** How a job that started ends: its steps run one by one, as a runner would. */
function runJob(doc, id, job, needs, cancelled) {
  let failed = false;
  for (const step of stepsOfJob(job)) {
    const status = {
      always: () => true,
      cancelled: () => cancelled,
      success: () => !failed,
      failure: () => failed,
    };
    const context = { needs, status };
    if (!condition(step?.if, context)) continue;
    if (typeof step?.run !== 'string' || ![undefined, 'bash'].includes(step.shell ?? job.defaults?.run?.shell)) {
      throw new Error(`the guard can only play out \`run\` steps in bash, and ${id} has: ${JSON.stringify(step)}`);
    }
    const env = Object.fromEntries(Object.entries({ ...doc?.env, ...job.env, ...step.env })
      .map(([name, value]) => [name, interpolate(value, context)]));
    const folder = mkdtempSync(path.join(os.tmpdir(), 'obk-guard-'));
    try {
      const done = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', interpolate(step.run, context)], {
        cwd: folder,
        env: { PATH: process.env.PATH, ...env },
        encoding: 'utf8',
        timeout: 10_000,
      });
      if (done.status !== 0 && step['continue-on-error'] !== true) failed = true;
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }
  return failed ? 'failure' : 'success';
}

/**
 * How job `target` of a workflow ends when the jobs in `results` end as it says
 * ('success', 'failure', 'cancelled' or 'skipped'), in a run that was
 * `cancelled` or not. The job `held` is not run: for it the answer is only
 * whether it would start, 'started' or 'skipped'.
 */
function outcome(doc, target, results, { cancelled = false, held } = {}) {
  const ended = new Map(Object.entries(results));
  const resultOf = (id) => {
    if (ended.has(id)) return ended.get(id);
    const job = doc?.jobs?.[id];
    assert.ok(job !== undefined, `${id} is needed, and there is no such job`);
    const needs = Object.fromEntries(needsOf(job).map((need) => [need, { result: resultOf(need), outputs: {} }]));
    const all = Object.values(needs).map((need) => need.result);
    const status = {
      always: () => true,
      cancelled: () => cancelled,
      success: () => !cancelled && all.every((result) => result === 'success'),
      failure: () => all.includes('failure'),
    };
    let result;
    if (!condition(job.if, { needs, status })) result = 'skipped';
    else if (id === held) result = 'started';
    else result = runJob(doc, id, job, needs, cancelled);
    ended.set(id, result);
    return result;
  };
  return resultOf(target);
}

/** The ways a run of the suite can end short of passing, one job at a time. */
const NOT_PASSED = [
  { result: 'failure', cancelled: false, says: 'fails' },
  { result: 'cancelled', cancelled: false, says: 'is cancelled' },
  { result: 'cancelled', cancelled: true, says: 'is cancelled with the whole run' },
  { result: 'skipped', cancelled: false, says: 'is skipped' },
];

/**
 * Why `summary` is not a check to read CI by: empty when it passes as the jobs
 * it reads all passed, and fails whenever one of them did not. When the whole
 * run is cancelled, what is asked is only that it still starts: which of its
 * steps a runner runs then is not something the guards claim to know.
 */
function summaryHolds(doc, summary, suite) {
  const passing = Object.fromEntries(suite.map((id) => [id, 'success']));
  const found = [];
  const onPass = outcome(doc, summary, passing);
  if (onPass !== 'success') found.push(`it ends ${onPass} when every job that runs the suite passed`);
  for (const id of suite) {
    for (const { result, cancelled, says } of NOT_PASSED) {
      const got = cancelled
        ? outcome(doc, summary, { ...passing, [id]: result }, { cancelled, held: summary })
        : outcome(doc, summary, { ...passing, [id]: result });
      if (got !== (cancelled ? 'started' : 'failure')) {
        found.push(`it ends ${got} when ${id} ${says}${got === 'skipped' ? ', and a skipped check reads as passing' : ''}`);
      }
    }
  }
  return found;
}

test('every test file in the repo is run by something', async () => {
  // The point is a test file dropped in a folder nobody runs, so what counts as
  // covered comes from package.json rather than from a list kept here.
  const pkg = await readPackage();
  const globs = testGlobsOf(pkg);
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

/**
 * Why a `test:shard` script does not run the shard SHARD names of exactly what
 * the `test` script runs: undefined when it does. The two stay one flag apart,
 * so they cannot drift, and the flag comes before the files, where Node takes it.
 */
function shardScriptProblem(testScript, shardScript) {
  if (typeof shardScript !== 'string') return 'there is no test:shard script';
  const words = shardScript.trim().split(/\s+/);
  if (words[0] !== 'node' || words[1] !== '--test') return 'it should run `node --test`';
  const flags = words.map((word, at) => ({ word: word.replace(/["']/g, ''), at }))
    .filter(({ word }) => /^--test-shard=(?:\$SHARD|\$\{SHARD\})$/.test(word));
  if (flags.length !== 1) return 'it should take its shard from SHARD, once, as --test-shard=$SHARD';
  const firstFile = words.findIndex((word, at) => at >= 2 && !word.startsWith('-'));
  if (firstFile >= 0 && flags[0].at > firstFile) return 'its shard flag comes after the files, where Node takes no flag';
  const rest = words.filter((_, at) => at !== flags[0].at).join(' ');
  if (rest !== testScript.trim().split(/\s+/).join(' ')) return `less its shard flag, it should be the test script, \`${testScript}\`, and it is \`${rest}\``;
  return undefined;
}

test('the check for the suite sees npm test and npm run test:shard with its SHARD, and nothing else', () => {
  const commands = (run, env) => suiteCommandsIn({ run, env });

  assert.deepEqual(commands('npm test'), [{ whole: true }]);
  assert.deepEqual(commands('npm ci\nnpm test'), [{ whole: true }], 'on a later line');
  // Node takes no flag after the files, so this is the whole suite.
  assert.deepEqual(commands('npm test -- --test-shard=1/3'), [{ whole: true }], 'a shard npm test hands on after the files');
  assert.deepEqual(commands('npm run test:shard', { SHARD: '${{ matrix.shard }}/4' }), [{ whole: false, shard: '${{ matrix.shard }}/4' }], 'SHARD from env');
  assert.deepEqual(commands('SHARD=${{ matrix.shard }}/${{ strategy.job-total }} npm run test:shard'),
    [{ whole: false, shard: '${{ matrix.shard }}/${{ strategy.job-total }}' }], 'SHARD in front of the command');
  assert.deepEqual(suiteCommandsIn({ run: 'npm run test:shard' }, { env: { SHARD: '2/3' } }), [{ whole: false, shard: '2/3' }], 'SHARD from the job');
  assert.deepEqual(commands('npm run test:shard'), [{ whole: false, shard: undefined }], 'SHARD set nowhere');

  for (const run of [
    'node --test test/*.test.js',
    'node --test --test-shard=1/3 test/*.test.js',
    'npm run test:system -- --yes',
    'npm ci',
    'echo npm test',
    'npm run test:shards',
  ]) {
    assert.deepEqual(commands(run), [], `should not be seen: ${run}`);
  }
});

test('the check for test:shard sees it drift from the test script, or take its shard where Node ignores it', () => {
  const script = 'node --test test/*.test.js';

  assert.equal(shardScriptProblem(script, 'node --test --test-shard=$SHARD test/*.test.js'), undefined);
  assert.equal(shardScriptProblem(script, 'node --test --test-shard="${SHARD}" test/*.test.js'), undefined, 'quoted and braced');

  for (const shard of [
    undefined,
    'node --test test/*.test.js --test-shard=$SHARD',
    'node --test --test-shard=$SHARD test/unit/*.test.js',
    'node --test --test-shard=$SHARD test/*.test.js test/system/*.test.js',
    'node --test --test-shard=$SHARD --test-name-pattern=cli test/*.test.js',
    'node --test --test-shard=1/3 test/*.test.js',
    'node --test --test-shard=$SHARD --test-shard=$SHARD test/*.test.js',
    'npm test -- --test-shard=$SHARD',
  ]) {
    assert.notEqual(shardScriptProblem(script, shard), undefined, `should be seen: ${shard}`);
  }
});

test('package.json\'s test:shard runs the files its test script runs, as the shard SHARD names', async () => {
  // A shard job runs `npm run test:shard`, so this script is what CI and every
  // release test. Kept to the test script plus the one flag, it cannot come to
  // run other files than `npm test` does, and no test file drops out of CI.
  const { scripts } = await readPackage();

  assert.equal(shardScriptProblem(scripts.test, scripts['test:shard']), undefined,
    `test:shard should be \`node --test --test-shard=$SHARD\` over the test script's files: ${shardScriptProblem(scripts.test, scripts['test:shard'])}`);
});

test('the check for the suite sees npm run test:floor with its SHARD as the floor\'s shard, and nothing like it', () => {
  const commands = (run, env) => suiteCommandsIn({ run, env });

  assert.deepEqual(commands('npm run test:floor', { SHARD: '${{ matrix.shard }}/9' }), [{ whole: false, shard: '${{ matrix.shard }}/9', floor: true }], 'SHARD from env');
  assert.deepEqual(commands('npm ci --omit=dev\nSHARD=2/3 npm run test:floor'), [{ whole: false, shard: '2/3', floor: true }], 'SHARD in front of the command, on a later line');
  assert.deepEqual(suiteCommandsIn({ run: 'npm run test:floor' }, { env: { SHARD: '4/9' } }), [{ whole: false, shard: '4/9', floor: true }], 'SHARD from the job');
  assert.deepEqual(commands('npm run test:floor'), [{ whole: false, shard: undefined, floor: true }], 'SHARD set nowhere');

  for (const run of ['npm run test:floors', 'npm run test:flo', 'echo npm run test:floor', 'npm run floor']) {
    assert.deepEqual(commands(run), [], `should not be seen: ${run}`);
  }
});

/** Where the tests live that need the dev dependencies: the floor does not run them (#533). */
const DEV_TESTS = 'test/dev/';

/** The files a `node --test` script hands Node, as globs. */
const globsOf = (script) => script.trim().split(/\s+/).slice(1).filter((word) => !word.startsWith('-'));

/** The package.json script a suite command runs. */
const scriptOf = (command) => {
  if (command.whole) return 'test';
  return command.floor ? 'test:floor' : 'test:shard';
};

/**
 * Why a `test:floor` script does not run the shard SHARD names of exactly what
 * the `test` script runs less test/dev/: undefined when it does. It is held to
 * the test script as test:shard is, so the floor cannot drift from the suite.
 */
function floorScriptProblem(testScript, floorScript) {
  if (typeof floorScript !== 'string') return 'there is no test:floor script';
  const lessDev = testScript.trim().split(/\s+/).filter((word) => !word.startsWith(DEV_TESTS)).join(' ');
  return shardScriptProblem(lessDev, floorScript);
}

test('the check for test:floor sees it run test/dev/, drift from the test script, or take its shard where Node ignores it', () => {
  const script = 'node --test test/*.test.js test/dev/*.test.js';

  assert.equal(floorScriptProblem(script, 'node --test --test-shard=$SHARD test/*.test.js'), undefined);
  assert.equal(floorScriptProblem(script, 'node --test --test-shard="${SHARD}" test/*.test.js'), undefined, 'quoted and braced');

  for (const floor of [
    undefined,
    'node --test --test-shard=$SHARD test/*.test.js test/dev/*.test.js',
    'node --test --test-shard=$SHARD test/dev/*.test.js',
    'node --test --test-shard=$SHARD',
    'node --test test/*.test.js',
    'node --test test/*.test.js --test-shard=$SHARD',
    'node --test --test-shard=1/9 test/*.test.js',
    'node --test --test-shard=$SHARD test/*.test.js test/system/*.test.js',
    'node --test --test-shard=$SHARD --test-name-pattern=cli test/*.test.js',
    'npm run test:shard',
  ]) {
    assert.notEqual(floorScriptProblem(script, floor), undefined, `should be seen: ${floor}`);
  }
});

test('package.json\'s test:floor runs the files its test script runs less test/dev/, as the shard SHARD names', async () => {
  // The floor installs what a user installs and nothing else (#533). Its
  // script is the test script less the tests that need the dev dependencies,
  // plus the shard flag, so no other file drops out of the floor's run.
  const { scripts } = await readPackage();

  assert.equal(floorScriptProblem(scripts.test, scripts['test:floor']), undefined,
    `test:floor should be \`node --test --test-shard=$SHARD\` over the test script's files less ${DEV_TESTS}: ${floorScriptProblem(scripts.test, scripts['test:floor'])}`);
});

test('pull requests run test/dev/ too: every test file there is in what each CI job that runs the suite runs', async () => {
  // test/dev/ holds tests the floor cannot run (#533). Pull requests are where
  // they run, so a job there that ran only the floor's files would drop them.
  const pkg = await readPackage();
  const ci = await ciWorkflow();
  const devFiles = (await repoFiles()).filter((rel) => rel.startsWith(DEV_TESTS) && rel.endsWith('.test.js'));
  assert.ok(devFiles.length > 0, `there should be test files under ${DEV_TESTS} to check`);

  const missed = [];
  for (const [id, job] of Object.entries(ci.jobs).filter(([, entry]) => runsTheSuite(entry))) {
    for (const command of stepsOfJob(job).flatMap((step) => suiteCommandsIn(step, job, ci))) {
      const name = scriptOf(command);
      const script = pkg.scripts[name];
      assert.equal(typeof script, 'string', `${id} runs the ${name} script, and package.json has none`);
      const globs = globsOf(script).map(globToRegExp);
      for (const file of devFiles.filter((rel) => !globs.some((glob) => glob.test(rel)))) missed.push(`${id} (${name}) does not run ${file}`);
    }
  }
  assert.deepEqual(missed, [], `pull requests should run every test under ${DEV_TESTS}:\n  ${missed.join('\n  ')}`);
});

test('pull requests run the suite, and no workflow runs it on a push', async () => {
  // The owner (#364): a pull request is where the suite runs, and a merge to
  // main runs it no more. The risk he took with that: a pull request tested
  // against an older main can merge into a combination no run checked. The
  // release runs the suite again, on both Nodes, before anything is published.
  const ci = await ciWorkflow();
  assert.ok(triggersOf(ci).includes('pull_request'), 'the workflow should trigger on pull requests');

  const onPush = (await workflows())
    .filter((workflow) => triggersOf(workflow.doc).includes('push') && jobsOf(workflow.doc).some(runsTheSuite))
    .map((workflow) => workflow.name);
  assert.deepEqual(onPush, [], `these run the suite on a push: ${onPush.join(', ')}`);
});

test('CI installs with npm ci before it runs the suite, in every job that runs it', async () => {
  // `npm install` would quietly build against something other than the lock file.
  const ci = await ciWorkflow();

  for (const [id, job] of Object.entries(ci.jobs).filter(([, entry]) => runsTheSuite(entry))) {
    const steps = stepsOfJob(job);
    const installAt = steps.findIndex((step) => /\bnpm ci\b/.test(String(step?.run ?? '')));
    const suiteAt = steps.findIndex((step) => suiteCommandsIn(step, job, ci).length > 0);
    assert.ok(installAt >= 0 && installAt < suiteAt, `${id} should run \`npm ci\` before it runs the suite`);
  }
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

test('pull requests run the suite on one Node only, and it is newer than the floor package.json promises', async () => {
  // The owner (#364): a pull request is checked on the Node the kit targets, the
  // one people actually have; the floor waits for the release. Stated as a rule
  // rather than a number, so bumping the pinned version later needs no change here.
  const floor = await engineFloor();
  const versions = [...new Set(await ciNodeVersions())];

  assert.equal(versions.length, 1, `pull requests should run the suite on one Node, got: ${versions.join(', ')}`);
  assert.ok(compareVersions(versions[0], floor) > 0, `pull requests should run the suite on a Node newer than the floor ${floor}, got: ${versions[0]}`);
});

test('wherever the suite runs in shards, the shards on each Node are 1 to n of one n, so together they run every file', async () => {
  // Node sorts the files and deals them out by shard, so a shard left out, or
  // two totals that do not agree, drop files from the run with nothing red to say so.
  const all = await workflows();
  const found = [];
  for (const workflow of all) {
    for (const [node, runs] of byNode(readRuns(workflow.doc, workflow.name))) {
      for (const gap of shardGaps(runs)) found.push(`${workflow.name}, Node ${node}: ${gap}`);
    }
  }
  assert.deepEqual(found, [], `these do not run every file:\n  ${found.join('\n  ')}`);
});

test('pull requests have one summary check that needs every job running the suite, and it fails unless they all passed', async () => {
  // "CI green" stays one thing to read (#364). A job whose needs did not all
  // pass is skipped unless its `if` asks otherwise, and a skipped check reads as
  // passing; so the summary has to start whatever the shards did, and fail
  // itself when any of them failed, was cancelled or never ran.
  const ci = await ciWorkflow();
  const suite = Object.keys(ci.jobs).filter((id) => runsTheSuite(ci.jobs[id]));
  const summaries = Object.entries(ci.jobs)
    .filter(([id, job]) => !suite.includes(id) && suite.every((need) => needsOf(job).includes(need)))
    .map(([id]) => id);
  assert.equal(summaries.length, 1, `exactly one job should need every job that runs the suite (${suite.join(', ')}), got: ${summaries.join(', ') || 'none'}`);

  const found = summaryHolds(ci, summaries[0], suite);
  assert.deepEqual(found, [], `${summaries[0]} is not a check to read CI by:\n  ${found.join('\n  ')}`);
});

test('the check for a summary sees one a failed shard skips, one a cancelled run skips, and one that only reports', () => {
  const holds = (summary) => summaryHolds({ jobs: { shards: { steps: [] }, summary: { needs: ['shards'], ...summary } } }, 'summary', ['shards']).length === 0;
  const allPassed = "contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled') || contains(needs.*.result, 'skipped')";

  assert.equal(holds({ if: 'always()', steps: [{ run: 'test "${{ needs.shards.result }}" = success' }] }), true, 'a test of the result');
  assert.equal(holds({ if: '${{ always() }}', steps: [{ if: allPassed, run: 'exit 1' }] }), true, 'a step that fails on a bad result');

  assert.equal(holds({ steps: [{ run: 'test "${{ needs.shards.result }}" = success' }] }), false, 'no `if`: skipped when a shard fails');
  assert.equal(holds({ if: '!cancelled()', steps: [{ run: 'test "${{ needs.shards.result }}" = success' }] }), false, 'skipped when the run is cancelled');
  assert.equal(holds({ if: 'always()', steps: [{ run: 'echo "${{ needs.shards.result }}"' }] }), false, 'only reports');
  assert.equal(holds({ if: 'always()', steps: [{ if: "contains(needs.*.result, 'failure')", run: 'exit 1' }] }), false, 'passes a cancelled shard');
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

test('nothing is published unless every job that runs the suite in publish.yml has passed, each on a clean install', async () => {
  // The publishing job waits for them directly or through a job that needs
  // them; either way, played out, it must not start when one of them failed,
  // was cancelled or never ran, and must start when all of them passed.
  const { doc, id } = await publishJob();
  const suite = Object.keys(doc.jobs).filter((name) => runsTheSuite(doc.jobs[name]));
  assert.ok(suite.length > 0, 'publish.yml should run the suite before it publishes');

  for (const name of suite) {
    const steps = stepsOfJob(doc.jobs[name]);
    const installAt = steps.findIndex((step) => /\bnpm ci\b/.test(runOf(step)));
    const suiteAt = steps.findIndex((step) => suiteCommandsIn(step, doc.jobs[name], doc).length > 0);
    assert.ok(installAt >= 0 && installAt < suiteAt, `${name} should run \`npm ci\` before it runs the suite`);
  }

  const passing = Object.fromEntries(suite.map((name) => [name, 'success']));
  assert.equal(outcome(doc, id, passing, { held: id }), 'started', `${id} should publish once every job that runs the suite passed`);
  for (const name of suite) {
    for (const { result, cancelled, says } of NOT_PASSED) {
      assert.equal(outcome(doc, id, { ...passing, [name]: result }, { cancelled, held: id }), 'skipped', `${id} publishes although ${name} ${says}`);
    }
  }
});

/** That publish.yml runs every shard of the suite on `node`, and that its publishing job waits for each of them. */
async function releaseRunsEveryShardOn(node, which) {
  const { doc, id } = await publishJob();
  const runs = readRuns(doc, 'publish.yml');
  const onNode = runs.filter((run) => String(run.node) === node);
  assert.ok(onNode.length > 0, `publish.yml should run the suite on ${which} ${node}, got Nodes: ${[...byNode(runs).keys()].join(', ') || 'none'}`);
  assert.deepEqual(shardGaps(onNode), [], `publish.yml does not run every shard on ${which} ${node}`);

  const before = ancestorsOf(doc, id);
  const missing = [...new Set(onNode.map((run) => run.id))].filter((name) => !before.has(name));
  assert.deepEqual(missing, [], `${id} should need ${missing.join(', ')}, which run the suite on ${which} ${node}`);
}

test('the floor engines.node promises is still checked before every release: publish.yml runs every shard of the suite on it, and the publish job needs them all', async () => {
  // The owner (#364): pull requests no longer run the floor, so the release is
  // where the promise to users on the oldest supported Node is kept.
  await releaseRunsEveryShardOn(await engineFloor(), 'the floor');
});

/**
 * The files a workflow runs on Node `floor`, out of `files` (paths relative to
 * the repo): what the package.json scripts that its jobs on that Node run hand
 * `node --test`. Read from the workflow, so no list kept here can drift from it.
 */
function floorTestFiles(doc, pkg, files, floor) {
  const scripts = new Set();
  for (const job of jobsOf(doc).filter((entry) => nodeVersionsOf(entry).map(String).includes(floor))) {
    for (const command of stepsOfJob(job).flatMap((step) => suiteCommandsIn(step, job, doc))) scripts.add(scriptOf(command));
  }
  assert.ok(scripts.size > 0, `no job runs the suite on the floor ${floor}`);
  const globs = [...scripts].flatMap((name) => {
    const script = pkg.scripts?.[name];
    assert.equal(typeof script, 'string', `a job on the floor ${floor} runs the ${name} script, and package.json has none`);
    return globsOf(script).map(globToRegExp);
  });
  return files.filter((rel) => globs.some((glob) => glob.test(rel)));
}

test('the check for the floor\'s files reads them from the scripts the jobs on the floor Node run, and from no other job', () => {
  const setup = (node) => ({ uses: 'actions/setup-node@x', with: { 'node-version': node } });
  const legs = { matrix: { shard: [1, 2, 3] } };
  const release = (floorRun) => ({
    jobs: {
      test: { strategy: legs, steps: [setup('25.8.0'), { run: 'npm ci' }, { run: 'npm run test:shard', env: { SHARD: '${{ matrix.shard }}/3' } }] },
      floor: { strategy: legs, steps: [setup('24.21.0'), { run: 'npm ci --omit=dev' }, { run: floorRun, env: { SHARD: '${{ matrix.shard }}/3' } }] },
      publish: { needs: ['test', 'floor'], steps: [{ run: 'npm publish' }] },
    },
  });
  const pkg = {
    scripts: {
      test: 'node --test test/*.test.js test/dev/*.test.js',
      'test:shard': 'node --test --test-shard=$SHARD test/*.test.js test/dev/*.test.js',
      'test:floor': 'node --test --test-shard=$SHARD test/*.test.js',
    },
  };
  const files = ['src/cli.js', 'test/a.test.js', 'test/b.test.js', 'test/dev/c.test.js', 'test/helpers/d.js', 'test/system/e.test.js'];

  assert.deepEqual(floorTestFiles(release('npm run test:floor'), pkg, files, '24.21.0'), ['test/a.test.js', 'test/b.test.js'], 'the floor job runs test:floor');
  assert.deepEqual(floorTestFiles(release('npm run test:shard'), pkg, files, '24.21.0'), ['test/a.test.js', 'test/b.test.js', 'test/dev/c.test.js'], 'the floor job runs test:shard');
  assert.deepEqual(floorTestFiles(release('npm test'), pkg, files, '24.21.0'), ['test/a.test.js', 'test/b.test.js', 'test/dev/c.test.js'], 'the floor job runs npm test');
  assert.throws(() => floorTestFiles(release('npm run test:floor'), { scripts: { test: pkg.scripts.test } }, files, '24.21.0'), /test:floor/, 'no test:floor script');
  assert.throws(() => floorTestFiles(release('npm run test:floor'), pkg, files, '22.0.0'), /22\.0\.0/, 'no job on that Node');
});

test('on the floor, publish.yml runs every file of the suite but those under test/dev/', async () => {
  // The floor still checks the whole promise to users (#364), less only the
  // tests that need the dev dependencies a user does not install (#533).
  const pkg = await readPackage();
  const files = await repoFiles();
  const suite = testGlobsOf(pkg).map(globToRegExp);
  const want = files.filter((rel) => suite.some((glob) => glob.test(rel)) && !rel.startsWith(DEV_TESTS));
  assert.ok(want.length > 0, 'the suite should have files the floor runs');
  const floor = await engineFloor();

  assert.deepEqual(floorTestFiles(await publishWorkflow(), pkg, files, floor), want,
    `publish.yml should run on the floor ${floor} the files of package.json's test script, less those under ${DEV_TESTS}`);
});

test('a release also runs every shard of the suite on the Node pull requests run on, and the publish job needs them all', async () => {
  // The same Node a pull request was checked on, against the commit the release
  // points at: a merge into a main no pull request ran against is caught here.
  for (const node of new Set(await ciNodeVersions())) await releaseRunsEveryShardOn(node, 'the pull requests\' Node');
});

test('pull requests and releases split the suite across parallel jobs', async () => {
  // The owner (#364): "i need more parallel". One job running the whole suite
  // took three quarters of an hour; each shard is a job of its own, or a leg of
  // a matrix, so they run side by side.
  const named = [['the pull request workflow', await ciWorkflow()], ['publish.yml', await publishWorkflow()]];
  for (const [name, doc] of named) {
    const groups = byNode(readRuns(doc, name));
    assert.ok(groups.size > 0, `${name} should run the suite`);
    for (const [node, runs] of groups) {
      assert.ok(
        runs.every((run) => run.total > 1),
        `${name} runs the suite on Node ${node} in one piece; split it with \`npm run test:shard\` and SHARD=<index>/<total>`,
      );
      const jobs = new Set(runs.map((run) => `${run.id} ${run.leg}`));
      assert.equal(jobs.size, runs.length, `${name} runs shards on Node ${node} one after another in the same job`);
    }
  }
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

// The machine's own `obk` (#220): plain `obk` on a developer's machine is the
// published release, the one their own fleet runs, and nothing in this repo
// changes it. `npm link` did, for one live run, and every hook in the owner's
// real bots ran a checkout until it was put back. So no script this repo runs
// links the checkout or installs anything globally.

const scriptsDir = path.join(repoRoot, 'scripts');

/**
 * Whether a command line, or a line of a script, changes what the machine has
 * installed for everyone: `npm link` or its alias `npm ln`, and an install,
 * uninstall or update, in any spelling npm takes, with `-g`, `--global` or
 * `--location=global`.
 */
const NPM_CHANGES = String.raw`\b(?:install|i|add|uninstall|un|remove|rm|update|up|upgrade)\b`;
const GLOBALLY = String.raw`(?:\s-g\b|--global\b|--location[= ]global\b|['"]-g['"]|['"]--global['"])`;
const changesTheMachine = (line) => /\bnpm\b.*\b(?:link|ln)\b/.test(line)
  || new RegExp(String.raw`\bnpm\b.*${NPM_CHANGES}.*${GLOBALLY}`).test(line)
  || new RegExp(String.raw`\bnpm\b.*${GLOBALLY}.*${NPM_CHANGES}`).test(line);

/**
 * The code of a script with its comments taken out, every line where it was:
 * a comment that mentions `npm link` runs nothing.
 */
const codeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, '')).replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

test('the check for a global change sees `npm link` and a global install, and not an ordinary install', () => {
  for (const line of [
    'npm link',
    'npm ln',
    'npm install -g @assuredloop/orca-bot-kit',
    'npm i --global @assuredloop/orca-bot-kit',
    'npm -g install @assuredloop/orca-bot-kit',
    'npm install --location=global .',
    'npm uninstall -g @assuredloop/orca-bot-kit',
    'npm update --global @assuredloop/orca-bot-kit',
    "spawnSync('npm', ['link'], { cwd: repoRoot });",
    "spawnSync('npm', ['install', '-g', 'pkg']);",
  ]) {
    assert.equal(changesTheMachine(line), true, `should be seen: ${line}`);
  }
  for (const line of [
    'npm ci',
    'npm install',
    'npm test',
    'node --test test/*.test.js',
    'node scripts/test-system.js',
    'npm run test:system -- --yes',
  ]) {
    assert.equal(changesTheMachine(line), false, `should not be seen: ${line}`);
  }
  assert.equal(codeOf('// run `npm link` first\nconst a = 1;').includes('npm link'), false, 'a comment is not code');
});

test('no package.json script links this checkout or installs anything globally', async () => {
  const scripts = (await readPackage()).scripts ?? {};
  assert.ok(Object.keys(scripts).length > 0, 'package.json should have scripts to check');

  const found = Object.entries(scripts).filter(([, command]) => changesTheMachine(command)).map(([name, command]) => `${name}: ${command}`);
  assert.deepEqual(found, [], `these change the machine's own obk:\n  ${found.join('\n  ')}`);
});

test('no script under scripts/ links this checkout or installs anything globally', async () => {
  const tree = await snapshot(scriptsDir);
  const files = Object.keys(tree).filter((rel) => tree[rel].startsWith('file:'));
  assert.ok(files.length > 0, 'there should be scripts to check');

  const found = [];
  for (const rel of files) {
    const lines = codeOf(await readFile(path.join(scriptsDir, rel), 'utf8')).split('\n');
    lines.forEach((line, at) => {
      if (changesTheMachine(line)) found.push(`scripts/${rel}:${at + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(found, [], `these change the machine's own obk:\n  ${found.join('\n  ')}`);
});

// The system-test gate (#328): a system test drives the real Orca only when
// `npm run test:system -- --yes` started it. Loading a node:test file runs it,
// so every other way in — `node --test <file>`, `node -e "import('<file>')"`, an
// editor's runner — ran it against the real Orca too, and once did (#318). The
// gate is test/helpers/system.js, whose `test` skips unless the runner started
// the file; it holds for a system test only when that is where its `test`
// comes from and nothing of node:test is loaded around it.

const systemHelper = path.join(repoRoot, 'test', 'helpers', 'system.js');

/**
 * Why a system test file is outside the gate, one reason each: empty when it is
 * inside. `file` is where it sits, since the helper's relative path from a
 * subfolder is not the one from test/system/ itself.
 */
function outsideTheGate(source, file) {
  const code = codeOf(source);
  const reasons = [];
  if (/(['"`])node:test\1/.test(code)) reasons.push('it loads node:test itself');
  const takesTest = [...code.matchAll(/^\s*import\s+test\s+from\s+(['"])([^'"]+)\1/gm)]
    .some((match) => match[2].startsWith('.') && path.resolve(path.dirname(file), match[2]) === systemHelper);
  if (!takesTest) reasons.push('it does not take `test` from test/helpers/system.js');
  return reasons;
}

test('the check for the system-test gate sees node:test loaded any way, and finds the helper from any folder', () => {
  const top = path.join(systemTestsDir, 'a.test.js');
  const nested = path.join(systemTestsDir, 'group', 'b.test.js');
  const fromHelper = "import test from '../helpers/system.js';\n";

  assert.deepEqual(outsideTheGate(fromHelper, top), [], 'the helper, from test/system/');
  assert.deepEqual(outsideTheGate("import test from '../../helpers/system.js';\n", nested), [], 'the helper, from a folder under it');
  assert.deepEqual(outsideTheGate(`${fromHelper}// never 'node:test' here: it runs on load\n`, top), [], 'the word in a comment');

  assert.notDeepEqual(outsideTheGate(fromHelper, nested), [], 'from a folder down, ../helpers/system.js is not the helper');
  assert.notDeepEqual(outsideTheGate("import assert from 'node:assert/strict';\n", top), [], 'no `test` from the helper at all');
  assert.notDeepEqual(outsideTheGate("import test from './helpers/system.js';\n", top), [], 'a helper of the same name somewhere else');
  for (const loads of [
    "import test from 'node:test';",
    'import { describe } from "node:test";',
    "const { test: raw } = await import('node:test');",
    "const { test: raw } = process.getBuiltinModule('node:test');",
  ]) {
    assert.notDeepEqual(outsideTheGate(`${fromHelper}${loads}\n`, top), [], `should be seen: ${loads}`);
  }
});

test('every system test takes its `test` from test/helpers/system.js, and none loads node:test itself', async () => {
  const tree = await snapshot(systemTestsDir);
  const files = Object.keys(tree).filter((rel) => rel.endsWith('.test.js') && tree[rel].startsWith('file:'));
  assert.ok(files.length > 0, 'there should be system tests to check');

  const found = [];
  for (const rel of files) {
    const file = path.join(systemTestsDir, rel);
    const reasons = outsideTheGate(await readFile(file, 'utf8'), file);
    if (reasons.length > 0) found.push(`test/system/${rel}: ${reasons.join('; ')}`);
  }
  assert.deepEqual(
    found,
    [],
    'these run against the real Orca however they are loaded, not only under `npm run test:system -- --yes`;'
    + ` import test from the helper instead:\n  ${found.join('\n  ')}`,
  );
});

// What the floor needs (#533): the release's floor job installs only what a
// user installs, `npm ci --omit=dev`, and runs the test files its script
// names. A file there that imports a dev dependency fails to load, and only
// the release finds out, since pull requests do not run the floor. So this
// reads, in every pull request, each file the floor runs and every file it
// reaches through a relative import, and finds each package one of them
// imports statically that is neither Node's own nor in `dependencies`. An
// `import()` at run time is left alone: a file can check that a package is
// there before it loads it (test-system.test.js does, for smol-toml).

// V8 reads the imports, not a pattern over the text (review of #533): a
// child Node parses each file as a module, `vm.SourceTextModule`, and lists
// its `moduleRequests`. Parsing runs none of the file. The class needs
// --experimental-vm-modules, so it runs in a child, whose warning about the
// flag stays in the child's stderr.
const STATIC_IMPORTS = `
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const found = {};
for (const file of JSON.parse(readFileSync(0, 'utf8'))) {
  const module = new vm.SourceTextModule(readFileSync(file, 'utf8'), { identifier: file });
  found[file] = module.moduleRequests.map((request) => request.specifier);
}
process.stdout.write(JSON.stringify(found));
`;

/**
 * Every specifier each of `files` (absolute paths) imports statically, as
 * Node parses it: `import … from`, `import '…'` and `export … from`, and not
 * `import(…)`, which runs only when the code does. A file that does not parse
 * fails the check, naming the file.
 */
function staticImportsOf(files) {
  if (files.length === 0) return {};
  const done = spawnSync(process.execPath, ['--experimental-vm-modules', '-e', STATIC_IMPORTS], {
    input: JSON.stringify(files),
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.equal(done.status, 0, `the files' imports could not be read:\n${done.stderr}`);
  return JSON.parse(done.stdout);
}

/** The package a bare specifier names: `yaml/util` is yaml, `@scope/name/x` is @scope/name. */
const packageOf = (specifier) => specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');

/**
 * Each `{ file, package }` where a file that `entries` reach (paths relative to
 * `root`, followed through relative imports) imports a package that is neither
 * one of Node's own modules nor one of `dependencies`. Only JavaScript files
 * are read: a JSON file imports nothing. A relative import of a file that is
 * not there is left to Node, which fails to load it anywhere.
 */
async function importsBeyond(root, entries, dependencies) {
  const seen = new Set();
  const found = [];
  // One child Node for each step out from the entries, not one for each file.
  for (let next = [...new Set(entries)]; next.length > 0;) {
    for (const rel of next) seen.add(rel);
    const read = next.filter((rel) => /\.m?js$/.test(rel) && existsSync(path.join(root, rel)));
    const imports = staticImportsOf(read.map((rel) => path.join(root, rel)));
    const reached = [];
    for (const rel of read) {
      for (const specifier of imports[path.join(root, rel)]) {
        if (specifier.startsWith('./') || specifier.startsWith('../')) {
          reached.push(path.relative(root, path.resolve(root, path.dirname(rel), specifier)).split(path.sep).join('/'));
        } else if (!isBuiltin(specifier) && !dependencies.includes(packageOf(specifier))) {
          found.push({ file: rel, package: packageOf(specifier) });
        }
      }
    }
    next = [...new Set(reached)].filter((rel) => !seen.has(rel));
  }
  return found;
}

test('the check for what the floor needs sees a dev dependency imported by a floor file, or by a file it reaches, and passes one that needs only what a user installs', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'obk-floor-imports-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = {
    // Imports a dev dependency itself.
    'test/direct.test.js': "import assert from 'node:assert/strict';\nimport { parse } from 'smol-toml';\n",
    // Reaches one through a helper, which reaches another through src/.
    'test/through.test.js': "import test from 'node:test';\n\nimport { parse } from './helpers/toml.js';\n",
    'test/helpers/toml.js': "import fs from 'fs';\nimport {\n  parse,\n} from 'smol-toml';\n\nexport { lib } from '../../src/lib.js';\nexport { parse };\n",
    'src/lib.js': "export * from '@scope/dev-thing/sub';\nexport const lib = 1;\n",
    // Needs only Node and the dependencies; names smol-toml only where nothing loads it statically.
    'test/clean.test.js': [
      "import { readFile } from 'node:fs/promises';",
      "import os from 'os';",
      "import test from 'node:test';",
      "import YAML, { parse } from 'yaml';",
      "import { isMap } from 'yaml/util';",
      "import './helpers/clean.js';",
      "// import { parse } from 'smol-toml';",
      '/*',
      "import { parse } from 'smol-toml';",
      '*/',
      "const said = \"import { parse } from 'smol-toml'\";",
      "const where = import.meta.resolve('smol-toml');",
      "test('loads it at run time', async () => {",
      "  await import('smol-toml');",
      "import('smol-toml');",
      '});',
      '',
    ].join('\n'),
    'test/helpers/clean.js': "export { stringify } from 'yaml';\nexport const ok = 1;\n",
    // Import dev dependencies, and are reached by no file the floor runs.
    'test/dev/premises.test.js': "import { parse } from 'smol-toml';\n",
    'test/helpers/unused.js': "import { parse } from 'smol-toml';\n",
    // Read as Node reads them (review of #533): two imports on one line, an
    // import between strings that hold comment marks, and import text that is
    // only a template literal's.
    'test/one-line.test.js': "import assert from 'node:assert/strict'; import { parse } from 'smol-toml';\n",
    'test/marks-in-strings.test.js': "const open = '/*';\nimport { parse } from 'smol-toml';\nconst close = '*/';\n",
    'test/in-template.test.js': "import test from 'node:test';\nconst fixture = `\nimport { parse } from 'smol-toml';\n`;\ntest('fixture text', () => {});\n",
  };
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), text);
  }
  const byFile = (left, right) => (left.file < right.file ? -1 : 1);

  assert.deepEqual(await importsBeyond(root, ['test/clean.test.js'], ['yaml']), [], 'the clean file');
  assert.deepEqual(await importsBeyond(root, ['test/direct.test.js'], ['yaml']), [{ file: 'test/direct.test.js', package: 'smol-toml' }], 'a direct import');
  assert.deepEqual((await importsBeyond(root, ['test/through.test.js'], ['yaml'])).sort(byFile), [
    { file: 'src/lib.js', package: '@scope/dev-thing' },
    { file: 'test/helpers/toml.js', package: 'smol-toml' },
  ], 'through a helper, and through src/ after it');
  assert.deepEqual((await importsBeyond(root, ['test/clean.test.js', 'test/direct.test.js', 'test/through.test.js'], ['yaml'])).sort(byFile), [
    { file: 'src/lib.js', package: '@scope/dev-thing' },
    { file: 'test/direct.test.js', package: 'smol-toml' },
    { file: 'test/helpers/toml.js', package: 'smol-toml' },
  ], 'all three together');
  assert.deepEqual(await importsBeyond(root, ['test/direct.test.js', 'test/through.test.js'], ['yaml', 'smol-toml', '@scope/dev-thing']), [], 'the same packages, as dependencies');

  const alone = (rel) => importsBeyond(root, [rel], ['yaml']);
  assert.deepEqual({
    'two imports on one line': await alone('test/one-line.test.js'),
    'an import between strings that hold comment marks': await alone('test/marks-in-strings.test.js'),
    'import text in a template literal': await alone('test/in-template.test.js'),
  }, {
    'two imports on one line': [{ file: 'test/one-line.test.js', package: 'smol-toml' }],
    'an import between strings that hold comment marks': [{ file: 'test/marks-in-strings.test.js', package: 'smol-toml' }],
    'import text in a template literal': [],
  }, 'the static imports Node sees, and no others');
});

test('no test file the floor runs, nor any file it reaches by a relative import, statically imports a package a user does not install', async () => {
  // The floor's files are read from publish.yml's jobs on the floor Node, and
  // what a user installs from package.json's dependencies.
  const pkg = await readPackage();
  const floorFiles = floorTestFiles(await publishWorkflow(), pkg, await repoFiles(), await engineFloor());
  assert.ok(floorFiles.length > 0, 'the floor should run test files');

  const found = await importsBeyond(repoRoot, floorFiles, Object.keys(pkg.dependencies ?? {}));
  assert.deepEqual(
    found.map((one) => `${one.file} imports ${one.package}`),
    [],
    'the floor installs only package.json\'s dependencies (npm ci --omit=dev), so these fail to load there;'
    + ` move what imports it to a test under ${DEV_TESTS}, which the floor does not run, or check for the package at run time:\n  ${found.map((one) => `${one.file} imports ${one.package}`).join('\n  ')}`,
  );
});
