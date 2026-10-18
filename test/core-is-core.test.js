// Core is core and test is test (#652).
//
// The owner, 2026-10-18: "All the test related stuff please build it out side
// the kit core!!!! Core is core and test is test." The kit's core is what the
// package ships: src/, rules/, skills/, README.md and SETUP.md. It holds only
// what a user of the kit uses (R1). `obk run` (#532) came in for the fleet's
// own test runs as a tier-0 change with no PRD line, so it never reached the
// owner. So the PRD names, in one list, every `obk` command and every
// environment setting the core reads, and this check fails when the two part
// (R3). A new command or setting then needs a PRD edit, which `al check
// --strict` holds to tier 1 and the owner's sign-off.
//
// The PRD's lists are two bullets of [PRD-8] "6.1 Shape", in exactly this form:
//
//   - The `obk` commands, and no others: `init`, `up`, `bot create`, ... . [...]
//   - The environment settings the core reads, and no others: `CLAUDE_CONFIG_DIR`, ... . [...]
//
// Each name in backticks, separated by ", ". A command of two words is written
// with its space. Only the names between "and no others: " and the end of the
// list are read.
//
// The commands the core has are, all of them together:
//   a. the keys of COMMANDS in src/commands.js, which the CLI reads to parse a
//      command line;
//   b. each command a usage line of `obk --help` starts with;
//   c. each word or pair of words, spelled as a string literal anywhere in
//      src/, that the CLI does not refuse as it refuses a command it does not
//      have. This is what sees a command dispatched before COMMANDS is read,
//      as `run` was (`if (argv[0] === 'run')` in src/cli.js), or one
//      dispatched from another module. Each is asked with no other argument,
//      in a sandbox, so a command that needs a flag is refused for the flag
//      and not as unknown.
//
// The settings the core reads are every name read off `process.env` in a
// JavaScript file under src/: `process.env.NAME`, `process.env['NAME']`, and
// `process.env[CONST]` where CONST is a string constant declared in src/
// (`TAB_ENV = 'ORCA_TAB_ID'` in src/record.js, `SHELL_ENV` in src/launch.js,
// `TERMINAL_ENV` in src/orca.js). Spreading the whole environment into a
// child's (`{ ...process.env }`) reads no name. Any other use of `process.env`,
// a constant that is declared twice or not at all, `process[...]`, an import
// of `node:process`, an AppleScript `system attribute`, or a file under src/
// of a kind the check cannot read, fails the check as one it cannot read: the
// check does not guess.
//
// What the check still cannot see:
//   - a new flag on a command the list names (the list is of commands, not
//     flags);
//   - a test-only branch inside a command the list names, reached by a flag or
//     by a value of a flag;
//   - a command dispatched by a word that is spelled nowhere in src/ as a
//     literal (built from parts at run time), or only after another word that
//     is not a command;
//   - what Node itself reads on the kit's behalf (HOME through os.homedir(),
//     TMPDIR through os.tmpdir(), NODE_OPTIONS), and what the programs the kit
//     starts read from the environment it hands them (git, Orca, the
//     harnesses);
//   - a setting read only by a shell the kit's text runs, such as
//     `"${OBK_CLI:-obk}"` in rules/ and skills/, or `$OBK_ORCA` in a skill.
// Those stay for review to catch.
//
// Also here, from R1: the core reads none of the settings that existed only
// for the kit's own tests (OBK_PS, OBK_LSOF, OBK_STTY, OBK_OSASCRIPT,
// OBK_KILL, OBK_POLICY_ROOT), and still reads OBK_ORCA and OBK_ORCA_DATA,
// which SETUP.md names for users; and the README's "Working on the kit" is in
// CONTRIBUTING.md, which the package does not ship.

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import * as commands from '../src/commands.js';
import { createSandbox, repoRoot } from './helpers/cli.js';

const PRD = path.join(repoRoot, 'docs', 'prd', 'prd.md');
const SRC = path.join(repoRoot, 'src');

