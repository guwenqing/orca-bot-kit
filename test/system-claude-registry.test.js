// No live system test reads Claude Code's registry of running sessions from
// the home folder only (#866).
//
// Claude Code keeps one `<pid>.json` file for each running session in
// `<config dir>/sessions`. The config dir is `$CLAUDE_CONFIG_DIR` when that is
// set and not empty, else `~/.claude`. Orca can start Claude Code with
// CLAUDE_CONFIG_DIR set to a profile folder of its own: then
// `~/.claude/sessions` stays empty, and a test that reads only that folder
// finds no session and fails on its premise. So a file that reads the registry
// also reads it under `$CLAUDE_CONFIG_DIR`, as `registries()` in
// test/system/close-without-tab.test.js did when #866 was filed.
//
// This reads files as text; it loads and runs none of them (loading a system
// test runs it against the real Orca). The files it reads: every `.js` file
// under test/system/, and every file under test/helpers/ that one of them
// imports, directly or through another helper. A system test that reads the
// registry through a helper reads it all the same, and a helper that reads it
// from the home folder only has the same fault.
//
// What it holds, on each file's code with its comments taken out:
//
//   - A file reads the registry when its code shows a `sessions` folder of
//     a Claude config dir itself: a string with `.claude/sessions` in it
//     (such as `'~/.claude/sessions'` or `` `${home}/.claude/sessions` ``),
//     or the arguments `'.claude', 'sessions'` side by side (as in
//     `path.join(os.homedir(), '.claude', 'sessions')`). Those are the forms
//     the two files of #866 had.
//   - A file that reads the registry reads CLAUDE_CONFIG_DIR from the
//     environment in its code (`env.CLAUDE_CONFIG_DIR`,
//     `env['CLAUDE_CONFIG_DIR']`, the name `'CLAUDE_CONFIG_DIR'` as a whole
//     string, or a destructuring of `process.env`). A comment, or a message
//     that names it, is not a read.
//   - And it joins `sessions` onto a folder that is not written out in the
//     code (`path.join(dir, 'sessions')`, `` `${dir}/sessions` ``,
//     `dir + '/sessions'`): a fixed `~/.claude/sessions` beside a read of
//     CLAUDE_CONFIG_DIR for something else still reads the registry from the
//     home folder only.
//
// Other `sessions` folders are not Claude Code's registry and do not count:
// `~/.codex/sessions` (Codex rollouts), Pi's `~/.pi/agent/sessions`, a bot's
// `sessions.yaml`. Neither do `~/.claude/projects` and `~/.claude.json`.
//
// It does not follow names. A text rule that guesses what a name holds
// mixes up two bindings of the same name, and then fails a file that reads no
// registry at all (the reviews of PR #869). So `path.join(dir, 'sessions')`
// is not taken for a read, whatever `dir` holds: a home-only read built
// through a name is left to review, and the shared reader,
// test/helpers/live-claude-registry.js, is held by its own unit tests
// (test/live-claude-registry.test.js). For the same reason this does not
// prove that the CLAUDE_CONFIG_DIR read reaches the registry. The rule is
// proven below on small sample texts, and run over the real files.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { repoRoot } from './helpers/cli.js';

const systemTestsDir = path.join(repoRoot, 'test', 'system');
const helpersDir = path.join(repoRoot, 'test', 'helpers');

/** The characters after which a `/` starts a regular expression, not a division. */
const BEFORE_REGEX = '(,=:[!&|?{};+-*%<>~^';

/**
 * The code of a JavaScript source with its comments taken out: each comment
 * character becomes a space and each newline stays, so an index into the code
 * is the same index into the source. Strings, template literals and regular
 * expressions are kept as they are, so a `//` inside one is not a comment.
 */
