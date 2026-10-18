// AssuredLoop in CI, and installed one pinned way (#495). AssuredLoop 0.1.0 is
// on npm as @assuredloop/cli, and its skill ships inside the package. So
// AGENTS.md names that package at 0.1.0 in place of a git clone, and every pull
// request runs `al check --strict` from the same pinned install. `al check`
// reads the tier from the commit history, so the checkout fetches all of it.
//
// The new check is found by what it does, a step that runs `al check --strict`,
// and not by its name. Whether the other jobs and publish.yml are byte for byte
// what they were is a property of the change, left to the review of the diff:
// a test of it would forbid every later edit. What is tested here is that the
// check did not move into them.
//
// The global al on a shared machine is not this repo's to choose (#616): other
// projects need a newer one, which does not read this repo's 0.1.0 records. So
// AGENTS.md gives no global install of the package, gives a way to run 0.1.0
// that installs nothing globally (npx, npm exec, a dlx or an install of its
// own), and leads to the skill of 0.1.0, not to the one in the global npm
// folder. CI keeps its own global install, on a machine of its own. The tests
// read the commands AGENTS.md gives, not its words: any of those ways passes.
//
// Where auto mode refuses npx as code from outside (#641), a session runs a
// local install of 0.1.0 instead: one into a folder of its own, not the global
// one. So AGENTS.md gives both kinds as allowed ways, a run through npx (or npm
// exec, or a dlx) and a local install. The two are told apart by what the
// command does, a run or an install, and not by the words around them. The
// print command for the skill stays.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import { repoRoot } from './helpers/cli.js';

const PACKAGE = '@assuredloop/cli';
const VERSION = '0.1.0';
const SKILL_FILE = 'skills/assuredloop/SKILL.md';
const OLD_COMMIT = '056d24c';

const readText = (rel) => readFile(path.join(repoRoot, rel), 'utf8');
const readWorkflow = async (name) => parse(await readText(path.join('.github', 'workflows', name)));

