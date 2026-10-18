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
// The settings the core reads (the architect's ruling on R3's guard: list
// the shapes that are allowed, and fail every other). In a JavaScript file
// under src/, a setting is read in one of these shapes only, and each name
// read must be on the PRD's list:
//
//   a. `process.env.NAME`, with NAME spelled out;
//   b. `process.env[TAB_ENV]`, `process.env[SHELL_ENV]` and
//      `process.env[TERMINAL_ENV]`: an exception, so that src/ does not
//      change. The same constant gives the name the kit writes into a launch
//      line, so one spelling serves both. Each is declared once in src/, as
//      `const NAME = '<one literal string>'`, and that string is the name read;
//      a template, a concatenation, a call, a second declaration or another
//      binding of the name fails;
//   c. the one statement `const env = { ...process.env, ELECTRON_RUN_AS_NODE:
//      '1' };`, once, in askRuntime of src/orca.js: an exception, because it
//      hands the whole environment to Orca's client and reads no name. That
//      `env` is then used only as askRuntime uses it today: `delete
//      env.NODE_OPTIONS;`, `delete env.NODE_REPL_EXTERNAL_MODULE;`, and the
//      `{ env, ... }` option of its spawnSync call. Any other spread, a second
//      such statement, and any other use of that `env` fails.
//
// `process` is reached only by that global name, and only through the
// members src/ uses today (PROCESS_MEMBERS). Every other use of
// `process.env`, or of `process`, fails: a member not on that list (say,
// `process.getBuiltinModule('process')`), a destructuring, a copy, a computed
// or quoted name, a write, a pass to a function, `process` given another
// name, `globalThis`, `global`, `eval`, `Function` or `.constructor`, and the
// string 'process' or 'node:process' (an import or a require). So do an
// AppleScript `system attribute` and a
// file under src/ of a kind the check cannot read. The code is read with its
// comments and the inside of its strings, templates and regular expressions
// blanked out, so a word in a message does not count.
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
//     `"${OBK_CLI:-obk}"` in rules/ and skills/, or `$OBK_ORCA` in a skill;
//   - what code from outside the core reads when a child process runs it
//     (Orca's runtime client, which askRuntime starts), and a read inside a
//     dependency (yaml);
//   - a binding of TAB_ENV, SHELL_ENV or TERMINAL_ENV in a shape the check
//     does not know (say, a `for (const TAB_ENV of ...)`);
//   - a read hidden on purpose: through eval, new Function, a dynamic import
//     of a computed name, or code built at run time. The guard is there to
//     catch what a developer writes by habit (a new setting, a new command,
//     the usual ways to read the environment), not one who sets out to hide a
//     read. It keeps the checks it has for these, and goes no further (the
//     architect's stop rule, the third review of PR #656).
// Those stay for review to catch, under the core rule.
//
// Also here (CC5, the review of PR #656): only askRuntime in src/orca.js
// gives a child an environment of its own, and the script that child runs,
// src/orca-runtime.cjs, starts no process and sends no signal. Any other env
// key, `.env =`, mention of NODE_OPTIONS, or such a call in the script, is a
// place the check reports. A child without the kit's NODE_OPTIONS runs
// without the suite's preload (helpers/fake-tools.js), so a sandboxed run
// could reach a real ps, osascript or kill. What it cannot see: an env key
// that is computed (`[KEY]:`), and an options object that comes in whole
// from elsewhere (`{ ...given }`).
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

/**
 * The one place in src/ that gives a child an environment of its own: Orca's
 * runtime client, run by askRuntime in src/orca.js without the kit's
 * NODE_OPTIONS, as Orca's own `bin/orca` runs it (F2 and W1 check that). The
 * child it starts runs RUNTIME, which must start nothing of its own.
 */
const KNOWN_ENV = { file: 'src/orca.js', fn: 'askRuntime' };
const RUNTIME = 'src/orca-runtime.cjs';