const LEADS = {
  commands: '- The `obk` commands, and no others: ',
  settings: '- The environment settings the core reads, and no others: ',
};

const sorted = (list) => [...list].sort();

/** Set difference, sorted: what `a` has that `b` lacks. */
const minus = (a, b) => sorted([...a].filter((item) => !b.has(item)));

// ----------------------------------------------------------------- the PRD's lists

/** The lines of the section whose heading carries `[id]`, up to the next heading of its level or above. */
function sectionOf(text, id) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^#{1,3} /.test(line) && line.includes(`[${id}]`));
  assert.ok(start >= 0, `the PRD should have a section [${id}]`);
  const level = /^#+/.exec(lines[start])[0].length;
  const next = lines.findIndex((line, at) => at > start && new RegExp(`^#{1,${level}} `).test(line));
  return lines.slice(start + 1, next < 0 ? undefined : next);
}

/**
 * The names of the bullet that starts with `lead`, among `lines`: the one such
 * bullet, its list a run of backticked names separated by ", ", then the end
 * of the sentence.
 */
function namesInBullet(lines, lead) {
  const bullets = lines.filter((line) => line.startsWith(lead));
  assert.equal(bullets.length, 1, `[PRD-8] should hold one bullet that starts "${lead}", got ${bullets.length}`);
  const rest = bullets[0].slice(lead.length);
  const list = /^`[^`]+`(?:, `[^`]+`)*/.exec(rest);
  assert.notEqual(list, null, `the bullet's list should be names in backticks, separated by ", ", got: ${rest}`);
  assert.match(rest.slice(list[0].length), /^\s*\./, `the list should end the sentence, with nothing else in it, got: ${rest}`);
  const names = [...list[0].matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  assert.equal(new Set(names).size, names.length, `the list names each once, got: ${JSON.stringify(names)}`);
  return names;
}

async function prdLists() {
  const lines = sectionOf(await readFile(PRD, 'utf8'), 'PRD-8');
  return { commands: namesInBullet(lines, LEADS.commands), settings: namesInBullet(lines, LEADS.settings) };
}

// ----------------------------------------------------------------- what the core reads

/** Every file under `dir`, as paths relative to the repo. */
async function filesUnder(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await filesUnder(full));
    else out.push(path.relative(repoRoot, full));
  }
  return out;
}

const lineAt = (text, index) => text.slice(0, index).split('\n').length;

/** `name = 'value'` string constants, in every given source, as name → set of values. */
function constantsIn(sources) {
  const found = new Map();
  for (const { text } of sources) {
    for (const match of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])([^'"\\\n]*)\2/g)) {
      if (!found.has(match[1])) found.set(match[1], new Set());
      found.get(match[1]).add(match[3]);
    }
  }
  return found;
}

/**
 * What the JavaScript `sources` read from the environment: `names`, and
 * `unread`, each place the check cannot read, as `file:line: why`.
 */