function codeOf(source) {
  let out = '';
  let last = '';
  let i = 0;
  while (i < source.length) {
    const here = source[i];
    const next = source[i + 1];
    if (here === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (here === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (; i < stop; i += 1) out += source[i] === '\n' ? '\n' : ' ';
      continue;
    }
    if (here === "'" || here === '"' || here === '`') {
      let j = i + 1;
      while (j < source.length && source[j] !== here) {
        if (source[j] === '\\') j += 1;
        else if (here !== '`' && source[j] === '\n') break;
        j += 1;
      }
      out += source.slice(i, j + 1);
      i = j + 1;
      last = here;
      continue;
    }
    if (here === '/' && (last === '' || BEFORE_REGEX.includes(last) || /\b(?:return|typeof|case|of|in)\s*$/.test(out))) {
      let j = i + 1;
      let inClass = false;
      while (j < source.length && source[j] !== '\n') {
        const c = source[j];
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
        j += 1;
      }
      if (source[j] === '/') {
        out += source.slice(i, j + 1);
        i = j + 1;
        last = '/';
        continue;
      }
    }
    out += here;
    if (!/\s/.test(here)) last = here;
    i += 1;
  }
  return out;
}

/** A string with a `.claude/sessions` path in it. */
const CLAUDE_SESSIONS_STRING = /(?<![\w.-])\.claude[\\/]+sessions(?![\w.-])/;
/** The arguments `'.claude', 'sessions'` side by side. */
const CLAUDE_SESSIONS_ARGS = /['"`]\.claude['"`]\s*,\s*['"`]sessions['"`]/;
/** `sessions` joined onto a folder that the code does not write out. */
const SESSIONS_ON_A_VARIABLE = [
  /[^'"`\s]\s*,\s*['"`]sessions['"`]/,
  /\$\{[^}]*\}[\\/]sessions(?![\w.-])/,
  /\+\s*['"`][\\/]sessions['"`]/,
];
/** A read of CLAUDE_CONFIG_DIR from the environment. */
const READS_CONFIG_DIR = [
  /\benv\s*\.\s*CLAUDE_CONFIG_DIR\b/,
  /\benv\s*\[\s*['"`]CLAUDE_CONFIG_DIR['"`]\s*\]/,
  /['"`]CLAUDE_CONFIG_DIR['"`]/,
  /\{[^{}]*\bCLAUDE_CONFIG_DIR\b[^{}]*\}\s*=\s*process\.env\b/,
];

const lineAt = (code, index) => code.slice(0, index).split('\n').length;

/**
 * Where the code reads Claude Code's registry, by a form the text shows
 * itself: the index of the first place, or -1 when it shows none.
 */
function registryReadAt(code) {
  const places = [];
  for (const rule of [CLAUDE_SESSIONS_STRING, CLAUDE_SESSIONS_ARGS]) {
    const match = rule.exec(code);
    if (match) places.push(match.index);
  }
  return places.length === 0 ? -1 : Math.min(...places);
}

/**
 * What is wrong with one file's reading of Claude Code's registry: undefined
 * when it reads none, or reads it under CLAUDE_CONFIG_DIR as well, else a
 * sentence that names the line and the fault.
 */
function registryTrouble(source) {
  const code = codeOf(source);
  const at = registryReadAt(code);
  if (at === -1) return undefined;
  const line = lineAt(code, at);
  if (!READS_CONFIG_DIR.some((rule) => rule.test(code))) {
    return `reads Claude Code's registry from the home folder only (line ${line}): its code never reads CLAUDE_CONFIG_DIR from the environment (a comment or a message does not count)`;
  }
  if (!SESSIONS_ON_A_VARIABLE.some((rule) => rule.test(code))) {
    return `reads Claude Code's registry from the home folder only (line ${line}): it reads CLAUDE_CONFIG_DIR, but every \`sessions\` path it names is a fixed folder, none is joined onto the config dir`;
  }
  return undefined;
}

/** The relative files a source imports with `from '…'` or `import '…'`, as absolute paths. */
function importsOf(file, source) {
  const found = [];
  for (const match of codeOf(source).matchAll(/\b(?:from|import)\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    found.push(path.resolve(path.dirname(file), match[1]));
  }
  return found;
}

/** Every `.js` file under `dir`, at any depth. */
function jsFilesUnder(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name))
    .sort();
}

/** The system test files, and the helpers under test/helpers/ that they import at any depth. */
function filesToRead() {
  const systemFiles = jsFilesUnder(systemTestsDir);
  const helpers = new Set();
  const queue = [...systemFiles];
  while (queue.length > 0) {
    const file = queue.shift();
    for (const imported of importsOf(file, readFileSync(file, 'utf8'))) {
      if (!imported.startsWith(`${helpersDir}${path.sep}`) || helpers.has(imported) || !existsSync(imported)) continue;
      helpers.add(imported);
      queue.push(imported);
    }
  }
  return [...systemFiles, ...[...helpers].sort()];
}

const HOW_TO_FIX = 'read the registry under $CLAUDE_CONFIG_DIR too, when it is set and not empty, as well as under ~/.claude (#866)';

// ------------------------------------------------------------- the rule, on sample texts

test('#866 R1, the rule: each form of a home-only read of the registry is caught', () => {
  const samples = {
    'path.join with .claude and sessions': [
      "const REGISTRY = path.join(os.homedir(), '.claude', 'sessions');",
      'const names = readdirSync(REGISTRY);',
    ],
    'a ~/.claude/sessions string': [
      "const names = readdirSync(expandHome('~/.claude/sessions'));",
    ],
    'a template literal': [
      'const names = readdirSync(`${os.homedir()}/.claude/sessions`);',
    ],
    'a URL string before it on the same line': [
      "const SITE = 'https://example.com/a'; const REGISTRY = path.join(os.homedir(), '.claude', 'sessions');",
    ],
    'a regular expression with slashes before it on the same line': [
      "const URL = /https?:\\/\\//; const REGISTRY = path.join(os.homedir(), '.claude', 'sessions');",
    ],
  };
  for (const [what, lines] of Object.entries(samples)) {
    const trouble = registryTrouble(lines.join('\n'));
    assert.equal(typeof trouble, 'string', `${what}: a home-only read should be caught, got: ${trouble}`);
    assert.match(trouble, /home folder only/, `${what}: the message should say what is wrong, got: ${trouble}`);
  }
});

test('#866 R1, the rule: a file that names CLAUDE_CONFIG_DIR only in a comment or a message is still caught', () => {
  const home = "const REGISTRY = path.join(os.homedir(), '.claude', 'sessions');";
  const samples = {
    'a line comment': [home, '// CLAUDE_CONFIG_DIR is not read here: process.env.CLAUDE_CONFIG_DIR'],
    'a block comment': ['/**', ' * Read process.env.CLAUDE_CONFIG_DIR, and path.join(dir, \'sessions\').', ' */', home],
    'a message': [home, 'assert.ok(found, `no session found; is CLAUDE_CONFIG_DIR set?`);'],
  };
  for (const [what, lines] of Object.entries(samples)) {
    const trouble = registryTrouble(lines.join('\n'));
    assert.equal(typeof trouble, 'string', `${what}: should be caught, got: ${trouble}`);
    assert.match(trouble, /line \d+/, `${what}: the message should name the line, got: ${trouble}`);
  }
  const atLine = registryTrouble(['// one', '// two', home].join('\n'));
  assert.match(atLine, /line 3\b/, `the message should name the line of the read, line 3, got: ${atLine}`);
});

test('#866 R1, the rule: a fixed ~/.claude/sessions beside a read of CLAUDE_CONFIG_DIR for something else is caught', () => {
  const trouble = registryTrouble([
    "const REGISTRY = path.join(os.homedir(), '.claude', 'sessions');",
    "const transcripts = path.join(process.env.CLAUDE_CONFIG_DIR ?? '', 'projects');",
  ].join('\n'));
  assert.equal(typeof trouble, 'string', `should be caught, got: ${trouble}`);
});

test('#866 R1, the rule: a file that reads the registry in both places passes', () => {
  const samples = {
    'a list of the two registries, the config dir one when it is set': [
      'function registries() {',
      "  const dirs = [path.join(os.homedir(), '.claude', 'sessions')];",
      '  const configDir = process.env.CLAUDE_CONFIG_DIR;',
      "  if (typeof configDir === 'string' && configDir !== '') dirs.push(path.join(configDir, 'sessions'));",
      '  return dirs;',
      '}',
    ],
    'a home path and a config dir path, with bracket access': [
      "const HOME_REGISTRY = path.join(os.homedir(), '.claude', 'sessions');",
      "const configDir = process.env['CLAUDE_CONFIG_DIR'];",
      "const registries = configDir ? [HOME_REGISTRY, path.join(configDir, 'sessions')] : [HOME_REGISTRY];",
    ],
    'a list of variable names and a template literal': [
      'const registries = [`${os.homedir()}/.claude/sessions`];',
      "for (const name of ['CLAUDE_CONFIG_DIR']) if (process.env[name]) registries.push(`${process.env[name]}/sessions`);",
    ],
    'a helper that takes the home and the config dir, with defaults': [
      "export function claudeRegistries({ home = os.homedir(), configDir = process.env.CLAUDE_CONFIG_DIR } = {}) {",
      "  const dirs = [path.join(home, '.claude', 'sessions')];",
      "  if (typeof configDir === 'string' && configDir !== '') dirs.push(path.join(configDir, 'sessions'));",
      '  return dirs;',
      '}',
    ],
    'a destructuring of process.env and a concatenation': [
      'const { CLAUDE_CONFIG_DIR } = process.env;',
      "const registries = [os.homedir() + '/.claude/sessions'];",
      "if (CLAUDE_CONFIG_DIR) registries.push(CLAUDE_CONFIG_DIR + '/sessions');",
    ],
  };
  for (const [what, lines] of Object.entries(samples)) {
    const source = lines.join('\n');
    assert.notEqual(registryReadAt(codeOf(source)), -1, `${what}: the premise: the rule sees this as a read of the registry`);
    assert.equal(registryTrouble(source), undefined, `${what}: reads both places and should pass`);
  }
});

test('#866 R1, the rule: other sessions folders, transcripts, .claude.json and comments are not a read of the registry', () => {
  const samples = {
    'Codex rollouts': ["const CODEX_SESSIONS = path.join(os.homedir(), '.codex', 'sessions');"],
    'a Codex string': ["walk('~/.codex/sessions');"],
    "Pi's sessions": [
      "const PI_AGENT = path.join(os.homedir(), '.pi', 'agent');",
      "const PI_SESSIONS = path.join(PI_AGENT, 'sessions');",
    ],
    'Claude transcripts': ["const transcriptsOf = (home) => path.join(os.homedir(), '.claude', 'projects', home);"],
    '.claude.json': ["const config = path.join(os.homedir(), '.claude.json');"],
    "a bot's book": ["const book = path.join(home, 'sessions.yaml');"],
    'the .claude folder named, and Codex sessions on a declared name': [
      "const found = [path.join(os.homedir(), '.claude')];",
      "const CODEX_HOME = path.join(os.homedir(), '.codex');",
      "const rollouts = path.join(CODEX_HOME, 'sessions');",
    ],
    'the registry named only in a comment': [
      '// Claude Code lists its sessions in `~/.claude/sessions/<pid>.json`.',
      "// path.join(os.homedir(), '.claude', 'sessions')",
      'const nothing = 1;',
    ],
  };
  for (const [what, lines] of Object.entries(samples)) {
    assert.equal(registryTrouble(lines.join('\n')), undefined, `${what}: is not Claude Code's registry and should not be caught`);
  }
});

test('#866 R1, the rule: sessions joined onto a loop, callback or parameter name that holds a Codex or Pi folder is not a read of the registry, beside an unrelated .claude path', () => {
  const samples = {
    'Codex through a for...of': [
      "const claudeSettings = path.join(os.homedir(), '.claude');",
      "for (const dir of [path.join(os.homedir(), '.codex')]) {",
      "  readdirSync(path.join(dir, 'sessions'));",
      '}',
    ],
    'Pi through a for...of': [
      "const claudeSettings = path.join(os.homedir(), '.claude');",
      "for (const dir of [path.join(os.homedir(), '.pi', 'agent')]) {",
      "  readdirSync(path.join(dir, 'sessions'));",
      '}',
    ],
    'Codex through a for...of over a declared list': [
      "const claudeSettings = path.join(os.homedir(), '.claude');",
      "const homes = [path.join(os.homedir(), '.codex')];",
      "for (const dir of homes) readdirSync(path.join(dir, 'sessions'));",
    ],
    'Codex through a callback': [
      "const claudeSettings = path.join(os.homedir(), '.claude');",
      "const rollouts = [path.join(os.homedir(), '.codex')].map((dir) => path.join(dir, 'sessions'));",
    ],
    'Pi through a function parameter': [
      "const claudeSettings = path.join(os.homedir(), '.claude');",
      "const sessionsIn = (dir) => path.join(dir, 'sessions');",
      "const names = readdirSync(sessionsIn(path.join(os.homedir(), '.pi', 'agent')));",
    ],
  };
  const caught = Object.entries(samples)
    .map(([what, lines]) => [what, registryTrouble(lines.join('\n'))])
    .filter(([, trouble]) => trouble !== undefined)
    .map(([what, trouble]) => `${what}: ${trouble}`);
  assert.deepEqual(caught, [], `these are not Claude Code's registry and should not be caught:\n${caught.join('\n')}`);
});

test('#866 R1, the rule: Claude settings and Codex sessions read through two bindings of the same name are not a read of the registry', () => {
  const samples = {
    'two for...of loops, each with its own dir': [
      "for (const dir of [path.join(os.homedir(), '.claude')]) {",
      "  readFileSync(path.join(dir, 'settings.json'));",
      '}',
      "for (const dir of [path.join(os.homedir(), '.codex')]) {",
      "  readdirSync(path.join(dir, 'sessions'));",
      '}',
    ],
    'two functions, each with its own dir parameter': [
      "const settingsIn = (dir) => path.join(dir, 'settings.json');",
      "const sessionsIn = (dir) => path.join(dir, 'sessions');",
      "readFileSync(settingsIn(path.join(os.homedir(), '.claude')));",
      "readdirSync(sessionsIn(path.join(os.homedir(), '.codex')));",
    ],
  };
  const caught = Object.entries(samples)
    .map(([what, lines]) => [what, registryTrouble(lines.join('\n'))])
    .filter(([, trouble]) => trouble !== undefined)
    .map(([what, trouble]) => `${what}: ${trouble}`);
  assert.deepEqual(caught, [], `these are not Claude Code's registry and should not be caught:\n${caught.join('\n')}`);
});

// ------------------------------------------------------------- the real files

test('#866 R1: no system test, and no helper one imports, reads Claude Code\'s registry from the home folder only', (t) => {
  const files = filesToRead();
  assert.ok(files.some((file) => file.startsWith(`${systemTestsDir}${path.sep}`)), `the premise: there are system test files in ${systemTestsDir}`);
  // The system tests import helpers, so the files read reach past
  // test/system/; a scan that stops there would miss a helper's read.
  assert.ok(files.some((file) => file.startsWith(`${helpersDir}${path.sep}`)), `the premise: the files read include the helpers the system tests import, from ${helpersDir}`);

  const readers = [];
  const trouble = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const rel = path.relative(repoRoot, file);
    if (registryReadAt(codeOf(source)) !== -1) readers.push(rel);
    const why = registryTrouble(source);
    if (why !== undefined) trouble.push(`${rel}: ${why}; ${HOW_TO_FIX}`);
  }
  // No reader here is not a fault: a file that builds the path through a
  // name is not seen (the header says why). The rule itself is proven on the
  // sample texts above.
  t.diagnostic(`files that read Claude Code's registry, by a form the text shows: ${readers.join(', ') || '(none)'}`);
  assert.deepEqual(trouble, [], `each of these must also read the registry under $CLAUDE_CONFIG_DIR:\n${trouble.join('\n')}`);
});