/** The AssuredLoop section of AGENTS.md: its heading down to the next one. */
async function assuredLoopSection() {
  const text = await readText('AGENTS.md');
  const start = text.search(/^## .*AssuredLoop/m);
  assert.ok(start >= 0, 'AGENTS.md should keep a section headed AssuredLoop');
  const rest = text.slice(start + 1);
  const end = rest.search(/^## /m);
  return end < 0 ? text.slice(start) : text.slice(start, start + 1 + end);
}

/**
 * Every version a text gives the package: what follows `@assuredloop/cli@`, up
 * to a `/`, so that a URL into the package at a version gives that version.
 */
const specsIn = (text) => [...text.matchAll(/@assuredloop\/cli@([^\s`'"(),[\]/]+)/g)].map((match) => match[1].replace(/\.$/, ''));

/** Whether a text names 0.1.0 as a whole version, not as part of 10.1.0 or 0.1.0-beta. */
const namesTheVersion = (text) => /(?:^|[^\w.^~<>=-])v?0\.1\.0(?![\w-]|\.\d)/.test(text);

const jobsOf = (doc) => doc?.jobs ?? {};
const stepsOf = (job) => job?.steps ?? [];
const needsOf = (job) => [job?.needs ?? []].flat();
const runOf = (step) => (typeof step?.run === 'string' ? step.run : '');
/** The events a workflow runs on, however `on` is written. */
function triggersOf(doc) {
  const on = doc?.on;
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on;
  return Object.keys(on ?? {});
}

/**
 * The commands a `run` holds, one for each line or each part of a line between
 * `&&`, `||`, `;` and `|`, as words. Env settings in front are dropped, and so
 * is a comment. A line broken with a backslash is one line.
 */
function commandsIn(run) {
  const commands = [];
  for (const line of run.replace(/\\\n/g, ' ').split('\n')) {
    for (const part of line.replace(/(^|\s)#.*$/, '').split(/&&|\|\||;|\|/)) {
      const words = part.trim().split(/\s+/).filter(Boolean);
      while (/^[A-Za-z_]\w*=/.test(words[0] ?? '')) words.shift();
      if (words.length > 0) commands.push(words);
    }
  }
  return commands;
}

/** Whether a command is `al check` with `--strict`, with or without a `!` in front. */
function isStrictCheck(words) {
  const at = words[0] === '!' ? 1 : 0;
  return words[at] === 'al' && words[at + 1] === 'check' && words.slice(at + 2).includes('--strict');
}

/** Whether a step's `run` runs `al check --strict`. */
const runsStrictCheck = (step) => commandsIn(runOf(step)).some(isStrictCheck);

/** Whether a command is an npm install into the global folder. */
function isGlobalInstall(words) {
  if (words[0] !== 'npm') return false;
  const rest = words.slice(1);
  const verb = rest.find((word) => !word.startsWith('-'));
  const global = rest.some((word) => ['-g', '--global', '--location=global'].includes(word));
  return ['install', 'i', 'add'].includes(verb) && global;
}

/** Whether words name AssuredLoop's CLI as a package, at any version or none. */
const namesPackage = (words) => words.some((word) => word === PACKAGE || word.startsWith(`${PACKAGE}@`));

/**
 * Whether a command installs AssuredLoop's CLI into the global folder: with
 * npm, or with pnpm, yarn or bun, which have global installs of their own.
 */
function installsPackageGlobally(words) {
  if (!namesPackage(words)) return false;
  if (isGlobalInstall(words)) return true;
  const verbs = words.filter((word) => !word.startsWith('-'));
  const global = words.some((word) => ['-g', '--global'].includes(word));
  if (['pnpm', 'bun'].includes(words[0])) return ['add', 'install', 'i'].includes(verbs[1]) && global;
  if (words[0] === 'yarn') return verbs[1] === 'global' && verbs[2] === 'add';
  return false;
}

/**
 * Whether a command gets AssuredLoop's CLI at 0.1.0 exactly with nothing
 * installed globally: run through npx, npm exec, a dlx and the like, or
 * installed into a folder of its own. The command may sit in an alias or a
 * shell function: quotes, braces and a `name=` in front of a word are dropped.
 */
function getsPinnedWithoutGlobal(words) {
  const plain = words.map((word) => word.replace(/^[\w-]*=/, '').replace(/^['"({]+|['";)}]+$/g, ''));
  if (plain[0] === 'echo' || installsPackageGlobally(plain)) return false;
  const at = plain.findIndex((word, i) => ['npx', 'pnpx', 'bunx'].includes(word)
    || (['npm', 'pnpm', 'yarn'].includes(word) && ['exec', 'x', 'dlx', 'install', 'i', 'add'].includes(plain[i + 1])));
  return at >= 0 && plain.slice(at).includes(`${PACKAGE}@${VERSION}`);
}

/** The flags of npm, pnpm, yarn and bun that take the next word as their value. */
const FLAGS_WITH_VALUE = ['--prefix', '-C', '--dir', '--cwd', '--location'];

/**
 * A command's words with the wrapping of an alias or a shell function dropped:
 * quotes, braces and a `name=` in front. A flag such as `--prefix=.al` stays
 * whole, so it is not read as a verb.
 */
const unwrapped = (words) => words.map((word) => word.replace(/^\w[\w-]*=/, '').replace(/^['"({]+|['";)}]+$/g, ''));

/** Whether words name AssuredLoop's CLI at 0.1.0 exactly, alone or as a flag's value. */
const namesPinned = (words) => words.some((word) => word === `${PACKAGE}@${VERSION}` || word.endsWith(`=${PACKAGE}@${VERSION}`));

/**
 * The package manager a command calls (npm, pnpm, yarn or bun) and its verb:
 * the first word after it that is not a flag or a flag's value.
 * `--location global`, before or after the verb, gives no verb: the command
 * is a global one.
 */
function managerVerbOf(words) {
  const plain = unwrapped(words);
  const none = { plain, verb: undefined, rest: [] };
  if (plain[0] === 'echo') return none;
  const at = plain.findIndex((word) => ['npm', 'pnpm', 'yarn', 'bun'].includes(word));
  if (at < 0) return none;
  const rest = plain.slice(at + 1);
  if (rest.some((word, i) => word === '--location' && rest[i + 1] === 'global')) return none;
  for (let i = 0; i < rest.length; i += 1) {
    if (!rest[i].startsWith('-')) return { plain, verb: rest[i], rest };
    if (FLAGS_WITH_VALUE.includes(rest[i])) i += 1;
  }
  return none;
}

/**
 * Whether a command installs AssuredLoop's CLI at 0.1.0 exactly into a folder
 * that is not the global one: an npm, pnpm, yarn or bun install, with or
 * without --prefix. A run through npx, npm exec or a dlx is not an install.
 */
function installsPinnedLocally(words) {
  const { plain, verb, rest } = managerVerbOf(words);
  if (!['install', 'i', 'add'].includes(verb) || installsPackageGlobally(plain)) return false;
  return namesPinned(rest);
}

/**
 * Whether a command runs AssuredLoop's CLI at 0.1.0 exactly through a runner
 * that installs nothing: npx, pnpx, bunx, or npm exec, npm x and a dlx. An
 * install is not a run.
 */
function runsPinnedThroughRunner(words) {
  const plain = unwrapped(words);
  if (plain[0] === 'echo') return false;
  const runner = plain.findIndex((word) => ['npx', 'pnpx', 'bunx'].includes(word));
  if (runner >= 0) return namesPinned(plain.slice(runner));
  const { verb, rest } = managerVerbOf(words);
  return ['exec', 'x', 'dlx'].includes(verb) && namesPinned(rest);
}

/**
 * The code a Markdown text holds, as commands: its fenced blocks line by line,
 * with a `$ ` prompt dropped, and each inline span as one line.
 */
function codeCommandsIn(markdown) {
  const code = [...markdown.matchAll(/```[^\n]*\n([\s\S]*?)```|`([^`]+)`/g)]
    .map((match) => (match[1] !== undefined ? match[1].replace(/^\s*\$ /gm, '') : match[2].replace(/\n/g, ' ')));
  return code.flatMap(commandsIn);
}

/**
 * The global installs of AssuredLoop's CLI that a Markdown text tells a reader
 * to run: each code span or block that holds one, unless its sentence says not
 * to (not, never, don't, instead of). A warning that names the command is not
 * an instruction to run it.
 */
function globalInstallsTold(markdown) {
  const found = [];
  const masked = markdown.replace(/```[\s\S]*?```|`[^`]*`/g, (code) => code.replace(/[^\n]/g, '_'));
  for (const match of markdown.matchAll(/```[^\n]*\n([\s\S]*?)```|`([^`]+)`/g)) {
    if (!codeCommandsIn(match[0]).some(installsPackageGlobally)) continue;
    const before = masked.slice(0, match.index);
    const after = masked.slice(match.index + match[0].length);
    const breaks = [...before.matchAll(/[.!?](?=\s)|\n\s*\n/g)];
    const from = breaks.length > 0 ? breaks.at(-1).index + breaks.at(-1)[0].length : 0;
    const to = after.search(/[.!?](?=\s|$)|\n\s*\n/);
    const sentence = before.slice(from) + (to < 0 ? after : after.slice(0, to));
    if (/\b(not|never|don't|instead of)\b/i.test(sentence)) continue;
    found.push(match[0]);
  }
  return found;
}

/**
 * The places a text reads npm's global folder: `npm root -g` or `npm prefix -g`,
 * however the flag is written, or an absolute path through lib/node_modules.
 */
function globalFoldersIn(text) {
  const found = [];
  for (const match of text.matchAll(/\bnpm((?:\s+-[-\w=]+)*\s+(?:root|prefix)\b[^)`'"\n]*)/g)) {
    if (/(^|\s)(-g|--global|--location=global)(?=\s|$)/.test(match[1])) found.push(match[0].trim());
  }
  for (const match of text.matchAll(/(?:^|[\s`'"(])(\/\S*?\/lib\/node_modules\/\S*)/g)) found.push(match[1]);
  return found;
}

/** The package specs a step's npm installs name for AssuredLoop's CLI. */
const installedSpecs = (step) => commandsIn(runOf(step))
  .filter((words) => words[0] === 'npm')
  .flatMap((words) => words.filter((word) => word === PACKAGE || word.startsWith(`${PACKAGE}@`)));

/** Whether a step installs AssuredLoop's CLI globally, at 0.1.0 exactly. */
const installsPinned = (step) => commandsIn(runOf(step))
  .some((words) => isGlobalInstall(words) && words.includes(`${PACKAGE}@${VERSION}`));

/** Whether a step mentions AssuredLoop's CLI at all: an `al` command or the package. */
const touchesAssuredLoop = (step) => runOf(step).includes(PACKAGE) || commandsIn(runOf(step)).some((words) => words[0] === 'al');

/**
 * The ways a step lets a failing `al check --strict` pass, one line each: an
 * `||` or a pipe after it, a `!` in front, `set +e`, or `continue-on-error`.
 */
function swallowsIn(step, job = {}) {
  const found = [];
  if (job['continue-on-error'] !== undefined && job['continue-on-error'] !== false) found.push('the job has continue-on-error');
  if (step['continue-on-error'] !== undefined && step['continue-on-error'] !== false) found.push('the step has continue-on-error');
  const run = runOf(step).replace(/\\\n/g, ' ');
  if (/(^|[\s;&|])set\s+\+e\b/m.test(run)) found.push('the run has set +e');
  for (const line of run.split('\n')) {
    const at = line.search(/(^|[\s;&|!(])al\s+check\b/);
    if (at < 0 || !commandsIn(line).some(isStrictCheck)) continue;
    const after = line.slice(at).replace(/\s#.*$/, '');
    if (/\|\|/.test(after)) found.push(`an || after it: ${line.trim()}`);
    else if (/\|/.test(after)) found.push(`a pipe after it: ${line.trim()}`);
    if (/(^|[;&|(])\s*!\s*al\s+check\b/.test(line)) found.push(`a ! in front of it: ${line.trim()}`);
  }
  return found;
}

const setupNodeOf = (job) => stepsOf(job).findIndex((step) => String(step?.uses ?? '').startsWith('actions/setup-node@'));
const checkoutOf = (job) => stepsOf(job).findIndex((step) => String(step?.uses ?? '').startsWith('actions/checkout@'));
/** Whether a job runs the suite, whole or a shard of it. */
const runsTheSuite = (job) => stepsOf(job).some((step) => commandsIn(runOf(step))
  .some((words) => words[0] === 'npm' && (words[1] === 'test' || (words[1] === 'run' && words[2] === 'test:shard'))));

/** The jobs in ci.yml that run `al check --strict`, as [id, job]. */
async function checkJobs() {
  const ci = await readWorkflow('ci.yml');
  return Object.entries(jobsOf(ci)).filter(([, job]) => stepsOf(job).some(runsStrictCheck));
}

/** The one job in ci.yml that runs `al check --strict`. */
async function checkJob() {
  const found = await checkJobs();
  assert.equal(
    found.length,
    1,
    `exactly one job in ci.yml should run \`al check --strict\`, got: ${found.map(([id]) => id).join(', ') || 'none'}`,
  );
  return found[0];
}

test('the check for `al check --strict` sees it run, and not an echo of it or a check without --strict', () => {
  const sees = (run) => runsStrictCheck({ run });
  assert.equal(sees('al check --strict'), true);
  assert.equal(sees('al check --strict --json'), true, 'other flags may come with it');
  assert.equal(sees('npm ci\nal check --strict'), true, 'on a later line');
  assert.equal(sees('cd repo && al check --strict'), true, 'after &&');
  assert.equal(sees('FOO=1 al check --strict'), true, 'with an env setting in front');
  assert.equal(sees('al check'), false, 'without --strict');
  assert.equal(sees('echo al check --strict'), false, 'an echo runs nothing');
  assert.equal(sees('# al check --strict'), false, 'a comment runs nothing');
  assert.equal(sees(''), false);
});

test('the check for a swallowed exit code sees ||, a pipe, !, set +e and continue-on-error, and not a plain run', () => {
  const swallows = (step, job) => swallowsIn(step, job).length > 0;
  assert.equal(swallows({ run: 'al check --strict' }), false, 'a plain run');
  assert.equal(swallows({ run: 'set -e\nal check --strict' }), false, 'set -e');
  assert.equal(swallows({ run: 'npm ci || exit 1\nal check --strict' }), false, 'an || on another line');
  assert.equal(swallows({ run: 'al check --strict || true' }), true, '|| true');
  assert.equal(swallows({ run: 'al check --strict || :' }), true, '|| :');
  assert.equal(swallows({ run: 'al check --strict | tee out.txt' }), true, 'a pipe');
  assert.equal(swallows({ run: '! al check --strict' }), true, 'a ! in front');
  assert.equal(swallows({ run: 'set +e\nal check --strict' }), true, 'set +e');
  assert.equal(swallows({ run: 'al check --strict', 'continue-on-error': true }), true, 'continue-on-error on the step');
  assert.equal(swallows({ run: 'al check --strict' }, { 'continue-on-error': true }), true, 'continue-on-error on the job');
});

test('the check for the install sees a global npm install at 0.1.0 exactly, and not a range, a tag or a local install', () => {
  const pinned = (run) => installsPinned({ run });
  assert.equal(pinned('npm install --global @assuredloop/cli@0.1.0'), true);
  assert.equal(pinned('npm install -g @assuredloop/cli@0.1.0'), true);
  assert.equal(pinned('npm i -g @assuredloop/cli@0.1.0'), true);
  assert.equal(pinned('npm install --global @assuredloop/cli'), false, 'no version');
  assert.equal(pinned('npm install --global @assuredloop/cli@latest'), false, 'a tag');
  assert.equal(pinned('npm install --global @assuredloop/cli@^0.1.0'), false, 'a range');
  assert.equal(pinned('npm install --global @assuredloop/cli@0.1'), false, 'part of a version');
  assert.equal(pinned('npm install @assuredloop/cli@0.1.0'), false, 'not global');
  assert.equal(pinned('echo npm install --global @assuredloop/cli@0.1.0'), false, 'an echo installs nothing');
});

test('the versions read from a text stop at a slash, so a URL into the package at 0.1.0 gives 0.1.0', () => {
  assert.deepEqual(specsIn('https://unpkg.com/@assuredloop/cli@0.1.0/skills/assuredloop/SKILL.md'), ['0.1.0']);
  assert.deepEqual(specsIn('`npx -y @assuredloop/cli@0.1.0 context`'), ['0.1.0']);
  assert.deepEqual(specsIn('`npm install --global @assuredloop/cli@0.1.0`.'), ['0.1.0'], 'a full stop after it is not part of it');
  assert.deepEqual(specsIn('`npx @assuredloop/cli@latest`'), ['latest']);
  assert.deepEqual(specsIn('@assuredloop/cli@^0.1.0'), ['^0.1.0']);
  assert.deepEqual(specsIn('@assuredloop/cli with no version'), []);
});

test('the check for a global install of the package sees npm, pnpm, yarn and bun installs into the global folder, and not a local install or a run', () => {
  const global = (run) => commandsIn(run).some(installsPackageGlobally);
  assert.equal(global('npm install --global @assuredloop/cli@0.1.0'), true);
  assert.equal(global('npm i -g @assuredloop/cli'), true, 'at no version');
  assert.equal(global('npm install --location=global @assuredloop/cli@0.3.0'), true, 'at another version');
  assert.equal(global('pnpm add -g @assuredloop/cli@0.1.0'), true);
  assert.equal(global('yarn global add @assuredloop/cli@0.1.0'), true);
  assert.equal(global('bun add --global @assuredloop/cli@0.1.0'), true);
  assert.equal(global('npm install --global @assuredloop/orca-bot-kit'), false, 'the kit is another package');
  assert.equal(global('npm install @assuredloop/cli@0.1.0'), false, 'not global');
  assert.equal(global('npm install --prefix .al @assuredloop/cli@0.1.0'), false, 'into a folder of its own');
  assert.equal(global('npx -y @assuredloop/cli@0.1.0 context'), false, 'a run installs nothing globally');
});

test('the check for a run of 0.1.0 sees npx, npm exec, a dlx and an install of its own at 0.1.0 exactly, and not a global install, another version or an echo', () => {
  const runs = (run) => commandsIn(run).some(getsPinnedWithoutGlobal);
  assert.equal(runs('npx @assuredloop/cli@0.1.0 context'), true);
  assert.equal(runs('npx -y @assuredloop/cli@0.1.0 context'), true);
  assert.equal(runs('npx --package @assuredloop/cli@0.1.0 al context'), true);
  assert.equal(runs('npm exec --package=@assuredloop/cli@0.1.0 -- al context'), true);
  assert.equal(runs('npm x -y @assuredloop/cli@0.1.0 -- check --strict'), true);
  assert.equal(runs('pnpm dlx @assuredloop/cli@0.1.0 context'), true);
  assert.equal(runs('npm install --prefix .al @assuredloop/cli@0.1.0'), true, 'an install of its own');
  assert.equal(runs("alias al='npx -y @assuredloop/cli@0.1.0'"), true, 'in an alias');
  assert.equal(runs('al() { npx -y @assuredloop/cli@0.1.0 "$@"; }'), true, 'in a shell function');
  assert.equal(runs('npm install --global @assuredloop/cli@0.1.0'), false, 'a global install');
  assert.equal(runs('npm i -g @assuredloop/cli@0.1.0'), false, 'a global install');
  assert.equal(runs('npx @assuredloop/cli context'), false, 'no version');
  assert.equal(runs('npx @assuredloop/cli@latest context'), false, 'a tag');
  assert.equal(runs('npx @assuredloop/cli@^0.1.0 context'), false, 'a range');
  assert.equal(runs('npx @assuredloop/cli@0.3.0 context'), false, 'another version');
  assert.equal(runs('echo npx @assuredloop/cli@0.1.0'), false, 'an echo runs nothing');
  assert.equal(runs('al context'), false, 'a bare al is whatever al the machine has');
});

test('the check for a local install sees an install of 0.1.0 exactly into a folder that is not the global one, and not a run, a global install, another version or an echo', () => {
  const installs = (run) => commandsIn(run).some(installsPinnedLocally);
  assert.equal(installs('npm install --prefix .al @assuredloop/cli@0.1.0'), true);
  assert.equal(installs('npm install --prefix ~/.al/0.1.0 @assuredloop/cli@0.1.0'), true, 'into a folder outside the repo');
  assert.equal(installs('npm --prefix .al install @assuredloop/cli@0.1.0'), true, 'with the flag before the verb');
  assert.equal(installs('npm i --prefix=.al @assuredloop/cli@0.1.0'), true, 'with --prefix=');
  assert.equal(installs('npm --prefix=.al install @assuredloop/cli@0.1.0'), true, 'with --prefix= before the verb');
  assert.equal(installs("alias al-install='npm install --prefix ~/.al @assuredloop/cli@0.1.0'"), true, 'in an alias');
  assert.equal(installs('npm install @assuredloop/cli@0.1.0'), true, 'without --prefix');
  assert.equal(installs('mkdir -p .al && npm install --prefix .al @assuredloop/cli@0.1.0'), true, 'after another command');
  assert.equal(installs('pnpm add --dir .al @assuredloop/cli@0.1.0'), true);
  assert.equal(installs('yarn add @assuredloop/cli@0.1.0'), true);
  assert.equal(installs('bun add --cwd .al @assuredloop/cli@0.1.0'), true);
  assert.equal(installs('npx -y @assuredloop/cli@0.1.0 context'), false, 'a run through npx installs nothing');
  assert.equal(installs('npm exec --package=@assuredloop/cli@0.1.0 -- al context'), false, 'a run through npm exec');
  assert.equal(installs('pnpm dlx @assuredloop/cli@0.1.0 context'), false, 'a run through a dlx');
  assert.equal(installs('npm install --global @assuredloop/cli@0.1.0'), false, 'a global install');
  assert.equal(installs('npm i -g --prefix .al @assuredloop/cli@0.1.0'), false, 'a global install, even with --prefix');
  assert.equal(installs('npm install --location=global @assuredloop/cli@0.1.0'), false, 'a global install');
  assert.equal(installs('npm install --location global @assuredloop/cli@0.1.0'), false, 'a global install');
  assert.equal(installs('yarn global add @assuredloop/cli@0.1.0'), false, 'a global install');
  assert.equal(installs('pnpm add -g @assuredloop/cli@0.1.0'), false, 'a global install');
  assert.equal(installs('npm install --prefix .al @assuredloop/cli'), false, 'no version');
  assert.equal(installs('npm install --prefix .al @assuredloop/cli@latest'), false, 'a tag');
  assert.equal(installs('npm install --prefix .al @assuredloop/cli@^0.1.0'), false, 'a range');
  assert.equal(installs('npm install --prefix .al @assuredloop/cli@0.3.0'), false, 'another version');
  assert.equal(installs('npm uninstall --prefix .al @assuredloop/cli@0.1.0'), false, 'an uninstall');
  assert.equal(installs('npm install --prefix .al @assuredloop/orca-bot-kit'), false, 'the kit is another package');
  assert.equal(installs('echo npm install --prefix .al @assuredloop/cli@0.1.0'), false, 'an echo installs nothing');
  assert.equal(installs('.al/node_modules/.bin/al context'), false, 'a run of the install is not the install');
});

test('the check for a run through npx sees npx, npm exec and a dlx of 0.1.0 exactly, and not a local install, a global install, another version or an echo', () => {
  const runs = (run) => commandsIn(run).some(runsPinnedThroughRunner);
  assert.equal(runs('npx -y @assuredloop/cli@0.1.0 context'), true);
  assert.equal(runs('npx --package @assuredloop/cli@0.1.0 al context'), true);
  assert.equal(runs("npx -y -p @assuredloop/cli@0.1.0 -c 'al context'"), true);
  assert.equal(runs('npx --package=@assuredloop/cli@0.1.0 al context'), true);
  assert.equal(runs('npm exec --package=@assuredloop/cli@0.1.0 -- al context'), true);
  assert.equal(runs('npm x -y @assuredloop/cli@0.1.0 -- check --strict'), true);
  assert.equal(runs('pnpm dlx @assuredloop/cli@0.1.0 context'), true);
  assert.equal(runs('yarn dlx @assuredloop/cli@0.1.0 context'), true);
  assert.equal(runs('bunx @assuredloop/cli@0.1.0 context'), true);
  assert.equal(runs("alias al='npx -y @assuredloop/cli@0.1.0'"), true, 'in an alias');
  assert.equal(runs('npm install --prefix .al @assuredloop/cli@0.1.0'), false, 'an install is not a run');
  assert.equal(runs('npm install --global @assuredloop/cli@0.1.0'), false, 'a global install');
  assert.equal(runs('npx @assuredloop/cli context'), false, 'no version');
  assert.equal(runs('npx @assuredloop/cli@latest context'), false, 'a tag');
  assert.equal(runs('npx @assuredloop/cli@0.3.0 context'), false, 'another version');
  assert.equal(runs('echo npx @assuredloop/cli@0.1.0'), false, 'an echo runs nothing');
  assert.equal(runs('al context'), false, 'a bare al is whatever al the machine has');
});

test('the check for a global install AGENTS.md tells a reader to run sees one in code, and not one in a warning or a run', () => {
  assert.deepEqual(globalInstallsTold('Install it:\n`npm install --global @assuredloop/cli@0.1.0`.'), ['`npm install --global @assuredloop/cli@0.1.0`']);
  assert.deepEqual(globalInstallsTold('Run this first.\n\n```sh\n$ npm i -g @assuredloop/cli@0.1.0\n```\n'), ['```sh\n$ npm i -g @assuredloop/cli@0.1.0\n```']);
  assert.deepEqual(globalInstallsTold('Never run `npm install --global @assuredloop/cli@0.1.0`: other projects need theirs.'), [], 'a warning');
  assert.deepEqual(globalInstallsTold('Do not run `npm i -g @assuredloop/cli`. Run `npx -y @assuredloop/cli@0.1.0` instead.'), [], 'a warning, then a run');
  assert.deepEqual(globalInstallsTold('Use `npx -y @assuredloop/cli@0.1.0 context`.'), [], 'a run');
  assert.deepEqual(globalInstallsTold('Install the kit: `npm install -g @assuredloop/orca-bot-kit`.'), [], 'the kit is another package');
});

test('the check for the global npm folder sees `npm root -g` and a path through lib/node_modules, and not a local root or a URL', () => {
  const global = (text) => globalFoldersIn(text).length > 0;
  assert.equal(global('read $(npm root -g)/@assuredloop/cli/skills/assuredloop/SKILL.md'), true);
  assert.equal(global('`$(npm root --global)/@assuredloop/cli`'), true);
  assert.equal(global('`$(npm -g root)/@assuredloop/cli`'), true, 'the flag in front');
  assert.equal(global('`$(npm prefix -g)/lib/node_modules/@assuredloop/cli`'), true);
  assert.equal(global('read /opt/homebrew/lib/node_modules/@assuredloop/cli/skills/assuredloop/SKILL.md'), true);
  assert.equal(global('read `/usr/local/lib/node_modules/@assuredloop/cli/skills/assuredloop/SKILL.md`'), true);
  assert.equal(global('read $(npm root)/@assuredloop/cli/skills/assuredloop/SKILL.md'), false, 'the local root');
  assert.equal(global('read https://unpkg.com/@assuredloop/cli@0.1.0/skills/assuredloop/SKILL.md'), false, 'a URL at 0.1.0');
  assert.equal(global('read .al/node_modules/@assuredloop/cli/skills/assuredloop/SKILL.md'), false, 'a folder of its own');
  assert.equal(global('`npx -y @assuredloop/cli@0.1.0 context`'), false);
});

test('AGENTS.md names the npm package @assuredloop/cli at exactly 0.1.0', async () => {
  const section = await assuredLoopSection();
  assert.ok(section.includes(PACKAGE), `the AssuredLoop section of AGENTS.md should name the package ${PACKAGE}`);
  assert.ok(namesTheVersion(section), `the AssuredLoop section of AGENTS.md should name the version ${VERSION}`);
  const other = specsIn(section).filter((spec) => spec !== VERSION);
  assert.deepEqual(other, [], `AGENTS.md should give ${PACKAGE} no version but ${VERSION}, not a range or a tag`);
});

test('AGENTS.md tells a session to install @assuredloop/cli globally nowhere: that would put the machine\'s al back to 0.1.0', async () => {
  const found = globalInstallsTold(await readText('AGENTS.md'));
  assert.deepEqual(
    found,
    [],
    `AGENTS.md should not tell a session to install ${PACKAGE} globally: the global al belongs to every project on the machine`,
  );
});

test('AGENTS.md gives a way to run al at exactly 0.1.0 that installs nothing globally', async () => {
  const section = await assuredLoopSection();
  const ways = codeCommandsIn(section).filter(getsPinnedWithoutGlobal);
  assert.ok(
    ways.length > 0,
    `the AssuredLoop section of AGENTS.md should give a command that runs ${PACKAGE}@${VERSION} with no global install, for example through npx`,
  );
});

// Both kinds are allowed (#641): a run through npx, and a local install where
// npx is refused. The test finds each by what its command does. Where the
// install goes, and how its al is run after it, is free, so long as it is not
// the global folder (the tests above).
test('AGENTS.md gives a local install of al at exactly 0.1.0, not into the global folder, as an allowed way', async () => {
  const section = await assuredLoopSection();
  const installs = codeCommandsIn(section).filter(installsPinnedLocally);
  assert.ok(
    installs.length > 0,
    `the AssuredLoop section of AGENTS.md should give a command that installs ${PACKAGE}@${VERSION} into a folder that is not the global one, for example \`npm install --prefix <dir> ${PACKAGE}@${VERSION}\``,
  );
});

test('AGENTS.md still gives a run of al at exactly 0.1.0 through npx, npm exec or a dlx', async () => {
  const section = await assuredLoopSection();
  const runs = codeCommandsIn(section).filter(runsPinnedThroughRunner);
  assert.ok(runs.length > 0, `the AssuredLoop section of AGENTS.md should still give a run of ${PACKAGE}@${VERSION} through npx, npm exec or a dlx`);
});

// The boundary of #641 keeps the command that prints the skill. How it reaches
// the file is free; a bare path to the file is not a command.
test('AGENTS.md still gives a command that prints the skill\'s file', async () => {
  const section = await assuredLoopSection();
  const spans = [...section.matchAll(/```[^\n]*\n([\s\S]*?)```|`([^`]+)`/g)].map((match) => match[0]);
  const prints = spans.filter((span) => span.includes(SKILL_FILE) && codeCommandsIn(span).some((words) => words.length > 1));
  assert.ok(prints.length > 0, `the AssuredLoop section of AGENTS.md should still give a command that prints ${SKILL_FILE}`);
});

// Which al's skill the reader gets is the al the section selects: it reads no
// global folder (here), it gives no version of the package but 0.1.0 (the test
// on the exact version), and it gives a way to get 0.1.0 with no global
// install (the test on the run). Where in the section the skill's file is
// named, and how it is reached (a URL at 0.1.0, npm pack, npx, a folder of its
// own), is free.
test('AGENTS.md leads to the skill of al 0.1.0, not to the one in the global npm folder', async () => {
  const section = await assuredLoopSection();
  const global = globalFoldersIn(section);
  assert.deepEqual(global, [], `the AssuredLoop section of AGENTS.md should not read the global npm folder, which holds whatever al the machine has`);
  assert.ok(section.includes(SKILL_FILE), `the AssuredLoop section of AGENTS.md should name the skill's file, ${SKILL_FILE}`);
});

test('AGENTS.md no longer names the clone of AssuredLoop at 056d24c', async () => {
  const text = await readText('AGENTS.md');
  assert.ok(!text.includes(OLD_COMMIT), `AGENTS.md should not name ${OLD_COMMIT}: AssuredLoop now comes from npm`);
});

test('ci.yml runs on pull requests, and one of its jobs runs `al check --strict`', async () => {
  const ci = await readWorkflow('ci.yml');
  assert.ok(triggersOf(ci).includes('pull_request'), 'ci.yml should run on pull requests');
  await checkJob();
});

test('the AssuredLoop check checks out the whole history, with fetch-depth: 0, before it runs al', async () => {
  const [id, job] = await checkJob();
  const steps = stepsOf(job);
  const checkout = checkoutOf(job);
  const check = steps.findIndex(runsStrictCheck);
  assert.ok(checkout >= 0, `${id} should check out the repo with actions/checkout`);
  assert.ok(checkout < check, `${id} should check out the repo before it runs al check`);
  const depth = steps[checkout].with?.['fetch-depth'];
  assert.ok(depth === 0 || depth === '0', `${id} should check out with fetch-depth: 0, got: ${depth}`);
});

test('the AssuredLoop check installs @assuredloop/cli@0.1.0 globally, pinned exactly, before it runs al', async () => {
  const [id, job] = await checkJob();
  const steps = stepsOf(job);
  const install = steps.findIndex(installsPinned);
  const check = steps.findIndex(runsStrictCheck);
  assert.ok(install >= 0, `${id} should run \`npm install --global ${PACKAGE}@${VERSION}\``);
  assert.ok(install < check, `${id} should install al before it runs al check`);
  const other = steps.flatMap(installedSpecs).filter((spec) => spec !== `${PACKAGE}@${VERSION}`);
  assert.deepEqual(other, [], `${id} should install ${PACKAGE} at ${VERSION} only, not a range, a tag or no version`);
});

test('the AssuredLoop check runs on the Node the shard jobs in ci.yml run on', async () => {
  const ci = await readWorkflow('ci.yml');
  const shards = Object.values(jobsOf(ci)).filter(runsTheSuite);
  assert.ok(shards.length > 0, 'ci.yml should still have jobs that run the suite');
  const nodes = [...new Set(shards.map((job) => stepsOf(job)[setupNodeOf(job)]?.with?.['node-version']))];
  assert.equal(nodes.length, 1, `the jobs that run the suite should run on one Node, got: ${nodes.join(', ')}`);

  const [id, job] = await checkJob();
  const setup = setupNodeOf(job);
  assert.ok(setup >= 0, `${id} should set up Node with actions/setup-node`);
  assert.equal(String(stepsOf(job)[setup].with?.['node-version']), String(nodes[0]), `${id} should run on the Node the shards run on`);
  const install = stepsOf(job).findIndex(installsPinned);
  assert.ok(install < 0 || setup < install, `${id} should set up Node before it installs al`);
});

test('a not-ok from `al check --strict` fails the check: nothing swallows its exit code', async () => {
  const [id, job] = await checkJob();
  const found = stepsOf(job).filter(runsStrictCheck).flatMap((step) => swallowsIn(step, job));
  assert.deepEqual(found, [], `${id} lets a failing al check pass:\n  ${found.join('\n  ')}`);
});

test('the check is a job of its own: the shard jobs and the summary job do not run al, and the summary still needs only the shards', async () => {
  const ci = await readWorkflow('ci.yml');
  const [id] = await checkJob();
  const suite = Object.keys(jobsOf(ci)).filter((name) => runsTheSuite(ci.jobs[name]));
  assert.ok(!suite.includes(id), `${id} should not also run the suite`);
  const summaries = Object.keys(jobsOf(ci)).filter((name) => suite.length > 0 && suite.every((need) => needsOf(ci.jobs[name]).includes(need)));
  assert.equal(summaries.length, 1, `exactly one job in ci.yml should need every shard job, got: ${summaries.join(', ') || 'none'}`);

  for (const name of [...suite, ...summaries]) {
    const touched = stepsOf(ci.jobs[name]).filter(touchesAssuredLoop);
    assert.deepEqual(touched, [], `${name} should be left as it was, without AssuredLoop in it`);
  }
  assert.deepEqual(needsOf(ci.jobs[summaries[0]]).sort(), [...suite].sort(), `${summaries[0]} should still need the shard jobs and nothing else`);
});

test('publish.yml does not install or run AssuredLoop', async () => {
  const publish = await readWorkflow('publish.yml');
  for (const [name, job] of Object.entries(jobsOf(publish))) {
    const touched = stepsOf(job).filter(touchesAssuredLoop);
    assert.deepEqual(touched, [], `publish.yml's ${name} job should not touch AssuredLoop: it is out of this issue's scope`);
  }
});
