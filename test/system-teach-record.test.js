// A system test that checks the Teach form's effect looks at the record its own
// session writes, through test/helpers/teach-record.js, and prints no value
// from it (#745).
//
// A live test answers Claude Code's "Teach auto mode about your environment?"
// form with Esc, then checks that `autoModeEnvSetup` in Claude Code's
// `.claude.json` is as it was. A test that reads that key itself picks the file
// by a guess, and it can print the owner's value in a diagnostic or an
// assertion message. The helper finds the files that the test's own session
// may write (`sessionRecordFiles`), and tells the key apart by key names and a
// hash, with no value in it (`autoModeState`, #738). It is the only place in
// test/ that may read the key out of a file.
//
// This reads the system tests as text; it runs none of them. For each file in
// test/system/ it holds:
//
//   - the file reads no `autoModeEnvSetup` itself. A read is the key as a name
//     in code (`held.autoModeEnvSetup`, `{ autoModeEnvSetup } = held`), or the
//     key as a string in a subscript, before `in`, or before a `:`
//     (`held['autoModeEnvSetup']`). A comment is no read, and nor is a string
//     anywhere else: a message may name the key, alone or in a longer text,
//     because a key name is no value. Without a parser the check cannot follow
//     the key through a variable (`const key = '…'; held[key]`), so that read
//     is not named;
//   - a file that calls `autoModeState(` imports `autoModeState` and
//     `sessionRecordFiles` from '../helpers/teach-record.js', under their own
//     names or another name the calls use, and calls `sessionRecordFiles(`;
//   - each `autoModeState(` call gets the files that a `sessionRecordFiles(`
//     call gave, so it looks at the records of the test's own session and not
//     at a guessed list: its argument is `R.files` or `sessionRecordFiles(…).files`,
//     or a name bound from one of them (`const { files } = R`, or
//     `const files = R.files`), where `const R = sessionRecordFiles(…)`. The
//     check reads no scopes: a name bound so anywhere in the file counts.
//
// A file that answers the Teach form and checks nothing after it is not named:
// #745 does not ask it to add a check.
//
// Comments are taken out before anything is read. Without a parser the check
// cannot always tell a division from a regular expression, so it reads each
// file twice: once with a `/` that has another `/` after it on the line taken
// for a regular expression, whose text stays code, and once with no regular
// expressions at all (the principle of test/system-teardowns.test.js). What
// either reading shows is named, so a misread slash fails loudly and does not
// hide a read.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { repoRoot, snapshot } from './helpers/cli.js';

const systemTestsDir = path.join(repoRoot, 'test', 'system');

/** The key that only the helper may read. */
const KEY = 'autoModeEnvSetup';

/** The helper's path as a system test imports it. */
const HELPER = '../helpers/teach-record.js';

/** The string literals kept as they are: every other one is blanked. */
const KEPT_STRINGS = new Set([KEY, HELPER]);

/** What a quote in a regular expression's text becomes, so that it opens no string. */
const NEUTRAL = '\u0001';

const READS = `it reads ${KEY} itself: only test/helpers/teach-record.js may`;
const NO_STATE_IMPORT = `it calls autoModeState( but does not import autoModeState from '${HELPER}'`;
const NO_FILES_IMPORT = `it calls autoModeState( but does not import sessionRecordFiles from '${HELPER}'`;
const NO_FILES_CALL = 'it calls autoModeState( but does not call sessionRecordFiles( to find its own session\'s records';
const NOT_OWN_RECORDS = 'it calls autoModeState( with files that no sessionRecordFiles( call gave: its own session\'s records are not what it looks at';

/** Where the regular expression that would start at the `/` at `at` ends, its closing slash on the same line, or -1. */
function regexEnd(source, at) {
  let inClass = false;
  for (let next = at + 1; next < source.length && source[next] !== '\n'; next += 1) {
    const here = source[next];
    if (here === '\\') {
      if (source[next + 1] === '\n') return -1;
      next += 1;
    } else if (here === '[') inClass = true;
    else if (here === ']') inClass = false;
    else if (here === '/' && !inClass) return next;
  }
  return -1;
}