function settingsReadBy(sources) {
  const constants = constantsIn(sources);
  const names = new Set();
  const unread = [];
  for (const { file, text } of sources) {
    const at = (index, why) => unread.push(`${file}:${lineAt(text, index)}: ${why}`);
    for (const match of text.matchAll(/\bprocess\s*(?:\?\.|\.)\s*env\b/g)) {
      const after = text.slice(match.index + match[0].length);
      const before = text.slice(0, match.index);
      const dotted = /^\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)/.exec(after);
      const quoted = /^\s*(?:\?\.)?\s*\[\s*(['"])([^'"\\]+)\1\s*\]/.exec(after);
      const byName = /^\s*(?:\?\.)?\s*\[\s*([A-Za-z_$][\w$]*)\s*\]/.exec(after);
      if (dotted) names.add(dotted[1]);
      else if (quoted) names.add(quoted[2]);
      else if (byName) {
        const values = constants.get(byName[1]);
        if (values?.size === 1) names.add([...values][0]);
        else at(match.index, `process.env[${byName[1]}], and ${byName[1]} is ${values === undefined ? 'no string constant declared in src/' : `declared with ${values.size} values`}`);
      } else if (/\.\.\.\s*$/.test(before)) {
        // The whole environment spread into a child's: no name is read.
      } else {
        at(match.index, `process.env used in a way this check cannot read: ${(match[0] + after.split('\n')[0]).trim()}`);
      }
    }
    for (const match of text.matchAll(/\bprocess\s*(?:\?\.)?\s*\[/g)) at(match.index, 'process[...], which this check cannot read');
    for (const match of text.matchAll(/(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)(['"])(?:node:)?process\1/g)) at(match.index, 'an import of node:process, which this check cannot read');
  }
  return { names, unread };
}

/** What the core reads, from every file under src/: names and the places the check cannot read. */
async function coreSettings() {
  const files = await filesUnder(SRC);
  const scripts = [];
  const unread = [];
  const names = new Set();
  for (const file of files) {
    const text = await readFile(path.join(repoRoot, file), 'utf8');
    if (/\.(?:js|cjs|mjs)$/.test(file)) {
      scripts.push({ file, text });
    } else if (file.endsWith('.applescript')) {
      for (const match of text.matchAll(/system attribute/g)) unread.push(`${file}:${lineAt(text, match.index)}: an AppleScript system attribute, which this check cannot read`);
    } else {
      unread.push(`${file}: a kind of file this check cannot read for what it takes from the environment`);
    }
  }
  const read = settingsReadBy(scripts);
  for (const name of read.names) names.add(name);
  return { names, unread: [...unread, ...read.unread], scripts };
}

// ----------------------------------------------------------------- the commands the core has

/** The words a usage line of the help starts with: one, or two when the two are a command of COMMANDS. */
function helpCommands(usage, known) {
  const found = new Set();
  for (const line of usage.split('\n')) {
    const match = /^ {2}obk ([a-z][a-z0-9-]*)(?: ([a-z][a-z0-9-]*))?(?=\s|$)/.exec(line);
    if (match === null) continue;
    const two = match[2] === undefined ? undefined : `${match[1]} ${match[2]}`;
    found.add(two !== undefined && known.has(two) ? two : match[1]);
  }
  return found;
}

/** Every one- or two-word lower-case string literal in the sources. */
function wordLiterals(sources) {
  const found = new Set();
  for (const { text } of sources) {
    for (const match of text.matchAll(/(['"`])([a-z][a-z0-9-]*(?: [a-z][a-z0-9-]*)?)\1/g)) found.add(match[2]);
  }
  return found;
}

/** Ask `items` of `ask`, `width` at a time, in order. */
async function inTurns(items, width, ask) {
  const out = [];
  for (let at = 0; at < items.length; at += width) out.push(...await Promise.all(items.slice(at, at + width).map(ask)));
  return out;
}

const NO_SUCH = 'zz-no-such-command';

/**
 * The words among `candidates` that the CLI takes for a command of its own:
 * each asked as `obk <words>` with nothing else, and a command when the answer
 * is not the one it gives a command it does not have.
 */
async function probedCommands(box, candidates) {
  const unknown = await box.run([NO_SUCH]);
  assert.equal(unknown.code, 1, `the premise: obk ${NO_SUCH} is refused, got:\n${unknown.stdout}${unknown.stderr}`);
  assert.ok(unknown.stderr.includes(NO_SUCH), `the premise: the refusal names the word, got: ${unknown.stderr}`);
  const refusedAsUnknown = (words, answer) => answer.code === unknown.code && answer.stdout === unknown.stdout
    && [words.join(' '), words[0]].some((said) => answer.stderr === unknown.stderr.replaceAll(NO_SUCH, said));
  const answers = await inTurns([...candidates], 8, async (candidate) => {
    const words = candidate.split(' ');
    return [candidate, refusedAsUnknown(words, await box.run(words))];
  });
  return new Set(answers.filter(([, refused]) => !refused).map(([candidate]) => candidate));
}

// ----------------------------------------------------------------- the reader, against worked examples

test('CC0 the settings reader, against worked examples: each form it reads, and each it refuses to guess', () => {
  const read = settingsReadBy([
    { file: 'a.js', text: "export const TAB = 'ORCA_TAB_ID';\nconst x = process.env.OBK_ORCA || process.env?.CODEX_HOME;\nconst y = process.env['QUOTED'];\nconst env = { ...process.env, X: '1' };\n" },
    { file: 'b.js', text: "import { TAB } from './a.js';\nconst z = process.env[TAB];\nconst w = process.env[ SPACED ];\nconst SPACED = \"SPACED_NAME\";\n" },
  ]);
  assert.deepEqual(sorted(read.names), ['CODEX_HOME', 'OBK_ORCA', 'ORCA_TAB_ID', 'QUOTED', 'SPACED_NAME']);
  assert.deepEqual(read.unread, []);

  for (const [text, why] of [
    ['const { OBK_X } = process.env;', 'destructured'],
    ['const env = process.env; env.OBK_X;', 'aliased'],
    ['Object.keys(process.env);', 'passed whole to a function'],
    ['process.env[name];', 'a name that is no constant'],
    ['process.env[`OBK_${x}`];', 'a name built at run time'],
    ["const A = 'ONE'; const A2 = 1; process.env[B]; const B = 'X'; const B = 'Y';", 'a constant declared twice'],
    ["process['env'].OBK_X;", 'process[...]'],
    ["import { env } from 'node:process';", 'an import of node:process'],
    ["const p = require('process');", 'a require of process'],
  ]) {
    assert.ok(settingsReadBy([{ file: 'c.js', text }]).unread.length > 0, `${why} should be a place the check cannot read: ${text}`);
  }
});

test('CC0 the PRD bullet reader, against worked examples', () => {
  const lead = LEADS.commands;
  assert.deepEqual(namesInBullet([`${lead}\`init\`, \`up\`, \`bot create\`. [decided by the owner, 2026-10-18, #652]`], lead), ['init', 'up', 'bot create']);
  assert.deepEqual(namesInBullet(['- something else', `${lead}\`init\`.`], lead), ['init']);
  for (const [line, why] of [
    [`${lead}\`init\`, up. [x]`, 'a name with no backticks'],
    [`${lead}\`init\` and \`up\`. [x]`, 'another separator'],
    [`${lead}\`init\`, \`init\`. [x]`, 'a name twice'],
    ['- The `obk` commands: `init`.', 'another lead'],
  ]) {
    assert.throws(() => namesInBullet([line], lead), assert.AssertionError, why);
  }
});

test('CC0 the help reader takes a command of two words only when COMMANDS has it', () => {
  const usage = 'Usage:\n  obk init --bots <path>\n  obk bot create --bots <path>\n  obk up foo\n  obk --version  Print it.\nobk prose here\n';
  assert.deepEqual(sorted(helpCommands(usage, new Set(['init', 'bot create', 'up']))), ['bot create', 'init', 'up']);
});

// ----------------------------------------------------------------- R3: the lists and the core agree

test('CC1 the PRD\'s [PRD-8] names the settings the core reads, and no others; and the check can read every place the core reads one', async () => {
  const { settings } = await prdLists();
  const core = await coreSettings();

  assert.deepEqual(core.unread, [], 'places in src/ this check cannot read for a setting: write them in a form it reads, or teach it');
  const listed = new Set(settings);
  assert.deepEqual(minus(core.names, listed), [], 'settings the core reads that the PRD\'s list does not name: name them in [PRD-8], with the owner\'s sign-off, or stop reading them');
  assert.deepEqual(minus(listed, core.names), [], 'settings the PRD\'s list names that the core does not read: take them out of the list');
});

test('CC2 the PRD\'s [PRD-8] names the commands the CLI has, and no others: COMMANDS, the help\'s usage lines, and every word of src/ the CLI takes for a command', async (t) => {
  const { commands: listedNames } = await prdLists();
  const box = await createSandbox(t);
  const { COMMANDS } = commands;
  const known = new Set(Object.keys(COMMANDS));

  const help = await box.run(['--help']);
  assert.equal(help.code, 0, help.stderr);
  const inHelp = helpCommands(help.stdout, known);

  const { scripts } = await coreSettings();
  const candidates = new Set([...wordLiterals(scripts), ...known, ...inHelp]);
  const probed = await probedCommands(box, candidates);

  // The premise: the probe tells a command from no command.
  assert.deepEqual(minus(known, probed), [], 'the premise: the probe takes every key of COMMANDS for a command');
  assert.ok(!probed.has(NO_SUCH) && !probed.has('wibble'), 'the premise: and a word that is none for none');

  const core = new Set([...known, ...inHelp, ...probed]);
  const listed = new Set(listedNames);
  assert.deepEqual(minus(core, listed), [], 'commands the CLI has that the PRD\'s list does not name: name them in [PRD-8], with the owner\'s sign-off, or take them out');
  assert.deepEqual(minus(listed, core), [], 'commands the PRD\'s list names that the CLI does not have: take them out of the list');
});

// ----------------------------------------------------------------- R1: what left the core, and what stays

test('CC3 the core reads none of the settings that were only for the kit\'s own tests, and still reads OBK_ORCA and OBK_ORCA_DATA', async () => {
  const core = await coreSettings();

  for (const name of ['OBK_PS', 'OBK_LSOF', 'OBK_STTY', 'OBK_OSASCRIPT', 'OBK_KILL', 'OBK_POLICY_ROOT']) {
    assert.ok(!core.names.has(name), `the core should not read ${name}: it existed only for the kit's own tests`);
  }
  for (const name of ['OBK_ORCA', 'OBK_ORCA_DATA']) {
    assert.ok(core.names.has(name), `the core still reads ${name}, which SETUP.md names for users`);
  }
  const { settings } = await prdLists();
  for (const name of ['OBK_ORCA', 'OBK_ORCA_DATA']) assert.ok(settings.includes(name), `the PRD's list names ${name}`);
  assert.ok(!(await prdLists()).commands.includes('run'), 'the PRD\'s list names no run');
});

test('CC4 the README\'s "Working on the kit" is in CONTRIBUTING.md, which the package does not ship, and the README points to it', async () => {
  const readme = await readFile(path.join(repoRoot, 'README.md'), 'utf8');
  let contributing;
  try {
    contributing = await readFile(path.join(repoRoot, 'CONTRIBUTING.md'), 'utf8');
  } catch (error) {
    assert.fail(`CONTRIBUTING.md should be at the repo root, got: ${error.code}`);
  }

  assert.ok(!/^#{1,6} +Working on the kit\s*$/m.test(readme), 'the README should no longer hold the "Working on the kit" section');
  assert.match(readme, /\]\((?:\.\/)?CONTRIBUTING\.md(?:#[^)]*)?\)/, 'the README should keep a line that links to CONTRIBUTING.md');
  assert.match(contributing, /^#{1,6} +Working on the kit\s*$/m, 'CONTRIBUTING.md should hold "Working on the kit"');
  for (const command of ['npm test', 'npm run test:system', 'npm run mutate']) {
    assert.ok(contributing.includes(command), `CONTRIBUTING.md should say how to run ${command}, as the section did`);
    assert.ok(!readme.includes(command), `the README should no longer say ${command}: it is in CONTRIBUTING.md`);
  }

  const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.deepEqual(sorted(pkg.files), sorted(['src/', 'rules/', 'skills/', 'README.md', 'SETUP.md']), 'the package ships the core and nothing else');
  assert.ok(!pkg.files.some((entry) => /contributing/i.test(entry)), 'the package does not ship CONTRIBUTING.md');
});