/** Where the function `name` of `text` starts and ends, or undefined. */
function functionSpan(text, name) {
  const start = text.search(new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`, 'm'));
  if (start < 0) return undefined;
  const end = text.indexOf('\n}\n', start);
  return end < 0 ? undefined : [start, end + 2];
}

/** Words after which a `/` starts a regular expression, not a division. */
const BEFORE_REGEX = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'instanceof']);

/**
 * `text` with every comment, and the inside of every string, template text and
 * regular expression, blanked out with spaces, newlines kept: the code alone,
 * each character where it was. A plain English "process" in a comment or a
 * message is then no use of `process`.
 */
function codeOnly(text) {
  const out = [...text];
  const blank = (from, to) => {
    for (let k = from; k < to; k += 1) if (out[k] !== '\n') out[k] = ' ';
  };
  const holes = []; // the brace depth at each `${` still open
  let depth = 0;
  let last = ''; // the last character of code that is not a space
  let word = ''; // the last word of code, when that came last
  let i = 0;
  // The text of a template from `from`, up to its end or its next `${`.
  const template = (from) => {
    let j = from;
    while (j < text.length && text[j] !== '`' && !(text[j] === '$' && text[j + 1] === '{')) j += text[j] === '\\' ? 2 : 1;
    blank(from, j);
    if (text[j] === '`') {
      last = '`';
      return j + 1;
    }
    holes.push(depth);
    depth += 1;
    last = '{';
    return j + 2;
  };
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      blank(i, end < 0 ? text.length : end);
      i = end < 0 ? text.length : end;
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      blank(i, end < 0 ? text.length : end + 2);
      i = end < 0 ? text.length : end + 2;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      blank(i + 1, j);
      i = j + 1;
      last = c;
      word = '';
    } else if (c === '`') {
      i = template(i + 1);
      word = '';
    } else if (c === '/' && (last === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(last) || BEFORE_REGEX.has(word))) {
      let j = i + 1;
      let inClass = false;
      while (j < text.length && text[j] !== '\n' && (inClass || text[j] !== '/')) {
        if (text[j] === '\\') j += 1;
        else if (text[j] === '[') inClass = true;
        else if (text[j] === ']') inClass = false;
        j += 1;
      }
      blank(i + 1, j);
      i = j + 1;
      last = '/';
      word = '';
    } else {
      if (c === '{') depth += 1;
      if (c === '}') {
        depth -= 1;
        if (holes.length > 0 && holes[holes.length - 1] === depth) {
          holes.pop();
          i = template(i + 1);
          continue;
        }
      }
      if (/[\w$]/.test(c)) {
        const run = /^[\w$]+/.exec(text.slice(i))[0];
        word = run;
        last = run.at(-1);
        i += run.length;
        continue;
      }
      if (!/\s/.test(c)) {
        last = c;
        word = '';
      }
      i += 1;
    }
  }
  return out.join('');
}

/**
 * The constants through which a setting may be read, as `process.env[NAME]`
 * (shape b of the header). An exception kept so that src/ does not change:
 * the same constant gives the name the kit writes into a launch line or a
 * message (`${TAB_ENV}=…`, `${SHELL_ENV}=$$`), so one spelling serves both.
 */
const ENV_CONSTANTS = ['TAB_ENV', 'SHELL_ENV', 'TERMINAL_ENV'];
const ENV_CONSTANT = new RegExp(`(?<![\\w$.])(${ENV_CONSTANTS.join('|')})(?![\\w$])`, 'g');

/** A write to what comes before: an assignment, an update, or a delete. */
const WRITE_AFTER = /^\s*(?:=(?!=)|\+\+|--|(?:[-+*/%&|^]|\*\*|<<|>>>?|\?\?|&&|\|\|)=)/;

/**
 * The value of each of ENV_CONSTANTS in the `sources`, when it is declared
 * once, as `const NAME = '<literal>'`; and a place in `unread` for every
 * other declaration or binding of one.
 */
function envConstantsIn(sources, unread) {
  const found = new Map(ENV_CONSTANTS.map((name) => [name, []]));
  for (const { file, text, code } of sources) {
    const at = (index, why) => unread.push(`${file}:${lineAt(text, index)}: ${why}: ${text.slice(index).split('\n')[0].trim()}`);
    const lists = [...code.matchAll(/(?<![\w$.])(?:import|export)\s*\{[^}]*\}/g)].map((match) => [match.index, match.index + match[0].length]);
    const inList = (index) => lists.some(([from, to]) => index >= from && index < to);
    for (const match of code.matchAll(ENV_CONSTANT)) {
      const name = match[1];
      const before = code.slice(0, match.index);
      const after = code.slice(match.index + name.length);
      const declared = /(?<![\w$.])(const|let|var)\s+$/.exec(before);
      if (declared) {
        const literal = /^\s*=\s*(['"])([^'"\\\n]*)\1\s*(?:;|\n|$)/.exec(text.slice(match.index + name.length));
        if (declared[1] !== 'const' || literal === null) at(match.index, `${name} is not declared as one const with one literal string`);
        found.get(name).push(literal === null || declared[1] !== 'const' ? undefined : literal[2]);
        continue;
      }
      if (inList(match.index)) {
        if (/(?<![\w$])as\s+$/.test(before)) at(match.index, `another name imported or exported as ${name}`);
        continue;
      }
      if (/(?<![\w$.])(?:import|as)\s+$/.test(before)) {
        at(match.index, `another name bound to ${name}`);
        continue;
      }
      const prev = before.trimEnd().at(-1);
      const next = after.trimStart();
      const asIndex = /process\.env\[$/.test(before);
      const inHole = /\$\{\s*$/.test(before);
      if (!asIndex && !inHole && ['(', ',', '{', '['].includes(prev) && /^(?:[),}\]:]|=(?!=)|=>)/.test(next)) at(match.index, `${name} bound or given in a shape this check does not allow`);
    }
  }
  const values = new Map();
  for (const [name, declared] of found) {
    if (declared.length !== 1) unread.push(`src/: ${name} is declared ${declared.length} times, and must be declared once`);
    else if (declared[0] !== undefined) values.set(name, declared[0]);
  }
  return values;
}

/**
 * The members of `process` that src/ uses today, each reached as
 * `process.<member>`. Every other member fails: some reach the environment
 * or a module by another road (getBuiltinModule, binding, mainModule,
 * dlopen), and a new one is for review to allow here.
 */
const PROCESS_MEMBERS = new Set([
  'env', // read in the shapes a, b and c only, below
  'argv',
  'exit',
  'exitCode',
  'getuid', // the user id, for lsof and the process table (src/processes.js, src/orca.js)
  'pid',
  'platform',
  'stderr',
  'stdout',
]);

/** Shape c: the one statement of askRuntime that spreads process.env, as src/orca.js has it. */
const RUNTIME_ENV = "const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };";
/** The uses of that `env` askRuntime makes today, besides the option of its spawnSync call. */
const RUNTIME_ENV_USES = ['delete env.NODE_OPTIONS;', 'delete env.NODE_REPL_EXTERNAL_MODULE;'];

/**
 * The index in `text` of the `process` of RUNTIME_ENV, and a place in
 * `unread` for every use of that `env` in askRuntime but the allowed ones.
 * Undefined when askRuntime is not in `text`, or has RUNTIME_ENV other than
 * once.
 */
function runtimeSpreadIn(file, text, code, at) {
  if (file !== KNOWN_ENV.file) return undefined;
  const span = functionSpan(text, KNOWN_ENV.fn);
  if (span === undefined) return undefined;
  const body = text.slice(span[0], span[1]);
  const first = body.indexOf(RUNTIME_ENV);
  if (first < 0 || body.indexOf(RUNTIME_ENV, first + 1) >= 0) return undefined;
  const declared = span[0] + first;
  const allowed = new Set([declared + RUNTIME_ENV.indexOf('env')]);
  for (const use of RUNTIME_ENV_USES) {
    const where = body.indexOf(use);
    if (where >= 0 && body.indexOf(use, where + 1) < 0) allowed.add(span[0] + where + use.indexOf('env'));
  }
  const option = spawnSyncEnvOption(code, span);
  if (option !== undefined) allowed.add(option);
  // Every `env` that is no member of something else; a spread (`...env`) is one.
  for (const match of code.slice(span[0], span[1]).matchAll(/(?<![\w$]|(?<!\.\.)\.)env(?![\w$])/g)) {
    const index = span[0] + match.index;
    if (!allowed.has(index)) at(index, 'a use of askRuntime\'s env that this check does not allow');
  }
  return declared + RUNTIME_ENV.indexOf('process');
}

/**
 * The index of `env` when the one spawnSync call in `span` of `code` has it
 * as a shorthand key of an object that is a direct argument of the call.
 */
function spawnSyncEnvOption(code, span) {
  const calls = [...code.slice(span[0], span[1]).matchAll(/(?<![\w$.])spawnSync\s*\(/g)];
  if (calls.length !== 1) return undefined;
  let i = span[0] + calls[0].index + calls[0][0].length;
  const stack = ['('];
  let found;
  for (; i < span[1] && stack.length > 0; i += 1) {
    const c = code[i];
    if ('([{'.includes(c)) stack.push(c);
    else if (')]}'.includes(c)) stack.pop();
    else if (c === 'e' && /^env(?![\w$])/.test(code.slice(i)) && !/[\w$.]/.test(code[i - 1])
      && stack.length === 2 && stack[1] === '{'
      && /[{,]$/.test(code.slice(0, i).trimEnd()) && /^[,}]/.test(code.slice(i + 3).trimStart())) {
      found = found === undefined ? i : null;
    }
  }
  return found ?? undefined;
}

/**
 * What the JavaScript `sources` read from the environment: `names`, and
 * `unread`, each place in a shape the check does not allow, as
 * `file:line: why`. `listed` is the PRD's list: a name read that it does not
 * hold is a place too.
 */
function settingsReadBy(sources, listed) {
  const read = sources.map(({ file, text }) => ({ file, text, code: codeOnly(text) }));
  const names = new Set();
  const unread = [];
  const constants = envConstantsIn(read, unread);
  for (const { file, text, code } of read) {
    const shown = (index) => text.slice(index).split('\n')[0].trim();
    const at = (index, why) => unread.push(`${file}:${lineAt(text, index)}: ${why}: ${shown(index)}`);
    const spreadAt = runtimeSpreadIn(file, text, code, at);
    const name = (index, setting, tail, before) => {
      if (WRITE_AFTER.test(tail) || /(?<![\w$.])delete\s*$/.test(before)) return at(index, 'a write to process.env, which is no read');
      names.add(setting);
      if (!listed.has(setting)) at(index, `${setting}, which the PRD's list does not name`);
    };
    for (const match of code.matchAll(/(?<![\w$])process(?![\w$])/g)) {
      const before = code.slice(0, match.index);
      // Some object's own `process` (`answer.result?.process`), not Node's;
      // a spread (`...process`) is Node's.
      if (/(?:\?\.|(?<!\.\.)\.)\s*$/.test(before)) continue;
      const afterAt = match.index + match[0].length;
      const after = code.slice(afterAt);
      const member = /^\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)/.exec(after);
      if (member === null) {
        at(match.index, 'process used in a shape this check does not allow');
        continue;
      }
      if (!/^\.[A-Za-z_$]/.test(after)) {
        at(match.index, `process reached by ?. or with spaces, which this check does not allow`);
        continue;
      }
      if (!PROCESS_MEMBERS.has(member[1])) {
        at(match.index, `process.${member[1]}, a member of process this check does not allow`);
        continue;
      }
      // process.exitCode, process.argv and the like touch no setting.
      if (member[1] !== 'env') continue;
      if (!/^\.env(?![\w$])/.test(after)) {
        at(match.index, 'process.env reached in a shape this check does not allow');
        continue;
      }
      const rest = code.slice(afterAt + 4);
      const dotted = /^\.([A-Za-z_$][\w$]*)/.exec(rest);
      const byConstant = /^\[([A-Za-z_$][\w$]*)\]/.exec(rest);
      if (dotted) {
        // Shape a.
        name(match.index, dotted[1], rest.slice(dotted[0].length), before);
      } else if (byConstant && ENV_CONSTANTS.includes(byConstant[1])) {
        // Shape b: the constant's one literal value is the name read.
        const value = constants.get(byConstant[1]);
        if (value === undefined) at(match.index, `process.env[${byConstant[1]}], and ${byConstant[1]} has no one literal value`);
        else name(match.index, value, rest.slice(byConstant[0].length), before);
      } else if (match.index === spreadAt) {
        // Shape c: askRuntime hands the whole environment to Orca's client.
      } else {
        at(match.index, 'process.env used in a shape this check does not allow');
      }
    }
    for (const match of code.matchAll(/(?<![\w$.])(globalThis|global|eval|Function)(?![\w$])|(?:\?\.|\.)\s*(constructor)(?![\w$])/g)) {
      at(match.index, `${match[1] ?? match[2]}, which can reach process without its name`);
    }
    // An import or a require of process: 'node:process' anywhere in the code,
    // and 'process' where a module name goes. In the code, not in a comment:
    // the quote itself is code. ('process' is also a kind of finding in
    // src/health.js, which is no import.)
    for (const match of text.matchAll(/(['"`])(node:)?process\1/g)) {
      if (code[match.index] !== match[1]) continue;
      const before = code.slice(0, match.index);
      if (match[2] !== undefined || /(?:(?<![\w$.])from|(?<![\w$.])(?:require|import)\s*\(|\)\s*\()\s*$/.test(before)) at(match.index, 'an import or a require of process');
    }
    // A require by another road: createRequire, module.require, or require
    // given another name.
    for (const match of code.matchAll(/(?<![\w$])createRequire(?![\w$])|(?:\?\.|\.)\s*require(?![\w$])|(?<![\w$.])require(?![\w$])(?!\s*\()/g)) {
      at(match.index, 'a require that this check cannot follow');
    }
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
  const read = settingsReadBy(scripts, new Set((await prdLists()).settings));
  for (const name of read.names) names.add(name);
  return { names, unread: [...unread, ...read.unread], scripts };
}

// ----------------------------------------------------------------- what the core hands a child

/**
 * Each place in the JavaScript `sources` that gives a child an environment of
 * its own, or could, outside askRuntime: `unread`, as `file:line: why`; and
 * `known`, what askRuntime holds of it.
 *
 * Read as places: an `env` key of an object (`env:`, `'env':`, a shorthand
 * `{ env }`), a `.env =` that is not process's own, and any mention of
 * NODE_OPTIONS, comments and strings included. In RUNTIME also: a mention of
 * child_process, a call name of it (spawn, exec, execFile, fork and their
 * Sync forms), process.kill, an import(), and a require of anything but the
 * client it is given.
 */
function childEnvsIn(sources) {
  const unread = [];
  const known = { env: 0, nodeOptions: 0 };
  for (const { file, text } of sources) {
    const code = codeOnly(text);
    const span = file === KNOWN_ENV.file ? functionSpan(text, KNOWN_ENV.fn) : undefined;
    const inKnown = (index) => span !== undefined && index >= span[0] && index < span[1];
    const shown = (index) => text.slice(index).split('\n')[0].trim();
    const place = (index, why, kind) => {
      if (kind !== undefined && inKnown(index)) known[kind] += 1;
      else unread.push(`${file}:${lineAt(text, index)}: ${why}: ${shown(index)}`);
    };
    for (const match of code.matchAll(/(?<![\w$.])env(?![\w$])/g)) {
      const before = code.slice(0, match.index).trimEnd().at(-1);
      const after = code.slice(match.index + 3).trimStart()[0];
      if (after === ':') place(match.index, 'an env key, which gives a child an environment of its own', 'env');
      else if ((before === '{' || before === ',') && (after === ',' || after === '}')) place(match.index, 'an env shorthand key, which gives a child an environment of its own', 'env');
    }
    for (const match of text.matchAll(/(['"`])env\1\s*:/g)) {
      if (code[match.index] === match[1]) place(match.index, 'a quoted env key, which gives a child an environment of its own', 'env');
    }
    for (const match of code.matchAll(/(?:\?\.|\.)\s*env\s*=(?!=)/g)) {
      if (!/(?<![\w$.])process\s*$/.test(code.slice(0, match.index))) place(match.index, 'an env set on an object, which can give a child an environment of its own', 'env');
    }
    for (const match of text.matchAll(/NODE_OPTIONS/g)) place(match.index, 'NODE_OPTIONS, which decides what a child of the kit loads', 'nodeOptions');
    if (file === RUNTIME) {
      for (const match of text.matchAll(/child_process/g)) place(match.index, `child_process in ${RUNTIME}, whose process runs without the kit's NODE_OPTIONS`);
      for (const match of code.matchAll(/(?<![\w$])(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)(?![\w$])/g)) place(match.index, `${match[1]} in ${RUNTIME}, whose process runs without the kit's NODE_OPTIONS`);
      for (const match of code.matchAll(/(?<![\w$.])process\s*(?:\?\.|\.)\s*kill(?![\w$])/g)) place(match.index, `process.kill in ${RUNTIME}, whose process runs without the kit's NODE_OPTIONS`);
      for (const match of code.matchAll(/(?<![\w$.])import\s*\(/g)) place(match.index, `an import() in ${RUNTIME}, which can load what starts a process`);
      for (const match of code.matchAll(/(?<![\w$.])require\s*\(\s*([^)]*)\)/g)) {
        if (match[1].trim() !== 'client') place(match.index, `a require in ${RUNTIME} of something other than the client it is given`);
      }
    }
  }
  return { unread, known };
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

/** askRuntime as src/orca.js has it, in short: the one env of its own a child gets, and the one spread of process.env. */
const ASK_RUNTIME_EXAMPLE = [
  'function askRuntime(method, params, killMs = CLIENT_KILL_MS) {',
  '  try {',
  "    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };",
  '    delete env.NODE_OPTIONS;',
  '    delete env.NODE_REPL_EXTERNAL_MODULE;',
  "    const asked = spawnSync(orca, [RUNTIME_SCRIPT, client], { env, encoding: 'utf8', timeout: killMs });",
  '    return asked.stdout;',
  '  } catch {',
  '    return undefined;',
  '  }',
  '}',
  '',
].join('\n');

/** The settings of the PRD's list, as the examples use them. */
const EXAMPLE_LIST = new Set(['CODEX_HOME', 'OBK_ORCA', 'OBK_ORCA_DATA', 'OBK_TAB_SHELL', 'ORCA_TAB_ID', 'ORCA_TERMINAL_HANDLE']);

/** The three constants, declared as src/ declares them, and read as src/ reads them. */
const EXAMPLE_CORE = () => [
  { file: 'src/record.js', text: "import { harnessOf, SHELL_ENV } from './launch.js';\nexport const TAB_ENV = 'ORCA_TAB_ID';\nexport { SHELL_ENV };\n" },
  { file: 'src/launch.js', text: "export const SHELL_ENV = \"OBK_TAB_SHELL\";\nconst line = `${SHELL_ENV}=$$`;\nconst size = mark.slice(SHELL_ENV.length + 1);\n" },
  { file: 'src/orca.js', text: `import { TAB_ENV } from './record.js';\nexport const orcaCli = () => process.env.OBK_ORCA || BUILT_IN;\nconst data = process.env.OBK_ORCA_DATA || here;\n${ASK_RUNTIME_EXAMPLE}export const TERMINAL_ENV = 'ORCA_TERMINAL_HANDLE';\n` },
  { file: 'src/cli.js', text: "import { TERMINAL_ENV } from './orca.js';\nimport { SHELL_ENV, TAB_ENV } from './record.js';\nconst tab = process.env[TAB_ENV];\nrecord(tab, process.env[SHELL_ENV]);\nif (process.env[TERMINAL_ENV] === undefined) say(`${TERMINAL_ENV} is not set`);\nconst file = path.join(process.env.CODEX_HOME || path.join(home, '.codex'), 'config.toml');\n" },
];

/** EXAMPLE_CORE with `text` added as src/x.js, or with the file of `replace` given that text instead. */
const exampleWith = (text, replace) => {
  const core = EXAMPLE_CORE();
  if (replace === undefined) return [...core, { file: 'src/x.js', text }];
  return core.map((one) => (one.file === replace ? { file: replace, text } : one));
};

test('CC0 the settings reader, against worked examples: each shape it allows, and each other shape fails', () => {
  const good = settingsReadBy(EXAMPLE_CORE(), EXAMPLE_LIST);
  assert.deepEqual(good.unread, [], 'the shapes of today\'s src/ are allowed');
  assert.deepEqual(sorted(good.names), sorted(EXAMPLE_LIST));

  // What does not touch the environment: the word in a comment, a string, a
  // template's text or a regular expression, some object's own `process`,
  // and other members of process.
  const plain = settingsReadBy([...EXAMPLE_CORE(), { file: 'src/d.js', text: [
    '// the process in front of the tab; const p = process; process.env[name]',
    '/* const { env } = process; */',
    "const said = 'a process the kit did not start: process.env.NOPE';",
    'const shown = `the process ${who} started, process.env and all`;',
    'const pattern = /process|globalThis/g;',
    'const seen = answer.result?.process;',
    'process.exitCode = process.argv.length > 2 ? 0 : 1;',
    'const tpl = `${process.env.OBK_ORCA} and ${`nested ${process.env.CODEX_HOME}`}`;',
    'const half = total / process.pid / 2;',
  ].join('\n') }], EXAMPLE_LIST);
  assert.deepEqual(plain.unread, [], 'none of these is a shape that fails');

  // Point 2 of the ruling, and the reviews of PR #656: every other road to
  // process's environment.
  for (const [text, why] of [
    ["const { env: reviewEnv } = process; if (reviewEnv.OBK_REVIEW_GATE === 'yes') return 0;", 'the reviewer\'s line: process destructured'],
    ['const { env } = process;', 'process destructured, plain'],
    ['const { OBK_ORCA } = process.env;', 'process.env destructured'],
    ['const e = process.env; e.OBK_ORCA;', 'process.env copied to a name'],
    ['const all = { ...process.env };', 'process.env spread outside askRuntime'],
    ['Object.assign({}, process.env);', 'process.env copied by a call'],
    ['read(process.env);', 'process.env passed to a function'],
    ['process.env[name];', 'a computed name'],
    ["process.env['OBK_ORCA'];", 'a quoted name'],
    ['process.env[`OBK_ORCA`];', 'a name in a template'],
    ["const OTHER_ENV = 'OBK_ORCA'; process.env[OTHER_ENV];", 'a constant that is not one of the three'],
    ['process.env?.OBK_ORCA;', 'optional chaining on process.env'],
    ['process?.env.OBK_ORCA;', 'optional chaining on process'],
    ["process['env'].OBK_ORCA;", 'process indexed'],
    ['process . env.OBK_ORCA;', 'process.env with spaces'],
    ["process.env.OBK_ORCA = 'x';", 'a write'],
    ["process.env.OBK_ORCA ??= 'x';", 'a write by ??='],
    ['delete process.env.OBK_ORCA;', 'a delete'],
    ['process.env[TAB_ENV] = 1;', 'a write through a constant'],
    ['process.env.NOT_LISTED;', 'a name the PRD\'s list does not name'],
    ['read(process);', 'process passed whole'],
    ['const p = process; p.env.OBK_ORCA;', 'process given another name'],
    ['let p; p = process;', 'process given to a name later'],
    ['const o = { process };', 'process as a shorthand key'],
    ['function f(process) { return process.env.OBK_ORCA; }', 'process declared as a parameter'],
    ['process\n  ;', 'process at the end of a statement'],
    ['const s = `${process}`;', 'process in a template, whole'],
    ['globalThis.process.env.OBK_ORCA;', 'globalThis.process'],
    ["globalThis['process'].env.OBK_ORCA;", "globalThis['process']"],
    ['const g = globalThis;', 'globalThis given another name'],
    ['global.process.env.OBK_ORCA;', 'global.process'],
    ["eval('process.env.OBK_ORCA');", 'eval'],
    ["new Function('return process')();", 'Function'],
    ["(() => {}).constructor('return proc' + 'ess')();", 'Function through .constructor'],
    ["import { env } from 'node:process';", 'an import of node:process'],
    ["import proc from 'process';", 'an import of process'],
    ["const p = require('process');", 'a require of process'],
    ["const p = createRequire(import.meta.url)('node:process');", 'a require made by createRequire'],
    ["const p = await import('node:process');", 'an import() of node:process'],
  ]) {
    assert.ok(settingsReadBy(exampleWith(text), EXAMPLE_LIST).unread.length > 0, `${why} should fail: ${text}`);
  }

  // The spread is allowed in askRuntime of src/orca.js only.
  assert.ok(settingsReadBy(exampleWith(`${ASK_RUNTIME_EXAMPLE}`), EXAMPLE_LIST).unread.length > 0, 'the askRuntime form in another file should fail');
  assert.ok(settingsReadBy(exampleWith(`${ASK_RUNTIME_EXAMPLE.replace('askRuntime', 'askAgain')}export const TERMINAL_ENV = 'ORCA_TERMINAL_HANDLE';\n`, 'src/orca.js'), EXAMPLE_LIST).unread.length > 0, 'the askRuntime form in another function should fail');

  // The third review of PR #656: process is reached only through the members
  // src/ uses today.
  for (const [text, why] of [
    ['if (process.getBuiltinModule("process").env.OBK_REVIEW_GATE === "yes") return 0;', 'the reviewer\'s line: getBuiltinModule'],
    ["const p = process.getBuiltinModule('node:process');", 'getBuiltinModule of node:process'],
    ["const p = process['getBuiltinModule']('process');", 'getBuiltinModule, indexed'],
    ["process.binding('util');", 'binding'],
    ['const m = process.mainModule;', 'mainModule'],
    ['process.dlopen(module, file);', 'dlopen'],
    ['const here = process.cwd();', 'cwd, a member src/ does not use'],
    ['const id = process?.pid;', 'a member by optional chaining'],
  ]) {
    assert.ok(settingsReadBy(exampleWith(text), EXAMPLE_LIST).unread.length > 0, `${why} should fail: ${text}`);
  }

  // Shape c is the one statement, once, and its env is used only as
  // askRuntime uses it today.
  const orcaText = EXAMPLE_CORE().find(({ file }) => file === 'src/orca.js').text;
  const inAskRuntime = (change) => exampleWith(orcaText.replace(ASK_RUNTIME_EXAMPLE, change(ASK_RUNTIME_EXAMPLE)), 'src/orca.js');
  const statement = "    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };\n";
  for (const [change, why] of [
    [(body) => body.replace('  try {\n', '  try {\n    const reviewEnv = { ...process.env }; if (reviewEnv.OBK_REVIEW_GATE === "yes") return undefined;\n'), 'the reviewer\'s line: another spread in askRuntime'],
    [(body) => body.replace(statement, `${statement}${statement.replace('const env', 'const again')}`), 'a second statement of that form'],
    [(body) => body.replace(statement, `${statement}${statement}`), 'the same statement twice'],
    [(body) => body.replace(statement, statement.replace("'1' }", "'1', ...process.env }")), 'a second spread in the statement'],
    [(body) => body.replace(statement, statement.replace('const env', 'let env')), 'the statement changed'],
    [(body) => body.replace('    delete env.NODE_OPTIONS;\n', '    delete env.NODE_OPTIONS;\n    if (env.OBK_X) return undefined;\n'), 'env.OBK_X'],
    [(body) => body.replace('    delete env.NODE_OPTIONS;\n', '    delete env.NODE_OPTIONS;\n    const one = env[name];\n'), 'env[name]'],
    [(body) => body.replace('    delete env.NODE_OPTIONS;\n', '    delete env.NODE_OPTIONS;\n    log(env);\n'), 'env passed to another call'],
    [(body) => body.replace('    delete env.NODE_OPTIONS;\n', '    delete env.NODE_OPTIONS;\n    const copy = { ...env };\n'), 'env spread again'],
    [(body) => body.replace('    delete env.NODE_OPTIONS;\n', '    delete env.NODE_OPTIONS;\n    delete env.NODE_OPTIONS;\n'), 'a delete twice'],
    [(body) => body.replace('    delete env.NODE_OPTIONS;\n', '    delete env.OBK_X;\n'), 'a delete of another name'],
    [(body) => body.replace('{ env, encoding', '{ env: env, encoding'), 'the option written out'],
    [(body) => body.replace('{ env, encoding', '{ cwd: [env], encoding'), 'env inside another option'],
    [(body) => body.replace('    return asked.stdout;\n', "    spawnSync('git', [], { env });\n    return asked.stdout;\n"), 'env given to a second spawnSync'],
  ]) {
    const changed = inAskRuntime(change);
    assert.notDeepEqual(changed, EXAMPLE_CORE(), `the premise: ${why} changes the example`);
    assert.ok(settingsReadBy(changed, EXAMPLE_LIST).unread.length > 0, `${why} should fail`);
  }

  // Point 3b: a new name never comes in by a change to a constant.
  const record = (declaration) => `import { harnessOf, SHELL_ENV } from './launch.js';\n${declaration}\nexport { SHELL_ENV };\n`;
  for (const [text, replace, why] of [
    [record("export const TAB_ENV = 'SOME_NEW_NAME';"), 'src/record.js', 'a value the PRD\'s list does not name'],
    [record('export const TAB_ENV = `ORCA_TAB_ID`;'), 'src/record.js', 'a value in a template'],
    [record("export const TAB_ENV = 'ORCA_' + 'TAB_ID';"), 'src/record.js', 'a value by concatenation'],
    [record("export const TAB_ENV = named('ORCA_TAB_ID');"), 'src/record.js', 'a value by a call'],
    [record('export const TAB_ENV = OTHER;'), 'src/record.js', 'a value that is another name'],
    [record("export let TAB_ENV = 'ORCA_TAB_ID';"), 'src/record.js', 'a let, which can change'],
    [record(''), 'src/record.js', 'a constant declared nowhere'],
    ["const TAB_ENV = 'ORCA_TAB_ID';", undefined, 'a constant declared twice'],
    ["import { OTHER as TAB_ENV } from './x.js';", undefined, 'another name imported as the constant'],
    ["import TAB_ENV from './x.js';", undefined, 'a default import bound to the constant'],
    ['function f(TAB_ENV) { return process.env[TAB_ENV]; }', undefined, 'a parameter that hides the constant'],
    ['const f = (a, TAB_ENV) => process.env[TAB_ENV];', undefined, 'an arrow parameter that hides the constant'],
    ['const { TAB_ENV } = names; process.env[TAB_ENV];', undefined, 'a destructuring that hides the constant'],
  ]) {
    assert.ok(settingsReadBy(exampleWith(text, replace), EXAMPLE_LIST).unread.length > 0, `${why} should fail: ${text}`);
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

test('CC0 the child environment reader, against worked examples: the askRuntime form, and each other place it reports', () => {
  const askRuntime = ASK_RUNTIME_EXAMPLE;
  const runtime = "'use strict';\nconst [client] = process.argv.slice(2);\nconst { RuntimeClient } = require(client);\nnew RuntimeClient().call('x').finally(() => process.exit());\n";
  const plain = "function other() {\n  const env = process.env;\n  const home = process.env.HOME;\n  const said = 'the env: of a child';\n  // { env: x }\n  return spawnSync('git', ['status'], { cwd: home, encoding: 'utf8' });\n}\n";
  const good = childEnvsIn([
    { file: 'src/orca.js', text: `${askRuntime}${plain}` },
    { file: RUNTIME, text: runtime },
  ]);
  assert.deepEqual(good.unread, [], 'the askRuntime form, a plain spawn and the runtime script as it is are no places to report');
  assert.deepEqual(good.known, { env: 1, nodeOptions: 1 });

  for (const [file, text, why] of [
    ['src/orca.js', `${askRuntime}function more() {\n  return spawnSync('git', [], { env: { ...process.env, X: '1' } });\n}\n`, 'a second env: in another function'],
    ['src/orca.js', `${askRuntime}function more(env) {\n  return spawn('git', [], { cwd, env });\n}\n`, 'a shorthand env in another function'],
    ['src/up.js', "spawn('node', [file], { env: { ...process.env, NODE_OPTIONS: '' } });", "NODE_OPTIONS: '' with an env key"],
    ['src/up.js', "const options = { NODE_OPTIONS: '' };", "NODE_OPTIONS: '' alone"],
    ['src/up.js', "delete process.env.NODE_OPTIONS;", 'NODE_OPTIONS taken out of the kit\'s own environment, which every child inherits'],
    ['src/up.js', "const e = process.env['NODE_OPTIONS'];", 'NODE_OPTIONS in a string'],
    ['src/up.js', "spawnSync('git', [], { 'env': e });", 'a quoted env key'],
    ['src/up.js', 'const o = {}; o.env = e; spawnSync(\'git\', [], o);', 'an env set on an options object'],
    ['src/up.js', askRuntime, 'the askRuntime form in another file'],
    ['src/orca.js', askRuntime.replace('askRuntime', 'askAgain'), 'the askRuntime form in another function'],
    [RUNTIME, `${runtime}require('node:child_process').spawnSync('/bin/kill', ['-9', '1']);\n`, 'a spawn in orca-runtime.cjs'],
    [RUNTIME, `${runtime}const { execFile } = require(client);\n`, 'a child_process call name in orca-runtime.cjs'],
    [RUNTIME, `${runtime}process.kill(1, 'SIGTERM');\n`, 'process.kill in orca-runtime.cjs'],
    [RUNTIME, `${runtime}const cp = require('child' + '_proc' + 'ess');\n`, 'a require of something built at run time in orca-runtime.cjs'],
    [RUNTIME, `${runtime}import('node:' + name);\n`, 'an import() in orca-runtime.cjs'],
  ]) {
    assert.ok(childEnvsIn([{ file, text }]).unread.length > 0, `${why} should be a place the check reports: ${text}`);
  }
});

// ----------------------------------------------------------------- R3: the lists and the core agree

test('CC1 the PRD\'s [PRD-8] names the settings the core reads, and no others; and src/ reaches the environment only in the shapes the check allows', async () => {
  const { settings } = await prdLists();
  const core = await coreSettings();

  assert.deepEqual(core.unread, [], 'places in src/ that reach the environment in a shape the check does not allow: read a setting as process.env.NAME, with NAME on the PRD\'s list');
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

test('CC5 only askRuntime in src/orca.js gives a child an environment of its own, and the script its child runs starts nothing', async () => {
  const { scripts } = await coreSettings();
  assert.ok(scripts.some(({ file }) => file === RUNTIME), `the premise: ${RUNTIME} is read`);
  const read = childEnvsIn(scripts);

  assert.deepEqual(read.unread, [], 'places in src/ that give a child an environment of its own, or could, outside askRuntime: a child without the kit\'s NODE_OPTIONS runs without the test preload (helpers/fake-tools.js), so a sandbox could reach a real program');
  assert.deepEqual(read.known, { env: 1, nodeOptions: 1 }, 'the premise: askRuntime in src/orca.js still holds its one env and its one NODE_OPTIONS');
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