/** `text` with every character but a line end made a space. */
const blank = (text) => text.replace(/[^\n]/g, ' ');

/** A string literal's text as the reading keeps it: whole when it is one of KEPT_STRINGS, else blanked. */
const keptOrBlank = (text) => (KEPT_STRINGS.has(text) ? text : blank(text));

/**
 * The code of `source`: comments taken out, and the text of each string and
 * template literal blanked, but for a literal that is one of KEPT_STRINGS and
 * nothing else. The code inside a template's `${…}` stays code. A '- or
 * "-string ends at the end of its line. With `regex` (the default), a `/` that
 * has another `/` after it on the line is read as a regular expression: its
 * text stays code with its quotes made NEUTRAL, and the rest of the line is
 * code too, so a `//` there is no comment. Without it, every `/` is a plain
 * character.
 */
function codeOf(source, { regex = true } = {}) {
  let out = '';
  let at = 0;
  let codeToLineEnd = false;
  // The frames from the outside in: code, or a template literal's text.
  const frames = [{ kind: 'code', depth: 0, inTemplate: false }];
  while (at < source.length) {
    const frame = frames[frames.length - 1];
    const here = source[at];
    const next = source[at + 1];

    if (frame.kind === 'template') {
      if (here === '\\') {
        frame.text += here + (next ?? '');
        at += 2;
      } else if (here === '`') {
        out += `${frame.parts === 0 ? keptOrBlank(frame.text) : blank(frame.text)}\``;
        frames.pop();
        at += 1;
      } else if (here === '$' && next === '{') {
        out += `${blank(frame.text)}\${`;
        frame.text = '';
        frame.parts += 1;
        frames.push({ kind: 'code', depth: 0, inTemplate: true });
        at += 2;
      } else {
        frame.text += here;
        at += 1;
      }
      continue;
    }

    if (here === '\n') {
      codeToLineEnd = false;
      out += here;
      at += 1;
      continue;
    }
    if (!codeToLineEnd && here === '/' && next === '/') {
      while (at < source.length && source[at] !== '\n') at += 1;
      continue;
    }
    if (!codeToLineEnd && here === '/' && next === '*') {
      const end = source.indexOf('*/', at + 2);
      at = end < 0 ? source.length : end + 2;
      continue;
    }
    if (regex && here === '/') {
      const end = regexEnd(source, at);
      // A backtick is left as it is: a template it opened could run on for lines.
      if (end > at && !source.slice(at, end).includes('`')) {
        out += source.slice(at, end + 1).replace(/['"]/g, NEUTRAL);
        at = end + 1;
        codeToLineEnd = true;
        continue;
      }
    }
    if (here === '\'' || here === '"') {
      let end = at + 1;
      let text = '';
      while (end < source.length && source[end] !== here && source[end] !== '\n') {
        if (source[end] === '\\') {
          text += source[end] + (source[end + 1] ?? '');
          end += 2;
        } else {
          text += source[end];
          end += 1;
        }
      }
      out += `${here}${keptOrBlank(text)}${here}`;
      at = source[end] === here ? end + 1 : end;
      continue;
    }
    if (here === '`') {
      frames.push({ kind: 'template', text: '', parts: 0 });
      out += here;
      at += 1;
      continue;
    }
    if (here === '{') frame.depth += 1;
    if (here === '}') {
      if (frame.depth === 0 && frame.inTemplate) {
        frames.pop();
        out += here;
        at += 1;
        continue;
      }
      frame.depth -= 1;
    }
    out += here;
    at += 1;
  }
  return out;
}

/** A JavaScript name. */
const NAME = '[A-Za-z_$][\\w$]*';

/** `text` made safe to put in a regular expression. */
const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** What `code` imports from the helper: each name it imports, mapped to the name the file uses for it. */
function importedFromHelper(code) {
  const names = new Map();
  const from = /\bimport\s*\{([^}]*)\}\s*from\s*(['"])\.\.\/helpers\/teach-record\.js\2/g;
  for (const [, list] of code.matchAll(from)) {
    for (const spec of list.split(',')) {
      const parts = spec.trim().match(new RegExp(`^(${NAME})(?:\\s+as\\s+(${NAME}))?$`));
      if (parts !== null) names.set(parts[1], parts[2] ?? parts[1]);
    }
  }
  return names;
}

/** True when `code` reads the key: as a name in code, or as a string in a subscript, before `in`, or before a `:`. */
function readsKey(code) {
  const asName = new RegExp(`(?<![\\w$'"\`])${KEY}(?![\\w$'"\`])`);
  // A subscript follows a name, a `)`, a `]` or `?.`, so an array literal `['…']` is no read.
  // A `:` counts after `{` or `,` only, as a key in a destructure, so a ternary's `? '…' :` is no read.
  const asString = new RegExp(`(?:[\\w$)\\]]|\\?\\.)\\s*\\[\\s*(['"\`])${KEY}\\1\\s*\\]|(['"\`])${KEY}\\2\\s*\\bin\\b|[{,]\\s*(['"\`])${KEY}\\3\\s*:`);
  return asName.test(code) || asString.test(code);
}

/** The text of the argument list of each call `name(` in `code`, trimmed; a `function name(` is no call. */
function argumentsOf(code, name) {
  const found = [];
  const call = new RegExp(`(?<!\\bfunction\\s+)(?<![\\w$.])${escaped(name)}\\s*\\(`, 'g');
  for (const match of code.matchAll(call)) {
    let depth = 1;
    let at = match.index + match[0].length;
    const start = at;
    for (; at < code.length && depth > 0; at += 1) {
      if (code[at] === '(') depth += 1;
      else if (code[at] === ')') depth -= 1;
    }
    found.push(code.slice(start, at - 1).trim());
  }
  return found;
}

/**
 * The arguments that hand on the files a call of `filesName` gave: `R.files`
 * and `filesName(…).files`, and each name bound from one of them, where
 * `const R = filesName(…)` (`let` and `var` too, with or without `await`).
 */
function ownRecordsIn(code, filesName) {
  // Its arguments may hold one level of parentheses, as in `sessionRecordFiles(path.join(a, b))`.
  const callText = `${escaped(filesName)}\\s*\\([^()]*(?:\\([^()]*\\)[^()]*)*\\)`;
  const results = [...code.matchAll(new RegExp(`\\b(?:const|let|var)\\s+(${NAME})\\s*=\\s*(?:await\\s+)?${callText}`, 'g'))].map(([, name]) => name);
  const sources = [...results.map(escaped), callText].join('|');
  const accepted = [new RegExp(`^(?:${sources})\\s*\\??\\.\\s*files$`)];
  const names = new Set();
  for (const [, list] of code.matchAll(new RegExp(`\\{([^{}]*)\\}\\s*=\\s*(?:await\\s+)?(?:${sources})(?![\\w$])`, 'g'))) {
    for (const spec of list.split(',')) {
      const parts = spec.trim().match(new RegExp(`^files(?:\\s*:\\s*(${NAME}))?$`));
      if (parts !== null) names.add(parts[1] ?? 'files');
    }
  }
  for (const [, name] of code.matchAll(new RegExp(`\\b(?:const|let|var)\\s+(${NAME})\\s*=\\s*(?:await\\s+)?(?:${sources})\\s*\\??\\.\\s*files(?![\\w$])`, 'g'))) names.add(name);
  return (arg) => names.has(arg) || accepted.some((form) => form.test(arg));
}

/** What is wrong in one reading of a system test's code. */
function troubleInCode(code) {
  const found = [];
  if (readsKey(code)) found.push(READS);
  const names = importedFromHelper(code);
  const stateName = names.get('autoModeState') ?? 'autoModeState';
  const stateArgs = argumentsOf(code, stateName);
  if (stateArgs.length === 0) return found;
  if (!names.has('autoModeState')) found.push(NO_STATE_IMPORT);
  if (!names.has('sessionRecordFiles')) found.push(NO_FILES_IMPORT);
  const filesName = names.get('sessionRecordFiles') ?? 'sessionRecordFiles';
  if (argumentsOf(code, filesName).length === 0) found.push(NO_FILES_CALL);
  const own = ownRecordsIn(code, filesName);
  if (!stateArgs.every(own)) found.push(NOT_OWN_RECORDS);
  return found;
}

/** What is wrong in a system test's source, in either reading. */
function teachTrouble(source) {
  return [...new Set([...troubleInCode(codeOf(source)), ...troubleInCode(codeOf(source, { regex: false }))])];
}

// --------------------------------------------------------- the check itself

/** A system test in the shape of mail-interrupt.test.js: the helper, and a message that names the key. */
const THROUGH_HELPER = `
import assert from 'node:assert/strict';
import { autoModeState, sessionRecordFiles } from '../helpers/teach-record.js';

async function answerTeach(t, title, home) {
  const found = sessionRecordFiles(home);
  assert.ok(found.files !== undefined, \`no record for \${title}: \${found.why}\`);
  const { files } = found;
  const was = autoModeState(files);
  const now = autoModeState(files);
  assert.equal(now, was, \`Esc on \${title}'s Teach form taught nothing: autoModeEnvSetup should be as it was (before: \${was}; after: \${now})\`);
  t.diagnostic('answered the Teach form; autoModeEnvSetup stayed as it was');
}
`;

/** A system test in the shape of the ones before #745: it reads the key itself and prints it. */
const OWN_READ = `
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** ~/.claude.json's autoModeEnvSetup. */
function autoModeState() {
  try {
    const held = JSON.parse(readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8')).autoModeEnvSetup;
    return held === undefined ? 'absent' : JSON.stringify(held);
  } catch (error) {
    return \`unreadable (\${error.message})\`;
  }
}

test('x', async (t) => {
  const was = autoModeState();
  t.diagnostic(\`autoModeEnvSetup stayed \${was}\`);
});
`;

test('the check passes a system test that checks the Teach form through the helper, with the key named only in messages', () => {
  assert.deepEqual(teachTrouble(THROUGH_HELPER), []);
});

test('the check names a system test that reads the key itself, and checks the Teach form without the helper', () => {
  assert.deepEqual(teachTrouble(OWN_READ), [READS, NO_STATE_IMPORT, NO_FILES_IMPORT, NO_FILES_CALL, NOT_OWN_RECORDS]);
});

test('the check passes a system test that answers the Teach form and checks nothing after it', () => {
  const noCheck = "const TEACH_TITLE = 'Teach auto mode about your environment?';\norca(['terminal', 'send', '--terminal', handle, '--text', '\\x1b']);\n";
  assert.deepEqual(teachTrouble(noCheck), []);
});

test('the check is not fooled by comments: a read in a comment is none, and an import or a call in a comment is none', () => {
  const readInComments = `${THROUGH_HELPER}// const held = JSON.parse(text).autoModeEnvSetup;\n/* held['autoModeEnvSetup'] */\n`;
  assert.deepEqual(teachTrouble(readInComments), [], 'a read in comments is not code');

  const importInComment = THROUGH_HELPER.replace(
    "import { autoModeState, sessionRecordFiles } from '../helpers/teach-record.js';",
    "// import { autoModeState, sessionRecordFiles } from '../helpers/teach-record.js';",
  );
  assert.notEqual(importInComment, THROUGH_HELPER, 'the premise: the case was rewritten');
  assert.deepEqual(teachTrouble(importInComment), [NO_STATE_IMPORT, NO_FILES_IMPORT]);

  const callInComment = THROUGH_HELPER.replace('  const found = sessionRecordFiles(home);\n', '  const found = {}; // sessionRecordFiles(home)\n');
  assert.notEqual(callInComment, THROUGH_HELPER, 'the premise: the case was rewritten');
  assert.deepEqual(teachTrouble(callInComment), [NO_FILES_CALL, NOT_OWN_RECORDS]);
});

test('the check names a read of the key in any shape of code: a property, a string key, a name taken out, or code inside a message', () => {
  const reads = [
    'const held = JSON.parse(text)?.autoModeEnvSetup;',
    "const held = JSON.parse(text)['autoModeEnvSetup'];",
    'const held = JSON.parse(text)[`autoModeEnvSetup`];',
    'const { autoModeEnvSetup } = JSON.parse(text);',
    "const there = 'autoModeEnvSetup' in JSON.parse(text);",
    "const { 'autoModeEnvSetup': held } = JSON.parse(text);",
    't.diagnostic(`stayed ${JSON.stringify(JSON.parse(text).autoModeEnvSetup)}`);',
  ];
  for (const read of reads) assert.deepEqual(teachTrouble(`${THROUGH_HELPER}${read}\n`), [READS], read);
});

test('the check is not fooled by strings: a string that names the key in a longer text, or the helper\'s path, is not code', () => {
  const inStrings = `${THROUGH_HELPER}t.diagnostic("see held.autoModeEnvSetup in ../helpers/teach-record.js");\nconst note = 'autoModeState(files) and sessionRecordFiles(home)';\n`;
  assert.deepEqual(teachTrouble(inStrings), []);

  const callOnlyInString = "import { autoModeState, sessionRecordFiles } from '../helpers/teach-record.js';\nconst was = autoModeState(files);\nt.diagnostic('sessionRecordFiles(home) found them');\n";
  assert.deepEqual(teachTrouble(callOnlyInString), [NO_FILES_CALL, NOT_OWN_RECORDS], 'a call named in a string is no call');
});

test('the check passes a string that is the key name and nothing else, where it is no read: a key name is no value', () => {
  const names = [
    "t.diagnostic('autoModeEnvSetup');",
    'assert.equal(now, was, `autoModeEnvSetup`);',
    'const key = "autoModeEnvSetup";',
    "t.diagnostic(changed ? 'autoModeEnvSetup' : 'nothing');",
    "assert.deepEqual(keys, ['autoModeEnvSetup']);",
  ];
  for (const name of names) assert.deepEqual(teachTrouble(`${THROUGH_HELPER}${name}\n`), [], name);
});

test('the check names a system test that takes the two functions from another helper, or under another name', () => {
  const other = THROUGH_HELPER.replace("'../helpers/teach-record.js'", "'../helpers/my-record.js'");
  assert.notEqual(other, THROUGH_HELPER, 'the premise: the case was rewritten');
  assert.deepEqual(teachTrouble(other), [NO_STATE_IMPORT, NO_FILES_IMPORT]);

  const renamed = THROUGH_HELPER.replace('import { autoModeState, sessionRecordFiles }', 'import { autoModeState, sessionRecordFiles as recordFiles }');
  assert.notEqual(renamed, THROUGH_HELPER, 'the premise: the case was rewritten');
  assert.deepEqual(teachTrouble(renamed), [NO_FILES_CALL, NOT_OWN_RECORDS], 'renamed in the import, but called by its own name');
});

test('the check passes the two functions imported under other names, when the calls use those names', () => {
  const aliased = THROUGH_HELPER
    .replace('import { autoModeState, sessionRecordFiles }', 'import { sessionRecordFiles as recordsOf, autoModeState as stateOf }')
    .replace('sessionRecordFiles(home)', 'recordsOf(home)')
    .replaceAll('autoModeState(files)', 'stateOf(files)');
  assert.notEqual(aliased, THROUGH_HELPER, 'the premise: the case was rewritten');
  assert.ok(!/autoModeState\(|sessionRecordFiles\(/.test(aliased), 'the premise: every call uses its alias');
  assert.deepEqual(teachTrouble(aliased), []);
});

test('the check names an autoModeState( call that looks at a guessed list, not at the files sessionRecordFiles( gave', () => {
  const guessed = THROUGH_HELPER.replaceAll('autoModeState(files)', "autoModeState(['/guessed/.claude.json'])");
  assert.notEqual(guessed, THROUGH_HELPER, 'the premise: the case was rewritten');
  assert.deepEqual(teachTrouble(guessed), [NOT_OWN_RECORDS]);

  const oneGuessed = THROUGH_HELPER.replace('const now = autoModeState(files);', 'const now = autoModeState(guessedFiles);');
  assert.notEqual(oneGuessed, THROUGH_HELPER, 'the premise: the case was rewritten');
  assert.deepEqual(teachTrouble(oneGuessed), [NOT_OWN_RECORDS], 'one call of two on a guessed list');

  const otherResult = THROUGH_HELPER.replace('  const { files } = found;\n', '  const { files } = guess;\n');
  assert.notEqual(otherResult, THROUGH_HELPER, 'the premise: the case was rewritten');
  assert.deepEqual(teachTrouble(otherResult), [NOT_OWN_RECORDS], 'files taken out of something that is not a sessionRecordFiles( result');
});

test('the check passes each way of handing on the files sessionRecordFiles( gave', () => {
  const head = "import { autoModeState, sessionRecordFiles } from '../helpers/teach-record.js';\n";
  const forms = [
    'const found = sessionRecordFiles(home);\nconst was = autoModeState(found.files);',
    'const found = sessionRecordFiles(home);\nconst was = autoModeState(found?.files);',
    'const was = autoModeState(sessionRecordFiles(home).files);',
    'const found = sessionRecordFiles(path.join(bots, name));\nconst { files: records } = found;\nconst was = autoModeState(records);',
    'const found = await sessionRecordFiles(home, { env });\nconst records = found.files;\nconst was = autoModeState(records);',
    'const { files, why } = sessionRecordFiles(home);\nconst was = autoModeState(files);',
  ];
  for (const form of forms) assert.deepEqual(teachTrouble(`${head}${form}\n`), [], form);
});

test('a misread slash never hides a read: a quote in a regular expression, or a division the check takes for one', () => {
  const quoteInRegex = `${THROUGH_HELPER}const ok = /'/.test(text) && JSON.parse(text).autoModeEnvSetup;\n`;
  assert.deepEqual(teachTrouble(quoteInRegex), [READS], 'a quote in a regular expression opens no string');

  const division = `${THROUGH_HELPER}const half = n / 2; const s = 'a/b'; const held = JSON.parse(text).autoModeEnvSetup;\n`;
  assert.deepEqual(teachTrouble(division), [READS], 'the reading with no regular expressions shows the read');
});

// ------------------------------------------------------------- the system tests

test('no system test reads autoModeEnvSetup itself, and each that checks the Teach form does it through the helper', async () => {
  const tree = await snapshot(systemTestsDir);
  const files = Object.keys(tree).filter((rel) => tree[rel].startsWith('file:') && rel.endsWith('.js')).sort();
  assert.ok(files.length > 0, 'there should be system tests to check');

  const found = [];
  let checks = 0;
  for (const rel of files) {
    const source = await readFile(path.join(systemTestsDir, rel), 'utf8');
    if (/\bautoModeState\s*\(/.test(codeOf(source))) checks += 1;
    for (const why of teachTrouble(source)) found.push(`test/system/${rel}: ${why}`);
  }
  assert.ok(checks > 0, 'no system test calls autoModeState(, so the check sees nothing');
  assert.deepEqual(found, [], `system tests that check the Teach form without test/helpers/teach-record.js:\n  ${found.join('\n  ')}`);
});
